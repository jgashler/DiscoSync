import { useEffect, useState } from "react";
import type { RefObject } from "react";

// Live width/height of an element via ResizeObserver, for aspect-ratio math
// (e.g. letterbox correction) that needs to react to the window/layout
// resizing rather than a one-off measurement at mount.
export function useElementAspect(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
