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
