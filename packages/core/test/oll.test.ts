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

test("rejects invalid lesson variables and value bindings with explicit errors", () => {
  const interactive = lessons.find(({ entry }) => entry.name === "unit-circle-sine")!;

  const outOfRange = structuredClone(interactive.source);
  outOfRange.lesson.variables![0]!.initial = 7;
  assert.throws(
    () => validateAuthoringLesson(outOfRange),
    (error) => error instanceof OllError && error.code === "OLL_INVALID_VARIABLE" && error.path === "/lesson/variables/0/initial",
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
