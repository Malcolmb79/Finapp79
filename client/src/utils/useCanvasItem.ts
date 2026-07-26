import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseCanvasItemArgs {
  initial: CanvasRect;
  minWidth: number;
  minHeight: number;
  gridSize: number;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
}

function snap(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

// Shared window-level pointer tracking plus a body scroll lock for the
// duration of the drag. Window listeners (rather than relying solely on the
// handle's own onPointerMove/onPointerUp + pointer capture) plus the lock
// keep iOS Safari from reinterpreting a drag as a page-scroll gesture
// partway through, even when it starts on a small handle.
function trackPointer(
  startEvent: ReactPointerEvent,
  onStep: (dx: number, dy: number) => void,
  onFinish: () => void,
  onDraggingChange?: (dragging: boolean) => void,
) {
  startEvent.stopPropagation();
  startEvent.preventDefault();

  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  onDraggingChange?.(true);

  const previousBodyOverflow = document.body.style.overflow;
  const previousBodyTouchAction = document.body.style.touchAction;
  document.body.style.overflow = "hidden";
  document.body.style.touchAction = "none";

  const handleMove = (moveEvent: PointerEvent) => {
    moveEvent.preventDefault();
    onStep(moveEvent.clientX - startX, moveEvent.clientY - startY);
  };

  const finish = () => {
    onDraggingChange?.(false);
    document.body.style.overflow = previousBodyOverflow;
    document.body.style.touchAction = previousBodyTouchAction;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    onFinish();
  };

  window.addEventListener("pointermove", handleMove, { passive: false });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}

// Drives a freely-positioned, freely-sized canvas item: a drag handle moves
// it (x/y, clamped to stay on-canvas), a corner handle resizes it (width/
// height, floored at the given minimums). Both snap to the same grid and
// report back to the caller only once the gesture ends - the rect returned
// here is the live, in-drag value for rendering.
export function useCanvasItem({
  initial,
  minWidth,
  minHeight,
  gridSize,
  onMove,
  onResize,
  onDraggingChange,
}: UseCanvasItemArgs) {
  const [rect, setRect] = useState<CanvasRect>(initial);
  const liveRect = useRef(rect);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const resizeStart = useRef<{ width: number; height: number } | null>(null);

  const handleDragPointerDown = (e: ReactPointerEvent) => {
    dragStart.current = { x: rect.x, y: rect.y };
    trackPointer(
      e,
      (dx, dy) => {
        if (!dragStart.current) return;
        const next = {
          ...liveRect.current,
          x: Math.max(0, snap(dragStart.current.x + dx, gridSize)),
          y: Math.max(0, snap(dragStart.current.y + dy, gridSize)),
        };
        liveRect.current = next;
        setRect(next);
      },
      () => {
        dragStart.current = null;
        onMove(Math.round(liveRect.current.x), Math.round(liveRect.current.y));
      },
      onDraggingChange,
    );
  };

  const handleResizePointerDown = (e: ReactPointerEvent) => {
    resizeStart.current = { width: rect.width, height: rect.height };
    trackPointer(
      e,
      (dx, dy) => {
        if (!resizeStart.current) return;
        const next = {
          ...liveRect.current,
          width: Math.max(minWidth, snap(resizeStart.current.width + dx, gridSize)),
          height: Math.max(minHeight, snap(resizeStart.current.height + dy, gridSize)),
        };
        liveRect.current = next;
        setRect(next);
      },
      () => {
        resizeStart.current = null;
        onResize(Math.round(liveRect.current.width), Math.round(liveRect.current.height));
      },
      onDraggingChange,
    );
  };

  return { rect, handleDragPointerDown, handleResizePointerDown };
}

// Container height needs to be set explicitly since absolutely-positioned
// children don't contribute to their parent's natural size - this computes
// how tall the canvas needs to be to fit every item plus some breathing room.
export function computeCanvasHeight(rects: { y: number; height: number }[], minHeight = 400, padding = 40): number {
  const tallest = rects.reduce((max, r) => Math.max(max, r.y + r.height), 0);
  return Math.max(minHeight, tallest + padding);
}
