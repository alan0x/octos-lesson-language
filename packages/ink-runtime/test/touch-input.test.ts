import test from "node:test";
import assert from "node:assert/strict";
import {
  PALM_REJECTION_WINDOW_MS,
  shouldIgnoreTouchForPalmRejection,
} from "../src/palm-rejection.js";
import {
  TOUCH_MARQUEE_CANCEL_PX,
  TouchMarqueeArbiter,
} from "../src/touch-marquee.js";

test("touch is ignored while the pen is active or recently was", () => {
  assert.equal(shouldIgnoreTouchForPalmRejection(1000, 1000), true, "same tick as pen contact");
  assert.equal(shouldIgnoreTouchForPalmRejection(1500, 1000), true, "inside the window");
  assert.equal(
    shouldIgnoreTouchForPalmRejection(1000 + PALM_REJECTION_WINDOW_MS - 1, 1000),
    true,
    "just inside the window",
  );
});

test("touch is accepted without recent pen activity", () => {
  assert.equal(shouldIgnoreTouchForPalmRejection(1000, undefined), false, "pen never seen");
  assert.equal(
    shouldIgnoreTouchForPalmRejection(1000 + PALM_REJECTION_WINDOW_MS, 1000),
    false,
    "window boundary elapsed",
  );
  assert.equal(shouldIgnoreTouchForPalmRejection(5000, 1000), false, "long after pen lifted");
});

test("a pen timestamp in the future still counts as active (clock skew)", () => {
  assert.equal(shouldIgnoreTouchForPalmRejection(1000, 1400), true);
});

test("a custom window is honored", () => {
  assert.equal(shouldIgnoreTouchForPalmRejection(1300, 1000, 200), false);
  assert.equal(shouldIgnoreTouchForPalmRejection(1100, 1000, 200), true);
});

test("marquee arbitration: hold still, timer elapses, becomes marquee", () => {
  const arbiter = new TouchMarqueeArbiter();
  assert.equal(arbiter.getPhase(), "idle");
  assert.equal(arbiter.begin(100, 100), true);
  assert.equal(arbiter.getPhase(), "pending");
  // Small jitter below the travel threshold keeps the hold alive.
  assert.equal(arbiter.move(103, 102), "pending");
  assert.equal(arbiter.holdElapsed(), "marquee");
  assert.equal(arbiter.end(), "settled");
  assert.equal(arbiter.getPhase(), "idle");
});

test("marquee arbitration: travel beyond the threshold commits to pan", () => {
  const arbiter = new TouchMarqueeArbiter();
  arbiter.begin(100, 100);
  // Just below the threshold the gesture is still pending...
  assert.equal(arbiter.move(100 + TOUCH_MARQUEE_CANCEL_PX - 1, 100), "pending");
  // ...and exactly at it the gesture becomes a pan.
  assert.equal(arbiter.move(100 + TOUCH_MARQUEE_CANCEL_PX, 100), "pan");
  // A late timer fire must not turn a pan into a marquee.
  assert.equal(arbiter.holdElapsed(), "pan");
  assert.equal(arbiter.end(), "settled");
});

test("marquee arbitration: lifting during the hold is a tap", () => {
  const arbiter = new TouchMarqueeArbiter();
  arbiter.begin(50, 50);
  assert.equal(arbiter.move(52, 51), "pending");
  assert.equal(arbiter.end(), "tap");
  assert.equal(arbiter.getPhase(), "idle");
  // A timer firing after the tap finds nothing pending.
  assert.equal(arbiter.holdElapsed(), "idle");
});

test("marquee arbitration: a second touch cannot start while one is pending", () => {
  const arbiter = new TouchMarqueeArbiter();
  assert.equal(arbiter.begin(0, 0), true);
  assert.equal(arbiter.begin(200, 200), false);
  assert.equal(arbiter.getPhase(), "pending");
});

test("marquee arbitration: cancel drops tracking and allows a fresh start", () => {
  const arbiter = new TouchMarqueeArbiter();
  arbiter.begin(10, 10);
  arbiter.cancel();
  assert.equal(arbiter.getPhase(), "idle");
  assert.equal(arbiter.begin(20, 20), true);
});

test("marquee arbitration: diagonal travel is measured by distance", () => {
  const arbiter = new TouchMarqueeArbiter();
  arbiter.begin(0, 0);
  // 6-8-10 triangle: exactly the threshold, so it pans.
  assert.equal(arbiter.move(6, 8), "pan");
});
