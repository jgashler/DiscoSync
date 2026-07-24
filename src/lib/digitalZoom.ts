// Digital zoom into a single focused clip's frame (distinct from the
// hover-magnify on VideoTile, which scales the whole tile without cropping).
// The zoom region is always locked to the video's own aspect ratio — a
// single "level" (how far in) plus a "center" (where), rather than a
// free-form rectangle — so zooming never stretches the image, and
// "expand/contract" is just one number to reason about.

export const MIN_ZOOM_LEVEL = 1;
export const MAX_ZOOM_LEVEL = 8;

export function clampZoomLevel(level: number): number {
  return Math.min(Math.max(level, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL);
}

export interface ZoomCenter {
  x: number;
  y: number;
}

// Keeps the zoom region (size 1/level, centered on `center`) inside the
// [0,1] frame. At level 1 the region *is* the whole frame, so the only
// valid center is the exact middle.
export function clampZoomCenter(center: ZoomCenter, level: number): ZoomCenter {
  const half = 1 / level / 2;
  const clampAxis = (v: number) => (half >= 0.5 ? 0.5 : Math.min(Math.max(v, half), 1 - half));
  return { x: clampAxis(center.x), y: clampAxis(center.y) };
}

export interface ZoomRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The video-content-normalized rect ([0,1] within the actual frame,
// independent of any letterboxing) currently zoomed into.
export function computeZoomRegion(center: ZoomCenter, level: number): ZoomRegion {
  const clamped = clampZoomCenter(center, level);
  const size = 1 / level;
  return { x: clamped.x - size / 2, y: clamped.y - size / 2, width: size, height: size };
}

export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// object-contain letterboxes a video whose native aspect ratio doesn't
// match its element box — this is the rect (element-box-normalized) the
// video's actual pixels occupy, needed to translate a content-space zoom
// region into a transform on the element itself.
export function computeContentRect(elementAspect: number, videoAspect: number): ContentRect {
  if (!Number.isFinite(elementAspect) || !Number.isFinite(videoAspect) || elementAspect <= 0 || videoAspect <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  if (videoAspect > elementAspect) {
    // Video is relatively wider than its box: full width, letterboxed top/bottom.
    const height = elementAspect / videoAspect;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  // Video is relatively taller than (or equal to) its box: full height, letterboxed left/right.
  const width = videoAspect / elementAspect;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}

export interface VideoTransform {
  scale: number;
  translateXPercent: number;
  translateYPercent: number;
}

// The transform to apply to the <video> element (transform-origin 0 0) so
// the cropped `region` (content-normalized) renders in place of the full
// frame. Since `region` is always square in content-space, the cropped
// sub-image has the same aspect ratio as the full frame — so it letterboxes
// into the *same* on-screen rect {content.x, content.y, content.width,
// content.height} the full, unzoomed frame already occupies. That's what
// keeps level 1 an exact identity transform (no crop) rather than stretching
// the video to fill the element box and erasing the letterbox.
export function computeVideoTransform(content: ContentRect, region: ZoomRegion): VideoTransform {
  const elX = content.x + region.x * content.width;
  const elY = content.y + region.y * content.height;

  const scale = region.width > 0 ? 1 / region.width : 1;

  return {
    scale,
    translateXPercent: (content.x - scale * elX) * 100,
    translateYPercent: (content.y - scale * elY) * 100,
  };
}
