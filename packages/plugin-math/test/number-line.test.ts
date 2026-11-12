import test from "node:test";
import assert from "node:assert/strict";
import {
  decimalPlaces, jumpEnds, jumpHops, numberLineValue, parseFraction, planNumberLineTicks, planTickStep, planTickLabels, snapToTick, stackLabels, validateNumberLineContent, visibleTickLabels,
  type NumberLineContent, type TickLabel,
} from "../src/number-line.js";

const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const valid = (content: unknown) => validateNumberLineContent(content, "/content", fail);
const invalid = (content: unknown, pattern: RegExp) => assert.throws(() => valid(content), pattern);
const show = (label?: TickLabel) => !label ? "" : label.kind === "text" ? label.text
  : `${label.negative ? "-" : ""}${label.whole !== undefined ? `${label.whole} ` : ""}${label.numerator}/${label.denominator}`;

test("fractions are exact: proper, negative and mixed", () => {
  assert.deepEqual(parseFraction("3/4"), { numerator: 3, denominator: 4 });
  assert.deepEqual(parseFraction("-5/2"), { numerator: -5, denominator: 2 });
  assert.deepEqual(parseFraction("1 1/2"), { numerator: 3, denominator: 2 });
  assert.equal(parseFraction("1/0"), undefined);
  assert.equal(parseFraction("0.75"), undefined);
  assert.equal(numberLineValue("1/3"), 1 / 3);
  assert.equal(numberLineValue(-2), -2);
  assert.equal(numberLineValue("abc"), undefined);
  assert.equal(numberLineValue(Number.NaN), undefined);
});

test("integer ticks from -6 to 6 label every whole number", () => {
  const ticks = planNumberLineTicks({ range: { min: -6, max: 6 }, ticks: { step: 1 } });
  assert.equal(ticks.length, 13);
  assert.deepEqual(ticks.map((tick) => show(tick.label)), ["−6", "−5", "−4", "−3", "−2", "−1", "0", "1", "2", "3", "4", "5", "6"]);
});

test("fourths are labelled as unreduced fractions, wholes as integers", () => {
  const ticks = planNumberLineTicks({ range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4, labels: "all" } });
  assert.deepEqual(ticks.map((tick) => show(tick.label)), ["0", "1/4", "2/4", "3/4", "1", "5/4", "6/4", "7/4", "2"]);
  assert.deepEqual(ticks.map((tick) => tick.major), [true, false, false, false, true, false, false, false, true]);
  const mixed = planNumberLineTicks({ range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4, labels: "all", format: "mixed" } });
  assert.deepEqual(mixed.map((tick) => show(tick.label)).slice(4), ["1", "1 1/4", "1 2/4", "1 3/4", "2"]);
  const majorsOnly = planNumberLineTicks({ range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4 } });
  assert.deepEqual(majorsOnly.filter((tick) => tick.label).map((tick) => show(tick.label)), ["0", "1", "2"]);
});

test("decimal ticks, and a default step of about ten intervals", () => {
  assert.equal(planTickStep({ range: { min: 0, max: 100 } }), 10);
  assert.equal(planTickStep({ range: { min: -3, max: 3 } }), 1);
  const ticks = planNumberLineTicks({ range: { min: 0, max: 1 }, ticks: { step: 0.1 } });
  assert.deepEqual(ticks.map((tick) => show(tick.label)), ["0", "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "1"]);
});

test("3 + (−5): the program computes where the jump ends", () => {
  const content: NumberLineContent = {
    range: { min: -6, max: 6 }, ticks: { step: 1 },
    points: [{ as: "start", value: 3, label: "起点" }],
    jumps: [{ as: "move", from: "start", by: -5, label: "+(−5)", hops: true }],
  };
  valid(content);
  assert.deepEqual(jumpEnds(content, content.jumps![0]!), { from: 3, to: -2 });
});

test("an inequality's solution set: closed at −2, unbounded to the right", () => {
  valid({ range: { min: -5, max: 5 }, intervals: [{ as: "solution", from: -2, to: null, from_closed: true, label: "x ≥ −2" }] });
  invalid({ range: { min: -5, max: 5 }, intervals: [{ as: "s", from: -2, to: null, to_closed: true }] }, /unbounded end cannot be closed/);
  invalid({ range: { min: -5, max: 5 }, intervals: [{ as: "s", from: 3, to: 1 }] }, /smaller value to a larger/);
});

test("content rules reject what the line cannot draw", () => {
  invalid({ range: { min: 2, max: 2 } }, /min < max/);
  invalid({ range: { min: "1/2", max: 5 } }, /given as numbers/);
  invalid({ range: { min: 0, max: 1000 }, ticks: { step: 1 } }, /more than 240/);
  invalid({ range: { min: 0, max: 5 }, points: [{ as: "p", value: 7 }] }, /inside the line's range/);
  invalid({ range: { min: 0, max: 5 }, points: [{ as: "p", value: "0.5" }] }, /exact fraction/);
  invalid({ range: { min: -6, max: 6 }, points: [{ as: "a", value: 3 }], jumps: [{ as: "j", from: "a", by: 5 }] }, /starts and ends inside/);
  invalid({ range: { min: -6, max: 6 }, jumps: [{ as: "j", from: "missing", by: 1 }] }, /not a point of this number line/);
  invalid({ range: { min: 0, max: 2 }, ticks: { subdivisions: 4 }, jumps: [{ as: "j", from: 0, by: "1/3", hops: true }] }, /whole number of the smallest ticks/);
  invalid({ range: { min: 0, max: 5 }, ticks: { step: 0.5, format: "fraction" } }, /whole-number major step/);
  invalid({ range: { min: 0, max: 5 }, colour: "red" }, /Unknown number line field 'colour'/);
  invalid({ range: { min: 0, max: 5 }, points: [{ as: "p", value: 1, interaction: { kind: "tap", variable: "p" } }] }, /interaction/);
});

test("a dragged point snaps to the smallest tick and stays on the line", () => {
  const content = { range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4 } };
  assert.equal(snapToTick(content, 0.7), 0.75);
  assert.equal(snapToTick(content, 1.1), 1);
  assert.equal(snapToTick(content, -3), 0);
  assert.equal(snapToTick(content, 9), 2);
});

test("decimal labels keep the places the step needs: quarters are 0.25 and 0.75, not 0.3 and 0.8", () => {
  assert.deepEqual([0.25, 0.5, 2, 0.125, 0.1, 1 / 3].map(decimalPlaces), [2, 1, 0, 3, 1, 3]);
  const quarters = planNumberLineTicks({ range: { min: 0, max: 1 }, ticks: { step: 0.25 } });
  assert.deepEqual(quarters.map((tick) => show(tick.label)), ["0", "0.25", "0.5", "0.75", "1"]);
  const subdivided = planNumberLineTicks({ range: { min: 0, max: 1 }, ticks: { step: 1, subdivisions: 4, labels: "all", format: "decimal" } });
  assert.deepEqual(subdivided.map((tick) => show(tick.label)), ["0", "0.25", "0.5", "0.75", "1"]);
  const negative = planNumberLineTicks({ range: { min: -1, max: 0 }, ticks: { step: 0.25 } });
  assert.deepEqual(negative.map((tick) => show(tick.label)), ["−1", "−0.75", "−0.5", "−0.25", "0"]);
});

test("dense labels thin out on a regular stride that fits; every tick stays", () => {
  // The review's case: −5 to 5 in fourths, every label asked for, on the 460-unit axis.
  const content = { range: { min: -5, max: 5 }, ticks: { step: 1, subdivisions: 4, labels: "all" as const } };
  const ticks = planNumberLineTicks(content);
  assert.equal(ticks.length, 41);
  const mapX = (value: number) => 30 + (value + 5) / 10 * 460;
  const width = (label: TickLabel) => label.kind === "text" ? label.text.length * 7.2 : 18 + (label.negative ? 8 : 0);
  const boxes = ticks.map((tick) => ({ x: mapX(tick.value), width: width(tick.label!), major: tick.major, value: tick.value }));
  const shown = [...visibleTickLabels(boxes, 1)].sort((a, b) => a - b);
  const kept = shown.map((index) => boxes[index]!);
  for (let index = 1; index < kept.length; index += 1) {
    assert.ok(kept[index]!.x - kept[index]!.width / 2 - (kept[index - 1]!.x + kept[index - 1]!.width / 2) >= 6, "no two shown labels overlap");
  }
  assert.ok(kept.some((box) => box.value === 0), "0 keeps its label");
  assert.ok(kept.every((box) => box.major), "the fourths' labels are dropped together when they cannot all fit");
  // A roomy line keeps them all.
  const roomy = planNumberLineTicks({ range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4, labels: "all" } });
  const roomyBoxes = roomy.map((tick) => ({ x: 30 + tick.value / 2 * 460, width: width(tick.label!), major: tick.major, value: tick.value }));
  assert.equal(visibleTickLabels(roomyBoxes, 1).size, roomy.length);
});

// Boxes for a line on the 460-unit axis, as the view plans them.
const labelBoxes = (content: Pick<NumberLineContent, "range" | "ticks">) => {
  const { min, max } = content.range;
  const width = (label: TickLabel) => label.kind === "text" ? label.text.length * 7.2 : 18 + (label.negative ? 8 : 0);
  return planNumberLineTicks(content).filter((tick) => tick.label)
    .map((tick) => ({ x: 30 + (tick.value - min) / (max - min) * 460, width: width(tick.label!), major: tick.major, value: tick.value }));
};
const drawn = (boxes: ReturnType<typeof labelBoxes>, plan: ReturnType<typeof planTickLabels>) =>
  [...plan.shown].sort((a, b) => a - b).map((index) => ({ ...boxes[index]!, row: plan.rows.get(index)! }));
const noOverlap = (labels: ReturnType<typeof drawn>) => {
  for (const row of new Set(labels.map((label) => label.row))) {
    const inRow = labels.filter((label) => label.row === row);
    for (let index = 1; index < inRow.length; index += 1) {
      assert.ok(inRow[index]!.x - inRow[index]!.width / 2 - (inRow[index - 1]!.x + inRow[index - 1]!.width / 2) >= 6, `labels ${inRow[index - 1]!.value} and ${inRow[index]!.value} overlap in row ${row}`);
    }
  }
};

test("thinning never hides the value a point sits on", () => {
  // Run 4's NL-05 shape: a line from −17 to 17 thins to every 5, so an end at 7 has no number of its own.
  const boxes = labelBoxes({ range: { min: -17, max: 17 }, ticks: { step: 1 } });
  const stride = drawn(boxes, planTickLabels(boxes, 1, []));
  assert.deepEqual(stride.map((label) => label.value), [-15, -10, -5, 0, 5, 10, 15], "thinned on a stride people count by");
  const labels = drawn(boxes, planTickLabels(boxes, 1, [-3, 7]));
  assert.ok(labels.some((label) => label.value === 7 && label.row === 0) && labels.some((label) => label.value === -3));
  assert.ok(labels.some((label) => label.value === 0), "0 keeps its label when no mark crowds it");
  noOverlap(labels);
  // Unmarked, the plan is the stride alone.
  assert.deepEqual([...planTickLabels(boxes, 1, []).shown], [...visibleTickLabels(boxes, 1)]);
});

test("marked labels that would collide take further rows; a marked value wins over 0", () => {
  const boxes = labelBoxes({ range: { min: -21, max: 18 }, ticks: { step: 1 } });
  const close = planTickLabels(boxes, 1, [-3, -2, -1]);
  const labels = drawn(boxes, close);
  for (const value of [-3, -2, -1]) assert.ok(labels.some((label) => label.value === value), `${value} is labelled`);
  assert.ok(close.rowCount >= 2, "neighbouring marks cannot share one row on a 39-unit line");
  noOverlap(labels);
  const nearZero = drawn(boxes, planTickLabels(boxes, 1, [1]));
  assert.ok(nearZero.some((label) => label.value === 1));
  noOverlap(nearZero);
});

test("labels that must all be drawn take the first row where they clear the others", () => {
  // Run 4's NL-04: Start at 0 and End at 1/4 on a 4-unit line, 29 units apart.
  assert.deepEqual(stackLabels([{ x: 145, width: 36 }, { x: 174, width: 22 }]), [0, 1]);
  assert.deepEqual(stackLabels([{ x: 100, width: 30 }, { x: 300, width: 30 }]), [0, 0]);
  // A third label back in row 0 once it clears the first; order given is kept.
  assert.deepEqual(stackLabels([{ x: 160, width: 30 }, { x: 130, width: 30 }, { x: 100, width: 30 }]), [0, 1, 0]);
});

test("a marked value on a tick the policy leaves unlabelled stays unlabelled", () => {
  // Fourths under the default "major" labels: dragging to 3/4 stays a task of reading the ticks.
  const boxes = labelBoxes({ range: { min: -10, max: 10 }, ticks: { step: 1, subdivisions: 4 } });
  const labels = drawn(boxes, planTickLabels(boxes, 1, [0.75]));
  assert.ok(!labels.some((label) => label.value === 0.75));
  noOverlap(labels);
});

test("integer labels never round a fraction tick: the combination is rejected, and the planner leaves such ticks unlabelled", () => {
  // The review's case: fourths with integer labels on every tick.
  invalid({ range: { min: 0, max: 1 }, ticks: { step: 1, subdivisions: 4, labels: "all", format: "integer" } }, /Integer labels on every tick need whole-number ticks/);
  valid({ range: { min: 0, max: 1 }, ticks: { step: 1, subdivisions: 4, labels: "major", format: "integer" } });
  const ticks = planNumberLineTicks({ range: { min: 0, max: 1 }, ticks: { step: 1, subdivisions: 4, labels: "all", format: "integer" } });
  assert.deepEqual(ticks.map((tick) => show(tick.label)), ["0", "", "", "", "1"]);
});

test("a jump that stops between ticks is drawn as whole hops and a shorter last hop ending at its end", () => {
  const content = { range: { min: 0, max: 4 }, ticks: { step: 1 } };
  const pieces = jumpHops(content, { from: 0, to: 2.6 }, true);
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces.slice(0, 2), [{ from: 0, to: 1 }, { from: 1, to: 2 }]);
  assert.equal(pieces[2]!.from, 2);
  assert.ok(Math.abs(pieces[2]!.to - 2.6) < 1e-12, "the arrow ends at 2.6, not 3");
  assert.deepEqual(jumpHops(content, { from: 3, to: 1 }, true), [{ from: 3, to: 2 }, { from: 2, to: 1 }]);
  assert.deepEqual(jumpHops(content, { from: 0, to: 0.4 }, true), [{ from: 0, to: 0.4 }]);
  assert.deepEqual(jumpHops(content, { from: 0, to: 2.6 }, false), [{ from: 0, to: 2.6 }]);
});

test("each unit splits into up to 24 parts, so 2/3 and 3/5 share fifteenths (0016)", () => {
  valid({ range: { min: 0, max: 1 }, ticks: { step: 1, subdivisions: 15, labels: "all" }, points: [{ as: "a", value: "2/3" }, { as: "b", value: "3/5" }] });
  valid({ range: { min: 0, max: 1 }, ticks: { step: 1, subdivisions: 24 } });
  invalid({ range: { min: 0, max: 1 }, ticks: { step: 1, subdivisions: 25 } }, /from 1 to 24/);
});

