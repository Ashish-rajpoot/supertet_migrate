import { Subject, slugify } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { readBody, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** Collapse whitespace so "Maths" and " Maths " are the same subject. */
const norm = (s: unknown) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");

function escapeRegex(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive lookup for the "already exists" checks. */
async function findByName(name: string) {
  const n = norm(name);
  if (!n) return null;
  return Subject.findOne({ name: { $regex: "^" + escapeRegex(n) + "$", $options: "i" } }).lean();
}

/** A slug no other subject is using (maths, maths-2, maths-3, ...). */
async function uniqueSubjectId(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 2; i < 500; i++) {
    const candidate = i === 2 ? base : base + "-" + i;
    const clash = await Subject.findOne({ id: candidate }).select("id").lean();
    if (!clash) return candidate;
  }
  return base + "-" + Date.now();
}

/** Read a subject payload from the body, every field trimmed. */
function readSubjectBody(body: Record<string, unknown> | null) {
  const b = (body || {}) as Record<string, unknown>;
  const name = norm(b.name);
  const nameHi = norm(b.nameHi);
  const order = Number.isFinite(Number(b.order)) ? Number(b.order) : undefined;
  const topicsRaw = Array.isArray(b.topics) ? (b.topics as unknown[]) : [];
  const topics = topicsRaw
    .map((t) => {
      const o = (t || {}) as Record<string, unknown>;
      return { name: norm(o.name), nameHi: norm(o.nameHi) };
    })
    .filter((t) => t.name);
  return { name, nameHi, order, topics };
}

/** Topic id is deterministic inside its subject: maths--percentage. */
function topicIdFor(subjectId: string, name: string, taken: Set<string>): string {
  const base = subjectId + "--" + slugify(name);
  let candidate = base;
  for (let i = 2; taken.has(candidate); i++) candidate = base + "-" + i;
  return candidate;
}

/** GET /api/subjects - every subject in display order (public). */
export async function GET() {
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const subjects = await Subject.find({}).sort({ order: 1, name: 1 }).lean();
    return Response.json({ subjects, count: subjects.length });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load subjects" },
      { status: 500 }
    );
  }
}

/** POST /api/subjects - admin: add a subject with optional topics. */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { name, nameHi, order, topics } = readSubjectBody(await readBody(req));
    if (!name) return Response.json({ error: "Subject name is required" }, { status: 400 });
    if (await findByName(name)) {
      return Response.json({ error: "That subject already exists: " + name }, { status: 409 });
    }
    const id = await uniqueSubjectId(name);
    const taken = new Set<string>();
    const doc = new Subject({
      id,
      name,
      nameHi,
      order: order != null ? order : 0,
      createdBy: auth.payload.id,
      topics: topics.map((t) => {
        const tid = topicIdFor(id, t.name, taken);
        taken.add(tid);
        return { id: tid, name: t.name, nameHi: t.nameHi };
      }),
    });
    await doc.save();
    return Response.json({ ok: true, subject: doc }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not add the subject" },
      { status: 500 }
    );
  }
}
