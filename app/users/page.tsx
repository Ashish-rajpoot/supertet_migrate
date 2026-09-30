"use client";

/* ===========================================================
   app/users/page.tsx - admin page for account CRUD
   Only an admin may open it (the API enforces that too): create
   an account directly (no OTP step), edit profile / role /
   permissions, optionally reset a password, and delete an
   account. Your own account and the last remaining admin are
   protected - both here and on the server.
   =========================================================== */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Crown, Pencil, Plus, RefreshCw, Search, Trash2, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthDialog } from "@/components/auth-dialog";
import { EmptyState, PageShell } from "@/components/misc";
import { useAuth } from "@/components/providers";
import { T, useT, type StringKey, type Vars } from "@/lib/i18n/t";
import { checkServerStatus, type ServerStatus } from "@/lib/client/sync";
import { createUser, deleteUser, listUsers, updateUser } from "@/lib/client/auth-client";
import { fmtDate } from "@/lib/client/util";
import type { PublicUser } from "@/lib/types";

/** Values collected by the create / edit dialog. */
interface FormState {
  name: string;
  email: string;
  phone: string;
  userId: string;
  password: string;
  role: "user" | "admin";
  canAddQuestions: boolean;
  verified: boolean;
  unlimited: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  phone: "",
  userId: "",
  password: "",
  role: "user",
  canAddQuestions: false,
  verified: true,
  unlimited: false,
};

/** Small labelled control wrapper for the dialog form. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Optional muted note under the control, e.g. why a field is locked. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * Create (user = null) or edit dialog. Seeds itself every time it
 * opens, so switching between accounts always shows fresh values.
 */
function UserFormDialog({
  open,
  user,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  user: PublicUser | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: FormState) => Promise<void>;
}) {
  const { t } = useT();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;
    setForm(
      user
        ? {
            name: user.name || "",
            email: user.email || "",
            phone: user.phone || "",
            userId: user.userId || "",
            password: "",
            role: user.role === "admin" ? "admin" : "user",
            canAddQuestions: Boolean(user.canAddQuestions),
            verified: Boolean(user.verified),
            unlimited: Boolean(user.unlimited),
          }
        : { ...EMPTY_FORM }
    );
  }, [open, user]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit(form);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {user ? t("users.dialog.editTitle") : t("users.dialog.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("users.help.identifiers")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Field label={t("users.field.name")}>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={80}
              autoComplete="off"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("users.field.email")}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                maxLength={120}
                autoComplete="off"
              />
            </Field>
            <Field label={t("users.field.phone")}>
              <Input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                maxLength={20}
                autoComplete="off"
              />
            </Field>
          </div>
          {/* Set once, at creation. The server rejects a change even from
              an admin, because attempts and progress are keyed off it -
              so the field is locked here rather than offering a control
              that would fail on save. */}
          <Field
            label={t("users.field.userId")}
            hint={user ? t("users.field.userIdLocked") : undefined}
          >
            <Input
              value={form.userId}
              onChange={(e) => set("userId", e.target.value)}
              maxLength={30}
              autoComplete="off"
              readOnly={Boolean(user)}
              className={user ? "bg-muted text-muted-foreground" : undefined}
            />
          </Field>
          <Field label={user ? t("users.field.newPassword") : t("users.field.password")}>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              maxLength={100}
              autoComplete="new-password"
              placeholder={user ? "••••••" : ""}
            />
          </Field>
          <Field label={t("users.field.role")}>
            <Select
              value={form.role}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  role: v === "admin" ? "admin" : "user",
                  // Admins can always add questions - keep the flag consistent.
                  canAddQuestions: v === "admin" ? true : f.canAddQuestions,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{t("users.role.user")}</SelectItem>
                <SelectItem value="admin">{t("users.role.admin")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={form.canAddQuestions}
              onCheckedChange={(v) => set("canAddQuestions", v === true)}
              disabled={form.role === "admin"}
            />
            {t("users.sw.canAdd")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={form.verified}
              onCheckedChange={(v) => set("verified", v === true)}
            />
            {t("users.sw.verified")}
          </label>
          {user ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={form.unlimited}
                onCheckedChange={(v) => set("unlimited", v === true)}
              />
              {t("users.sw.unlimited")}
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("users.form.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {user ? t("users.form.save") : t("users.form.createSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Joined" column: ISO string from the API, "—" when unknown. */
function joinedOf(u: PublicUser): string {
  if (!u.createdAt) return "—";
  const ts = Date.parse(u.createdAt);
  return Number.isNaN(ts) ? "—" : fmtDate(ts);
}

/** Which slice of the roster the list tab shows. */
type UserFilter = "all" | "pending" | "subscribers";

/** When the paid plan ends; 0 means "no live subscription". */
function expiryOf(u: PublicUser): number {
  const ts = u.subscriptionExpiresAt ? Date.parse(u.subscriptionExpiresAt) : 0;
  return Number.isFinite(ts) && ts > Date.now() ? ts : 0;
}

/** Does the account have a payment an admin still has to decide? */
function paymentPending(u: PublicUser): boolean {
  return u.payment?.status === "pending";
}

/** Does the account enjoy full access right now (admin grant or paid plan)? */
function hasPaidAccess(u: PublicUser): boolean {
  return Boolean(u.unlimited) || expiryOf(u) > 0;
}

/** Plan badge: admin grant beats a live subscription, which beats the free quota. */
function planBadgeOf(u: PublicUser): {
  key: StringKey;
  vars?: Vars;
  tone: "default" | "secondary" | "outline";
} {
  if (u.unlimited) return { key: "users.plan.unlimited", tone: "default" };
  const until = expiryOf(u);
  if (until) return { key: "users.plan.full", vars: { date: fmtDate(until) }, tone: "secondary" };
  return { key: "users.plan.free", tone: "outline" };
}

/** Short label of a decided payment ("Approved" / "Rejected - submit again"). */
function paymentDecisionKey(status: "approved" | "rejected"): StringKey {
  return status === "approved" ? "sub.approved" : "sub.rejected";
}

/**
 * One roster row: identity + plan/payment controls + row actions.
 * Kept as its own component so the wide table body stays readable.
 */
function PlanRow({
  u,
  self,
  locked,
  roleBadge,
  onApprove,
  onReject,
  onUnlimited,
  onEdit,
  onDelete,
}: {
  u: PublicUser;
  self: boolean;
  locked: boolean;
  roleBadge: StringKey;
  onApprove: () => void;
  onReject: () => void;
  onUnlimited: (value: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const plan = planBadgeOf(u);
  const pending = paymentPending(u);
  return (
    <TableRow key={u.id}>
      <TableCell>
        <div className="font-medium">{u.name || u.userId || u.email}</div>
        <div className="text-xs text-muted-foreground">{u.userId}</div>
      </TableCell>
      <TableCell>
        <div className="text-sm">{u.email || u.phone || "—"}</div>
        {u.email && u.phone ? (
          <div className="text-xs text-muted-foreground">{u.phone}</div>
        ) : null}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge
            variant={
              u.role === "admin" ? "default" : u.canAddQuestions ? "secondary" : "outline"
            }
          >
            {t(roleBadge)}
          </Badge>
          {u.verified ? null : <Badge variant="destructive">{t("users.unverified")}</Badge>}
        </div>
      </TableCell>
      {/* -------- plan / subscription -------- */}
      <TableCell>
        <div className="flex min-w-45 flex-col items-start gap-1.5">
          <Badge variant={plan.tone} className="gap-1">
            {u.unlimited ? <Crown className="size-3.5" /> : null}
            {t(plan.key, plan.vars)}
          </Badge>
          {pending ? (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
              <T k="users.plan.pending" />
            </span>
          ) : null}
          <label
            className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
            title={t("users.grantUnlimited")}
          >
            <Switch
              size="sm"
              checked={Boolean(u.unlimited)}
              disabled={locked || self}
              onCheckedChange={(v) => onUnlimited(v)}
              aria-label={t("users.grantUnlimited")}
            />
            <T k="users.grantUnlimited" />
          </label>
          {pending && u.payment ? (
            <span className="text-xs text-muted-foreground">
              {t("users.payment.ref", { ref: u.payment.reference, method: u.payment.method })}
            </span>
          ) : u.payment ? (
            <span className="text-xs text-muted-foreground">
              {t(paymentDecisionKey(u.payment.status === "approved" ? "approved" : "rejected"))}
            </span>
          ) : null}
          {pending ? (
            <span className="inline-flex gap-1">
              <Button
                size="xs"
                onClick={onApprove}
                disabled={locked}
                aria-label={t("users.payment.approve")}
                title={t("users.payment.approve")}
              >
                <Check /> {t("users.payment.approve")}
              </Button>
              <Button
                size="xs"
                variant="destructive"
                onClick={onReject}
                disabled={locked}
                aria-label={t("users.payment.reject")}
                title={t("users.payment.reject")}
              >
                <X /> {t("users.payment.reject")}
              </Button>
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
        {joinedOf(u)}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {self ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              asChild
              aria-label={t("users.viewResults")}
              title={t("users.viewResults")}
              disabled={locked}
            >
              <Link href={`/progress?userId=${encodeURIComponent(u.id)}`}>
                <TrendingUp />
              </Link>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("users.edit")}
              title={t("users.edit")}
              disabled={locked}
              onClick={onEdit}
            >
              <Pencil />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive"
              aria-label={t("users.delete")}
              title={t("users.delete")}
              disabled={locked}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}



export default function UsersPage() {
  const { ready, user: me, signedIn, isAdmin } = useAuth();
  const { t } = useT();
  const [server, setServer] = useState<ServerStatus>({ online: false, mongo: false });
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<PublicUser | null>(null);
  const [deleting, setDeleting] = useState<PublicUser | null>(null);
  const [rejecting, setRejecting] = useState<PublicUser | null>(null);
  const [filter, setFilter] = useState<UserFilter>("all");
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const isSelf = useCallback((u: PublicUser) => Boolean(me && u.id === me.id), [me]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const status = await checkServerStatus();
      setServer(status);
      if (status.mongo) {
        setUsers(await listUsers());
      } else {
        setUsers([]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // The roster only loads for an admin - everyone else hits a gate below.
  useEffect(() => {
    if (!ready || !isAdmin) return;
    void reload();
  }, [ready, isAdmin, reload]);

  const matchesQuery = useCallback(
    (u: PublicUser) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [u.name, u.email, u.phone, u.userId].some((s) =>
        String(s || "").toLowerCase().includes(q)
      );
    },
    [query]
  );

  const pendingCount = useMemo(() => users.filter(paymentPending).length, [users]);
  const subscriberCount = useMemo(() => users.filter(hasPaidAccess).length, [users]);

  const shown = useMemo(
    () =>
      users.filter((u) => {
        if (!matchesQuery(u)) return false;
        if (filter === "pending") return paymentPending(u);
        if (filter === "subscribers") return hasPaidAccess(u);
        return true;
      }),
    [users, matchesQuery, filter]
  );

  /* ---------------- CRUD handlers ---------------- */

  async function submitCreate(form: FormState) {
    if (!form.email.trim() && !form.phone.trim()) {
      toast.error(t("users.err.needIdentifier"));
      return;
    }
    if (form.password.length < 6) {
      toast.error(t("users.err.passwordLen"));
      return;
    }
    setBusy(true);
    try {
      const created = await createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        userId: form.userId.trim(),
        password: form.password,
        role: form.role,
        verified: form.verified,
        canAddQuestions: form.canAddQuestions,
      });
      setUsers((list) => [created, ...list]);
      setCreateOpen(false);
      toast.success(t("users.toast.created"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(form: FormState) {
    if (!editUser) return;
    if (!form.email.trim() && !form.phone.trim()) {
      toast.error(t("users.err.needIdentifier"));
      return;
    }
    if (form.password && form.password.length < 6) {
      toast.error(t("users.err.passwordLen"));
      return;
    }
    setBusy(true);
    try {
      const updated = await updateUser(editUser.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        userId: form.userId.trim(),
        role: form.role,
        verified: form.verified,
        canAddQuestions: form.canAddQuestions,
        unlimited: form.unlimited,
        ...(form.password ? { password: form.password } : {}),
      });
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      setEditUser(null);
      toast.success(t("users.toast.updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const removed = await deleteUser(deleting.id);
      setUsers((list) => list.filter((x) => x.id !== removed.id));
      setDeleting(null);
      toast.success(t("users.toast.deleted"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- subscription / payment actions ---------------- */

  /** Approve a pending payment (extends the plan by 30 days on the server). */
  async function approvePayment(u: PublicUser) {
    setRowBusy(u.id);
    try {
      const updated = await updateUser(u.id, { paymentDecision: "approved" });
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      toast.success(t("users.payment.approved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRowBusy(null);
    }
  }

  /** Second step of the reject button - the dialog asks for confirmation. */
  async function confirmReject() {
    if (!rejecting) return;
    setRowBusy(rejecting.id);
    try {
      const updated = await updateUser(rejecting.id, { paymentDecision: "rejected" });
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      setRejecting(null);
      toast.success(t("users.payment.rejected"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRowBusy(null);
    }
  }

  /** Grant / revoke admin-side unlimited access from the row toggle. */
  async function toggleUnlimited(u: PublicUser, value: boolean) {
    setRowBusy(u.id);
    try {
      const updated = await updateUser(u.id, { unlimited: value });
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      if (editUser && editUser.id === updated.id) setEditUser(updated);
      toast.success(t(value ? "users.unlimitedOn" : "users.unlimitedOff"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRowBusy(null);
    }
  }

  /* ---------------- gates ---------------- */

  if (!ready) {
    return (
      <PageShell title={t("users.title")} description={t("users.desc")}>
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (!signedIn) {
    return (
      <PageShell title={t("users.title")} description={t("users.desc")}>
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6">
            <h2 className="text-lg font-semibold">
              <T k="users.login.title" />
            </h2>
            <p className="text-sm text-muted-foreground">
              <T k="users.login.hint" />
            </p>
            <Button onClick={() => setLoginOpen(true)}>
              <T k="auth.logIn" />
            </Button>
          </CardContent>
        </Card>
        <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
      </PageShell>
    );
  }

  if (!isAdmin) {
    return (
      <PageShell title={t("users.title")} description={t("users.desc")}>
        <Card>
          <CardContent className="flex flex-col items-start gap-2 pt-6">
            <h2 className="text-lg font-semibold">
              <T k="users.adminOnly.title" />
            </h2>
            <p className="text-sm text-muted-foreground">
              <T k="users.adminOnly.hint" />
            </p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (loading) {
    return (
      <PageShell title={t("users.title")} description={t("users.desc")} wide>
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (!server.mongo) {
    return (
      <PageShell title={t("users.title")} description={t("users.desc")} wide>
        <EmptyState
          title={t("users.offline.title")}
          hint={t("users.offline.hint")}
          action={
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw /> {t("users.refresh")}
            </Button>
          }
        />
      </PageShell>
    );
  }

  /* ---------------- main ---------------- */

  const roleBadgeKey = (u: PublicUser): StringKey =>
    u.role === "admin"
      ? "users.badge.admin"
      : u.canAddQuestions
        ? "users.badge.contributor"
        : "users.badge.student";

  return (
    <PageShell
      title={t("users.title")}
      description={t("users.desc")}
      wide
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw /> {t("users.refresh")}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={busy}>
            <Plus /> {t("users.add")}
          </Button>
        </>
      }
    >
      {/* ---------------- search + filters ---------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("users.search")}
            className="pl-9"
          />
        </div>
        <Badge variant="secondary">{t("users.count", { n: shown.length })}</Badge>
      </div>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as UserFilter)}>
        <TabsList aria-label={t("users.title")} className="flex-wrap">
          <TabsTrigger value="all">
            <T k="users.filter.all" />
          </TabsTrigger>
          <TabsTrigger value="pending">
            <T k="users.filter.pending" vars={{ n: pendingCount }} />
          </TabsTrigger>
          <TabsTrigger value="subscribers">
            <T k="users.filter.subscribers" /> ({subscriberCount})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ---------------- roster ---------------- */}
      {!users.length ? (
        <EmptyState
          title={t("users.empty.title")}
          hint={t("users.empty.hint")}
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={busy}>
              <Plus /> {t("users.add")}
            </Button>
          }
        />
      ) : !shown.length ? (
        <EmptyState title={t("users.noMatch.title")} hint={t("users.noMatch.hint")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("users.th.user")}</TableHead>
                <TableHead>{t("users.th.contact")}</TableHead>
                <TableHead>{t("users.th.role")}</TableHead>
                <TableHead>{t("users.th.plan")}</TableHead>
                <TableHead>{t("users.th.joined")}</TableHead>
                <TableHead className="text-right">{t("users.th.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((u) => (
                <PlanRow
                  key={u.id}
                  u={u}
                  self={isSelf(u)}
                  locked={busy || rowBusy === u.id}
                  roleBadge={roleBadgeKey(u)}
                  onApprove={() => void approvePayment(u)}
                  onReject={() => setRejecting(u)}
                  onUnlimited={(v) => void toggleUnlimited(u, v)}
                  onEdit={() => setEditUser(u)}
                  onDelete={() => setDeleting(u)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <T k="users.help.self" />
      </p>

      {/* ---------------- dialogs ---------------- */}
      <UserFormDialog
        open={createOpen}
        user={null}
        busy={busy}
        onClose={() => setCreateOpen(false)}
        onSubmit={submitCreate}
      />
      <UserFormDialog
        open={Boolean(editUser)}
        user={editUser}
        busy={busy}
        onClose={() => setEditUser(null)}
        onSubmit={submitEdit}
      />
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("users.dialog.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("users.dialog.deleteBody", {
                name: deleting?.name || deleting?.userId || deleting?.email || "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
              {t("users.form.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
              {t("users.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Confirm before discarding a student's payment request. */}
      <Dialog
        open={Boolean(rejecting)}
        onOpenChange={(v) => {
          if (!v) setRejecting(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("users.payment.reject")}</DialogTitle>
            <DialogDescription>
              <T k="users.confirmReject" />
            </DialogDescription>
          </DialogHeader>
          {rejecting?.payment ? (
            <p className="text-sm text-muted-foreground">
              {t("users.payment.ref", {
                ref: rejecting.payment.reference,
                method: rejecting.payment.method,
              })}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={rowBusy !== null}>
              {t("users.form.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmReject()} disabled={rowBusy !== null}>
              {t("users.payment.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
