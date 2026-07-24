// Pure logic behind the focus/dynamic view modes: which clips are "main"
// tiles vs. sidebar thumbnails, and how drag-and-drop moves clips between
// those roles. focus1/focus2 have a fixed main-tile count; "dynamic" lets
// the user put any number of clips in the main grid.
import type { ViewMode } from "../types/project";

// focus1/focus2 always show exactly this many main clips, backfilling from
// `clips` if the request doesn't have enough. grid/dynamic have no fixed
// count — grid never has a "main" selection, and dynamic's count is
// whatever the user has dragged in, so both just fall through untouched.
const FIXED_FOCUS_COUNT: Partial<Record<ViewMode, number>> = {
  focus1: 1,
  focus2: 2,
};

/**
 * Returns a valid focusedClipIds array for the given mode: only ids that
 * exist among `clips`, no duplicates. For focus1/focus2 this also enforces
 * the exact required length, backfilling from `clips` in gridPosition
 * order so switching into a focus mode (or loading a project saved with
 * different clips) always ends up with a sensible, non-empty selection.
 * For "dynamic" the count is user-controlled, so only invalid/duplicate
 * ids are stripped — an empty or partial selection is left as-is.
 */
export function resolveFocusedClipIds(
  clips: { id: string; gridPosition: number }[],
  viewMode: ViewMode,
  requested: string[],
): string[] {
  if (viewMode === "grid") return [];

  const validIds = new Set(clips.map((c) => c.id));
  const deduped = [...new Set(requested)].filter((id) => validIds.has(id));

  const requiredCount = FIXED_FOCUS_COUNT[viewMode];
  if (requiredCount === undefined) return deduped; // "dynamic": no fixed count

  const orderedIds = [...clips].sort((a, b) => a.gridPosition - b.gridPosition).map((c) => c.id);
  for (const id of orderedIds) {
    if (deduped.length >= requiredCount) break;
    if (!deduped.includes(id)) deduped.push(id);
  }

  return deduped.slice(0, requiredCount);
}

/**
 * Swaps `a` and `b` wherever they appear in focusedClipIds. This single
 * operation covers every drag-and-drop case in focus mode:
 *  - both already focused (in a 2-up layout) -> swaps which slot each is in
 *  - one focused, one a thumbnail -> the thumbnail replaces it in that slot
 *    (works symmetrically regardless of which one was dragged)
 * A no-op if neither id is currently focused (that's a thumbnail reorder,
 * handled separately by reorderClips).
 */
export function swapFocusedClipId(focusedClipIds: string[], a: string, b: string): string[] {
  return focusedClipIds.map((id) => (id === a ? b : id === b ? a : id));
}
