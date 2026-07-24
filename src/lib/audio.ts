// Feature 6 (Per-Video Audio Controls): keep volume within the range the
// <video> element's own `volume` property accepts, and guard against a
// slider/input producing something non-numeric.
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
