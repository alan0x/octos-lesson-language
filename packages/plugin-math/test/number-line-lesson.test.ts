// The number line inside a lesson (decision 0013): core validation, canonical
// ids, bindings, execution requirements and the learner's drag task.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthoringSchema, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson,
  reduceCanonicalEvents, validateAuthoringLesson, type AuthoringLesson,
} from "../../core/src/index.js";
import { MATH_PLUGIN_MANIFEST } from "../src/index.js";
import { NUMBER_LINE_PLUGIN_VERSION } from "../src/number-line.js";

const host = { lessonId: "l", boardId: "b", baseRevision: 0, regionIntent: "new_topic" as const };

function lesson(content: Record<string, unknown>, extra: Partial<AuthoringLesson["lesson"]> = {}): AuthoringLesson {
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: "zh-CN", title: "用数轴理解 3+(-5)", goals: ["把负数加法看成移动"],
      variables: [{ as: "change", initial: 0, min: -5, max: 0, label: "加上的数", control: { kind: "slider", step: 1 } }],
      ...extra,
    },
    steps: [{ key: "move", purpose: "向左移动", beats: [
      { key: "show", say: "从 3 出发。", actions: [{ do: "write", as: "line", kind: "number_line", role: "main_visual", content, place: { relation: "new_region" } }] },
      { key: "jump", say: "加上负 5，向左跳 5 格。", actions: [{ do: "animate", variable: "change", value: -5 }] },
    ] }],
    close: { summary: "3 加负 5 等于负 2。", focus: ["line"] },
  } as unknown as AuthoringLesson;
}

const integers = {
  title: "从 3 出发，加上 −5",
  range: { min: -6, max: 6 }, ticks: { step: 1 },
  points: [{ as: "start", value: 3, label: "起点" }],
  jumps: [{ as: "move", from: "start", by: -1, label: "+(−5)", hops: true }],
  bindings: [{ target: "move.by", expression: "change" }],
};

test("a number line lesson validates, and its jump is animated by the variable", () => {
  const document = lesson({ ...integers, jumps: [{ ...integers.jumps[0], by: 0.5, hops: false }] });
  assertAuthoringSchema(document);
  validateAuthoringLesson(document);
  const events = normalizeAuthoringLesson(document, host);
  const node = reduceCanonicalEvents(events).nodes["l:node:line"]!;
  const jump = (node.content.jumps as Array<{ id: string; from: string; by: number }>)[0]!;
  assert.equal(jump.id, "l:node:line:fragment:move");
  assert.equal(jump.from, "l:node:line:fragment:start", "the jump's start point gets the canonical id");
  assert.equal(jump.by, -5, "after the animation the jump moves by the variable's value");
});

test("a number line requires the math plugin's feature, not a core node feature", () => {
  const events = normalizeAuthoringLesson(lesson({ ...integers, jumps: [{ as: "move", from: "start", by: -5 }], bindings: undefined }), host);
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("plugin:math/number-line@1"));
  assert.ok(!requirements.requiredCapabilities.some((feature) => feature === "node:number_line"));
  assert.deepEqual(requirements.requiredPlugins, { math: "0.2.0" });
  assert.equal(MATH_PLUGIN_MANIFEST.version, NUMBER_LINE_PLUGIN_VERSION);
  assert.doesNotThrow(() => assertExecutionSupported(events));
  // A player without the math plugin, or with an older one, refuses the lesson before playback.
  assert.throws(() => assertExecutionSupported(events, undefined, undefined, { firstParty: false }), /requires the 'math' plugin 0.2.0, which is not installed/);
  assert.throws(() => assertExecutionSupported(events, undefined, undefined, {
    extensions: [{ plugin: { id: "math", version: "0.1.0" }, features: {} }],
  }), /requires the 'math' plugin 0.2.0; installed 0.1.0/);
});

test("lessons without a number line need no plugin", () => {
  const events = normalizeAuthoringLesson({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Words", goals: ["Say it"] },
    steps: [{ key: "s", purpose: "p", beats: [{ key: "b", say: "Hello.", actions: [{ do: "write", as: "t", kind: "text", role: "text", content: { text: "Hi" }, place: { relation: "new_region" } }] }] }],
    close: { summary: "Done.", focus: ["t"] },
  } as unknown as AuthoringLesson, host);
  assert.equal(deriveExecutionRequirements(events).requiredPlugins, undefined);
});

const fractions = (target: number) => ({
  variables: [{ as: "p", initial: 0, min: 0, max: 2, label: "点的位置" }],
  tasks: [{
    as: "place", prompt: "把点拖到 3/4。", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "variable_change", variable: "p", controls: ["number_line_point"] }],
    completion: { kind: "expression_target", expression: "p", value: target, tolerance: 0.01 },
    hints: ["数一数：每个大格分成四份。"],
  }],
});
const fourths = {
  range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4 },
  points: [{ as: "dot", value: 0, label: "你的点", interaction: { kind: "drag", variable: "p" } }],
  bindings: [{ target: "dot.value", expression: "p" }],
};

test("the learner drags a point onto a tick, judged by expression_target", () => {
  const document = lesson(fourths, fractions(0.75) as Partial<AuthoringLesson["lesson"]>);
  document.steps[0]!.beats.pop();
  assertAuthoringSchema(document);
  validateAuthoringLesson(document);
});

test("a drag task whose target is between ticks cannot be reached and is rejected", () => {
  const document = lesson(fourths, fractions(0.6) as Partial<AuthoringLesson["lesson"]>);
  document.steps[0]!.beats.pop();
  assert.throws(() => validateAuthoringLesson(document), /No reachable value/);
});

test("a draggable point must follow its variable", () => {
  const document = lesson({ ...fourths, bindings: undefined }, fractions(0.75) as Partial<AuthoringLesson["lesson"]>);
  document.steps[0]!.beats.pop();
  assert.throws(() => validateAuthoringLesson(document), /draggable point is bound to its variable/);
});

test("number line content errors surface as lesson validation errors", () => {
  assert.throws(() => validateAuthoringLesson(lesson({ range: { min: 0, max: 5 }, points: [{ as: "p", value: 9 }] })), /inside the line's range/);
  assert.throws(() => validateAuthoringLesson(lesson({ ...integers, bindings: [{ target: "move.size", expression: "change" }] })), /not a supported numeric field/);
});

test("the builder writes a number line whose driven values are bound and whose draggable point follows its variable", async () => {
  const { buildNumberLine } = await import("../src/index.js");
  const built = buildNumberLine({
    as: "line", role: "main_visual", place: { relation: "new_region" }, title: "3 + (−5)",
    range: { min: -6, max: 6 }, ticks: { step: 1 },
    points: [{ as: "start", value: 3, label: "起点" }, { as: "guess", value: 0, label: "你的答案", draggable: { variable: "p" } }],
    jumps: [{ as: "move", from: "start", by: { expression: "change", initial: -5 }, label: "+(−5)", hops: true }],
    intervals: [{ as: "left", from: null, to: "1/2", to_closed: false }],
  });
  assert.deepEqual(built.parts, { whole: "line", start: "line#start", guess: "line#guess", move: "line#move", left: "line#left" });
  const content = (built.actions[0] as unknown as { content: Record<string, any> }).content;
  assert.deepEqual(content.bindings, [{ target: "guess.value", expression: "p" }, { target: "move.by", expression: "change" }]);
  assert.equal(content.jumps[0].by, -5);
  assert.equal(content.jumps[0].from, "start");
  const document = {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: "zh-CN", title: "3 + (−5)", goals: ["看移动"],
      variables: [
        { as: "change", initial: -5, min: -5, max: 0, label: "加上的数" },
        { as: "p", initial: 0, min: -6, max: 6, label: "你的答案" },
      ],
    },
    steps: [{ key: "s", purpose: "p", beats: [{ key: "b", say: "从 3 出发，向左跳 5 格。", actions: built.actions }] }],
    close: { summary: "等于 −2。", focus: ["line"] },
  } as unknown as AuthoringLesson;
  assertAuthoringSchema(document);
  validateAuthoringLesson(document);
});
