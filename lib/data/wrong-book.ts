/* ===========================================================
   data/wrong-book.ts - per-question mistake memory

   The attempt list already carries every answer a student ever
   gave (details[] inside each attempt), but the local store keeps
   only the newest 300 attempts and the questions themselves may be
   re-filed or removed later. This module keeps its own tally, so
   "how many times did I get this one wrong" survives all of that.

   Pure functions only - no DOM, no database. client/store.ts
   persists the result, addAttempt() folds every finished run in,
   and the Improve page reads it back.

   Rules the rest of the app relies on:
     - the wrong count is LIFETIME. Getting it right later does not
       erase it; it only clears the wrong streak.
     - a skipped question is tracked but never counts as a mistake.
     - one attempt id is folded in at most once, so re-syncing the
       same result can never inflate a count.
   =========================================================== */
import type { Attempt, Bi } from "@/lib/types";

/** What we remember about one question the student has seen. */
export interface WrongEntry {
  id: string;
  subject: string;
  topic: string;
  difficulty: string;
  /** Snapshot of the question text, kept so the list still reads
   *  after the question itself is renamed or removed from the bank. */
  question: Bi;
  options: { hi: string[]; en: string[] };
  answerIndex: number;
  explanation: Bi;
  /** Lifetime times answered wrongly - the number the app sorts on. */
  wrong: number;
  correct: number;
  skipped: number;
  /** Wrong answers in a row; reset by a correct answer. */
  streak: number;
  lastWrongAt: number;
  lastSeenAt: number;
}

/** The whole device book plus the attempt ids already folded into it. */
export interface WrongBook {
  /** Attempt ids already counted, so a duplicate save cannot double them. */
  applied: string[];
  entries: Record<string, WrongEntry>;
}

export const EMPTY_BOOK: WrongBook = { applied: [], entries: {} };

/** How many applied attempt ids to remember. The local attempt list
 *  keeps 300, so matching that keeps the guard useful without growing
 *  localStorage forever. */
const APPLIED_LIMIT = 400;

function biOf(value: unknown): Bi {
  const b = (value || {}) as { hi?: unknown; en?: unknown };
  return { hi: String(b.hi ?? ""), en: String(b.en ?? "") };
}

function optionsOf(value: unknown): { hi: string[]; en: string[] } {
  const o = (value || {}) as { hi?: unknown; en?: unknown };
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "")) : [];
  return { hi: list(o.hi), en: list(o.en) };
}

function str(value: unknown): string {
  return String(value ?? "");
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const loose = (s: unknown): string => str(s).trim().toLowerCase().replace(/\s+/g, " ");

/** A well-formed book, whatever (or nothing) was stored. */
export function normaliseBook(raw: unknown): WrongBook {
  const b = (raw || {}) as { applied?: unknown; entries?: unknown };
  const entries: Record<string, WrongEntry> = {};
  const src = (b.entries || {}) as Record<string, WrongEntry>;
  for (const [id, e] of Object.entries(src)) {
    if (!e || typeof e !== "object") continue;
    entries[id] = {
      id: String(e.id ?? id),
      subject: str(e.subject),
      topic: str(e.topic),
      difficulty: str(e.difficulty) || "medium",
      question: biOf(e.question),
      options: optionsOf(e.options),
      answerIndex: num(e.answerIndex),
      explanation: biOf(e.explanation),
      wrong: num(e.wrong),
      correct: num(e.correct),
      skipped: num(e.skipped),
      streak: num(e.streak),
      lastWrongAt: num(e.lastWrongAt),
      lastSeenAt: num(e.lastSeenAt),
    };
  }
  const applied = Array.isArray(b.applied) ? b.applied.map(str).filter(Boolean) : [];
  return { applied, entries };
}
/**
 * Fold one finished attempt into the book. Idempotent: an attempt id
 * that was already counted is ignored, so the double submit of a run
 * (timer and Finish button) or a sync retry cannot inflate a mistake.
 */
export function applyAttempt(book: WrongBook, attempt: Attempt): WrongBook {
  const id = str(attempt?.id);
  if (!id) return book;
  if (book.applied.includes(id)) return book;

  const at = num(attempt.at) || num(attempt.finishedAt) || Date.now();
  const entries = { ...book.entries };

  for (const d of attempt.details || []) {
    const qid = str(d?.id);
    if (!qid) continue;
    const prev = entries[qid];
    // A question seen for the first time snapshots its wording, so the
    // list still reads after the question is renamed or deleted. An
    // already-known entry keeps its original snapshot.
    const base: WrongEntry = prev ?? {
      id: qid,
      subject: str(d.subject),
      topic: str(d.topic),
      difficulty: str(d.difficulty) || "medium",
      question: biOf(d.question),
      options: optionsOf(d.options),
      answerIndex: num(d.answerIndex),
      explanation: biOf(d.explanation),
      wrong: 0,
      correct: 0,
      skipped: 0,
      streak: 0,
      lastWrongAt: 0,
      lastSeenAt: 0,
    };
    const entry: WrongEntry = {
      ...base,
      // Never lose a subject or topic a newer copy is missing.
      subject: str(d.subject) || base.subject,
      topic: str(d.topic) || base.topic,
      lastSeenAt: at,
    };
    if (d.status === "wrong") {
      entry.wrong = base.wrong + 1;
      entry.streak = base.streak + 1;
      entry.lastWrongAt = at;
    } else if (d.status === "correct") {
      entry.correct = base.correct + 1;
      // The lifetime wrong count stays; only the run of misses resets.
      entry.streak = 0;
    } else {
      entry.skipped = base.skipped + 1;
    }
    entries[qid] = entry;
  }

  return {
    applied: [...book.applied, id].slice(-APPLIED_LIMIT),
    entries,
  };
}

/** Fold a whole list in, oldest first, skipping ids already counted. */
export function applyAttempts(book: WrongBook, attempts: Attempt[]): WrongBook {
  return (attempts || []).reduce((acc, a) => applyAttempt(acc, a), book);
}

/** Build a book from scratch out of the saved attempts. */
export function rebuildBook(attempts: Attempt[]): WrongBook {
  return applyAttempts(EMPTY_BOOK, attempts || []);
}
export interface WorstFilter {
  /** "" or empty = every subject. One or many, matched any-of. */
  subject?: string | string[];
  /** "" or empty = every topic inside the subject(s). One or many. */
  topic?: string | string[];
  /** How many rows to return. */
  limit?: number;
  /** Keep only questions with at least this many mistakes (default 1). */
  minWrong?: number;
}

/** A single value, or the several given, all lower-cased. */
const wants = (v: string | string[] | undefined): string[] =>
  [v ?? ""]
    .flat()
    .map((x) => loose(x))
    .filter(Boolean);

/**
 * The questions worth re-practising, worst first. Only questions the
 * student actually got wrong at least once are returned - a question
 * answered correctly every time is not what "improve" is about.
 *
 * Several subjects/topics mean "any of", matching the repeated query
 * parameters the API takes.
 *
 * Order: lifetime wrong count desc, then the most recent mistake, then
 * the question id so two equal rows never swap between renders.
 */
export function worstQuestions(book: WrongBook, filter: WorstFilter = {}): WrongEntry[] {
  const wantSubjects = wants(filter.subject);
  const wantTopics = wants(filter.topic);
  const minWrong = filter.minWrong == null ? 1 : Math.max(0, filter.minWrong);
  const limit = filter.limit == null ? 50 : Math.max(0, filter.limit);

  return listEntries(book)
    .filter((e) => e.wrong > 0 && e.wrong >= minWrong)
    .filter((e) => !wantSubjects.length || wantSubjects.includes(loose(e.subject)))
    .filter((e) => !wantTopics.length || wantTopics.includes(loose(e.topic)))
    .sort(
      (a, b) =>
        b.wrong - a.wrong ||
        b.lastWrongAt - a.lastWrongAt ||
        String(a.id).localeCompare(String(b.id))
    )
    .slice(0, limit);
}

export interface SubjectMistakeRow {
  subject: string;
  /** Questions inside this subject that were missed at least once. */
  questions: number;
  /** Total wrong answers across those questions. */
  wrong: number;
  /** True when nothing was ever missed in the subject. */
  untouched: boolean;
}

/**
 * One row per subject for the "improve a subject" picker: subjects the
 * student has mistakes in, worst first. A subject answered correctly
 * every time is flagged `untouched` so the UI can still offer it
 * without putting it at the top of the list.
 */
export function subjectMistakes(book: WrongBook): SubjectMistakeRow[] {
  const m = new Map<string, { questions: number; wrong: number }>();
  for (const e of listEntries(book)) {
    const key = e.subject || "General";
    if (!m.has(key)) m.set(key, { questions: 0, wrong: 0 });
    const row = m.get(key)!;
    row.wrong += e.wrong;
    if (e.wrong > 0) row.questions += 1;
  }
  return Array.from(m.entries())
    .map(([subject, v]) => ({ subject, ...v, untouched: v.questions === 0 }))
    .sort(
      (a, b) =>
        b.wrong - a.wrong ||
        b.questions - a.questions ||
        String(a.subject).localeCompare(String(b.subject))
    );
}

/** Every subject name the book knows, mistakes or not. */
export function knownSubjects(book: WrongBook): string[] {
  return Array.from(new Set(listEntries(book).map((e) => e.subject || "General"))).sort();
}

/** Every topic inside the given subject(s), mistakes or not. */
export function knownTopics(book: WrongBook, subject?: string | string[]): string[] {
  const want = wants(subject);
  return Array.from(
    new Set(
      listEntries(book)
        .filter((e) => !want.length || want.includes(loose(e.subject)))
        .map((e) => e.topic || "General")
    )
  ).sort();
}

/** Forget one question - used when it is removed from the bank. */
export function forgetQuestion(book: WrongBook, questionId: string): WrongBook {
  const id = String(questionId);
  if (!book.entries?.[id]) return book;
  const entries = { ...book.entries };
  delete entries[id];
  return { ...book, entries };
}

/** Forget every question of a subject, or of one topic inside it. */
export function forgetScope(book: WrongBook, subject: string, topic?: string): WrongBook {
  const wantS = loose(subject);
  const wantT = topic == null ? null : loose(topic);
  if (!wantS) return book;
  const entries: Record<string, WrongEntry> = {};
  for (const [id, e] of Object.entries(book.entries || {})) {
    const sameSubject = loose(e.subject) === wantS;
    const sameTopic = wantT == null || loose(e.topic) === wantT;
    if (sameSubject && sameTopic) continue;
    entries[id] = e;
  }
  return { ...book, entries };
}

/** Totals for the page header: questions seen, questions missed, misses. */
export function bookTotals(book: WrongBook): {
  questions: number;
  missed: number;
  wrong: number;
  correct: number;
  skipped: number;
} {
  const rows = listEntries(book);
  let wrong = 0;
  let correct = 0;
  let skipped = 0;
  let missed = 0;
  for (const e of rows) {
    wrong += e.wrong;
    correct += e.correct;
    skipped += e.skipped;
    if (e.wrong > 0) missed += 1;
  }
  return { questions: rows.length, missed, wrong, correct, skipped };
}

/** Every entry as a list. */
export function listEntries(book: WrongBook): WrongEntry[] {
  return Object.values(book.entries || {});
}

/** How many times each question was answered wrongly, ever. */
export function wrongCount(book: WrongBook, questionId: string): number {
  return book.entries?.[String(questionId)]?.wrong || 0;
}

/** One question, or null when it was never seen. */
export function entryOf(book: WrongBook, questionId: string): WrongEntry | null {
  return book.entries?.[String(questionId)] || null;
}