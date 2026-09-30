/* ===========================================================
   client/a11y.ts - accessibility preferences (text size + the
   floating button) in one place.

   Same shape as the stp.lang preference in client/util.ts: one
   localStorage key, one attribute on <html>, one CustomEvent.
   The dock, the footer and anything else that asks therefore stay
   in sync without passing props around.
   =========================================================== */
import type { FontScale } from "@/lib/types";

export const FONT_SCALES: FontScale[] = ["sm", "md", "lg", "xl"];
export const FONT_DEFAULT: FontScale = "md";

const FONT_KEY = "stp.font";
const DOCK_KEY = "stp.a11yDock";

export function getFontScale(): FontScale {
  if (typeof window === "undefined") return FONT_DEFAULT;
  const v = localStorage.getItem(FONT_KEY);
  return v === "sm" || v === "lg" || v === "xl" ? v : FONT_DEFAULT;
}

/** Persist the size, apply it to <html> and tell every listener. */
export function setFontScale(v: FontScale): void {
  try {
    localStorage.setItem(FONT_KEY, v);
  } catch {
    /* private mode */
  }
  document.documentElement.setAttribute("data-font", v);
  window.dispatchEvent(new CustomEvent("stp:a11y", { detail: { font: v } }));
}

/** The floating accessibility button. True = the user dismissed it. */
export function getDockHidden(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DOCK_KEY) === "1";
}

export function setDockHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(DOCK_KEY, "1");
    else localStorage.removeItem(DOCK_KEY);
  } catch {
    /* private mode */
  }
  const html = document.documentElement;
  if (hidden) html.setAttribute("data-a11y", "off");
  else html.removeAttribute("data-a11y");
  window.dispatchEvent(new CustomEvent("stp:a11y", { detail: { hidden } }));
}

/**
 * Runs as the first script in <body> - the technique next-themes uses for
 * the colour theme - so the saved text size and the "button hidden" flag
 * are in place before the first paint: the page never jumps from the
 * default size, and a dismissed button never flashes back. Keep it a
 * plain self-contained string: it is injected with dangerouslySetInnerHTML.
 */
export const A11Y_BOOT_SCRIPT =
  "(function(){try{var d=document.documentElement,f=localStorage.getItem('stp.font');" +
  "if(f==='sm'||f==='lg'||f==='xl')d.setAttribute('data-font',f);" +
  "if(localStorage.getItem('stp.a11yDock')==='1')d.setAttribute('data-a11y','off');" +
  // next-themes applies .dark before the first paint but knows nothing
  // about the extra palettes, so sepia/contrast are set here for the
  // same reason: without it a saved sepia theme flashes white first.
  "var t=localStorage.getItem('stp.theme');" +
  "if(t==='sepia'||t==='contrast')d.setAttribute('data-theme',t);" +
  "}catch(e){}})();";
