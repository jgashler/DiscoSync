// A duration/countdown as "M:SS", or "H:MM:SS" once it reaches an hour —
// distinct from timeOfDay.ts's formatTimeOfDay, which formats a 24h clock
// time ("HH:MM:SS"), not a span. Spans this long show up for clips whose
// angles were recorded hours apart (see the out-of-range overlay in
// VideoTile), where "300:00" reads a lot less clearly than "5:00:00".
export function formatSecondsShort(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}
