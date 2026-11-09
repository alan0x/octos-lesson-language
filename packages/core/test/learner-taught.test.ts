import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertAuthoringSchema,
  deriveExecutionRequirements,
  normalizeAuthoringLesson,
  OllError,
  reduceCanonicalEvents,
  scene3dViewForIntent,
  validateAuthoringLesson,
  validateAuthoringSchema,
  type AuthoringLesson,
  type NormalizationHost,
} from "../src/index.js";
import { compilePlaybackOperations } from "../../player-core/src/index.js";
import { operationDelay } from "../../web-runtime/src/runtime.js";

const root = process.cwd();
const unitCircle = JSON.parse(await readFile(resolve(root, "examples/learner-taught-unit-circle-v1/lesson.authoring.json"), "utf8")) as AuthoringLesson;
const host: NormalizationHost = { lessonId: "lesson-learner-001", boardId: "board-learner-001", baseRevision: 0, regionIntent: "new_topic" };
const author = {
  kind: "learner" as const,
  learner_ref: "learner:demo-riley",
  presented_by: { avatar_ref: "avatar:owl", voice_ref: "voice:learner-bright-2" },
};

export function learnerLesson(source: AuthoringLesson = unitCircle): AuthoringLesson {
  const lesson = structuredClone(source);
  lesson.lesson.mode = "learner_taught";
  lesson.lesson.author = structuredClone(author);
  return lesson;
}

function rejects(lesson: AuthoringLesson, code: string, path?: string) {
  assert.throws(() => validateAuthoringLesson(lesson), (error: unknown) => {
    assert.ok(error instanceof OllError);
    assert.equal(error.code, code);
    if (path) assert.equal(error.path, path);
    return true;
  });
}

test("a learner-taught lesson names its learner author and needs player 0.6.0", () => {
  const lesson = learnerLesson();
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);
  const events = normalizeAuthoringLesson(lesson, host);
  assert.equal(events[0]!.lesson?.mode, "learner_taught");
  assert.deepEqual(events[0]!.lesson?.author, author);
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("lesson-mode:learner_taught"));
  assert.equal(requirements.minimumPlayerVersion, "0.6.0");
});

test("a later card ends an earlier highlight with emphasis none, which needs player 0.7.0", () => {
  const lesson = learnerLesson();
  const later = lesson.steps[0]!.beats[2]!;
  later.actions.unshift({ do: "emphasize", target: "unit-circle#height", emphasis: "none" } as (typeof later.actions)[number]);
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);
  const events = normalizeAuthoringLesson(lesson, host);
  const state = reduceCanonicalEvents(events);
  const entries = (state.nodes[Object.keys(state.nodes).find((id) => id.endsWith("unit-circle"))!]!.emphasis ?? []) as Array<{ emphasis: string }>;
  assert.deepEqual(entries.map((entry) => entry.emphasis), ["focus", "none"]);
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("emphasis:none"));
  assert.equal(requirements.minimumPlayerVersion, "0.7.0");
});

test("a wrapping angle variable is kept in the state and needs player 0.7.0", () => {
  const lesson = learnerLesson();
  lesson.lesson.variables = (lesson.lesson.variables ?? []).map((variable) => ({ ...variable, wrap: true as const }));
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);
  const events = normalizeAuthoringLesson(lesson, host);
  const state = reduceCanonicalEvents(events);
  assert.ok(Object.values(state.variables ?? {}).every((variable) => variable.wrap === true));
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("variables:wrap"));
  const invalid = learnerLesson();
  invalid.lesson.variables = (invalid.lesson.variables ?? []).map((variable) => ({ ...variable, wrap: false as unknown as true }));
  rejects(invalid, "OLL_INVALID_VARIABLE");
});

test("3D highlights may be shown only when emphasized, which needs player 0.7.0", async () => {
  const box = learnerLesson(JSON.parse(await readFile(resolve(root, "examples/learner-taught-box-v1/lesson.authoring.json"), "utf8")) as AuthoringLesson);
  const scene = box.steps.flatMap((step) => step.beats).flatMap((beat) => beat.actions).find((action) => action.do === "write" && action.kind === "scene3d") as unknown as { content: { highlights: Array<Record<string, unknown>> } };
  scene.content.highlights = scene.content.highlights.map((highlight) => ({ ...highlight, shown: "when_emphasized" }));
  assertAuthoringSchema(box);
  validateAuthoringLesson(box);
  const requirements = deriveExecutionRequirements(normalizeAuthoringLesson(box, host));
  assert.ok(requirements.requiredCapabilities.includes("scene3d:latent-highlights"));
  scene.content.highlights[0]!.shown = "sometimes";
  rejects(box, "OLL_INVALID_OPERATION_PAYLOAD");
});

test("lesson modes cannot be mixed up", () => {
  const withoutAuthor = learnerLesson();
  delete withoutAuthor.lesson.author;
  rejects(withoutAuthor, "OLL_INVALID_OPERATION_PAYLOAD", "/lesson/author");
  const explainWithAuthor = learnerLesson();
  explainWithAuthor.lesson.mode = "explain";
  rejects(explainWithAuthor, "OLL_INVALID_OPERATION_PAYLOAD", "/lesson/author");
});

test("an author is referenced opaquely, never by name or email", () => {
  for (const learner_ref of ["learner:Riley Smith", "riley@example.com", "learner:"]) {
    const lesson = learnerLesson();
    lesson.lesson.author!.learner_ref = learner_ref;
    assert.equal(validateAuthoringSchema(lesson).valid, false, learner_ref);
  }
});

test("explain lessons keep requiring only their existing player version", () => {
  const requirements = deriveExecutionRequirements(normalizeAuthoringLesson(unitCircle, host));
  assert.ok(!requirements.requiredCapabilities.includes("lesson-mode:learner_taught"));
});

// ---- 0006: learner ink, annotations, replace and hide

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
const inkContext = {
  ink_snapshots: [
    { snapshot_id: "ink-snap:card3@v4", sha256: SHA, selection_ids: ["sel-card3-rise", "sel-card3-run", "sel-card3-all"] },
    { snapshot_id: "ink-snap:card3@v5", sha256: SHA2, selection_ids: ["sel-card3-all"] },
    { snapshot_id: "ink-snap:circle-a@v4", sha256: SHA, selection_ids: [] },
  ],
};

function inkLesson(actions: unknown[], mode: "learner_taught" | "explain" = "learner_taught"): AuthoringLesson {
  const lesson: AuthoringLesson = {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode, language: "en-US", title: "Rise over run", goals: ["Find slope"] },
    steps: [{ key: "teach", purpose: "Compute slope", beats: [{ key: "card-3", say: "Rise over run.", actions: actions as never }] }],
    close: { summary: "Slope is rise over run.", focus: ["grid"] },
  };
  if (mode === "learner_taught") lesson.lesson.author = structuredClone(author);
  return lesson;
}

const grid = { do: "write", as: "grid", kind: "geometry", role: "diagram", place: { relation: "new_region" },
  content: { axes: { x: { min: -1, max: 6 }, y: { min: -1, max: 9 }, equal_scale: true }, points: [{ as: "point-a", x: 1, y: 2, label: "A" }] } };
const fraction = { do: "write", as: "ink-fraction", kind: "ink", role: "derivation", place: { relation: "below", anchor: "grid" },
  content: { snapshot_id: "ink-snap:card3@v4", sha256: SHA, replay: "stroke_order", alt: "8 minus 2 over 4 minus 1",
    selections: [{ as: "rise", selection_id: "sel-card3-rise" }, { as: "run", selection_id: "sel-card3-run" }] } };
const neat = { do: "write", as: "neat-fraction", kind: "math", role: "derivation", place: { relation: "replaces", anchor: "ink-fraction" },
  content: { fragments: [{ as: "result", latex: "m=\\dfrac{6}{3}=2" }] } };

function validate(lesson: AuthoringLesson) {
  assertAuthoringSchema(lesson);
  return validateAuthoringLesson(lesson, inkContext);
}

function rejectsWith(lesson: AuthoringLesson, code: string, path?: string) {
  assert.throws(() => validate(lesson), (error: unknown) => {
    assert.ok(error instanceof OllError, String(error));
    assert.equal(error.code, code);
    if (path) assert.equal(error.path, path);
    return true;
  });
}

test("learner ink is a card from a frozen snapshot whose selections are addressable", () => {
  const lesson = inkLesson([grid, fraction, { do: "emphasize", target: "ink-fraction#rise", emphasis: "focus" }]);
  validate(lesson);
  const events = normalizeAuthoringLesson(lesson, { ...host, resourceContext: inkContext });
  const create = events[1]!.step!.beats[0]!.stage.during_speech.find((action) => action.node?.kind === "ink")!;
  assert.deepEqual(create.node!.content.selections.map((selection: { id: string }) => selection.id), [
    "lesson-learner-001:node:ink-fraction:fragment:rise", "lesson-learner-001:node:ink-fraction:fragment:run",
  ]);
  assert.ok(deriveExecutionRequirements(events).requiredCapabilities.includes("node:ink"));
});

test("learner ink must come from a known snapshot with its checksum and selections", () => {
  rejectsWith(inkLesson([grid, { ...fraction, content: { ...fraction.content, snapshot_id: "ink-snap:other@v1" } }]), "OLL_RESOURCE_DENIED");
  rejectsWith(inkLesson([grid, { ...fraction, content: { ...fraction.content, sha256: SHA2 } }]), "OLL_RESOURCE_DENIED");
  rejectsWith(inkLesson([grid, { ...fraction, content: { ...fraction.content, selections: [{ as: "rise", selection_id: "sel-elsewhere" }] } }]), "OLL_RESOURCE_DENIED");
});

test("ink, annotations, replacing and hiding belong only to learner-taught lessons", () => {
  rejectsWith(inkLesson([grid, fraction], "explain"), "OLL_INVALID_OPERATION", "/steps/0/beats/0/actions/1/kind");
  const explainHide = inkLesson([grid, { do: "write", as: "note", kind: "note", role: "note", place: { relation: "below", anchor: "grid" }, content: { title: "x" } }, { do: "hide", target: "note" }], "explain");
  rejectsWith(explainHide, "OLL_INVALID_OPERATION", "/steps/0/beats/0/actions/2/do");
  const explainReplace = inkLesson([grid, { ...neat, place: { relation: "replaces", anchor: "grid" } }], "explain");
  rejectsWith(explainReplace, "OLL_INVALID_OPERATION", "/steps/0/beats/0/actions/1/place/relation");
});

test("an annotation is ink attached to one card at a position on it", () => {
  const circle = { do: "write", as: "circle-a", kind: "ink", role: "annotation", place: { relation: "annotates", anchor: "grid" },
    content: { snapshot_id: "ink-snap:circle-a@v4", sha256: SHA, alt: "circle around point A", annotation: { x: 0.2, y: 0.6, width: 0.15, height: 0.15 } } };
  validate(inkLesson([grid, circle]));
  const events = normalizeAuthoringLesson(inkLesson([grid, circle]), { ...host, resourceContext: inkContext });
  assert.ok(deriveExecutionRequirements(events).requiredCapabilities.includes("placement:annotates"));
  const { annotation: _, ...unpositioned } = circle.content;
  rejectsWith(inkLesson([grid, { ...circle, content: unpositioned }]), "OLL_INVALID_PLACEMENT");
  rejectsWith(inkLesson([grid, { ...circle, kind: "note", content: { title: "A" } }]), "OLL_INVALID_PLACEMENT");
  rejectsWith(inkLesson([grid, { ...fraction, content: { ...fraction.content, annotation: { x: 0, y: 0, width: 1, height: 1 } } }]), "OLL_INVALID_PLACEMENT");
});

test("making ink neat replaces it in place; the replaced card is hidden and cannot be used again", () => {
  const lesson = inkLesson([grid, fraction, neat]);
  validate(lesson);
  const events = normalizeAuthoringLesson(lesson, { ...host, resourceContext: inkContext });
  const state = reduceCanonicalEvents(events);
  const replaced = state.nodes["lesson-learner-001:node:ink-fraction"]!;
  assert.equal(replaced.hidden, true);
  assert.equal(replaced.replaced_by, "lesson-learner-001:node:neat-fraction");
  assert.ok(deriveExecutionRequirements(events).requiredCapabilities.includes("placement:replaces"));
  rejectsWith(inkLesson([grid, fraction, neat, { do: "emphasize", target: "ink-fraction#rise", emphasis: "focus" }]), "OLL_INVALID_REFERENCE");
});

test("a learner hides a whole card of their own", () => {
  const lesson = inkLesson([grid, fraction, { do: "hide", target: "ink-fraction" }, { do: "focus", targets: ["grid"], intent: "back_to_grid" }]);
  validate(lesson);
  const state = reduceCanonicalEvents(normalizeAuthoringLesson(lesson, { ...host, resourceContext: inkContext }));
  assert.equal(state.nodes["lesson-learner-001:node:ink-fraction"]!.hidden, true);
  rejectsWith(inkLesson([grid, fraction, { do: "hide", target: "ink-fraction#rise" }]), "OLL_INVALID_REFERENCE");
  rejectsWith(inkLesson([grid, fraction, { do: "hide", target: "ink-fraction" }, { do: "hide", target: "ink-fraction" }]), "OLL_INVALID_REFERENCE");
});

test("erasing and rewriting revises ink to a newer snapshot", () => {
  const rewrite = { do: "revise", target: "ink-fraction", reason: "learner rewrote the fraction",
    content: { snapshot_id: "ink-snap:card3@v5", sha256: SHA2, alt: "6 over 3", selections: [{ as: "all", selection_id: "sel-card3-all" }] } };
  validate(inkLesson([grid, fraction, rewrite]));
  rejectsWith(inkLesson([grid, fraction, { ...rewrite, content: { ...rewrite.content, sha256: SHA } }]), "OLL_RESOURCE_DENIED");
});

test("writing appears stroke by stroke as it was written: a card shows its first strokes, revisions show more", () => {
  const first = { ...fraction, content: { ...fraction.content, replay: "stroke_order", shown_strokes: 2 } };
  const more = { do: "revise", target: "ink-fraction", reason: "the learner wrote more", content: { ...first.content, shown_strokes: 5 } };
  validate(inkLesson([grid, first, more]));
  const events = normalizeAuthoringLesson(inkLesson([grid, first, more]), { ...host, resourceContext: inkContext });
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("ink:shown-strokes"));
  assert.equal(requirements.minimumPlayerVersion, "0.8.0");
  const state = reduceCanonicalEvents(events);
  assert.equal(state.nodes["lesson-learner-001:node:ink-fraction"]!.content.shown_strokes, 5);
  rejectsWith(inkLesson([grid, { ...first, content: { ...first.content, shown_strokes: 0 } }]), "OLL_SCHEMA_INVALID");
  // Writing on a card keeps its place on the card when more of it is shown.
  const circle = { do: "write", as: "circle-a", kind: "ink", role: "annotation", place: { relation: "annotates", anchor: "grid" },
    content: { snapshot_id: "ink-snap:circle-a@v4", sha256: SHA, alt: "circle around point A", annotation: { x: 0.2, y: 0.6, width: 0.15, height: 0.15 }, shown_strokes: 1 } };
  validate(inkLesson([grid, circle, { do: "revise", target: "circle-a", reason: "the learner wrote more", content: { ...circle.content, shown_strokes: 3 } }]));
});

test("a learner-taught beat may be words alone; any other beat needs an action", () => {
  const lesson = inkLesson([grid]);
  lesson.steps[0]!.beats.push({ key: "just-words", say: "And that is the whole idea.", actions: [] });
  validate(lesson);
  const silent = inkLesson([grid]);
  silent.steps[0]!.beats.push({ key: "nothing", actions: [] });
  rejectsWith(silent, "OLL_INVALID_OPERATION_PAYLOAD", "/steps/0/beats/1/actions");
  const explain = inkLesson([grid], "explain");
  explain.steps[0]!.beats.push({ key: "just-words", say: "Words.", actions: [] });
  assert.throws(() => validateAuthoringLesson(explain), (error: unknown) => error instanceof OllError && error.code === "OLL_INVALID_OPERATION_PAYLOAD");
});

test("a beat that follows straight on carries pace continuous into the canonical lesson and plays without teaching pauses", () => {
  const lesson = inkLesson([grid]);
  lesson.steps[0]!.beats.push({ key: "next-sentence", say: "And it keeps going.", pace: "continuous", actions: [] });
  validate(lesson);
  const events = normalizeAuthoringLesson(lesson, { ...host, resourceContext: inkContext });
  const beats = events.flatMap((event) => event.step?.beats ?? []);
  assert.equal(beats[0]!.pace, undefined);
  assert.equal(beats[1]!.pace, "continuous");
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("beat-pace:continuous"));
  assert.equal(requirements.minimumPlayerVersion, "0.8.0");
  const operations = compilePlaybackOperations(events);
  const ends = operations.filter((operation) => operation.type === "beat.end");
  // The first beat's end leads straight into the next sentence; the last one ends as usual.
  assert.deepEqual(ends.map((operation) => operation.continues ?? false), [true, false]);
  assert.ok(operations.filter((operation) => operation.beat_id === beats[1]!.id && operation.type !== "beat.end" && operation.type !== "action.apply").every((operation) => operation.continues));
  assert.equal(operationDelay(ends[0]!), 250);
  assert.equal(operationDelay(ends[1]!), 700);
});

// ---- 0007: a card's source

test("a card made from ink records the selection the learner confirmed", () => {
  const sourced = { ...neat, source: { selection: "sel-card3-all", confirmed_by: "learner" } };
  validate(inkLesson([grid, fraction, sourced]));
  const events = normalizeAuthoringLesson(inkLesson([grid, fraction, sourced]), { ...host, resourceContext: inkContext });
  const state = reduceCanonicalEvents(events);
  assert.deepEqual(state.nodes["lesson-learner-001:node:neat-fraction"]!.source, { selection: "sel-card3-all", confirmed_by: "learner" });
  assert.ok(deriveExecutionRequirements(events).requiredCapabilities.includes("write-source"));
});

test("a source must be a selection of this lesson's ink, confirmed by the learner, in a learner-taught lesson", () => {
  rejectsWith(inkLesson([grid, fraction, { ...neat, source: { selection: "sel-nowhere", confirmed_by: "learner" } }]), "OLL_REFERENCE_NOT_FOUND");
  assert.equal(validateAuthoringSchema(inkLesson([grid, fraction, { ...neat, source: { selection: "sel-card3-all", confirmed_by: "ai" } }])).valid, false);
  const explain = inkLesson([grid, { do: "write", as: "note", kind: "note", role: "note", place: { relation: "below", anchor: "grid" }, content: { title: "x" }, source: { selection: "sel-card3-all", confirmed_by: "learner" } }], "explain");
  rejectsWith(explain, "OLL_INVALID_OPERATION", "/steps/0/beats/0/actions/1/source");
  rejectsWith(inkLesson([grid, fraction, { do: "point", target: "grid", source: { selection: "sel-card3-all", confirmed_by: "learner" } }]), "OLL_INVALID_OPERATION_PAYLOAD");
});

// ---- 0008: 3D view intent

const box = { do: "write", as: "box", kind: "scene3d", role: "diagram", place: { relation: "new_region" },
  content: {
    fallback: "A rectangular box 4 by 3 by 2",
    camera: { yaw: 0.7, pitch: 0.5, zoom: 1 },
    objects: [{ as: "prism", kind: "box", center: { x: 0, y: 0, z: 1 }, size: { x: 4, y: 3, z: 2 } }],
    highlights: [{ as: "bottom-face", kind: "face", points: [{ x: -2, y: -1.5, z: 0 }, { x: 2, y: -1.5, z: 0 }, { x: 2, y: 1.5, z: 0 }, { x: -2, y: 1.5, z: 0 }] }],
  } };

function boxLesson(actions: unknown[]): AuthoringLesson {
  const lesson = inkLesson([box, ...actions]);
  lesson.close.focus = ["box"];
  return lesson;
}

test("a lesson turns a 3D scene to show a highlighted part or a named view", () => {
  const lesson = boxLesson([{ do: "view", target: "box", show: "box#bottom-face" }, { do: "view", target: "box", preset: "top" }]);
  validate(lesson);
  const events = normalizeAuthoringLesson(lesson, { ...host, resourceContext: inkContext });
  const views = events[1]!.step!.beats[0]!.stage.during_speech.filter((action) => action.op === "scene3d.view");
  assert.deepEqual(views[0]!.view, { show: { node_id: "lesson-learner-001:node:box", fragment_id: "lesson-learner-001:node:box:fragment:bottom-face" } });
  assert.deepEqual(reduceCanonicalEvents(events).nodes["lesson-learner-001:node:box"]!.view_intent, { preset: "top" });
  assert.ok(deriveExecutionRequirements(events).requiredCapabilities.includes("action:scene3d.view"));
});

test("a view names exactly one intent on a whole 3D scene, never camera numbers", () => {
  rejectsWith(boxLesson([{ do: "view", target: "box" }]), "OLL_INVALID_OPERATION_PAYLOAD");
  rejectsWith(boxLesson([{ do: "view", target: "box", show: "box#bottom-face", preset: "top" }]), "OLL_INVALID_OPERATION_PAYLOAD");
  rejectsWith(boxLesson([{ do: "view", target: "box", show: "box#prism" }]), "OLL_INVALID_REFERENCE");
  rejectsWith(inkLesson([grid, { do: "view", target: "grid", preset: "top" }]), "OLL_INVALID_REFERENCE");
  assert.equal(validateAuthoringSchema(boxLesson([{ do: "view", target: "box", preset: "below" }])).valid, false);
  assert.equal(validateAuthoringSchema(boxLesson([{ do: "view", target: "box", yaw: 1 }])).valid, false);
});

test("a view intent turns to look at a highlighted part from the side it faces, keeping zoom", () => {
  const events = normalizeAuthoringLesson(boxLesson([{ do: "view", target: "box", show: "box#bottom-face" }]), { ...host, resourceContext: inkContext });
  const node = reduceCanonicalEvents(events).nodes["lesson-learner-001:node:box"]!;
  const view = scene3dViewForIntent(node.content, node.view_intent, { yaw: 0.7, pitch: 0.5, zoom: 1.4 });
  assert.ok(Math.abs(view.pitch + Math.PI / 2) < 1e-9, "the bottom face is seen from below");
  assert.equal(view.yaw, 0, "and squared to the screen");
  assert.equal(view.zoom, 1.4);
  assert.deepEqual(scene3dViewForIntent(node.content, { preset: "front" }, { yaw: 2, pitch: 1, zoom: 0.8 }), { yaw: 0, pitch: 0, zoom: 0.8 });
});

// ---- revising addressable content

test("a revision that adds a point to a grid makes the new point addressable", () => {
  const withC = { ...grid.content, points: [...grid.content.points, { as: "point-c", x: 2, y: 4, label: "C" }] };
  const lesson = inkLesson([grid, { do: "revise", target: "grid", reason: "the learner placed a point", content: withC }, { do: "point", target: "grid#point-c" }]);
  validate(lesson);
  const events = normalizeAuthoringLesson(lesson, { ...host, resourceContext: inkContext });
  const state = reduceCanonicalEvents(events);
  const points = state.nodes["lesson-learner-001:node:grid"]!.content.points as Array<{ id: string }>;
  assert.deepEqual(points.map((point) => point.id), ["lesson-learner-001:node:grid:fragment:point-a", "lesson-learner-001:node:grid:fragment:point-c"]);
  rejectsWith(inkLesson([grid, { do: "point", target: "grid#point-c" }]), "OLL_REFERENCE_NOT_FOUND");
});

// ---- 0011: a card that grows where the learner writes

const step = { do: "write", as: "ink-step", kind: "ink", role: "derivation", place: { relation: "continues", anchor: "neat-fraction", offset: { x: 12, y: 84 } },
  content: { snapshot_id: "ink-snap:circle-a@v4", sha256: SHA, alt: "minus 5 on both sides", drawn_size: { width: 210, height: 48 } } };
const nextLine = { do: "write", as: "next-line", kind: "math", role: "derivation", place: { relation: "continues", anchor: "ink-step", offset: { x: 0, y: 60 }, align: "equals" },
  content: { fragments: [{ as: "line", latex: "3x=15" }] } };

test("learner ink and math can continue a card at the offset they were drawn, which needs player 0.9.0", () => {
  const lesson = inkLesson([grid, fraction, neat, step, nextLine]);
  validate(lesson);
  const events = normalizeAuthoringLesson(lesson, { ...host, resourceContext: inkContext });
  const created = events[1]!.step!.beats[0]!.stage.during_speech.filter((action) => action.op === "board.create");
  assert.deepEqual(created.at(-1)!.node!.placement, {
    relation: "continues", anchor: "lesson-learner-001:node:ink-step", offset: { x: 0, y: 60 }, align: "equals",
  });
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("placement:continues"));
  assert.ok(requirements.requiredCapabilities.includes("ink:drawn-size"));
  assert.equal(requirements.minimumPlayerVersion, "0.9.0");
});

test("a continuation has an offset, is ink or math, and only math lines up its '='", () => {
  const { offset: _, ...noOffset } = step.place;
  rejectsWith(inkLesson([grid, fraction, neat, { ...step, place: noOffset }]), "OLL_INVALID_PLACEMENT", "/steps/0/beats/0/actions/3/place/offset");
  rejectsWith(inkLesson([grid, fraction, neat, { ...step, place: { ...step.place, offset: { x: 5000, y: 0 } } }]), "OLL_SCHEMA_INVALID");
  rejectsWith(inkLesson([grid, { do: "write", as: "note", kind: "note", role: "note", place: { relation: "continues", anchor: "grid", offset: { x: 0, y: 10 } }, content: { title: "x" } }]),
    "OLL_INVALID_PLACEMENT", "/steps/0/beats/0/actions/1/place/relation");
  rejectsWith(inkLesson([grid, fraction, neat, { ...step, place: { ...step.place, align: "equals" } }]), "OLL_INVALID_PLACEMENT", "/steps/0/beats/0/actions/3/place/align");
  rejectsWith(inkLesson([grid, { ...fraction, place: { relation: "below", anchor: "grid", offset: { x: 0, y: 0 } } }]), "OLL_INVALID_PLACEMENT", "/steps/0/beats/0/actions/1/place/offset");
  rejectsWith(inkLesson([grid, fraction, { ...neat, place: { relation: "below", anchor: "ink-fraction", align: "equals" } }]), "OLL_INVALID_PLACEMENT", "/steps/0/beats/0/actions/2/place/align");
  // Neat math replacing a continued line may line up; ink replacing anything may not.
  validate(inkLesson([grid, fraction, neat, step, { ...nextLine, place: { relation: "replaces", anchor: "ink-step", align: "equals" } }]));
  rejectsWith(inkLesson([grid, fraction, neat, { ...step, place: { relation: "replaces", anchor: "neat-fraction", align: "equals" } }]), "OLL_INVALID_PLACEMENT", "/steps/0/beats/0/actions/3/place/align");
  rejectsWith(inkLesson([grid, fraction, neat, { ...step, content: { ...step.content, drawn_size: { width: 0, height: 10 } } }]), "OLL_SCHEMA_INVALID");
});

test("continuing a card belongs only to learner-taught lessons", () => {
  const explainContinue = inkLesson([grid, { ...neat, place: { relation: "continues", anchor: "grid", offset: { x: 0, y: 400 } } }], "explain");
  rejectsWith(explainContinue, "OLL_INVALID_OPERATION", "/steps/0/beats/0/actions/1/place/relation");
});

test("more 3D solids: prisms, pyramids, frustums, hemispheres, tori and regular polyhedra, which need player 0.9.0", () => {
  const scene = (objects: unknown[]) => inkLesson([grid, { do: "write", as: "solids", kind: "scene3d", role: "diagram", place: { relation: "new_region" },
    content: { fallback: "Solids.", axes: false, camera: { yaw: 0.72, pitch: 0.55, zoom: 1 }, objects } }]);
  const objects = [
    { as: "prism", kind: "prism", center: { x: 0, y: 0, z: 0 }, sides: 6, radius: 1, height: 2 },
    { as: "pyramid", kind: "pyramid", center: { x: 3, y: 0, z: 0 }, sides: 4, radius: 1, height: 2 },
    { as: "frustum", kind: "frustum", center: { x: 6, y: 0, z: 0 }, radius: 2, top_radius: 1, height: 2 },
    { as: "dome", kind: "hemisphere", center: { x: 9, y: 0, z: 0 }, radius: 1 },
    { as: "ring", kind: "torus", center: { x: 12, y: 0, z: 0 }, radius: 2, tube: 0.5 },
    { as: "d20", kind: "icosahedron", center: { x: 15, y: 0, z: 0 }, radius: 1 },
  ];
  validate(scene(objects));
  const events = normalizeAuthoringLesson(scene(objects), { ...host, resourceContext: inkContext });
  assert.ok(deriveExecutionRequirements(events).requiredCapabilities.includes("scene3d:more-solids"));
  rejectsWith(scene([{ ...objects[0]!, sides: 2 }]), "OLL_SCHEMA_INVALID");
  rejectsWith(scene([{ ...objects[4], tube: 3 }]), "OLL_INVALID_OPERATION_PAYLOAD");
  rejectsWith(scene([{ as: "f", kind: "frustum", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 2 }]), "OLL_INVALID_OPERATION_PAYLOAD");
});

test("solids on any convex base, truncated pyramids, ellipsoids, and nets that unfold with a slider", () => {
  const scene = (objects: unknown[], extra: Record<string, unknown> = {}) => inkLesson([grid, { do: "write", as: "solids", kind: "scene3d", role: "diagram", place: { relation: "new_region" },
    content: { fallback: "Solids.", axes: false, camera: { yaw: 0.72, pitch: 0.55, zoom: 1 }, objects, ...extra } }]);
  const triangle = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }];
  const objects = [
    { as: "wedge", kind: "prism", center: { x: 0, y: 0, z: 0 }, base: triangle, height: 2 },
    { as: "cut", kind: "pyramid", center: { x: 4, y: 0, z: 0 }, sides: 4, radius: 2, height: 2, top_scale: 0.5 },
    { as: "egg", kind: "ellipsoid", center: { x: 8, y: 0, z: 0 }, radii: { x: 2, y: 1, z: 1 } },
    { as: "net", kind: "box", center: { x: 12, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, unfold: 0 },
  ];
  validate(scene(objects));
  const required = deriveExecutionRequirements(normalizeAuthoringLesson(scene(objects), { ...host, resourceContext: inkContext })).requiredCapabilities;
  assert.ok(required.includes("scene3d:more-solids") && required.includes("scene3d:unfold"));
  rejectsWith(scene([{ ...objects[0], base: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0.2 }, { x: 1, y: 2 }] }]), "OLL_INVALID_OPERATION_PAYLOAD", "/steps/0/beats/0/actions/1/content/objects/0/base");
  rejectsWith(scene([{ ...objects[0], sides: 3 }]), "OLL_INVALID_OPERATION_PAYLOAD");
  rejectsWith(scene([{ ...objects[1], kind: "prism" }]), "OLL_INVALID_OPERATION_PAYLOAD");
  rejectsWith(scene([{ ...objects[2], radii: { x: 2, y: 0, z: 1 } }]), "OLL_SCHEMA_INVALID");
  rejectsWith(scene([{ ...objects[2], unfold: 0.5 }]), "OLL_INVALID_OPERATION_PAYLOAD");
  rejectsWith(scene([{ ...objects[3], unfold: 2 }]), "OLL_SCHEMA_INVALID");
});

test("face targets normalize independently and require a compatible player", () => {
  const scene = (target: string, alias = "can") => inkLesson([grid, {
    do: "write", as: "solids", kind: "scene3d", role: "diagram", place: { relation: "new_region" },
    content: { fallback: "A cylinder.", camera: { yaw: .72, pitch: .55, zoom: 1 }, objects: [
      { as: alias, kind: "cylinder", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, face_targets: true },
    ] },
  }, { do: "emphasize", target: `solids#${target}`, emphasis: "focus" }]);
  const events = normalizeAuthoringLesson(scene("can-top-face"), { ...host, resourceContext: inkContext });
  const node = reduceCanonicalEvents(events).nodes[`${host.lessonId}:node:solids`]!;
  assert.deepEqual(node.emphasis?.[0]?.target, {
    node_id: `${host.lessonId}:node:solids`, fragment_id: `${host.lessonId}:node:solids:fragment:can-top-face`,
  });
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("scene3d:face-targets"));
  assert.equal(requirements.minimumPlayerVersion, "0.10.0");
  rejectsWith(scene("can-side-1-face"), "OLL_REFERENCE_NOT_FOUND");
  const longAlias = "a".repeat(64);
  rejectsWith(scene(longAlias, longAlias), "OLL_INVALID_ALIAS", "/steps/0/beats/0/actions/1/content/objects/0/as");
});
