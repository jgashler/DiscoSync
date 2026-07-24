import { describe, expect, it } from "vitest";
import { parseProjectSession, serializeProjectSession } from "./session";
import type { Bookmark, PlaybackSnapshot, VideoClip } from "../types/project";

function makePlayback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    lastPositionSeconds: 42.5,
    playbackSpeed: 1,
    loopRegion: null,
    loopEnabled: false,
    zoomByClip: {},
    ...overrides,
  };
}

function makeClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: "a",
    filePath: "C:\\videos\\a.mp4",
    fileName: "a.mp4",
    description: "",
    startTimeOfDay: "10:00:00",
    durationSeconds: 120,
    frameRate: 30,
    metadataError: null,
    syncOffsetSeconds: 0,
    manualOffsetSeconds: 0.5,
    muted: false,
    volume: 0.8,
    gridPosition: 0,
    ...overrides,
  };
}

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return { id: "bm-1", timeOfDaySeconds: 36042, fallbackTimeSeconds: 42, label: "Incident starts here", ...overrides };
}

describe("serializeProjectSession / parseProjectSession round trip", () => {
  it("round-trips a session with clips, defaulting to grid view and no bookmarks", () => {
    const clips = [makeClip(), makeClip({ id: "b", fileName: "b.mp4" })];
    const raw = serializeProjectSession("Case 123", clips);
    const parsed = parseProjectSession(raw);
    expect(parsed).toEqual({
      version: 1,
      name: "Case 123",
      clips,
      viewMode: "grid",
      focusedClipIds: [],
      bookmarks: [],
    });
  });

  it("round-trips a session with no clips", () => {
    const raw = serializeProjectSession("Empty", []);
    const parsed = parseProjectSession(raw);
    expect(parsed).toEqual({
      version: 1,
      name: "Empty",
      clips: [],
      viewMode: "grid",
      focusedClipIds: [],
      bookmarks: [],
    });
  });

  it("round-trips a focus2 view mode with focused clip ids", () => {
    const clips = [makeClip(), makeClip({ id: "b" }), makeClip({ id: "c" })];
    const raw = serializeProjectSession("Case", clips, "focus2", ["b", "c"]);
    const parsed = parseProjectSession(raw);
    expect(parsed).toEqual({
      version: 1,
      name: "Case",
      clips,
      viewMode: "focus2",
      focusedClipIds: ["b", "c"],
      bookmarks: [],
    });
  });

  it("round-trips a clip description", () => {
    const clips = [makeClip({ description: "Front door camera" })];
    const raw = serializeProjectSession("Case", clips);
    expect(parseProjectSession(raw)).toEqual({
      version: 1,
      name: "Case",
      clips,
      viewMode: "grid",
      focusedClipIds: [],
      bookmarks: [],
    });
  });

  it("round-trips bookmarks", () => {
    const clips = [makeClip()];
    const bookmarks = [
      makeBookmark(),
      makeBookmark({ id: "bm-2", timeOfDaySeconds: 36090, fallbackTimeSeconds: 90, label: "Second angle arrives" }),
    ];
    const raw = serializeProjectSession("Case", clips, "grid", [], bookmarks);
    const parsed = parseProjectSession(raw);
    expect(parsed).toEqual({
      version: 1,
      name: "Case",
      clips,
      viewMode: "grid",
      focusedClipIds: [],
      bookmarks,
    });
  });

  it("round-trips a playback snapshot: position, speed, loop, and per-clip zoom", () => {
    const clips = [makeClip()];
    const playback = makePlayback({
      lastPositionSeconds: 12.3,
      playbackSpeed: "crawl",
      loopRegion: { start: 5, end: 20 },
      loopEnabled: true,
      zoomByClip: { a: { enabled: true, center: { x: 0.4, y: 0.6 }, level: 3 } },
    });
    const raw = serializeProjectSession("Case", clips, "grid", [], [], playback);
    const parsed = parseProjectSession(raw);
    expect(parsed).toEqual({
      version: 1,
      name: "Case",
      clips,
      viewMode: "grid",
      focusedClipIds: [],
      bookmarks: [],
      playback,
    });
  });
});

describe("parseProjectSession backward compatibility", () => {
  it("accepts a file saved before viewMode/focusedClipIds/bookmarks existed", () => {
    const raw = JSON.stringify({ version: 1, name: "Old", clips: [makeClip()] });
    expect(parseProjectSession(raw)).toEqual({ version: 1, name: "Old", clips: [makeClip()] });
  });

  it("accepts a file saved before bookmarks existed but after viewMode/focusedClipIds", () => {
    const raw = JSON.stringify({
      version: 1,
      name: "Old",
      clips: [makeClip()],
      viewMode: "focus1",
      focusedClipIds: ["a"],
    });
    expect(parseProjectSession(raw)).toEqual({
      version: 1,
      name: "Old",
      clips: [makeClip()],
      viewMode: "focus1",
      focusedClipIds: ["a"],
    });
  });

  it("accepts a clip saved before descriptions existed", () => {
    const oldClip: Partial<VideoClip> = makeClip();
    delete oldClip.description;
    const raw = JSON.stringify({ version: 1, name: "Old", clips: [oldClip] });
    expect(parseProjectSession(raw)).toEqual({ version: 1, name: "Old", clips: [oldClip] });
  });

  it("rejects a clip with a description of the wrong type", () => {
    const badClip = { ...makeClip(), description: 42 };
    const raw = JSON.stringify({ version: 1, name: "x", clips: [badClip] });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects an invalid viewMode value", () => {
    const raw = JSON.stringify({ version: 1, name: "x", clips: [], viewMode: "triple" });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects focusedClipIds that isn't an array of strings", () => {
    const raw = JSON.stringify({ version: 1, name: "x", clips: [], focusedClipIds: [1, 2] });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects bookmarks that isn't an array", () => {
    const raw = JSON.stringify({ version: 1, name: "x", clips: [], bookmarks: "nope" });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects a bookmark missing required fields", () => {
    const raw = JSON.stringify({ version: 1, name: "x", clips: [], bookmarks: [{ id: "a" }] });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects a bookmark with the wrong field types", () => {
    const badBookmark = { ...makeBookmark(), fallbackTimeSeconds: "42" };
    const raw = JSON.stringify({ version: 1, name: "x", clips: [], bookmarks: [badBookmark] });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("migrates a bookmark saved before real time-of-day anchoring existed", () => {
    // Older saves only had a raw `timeSeconds`, relative to whichever clip
    // anchored the timeline at save time. That anchor isn't recoverable,
    // so it's migrated to the fallback-only shape rather than a real
    // time-of-day.
    const oldBookmark = { id: "bm-1", timeSeconds: 42, label: "Incident starts here" };
    const raw = JSON.stringify({ version: 1, name: "Old", clips: [], bookmarks: [oldBookmark] });
    expect(parseProjectSession(raw)).toEqual({
      version: 1,
      name: "Old",
      clips: [],
      bookmarks: [{ id: "bm-1", timeOfDaySeconds: null, fallbackTimeSeconds: 42, label: "Incident starts here" }],
    });
  });

  it("accepts a file saved before playback state existed", () => {
    const raw = JSON.stringify({
      version: 1,
      name: "Old",
      clips: [makeClip()],
      viewMode: "grid",
      focusedClipIds: [],
      bookmarks: [],
    });
    expect(parseProjectSession(raw)).toEqual({
      version: 1,
      name: "Old",
      clips: [makeClip()],
      viewMode: "grid",
      focusedClipIds: [],
      bookmarks: [],
    });
  });

  it("rejects a playback snapshot missing required fields", () => {
    const raw = JSON.stringify({ version: 1, name: "x", clips: [], playback: { lastPositionSeconds: 1 } });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects a playback snapshot with an invalid loopRegion", () => {
    const raw = JSON.stringify({
      version: 1,
      name: "x",
      clips: [],
      playback: makePlayback({ loopRegion: { start: 1 } as never }),
    });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects a playback snapshot with a malformed zoomByClip entry", () => {
    const raw = JSON.stringify({
      version: 1,
      name: "x",
      clips: [],
      playback: makePlayback({ zoomByClip: { a: { enabled: true, level: 2 } as never } }),
    });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects a playback snapshot with an invalid playbackSpeed", () => {
    const raw = JSON.stringify({
      version: 1,
      name: "x",
      clips: [],
      playback: makePlayback({ playbackSpeed: "fast" as never }),
    });
    expect(parseProjectSession(raw)).toBeNull();
  });
});

describe("parseProjectSession validation", () => {
  it("rejects invalid JSON", () => {
    expect(parseProjectSession("not json")).toBeNull();
  });

  it("rejects a wrong version", () => {
    const raw = JSON.stringify({ version: 2, name: "x", clips: [] });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects a missing name", () => {
    const raw = JSON.stringify({ version: 1, clips: [] });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects clips that aren't an array", () => {
    const raw = JSON.stringify({ version: 1, name: "x", clips: "nope" });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects a clip missing required fields", () => {
    const raw = JSON.stringify({ version: 1, name: "x", clips: [{ id: "a" }] });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("rejects a clip with the wrong field types", () => {
    const badClip = { ...makeClip(), muted: "yes" };
    const raw = JSON.stringify({ version: 1, name: "x", clips: [badClip] });
    expect(parseProjectSession(raw)).toBeNull();
  });

  it("accepts null durationSeconds/frameRate/metadataError", () => {
    const clip = makeClip({ durationSeconds: null, frameRate: null, metadataError: "oops" });
    const raw = serializeProjectSession("x", [clip]);
    expect(parseProjectSession(raw)).toEqual({
      version: 1,
      name: "x",
      clips: [clip],
      viewMode: "grid",
      focusedClipIds: [],
      bookmarks: [],
    });
  });

  it("rejects a bare array with no wrapper object", () => {
    expect(parseProjectSession(JSON.stringify([makeClip()]))).toBeNull();
  });

  it("rejects null", () => {
    expect(parseProjectSession("null")).toBeNull();
  });
});
