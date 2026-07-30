import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reduceCanonicalEvents } from "../../core/src/index.js";
import type { PlaybackCheckpoint } from "../../player-core/src/index.js";
import {
  BrowserLessonSession,
  narrationDuration,
  operationDelay,
  parseCanonicalJsonl,
  type PlaybackStore,
} from "../src/runtime.js";

class MemoryStore implements PlaybackStore {
  values = new Map<string, PlaybackCheckpoint>();
  load(key: string): PlaybackCheckpoint | undefined { return structuredClone(this.values.get(key)); }
  save(key: string, checkpoint: PlaybackCheckpoint): void { this.values.set(key, structuredClone(checkpoint)); }
  remove(key: string): void { this.values.delete(key); }
}

const source = await readFile(resolve(process.cwd(), "examples/quadratic/lesson.canonical.jsonl"), "utf8");
const events = parseCanonicalJsonl(source);

function advanceToFirstNarration(session: BrowserLessonSession): string {
  let text: string | undefined;
  while (!text) {
    const frame = session.advance();
    assert.ok(frame, "the fixture must contain narration");
    if (frame.operation.type === "narration.begin") {
      text = frame.operation.narration?.text;
    }
  }
  return text;
}

function tickElapsed(context: TestContext, duration: number): void {
  const wholeMilliseconds = Math.floor(duration);
  for (let elapsed = 0; elapsed < wholeMilliseconds; elapsed += 1) {
    context.mock.timers.tick(1);
  }
  const remainder = duration - wholeMilliseconds;
  if (remainder > 0) context.mock.timers.tick(remainder);
}

test("browser session progressively reveals and checkpoints a lesson", () => {
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "lesson");
  const initial = session.projection;
  assert.equal(initial.board, null);
  while (session.cursor < 18) session.advance();
  const board = session.projection.board;
  assert.ok(board);
  assert.ok(Object.keys(board.nodes).length > 0);
  assert.ok(Object.keys(board.nodes).length < Object.keys(reduceCanonicalEvents(events).nodes).length);
  assert.ok(store.values.has("lesson"));
});

test("browser session restores after refresh and converges to reducer state", () => {
  const store = new MemoryStore();
  const first = new BrowserLessonSession(events, store, "lesson");
  while (first.cursor < Math.floor(first.operations.length / 2)) first.advance();
  first.pause();
  const restored = new BrowserLessonSession(events, store, "lesson");
  assert.equal(restored.cursor, first.cursor);
  while (restored.projection.status !== "completed") restored.advance();
  assert.deepEqual(restored.projection.board, reduceCanonicalEvents(events));
});

test("advanceBeat stops at a visible classroom boundary", () => {
  const session = new BrowserLessonSession(events, new MemoryStore(), "lesson");
  session.advanceBeat();
  assert.equal(session.currentOperation?.type, "beat.end");
  assert.equal(session.status, "paused");
  assert.ok(session.cursor < session.operations.length);
});

test("browser session seeks to Step and Beat boundaries and persists the result", () => {
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "lesson");
  const [firstStep, secondStep] = session.outline;
  assert.ok(firstStep);
  assert.ok(secondStep);

  session.seekToStep(secondStep.id);
  assert.equal(session.cursor, secondStep.end_cursor);
  assert.equal(session.status, "paused");
  assert.deepEqual(
    session.projection.board?.applied_steps,
    [firstStep.id, secondStep.id],
  );
  assert.deepEqual(session.attentionTargets, secondStep.focus_targets);

  const restored = new BrowserLessonSession(events, store, "lesson");
  assert.equal(restored.cursor, secondStep.end_cursor);
  assert.deepEqual(restored.projection.board, session.projection.board);

  const beat = firstStep.beats[0]!;
  restored.seekToBeat(beat.id, "start");
  assert.equal(restored.cursor, beat.start_cursor);
  assert.equal(restored.advance()?.operation.type, "beat.begin");
  assert.deepEqual(restored.attentionTargets, []);
});

test("incremental browser session preserves the board while Canonical Steps arrive", () => {
  const store = new MemoryStore();
  const prefix = structuredClone(events.slice(0, 2));
  const session = new BrowserLessonSession(prefix, store, "stream", { incremental: true });
  while (session.status !== "waiting") session.advance();
  const firstBoard = session.projection.board;
  assert.ok(firstBoard);
  const firstNodes = Object.keys(firstBoard.nodes);
  const firstCursor = session.cursor;

  const appended = session.appendEvents([structuredClone(events[2]!)]);
  assert.equal(appended.accepted, 1);
  assert.ok(session.operations.length > firstCursor);
  while (session.status !== "waiting") session.advance();
  assert.ok(firstNodes.every((id) => Boolean(session.projection.board?.nodes[id])));
  assert.ok(session.cursor > firstCursor);
});

test("incremental browser session persists the expanded program checkpoint", () => {
  const store = new MemoryStore();
  const prefix = structuredClone(events.slice(0, 2));
  const first = new BrowserLessonSession(prefix, store, "stream", { incremental: true });
  while (first.status !== "waiting") first.advance();
  first.appendEvents([structuredClone(events[2]!)]);
  first.advance();

  const restored = new BrowserLessonSession(
    structuredClone(events.slice(0, 1)),
    store,
    "stream",
    { incremental: true },
  );
  assert.equal(restored.cursor, first.cursor);
  assert.equal(restored.projection.total_operations, first.projection.total_operations);
  assert.deepEqual(restored.projection.board, first.projection.board);
  assert.deepEqual(restored.events, first.events);
});

test("narration pacing accounts for reading load, delivery, and speed", () => {
  const short = narrationDuration("先看这里。", "neutral");
  const long = narrationDuration(
    "我们先把原式写下来，再一步一步观察每个数字为什么会发生变化。",
    "neutral",
  );
  const careful = narrationDuration(
    "我们先把原式写下来，再一步一步观察每个数字为什么会发生变化。",
    "careful",
  );

  assert.ok(short >= 1_800);
  assert.ok(long > short);
  assert.ok(careful > long);
  assert.equal(narrationDuration("请观察这个等式。", "neutral", 2), narrationDuration("请观察这个等式。", "neutral") / 2);
});

test("visible board work gets a content-aware teaching delay", () => {
  const session = new BrowserLessonSession(events, new MemoryStore(), "lesson");
  const create = session.operations.find((operation) =>
    operation.type === "action.apply" && operation.action?.op === "board.create"
  );
  const point = session.operations.find((operation) =>
    operation.type === "action.apply" && operation.action?.op === "teacher.point"
  );

  assert.ok(create);
  assert.ok(point);
  assert.ok(operationDelay(create) >= 1_100);
  assert.equal(operationDelay(point), 450);
  assert.equal(operationDelay(point, 2), 225);
});

test("continuous playback keeps narration visible for its reading budget", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const session = new BrowserLessonSession(events, new MemoryStore(), "lesson");
  const text = advanceToFirstNarration(session);
  const budget = narrationDuration(text);

  session.play();
  tickElapsed(context, budget - 1);
  assert.equal(session.projection.current_narration?.text, text);

  tickElapsed(context, 2);
  assert.notEqual(session.projection.current_narration?.text, text);
});

test("pause and resume preserve the remaining narration budget", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const session = new BrowserLessonSession(events, new MemoryStore(), "lesson");
  const text = advanceToFirstNarration(session);
  const budget = narrationDuration(text);

  session.play();
  tickElapsed(context, 1_000);
  session.pause();
  context.mock.timers.tick(60_000);
  assert.equal(session.projection.current_narration?.text, text);

  session.play();
  tickElapsed(context, budget - 1_001);
  assert.equal(session.projection.current_narration?.text, text);
  tickElapsed(context, 2);
  assert.notEqual(session.projection.current_narration?.text, text);
});

test("changing speed reschedules the remaining teaching wait", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const session = new BrowserLessonSession(events, new MemoryStore(), "lesson");
  const text = advanceToFirstNarration(session);
  const budget = narrationDuration(text);

  session.play();
  tickElapsed(context, 1_000);
  session.setSpeed(2);
  tickElapsed(context, (budget - 1_000) / 2 - 1);
  assert.equal(session.projection.current_narration?.text, text);
  tickElapsed(context, 2);
  assert.notEqual(session.projection.current_narration?.text, text);
});

test("manual Beat advance skips teaching waits", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const session = new BrowserLessonSession(events, new MemoryStore(), "lesson");
  const text = advanceToFirstNarration(session);
  session.play();
  context.mock.timers.tick(250);

  session.advanceBeat();

  assert.equal(session.currentOperation?.type, "beat.end");
  assert.equal(session.status, "paused");
  assert.notEqual(session.projection.current_narration?.text, text);
});
