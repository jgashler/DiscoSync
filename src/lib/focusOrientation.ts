// Focus-two mode can lay its two main videos out side-by-side (row) or
// stacked (column). Whichever wastes less space to letterboxing/pillarboxing
// depends on the container's own proportions relative to the video's aspect
// ratio — there's no fixed "wide screen = row" rule that holds at every
// window size, so this compares the actual rendered video area each way.
const DEFAULT_ASPECT_RATIO = 16 / 9;

function renderedArea(boxWidth: number, boxHeight: number, aspectRatio: number): number {
  if (boxWidth <= 0 || boxHeight <= 0) return 0;
  // object-contain: fit the video into the box without cropping, so
  // whichever dimension is relatively tighter constrains the other.
  const width = boxWidth / boxHeight > aspectRatio ? boxHeight * aspectRatio : boxWidth;
  const height = boxWidth / boxHeight > aspectRatio ? boxHeight : boxWidth / aspectRatio;
  return width * height;
}

export function chooseFocusTwoOrientation(
  containerWidth: number,
  containerHeight: number,
  aspectRatio: number = DEFAULT_ASPECT_RATIO,
): "row" | "column" {
  if (containerWidth <= 0 || containerHeight <= 0) return "row";

  // Two boxes side by side, each half the width and the full height.
  const rowArea = renderedArea(containerWidth / 2, containerHeight, aspectRatio);
  // Two boxes stacked, each the full width and half the height.
  const columnArea = renderedArea(containerWidth, containerHeight / 2, aspectRatio);

  return rowArea >= columnArea ? "row" : "column";
}
