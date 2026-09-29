/* ===========================================================
   client/auth-client.ts - browser authentication
   Port of js/auth.js. All calls go through the single
   POST /api/auth { action } dispatch endpoint.
   =========================================================== */
import type { AccessStatus, AuthSession, PublicUser } from "@/lib/types";
import { getAuthSession, getAuthUser, setAuthSession } from "./store";
import { getApiBase, type SyncError } from "./sync";

export { getAuthSession, getAuthUser };
export type { SyncError };

/** Small wrapper so network failures surface as readable messages. */
async function api(
  action: string,
  body: Record<string, unknown> = {},
  opts: { token?: string } = {}
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = opts.token ?? getAuthSession()?.token ?? "";
  if (token) headers.Authorization = "Bearer " + token;
  let res: Response;
  try {
    res = await fetch(getApiBase() + "/auth", {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new Error(
      "Cannot reach the server. Check your internet connection or the API URL in settings."
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed") as SyncError;
    err.status = res.status;
    if (data.needsVerification) {
      err.needsVerification = true;
      err.target = data.target;
      err.devOtp = data.devOtp;
    }
    throw err;
  }
  return data;
}

/** Save the session + sync the settings name (mirrors js/auth.js setAuth). */
function saveSession(data: AuthSession | null) {
  setAuthSession(data);
}

export const isLoggedIn = (): boolean => {
  const a = getAuthSession();
  return Boolean(a && a.token && a.user);
};

export const getCurrentUser = (): PublicUser | null => getAuthUser();

export function logout(): void {
  saveSession(null);
}

/** Start registration - returns { target, devOtp } for the OTP step. */
export async function register(input: {
  name: string;
  identifier: string;
  userId: string;
  password: string;
}) {
  return api("register", { ...input });
}
/** Verify an OTP code - saves the session on success. */
export async function verifyOtp(input: { target: string; code: string; type?: string }) {
  const data = await api("verify-otp", { ...input });
  saveSession(data);
  return data;
}

/** Request a fresh OTP code. */
export async function resendOtp(target: string, type = "register") {
  return api("resend-otp", { target, type });
}

/** Password login (email / phone / user id). */
export async function login(input: { identifier: string; password: string }) {
  const data = await api("login-password", { ...input });
  saveSession(data);
  return data;
}

/** Passwordless OTP login. */
export async function loginWithOtp(input: { target: string; code: string }) {
  const data = await api("login-otp", { ...input });
  saveSession(data);
  return data;
}

/** Google ID-token login (credential from Google Identity Services). */
export async function loginWithGoogleCredential(idToken: string) {
  const data = await api("google", { idToken });
  saveSession(data);
  return data;
}

/** Is the signed-in user an admin? */
export function isAdmin(): boolean {
  const u = getCurrentUser();
  return Boolean(u && u.role === "admin");
}

/** Unlimited access: an admin, an admin `unlimited` grant, or a live subscription. */
export function hasFullAccess(user: PublicUser | null = getCurrentUser()): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.unlimited) return true;
  const ts = user.subscriptionExpiresAt ? Date.parse(user.subscriptionExpiresAt) : 0;
  return Number.isFinite(ts) && ts > Date.now();
}

/** May the user add questions? Admins/contributors always; subscribers too. */
export function canAddQuestions(): boolean {
  const u = getCurrentUser();
  if (!u) return false;
  return u.role === "admin" || u.canAddQuestions || hasFullAccess(u);
}

/** Human readable role label for the profile page / header chip. */
export function roleLabel(user: PublicUser | null = getCurrentUser()): string {
  if (!user) return "Guest";
  if (user.role === "admin") return "Admin";
  if (hasFullAccess(user)) return "Subscriber";
  if (user.canAddQuestions) return "Contributor";
  return "Student";
}

/** GET /api/access - the account's plan, quota usage and payment state. */
export async function fetchAccess(): Promise<AccessStatus | null> {
  const session = getAuthSession();
  if (!session || !session.token) return null;
  try {
    const res = await fetch(getApiBase() + "/access", {
      headers: { Authorization: "Bearer " + session.token },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as AccessStatus;
  } catch {
    return null;
  }
}

/** POST /api/access - submit a payment reference for admin approval. */
export async function submitPayment(input: {
  reference: string;
  method: string;
}): Promise<AccessStatus> {
  const session = getAuthSession();
  if (!session || !session.token) throw new Error("Please log in first");
  const res = await fetch(getApiBase() + "/access", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + session.token,
    },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not submit the payment");
  return data as AccessStatus;
}
/** Update the signed-in user's own details. */
export async function updateProfile(patch: Record<string, unknown>) {
  const session = getAuthSession();
  if (!session || !session.token) throw new Error("Please log in first");
  const data = await api("profile", patch, { token: session.token });
  saveSession({ token: session.token, user: data.user });
  return data.user as PublicUser;
}

/** Change the password (needs the current one). */
export async function changePassword(input: { currentPassword: string; newPassword: string }) {
  const session = getAuthSession();
  if (!session || !session.token) throw new Error("Please log in first");
  return api("change-password", { ...input }, { token: session.token });
}

/** Refresh the cached profile from the server (silent check). */
export async function checkSession(): Promise<PublicUser | null> {
  const session = getAuthSession();
  if (!session || !session.token) return null;
  try {
    const data = await api("me", {}, { token: session.token });
    saveSession({ token: session.token, user: data.user });
    return data.user as PublicUser;
  } catch (err) {
    // 401 -> token expired/invalid, log out; anything else (offline) keeps cache.
    if (err && (err as SyncError).status === 401) {
      saveSession(null);
      return null;
    }
    return session.user;
  }
}

/** Admin only: every account, for the permission panel. */
export async function listUsers(): Promise<PublicUser[]> {
  const session = getAuthSession();
  if (!session || !session.token) throw new Error("Please log in first");
  const res = await fetch(getApiBase() + "/auth/users", {
    headers: { Authorization: "Bearer " + session.token },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load users");
  return data.users || [];
}

/** Fields the admin user-management page may send in one PATCH. */
export interface UserPatch {
  name?: string;
  email?: string;
  phone?: string;
  userId?: string;
  password?: string;
  role?: string;
  verified?: boolean;
  canAddQuestions?: boolean;
  /** Admin grant: unlimited tests + uploads, never expires. */
  unlimited?: boolean;
  /** Decide the pending payment: 'approved' extends by 30 days. */
  paymentDecision?: "approved" | "rejected";
  classLevel?: string;
  city?: string;
  school?: string;
  about?: string;
}

/** Admin only: create an account directly (no OTP step, verified by default). */
export async function createUser(input: {
  name?: string;
  email?: string;
  phone?: string;
  userId?: string;
  password: string;
  role?: string;
  verified?: boolean;
  canAddQuestions?: boolean;
}): Promise<PublicUser> {
  const session = getAuthSession();
  if (!session || !session.token) throw new Error("Please log in first");
  const res = await fetch(getApiBase() + "/auth/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + session.token,
    },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not create the user");
  return data.user as PublicUser;
}

/** Admin only: update a user (role, permission or profile fields). */
export async function updateUser(id: string, patch: UserPatch): Promise<PublicUser> {
  const session = getAuthSession();
  if (!session || !session.token) throw new Error("Please log in first");
  const res = await fetch(getApiBase() + "/auth/users/" + encodeURIComponent(id), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + session.token,
    },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not update the user");
  const me = getCurrentUser();
  if (me && data.user && me.id === data.user.id) {
    saveSession({ token: session.token, user: data.user });
  }
  return data.user as PublicUser;
}

/** Back-compat name used by the Questions page permission panel. */
export const updateUserPermissions = updateUser;

/** Admin only: delete an account (your own and the last admin are blocked). */
export async function deleteUser(id: string): Promise<PublicUser> {
  const session = getAuthSession();
  if (!session || !session.token) throw new Error("Please log in first");
  const res = await fetch(getApiBase() + "/auth/users/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: { Authorization: "Bearer " + session.token },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not delete the user");
  return data.user as PublicUser;
}
