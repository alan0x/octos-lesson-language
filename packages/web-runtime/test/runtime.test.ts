import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reduceCanonicalEvents } from "../../core/src/index.js";
import type { PlaybackCheckpoint } from "../../player-core/src/index.js";
import { BrowserLessonSession, parseCanonicalJsonl, type PlaybackStore } from "../src/runtime.js";

class MemoryStore implements PlaybackStore {
  values = new Map<string, PlaybackCheckpoint>();
  load(key: string): PlaybackCheckpoint | undefined { return structuredClone(this.values.get(key)); }
  save(key: string, checkpoint: PlaybackCheckpoint): void { this.values.set(key, structuredClone(checkpoint)); }
  remove(key: string): void { this.values.delete(key); }
}

const source = await readFile(resolve(process.cwd(), "examples/quadratic/lesson.canonical.jsonl"), "utf8");
const events = parseCanonicalJsonl(source);

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
