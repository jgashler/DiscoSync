// A duration/countdown as "M:SS" — distinct from timeOfDay.ts's
// formatTimeOfDay, which formats a 24h clock time ("HH:MM:SS"), not a span.
export function formatSecondsShort(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
