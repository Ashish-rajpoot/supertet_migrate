/* ===========================================================
   data/limits.ts - the free allowances, in one place

   The API enforces these, the UI explains them. Keeping the
   numbers here means the test gate and the plan card can never
   disagree with the server about what "used up" means. The server
   may still override the guest limit with the GUEST_TEST_LIMIT
   environment variable.
   =========================================================== */

/** Saved tests a signed-out device may keep before it must sign in. */
export const GUEST_TEST_LIMIT = 3;

/** Tests a signed-in account may save before a subscription is needed. */
export const FREE_TEST_LIMIT = 5;
