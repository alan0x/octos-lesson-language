import test from "node:test";
import assert from "node:assert/strict";
import { NUMBER_LINE_FORM_LIMITS, numberLineFormProblem, numberLineFormValue } from "../src/number-line-form.js";

const code = (form: Parameters<typeof numberLineFormProblem>[0]) => numberLineFormProblem(form)?.code;

test("typed values: plain numbers as numbers, fractions as exact strings", () => {
  assert.equal(numberLineFormValue("−5"), -5);
  assert.equal(numberLineFormValue("0.5"), 0.5);
  assert.equal(numberLineFormValue("3/4"), "3/4");
  assert.equal(numberLineFormValue("1 1/2"), "1 1/2");
  assert.equal(numberLineFormValue("abc"), undefined);
});

test("the range, ticks and start, as Studio checked them before (one move)", () => {
  const ok = { range: [-6, 6] as const, subdivisions: 1, start: "3", moves: [{ by: "-5", hops: true }] };
  assert.equal(code(ok), undefined);
  assert.equal(code({ ...ok, range: [5, -5] }), "range");
  assert.equal(code({ ...ok, range: [0, 100] }), "range");
  assert.equal(code({ range: [0, 30], subdivisions: 12 }), "ticks");
  assert.equal(code({ range: [0, 2], subdivisions: 24, start: "5/24" }), undefined);
  assert.equal(code({ range: [0, 1], subdivisions: 25 }), "subdivisions");
  assert.equal(code({ ...ok, start: "9" }), "start");
  assert.equal(code({ range: [0, 10], subdivisions: 1, moves: [{ by: "2" }] }), "start_missing");
  assert.equal(code({ ...ok, moves: [{ by: "0" }] }), "move_value");
  assert.equal(code({ ...ok, moves: [{ by: "5" }] }), "move_outside");
  assert.equal(code({ range: [0, 40], subdivisions: 1, start: "0", moves: [{ by: "30", hops: true }] }), "hops");
  assert.equal(NUMBER_LINE_FORM_LIMITS.span, 40);
});

test("two or three moves: each starts where the one before lands", () => {
  // Make ten: 8 → 10 → 13, hop by hop.
  assert.equal(code({ range: [0, 20], subdivisions: 1, start: "8", moves: [{ by: "2", hops: true }, { by: "3", hops: true }] }), undefined);
  // The second move leaves the line from where the first landed.
  assert.deepEqual(numberLineFormProblem({ range: [0, 12], subdivisions: 1, start: "8", moves: [{ by: "2" }, { by: "3" }] }), { code: "move_outside", move: 2 });
  assert.deepEqual(numberLineFormProblem({ range: [0, 20], subdivisions: 1, start: "8", moves: [{ by: "2" }, { by: "x" }] }), { code: "move_value", move: 2 });
  assert.equal(code({ range: [0, 20], subdivisions: 1, start: "1", moves: [{ by: "1" }, { by: "1" }, { by: "1" }, { by: "1" }] }), "too_many_moves");
});

test("only the last move takes a slider, and hops only when every move goes one way", () => {
  assert.deepEqual(numberLineFormProblem({ range: [-10, 10], subdivisions: 1, start: "0", moves: [{ by: "2", slider: true }, { by: "3" }] }), { code: "slider_not_last", move: 1 });
  assert.equal(code({ range: [-10, 10], subdivisions: 1, start: "0", moves: [{ by: "2" }, { by: "3", slider: true }] }), undefined);
  // Up then down: the move that turns back is drawn raised, never hop by hop.
  assert.deepEqual(numberLineFormProblem({ range: [-10, 10], subdivisions: 1, start: "5", moves: [{ by: "4", hops: true }, { by: "-6" }] }), { code: "hops_turn_back", move: 1 });
  assert.equal(code({ range: [-10, 10], subdivisions: 1, start: "5", moves: [{ by: "4" }, { by: "-6" }] }), undefined);
  // A slider can turn either way.
  assert.equal(code({ range: [-10, 10], subdivisions: 1, start: "0", moves: [{ by: "2", hops: true }, { by: "3", slider: true }] }), "hops_turn_back");
});
