"use client";

/* ===========================================================
   lib/i18n/t.tsx - the two ways to read a UI string.

   t("nav.home")              -> a plain string. Use where only
                                 text fits: toasts, aria-label,
                                 placeholders, document title.
                                 In "both" mode it joins the two
                                 with a middot on one line.

   <T k="nav.home" />         -> a node. Use in headings, nav
                                 items and buttons: in "both"
                                 mode Hindi sits on top with the
                                 English muted underneath, the
                                 same way bilingual subject names
                                 already read.

   Both are driven by the footer language selector, so every
   surface follows one setting with no per-page wiring.
   =========================================================== */
import { useLang } from "@/components/providers";
import { cn } from "cn";
import { STRINGS, type StringKey } from "./strings";

/** Values substituted into "{name}" placeholders. */
export type Vars = Record<string, string | number>;

/** Fill "{name}" placeholders, leaving unknown ones untouched. */
function fill(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (whole, k: string) =>
    k in vars ? String(vars[k]) : whole,
  );
}

export function useT() {
  const { lang } = useLang();

  /** Plain string, respects the language mode. */
  const t = (key: StringKey, vars?: Vars): string => {
    const e = STRINGS[key];
    if (!e) return key; // typed, but never break the UI
    if (lang === "en") return fill(e.en, vars);
    if (lang === "hi") return fill(e.hi, vars);
    return `${fill(e.hi, vars)} · ${fill(e.en, vars)}`;
  };

  /** The Hindi and English halves, already filled. */
  const pair = (key: StringKey, vars?: Vars) => {
    const e = STRINGS[key];
    return { hi: fill(e.hi, vars), en: fill(e.en, vars) };
  };

  return { t, pair, lang };
}

/**
 * A translated label. In "both" mode the English sits underneath in
 * muted text; in single-language mode it is simply that one language.
 */
export function T({
  k,
  vars,
  className,
  subClassName,
}: {
  k: StringKey;
  vars?: Vars;
  className?: string;
  subClassName?: string;
}) {
  const { lang, pair } = useT();
  const { hi, en } = pair(k, vars);
  if (lang === "en") return <span className={className}>{en}</span>;
  if (lang === "hi") return <span className={className}>{hi}</span>;
  return (
    <>
      <span className={className}>{hi}</span>
      <span
        className={cn(
          "block truncate text-xs font-normal text-muted-foreground",
          subClassName,
        )}
      >
        {en}
      </span>
    </>
  );
}

export type { StringKey };
export { STRINGS };
