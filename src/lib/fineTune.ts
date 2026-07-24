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
