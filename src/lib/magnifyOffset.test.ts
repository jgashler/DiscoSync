import { describe, expect, it } from "vitest";
import { clampAxisOffset } from "./magnifyOffset";

describe("clampAxisOffset", () => {
  it("returns 0 when the scaled box already fits without correction", () => {
    // bounds [10, 990]: a 200-wide box centered at 500 spans 400-600,
    // comfortably inside.
    expect(clampAxisOffset(500, 200, 10, 990)).toBe(0);
  });

  it("corrects a box overflowing the start edge", () => {
    // Centered at 50 with size 200 -> desired start = -50, clamp to minBound 10.
    expect(clampAxisOffset(50, 200, 10, 990)).toBe(60);
  });

  it("corrects a box overflowing the end edge", () => {
    // Centered at 950 with size 200 -> desired end = 1050, maxBound = 990.
    // desired start = 850, clamped start = 990 - 200 = 790 -> offset -60.
    expect(clampAxisOffset(950, 200, 10, 990)).toBe(-60);
  });

  it("centers the box (equal overflow both sides) when it's too big to fit at all", () => {
    // Box of 1200 can never fit inside a [0, 1000] bound.
    const offset = clampAxisOffset(500, 1200, 0, 1000);
    const desiredStart = 500 - 1200 / 2; // -100
    const finalStart = desiredStart + offset;
    // Centered means equal overflow on both edges: finalStart should be
    // negative by exactly half of the excess (1200 - 1000) / 2 = 100.
    expect(finalStart).toBeCloseTo(-100, 5);
    expect(finalStart + 1200).toBeCloseTo(1100, 5); // overflows the end by the same 100
  });

  it("regression: does not favor one edge when the box is taller than the bound (the reported bug)", () => {
    // This is the exact shape of the original bug report: a tall magnified
    // tile near the top of the window. A naive if/else-if would zero out
    // the top overflow while leaving the bottom overflowing by the full
    // excess.
    const minBound = 12;
    const maxBound = 788; // 800px window with a 12px margin
    const scaledSize = 900; // taller than the whole bound
    const center = 150; // tile sits near the top
    const offset = clampAxisOffset(center, scaledSize, minBound, maxBound);
    const finalStart = center - scaledSize / 2 + offset;
    const finalEnd = finalStart + scaledSize;
    const topOverflow = minBound - finalStart;
    const bottomOverflow = finalEnd - maxBound;
    // Both edges should overflow by roughly the same amount, not one edge
    // clean and the other blown out.
    expect(Math.abs(topOverflow - bottomOverflow)).toBeLessThan(1);
  });

  it("is symmetric: swapping which edge overflows negates the offset", () => {
    const nearStart = clampAxisOffset(50, 200, 10, 990);
    const nearEnd = clampAxisOffset(950, 200, 10, 990);
    expect(nearEnd).toBeCloseTo(-nearStart, 5);
  });

  it("respects a bound tighter than the full window (e.g. a scroll area stopping above a fixed toolbar)", () => {
    // Bottom-row tile near the bottom of a 500px-tall scroll area
    // (simulating a review pane that ends above the transport bar), even
    // though the browser window itself is much taller.
    const minBound = 0;
    const maxBound = 500;
    const scaledSize = 250;
    const center = 480; // near the bottom of the constrained area
    const offset = clampAxisOffset(center, scaledSize, minBound, maxBound);
    const finalEnd = center - scaledSize / 2 + offset + scaledSize;
    expect(finalEnd).toBeLessThanOrEqual(maxBound);
  });
});
