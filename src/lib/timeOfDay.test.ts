import { describe, expect, it } from "vitest";
import { circularOffsetSeconds, formatTimeOfDay, parseTimeOfDay } from "./timeOfDay";

describe("parseTimeOfDay", () => {
  it("parses a valid HH:MM:SS", () => {
    expect(parseTimeOfDay("14:32:05")).toBe(14 * 3600 + 32 * 60 + 5);
  });

  it("parses midnight and end-of-day boundary values", () => {
    expect(parseTimeOfDay("00:00:00")).toBe(0);
    expect(parseTimeOfDay("23:59:59")).toBe(SECONDS_PER_DAY_MINUS_ONE());
  });

  it("accepts a single-digit hour", () => {
    expect(parseTimeOfDay("9:05:00")).toBe(9 * 3600 + 5 * 60);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTimeOfDay("  14:32:05  ")).toBe(14 * 3600 + 32 * 60 + 5);
  });

  it.each([
    ["24:00:00", "hour out of range"],
    ["14:60:00", "minute out of range"],
    ["14:32:60", "second out of range"],
    ["14:32", "missing seconds"],
    ["14:32:05:00", "too many segments"],
    ["not a time", "garbage input"],
    ["", "empty string"],
  ])("rejects %s (%s)", (value) => {
    expect(parseTimeOfDay(value)).toBeNull();
  });
});

describe("formatTimeOfDay", () => {
  it("formats and zero-pads", () => {
    expect(formatTimeOfDay(9 * 3600 + 5 * 60 + 3)).toBe("09:05:03");
  });

  it("wraps values >= 24h back into range", () => {
    expect(formatTimeOfDay(SECONDS_PER_DAY() + 60)).toBe("00:01:00");
  });

  it("wraps negative values backward from midnight", () => {
    expect(formatTimeOfDay(-1)).toBe("23:59:59");
  });

  it("round-trips through parseTimeOfDay", () => {
    const value = "16:45:22";
    expect(formatTimeOfDay(parseTimeOfDay(value)!)).toBe(value);
  });
});

describe("circularOffsetSeconds", () => {
  it("returns 0 for identical times", () => {
    expect(circularOffsetSeconds(3600, 3600)).toBe(0);
  });

  it("returns a simple forward offset within the same day", () => {
    // 10:00:00 -> 10:05:00 is +5 minutes, nowhere near the wraparound
    expect(circularOffsetSeconds(10 * 3600, 10 * 3600 + 300)).toBe(300);
  });

  it("returns a simple backward offset within the same day", () => {
    expect(circularOffsetSeconds(10 * 3600 + 300, 10 * 3600)).toBe(-300);
  });

  it("resolves the short way across midnight going forward", () => {
    // 23:59:00 -> 00:01:00 is +2 minutes across midnight, not -23h58m
    const a = parseTimeOfDay("23:59:00")!;
    const b = parseTimeOfDay("00:01:00")!;
    expect(circularOffsetSeconds(a, b)).toBe(120);
  });

  it("resolves the short way across midnight going backward", () => {
    // 00:01:00 -> 23:59:00 is -2 minutes across midnight, not +23h58m
    const a = parseTimeOfDay("00:01:00")!;
    const b = parseTimeOfDay("23:59:00")!;
    expect(circularOffsetSeconds(a, b)).toBe(-120);
  });

  it("never returns a magnitude greater than 12h", () => {
    const a = parseTimeOfDay("00:00:00")!;
    const b = parseTimeOfDay("12:00:00")!;
    expect(Math.abs(circularOffsetSeconds(a, b))).toBeLessThanOrEqual(12 * 3600);
  });
});

function SECONDS_PER_DAY(): number {
  return 24 * 60 * 60;
}

function SECONDS_PER_DAY_MINUS_ONE(): number {
  return SECONDS_PER_DAY() - 1;
}
