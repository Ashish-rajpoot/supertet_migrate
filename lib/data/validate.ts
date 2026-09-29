/* ===========================================================
   data/validate.ts - pure validation for canonical questions
   No browser or database imports, so both the client (upload
   preview, library editor) and the /api routes can use it and
   report the SAME per-row errors for a wrong upload.
   =========================================================== */
import type { Question } from "@/lib/types";

export interface QuestionProblems {
  /** 0-based row number inside the uploaded batch. */
  index: number;
  id: string;
  errors: string[];
}

const DIFFICULTIES = ["easy", "medium", "hard"];

const nonEmpty = (v: unknown): boolean => String(v == null ? "" : v).trim().length > 0;

function optionsOf(q: Record<string, unknown>): { hi: string[]; en: string[] } {
  const o = (q.options || {}) as { hi?: unknown; en?: unknown };
  const hi = Array.isArray(o.hi) ? o.hi.map((s) => String(s == null ? "" : s).trim()) : [];
  const en = Array.isArray(o.en) ? o.en.map((s) => String(s == null ? "" : s).trim()) : [];
  return { hi, en };
}

/** Every reason one canonical question object is not saveable. */
export function validateQuestionDoc(q: Record<string, unknown> | null | undefined): string[] {
  const errors: string[] = [];
  if (!q || typeof q !== "object") return ["row is not an object"];
  if (!nonEmpty(q.id)) errors.push("missing id");
  if (!nonEmpty(q.subject)) errors.push("missing subject");
  if (!nonEmpty(q.topic)) errors.push("missing topic");
  if (q.difficulty != null && String(q.difficulty).trim() !== "") {
    const d = String(q.difficulty).trim().toLowerCase();
    if (!DIFFICULTIES.includes(d)) {
      errors.push(`difficulty "${String(q.difficulty).trim()}" must be easy, medium or hard`);
    }
  }
  const stem = (q.question || {}) as { hi?: unknown; en?: unknown };
  if (!nonEmpty(stem.hi) && !nonEmpty(stem.en)) {
    errors.push("question text is empty (fill q_hi and/or q_en)");
  }
  const { hi, en } = optionsOf(q);
  const filled = Math.max(
    hi.filter(Boolean).length,
    en.filter(Boolean).length
  );
  if (filled < 2) errors.push(`only ${filled} option(s) filled - at least 2 options are required`);
  const slots = Math.max(hi.length, en.length);
  const ai = q.answerIndex;
  if (typeof ai !== "number" || !Number.isInteger(ai) || ai < 0 || ai >= Math.max(slots, 1)) {
    const letter = (q as { answerLetter?: unknown }).answerLetter;
    errors.push(
      `answer "${nonEmpty(letter) ? String(letter) : String(ai)}" does not point at one of the ${slots} option(s)`
    );
  }
  return errors;
}

/** Split an uploaded batch into saveable rows and per-row problems. */
export function validateQuestionList(list: unknown[]): {
  valid: Record<string, unknown>[];
  problems: QuestionProblems[];
} {
  const valid: Record<string, unknown>[] = [];
  const problems: QuestionProblems[] = [];
  (list || []).forEach((row, index) => {
    const errors = validateQuestionDoc(row as Record<string, unknown>);
    if (!errors.length) {
      valid.push(row as Record<string, unknown>);
    } else {
      const id = (row as { id?: unknown })?.id;
      problems.push({ index, id: nonEmpty(id) ? String(id) : `row ${index + 1}`, errors });
    }
  });
  return { valid, problems };
}

/** A saveable canonical row with normalised difficulty + letter. */
export function sanitiseQuestion(q: Record<string, unknown>): Record<string, unknown> {
  const letters = ["A", "B", "C", "D", "E", "F"];
  const d = String(q.difficulty || "medium").trim().toLowerCase();
  const ai = q.answerIndex as number;
  return {
    ...q,
    id: String(q.id).trim(),
    subject: String(q.subject || "").trim(),
    topic: String(q.topic || "").trim(),
    difficulty: (DIFFICULTIES.includes(d) ? d : "medium") as Question["difficulty"],
    answerLetter: letters[ai] || "",
  };
}
