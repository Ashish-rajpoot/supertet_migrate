import { Subject } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { readBody, requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const norm = (s: unknown) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
function escapeRegex(s: string) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/subjects/:id - one subject with its topics. */
export async function GET(_req: Request, { params }: Ctx) {
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    const subject = await Subject.findOne({ id }).lean();
    if (!subject) return Response.json({ error: "Subject not found" }, { status: 404 });
    return Response.json({ subject });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load the subject" },
      { status: 500 }
    );
  }
}

/** PATCH /api/subjects/:id - admin: rename (id stays stable) / reorder. */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    const doc = await Subject.findOne({ id });
    if (!doc) return Response.json({ error: "Subject not found" }, { status: 404 });
    const body = ((await readBody(req)) || {}) as Record<string, unknown>;
    const name = norm(body.name);
    const nameHi = body.nameHi !== undefined ? norm(body.nameHi) : undefined;
    const order = Number.isFinite(Number(body.order)) ? Number(body.order) : null;

    if (name && name.toLowerCase() !== String(doc.name).toLowerCase()) {
      const clash = await Subject.findOne({
        name: { $regex: "^" + escapeRegex(name) + "$", $options: "i" },
      }).lean();
      if (clash) {
        return Response.json({ error: "That subject already exists: " + name }, { status: 409 });
      }
      doc.name = name;
    }
    if (nameHi !== undefined) doc.nameHi = nameHi;
    if (order != null) doc.order = order;
    await doc.save();
    return Response.json({ ok: true, subject: doc });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not rename the subject" },
      { status: 500 }
    );
  }
}

/** DELETE /api/subjects/:id - admin: remove a subject. */
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const { id } = await params;
    const r = await Subject.deleteOne({ id });
    if (!r.deletedCount) return Response.json({ error: "Subject not found" }, { status: 404 });
    return Response.json({ ok: true, deleted: id });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not delete the subject" },
      { status: 500 }
    );
  }
}
