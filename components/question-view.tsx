"use client";

/* ===========================================================
   components/question-view.tsx - bilingual question renderer
   Ports renderField(): honour hi/en/both, show the second
   language as a muted line underneath.
   =========================================================== */
import type { ReactNode } from "react";
import { cn } from "cn";
import type { Lang } from "@/lib/types";
import { sidesOf } from "@/lib/client/util";
import { useLang } from "./providers";

export function useEffectiveLang(override?: Lang): Lang {
  const { lang } = useLang();
  return override ?? lang;
}

/** One bilingual text block (question stem, option or explanation). */
export function BiText({
  value,
  lang,
  className,
  enClassName,
  as: Tag = "div",
}: {
  value: string | { hi?: string; en?: string } | null | undefined;
  lang?: Lang;
  className?: string;
  enClassName?: string;
  as?: "div" | "p" | "span";
}) {
  const l = useEffectiveLang(lang);
  const { hi, en } = sidesOf(value ?? undefined);
  if (l === "hi") return <Tag className={className}>{hi || en}</Tag>;
  if (l === "en") return <Tag className={className}>{en || hi}</Tag>;
  if (hi && en && hi !== en) {
    return (
      <>
        <Tag className={className}>{hi}</Tag>
        <Tag className={cn("text-muted-foreground", className, enClassName)}>{en}</Tag>
      </>
    );
  }
  return <Tag className={className}>{hi || en}</Tag>;
}

export const LETTERS = ["A", "B", "C", "D", "E", "F"];

export type OptionTone = "default" | "correct" | "wrong" | "picked";

/**
 * One MCQ option row. Tones:
 *  default -> plain (test)    correct -> green (review)
 *  wrong   -> red  (review)   picked  -> highlighted choice (test)
 */
export function OptionRow({
  letter,
  index,
  hi,
  en,
  tone = "default",
  disabled = false,
  onPick,
  action,
}: {
  letter: string;
  index: number;
  hi: string;
  en: string;
  tone?: OptionTone;
  disabled?: boolean;
  onPick?: (index: number) => void;
  action?: ReactNode;
}) {
  const { lang } = useLang();
  const showBoth = lang === "both" && hi && en && hi !== en;
  return (
    <button
      type="button"
      disabled={disabled || !onPick}
      onClick={() => onPick?.(index)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-[15px] transition-colors",
        tone === "default" && "border-border bg-card hover:border-primary/50 hover:bg-muted/60",
        tone === "picked" && "border-primary bg-primary/10 ring-1 ring-primary/40",
        tone === "correct" && "border-emerald-500/60 bg-emerald-500/10",
        tone === "wrong" && "border-red-500/60 bg-red-500/10",
        (disabled || !onPick) && "cursor-default"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
          tone === "correct" && "border-emerald-600 bg-emerald-600 text-white",
          tone === "wrong" && "border-red-600 bg-red-600 text-white",
          tone === "picked" && "border-primary bg-primary text-primary-foreground",
          tone === "default" && "border-border text-muted-foreground"
        )}
      >
        {letter}
      </span>
      <span className="min-w-0 flex-1">
        {lang === "hi" ? (
          <span className="block">{hi || en}</span>
        ) : lang === "en" ? (
          <span className="block">{en || hi}</span>
        ) : (
          <>
            <span className="block">{hi || en}</span>
            {showBoth ? <span className="block text-sm text-muted-foreground">{en}</span> : null}
          </>
        )}
      </span>
      {action}
    </button>
  );
}
