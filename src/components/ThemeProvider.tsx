"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
type Ctx = { theme: Theme; toggle: () => void };

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The blocking script in the root layout already applied the right class
  // to <html> before hydration -- read it back instead of guessing again,
  // so this never briefly disagrees with what's already on screen.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // Reading the DOM class the blocking script already set, once after
    // mount, is the documented way to sync post-hydration browser-only state
    // without a server/client mismatch (computing it during render instead
    // would disagree with the server-rendered "light" default).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggle = () =>
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("theme", next);
      } catch {
        // Preference just won't persist across reloads in this context.
      }
      return next;
    });

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
