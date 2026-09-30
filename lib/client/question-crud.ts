/* ===========================================================
   lib/client/question-crud.ts - the one way to change questions

   The library, the uploader and the syllabus editor all write the
   same data in two places: the device bank (localStorage) and the
   shared bank (MongoDB through /api/questions). The order matters:
   the device write always happens first so nothing typed is ever
   lost, and the server write is best-effort - it answers with an
   outcome instead of throwing, so a page can say "saved here, the
   server refused" without losing the edit. Same rules the bulk
   uploader follows, in one place instead of three.
   =========================================================== */
import type { Question } from "@/lib/types";
import {
  addQuestions,
  deleteSubjectOnDevice,
  enqueueOutbox,
  removeQuestion,
  renameSubjectOnDevice,
  renameTopicOnDevice,
  updateQuestion,
  type OutboxItem,
} from "./store";
import {
  countSubjectQuestions,
  deleteQuestion as deleteServerQuestion,
  deleteSubjectQuestions,
  pushQuestions,
  updateServerQuestion,
} from "./sync";
import { uid } from "./util";

/** What the shared bank did about a write. */
export type ServerOutcome =
  /** Not asked: no server reachable, or this account may not write. */
  | { status: "off" }
  /** Accepted. */
  | { status: "ok" }
  /** 404 - the row is not in the shared bank (a seed or device-only row). */
  | { status: "missing" }
  /** Refused, with the server's own words. */
  | { status: "error"; message: string };

export interface CrudContext {
  /** Ask the shared bank too? Pages answer with `mongo && canAddQuestions()`. */
  server: boolean;
  /**
   * May this account write to the shared bank at all? Used only to decide
   * whether a change that could not be sent is worth keeping for the next
   * reconnect: a reader must not fill the outbox with writes the server
   * would only refuse. Defaults to `server`, so a caller that omits it
   * behaves exactly as before.
   */
  mayWrite?: boolean;
}

/** A subject - optionally one topic inside it - that a cascade applies to. */
export interface Scope {
  subject: string;
  topic?: string;
}

/** What to do with the questions inside a scope: remove or re-file them. */
export interface ScopeChoice {
  mode: "delete" | "move";
  moveTo?: string;
}

export const messageOf = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : "unknown error";

const statusOf = (err: unknown): number | undefined =>
  (err as { status?: number } | null)?.status;

function outcomeOf(err: unknown): ServerOutcome {
  if (statusOf(err) === 404) return { status: "missing" };
  return { status: "error", message: messageOf(err) };
}

/**
 * True when the request never reached the server (no HTTP status came
 * back) - the device is offline or the API is unreachable. A status means
 * the server did answer, so a refusal is a refusal, not a network problem.
 */
function isOffline(err: unknown): boolean {
  return statusOf(err) === undefined;
}

/**
 * Keep a change for the next reconnect. Skipped when this account may not
 * write anyway, so a plain reader never queues anything. The device copy is
 * already saved, so nothing is lost either way.
 */
function queueForLater(item: OutboxItem, ctx: CrudContext): void {
  if (ctx.mayWrite === false) return;
  enqueueOutbox(item);
}

/** A blank draft, prefilled wherever the caller already knows the answer. */
export function blankQuestion(seed: Partial<Question> = {}): Question {
  return {
    id: uid("q"),
    subject: "",
    topic: "",
    difficulty: "medium",
    question: { hi: "", en: "" },
    options: { hi: ["", ""], en: ["", ""] },
    answerIndex: 0,
    answerLetter: "A",
    explanation: { hi: "", en: "" },
    tags: [],
    ...seed,
  };
}

/** Only the fields the shared bank accepts, so meta never leaks into a patch. */
export function questionPatch(q: Question) {
  return {
    subject: q.subject,
    topic: q.topic,
    difficulty: q.difficulty,
    question: q.question,
    options: q.options,
    answerIndex: q.answerIndex,
    answerLetter: q.answerLetter,
    explanation: q.explanation,
    tags: q.tags,
  };
}

/**
 * One line for a toast, or null when there is nothing to say. Every page
 * uses this so "saved here but not there" reads the same everywhere.
 */
export function outcomeNote(outcome: ServerOutcome, noun = "The question"): string | null {
  if (outcome.status === "ok" || outcome.status === "off") return null;
  if (outcome.status === "missing") {
    return `${noun} is not in the shared bank, so it is saved on this device only`;
  }
  return `${noun} worked on this device only - the shared bank said: ${outcome.message}`;
}


/** Add a brand-new question: on this device, then in the shared bank. */
export async function createQuestion(q: Question, ctx: CrudContext): Promise<ServerOutcome> {
  addQuestions([q]);
  const item: OutboxItem = { kind: "upsert", id: String(q.id), question: q, at: Date.now() };
  if (!ctx.server) {
    queueForLater(item, ctx);
    return { status: "off" };
  }
  try {
    const res = await pushQuestions([q]);
    const invalid = res?.invalid || [];
    const bad = invalid.find((r) => String(r.id) === String(q.id)) || invalid[0];
    if (bad) return { status: "error", message: (bad.errors || []).join(", ") || "invalid row" };
    if ((res?.skipped || []).some((id) => String(id) === String(q.id))) {
      return { status: "error", message: "another account already owns a question with this id" };
    }
    return { status: "ok" };
  } catch (err) {
    // No status = the request never got there. Keep it for the reconnect.
    if (isOffline(err)) {
      queueForLater(item, ctx);
      return { status: "off" };
    }
    return outcomeOf(err);
  }
}

/**
 * Save an edited question. A row that is not in the device bank (a seed row
 * or a shared-only one) is written to the device copy as well, so the fix
 * stays visible even when the shared bank refuses it.
 */
export async function saveQuestion(q: Question, ctx: CrudContext): Promise<ServerOutcome> {
  if (!updateQuestion(q.id, q)) addQuestions([q]);
  const item: OutboxItem = { kind: "upsert", id: String(q.id), question: q, at: Date.now() };
  if (!ctx.server) {
    queueForLater(item, ctx);
    return { status: "off" };
  }
  try {
    await updateServerQuestion(q.id, questionPatch(q));
    return { status: "ok" };
  } catch (err) {
    // A 404 is "not in the shared bank", which an upsert can still fix, so
    // that one is queued too. Anything else the server said is final.
    if (isOffline(err) || statusOf(err) === 404) {
      queueForLater(item, ctx);
      return isOffline(err) ? { status: "off" } : { status: "missing" };
    }
    return outcomeOf(err);
  }
}

/**
 * Delete one question. The device copy always goes; the shared copy goes
 * when this account may write. A 404 is success in disguise - the row was
 * already not in the shared bank.
 */
export async function deleteQuestion(id: string, ctx: CrudContext): Promise<ServerOutcome> {
  removeQuestion(id);
  const item: OutboxItem = { kind: "delete", id: String(id), at: Date.now() };
  if (!ctx.server) {
    queueForLater(item, ctx);
    return { status: "off" };
  }
  try {
    await deleteServerQuestion(id);
    return { status: "ok" };
  } catch (err) {
    if (isOffline(err)) {
      queueForLater(item, ctx);
      return { status: "off" };
    }
    return outcomeOf(err);
  }
}

/** How many shared questions belong to a scope. Zero when it cannot be asked. */
export async function countServerScope(scope: Scope): Promise<number> {
  try {
    return (await countSubjectQuestions(scope.subject, scope.topic)).count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Run a scope cascade over the questions: delete them or re-file them under
 * another name. The shared bank is asked first - when that fails nothing is
 * touched locally either, so the two banks cannot end up half-applied.
 */
export async function applyScopeToQuestions(
  scope: Scope,
  choice: ScopeChoice,
  ctx: CrudContext
): Promise<{ ok: boolean; touched: number; error?: string }> {
  const moveTo = String(choice.moveTo || "").trim();
  if (choice.mode === "move" && !moveTo) {
    return { ok: false, touched: 0, error: "Type the name you want the questions moved to" };
  }
  let touched = 0;
  if (ctx.server) {
    try {
      const res = await deleteSubjectQuestions(scope.subject, {
        topic: scope.topic,
        mode: choice.mode,
        moveTo,
      });
      touched += res.count ?? res.moved ?? 0;
    } catch (err) {
      // Offline: remember the cascade and still do the local half now, so
      // the two banks can never end up half-applied in the other direction.
      // A refusal that came back from the server is final, though.
      if (isOffline(err)) {
        queueForLater(
          {
            kind: "scope",
            subject: scope.subject,
            topic: scope.topic,
            mode: choice.mode,
            moveTo: moveTo || undefined,
            at: Date.now(),
          },
          ctx
        );
      } else {
        return { ok: false, touched, error: messageOf(err) };
      }
    }
  }
  if (choice.mode === "move") {
    touched += scope.topic
      ? renameTopicOnDevice(scope.subject, scope.topic, moveTo)
      : renameSubjectOnDevice(scope.subject, moveTo);
  } else {
    touched += deleteSubjectOnDevice(scope.subject, scope.topic);
  }
  return { ok: true, touched };
}

/** Names are compared the way the server compares them: trimmed, loose on case. */
const norm = (s: unknown): string =>
  String(s == null ? "" : s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/** Does this row belong to `scope`? */
export function inScope(q: Question, scope: Scope): boolean {
  const want = norm(scope.subject);
  if (!want || norm(q.subject) !== want) return false;
  if (scope.topic) return norm(q.topic) === norm(scope.topic);
  return true;
}

/** Every row of a merged bank that belongs to a scope. */
export function rowsInScope(all: Question[], scope: Scope): Question[] {
  return (all || []).filter((q) => inScope(q, scope));
}

/**
 * Finish a scope delete for the rows that live in neither bank: the bundled
 * seed questions (a read-only file the app ships with) and shared rows owned
 * by somebody else. The cascade above cannot reach those, so without this the
 * library would keep listing questions the admin just deleted. Deleting hides
 * them on this device; moving files a device copy under the new name.
 */
export function sweepRowsLocally(all: Question[], scope: Scope, choice: ScopeChoice): number {
  const moveTo = String(choice.moveTo || "").trim();
  if (choice.mode === "move" && !moveTo) return 0;
  const rows = rowsInScope(all, scope);
  for (const row of rows) {
    if (choice.mode === "move") {
      addQuestions([
        { ...row, id: uid("q"), ...(scope.topic ? { topic: moveTo } : { subject: moveTo }) },
      ]);
    }
    removeQuestion(row.id);
  }
  return rows.length;
}
