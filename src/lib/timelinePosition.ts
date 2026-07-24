// Horizontal position (0-100) for a marker over the scrub bar — shared by
// timeline bookmarks and the loop-range handles, since both are just "a
// moment in seconds, placed along the timeline." Clamped since a bookmark
// (or loop edge) from a longer-timeline save could in principle sit past
// the current (e.g. re-synced, now shorter or re-trimmed) timeline bounds.
// `timelineStart` is the trimmed timeline's own start (not always 0 — see
// ReviewScreen's timelineStart, which drops leading/trailing stretches
// where no clip is in range).
export function timelineMarkerPercent(timeSeconds: number, timelineStart: number, timelineEnd: number): number {
  const span = timelineEnd - timelineStart;
  if (span <= 0) return 0;
  return Math.min(Math.max(((timeSeconds - timelineStart) / span) * 100, 0), 100);
}
