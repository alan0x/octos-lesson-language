// Making ten to add on two ten frames (decision 0027): the rules, the invariants and the demonstration ported from
// the accepted sketch (handoff runs/early-number/K2N-19/sketch/test-model.mjs: every check but the typed reader's,
// which the player's numeric_row replaces), then the card's content rules, state, facts, words, row, plan and
// builder. The sketch kept one signed count; the card keeps `moved` (the giver's counters in the bigger frame),
// which is the sketch's count without its sign, since the bigger frame is the one that fills. Numbers are the sketch's.
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/make-ten.js";
import {
  MAKE_TEN_WORDS, applyMakeTenTap, makeTenFacts, makeTenHowTo, makeTenInstruction, makeTenPlain, makeTenRefusalText, makeTenRow, makeTenState,
  makeTenStepSentences, planMakeTen, validateMakeTenContent, type MakeTenContent, type MakeTenProblem, type MakeTenState,
} from "../src/make-ten.js";
import { buildMakeTen } from "../src/make-ten-builder.js";
import * as math from "../src/index.js";
import { assertAuthoringSchema, validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import { MAKE_TEN_PROBLEMS, MAKE_TEN_REFUSED } from "./make-ten-fixtures.js";

// ---------------------------------------------------------------- the sketch's model checks (test-model.mjs)

// `ported` counts only the checks that are the sketch's own, one for one (its test-model.mjs counted 469: 9 for
// its typed reader and 5 for its typed row are the player's, so 455 are ported). Checks the sketch did not have
// use `eqNew` / `okNew`, and the exhaustive walk's per-state checks are plain asserts, as in the sketch.
let ported = 0;
const eq = (actual: unknown, expected: unknown, what: string) => { assert.deepEqual(actual, expected, what); ported += 1; };
const ok = (cond: boolean, what: string) => { assert.ok(cond, what); ported += 1; };
const eqNew = (actual: unknown, expected: unknown, what: string) => assert.deepEqual(actual, expected, what);
const okNew = (cond: boolean, what: string) => assert.ok(cond, what);
const prob = (a: number, b: number) => m.makeTenMakeProblem(a, b) as MakeTenProblem & { fault?: m.MakeTenFault };
const P = (a: number, b: number): MakeTenProblem => m.makeTenProblemOf(a, b);
const reason = (r: m.MakeTenResult) => (r.ok ? undefined : r.reason);
/** The sketch's tap(state, frame, kind): "home" is `give`, "visitor" is `back`. */
const tap = (state: MakeTenState, frame: number, kind: "home" | "visitor") => applyMakeTenTap(state, { tap: kind === "home" ? "give" : "back", place: frame });
const run = (state: MakeTenState, ...taps: Array<[number, "home" | "visitor"]>): MakeTenState => taps.reduce((s, [f, kind]) => {
  const r = tap(s, f, kind);
  assert.ok(r.ok, `tap(${f}, ${kind}) refused: ${reason(r)}`);
  return r.state;
}, state);
/** The sketch's signed count: positive into frame 0, negative into frame 1. */
const signed = (state: MakeTenState) => (state.problem.big === 0 ? state.moved : -state.moved);

test("sketch: the card's shape, two numbers 1–9 with a sum over ten", () => {
  eq(prob(8, 6), { a: 8, b: 6, sum: 14, left: 4, big: 0 }, "8 + 6");
  eq(prob(3, 8).big, 1, "3 + 8: the bigger addend's frame is the second");
  eq(prob(7, 7).big, 0, "equal addends: the first frame");
  eq(prob(6, 3).fault, "under_ten", "6 + 3: no ten to make");
  eq(prob(7, 3).fault, "exactly_ten", "7 + 3: partners of ten, another need");
  eq(prob(12, 5).fault, "not_one_digit", "12 + 5");
  eq(prob(0, 9).fault, "not_one_digit", "0 + 9");
  eq(prob(10, 4).fault, "not_one_digit", "10 + 4");
  eq(m.makeTenMakeProblem("x", 4), { fault: "unreadable" }, "unreadable");
  eq(m.makeTenPracticeFault(P(8, 6), 6, 8), "same_pair", "practice must be a different pair, either order");
  eq(m.makeTenPracticeFault(P(8, 6), 5, 4), "under_ten", "practice fits the same shape");
  eq(m.makeTenPracticeFault(P(8, 6), 7, 5), undefined, "7 + 5 is a good practice pair for 8 + 6");
  let shapes = 0;
  for (let a = 0; a <= 12; a += 1) for (let b = 0; b <= 12; b += 1) {
    const fits = a >= 1 && a <= 9 && b >= 1 && b <= 9 && a + b > 10;
    ok(!m.makeTenFault(a, b) === fits, `shape ${a} + ${b}`); shapes += 1;
  }
  eq(shapes, 169, "every pair 0–12 checked against the one-line rule");
});

test("sketch: the first screen, each addend at home, nothing crossed", () => {
  const s = m.makeTenStart(P(8, 6));
  eq([m.makeTenFrame(s, 0), m.makeTenFrame(s, 1)], [{ home: 8, visitors: 0, count: 8, empty: 2 }, { home: 6, visitors: 0, count: 6, empty: 4 }], "8 and 6 apart");
  eq([m.makeTenFilling(s.problem), m.makeTenComplete(s), m.makeTenCount(s)], [0, false, 8], "the 8's frame is the one a teacher fills; not done");
});

test("sketch: taps", () => {
  let s = m.makeTenStart(P(8, 6));
  const r = tap(s, 1, "home");
  assert.ok(r.ok);
  eq([r.to, m.makeTenFrame(r.state, 0).visitors, m.makeTenFrame(r.state, 1).home], [0, 1, 5], "a blue counter crosses into the 8's frame");
  eq(reason(tap(r.state, 0, "home")), "stays", "the filling frame keeps its own counters");
  eq(reason(tap(m.makeTenStart(P(8, 6)), 0, "home")), "stays", "before any move too: only the 8's frame fills (the bigger addend's)");
  eq(reason(tap(m.makeTenStart(P(3, 8)), 1, "home")), "stays", "3 + 8: the 8's frame fills; its counters stay");
  const across = tap(m.makeTenStart(P(3, 8)), 0, "home");
  eq(across.ok && across.to, 1, "3 + 8: a counter of the 3 crosses");
  const back = tap(r.state, 0, "visitor");
  eq(back.ok && back.state.moved, 0, "a visitor tapped goes home");
  s = run(s, [1, "home"], [1, "home"]);
  eq([m.makeTenFullFrame(s), m.makeTenFrame(s, 1).count, m.makeTenCount(s), m.makeTenTotal(s)], [0, 4, 10, 14], "two crossed: ten and 4");
  eq(reason(tap(s, 1, "home")), "full", "the full frame has no empty place");
  eq(reason(tap(s, 0, "home")), "stays", "a ten's own counters stay");
  eq(reason(tap(s, 1, "visitor")), "none", "no visitors in the 6's frame");
  const undo = tap(s, 0, "visitor");
  eq(undo.ok && m.makeTenComplete(undo.state), false, "taking one back undoes the ten");
  eq([m.makeTenFilling(s.problem), m.makeTenGiver(s.problem)], [0, 1], "the filling frame and the giver are fixed by the problem");
  eqNew(reason(applyMakeTenTap(s, { tap: "give", place: 2 })), "none", "no third frame");
});

test("sketch: the chain", () => {
  eq(m.makeTenChainText(P(8, 6)), "8 + 6 = 8 + 2 + 4 = 10 + 4 = 14", "the standard's own example");
  eq(m.makeTenChainText(P(3, 8)), "3 + 8 = 1 + 2 + 8 = 1 + 10 = 11", "bigger second: the 3 splits");
  eq(m.makeTenChainText(P(9, 5)), "9 + 5 = 9 + 1 + 4 = 10 + 4 = 14", "nine plus");
  eq(m.makeTenBlanks(m.makeTenChain(P(8, 6))).map((b) => [b.part, b.value, b.giver]), [["moved", 2, 1], ["left", 4, 1], ["left", 4, 1], ["total", 14, null]], "four blanks: the 6 split, the ones left, the total");
  // The sketch's typed-row checks (right, full-width digits, the split swapped, 10 + 6 = 16, an empty blank) are the
  // player's numeric_row; here the row's answers and order are checked instead.
  eqNew(makeTenRow(8, 6).filter((part) => "blank" in part).map((part) => ("blank" in part ? part.blank.answer : "")), ["2", "4", "4", "14"], "the row's answers, in order: the split swapped is wrong");
  okNew(!makeTenRow(8, 6).some((part) => "blank" in part && part.blank.answer === "16"), "10 + 6 = 16 is not an answer");
});

test("sketch: the demonstration's count (filled), from the bigger addend", () => {
  const p = P(8, 6);
  eq(m.makeTenDemoTargetFault(p, 8, 11), "past_ten", "a frame holds ten");
  eq(m.makeTenDemoTargetFault(p, 8, 7), "below_start", "below the bigger addend");
  eq(m.makeTenDemoTargetFault(p, 8, 9.5), "not_whole", "whole numbers");
  eq(m.makeTenDemoTaps(p, 8, 8).length, 0, "the same value again: no change");
  eq([m.makeTenDemoTaps(p, 8, 9).length, m.makeTenCount(m.makeTenDemoState(p, 9)), m.makeTenComplete(m.makeTenDemoState(p, 9))], [1, 9, false], "a lesson may stop partway: 9");
  eq(m.makeTenDemoTargetFault(p, 9, 8), "backward", "going back is refused");
  eq([m.makeTenDemoTaps(p, 9, 10).length, m.makeTenFullFrame(m.makeTenDemoState(p, 10))], [1, 0], "then on to 10");
  const q = P(4, 9);
  eq([m.makeTenDemoTaps(q, 9, 10).map((t) => t.place), m.makeTenFullFrame(m.makeTenDemoState(q, 10)), m.makeTenFrame(m.makeTenDemoState(q, 10), 0).count], [[0], 1, 3], "4 + 9: one of the 4 fills the 9's frame");
  eq(m.makeTenDemoState(P(8, 6), 10).moved, 2, "count 10 in the 8's frame is 2 moved");
  eq(signed(m.makeTenDemoState(P(3, 8), 10)), -2, "count 10 in the 8's frame (second) is 2 moved the other way");
  assert.throws(() => m.makeTenDemoState(P(8, 6), 11), "11 cannot be drawn"); ported += 1;
  ok(m.MAKE_TEN_VARIABLE_COUNT <= m.MAKE_TEN_MAX_VARIABLES, "lesson variables within the cap");
  // The sketch had three (a, b, ten_count); the card keeps the learner's taps apart from the demonstration (0026 §7).
  eq(m.MAKE_TEN_VARIABLE_COUNT, 4, "four lesson variables: a, b, filled, moved");
});

test("sketch: exhaustive, every pair, every reachable state", () => {
  let pairs = 0, states = 0;
  for (let a = 1; a <= 9; a += 1) for (let b = 1; b <= 9; b += 1) {
    if (m.makeTenFault(a, b)) continue;
    pairs += 1;
    const p = P(a, b);
    const seen = m.makeTenReachable(p);
    const ends: number[] = [];
    for (const st of seen) {
      states += 1;
      const f0 = m.makeTenFrame(st, 0), f1 = m.makeTenFrame(st, 1);
      assert.equal(m.makeTenTotal(st), a + b, `${a}+${b}: total kept`);
      assert.ok([f0, f1].every((x) => x.count >= 0 && x.count <= 10 && x.home >= 0 && x.visitors >= 0), `${a}+${b}: a frame within 0..10`);
      assert.equal(f0.home + f1.visitors, a, `${a}+${b}: all ${a} first-colour counters are somewhere`);
      assert.equal(f1.home + f0.visitors, b, `${a}+${b}: all ${b} second-colour counters are somewhere`);
      assert.ok(!(f0.visitors && f1.visitors), `${a}+${b}: one way at a time`);
      assert.equal(m.makeTenComplete(st), f0.count === 10 || f1.count === 10, `${a}+${b}: finished exactly when a frame holds ten`);
      if (m.makeTenComplete(st)) { ends.push(signed(st)); assert.equal(m.makeTenFrame(st, 1 - m.makeTenFullFrame(st)).count, a + b - 10, `${a}+${b}: the other frame holds the ones left`); }
      // No dead end: from here, going on the way the counters go reaches a ten.
      let go = st, guard = 0;
      while (!m.makeTenComplete(go) && guard < 10) {
        const res = tap(go, m.makeTenGiver(p), "home");
        assert.ok(res.ok, `${a}+${b}: stuck at moved ${go.moved}`);
        go = res.state; guard += 1;
      }
      assert.ok(m.makeTenComplete(go), `${a}+${b}: a ten can still be made from moved ${st.moved}`);
      assert.equal(m.makeTenDemoState(p, m.makeTenCount(st)).moved, st.moved, `${a}+${b}: the count in the bigger frame maps back to the state`);
    }
    eq(ends, [p.big === 0 ? 10 - a : -(10 - b)], `${a}+${b}: exactly one finished state: the bigger addend's frame holds ten`);
    eq(seen.length, 10 - Math.max(a, b) + 1, `${a}+${b}: ${10 - Math.max(a, b) + 1} reachable states, one way only`);
    ok(m.makeTenChainSides(p).every((v) => v === a + b), `${a}+${b}: every side of the chain is ${a + b}`);
    const blanks = m.makeTenBlanks(m.makeTenChain(p));
    ok(blanks.length === 4 && blanks.every((x) => x.value !== undefined), `${a}+${b}: four blanks`);
    const tokens = m.makeTenChain(p), at = tokens.findIndex((x) => typeof x === "object" && "part" in x && x.part === "moved");
    const nextTo = tokens[p.big === 0 ? at - 2 : at + 2] as { n: number };
    const movedValue = (tokens[at] as { value: number }).value;
    ok(nextTo.n === Math.max(a, b) && nextTo.n + movedValue === 10, `${a}+${b}: the moved blank sits next to ${Math.max(a, b)} and makes ten with it`);
    const demo = m.makeTenDemoTaps(p, Math.max(a, b), 10);
    ok(m.makeTenFullFrame(m.makeTenDemoState(p, 10)) === p.big && demo.length === 10 - Math.max(a, b), `${a}+${b}: the demonstration fills the bigger frame in ${10 - Math.max(a, b)} taps`);
    okNew(m.makeTenToTen(p) <= m.MAKE_TEN_MAX_MOVED, `${a}+${b}: at most ${m.MAKE_TEN_MAX_MOVED} cross`);
  }
  eq(pairs, 36, "36 pairs fit the card (two numbers 1–9, sum over ten)");
  okNew(states === 106, `106 reachable states walked (${states})`);
});

test("sketch: the picker's problems and their practice pairs", () => {
  for (const lang of ["en", "zh"] as const) for (const item of MAKE_TEN_PROBLEMS[lang]) {
    ok(!m.makeTenFault(item.a, item.b), `${lang} ${item.a} + ${item.b} fits`);
    eq(m.makeTenPracticeFault(P(item.a, item.b), item.practice.a, item.practice.b), undefined, `${lang} ${item.a} + ${item.b}: practice ${item.practice.a} + ${item.practice.b} fits and differs`);
  }
  for (const item of MAKE_TEN_REFUSED) ok(m.makeTenFault(item.a, item.b) !== undefined, `${item.a} + ${item.b} refused`);
});

test("the sketch's model checks are all ported", () => {
  // test-model.mjs ran 469 checks; its 9 typed-reader checks and 5 typed-row checks are the player's.
  assert.equal(ported, 469 - 14);
});

// ---------------------------------------------------------------- the card

/** A content holding a state, as the card's variables hold it. */
function contentOf(state: MakeTenState, filled?: number): MakeTenContent {
  return { a: state.problem.a, b: state.problem.b, filled: filled ?? m.makeTenFreshCount(state.problem.a, state.problem.b), moved: state.moved };
}
const failer = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const refusedWith = (raw: unknown, pattern: RegExp, options?: { boundValues?: boolean; start?: boolean }) => assert.throws(() => validateMakeTenContent(raw, "$", failer, options), pattern);

test("content: the pair, the demonstration's count from the pair, and the count moved", () => {
  validateMakeTenContent({ a: 8, b: 6, filled: 8, moved: 0 }, "$", failer);
  validateMakeTenContent({ a: 8, b: 6, filled: 8, moved: 2, language: "zh-CN" }, "$", failer);
  // A value the demonstration already reached (a replay may set it), not a card that opens.
  validateMakeTenContent({ a: 8, b: 6, filled: 10, moved: 0 }, "$", failer);
  validateMakeTenContent({ a: 3, b: 8, filled: 9, moved: 0 }, "$", failer);
  // A card that opens (or a practice start) is fresh: the ten not made, nothing moved (review of #119).
  validateMakeTenContent({ a: 8, b: 6, filled: 8, moved: 0 }, "$", failer, { start: true });
  refusedWith({ a: 8, b: 6, filled: 10, moved: 0 }, /\$\/filled: A card opens fresh: for 8 \+ 6 'filled' starts at 8, the bigger addend, not 10/u, { start: true });
  refusedWith({ a: 3, b: 8, filled: 9, moved: 0 }, /for 3 \+ 8 'filled' starts at 8, the bigger addend, not 9/u, { start: true });
  refusedWith({ a: 8, b: 6, filled: 8, moved: 1 }, /\$\/moved: A card opens fresh: nothing moved, not 1/u, { start: true });
  refusedWith({ a: 6, b: 3, filled: 6, moved: 0 }, /\$\/b: 6 \+ 3 is less than ten.*\(under_ten\)/u);
  refusedWith({ a: 7, b: 3, filled: 7, moved: 0 }, /exactly ten.*\(exactly_ten\)/u);
  refusedWith({ a: 12, b: 5, filled: 9, moved: 0 }, /\$\/a: The first number is a whole number from 1 to 9/u);
  refusedWith({ a: 8, b: 6, filled: 0, moved: 0 }, /\$\/filled: 'filled' counts the counters in the bigger addend's frame: for 8 \+ 6 it starts at 8, the bigger addend, not 0/u);
  refusedWith({ a: 3, b: 8, filled: 3, moved: 0 }, /starts at 8, the bigger addend, not 3/u);
  refusedWith({ a: 8, b: 6, filled: 11, moved: 0 }, /\$\/filled: .* from 0 to 10/u);
  refusedWith({ a: 8, b: 6, filled: 8, moved: 3 }, /\$\/moved: 8 \+ 6 fills its ten with 2 moved; 3 cannot be/u);
  refusedWith({ a: 8, b: 6, filled: 9, moved: 1 }, /A demonstration .* plays on fresh frames: moved is 0/u);
  refusedWith({ a: 8, b: 6, filled: 8, moved: 0, places: [] }, /Unknown make-ten field 'places'/u);
  refusedWith({ a: 8, b: 6, filled: 8, moved: 0, language: "fr" }, /speaks en-US or zh-CN/u);
  // Checked at a value a variable can take: only each field's own range.
  validateMakeTenContent({ a: 1, b: 1, filled: 0, moved: 4 }, "$", failer, { boundValues: true });
  refusedWith({ a: 8, b: 6, filled: 8, moved: 5 }, /\$\/moved: .* from 0 to 4/u, { boundValues: true });
});

test("state: total, the demonstration's count, and a fresh start", () => {
  const s = makeTenState({ a: 8, b: 6, filled: 8, moved: 2 });
  eq([s.moved, m.makeTenComplete(s), s.filled], [2, true, 8], "the learner's two moves make the ten");
  const d = makeTenState({ a: 8, b: 6, filled: 9.6, moved: 2 });
  eq([d.moved, d.filled, m.makeTenDemonstrating(d)], [1, 9, true], "a demonstration between values shows the whole number reached; its count wins over moved");
  eq(reason(applyMakeTenTap(d, { tap: "give", place: 1 })), "demonstrating", "a card showing a demonstration refuses every tap");
  eq(makeTenState({}).problem, P(9, 9), "any content gives a state");
  eq(makeTenState({ a: 8, b: 6, filled: 0, moved: 7 }), { problem: P(8, 6), moved: 2, filled: 8 }, "counts are taken into what the pair allows");
  eq(m.makeTenStartFault(m.makeTenStart(P(8, 6))), undefined, "a fresh card starts a practice");
  ok(/filled is 10, not 8/u.test(m.makeTenStartFault(makeTenState({ a: 8, b: 6, filled: 10, moved: 0 })) ?? ""), "a demonstrated card does not");
  ok(/moved is 1, not 0/u.test(m.makeTenStartFault(makeTenState({ a: 8, b: 6, filled: 8, moved: 1 })) ?? ""), "nor a card already worked");
  eq(m.makeTenChanges(m.makeTenStart(P(8, 6)), s), [{ place: 0, field: "moved", before: 0, after: 2 }], "a tap changes the count moved");
  eq(m.makeTenChanges(s, s), [], "no change, no field");
  eq(m.makeTenFreshCount(3, 8), 8, "the demonstration's start is the bigger addend, taken from the pair");
  eq(contentOf(m.makeTenStart(P(4, 9))), { a: 4, b: 9, filled: 9, moved: 0 }, "a fresh content");
});

test("facts", () => {
  eq(makeTenFacts(makeTenState({ a: 8, b: 6, filled: 8, moved: 1 })), { counts: [9, 5], total: 14, moved: 1, complete: false, filling: 0, giver: 1, toTen: 2, left: 4 }, "mid-way");
  eq(makeTenFacts(makeTenState({ a: 4, b: 9, filled: 10, moved: 0 })).complete, true, "the demonstration made the ten");
});

test("words: en and zh, whole sentences, the colour word named and drawn in its colour", () => {
  const p86 = makeTenState({ a: 8, b: 6, filled: 8, moved: 0 }), p49 = makeTenState({ a: 4, b: 9, filled: 9, moved: 0 });
  eq(makeTenPlain(makeTenInstruction(p86, "en-US")), "Make a ten: tap a blue counter to fill the empty places.", "en start names the giver's colour");
  eq(makeTenInstruction(p86, "en-US").filter((x) => typeof x !== "string"), [{ word: "blue", frame: 1 }], "the colour word is the second addend's");
  eq(makeTenPlain(makeTenInstruction(p49, "zh-CN")), "凑成十：点红色的圆片，把空位填满。", "zh start: 4 + 9 gives red");
  eq(makeTenPlain(makeTenInstruction(makeTenState({ a: 8, b: 6, filled: 8, moved: 1 }), "en-US")), "Keep tapping blue counters until the frame is full. A counter that crossed goes back when tapped.", "en going: it can go back (Learn #259)");
  eqNew(makeTenPlain(makeTenInstruction(makeTenState({ a: 3, b: 8, filled: 8, moved: 1 }), "zh-CN")), "接着点红色的圆片，直到框满了。移过去的圆片，点一下就回去。", "zh going");
  eqNew(makeTenPlain(makeTenInstruction(makeTenState({ a: 8, b: 6, filled: 8, moved: 0 }), "en-US")).includes("goes back"), false, "before any counter crosses, nothing to bring back");
  eq(makeTenPlain(makeTenInstruction(makeTenState({ a: 8, b: 6, filled: 8, moved: 2 }), "zh-CN")), "框满十了。在下面填空。", "zh done");
  eq(makeTenRefusalText(p86, "stays", "en-US"), "Red counters stay in their frame.", "the refusal is a fact a child reads");
  eq(makeTenRefusalText(p49, "stays", "zh-CN"), "蓝色的圆片留在自己的框里。", "zh refusal names the filling frame's colour");
  eq(makeTenRefusalText(p86, "demonstrating", "en-US"), "These frames show the demonstration.", "a demonstration's refusal");
  eq(makeTenRefusalText(p86, "anything", "zh-CN"), "这里不能这样做。", "an unknown reason");
  eq(makeTenHowTo({ a: 8, b: 6, filled: 8, moved: 0 }), "Tap a blue counter to move it into an empty place of the other frame; tap it again to bring it back. When that frame holds ten, fill in the blanks.", "the fixed how-to names the giving colour");
  eq(makeTenHowTo({ a: 4, b: 9, filled: 9, moved: 0, language: "zh-CN" }), "点红色的圆片，把它移到另一个框的空位里；再点一下就移回来。那个框满十了，就在下面填空。", "zh how-to");
  eq(makeTenStepSentences(P(8, 6), 8, 10, "en-US"), ["Fill the 8's frame to make a ten.", "Move one of the 6 across.", "Move one of the 6 across.", "A full frame is ten, and 4 are left: 10 + 4."], "the demonstration's sentences for later sections");
  eq(makeTenStepSentences(P(9, 4), 9, 10, "zh-CN"), ["把 9 的框补满，凑成十。", "从 4 里移一个过去。", "满框是十，另一个框还剩 3 个：10 + 3。"], "zh demonstration");
  eq(makeTenStepSentences(P(8, 6), 8, 9, "en-US").length, 2, "a partial stop says no ten yet");
  for (const language of ["en-US", "zh-CN"] as const) {
    const words = MAKE_TEN_WORDS[language];
    ok(Object.keys(words.refusal).join() === "stays,full,demonstrating,none", `${language}: the same refusals`);
    // Never an instruction: no request, and no sentence that opens with a verb telling the child what to do.
    okNew(!Object.values(words.refusal).some((text) => /\b(please|try|must)\b|请|试试/iu.test(text) || /^(tap|move|put|take|fill|keep|click|点|移|放|拿|把|再)/iu.test(text)), `${language}: refusals state facts, never instructions`);
  }
});

test("row: the four blanks the anchored task asks, written by the program", () => {
  eq(makeTenRow(8, 6), [
    { text: "8 + 6 = 8 +" }, { blank: { as: "to-ten", answer: "2", label: "to make ten" } }, { text: "+" }, { blank: { as: "rest", answer: "4" } },
    { text: "= 10 +" }, { blank: { as: "ones", answer: "4" } }, { text: "=" }, { blank: { as: "total", answer: "14" } },
  ], "8 + 6: the blank beside the 8 makes ten with it");
  eq(makeTenRow(4, 9, "zh-CN"), [
    { text: "4 + 9 =" }, { blank: { as: "rest", answer: "3" } }, { text: "+" }, { blank: { as: "to-ten", answer: "1", label: "凑成十" } },
    { text: "+ 9 =" }, { blank: { as: "ones", answer: "3" } }, { text: "+ 10 =" }, { blank: { as: "total", answer: "13" } },
  ], "4 + 9: the blank beside the 9");
  // Each row, in both languages, as core's validator takes a numeric_row task anchored on a card (every pair).
  const rowLesson = (a: number, b: number, language: m.MakeTenLanguage) => ({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language, title: "Making ten", goals: ["Write it as a number sentence"],
      tasks: [{ as: "row", anchor: "card", prompt: "Write it.", availability: { kind: "after_lesson" }, allowed_operations: [{ kind: "row_entry" }],
        completion: { kind: "numeric_row", parts: makeTenRow(a, b, language) }, hints: ["Read the full frame."] }],
    },
    steps: [{ key: "s", purpose: "See", beats: [{ key: "b", say: "Look.", actions: [{ do: "write", as: "card", kind: "text", role: "note", content: { text: `${a} + ${b}` }, place: { relation: "new_region" } }] }] }],
    close: { summary: "Done.", focus: ["card"] },
  }) as unknown as AuthoringLesson;
  let rows = 0;
  for (let a = 1; a <= 9; a += 1) for (let b = 1; b <= 9; b += 1) {
    if (m.makeTenFault(a, b)) {
      assert.throws(() => makeTenRow(a, b), /\((under_ten|exactly_ten)\)/u, `${a}+${b}: a pair the card refuses has no row`);
      continue;
    }
    for (const language of ["en-US", "zh-CN"] as const) {
      assertAuthoringSchema(rowLesson(a, b, language));
      validateAuthoringLesson(rowLesson(a, b, language));
      rows += 1;
    }
    const row = makeTenRow(a, b);
    const blanks = row.flatMap((part) => ("blank" in part ? [part.blank] : []));
    assert.ok(row.length <= 12 && blanks.length === 4 && new Set(blanks.map((x) => x.as)).size === 4, `${a}+${b}: a numeric_row (≤ 12 parts, 4 named blanks)`);
    assert.ok(row.every((part) => !("text" in part) || part.text.length <= 80), `${a}+${b}: each text ≤ 80`);
    assert.ok(blanks.every((x) => x.label === undefined || !/\d/u.test(x.label)), `${a}+${b}: a label is never the number`);
  }
  assert.equal(rows, 72, "36 pairs, en and zh, each taken by core's validator");
  assert.throws(() => makeTenRow(5, 5), /5 \+ 5 is exactly ten/u);
  assert.throws(() => makeTenRow(12, 5), /\(not_one_digit\)/u);
});

test("plan: two frames side by side at desktop size, under 1024 px", () => {
  const plan = planMakeTen({ a: 8, b: 6, filled: 8, moved: 0 });
  assert.ok(plan.width <= 1024 - 32, `fits a 1024 px window (${plan.width})`);
  assert.equal(plan.frames[0]!.box.y, plan.frames[1]!.box.y, "side by side");
  assert.ok(plan.frames[1]!.box.x > plan.frames[0]!.box.x + plan.frames[0]!.box.width, "apart");
  assert.ok(plan.counter >= 44, "a counter is big enough to tap");
  assert.deepEqual(m.makeTenPlaceAt(plan, 0, 0), { x: plan.frames[0]!.box.x + plan.unit / 2, y: plan.frames[0]!.box.y + plan.unit / 2 }, "first place, top left");
  assert.equal(m.makeTenPlaceAt(plan, 1, 5).y, plan.frames[1]!.box.y + plan.unit * 1.5, "the sixth place starts the bottom row");
});

test("builder: the card from neutral input, filled from the pair when left out", () => {
  const built = buildMakeTen({ as: "frames", role: "diagram", place: { mode: "new_region" }, a: { expression: "a", initial: 8 }, b: { expression: "b", initial: 6 }, filled: { expression: "filled", initial: 8 }, moved: { expression: "moved", initial: 0 }, language: "zh-CN" });
  const action = built.actions[0] as unknown as { kind: string; content: MakeTenContent };
  assert.equal(action.kind, "make_ten");
  assert.deepEqual(action.content, { language: "zh-CN", a: 8, b: 6, filled: 8, moved: 0, bindings: [{ target: "a", expression: "a" }, { target: "b", expression: "b" }, { target: "filled", expression: "filled" }, { target: "moved", expression: "moved" }] });
  validateMakeTenContent(action.content, "$", failer);
  const plain = buildMakeTen({ as: "frames", role: "diagram", place: { mode: "new_region" }, a: 3, b: 8 });
  assert.deepEqual((plain.actions[0] as unknown as { content: MakeTenContent }).content, { a: 3, b: 8, filled: 8, moved: 0 }, "filled defaults to the bigger addend");
  assert.deepEqual(built.parts, { whole: "frames" });
  assert.equal(typeof math.buildMakeTen, "function", "exported from the plugin");
  assert.equal(math.MAKE_TEN_KIND, "make_ten");
});
