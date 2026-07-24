// Time-of-day math for the sync model: HH:MM:SS only, no date, circular
// over 24h. See "Timestamp & Sync Model" in CLAUDE.md — this intentionally
// does not try to disambiguate "23h apart" from "1h apart across midnight";
// it always resolves to the shorter wraparound interval.

const SECONDS_PER_DAY = 24 * 60 * 60;

export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, h, m, s] = match;
  const hours = Number(h);
  const minutes = Number(m);
  const seconds = Number(s);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Normalizes a seconds-in-day value that may be negative or >= 24h (e.g.
 * an anchor time-of-day plus an arbitrary timeline offset) back onto
 * [0, 24h). Kept separate from formatTimeOfDay so callers that need the
 * numeric value can avoid a lossy round-trip through a floored string.
 */
export function normalizeTimeOfDaySeconds(totalSeconds: number): number {
  return ((totalSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

export function formatTimeOfDay(totalSeconds: number): string {
  const normalized = normalizeTimeOfDaySeconds(totalSeconds);
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  const s = Math.floor(normalized % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Shortest signed offset (in seconds) from `a` to `b` on a 24h clock face.
 * Positive means `b` is later than `a` going forward; the wraparound
 * direction is always whichever is shorter.
 */
export function circularOffsetSeconds(aTimeOfDaySeconds: number, bTimeOfDaySeconds: number): number {
  let diff = (bTimeOfDaySeconds - aTimeOfDaySeconds) % SECONDS_PER_DAY;
  if (diff > SECONDS_PER_DAY / 2) diff -= SECONDS_PER_DAY;
  if (diff < -SECONDS_PER_DAY / 2) diff += SECONDS_PER_DAY;
  return diff;
}
