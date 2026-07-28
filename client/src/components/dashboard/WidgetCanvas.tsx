import { Plus, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import CanvasCard from "./CanvasCard.js";
import { STACK_BELOW } from "../../dashboardWidgets.js";
import { MIN_WIDGET_HEIGHT, MIN_WIDGET_WIDTH } from "../../dashboardWidgets.js";
import { useCanvasLayout, type CanvasWidgetDef } from "../../utils/useCanvasLayout.js";

/**
 * A page of widgets that can be moved, resized, added and removed.
 *
 * The dashboard grew this first and the other pages were static cards, so
 * "hold to move" worked in one place and nowhere else. Everything a page needs
 * to differ about is its widget list and their contents; the arranging,
 * persisting, stacking on a phone and the add/remove menu are the same
 * everywhere and live here rather than being copied per page.
 */

export interface WidgetSpec extends CanvasWidgetDef {
  title: string;
  icon: LucideIcon;
  accentVar?: string;
  render: () => ReactNode;
  headerExtra?: ReactNode;
}

export default function WidgetCanvas({ storageKey, widgets }: { storageKey: string; widgets: WidgetSpec[] }) {
  // Stable identity so the layout hook doesn't re-seed on every render.
  const defs = useMemo(
    () => widgets.map(({ id, defaultWidth, defaultHeight, title, optional }) => ({ id, defaultWidth, defaultHeight, title, optional })),
    [widgets]
  );
  const { rects, visible, available, canvasRef, canvasWidth, height, move, resize, add, remove } = useCanvasLayout(storageKey, defs);
  const [menuOpen, setMenuOpen] = useState(false);

  const byId = new Map(widgets.map((w) => [w.id, w]));
  const stacked = canvasWidth < STACK_BELOW;
  // Top to bottom then left to right, so a phone reads them in the order they
  // sit in on a wide screen.
  const ordered = [...visible].sort((a, b) => {
    const ra = rects[a.id];
    const rb = rects[b.id];
    if (!ra || !rb) return 0;
    return ra.y - rb.y || ra.x - rb.x;
  });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.6rem", position: "relative" }}>
        <button onClick={() => setMenuOpen((open) => !open)} disabled={available.length === 0}>
          <Plus size={14} />
          Add widget
        </button>
        {menuOpen && available.length > 0 && (
          <div className="add-widget-menu" style={{ position: "absolute", top: "100%", right: 0, zIndex: 40, minWidth: 200 }}>
            {available.map((def) => (
              <button
                key={def.id}
                className="add-widget-menu__item"
                onClick={() => {
                  add(def.id);
                  setMenuOpen(false);
                }}
              >
                {def.title ?? def.id}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={canvasRef} className="dashboard-canvas" style={{ position: "relative", height: stacked ? "auto" : height }}>
        {ordered.length === 0 ? (
          <p className="empty-state">Nothing here yet — use Add widget to choose what to show.</p>
        ) : (
          ordered.map((def) => {
            const widget = byId.get(def.id);
            const rect = rects[def.id];
            if (!widget || !rect) return null;
            return (
              <CanvasCard
                key={def.id}
                title={widget.title}
                icon={widget.icon}
                accentVar={widget.accentVar ?? "--accent"}
                headerExtra={widget.headerExtra}
                rect={rect}
                minWidth={MIN_WIDGET_WIDTH}
                minHeight={MIN_WIDGET_HEIGHT}
                availableWidth={canvasWidth}
                onMove={(x, y) => move(def.id, x, y)}
                onResize={(width, widgetHeight) => resize(def.id, width, widgetHeight)}
                onRemove={() => remove(def.id)}
                stacked={stacked}
              >
                {widget.render()}
              </CanvasCard>
            );
          })
        )}
      </div>
    </>
  );
}
