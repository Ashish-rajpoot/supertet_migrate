"use client";

/* ===========================================================
   app/library/page.tsx - the bank, and the place to change it
   Every subject, its topics and the questions under each one, each
   level expandable. Reads the same merged bank the test page uses
   (seed + this device + the shared server), and because it is the
   only screen that sees all three, it is also where the bank is
   maintained: add a question, fix one, delete one - or clear a whole
   topic or subject and decide where its questions go first.

   Writes go to this device first and to the shared bank second
   (lib/client/question-crud.ts), so work is never lost just because
   the signal is.
   =========================================================== */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { LETTERS, OptionRow } from "@/components/question-view";
import { AuthDialog } from "@/components/auth-dialog";
import { DeleteScopeDialog, type DeleteChoice } from "@/components/delete-scope-dialog";
import { QuestionEditorDialog } from "@/components/question-editor";
import { DifficultyBadge, EmptyState, NameLabel, PageShell } from "@/components/misc";
import { useAuth } from "@/components/providers";
import { invalidateSyllabus, loadSyllabus, useSyllabusLabels } from "@/lib/data/labels";
import { getAllWithServer } from "@/lib/data/normalize";
import { buildSubjectChoices, buildTopicChoices } from "@/lib/data/ai-prompt";
import { canAddQuestions } from "@/lib/client/auth-client";
import {
  checkServerStatus,
  deleteSubject,
  deleteTopic,
  type ServerStatus,
} from "@/lib/client/sync";
import { countQuestionsOnDevice } from "@/lib/client/store";
import {
  applyScopeToQuestions,
  countServerScope,
  createQuestion,
  deleteQuestion,
  messageOf,
  outcomeNote,
  rowsInScope,
  saveQuestion,
  sweepRowsLocally,
  type CrudContext,
  type Scope,
  type ScopeChoice,
} from "@/lib/client/question-crud";
import { langOf } from "@/lib/client/util";
import { useT } from "@/lib/i18n/t";
import type { Question, SyllabusSubject } from "@/lib/types";

interface TopicGroup {
  topic: string;
  questions: Question[];
}

interface SubjectGroup {
  subject: string;
  count: number;
  topics: TopicGroup[];
}

/** What the dialog behind a question row should show. */
interface EditorState {
  open: boolean;
  mode: "edit" | "create";
  question: Question | null;
  subject: string;
  topic: string;
}

const CLOSED_EDITOR: EditorState = {
  open: false,
  mode: "create",
  question: null,
  subject: "",
  topic: "",
};

/** A subject/topic delete waiting for its "what about the questions?" answer. */
interface PendingScope extends Scope {
  /** Rows the shared bank has in this scope. */
  shared: number;
  /** Rows this device has to lose (its own plus the bundled ones). */
  local: number;
  /** Id of the syllabus subject that owns the entry, even for a topic scope. */
  syllabusSubjectId?: string;
  syllabusTopicId?: string;
}

/** Bank names are compared loosely, exactly like the server does. */
const sameName = (a: unknown, b: unknown) =>
  String(a == null ? "" : a).trim().toLowerCase() ===
  String(b == null ? "" : b).trim().toLowerCase();

export default function LibraryPage() {
  const { signedIn, isAdmin, ready } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState<Question[]>([]);
  const [groups, setGroups] = useState<SubjectGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [server, setServer] = useState<ServerStatus>({ online: false, mongo: false });
  const [syllabus, setSyllabus] = useState<SyllabusSubject[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(CLOSED_EDITOR);
  const [pending, setPending] = useState<PendingScope | null>(null);
  const [dropSyllabus, setDropSyllabus] = useState(false);
  const labels = useSyllabusLabels();
  const { t } = useT();

  /** May this user change the bank at all? */
  const canWrite = ready && canAddQuestions();
  /** Should a write also be sent to the shared bank? */
  const ctx: CrudContext = { server: server.mongo && canAddQuestions() };

  const reload = useCallback(async () => {
    const list = await getAllWithServer();
    setAll(list);
    setGroups(groupBySubjectTopic(list));
    setTotal(list.length);
  }, []);

  /** Pickers and Hindi labels cache the syllabus - a delete has to clear it. */
  const reloadSyllabus = useCallback(async () => {
    invalidateSyllabus();
    setSyllabus(await loadSyllabus());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getAllWithServer();
        if (cancelled) return;
        setAll(list);
        setGroups(groupBySubjectTopic(list));
        setTotal(list.length);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void checkServerStatus().then(setServer);
    void loadSyllabus().then(setSyllabus);
  }, [ready]);

  /** Run one action, ignoring clicks that arrive while it is busy. */
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- one question: add it, fix it, drop it ---------------- */

  function openEditor(next: Partial<EditorState>) {
    setEditor({ ...CLOSED_EDITOR, ...next, open: true });
  }

  /** Save the dialog: this device first, the shared bank when reachable. */
  async function saveDraft(q: Question) {
    await run(async () => {
      const creating = editor.mode === "create";
      const outcome = creating ? await createQuestion(q, ctx) : await saveQuestion(q, ctx);
      const note = outcomeNote(outcome);
      if (outcome.status === "error") toast.warning(note || "The shared bank refused the change");
      else if (outcome.status === "missing") toast.info(note);
      else toast.success(creating ? "Question added" : "Question updated");
      setEditor(CLOSED_EDITOR);
      await reload();
    });
  }

  async function removeOne(q: Question) {
    await run(async () => {
      const outcome = await deleteQuestion(q.id, ctx);
      if (outcome.status === "error") {
        toast.warning(outcomeNote(outcome) || "Could not delete the question");
      } else {
        toast.success("Question deleted");
      }
      await reload();
    });
  }

  /* ---------------- a whole topic or subject ---------------- */

  function syllabusSubjectOf(subject: string) {
    return syllabus.find((s) => sameName(s.name, subject));
  }

  /** Ask first: how many questions would a delete take with it? */
  async function askScope(scope: Scope) {
    if (busy) return;
    setBusy(true);
    let shared = 0;
    try {
      if (server.mongo && isAdmin) shared = await countServerScope(scope);
    } finally {
      setBusy(false);
    }
    const subject = syllabusSubjectOf(scope.subject);
    const topic = scope.topic
      ? (subject?.topics || []).find((tp) => sameName(tp.name, scope.topic))
      : undefined;
    const visible = rowsInScope(all, scope).length;
    setDropSyllabus(false);
    setPending({
      ...scope,
      shared,
      local: Math.max(visible - shared, countQuestionsOnDevice(scope.subject, scope.topic)),
      syllabusSubjectId: subject?.id,
      syllabusTopicId: topic?.id,
    });
  }

  /** Move or drop the questions, then (optionally) the syllabus entry. */
  async function confirmScope(choice: DeleteChoice) {
    const p = pending;
    if (!p) return;
    const scope: Scope = { subject: p.subject, topic: p.topic };
    // "keep" is only worth running when a syllabus entry also has to go.
    const decision: ScopeChoice | null =
      choice.mode === "keep" ? null : { mode: choice.mode, moveTo: choice.moveTo };
    const dropEntry =
      dropSyllabus &&
      server.mongo &&
      isAdmin &&
      Boolean(p.syllabusTopicId || p.syllabusSubjectId);
    if (!decision && !dropEntry) {
      setPending(null);
      return;
    }
    await run(async () => {
      let touched = 0;
      if (decision) {
        const res = await applyScopeToQuestions(scope, decision, ctx);
        if (!res.ok) {
          toast.error("Nothing was deleted - the questions could not be handled: " + res.error);
          return;
        }
        // Bundled rows live in a read-only file, so no cascade can reach them.
        touched = res.touched + sweepRowsLocally(await getAllWithServer(), scope, decision);
      }
      if (dropEntry) {
        try {
          if (p.syllabusTopicId && p.syllabusSubjectId) {
            await deleteTopic(p.syllabusSubjectId, p.syllabusTopicId);
          } else if (p.syllabusSubjectId) {
            await deleteSubject(p.syllabusSubjectId);
          }
          await reloadSyllabus();
        } catch (err) {
          toast.warning(
            "The questions are taken care of, but the syllabus entry is still there: " +
              messageOf(err)
          );
        }
      }
      setPending(null);
      await reload();
      const what = p.topic ? `topic "${p.topic}"` : `subject "${p.subject}"`;
      toast.success(
        `Cleared the ${what}` +
          (choice.mode === "keep"
            ? ""
            : touched
              ? ` · ${touched} question(s) ${choice.mode === "move" ? "moved" : "deleted"}`
              : "")
      );
    });
  }


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

  /* ---------------- what the editor's pickers offer ---------------- */

  const subjectChoices = useMemo(
    () => buildSubjectChoices(syllabus, Array.from(new Set(all.map((q) => q.subject)))),
    [syllabus, all]
  );
  const topicChoices = useMemo(
    () =>
      buildTopicChoices(
        syllabus,
        all.map((q) => ({ subject: q.subject, topic: q.topic })),
        editor.subject
      ),
    [syllabus, all, editor.subject]
  );

  /** Names the questions of the pending scope can be re-filed under. */
  const moveTargets = useMemo(() => {
    if (!pending) return [];
    const names = new Set<string>();
    if (pending.topic) {
      const subject = syllabusSubjectOf(pending.subject);
      (subject?.topics || []).forEach((tp) => names.add(tp.name));
      all.forEach((q) => {
        if (sameName(q.subject, pending.subject)) names.add(q.topic);
      });
      names.delete(pending.topic);
    } else {
      syllabus.forEach((s) => names.add(s.name));
      all.forEach((q) => names.add(q.subject));
    }
    return Array.from(names)
      .filter((n) => n && !sameName(n, pending.topic || pending.subject))
      .sort((a, b) => a.localeCompare(b));
    // syllabusSubjectOf reads `syllabus`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, syllabus, all]);

  return (
    <PageShell
      title={t("library.title")}
      description={t("library.desc")}
      wide
      actions={
        <>
          <Badge variant="secondary">
            {query
              ? t("library.count", { a: shown, b: total })
              : t("library.countAll", { n: total })}
          </Badge>
          {canWrite ? (
            <Button size="sm" onClick={() => openEditor({ mode: "create" })} disabled={busy}>
              <Plus /> New question
            </Button>
          ) : null}
        </>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("library.search")}
          aria-label={t("library.searchAria")}
          className="pr-9 pl-9"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("library.clear")}
            className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {canWrite && !server.mongo ? (
        <p className="text-xs text-muted-foreground">
          The shared bank is out of reach, so changes stay on this device and are shared again when
          the server is back.
        </p>
      ) : null}

      {ready && !canWrite ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">
                {signedIn ? "This account can read the bank, not change it" : "Sign in to edit the bank"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {signedIn
                  ? "Every question is browsable, but adding, fixing or deleting one needs a contributor or admin account."
                  : "Browsing is open to everyone. Adding, fixing and deleting questions needs a log in."}
              </p>
            </div>
            {!signedIn ? (
              <Button size="sm" onClick={() => setLoginOpen(true)}>
                Log in
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : filtered.length ? (
        <div className="flex flex-col gap-2">
          {filtered.map((g) => (
            <SubjectBlock
              key={g.subject}
              group={g}
              query={query}
              canWrite={canWrite}
              onNew={(subject, topic) => openEditor({ mode: "create", subject, topic: topic || "" })}
              onEdit={(q) =>
                openEditor({ mode: "edit", question: q, subject: q.subject, topic: q.topic })
              }
              onDelete={(q) => void removeOne(q)}
              onDeleteScope={(scope) => void askScope(scope)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={groups.length ? t("library.emptyMatch") : t("library.emptyBank")}
          hint={
            groups.length ? t("library.emptyMatchHint") : t("library.emptyBankHint")
          }
        />
      )}

      <QuestionEditorDialog
        open={editor.open}
        mode={editor.mode}
        question={editor.question}
        newSubject={editor.subject}
        newTopic={editor.topic}
        subjectChoices={subjectChoices}
        topicChoices={topicChoices}
        busy={busy}
        allowDelete
        onOpenChange={(next) => {
          if (!next && !busy) setEditor(CLOSED_EDITOR);
        }}
        onSave={(q) => saveDraft(q)}
        onDelete={async (q) => {
          setEditor(CLOSED_EDITOR);
          await removeOne(q);
        }}
      />

      <DeleteScopeDialog
        open={Boolean(pending)}
        busy={busy}
        showKeep={false}
        confirmLabel={pending?.topic ? "Delete topic" : "Delete subject"}
        targetLabel={pending?.topic ? "topic" : "subject"}
        title={
          pending?.topic
            ? `Clear the topic "${pending.topic}"?`
            : `Clear the subject "${pending?.subject}"?`
        }
        description={
          pending
            ? `${pending.shared + pending.local} question(s) point at this ${
                pending.topic ? "topic" : "subject"
              }. Delete them or move them somewhere first - the shared bank and this device are both handled, and bundled questions are hidden from this device's view.`
            : undefined
        }
        count={pending?.shared ?? 0}
        deviceCount={pending?.local ?? 0}
        targets={moveTargets}
        syllabus={
          pending && isAdmin && server.mongo && (pending.syllabusTopicId || pending.syllabusSubjectId)
            ? {
                label:
                  "Also remove it from the syllabus, so it stops offering itself in test and practice filters",
                checked: dropSyllabus,
                onChange: setDropSyllabus,
              }
            : null
        }
        onOpenChange={(next) => {
          if (!next && !busy) setPending(null);
        }}
        onConfirm={(choice) => void confirmScope(choice)}
      />

      <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
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

/** The actions the library offers at every level of the tree. */
interface BlockActions {
  canWrite: boolean;
  onNew: (subject: string, topic?: string) => void;
  onEdit: (q: Question) => void;
  onDelete: (q: Question) => void;
  onDeleteScope: (scope: Scope) => void;
}

/**
 * A subject header that expands to its topics. While the search box has
 * text, matching subjects start open; the first manual click takes over.
 */
function SubjectBlock({
  group,
  query,
  canWrite,
  onNew,
  onEdit,
  onDelete,
  onDeleteScope,
}: {
  group: SubjectGroup;
  query: string;
} & BlockActions) {
  const [manual, setManual] = useState<boolean | null>(null);
  const isOpen = manual ?? Boolean(query.trim());
  const labels = useSyllabusLabels();
  const name = labels.subject(group.subject);
  const { t } = useT();

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
              {t("library.topicCount", { n: group.topics.length })}
            </Badge>
            <Badge variant="outline" className="shrink-0">
              {group.count}
            </Badge>
            {canWrite ? (
              <span className="flex shrink-0 items-center gap-1">
                <RowButton
                  title={`Add a question in ${group.subject}`}
                  onClick={() => onNew(group.subject)}
                >
                  <Plus className="size-3.5" />
                </RowButton>
                <RowButton
                  title={`Delete the subject ${group.subject}`}
                  danger
                  onClick={() => onDeleteScope({ subject: group.subject })}
                >
                  <Trash2 className="size-3.5" />
                </RowButton>
              </span>
            ) : null}
          </CardContent>
        </CollapsibleTrigger>
      </Card>

      <CollapsibleContent>
        <div className="flex flex-col gap-2 px-2 pt-2 pb-3">
          {group.topics.map((topic) => (
            <TopicBlock
              key={topic.topic}
              topic={topic}
              subject={group.subject}
              query={query}
              canWrite={canWrite}
              onNew={onNew}
              onEdit={onEdit}
              onDelete={onDelete}
              onDeleteScope={onDeleteScope}
            />
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
  canWrite,
  onNew,
  onEdit,
  onDelete,
  onDeleteScope,
}: {
  topic: TopicGroup;
  subject: string;
  query: string;
} & BlockActions) {
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
          {canWrite ? (
            <span className="flex shrink-0 items-center gap-1">
              <RowButton
                title={`Add a question in ${topic.topic}`}
                onClick={() => onNew(subject, topic.topic)}
              >
                <Plus className="size-3" />
              </RowButton>
              <RowButton
                title={`Delete the topic ${topic.topic}`}
                danger
                onClick={() => onDeleteScope({ subject, topic: topic.topic })}
              >
                <Trash2 className="size-3" />
              </RowButton>
            </span>
          ) : null}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
          {topic.questions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              canWrite={canWrite}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A small icon action. Inside a header it must not toggle the section. */
function RowButton({
  title,
  danger = false,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "cursor-pointer rounded p-1 opacity-70 hover:bg-background hover:opacity-100",
        danger ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {children}
    </button>
  );
}

/**
 * One question, with its options and the correct answer marked. Editing opens
 * the editor; the trash arms itself first, so one careless tap cannot destroy
 * a question.
 */
function QuestionCard({
  question: q,
  canWrite,
  onEdit,
  onDelete,
}: {
  question: Question;
  canWrite: boolean;
  onEdit: (q: Question) => void;
  onDelete: (q: Question) => void;
}) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);
  const hi = q.options.hi || [];
  const en = q.options.en || [];
  const count = Math.max(hi.length, en.length);
  const correct = q.answerIndex;

  // The "sure?" state gives up after a few seconds.
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

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
        {canWrite ? (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {armed ? <span className="text-xs text-destructive">sure?</span> : null}
            <RowButton title="Edit this question" onClick={() => onEdit(q)}>
              <Pencil className="size-3.5" />
            </RowButton>
            <RowButton
              title={armed ? "Tap again to delete for good" : "Delete this question"}
              danger={armed}
              onClick={() => (armed ? onDelete(q) : setArmed(true))}
            >
              <Trash2 className="size-3.5" />
            </RowButton>
          </span>
        ) : null}
      </div>

      <p className="mb-2 font-medium">{langOf(q.question) || t("library.noText")}</p>

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
