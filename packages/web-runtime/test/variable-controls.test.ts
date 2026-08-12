import test from "node:test";
import assert from "node:assert/strict";
import type { SemanticBoardState } from "../../core/src/index.js";
import { formatVariableValue, variableControlModels } from "../src/variable-controls.js";

test("variable controls expose only explicitly controllable lesson variables", () => {
  const board = {
    board_id: "board",
    revision: 0,
    nodes: {},
    connections: {},
    groups: {},
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
    variables: {
      theta: { value: Math.PI / 2, initial: 0, min: 0, max: 2 * Math.PI, label: "旋转角 θ", unit: "rad", control: { kind: "slider" as const, step: .01 } },
      hidden: { value: 1, initial: 1, min: 0, max: 2 },
    },
  } satisfies SemanticBoardState;
  assert.deepEqual(variableControlModels(board), [{
    alias: "theta",
    label: "旋转角 θ",
    value: Math.PI / 2,
    min: 0,
    max: 2 * Math.PI,
    step: .01,
    unit: "rad",
  }]);
});

test("radian controls display familiar multiples of pi", () => {
  assert.equal(formatVariableValue(0, "rad"), "0");
  assert.equal(formatVariableValue(Math.PI / 2, "rad"), "π/2");
  assert.equal(formatVariableValue(3 * Math.PI / 2, "rad"), "3π/2");
  assert.equal(formatVariableValue(2 * Math.PI, "rad"), "2π");
});
