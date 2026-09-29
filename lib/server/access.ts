/* ===========================================================
   server/access.ts - the plan / quota rules for the app

   FREE accounts get a one-off quota of saved tests; an active
   subscription (or an admin grant) removes it. Signed-out devices
   get a smaller quota of their own, so the app cannot be used as
   an endless free test bank. Kept as tiny pure functions + a
   couple of counters so the attempt guard, the question editor
   guard and the /api/access endpoint all agree.
   =========================================================== */
import { FREE_TEST_LIMIT, GUEST_TEST_LIMIT as GUEST_TEST_DEFAULT } from "@/lib/data/limits";

export { FREE_TEST_LIMIT };

/**
 * Saved tests a signed-out device may keep before an account is
 * needed. Tunable with the GUEST_TEST_LIMIT environment variable;
 * the constant in lib/data/limits.ts is the default the UI shows.
 */
export const GUEST_TEST_LIMIT = ((): number => {
  const raw = Number(process.env.GUEST_TEST_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : GUEST_TEST_DEFAULT;
})();

/** What an approved payment buys, in days. */
export const SUBSCRIPTION_DAYS = 30;

/** The subset of a user document the rules read. */
export interface AccessUser {
  unlimited?: boolean | null;
  subscriptionExpiresAt?: Date | string | null;
}

/**
 * Unlimited access = an admin grant (`unlimited`) or an unexpired
 * paid subscription. No role checks here - callers layer those on.
 */
export function hasFullAccess(u: AccessUser): boolean {
  if (u.unlimited) return true;
  if (!u.subscriptionExpiresAt) return false;
  const ts = new Date(u.subscriptionExpiresAt).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

/**
 * Who never counts against the free-test quota: admins and accounts
 * the admin explicitly allowed to contribute questions are trusted
 * collaborators; subscribers have paid for unlimited runs.
 */
export function isQuotaExempt(u: AccessUser & { role?: string; canAddQuestions?: boolean }): boolean {
  return u.role === "admin" || u.canAddQuestions === true || hasFullAccess(u);
}

/** Saved attempts of one account (local-only attempts never reach this). */
export async function countAttempts(userId: string): Promise<number> {
  const { Attempt } = await import("./models");
  return Attempt.countDocuments({ userId });
}

/**
 * Saved attempts of one signed-out device, matched by the device id
 * the client stores locally. This is what stops a guest from taking
 * an endless run of tests just because nobody is logged in.
 */
export async function countGuestAttempts(deviceId: string): Promise<number> {
  const id = String(deviceId || "").trim();
  if (!id) return 0;
  const { Attempt } = await import("./models");
  return Attempt.countDocuments({ userId: "", deviceId: id });
}

/** Approval adds SUBSCRIPTION_DAYS to whatever is left of the old plan. */
export function extendSubscription(current: Date | string | null | undefined): Date {
  const now = Date.now();
  const ts = current ? new Date(current).getTime() : 0;
  const base = Number.isFinite(ts) && ts > now ? ts : now;
  return new Date(base + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
}
