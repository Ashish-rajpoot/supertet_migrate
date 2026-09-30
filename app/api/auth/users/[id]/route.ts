import { isValidUserId } from "@/lib/userid";
import { NAME_MAX } from "@/lib/contact";
import { applyContactChange } from "@/lib/server/contact-change";
import { Otp, User } from "@/lib/server/models";
import { hashPassword, requireAdmin } from "@/lib/server/auth";
import { readBody, requireDb, toPublicUser } from "@/lib/server/api";
import { extendSubscription } from "@/lib/server/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const has = (body: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(body, key);

/** Admins besides this account - the platform must always keep one. */
async function otherAdminCount(id: string): Promise<number> {
  return User.countDocuments({ role: "admin", id: { $ne: id } });
}

/**
 * PATCH /api/auth/users/:id - admin only. Grants/revokes
 * `canAddQuestions`, promotes/demotes a role, edits the profile
 * fields (name, email, phone, user id, verification, class, city,
 * school, about), manages access (`unlimited` grant plus approving
 * or rejecting a pending payment) and optionally resets the password
 * (when a non-empty `password` is sent).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    const body = ((await readBody(req)) || {}) as Record<string, unknown>;
    const target = await User.findOne({ id });
    if (!target) return Response.json({ error: "User not found" }, { status: 404 });

    if (has(body, "canAddQuestions")) {
      target.canAddQuestions = Boolean(body.canAddQuestions);
    }
    if (has(body, "role")) {
      const role = String(body.role);
      if (!["user", "admin"].includes(role)) {
        return Response.json({ error: "role must be 'user' or 'admin'" }, { status: 400 });
      }
      if (target.id === auth.payload.id && role !== "admin") {
        return Response.json(
          { error: "You cannot remove your own admin role" },
          { status: 400 }
        );
      }
      if (
        target.role === "admin" &&
        role !== "admin" &&
        (await otherAdminCount(target.id)) === 0
      ) {
        return Response.json(
          { error: "At least one admin account must remain" },
          { status: 400 }
        );
      }
      target.role = role as "user" | "admin";
      // Admins can always add questions, so keep the flag consistent.
      if (role === "admin") target.canAddQuestions = true;
    }

    /* ------------- subscription / payment decision ------------- */
    if (has(body, "unlimited")) {
      target.unlimited = Boolean(body.unlimited);
    }
    if (has(body, "paymentDecision")) {
      const decision = String(body.paymentDecision);
      if (!["approved", "rejected"].includes(decision)) {
        return Response.json(
          { error: "paymentDecision must be 'approved' or 'rejected'" },
          { status: 400 }
        );
      }
      if (target.payment?.status !== "pending") {
        return Response.json(
          { error: "There is no pending payment on this account" },
          { status: 400 }
        );
      }
      target.payment.status = decision as "approved" | "rejected";
      target.payment.decidedAt = new Date();
      // Approval adds 30 days on top of whatever time is already left.
      if (decision === "approved") {
        target.subscriptionExpiresAt = extendSubscription(target.subscriptionExpiresAt);
      }
    }

    /* ------------- profile fields (admin-managed) ------------- */
    if (has(body, "name")) {
      const name = String(body.name || "").trim();
      if (name.length > NAME_MAX) {
        return Response.json(
          { error: `Name must be ${NAME_MAX} characters or fewer` },
          { status: 400 }
        );
      }
      target.name = name || target.name;
    }
    // Contact details go through the single shared writer, which checks
    // format, clashes and the "no way to sign in" case. allowEmpty so an
    // admin can clear a bad contact.
    for (const field of ["email", "phone"] as const) {
      if (!has(body, field)) continue;
      const problem = await applyContactChange(target, field, String(body[field] || ""), {
        allowEmpty: true,
      });
      if (problem) {
        return Response.json(
          { error: problem },
          { status: problem.includes("already registered") ? 409 : 400 }
        );
      }
    }
    if (has(body, "userId")) {
      const userId = String(body.userId || "").trim().toLowerCase();
      if (userId && !isValidUserId(userId)) {
        return Response.json(
          { error: "User ID must be 3-30 chars: letters, numbers, _ or ." },
          { status: 400 }
        );
      }
      // The user id is the permanent handle on an account: attempts, the
      // analytics roster and saved progress all key off it, so it is
      // fixed at creation even for an admin. Email and phone stay
      // editable because they are contact details, not identifiers.
      if (userId && userId !== target.userId) {
        return Response.json(
          {
            error:
              "The user ID cannot be changed once the account exists. Ask the user to sign up again if they need a different one.",
          },
          { status: 409 }
        );
      }
    }
    /* ------------- approve / reject a contact change request ------------- */
    if (has(body, "contactDecision")) {
      const decision = String(body.contactDecision);
      if (!["approved", "rejected"].includes(decision)) {
        return Response.json(
          { error: "contactDecision must be 'approved' or 'rejected'" },
          { status: 400 }
        );
      }
      if (target.contactRequest?.status !== "pending") {
        return Response.json(
          { error: "There is no pending contact change on this account" },
          { status: 400 }
        );
      }
      const request = target.contactRequest;
      if (decision === "approved") {
        // Goes through the same writer as the edit form, so approving a
        // request cannot bypass the clash or sign-in checks.
        const problem = await applyContactChange(
          target,
          request.field,
          request.value,
          { allowEmpty: false }
        );
        if (problem) {
          // Leave it pending so the admin can fix the value, and say why.
          return Response.json({ error: problem }, { status: 409 });
        }
      }
      request.status = decision as "approved" | "rejected";
      request.decidedAt = new Date();
    }

    if (has(body, "verified")) target.verified = Boolean(body.verified);
    if (has(body, "classLevel")) target.classLevel = String(body.classLevel || "").slice(0, 120);
    if (has(body, "city")) target.city = String(body.city || "").slice(0, 120);
    if (has(body, "school")) target.school = String(body.school || "").slice(0, 160);
    if (has(body, "about")) target.about = String(body.about || "").slice(0, 1000);

    // Optional password reset: an empty / missing password keeps the old one.
    const newPassword = String(body.password || "");
    if (newPassword) {
      if (newPassword.length < 6) {
        return Response.json(
          { error: "Password must be at least 6 characters" },
          { status: 400 }
        );
      }
      const { hash, salt } = hashPassword(newPassword);
      target.passwordHash = hash;
      target.salt = salt;
    }

    await target.save();
    return Response.json({ ok: true, user: toPublicUser(target) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not update the user" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/users/:id - admin only. Removes an account.
 * Your own account and the last remaining admin are protected.
 * Test history is kept as anonymous records (the analytics page
 * lists orphaned attempts under "Unknown user").
 */
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    if (id === auth.payload.id) {
      return Response.json(
        { error: "You cannot delete your own account" },
        { status: 400 }
      );
    }
    const target = await User.findOne({ id });
    if (!target) return Response.json({ error: "User not found" }, { status: 404 });
    if (target.role === "admin" && (await otherAdminCount(target.id)) === 0) {
      return Response.json(
        { error: "At least one admin account must remain" },
        { status: 400 }
      );
    }
    // Drop pending OTPs so a code issued for this account cannot linger.
    const identifiers = [target.email, target.phone].filter(Boolean);
    if (identifiers.length) {
      await Otp.deleteMany({ target: { $in: identifiers } });
    }
    await target.deleteOne();
    return Response.json({ ok: true, user: toPublicUser(target) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not delete the user" },
      { status: 500 }
    );
  }
}
