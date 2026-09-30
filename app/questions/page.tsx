"use client";

/* ===========================================================
   app/questions/page.tsx - bulk import questions
   Port of js/manage.js. Only an admin - or a student the admin
   has allowed - may add questions to the shared bank. Everyone
   can still practise and keep a private bank on this device.
   =========================================================== */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Copy, FileUp, Pencil, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuthDialog } from "@/components/auth-dialog";
import { ComboBox } from "@/components/combo-box";
import { QuestionEditorDialog } from "@/components/question-editor";
import { PageShell, SectionCard } from "@/components/misc";
import { useAuth } from "@/components/providers";
import {
  buildAiPrompt,
  buildSubjectChoices,
  buildTopicChoices,
  type Choice,
} from "@/lib/data/ai-prompt";
import {
  downloadTemplate,
  exportQuestionsXlsx,
  parseCsvText,
  parseFile,
  parseJsonText,
} from "@/lib/data/importer";
import { getAll, normaliseRow } from "@/lib/data/normalize";
import { addQuestions, getQuestions, usageBytes } from "@/lib/client/store";
import {
  checkServerStatus,
  pushQuestions as syncQuestions,
  type ServerStatus,
} from "@/lib/client/sync";
import {
  deleteQuestion,
  outcomeNote,
  saveQuestion,
} from "@/lib/client/question-crud";
import { useSyllabus } from "@/lib/data/labels";
import {
  canAddQuestions,
  listUsers,
  updateUserPermissions,
} from "@/lib/client/auth-client";
import { download, langOf } from "@/lib/client/util";
import type { PublicUser, Question } from "@/lib/types";

interface Preview {
  questions: Question[];
  errors: string[];
  warnings: string[];
}

const EMPTY_PREVIEW: Preview = { questions: [], errors: [], warnings: [] };

/** Two rows with the same question text and options are the same question. */
function fingerprint(q: Question): string {
  return (q.question.hi || q.question.en) + "|" + q.options.hi.join(",");
}

export default function QuestionsPage() {
  const { signedIn, mayEdit, isAdmin, ready } = useAuth();
  const [server, setServer] = useState<ServerStatus>({ online: false, mongo: false });
  const [preview, setPreview] = useState<Preview>(EMPTY_PREVIEW);
  const [sourceLabel, setSourceLabel] = useState("");
  const [paste, setPaste] = useState("");
  const [mine, setMine] = useState<Question[]>([]);
  const [allCount, setAllCount] = useState(0);
  const [allSubjects, setAllSubjects] = useState(0);
  const syllabus = useSyllabus();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // One saved question, open in the editor for a fix.
  const [editing, setEditing] = useState<Question | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // AI prompt card
  const [aiCount, setAiCount] = useState("20");
  const [aiSubject, setAiSubject] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiDifficulties, setAiDifficulties] = useState<string[]>([]);
  const [aiMedium, setAiMedium] = useState("");

  const fileXlsx = useRef<HTMLInputElement | null>(null);
  const fileJson = useRef<HTMLInputElement | null>(null);

  const refreshStatus = useCallback(async () => {
    const allBank = await getAll();
    const mineBank = getQuestions();
    setAllCount(allBank.length);
    setAllSubjects(new Set(allBank.map((q) => q.subject)).size);
    setMine(mineBank.slice().reverse().slice(0, 200));
  }, []);

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      setServer(await checkServerStatus());
      await refreshStatus();
    })();
  }, [ready, refreshStatus]);

  // Load the admin roster once the server + admin rights are both there.
  useEffect(() => {
    if (!isAdmin || !server.mongo) return;
    void listUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [isAdmin, server.mongo]);

  // The prompt is fully derived from the inputs, so compute it during render.
  const prompt = useMemo(
    () =>
      buildAiPrompt({
        count: aiCount,
        subject: aiSubject,
        topic: aiTopic,
        difficulty: aiDifficulties,
        medium: aiMedium,
      }),
    [aiCount, aiSubject, aiTopic, aiDifficulties, aiMedium]
  );

  /* ---------------- preview helpers ---------------- */

  /** Normalise raw rows and drop the ones that clash inside the file. */
  function buildPreview(rows: Record<string, unknown>[], label: string) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const out: Question[] = [];
    const seen = new Set<string>();

    rows.forEach((row, i) => {
      const { q, errors: rowErrors } = normaliseRow(row, i + 1);
      if (rowErrors.length) {
        errors.push(...rowErrors);
        return;
      }
      if (!q) {
        errors.push(`Row ${i + 1}: could not be read`);
        return;
      }
      if (q.answerIndex < 0) {
        errors.push(`Row ${i + 1} (${q.subject}): no valid answer`);
        return;
      }
      const fp = fingerprint(q);
      if (seen.has(fp)) {
        warnings.push(`Row ${i + 1}: duplicate of an earlier row in this file`);
        return;
      }
      seen.add(fp);
      out.push(q);
    });

    setPreview({ questions: out, errors, warnings });
    setSourceLabel(label);
  }

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const rows = await parseFile(file);
      if (!rows.length) {
        toast.error("No rows found in that file");
        return;
      }
      buildPreview(rows, file.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  function handlePaste() {
    const text = paste.trim();
    if (!text) return;
    setBusy(true);
    try {
      const rows =
        text.startsWith("[") || text.startsWith("{")
          ? parseJsonText(text, "pasted.json")
          : parseCsvText(text);
      if (!rows.length) {
        toast.error("No rows found in the pasted text");
        return;
      }
      buildPreview(rows, "pasted text");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the pasted text");
    } finally {
      setBusy(false);
    }
  }

  async function savePreview() {
    const list = preview.questions;
    if (!list.length) return;
    setBusy(true);
    try {
      const res = addQuestions(list);
      if (server.mongo && canAddQuestions()) {
        try {
          const srv = await syncQuestions(list);
          // Per-row refusals: say exactly which row and why, so the
          // uploader can fix the sheet instead of guessing.
          if (srv.invalid?.length) {
            toast.warning(
              `${srv.invalid.length} row(s) the server refused: ` +
                srv.invalid
                  .slice(0, 3)
                  .map((p) => `row ${p.index + 1} (${p.id}): ${p.errors[0]}`)
                  .join(" · ") +
                (srv.invalid.length > 3 ? " ..." : "")
            );
          }
          if (srv.skipped?.length) {
            toast.info(
              `${srv.skipped.length} question(s) belong to another user and were left alone`
            );
          }
        } catch (err) {
          toast.warning(
            "Saved on this device only - the shared bank refused: " +
              (err instanceof Error ? err.message : "unknown error")
          );
        }
      }
      toast.success(
        `Saved ${res.added} new question(s)` +
          (res.updated ? `, updated ${res.updated}` : "") +
          " on this device"
      );
      setPreview(EMPTY_PREVIEW);
      setSourceLabel("");
      setPaste("");
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- edit / delete a saved question ---------------- */

  function openEdit(q: Question) {
    setEditing(q);
    setEditorOpen(true);
  }

  /** Save an edit: the device copy first, then the shared bank. */
  async function saveEdited(q: Question) {
    setBusy(true);
    try {
      const outcome = await saveQuestion(q, {
        server: server.mongo && canAddQuestions(),
        mayWrite: canAddQuestions(),
      });
      const note = outcomeNote(outcome);
      if (outcome.status === "error") toast.warning(note);
      else if (outcome.status === "missing") toast.info(note);
      else toast.success("Question updated");
      setEditorOpen(false);
      setEditing(null);
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  /** Delete here and, when the account may write, in the shared bank too. */
  async function deleteOne(id: string) {
    const outcome = await deleteQuestion(id, { server: server.mongo && mayEdit, mayWrite: mayEdit });
    if (outcome.status === "error") toast.warning(outcomeNote(outcome));
    else toast.success("Question deleted");
    await refreshStatus();
  }

  /** Drop one row out of the preview - the quickest fix for a wrong upload. */
  function dropPreviewRow(index: number) {
    setPreview((p) => ({ ...p, questions: p.questions.filter((_, i) => i !== index) }));
  }

  /* ---------------- AI combobox choices ---------------- */

  const subjectChoices: Choice[] = buildSubjectChoices(
    syllabus,
    Array.from(new Set(mine.map((q) => q.subject)))
  );
  const topicChoices: Choice[] = buildTopicChoices(
    syllabus,
    mine.map((q) => ({ subject: q.subject, topic: q.topic })),
    aiSubject
  );

  // Same lists for the editor: topics follow the subject of the question
  // that is open, not the one typed into the AI prompt card.
  const editTopicChoices: Choice[] = buildTopicChoices(
    syllabus,
    mine.map((q) => ({ subject: q.subject, topic: q.topic })),
    editing?.subject || ""
  );

  if (!ready) {
    return (
      <PageShell title="Questions" description="Upload, preview and export questions.">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const hasPreview =
    preview.questions.length > 0 || preview.errors.length > 0 || preview.warnings.length > 0;

  return (
    <PageShell title="Questions" description="Upload, preview and export questions." wide>
      {!mayEdit ? (
        <PermissionCard signedIn={signedIn} onLogin={() => setLoginOpen(true)} />
      ) : null}

      {mayEdit ? (
        <>
          {/* ---------------- bulk upload ---------------- */}
          <SectionCard
            title="Add questions in bulk"
            description="Upload an Excel (.xlsx), CSV or JSON file. Questions are checked, previewed, then saved into this browser."
            actions={
              <Button size="sm" variant="outline" onClick={() => void downloadTemplate()}>
                <FileUp /> Excel template
              </Button>
            }
          >
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void handleFile(e.dataTransfer.files?.[0]);
              }}
              className={
                "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors " +
                (dragOver ? "border-primary bg-primary/5" : "border-muted")
              }
            >
              <strong>Drop a file here</strong>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => fileXlsx.current?.click()} disabled={busy}>
                  Choose Excel / CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileJson.current?.click()}
                  disabled={busy}
                >
                  Choose JSON
                </Button>
              </div>
              <input
                ref={fileXlsx}
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv,.txt"
                className="hidden"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <input
                ref={fileJson}
                type="file"
                accept=".json,.txt"
                className="hidden"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </SectionCard>

          {/* ---------------- paste ---------------- */}
          <SectionCard
            title="Or paste rows"
            description="Paste CSV columns or a JSON array, then preview it."
          >
            <Textarea
              rows={6}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={
                "subject,topic,difficulty,q_hi,q_en,opt1_hi,opt2_hi,opt1_en,opt2_en,answer\n" +
                "GK & GS,Important Days,easy,राष्ट्रीय युवा दिवस कब?,When is National Youth Day?," +
                "10 जनवरी,12 जनवरी,10 January,12 January,B"
              }
              className="font-mono text-xs"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={handlePaste} disabled={busy || !paste.trim()}>
                Preview pasted rows
              </Button>
              <Button variant="ghost" onClick={() => setPaste(SAMPLE_JSON_TEXT)}>
                Insert a sample
              </Button>
            </div>
          </SectionCard>
        </>
      ) : null}

      {/* ---------------- preview ---------------- */}
      {hasPreview ? (
        <SectionCard
          title={
            preview.questions.length
              ? `Preview — ${preview.questions.length} question(s) ready`
              : "Preview"
          }
          description={sourceLabel ? `Read from ${sourceLabel}.` : undefined}
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPreview(EMPTY_PREVIEW);
                  setSourceLabel("");
                }}
              >
                Discard
              </Button>
              <Button size="sm" onClick={savePreview} disabled={busy || !preview.questions.length}>
                Save to this device
              </Button>
            </>
          }
        >
          {preview.errors.length ? (
            <div className="mb-3 border-l-4 border-destructive pl-3 text-sm">
              <strong>Rows needing a fix ({preview.errors.length})</strong>
              <ul className="mt-1.5 pl-4">
                {preview.errors.slice(0, 12).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {preview.errors.length > 12 ? (
                  <li className="text-muted-foreground">
                    … {preview.errors.length - 12} more
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {preview.warnings.length ? (
            <div className="mb-3 border-l-4 border-amber-500 pl-3 text-sm">
              <strong>Skipped duplicates ({preview.warnings.length})</strong>
              <ul className="mt-1.5 pl-4">
                {preview.warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.questions.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead>Answer</TableHead>
                    <TableHead className="w-2" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.questions.slice(0, 60).map((q, i) => (
                    <TableRow key={q.id + "-" + i}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{q.subject}</TableCell>
                      <TableCell className="text-muted-foreground">{q.topic}</TableCell>
                      <TableCell className="max-w-96 whitespace-normal">{langOf(q.question)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{q.answerLetter}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => dropPreviewRow(i)}
                          aria-label={`Drop row ${i + 1}`}
                          title="Drop this row - it will not be saved"
                        >
                          <X />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No valid rows.</p>
          )}
        </SectionCard>
      ) : null}

      {/* ---------------- AI prompt ---------------- */}
      {mayEdit ? (
        <SectionCard
          title="Or let an AI write the questions for you"
          description="Fill in the choices, copy the prompt, then paste the JSON back above."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="How many">
              <Input
                value={aiCount}
                onChange={(e) => setAiCount(e.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Subject">
              <ComboBox
                value={aiSubject}
                onChange={(v) => {
                  setAiSubject(v);
                  // Topics belong to a subject; clear one that no longer applies.
                  if (v !== aiSubject) setAiTopic("");
                }}
                options={subjectChoices}
                placeholder="Any subject"
                ariaLabel="Subject"
              />
            </Field>
            <Field label="Topic">
              <ComboBox
                value={aiTopic}
                onChange={setAiTopic}
                options={topicChoices}
                placeholder="Any topic"
                ariaLabel="Topic"
              />
            </Field>
            <Field label="Difficulty">
              <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3">
                {(["easy", "medium", "hard"] as const).map((d) => (
                  <label
                    key={d}
                    htmlFor={`ai-diff-${d}`}
                    className="flex cursor-pointer items-center gap-1.5 py-1 text-sm capitalize"
                  >
                    <Switch
                      id={`ai-diff-${d}`}
                      checked={aiDifficulties.includes(d)}
                      onCheckedChange={(v) =>
                        setAiDifficulties((prev) =>
                          v ? [...prev, d] : prev.filter((x) => x !== d)
                        )
                      }
                    />
                    {d}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Medium">
              <Select value={aiMedium} onValueChange={setAiMedium}>
                <SelectTrigger>
                  <SelectValue placeholder="Hindi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hindi">Hindi</SelectItem>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="Hindi + English">Hindi + English</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            “How many” applies per selected difficulty — 50 with all three checked means 50 easy +
            50 medium + 50 hard (150 questions in all).
          </p>

          <Textarea
            rows={12}
            readOnly
            value={prompt}
            className="mt-3 font-mono text-xs"
            aria-label="AI prompt"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(prompt);
                  toast.success("Prompt copied");
                } catch {
                  toast.error("Could not copy - select the text and copy manually");
                }
              }}
            >
              <Copy /> Copy prompt
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPaste(SAMPLE_JSON_TEXT);
                toast.success("Sample JSON pasted - replace it with the AI's answer");
              }}
            >
              <Wand2 /> Use sample JSON
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {/* ---------------- bank summary + my imports ---------------- */}
      <SectionCard
        title="Your question bank"
        description={bankStatusLine(allCount, allSubjects, mine.length)}
      >
        {mine.length ? (
          <div className="flex flex-col gap-2">
            {mine.map((q) => (
              <div key={q.id} className="flex items-center gap-3 rounded-lg border p-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {q.subject} <span className="text-muted-foreground">· {q.topic}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{langOf(q.question)}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(q)}
                    aria-label="Edit question"
                  >
                    <Pencil /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void deleteOne(q.id)}
                    aria-label="Delete question"
                  >
                    <Trash2 /> Delete
                  </Button>
                </div>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void exportQuestionsXlsx(mine, "my-questions.xlsx")}
              >
                Export my questions (Excel)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => download("my-questions.json", JSON.stringify(mine, null, 2))}
              >
                Export my questions (JSON)
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing imported yet. The seeded sample questions are shown on the home page.
          </p>
        )}
      </SectionCard>

      {/* ---------------- admin: student permissions ---------------- */}
      {isAdmin && server.mongo ? (
        <UsersCard
          users={users}
          onToggle={async (u, allow) => {
            try {
              const updated = await updateUserPermissions(u.id, { canAddQuestions: allow });
              setUsers((list) => list.map((x) => (x.id === u.id ? updated : x)));
              toast.success(
                `${updated.name || updated.userId} can now ${allow ? "add" : "not add"} questions`
              );
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not update the user");
            }
          }}
        />
      ) : null}

      <QuestionEditorDialog
        open={editorOpen && Boolean(editing)}
        question={editing}
        subjectChoices={subjectChoices}
        topicChoices={editTopicChoices}
        busy={busy}
        onOpenChange={(next) => {
          if (!next && !busy) {
            setEditorOpen(false);
            setEditing(null);
          }
        }}
        onSave={(q) => saveEdited(q)}
        onDelete={async (q) => {
          await deleteOne(q.id);
          setEditorOpen(false);
          setEditing(null);
        }}
      />

      <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
    </PageShell>
  );
}

/* ---------------- small parts ---------------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function bankStatusLine(all: number, subjects: number, mine: number): string {
  return (
    `${all} question(s) ready to practise across ${subjects} subject(s) · ` +
    `${mine} imported by you · about ${Math.round(usageBytes() / 1024)} KB of storage used.`
  );
}

function PermissionCard({ signedIn, onLogin }: { signedIn: boolean; onLogin: () => void }) {
  if (!signedIn) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 pt-6">
          <h2 className="text-lg font-semibold">Adding questions needs a login</h2>
          <p className="text-sm text-muted-foreground">
            Only the admin - or students the admin allows - can add questions to the shared bank.
            You can still take tests, and keep a private question bank on this device.
          </p>
          <Button onClick={onLogin}>Log in</Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-2 pt-6">
        <h2 className="text-lg font-semibold">Permission needed</h2>
        <p className="text-sm text-muted-foreground">
          You are signed in, but adding questions is not allowed for your account yet. Ask the
          admin to switch on &ldquo;can add questions&rdquo; for you.
        </p>
      </CardContent>
    </Card>
  );
}

function UsersCard({
  users,
  onToggle,
}: {
  users: PublicUser[];
  onToggle: (u: PublicUser, allow: boolean) => void | Promise<void>;
}) {
  if (!users.length) {
    return (
      <SectionCard title="Students" description="Accounts that may add questions.">
        <p className="text-sm text-muted-foreground">No accounts found.</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard
      title="Students"
      description="Switch on “can add questions” to let a student contribute to the shared bank."
    >
      <div className="flex flex-col gap-2">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded-lg border p-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{u.name || u.userId || "Student"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {u.email || u.phone || u.userId}
              </div>
            </div>
            <Badge variant={u.role === "admin" ? "default" : "outline"}>
              {u.role === "admin" ? "Admin" : u.canAddQuestions ? "Contributor" : "Student"}
            </Badge>
            {u.role === "admin" ? null : (
              <div className="flex items-center gap-2">
                <Label htmlFor={"addq-" + u.id} className="text-xs text-muted-foreground">
                  Can add
                </Label>
                <Switch
                  id={"addq-" + u.id}
                  checked={Boolean(u.canAddQuestions)}
                  onCheckedChange={(v) => void onToggle(u, v)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ---------------- sample data ---------------- */

const SAMPLE_JSON = [
  {
    id: "sample-1",
    subject: "GK & GS",
    topic: "Important Days",
    difficulty: "easy",
    question: {
      hi: "राष्ट्रीय युवा दिवस कब मनाया जाता है?",
      en: "When is National Youth Day celebrated?",
    },
    options: {
      hi: ["10 जनवरी", "12 जनवरी", "15 जनवरी", "24 जनवरी"],
      en: ["10 January", "12 January", "15 January", "24 January"],
    },
    answer: "B",
    explanation: { hi: "", en: "" },
    tags: ["days"],
  },
  {
    id: "sample-2",
    subject: "Science",
    topic: "Human Body",
    question: {
      hi: "मानव शरीर में कुल कितनी हड्डियाँ होती हैं?",
      en: "How many bones are there in the human body?",
    },
    options: {
      hi: ["206", "208", "204", "210"],
      en: ["206", "208", "204", "210"],
    },
    answer: "A",
  },
];

const SAMPLE_JSON_TEXT = JSON.stringify(SAMPLE_JSON, null, 2);
