"use client";

/* ===========================================================
   data/labels.ts - show subject and topic names in the chosen
   language.

   Questions only store an English `subject` / `topic` string, but
   the syllabus carries both names (`name` / `nameHi`). This module
   builds a lookup from one to the other so every page can render
   a subject or topic as Hindi, English, or both.

   Question subjects are often shorter than the syllabus entry
   ("Child Development" vs "Child Development and Pedagogy"), so
   matching falls back from exact -> prefix -> substring. Anything
   with no syllabus match simply keeps its English name.
   =========================================================== */
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/components/providers";
import { fetchSubjects } from "@/lib/client/sync";
import type { Lang, SyllabusSubject } from "@/lib/types";

/** A name in the active language: `primary` always, `secondary` only in "both". */
export interface Label {
  primary: string;
  secondary: string;
}

interface Entry {
  name: string;
  nameHi: string;
  topics: Map<string, string>;
}

interface Index {
  subjects: Map<string, Entry>;
  list: Entry[];
}

const EMPTY: Index = { subjects: new Map(), list: [] };

/** Case/spacing-insensitive key. */
const key = (s: string): string =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

let cached: Index | null = null;
let pending: Promise<Index> | null = null;

/* ---------------- shared syllabus loader ---------------- */

let syllabusCache: SyllabusSubject[] | null = null;
let syllabusPending: Promise<SyllabusSubject[]> | null = null;

/**
 * The syllabus subjects: the server copy when MongoDB has one, otherwise
 * the bundled public/data/subjects.json. A reachable-but-empty database
 * must NOT count as "no syllabus" - the bundled file is the fallback that
 * keeps the dropdowns and the label lookup working on a fresh install.
 */
export function loadSyllabus(): Promise<SyllabusSubject[]> {
  if (syllabusCache) return Promise.resolve(syllabusCache);
  if (!syllabusPending) {
    syllabusPending = (async () => {
      let list: SyllabusSubject[] = [];
      try {
        const remote = await fetchSubjects();
        if (Array.isArray(remote) && remote.length) list = remote;
      } catch {
        /* offline - fall through to the bundled file */
      }
      if (!list.length) {
        try {
          const res = await fetch("/data/subjects.json", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) list = data;
          }
        } catch {
          /* no syllabus at all; callers cope with an empty list */
        }
      }
      syllabusCache = list;
      return list;
    })();
  }
  return syllabusPending;
}

/**
 * Forget the cached syllabus and the label index built from it, so the
 * next read goes back to the server. The syllabus editor calls this after
 * an add / rename / delete, otherwise pages opened earlier keep showing
 * subject and topic names that no longer exist.
 */
export function invalidateSyllabus() {
  syllabusCache = null;
  syllabusPending = null;
  cached = null;
  pending = null;
}

/** The full subject/topic tree, for pickers and the syllabus editor. */
export function useSyllabus(): SyllabusSubject[] {
  const [list, setList] = useState<SyllabusSubject[]>(syllabusCache ?? []);
  useEffect(() => {
    let cancelled = false;
    void loadSyllabus().then((l) => {
      if (!cancelled) setList(l);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return list;
}

/* Server syllabus when reachable, else the bundled file. Loaded once. */
async function loadIndex(): Promise<Index> {
  const list = await loadSyllabus();
  const subjects = new Map<string, Entry>();
  const all: Entry[] = [];
  for (const s of list) {
    const topics = new Map<string, string>();
    for (const t of s.topics || []) {
      if (t?.name) topics.set(key(t.name), t.nameHi || "");
    }
    const entry: Entry = { name: s.name, nameHi: s.nameHi || "", topics };
    all.push(entry);
    if (s.name) subjects.set(key(s.name), entry);
  }
  return { subjects, list: all };
}

function ensureIndex(): Promise<Index> {
  if (!pending) {
    pending = loadIndex()
      .then((i) => (cached = i))
      .catch(() => (cached = EMPTY));
  }
  return pending;
}

/** exact -> prefix -> substring; null when nothing is close enough. */
function findSubject(index: Index, name: string): Entry | null {
  const k = key(name);
  if (!k) return null;
  const exact = index.subjects.get(k);
  if (exact) return exact;
  return (
    index.list.find((e) => key(e.name).startsWith(k) || k.startsWith(key(e.name))) ??
    index.list.find((e) => key(e.name).includes(k) || k.includes(key(e.name))) ??
    null
  );
}

/** exact -> substring, scoped to the matched subject. */
function findTopic(entry: Entry | null, topic: string): string {
  const k = key(topic);
  if (!entry || !k) return "";
  const exact = entry.topics.get(k);
  if (exact) return exact;
  for (const [tk, hi] of entry.topics) {
    if (tk.includes(k) || k.includes(tk)) return hi;
  }
  return "";
}

function resolve(lang: Lang, en: string, hi: string): Label {
  const primary = lang === "en" ? en : hi || en;
  const showBoth = lang === "both" && hi && en && hi !== en;
  return { primary, secondary: showBoth ? en : "" };
}

/** Is there a Hindi name for this subject / topic? Used to grey-out dead ends. */
export function useSyllabusLabels() {
  const { lang } = useLang();
  const [index, setIndex] = useState<Index>(cached ?? EMPTY);

  useEffect(() => {
    let cancelled = false;
    void ensureIndex().then((i) => {
      if (!cancelled) setIndex(i);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => ({
      ready: cached !== null,
      subject: (en: string): Label => {
        const hit = findSubject(index, en);
        return resolve(lang, en, hit?.nameHi || "");
      },
      topic: (subjectEn: string, topicEn: string): Label => {
        const entry = findSubject(index, subjectEn);
        return resolve(lang, topicEn, findTopic(entry, topicEn));
      },
    }),
    [index, lang]
  );
}
