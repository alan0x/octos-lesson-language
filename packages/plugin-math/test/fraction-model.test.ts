// The fraction model (decision 0021, amended): content rules, the plan the view draws, the builder,
// and the card inside a lesson (core validation, bound values, execution requirements). Fractions
// here are invented for the tests.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthoringSchema, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson,
  reduceCanonicalEvents, validateAuthoringLesson, type AuthoringLesson,
} from "../../core/src/index.js";
import { measureSemanticNode } from "../../web-runtime/src/layout.js";
import {
  FRACTION_MODEL_FEATURE, compareFractions, planFractionModel, shadedParts, simplestFraction, validateFractionModelContent,
  type FractionModelContent,
} from "../src/fraction-model.js";
import { buildFractionModel } from "../src/fraction-model-builder.js";

const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const valid = (content: unknown, options?: { boundValues?: boolean }) => validateFractionModelContent(content, "$", fail, options);
const invalid = (content: unknown, pattern: RegExp) => assert.throws(() => valid(content), pattern);

const bar = (numerator: number, denominator: number, more: Record<string, unknown> = {}): FractionModelContent =>
  ({ model: "bar", fractions: [{ as: "a", numerator, denominator, ...more }] }) as FractionModelContent;

test("content rules: what a fraction model can show", () => {
  valid(bar(3, 5));
  valid(bar(0, 5));
  valid(bar(7, 4)); // two wholes, by default
  valid(bar(1, 1));
  valid({ model: "circle", fractions: [{ as: "a", numerator: 5, denominator: 8 }, { as: "b", numerator: 2, denominator: 3 }], relation: "compare" });
  valid({ model: "bar", fractions: [{ as: "a", numerator: 2, denominator: 5 }, { as: "b", numerator: 4, denominator: 10 }], relation: "equivalent" });
  valid({ model: "grid", grid: { rows: 10, columns: 10 }, fractions: [{ as: "a", numerator: 37, denominator: 100 }] });
  valid(bar(1, 4, { split: 5, highlight: 1 }));
  valid(bar(15, 3, { wholes: 5 }));

  invalid(bar(1, 13), /denominator is a whole number from 1 to 12/);
  invalid(bar(1.5, 4), /whole number of parts/);
  invalid(bar(9, 4, { wholes: 2 }), /from 0 to 8/);
  invalid(bar(40, 4), /at most 8 wholes/);
  invalid(bar(1, 5, { split: 6 }), /at most 24 parts/);
  invalid(bar(1, 4, { split: 7 }), /split is a whole number from 2 to 6/);
  invalid(bar(1, 4, { split: 3, highlight: 4 }), /shaded parts only \(3 here\)/);
  invalid({ model: "bar", fractions: [{ as: "a", numerator: 2, denominator: 5 }, { as: "b", numerator: 3, denominator: 10 }], relation: "equivalent" }, /are equal/);
  invalid({ model: "bar", fractions: [{ as: "a", numerator: 2, denominator: 5 }, { as: "b", numerator: 3, denominator: 10 }] }, /compared or shown equivalent/);
  invalid({ ...bar(1, 2), relation: "compare" }, /needs two fractions/);
  invalid({ model: "grid", grid: { rows: 10, columns: 10 }, fractions: [{ as: "a", numerator: 3, denominator: 10 }] }, /cell count \(100\)/);
  invalid({ model: "grid", grid: { rows: 2, columns: 2 }, fractions: [{ as: "a", numerator: 1, denominator: 4, split: 2 }] }, /not split again/);
  invalid({ model: "grid", grid: { rows: 11, columns: 10 }, fractions: [{ as: "a", numerator: 1, denominator: 110 }] }, /row count is a whole number from 1 to 10/);
  invalid({ ...bar(1, 4), grid: { rows: 2, columns: 2 } }, /Only a grid model/);
  invalid({ ...bar(1, 4), label: "x" }, /Unknown fraction model field 'label'/);
  invalid({ ...bar(1, 4, {}), bindings: [{ target: "a.numerator", expression: "n" }] }, /needs its wholes written/);
  invalid({ ...bar(1, 4, { wholes: 1 }), relation: undefined, fractions: [{ as: "a", numerator: 1, denominator: 4, wholes: 1 }, { as: "b", numerator: 2, denominator: 8, wholes: 1 }], bindings: [{ target: "a.numerator", expression: "n" }] } as unknown as FractionModelContent, /compared or shown equivalent/);
  invalid({ model: "bar", fractions: [{ as: "a", numerator: 1, denominator: 4, wholes: 1 }, { as: "b", numerator: 2, denominator: 8 }], relation: "equivalent", bindings: [{ target: "a.numerator", expression: "n" }] }, /equivalence is fixed/);
  // A bound numerator may stop between whole numbers while it animates.
  valid({ ...bar(2.4, 4, { wholes: 1 }), bindings: [{ target: "a.numerator", expression: "n" }] });
  valid(bar(2.4, 4, { wholes: 1 }), { boundValues: true });
});

test("the plan shades whole parts only: a full turn is a disc, an empty fraction shades nothing", () => {
  const circle = (numerator: number, denominator: number) => planFractionModel({ model: "circle", fractions: [{ as: "a", numerator, denominator }] });
  const full = circle(4, 4).fractions[0]!.wholes[0]!;
  assert.equal(full.parts.length, 4);
  assert.ok(full.parts.every((part) => part.shaded));
  assert.deepEqual(full.outline.kind === "sector" && [full.outline.from, full.outline.to], [0, 360]);
  const empty = circle(0, 4).fractions[0]!.wholes[0]!;
  assert.ok(empty.parts.every((part) => !part.shaded));
  const one = circle(1, 1).fractions[0]!.wholes[0]!;
  assert.equal(one.parts.length, 1);
  assert.ok(one.parts[0]!.shape.kind === "sector" && one.parts[0]!.shape.to - one.parts[0]!.shape.from === 360);
  // A bound numerator between whole numbers shades the nearest whole number of parts.
  assert.equal(shadedParts({ numerator: 2.6, denominator: 4, wholes: 1 }), 3);
  assert.equal(shadedParts({ numerator: 2.4, denominator: 4, wholes: 1 }), 2);
  assert.equal(planFractionModel({ model: "bar", fractions: [{ as: "a", numerator: 2.6, denominator: 4, wholes: 1 }] }).fractions[0]!.numerator, 3);
});

test("the picture agrees with itself whatever a bound numerator does (review of #77)", () => {
  // A bound expression can peak between a slider's extremes (4 − |n − 1| is 4 at n = 1); the label is the
  // shaded count, never a value the parts cannot show, and the highlight never marks unshaded parts.
  const over = planFractionModel({ model: "bar", fractions: [{ as: "a", numerator: 4, denominator: 3, wholes: 1 }] }).fractions[0]!;
  assert.equal(over.numerator, 3);
  assert.equal(over.wholes[0]!.parts.filter((part) => part.shaded).length, 3);
  const under = planFractionModel({ model: "bar", fractions: [{ as: "a", numerator: -1, denominator: 3, wholes: 1 }] }).fractions[0]!;
  assert.equal(under.numerator, 0);
  const marked = planFractionModel({ model: "bar", fractions: [{ as: "a", numerator: 0, denominator: 4, wholes: 1, highlight: 2 }] }).fractions[0]!;
  assert.equal(marked.wholes[0]!.highlights.length, 0);
  // Normalized content names a fraction by id.
  assert.equal(planFractionModel({ model: "bar", fractions: [{ id: "l:node:m:fragment:b", numerator: 1, denominator: 2 }] }).fractions[0]!.id, "l:node:m:fragment:b");
});

test("the plan counts parts through the wholes, in order", () => {
  const plan = planFractionModel(bar(7, 4) as unknown as Record<string, unknown>);
  const wholes = plan.fractions[0]!.wholes;
  assert.equal(wholes.length, 2);
  assert.deepEqual(wholes.map((whole) => whole.parts.filter((part) => part.shaded).length), [4, 3]);
  const grid = planFractionModel({ model: "grid", grid: { rows: 10, columns: 10 }, fractions: [{ as: "a", numerator: 37, denominator: 100 }] });
  const cells = grid.fractions[0]!.wholes[0]!.parts;
  assert.equal(cells.length, 100);
  assert.equal(cells.filter((cell) => cell.shaded).length, 37);
  // Row by row from the top left: the 37th cell is the seventh of the fourth row.
  assert.ok(cells[36]!.shaded && !cells[37]!.shaded);
  assert.ok(cells[36]!.shape.kind === "rect" && cells[30]!.shape.kind === "rect" && cells[36]!.shape.y === cells[30]!.shape.y);
});

test("two fractions share one whole, and the relation is computed from the values", () => {
  const plan = planFractionModel({ model: "bar", fractions: [{ as: "a", numerator: 3, denominator: 4 }, { as: "b", numerator: 2, denominator: 3 }], relation: "compare" });
  const [a, b] = plan.fractions.map((fraction) => fraction.wholes[0]!.outline);
  assert.ok(a!.kind === "rect" && b!.kind === "rect" && a!.width === b!.width && a!.height === b!.height);
  assert.equal(plan.relation?.text, "3/4 > 2/3");
  const circles = planFractionModel({ model: "circle", fractions: [{ as: "a", numerator: 1, denominator: 8 }, { as: "b", numerator: 1, denominator: 4 }], relation: "compare" });
  const [c, d] = circles.fractions.map((fraction) => fraction.wholes[0]!.outline);
  assert.ok(c!.kind === "sector" && d!.kind === "sector" && c!.r === d!.r);
  assert.equal(circles.relation?.text, "1/8 < 1/4");
  const same = planFractionModel({ model: "bar", fractions: [{ as: "a", numerator: 2, denominator: 3 }, { as: "b", numerator: 4, denominator: 6 }], relation: "equivalent" });
  assert.equal(same.relation?.text, "2/3 = 4/6");
  assert.equal(compareFractions({ numerator: 6, denominator: 3 }, { numerator: 2, denominator: 1 }), "=");
  assert.deepEqual(simplestFraction({ numerator: 4, denominator: 6 }), { numerator: 2, denominator: 3 });
  // A one-fraction card has no relation line.
  assert.equal(planFractionModel(bar(1, 2) as unknown as Record<string, unknown>).relation, undefined);
});

test("splitting each part draws the cuts, and the highlight marks the smallest parts of one share", () => {
  // A third, each part cut into 4: one share is a twelfth.
  const plan = planFractionModel(bar(1, 3, { split: 4, highlight: 1 }) as unknown as Record<string, unknown>);
  const whole = plan.fractions[0]!.wholes[0]!;
  assert.equal(whole.splits.length, 3 * 3);
  assert.equal(whole.highlights.length, 1);
  const piece = whole.highlights[0]!, outline = whole.outline;
  assert.ok(piece.kind === "rect" && outline.kind === "rect" && Math.abs(piece.width * 12 - outline.width) < 1e-9);
  // Two wholes cut into thirds, a share of two thirds: both marked pieces lie in the first whole.
  const share = planFractionModel({ model: "bar", fractions: [{ as: "a", numerator: 2, denominator: 1, split: 3, highlight: 2 }] });
  assert.deepEqual(share.fractions[0]!.wholes.map((w) => w.highlights.length), [2, 0]);
  // Circles cut along radii.
  const pie = planFractionModel({ model: "circle", fractions: [{ as: "a", numerator: 1, denominator: 2, split: 3, highlight: 1 }] });
  assert.equal(pie.fractions[0]!.wholes[0]!.splits.length, 2 * 2);
  // A whole of one part is a disc: cut into 5, it needs all five radii, or it reads as four unequal sectors.
  const disc = planFractionModel({ model: "circle", fractions: [{ as: "a", numerator: 4, denominator: 1, split: 5 }] });
  assert.deepEqual(disc.fractions[0]!.wholes.map((whole) => whole.splits.length), [5, 5, 5, 5]);
  const bars = planFractionModel({ model: "bar", fractions: [{ as: "a", numerator: 1, denominator: 1, split: 5 }] });
  assert.equal(bars.fractions[0]!.wholes[0]!.splits.length, 4, "a bar's outline closes both ends");
  const slice = pie.fractions[0]!.wholes[0]!.highlights[0]!;
  assert.ok(slice.kind === "sector" && Math.abs(slice.to - slice.from - 60) < 1e-9);
});

test("the builder binds a driven numerator and names its parts", () => {
  const built = buildFractionModel({
    as: "pie", role: "main_visual", place: { relation: "new_region" }, model: "circle",
    fractions: [{ numerator: { expression: "n", initial: 3 }, denominator: 8, wholes: 1 }],
  });
  const action = built.actions[0] as unknown as { kind: string; content: FractionModelContent };
  assert.equal(action.kind, "fraction_model");
  assert.deepEqual(action.content.fractions, [{ as: "a", numerator: 3, denominator: 8, wholes: 1 }]);
  assert.deepEqual(action.content.bindings, [{ target: "a.numerator", expression: "n" }]);
  assert.deepEqual(built.parts, { whole: "pie", a: "pie#a", primary_control: "pie#a" });
  valid(action.content);
});

function lesson(content: Record<string, unknown>, variable = { as: "n", initial: 1, min: 0, max: 8, label: "涂色的份数", control: { kind: "slider", step: 1 } }): AuthoringLesson {
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "zh-CN", title: "八分之几", goals: ["认识分数"], variables: [variable] },
    steps: [{ key: "show", purpose: "看分数", beats: [
      { key: "draw", say: "把一个圆平均分成 8 份。", actions: [{ do: "write", as: "pie", kind: "fraction_model", role: "main_visual", content, place: { relation: "new_region" } }] },
      { key: "shade", say: "涂上 3 份。", actions: [{ do: "animate", variable: "n", value: 3 }] },
    ] }],
    close: { summary: "涂了八分之三。", focus: ["pie"] },
  } as unknown as AuthoringLesson;
}

const pie = { model: "circle", fractions: [{ as: "a", numerator: 1, denominator: 8, wholes: 1 }], bindings: [{ target: "a.numerator", expression: "n" }] };
const host = { lessonId: "l", boardId: "b", baseRevision: 0, regionIntent: "new_topic" as const };

test("a fraction model in a lesson: validated, bound values checked, and the math plugin 0.4.0 required", () => {
  const document = lesson(pie);
  assertAuthoringSchema(document);
  validateAuthoringLesson(document);
  const events = normalizeAuthoringLesson(document, host);
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes(FRACTION_MODEL_FEATURE));
  assert.ok(!requirements.requiredCapabilities.includes("node:fraction_model"));
  assert.deepEqual(requirements.requiredPlugins, { math: "0.4.0" });
  assert.doesNotThrow(() => assertExecutionSupported(events));
  // The fraction gets a canonical id, so its binding applies as the lesson plays (n animates to 3).
  const node = reduceCanonicalEvents(events).nodes["l:node:pie"]!;
  const fraction = (node.content.fractions as Array<{ id: string; numerator: number }>)[0]!;
  assert.equal(fraction.id, "l:node:pie:fragment:a");
  assert.equal(fraction.numerator, 3);
  assert.throws(() => assertExecutionSupported(events, undefined, undefined, {
    extensions: [{ plugin: { id: "math", version: "0.3.0" }, features: {} }],
  }), /requires the 'math' plugin 0.4.0; installed 0.3.0/);
  // A slider that can reach past what the wholes hold is refused before playback.
  assert.throws(() => validateAuthoringLesson(lesson(pie, { as: "n", initial: 1, min: 0, max: 9, label: "份数", control: { kind: "slider", step: 1 } })), /When n = 9: .*from 0 to 8/);
  // Only the numerator can be bound.
  assert.throws(() => validateAuthoringLesson(lesson({ ...pie, bindings: [{ target: "a.denominator", expression: "n" }] })), /not a supported numeric field/);
});

test("the layout sizes a fraction model from its plan", () => {
  const one = measureSemanticNode({ kind: "fraction_model", content: bar(3, 5) });
  const many = measureSemanticNode({ kind: "fraction_model", content: bar(30, 5) });
  assert.equal(one.width, 540);
  assert.ok(many.height > one.height * 3, `${many.height} vs ${one.height}`);
});
