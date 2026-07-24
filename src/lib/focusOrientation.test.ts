import { describe, expect, it } from "vitest";
import { chooseFocusTwoOrientation } from "./focusOrientation";

describe("chooseFocusTwoOrientation", () => {
  it("picks row for a very wide container", () => {
    // 4:1 container with 16:9 video — splitting width still leaves each
    // half comfortably wide; splitting height wastes most of the width.
    expect(chooseFocusTwoOrientation(3200, 800, 16 / 9)).toBe("row");
  });

  it("picks column for a very tall/narrow container", () => {
    expect(chooseFocusTwoOrientation(400, 3200, 16 / 9)).toBe("column");
  });

  it("picks column for a moderately wide window where halving width still pillarboxes badly", () => {
    // A realistic app window (main area after the sidebar) isn't wide
    // enough to fit two 16:9 videos side by side without each one shrinking
    // more than stacking them would.
    expect(chooseFocusTwoOrientation(1200, 700, 16 / 9)).toBe("column");
  });

  it("breaks an exact tie in favor of row", () => {
    // Square video (aspect 1) in a square container produces identical
    // rendered area either way.
    expect(chooseFocusTwoOrientation(1000, 1000, 1)).toBe("row");
  });

  it("defaults to a 16:9 aspect ratio when none is given", () => {
    expect(chooseFocusTwoOrientation(3200, 800)).toBe("row");
    expect(chooseFocusTwoOrientation(400, 3200)).toBe("column");
  });

  it("falls back to row for degenerate (zero/negative) dimensions", () => {
    expect(chooseFocusTwoOrientation(0, 500)).toBe("row");
    expect(chooseFocusTwoOrientation(500, 0)).toBe("row");
    expect(chooseFocusTwoOrientation(-100, 500)).toBe("row");
  });
});
