import { describe, expect, it } from "vitest";
import { frameStepSeconds, globalFrameStepSeconds } from "./fineTune";

describe("frameStepSeconds", () => {
  it("returns 1/frameRate for a known frame rate", () => {
    expect(frameStepSeconds(30)).toBeCloseTo(1 / 30, 10);
    expect(frameStepSeconds(24)).toBeCloseTo(1 / 24, 10);
    expect(frameStepSeconds(59.94)).toBeCloseTo(1 / 59.94, 10);
  });

  it("falls back to a default step when frame rate is unknown", () => {
    expect(frameStepSeconds(null)).toBeCloseTo(1 / 30, 10);
  });

  it("falls back to a default step for a non-positive frame rate", () => {
    expect(frameStepSeconds(0)).toBeCloseTo(1 / 30, 10);
    expect(frameStepSeconds(-5)).toBeCloseTo(1 / 30, 10);
  });
});

describe("globalFrameStepSeconds", () => {
  it("picks the finest step (highest frame rate) among mixed clips", () => {
    // 60fps has the smaller step, so stepping all clips together shouldn't
    // overshoot a full frame on the fastest one.
    expect(globalFrameStepSeconds([30, 60, 24])).toBeCloseTo(1 / 60, 10);
  });

  it("falls back to the default step for an empty list", () => {
    expect(globalFrameStepSeconds([])).toBeCloseTo(1 / 30, 10);
  });

  it("falls back to the default step when all frame rates are unknown", () => {
    expect(globalFrameStepSeconds([null, null])).toBeCloseTo(1 / 30, 10);
  });

  it("treats an unknown entry as the default rate when mixed with known ones", () => {
    // null falls back to 30fps (1/30), which is finer than 24fps (1/24),
    // so it — not the known 24fps clip — sets the step here.
    expect(globalFrameStepSeconds([null, 24])).toBeCloseTo(1 / 30, 10);
  });
});
