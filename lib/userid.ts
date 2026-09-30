/* ===========================================================
   lib/userid.ts - deriving a clean, stable, login-able user id.

   The user id is the permanent public handle for an account:
   attempts, the analytics roster and the admin panel all key off
   it, so it is set once at creation and never changes.

   Historically the default was the whole email address
   ("rani@gmail.com"). That looks wrong in the profile, is longer
   than the field allows, and contains "@" - a character the
   validation pattern below rejects - so the default silently
   produced ids that no user could have typed by hand.

   deriveUserId turns an email or phone into the part a person
   would recognise: the local part of the address, cleaned up.
   "Rani Sharma@gmail.com" -> "rani.sharma".
   =========================================================== */

export const USER_ID_RE = /^[a-z0-9_.]{3,30}$/;
const MIN = 3;
const MAX = 30;

/** Short, stable, non-cryptographic hash - only used to break ties. */
function fingerprint(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Clean one candidate into the allowed shape: lowercase, only
 * letters/digits/._, no doubled or edge separators, and within
 * the length bounds. Returns "" when nothing usable is left.
 */
export function normaliseUserId(raw: string): string {
  let s = String(raw || "")
    .trim()
    .toLowerCase();
  // Runs of anything else collapse to a single dot, so "rani sharma"
  // and "rani+sharma" both read as "rani.sharma".
  s = s.replace(/[^a-z0-9]+/g, ".");
  s = s.replace(/\.{2,}/g, ".").replace(/^\.+|\.+$/g, "");
  if (!s) return "";
  // Must start and end on a letter or digit.
  s = s.replace(/^\.+/, "").replace(/\.+$/, "");
  if (!s) return "";
  if (s.length > MAX) s = s.slice(0, MAX).replace(/\.+$/, "");
  return s;
}

/** Is this a user id we are willing to store? */
export function isValidUserId(value: string): boolean {
  return USER_ID_RE.test(value);
}

/**
 * The id an account gets when nobody picks one: the recognisable
 * part of the email, or the digits of the phone.
 */
export function deriveUserId(identifier: string): string {
  const value = String(identifier || "").trim().toLowerCase();
  if (!value) return "";
  const at = value.indexOf("@");
  // A leading "@" means there is no local part (the caller normally rejects
  // such an address first); fall back to cleaning the whole string rather
  // than slicing from index 0, so the result is still a legal id.
  const local = at > 0 ? value.slice(0, at) : value;
  let base = normaliseUserId(local);
  // Too short to be a legal id ("ab@gmail.com"): pad deterministically
  // so the same address always maps to the same id.
  if (base.length < MIN) {
    const pad = fingerprint(value);
    base = normaliseUserId(base + pad);
    if (base.length < MIN) base = (base || "u") + fingerprint(value).slice(0, 3);
  }
  return base.slice(0, MAX);
}

/**
 * deriveUserId plus a uniqueness check, so two people whose addresses
 * clean down to the same handle ("rani@gmail.com" and "rani@yahoo.com")
 * still get separate accounts. `exists` reports whether a candidate is
 * already taken; the server passes a database lookup.
 */
export async function uniqueUserId(
  identifier: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = deriveUserId(identifier);
  if (!base) return "";
  if (!(await exists(base))) return base;
  for (let n = 2; n <= 999; n++) {
    // Keep room for the suffix, and land on a clean character boundary.
    const room = MAX - String(n).length;
    const stem = base.slice(0, room).replace(/\.+$/, "");
    const candidate = `${stem}${n}`;
    if (isValidUserId(candidate) && !(await exists(candidate))) return candidate;
  }
  // Practically unreachable; never hand back a duplicate though.
  return `${base.slice(0, MAX - 7)}${fingerprint(base).slice(0, 6)}`;
}
