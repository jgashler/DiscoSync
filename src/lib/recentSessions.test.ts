import { describe, expect, it } from "vitest";
import {
  parseRecentSessionsIndex,
  recordSessionOpened,
  serializeRecentSessionsIndex,
} from "./recentSessions";
import type { RecentSessionEntry } from "../types/project";

function entry(overrides: Partial<RecentSessionEntry> = {}): RecentSessionEntry {
  return {
    projectFilePath: "C:\\cases\\case1.dsync",
    name: "Case 1",
    lastOpened: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("serializeRecentSessionsIndex / parseRecentSessionsIndex round trip", () => {
  it("round-trips a list of entries", () => {
    const entries = [entry(), entry({ projectFilePath: "C:\\cases\\case2.dsync", name: "Case 2" })];
    expect(parseRecentSessionsIndex(serializeRecentSessionsIndex(entries))).toEqual(entries);
  });

  it("round-trips an empty list", () => {
    expect(parseRecentSessionsIndex(serializeRecentSessionsIndex([]))).toEqual([]);
  });
});

describe("parseRecentSessionsIndex validation", () => {
  it("returns an empty list for invalid JSON", () => {
    expect(parseRecentSessionsIndex("not json")).toEqual([]);
  });

  it("returns an empty list when the root isn't an array", () => {
    expect(parseRecentSessionsIndex(JSON.stringify({ foo: "bar" }))).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    const raw = JSON.stringify([entry(), { projectFilePath: "only-a-path" }, "not an object"]);
    expect(parseRecentSessionsIndex(raw)).toEqual([entry()]);
  });
});

describe("recordSessionOpened", () => {
  it("adds a new entry to the front", () => {
    const result = recordSessionOpened([entry({ projectFilePath: "a" })], entry({ projectFilePath: "b" }));
    expect(result.map((e) => e.projectFilePath)).toEqual(["b", "a"]);
  });

  it("moves an existing entry to the front instead of duplicating it", () => {
    const a = entry({ projectFilePath: "a", lastOpened: "2026-01-01T00:00:00.000Z" });
    const b = entry({ projectFilePath: "b", lastOpened: "2026-01-02T00:00:00.000Z" });
    const reopenedA = entry({ projectFilePath: "a", lastOpened: "2026-01-03T00:00:00.000Z" });

    const result = recordSessionOpened([a, b], reopenedA);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(reopenedA);
    expect(result[1]).toEqual(b);
  });

  it("caps the list at 10 entries", () => {
    const existing = Array.from({ length: 10 }, (_, i) => entry({ projectFilePath: `p${i}` }));
    const result = recordSessionOpened(existing, entry({ projectFilePath: "new" }));

    expect(result).toHaveLength(10);
    expect(result[0].projectFilePath).toBe("new");
    expect(result.map((e) => e.projectFilePath)).not.toContain("p9");
  });
});
