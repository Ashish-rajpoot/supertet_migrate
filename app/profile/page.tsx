"use client";

/* ===========================================================
   app/profile/page.tsx - the signed-in student's own account
   Port of js/profile.js. Name and study details can be edited.
   The user ID is permanent. The phone and email identify the
   account, so they change by request: the student proposes a value
   and an admin approves it (see RequestChangeDialog).
   =========================================================== */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AuthDialog } from "@/components/auth-dialog";
import { PageShell } from "@/components/misc";
import { SubscriptionCard } from "@/components/subscription-card";
import { useAuth } from "@/components/providers";
import {
  changePassword,
  logout,
  requestContactChange,
  roleLabel,
  updateProfile,
} from "@/lib/client/auth-client";
import { EMAIL_MAX, PHONE_MAX, formatPhone, normaliseEmail } from "@/lib/contact";
import { checkServerStatus, type ServerStatus } from "@/lib/client/sync";
import { useT } from "@/lib/i18n/t";
import type { ContactRequest, PublicUser } from "@/lib/types";

/** Always the first letter of the name: works even if the photo URL fails. */
function initialOf(user: PublicUser): string {
  return (String(user.name || user.email || user.userId || "").trim()[0] || "U").toUpperCase();
}

export default function ProfilePage() {
  const { user, ready, refresh } = useAuth();
  const router = useRouter();
  const [server, setServer] = useState<ServerStatus>({ online: false, mongo: false });
  const [loginOpen, setLoginOpen] = useState(false);
  // Which contact field the "request a change" dialog is open for.
  const [askPhone, setAskPhone] = useState(false);
  const [askEmail, setAskEmail] = useState(false);

  // Editable details live in a keyed child (see DetailsForm) so switching
  // accounts remounts the form with fresh values.

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!ready) return;
    void checkServerStatus().then(setServer);
  }, [ready]);

  async function savePassword() {
    setPwError("");
    if (newPassword.length < 6) {
      setPwError("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("The two new passwords do not match");
      return;
    }
    setSavingPw(true);
    try {
      await changePassword({ currentPassword, newPassword });
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Could not change the password");
    } finally {
      setSavingPw(false);
    }
  }

  if (!ready) {
    return (
      <PageShell title="Profile" description="Your account and settings.">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell title="Profile" description="Your account and settings.">
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6">
            <h2 className="text-lg font-semibold">You are not logged in</h2>
            <p className="text-sm text-muted-foreground">
              Log in with Google, or with your User ID / Email / Phone and OTP, to see and edit
              your profile.
            </p>
            <Button onClick={() => setLoginOpen(true)}>Log in</Button>
            <p className="text-xs text-muted-foreground">
              Without an account the app still works: your questions and results stay on this
              device.
            </p>
          </CardContent>
        </Card>
        <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
      </PageShell>
    );
  }

  const offline = !server.online;

  return (
    <PageShell title="Profile" description="Your account and settings.">
      {/* ---------------- header ---------------- */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <Avatar className="size-14">
            {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
            <AvatarFallback className="text-lg">{initialOf(user)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{user.name || "Student"}</h2>
            <div className="truncate text-sm text-muted-foreground">
              {user.email || user.phone || user.userId || "Account"}
            </div>
            <div className="mt-1.5">
              <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                {roleLabel(user)}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/progress">My progress</Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                logout();
                router.push("/");
              }}
            >
              Log out
            </Button>
          </div>
          {offline ? (
            <Badge variant="outline" className="w-full justify-start py-1.5">
              Server offline - showing this device copy. Saving is disabled until you reconnect.
            </Badge>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------- identity (locked, changeable by request) ---------------- */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <h3 className="font-semibold">Account identity</h3>
          <p className="text-sm text-muted-foreground">
            Your user ID never changes. The mobile number and email identify your account, so send a
            request and an admin will approve it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <LockedRow label="User ID" value={user.userId || "-"} />
            <LockedRow
              label="Email"
              value={user.email || "not set"}
              action={
                <RequestAction
                  field="email"
                  request={user.contactRequest}
                  disabled={offline}
                  onOpen={() => setAskEmail(true)}
                />
              }
            />
            <LockedRow
              label="Phone number"
              value={user.phone ? formatPhone(user.phone) : "not set"}
              action={
                <RequestAction
                  field="phone"
                  request={user.contactRequest}
                  disabled={offline}
                  onOpen={() => setAskPhone(true)}
                />
              }
            />
            <LockedRow
              label="Verified"
              value={user.verified ? "Yes" : "No"}
              icon={<BadgeCheck className="size-4" />}
            />
          </div>
        </CardContent>
      </Card>

      <RequestChangeDialog
        field="phone"
        open={askPhone}
        onOpenChange={setAskPhone}
        disabled={offline}
        onDone={refresh}
      />
      <RequestChangeDialog
        field="email"
        open={askEmail}
        onOpenChange={setAskEmail}
        disabled={offline}
        onDone={refresh}
      />

      {/* ---------------- editable details ---------------- */}
      <DetailsForm key={user.id} user={user} disabled={offline} onSaved={refresh} />

      {/* ---------------- plan / subscription ---------------- */}
      <SubscriptionCard disabled={offline} />

      {/* ---------------- password ---------------- */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <h3 className="font-semibold">Change password</h3>
          {pwError ? <ErrorNote message={pwError} /> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Current password">
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Your current password"
              />
            </Field>
            <Field label="New password">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                autoComplete="new-password"
                placeholder="At least 6 characters"
              />
            </Field>
            <Field label="Repeat new password">
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                autoComplete="new-password"
                placeholder="Repeat"
              />
            </Field>
          </div>
          <div>
            <Button
              onClick={savePassword}
              disabled={offline || savingPw || !newPassword || !currentPassword}
            >
              Update password
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A Google-only account can set a password here to also log in with email/phone.
          </p>
        </CardContent>
      </Card>

      <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
    </PageShell>
  );
}

/* ---------------- pieces ---------------- */

/**
 * The editable account details. Seeded from `user` on mount, so switching
 * accounts remounts it (the parent passes a key) and shows the new values.
 */
function DetailsForm({
  user,
  disabled,
  onSaved,
}: {
  user: PublicUser;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(user.name || "");
  const [classLevel, setClassLevel] = useState(user.classLevel || "");
  const [city, setCity] = useState(user.city || "");
  const [school, setSchool] = useState(user.school || "");
  const [about, setAbout] = useState(user.about || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setName(user.name || "");
    setClassLevel(user.classLevel || "");
    setCity(user.city || "");
    setSchool(user.school || "");
    setAbout(user.about || "");
    setError("");
  }

  async function save() {
    setError("");
    if (name.trim().length < 2) {
      setError("Please enter your full name (at least 2 characters)");
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        name: name.trim(),
        classLevel: classLevel.trim(),
        city: city.trim(),
        school: school.trim(),
        about: about.trim(),
      });
      toast.success("Profile updated");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your details");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <h3 className="font-semibold">Edit your details</h3>
        {error ? <ErrorNote message={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </Field>
          <Field label="Class / paper">
            <Input
              value={classLevel}
              onChange={(e) => setClassLevel(e.target.value)}
              maxLength={60}
              placeholder="e.g. Class 6-8 or Paper 1"
            />
          </Field>
          <Field label="City">
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={60}
              placeholder="e.g. Lucknow"
            />
          </Field>
          <Field label="School / coaching">
            <Input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              maxLength={120}
              placeholder="Optional"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="About you">
              <Textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                rows={3}
                maxLength={120}
                placeholder="Optional, max 120 characters"
              />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={disabled || saving}>
            Save details
          </Button>
          <Button variant="ghost" onClick={reset}>
            Reset
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Email and phone number are locked. Only the admin can change them.
        </p>
      </CardContent>
    </Card>
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

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

/** One read-only identity field. */
function LockedRow({
  label,
  value,
  icon,
  action,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  /** Optional trailing control, e.g. "Request change". */
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <span className="text-muted-foreground">{icon ?? <Lock className="size-4" />}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate font-medium">{value}</div>
      </div>
      {action}
    </div>
  );
}

/**
 * The trailing control on a contact row: a button to request a change,
 * or the state of the request that is already in flight.
 */
function RequestAction({
  field,
  request,
  disabled,
  onOpen,
}: {
  field: "phone" | "email";
  request: ContactRequest | null | undefined;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { t } = useT();

  // Only the field being changed blocks the button; a pending request
  // for the phone must not stop the student asking about the email.
  if (request?.status === "pending" && request.field === field) {
    return (
      <Badge variant="outline" className="shrink-0">
        {t("contact.pending")}
      </Badge>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="shrink-0"
      onClick={onOpen}
      disabled={disabled}
      title={t("contact.requestTitle")}
    >
      {t("contact.requestTitle")}
    </Button>
  );
}

/* ===========================================================
   RequestChangeDialog - ask an admin to change the phone or email.

   These are login identifiers, so they cannot be edited directly. The
   student proposes a value and an admin approves it; nothing changes
   on the account until then. Mirrors the subscription request flow.
   =========================================================== */
function RequestChangeDialog({
  field,
  open,
  onOpenChange,
  disabled,
  onDone,
}: {
  field: "phone" | "email";
  open: boolean;
  onOpenChange: (v: boolean) => void;
  disabled: boolean;
  onDone: () => void;
}) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isPhone = field === "phone";

  useEffect(() => {
    if (open) {
      setValue("");
      setError("");
    }
  }, [open, field]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    try {
      await requestContactChange(field, value);
      toast.success(t("contact.submitted"));
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(isPhone ? "contact.phoneLabel" : "contact.emailLabel")}</DialogTitle>
          <DialogDescription>{t(isPhone ? "contact.phoneBody" : "contact.emailBody")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={send} className="grid gap-3">
          {error ? <ErrorNote message={error} /> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`req-${field}`} className="text-xs">
              {t(isPhone ? "contact.phoneLabel" : "contact.emailLabel")}
            </Label>
            <Input
              id={`req-${field}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t(isPhone ? "contact.placeholderPhone" : "contact.placeholderEmail")}
              type={isPhone ? "tel" : "email"}
              inputMode={isPhone ? "tel" : undefined}
              autoComplete="off"
              maxLength={isPhone ? PHONE_MAX : EMAIL_MAX}
            />
            {/* Show what will actually be stored, so separators and a
                missing country code are visible before submitting. */}
            {value.trim() ? (
              <p className="text-xs text-muted-foreground">
                {isPhone ? formatPhone(value) : normaliseEmail(value)}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !value.trim() || disabled}>
              {busy ? <Loader2 className="animate-spin" /> : null} {t("contact.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
