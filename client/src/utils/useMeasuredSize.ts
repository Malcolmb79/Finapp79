import { useEffect, useRef, useState } from "react";

/**
 * A container's actual rendered width and height.
 *
 * The width-only version covers layout that reflows horizontally. A chart also
 * has to fit the height it is given: a fixed one drawn inside a resizable card
 * runs off the bottom and takes its axis labels with it, which is worse than
 * being small.
 */
export function useMeasuredSize(fallbackWidth: number, fallbackHeight: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: fallbackWidth, height: fallbackHeight });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      // Zero happens while a card is still being laid out; keeping the last
      // good size avoids a frame of collapsed chart.
      setSize((current) => ({
        width: box.width || current.width,
        height: box.height || current.height,
      }));
    });

    observer.observe(element);
    if (element.clientWidth || element.clientHeight) {
      setSize({ width: element.clientWidth || fallbackWidth, height: element.clientHeight || fallbackHeight });
    }
    return () => observer.disconnect();
  }, [fallbackWidth, fallbackHeight]);

  return [ref, size] as const;
}
