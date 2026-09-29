/* ===========================================================
   server/access.ts - the plan / quota rules for the app

   FREE accounts get a one-off quota of saved tests; an active
   subscription (or an admin grant) removes it. Kept as tiny pure
   functions + one counter so the attempt guard, the question
   editor guard and the /api/access endpoint all agree.
   =========================================================== */

/** Tests a signed-in account may save before a subscription is needed. */
export const FREE_TEST_LIMIT = 5;
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

/** Approval adds SUBSCRIPTION_DAYS to whatever is left of the old plan. */
export function extendSubscription(current: Date | string | null | undefined): Date {
  const now = Date.now();
  const ts = current ? new Date(current).getTime() : 0;
  const base = Number.isFinite(ts) && ts > now ? ts : now;
  return new Date(base + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
}
