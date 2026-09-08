export type LockedSelection = {
  onDragStart: (...args: unknown[]) => boolean;
  setHandlesVisible: (visible: boolean) => void;
};

export type LockableSelectionTool = {
  getSelection: () => LockedSelection | null;
};

const originalDragStarts = new WeakMap<LockedSelection, LockedSelection["onDragStart"]>();

/** Toggle js-draw's selection transform without replacing its original handler. */
export function lockSelectionTransform(tool: LockableSelectionTool, locked = true): void {
  const selection = tool.getSelection();
  if (!selection) return;
  if (!originalDragStarts.has(selection)) originalDragStarts.set(selection, selection.onDragStart);
  selection.setHandlesVisible(!locked);
  selection.onDragStart = locked ? () => false : originalDragStarts.get(selection)!;
}
