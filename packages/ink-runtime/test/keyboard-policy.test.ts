import test from "node:test";
import assert from "node:assert/strict";
import {
  INK_DISABLED_SHORTCUT_IDS,
  applyInkKeyboardPolicy,
  type KeyboardPolicyEditorAccess,
  type KeyboardPolicyToolType,
} from "../src/keyboard-policy.js";

function fakeEditor(toolsByType: ReadonlyMap<unknown, Array<{ setEnabled: (enabled: boolean) => void }>>): {
  editor: KeyboardPolicyEditorAccess;
  overrides: Array<{ id: string; bindings: unknown[] }>;
  requestedTypes: unknown[];
} {
  const overrides: Array<{ id: string; bindings: unknown[] }> = [];
  const requestedTypes: unknown[] = [];
  const editor: KeyboardPolicyEditorAccess = {
    shortcuts: {
      overrideShortcut(id, bindings) { overrides.push({ id, bindings }); },
    },
    toolController: {
      getMatchingTools(type) {
        requestedTypes.push(type);
        return (toolsByType.get(type) ?? []) as never;
      },
    },
  };
  return { editor, overrides, requestedTypes };
}

function fakeToolType(name: string): KeyboardPolicyToolType {
  return { [name]: class {} }[name] as unknown as KeyboardPolicyToolType;
}

test("keyboard policy disables each backdoor shortcut with an empty binding list", () => {
  const { editor, overrides } = fakeEditor(new Map());

  applyInkKeyboardPolicy(editor, []);

  assert.deepEqual(overrides.map((override) => override.id), [...INK_DISABLED_SHORTCUT_IDS]);
  for (const override of overrides) {
    assert.deepEqual(override.bindings, [], `${override.id} must never match`);
  }
});

test("keyboard policy disables every keyboard tool it is given", () => {
  const enabledStates: Array<{ name: string; enabled: boolean }> = [];
  const fakeTool = (name: string) => ({
    setEnabled: (enabled: boolean) => { enabledStates.push({ name, enabled }); },
  });
  const toolTypes = ["UndoRedoShortcut", "ToolSwitcherShortcut", "SelectAllShortcutHandler"]
    .map(fakeToolType);
  const toolsByType = new Map(
    toolTypes.map((type) => [type, [fakeTool(type.name)]]),
  );
  const { editor, requestedTypes } = fakeEditor(toolsByType);

  applyInkKeyboardPolicy(editor, toolTypes);

  assert.deepEqual(requestedTypes, toolTypes);
  assert.deepEqual(enabledStates, [
    { name: "UndoRedoShortcut", enabled: false },
    { name: "ToolSwitcherShortcut", enabled: false },
    { name: "SelectAllShortcutHandler", enabled: false },
  ]);
});

test("keyboard policy keeps arrow-key translation shortcuts", () => {
  const disabled = INK_DISABLED_SHORTCUT_IDS as readonly string[];
  for (const id of [
    "jsdraw.tools.SelectionTool.translateLeft",
    "jsdraw.tools.SelectionTool.translateRight",
    "jsdraw.tools.SelectionTool.translateUp",
    "jsdraw.tools.SelectionTool.translateDown",
  ]) {
    assert.ok(!disabled.includes(id), `${id} must stay enabled`);
  }
});
