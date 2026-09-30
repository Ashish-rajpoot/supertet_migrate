/* ===========================================================
   data/syllabus-import.ts - read subjects and topics out of a
   pasted JSON blob

   The Subjects page lets an admin paste a whole chunk of the
   syllabus at once, the way the Questions page takes a whole
   chunk of questions. The parser is deliberately forgiving, so a
   half-finished AI answer or a hand-written note still previews:

     - the root may be an array, { "subjects": [...] } or one
       bare subject object
     - name / subject / title all work for a subject,
       name / topic / title for a topic
     - a topic may be a plain string:  "topics": ["Percentage"]
     - ```json fences (what a clipboard or an LLM leaves behind)
       are unwrapped first

   Nothing is written here. Rows that cannot be used are reported
   in `errors` instead of throwing, so the page can show a preview
   and let the admin fix exactly the rows that need it.

   public/data/subjects.json is already in this shape, so rows
   copied out of that file paste in as they are.
   =========================================================== */

export interface BulkTopic {
  name: string;
  nameHi: string;
}

export interface BulkSubject {
  name: string;
  nameHi: string;
  topics: BulkTopic[];
}

export interface SyllabusImport {
  /** Usable subjects, duplicates already folded away. */
  subjects: BulkSubject[];
  /** How many topics those subjects carry in total. */
  topics: number;
  /** Rows that could not be used, phrased for the preview list. */
  errors: string[];
}

/** Collapse whitespace, the way the server does before it stores a name. */
const name = (v: unknown): string =>
  String(v == null ? "" : v).trim().replace(/\s+/g, " ");

const SUBJECT_KEYS = ["name", "subject", "title", "paper"];
const SUBJECT_HI_KEYS = ["nameHi", "name_hi", "nameHindi", "subjectHi", "hindi"];
const TOPIC_LIST_KEYS = ["topics", "chapters", "children", "units"];
const TOPIC_KEYS = ["name", "topic", "title"];
const TOPIC_HI_KEYS = ["nameHi", "name_hi", "nameHindi", "hindi"];

/** First non-empty value among `keys`. */
function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = name(row[k]);
    if (v) return v;
  }
  return "";
}

/** ```json fences are what people actually paste. */
function unwrap(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1] : t;
}

/** An object, or { name } when the row is a bare string. */
function asRecord(row: unknown): Record<string, unknown> {
  if (typeof row === "string") return { name: row };
  if (row && typeof row === "object" && !Array.isArray(row)) return row as Record<string, unknown>;
  return {};
}

/** The list of topics under one subject, whichever alias it used. */
function topicRows(rec: Record<string, unknown>): unknown[] {
  for (const k of TOPIC_LIST_KEYS) {
    const v = rec[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** Never take the same name twice: the server would answer 409. */
function addTopicTo(
  subject: BulkSubject,
  seen: Set<string>,
  row: unknown,
  where: string,
  errors: string[]
): void {
  const rec = asRecord(row);
  const topicName = pick(rec, TOPIC_KEYS);
  if (!topicName) {
    errors.push(`${where} has no name - skipped.`);
    return;
  }
  const key = topicName.toLowerCase();
  if (seen.has(key)) {
    errors.push(`${where} repeats "${topicName}" - only the first one is used.`);
    return;
  }
  seen.add(key);
  subject.topics.push({ name: topicName, nameHi: pick(rec, TOPIC_HI_KEYS) });
}


/**
 * Parse pasted JSON into subjects with their topics. Never throws:
 * a broken blob comes back as empty subjects plus one error line.
 */
export function parseSyllabusJson(text: string): SyllabusImport {
  const errors: string[] = [];
  const raw = unwrap(String(text == null ? "" : text));
  if (!raw) {
    return { subjects: [], topics: 0, errors: ["Nothing to read - the box is empty."] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      subjects: [],
      topics: 0,
      errors: ["That is not valid JSON: " + (err instanceof Error ? err.message : "parse error")],
    };
  }

  // An array, { subjects: [...] } and one bare subject object all work.
  let rows: unknown[] = [];
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const list = [...TOPIC_LIST_KEYS, "subjects"].map((k) => obj[k]).find((v) => Array.isArray(v));
    rows = list ? (list as unknown[]) : [obj];
  } else {
    errors.push("The JSON has to be an array of subjects, or one subject object.");
  }

  const subjects: BulkSubject[] = [];
  const seenSubjects = new Set<string>();

  rows.forEach((row, i) => {
    const where = "Subject " + (i + 1);
    const rec = asRecord(row);
    const subjectName = pick(rec, SUBJECT_KEYS);
    if (!subjectName) {
      errors.push(`${where} has no name - skipped.`);
      return;
    }
    const key = subjectName.toLowerCase();
    if (seenSubjects.has(key)) {
      errors.push(`${where} repeats the subject "${subjectName}" - only the first one is used.`);
      return;
    }
    seenSubjects.add(key);

    const subject: BulkSubject = { name: subjectName, nameHi: pick(rec, SUBJECT_HI_KEYS), topics: [] };
    const seenTopics = new Set<string>();
    topicRows(rec).forEach((t, j) =>
      addTopicTo(subject, seenTopics, t, `Topic ${j + 1} of "${subjectName}"`, errors)
    );
    subjects.push(subject);
  });

  return {
    subjects,
    topics: subjects.reduce((n, s) => n + s.topics.length, 0),
    errors,
  };
}

/** A ready-made example, so the expected shape is obvious in the box. */
export const SAMPLE_SYLLABUS_JSON = `[
  {
    "name": "Mathematics",
    "nameHi": "गणित",
    "topics": [
      { "name": "Percentage", "nameHi": "प्रतिशत" },
      { "name": "Algebra", "nameHi": "बीजगणित" }
    ]
  },
  {
    "name": "Environmental Studies",
    "nameHi": "पर्यावरण अध्ययन",
    "topics": ["Ecosystem", { "name": "Pollution", "nameHi": "प्रदूषण" }]
  }
]`;
