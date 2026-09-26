/* ===========================================================
   data/normalize.ts - question schema, normalisation, loader
   Faithful port of js/data.js: answer parsing, flat/nested row
   support, seed loading from /data, local + server merge.
   =========================================================== */
import type { Difficulty, Question } from "@/lib/types";
import { getHidden, getQuestions } from "@/lib/client/store";
import { fetchQuestions } from "@/lib/client/sync";
import { uid } from "@/lib/client/util";

export const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Answer may be "B", "b", 1 (1-based) or 0 (0-based) -> 0-based index. */
export function answerIndex(ans: unknown, optionCount: number): number {
  if (ans == null || ans === "") return -1;
  if (typeof ans === "number" && isFinite(ans)) {
    const n = Math.round(ans);
    if (n === 0) return optionCount > 0 ? 0 : -1;
    if (n >= 1 && n <= optionCount) return n - 1;
    return -1;
  }
  const s = String(ans).trim();
  const letter = s.toUpperCase().match(/^[A-F]$/);
  if (letter) {
    const i = LETTERS.indexOf(letter[0]);
    return i < optionCount ? i : -1;
  }
  const num = parseInt(s.replace(/[^0-9]/g, ""), 10);
  if (!isNaN(num)) {
    if (num === 0 && optionCount > 0) return 0;
    if (num >= 1 && num <= optionCount) return num - 1;
  }
  return -1;
}

export function optionsOf(q: Question): { hi: string[]; en: string[] } {
  const opts = q.options || {};
  const hi = Array.isArray(opts.hi) ? opts.hi : [];
  const en = Array.isArray(opts.en) ? opts.en : [];
  return { hi, en };
}

export function answerTextOf(q: Question): { hi: string; en: string } {
  const i = q.answerIndex;
  const { hi, en } = optionsOf(q);
  return { hi: i >= 0 ? hi[i] || "" : "", en: i >= 0 ? en[i] || "" : "" };
}

/* ---------------- normalisation ---------------- */

const FIELD_ALIASES: Record<string, string[]> = {
  id: ["id", "qid", "question_id", "ques_id", "sr", "s.no", "sno", "no", "q.no", "number"],
  subject: ["subject", "sub", "section", "paper", "category"],
  topic: ["topic", "chapter", "unit", "subtopic", "tag"],
  difficulty: ["difficulty", "level", "difficulty_level"],
  qH: ["q_hi", "question_hi", "question_hindi", "hindi", "que_hi", "prashn"],
  qE: ["q_en", "question_en", "question_english", "english", "que_en"],
  ans: ["answer", "ans", "correct", "correct_option", "correct_answer", "key", "answer_key", "uttar"],
  explH: ["expl_hi", "explanation_hi", "explain_hi", "sol_hi"],
  explE: ["expl_en", "explanation_en", "explain_en", "sol_en", "explanation", "solution"],
  tags: ["tags", "keywords"],
};

function normKey(k: unknown): string {
  return String(k == null ? "" : k)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function buildKeyMap(row: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawKey of Object.keys(row)) map[normKey(rawKey)] = rawKey;
  return map;
}

function val(
  row: Record<string, unknown>,
  map: Record<string, string>,
  names: string[]
): string {
  for (const n of names) {
    if (map[n] != null) {
      const v = row[map[n]];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

function pickOptions(row: Record<string, unknown>, map: Record<string, string>) {
  const hi: string[] = [];
  const en: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const aliasesH = [`opt${i}_hi`, `option${i}_hi`, `o${i}_hi`, `opt${i}_hindi`];
    const aliasesE = [`opt${i}_en`, `option${i}_en`, `o${i}_en`, `opt${i}_english`];
    const h = val(row, map, aliasesH);
    const e = val(row, map, aliasesE);
    // A numbered option slot only "exists" when at least one side is filled.
    if (h || e) {
      hi.push(h || e);
      en.push(e || h);
    }
  }
  return { hi, en };
}
/**
 * Turn a raw object (JSON, Excel or CSV row) into the canonical schema.
 * Accepts both the flat column layout and the nested JSON layout.
 * Returns { q, errors[] }.
 */
export function normaliseRow(
  row: Record<string, unknown> | null | undefined,
  seq = 1
): { q: Question | null; errors: string[] } {
  const errors: string[] = [];
  if (!row || typeof row !== "object") return { q: null, errors: ["Row is not an object"] };

  // Nested layout: { question: {hi,en} | string, options: {hi[],en[]} | [], answer/answerIndex }
  const nested =
    row.options &&
    typeof row.options === "object" &&
    !Array.isArray(row.options) &&
    (row.question != null || row.q != null) &&
    (row.answer != null || row.answerLetter != null || row.answerIndex != null);
  if (nested) {
    const r = row as Record<string, unknown>;
    const qObj = r.question ?? r.q;
    const qField =
      typeof qObj === "string"
        ? { hi: qObj, en: qObj }
        : {
            hi: String((qObj as Record<string, unknown>)?.hi ?? ""),
            en: String((qObj as Record<string, unknown>)?.en ?? ""),
          };
    const oObj = r.options as Record<string, unknown> | unknown[];
    const oField = Array.isArray(oObj)
      ? { hi: oObj.map(String), en: oObj.map(String) }
      : {
          hi: (((oObj as Record<string, unknown>).hi as unknown[]) || []).map(String),
          en: (((oObj as Record<string, unknown>).en as unknown[]) || []).map(String),
        };
    const eObj = r.explanation;
    const eField =
      eObj == null || typeof eObj === "string"
        ? { hi: String(eObj ?? ""), en: String(eObj ?? "") }
        : {
            hi: String((eObj as Record<string, unknown>)?.hi ?? ""),
            en: String((eObj as Record<string, unknown>)?.en ?? ""),
          };
    const ansRaw = r.answer ?? r.answerIndex ?? r.answerLetter;
    const ai = answerIndex(ansRaw, Math.max(oField.hi.length, oField.en.length));
    // Anything unrecognised falls back to "medium", as in the classic site.
    const diffRaw = String(r.difficulty || "").trim().toLowerCase();
    const difficulty: Difficulty =
      diffRaw === "easy" || diffRaw === "hard" || diffRaw === "medium"
        ? diffRaw
        : "medium";
    const q: Question = {
      id: String(r.id || (r._srcId as string) || uid("q")),
      subject: String(r.subject || r.sub || "General"),
      topic: String(r.topic || "General"),
      difficulty,
      question: qField,
      options: oField,
      answerIndex: ai,
      answerLetter: ai >= 0 ? LETTERS[ai] || "" : "",
      explanation: eField,
      tags: Array.isArray(r.tags)
        ? (r.tags as unknown[]).map(String)
        : String(r.tags || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      source: String(r.source || ""),
      createdBy: String(r.createdBy || ""),
    };
    return { q, errors };
  }

  // Flat layout (spreadsheet columns).
  const map = buildKeyMap(row);
  const idRaw = val(row, map, FIELD_ALIASES.id);
  const subject = val(row, map, FIELD_ALIASES.subject) || "General";
  const topic = val(row, map, FIELD_ALIASES.topic) || "General";
  let difficulty = (val(row, map, FIELD_ALIASES.difficulty) || "medium").toLowerCase();
  if (!["easy", "medium", "hard"].includes(difficulty)) difficulty = "medium";
  const qH = val(row, map, FIELD_ALIASES.qH);
  const qE = val(row, map, FIELD_ALIASES.qE);
  const { hi, en } = pickOptions(row, map);
  const ansRaw = val(row, map, FIELD_ALIASES.ans);
  const ai = answerIndex(ansRaw, Math.max(hi.length, en.length));
  const explH = val(row, map, FIELD_ALIASES.explH);
  const explE = val(row, map, FIELD_ALIASES.explE);
  const tagsRaw = val(row, map, FIELD_ALIASES.tags);

  if (!qH && !qE) errors.push("Row " + seq + ": missing question text (q_hi/q_en)");
  if (hi.length < 2) errors.push("Row " + seq + ": fewer than 2 options");
  if (ai < 0) errors.push("Row " + seq + ": answer does not match any option");

  const q: Question = {
    id: idRaw || uid("q"),
    subject,
    topic,
    difficulty: difficulty as Question["difficulty"],
    question: { hi: qH || qE, en: qE || qH },
    options: { hi, en },
    answerIndex: ai,
    answerLetter: ai >= 0 ? LETTERS[ai] || "" : "",
    explanation: { hi: explH, en: explE || explH },
    tags: tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    source: String((row as Record<string, unknown>).source || ""),
    createdBy: String((row as Record<string, unknown>).createdBy || ""),
  };
  return { q, errors };
}
/* ---------------- loading + merge ---------------- */

let seedCache: Question[] | null = null;

/** Seed questions bundled at /data (public). Rows without an answer are dropped. */
export async function loadSeed(): Promise<Question[]> {
  if (seedCache) return seedCache;
  try {
    const indexRes = await fetch("/data/index.json", { cache: "no-store" });
    // The index is written as { files: [...] }, but accept a bare array too.
    const indexData = await indexRes.json();
    const files: string[] = Array.isArray(indexData) ? indexData : indexData?.files || [];
    const all: Question[] = [];
    for (const f of files || []) {
      try {
        const rows = await (
          await fetch("/data/" + f, { cache: "no-store" })
        ).json();
        (rows || []).forEach((row: Record<string, unknown>, i: number) => {
          const { q } = normaliseRow({ source: "seed", ...row }, i + 1);
          if (q && q.answerIndex >= 0) all.push(q);
        });
      } catch (e) {
        console.warn("seed file failed", f, e);
      }
    }
    seedCache = all;
    return all;
  } catch (e) {
    console.warn("seed index failed", e);
    seedCache = [];
    return seedCache;
  }
}

/** All questions available to the app (seeds + user imports, minus removed). */
export async function getAll(): Promise<Question[]> {
  const seed = await loadSeed();
  const hidden = new Set(getHidden().map(String));
  const user = getQuestions();
  const seen = new Set(
    seed.map((q) => (q.question.hi || q.question.en) + "|" + q.options.hi.join(","))
  );
  const out = seed.filter((q) => !hidden.has(String(q.id)));
  for (const q of user) {
    const k = (q.question.hi || q.question.en) + "|" + q.options.hi.join(",");
    if (seen.has(k)) continue;
    out.push(q);
  }
  return out;
}

/**
 * Merge an extra source of questions (the shared bank) into the local
 * list without duplicating anything. Pure and synchronous.
 */
export function mergeQuestions(
  local: Question[],
  extra: unknown[],
  hiddenIds: string[] = []
): Question[] {
  if (!Array.isArray(extra) || !extra.length) return local || [];
  const hidden = new Set((hiddenIds || []).map(String));
  const out = (local || []).slice();
  const ids = new Set(out.map((q) => String(q.id)));
  const keys = new Set(
    out.map((q) => (q.question.hi || q.question.en) + "|" + q.options.hi.join(","))
  );
  extra.forEach((row) => {
    const { q } = normaliseRow(row as Record<string, unknown>, 1);
    if (!q || q.answerIndex < 0 || hidden.has(String(q.id))) return;
    const key = (q.question.hi || q.question.en) + "|" + q.options.hi.join(",");
    if (ids.has(String(q.id)) || keys.has(key)) return;
    ids.add(String(q.id));
    keys.add(key);
    out.push(q);
  });
  return out;
}

/** All questions: local bank plus the shared server bank when reachable. */
export async function getAllWithServer(): Promise<Question[]> {
  const local = await getAll();
  const extra = await fetchQuestions();
  if (!extra) return local;
  return mergeQuestions(local, extra, getHidden());
}

/** Subject list with counts and topics. */
export async function meta() {
  const all = await getAll();
  const bySubject = new Map<string, { subject: string; count: number; topics: Set<string> }>();
  for (const q of all) {
    if (!bySubject.has(q.subject)) {
      bySubject.set(q.subject, { subject: q.subject, count: 0, topics: new Set() });
    }
    const s = bySubject.get(q.subject)!;
    s.count++;
    s.topics.add(q.topic);
  }
  return {
    total: all.length,
    subjects: Array.from(bySubject.values())
      .map((s) => ({ subject: s.subject, count: s.count, topics: Array.from(s.topics).sort() }))
      .sort((a, b) => a.subject.localeCompare(b.subject)),
  };
}

export function filterQuestions(
  all: Question[],
  {
    subjects = [],
    topics = [],
    difficulty = [],
    onlyIds = null,
  }: {
    subjects?: string[];
    topics?: string[];
    difficulty?: string[];
    onlyIds?: string[] | null;
  } = {}
): Question[] {
  const idSet = onlyIds ? new Set(onlyIds.map(String)) : null;
  return all.filter((q) => {
    if (idSet && !idSet.has(String(q.id))) return false;
    if (subjects.length && !subjects.includes(q.subject)) return false;
    if (topics.length && !topics.includes(q.topic)) return false;
    if (difficulty.length && !difficulty.includes(q.difficulty)) return false;
    return true;
  });
}

export function clearSeedCache() {
  seedCache = null;
}
