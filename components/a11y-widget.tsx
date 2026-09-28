"use client";

/* ===========================================================
   components/a11y-widget.tsx - the floating accessibility dock.

   A round button in the bottom-right corner that opens a small panel
   with the two settings that decide whether the app is readable for
   everyone: text size and colour theme. Both go through the same
   contexts the footer uses, so the two surfaces can never disagree.

   The button can be dismissed; components/misc.tsx keeps a link in
   the footer that brings it back, and lib/client/a11y.ts runs a
   pre-paint script so the saved size and the dismissed flag are in
   place before the first paint.
   =========================================================== */
import { Accessibility, Moon, MonitorSmartphone, RotateCcw, Sun, X } from "lucide-react";
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
import { useSettings, type ThemeMode } from "./providers";
import { useT, type StringKey } from "@/lib/i18n/t";
import { FONT_DEFAULT, FONT_SCALES } from "@/lib/client/a11y";
import type { FontScale } from "@/lib/types";

const THEME_ORDER: ThemeMode[] = ["auto", "light", "dark"];
const THEME_ICON = { auto: MonitorSmartphone, light: Sun, dark: Moon } as const;
const THEME_LABEL: Record<ThemeMode, StringKey> = {
  auto: "theme.auto",
  light: "theme.light",
  dark: "theme.dark",
};

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

/** One labelled row of choices inside the panel. */
function ChoiceRow({
  label,
  children,
  caption,
}: {
  label: string;
  children: React.ReactNode;
  caption: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1" role="group" aria-label={label}>
        {children}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

export function AccessibilityDock({ className }: { className?: string }) {
  const { t } = useT();
  const { themeMode, setThemeMode, fontScale, setFontScale, dockHidden, setDockHidden } =
    useSettings();

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
      <PopoverContent side="top" align="end" sideOffset={10} className="w-[17.5rem] gap-3 p-3">
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

        <ChoiceRow label={t("a11y.fontSize")} caption={t(FONT_LABEL[fontScale])}>
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
        </ChoiceRow>

        <ChoiceRow label={t("a11y.theme")} caption={t(THEME_LABEL[themeMode])}>
          {THEME_ORDER.map((m) => {
            const Icon = THEME_ICON[m];
            return (
              <Button
                key={m}
                type="button"
                variant={themeMode === m ? "default" : "outline"}
                size="sm"
                className="flex-1"
                aria-pressed={themeMode === m}
                title={t(THEME_LABEL[m])}
                aria-label={t(THEME_LABEL[m])}
                onClick={() => setThemeMode(m)}
              >
                <Icon />
              </Button>
            );
          })}
        </ChoiceRow>

        <Separator />

        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={reset}>
          <RotateCcw />
          {t("a11y.reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
