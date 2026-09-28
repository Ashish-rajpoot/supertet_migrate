"use client";

/* ===========================================================
   components/back-to-top.tsx - the round "go to top" button.

   Mounted in the floating column in app/layout.tsx. It only appears
   once the reader is past the first screenful, and it honours
   prefers-reduced-motion by jumping instead of gliding.
   =========================================================== */
import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { useT } from "@/lib/i18n/t";

/** Height after which the button is worth showing, in px. */
const SHOW_AFTER = 400;

export function BackToTop({ className }: { className?: string }) {
  const { t } = useT();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > SHOW_AFTER);
    onScroll(); // pages restored mid-scroll show it immediately
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  function toTop() {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      className={cn(
        "size-11 rounded-full bg-background/90 shadow-lg backdrop-blur",
        className,
      )}
      title={t("common.top")}
      aria-label={t("common.top")}
      onClick={toTop}
    >
      <ArrowUp className="size-5" />
    </Button>
  );
}
