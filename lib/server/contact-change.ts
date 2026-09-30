/* ===========================================================
   lib/server/contact-change.ts - the only writer of a contact field.

   Phone and email are both login identifiers, so every write goes
   through this one function: the admin edit form, and the approval
   of a pending change request. Keeping them together is the point -
   a request must not become a second, weaker way to set a number
   that skips the clash check or the "would lock the user out" check.

   Returns an error message, or null when the value was applied.
   =========================================================== */
import { User } from "./models";
import {
  isValidEmail,
  isValidPhone,
  normaliseEmail,
  normalisePhone,
} from "@/lib/contact";

export type ContactField = "phone" | "email";

/** A user document, kept loose so callers can .save() it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseUser = any;

export async function applyContactChange(
  user: LooseUser,
  field: ContactField,
  rawValue: string,
  opts: { allowEmpty?: boolean } = {}
): Promise<string | null> {
  const value = field === "phone" ? normalisePhone(rawValue) : normaliseEmail(rawValue);

  if (!value) {
    if (!opts.allowEmpty) {
      return field === "phone" ? "Enter a valid phone number" : "Enter a valid email address";
    }
    // Clearing is allowed (an admin may be removing a bad contact), but
    // the account has to keep some way in.
    if (!user.email && !user.phone && !user.googleId && !user.passwordHash) {
      return "This account would have no way to sign in. Set an email or phone first.";
    }
    user[field] = "";
    return null;
  }

  if (field === "phone" && !isValidPhone(value)) return "Enter a valid phone number";
  if (field === "email" && !isValidEmail(value)) return "Enter a valid email address";

  if (value === user[field]) return null; // already this value

  const clash = await User.findOne({ [field]: value, id: { $ne: user.id } }).select("id").lean();
  if (clash) {
    return field === "phone"
      ? "This phone number is already registered"
      : "This email is already registered";
  }

  // On a Google-linked account the email is Google's to own. Changing it
  // would move the account away from the identity that signs in, so it
  // is not something a request or an admin edit can do.
  if (field === "email" && user.googleId) {
    return "This account signs in with Google, so its email cannot be changed.";
  }

  user[field] = value;
  return null;
}
