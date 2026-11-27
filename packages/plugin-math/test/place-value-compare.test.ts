// Comparing two numbers by place (decision 0029): the rules, the invariants and the demonstration ported from the
// accepted sketch (35P-06 sketch, test-model.mjs: every check, the lesson-variable round trip as the card's content
// fields), then the card's content rules, state, taps by place index, "compared", facts, words, plan and builder.
// Values are thousandths; each number keeps its written decimals.
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/place-value-compare.js";
import { placeValueDiskLabel } from "../src/place-value-chart.js";
import { buildPlaceValueCompare } from "../src/place-value-compare-builder.js";
import * as math from "../src/index.js";
import { COMPARE_PROBLEMS, compareNumber } from "./place-value-compare-fixtures.js";

type Pair = m.PlaceValueComparePair;
type Faulted = Pair & { fault?: string };

let ported = 0;
const eq = (actual: unknown, expected: unknown, what: string) => { assert.deepEqual(actual, expected, what); ported += 1; };
const ok = (cond: unknown, what: string) => { assert.ok(cond, what); ported += 1; };
/** The sketch's `makePair` on written numbers. */
function pair(a: string, b: string): Faulted {
  const A = m.placeValueCompareParse(a), B = m.placeValueCompareParse(b);
  if (!A || !B) return { fault: "unreadable" } as Faulted;
  if (A.value === undefined || B.value === undefined) return { fault: "decimals" } as Faulted;
  return m.placeValueCompareMakePair({ value: A.value, dec: A.dec }, { value: B.value, dec: B.dec }) as Faulted;
}
const tap = (state: m.PlaceValueCompareState, index: number, judgement?: string) =>
  m.placeValueCompareMove(state, { tap: judgement as m.PlaceValueCompareJudgement, index });
const reason = (r: m.PlaceValueCompareResult) => (r.ok ? undefined : r.reason);
const run = (state: m.PlaceValueCompareState, ...steps: Array<[number, m.PlaceValueCompareJudgement]>) => steps.reduce((s, [i, j]) => {
  const r = tap(s, i, j);
  assert.ok(r.ok, `${i} ${j}: ${reason(r)}`);
  return r.state;
}, state);
const sign = (state: m.PlaceValueCompareState, s: string) => m.placeValueCompareMove(state, { tap: "sign", sign: s as m.PlaceValueCompareSign });
/** The sketch's chooseSign: ok, or its refusal reason (an unknown sign is `no_sign`). */
const choose = (state: m.PlaceValueCompareState, s: string) => { const r = sign(state, s); return r.ok ? { ok: true } : { ok: false, reason: r.reason }; };
/** The sketch's learner state with k columns judged (its demoState). */
const judged = (p: Pair, k: number): m.PlaceValueCompareState => ({ pair: p, marked: k, signed: false, compared: 0 });
const final = (p: Pair) => { const { steps } = m.placeValueCompareDemoSteps(p); return steps[p.stop]!.after; }; // decided, sign not chosen
/** The sketch's practiceFits. */
function practiceFits(shown: { a: string; b: string }, practice: { a: string; b: string }): { ok: true } | { ok: false; reason: string } {
  const p = pair(practice.a, practice.b);
  if (p.fault) return { ok: false, reason: p.fault };
  const s = pair(shown.a, shown.b);
  return !s.fault && m.placeValueCompareSamePair(s, p) ? { ok: false, reason: "same_pair" } : { ok: true };
}

/** A content holding a pair and a state. */
function contentOf(p: Pair, extra: Partial<m.PlaceValueCompareContent> = {}): m.PlaceValueCompareContent {
  const own = (value: number, dec: number) => (dec === m.placeValueCompareOwnDecimals(value) ? undefined : dec);
  const ad = own(p.a, p.aDec), bd = own(p.b, p.bDec);
  return { a: p.a, b: p.b, ...(ad !== undefined ? { a_decimals: ad } : {}), ...(bd !== undefined ? { b_decimals: bd } : {}), compared: 0, marked: 0, signed: 0, ...extra };
}
const failure = (raw: unknown, options: { boundValues?: boolean; start?: boolean } = {}): string | undefined => {
  try {
    m.validatePlaceValueCompareContent(raw, "$", (path, message) => { throw new Error(`${path}: ${message}`); }, options);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

// ---------------------------------------------------------------- the sketch's model checks (test-model.mjs)

test("sketch: exact values, as written", () => {
  eq(m.placeValueCompareParse("4,530"), { value: 4530000, dec: 0 }, "commas");
  eq(m.placeValueCompareParse("0.70"), { value: 700, dec: 2 }, "0.70 keeps its two decimals");
  eq(m.placeValueCompareParse("0.625")!.value, 625, "thousandths");
  eq(m.placeValueCompareParse("1.2345")!.value, undefined, "four decimals: no value");
  eq(m.placeValueCompareParse("-3"), undefined, "no negatives");
  eq(m.placeValueCompareParse("12345678"), undefined, "eight whole digits");
  eq(m.placeValueCompareNumeral(700, 2, "en-US"), "0.70", "numeral keeps the written zero");
  eq(m.placeValueCompareNumeral(4530000, 0, "en-US"), "4,530", "en commas");
  eq(m.placeValueCompareNumeral(4530000, 0, "zh-CN"), "4530", "zh plain");
  eq(m.placeValueCompareNumeral(4300, 3, "zh-CN"), "4.300", "zh 4.300");
  eq(placeValueDiskLabel(6, "zh-CN"), "100万", "zh million disk");
  eq(placeValueDiskLabel(-3, "en-US"), "0.001", "thousandth disk");
});

test("sketch: pairs, their columns, the deciding place and the relation", () => {
  const expect: Array<[string, string, number[], number, string]> = [
    ["4530", "4503", [3, 2, 1, 0], 1, ">"],
    ["10200", "9876", [4, 3, 2, 1, 0], 4, ">"],
    ["607198", "607912", [5, 4, 3, 2, 1, 0], 2, "<"],
    ["0.625", "0.7", [0, -1, -2, -3], -1, "<"],
    ["0.45", "0.405", [0, -1, -2, -3], -2, ">"],
    ["2.35", "2.305", [0, -1, -2, -3], -2, ">"],
    ["12.4", "9.87", [1, 0, -1, -2], 1, ">"],
    ["0.7", "0.70", [0, -1, -2], -2, "="],
    ["4.300", "4.3", [0, -1, -2, -3], -3, "="],
    ["36815", "36851", [4, 3, 2, 1, 0], 1, "<"],
    ["120345", "98765", [5, 4, 3, 2, 1, 0], 5, ">"],
    ["5.06", "5.6", [0, -1, -2], -1, "<"],
    ["1000000", "999999", [6, 5, 4, 3, 2, 1, 0], 6, ">"],
    ["3456.789", "3456.798", [3, 2, 1, 0, -1, -2, -3], -2, "<"],
  ];
  for (const [a, b, columns, place, relation] of expect) {
    const p = pair(a, b);
    eq([p.columns, p.place, p.relation], [columns, place, relation], `${a} vs ${b}`);
  }
  eq(pair("0.625", "0.7").da, [0, 6, 2, 5], "0.625's digits by place");
  eq(pair("0.625", "0.7").db, [0, 7, 0, 0], "0.7 is empty after the tenths");
  eq(pair("4530", "4530").fault, "same_numeral", "the same numeral twice is refused");
  eq(pair("0.7", "0.70").fault, undefined, "equal values written differently are served");
  eq(pair("1234567", "0.5").fault, "too_wide", "eight columns refused");
  eq(pair("1.2345", "1").fault, "decimals", "four decimals refused");
  eq(pair("x", "1").fault, "unreadable", "unreadable");
  eq(m.placeValueCompareProblemText(pair("0.625", "0.7"), "en-US"), "Compare 0.625 and 0.7.", "question en");
  eq(m.placeValueCompareProblemText(pair("36815", "36851"), "zh-CN"), "比较 36815 和 36851。", "question zh");
  eq(m.placeValueCompareResultText(pair("0.7", "0.70"), "en-US"), "0.7 = 0.70", "result keeps 0.70");
});

test("sketch: judgements from the left, one column at a time; only true judgements are accepted", () => {
  let p = pair("4530", "4503");
  let s = m.placeValueCompareStart(p);
  eq(p.columns.map((_, i) => m.placeValueCompareColumn(s, i).status), ["open", "open", "open", "open"], "first screen: nothing marked");
  for (const j of m.PLACE_VALUE_COMPARE_JUDGEMENTS) eq(reason(tap(s, 3, j)), "left_unjudged", `ones, ${j}: a place to the left hasn't been compared`);
  eq(reason(tap(s, 2, "different")), "left_unjudged", "the tens differ, but the thousands and hundreds are not judged yet: nothing is marked for the child");
  eq(m.placeValueCompareRefusalText(s, { tap: "same", place: 3 }, "en-US"), "Ones: 0 and 3. The thousands haven't been compared yet.", "the refusal states the ones' own digits");
  ok(!/tens/u.test(m.placeValueCompareRefusalText(s, { tap: "same", place: 3 }, "en-US")), "the refusal does not name the deciding place");
  eq(reason(tap(s, 0, "different")), "not_different", "thousands 4 and 4: Different is not true");
  eq(reason(tap(s, 0)), "no_judgement", "a tap needs a judgement");
  s = run(s, [0, "same"]);
  eq([s.marked, m.placeValueCompareColumn(s, 0).status], [1, "same"], "the thousands: same");
  eq(reason(tap(s, 0, "same")), "already_same", "the thousands are already judged");
  s = run(s, [1, "same"]);
  eq(reason(tap(s, 2, "same")), "not_same", "tens 3 and 0: Same is not true");
  eq(m.placeValueCompareRefusalText(s, { tap: "same", place: 4 }, "en-US"), "Tens: 3 and 0.", "that refusal states the tens' digits");
  const r = tap(s, 2, "different");
  assert.ok(r.ok);
  eq([r.anim.kind, m.placeValueCompareDecided(r.state)], ["decide", true], "the tens: different, and they decide");
  s = r.state;
  eq(p.columns.map((_, i) => m.placeValueCompareColumn(s, i).status), ["same", "same", "decides", "after"], "after the decision the ones no longer matter");
  eq(m.placeValueCompareColumn(s, 2).extra, { row: "a", n: 3 }, "3 tens against none: 3 extra in row 1");
  eq(m.placeValueCompareColumn(s, 2).paired, 0, "no tens pair up");
  for (const j of m.PLACE_VALUE_COMPARE_JUDGEMENTS) eq(reason(tap(s, 3, j)), "after_decided", "a tap after the decision states that it doesn't matter");
  eq(reason(tap(s, 2, "same")), "already_decides", "the deciding place again");

  p = pair("4530", "4630");
  s = run(m.placeValueCompareStart(p), [0, "same"]);
  eq(reason(tap(s, 3, "same")), "left_unjudged", "4,530 and 4,630, Same at the ones (0 and 0): still a fact that a place to the left is not compared");
  eq(m.placeValueCompareRefusalText(s, { tap: "same", place: 3 }, "zh-CN"), "个位：0 和 0。百位还没有比。", "the zh refusal (decision 0029 §3)");
  s = run(s, [1, "different"]);
  eq(reason(tap(s, 3, "same")), "after_decided", "and once the hundreds decide, the ones don't matter");
  eq(m.placeValueCompareRefusalText(s, { tap: "same", place: 3 }, "zh-CN"), "已经由百位决定了；个位在后面，不影响。", "the zh fact after the decision");

  p = pair("0.625", "0.7");
  s = run(m.placeValueCompareStart(p), [0, "same"], [1, "different"]);
  eq([m.placeValueCompareColumn(s, 1).status, m.placeValueCompareColumn(s, 1).paired, m.placeValueCompareColumn(s, 1).extra], ["decides", 6, { row: "b", n: 1 }], "6 tenths pair with 6 of 7: one extra tenth in 0.7");
  eq([m.placeValueCompareColumn(s, 2).status, m.placeValueCompareColumn(s, 3).status], ["after", "after"], "0.625's hundredths and thousandths no longer matter");

  p = pair("0.7", "0.70");
  s = run(m.placeValueCompareStart(p), [0, "same"], [1, "same"]);
  eq(m.placeValueCompareDecided(s), false, "an equal pair: not finished before the last place");
  eq(reason(tap(s, 2, "different")), "not_different", "hundredths 0 and 0: Different is not true");
  s = run(s, [2, "same"]);
  eq([m.placeValueCompareDecided(s), m.placeValueCompareColumn(s, 2).status], [true, "same"], "an equal pair: Same all the way finishes it; no place decides");
});

test("sketch: every listed pair, every reachable state, the demonstration and the practice pair", () => {
  let states = 0;
  for (const lang of ["en", "zh"] as const) for (const item of COMPARE_PROBLEMS[lang]) {
    const pr = pair(item.a, item.b);
    eq(pr.fault, undefined, `${item.a} vs ${item.b} accepted`);
    eq(practiceFits(item, item.practice), { ok: true }, `${item.a} vs ${item.b}: practice pair fits`);
    const all = m.placeValueCompareReachable(pr);
    states += all.length;
    // One state per judged count, and the sign (the sketch counted the chart only: stop + 2).
    eq(all.length, pr.stop + 3, `${item.a} vs ${item.b}: one state per judged count, and the sign`);
    for (const st of all) {
      const cols = pr.columns.map((_, i) => m.placeValueCompareColumn(st, i));
      eq(cols.filter((c) => c.status === "decides").length <= 1, true, "at most one deciding place");
      eq(cols.every((c) => c.status !== "same" || c.a === c.b), true, "only matching columns read 'same'");
      if (m.placeValueCompareDecided(st)) eq(cols.every((c, i) => (i > pr.stop) === (c.status === "after")), true, "every place after the decision, and only those, no longer matters");
      eq(!st.signed || m.placeValueCompareDecided(st), true, "a sign only on a decided chart");
    }
    const { steps, final: last } = m.placeValueCompareDemoSteps(pr);
    eq([steps.length - 1, m.placeValueCompareComplete(last)], [pr.stop + 1, true], `${item.a} vs ${item.b}: the demonstration compares from the left to the decision, then signs`);
    for (let k = 0; k <= pr.stop + 1; k += 1) eq(m.placeValueCompareDemoState(pr, k).marked, k, "compared = k shows k places");
  }
  eq(practiceFits({ a: "4530", b: "4503" }, { a: "4503", b: "4530" }), { ok: false, reason: "same_pair" }, "the shown pair reversed is not a practice pair");
  eq(practiceFits({ a: "4530", b: "4503" }, { a: "1.2345", b: "1" }), { ok: false, reason: "decimals" }, "a refused pair is not a practice pair");
  assert.throws(() => m.placeValueCompareDemoState(pair("4530", "4503"), 5)); ported += 1;
  ok(states > 60, `${states} reachable states`);
});

test("sketch: the rule itself, for random pairs: the first differing place agrees with the values", () => {
  let seed = 7;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const randomNumber = () => {
    const dec = rand(4), whole = rand(4) === 0 ? 0 : rand(10 ** (1 + rand(4)));
    return dec ? `${whole}.${String(rand(10 ** dec)).padStart(dec, "0")}` : String(whole);
  };
  let tried = 0;
  while (tried < 2000) {
    const a = randomNumber(), b = rand(5) === 0 ? a + (a.includes(".") ? "0" : ".0") : randomNumber();
    const pr = pair(a, b);
    if (pr.fault) continue;
    tried += 1;
    const byValue = pr.a > pr.b ? ">" : pr.a < pr.b ? "<" : "=";
    eq(pr.relation, byValue, `${a} vs ${b}: the first differing place agrees with the values`);
    eq(choose(m.placeValueCompareStart(pr), byValue), { ok: false, reason: "not_decided" }, "no sign before the chart is decided");
    eq(choose(final(pr), byValue), { ok: true }, `${a} vs ${b}: the true sign is accepted once decided`);
    for (const other of m.PLACE_VALUE_COMPARE_SIGNS.filter((x) => x !== byValue)) eq(choose(final(pr), other), { ok: false, reason: "not_true" }, "any other sign is not true");
    eq(m.placeValueCompareComplete(m.placeValueCompareDemoSteps(pr).final), true, "the demonstration always reaches the decision and the sign");
    for (let i = 1; i < pr.columns.length; i += 1) for (const j of m.PLACE_VALUE_COMPARE_JUDGEMENTS) eq(reason(tap(m.placeValueCompareStart(pr), i, j)), "left_unjudged", "nothing right of an unjudged place is accepted");
    if (!pr.equal) eq(reason(tap(judged(pr, pr.stop), pr.stop, "same")), "not_same", "Same on the first difference is not true");
  }
  ok(tried === 2000, "2000 random pairs");
});

test("sketch: the sign", () => {
  eq(choose(m.placeValueCompareStart(pair("4530", "4503")), ">"), { ok: false, reason: "not_decided" }, "the sign waits for the deciding place");
  eq(choose(final(pair("4530", "4503")), ">"), { ok: true }, "4,530 > 4,503");
  eq(choose(final(pair("4530", "4503")), "<"), { ok: false, reason: "not_true" }, "< is not true");
  eq(choose(final(pair("0.7", "0.70")), "="), { ok: true }, "0.7 = 0.70 once every place matches");
  eq(choose(judged(pair("0.7", "0.70"), 2), "=").reason, "not_decided", "an equal pair: not before the last place");
  eq(choose(final(pair("4530", "4503")), "≥").reason, "no_sign", "only >, = and <");
});

test("sketch: the lesson's variables", () => {
  ok(m.placeValueCompareVariableCount(2) <= m.PLACE_VALUE_COMPARE_MAX_VARIABLES, "at most 7 variables, at most 16");
  eq(m.PLACE_VALUE_COMPARE_BINDINGS.length, m.placeValueCompareVariableCount(2), "every field the card binds is counted");
});

// ---------------------------------------------------------------- the card in OLL

test("content: a starting card, written decimals, the fields' own ranges and the joint rules", () => {
  const p = pair("0.7", "0.70");
  eq(failure(contentOf(p), { start: true }), undefined, "0.7 and 0.70, fresh");
  eq(contentOf(p).b_decimals, 2, "0.70 writes its decimals; 0.7 needs none");
  eq(failure({ ...contentOf(p), b_decimals: undefined }), "$/b: 0.7 and 0.7: the same numeral twice; there is nothing to compare (0.7 and 0.70 are a pair) (same_numeral)", "without its decimals 0.70 is 0.7");
  eq(failure(contentOf(pair("0.625", "0.7"), { a_decimals: 2 })), "$/a_decimals: 0.625 and 0.7: a number has at most three decimals, and is written with at least the decimals it has (0.625 writes three) (decimals)", "0.625 is not written with two decimals");
  eq(failure({ ...contentOf(pair("4530", "4503")), a: 1234567000, b: 500 }), "$/b: 1,234,567 and 0.5: the two numbers need more than seven columns (the highest place to the lowest written) (too_wide)", "eight columns");
  eq(failure({ ...contentOf(pair("4530", "4503")), extra: 1 }), "$/extra: Unknown place-value compare field 'extra'", "unknown fields");
  eq(failure({ ...contentOf(pair("4530", "4503")), a_decimals: 4 }), "$/a_decimals: The decimals the first number is written with is a whole number from 0 to 3", "decimals 0 to 3");
  eq(failure({ ...contentOf(pair("4530", "4503")), marked: 8 }), "$/marked: Marked (the columns the learner judged) is a whole number from 0 to 7", "marked 0 to 7 (any pair)");
  eq(failure({ ...contentOf(pair("4530", "4503")), signed: 2 }), "$/signed: Signed (the true sign chosen) is a whole number from 0 to 1", "signed 0 or 1");
  eq(failure({ ...contentOf(pair("4530", "4503")), marked: 4 }), "$/marked: 4,530 and 4,503 are decided at 3 columns judged; 4 cannot be", "marked past the decision");
  eq(failure({ ...contentOf(pair("4530", "4503")), marked: 2, signed: 1 }), "$/signed: The sign is chosen only once the comparing is done (marked is the deciding column plus one)", "a sign before the decision");
  eq(failure({ ...contentOf(pair("4530", "4503")), compared: 5 }), `$/compared: 'compared' counts the columns a place_value_compare card's demonstration has judged from the left, then one more for the sign: 0 to 4 on this pair, not 5`, "compared past the sign");
  eq(failure({ ...contentOf(pair("4530", "4503")), compared: 2, marked: 1 }), "$/compared: A demonstration (compared past 0) plays on an unjudged chart: marked and signed are 0", "a demonstration never overrides the learner's judgements");
  eq(failure({ ...contentOf(pair("4530", "4503")), compared: 2 }), undefined, "a replay may show the demonstration part way");
  eq(failure({ ...contentOf(pair("4530", "4503")), marked: 3, signed: 1 }), undefined, "a done chart (a done pile)");
  // A card opens fresh (reviews of #119, #121 and #123): nothing compared, judged or signed.
  eq(failure({ ...contentOf(pair("4530", "4503")), compared: 2 }, { start: true }), "$/compared: A card opens fresh: nothing compared, not 2", "opens fresh: compared");
  eq(failure({ ...contentOf(pair("4530", "4503")), marked: 1 }, { start: true }), "$/marked: A card opens fresh: nothing judged, not 1", "opens fresh: marked");
  eq(failure({ ...contentOf(pair("4530", "4503")), marked: 3, signed: 1 }, { start: true }), "$/marked: A card opens fresh: nothing judged, not 3", "opens fresh: done");
  // Bound values: each field's own range only (a variable may pass a pair the card refuses on its way).
  eq(failure({ ...contentOf(pair("4530", "4503")), b: 4530000 }, { boundValues: true }), undefined, "bound values: ranges only");
  eq(failure({ ...contentOf(pair("4530", "4503")), b: -1 }, { boundValues: true }), "$/b: The second number (in thousandths) is a whole number from 0 to 9999999999", "bound values: still a number the card holds");
});

test("state: total; a refused pair is an empty chart, never complete; compared shows the demonstration", () => {
  const p = pair("4530", "4503");
  eq(m.placeValueCompareState(contentOf(p)), { pair: p, marked: 0, signed: false, compared: 0 }, "fresh");
  eq(m.placeValueCompareState(contentOf(p, { marked: 3, signed: 1 })).signed, true, "signed");
  eq(m.placeValueCompareState(contentOf(p, { marked: 2, signed: 1 })).signed, false, "a stray sign before the decision does not count");
  eq(m.placeValueCompareState(contentOf(p, { marked: 7 })).marked, 3, "marked taken to what the pair allows");
  const demo = m.placeValueCompareState(contentOf(p, { compared: 2 }));
  eq([demo.marked, demo.signed, m.placeValueCompareDemonstrating(demo)], [2, false, true], "compared 2: two columns shown judged");
  eq(m.placeValueCompareState(contentOf(p, { compared: 4 })).signed, true, "compared at its end shows the sign");
  eq(m.placeValueCompareState(contentOf(p, { compared: 9 })).compared, 4, "compared taken to the pair's end");
  const refused = m.placeValueCompareState({ a: 4530000, b: 4530000, compared: 0, marked: 7, signed: 1 });
  eq([refused.fault, refused.pair.columns, m.placeValueCompareComplete(refused), m.placeValueCompareDecided(refused)], ["same_numeral", [], false, false], "a refused pair: empty chart, never complete");
  eq(reason(m.applyPlaceValueCompareTap(refused, { tap: "same", place: 3 })), "no_place", "a refused pair takes no tap");
  eq(m.placeValueCompareStartFault(refused), "This pair: the same numeral twice; there is nothing to compare (0.7 and 0.70 are a pair) (same_numeral)", "a practice start on a refused pair is refused with its fault");
  eq(m.placeValueCompareStartFault(demo), "A practice card starts with nothing demonstrated: compared is 2, not 0", "a practice start shows no demonstration");
  eq(m.placeValueCompareStartFault(m.placeValueCompareState(contentOf(p, { marked: 1 }))), "A practice card starts fresh: marked is 1, not 0", "a practice start judges nothing");
  eq(m.placeValueCompareStartFault(m.placeValueCompareState(contentOf(p))), undefined, "a fresh card starts a practice");
  eq(m.placeValueCompareState(undefined).fault, "unreadable", "no content");
});

test("taps by place index: judgements at a chart place, signs at 10 to 12; a demonstration takes none", () => {
  const p = pair("0.625", "0.7");
  const s = m.placeValueCompareState(contentOf(p));
  eq(m.PLACE_VALUE_COMPARE_TAP_PLACES.length, 13, "ten places and three signs");
  eq(m.PLACE_VALUE_COMPARE_TAP_PLACES.slice(10), ["greater", "equal", "less"], "the signs' places");
  eq([m.placeValueCompareSignIndex(">"), m.placeValueCompareSignIndex("<"), m.placeValueCompareSignAt(11), m.placeValueCompareSignAt(9)], [10, 12, "=", undefined], "sign indexes");
  const r = m.applyPlaceValueCompareTap(s, { tap: "same", place: 3 });
  assert.ok(r.ok);
  eq(r.state.marked, 1, "the ones (place index 3): same");
  eq(reason(m.applyPlaceValueCompareTap(s, { tap: "same", place: 4 })), "no_place", "the tens are not on this chart");
  eq(reason(m.applyPlaceValueCompareTap(s, { tap: "same", place: 10 })), "no_place", "a judgement at a sign");
  eq(reason(m.applyPlaceValueCompareTap(s, { tap: "sign", place: 3 })), "no_sign", "a sign at a column");
  eq(reason(m.applyPlaceValueCompareTap(s, { tap: "sign", place: 12 })), "not_decided", "the sentence is locked");
  eq(m.placeValueCompareRefusalText(s, { tap: "sign", place: 12 }, "en-US"), "Opens when a place differs, or every place is the same.", "the lock's fact");
  const decided = run(s, [0, "same"], [1, "different"]);
  eq(m.placeValueCompareRefusalText(decided, { tap: "sign", place: 10 }, "en-US"), "“0.625 > 0.7” is not true.", "a wrong sign is a fact");
  eq(m.placeValueCompareRefusalText(decided, { tap: "sign", place: 10 }, "zh-CN"), "「0.625 > 0.7」不成立。", "zh");
  const signed = m.applyPlaceValueCompareTap(decided, { tap: "sign", place: 12 });
  assert.ok(signed.ok);
  eq([m.placeValueCompareComplete(signed.state), m.placeValueCompareChanges(decided, signed.state)], [true, [{ field: "signed", before: 0, after: 1 }]], "the true sign completes the card");
  eq(reason(m.applyPlaceValueCompareTap(signed.state, { tap: "sign", place: 12 })), "already_signed", "once");
  eq(m.placeValueCompareChanges(s, r.state), [{ field: "marked", before: 0, after: 1 }], "a judgement changes marked");
  const demo = m.placeValueCompareState(contentOf(p, { compared: 1 }));
  for (const t of [{ tap: "same", place: 4 }, { tap: "different", place: 2 }, { tap: "sign", place: 12 }] as m.PlaceValueCompareTap[]) eq(reason(m.applyPlaceValueCompareTap(demo, t)), "demonstrating", "a demonstration takes no tap");
  eq(m.placeValueCompareRefusalText(demo, { tap: "same", place: 2 }, "zh-CN"), "这是演示。", "its fact");
});

test("compared: the demonstration's values and what the next one does", () => {
  const p = pair("4530", "4503");
  eq(m.placeValueCompareDemoEnd(p), 4, "three columns to the tens, then the sign");
  eq(m.placeValueCompareComparedNext(p, 0), "the next value, 1, judges the thousands", "next");
  eq(m.placeValueCompareComparedNext(p, 2), "the next value, 3, judges the tens", "the deciding column");
  eq(m.placeValueCompareComparedNext(p, 3), "the next value, 4, chooses the sign", "the sign");
  eq(m.placeValueCompareComparedNext(p, 4), "the sign is chosen at 4, the last value", "the end");
  const { steps } = m.placeValueCompareDemoSteps(p);
  eq(steps.map((step) => step.tap), ["same", "same", "different", "sign"], "Same, Same, Different, then the sign");
  eq(steps.map((step, k) => m.placeValueCompareDemoState(p, k + 1).marked === step.after.marked && m.placeValueCompareDemoState(p, k + 1).signed === step.after.signed), [true, true, true, true], "each value of compared is the chart after that step");
  eq(m.placeValueCompareStepSentences(p, 0, 4, "en-US"), [
    "Thousands: 4 and 4, the same. Look at the next place.",
    "Hundreds: 5 and 5, the same. Look at the next place.",
    "Tens: 3 and 0, the first place that differs, so the tens decide.",
    "So 4,530 > 4,503. The places after the tens don't matter.",
  ], "the demonstration's sentences, for the lesson's later sections");
  eq(m.placeValueCompareStepSentences(pair("0.7", "0.70"), 2, 4, "zh-CN"), ["百分位：0 和 0，一样。每一位都一样。", "所以 0.7 = 0.70。"], "an equal pair, zh");
});

test("facts and words: the card never names the larger number before the sign", () => {
  const p = pair("0.625", "0.7");
  let s = m.placeValueCompareStart(p);
  eq(m.placeValueCompareFacts(s), { columns: [0, -1, -2, -3], deciding: -1, digits: [6, 7], relation: "<", judged: 0, next: 0, decided: false, complete: false }, "facts for the lesson's later sections");
  eq(m.placeValueCompareFactText(s, "en-US"), "", "a fresh chart says nothing");
  eq(m.placeValueCompareInstruction(s, "en-US"), "From the left, judge each place until one is different.", "the instruction");
  s = run(s, [0, "same"]);
  eq(m.placeValueCompareFactText(s, "en-US"), "Ones: 0 and 0, the same.", "a same column");
  s = run(s, [1, "different"]);
  eq(m.placeValueCompareFactText(s, "en-US"), "Tenths: 6 and 7, the first place that differs. 0.7 has more tenths.", "the deciding column: which row has more of it, not which number is greater");
  eq(m.placeValueCompareFactText(s, "zh-CN"), "十分位：6 和 7，第一位不同。0.7 的 0.1 多。", "zh (decision 0029 §3)");
  eq(m.placeValueCompareInstruction(s, "zh-CN"), "在下面两个数中间选 >、= 或 <。", "the instruction opens the sentence");
  for (const text of [m.placeValueCompareFactText(s, "en-US"), m.placeValueCompareInstruction(s, "en-US")]) ok(!/[<>]\s*0\.7|greater|smaller|less than/u.test(text) && !text.includes("0.625 <"), `no conclusion before the sign: ${text}`);
  const done = (sign(s, "<") as { state: m.PlaceValueCompareState }).state;
  eq(m.placeValueCompareFactText(done, "en-US"), "✓ 0.625 < 0.7: the tenths decide; the places after them don't matter.", "the full sentence after the true sign");
  eq(m.placeValueCompareFactText(done, "zh-CN"), "✓ 0.625 < 0.7：由十分位决定，后面的数位不影响。", "zh");
  eq(m.placeValueCompareInstruction(done, "en-US"), "", "nothing more to do");
  const eqp = pair("0.7", "0.70");
  const all = run(m.placeValueCompareStart(eqp), [0, "same"], [1, "same"], [2, "same"]);
  eq(m.placeValueCompareFactText(all, "en-US"), "Hundredths: 0 and 0, the same. Every place is the same.", "every place the same: not \"equal\"");
  eq(m.placeValueCompareDoneText(eqp, "en-US"), "✓ 0.7 = 0.70: every place is the same.", "an equal pair's sentence");
  eq(m.placeValueCompareFacts(all).deciding, null, "no place decides an equal pair");
  eq(m.placeValueCompareHowTo({ a: 1, b: 2, compared: 0, marked: 0, signed: 0, language: "zh-CN" }), "从左边起，一位一位点它下面的「一样」或「不一样」，直到有一位不一样；然后在两个数中间选 >、= 或 <。", "the fixed how-to, the card's own");
  ok(!m.placeValueCompareHowTo({}).includes("main_visual"), "never a role");
});

test("plan: desktop sizes; room kept from the start; the numerals lined up on their points", () => {
  for (const lang of ["en", "zh"] as const) for (const item of COMPARE_PROBLEMS[lang]) for (const [a, b] of [[item.a, item.b], [item.practice.a, item.practice.b]] as const) {
    const A = compareNumber(a), B = compareNumber(b);
    const content = { a: A.value, b: B.value, a_decimals: A.dec, b_decimals: B.dec, compared: 0, marked: 0, signed: 0, ...(lang === "zh" ? { language: "zh-CN" } : {}) };
    const plan = m.planPlaceValueCompare(content);
    ok(plan.width + 38 <= 1000 && plan.sentence.width + 38 <= 1000, `${a} vs ${b}: fits a 1024 px window (${plan.width})`);
    const p = m.placeValueCompareState(content).pair;
    for (const k of [0, p.stop + 1]) {
      const done = m.planPlaceValueCompare({ ...content, marked: k });
      eq([done.width, done.height], [plan.width, plan.height], "the card never grows while it is worked");
    }
    // Disks never overlap the next line or leave their cell.
    const most = Math.max(...p.da, ...p.db);
    const column = plan.columns[0]!;
    const last = m.placeValueCompareDiskAt(plan, column, "b", most, most - 1);
    ok(last.y + plan.disk / 2 <= plan.rowB.y + plan.rowB.height, "the last disk stays in its cell");
    ok(plan.button.width <= column.width - 8 && plan.button.width >= 80, "the buttons fit the column");
  }
  const plan = m.planPlaceValueCompare({ a: 625, b: 700, b_decimals: 1, compared: 0, marked: 0, signed: 0 });
  eq([plan.labels.a, plan.labels.b], [{ whole: "0", frac: ".625" }, { whole: "0", frac: ".7" }], "written as given, split at the point");
  eq(plan.disk, 34, "four columns: 34 px disks");
  ok(plan.point !== undefined && plan.point.x > plan.columns[0]!.x + plan.columns[0]!.width && plan.point.x < plan.columns[1]!.x, "the point between the ones and the tenths");
  eq(m.planPlaceValueCompare({ a: 1000000000, b: 999999000, compared: 0, marked: 0, signed: 0 }).disk, 28, "seven columns: 28 px disks");
  eq(m.planPlaceValueCompare({ a: 1000000000, b: 999999000, compared: 0, marked: 0, signed: 0 }).columns[0]!.head, ["Millions"], "a short name keeps one line");
  eq(m.planPlaceValueCompare({ a: 120345000, b: 98765000, compared: 0, marked: 0, signed: 0 }).columns[0]!.head, ["Hundred", "thousands"], "a long one takes two");
  eq(m.planPlaceValueCompare({ a: 4530000, b: 4503000, compared: 0, marked: 0, signed: 0 }).lines, 2, "five hundreds: two lines of three");
});

test("builder: the card opens fresh; written decimals and bindings", () => {
  const built = buildPlaceValueCompare({ as: "cmp", role: "main_visual", place: { region: "main" }, a: { expression: "a", initial: 700 }, b: { expression: "b", initial: 700 }, b_decimals: { expression: "bd", initial: 2 }, compared: { expression: "compared", initial: 0 }, marked: { expression: "marked", initial: 0 }, signed: { expression: "signed", initial: 0 } });
  const content = (built.actions[0] as unknown as { content: m.PlaceValueCompareContent }).content;
  eq(content, { a: 700, b: 700, b_decimals: 2, compared: 0, marked: 0, signed: 0, bindings: [{ target: "a", expression: "a" }, { target: "b", expression: "b" }, { target: "b_decimals", expression: "bd" }, { target: "compared", expression: "compared" }, { target: "marked", expression: "marked" }, { target: "signed", expression: "signed" }] }, "every field bound by its bare name");
  eq(failure(content, { start: true }), undefined, "the built card is a fresh starting card");
  eq(built.pair.relation, "=", "0.7 = 0.70");
  assert.throws(() => buildPlaceValueCompare({ as: "x", role: "r", place: {}, a: 4530000, b: 4530000 }), /same_numeral/u); ported += 1;
  eq(typeof math.buildPlaceValueCompare, "function", "exported from the plugin");
  eq(typeof math.renderPlaceValueCompare, "function", "the view too");
  eq(m.placeValueCompareFromDecimal(70, 2), { value: 700, dec: 2 }, "a lesson plan's decimal: 0.70");
  eq(m.placeValueCompareFromDecimal(4530, 0), { value: 4530000, dec: 0 }, "4,530");
  eq(m.placeValueCompareFromDecimal(12345, 4), undefined, "four decimals");
});

test("ported model checks", () => {
  ok(ported > 16000, `${ported} checks`);
  console.log(`place-value compare: ${ported} ported checks`);
});
