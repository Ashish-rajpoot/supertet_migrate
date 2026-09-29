"use client";

/* ===========================================================
   app/offline/page.tsx - offline fallback page
   Precached by public/sw.js and served as the last resort for
   navigations when the network is unreachable. Links only to
   routes that fully work without a network (bundled seed bank
   + this-device storage), so it never dead-ends.
   =========================================================== */
import Link from "next/link";
import { WifiOff, BookOpen, Layers, PlayCircle, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/misc";
import { T, useT } from "@/lib/i18n/t";

const LINKS = [
  { href: "/test", icon: PlayCircle, label: "nav.test", hint: "nav.hint.test" },
  { href: "/flashcards", icon: Layers, label: "nav.flashcards", hint: "nav.hint.flashcards" },
  { href: "/library", icon: BookOpen, label: "nav.library", hint: "nav.hint.library" },
  { href: "/progress", icon: TrendingUp, label: "nav.progress", hint: "nav.hint.progress" },
] as const;

export default function OfflinePage() {
  const { t } = useT();
  return (
    <PageShell title={t("offline.title")} description={t("offline.desc")}>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <WifiOff className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            <T k="offline.hint" />
          </p>
          <div className="grid w-full gap-2 sm:grid-cols-2">
            {LINKS.map((l) => (
              <Button key={l.href} variant="outline" className="h-auto justify-start gap-3 p-3" asChild>
                <Link href={l.href}>
                  <l.icon className="size-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 text-left">
                    <span className="block truncate font-semibold">
                      <T k={l.label} />
                    </span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      <T k={l.hint} />
                    </span>
                  </span>
                </Link>
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <T k="offline.home" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  );
}
