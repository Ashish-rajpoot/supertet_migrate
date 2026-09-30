/* ===========================================================
   sync.ts - sync layer between localStorage and the /api backend
   Same semantics as js/sync.js: detect the server, sync attempts,
   fetch the shared bank, and queue failed writes for retry.
   =========================================================== */
import type { Attempt, Question, StudentRow, SyllabusSubject } from "@/lib/types";
import {
  getAuthToken,
  getAuthUser,
  getDeviceId,
  getOutbox,
  getSettings,
  getSyncQueue,
  setOutbox,
  setSyncQueue,
  type OutboxItem,
} from "./store";

export interface ServerStatus {
  online: boolean;
  mongo: boolean;
}

/** POST /api/questions - what a bulk upload came back with. */
export interface PushResult {
  ok?: boolean;
  upserted?: number;
  modified?: number;
  total?: number;
  /** Rows that belong to another user, so they were left alone. */
  skipped?: string[];
  /** Rows the server refused, with the same messages the preview gives. */
  invalid?: { index: number; id: string; errors: string[] }[];
}

export interface SyncError extends Error {
  status?: number;
  needsVerification?: boolean;
  target?: string;
  devOtp?: string;
  /** 403 from the free-tier quota: subscribe before saving more tests. */
  needsSubscription?: boolean;
  /** 403 from the guest quota: this device's free tests are used up. */
  needsSignIn?: boolean;
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
  let needsSubscription = false;
  let needsSignIn = false;
  try {
    const data = await res.json();
    if (data && data.error) msg = data.error;
    if (data && data.needsSubscription) needsSubscription = true;
    if (data && data.needsSignIn) needsSignIn = true;
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
  if (needsSubscription) err.needsSubscription = true;
  if (needsSignIn) err.needsSignIn = true;
  return err;
}

/** The HTTP status of a failed call, or undefined when it never got there. */
const statusOf = (err: unknown): number | undefined => (err as SyncError | null)?.status;

/**
 * Send an attempt to the backend. If offline, queue it in localStorage
 * for auto-retry (flushed on 'online' and on boot). A free-tier refusal
 * is NOT queued - retrying would fail forever until the plan changes -
 * so the caller gets the message and can send the user to subscribe.
 */
export async function syncAttempt(attempt: Attempt) {
  const s = getSettings();
  const account = getAuthUser();
  const payload: Attempt = {
    ...attempt,
    // The device id is what a signed-out quota is counted against.
    deviceId: attempt.deviceId || getDeviceId(),
    student: (s.name && s.name.trim()) || (account && account.name) || "Anonymous",
  };
  try {
    const res = await fetch(getApiBase() + "/attempts", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true, synced: true };
    // A refusal (guest or free-tier quota, bad payload) is NOT queued -
    // retrying would fail forever until the user signs in or subscribes.
    if (res.status >= 400 && res.status < 500) {
      const err = await errorFrom(res, "Could not save the result");
      return { ok: false, synced: false, blocked: true, error: err.message };
    }
  } catch {
    /* network failure -> queue below */
  }
  const queue = getSyncQueue();
  if (!queue.some((item) => item.id === payload.id)) {
    queue.push(payload);
    setSyncQueue(queue);
  }
  return { ok: true, synced: false, queued: true, blocked: false };
}

/**
 * Retry every queued attempt. A refusal - the guest or free-tier quota,
 * or a payload the server rejects - drops the item from the queue instead
 * of retrying it forever; the local copy on the device is always kept, so
 * nothing is lost.
 */
export async function flushQueue() {
  const queue = getSyncQueue();
  if (!queue.length) return { flushed: 0, remaining: 0, blocked: 0 };
  const remaining: Attempt[] = [];
  let blocked = 0;
  for (const item of queue) {
    try {
      const res = await fetch(getApiBase() + "/attempts", {
        method: "POST",
        headers: headers(),
        // Queued from an older version: stamp the device id before sending.
        body: JSON.stringify(item.deviceId ? item : { ...item, deviceId: getDeviceId() }),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) blocked++;
        else remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }
  setSyncQueue(remaining);
  return {
    flushed: queue.length - remaining.length - blocked,
    remaining: remaining.length,
    blocked,
  };
}

/**
 * Replay the question outbox: every question change made while the shared
 * bank was unreachable, in the order it was made. Called on boot and on the
 * browser's "online" event, so edits made offline (or during a server
 * restart) reach MongoDB as soon as the connection is back.
 *
 *   - a change the server accepts, or that is already true there
 *     (deleting a row it never had), is done and forgotten
 *   - a change the server refuses outright (4xx) is dropped, so one bad row
 *     cannot wedge every later change behind it forever
 *   - a change that could not be sent stays for the next attempt
 *
 * Every operation is idempotent (an upsert by id, a delete by id, a scope
 * cascade by name), so a duplicate replay is harmless.
 */
export async function flushQuestionOutbox(): Promise<{
  flushed: number;
  remaining: number;
  dropped: number;
}> {
  const queue = getOutbox();
  if (!queue.length) return { flushed: 0, remaining: 0, dropped: 0 };
  const remaining: OutboxItem[] = [];
  let flushed = 0;
  let dropped = 0;

  for (const item of queue) {
    try {
      if (item.kind === "upsert") {
        await pushQuestions([item.question]);
      } else if (item.kind === "delete") {
        try {
          await deleteQuestion(item.id);
        } catch (err) {
          // 404 = the row is not in the shared bank, which is the state the
          // delete wanted anyway.
          if (statusOf(err) !== 404) throw err;
        }
      } else {
        await deleteSubjectQuestions(item.subject, {
          topic: item.topic,
          mode: item.mode,
          moveTo: item.moveTo,
        });
      }
      flushed += 1;
    } catch (err) {
      const status = statusOf(err);
      if (status && status >= 400 && status < 500) {
        dropped += 1;
        continue;
      }
      // Still offline, or the server is down: keep it for the next try.
      remaining.push(item);
    }
  }

  setOutbox(remaining);
  return { flushed, remaining: remaining.length, dropped };
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
export async function pushQuestions(list: Question | Question[]): Promise<PushResult> {
  const res = await fetch(getApiBase() + "/questions", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(Array.isArray(list) ? list : [list]),
  });
  if (!res.ok) throw await errorFrom(res, "Could not save questions to the server");
  return (await res.json()) as PushResult;
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

/** Edit one shared question (PATCH /api/questions/:id). */
export async function updateServerQuestion(id: string, patch: Record<string, unknown>) {
  const res = await fetch(getApiBase() + "/questions/" + encodeURIComponent(id), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await errorFrom(res, "Could not update the question");
  return await res.json();
}

/**
 * Cascade-rename a subject on the shared bank. Returns how many
 * questions the server moved. Admin only.
 */
export async function renameSubjectQuestions(from: string, to: string, topic?: string) {
  const params = new URLSearchParams({ from, to });
  if (topic) params.set("topic", topic);
  const res = await fetch(getApiBase() + "/questions/rename-subject?" + params.toString(), {
    method: "PATCH",
    headers: headers(false),
  });
  if (!res.ok) throw await errorFrom(res, "Could not rename the subject's questions");
  return (await res.json()) as { ok: boolean; modified: number };
}

/**
 * Cascade-rename a topic inside a subject on the shared bank.
 * Returns how many questions the server moved. Admin only.
 */
export async function renameTopicQuestions(subject: string, from: string, to: string) {
  const params = new URLSearchParams({ subject, from, to });
  const res = await fetch(getApiBase() + "/questions/rename-topic?" + params.toString(), {
    method: "PATCH",
    headers: headers(false),
  });
  if (!res.ok) throw await errorFrom(res, "Could not rename the topic's questions");
  return (await res.json()) as { ok: boolean; modified: number };
}

/**
 * How many shared questions belong to a subject (optionally one topic).
 * Used to tell the admin what a delete would remove. Admin only.
 */
export async function countSubjectQuestions(subject: string, topic?: string) {
  const params = new URLSearchParams({ subject });
  if (topic) params.set("topic", topic);
  const res = await fetch(getApiBase() + "/questions/by-subject?" + params.toString(), {
    headers: headers(false),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not count the subject's questions");
  return (await res.json()) as { ok: boolean; count: number };
}

/**
 * Cascade-delete a subject (optionally one topic) from the shared bank.
 * `move` re-files the questions under another name instead of deleting
 * them. Returns how many questions the server touched. Admin only.
 */
export async function deleteSubjectQuestions(
  subject: string,
  opts: { topic?: string; mode?: "delete" | "move"; moveTo?: string } = {}
) {
  const params = new URLSearchParams({ subject });
  if (opts.topic) params.set("topic", opts.topic);
  if (opts.mode === "move" && opts.moveTo) {
    params.set("mode", "move");
    params.set("moveTo", opts.moveTo);
  }
  const res = await fetch(getApiBase() + "/questions/by-subject?" + params.toString(), {
    method: "DELETE",
    headers: headers(false),
  });
  if (!res.ok) throw await errorFrom(res, "Could not delete the subject's questions");
  return (await res.json()) as { ok: boolean; count: number; moved?: number };
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
