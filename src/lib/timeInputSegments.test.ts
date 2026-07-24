import { describe, expect, it } from "vitest";
import { composeTimeValue, sanitizeDigits, splitTimeValue } from "./timeInputSegments";

describe("splitTimeValue", () => {
  it("splits a complete HH:MM:SS value", () => {
    expect(splitTimeValue("14:32:05")).toEqual(["14", "32", "05"]);
  });

  it("treats an empty string as three empty segments", () => {
    expect(splitTimeValue("")).toEqual(["", "", ""]);
  });

  it("fills missing trailing segments with empty strings", () => {
    expect(splitTimeValue("9")).toEqual(["9", "", ""]);
    expect(splitTimeValue("9:3")).toEqual(["9", "3", ""]);
  });

  it("handles an in-progress value with empty middle/trailing segments", () => {
    expect(splitTimeValue("9::")).toEqual(["9", "", ""]);
  });
});

describe("composeTimeValue", () => {
  it("joins three segments with colons", () => {
    expect(composeTimeValue("14", "32", "05")).toBe("14:32:05");
  });

  it("collapses to an empty string only when all three segments are empty", () => {
    expect(composeTimeValue("", "", "")).toBe("");
  });

  it("keeps colons when only some segments are empty (in-progress typing)", () => {
    expect(composeTimeValue("9", "", "")).toBe("9::");
    expect(composeTimeValue("", "30", "")).toBe(":30:");
  });

  it("round-trips with splitTimeValue", () => {
    const value = "07:08:09";
    expect(composeTimeValue(...splitTimeValue(value))).toBe(value);
  });
});

describe("sanitizeDigits", () => {
  it("passes digits through unchanged up to 2 characters", () => {
    expect(sanitizeDigits("5")).toBe("5");
    expect(sanitizeDigits("42")).toBe("42");
  });

  it("strips non-digit characters", () => {
    expect(sanitizeDigits("a1b2c")).toBe("12");
    expect(sanitizeDigits(":")).toBe("");
  });

  it("truncates to 2 digits", () => {
    expect(sanitizeDigits("12345")).toBe("12");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeDigits("")).toBe("");
  });
});
