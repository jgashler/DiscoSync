import { describe, expect, it } from "vitest";
import { clampVolume } from "./audio";

describe("clampVolume", () => {
  it("passes through in-range values unchanged", () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
  });

  it("clamps values above 1", () => {
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(100)).toBe(1);
  });

  it("clamps values below 0", () => {
    expect(clampVolume(-0.5)).toBe(0);
    expect(clampVolume(-100)).toBe(0);
  });

  it("treats non-finite input as 0", () => {
    expect(clampVolume(NaN)).toBe(0);
    expect(clampVolume(Infinity)).toBe(0);
    expect(clampVolume(-Infinity)).toBe(0);
  });
});
