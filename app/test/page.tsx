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
import { Flag, Pause, Play } from "lucide-react";
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
import { getAllWithServer, LETTERS as DATA_LETTERS } from "@/lib/data/normalize";
import { addAttempt, getSettings } from "@/lib/client/store";
import { syncAttempt } from "@/lib/client/sync";
import { fmtTime, pick, shuffle, uid } from "@/lib/client/util";
import { canAddQuestions } from "@/lib/client/auth-client";
import { useSettings } from "@/components/providers";
import type { Attempt, AttemptDetail, Question } from "@/lib/types";

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
  const { settings } = useSettings();
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
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [label, setLabel] = useState("");
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
                shufO: false,
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
    const pool = bank.filter(
      (q) =>
        (!subjects.length || subjects.includes(q.subject)) &&
        (!topics.length || topics.includes(q.topic)) &&
        (!difficulty.length || difficulty.includes(q.difficulty))
    );
    if (!pool.length) {
      toast.error("No questions match this selection.");
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
    toast.success(pool.length < count ? `Only ${pool.length} questions available - using all.` : "Test started");
  }
  const finish = useCallback(
    (r: RunState) => {
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
      void syncAttempt(attempt);
      saveRun(null);
      router.push(`/result/${attempt.id}`);
    },
    [router]
  );

  if (!bank) {
    return (
      <PageShell title="Test" description="Timed test with instant scoring.">
        <Skeleton className="h-80 w-full" />
      </PageShell>
    );
  }

  if (!bank.length) {
    return (
      <PageShell title="Test" description="Timed test with instant scoring.">
        <EmptyState
          title="No questions yet"
          hint={
            canAddQuestions()
              ? "Load a question bank from the Questions page first."
              : "The admin has not added a question bank yet."
          }
          action={
            canAddQuestions() ? (
              <Button asChild>
                <Link href="/questions">Add questions</Link>
              </Button>
            ) : undefined
          }
        />
      </PageShell>
    );
  }

  if (!run) {
    return (
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
  return (
    <PageShell title="Test" description="Timed test with instant scoring.">
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <ChipRow
            label="Subjects"
            options={p.allSubjects}
            selected={p.subjects}
            onToggle={p.setSubjects}
          />
          <ChipRow
            label="Topics"
            options={p.allTopics}
            selected={p.topics}
            onToggle={p.setTopics}
            small
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Difficulty</Label>
              <div className="flex gap-2">
                {["easy", "medium", "hard"].map((d) => {
                  const on = p.difficulty.includes(d);
                  const n = p.difficultyCounts[d] || 0;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={n === 0}
                      title={
                        n === 0
                          ? `No ${d} questions in the selected subjects/topics`
                          : `${n} ${d} question(s) available`
                      }
                      onClick={() => p.setDifficulty(toggleIn(p.difficulty, d))}
                      className={
                        "flex-1 rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors " +
                        (n === 0
                          ? "cursor-not-allowed border-muted text-muted-foreground/50"
                          : on
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "text-muted-foreground hover:border-primary/50")
                      }
                    >
                      {d}
                      <span className="ml-1.5 text-xs opacity-70">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-label">Test name (optional)</Label>
              <Input
                id="t-label"
                placeholder="e.g. Sunday mock"
                value={p.label}
                onChange={(e) => p.setLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-count">Questions (max {p.bank.length})</Label>
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
              <Label htmlFor="t-min">Minutes (0 = no timer)</Label>
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
              label="Practice mode (untimed, instant answers)"
              checked={p.mode === "practice"}
              onChange={(v) => p.setMode(v ? "practice" : "test")}
            />
            <SwitchRow
              id="t-neg"
              label="Negative marking (−1 per wrong answer)"
              checked={p.negative}
              onChange={p.setNegative}
            />
            <SwitchRow
              id="t-expl"
              label="Show explanations in practice mode"
              checked={p.showExpl}
              onChange={p.setShowExpl}
            />
            <SwitchRow
              id="t-shuf"
              label="Shuffle options"
              checked={p.shuffleOptions}
              onChange={p.setShuffleOptions}
            />
          </div>
          <Button size="lg" onClick={p.onStart}>
            Start {p.mode === "practice" ? "practice" : "test"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Bank: {p.bank.length} questions · default {p.defaultCount} questions /{" "}
            {p.defaultMinutes} min
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
  const finishRef = useRef(onFinish);
  useEffect(() => {
    finishRef.current = onFinish;
  });

  /** Abandon the run: clear the saved copy and drop back to the setup form. */
  function quit() {
    if (!confirm("Quit this test? Your answers will be lost.")) return;
    saveRun(null);
    setRun(null);
  }

  const timed = run.mode === "test" && run.endAt > 0;
  const remainMs = timed ? Math.max(0, run.endAt - now) : 0;

  // Tick the clock; auto-submit at zero.
  useEffect(() => {
    if (!timed || paused) return;
    if (remainMs <= 0) {
      toast.warning("Time over - submitting automatically");
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
      description={`${run.mode === "practice" ? "Practice" : "Timed test"} · Q${run.idx + 1} of ${run.questions.length}`}
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
            <Button variant="ghost" size="icon" title={paused ? "Resume" : "Pause"} onClick={togglePause}>
              {paused ? <Play /> : <Pause />}
            </Button>
          ) : null}
        </>
      }
    >
      {paused ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-semibold">Paused</p>
            <p className="text-sm text-muted-foreground">Press resume to continue the timer.</p>
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
                  {isFlagged ? "Flagged" : "Flag"}
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
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  {answered}/{run.questions.length} answered
                </span>
                {run.idx + 1 < run.questions.length ? (
                  <Button onClick={() => update({ idx: run.idx + 1 })}>Next</Button>
                ) : (
                  <Button onClick={confirmFinish}>Finish</Button>
                )}
              </div>
            </CardContent>
          </Card>
          <Palette run={run} flagged={flagged} onJump={(i) => update({ idx: i })} />
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={confirmFinish}>
              Submit {run.mode === "practice" ? "practice" : "test"}
            </Button>
            <Button variant="ghost" onClick={quit}>
              Quit
            </Button>
          </div>
        </>
      )}
    </PageShell>
  );
}
function PracticeFeedback({ q, chosen }: { q: Question; chosen: number }) {
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
        {right ? "Correct!" : `Correct answer: ${LETTERS[q.answerIndex]}. ${correctText}`}
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
  return (
    <Suspense
      fallback={
        <PageShell title="Test">
          <Skeleton className="h-80 w-full" />
        </PageShell>
      }
    >
      <TestInner />
    </Suspense>
  );
}
