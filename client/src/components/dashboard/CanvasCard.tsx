import { BarChart3, Hash, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useCanvasItem, type CanvasRect } from "../../utils/useCanvasItem.js";
import { useLongPressSelect } from "../../utils/useLongPressSelect.js";

export type WidgetMode = "number" | "chart";

// Everything snaps to this grid, so widgets line up with each other without
// needing a real grid layout underneath.
export const WIDGET_GRID_SIZE = 8;

interface CanvasCardProps {
  title: string;
  icon: LucideIcon;
  accentVar: string;
  headerExtra?: ReactNode;
  rect: CanvasRect;
  minWidth: number;
  minHeight: number;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  mode?: WidgetMode;
  onModeChange?: (mode: WidgetMode) => void;
  onRemove: () => void;
  children: ReactNode;
}

export default function CanvasCard({
  title,
  icon: Icon,
  accentVar,
  headerExtra,
  rect: storedRect,
  minWidth,
  minHeight,
  onMove,
  onResize,
  onDraggingChange,
  mode,
  onModeChange,
  onRemove,
  children,
}: CanvasCardProps) {
  const { rect, handleDragPointerDown, handleResizePointerDown } = useCanvasItem({
    initial: storedRect,
    minWidth,
    minHeight,
    gridSize: WIDGET_GRID_SIZE,
    onMove,
    onResize,
    onDraggingChange,
  });

  // Edit chrome stays hidden until the widget is held - see useLongPressSelect.
  const { ref, selected, pressHandlers } = useLongPressSelect<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className="canvas-card"
      data-selected={selected || undefined}
      style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      {...pressHandlers}
    >
      <div className="canvas-card__header">
        <div
          className="canvas-card__drag"
          onPointerDown={handleDragPointerDown}
          role="button"
          tabIndex={0}
          aria-label={`Drag to move ${title}`}
        >
          ⠿
        </div>
        <span className="widget-icon" style={{ background: `var(${accentVar})` }}>
          <Icon size={13} />
        </span>
        <span className="canvas-card__title">{title}</span>
        {headerExtra}
        <div className="canvas-card__controls">
          {mode && onModeChange && (
            <button
              type="button"
              className="icon-button"
              onClick={() => onModeChange(mode === "chart" ? "number" : "chart")}
              aria-label={mode === "chart" ? "Show as number" : "Show as chart"}
              title={mode === "chart" ? "Show as number" : "Show as chart"}
            >
              {mode === "chart" ? <Hash size={13} /> : <BarChart3 size={13} />}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={(e) => {
              // Blur before removing - on iOS Safari, removing the still-
              // focused button from the DOM makes focus fall back to <body>,
              // which scrolls the page to the top rather than leaving the
              // scroll position where it was.
              e.currentTarget.blur();
              onRemove();
            }}
            aria-label={`Remove ${title}`}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="canvas-card__content">{children}</div>

      <div
        className="canvas-card__resize"
        onPointerDown={handleResizePointerDown}
        role="button"
        tabIndex={0}
        aria-label={`Drag to resize ${title}`}
      >
        ⌟
      </div>
    </div>
  );
}
