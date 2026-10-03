/* ===========================================================
   data/ai-prompt.ts - the "write the questions for me" prompt
   Self-contained port of js/ai-prompt.js. The user copies this
   prompt, pastes it into any LLM (ChatGPT, Claude, Gemini, ...),
   and the model replies with a JSON array in the exact flat
   column layout the Questions page accepts:

     id, subject, topic, difficulty, q_hi, q_en,
     opt1_hi..opt4_hi, opt1_en..opt4_en,
     answer, expl_hi, expl_en, tags

   AI-QUESTION-PROMPT.md (project root) is the human-readable
   copy of the same prompt with {{PLACEHOLDER}} slots. Keep both
   in sync.
   =========================================================== */

/** Raw prompt with {{N}}, {{SUBJECT}}, {{TOPIC}}, {{DIFFICULTY}}, {{COUNT_RULE}}, {{TOTAL}} and {{MEDIUM}} slots. */
export const AI_PROMPT_TEMPLATE = `You write exam questions for "SuperTET Prep", a bilingual (Hindi + English) practice-test website for SuperTET / TET style teacher-eligibility exams.

TASK
Create exactly {{N}} new multiple-choice questions PER DIFFICULTY - {{TOTAL}} questions in all.
- Subject: {{SUBJECT}}
- Topic: {{TOPIC}} (if that is broad, cover several sub-topics inside it)
- Difficulty: {{DIFFICULTY}} (each value must be one of: easy, medium, hard)
- Count breakdown: {{COUNT_RULE}}
- Medium: {{MEDIUM}}

MEDIUM RULES (which language columns to fill)
The Medium value in TASK tells you which rule applies:
- If Medium is "Hindi" (Hindi medium): write the real content - question, four options and explanation - in natural Devanagari Hindi into q_hi, opt1_hi..opt4_hi and expl_hi. Set q_en, opt1_en..opt4_en and expl_en to empty strings "" and do NOT translate.
- If Medium is "English" (English medium): write the real content into q_en, opt1_en..opt4_en and expl_en. Set q_hi, opt1_hi..opt4_hi and expl_hi to empty strings "".
- If Medium is "Hindi + English": fill BOTH language columns with the same meaning, like the example below.

OUTPUT FORMAT
Reply with ONE JSON array and nothing else: no introduction, no commentary, no markdown code fences, no trailing notes. Every array element is one flat object with exactly these keys, in this order:

id, subject, topic, difficulty, q_hi, q_en, opt1_hi, opt2_hi, opt3_hi, opt4_hi, opt1_en, opt2_en, opt3_en, opt4_en, answer, expl_hi, expl_en, tags

FIELD RULES
- id: unique inside the array; only lowercase letters, digits and hyphens. For subject "Science" use science-001, science-002, ...
- subject and topic: copy the Subject and Topic values above verbatim into every row.
- difficulty: "easy", "medium" or "hard" only. When TASK asks for several difficulties, spread the rows so the Count breakdown matches exactly.
- q_hi / q_en: the question text, filled exactly as MEDIUM RULES demands (empty string "" for the language not used). Each filled field at most 200 characters.
- opt1..opt4 (hi and en): exactly four options, in the same order in both columns when both are used, plausible and similar in length. Never use "all of the above", "none of the above" or "both A and B".
- answer: only the letter of the correct option - "A", "B", "C" or "D" - matching its position (opt1 = A, opt2 = B, opt3 = C, opt4 = D). Exactly one option is correct. Spread the correct letters roughly evenly across the batch.
- expl_hi / expl_en: a 1-2 sentence explanation, in the language(s) required by MEDIUM RULES, saying WHY the answer is correct.
- tags: 2-4 lowercase keywords separated by commas, e.g. "important days, national". The FIRST tag must be the real source of the question (see SOURCE RULES 4), e.g. "supertet-2023-paper1, important days, national".

SOURCE RULES (non-negotiable)
These are exam questions for real candidates, so every one of them must trace back to a real published question paper. This is a hard rule, not a preference:
1. DO NOT invent, simulate or programmatically generate questions. No scripts, no loops, no templates, no "question 1 / question 2 with the numbers swapped", no auto-combinations of facts, no synthetic patterns. Writing with a script is forbidden.
2. DO NOT fabricate facts, figures, dates, names or paper codes. Every question must come from a source that really exists.
3. Use REAL sources only, in this order of preference:
   - previous-year question papers of the same exam family (CTET, SuperTET, TET, REET, KVS, NVS, DSSSB, UGC NET, state TET papers) - real papers of the real board
   - the official syllabus and the prescribed textbooks / NCERT for that exam
   - official examination-board websites and official gazette notifications
   - established exam-prep sources that quote a paper they can name
4. Name the source of every question in its tags, in this style: "supertet-2023-paper1", "ctet-2019-paper2", "ncert-class10-ch3". One source tag per question. If you cannot name a real source for a question, do not include that question.
5. Keep the wording of a real paper question as close to the original as you can. If you reword it, keep the facts, the options and the correct answer identical to the source - never change which option the source marks correct.
6. Difficulty and count are filters over real questions, never a licence to make them up. If there are not enough real {{SUBJECT}} / {{TOPIC}} questions to fill the batch, return fewer rows rather than inventing rows, and do not pad the batch with questions from a different subject or topic.
7. Never write a question "in the style of" a paper or invent a paper code, year or paper number. Either the paper exists or the question does not go in the output.

QUALITY RULES
1. Factually correct and unambiguous - no opinions, no trick wording.
2. Self-contained: a 12-year-old can answer from the question text alone.
3. No duplicate questions inside the batch.
4. Whenever Hindi is used it must be natural Devanagari, not transliterated English.
5. When both languages are filled, dates, numbers and proper nouns must match between the Hindi and English versions.
6. Prefer questions a candidate can verify: avoid heavily statement-based "which of the following is not correct" items unless the source uses them.

EXAMPLE (the exact shape - do not copy the content)
[
  {
    "id": "gk-001",
    "subject": "{{SUBJECT}}",
    "topic": "{{TOPIC}}",
    "difficulty": "medium",
    "q_hi": "राष्ट्रीय युवा दिवस कब मनाया जाता है?",
    "q_en": "When is National Youth Day celebrated?",
    "opt1_hi": "10 जनवरी",
    "opt2_hi": "12 जनवरी",
    "opt3_hi": "15 जनवरी",
    "opt4_hi": "24 जनवरी",
    "opt1_en": "10 January",
    "opt2_en": "12 January",
    "opt3_en": "15 January",
    "opt4_en": "24 January",
    "answer": "B",
    "expl_hi": "12 जनवरी को स्वामी विवेकानंद का जन्मदिन है।",
    "expl_en": "12 January is Swami Vivekananda's birth anniversary.",
    "tags": "supertet-2023-paper1, important days, national"
  }
]

The example shows the bilingual medium; for "Hindi" or "English" medium fill only the columns named in MEDIUM RULES and leave the others as empty strings "".

Now output the JSON array with exactly {{N}} questions per difficulty - {{TOTAL}} in all - for {{SUBJECT}} / {{TOPIC}} (medium: {{MEDIUM}}), every one of them taken from a real source and tagged with it. If you cannot find enough real sourced questions, output only the ones you can source. Remember: only the JSON array, nothing else.`;

/** Every placeholder the raw template understands. */
export const AI_PROMPT_PLACEHOLDERS = [
  "{{N}}",
  "{{SUBJECT}}",
  "{{TOPIC}}",
  "{{DIFFICULTY}}",
  "{{COUNT_RULE}}",
  "{{TOTAL}}",
  "{{MEDIUM}}",
];

export interface AiPromptInput {
  count?: number | string;
  subject?: string;
  topic?: string;
  /** One difficulty ("easy"), several as a comma string ("easy,hard") or a list (["easy", "hard"]). */
  difficulty?: string | string[];
  medium?: string;
}

/** The three difficulties, always written in this order. */
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/**
 * Keep only real difficulty names (case-insensitive) in easy -> medium -> hard
 * order and drop duplicates. Blank or unrecognised input falls back to
 * "medium", the classic default of the prompt.
 */
function normaliseDifficulties(input?: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(",");
  const picked = new Set(
    raw
      .map((v) => String(v ?? "").trim().toLowerCase())
      .filter((v) => (DIFFICULTIES as readonly string[]).includes(v))
  );
  const out = DIFFICULTIES.filter((d) => picked.has(d));
  return out.length ? [...out] : ["medium"];
}

/** "easy" | "easy and hard" | "easy, medium and hard" */
function difficultyList(diffs: string[]): string {
  if (diffs.length === 1) return diffs[0];
  return diffs.slice(0, -1).join(", ") + " and " + diffs[diffs.length - 1];
}

/** Fill the prompt with the user's choices (blank values fall back to safe defaults).
 *  medium: "Hindi" (default) | "English" | "Hindi + English".
 *  The count applies PER selected difficulty: 50 with easy + medium + hard
 *  asked for 50 easy, 50 medium and 50 hard ({{TOTAL}} = 150). */
export function buildAiPrompt(input: AiPromptInput = {}): string {
  let n = parseInt(String(input.count ?? ""), 10);
  if (!Number.isFinite(n)) n = 20;
  n = Math.max(1, Math.min(200, n));

  const sub = String(input.subject ?? "").trim() || "General";
  const top = String(input.topic ?? "").trim() || "Mixed";
  const diffs = normaliseDifficulties(input.difficulty);
  const diff = difficultyList(diffs);
  const breakdown = diffs.map((d) => `${n} ${d}`).join(" + ");
  const total = n * diffs.length;
  const medRaw = String(input.medium ?? "").trim();
  const med = ["Hindi", "English", "Hindi + English"].includes(medRaw) ? medRaw : "Hindi";

  return AI_PROMPT_TEMPLATE
    .split("{{N}}")
    .join(String(n))
    .split("{{SUBJECT}}")
    .join(sub)
    .split("{{TOPIC}}")
    .join(top)
    .split("{{DIFFICULTY}}")
    .join(diff)
    .split("{{COUNT_RULE}}")
    .join(breakdown)
    .split("{{TOTAL}}")
    .join(String(total))
    .split("{{MEDIUM}}")
    .join(med);
}

/* ===========================================================
   Suggestions for the Subject / Topic search boxes of the
   "Or let an AI write the questions for you" card.

   Picking a real syllabus subject and topic is what makes the copied
   prompt precise, so the lists combine the syllabus with whatever the
   question bank already holds. Both helpers are pure (no DOM) and
   return [{ value, label, sub }] choices.
   =========================================================== */

export interface Choice {
  value: string;
  label: string;
  sub: string;
}

interface TopicShape {
  name: string;
  nameHi?: string;
}

interface SyllabusShape {
  name: string;
  nameHi?: string;
  topics?: TopicShape[];
}

/** Push a choice once, ignoring blanks and case-insensitive duplicates. */
function pushChoice(
  out: Choice[],
  seen: Set<string>,
  value: unknown,
  sub: unknown
): void {
  const v = String(value == null ? "" : value).trim();
  if (!v) return;
  const key = v.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ value: v, label: v, sub: String(sub == null ? "" : sub).trim() });
}

/**
 * Subject choices: every syllabus subject first (with its Hindi name as the
 * hint), then subjects that only exist in the question bank.
 */
export function buildSubjectChoices(
  syllabus: SyllabusShape[] = [],
  bankSubjects: string[] = []
): Choice[] {
  const out: Choice[] = [];
  const seen = new Set<string>();
  (syllabus || []).forEach((s) => {
    if (!s) return;
    pushChoice(out, seen, s.name, s.nameHi || "");
  });
  (bankSubjects || []).forEach((name) => pushChoice(out, seen, name, "already in your bank"));
  return out;
}

/**
 * Topic choices for `subject` (all topics when it is blank).
 *
 * @param syllabus   [{ name, nameHi, topics: [{ name, nameHi }] }]
 * @param bankTopics [{ subject, topic }] pairs already used in the bank
 * @param subject    the subject typed in the Subject box ('' = every subject)
 */
export function buildTopicChoices(
  syllabus: SyllabusShape[] = [],
  bankTopics: { subject: string; topic: string }[] = [],
  subject = ""
): Choice[] {
  const want = String(subject == null ? "" : subject).trim().toLowerCase();
  const out: Choice[] = [];
  const seen = new Set<string>();

  (syllabus || []).forEach((s) => {
    if (!s) return;
    const sName = String(s.name || "").trim();
    if (want && sName.toLowerCase() !== want) return;
    (s.topics || []).forEach((t) => {
      if (!t) return;
      const hi = String(t.nameHi || "").trim();
      // With no subject chosen the subject name is the hint, so the topic stays identifiable.
      const hint = want ? hi : [hi, sName].filter(Boolean).join(" · ");
      pushChoice(out, seen, t.name, hint);
    });
  });

  const bankSeen = new Set<string>();
  (bankTopics || []).forEach((row) => {
    if (!row) return;
    const sName = String(row.subject == null ? "" : row.subject).trim().toLowerCase();
    if (want && sName !== want) return;
    const topic = String(row.topic == null ? "" : row.topic).trim();
    if (!topic) return;
    const key = topic.toLowerCase();
    if (bankSeen.has(key)) return;
    bankSeen.add(key);
    pushChoice(out, seen, topic, "already in your bank");
  });

  return out;
}


