// Feature 3 (Fine-Tuning): nudge buttons step by one frame, using the
// clip's actual detected frame rate — "step one frame" is meaningless
// without it (see CLAUDE.md's frame-accurate nudging risk note). Falls
// back to a conservative assumed rate if detection hasn't completed yet
// or failed, so nudging still does something reasonable rather than
// silently no-op'ing.
const FALLBACK_FRAME_RATE = 30;

export function frameStepSeconds(frameRate: number | null): number {
  if (frameRate !== null && frameRate > 0) return 1 / frameRate;
  return 1 / FALLBACK_FRAME_RATE;
}

// Coarser nudge steps alongside the frame step, for correcting a camera
// clock that's off by a round amount (common when a camera's time wasn't
// set carefully) without having to hand-calculate seconds and click the
// frame nudge hundreds of times.
export const NUDGE_STEPS: { label: string; seconds: number }[] = [
  { label: "1h", seconds: 3600 },
  { label: "1m", seconds: 60 },
  { label: "1s", seconds: 1 },
];

/**
 * Step size for advancing every loaded clip by "one frame" together. Uses
 * the finest (highest frame rate) step among them so stepping never
 * overshoots a full frame on the fastest clip — lower-frame-rate clips
 * just won't visibly change on every single step.
 */
export function globalFrameStepSeconds(frameRates: (number | null)[]): number {
  if (frameRates.length === 0) return frameStepSeconds(null);
  return Math.min(...frameRates.map(frameStepSeconds));
}
