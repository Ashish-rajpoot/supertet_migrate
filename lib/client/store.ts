/* ===========================================================
   client/store.ts - localStorage persistence
   Same keys and shapes as js/store.js so a device that ran the
   classic site keeps its bank, results, cards and settings.
   =========================================================== */
import type { Attempt, AuthSession, PublicUser, Question, Settings } from "@/lib/types";
import {
  applyAttempt,
  applyAttempts,
  normaliseBook,
  rebuildBook,
  type WrongBook,
} from "@/lib/data/wrong-book";
import { uid } from "./util";

const K = {
  questions: "stp.questions",
  attempts: "stp.attempts",
  settings: "stp.settings",
  cards: "stp.cards",
  hidden: "stp.hidden",
  wrongBook: "stp.wrongBook",
} as const;

/** Session key (token + user), shared with the sync layer. */
export const AUTH_KEY = "stp.auth";
const QUEUE_KEY = "stp.syncQueue";

function read<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as T;
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------------- user questions ---------------- */
export const getQuestions = (): Question[] => read<Question[]>(K.questions, []);
export function setQuestions(list: Question[]) {
  return write(K.questions, list || []);
}

export function addQuestions(list: Question[]) {
  const existing = getQuestions();
  const byId = new Map(existing.map((q) => [String(q.id), q]));
  let added = 0;
  let updated = 0;
  for (const q of list || []) {
    const id = String(q.id);
    if (byId.has(id)) {
      byId.set(id, q);
      updated++;
    } else {
      byId.set(id, q);
      added++;
    }
  }
  setQuestions(Array.from(byId.values()));
  return { added, updated, total: byId.size };
}

/** Replace one device question with an edited copy (seed/visible merge picks it up). */
export function updateQuestion(id: string, patch: Partial<Question>): Question | null {
  const list = getQuestions();
  const i = list.findIndex((q) => String(q.id) === String(id));
  if (i < 0) return null;
  const next = { ...list[i], ...patch, id: String(id) };
  const copy = list.slice();
  copy[i] = next;
  setQuestions(copy);
  return next;
}

/** Cascade helper: rename a subject (optionally one topic) on this device. */
export function renameSubjectOnDevice(from: string, to: string, topic?: string): number {
  const want = String(from || "").trim().toLowerCase();
  const nextName = String(to || "").trim();
  if (!want || !nextName) return 0;
  const wantTopic = topic == null ? null : String(topic).trim().toLowerCase();
  let touched = 0;
  const list = getQuestions().map((q) => {
    if (String(q.subject || "").trim().toLowerCase() !== want) return q;
    if (wantTopic != null && String(q.topic || "").trim().toLowerCase() !== wantTopic) return q;
    touched++;
    return { ...q, subject: nextName };
  });
  if (touched) setQuestions(list);
  return touched;
}

/** Cascade helper: rename one topic (scoped to its subject) on this device. */
export function renameTopicOnDevice(subject: string, from: string, to: string): number {
  const wantS = String(subject || "").trim().toLowerCase();
  const wantT = String(from || "").trim().toLowerCase();
  const nextName = String(to || "").trim();
  if (!wantS || !wantT || !nextName) return 0;
  let touched = 0;
  const list = getQuestions().map((q) => {
    if (String(q.subject || "").trim().toLowerCase() !== wantS) return q;
    if (String(q.topic || "").trim().toLowerCase() !== wantT) return q;
    touched++;
    return { ...q, topic: nextName };
  });
  if (touched) setQuestions(list);
  return touched;
}

/** Cascade helper: delete a whole subject (optionally one topic) on this device. */
export function deleteSubjectOnDevice(subject: string, topic?: string): number {
  const want = String(subject || "").trim().toLowerCase();
  if (!want) return 0;
  const wantTopic = topic == null ? null : String(topic).trim().toLowerCase();
  const before = getQuestions();
  const rest = before.filter((q) => {
    if (String(q.subject || "").trim().toLowerCase() !== want) return true;
    if (wantTopic != null && String(q.topic || "").trim().toLowerCase() !== wantTopic) return true;
    return false;
  });
  if (rest.length !== before.length) setQuestions(rest);
  return before.length - rest.length;
}

/** How many device questions point at a subject (optionally one topic). */
export function countQuestionsOnDevice(subject: string, topic?: string): number {
  const want = String(subject || "").trim().toLowerCase();
  if (!want) return 0;
  const wantTopic = topic == null ? null : String(topic).trim().toLowerCase();
  return getQuestions().filter((q) => {
    if (String(q.subject || "").trim().toLowerCase() !== want) return false;
    if (wantTopic != null && String(q.topic || "").trim().toLowerCase() !== wantTopic) return false;
    return true;
  }).length;
}

export function removeQuestion(id: string) {
  const before = getQuestions();
  const rest = before.filter((q) => String(q.id) !== String(id));
  setQuestions(rest);
  const hidden = read<string[]>(K.hidden, []);
  if (!hidden.includes(String(id))) {
    hidden.push(String(id));
    write(K.hidden, hidden);
  }
  return before.length - rest.length;
}

/** Drop one id from the hidden list (a re-uploaded row resurrects). */
export function unhide(id: string) {
  const hidden = read<string[]>(K.hidden, []);
  const rest = hidden.filter((h) => String(h) !== String(id));
  if (rest.length !== hidden.length) write(K.hidden, rest);
}

/** Drop many ids from the hidden list. */
export function unhideMany(ids: string[]) {
  if (!ids.length) return;
  const drop = new Set(ids.map(String));
  const hidden = read<string[]>(K.hidden, []);
  const rest = hidden.filter((h) => !drop.has(String(h)));
  if (rest.length !== hidden.length) write(K.hidden, rest);
}

export function clearUserQuestions() {
  setQuestions([]);
  write(K.hidden, []);
}

export const getHidden = (): string[] => read<string[]>(K.hidden, []);
export const setHidden = (ids: string[]) => write(K.hidden, ids || []);

/**
 * A stable id for this browser, generated once and kept in localStorage.
 * Signed-out devices send it with their attempts, which is how the server
 * can count "tests on this device" without an account to count against.
 * Clearing site data resets it - the same as forgetting the device.
 */
export function getDeviceId(): string {
  const key = "stp.device";
  const existing = read<string>(key, "");
  if (existing) return existing;
  const id = uid("d");
  write(key, id);
  return id;
}
/* ---------------- attempts (results) ---------------- */

/**
 * One row per attempt id, first position kept, the newest copy winning.
 *
 * A run can reach the store twice: the timer calls finish() and the student
 * presses Finish, and the same attempt id gets added in both. Duplicate ids
 * then break React's list keys in the history table and double-count the
 * progress numbers, so every read funnels through this.
 */
export function dedupeAttempts(list: Attempt[] = []): Attempt[] {
  const out: Attempt[] = [];
  const seen = new Map<string, number>();
  for (const a of list) {
    if (!a) continue;
    const id = String(a.id || "");
    const at = id ? seen.get(id) : undefined;
    if (at != null) {
      out[at] = a;
      continue;
    }
    if (id) seen.set(id, out.length);
    out.push(a);
  }
  return out;
}

export const getAttempts = (): Attempt[] => dedupeAttempts(read<Attempt[]>(K.attempts, []));

/** Save a finished run. The same id replaces its old copy instead of doubling it. */
export function addAttempt(attempt: Attempt) {
  const list = getAttempts();
  const at = list.findIndex((a) => String(a.id) === String(attempt.id));
  if (at >= 0) list[at] = attempt;
  else list.push(attempt);
  write(K.attempts, list.slice(-300)); // keep storage bounded
  // Fold the answers into the mistake book straight away, so the Improve
  // page is right even if the student never reopens their history.
  recordAttemptInBook(attempt);
  return attempt;
}

export function deleteAttempt(id: string) {
  const rest = getAttempts().filter((a) => a.id !== id);
  write(K.attempts, rest);
  // Rebuild from what is left rather than patching counts, so the book
  // can never keep a mistake whose result the student just deleted.
  setWrongBook(rebuildBook(rest));
}

export function clearAttempts() {
  write(K.attempts, []);
  setWrongBook(rebuildBook([]));
}

export const getAttempt = (id: string): Attempt | null =>
  getAttempts().find((a) => a.id === id) || null;

/* ---------------- wrong-answer book (per-question mistakes) ----------------
   A separate tally from stp.attempts: the attempt list is capped at 300
   rows, so a mistake made long ago would silently stop counting. The book
   keeps the lifetime number per question instead, which is what the
   Improve page sorts on. See lib/data/wrong-book.ts. */

/** The device mistake book. Always a well-formed book, never null. */
export function getWrongBook(): WrongBook {
  return normaliseBook(read<unknown>(K.wrongBook, null));
}

export function setWrongBook(book: WrongBook): WrongBook {
  const next = normaliseBook(book);
  write(K.wrongBook, next);
  return next;
}

/**
 * Count one finished run's answers. An attempt id already folded in is
 * skipped, so the timer's auto-submit racing the Finish button (or a
 * sync retry re-saving the same result) cannot inflate a mistake count.
 */
export function recordAttemptInBook(attempt: Attempt): WrongBook {
  const next = applyAttempt(getWrongBook(), attempt);
  setWrongBook(next);
  return next;
}

/**
 * Fold saved results in without wiping what is already there - used when
 * a device pulls its cloud history for the first time.
 */
export function mergeAttemptsInBook(attempts: Attempt[]): WrongBook {
  const next = applyAttempts(getWrongBook(), attempts || []);
  setWrongBook(next);
  return next;
}

/** Drop the book entirely (fresh start, or a student who cleared results). */
export function clearWrongBook() {
  write(K.wrongBook, rebuildBook([]));
}

/* ---------------- flashcard progress (Leitner boxes) ---------------- */
export interface CardState {
  box: number;
  at: number;
}
export const getCards = (): Record<string, CardState> => read(K.cards, {});
export function setCard(id: string, box: number) {
  const all = getCards();
  all[String(id)] = { box: Math.min(5, Math.max(1, box)), at: Date.now() };
  write(K.cards, all);
}
export function resetCards() {
  write(K.cards, {});
}

/* ---------------- settings ---------------- */
export const DEFAULT_SETTINGS: Settings = {
  defaultCount: 20,
  defaultMinutes: 20,
  negativeMarking: 0,
  showExplanation: true,
  shuffleOptions: true,
  name: "",
  apiUrl: "",
  googleClientId: "",
};

/**
 * Bump when a DEFAULT_SETTINGS value changes, so installs that already have
 * stored settings pick up the new default once instead of being stuck on the
 * old value. v2 = shuffleOptions became true by default.
 */
const SETTINGS_VERSION = 2;
const SETTINGS_V_KEY = "stp.settingsV";

export function getSettings(): Settings {
  const stored = read<Partial<Settings>>(K.settings, {});
  const version = read<number>(SETTINGS_V_KEY, 0);
  if (version < SETTINGS_VERSION) {
    write(SETTINGS_V_KEY, SETTINGS_VERSION);
    // Keep everything the user chose; only re-apply the changed default.
    return { ...DEFAULT_SETTINGS, ...stored, shuffleOptions: DEFAULT_SETTINGS.shuffleOptions };
  }
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...(patch || {}) };
  write(K.settings, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("stp:settings", { detail: next }));
  }
  return next;
}
/* ---------------- auth session helpers ---------------- */
export function getAuthSession(): AuthSession | null {
  const s = read<AuthSession | null>(AUTH_KEY, null);
  return s && s.token ? s : null;
}
export function getAuthToken(): string {
  const s = getAuthSession();
  return s ? s.token : "";
}
export function getAuthUser(): PublicUser | null {
  const s = getAuthSession();
  return s ? s.user || null : null;
}
export function setAuthSession(data: AuthSession | null) {
  if (data && data.token && data.user) {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(data));
      if (data.user.name) saveSettings({ name: data.user.name });
    } catch {
      /* quota */
    }
  } else {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("stp:auth", { detail: data }));
  }
}

/* ---------------- offline outbox ---------------- */
export const getSyncQueue = (): Attempt[] => read<Attempt[]>(QUEUE_KEY, []);
export function setSyncQueue(q: Attempt[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota */
  }
}

/* ---------------- offline outbox: question writes ---------------- */

/**
 * A question change the shared bank did not get yet. The device copy is
 * already written, so this is only the "tell the server later" half.
 *
 *   upsert - a question was added or edited (push is an id upsert)
 *   delete - one question was removed
 *   scope  - a whole subject or topic was cleared or re-filed
 *
 * The queue is replayed in insertion order by flushQuestionOutbox() in
 * client/sync.ts, on boot and on the browser's "online" event.
 */
export type OutboxItem =
  | { kind: "upsert"; id: string; question: Question; at: number }
  | { kind: "delete"; id: string; at: number }
  | {
      kind: "scope";
      subject: string;
      topic?: string;
      mode: "delete" | "move";
      moveTo?: string;
      at: number;
    };

/** Guard against a device that stays offline for days filling localStorage. */
const OUTBOX_LIMIT = 200;

const OUTBOX_KEY = "stp.outbox";

export const getOutbox = (): OutboxItem[] => read<OutboxItem[]>(OUTBOX_KEY, []);

export function setOutbox(items: OutboxItem[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    /* quota */
  }
}

/**
 * Remember one change for the next reconnect. An earlier queued change to
 * the same question is dropped rather than replayed twice: the ids make
 * both an upsert and a delete idempotent, so only the final intent matters.
 * Order is otherwise preserved, so a delete that follows an edit still runs
 * after it.
 */
export function enqueueOutbox(item: OutboxItem): number {
  const list = getOutbox();
  const id = item.kind === "scope" ? "" : item.id;
  const kept =
    id && (item.kind === "upsert" || item.kind === "delete")
      ? list.filter((i) => i.kind === "scope" || i.id !== id)
      : list;
  const next = [...kept, item].slice(-OUTBOX_LIMIT);
  setOutbox(next);
  return next.length;
}

/** How many changes are waiting to reach the shared bank. */
export const outboxSize = (): number => getOutbox().length;

/* ---------------- backup / restore ---------------- */
export function exportAll(extra: Record<string, unknown> = {}) {
  return {
    app: "supertet-prep",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    questions: getQuestions(),
    attempts: getAttempts(),
    cards: getCards(),
    hidden: getHidden(),
    ...extra,
  };
}

export function importAll(obj: unknown) {
  if (!obj || typeof obj !== "object") throw new Error("Invalid backup file");
  const o = obj as { questions?: unknown };
  if (Array.isArray(o.questions)) {
    return addQuestions(o.questions as Question[]);
  }
  throw new Error('Backup has no "questions" array');
}

export function usageBytes(): number {
  let total = 0;
  for (const k of Object.values(K)) {
    const v = localStorage.getItem(k);
    if (v) total += v.length;
  }
  return total;
}
