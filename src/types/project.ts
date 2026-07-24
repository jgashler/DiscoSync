import type { LoopRegion } from "../lib/loopRange";

// A single loaded video angle.
export interface VideoClip {
  id: string;
  /** Absolute path on disk. Never copied — always read from here. */
  filePath: string;
  fileName: string;
  /** User-entered label (e.g. "Front door camera"), shown in place of the raw filename where there's room. */
  description: string;
  /** User-entered time-of-day the clip starts at, e.g. "14:32:05". */
  startTimeOfDay: string;
  /** Duration in seconds, read from file metadata. */
  durationSeconds: number | null;
  /** Detected frame rate, for frame-accurate nudging. */
  frameRate: number | null;
  /**
   * Set when metadata probing failed (e.g. unsupported/exotic codec).
   * The clip stays in the list rather than being silently dropped — the UI
   * should flag it clearly instead of guessing at duration/frame rate.
   */
  metadataError: string | null;
  /** Computed rough-sync offset in seconds, relative to the earliest clip. */
  syncOffsetSeconds: number;
  /** Manual fine-tune adjustment in seconds, added on top of syncOffsetSeconds. */
  manualOffsetSeconds: number;
  muted: boolean;
  volume: number; // 0-1
  gridPosition: number;
}

// Review-screen layout: the plain grid, one/two clips brought into focus
// with the rest as sidebar thumbnails, or a variable-size "dynamic" grid
// where any number of clips can be dragged between the grid and sidebar.
export type ViewMode = "grid" | "focus1" | "focus2" | "dynamic";

// A user-marked moment of interest on the shared review timeline (e.g.
// "incident starts here"), so a repeat review session can jump straight
// back to it instead of re-scrubbing to find it.
//
// Anchored to a real-world time-of-day rather than a raw timeline offset:
// the timeline's own coordinate system is anchored to whichever loaded
// clip currently starts earliest, which can change (e.g. a clip starting
// before the current earliest one gets added later) and would otherwise
// silently shift every bookmark's position. timeOfDaySeconds is the
// source of truth; a bookmark's position on the current timeline is always
// re-derived from it (see bookmarkTimelineSeconds in lib/bookmarks.ts).
export interface Bookmark {
  id: string;
  /** Real-world time-of-day (seconds since midnight) this bookmark marks. */
  timeOfDaySeconds: number | null;
  /**
   * Timeline position at creation time. Used directly only when
   * timeOfDaySeconds is null — i.e. no clip had a usable start time-of-day
   * yet (a single untimed clip), so there's no anchor to derive a real
   * time-of-day from. Otherwise kept only as a migration fallback for
   * bookmarks saved before timeOfDaySeconds existed.
   */
  fallbackTimeSeconds: number;
  label: string;
}

// A clip's digital zoom, shared across every view (Grid/Dynamic/Focus all
// show the same zoom for a given clip rather than each tracking it
// separately). `enabled` only gates rendering in toggle-based views (Grid,
// Dynamic grid's multi-tile case) — the single-panel/focus-one case always
// applies the region regardless, since there's no toggle there and level 1
// (the default) is a no-op anyway.
export interface ClipZoomState {
  enabled: boolean;
  center: { x: number; y: number };
  level: number;
}

// Speed setting for the shared transport: a playbackRate multiplier, or
// "crawl" for the manual one-frame-per-second mode (see ReviewScreen).
export type PlaybackSpeedSetting = number | "crawl";

// A snapshot of "exactly where the user left off" reviewing — playback
// position, speed, the A/B loop, and per-clip zoom — separate from the
// content fields above (clips, bookmarks) since it's captured only at the
// moment of an explicit Save rather than tracked as an edit worth prompting
// to save on its own.
export interface PlaybackSnapshot {
  lastPositionSeconds: number;
  playbackSpeed: PlaybackSpeedSetting;
  loopRegion: LoopRegion | null;
  loopEnabled: boolean;
  zoomByClip: Record<string, ClipZoomState>;
}

// The full working state, persisted to a .dsync project file. viewMode,
// focusedClipIds, bookmarks, and the playback snapshot are all optional so
// project files saved before each of those features existed still load
// fine — they just default to plain grid view / no bookmarks / starting
// from the beginning.
export interface ProjectSession {
  version: 1;
  name: string;
  clips: VideoClip[];
  viewMode?: ViewMode;
  focusedClipIds?: string[];
  bookmarks?: Bookmark[];
  playback?: PlaybackSnapshot;
}

// Entry in the local "recent sessions" index shown on launch.
export interface RecentSessionEntry {
  projectFilePath: string;
  name: string;
  lastOpened: string; // ISO timestamp
}
