import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertAuthoringSchema,
  OllError,
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
  setLessonVariable,
  validateAuthoringSchema,
  validateAuthoringLesson,
  type AuthoringLesson,
  type NormalizationHost,
  type ResourceContext,
} from "../src/index.js";

interface ManifestEntry extends NormalizationHost {
  name: string;
  contextFile?: string;
  resourceContext?: ResourceContext;
}

const root = process.cwd();
const manifest = JSON.parse(await readFile(resolve(root, "examples/manifest.json"), "utf8")) as ManifestEntry[];
const authoringSchema = JSON.parse(await readFile(resolve(root, "schema/authoring/v0.1.schema.json"), "utf8"));
const lessons = await Promise.all(
  manifest.map(async (entry: ManifestEntry) => {
    const example = resolve(root, "examples", entry.name);
    const host = {
      ...entry,
      ...(entry.contextFile
        ? { resourceContext: JSON.parse(await readFile(resolve(example, entry.contextFile), "utf8")) }
        : {}),
    };
    return {
      entry: host,
      source: JSON.parse(await readFile(resolve(example, "lesson.authoring.json"), "utf8")) as AuthoringLesson,
    };
  }),
);
const { source, entry: host } = lessons.find(({ entry }) => entry.name === "quadratic")!;

test("validates and normalizes every complete lesson", () => {
  for (const lesson of lessons) {
    validateAuthoringLesson(lesson.source, lesson.entry.resourceContext);
    const events = normalizeAuthoringLesson(lesson.source, lesson.entry);
    assert.equal(events[0].event, "lesson.open");
    assert.equal(events.at(-1)!.event, "lesson.close");
    assert.equal(events.length, lesson.source.steps.length + 2);
    assert.equal(reduceCanonicalEvents(events).revision, lesson.entry.baseRevision + lesson.source.steps.length);
  }
});

test("rejects a reference before it is defined", () => {
  const invalid = structuredClone(source);
  (invalid as any).steps[0].beats[0].actions[0].place = {
    relation: "below",
    anchor: "not-created",
  };
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND",
  );
});

test("rejects duplicate local aliases", () => {
  const invalid = structuredClone(source);
  (invalid as any).steps[0].beats[0].actions[1].as = "original";
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_DUPLICATE_ALIAS",
  );
});

test("normalization is deterministic", () => {
  assert.deepEqual(
    normalizeAuthoringLesson(source, host),
    normalizeAuthoringLesson(source, host),
  );
});

test("normalization carries the host region onto the board and created nodes", () => {
  const events = normalizeAuthoringLesson(source, {
    ...host,
    regionId: "topic-quadratic",
  });
  assert.equal(events[0]!.board?.region_id, "topic-quadratic");
  const createdNodes = events
    .flatMap((event) => event.step?.beats ?? [])
    .flatMap((beat) => Object.values(beat.stage).flat())
    .filter((action) => action.op === "board.create")
    .map((action) => action.node);
  assert.ok(createdNodes.length > 0);
  assert.ok(createdNodes.every((node) => node?.region_id === "topic-quadratic"));
});

test("replaying a canonical step is idempotent", () => {
  const events = normalizeAuthoringLesson(source, host);
  const duplicatedStep = structuredClone(events[1]);
  const state = reduceCanonicalEvents([events[0], events[1], duplicatedStep, ...events.slice(2)]);
  const baseline = reduceCanonicalEvents(events);
  assert.deepEqual(state, baseline);
});

test("normalizes addressable image and diagram regions", () => {
  const geometry = lessons.find(({ entry }) => entry.name === "geometry-auxiliary-line")!;
  const events = normalizeAuthoringLesson(geometry.source, geometry.entry);
  const state = reduceCanonicalEvents(events);
  const diagram = state.nodes[`${geometry.entry.lessonId}:node:clean-diagram`];
  const edge = diagram.content.edges.find((item: Record<string, unknown>) => item.label === "AB");
  assert.equal(edge.from, `${diagram.id}:fragment:point-a`);
  assert.equal(edge.to, `${diagram.id}:fragment:point-b`);
  const auxiliary = state.connections[`${geometry.entry.lessonId}:connection:auxiliary-ad`];
  assert.equal((auxiliary.emphasis!.at(-1) as { emphasis: string }).emphasis, "resolved");
});

test("rejects an unknown image region", () => {
  const geometry = lessons.find(({ entry }) => entry.name === "geometry-auxiliary-line")!;
  const invalid = structuredClone(geometry.source);
  (invalid as any).steps[0].beats[0].actions[0].content.regions[0].source_region = "asset-geometry-001#region-not-provided";
  assert.throws(
    () => validateAuthoringLesson(invalid, geometry.entry.resourceContext),
    (error) => error instanceof OllError && error.code === "OLL_RESOURCE_DENIED",
  );
});

test("rejects an internal diagram reference that is not defined", () => {
  const geometry = lessons.find(({ entry }) => entry.name === "geometry-auxiliary-line")!;
  const invalid = structuredClone(geometry.source);
  (invalid as any).steps[1].beats[0].actions[0].content.edges[0].from = "point-not-defined";
  assert.throws(
    () => validateAuthoringLesson(invalid, geometry.entry.resourceContext),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND",
  );
});

function unitCircleLesson(): AuthoringLesson {
  const lesson = structuredClone(source);
  lesson.steps[0]!.beats[0]!.actions.unshift({
    do: "write",
    as: "unit-circle",
    kind: "geometry",
    role: "diagram",
    content: {
      title: "单位圆",
      axes: {
        x: { min: -1.25, max: 1.25, label: "x" },
        y: { min: -1.25, max: 1.25, label: "y" },
        equal_scale: true,
      },
      points: [
        { as: "origin", x: 0, y: 0, label: "O" },
        { as: "point-p", x: .5, y: .8660254, label: "P(cos θ, sin θ)" },
        { as: "foot", x: .5, y: 0, label: "" },
      ],
      circles: [
        { as: "circle", center: "origin", radius: 1, label: "r = 1" },
      ],
      segments: [
        { as: "radius", from: "origin", to: "point-p", label: "r = 1", style: "solid" },
        { as: "projection", from: "point-p", to: "foot", label: "sin θ", style: "projection" },
      ],
      arcs: [
        { as: "angle", center: "origin", radius: .28, start_angle: 0, end_angle: Math.PI / 3, label: "θ" },
      ],
    },
    place: { relation: "new_region" },
  });
  return lesson;
}

test("validates and normalizes addressable coordinate geometry", () => {
  const lesson = unitCircleLesson();
  assert.deepEqual(validateAuthoringSchema(lesson), { valid: true, errors: [] });
  validateAuthoringLesson(lesson);
  const events = normalizeAuthoringLesson(lesson, host);
  const state = reduceCanonicalEvents(events);
  const geometry = state.nodes[`${host.lessonId}:node:unit-circle`];
  const originId = `${geometry.id}:fragment:origin`;
  const pointId = `${geometry.id}:fragment:point-p`;
  assert.equal(geometry.kind, "geometry");
  assert.equal(geometry.content.circles[0].center, originId);
  assert.equal(geometry.content.segments[0].from, originId);
  assert.equal(geometry.content.segments[0].to, pointId);
  assert.equal(geometry.content.arcs[0].center, originId);
});

test("rejects geometry that would distort a circle", () => {
  const invalid = unitCircleLesson();
  (invalid.steps[0]!.beats[0]!.actions[0] as any).content.axes.equal_scale = false;
  assert.equal(validateAuthoringSchema(invalid).valid, false);
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_OPERATION_PAYLOAD",
  );
});

test("rejects geometry primitives that reference a missing point", () => {
  const invalid = unitCircleLesson();
  (invalid.steps[0]!.beats[0]!.actions[0] as any).content.circles[0].center = "missing-center";
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND",
  );
});

test("rejects model-authored absolute board coordinates", () => {
  const invalid = structuredClone(source);
  (invalid as any).steps[0].beats[0].actions[0].place.x = 120;
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_PLACEMENT",
  );
});

test("rejects unknown action fields", () => {
  const invalid = structuredClone(source);
  (invalid as any).steps[0].beats[0].actions[0].animation_duration = 1200;
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_OPERATION_PAYLOAD",
  );
});

test("authoring schema declares each action payload required by the validator", () => {
  const declared = Object.fromEntries(
    authoringSchema.$defs.action.allOf.filter((rule: any) => rule.then.required).map((rule: any) => [
      rule.if.properties.do.const,
      rule.then.required,
    ]),
  );
  assert.deepEqual(declared, {
    write: ["as", "kind", "role", "content", "place"],
    revise: ["target", "content", "reason"],
    emphasize: ["target", "emphasis"],
    connect: ["as", "from", "to", "relation"],
    group: ["as", "role", "label", "members"],
    focus: ["targets", "intent"],
    point: ["target"],
    expression: ["expression"],
    animate: ["variable", "value"],
  });
});

test("authoring schema declares close focus as local aliases", () => {
  assert.equal(authoringSchema.properties.close.properties.focus.minItems, 1);
  assert.equal(authoringSchema.properties.close.properties.focus.items.$ref, "#/$defs/alias");
});

test("focus actions and lesson close can target a connection", () => {
  const valid = structuredClone(source);
  valid.steps[1].beats[1].actions.push({
    do: "focus",
    targets: ["half-to-square"],
    intent: "show_construction_relation",
  });
  valid.close.focus = ["half-to-square"];

  validateAuthoringLesson(valid);
  const events = normalizeAuthoringLesson(valid, host);
  const connectionId = `${host.lessonId}:connection:half-to-square`;
  const focusAction = events[2]!.step!.beats[1]!.stage.during_speech.at(-1)!;
  assert.deepEqual(focusAction.focus!.targets, [connectionId]);
  assert.deepEqual(events.at(-1)!.result!.suggested_focus, [connectionId]);
});

test("independent JSON Schema validation accepts every complete lesson", () => {
  for (const lesson of lessons) {
    assert.deepEqual(validateAuthoringSchema(lesson.source), { valid: true, errors: [] });
    assert.doesNotThrow(() => assertAuthoringSchema(lesson.source));
  }
});

test("independent JSON Schema validation rejects a malformed action", () => {
  const invalid = structuredClone(source) as any;
  delete invalid.steps[1].beats[0].actions[1].as;
  const result = validateAuthoringSchema(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "required"));
  assert.throws(() => assertAuthoringSchema(invalid), (error) => error instanceof OllError && error.code === "OLL_SCHEMA_INVALID");
});

test("patient is a valid beat delivery", () => {
  const valid = structuredClone(source);
  valid.steps[0]!.beats[0]!.delivery = "patient";
  assert.deepEqual(validateAuthoringSchema(valid), { valid: true, errors: [] });
  assert.doesNotThrow(() => validateAuthoringLesson(valid));
});

test("point and emphasize can target a group", () => {
  const valid = structuredClone(source);
  valid.steps[4]!.beats[0]!.actions.push(
    { do: "point", target: "derivation-group" },
    { do: "emphasize", target: "derivation-group", emphasis: "focus" },
  );
  validateAuthoringLesson(valid);
  const events = normalizeAuthoringLesson(valid, host);
  const actions = events[5]!.step!.beats[0]!.stage.during_speech;
  const groupId = `${host.lessonId}:group:derivation-group`;
  assert.deepEqual(actions.at(-2)!.target, { group_id: groupId });
  assert.deepEqual(actions.at(-1)!.target, { group_id: groupId });
  const state = reduceCanonicalEvents(events);
  assert.equal((state.groups[groupId]!.emphasis!.at(-1) as { emphasis: string }).emphasis, "focus");
});

test("image Schema requires the canonical asset_id field", () => {
  const geometry = lessons.find(({ entry }) => entry.name === "geometry-auxiliary-line")!;
  const invalid = structuredClone(geometry.source) as any;
  const image = invalid.steps[0].beats[0].actions[0];
  image.content.source_asset = image.content.asset_id;
  delete image.content.asset_id;
  const result = validateAuthoringSchema(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "required"));
  assert.ok(result.errors.some((error) => error.keyword === "additionalProperties"));
});

test("authoring schema exposes coordinate geometry as a first-class node kind", () => {
  assert.ok(authoringSchema.$defs.action.properties.kind.enum.includes("geometry"));
  assert.equal(authoringSchema.$defs.geometryContent.properties.axes.properties.equal_scale.const, true);
});

test("validates and normalizes interactive 3D solids, surfaces, and sections", () => {
  const sceneLesson: AuthoringLesson = {
    dsl: "octos.lesson",
    version: "0.1",
    profile: "authoring",
    lesson: {
      mode: "explain",
      language: "zh-CN",
      title: "三维场景",
      goals: ["观察立方体和曲面"],
      variables: [{ as: "section_z", initial: 0, min: -2, max: 2, control: { kind: "slider", step: .1 } }],
    },
    steps: [{
      key: "show-scene",
      purpose: "建立可旋转三维场景",
      beats: [{
        key: "create-scene",
        say: "拖动场景，从不同方向观察立方体、曲面和截面。",
        actions: [{
          do: "write",
          as: "scene",
          kind: "scene3d",
          role: "diagram",
          content: {
            title: "立方体与抛物面",
            fallback: "立方体位于抛物面左侧，水平截面随滑杆上下移动。",
            axes: true,
            camera: { yaw: .7, pitch: .5, zoom: 1 },
            objects: [
              { as: "cube", kind: "box", center: { x: -1.5, y: 0, z: 0 }, size: { x: 1.5, y: 1.5, z: 1.5 }, color: "teal" },
              { as: "paraboloid", kind: "surface", expression: "0.3*(x^2+y^2)-1", x_range: { min: -2, max: 2 }, y_range: { min: -2, max: 2 }, samples: 8, color: "blue" },
            ],
            sections: [{
              as: "horizontal-section",
              axis: "z",
              value: 0,
              targets: ["cube", "paraboloid"],
              display: "plane_and_intersection",
              label: "z = 0",
              color: "orange",
            }],
            highlights: [
              { as: "vertex-a", kind: "point", points: [{ x: -2.25, y: -.75, z: .75 }], label: "顶点 A", color: "red" },
              { as: "edge-ab", kind: "edge", points: [{ x: -2.25, y: -.75, z: .75 }, { x: -.75, y: -.75, z: .75 }], label: "棱 AB", color: "orange" },
              { as: "top-face", kind: "face", points: [{ x: -2.25, y: -.75, z: .75 }, { x: -.75, y: -.75, z: .75 }, { x: -.75, y: .75, z: .75 }, { x: -2.25, y: .75, z: .75 }], label: "顶面", color: "purple" },
            ],
            bindings: [{ target: "horizontal-section.value", expression: "section_z" }],
          },
          place: { relation: "new_region" },
        }, {
          do: "focus",
          when: "after_speech",
          targets: ["scene"],
          intent: "current_step",
        }],
      }],
    }],
    close: { summary: "已经观察三维对象与截面。", focus: ["scene"] },
  };
  assertAuthoringSchema(sceneLesson);
  validateAuthoringLesson(sceneLesson);
  const events = normalizeAuthoringLesson(sceneLesson, {
    lessonId: "scene-lesson",
    boardId: "scene-board",
    baseRevision: 0,
  });
  const scene = Object.values(reduceCanonicalEvents(events).nodes)[0]!;
  assert.equal(scene.kind, "scene3d");
  assert.equal(scene.content.objects[1].expression, "0.3*(x^2+y^2)-1");
  assert.equal(scene.content.sections[0].id, `${scene.id}:fragment:horizontal-section`);
  assert.deepEqual(scene.content.sections[0].targets, [
    `${scene.id}:fragment:cube`,
    `${scene.id}:fragment:paraboloid`,
  ]);
  assert.equal(scene.content.highlights[2].id, `${scene.id}:fragment:top-face`);

  const invalid = structuredClone(sceneLesson);
  (invalid.steps[0]!.beats[0]!.actions[0] as any).content.objects[1].expression = "fetch(x)";
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_OPERATION_PAYLOAD",
  );

  const missingSectionTarget = structuredClone(sceneLesson);
  (missingSectionTarget.steps[0]!.beats[0]!.actions[0] as any)
    .content.sections[0].targets = ["missing-object"];
  assert.throws(
    () => validateAuthoringLesson(missingSectionTarget),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND",
  );

  const missingIntersectionTargets = structuredClone(sceneLesson);
  delete (missingIntersectionTargets.steps[0]!.beats[0]!.actions[0] as any)
    .content.sections[0].targets;
  assert.throws(
    () => validateAuthoringLesson(missingIntersectionTargets),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND",
  );
});

test("one lesson variable deterministically drives geometry and plot bindings", () => {
  const interactive = lessons.find(({ entry }) => entry.name === "unit-circle-sine")!;
  const events = normalizeAuthoringLesson(interactive.source, interactive.entry);
  let state = reduceCanonicalEvents(events);
  const geometryId = `${interactive.entry.lessonId}:node:unit-circle`;
  const plotId = `${interactive.entry.lessonId}:node:sine-plot`;
  const pointId = `${geometryId}:fragment:point-p`;
  const footId = `${geometryId}:fragment:foot`;
  const arcId = `${geometryId}:fragment:theta`;
  const currentId = `${plotId}:fragment:current-angle`;
  const cases = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2, 2 * Math.PI];

  assert.deepEqual(
    state.nodes[geometryId]!.content.points.find((item: any) => item.id === pointId).interaction,
    {
      kind: "angle_control",
      variable: "theta",
      center: `${geometryId}:fragment:origin`,
    },
  );

  for (const theta of cases) {
    state = setLessonVariable(state, "theta", theta);
    const geometry = state.nodes[geometryId]!;
    const plot = state.nodes[plotId]!;
    const point = geometry.content.points.find((item: any) => item.id === pointId);
    const foot = geometry.content.points.find((item: any) => item.id === footId);
    const arc = geometry.content.arcs.find((item: any) => item.id === arcId);
    const current = plot.content.points.find((item: any) => item.id === currentId);
    assert.ok(Math.abs(point.x - Math.cos(theta)) < 1e-12);
    assert.ok(Math.abs(point.y - Math.sin(theta)) < 1e-12);
    assert.ok(Math.abs(foot.x - Math.cos(theta)) < 1e-12);
    assert.ok(Math.abs(arc.end_angle - theta) < 1e-12);
    assert.ok(Math.abs(current.x - theta) < 1e-12);
    assert.ok(Math.abs(current.y - Math.sin(theta)) < 1e-12);
  }

  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(restored.variables.theta.value, 2 * Math.PI);
  assert.deepEqual(setLessonVariable(restored, "theta", Math.PI / 2), setLessonVariable(state, "theta", Math.PI / 2));
});

test("student tasks use declared variables and safe expression targets", () => {
  const interactive = structuredClone(lessons.find(({ entry }) => entry.name === "unit-circle-sine")!.source);
  interactive.lesson.tasks = [{
    as: "reach-sine-maximum",
    prompt: "把圆周点拖到 sin θ = 1",
    availability: { kind: "after_lesson" },
    allowed_operations: [{
      kind: "variable_change",
      variable: "theta",
      controls: ["slider", "geometry_point"],
    }],
    completion: {
      kind: "expression_target",
      expression: "sin(theta)",
      value: 1,
      tolerance: 0.01,
    },
    hints: ["观察圆周点的纵坐标。"],
    hint_after_attempts: 2,
    success_message: "找到了正弦函数的最大值。",
  }];

  validateAuthoringLesson(interactive);
  const events = normalizeAuthoringLesson(interactive, lessons.find(({ entry }) => entry.name === "unit-circle-sine")!.entry);
  assert.deepEqual(events[0]!.lesson?.tasks, interactive.lesson.tasks);

  const unknownVariable = structuredClone(interactive);
  (unknownVariable.lesson.tasks![0]!.allowed_operations[0] as any).variable = "missing";
  assert.throws(
    () => validateAuthoringLesson(unknownVariable),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND",
  );

  const unsafeExpression = structuredClone(interactive);
  (unsafeExpression.lesson.tasks![0]!.completion as any).expression = "window.alert(theta)";
  assert.throws(
    () => validateAuthoringLesson(unsafeExpression),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_STUDENT_TASK",
  );

  const unrelatedExpression = structuredClone(interactive);
  (unrelatedExpression.lesson.tasks![0]!.completion as any).expression = "1";
  assert.throws(
    () => validateAuthoringLesson(unrelatedExpression),
    (error) => error instanceof OllError
      && error.code === "OLL_INVALID_STUDENT_TASK"
      && /must read an allowed lesson variable/.test(error.message),
  );

  const unreachableExpression = structuredClone(interactive);
  (unreachableExpression.lesson.tasks![0]!.completion as any).value = 2;
  assert.throws(
    () => validateAuthoringLesson(unreachableExpression),
    (error) => error instanceof OllError
      && error.code === "OLL_INVALID_STUDENT_TASK"
      && /No reachable value/.test(error.message),
  );

  const sliderCannotReachRangeMaximum = structuredClone(interactive);
  sliderCannotReachRangeMaximum.lesson.variables![0]!.control!.step = 2;
  sliderCannotReachRangeMaximum.lesson.tasks![0]!.allowed_operations[0]!.controls = ["slider"];
  sliderCannotReachRangeMaximum.lesson.tasks![0]!.completion = {
    kind: "expression_target",
    expression: "theta",
    value: 2 * Math.PI,
    tolerance: 1e-6,
  };
  assert.throws(
    () => validateAuthoringLesson(sliderCannotReachRangeMaximum),
    (error) => error instanceof OllError
      && error.code === "OLL_INVALID_STUDENT_TASK"
      && /No reachable value/.test(error.message),
  );

  const missingGeometryControl = structuredClone(interactive);
  const geometry = missingGeometryControl.steps[0]!.beats[0]!.actions.find(
    (action) => action.do === "write" && action.kind === "geometry",
  );
  assert.ok(geometry?.do === "write");
  delete geometry.content.points.find((point: any) => point.as === "point-p")!.interaction;
  assert.throws(
    () => validateAuthoringLesson(missingGeometryControl),
    (error) => error instanceof OllError
      && error.code === "OLL_INVALID_STUDENT_TASK"
      && /geometry_point.*not available/.test(error.message),
  );
});

test("rejects invalid lesson variables and value bindings with explicit errors", () => {
  const interactive = lessons.find(({ entry }) => entry.name === "unit-circle-sine")!;

  const outOfRange = structuredClone(interactive.source);
  outOfRange.lesson.variables![0]!.initial = 7;
  assert.throws(
    () => validateAuthoringLesson(outOfRange),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_VARIABLE" && error.path === "/lesson/variables/0/initial",
  );

  const unknownInteractionVariable = structuredClone(interactive.source);
  (unknownInteractionVariable.steps[0]!.beats[0]!.actions[0] as any)
    .content.points[1].interaction.variable = "missing";
  assert.throws(
    () => validateAuthoringLesson(unknownInteractionVariable),
    (error) => error instanceof OllError
      && error.code === "OLL_REFERENCE_NOT_FOUND"
      && error.path.endsWith("/interaction/variable"),
  );

  const unknownInteractionCenter = structuredClone(interactive.source);
  (unknownInteractionCenter.steps[0]!.beats[0]!.actions[0] as any)
    .content.points[1].interaction.center = "missing-center";
  assert.throws(
    () => validateAuthoringLesson(unknownInteractionCenter),
    (error) => error instanceof OllError
      && error.code === "OLL_REFERENCE_NOT_FOUND"
      && error.path.endsWith("/interaction/center"),
  );

  const unknownVariable = structuredClone(interactive.source);
  (unknownVariable.steps[0]!.beats[0]!.actions[0] as any).content.bindings[0].expression = "cos(missing)";
  assert.throws(
    () => validateAuthoringLesson(unknownVariable),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_BINDING" && error.path.endsWith("/expression"),
  );

  const unknownTarget = structuredClone(interactive.source);
  (unknownTarget.steps[0]!.beats[0]!.actions[0] as any).content.bindings[0].target = "point-p.label";
  assert.throws(
    () => validateAuthoringLesson(unknownTarget),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND" && error.path.endsWith("/target"),
  );
});

test("normalizes variable animation and reduces it to the semantic end value", () => {
  const interactive = lessons.find(({ entry }) => entry.name === "unit-circle-sine")!;
  const events = normalizeAuthoringLesson(interactive.source, interactive.entry);
  const animation = events
    .flatMap((event) => event.step?.beats ?? [])
    .flatMap((beat) => Object.values(beat.stage).flat())
    .find((action) => action.op === "lesson.variable.animate");
  assert.deepEqual(animation?.animation, {
    variable: "theta",
    to: 2 * Math.PI,
    easing: "linear",
    duration_intent: "extended",
  });
  assert.equal(reduceCanonicalEvents(events).variables?.theta?.value, 2 * Math.PI);
});

test("rejects invalid variable animation declarations", () => {
  const interactive = lessons.find(({ entry }) => entry.name === "unit-circle-sine")!;
  const unknown = structuredClone(interactive.source);
  const animation = unknown.steps[0]!.beats[0]!.actions.find((action) => action.do === "animate")!;
  if (animation.do !== "animate") throw new Error("expected animation action");
  animation.variable = "missing";
  assert.throws(
    () => validateAuthoringLesson(unknown),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND" && error.path.endsWith("/variable"),
  );

  const outOfRange = structuredClone(interactive.source);
  const invalidAnimation = outOfRange.steps[0]!.beats[0]!.actions.find((action) => action.do === "animate")!;
  if (invalidAnimation.do !== "animate") throw new Error("expected animation action");
  invalidAnimation.value = 7;
  assert.throws(
    () => validateAuthoringLesson(outOfRange),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_VARIABLE" && error.path.endsWith("/value"),
  );

  const invalidEasing = structuredClone(interactive.source);
  const invalidEasingAnimation = invalidEasing.steps[0]!.beats[0]!.actions.find((action) => action.do === "animate")!;
  (invalidEasingAnimation as any).easing = "bounce";
  assert.throws(
    () => validateAuthoringLesson(invalidEasing),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_OPERATION_PAYLOAD" && error.path.endsWith("/easing"),
  );

  const invalidDuration = structuredClone(interactive.source);
  const invalidDurationAnimation = invalidDuration.steps[0]!.beats[0]!.actions.find((action) => action.do === "animate")!;
  (invalidDurationAnimation as any).duration_intent = "500ms";
  assert.throws(
    () => validateAuthoringLesson(invalidDuration),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_OPERATION_PAYLOAD" && error.path.endsWith("/duration_intent"),
  );
});
