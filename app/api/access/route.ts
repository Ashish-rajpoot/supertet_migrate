import { Attempt, User } from "@/lib/server/models";
import { requireAuth } from "@/lib/server/auth";
import { readBody, requireDb, toPublicUser } from "@/lib/server/api";
import { FREE_TEST_LIMIT, hasFullAccess } from "@/lib/server/access";
import type { AccessStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The plan summary the client renders (profile card, test gate). */
async function buildStatus(userId: string): Promise<AccessStatus | null> {
  const account = await User.findOne({ id: userId });
  if (!account) return null;
  const pub = toPublicUser(account);
  const used = await Attempt.countDocuments({ userId });
  const full = hasFullAccess(account);
  return {
    fullAccess: full,
    unlimited: pub.unlimited ?? false,
    subscriptionExpiresAt: pub.subscriptionExpiresAt || "",
    testsUsed: used,
    testsFree: FREE_TEST_LIMIT,
    testsRemaining: Math.max(0, FREE_TEST_LIMIT - used),
    canUpload: account.role === "admin" || account.canAddQuestions === true || full,
    payment: pub.payment ?? null,
  };
}

/**
 * GET /api/access - the signed-in account's plan: free-quota usage,
 * subscription state and the latest payment request.
 */
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const status = await buildStatus(auth.payload.id);
    if (!status) return Response.json({ error: "Account no longer exists" }, { status: 401 });
    return Response.json({ ok: true, ...status });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load your plan" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/access - submit a payment request for admin approval.
 * Body: { reference, method }. Overwrites any previous (rejected)
 * request, so a typo can simply be resubmitted.
 */
export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const body = ((await readBody(req)) || {}) as Record<string, unknown>;
    const reference = String(body.reference || "").trim();
    const method = String(body.method || "").trim();
    if (reference.length < 4 || reference.length > 64) {
      return Response.json(
        { error: "Enter the transaction number (4-64 characters)" },
        { status: 400 }
      );
    }
    if (!["upi", "bank", "other"].includes(method)) {
      return Response.json({ error: "method must be 'upi', 'bank' or 'other'" }, { status: 400 });
    }
    const account = await User.findOne({ id: auth.payload.id });
    if (!account) return Response.json({ error: "Account no longer exists" }, { status: 401 });
    // Subscribers have nothing to buy - reject politely.
    if (hasFullAccess(account)) {
      return Response.json(
        { error: "Your account already has full access" },
        { status: 400 }
      );
    }
    account.payment = {
      reference,
      method,
      status: "pending",
      submittedAt: new Date(),
    } as typeof account.payment;
    await account.save();
    const status = await buildStatus(auth.payload.id);
    return Response.json({ ok: true, ...(status || {}) }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not submit the payment" },
      { status: 500 }
    );
  }
}
