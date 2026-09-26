"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageShell } from "@/components/misc";
import { ResultView } from "../ResultView";
import { addAttempt, getAttempt } from "@/lib/client/store";
import { fetchAttempt } from "@/lib/client/sync";
import { isLoggedIn } from "@/lib/client/auth-client";
import type { Attempt } from "@/lib/types";

/** /result/[id] - one shared or local result. */
export default function ResultByIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<{ loading: boolean; attempt: Attempt | null }>({
    loading: true,
    attempt: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let attempt = getAttempt(id);
      if (!attempt) {
        // Shared link from another device - try the server, then cache locally.
        const remote = await fetchAttempt(id);
        if (remote && !cancelled) {
          attempt = remote as Attempt;
          addAttempt(attempt);
        }
      }
      if (!cancelled) setState({ loading: false, attempt });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.loading) {
    return (
      <PageShell title="Result">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }
  if (!state.attempt) {
    return (
      <PageShell title="Result">
        <EmptyState
          title="Result not found"
          hint={
            isLoggedIn()
              ? "This result is not stored on this device or the server. Open Progress to see saved tests."
              : "This result is not stored on this device or the server. Log in to see your saved tests."
          }
          action={
            isLoggedIn() ? (
              <Button asChild>
                <Link href="/progress">Open Progress</Link>
              </Button>
            ) : undefined
          }
        />
      </PageShell>
    );
  }
  return <ResultView attempt={state.attempt} />;
}
