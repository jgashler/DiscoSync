// Feature 5 (drag-and-drop grid rearrange): moves the dragged clip into the
// dropped-on clip's slot and renumbers gridPosition to match the new order.
// Kept generic over just {id, gridPosition} so it's trivial to unit test
// without constructing full VideoClip fixtures.
export function reorderClips<T extends { id: string; gridPosition: number }>(
  clips: T[],
  draggedId: string,
  targetId: string,
): T[] {
  if (draggedId === targetId) return clips;

  const ordered = [...clips].sort((a, b) => a.gridPosition - b.gridPosition);
  const fromIndex = ordered.findIndex((c) => c.id === draggedId);
  const toIndex = ordered.findIndex((c) => c.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return clips;

  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);

  return ordered.map((c, i) => (c.gridPosition === i ? c : { ...c, gridPosition: i }));
}
