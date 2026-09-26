import { pingDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** GET /api/status - server + database health, like Express /api/status. */
export async function GET() {
  const db = await pingDb();
  return Response.json({ ok: true, db, time: new Date().toISOString() });
}
