"use client";

/* ===========================================================
   components/offline-badge.tsx - global offline indicator
   Listens to browser online/offline events and shows a small
   bilingual badge under the header whenever the device has no
   network. Purely informational: offline-capable pages keep
   working and save to this device; server-only actions already
   explain themselves on their own pages.
   =========================================================== */
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { T } from "@/lib/i18n/t";

export function OfflineBadge() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const goOff = () => setOnline(false);
    const goOn = () => setOnline(true);
    window.addEventListener("offline", goOff);
    window.addEventListener("online", goOn);
    return () => {
      window.removeEventListener("offline", goOff);
      window.removeEventListener("online", goOn);
    };
  }, []);
  if (online) return null;
  return (
    <div className="border-b bg-amber-500/10">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-1.5">
        <Badge variant="outline" className="gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300">
          <WifiOff className="size-3.5" aria-hidden />
          <T k="offline.badge" />
        </Badge>
      </div>
    </div>
  );
}
