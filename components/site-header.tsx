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
import { GraduationCap, Menu, ChevronDown, LogOut, UserRound } from "lucide-react";
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

function identity(user: { email?: string; phone?: string; userId?: string } | null): string {
  if (!user) return "";
  return user.email || user.phone || user.userId || "";
}

export function UserChip() {
  const { user } = useAuth();
  const router = useRouter();
  const [loginOpen, setLoginOpen] = useState(false);
  if (!user) {
    return (
      <>
        <Button size="sm" onClick={() => setLoginOpen(true)}>
          Log in
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
          <span className="max-w-24 truncate text-sm font-medium">{user.name || "Student"}</span>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {roleLabel(user)}
          </Badge>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate font-semibold">{user.name || "Student"}</div>
          <div className="truncate text-xs text-muted-foreground">{identity(user)}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <UserRound /> My profile
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            logout();
            router.push("/");
          }}
        >
          <LogOut /> Log out
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
              <div className="truncate font-semibold">{user.name || "Student"}</div>
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
              My profile
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
              Log out
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Sign in to save your results, track progress and help maintain the shared question
            bank.
          </p>
          <Button className="w-full" onClick={() => setLoginOpen(true)}>
            Log in / Sign up
          </Button>
          <AuthDialog open={loginOpen} onOpenChange={setLoginOpen} initialTab="login" />
        </div>
      )}
      {(["study", "manage"] as const).map((g) => {
        const items = links.filter((l) => l.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="flex flex-col gap-1">
            <div className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {GROUP_TITLES[g]}
            </div>
            {items.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={onNavigate}
                className="rounded-lg px-2 py-2 transition-colors hover:bg-muted"
              >
                <div className="text-sm font-medium">{l.label}</div>
                <div className="text-xs text-muted-foreground">{l.hint}</div>
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const links = visibleNav({ signedIn, mayEdit, isAdmin });
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <GraduationCap className="size-6 text-primary" />
          <span>SuperTET Prep</span>
        </Link>
        <nav className="ml-2 hidden items-center gap-1 lg:flex" aria-label="Primary">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isActive(l.href) && "bg-muted text-foreground"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-1.5 sm:flex">
          <UserChip />
        </div>
        <div className="ml-auto flex items-center gap-1 sm:hidden">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 overflow-y-auto">
              <SheetHeader className="text-left">
                <SheetTitle className="flex items-center gap-2">
                  <GraduationCap className="size-5 text-primary" /> SuperTET Prep
                </SheetTitle>
                <SheetDescription>Bilingual SuperTET practice tests</SheetDescription>
              </SheetHeader>
              <DrawerBody onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
