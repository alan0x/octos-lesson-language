import test from "node:test";
import assert from "node:assert/strict";
import {
  inkSelectionPathRegion,
  inkSelectionRectangleRegion,
  inkSelectionRegionContainsPoint,
} from "../src/selection-record.js";
import {
  ensurePersistentInkComponentIds,
  hasPersistentInkComponentId,
} from "../src/component-identity.js";

test("selection component identities survive SVG attribute round trips", () => {
  type Component = Parameters<typeof ensurePersistentInkComponentIds>[0][number];
  const loadSaveData: Record<string, string[][]> = {};
  const component = {
    getLoadSaveData: () => loadSaveData,
    attachLoadSaveData: (key: string, data: string[]) => {
      (loadSaveData[key] ??= []).push(data);
    },
  } as unknown as Component;

  const first = ensurePersistentInkComponentIds([component])[0]!;
  const second = ensurePersistentInkComponentIds([component])[0]!;

  assert.equal(first, second);
  assert.equal(hasPersistentInkComponentId(component, first), true);
  assert.match(first, /^octos-ink-component:/);
});

test("rectangle selections persist the rectangle shown by the selection tool", () => {
  assert.deepEqual(inkSelectionRectangleRegion([
    { x: 80, y: 70 },
    { x: 20, y: 10 },
  ]), {
    kind: "rectangle",
    closed: true,
    points: [
      { x: 20, y: 10 },
      { x: 80, y: 10 },
      { x: 80, y: 70 },
      { x: 20, y: 70 },
    ],
  });
});

test("selection movement starts only inside the region the learner drew", () => {
  const rectangle = inkSelectionRectangleRegion([
    { x: 10, y: 20 },
    { x: 90, y: 80 },
  ])!;
  assert.equal(inkSelectionRegionContainsPoint(rectangle, { x: 50, y: 50 }), true);
  assert.equal(inkSelectionRegionContainsPoint(rectangle, { x: 10, y: 40 }), true);
  assert.equal(inkSelectionRegionContainsPoint(rectangle, { x: 100, y: 50 }), false);

  const lasso = inkSelectionPathRegion([
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 20, y: 70 },
    { x: 0, y: 0 },
  ])!;
  assert.equal(inkSelectionRegionContainsPoint(lasso, { x: 20, y: 20 }), true);
  assert.equal(inkSelectionRegionContainsPoint(lasso, { x: 70, y: 50 }), false);
});

test("selection snapshots preserve the learner's lasso instead of replacing it with a rectangle", () => {
  const points = [
    { x: 10, y: 10 },
    { x: 60, y: 12 },
    { x: 80, y: 40 },
    { x: 55, y: 75 },
    { x: 12, y: 65 },
  ];
  assert.deepEqual(inkSelectionPathRegion(points), {
    kind: "path",
    closed: true,
    points,
  });
});

test("selection lasso persistence is bounded without losing its final point", () => {
  const points = Array.from({ length: 1_200 }, (_value, index) => ({
    x: index,
    y: Math.sin(index / 20),
  }));
  const region = inkSelectionPathRegion(points);
  assert.ok(region);
  assert.ok(region.points.length <= 512);
  assert.deepEqual(region.points.at(-1), points.at(-1));
});
