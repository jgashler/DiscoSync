import { describe, expect, it } from "vitest";
import {
  clampZoomCenter,
  clampZoomLevel,
  computeContentRect,
  computeVideoTransform,
  computeZoomRegion,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
} from "./digitalZoom";
import type { ContentRect } from "./digitalZoom";

describe("clampZoomLevel", () => {
  it("clamps to the [MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL] range", () => {
    expect(clampZoomLevel(0)).toBe(MIN_ZOOM_LEVEL);
    expect(clampZoomLevel(100)).toBe(MAX_ZOOM_LEVEL);
    expect(clampZoomLevel(4)).toBe(4);
  });
});

describe("clampZoomCenter", () => {
  it("forces the exact middle when level is 1 (region is the whole frame)", () => {
    expect(clampZoomCenter({ x: 0.9, y: 0.1 }, 1)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("keeps a center that already fits unchanged", () => {
    expect(clampZoomCenter({ x: 0.5, y: 0.5 }, 4)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps a center that would push the region past the frame edge", () => {
    // level 4 -> region size 0.25 -> half 0.125 -> valid center range [0.125, 0.875]
    expect(clampZoomCenter({ x: 0, y: 1 }, 4)).toEqual({ x: 0.125, y: 0.875 });
  });
});

describe("computeZoomRegion", () => {
  it("returns the full frame at level 1", () => {
    expect(computeZoomRegion({ x: 0.5, y: 0.5 }, 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("returns a quarter-size region centered at level 2", () => {
    expect(computeZoomRegion({ x: 0.5, y: 0.5 }, 2)).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  it("clamps an out-of-range center into the region it returns", () => {
    const region = computeZoomRegion({ x: 0, y: 0 }, 2);
    expect(region.x).toBeCloseTo(0, 5);
    expect(region.y).toBeCloseTo(0, 5);
  });
});

describe("computeContentRect", () => {
  it("fills the box with no letterbox when aspect ratios match", () => {
    expect(computeContentRect(16 / 9, 16 / 9)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("letterboxes top/bottom when the video is relatively wider than its box", () => {
    // Square box, 16:9 video.
    const rect = computeContentRect(1, 16 / 9);
    expect(rect.width).toBe(1);
    expect(rect.height).toBeCloseTo(9 / 16, 5);
    expect(rect.x).toBe(0);
    expect(rect.y).toBeCloseTo((1 - 9 / 16) / 2, 5);
  });

  it("letterboxes left/right when the video is relatively taller than its box", () => {
    // Wide box, square video.
    const rect = computeContentRect(16 / 9, 1);
    expect(rect.height).toBe(1);
    expect(rect.width).toBeCloseTo(9 / 16, 5);
    expect(rect.y).toBe(0);
  });

  it("falls back to no letterbox for invalid input rather than dividing by zero", () => {
    expect(computeContentRect(0, 16 / 9)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(computeContentRect(16 / 9, NaN)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe("computeVideoTransform", () => {
  it("is an identity transform at level 1, regardless of letterboxing", () => {
    const content = computeContentRect(1, 16 / 9); // letterboxed square box
    const region = computeZoomRegion({ x: 0.5, y: 0.5 }, 1);
    const t = computeVideoTransform(content, region);
    expect(t.scale).toBeCloseTo(1, 5);
    expect(t.translateXPercent).toBeCloseTo(0, 5);
    expect(t.translateYPercent).toBeCloseTo(0, 5);
  });

  it("scales by exactly the zoom level with no letterbox", () => {
    const content: ContentRect = { x: 0, y: 0, width: 1, height: 1 };
    const region = computeZoomRegion({ x: 0.5, y: 0.5 }, 2);
    const t = computeVideoTransform(content, region);
    expect(t.scale).toBeCloseTo(2, 5);
    expect(t.translateXPercent).toBeCloseTo(-50, 5);
    expect(t.translateYPercent).toBeCloseTo(-50, 5);
  });

  it("keeps the cropped image inside the same letterboxed rect the full frame occupies", () => {
    const content = computeContentRect(1, 16 / 9); // e.g. {x:0, y:0.21875, width:1, height:0.5625}
    const region = computeZoomRegion({ x: 0.5, y: 0.5 }, 2);
    const t = computeVideoTransform(content, region);
    // The region's top-left corner, once transformed, should land exactly
    // on the content rect's top-left corner (not (0,0) of the raw element
    // box) — proving the zoomed crop still letterboxes the same way.
    const elX = content.x + region.x * content.width;
    const elY = content.y + region.y * content.height;
    const mappedX = t.scale * elX + t.translateXPercent / 100;
    const mappedY = t.scale * elY + t.translateYPercent / 100;
    expect(mappedX).toBeCloseTo(content.x, 5);
    expect(mappedY).toBeCloseTo(content.y, 5);
  });
});
