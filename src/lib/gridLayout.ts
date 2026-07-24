// Feature 5 (Grid Layout): pick a column count that keeps the grid roughly
// square — 2 clips side-by-side, 3-4 in a near-square block, more wrapping
// responsively. Row count follows from CSS grid auto-flow, so we only need
// to decide columns.
export function computeGridColumns(clipCount: number): number {
  if (clipCount <= 1) return 1;
  return Math.ceil(Math.sqrt(clipCount));
}
