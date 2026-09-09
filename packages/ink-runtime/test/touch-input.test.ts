import test from "node:test";
import assert from "node:assert/strict";
import {
  PALM_REJECTION_WINDOW_MS,
  shouldIgnoreTouchForPalmRejection,
} from "../src/palm-rejection.js";

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
