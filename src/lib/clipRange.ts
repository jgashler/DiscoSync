// Whether a clip's active window (its synced offset through offset+duration)
// covers the current shared-timeline position — used to grey out tiles that
// haven't started yet, have already finished, or were never given a valid
// offset at all, rather than leaving them looking frozen/broken (or,
// worse, silently misaligned) while other clips keep playing.
export type ClipRangeStatus =
  | { status: "in-range" }
  | { status: "before"; secondsUntilStart: number }
  | { status: "after"; secondsSinceEnd: number }
  | { status: "unsynced" };

export function computeClipRangeStatus(
  offsetSeconds: number | null,
  durationSeconds: number | null,
  currentGlobalTime: number,
): ClipRangeStatus {
  // No valid rough-sync offset — usually a missing/invalid start
  // time-of-day. Must not fall back to "0" here: that would silently
  // align this clip with the anchor clip's start as if it had been
  // verified, when it was actually just never synced.
  if (offsetSeconds === null) return { status: "unsynced" };

  // Duration isn't known yet (still probing, or probe failed) — nothing to
  // judge the window against, so don't grey it out.
  if (durationSeconds === null) return { status: "in-range" };

  if (currentGlobalTime < offsetSeconds) {
    return { status: "before", secondsUntilStart: offsetSeconds - currentGlobalTime };
  }

  const end = offsetSeconds + durationSeconds;
  if (currentGlobalTime > end) {
    return { status: "after", secondsSinceEnd: currentGlobalTime - end };
  }

  return { status: "in-range" };
}
