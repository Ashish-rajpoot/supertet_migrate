import { Question } from "@/lib/server/models";
import { requireQuestionEditor } from "@/lib/server/auth";
import { requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/questions/:id - an admin may remove any question,
 * a permitted student only ones they added.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireQuestionEditor(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    const doc = await Question.findOne({ id }).select("id createdBy").lean();
    if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
    if (auth.dbUser.role !== "admin" && doc.createdBy && doc.createdBy !== auth.payload.id) {
      return Response.json(
        { error: "You can only delete questions that you added" },
        { status: 403 }
      );
    }
    await Question.deleteOne({ id });
    return Response.json({ ok: true, deleted: id });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not delete the question" },
      { status: 500 }
    );
  }
}
