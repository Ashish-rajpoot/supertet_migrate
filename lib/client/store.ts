/* ===========================================================
   client/store.ts - localStorage persistence
   Same keys and shapes as js/store.js so a device that ran the
   classic site keeps its bank, results, cards and settings.
   =========================================================== */
import type { Attempt, AuthSession, PublicUser, Question, Settings } from "@/lib/types";

const K = {
  questions: "stp.questions",
  attempts: "stp.attempts",
  settings: "stp.settings",
  cards: "stp.cards",
  hidden: "stp.hidden",
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

export function clearUserQuestions() {
  setQuestions([]);
  write(K.hidden, []);
}

export const getHidden = (): string[] => read<string[]>(K.hidden, []);
export const setHidden = (ids: string[]) => write(K.hidden, ids || []);
/* ---------------- attempts (results) ---------------- */
export const getAttempts = (): Attempt[] => read<Attempt[]>(K.attempts, []);

export function addAttempt(attempt: Attempt) {
  const list = getAttempts();
  list.push(attempt);
  write(K.attempts, list.slice(-300)); // keep storage bounded
  return attempt;
}

export function deleteAttempt(id: string) {
  write(
    K.attempts,
    getAttempts().filter((a) => a.id !== id)
  );
}

export function clearAttempts() {
  write(K.attempts, []);
}

export const getAttempt = (id: string): Attempt | null =>
  getAttempts().find((a) => a.id === id) || null;

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
