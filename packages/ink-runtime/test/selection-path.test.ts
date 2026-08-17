import test from "node:test";
import assert from "node:assert/strict";
import { inkSelectionPathRegion, inkSelectionRectangleRegion } from "../src/selection-record.js";

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
