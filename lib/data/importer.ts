/* ===========================================================
   data/importer.ts - read .xlsx / .csv / .json banks in the browser
   Port of js/importer.js, but SheetJS comes from the `xlsx` npm
   package instead of a CDN script tag.
   =========================================================== */
import type { Question } from "@/lib/types";

/** The exact column layout accepted by the bank. */
export const SHEET_COLUMNS = [
  "id",
  "subject",
  "topic",
  "difficulty",
  "q_hi",
  "q_en",
  "opt1_hi",
  "opt2_hi",
  "opt3_hi",
  "opt4_hi",
  "opt1_en",
  "opt2_en",
  "opt3_en",
  "opt4_en",
  "answer",
  "expl_hi",
  "expl_en",
  "tags",
];

type XlsxLike = typeof import("xlsx");

let xlsxPromise: Promise<XlsxLike> | null = null;

/** Lazily load SheetJS (client only, first Excel/CSV/template use). */
export function loadSheetJS(): Promise<XlsxLike> {
  if (!xlsxPromise) xlsxPromise = import("xlsx");
  return xlsxPromise;
}

/** Parse one uploaded file into an array of flat row objects. */
export async function parseFile(file: File): Promise<Record<string, unknown>[]> {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".json")) return parseJsonText(await file.text(), file.name);
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    try {
      const XLSX = await loadSheetJS();
      const wb = XLSX.read(text, { type: "string" });
      return sheetToRows(XLSX, wb);
    } catch {
      return parseCsvText(text);
    }
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
    const XLSX = await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    return sheetToRows(XLSX, wb);
  }
  const text = await file.text();
  try {
    return parseJsonText(text, file.name);
  } catch {
    return parseCsvText(text);
  }
}

function sheetToRows(XLSX: XlsxLike, wb: import("xlsx").WorkBook) {
  const rows: Record<string, unknown>[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
    for (const r of json) rows.push(r);
  }
  return rows;
}
/** Any of: a JSON array, { questions: [] }, or { Subject: [..] } buckets. */
export function parseJsonText(text: string, fileName = "upload.json") {
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.questions)) return o.questions as Record<string, unknown>[];
    const out: Record<string, unknown>[] = [];
    for (const k of Object.keys(o)) {
      if (Array.isArray(o[k])) {
        (o[k] as Record<string, unknown>[]).forEach((q) =>
          out.push({ subject: k, ...q })
        );
      }
    }
    if (out.length) return out;
    return [o];
  }
  throw new Error("Unrecognised JSON in " + fileName);
}

/** Minimal CSV reader (handles quotes) for when SheetJS is unavailable. */
export function parseCsvText(text: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c === "\r") {
      /* skip */
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((v) => String(v).trim() !== ""))
    .map((r) => {
      const o: Record<string, unknown> = {};
      header.forEach((h, i) => {
        if (h) o[h] = r[i] == null ? "" : r[i];
      });
      return o;
    });
}
/** Download a ready-to-fill Excel template. */
export async function downloadTemplate() {
  const XLSX = await loadSheetJS();
  const example = [
    {
      id: "gk-101",
      subject: "GK & GS",
      topic: "Important Days",
      difficulty: "easy",
      q_hi: "राष्ट्रीय युवा दिवस कब मनाया जाता है?",
      q_en: "When is National Youth Day celebrated?",
      opt1_hi: "10 जनवरी",
      opt2_hi: "12 जनवरी",
      opt3_hi: "15 जनवरी",
      opt4_hi: "24 जनवरी",
      opt1_en: "10 January",
      opt2_en: "12 January",
      opt3_en: "15 January",
      opt4_en: "24 January",
      answer: "B",
      expl_hi: "12 जनवरी को स्वामी विवेकानंद का जन्मदिन है।",
      expl_en: "12 January is Swami Vivekananda birth anniversary.",
      tags: "days,national",
    },
  ];
  const ws = XLSX.utils.json_to_sheet(example, { header: SHEET_COLUMNS });
  ws["!cols"] = SHEET_COLUMNS.map((c) => ({
    wch: c.startsWith("q_") || c.startsWith("expl") ? 42 : 16,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "questions");
  XLSX.writeFile(wb, "questions-template.xlsx");
}

/** Convert canonical questions back to flat rows (for Excel export). */
export function questionsToRows(questions: Question[]) {
  return (questions || []).map((q) => ({
    id: q.id,
    subject: q.subject,
    topic: q.topic,
    difficulty: q.difficulty,
    q_hi: q.question.hi || "",
    q_en: q.question.en || "",
    opt1_hi: q.options.hi[0] || "",
    opt2_hi: q.options.hi[1] || "",
    opt3_hi: q.options.hi[2] || "",
    opt4_hi: q.options.hi[3] || "",
    opt1_en: q.options.en[0] || "",
    opt2_en: q.options.en[1] || "",
    opt3_en: q.options.en[2] || "",
    opt4_en: q.options.en[3] || "",
    answer: q.answerLetter || "",
    expl_hi: q.explanation.hi || "",
    expl_en: q.explanation.en || "",
    tags: (q.tags || []).join(","),
  }));
}

export async function exportQuestionsXlsx(
  questions: Question[],
  fileName = "question-bank.xlsx"
) {
  const XLSX = await loadSheetJS();
  const ws = XLSX.utils.json_to_sheet(questionsToRows(questions), {
    header: SHEET_COLUMNS,
  });
  ws["!cols"] = SHEET_COLUMNS.map((c) => ({
    wch: c.startsWith("q_") || c.startsWith("expl") ? 42 : 16,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "questions");
  XLSX.writeFile(wb, fileName);
}
