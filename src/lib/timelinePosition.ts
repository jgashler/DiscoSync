// Horizontal position (0-100) for a marker over the scrub bar — shared by
// timeline bookmarks and the loop-range handles, since both are just "a
// moment in seconds, placed along the timeline." Clamped since a bookmark
// (or loop edge) from a longer-timeline save could in principle sit past
// the current (e.g. re-synced, now shorter) timelineDuration.
export function timelineMarkerPercent(timeSeconds: number, timelineDuration: number): number {
  if (timelineDuration <= 0) return 0;
  return Math.min(Math.max((timeSeconds / timelineDuration) * 100, 0), 100);
}
