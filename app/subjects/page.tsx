"use client";

/* ===========================================================
   app/subjects/page.tsx - admin page for the syllabus
   Port of js/subjects.js. Only an admin may change it (the API
   enforces that too). When the server / MongoDB is offline the
   bundled data/subjects.json is shown read-only, so the page
   still has something useful to show without a backend.

   Subjects and topics can also be pasted as JSON and added in bulk,
   which previews first the same way the Questions page does.
   =========================================================== */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown, Copy, Download, Pencil, Plus, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AuthDialog } from "@/components/auth-dialog";
import { DeleteScopeDialog, type DeleteChoice } from "@/components/delete-scope-dialog";
import { ComboBox } from "@/components/combo-box";
import { NameLabel, PageShell, SectionCard } from "@/components/misc";
import { useAuth, useLang } from "@/components/providers";
import {
  addTopic,
  checkServerStatus,
  countSubjectQuestions,
  deleteSubject,
  deleteTopic,
  fetchSubjects,
  renameSubjectQuestions,
  renameTopicQuestions,
  saveSubject,
  updateSubject,
  updateTopic,
} from "@/lib/client/sync";
import { countQuestionsOnDevice, renameSubjectOnDevice, renameTopicOnDevice } from "@/lib/client/store";
import {
  applyScopeToQuestions,
  sweepRowsLocally,
  type Scope,
  type ScopeChoice,
} from "@/lib/client/question-crud";
import { getAllWithServer } from "@/lib/data/normalize";
import { invalidateSyllabus } from "@/lib/data/labels";
import {
  parseSyllabusJson,
  SAMPLE_SYLLABUS_JSON,
  type SyllabusImport,
} from "@/lib/data/syllabus-import";
import {
  buildSyllabusPrompt,
  EXAM_PRESETS,
  SYLLABUS_PROMPT_EXAMPLE,
} from "@/lib/data/syllabus-ai-prompt";
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

  // Bulk add from pasted JSON: the box, and what the preview read out of it.
  const [bulkText, setBulkText] = useState("");
  const [bulk, setBulk] = useState<SyllabusImport | null>(null);

  // AI prompt card: the choices the prompt is filled in from.
  const [aiExam, setAiExam] = useState(SYLLABUS_PROMPT_EXAMPLE.exam);
  const [aiSubjectNames, setAiSubjectNames] = useState("");
  const [aiMedium, setAiMedium] = useState("Hindi + English");
  const [aiFocus, setAiFocus] = useState("");

  // A delete whose "what about the questions?" answer is still pending.
  const [pendingDelete, setPendingDelete] = useState<{
    subject: SyllabusSubject;
    topic?: SyllabusTopic;
    /** Questions in the shared bank that point at this entry. */
    count: number;
    /** Questions on this device that point at this entry. */
    deviceCount: number;
  } | null>(null);

  // Editing needs both an admin account and a reachable database.
  const canEdit = isAdmin && onServer;

  const reload = useCallback(async () => {
    const { list, onServer: srv } = await loadSyllabus();
    setSubjects(list);
    setOnServer(srv);
    setLoading(false);
    // Pickers and Hindi labels elsewhere keep a cached copy of the
    // syllabus, so a rename or delete has to clear it to be visible.
    invalidateSyllabus();
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

  /* -------- rename: the questions keep up with the new name -------- */

  async function renameSubject(s: SyllabusSubject, name: string, nameHi: string) {
    const next = name.trim();
    if (!next) return;
    const moved = next !== s.name;
    await run(async () => {
      await updateSubject(s.id, { name: next, nameHi: nameHi.trim() });
      // Questions point at subjects by name, so a rename has to move them
      // too - otherwise the whole subject's bank is orphaned.
      if (moved) {
        if (onServer) {
          try {
            await renameSubjectQuestions(s.name, next);
          } catch (err) {
            toast.warning(
              "The subject was renamed, but its shared questions stayed behind: " +
                (err instanceof Error ? err.message : "unknown error")
            );
          }
        }
        renameSubjectOnDevice(s.name, next);
      }
      setEditSubject(null);
      toast.success(moved ? "Subject renamed and its questions moved" : "Subject updated");
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

  async function renameTopic(s: SyllabusSubject, tId: string, name: string, nameHi: string) {
    const next = name.trim();
    if (!next) return;
    const current = (s.topics || []).find((t) => t.id === tId);
    const moved = Boolean(current && current.name !== next);
    await run(async () => {
      await updateTopic(s.id, tId, { name: next, nameHi: nameHi.trim() });
      if (moved && current) {
        if (onServer) {
          try {
            await renameTopicQuestions(s.name, current.name, next);
          } catch (err) {
            toast.warning(
              "The topic was renamed, but its shared questions stayed behind: " +
                (err instanceof Error ? err.message : "unknown error")
            );
          }
        }
        renameTopicOnDevice(s.name, current.name, next);
      }
      setEditTopic(null);
      toast.success(moved ? "Topic renamed and its questions moved" : "Topic updated");
      await reload();
    });
  }

  /* -------- delete: ask what should happen to the questions -------- */

  /** Open the scope dialog, first counting what a delete would take. */
  async function askDelete(s: SyllabusSubject, topic?: SyllabusTopic) {
    if (busy) return;
    setBusy(true);
    let count = 0;
    try {
      if (onServer) count = (await countSubjectQuestions(s.name, topic?.name)).count;
    } catch {
      count = 0;
    } finally {
      setBusy(false);
    }
    setPendingDelete({
      subject: s,
      topic,
      count,
      deviceCount: countQuestionsOnDevice(s.name, topic?.name),
    });
  }

  async function confirmDelete(choice: DeleteChoice) {
    const p = pendingDelete;
    if (!p) return;
    const s = p.subject;
    const topic = p.topic;
    const moveTo = choice.mode === "move" ? String(choice.moveTo || "").trim() : "";
    if (choice.mode === "move" && !moveTo) {
      toast.error("Type the name you want the questions moved to");
      return;
    }
    await run(async () => {
      let touched = 0;
      // Deal with the questions first: if that fails the entry stays,
      // so the bank can never end up pointing at a subject that is gone.
      if (choice.mode !== "keep") {
        const scope: Scope = { subject: s.name, topic: topic?.name };
        // "clear" (delete only the questions) is not offered on this page, but
        // narrow the mode anyway so only a real cascade reaches the helper.
        const decision: ScopeChoice = {
          mode: choice.mode === "move" ? "move" : "delete",
          moveTo,
        };
        const res = await applyScopeToQuestions(scope, decision, {
          server: onServer,
          mayWrite: isAdmin,
        });
        if (!res.ok) {
          toast.error("Nothing was deleted - the questions could not be handled: " + res.error);
          return;
        }
        // Bundled questions live in a read-only file that no cascade can
        // reach, so they are taken out of this device's view the same way.
        touched = res.touched + sweepRowsLocally(await getAllWithServer(), scope, decision);
      }
      if (topic) await deleteTopic(s.id, topic.id);
      else await deleteSubject(s.id);
      setPendingDelete(null);
      setEditSubject(null);
      setEditTopic(null);
      toast.success(
        (topic ? `Deleted the topic "${topic.name}"` : `Deleted the subject "${s.name}"`) +
          (choice.mode === "keep"
            ? ""
            : touched
              ? ` · ${touched} question(s) ${choice.mode === "move" ? "moved" : "deleted"}`
              : "")
      );
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

  /* -------- bulk add: paste a JSON chunk of the syllabus -------- */

  function previewBulk() {
    setBulk(parseSyllabusJson(bulkText));
  }

  /**
   * Add what the preview found. A subject that is already there is left
   * alone and only receives the topics it is missing, so pasting the same
   * JSON twice never fails and never duplicates anything.
   */
  async function saveBulk() {
    if (!bulk?.subjects.length) return;
    await run(async () => {
      const failures: string[] = [];
      let newSubjects = 0;
      let newTopics = 0;
      let skipped = 0;

      for (const s of bulk.subjects) {
        const wanted = s.topics.map((t) => ({ name: t.name, nameHi: t.nameHi }));
        const existing = subjects.find(
          (x) => x.name.trim().toLowerCase() === s.name.toLowerCase()
        );
        if (!existing) {
          try {
            await saveSubject({ name: s.name, nameHi: s.nameHi, topics: wanted });
            newSubjects += 1;
            newTopics += wanted.length;
          } catch (err) {
            failures.push(`${s.name}: ${(err as Error)?.message || "unknown error"}`);
          }
          continue;
        }
        const have = new Set((existing.topics || []).map((t) => t.name.trim().toLowerCase()));
        for (const t of wanted) {
          if (have.has(t.name.toLowerCase())) {
            skipped += 1;
            continue;
          }
          try {
            await addTopic(existing.id, t);
            have.add(t.name.toLowerCase());
            newTopics += 1;
          } catch (err) {
            failures.push(`${s.name} / ${t.name}: ${(err as Error)?.message || "unknown error"}`);
          }
        }
      }

      await reload();
      const summary =
        `Added ${newSubjects} subject(s) and ${newTopics} topic(s)` +
        (skipped ? ` · ${skipped} already there` : "");
      if (failures.length) {
        // The box and the preview stay, so a refused row can be fixed and retried.
        toast.error(
          `${summary} · ${failures.length} failed: ${failures.slice(0, 2).join(" · ")}`
        );
      } else {
        toast.success(summary);
        setBulk(null);
        setBulkText("");
      }
    });
  }

  /* -------- the AI prompt, filled in from the fields above -------- */

  // Subjects already published are listed in the prompt, so a subject the
  // admin names again keeps the name the site already shows.
  const syllabusPrompt = useMemo(
    () =>
      buildSyllabusPrompt({
        exam: aiExam,
        subjects: aiSubjectNames,
        medium: aiMedium,
        extra: aiFocus,
        existing: subjects.map((s) => s.name),
      }),
    [aiExam, aiSubjectNames, aiMedium, aiFocus, subjects]
  );

  function fillExampleValues() {
    setAiExam(SYLLABUS_PROMPT_EXAMPLE.exam);
    setAiSubjectNames(SYLLABUS_PROMPT_EXAMPLE.subjects);
    setAiMedium(SYLLABUS_PROMPT_EXAMPLE.medium);
    setAiFocus(SYLLABUS_PROMPT_EXAMPLE.focus);
    toast.success("Example values filled in - copy the prompt and send it to your LLM");
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

      {/* ---------------- add many from JSON ---------------- */}
      {canEdit ? (
        <SectionCard
          title="Or add many at once from JSON"
          description="Paste a JSON array of subjects with their topics, then preview it. A subject that already exists is left alone and only receives the topics it is missing."
        >
          <Textarea
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={SAMPLE_SYLLABUS_JSON}
            className="font-mono text-xs"
            aria-label="Subjects and topics JSON"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={previewBulk} disabled={busy || !bulkText.trim()}>
              Preview subjects
            </Button>
            <Button variant="ghost" onClick={() => setBulkText(SAMPLE_SYLLABUS_JSON)}>
              Insert a sample
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {/* ---------------- bulk preview ---------------- */}
      {canEdit && bulk ? (
        <SectionCard
          title={
            bulk.subjects.length
              ? `Preview — ${bulk.subjects.length} subject(s), ${bulk.topics} topic(s) ready`
              : "Preview"
          }
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => setBulk(null)} disabled={busy}>
                Discard
              </Button>
              <Button size="sm" onClick={saveBulk} disabled={busy || !bulk.subjects.length}>
                Add to syllabus
              </Button>
            </>
          }
        >
          {bulk.errors.length ? (
            <div className="mb-3 border-l-4 border-destructive pl-3 text-sm">
              <strong>Rows needing a fix ({bulk.errors.length})</strong>
              <ul className="mt-1.5 pl-4">
                {bulk.errors.slice(0, 12).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {bulk.errors.length > 12 ? (
                  <li className="text-muted-foreground">… {bulk.errors.length - 12} more</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {bulk.subjects.length ? (
            <div className="max-h-96 overflow-y-auto rounded-xl border">
              <ul className="divide-y">
                {bulk.subjects.map((s) => (
                  <li key={s.name} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      {s.nameHi ? (
                        <span className="text-xs text-muted-foreground">{s.nameHi}</span>
                      ) : null}
                      <Badge variant="secondary" className="text-xs font-normal">
                        {s.topics.length} topic(s)
                      </Badge>
                    </div>
                    {s.topics.length ? (
                      <ul className="mt-1.5 flex flex-wrap gap-1">
                        {s.topics.map((t) => (
                          <li
                            key={t.name}
                            className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground"
                          >
                            {t.name}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No usable subjects in that text.</p>
          )}
        </SectionCard>
      ) : null}

      {/* ---------------- AI prompt ---------------- */}
      {isAdmin ? (
        <SectionCard
          title="Or let an AI write the syllabus for you"
          description="Pick the exam, name the subjects, copy the prompt, then paste the JSON answer into the box above. The subjects already published are named in the prompt, so a subject you type again keeps the name the site already shows."
          actions={
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(syllabusPrompt);
                  toast.success("Prompt copied");
                } catch {
                  toast.error("Could not copy - select the text and copy manually");
                }
              }}
            >
              <Copy /> Copy prompt
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Exam / type">
              <ComboBox
                value={aiExam}
                onChange={setAiExam}
                options={EXAM_PRESETS.map((e) => ({ value: e }))}
                placeholder="SuperTET, TET, Railway..."
                ariaLabel="Exam or type"
              />
            </Field>
            <Field label="Subjects">
              <Input
                value={aiSubjectNames}
                onChange={(e) => setAiSubjectNames(e.target.value)}
                placeholder="e.g. Mathematics, Environmental Studies"
                maxLength={300}
                aria-label="Subjects to write topics for"
              />
            </Field>
            <Field label="Hindi names">
              <Select value={aiMedium} onValueChange={setAiMedium}>
                <SelectTrigger aria-label="Hindi names">
                  <SelectValue placeholder="Hindi + English" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hindi + English">Hindi + English</SelectItem>
                  <SelectItem value="English">English only (nameHi stays empty)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Focus (optional)">
              <Input
                value={aiFocus}
                onChange={(e) => setAiFocus(e.target.value)}
                placeholder="e.g. level 1 and level 2 papers"
                maxLength={200}
                aria-label="Extra focus for the AI"
              />
            </Field>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Name the subjects you want and the AI writes the full topic list for each one from its
            own knowledge of that exam. Leave the subjects empty to let it list the main papers
            itself. The subjects already published are named in the prompt, so a subject you type
            again keeps the name the site already shows.
          </p>

          <Textarea
            rows={14}
            readOnly
            value={syllabusPrompt}
            className="mt-3 font-mono text-xs"
            aria-label="AI syllabus prompt"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={fillExampleValues}>
              <Wand2 /> Use example values
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
              onDelete={() => void askDelete(s)}
              onAddTopic={(name, nameHi) => void addTopicTo(s, name, nameHi)}
              onStartTopicEdit={(tId) => setEditTopic({ s: s.id, t: tId })}
              onSaveTopicEdit={(tId, name, nameHi) => void renameTopic(s, tId, name, nameHi)}
              onCancelTopicEdit={() => setEditTopic(null)}
              onDeleteTopic={(t) => void askDelete(s, t)}
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

      <DeleteScopeDialog
        open={Boolean(pendingDelete)}
        targetLabel={pendingDelete?.topic ? "topic" : "subject"}
        title={
          pendingDelete?.topic
            ? `Delete the topic "${pendingDelete.topic.name}"?`
            : `Delete the subject "${pendingDelete?.subject.name}"?`
        }
        description={
          pendingDelete
            ? (pendingDelete.topic
                ? "Questions are matched to a topic by name, so decide what should happen to the ones already written."
                : `Its ${(pendingDelete.subject.topics || []).length} topic(s) go with it, and the questions need a decision too.`)
            : undefined
        }
        count={pendingDelete?.count ?? 0}
        deviceCount={pendingDelete?.deviceCount ?? 0}
        targets={subjects
          .filter((x) => x.name !== pendingDelete?.subject.name)
          .map((x) => x.name)}
        busy={busy}
        confirmLabel={pendingDelete?.topic ? "Delete topic" : "Delete subject"}
        onOpenChange={(next) => {
          if (!next && !busy) setPendingDelete(null);
        }}
        onConfirm={(choice) => void confirmDelete(choice)}
      />

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
