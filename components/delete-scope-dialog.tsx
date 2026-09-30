"use client";

/* ===========================================================
   components/delete-scope-dialog.tsx - what happens to the
   questions when a subject or a topic is deleted?

   Deleting a syllabus entry is destructive in a second way: the
   questions in the bank point at subjects and topics by NAME, so
   removing "Mathematics" would strand every maths question. The
   dialog says how many questions are affected and lets the admin
   pick one of four outcomes:

     delete - remove the questions too (hard delete)
     move   - re-file them under another subject / topic name
     keep   - only remove the syllabus entry, bank untouched
     clear  - only remove the questions, the entry stays (opt-in per page)
   =========================================================== */
import { useEffect, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboBox } from "@/components/combo-box";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * What the dialog decided: "clear" removes every question of the scope while
 * the subject / topic entry itself stays - the one choice that is not about
 * the entry's own fate.
 */
export type DeleteMode = "delete" | "move" | "keep" | "clear";

export interface DeleteChoice {
  mode: DeleteMode;
  /** Subject (or topic) name the questions move to when mode === "move". */
  moveTo?: string;
}

function Option({
  active,
  disabled,
  title,
  hint,
  danger,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  title: string;
  hint: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        active ? "border-primary bg-accent" : "hover:bg-accent/60",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active &&
            (danger
              ? "border-destructive-solid bg-destructive-solid text-destructive-solid-foreground"
              : "border-primary bg-primary text-primary-foreground")
        )}
      >
        {active ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

export function DeleteScopeDialog({
  open,
  title,
  description,
  count = 0,
  deviceCount = 0,
  targets = [],
  busy = false,
  confirmLabel = "Delete",
  targetLabel = "subject",
  showKeep = true,
  showQuestionsOnly = false,
  syllabus = null,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** Questions in the shared bank that belong to what is being deleted. */
  count?: number;
  /** Questions saved on this device for the same subject / topic. */
  deviceCount?: number;
  /** Names the questions can be re-filed under instead of deleted. */
  targets?: string[];
  busy?: boolean;
  confirmLabel?: string;
  /** "subject" or "topic" - only changes the wording of the picker. */
  targetLabel?: string;
  /** Hide "leave the questions alone" when the questions ARE the only thing here. */
  showKeep?: boolean;
  /** Offer "delete only the questions, keep this subject / topic". */
  showQuestionsOnly?: boolean;
  /** Optional tick-box: also remove the matching syllabus entry. */
  syllabus?: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  } | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (choice: DeleteChoice) => void;
}) {
  const total = count + deviceCount;
  const [mode, setMode] = useState<DeleteMode>("delete");
  const [moveTo, setMoveTo] = useState("");

  // Every time the dialog opens, start again from the safest default.
  useEffect(() => {
    if (!open) return;
    setMode("delete");
    setMoveTo("");
  }, [open]);

  const moveReady = mode !== "move" || Boolean(moveTo.trim());

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {total ? <TriangleAlert className="size-4 text-destructive" /> : null}
            {title}
          </DialogTitle>
          <DialogDescription>
            {description ||
              (total
                ? `${total} question(s) point at this entry. Choose what should happen to them.`
                : "No question points at this entry, so nothing else is affected.")}
          </DialogDescription>
        </DialogHeader>

        {total ? (
          <div className="flex flex-col gap-2">
            <Option
              active={mode === "delete"}
              disabled={busy}
              danger
              title={`Delete the ${total} question(s) as well`}
              hint={
                count
                  ? `Removes ${count} from the shared bank and ${deviceCount} from this device. This cannot be undone.`
                  : `Removes the ${deviceCount} question(s) saved on this device.`
              }
              onClick={() => setMode("delete")}
            />
            {showQuestionsOnly ? (
              <Option
                active={mode === "clear"}
                disabled={busy}
                danger
                title={`Delete only the ${total} question(s), keep this ${targetLabel}`}
                hint={
                  count
                    ? `Removes ${count} from the shared bank and ${deviceCount} from this device. The ${targetLabel} itself stays.`
                    : `Removes the ${deviceCount} question(s) saved on this device. The ${targetLabel} itself stays.`
                }
                onClick={() => setMode("clear")}
              />
            ) : null}
            <div className="flex flex-col gap-2 rounded-xl border p-3">
              <Option
                active={mode === "move"}
                disabled={busy}
                title="Keep the questions - move them elsewhere"
                hint="Re-files them under another name, so the work already done is not lost."
                onClick={() => setMode("move")}
              />
              {mode === "move" ? (
                <ComboBox
                  value={moveTo}
                  onChange={setMoveTo}
                  options={targets.map((t) => ({ value: t }))}
                  placeholder={`Choose or type a ${targetLabel} name`}
                  ariaLabel={`Move questions to another ${targetLabel}`}
                />
              ) : null}
            </div>
            {showKeep ? (
              <Option
                active={mode === "keep"}
                disabled={busy}
                title="Only remove this entry, leave the questions alone"
                hint={
                  total
                    ? `The ${total} question(s) stay in the bank with the old name, so they become harder to find.`
                    : "Nothing in the question bank is touched."
                }
                onClick={() => setMode("keep")}
              />
            ) : null}
          </div>
        ) : null}

        {syllabus && mode !== "clear" ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm">
            <Checkbox
              checked={syllabus.checked}
              disabled={busy}
              onCheckedChange={(v) => syllabus.onChange(v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0 text-muted-foreground">{syllabus.label}</span>
          </label>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={mode === "delete" || mode === "clear" ? "destructive" : "default"}
            disabled={busy || !moveReady}
            onClick={() =>
              onConfirm({ mode: total ? mode : "delete", moveTo: moveTo.trim() || undefined })
            }
          >
            {busy
              ? "Working..."
              : mode === "move"
                ? "Move and continue"
                : mode === "clear"
                  ? "Delete questions only"
                  : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

