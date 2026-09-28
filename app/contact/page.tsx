"use client";

import { useState } from "react";
import { Check, Clock, Copy, ExternalLink, HelpCircle, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/misc";
import { T, useT, type StringKey } from "@/lib/i18n/t";

const CONTACT_EMAIL = "ashishrajput142@gmail.com";
const CONTACT_PHONE = "7607814860";

export default function ContactPage() {
  const { t } = useT();
  const [copiedKey, setCopiedKey] = useState<"email" | "phone" | null>(null);

  const copyToClipboard = async (text: string, type: "email" | "phone", labelKey: StringKey) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedKey(type);
      toast.success(`${t(labelKey)} ${t("common.copied")}`);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error(t("common.copyFail"));
    }
  };

  return (
    <PageShell title={t("contact.title")} description={t("contact.desc")}>
      <div className="flex flex-col gap-6">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-start gap-3.5 p-4 sm:p-5">
            <HelpCircle className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="flex-1 space-y-1">
              <p className="font-medium text-foreground">
                <T k="contact.reachOut" />
              </p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" />
                <span><T k="contact.responseTime" /></span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Email Card */}
          <Card className="flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Mail className="size-5" />
                </div>
                <div>
                  <CardTitle><T k="contact.email" /></CardTitle>
                  <CardDescription className="text-xs">
                    <T k="contact.responseTime" />
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-mono text-base font-semibold text-foreground underline-offset-4 hover:underline break-all"
              >
                {CONTACT_EMAIL}
              </a>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" className="gap-1.5 flex-1">
                  <a href={`mailto:${CONTACT_EMAIL}`}>
                    <ExternalLink className="size-4" />
                    <T k="contact.emailAction" />
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => copyToClipboard(CONTACT_EMAIL, "email", "contact.email")}
                >
                  {copiedKey === "email" ? (
                    <>
                      <Check className="size-4 text-primary" />
                      <T k="common.copied" />
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" />
                      <T k="common.copy" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Phone Card */}
          <Card className="flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Phone className="size-5" />
                </div>
                <div>
                  <CardTitle><T k="contact.phone" /></CardTitle>
                  <CardDescription className="text-xs">
                    <T k="contact.callAction" />
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <a
                href={`tel:${CONTACT_PHONE}`}
                className="font-mono text-base font-semibold text-foreground underline-offset-4 hover:underline"
              >
                +91 {CONTACT_PHONE}
              </a>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" className="gap-1.5 flex-1">
                  <a href={`tel:${CONTACT_PHONE}`}>
                    <Phone className="size-4" />
                    <T k="contact.callAction" />
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => copyToClipboard(CONTACT_PHONE, "phone", "contact.phone")}
                >
                  {copiedKey === "phone" ? (
                    <>
                      <Check className="size-4 text-primary" />
                      <T k="common.copied" />
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" />
                      <T k="common.copy" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

