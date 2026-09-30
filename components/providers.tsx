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
import type { FontScale, Lang, PublicUser, Settings } from "@/lib/types";
import {
  checkSession,
  getAuthSession,
  getCurrentUser,
} from "@/lib/client/auth-client";
import { getLang, setLang as persistLang } from "@/lib/client/util";
import { getSettings, saveSettings as persistSettings } from "@/lib/client/store";
import { flushQueue, flushQuestionOutbox } from "@/lib/client/sync";
import {
  A11Y_BOOT_SCRIPT,
  getDockHidden,
  getFontScale,
  setDockHidden as persistDockHidden,
  setFontScale as persistFontScale,
} from "@/lib/client/a11y";
import {
  THEME_DEFAULT,
  getTheme,
  isThemeMode,
  type ThemeMode,
  type ThemeVariant,
} from "@/lib/client/theme";

export type { ThemeMode };

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
  fontScale: FontScale;
  setFontScale: (f: FontScale) => void;
  dockHidden: boolean;
  setDockHidden: (hidden: boolean) => void;
}

const SettingsContext = createContext<SettingsCtx>({
  settings: { ...({} as Settings) },
  saveSettings: () => {},
  themeMode: "auto",
  setThemeMode: () => {},
  fontScale: "md",
  setFontScale: () => {},
  dockHidden: false,
  setDockHidden: () => {},
});

export function useSettings(): SettingsCtx {
  return useContext(SettingsContext);
}

/** Drop every Cache Storage bucket (used to un-poison a dev session). */
async function clearCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
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
  const [themeMode, setThemeModeState] = useState<ThemeMode>(THEME_DEFAULT);
  const [lang, setLangState] = useState<Lang>("both");
  const [fontScale, setFontScaleState] = useState<FontScale>("md");
  const [dockHidden, setDockHiddenState] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * The extra palettes (sepia, contrast) live on a data-theme attribute
   * rather than the .dark class, because that class belongs to
   * next-themes. Keeping them orthogonal means a variant can later be
   * paired with either scheme without a second control.
   */
  const setThemeVariant = useCallback((v: ThemeVariant) => {
    const html = document.documentElement;
    if (v) html.setAttribute("data-theme", v);
    else html.removeAttribute("data-theme");
  }, []);

  // First paint: hydrate everything from localStorage (SSR-safe).
  useEffect(() => {
    const s = getSettings();
    setSettingsState(s);
    // Every theme is one value in one key; isThemeMode keeps a stale or
    // hand-edited value from putting the page in an unknown palette.
    const storedTheme =
      typeof window !== "undefined" ? localStorage.getItem("stp.theme") : null;
    const mode: ThemeMode = isThemeMode(storedTheme) ? storedTheme : THEME_DEFAULT;
    setThemeModeState(mode);
    setTheme(getTheme(mode).scheme);
    setThemeVariant(getTheme(mode).variant);
    setLangState(getLang());
    setFontScaleState(getFontScale());
    setDockHiddenState(getDockHidden());
    setUser(getCurrentUser());
    setReady(true);

    // Silent session re-check, outbox flush, service worker registration.
    void checkSession().then((u) => setUser(u ?? getCurrentUser()));
    void flushQueue();
    void flushQuestionOutbox();

    // The offline cache only makes sense for a production build. In dev the
    // chunk URLs are reused while their contents change, so a cache-first
    // service worker hands the App Router a JS graph and a Flight payload from
    // two different builds - which is what makes React fail with
    // "chunk.reason.enqueueModel is not a function". So: register in
    // production, and in dev unregister whatever an earlier session left
    // behind together with its caches, so a stale worker cannot keep serving
    // dead chunks on localhost.
    const onLoad = () => {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW failed", e));
        return;
      }
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .then((gone) => (gone.some(Boolean) ? clearCaches() : undefined))
        .catch(() => {});
    };
    if ("serviceWorker" in navigator) {
      const proto = window.location.protocol;
      if (proto === "http:" || proto === "https:") {
        // Hydration can finish after the load event, so cover both orders.
        if (document.readyState === "complete") onLoad();
        else window.addEventListener("load", onLoad);
      }
    }

    const onAuth = () => setUser(getCurrentUser());
    const onLang = (e: Event) => setLangState((e as CustomEvent<Lang>).detail ?? getLang());
    const onA11y = (e: Event) => {
      const d = (e as CustomEvent<{ font?: FontScale; hidden?: boolean }>).detail;
      if (d?.font) setFontScaleState(d.font);
      if (typeof d?.hidden === "boolean") setDockHiddenState(d.hidden);
    };
    const onSettings = (e: Event) =>
      setSettingsState((e as CustomEvent<Settings>).detail ?? getSettings());
    /** Back online: send the results and the question edits that waited. */
    const onOnline = () => {
      void flushQueue();
      void flushQuestionOutbox();
    };
    window.addEventListener("stp:auth", onAuth);
    window.addEventListener("stp:lang", onLang);
    window.addEventListener("stp:a11y", onA11y);
    window.addEventListener("stp:settings", onSettings);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("load", onLoad);
      window.removeEventListener("stp:auth", onAuth);
      window.removeEventListener("stp:lang", onLang);
      window.removeEventListener("stp:a11y", onA11y);
      window.removeEventListener("stp:settings", onSettings);
      window.removeEventListener("online", onOnline);
    };
  }, [setTheme, setThemeVariant]);

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
      setTheme(getTheme(t).scheme);
      setThemeVariant(getTheme(t).variant);
    },
    [setTheme, setThemeVariant]
  );

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persistLang(l);
  }, []);

  const setFontScale = useCallback((f: FontScale) => {
    setFontScaleState(f);
    persistFontScale(f);
  }, []);

  const setDockHidden = useCallback((hidden: boolean) => {
    setDockHiddenState(hidden);
    persistDockHidden(hidden);
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
    () => ({
      settings,
      saveSettings,
      themeMode,
      setThemeMode,
      fontScale,
      setFontScale,
      dockHidden,
      setDockHidden,
    }),
    [
      settings,
      saveSettings,
      themeMode,
      setThemeMode,
      fontScale,
      setFontScale,
      dockHidden,
      setDockHidden,
    ]
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
    <>
      {/* Pre-paint: the saved text size and the dismissed-dock flag are put
          on <html> before the first render, the way next-themes applies the
          colour theme, so the page never jumps from the default size and a
          dismissed button never flashes back. */}
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: A11Y_BOOT_SCRIPT }} />
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider>
          <Inner>{children}</Inner>
          <Toaster richColors position="bottom-left" />
        </TooltipProvider>
      </ThemeProvider>
    </>
  );
}
