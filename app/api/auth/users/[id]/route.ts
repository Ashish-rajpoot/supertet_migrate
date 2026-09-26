import { User } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { readBody, requireDb, toPublicUser } from "@/lib/server/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/auth/users/:id - admin only. Grants/revokes
 * `canAddQuestions` and (optionally) promotes/demotes a role.
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

    if (Object.prototype.hasOwnProperty.call(body, "canAddQuestions")) {
      target.canAddQuestions = Boolean(body.canAddQuestions);
    }
    if (Object.prototype.hasOwnProperty.call(body, "role")) {
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
      target.role = role as "user" | "admin";
      // Admins can always add questions, so keep the flag consistent.
      if (role === "admin") target.canAddQuestions = true;
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
