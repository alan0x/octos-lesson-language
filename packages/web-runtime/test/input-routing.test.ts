import test from "node:test";
import assert from "node:assert/strict";
import {
  boardKeyboardTargetsTextInput,
  boardWheelTargetsInteractiveUi,
  boardWheelTargetsNumberLine,
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

test("the wheel over a number line card goes to the line, anywhere on the card; elsewhere to the board (decision 0024)", () => {
  const card = element("ARTICLE", { class: "board-node kind-number_line", "data-kind": "number_line" });
  const svg = element("svg", { class: "number-line-preview" });
  const view = element("DIV", { class: "number-line-view" });
  // On the drawing, a zoom button and the card's title: the line takes the wheel.
  assert.equal(boardWheelTargetsNumberLine([element("line"), svg, view, card, element("DIV", { class: "layer node-layer" })]), card);
  assert.equal(boardWheelTargetsNumberLine([element("BUTTON"), element("DIV", { class: "number-line-zoom" }), view, card]), card);
  assert.equal(boardWheelTargetsNumberLine([element("DIV", { class: "node-title" }), card]), card);
  // Another card, or the board between cards: the board zooms as before.
  assert.equal(boardWheelTargetsNumberLine([element("ARTICLE", { class: "board-node kind-plot", "data-kind": "plot" })]), undefined);
  assert.equal(boardWheelTargetsNumberLine([element("DIV", { class: "world" }), element("DIV", { class: "viewport" })]), undefined);
  // Only a board card counts, not another element that says number_line.
  assert.equal(boardWheelTargetsNumberLine([element("DIV", { "data-kind": "number_line" })]), undefined);
  // The board's own check would hand the drawing to the board's zoom: the line is asked first.
  assert.equal(boardWheelTargetsInteractiveUi([element("line"), svg, view, card]), false);
});
