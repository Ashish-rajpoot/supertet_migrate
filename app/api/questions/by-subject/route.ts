import { Question } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { queryOf, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const norm = (s: unknown) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
function escapeRegex(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const ci = (s: string) => ({ $regex: "^" + escapeRegex(s) + "$", $options: "i" });

/** Questions of one subject - or of one topic inside that subject. */
function filterOf(subject: string, topic: string): Record<string, unknown> {
  const filter: Record<string, unknown> = { subject: ci(subject) };
  if (topic) filter.topic = ci(topic);
  return filter;
}

/**
 * GET /api/questions/by-subject?subject=S[&topic=T]
 * Admin only. How many questions a subject/topic delete would touch -
 * the UI asks for confirmation with this number before deleting.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const subject = norm(q.get("subject"));
    if (!subject) return Response.json({ error: "Query needs ?subject=Name" }, { status: 400 });
    const count = await Question.countDocuments(filterOf(subject, norm(q.get("topic"))));
    return Response.json({ ok: true, count });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not count the questions" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/questions/by-subject?subject=S[&topic=T][&mode=move&moveTo=Other]
 * Admin only. Cascade that runs when a syllabus subject or topic is
 * deleted: mode=delete (the default) removes the questions, mode=move
 * re-files them under ?moveTo= so nothing is lost.
 */
export async function DELETE(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const subject = norm(q.get("subject"));
    const topic = norm(q.get("topic"));
    const mode = norm(q.get("mode")).toLowerCase() === "move" ? "move" : "delete";
    const moveTo = norm(q.get("moveTo"));
    if (!subject) return Response.json({ error: "Query needs ?subject=Name" }, { status: 400 });
    if (mode === "move" && !moveTo) {
      return Response.json({ error: "mode=move needs ?moveTo=Subject name" }, { status: 400 });
    }
    const filter = filterOf(subject, topic);
    if (mode === "move") {
      // Only re-file the subject; when one topic moves, keep it inside
      // the same subject and just rename the topic away.
      const patch = topic ? { topic: moveTo } : { subject: moveTo };
      const r = await Question.updateMany(filter, { $set: patch });
      return Response.json({ ok: true, mode, moved: r.modifiedCount, count: r.modifiedCount });
    }
    const r = await Question.deleteMany(filter);
    return Response.json({ ok: true, mode, count: r.deletedCount });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not delete the subject's questions" },
      { status: 500 }
    );
  }
}