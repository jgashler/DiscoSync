import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ArrowLeft,
  AudioWaveform,
  Bookmark as BookmarkIcon,
  ChevronDown,
  Columns2,
  HelpCircle,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  Maximize2,
  Pause,
  Pencil,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  StepBack,
  StepForward,
  X,
} from "lucide-react";
import { VideoGrid } from "./VideoGrid";
import { FocusLayout } from "./FocusLayout";
import { DynamicGridLayout } from "./DynamicGridLayout";
import { clampVolume } from "../lib/audio";
import { openHelpWindow, suggestAudioSyncOffsets } from "../lib/native";
import type { AudioSyncOutcome } from "../lib/native";
import { reorderClips } from "../lib/reorder";
import { formatSecondsShort } from "../lib/formatSeconds";
import { globalFrameStepSeconds } from "../lib/fineTune";
import { computeTimelineAnchorSeconds, timelineTimeOfDay } from "../lib/timelineClock";
import { resolveFocusedClipIds, swapFocusedClipId } from "../lib/focusLayout";
import { addBookmark, removeBookmark, renameBookmark } from "../lib/bookmarks";
import { timelineMarkerPercent } from "../lib/timelinePosition";
import { clampLoopRegion, normalizeLoopRegion, resizeLoopRegion, shouldWrapLoop } from "../lib/loopRange";
import type { LoopRegion } from "../lib/loopRange";
import type { Bookmark, ClipZoomState, PlaybackSnapshot, ViewMode, VideoClip } from "../types/project";

const SKIP_SECONDS = 10;

// How far from each clip's *current* effective offset the audio-sync
// search is allowed to move it. This is a refinement of an already
// roughly-synced position (from entered timestamps, possibly hand-nudged),
// not a blind search across the whole file — a wide window would risk
// locking onto a spurious match far from where the user placed it.
const AUDIO_SYNC_SEARCH_WINDOW_SECONDS = 30;

// "crawl" isn't a native HTML5 playbackRate — for a typical 30fps clip that
// would be ~0.033x, below what browsers can decode/play smoothly (audio
// cuts out and frames drop unpredictably under ~0.0625x). Instead it's
// driven manually: pause native playback and advance the shared timeline by
// exactly one frame every second, reusing the same frame-step logic as the
// ,/. step-all buttons.
type PlaybackSpeed = number | "crawl";
const SPEED_OPTIONS: { label: string; value: PlaybackSpeed }[] = [
  { label: "1 fps", value: "crawl" },
  { label: "0.25x", value: 0.25 },
  { label: "0.5x", value: 0.5 },
  { label: "1x", value: 1 },
  { label: "1.25x", value: 1.25 },
  { label: "1.5x", value: 1.5 },
  { label: "2x", value: 2 },
  { label: "4x", value: 4 },
  { label: "8x", value: 8 },
  { label: "16x", value: 16 },
];

// How far a video's actual position may drift from its expected position
// (computed from the shared clock) before we snap it back. Independently
// decoding <video> elements drift apart over long playback even when
// started together — see "Playback drift" in CLAUDE.md.
const DRIFT_THRESHOLD_SECONDS = 0.25;
const DRIFT_CHECK_INTERVAL_MS = 1000;
// Cap how often the shared clock pushes a React re-render. The underlying
// clock (performance.now()) still advances every animation frame — this
// only throttles state updates, so 4+ simultaneously decoding <video>
// elements aren't competing with 60/sec re-renders for the main thread.
const UI_UPDATE_INTERVAL_MS = 100;

interface ReviewScreenProps {
  clips: VideoClip[];
  setClips: Dispatch<SetStateAction<VideoClip[]>>;
  syncOffsets: Record<string, number>;
  onBack: () => void;
  /**
   * Called with the current playback snapshot (position, speed, loop,
   * zoom) so it's captured into the save even though this screen owns
   * that state locally the rest of the time.
   */
  onSave: (playbackState?: PlaybackSnapshot) => Promise<boolean>;
  isDirty: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  focusedClipIds: string[];
  onFocusedClipIdsChange: (ids: string[]) => void;
  bookmarks: Bookmark[];
  onBookmarksChange: (bookmarks: Bookmark[]) => void;
  /** Seeds position/speed/loop/zoom on mount — from the loaded project, or defaults for a new one. */
  initialPlaybackState: PlaybackSnapshot;
}

export function ReviewScreen({
  clips,
  setClips,
  syncOffsets,
  onBack,
  onSave,
  isDirty,
  viewMode,
  onViewModeChange,
  focusedClipIds,
  onFocusedClipIdsChange,
  bookmarks,
  onBookmarksChange,
  initialPlaybackState,
}: ReviewScreenProps) {
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const registerVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current.set(id, el);
    else videoRefs.current.delete(id);
  }, []);

  const [isPlaying, setIsPlaying] = useState(false);
  // Seeded once from whatever was last saved (or defaults, for a new
  // project) — resuming "exactly where you left off" is captured as a
  // snapshot handed to onSave when you click Save, not tracked live the
  // rest of the time (see the Save button below), so playing/scrubbing
  // alone never marks the project dirty.
  const [globalTime, setGlobalTime] = useState(() => initialPlaybackState.lastPositionSeconds);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(() => initialPlaybackState.playbackSpeed);
  const [bookmarksMenuOpen, setBookmarksMenuOpen] = useState(false);
  const [renamingBookmarkId, setRenamingBookmarkId] = useState<string | null>(null);

  // A/B loop range. loopSetupActive + loopPendingStart drive the "click
  // twice on the timeline" gesture for defining a region from scratch;
  // once one exists, adjusting it is just dragging its edge handles
  // (loopDragEdgeRef).
  const [loopRegion, setLoopRegion] = useState<LoopRegion | null>(() => initialPlaybackState.loopRegion);
  const [loopEnabled, setLoopEnabled] = useState(() => initialPlaybackState.loopEnabled);
  const [loopSetupActive, setLoopSetupActive] = useState(false);
  const [loopPendingStart, setLoopPendingStart] = useState<number | null>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const loopDragEdgeRef = useRef<"start" | "end" | null>(null);

  // Per-clip digital zoom, shared across every view (see useClipZoom) and
  // seeded/saved the same way as the rest of this playback snapshot.
  const [zoomByClip, setZoomByClip] = useState<Record<string, ClipZoomState>>(
    () => initialPlaybackState.zoomByClip,
  );
  function handleZoomChange(clipId: string, next: ClipZoomState) {
    setZoomByClip((prev) => ({ ...prev, [clipId]: next }));
  }

  // Opt-in, human-gated audio sync suggestion (see CLAUDE.md's "Audio Sync
  // Suggestion" note): decoding and correlating audio happens entirely
  // locally in Rust and never modifies a clip's offset by itself — running
  // it applies the suggestion provisionally and remembers what was there
  // before, so the user can compare the result and keep or revert it,
  // exactly like any other manual offset edit.
  const [isSyncingAudio, setIsSyncingAudio] = useState(false);
  const [audioSyncError, setAudioSyncError] = useState<string | null>(null);
  const [audioSyncReview, setAudioSyncReview] = useState<{
    previousOffsets: Record<string, number>;
    outcomes: Record<string, AudioSyncOutcome>;
  } | null>(null);

  // Total effective offset per clip: rough sync + manual fine-tune. Clips
  // without a valid rough-sync offset (no/invalid timestamp) are left out
  // entirely — they must NOT fall back to 0, which would silently line
  // them up with the anchor clip as if verified when they were actually
  // never synced. Everything below treats a missing entry as "don't touch
  // this clip's playback at all." A lone clip is the one exception: with
  // nothing else to sync against, requiring a start time-of-day would just
  // be busywork, so it always plays from offset 0 regardless.
  const effectiveOffsets = useMemo(() => {
    if (clips.length === 1) {
      return { [clips[0].id]: clips[0].manualOffsetSeconds };
    }
    const offsets: Record<string, number> = {};
    for (const clip of clips) {
      const roughOffset = syncOffsets[clip.id];
      if (roughOffset === undefined) continue;
      offsets[clip.id] = roughOffset + clip.manualOffsetSeconds;
    }
    return offsets;
  }, [clips, syncOffsets]);

  function isSynced(clip: VideoClip): boolean {
    return effectiveOffsets[clip.id] !== undefined;
  }

  async function handleSyncByAudio() {
    const syncedClips = clips.filter(isSynced);
    if (syncedClips.length < 2) return;

    // The earliest-starting clip anchors the correlation — every other
    // clip's offset is suggested relative to it. Its own offset is never
    // changed; there's nothing to compare it against.
    const anchorClip = syncedClips.reduce((earliest, c) =>
      effectiveOffsets[c.id] < effectiveOffsets[earliest.id] ? c : earliest,
    );
    const candidateClips = syncedClips.filter((c) => c.id !== anchorClip.id);

    setIsSyncingAudio(true);
    setAudioSyncError(null);
    try {
      const outcomes = await suggestAudioSyncOffsets(
        { id: anchorClip.id, path: anchorClip.filePath, currentOffsetSeconds: effectiveOffsets[anchorClip.id] },
        candidateClips.map((c) => ({
          id: c.id,
          path: c.filePath,
          currentOffsetSeconds: effectiveOffsets[c.id],
        })),
        AUDIO_SYNC_SEARCH_WINDOW_SECONDS,
      );

      const previousOffsets = Object.fromEntries(clips.map((c) => [c.id, c.manualOffsetSeconds]));

      setClips((prev) =>
        prev.map((c) => {
          const outcome = outcomes[c.id];
          if (!outcome || outcome.status !== "suggested") return c;
          // manualOffsetSeconds sits on top of rough sync — back it out of
          // the suggested absolute offset so the effective offset lands
          // exactly where the suggestion says.
          const roughOffset = syncOffsets[c.id] ?? 0;
          return { ...c, manualOffsetSeconds: outcome.offsetSeconds - roughOffset };
        }),
      );

      setAudioSyncReview({ previousOffsets, outcomes });
    } catch (e) {
      setAudioSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSyncingAudio(false);
    }
  }

  function handleKeepAudioSync() {
    setAudioSyncReview(null);
  }

  function handleRevertAudioSync() {
    if (!audioSyncReview) return;
    const { previousOffsets } = audioSyncReview;
    setClips((prev) =>
      prev.map((c) => (previousOffsets[c.id] !== undefined ? { ...c, manualOffsetSeconds: previousOffsets[c.id] } : c)),
    );
    setAudioSyncReview(null);
  }

  // Trimmed to the union of clips' active windows — [earliest clip start,
  // latest clip end] — rather than always starting at 0. Nudging clips with
  // bad/mismatched rough-sync timestamps into their true alignment can leave
  // a large stretch at either end where every clip is simultaneously
  // out-of-range; there's nothing to scrub to there, so it's cut from the
  // bar rather than shown as dead space. timelineStart can be negative (a
  // clip nudged earlier than the rough-sync anchor) — it's not always 0.
  const { timelineStart, timelineDuration } = useMemo(() => {
    let start = 0;
    let end = 0;
    let any = false;
    for (const clip of clips) {
      if (clip.durationSeconds === null || !isSynced(clip)) continue;
      const clipStart = effectiveOffsets[clip.id];
      const clipEnd = clipStart + clip.durationSeconds;
      if (!any) {
        start = clipStart;
        end = clipEnd;
        any = true;
      } else {
        if (clipStart < start) start = clipStart;
        if (clipEnd > end) end = clipEnd;
      }
    }
    return { timelineStart: start, timelineDuration: Math.max(end - start, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, effectiveOffsets]);
  const timelineEnd = timelineStart + timelineDuration;

  function expectedLocalTime(clip: VideoClip, atGlobalTime: number): number {
    const local = atGlobalTime - effectiveOffsets[clip.id];
    const duration = clip.durationSeconds ?? Infinity;
    return Math.min(Math.max(local, 0), duration);
  }

  function seekAllTo(newGlobalTime: number) {
    for (const clip of clips) {
      if (!isSynced(clip)) continue;
      const el = videoRefs.current.get(clip.id);
      if (!el) continue;
      el.currentTime = expectedLocalTime(clip, newGlobalTime);
    }
  }

  // Re-seek immediately whenever an offset changes (nudge or numeric edit),
  // whether playing or paused, so fine-tuning is reflected live rather than
  // waiting for the next periodic drift check. Also re-clamps globalTime
  // into the (possibly just-shifted) trimmed timeline bounds — nudging a
  // clip into sync can move timelineStart/timelineEnd out from under the
  // current position.
  useEffect(() => {
    const clamped = Math.min(Math.max(globalTime, timelineStart), timelineEnd);
    if (clamped !== globalTime) setGlobalTime(clamped);
    seekAllTo(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOffsets, timelineStart, timelineEnd]);

  // Volume isn't a React-controllable DOM attribute (only `muted` is), so
  // it has to be applied to the element imperatively whenever it changes.
  // Audio is independent per video even though playback position is locked.
  useEffect(() => {
    for (const clip of clips) {
      const el = videoRefs.current.get(clip.id);
      if (!el) continue;
      el.volume = clip.volume;
      el.muted = clip.muted;
    }
  }, [clips]);

  // Clock: driven off performance.now() rather than any one video's
  // currentTime, since that's exactly the kind of decoder-owned clock that
  // drifts. rAF both updates the UI and periodically re-syncs each video.
  const clockRef = useRef({ startPerfMs: 0, startGlobalTime: 0 });
  const lastDriftCheckRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Starts native playback (at `rate`) for every synced clip whose window
  // has begun by `atGlobalTime` and isn't already playing. Shared by the
  // initial Play press and by the clock effect below, which re-runs this
  // whenever playbackSpeed changes mid-playback — video.play() on an
  // already-playing element is a harmless no-op, so this doubles as "just
  // make sure everything that should be playing is."
  function startEligibleClips(atGlobalTime: number, rate: number) {
    for (const clip of clips) {
      if (!isSynced(clip)) continue;
      const el = videoRefs.current.get(clip.id);
      if (!el) continue;
      if (expectedLocalTime(clip, atGlobalTime) <= 0 && effectiveOffsets[clip.id] > atGlobalTime) continue;
      el.playbackRate = rate;
      void el.play();
    }
  }

  useEffect(() => {
    if (!isPlaying) return;

    clockRef.current = { startPerfMs: performance.now(), startGlobalTime: globalTime };

    // Crawl mode never calls video.play() — there's no native playback to
    // drift-correct, just a fixed-rate manual seek every second using the
    // same "step everything by one frame" step size as the frame-step-all
    // buttons. Pause everything first: switching speed *into* crawl
    // mid-playback would otherwise leave clips still playing natively,
    // fighting the manual seek.
    if (playbackSpeed === "crawl") {
      for (const clip of clips) videoRefs.current.get(clip.id)?.pause();
      const step = globalFrameStepSeconds(clips.map((c) => c.frameRate));
      const intervalId = setInterval(() => {
        let next = Math.min(clockRef.current.startGlobalTime + step, timelineEnd);
        if (loopEnabled && loopRegion && shouldWrapLoop(next, loopRegion)) next = loopRegion.start;
        clockRef.current = { startPerfMs: performance.now(), startGlobalTime: next };
        setGlobalTime(next);
        seekAllTo(next);
        if (next >= timelineEnd) setIsPlaying(false);
      }, 1000);
      return () => clearInterval(intervalId);
    }

    // Switching speed *out of* crawl mid-playback needs native playback
    // (re)started, since crawl deliberately never called play(). For a
    // plain numeric-to-numeric speed change, every eligible clip is
    // already playing, so this just updates playbackRate on the fly.
    const rate = playbackSpeed;
    startEligibleClips(globalTime, rate);
    lastDriftCheckRef.current = performance.now();
    lastUiUpdateRef.current = performance.now();

    const tick = () => {
      const now = performance.now();
      const elapsed = ((now - clockRef.current.startPerfMs) / 1000) * rate;
      let current = clockRef.current.startGlobalTime + elapsed;

      if (loopEnabled && loopRegion && shouldWrapLoop(current, loopRegion)) {
        current = loopRegion.start;
        clockRef.current = { startPerfMs: now, startGlobalTime: current };
        seekAllTo(current);
      }

      if (current >= timelineEnd) {
        setGlobalTime(timelineEnd);
        setIsPlaying(false);
        for (const clip of clips) videoRefs.current.get(clip.id)?.pause();
        return;
      }

      if (now - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS) {
        lastUiUpdateRef.current = now;
        setGlobalTime(current);
      }

      // Start any clip whose synced window has now begun but that's still
      // sitting paused on its first frame. handlePlayPause only decides
      // "play now vs. wait" once, at the moment Play is pressed — a clip
      // whose start offset hadn't arrived yet was correctly left paused,
      // but nothing was ever telling it to start once the shared clock
      // caught up to it. That's the "just sits there frozen" bug: it
      // wasn't stuck, it was just never told to begin.
      for (const clip of clips) {
        if (!isSynced(clip)) continue;
        const el = videoRefs.current.get(clip.id);
        if (!el || !el.paused || el.ended) continue;
        if (current < effectiveOffsets[clip.id]) continue;
        el.currentTime = expectedLocalTime(clip, current);
        el.playbackRate = rate;
        void el.play();
      }

      if (now - lastDriftCheckRef.current >= DRIFT_CHECK_INTERVAL_MS) {
        lastDriftCheckRef.current = now;
        for (const clip of clips) {
          if (!isSynced(clip)) continue;
          const el = videoRefs.current.get(clip.id);
          if (!el || el.paused || el.ended) continue;
          // Don't fight a video that's already mid-seek or still buffering
          // (readyState < HAVE_CURRENT_DATA) — forcing another seek onto a
          // decoder that's already struggling to keep up just compounds
          // the stall instead of fixing it. Let it catch up on its own;
          // we'll re-check next interval.
          if (el.seeking || el.readyState < 2) continue;
          const expected = expectedLocalTime(clip, current);
          if (Math.abs(el.currentTime - expected) > DRIFT_THRESHOLD_SECONDS) {
            el.currentTime = expected;
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, timelineEnd, playbackSpeed, loopEnabled, loopRegion]);

  function handlePlayPause() {
    if (isPlaying) {
      setIsPlaying(false);
      for (const clip of clips) videoRefs.current.get(clip.id)?.pause();
      return;
    }

    const startAt = globalTime >= timelineEnd ? timelineStart : globalTime;
    setGlobalTime(startAt);
    seekAllTo(startAt);
    // Crawl mode drives the timeline itself (see the clock effect) rather
    // than native playback — starting native play here would race against
    // the manual per-second seek.
    if (playbackSpeed !== "crawl") {
      startEligibleClips(startAt, playbackSpeed);
    }
    setIsPlaying(true);
  }

  function handleScrub(value: number) {
    const clamped = Math.min(Math.max(value, timelineStart), timelineEnd);
    setGlobalTime(clamped);
    seekAllTo(clamped);
    // Keep the playback clock in sync with the scrub position. Without
    // this, the rAF loop (still computing from the old startGlobalTime)
    // overwrites the scrub on its very next tick if playing — the
    // "flashes forward then snaps back" bug.
    clockRef.current = { startPerfMs: performance.now(), startGlobalTime: clamped };
  }

  function handleSkip(deltaSeconds: number) {
    handleScrub(globalTime + deltaSeconds);
  }

  function handleFrameStepAll(direction: 1 | -1) {
    if (isPlaying) return;
    const step = globalFrameStepSeconds(clips.map((c) => c.frameRate));
    handleScrub(globalTime + direction * step);
  }

  function handleNudge(clipId: string, deltaSeconds: number) {
    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? { ...c, manualOffsetSeconds: c.manualOffsetSeconds + deltaSeconds } : c,
      ),
    );
  }

  function handleSetManualOffset(clipId: string, seconds: number) {
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, manualOffsetSeconds: seconds } : c)),
    );
  }

  function handleToggleMute(clipId: string) {
    setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, muted: !c.muted } : c)));
  }

  function handleSetVolume(clipId: string, volume: number) {
    const clamped = clampVolume(volume);
    setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, volume: clamped } : c)));
  }

  function handleReorder(draggedId: string, targetId: string) {
    setClips((prev) => reorderClips(prev, draggedId, targetId));
  }

  // Keep focusedClipIds valid whenever the mode or clip list changes
  // (switching into a focus mode, a clip getting relinked, etc.) rather
  // than requiring every call site to reason about it.
  useEffect(() => {
    const resolved = resolveFocusedClipIds(clips, viewMode, focusedClipIds);
    const unchanged =
      resolved.length === focusedClipIds.length && resolved.every((id, i) => id === focusedClipIds[i]);
    if (!unchanged) onFocusedClipIdsChange(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, clips]);

  // A drop in focus mode either swaps a clip into/out of a main slot, or —
  // if neither side is currently focused — just reorders two thumbnails.
  function handleFocusDrop(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    if (focusedClipIds.includes(draggedId) || focusedClipIds.includes(targetId)) {
      onFocusedClipIdsChange(swapFocusedClipId(focusedClipIds, draggedId, targetId));
    } else {
      setClips((prev) => reorderClips(prev, draggedId, targetId));
    }
  }

  // Entering dynamic mode with nothing selected yet starts you off seeing
  // everything (like plain grid), rather than an empty main area — you
  // then prune down by dragging clips out to the sidebar if you want.
  function handleViewModeClick(mode: ViewMode) {
    if (mode === "dynamic" && viewMode !== "dynamic" && focusedClipIds.length === 0) {
      onFocusedClipIdsChange(clips.map((c) => c.id));
    }
    onViewModeChange(mode);
  }

  // A single-clip session has nothing to switch between — grid, focus-two,
  // and dynamic all exist to arrange *multiple* clips relative to each
  // other. Always show it full-size via FocusLayout instead (which is also
  // where the digital zoom control lives), and hide the mode switcher
  // entirely rather than offer choices that all render the same thing.
  const isSingleClip = clips.length === 1;

  const timelineAnchorSeconds = useMemo(
    () => computeTimelineAnchorSeconds(clips, syncOffsets),
    [clips, syncOffsets],
  );
  const clockDisplay = timelineTimeOfDay(timelineAnchorSeconds, globalTime);

  function handleAddBookmark() {
    const label = timelineTimeOfDay(timelineAnchorSeconds, globalTime) ?? formatSecondsShort(globalTime);
    const id = crypto.randomUUID();
    onBookmarksChange(addBookmark(bookmarks, { id, timeSeconds: globalTime, label }));
    // Open straight into the rename field with the auto-generated label
    // pre-filled and selected — naming it is one keystroke away, but
    // clicking off (or just leaving the menu open) keeps the default.
    setBookmarksMenuOpen(true);
    setRenamingBookmarkId(id);
  }

  function handleJumpToBookmark(timeSeconds: number) {
    handleScrub(timeSeconds);
    setBookmarksMenuOpen(false);
  }

  function handleRemoveBookmark(id: string) {
    onBookmarksChange(removeBookmark(bookmarks, id));
  }

  function handleRenameBookmark(id: string, label: string) {
    onBookmarksChange(renameBookmark(bookmarks, id, label));
  }

  function timeFromClientX(clientX: number): number {
    const rect = scrubBarRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return timelineStart;
    const fraction = (clientX - rect.left) / rect.width;
    return timelineStart + Math.min(Math.max(fraction, 0), 1) * timelineDuration;
  }

  // The Loop icon has three states: no region (click arms "set region"
  // mode), armed (click again to back out), and an existing region (click
  // toggles it on/off — the region itself is remembered, so re-enabling
  // doesn't require reselecting).
  function handleLoopIconClick() {
    if (loopRegion) {
      setLoopEnabled((enabled) => !enabled);
      return;
    }
    setLoopSetupActive((active) => !active);
    setLoopPendingStart(null);
  }

  function handleScrubBarLoopClick(e: { clientX: number }) {
    const time = timeFromClientX(e.clientX);
    if (loopPendingStart === null) {
      setLoopPendingStart(time);
      return;
    }
    setLoopRegion(clampLoopRegion(normalizeLoopRegion(loopPendingStart, time), timelineStart, timelineEnd));
    setLoopEnabled(true);
    setLoopSetupActive(false);
    setLoopPendingStart(null);
  }

  function handleClearLoop() {
    setLoopRegion(null);
    setLoopEnabled(false);
    setLoopSetupActive(false);
    setLoopPendingStart(null);
  }

  function handleLoopHandlePointerDown(edge: "start" | "end", e: { pointerId: number; currentTarget: HTMLElement }) {
    e.currentTarget.setPointerCapture(e.pointerId);
    loopDragEdgeRef.current = edge;
  }

  function handleLoopHandlePointerMove(e: { clientX: number }) {
    const edge = loopDragEdgeRef.current;
    if (!edge || !loopRegion) return;
    setLoopRegion(resizeLoopRegion(loopRegion, edge, timeFromClientX(e.clientX), timelineStart, timelineEnd));
  }

  function handleLoopHandlePointerUp(e: { pointerId: number; currentTarget: HTMLElement }) {
    loopDragEdgeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // Keyboard shortcuts: Space play/pause, arrows skip ±10s, comma/period
  // step a frame. Registered once via a ref so it always calls through to
  // fresh handlers without re-subscribing on every render (same pattern as
  // App.tsx's window-close listener). Text-entry fields (the manual offset
  // input) opt out so typing "10.5" doesn't trigger playback — but the
  // scrub/volume range sliders don't, so arrow keys always skip even if
  // the scrub bar happens to have focus.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    // Works even while a text field is focused, matching normal app
    // convention (Ctrl/Cmd+S saves no matter what you were typing).
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void onSave({ lastPositionSeconds: globalTime, playbackSpeed, loopRegion, loopEnabled, zoomByClip });
      return;
    }

    const target = e.target;
    if (target instanceof HTMLElement) {
      const isTextEntry =
        target.isContentEditable ||
        target.tagName === "TEXTAREA" ||
        (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range");
      if (isTextEntry) return;
    }

    switch (e.key) {
      case " ":
        e.preventDefault();
        handlePlayPause();
        break;
      case "ArrowRight":
        e.preventDefault();
        handleSkip(SKIP_SECONDS);
        break;
      case "ArrowLeft":
        e.preventDefault();
        handleSkip(-SKIP_SECONDS);
        break;
      case ",":
        e.preventDefault();
        handleFrameStepAll(-1);
        break;
      case ".":
        e.preventDefault();
        handleFrameStepAll(1);
        break;
    }
  };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      keyHandlerRef.current(e);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const syncableClipCount = clips.filter(isSynced).length;
  const audioSyncOutcomes = audioSyncReview ? Object.values(audioSyncReview.outcomes) : [];
  const audioSyncSuggestedCount = audioSyncOutcomes.filter((o) => o.status === "suggested").length;
  const audioSyncFailedCount = audioSyncOutcomes.filter((o) => o.status === "failed").length;
  const audioSyncHasLowConfidence = audioSyncOutcomes.some((o) => o.status === "suggested" && o.confidence < 0.3);

  return (
    <div className="h-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto p-6 pb-2 flex flex-col">
        <div className="flex justify-between items-center gap-2 mb-2">
          {isSingleClip ? (
            <div />
          ) : (
            <div className="flex items-center gap-1 bg-neutral-900 rounded-md p-1">
              {(
                [
                  { mode: "grid" as const, label: "Grid", Icon: LayoutGrid },
                  { mode: "focus1" as const, label: "Focus one", Icon: Maximize2 },
                  { mode: "focus2" as const, label: "Focus two", Icon: Columns2 },
                  { mode: "dynamic" as const, label: "Dynamic grid", Icon: LayoutDashboard },
                ]
              ).map(({ mode, label, Icon }) => (
                <button
                  key={mode}
                  onClick={() => handleViewModeClick(mode)}
                  title={label}
                  className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                    viewMode === mode ? "bg-blue-600" : "hover:bg-neutral-800"
                  }`}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {syncableClipCount > 1 && (
              <button
                onClick={() => void handleSyncByAudio()}
                disabled={isSyncingAudio}
                title="Suggest sync offsets from each clip's audio."
                className="rounded-md bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5"
              >
                {isSyncingAudio ? <Loader2 size={14} className="animate-spin" /> : <AudioWaveform size={14} />}
                Sync by audio
              </button>
            )}
            <button
              onClick={() => void openHelpWindow()}
              title="Help"
              className="w-9 h-9 flex items-center justify-center rounded-md bg-neutral-800 hover:bg-neutral-700 transition-colors"
            >
              <HelpCircle size={16} />
            </button>
            <button
              onClick={() =>
                void onSave({ lastPositionSeconds: globalTime, playbackSpeed, loopRegion, loopEnabled, zoomByClip })
              }
              className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5"
            >
              Save project
              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />}
            </button>
            <button
              onClick={onBack}
              className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5"
            >
              <ArrowLeft size={14} />
              Back to import
            </button>
          </div>
        </div>

        {audioSyncError && (
          <div className="mb-2 px-3 py-2 rounded-md bg-red-950/40 border border-red-900 text-sm text-red-300 flex items-center justify-between gap-3">
            <span>Audio sync failed: {audioSyncError}</span>
            <button
              onClick={() => setAudioSyncError(null)}
              title="Dismiss"
              className="shrink-0 text-red-400 hover:text-red-200"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {audioSyncReview && (
          <div className="mb-2 px-3 py-2 rounded-md bg-blue-950/40 border border-blue-900 text-sm text-blue-200 flex items-center justify-between gap-3">
            <span>
              Audio sync suggested new offsets for {audioSyncSuggestedCount}{" "}
              {audioSyncSuggestedCount === 1 ? "clip" : "clips"}
              {audioSyncFailedCount > 0
                ? ` (${audioSyncFailedCount} couldn't be matched — their offsets weren't changed)`
                : ""}
              .{audioSyncHasLowConfidence ? " Some matches were weak — check playback carefully." : ""}
            </span>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleKeepAudioSync}
                className="rounded-md bg-blue-600 hover:bg-blue-500 px-3 py-1 text-sm transition-colors"
              >
                Keep
              </button>
              <button
                onClick={handleRevertAudioSync}
                className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-sm transition-colors"
              >
                Revert
              </button>
            </div>
          </div>
        )}

        {isSingleClip && (
          <FocusLayout
            clips={clips}
            focusedClipIds={[clips[0].id]}
            registerVideoRef={registerVideoRef}
            onToggleMute={handleToggleMute}
            onSetVolume={handleSetVolume}
            onNudge={handleNudge}
            onSetManualOffset={handleSetManualOffset}
            effectiveOffsets={effectiveOffsets}
            globalTime={globalTime}
            onDropClip={() => {}}
            zoomByClip={zoomByClip}
            onZoomChange={handleZoomChange}
          />
        )}
        {!isSingleClip && viewMode === "grid" && (
          <VideoGrid
            clips={clips}
            registerVideoRef={registerVideoRef}
            onToggleMute={handleToggleMute}
            onSetVolume={handleSetVolume}
            onReorder={handleReorder}
            onNudge={handleNudge}
            onSetManualOffset={handleSetManualOffset}
            effectiveOffsets={effectiveOffsets}
            globalTime={globalTime}
            zoomByClip={zoomByClip}
            onZoomChange={handleZoomChange}
          />
        )}
        {!isSingleClip && (viewMode === "focus1" || viewMode === "focus2") && (
          <FocusLayout
            clips={clips}
            focusedClipIds={focusedClipIds}
            registerVideoRef={registerVideoRef}
            onToggleMute={handleToggleMute}
            onSetVolume={handleSetVolume}
            onNudge={handleNudge}
            onSetManualOffset={handleSetManualOffset}
            effectiveOffsets={effectiveOffsets}
            globalTime={globalTime}
            onDropClip={handleFocusDrop}
            zoomByClip={zoomByClip}
            onZoomChange={handleZoomChange}
          />
        )}
        {!isSingleClip && viewMode === "dynamic" && (
          <DynamicGridLayout
            clips={clips}
            focusedClipIds={focusedClipIds}
            onFocusedClipIdsChange={onFocusedClipIdsChange}
            registerVideoRef={registerVideoRef}
            onToggleMute={handleToggleMute}
            onSetVolume={handleSetVolume}
            onNudge={handleNudge}
            onSetManualOffset={handleSetManualOffset}
            onReorder={handleReorder}
            effectiveOffsets={effectiveOffsets}
            globalTime={globalTime}
            zoomByClip={zoomByClip}
            onZoomChange={handleZoomChange}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-neutral-800 bg-neutral-950 px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => handleFrameStepAll(-1)}
          disabled={isPlaying}
          title="Step all videos back one frame (,), pause first"
          className="rounded-md bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed w-9 h-9 flex items-center justify-center transition-colors"
        >
          <StepBack size={16} />
        </button>
        <button
          onClick={() => handleSkip(-SKIP_SECONDS)}
          title={`Back ${SKIP_SECONDS}s (←)`}
          className="relative rounded-md bg-neutral-800 hover:bg-neutral-700 w-9 h-9 flex items-center justify-center transition-colors"
        >
          <RotateCcw size={22} />
          <span className="absolute text-[9px] font-bold tabular-nums translate-y-px">{SKIP_SECONDS}</span>
        </button>
        <button
          onClick={handlePlayPause}
          title={`${isPlaying ? "Pause" : "Play"} (Space)`}
          className="rounded-md bg-blue-600 hover:bg-blue-500 w-10 h-9 flex items-center justify-center transition-colors"
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={() => handleSkip(SKIP_SECONDS)}
          title={`Forward ${SKIP_SECONDS}s (→)`}
          className="relative rounded-md bg-neutral-800 hover:bg-neutral-700 w-9 h-9 flex items-center justify-center transition-colors"
        >
          <RotateCw size={22} />
          <span className="absolute text-[9px] font-bold tabular-nums translate-y-px">{SKIP_SECONDS}</span>
        </button>
        <button
          onClick={() => handleFrameStepAll(1)}
          disabled={isPlaying}
          title="Step all videos forward one frame (.), pause first"
          className="rounded-md bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed w-9 h-9 flex items-center justify-center transition-colors"
        >
          <StepForward size={16} />
        </button>

        <select
          value={playbackSpeed}
          onChange={(e) => setPlaybackSpeed(e.target.value === "crawl" ? "crawl" : Number(e.target.value))}
          title="Playback speed"
          className="rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm px-2 py-1.5 outline-none border border-neutral-800 focus:border-blue-500"
        >
          {SPEED_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 bg-neutral-800 rounded-md">
          <button
            onClick={handleAddBookmark}
            title="Add bookmark at current position"
            className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-neutral-700 transition-colors"
          >
            <BookmarkIcon size={16} />
          </button>
          {bookmarks.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setBookmarksMenuOpen((open) => !open)}
                title="Bookmarks"
                className="h-9 pl-1 pr-2 flex items-center gap-0.5 rounded-md hover:bg-neutral-700 transition-colors"
              >
                <span className="text-xs tabular-nums text-neutral-300">{bookmarks.length}</span>
                <ChevronDown size={13} />
              </button>
              {bookmarksMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setBookmarksMenuOpen(false)} />
                  <div className="absolute left-0 bottom-full mb-1 w-64 bg-neutral-900 border border-neutral-800 rounded-md shadow-xl z-50 p-1 max-h-72 overflow-y-auto">
                    {bookmarks.map((b) => (
                      <div key={b.id} className="flex items-center gap-1">
                        {renamingBookmarkId === b.id ? (
                          <input
                            autoFocus
                            defaultValue={b.label}
                            onFocus={(e) => e.target.select()}
                            onBlur={(e) => {
                              handleRenameBookmark(b.id, e.target.value.trim() || b.label);
                              setRenamingBookmarkId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setRenamingBookmarkId(null);
                            }}
                            className="flex-1 min-w-0 bg-neutral-800 rounded px-2 py-1.5 text-sm outline-none border border-blue-500"
                          />
                        ) : (
                          <button
                            onClick={() => handleJumpToBookmark(b.timeSeconds)}
                            title="Jump to this bookmark"
                            className="flex-1 min-w-0 flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-neutral-800 transition-colors text-left"
                          >
                            <span className="truncate">{b.label}</span>
                            <span className="text-neutral-500 text-xs shrink-0 tabular-nums">
                              {formatSecondsShort(b.timeSeconds)}
                            </span>
                          </button>
                        )}
                        {renamingBookmarkId !== b.id && (
                          <button
                            onClick={() => setRenamingBookmarkId(b.id)}
                            title="Rename bookmark"
                            className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveBookmark(b.id)}
                          title="Remove bookmark"
                          className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-neutral-500 hover:text-red-400 hover:bg-red-950 transition-colors"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 bg-neutral-800 rounded-md">
          <button
            onClick={handleLoopIconClick}
            title={
              loopRegion
                ? loopEnabled
                  ? "Looping this range. Click to pause."
                  : "Loop range set. Click to resume looping."
                : loopSetupActive
                  ? "Click the timeline to set the loop start, then again for the end"
                  : "Set a loop range"
            }
            className={`w-9 h-9 flex items-center justify-center rounded-md transition-colors ${
              loopEnabled || loopSetupActive ? "bg-blue-600 hover:bg-blue-500" : "hover:bg-neutral-700"
            }`}
          >
            <Repeat size={16} />
          </button>
          {loopRegion && (
            <button
              onClick={handleClearLoop}
              title="Clear loop range"
              className="w-6 h-9 flex items-center justify-center rounded-md text-neutral-500 hover:text-red-400 hover:bg-neutral-700 transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <span
          className="text-sm text-neutral-200 tabular-nums w-20 text-center"
          title="Current time of day"
        >
          {clockDisplay ?? formatSecondsShort(globalTime)}
        </span>
        <div ref={scrubBarRef} className="flex-1 relative flex items-center">
          <input
            type="range"
            min={timelineStart}
            max={timelineEnd}
            step={0.1}
            value={globalTime}
            onChange={(e) => handleScrub(Number(e.target.value))}
            className="w-full"
          />
          {loopRegion && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 h-2 rounded-sm pointer-events-none transition-colors ${
                loopEnabled ? "bg-blue-500/30" : "bg-neutral-600/30"
              }`}
              style={{
                left: `${timelineMarkerPercent(loopRegion.start, timelineStart, timelineEnd)}%`,
                width: `${timelineMarkerPercent(loopRegion.end, timelineStart, timelineEnd) - timelineMarkerPercent(loopRegion.start, timelineStart, timelineEnd)}%`,
              }}
            />
          )}
          {/* Invisible click-catcher for the "click twice to set the loop range"
              gesture — only takes over the bar while armed, so normal
              scrubbing is completely unaffected the rest of the time. */}
          {loopSetupActive && (
            <div
              onClick={handleScrubBarLoopClick}
              title={loopPendingStart === null ? "Click to set the loop start" : "Click to set the loop end"}
              className="absolute inset-0 z-10 cursor-crosshair"
            />
          )}
          {loopPendingStart !== null && (
            <div
              style={{ left: `${timelineMarkerPercent(loopPendingStart, timelineStart, timelineEnd)}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2 w-0.5 h-4 bg-blue-400 pointer-events-none rounded-full"
            />
          )}
          {loopRegion && !loopSetupActive && (
            <>
              <div
                onPointerDown={(e) => handleLoopHandlePointerDown("start", e)}
                onPointerMove={handleLoopHandlePointerMove}
                onPointerUp={handleLoopHandlePointerUp}
                title="Drag to adjust the loop start"
                style={{ left: `${timelineMarkerPercent(loopRegion.start, timelineStart, timelineEnd)}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2 w-1.5 h-4 bg-blue-400 hover:bg-blue-300 cursor-ew-resize rounded-full touch-none"
              />
              <div
                onPointerDown={(e) => handleLoopHandlePointerDown("end", e)}
                onPointerMove={handleLoopHandlePointerMove}
                onPointerUp={handleLoopHandlePointerUp}
                title="Drag to adjust the loop end"
                style={{ left: `${timelineMarkerPercent(loopRegion.end, timelineStart, timelineEnd)}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2 w-1.5 h-4 bg-blue-400 hover:bg-blue-300 cursor-ew-resize rounded-full touch-none"
              />
            </>
          )}
          <div className="absolute inset-x-0 top-1/2 pointer-events-none">
            {bookmarks.map((b) => (
              <button
                key={b.id}
                onClick={() => handleJumpToBookmark(b.timeSeconds)}
                title={b.label}
                style={{ left: `${timelineMarkerPercent(b.timeSeconds, timelineStart, timelineEnd)}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-0.5 h-3 bg-amber-400 hover:bg-amber-300 hover:h-4 pointer-events-auto cursor-pointer rounded-full transition-[height]"
              />
            ))}
          </div>
        </div>
        <span className="text-sm text-neutral-400 tabular-nums w-12">{formatSecondsShort(timelineDuration)}</span>
      </div>
    </div>
  );
}
