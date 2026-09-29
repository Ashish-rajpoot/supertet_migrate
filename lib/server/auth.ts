/* ===========================================================
   server/auth.ts - password hashing, JWT + OTP helpers
   Ported 1:1 from server/auth-util.js (scrypt, self-contained
   HS256 token, 30-day expiry). Only the token source differs:
   Next Request headers instead of the Express req object.
   =========================================================== */
import crypto from "node:crypto";
import { connectDb } from "./db";
import { hasFullAccess } from "./access";

const JWT_SECRET = process.env.JWT_SECRET || "supertet-secret-key-change-in-prod-123!";

export interface TokenPayload {
  id: string;
  email: string;
  role: string;
  exp: number;
  [key: string]: unknown;
}

/** Hash a password with a fresh salt using native Node scrypt. */
export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

/** Verify a password against a stored hash + salt. */
export function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  if (!password || !salt || !storedHash) return false;
  try {
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(storedHash, "hex"));
  } catch {
    return false;
  }
}

/** Create a self-contained JWT valid for 30 days by default. */
export function signToken(
  payload: Record<string, unknown>,
  expiresInSeconds = 30 * 24 * 3600
): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

/** Verify a self-contained JWT - null when missing / tampered / expired. */
export function verifyToken(token: string | null | undefined): TokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  if (expectedSig !== signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

/** Generate a 6-digit numeric OTP. */
export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
/** Bearer token from a Next Request - Authorization header first, cookie fallback. */
export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  const cookie = req.headers.get("cookie") || "";
  const match = /(?:^|;\s*)token=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Decoded JWT payload, or null when no readable token is present. */
export function getAuthPayload(req: Request): TokenPayload | null {
  const token = getBearerToken(req);
  return token ? verifyToken(token) : null;
}

export interface AuthContext {
  payload: TokenPayload;
  // The hydrated Mongoose user document; kept loose on purpose so routes
  // can call .save() without importing the model type everywhere.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbUser: any;
}

/**
 * Guard: the caller must be signed in. Returns an AuthContext, or a
 * Response error that the route handler must return to the client.
 */
export async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const payload = getAuthPayload(req);
  if (!payload) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  // The connection is opened lazily and `bufferCommands` is off, so a query
  // issued before it resolves throws. Always await it first.
  await connectDb();
  const { User } = await import("./models");
  const dbUser = await User.findOne({ id: payload.id });
  if (!dbUser) {
    return Response.json({ error: "Account no longer exists" }, { status: 401 });
  }
  return { payload, dbUser };
}

/**
 * Guard: signed in AND admin. Role is re-read from the database so
 * promotions / demotions apply instantly (same rule as Express).
 */
export async function requireAdmin(req: Request): Promise<AuthContext | Response> {
  const payload = getAuthPayload(req);
  if (!payload) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    await connectDb();
    const { User } = await import("./models");
    const dbUser = await User.findOne({ id: payload.id });
    if (!dbUser || dbUser.role !== "admin") {
      return Response.json(
        { error: "Admin permission is required for this action" },
        { status: 403 }
      );
    }
    return { payload, dbUser };
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not verify admin permission" },
      { status: 500 }
    );
  }
}

/**
 * Guard for question editors: an admin, a student the admin
 * explicitly allowed with `canAddQuestions`, or an active
 * subscriber (`unlimited` grant / unexpired subscription).
 * Express requireQuestionEditor + the subscription tier.
 */
export async function requireQuestionEditor(req: Request): Promise<AuthContext | Response> {
  const payload = getAuthPayload(req);
  if (!payload) {
    return Response.json({ error: "Please log in to add or change questions" }, { status: 401 });
  }
  try {
    await connectDb();
    const { User } = await import("./models");
    const dbUser = await User.findOne({ id: payload.id });
    if (!dbUser) {
      return Response.json({ error: "Your account no longer exists" }, { status: 401 });
    }
    const allowed =
      dbUser.role === "admin" ||
      dbUser.canAddQuestions === true ||
      hasFullAccess(dbUser);
    if (!allowed) {
      return Response.json(
        {
          error:
            "You do not have permission to add questions. Ask the admin, or subscribe for full access.",
        },
        { status: 403 }
      );
    }
    return { payload, dbUser };
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not verify your permission" },
      { status: 500 }
    );
  }
}

