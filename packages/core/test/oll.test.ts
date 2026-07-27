import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertAuthoringSchema,
  OllError,
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
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
    authoringSchema.$defs.action.allOf.map((rule: any) => [
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
