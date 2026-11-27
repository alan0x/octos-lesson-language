import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeAuthoringLesson, reduceCanonicalEvents, type AuthoringLesson } from "../../core/src/index.js";
import type { PlaybackCheckpoint } from "../../player-core/src/index.js";
import { computeBoardLayout } from "../src/layout.js";
import {
  BrowserLessonSession,
  narrationDuration,
  operationDelay,
  parseCanonicalJsonl,
  variableAnimationDuration,
  type PlaybackStore,
} from "../src/runtime.js";
import type {
  StudentOperationLog,
  StudentVariableOperation,
} from "../src/student-operations.js";
import type { StudentTaskProgressLog, StudentTaskSnapshot } from "../src/student-tasks.js";
import { applyBaseTenTap, baseTenMat, type BaseTenTap } from "../../plugin-math/src/base-ten-trade.js";
import { parseStudentOperationLog, type StudentOperation } from "../src/student-operations.js";
import { variableControlModels } from "../src/variable-controls.js";
import { chartHost, chartLesson, chartVariable } from "../../plugin-math/test/place-value-chart-fixtures.js";
import { tradeHost, tradeLesson, tradeVariable } from "../../plugin-math/test/place-value-trade-fixtures.js";
import { makeTenHost, makeTenLesson } from "../../plugin-math/test/make-ten-fixtures.js";

class MemoryStore implements PlaybackStore {
  values = new Map<string, PlaybackCheckpoint>();
  studentOperations = new Map<string, StudentOperationLog>();
  studentTaskProgress = new Map<string, StudentTaskProgressLog>();
  load(key: string): PlaybackCheckpoint | undefined { return structuredClone(this.values.get(key)); }
  save(key: string, checkpoint: PlaybackCheckpoint): void { this.values.set(key, structuredClone(checkpoint)); }
  remove(key: string): void { this.values.delete(key); }
  loadStudentOperations(key: string): unknown { return structuredClone(this.studentOperations.get(key)); }
  saveStudentOperations(key: string, log: StudentOperationLog): void {
    this.studentOperations.set(key, structuredClone(log));
  }
  removeStudentOperations(key: string): void { this.studentOperations.delete(key); }
  loadStudentTaskProgress(key: string): unknown { return structuredClone(this.studentTaskProgress.get(key)); }
  saveStudentTaskProgress(key: string, log: StudentTaskProgressLog): void {
    this.studentTaskProgress.set(key, structuredClone(log));
  }
  removeStudentTaskProgress(key: string): void { this.studentTaskProgress.delete(key); }
}

const source = await readFile(resolve(process.cwd(), "examples/quadratic/lesson.canonical.jsonl"), "utf8");
const events = parseCanonicalJsonl(source);
const unitCircleSource = await readFile(resolve(process.cwd(), "examples/unit-circle-sine/lesson.canonical.jsonl"), "utf8");
const unitCircleEvents = parseCanonicalJsonl(unitCircleSource);

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
  assert.deepEqual(
    restored.compositionTargets,
    beat.focus_targets,
    "normal playback should expose the Beat's existing focus without applying another action",
  );
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

test("incremental restore rejects a saved program whose lesson variables changed", () => {
  const store = new MemoryStore();
  const oldPrefix = structuredClone(unitCircleEvents.slice(0, 2));
  const first = new BrowserLessonSession(
    oldPrefix,
    store,
    "changed-incremental-program",
    { incremental: true },
  );
  while (first.status !== "waiting") first.advance();
  first.changeStudentVariable("theta", Math.PI / 2, {
    control: "slider",
    input: "mouse",
  });
  assert.ok(store.values.has("changed-incremental-program"));
  assert.equal(store.studentOperations.get("changed-incremental-program")?.operations.length, 1);

  const deliveredOpen = structuredClone(unitCircleEvents[0]!);
  deliveredOpen.lesson!.variables![0]!.as = "v_turn_theta";
  const restored = new BrowserLessonSession(
    [deliveredOpen],
    store,
    "changed-incremental-program",
    { incremental: true },
  );

  assert.equal(restored.cursor, 0, "stale playback progress must not override the new lesson.open");
  assert.deepEqual(restored.events, [deliveredOpen]);
  assert.equal(restored.studentOperations.length, 0);
  assert.equal(store.values.has("changed-incremental-program"), false);
  assert.equal(store.studentOperations.has("changed-incremental-program"), false);
});

test("incremental restore rejects a saved program whose existing task changed", () => {
  const store = new MemoryStore();
  const oldPrefix = structuredClone(unitCircleEvents.slice(0, 2));
  oldPrefix[0]!.lesson!.tasks = [{
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
    hints: ["把角度移到 π/2 附近。"],
    success_message: "正确，sin θ 已经达到最大值。",
  }];
  const first = new BrowserLessonSession(
    oldPrefix,
    store,
    "changed-incremental-task",
    { incremental: true },
  );
  while (first.status !== "waiting") first.advance();
  assert.ok(store.values.has("changed-incremental-task"));

  const delivered = structuredClone(oldPrefix);
  delivered[0]!.lesson!.tasks![0]!.completion = {
    kind: "expression_target",
    expression: "sin(theta)",
    value: 0,
    tolerance: 0.01,
  };
  delivered[0]!.lesson!.tasks![0]!.success_message = "正确，sin θ 已经回到零。";
  const restored = new BrowserLessonSession(
    [structuredClone(delivered[0]!)],
    store,
    "changed-incremental-task",
    { incremental: true, deliveredProgram: delivered },
  );

  assert.equal(restored.cursor, 0, "changed task semantics must invalidate stale playback progress");
  assert.deepEqual(restored.events, [delivered[0]]);
  assert.equal(store.values.has("changed-incremental-task"), false);
});

test("incremental restore checks saved Steps against the host's complete delivered prefix", () => {
  const store = new MemoryStore();
  const oldOpen = structuredClone(unitCircleEvents[0]!);
  const oldStep = structuredClone(unitCircleEvents[1]!);
  const first = new BrowserLessonSession(
    [oldOpen],
    store,
    "stale-expanded-program",
    { incremental: true },
  );
  while (first.status !== "waiting") first.advance();
  first.appendEvents([oldStep]);

  const deliveredOpen = structuredClone(oldOpen);
  deliveredOpen.lesson!.variables!.push({
    ...structuredClone(deliveredOpen.lesson!.variables![0]!),
    as: "v_later_theta",
    label: "下一轮课程的角度",
  });
  const deliveredStep = structuredClone(oldStep);
  deliveredStep.step!.purpose = "当前版本已经重新整理的教学步骤";
  const restored = new BrowserLessonSession(
    [deliveredOpen],
    store,
    "stale-expanded-program",
    {
      incremental: true,
      deliveredProgram: [deliveredOpen, deliveredStep],
    },
  );

  assert.equal(restored.cursor, 0);
  assert.deepEqual(restored.events, [deliveredOpen]);
  assert.equal(store.values.has("stale-expanded-program"), false);
});

test("incremental restore adds newly delivered variables without replaying prior Steps", () => {
  const store = new MemoryStore();
  const oldPrefix = structuredClone(unitCircleEvents.slice(0, 2));
  const first = new BrowserLessonSession(
    oldPrefix,
    store,
    "extended-open-program",
    { incremental: true },
  );
  while (first.status !== "waiting") first.advance();
  const savedCursor = first.cursor;

  const delivered = structuredClone(oldPrefix);
  delivered[0]!.lesson!.variables!.push({
    ...structuredClone(delivered[0]!.lesson!.variables![0]!),
    as: "v_later_theta",
    label: "下一轮课程的角度",
  });
  const restored = new BrowserLessonSession(
    [structuredClone(delivered[0]!)],
    store,
    "extended-open-program",
    { incremental: true, deliveredProgram: delivered },
  );

  assert.equal(restored.cursor, savedCursor);
  const initial = delivered[0]!.lesson!.variables![0]!.initial;
  assert.equal(
    restored.projection.board?.variables?.theta?.value,
    first.projection.board?.variables?.theta?.value,
  );
  assert.equal(restored.projection.board?.variables?.v_later_theta?.value, initial);
  assert.deepEqual(restored.events[0], delivered[0]);
});

for (const hasPriorReflection of [false, true]) {
  test(`incremental restore preserves playback when appending ${hasPriorReflection ? "another" : "the first"} reflection`, () => {
    const store = new MemoryStore();
    const prefix = structuredClone(unitCircleEvents.slice(0, 2));
    const anchor = prefix[1]!.step!.beats.flatMap(beat => Object.values(beat.stage).flat())
      .find(action => action.op === "board.create")!.node!.id;
    const reflection = { as: "first-reflection", prompt: "What changes?", answer: "The point moves.", anchor,
      availability: { kind: "after_lesson" as const } };
    if (hasPriorReflection) prefix[0]!.lesson!.reflections = [reflection];
    else delete prefix[0]!.lesson!.reflections;
    const first = new BrowserLessonSession(prefix, store, "appended-reflection", { incremental: true });
    while (first.status !== "waiting") first.advance();
    first.changeStudentVariable("theta", Math.PI / 2, { control: "slider", input: "mouse" });
    const savedCursor = first.cursor;
    const savedBoard = structuredClone(first.projection.board);

    const delivered = structuredClone(prefix);
    delivered[0]!.lesson!.reflections = [...(delivered[0]!.lesson!.reflections ?? []),
      { ...reflection, as: "next-reflection", prompt: "What stays the same?", answer: "The radius." }];
    delivered.push(structuredClone(unitCircleEvents[2]!));
    const restored = new BrowserLessonSession([structuredClone(delivered[0]!)], store, "appended-reflection",
      { incremental: true, deliveredProgram: delivered });

    assert.equal(restored.cursor, savedCursor);
    assert.deepEqual(restored.projection.board, savedBoard);
    assert.deepEqual(restored.studentOperations, first.studentOperations);
    assert.deepEqual(restored.events[0], delivered[0]);
    assert.equal(restored.reflections.length, hasPriorReflection ? 2 : 1);
    restored.appendEvents(delivered.slice(prefix.length));
    assert.equal(restored.cursor, savedCursor, "new Steps append without replaying the old ones");
    assert.ok(restored.advance());
    assert.equal(restored.cursor, savedCursor + 1);
    restored.pause();
  });
}

for (const change of ["prompt", "answer", "anchor", "remove"] as const) {
  test(`incremental restore rejects an existing reflection ${change} change`, () => {
    const store = new MemoryStore();
    const prefix = structuredClone(unitCircleEvents.slice(0, 2));
    const anchor = prefix[1]!.step!.beats.flatMap(beat => Object.values(beat.stage).flat())
      .find(action => action.op === "board.create")!.node!.id;
    prefix[0]!.lesson!.reflections = [{ as: "reflection", prompt: "What changes?", answer: "The point moves.", anchor,
      availability: { kind: "after_lesson" } }];
    const first = new BrowserLessonSession(prefix, store, "changed-reflection", { incremental: true });
    while (first.status !== "waiting") first.advance();
    const delivered = structuredClone(prefix);
    if (change === "remove") delete delivered[0]!.lesson!.reflections;
    else delivered[0]!.lesson!.reflections![0]![change] = change === "anchor" ? "different-node" : "Changed meaning";
    const restored = new BrowserLessonSession([structuredClone(delivered[0]!)], store, "changed-reflection",
      { incremental: true, deliveredProgram: delivered });
    assert.equal(restored.cursor, 0, "changing existing teaching content still invalidates the checkpoint");
    assert.equal(store.values.has("changed-reflection"), false);
  });
}

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

test("external narration timing waits for the matching audio completion", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const session = new BrowserLessonSession(
    events,
    new MemoryStore(),
    "external-narration",
    { narrationTiming: "external" },
  );
  const text = advanceToFirstNarration(session);
  const beatId = session.currentOperation?.beat_id;
  assert.ok(beatId);

  session.play();
  tickElapsed(context, 120_000);
  assert.equal(
    session.currentOperation?.type,
    "narration.begin",
    "during-speech work must wait until real audio starts",
  );

  session.startNarration(beatId);
  tickElapsed(context, 120_000);
  assert.equal(
    session.projection.current_narration?.text,
    text,
    "the estimated reading clock must not cut off real audio",
  );

  session.completeNarration(beatId);
  tickElapsed(context, 120_000);
  assert.notEqual(session.projection.current_narration?.text, text);
});

test("external narration ignores stale starts and completion releases both boundaries", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const session = new BrowserLessonSession(
    events,
    new MemoryStore(),
    "external-narration-fallback",
    { narrationTiming: "external" },
  );
  const text = advanceToFirstNarration(session);
  const beatId = session.currentOperation?.beat_id;
  assert.ok(beatId);

  session.play();
  session.startNarration("stale-beat");
  tickElapsed(context, 60_000);
  assert.equal(session.currentOperation?.type, "narration.begin");

  session.completeNarration(beatId);
  tickElapsed(context, 120_000);
  assert.notEqual(session.projection.current_narration?.text, text);
});

test("external narration start gate survives a refresh inside during_speech", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MemoryStore();
  const first = new BrowserLessonSession(
    events,
    store,
    "external-narration-refresh",
    { narrationTiming: "external" },
  );
  advanceToFirstNarration(first);
  const beatId = first.currentOperation?.beat_id;
  assert.ok(beatId);
  const phase = first.advance();
  assert.equal(phase?.operation.type, "phase.begin");
  assert.equal(phase?.operation.phase, "during_speech");

  const restored = new BrowserLessonSession(
    events,
    store,
    "external-narration-refresh",
    { narrationTiming: "external" },
  );
  const blockedCursor = restored.cursor;
  restored.play();
  tickElapsed(context, 60_000);
  assert.equal(restored.cursor, blockedCursor);

  restored.startNarration(beatId);
  tickElapsed(context, 2_000);
  assert.ok(restored.cursor > blockedCursor);
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

function advanceToVariableAnimation(session: BrowserLessonSession): void {
  while (!session.activeVariableAnimation) {
    assert.ok(session.advance(), "unit-circle fixture must contain a variable animation");
  }
}

test("variable animation advances one shared value and survives pause and refresh", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MemoryStore();
  const first = new BrowserLessonSession(unitCircleEvents, store, "unit-circle");
  advanceToVariableAnimation(first);
  assert.equal(first.projection.board?.variables?.theta?.value, 0);

  first.play();
  tickElapsed(context, variableAnimationDuration("extended") / 2);
  const halfway = first.projection.board?.variables?.theta?.value ?? 0;
  assert.ok(halfway > 3 && halfway < 3.2);
  const point = first.projection.board?.nodes["lesson-unit-circle-sine-001:node:unit-circle"]?.content.points
    .find((item: any) => item.id.endsWith(":point-p"));
  const current = first.projection.board?.nodes["lesson-unit-circle-sine-001:node:sine-plot"]?.content.points
    .find((item: any) => item.id.endsWith(":current-angle"));
  assert.ok(Math.abs(point.y - Math.sin(halfway)) < 1e-12);
  assert.ok(Math.abs(current.x - halfway) < 1e-12);
  assert.ok(Math.abs(current.y - point.y) < 1e-12);
  const layout = computeBoardLayout(first.projection.board!);
  assert.ok(
    layout.nodes["lesson-unit-circle-sine-001:node:sine-plot"]!.x
      > layout.nodes["lesson-unit-circle-sine-001:node:unit-circle"]!.x,
    "changing a variable must not reorder nodes or reverse relative placement",
  );

  first.pause();
  const pausedValue = first.projection.board?.variables?.theta?.value;
  const restored = new BrowserLessonSession(unitCircleEvents, store, "unit-circle");
  assert.ok(restored.activeVariableAnimation);
  assert.equal(restored.projection.board?.variables?.theta?.value, pausedValue);
  restored.play();
  tickElapsed(context, variableAnimationDuration("extended") / 2 + 40);
  assert.equal(restored.activeVariableAnimation, undefined);
  assert.equal(restored.projection.board?.variables?.theta?.value, 2 * Math.PI);
});

test("paused animation can be replaced by learner input and the value is restored", () => {
  const store = new MemoryStore();
  const session = new BrowserLessonSession(unitCircleEvents, store, "unit-circle-manual");
  advanceToVariableAnimation(session);
  session.setVariable("theta", Math.PI / 2);
  assert.equal(session.status, "paused");
  assert.equal(session.activeVariableAnimation, undefined);
  assert.equal(session.projection.board?.variables?.theta?.value, Math.PI / 2);

  const restored = new BrowserLessonSession(unitCircleEvents, store, "unit-circle-manual");
  assert.equal(restored.projection.board?.variables?.theta?.value, Math.PI / 2);
});

test("teacher animation temporarily owns its variable without pausing narration", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const session = new BrowserLessonSession(unitCircleEvents, new MemoryStore(), "unit-circle-teacher-control");
  advanceToVariableAnimation(session);
  session.play();
  const before = session.projection.board?.variables?.theta?.value;
  const operation = session.changeStudentVariable("theta", Math.PI / 2, {
    control: "slider",
    input: "mouse",
  });
  assert.equal(operation, undefined);
  assert.equal(session.status, "playing");
  assert.equal(session.projection.board?.variables?.theta?.value, before);
  assert.ok(session.activeVariableAnimation);
  assert.equal(session.studentOperations.length, 0);
});

test("student slider and geometry gestures share one persisted variable operation log", () => {
  const store = new MemoryStore();
  const first = new BrowserLessonSession(unitCircleEvents, store, "student-variable-operations");
  advanceToVariableAnimation(first);

  const sliderId = first.beginStudentVariableOperation("theta", {
    control: "slider",
    input: "keyboard",
  });
  first.updateStudentVariableOperation(sliderId, Math.PI / 4);
  first.updateStudentVariableOperation(sliderId, Math.PI / 2);
  first.commitStudentVariableOperation(sliderId);

  const geometryId = first.beginStudentVariableOperation("theta", {
    control: "geometry_point",
    input: "touch",
  });
  first.updateStudentVariableOperation(geometryId, 3 * Math.PI / 4);
  first.commitStudentVariableOperation(geometryId, Math.PI);

  assert.equal(first.studentOperations.length, 2, "many drag samples produce two completed gestures, not four samples");
  const variableOperations = first.studentOperations.filter(
    (operation): operation is StudentVariableOperation =>
      operation.kind === "variable_change",
  );
  assert.deepEqual(
    variableOperations.map((operation) => ({
      kind: operation.kind,
      target: operation.target,
      control: operation.control,
      input: operation.input,
      before: operation.before.value,
      after: operation.after.value,
    })),
    [
      {
        kind: "variable_change",
        target: { kind: "lesson_variable", alias: "theta" },
        control: "slider",
        input: "keyboard",
        before: 0,
        after: Math.PI / 2,
      },
      {
        kind: "variable_change",
        target: { kind: "lesson_variable", alias: "theta" },
        control: "geometry_point",
        input: "touch",
        before: Math.PI / 2,
        after: Math.PI,
      },
    ],
  );

  first.changeStudentVariable("theta", 0, {
    control: "reset",
    input: "mouse",
    operationId: "stable-reset",
  });
  first.changeStudentVariable("theta", Math.PI / 2, {
    control: "reset",
    input: "mouse",
    operationId: "stable-reset",
  });
  assert.equal(first.studentOperations.length, 3, "a retried operation id is stored once");
  assert.equal(first.projection.board?.variables?.theta?.value, 0, "a duplicate retry cannot overwrite the committed result");

  first.reset();
  assert.equal(first.studentOperations.length, 3, "course replay preserves the student's operation history");
  const restored = new BrowserLessonSession(unitCircleEvents, store, "student-variable-operations");
  assert.deepEqual(restored.studentOperations, first.studentOperations);
});

test("ink selections enter the same persisted student operation history", () => {
  const store = new MemoryStore();
  const first = new BrowserLessonSession(unitCircleEvents, store, "student-ink-selection");
  const source = {
    source_id: "source-1",
    document_id: "student-ink-1",
    document_version: 3,
    bounds: { x: 80, y: 120, width: 240, height: 90 },
    checksum: { algorithm: "sha-256" as const, value: "a".repeat(64) },
  };

  const recorded = first.recordStudentInkSelection(source, "pen");
  assert.equal(recorded.kind, "ink_selection");
  assert.deepEqual(recorded.target.bounds, source.bounds);
  assert.equal(first.studentOperations.length, 1);
  assert.deepEqual(
    first.recordStudentInkSelection(source, "pen"),
    recorded,
    "replaying the same source is idempotent",
  );
  assert.equal(first.studentOperations.length, 1);

  const restored = new BrowserLessonSession(unitCircleEvents, store, "student-ink-selection");
  assert.deepEqual(restored.studentOperations, first.studentOperations);
  assert.throws(
    () => restored.recordStudentInkSelection({ ...source, document_version: 4 }, "pen"),
    /already recorded differently/,
  );
});

test("3D view gestures persist and distinguish viewing direction from an exact camera pose", () => {
  const sceneEvents = normalizeAuthoringLesson({
    dsl: "octos.lesson",
    version: "0.1",
    profile: "authoring",
    lesson: {
      mode: "explain",
      language: "zh-CN",
      title: "立方体",
      goals: ["观察空间结构"],
      tasks: [{
        as: "find-front-view",
        prompt: "把立方体转到正视图",
        availability: { kind: "after_lesson" },
        allowed_operations: [{
          kind: "scene3d_view",
          node: "cube-scene",
          controls: ["orbit", "preset", "reset"],
        }],
        completion: {
          kind: "scene3d_view_target",
          node: "cube-scene",
          yaw: 0,
          pitch: 0,
          zoom: 1,
          angular_tolerance: .04,
          zoom_tolerance: .04,
        },
        hints: ["使用正视按钮，或拖动到正前方。"],
        success_message: "正确，这是立方体的正视图。",
      }, {
        as: "find-top-view",
        prompt: "从正上方观察立方体",
        availability: { kind: "after_lesson" },
        allowed_operations: [{
          kind: "scene3d_view",
          node: "cube-scene",
          controls: ["orbit"],
        }],
        completion: {
          kind: "scene3d_view_target",
          node: "cube-scene",
          match: "view_direction",
          yaw: 0,
          pitch: Math.PI / 2,
          zoom: 1,
          angular_tolerance: .04,
          zoom_tolerance: .04,
        },
        hints: ["向上拖动到只能看到顶面。"],
        success_message: "正确，这是立方体的俯视方向。",
      }],
    },
    steps: [{
      key: "scene-step",
      purpose: "显示三维对象",
      beats: [{
        key: "scene-beat",
        actions: [{
          do: "write",
          as: "cube-scene",
          kind: "scene3d",
          role: "diagram",
          content: {
            fallback: "一个中心位于原点、边长为 2 的立方体。",
            axes: true,
            camera: { yaw: .7, pitch: .5, zoom: 1 },
            objects: [{
              as: "cube",
              kind: "box",
              center: { x: 0, y: 0, z: 0 },
              size: { x: 2, y: 2, z: 2 },
            }],
          },
          place: { relation: "new_region" },
        }, {
          do: "focus",
          targets: ["cube-scene"],
          intent: "current_step",
        }],
      }],
    }],
    close: { summary: "观察完成。", focus: ["cube-scene"] },
  }, { lessonId: "scene", boardId: "scene-board", baseRevision: 0 });
  const store = new MemoryStore();
  const first = new BrowserLessonSession(sceneEvents, store, "scene-operations");
  while (first.projection.status !== "completed") first.advance();
  const nodeId = Object.values(first.projection.board!.nodes)[0]!.id;
  const before = first.scene3dViews[nodeId]!;
  const operationId = first.handleStudentScene3dInput(nodeId, before, {
    phase: "start", control: "orbit", input: "touch",
  });
  assert.equal(typeof operationId, "string");
  first.handleStudentScene3dInput(nodeId, { yaw: 1.2, pitch: .2, zoom: 1 }, {
    phase: "update", control: "orbit", input: "touch", operation_id: operationId as string,
  });
  first.handleStudentScene3dInput(nodeId, { yaw: 1.4, pitch: .1, zoom: 1 }, {
    phase: "commit", control: "orbit", input: "touch", operation_id: operationId as string,
  });
  assert.equal(first.studentOperations.length, 1);
  assert.equal(first.studentOperations[0]!.kind, "scene3d_view");
  assert.deepEqual(first.scene3dViews[nodeId], { yaw: 1.4, pitch: .1, zoom: 1 });
  assert.equal(first.studentTasks[0]!.status, "in_progress");
  assert.equal(first.studentTasks[1]!.status, "not_started");

  const presetId = first.handleStudentScene3dInput(nodeId, first.scene3dViews[nodeId]!, {
    phase: "start", control: "preset", input: "keyboard",
  });
  first.handleStudentScene3dInput(nodeId, { yaw: 0, pitch: 0, zoom: 1 }, {
    phase: "commit", control: "preset", input: "keyboard", operation_id: presetId as string,
  });
  assert.equal(first.studentTasks[0]!.status, "succeeded");
  assert.equal(first.studentTasks[0]!.attempts.length, 2);

  const topViewId = first.handleStudentScene3dInput(nodeId, first.scene3dViews[nodeId]!, {
    phase: "start", control: "orbit", input: "touch",
  });
  first.handleStudentScene3dInput(nodeId, { yaw: 1.4, pitch: Math.PI / 2, zoom: 1.8 }, {
    phase: "commit", control: "orbit", input: "touch", operation_id: topViewId as string,
  });
  assert.equal(
    first.studentTasks[1]!.status,
    "succeeded",
    "a top-view direction task must not require hidden yaw or zoom values",
  );

  const restored = new BrowserLessonSession(sceneEvents, store, "scene-operations");
  assert.deepEqual(restored.scene3dViews, first.scene3dViews);
  assert.deepEqual(restored.studentOperations, first.studentOperations);
  assert.deepEqual(restored.studentTasks.map((task) => task.status), ["succeeded", "succeeded"]);
});

test("student tasks judge committed operations, reveal hints, retry, and restore progress", () => {
  const taskEvents = structuredClone(unitCircleEvents);
  taskEvents[0]!.lesson!.tasks = [{
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
    hints: ["观察纵坐标。", "把角度移到 π/2 附近。"],
    hint_after_attempts: 2,
    success_message: "正确，sin θ 已经达到最大值。",
  }];
  const store = new MemoryStore();
  const first = new BrowserLessonSession(taskEvents, store, "student-task");
  advanceToVariableAnimation(first);

  assert.equal(first.studentTasks[0]!.available, false);
  const exploration = first.beginStudentVariableOperation("theta", { control: "slider", input: "mouse" });
  first.updateStudentVariableOperation(exploration, Math.PI / 4);
  first.commitStudentVariableOperation(exploration);
  assert.equal(first.studentTasks[0]!.attempts.length, 0, "exploration during the lesson is not a task attempt");
  assert.throws(
    () => first.requestStudentTaskHint("reach-sine-maximum"),
    /not available before the lesson completes/,
  );
  while (first.projection.status !== "completed") first.advance();
  assert.equal(first.studentTasks[0]!.available, true);

  first.changeStudentVariable("theta", Math.PI / 3, { control: "slider", input: "mouse" });
  assert.equal(first.studentTasks[0]!.status, "in_progress");
  assert.equal(first.studentTasks[0]!.attempts.length, 1);

  first.changeStudentVariable("theta", Math.PI / 4, { control: "geometry_point", input: "touch" });
  assert.equal(first.studentTasks[0]!.status, "needs_hint");
  assert.equal(first.requestStudentTaskHint("reach-sine-maximum").current_hint, "观察纵坐标。");

  const retried = first.retryStudentTask("reach-sine-maximum", "mouse");
  assert.equal(retried.status, "not_started");
  const resetOperation = first.studentOperations.at(-1);
  assert.equal(resetOperation?.kind, "variable_change");
  assert.equal(
    resetOperation?.kind === "variable_change" ? resetOperation.control : undefined,
    "reset",
  );
  assert.equal(first.studentTasks[0]!.attempts.length, 2, "retry preserves the attempt history");

  first.changeStudentVariable("theta", Math.PI / 2, { control: "slider", input: "keyboard" });
  assert.equal(first.studentTasks[0]!.status, "succeeded");
  assert.equal(first.studentTasks[0]!.attempts.at(-1)!.succeeded, true);

  const restored = new BrowserLessonSession(taskEvents, store, "student-task");
  assert.deepEqual(restored.studentTasks, first.studentTasks);
  const operationCount = restored.studentOperations.length;
  restored.changeStudentVariable("theta", Math.PI, {
    control: "slider",
    input: "mouse",
    operationId: "after-success",
  });
  assert.equal(restored.studentTasks[0]!.status, "succeeded", "a completed task remains completed");
  assert.equal(restored.studentTasks[0]!.attempts.length, 3, "post-success exploration is not a new task attempt");
  assert.equal(restored.studentOperations.length, operationCount + 1);

  store.studentTaskProgress.get("student-task")!.tasks[0]!.attempts[0]!.operation_id = "missing-operation";
  const invalidProgress = new BrowserLessonSession(taskEvents, store, "student-task");
  assert.equal(invalidProgress.studentTasks[0]!.status, "not_started");
  assert.equal(invalidProgress.studentTasks[0]!.attempts.length, 0, "task progress without its source operation is discarded");
});

test("numeric answer tasks judge typed answers, ignore unreadable text, and restore progress", () => {
  const taskEvents = structuredClone(unitCircleEvents);
  taskEvents[0]!.lesson!.tasks = [{
    as: "simplify",
    anchor: "unit-circle:node:card",
    prompt: "把 6/8 化成最简分数",
    availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "answer_entry" }],
    completion: { kind: "numeric_answer", answer: "3/4", form: "simplest_fraction" },
    hints: ["分子分母同时除以 2。"],
    hint_after_attempts: 2,
  }, {
    as: "then-reach",
    prompt: "把圆周点拖到 sin θ = 1",
    availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "variable_change", variable: "theta", controls: ["slider"] }],
    completion: { kind: "expression_target", expression: "sin(theta)", value: 1, tolerance: 0.01 },
    hints: ["把角度移到 π/2 附近。"],
  }];
  const store = new MemoryStore();
  const first = new BrowserLessonSession(taskEvents, store, "answer-task");
  assert.throws(() => first.submitStudentAnswer("simplify", "3/4"), /not available before the lesson completes/);
  while (first.projection.status !== "completed") first.advance();

  assert.deepEqual(first.submitStudentAnswer("simplify", "三四"), { unreadable: true });
  assert.equal(first.studentTasks[0]!.attempts.length, 0, "unreadable text is not an attempt");
  assert.throws(() => first.submitStudentAnswer("then-reach", "1"), /does not take a typed answer/);

  // A slider gesture does not answer a typed question.
  first.changeStudentVariable("theta", Math.PI / 2, { control: "slider", input: "mouse" });
  assert.equal(first.studentTasks[0]!.attempts.length, 0);

  const wrongForm = first.submitStudentAnswer("simplify", "6/8");
  assert.ok(!("unreadable" in wrongForm));
  assert.equal(wrongForm.status, "in_progress");
  assert.equal(wrongForm.attempts[0]!.answer, "6/8");
  assert.equal((first.submitStudentAnswer("simplify", "0.7") as StudentTaskSnapshot).status, "needs_hint");
  assert.equal(first.studentOperations.at(-1)!.kind, "answer_submit");
  assert.equal(first.retryStudentTask("simplify").status, "not_started");
  const solved = first.submitStudentAnswer("simplify", "３／４");
  assert.ok(!("unreadable" in solved));
  assert.equal(solved.status, "succeeded");
  assert.deepEqual(solved.attempts.map((attempt) => attempt.succeeded), [false, false, true]);
  assert.equal(first.studentTasks[1]!.available, true, "the next task opens after the typed answer");

  const restored = new BrowserLessonSession(taskEvents, store, "answer-task");
  assert.deepEqual(restored.studentTasks, first.studentTasks);
  assert.deepEqual(restored.studentOperations, first.studentOperations);

  store.studentTaskProgress.get("answer-task")!.tasks[0]!.attempts[0]!.succeeded = true;
  const tampered = new BrowserLessonSession(taskEvents, store, "answer-task");
  assert.equal(tampered.studentTasks[0]!.attempts.length, 0, "a saved attempt must repeat its own check");
});

test("an incremental final artifact restores playback and opens its deferred task when delivery settles", () => {
  const finalEvents = structuredClone(unitCircleEvents.slice(0, -1));
  finalEvents[0]!.lesson!.tasks = [{
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
    hints: ["把角度移到 π/2 附近。"],
    success_message: "正确，sin θ 已经达到最大值。",
  }];
  const prefixEvents = structuredClone(finalEvents);
  delete prefixEvents[0]!.lesson!.tasks;
  const store = new MemoryStore();

  const prefix = new BrowserLessonSession(
    prefixEvents,
    store,
    "incremental-final-task",
    { incremental: true },
  );
  while (prefix.status !== "waiting") prefix.advance();
  assert.equal(prefix.studentTasks.length, 0);

  const final = new BrowserLessonSession(
    finalEvents,
    store,
    "incremental-final-task",
    { incremental: true },
  );
  assert.equal(final.status, "waiting", "the final artifact restores the prefix checkpoint");
  assert.equal(final.studentTasks.length, 1, "the final artifact supplies its task definitions");
  assert.equal(final.studentTasks[0]!.available, false, "waiting alone does not claim delivery is finished");

  final.setDeliverySettled(true);
  assert.equal(final.studentTasks[0]!.available, true);
  assert.equal(final.isDeliverySettled, true);
  final.setDeliverySettled(false);
  assert.equal(final.studentTasks[0]!.available, false, "a new delivery closes the task window again");
  assert.equal(final.isDeliverySettled, false);
  final.setDeliverySettled(true);
  final.changeStudentVariable("theta", Math.PI / 2, {
    control: "slider",
    input: "mouse",
  });
  assert.equal(final.studentTasks[0]!.status, "succeeded");
  assert.equal(final.status, "waiting", "manual input preserves the settled playback state");
  assert.equal(final.isDeliverySettled, true, "manual input cannot undo a settled delivery");
});

test("multiple student tasks unlock in order instead of judging one gesture against every task", () => {
  const taskEvents = structuredClone(unitCircleEvents);
  const shared = {
    availability: { kind: "after_lesson" as const },
    allowed_operations: [{
      kind: "variable_change" as const,
      variable: "theta",
      controls: ["slider" as const],
    }],
    hints: ["继续观察图像。"],
  };
  taskEvents[0]!.lesson!.tasks = [
    {
      as: "reach-sine-maximum",
      prompt: "先让 sin θ = 1",
      ...shared,
      completion: {
        kind: "expression_target",
        expression: "sin(theta)",
        value: 1,
        tolerance: 0.01,
      },
    },
    {
      as: "reach-cosine-minimum",
      prompt: "再让 cos θ = -1",
      ...shared,
      completion: {
        kind: "expression_target",
        expression: "cos(theta)",
        value: -1,
        tolerance: 0.01,
      },
    },
  ];
  const store = new MemoryStore();
  const session = new BrowserLessonSession(taskEvents, store, "student-task-order");
  while (session.projection.status !== "completed") session.advance();

  assert.deepEqual(session.studentTasks.map((task) => task.available), [true, false]);
  assert.throws(
    () => session.requestStudentTaskHint("reach-cosine-minimum"),
    /not currently available/,
  );

  session.changeStudentVariable("theta", Math.PI / 2, { control: "slider", input: "mouse" });
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  assert.equal(session.studentTasks[1]!.attempts.length, 0, "the unlocking gesture is not reused as the next answer");
  assert.deepEqual(session.studentTasks.map((task) => task.available), [true, true]);

  session.changeStudentVariable("theta", Math.PI, { control: "slider", input: "mouse" });
  assert.equal(session.studentTasks[1]!.status, "succeeded");

  store.studentTaskProgress.get("student-task-order")!.tasks.reverse();
  const restored = new BrowserLessonSession(taskEvents, store, "student-task-order");
  assert.deepEqual(
    restored.studentTasks.map((task) => task.task_id),
    ["reach-sine-maximum", "reach-cosine-minimum"],
    "saved array order cannot change the lesson's task order",
  );
});

test("invalid saved student operations are discarded without touching playback", () => {
  const store = new MemoryStore();
  const first = new BrowserLessonSession(unitCircleEvents, store, "invalid-student-operations");
  advanceToVariableAnimation(first);
  first.changeStudentVariable("theta", Math.PI / 2, {
    control: "slider",
    input: "mouse",
  });
  const checkpoint = structuredClone(store.values.get("invalid-student-operations"));
  const saved = store.studentOperations.get("invalid-student-operations")!;
  if (saved.operations[0]?.kind === "variable_change") {
    saved.operations[0].after.value = Number.NaN;
  }

  const restored = new BrowserLessonSession(unitCircleEvents, store, "invalid-student-operations");
  assert.equal(restored.studentOperations.length, 0);
  assert.deepEqual(store.values.get("invalid-student-operations"), checkpoint);
  assert.equal(restored.projection.board?.variables?.theta?.value, Math.PI / 2);
});

test("reduced motion applies the animation end state without intermediate frames", () => {
  const session = new BrowserLessonSession(unitCircleEvents, new MemoryStore(), "unit-circle-reduced", { reducedMotion: true });
  let frame;
  do { frame = session.advance(); } while (frame?.operation.action?.op !== "lesson.variable.animate");
  assert.equal(session.activeVariableAnimation, undefined);
  assert.equal(session.projection.board?.variables?.theta?.value, 2 * Math.PI);
});


test("append rejection stops playback, preserves accepted events and survives refresh", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MemoryStore();
  const prefix = structuredClone(events.slice(0, 2));
  const session = new BrowserLessonSession(prefix, store, "failed-append", { incremental: true });
  session.play();
  const before = session.cursor;
  const invalid = structuredClone(events[2]!);
  invalid.sequence += 1;
  assert.throws(() => session.appendEvents([invalid]), /Expected sequence/);
  assert.equal(session.failure?.stage, "append");
  assert.equal(session.isPlaying, false);
  assert.equal(session.events.length, 2);
  tickElapsed(context, 5000);
  session.play();
  session.advanceBeat();
  assert.equal(session.cursor, before);
  const restored = new BrowserLessonSession(structuredClone(events.slice(0, 2)), store, "failed-append", { incremental: true });
  assert.equal(restored.failure?.stage, "append");
  restored.play();
  assert.equal(restored.cursor, before);
});

test("timer action failure is observable without consuming or skipping its operation", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const session = new BrowserLessonSession(events, new MemoryStore(), "failed-apply");
  session.advance();
  const before = session.cursor;
  const implementation = session as unknown as { player: { advance(): never } };
  implementation.player.advance = () => { throw new Error("injected apply failure"); };
  assert.doesNotThrow(() => session.play());
  assert.equal(session.failure?.stage, "playback");
  assert.equal(session.failure?.message, "injected apply failure");
  tickElapsed(context, 5000);
  session.advanceBeat();
  assert.equal(session.cursor, before);
});

test("animation failure retains last accepted value and progress and stays blocked after refresh", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MemoryStore();
  const session = new BrowserLessonSession(unitCircleEvents, store, "failed-animation");
  advanceToVariableAnimation(session);
  const before = session.projection;
  const animation = session.activeVariableAnimation;
  const implementation = session as unknown as { player: { setVariable(): never } };
  implementation.player.setVariable = () => { throw new Error("injected intermediate binding failure"); };
  session.play();
  assert.doesNotThrow(() => tickElapsed(context, 100));
  assert.equal(session.failure?.stage, "animation");
  assert.equal(session.isPlaying, false);
  assert.equal(session.activeVariableAnimation?.progress, animation?.progress);
  assert.deepEqual(session.projection.board, before.board);
  const restored = new BrowserLessonSession(unitCircleEvents, store, "failed-animation");
  restored.play();
  restored.advanceBeat();
  assert.equal(restored.failure?.stage, "animation");
  assert.equal(restored.cursor, before.cursor);
  restored.reset();
  assert.equal(restored.failure, undefined);
  assert.equal(restored.cursor, 0);
});

test("slider drag updates throttle checkpoint writes and the commit still saves the final value", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const store = new MemoryStore();
  let saves = 0;
  const save = store.save.bind(store);
  store.save = (key, checkpoint) => { saves += 1; save(key, checkpoint); };
  const session = new BrowserLessonSession(unitCircleEvents, store, "drag-persist");
  advanceToVariableAnimation(session);
  const gesture = session.beginStudentVariableOperation("theta", { control: "slider", input: "mouse" });
  const before = saves;
  for (let frame = 1; frame <= 20; frame += 1) {
    session.updateStudentVariableOperation(gesture, frame / 10);
    context.mock.timers.tick(16);
  }
  assert.ok(saves - before <= 2, `20 drag frames wrote ${saves - before} checkpoints`);
  context.mock.timers.tick(500);
  assert.equal(store.values.get("drag-persist")?.projection.board?.variables?.theta?.value, 2, "trailing save keeps the last dragged value");
  session.updateStudentVariableOperation(gesture, 2.5);
  session.commitStudentVariableOperation(gesture, 2.5);
  assert.equal(store.values.get("drag-persist")?.projection.board?.variables?.theta?.value, 2.5, "commit saves immediately");
});

test("a sustained slider drag keeps saving every interval instead of waiting for it to stop", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 2_000_000 });
  const store = new MemoryStore();
  const saved: number[] = [];
  const save = store.save.bind(store);
  store.save = (key, checkpoint) => { saved.push(checkpoint.projection.board?.variables?.theta?.value as number); save(key, checkpoint); };
  const session = new BrowserLessonSession(unitCircleEvents, store, "sustained-drag");
  advanceToVariableAnimation(session);
  const gesture = session.beginStudentVariableOperation("theta", { control: "slider", input: "mouse" });
  const before = saved.length;
  for (let frame = 1; frame <= 190; frame += 1) {
    session.updateStudentVariableOperation(gesture, frame / 100);
    context.mock.timers.tick(16);
  }
  // ~3s of continuous input with no pause: saves must happen during it.
  const during = saved.slice(before);
  assert.ok(during.length >= 6 && during.length <= 9, `saved ${during.length} times during a 3s drag`);
  assert.ok(during.at(-1)! > 1.5, "a mid-drag save carries a recent value, not the first one");
});

test("invalid student input never commits a successful gesture or task attempt", () => {
  const session = new BrowserLessonSession(unitCircleEvents, new MemoryStore(), "failed-input");
  advanceToVariableAnimation(session);
  const gesture = session.beginStudentVariableOperation("theta", { control: "slider", input: "mouse" });
  session.updateStudentVariableOperation(gesture, 1);
  const before = session.projection.board;
  session.commitStudentVariableOperation(gesture, NaN);
  assert.equal(session.failure?.stage, "input");
  assert.deepEqual(session.projection.board, before);
  assert.deepEqual(session.studentOperations, []);
  assert.equal(session.commitStudentVariableOperation(gesture, 2), undefined);
  assert.deepEqual(session.studentOperations, []);
});


function phaseLesson(kind: "continue" | "replay" = "replay") {
  const source: AuthoringLesson = {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", title: "Phase semantics", language: "zh-CN", goals: ["理解起点"],
      variables: [{ as: "h", initial: 1, min: 0, max: 8, control: { kind: "slider", step: 1 } }],
      tasks: [{ as: "reach-four", prompt: "调到四", availability: { kind: "after_lesson" },
        start: { kind: "practice", variables: ["h"] },
        allowed_operations: [{ kind: "variable_change", variable: "h", controls: ["slider"] }],
        completion: { kind: "expression_target", expression: "h", value: 4, tolerance: .01 }, hints: ["移动滑块"] }],
    },
    steps: [{ key: "demo", purpose: "演示", beats: [
      { key: "first", actions: [{ do: "write", as: "prompt", kind: "text", role: "problem", content: { text: "观察高度" }, place: { relation: "new_region" } }, { do: "animate", variable: "h", value: 4, easing: "linear", duration_intent: "brief" }] },
      { key: "second", say: "从一开始", start: kind === "replay" ? { kind, variables: ["h"] } : { kind },
        actions: [{ do: "animate", variable: "h", value: 4, easing: "linear", duration_intent: "brief" }] },
    ] }], close: { summary: "练习", focus: ["prompt"] },
  };
  return normalizeAuthoringLesson(source, { lessonId: "phase-fixture", boardId: "phase-board", baseRevision: 0 });
}

function advanceToPhase(session: BrowserLessonSession) {
  while (!session.activePhaseTransition) assert.ok(session.advance());
}

test("independent replay uses actual state, blocks narration/input, and resumes one transition after refresh", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MemoryStore();
  const lesson = phaseLesson();
  const session = new BrowserLessonSession(lesson, store, "phase", { narrationTiming: "external" });
  const second = session.outline[0]!.beats[1]!;
  session.seekToBeat(second.id, "start");
  session.setVariable("h", 7);
  advanceToPhase(session);
  assert.equal(session.activePhaseTransition?.from.h, 7);
  assert.equal(session.activePhaseTransition?.to.h, 1);
  assert.equal(session.projection.current_narration, undefined);
  session.setVariable("h", 5);
  assert.equal(session.projection.board?.variables?.h?.value, 7);
  session.play();
  tickElapsed(context, variableAnimationDuration("brief") / 2);
  session.pause();
  const halfway = session.projection.board?.variables?.h?.value;
  assert.ok(halfway! > 1 && halfway! < 7);
  const restored = new BrowserLessonSession(lesson, store, "phase", { narrationTiming: "external" });
  assert.equal(restored.projection.board?.variables?.h?.value, halfway);
  assert.equal(restored.activePhaseTransition?.progress, session.activePhaseTransition?.progress);
  restored.play();
  tickElapsed(context, variableAnimationDuration("brief") / 2 + 40);
  assert.equal(restored.projection.board?.variables?.h?.value, 1);
  assert.equal(Boolean(restored.activePhaseTransition), false);
  const oldEpoch = restored.playbackEpoch;
  restored.seekToBeat(second.id, "start");
  restored.setVariable("h", 6);
  advanceToPhase(restored);
  assert.ok(restored.playbackEpoch > oldEpoch);
  assert.equal(restored.activePhaseTransition?.from.h, 6);
  restored.completeNarration(second.id, oldEpoch);
  assert.ok(restored.activePhaseTransition);
  restored.pause();
});

test("continuation never receives an implicit reset action", () => {
  const session = new BrowserLessonSession(phaseLesson("continue"), new MemoryStore(), "continuation");
  assert.equal(session.operations.some(operation => operation.action?.op === "lesson.phase.start"), false);
  session.advanceBeat();
  assert.equal(session.projection.board?.variables?.h?.value, 4);
  while (session.currentOperation?.type !== "narration.begin") assert.ok(session.advance());
  assert.equal(session.projection.board?.variables?.h?.value, 4);
});

test("practice first activation prepares its start without grading, then accepts a real student operation", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MemoryStore();
  const lesson = phaseLesson();
  const session = new BrowserLessonSession(lesson, store, "practice");
  while (session.status !== "completed") assert.ok(session.advance());
  assert.equal(session.activePhaseTransition?.kind, "practice");
  assert.equal(session.studentTasks[0]?.available, false);
  assert.equal(session.beginStudentVariableOperation("h", { control: "slider", input: "mouse" }), "");
  tickElapsed(context, variableAnimationDuration("brief") / 2);
  session.pause();
  const restored = new BrowserLessonSession(lesson, store, "practice");
  const unsubscribe = restored.subscribe(() => {});
  tickElapsed(context, variableAnimationDuration("brief"));
  assert.equal(restored.projection.board?.variables?.h?.value, 1);
  assert.equal(restored.studentTasks[0]?.available, true);
  assert.deepEqual(restored.studentOperations, []);
  restored.changeStudentVariable("h", 4, { control: "slider", input: "mouse" });
  assert.equal(restored.studentTasks[0]?.status, "succeeded");
  const done = new BrowserLessonSession(lesson, store, "practice");
  done.subscribe(() => {})();
  assert.equal(done.projection.board?.variables?.h?.value, 4);
  assert.equal(done.activePhaseTransition, undefined);
  unsubscribe();
});

test("manual advance at lesson completion finishes a practice start transition and notifies subscribers", () => {
  const store = new MemoryStore();
  const lesson = phaseLesson();
  const session = new BrowserLessonSession(lesson, store, "practice-manual-advance");
  while (session.status !== "completed") assert.ok(session.advance());
  assert.equal(session.activePhaseTransition?.kind, "practice");
  assert.equal(session.studentTasks[0]?.available, false);

  let notified = 0;
  const unsubscribe = session.subscribe(() => {
    notified += 1;
  });
  assert.equal(session.advance(), undefined);
  assert.equal(session.activePhaseTransition, undefined);
  assert.equal(session.projection.board?.variables?.h?.value, 1);
  assert.equal(session.studentTasks[0]?.available, true);
  assert.equal(notified, 1);

  const restored = new BrowserLessonSession(lesson, store, "practice-manual-advance");
  assert.equal(restored.activePhaseTransition, undefined);
  assert.equal(restored.projection.board?.variables?.h?.value, 1);
  assert.equal(restored.studentTasks[0]?.available, true);
  unsubscribe();
});


test("the Beat composition includes cards it wrote and exposes the Step's earlier cards as context", () => {
  const session = new BrowserLessonSession(events, new MemoryStore(), "composition");
  const created = (from: number, to: number) => session.operations.slice(from, to + 1)
    .flatMap((operation) => operation.action?.op === "board.create" && operation.action.node?.id ? [operation.action.node.id as string] : []);
  const step = session.outline.find((candidate) => candidate.beats.length > 1
    && created(candidate.beats[0]!.start_cursor, candidate.beats[0]!.end_cursor).length > 0);
  assert.ok(step, "fixture has a Step whose first Beat writes a card");
  const [first, second] = step.beats as [typeof step.beats[0], typeof step.beats[0]];
  session.seekToBeat(first.id, "end");
  for (const id of created(first.start_cursor, first.end_cursor)) {
    assert.ok(session.compositionTargets.includes(id), `${id} written in the Beat joins its composition`);
  }
  session.seekToBeat(second.id, "start");
  session.advance();
  assert.deepEqual(session.stepContextTargets, created(step.start_cursor, second.start_cursor - 1),
    "cards written earlier in the same Step are camera context for the next Beat");
});

test("a wrapping angle animates the shorter way round, across the end of its range", async () => {
  const { animatedVariableValue } = await import("../src/runtime.js");
  const turn = Math.PI * 2;
  const angle = { min: 0, max: turn, wrap: true as const };
  // From just below a full turn to just past 0: forwards through 2π, not back round.
  assert.ok(Math.abs(animatedVariableValue(6.2, 0.4, .5, angle) - ((6.2 + (0.4 + turn - 6.2) / 2) % turn)) < 1e-9);
  const midway = animatedVariableValue(6.2, 0.4, .1, angle);
  assert.ok(midway > 6.2 && midway <= turn, "starts by increasing");
  assert.ok(animatedVariableValue(6.2, 0.4, .9, angle) < 0.4, "ends just below the target after wrapping");
  // Without wrap the value goes straight there.
  assert.ok(Math.abs(animatedVariableValue(6.2, 0.4, .5, { min: 0, max: turn }) - 3.3) < 1e-9);
  assert.equal(animatedVariableValue(1, 2, .5, angle), 1.5);
});

test("a learner drags a number-line point through the session, and the task judges it (decision 0013)", () => {
  const document = {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: "zh-CN", title: "3/4 在哪里", goals: ["在数轴上找到 3/4"],
      variables: [{ as: "p", initial: 0, min: 0, max: 2, label: "点的位置" }],
      tasks: [{
        as: "place", prompt: "把点拖到 3/4。", availability: { kind: "after_lesson" },
        allowed_operations: [{ kind: "variable_change", variable: "p", controls: ["number_line_point"] }],
        completion: { kind: "expression_target", expression: "p", value: 0.75, tolerance: 0.01 },
        hints: ["每个大格分成四份。"],
      }],
    },
    steps: [{ key: "s", purpose: "放点", beats: [{ key: "b", say: "这是从 0 到 2 的数轴，每格是四分之一。", actions: [{
      do: "write", as: "line", kind: "number_line", role: "main_visual", place: { relation: "new_region" },
      content: {
        range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4 },
        points: [{ as: "dot", value: 0, label: "你的点", interaction: { kind: "drag", variable: "p" } }],
        bindings: [{ target: "dot.value", expression: "p" }],
      },
    }] }] }],
    close: { summary: "3/4 在 0 和 1 之间的第三格。", focus: ["line"] },
  } as unknown as AuthoringLesson;
  const lessonEvents = normalizeAuthoringLesson(document, { lessonId: "number-line", boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
  const session = new BrowserLessonSession(lessonEvents, new MemoryStore(), "number-line");
  while (session.projection.status !== "completed") session.advance();
  const operation = session.beginStudentVariableOperation("p", { control: "number_line_point", input: "mouse" });
  session.updateStudentVariableOperation(operation, 0.5);
  session.commitStudentVariableOperation(operation, 0.75);
  const logged = session.studentOperations.at(-1);
  assert.equal(logged?.kind === "variable_change" ? logged.control : undefined, "number_line_point");
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  const dot = (session.projection.board!.nodes["number-line:node:line"]!.content.points as Array<{ value: number }>)[0]!;
  assert.equal(dot.value, 0.75, "the point follows the dragged variable");
  assert.throws(() => session.beginStudentVariableOperation("p", { control: "lasso" as never, input: "mouse" }), /Unsupported student variable control 'lasso'/);
});

// Trading tens and ones (decision 0023): a card the learner taps, then says "done".
function tradingLesson(typedFirst = false): ReturnType<typeof normalizeAuthoringLesson> {
  const variable = (as: string, initial: number, max: number) => ({ as, initial, min: 0, max, label: as });
  const lesson = {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: "en-US", title: "Trading tens and ones", goals: ["Ten ones make a ten"],
      variables: [variable("ones", 14, 59), variable("tray_ones", 0, 10), variable("tens", 3, 9)],
      tasks: [...(typedFirst ? [{
        as: "first", anchor: "mat", prompt: "Three tens and fourteen ones: what number is that?",
        availability: { kind: "after_lesson" }, allowed_operations: [{ kind: "answer_entry" }],
        completion: { kind: "numeric_answer", answer: "44" }, hints: ["Trade ten ones for a ten first."],
      }] : []), {
        as: "trade",
        start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 17, tray_ones: 0, tens: 2 } },
        prompt: "Make tens until you can't. Then tap I'm done.",
        availability: { kind: "after_lesson" },
        allowed_operations: [{ kind: "card_tap", node: "mat" }, { kind: "card_submit" }],
        completion: { kind: "card_fact", node: "mat", fact: "no_trade_left" },
        hints: ["Put ones in the tray; when ten fill it, make a ten."],
      }, {
        as: "number", anchor: "mat", prompt: "How many marbles does Leo have?",
        availability: { kind: "after_lesson" }, allowed_operations: [{ kind: "answer_entry" }],
        completion: { kind: "numeric_answer", answer: "37" }, hints: ["Count the tens, then the ones."],
      }],
    },
    steps: [{ key: "show", purpose: "See the pile", beats: [
      { key: "draw", say: "Here are 3 tens and 14 ones.", actions: [{ do: "write", as: "mat", kind: "base_ten_trade", role: "main_visual", place: { relation: "new_region" },
        content: { columns: 2, places: [{ as: "ones", count: 14, tray: 0 }, { as: "tens", count: 3 }],
          bindings: [{ target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" }] } }] },
    ] }],
    close: { summary: "Ten ones make a ten.", focus: ["mat"] },
  } as unknown as AuthoringLesson;
  return normalizeAuthoringLesson(lesson, { lessonId: "trade", boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
}

test("a card task with a practice pile right after a typed answer opens at once (BT-31, base-ten check 4)", () => {
  // Only the card's "done" laid the next task's practice pile; after a typed answer the mat stayed inert, the
  // task stayed shut and the learner was stuck until a reload.
  const session = new BrowserLessonSession(tradingLesson(true), new MemoryStore(), "trade", { reducedMotion: true });
  const card = "trade:node:mat";
  while (session.projection.status !== "completed") session.advance();
  assert.equal(session.studentTasks.find((task) => task.task_id === "first")!.available, true);
  const answered = session.submitStudentAnswer("first", "44");
  assert.ok(!("unreadable" in answered) && answered.status === "succeeded");
  const trade = session.studentTasks.find((task) => task.task_id === "trade")!;
  assert.equal(trade.available, true, "the card task opens");
  assert.equal(session.studentCardLive(card), true);
  const values = Object.fromEntries(Object.entries(session.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value]));
  assert.deepEqual(values, { ones: 17, tray_ones: 0, tens: 2 }, "its practice pile is laid");
  assert.ok("operation" in session.tapStudentCard(card, { kind: "gather", place: 0 }));
});

test("a card task: taps change the bound counts together, only exactly ten trade, and done is judged by the card", () => {
  const events = tradingLesson();
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "trade", { reducedMotion: true });
  const card = "trade:node:mat";
  const values = () => Object.fromEntries(Object.entries(session.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value]));
  // Inert while the lesson plays: a tap is refused and changes nothing.
  assert.equal(session.studentCardLive(card), false);
  assert.deepEqual(session.tapStudentCard(card, { kind: "gather", place: 0 }), { refused: "inert", message: "" });
  assert.throws(() => session.submitStudentCard("trade"), /not available before the lesson completes/);
  while (session.projection.status !== "completed") session.advance();
  // The practice pile replaces the lesson's (3 tens, 14 ones): 2 tens and 17 ones.
  assert.deepEqual(values(), { ones: 17, tray_ones: 0, tens: 2 });
  assert.equal(session.studentCardLive(card), true);
  // Saying done with a trade left is a failed attempt, not a refusal.
  assert.equal(session.submitStudentCard("trade").status, "in_progress");
  // The tray takes ten and no more; nine do not make a ten.
  for (let i = 0; i < 9; i += 1) assert.ok("operation" in session.tapStudentCard(card, { kind: "gather", place: 0 }, "mouse"));
  assert.deepEqual(session.tapStudentCard(card, { kind: "make", place: 0 }), { refused: "tray_not_ten", message: "This tray does not hold a ten: a ten is ten ones." });
  assert.ok("operation" in session.tapStudentCard(card, { kind: "gather", place: 0 }));
  assert.deepEqual(session.tapStudentCard(card, { kind: "gather", place: 0 }), { refused: "tray_full", message: "The tray holds only ten." });
  const made = session.tapStudentCard(card, { kind: "make", place: 0 }, "touch");
  assert.ok("operation" in made);
  assert.deepEqual(made.operation.changes, [
    { alias: "ones", before: 17, after: 7 }, { alias: "tray_ones", before: 10, after: 0 }, { alias: "tens", before: 2, after: 3 },
  ]);
  assert.deepEqual(values(), { ones: 7, tray_ones: 0, tens: 3 });
  // Taps are not attempts; done is judged by the card.
  assert.equal(session.studentTasks[0]!.attempts.length, 1);
  const done = session.submitStudentCard("trade", "touch");
  assert.equal(done.status, "succeeded");
  assert.deepEqual(done.attempts.map((attempt) => [attempt.actual, attempt.succeeded]), [[0, false], [1, true]]);
  // The mat is inert during the typed question, so the picture cannot change under the answer.
  assert.equal(session.studentCardLive(card), false);
  assert.deepEqual(session.tapStudentCard(card, { kind: "break", place: 1 }), { refused: "inert", message: "" });
  assert.equal(session.studentTasks[1]!.available, true);
  assert.equal((session.submitStudentAnswer("number", "37") as StudentTaskSnapshot).status, "succeeded");
  // Restored from the store: the same operations, progress and pile.
  const restored = new BrowserLessonSession(events, store, "trade", { reducedMotion: true });
  assert.deepEqual(restored.studentOperations, session.studentOperations);
  assert.deepEqual(restored.studentTasks, session.studentTasks);
  assert.deepEqual(Object.fromEntries(Object.entries(restored.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value])), values());
  assert.deepEqual(session.studentOperations.filter((operation) => operation.kind === "card_tap").length, 11);
  // A tampered card attempt is discarded on restore.
  store.studentTaskProgress.get("trade")!.tasks[0]!.attempts[0]!.succeeded = true;
  assert.equal(new BrowserLessonSession(events, store, "trade", { reducedMotion: true }).studentTasks[0]!.attempts.length, 0);
});

test("a count task (decision 0023 amendment 5): taps only, judged on done by the place's count; a replay lays the counted pile", () => {
  const events = tradingLesson();
  const task = events[0]!.lesson!.tasks![0]! as unknown as { prompt: string; completion: Record<string, unknown> };
  task.prompt = "Make the ones 7. Then tap I'm done.";
  task.completion = { ...task.completion, fact: "count", at: "ones", value: 7 };
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "count", { reducedMotion: true });
  const card = "trade:node:mat";
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(sessionValues(session), { ones: 17, tray_ones: 0, tens: 2 });
  assert.equal(session.studentCardLive(card), true);
  // No slider: the mat's counts have no control of their own.
  assert.deepEqual(variableControlModels(session.projection.board), []);
  // Done before the count is made: a failed attempt recording the count against the target.
  assert.equal(session.submitStudentCard("trade").status, "in_progress");
  // Nine in the tray and done: the count is still 17 (the tray counts), not 8.
  for (let i = 0; i < 9; i += 1) session.tapStudentCard(card, { kind: "gather", place: 0 });
  assert.equal(session.submitStudentCard("trade").status, "needs_hint");
  session.tapStudentCard(card, { kind: "gather", place: 0 });
  session.tapStudentCard(card, { kind: "make", place: 0 });
  assert.deepEqual(sessionValues(session), { ones: 7, tray_ones: 0, tens: 3 });
  const done = session.submitStudentCard("trade");
  assert.equal(done.status, "succeeded");
  assert.deepEqual(done.attempts.map((attempt) => [attempt.actual, attempt.target, attempt.succeeded]), [[17, 7, false], [17, 7, false], [7, 7, true]]);
  // Restored attempts are checked against the count; a tampered one is discarded.
  assert.deepEqual(new BrowserLessonSession(events, store, "count", { reducedMotion: true }).studentTasks, session.studentTasks);
  store.studentTaskProgress.get("count")!.tasks[0]!.attempts[0]!.succeeded = true;
  assert.equal(new BrowserLessonSession(events, store, "count", { reducedMotion: true }).studentTasks[0]!.attempts.length, 0);
  // Replayed: the typed question opens over the counted pile (7 ones, 3 tens), not the lesson's.
  const replayed = new BrowserLessonSession(events, new MemoryStore(), "count-replay", { reducedMotion: true });
  while (replayed.projection.status !== "completed") replayed.advance();
  for (let i = 0; i < 10; i += 1) replayed.tapStudentCard(card, { kind: "gather", place: 0 });
  replayed.tapStudentCard(card, { kind: "make", place: 0 });
  for (let i = 0; i < 4; i += 1) replayed.tapStudentCard(card, { kind: "gather", place: 0 });
  assert.equal(replayed.submitStudentCard("trade").status, "succeeded");
  replayed.seek(0);
  while (replayed.projection.status !== "completed") replayed.advance();
  assert.deepEqual(sessionValues(replayed), { ones: 7, tray_ones: 0, tens: 3 });
  assert.equal(replayed.studentTasks[1]!.available, true);
});

test("a count task on three columns keeps the learner's own pile after done, on restore and after a replay", () => {
  // 126 as 1 hundred, 9 tens, 26 ones; "make the ones 16". The learner breaks the hundred and trades ten
  // ones: 0 hundreds, 20 tens, 16 ones. Another pile has 16 ones too (1 hundred, 10 tens); the mat must not
  // swap the learner's pile for it (owner, 2026-11-24: a hundred the child broke came back).
  const pile = { ones: 26, tray_ones: 0, tens: 9, tray_tens: 0, hundreds: 1 };
  const tasks = [{
    as: "count", prompt: "Make the ones 16. Then tap I'm done.", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "card_tap", node: "mat" }, { kind: "card_submit" }],
    completion: { kind: "card_fact", node: "mat", fact: "count", at: "ones", value: 16 }, hints: ["Ten ones make a ten."],
    start: { kind: "practice", variables: Object.keys(pile), values: pile },
  }, {
    as: "number", anchor: "mat", prompt: "What number is it?", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "answer_entry" }], completion: { kind: "numeric_answer", answer: "126" }, hints: ["It never changed."],
  }];
  const store = new MemoryStore();
  const session = new BrowserLessonSession(sliderLesson(tasks, { columns: 3, noSliders: true }), store, "own-pile", { reducedMotion: true });
  const card = "slide:node:mat";
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(sessionValues(session), pile);
  assert.ok("operation" in session.tapStudentCard(card, { kind: "break", place: 2 }));
  for (let i = 0; i < 10; i += 1) assert.ok("operation" in session.tapStudentCard(card, { kind: "ungather", place: 1 }));
  for (let i = 0; i < 10; i += 1) assert.ok("operation" in session.tapStudentCard(card, { kind: "gather", place: 0 }));
  assert.ok("operation" in session.tapStudentCard(card, { kind: "make", place: 0 }));
  const own = { ones: 16, tray_ones: 0, tens: 20, tray_tens: 0, hundreds: 0 };
  assert.deepEqual(sessionValues(session), own);
  assert.equal(session.submitStudentCard("count").status, "succeeded");
  // The done operation records the learner's pile.
  const submitted = session.studentOperations.at(-1) as { kind: string; pile?: Record<string, number> };
  assert.deepEqual([submitted.kind, submitted.pile], ["card_submit", own]);
  assert.deepEqual(sessionValues(session), own, "after done");
  assert.equal(session.studentTasks[1]!.available, true);
  const restored = new BrowserLessonSession(sliderLesson(tasks, { columns: 3, noSliders: true }), store, "own-pile", { reducedMotion: true });
  assert.deepEqual(sessionValues(restored), own, "restored");
  session.seek(0);
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(sessionValues(session), own, "after a replay");
  // Units left in a tray go back loose: the count is the same, the tray is tidy.
  const tidy = new BrowserLessonSession(sliderLesson(tasks, { columns: 3, noSliders: true }), new MemoryStore(), "tidy", { reducedMotion: true });
  while (tidy.projection.status !== "completed") tidy.advance();
  for (let i = 0; i < 10; i += 1) tidy.tapStudentCard(card, { kind: "gather", place: 0 });
  tidy.tapStudentCard(card, { kind: "make", place: 0 });
  for (let i = 0; i < 3; i += 1) tidy.tapStudentCard(card, { kind: "gather", place: 0 });
  assert.equal(tidy.submitStudentCard("count").status, "succeeded");
  assert.deepEqual(sessionValues(tidy), { ones: 16, tray_ones: 0, tens: 10, tray_tens: 0, hundreds: 1 });
});

test("replaying the lesson lays a card task's practice pile again (review of #87)", () => {
  const session = new BrowserLessonSession(tradingLesson(), new MemoryStore(), "trade-replay", { reducedMotion: true });
  const card = "trade:node:mat";
  while (session.projection.status !== "completed") session.advance();
  const values = () => Object.fromEntries(Object.entries(session.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value]));
  assert.ok("operation" in session.tapStudentCard(card, { kind: "gather", place: 0 }));
  session.seek(0);
  assert.equal(session.studentCardLive(card), false);
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(values(), { ones: 17, tray_ones: 0, tens: 2 }, "the practice pile, not the lesson's 3 tens and 14 ones");
  assert.equal(session.studentCardLive(card), true);
  // Done, then replayed: the typed question opens over the learner's traded pile (3 tens, 7 ones), not the lesson's.
  for (let i = 0; i < 10; i += 1) session.tapStudentCard(card, { kind: "gather", place: 0 });
  session.tapStudentCard(card, { kind: "make", place: 0 });
  assert.equal(session.submitStudentCard("trade").status, "succeeded");
  session.seek(0);
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(values(), { ones: 7, tray_ones: 0, tens: 3 });
  assert.equal(session.studentTasks[1]!.available, true);
  assert.equal(session.studentCardLive(card), false);
});

test("done with fewer than ten left in the tray succeeds, and the mat is then laid tidy (first-use test)", () => {
  const session = new BrowserLessonSession(tradingLesson(), new MemoryStore(), "trade-leftover", { reducedMotion: true });
  const card = "trade:node:mat";
  while (session.projection.status !== "completed") session.advance();
  const values = () => Object.fromEntries(Object.entries(session.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value]));
  for (let i = 0; i < 10; i += 1) session.tapStudentCard(card, { kind: "gather", place: 0 });
  session.tapStudentCard(card, { kind: "make", place: 0 });
  for (let i = 0; i < 7; i += 1) session.tapStudentCard(card, { kind: "gather", place: 0 });
  assert.deepEqual(session.tapStudentCard(card, { kind: "make", place: 0 }), { refused: "tray_not_ten", message: "This tray does not hold a ten: a ten is ten ones." });
  assert.deepEqual(values(), { ones: 7, tray_ones: 7, tens: 3 });
  assert.equal(session.submitStudentCard("trade").status, "succeeded");
  // The questions then sit over the traded pile with the tray emptied: the same counts.
  assert.deepEqual(values(), { ones: 7, tray_ones: 0, tens: 3 });
});

test("a card task's retry returns the practice pile, and a break goes into the empty tray", () => {
  const session = new BrowserLessonSession(tradingLesson(), new MemoryStore(), "trade-retry", { reducedMotion: true });
  const card = "trade:node:mat";
  while (session.projection.status !== "completed") session.advance();
  const values = () => Object.fromEntries(Object.entries(session.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value]));
  assert.ok("operation" in session.tapStudentCard(card, { kind: "break", place: 1 }));
  assert.deepEqual(values(), { ones: 27, tray_ones: 10, tens: 1 });
  assert.deepEqual(session.tapStudentCard(card, { kind: "break", place: 1 }), { refused: "tray_not_empty", message: "Empty the tray first." });
  session.submitStudentCard("trade");
  assert.equal(session.retryStudentTask("trade").status, "not_started");
  assert.deepEqual(values(), { ones: 17, tray_ones: 0, tens: 2 });
});

test("a row of blanks (decision 0023 amendment 1): judged whole, never says which blank, unreadable is not an attempt, restores", () => {
  const events = tradingLesson();
  const tasks = events[0]!.lesson!.tasks!;
  tasks.splice(1, 1, {
    as: "counts", anchor: "trade:node:mat", prompt: "How many of each are on the mat?",
    availability: { kind: "after_lesson" }, allowed_operations: [{ kind: "row_entry" }],
    completion: { kind: "numeric_row", parts: [{ blank: { as: "tens", answer: "3", label: "tens" } }, { text: "tens" }, { blank: { as: "ones", answer: "7", label: "ones" } }, { text: "ones" }] },
    hints: ["Count the tens, then the ones."],
  }, {
    as: "parts", anchor: "trade:node:mat", prompt: "Write the number by places.",
    availability: { kind: "after_lesson" }, allowed_operations: [{ kind: "row_entry" }],
    completion: { kind: "numeric_row", parts: [{ text: "37 =" }, { blank: { as: "tens_part", answer: "30", label: "the tens" } }, { text: "+" }, { blank: { as: "ones_part", answer: "7", label: "the ones" } }] },
    hints: ["What are 3 tens worth?"],
    success_message: "37 = 30 + 7",
  } as never);
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "rows", { reducedMotion: true });
  const card = "trade:node:mat";
  while (session.projection.status !== "completed") session.advance();
  for (let i = 0; i < 10; i += 1) session.tapStudentCard(card, { kind: "gather", place: 0 });
  session.tapStudentCard(card, { kind: "make", place: 0 });
  assert.equal(session.submitStudentCard("trade").status, "succeeded");
  // A blank left empty or unreadable: the row is not an attempt, and those blanks are named for the host.
  assert.deepEqual(session.submitStudentRow("counts", { tens: "3", ones: "" }), { unreadable: ["ones"] });
  assert.equal(session.studentTasks[1]!.attempts.length, 0);
  // One blank wrong: a failed attempt for the whole row.
  const wrong = session.submitStudentRow("counts", { tens: "3", ones: "17" });
  assert.ok(!("unreadable" in wrong));
  assert.deepEqual([wrong.status, wrong.attempts[0]!.succeeded], ["in_progress", false]);
  // Right, with full-width digits and a leading zero read by the same number reader.
  const right = session.submitStudentRow("counts", { tens: "０3", ones: "７" });
  assert.ok(!("unreadable" in right));
  assert.equal(right.status, "succeeded");
  assert.equal(session.studentTasks[2]!.available, true);
  // Extra keys from a host are not kept, so the saved row still parses on restore (review of #91).
  assert.equal((session.submitStudentRow("parts", { tens_part: "30", ones_part: "7", a: "1", b: "2", c: "3", d: "4", e: "5" }) as StudentTaskSnapshot).status, "succeeded");
  assert.deepEqual(Object.keys((session.studentOperations.at(-1) as { answers: Record<string, string> }).answers), ["tens_part", "ones_part"]);
  assert.equal(session.studentOperations.at(-1)!.kind, "row_submit");
  // Restore repeats each check; a tampered row attempt is discarded.
  const restored = new BrowserLessonSession(events, store, "rows", { reducedMotion: true });
  assert.deepEqual(restored.studentTasks, session.studentTasks);
  store.studentTaskProgress.get("rows")!.tasks[1]!.attempts[0]!.succeeded = true;
  assert.equal(new BrowserLessonSession(events, store, "rows", { reducedMotion: true }).studentTasks[1]!.attempts.length, 0);
  // A replay after the card task is done shows the traded pile under the row questions.
  session.seek(0);
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(Object.fromEntries(Object.entries(session.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value])), { ones: 7, tray_ones: 0, tens: 3 });
  assert.throws(() => session.submitStudentAnswer("counts", "3"), /does not take a typed answer/);
});

// Decision 0023 amendment 4: a slider on a place's count, each stop one trade by the card's tap rules.
function sliderLesson(tasks: unknown[], options: { columns?: 2 | 3; noSliders?: boolean } = {}): ReturnType<typeof normalizeAuthoringLesson> {
  const variable = (as: string, initial: number, max: number, control?: unknown) => ({ as, initial, min: 0, max, label: as, ...(control && !options.noSliders ? { control } : {}) });
  const slider = { kind: "slider", step: 10 };
  const three = options.columns === 3;
  const lesson = {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: "en-US", title: "Trading tens and ones", goals: ["Ten ones make a ten"],
      variables: three
        ? [variable("ones", 26, 59, slider), variable("tray_ones", 0, 10), variable("tens", 9, 34, slider), variable("tray_tens", 0, 10), variable("hundreds", 1, 9)]
        : [variable("ones", 14, 59, slider), variable("tray_ones", 0, 10), variable("tens", 3, 9)],
      tasks,
    },
    steps: [{ key: "show", purpose: "See the pile", beats: [
      { key: "draw", say: "Here is the pile.", actions: [{ do: "write", as: "mat", kind: "base_ten_trade", role: "main_visual", place: { relation: "new_region" },
        content: three
          ? { columns: 3, places: [{ as: "ones", count: 26, tray: 0 }, { as: "tens", count: 9, tray: 0 }, { as: "hundreds", count: 1 }],
            bindings: [{ target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" },
              { target: "tens.tray", expression: "tray_tens" }, { target: "hundreds.count", expression: "hundreds" }] }
          : { columns: 2, places: [{ as: "ones", count: 14, tray: 0 }, { as: "tens", count: 3 }],
            bindings: [{ target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" }] } }] },
      // The lesson's own demonstration taps still play by the card's rules.
      { key: "fill", say: "Ten ones go in the tray.", actions: Array.from({ length: 10 }, () => ({ do: "tap", target: "mat", tap: "gather", at: "ones" })) },
      { key: "make", say: "Ten ones make a ten.", actions: [{ do: "tap", target: "mat", tap: "make", at: "ones" }] },
    ] }],
    close: { summary: "Ten ones make a ten.", focus: ["mat"] },
  } as unknown as AuthoringLesson;
  return normalizeAuthoringLesson(lesson, { lessonId: "slide", boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
}
const slideTask = (value: number, start?: Record<string, number>) => ({
  as: "slide", prompt: "Slide the ones to the number.", availability: { kind: "after_lesson" },
  allowed_operations: [{ kind: "variable_change", variable: "ones", controls: ["slider"] }],
  completion: { kind: "expression_target", expression: "ones", value, tolerance: 0.5 }, hints: ["Each stop is a trade."],
  ...(start ? { start: { kind: "practice", variables: Object.keys(start), values: start } } : {}),
});
const sessionValues = (session: BrowserLessonSession) => Object.fromEntries(Object.entries(session.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value]));

/** Replays a student log's card taps through the card's tap rules from a pile; each must be taken and change what it says. */
function replayCardTaps(start: Record<string, number>, operations: readonly StudentOperation[]): Record<string, number> {
  const values = { ...start };
  for (const operation of operations) {
    if (operation.kind === "variable_change") {
      // A slider's gesture follows its trades: its value is already the pile's.
      if (operation.control === "slider") assert.equal(values[operation.target.alias], operation.after.value);
      else values[operation.target.alias] = operation.after.value;
      continue;
    }
    if (operation.kind !== "card_tap") continue;
    const before = baseTenMat({ columns: values.hundreds === undefined ? 2 : 3, places: [
      { count: values.ones, tray: values.tray_ones }, { count: values.tens, tray: values.tray_tens }, { count: values.hundreds },
    ] });
    const result = applyBaseTenTap(before, operation.tap as BaseTenTap);
    assert.ok(result.ok, `the logged tap ${JSON.stringify(operation.tap)} is taken`);
    for (const change of operation.changes) {
      assert.equal(values[change.alias], change.before);
      values[change.alias] = change.after;
    }
    assert.deepEqual([values.ones, values.tray_ones, values.tens], [result.mat.counts[0], result.mat.trays[0], result.mat.counts[1]]);
  }
  return values;
}

test("a slider on a card's count trades by the tap rules, is live only while its task is open, and its log replays the pile", () => {
  const events = sliderLesson([slideTask(6, { ones: 26, tray_ones: 0, tens: 3 })]);
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "slide", { reducedMotion: true });
  const card = "slide:node:mat";
  // Not live while the lesson plays, even before its card is drawn: the slider is drawn disabled and a gesture
  // is refused, changing nothing.
  const models = () => variableControlModels(session.projection.board, { live: (alias) => session.studentVariableLive(alias) });
  session.advance();
  assert.ok(session.projection.board?.variables?.ones && !session.projection.board.nodes[card]);
  assert.equal(session.studentVariableLive("ones"), false);
  assert.equal(models()[0]!.disabled, true);
  assert.equal(session.changeStudentVariable("ones", 4, { control: "slider", input: "mouse" }), undefined);
  session.setVariable("ones", 4);
  assert.equal(sessionValues(session).ones, 14);
  while (!session.projection.board?.nodes[card]) session.advance();
  assert.equal(session.studentVariableLive("ones"), false);
  assert.equal(session.beginStudentVariableOperation("ones", { control: "slider", input: "mouse" }), "");
  assert.equal(session.changeStudentVariable("ones", 4, { control: "slider", input: "mouse" }), undefined);
  assert.equal(models()[0]!.disabled, true);
  while (session.projection.status !== "completed") session.advance();
  // The lesson's own taps played (14 ones, 3 tens became 4 ones, 4 tens); the task then lays its pile.
  assert.deepEqual(sessionValues(session), { ones: 26, tray_ones: 0, tens: 3 });
  assert.equal(session.studentVariableLive("ones"), true);
  // Taps are not live in a slider task.
  assert.equal(session.studentCardLive(card), false);
  // The track stops where trades reach: 6, 16, …, 56, not 0, 10, 20.
  assert.deepEqual(models(), [{ alias: "ones", label: "ones", value: 26, min: 6, max: 56, step: 10, disabled: false }]);
  // One drag, two stops down: two trades, each the taps a learner would make.
  const id = session.beginStudentVariableOperation("ones", { control: "slider", input: "touch" });
  session.updateStudentVariableOperation(id, 16);
  assert.deepEqual(sessionValues(session), { ones: 16, tray_ones: 0, tens: 4 });
  const first = session.takeStudentCardSteps(card);
  assert.deepEqual(first.map((step) => step.tap.kind), [...Array(10).fill("gather"), "make"]);
  session.updateStudentVariableOperation(id, 6);
  const logged = session.commitStudentVariableOperation(id, 6);
  assert.deepEqual(sessionValues(session), { ones: 6, tray_ones: 0, tens: 5 });
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  // The board is given a step per tap of the second trade, then nothing more.
  assert.deepEqual(session.takeStudentCardSteps(card).map((step) => step.tap.kind), [...Array(10).fill("gather"), "make"]);
  assert.deepEqual(session.takeStudentCardSteps(card), []);
  // Logged: each tap as a card_tap made by the slider, then the gesture, after its taps.
  const operations = session.studentOperations;
  assert.equal(operations.filter((operation) => operation.kind === "card_tap").length, 22);
  assert.ok(operations.filter((operation) => operation.kind === "card_tap").every((operation) => operation.kind === "card_tap" && operation.control === "slider" && operation.input === "touch"));
  assert.equal(operations.at(-1)!.kind, "variable_change");
  assert.deepEqual([logged?.before.value, logged?.after.value, logged?.control], [26, 6, "slider"]);
  assert.ok(operations.every((operation, index) => index === 0 || operation.sequence > operations[index - 1]!.sequence));
  // Replaying the log through the tap rules from the practice pile makes the same pile.
  assert.deepEqual(replayCardTaps({ ones: 26, tray_ones: 0, tens: 3 }, operations), sessionValues(session));
  // The saved log parses as it was, and a restored session holds the same pile and log.
  assert.deepEqual(parseStudentOperationLog(store.studentOperations.get("slide"), "slide")!.operations, operations);
  const restored = new BrowserLessonSession(events, store, "slide", { reducedMotion: true });
  assert.deepEqual(restored.studentOperations, operations);
  assert.deepEqual(sessionValues(restored), sessionValues(session));
  // Not live once the task is done.
  assert.equal(session.studentVariableLive("ones"), false);
});

test("a card slider's stop up breaks one and takes the ten out, as the taps do; a refused stop settles on the nearest it can reach", () => {
  const cardTask = {
    as: "trade", prompt: "Make tens until you can't. Then tap I'm done.", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "card_tap", node: "mat" }, { kind: "card_submit" }, { kind: "variable_change", variable: "ones", controls: ["slider"] }],
    completion: { kind: "card_fact", node: "mat", fact: "no_trade_left" }, hints: ["Make a ten."],
    start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 6, tray_ones: 0, tens: 5 } },
  };
  const slid = new BrowserLessonSession(sliderLesson([cardTask]), new MemoryStore(), "slide-up", { reducedMotion: true });
  const tapped = new BrowserLessonSession(sliderLesson([cardTask]), new MemoryStore(), "tap-up", { reducedMotion: true });
  const card = "slide:node:mat";
  for (const session of [slid, tapped]) while (session.projection.status !== "completed") session.advance();
  assert.equal(slid.studentVariableLive("ones"), true);
  assert.equal(slid.studentCardLive(card), true, "taps stay live beside the slider");
  slid.changeStudentVariable("ones", 16, { control: "slider", input: "mouse" });
  assert.ok("operation" in tapped.tapStudentCard(card, { kind: "break", place: 1 }));
  for (let i = 0; i < 10; i += 1) assert.ok("operation" in tapped.tapStudentCard(card, { kind: "ungather", place: 0 }));
  assert.deepEqual(sessionValues(slid), sessionValues(tapped));
  assert.deepEqual(sessionValues(slid), { ones: 16, tray_ones: 0, tens: 4 });
  assert.deepEqual(slid.takeStudentCardSteps(card).map((step) => step.tap.kind), ["break", ...Array(10).fill("ungather")]);
  // A slider's moves are not attempts on a card task; "done" is.
  assert.equal(slid.studentTasks[0]!.attempts.length, 0);
  // Past the last ten there is to break: the slider settles on 56, the last stop it can reach.
  slid.changeStudentVariable("ones", 70, { control: "slider", input: "mouse" });
  assert.deepEqual(sessionValues(slid), { ones: 56, tray_ones: 0, tens: 0 });
  // Below the lowest stop: it settles on 6.
  slid.changeStudentVariable("ones", 0, { control: "slider", input: "keyboard" });
  assert.deepEqual(sessionValues(slid), { ones: 6, tray_ones: 0, tens: 5 });
  // A move that reaches no new stop changes and logs nothing.
  const before = slid.studentOperations.length;
  assert.equal(slid.changeStudentVariable("ones", 2, { control: "slider", input: "keyboard" }), undefined);
  assert.equal(slid.studentOperations.length, before);
  // Only a slider moves a card's count: another control is refused.
  assert.equal(slid.beginStudentVariableOperation("ones", { control: "number_line_point", input: "mouse" }), "");
  assert.equal(slid.submitStudentCard("trade").status, "succeeded");
});

test("a three-column chain: two ones trades make 11 tens, then the tens slider goes down to 1 and the hundreds up by one", () => {
  const task = {
    as: "slide", prompt: "Make the ones and tens as few as you can.", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "variable_change", variable: "ones", controls: ["slider"] }, { kind: "variable_change", variable: "tens", controls: ["slider"] }],
    completion: { kind: "expression_target", expression: "ones + tens", value: 7, tolerance: 0.5 }, hints: ["Each stop is a trade."],
    start: { kind: "practice", variables: ["ones", "tray_ones", "tens", "tray_tens", "hundreds"], values: { ones: 16, tray_ones: 0, tens: 10, tray_tens: 0, hundreds: 1 } },
  };
  const session = new BrowserLessonSession(sliderLesson([task], { columns: 3 }), new MemoryStore(), "chain", { reducedMotion: true });
  while (session.projection.status !== "completed") session.advance();
  const live = { live: (alias: string) => session.studentVariableLive(alias) };
  // The practice pile: 16 ones and 10 tens, as the lesson's own taps made from 26 ones and 9 tens.
  assert.deepEqual(sessionValues(session), { ones: 16, tray_ones: 0, tens: 10, tray_tens: 0, hundreds: 1 });
  session.changeStudentVariable("ones", 6, { control: "slider", input: "mouse" });
  assert.deepEqual(sessionValues(session), { ones: 6, tray_ones: 0, tens: 11, tray_tens: 0, hundreds: 1 });
  const tens = variableControlModels(session.projection.board, live).find((model) => model.alias === "tens")!;
  assert.deepEqual([tens.min, tens.max, tens.value], [1, 21, 11]);
  session.changeStudentVariable("tens", 1, { control: "slider", input: "mouse" });
  assert.deepEqual(sessionValues(session), { ones: 6, tray_ones: 0, tens: 1, tray_tens: 0, hundreds: 2 });
  assert.equal(session.studentTasks[0]!.status, "succeeded");
});

test("a card slider with one stop is hidden, and shown once a trade gives it a second", () => {
  // 26 ones and 9 tens on three columns: the tens cannot make a hundred (9) or break one (none), so their
  // slider would run from 9 to 9 (owner, 2026-11-24: it looked broken).
  const task = {
    as: "slide", prompt: "Trade the ones.", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "variable_change", variable: "ones", controls: ["slider"] }],
    completion: { kind: "expression_target", expression: "ones", value: 6, tolerance: 0.5 }, hints: ["Each stop is a trade."],
    start: { kind: "practice", variables: ["ones", "tray_ones", "tens", "tray_tens", "hundreds"], values: { ones: 26, tray_ones: 0, tens: 9, tray_tens: 0, hundreds: 0 } },
  };
  const session = new BrowserLessonSession(sliderLesson([task], { columns: 3 }), new MemoryStore(), "one-stop", { reducedMotion: true });
  while (session.projection.status !== "completed") session.advance();
  // Both models stay in the list (a host keeps its controls while another slider is dragged); the tens are hidden.
  const shown = () => variableControlModels(session.projection.board).map((model) => [model.alias, model.hidden === true]);
  assert.deepEqual(sessionValues(session), { ones: 26, tray_ones: 0, tens: 9, tray_tens: 0, hundreds: 0 });
  assert.deepEqual(shown(), [["ones", false], ["tens", true]]);
  session.changeStudentVariable("ones", 16, { control: "slider", input: "mouse" });
  assert.deepEqual(shown(), [["ones", false], ["tens", false]]);
});

test("retrying a card slider task lays its whole practice pile again, not only the count", () => {
  const session = new BrowserLessonSession(sliderLesson([slideTask(24, { ones: 14, tray_ones: 0, tens: 3 })]), new MemoryStore(), "slide-retry", { reducedMotion: true });
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(sessionValues(session), { ones: 14, tray_ones: 0, tens: 3 });
  session.changeStudentVariable("ones", 4, { control: "slider", input: "mouse" });
  assert.deepEqual(sessionValues(session), { ones: 4, tray_ones: 0, tens: 4 });
  assert.equal(session.studentTasks[0]!.status, "in_progress");
  session.retryStudentTask("slide");
  assert.deepEqual(sessionValues(session), { ones: 14, tray_ones: 0, tens: 3 });
});

test("a host's reset of one count on a card's slider is refused: the pile stays one the card made (review of Learn #233)", () => {
  const session = new BrowserLessonSession(sliderLesson([slideTask(6, { ones: 26, tray_ones: 0, tens: 3 })]), new MemoryStore(), "slide-reset", { reducedMotion: true });
  while (session.projection.status !== "completed") session.advance();
  session.changeStudentVariable("ones", 16, { control: "slider", input: "mouse" });
  assert.deepEqual(sessionValues(session), { ones: 16, tray_ones: 0, tens: 4 });
  // During the task and after it, a reset of the ones alone would draw 14 ones beside 4 tens: refused.
  assert.equal(session.changeStudentVariable("ones", 14, { control: "reset", input: "mouse" }), undefined);
  assert.deepEqual(sessionValues(session), { ones: 16, tray_ones: 0, tens: 4 });
  session.changeStudentVariable("ones", 6, { control: "slider", input: "mouse" });
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  assert.equal(session.changeStudentVariable("ones", 14, { control: "reset", input: "mouse" }), undefined);
  assert.deepEqual(sessionValues(session), { ones: 6, tray_ones: 0, tens: 5 });
});

test("a page closed mid-drag restores the pile its saved taps replay to (review of #99)", async () => {
  const events = sliderLesson([slideTask(6, { ones: 26, tray_ones: 0, tens: 3 })]);
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "slide-reload", { reducedMotion: true });
  while (session.projection.status !== "completed") session.advance();
  // A real pause first, so the first drag frame would have been saved at once and the second deferred.
  await new Promise((resolve) => setTimeout(resolve, 450));
  const id = session.beginStudentVariableOperation("ones", { control: "slider", input: "mouse" });
  session.updateStudentVariableOperation(id, 16);
  session.updateStudentVariableOperation(id, 6);
  assert.deepEqual(sessionValues(session), { ones: 6, tray_ones: 0, tens: 5 });
  // The page closes now, without a commit; a new page restores straight from storage.
  const restored = new BrowserLessonSession(events, store, "slide-reload", { reducedMotion: true });
  assert.equal(restored.studentOperations.filter((operation) => operation.kind === "card_tap").length, 22);
  assert.deepEqual(sessionValues(restored), replayCardTaps({ ones: 26, tray_ones: 0, tens: 3 }, restored.studentOperations));
  assert.deepEqual(sessionValues(restored), { ones: 6, tray_ones: 0, tens: 5 });
});

test("replaying the lesson lays a card slider task's practice pile again, and the slider shows whole counts", () => {
  const session = new BrowserLessonSession(sliderLesson([slideTask(6, { ones: 26, tray_ones: 0, tens: 3 })]), new MemoryStore(), "slide-replay", { reducedMotion: true });
  while (session.projection.status !== "completed") session.advance();
  session.changeStudentVariable("ones", 16, { control: "slider", input: "mouse" });
  assert.deepEqual(sessionValues(session), { ones: 16, tray_ones: 0, tens: 4 });
  // Replayed: the lesson's pile (4 ones, 4 tens) could not reach 6 ones, so the practice pile is laid again.
  session.seek(0);
  assert.equal(session.studentVariableLive("ones"), false);
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(sessionValues(session), { ones: 26, tray_ones: 0, tens: 3 });
  assert.equal(session.studentVariableLive("ones"), true);
  // Between whole numbers (a pile arriving, a lesson animation) the slider reads the count the card draws.
  const board = structuredClone(session.projection.board)!;
  board.variables!.ones!.value = 25.6;
  const node = board.nodes["slide:node:mat"]!;
  (node.content.places as Array<{ count: number }>)[0]!.count = 25.6;
  assert.deepEqual(variableControlModels(board).map((model) => [model.value, model.min, model.max]), [[26, 6, 56]]);
});

// ---------------------------------------------------------------- the place-value chart (decision 0025)

const chartValues = (session: BrowserLessonSession) => Object.fromEntries(Object.entries(session.projection.board?.variables ?? {}).map(([k, v]) => [k, v.value]));
const chartAt = (place: number) => place + 3;

test("a chart task to build: the number and an empty chart laid at once, taps by the card's rules, done judged by the card", () => {
  const lesson = chartLesson({ mode: "build", given: "name", target: 4_050_000, practice: [3_012_000] });
  const events = normalizeAuthoringLesson(lesson, chartHost("pv"));
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "pv", { reducedMotion: true });
  const card = "pv:node:chart";
  assert.deepEqual(session.tapStudentCard(card, { kind: "add", place: chartAt(0) }), { refused: "inert", message: "" });
  while (session.projection.status !== "completed") session.advance();
  assert.equal(session.studentCardLive(card), true);
  assert.equal(session.projection.board!.nodes[card]!.content.target, 3_012_000, "the task's own number");
  assert.equal(chartValues(session)[chartVariable("count", 3)], 0);
  // Done before the number is built is a failed attempt, not a refusal.
  assert.equal(session.submitStudentCard("practice-1").status, "in_progress");
  for (let i = 0; i < 3; i += 1) assert.ok("operation" in session.tapStudentCard(card, { kind: "add", place: chartAt(3) }, "mouse"));
  const ten = session.tapStudentCard(card, { kind: "add", place: chartAt(1) });
  assert.ok("operation" in ten);
  assert.deepEqual(ten.operation.changes, [{ alias: chartVariable("count", 1), before: 0, after: 1 }]);
  assert.deepEqual(ten.operation.tap, { kind: "add", place: chartAt(1) });
  for (let i = 0; i < 9; i += 1) session.tapStudentCard(card, { kind: "add", place: chartAt(0) });
  // A tenth disk is refused in the chart's words; taking one away is a tap too.
  assert.deepEqual(session.tapStudentCard(card, { kind: "add", place: chartAt(0) }), { refused: "full", message: "This place holds nine at most. Ten of them make one of the next place." });
  assert.deepEqual(session.tapStudentCard(card, { kind: "take_out", place: chartAt(0) }), { refused: "wrong_mode", message: "That can't be done here." });
  for (let i = 0; i < 7; i += 1) session.tapStudentCard(card, { kind: "remove", place: chartAt(0) });
  assert.equal(chartValues(session)[chartVariable("count", 0)], 2);
  const done = session.submitStudentCard("practice-1", "touch");
  assert.equal(done.status, "succeeded");
  assert.deepEqual(done.attempts.map((attempt) => [attempt.actual, attempt.target, attempt.succeeded]), [[0, 1, false], [1, 1, true]]);
  assert.equal(session.studentCardLive(card), false);
  // Restored: the whole log (ten-place taps, the learner's pile with its number) and the chart the learner made.
  const restored = new BrowserLessonSession(events, store, "pv", { reducedMotion: true });
  assert.deepEqual(restored.studentOperations, session.studentOperations);
  assert.deepEqual(restored.studentTasks, session.studentTasks);
  assert.deepEqual(chartValues(restored), chartValues(session));
  const submit = session.studentOperations.find((operation) => operation.kind === "card_submit" && operation.pile?.number === 3_012_000);
  assert.ok(submit, "done logs the learner's chart and its number");
});

test("a chart task to pull apart: each place taken out, a zero refused, then a row asks about the learner's parts", () => {
  const row = {
    as: "parts", anchor: "chart", prompt: "Write what each part is worth.", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "row_entry" }],
    completion: { kind: "numeric_row", parts: [{ text: "256.418 =" }, { blank: { as: "h", answer: "200", label: "hundreds" } }, { text: "+" }, { blank: { as: "t", answer: "50", label: "tens" } },
      { text: "+" }, { blank: { as: "o", answer: "6", label: "ones" } }, { text: "+" }, { blank: { as: "a", answer: "0.4", label: "tenths" } }, { text: "+" },
      { blank: { as: "b", answer: "0.01", label: "hundredths" } }, { text: "+" }, { blank: { as: "c", answer: "0.008", label: "thousandths" } }] },
    hints: ["Each part is its disks' value."],
  };
  const lesson = chartLesson({ mode: "apart", given: "numeral", target: 347_392, practice: [256_418], extraTasks: [row] });
  const events = normalizeAuthoringLesson(lesson, chartHost("pv-apart"));
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "pv-apart", { reducedMotion: true });
  const card = "pv-apart:node:chart";
  while (session.projection.status !== "completed") session.advance();
  assert.equal(chartValues(session)[chartVariable("count", 2)], 2, "the task's own number, whole");
  assert.deepEqual(session.tapStudentCard(card, { kind: "add", place: chartAt(2) }), { refused: "wrong_mode", message: "That can't be done here." });
  for (const place of [2, 1, 0, -1, -2]) assert.ok("operation" in session.tapStudentCard(card, { kind: "take_out", place: chartAt(place) }));
  assert.deepEqual(session.tapStudentCard(card, { kind: "take_out", place: chartAt(1) }), { refused: "empty", message: "There is no disk in this place." });
  assert.equal(session.submitStudentCard("practice-1").status, "in_progress");
  assert.ok("operation" in session.tapStudentCard(card, { kind: "take_out", place: chartAt(-3) }));
  assert.equal(session.submitStudentCard("practice-1").status, "succeeded");
  // The row opens over the learner's pulled-apart chart: every place in its part.
  assert.equal(session.studentTasks[1]!.available, true);
  const values = chartValues(session);
  assert.deepEqual([2, 1, 0, -1, -2, -3].map((place) => [values[chartVariable("count", place)], values[chartVariable("pulled", place)]]), [[0, 2], [0, 5], [0, 6], [0, 4], [0, 1], [0, 8]]);
  assert.equal(values.number, 256_418);
  assert.equal((session.submitStudentRow("parts", { h: "200", t: "50", o: "6", a: ".4", b: "0.01", c: "8/1000" }) as StudentTaskSnapshot).status, "succeeded");
  // Restored: the same log, tasks and chart.
  const restored = new BrowserLessonSession(events, store, "pv-apart", { reducedMotion: true });
  assert.deepEqual(restored.studentOperations, session.studentOperations);
  assert.deepEqual(restored.studentTasks.map((task) => task.status), ["succeeded", "succeeded"]);
  assert.deepEqual(chartValues(restored), values);
});

test("a replayed chart pile is the learner's only if they could have made it on that task (review of #113)", () => {
  const replay = (mode: "build" | "apart", target: number, practice: number, work: (session: BrowserLessonSession, card: string) => void, tamper: (pile: Record<string, number>) => void) => {
    const lesson = chartLesson({ mode, given: mode === "build" ? "name" : "numeral", target, practice: [practice] });
    const events = normalizeAuthoringLesson(lesson, chartHost(`pv-${mode}`));
    const store = new MemoryStore();
    const session = new BrowserLessonSession(events, store, `pv-${mode}`, { reducedMotion: true });
    const card = `pv-${mode}:node:chart`;
    while (session.projection.status !== "completed") session.advance();
    work(session, card);
    assert.equal(session.submitStudentCard("practice-1").status, "succeeded");
    const honest = chartValues(session);
    for (const log of store.studentOperations.values()) for (const operation of log.operations) if (operation.kind === "card_submit" && operation.pile) tamper(operation.pile);
    store.values.clear(); // no checkpoint: the chart is rebuilt from the log
    const restored = new BrowserLessonSession(events, store, `pv-${mode}`, { reducedMotion: true });
    while (restored.projection.status !== "completed") restored.advance();
    assert.deepEqual(chartValues(restored), honest, `${mode}: the task's own chart, not the edited one`);
  };
  replay("build", 4_050_000, 3_012_000, (session, card) => {
    for (let i = 0; i < 3; i += 1) session.tapStudentCard(card, { kind: "add", place: chartAt(3) });
    session.tapStudentCard(card, { kind: "add", place: chartAt(1) });
    for (let i = 0; i < 2; i += 1) session.tapStudentCard(card, { kind: "add", place: chartAt(0) });
  }, (pile) => {
    for (const key of Object.keys(pile)) pile[key] = 0;
    pile.number = 4_000_000;
    pile[chartVariable("count", 3)] = 4;
  });
  replay("apart", 347_392, 256_418, (session, card) => {
    for (const place of [2, 1, 0, -1, -2, -3]) session.tapStudentCard(card, { kind: "take_out", place: chartAt(place) });
  }, (pile) => {
    for (const key of Object.keys(pile)) pile[key] = 0;
    pile.number = 300_000;
    pile[chartVariable("pulled", 2)] = 9;
    pile[chartVariable("pulled", 1)] = 9;
  });
});

test("the student log keeps a chart's taps and its whole pile, and refuses a tap no card takes", () => {
  const tap = (kind: string, place: number) => ({
    profile: "octos.student.operation", version: "0.1", id: `l:card-tap:${place}${kind}`, sequence: 1, lesson_id: "l", kind: "card_tap",
    target: { kind: "card_node", node_id: "l:node:chart" }, tap: { kind, place }, changes: [{ alias: "count_ones", before: 0, after: 1 }], input: "mouse",
  });
  const log = (operation: unknown) => ({ profile: "octos.student.operation-log", version: "0.1", lesson_id: "l", operations: [operation] });
  assert.equal(parseStudentOperationLog(log(tap("add", 9)), "l")?.operations.length, 1);
  assert.equal(parseStudentOperationLog(log(tap("take_out", 0)), "l")?.operations.length, 1);
  assert.equal(parseStudentOperationLog(log(tap("gather", 2)), "l")?.operations.length, 1, "the mat's taps as before");
  assert.equal(parseStudentOperationLog(log(tap("gather", 3)), "l"), undefined, "the mat has three places");
  assert.equal(parseStudentOperationLog(log(tap("add", 10)), "l"), undefined, "the chart has ten places");
  assert.equal(parseStudentOperationLog(log(tap("fold", 0)), "l"), undefined);
  assert.equal(parseStudentOperationLog(log(tap("down", 3)), "l")?.operations.length, 1, "a trade card's taps (decision 0026)");
  assert.equal(parseStudentOperationLog(log(tap("trade", 7)), "l")?.operations.length, 1);
  const pile = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`v${i}`, i]));
  const submit = (keys: Record<string, number>) => ({ profile: "octos.student.operation", version: "0.1", id: "l:card-submit:1", sequence: 1, lesson_id: "l", kind: "card_submit",
    target: { kind: "student_task", task_id: "t" }, input: "mouse", pile: keys });
  assert.equal(parseStudentOperationLog(log(submit(pile)), "l")?.operations.length, 1);
  assert.equal(parseStudentOperationLog(log(submit({ ...pile, v21: 1 })), "l"), undefined);
});

test("a practice start changes the chart's number at once, while its disks ease (no numbers between)", () => {
  const lesson = chartLesson({ mode: "build", given: "name", target: 4_050_000, practice: [3_012_000],
    beats: [{ key: "build", say: "Four thousands.", actions: [{ do: "animate", variable: chartVariable("count", 3), value: 4 }] } as any] });
  const session = new BrowserLessonSession(normalizeAuthoringLesson(lesson, chartHost("pv-ease")), new MemoryStore(), "pv-ease");
  for (let step = 0; step < 50 && session.projection.status !== "completed"; step += 1) session.advance();
  assert.equal(session.projection.status, "completed");
  const values = chartValues(session);
  // The number is the task's at once, never one between 4,050 and 3,012, while the thousands' disks ease away.
  assert.equal(values.number, 3_012_000);
  assert.ok(values[chartVariable("count", 3)]! > 0, `the disks ease: ${values[chartVariable("count", 3)]}`);
});

// ---------------------------------------------------------------- the place-value trade card (decision 0026)

const tradeAt = (place: number) => place + 3;

test("a trade task: the pair laid at once, taps by the card's rules, the tap that completes the chart ends it, then the typed answer", () => {
  const lesson = tradeLesson({ operation: "add", a: "3486", b: "2739", practice: [["4658", "1573"]] });
  const events = normalizeAuthoringLesson(lesson, tradeHost("pt"));
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "pt", { reducedMotion: true });
  const card = "pt:node:sum";
  assert.deepEqual(session.tapStudentCard(card, { kind: "down", place: tradeAt(0) }), { refused: "inert", message: "" });
  while (session.projection.status !== "completed") session.advance();
  assert.equal(session.studentCardLive(card), true);
  assert.deepEqual([chartValues(session).a, chartValues(session).b], [4_658_000, 1_573_000], "the task's own pair");
  // A refusal changes nothing and states the fact, in the card's words.
  assert.deepEqual(session.tapStudentCard(card, { kind: "trade", place: tradeAt(0) }), { refused: "not_down", message: "Nothing below the line here yet." });
  assert.deepEqual(session.tapStudentCard(card, { kind: "break", place: tradeAt(1) }), { refused: "wrong_op", message: "That can't be done here." });
  // Any order: the hundreds first, then the ones and tens; a carry lands below a line already crossed.
  const down = session.tapStudentCard(card, { kind: "down", place: tradeAt(2) }, "mouse");
  assert.ok("operation" in down);
  assert.deepEqual(down.operation.changes, [{ alias: tradeVariable(2), before: 0, after: 1 }]);
  assert.deepEqual(down.operation.tap, { kind: "down", place: tradeAt(2) });
  assert.deepEqual(session.tapStudentCard(card, { kind: "down", place: tradeAt(2) }), { refused: "already_down", message: "This column is already below the line." });
  for (const [kind, place] of [["down", 0], ["trade", 0], ["down", 1], ["trade", 1], ["trade", 2]] as const) assert.ok("operation" in session.tapStudentCard(card, { kind, place: tradeAt(place) }, "mouse"));
  assert.equal(session.studentTasks[0]!.status, "not_started", "taps are not attempts");
  assert.equal(session.studentCardLive(card), true);
  // The last column comes down: the chart is complete and the task ends on that tap, with no "done".
  assert.ok("operation" in session.tapStudentCard(card, { kind: "down", place: tradeAt(3) }, "touch"));
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  assert.deepEqual(session.studentTasks[0]!.attempts.map((attempt) => [attempt.actual, attempt.target, attempt.succeeded]), [[1, 1, true]]);
  assert.equal(session.studentCardLive(card), false);
  const submit = session.studentOperations.at(-1)!;
  assert.equal(submit.kind, "card_submit");
  assert.equal((submit as { input: string }).input, "touch");
  // The typed answer opens over the finished chart (one digit per column), read by the number reader.
  assert.equal(session.studentTasks[1]!.available, true);
  const values = chartValues(session);
  assert.deepEqual([3, 2, 1, 0].map((place) => values[tradeVariable(place)]), [1, 2, 2, 2]);
  assert.equal((session.submitStudentAnswer("answer-1", "6230") as StudentTaskSnapshot).status, "in_progress");
  assert.deepEqual(session.submitStudentAnswer("answer-1", "six"), { unreadable: true });
  assert.equal((session.submitStudentAnswer("answer-1", "６,２３１") as StudentTaskSnapshot).status, "succeeded");
  // Restored: the same log, tasks and chart.
  const restored = new BrowserLessonSession(events, store, "pt", { reducedMotion: true });
  assert.deepEqual(restored.studentOperations, session.studentOperations);
  assert.deepEqual(restored.studentTasks.map((each) => each.status), ["succeeded", "succeeded"]);
  assert.deepEqual(chartValues(restored), values);
});

test("a trade task to subtract: a short column's fact with its counts, a borrow across zeros, then the difference", () => {
  const lesson = tradeLesson({ operation: "subtract", a: "50003", b: "2476", practice: [["40002", "3585"]] });
  const events = normalizeAuthoringLesson(lesson, tradeHost("pts"));
  const session = new BrowserLessonSession(events, new MemoryStore(), "pts", { reducedMotion: true });
  const card = "pts:node:sum";
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual(session.tapStudentCard(card, { kind: "down", place: tradeAt(0) }), { refused: "not_enough", message: "This column has 2; taking away 5 needs more." });
  assert.deepEqual(session.tapStudentCard(card, { kind: "break", place: tradeAt(3) }), { refused: "none_to_break", message: "This column is empty." });
  assert.deepEqual(session.tapStudentCard(card, { kind: "break", place: tradeAt(0) }), { refused: "no_right", message: "There is no column to the right to break into." });
  for (const place of [4, 3, 2, 1]) assert.ok("operation" in session.tapStudentCard(card, { kind: "break", place: tradeAt(place) }));
  assert.deepEqual(session.tapStudentCard(card, { kind: "break", place: tradeAt(4) }), { refused: "not_needed", message: "The thousands have 9; taking away 3 needs no more." });
  for (const place of [0, 1, 2, 3]) session.tapStudentCard(card, { kind: "down", place: tradeAt(place) });
  assert.equal(session.studentTasks[0]!.status, "not_started", "the ten thousands still have to come down");
  session.tapStudentCard(card, { kind: "down", place: tradeAt(4) });
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  assert.equal((session.submitStudentAnswer("answer-1", "36417") as StudentTaskSnapshot).status, "succeeded");
});

test("a trade lesson's demonstration moves by columns finished; the practice start lays the pair and fresh columns at once", () => {
  const lesson = tradeLesson({ operation: "add", a: "3486", b: "2739", practice: [["4658", "1573"]],
    beats: [{ key: "two", say: "The ones and the tens.", actions: [{ do: "animate", variable: "finished", value: 2 }] } as any] });
  const session = new BrowserLessonSession(normalizeAuthoringLesson(lesson, tradeHost("pt-demo")), new MemoryStore(), "pt-demo");
  let demonstrated: number | undefined;
  for (let step = 0; step < 50 && session.projection.status !== "completed"; step += 1) {
    session.advance();
    const node = session.projection.board?.nodes["pt-demo:node:sum"];
    if (node && Number(node.content.finished) >= 2) demonstrated = Number(node.content.finished);
  }
  assert.equal(session.projection.status, "completed");
  assert.equal(demonstrated, 2, "the card's columns finished followed the lesson's variable");
  // Every bound field of the card changes at once at the practice start: no status between two states.
  const values = chartValues(session);
  assert.deepEqual([values.a, values.b, values.finished, ...[3, 2, 1, 0].map((place) => values[tradeVariable(place)])], [4_658_000, 1_573_000, 0, 0, 0, 0, 0]);
});

test("a trade task has no done: a host's done before the chart is complete does nothing, and the snapshot says so", () => {
  const lesson = tradeLesson({ operation: "add", a: "3486", b: "2739", practice: [["4658", "1573"]] });
  const session = new BrowserLessonSession(normalizeAuthoringLesson(lesson, tradeHost("pt-done")), new MemoryStore(), "pt-done", { reducedMotion: true });
  while (session.projection.status !== "completed") session.advance();
  assert.equal(session.studentTasks[0]!.auto_submit, true);
  assert.equal(session.studentTasks[1]!.auto_submit, undefined, "a typed answer keeps its own button");
  const snapshot = session.submitStudentCard("practice-1");
  assert.deepEqual([snapshot.status, snapshot.attempts.length], ["not_started", 0]);
  assert.equal(session.studentOperations.filter((operation) => operation.kind === "card_submit").length, 0);
});

test("a practice chart restored complete, its submission lost, is submitted when it is laid again (review of #116)", () => {
  const lesson = tradeLesson({ operation: "add", a: "3486", b: "2739", practice: [["4658", "1573"]] });
  const events = normalizeAuthoringLesson(lesson, tradeHost("pt-lost"));
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "pt-lost", { reducedMotion: true });
  const card = "pt-lost:node:sum";
  while (session.projection.status !== "completed") session.advance();
  for (const [kind, place] of [["down", 0], ["trade", 0], ["down", 1], ["trade", 1], ["down", 2], ["trade", 2], ["down", 3]] as const) session.tapStudentCard(card, { kind, place: tradeAt(place) });
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  // As if the submission failed after the completing tap was saved: no card_submit, the task still open.
  for (const log of store.studentOperations.values()) log.operations = log.operations.filter((operation) => operation.kind !== "card_submit");
  for (const log of store.studentTaskProgress.values()) for (const task of log.tasks) { task.status = "not_started"; task.attempts = []; }
  const restored = new BrowserLessonSession(events, store, "pt-lost", { reducedMotion: true });
  while (restored.projection.status !== "completed") restored.advance();
  assert.equal(restored.studentTasks[0]!.status, "succeeded", "the complete chart closes its task");
  assert.equal(restored.studentTasks[1]!.available, true);
  assert.equal(restored.studentCardLive(card), false);
});

// ---------------------------------------------------------------- the make-ten card (decision 0027)

test("a make-ten task: the pair laid at once, taps by the card's rules, the tap that makes the ten ends it, then the row", () => {
  const lesson = makeTenLesson({ a: 8, b: 6, practice: [[7, 5]] });
  const events = normalizeAuthoringLesson(lesson, makeTenHost("mt"));
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "mt", { reducedMotion: true });
  const card = "mt:node:frames";
  assert.deepEqual(session.tapStudentCard(card, { kind: "give", place: 1 }), { refused: "inert", message: "" });
  while (session.projection.status !== "completed") session.advance();
  assert.equal(session.studentCardLive(card), true);
  assert.deepEqual(["a", "b", "filled", "moved"].map((alias) => chartValues(session)[alias]), [7, 5, 7, 0], "the task's own pair, fresh");
  // The 7's own counters stay: a fact naming their colour; the 5's counters cross.
  assert.deepEqual(session.tapStudentCard(card, { kind: "give", place: 0 }), { refused: "stays", message: "Red counters stay in their frame." });
  assert.deepEqual(session.tapStudentCard(card, { kind: "back", place: 0 }), { refused: "none", message: "That can't be done here." });
  const give = session.tapStudentCard(card, { kind: "give", place: 1 }, "mouse");
  assert.ok("operation" in give);
  assert.deepEqual(give.operation.changes, [{ alias: "moved", before: 0, after: 1 }]);
  assert.deepEqual(give.operation.tap, { kind: "give", place: 1 });
  // A counter that crossed goes back; taps are not attempts.
  assert.ok("operation" in session.tapStudentCard(card, { kind: "back", place: 0 }, "mouse"));
  assert.ok("operation" in session.tapStudentCard(card, { kind: "give", place: 1 }, "mouse"));
  assert.ok("operation" in session.tapStudentCard(card, { kind: "give", place: 1 }, "mouse"));
  assert.equal(session.studentTasks[0]!.status, "not_started");
  // The third makes the ten: the task ends on that tap, with no "done".
  assert.ok("operation" in session.tapStudentCard(card, { kind: "give", place: 1 }, "touch"));
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  assert.deepEqual(session.studentTasks[0]!.attempts.map((attempt) => [attempt.actual, attempt.target, attempt.succeeded]), [[1, 1, true]]);
  assert.equal(session.studentCardLive(card), false);
  assert.equal(session.studentOperations.at(-1)!.kind, "card_submit");
  // The row of four blanks, anchored on the card, opens over the ten made.
  assert.equal(session.studentTasks[1]!.available, true);
  assert.deepEqual(["a", "b", "filled", "moved"].map((alias) => chartValues(session)[alias]), [7, 5, 7, 3]);
  const swapped = session.submitStudentRow("row-1", { rest: "3", "to-ten": "2", ones: "2", total: "12" });
  assert.equal((swapped as StudentTaskSnapshot).status, "in_progress", "the part beside the 7 is the one that makes ten");
  assert.deepEqual(session.submitStudentRow("row-1", { "to-ten": "3", rest: "", ones: "2", total: "12" }), { unreadable: ["rest"] });
  assert.equal((session.submitStudentRow("row-1", { "to-ten": "３", rest: "2", ones: "2", total: "12" }) as StudentTaskSnapshot).status, "succeeded");
  // Restored: the same log, tasks and card.
  const restored = new BrowserLessonSession(events, store, "mt", { reducedMotion: true });
  assert.deepEqual(restored.studentOperations, session.studentOperations);
  assert.deepEqual(restored.studentTasks.map((each) => each.status), ["succeeded", "succeeded"]);
  assert.deepEqual(chartValues(restored), chartValues(session));
});

test("a make-ten lesson's demonstration moves by the count in the bigger frame; the practice start lays the pair fresh at once", () => {
  const lesson = makeTenLesson({ a: 8, b: 6, practice: [[7, 5]], beats: [{ key: "ten", say: "Two of the six fill the eight's frame.", actions: [{ do: "animate", variable: "filled", value: 10 }] } as any] });
  const session = new BrowserLessonSession(normalizeAuthoringLesson(lesson, makeTenHost("mt-demo")), new MemoryStore(), "mt-demo");
  let shown: number | undefined;
  for (let step = 0; step < 50 && session.projection.status !== "completed"; step += 1) {
    session.advance();
    const node = session.projection.board?.nodes["mt-demo:node:frames"];
    if (node && Number(node.content.filled) >= 10) shown = Number(node.content.filled);
  }
  assert.equal(session.projection.status, "completed");
  assert.equal(shown, 10, "the card's count followed the lesson's variable");
  assert.deepEqual(["a", "b", "filled", "moved"].map((alias) => chartValues(session)[alias]), [7, 5, 7, 0], "every bound field at once: no pair or count between two");
});

test("a make-ten task has no done, and a card restored with its ten made, its submission lost, is submitted when laid again", () => {
  const lesson = makeTenLesson({ a: 8, b: 6, practice: [[7, 5]] });
  const events = normalizeAuthoringLesson(lesson, makeTenHost("mt-lost"));
  const store = new MemoryStore();
  const session = new BrowserLessonSession(events, store, "mt-lost", { reducedMotion: true });
  const card = "mt-lost:node:frames";
  while (session.projection.status !== "completed") session.advance();
  assert.deepEqual([session.studentTasks[0]!.auto_submit, session.studentTasks[1]!.auto_submit], [true, undefined]);
  const early = session.submitStudentCard("practice-1");
  assert.deepEqual([early.status, early.attempts.length], ["not_started", 0], "a host's done before the ten does nothing");
  for (let i = 0; i < 3; i += 1) session.tapStudentCard(card, { kind: "give", place: 1 });
  assert.equal(session.studentTasks[0]!.status, "succeeded");
  for (const log of store.studentOperations.values()) log.operations = log.operations.filter((operation) => operation.kind !== "card_submit");
  for (const log of store.studentTaskProgress.values()) for (const task of log.tasks) { task.status = "not_started"; task.attempts = []; }
  const restored = new BrowserLessonSession(events, store, "mt-lost", { reducedMotion: true });
  while (restored.projection.status !== "completed") restored.advance();
  assert.equal(restored.studentTasks[0]!.status, "succeeded", "the ten made closes its task");
  assert.equal(restored.studentTasks[1]!.available, true);
});
