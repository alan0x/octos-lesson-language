export type TranslationOnlySelection = {
  setHandlesVisible: (visible: boolean) => void;
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

/** Keep js-draw's selection state machine, but remove its hidden resize/rotate hit targets. */
export function restrictSelectionToTranslation(tool: SelectionToolAccess): void {
  const selection = tool.getSelection();
  if (!selection) return;
  selection.setHandlesVisible(false);
  if (translationOnlySelections.has(selection)) return;
  for (const widget of selection.childwidgets ?? []) {
    if (transformActions.has(String(widget.presentation?.action))) {
      widget.containsPoint = () => false;
    }
  }
  translationOnlySelections.add(selection);
}
