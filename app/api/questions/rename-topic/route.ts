import { Question } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { queryOf, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const norm = (s: unknown) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
function escapeRegex(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const ci = (s: string) => ({ $regex: "^" + escapeRegex(s) + "$", $options: "i" });

/**
 * PATCH /api/questions/rename-topic?subject=S&from=Old&to=New
 * Admin only. Cascade used when one topic inside a subject is renamed.
 */
export async function PATCH(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const subject = norm(q.get("subject"));
    const from = norm(q.get("from"));
    const to = norm(q.get("to"));
    if (!subject || !from || !to) {
      return Response.json(
        { error: "Query needs ?subject=S&from=OldTopic&to=NewTopic" },
        { status: 400 }
      );
    }
    const r = await Question.updateMany(
      { subject: ci(subject), topic: ci(from) },
      { $set: { topic: to } }
    );
    return Response.json({ ok: true, modified: r.modifiedCount });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not rename the topic's questions" },
      { status: 500 }
    );
  }
}