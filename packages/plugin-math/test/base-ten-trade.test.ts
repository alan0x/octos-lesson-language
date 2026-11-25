// Trading tens and ones (decision 0023): the tap rules (ported from the accepted sketch v3), content
// rules, the plan the view draws, the builder, and the card inside a lesson. Piles here are invented.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthoringSchema, assertDeclarationPlayable, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson,
  reduceCanonicalEvents, validateAuthoringLesson, type AuthoringLesson,
} from "../../core/src/index.js";
import { measureSemanticNode } from "../../web-runtime/src/layout.js";
import {
  BASE_TEN_TRADE_FEATURE, applyBaseTenTap, baseTenChanges, baseTenFacts, baseTenLooseAt, baseTenMat, baseTenRefusalText,
  BASE_TEN_TRADE_LANGUAGE_FEATURE, BASE_TEN_TRADE_SLIDER_FEATURE, BASE_TEN_WORDS, baseTenSliderMove, baseTenSliderReachable, baseTenSliderStop,
  baseTenHowTo, baseTenSliderTrack, baseTenTapReachable, baseTenTrayAt, planBaseTenTrade, validateBaseTenTradeContent, type BaseTenMat, type BaseTenTap,
} from "../src/base-ten-trade.js";
import { baseTenStepDelay, baseTenStepFrames } from "../src/base-ten-trade-view.js";
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
  // Done with fewer than ten left in the tray (first-use test): no place has ten or more, so no trade is left.
  const leftover = tap(mat(0, 2, 17), ...times(10, { kind: "gather", place: 0 }), { kind: "make", place: 0 }, ...times(7, { kind: "gather", place: 0 }));
  assert.deepEqual([leftover.counts, leftover.trays, baseTenFacts(leftover).no_trade_left], [[7, 3], [7], true]);
  // A full tray still leaves a trade: its place holds ten or more.
  assert.equal(baseTenFacts(tap(mat(0, 2, 17), ...times(10, { kind: "gather", place: 0 }))).no_trade_left, false);
  // A pile with nothing to trade is allowed: the learner must judge it.
  assert.equal(baseTenFacts(mat(0, 3, 5)).no_trade_left, true);
  // What changed in one tap, for the runtime to write to the bound variables.
  assert.deepEqual(baseTenChanges(mat(0, 3, 14), tap(mat(0, 3, 14), ...times(10, { kind: "gather", place: 0 }), { kind: "make", place: 0 })),
    [{ place: 0, field: "count", before: 14, after: 4 }, { place: 1, field: "count", before: 3, after: 4 }]);
  // Amendment 5: every pile taps can make, by an exact search. Its counts are those the sliders reach; trays vary too.
  const counts = (mats: BaseTenMat[], p: number) => [...new Set(mats.map((each) => each.counts[p]!))].sort((a, b) => a - b);
  assert.deepEqual(counts(baseTenTapReachable(mat(0, 3, 26)), 0), [6, 16, 26, 36, 46, 56]);
  assert.deepEqual(baseTenTapReachable(mat(0, 3, 26))[0], mat(0, 3, 26));
  assert.ok(baseTenTapReachable(mat(0, 3, 26)).every((each) => baseTenFacts(each).value === 56));
  for (const start of [mat(0, 3, 26), mat(1, 9, 26, 3), mat(0, 10, 6, 3), mat(6, 19, 59), mat(0, 0, 5)]) {
    const places = Array.from({ length: start.columns - 1 }, (_, p) => p);
    for (let p = 0; p < start.columns; p += 1) assert.deepEqual(counts(baseTenTapReachable(start), p), counts(baseTenSliderReachable(start, places), p));
  }
  // The mat says how it is used, in its language, for two or three columns (owner, 2026-11-24).
  assert.match(baseTenHowTo(pile(0, 3, 14)), /^Tap a block to put it in the tray.*Make a ten.*Break a ten.*I'm done\.$/);
  assert.match(baseTenHowTo(pile(1, 3, 14)), /Make a hundred.*Break a hundred/);
  assert.match(baseTenHowTo({ ...pile(0, 3, 14), language: "zh-CN" }), /^点一个方块.*「换成一个十」.*「拆开一个十」.*「我做完了」。$/);
  assert.match(baseTenHowTo({ ...pile(1, 3, 14), language: "zh-CN" }), /「换成一个百」/);
  assert.equal(baseTenRefusalText("tray_not_ten", 0), "This tray does not hold a ten: a ten is ten ones.");
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
  assert.throws(() => validateAuthoringLesson(demo([...taps(9, "gather", "ones"), ...taps(1, "make", "ones")])), /refuses this tap here: This tray does not hold a ten: a ten is ten ones/);
  assert.throws(() => validateAuthoringLesson(demo(taps(11, "gather", "ones"))), /The tray holds only ten/);
  // Playback order: a tap written before an animation in the same beat but played after it meets the animated state.
  assert.throws(() => validateAuthoringLesson(demo([{ ...taps(1, "gather", "ones")[0], when: "after_speech" }, { do: "animate", variable: "ones", value: 0 }])), /no loose one/);
  // Review of #89: a make that would push a count past its variable's range is refused (2 columns, 9 tens);
  // a tapped card's counts have no learner control but a slider that trades (amendment 4), live only in a task.
  const nineTens = demo([{ do: "animate", variable: "tens", value: 9 }, ...taps(10, "gather", "ones")], [{ key: "make", say: "Make a ten.", actions: taps(1, "make", "ones") }]);
  assert.throws(() => validateAuthoringLesson(nineTens), /would make tens 10, outside 0 to 9/);
  const slider = structuredClone(demo(taps(1, "gather", "ones")));
  (slider.lesson.variables as unknown as Array<Record<string, unknown>>)[0]!.control = { kind: "slider", step: 1 };
  assert.throws(() => validateAuthoringLesson(slider), /takes only a slider of step 10: each stop is one trade/);
  (slider.lesson.variables as unknown as Array<Record<string, unknown>>)[0]!.control = { kind: "slider", step: 10 };
  validateAuthoringLesson(slider);
  // Only a base-ten trade card, as a whole, can be tapped.
  assert.throws(() => validateAuthoringLesson(demo([{ do: "tap", target: "mat#ones", tap: "gather", at: "ones" }])), /whole base_ten_trade card/);
  assert.throws(() => validateAuthoringLesson(demo([{ do: "tap", target: "mat", tap: "fold", at: "ones" }])), /Unknown tap 'fold'/);
});

test("a mat speaks Chinese when its content says so (amendment 3); English stays the default, byte for byte", () => {
  // Whole sentences per language, for every refusal and place.
  assert.equal(baseTenRefusalText("tray_not_ten", 0, "zh-CN"), "托盘里还不是一个十：一个十是十个一。");
  assert.equal(baseTenRefusalText("tray_not_ten", 1, "zh-CN"), "托盘里还不是一个百：一个百是十个十。");
  assert.equal(baseTenRefusalText("tray_not_ten", 1), "This tray does not hold a hundred: a hundred is ten tens.");
  assert.equal(baseTenRefusalText("none_loose", 2, "zh-CN"), "没有散的百可以用了。");
  assert.equal(baseTenRefusalText("no_tray", 0, "zh-CN"), "这里不能这样做。");
  for (const language of ["en-US", "zh-CN"] as const) {
    const words = BASE_TEN_WORDS[language];
    assert.deepEqual([words.headings.length, words.put.length, words.take.length, words.refusal.none_loose.length], [3, 3, 3, 3]);
    // The card never draws a number (0023): no digit in any of its words, in either language.
    assert.ok(!/[0-9０-９]/u.test(JSON.stringify(words)));
    for (const sentences of Object.values(words.refusal) as Array<readonly string[]>) assert.ok(sentences.length >= 2 && sentences.every((each) => each.trim().length > 0));
  }
  const zh = planBaseTenTrade({ columns: 3, language: "zh-CN" });
  assert.deepEqual(zh.columns.map((column) => column.heading), ["百位", "十位", "个位"]);
  assert.deepEqual(zh.trays.map((tray) => [tray.label, tray.make.text, tray.break.text]), [["十个十是一个百", "← 换成一个百", "拆开一个百 →"], ["十个一是一个十", "← 换成一个十", "拆开一个十 →"]]);
  // The layout is the same in both languages: only the words change.
  const en = planBaseTenTrade({ columns: 3 });
  assert.deepEqual([zh.width, zh.height, zh.trays.map((tray) => tray.make.width)], [en.width, en.height, en.trays.map((tray) => tray.make.width)]);
  assert.deepEqual(en.columns.map((column) => column.heading), ["Hundreds", "Tens", "Ones"]);
  // The field is checked: only the two languages.
  const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
  assert.doesNotThrow(() => validateBaseTenTradeContent({ ...boundMat, language: "zh-CN" }, "$", fail));
  assert.throws(() => validateBaseTenTradeContent({ ...boundMat, language: "fr-FR" }, "$", fail), /language: A mat speaks en-US or zh-CN/);
  // The builder writes it only when asked, so an English lesson's bytes are unchanged.
  const input = { as: "mat", role: "main_visual", place: { relation: "new_region" as const }, columns: 2 as const, places: [{ count: 17 }, { count: 2 }] };
  assert.ok(!("language" in (buildBaseTenTrade(input).actions[0] as unknown as { content: object }).content));
  assert.equal((buildBaseTenTrade({ ...input, language: "zh-CN" }).actions[0] as unknown as { content: { language: string } }).content.language, "zh-CN");
  // A Chinese mat needs math 0.6.0; an English one still needs 0.5.0.
  const zhLesson = lesson({ ...boundMat, language: "zh-CN" });
  assertAuthoringSchema(zhLesson);
  validateAuthoringLesson(zhLesson);
  const events = normalizeAuthoringLesson(zhLesson, host);
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes(BASE_TEN_TRADE_LANGUAGE_FEATURE));
  assert.deepEqual(requirements.requiredPlugins, { math: "0.6.0" });
  assert.doesNotThrow(() => assertExecutionSupported(events));
  assert.deepEqual(deriveExecutionRequirements(normalizeAuthoringLesson(lesson(boundMat), host)).requiredPlugins, { math: "0.5.0" });
});

// Decision 0023 amendment 4: a slider on a place's count, each stop one trade by the card's own tap rules.
test("a slider stop is the taps a learner would make: down gathers ten and makes one, up breaks one and takes the ten out", () => {
  const start = mat(0, 3, 26);
  const value = (m: BaseTenMat) => baseTenFacts(m).value;
  // One stop down: the same pile as ten gathers and a make.
  const down = baseTenSliderStop(start, 0, -1);
  assert.ok(down.ok);
  assert.deepEqual(down.steps.map((step) => step.tap), [...times(10, { kind: "gather", place: 0 }), { kind: "make", place: 0 }]);
  assert.deepEqual(down.mat, tap(start, ...times(10, { kind: "gather", place: 0 }), { kind: "make", place: 0 }));
  assert.deepEqual([down.mat.counts, down.mat.trays, value(down.mat)], [[16, 4], [0], 56]);
  // Each step carries the mat it leaves: the last is the stop's.
  assert.deepEqual(down.steps.map((step) => step.mat.trays[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0]);
  // Two stops down in one move: two trades, in order.
  const two = baseTenSliderMove(start, 0, 6);
  assert.equal(two.steps.length, 22);
  assert.deepEqual([two.mat.counts, two.mat.trays, value(two.mat)], [[6, 5], [0], 56]);
  // One stop up: a break, then the ten taken out of the tray, loose.
  const up = baseTenSliderMove(two.mat, 0, 16);
  assert.deepEqual(up.steps.map((step) => step.tap), [{ kind: "break", place: 1 }, ...times(10, { kind: "ungather", place: 0 })]);
  assert.deepEqual(up.mat, tap(two.mat, { kind: "break", place: 1 }, ...times(10, { kind: "ungather", place: 0 })));
  assert.deepEqual([up.mat.counts, up.mat.trays, value(up.mat)], [[16, 4], [0], 56]);
  // A tray part filled by taps is topped up going down, and emptied before a break going up: empty after either.
  const three = tap(start, ...times(3, { kind: "gather", place: 0 }));
  const topped = baseTenSliderStop(three, 0, -1);
  assert.ok(topped.ok);
  assert.equal(topped.steps.filter((step) => step.tap.kind === "gather").length, 7);
  assert.deepEqual([topped.mat.counts, topped.mat.trays], [[16, 4], [0]]);
  const emptied = baseTenSliderStop(three, 0, 1);
  assert.ok(emptied.ok);
  assert.deepEqual(emptied.steps.slice(0, 4).map((step) => step.tap.kind), ["ungather", "ungather", "ungather", "break"]);
  assert.deepEqual([emptied.mat.counts, emptied.mat.trays], [[36, 2], [0]]);
});

test("a stop the rules refuse is not reachable: the slider settles on the nearest stop it can reach", () => {
  // No room past 59 ones: from 26 ones and 3 tens the stops up are 36, 46 and 56; 66 is refused.
  const start = mat(0, 3, 26);
  assert.deepEqual(baseTenSliderStop(mat(0, 0, 56), 0, 1), { ok: false, reason: "none_loose" });
  assert.deepEqual(baseTenSliderStop(mat(0, 1, 56), 0, 1), { ok: false, reason: "no_room" });
  assert.deepEqual(baseTenSliderMove(start, 0, 66).mat.counts, [56, 0]);
  assert.deepEqual(baseTenSliderMove(start, 0, 0).mat.counts, [6, 5]);
  assert.deepEqual(baseTenSliderMove(start, 0, 40).mat.counts, [36, 2], "the nearest stop to 40 is 36");
  // Fewer than ten: no stop down; no ten above: no stop up. The slider stays.
  assert.deepEqual(baseTenSliderMove(mat(0, 0, 5), 0, 15), { steps: [], mat: mat(0, 0, 5) });
  assert.deepEqual(baseTenSliderMove(mat(0, 4, 5), 0, -5).steps, []);
  // A make never leaves a place above what the mat draws: two columns stop at nine tens.
  assert.deepEqual(baseTenSliderStop({ columns: 2, counts: [15, 9], trays: [0] }, 0, -1), { ok: false, reason: "no_room" });
  // The highest place has no slider.
  assert.deepEqual(baseTenSliderStop(start, 1, -1), { ok: false, reason: "no_tray" });
  assert.deepEqual(baseTenSliderMove(start, 1, 0).steps, []);
});

test("a slider's track stops only where trades reach: 6, 16, 26 and up to the room; a three-column chain", () => {
  assert.deepEqual(baseTenSliderTrack(mat(0, 3, 26), 0), { min: 6, max: 56 });
  assert.deepEqual(baseTenSliderTrack(mat(0, 0, 26), 0), { min: 6, max: 26 });
  assert.deepEqual(baseTenSliderTrack(mat(0, 4, 5), 0), { min: 5, max: 45 });
  // Three columns: 1 hundred, 9 tens, 26 ones. Nine tens make no hundred, so the tens slider cannot go down;
  // up, a hundred breaks into ten tens.
  const chain = mat(1, 9, 26, 3);
  assert.deepEqual(baseTenSliderTrack(chain, 1), { min: 9, max: 19 });
  // Two ones trades make 11 tens; now the tens slider goes down to 1 and the hundreds go up by one.
  const traded = baseTenSliderMove(chain, 0, 6).mat;
  assert.deepEqual(traded.counts, [6, 11, 1]);
  assert.deepEqual(baseTenSliderTrack(traded, 1), { min: 1, max: 21 });
  const tens = baseTenSliderMove(traded, 1, 1);
  assert.deepEqual([tens.mat.counts, tens.mat.trays, baseTenFacts(tens.mat).value], [[6, 1, 2], [0, 0], 216]);
  // Every pile both sliders reach, by an exact search: 216 laid out every way the room allows.
  const piles = baseTenSliderReachable(chain, [0, 1]).map((m) => m.counts.join(","));
  assert.ok(piles.includes("6,1,2") && piles.includes("26,9,1") && piles.includes("56,6,1"));
  assert.ok(piles.every((counts) => { const [o, t, h] = counts.split(",").map(Number); return o! + 10 * t! + 100 * h! === 216; }));
  // A break needs room below: never more than 59 ones or, from a hundred, 29 tens.
  assert.ok(piles.includes("6,21,0") && piles.every((counts) => { const [o, t] = counts.split(",").map(Number); return o! <= 59 && t! <= 34; }));
  assert.deepEqual(baseTenSliderTrack(mat(0, 21, 6, 3), 1), { min: 1, max: 21 });
});

test("the view is given a step per tap of a slider's trades, each frame the mat that tap leaves", () => {
  const content = { columns: 2, places: [{ as: "ones", id: "l:node:mat:fragment:ones", count: 26, tray: 0 }, { as: "tens", id: "l:node:mat:fragment:tens", count: 3 }], bindings: [] };
  const move = baseTenSliderMove(baseTenMat(content), 0, 6);
  const frames = baseTenStepFrames(content, move.steps);
  assert.equal(frames.length, 22);
  assert.deepEqual(frames.map((frame) => frame.step.tap), move.steps.map((step) => step.tap));
  // Each frame is the card at that tap: the tray fills to ten, then ten ones become a ten, twice.
  assert.deepEqual(frames.map((frame) => baseTenMat(frame.content)), move.steps.map((step) => step.mat));
  assert.deepEqual(frames[10]!.content.places, [{ as: "ones", id: "l:node:mat:fragment:ones", count: 16, tray: 0 }, { as: "tens", id: "l:node:mat:fragment:tens", count: 4 }]);
  assert.equal(content.places[0]!.count, 26, "the content itself is not changed");
  // Gathers stream; the last lands before the make; a make fuses and moves before the next trade.
  assert.ok(baseTenStepDelay({ kind: "gather", place: 0 }, { kind: "gather", place: 0 }) < baseTenStepDelay({ kind: "gather", place: 0 }, { kind: "make", place: 0 }));
  assert.ok(baseTenStepDelay({ kind: "make", place: 0 }) > baseTenStepDelay({ kind: "gather", place: 0 }));
});

test("a lesson with a slider on a card's count needs math 0.7.0 (amendment 4); without one, still 0.5.0", () => {
  const slid = lesson(boundMat, [{ ...variables[0], control: { kind: "slider", step: 10 } }, variables[1], variables[2]]);
  assertAuthoringSchema(slid);
  validateAuthoringLesson(slid);
  const events = normalizeAuthoringLesson(slid, host);
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes(BASE_TEN_TRADE_SLIDER_FEATURE));
  assert.deepEqual(requirements.requiredPlugins, { math: "0.7.0" });
  // A player whose math plugin is 0.6.0 refuses it: that plugin would write the count directly.
  const declaration = { minimumPlayerVersion: requirements.minimumPlayerVersion, requiredCapabilities: requirements.requiredCapabilities };
  assert.throws(() => assertDeclarationPlayable(declaration, undefined, {
    extensions: [{ plugin: { id: "math", version: "0.6.0" }, features: { [BASE_TEN_TRADE_FEATURE]: "0.5.0", [BASE_TEN_TRADE_LANGUAGE_FEATURE]: "0.6.0" } }],
  }), /uses 'plugin:math\/base-ten-trade-slider@1', which the installed 'math' plugin 0.6.0 does not have/);
  assert.doesNotThrow(() => assertDeclarationPlayable(declaration));
  assert.ok(!deriveExecutionRequirements(normalizeAuthoringLesson(lesson(boundMat), host)).requiredCapabilities.includes(BASE_TEN_TRADE_SLIDER_FEATURE));
});
