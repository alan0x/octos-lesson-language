export type LockedSelection = {
  onDragStart: (...args: unknown[]) => boolean;
  getScreenRegion: () => {
    containsPoint: (point: { x: number; y: number }) => boolean;
  };
  setHandlesVisible: (visible: boolean) => void;
};

export type LockableSelectionTool = {
  getSelection: () => LockedSelection | null;
};

const originalDragStarts = new WeakMap<LockedSelection, LockedSelection["onDragStart"]>();

/** Return whether a viewport-relative pointer is inside the selection box the
 * learner can currently see. js-draw derives this box from the selected ink,
 * so it can be larger than the rectangle or lasso that originally found it. */
export function selectionBoxContainsScreenPoint(
  tool: LockableSelectionTool,
  point: { x: number; y: number },
): boolean {
  return tool.getSelection()?.getScreenRegion().containsPoint(point) ?? false;
}

/** Toggle js-draw's selection transform without replacing its original handler. */
export function lockSelectionTransform(tool: LockableSelectionTool, locked = true): void {
  const selection = tool.getSelection();
  if (!selection) return;
  if (!originalDragStarts.has(selection)) originalDragStarts.set(selection, selection.onDragStart);
  selection.setHandlesVisible(!locked);
  selection.onDragStart = locked ? () => false : originalDragStarts.get(selection)!;
}
