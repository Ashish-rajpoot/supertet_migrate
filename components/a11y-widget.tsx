"use client";

/* ===========================================================
   components/a11y-widget.tsx - the floating accessibility dock.

   THE single place every display preference is set: text size,
   colour theme and language. The footer used to carry its own
   theme cycler and language select, which meant the same two
   settings were editable in two places from two different
   hardcoded lists; the theme now comes from lib/client/theme.ts
   so the surfaces cannot drift apart.

   The button can be dismissed, in which case components/misc.tsx
   keeps a link in the footer that brings it back, and
   lib/client/a11y.ts runs a pre-paint script so the saved size and
   the dismissed flag are in place before the first paint.
   =========================================================== */
import { Accessibility, Check, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "cn";
import { useLang, useSettings } from "./providers";
import { useT, type StringKey } from "@/lib/i18n/t";
import { FONT_DEFAULT, FONT_SCALES } from "@/lib/client/a11y";
import { LANGS, THEMES } from "@/lib/client/theme";
import type { FontScale, Lang } from "@/lib/types";

const FONT_LABEL: Record<FontScale, StringKey> = {
  sm: "a11y.font.sm",
  md: "a11y.font.md",
  lg: "a11y.font.lg",
  xl: "a11y.font.xl",
};
/** The "A" inside each size button: small to large. */
const FONT_GLYPH: Record<FontScale, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-lg",
};

const LANG_LABEL: Record<Lang, StringKey> = {
  both: "lang.both",
  hi: "lang.hi",
  en: "lang.en",
};

/** One labelled group of choices inside the panel. */
function ChoiceGroup({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      {children}
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/**
 * A theme is shown as a colour chip rather than a word, so the choice
 * is obvious without reading - the label is still there for the
 * tooltip, the caption and screen readers.
 */
function ThemeSwatch({ colors }: { colors: [string, string] }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-full ring-1 ring-border"
      style={{ backgroundColor: colors[0] }}
    >
      <span className="size-2 rounded-full" style={{ backgroundColor: colors[1] }} />
    </span>
  );
}


export function AccessibilityDock({ className }: { className?: string }) {
  const { t } = useT();
  const { themeMode, setThemeMode, fontScale, setFontScale, dockHidden, setDockHidden } =
    useSettings();
  const { lang, setLang } = useLang();

  // Hidden in React as well as in CSS, so the button is really gone from
  // the tab order - the CSS rule only covers the pre-paint frame.
  if (dockHidden) return null;

  function reset() {
    setFontScale(FONT_DEFAULT);
    setThemeMode("auto");
    toast.success(t("a11y.resetDone"));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-lg"
          className={cn("size-11 rounded-full shadow-lg", className)}
          title={t("a11y.open")}
          aria-label={t("a11y.open")}
          data-a11y-dock
        >
          <Accessibility className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={10} className="w-[19rem] gap-3 p-3">
        <PopoverHeader className="flex-row items-start justify-between gap-2">
          <div>
            <PopoverTitle>{t("a11y.title")}</PopoverTitle>
            <PopoverDescription>{t("a11y.hint")}</PopoverDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-mt-0.5 -mr-1 shrink-0"
            title={t("a11y.hide")}
            aria-label={t("a11y.hide")}
            onClick={() => {
              setDockHidden(true);
              toast.success(t("a11y.hidden"));
            }}
          >
            <X />
          </Button>
        </PopoverHeader>

        <Separator />

        <ChoiceGroup label={t("a11y.fontSize")} caption={t(FONT_LABEL[fontScale])}>
          <div className="flex items-center gap-1" role="group" aria-label={t("a11y.fontSize")}>
            {FONT_SCALES.map((s) => (
              <Button
                key={s}
                type="button"
                variant={fontScale === s ? "default" : "outline"}
                size="sm"
                className="flex-1"
                aria-pressed={fontScale === s}
                title={t(FONT_LABEL[s])}
                aria-label={t(FONT_LABEL[s])}
                onClick={() => setFontScale(s)}
              >
                <span className={cn("font-semibold leading-none", FONT_GLYPH[s])}>A</span>
              </Button>
            ))}
          </div>
        </ChoiceGroup>

        {/* Five themes will not fit side by side in a 19rem panel, so they
            wrap onto two rows of swatches instead of a segmented control. */}
        <ChoiceGroup
          label={t("a11y.theme")}
          caption={t(THEMES.find((x) => x.mode === themeMode)?.label ?? "theme.auto")}
        >
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("a11y.theme")}>
            {THEMES.map((th) => {
              const on = themeMode === th.mode;
              return (
                <Button
                  key={th.mode}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-9 justify-start gap-1.5 px-2 text-xs",
                    on && "border-primary bg-primary/10 text-foreground",
                  )}
                  aria-pressed={on}
                  title={t(th.label)}
                  aria-label={t(th.label)}
                  onClick={() => setThemeMode(th.mode)}
                >
                  <ThemeSwatch colors={th.swatch} />
                  <span className="truncate">{t(th.label)}</span>
                  {on ? <Check className="ml-auto size-3.5 shrink-0" /> : null}
                </Button>
              );
            })}
          </div>
        </ChoiceGroup>

        <ChoiceGroup label={t("lang.label")} caption={t(LANG_LABEL[lang])}>
          <div className="flex items-center gap-1" role="group" aria-label={t("lang.label")}>
            {LANGS.map((l) => (
              <Button
                key={l.mode}
                type="button"
                variant={lang === l.mode ? "default" : "outline"}
                size="sm"
                className="flex-1"
                aria-pressed={lang === l.mode}
                title={t(l.label)}
                aria-label={t(l.label)}
                onClick={() => setLang(l.mode)}
              >
                {l.mode === "hi" ? "हिंदी" : l.mode === "en" ? "English" : "Both"}
              </Button>
            ))}
          </div>
        </ChoiceGroup>

        <Separator />

        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={reset}>
          <RotateCcw />
          {t("a11y.reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
