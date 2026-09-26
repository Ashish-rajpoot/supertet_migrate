import { Attempt, User } from "@/lib/server/models";
import { getAuthPayload } from "@/lib/server/auth";
import { requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

async function isAdminUser(userId: string | undefined | null): Promise<boolean> {
  if (!userId) return false;
  const user = await User.findOne({ id: userId }).select("role").lean();
  return Boolean(user && user.role === "admin");
}

/** GET /api/attempts/:id - full result incl. details, public for sharing. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    const doc = await Attempt.findOne({ id }).lean();
    if (!doc) return Response.json({ error: "Result not found" }, { status: 404 });
    return Response.json(doc);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load the result" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/attempts/:id - device-only attempts need just the id;
 * account-owned ones need the owner or an admin.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    const payload = getAuthPayload(req);
    const doc = await Attempt.findOne({ id }).select("id userId").lean();
    if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
    if (doc.userId) {
      const admin = await isAdminUser(payload?.id);
      if (!payload || (payload.id !== doc.userId && !admin)) {
        return Response.json(
          { error: "You can only delete your own results" },
          { status: 403 }
        );
      }
    }
    await Attempt.deleteOne({ id });
    return Response.json({ ok: true, deleted: id });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not delete the result" },
      { status: 500 }
    );
  }
}
