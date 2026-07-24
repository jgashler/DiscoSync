import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode, SyntheticEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { frameStepSeconds, NUDGE_STEPS } from "../lib/fineTune";
import { computeClipRangeStatus } from "../lib/clipRange";
import { formatSecondsShort } from "../lib/formatSeconds";
import { clampAxisOffset, getClipBounds } from "../lib/magnifyOffset";
import { computeContentRect, computeVideoTransform } from "../lib/digitalZoom";
import type { ZoomRegion } from "../lib/digitalZoom";
import { useElementAspect } from "../lib/useElementAspect";
import type { VideoClip } from "../types/project";

// After this much continuous hover, the tile scales up so small details
// (a timestamp overlay, a face, a plate) are easier to make out without
// switching view mode.
const MAGNIFY_DELAY_MS = 1500;
const MAGNIFY_SCALE = 1.7;
// Keep a small gap from the actual window edge rather than butting right up
// against it.
const MAGNIFY_EDGE_MARGIN_PX = 12;

interface VideoTileProps {
  clip: VideoClip;
  registerVideoRef: (id: string, el: HTMLVideoElement | null) => void;
  onToggleMute: (clipId: string) => void;
  onSetVolume: (clipId: string, volume: number) => void;
  onNudge: (clipId: string, deltaSeconds: number) => void;
  onSetManualOffset: (clipId: string, seconds: number) => void;
  /** Null when the clip has no valid rough-sync offset (bad/missing timestamp). */
  effectiveOffsetSeconds: number | null;
  globalTime: number;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onClick?: () => void;
  /** Hides the nudge/offset row — there's no room for it in a small thumbnail. */
  compact?: boolean;
  /** Off for the large focus-mode tiles, which are already prominent. */
  magnifiable?: boolean;
  /** Content-normalized crop region (digital zoom). Null/undefined = full frame. */
  zoomRegion?: ZoomRegion | null;
  /** Fires once the video's native resolution is known, for letterbox-aware zoom math. */
  onVideoNativeSize?: (clipId: string, size: { width: number; height: number }) => void;
  /** Extra content (e.g. the zoom minimap) rendered absolutely inside the tile. */
  overlay?: ReactNode;
  /**
   * Hides `overlay` until hovered, for toggleable per-tile zoom in grid
   * layouts — once you've set the region you want, the minimap just blocks
   * the view. Off for the single-panel/focus-one case, where zoom is
   * automatic rather than toggled and there's nothing else on screen for
   * the minimap to be "in the way" of.
   */
  overlayFadesOnLeave?: boolean;
  /** When provided, shows a per-tile zoom toggle button alongside mute/volume. */
  onToggleZoom?: () => void;
  zoomActive?: boolean;
  /** True while picking clips for audio sync and this one is eligible (synced) — shows a checkable highlight. */
  audioSyncSelectable?: boolean;
  audioSyncSelected?: boolean;
}

export function VideoTile({
  clip,
  registerVideoRef,
  onToggleMute,
  onSetVolume,
  onNudge,
  onSetManualOffset,
  effectiveOffsetSeconds,
  globalTime,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onClick,
  compact = false,
  magnifiable = true,
  zoomRegion = null,
  onVideoNativeSize,
  overlay,
  overlayFadesOnLeave = false,
  onToggleZoom,
  zoomActive = false,
  audioSyncSelectable = false,
  audioSyncSelected = false,
}: VideoTileProps) {
  const step = frameStepSeconds(clip.frameRate);
  const rangeStatus = computeClipRangeStatus(effectiveOffsetSeconds, clip.durationSeconds, globalTime);

  const tileRef = useRef<HTMLDivElement>(null);
  const tileAspect = useElementAspect(tileRef);
  // Whether the gesture that might become a drag started inside a
  // no-tile-drag region (the zoom minimap). Tracked from pointerdown, which
  // always fires on the actual element interacted with — unlike dragstart,
  // which fires on the draggable ancestor itself, so it can't reliably tell
  // where the gesture originated.
  const suppressDragRef = useRef(false);
  const [videoNativeSize, setVideoNativeSize] = useState<{ width: number; height: number } | null>(null);

  // Stable across re-renders (as long as the clip and callback identity
  // don't change) — an inline `ref={(el) => ...}` gets a *new* function every
  // render, and React treats that as "the ref changed," detaching and
  // reattaching on every single render. VideoTile re-renders every 100ms
  // during playback regardless of zoom, so an unstable ref here was always
  // wasteful; it becomes actively broken once the ref callback also updates
  // state (as the zoom hooks' registerVideoRef wrappers do) — each
  // detach/reattach flips that state, which triggers a re-render, which
  // creates a new unstable ref, forever.
  const videoRefCallback = useCallback(
    (el: HTMLVideoElement | null) => registerVideoRef(clip.id, el),
    [registerVideoRef, clip.id],
  );

  function handleLoadedMetadata(e: SyntheticEvent<HTMLVideoElement>) {
    const { videoWidth, videoHeight } = e.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) {
      setVideoNativeSize({ width: videoWidth, height: videoHeight });
      onVideoNativeSize?.(clip.id, { width: videoWidth, height: videoHeight });
    }
  }

  const videoZoomStyle =
    zoomRegion && tileAspect && videoNativeSize && tileAspect.height > 0 && videoNativeSize.height > 0
      ? (() => {
          const content = computeContentRect(
            tileAspect.width / tileAspect.height,
            videoNativeSize.width / videoNativeSize.height,
          );
          const t = computeVideoTransform(content, zoomRegion);
          return {
            transform: `translate(${t.translateXPercent}%, ${t.translateYPercent}%) scale(${t.scale})`,
            transformOrigin: "0 0",
          };
        })()
      : undefined;
  const [magnified, setMagnified] = useState(false);
  // Extra translate (in final screen pixels) layered on top of the scale so
  // a tile near an edge grows inward instead of pushing off the window.
  // Scaling is center-origin, so a tile flush against an edge would
  // otherwise have half its growth land off-screen.
  const [magnifyOffset, setMagnifyOffset] = useState({ x: 0, y: 0 });
  const magnifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleMouseEnter() {
    if (!magnifiable) return;
    magnifyTimerRef.current = setTimeout(() => {
      const rect = tileRef.current?.getBoundingClientRect();
      if (rect && tileRef.current) {
        const scaledWidth = rect.width * MAGNIFY_SCALE;
        const scaledHeight = rect.height * MAGNIFY_SCALE;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Bound against the nearest clipping ancestor (e.g. the scrollable
        // review pane, which stops above the fixed transport bar), not the
        // raw window — otherwise a bottom-row tile can magnify into that
        // reserved strip and get visually clipped, only visible by
        // scrolling.
        const bounds = getClipBounds(tileRef.current);
        const dx = clampAxisOffset(
          centerX,
          scaledWidth,
          bounds.left + MAGNIFY_EDGE_MARGIN_PX,
          bounds.right - MAGNIFY_EDGE_MARGIN_PX,
        );
        const dy = clampAxisOffset(
          centerY,
          scaledHeight,
          bounds.top + MAGNIFY_EDGE_MARGIN_PX,
          bounds.bottom - MAGNIFY_EDGE_MARGIN_PX,
        );

        setMagnifyOffset({ x: dx, y: dy });
      }
      setMagnified(true);
    }, MAGNIFY_DELAY_MS);
  }

  function handleMouseLeave() {
    if (magnifyTimerRef.current !== null) {
      clearTimeout(magnifyTimerRef.current);
      magnifyTimerRef.current = null;
    }
    setMagnified(false);
  }

  // handleMouseEnter only checks magnifiable at the moment the mouse enters
  // — turning zoom on mid-hover (the toggle button is right there on the
  // tile you're already hovering) wouldn't otherwise cancel a magnify timer
  // that started before the toggle, or un-magnify a tile that was already
  // mid-magnify.
  useEffect(() => {
    if (magnifiable) return;
    if (magnifyTimerRef.current !== null) {
      clearTimeout(magnifyTimerRef.current);
      magnifyTimerRef.current = null;
    }
    setMagnified(false);
  }, [magnifiable]);

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    if (suppressDragRef.current) {
      e.preventDefault();
      return;
    }
    // A scaled-up tile dragging around (and the browser's drag-ghost image
    // being captured mid-scale) looks broken — cancel the magnify the
    // instant a drag actually starts.
    if (magnifyTimerRef.current !== null) {
      clearTimeout(magnifyTimerRef.current);
      magnifyTimerRef.current = null;
    }
    setMagnified(false);
    setMagnifyOffset({ x: 0, y: 0 });
    onDragStart(e);
  }

  return (
    <div className="flex flex-col gap-1 min-h-0 h-full">
      <div
        ref={tileRef}
        draggable
        onPointerDownCapture={(e) => {
          suppressDragRef.current = e.target instanceof HTMLElement && e.target.closest("[data-no-tile-drag]") !== null;
        }}
        onDragStart={handleDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={
          magnified
            ? { transform: `translate(${magnifyOffset.x}px, ${magnifyOffset.y}px) scale(${MAGNIFY_SCALE})` }
            : undefined
        }
        className={`relative bg-black rounded-md overflow-hidden flex-1 min-h-0 group cursor-grab active:cursor-grabbing transition-[opacity,transform] duration-300 ${
          isDragging ? "opacity-40" : ""
        } ${isDragOver && !isDragging ? "ring-2 ring-blue-500" : ""} ${onClick ? "cursor-pointer" : ""} ${
          audioSyncSelected ? "ring-2 ring-blue-500" : ""
        } ${magnified ? "z-20 shadow-2xl shadow-black/80" : ""}`}
      >
        {audioSyncSelectable && (
          <div
            className={`absolute inset-0 z-10 flex items-start justify-end p-2 pointer-events-none transition-colors ${
              audioSyncSelected ? "bg-blue-500/10" : ""
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                audioSyncSelected ? "bg-blue-500 border-blue-500" : "border-white/70 bg-black/40"
              }`}
            >
              {audioSyncSelected && <Check size={13} className="text-white" />}
            </div>
          </div>
        )}
        <video
          ref={videoRefCallback}
          src={convertFileSrc(clip.filePath)}
          muted={clip.muted}
          onLoadedMetadata={handleLoadedMetadata}
          style={videoZoomStyle}
          className={`w-full h-full object-contain pointer-events-none transition-[filter,opacity] ${
            rangeStatus.status !== "in-range" ? "grayscale opacity-40" : ""
          }`}
          // Global playback control drives currentTime/play/pause directly
          // on the element — no native controls, no independent scrubbing.
          controls={false}
          preload="auto"
        />
        {rangeStatus.status !== "in-range" && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center pointer-events-none">
            <span className="text-xs text-neutral-200 bg-black/70 rounded px-2 py-1">
              {rangeStatus.status === "unsynced"
                ? "Not synced — add a start time on the import screen"
                : `Video out of current range ${
                    rangeStatus.status === "before"
                      ? `until ${formatSecondsShort(rangeStatus.secondsUntilStart)}`
                      : `for ${formatSecondsShort(rangeStatus.secondsSinceEnd)}`
                  }`}
            </span>
          </div>
        )}
        <div
          title={clip.description ? clip.fileName : undefined}
          className="absolute top-1 left-1 max-w-[70%] px-1.5 py-0.5 text-[10px] bg-black/70 rounded truncate opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {clip.description || clip.fileName}
        </div>
        {!compact && (
          <div
            data-no-tile-drag="true"
            className="absolute top-1 right-1 flex items-center gap-1.5 px-1.5 py-1 bg-black/60 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {onToggleZoom && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleZoom();
                }}
                title={zoomActive ? "Turn off zoom" : "Zoom into this video"}
                className={`w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 ${
                  zoomActive ? "text-blue-400" : ""
                }`}
              >
                {zoomActive ? <ZoomOut size={13} /> : <ZoomIn size={13} />}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute(clip.id);
              }}
              title={clip.muted ? "Unmute" : "Mute"}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10"
            >
              {clip.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={clip.volume}
              disabled={clip.muted}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onSetVolume(clip.id, Number(e.target.value))}
              className="w-16 accent-blue-500 disabled:opacity-40"
              title="Volume"
            />
          </div>
        )}
        {overlay && (
          <div
            className={`absolute top-1 left-1 z-10 transition-opacity ${
              overlayFadesOnLeave ? "opacity-0 group-hover:opacity-100" : ""
            }`}
          >
            {overlay}
          </div>
        )}
      </div>

      {/* Displayed frame at a fixed globalTime = globalTime - effectiveOffset
          (see ReviewScreen's expectedLocalTime), so a *larger* offset
          shows an *earlier* frame. "Forward" (show later footage) must
          therefore subtract from manualOffsetSeconds, and "back" adds. */}
      {!compact && (
        <div className="flex items-center justify-center flex-wrap gap-x-1 gap-y-0.5 shrink-0 text-[10px] text-neutral-500">
          {NUDGE_STEPS.map(({ label, seconds }) => (
            <button
              key={`back-${label}`}
              onClick={() => onNudge(clip.id, seconds)}
              title={`Nudge back ${label}`}
              className="px-1 h-4 flex items-center justify-center rounded hover:bg-neutral-800 hover:text-neutral-200 text-[9px] font-mono"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => onNudge(clip.id, step)}
            title="Nudge back one frame"
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-neutral-800 hover:text-neutral-200"
          >
            <ChevronLeft size={12} />
          </button>
          <input
            type="number"
            step={0.001}
            value={clip.manualOffsetSeconds}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) onSetManualOffset(clip.id, value);
            }}
            title="Manual offset (s)"
            className="w-11 bg-neutral-900 rounded text-center px-0.5 py-0 outline-none border border-neutral-800 focus:border-blue-500 [appearance:textfield]"
          />
          <button
            onClick={() => onNudge(clip.id, -step)}
            title="Nudge forward one frame"
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-neutral-800 hover:text-neutral-200"
          >
            <ChevronRight size={12} />
          </button>
          {[...NUDGE_STEPS].reverse().map(({ label, seconds }) => (
            <button
              key={`forward-${label}`}
              onClick={() => onNudge(clip.id, -seconds)}
              title={`Nudge forward ${label}`}
              className="px-1 h-4 flex items-center justify-center rounded hover:bg-neutral-800 hover:text-neutral-200 text-[9px] font-mono"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
