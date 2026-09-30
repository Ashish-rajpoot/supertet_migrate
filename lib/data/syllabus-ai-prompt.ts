/* ===========================================================
   data/syllabus-ai-prompt.ts - the "write the syllabus for me"
   prompt

   Same idea as data/ai-prompt.ts, one screen over: the admin wants
   a chunk of subjects and their topics instead of a chunk of
   questions, pastes the model's answer into the JSON box on the
   Subjects page, and the parser (data/syllabus-import.ts) reads it.
   The keys asked for below are exactly the keys that parser takes,
   so a well-behaved model pastes straight in with no editing.

   AI-SYLLABUS-PROMPT.md (project root) is the human-readable copy
   with {{PLACEHOLDER}} slots. Keep both in sync.
   =========================================================== */

/**
 * Raw prompt with {{EXAM}}, {{SUBJECTS}}, {{MEDIUM}}, {{EXTRA}} and
 * {{EXISTING}} slots. Focus and "Already in the syllabus" are
 * optional lines: they are dropped whole when the admin left them empty.
 */
export const SYLLABUS_PROMPT_TEMPLATE = `You write syllabus subjects and topics for "SuperTET Prep", a bilingual (Hindi + English) practice-test website for SuperTET / TET style teacher-eligibility exams.

TASK
Write the topic list of the {{EXAM}} exam for every subject named below - one JSON object per subject.
- Subjects: {{SUBJECTS}}
- Hindi names: {{MEDIUM}}
- Focus: {{EXTRA}}
- Already in the syllabus: {{EXISTING}}

TOPIC RULES
- One topic = one chapter or unit of the {{EXAM}} syllabus, named the way its textbook names it: "Percentage", "Human Body", "Important Days".
- 2 to 8 words. No numbering ("1.", "Unit 2"), no trailing full stop, no question marks.
- No topic may repeat inside its subject or across subjects.
- Give the complete list, not a sample: cover the whole paper, easy chapters and hard ones alike.
- Where you know the real chapter split of that exam, follow it, so the list matches the book.
- Keep the names inside one subject on the same level of detail.

OUTPUT FORMAT
Reply with ONE JSON array and nothing else: no introduction, no commentary, no markdown code fences, no trailing notes. Every array element is one subject object with exactly these three keys, in this order:

name, nameHi, topics

and every topic is an object with exactly these two keys, in this order:

name, nameHi

FIELD RULES
- name: the subject exactly as it was written in the Subjects list above, spelled the same way. If that subject is already in the syllabus, reuse the name the syllabus already has.
- nameHi: the same subject in natural Devanagari Hindi, e.g. "बाल विकास एवं शिक्षाशास्त्र". Empty string "" when the Hindi names are English only.
- topics: the full list of chapters of that subject, in the order the book teaches them.
- One array element per named subject, in the same order. Nothing else: no id, no order, no counts, no comments.

EXAMPLE (the content is made up, the shape is what matters)
[
  {
    "name": "Environmental Studies",
    "nameHi": "पर्यावरण अध्ययन",
    "topics": [
      { "name": "Ecosystem and Its Components", "nameHi": "पारितंत्र और उसके घटक" },
      { "name": "Natural Resources and Conservation", "nameHi": "प्राकृतिक संसाधन और संरक्षण" }
    ]
  }
]

Now output the JSON array with one object per subject named above, each carrying that subject's full topic list, for the {{EXAM}} exam. Hindi names: {{MEDIUM}}. Remember: only the JSON array, nothing else.`;

/** Every placeholder the raw template understands. */
export const SYLLABUS_PROMPT_PLACEHOLDERS = [
  "{{EXAM}}",
  "{{SUBJECTS}}",
  "{{MEDIUM}}",
  "{{EXTRA}}",
  "{{EXISTING}}",
];

export interface SyllabusPromptInput {
  /** Which exam the subjects belong to: SuperTET, TET, CTET, Railway, ... */
  exam?: string;
  /** The subjects to write topics for, comma separated. Empty = every main paper. */
  subjects?: string;
  /** "Hindi + English" (default) writes nameHi too, "English" leaves it empty. */
  medium?: string;
  /** One extra line of instruction, e.g. "level 1 papers only". */
  extra?: string;
  /** Subject names already published, so the model reuses those exact names. */
  existing?: string[];
}

/** Common exams offered in the picker. Any other value can be typed. */
export const EXAM_PRESETS = [
  "SuperTET",
  "TET",
  "CTET",
  "State TET",
  "REET",
  "Railway",
  "SSC",
  "Banking",
];

/** The two language choices, in the order the select shows them. */
const MEDIA = ["Hindi + English", "English"];

/** Values behind the "Use example values" button. */
export const SYLLABUS_PROMPT_EXAMPLE = {
  exam: "SuperTET",
  subjects: "Child Development and Pedagogy, Environmental Studies, Mathematics",
  medium: "Hindi + English",
  focus: "Chapter names exactly as the latest SuperTET syllabus lists them",
};

/** One tidy single line out of whatever was typed into the field. */
function line(value: unknown, max = 400): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

/** Drop a "- Label: ..." line that has nothing left to say. */
function dropLine(text: string, label: string): string {
  return text.replace(new RegExp("^[ \\t]*- " + label + ":[ \\t]*\\r?\\n", "m"), "");
}

/**
 * Fill the prompt with the admin's choices. The two optional lines
 * (Focus, Already in the syllabus) disappear when they were left empty,
 * so the copied prompt never says "Focus: " with nothing after it.
 */
export function buildSyllabusPrompt(input: SyllabusPromptInput = {}): string {
  const exam = line(input.exam, 60) || EXAM_PRESETS[0];
  const named = line(input.subjects) || "every main paper of this exam (no subject names were given)";
  const medRaw = String(input.medium ?? "").trim();
  const medium = MEDIA.includes(medRaw) ? medRaw : MEDIA[0];
  const extra = line(input.extra, 300);
  const existing = Array.from(
    new Set((input.existing ?? []).map((s) => String(s ?? "").trim()).filter(Boolean))
  ).slice(0, 40);

  let out = SYLLABUS_PROMPT_TEMPLATE.split("{{EXAM}}")
    .join(exam)
    .split("{{SUBJECTS}}")
    .join(named)
    .split("{{MEDIUM}}")
    .join(medium)
    .split("{{EXTRA}}")
    .join(extra)
    .split("{{EXISTING}}")
    .join(existing.join(", "));
  if (!extra) out = dropLine(out, "Focus");
  if (!existing.length) out = dropLine(out, "Already in the syllabus");
  return out;
}
