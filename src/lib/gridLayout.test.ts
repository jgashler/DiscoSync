import { describe, expect, it } from "vitest";
import { computeGridColumns } from "./gridLayout";

describe("computeGridColumns", () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 2], // side-by-side
    [3, 2], // roughly square, one empty cell
    [4, 2], // perfect square
    [5, 3],
    [6, 3],
    [9, 3], // perfect square
    [10, 4],
  ])("%i clips -> %i columns", (count, expected) => {
    expect(computeGridColumns(count)).toBe(expected);
  });

  it("never leaves an empty row for a perfect square count", () => {
    for (const n of [1, 4, 9, 16]) {
      const cols = computeGridColumns(n);
      const rows = Math.ceil(n / cols);
      expect(cols * rows).toBeGreaterThanOrEqual(n);
      expect(rows).toBe(Math.sqrt(n));
    }
  });
});
