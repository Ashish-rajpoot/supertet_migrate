import { Subject } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { readBody, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const norm = (s: unknown) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");

type Ctx = { params: Promise<{ id: string; topicId: string }> };

/** PATCH /api/subjects/:id/topics/:topicId - admin: rename a topic. */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  void auth;
  try {
    const { id, topicId } = await params;
    const doc = await Subject.findOne({ id });
    if (!doc) return Response.json({ error: "Subject not found" }, { status: 404 });
    const topic = doc.topics.find((t: { id: string }) => t.id === topicId);
    if (!topic) return Response.json({ error: "Topic not found" }, { status: 404 });
    const body = ((await readBody(req)) || {}) as Record<string, unknown>;
    const name = norm(body.name);
    if (name) {
      const dup = doc.topics.some(
        (t: { id: string; name: string }) =>
          t.id !== topic.id && t.name.toLowerCase() === name.toLowerCase()
      );
      if (dup) {
        return Response.json(
          { error: "That topic is already in this subject: " + name },
          { status: 409 }
        );
      }
      topic.name = name;
    }
    if (body.nameHi !== undefined) topic.nameHi = norm(body.nameHi);
    await doc.save();
    return Response.json({ ok: true, subject: doc });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not rename the topic" },
      { status: 500 }
    );
  }
}

/** DELETE /api/subjects/:id/topics/:topicId - admin: remove a topic. */
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  void auth;
  try {
    const { id, topicId } = await params;
    const doc = await Subject.findOne({ id });
    if (!doc) return Response.json({ error: "Subject not found" }, { status: 404 });
    const before = doc.topics.length;
    doc.topics = doc.topics.filter((t: { id: string }) => t.id !== topicId);
    if (doc.topics.length === before) {
      return Response.json({ error: "Topic not found" }, { status: 404 });
    }
    await doc.save();
    return Response.json({ ok: true, subject: doc, removed: topicId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not delete the topic" },
      { status: 500 }
    );
  }
}
