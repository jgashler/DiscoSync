import { describe, expect, it } from "vitest";
import { computeRoughSyncOffsets } from "./roughSync";
import { parseTimeOfDay } from "./timeOfDay";

function t(value: string): number {
  const parsed = parseTimeOfDay(value);
  if (parsed === null) throw new Error(`invalid fixture time: ${value}`);
  return parsed;
}

describe("computeRoughSyncOffsets", () => {
  it("returns an empty result for no clips", () => {
    expect(computeRoughSyncOffsets([])).toEqual({});
  });

  it("puts a single clip at offset 0", () => {
    const result = computeRoughSyncOffsets([{ id: "a", startTimeSeconds: t("10:00:00") }]);
    expect(result).toEqual({ a: 0 });
  });

  it("offsets a later clip forward relative to the earliest", () => {
    const result = computeRoughSyncOffsets([
      { id: "a", startTimeSeconds: t("10:00:00") },
      { id: "b", startTimeSeconds: t("10:00:05") },
    ]);
    expect(result).toEqual({ a: 0, b: 5 });
  });

  it("is independent of input order — the earliest clip always lands at 0", () => {
    const result = computeRoughSyncOffsets([
      { id: "b", startTimeSeconds: t("10:00:05") },
      { id: "a", startTimeSeconds: t("10:00:00") },
      { id: "c", startTimeSeconds: t("10:00:12") },
    ]);
    expect(result).toEqual({ a: 0, b: 5, c: 12 });
  });

  it("resolves a midnight-crossing spread to the short wraparound interval", () => {
    // 23:59:58 -> 00:00:01 is 3s later; 23:59:58 -> 00:00:03 is 5s later,
    // not ~24h apart.
    const result = computeRoughSyncOffsets([
      { id: "a", startTimeSeconds: t("23:59:58") },
      { id: "b", startTimeSeconds: t("00:00:01") },
      { id: "c", startTimeSeconds: t("00:00:03") },
    ]);
    expect(result).toEqual({ a: 0, b: 3, c: 5 });
  });

  it("excludes clips without a valid start time", () => {
    const result = computeRoughSyncOffsets([
      { id: "a", startTimeSeconds: t("10:00:00") },
      { id: "b", startTimeSeconds: null },
    ]);
    expect(result).toEqual({ a: 0 });
  });

  it("treats identical start times as offset 0 for both", () => {
    const result = computeRoughSyncOffsets([
      { id: "a", startTimeSeconds: t("10:00:00") },
      { id: "b", startTimeSeconds: t("10:00:00") },
    ]);
    expect(result).toEqual({ a: 0, b: 0 });
  });
});
