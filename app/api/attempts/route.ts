import { Attempt, User } from "@/lib/server/models";
import { getAuthPayload, requireAuth } from "@/lib/server/auth";
import { queryOf, readBody, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** Is the signed-in caller an admin? (role read fresh from the database) */
async function isAdminUser(userId: string | undefined | null): Promise<boolean> {
  if (!userId) return false;
  const user = await User.findOne({ id: userId }).select("role").lean();
  return Boolean(user && user.role === "admin");
}

/**
 * GET /api/attempts - list, always scoped to one user:
 *   default     -> own attempts
 *   ?scope=all  -> every student (admin)
 *   ?userId=..  -> one student  (admin)
 */
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const admin = await isAdminUser(auth.payload.id);
    const wantsAll = q.get("scope") === "all";
    const wantsUser = String(q.get("userId") || "").trim();

    const filter: Record<string, string> = {};
    if (wantsAll || wantsUser) {
      if (!admin) {
        return Response.json(
          { error: "Only an admin can see other students' results" },
          { status: 403 }
        );
      }
      if (wantsUser) filter.userId = wantsUser;
    } else {
      filter.userId = auth.payload.id;
    }
    const student = q.get("student");
    if (student) filter.student = student.trim();
    const mode = q.get("mode");
    if (mode) filter.mode = mode.trim();
    const limit = Math.min(parseInt(q.get("limit") || "100", 10) || 100, 500);

    const docs = await Attempt.find(filter)
      .select("-details")
      .sort({ at: -1 })
      .limit(limit)
      .lean();
    return Response.json({
      attempts: docs,
      scope: wantsAll ? "all" : wantsUser ? "user" : "mine",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load attempts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/attempts - save / upsert. Signed-in attempts are attributed
 * to the account so the analytics page can group by student.
 */
export async function POST(req: Request) {
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const payload = getAuthPayload(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = { ...((await readBody(req)) || {}) };
    if (!data.id || data.total == null) {
      return Response.json(
        { error: "Missing required field: id and total are required" },
        { status: 400 }
      );
    }
    if (payload && payload.id) {
      data.userId = payload.id;
      const account = await User.findOne({ id: payload.id }).select("name").lean();
      if (account && account.name) data.student = account.name;
    } else if (!data.userId) {
      data.userId = "";
    }
    const doc = await Attempt.findOneAndUpdate(
      { id: data.id },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return Response.json({ ok: true, id: doc.id, userId: doc.userId || "" }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not save the attempt" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/attempts - admin clears everything (?student= / ?userId=
 * narrow it); a plain user clears only their own attempts.
 */
export async function DELETE(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const admin = await isAdminUser(auth.payload.id);
    const filter: Record<string, string> = {};
    if (admin) {
      const student = q.get("student");
      if (student) filter.student = student.trim();
      const userId = q.get("userId");
      if (userId) filter.userId = userId.trim();
    } else {
      filter.userId = auth.payload.id;
    }
    const r = await Attempt.deleteMany(filter);
    return Response.json({ ok: true, count: r.deletedCount, scope: admin ? "all" : "mine" });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not delete attempts" },
      { status: 500 }
    );
  }
}
