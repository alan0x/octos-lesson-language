import test from "node:test";
import assert from "node:assert/strict";
import type { SemanticBoardState } from "../../core/src/index.js";
import {
  formatVariableValue,
  variableControlModels,
  VariableControlsView,
} from "../src/variable-controls.js";

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

test("slider input reports one semantic gesture around many updates", () => {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const input = {
    min: "",
    max: "",
    step: "",
    value: "0",
    type: "",
    setAttribute() {},
    addEventListener(name: string, listener: (event: any) => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
  };
  const output = { textContent: "" };
  const wrapper = {
    className: "",
    dataset: {} as Record<string, string>,
    append() {},
    querySelector(selector: string) {
      return selector === "input" ? input : selector === "output" ? output : undefined;
    },
    classList: { toggle() {} },
  };
  const fakeDocument = {
    createElement(tag: string) {
      if (tag === "label") return wrapper;
      if (tag === "input") return input;
      if (tag === "output") return output;
      return { className: "", textContent: "" };
    },
  };
  const container = {
    ownerDocument: fakeDocument,
    hidden: false,
    replaceChildren() {},
    querySelector() { return wrapper; },
  };
  const events: Array<{ phase: string; value: number }> = [];
  const view = new VariableControlsView(container as unknown as HTMLElement, (_alias, value, event) => {
    events.push({ phase: event.phase, value });
    if (event.phase === "start") return "gesture-1";
  });
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
      theta: { value: 0, initial: 0, min: 0, max: 6.28, control: { kind: "slider" as const, step: .01 } },
    },
  } satisfies SemanticBoardState;
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  try {
    view.render(board);
    listeners.get("keydown")?.[0]?.({ key: "ArrowRight" });
    input.value = "1";
    listeners.get("input")?.[0]?.({});
    input.value = "2";
    listeners.get("input")?.[0]?.({});
    listeners.get("keyup")?.[0]?.({});
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
  assert.deepEqual(events, [
    { phase: "start", value: 0 },
    { phase: "update", value: 1 },
    { phase: "update", value: 2 },
    { phase: "commit", value: 2 },
  ]);
});
