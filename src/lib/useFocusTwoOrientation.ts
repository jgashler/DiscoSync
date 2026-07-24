import { useEffect, useRef, useState } from "react";
import { chooseFocusTwoOrientation } from "./focusOrientation";

/**
 * Measures a container element live and reports whether laying two 16:9
 * videos out side-by-side ("row") or stacked ("column") renders them
 * larger, given the space actually available right now. Shared by
 * focus-two mode and dynamic-grid's 2-clip case so both pick the same way.
 */
export function useFocusTwoOrientation<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [orientation, setOrientation] = useState<"row" | "column">("row");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setOrientation(chooseFocusTwoOrientation(width, height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, orientation };
}
