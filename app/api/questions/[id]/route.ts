import { Question } from "@/lib/server/models";
import { requireQuestionEditor } from "@/lib/server/auth";
import { readBody, requireDb } from "@/lib/server/api";
import { sanitiseQuestion, validateQuestionDoc } from "@/lib/data/validate";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/questions/:id - edit one question. Admins may edit any
 * question; permitted students only ones they added.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireQuestionEditor(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    const doc = await Question.findOne({ id });
    if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
    if (auth.dbUser.role !== "admin" && doc.createdBy && doc.createdBy !== auth.payload.id) {
      return Response.json(
        { error: "You can only edit questions that you added" },
        { status: 403 }
      );
    }
    const patch = ((await readBody(req)) || {}) as Record<string, unknown>;
    const merged = {
      ...(doc.toObject() as unknown as Record<string, unknown>),
      ...patch,
      id,
    };
    const errors = validateQuestionDoc(merged);
    if (errors.length) {
      return Response.json({ error: errors.join("; "), errors }, { status: 400 });
    }
    for (const [k, v] of Object.entries(sanitiseQuestion(merged))) {
      if (k === "_id" || k === "__v" || k === "id") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc as any).set(k, v);
    }
    await doc.save();
    return Response.json({ ok: true, question: doc });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not update the question" },
      { status: 500 }
    );
  }
}

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
