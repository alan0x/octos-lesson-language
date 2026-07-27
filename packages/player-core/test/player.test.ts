import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyCanonicalAction,
  createSemanticBoardState,
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
  type AuthoringLesson,
  type CanonicalEvent,
  type NormalizationHost,
  type ResourceContext,
} from "../../core/src/index.js";
import {
  HeadlessLessonPlayer,
  PlaybackError,
  compilePlaybackOperations,
  runPlaybackConformance,
} from "../src/index.js";

interface ManifestEntry extends NormalizationHost {
  name: string;
  contextFile?: string;
  resourceContext?: ResourceContext;
}

const root = process.cwd();
const manifest = JSON.parse(await readFile(resolve(root, "examples/manifest.json"), "utf8")) as ManifestEntry[];
const lessons = await Promise.all(manifest.map(async (entry) => {
  const directory = resolve(root, "examples", entry.name);
  const host = {
    ...entry,
    ...(entry.contextFile ? { resourceContext: JSON.parse(await readFile(resolve(directory, entry.contextFile), "utf8")) as ResourceContext } : {}),
  };
  const authoring = JSON.parse(await readFile(resolve(directory, "lesson.authoring.json"), "utf8")) as AuthoringLesson;
  return { entry: host, events: normalizeAuthoringLesson(authoring, host) };
}));
const quadratic = lessons.find((item) => item.entry.name === "quadratic")!;
const quadraticV2 = lessons.find((item) => item.entry.name === "quadratic-v2")!;
const geometryV2 = lessons.find((item) => item.entry.name === "geometry-auxiliary-line-v2")!;
const scienceV2 = lessons.find((item) => item.entry.name === "science-transpiration-v2")!;

function localId(value: string | undefined): string | undefined {
  return value?.split(":").at(-1);
}

function playToBeatEnds(events: CanonicalEvent[]) {
  const player = new HeadlessLessonPlayer(events);
  return player.playAll()
    .filter((frame) => frame.operation.type === "beat.end")
    .map((frame) => ({
      beat: localId(frame.operation.beat_id)!,
      board: frame.projection.board!,
    }));
}

test("every golden lesson passes headless playback conformance", () => {
  for (const lesson of lessons) {
    const result = runPlaybackConformance(lesson.events);
    assert.equal(result.final_state_matches_reducer, true);
    assert.ok(result.operation_count > result.action_count);
    assert.ok(result.action_count > 0);
    assert.ok(result.checkpoint_count > 0);
    assert.equal(result.final_revision, lesson.entry.baseRevision + lesson.events.length - 2);
  }
});

test("during_speech actions are enclosed by narration markers", () => {
  const operations = compilePlaybackOperations(quadratic.events);
  const beat = operations.filter((operation) => operation.beat_id === quadratic.events[1]!.step!.beats[0]!.id);
  const narrationBegin = beat.findIndex((operation) => operation.type === "narration.begin");
  const narrationEnd = beat.findIndex((operation) => operation.type === "narration.end");
  const duringActions = beat.map((operation, index) => ({ operation, index })).filter(({ operation }) => operation.type === "action.apply" && operation.phase === "during_speech");
  assert.ok(narrationBegin >= 0 && narrationEnd > narrationBegin);
  assert.ok(duringActions.every(({ index }) => index > narrationBegin && index < narrationEnd));
});

test("the board grows progressively instead of exposing the final lesson", () => {
  const player = new HeadlessLessonPlayer(quadratic.events);
  const finalNodeCount = Object.keys(reduceCanonicalEvents(quadratic.events).nodes).length;
  const actionFrames = player.playAll().filter((frame) => frame.operation.type === "action.apply");
  const firstCreate = actionFrames.find((frame) => frame.operation.action?.op === "board.create")!;
  assert.equal(Object.keys(firstCreate.projection.board!.nodes).length, 1);
  assert.ok(Object.keys(firstCreate.projection.board!.nodes).length < finalNodeCount);
  assert.equal(Object.keys(actionFrames.at(-1)!.projection.board!.nodes).length, finalNodeCount);
});

test("geometry V2 constructs the proof progressively at teaching keyframes", () => {
  const frames = playToBeatEnds(geometryV2.events);
  assert.deepEqual(frames.map((frame) => frame.beat), [
    "show-givens-and-goal",
    "draw-ad",
    "match-isosceles-sides",
    "match-midpoint-halves",
    "mark-common-side",
    "conclude-sss",
    "derive-angle-bisector",
    "compare-d-angles",
    "use-straight-angle",
    "conclude-perpendicular",
    "show-proof-route",
  ]);

  const node = (name: string) => `lesson-geometry-v2-001:node:${name}`;
  const connection = (name: string) => `lesson-geometry-v2-001:connection:${name}`;
  const fragment = (nodeName: string, name: string) => `${node(nodeName)}:fragment:${name}`;
  const emphasis = (board: (typeof frames)[number]["board"], owner: string, target: string) => {
    const entries = board.nodes[owner]?.emphasis ?? board.connections[owner]?.emphasis ?? [];
    return entries.filter((entry) => {
      const canonicalTarget = entry.target as { fragment_id?: string; connection_id?: string };
      return canonicalTarget.fragment_id === target || canonicalTarget.connection_id === target;
    }).at(-1)?.emphasis;
  };
  const rows = (frame: (typeof frames)[number]) => frame.board.nodes[node("sss-table")]?.content.rows as unknown[][] | undefined;

  assert.equal(frames[0]!.board.connections[connection("auxiliary-ad")], undefined, "AD must not exist before the construction beat");
  assert.ok(frames[1]!.board.connections[connection("auxiliary-ad")], "the construction beat must draw AD");
  assert.equal(rows(frames[2]!)?.length, 1, "first side pair should create one evidence row");
  assert.equal(rows(frames[3]!)?.length, 2, "second side pair should add exactly one row");
  assert.equal(rows(frames[4]!)?.length, 3, "the common side should complete the third row");

  assert.equal(emphasis(frames[2]!.board, node("clean-diagram"), fragment("clean-diagram", "side-ab")), "focus");
  assert.equal(emphasis(frames[3]!.board, node("clean-diagram"), fragment("clean-diagram", "side-ab")), "resolved");
  assert.equal(emphasis(frames[3]!.board, node("clean-diagram"), fragment("clean-diagram", "segment-bd")), "focus");
  assert.equal(emphasis(frames[4]!.board, connection("auxiliary-ad"), connection("auxiliary-ad")), "focus");
  assert.equal(emphasis(frames[5]!.board, connection("auxiliary-ad"), connection("auxiliary-ad")), "resolved");

  assert.deepEqual(frames[2]!.board.focus, [node("clean-diagram"), node("sss-table")]);
  assert.deepEqual(frames[5]!.board.focus, [node("sss-table"), node("congruence-result")]);
  assert.deepEqual(frames[6]!.board.focus, [node("angle-result")]);
  assert.deepEqual(frames[7]!.board.focus, [node("perpendicular-derivation")]);
  assert.match(String(frames[8]!.board.nodes[node("perpendicular-derivation")]?.content.latex), /180\^\\circ/);
  assert.doesNotMatch(String(frames[8]!.board.nodes[node("perpendicular-derivation")]?.content.latex), /\\perp/);
  assert.match(String(frames[9]!.board.nodes[node("perpendicular-derivation")]?.content.latex), /\\perp/);
  assert.deepEqual(frames[10]!.board.focus, ["lesson-geometry-v2-001:group:summary-group"]);
});

test("quadratic V2 completes the square progressively at teaching keyframes", () => {
  const frames = playToBeatEnds(quadraticV2.events);
  assert.deepEqual(frames.map((frame) => frame.beat), [
    "show-problem-and-goal",
    "isolate-quadratic-part",
    "halve-linear-coefficient",
    "build-perfect-square",
    "add-and-subtract-nine",
    "replace-with-square",
    "simplify-constant",
    "locate-vertex",
    "read-vertex-and-axis",
    "describe-translation",
    "show-complete-route",
  ]);

  const node = (name: string) => `lesson-quadratic-v2-001:node:${name}`;
  const fragment = (nodeName: string, name: string) => `${node(nodeName)}:fragment:${name}`;
  const emphasis = (board: (typeof frames)[number]["board"], owner: string, target: string) => {
    const entries = board.nodes[owner]?.emphasis ?? [];
    return entries.filter((entry) => (entry.target as { fragment_id?: string }).fragment_id === target).at(-1)?.emphasis;
  };

  assert.equal(frames[1]!.board.nodes[node("half-coefficient")], undefined, "coefficient calculation must wait for its own Beat");
  assert.equal(emphasis(frames[1]!.board, node("original"), fragment("original", "linear")), "focus");
  assert.match(String(frames[2]!.board.nodes[node("half-coefficient")]?.content.fragments?.[2]?.latex), /=3/);
  assert.equal(frames[2]!.board.nodes[node("square-identity")], undefined, "perfect-square identity must not appear early");
  assert.match(String(frames[3]!.board.nodes[node("square-identity")]?.content.fragments?.[2]?.latex), /\(x\+3\)\^2/);

  assert.equal(frames[3]!.board.nodes[node("balanced-expression")], undefined, "the equality invariant belongs to the next Beat");
  assert.equal(emphasis(frames[4]!.board, node("balanced-expression"), fragment("balanced-expression", "add-nine")), "focus");
  assert.equal(emphasis(frames[4]!.board, node("balanced-expression"), fragment("balanced-expression", "subtract-nine")), "focus");
  assert.equal(frames[4]!.board.nodes[node("vertex-form")], undefined, "the final form must not skip the replacement Beat");
  assert.match(String(frames[5]!.board.nodes[node("grouped-form")]?.content.fragments?.[2]?.latex), /-9\+5/);
  assert.match(String(frames[6]!.board.nodes[node("vertex-form")]?.content.fragments?.[2]?.latex), /-4/);

  assert.equal(frames[6]!.board.nodes[node("parabola")], undefined, "graph interpretation starts only after the algebra is complete");
  assert.ok(frames[7]!.board.nodes[node("parabola")]);
  assert.deepEqual(frames[7]!.board.focus, [node("parabola")]);
  assert.deepEqual(frames[8]!.board.focus, [node("parabola"), node("graph-facts")]);
  assert.deepEqual(frames[9]!.board.focus, [node("translation-note")]);
  assert.deepEqual(frames[10]!.board.focus, ["lesson-quadratic-v2-001:group:summary-group"]);
});

test("science V2 moves from image evidence to a mechanism progressively", () => {
  const frames = playToBeatEnds(scienceV2.events);
  assert.deepEqual(frames.map((frame) => frame.beat), [
    "show-experiment-and-question",
    "observe-left-droplets",
    "compare-leafless-control",
    "infer-leaf-relationship",
    "absorb-water-through-roots",
    "transport-water-to-leaves",
    "release-water-vapor",
    "condense-on-bag",
    "return-to-experiment",
    "separate-evidence-and-model",
    "show-complete-route",
  ]);

  const node = (name: string) => `lesson-science-transpiration-v2-001:node:${name}`;
  const fragment = (nodeName: string, name: string) => `${node(nodeName)}:fragment:${name}`;
  const emphasis = (board: (typeof frames)[number]["board"], owner: string, target: string) => {
    const entries = board.nodes[owner]?.emphasis ?? [];
    return entries.filter((entry) => (entry.target as { fragment_id?: string }).fragment_id === target).at(-1)?.emphasis;
  };
  const rows = (frame: (typeof frames)[number], name: string) => frame.board.nodes[node(name)]?.content.rows as unknown[][] | undefined;
  const sequence = (frame: (typeof frames)[number], name: string) => frame.board.nodes[node(name)]?.content.sequence as unknown[] | undefined;

  assert.equal(frames[0]!.board.nodes[node("experiment-image")]?.content.asset_id, "asset-transpiration-control-001");
  assert.equal(frames[0]!.board.nodes[node("evidence-table")], undefined, "the first Beat must not pre-interpret the image");
  assert.equal(rows(frames[1]!, "evidence-table")?.length, 1);
  assert.equal(emphasis(frames[1]!.board, node("experiment-image"), fragment("experiment-image", "droplets")), "focus");
  assert.equal(rows(frames[2]!, "evidence-table")?.length, 2);
  assert.equal(emphasis(frames[2]!.board, node("experiment-image"), fragment("experiment-image", "droplets")), "resolved");
  assert.equal(emphasis(frames[2]!.board, node("experiment-image"), fragment("experiment-image", "control-bag")), "focus");

  assert.equal(frames[2]!.board.nodes[node("first-inference")], undefined, "comparison must precede inference");
  assert.ok(frames[3]!.board.nodes[node("first-inference")]);
  assert.equal(frames[3]!.board.nodes[node("water-path")], undefined, "the hidden mechanism starts after the evidence section");
  assert.equal(sequence(frames[4]!, "water-path")?.length, 2);
  assert.equal(sequence(frames[5]!, "water-path")?.length, 4);
  assert.equal(sequence(frames[6]!, "water-path")?.length, 6);
  assert.equal(frames[6]!.board.nodes[node("condensation-path")], undefined, "condensation belongs to its own Beat");
  assert.equal(sequence(frames[7]!, "condensation-path")?.length, 4);

  assert.ok(frames[8]!.board.nodes[node("model-check")], "the completed model must return to the source comparison");
  assert.equal(rows(frames[9]!, "reasoning-layers")?.length, 3);
  assert.deepEqual(frames[9]!.board.focus, [node("reasoning-layers")]);
  assert.deepEqual(frames[10]!.board.focus, ["lesson-science-transpiration-v2-001:group:summary-group"]);
});

test("every geometry V2 beat narrates one visible board transition", () => {
  for (const event of geometryV2.events) {
    for (const beat of event.step?.beats ?? []) {
      assert.ok(beat.narration?.text.trim(), `${beat.id} must contain narration`);
      const actions = Object.values(beat.stage).flat();
      assert.ok(actions.length > 0, `${beat.id} must change the classroom state`);
      assert.ok(actions.some((action) => ["board.create", "board.connect", "board.revise", "board.emphasize"].includes(action.op)), `${beat.id} must produce a visible transition`);
      assert.ok(beat.stage.after_speech.some((action) => action.op === "board.focus"), `${beat.id} must finish on an explicit teaching focus`);
    }
  }
});

test("every quadratic V2 beat narrates one visible board transition", () => {
  for (const event of quadraticV2.events) {
    for (const beat of event.step?.beats ?? []) {
      assert.ok(beat.narration?.text.trim(), `${beat.id} must contain narration`);
      const actions = Object.values(beat.stage).flat();
      assert.ok(actions.length > 0, `${beat.id} must change the classroom state`);
      assert.ok(actions.some((action) => ["board.create", "board.connect", "board.emphasize"].includes(action.op)), `${beat.id} must produce a visible transition`);
      assert.ok(beat.stage.after_speech.some((action) => action.op === "board.focus"), `${beat.id} must finish on an explicit teaching focus`);
    }
  }
});

test("every science V2 beat narrates one visible board transition", () => {
  for (const event of scienceV2.events) {
    for (const beat of event.step?.beats ?? []) {
      assert.ok(beat.narration?.text.trim(), `${beat.id} must contain narration`);
      const actions = Object.values(beat.stage).flat();
      assert.ok(actions.length > 0, `${beat.id} must change the classroom state`);
      assert.ok(actions.some((action) => ["board.create", "board.connect", "board.revise", "board.emphasize"].includes(action.op)), `${beat.id} must produce a visible transition`);
      assert.ok(beat.stage.after_speech.some((action) => action.op === "board.focus"), `${beat.id} must finish on an explicit teaching focus`);
    }
  }
});

test("pause, checkpoint, refresh and resume converge to the same final state", () => {
  const player = new HeadlessLessonPlayer(quadratic.events);
  while (player.cursor < Math.floor(player.operations.length / 2)) player.advance();
  player.pause();
  assert.throws(() => player.advance(), (error) => error instanceof PlaybackError && error.code === "OLL_PLAYBACK_PAUSED");
  const checkpoint = player.checkpoint();
  const restored = HeadlessLessonPlayer.fromCheckpoint(quadratic.events, JSON.parse(JSON.stringify(checkpoint)));
  assert.equal(restored.status, "paused");
  restored.resume();
  restored.playAll();
  assert.deepEqual(restored.finalState(), reduceCanonicalEvents(quadratic.events));
});

test("checkpoint cannot be restored against a different Canonical program", () => {
  const player = new HeadlessLessonPlayer(quadratic.events);
  player.advance();
  const checkpoint = player.checkpoint();
  const other = structuredClone(quadratic.events);
  other[1]!.step!.purpose = "changed program";
  assert.throws(
    () => HeadlessLessonPlayer.fromCheckpoint(other, checkpoint),
    (error) => error instanceof PlaybackError && error.code === "OLL_CHECKPOINT_PROGRAM_MISMATCH",
  );
});

test("duplicate action replay is idempotent but a new action cannot overwrite a node", () => {
  const open = quadratic.events[0]!;
  const firstCreate = quadratic.events.flatMap((event) => event.step?.beats ?? [])
    .flatMap((beat) => Object.values(beat.stage).flat())
    .find((action) => action.op === "board.create")!;
  const state = createSemanticBoardState(open);
  assert.equal(applyCanonicalAction(state, firstCreate), true);
  const baseline = structuredClone(state);
  assert.equal(applyCanonicalAction(state, firstCreate), false);
  assert.deepEqual(state, baseline);
  const conflicting = structuredClone(firstCreate);
  conflicting.action_id = `${firstCreate.action_id}:conflict`;
  assert.throws(() => applyCanonicalAction(state, conflicting), /already exists/);
  assert.deepEqual(state, baseline);
});

test("event sequence and close boundaries are enforced before playback", () => {
  const invalidSequence = structuredClone(quadratic.events);
  invalidSequence[1]!.sequence = 9;
  assert.throws(() => new HeadlessLessonPlayer(invalidSequence), (error) => error instanceof PlaybackError && error.code === "OLL_PLAYBACK_SEQUENCE");

  const afterClose = structuredClone(quadratic.events) as CanonicalEvent[];
  afterClose.push(structuredClone(afterClose[1]!));
  afterClose.at(-1)!.sequence = afterClose.length - 1;
  assert.throws(() => new HeadlessLessonPlayer(afterClose), (error) => error instanceof PlaybackError && error.code === "OLL_PLAYBACK_AFTER_CLOSE");
});
