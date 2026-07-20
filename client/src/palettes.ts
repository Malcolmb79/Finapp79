export interface ThemeOption {
  id: string;
  name: string;
  description: string;
  // Hue/sat feed the same hsl()-based ramp formulas theme.css already uses
  // for --accent/--seq-*/--accent-2/3/4 — only used here to render an
  // accurate swatch preview in the picker, not to apply the theme itself
  // (that's done by setting data-palette, which theme.css's per-theme
  // blocks key off of).
  hue: number;
  hue2: number;
  hue3: number;
  hue4: number;
  sat: string;
  // Light-mode background hexes, straight out of theme.css's per-theme
  // block, so the picker preview matches what selecting it actually looks
  // like instead of just showing the accent color in isolation.
  previewBg: string;
  previewSurface: string;
}

// A full theme controls background/surface/text colors AND the accent hue
// (light + dark variants of each, defined in theme.css's per-theme
// data-palette blocks) -- not just the accent color the old single-hue
// picker used to touch. Deliberately a short curated list rather than the
// old 20 hue presets: each one is hand-tuned as a cohesive "look", which a
// mechanically-rotated hue can't guarantee.
export const THEMES: ThemeOption[] = [
  {
    id: "emerald",
    name: "Emerald",
    description: "The original look — green accent on clean neutral surfaces.",
    hue: 160,
    hue2: 220,
    hue3: 340,
    hue4: 40,
    sat: "70%",
    previewBg: "#f4f5f4",
    previewSurface: "#ffffff",
  },
  {
    id: "bright",
    name: "Bright & Vibrant",
    description: "Vivid blue accent on crisp white; deep navy surfaces in dark mode.",
    hue: 222,
    hue2: 12,
    hue3: 54,
    hue4: 160,
    sat: "60%",
    previewBg: "#f7f8fb",
    previewSurface: "#ffffff",
  },
  {
    id: "minimal",
    name: "Minimal & Monochromatic",
    description: "Warm, low-contrast neutrals with a muted terracotta accent.",
    hue: 10,
    hue2: 25,
    hue3: 350,
    hue4: 18,
    sat: "25%",
    previewBg: "#f3f0ee",
    previewSurface: "#ffffff",
  },
  {
    id: "soft",
    name: "Soft & Romantic",
    description: "Pastel blush and sage tones with a soft peach accent.",
    hue: 18,
    hue2: 140,
    hue3: 350,
    hue4: 32,
    sat: "55%",
    previewBg: "#fdf4f2",
    previewSurface: "#ffffff",
  },
];

export const DEFAULT_THEME = THEMES[0].id;
