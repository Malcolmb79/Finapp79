import { useEffect, useState } from "react";
import { computeCanvasHeight, type CanvasRect } from "./useCanvasItem.js";
import { useMeasuredWidth } from "./useMeasuredWidth.js";

export interface CanvasWidgetDef {
  id: string;
  defaultWidth: number;
  defaultHeight: number;
  /** Shown in the add-widget menu. Falls back to the id where absent. */
  title?: string;
  /** Off by default: offered in the menu but not on the page until added. */
  optional?: boolean;
}

interface StoredLayout {
  rects: Record<string, CanvasRect>;
  /** Which widgets are on the page. Absent in layouts saved before this existed. */
  enabled?: string[];
}

/**
 * Position and size for a page's widgets, persisted per page.
 *
 * The dashboard grew this behaviour first; this is the same thing extracted so
 * any page can have widgets that move and resize, rather than each page
 * reimplementing the layout maths and drifting from the others.
 */
export function useCanvasLayout(storageKey: string, defs: CanvasWidgetDef[], gap = 16, columnWidth = 672) {
  const initial = load(storageKey, defs, gap, columnWidth);
  const [rects, setRects] = useState<Record<string, CanvasRect>>(initial.rects);
  const [enabled, setEnabled] = useState<string[]>(initial.enabled);
  const [canvasRef, canvasWidth] = useMeasuredWidth(columnWidth);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ rects, enabled } satisfies StoredLayout));
  }, [storageKey, rects, enabled]);

  // A widget added by a later release has no stored rect; place it without
  // disturbing anything the user has already arranged.
  useEffect(() => {
    setRects((current) => (defs.every((d) => current[d.id]) ? current : autoLayout(defs, current, gap, columnWidth)));
  }, [defs, gap, columnWidth]);

  const visible = defs.filter((def) => enabled.includes(def.id));

  return {
    rects,
    /** The widgets currently on the page, in reading order. */
    visible,
    /** Everything the page offers that isn't on it yet. */
    available: defs.filter((def) => !enabled.includes(def.id)),
    canvasRef,
    canvasWidth,
    height: computeCanvasHeight(visible.map((def) => rects[def.id]).filter(Boolean)),
    move: (id: string, x: number, y: number) =>
      setRects((current) => (current[id] ? { ...current, [id]: { ...current[id], x, y } } : current)),
    resize: (id: string, width: number, height: number) =>
      setRects((current) => (current[id] ? { ...current, [id]: { ...current[id], width, height } } : current)),
    add: (id: string) =>
      setEnabled((current) => {
        if (current.includes(id)) return current;
        // Placed below everything already on the page rather than at 0,0,
        // where it would land on top of an existing widget.
        setRects((currentRects) => {
          if (currentRects[id]) return currentRects;
          const def = defs.find((d) => d.id === id);
          if (!def) return currentRects;
          const used = current.map((otherId) => currentRects[otherId]).filter(Boolean);
          const bottom = used.reduce((max, rect) => Math.max(max, rect.y + rect.height), 0);
          return { ...currentRects, [id]: { x: 0, y: used.length > 0 ? bottom + gap : 0, width: def.defaultWidth, height: def.defaultHeight } };
        });
        return [...current, id];
      }),
    // The rect is kept: adding it back should restore the size and place it
    // was given rather than starting over.
    remove: (id: string) => setEnabled((current) => current.filter((other) => other !== id)),
  };
}

// Packs widgets left-to-right, wrapping when the next doesn't fit and starting
// a new row for full-width ones. Only ever seeds a layout — a stored rect wins.
function autoLayout(
  defs: CanvasWidgetDef[],
  existing: Record<string, CanvasRect>,
  gap: number,
  columnWidth: number
): Record<string, CanvasRect> {
  const rects = { ...existing };
  // Below whatever is already arranged, not from the top. Placing from (0,0)
  // put a widget added by a later release directly on top of one the user had
  // already positioned there — it rendered, underneath, and read as not
  // having shipped at all.
  const placed = Object.values(existing);
  let cursorX = 0;
  let rowY = placed.length > 0 ? Math.max(...placed.map((rect) => rect.y + rect.height)) + gap : 0;
  let rowHeight = 0;

  for (const def of defs) {
    if (rects[def.id]) continue;
    if (cursorX > 0 && cursorX + def.defaultWidth > columnWidth) {
      cursorX = 0;
      rowY += rowHeight + gap;
      rowHeight = 0;
    }
    rects[def.id] = { x: cursorX, y: rowY, width: def.defaultWidth, height: def.defaultHeight };
    cursorX += def.defaultWidth + gap;
    rowHeight = Math.max(rowHeight, def.defaultHeight);
  }

  return rects;
}

const defaultEnabled = (defs: CanvasWidgetDef[]) => defs.filter((def) => !def.optional).map((def) => def.id);

function load(storageKey: string, defs: CanvasWidgetDef[], gap: number, columnWidth: number): { rects: Record<string, CanvasRect>; enabled: string[] } {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (stored && typeof stored === "object") {
      // Layouts saved before widgets could be removed are a bare map of
      // rects. Everything in one was on the page by definition, so that is
      // what it migrates to — rather than resetting someone's arrangement.
      const isNewShape = "rects" in stored;
      const rects = (isNewShape ? stored.rects : stored) as Record<string, CanvasRect>;
      const enabled = isNewShape && Array.isArray(stored.enabled) ? (stored.enabled as string[]) : Object.keys(rects);
      return {
        rects: autoLayout(defs, rects, gap, columnWidth),
        // A widget the release added later is on unless it was marked
        // optional; one the user removed stays off.
        enabled: enabled.length > 0 ? [...new Set([...enabled, ...defaultEnabled(defs).filter((id) => !(id in rects))])] : defaultEnabled(defs),
      };
    }
  } catch {
    // Unreadable layout is not worth failing a page over — fall through to
    // the default arrangement.
  }
  return { rects: autoLayout(defs, {}, gap, columnWidth), enabled: defaultEnabled(defs) };
}
