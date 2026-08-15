import test from "node:test";
import assert from "node:assert/strict";
import { boundaryPoint, computeConnectionRoute, routePath, stackConnectionLabel } from "../src/connection-layout.js";
import { angleControlValue, cameraFocusTargets, connectionDisplayLabel, diagramConnectionGeometry, emphasisClassName, fitMathScale, geometryArcPath, geometryViewport, inlineMathSegments, isPlainTextMathContent, mathDisplayLines, mathSource, variableAnimationFocusTargets } from "../src/board-view.js";
import { normalizeScene3dView, projectScene3dPoint, scene3dSectionIntersections } from "../src/scene3d.js";
import { boardToViewportPoint, planFocusCamera, planRevealCamera, viewportToBoardPoint } from "../src/camera.js";

function assertOrthogonal(points: Array<{ x: number; y: number }>): void {
  for (let index = 1; index < points.length; index += 1) {
    const prior = points[index - 1]!;
    const point = points[index]!;
    assert.ok(
      prior.x === point.x || prior.y === point.y,
      `segment ${index - 1} must be horizontal or vertical`,
    );
  }
}

test("public camera coordinates round-trip between board and viewport space", () => {
  const camera = { panX: -120, panY: 48, scale: .625 };
  const boardPoint = { x: 832, y: 416 };
  const viewportPoint = boardToViewportPoint(boardPoint, camera);
  assert.deepEqual(viewportPoint, { x: 400, y: 308 });
  assert.deepEqual(viewportToBoardPoint(viewportPoint, camera), boardPoint);
  assert.throws(
    () => viewportToBoardPoint(viewportPoint, { ...camera, scale: 0 }),
    /positive finite/,
  );
});

test("math content resolves LaTeX from canonical forms and strips display delimiters", () => {
  assert.equal(mathSource({ expression: "$$x^2+6x+5$$" }), "x^2+6x+5");
  assert.equal(mathSource({ statement: "\\[\\triangle ABD\\cong\\triangle ACD\\]" }), "\\triangle ABD\\cong\\triangle ACD");
  assert.equal(mathSource({ fragments: [{ latex: "x^2" }, { latex: "6x" }] }), "x^2 6x");
});

test("text-only math content is identified for readable prose fallback", () => {
  assert.equal(isPlainTextMathContent({ text: "核心推导：\n(-1) × (-1) = 1" }), true);
  assert.equal(isPlainTextMathContent({ text: "说明", latex: "(-1)\\times(-1)=1" }), false);
  assert.equal(isPlainTextMathContent({ fragments: [{ latex: "x=1" }] }), false);
});

test("ordinary text separates explicit inline LaTeX without treating unmatched dollars as math", () => {
  assert.deepEqual(
    inlineMathSegments("若式子 $\\sqrt{x-1}$ 有意义，则 \\(x \\ge 1\\)，费用为 $5"),
    [
      { kind: "text", value: "若式子 " },
      { kind: "math", value: "\\sqrt{x-1}" },
      { kind: "text", value: " 有意义，则 " },
      { kind: "math", value: "x \\ge 1" },
      { kind: "text", value: "，费用为 $5" },
    ],
  );
  assert.deepEqual(inlineMathSegments("普通文字不含公式"), [
    { kind: "text", value: "普通文字不含公式" },
  ]);
  assert.deepEqual(inlineMathSegments("结论是 $$x=1$$。"), [
    { kind: "text", value: "结论是 " },
    { kind: "math", value: "x=1" },
    { kind: "text", value: "。" },
  ]);
});

test("long implication chains become readable display lines", () => {
  assert.deepEqual(
    mathDisplayLines("[(x+3)+x]\\times2=30 => (2x+3)\\times2=30 => 2x+3=15"),
    [
      "[(x+3)+x]\\times2=30",
      "\\Rightarrow (2x+3)\\times2=30",
      "\\Rightarrow 2x+3=15",
    ],
  );
  assert.deepEqual(mathDisplayLines("x+1=2"), ["x+1=2"]);
});

test("single-line math scales down to the available card width", () => {
  assert.equal(fitMathScale(800, 600), 0.75);
  assert.equal(fitMathScale(400, 600), 1);
  assert.equal(fitMathScale(0, 600), 1);
});

test("model-authored emphasis prose degrades to a safe focus class", () => {
  assert.equal(emphasisClassName("supporting"), "emphasis-supporting");
  assert.equal(emphasisClassName("  WARNING  "), "emphasis-warning");
  assert.equal(emphasisClassName("结论：(-3) × (-2) = 6"), "emphasis-focus");
  assert.equal(emphasisClassName(undefined), undefined);
});

test("beat boundaries preserve the latest visible teaching target", () => {
  const boundary = {
    operation_id: "lesson:beat:end",
    type: "beat.end",
    lesson_id: "lesson",
    event_index: 3,
  } as const;
  assert.deepEqual(cameraFocusTargets(boundary, ["old-lesson"], ["current-problem"]), [
    "current-problem",
  ]);
  assert.deepEqual(cameraFocusTargets(boundary, ["old-lesson"], []), ["old-lesson"]);
});

test("variable animation focuses every node driven by the shared variable", () => {
  const board = {
    nodes: {
      circle: { id: "circle", content: { bindings: [{ expression: "cos(theta)" }] } },
      plot: { id: "plot", content: { bindings: [{ expression: "sin(theta)" }] } },
      note: { id: "note", content: { text: "theta is mentioned but not bound" } },
    },
  } as any;
  assert.deepEqual(variableAnimationFocusTargets(board, "theta"), ["circle", "plot"]);
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
  assertOrthogonal(route.points);
  assert.doesNotMatch(routePath(route), / C /);
  assert.match(routePath(route), / Q /, "orthogonal corners should use a small radius");
});

test("overlapping group connections route above both group boundaries", () => {
  const from = { x: 100, y: 120, width: 760, height: 520 };
  const to = { x: 680, y: 130, width: 720, height: 640 };
  const route = computeConnectionRoute(from, to, "从直观到证明");
  assert.deepEqual(route.start, { x: 480, y: 120 });
  assert.deepEqual(route.end, { x: 1040, y: 130 });
  assert.ok(route.points[1]!.y < from.y);
  assert.ok(route.points.at(-2)!.y < to.y);
  assertOrthogonal(route.points);
});

test("diagram fragment connections keep their endpoints inside the diagram", () => {
  const pointA = { x: 186, y: 104, width: 8, height: 8 };
  const pointD = { x: 186, y: 238, width: 8, height: 8 };
  const route = computeConnectionRoute(pointA, pointD, "辅助线 AD", true);
  assert.deepEqual(route.start, { x: 190, y: 108 });
  assert.deepEqual(route.end, { x: 190, y: 242 });
});

test("connection labels stack instead of covering one another", () => {
  const from = { x: 40, y: 80, width: 100, height: 120 };
  const to = { x: 500, y: 80, width: 100, height: 120 };
  const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
  const first = stackConnectionLabel(computeConnectionRoute(from, to, "对应角相等"), occupied);
  const second = stackConnectionLabel(computeConnectionRoute(from, to, "对应角相等且构成平角"), occupied);
  assert.notDeepEqual(
    { x: second.label.x, y: second.label.y },
    { x: first.label.x, y: first.label.y },
  );
  assert.equal(routePath(first), routePath(second), "label avoidance must not bend or move the connector");
  assert.equal(first.label.hidden, undefined);
  assert.equal(second.label.hidden, undefined);
});

test("vertical card connections stay between their endpoints instead of detouring to a far edge", () => {
  const from = { x: 120, y: 280, width: 680, height: 136 };
  const to = { x: 120, y: 470, width: 286, height: 130 };
  const route = computeConnectionRoute(from, to, "");
  assertOrthogonal(route.points);
  assert.ok(Math.max(...route.points.map((point) => point.x)) <= from.x + from.width);
  assert.ok(Math.min(...route.points.map((point) => point.y)) >= from.y + from.height);
  assert.ok(Math.max(...route.points.map((point) => point.y)) <= to.y);
});

test("connection routing avoids nearby cards without considering distant topics", () => {
  const from = { x: 0, y: 0, width: 100, height: 100 };
  const to = { x: 400, y: 0, width: 100, height: 100 };
  const blocker = { x: 220, y: 35, width: 60, height: 100 };
  const distantTopic = { x: 10_000, y: 10_000, width: 600, height: 400 };
  const route = computeConnectionRoute(from, to, "", false, [blocker, distantTopic]);
  assertOrthogonal(route.points);
  assert.ok(Math.min(...route.points.map((point) => point.y)) < from.y);
  assert.ok(Math.max(...route.points.map((point) => point.x)) < 1_000);
});

test("connection labels require explicit learner-facing text", () => {
  assert.equal(connectionDisplayLabel({ relation: "evolves_to" }), "");
  assert.equal(connectionDisplayLabel({ relation: "derives", label: "推导出" }), "推导出");
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

test("geometry viewport preserves equal coordinate scale for circles", () => {
  const viewport = geometryViewport({
    x: { min: -1.25, max: 1.25 },
    y: { min: -1.25, max: 1.25 },
    equal_scale: true,
  });
  assert.ok(viewport.scale > 0);
  assert.equal(viewport.mapX(1) - viewport.mapX(0), viewport.mapY(0) - viewport.mapY(1));
});

test("geometry arc uses the same rendered radius in both SVG dimensions", () => {
  const viewport = geometryViewport({
    x: { min: -1.25, max: 1.25 },
    y: { min: -1.25, max: 1.25 },
    equal_scale: true,
  });
  const path = geometryArcPath(viewport, { x: 0, y: 0 }, .3, 0, Math.PI / 3);
  const radius = .3 * viewport.scale;
  assert.match(path, new RegExp(`A ${radius} ${radius} 0 0 0`));
  assert.ok(path.startsWith(`M ${viewport.mapX(.3)} ${viewport.mapY(0)}`));
});

test("angle controls choose the equivalent angle nearest the current shared value", () => {
  assert.ok(Math.abs(angleControlValue(-Math.PI / 2, 3 * Math.PI / 2, 0, 2 * Math.PI) - 3 * Math.PI / 2) < 1e-12);
  assert.equal(angleControlValue(0, 0, 0, 2 * Math.PI), 0);
  assert.equal(angleControlValue(0, 2 * Math.PI, 0, 2 * Math.PI), 2 * Math.PI);
  assert.ok(Math.abs(angleControlValue(Math.PI / 2, 0, -Math.PI, Math.PI) - Math.PI / 2) < 1e-12);
});

test("3D projection responds deterministically to orbit and clamps unsafe camera values", () => {
  const front = projectScene3dPoint({ x: 1, y: 0, z: 0 }, { yaw: 0, pitch: 0, zoom: 1 });
  const rotated = projectScene3dPoint({ x: 1, y: 0, z: 0 }, { yaw: Math.PI / 2, pitch: 0, zoom: 1 });
  assert.ok(front.x > rotated.x);
  assert.notEqual(front.depth, rotated.depth);
  assert.deepEqual(
    normalizeScene3dView({ yaw: Number.NaN, pitch: 20, zoom: 100 }),
    { yaw: 0, pitch: Math.PI / 2, zoom: 5 },
  );
});

test("3D box sections render the bounded solid intersection instead of only a reference plane", () => {
  const content = {
    objects: [{
      as: "cube",
      kind: "box",
      center: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 2, z: 2 },
    }],
  };
  const intersections = scene3dSectionIntersections(content, {
    as: "slice",
    axis: "z",
    value: .25,
    targets: ["cube"],
    display: "plane_and_intersection",
  });
  assert.equal(intersections.length, 1);
  assert.equal(intersections[0]!.solid, true);
  assert.equal(intersections[0]!.closed, true);
  assert.ok(intersections[0]!.points.every((point) => Math.abs(point.z - .25) < 1e-9));
  assert.equal(Math.min(...intersections[0]!.points.map((point) => point.x)), -1);
  assert.equal(Math.max(...intersections[0]!.points.map((point) => point.x)), 1);
  assert.deepEqual(scene3dSectionIntersections(content, {
    axis: "z",
    value: 1.5,
    targets: ["cube"],
    display: "intersection",
  }), []);
});

test("3D function-surface sections change their contour when the shared height changes", () => {
  const content = {
    objects: [{
      as: "paraboloid",
      kind: "surface",
      expression: "x^2+y^2",
      x_range: { min: -2, max: 2 },
      y_range: { min: -2, max: 2 },
      samples: 24,
    }],
  };
  const contour = (value: number) => scene3dSectionIntersections(content, {
    axis: "z",
    value,
    targets: ["paraboloid"],
    display: "plane_and_intersection",
  }, { k: value });
  const low = contour(.25);
  const high = contour(1);
  assert.equal(low.length, 1);
  assert.equal(high.length, 1);
  assert.equal(high[0]!.solid, false);
  assert.equal(high[0]!.closed, true);
  const maxRadius = (points: Array<{ x: number; y: number }>) =>
    Math.max(...points.map((point) => Math.hypot(point.x, point.y)));
  assert.ok(maxRadius(low[0]!.points) < maxRadius(high[0]!.points));
  assert.ok(Math.abs(maxRadius(high[0]!.points) - 1) < .05);
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

test("focus recenters a merely visible target that is outside the teaching center", () => {
  const current = { panX: 80, panY: 60, scale: 1 };
  const focused = planFocusCamera(
    [{ x: 120, y: 140, width: 240, height: 120 }],
    current,
    { width: 1200, height: 800 },
    "detail",
  );
  assert.notStrictEqual(focused, current);
  assert.equal(focused.panX + 240, 600);
  assert.equal(focused.panY + 200, 400);
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

test("focus centers teaching content inside the host's unobstructed viewport", () => {
  const focused = planFocusCamera(
    [{ x: 1000, y: 800, width: 420, height: 160 }],
    { panX: 0, panY: 0, scale: .78 },
    { width: 1200, height: 800 },
    "detail",
    { top: 90, right: 260, bottom: 180, left: 20 },
  );
  const targetCenterX = 1_210;
  const targetCenterY = 880;
  const safeCenterX = (20 + 70 + 1200 - 260 - 70) / 2;
  const safeCenterY = (90 + 70 + 800 - 180 - 70) / 2;
  assert.ok(Math.abs(focused.panX + targetCenterX * focused.scale - safeCenterX) < .001);
  assert.ok(Math.abs(focused.panY + targetCenterY * focused.scale - safeCenterY) < .001);
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
