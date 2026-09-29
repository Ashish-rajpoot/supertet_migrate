import { Question } from "@/lib/server/models";
import { requireAdmin, requireQuestionEditor } from "@/lib/server/auth";
import { queryOf, readBody, requireDb } from "@/lib/server/api";
import { sanitiseQuestion, validateQuestionList } from "@/lib/data/validate";

export const dynamic = "force-dynamic";

/** GET /api/questions - list with optional filters (public read). */
export async function GET(req: Request) {
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const filter: Record<string, string> = {};
    for (const key of ["subject", "topic", "difficulty", "createdBy"]) {
      const v = q.get(key);
      if (v) filter[key] = v.trim();
    }
    const limit = Math.min(parseInt(q.get("limit") || "5000", 10) || 5000, 10000);
    const questions = await Question.find(filter).limit(limit).lean();
    return Response.json({ questions, count: questions.length });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load questions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/questions - bulk upsert. Admins may write anything; permitted
 * students only what they created themselves.
 */
export async function POST(req: Request) {
  const auth = await requireQuestionEditor(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const isAdmin = auth.dbUser.role === "admin";
    // Accepts a bare array or { questions: [...] }.
    const body = await readBody(req);
    const list: unknown = Array.isArray(body)
      ? body
      : (body as { questions?: unknown })?.questions;
    if (!Array.isArray(list) || !list.length) {
      return Response.json(
        { error: "Body must be an array of questions or { questions: [...] }" },
        { status: 400 }
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incoming = (list as any[]).filter((q) => q && q.id && q.answerIndex != null);
    if (!incoming.length) {
      return Response.json({ error: "No valid questions found to save" }, { status: 400 });
    }
    // Wrong rows are reported per-row instead of silently dropping them,
    // so a bad upload tells the uploader exactly what to fix.
    const { valid, problems } = validateQuestionList(incoming);

    let owned = new Map<string, string>();
    if (!isAdmin) {
      const ids = valid.map((q) => String((q as { id: unknown }).id));
      const existing = await Question.find({ id: { $in: ids } })
        .select("id createdBy")
        .lean();
      owned = new Map(existing.map((q) => [String(q.id), q.createdBy || ""]));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = [];
    const skipped: string[] = [];
    for (const raw of valid) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = sanitiseQuestion(raw as Record<string, unknown>) as any;
      const id = String(q.id);
      if (!isAdmin) {
        const owner = owned.get(id);
        if (owner && owner !== auth.payload.id) {
          skipped.push(id);
          continue;
        }
      }
      ops.push({
        updateOne: {
          filter: { id },
          update: {
            $set: {
              ...q,
              id,
              createdBy: isAdmin ? q.createdBy || auth.payload.id : auth.payload.id,
              source: isAdmin ? "admin" : "user",
            },
          },
          upsert: true,
        },
      });
    }

    if (!ops.length) {
      return Response.json(
        {
          error: "Those questions belong to another user. Ask the admin if you need to change them.",
          skipped,
        },
        { status: 403 }
      );
    }
    const result = ops.length ? await Question.bulkWrite(ops) : null;
    return Response.json(
      {
        ok: true,
        upserted: result?.upsertedCount ?? 0,
        modified: result?.modifiedCount ?? 0,
        matched: result?.matchedCount ?? 0,
        total: ops.length,
        skipped,
        invalid: problems,
      },
      { status: 201 }
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not save questions" },
      { status: 500 }
    );
  }
}

/** DELETE /api/questions - clear all (or one subject). Admin only. */
export async function DELETE(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const q = queryOf(req);
    const filter: Record<string, string> = {};
    const subject = q.get("subject");
    if (subject) filter.subject = subject.trim();
    const r = await Question.deleteMany(filter);
    return Response.json({ ok: true, count: r.deletedCount });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not delete questions" },
      { status: 500 }
    );
  }
}
