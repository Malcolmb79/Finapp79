import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_THEME, THEMES } from "../palettes.js";

const STORAGE_KEY = "palette";

const PaletteContext = createContext<{ palette: string; setPalette: (id: string) => void } | null>(null);

function getInitialPalette(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && THEMES.some((t) => t.id === stored) ? stored : DEFAULT_THEME;
}

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState<string>(getInitialPalette);

  useEffect(() => {
    // Mirrors ThemeContext's data-theme attribute — theme.css's
    // :root[data-palette="…"] blocks (light) and
    // :root[data-palette="…"][data-theme="dark"] blocks (dark) key off
    // this to swap the full set of background/surface/text/accent colors,
    // not just the accent hue the old inline-style approach touched.
    document.documentElement.dataset.palette = palette;
    localStorage.setItem(STORAGE_KEY, palette);
  }, [palette]);

  return <PaletteContext.Provider value={{ palette, setPalette }}>{children}</PaletteContext.Provider>;
}

export function usePalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used within PaletteProvider");
  return ctx;
}
