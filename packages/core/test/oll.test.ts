import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertAuthoringSchema,
  compileMathExpression,
  checkNumericAnswer,
  formatBoundNumericLabel,
  isSimplestFraction,
  parseNumericAnswer,
  assertExecutionDeclaration,
  assertExecutionSupported,
  deriveExecutionRequirements,
  evaluateContentBindings,
  OLL_ACTION_NAMES,
  OLL_BINDING_CAPABILITIES,
  OLL_EXECUTION_CAPABILITIES,
  OLL_EXPRESSION_CAPABILITIES,
  OLL_NODE_KINDS,
  OllError,
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
  setLessonVariable,
  validateAuthoringSchema,
  validateAuthoringLesson,
  type AuthoringAnswerStudentTask,
  type AuthoringLesson,
  type AuthoringVariableStudentTask,
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

test("normalizes a host-provided external board reference without rewriting it", () => {
  const lesson = structuredClone(source);
  lesson.board_context = {
    board_id: host.boardId,
    revision: 12,
    references: [{
      as: "selected-formula",
      type: "node",
      target_id: "prior-lesson:node:formula",
      label: "上一节课的函数",
      fragments: [{
        as: "selected-part",
        target_id: "prior-lesson:node:formula:fragment:quadratic",
      }],
    }],
  };
  (lesson.steps[0]!.beats[0]!.actions[0]! as any).place = {
    relation: "near",
    anchor: "selected-formula",
  };
  lesson.steps[0]!.beats[0]!.actions.push({
    do: "point",
    target: "selected-formula#selected-part",
  });
  assert.deepEqual(validateAuthoringSchema(lesson), { valid: true, errors: [] });
  validateAuthoringLesson(lesson);
  const events = normalizeAuthoringLesson(lesson, {
    ...host,
    baseRevision: 12,
  });
  const actions = events[1]!.step!.beats[0]!.stage;
  assert.equal(
    actions.during_speech[0]!.node?.placement?.anchor,
    "prior-lesson:node:formula",
  );
  assert.deepEqual(actions.during_speech.at(-1)!.target, {
    node_id: "prior-lesson:node:formula",
    fragment_id: "prior-lesson:node:formula:fragment:quadratic",
  });
});

test("keeps external board references read-only and revision-bound", () => {
  const lesson = structuredClone(source);
  lesson.board_context = {
    board_id: host.boardId,
    revision: 3,
    references: [{
      as: "old-node",
      type: "node",
      target_id: "old:node",
      fragments: [],
    }],
  };
  lesson.steps[0]!.beats[0]!.actions.push({
    do: "revise",
    target: "old-node",
    content: { text: "changed" },
    reason: "must stay immutable",
  });
  assert.throws(
    () => validateAuthoringLesson(lesson),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_REFERENCE",
  );
  lesson.steps[0]!.beats[0]!.actions.pop();
  assert.throws(
    () => normalizeAuthoringLesson(lesson, { ...host, baseRevision: 4 }),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_REFERENCE",
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
    hide: ["target"],
    view: ["target"],
    tap: ["target", "tap", "at"],
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

test("publishes only the executable node, action, binding, control, and task capabilities", () => {
  assert.deepEqual(OLL_EXECUTION_CAPABILITIES, {
    version: "0.1",
    node_kinds: OLL_NODE_KINDS,
    plugin_node_kinds: ["number_line", "fraction_model", "base_ten_trade", "place_value_chart"],
    action_names: OLL_ACTION_NAMES,
    value_bindings: OLL_BINDING_CAPABILITIES,
    card_value_bindings: { place_value_chart: ["target"] },
    binding_labels: { precision: { min: 0, max: 6 }, prefix: true, suffix: true },
    bound_radius: { allow_zero: true, default: "positive" },
    variable_expressions: OLL_EXPRESSION_CAPABILITIES,
    student_controls: {
      variable: ["slider", "geometry_point", "number_line_point"],
      scene3d: ["orbit", "zoom", "preset", "reset"],
    },
    student_tasks: {
      completion: ["expression_target", "scene3d_view_target", "numeric_answer", "card_fact", "numeric_row"],
      scene3d_view_match: ["view_direction", "camera_pose"],
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(OLL_EXECUTION_CAPABILITIES)), OLL_EXECUTION_CAPABILITIES);
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
              { as: "superellipsoid", kind: "implicit_surface", expression: "x^4+y^4+z^4-1", level: 0, x_range: { min: -1.2, max: 1.2 }, y_range: { min: -1.2, max: 1.2 }, z_range: { min: -1.2, max: 1.2 }, samples: 10, color: "purple" },
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
  const movedScene = Object.values(setLessonVariable(
    reduceCanonicalEvents(events),
    "section_z",
    1.25,
  ).nodes)[0]!;
  assert.equal(movedScene.content.sections[0].value, 1.25);

  // A slider opens the cube into its net; past either end the net stays closed or flat.
  const netLesson = structuredClone(sceneLesson) as any;
  netLesson.lesson.variables.push({ as: "open", initial: 0, min: 0, max: 1, control: { kind: "slider", step: .1 } });
  netLesson.steps[0].beats[0].actions[0].content.objects[0].unfold = 0;
  netLesson.steps[0].beats[0].actions[0].content.bindings.push({ target: "cube.unfold", expression: "2*open" });
  validateAuthoringLesson(netLesson);
  const netState = reduceCanonicalEvents(normalizeAuthoringLesson(netLesson, { lessonId: "net-lesson", boardId: "net-board", baseRevision: 0 }));
  const cubeAt = (value: number) => Object.values(setLessonVariable(netState, "open", value).nodes)[0]!.content.objects[0].unfold;
  assert.equal(cubeAt(0.25), 0.5);
  assert.equal(cubeAt(1), 1);

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

test("validates a two-variable implicit plot and rejects an invisible level", () => {
  const lesson: AuthoringLesson = {
    dsl: "octos.lesson",
    version: "0.1",
    profile: "authoring",
    lesson: {
      mode: "explain",
      language: "zh-CN",
      title: "隐式曲线",
      goals: ["观察不能写成单值 y=f(x) 的曲线"],
    },
    steps: [{
      key: "show-implicit-curve",
      purpose: "显示圆的隐式方程",
      beats: [{
        key: "draw-circle",
        say: "这是方程 x²+y²=1 的图像。",
        actions: [{
          do: "write",
          as: "implicit-circle",
          kind: "plot",
          role: "diagram",
          content: {
            axes: {
              x: { min: -1.5, max: 1.5 },
              y: { min: -1.5, max: 1.5 },
            },
            curves: [{
              as: "circle",
              kind: "implicit",
              expression: "x^2+y^2",
              level: 1,
              samples: 80,
            }],
          },
          place: { relation: "new_region" },
        }, {
          do: "focus",
          when: "after_speech",
          targets: ["implicit-circle"],
          intent: "current_step",
        }],
      }],
    }],
    close: { summary: "已经看到隐式圆。", focus: ["implicit-circle"] },
  };
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);

  const invisible = structuredClone(lesson);
  (invisible.steps[0]!.beats[0]!.actions[0] as any).content.curves[0].level = 100;
  assert.throws(
    () => validateAuthoringLesson(invisible),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_OPERATION_PAYLOAD",
  );
});

test("validates explicit plot curves that read declared lesson variables", () => {
  const lesson: AuthoringLesson = {
    dsl: "octos.lesson",
    version: "0.1",
    profile: "authoring",
    lesson: {
      mode: "explain",
      language: "zh-CN",
      title: "参数改变抛物线",
      goals: ["观察顶点随 h 和 k 移动"],
      variables: [
        { as: "number_01", initial: 0, min: -5, max: 5, control: { kind: "slider", step: 1 } },
        { as: "number_02", initial: 0, min: -5, max: 5, control: { kind: "slider", step: 1 } },
      ],
    },
    steps: [{
      key: "shift-parabola",
      purpose: "用两个数值移动整条曲线",
      beats: [{
        key: "show-shift",
        say: "拖动两个滑杆，整条曲线会重新绘制。",
        actions: [{
          do: "write",
          as: "shifted-parabola",
          kind: "plot",
          role: "diagram",
          content: {
            axes: { x: { min: -6, max: 6 }, y: { min: -6, max: 12 } },
            curves: [{
              as: "primary-curve",
              expression: "(x-number_01)^2+number_02",
              label: "y=(x-h)²+k",
            }],
          },
          place: { relation: "new_region" },
        }],
      }],
    }],
    close: { summary: "顶点是 (h,k)。", focus: ["shifted-parabola"] },
  };

  assert.deepEqual(OLL_EXPRESSION_CAPABILITIES.plot.curves, ["expression"]);
  assert.deepEqual(OLL_EXECUTION_CAPABILITIES.variable_expressions, OLL_EXPRESSION_CAPABILITIES);
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);

  const unknown = structuredClone(lesson);
  (unknown.steps[0]!.beats[0]!.actions[0] as any).content.curves[0].expression = "(x-h)^2+k";
  assert.throws(
    () => validateAuthoringLesson(unknown),
    (error) => error instanceof OllError
      && error.code === "OLL_INVALID_OPERATION_PAYLOAD"
      && /Unknown variable or function 'h'/u.test(error.message),
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

test("geometry polygons reference normalized points and follow point bindings", () => {
  const interactive = structuredClone(lessons.find(({ entry }) => entry.name === "unit-circle-sine")!.source);
  const host = lessons.find(({ entry }) => entry.name === "unit-circle-sine")!.entry;
  const actions = interactive.steps.flatMap((step) => step.beats.flatMap((beat) => beat.actions));
  const geometry = actions.find((action) => action.do === "write" && action.kind === "geometry") as any;
  geometry.content.polygons = [{
    as: "moving-triangle",
    points: ["origin", "point-p", "foot"],
    label: "随点移动的三角形",
    tone: "accent",
  }];

  assertAuthoringSchema(interactive);
  validateAuthoringLesson(interactive);
  const state = setLessonVariable(
    reduceCanonicalEvents(normalizeAuthoringLesson(interactive, host)),
    "theta",
    Math.PI / 2,
  );
  const node = state.nodes[`${host.lessonId}:node:unit-circle`]!;
  assert.deepEqual(node.content.polygons[0], {
    id: `${node.id}:fragment:moving-triangle`,
    points: [
      `${node.id}:fragment:origin`,
      `${node.id}:fragment:point-p`,
      `${node.id}:fragment:foot`,
    ],
    label: "随点移动的三角形",
    tone: "accent",
  });
  assert.equal(node.content.points.find((point: any) => point.id.endsWith(":point-p")).y, 1);

  const missingPoint = structuredClone(interactive);
  const missingGeometry = missingPoint.steps.flatMap((step) => step.beats.flatMap((beat) => beat.actions))
    .find((action) => action.do === "write" && action.kind === "geometry") as any;
  missingGeometry.content.polygons[0].points[2] = "not-defined";
  assert.throws(
    () => validateAuthoringLesson(missingPoint),
    (error) => error instanceof OllError
      && error.code === "OLL_REFERENCE_NOT_FOUND"
      && error.path.endsWith("/polygons/0/points/2"),
  );
});

test("every declared geometry and plot binding capability validates and executes", () => {
  const interactive = structuredClone(lessons.find(({ entry }) => entry.name === "unit-circle-sine")!.source);
  const actions = interactive.steps.flatMap((step) => step.beats.flatMap((beat) => beat.actions));
  const geometry = actions.find((action) => action.do === "write" && action.kind === "geometry") as any;
  const plot = actions.find((action) => action.do === "write" && action.kind === "plot") as any;

  geometry.content.bindings = [
    { target: "point-p.x", expression: "theta" },
    { target: "point-p.y", expression: "theta" },
    { target: "circle.radius", expression: "1 + theta * 0.1" },
    { target: "theta.radius", expression: "0.2 + theta * 0.05" },
    { target: "theta.start_angle", expression: "theta * 0.1" },
    { target: "theta.end_angle", expression: "theta" },
  ];
  plot.content.guides = [{ as: "current-guide", axis: "x", value: 0, label: "当前角度" }];
  plot.content.intervals = [{ as: "current-range", axis: "y", from: 0, to: 1 }];
  plot.content.bindings = [
    { target: "current-angle.x", expression: "theta" },
    { target: "current-angle.y", expression: "theta" },
    { target: "current-guide.value", expression: "theta" },
    { target: "current-range.from", expression: "theta - 1" },
    { target: "current-range.to", expression: "theta" },
  ];

  assert.deepEqual(Object.keys(OLL_BINDING_CAPABILITIES.geometry), ["points", "circles", "regular_polygons", "arcs"]);
  assert.deepEqual(Object.keys(OLL_BINDING_CAPABILITIES.plot), ["points", "guides", "intervals"]);
  validateAuthoringLesson(interactive);

  const host = lessons.find(({ entry }) => entry.name === "unit-circle-sine")!.entry;
  const state = setLessonVariable(reduceCanonicalEvents(normalizeAuthoringLesson(interactive, host)), "theta", 1);
  const geometryNode = state.nodes[`${host.lessonId}:node:unit-circle`]!;
  const plotNode = state.nodes[`${host.lessonId}:node:sine-plot`]!;
  const byId = (content: any, collection: string, alias: string) => content[collection]
    .find((item: any) => item.id === `${content === geometryNode.content ? geometryNode.id : plotNode.id}:fragment:${alias}`);

  assert.equal(byId(geometryNode.content, "points", "point-p").x, 1);
  assert.equal(byId(geometryNode.content, "points", "point-p").y, 1);
  assert.equal(byId(geometryNode.content, "circles", "circle").radius, 1.1);
  assert.equal(byId(geometryNode.content, "arcs", "theta").radius, 0.25);
  assert.equal(byId(geometryNode.content, "arcs", "theta").start_angle, 0.1);
  assert.equal(byId(geometryNode.content, "arcs", "theta").end_angle, 1);
  assert.equal(byId(plotNode.content, "points", "current-angle").x, 1);
  assert.equal(byId(plotNode.content, "points", "current-angle").y, 1);
  assert.equal(byId(plotNode.content, "guides", "current-guide").value, 1);
  assert.equal(byId(plotNode.content, "intervals", "current-range").from, 0);
  assert.equal(byId(plotNode.content, "intervals", "current-range").to, 1);
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
  (sliderCannotReachRangeMaximum.lesson.tasks![0] as AuthoringVariableStudentTask).allowed_operations[0]!.controls = ["slider"];
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


test("bound radius labels share the numerical binding and explicitly support zero", () => {
  const lesson = unitCircleLesson();
  lesson.lesson.variables = [{ as: "h", initial: 1, min: 0, max: 8, control: { kind: "slider", step: .04 } }];
  const geometry = lesson.steps[0]!.beats[0]!.actions[0]!;
  assert.equal(geometry.do, "write");
  if (geometry.do !== "write") return;
  geometry.content.bindings = [{ target: "circle.radius", expression: "sqrt(h)", allow_zero: true,
    label: { prefix: "r = ", precision: 2 } }];
  assertAuthoringSchema(lesson);
  const events = normalizeAuthoringLesson(lesson, host);
  const requirements = deriveExecutionRequirements(events);
  assert.equal(requirements.minimumPlayerVersion, "0.2.0");
  assert.ok(requirements.requiredCapabilities.includes("binding-labels"));
  assert.throws(() => assertExecutionSupported(events, "0.1.0"), /requires player/);
  assert.throws(() => assertExecutionDeclaration(events, { minimumPlayerVersion: "0.2.0" }), /require a capability declaration/);
  const original = reduceCanonicalEvents(events);
  for (const [h, expected] of [[0, "r = 0"], [1, "r = 1"], [4, "r = 2"], [8, "r = 2.83"]] as const) {
    const board = setLessonVariable(original, "h", h);
    const circle = board.nodes[`${host.lessonId}:node:unit-circle`]!.content.circles[0];
    assert.equal(circle.radius, Math.sqrt(h));
    assert.equal(circle.label, expected);
  }
  delete geometry.content.bindings[0].allow_zero;
  const legacy = reduceCanonicalEvents(normalizeAuthoringLesson(lesson, host));
  assert.throws(() => setLessonVariable(legacy, "h", 0), /Bound radius/);
  assert.equal(legacy.variables!.h!.value, 1);
  geometry.content.bindings[0].expression = "-h";
  geometry.content.bindings[0].allow_zero = true;
  assert.throws(() => reduceCanonicalEvents(normalizeAuthoringLesson(lesson, host)), /Bound radius/);
});

test("numeric labels trim trailing zeros, remove negative zero, and reject invalid precision", () => {
  assert.equal(formatBoundNumericLabel(-.0001, { precision: 2 }), "0");
  assert.equal(formatBoundNumericLabel(2, { precision: 6, suffix: " cm" }), "2 cm");
  assert.throws(() => formatBoundNumericLabel(Infinity, { precision: 2 }), /non-finite/);
  assert.throws(() => formatBoundNumericLabel(2, { precision: 7 }), /precision/);
});

test("reflections anchor to a written card, normalize to its canonical ID and require the newer player", () => {
  const lesson = unitCircleLesson();
  lesson.lesson.reflections = [{
    as: "think-radius",
    prompt: "半径变为原来的几倍？",
    answer: "两倍。",
    anchor: "unit-circle",
    availability: { kind: "after_lesson" },
  }];
  assertAuthoringSchema(lesson);
  const events = normalizeAuthoringLesson(lesson, host);
  assert.equal(events[0]!.lesson!.reflections![0]!.anchor, `${host.lessonId}:node:unit-circle`);
  const requirements = deriveExecutionRequirements(events);
  assert.equal(requirements.minimumPlayerVersion, "0.3.0");
  assert.ok(requirements.requiredCapabilities.includes("reflections"));
  assert.throws(() => assertExecutionSupported(events, "0.2.0"), /requires player/);

  const missingAnchor = structuredClone(lesson);
  missingAnchor.lesson.reflections![0]!.anchor = "not-written";
  assert.throws(() => normalizeAuthoringLesson(missingAnchor, host), (error) => error instanceof OllError
    && error.path === "/lesson/reflections/0/anchor");
  const emptyAnswer = structuredClone(lesson);
  emptyAnswer.lesson.reflections![0]!.answer = " ";
  assert.throws(() => normalizeAuthoringLesson(emptyAnswer, host), (error) => error instanceof OllError
    && error.code === "OLL_INVALID_REFLECTION");
});

test("numeric answers read whole numbers, decimals, fractions, mixed numbers and full-width input", () => {
  assert.deepEqual(parseNumericAnswer("-12"), { value: -12, form: "integer" });
  assert.deepEqual(parseNumericAnswer("12,450"), { value: 12450, form: "integer" });
  assert.deepEqual(parseNumericAnswer(".5"), { value: .5, form: "decimal" });
  assert.deepEqual(parseNumericAnswer(" 3 / 4 "), { value: .75, form: "fraction", numerator: 3, denominator: 4 });
  assert.deepEqual(parseNumericAnswer("-2 3/4"), { value: -2.75, form: "mixed", numerator: 3, denominator: 4 });
  assert.equal(parseNumericAnswer("１２．５")?.value, 12.5);
  assert.equal(parseNumericAnswer("－３／４")?.value, -.75);
  for (const unreadable of ["", "abc", "1/0", "2 5/4", "1,23", "3+4", "1e5", "--1", "2 0/3"]) {
    assert.equal(parseNumericAnswer(unreadable), undefined, unreadable);
  }
  // Each spelling of one rational number is the same double, so exact means exact.
  assert.equal(parseNumericAnswer("4/3")!.value, parseNumericAnswer("1 1/3")!.value);
  assert.equal(parseNumericAnswer("0.1")!.value, parseNumericAnswer("1/10")!.value);
  assert.notEqual(parseNumericAnswer("0.333")!.value, parseNumericAnswer("1/3")!.value);

  const exact = { kind: "numeric_answer" as const, answer: "3/4" };
  assert.deepEqual(checkNumericAnswer(exact, "6/8"), { readable: true, value: .75, succeeded: true });
  assert.deepEqual(checkNumericAnswer(exact, "0.75"), { readable: true, value: .75, succeeded: true });
  assert.deepEqual(checkNumericAnswer(exact, "0.7"), { readable: true, value: .7, succeeded: false, reason: "value" });
  assert.deepEqual(checkNumericAnswer(exact, "三分之二"), { readable: false });
  const simplest = { ...exact, form: "simplest_fraction" as const };
  assert.deepEqual(checkNumericAnswer(simplest, "6/8"), { readable: true, value: .75, succeeded: false, reason: "form" });
  assert.deepEqual(checkNumericAnswer(simplest, "0.75"), { readable: true, value: .75, succeeded: false, reason: "form" });
  assert.equal(isSimplestFraction(parseNumericAnswer("4/1")!), false);
  assert.equal(isSimplestFraction(parseNumericAnswer("2")!), true);
  const rounded = { kind: "numeric_answer" as const, answer: "3.14", tolerance: .005 };
  assert.deepEqual(checkNumericAnswer(rounded, "3.142"), { readable: true, value: 3.142, succeeded: true });
});

test("numeric answer tasks anchor to a written card, validate their answer and require the newer player", () => {
  const lesson = unitCircleLesson();
  lesson.lesson.tasks = [{
    as: "radius-times",
    anchor: "unit-circle",
    prompt: "半径为 3 的圆，直径是多少？",
    availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "answer_entry" }],
    completion: { kind: "numeric_answer", answer: "6", unit: "cm" },
    hints: ["直径是半径的两倍。"],
  }];
  assertAuthoringSchema(lesson);
  const events = normalizeAuthoringLesson(lesson, host);
  const task = events[0]!.lesson!.tasks![0] as AuthoringAnswerStudentTask;
  assert.equal(task.anchor, `${host.lessonId}:node:unit-circle`);
  const requirements = deriveExecutionRequirements(events);
  assert.equal(requirements.minimumPlayerVersion, "0.5.0");
  assert.ok(requirements.requiredCapabilities.includes("student-tasks:numeric_answer"));
  assert.throws(() => assertExecutionSupported(events, "0.4.0"), /requires player/);

  const invalid = (change: (task: AuthoringAnswerStudentTask) => void, path: string) => {
    const copy = structuredClone(lesson);
    change(copy.lesson.tasks![0] as AuthoringAnswerStudentTask);
    assert.throws(() => normalizeAuthoringLesson(copy, host), (error) => error instanceof OllError
      && error.path === path, path);
  };
  invalid((task) => { task.anchor = "not-written"; }, "/lesson/tasks/0/anchor");
  invalid((task) => { task.completion.answer = "six"; }, "/lesson/tasks/0/completion/answer");
  invalid((task) => { task.completion.answer = "6/8"; task.completion.form = "simplest_fraction"; }, "/lesson/tasks/0/completion/answer");
  invalid((task) => { task.completion.tolerance = -1; }, "/lesson/tasks/0/completion/tolerance");
  invalid((task) => { task.hints = [" "]; }, "/lesson/tasks/0/hints");

  const missingAnchor = structuredClone(lesson);
  delete (missingAnchor.lesson.tasks![0] as Partial<AuthoringAnswerStudentTask>).anchor;
  assert.throws(() => assertAuthoringSchema(missingAnchor));
  // Only a typed answer sits by a card; other tasks live by their visual.
  const strayAnchor = structuredClone(lesson);
  strayAnchor.lesson.tasks![0]!.completion = { kind: "expression_target", expression: "a", value: 1, tolerance: .1 };
  assert.throws(() => assertAuthoringSchema(strayAnchor));
});

test("a point bound with hide_when_undefined disappears while undefined and returns afterwards", () => {
  const content = {
    points: [{ id: "cross", x: 0, y: 0, label: "交点 ({x}, {y})" }],
    bindings: [
      { target: "cross.x", expression: "(b2-b1)/(k1-k2)", hide_when_undefined: true },
      { target: "cross.y", expression: "k1*((b2-b1)/(k1-k2))+b1", hide_when_undefined: true },
    ],
  };
  const crossing = evaluateContentBindings(content, { k1: 1, b1: 1, k2: -1, b2: 3 });
  assert.deepEqual([crossing.points[0].x, crossing.points[0].y, crossing.points[0].binding_undefined], [1, 2, undefined]);
  const parallel = evaluateContentBindings(crossing, { k1: 1, b1: 1, k2: 1, b2: -2 });
  assert.equal(parallel.points[0].binding_undefined, true, "parallel lines hide the intersection instead of failing");
  const again = evaluateContentBindings(parallel, { k1: 1, b1: 1, k2: -1, b2: 3 });
  assert.equal(again.points[0].binding_undefined, undefined, "the point returns once it is defined again");
  assert.throws(() => evaluateContentBindings({ points: content.points, bindings: [{ target: "cross.x", expression: "1/(k1-k2)" }] },
    { k1: 1, k2: 1 }), (error) => error instanceof OllError && error.code === "OLL_BINDING_EVALUATION_FAILED",
  "without the option an undefined value still fails");
});

test("plot view fields: adaptive layout, sample following, π ticks and holes are validated", () => {
  const lesson = (content: Record<string, unknown>): AuthoringLesson => ({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "zh-CN", title: "函数图像", goals: ["观察图像"] },
    steps: [{ key: "show", purpose: "显示图像", beats: [{ key: "draw", say: "这是图像。", actions: [{
      do: "write", as: "graph", kind: "plot", role: "diagram", content, place: { relation: "new_region" },
    }, { do: "focus", when: "after_speech", targets: ["graph"], intent: "current_step" }] }] }],
    close: { summary: "看过图像。", focus: ["graph"] },
  });
  const valid = {
    axes: { equal_scale: true, layout: "adaptive", follow_samples: true,
      x: { min: -6.283185307179586, max: 6.283185307179586, ticks: "pi" }, y: { min: -2, max: 3 } },
    curves: [{ as: "curve", expression: "(x^2-1)/(x-1)", holes: [{ x: 1, y: 2 }] }],
  };
  assertAuthoringSchema(lesson(valid));
  validateAuthoringLesson(lesson(valid));
  const invalid: Array<[string, (content: any) => void]> = [
    ["layout without equal units", content => { delete content.axes.equal_scale; }],
    ["unknown tick unit", content => { content.axes.x.ticks = "degrees"; }],
    ["non-boolean sample following", content => { content.axes.follow_samples = "yes"; }],
    ["non-finite hole", content => { content.curves[0].holes = [{ x: 1, y: null }]; }],
  ];
  for (const [name, change] of invalid) {
    const content = structuredClone(valid);
    change(content);
    assert.throws(() => validateAuthoringLesson(lesson(content)),
      (error) => error instanceof OllError && error.code === "OLL_INVALID_OPERATION_PAYLOAD", name);
  }
});

test("decision 0018: pieces of a function, intervals on the axes and hidden guides are validated and need player 0.11.0", () => {
  const lesson = (content: Record<string, unknown>, variables?: AuthoringLesson["lesson"]["variables"]): AuthoringLesson => ({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "zh-CN", title: "函数图像", goals: ["观察图像"], ...(variables ? { variables } : {}) },
    steps: [{ key: "show", purpose: "显示图像", beats: [{ key: "draw", say: "这是图像。", actions: [{
      do: "write", as: "graph", kind: "plot", role: "diagram", content, place: { relation: "new_region" },
    }] }] }],
    close: { summary: "看过图像。", focus: ["graph"] },
  });
  const host = { lessonId: "pieces", boardId: "board", baseRevision: 0, regionIntent: "new_topic" } as const;
  const requirements = (content: Record<string, unknown>, variables?: AuthoringLesson["lesson"]["variables"]) =>
    deriveExecutionRequirements(normalizeAuthoringLesson(lesson(content, variables), host));
  const axes = { x: { min: -4, max: 4 }, y: { min: -3, max: 4 } };
  const pieces = { axes, curves: [
    { as: "left", expression: "x + 1", to: 0, to_closed: false, series: "f" },
    { as: "right", expression: "2", from: 0, from_closed: true, series: "f" },
  ] };
  const piecesNeed = requirements(pieces);
  assert.ok(piecesNeed.requiredCapabilities.includes("plot:curve-intervals"));
  assert.equal(piecesNeed.minimumPlayerVersion, "0.11.0", "an older player would draw each piece as the whole curve");
  const domain = { axes, curves: [{ as: "f", expression: "sqrt(x)" }], intervals: [
    { as: "dom", axis: "x", from: 0, to: null, from_closed: true, label: "定义域" },
    { as: "point", axis: "y", from: 1, to: 1 },
  ] };
  assert.ok(requirements(domain).requiredCapabilities.includes("plot:axis-intervals"));
  // A range that flips with the sign of a: each bar's end exists only for one sign, the other is hidden.
  const a = [{ as: "a", initial: 1, min: -2, max: 2, label: "a" }];
  const flip = { axes, curves: [{ as: "f", expression: "a*(x-1)^2+1" }],
    intervals: [{ as: "up", axis: "y", from: 1, to: null }, { as: "down", axis: "y", from: null, to: 1 }],
    bindings: [{ target: "up.from", expression: "1 + 0*log(a)", hide_when_undefined: true }, { target: "down.to", expression: "1 + 0*log(-a)", hide_when_undefined: true }] };
  validateAuthoringLesson(lesson(flip, a));
  const events = normalizeAuthoringLesson(lesson(flip, a), host);
  const node = Object.values(reduceCanonicalEvents(events).nodes)[0]!;
  const down = evaluateContentBindings(node.content as Record<string, any>, { a: -1 });
  assert.deepEqual(down.intervals.map((interval: Record<string, unknown>) => interval.binding_undefined ?? false), [true, false]);
  // A guide hidden when undefined (the symmetry axis of a flattened parabola) is a new player feature.
  const axis = { axes, curves: [{ as: "f", expression: "a*x^2+2*x" }], guides: [{ as: "sym", kind: "vertical_line", value: -1 }],
    bindings: [{ target: "sym.value", expression: "-1/a", hide_when_undefined: true }] };
  const axisNeed = requirements(axis, a);
  assert.ok(axisNeed.requiredCapabilities.includes("plot:guide-hide-undefined"));
  const flattened = evaluateContentBindings(Object.values(reduceCanonicalEvents(normalizeAuthoringLesson(lesson(axis, a), host)).nodes)[0]!.content as Record<string, any>, { a: 0 });
  assert.equal(flattened.guides[0].binding_undefined, true);
  // A point hidden when undefined may start hidden: the parabola starts above the x-axis.
  const k = [{ as: "k", initial: 2, min: -3, max: 3, label: "k" }];
  const roots = { axes, curves: [{ as: "f", expression: "x^2+k" }], points: [{ as: "root", x: 0, y: 0 }], bindings: [{ target: "root.x", expression: "sqrt(-k)", hide_when_undefined: true }] };
  validateAuthoringLesson(lesson(roots, k));
  const unflagged = structuredClone(roots);
  delete (unflagged.bindings[0] as Record<string, unknown>).hide_when_undefined;
  assert.throws(() => validateAuthoringLesson(lesson(unflagged, k)), (error) => error instanceof OllError && error.code === "OLL_INVALID_BINDING", "without the option the start must be defined");
  // Pieces that meet where one end is open are one function: a jump at 1, and a hole between open ends.
  validateAuthoringLesson(lesson({ axes, curves: [{ as: "l", expression: "x", to: 1, series: "f" }, { as: "r", expression: "2", from: 1, from_closed: false, series: "f" }] }));
  validateAuthoringLesson(lesson({ axes, curves: [{ as: "l", expression: "x", to: 1, to_closed: false, series: "f" }, { as: "r", expression: "2", from: 1, from_closed: false, series: "f" }] }));
  // A secant over the first two of more points (an intercept mark after A and B) needs the new player:
  // an older one drew no triangle unless there were exactly two points.
  const secant = { axes, curves: [{ as: "f", expression: "2*x-1" }], measurement: "secant",
    points: [{ as: "a", x: 0, y: -1 }, { as: "b", x: 1, y: 1 }, { as: "yi", x: 0, y: -1 }] };
  assert.ok(requirements(secant).requiredCapabilities.includes("plot:secant-first-two"));
  assert.ok(!requirements({ ...secant, points: secant.points.slice(0, 2) }).requiredCapabilities.includes("plot:secant-first-two"));
  // Lessons without the new fields keep their requirements.
  assert.equal(requirements({ axes, curves: [{ as: "f", expression: "x^2" }] }).minimumPlayerVersion, "0.1.0");
  const invalid: Array<[string, Record<string, unknown>, string]> = [
    ["reversed piece", { axes, curves: [{ as: "f", expression: "x", from: 2, to: 1 }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["closed flag on an unbounded side", { axes, curves: [{ as: "f", expression: "x", to: 1, from_closed: true }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["implicit piece", { axes, curves: [{ as: "f", kind: "implicit", expression: "x^2+y^2", level: 1, from: 0 }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["pieces overlapping", { axes, curves: [{ as: "l", expression: "x", to: 1, series: "f" }, { as: "r", expression: "2", from: 0, series: "f" }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["pieces both closed where they meet", { axes, curves: [{ as: "l", expression: "x", to: 1, series: "f" }, { as: "r", expression: "2", from: 1, series: "f" }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["two unbounded pieces", { axes, curves: [{ as: "l", expression: "x", series: "f" }, { as: "r", expression: "2", from: 1, from_closed: false, series: "f" }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["bad series name", { axes, curves: [{ as: "f", expression: "x", series: "Piece 1" }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["interval off the axes", { axes, curves: [{ as: "f", expression: "x" }], intervals: [{ as: "i", axis: "z", from: 0, to: 1 }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["interval without to", { axes, curves: [{ as: "f", expression: "x" }], intervals: [{ as: "i", axis: "x", from: 0 }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["reversed interval", { axes, curves: [{ as: "f", expression: "x" }], intervals: [{ as: "i", axis: "x", from: 2, to: 1 }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["open single value", { axes, curves: [{ as: "f", expression: "x" }], intervals: [{ as: "i", axis: "y", from: 1, to: 1, to_closed: false }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["closed flag on an unbounded end", { axes, curves: [{ as: "f", expression: "x" }], intervals: [{ as: "i", axis: "x", from: null, to: 1, from_closed: true }] }, "OLL_INVALID_OPERATION_PAYLOAD"],
    ["hide_when_undefined set to false", { axes, curves: [{ as: "f", expression: "x" }], guides: [{ as: "g", kind: "vertical_line", value: 1 }], bindings: [{ target: "g.value", expression: "1", hide_when_undefined: false }] }, "OLL_INVALID_BINDING"],
  ];
  for (const [name, content, code] of invalid) {
    assert.throws(() => validateAuthoringLesson(lesson(content)), (error) => error instanceof OllError && error.code === code, name);
  }
});

test("log is the common logarithm and ln the natural logarithm", () => {
  assert.equal(compileMathExpression("log(1000)", [])({}), 3);
  assert.equal(compileMathExpression("log(0.01)", [])({}), -2);
  assert.ok(Math.abs(compileMathExpression("ln(e)", [])({}) - 1) < 1e-12);
  // Change of base gives the same value whichever base log has.
  assert.ok(Math.abs(compileMathExpression("log(8)/log(2)", [])({}) - 3) < 1e-12);
});

test("card tasks (decision 0023): a trading card, its taps bound to whole-range variables, a starting pile and a practice pile", () => {
  const variable = (as: string, initial: number, max: number) => ({ as, initial, min: 0, max, label: as });
  const base = (overrides: { variables?: unknown[]; task?: Record<string, unknown>; content?: Record<string, unknown> } = {}) => ({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: "en-US", title: "Trading", goals: ["Ten ones make a ten"],
      variables: overrides.variables ?? [variable("ones", 14, 59), variable("tray_ones", 0, 10), variable("tens", 3, 9)],
      tasks: [{
        as: "trade", prompt: "Make tens, then tap I'm done.", availability: { kind: "after_lesson" },
        allowed_operations: [{ kind: "card_tap", node: "mat" }, { kind: "card_submit" }],
        completion: { kind: "card_fact", node: "mat", fact: "no_trade_left" }, hints: ["Put ones in the tray; when ten fill it, make a ten."],
        start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 17, tens: 2 } },
        ...overrides.task,
      }],
    },
    steps: [{ key: "s", purpose: "See", beats: [{ key: "b", say: "Here is the pile.", actions: [{ do: "write", as: "mat", kind: "base_ten_trade", role: "main_visual", place: { relation: "new_region" },
      content: overrides.content ?? { columns: 2, places: [{ as: "ones", count: 14, tray: 0 }, { as: "tens", count: 3 }],
        bindings: [{ target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" }] } }] }] }],
    close: { summary: "Done.", focus: ["mat"] },
  }) as unknown as AuthoringLesson;
  assertAuthoringSchema(base());
  validateAuthoringLesson(base());
  const events = normalizeAuthoringLesson(base(), { lessonId: "l", boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
  const task = events[0]!.lesson!.tasks![0]! as unknown as { completion: { node: string }; allowed_operations: Array<{ node?: string }> };
  assert.equal(task.completion.node, "l:node:mat");
  assert.equal(task.allowed_operations[0]!.node, "l:node:mat");
  assert.equal(deriveExecutionRequirements(events).minimumPlayerVersion, "0.14.0");
  validateAuthoringLesson(base({ task: { start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 17, tens: 2 } } } }));
  assert.throws(() => validateAuthoringLesson(base({ task: { completion: { kind: "card_fact", node: "mat", fact: "all_traded" } } })), /Unsupported card fact/);
  // A fact is a name, never a list that a lookup would coerce to one (review of #112).
  assert.throws(() => validateAuthoringLesson(base({ task: { completion: { kind: "card_fact", node: "mat", fact: ["count"], at: "ones", value: 7 } } })), /Unsupported card fact/);
  assert.throws(() => validateAuthoringLesson(base({ task: { allowed_operations: [{ kind: "card_submit" }] } })), /card_tap.*card_submit/);
  assert.throws(() => validateAuthoringLesson(base({ variables: [variable("ones", 14, 59), variable("tray_ones", 0, 10), variable("tens", 3, 8)] })), /must run from 0 to 9/);
  assert.throws(() => validateAuthoringLesson(base({ content: { columns: 2, places: [{ as: "ones", count: 14, tray: 0 }, { as: "tens", count: 3 }],
    bindings: [{ target: "ones.count", expression: "ones" }, { target: "tens.count", expression: "tens" }] } })), /'ones.tray' bound to its own lesson variable/);
  assert.throws(() => validateAuthoringLesson(base({ task: { start: { kind: "practice", variables: ["ones", "tens"], values: { ones: 17 } } } })), /missing tray_ones/);
  assert.throws(() => validateAuthoringLesson(base({ task: { start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 50, tens: 9 } } } })), /practice pile is not a starting pile.*use 3 columns/);
  // Review of #87: the task gives its practice pile; tap variables have no control of their own; a bound card is not revised.
  assert.throws(() => validateAuthoringLesson(base({ task: { start: undefined } })), /gives the learner's practice pile in start/);
  // Amendment 4: a count's slider moves by trades, so it is of step ten (each stop one trade), nothing else.
  assert.throws(() => validateAuthoringLesson(base({ variables: [{ ...variable("ones", 14, 59), control: { kind: "slider", step: 1 } }, variable("tray_ones", 0, 10), variable("tens", 3, 9)] })), /takes only a slider of step 10/);
  const revised = base();
  (revised.steps[0]!.beats as unknown[]).push({ key: "caption", say: "Look again.", actions: [{ do: "revise", target: "mat", reason: "add a caption", content: { columns: 2, caption: "Count them.", places: [{ as: "ones", count: 14, tray: 0 }, { as: "tens", count: 3 }] } }] });
  assert.throws(() => validateAuthoringLesson(revised), /not revised: its counts change by taps/);
  // Amendment 5: a count the learner taps to, from the practice pile (17 ones, 2 tens): 7, 17, 27 or 37 ones; 0 to 3 tens.
  const count = (at: unknown, value: unknown, more: Record<string, unknown> = {}) => base({ task: { completion: { kind: "card_fact", node: "mat", fact: "count", at, value, ...more } } });
  for (const [at, value] of [["ones", 7], ["ones", 27], ["ones", 37], ["tens", 3], ["tens", 0]] as const) {
    assertAuthoringSchema(count(at, value));
    validateAuthoringLesson(count(at, value));
  }
  const counted = normalizeAuthoringLesson(count("ones", 7), { lessonId: "l", boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
  assert.equal(deriveExecutionRequirements(counted).minimumPlayerVersion, "0.15.0");
  assert.ok(deriveExecutionRequirements(counted).requiredCapabilities.includes("student-tasks:card_fact:count"));
  assert.throws(() => validateAuthoringLesson(count("ones", 17)), /already has 17 ones/);
  assert.throws(() => validateAuthoringLesson(count("ones", 10)), /makes 7 or 17 or 27 or 37 ones, never 10/);
  assert.throws(() => validateAuthoringLesson(count("hundreds", 0)), /a place the card has: ones, tens/);
  assert.throws(() => validateAuthoringLesson(count("ones", 6.5)), /whole number/);
  assert.throws(() => validateAuthoringLesson(count("ones", undefined)), /whole number/);
  // Only a count names a place and a value.
  assert.throws(() => validateAuthoringLesson(base({ task: { completion: { kind: "card_fact", node: "mat", fact: "no_trade_left", at: "ones" } } })), /Unknown field 'at' of a no_trade_left card fact/);
});

test("a slider on a card's count (decision 0023 amendment 4): ones, and tens on three columns, of step ten; tasks reach their target by trades", () => {
  const variable = (as: string, initial: number, max: number, control?: unknown) => ({ as, initial, min: 0, max, label: as, ...(control ? { control } : {}) });
  const slider = { kind: "slider", step: 10 };
  const twoVars = (ones: unknown = slider, tray?: unknown, tens?: unknown) => [variable("ones", 26, 59, ones), variable("tray_ones", 0, 10, tray), variable("tens", 3, 9, tens)];
  const twoMat = { columns: 2, places: [{ as: "ones", count: 26, tray: 0 }, { as: "tens", count: 3 }],
    bindings: [{ target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" }] };
  const threeVars = (tensControl: unknown = slider, hundredsControl?: unknown, trayTens?: unknown) => [variable("ones", 26, 59, slider), variable("tray_ones", 0, 10),
    variable("tens", 9, 34, tensControl), variable("tray_tens", 0, 10, trayTens), variable("hundreds", 1, 9, hundredsControl)];
  const threeMat = { columns: 3, places: [{ as: "ones", count: 26, tray: 0 }, { as: "tens", count: 9, tray: 0 }, { as: "hundreds", count: 1 }],
    bindings: [{ target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" },
      { target: "tens.tray", expression: "tray_tens" }, { target: "hundreds.count", expression: "hundreds" }] };
  const lesson = (variables: unknown[], content: unknown, tasks: unknown[] = [], more: unknown[] = []) => ({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Trading", goals: ["Ten ones make a ten"], variables, ...(tasks.length ? { tasks } : {}) },
    steps: [{ key: "s", purpose: "See", beats: [{ key: "b", say: "Here is the pile.", actions: [{ do: "write", as: "mat", kind: "base_ten_trade", role: "main_visual", place: { relation: "new_region" }, content }, ...more] }] }],
    close: { summary: "Done.", focus: ["mat"] },
  }) as unknown as AuthoringLesson;
  const target = (expression: string, value: number, variables: string[] = ["ones"], start?: Record<string, number>) => ({
    as: "slide", prompt: "Slide the ones.", availability: { kind: "after_lesson" },
    allowed_operations: variables.map((alias) => ({ kind: "variable_change", variable: alias, controls: ["slider"] })),
    completion: { kind: "expression_target", expression, value, tolerance: 0.5 }, hints: ["Each stop is a trade."],
    ...(start ? { start: { kind: "practice", variables: Object.keys(start), values: start } } : {}),
  });
  const cardTask = (operations: unknown[]) => ({
    as: "trade", prompt: "Make tens, then tap I'm done.", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "card_tap", node: "mat" }, { kind: "card_submit" }, ...operations],
    completion: { kind: "card_fact", node: "mat", fact: "no_trade_left" }, hints: ["Make a ten."],
    start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 17, tray_ones: 0, tens: 2 } },
  });
  // Accepted: ones on two columns; ones and tens on three; with the lesson's own demonstration taps too.
  for (const document of [lesson(twoVars(), twoMat), lesson(threeVars(), threeMat), lesson(twoVars(), twoMat, [], [{ do: "tap", target: "mat", tap: "gather", at: "ones" }])]) {
    assertAuthoringSchema(document);
    validateAuthoringLesson(document);
  }
  // Refused: a tray, the highest place, another step, or another control kind.
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(undefined, slider), twoMat)), /'tray_ones' \(ones.tray\) cannot have a control: only the count of a place with a tray/);
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(undefined, undefined, { kind: "slider", step: 1 }), twoMat)), /'tens' \(tens.count\) cannot have a control/);
  assert.throws(() => validateAuthoringLesson(lesson(threeVars(slider, { kind: "slider", step: 1 }), threeMat)), /'hundreds' \(hundreds.count\) cannot have a control/);
  assert.throws(() => validateAuthoringLesson(lesson(threeVars(slider, undefined, slider), threeMat)), /'tray_tens' \(tens.tray\) cannot have a control/);
  assert.throws(() => validateAuthoringLesson(lesson(twoVars({ kind: "slider", step: 5 }), twoMat)), /takes only a slider of step 10: each stop is one trade/);
  assert.throws(() => validateAuthoringLesson(lesson(twoVars({ kind: "slider" }), twoMat)), /takes only a slider of step 10/);
  const pointed = lesson(twoVars(), twoMat, [], [{ do: "write", as: "line", kind: "number_line", role: "supporting_visual", place: { relation: "right_of", anchor: "mat" },
    content: { range: { min: 0, max: 59 }, ticks: { step: 10, subdivisions: 10 }, points: [{ as: "dot", value: 26, interaction: { kind: "drag", variable: "ones" } }], bindings: [{ target: "dot.value", expression: "ones" }] } }]);
  assert.throws(() => validateAuthoringLesson(pointed), /takes only a slider of step 10/);
  // Each stop is a trade, so the card has every count and tray bound.
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(), { ...twoMat, bindings: twoMat.bindings.filter((binding) => binding.target !== "ones.tray") })), /A slider on a card's count needs 'ones.tray' bound/);
  // A card task may let the learner trade with the count's slider besides tapping; nothing else.
  validateAuthoringLesson(lesson(twoVars(), twoMat, [cardTask([{ kind: "variable_change", variable: "ones", controls: ["slider"] }])]));
  validateAuthoringLesson(lesson(twoVars(), twoMat, [cardTask([])]));
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(null), twoMat, [cardTask([{ kind: "variable_change", variable: "ones", controls: ["slider"] }])])), /card_tap.*card_submit.*slider/);
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(), twoMat, [cardTask([{ kind: "variable_change", variable: "tens", controls: ["slider"] }])])), /card_tap.*card_submit/);
  // A slider task: the target is reached by trades from the task's starting pile (26 ones and 3 tens: 6, 16, …, 56).
  const twoPile = { ones: 26, tray_ones: 0, tens: 3 };
  const threePile = { ones: 26, tray_ones: 0, tens: 9, tray_tens: 0, hundreds: 1 };
  for (const value of [6, 16, 36, 56]) validateAuthoringLesson(lesson(twoVars(), twoMat, [target("ones", value, ["ones"], twoPile)]));
  validateAuthoringLesson(lesson(twoVars(), twoMat, [target("ones", 16, ["ones"], { ones: 6, tray_ones: 0, tens: 4 })]));
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(), twoMat, [target("ones", 10, ["ones"], twoPile)])), /No pile the card's sliders can make by trades from the task's starting pile/);
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(), twoMat, [target("ones", 0, ["ones"], twoPile)])), /No pile the card's sliders can make/);
  // From its own practice pile (5 ones, no tens) no trade is possible.
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(), twoMat, [target("ones", 15, ["ones"], { ones: 5, tray_ones: 0, tens: 0 })])), /No pile the card's sliders can make/);
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(), twoMat, [target("ones", 16, ["ones"], { ones: 6, tens: 4 })])), /practice pile sets every count and tray; missing tray_ones/);
  // Already satisfied is judged on the practice pile too.
  assert.throws(() => validateAuthoringLesson(lesson(twoVars(), twoMat, [target("ones", 26, ["ones"], twoPile)])), /already satisfied/);
  validateAuthoringLesson(lesson(twoVars(), twoMat, [target("ones", 26, ["ones"], { ones: 6, tray_ones: 0, tens: 5 })]));
  // Three columns: 6 ones, 1 ten and 2 hundreds are reached only by two ones trades and then a tens trade.
  validateAuthoringLesson(lesson(threeVars(), threeMat, [target("ones + tens", 7, ["ones", "tens"], threePile)]));
  assert.throws(() => validateAuthoringLesson(lesson(threeVars(), threeMat, [target("tens", 1, ["tens"], threePile)])), /No pile the card's sliders can make/);
  validateAuthoringLesson(lesson(threeVars(), threeMat, [target("tens", 19, ["tens"], threePile)]));
  // A slider task gives its practice pile (review of #99): the lesson's own taps may leave any pile, so a target is
  // checked only from a pile the task lays. Six ones and ten tens, a lesson that makes the hundred, then "ones to 16":
  // the lesson leaves 6 ones and no ten to break.
  const demoVars = [variable("ones", 6, 59, slider), variable("tray_ones", 0, 10), variable("tens", 10, 34), variable("tray_tens", 0, 10), variable("hundreds", 0, 9)];
  const demoMat = { ...threeMat, places: [{ as: "ones", count: 6, tray: 0 }, { as: "tens", count: 10, tray: 0 }, { as: "hundreds", count: 0 }] };
  const makeHundred = [...Array.from({ length: 10 }, () => ({ do: "tap", target: "mat", tap: "gather", at: "tens" })), { do: "tap", target: "mat", tap: "make", at: "tens" }];
  assert.throws(() => validateAuthoringLesson(lesson(demoVars, demoMat, [target("ones", 16)], makeHundred)), /A task on a card's count sliders gives the learner's practice pile in start/);
  validateAuthoringLesson(lesson(demoVars, demoMat, [target("ones", 16, ["ones"], { ones: 6, tray_ones: 0, tens: 10, tray_tens: 0, hundreds: 0 })], makeHundred));
  // The mirror: 26 ones and 9 tens traded by the lesson, then "tens to 1": refused without a start, accepted from one it plays from.
  const tradeOnes = [...Array.from({ length: 10 }, () => ({ do: "tap", target: "mat", tap: "gather", at: "ones" })), { do: "tap", target: "mat", tap: "make", at: "ones" }];
  assert.throws(() => validateAuthoringLesson(lesson(threeVars(), threeMat, [target("tens", 1, ["tens"])], tradeOnes)), /gives the learner's practice pile in start/);
  validateAuthoringLesson(lesson(threeVars(), threeMat, [target("tens", 1, ["tens"], { ones: 16, tray_ones: 0, tens: 11, tray_tens: 0, hundreds: 1 })], tradeOnes));
});

test("row tasks (decision 0023 amendment 1): text and one to six blanks, each a numeric answer, by a board card", () => {
  const lesson = (completion: unknown, more: Record<string, unknown> = {}) => ({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: "en-US", title: "Rows", goals: ["Write a number by places"],
      tasks: [{ as: "parts", anchor: "card", prompt: "Write it by places.", availability: { kind: "after_lesson" },
        allowed_operations: [{ kind: "row_entry" }], completion, hints: ["Each place's worth."], ...more }],
    },
    steps: [{ key: "s", purpose: "See", beats: [{ key: "b", say: "37.", actions: [{ do: "write", as: "card", kind: "text", role: "note", content: { text: "37" }, place: { relation: "new_region" } }] }] }],
    close: { summary: "Done.", focus: ["card"] },
  }) as unknown as AuthoringLesson;
  const row = { kind: "numeric_row", parts: [{ text: "37 =" }, { blank: { as: "tens", answer: "30", label: "the tens" } }, { text: "+" }, { blank: { as: "ones", answer: "7" } }] };
  assertAuthoringSchema(lesson(row));
  validateAuthoringLesson(lesson(row));
  const events = normalizeAuthoringLesson(lesson(row), { lessonId: "l", boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
  assert.equal((events[0]!.lesson!.tasks![0] as unknown as { anchor: string }).anchor, "l:node:card");
  assert.equal(deriveExecutionRequirements(events).minimumPlayerVersion, "0.14.0");
  // One blank is a row too (a one-digit pile).
  validateAuthoringLesson(lesson({ kind: "numeric_row", parts: [{ blank: { as: "ones", answer: "7" } }, { text: "ones" }] }));
  assert.throws(() => validateAuthoringLesson(lesson({ kind: "numeric_row", parts: [{ text: "no blank" }] })), /1 to 6 blanks/);
  assert.throws(() => validateAuthoringLesson(lesson({ kind: "numeric_row", parts: [{ blank: { as: "a", answer: "1" } }, { blank: { as: "a", answer: "2" } }] })), /Blank 'a' is duplicated/);
  assert.throws(() => validateAuthoringLesson(lesson({ kind: "numeric_row", parts: [{ blank: { as: "a", answer: "seven" } }] })), /whole number, decimal, fraction or mixed number/);
  assert.throws(() => validateAuthoringLesson(lesson({ kind: "numeric_row", parts: [{ text: "x", blank: { as: "a", answer: "1" } }] })), /either text or a blank/);
  assert.throws(() => validateAuthoringLesson(lesson(row, { allowed_operations: [{ kind: "answer_entry" }] })), /exactly one row_entry/);
  assert.throws(() => validateAuthoringLesson(lesson(row, { anchor: "nowhere" })), /nowhere/);
  assert.throws(() => validateAuthoringLesson(lesson({ kind: "numeric_row", parts: [{ blank: { as: "a", answer: "30", label: "30" } }] })), /words only, never a number/);
});
