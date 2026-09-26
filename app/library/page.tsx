"use client";

/* ===========================================================
   app/library/page.tsx - browse the whole bank
   Every subject, its topics and the questions under each one,
   each level expandable. Reads the same merged bank the test
   page uses (seed + this device + the shared server).
   =========================================================== */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { LETTERS, OptionRow } from "@/components/question-view";
import { DifficultyBadge, EmptyState, NameLabel, PageShell } from "@/components/misc";
import { useSyllabusLabels } from "@/lib/data/labels";
import { getAllWithServer } from "@/lib/data/normalize";
import { langOf } from "@/lib/client/util";
import type { Question } from "@/lib/types";

interface TopicGroup {
  topic: string;
  questions: Question[];
}

interface SubjectGroup {
  subject: string;
  count: number;
  topics: TopicGroup[];
}

export default function LibraryPage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<SubjectGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const labels = useSyllabusLabels();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getAllWithServer();
        if (cancelled) return;
        setGroups(groupBySubjectTopic(all));
        setTotal(all.length);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One box searches subject, topic and question text - in every language.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    const has = (label: { primary: string; secondary: string }, en: string) =>
      label.primary.toLowerCase().includes(q) ||
      label.secondary.toLowerCase().includes(q) ||
      en.toLowerCase().includes(q);
    return groups
      .map((g) => ({
        ...g,
        topics: g.topics
          .map((t) => ({
            ...t,
            questions: t.questions.filter(
              (question) =>
                langOf(question.question).toLowerCase().includes(q) ||
                langOf(question.explanation).toLowerCase().includes(q)
            ),
          }))
          .filter((t) => t.questions.length > 0),
      }))
      .filter((g) => {
        if (!g.topics.length) return false;
        if (has(labels.subject(g.subject), g.subject)) return true;
        return g.topics.some((t) => has(labels.topic(g.subject, t.topic), t.topic));
      });
    // labels changes with the selected language, so re-filter when it does.
  }, [groups, query, labels]);

  const shown = filtered.reduce(
    (n, g) => n + g.topics.reduce((m, t) => m + t.questions.length, 0),
    0
  );

  return (
    <PageShell
      title="Question library"
      description="Every subject, topic and question in the bank."
      wide
      actions={
        <Badge variant="secondary">
          {query ? `${shown} of ${total} questions` : `${total} questions`}
        </Badge>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search subjects, topics or question text..."
          aria-label="Search the question bank"
          className="pr-9 pl-9"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : filtered.length ? (
        <div className="flex flex-col gap-2">
          {filtered.map((g) => (
            <SubjectBlock key={g.subject} group={g} query={query} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={groups.length ? "Nothing matches that search" : "The bank is empty"}
          hint={
            groups.length
              ? "Try a different subject, topic or word from a question."
              : "Add questions from the Questions page, or check the seed files in public/data."
          }
        />
      )}
    </PageShell>
  );
}

/** subject -> topic -> questions, both levels sorted by name. */
function groupBySubjectTopic(all: Question[]): SubjectGroup[] {
  const bySubject = new Map<string, Map<string, Question[]>>();
  for (const q of all) {
    if (!bySubject.has(q.subject)) bySubject.set(q.subject, new Map());
    const topics = bySubject.get(q.subject)!;
    if (!topics.has(q.topic)) topics.set(q.topic, []);
    topics.get(q.topic)!.push(q);
  }
  return Array.from(bySubject.entries())
    .map(([subject, topics]) => ({
      subject,
      count: Array.from(topics.values()).reduce((n, list) => n + list.length, 0),
      topics: Array.from(topics.entries())
        .map(([topic, questions]) => ({ topic, questions }))
        .sort((a, b) => a.topic.localeCompare(b.topic)),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/**
 * A subject header that expands to its topics. While the search box has
 * text, matching subjects start open; the first manual click takes over.
 */
function SubjectBlock({ group, query }: { group: SubjectGroup; query: string }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const isOpen = manual ?? Boolean(query.trim());
  const labels = useSyllabusLabels();
  const name = labels.subject(group.subject);

  return (
    <Collapsible open={isOpen} onOpenChange={setManual} className="overflow-hidden rounded-xl border">
      <Card className="rounded-xl border-0 shadow-none">
        <CollapsibleTrigger asChild>
          <CardContent className="flex cursor-pointer items-center gap-3 py-3">
            <ChevronDown
              className={
                "size-4 shrink-0 text-muted-foreground transition-transform " +
                (isOpen ? "rotate-180" : "")
              }
            />
            <NameLabel
              primary={name.primary}
              secondary={name.secondary}
              className="min-w-0 flex-1 font-semibold"
            />
            <Badge variant="secondary" className="shrink-0">
              {group.topics.length} topic{group.topics.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="shrink-0">
              {group.count}
            </Badge>
          </CardContent>
        </CollapsibleTrigger>
      </Card>

      <CollapsibleContent>
        <div className="flex flex-col gap-2 px-2 pt-2 pb-3">
          {group.topics.map((t) => (
            <TopicBlock key={t.topic} topic={t} subject={group.subject} query={query} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A topic header that expands to its questions. */
function TopicBlock({
  topic,
  subject,
  query,
}: {
  topic: TopicGroup;
  subject: string;
  query: string;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const isOpen = manual ?? Boolean(query.trim());
  const labels = useSyllabusLabels();
  const name = labels.topic(subject, topic.topic);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setManual}
      className="overflow-hidden rounded-lg border bg-muted/30"
    >
      <CollapsibleTrigger asChild>
        <div className="flex cursor-pointer items-center gap-2 px-3 py-2">
          <ChevronDown
            className={
              "size-3.5 shrink-0 text-muted-foreground transition-transform " +
              (isOpen ? "rotate-180" : "")
            }
          />
          <NameLabel
            primary={name.primary}
            secondary={name.secondary}
            className="min-w-0 flex-1 font-medium"
          />
          <Badge variant="outline" className="shrink-0 text-xs">
            {topic.questions.length}
          </Badge>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
          {topic.questions.map((q) => (
            <QuestionCard key={q.id} question={q} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One question, with its options and the correct answer marked. */
function QuestionCard({ question: q }: { question: Question }) {
  const hi = q.options.hi || [];
  const en = q.options.en || [];
  const count = Math.max(hi.length, en.length);
  const correct = q.answerIndex;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <DifficultyBadge value={q.difficulty} />
        <span className="text-xs text-muted-foreground">{q.id}</span>
        {q.tags.map((t) => (
          <Badge key={t} variant="secondary" className="text-xs font-normal">
            {t}
          </Badge>
        ))}
      </div>

      <p className="mb-2 font-medium">{langOf(q.question) || "(no text)"}</p>

      <div className="flex flex-col gap-1.5">
        {Array.from({ length: count }, (_, i) => (
          <OptionRow
            key={i}
            letter={LETTERS[i] || String(i + 1)}
            index={i}
            hi={hi[i] || ""}
            en={en[i] || ""}
            tone={i === correct ? "correct" : "default"}
          />
        ))}
      </div>

      {langOf(q.explanation) ? (
        <p className="mt-2 border-l-2 border-emerald-500/60 pl-2 text-sm text-muted-foreground">
          {langOf(q.explanation)}
        </p>
      ) : null}
    </div>
  );
}
