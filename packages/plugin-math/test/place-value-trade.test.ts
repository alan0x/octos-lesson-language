// Adding and subtracting on the place-value chart (decision 0026): the rules, the invariants and the
// demonstration ported from the accepted sketch (sketch v2, test-model.mjs: every check but the typed-answer
// reader's, which the player's numeric answer replaces), then the card's content rules, state, tap rules,
// facts, words, plan and builder. Values are thousandths here, as on the chart (the sketch counted hundredths):
// 3,486 is 3486000. Numbers are the sketch's.
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/place-value-trade.js";
import { placeValueDiskLabel, placeValueNumeral } from "../src/place-value-chart.js";
import {
  PLACE_VALUE_TRADE_WORDS, applyPlaceValueTradeTap, placeValueTradeChanges, placeValueTradeFacts, placeValueTradeHowTo, placeValueTradeInstruction,
  placeValueTradeRefusalPlace, placeValueTradeRefusalText, placeValueTradeState, placeValueTradeStepSentences, planPlaceValueTrade,
  validatePlaceValueTradeContent, type PlaceValueTradeContent, type PlaceValueTradeProblem, type PlaceValueTradeState,
} from "../src/place-value-trade.js";
import { buildPlaceValueTrade } from "../src/place-value-trade-builder.js";
import * as math from "../src/index.js";
import { TRADE_PROBLEMS, tradeProblemKey } from "./place-value-trade-fixtures.js";

// ---------------------------------------------------------------- the sketch's model checks (test-model.mjs)

let ported = 0;
const eq = (actual: unknown, expected: unknown, what: string) => { assert.deepEqual(actual, expected, what); ported += 1; };
const v = (text: string): number => m.placeValueTradeParse(text)!.value!;
const OPS = { "+": "add", "-": "subtract" } as const;
/** The sketch's `makeProblem` on written numbers: unreadable, more than two decimals, or the card's own rules. */
function prob(a: string, op: "+" | "-", b: string): PlaceValueTradeProblem & { fault?: m.PlaceValueTradeFault } {
  const A = m.placeValueTradeParse(a), B = m.placeValueTradeParse(b);
  if (!A || !B) return { fault: "unreadable" } as PlaceValueTradeProblem & { fault: m.PlaceValueTradeFault };
  if (A.value === undefined || B.value === undefined) return { fault: "decimals" } as PlaceValueTradeProblem & { fault: m.PlaceValueTradeFault };
  return m.placeValueTradeMakeProblem(OPS[op], A.value, B.value) as PlaceValueTradeProblem & { fault?: m.PlaceValueTradeFault };
}
const row = (state: PlaceValueTradeState, key: keyof m.PlaceValueTradeCell) => state.problem.columns.map((p) => m.placeValueTradeCell(state, p)[key]);
const STEP = {
  bringDown: m.placeValueTradeBringDown, tradeTen: m.placeValueTradeTradeTen, takeAway: m.placeValueTradeTakeAway, breakOne: m.placeValueTradeBreakOne,
} as const;
type Step = [keyof typeof STEP, number];
const run = (state: PlaceValueTradeState, ...steps: Step[]): PlaceValueTradeState => steps.reduce((s, [fn, p]) => {
  const r = STEP[fn](s, p);
  assert.ok(r.ok, `${fn}(${p}) refused: ${r.ok ? "" : r.reason}`);
  return r.state;
}, state);
const reason = (r: m.PlaceValueTradeResult) => (r.ok ? undefined : r.reason);
const refusal = (r: m.PlaceValueTradeResult): { have?: number; need?: number; right?: number; taken?: boolean } => (r.ok ? {} : r);

/** A content holding a state, as the card's variables hold it: the two numbers and one status per column. */
function contentOf(state: PlaceValueTradeState, finished = 0): PlaceValueTradeContent {
  const { problem } = state;
  return {
    operation: problem.operation, top_place: problem.columns[0]!, low_place: problem.columns.at(-1)!, a: problem.a, b: problem.b, finished,
    places: problem.columns.map((place) => ({ as: math.PLACE_VALUE_PLACE_ALIASES[place]!, place, status: state.status[place]! })),
  };
}

test("sketch: exact values (thousandths here), nothing rounded", () => {
  eq(v("3,486"), 3486000, "commas");
  eq(v("2.75"), 2750, "decimal");
  eq(v("0.1") + v("0.2"), v("0.3"), "0.1 + 0.2 is exactly 0.3");
  eq(m.placeValueTradeParse("-3"), undefined, "no negatives");
  eq(placeValueNumeral(v("8007"), "en-US"), "8,007", "en commas");
  eq(placeValueNumeral(v("4.23"), "zh-CN"), "4.23", "zh decimal");
  eq(m.placeValueTradeNumeralFixed(v("5"), 2, "en-US"), "5.00", "row label keeps the column's decimals");
  eq(m.placeValueTradeNumeralFixed(v("3999.99"), 2, "en-US"), "3,999.99", "row label en");
  // (The sketch's eight typed-answer checks are not ported: a typed answer is the player's numeric answer.)
});

test("sketch: problems, their columns, and the refusals", () => {
  eq(prob("3486", "+", "2739").columns, [3, 2, 1, 0], "4 columns");
  eq(prob("6500", "+", "4700").columns, [4, 3, 2, 1, 0], "the sum gains a place: its column is drawn");
  eq(prob("5", "-", "1.36").columns, [0, -1, -2], "5 − 1.36: ones to hundredths");
  eq(prob("4999.99", "+", "3999.99").columns, [3, 2, 1, 0, -1, -2], "widest: 6 columns");
  eq(prob("389457", "+", "247568").columns, [5, 4, 3, 2, 1, 0], "six whole-number columns");
  eq(prob("999999", "+", "1").fault, "too_wide", "1,000,000 needs a seventh column");
  eq(prob("12345", "+", "0.05").fault, "too_wide", "seven columns with a decimal");
  eq(prob("3", "-", "5").fault, "negative", "no negative differences");
  eq(prob("1.234", "+", "2").fault, "decimals", "three decimals refused");
  eq(prob("1234", "+", "4321").fault, "no_trade", "adding with no carry refused");
  eq(prob("4.5", "+", "3.4").fault, "no_trade", "decimal adding with no carry refused");
  eq(prob("8765", "-", "4321").fault, "no_trade", "subtracting with no borrow refused");
  eq(prob("5960", "+", "2047").fault, undefined, "a carry only in the tens is enough");
  eq(prob("abc", "+", "1").fault, "unreadable", "unreadable");
  eq(m.placeValueTradeProblemText(prob("7352", "-", "2618"), "en-US"), "7,352 − 2,618", "problem text en");
  eq(m.placeValueTradeProblemText(prob("3000", "-", "1468"), "zh-CN"), "3000 − 1468", "problem text zh");
  eq(placeValueDiskLabel(4, "zh-CN"), "1万", "zh disk 1万");
  eq(placeValueDiskLabel(-2, "en-US"), "0.01", "hundredth disk");
});

test("sketch: adding keeps the two numbers apart, one per row; ↓ puts a column together; a ten is traded", () => {
  let p = prob("3486", "+", "2739");
  let s = m.placeValueTradeStart(p);
  eq(row(s, "top"), [3, 4, 8, 6], "row 1 is the first number");
  eq(row(s, "second"), [2, 7, 3, 9], "row 2 is the second number");
  eq(row(s, "answer"), [0, 0, 0, 0], "nothing below the line yet");
  eq(row(s, "carry"), [0, 0, 0, 0], "no carries yet");
  eq(m.placeValueTradeChartValue(s), v("6225"), "the chart holds a + b");
  eq(m.placeValueTradeComplete(s), false, "not finished");

  let r = m.placeValueTradeBringDown(s, 0);
  assert.ok(r.ok);
  eq([r.ok, m.placeValueTradeCell(r.state, 0).answer, m.placeValueTradeCell(r.state, 0).answerRing, m.placeValueTradeCell(r.state, 0).top], [true, 15, true, 0], "6 + 9 come down together: 15, ten ringed");
  eq(reason(m.placeValueTradeBringDown(r.state, 0)), "already_down", "once per column");
  eq(reason(m.placeValueTradeTradeTen(s, 0)), "not_down", "no ten to trade above the line");
  s = run(s, ["bringDown", 0], ["tradeTen", 0]);
  eq([m.placeValueTradeCell(s, 0).answer, m.placeValueTradeCell(s, 1).carry], [5, 1], "ten 1s leave, one 10 waits in the tens' carry spot");
  eq(reason(m.placeValueTradeTradeTen(s, 0)), "not_ten", "5 ones: no ten");
  s = run(s, ["bringDown", 1]);
  eq([m.placeValueTradeCell(s, 1).answer, m.placeValueTradeCell(s, 1).carry], [12, 0], "the carry comes down with its column: 8 + 3 + 1");
  eq(m.placeValueTradeChartValue(s), v("6225"), "value kept");
  eq(reason(m.placeValueTradeTradeTen(m.placeValueTradeStart(prob("4000", "+", "6000")), 3)), "not_down", "top column not down");

  // Free order: a carry into a column already down lands below its line and can make a new ten (5,960 + 2,047).
  p = prob("5960", "+", "2047");
  s = run(m.placeValueTradeStart(p), ["bringDown", 2]);
  eq(m.placeValueTradeCell(s, 2).answer, 9, "hundreds first: 9 + 0");
  s = run(s, ["bringDown", 1]);
  eq([m.placeValueTradeCell(s, 1).answer, m.placeValueTradeCell(s, 1).answerRing], [10, true], "tens: 6 + 4 = a ringed ten");
  r = m.placeValueTradeTradeTen(s, 1);
  assert.ok(r.ok && r.anim.kind === "trade");
  eq([r.anim.kind === "trade" && r.anim.landed, m.placeValueTradeCell(r.state, 2).answer, m.placeValueTradeCell(r.state, 2).answerRing], ["answer", 10, true], "the carry drops into the hundreds' answer: a new ten forms there");
  s = run(r.state, ["tradeTen", 2]);
  eq(m.placeValueTradeCell(s, 3).carry, 1, "and that ten goes on to the thousands' carry spot");
  s = run(s, ["bringDown", 3], ["bringDown", 0]);
  eq([m.placeValueTradeComplete(s), row(s, "answer")], [true, [8, 0, 0, 7]], "every column down, no ten left: finished, reads 8,007");

  // The gained top column (6,500 + 4,700) has empty rows and only a carry; ↓ brings the carry down.
  p = prob("6500", "+", "4700");
  s = run(m.placeValueTradeStart(p), ["bringDown", 0], ["bringDown", 1], ["bringDown", 2], ["tradeTen", 2], ["bringDown", 3], ["tradeTen", 3]);
  eq([m.placeValueTradeCell(s, 4).carry, m.placeValueTradeCell(s, 4).top, m.placeValueTradeCell(s, 4).second], [1, 0, 0], "gained column: one carried disk, nothing in the rows");
  eq(m.placeValueTradeComplete(s), false, "not finished until that carry comes down");
  s = run(s, ["bringDown", 4]);
  eq([m.placeValueTradeComplete(s), row(s, "answer")], [true, [1, 1, 2, 0, 0]], "11,200");
  eq(reason(m.placeValueTradeTradeTen(m.placeValueTradeStart(prob("9", "+", "1")), 0)), "not_down", "9 + 1 starts above the line");
});

test("sketch: subtracting, row 1 the first number, row 2 the take-away rings; breaks, free order and chains", () => {
  let p = prob("7352", "-", "2618");
  let s = m.placeValueTradeStart(p);
  eq([row(s, "top"), row(s, "second"), row(s, "answer")], [[7, 3, 5, 2], [2, 6, 1, 8], [0, 0, 0, 0]], "rows: 7,352 in disks, 2,618 in rings");
  let r = m.placeValueTradeTakeAway(s, 0);
  eq([reason(r), refusal(r).have, refusal(r).need], ["not_enough", 2, 8], "2 ones can't give 8: refused with the facts");
  eq(reason(m.placeValueTradeBreakOne(s, 0)), "no_right", "nothing right of the lowest column");
  r = m.placeValueTradeBreakOne(s, 2);
  eq([reason(r), refusal(r).right, refusal(r).have, refusal(r).need, refusal(r).taken], ["not_needed", 1, 5, 1, false], "the tens have 5, enough for 1: a hundred won't break");
  s = run(s, ["breakOne", 1]);
  eq([m.placeValueTradeCell(s, 1).top, m.placeValueTradeCell(s, 0).top, m.placeValueTradeCell(s, 0).topRing], [4, 12, true], "one ten → ten ones, drawn as one ringed group");
  eq(reason(m.placeValueTradeBreakOne(s, 1)), "not_needed", "no second break into the ones");
  eq(m.placeValueTradeChartValue(s), v("7352"), "a break keeps the value");
  s = run(s, ["takeAway", 0]);
  eq([m.placeValueTradeCell(s, 0).answer, m.placeValueTradeCell(s, 0).top, m.placeValueTradeCell(s, 0).answerRing], [4, 0, false], "12 − 8: 4 come down");
  eq(reason(m.placeValueTradeTakeAway(s, 0)), "already_taken", "once per column");
  eq(m.placeValueTradeChartValue(s) + m.placeValueTradeTakenValue(s), v("7352"), "chart plus taken is the first number");

  // Free order while subtracting: tens first, then the ones borrow from the tens' answer (7,352 − 2,618).
  s = run(m.placeValueTradeStart(p), ["takeAway", 3], ["takeAway", 1]);
  eq([m.placeValueTradeCell(s, 1).answer, m.placeValueTradeCell(s, 1).top], [4, 0], "tens taken first: 4 below the line");
  r = m.placeValueTradeBreakOne(s, 1);
  assert.ok(r.ok);
  eq([r.ok, r.anim.kind === "break" && r.anim.landed, m.placeValueTradeCell(r.state, 1).answer, m.placeValueTradeCell(r.state, 0).top], [true, "top", 3, 12], "a disk below the line breaks for the ones");
  s = run(r.state, ["takeAway", 0]);
  r = m.placeValueTradeTakeAway(s, 2);
  eq([reason(r), refusal(r).have], ["not_enough", 3], "hundreds 3 < 6");
  s = run(s, ["breakOne", 3], ["takeAway", 2]);
  eq([m.placeValueTradeComplete(s), row(s, "answer")], [true, [4, 7, 3, 4]], "4,734 in any order");

  // A borrow across zeros is a chain (50,003 − 2,476); a zero-ring column still has to come down.
  p = prob("50003", "-", "2476");
  s = m.placeValueTradeStart(p);
  eq(reason(m.placeValueTradeBreakOne(s, 3)), "none_to_break", "empty thousands: nothing to break");
  eq(m.placeValueTradeBreakSource(s, 0), 4, "the ones are short; the nearest disk on the left is a ten thousand");
  eq(m.placeValueTradeBreakOne(s, 4).ok, true, "a first tap on a 10,000 breaks it, across the empty columns");
  eq(m.placeValueTradeWantsTen(s, 3), true, "the empty thousands pass a ten on toward the short ones");
  s = run(s, ["breakOne", 4]);
  eq([m.placeValueTradeCell(s, 4).top, m.placeValueTradeCell(s, 3).top, m.placeValueTradeCell(s, 3).topRing], [4, 10, true], "1 ten thousand → 10 thousands");
  eq(reason(m.placeValueTradeBreakOne(s, 4)), "not_needed", "the thousands now have disks: no second break");
  s = run(s, ["breakOne", 3], ["breakOne", 2], ["breakOne", 1]);
  eq(row(s, "top"), [4, 9, 9, 9, 13], "4 | 9 | 9 | 9 | 13");
  s = run(s, ["takeAway", 0], ["takeAway", 1], ["takeAway", 2], ["takeAway", 3]);
  eq(m.placeValueTradeComplete(s), false, "the ten thousands still have to come down");
  s = run(s, ["takeAway", 4]);
  eq([m.placeValueTradeComplete(s), row(s, "answer")], [true, [4, 7, 5, 2, 7]], "47,527");
  // A chain through a column already taken away (its answer is empty): ten land below its line, then one goes on.
  p = prob("150", "-", "56");
  s = run(m.placeValueTradeStart(p), ["takeAway", 1]);
  eq(m.placeValueTradeCell(s, 1).answer, 0, "150 − 56: tens 5 − 5 = 0 first");
  r = m.placeValueTradeBreakOne(s, 2);
  assert.ok(r.ok);
  eq([r.ok, r.anim.kind === "break" && r.anim.landed, m.placeValueTradeCell(r.state, 1).answer, m.placeValueTradeCell(r.state, 1).answerRing], [true, "answer", 10, true], "the hundred breaks into the tens' answer");
  eq(m.placeValueTradeComplete(run(r.state, ["takeAway", 2])), false, "a ten below the line is not finished");
  s = run(r.state, ["breakOne", 1], ["takeAway", 0], ["takeAway", 2]);
  eq([m.placeValueTradeComplete(s), row(s, "answer")], [true, [0, 9, 4]], "094 = 94");
});

test("sketch: the lesson's variables are 3 + columns, at most 9", () => {
  const p = prob("389457", "+", "247568");
  eq(m.placeValueTradeVariableCount(p), 9, "6 columns adding: 9 variables");
  eq(m.placeValueTradeVariableCount(prob("9000", "-", "2345.67")), 9, "6 columns subtracting: 9 variables");
  eq(m.placeValueTradeVariableCount(p) <= m.PLACE_VALUE_TRADE_MAX_VARIABLES, true, "fits the 16-variable lesson");
});

const ANSWERS: Record<string, string> = {
  "3486+2739": "6225", "4658+1573": "6231", "5960+2047": "8007", "3870+4136": "8006", "68957+21068": "90025", "57846+32175": "90021",
  "7352-2618": "4734", "8461-3729": "4732", "50003-2476": "47527", "40002-3585": "36417", "6004-2756": "3248", "7003-4865": "2138",
  "2.75+1.48": "4.23", "3.86+2.57": "6.43", "5-1.36": "3.64", "7-2.48": "4.52", "4999.99+3999.99": "8999.98", "2999.99+4999.99": "7999.98",
  "9000-2345.67": "6654.33", "389457+247568": "637025", "456789+278436": "735225", "8000-3456.78": "4543.22", "4527+1685": "6212", "3648+2575": "6223", "8452-3671": "4781", "9361-4582": "4779",
  "3000-1468": "1532", "5000-2367": "2633", "3.68+4.57": "8.25", "4.86+2.38": "7.24", "8.2-3.75": "4.45", "9.3-4.68": "4.62",
};

test("sketch: every listed problem and practice pair, exhaustive over all tap orders", () => {
  const all: Array<{ a: string; op: "+" | "-"; b: string }> = [];
  for (const lang of ["en", "zh"] as const) {
    for (const item of TRADE_PROBLEMS[lang]) for (const q of [item, item.practice]) if (!all.some((x) => tradeProblemKey(x) === tradeProblemKey(q))) all.push(q);
  }
  eq(all.length, Object.keys(ANSWERS).length, "every listed problem and practice pair has an answer here");
  let totalStates = 0, deadEnds = 0;
  const room = { answer: 0, top: 0 };
  for (const q of all) {
    const problem = prob(q.a, q.op, q.b), key = tradeProblemKey(q), want = v(ANSWERS[key]!);
    eq(problem.result, want, `${key} = ${ANSWERS[key]}`);
    eq(m.placeValueTradeVariableCount(problem) <= m.PLACE_VALUE_TRADE_MAX_VARIABLES, true, `${key}: ${m.placeValueTradeVariableCount(problem)} variables`);
    const states = m.placeValueTradeReachable(problem);
    totalStates += states.length;
    let bad = 0, wrongEnd = 0, stuck = 0, roundTrip = 0;
    for (const st of states) {
      if (!m.placeValueTradeInvariantHolds(st)) bad += 1; // every reachable state: counts legal, value kept
      if (m.placeValueTradeComplete(st) && (m.placeValueTradeChartValue(st) !== want || problem.columns.some((c) => m.placeValueTradeCell(st, c).answer > 9 || m.placeValueTradeCell(st, c).top || m.placeValueTradeCell(st, c).carry))) wrongEnd += 1;
      if (!m.placeValueTradeCanStillFinish(st)) stuck += 1;
      // The sketch rebuilt the chart from its variables; here the card rebuilds it from its content.
      if (JSON.stringify(placeValueTradeState(contentOf(st)).status) !== JSON.stringify(st.status)) roundTrip += 1;
      for (const c of problem.columns) { room.answer = Math.max(room.answer, m.placeValueTradeCell(st, c).answer); room.top = Math.max(room.top, m.placeValueTradeCell(st, c).top); }
    }
    eq(bad, 0, `${key}: the invariant holds in all ${states.length} reachable states`);
    eq(wrongEnd, 0, `${key}: every finished chart reads ${ANSWERS[key]}, one digit per column, nothing left above the line`);
    eq(stuck, 0, `${key}: no dead end in any tap order`);
    if (problem.op === "-") { // whenever ↓ is refused as short, the marked source can break, and only it
      let wrongSource = 0;
      for (const st of states) {
        for (const c of problem.columns) {
          if (reason(m.placeValueTradeTakeAway(st, c)) !== "not_enough") continue;
          const src = m.placeValueTradeBreakSource(st, c);
          const between = problem.columns.filter((x) => src !== undefined && x > c && x < src && m.placeValueTradeCell(st, x).top + m.placeValueTradeCell(st, x).answer > 0);
          if (src === undefined || !m.placeValueTradeBreakOne(st, src).ok || between.length) wrongSource += 1;
        }
      }
      eq(wrongSource, 0, `${key}: a short column's marked source is a legal break, the nearest one`);
    }
    eq(roundTrip, 0, `${key}: the chart rebuilds from (a, b, one status per column)`);
    deadEnds += stuck;
    eq(states.filter((st) => m.placeValueTradeComplete(st)).length, 1, `${key}: exactly one finished chart`);
    // The demonstration: one step per column, lowest first; after step k exactly k columns are finished.
    const { steps, final } = m.placeValueTradeDemoSteps(problem);
    eq(steps.map((st) => st.place), [...problem.columns].reverse(), `${key}: one step per column, lowest first`);
    eq([m.placeValueTradeComplete(final), m.placeValueTradeChartValue(final)], [true, want], `${key}: the demonstration ends on the answer`);
    for (let k = 0; k <= problem.columns.length; k += 1) {
      const d = m.placeValueTradeDemoState(problem, k);
      eq(m.placeValueTradeFinishedCount(d), k, `${key}: demoState(${k}) has ${k} columns finished`);
      eq(m.placeValueTradeDemoState(problem, k), d, `${key}: demoState(${k}) is the same every time`);
    }
  }
  eq(deadEnds, 0, "no dead ends anywhere: “Start again” never has to rescue a child");
  eq([room.answer, room.top], [19, 16], "most disks in one cell of the listed problems: 19 below the line (9 + 9 + 1), 16 in row 1 (6 + a broken ten)");
  eq(Math.max(...m.placeValueTradeReachable(prob("18", "-", "9")).map((st) => m.placeValueTradeCell(st, 0).top)), 18, "in principle row 1 holds up to 18 (8 + a broken ten)");
  eq(m.placeValueTradeRoomNeeded(prob("4999.99", "+", "3999.99")).answer, 19, "the widest adding reserves room for 19");
  assert.throws(() => m.placeValueTradeDemoState(prob("3486", "+", "2739"), 5), /0..4/u);
  ported += 1;
  assert.ok(totalStates > 1000, `${totalStates} reachable states searched`);
});

test("sketch: 300 random problems, exhaustive: invariant, no dead end, one finished chart that reads the answer", () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let tried = 0;
  while (tried < 300) {
    const dec = rnd(3), digits = 1 + rnd(4);
    const num = () => { let w = ""; for (let i = 0; i < digits; i += 1) w += rnd(10); return dec ? `${w}.${String(rnd(10 ** dec)).padStart(dec, "0")}` : w; };
    const op = rnd(2) ? "+" : "-";
    let a = num(), b = num();
    if (op === "-" && v(a) < v(b)) [a, b] = [b, a];
    const problem = prob(a, op, b);
    if (problem.fault) continue;
    tried += 1;
    const states = m.placeValueTradeReachable(problem);
    const okAll = states.every((st) => m.placeValueTradeInvariantHolds(st) && m.placeValueTradeCanStillFinish(st));
    const ends = states.filter((st) => m.placeValueTradeComplete(st));
    assert.ok(okAll && ends.length === 1 && m.placeValueTradeChartValue(ends[0]!) === problem.result, `${a} ${op} ${b}`);
  }
  eq(tried, 300, "300 random problems: invariant, no dead end, the one finished chart is the answer");
});

test("sketch: the demonstration's steps, as the captions name them", () => {
  eq(m.placeValueTradeDemoSteps(prob("50003", "-", "2476")).steps[0]!.actions.map((a) => `${a.kind}${a.place}`), ["break4", "break3", "break2", "break1", "take0"], "the ones step carries the break across the zeros");
  eq(m.placeValueTradeDemoSteps(prob("3486", "+", "2739")).steps.map((st) => st.actions.map((a) => a.kind).join("+")), ["down+trade", "down+trade", "down+trade", "down"], "3,486 + 2,739: down and trade, three times; then down");
  eq(m.placeValueTradeDemoSteps(prob("5960", "+", "2047")).steps.map((st) => st.actions.length), [1, 2, 2, 1], "5,960 + 2,047: carries in a row");
});

test("every sketch model check is ported except the 8 typed-answer checks (737 - 8 = 729)", () => {
  assert.equal(ported, 729);
});

// ---------------------------------------------------------------- the card: content, state, taps, facts

const card = (a: string, op: "+" | "-", b: string, extra: Partial<PlaceValueTradeContent> = {}): PlaceValueTradeContent => {
  const problem = prob(a, op, b);
  return { ...contentOf(m.placeValueTradeStart(problem)), ...extra };
};
const invalid = (content: unknown, pattern: RegExp, options: { boundValues?: boolean } = {}) =>
  assert.throws(() => validatePlaceValueTradeContent(content, "$", (path, message) => { throw new Error(`${path}: ${message}`); }, options), pattern);
const valid = (content: unknown, options: { boundValues?: boolean } = {}) =>
  validatePlaceValueTradeContent(content, "$", (path, message) => { throw new Error(`${path}: ${message}`); }, options);

test("content rules: a card of the sketch's problems is valid, as written and at each demonstration step", () => {
  for (const lang of ["en", "zh"] as const) {
    for (const item of TRADE_PROBLEMS[lang]) {
      const content = { ...card(item.a, item.op, item.b), ...(lang === "zh" ? { language: "zh-CN" as const } : {}) };
      valid(content);
      for (let k = 0; k <= content.places.length; k += 1) valid({ ...content, finished: k });
    }
  }
});

test("content rules: the pairs the card refuses, at the number the fault is about (decision 0026 §5)", () => {
  invalid(card("3486", "+", "2739", { b: v("4321"), a: v("1234"), top_place: 3, low_place: 0 }), /\$\/b: 1,234 \+ 4,321 has no column that carries: this card is for trading \(no_trade\)/);
  invalid(card("7352", "-", "2618", { a: v("8765"), b: v("4321") }), /\$\/b: 8,765 − 4,321 has no column that borrows/);
  invalid(card("7352", "-", "2618", { a: v("2618"), b: v("7352") }), /\$\/b: 2,618 − 7,352 is below zero: the first number is the larger \(negative\)/);
  invalid(card("389457", "+", "247568", { a: v("999999"), b: v("1") }), /\$\/a: 999,999 \+ 1 needs 7 columns; the card draws at most 6, up to the hundred thousands \(too_wide\)/);
  invalid(card("2.75", "+", "1.48", { a: 2755 }), /\$\/a: 2.755 has more than two decimals \(decimals\)/);
  invalid({ ...card("2.75", "+", "1.48"), top_place: 5, low_place: -2 }, /draws at most 6 columns; 5 to -2 is 8 \(too_wide\)/);
  // The card draws only the columns its pair needs: a practice pair of another shape is refused.
  invalid(card("3486", "+", "2739", { a: v("13486") }), /\$\/a: 13,486 has a place above the card's columns/);
  invalid(card("3486", "+", "2739", { a: v("6500"), b: v("4700") }), /top_place: 6,500 \+ 4,700 needs the columns from ten thousands to ones; the card draws thousands to ones/);
  invalid({ ...card("6500", "+", "4700"), a: v("3486"), b: v("2739") }, /top_place: 3,486 \+ 2,739 needs the columns from thousands to ones; the card draws ten thousands to ones/);
  invalid(card("3486", "+", "2739", { a: v("3486.5") }), /3,486.5 has a place below the card's columns/);
});

test("content rules: fields, columns, statuses and the demonstration", () => {
  invalid({ ...card("3486", "+", "2739"), label: "x" }, /Unknown place-value trade field 'label'/);
  invalid({ ...card("3486", "+", "2739"), language: "fr-FR" }, /language: The card speaks en-US or zh-CN/);
  invalid({ ...card("3486", "+", "2739"), operation: "multiply" }, /operation is 'add' or 'subtract'/);
  invalid({ ...card("3486", "+", "2739"), places: card("3486", "+", "2739").places.slice(1) }, /lists 4 places, highest first/);
  invalid({ ...card("3486", "+", "2739"), places: [...card("3486", "+", "2739").places].reverse() }, /Place 1 is 3 \(Thousands\)/);
  invalid({ ...card("3486", "+", "2739"), a: -1 }, /first number \(in thousandths\) is a whole number from 0 to 999999990/);
  invalid({ ...card("3486", "+", "2739"), b: 1.5 }, /second number \(in thousandths\) is a whole number/);
  invalid({ ...card("3486", "+", "2739"), finished: 5 }, /columns finished is a whole number from 0 to 4/);
  invalid({ ...card("3486", "+", "2739"), finished: 1.5 }, /columns finished is a whole number/);
  invalid(card("3486", "+", "2739", { places: card("3486", "+", "2739").places.map((p) => ({ ...p, status: 3 })) }), /status of the thousands is a whole number from 0 to 2/);
  // A state no taps make: the tens traded while the ones are still up is fine (free order), a status the column can't have is not.
  const s = run(m.placeValueTradeStart(prob("3486", "+", "2739")), ["bringDown", 1]);
  valid(contentOf(s));
  const sub = m.placeValueTradeStart(prob("7352", "-", "2618"));
  invalid(contentOf({ ...sub, status: { ...sub.status, 0: 1 } }), /No taps make these column statuses \(0001\) from the start of 7,352 − 2,618/);
  invalid({ ...contentOf(s), finished: 1 }, /finished: A demonstration \(columns finished\) plays on a fresh chart/);
  // At a bound value only each field's own range is checked.
  valid(card("3486", "+", "2739", { a: v("1234"), b: v("4321") }), { boundValues: true });
  valid({ ...contentOf({ ...s, status: { ...s.status, 1: 2 } }), finished: 2 }, { boundValues: true });
  invalid({ ...card("3486", "+", "2739"), finished: 5 }, /from 0 to 4/, { boundValues: true });
  invalid(card("3486", "+", "2739", { a: v("13486") }), /place above the card's columns/, { boundValues: true });
});

test("the card's state is total: any content draws, numbers between values never draw part of a disk", () => {
  const content = card("3486", "+", "2739");
  assert.deepEqual(placeValueTradeState(content).problem.columns, [3, 2, 1, 0]);
  // A demonstration animating 0 -> 2 shows each column in turn: 1.5 is one column finished.
  const half = placeValueTradeState({ ...content, finished: 1.5 });
  assert.equal(half.finished, 1);
  assert.equal(m.placeValueTradeFinishedCount(half), 1);
  assert.deepEqual(row(half, "answer"), [0, 0, 0, 5]);
  assert.deepEqual(row(half, "carry"), [0, 0, 1, 0]);
  // Two columns finished: the program has played both bring-downs and both trades.
  assert.deepEqual(row(placeValueTradeState({ ...content, finished: 2 }), "answer"), [0, 0, 2, 5]);
  // Out of range, not whole, missing: clamped, never negative, never thrown.
  const odd = placeValueTradeState({ ...content, a: 3486123.4, b: -5, finished: 99, places: [{ place: 0, status: 7 }] });
  assert.equal(odd.problem.a, 3486120);
  assert.equal(odd.problem.b, 0);
  assert.equal(odd.finished, 4);
  assert.deepEqual(placeValueTradeState({}).problem.columns, [0]);
  assert.deepEqual(placeValueTradeState(null).status, { 0: 0 });
  // Statuses no taps make still draw whole counts (a variable's corner): nothing below zero.
  const sub = card("7352", "-", "2618");
  const corner = placeValueTradeState({ ...sub, places: sub.places.map((p) => ({ ...p, status: 1 })) });
  for (const p of corner.problem.columns) for (const value of Object.values(m.placeValueTradeCell(corner, p))) if (typeof value === "number") assert.ok(Number.isInteger(value));
  // A pair the card refuses demonstrates nothing: its statuses are drawn.
  assert.deepEqual(placeValueTradeState({ ...card("3486", "+", "2739", { a: v("9999"), b: v("9999") }), finished: 4 }).status, { 3: 0, 2: 0, 1: 0, 0: 0 });
});

test("taps: ↓, a ringed ten and a disk, by the sketch's rules; what a tap changes is one column's status", () => {
  const start = placeValueTradeState(card("3486", "+", "2739"));
  const down = applyPlaceValueTradeTap(start, { tap: "down", place: 0 });
  assert.ok(down.ok);
  assert.deepEqual(placeValueTradeChanges(start, down.state), [{ place: 0, field: "status", before: 0, after: 1 }]);
  const trade = applyPlaceValueTradeTap(down.state, { tap: "trade", place: 0 });
  assert.ok(trade.ok);
  assert.deepEqual(placeValueTradeChanges(down.state, trade.state), [{ place: 0, field: "status", before: 1, after: 2 }]);
  assert.equal(reason(applyPlaceValueTradeTap(start, { tap: "break", place: 1 })), "wrong_op");
  assert.equal(reason(applyPlaceValueTradeTap(start, { tap: "down", place: 4 })), "no_place");
  const sub = placeValueTradeState(card("7352", "-", "2618"));
  const broke = applyPlaceValueTradeTap(sub, { tap: "break", place: 1 });
  assert.ok(broke.ok);
  assert.deepEqual(placeValueTradeChanges(sub, broke.state), [{ place: 0, field: "status", before: 0, after: 2 }]);
  assert.equal(reason(applyPlaceValueTradeTap(sub, { tap: "trade", place: 0 })), "wrong_op");
});

test("facts: the chart, the columns finished, and the next value with the column it would finish", () => {
  const problem = prob("3486", "+", "2739");
  const start = placeValueTradeFacts(m.placeValueTradeStart(problem));
  assert.deepEqual([start.value, start.taken, start.finished, start.complete, start.next], [v("6225"), 0, 0, false, { finished: 1, place: 0 }]);
  assert.deepEqual(start.cells.map((c) => [c.place, c.top, c.second]), [[3, 3, 2], [2, 4, 7], [1, 8, 3], [0, 6, 9]]);
  const two = placeValueTradeFacts(m.placeValueTradeDemoState(problem, 2));
  assert.deepEqual([two.finished, two.next], [2, { finished: 3, place: 2 }], "writing 3 finishes the hundreds");
  const end = placeValueTradeFacts(m.placeValueTradeDemoState(problem, 4));
  assert.deepEqual([end.finished, end.complete, end.next, end.cells.map((c) => c.answer)], [4, true, undefined, [6, 2, 2, 5]]);
  const sub = placeValueTradeFacts(m.placeValueTradeDemoState(prob("7352", "-", "2618"), 1));
  assert.deepEqual([sub.value + sub.taken, sub.taken, sub.finished], [v("7352"), v("8"), 1]);
});

test("words: refusals state facts with their counts, in the card's language, said at their column", () => {
  const sub = placeValueTradeState(card("7352", "-", "2618"));
  assert.equal(placeValueTradeRefusalText(sub, { tap: "down", place: 0 }), "This column has 2; taking away 8 needs more.");
  assert.equal(placeValueTradeRefusalText(sub, { tap: "down", place: 0 }, "zh-CN"), "这一位只有 2 个，拿走 8 个不够。");
  assert.equal(placeValueTradeRefusalText(sub, { tap: "break", place: 2 }), "The tens have 5; taking away 1 needs no more.");
  assert.equal(placeValueTradeRefusalText(sub, { tap: "break", place: 2 }, "zh-CN"), "十位有 5 个，拿走 1 个已经够了。");
  assert.equal(placeValueTradeRefusalPlace(sub, { tap: "break", place: 2 }), 1, "a break not needed is said at the column on the right");
  assert.equal(placeValueTradeRefusalText(sub, { tap: "break", place: 0 }), "There is no column to the right to break into.");
  const taken = run(m.placeValueTradeStart(prob("7352", "-", "2618")), ["takeAway", 1]);
  assert.equal(placeValueTradeRefusalText(taken, { tap: "break", place: 2 }), "The tens are already taken away.");
  assert.equal(placeValueTradeRefusalText(taken, { tap: "down", place: 1 }), "This column's take-away is done.");
  const zeros = placeValueTradeState(card("50003", "-", "2476"));
  assert.equal(placeValueTradeRefusalText(zeros, { tap: "break", place: 3 }), "This column is empty.");
  assert.equal(placeValueTradeRefusalText(zeros, { tap: "break", place: 3 }, "zh-CN"), "这一位没有圆片。");
  const add = placeValueTradeState(card("3486", "+", "2739"));
  assert.equal(placeValueTradeRefusalText(add, { tap: "trade", place: 0 }), "Nothing below the line here yet.");
  const down = run(add, ["bringDown", 1]);
  assert.equal(placeValueTradeRefusalText(down, { tap: "down", place: 1 }), "This column is already below the line.");
  assert.equal(placeValueTradeRefusalText(run(placeValueTradeState(card("5960", "+", "2047")), ["bringDown", 2]), { tap: "trade", place: 2 }), "Fewer than ten here.");
  assert.equal(placeValueTradeRefusalText(down, { tap: "down", place: 1 }, "zh-CN"), "这一位已经在横线下面了。");
  assert.equal(placeValueTradeRefusalText(run(placeValueTradeState(card("389457", "+", "247568")), ["bringDown", 5]), { tap: "trade", place: 5 }), "Fewer than ten here.");
  assert.equal(placeValueTradeRefusalText(down, { tap: "down", place: 0 }), "", "a tap the rules take is no refusal");
});

test("words: the one-line instruction follows the chart; the how-to is fixed per operation and language", () => {
  const add = placeValueTradeState(card("3486", "+", "2739"));
  assert.equal(placeValueTradeInstruction(add), "Tap ↓ to put a column together.");
  assert.equal(placeValueTradeInstruction(run(add, ["bringDown", 0])), "Tap the ringed ten to trade it for one 10.");
  assert.equal(placeValueTradeInstruction(run(add, ["bringDown", 0]), "zh-CN"), "点圈起来的十个，换成一个十。");
  assert.equal(placeValueTradeInstruction(m.placeValueTradeDemoState(add.problem, 4)), "Type the total below.");
  const zeros = placeValueTradeState(card("50003", "-", "2476"));
  assert.equal(placeValueTradeInstruction(zeros), "Tap ↓ to take away. Short? Break a disk from a column to the left into ten.");
  assert.equal(placeValueTradeInstruction(zeros, "en-US", 0), "Tap a marked 10,000 to break it into ten 1,000s.");
  assert.equal(placeValueTradeInstruction(zeros, "zh-CN", 0), "点一个标出的一万，把它拆成十个一千。");
  assert.equal(placeValueTradeInstruction(m.placeValueTradeDemoState(zeros.problem, 5), "zh-CN"), "在下面写出差。");
  assert.equal(placeValueTradeHowTo(card("3486", "+", "2739")), PLACE_VALUE_TRADE_WORDS["en-US"].howto.add);
  assert.equal(placeValueTradeHowTo({ ...card("7352", "-", "2618"), language: "zh-CN" }), "点 ↓ 拿走。不够时，把左边某一位的一个圆片拆成十个。");
});

test("words: each demonstration step, as the sketch's captions say it (for later sections, never drawn)", () => {
  assert.deepEqual(placeValueTradeStepSentences(prob("3486", "+", "2739"), 1), ["Ones: put both rows together.", "Ten 1s make one 10. It goes above the tens."]);
  assert.deepEqual(placeValueTradeStepSentences(prob("3486", "+", "2739"), 2), ["Tens: put both rows together, with the carried 10.", "Ten 10s make one 100. It goes above the hundreds."]);
  assert.deepEqual(placeValueTradeStepSentences(prob("50003", "-", "2476"), 1), [
    "Ones: not enough to take away 6. The tens, hundreds and thousands are empty, so break one 10,000 into ten 1,000s.",
    "Break one 1,000 into ten 100s.", "Break one 100 into ten 10s.", "Break one 10 into ten 1s.", "Ones: take away 6.",
  ]);
  assert.deepEqual(placeValueTradeStepSentences(prob("3000", "-", "1468"), 1, "zh-CN"), [
    "个位：不够拿走 8 个。十位和百位都没有圆片，所以把一个千拆成十个百。", "把一个百拆成十个十。", "把一个十拆成十个一。", "个位：拿走 8 个。",
  ]);
  assert.deepEqual(placeValueTradeStepSentences(prob("6500", "+", "4700"), 5), ["Ten thousands: bring the carried 10,000 down."]);
  assert.deepEqual(placeValueTradeStepSentences(prob("50003", "-", "2476"), 5), ["Ten thousands: nothing to take away."]);
  assert.deepEqual(placeValueTradeStepSentences(prob("3486", "+", "2739"), 9), []);
});

test("plan: disks 34, 28 or 24 px by columns; each row keeps its room; six columns fit 1,024 px", () => {
  const four = planPlaceValueTrade(card("3486", "+", "2739"));
  assert.deepEqual([four.disk, four.columns.length, four.room], [34, 4, m.placeValueTradeRoomNeeded(prob("3486", "+", "2739"))]);
  assert.deepEqual(four.labels.map((label) => `${label.op}${label.text}`), ["3,486", "+2,739"]);
  assert.equal(planPlaceValueTrade(card("50003", "-", "2476")).disk, 28);
  const widest = [card("4999.99", "+", "3999.99"), card("9000", "-", "2345.67"), card("389457", "+", "247568"), { ...card("9000", "-", "2345.67"), language: "zh-CN" as const }];
  for (const content of widest) {
    const plan = planPlaceValueTrade(content);
    assert.equal(plan.disk, 24);
    assert.ok(plan.width + 2 * 19 <= 1024, `six columns are ${plan.width} wide: with the card's frame they fit a 1,024 px window`);
  }
  // The decimal point sits between the ones and the tenths, in row 1, row 2 and the answer row.
  const decimal = planPlaceValueTrade(card("5", "-", "1.36"));
  assert.deepEqual(decimal.labels.map((label) => label.text), ["5.00", "1.36"]);
  assert.equal(decimal.points.length, 3);
  const ones = decimal.columns.find((column) => column.place === 0)!, tenths = decimal.columns.find((column) => column.place === -1)!;
  for (const point of decimal.points) assert.ok(point.x > ones.x + ones.width && point.x < tenths.x);
  // A cell that can hold a ten keeps room for its ring; disks never leave their cell.
  for (const content of [card("3486", "+", "2739"), card("50003", "-", "2476"), card("4999.99", "+", "3999.99")]) {
    const plan = planPlaceValueTrade(content), problem = placeValueTradeState(content).problem;
    for (const st of m.placeValueTradeReachable(problem)) {
      for (const p of problem.columns) {
        const c = m.placeValueTradeCell(st, p), column = plan.columns.find((x) => x.place === p)!;
        for (const [r, n, ring] of [["carry", c.carry, false], ["top", c.top, c.topRing], ["second", c.second, false], ["answer", c.answer, c.answerRing]] as const) {
          const box = column.cells[r];
          if (!box) { assert.equal(n, 0); continue; }
          for (let i = 0; i < n; i += 1) {
            const at = m.placeValueTradeDiskAt(plan, p, r, i, ring, n);
            assert.ok(at.x - plan.disk / 2 >= box.x - 0.01 && at.x + plan.disk / 2 <= box.x + box.width + 0.01 && at.y - plan.disk / 2 >= box.y - 0.01 && at.y + plan.disk / 2 <= box.y + box.height + 0.01, `${r} ${i} of ${p} inside its cell`);
          }
        }
      }
    }
  }
});

test("builder: the columns the pair needs, every bound field, and the parts", () => {
  const built = buildPlaceValueTrade({
    as: "sum", role: "main_visual", place: { relation: "new_region" }, operation: "add",
    a: { expression: "a", initial: v("3486") }, b: { expression: "b", initial: v("2739") }, finished: { expression: "finished", initial: 0 },
    places: [3, 2, 1, 0].map((place) => ({ place, status: { expression: `col_${math.PLACE_VALUE_PLACE_ALIASES[place]}`, initial: 0 } })),
  });
  const content = (built.actions[0] as unknown as { content: PlaceValueTradeContent }).content;
  assert.deepEqual([content.top_place, content.low_place, content.a, content.b, content.finished], [3, 0, 3486000, 2739000, 0]);
  assert.deepEqual(content.places.map((p) => [p.as, p.place, p.status]), [["thousands", 3, 0], ["hundreds", 2, 0], ["tens", 1, 0], ["ones", 0, 0]]);
  assert.deepEqual(content.bindings, [
    { target: "a", expression: "a" }, { target: "b", expression: "b" }, { target: "finished", expression: "finished" },
    { target: "thousands.status", expression: "col_thousands" }, { target: "hundreds.status", expression: "col_hundreds" }, { target: "tens.status", expression: "col_tens" }, { target: "ones.status", expression: "col_ones" },
  ]);
  assert.equal((built.actions[0] as unknown as { kind: string }).kind, "place_value_trade");
  assert.deepEqual(built.parts, { whole: "sum", thousands: "sum#thousands", hundreds: "sum#hundreds", tens: "sum#tens", ones: "sum#ones" });
  valid(content);
  const fixed = buildPlaceValueTrade({ as: "d", role: "main_visual", place: { relation: "new_region" }, operation: "subtract", language: "zh-CN", a: v("8.2"), b: v("3.75") });
  const fixedContent = (fixed.actions[0] as unknown as { content: PlaceValueTradeContent }).content;
  assert.deepEqual([fixedContent.language, fixedContent.top_place, fixedContent.low_place, fixedContent.bindings], ["zh-CN", 0, -2, undefined]);
  valid(fixedContent);
});

test("the plugin index exports the card, not yet a recipe", () => {
  assert.equal(math.PLACE_VALUE_TRADE_KIND, "place_value_trade");
  assert.equal(typeof math.buildPlaceValueTrade, "function");
  assert.equal(typeof math.renderPlaceValueTrade, "function");
  assert.equal(typeof math.updatePlaceValueTrade, "function");
  assert.equal("place_value_trade" in math.MATH_BUILDERS, false);
});
