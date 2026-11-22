// Trading tens and ones (decision 0023): the tap rules (ported from the accepted sketch v3), content
// rules, the plan the view draws, the builder, and the card inside a lesson. Piles here are invented.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthoringSchema, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson,
  reduceCanonicalEvents, validateAuthoringLesson, type AuthoringLesson,
} from "../../core/src/index.js";
import { measureSemanticNode } from "../../web-runtime/src/layout.js";
import {
  BASE_TEN_TRADE_FEATURE, applyBaseTenTap, baseTenChanges, baseTenFacts, baseTenLooseAt, baseTenMat, baseTenRefusalText,
  baseTenTrayAt, planBaseTenTrade, validateBaseTenTradeContent, type BaseTenMat, type BaseTenTap,
} from "../src/base-ten-trade.js";
import { buildBaseTenTrade } from "../src/base-ten-trade-builder.js";

const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const valid = (content: unknown, options?: { boundValues?: boolean }) => validateBaseTenTradeContent(content, "$", fail, options);
const invalid = (content: unknown, pattern: RegExp, options?: { boundValues?: boolean }) => assert.throws(() => valid(content, options), pattern);

/** A pile as a question states it: hundreds, tens, loose ones. Three columns when it has hundreds or makes one. */
const pile = (h: number, t: number, o: number, columns?: 2 | 3) => {
  const cols = columns ?? (h > 0 || t * 10 + o >= 100 ? 3 : 2);
  return { columns: cols, places: [{ as: "ones", count: o }, { as: "tens", count: t }, ...(cols === 3 ? [{ as: "hundreds", count: h }] : [])] };
};
const mat = (h: number, t: number, o: number, columns?: 2 | 3): BaseTenMat => baseTenMat(pile(h, t, o, columns));

/** Applies taps, failing on a refusal. */
function tap(start: BaseTenMat, ...taps: BaseTenTap[]): BaseTenMat {
  let current = start;
  for (const one of taps) {
    const result = applyBaseTenTap(current, one);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    current = result.mat;
  }
  return current;
}
const times = (n: number, one: BaseTenTap): BaseTenTap[] => Array.from({ length: n }, () => one);
const refused = (start: BaseTenMat, one: BaseTenTap) => { const result = applyBaseTenTap(start, one); return result.ok ? "ok" : result.reason; };

test("tap rules: the tray holds ten, only exactly ten make a ten, and the learner makes every trade", () => {
  let m = mat(6, 9, 16);
  assert.equal(baseTenFacts(m).value, 706);
  assert.equal(baseTenFacts(m).no_trade_left, false);
  // Ten fit in the tray and no more.
  m = tap(m, ...times(10, { kind: "gather", place: 0 }));
  assert.deepEqual(m.trays, [10, 0]);
  assert.equal(refused(m, { kind: "gather", place: 0 }), "tray_full");
  // Nine do not make a ten; nothing changes.
  const nine = tap(m, { kind: "ungather", place: 0 });
  assert.equal(refused(nine, { kind: "make", place: 0 }), "tray_not_ten");
  assert.equal(refused(mat(6, 9, 16), { kind: "make", place: 0 }), "tray_empty");
  // Exactly ten make one ten.
  m = tap(m, { kind: "make", place: 0 });
  assert.deepEqual([m.counts, m.trays], [[6, 10, 6], [0, 0]]);
  assert.equal(baseTenFacts(m).no_trade_left, false, "ten tens: a trade is still left");
  m = tap(m, ...times(10, { kind: "gather", place: 1 }), { kind: "make", place: 1 });
  assert.deepEqual(m.counts, [6, 0, 7]);
  const facts = baseTenFacts(m);
  assert.deepEqual([facts.no_trade_left, facts.counts, facts.parts, facts.equation], [true, [7, 0, 6], [700, 0, 6], "706 = 700 + 0 + 6"]);
  // Pressing everything many times never trades without ten in the tray.
  let mash = mat(6, 9, 16);
  for (let i = 0; i < 40; i += 1) { const r = applyBaseTenTap(mash, { kind: "gather", place: 0 }); if (r.ok) mash = r.mat; }
  assert.equal(mash.trays[0], 10);
});

test("tap rules: two columns, a break into the empty tray, room on the mat", () => {
  let m = tap(mat(0, 2, 17), ...times(10, { kind: "gather", place: 0 }), { kind: "make", place: 0 });
  assert.deepEqual([baseTenFacts(m).digits, baseTenFacts(m).counts, baseTenFacts(m).equation], [2, [3, 7], "37 = 30 + 7"]);
  // Two columns: the tens have no tray, so a loose ten cannot be gathered.
  assert.equal(refused(m, { kind: "gather", place: 1 }), "no_tray");
  // A break puts ten ones in the empty tray, exactly where a trade would make them; making a ten again undoes it.
  const broken = tap(m, { kind: "break", place: 1 });
  assert.deepEqual([broken.counts, broken.trays], [[17, 2], [10]]);
  assert.equal(refused(broken, { kind: "break", place: 1 }), "tray_not_empty");
  assert.deepEqual(tap(broken, { kind: "make", place: 0 }).counts, [7, 3]);
  // A hundred breaks into ten tens in the tens tray.
  const hundred = tap(mat(1, 2, 3), { kind: "break", place: 2 });
  assert.deepEqual([hundred.counts, hundred.trays, baseTenFacts(hundred).value], [[3, 12, 0], [0, 10], 123]);
  // No room on the mat for ten more: refused.
  assert.equal(refused(mat(0, 5, 55, 2), { kind: "break", place: 1 }), "no_room");
  // The most the mat must draw: 6/19/59, a hundred broken, the tens taken out, five ones-trades: 34 tens.
  let most = tap(mat(6, 19, 59), { kind: "break", place: 2 }, ...times(10, { kind: "ungather", place: 1 }));
  for (let k = 0; k < 5; k += 1) most = tap(most, ...times(10, { kind: "gather", place: 0 }), { kind: "make", place: 0 });
  assert.deepEqual(most.counts, [9, 34, 5]);
  assert.equal(refused(most, { kind: "break", place: 2 }), "no_room");
  // A pile with nothing to trade is allowed: the learner must judge it.
  assert.equal(baseTenFacts(mat(0, 3, 5)).no_trade_left, true);
  // What changed in one tap, for the runtime to write to the bound variables.
  assert.deepEqual(baseTenChanges(mat(0, 3, 14), tap(mat(0, 3, 14), ...times(10, { kind: "gather", place: 0 }), { kind: "make", place: 0 })),
    [{ place: 0, field: "count", before: 14, after: 4 }, { place: 1, field: "count", before: 3, after: 4 }]);
  assert.equal(baseTenRefusalText("tray_not_ten", 0), "Fill the tray first: a ten is ten ones.");
  assert.equal(baseTenRefusalText("tray_full", 0), "The tray holds only ten.");
});

test("content rules: a starting pile, and each field's range at any value a variable can take", () => {
  valid(pile(0, 3, 14));
  valid(pile(6, 9, 16));
  valid(pile(0, 0, 16));
  valid({ ...pile(0, 3, 14), places: [{ as: "ones", count: 14, tray: 4 }, { as: "tens", count: 3 }] });
  invalid({ ...pile(0, 3, 14), columns: 4 }, /2 columns/);
  invalid({ columns: 2, places: [{ as: "tens", count: 3 }, { as: "ones", count: 1 }] }, /Place 1 is 'ones'/);
  invalid({ columns: 3, places: [{ as: "ones", count: 1 }, { as: "tens", count: 1 }] }, /lists 3 places/);
  invalid(pile(0, 2, 60), /count of ones is a whole number from 0 to 59/);
  invalid(pile(1, 20, 0), /count of tens is a whole number from 0 to 19/);
  invalid(pile(0, 2, 1.5), /whole number/);
  invalid(pile(9, 10, 0), /more than 9 hundreds/);
  invalid(pile(0, 9, 10, 2), /use 3 columns/);
  invalid({ columns: 2, places: [{ as: "ones", count: 3, tray: 4 }, { as: "tens", count: 1 }] }, /holds more than there are ones/);
  invalid({ columns: 2, places: [{ as: "ones", count: 3 }, { as: "tens", count: 1, tray: 0 }] }, /tens have no tray/);
  invalid({ ...pile(0, 3, 14), label: "x" }, /Unknown base-ten trade field 'label'/);
  // At a bound value only each field's own range applies: a full tray beside a small count is not refused here.
  valid({ columns: 2, places: [{ as: "ones", count: 3, tray: 10 }, { as: "tens", count: 1 }] }, { boundValues: true });
  valid(pile(9, 34, 59), { boundValues: true });
  invalid(pile(9, 35, 0), /from 0 to 34/, { boundValues: true });
});

test("the plan: every unit inside its column or tray at the most each place can reach, none overlapping", () => {
  for (const [columns, counts] of [[2, [59, 9, 0]], [3, [59, 34, 9]]] as const) {
    const plan = planBaseTenTrade({ columns });
    const U = plan.unit;
    const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (let p = 0; p < columns; p += 1) {
      const w = p === 2 ? 10 * U : U, h = p === 0 ? U : 10 * U;
      for (let i = 0; i < counts[p]!; i += 1) {
        const at = baseTenLooseAt(plan, p, i);
        boxes.push({ x: at.x, y: at.y, w, h });
        const column = plan.columns.find((c) => c.place === p)!;
        assert.ok(at.x >= column.x - 1e-9 && at.x + w <= column.x + column.width + 1e-9, `place ${p} unit ${i} in its column`);
        assert.ok(at.y >= plan.top && at.y + h <= plan.height, `place ${p} unit ${i} on the mat (${at.y + h} ≤ ${plan.height})`);
      }
    }
    const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9));
    assert.equal(overlap, false, `${columns} columns: no two loose units overlap`);
    for (const tray of plan.trays) {
      const w = tray.place === 0 ? U : U, h = tray.place === 0 ? U : 10 * U;
      for (let k = 0; k < 10; k += 1) {
        const at = baseTenTrayAt(plan, tray.place, k);
        const right = tray.place === 0 ? tray.x + U : tray.x + 10 * U;
        assert.ok(at.x >= tray.x - 1e-9 && at.x + w <= right + 1e-9 && at.y >= plan.top && at.y + h <= plan.top + 10 * U + 1e-9, `tray ${tray.place} slot ${k} inside the outline`);
      }
      // The buttons sit under the tray, inside its zone and on the mat.
      for (const box of [tray.make, tray.break]) {
        assert.ok(box.x >= tray.zoneX - 1e-9 && box.x + box.width <= tray.zoneX + tray.zoneWidth + 1e-9 && box.y + box.height <= plan.height);
      }
    }
    // Columns are named in words, never a count.
    assert.ok(plan.columns.every((column) => /^[A-Z][a-z]+$/.test(column.heading)));
  }
});

test("the builder binds each count and tray to its own variable and names the places", () => {
  const built = buildBaseTenTrade({
    as: "mat", role: "main_visual", place: { relation: "new_region" }, columns: 2,
    places: [{ count: { expression: "ones", initial: 17 }, tray: { expression: "tray_ones", initial: 0 } }, { count: { expression: "tens", initial: 2 } }],
  });
  const action = built.actions[0] as unknown as { kind: string; content: Record<string, unknown> };
  assert.equal(action.kind, "base_ten_trade");
  assert.deepEqual(action.content.places, [{ as: "ones", count: 17, tray: 0 }, { as: "tens", count: 2 }]);
  assert.deepEqual(action.content.bindings, [
    { target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" },
  ]);
  assert.deepEqual(built.parts, { whole: "mat", ones: "mat#ones", tens: "mat#tens" });
  valid(action.content);
});

const variables = [
  { as: "ones", initial: 17, min: 0, max: 59, label: "ones" },
  { as: "tray_ones", initial: 0, min: 0, max: 10, label: "ones in the tray" },
  { as: "tens", initial: 2, min: 0, max: 9, label: "tens" },
];
const boundMat = {
  columns: 2, places: [{ as: "ones", count: 17, tray: 0 }, { as: "tens", count: 2 }],
  bindings: [{ target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" }],
};

function lesson(content: Record<string, unknown>, vars: unknown[] = variables): AuthoringLesson {
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Trading tens and ones", goals: ["Ten ones make a ten"], variables: vars },
    steps: [{ key: "show", purpose: "See the pile", beats: [
      { key: "draw", say: "Here are 2 tens and 17 ones.", actions: [{ do: "write", as: "mat", kind: "base_ten_trade", role: "main_visual", content, place: { relation: "new_region" } }] },
      { key: "fill", say: "Ten ones go in the tray.", actions: [{ do: "animate", variable: "tray_ones", value: 10 }] },
    ] }],
    close: { summary: "Ten ones make a ten.", focus: ["mat"] },
  } as unknown as AuthoringLesson;
}
const host = { lessonId: "l", boardId: "b", baseRevision: 0, regionIntent: "new_topic" as const };

test("a base-ten trade card in a lesson: validated, bound values checked, and the math plugin 0.5.0 required", () => {
  const document = lesson(boundMat);
  assertAuthoringSchema(document);
  validateAuthoringLesson(document);
  const events = normalizeAuthoringLesson(document, host);
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes(BASE_TEN_TRADE_FEATURE));
  assert.ok(!requirements.requiredCapabilities.includes("node:base_ten_trade"));
  assert.deepEqual(requirements.requiredPlugins, { math: "0.5.0" });
  assert.doesNotThrow(() => assertExecutionSupported(events));
  // Places get canonical ids, so the bindings apply as the lesson plays (the tray fills to ten).
  const node = reduceCanonicalEvents(events).nodes["l:node:mat"]!;
  const places = node.content.places as Array<{ id: string; count: number; tray?: number }>;
  assert.equal(places[0]!.id, "l:node:mat:fragment:ones");
  assert.deepEqual([places[0]!.count, places[0]!.tray, places[1]!.count], [17, 10, 2]);
  assert.throws(() => assertExecutionSupported(events, undefined, undefined, {
    extensions: [{ plugin: { id: "math", version: "0.4.2" }, features: {} }],
  }), /requires the 'math' plugin 0.5.0; installed 0.4.2/);
  // A variable that can reach past what the mat draws is refused before playback.
  assert.throws(() => validateAuthoringLesson(lesson(boundMat, [variables[0], { ...variables[1], max: 11 }, variables[2]])), /tray_ones = 11.*tray is a whole number from 0 to 10/);
  // A three-column mat binds five variables; the fifth is checked too (review of #86).
  const three = (hundredsMax: number) => lesson({
    columns: 3, places: [{ as: "ones", count: 16, tray: 0 }, { as: "tens", count: 9, tray: 0 }, { as: "hundreds", count: 6 }],
    bindings: [{ target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "tray_ones" }, { target: "tens.count", expression: "tens" },
      { target: "tens.tray", expression: "tray_tens" }, { target: "hundreds.count", expression: "hundreds" }],
  }, [{ as: "ones", initial: 16, min: 0, max: 59 }, { as: "tray_ones", initial: 0, min: 0, max: 10 }, { as: "tens", initial: 9, min: 0, max: 34 },
    { as: "tray_tens", initial: 0, min: 0, max: 10 }, { as: "hundreds", initial: 6, min: 0, max: hundredsMax }]);
  validateAuthoringLesson(three(9));
  assert.throws(() => validateAuthoringLesson(three(12)), /hundreds = 12.*count of hundreds is a whole number from 0 to 9/);
  // Whatever a variable holds, the card never draws more of a place than the mat holds.
  assert.deepEqual(baseTenMat({ columns: 3, places: [{ as: "ones", count: 80 }, { as: "tens", count: 40 }, { as: "hundreds", count: 12 }] }).counts, [59, 34, 9]);
  // A starting pile that breaks the joint rules is refused.
  assert.throws(() => validateAuthoringLesson(lesson({ ...boundMat, places: [{ as: "ones", count: 3, tray: 4 }, { as: "tens", count: 2 }] })), /holds more than there are ones/);
  // Only counts and trays can be bound.
  assert.throws(() => validateAuthoringLesson(lesson({ ...boundMat, bindings: [{ target: "ones.columns", expression: "ones" }] })), /not a supported numeric field/);
});

test("the layout sizes the mat from its plan; three columns are wider", () => {
  const two = measureSemanticNode({ kind: "base_ten_trade", content: pile(0, 3, 14) });
  const three = measureSemanticNode({ kind: "base_ten_trade", content: pile(6, 9, 16) });
  assert.equal(two.width, 600);
  assert.equal(three.width, 860);
  assert.ok(two.height > 200 && three.height > 200);
});

test("a demonstration taps the card by its own rules: checked before playback in the state it meets, replayed atomically", () => {
  const taps = (n: number, tap: string, at: string) => Array.from({ length: n }, () => ({ do: "tap", target: "mat", tap, at }));
  const demo = (actions: unknown[], more: unknown[] = []) => ({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Trading tens and ones", goals: ["Ten ones make a ten"], variables },
    steps: [{ key: "show", purpose: "Watch a trade", beats: [
      { key: "draw", say: "Here are 2 tens and 17 ones.", actions: [{ do: "write", as: "mat", kind: "base_ten_trade", role: "main_visual", content: boundMat, place: { relation: "new_region" } }] },
      { key: "fill", say: "Put ones in the tray, one at a time.", actions },
      ...more,
    ] }],
    close: { summary: "Ten ones make a ten.", focus: ["mat"] },
  }) as unknown as AuthoringLesson;
  const lessonWithTrade = demo(taps(10, "gather", "ones"), [{ key: "make", say: "Ten ones make a ten.", actions: taps(1, "make", "ones") }]);
  assertAuthoringSchema(lessonWithTrade);
  validateAuthoringLesson(lessonWithTrade);
  const events = normalizeAuthoringLesson(lessonWithTrade, host);
  const tapActions = events.flatMap((event) => event.step?.beats.flatMap((beat) => beat.stage.during_speech) ?? []).filter((action) => action.op === "card.tap");
  assert.equal(tapActions.length, 11);
  assert.deepEqual(tapActions.at(-1)!.tap, { kind: "make", place: 0 });
  assert.equal(deriveExecutionRequirements(events).minimumPlayerVersion, "0.14.0");
  // The trade's three changes apply in one step: 2 tens and 17 ones become 3 tens and 7 ones.
  const values = reduceCanonicalEvents(events).variables!;
  assert.deepEqual([values.ones!.value, values.tray_ones!.value, values.tens!.value], [7, 0, 3]);
  // A tap the card would refuse at that point is refused before playback, with the card's reason.
  assert.throws(() => validateAuthoringLesson(demo([...taps(9, "gather", "ones"), ...taps(1, "make", "ones")])), /refuses this tap here: Fill the tray first: a ten is ten ones/);
  assert.throws(() => validateAuthoringLesson(demo(taps(11, "gather", "ones"))), /The tray holds only ten/);
  // Playback order: a tap written before an animation in the same beat but played after it meets the animated state.
  assert.throws(() => validateAuthoringLesson(demo([{ ...taps(1, "gather", "ones")[0], when: "after_speech" }, { do: "animate", variable: "ones", value: 0 }])), /no loose one/);
  // Only a base-ten trade card, as a whole, can be tapped.
  assert.throws(() => validateAuthoringLesson(demo([{ do: "tap", target: "mat#ones", tap: "gather", at: "ones" }])), /whole base_ten_trade card/);
  assert.throws(() => validateAuthoringLesson(demo([{ do: "tap", target: "mat", tap: "fold", at: "ones" }])), /Unknown tap 'fold'/);
});
