// Maps the shared timeline's 0-based globalTime back to a real time-of-day,
// since "0:07 elapsed" is a lot less useful during review than "14:32:07".
// Anchored to whichever clip's *rough* sync offset is 0 (the earliest
// clip) — manual fine-tune nudges are frame-scale corrections and
// shouldn't shift what real-world time the clock displays.
import { formatTimeOfDay, parseTimeOfDay } from "./timeOfDay";

export function computeTimelineAnchorSeconds(
  clips: { id: string; startTimeOfDay: string }[],
  syncOffsets: Record<string, number>,
): number | null {
  for (const clip of clips) {
    if (syncOffsets[clip.id] === 0) {
      const parsed = parseTimeOfDay(clip.startTimeOfDay);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

export function timelineTimeOfDay(anchorSeconds: number | null, globalTimeSeconds: number): string | null {
  if (anchorSeconds === null) return null;
  return formatTimeOfDay(anchorSeconds + globalTimeSeconds);
}
