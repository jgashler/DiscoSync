import { describe, expect, it } from "vitest";
import { formatSecondsShort } from "./formatSeconds";

describe("formatSecondsShort", () => {
  it("formats whole seconds under a minute", () => {
    expect(formatSecondsShort(5)).toBe("0:05");
    expect(formatSecondsShort(59)).toBe("0:59");
  });

  it("formats minutes and seconds", () => {
    expect(formatSecondsShort(65)).toBe("1:05");
    expect(formatSecondsShort(600)).toBe("10:00");
  });

  it("rounds the total instead of the remainder, avoiding an 'M:60' result", () => {
    // 179.6 rounds to 180 total seconds (3:00), not 2:60.
    expect(formatSecondsShort(179.6)).toBe("3:00");
  });

  it("treats negative input as zero", () => {
    expect(formatSecondsShort(-5)).toBe("0:00");
  });

  it("formats zero", () => {
    expect(formatSecondsShort(0)).toBe("0:00");
  });
});
