// Feature 7 (Session Save & Load): serialize/parse the .dsync project file.
// Kept as pure string-in/string-out functions so the actual file I/O
// (native.ts) stays a thin wrapper and this logic is unit-testable without
// mocking Tauri's IPC.
import type { Bookmark, ClipZoomState, PlaybackSnapshot, ProjectSession, VideoClip, ViewMode } from "../types/project";

export function serializeProjectSession(
  name: string,
  clips: VideoClip[],
  viewMode: ViewMode = "grid",
  focusedClipIds: string[] = [],
  bookmarks: Bookmark[] = [],
  playback?: PlaybackSnapshot,
): string {
  const session: ProjectSession = { version: 1, name, clips, viewMode, focusedClipIds, bookmarks, playback };
  return JSON.stringify(session, null, 2);
}

export function parseProjectSession(raw: string): ProjectSession | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return isProjectSession(data) ? data : null;
}

const VIEW_MODES: ViewMode[] = ["grid", "focus1", "focus2", "dynamic"];

function isProjectSession(data: unknown): data is ProjectSession {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || typeof d.name !== "string" || !Array.isArray(d.clips) || !d.clips.every(isVideoClip)) {
    return false;
  }
  // All optional (files saved before each feature existed won't have
  // them), but if present they must be well-formed.
  if (d.viewMode !== undefined && !VIEW_MODES.includes(d.viewMode as ViewMode)) return false;
  if (d.focusedClipIds !== undefined) {
    if (!Array.isArray(d.focusedClipIds) || !d.focusedClipIds.every((id) => typeof id === "string")) {
      return false;
    }
  }
  if (d.bookmarks !== undefined) {
    if (!Array.isArray(d.bookmarks) || !d.bookmarks.every(isBookmark)) return false;
  }
  if (d.playback !== undefined && !isPlaybackSnapshot(d.playback)) return false;
  return true;
}

function isBookmark(value: unknown): value is Bookmark {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return typeof b.id === "string" && typeof b.timeSeconds === "number" && typeof b.label === "string";
}

function isLoopRegion(value: unknown): value is { start: number; end: number } {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.start === "number" && typeof r.end === "number";
}

function isClipZoomState(value: unknown): value is ClipZoomState {
  if (typeof value !== "object" || value === null) return false;
  const z = value as Record<string, unknown>;
  if (typeof z.enabled !== "boolean" || typeof z.level !== "number") return false;
  if (typeof z.center !== "object" || z.center === null) return false;
  const c = z.center as Record<string, unknown>;
  return typeof c.x === "number" && typeof c.y === "number";
}

function isPlaybackSnapshot(value: unknown): value is PlaybackSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (typeof p.lastPositionSeconds !== "number") return false;
  if (p.playbackSpeed !== "crawl" && typeof p.playbackSpeed !== "number") return false;
  if (p.loopRegion !== null && !isLoopRegion(p.loopRegion)) return false;
  if (typeof p.loopEnabled !== "boolean") return false;
  if (typeof p.zoomByClip !== "object" || p.zoomByClip === null) return false;
  return Object.values(p.zoomByClip).every(isClipZoomState);
}

function isVideoClip(value: unknown): value is VideoClip {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.filePath === "string" &&
    typeof c.fileName === "string" &&
    // Optional: clips saved before descriptions existed won't have one.
    (typeof c.description === "string" || c.description === undefined) &&
    typeof c.startTimeOfDay === "string" &&
    (typeof c.durationSeconds === "number" || c.durationSeconds === null) &&
    (typeof c.frameRate === "number" || c.frameRate === null) &&
    (typeof c.metadataError === "string" || c.metadataError === null) &&
    typeof c.syncOffsetSeconds === "number" &&
    typeof c.manualOffsetSeconds === "number" &&
    typeof c.muted === "boolean" &&
    typeof c.volume === "number" &&
    typeof c.gridPosition === "number"
  );
}
