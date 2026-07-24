import { describe, expect, it } from "vitest";
import { reorderClips } from "./reorder";

interface Item {
  id: string;
  gridPosition: number;
}

function items(...ids: string[]): Item[] {
  return ids.map((id, i) => ({ id, gridPosition: i }));
}

function order(result: Item[]): string[] {
  return [...result].sort((a, b) => a.gridPosition - b.gridPosition).map((c) => c.id);
}

describe("reorderClips", () => {
  it("moves the first item to the last slot", () => {
    const result = reorderClips(items("a", "b", "c", "d"), "a", "d");
    expect(order(result)).toEqual(["b", "c", "d", "a"]);
  });

  it("moves the last item to the first slot", () => {
    const result = reorderClips(items("a", "b", "c", "d"), "d", "a");
    expect(order(result)).toEqual(["d", "a", "b", "c"]);
  });

  it("moves a middle item forward", () => {
    const result = reorderClips(items("a", "b", "c", "d"), "b", "d");
    expect(order(result)).toEqual(["a", "c", "d", "b"]);
  });

  it("moves a middle item backward", () => {
    const result = reorderClips(items("a", "b", "c", "d"), "c", "a");
    expect(order(result)).toEqual(["c", "a", "b", "d"]);
  });

  it("assigns contiguous gridPosition values starting at 0", () => {
    const result = reorderClips(items("a", "b", "c"), "c", "a");
    const positions = [...result].sort((a, b) => a.gridPosition - b.gridPosition).map((c) => c.gridPosition);
    expect(positions).toEqual([0, 1, 2]);
  });

  it("is a no-op when dragged onto itself", () => {
    const original = items("a", "b", "c");
    const result = reorderClips(original, "b", "b");
    expect(result).toBe(original);
  });

  it("returns the original array when the dragged id doesn't exist", () => {
    const original = items("a", "b", "c");
    const result = reorderClips(original, "missing", "a");
    expect(result).toBe(original);
  });

  it("returns the original array when the target id doesn't exist", () => {
    const original = items("a", "b", "c");
    const result = reorderClips(original, "a", "missing");
    expect(result).toBe(original);
  });

  it("works from an unsorted input array", () => {
    const unsorted = [
      { id: "c", gridPosition: 2 },
      { id: "a", gridPosition: 0 },
      { id: "b", gridPosition: 1 },
    ];
    const result = reorderClips(unsorted, "a", "c");
    expect(order(result)).toEqual(["b", "c", "a"]);
  });
});
