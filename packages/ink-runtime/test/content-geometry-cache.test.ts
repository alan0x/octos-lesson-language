import assert from "node:assert/strict";
import test from "node:test";
import type { AbstractComponent } from "js-draw";

import { InkContentGeometryCache } from "../src/content-geometry-cache.js";

function component(bounds: { x: number; y: number; width: number; height: number }, selectable = true) {
  let reads = 0;
  return {
    value: {
      isSelectable: () => selectable,
      getExactBBox: () => {
        reads += 1;
        return bounds;
      },
    } as AbstractComponent,
    reads: () => reads,
  };
}

test("content geometry is reused for non-content state notifications", () => {
  const stroke = component({ x: 10, y: 20, width: 30, height: 40 });
  const cache = new InkContentGeometryCache();
  const first = cache.read(4, [stroke.value]);
  const second = cache.read(4, [stroke.value]);

  assert.equal(second, first);
  assert.equal(stroke.reads(), 1);
  assert.deepEqual(first.content_bounds, {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
});

test("a new content revision recomputes selectable components once", () => {
  const first = component({ x: 0, y: 0, width: 10, height: 10 });
  const second = component({ x: 20, y: 0, width: 10, height: 10 });
  const overlay = component({ x: 0, y: 0, width: 100, height: 100 }, false);
  const cache = new InkContentGeometryCache();

  cache.read(1, [first.value]);
  const updated = cache.read(2, [first.value, second.value, overlay.value]);

  assert.equal(updated.component_count, 2);
  assert.equal(first.reads(), 2);
  assert.equal(second.reads(), 1);
  assert.equal(overlay.reads(), 0);
});
