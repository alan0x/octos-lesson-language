import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeAuthoringLesson, reduceCanonicalEvents } from "../../core/src/index.js";
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
