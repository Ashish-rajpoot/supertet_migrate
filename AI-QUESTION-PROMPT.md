# AI question-writing prompt

Need questions for your test bank? You do not have to type them one by one. Copy the prompt below, paste it into **any** LLM - ChatGPT, Claude, Gemini, Copilot, DeepSeek, Grok, a local Ollama model - and the model will reply with a JSON array in the exact column layout this website imports. The answer-key, the question text in the medium you choose (Hindi, English or both) and explanations are all included.

The same prompt is also shown **right inside the app**: open the **Questions** page (admin or an allowed account) and you will find it directly under the *Add questions in bulk* card - the placeholders are filled in live from the *How many questions / Subject / Topic / Difficulty / Medium* fields, so just press **Copy AI prompt** and paste it into your LLM. **Difficulty** is a row of Easy / Medium / Hard switches you can combine freely (only Easy, Easy + Hard, all three, ...), and *How many* is counted **per selected difficulty**: pick all three with `50` and the prompt asks for 50 easy + 50 medium + 50 hard questions, 150 in all.

The **Subject** and **Topic** fields are searchable dropdowns (a combobox you can type in) built from the syllabus in `data/subjects.json` - or from the subjects the admin published on the **Subjects** page when the backend is running. Typing filters the list and searching also matches the Hindi names, so `विज्ञान` finds *Science*. Picking a suggestion copies that exact subject/topic name into the prompt, which is what makes the AI write questions for the chapter you actually want; typing a name that is not in the syllabus still works.

## Placeholders

Replace these seven slots before pasting, or let the app do it for you:

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `{{N}}` | How many questions to write **per difficulty** | `20` |
| `{{SUBJECT}}` | Subject / paper of the test menu | `GK & GS` |
| `{{TOPIC}}` | Chapter or topic inside the subject | `Important Days` |
| `{{DIFFICULTY}}` | One difficulty or a list: `medium`, `easy and hard`, `easy, medium and hard` | `medium` |
| `{{COUNT_RULE}}` | The per-difficulty split the model must produce | `20 easy + 20 medium + 20 hard` |
| `{{TOTAL}}` | `{{N}}` multiplied by the number of selected difficulties | `60` |
| `{{MEDIUM}}` | Language medium: `Hindi` (default), `English` or `Hindi + English` | `Hindi` |

## The prompt

Paste everything inside the box:

```text
You write exam questions for "SuperTET Prep", a bilingual (Hindi + English) practice-test website for SuperTET / TET style teacher-eligibility exams.

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

QUALITY RULES
1. Factually correct and unambiguous - no opinions, no trick wording.
2. Self-contained: a 12-year-old can answer from the question text alone.
3. No duplicate questions inside the batch.
4. Whenever Hindi is used it must be natural Devanagari, not transliterated English.
5. When both languages are filled, dates, numbers and proper nouns must match between the Hindi and English versions.
6. Prefer questions a candidate can verify: avoid heavily statement-based "which of the following is not correct" items unless the source uses them.

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

Now output the JSON array with exactly {{N}} questions per difficulty - {{TOTAL}} in all - for {{SUBJECT}} / {{TOPIC}} (medium: {{MEDIUM}}), every one of them taken from a real source and tagged with it. If you cannot find enough real sourced questions, output only the ones you can source. Remember: only the JSON array, nothing else.
```


### Filled-in example

If you replace the slots with `{{N}} = 5`, `{{SUBJECT}} = GK & GS`, `{{TOPIC}} = Important Days`, `{{DIFFICULTY}} = medium`, `{{COUNT_RULE}} = 5 medium`, `{{TOTAL}} = 5`, `{{MEDIUM}} = Hindi + English`, the model should answer with a bare JSON array like:

```json
[
  {
    "id": "gk-001",
    "subject": "GK & GS",
    "topic": "Important Days",
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
```

...with `5` questions in total. If the model wraps the reply in \`\`\`json fences or adds commentary, delete that text - only the `[ ... ]` array is imported.

## Bring the questions into the site

You need permission on the **Questions** page first (admin, or an account the admin allowed to add questions). Then pick one way:

1. **Paste** - copy the whole JSON array from the chat and drop it into the *Or paste JSON / CSV text* box on the Questions page, then press **Load pasted text**.
2. **JSON file** - save the array as `questions.json` and press **Choose JSON**.
3. **Excel / CSV file** - the keys above are the exact column names of the downloadable Excel template (`templates/questions-template.xlsx`), so you can paste the array into that sheet (one key per column, one object per row) or save it as CSV and press **Choose Excel / CSV**.

Either way you get a **preview** first: valid rows are counted, problems are listed per row, and nothing is saved until you press *Save to question bank*.

## Tips

- Ask for batches of 10-30 questions; long batches drift off-topic or repeat. Remember the count is **per difficulty**: all three difficulties with `50` asks for `150` questions in one reply, which is better split into three runs (one per difficulty) or a smaller count.
- For a Hindi-medium or English-medium batch the other language's columns come back as empty strings `""` - that is correct and imports fine; the site then shows only the filled language.
- Always spot-check facts and the answer key - LLMs can be confidently wrong.
- The site rejects rows with no question, no options or a missing/invalid answer (`A`-`D` or `1`-`4`); fix those rows and paste again - the preview tells you exactly which row failed.
- Want a different flavour? Add one line to the prompt, e.g. *"Make every question from the previous year's exam papers"* or *"Focus on child pedagogy and learning theories"*.
- Duplicate `id` values are fine - re-importing the same file updates the questions instead of adding them twice.

## File map

- Prompt source (used by the Questions page): `lib/data/ai-prompt.ts`
- This guide: `AI-QUESTION-PROMPT.md`
- Excel template generator: `tools/make_template.py`
- Column guide: `README.md` section 3 ("Adding questions")
