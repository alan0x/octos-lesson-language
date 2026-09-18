import test from "node:test";
import assert from "node:assert/strict";
import { boundaryPoint, computeConnectionRoute, routePath, stackConnectionLabel } from "../src/connection-layout.js";
import { angleControlValue, cameraFocusTargets, connectionDisplayLabel, diagramConnectionGeometry, diagramLayout, emphasisClassName, fitMathScale, focusTargetsInRegion, geometryArcPath, geometryViewport, inlineMathSegments, isPlainTextMathContent, mathCardWidth, mathDisplayLines, mathSource, supportingVisualFocusTargets, variableAnimationFocusTargets, wrapDiagramLabel } from "../src/board-view.js";
import { normalizeScene3dView, projectScene3dPoint, scene3dSectionIntersections } from "../src/scene3d.js";
import { boardToViewportPoint, planFocusCamera, planRevealCamera, TeachingCameraAuthority, viewportToBoardPoint } from "../src/camera.js";
import {
  boardInputTargetsInteractiveUi,
  boardWheelTargetsInteractiveUi,
} from "../src/input-routing.js";
import { describeBoardTarget } from "../src/board-targets.js";

test("geometry polygons are addressable teaching targets", () => {
  assert.deepEqual(describeBoardTarget({
    kind: "geometry",
    content: {
      polygons: [{
        id: "geometry-1:fragment:piece-1",
        points: ["point-1", "point-2", "point-3"],
        label: "三角形 1",
      }],
    },
  }, "geometry-1:fragment:piece-1"), {
    kind: "geometry-polygon",
    label: "三角形 1",
    value: { points: ["point-1", "point-2", "point-3"] },
  });
});

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

test("world-coordinate controls keep pointer and wheel input away from board navigation", () => {
  const markedCard = {
    tagName: "DIV",
    getAttribute: (name: string) => name === "data-oll-ink-input" ? "ignore" : null,
  };
  const slider = {
    tagName: "INPUT",
    getAttribute: () => null,
  };
  const boardSpace = {
    tagName: "DIV",
    getAttribute: () => null,
  };

  assert.equal(boardInputTargetsInteractiveUi([slider, markedCard]), true);
  assert.equal(boardInputTargetsInteractiveUi([markedCard]), true);
  assert.equal(boardInputTargetsInteractiveUi([boardSpace]), false);
  assert.equal(boardWheelTargetsInteractiveUi([markedCard]), false);
  assert.equal(boardWheelTargetsInteractiveUi([slider, markedCard]), true);
  const wheelPassHost = {
    tagName: "DIV",
    getAttribute: (name: string) => name === "data-oll-board-wheel" ? "pass" : null,
  };
  assert.equal(boardWheelTargetsInteractiveUi([slider, wheelPassHost]), false);
});

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

test("learner camera control persists until a new teaching camera request is applied", () => {
  const authority = new TeachingCameraAuthority();

  assert.equal(authority.observeRender("board-1", "operation-1"), true);
  assert.equal(authority.layoutReframeAllowed, true);

  authority.beginManualNavigation();
  assert.equal(authority.layoutReframeAllowed, false);
  assert.equal(
    authority.observeRender("board-1", "operation-1"),
    false,
    "re-rendering the same operation must not become a new teaching camera request",
  );
  assert.equal(
    authority.layoutReframeAllowed,
    false,
    "elapsed time and layout observation must not revoke learner camera control",
  );

  assert.equal(authority.observeRender("board-1", "operation-2"), true);
  assert.equal(authority.layoutReframeAllowed, false);
  authority.resumeTeachingCamera();
  assert.equal(authority.layoutReframeAllowed, true);
});

test("host camera focus survives layout refresh until a new teaching request", () => {
  const authority = new TeachingCameraAuthority();

  assert.equal(authority.observeRender("board-1", "operation-1"), true);
  authority.holdHostCamera();
  assert.equal(
    authority.layoutReframeAllowed,
    false,
    "host focus must not be overwritten by viewport inset or layout refreshes",
  );

  assert.equal(authority.observeRender("board-1", "operation-1"), false);
  assert.equal(authority.layoutReframeAllowed, false);

  assert.equal(authority.observeRender("board-1", "operation-2"), true);
  authority.resumeTeachingCamera();
  assert.equal(
    authority.layoutReframeAllowed,
    true,
    "a new teaching operation may deliberately take camera control",
  );
});

test("exclusive host camera survives later operations until explicitly released", () => {
  const authority = new TeachingCameraAuthority();

  assert.equal(authority.observeRender("board-1", "operation-1"), true);
  authority.holdHostCamera(true);
  assert.equal(authority.layoutReframeAllowed, false);

  assert.equal(authority.observeRender("board-1", "operation-2"), true);
  assert.equal(
    authority.resumeTeachingCamera(),
    false,
    "a later operation must not steal an exclusive host camera",
  );
  assert.equal(authority.layoutReframeAllowed, false);

  authority.releaseHostCamera();
  assert.equal(authority.layoutReframeAllowed, true);
  assert.equal(
    authority.resumeTeachingCamera(),
    true,
    "teaching focus may resume after the host explicitly releases the camera",
  );
});

test("course framing fills the safe viewport instead of reserving teaching context", () => {
  const current = { panX: 0, panY: 0, scale: 1 };
  const viewport = { width: 1710, height: 927 };
  const insets = { top: 92, right: 28, bottom: 190, left: 28 };
  const course = { x: 1174.2, y: 120, width: 1219.2, height: 1222 };

  const teaching = planFocusCamera([course], current, viewport, "detail", insets);
  const completedCourse = planFocusCamera([course], current, viewport, "course", insets);

  assert.ok(completedCourse.scale > teaching.scale * 1.25);
  assert.ok(viewport.width / completedCourse.scale < 4_200);
  assert.ok(viewport.height / completedCourse.scale < 2_300);
});

test("course framing no longer exposes an entire three-course row", () => {
  const viewport = { width: 1710, height: 927 };
  const currentCourse = { x: 3234.8, y: 90, width: 1219.2, height: 1222 };
  const oldestCourse = { x: 100, y: 90, width: 1500, height: 1115 };
  const camera = planFocusCamera(
    [currentCourse],
    { panX: 0, panY: 0, scale: 1 },
    viewport,
    "course",
    { top: 92, right: 28, bottom: 190, left: 28 },
  );
  const visibleLeft = -camera.panX / camera.scale;
  const visibleRight = visibleLeft + viewport.width / camera.scale;

  assert.ok(visibleLeft > oldestCourse.x + oldestCourse.width);
  assert.ok(visibleLeft < currentCourse.x);
  assert.ok(visibleRight > currentCourse.x + currentCourse.width);
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

test("math cards use rendered KaTeX width plus their horizontal insets", () => {
  assert.equal(mathCardWidth(304.2, 38), 343);
  assert.equal(mathCardWidth(900, 38), 680);
  assert.equal(mathCardWidth(120, 38), 158);
  assert.equal(mathCardWidth(0, 38), undefined);
  assert.equal(mathCardWidth(120, -1), undefined);
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

test("a declared board focus action takes priority over automatic attention", () => {
  const focus = {
    operation_id: "lesson:focus",
    type: "action.apply",
    lesson_id: "lesson",
    event_index: 3,
    action: {
      action_id: "focus-action",
      op: "board.focus",
      focus: { targets: ["declared-target"], intent: "show-target" },
    },
  } as const;
  assert.deepEqual(
    cameraFocusTargets(focus as any, ["old"], ["attention"]),
    ["declared-target"],
  );
});

test("automatic camera targets cannot leak from another course region", () => {
  const board = {
    nodes: {
      old: { id: "old", region_id: "course-old" },
      current: { id: "current", region_id: "course-current" },
    },
    groups: {},
    connections: {},
  } as any;
  assert.deepEqual(focusTargetsInRegion(board, ["old", "current"], "course-current"), ["current"]);
  assert.deepEqual(focusTargetsInRegion(board, ["old"], "course-current"), []);
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

test("supporting formula focus keeps the nearest visual in the same lesson region", () => {
  const board = {
    nodes: {
      scene: { id: "scene", kind: "scene3d", region_id: "topic" },
      section: { id: "section", kind: "geometry", region_id: "topic" },
      formula: { id: "formula", kind: "math", region_id: "topic" },
      prior: { id: "prior", kind: "plot", region_id: "prior-topic" },
    },
    connections: {},
  } as any;
  const layout = {
    nodes: {
      scene: { x: 100, y: 100, width: 460, height: 360 },
      section: { x: 620, y: 100, width: 380, height: 300 },
      formula: { x: 120, y: 510, width: 280, height: 96 },
      prior: { x: 120, y: 650, width: 340, height: 230 },
    },
    groups: {},
    attachments: {},
    bounds: { x: 0, y: 0, width: 1200, height: 900 },
  };
  assert.deepEqual(supportingVisualFocusTargets(["formula"], board, layout), ["scene"]);
});

test("focused visual keeps directly connected visual context", () => {
  const board = {
    nodes: {
      circle: { id: "circle", kind: "geometry", region_id: "topic" },
      sine: { id: "sine", kind: "plot", region_id: "topic" },
      oldPlot: { id: "oldPlot", kind: "plot", region_id: "old-topic" },
    },
    connections: {
      mapping: {
        id: "mapping",
        from: { node_id: "circle" },
        to: { node_id: "sine" },
      },
    },
  } as any;
  const layout = {
    nodes: {
      circle: { x: 100, y: 100, width: 380, height: 300 },
      sine: { x: 534, y: 135, width: 340, height: 230 },
      oldPlot: { x: 100, y: 500, width: 340, height: 230 },
    },
    groups: {},
    attachments: {},
    bounds: { x: 0, y: 0, width: 1000, height: 800 },
  };
  assert.deepEqual(supportingVisualFocusTargets(["circle"], board, layout), ["sine"]);
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

test("a simple process diagram follows edge order instead of a radial relationship layout", () => {
  const content = {
    elements: [
      { id: "calculate", label: "计算" },
      { id: "observe", label: "观察" },
      { id: "conclude", label: "结论" },
      { id: "verify", label: "验证" },
    ],
    edges: [
      { id: "edge-1", from: "observe", to: "calculate" },
      { id: "edge-2", from: "calculate", to: "verify" },
      { id: "edge-3", from: "verify", to: "conclude" },
    ],
  };
  const first = diagramConnectionGeometry(content, {
    from: { fragment_id: "observe" },
    to: { fragment_id: "calculate" },
  });
  const second = diagramConnectionGeometry(content, {
    from: { fragment_id: "calculate" },
    to: { fragment_id: "verify" },
  });
  const third = diagramConnectionGeometry(content, {
    from: { fragment_id: "verify" },
    to: { fragment_id: "conclude" },
  });
  assert.ok(first && second && third);
  assert.equal(first.from.y, first.to.y);
  assert.equal(second.from.y, second.to.y);
  assert.equal(third.from.y, third.to.y);
  assert.ok(first.from.x < first.to.x);
  assert.ok(second.from.x < second.to.x);
  assert.ok(third.from.x < third.to.x);
});

test("long process labels wrap inside non-overlapping diagram nodes", () => {
  const content = {
    elements: [
      { id: "input", label: "输入两个需要求最大公约数的整数" },
      { id: "divide", label: "计算被除数除以除数得到的余数" },
      { id: "check", label: "判断当前余数是否已经等于零" },
      { id: "finish", label: "输出最后一个非零余数作为答案" },
    ],
    edges: [
      { id: "edge-1", from: "input", to: "divide" },
      { id: "edge-2", from: "divide", to: "check" },
      { id: "edge-3", from: "check", to: "finish" },
    ],
  };
  const layout = diagramLayout(content);
  assert.equal(layout.ordered, true);
  assert.ok(layout.height >= 190);
  assert.ok(wrapDiagramLabel(content.elements[0]!.label, 18).length > 1);
  const nodes = [...layout.points.values()].map((point) => ({
    x: point.x - point.width! / 2,
    y: point.y - point.height! / 2,
    width: point.width!,
    height: point.height!,
  }));
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left]!;
      const b = nodes[right]!;
      assert.equal(
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y,
        false,
      );
    }
  }
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

test("angle controls write values using the declared angle unit", () => {
  assert.ok(Math.abs(angleControlValue(Math.PI / 2, 0, 0, 360, "度") - 90) < 1e-12);
  assert.ok(Math.abs(angleControlValue(-Math.PI / 2, 270, 0, 360, "degree") - 270) < 1e-12);
  assert.equal(angleControlValue(0, 360, 0, 360, "°"), 360);
  assert.ok(Math.abs(angleControlValue(Math.PI / 2, 0, 0, 2 * Math.PI, "弧度") - Math.PI / 2) < 1e-12);
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

test("3D implicit surfaces render three-variable equations and support sections", () => {
  const content = {
    objects: [{
      as: "superellipsoid",
      kind: "implicit_surface",
      expression: "x^4+y^4+z^4-1",
      level: 0,
      x_range: { min: -1.2, max: 1.2 },
      y_range: { min: -1.2, max: 1.2 },
      z_range: { min: -1.2, max: 1.2 },
      samples: 12,
    }],
  };
  const intersections = scene3dSectionIntersections(content, {
    axis: "z",
    value: 0,
    targets: ["superellipsoid"],
    display: "plane_and_intersection",
  });
  assert.ok(intersections.length >= 1);
  assert.ok(intersections.every((path) => path.solid));
  assert.ok(intersections.some((path) => path.closed));
  const points = intersections.flatMap((path) => path.points);
  assert.ok(Math.min(...points.map((point) => point.x)) < -.95);
  assert.ok(Math.max(...points.map((point) => point.x)) > .95);
  assert.ok(Math.min(...points.map((point) => point.y)) < -.95);
  assert.ok(Math.max(...points.map((point) => point.y)) > .95);
});

test("focus keeps an already composed target steady", () => {
  const current = { panX: 40.69411764705876, panY: 156.82352941176467, scale: 1.2158823529411766 };
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
  assert.equal(focused.panX + 240 * focused.scale, 600);
  assert.equal(focused.panY + 200 * focused.scale, 400);
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
  assert.equal(narrow.scale, 1.3);
  assert.ok(wide.scale > current.scale && wide.scale < narrow.scale);
});

test("focus changes scale when the target is too small or the teaching scene is too large", () => {
  const tiny = planFocusCamera(
    [{ x: 1200, y: 900, width: 500, height: 120 }],
    { panX: 0, panY: 0, scale: .2 },
    { width: 1200, height: 800 },
    "detail",
  );
  assert.equal(tiny.scale, 1.3);

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

test("relationship focus may relax a device readability floor to keep every target visible", () => {
  const focused = planFocusCamera(
    [
      { x: 100, y: 100, width: 520, height: 420 },
      { x: 100, y: 620, width: 520, height: 420 },
    ],
    { panX: 0, panY: 0, scale: .55 },
    { width: 1200, height: 800 },
    "relationship",
    { top: 70, bottom: 170 },
    .55,
  );
  assert.ok(focused.scale < .55);
  const top = focused.panY + 100 * focused.scale;
  const bottom = focused.panY + 1040 * focused.scale;
  assert.ok(top >= 140 - .001);
  assert.ok(bottom <= 560 + .001);
});

test("detail focus preserves a device readability floor", () => {
  const focused = planFocusCamera(
    [{ x: 100, y: 100, width: 520, height: 940 }],
    { panX: 0, panY: 0, scale: .55 },
    { width: 1200, height: 800 },
    "detail",
    { top: 70, bottom: 170 },
    .55,
  );
  assert.equal(focused.scale, .55);
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

test("focus avoids the actual floating UI rectangle instead of reserving an entire edge", () => {
  const focused = planFocusCamera(
    [{ x: 1000, y: 800, width: 420, height: 160 }],
    { panX: 0, panY: 0, scale: .78 },
    { width: 1200, height: 800 },
    "detail",
    { occlusions: [{ x: 900, y: 120, width: 260, height: 400 }] },
  );
  const targetCenterX = 1_210;
  const targetCenterY = 880;
  const clearRight = 900 - 70;
  const safeCenterX = (70 + clearRight) / 2;
  assert.ok(Math.abs(focused.panX + targetCenterX * focused.scale - safeCenterX) < .001);
  assert.ok(Math.abs(focused.panY + targetCenterY * focused.scale - 400) < .001);
});

test("focus chooses the unobstructed rectangle that best fits the teaching scene", () => {
  const focused = planFocusCamera(
    [
      { x: 3714.85, y: 90, width: 380, height: 300 },
      { x: 4148.85, y: 501, width: 440, height: 135 },
    ],
    { panX: 0, panY: 0, scale: .55 },
    { width: 960, height: 540 },
    "relationship",
    {
      focusMargin: 24,
      occlusions: [
        { x: 6, y: 9, width: 65, height: 30 },
        { x: 74, y: 6, width: 880, height: 36 },
        { x: 8, y: 48, width: 314, height: 35 },
        { x: 220, y: 495, width: 520, height: 37 },
        { x: 658, y: 421, width: 292, height: 65 },
      ],
    },
    .55,
  );

  // The centered candidate trades ~2% of scale for a placement closer to the
  // screen center (364 vs 329); both stay above the readable floor.
  assert.ok(Math.abs(focused.scale - .616704805) < .000_001);
});

test("focus stays centered when a bottom dock and a side column both leave room", () => {
  const focused = planFocusCamera(
    [
      { x: 20, y: 20, width: 380, height: 390 },
      { x: 20, y: 452, width: 360, height: 162 },
    ],
    { panX: 80, panY: 60, scale: .78 },
    { width: 1920, height: 1080 },
    "relationship",
    {
      focusMargin: 24,
      occlusions: [
        { x: 6, y: 9, width: 65, height: 30 },
        { x: 74, y: 6, width: 1840, height: 36 },
        { x: 8, y: 48, width: 308.640625, height: 35 },
        { x: 1854, y: 970, width: 56, height: 56 },
        { x: 700, y: 1035, width: 520, height: 37 },
      ],
    },
    .55,
  );

  assert.ok(Math.abs(focused.scale - 1.2705263157894737) < .000_001);
  assert.ok(Math.abs(focused.panX - 693.189474) < .001,
    "the bottom dock must not push a fully fitting lesson into a side column");
});

test("focus ignores a floating control that only sliver-overlaps the usable viewport", () => {
  // A collapsed teacher avatar sits inside the bottom inset and enters the
  // usable viewport by only 2px. Inflating that sliver by the focus margin
  // must not amputate the safe viewport's right edge and shove the lesson
  // into a narrower column.
  const focused = planFocusCamera(
    [
      { x: 20, y: 20, width: 360, height: 332 },
      { x: 20, y: 394, width: 360, height: 162 },
    ],
    { panX: 80, panY: 60, scale: .78 },
    { width: 1400, height: 900 },
    "detail",
    {
      top: 92, right: 28, bottom: 190, left: 28,
      occlusions: [{ x: 1282, y: 708, width: 94, height: 94 }],
    },
  );
  // Sliver ignored: the safe viewport is the full inset box
  // [98..1302]×[162..640] with center (700, 401); scene center is (200, 288).
  assert.ok(Math.abs(focused.panX - (700 - 200 * focused.scale)) < .001);
  assert.ok(Math.abs(focused.panY - (401 - 288 * focused.scale)) < .001);
});

test("focus prefers the centered candidate when a side column fits only marginally better", () => {
  // TV viewport trace (960x540, Android insets): the portrait scene fits the
  // right-of-toolbar column ~11% better than the near-center strip, but the
  // column centers content at x=605 while the strip centers it at x=482 —
  // almost the viewport center. Near-ties must hold the screen center.
  const focused = planFocusCamera(
    [
      { x: 20.6, y: 19.7, width: 360, height: 390.9 },
      { x: 20.6, y: 451, width: 360, height: 161.8 },
    ],
    { panX: 80, panY: 60, scale: .78 },
    { width: 960, height: 540 },
    "detail",
    {
      focusMargin: 24,
      occlusions: [
        { x: 6, y: 9, width: 65, height: 30 },
        { x: 74, y: 6, width: 880, height: 36 },
        { x: 8, y: 48, width: 309, height: 35 },
        { x: 894, y: 430, width: 56, height: 56 },
        { x: 220, y: 495, width: 520, height: 37 },
      ],
    },
    .55,
  );
  // The centered strip [95..870]x[107..471] centers the scene at x=482.5.
  const sceneCenterX = 20.6 + 360 / 2;
  assert.ok(
    Math.abs(focused.panX + sceneCenterX * focused.scale - 482.5) < .5,
    `expected the centered strip to win, got scene center ${
      focused.panX + sceneCenterX * focused.scale
    } (off-center column would give 605.5)`,
  );
});

test("focus still avoids a floating control that meaningfully overlaps the usable viewport", () => {
  // Same avatar moved up so it overlaps the usable viewport by 80px: the
  // right edge is genuinely blocked and the narrow full-height column wins.
  const focused = planFocusCamera(
    [
      { x: 20, y: 20, width: 360, height: 332 },
      { x: 20, y: 394, width: 360, height: 162 },
    ],
    { panX: 80, panY: 60, scale: .78 },
    { width: 1400, height: 900 },
    "detail",
    {
      top: 92, right: 28, bottom: 190, left: 28,
      occlusions: [{ x: 1282, y: 560, width: 94, height: 94 }],
    },
  );
  // Safe viewport narrows to [98..1212]×[162..640] with center (655, 401).
  assert.ok(Math.abs(focused.panX - (655 - 200 * focused.scale)) < .001);
  assert.ok(Math.abs(focused.panY - (401 - 288 * focused.scale)) < .001);
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
