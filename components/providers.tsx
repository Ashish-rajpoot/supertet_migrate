"use client";

/* ===========================================================
   components/providers.tsx - one wrapper for every client
   provider: next-themes (auto/light/dark), plus the auth,
   language and settings contexts that mirror js/app.js +
   js/store.js behaviour.
   =========================================================== */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Lang, PublicUser, Settings } from "@/lib/types";
import {
  checkSession,
  getAuthSession,
  getCurrentUser,
} from "@/lib/client/auth-client";
import { getLang, setLang as persistLang } from "@/lib/client/util";
import { getSettings, saveSettings as persistSettings } from "@/lib/client/store";
import { flushQueue } from "@/lib/client/sync";

export type ThemeMode = "auto" | "light" | "dark";

interface AuthCtx {
  ready: boolean;
  user: PublicUser | null;
  signedIn: boolean;
  isAdmin: boolean;
  mayEdit: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  ready: false,
  user: null,
  signedIn: false,
  isAdmin: false,
  mayEdit: false,
  refresh: async () => {},
});

export function useAuth(): AuthCtx {
  return useContext(AuthContext);
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LangContext = createContext<LangCtx>({ lang: "both", setLang: () => {} });

export function useLang(): LangCtx {
  return useContext(LangContext);
}

interface SettingsCtx {
  settings: Settings;
  saveSettings: (patch: Partial<Settings>) => void;
  themeMode: ThemeMode;
  setThemeMode: (t: ThemeMode) => void;
}

const SettingsContext = createContext<SettingsCtx>({
  settings: { ...({} as Settings) },
  saveSettings: () => {},
  themeMode: "auto",
  setThemeMode: () => {},
});

export function useSettings(): SettingsCtx {
  return useContext(SettingsContext);
}
function Inner({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();

  const [settings, setSettingsState] = useState<Settings>(() => ({
    defaultCount: 20,
    defaultMinutes: 20,
    negativeMarking: 0,
    showExplanation: true,
    shuffleOptions: true,
    name: "",
    apiUrl: "",
    googleClientId: "",
  }));
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");
  const [lang, setLangState] = useState<Lang>("both");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);

  // First paint: hydrate everything from localStorage (SSR-safe).
  useEffect(() => {
    const s = getSettings();
    setSettingsState(s);
    const storedTheme =
      typeof window !== "undefined" ? localStorage.getItem("stp.theme") : null;
    const mode: ThemeMode =
      storedTheme === "light" || storedTheme === "dark" ? storedTheme : "auto";
    setThemeModeState(mode);
    setTheme(mode === "auto" ? "system" : mode);
    setLangState(getLang());
    setUser(getCurrentUser());
    setReady(true);

    // Silent session re-check, outbox flush, service worker registration.
    void checkSession().then((u) => setUser(u ?? getCurrentUser()));
    void flushQueue();
    if ("serviceWorker" in navigator) {
      const proto = window.location.protocol;
      if (proto === "http:" || proto === "https:") {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW failed", e));
        });
      }
    }
    const onAuth = () => setUser(getCurrentUser());
    const onLang = (e: Event) => setLangState((e as CustomEvent<Lang>).detail ?? getLang());
    const onSettings = (e: Event) =>
      setSettingsState((e as CustomEvent<Settings>).detail ?? getSettings());
    window.addEventListener("stp:auth", onAuth);
    window.addEventListener("stp:lang", onLang);
    window.addEventListener("stp:settings", onSettings);
    window.addEventListener("online", flushQueue);
    return () => {
      window.removeEventListener("stp:auth", onAuth);
      window.removeEventListener("stp:lang", onLang);
      window.removeEventListener("stp:settings", onSettings);
      window.removeEventListener("online", flushQueue);
    };
  }, [setTheme]);

  const saveSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState(persistSettings(patch));
  }, []);

  const setThemeMode = useCallback(
    (t: ThemeMode) => {
      setThemeModeState(t);
      try {
        localStorage.setItem("stp.theme", t);
      } catch {
        /* ignore */
      }
      setTheme(t === "auto" ? "system" : t);
    },
    [setTheme]
  );

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persistLang(l);
  }, []);

  const refresh = useCallback(async () => {
    const s = getAuthSession();
    setUser(s?.user ?? null);
    const u = await checkSession();
    setUser(u ?? getCurrentUser());
  }, []);

  const auth = useMemo<AuthCtx>(
    () => ({
      ready,
      user,
      signedIn: Boolean(user),
      isAdmin: user?.role === "admin",
      mayEdit: Boolean(user && (user.role === "admin" || user.canAddQuestions)),
      refresh,
    }),
    [ready, user, refresh]
  );

  const langCtx = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  const settingsCtx = useMemo(
    () => ({ settings, saveSettings, themeMode, setThemeMode }),
    [settings, saveSettings, themeMode, setThemeMode]
  );

  return (
    <AuthContext.Provider value={auth}>
      <LangContext.Provider value={langCtx}>
        <SettingsContext.Provider value={settingsCtx}>{children}</SettingsContext.Provider>
      </LangContext.Provider>
    </AuthContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <Inner>{children}</Inner>
        <Toaster richColors position="bottom-left" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
