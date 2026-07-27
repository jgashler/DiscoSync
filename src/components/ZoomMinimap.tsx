import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  clampZoomCenter,
  clampZoomLevel,
  computeZoomRegion,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
} from "../lib/digitalZoom";
import type { ZoomCenter } from "../lib/digitalZoom";

const MINIMAP_WIDTH_PX = 280;
const ZOOM_STEP = 1.25;
const FALLBACK_ASPECT = 16 / 9;

interface ZoomMinimapProps {
  videoEl: HTMLVideoElement | null;
  nativeAspect: number | null;
  center: ZoomCenter;
  level: number;
  onChange: (next: { center: ZoomCenter; level: number }) => void;
}

// A little draggable "navigator" for the digital zoom: a periodically
// redrawn snapshot of the focused clip (via canvas, not a second decoded
// <video> — cheap, and "live-ish" is plenty for picking a region) with a
// rectangle tracing the current zoom region. Drag/click to pan, scroll or
// the +/- buttons to zoom in/out.
export function ZoomMinimap({ videoEl, nativeAspect, center, level, onChange }: ZoomMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const aspect = nativeAspect && nativeAspect > 0 ? nativeAspect : FALLBACK_ASPECT;
  const height = Math.round(MINIMAP_WIDTH_PX / aspect);

  useEffect(() => {
    if (!videoEl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function draw() {
      if (!videoEl || videoEl.readyState < 2) return;
      ctx!.drawImage(videoEl, 0, 0, canvas!.width, canvas!.height);
    }

    draw();
    videoEl.addEventListener("timeupdate", draw);
    videoEl.addEventListener("seeked", draw);
    videoEl.addEventListener("loadeddata", draw);
    return () => {
      videoEl.removeEventListener("timeupdate", draw);
      videoEl.removeEventListener("seeked", draw);
      videoEl.removeEventListener("loadeddata", draw);
    };
  }, [videoEl]);

  function centerFromPointer(e: { clientX: number; clientY: number }): ZoomCenter {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    onChange({ center: clampZoomCenter(centerFromPointer(e), level), level });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    onChange({ center: clampZoomCenter(centerFromPointer(e), level), level });
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function setLevel(nextLevel: number) {
    const clampedLevel = clampZoomLevel(nextLevel);
    onChange({ center: clampZoomCenter(center, clampedLevel), level: clampedLevel });
  }

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setLevel(e.deltaY < 0 ? level * ZOOM_STEP : level / ZOOM_STEP);
  }

  const region = computeZoomRegion(center, level);

  return (
    <div
      className="flex flex-col gap-1 items-start pointer-events-auto [-webkit-user-drag:none]"
      // The tile this sits on top of is itself draggable (for reordering
      // clips). A native dragstart fires *on the draggable ancestor*, not
      // here, so it can't be intercepted from this element — VideoTile's
      // handleDragStart checks for this marker on the event target instead
      // and cancels the drag before it starts. That check is a race against
      // the browser's own drag-gesture recognition (pointerdown must fire,
      // and be handled, before dragstart commits) — WebKit (macOS's
      // WKWebView) has been observed losing that race occasionally, where
      // Chromium (Windows) doesn't. -webkit-user-drag (above) is a second,
      // independent line of defense WebKit specifically honors — a no-op
      // everywhere else — so a native drag never starts here in the first
      // place rather than relying solely on the timing race to cancel it.
      data-no-tile-drag="true"
    >
      <div className="flex items-center gap-1 bg-black/70 rounded px-1 py-0.5">
        <button
          onClick={() => setLevel(level / ZOOM_STEP)}
          disabled={level <= MIN_ZOOM_LEVEL}
          title="Zoom out"
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Minus size={12} />
        </button>
        <span className="text-[10px] text-neutral-300 tabular-nums w-9 text-center">{level.toFixed(1)}x</span>
        <button
          onClick={() => setLevel(level * ZOOM_STEP)}
          disabled={level >= MAX_ZOOM_LEVEL}
          title="Zoom in"
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={() => onChange({ center: { x: 0.5, y: 0.5 }, level: MIN_ZOOM_LEVEL })}
          disabled={level <= MIN_ZOOM_LEVEL}
          title="Reset zoom"
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <RotateCcw size={11} />
        </button>
      </div>
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        title="Drag to pan, scroll to zoom"
        className="relative rounded border border-neutral-700 bg-black overflow-hidden cursor-crosshair touch-none"
        style={{ width: MINIMAP_WIDTH_PX, height }}
      >
        <canvas ref={canvasRef} width={MINIMAP_WIDTH_PX} height={height} className="w-full h-full block" />
        <div
          className="absolute border-2 border-blue-400 shadow-[0_0_0_1px_rgba(0,0,0,0.6)] pointer-events-none"
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.width * 100}%`,
            height: `${region.height * 100}%`,
          }}
        />
      </div>
    </div>
  );
}
