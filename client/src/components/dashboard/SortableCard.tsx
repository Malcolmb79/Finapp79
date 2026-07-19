import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

export default function SortableCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={`card${isDragging ? " card--dragging" : ""}`}>
      <div className="card__header">
        <h2 className="card__title">{title}</h2>
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
      {children}
    </div>
  );
}
