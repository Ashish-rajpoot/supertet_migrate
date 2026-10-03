import { Attempt, User } from "@/lib/server/models";
import { requireAuth } from "@/lib/server/auth";
import { queryOf, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const norm = (s: unknown): string =>
  String(s == null ? "" : s).trim().replace(/\s+/g, " ");

function escapeRegex(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const ci = (s: string) => ({ $regex: "^" + escapeRegex(s) + "$", $options: "i" });

async function isAdminUser(userId: string | undefined | null): Promise<boolean> {
  if (!userId) return false;
  const user = await User.findOne({ id: userId }).select("role").lean();
  return Boolean(user && user.role === "admin");
}

/** One row the client renders: a question plus how often it was missed. */
interface WrongRow {
  id: string;
  subject: string;
  topic: string;
  difficulty: string;
  question: { hi: string; en: string };
  options: { hi: string[]; en: string[] };
  answerIndex: number;
  explanation: { hi: string; en: string };
  /** Lifetime wrong answers across the matched attempts. */
  wrong: number;
  /** Times it was asked in total, so the page can show a real ratio. */
  asked: number;
  lastWrongAt: number;
}

/**
 * GET /api/attempts/wrong - the questions this student got wrong most,
 * worst first, so "improve this subject" can start with the ones that
 * actually cost them marks.
 *
 *   default          -> own results
 *   ?subject=Name    -> one subject only
 *   ?topic=Name      -> one topic inside it
 *   ?limit=20        -> how many rows (max 200, default 50)
 *   ?userId=..       -> another student's results (admin only)
 *   ?scope=all       -> every student, grouped as-is (admin only)
 *
 * This reads the `details` array of each attempt and groups it per
 * question, which is why the list endpoint (which strips `details` to keep
 * the payload small) cannot answer this question on its own.
 */
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const isAdmin = await isAdminUser(auth.payload.id);
    const wantsAll = q.get("scope") === "all";
    const wantsUser = norm(q.get("userId"));

    if ((wantsAll || wantsUser) && !isAdmin) {
      return Response.json(
        { error: "Only an admin can see other students' results" },
        { status: 403 }
      );
    }

    const attemptFilter: Record<string, unknown> = {};
    if (wantsUser) attemptFilter.userId = wantsUser;
    else if (!wantsAll) attemptFilter.userId = auth.payload.id;
    else attemptFilter.userId = { $nin: ["", null] };

    const detailFilter: Record<string, unknown> = { status: "wrong" };
    const subject = norm(q.get("subject"));
    const topic = norm(q.get("topic"));
    if (subject) detailFilter.subject = ci(subject);
    if (topic) detailFilter.topic = ci(topic);

    const limit = Math.min(parseInt(q.get("limit") || "50", 10) || 50, 200);

    // Group the details of every matching attempt per question. `asked`
    // counts all answers, not just the wrong ones, so the client can show
    // "wrong 4 of 6 times" instead of a bare count.
    const rows = await Attempt.aggregate([
      { $match: attemptFilter },
      { $unwind: "$details" },
      { $match: { ...detailFilter, "details.status": { $in: ["wrong", "correct"] } } },
      {
        $group: {
          _id: "$details.id",
          subject: { $first: "$details.subject" },
          topic: { $first: "$details.topic" },
          difficulty: { $first: "$details.difficulty" },
          question: { $first: "$details.question" },
          options: { $first: "$details.options" },
          answerIndex: { $first: "$details.answerIndex" },
          explanation: { $first: "$details.explanation" },
          wrong: {
            $sum: { $cond: [{ $eq: ["$details.status", "wrong"] }, 1, 0] },
          },
          asked: { $sum: 1 },
          lastWrongAt: { $max: "$at" },
        },
      },
      { $match: { wrong: { $gt: 0 } } },
      // Worst first; the most recent mistake breaks a tie, and the id
      // keeps two equal rows from swapping between requests.
      { $sort: { wrong: -1, lastWrongAt: -1, _id: 1 } },
      { $limit: limit },
    ]);

    const questions: WrongRow[] = rows.map((r) => ({
      id: String(r._id ?? ""),
      subject: String(r.subject ?? ""),
      topic: String(r.topic ?? ""),
      difficulty: String(r.difficulty ?? "medium"),
      question: {
        hi: String(r.question?.hi ?? ""),
        en: String(r.question?.en ?? ""),
      },
      options: {
        hi: Array.isArray(r.options?.hi) ? r.options.hi.map((x: unknown) => String(x)) : [],
        en: Array.isArray(r.options?.en) ? r.options.en.map((x: unknown) => String(x)) : [],
      },
      answerIndex: Number(r.answerIndex ?? -1),
      explanation: {
        hi: String(r.explanation?.hi ?? ""),
        en: String(r.explanation?.en ?? ""),
      },
      wrong: Number(r.wrong || 0),
      asked: Number(r.asked || 0),
      lastWrongAt: Number(r.lastWrongAt || 0),
    }));

    return Response.json({
      questions,
      count: questions.length,
      scope: wantsAll ? "all" : wantsUser ? "user" : "mine",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load your wrong answers" },
      { status: 500 }
    );
  }
}