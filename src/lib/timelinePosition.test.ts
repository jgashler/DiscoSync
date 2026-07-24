import { describe, expect, it } from "vitest";
import { timelineMarkerPercent } from "./timelinePosition";

describe("timelineMarkerPercent", () => {
  it("computes the percentage position along a timeline starting at 0", () => {
    expect(timelineMarkerPercent(30, 0, 120)).toBe(25);
  });

  it("computes the percentage position along a timeline with a nonzero start", () => {
    // A timeline trimmed to [100, 200] — 150 is halfway through.
    expect(timelineMarkerPercent(150, 100, 200)).toBe(50);
  });

  it("clamps to 0 when the timeline has no span (avoids dividing by zero)", () => {
    expect(timelineMarkerPercent(10, 0, 0)).toBe(0);
    expect(timelineMarkerPercent(10, 50, 50)).toBe(0);
  });

  it("clamps to [0, 100] for out-of-range positions", () => {
    expect(timelineMarkerPercent(-5, 0, 100)).toBe(0);
    expect(timelineMarkerPercent(150, 0, 100)).toBe(100);
    expect(timelineMarkerPercent(50, 100, 200)).toBe(0);
    expect(timelineMarkerPercent(250, 100, 200)).toBe(100);
  });
});
