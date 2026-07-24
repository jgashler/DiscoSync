import { useState } from "react";
import type { DragEvent } from "react";
import { computeGridColumns } from "../lib/gridLayout";
import { useFocusTwoOrientation } from "../lib/useFocusTwoOrientation";
import { useClipZoom } from "../lib/useClipZoom";
import { VideoTile } from "./VideoTile";
import { ZoomMinimap } from "./ZoomMinimap";
import type { VideoClip, ClipZoomState } from "../types/project";

interface DynamicGridLayoutProps {
  clips: VideoClip[];
  /** Ids currently in the main grid — any count, user-controlled. */
  focusedClipIds: string[];
  onFocusedClipIdsChange: (ids: string[]) => void;
  registerVideoRef: (id: string, el: HTMLVideoElement | null) => void;
  onToggleMute: (clipId: string) => void;
  onSetVolume: (clipId: string, volume: number) => void;
  onNudge: (clipId: string, deltaSeconds: number) => void;
  onSetManualOffset: (clipId: string, seconds: number) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  effectiveOffsets: Record<string, number>;
  globalTime: number;
  /** Per-clip digital zoom, shared with the other view components and lifted to ReviewScreen for saving. */
  zoomByClip: Record<string, ClipZoomState>;
  onZoomChange: (clipId: string, next: ClipZoomState) => void;
  /** True while the user is clicking tiles to pick clips for audio sync (see ReviewScreen). */
  audioSyncSelecting?: boolean;
  audioSyncSelectedIds?: string[];
  onToggleAudioSyncSelected?: (clipId: string) => void;
}

const DRAG_MIME_TYPE = "application/x-discosync-clip-id";

type Zone = "main" | "thumbnail";

export function DynamicGridLayout({
  clips,
  focusedClipIds,
  onFocusedClipIdsChange,
  registerVideoRef,
  onToggleMute,
  onSetVolume,
  onNudge,
  onSetManualOffset,
  onReorder,
  effectiveOffsets,
  globalTime,
  zoomByClip,
  onZoomChange,
  audioSyncSelecting = false,
  audioSyncSelectedIds = [],
  onToggleAudioSyncSelected,
}: DynamicGridLayoutProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<Zone | null>(null);

  // Two clips is a special case: rather than the generic sqrt-based grid
  // columns (always a 1x2 side-by-side split), use the same measured,
  // space-efficient row/column choice as focus-two mode.
  const { ref: mainAreaRef, orientation } = useFocusTwoOrientation<HTMLDivElement>();

  const mainClips = [...clips]
    .filter((c) => focusedClipIds.includes(c.id))
    .sort((a, b) => a.gridPosition - b.gridPosition);
  const thumbnailClips = [...clips]
    .filter((c) => !focusedClipIds.includes(c.id))
    .sort((a, b) => a.gridPosition - b.gridPosition);
  const columns = computeGridColumns(mainClips.length);
  const isPairLayout = mainClips.length === 2;
  const isSinglePanel = mainClips.length === 1;

  // A single video filling the whole grid is the dynamic-grid equivalent
  // of focus-one — hover-magnify doesn't add anything (it's already the
  // only, largest thing on screen), and a digital zoom control makes sense
  // in its place, shown automatically since there's nothing else on screen
  // to declutter against. With multiple main tiles there's real clutter
  // risk, so each tile gets its own toggle instead of showing every
  // minimap at once — same underlying per-clip state either way (so a
  // clip's zoom survives switching between single- and multi-tile), just
  // gated differently.
  const zoomClipId = isSinglePanel ? mainClips[0].id : null;
  const zoom = useClipZoom(zoomByClip, onZoomChange, registerVideoRef);

  function clearDragState() {
    setDraggingId(null);
    setDragOverId(null);
    setDragOverZone(null);
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, clipId: string) {
    e.dataTransfer.setData(DRAG_MIME_TYPE, clipId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(clipId);
  }

  function handleTileDragOver(e: DragEvent<HTMLDivElement>, clipId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== clipId) setDragOverId(clipId);
  }

  // Dropped directly on another tile: reorder within a zone, or move
  // between zones if they're not in the same one.
  function handleTileDrop(e: DragEvent<HTMLDivElement>, targetId: string, targetZone: Zone) {
    e.preventDefault();
    e.stopPropagation(); // don't also trigger the container's background drop
    const draggedId = e.dataTransfer.getData(DRAG_MIME_TYPE);
    clearDragState();
    if (!draggedId || draggedId === targetId) return;

    const draggedInGrid = focusedClipIds.includes(draggedId);
    if (targetZone === "main") {
      if (draggedInGrid) onReorder(draggedId, targetId);
      else onFocusedClipIdsChange([...focusedClipIds, draggedId]);
    } else {
      if (draggedInGrid) onFocusedClipIdsChange(focusedClipIds.filter((id) => id !== draggedId));
      else onReorder(draggedId, targetId);
    }
  }

  // Dropped on empty space in a zone (not on a specific tile): still add/
  // remove, just with nothing to reorder against.
  function handleZoneDragOver(e: DragEvent<HTMLDivElement>, zone: Zone) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggingId !== null) setDragOverZone(zone);
  }

  function handleZoneDrop(e: DragEvent<HTMLDivElement>, zone: Zone) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DRAG_MIME_TYPE);
    clearDragState();
    if (!draggedId) return;

    const draggedInGrid = focusedClipIds.includes(draggedId);
    if (zone === "main" && !draggedInGrid) {
      onFocusedClipIdsChange([...focusedClipIds, draggedId]);
    } else if (zone === "thumbnail" && draggedInGrid) {
      onFocusedClipIdsChange(focusedClipIds.filter((id) => id !== draggedId));
    }
  }

  function renderTile(clip: VideoClip, zone: Zone, compact: boolean) {
    const isMain = zone === "main";
    const isSingleZoomTarget = isMain && clip.id === zoomClipId;
    // Multi-tile main clips get an individually toggleable zoom; the
    // single-panel case keeps its existing always-shown zoom. Thumbnails
    // get neither — too small for a minimap to be useful.
    const isTileZoomable = isMain && !isSinglePanel;
    const tileZoomed = isTileZoomable && zoom.isEnabled(clip.id);
    const isZoomable = isSingleZoomTarget || isTileZoomable;
    // While picking clips for audio sync, every tile's click is repurposed
    // to toggle selection instead of its normal behavior (add to main
    // grid, etc.) — restored automatically once selection mode ends, since
    // this is computed fresh each render rather than being separate state.
    const clipSynced = effectiveOffsets[clip.id] !== undefined;
    const selectableNow = audioSyncSelecting && clipSynced;

    return (
      <VideoTile
        key={clip.id}
        clip={clip}
        registerVideoRef={isZoomable ? zoom.registerZoomVideoRef : registerVideoRef}
        onToggleMute={onToggleMute}
        onSetVolume={onSetVolume}
        onNudge={onNudge}
        onSetManualOffset={onSetManualOffset}
        effectiveOffsetSeconds={effectiveOffsets[clip.id] ?? null}
        globalTime={globalTime}
        isDragging={draggingId === clip.id}
        isDragOver={dragOverId === clip.id}
        onDragStart={(e) => handleDragStart(e, clip.id)}
        onDragOver={(e) => handleTileDragOver(e, clip.id)}
        onDragLeave={() => setDragOverId((current) => (current === clip.id ? null : current))}
        onDrop={(e) => handleTileDrop(e, clip.id, zone)}
        onDragEnd={clearDragState}
        compact={compact}
        // Same "not worth it below 3 tiles" rule as the plain grid, but
        // only for the main area — sidebar thumbnails already stay small
        // regardless of how many main tiles there are, so their magnify
        // isn't gated by this count.
        magnifiable={audioSyncSelecting ? false : !isSingleZoomTarget && !tileZoomed && (!isMain || mainClips.length >= 3)}
        onClick={
          audioSyncSelecting
            ? selectableNow
              ? () => onToggleAudioSyncSelected?.(clip.id)
              : undefined
            : zone === "thumbnail"
              ? () => onFocusedClipIdsChange([...focusedClipIds, clip.id])
              : undefined
        }
        audioSyncSelectable={selectableNow}
        audioSyncSelected={audioSyncSelectedIds.includes(clip.id)}
        onToggleZoom={isTileZoomable ? () => zoom.toggle(clip.id) : undefined}
        zoomActive={tileZoomed}
        overlayFadesOnLeave={tileZoomed}
        zoomRegion={isZoomable ? zoom.zoomRegionFor(clip.id, isTileZoomable) : null}
        onVideoNativeSize={isZoomable ? zoom.handleVideoNativeSize : undefined}
        overlay={
          isSingleZoomTarget || tileZoomed ? <ZoomMinimap {...zoom.minimapPropsFor(clip.id)} /> : undefined
        }
      />
    );
  }

  return (
    <div className="flex gap-3 flex-1 min-h-0">
      <div
        ref={mainAreaRef}
        onDragOver={(e) => handleZoneDragOver(e, "main")}
        onDragLeave={() => setDragOverZone((current) => (current === "main" ? null : current))}
        onDrop={(e) => handleZoneDrop(e, "main")}
        className={`flex-1 min-h-0 content-start rounded-md transition-shadow gap-2 ${
          dragOverZone === "main" ? "ring-2 ring-blue-500" : ""
        } ${isPairLayout ? `flex ${orientation === "column" ? "flex-col" : "flex-row"}` : "grid"}`}
        style={isPairLayout ? undefined : { gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))` }}
      >
        {mainClips.length === 0 && (
          <div className="col-span-full flex items-center justify-center h-full text-sm text-neutral-600 border border-dashed border-neutral-800 rounded-md min-h-32">
            Drag videos here from the sidebar
          </div>
        )}
        {mainClips.map((clip) =>
          isPairLayout ? (
            <div key={clip.id} className="flex-1 min-h-0 min-w-0">
              {renderTile(clip, "main", false)}
            </div>
          ) : (
            renderTile(clip, "main", false)
          ),
        )}
      </div>

      {(thumbnailClips.length > 0 || draggingId !== null) && (
        <div
          onDragOver={(e) => handleZoneDragOver(e, "thumbnail")}
          onDragLeave={() => setDragOverZone((current) => (current === "thumbnail" ? null : current))}
          onDrop={(e) => handleZoneDrop(e, "thumbnail")}
          className={`w-40 shrink-0 flex flex-col gap-2 overflow-y-auto rounded-md transition-shadow ${
            dragOverZone === "thumbnail" ? "ring-2 ring-blue-500" : ""
          }`}
        >
          {thumbnailClips.map((clip) => (
            <div
              key={clip.id}
              className="w-full aspect-video shrink-0"
              title="Drag into the grid to add it, or click to add it"
            >
              {renderTile(clip, "thumbnail", true)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
