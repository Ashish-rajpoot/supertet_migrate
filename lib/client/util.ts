/* ===========================================================
   client/util.ts - tiny browser helpers
   Port of js/util.js (minus DOM helpers; React does that now).
   =========================================================== */
import type { Lang } from "@/lib/types";

/** Random id, same shape as the classic `uid()` helper. */
export function uid(prefix = "q"): string {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 100) : 0);

export function download(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function readFileText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ""));
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file, "utf-8");
  });
}

export function readFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as ArrayBuffer);
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

/* ---------------- language preference (hi | en | both) ---------------- */
const LANG_KEY = "stp.lang";

export function getLang(): Lang {
  if (typeof window === "undefined") return "both";
  const v = localStorage.getItem(LANG_KEY);
  return v === "hi" || v === "en" || v === "both" ? v : "both";
}

export function setLang(v: Lang): void {
  localStorage.setItem(LANG_KEY, v);
  document.documentElement.setAttribute("data-lang", v);
  window.dispatchEvent(new CustomEvent("stp:lang", { detail: v }));
}

interface BiLike {
  hi?: string;
  en?: string;
}

/** Read one side of a {hi, en} field respecting the language mode. */
export function langOf(obj: string | BiLike | null | undefined, lang?: Lang): string {
  if (obj == null) return "";
  if (typeof obj === "string") return obj;
  const l = lang ?? getLang();
  const hi = (obj.hi || "").trim();
  const en = (obj.en || "").trim();
  if (l === "hi") return hi || en;
  if (l === "en") return en || hi;
  return hi || en;
}

/** Both sides, for bilingual display. */
export function sidesOf(obj: string | BiLike | null | undefined): { hi: string; en: string } {
  if (obj == null) return { hi: "", en: "" };
  if (typeof obj === "string") return { hi: obj, en: "" };
  return { hi: (obj.hi || "").trim(), en: (obj.en || "").trim() };
}
