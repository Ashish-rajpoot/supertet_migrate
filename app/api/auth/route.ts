import crypto from "node:crypto";
import { isValidUserId, uniqueUserId } from "@/lib/userid";
import {
  isValidEmail,
  isValidPhone,
  normaliseEmail,
  normalisePhone,
} from "@/lib/contact";
import { Otp, User } from "@/lib/server/models";
import {
  generateOtp,
  hashPassword,
  requireAuth,
  verifyPassword,
} from "@/lib/server/auth";
import { requireDb, readBody, sessionFor, toPublicUser } from "@/lib/server/api";

export const dynamic = "force-dynamic";

function adminEmails(): string[] {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyAdminBootstrap(user: any): Promise<boolean> {
  if (!user || !user.email) return false;
  if (!adminEmails().includes(String(user.email).toLowerCase())) return false;
  if (user.role === "admin" && user.canAddQuestions) return false;
  user.role = "admin";
  user.canAddQuestions = true;
  await user.save();
  return true;
}

/** Fields a student may edit (email/phone/userId are NOT here). */
const PROFILE_FIELDS = ["name", "avatar", "classLevel", "city", "school", "about"] as const;

function parseIdentifier(input = "") {
  const str = String(input).trim();
  const email = normaliseEmail(str);
  const phone = normalisePhone(str);
  const isEmail = isValidEmail(email);
  const isPhone = isValidPhone(phone);
  return {
    raw: str,
    isEmail,
    isPhone,
    // Canonical form, so the value stored matches the one every later
    // lookup will search for. See lib/contact.ts.
    value: isPhone ? phone : isEmail ? email : str,
  };
}

/** Save an OTP and log the code (dev dispatch, same as Express). */
async function dispatchOtp(target: string, code: string, type = "register") {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await Otp.deleteMany({ target, type });
  await Otp.create({ target, code, type, expiresAt });
  console.log(
    `\n========================================\n[OTP] Sent to ${target}: ${code} (purpose: ${type}, valid 10m)\n========================================\n`
  );
}

interface AuthAction {
  action?: string;
  [k: string]: unknown;
}

function err(e: unknown, fallback: string) {
  return { error: e instanceof Error ? e.message : fallback };
}

function devOtp(code: string) {
  return process.env.NODE_ENV === "production" ? undefined : code;
}
/**
 * POST /api/auth - single dispatch endpoint mirroring the Express router:
 * { action: "register" | "verify-otp" | "resend-otp" | "login-password" |
 *           "login-otp"  | "google"     | "me"        | "profile"      |
 *           "change-password" }
 */
export async function POST(req: Request) {
  const body = ((await readBody<AuthAction>(req)) || {}) as AuthAction;
  const action = String(body.action || "");

  /* ---------------- register: create account + send OTP ---------------- */
  if (action === "register") {
    const dbDown = await requireDb();
    if (dbDown) return dbDown;
    try {
      const name = String(body.name || "").trim();
      const identifier = parseIdentifier(String(body.identifier || ""));
      const userIdRaw = String(body.userId || "").trim();
      const password = String(body.password || "");
      if (!identifier.raw || !password) {
        return Response.json({ error: "Email/phone and password are required" }, { status: 400 });
      }
      if (password.length < 6) {
        return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
      }
      if (!identifier.isEmail && !identifier.isPhone) {
        return Response.json(
          { error: "Enter a valid email address or phone number" },
          { status: 400 }
        );
      }
      const clash = identifier.isEmail
        ? await User.findOne({ email: identifier.value })
        : await User.findOne({ phone: identifier.value });
      if (clash) {
        const kind = identifier.isEmail ? "email" : "phone number";
        return Response.json(
          { error: `This ${kind} is already registered. Please log in.` },
          { status: 409 }
        );
      }
      const userId = userIdRaw.toLowerCase();
      if (userId) {
        if (!isValidUserId(userId)) {
          return Response.json(
            { error: "User ID must be 3-30 chars: letters, numbers, _ or ." },
            { status: 400 }
          );
        }
        const taken = await User.findOne({ userId });
        if (taken) {
          return Response.json({ error: "This user ID is taken. Pick another." }, { status: 409 });
        }
      }
      // With no id chosen, derive a clean one from the email/phone:
      // "Rani Sharma@gmail.com" becomes "rani.sharma", not the whole
      // address. See lib/userid.ts.
      const finalUserId =
        userId ||
        (await uniqueUserId(identifier.value, async (c) =>
          Boolean(await User.findOne({ userId: c }).select("id").lean())
        ));
      const { hash, salt } = hashPassword(password);
      const user = new User({
        id: "u_" + crypto.randomUUID(),
        name: name || "Student",
        email: identifier.isEmail ? identifier.value : "",
        phone: identifier.isPhone ? identifier.value : "",
        userId: finalUserId,
        passwordHash: hash,
        salt,
        verified: false,
        role: "user",
        canAddQuestions: false,
      });
      await applyAdminBootstrap(user);
      await user.save();
      const code = generateOtp();
      await dispatchOtp(identifier.value, code, "register");
      return Response.json(
        {
          ok: true,
          message: "Account created. Enter the OTP sent to verify.",
          target: identifier.value,
          devOtp: devOtp(code),
          user: toPublicUser(user),
        },
        { status: 201 }
      );
    } catch (e) {
      return Response.json(err(e, "Could not register"), { status: 500 });
    }
  }

  /* ---------------- verify-otp: confirm + return a session ---------------- */
  if (action === "verify-otp") {
    const dbDown = await requireDb();
    if (dbDown) return dbDown;
    try {
      const target = String(body.target || "").trim();
      const code = String(body.code || "").trim();
      if (!target || !code) {
        return Response.json({ error: "Target and OTP are required" }, { status: 400 });
      }
      const otp = await Otp.findOne({ target, code });
      if (!otp) {
        return Response.json(
          { error: "Invalid or expired OTP. Request a new one." },
          { status: 400 }
        );
      }
      const isEmail = target.includes("@");
      const user = isEmail
        ? await User.findOne({ email: normaliseEmail(target) })
        : await User.findOne({ phone: normalisePhone(target) });
      if (!user) return Response.json({ error: "Account not found" }, { status: 404 });
      user.verified = true;
      await applyAdminBootstrap(user);
      await user.save();
      await Otp.deleteMany({ target });
      return Response.json({ ok: true, ...(await sessionFor(user)) });
    } catch (e) {
      return Response.json(err(e, "Could not verify the OTP"), { status: 500 });
    }
  }
  /* ---------------- resend-otp: fresh code ---------------- */
  if (action === "resend-otp") {
    const dbDown = await requireDb();
    if (dbDown) return dbDown;
    try {
      const targetInput = String(body.target || "").trim();
      if (!targetInput) {
        return Response.json({ error: "Email or phone is required" }, { status: 400 });
      }
      const type = String(body.type || "register");
      const parsed = parseIdentifier(targetInput);
      const target = parsed.isPhone || parsed.isEmail ? parsed.value : parsed.raw;
      const isEmail = target.includes("@");
      const user = isEmail
        ? await User.findOne({ email: normaliseEmail(target) })
        : await User.findOne({ phone: normalisePhone(target) });
      if (user && user.verified && type === "register") {
        return Response.json(
          { error: "This account is already verified. Please log in." },
          { status: 400 }
        );
      }
      if (!user && (type === "login" || type === "reset")) {
        return Response.json({ error: "No account found for this email/phone." }, { status: 404 });
      }
      const code = generateOtp();
      await dispatchOtp(target, code, type);
      return Response.json({
        ok: true,
        message: "OTP sent",
        target,
        devOtp: devOtp(code),
      });
    } catch (e) {
      return Response.json(err(e, "Could not send the OTP"), { status: 500 });
    }
  }

  /* ---------------- login-password: email/phone/userId + password ---------------- */
  if (action === "login-password") {
    const dbDown = await requireDb();
    if (dbDown) return dbDown;
    try {
      const identifier = parseIdentifier(String(body.identifier || ""));
      const password = String(body.password || "");
      if (!identifier.raw || !password) {
        return Response.json(
          { error: "Email/phone/user ID and password are required" },
          { status: 400 }
        );
      }
      let user = null;
      if (identifier.isEmail) {
        user = await User.findOne({ email: identifier.value });
      } else if (identifier.isPhone) {
        user = await User.findOne({ phone: identifier.value });
      } else {
        user = await User.findOne({ userId: identifier.raw.toLowerCase() });
      }
      if (!user) {
        user = await User.findOne({ userId: identifier.raw.toLowerCase() });
      }
      if (!user || !user.passwordHash) {
        return Response.json({ error: "Invalid login details" }, { status: 401 });
      }
      const valid = verifyPassword(password, user.salt, user.passwordHash);
      if (!valid) return Response.json({ error: "Invalid login details" }, { status: 401 });
      if (!user.verified) {
        const target = user.email || user.phone;
        const code = generateOtp();
        await dispatchOtp(target, code, "register");
        return Response.json(
          {
            error: "Please verify your account first. A fresh OTP was sent.",
            needsVerification: true,
            target,
            devOtp: devOtp(code),
          },
          { status: 403 }
        );
      }
      await applyAdminBootstrap(user);
      return Response.json({ ok: true, ...(await sessionFor(user)) });
    } catch (e) {
      return Response.json(err(e, "Could not log in"), { status: 500 });
    }
  }

  /* ---------------- login-otp: passwordless sign-in ---------------- */
  if (action === "login-otp") {
    const dbDown = await requireDb();
    if (dbDown) return dbDown;
    try {
      const target = String(body.target || "").trim();
      const code = String(body.code || "").trim();
      if (!target || !code) {
        return Response.json({ error: "Target and OTP are required" }, { status: 400 });
      }
      const otp = await Otp.findOne({ target, code });
      if (!otp) {
        return Response.json(
          { error: "Invalid or expired OTP. Request a new one." },
          { status: 400 }
        );
      }
      const isEmail = target.includes("@");
      const user = isEmail
        ? await User.findOne({ email: normaliseEmail(target) })
        : await User.findOne({ phone: normalisePhone(target) });
      if (!user) return Response.json({ error: "Account not found" }, { status: 404 });
      if (!user.verified) {
        user.verified = true;
        await user.save();
      }
      await applyAdminBootstrap(user);
      await Otp.deleteMany({ target });
      return Response.json({ ok: true, ...(await sessionFor(user)) });
    } catch (e) {
      return Response.json(err(e, "Could not log in"), { status: 500 });
    }
  }
  /* ---------------- google: Google ID token sign-in ---------------- */
  if (action === "google") {
    const dbDown = await requireDb();
    if (dbDown) return dbDown;
    try {
      const idToken = String(body.idToken || "").trim();
      if (!idToken) {
        return Response.json({ error: "Google sign-in token is required" }, { status: 400 });
      }
      const payload = await verifyGoogleToken(idToken);
      if (!payload || !payload.email) {
        return Response.json({ error: "Google sign-in failed. Try again." }, { status: 401 });
      }
      const email = normaliseEmail(String(payload.email || ""));
      // 1. An account that already linked this exact Google identity.
      // 2. A password account that has never linked Google, matched on the
      //    verified Google email - this is the "adopt Google sign-in" path.
      //    It is only safe while the account has no googleId: once linked,
      //    the Google identity is authoritative and email must not be able
      //    to redirect it. See the note below.
      let user = null;
      let emailMatch = false;
      if (payload.sub) user = await User.findOne({ googleId: payload.sub });
      if (!user && email) {
        const candidate = await User.findOne({ email });
        if (candidate) {
          if (candidate.googleId && candidate.googleId !== payload.sub) {
            // Someone controls this email on a Google account that is NOT
            // the one linked here. Letting them in would hand the account
            // (and its history) to a different person, so stop.
            return Response.json(
              {
                error:
                  "This email is already linked to a different Google account. Sign in with that account, or with your password.",
              },
              { status: 409 }
            );
          }
          user = candidate;
          emailMatch = true;
        }
      }
      if (!user) {
        user = new User({
          id: "u_" + crypto.randomUUID(),
          name: payload.name || "Student",
          email,
          // Same clean derived id as every other signup path, so a Google
          // user never ends up with an id containing "@".
          userId: await uniqueUserId(email, async (c) =>
            Boolean(await User.findOne({ userId: c }).select("id").lean())
          ),
          googleId: payload.sub || "",
          avatar: payload.picture || "",
          verified: true,
          role: "user",
          canAddQuestions: false,
        });
        await applyAdminBootstrap(user);
        await user.save();
      } else if (!user.verified || (emailMatch && payload.sub && !user.googleId)) {
        // Link a password account to Google for the first time. Only ever
        // fills an empty googleId - an existing link is never overwritten,
        // or a changed email address could rebind someone else's identity.
        if (payload.sub && !user.googleId) user.googleId = payload.sub;
        user.verified = true;
        if (payload.picture && !user.avatar) user.avatar = payload.picture;
        await applyAdminBootstrap(user);
        await user.save();
      }
      return Response.json({ ok: true, ...(await sessionFor(user)) });
    } catch (e) {
      return Response.json(err(e, "Google sign-in failed"), { status: 500 });
    }
  }

  /* ---------------- me / profile / change-password ---------------- */
  // These need a signed-in caller; the payload lookup happens once.
  if (
    action === "me" ||
    action === "profile" ||
    action === "change-password" ||
    action === "request-contact"
  ) {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    const dbDown = await requireDb();
    if (dbDown) return dbDown;
    try {
      const user = await User.findOne({ id: auth.payload.id });
      if (!user) return Response.json({ error: "User not found" }, { status: 404 });

      if (action === "me") {
        await applyAdminBootstrap(user);
        return Response.json({ ok: true, user: toPublicUser(user) });
      }

      if (action === "profile") {
        for (const field of PROFILE_FIELDS) {
          if (body[field] !== undefined) {
            const value = String(body[field] ?? "").trim();
            if (value.length > 120) {
              return Response.json(
                { error: `${field} is too long (max 120 characters)` },
                { status: 400 }
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (user as any)[field] = value;
          }
        }
        await user.save();
        return Response.json({ ok: true, user: toPublicUser(user) });
      }

      /* ---------------- request-contact: ask an admin to change it ----------------
         Phone and email are login identifiers, so they cannot simply be
         edited here. The student proposes a value; nothing changes until
         an admin approves it through the same checks the edit form uses.

         This is deliberately NOT an OTP flow: there is no SMS/email
         provider wired up in this app yet (dispatchOtp only writes a row
         and logs the code), so "verify the new number" would prove
         nothing. Once a real sender exists, auto-approve after
         verification is the natural next step. */
      if (action === "request-contact") {
        const field = String(body.field || "");
        if (field !== "phone" && field !== "email") {
          return Response.json({ error: "field must be 'phone' or 'email'" }, { status: 400 });
        }
        if (user.contactRequest?.status === "pending") {
          return Response.json(
            { error: "You already have a change waiting for review" },
            { status: 409 }
          );
        }
        // On a Google account the email is Google's to own. Say so now
        // rather than letting the student wait for a refusal.
        if (field === "email" && user.googleId) {
          return Response.json(
            { error: "This account signs in with Google, so its email cannot be changed." },
            { status: 400 }
          );
        }
        const value =
          field === "phone" ? normalisePhone(String(body.value || "")) : normaliseEmail(String(body.value || ""));
        const valid = field === "phone" ? isValidPhone(value) : isValidEmail(value);
        if (!valid) {
          return Response.json(
            { error: field === "phone" ? "Enter a valid phone number" : "Enter a valid email address" },
            { status: 400 }
          );
        }
        if (value === user[field]) {
          return Response.json(
            { error: `That is already your ${field}` },
            { status: 400 }
          );
        }
        // Catch an obvious clash now so the student is not left waiting
        // for an admin to reject it. The approval re-checks this too,
        // since someone else may claim the number in between.
        const clash = await User.findOne({ [field]: value, id: { $ne: user.id } })
          .select("id")
          .lean();
        if (clash) {
          return Response.json(
            { error: `That ${field} is already registered to another account` },
            { status: 409 }
          );
        }
        user.contactRequest = {
          field,
          value,
          status: "pending",
          submittedAt: new Date(),
        };
        await user.save();
        return Response.json({ ok: true, user: toPublicUser(user) });
      }

      // change-password
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      if (!currentPassword || !newPassword) {
        return Response.json(
          { error: "Current and new password are required" },
          { status: 400 }
        );
      }
      if (newPassword.length < 6) {
        return Response.json(
          { error: "New password must be at least 6 characters" },
          { status: 400 }
        );
      }
      // Google-only accounts have no password yet, so allow setting one.
      if (user.passwordHash) {
        const valid = verifyPassword(currentPassword, user.salt, user.passwordHash);
        if (!valid) {
          return Response.json({ error: "Current password is incorrect" }, { status: 401 });
        }
      }
      const pw = hashPassword(newPassword);
      user.passwordHash = pw.hash;
      user.salt = pw.salt;
      await user.save();
      return Response.json({ ok: true, message: "Password updated" });
    } catch (e) {
      return Response.json(err(e, "Could not update the account"), { status: 500 });
    }
  }

  return Response.json({ error: `Unknown auth action: ${action || "(missing)"}` }, { status: 400 });
}

interface GooglePayload {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  aud?: string;
}

/**
 * Dev-friendly Google token check: decode the payload part of the JWT and
 * accept it when it carries an email. In production the token must be
 * minted for OUR client id (same rule as the Express server). Either env
 * name works (see .env.example), so a deployment sets the id once and the
 * browser button reads the NEXT_PUBLIC_ copy of the same value.
 */
async function verifyGoogleToken(idToken: string): Promise<GooglePayload | null> {
  try {
    const clientId =
      process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (clientId && payload.aud !== clientId) return null;
    if (!payload.email) return null;
    return payload as GooglePayload;
  } catch {
    return null;
  }
}
