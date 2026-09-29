"use client";

/* ===========================================================
   components/subscription-card.tsx - plan status + upgrade

   Shown on the Profile page for a signed-in account. It reads
   /api/access for the live quota (used / free) and lets the user
   submit a payment transaction number, which the admin approves
   from the Users page. Admins can also grant unlimited access
   without payment - then this card just reports the plan.
   =========================================================== */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, Crown, Lock, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/providers";
import { T, useT } from "@/lib/i18n/t";
import { fetchAccess, hasFullAccess, submitPayment } from "@/lib/client/auth-client";
import { fmtDate } from "@/lib/client/util";
import type { AccessStatus } from "@/lib/types";

/** Payment target shown in the upgrade dialog (optional env value). */
const PAY_TO = process.env.NEXT_PUBLIC_PAYMENT_UPI || "";

function usedPct(used: number, free: number): number {
  if (!free) return 0;
  return Math.min(100, Math.round((used / free) * 100));
}

export function SubscriptionCard({ disabled = false }: { disabled?: boolean }) {
  const { user, refresh } = useAuth();
  const { t } = useT();
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("upi");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus(await fetchAccess());
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  if (!user) return null;

  // The server is the source of truth, but fall back to the cached
  // session so the card still makes sense while /api/access is loading.
  const full = status ? status.fullAccess : hasFullAccess(user);
  const unlimited = status ? status.unlimited : Boolean(user.unlimited);
  const used = status?.testsUsed ?? 0;
  const free = status?.testsFree ?? 5;
  const left = status ? status.testsRemaining : Math.max(0, free - used);
  const pending = status?.payment?.status === "pending";
  const rejected = status?.payment?.status === "rejected";

  async function send(e: FormEvent) {
    e.preventDefault();
    if (reference.trim().length < 4) {
      toast.error(t("sub.errRef"));
      return;
    }
    setBusy(true);
    try {
      const next = await submitPayment({ reference: reference.trim(), method });
      setStatus(next);
      setReference("");
      setOpen(false);
      toast.success(t("sub.submitted"));
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">
            <T k="sub.title" />
          </h3>
          <Badge variant={full ? "default" : "secondary"}>
            {unlimited ? t("sub.planUnlimited") : full ? t("sub.planFull") : t("sub.planFree")}
          </Badge>
          {pending ? <Badge variant="outline">{t("sub.pending")}</Badge> : null}
          {rejected ? <Badge variant="destructive">{t("sub.rejected")}</Badge> : null}
        </div>

        {full ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            {unlimited ? (
              <Crown className="mt-0.5 size-4 text-primary" />
            ) : (
              <BadgeCheck className="mt-0.5 size-4 text-primary" />
            )}
            <span>
              {unlimited ? <T k="sub.unlimitedHint" /> : <T k="sub.fullHint" />}
              {status?.subscriptionExpiresAt ? (
                <span className="mt-1 block">
                  {t("sub.until", { date: fmtDate(Date.parse(status.subscriptionExpiresAt)) })}
                </span>
              ) : null}
            </span>
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              <T k="sub.freeHint" vars={{ n: free }} />
            </p>
            <div className="flex items-center gap-3">
              <Progress value={usedPct(used, free)} className="h-2 flex-1" />
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {t("sub.used", { used, free })}
              </span>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Upload className="size-4 shrink-0" />
              <T k="sub.uploadLocked" />
            </p>
            {status?.payment?.reference ? (
              <p className="text-xs text-muted-foreground">
                {t("sub.refLabel", { ref: status.payment.reference })}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setOpen(true)} disabled={disabled || pending}>
                <Lock /> {t("sub.upgrade")}
              </Button>
              {left === 0 ? (
                <Badge variant="destructive">{t("sub.noneLeft")}</Badge>
              ) : (
                <Badge variant="outline">{t("sub.left", { n: left })}</Badge>
              )}
            </div>
          </>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("sub.upgradeTitle")}</DialogTitle>
              <DialogDescription>{t("sub.upgradeBody")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={send} className="grid gap-3">
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <T k="sub.benefits" />
              </p>
              <div className="grid gap-1">
                <span className="text-sm font-medium">{t("sub.payTo")}</span>
                {PAY_TO ? (
                  <span className="font-mono text-sm">{PAY_TO}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    <T k="sub.contactAdmin" />
                  </span>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sub-method">{t("sub.method")}</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id="sub-method" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upi">{t("sub.methodUpi")}</SelectItem>
                    <SelectItem value="bank">{t("sub.methodBank")}</SelectItem>
                    <SelectItem value="other">{t("sub.methodOther")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sub-ref">{t("sub.reference")}</Label>
                <Input
                  id="sub-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={64}
                  autoComplete="off"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  {t("users.form.cancel")}
                </Button>
                <Button type="submit" disabled={busy}>
                  <Send /> {t("sub.submit")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}