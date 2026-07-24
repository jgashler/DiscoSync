import { describe, expect, it } from "vitest";
import { addBookmark, removeBookmark, renameBookmark, sortBookmarks } from "./bookmarks";
import type { Bookmark } from "../types/project";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return { id: "a", timeSeconds: 10, label: "Marker", ...overrides };
}

describe("sortBookmarks", () => {
  it("sorts ascending by timeSeconds", () => {
    const bookmarks = [makeBookmark({ id: "c", timeSeconds: 30 }), makeBookmark({ id: "a", timeSeconds: 10 }), makeBookmark({ id: "b", timeSeconds: 20 })];
    expect(sortBookmarks(bookmarks).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("doesn't mutate the input array", () => {
    const bookmarks = [makeBookmark({ id: "b", timeSeconds: 20 }), makeBookmark({ id: "a", timeSeconds: 10 })];
    const original = [...bookmarks];
    sortBookmarks(bookmarks);
    expect(bookmarks).toEqual(original);
  });
});

describe("addBookmark", () => {
  it("appends and keeps the result sorted by time", () => {
    const existing = [makeBookmark({ id: "a", timeSeconds: 10 })];
    const result = addBookmark(existing, makeBookmark({ id: "b", timeSeconds: 5 }));
    expect(result.map((b) => b.id)).toEqual(["b", "a"]);
  });
});

describe("removeBookmark", () => {
  it("removes only the matching id", () => {
    const bookmarks = [makeBookmark({ id: "a" }), makeBookmark({ id: "b" })];
    expect(removeBookmark(bookmarks, "a").map((b) => b.id)).toEqual(["b"]);
  });

  it("is a no-op when the id isn't found", () => {
    const bookmarks = [makeBookmark({ id: "a" })];
    expect(removeBookmark(bookmarks, "missing")).toEqual(bookmarks);
  });
});

describe("renameBookmark", () => {
  it("updates only the matching bookmark's label", () => {
    const bookmarks = [makeBookmark({ id: "a", label: "Old" }), makeBookmark({ id: "b", label: "Other" })];
    const result = renameBookmark(bookmarks, "a", "New");
    expect(result.find((b) => b.id === "a")?.label).toBe("New");
    expect(result.find((b) => b.id === "b")?.label).toBe("Other");
  });
});
