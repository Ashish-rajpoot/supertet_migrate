import { Subject, slugify } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { readBody, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const norm = (s: unknown) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");

function topicIdFor(subjectId: string, name: string, taken: Set<string>): string {
  const base = subjectId + "--" + slugify(name);
  let candidate = base;
  for (let i = 2; taken.has(candidate); i++) candidate = base + "-" + i;
  return candidate;
}

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/subjects/:id/topics - admin: add a topic. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  void auth;
  try {
    const { id } = await params;
    const doc = await Subject.findOne({ id });
    if (!doc) return Response.json({ error: "Subject not found" }, { status: 404 });
    const body = ((await readBody(req)) || {}) as Record<string, unknown>;
    const name = norm(body.name);
    if (!name) return Response.json({ error: "Topic name is required" }, { status: 400 });
    const dup = doc.topics.some(
      (t: { name: string }) => t.name.toLowerCase() === name.toLowerCase()
    );
    if (dup) {
      return Response.json(
        { error: "That topic is already in this subject: " + name },
        { status: 409 }
      );
    }
    const taken = new Set(doc.topics.map((t: { id: string }) => t.id));
    const topic = { id: topicIdFor(doc.id, name, taken), name, nameHi: norm(body.nameHi) };
    doc.topics.push(topic);
    await doc.save();
    return Response.json({ ok: true, subject: doc, topic }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not add the topic" },
      { status: 500 }
    );
  }
}
