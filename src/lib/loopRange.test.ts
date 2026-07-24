import { describe, expect, it } from "vitest";
import { clampLoopRegion, normalizeLoopRegion, resizeLoopRegion, shouldWrapLoop } from "./loopRange";

describe("normalizeLoopRegion", () => {
  it("keeps the order when the first click is earlier", () => {
    expect(normalizeLoopRegion(10, 30)).toEqual({ start: 10, end: 30 });
  });

  it("swaps the order when the second click landed earlier (dragged/clicked backwards)", () => {
    expect(normalizeLoopRegion(30, 10)).toEqual({ start: 10, end: 30 });
  });

  it("handles equal points", () => {
    expect(normalizeLoopRegion(15, 15)).toEqual({ start: 15, end: 15 });
  });
});

describe("clampLoopRegion", () => {
  it("leaves an in-range region untouched", () => {
    expect(clampLoopRegion({ start: 10, end: 30 }, 100)).toEqual({ start: 10, end: 30 });
  });

  it("clamps both edges into [0, duration]", () => {
    expect(clampLoopRegion({ start: -5, end: 150 }, 100)).toEqual({ start: 0, end: 100 });
  });

  it("re-normalizes if clamping inverted the order", () => {
    // A region saved against a much longer timeline, now clamped against a
    // short one, could in principle invert; clampLoopRegion should still
    // hand back a valid start <= end region.
    expect(clampLoopRegion({ start: 90, end: 95 }, 92)).toEqual({ start: 90, end: 92 });
  });
});

describe("resizeLoopRegion", () => {
  const region = { start: 10, end: 30 };

  it("moves the start edge", () => {
    expect(resizeLoopRegion(region, "start", 5, 100)).toEqual({ start: 5, end: 30 });
  });

  it("moves the end edge", () => {
    expect(resizeLoopRegion(region, "end", 40, 100)).toEqual({ start: 10, end: 40 });
  });

  it("clamps the start edge so it can't cross the end edge (min gap enforced)", () => {
    const result = resizeLoopRegion(region, "start", 29, 100);
    expect(result.end - result.start).toBeGreaterThanOrEqual(0.25);
    expect(result.start).toBeLessThan(result.end);
  });

  it("clamps the end edge so it can't cross the start edge (min gap enforced)", () => {
    const result = resizeLoopRegion(region, "end", 11, 100);
    expect(result.end - result.start).toBeGreaterThanOrEqual(0.25);
    expect(result.start).toBeLessThan(result.end);
  });

  it("clamps a dragged start edge to stay within [0, duration]", () => {
    expect(resizeLoopRegion(region, "start", -20, 100).start).toBe(0);
  });

  it("clamps a dragged end edge to stay within [0, duration]", () => {
    expect(resizeLoopRegion(region, "end", 500, 100).end).toBe(100);
  });
});

describe("shouldWrapLoop", () => {
  const region = { start: 10, end: 30 };

  it("is false before the loop end", () => {
    expect(shouldWrapLoop(29.9, region)).toBe(false);
  });

  it("is true at or past the loop end", () => {
    expect(shouldWrapLoop(30, region)).toBe(true);
    expect(shouldWrapLoop(31, region)).toBe(true);
  });
});
