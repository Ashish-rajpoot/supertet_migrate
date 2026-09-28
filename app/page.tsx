"use client";

/* ===========================================================
   app/page.tsx - landing page: bank summary + quick start
   Mirrors js/home.js: stat cards, subject rows linking into a
   pre-filtered test, action cards, and the editor shortcut.
   =========================================================== */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Layers, PlayCircle, TrendingUp, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageShell } from "@/components/misc";
import { metaFrom, getAllWithServer, type BankMeta } from "@/lib/data/normalize";
import { summary } from "@/lib/data/analytics";
import { getAttempts } from "@/lib/client/store";
import { canAddQuestions } from "@/lib/client/auth-client";
import { useAuth } from "@/components/providers";
import { T, useT } from "@/lib/i18n/t";

export default function HomePage() {
  const { signedIn, mayEdit, ready } = useAuth();
  const { t } = useT();
  const [loading, setLoading] = useState(true);
  const [bank, setBank] = useState<BankMeta | null>(null);

  // Fetching the bank is expensive, so this must run once - not on every
  // language change. Keep the latest translator in a ref so the error path
  // can still report in the user's chosen language.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Count the whole bank - seed + this device + the shared server -
        // so the number here matches what a test would actually draw from.
        const all = await getAllWithServer();
        if (cancelled) return;
        setBank(metaFrom(all));
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : tRef.current("home.toast.loadFail")
          );
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
    <PageShell title={t("home.title")} description={t("home.desc")}>
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
          title={t("home.empty.title")}
          hint={editable ? t("home.empty.edit") : t("home.empty.admin")}
          action={
            editable ? (
              <Link
                href="/questions"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <Upload className="size-4" /> <T k="footer.addQuestions" />
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
                  {t("home.stat.subjects")}
                </div>
                <div className="text-2xl font-bold">{bank.subjects.length}</div>
              </div>
              {signedIn ? (
                <>
                  <div>
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {t("home.stat.attempts")}
                    </div>
                    <div className="text-2xl font-bold">{stats.attempts}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {t("home.stat.best")}
                    </div>
                    <div className="text-2xl font-bold">{stats.bestScore}%</div>
                  </div>
                </>
              ) : (
                <div className="col-span-2">
                  <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("home.stat.yourResults")}
                  </div>
                  <div className="mt-1 text-[15px] font-medium">
                    {t("home.signInCta")}
                  </div>
                </div>
              )}
            </CardContent>
            {signedIn ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                {last ? (
                  <>
                    {t("home.lastTest")}: <strong className="text-foreground">{last.label}</strong> ·{" "}
                    {last.score}/{last.total} ({last.percent}%) ·{" "}
                    <Link href={`/result/${last.id}`} className="text-primary hover:underline">
                      {t("home.openResult")}
                    </Link>
                  </>
                ) : (
                  t("home.noTestYet")
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
  const { t } = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Link href="/flashcards">
        <Card className="h-full transition-colors hover:border-primary/50">
          <CardContent className="flex items-start gap-3 pt-5">
            <Layers className="mt-0.5 size-6 shrink-0 text-primary" />
            <div>
              <div className="font-semibold">{t("home.card.flashcards")}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("home.card.flashcardsDesc")}
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/test">
        <Card className="h-full transition-colors hover:border-primary/50">
          <CardContent className="flex items-start gap-3 pt-5">
            <PlayCircle className="mt-0.5 size-6 shrink-0 text-primary" />
            <div>
              <div className="font-semibold">{t("home.card.test")}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("home.card.testDesc")}
              </p>
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
                <div className="font-semibold">{t("home.card.progress")}</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("home.card.progressDesc")}
                </p>
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
  const { t } = useT();
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">{t("home.subjectList")}</h2>
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
                  {t("home.rowMeta", { n: sub.count, t: sub.topics.length })}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {t("home.testCta")} <ArrowRight className="size-3.5" />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function HomeOwnerCard() {
  const { t } = useT();
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">{t("home.owner")}</h2>
      <Card>
        <Link
          href="/questions"
          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("home.ownerAdd")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("home.ownerAddDesc")}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-semibold">
            {t("home.open")}
          </span>
        </Link>
      </Card>
    </div>
  );
}

