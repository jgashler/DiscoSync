import { describe, expect, it } from "vitest";
import { addBookmark, bookmarkTimelineSeconds, removeBookmark, renameBookmark, sortBookmarks } from "./bookmarks";
import type { Bookmark } from "../types/project";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return { id: "a", timeOfDaySeconds: null, fallbackTimeSeconds: 10, label: "Marker", ...overrides };
}

describe("bookmarkTimelineSeconds", () => {
  it("derives the current timeline position from the anchor and a real time-of-day", () => {
    // Anchor clip starts at 14:00:00 (50400s); bookmark is at 14:00:10.
    const bookmark = makeBookmark({ timeOfDaySeconds: 50410, fallbackTimeSeconds: 999 });
    expect(bookmarkTimelineSeconds(bookmark, 50400)).toBe(10);
  });

  it("tracks the same real moment even after the anchor changes", () => {
    const bookmark = makeBookmark({ timeOfDaySeconds: 50410 });
    // A clip starting 100s earlier becomes the new anchor — the bookmark's
    // position on the timeline shifts to match, rather than staying at 10.
    expect(bookmarkTimelineSeconds(bookmark, 50300)).toBe(110);
  });

  it("handles midnight wraparound via circularOffsetSeconds", () => {
    const bookmark = makeBookmark({ timeOfDaySeconds: 3 }); // 00:00:03
    expect(bookmarkTimelineSeconds(bookmark, 86397)).toBe(6); // anchor 23:59:57
  });

  it("falls back to fallbackTimeSeconds when timeOfDaySeconds is null", () => {
    const bookmark = makeBookmark({ timeOfDaySeconds: null, fallbackTimeSeconds: 42 });
    expect(bookmarkTimelineSeconds(bookmark, 50400)).toBe(42);
  });

  it("falls back to fallbackTimeSeconds when there's no anchor available", () => {
    const bookmark = makeBookmark({ timeOfDaySeconds: 50410, fallbackTimeSeconds: 42 });
    expect(bookmarkTimelineSeconds(bookmark, null)).toBe(42);
  });
});

describe("sortBookmarks", () => {
  it("sorts ascending by derived timeline position", () => {
    const bookmarks = [
      makeBookmark({ id: "c", timeOfDaySeconds: 30 }),
      makeBookmark({ id: "a", timeOfDaySeconds: 10 }),
      makeBookmark({ id: "b", timeOfDaySeconds: 20 }),
    ];
    expect(sortBookmarks(bookmarks, 0).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("doesn't mutate the input array", () => {
    const bookmarks = [makeBookmark({ id: "b", timeOfDaySeconds: 20 }), makeBookmark({ id: "a", timeOfDaySeconds: 10 })];
    const original = [...bookmarks];
    sortBookmarks(bookmarks, 0);
    expect(bookmarks).toEqual(original);
  });
});

describe("addBookmark", () => {
  it("appends the bookmark", () => {
    const existing = [makeBookmark({ id: "a" })];
    const result = addBookmark(existing, makeBookmark({ id: "b" }));
    expect(result.map((b) => b.id)).toEqual(["a", "b"]);
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
