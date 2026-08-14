import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reduceCanonicalEvents } from "../../core/src/index.js";
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
import type { StudentOperationLog } from "../src/student-operations.js";
import type { StudentTaskProgressLog } from "../src/student-tasks.js";

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

test("manual slider input cancels automatic animation and restores the chosen value", () => {
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
  assert.deepEqual(
    first.studentOperations.map((operation) => ({
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
  assert.equal(first.studentOperations.at(-1)!.control, "reset");
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
  saved.operations[0]!.after.value = Number.NaN;

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
