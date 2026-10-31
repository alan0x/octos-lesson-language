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
  assert.equal(view.zoom, 1.4);
  assert.deepEqual(scene3dViewForIntent(node.content, { preset: "front" }, { yaw: 2, pitch: 1, zoom: 0.8 }), { yaw: 0, pitch: 0, zoom: 0.8 });
});
