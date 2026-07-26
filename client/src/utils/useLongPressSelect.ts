import { useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 600;

// Widget edit chrome (drag handle, resize handle, remove/mode controls) stays
// hidden until a widget is held down, so scrolling past or glancing at the
// dashboard never pops up editing controls. A quick tap or click doesn't
// select; releasing early cancels the hold. Tapping outside deselects.
export function useLongPressSelect<T extends HTMLElement>() {
  const [selected, setSelected] = useState(false);
  const ref = useRef<T>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePointerDown = () => {
    clearTimer();
    timerRef.current = setTimeout(() => setSelected(true), LONG_PRESS_MS);
  };

  const cancelPress = () => clearTimer();

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!selected) return;
    const handleOutside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setSelected(false);
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [selected]);

  return {
    ref,
    selected,
    setSelected,
    pressHandlers: {
      onPointerDown: handlePointerDown,
      onPointerUp: cancelPress,
      onPointerLeave: cancelPress,
      onPointerCancel: cancelPress,
    },
  };
}
