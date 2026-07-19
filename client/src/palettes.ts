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
