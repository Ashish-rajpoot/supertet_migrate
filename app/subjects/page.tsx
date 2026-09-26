"use client";

/* ===========================================================
   app/subjects/page.tsx - admin page for the syllabus
   Port of js/subjects.js. Only an admin may change it (the API
   enforces that too). When the server / MongoDB is offline the
   bundled data/subjects.json is shown read-only, so the page
   still has something useful to show without a backend.
   =========================================================== */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AuthDialog } from "@/components/auth-dialog";
import { NameLabel, PageShell, SectionCard } from "@/components/misc";
import { useAuth, useLang } from "@/components/providers";
import {
  addTopic,
  checkServerStatus,
  deleteSubject,
  deleteTopic,
  fetchSubjects,
  saveSubject,
  updateSubject,
  updateTopic,
} from "@/lib/client/sync";
import type { SyllabusSubject, SyllabusTopic } from "@/lib/types";

/** Load the syllabus: the server copy, else the bundled JSON file. */
async function loadSyllabus(): Promise<{ list: SyllabusSubject[]; onServer: boolean }> {
  const status = await checkServerStatus();
  if (status.mongo) {
    const remote = await fetchSubjects();
    // null = could not ask the server. An empty array is a real answer:
    // the admin has deliberately cleared the syllabus, so do NOT fall back.
    if (remote !== null) return { list: remote, onServer: true };
  }
  try {
    const res = await fetch("/data/subjects.json", { cache: "no-store" });
    return { list: res.ok ? await res.json() : [], onServer: false };
  } catch {
    return { list: [], onServer: false };
  }
}

const topicCount = (list: SyllabusSubject[]): number =>
  list.reduce((n, s) => n + (s.topics || []).length, 0);

/** Subjects matching the search box (a subject matches whole, or by one topic). */
function filterSubjects(list: SyllabusSubject[], query: string): SyllabusSubject[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list
    .map((s) => {
      if ((s.name + " " + (s.nameHi || "")).toLowerCase().includes(q)) return s;
      const topics = (s.topics || []).filter((t) =>
        (t.name + " " + (t.nameHi || "")).toLowerCase().includes(q)
      );
      return topics.length ? { ...s, topics } : null;
    })
    .filter((s): s is SyllabusSubject => Boolean(s));
}

export default function SubjectsPage() {
  const { signedIn, isAdmin, ready } = useAuth();
  const [subjects, setSubjects] = useState<SyllabusSubject[]>([]);
  const [onServer, setOnServer] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);

  // Inline-edit bookkeeping
  const [editSubject, setEditSubject] = useState<string | null>(null);
  const [editTopic, setEditTopic] = useState<{ s: string; t: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newNameHi, setNewNameHi] = useState("");

  // Editing needs both an admin account and a reachable database.
  const canEdit = isAdmin && onServer;

  const reload = useCallback(async () => {
    const { list, onServer: srv } = await loadSyllabus();
    setSubjects(list);
    setOnServer(srv);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void reload();
  }, [ready, reload]);

  /** Run one async action, ignoring clicks that arrive while it is busy. */
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function addSubject() {
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      await saveSubject({ name, nameHi: newNameHi.trim() });
      toast.success("Subject added: " + name);
      setNewName("");
      setNewNameHi("");
      await reload();
    });
  }

  async function renameSubject(s: SyllabusSubject, name: string, nameHi: string) {
    if (!name.trim()) return;
    await run(async () => {
      await updateSubject(s.id, { name: name.trim(), nameHi: nameHi.trim() });
      setEditSubject(null);
      toast.success("Subject updated");
      await reload();
    });
  }

  async function addTopicTo(s: SyllabusSubject, name: string, nameHi: string) {
    if (!name.trim()) return;
    await run(async () => {
      await addTopic(s.id, { name: name.trim(), nameHi: nameHi.trim() });
      toast.success("Topic added: " + name.trim());
      await reload();
    });
  }

  async function renameTopic(sId: string, tId: string, name: string, nameHi: string) {
    if (!name.trim()) return;
    await run(async () => {
      await updateTopic(sId, tId, { name: name.trim(), nameHi: nameHi.trim() });
      setEditTopic(null);
      toast.success("Topic updated");
      await reload();
    });
  }

  async function removeSubject(s: SyllabusSubject) {
    const n = (s.topics || []).length;
    if (
      !confirm(
        `Delete "${s.name}"` + (n ? ` and its ${n} topic(s)` : "") + "? This cannot be undone."
      )
    )
      return;
    await run(async () => {
      await deleteSubject(s.id);
      setEditSubject(null);
      toast.success("Subject deleted");
      await reload();
    });
  }

  async function removeTopic(sId: string, t: SyllabusTopic) {
    if (!confirm(`Delete the topic "${t.name}"?`)) return;
    await run(async () => {
      await deleteTopic(sId, t.id);
      setEditTopic(null);
      toast.success("Topic deleted");
      await reload();
    });
  }

  /** Pull data/subjects.json into the server, skipping subjects that exist. */
  async function importBundled() {
    await run(async () => {
      const res = await fetch("/data/subjects.json", { cache: "no-store" });
      const list: SyllabusSubject[] = res.ok ? await res.json() : [];
      if (!Array.isArray(list) || !list.length) throw new Error("No bundled syllabus found");
      let added = 0;
      let skipped = 0;
      for (const s of list) {
        try {
          await saveSubject({ name: s.name, nameHi: s.nameHi, topics: s.topics });
          added++;
        } catch (err) {
          // 409 = that subject is already there.
          if ((err as { status?: number })?.status === 409) {
            skipped++;
            continue;
          }
          throw err;
        }
      }
      toast.success(
        `Imported ${added} subject(s)` + (skipped ? `, ${skipped} already existed` : "")
      );
      await reload();
    });
  }

  if (!ready || loading) {
    return (
      <PageShell title="Subjects" description="Syllabus subjects and topics.">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  const visible = filterSubjects(subjects, query);

  return (
    <PageShell title="Subjects" description="Syllabus subjects and topics." wide>
      {/* ---------------- status ---------------- */}
      <SectionCard
        title="Syllabus"
        description={
          onServer
            ? "Changes are stored in MongoDB and shared with every device."
            : "The server is offline, so this is a read-only view of data/subjects.json. Start the backend to add or edit subjects."
        }
        actions={
          canEdit ? (
            <Button size="sm" variant="outline" onClick={importBundled} disabled={busy}>
              <Download /> Import bundled syllabus
            </Button>
          ) : null
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Subjects" value={subjects.length} />
          <Stat label="Topics" value={topicCount(subjects)} />
        </div>
        <div className="mt-3">
          <Badge variant={onServer ? "secondary" : "outline"}>
            {onServer ? "Saved on the server" : "Bundled file"}
          </Badge>
        </div>
      </SectionCard>

      {!signedIn ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6">
            <h2 className="text-lg font-semibold">Managing subjects needs a login</h2>
            <p className="text-sm text-muted-foreground">
              The syllabus is maintained by the site admin. Everyone can still read it while
              practising, taking tests or using flashcards.
            </p>
            <Button onClick={() => setLoginOpen(true)}>Log in</Button>
          </CardContent>
        </Card>
      ) : null}

      {signedIn && !isAdmin ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-2 pt-6">
            <h2 className="text-lg font-semibold">Admin only</h2>
            <p className="text-sm text-muted-foreground">
              You are signed in, but only the site admin can add or change subjects and topics. Ask
              the admin if you need access.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- add a subject ---------------- */}
      {canEdit ? (
        <SectionCard
          title="Add a subject"
          description="विषय जोड़ें — topics are added inside the subject card below."
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label="English name">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Mathematics"
                maxLength={120}
              />
            </Field>
            <Field label="हिंदी नाम">
              <Input
                value={newNameHi}
                onChange={(e) => setNewNameHi(e.target.value)}
                placeholder="जैसे: गणित"
                maxLength={120}
              />
            </Field>
            <Button onClick={addSubject} disabled={busy || !newName.trim()}>
              <Plus /> Add subject
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {/* ---------------- search ---------------- */}
      {subjects.length ? (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search subjects or topics... खोजें"
          aria-label="Search subjects"
        />
      ) : null}

      {/* ---------------- the list ---------------- */}
      {visible.length ? (
        <div className="flex flex-col gap-3">
          {visible.map((s) => (
            <SubjectCard
              key={s.id}
              subject={s}
              canEdit={canEdit}
              busy={busy}
              isEditing={editSubject === s.id}
              editTopic={editTopic}
              onStartEdit={() => setEditSubject(s.id)}
              onCancelEdit={() => setEditSubject(null)}
              onSaveEdit={(name, nameHi) => void renameSubject(s, name, nameHi)}
              onDelete={() => void removeSubject(s)}
              onAddTopic={(name, nameHi) => void addTopicTo(s, name, nameHi)}
              onStartTopicEdit={(tId) => setEditTopic({ s: s.id, t: tId })}
              onSaveTopicEdit={(tId, name, nameHi) => void renameTopic(s.id, tId, name, nameHi)}
              onCancelTopicEdit={() => setEditTopic(null)}
              onDeleteTopic={(t) => void removeTopic(s.id, t)}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {subjects.length
              ? "No subject or topic matches that search."
              : "No subjects yet. Import the bundled syllabus to get started."}
          </CardContent>
        </Card>
      )}

      <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
    </PageShell>
  );
}

/* ---------------- pieces ---------------- */

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** One subject card: header (or rename form), topic chips, add-topic form. */
function SubjectCard({
  subject: s,
  canEdit,
  busy,
  isEditing,
  editTopic,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onAddTopic,
  onStartTopicEdit,
  onSaveTopicEdit,
  onCancelTopicEdit,
  onDeleteTopic,
}: {
  subject: SyllabusSubject;
  canEdit: boolean;
  busy: boolean;
  isEditing: boolean;
  editTopic: { s: string; t: string } | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (name: string, nameHi: string) => void;
  onDelete: () => void;
  onAddTopic: (name: string, nameHi: string) => void;
  onStartTopicEdit: (topicId: string) => void;
  onSaveTopicEdit: (topicId: string, name: string, nameHi: string) => void;
  onCancelTopicEdit: () => void;
  onDeleteTopic: (t: SyllabusTopic) => void;
}) {
  const topics = s.topics || [];
  const label = useNameLabel();
  // Renaming needs the topics visible, so keep the card open while editing.
  const [open, setOpen] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const isOpen = isEditing || (userToggled ? open : true);
  const subjectName = label(s.name, s.nameHi);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(next) => {
        setUserToggled(true);
        setOpen(next);
      }}
      className="overflow-hidden rounded-xl border bg-card"
    >
      <div className="flex items-center gap-2 p-3">
        <CollapsibleTrigger asChild>
          <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
            <ChevronDown
              className={
                "size-4 shrink-0 text-muted-foreground transition-transform " +
                (isOpen ? "rotate-180" : "")
              }
            />
            <NameLabel
              primary={subjectName.primary}
              secondary={subjectName.secondary}
              className="min-w-0 flex-1 font-semibold"
            />
            <Badge variant="secondary" className="shrink-0">
              {topics.length} topic{topics.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </CollapsibleTrigger>

        {canEdit && !isEditing ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={onStartEdit}>
              <Pencil /> Rename
            </Button>
            <Button size="sm" variant="destructive" onClick={onDelete}>
              <X /> Delete
            </Button>
          </div>
        ) : null}
      </div>

      <CollapsibleContent>
        <CardContent className="flex flex-col gap-2 pt-0">
          {isEditing ? (
            <NameForm
              name={s.name}
              nameHi={s.nameHi || ""}
              submitLabel="Save"
              busy={busy}
              onSubmit={onSaveEdit}
              onCancel={onCancelEdit}
            />
          ) : null}

          {topics.length ? (
            <div className="flex flex-wrap gap-1.5">
              {topics.map((t) => (
                <TopicChip
                  key={t.id}
                  topic={t}
                  canEdit={canEdit}
                  editing={editTopic?.s === s.id && editTopic.t === t.id}
                  busy={busy}
                  onStartEdit={() => onStartTopicEdit(t.id)}
                  onCancelEdit={onCancelTopicEdit}
                  onSaveEdit={(name, nameHi) => onSaveTopicEdit(t.id, name, nameHi)}
                  onDelete={() => onDeleteTopic(t)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No topics yet.</p>
          )}

          {canEdit && !isEditing ? <TopicAdder busy={busy} onAdd={onAddTopic} /> : null}
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Resolve a name pair into the active language. */
function useNameLabel() {
  const { lang } = useLang();
  return useCallback(
    (en: string, hi?: string) => {
      const primary = lang === "en" ? en : hi || en;
      const secondary = lang === "both" && hi && en && hi !== en ? en : "";
      return { primary, secondary };
    },
    [lang]
  );
}

/** A topic chip, or the inline rename form when it is being edited. */
function TopicChip({
  topic: t,
  canEdit,
  editing,
  busy,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  topic: SyllabusTopic;
  canEdit: boolean;
  editing: boolean;
  busy: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (name: string, nameHi: string) => void;
  onDelete: () => void;
}) {
  const label = useNameLabel();
  const name = label(t.name, t.nameHi);

  if (editing) {
    return (
      <div className="flex basis-full flex-wrap items-end gap-2 rounded-lg border p-2">
        <NameForm
          name={t.name}
          nameHi={t.nameHi || ""}
          submitLabel="Save"
          busy={busy}
          onSubmit={onSaveEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  return (
    <Badge variant="secondary" className="max-w-full gap-1 py-1">
      <span className="min-w-0 truncate">
        <NameLabel
          primary={name.primary}
          secondary={name.secondary}
          secondaryClassName="inline ml-1"
        />
      </span>
      {canEdit ? (
        <>
          <button
            type="button"
            onClick={onStartEdit}
            title="Edit topic"
            aria-label={`Edit ${t.name}`}
            className="ml-1 cursor-pointer opacity-70 hover:opacity-100"
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete topic"
            aria-label={`Delete ${t.name}`}
            className="cursor-pointer opacity-70 hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </>
      ) : null}
    </Badge>
  );
}

/** The two-field rename form, used for both subjects and topics. */
function NameForm({
  name,
  nameHi,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  name: string;
  nameHi: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (name: string, nameHi: string) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState(name);
  const [h, setH] = useState(nameHi);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="English">
        <Input value={n} onChange={(e) => setN(e.target.value)} maxLength={160} />
      </Field>
      <Field label="हिंदी">
        <Input value={h} onChange={(e) => setH(e.target.value)} maxLength={160} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSubmit(n, h)} disabled={busy || !n.trim()}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** "Add topic" row inside a subject card. */
function TopicAdder({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (name: string, nameHi: string) => void;
}) {
  const [n, setN] = useState("");
  const [h, setH] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 pt-1">
      <Field label="New topic (English)">
        <Input
          value={n}
          onChange={(e) => setN(e.target.value)}
          placeholder="e.g. Percentage"
          maxLength={160}
        />
      </Field>
      <Field label="विषय-वस्तु (हिंदी)">
        <Input
          value={h}
          onChange={(e) => setH(e.target.value)}
          placeholder="जैसे: प्रतिशत"
          maxLength={160}
        />
      </Field>
      <Button
        size="sm"
        onClick={() => {
          onAdd(n, h);
          setN("");
          setH("");
        }}
        disabled={busy || !n.trim()}
      >
        <Plus /> Add topic
      </Button>
    </div>
  );
}
