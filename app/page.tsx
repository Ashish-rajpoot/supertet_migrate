"use client";

/* ===========================================================
   app/page.tsx - landing page: bank summary + quick start
   Mirrors js/home.js: stat cards, subject rows linking into a
   pre-filtered test, action cards, and the editor shortcut.
   =========================================================== */
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Layers, PlayCircle, TrendingUp, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageShell } from "@/components/misc";
import { meta, getAllWithServer } from "@/lib/data/normalize";
import { summary } from "@/lib/data/analytics";
import { getAttempts } from "@/lib/client/store";
import { canAddQuestions } from "@/lib/client/auth-client";
import { useAuth } from "@/components/providers";

interface BankMeta {
  total: number;
  subjects: { subject: string; count: number; topics: string[] }[];
}

export default function HomePage() {
  const { signedIn, mayEdit, ready } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bank, setBank] = useState<BankMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getAllWithServer();
        if (cancelled) return;
        setBank(await meta());
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Question bank failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = summary(getAttempts());
  const attempts = getAttempts();
  const last = attempts[attempts.length - 1];
  const editable = mayEdit || canAddQuestions();
  return (
    <PageShell
      title="SuperTET Prep"
      description="Bilingual practice tests, flashcards and progress tracking - free, works offline."
    >
      {loading || !ready ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 w-full" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      ) : !bank || bank.total === 0 ? (
        <EmptyState
          title="No questions yet"
          hint={
            editable
              ? "Load a question bank from the Questions page first."
              : "The admin has not added a question bank yet."
          }
          action={
            editable ? (
              <Link
                href="/questions"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <Upload className="size-4" /> Add questions
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-5 sm:grid-cols-4">
              <div>
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Questions
                </div>
                <div className="text-2xl font-bold">{bank.total}</div>
              </div>
              <div>
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Subjects
                </div>
                <div className="text-2xl font-bold">{bank.subjects.length}</div>
              </div>
              {signedIn ? (
                <>
                  <div>
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Tests taken
                    </div>
                    <div className="text-2xl font-bold">{stats.attempts}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Best score
                    </div>
                    <div className="text-2xl font-bold">{stats.bestScore}%</div>
                  </div>
                </>
              ) : (
                <div className="col-span-2">
                  <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Your results
                  </div>
                  <div className="mt-1 text-[15px] font-medium">
                    Log in to save tests and see your progress
                  </div>
                </div>
              )}
            </CardContent>
            {signedIn ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                {last ? (
                  <>
                    Last test: <strong className="text-foreground">{last.label}</strong> ·{" "}
                    {last.score}/{last.total} ({last.percent}%) ·{" "}
                    <Link href={`/result/${last.id}`} className="text-primary hover:underline">
                      open result
                    </Link>
                  </>
                ) : (
                  "No test taken yet. Start with flashcards, then try a test."
                )}
              </p>
            ) : null}
          </Card>
          <HomeActionCards signedIn={signedIn} />
          <HomeSubjectList subjects={bank.subjects} />
          {editable ? <HomeOwnerCard /> : null}
        </>
      )}
    </PageShell>
  );
}

function HomeActionCards({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Link href="/flashcards">
        <Card className="h-full transition-colors hover:border-primary/50">
          <CardContent className="flex items-start gap-3 pt-5">
            <Layers className="mt-0.5 size-6 shrink-0 text-primary" />
            <div>
              <div className="font-semibold">Flashcards</div>
              <p className="mt-1 text-sm text-muted-foreground">Quick revision with memory boxes.</p>
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/test">
        <Card className="h-full transition-colors hover:border-primary/50">
          <CardContent className="flex items-start gap-3 pt-5">
            <PlayCircle className="mt-0.5 size-6 shrink-0 text-primary" />
            <div>
              <div className="font-semibold">Take a test</div>
              <p className="mt-1 text-sm text-muted-foreground">Pick subjects, timer and key.</p>
            </div>
          </CardContent>
        </Card>
      </Link>
      {signedIn ? (
        <Link href="/progress">
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardContent className="flex items-start gap-3 pt-5">
              <TrendingUp className="mt-0.5 size-6 shrink-0 text-primary" />
              <div>
                <div className="font-semibold">Progress</div>
                <p className="mt-1 text-sm text-muted-foreground">Score trend and weak topics.</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      ) : null}
    </div>
  );
}
function HomeSubjectList({
  subjects,
}: {
  subjects: { subject: string; count: number; topics: string[] }[];
}) {
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Start with a subject</h2>
      <Card>
        <CardContent className="divide-y p-0">
          {subjects.map((sub) => (
            <Link
              key={sub.subject}
              href={`/test?subject=${encodeURIComponent(sub.subject)}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{sub.subject}</span>
                <span className="block text-xs text-muted-foreground">
                  {sub.count} questions · {sub.topics.length} topics
                </span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                Test <ArrowRight className="size-3.5" />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function HomeOwnerCard() {
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">For the site owner</h2>
      <Card>
        <Link
          href="/questions"
          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Add questions (Excel / JSON)</span>
            <span className="block text-xs text-muted-foreground">
              Bulk upload, preview, validate and export the bank
            </span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-semibold">
            Open
          </span>
        </Link>
      </Card>
    </div>
  );
}

