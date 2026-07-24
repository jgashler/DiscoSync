// A/B loop range: repeat a stretch of the shared timeline (across every
// synced clip) instead of scrubbing back and forth manually. Saved as part
// of the project's "resume where I left off" state (see ProjectSession).
export interface LoopRegion {
  start: number;
  end: number;
}

// Below this width a loop stops being meaningful (near-instant repeat) and
// a drag that crossed the opposite edge would otherwise invert the region.
const MIN_LOOP_SECONDS = 0.25;

// Two raw click positions on the timeline, in whichever order the user
// clicked them, normalized into a proper start < end region.
export function normalizeLoopRegion(pointA: number, pointB: number): LoopRegion {
  return pointA <= pointB ? { start: pointA, end: pointB } : { start: pointB, end: pointA };
}

// `min`/`max` are the timeline's own bounds — not always [0, duration], since
// a trimmed timeline (see ReviewScreen's timelineStart) can start above 0.
export function clampLoopRegion(region: LoopRegion, min: number, max: number): LoopRegion {
  const start = Math.min(Math.max(region.start, min), max);
  const end = Math.min(Math.max(region.end, min), max);
  return normalizeLoopRegion(start, end);
}

// Dragging one edge handle to `newTime`. Keeps at least MIN_LOOP_SECONDS
// between the edges rather than letting the loop collapse to zero width or
// cross over and invert.
export function resizeLoopRegion(
  region: LoopRegion,
  edge: "start" | "end",
  newTime: number,
  min: number,
  max: number,
): LoopRegion {
  const clampedTime = Math.min(Math.max(newTime, min), max);
  if (edge === "start") {
    return { start: Math.max(min, Math.min(clampedTime, region.end - MIN_LOOP_SECONDS)), end: region.end };
  }
  return { start: region.start, end: Math.min(max, Math.max(clampedTime, region.start + MIN_LOOP_SECONDS)) };
}

// Whether playback at `currentTime` has reached (or passed) the loop end
// and should wrap back to the start.
export function shouldWrapLoop(currentTime: number, region: LoopRegion): boolean {
  return currentTime >= region.end;
}
