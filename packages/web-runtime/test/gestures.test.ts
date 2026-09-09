import test from "node:test";
import assert from "node:assert/strict";
import {
  BoardGestureRecognizer,
  type BoardGestureAction,
  type GesturePointerEvent,
} from "../src/gestures.js";

const down = (pointerId: number, x: number, y: number): GesturePointerEvent => ({ pointerId, x, y, type: "down" });
const move = (pointerId: number, x: number, y: number): GesturePointerEvent => ({ pointerId, x, y, type: "move" });
const up = (pointerId: number, x: number, y: number): GesturePointerEvent => ({ pointerId, x, y, type: "up" });
const cancel = (pointerId: number, x: number, y: number): GesturePointerEvent => ({ pointerId, x, y, type: "cancel" });
const NONE: BoardGestureAction[] = [{ type: "none" }];

/** Feeds an event table and asserts the exact action table it must produce. */
function runTable(steps: Array<{ event: GesturePointerEvent; expected: BoardGestureAction[]; phase?: string }>): BoardGestureRecognizer {
  const recognizer = new BoardGestureRecognizer();
  steps.forEach((step, index) => {
    assert.deepEqual(
      recognizer.handlePointer(step.event),
      step.expected,
      `step ${index}: ${step.event.type} #${step.event.pointerId}`,
    );
    if (step.phase) assert.equal(recognizer.phase, step.phase, `step ${index} phase`);
  });
  return recognizer;
}

test("single finger pans with per-move deltas", () => {
  const recognizer = runTable([
    { event: down(1, 100, 100), expected: NONE, phase: "panning" },
    { event: move(1, 120, 90), expected: [{ type: "panBy", dx: 20, dy: -10 }] },
    { event: move(1, 130, 95), expected: [{ type: "panBy", dx: 10, dy: 5 }] },
    { event: up(1, 130, 95), expected: NONE, phase: "idle" },
  ]);
  assert.equal(recognizer.isActive(), false);
});

test("two-finger pinch zooms about the current midpoint and pans with it", () => {
  runTable([
    { event: down(1, 100, 100), expected: NONE },
    { event: down(2, 200, 100), expected: NONE, phase: "pinching" },
    // Distance doubles 100 -> 200: factor 2, anchored at the *current*
    // midpoint (200,100), which itself moved and therefore pans.
    {
      event: move(2, 300, 100),
      expected: [
        { type: "panBy", dx: 50, dy: 0 },
        { type: "zoomAt", factor: 2, x: 200, y: 100 },
      ],
    },
    // Symmetric two-event sequence: net pan (-10, 0), net zoom exactly 1.
    { event: move(1, 90, 100), expected: [
      { type: "panBy", dx: -5, dy: 0 },
      { type: "zoomAt", factor: 210 / 200, x: 195, y: 100 },
    ] },
    { event: move(2, 290, 100), expected: [
      { type: "panBy", dx: -5, dy: 0 },
      { type: "zoomAt", factor: 200 / 210, x: 190, y: 100 },
    ] },
    // One finger slides by (+10, +20): midpoint displacement pans, the new
    // distance rescales, both anchored at the new midpoint.
    {
      event: move(1, 100, 120),
      expected: [
        { type: "panBy", dx: 5, dy: 10 },
        { type: "zoomAt", factor: Math.hypot(190, 20) / 200, x: 195, y: 110 },
      ],
    },
  ]);
});

test("pinch emits no actions when neither distance nor midpoint change", () => {
  runTable([
    { event: down(1, 0, 0), expected: NONE },
    { event: down(2, 100, 0), expected: NONE },
    // Rotate both fingers symmetrically: same distance, same midpoint.
    { event: move(1, 0, 0), expected: NONE },
  ]);
});

test("a second finger landing does not reset the ongoing pan baseline", () => {
  // Regression test for the single-pointer `dragging` model, where a second
  // touch overwrote the pan origin and the camera jumped.
  const recognizer = runTable([
    { event: down(1, 100, 100), expected: NONE },
    { event: move(1, 150, 140), expected: [{ type: "panBy", dx: 50, dy: 40 }] },
    // Second finger lands: no action, and crucially no baseline reset...
    { event: down(2, 300, 300), expected: NONE, phase: "pinching" },
  ]);
  // ...proved by lifting it again: the first finger resumes from where it
  // actually is (150,140), so the next move is a small delta, not a jump
  // back to the second finger's position or the original down point.
  assert.deepEqual(recognizer.handlePointer(up(2, 300, 300)), NONE);
  assert.equal(recognizer.phase, "panning");
  assert.deepEqual(recognizer.handlePointer(move(1, 155, 138)), [{ type: "panBy", dx: 5, dy: -2 }]);
});

test("lifting one pinch finger continues panning from the remaining finger without a jump", () => {
  const recognizer = runTable([
    { event: down(1, 100, 100), expected: NONE },
    { event: down(2, 200, 100), expected: NONE },
    { event: move(2, 260, 160), expected: [
      { type: "panBy", dx: 30, dy: 30 },
      { type: "zoomAt", factor: Math.hypot(160, 60) / 100, x: 180, y: 130 },
    ] },
  ]);
  // Finger 1 lifts; finger 2 stays at (260,160). Its next move must be a
  // delta from (260,160), not from finger 1's position or the midpoint.
  assert.deepEqual(recognizer.handlePointer(up(1, 100, 100)), NONE);
  assert.equal(recognizer.phase, "panning");
  assert.deepEqual(recognizer.handlePointer(move(2, 270, 165)), [{ type: "panBy", dx: 10, dy: 5 }]);
});

test("cancel resets the gesture to idle like an up", () => {
  const recognizer = runTable([
    { event: down(1, 10, 10), expected: NONE },
    { event: down(2, 50, 10), expected: NONE, phase: "pinching" },
    { event: cancel(2, 50, 10), expected: NONE, phase: "panning" },
  ]);
  assert.equal(recognizer.isActive(), true);
  assert.deepEqual(recognizer.handlePointer(cancel(1, 10, 10)), NONE);
  assert.equal(recognizer.phase, "idle");
  assert.equal(recognizer.isActive(), false);
});

test("events from unknown pointers are ignored", () => {
  runTable([
    { event: move(99, 0, 0), expected: NONE, phase: "idle" },
    { event: up(99, 0, 0), expected: NONE, phase: "idle" },
    { event: down(1, 0, 0), expected: NONE },
    { event: move(99, 50, 50), expected: NONE, phase: "panning" },
  ]);
});

test("a third finger is ignored and never disturbs the in-flight pinch", () => {
  const recognizer = runTable([
    { event: down(1, 100, 100), expected: NONE },
    { event: down(2, 200, 100), expected: NONE, phase: "pinching" },
    { event: down(3, 400, 400), expected: NONE, phase: "pinching" },
    // Moves from the ignored third finger produce nothing.
    { event: move(3, 500, 500), expected: NONE, phase: "pinching" },
    // Lifting the ignored finger must not end the gesture.
    { event: up(3, 500, 500), expected: NONE, phase: "pinching" },
  ]);
  // The original pinch is still intact.
  assert.deepEqual(
    recognizer.handlePointer(move(2, 250, 100)),
    [
      { type: "panBy", dx: 25, dy: 0 },
      { type: "zoomAt", factor: 1.5, x: 175, y: 100 },
    ],
  );
});

test("cumulative pinchFactor tracks dist / dist0", () => {
  const recognizer = new BoardGestureRecognizer();
  recognizer.handlePointer(down(1, 100, 100));
  recognizer.handlePointer(down(2, 200, 100));
  recognizer.handlePointer(move(2, 300, 100));
  assert.equal(recognizer.pinchFactor(), 2);
  recognizer.handlePointer(move(2, 250, 100));
  assert.equal(recognizer.pinchFactor(), 1.5);
});

test("reset aborts the gesture and drops all baselines", () => {
  const recognizer = new BoardGestureRecognizer();
  recognizer.handlePointer(down(1, 10, 10));
  recognizer.handlePointer(down(2, 20, 10));
  assert.equal(recognizer.isActive(), true);
  recognizer.reset();
  assert.equal(recognizer.phase, "idle");
  assert.equal(recognizer.isActive(), false);
  assert.deepEqual(recognizer.handlePointer(move(1, 100, 100)), NONE);
});
