import { Question } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { queryOf, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const norm = (s: unknown) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
function escapeRegex(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Case-insensitive whole-string match, so "GK & GS" == "gk & gs". */
const ci = (s: string) => ({ $regex: "^" + escapeRegex(s) + "$", $options: "i" });

/**
 * PATCH /api/questions/rename-subject?from=Old&to=New[&topic=T]
 * Admin only. Cascade used when a syllabus subject is renamed: every
 * question that points at the old subject name is moved to the new one
 * (pass &topic= to only move the questions of one topic).
 */
export async function PATCH(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const from = norm(q.get("from"));
    const to = norm(q.get("to"));
    const topic = norm(q.get("topic"));
    if (!from || !to) {
      return Response.json({ error: "Query needs ?from=Old&to=New" }, { status: 400 });
    }
    const filter: Record<string, unknown> = { subject: ci(from) };
    if (topic) filter.topic = ci(topic);
    const r = await Question.updateMany(filter, { $set: { subject: to } });
    return Response.json({ ok: true, modified: r.modifiedCount });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not rename the subject's questions" },
      { status: 500 }
    );
  }
}