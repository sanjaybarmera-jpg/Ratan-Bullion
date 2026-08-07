import { useCallback, useEffect, useState } from "react";

export type AdminTheme = "dark" | "light";
const KEY = "rb_admin_theme";

/**
 * Admin-only theme preference. Persisted in localStorage.
 * The returned class is applied to the admin shell wrapper only, so the
 * customer-facing app keeps its fixed dark look.
 */
export function useAdminTheme() {
  const [theme, setThemeState] = useState<AdminTheme>("dark");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setThemeState(saved);
    } catch {}
  }, []);

  const setTheme = useCallback((t: AdminTheme) => {
    setThemeState(t);
    try { window.localStorage.setItem(KEY, t); } catch {}
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try { window.localStorage.setItem(KEY, next); } catch {}
      return next;
    });
  }, []);

  return { theme, setTheme, toggle, themeClass: theme === "light" ? "rb-admin-light" : "" };
}
