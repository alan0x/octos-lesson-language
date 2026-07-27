import test from "node:test";
import assert from "node:assert/strict";
import { boundaryPoint, computeConnectionRoute, routePath, stackConnectionLabel } from "../src/connection-layout.js";
import { mathSource } from "../src/board-view.js";

test("math content resolves LaTeX from canonical forms and strips display delimiters", () => {
  assert.equal(mathSource({ expression: "$$x^2+6x+5$$" }), "x^2+6x+5");
  assert.equal(mathSource({ statement: "\\[\\triangle ABD\\cong\\triangle ACD\\]" }), "\\triangle ABD\\cong\\triangle ACD");
  assert.equal(mathSource({ fragments: [{ latex: "x^2" }, { latex: "6x" }] }), "x^2 6x");
});

test("connections attach to card boundaries instead of running through card centers", () => {
  const from = { x: 40, y: 80, width: 260, height: 180 };
  const to = { x: 350, y: 80, width: 420, height: 220 };
  const edge = boundaryPoint(from, { x: 560, y: 190 });
  assert.equal(edge.x, 300);
  assert.ok(edge.y > from.y && edge.y < from.y + from.height);
  const route = computeConnectionRoute(from, to, "去掉无关视觉信息");
  assert.equal(route.start.x, 300);
  assert.equal(route.end.x, 350);
  assert.ok(route.label.y < from.y, "narrow-gap label should be routed above both cards");
  assert.match(routePath(route), /^M .+ C .+/);
});

test("diagram fragment connections keep their endpoints inside the diagram", () => {
  const pointA = { x: 186, y: 104, width: 8, height: 8 };
  const pointD = { x: 186, y: 238, width: 8, height: 8 };
  const route = computeConnectionRoute(pointA, pointD, "辅助线 AD", true);
  assert.deepEqual(route.start, { x: 190, y: 108 });
  assert.deepEqual(route.end, { x: 190, y: 242 });
});

test("connection labels stack instead of covering one another", () => {
  const from = { x: 40, y: 80, width: 260, height: 120 };
  const to = { x: 340, y: 80, width: 320, height: 120 };
  const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
  const first = stackConnectionLabel(computeConnectionRoute(from, to, "对应角相等"), occupied);
  const second = stackConnectionLabel(computeConnectionRoute(from, to, "对应角相等且构成平角"), occupied);
  assert.ok(second.label.y < first.label.y);
  assert.notEqual(routePath(first), routePath(second));
});
