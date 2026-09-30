/* ===========================================================
   lib/contact.ts - normalising the two ways to reach an account.

   Email and phone are both login identifiers here, so the value we
   store has to be canonical: the same person typing
   "Rani.Sharma@Gmail.com " and "98765 43210" must always produce
   the same string, or the uniqueness checks silently miss and two
   accounts end up sharing one phone number.

   That was a live bug. The old pattern, /^\\+?[0-9]{10,14}$/,
   accepts all of these:

       9876543210        +919876543210      009876543210
       98765 43210       98765432101234

   ...so an account could be created for 9876543210 and another for
   +919876543210. findOne({ phone }) then matches only one of them,
   and an OTP sent to that number signs in whichever comes first.
   =========================================================== */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Digits only, with an optional single leading +. */
const PHONE_RE = /^\+?[0-9]{10,14}$/;

export const EMAIL_MAX = 120;
export const PHONE_MAX = 20;
export const NAME_MAX = 80;

/** Canonical email: trimmed and lowercased. Gmail ignores dots and case. */
export function normaliseEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= EMAIL_MAX && EMAIL_RE.test(email);
}

/**
 * Canonical phone: drop every separator, turn a leading 00 into +, and
 * keep a bare national number as-is. "+919876543210" and
 * "009876543210" both become "+919876543210"; "9876543210" stays
 * "9876543210" so a national number is still recognisable.
 */
export function normalisePhone(raw: string): string {
  // Keep digits and at most one leading +; drop every other separator.
  let p = String(raw || "").replace(/[^\d+]/g, "");
  p = p.replace(/(?!^)\++/g, "");
  if (p === "+") return "";
  // 00 is the international access prefix: 0091... == +91...
  if (/^00\d/.test(p)) p = `+${p.slice(2)}`;
  if (p.startsWith("+")) {
    const d = p.slice(1).replace(/^0+/, "");
    p = d ? `+${d}` : "";
  } else {
    // A national number written with a trunk prefix (09876543210) is the
    // same number as 9876543210, so drop the leading zero.
    p = p.replace(/^0+/, "");
  }
  return p;
}

export function isValidPhone(phone: string): boolean {
  return phone.length > 0 && phone.length <= PHONE_MAX && PHONE_RE.test(phone);
}

/** A human-friendly rendering for the admin list, e.g. "+91 98765 43210". */
export function formatPhone(phone: string): string {
  const p = normalisePhone(phone);
  if (!p) return "";
  if (p.startsWith("+")) {
    const d = p.slice(1);
    return `+${d.slice(0, 2)} ${d.slice(2, 7)} ${d.slice(7)}`.trim();
  }
  return `${p.slice(0, 5)} ${p.slice(5)}`.trim();
}
