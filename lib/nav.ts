/* ===========================================================
   lib/nav.ts - the one nav model for header + mobile drawer
   Ports the NAV table from js/app.js: href routes, group
   headings, one-line hints, and auth/editor/admin visibility.
   =========================================================== */

export interface NavLink {
  href: string;
  label: string;
  group: "study" | "manage";
  hint: string;
  auth?: boolean;
  editor?: boolean;
  admin?: boolean;
}

export const NAV: NavLink[] = [
  { href: "/", label: "Home", group: "study", hint: "Question bank at a glance" },
  { href: "/library", label: "Library", group: "study", hint: "Browse every subject and topic" },
  { href: "/flashcards", label: "Flashcards", group: "study", hint: "Flip cards for quick revision" },
  { href: "/test", label: "Test", group: "study", hint: "Timed test with instant scoring" },
  { href: "/progress", label: "Progress", group: "study", auth: true, hint: "Scores, weak topics and trends" },
  { href: "/questions", label: "Questions", group: "manage", editor: true, hint: "Upload, preview and export questions" },
  { href: "/subjects", label: "Subjects", group: "manage", admin: true, hint: "Syllabus subjects and topics" },
  { href: "/profile", label: "Profile", group: "manage", auth: true, hint: "Your account and settings" },
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

export const GROUP_TITLES: Record<NavLink["group"], string> = {
  study: "Study",
  manage: "Manage",
};
