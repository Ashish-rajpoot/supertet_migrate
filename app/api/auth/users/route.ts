import { User } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { queryOf, requireDb, toPublicUser } from "@/lib/server/api";

export const dynamic = "force-dynamic";

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
