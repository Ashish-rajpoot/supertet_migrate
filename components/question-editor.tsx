"use client";

/* ===========================================================
   components/question-editor.tsx - add or fix one saved question

   A wrong upload should never mean "delete it and re-type it", so
   this dialog repairs a single question in place - on the device and,
   when the shared bank is reachable, on the server too. It checks
   the draft with the same rules as lib/data/validate.ts, which is
   what /api/questions uses: anything that passes here also passes
   there. With mode="create" it starts from a blank row instead, so
   one question can be added without opening a spreadsheet.
   =========================================================== */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboBox, type ComboOption } from "@/components/combo-box";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateQuestionDoc } from "@/lib/data/validate";
import { blankQuestion } from "@/lib/client/question-crud";
import type { Difficulty, Question } from "@/lib/types";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const MAX_OPTIONS = 6;

export function QuestionEditorDialog({
  open,
  question,
  mode = "edit",
  newSubject = "",
  newTopic = "",
  subjectChoices = [],
  topicChoices = [],
  busy = false,
  allowDelete = false,
  onOpenChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  question: Question | null;
  /** "edit" fixes `question`; "create" starts a blank row from newSubject/newTopic. */
  mode?: "edit" | "create";
  /** Subject to prefill when mode === "create". */
  newSubject?: string;
  /** Topic to prefill when mode === "create". */
  newTopic?: string;
  subjectChoices?: ComboOption[];
  topicChoices?: ComboOption[];
  busy?: boolean;
  allowDelete?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (q: Question) => void | Promise<void>;
  onDelete?: (q: Question) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Question | null>(null);
  const [saving, setSaving] = useState(false);
  const creating = mode === "create";

  // Start every edit from a private copy, so Cancel really cancels.
  useEffect(() => {
    if (!open) return;
    if (question) {
      setDraft({
        ...question,
        question: { ...(question.question || { hi: "", en: "" }) },
        explanation: { ...(question.explanation || { hi: "", en: "" }) },
        options: {
          hi: [...(question.options?.hi || [])],
          en: [...(question.options?.en || [])],
        },
      });
      return;
    }
    if (mode === "create") setDraft(blankQuestion({ subject: newSubject, topic: newTopic }));
  }, [open, question, mode, newSubject, newTopic]);

  const rows = Math.max(
    draft?.options.hi.length || 0,
    draft?.options.en.length || 0,
    2
  );
  const errors = useMemo(
    () => (draft ? validateQuestionDoc(draft as unknown as Record<string, unknown>) : []),
    [draft]
  );

  if (!draft) return null;

  const set = (patch: Partial<Question>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const setOption = (i: number, lang: "hi" | "en", value: string) =>
    setDraft((d) => {
      if (!d) return d;
      const hi = d.options.hi.slice();
      const en = d.options.en.slice();
      while (hi.length < i + 1) hi.push("");
      while (en.length < i + 1) en.push("");
      if (lang === "hi") hi[i] = value;
      else en[i] = value;
      return { ...d, options: { hi, en } };
    });

  const addOption = () =>
    setDraft((d) =>
      d && rows < MAX_OPTIONS
        ? { ...d, options: { hi: [...d.options.hi, ""], en: [...d.options.en, ""] } }
        : d
    );

  const removeOption = (i: number) =>
    setDraft((d) => {
      if (!d || rows <= 2) return d;
      const hi = d.options.hi.slice();
      const en = d.options.en.slice();
      hi.splice(i, 1);
      en.splice(i, 1);
      const answerIndex = d.answerIndex >= hi.length ? 0 : d.answerIndex;
      return { ...d, options: { hi, en }, answerIndex };
    });

  async function submit() {
    if (!draft || errors.length || saving) return;
    const clean: Question = {
      ...draft,
      subject: draft.subject.trim(),
      topic: draft.topic.trim(),
      answerLetter: LETTERS[draft.answerIndex] || "",
      options: {
        hi: draft.options.hi.slice(0, rows).map((s) => s.trim()),
        en: draft.options.en.slice(0, rows).map((s) => s.trim()),
      },
    };
    setSaving(true);
    try {
      await onSave(clean);
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;

  return (
    <Dialog open={open} onOpenChange={(next) => !disabled && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{creating ? "New question" : "Edit question"} · {draft.id}</DialogTitle>
          <DialogDescription>
            {creating
              ? "Add one question without a spreadsheet. It is saved on this device and, when the shared bank is reachable, uploaded for every device."
              : "Fix a wrong upload without losing it. Saving updates this device and, when the shared bank is reachable, the server copy too."}
          </DialogDescription>
        </DialogHeader>

        {errors.length ? (
          <Alert variant="destructive">
            <AlertDescription>
              Fix {errors.length === 1 ? "this" : `${errors.length} things`} before saving:
              <ul className="mt-1 list-disc pl-4">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Subject</Label>
            <ComboBox
              value={draft.subject}
              onChange={(v) => set({ subject: v })}
              options={subjectChoices}
              ariaLabel="Subject"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Topic</Label>
            <ComboBox
              value={draft.topic}
              onChange={(v) => set({ topic: v })}
              options={topicChoices}
              ariaLabel="Topic"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Difficulty</Label>
            <Select
              value={draft.difficulty}
              onValueChange={(v) => set({ difficulty: v as Difficulty })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Question — हिनदੀ</Label>
            <Textarea
              rows={2}
              value={draft.question.hi}
              onChange={(e) => set({ question: { ...draft.question, hi: e.target.value } })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Question — English</Label>
            <Textarea
              rows={2}
              value={draft.question.en}
              onChange={(e) => set({ question: { ...draft.question, en: e.target.value } })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Options — press the letter of the right one</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={addOption}
              disabled={disabled || rows >= MAX_OPTIONS}
            >
              <Plus /> Option
            </Button>
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Button
                size="sm"
                variant={draft.answerIndex === i ? "default" : "outline"}
                className="w-10 shrink-0"
                title={`Mark ${LETTERS[i]} as the answer`}
                aria-label={`Mark option ${LETTERS[i]} correct`}
                aria-pressed={draft.answerIndex === i}
                onClick={() => set({ answerIndex: i, answerLetter: LETTERS[i] })}
              >
                {LETTERS[i]}
              </Button>
              <Input
                value={draft.options.hi[i] || ""}
                onChange={(e) => setOption(i, "hi", e.target.value)}
                placeholder="विकल्प"
                aria-label={`Option ${LETTERS[i]} in Hindi`}
              />
              <Input
                value={draft.options.en[i] || ""}
                onChange={(e) => setOption(i, "en", e.target.value)}
                placeholder="Option"
                aria-label={`Option ${LETTERS[i]} in English`}
              />
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                disabled={disabled || rows <= 2}
                onClick={() => removeOption(i)}
                aria-label={`Remove option ${LETTERS[i]}`}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <div className="grid gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Explanation — हिनदी (optional)</Label>
            <Textarea
              rows={2}
              value={draft.explanation.hi}
              onChange={(e) => set({ explanation: { ...draft.explanation, hi: e.target.value } })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Explanation — English (optional)</Label>
            <Textarea
              rows={2}
              value={draft.explanation.en}
              onChange={(e) => set({ explanation: { ...draft.explanation, en: e.target.value } })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {allowDelete && !creating && onDelete ? (
            <Button
              variant="destructive"
              disabled={disabled}
              onClick={() => void onDelete(draft)}
            >
              <Trash2 /> Delete question
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={disabled || Boolean(errors.length)} onClick={() => void submit()}>
              {saving ? "Saving..." : creating ? "Add question" : "Save changes"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

