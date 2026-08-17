export type LockedSelection = {
  onDragStart: (...args: unknown[]) => boolean;
  setHandlesVisible: (visible: boolean) => void;
};

export type LockableSelectionTool = {
  getSelection: () => LockedSelection | null;
};

/**
 * Rectangle selection is identification only. Moving/resizing ink will get an
 * explicit Octos interaction later; the stock js-draw selection background and
 * handles must not silently transform student work.
 */
export function lockSelectionTransform(tool: LockableSelectionTool): void {
  const selection = tool.getSelection();
  if (!selection) return;
  selection.setHandlesVisible(false);
  selection.onDragStart = () => false;
}
