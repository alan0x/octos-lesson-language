import test from "node:test";
import assert from "node:assert/strict";
import {
  boardKeyboardTargetsTextInput,
  isAuxiliaryPanButton,
} from "../src/input-routing.js";

const element = (tagName: string, attributes: Record<string, string> = {}) => ({
  tagName,
  getAttribute: (name: string) => attributes[name] ?? null,
});

test("middle and right buttons are auxiliary pan buttons, primary is not", () => {
  assert.equal(isAuxiliaryPanButton(0), false);
  assert.equal(isAuxiliaryPanButton(1), true);
  assert.equal(isAuxiliaryPanButton(2), true);
  assert.equal(isAuxiliaryPanButton(3), false);
});

test("space-pan ignores text entry targets only", () => {
  assert.equal(boardKeyboardTargetsTextInput(element("INPUT")), true);
  assert.equal(boardKeyboardTargetsTextInput(element("textarea")), true);
  assert.equal(boardKeyboardTargetsTextInput(element("SELECT")), true);
  assert.equal(boardKeyboardTargetsTextInput(element("DIV", { contenteditable: "true" })), true);
  // Buttons and links keep space-pan available; the keydown is
  // preventDefaulted so the focused control is not re-triggered.
  assert.equal(boardKeyboardTargetsTextInput(element("BUTTON")), false);
  assert.equal(boardKeyboardTargetsTextInput(element("A")), false);
  assert.equal(boardKeyboardTargetsTextInput(element("BODY")), false);
  assert.equal(boardKeyboardTargetsTextInput(null), false);
  assert.equal(boardKeyboardTargetsTextInput(undefined), false);
});
