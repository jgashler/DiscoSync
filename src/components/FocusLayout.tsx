import { useState } from "react";
import type { DragEvent } from "react";
import { VideoTile } from "./VideoTile";
import { ZoomMinimap } from "./ZoomMinimap";
import { useFocusTwoOrientation } from "../lib/useFocusTwoOrientation";
import { useClipZoom } from "../lib/useClipZoom";
import type { VideoClip, ClipZoomState } from "../types/project";

interface FocusLayoutProps {
  clips: VideoClip[];
  focusedClipIds: string[];
  registerVideoRef: (id: string, el: HTMLVideoElement | null) => void;
  onToggleMute: (clipId: string) => void;
  onSetVolume: (clipId: string, volume: number) => void;
  onNudge: (clipId: string, deltaSeconds: number) => void;
  onSetManualOffset: (clipId: string, seconds: number) => void;
  effectiveOffsets: Record<string, number>;
  globalTime: number;
  /**
   * Handles a drop wherever it lands — reordering two thumbnails or
   * swapping a thumbnail into/out of a main focus slot. The caller decides
   * which, since that depends on focusedClipIds, not on anything this
   * component tracks.
   */
  onDropClip: (draggedId: string, targetId: string) => void;
  /** Per-clip digital zoom, shared with the other view components and lifted to ReviewScreen for saving. */
  zoomByClip: Record<string, ClipZoomState>;
  onZoomChange: (clipId: string, next: ClipZoomState) => void;
  /** True while the user is clicking tiles to pick clips for audio sync (see ReviewScreen). */
  audioSyncSelecting?: boolean;
  audioSyncSelectedIds?: string[];
  onToggleAudioSyncSelected?: (clipId: string) => void;
  onDuplicate?: (clipId: string) => void;
}

const DRAG_MIME_TYPE = "application/x-discosync-clip-id";

export function FocusLayout({
  clips,
  focusedClipIds,
  registerVideoRef,
  onToggleMute,
  onSetVolume,
  onNudge,
  onSetManualOffset,
  effectiveOffsets,
  globalTime,
  onDropClip,
  zoomByClip,
  onZoomChange,
  audioSyncSelecting = false,
  audioSyncSelectedIds = [],
  onToggleAudioSyncSelected,
  onDuplicate,
}: FocusLayoutProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // For two main videos, pick whichever arrangement (side by side vs
  // stacked) actually renders them larger given the space available right
  // now — that flips as the window is resized, so it's measured live
  // rather than assumed from a fixed breakpoint.
  const { ref: mainAreaRef, orientation } = useFocusTwoOrientation<HTMLDivElement>();

  const mainClips = focusedClipIds
    .map((id) => clips.find((c) => c.id === id))
    .filter((c): c is VideoClip => c !== undefined);
  const thumbnailClips = [...clips]
    .filter((c) => !focusedClipIds.includes(c.id))
    .sort((a, b) => a.gridPosition - b.gridPosition);

  // Digital zoom is available on every main pane, 1 through n. A single
  // main clip (focus-one) shows it automatically (gateByEnabled: false) —
  // there's no toggle needed and nothing else on screen for the minimap to
  // be "in the way" of. With two or more (focus-two), each pane gets its
  // own toggle instead, same as Grid/Dynamic grid's multi-tile case.
  const zoomClipId = mainClips.length === 1 ? mainClips[0].id : null;
  const isMultiMain = mainClips.length >= 2;
  const zoom = useClipZoom(zoomByClip, onZoomChange, registerVideoRef);

  function handleDragStart(e: DragEvent<HTMLDivElement>, clipId: string) {
    e.dataTransfer.setData(DRAG_MIME_TYPE, clipId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(clipId);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, clipId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== clipId) setDragOverId(clipId);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, targetId: string) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DRAG_MIME_TYPE);
    setDraggingId(null);
    setDragOverId(null);
    if (draggedId) onDropClip(draggedId, targetId);
  }

  function clearDragState() {
    setDraggingId(null);
    setDragOverId(null);
  }

  function renderTile(
    clip: VideoClip,
    options: {
      compact: boolean;
      magnifiable: boolean;
      onClick?: () => void;
      zoomTarget?: boolean;
      tileZoomable?: boolean;
    },
  ) {
    const isZoomTarget = options.zoomTarget ?? false;
    const isTileZoomable = options.tileZoomable ?? false;
    const tileZoomed = isTileZoomable && zoom.isEnabled(clip.id);
    const isZoomable = isZoomTarget || isTileZoomable;
    // While picking clips for audio sync, every tile's click is repurposed
    // to toggle selection instead of its normal behavior (swap into focus,
    // etc.) — restored automatically once selection mode ends, since this
    // is computed fresh each render rather than being separate state.
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
        onDragOver={(e) => handleDragOver(e, clip.id)}
        onDragLeave={() => setDragOverId((current) => (current === clip.id ? null : current))}
        onDrop={(e) => handleDrop(e, clip.id)}
        onDragEnd={clearDragState}
        compact={options.compact}
        magnifiable={audioSyncSelecting ? false : options.magnifiable}
        onClick={
          audioSyncSelecting
            ? selectableNow
              ? () => onToggleAudioSyncSelected?.(clip.id)
              : undefined
            : options.onClick
        }
        audioSyncSelectable={selectableNow}
        audioSyncSelected={audioSyncSelectedIds.includes(clip.id)}
        onDuplicate={onDuplicate}
        onToggleZoom={isTileZoomable ? () => zoom.toggle(clip.id) : undefined}
        zoomActive={tileZoomed}
        overlayFadesOnLeave={tileZoomed}
        zoomRegion={isZoomable ? zoom.zoomRegionFor(clip.id, isTileZoomable) : null}
        onVideoNativeSize={isZoomable ? zoom.handleVideoNativeSize : undefined}
        overlay={isZoomTarget || tileZoomed ? <ZoomMinimap {...zoom.minimapPropsFor(clip.id)} /> : undefined}
      />
    );
  }

  return (
    <div className="flex gap-3 flex-1 min-h-0">
      <div
        ref={mainAreaRef}
        className={`flex-1 min-h-0 flex gap-2 ${
          mainClips.length === 2 && orientation === "column" ? "flex-col" : "flex-row"
        }`}
      >
        {mainClips.map((clip) => (
          <div key={clip.id} className="flex-1 min-h-0 min-w-0">
            {renderTile(clip, {
              compact: false,
              magnifiable: false,
              zoomTarget: clip.id === zoomClipId,
              tileZoomable: isMultiMain,
            })}
          </div>
        ))}
      </div>

      {thumbnailClips.length > 0 && (
        <div className="w-40 shrink-0 flex flex-col gap-2 overflow-y-auto">
          {thumbnailClips.map((clip) => (
            <div
              key={clip.id}
              className="w-full aspect-video shrink-0"
              title="Drag onto the main video to swap it in, or click to focus it"
            >
              {renderTile(clip, {
                compact: true,
                magnifiable: true,
                onClick: () => onDropClip(clip.id, focusedClipIds[0]),
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
