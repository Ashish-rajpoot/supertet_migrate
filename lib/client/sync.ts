/* ===========================================================
   sync.ts - sync layer between localStorage and the /api backend
   Same semantics as js/sync.js: detect the server, sync attempts,
   fetch the shared bank, and queue failed writes for retry.
   =========================================================== */
import type { Attempt, Question, StudentRow, SyllabusSubject } from "@/lib/types";
import {
  getAuthToken,
  getAuthUser,
  getSettings,
  getSyncQueue,
  setSyncQueue,
} from "./store";

export interface ServerStatus {
  online: boolean;
  mongo: boolean;
}

export interface SyncError extends Error {
  status?: number;
  needsVerification?: boolean;
  target?: string;
  devOtp?: string;
}

/**
 * API base: custom URL from settings, else same-origin /api
 * (works with the Next route handlers out of the box).
 */
export function getApiBase(): string {
  if (typeof window === "undefined") return "/api";
  const s = getSettings();
  if (s.apiUrl && String(s.apiUrl).trim()) {
    return String(s.apiUrl).trim().replace(/\/+$/, "");
  }
  return "/api";
}

/** Backend + database reachable? Response shape matches /api/status ({db}). */
export async function checkServerStatus(): Promise<ServerStatus> {
  try {
    const res = await fetch(getApiBase() + "/status", { method: "GET", cache: "no-store" });
    if (!res.ok) return { online: false, mongo: false };
    const data = await res.json();
    return { online: true, mongo: Boolean(data.db ?? data.mongoConnected) };
  } catch {
    return { online: false, mongo: false };
  }
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const token = getAuthToken();
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

/** Turn a failed response into an Error that carries the HTTP status. */
async function errorFrom(res: Response, fallback: string): Promise<SyncError> {
  let msg = fallback || "Server error " + res.status;
  try {
    const data = await res.json();
    if (data && data.error) msg = data.error;
    if (data && data.needsVerification) {
      const err = new Error(msg) as SyncError;
      err.status = res.status;
      err.needsVerification = true;
      err.target = data.target;
      err.devOtp = data.devOtp;
      return err;
    }
  } catch {
    /* not json */
  }
  const err = new Error(msg) as SyncError;
  err.status = res.status;
  return err;
}

/**
 * Send an attempt to the backend. If offline, queue it in localStorage
 * for auto-retry (flushed on 'online' and on boot).
 */
export async function syncAttempt(attempt: Attempt) {
  const s = getSettings();
  const account = getAuthUser();
  const payload = {
    ...attempt,
    student: (s.name && s.name.trim()) || (account && account.name) || "Anonymous",
  };
  try {
    const res = await fetch(getApiBase() + "/attempts", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true, synced: true };
  } catch {
    /* network failure -> queue below */
  }
  const queue = getSyncQueue();
  if (!queue.some((item) => item.id === payload.id)) {
    queue.push(payload);
    setSyncQueue(queue);
  }
  return { ok: true, synced: false, queued: true };
}

/** Retry every queued attempt. */
export async function flushQueue() {
  const queue = getSyncQueue();
  if (!queue.length) return { flushed: 0, remaining: 0 };
  const remaining: Attempt[] = [];
  for (const item of queue) {
    try {
      const res = await fetch(getApiBase() + "/attempts", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(item),
      });
      if (!res.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  setSyncQueue(remaining);
  return { flushed: queue.length - remaining.length, remaining: remaining.length };
}

/** Shared question bank - null when the server is unreachable. */
export async function fetchQuestions(
  filters: { subject?: string; topic?: string; difficulty?: string; limit?: number } = {}
): Promise<Question[] | null> {
  try {
    const params = new URLSearchParams();
    if (filters.subject) params.set("subject", filters.subject);
    if (filters.topic) params.set("topic", filters.topic);
    if (filters.difficulty) params.set("difficulty", filters.difficulty);
    if (filters.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    const res = await fetch(getApiBase() + "/questions" + (qs ? "?" + qs : ""), {
      headers: headers(false),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.questions) ? data.questions : [];
  } catch {
    return null;
  }
}

/**
 * Upsert questions to the shared bank (single or bulk).
 * Admins may write anything; permitted students only their own.
 */
export async function pushQuestions(list: Question | Question[]) {
  const res = await fetch(getApiBase() + "/questions", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(Array.isArray(list) ? list : [list]),
  });
  if (!res.ok) throw await errorFrom(res, "Could not save questions to the server");
  return await res.json();
}

/** Delete one question from the shared bank. */
export async function deleteQuestion(id: string) {
  const res = await fetch(getApiBase() + "/questions/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: headers(false),
  });
  if (!res.ok) throw await errorFrom(res, "Could not delete the question on the server");
  return await res.json();
}

/* ---------------- attempts (results) ---------------- */

/** One full result (public, for shared links). */
export async function fetchAttempt(id: string) {
  try {
    const res = await fetch(getApiBase() + "/attempts/" + encodeURIComponent(id), {
      headers: headers(false),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Attempt list. scope=all or userId need the admin role. */
export async function fetchAttempts(
  opts: { scope?: string; userId?: string; limit?: number } = {}
) {
  const params = new URLSearchParams();
  if (opts.scope) params.set("scope", opts.scope);
  if (opts.userId) params.set("userId", opts.userId);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await fetch(getApiBase() + "/attempts" + (qs ? "?" + qs : ""), {
    headers: headers(false),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not load results from the server");
  return await res.json();
}

/** Delete one result (owner or admin). */
export async function deleteServerAttempt(id: string) {
  const res = await fetch(getApiBase() + "/attempts/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: headers(false),
  });
  if (!res.ok) throw await errorFrom(res, "Could not delete the result on the server");
  return await res.json();
}
/** Clear results: admin clears everyone (?userId= narrows); users clear only theirs. */
export async function clearServerAttempts(userId = "") {
  const params = new URLSearchParams();
  if (userId) params.set("userId", userId);
  const qs = params.toString();
  const res = await fetch(getApiBase() + "/attempts" + (qs ? "?" + qs : ""), {
    method: "DELETE",
    headers: headers(false),
  });
  if (!res.ok) throw await errorFrom(res, "Could not clear results on the server");
  return await res.json();
}

/* ---------------- analytics ---------------- */

/** Admin only: user-wise analytics rows. */
export async function fetchUserAnalytics(): Promise<{ students: StudentRow[]; count: number }> {
  const res = await fetch(getApiBase() + "/analytics/users", {
    headers: headers(false),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not load student analytics");
  return await res.json();
}

/* ---------------- subjects & topics (syllabus) ---------------- */

/** Everyone may read the syllabus. Returns null when unreachable. */
export async function fetchSubjects(): Promise<SyllabusSubject[] | null> {
  try {
    const res = await fetch(getApiBase() + "/subjects", {
      headers: headers(false),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.subjects) ? data.subjects : [];
  } catch {
    return null;
  }
}

/** Admin only: create a subject. Body: { name, nameHi, topics?, order? }. */
export async function saveSubject(payload: Record<string, unknown>) {
  const res = await fetch(getApiBase() + "/subjects", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "Could not save the subject");
  return await res.json();
}

/** Admin only: rename a subject / change its Hindi name or order. */
export async function updateSubject(id: string, patch: Record<string, unknown>) {
  const url = getApiBase() + "/subjects/" + encodeURIComponent(id);
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await errorFrom(res, "Could not update the subject");
  return await res.json();
}

/** Admin only: delete a subject with all of its topics. */
export async function deleteSubject(id: string) {
  const url = getApiBase() + "/subjects/" + encodeURIComponent(id);
  const res = await fetch(url, { method: "DELETE", headers: headers(false) });
  if (!res.ok) throw await errorFrom(res, "Could not delete the subject");
  return await res.json();
}

/** Admin only: add a topic to a subject. Body: { name, nameHi }. */
export async function addTopic(subjectId: string, topic: Record<string, unknown>) {
  const url = getApiBase() + "/subjects/" + encodeURIComponent(subjectId) + "/topics";
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(topic),
  });
  if (!res.ok) throw await errorFrom(res, "Could not add the topic");
  return await res.json();
}

/** Admin only: rename a topic / change its Hindi name. */
export async function updateTopic(
  subjectId: string,
  topicId: string,
  patch: Record<string, unknown>
) {
  const url =
    getApiBase() +
    "/subjects/" +
    encodeURIComponent(subjectId) +
    "/topics/" +
    encodeURIComponent(topicId);
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await errorFrom(res, "Could not update the topic");
  return await res.json();
}

/** Admin only: remove one topic from a subject. */
export async function deleteTopic(subjectId: string, topicId: string) {
  const url =
    getApiBase() +
    "/subjects/" +
    encodeURIComponent(subjectId) +
    "/topics/" +
    encodeURIComponent(topicId);
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw await errorFrom(res, "Could not delete the topic");
  return await res.json();
}
