"use client";

/* ===========================================================
   components/auth-dialog.tsx - login / signup / OTP in a dialog
   Mirrors the classic auth modal: tabs for Login, Sign up and
   OTP login, an OTP step after registration, Google Sign-In
   when a client id is configured, error box, busy states.
   =========================================================== */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deriveUserId } from "@/lib/userid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  login,
  loginWithGoogleCredential,
  loginWithOtp,
  register,
  resendOtp,
  verifyOtp,
  type SyncError,
} from "@/lib/client/auth-client";
import { useAuth, useSettings } from "./providers";

type Tab = "login" | "signup" | "otp";

interface OtpCtx {
  target: string;
  type: string;
  mode: "register" | "login";
  note?: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

function OtpStep({
  ctx,
  onDone,
  onBack,
}: {
  ctx: OtpCtx;
  onDone: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [devOtp, setDevOtp] = useState(ctx.note || "");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (ctx.mode === "register") {
        await verifyOtp({ target: ctx.target, code: code.trim(), type: ctx.type });
        toast.success("Account verified - welcome!");
      } else {
        await loginWithOtp({ target: ctx.target, code: code.trim() });
        toast.success("Logged in");
      }
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      const r = await resendOtp(ctx.target, ctx.type);
      if (r.devOtp) setDevOtp(r.devOtp);
      toast.success("A fresh code was sent");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Enter the 6-digit code sent to <strong className="text-foreground">{ctx.target}</strong>.
      </p>
      {devOtp ? (
        <Alert>
          <AlertDescription>
            Dev mode - your code is <strong>{devOtp}</strong>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="auth-otp">One-time code</Label>
        <Input
          id="auth-otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
        />
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy || code.trim().length !== 6} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : null} Verify
        </Button>
        <Button variant="outline" disabled={busy} onClick={resend}>
          Resend
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
function LoginForm({ onNeedOtp }: { onNeedOtp: (c: OtpCtx) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await login({ identifier: identifier.trim(), password });
      toast.success("Logged in");
    } catch (e) {
      const se = e as SyncError;
      if (se.needsVerification && se.target) {
        onNeedOtp({
          target: se.target,
          type: "register",
          mode: "register",
          note: se.devOtp,
        });
        return;
      }
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-id">Email, phone or user ID</Label>
        <Input
          id="login-id"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-pw">Password</Label>
        <Input
          id="login-pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || !identifier.trim() || !password}>
        {busy ? <Loader2 className="animate-spin" /> : null} Log in
      </Button>
    </form>
  );
}

function SignupForm({ onNeedOtp }: { onNeedOtp: (c: OtpCtx) => void }) {
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The id the server will derive if the field is left blank. Purely
  // cosmetic here: uniqueness is settled server-side.
  const suggested = deriveUserId(identifier.trim());

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await register({
        name: name.trim(),
        identifier: identifier.trim(),
        userId: userId.trim(),
        password,
      });
      onNeedOtp({
        target: r.target,
        type: "register",
        mode: "register",
        note: r.devOtp,
      });
      toast.success("Account created - verify the code");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="su-name">Your name</Label>
        <Input
          id="su-name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="su-id">Email or phone</Label>
        <Input
          id="su-id"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="su-uid">User ID (optional, for login)</Label>
        <Input
          id="su-uid"
          placeholder="e.g. rani123"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        {/* Show the id that will actually be used, so the rule is never a
            surprise. Left as the real part of the address, not a truncated
            one - see lib/userid.ts. */}
        <p className="text-xs text-muted-foreground">
          {userId.trim()
            ? `Your user ID will be "${userId.trim().toLowerCase()}"`
            : suggested
              ? `Leave blank to use "${suggested}"`
              : "Leave blank to use the part of your email before @"}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="su-pw">Password (min 6 characters)</Label>
        <Input
          id="su-pw"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={busy || !identifier.trim() || password.length < 6}
      >
        {busy ? <Loader2 className="animate-spin" /> : null} Create account
      </Button>
    </form>
  );
}
function OtpLoginForm({ onNeedOtp }: { onNeedOtp: (c: OtpCtx) => void }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await resendOtp(target.trim(), "login");
      onNeedOtp({ target: r.target || target.trim(), type: "login", mode: "login", note: r.devOtp });
      toast.success("Code sent");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="otp-id">Email or phone</Label>
        <Input
          id="otp-id"
          autoComplete="username"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || !target.trim()}>
        {busy ? <Loader2 className="animate-spin" /> : null} Send code
      </Button>
    </form>
  );
}

/** The slice of window that Google Identity Services adds. */
interface GoogleWindow {
  google?: {
    accounts?: {
      id?: {
        initialize: (o: object) => void;
        renderButton: (el: Element, o: object) => void;
      };
    };
  };
}

/** True once the Identity Services script has actually run. */
function gsiLoaded(): boolean {
  return Boolean((window as unknown as GoogleWindow).google?.accounts?.id);
}

function GoogleButton() {
  const { settings } = useSettings();
  // The id the deployment was built with wins; settings.googleClientId remains
  // as a per-device override for installs that stored one.
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || settings.googleClientId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Identity Services arrives asynchronously, so the button can only be
  // rendered after its script has loaded. Waiting on this flag instead of
  // hoping the script beat the first effect is what makes the button appear
  // on the very first open of the dialog.
  const [gsiReady, setGsiReady] = useState(false);

  useEffect(() => {
    if (!clientId || gsiLoaded()) {
      if (clientId) setGsiReady(true);
      return;
    }
    const onLoad = () => setGsiReady(true);
    const existing = document.getElementById("google-gsi");
    if (existing) {
      existing.addEventListener("load", onLoad, { once: true });
      return () => existing.removeEventListener("load", onLoad);
    }
    const s = document.createElement("script");
    s.id = "google-gsi";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.addEventListener("load", onLoad, { once: true });
    s.addEventListener("error", () => setError("Could not reach Google Sign-In."));
    document.head.appendChild(s);
    return () => s.removeEventListener("load", onLoad);
  }, [clientId]);

  async function handleCredential(credential: string) {
    setBusy(true);
    setError("");
    try {
      await loginWithGoogleCredential(credential);
      toast.success("Logged in with Google");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!clientId || !gsiReady) return;
    const w = window as unknown as GoogleWindow;
    if (!w.google?.accounts?.id) return;
    const host = document.getElementById("google-btn-host");
    if (!host || host.dataset.done) return;
    host.dataset.done = "1";
    w.google.accounts.id.initialize({
      client_id: clientId,
      callback: (resp: { credential?: string }) => {
        if (resp.credential) void handleCredential(resp.credential);
      },
    });
    w.google.accounts.id.renderButton(host, { theme: "outline", size: "large", width: 280 });
  }, [clientId, gsiReady]);

  if (!clientId) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div id="google-btn-host" className="flex justify-center" />
      {busy ? <Loader2 className="animate-spin" /> : null}
      {error ? (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function AuthDialog({
  open,
  onOpenChange,
  initialTab = "login",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTab?: Tab;
}) {
  const { signedIn } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [otpCtx, setOtpCtx] = useState<OtpCtx | null>(null);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setOtpCtx(null);
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (signedIn && open) onOpenChange(false);
  }, [signedIn, open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log in / Sign up</DialogTitle>
          <DialogDescription>
            Save results, track progress and help maintain the shared question bank.
          </DialogDescription>
        </DialogHeader>
        {otpCtx ? (
          <OtpStep
            ctx={otpCtx}
            onDone={() => onOpenChange(false)}
            onBack={() => setOtpCtx(null)}
          />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="login">Log in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
              <TabsTrigger value="otp">OTP</TabsTrigger>
            </TabsList>
            <TabsContent value="login" className="mt-4">
              <LoginForm onNeedOtp={setOtpCtx} />
            </TabsContent>
            <TabsContent value="signup" className="mt-4">
              <SignupForm onNeedOtp={setOtpCtx} />
            </TabsContent>
            <TabsContent value="otp" className="mt-4">
              <OtpLoginForm onNeedOtp={setOtpCtx} />
            </TabsContent>
          </Tabs>
        )}
        {!otpCtx ? (
          <div className="mt-2">
            <GoogleButton />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
