// The number line's own zoom and tick thinning (decision 0024): thinning at rest and zoomed, marked
// values keep their ticks and labels, zoom limits, window clamping, a card that never resizes, and a
// dragged point that lands on the same stops whatever the zoom.
import test from "node:test";
import assert from "node:assert/strict";
import {
  clampNumberLineWindow, numberLineDragValue, numberLineZoomCentre, numberLineZoomLimits, NUMBER_LINE_ZOOM, panNumberLineWindow,
  planNumberLineTicks, planTickStride, thinNumberLineTicks, zoomNumberLineWindow, type NumberLineContent, type NumberLineWindow,
} from "../src/number-line.js";
import { NUMBER_LINE_VIEW_WIDTH, planNumberLineCard } from "../src/number-line-view.js";

/** The line's drawn length in board units: the card's 520-unit drawing less its two 30-unit sides. */
const WIDTH = NUMBER_LINE_VIEW_WIDTH - 60;
const values = (plan: { ticks: Array<{ value: number }> }) => plan.ticks.map((tick) => tick.value);
const labelled = (plan: { labelRow: Map<number, number> }) => [...plan.labelRow.keys()].sort((a, b) => a - b);

// BT-19 (47 pages, then ten more) and BT-20 (round 347 to the nearest ten), from check 3.
const bt19 = {
  range: { min: 0, max: 70 }, ticks: { step: 1 },
  points: [{ as: "start", value: 47, label: "Start" }, { as: "end", value: 57, label: "End" }],
  jumps: [{ as: "more", from: "start", by: 10, label: "+10" }],
};
const bt20 = {
  range: { min: 300, max: 410 }, ticks: { step: 1 },
  points: [{ as: "low", value: 340 }, { as: "half", value: 345, style: "open" }, { as: "n", value: 347, label: "Number to round" }, { as: "high", value: 350 }],
  jumps: [{ as: "up", from: "n", by: 3 }],
};

test("ticks closer than 14 board units thin on a 1-2-5 stride, also at rest; the rule's numbers are named", () => {
  assert.equal(NUMBER_LINE_ZOOM.minTickSpacing, 14);
  assert.equal(NUMBER_LINE_ZOOM.maxTickSpacing, 48);
  // 0 to 70 is 460/70 = 6.57 units a tick: BT-19's comb draws every fifth number (decision 0024).
  const comb = planNumberLineCard(bt19);
  assert.equal(comb.tickStride, 5);
  assert.equal(comb.ticks.length, 15 + 2, "0, 5 … 70, plus the marked 47 and 57");
  // 300 to 410 is 4.18 units a tick: every fifth number, counted from 0 (so 300, 305 …).
  const rounding = planNumberLineCard(bt20);
  assert.equal(rounding.tickStride, 5);
  assert.ok(values(rounding).includes(300) && values(rounding).includes(305) && !values(rounding).includes(302));
  // 0 to 80 (5.75 a tick) draws every fifth; 0 to 200 (2.3) every tenth; 0.46 a tick thins to every 50.
  assert.equal(planNumberLineCard({ range: { min: 0, max: 80 }, ticks: { step: 1 } }).tickStride, 5);
  assert.equal(planNumberLineCard({ range: { min: 0, max: 200 }, ticks: { step: 1 } }).tickStride, 10);
  assert.equal(planTickStride(0.46), 50);
  // A line that is not crowded keeps every tick: 0 to 20 by ones is 23 units a tick.
  assert.equal(planNumberLineCard({ range: { min: 0, max: 20 }, ticks: { step: 1 } }).tickStride, 1);
});

test("the values a card marks keep their tick and label on a thinned line", () => {
  const plan = planNumberLineCard(bt20);
  // 347 is off the stride and kept; 340, 345 and 350 are on it.
  for (const value of [340, 345, 347, 350]) {
    assert.ok(values(plan).includes(value), `${value} keeps its tick`);
    assert.ok(labelled(plan).includes(value), `${value} keeps its label`);
  }
  assert.ok(!values(plan).includes(343), "an unmarked odd number is thinned");
});

test("every label drawn has its tick, and labels thin among the drawn ticks", () => {
  for (const range of [{ min: 0, max: 80 }, { min: 300, max: 410 }, { min: -17, max: 17 }, { min: 0, max: 200 }]) {
    const plan = planNumberLineCard({ range, ticks: { step: 1 }, points: [{ as: "p", value: range.min + 7 }] });
    for (const value of labelled(plan)) assert.ok(values(plan).includes(value), `${range.min}..${range.max}: ${value} is labelled but has no tick`);
  }
});

test("with subdivisions, thinning keeps the major ticks (never thirds of a stride of two)", () => {
  // Quarters over 0..60 (240 smallest ticks, 1.9 units each): every quarter, half and whole number is too
  // close (7.7 units), so ticks fall on every second whole number.
  const quarters = { range: { min: 0, max: 60 }, ticks: { step: 1, subdivisions: 4 } };
  const plan = planNumberLineCard(quarters);
  assert.ok(plan.ticks.every((tick) => Number.isInteger(tick.value)), "only whole numbers");
  assert.equal(plan.tickStride, 8);
  // A stride inside a step divides its subdivisions (halves of tenths, never fifths of thirds) and keeps
  // them 6 units apart; past the step it is whole steps, 14 apart.
  assert.equal(NUMBER_LINE_ZOOM.minSubdivisionSpacing, 6);
  assert.equal(planTickStride(1.5, 10), 5);
  assert.equal(planTickStride(2.5, 3), 6);
  assert.equal(planTickStride(3.5, 4), 2);
  assert.equal(planTickStride(7.5, 4), 1);
  // −5 to 5 in quarters (11.5 units a quarter) keeps every quarter.
  assert.equal(planNumberLineCard({ range: { min: -5, max: 5 }, ticks: { step: 1, subdivisions: 4 } }).tickStride, 1);
  // Zoomed in, every quarter comes back.
  const zoomed = planNumberLineCard(quarters, undefined, { min: 10, max: 15 });
  assert.equal(zoomed.tickStride, 1);
  assert.deepEqual(values(zoomed).slice(0, 5), [10, 10.25, 10.5, 10.75, 11]);
});

test("zoomed in, all ticks return, only inside the window, and the label thinning applies to the window", () => {
  const window = { min: 335, max: 355 };
  const plan = planNumberLineCard(bt20, undefined, window);
  assert.equal(plan.zoomed, true);
  assert.equal(plan.tickStride, 1);
  assert.deepEqual(values(plan), Array.from({ length: 21 }, (_, index) => 335 + index));
  // 23 units a tick is too close for three-digit labels: they thin among the window's ticks (every
  // second), the marked values keep theirs, and none outside the window is drawn.
  assert.deepEqual(labelled(plan), [336, 338, 340, 342, 345, 347, 350, 352, 354]);
  // 46 units a tick: every number in the window is labelled.
  const closer = planNumberLineCard(bt20, undefined, { min: 341, max: 351 });
  assert.deepEqual(labelled(closer), values(closer));
  assert.equal(plan.mapX(335), 30);
  assert.equal(plan.mapX(355), 490);
  // The thinning itself never draws a tick outside the window.
  const thinned = thinNumberLineTicks(bt20, planNumberLineTicks(bt20), window, WIDTH, [300, 410]);
  assert.ok(thinned.ticks.every((tick) => tick.value >= 335 && tick.value <= 355));
});

test("zoom limits: in until one tick is about 48 units wide, never finer ticks; out to the whole line", () => {
  const limits = numberLineZoomLimits(bt19, WIDTH);
  assert.ok(limits.zoomable);
  assert.ok(Math.abs(limits.minSpan - WIDTH / 48) < 1e-9, `the narrowest window is ${limits.minSpan}`);
  let window: NumberLineWindow = { min: 0, max: 70 };
  for (let press = 0; press < 20; press += 1) window = zoomNumberLineWindow(bt19, window, NUMBER_LINE_ZOOM.buttonFactor, 52, WIDTH);
  assert.ok(Math.abs(window.max - window.min - WIDTH / 48) < 1e-9, "zooming in stops at the limit");
  // At the limit no finer subdivision appears: the ticks are still whole numbers, about 48 units apart.
  const deepest = planNumberLineCard(bt19, undefined, window);
  assert.ok(deepest.ticks.every((tick) => Number.isInteger(tick.value)));
  assert.ok(Math.abs(deepest.mapX(50) - deepest.mapX(49) - 48) < 1e-6);
  for (let press = 0; press < 20; press += 1) window = zoomNumberLineWindow(bt19, window, 1 / NUMBER_LINE_ZOOM.buttonFactor, 52, WIDTH);
  assert.deepEqual(window, { min: 0, max: 70 }, "zooming out stops at the whole line");
  // A line already 48 units a tick or more cannot zoom.
  assert.equal(numberLineZoomLimits({ range: { min: 0, max: 4 }, ticks: { step: 1 } }, WIDTH).zoomable, false);
  // The limit is the smallest tick: quarters stop at a quarter about 48 units wide.
  assert.ok(Math.abs(numberLineZoomLimits({ range: { min: 0, max: 20 }, ticks: { step: 1, subdivisions: 4 } }, WIDTH).minSpan - WIDTH / 48 / 4) < 1e-9);
});

test("a window stays inside the range: clamped, panned and zoomed around a value that stays put", () => {
  const range = { min: 0, max: 70 };
  assert.deepEqual(clampNumberLineWindow(bt19, undefined, WIDTH), range);
  assert.deepEqual(clampNumberLineWindow(bt19, { min: -10, max: 5 }, WIDTH), { min: 0, max: 15 });
  assert.deepEqual(clampNumberLineWindow(bt19, { min: 65, max: 80 }, WIDTH), { min: 55, max: 70 });
  assert.deepEqual(clampNumberLineWindow(bt19, { min: -5, max: 90 }, WIDTH), range, "wider than the line is the whole line");
  const narrow = clampNumberLineWindow(bt19, { min: 40, max: 41 }, WIDTH);
  assert.ok(Math.abs(narrow.max - narrow.min - WIDTH / 48) < 1e-9, "narrower than the limit widens to it");
  assert.deepEqual(panNumberLineWindow(bt19, { min: 50, max: 60 }, 30, WIDTH), { min: 60, max: 70 }, "a pan stops at the end");
  assert.deepEqual(panNumberLineWindow(bt19, { min: 10, max: 20 }, -30, WIDTH), { min: 0, max: 10 });
  // The anchor keeps its place: 47 sat 47/70 of the way along, and still does.
  const zoomed = zoomNumberLineWindow(bt19, range, 2, 47, WIDTH);
  assert.ok(Math.abs(zoomed.max - zoomed.min - 35) < 1e-9);
  assert.ok(Math.abs((47 - zoomed.min) / 35 - 47 / 70) < 1e-9);
  // "+" and "−" zoom around the middle of the marked values in view, else the window's middle.
  assert.equal(numberLineZoomCentre(range, [47, 57]), 52);
  assert.equal(numberLineZoomCentre({ min: 0, max: 20 }, [47, 57]), 10);
  assert.equal(numberLineZoomCentre({ min: 50, max: 60 }, [47, 57]), 57);
});

test("a card keeps its height, and its line its height, in every window", () => {
  const moving = {
    range: { min: -17, max: 17 }, ticks: { step: 1 },
    points: [{ as: "start", value: -3, label: "起点", interaction: { kind: "drag", variable: "s" } }, { as: "end", value: 5, label: "终点" }],
    jumps: [{ as: "move", from: "start", by: 8, hops: true }],
  };
  const fractions = {
    title: "从 −1/2 出发", range: { min: -10, max: 10 }, ticks: { step: 1, subdivisions: 4, labels: "all" },
    points: [{ as: "start", value: "-1/2", label: "起点" }, { as: "end", value: "1/4", label: "终点" }],
  };
  const names = { range: { min: 0, max: 100 }, ticks: { step: 1 }, points: [{ as: "a", value: 30, label: "Start" }, { as: "b", value: 31, label: "End" }, { as: "c", value: 70, label: "Far" }] };
  for (const [name, content] of Object.entries({ bt19, bt20, moving, fractions, names })) {
    const rest = planNumberLineCard(content);
    const { min, max } = (content as unknown as NumberLineContent).range;
    const span = max - min;
    for (const share of [0.02, 0.2, 0.5]) for (const at of [0, 0.3, 0.6, 0.97]) {
      const start = min + at * span;
      const plan = planNumberLineCard(content, undefined, { min: start, max: start + share * span });
      assert.equal(plan.height, rest.height, `${name}: the card's height in window ${plan.window.min}..${plan.window.max}`);
      assert.equal(plan.lineY, rest.lineY, `${name}: the line's height in window ${plan.window.min}..${plan.window.max}`);
    }
  }
});

test("a point dragged on a zoomed line lands on the same stops as on the whole line, inside the window", () => {
  const grid = { range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4 } };
  const line = (window: NumberLineWindow) => ({ x0: 30, x1: 490, min: window.min, max: window.max, grid });
  const xOf = (window: NumberLineWindow, value: number) => 30 + (value - window.min) / (window.max - window.min) * 460;
  const whole = { min: 0, max: 2 }, zoomed = { min: 0.5, max: 1.2 };
  for (const target of [0.7, 0.74, 0.8, 0.9, 1.1]) {
    const atRest = numberLineDragValue(line(whole), xOf(whole, target));
    const inZoom = numberLineDragValue(line(zoomed), xOf(zoomed, target));
    assert.equal(inZoom, atRest, `dragging to ${target}`);
  }
  // Past the window's edge, the point stops at the last stop inside it (1.0, not 1.25).
  assert.equal(numberLineDragValue(line(zoomed), 600), 1);
  assert.equal(numberLineDragValue(line(zoomed), -100), 0.5);
  // On the whole line it stops at the range's ends, as before.
  assert.equal(numberLineDragValue(line(whole), 600), 2);
  assert.equal(numberLineDragValue(line(whole), -100), 0);
});
