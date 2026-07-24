import { useState } from "react";
import type { DragEvent } from "react";
import { computeGridColumns } from "../lib/gridLayout";
import { useClipZoom } from "../lib/useClipZoom";
import { VideoTile } from "./VideoTile";
import { ZoomMinimap } from "./ZoomMinimap";
import type { VideoClip, ClipZoomState } from "../types/project";

interface VideoGridProps {
  clips: VideoClip[];
  registerVideoRef: (id: string, el: HTMLVideoElement | null) => void;
  onToggleMute: (clipId: string) => void;
  onSetVolume: (clipId: string, volume: number) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onNudge: (clipId: string, deltaSeconds: number) => void;
  onSetManualOffset: (clipId: string, seconds: number) => void;
  effectiveOffsets: Record<string, number>;
  globalTime: number;
  /** Per-clip digital zoom, shared with the other view components and lifted to ReviewScreen for saving. */
  zoomByClip: Record<string, ClipZoomState>;
  onZoomChange: (clipId: string, next: ClipZoomState) => void;
}

const DRAG_MIME_TYPE = "application/x-discosync-clip-id";

export function VideoGrid({
  clips,
  registerVideoRef,
  onToggleMute,
  onSetVolume,
  onReorder,
  onNudge,
  onSetManualOffset,
  effectiveOffsets,
  globalTime,
  zoomByClip,
  onZoomChange,
}: VideoGridProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const zoom = useClipZoom(zoomByClip, onZoomChange, registerVideoRef);

  const ordered = [...clips].sort((a, b) => a.gridPosition - b.gridPosition);
  const columns = computeGridColumns(ordered.length);

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
    if (draggedId) onReorder(draggedId, targetId);
  }

  return (
    <div
      className="grid gap-2 flex-1 min-h-0"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {ordered.map((clip) => {
        const zoomed = zoom.isEnabled(clip.id);
        return (
          <VideoTile
            key={clip.id}
            clip={clip}
            registerVideoRef={zoom.registerZoomVideoRef}
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
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverId(null);
            }}
            // With only 1-2 tiles, each one is already large enough that
            // magnify-on-hover doesn't add anything — it only earns its
            // keep once the grid is dense enough to make a tile small.
            magnifiable={!zoomed && ordered.length >= 3}
            onToggleZoom={() => zoom.toggle(clip.id)}
            zoomActive={zoomed}
            zoomRegion={zoom.zoomRegionFor(clip.id, true)}
            onVideoNativeSize={zoom.handleVideoNativeSize}
            overlay={zoomed ? <ZoomMinimap {...zoom.minimapPropsFor(clip.id)} /> : undefined}
            overlayFadesOnLeave
          />
        );
      })}
    </div>
  );
}
