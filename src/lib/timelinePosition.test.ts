import { describe, expect, it } from "vitest";
import { timelineMarkerPercent } from "./timelinePosition";

describe("timelineMarkerPercent", () => {
  it("computes the percentage position along the timeline", () => {
    expect(timelineMarkerPercent(30, 120)).toBe(25);
  });

  it("clamps to 0 when timelineDuration is 0 (avoids dividing by zero)", () => {
    expect(timelineMarkerPercent(10, 0)).toBe(0);
  });

  it("clamps to [0, 100] for out-of-range positions", () => {
    expect(timelineMarkerPercent(-5, 100)).toBe(0);
    expect(timelineMarkerPercent(150, 100)).toBe(100);
  });
});
