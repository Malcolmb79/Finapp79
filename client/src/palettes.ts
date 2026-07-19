export interface Palette {
  name: string;
  hue: number;
  sat: string;
}

// Each preset is just a hue + saturation pair — theme.css computes every
// ramp step (light/dark, seq-100..600, accent) from these two values, so
// adding a palette here is the only thing needed to make it selectable.
export const PALETTES: Palette[] = [
  { name: "Emerald", hue: 160, sat: "70%" },
  { name: "Blue", hue: 217, sat: "80%" },
  { name: "Indigo", hue: 243, sat: "75%" },
  { name: "Violet", hue: 262, sat: "75%" },
  { name: "Purple", hue: 280, sat: "65%" },
  { name: "Fuchsia", hue: 292, sat: "75%" },
  { name: "Pink", hue: 330, sat: "75%" },
  { name: "Rose", hue: 350, sat: "75%" },
  { name: "Red", hue: 0, sat: "72%" },
  { name: "Orange", hue: 25, sat: "85%" },
  { name: "Amber", hue: 38, sat: "90%" },
  { name: "Yellow", hue: 48, sat: "90%" },
  { name: "Lime", hue: 84, sat: "65%" },
  { name: "Green", hue: 142, sat: "65%" },
  { name: "Teal", hue: 175, sat: "65%" },
  { name: "Cyan", hue: 190, sat: "75%" },
  { name: "Sky", hue: 200, sat: "80%" },
  { name: "Slate", hue: 215, sat: "20%" },
  { name: "Stone", hue: 30, sat: "15%" },
  { name: "Crimson", hue: 345, sat: "60%" },
];

export const DEFAULT_PALETTE = PALETTES[0].name;

/**
 * Tetradic (rectangle) color scheme: [primary, +60°, +180°, +240°] — two
 * complementary pairs 60° apart, a standard four-color harmony. The primary
 * still drives every data-encoding surface (accent, sequential ramp) per
 * the dataviz skill's "one hue for magnitude" rule; hues 2-4 are only for
 * decorative/categorical use (widget icon badges, palette swatch preview),
 * never for a chart series that represents a single measured quantity.
 */
export function paletteHues(hue: number): [number, number, number, number] {
  return [hue, (hue + 60) % 360, (hue + 180) % 360, (hue + 240) % 360];
}
