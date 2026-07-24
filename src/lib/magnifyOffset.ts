// Corrective translate for one axis of a center-scaled magnified tile, so
// it stays within [minBound, maxBound]. A naive if/(else if) check against
// each edge only ever corrects one side — if the scaled size is
// taller/wider than the available space, "pull the top in" and "push the
// bottom in" can't both be satisfied, and whichever check ran first wins,
// leaving the other edge hanging off-screen. This clamps the actual
// position instead, and falls back to centering (accepting equal overflow
// on both edges) when the tile genuinely can't fit either way.
export function clampAxisOffset(
  center: number,
  scaledSize: number,
  minBound: number,
  maxBound: number,
): number {
  const desiredStart = center - scaledSize / 2;
  const availableSize = maxBound - minBound;

  const clampedStart =
    scaledSize <= availableSize
      ? Math.min(Math.max(desiredStart, minBound), maxBound - scaledSize)
      : minBound - (scaledSize - availableSize) / 2;

  return clampedStart - desiredStart;
}

// The nearest-ancestor clipping rectangle for an element: the intersection
// of the viewport with every ancestor that actually clips content (any
// non-"visible" overflow), walking up to <body>. A magnified tile sits
// inside a scrollable review area that stops above the fixed transport bar
// at the bottom of the screen — clamping against window.innerHeight alone
// lets the tile grow into that reserved strip, where it gets visually
// clipped by the scroll container and needs scrolling to see. Clamping
// against this tighter bound keeps it fully visible without scrolling.
export function getClipBounds(el: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;

  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      const rect = node.getBoundingClientRect();
      left = Math.max(left, rect.left);
      top = Math.max(top, rect.top);
      right = Math.min(right, rect.right);
      bottom = Math.min(bottom, rect.bottom);
    }
    node = node.parentElement;
  }

  return { left, top, right, bottom };
}
