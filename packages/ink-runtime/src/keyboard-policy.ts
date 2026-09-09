import type { BaseTool } from "js-draw";

/**
 * js-draw keyboard shortcuts the ink layer must never act on.
 *
 * Octos restricts selection edits to translation (see selection-lock.ts), but
 * these bindings would let the keyboard rotate, scale, duplicate or restack
 * the selection anyway. Overriding a shortcut with an empty binding list makes
 * it never match, which is equivalent to disabling it.
 *
 * The IDs are js-draw internals that the package does not re-export, pinned to
 * js-draw 1.33.0 sources:
 * - tools/SelectionTool/keybindings.mjs (selection transforms, duplicate, send-to-back)
 * - tools/keybindings.mjs:13 (snap-to-grid)
 *
 * Delete/Backspace is deliberately absent: SelectionTool.mjs:341-345 hard-codes
 * deletion outside the shortcut system, so it cannot be overridden here and
 * keeps working.
 *
 * js-draw upgrade checklist — re-verify all of these on every js-draw bump:
 * - editor.shortcuts.overrideShortcut (shortcuts/KeyboardShortcutManager.mjs:23, @internal)
 * - every ID above still matches its registered default binding
 * - Delete/Backspace is still hard-coded in SelectionTool.onKeyPress
 */
export const INK_DISABLED_SHORTCUT_IDS = [
  "jsdraw.tools.SelectionTool.rotateCW",
  "jsdraw.tools.SelectionTool.rotateCCW",
  "jsdraw.tools.SelectionTool.shrink.x",
  "jsdraw.tools.SelectionTool.stretch.x",
  "jsdraw.tools.SelectionTool.shrink.y",
  "jsdraw.tools.SelectionTool.stretch.y",
  "jsdraw.tools.SelectionTool.shrink.xy",
  "jsdraw.tools.SelectionTool.stretch.xy",
  "jsdraw.tools.SelectionTool.duplicateSelection",
  "jsdraw.tools.SelectionTool.sendToBack",
  "jsdraw.tools.snapToGrid",
] as const;

export type KeyboardPolicyEditorAccess = {
  shortcuts: {
    overrideShortcut(shortcutId: string, overrideWith: unknown[]): void;
  };
  toolController: {
    getMatchingTools(type: new (...args: any[]) => BaseTool): BaseTool[];
  };
};

// Callers supply the js-draw tool classes so this module never loads js-draw
// at runtime (Node tests have no DOM).
export type KeyboardPolicyToolType = new (...args: any[]) => BaseTool;

/**
 * Disable js-draw keyboard behavior that conflicts with Octos' ink model.
 * `disabledKeyboardTools` lists tool classes to switch off entirely (see
 * runtime.ts for which ones and why).
 */
export function applyInkKeyboardPolicy(
  editor: KeyboardPolicyEditorAccess,
  disabledKeyboardTools: readonly KeyboardPolicyToolType[],
): void {
  for (const shortcutId of INK_DISABLED_SHORTCUT_IDS) {
    editor.shortcuts.overrideShortcut(shortcutId, []);
  }
  for (const toolType of disabledKeyboardTools) {
    for (const tool of editor.toolController.getMatchingTools(toolType)) {
      tool.setEnabled(false);
    }
  }
}
