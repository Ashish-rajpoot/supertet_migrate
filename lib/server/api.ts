/* ===========================================================
   server/api.ts - tiny helpers shared by every /api route
   - json() ......... JSON response with a status code
   - requireDb() .... connect, or a 503 "offline" response
   - toPublicUser() . strip secrets, mirrors the Mongoose
                      toJSON transform so the client sees
                      exactly what the Express API returned
   =========================================================== */
import { connectDb } from "./db";
import type { UserDoc } from "./models";

/** JSON response shortcut. */
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Connect to Mongo; returns null when connected, else a 503 Response to return. */
export async function requireDb(): Promise<Response | null> {
  try {
    await connectDb();
    return null;
  } catch {
    return Response.json(
      { error: "Database is not reachable. Check MongoDB." },
      { status: 503 }
    );
  }
}

/** Public shape of a user - never leaks passwordHash / salt. */
export function toPublicUser(u: UserDoc) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    userId: u.userId,
    avatar: u.avatar,
    verified: u.verified,
    role: u.role,
    canAddQuestions: u.canAddQuestions,
    classLevel: u.classLevel,
    city: u.city,
    school: u.school,
    about: u.about,
    unlimited: Boolean(u.unlimited),
    subscriptionExpiresAt: u.subscriptionExpiresAt
      ? new Date(u.subscriptionExpiresAt).toISOString()
      : "",
    payment: u.payment?.reference
      ? {
          reference: u.payment.reference,
          method: u.payment.method,
          status: u.payment.status,
          submittedAt: u.payment.submittedAt
            ? new Date(u.payment.submittedAt).toISOString()
            : "",
          decidedAt: u.payment.decidedAt ? new Date(u.payment.decidedAt).toISOString() : "",
        }
      : null,
    contactRequest: u.contactRequest?.value
      ? {
          field: u.contactRequest.field,
          value: u.contactRequest.value,
          status: u.contactRequest.status,
          submittedAt: u.contactRequest.submittedAt
            ? new Date(u.contactRequest.submittedAt).toISOString()
            : "",
          decidedAt: u.contactRequest.decidedAt
            ? new Date(u.contactRequest.decidedAt).toISOString()
            : "",
        }
      : null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : undefined,
  };
}

/** Signed JWT wrapped with the public user profile, like Express login/register. */
export async function sessionFor(user: UserDoc, extra: Record<string, unknown> = {}) {
  const { signToken } = await import("./auth");
  const token = signToken({ id: user.id, email: user.email, role: user.role, ...extra });
  return { token, user: toPublicUser(user) };
}

/** Safely parse a JSON body - null when empty or malformed. */
export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Query string helper for GET handlers. */
export function queryOf(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}
