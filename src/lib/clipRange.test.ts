import { describe, expect, it } from "vitest";
import { computeClipRangeStatus } from "./clipRange";

describe("computeClipRangeStatus", () => {
  it("is in-range strictly between the offset and the end", () => {
    expect(computeClipRangeStatus(10, 20, 15)).toEqual({ status: "in-range" });
  });

  it("is in-range exactly at the start boundary", () => {
    expect(computeClipRangeStatus(10, 20, 10)).toEqual({ status: "in-range" });
  });

  it("is in-range exactly at the end boundary", () => {
    expect(computeClipRangeStatus(10, 20, 30)).toEqual({ status: "in-range" });
  });

  it("is before-range prior to the offset, with seconds until start", () => {
    expect(computeClipRangeStatus(10, 20, 4)).toEqual({ status: "before", secondsUntilStart: 6 });
  });

  it("is after-range past the end, with seconds since end", () => {
    expect(computeClipRangeStatus(10, 20, 33)).toEqual({ status: "after", secondsSinceEnd: 3 });
  });

  it("is always in-range when duration is unknown", () => {
    expect(computeClipRangeStatus(10, null, 0)).toEqual({ status: "in-range" });
    expect(computeClipRangeStatus(10, null, 1000)).toEqual({ status: "in-range" });
  });

  it("handles a zero offset", () => {
    expect(computeClipRangeStatus(0, 10, 0)).toEqual({ status: "in-range" });
    expect(computeClipRangeStatus(0, 10, 15)).toEqual({ status: "after", secondsSinceEnd: 5 });
  });

  it("is unsynced when there's no valid offset, regardless of global time", () => {
    expect(computeClipRangeStatus(null, 20, 0)).toEqual({ status: "unsynced" });
    expect(computeClipRangeStatus(null, 20, 1000)).toEqual({ status: "unsynced" });
    expect(computeClipRangeStatus(null, null, 0)).toEqual({ status: "unsynced" });
  });

  it("does not treat a null offset the same as offset 0", () => {
    // A clip that's actually synced to start at 0 is in-range at t=0; a
    // clip with no sync at all must not be conflated with that.
    expect(computeClipRangeStatus(0, 20, 0).status).toBe("in-range");
    expect(computeClipRangeStatus(null, 20, 0).status).toBe("unsynced");
  });
});
