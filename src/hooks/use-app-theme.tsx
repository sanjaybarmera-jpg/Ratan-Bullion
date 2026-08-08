import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppTheme = "dark" | "light";
const KEY = "rb_app_theme";

type Ctx = { theme: AppTheme; setTheme: (t: AppTheme) => void; toggle: () => void };

const AppThemeContext = createContext<Ctx>({ theme: "dark", setTheme: () => {}, toggle: () => {} });

/**
 * Customer-app theme preference (light / dark), persisted in localStorage.
 * The class is applied to <html> so portals (modals, toasts) inherit it too.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>("dark");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setThemeState(saved);
    } catch {}
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("rb-light", theme === "light");
    return () => el.classList.remove("rb-light");
  }, [theme]);

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t);
    try { window.localStorage.setItem(KEY, t); } catch {}
  }, []);

  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(AppThemeContext);
}
