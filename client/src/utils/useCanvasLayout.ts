import { useEffect, useState } from "react";
import { computeCanvasHeight, type CanvasRect } from "./useCanvasItem.js";
import { useMeasuredWidth } from "./useMeasuredWidth.js";

export interface CanvasWidgetDef {
  id: string;
  defaultWidth: number;
  defaultHeight: number;
}

/**
 * Position and size for a page's widgets, persisted per page.
 *
 * The dashboard grew this behaviour first; this is the same thing extracted so
 * any page can have widgets that move and resize, rather than each page
 * reimplementing the layout maths and drifting from the others.
 */
export function useCanvasLayout(storageKey: string, defs: CanvasWidgetDef[], gap = 16, columnWidth = 672) {
  const [rects, setRects] = useState<Record<string, CanvasRect>>(() => load(storageKey, defs, gap, columnWidth));
  const [canvasRef, canvasWidth] = useMeasuredWidth(columnWidth);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(rects));
  }, [storageKey, rects]);

  // A widget added by a later release has no stored rect; place it without
  // disturbing anything the user has already arranged.
  useEffect(() => {
    setRects((current) => (defs.every((d) => current[d.id]) ? current : autoLayout(defs, current, gap, columnWidth)));
  }, [defs, gap, columnWidth]);

  return {
    rects,
    canvasRef,
    canvasWidth,
    height: computeCanvasHeight(Object.values(rects)),
    move: (id: string, x: number, y: number) =>
      setRects((current) => (current[id] ? { ...current, [id]: { ...current[id], x, y } } : current)),
    resize: (id: string, width: number, height: number) =>
      setRects((current) => (current[id] ? { ...current, [id]: { ...current[id], width, height } } : current)),
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
  let cursorX = 0;
  let rowY = 0;
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

function load(storageKey: string, defs: CanvasWidgetDef[], gap: number, columnWidth: number): Record<string, CanvasRect> {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (stored && typeof stored === "object") return autoLayout(defs, stored, gap, columnWidth);
  } catch {
    // Unreadable layout is not worth failing a page over — fall through to
    // the default arrangement.
  }
  return autoLayout(defs, {}, gap, columnWidth);
}
