"use client";

/* ===========================================================
   components/site-header.tsx - sticky top bar
   Desktop nav + account chip or Log in button; a Sheet drawer
   carries the same links on phones. Language and theme live in
   the footer (see components/misc.tsx).
   =========================================================== */
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "cn";
import { GraduationCap, Menu, ChevronDown, LogOut, UserRound, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "./providers";
import { AuthDialog } from "./auth-dialog";
import { roleLabel, logout } from "@/lib/client/auth-client";
import { T, useT } from "@/lib/i18n/t";

function identity(user: { email?: string; phone?: string; userId?: string } | null): string {
  if (!user) return "";
  return user.email || user.phone || user.userId || "";
}

export function UserChip() {
  const { user } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const [loginOpen, setLoginOpen] = useState(false);
  if (!user) {
    return (
      <>
        <Button size="sm" onClick={() => setLoginOpen(true)}>
          <T k="auth.logIn" />
        </Button>
        <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
      </>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 pl-1.5 pr-2">
          <Avatar className="size-7">
            {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
            <AvatarFallback>{(user.name || "S").slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="max-w-24 truncate text-sm font-medium">
            {user.name || t("auth.student")}
          </span>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {roleLabel(user)}
          </Badge>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate font-semibold">{user.name || t("auth.student")}</div>
          <div className="truncate text-xs text-muted-foreground">{identity(user)}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <UserRound /> <T k="auth.myProfile" />
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            logout();
            router.push("/");
          }}
        >
          <LogOut /> <T k="auth.logOut" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { GROUP_TITLES, visibleNav } from "@/lib/nav";

function DrawerBody({ onNavigate }: { onNavigate: () => void }) {
  const { user, signedIn, isAdmin, mayEdit } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const [loginOpen, setLoginOpen] = useState(false);
  const links = visibleNav({ signedIn, mayEdit, isAdmin });
  return (
    <div className="flex flex-col gap-4 px-1 pb-6">
      {user ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar>
              {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
              <AvatarFallback>{(user.name || "S").slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-semibold">{user.name || t("auth.student")}</div>
              <div className="truncate text-xs text-muted-foreground">{identity(user)}</div>
            </div>
            <Badge variant="secondary" className="ml-auto">
              {roleLabel(user)}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => {
                onNavigate();
                router.push("/profile");
              }}
            >
              <T k="auth.myProfile" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1"
              onClick={() => {
                logout();
                onNavigate();
                router.push("/");
              }}
            >
              <T k="auth.logOut" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t("auth.guestBody")}</p>
          <Button className="w-full" onClick={() => setLoginOpen(true)}>
            <T k="auth.logInSignUp" />
          </Button>
          <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
        </div>
      )}
      {(["study", "manage", "help"] as const).map((g) => {
        const items = links.filter((l) => l.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="flex flex-col gap-1">
            <div className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <T k={GROUP_TITLES[g]} />
            </div>
            {items.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={onNavigate}
                className="rounded-lg px-2 py-2 transition-colors hover:bg-muted"
              >
                <div className="text-sm font-medium">
                  <T k={l.label} />
                </div>
                <div className="text-xs text-muted-foreground">{t(l.hint)}</div>
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { signedIn, isAdmin, mayEdit } = useAuth();
  const { t } = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const links = visibleNav({ signedIn, mayEdit, isAdmin });
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  /* The top bar used to render every non-help link, which is ten items once
     an admin is signed in. Three things come out of it:
       - "/" goes, because the logo beside it already links home
       - "/profile" goes, because the account chip below already offers it
       - the manage group (questions / subjects / users) collapses into one
         dropdown, so a student's study links and an admin's tools can no
         longer crowd each other out.
     The drawer still lists everything, so nothing becomes unreachable. */
  const topLinks = links.filter((l) => l.group === "study" && l.href !== "/");
  const manageLinks = links.filter((l) => l.group === "manage" && l.href !== "/profile");
  const manageActive = manageLinks.some((l) => isActive(l.href));

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <GraduationCap className="size-6 text-primary" />
          <span>SuperTET Prep</span>
        </Link>
        <nav className="ml-2 hidden items-center gap-1 lg:flex" aria-label={t("auth.primaryNav")}>
          {/* Study links only - the ones a student actually reaches for. */}
          {topLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isActive(l.href) && "bg-muted text-foreground"
              )}
            >
              <T k={l.label} />
            </Link>
          ))}
          {/* Authoring and admin tools in one place, with their hints. */}
          {manageLinks.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-current={manageActive ? "page" : undefined}
                  className={cn(
                    "gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                    manageActive && "bg-muted text-foreground"
                  )}
                >
                  <Settings className="size-4" />
                  <T k="nav.group.manage" />
                  <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {manageLinks.map((l) => (
                  <DropdownMenuItem
                    key={l.href}
                    asChild
                    className={cn("py-2", isActive(l.href) && "bg-muted")}
                  >
                    <Link href={l.href} className="block w-full">
                      <span className="text-sm font-medium">
                        <T k={l.label} />
                      </span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {t(l.hint)}
                      </span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </nav>
        <div className="ml-auto hidden items-center gap-1.5 sm:flex">
          <UserChip />
        </div>
        <div className="ml-auto flex items-center gap-1 sm:hidden">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("auth.openMenu")}>
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 overflow-y-auto">
              <SheetHeader className="text-left">
                <SheetTitle className="flex items-center gap-2">
                  <GraduationCap className="size-5 text-primary" /> SuperTET Prep
                </SheetTitle>
                <SheetDescription>{t("auth.drawerDesc")}</SheetDescription>
              </SheetHeader>
              <DrawerBody onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
