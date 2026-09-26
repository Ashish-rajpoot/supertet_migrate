"use client";

/* ===========================================================
   app/flashcards/page.tsx - flashcard drill with Leitner boxes
   Port of js/flashcards.js: deck picker, box stats, flip card,
   Knew / Review again rating, weak-only deck, reset progress.
   =========================================================== */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageShell, SectionCard } from "@/components/misc";
import { getAllWithServer } from "@/lib/data/normalize";
import { getCards, resetCards, setCard } from "@/lib/client/store";
import { pick, shuffle } from "@/lib/client/util";
import type { Question } from "@/lib/types";

/** Session key for "revise my mistakes" decks (result page -> here). */
export const WEAK_IDS_KEY = "stp.weakIds";
export function stashWeakIds(ids: string[]) {
  try {
    sessionStorage.setItem(WEAK_IDS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function boxCounts(): number[] {
  const cards = getCards();
  const counts = [0, 0, 0, 0, 0, 0];
  Object.values(cards).forEach((c) => {
    counts[Math.min(5, Math.max(1, c.box))] ++;
  });
  return counts.slice(1);
}

function FlashcardsInner() {
  const params = useSearchParams();
  const weakParam = params.get("weak") === "1";
  const subjectParam = params.get("subject") || "";

  const [bank, setBank] = useState<Question[] | null>(null);
  const [deck, setDeck] = useState<Question[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [subject, setSubject] = useState("");
  const [count, setCount] = useState(20);
  const [weakOnly, setWeakOnly] = useState(weakParam);
  const [boxes, setBoxes] = useState<number[]>([0, 0, 0, 0, 0]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getAllWithServer();
      if (cancelled) return;
      setBank(all);
      setBoxes(boxCounts());
      if (subjectParam) setSubject(subjectParam);
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectParam]);

  const subjects = useMemo(
    () => Array.from(new Set((bank || []).map((q) => q.subject))).sort(),
    [bank]
  );

  const start = useCallback(() => {
    if (!bank) return;
    const cards = getCards();
    let pool = subject ? bank.filter((q) => q.subject === subject) : bank.slice();
    if (weakOnly) pool = pool.filter((q) => !cards[q.id] || cards[q.id].box <= 2);
    if (!pool.length) {
      toast.error(
        weakOnly
          ? "No weak cards in this deck - everything is box 3 or higher."
          : "No cards in this deck."
      );
      return;
    }
    const n = Math.min(Math.max(5, count || 20), 200);
    pool = pool.slice().sort((a, b) => (cards[a.id]?.box || 1) - (cards[b.id]?.box || 1));
    void shuffle;
    setDeck(pick(pool.slice(0, Math.max(n * 3, n)), n));
    setIdx(0);
    setFlipped(false);
  }, [bank, subject, count, weakOnly]);

  // Auto-start a weak deck when arriving from a result page (?weak=1).
  useEffect(() => {
    if (!bank || deck || !weakParam) return;
    try {
      const raw = sessionStorage.getItem(WEAK_IDS_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      if (ids.length) {
        const idSet = new Set(ids.map(String));
        const pool = bank.filter((q) => idSet.has(String(q.id)));
        if (pool.length) {
          setDeck(shuffle(pool).slice(0, 30));
          setIdx(0);
          setFlipped(false);
        }
      }
    } catch {
      /* fall through to the picker */
    }
  }, [bank, deck, weakParam]);
  if (!bank) {
    return (
      <PageShell title="Flashcards" description="Flip cards for quick revision.">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (!bank.length) {
    return (
      <PageShell title="Flashcards" description="Flip cards for quick revision.">
        <EmptyState
          title="No questions yet"
          hint="Add a question bank from the Questions page first."
          action={
            <Button asChild>
              <Link href="/questions">Add questions</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (!deck) {
    return (
      <PageShell title="Flashcards" description="Flip cards for quick revision.">
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="Choose a deck">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Subject</Label>
                <Select
                  value={subject || "__all"}
                  onValueChange={(v) => setSubject(v === "__all" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All subjects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All subjects ({bank.length})</SelectItem>
                    {subjects.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s} ({bank.filter((q) => q.subject === s).length})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fc-count">Cards in this session</Label>
                <Input
                  id="fc-count"
                  type="number"
                  min={5}
                  max={200}
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value, 10) || 20)}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={weakOnly} onCheckedChange={(v) => setWeakOnly(v === true)} />
                Only cards I got wrong before
              </label>
              <Button onClick={start}>Start practising</Button>
            </div>
          </SectionCard>
          <SectionCard
            title="Memory boxes"
            description="Cards you mark “Review again” come back sooner. Cards move up a box each time you get them right."
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!confirm("Reset flashcard progress?")) return;
                  resetCards();
                  setBoxes(boxCounts());
                  toast.success("Flashcard progress reset");
                }}
              >
                <RotateCcw /> Reset
              </Button>
            }
          >
            <BoxBars boxes={boxes} />
          </SectionCard>
        </div>
      </PageShell>
    );
  }

  return (
    <Drill
      deck={deck}
      idx={idx}
      setIdx={setIdx}
      flipped={flipped}
      setFlipped={setFlipped}
      onExit={() => {
        setDeck(null);
        setIdx(0);
        setFlipped(false);
        setBoxes(boxCounts());
      }}
      onRated={() => setBoxes(boxCounts())}
    />
  );
}
function Drill({
  deck,
  idx,
  setIdx,
  flipped,
  setFlipped,
  onExit,
  onRated,
}: {
  deck: Question[];
  idx: number;
  setIdx: (n: number) => void;
  flipped: boolean;
  setFlipped: (v: boolean | ((f: boolean) => boolean)) => void;
  onExit: () => void;
  onRated: () => void;
}) {
  const [touchX, setTouchX] = useState<number | null>(null);

  const rate = useCallback(
    (knew: boolean) => {
      const q = deck[idx];
      if (!q) return;
      const cards = getCards();
      const box = cards[q.id] ? cards[q.id].box : 1;
      setCard(q.id, knew ? box + 1 : 1);
      onRated();
      if (idx + 1 >= deck.length) {
        toast.success("Session complete - well done!");
        onExit();
      } else {
        setIdx(idx + 1);
        setFlipped(false);
      }
    },
    [deck, idx, setIdx, setFlipped, onExit, onRated]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((f: boolean) => !f);
      } else if (e.code === "ArrowRight") rate(true);
      else if (e.code === "ArrowLeft") rate(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rate, setFlipped]);

  const q = deck[idx];
  if (!q) return null;
  const cards = getCards();
  const box = cards[q.id] ? cards[q.id].box : 1;
  const optCount = Math.max(q.options.hi.length, q.options.en.length);

  return (
    <PageShell
      title="Flashcards"
      description={`${idx + 1} / ${deck.length}`}
      actions={
        <Button variant="ghost" size="sm" onClick={onExit}>
          End session
        </Button>
      }
    >
      <FlashProgress value={Math.round((idx / deck.length) * 100)} />
      <div
        className="touch-pan-y"
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX == null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          setTouchX(null);
          if (Math.abs(dx) > 60) rate(dx > 0);
        }}
      >
        <FlashCard
          q={q}
          box={box}
          flipped={flipped}
          onFlip={() => setFlipped((f: boolean) => !f)}
          optCount={optCount}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={() => setFlipped((f: boolean) => !f)}>
          {flipped ? "Hide answer" : "Show answer"}
        </Button>
        <Button variant="destructive" onClick={() => rate(false)}>
          Review again
        </Button>
        <Button onClick={() => rate(true)}>I knew it</Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Swipe right (or →) if you knew it, left (or ←) to revise again.
      </p>
    </PageShell>
  );
}
function FlashProgress({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: value + "%" }} />
    </div>
  );
}

function FlashCard({
  q,
  box,
  flipped,
  onFlip,
  optCount,
}: {
  q: Question;
  box: number;
  flipped: boolean;
  onFlip: () => void;
  optCount: number;
}) {
  return (
    <FlashCardShell onFlip={onFlip}>
      <div className="flex items-center gap-2">
        <Badge variant="outline">
          {q.subject} · {q.topic}
        </Badge>
        <Badge variant="secondary" className="ml-auto">
          box {box}
        </Badge>
      </div>
      {!flipped ? (
        <>
          <FlashStem q={q} large />
          <p className="mt-auto text-center text-sm text-muted-foreground">
            Tap the card (or press Space) to see the answer
          </p>
        </>
      ) : (
        <>
          <FlashStem q={q} />
          <div className="flex flex-col gap-2">
            {Array.from({ length: optCount }).map((_, i) => (
              <FlashOption
                key={i}
                letter={FLASH_LETTERS[i] || String(i + 1)}
                hi={q.options.hi[i] || q.options.en[i] || ""}
                en={q.options.en[i] || ""}
                right={i === q.answerIndex}
              />
            ))}
          </div>
          {q.explanation.hi || q.explanation.en ? (
            <div className="rounded-xl bg-muted/70 px-3 py-2 text-sm">
              <FlashStem q={{ question: q.explanation } as Question} />
            </div>
          ) : null}
        </>
      )}
    </FlashCardShell>
  );
}

const FLASH_LETTERS = ["A", "B", "C", "D", "E", "F"];
function FlashCardShell({ onFlip, children }: { onFlip: () => void; children: React.ReactNode }) {
  return (
    <div
      className="cursor-pointer rounded-2xl border bg-card p-5 shadow-sm transition-transform sm:p-6"
      onClick={onFlip}
    >
      <div className="flex min-h-64 flex-col gap-3">{children}</div>
    </div>
  );
}

function FlashStem({ q, large = false }: { q: Question; large?: boolean }) {
  return <FlashBi value={q.question} large={large} />;
}

function FlashBi({ value, large = false }: { value: { hi?: string; en?: string }; large?: boolean }) {
  return <FlashLang hi={value.hi || ""} en={value.en || ""} large={large} />;
}

function FlashLang({ hi, en, large = false }: { hi: string; en: string; large?: boolean }) {
  const [lang] = useFlashLang();
  const cls = large ? "text-lg font-medium" : "font-medium";
  if (lang === "hi") return <div className={cls}>{hi || en}</div>;
  if (lang === "en") return <div className={cls}>{en || hi}</div>;
  if (hi && en && hi !== en) {
    return (
      <>
        <div className={cls}>{hi}</div>
        <div className="text-sm text-muted-foreground">{en}</div>
      </>
    );
  }
  return <div className={cls}>{hi || en}</div>;
}

function useFlashLang(): ["hi" | "en" | "both"] {
  const [lang, setLang] = useState<"hi" | "en" | "both">("both");
  useEffect(() => {
    const read = () => {
      const v = localStorage.getItem("stp.lang");
      setLang(v === "hi" || v === "en" ? v : "both");
    };
    read();
    window.addEventListener("stp:lang", read);
    return () => window.removeEventListener("stp:lang", read);
  }, []);
  return [lang];
}

function FlashOption({
  letter,
  hi,
  en,
  right,
}: {
  letter: string;
  hi: string;
  en: string;
  right: boolean;
}) {
  return (
    <div
      className={
        "flex items-start gap-3 rounded-xl border px-3 py-2.5 text-[15px] " +
        (right ? "border-emerald-500/60 bg-emerald-500/10" : "border-border")
      }
    >
      <span
        className={
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold " +
          (right ? "border-emerald-600 bg-emerald-600 text-white" : "text-muted-foreground")
        }
      >
        {letter}
      </span>
      <span className="min-w-0 flex-1">
        <FlashLang hi={hi} en={en} />
      </span>
    </div>
  );
}

function BoxBars({ boxes }: { boxes: number[] }) {
  const max = Math.max(1, ...boxes);
  const labels = ["Needs work", "Learning", "Familiar", "Strong", "Mastered"];
  return (
    <div className="flex flex-col gap-2">
      {boxes.map((n, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">
            Box {i + 1} · {labels[i]}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round((n / max) * 100)}%` }}
            />
          </div>
          <span className="w-8 text-right text-xs font-semibold">{n}</span>
        </div>
      ))}
    </div>
  );
}

export default function FlashcardsPage() {
  return (
    <Suspense
      fallback={
        <PageShell title="Flashcards">
          <Skeleton className="h-64 w-full" />
        </PageShell>
      }
    >
      <FlashcardsInner />
    </Suspense>
  );
}
