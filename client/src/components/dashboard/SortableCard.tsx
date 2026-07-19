import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Settings2, X, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

export type WidgetSize = 1 | 2 | 3;
export type WidgetMode = "chart" | "number";

const SIZE_LABEL: Record<WidgetSize, string> = { 1: "Small", 2: "Medium", 3: "Large" };
const MODE_LABEL: Record<WidgetMode, string> = { chart: "Graph", number: "Number" };

export default function SortableCard({
  id,
  title,
  headerExtra,
  icon: Icon,
  accentVar,
  size,
  onSizeChange,
  mode,
  onModeChange,
  onRemove,
  children,
}: {
  id: string;
  title: string;
  headerExtra?: ReactNode;
  icon: LucideIcon;
  accentVar: string;
  size: WidgetSize;
  onSizeChange: (size: WidgetSize) => void;
  mode?: WidgetMode;
  onModeChange?: (mode: WidgetMode) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={`card${isDragging ? " card--dragging" : ""} card--size-${size}`}>
      <div className="card__header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <span className="widget-icon" style={{ background: `var(${accentVar})` }}>
            <Icon size={13} />
          </span>
          <h2 className="card__title" style={{ margin: 0 }}>
            {title}
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", position: "relative" }}>
          {headerExtra}
          <button
            className="card__icon-button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label={`${title} widget settings`}
            aria-expanded={settingsOpen}
            type="button"
          >
            <Settings2 size={14} />
          </button>
          {settingsOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 39 }}
                onClick={() => setSettingsOpen(false)}
              />
              <div className="widget-settings-popover">
                <div className="widget-settings-popover__label">Size</div>
                <div className="widget-settings-popover__row">
                  {([1, 2, 3] as WidgetSize[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`widget-settings-popover__option${s === size ? " active" : ""}`}
                      onClick={() => onSizeChange(s)}
                    >
                      {SIZE_LABEL[s]}
                    </button>
                  ))}
                </div>
                {mode && onModeChange && (
                  <>
                    <div className="widget-settings-popover__label">Display</div>
                    <div className="widget-settings-popover__row">
                      {(["chart", "number"] as WidgetMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`widget-settings-popover__option${m === mode ? " active" : ""}`}
                          onClick={() => onModeChange(m)}
                        >
                          {MODE_LABEL[m]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  className="widget-settings-popover__remove"
                  onClick={() => {
                    setSettingsOpen(false);
                    onRemove();
                  }}
                >
                  <X size={13} />
                  Remove from dashboard
                </button>
              </div>
            </>
          )}
          <button
            className="card__drag-handle"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${title}`}
            type="button"
          >
            ⠿
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
