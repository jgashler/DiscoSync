import { describe, expect, it } from "vitest";
import { resolveFocusedClipIds, swapFocusedClipId } from "./focusLayout";

function clip(id: string, gridPosition: number) {
  return { id, gridPosition };
}

describe("resolveFocusedClipIds", () => {
  it("returns an empty array for grid mode regardless of request", () => {
    expect(resolveFocusedClipIds([clip("a", 0), clip("b", 1)], "grid", ["a"])).toEqual([]);
  });

  it("keeps a valid request as-is for focus1", () => {
    expect(resolveFocusedClipIds([clip("a", 0), clip("b", 1)], "focus1", ["b"])).toEqual(["b"]);
  });

  it("keeps a valid request as-is for focus2", () => {
    const clips = [clip("a", 0), clip("b", 1), clip("c", 2)];
    expect(resolveFocusedClipIds(clips, "focus2", ["c", "a"])).toEqual(["c", "a"]);
  });

  it("backfills from gridPosition order when nothing is requested", () => {
    const clips = [clip("b", 1), clip("a", 0), clip("c", 2)];
    expect(resolveFocusedClipIds(clips, "focus2", [])).toEqual(["a", "b"]);
  });

  it("backfills a partial request up to the required count", () => {
    const clips = [clip("a", 0), clip("b", 1), clip("c", 2)];
    expect(resolveFocusedClipIds(clips, "focus2", ["c"])).toEqual(["c", "a"]);
  });

  it("drops requested ids that no longer exist among clips", () => {
    const clips = [clip("a", 0), clip("b", 1)];
    expect(resolveFocusedClipIds(clips, "focus1", ["deleted"])).toEqual(["a"]);
  });

  it("dedupes a request and backfills the rest", () => {
    const clips = [clip("a", 0), clip("b", 1), clip("c", 2)];
    expect(resolveFocusedClipIds(clips, "focus2", ["a", "a"])).toEqual(["a", "b"]);
  });

  it("truncates an over-long request to the required count", () => {
    const clips = [clip("a", 0), clip("b", 1), clip("c", 2)];
    expect(resolveFocusedClipIds(clips, "focus1", ["b", "c"])).toEqual(["b"]);
  });

  it("returns fewer than required if there aren't enough clips", () => {
    expect(resolveFocusedClipIds([clip("a", 0)], "focus2", [])).toEqual(["a"]);
  });

  it("returns an empty array with no clips at all", () => {
    expect(resolveFocusedClipIds([], "focus2", [])).toEqual([]);
  });

  describe("dynamic mode (no fixed count)", () => {
    it("leaves an empty request empty rather than backfilling", () => {
      const clips = [clip("a", 0), clip("b", 1), clip("c", 2)];
      expect(resolveFocusedClipIds(clips, "dynamic", [])).toEqual([]);
    });

    it("keeps any valid subset as-is, in requested order", () => {
      const clips = [clip("a", 0), clip("b", 1), clip("c", 2)];
      expect(resolveFocusedClipIds(clips, "dynamic", ["c", "a"])).toEqual(["c", "a"]);
    });

    it("allows all clips to be selected at once", () => {
      const clips = [clip("a", 0), clip("b", 1), clip("c", 2)];
      expect(resolveFocusedClipIds(clips, "dynamic", ["a", "b", "c"])).toEqual(["a", "b", "c"]);
    });

    it("drops invalid ids without backfilling replacements", () => {
      const clips = [clip("a", 0), clip("b", 1)];
      expect(resolveFocusedClipIds(clips, "dynamic", ["a", "deleted"])).toEqual(["a"]);
    });

    it("dedupes a request", () => {
      const clips = [clip("a", 0), clip("b", 1)];
      expect(resolveFocusedClipIds(clips, "dynamic", ["a", "a", "b"])).toEqual(["a", "b"]);
    });
  });
});

describe("swapFocusedClipId", () => {
  it("swaps two ids that are both already focused", () => {
    expect(swapFocusedClipId(["a", "b"], "a", "b")).toEqual(["b", "a"]);
  });

  it("promotes a thumbnail into a focused slot (thumbnail not in the array)", () => {
    // "target" (a, currently focused) gets replaced by "dragged" (c, a thumbnail)
    expect(swapFocusedClipId(["a", "b"], "a", "c")).toEqual(["c", "b"]);
  });

  it("is symmetric regardless of argument order", () => {
    expect(swapFocusedClipId(["a", "b"], "c", "a")).toEqual(["c", "b"]);
  });

  it("is a no-op when neither id is focused", () => {
    expect(swapFocusedClipId(["a", "b"], "x", "y")).toEqual(["a", "b"]);
  });

  it("is a no-op when swapping an id with itself", () => {
    expect(swapFocusedClipId(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});
