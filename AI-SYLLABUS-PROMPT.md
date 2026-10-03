# AI syllabus-writing prompt

Need a chunk of subjects and their topics for the syllabus? Do not type them one by one. Pick the exam, name the subjects, copy the prompt below and paste it into **any** LLM - ChatGPT, Claude, Gemini, Copilot, DeepSeek, Grok, a local Ollama model - and the model replies with a JSON array in exactly the layout the **Subjects** page imports.

The same prompt is also shown **right inside the app**: open the **Subjects** page (admin) and you will find it under *Or add many at once from JSON* - the placeholders are filled in live from the *Exam / type / Subjects / Hindi names / Focus* fields, so just press **Copy prompt** and paste it into your LLM. The subjects already published are named in the prompt, so a subject you type again keeps the name the site already shows.

## Placeholders

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `{{EXAM}}` | The exam or type the subjects belong to | `SuperTET` |
| `{{SUBJECTS}}` | The subjects to write topics for, comma separated | `Mathematics, Environmental Studies` |
| `{{MEDIUM}}` | `Hindi + English` (default) fills `nameHi`, `English` leaves it `""` | `Hindi + English` |
| `{{EXTRA}}` | Optional one-line focus; the line disappears when empty | `level 1 and level 2 papers` |
| `{{EXISTING}}` | Subjects already in the syllabus, named so their spelling is reused | `Mathematics, Environmental Studies` |

`{{EXAM}}` is a free-text box with SuperTET / TET / CTET / State TET / REET / Railway / SSC / Banking suggested - any other exam can be typed. `{{SUBJECTS}}` may be left empty, in which case the model is asked for the main papers of that exam instead.

## The prompt

Paste everything inside the box:

```text
You write syllabus subjects and topics for "SuperTET Prep", a bilingual (Hindi + English) practice-test website for SuperTET / TET style teacher-eligibility exams.

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

SOURCE RULES (non-negotiable)
The syllabus must be the real one, because every question the students sit is drawn from it. This is a hard rule, not a preference:
1. DO NOT invent, guess or programmatically generate the chapter list. No scripts, no loops, no templates, no "chapter 1 to chapter 10" padding, no guessing at counts. Generating the list with a script is forbidden.
2. Every subject and topic must exist in the real {{EXAM}} syllabus. Do not invent a chapter no textbook has, and do not merge or rename one that does.
3. Copy from these real sources, in this order of preference:
   - the official syllabus PDF published by the conducting body for the {{EXAM}} of the latest cycle
   - the prescribed textbooks / NCERT chapters that the official syllabus names
   - the official examination-board or department website, and its official notifications
4. Use the real paper and subject names of that exam. If the official syllabus names "Paper I" and "Paper II" (or "Level 1" and "Level 2"), keep those names instead of inventing your own.
5. Never write "topics typical of this exam", "topics commonly asked", or anything similar. Only the chapters that are actually on the real syllabus. If you are unsure whether a chapter is really there, leave it out.
6. If you cannot confirm a complete official list, output the chapters you can confirm from a real source rather than filling the gap with invented ones.

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

Now output the JSON array with one object per subject named above, each carrying that subject's full topic list exactly as the real official {{EXAM}} syllabus has it. Hindi names: {{MEDIUM}}. Remember: only the JSON array, nothing else.
```

## Bring them into the site

On the **Subjects** page (admin, backend running):

1. Copy the whole JSON array from the chat
2. Paste it into the *Or add many at once from JSON* box
3. Press **Preview subjects** - every subject, its Hindi name and its topics are listed, and any row that could not be read is reported instead of silently dropped
4. Press **Add to syllabus**

A subject that already exists is left alone and only receives the topics it is missing, so pasting the same JSON twice is safe. The parser also accepts `{ "subjects": [...] }`, a single subject object, a plain string topic (`"topics": ["Ecosystem"]`) and ```` ```json ```` fences, so a slightly-off answer usually still previews.

## Tips

- Naming the exam is what makes the topic list useful: ask SuperTET and you get SuperTET chapters, ask Railway and you get Railway subjects
- Naming one or two subjects gives a shorter, more reliable answer than asking for everything at once
- Real CTET / SuperTET paper names are the safest subject names - the site's filters, practice sets and existing questions all key off them
- Topic names become question topics, so keep them stable: renaming a topic later does not move the questions that point at it
- Always read the list once before importing - the AI sometimes invents chapters that no textbook has

## File map

- Prompt source (used by the Subjects page): `lib/data/syllabus-ai-prompt.ts`
- JSON parser for the paste box: `lib/data/syllabus-import.ts`
- This guide: `AI-SYLLABUS-PROMPT.md`
- The question-bank equivalent: `AI-QUESTION-PROMPT.md`
