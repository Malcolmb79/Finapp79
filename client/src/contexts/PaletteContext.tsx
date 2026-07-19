import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_PALETTE, PALETTES, paletteHues } from "../palettes.js";

const STORAGE_KEY = "palette";

const PaletteContext = createContext<{ palette: string; setPalette: (name: string) => void } | null>(null);

function getInitialPalette(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && PALETTES.some((p) => p.name === stored) ? stored : DEFAULT_PALETTE;
}

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState<string>(getInitialPalette);

  useEffect(() => {
    const preset = PALETTES.find((p) => p.name === palette) ?? PALETTES[0];
    const [hue1, hue2, hue3, hue4] = paletteHues(preset.hue);
    // Inline style on the root element beats any stylesheet rule (including
    // :root[data-theme] and the prefers-color-scheme media query) regardless
    // of specificity, so this is the one override point both themes read from.
    document.documentElement.style.setProperty("--palette-hue", String(hue1));
    document.documentElement.style.setProperty("--palette-hue-2", String(hue2));
    document.documentElement.style.setProperty("--palette-hue-3", String(hue3));
    document.documentElement.style.setProperty("--palette-hue-4", String(hue4));
    document.documentElement.style.setProperty("--palette-sat", preset.sat);
    localStorage.setItem(STORAGE_KEY, palette);
  }, [palette]);

  return <PaletteContext.Provider value={{ palette, setPalette }}>{children}</PaletteContext.Provider>;
}

export function usePalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used within PaletteProvider");
  return ctx;
}
