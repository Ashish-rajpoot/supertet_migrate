/* ===========================================================
   server/bootstrap-admin.ts - creates the very first admin
   Port of server/bootstrap-admin.js. Default credentials:
     email:    ADMIN_EMAIL    or admin@gmail.com
     password: ADMIN_PASSWORD or admin@123
   Called lazily from connectDb() and by `npm run seed`, so a
   fresh database always has an admin that can sign in without
   the OTP flow. Never overwrites an existing password.
   =========================================================== */
import crypto from "node:crypto";
import mongoose from "mongoose";
import { User } from "./models";
import { hashPassword } from "./auth";

export function defaultAdminEmail(): string {
  return String(process.env.ADMIN_EMAIL || "admin@gmail.com").trim().toLowerCase();
}

export function defaultAdminPassword(): string {
  return String(process.env.ADMIN_PASSWORD || "admin@123");
}

/** Ensure the default admin exists (role / flags repaired, never the password). */
export async function ensureDefaultAdmin() {
  if (mongoose.connection.readyState !== 1) return null;

  const email = defaultAdminEmail();
  if (!email || !email.includes("@")) return null;
  const password = defaultAdminPassword();

  const existing = await User.findOne({ email });
  if (existing) {
    let dirty = false;
    if (existing.role !== "admin") {
      existing.role = "admin";
      dirty = true;
    }
    if (!existing.canAddQuestions) {
      existing.canAddQuestions = true;
      dirty = true;
    }
    if (!existing.verified) {
      existing.verified = true;
      dirty = true;
    }
    if (!existing.passwordHash) {
      const { hash, salt } = hashPassword(password);
      existing.passwordHash = hash;
      existing.salt = salt;
      dirty = true;
    }
    if (dirty) {
      await existing.save();
      console.log(`[admin] Repaired default admin flags for ${email}`);
    }
    return existing;
  }

  const { hash, salt } = hashPassword(password);
  const user = new User({
    id: "u_" + crypto.randomUUID(),
    name: "Site Admin",
    email,
    // The email doubles as the login id so it can never collide with the
    // user id another account picked at registration (e.g. "admin").
    userId: email,
    passwordHash: hash,
    salt,
    verified: true,
    role: "admin",
    canAddQuestions: true,
  });
  await user.save();
  console.warn(`[admin] Created default admin account: ${email}`);
  console.warn('[admin] Password comes from ADMIN_PASSWORD env (default "admin@123").');
  return user;
}
