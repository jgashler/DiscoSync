import { useCallback, useState } from "react";
import { computeZoomRegion, MIN_ZOOM_LEVEL } from "./digitalZoom";
import type { ZoomCenter, ZoomRegion } from "./digitalZoom";
import type { ClipZoomState } from "../types/project";

export const DEFAULT_ZOOM_STATE: ClipZoomState = { enabled: false, center: { x: 0.5, y: 0.5 }, level: MIN_ZOOM_LEVEL };

export interface ClipZoomMinimapProps {
  videoEl: HTMLVideoElement | null;
  nativeAspect: number | null;
  center: ZoomCenter;
  level: number;
  onChange: (next: { center: ZoomCenter; level: number }) => void;
}

// Digital zoom, one state per clip, shared across whichever views render
// that clip — replaces the older useDigitalZoom/useTileZoom, which each
// owned their own local state, so zooming a clip in Grid and then switching
// to Dynamic grid lost it. `zoomByClip`/`onZoomChange` are lifted to
// ReviewScreen (its children just read/write through them), which is also
// what makes a zoom region something that can be captured into the saved
// project.
//
// `enabled` only matters to *toggle-based* views (Grid, Dynamic grid's
// multi-tile case) — pass `gateByEnabled: true` there so an un-toggled
// clip renders with no crop and no minimap. The single-panel/focus-one
// case has no toggle at all; it always applies the region regardless
// (`gateByEnabled: false`), which is a visual no-op at the default level 1.
export function useClipZoom(
  zoomByClip: Record<string, ClipZoomState>,
  onZoomChange: (clipId: string, next: ClipZoomState) => void,
  registerVideoRef: (id: string, el: HTMLVideoElement | null) => void,
) {
  const [nativeSizes, setNativeSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [videoEls, setVideoEls] = useState<Record<string, HTMLVideoElement | null>>({});

  const registerZoomVideoRef = useCallback(
    (id: string, el: HTMLVideoElement | null) => {
      registerVideoRef(id, el);
      setVideoEls((prev) => (prev[id] === el ? prev : { ...prev, [id]: el }));
    },
    [registerVideoRef],
  );

  function stateFor(clipId: string): ClipZoomState {
    return zoomByClip[clipId] ?? DEFAULT_ZOOM_STATE;
  }

  function isEnabled(clipId: string): boolean {
    return stateFor(clipId).enabled;
  }

  function toggle(clipId: string) {
    const current = stateFor(clipId);
    onZoomChange(clipId, { ...current, enabled: !current.enabled });
  }

  function zoomRegionFor(clipId: string, gateByEnabled: boolean): ZoomRegion | null {
    const state = stateFor(clipId);
    if (gateByEnabled && !state.enabled) return null;
    return computeZoomRegion(state.center, state.level);
  }

  function handleVideoNativeSize(id: string, size: { width: number; height: number }) {
    setNativeSizes((prev) => ({ ...prev, [id]: size }));
  }

  function minimapPropsFor(clipId: string): ClipZoomMinimapProps {
    const state = stateFor(clipId);
    const nativeSize = nativeSizes[clipId];
    return {
      videoEl: videoEls[clipId] ?? null,
      nativeAspect: nativeSize ? nativeSize.width / nativeSize.height : null,
      center: state.center,
      level: state.level,
      // Adjusting the minimap (drag/scroll) is itself a clear signal the
      // zoom is in use, so it marks the clip enabled even in toggle-based
      // views where the minimap is only shown once already enabled anyway.
      onChange: (next) => onZoomChange(clipId, { ...state, ...next, enabled: true }),
    };
  }

  return { isEnabled, toggle, zoomRegionFor, registerZoomVideoRef, handleVideoNativeSize, minimapPropsFor };
}
