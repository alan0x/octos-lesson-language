import test from "node:test";
import assert from "node:assert/strict";
import { boundaryPoint, computeConnectionRoute, routePath, stackConnectionLabel } from "../src/connection-layout.js";
import { diagramConnectionGeometry, mathSource } from "../src/board-view.js";
import { planFocusCamera, planRevealCamera } from "../src/camera.js";

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

test("diagram-internal connections resolve exact fragment coordinates", () => {
  const content = {
    elements: [
      { id: "point-a", label: "A", semantic_position: "top" },
      { id: "point-d", label: "D", semantic_position: "bottom_center" },
    ],
  };
  const geometry = diagramConnectionGeometry(content, {
    label: "辅助线 AD",
    from: { node_id: "triangle", fragment_id: "point-a" },
    to: { node_id: "triangle", fragment_id: "point-d" },
  });
  assert.ok(geometry);
  assert.deepEqual(geometry.from, { x: 150, y: 24 });
  assert.deepEqual(geometry.to, { x: 150, y: 164 });
  assert.ok(geometry.labelPosition.x > geometry.from.x, "label should sit beside the segment, not on top of it");
});

test("focus keeps an already composed target steady", () => {
  const current = { panX: 141.08235294117645, panY: 200.47058823529412, scale: .9976470588235294 };
  assert.strictEqual(
    planFocusCamera(
      [{ x: 120, y: 140, width: 680, height: 120 }],
      current,
      { width: 1200, height: 800 },
      "detail",
    ),
    current,
  );
});

test("detail focus derives its zoom from target size instead of a fixed camera scale", () => {
  const current = { panX: 80, panY: 60, scale: .61 };
  const narrow = planFocusCamera(
    [{ x: 120, y: 140, width: 240, height: 120 }],
    current,
    { width: 1200, height: 800 },
    "detail",
  );
  const wide = planFocusCamera(
    [{ x: 120, y: 140, width: 900, height: 120 }],
    current,
    { width: 1200, height: 800 },
    "detail",
  );
  assert.equal(narrow.scale, 1);
  assert.ok(wide.scale > current.scale && wide.scale < narrow.scale);
});

test("focus changes scale when the target is too small or the teaching scene is too large", () => {
  const tiny = planFocusCamera(
    [{ x: 1200, y: 900, width: 500, height: 120 }],
    { panX: 0, panY: 0, scale: .2 },
    { width: 1200, height: 800 },
    "detail",
  );
  assert.equal(tiny.scale, 1);

  const large = planFocusCamera(
    [{ x: 100, y: 100, width: 1800, height: 1100 }],
    { panX: 0, panY: 0, scale: .78 },
    { width: 1200, height: 800 },
    "overview",
  );
  assert.ok(large.scale < .78);
});

test("relationship focus composes all declared targets as one attention scene", () => {
  const focused = planFocusCamera(
    [
      { x: 100, y: 120, width: 420, height: 180 },
      { x: 620, y: 120, width: 420, height: 180 },
    ],
    { panX: 0, panY: 0, scale: .35 },
    { width: 1200, height: 800 },
    "relationship",
  );
  assert.ok(focused.scale > .35);
  const sceneCenterX = 570;
  assert.ok(Math.abs(focused.panX + sceneCenterX * focused.scale - 600) < .001,
    "the complete two-card relationship should be centered");
});

test("overview focus keeps small member cards readable inside a larger group", () => {
  const focused = planFocusCamera(
    [
      { x: 100, y: 100, width: 846, height: 330 },
      { x: 134, y: 134, width: 480, height: 260 },
      { x: 668, y: 184, width: 249, height: 130 },
    ],
    { panX: 60, panY: 80, scale: .78 },
    { width: 960, height: 608 },
    "overview",
  );
  assert.ok(focused.scale > .96 && focused.scale < .97);
  assert.ok(249 * focused.scale >= 240);
});

test("reveal pans without changing zoom and stays still for visible nodes", () => {
  const current = { panX: 80, panY: 60, scale: .78 };
  assert.strictEqual(
    planRevealCamera(
      { x: 120, y: 140, width: 420, height: 120 },
      current,
      { width: 1200, height: 800 },
    ),
    current,
  );
  const revealed = planRevealCamera(
    { x: 120, y: 1100, width: 420, height: 120 },
    current,
    { width: 1200, height: 800 },
  );
  assert.equal(revealed.scale, current.scale);
  assert.notEqual(revealed.panY, current.panY);
});
