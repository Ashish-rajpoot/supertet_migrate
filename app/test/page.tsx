"use client";

/* ===========================================================
   app/test/page.tsx - test setup + timed test runtime
   Port of js/test.js: subject/topic/difficulty pickers, count +
   timer, practice/test mode, option shuffle, palette, timer,
   auto-submit, instant review in practice mode, scoring that
   matches the classic attempt schema exactly.
   =========================================================== */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Crown, Flag, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { BiText, LETTERS, OptionRow } from "@/components/question-view";
import { DifficultyBadge, EmptyState, PageShell, SubjectBadge } from "@/components/misc";
import { useT, type StringKey } from "@/lib/i18n/t";
import { getAllWithServer, LETTERS as DATA_LETTERS } from "@/lib/data/normalize";
import {
  addAttempt,
  getAttempts as getLocalAttempts,
  getSettings,
  saveSettings as persistSettings,
} from "@/lib/client/store";
import { syncAttempt } from "@/lib/client/sync";
import { GUEST_TEST_LIMIT } from "@/lib/data/limits";
import { fmtTime, pick, shuffle, uid } from "@/lib/client/util";
import { canAddQuestions, fetchAccess } from "@/lib/client/auth-client";
import { useAuth, useSettings } from "@/components/providers";
import type { AccessStatus, Attempt, AttemptDetail, Question } from "@/lib/types";

void DATA_LETTERS;

const RUN_KEY = "stp.run";

interface RunState {
  id: string;
  at: number;
  mode: "test" | "practice";
  label: string;
  subjects: string[];
  minutes: number;
  negative: boolean;
  showExpl: boolean;
  endAt: number;
  questions: Question[];
  answers: (number | null)[];
  idx: number;
}

function saveRun(run: RunState | null) {
  try {
    if (run) sessionStorage.setItem(RUN_KEY, JSON.stringify(run));
    else sessionStorage.removeItem(RUN_KEY);
  } catch {
    /* quota */
  }
}

function loadRun(): RunState | null {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunState;
    if (parsed && parsed.questions && parsed.questions.length) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Shuffle options while remembering where the correct one moved. */
function prepare(q: Question, shufO: boolean): Question {
  if (!shufO) return q;
  const n = Math.max(q.options.hi.length, q.options.en.length);
  const order = shuffle([0, 1, 2, 3, 4, 5].slice(0, n));
  const hi = order.map((i) => q.options.hi[i] || "");
  const en = order.map((i) => q.options.en[i] || q.options.hi[i] || "");
  const ai = order.indexOf(q.answerIndex);
  return { ...q, options: { hi, en }, answerIndex: ai, answerLetter: LETTERS[ai] || "" };
}

async function loadSyllabusSubjectNames(): Promise<string[]> {
  try {
    const res = await fetch("/data/subjects.json", { cache: "no-store" });
    const list = res.ok ? await res.json() : [];
    return Array.isArray(list)
      ? list.map((s) => String((s && s.name) || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function TestInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useT();
  const { settings } = useSettings();
  const { signedIn, ready } = useAuth();
  const [bank, setBank] = useState<Question[] | null>(null);
  const [syllabus, setSyllabus] = useState<string[]>([]);
  const [run, setRun] = useState<RunState | null>(null);
  // setup form
  const [subjects, setSubjects] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<string[]>([]);
  const [count, setCount] = useState(20);
  const [minutes, setMinutes] = useState(20);
  const [mode, setMode] = useState<"test" | "practice">("test");
  const [negative, setNegative] = useState(false);
  const [showExpl, setShowExpl] = useState(true);
  const [shuffleOptions, setShuffleOptionsState] = useState(true);
  const [label, setLabel] = useState("");
  // Remember the choice: the switch used to reset on every page load.
  const setShuffleOptions = useCallback((v: boolean) => {
    setShuffleOptionsState(v);
    persistSettings({ shuffleOptions: v });
  }, []);
  useEffect(() => {
    const s = getSettings();
    setCount(s.defaultCount || 20);
    setMinutes(s.defaultMinutes || 20);
    setShuffleOptions(Boolean(s.shuffleOptions));
    setShowExpl(s.showExplanation !== false);
    let cancelled = false;
    (async () => {
      const all = await getAllWithServer();
      if (cancelled) return;
      setBank(all);
      setSyllabus(await loadSyllabusSubjectNames());
      // Resume an interrupted run (same tab) when the timer is still alive.
      const saved = loadRun();
      if (saved && (saved.endAt > Date.now() || saved.mode === "practice")) {
        setRun(saved);
        return;
      }
      saveRun(null);
      const pre = params.get("subject");
      if (pre) setSubjects([pre]);
      const weak = params.get("weak");
      if (weak) {
        try {
          const ids: string[] = JSON.parse(sessionStorage.getItem("stp.weakIds") || "[]");
          if (ids.length) {
            const idSet = new Set(ids.map(String));
            const pool = all.filter((q) => idSet.has(String(q.id)));
            if (pool.length) {
              begin({
                bank: all,
                pool,
                count: Math.min(pool.length, 30),
                minutes: 0,
                mode: "practice",
                label: "Weak topics revision",
                negative: false,
                showExpl: true,
                shufO: true,
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allSubjects = useMemo(() => {
    const fromBank = (bank || []).map((q) => q.subject);
    return Array.from(new Set([...syllabus, ...fromBank])).sort();
  }, [bank, syllabus]);

  /* ---------------- plan / free-tier quota ---------------- */
  // Only signed-in accounts are counted (offline use has nothing to
  // enforce against), and `/api/access` is the source of truth.
  const [access, setAccess] = useState<AccessStatus | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!signedIn) {
      setAccess(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const status = await fetchAccess();
      if (!cancelled) setAccess(status);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, signedIn]);

  const quotaBlocked = Boolean(signedIn && access && !access.fullAccess && access.testsRemaining <= 0);

  // Signed-out devices get a smaller quota of their own: counted on this
  // device and enforced by the server against the same device id, so a
  // guest cannot take an endless run of tests without an account.
  const guestUsed = useMemo(
    () => (ready && !signedIn ? getLocalAttempts().length : 0),
    [ready, signedIn]
  );
  const guestBlocked = guestUsed >= GUEST_TEST_LIMIT;
  const blocked = quotaBlocked || guestBlocked;

  const allTopics = useMemo(() => {
    const list = (bank || [])
      .filter((q) => !subjects.length || subjects.includes(q.subject))
      .map((q) => q.topic);
    return Array.from(new Set(list)).sort();
  }, [bank, subjects]);

  /**
   * How many questions each difficulty has *within the current subject and
   * topic selection*, so the chips only offer what the test can actually use.
   * A difficulty with 0 questions is shown but disabled.
   */
  const difficultyCounts = useMemo(() => {
    const rows = (bank || []).filter(
      (q) =>
        (!subjects.length || subjects.includes(q.subject)) &&
        (!topics.length || topics.includes(q.topic))
    );
    const counts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
    for (const q of rows) counts[q.difficulty] = (counts[q.difficulty] || 0) + 1;
    return counts;
  }, [bank, subjects, topics]);

  // Drop a selected difficulty once it no longer exists in the chosen filters.
  useEffect(() => {
    setDifficulty((prev) => {
      const kept = prev.filter((d) => difficultyCounts[d] > 0);
      return kept.length === prev.length ? prev : kept;
    });
  }, [difficultyCounts]);

  // Topics belong to subjects; clear any that fall outside the new selection.
  useEffect(() => {
    setTopics((prev) => {
      const kept = prev.filter((t) => allTopics.includes(t));
      return kept.length === prev.length ? prev : kept;
    });
  }, [allTopics]);

  function begin(opts: {
    bank: Question[];
    pool?: Question[];
    count: number;
    minutes: number;
    mode: "test" | "practice";
    label: string;
    negative: boolean;
    showExpl: boolean;
    shufO: boolean;
  }) {
    const pool = opts.pool || opts.bank.slice();
    const n = Math.min(Math.max(1, opts.count), pool.length);
    const picked = pick(pool, n).map((q) => prepare(q, opts.shufO));
    const now = Date.now();
    const r: RunState = {
      id: uid("a"),
      at: now,
      mode: opts.mode,
      label: opts.label || (opts.mode === "practice" ? "Practice" : "Test"),
      subjects: Array.from(new Set(picked.map((q) => q.subject))),
      minutes: opts.minutes,
      negative: opts.negative,
      showExpl: opts.showExpl,
      endAt: opts.mode === "practice" || !opts.minutes ? 0 : now + opts.minutes * 60000,
      questions: picked,
      answers: picked.map(() => null),
      idx: 0,
    };
    saveRun(r);
    setRun(r);
  }

  function startFromForm() {
    if (!bank) return;
    // Quota: a free account or a signed-out device both hit a ceiling.
    if (blocked) {
      toast.error(guestBlocked ? t("sub.guestGate") : t("sub.testGate"));
      return;
    }
    const pool = bank.filter(
      (q) =>
        (!subjects.length || subjects.includes(q.subject)) &&
        (!topics.length || topics.includes(q.topic)) &&
        (!difficulty.length || difficulty.includes(q.difficulty))
    );
    if (!pool.length) {
      toast.error(t("test.toast.noMatch"));
      return;
    }
    begin({
      bank,
      pool,
      count: Math.min(Math.max(1, count), pool.length),
      minutes,
      mode,
      label: label.trim(),
      negative,
      showExpl,
      shufO: shuffleOptions,
    });
    toast.success(
      pool.length < count
        ? t("test.toast.onlySome", { n: pool.length })
        : t("test.toast.started")
    );
  }
  const finishedRun = useRef<string | null>(null);
  const finish = useCallback(
    (r: RunState) => {
      // The countdown and the Finish button can both fire for one run: the
      // first submission wins, so the attempt is never saved twice.
      if (finishedRun.current === r.id) return;
      finishedRun.current = r.id;
      const now = Date.now();
      const timeTaken = Math.round((now - r.at) / 1000);
      const penalty = r.negative ? 1 : 0;
      let correct = 0;
      let wrong = 0;
      let skipped = 0;
      let score = 0;

      const details: AttemptDetail[] = r.questions.map((q, i) => {
        const a = r.answers[i];
        let status: AttemptDetail["status"] = "skipped";
        if (a == null) skipped++;
        else if (a === q.answerIndex) {
          status = "correct";
          correct++;
          score++;
        } else {
          status = "wrong";
          wrong++;
          score -= penalty;
        }
        return {
          id: q.id,
          subject: q.subject,
          topic: q.topic,
          difficulty: q.difficulty,
          question: q.question,
          options: q.options,
          answerIndex: q.answerIndex,
          chosenIndex: a,
          status,
          explanation: q.explanation,
        };
      });

      const total = r.questions.length;
      const percent = Math.max(0, Math.round((score / total) * 100));

      const subjectMap = new Map<string, { subject: string; total: number; correct: number }>();
      details.forEach((d) => {
        if (!subjectMap.has(d.subject)) {
          subjectMap.set(d.subject, { subject: d.subject, total: 0, correct: 0 });
        }
        const s = subjectMap.get(d.subject)!;
        s.total++;
        if (d.status === "correct") s.correct++;
      });
      const breakdown = Array.from(subjectMap.values())
        .map((s) => ({ ...s, accuracy: s.total ? Math.round((s.correct / s.total) * 100) : 0 }))
        .sort((a, b) => a.accuracy - b.accuracy);

      const topicMap = new Map<string, { subject: string; topic: string; total: number; correct: number }>();
      details.forEach((d) => {
        const key = d.topic || "General";
        if (!topicMap.has(key)) {
          topicMap.set(key, { subject: d.subject, topic: key, total: 0, correct: 0 });
        }
        const t = topicMap.get(key)!;
        t.total++;
        if (d.status === "correct") t.correct++;
      });
      const weakTopics = Array.from(topicMap.values())
        .map((t) => ({ ...t, accuracy: t.total ? Math.round((t.correct / t.total) * 100) : 0 }))
        .filter((t) => t.total >= 2 && t.accuracy < 70)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 6);

      const attempt: Attempt = {
        id: r.id,
        at: r.at,
        finishedAt: now,
        mode: r.mode,
        label: r.label,
        subjects: r.subjects,
        total,
        correct,
        wrong,
        skipped,
        score: Math.max(0, score),
        percent,
        timeTaken,
        minutes: r.minutes,
        negative: r.negative,
        breakdown,
        weakTopics,
        details,
      };

      addAttempt(attempt);
      // A refused save (guest or free-tier quota) says so instead of
      // staying silent - the local copy is kept either way.
      void syncAttempt(attempt).then((r) => {
        if (r && "blocked" in r && r.blocked && r.error) toast.warning(r.error);
      });
      saveRun(null);
      router.push(`/result/${attempt.id}`);
    },
    [router]
  );

  if (!bank) {
    return (
      <PageShell title={t("test.title")} description={t("test.desc")}>
        <Skeleton className="h-80 w-full" />
      </PageShell>
    );
  }

  if (!bank.length) {
    return (
      <PageShell title={t("test.title")} description={t("test.desc")}>
        <EmptyState
          title={t("test.empty.title")}
          hint={
            canAddQuestions()
              ? t("home.empty.edit")
              : t("home.empty.admin")
          }
          action={
            canAddQuestions() ? (
              <Button asChild>
                <Link href="/questions">{t("footer.addQuestions")}</Link>
              </Button>
            ) : undefined
          }
        />
      </PageShell>
    );
  }

  if (!run) {
    return (
      <PageShell title={t("test.title")} description={t("test.desc")}>
        {/* Signed-out devices see how many free tests this device has left,
            and a locked-out one gets the sign-in call to action. */}
        {ready && !signedIn ? (
          <Card
            className={
              guestBlocked ? "mb-4 border-destructive/40 bg-destructive/5" : "mb-4"
            }
          >
            <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
              <Badge variant={guestBlocked ? "destructive" : "secondary"}>
                {t("sub.planGuest")}
              </Badge>
              <span className={guestBlocked ? "text-destructive" : "text-muted-foreground"}>
                {guestBlocked
                  ? t("sub.guestGate")
                  : t("sub.guestUsed", { used: guestUsed, free: GUEST_TEST_LIMIT })}
              </span>
              <Button size="sm" className="ml-auto" asChild>
                <Link href="/profile">
                  <Crown /> {t("sub.signIn")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
        {/* Free-tier banner: signed-in accounts see the remaining tests,
            and a locked-out account gets the subscribe call to action. */}
        {signedIn && access ? (
          <Card
            className={
              quotaBlocked ? "mb-4 border-destructive/40 bg-destructive/5" : "mb-4"
            }
          >
            <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
              <Badge variant={access.fullAccess ? "default" : quotaBlocked ? "destructive" : "secondary"}>
                {access.unlimited
                  ? t("sub.planUnlimited")
                  : access.fullAccess
                    ? t("sub.planFull")
                    : t("sub.planFree")}
              </Badge>
              {access.fullAccess ? (
                <span className="text-muted-foreground">
                  {access.unlimited ? t("sub.unlimitedHint") : t("sub.fullHint")}
                </span>
              ) : (
                <span className={quotaBlocked ? "text-destructive" : "text-muted-foreground"}>
                  {quotaBlocked
                    ? t("sub.testGate")
                    : `${t("sub.used", { used: access.testsUsed, free: access.testsFree })} · ${t("sub.left", { n: access.testsRemaining })}`}
                </span>
              )}
              {!access.fullAccess ? (
                <Button size="sm" className="ml-auto" asChild>
                  <Link href="/profile">
                    <Crown /> {t("sub.upgrade")}
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="ml-auto" asChild>
                  <Link href="/profile">{t("sub.viewPlan")}</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : null}
        <SetupForm
          allSubjects={allSubjects}
        allTopics={allTopics}
        bank={bank}
        subjects={subjects}
        setSubjects={setSubjects}
        topics={topics}
        setTopics={setTopics}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        difficultyCounts={difficultyCounts}
        count={count}
        setCount={setCount}
        minutes={minutes}
        setMinutes={setMinutes}
        mode={mode}
        setMode={setMode}
        negative={negative}
        setNegative={setNegative}
        showExpl={showExpl}
        setShowExpl={setShowExpl}
        shuffleOptions={shuffleOptions}
        setShuffleOptions={setShuffleOptions}
        label={label}
        setLabel={setLabel}
        onStart={startFromForm}
        defaultCount={settings.defaultCount}
        defaultMinutes={settings.defaultMinutes}
      />
      </PageShell>
    );
  }

  return <Runner run={run} setRun={setRun} onFinish={finish} />;
}

interface SetupProps {
  allSubjects: string[];
  allTopics: string[];
  bank: Question[];
  subjects: string[];
  setSubjects: (v: string[]) => void;
  topics: string[];
  setTopics: (v: string[]) => void;
  difficulty: string[];
  setDifficulty: (v: string[]) => void;
  difficultyCounts: Record<string, number>;
  count: number;
  setCount: (n: number) => void;
  minutes: number;
  setMinutes: (n: number) => void;
  mode: "test" | "practice";
  setMode: (m: "test" | "practice") => void;
  negative: boolean;
  setNegative: (v: boolean) => void;
  showExpl: boolean;
  setShowExpl: (v: boolean) => void;
  shuffleOptions: boolean;
  setShuffleOptions: (v: boolean) => void;
  label: string;
  setLabel: (v: string) => void;
  onStart: () => void;
  defaultCount: number;
  defaultMinutes: number;
}

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function ChipRow({
  label,
  options,
  selected,
  onToggle,
  small = false,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string[]) => void;
  small?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>
        {label} ({selected.length || "all"})
      </Label>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(toggleIn(selected, o))}
              className={
                "rounded-full border px-3 py-1 transition-colors " +
                (small ? "text-xs" : "text-sm ") +
                (on
                  ? "border-primary bg-primary/10 font-semibold text-primary"
                  : "text-muted-foreground hover:border-primary/50")
              }
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function SetupForm(p: SetupProps) {
  const { t } = useT();
  return (
    <PageShell title={t("test.title")} description={t("test.desc")}>
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <ChipRow
            label={t("common.subjects")}
            options={p.allSubjects}
            selected={p.subjects}
            onToggle={p.setSubjects}
          />
          <ChipRow
            label={t("common.topics")}
            options={p.allTopics}
            selected={p.topics}
            onToggle={p.setTopics}
            small
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>{t("common.difficulty")}</Label>
              <div className="flex gap-2">
                {(["easy", "medium", "hard"] as const).map((d) => {
                  const on = p.difficulty.includes(d);
                  const n = p.difficultyCounts[d] || 0;
                  const label = t(`test.diff.${d}` as StringKey);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={n === 0}
                      title={
                        n === 0
                          ? t("test.diff.none", { d: label })
                          : t("test.diff.have", { d: label, n })
                      }
                      onClick={() => p.setDifficulty(toggleIn(p.difficulty, d))}
                      className={
                        "flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors " +
                        (n === 0
                          ? "cursor-not-allowed border-muted text-muted-foreground/50"
                          : on
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "text-muted-foreground hover:border-primary/50")
                      }
                    >
                      {label}
                      <span className="ml-1.5 text-xs opacity-70">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-label">{t("test.label.name")}</Label>
              <Input
                id="t-label"
                placeholder={t("test.label.namePh")}
                value={p.label}
                onChange={(e) => p.setLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-count">
                {t("test.label.count", { max: p.bank.length })}
              </Label>
              <Input
                id="t-count"
                type="number"
                min={1}
                max={p.bank.length}
                value={p.count}
                onChange={(e) => p.setCount(parseInt(e.target.value, 10) || p.defaultCount)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-min">{t("test.label.minutes")}</Label>
              <Input
                id="t-min"
                type="number"
                min={0}
                max={600}
                value={p.minutes}
                onChange={(e) => p.setMinutes(parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <SwitchRow
              id="t-mode"
              label={t("test.sw.practice")}
              checked={p.mode === "practice"}
              onChange={(v) => p.setMode(v ? "practice" : "test")}
            />
            <SwitchRow
              id="t-neg"
              label={t("test.sw.negative")}
              checked={p.negative}
              onChange={p.setNegative}
            />
            <SwitchRow
              id="t-expl"
              label={t("test.sw.explain")}
              checked={p.showExpl}
              onChange={p.setShowExpl}
            />
            <SwitchRow
              id="t-shuf"
              label={t("test.sw.shuffle")}
              checked={p.shuffleOptions}
              onChange={p.setShuffleOptions}
            />
          </div>
          <Button size="lg" onClick={p.onStart}>
            {p.mode === "practice" ? t("test.startPractice") : t("test.startTest")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t("test.bankLine", {
              bank: p.bank.length,
              count: p.defaultCount,
              min: p.defaultMinutes,
            })}
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function SwitchRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
const pausedAt = { current: 0 };

function Runner({
  run,
  setRun,
  onFinish,
}: {
  run: RunState;
  setRun: (r: RunState | null) => void;
  onFinish: (r: RunState) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const { t } = useT();
  // The clock effect must not re-run (and re-submit) just because the
  // language changed, so read the translator through a ref.
  const tRef = useRef(t);
  const finishRef = useRef(onFinish);
  useEffect(() => {
    tRef.current = t;
    finishRef.current = onFinish;
  });

  /** Abandon the run: clear the saved copy and drop back to the setup form. */
  function quit() {
    if (!confirm(t("test.quit.confirm"))) return;
    saveRun(null);
    setRun(null);
  }

  const timed = run.mode === "test" && run.endAt > 0;
  const remainMs = timed ? Math.max(0, run.endAt - now) : 0;

  // Tick the clock; auto-submit at zero - once, not on every tick.
  const timeUp = useRef(false);
  useEffect(() => {
    if (!timed || paused) return;
    if (remainMs <= 0) {
      if (!timeUp.current) {
        timeUp.current = true;
        toast.warning(tRef.current("test.toast.timeOver"));
      }
      finishRef.current(run);
      return;
    }
    const t = setTimeout(() => setNow(Date.now()), 500);
    return () => clearTimeout(t);
  }, [timed, paused, remainMs, run]);

  function update(patch: Partial<RunState>) {
    const next = { ...run, ...patch };
    saveRun(next);
    setRun(next);
  }

  function choose(i: number) {
    const answers = run.answers.slice();
    answers[run.idx] = answers[run.idx] === i ? null : i;
    update({ answers });
  }

  function confirmFinish() {
    const left = run.questions.length - run.answers.filter((a) => a != null).length;
    if (left > 0 && !confirm(left + " question(s) not answered. Submit anyway?")) return;
    onFinish(run);
  }

  const q = run.questions[run.idx];
  const chosen = run.answers[run.idx];
  const answered = run.answers.filter((a) => a != null).length;
  const isFlagged = flagged.has(run.idx);
  const optCount = Math.max(q.options.hi.length, q.options.en.length);

  function togglePause() {
    if (paused) update({ endAt: run.endAt + (Date.now() - pausedAt.current) });
    else pausedAt.current = Date.now();
    setPaused(!paused);
  }

  function toggleFlag() {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(run.idx)) next.delete(run.idx);
      else next.add(run.idx);
      return next;
    });
  }
  return (
    <PageShell
      title={run.label}
      description={`${run.mode === "practice" ? t("result.mode.practice") : t("result.mode.timed")} · ${t("test.questionOf", { a: run.idx + 1, b: run.questions.length })}`}
      actions={
        <>
          {timed ? (
            <Badge variant={remainMs < 60000 ? "destructive" : "secondary"} className="text-sm">
              {fmtTime(Math.ceil(remainMs / 1000))}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-sm">
              {fmtTime(Math.round((now - run.at) / 1000))}
            </Badge>
          )}
          {timed ? (
            <Button variant="ghost" size="icon" title={paused ? t("common.resume") : t("common.pause")} onClick={togglePause}>
              {paused ? <Play /> : <Pause />}
            </Button>
          ) : null}
        </>
      }
    >
      {paused ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-semibold">{t("test.paused")}</p>
            <p className="text-sm text-muted-foreground">{t("test.pausedHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Progress value={Math.round((answered / run.questions.length) * 100)} />
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <SubjectBadge value={q.subject} />
                <Badge variant="outline">{q.topic}</Badge>
                <DifficultyBadge value={q.difficulty} />
                <Button variant="ghost" size="sm" className="ml-auto" onClick={toggleFlag}>
                  <Flag className={isFlagged ? "fill-amber-400 text-amber-400" : ""} />
                  {isFlagged ? t("test.flagged") : t("test.flag")}
                </Button>
              </div>
              <BiText value={q.question} className="text-lg font-medium" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: optCount }).map((_, i) => {
                  const practice = run.mode === "practice" && chosen != null;
                  const tone = practice
                    ? i === q.answerIndex
                      ? "correct"
                      : i === chosen
                        ? "wrong"
                        : "default"
                    : i === chosen
                      ? "picked"
                      : "default";
                  return (
                    <OptionRow
                      key={i}
                      letter={LETTERS[i] || String(i + 1)}
                      index={i}
                      hi={q.options.hi[i] || q.options.en[i] || ""}
                      en={q.options.en[i] || ""}
                      tone={tone}
                      disabled={practice}
                      onPick={choose}
                    />
                  );
                })}
              </div>
              {run.mode === "practice" && run.showExpl && chosen != null ? (
                <PracticeFeedback q={q} chosen={chosen} />
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  disabled={run.idx === 0}
                  onClick={() => update({ idx: run.idx - 1 })}
                >
                  {t("common.previous")}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t("test.answeredOf", { a: answered, b: run.questions.length })}
                </span>
                {run.idx + 1 < run.questions.length ? (
                  <Button onClick={() => update({ idx: run.idx + 1 })}>{t("common.next")}</Button>
                ) : (
                  <Button onClick={confirmFinish}>{t("common.finish")}</Button>
                )}
              </div>
            </CardContent>
          </Card>
          <Palette run={run} flagged={flagged} onJump={(i) => update({ idx: i })} />
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={confirmFinish}>
              {run.mode === "practice" ? t("test.submitPractice") : t("test.submitTest")}
            </Button>
            <Button variant="ghost" onClick={quit}>
              {t("test.quit")}
            </Button>
          </div>
        </>
      )}
    </PageShell>
  );
}
function PracticeFeedback({ q, chosen }: { q: Question; chosen: number }) {
  const { t } = useT();
  const right = chosen === q.answerIndex;
  const correctText = q.options.hi[q.answerIndex] || q.options.en[q.answerIndex] || "";
  const expl = q.explanation.hi || q.explanation.en;
  return (
    <div
      className={
        "rounded-xl border px-3 py-2 text-sm " +
        (right ? "border-emerald-500/50 bg-emerald-500/10" : "border-red-500/50 bg-red-500/10")
      }
    >
      <strong>
        {right
          ? t("practice.correct")
          : t("practice.correctAnswer", {
              l: LETTERS[q.answerIndex],
              text: correctText,
            })}
      </strong>
      {expl ? (
        <p className="mt-1.5">
          <BiText value={q.explanation} />
        </p>
      ) : null}
    </div>
  );
}

function Palette({
  run,
  flagged,
  onJump,
}: {
  run: RunState;
  flagged: Set<number>;
  onJump: (i: number) => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-1.5 pt-5">
        {run.questions.map((_, i) => {
          const a = run.answers[i];
          return (
            <button
              key={i}
              type="button"
              onClick={() => onJump(i)}
              title={`Question ${i + 1}${flagged.has(i) ? " (flagged)" : ""}`}
              className={
                "flex size-8 items-center justify-center rounded-lg border text-xs font-semibold transition-colors " +
                (i === run.idx
                  ? "border-primary ring-2 ring-primary/40 "
                  : " ") +
                (a == null
                  ? "bg-card text-muted-foreground hover:border-primary/50"
                  : "border-primary bg-primary/15 text-primary") +
                (flagged.has(i) ? " border-b-4 border-b-amber-400" : "")
              }
            >
              {i + 1}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function TestPage() {
  const { t } = useT();
  return (
    <Suspense
      fallback={
        <PageShell title={t("test.title")}>
          <Skeleton className="h-80 w-full" />
        </PageShell>
      }
    >
      <TestInner />
    </Suspense>
  );
}
