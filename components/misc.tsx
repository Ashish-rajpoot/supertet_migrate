"use client";

/* ===========================================================
   components/misc.tsx - small shared bits: page shell, stat
   cards, empty states, difficulty/subject badges, footer.

   Every display preference (text size, colour theme, language)
   lives in the floating accessibility dock, so the footer only
   carries the link that brings a dismissed dock back.
   =========================================================== */
import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Accessibility, Inbox, Mail } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLang, useSettings } from "./providers";
import { T, useT } from "@/lib/i18n/t";

/* ---------------- display preferences ----------------
   The theme, the text size and the language all live in the floating
   accessibility dock (components/a11y-widget.tsx). The footer only
   keeps the link that brings the dock back when it has been
   dismissed, so there is exactly one place to change how the app
   looks and reads - and no second copy of the theme list to fall out
   of step. */

/** Hindi / English / both, for every bilingual field. */
export function LangSelect({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLang();
  const { t } = useT();
  return (
    <Select value={lang} onValueChange={(v) => setLang(v as "hi" | "en" | "both")}>
      <SelectTrigger
        size="sm"
        className={cn("gap-2", compact ? "w-full" : "w-[168px]")}
        aria-label={t("lang.label")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="both">हिंदी + English</SelectItem>
        <SelectItem value="hi">हिंदी</SelectItem>
        <SelectItem value="en">English</SelectItem>
      </SelectContent>
    </Select>
  );
}

/* ---------------- page shell ---------------- */

/** Centered page container with consistent rhythm. */
export function PageShell({
  title,
  description,
  actions,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto w-full px-4 py-6", wide ? "max-w-6xl" : "max-w-4xl")}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="pt-5">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <Inbox className="size-8 text-muted-foreground" />
        <div className="font-semibold">{title}</div>
        {hint ? <p className="max-w-md text-sm text-muted-foreground">{hint}</p> : null}
        {action}
      </CardContent>
    </Card>
  );
}

const DIFF_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  easy: "secondary",
  medium: "default",
  hard: "destructive",
};

export function DifficultyBadge({ value }: { value: string }) {
  return <Badge variant={DIFF_VARIANT[value] ?? "outline"}>{value}</Badge>;
}

export function SubjectBadge({ value }: { value: string }) {
  return <Badge variant="outline">{value}</Badge>;
}

/**
 * A subject / topic name in the active language. When both languages are
 * selected the second one is shown underneath in muted text, the same way
 * bilingual question text is.
 */
export function NameLabel({
  primary,
  secondary,
  className,
  secondaryClassName,
}: {
  primary: string;
  secondary?: string;
  className?: string;
  secondaryClassName?: string;
}) {
  if (!secondary) return <span className={className}>{primary}</span>;
  return (
    <>
      <span className={className}>{primary}</span>
      <span className={cn("block truncate text-xs font-normal text-muted-foreground", secondaryClassName)}>
        {secondary}
      </span>
    </>
  );
}

export function SiteFooter() {
  const { t } = useT();
  const { dockHidden, setDockHidden } = useSettings();
  return (
    <footer className="border-t py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 text-center">
        <p className="text-sm text-muted-foreground">{t("footer.tagline")}</p>

        {/* Display preferences: everything lives in the accessibility dock,
            so the footer only needs a way back to it once dismissed. */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {dockHidden ? (
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setDockHidden(false);
                toast.success(t("a11y.shown"));
              }}
            >
              <Accessibility />
              <T k="a11y.show" />
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="link" size="sm" asChild>
            <Link href="/contact">
              <Mail />
              <T k="nav.contact" />
            </Link>
          </Button>
          <Button variant="link" size="sm" asChild>
            <Link href="/questions">
              <T k="footer.addQuestions" />
            </Link>
          </Button>
          <Button variant="link" size="sm" asChild>
            <a href="/templates/questions-template.xlsx">
              <T k="footer.excelTemplate" />
            </a>
          </Button>
          <Button variant="link" size="sm" asChild>
            <a href="/data/subjects.json">
              <T k="footer.syllabusJson" />
            </a>
          </Button>
        </div>
      </div>
    </footer>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-lg">{title}</CardTitle>
          {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
