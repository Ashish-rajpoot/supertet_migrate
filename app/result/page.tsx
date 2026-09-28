"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageShell } from "@/components/misc";
import { ResultView } from "./ResultView";
import { getAttempts } from "@/lib/client/store";
import { useT } from "@/lib/i18n/t";
import type { Attempt } from "@/lib/types";

/** /result - the most recent attempt on this device. */
export default function ResultLatestPage() {
  const { t } = useT();
  const [state, setState] = useState<{ loading: boolean; attempt: Attempt | null }>({
    loading: true,
    attempt: null,
  });

  useEffect(() => {
    const list = getAttempts();
    setState({ loading: false, attempt: list[list.length - 1] || null });
  }, []);

  if (state.loading) {
    return (
      <PageShell title={t("result.pageTitle")}>
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }
  if (!state.attempt) {
    return (
      <PageShell title={t("result.pageTitle")}>
        <EmptyState
          title={t("result.noResults")}
          hint={t("result.noResultsHint")}
          action={
            <Button asChild>
              <Link href="/test">{t("common.takeTest")}</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }
  return <ResultView attempt={state.attempt} />;
}
