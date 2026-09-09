export type TranslationOnlySelection = {
  setHandlesVisible: (visible: boolean) => void;
  getMinCanvasSize: () => number;
  recomputeRegion: () => boolean;
  updateUI: () => void;
  childwidgets?: Array<{
    containsPoint: (point: unknown) => boolean;
    presentation?: { action?: unknown };
  }>;
};

export type SelectionToolAccess = {
  getSelection: () => TranslationOnlySelection | null;
};

const translationOnlySelections = new WeakSet<TranslationOnlySelection>();
const transformActions = new Set(["resize-x", "resize-y", "resize-xy", "rotate"]);

/** Keep js-draw's selection state machine, but make its box fit the selected ink. */
export function restrictSelectionToTranslation(tool: SelectionToolAccess): void {
  const selection = tool.getSelection();
  if (!selection) return;
  selection.setHandlesVisible(false);
  if (translationOnlySelections.has(selection)) return;

  // js-draw normally reserves 30 screen pixels on every side for transform
  // handles. Octos hides those handles and only permits translation, so that
  // padding serves no interaction purpose and makes small selections misleading.
  selection.getMinCanvasSize = () => 0;
  for (const widget of selection.childwidgets ?? []) {
    if (transformActions.has(String(widget.presentation?.action))) {
      widget.containsPoint = () => false;
    }
  }
  translationOnlySelections.add(selection);
  selection.recomputeRegion();
  selection.updateUI();
}
