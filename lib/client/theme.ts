/* ===========================================================
   lib/client/theme.ts - the one list of colour themes.

   Every surface that offers a theme reads it from here (the
   accessibility dock, the footer link), so the two can never
   disagree the way the old duplicated THEME_ORDER constants in
   components/misc.tsx and components/a11y-widget.tsx did.

   A theme is two independent decisions:

     scheme   light | dark   -> the ".dark" class, applied by
                                next-themes (it also owns the
                                pre-paint script for this class)
     variant  sepia | contrast | null
                             -> a data-theme attribute on <html>,
                                because next-themes only knows
                                light/dark/system

   "auto" means "follow the device", which is next-themes'
   "system" and cannot be expressed as a static scheme.
   =========================================================== */
import type { Lang } from "@/lib/types";
import type { StringKey } from "@/lib/i18n/strings";

export type ThemeMode = "auto" | "light" | "dark" | "sepia" | "contrast";
/** The part next-themes understands. */
export type ThemeScheme = "light" | "dark" | "system";
/** The extra palettes that ride on data-theme. */
export type ThemeVariant = "sepia" | "contrast" | null;

export interface ThemeDef {
  mode: ThemeMode;
  label: StringKey;
  scheme: ThemeScheme;
  variant: ThemeVariant;
  /** Two dots drawn on the swatch: background, then foreground. */
  swatch: [string, string];
}

export const THEMES: ThemeDef[] = [
  {
    mode: "auto",
    label: "theme.auto",
    scheme: "system",
    variant: null,
    swatch: ["#f6fbfc", "#10454d"],
  },
  {
    mode: "light",
    label: "theme.light",
    scheme: "light",
    variant: null,
    swatch: ["#f6fbfc", "#10454d"],
  },
  {
    mode: "dark",
    label: "theme.dark",
    scheme: "dark",
    variant: null,
    swatch: ["#062A30", "#c8de64"],
  },
  {
    mode: "sepia",
    label: "theme.sepia",
    scheme: "light",
    variant: "sepia",
    swatch: ["#fdf5ef", "#62472c"],
  },
  {
    mode: "contrast",
    label: "theme.contrast",
    scheme: "light",
    variant: "contrast",
    swatch: ["#ffffff", "#000000"],
  },
];

export const THEME_DEFAULT: ThemeMode = "auto";

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === "string" && THEMES.some((t) => t.mode === v);
}

export function getTheme(mode: ThemeMode): ThemeDef {
  return THEMES.find((t) => t.mode === mode) ?? THEMES[0];
}

/* ---------------- language ---------------- */

export interface LangDef {
  mode: Lang;
  label: StringKey;
}

export const LANGS: LangDef[] = [
  { mode: "both", label: "lang.both" },
  { mode: "hi", label: "lang.hi" },
  { mode: "en", label: "lang.en" },
];
