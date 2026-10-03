"use client";

/* ===========================================================
   app/improve/page.tsx - revise what you got wrong

   The attempt list already stores every answer, but it is capped
   at 300 rows and lives on one device. The mistake book
   (lib/data/wrong-book.ts) keeps a lifetime wrong count per
   question, and the server answers the same question across
   devices through GET /api/attempts/wrong.

   This is the "I want to improve this subject" screen: pick a
   subject, get the questions missed most, then practise them.
   =========================================================== */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Layers, PlayCircle, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ComboBox } from "@/components/combo-box";
import { BiText, LETTERS } from "@/components/question-view";
import { EmptyState, PageShell, SectionCard } from "@/components/misc";
import { useAuth } from "@/components/providers";
import { useT } from "@/lib/i18n/t";
import {
  bookTotals,
  knownSubjects,
  knownTopics,
  normaliseBook,
  subjectMistakes,
  worstQuestions,
  type WrongBook,
  type WrongEntry,
} from "@/lib/data/wrong-book";
import { clearAttempts, getWrongBook, setWrongBook } from "@/lib/client/store";
import {
  checkServerStatus,
  fetchWrongQuestions,
  type WrongSubjectRow,
} from "@/lib/client/sync";
import { stashWeakIds } from "@/app/flashcards/page";

/** How many questions one drill can carry - same cap the result page uses. */
const DRILL_LIMIT = 30;
/** Rows fetched / shown before the student narrows the subject. */
const ROW_LIMIT = 100;

/** The one row shape both sources render as. */
interface Row {
  id: string;
  subject: string;
  topic: string;
  difficulty: string;
  question: { hi: string; en: string };
  options: { hi: string[]; en: string[] };
  answerIndex: number;
  explanation: { hi: string; en: string };
  wrong: number;
  asked: number;
  lastWrongAt: number;
}

function fromBook(e: WrongEntry): Row {
  return {
    id: e.id,
    subject: e.subject,
    topic: e.topic,
    difficulty: e.difficulty,
    question: e.question,
    options: e.options,
    answerIndex: e.answerIndex,
    explanation: e.explanation,
    wrong: e.wrong,
    // The book counts correct answers too, so asked is their sum.
    asked: e.wrong + e.correct,
    lastWrongAt: e.lastWrongAt,
  };
}

export default function ImprovePage() {
  return (
    <Suspense
      fallback={
        <PageShell title="Improve" description="Revise the questions you got wrong most.">
          <Skeleton className="h-64 w-full" />
        </PageShell>
      }
    >
      <ImproveInner />
    </Suspense>
  );
}
function ImproveInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useT();
  const { signedIn, ready } = useAuth();

  /* useT() hands back a NEW `t` on every render, so listing it as a
     dependency of load() would rebuild load on every render, the effect
     below would re-run, and the page would poll /api/status (plus the
     /api/attempts/wrong aggregation) forever. Read the translator
     through a ref instead, the same way app/page.tsx and app/test/page.tsx
     do it. Only the async load reads it - render-path code still calls t
     directly, because react-hooks/refs forbids reading a ref while rendering. */
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  /** Whether the last load came from the cloud or fell back to the device. */
  const [usedCloud, setUsedCloud] = useState(false);
  /** The device mistake book, held in state so the pickers rerun on change.
   *  Lazy initialiser: getWrongBook() parses localStorage, and the plain
   *  form would run that on every render just to throw it away. */
  const [book, setBook] = useState<WrongBook>(() => getWrongBook());
  /** Subjects the CLOUD has mistakes in. The picker offers the union of
   *  these and the device ones, so a subject never appears in the dropdown
   *  and then returns nothing for the source actually in use. */
  const [cloudSubjects, setCloudSubjects] = useState<WrongSubjectRow[]>([]);

  // A subject can be handed in from the Progress card (?subject=Name).
  const preSubject = params?.get("subject") || "";

  useEffect(() => {
    if (preSubject) setSubject(preSubject);
  }, [preSubject]);

  /**
   * Bumped on every load. A slow response from an earlier selection must
   * never overwrite a newer one - the student can change subject or topic
   * while the first fetch is still in flight.
   */
  const loadSeq = useRef(0);

  /**
   * Cloud first when there is an account and the database is up: the
   * server remembers every attempt, while the local book only knows what
   * this device saved. A null answer means the call failed, so fall back
   * to the device; an empty array is a real "nothing was missed".
   *
   * Deliberately depends only on `signedIn`: see the tRef note above.
   */
  const load = useCallback(
    async (wantSubject: string, wantTopic: string) => {
      const seq = ++loadSeq.current;
      const superseded = () => seq !== loadSeq.current;

      setLoading(true);
      const st = await checkServerStatus();
      if (superseded()) return;

      if (st.online && st.mongo && signedIn) {
        const cloud = await fetchWrongQuestions({
          subject: wantSubject,
          topic: wantTopic,
          limit: ROW_LIMIT,
        });
        if (superseded()) return;
        if (cloud) {
          setUsedCloud(true);
          setNotice("");
          setCloudSubjects(cloud.subjects);
          setRows(cloud.questions);
          setLoading(false);
          return;
        }
      }

      setUsedCloud(false);
      setNotice(st.online && st.mongo ? "" : tRef.current("improve.offline"));
      setCloudSubjects([]);
      const local = getWrongBook();
      setBook(local);
      setRows(
        worstQuestions(local, {
          subject: wantSubject,
          topic: wantTopic,
          limit: ROW_LIMIT,
        }).map(fromBook)
      );
      setLoading(false);
    },
    [signedIn]
  );

  useEffect(() => {
    if (!ready) return;
    void load(subject, topic);
  }, [ready, subject, topic, load]);

  /* ---------------- pickers ---------------- */

  // Subjects come from the mistake book (what was actually missed) and
  // from the bank, so a subject can be picked before it has ever been
  // missed. Rerun whenever the loaded rows change.
  const subjectChoices = useMemo(() => {
    const bySubject = subjectMistakes(book);
    const out: { value: string; sub?: string }[] = [];
    const seen = new Set<string>();
    const add = (name: string, sub?: string) => {
      const v = String(name || "").trim();
      if (!v) return;
      const k = v.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ value: v, sub });
    };
    // Missed subjects first (cloud ones tagged too - they outrank whatever is
    // saved on this device), then every other subject either source knows.
    // `t` is a fresh function every render, so this memo recomputes each
    // time - harmless here (it is cheap, and no effect consumes it, so it
    // cannot loop). The load() effect is the one that must not depend on t.
    cloudSubjects.forEach((r) => add(r.subject, t("improve.mostWrong")));
    bySubject.filter((r) => !r.untouched).forEach((r) => add(r.subject, t("improve.mostWrong")));
    bySubject.forEach((r) => add(r.subject));
    knownSubjects(book).forEach((s) => add(s));
    return out;
  }, [book, t, cloudSubjects]);

  // Topics narrow as the subject changes. Union of the device book and the
  // rows actually on screen, so a topic that only exists in the cloud (or
  // only on this device) is still offered - otherwise the box would look
  // empty while the subject beside it is clearly selected.
  const topicChoices = useMemo(() => {
    const names = new Set<string>(knownTopics(book, subject));
    for (const r of rows || []) {
      if (!subject || (r.subject || "").toLowerCase() === subject.trim().toLowerCase()) {
        if (r.topic) names.add(r.topic);
      }
    }
    return Array.from(names)
      .sort()
      .map((n) => ({ value: n }));
  }, [book, subject, rows]);

  // A topic belongs to a subject, so clear one that no longer applies.
  useEffect(() => {
    if (!topic) return;
    if (!topicChoices.some((o) => o.value === topic)) setTopic("");
  }, [topicChoices, topic]);

  // Header totals always describe the whole book, not the filtered view.
  const totals = useMemo(() => bookTotals(book), [book]);

  /* ---------------- actions ---------------- */

  /** The current subject / topic as query values; topic is optional. */
  function scopeParams(): string {
    const parts: string[] = [];
    if (subject) parts.push("subject=" + encodeURIComponent(subject));
    if (topic) parts.push("topic=" + encodeURIComponent(topic));
    return parts.length ? "&" + parts.join("&") : "";
  }

  /**
   * Practise exactly these questions: stash the ids, then hand over. The
   * subject and topic ride along so the test page can also pre-fill its
   * form - and it starts the run itself, so nothing has to be picked again.
   */
  function practise(ids: string[], target: "test" | "flashcards") {
    const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, DRILL_LIMIT);
    if (!unique.length) {
      toast.success(t("result.toast.nothingToRevise"));
      return;
    }
    stashWeakIds(unique);
    router.push(
      target === "test"
        ? `/test?weak=1${scopeParams()}`
        : `/flashcards?weak=1${scopeParams()}`
    );
  }

  /**
   * A full timed test on the chosen subject (and topic, when one is picked).
   * `start=1` tells the test page to begin immediately instead of showing
   * its setup form, which is the whole point - no re-selecting anything.
   * Without a subject there is nothing to scope a test to, so this button
   * stays hidden until one is chosen.
   */
  function testThisSubject() {
    if (!subject) return;
    router.push(`/test?start=1&mode=test${scopeParams()}`);
  }

  function clearHistory() {
    if (!confirm(t("improve.clearConfirm"))) return;
    clearAttempts(); // also empties the mistake book
    setWrongBook(normaliseBook(null));
    toast.success(t("improve.clearDone"));
    void load(subject, topic);
  }

  if (!ready || loading) {
    return (
      <PageShell title={t("improve.title")} description={t("improve.desc")}>
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  const list = rows || [];
  const filtered = Boolean(subject || topic);

  return (
    <PageShell title={t("improve.title")} description={t("improve.desc")}>
      {/* ---------------- pickers ---------------- */}
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="improve-subject">{t("improve.pickSubject")}</Label>
            <ComboBox
              id="improve-subject"
              value={subject}
              onChange={(v) => {
                setSubject(v);
                setTopic(""); // topics belong to a subject
              }}
              options={subjectChoices}
              placeholder={t("improve.anySubject")}
              ariaLabel={t("improve.pickSubject")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="improve-topic">{t("improve.topicOptional")}</Label>
            <ComboBox
              id="improve-topic"
              value={topic}
              onChange={setTopic}
              options={topicChoices}
              placeholder={t("improve.anyTopic")}
              emptyText={t("improve.empty.filtered")}
              ariaLabel={t("improve.topicOptional")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Topic is a refinement, never a requirement - say so, because the
          obvious reading of two stacked filters is "both are needed". */}
      <p className="text-xs text-muted-foreground">{t("improve.topicHint")}</p>

      {notice ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">{notice}</p>
      ) : null}

      {!list.length ? (
        <EmptyState
          title={filtered ? t("improve.empty.filtered") : t("improve.empty.title")}
          hint={filtered ? undefined : t("improve.empty.hint")}
          action={
            <Button asChild>
              <Link href="/test">
                <PlayCircle /> {t("common.takeTest")}
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* ---------------- totals + drill actions ---------------- */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 pt-5">
              <Badge variant={usedCloud ? "default" : "outline"}>
                {usedCloud ? t("improve.source.cloud") : t("improve.source.device")}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {t("improve.totals", totals)}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" onClick={() => practise(list.map((r) => r.id), "test")}>
                  <PlayCircle /> {t("improve.practiseThese")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => practise(list.map((r) => r.id), "flashcards")}
                >
                  <Layers /> {t("improve.flashcards")}
                </Button>
                {subject ? (
                  <Button size="sm" variant="outline" onClick={testThisSubject}>
                    {t("improve.testSubject")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("improve.clear")}
                  title={t("improve.clear")}
                  onClick={clearHistory}
                >
                  <Trash2 />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("common.refresh")}
                  title={t("common.refresh")}
                  onClick={() => void load(subject, topic)}
                >
                  <RefreshCw />
                </Button>
              </div>
            </CardContent>
          </Card>
{/* ---------------- the questions ---------------- */}
          <SectionCard
            title={t("progress.mostWrong")}
            description={t("progress.mostWrongDesc")}
          >
            <div className="flex flex-col gap-3">
              {list.map((r, i) => (
                <WrongCard key={r.id + "-" + i} row={r} rank={i + 1} />
              ))}
            </div>
          </SectionCard>
        </>
      )}
    </PageShell>
  );
}

/** One question: how often it was missed, its text and the right answer. */
function WrongCard({ row, rank }: { row: Row; rank: number }) {
  const { t } = useT();
  // Options are listed so the mistake is readable without hunting for it
  // in a result the student already scrolled past.
  const options = row.options.hi.length ? row.options.hi : row.options.en;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">{t("improve.wrongTimes", { n: row.wrong })}</Badge>
          <Badge variant="outline">#{rank}</Badge>
          <span className="text-xs text-muted-foreground">
            {row.subject} · {row.topic}
          </span>
          {row.asked > row.wrong ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {t("improve.askedTimes", { asked: row.asked })}
            </span>
          ) : null}
        </div>
        <BiText value={row.question} className="font-medium" />
        {options.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {options.map((o, i) => (
              <li
                key={i}
                className={
                  i === row.answerIndex
                    ? "rounded-md bg-emerald-500/15 px-2 py-1"
                    : "px-2 py-1 text-muted-foreground"
                }
              >
                {LETTERS[i] || String.fromCharCode(65 + i)}. {o}
              </li>
            ))}
          </ul>
        ) : null}
        {row.explanation.hi || row.explanation.en ? (
          <div className="rounded-xl bg-muted/70 px-3 py-2 text-sm">
            <BiText value={row.explanation} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}