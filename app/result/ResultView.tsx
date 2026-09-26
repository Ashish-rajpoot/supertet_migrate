"use client";

/* ===========================================================
   app/result/ResultView.tsx - result view (shared)
   Port of js/result.js: grade pill, stat cards, subject bars,
   weak-topic chips, copy/share/print/retry/practice-weak
   actions, and the filterable full review.
   =========================================================== */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Printer, RotateCcw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BiText, LETTERS, OptionRow } from "@/components/question-view";
import { PageShell } from "@/components/misc";
import { reportText } from "@/lib/data/analytics";
import { download, fmtDate, fmtTime } from "@/lib/client/util";
import { stashWeakIds } from "@/app/flashcards/page";
import type { Attempt, AttemptDetail } from "@/lib/types";

function gradePhrase(p: number): { txt: string; tone: "ok" | "warn" | "bad" } {
  if (p >= 85) return { txt: "Excellent", tone: "ok" };
  if (p >= 70) return { txt: "Good", tone: "ok" };
  if (p >= 50) return { txt: "Average - keep going", tone: "warn" };
  return { txt: "Needs revision", tone: "bad" };
}

function copyText(text: string) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied - paste it in WhatsApp"),
      () => fallbackCopy(text)
    );
  } else fallbackCopy(text);
}

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    toast.success("Copied");
  } catch {
    toast.error("Copy failed - downloading instead");
    download("result.txt", text, "text/plain");
  }
  ta.remove();
}

function ResultStat({
  label,
  value,
  good = false,
  bad = false,
  muted = false,
}: {
  label: string;
  value: React.ReactNode;
  good?: boolean;
  bad?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={
          "text-2xl font-bold " +
          (good ? "text-emerald-600 " : "") +
          (bad ? "text-red-600 " : "") +
          (muted ? "text-muted-foreground " : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
function ReviewCard({ d, n }: { d: AttemptDetail; n: number }) {
  const badge =
    d.status === "correct" ? (
      <Badge className="bg-emerald-600">Correct</Badge>
    ) : d.status === "wrong" ? (
      <Badge variant="destructive">Wrong</Badge>
    ) : (
      <Badge variant="secondary">Skipped</Badge>
    );
  const count = Math.max(d.options.hi.length, d.options.en.length);
  const expl = d.explanation && (d.explanation.hi || d.explanation.en);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Q{n}</Badge>
          <span className="text-xs text-muted-foreground">
            {d.subject} · {d.topic}
          </span>
          <span className="ml-auto">{badge}</span>
        </div>
        <BiText value={d.question} className="font-medium" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: count }).map((_, k) => (
            <OptionRow
              key={k}
              letter={LETTERS[k] || String(k + 1)}
              index={k}
              hi={d.options.hi[k] || d.options.en[k] || ""}
              en={d.options.en[k] || ""}
              // Green for the right answer, red for the option the student
              // actually chose when it was wrong. A correct pick stays green.
              tone={
                k === d.answerIndex
                  ? "correct"
                  : d.chosenIndex != null && k === d.chosenIndex
                    ? "wrong"
                    : "default"
              }
            />
          ))}
        </div>
        {expl ? (
          <div className="rounded-xl bg-muted/70 px-3 py-2 text-sm">
            <BiText value={d.explanation} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
export function ResultView({ attempt }: { attempt: Attempt }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const g = gradePhrase(attempt.percent);
  const avgSec = attempt.total ? Math.round(attempt.timeTaken / attempt.total) : 0;
  const details = (attempt.details || []).filter(
    (d) => filter === "all" || d.status === filter
  );

  function share() {
    const text = reportText(attempt);
    const url = window.location.href;
    const nav = navigator as Navigator & { share?: (d: object) => Promise<void> };
    if (nav.share) {
      nav
        .share({ title: attempt.label + " - SuperTET Prep result", text, url })
        .catch(() => copyText(text + "\n" + url));
    } else {
      copyText(text + "\n" + url);
    }
  }

  function practiceWeak() {
    const ids = (attempt.details || [])
      .filter((d) => d.status !== "correct")
      .map((d) => d.id)
      .slice(0, 30);
    if (!ids.length) {
      toast.success("Nothing to revise - well done!");
      return;
    }
    stashWeakIds(ids);
    router.push("/flashcards?weak=1");
  }

  return (
    <PageShell
      title={attempt.label}
      description={`${fmtDate(attempt.at)} · ${attempt.mode === "practice" ? "Practice" : "Timed test"}${attempt.negative ? " · negative marking" : ""}`}
      actions={<Badge variant={g.tone === "bad" ? "destructive" : "secondary"}>{g.txt}</Badge>}
    >
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-5 sm:grid-cols-4">
          <ResultStat label="Score" value={`${attempt.score}/${attempt.total}`} />
          <ResultStat label="Percentage" value={`${attempt.percent}%`} />
          <ResultStat label="Time taken" value={fmtTime(attempt.timeTaken)} />
          <ResultStat label="Avg / question" value={`${avgSec}s`} />
        </CardContent>
        <CardContent className="grid grid-cols-3 gap-4 border-t pt-4">
          <ResultStat label="Correct" value={attempt.correct} good />
          <ResultStat label="Wrong" value={attempt.wrong} bad />
          <ResultStat label="Skipped" value={attempt.skipped} muted />
        </CardContent>
      </Card>

      {(attempt.breakdown || []).length ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <h2 className="font-semibold">Subject-wise</h2>
            {(attempt.breakdown || []).map((b) => (
              <div key={b.subject} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{b.subject}</span>
                  <span className="text-muted-foreground">
                    {b.correct}/{b.total} · {b.accuracy}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      "h-full rounded-full " + (b.accuracy >= 60 ? "bg-emerald-500" : "bg-red-500")
                    }
                    style={{ width: b.accuracy + "%" }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {(attempt.weakTopics || []).length ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <h2 className="font-semibold">Need revision</h2>
            <div className="flex flex-wrap gap-2">
              {(attempt.weakTopics || []).map((t) => (
                <Badge key={t.subject + "/" + t.topic} variant="outline">
                  {t.topic} · {t.accuracy}%
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => copyText(reportText(attempt))}>
          <Copy /> Copy report
        </Button>
        <Button variant="outline" size="sm" onClick={share}>
          <Share2 /> Share
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
        <Button variant="outline" size="sm" onClick={() => router.push("/test")}>
          <RotateCcw /> Retry
        </Button>
        <Button size="sm" onClick={practiceWeak}>
          Practice weak
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Review ({details.length})</h2>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="correct">Correct</SelectItem>
            <SelectItem value="wrong">Wrong</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {details.length ? (
        <div className="flex flex-col gap-3">
          {details.map((d, i) => (
            <ReviewCard key={d.id + "-" + i} d={d} n={i + 1} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      )}
    </PageShell>
  );
}
