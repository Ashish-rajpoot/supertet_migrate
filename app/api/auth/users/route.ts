import { isValidUserId, uniqueUserId } from "@/lib/userid";
import { User } from "@/lib/server/models";
import { hashPassword, requireAdmin } from "@/lib/server/auth";
import { queryOf, readBody, requireDb, toPublicUser } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{10,14}$/;

/** GET /api/auth/users - admin only: roster for the permission panel. */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const limit = Math.min(parseInt(q.get("limit") || "200", 10) || 200, 500);
    const users = await User.find().sort({ createdAt: -1 }).limit(limit);
    return Response.json({ users: users.map(toPublicUser), count: users.length });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load users" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/users - admin only: create an account directly.
 * Unlike self-registration there is no OTP step - admin-created
 * accounts are verified by default so they can log in right away.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const body = ((await readBody(req)) || {}) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").replace(/[\s-]/g, "");
    const userIdRaw = String(body.userId || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = String(body.role || "user") === "admin" ? "admin" : "user";

    if (!email && !phone) {
      return Response.json({ error: "Email or phone is required" }, { status: 400 });
    }
    if (email && !EMAIL_RE.test(email)) {
      return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (phone && !PHONE_RE.test(phone)) {
      return Response.json({ error: "Enter a valid phone number" }, { status: 400 });
    }
    if (password.length < 6) {
      return Response.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }
      if (userIdRaw && !isValidUserId(userIdRaw)) {
        return Response.json(
          { error: "User ID must be 3-30 chars: letters, numbers, _ or ." },
          { status: 400 }
        );
      }
      // Same default as self-registration: a clean id derived from the
      // email (or phone), not the whole address. See lib/userid.ts.
      const userId =
        userIdRaw ||
        (await uniqueUserId(email || phone, async (c) =>
          Boolean(await User.findOne({ userId: c }).select("id").lean())
        ));

    if (email && (await User.findOne({ email }))) {
      return Response.json({ error: "This email is already registered" }, { status: 409 });
    }
    if (phone && (await User.findOne({ phone }))) {
      return Response.json({ error: "This phone number is already registered" }, { status: 409 });
    }
    if (await User.findOne({ userId })) {
      return Response.json({ error: "This user ID is taken. Pick another." }, { status: 409 });
    }

    const { hash, salt } = hashPassword(password);
    const user = new User({
      id: "u_" + crypto.randomUUID(),
      name: name || "Student",
      email,
      phone,
      userId,
      passwordHash: hash,
      salt,
      verified: body.verified === undefined ? true : Boolean(body.verified),
      role,
      canAddQuestions: role === "admin" ? true : Boolean(body.canAddQuestions),
      classLevel: String(body.classLevel || ""),
      city: String(body.city || ""),
      school: String(body.school || ""),
      about: String(body.about || ""),
    });
    await user.save();
    return Response.json({ ok: true, user: toPublicUser(user) }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not create the user" },
      { status: 500 }
    );
  }
}
