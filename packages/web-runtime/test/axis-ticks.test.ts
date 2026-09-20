import assert from "node:assert/strict";
import test from "node:test";
import { planAxisTicks } from "../src/axis-ticks.js";
import {
  coordinateWheelZoomFactor,
  panCoordinateRanges,
  zoomCoordinateRanges,
} from "../src/coordinate-view.js";

test("padded integer ranges use readable ticks instead of subdivided boundaries", () => {
  const compact = planAxisTicks({ min: -.75, max: 8.75 }, 258);
  assert.deepEqual(compact.major, [0, 2, 4, 6, 8]);
  assert.equal(compact.format(0), "0");
  assert.equal(compact.format(2), "2");
  assert.ok(!compact.major.includes(-.75));
  assert.ok(!compact.major.includes(1.625));

  const enlarged = planAxisTicks({ min: -.75, max: 8.75 }, 520);
  assert.deepEqual(enlarged.major, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("small decimal ranges keep meaningful decimal ticks", () => {
  const plan = planAxisTicks({ min: -.2, max: .2 }, 260);
  assert.deepEqual(plan.major, [-.2, -.1, 0, .1, .2]);
  assert.deepEqual(plan.major.map(plan.format), ["-0.2", "-0.1", "0", "0.1", "0.2"]);
});

test("small zoom changes keep the previous readable step to avoid label flicker", () => {
  const initial = planAxisTicks({ min: 0, max: 10 }, 258);
  const withoutHysteresis = planAxisTicks({ min: 0, max: 10.5 }, 258);
  const stable = planAxisTicks({ min: 0, max: 10.5 }, 258, { previousStep: initial.step });
  assert.equal(initial.step, 2);
  assert.equal(withoutHysteresis.step, 5);
  assert.equal(stable.step, 2);
});

test("tick plans are bounded and avoid duplicate negative zero labels", () => {
  const plan = planAxisTicks({ min: -1e9, max: 1e9 }, 300);
  assert.ok(plan.major.length <= 200);
  assert.equal(new Set(plan.major.map(plan.format)).size, plan.major.length);
  assert.equal(plan.format(-0), "0");
});

test("coordinate zoom preserves both mathematical anchors atomically", () => {
  const ranges = { x: { min: -4, max: 4 }, y: { min: -2, max: 6 } };
  const zoomed = zoomCoordinateRanges(ranges, .5, { x: .25, y: .75 });
  assert.equal(zoomed.x.min + (zoomed.x.max - zoomed.x.min) * .25, -2);
  assert.equal(zoomed.y.min + (zoomed.y.max - zoomed.y.min) * .75, 4);
  assert.deepEqual(zoomCoordinateRanges(ranges, Infinity), ranges);
  assert.deepEqual(panCoordinateRanges(ranges, 2, -1), {
    x: { min: -2, max: 6 }, y: { min: -3, max: 5 },
  });
});

test("wheel zoom is continuous and follows wheel direction", () => {
  assert.ok(coordinateWheelZoomFactor(-100, 0) < 1);
  assert.ok(coordinateWheelZoomFactor(100, 0) > 1);
  assert.ok(coordinateWheelZoomFactor(-3, 1) < 1);
});
