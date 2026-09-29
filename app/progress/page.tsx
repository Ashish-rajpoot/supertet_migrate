"use client";

/* ===========================================================
   app/progress/page.tsx - progress dashboard
   Port of js/analytics-page.js. Three scopes: this device,
   mine (own cloud attempts), all (admin, user-wise roster with
   drill-down). Signed-out visitors get a login gate.
   =========================================================== */
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuthDialog } from "@/components/auth-dialog";
import { TrendChart } from "@/components/charts";
import { EmptyState, PageShell } from "@/components/misc";
import { useAuth } from "@/components/providers";
import {
  breakdown as calcBreakdown,
  byDifficulty as calcDiff,
  groupByStudent,
  summary as calcSummary,
  trend as calcTrend,
  weakTopics as calcWeak,
} from "@/lib/data/analytics";
import {
  clearAttempts as clearLocal,
  dedupeAttempts,
  deleteAttempt as deleteLocal,
  getAttempts as getLocalAttempts,
} from "@/lib/client/store";
import {
  checkServerStatus,
  clearServerAttempts,
  deleteServerAttempt,
  fetchAttempts,
  fetchUserAnalytics,
  type ServerStatus,
} from "@/lib/client/sync";
import { download, fmtDate, fmtTime } from "@/lib/client/util";
import { isAdmin, isLoggedIn } from "@/lib/client/auth-client";
import type { Attempt, StudentRow } from "@/lib/types";

type Scope = "local" | "mine" | "all";

interface ScopeData {
  attempts: Attempt[];
  notice: string;
  roster: StudentRow[] | null;
}

export default function ProgressPage() {
  return (
    <Suspense
      fallback={
        <PageShell title="Progress" description="Scores, weak topics and trends.">
          <Skeleton className="h-64 w-full" />
        </PageShell>
      }
    >
      <ProgressInner />
    </Suspense>
  );
}

function ProgressInner() {
  const { signedIn, ready } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const searchParams = useSearchParams();
  // Admins arrive here from Users -> "View results" with ?userId=<id>.
  const deepUserId = searchParams?.get("userId") || "";
  const deepApplied = useRef(false);
  const [scope, setScope] = useState<Scope>("mine");
  const [selectedUser, setSelectedUser] = useState("");
  const [server, setServer] = useState<ServerStatus>({ online: false, mongo: false });
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ScopeData>({ attempts: [], notice: "", roster: null });

  const doLoad = useCallback(async (sc: Scope, sel: string) => {
    setLoading(true);
    const st = await checkServerStatus();
    setServer(st);

    let list: Attempt[] = [];
    let note = "";
    if (sc === "local") {
      list = getLocalAttempts();
    } else if (!st.online || !st.mongo) {
      // Offline: "mine" falls back to this device, "all" has nothing to show.
      if (sc === "mine" && isLoggedIn()) {
        list = getLocalAttempts();
        note = "Server offline - showing the results saved on this device.";
      } else {
        note = "The shared server is offline, so student results cannot be loaded right now.";
      }
    } else {
      try {
        const res = await fetchAttempts(sc === "all" ? { scope: "all" } : {});
        // One row per attempt id, so the history table cannot repeat itself.
        list = dedupeAttempts(res.attempts || []);
      } catch {
        if (sc === "mine" && isLoggedIn()) {
          list = getLocalAttempts();
          note = "Could not read your cloud results - showing this device instead.";
        } else {
          note = "Could not load student results. Please try again.";
        }
      }
    }

    let roster: StudentRow[] | null = null;
    if (sc === "all") {
      roster = await buildRoster(list);
      if (sel) list = list.filter((a) => a.userId === sel);
    }
    setData({ attempts: list, notice: note, roster });
    setLoading(false);
  }, []);


  useEffect(() => {
    if (!ready) return;
    if (!signedIn) {
      setLoading(false);
      return;
    }
    if (deepApplied.current) return;
    deepApplied.current = true;
    // A ?userId= deep link (admin "View results") opens that student's dashboard.
    if (deepUserId && isAdmin()) {
      setScope("all");
      setSelectedUser(deepUserId);
      void doLoad("all", deepUserId);
      return;
    }
    setScope("mine");
    setSelectedUser("");
    void doLoad("mine", "");
  }, [ready, signedIn, deepUserId, doLoad]);

  if (!ready || loading) {
    return (
      <PageShell title="Progress" description="Scores, weak topics and trends.">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (!signedIn) {
    return (
      <PageShell title="Progress" description="Scores, weak topics and trends.">
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6">
            <h2 className="text-lg font-semibold">Log in to see your progress</h2>
            <p className="text-sm text-muted-foreground">
              Results are kept per account, so the Progress page is only shown after you sign in.
              Your test history stays private to you (admins can see it for support).
            </p>
            <Button onClick={() => setLoginOpen(true)}>Log in</Button>
            <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell title="Progress" description="Scores, weak topics and trends." wide>
      <ScopeBody
        scope={scope}
        selectedUser={selectedUser}
        server={server}
        data={data}
        onScope={(sc) => {
          setScope(sc);
          setSelectedUser("");
          void doLoad(sc, "");
        }}
        onDrill={(userId) => {
          setSelectedUser(userId);
          void doLoad("all", userId);
        }}
        reload={() => void doLoad(scope, selectedUser)}
      />
    </PageShell>
  );
}

/**
 * One row per student. The admin endpoint also lists accounts that have
 * never taken a test, so its rows come first and the grouped extras follow.
 */
async function buildRoster(allAttempts: Attempt[]): Promise<StudentRow[]> {
  const grouped = groupByStudent(allAttempts);
  const toRow = (g: (typeof grouped)[number]): StudentRow => ({
    userId: g.userId,
    name: g.name,
    email: "",
    phone: "",
    role: "user",
    canAddQuestions: false,
    attempts: g.attempts,
    avgPercent: g.avgPercent,
    best: g.best,
    accuracy: g.accuracy,
    totalQuestions: g.total,
    lastAt: g.lastAt,
  });
  if (!isAdmin()) return grouped.map(toRow);
  try {
    const srv = await fetchUserAnalytics();
    const known = new Set((srv.students || []).map((r) => r.userId));
    return [
      ...(srv.students || []),
      ...grouped.filter((g) => g.userId && !known.has(g.userId)).map(toRow),
    ];
  } catch {
    return grouped.map(toRow);
  }
}

/* ------------------------------------------------------------- view ---- */

function ScopeBody({
  scope,
  selectedUser,
  server,
  data,
  onScope,
  onDrill,
  reload,
}: {
  scope: Scope;
  selectedUser: string;
  server: ServerStatus;
  data: ScopeData;
  onScope: (sc: Scope) => void;
  onDrill: (userId: string) => void;
  reload: () => void;
}) {
  const router = useRouter();
  const viewing = selectedUser
    ? (data.roster || []).find((r) => r.userId === selectedUser)
    : null;
  const title =
    scope === "all"
      ? selectedUser
        ? "Student progress"
        : "All students (user-wise)"
      : scope === "mine"
        ? "Your progress"
        : "This device";

  const s = calcSummary(data.attempts);
  const t = calcTrend(data.attempts);
  const bd = calcBreakdown(data.attempts);
  const weak = calcWeak(data.attempts, 3, 8);
  const diff = calcDiff(data.attempts);

  const statusBadge = server.mongo ? (
    <Badge className="bg-emerald-600">MongoDB connected</Badge>
  ) : server.online ? (
    <Badge variant="secondary">Server running (MongoDB offline)</Badge>
  ) : (
    <Badge variant="outline">Local mode (offline)</Badge>
  );

  async function deleteOne(a: Attempt) {
    if (scope === "local") {
      deleteLocal(a.id);
      // Keep the account copy in step when possible; a refusal is not fatal.
      if (server.mongo && isLoggedIn()) {
        try {
          await deleteServerAttempt(a.id);
        } catch {
          /* ignore */
        }
      }
      toast.success("Result deleted");
    } else {
      try {
        await deleteServerAttempt(a.id);
        toast.success("Result deleted");
      } catch {
        toast.error("Could not delete this result");
      }
    }
    reload();
  }

  async function clearAll() {
    const cloud = scope !== "local";
    const msg = cloud
      ? scope === "all"
        ? "Delete every student's results from the shared database? This cannot be undone."
        : "Delete all of your saved results from the shared database? This cannot be undone."
      : "Delete all saved results on this device? This cannot be undone.";
    if (!confirm(msg)) return;

    if (cloud) {
      try {
        const res = await clearServerAttempts();
        toast.success("Cleared " + res.count + " result(s)");
      } catch {
        toast.error("Could not clear the results. Please log in again.");
      }
    } else {
      clearLocal();
      if (
        server.mongo &&
        isLoggedIn() &&
        confirm("Also clear your saved results from the shared database?")
      ) {
        try {
          await clearServerAttempts();
        } catch {
          toast.error("Cloud clear failed - the server refused the request");
        }
      }
      toast.success("Results cleared");
    }
    reload();
  }

  function exportCsv() {
    const head = "date,test,score,total,percent,correct,wrong,skipped,seconds\n";
    const body = data.attempts
      .map((a) =>
        [
          fmtDate(a.at),
          '"' + String(a.label).replace(/"/g, '""') + '"',
          a.score,
          a.total,
          a.percent,
          a.correct,
          a.wrong,
          a.skipped,
          a.timeTaken,
        ].join(",")
      )
      .join("\n");
    download("supertet-results.csv", head + body, "text/csv");
  }

  function exportJson() {
    download("supertet-results.json", JSON.stringify(data.attempts, null, 2));
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">
              {title}
              {viewing ? " · " + viewing.name : ""}
            </h2>
            <span className="ml-auto">{statusBadge}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={scope === "local" ? "default" : "ghost"}
              onClick={() => onScope("local")}
            >
              This device ({getLocalAttempts().length})
            </Button>
            <Button
              size="sm"
              variant={scope === "mine" ? "default" : "ghost"}
              onClick={() => onScope("mine")}
            >
              My cloud results
            </Button>
            {isAdmin() ? (
              <Button
                size="sm"
                variant={scope === "all" ? "default" : "ghost"}
                onClick={() => onScope("all")}
              >
                All students
              </Button>
            ) : null}
          </div>

          {data.notice ? (
            <p className="text-sm text-amber-600 dark:text-amber-500">{data.notice}</p>
          ) : null}

          {s.attempts ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <ProgStat label="Tests" value={s.attempts} />
                <ProgStat label="Average" value={`${s.avgScore}%`} />
                <ProgStat label="Best" value={`${s.bestScore}%`} />
                <ProgStat label="Day streak" value={s.streakDays} />
              </div>
              <p className="text-sm text-muted-foreground">
                Overall accuracy {s.accuracy}% across {s.totalQ} questions ·{" "}
                {Math.round(s.totalTime / 60)} minutes of practice
              </p>
            </>
          ) : (
            <EmptyState
              title="No results in this view yet"
              hint="Take a test first - your result will appear here."
              action={
                <Button asChild>
                  <Link href="/test">Take a test</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      {scope === "all" ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <h3 className="font-semibold">Students (user-wise)</h3>
            {selectedUser ? (
              <p className="text-sm text-muted-foreground">
                Showing one student.{" "}
                <Button size="sm" variant="ghost" onClick={() => onDrill("")}>
                  Show all students
                </Button>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Every account with its own totals. Choose “View” to open one student’s dashboard.
              </p>
            )}
            <RosterTable roster={data.roster || []} selected={selectedUser} onView={onDrill} />
          </CardContent>
        </Card>
      ) : null}

      {s.attempts ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-5">
              <h3 className="font-semibold">Score trend (last {t.length} tests)</h3>
              <TrendChart points={t} />
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="flex flex-col gap-2 pt-5">
                <h3 className="font-semibold">Subject-wise accuracy</h3>
                <BarList rows={bd.subjects} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-5">
                <h3 className="font-semibold">Topic-wise accuracy</h3>
                <BarList rows={bd.topics.slice(0, 12)} />
              </CardContent>
            </Card>
          </div>

          <WeakCard weak={weak} />

          {diff.length ? (
            <Card>
              <CardContent className="flex flex-col gap-2 pt-5">
                <h3 className="font-semibold">By difficulty</h3>
                <BarList
                  rows={diff.map((d) => ({
                    key: d.key,
                    correct: d.correct,
                    total: d.total,
                    accuracy: d.accuracy,
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}

          <HistoryCard
            attempts={data.attempts}
            showStudent={scope === "all"}
            onOpen={(id) => router.push(`/result/${id}`)}
            onDelete={deleteOne}
            onExportCsv={exportCsv}
            onExportJson={exportJson}
            onClear={clearAll}
          />
        </>
      ) : null}
    </div>
  );
}

function ProgStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function BarList({
  rows,
}: {
  rows: { key: string; correct: number; total: number; accuracy: number }[];
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Not enough data yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key} className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate font-medium">{r.key}</span>
            <span className="ml-2 shrink-0 text-muted-foreground">
              {r.correct}/{r.total} · {r.accuracy}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={
                "h-full rounded-full " + (r.accuracy >= 60 ? "bg-emerald-500" : "bg-red-500")
              }
              style={{ width: r.accuracy + "%" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RosterTable({
  roster,
  selected,
  onView,
}: {
  roster: StudentRow[];
  selected: string;
  onView: (userId: string) => void;
}) {
  if (!roster.length) return <p className="text-sm text-muted-foreground">No students yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Tests</TableHead>
            <TableHead>Avg</TableHead>
            <TableHead>Best</TableHead>
            <TableHead>Accuracy</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {roster.map((r) => (
            <TableRow key={r.userId} className={r.userId === selected ? "bg-muted/60" : ""}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>{r.attempts}</TableCell>
              <TableCell>{r.avgPercent}%</TableCell>
              <TableCell>{r.best}%</TableCell>
              <TableCell>{r.accuracy}%</TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {r.lastAt ? fmtDate(r.lastAt) : "—"}
              </TableCell>
              <TableCell>
                <Button size="sm" variant="ghost" onClick={() => onView(r.userId)}>
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function WeakCard({ weak }: { weak: { key: string; accuracy: number; total: number }[] }) {
  const router = useRouter();
  if (!weak.length) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-5">
        <h3 className="font-semibold">Topics needing revision</h3>
        <div className="flex flex-wrap gap-2">
          {weak.map((w) => (
            <Badge key={w.key} variant="outline">
              {w.key} · {w.accuracy}%
            </Badge>
          ))}
        </div>
        <div>
          <Button size="sm" variant="outline" onClick={() => router.push("/flashcards?weak=1")}>
            Revise with flashcards
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryCard({
  attempts,
  showStudent,
  onOpen,
  onDelete,
  onExportCsv,
  onExportJson,
  onClear,
}: {
  attempts: Attempt[];
  showStudent: boolean;
  onOpen: (id: string) => void;
  onDelete: (a: Attempt) => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onClear: () => void;
}) {
  const rows = attempts.slice().reverse().slice(0, 60);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <h3 className="font-semibold">History</h3>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                {showStudent ? <TableHead>Student</TableHead> : null}
                <TableHead>When</TableHead>
                <TableHead>Test</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>%</TableHead>
                <TableHead>Time</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  {showStudent ? <TableCell>{a.student || "Anonymous"}</TableCell> : null}
                  <TableCell className="whitespace-nowrap text-xs">{fmtDate(a.at)}</TableCell>
                  <TableCell className="max-w-48 truncate">{a.label}</TableCell>
                  <TableCell>
                    {a.correct}/{a.total}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.percent >= 60 ? "secondary" : "destructive"}>
                      {a.percent}%
                    </Badge>
                  </TableCell>
                  <TableCell>{fmtTime(a.timeTaken)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button size="sm" variant="link" onClick={() => onOpen(a.id)}>
                      Open
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(a)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onExportCsv}>
            Export history as CSV
          </Button>
          <Button size="sm" variant="outline" onClick={onExportJson}>
            Export history as JSON
          </Button>
          <Button size="sm" variant="destructive" onClick={onClear}>
            Clear all results
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

