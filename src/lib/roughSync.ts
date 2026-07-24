// Feature 2 (Automatic Rough Sync): given each clip's entered start
// time-of-day, compute where on the shared timeline each clip's local t=0
// falls. The earliest-starting clip lands at offset 0; every other clip's
// offset is how many seconds into the shared timeline it starts — i.e.
// `sharedTimelineTime = clipLocalTime + clip.offsetSeconds`.
//
// Uses circularOffsetSeconds so a spread that crosses midnight (e.g. one
// clip at 23:59:58, another at 00:00:03) still resolves to "5 seconds
// apart," per the wraparound model in CLAUDE.md, rather than ~24 hours.
import { circularOffsetSeconds } from "./timeOfDay";

export interface SyncInput {
  id: string;
  /** Parsed start time-of-day in seconds, or null if not yet entered/invalid. */
  startTimeSeconds: number | null;
}

/**
 * Returns offset seconds keyed by clip id, for every clip with a valid
 * start time. Clips with no valid start time are omitted — the caller
 * decides how to treat them (e.g. leave at a default offset of 0).
 */
export function computeRoughSyncOffsets(clips: SyncInput[]): Record<string, number> {
  const valid = clips.filter(
    (c): c is SyncInput & { startTimeSeconds: number } => c.startTimeSeconds !== null,
  );
  if (valid.length === 0) return {};

  const anchor = valid[0].startTimeSeconds;
  const rawOffsets = valid.map((c) => ({
    id: c.id,
    raw: circularOffsetSeconds(anchor, c.startTimeSeconds),
  }));

  const minRaw = Math.min(...rawOffsets.map((o) => o.raw));

  const result: Record<string, number> = {};
  for (const { id, raw } of rawOffsets) {
    result[id] = raw - minRaw;
  }
  return result;
}
