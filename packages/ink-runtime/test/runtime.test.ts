import test from "node:test";
import assert from "node:assert/strict";
import { inkInputTargetsInteractiveUi } from "../src/input-routing.js";
import { coalesceInkOccupiedBounds } from "../src/occupied-bounds.js";
import { restrictSelectionToTranslation } from "../src/selection-lock.js";
import {
  planInkWorldLayerBounds,
  viewportPointToInkSurface,
} from "../src/world-layer.js";

test("selection keeps native dragging but disables hidden transform handles", () => {
  let handlesVisible = true;
  const widgets = [
    { presentation: { action: "resize-x" }, containsPoint: () => true },
    { presentation: { action: "rotate" }, containsPoint: () => true },
    { containsPoint: () => true },
  ];
  const selection = {
    childwidgets: widgets,
    setHandlesVisible(visible: boolean) { handlesVisible = visible; },
  };
  const tool = { getSelection: () => selection };

  restrictSelectionToTranslation(tool);
  restrictSelectionToTranslation(tool);

  assert.equal(handlesVisible, false);
  assert.equal(widgets[0].containsPoint(), false);
  assert.equal(widgets[1].containsPoint(), false);
  assert.equal(widgets[2].containsPoint(), true);
});

test("translation restriction is a no-op without a selection", () => {
  assert.doesNotThrow(() => restrictSelectionToTranslation({ getSelection: () => null }));
});

function inputElement(
  tagName: string,
  attributes: Record<string, string> = {},
): {
  tagName: string;
  getAttribute: (name: string) => string | null;
} {
  return {
    tagName,
    getAttribute: (name) => attributes[name] ?? null,
  };
}

test("ink leaves native controls usable while a drawing tool owns the board", () => {
  for (const tagName of ["button", "input", "select", "textarea", "a"]) {
    assert.equal(
      inkInputTargetsInteractiveUi([inputElement(tagName), {}]),
      true,
      `${tagName} input must not become an ink stroke`,
    );
  }
});

test("a host can exclude an entire interactive board overlay from ink input", () => {
  assert.equal(
    inkInputTargetsInteractiveUi([
      inputElement("canvas"),
      inputElement("article", { "data-oll-ink-input": "ignore" }),
      {},
    ]),
    true,
  );
  assert.equal(
    inkInputTargetsInteractiveUi([
      inputElement("div", { contenteditable: "true" }),
      {},
    ]),
    true,
  );
});

test("ordinary board space remains owned by the active ink tool", () => {
  assert.equal(
    inkInputTargetsInteractiveUi([inputElement("svg"), inputElement("div"), {}]),
    false,
  );
});

test("distant handwriting remains separate occupied space without splitting the SVG", () => {
  assert.deepEqual(coalesceInkOccupiedBounds([
    { x: 10, y: 20, width: 30, height: 20 },
    { x: 48, y: 18, width: 25, height: 24 },
    { x: 600, y: 80, width: 40, height: 50 },
  ]), [
    { x: 10, y: 18, width: 63, height: 24 },
    { x: 600, y: 80, width: 40, height: 50 },
  ]);
});

test("ink surface covers visible board space beyond the original world boundary", () => {
  const camera = { panX: 210, panY: 134, scale: .77 };
  const viewport = { width: 1815, height: 1343 };
  const bounds = planInkWorldLayerBounds({ camera, viewport });
  const topLeft = viewportPointToInkSurface({ x: 0, y: 0 }, camera, bounds);
  const bottomRight = viewportPointToInkSurface(
    { x: viewport.width, y: viewport.height },
    camera,
    bounds,
  );

  assert.ok(bounds.left < 0, "the layer must cover negative board coordinates");
  assert.ok(topLeft.x > 0 && topLeft.y > 0);
  assert.ok(bottomRight.x < bounds.width && bottomRight.y < bounds.height);
});

test("ink surface keeps its bounds while the visible camera remains in its buffer", () => {
  const viewport = { width: 1200, height: 800 };
  const initial = planInkWorldLayerBounds({
    camera: { panX: 80, panY: 60, scale: .8 },
    viewport,
  });
  const retained = planInkWorldLayerBounds({
    camera: { panX: 160, panY: 110, scale: .8 },
    viewport,
    current: initial,
  });

  assert.equal(retained, initial);
});
