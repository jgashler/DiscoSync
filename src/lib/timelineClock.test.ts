import { describe, expect, it } from "vitest";
import { computeTimelineAnchorSeconds, timelineTimeOfDay } from "./timelineClock";
import { parseTimeOfDay } from "./timeOfDay";

describe("computeTimelineAnchorSeconds", () => {
  it("returns the parsed start time of the clip whose sync offset is 0", () => {
    const clips = [
      { id: "a", startTimeOfDay: "10:00:05" },
      { id: "b", startTimeOfDay: "10:00:00" },
    ];
    const syncOffsets = { a: 5, b: 0 };
    expect(computeTimelineAnchorSeconds(clips, syncOffsets)).toBe(parseTimeOfDay("10:00:00"));
  });

  it("returns null when no clip has a zero offset", () => {
    const clips = [{ id: "a", startTimeOfDay: "10:00:00" }];
    expect(computeTimelineAnchorSeconds(clips, { a: 5 })).toBeNull();
  });

  it("returns null when the anchor clip's time doesn't parse", () => {
    const clips = [{ id: "a", startTimeOfDay: "" }];
    expect(computeTimelineAnchorSeconds(clips, { a: 0 })).toBeNull();
  });

  it("returns null for an empty clip list", () => {
    expect(computeTimelineAnchorSeconds([], {})).toBeNull();
  });

  it("skips a zero-offset entry with an invalid time and finds another", () => {
    const clips = [
      { id: "a", startTimeOfDay: "" },
      { id: "b", startTimeOfDay: "09:00:00" },
    ];
    // Contrived (two clips both at offset 0 shouldn't normally happen),
    // but the function should still degrade gracefully rather than throw.
    expect(computeTimelineAnchorSeconds(clips, { a: 0, b: 0 })).toBe(parseTimeOfDay("09:00:00"));
  });
});

describe("timelineTimeOfDay", () => {
  it("adds elapsed seconds onto the anchor", () => {
    const anchor = parseTimeOfDay("10:00:00")!;
    expect(timelineTimeOfDay(anchor, 65)).toBe("10:01:05");
  });

  it("wraps across midnight", () => {
    const anchor = parseTimeOfDay("23:59:50")!;
    expect(timelineTimeOfDay(anchor, 20)).toBe("00:00:10");
  });

  it("returns null when there's no anchor", () => {
    expect(timelineTimeOfDay(null, 65)).toBeNull();
  });
});
