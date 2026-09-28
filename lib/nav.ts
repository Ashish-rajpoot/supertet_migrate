/* ===========================================================
   lib/nav.ts - the one nav model for header + mobile drawer
   Ports the NAV table from js/app.js: href routes, group
   headings, one-line hints, and auth/editor/admin visibility.

   Labels and hints are dictionary keys, not text, so the
   header can render them in the footer language. See
   lib/i18n/strings.ts.
   =========================================================== */
import type { StringKey } from "@/lib/i18n/strings";

export interface NavLink {
  href: string;
  label: StringKey;
  group: "study" | "manage";
  hint: StringKey;
  auth?: boolean;
  editor?: boolean;
  admin?: boolean;
}

export const NAV: NavLink[] = [
  { href: "/", label: "nav.home", group: "study", hint: "nav.hint.home" },
  { href: "/library", label: "nav.library", group: "study", hint: "nav.hint.library" },
  { href: "/flashcards", label: "nav.flashcards", group: "study", hint: "nav.hint.flashcards" },
  { href: "/test", label: "nav.test", group: "study", hint: "nav.hint.test" },
  { href: "/progress", label: "nav.progress", group: "study", auth: true, hint: "nav.hint.progress" },
  { href: "/questions", label: "nav.questions", group: "manage", editor: true, hint: "nav.hint.questions" },
  { href: "/subjects", label: "nav.subjects", group: "manage", admin: true, hint: "nav.hint.subjects" },
  { href: "/profile", label: "nav.profile", group: "manage", auth: true, hint: "nav.hint.profile" },
];

export interface NavVisibility {
  signedIn: boolean;
  mayEdit: boolean;
  isAdmin: boolean;
}

/** Remove auth/editor/admin links the caller may not see. */
export function visibleNav(v: NavVisibility): NavLink[] {
  return NAV.filter((l) => {
    if (l.admin && !v.isAdmin) return false;
    if (l.editor && !v.mayEdit) return false;
    if (l.auth && !v.signedIn) return false;
    return true;
  });
}

export const GROUP_TITLES: Record<NavLink["group"], StringKey> = {
  study: "nav.group.study",
  manage: "nav.group.manage",
};
