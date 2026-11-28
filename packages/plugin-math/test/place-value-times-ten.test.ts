// Ten of one place make one of the next (decision 0028): the rules, the invariants and the demonstration ported
// from the accepted sketch (35P-04 sketch, test-model.mjs: every check but the typed-answer reader's, which the
// player's numeric answer replaces, and the lesson-variable round trip, which here is the row sets), then the
// card's content rules, state, tap rules, "counted in", facts, words, plan and builder. Values are thousandths.
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/place-value-times-ten.js";
import { placeValueDiskLabel, placeValueNumeral } from "../src/place-value-chart.js";
import { buildPlaceValueTimesTen } from "../src/place-value-times-ten-builder.js";
import * as math from "../src/index.js";
import { TIMES_TEN_DEV_CASES, TIMES_TEN_PROBLEMS } from "./place-value-times-ten-fixtures.js";

type Problem = m.PlaceValueTimesTenProblem;
type Faulted = Problem & { fault?: string };

let ported = 0;
const eq = (actual: unknown, expected: unknown, what: string) => { assert.deepEqual(actual, expected, what); ported += 1; };
const ok = (cond: unknown, what: string) => { assert.ok(cond, what); ported += 1; };
const v = (text: string): number => m.placeValueTimesTenParse(text)!;
/** The sketch's `makeProblem` on written numbers. */
function prob(amount: string, target: string, start?: string): Faulted {
  const A = m.placeValueTimesTenParse(amount), T = m.placeValueTimesTenParse(target), S = start === undefined ? undefined : m.placeValueTimesTenParse(start);
  if (A === undefined || T === undefined || (start !== undefined && S === undefined)) return { fault: "unreadable" } as Faulted;
  return m.placeValueTimesTenProblem(A, T, S) as Faulted;
}
const practice = (example: Problem, amount: string, target: string): Faulted => m.placeValueTimesTenPracticeProblem(example, v(amount), v(target)) as Faulted;
const run = (state: m.PlaceValueTimesTenState, ...rows: number[]): m.PlaceValueTimesTenState => rows.reduce((s, i) => {
  const r = m.placeValueTimesTenMove(s, i);
  assert.ok(r.ok, `move(${i}) refused: ${r.ok ? "" : r.reason}`);
  return r.state;
}, state);
const reason = (r: m.PlaceValueTimesTenResult) => (r.ok ? undefined : r.reason);
const each = <T>(items: T[], f: (item: T) => void) => items.forEach(f);

/** A content holding a state: the shape, the two numbers, "counted in" at the start, the row sets. */
function contentOf(state: m.PlaceValueTimesTenState, extra: Partial<m.PlaceValueTimesTenContent> = {}): m.PlaceValueTimesTenContent {
  const p = state.problem, rows = m.placeValueTimesTenRowSets(state), shape = m.placeValueTimesTenShapeOf(p);
  return { ...shape, amount: p.amount, target: p.target, counted_in: p.start, moved_once: rows.moved_once, ...(p.g === 2 ? { moved_twice: rows.moved_twice } : {}), ...extra };
}
const failure = (raw: unknown, options: { boundValues?: boolean } = {}): string | undefined => {
  try {
    m.validatePlaceValueTimesTenContent(raw, "$", (path, message) => { throw new Error(`${path}: ${message}`); }, options);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

const TIMES: m.PlaceValueTimesTenShape = { question: "times", toward: "right", apart: 1 };
/** The problem a card of this shape makes of written numbers. */
const shaped = (shape: m.PlaceValueTimesTenShape, amount: string, target: string): Faulted => m.placeValueTimesTenProblemOfShape(shape, v(amount), v(target)) as Faulted;
/** A pair whose digit is 1 on a card that says `times` (0028 revision 4), at every two neighbouring places the card has. */
const DIGIT_ONE_TIMES: Array<[string, string]> = [["0.01", "0.001"], ["0.1", "0.01"], ["1", "0.1"], ["10", "1"], ["100", "10"], ["1000", "100"], ["10000", "1000"], ["100000", "10000"], ["1000000", "100000"]];

const all: Problem[] = [...TIMES_TEN_PROBLEMS.en, ...TIMES_TEN_PROBLEMS.zh].flatMap((item) => {
  const p = prob(item.amount, item.target, item.start) as Problem;
  return [p, practice(p, item.practice.amount, item.practice.target) as Problem];
}).concat(DIGIT_ONE_TIMES.map(([amount, target]) => shaped(TIMES, amount, target) as Problem));

// ---------------------------------------------------------------- the sketch's model checks (test-model.mjs)

test("sketch: exact values (thousandths), nothing rounded", () => {
  eq(v("0.3"), 300, "0.3 is 300 thousandths");
  eq(v("4,000"), 4000000, "commas");
  eq(v("0.001"), 1, "a thousandth");
  eq(v("0.30"), 300, "a trailing zero");
  eq(m.placeValueTimesTenParse("0.0005"), undefined, "finer than thousandths");
  eq(m.placeValueTimesTenParse("-3"), undefined, "no negatives");
  eq(m.placeValueTimesTenOneDigit(v("700")), { digit: 7, place: 2 }, "700: one digit");
  eq(m.placeValueTimesTenOneDigit(v("0.04")), { digit: 4, place: -2 }, "0.04: one digit");
  eq(m.placeValueTimesTenOneDigit(v("1.2")), undefined, "1.2: two digits");
  eq(m.placeValueTimesTenOneDigit(v("5550")), undefined, "5550: three digits");
  eq(m.placeValueTimesTenPlaceOfUnit(v("0.01")), -2, "0.01 is the hundredths");
  eq(m.placeValueTimesTenPlaceOfUnit(v("1000000")), 6, "a million");
  eq(m.placeValueTimesTenPlaceOfUnit(v("70")), undefined, "70 is not a unit");
  eq(placeValueNumeral(v("60000"), "en-US"), "60,000", "en commas");
  eq(placeValueNumeral(v("0.05"), "zh-CN"), "0.05", "zh decimal");
  eq(placeValueDiskLabel(4, "zh-CN"), "1万", "zh disk 1万");
  eq(placeValueDiskLabel(-3, "en-US"), "0.001", "thousandth disk");
});

test("sketch: problems, the two shapes and the refusals", () => {
  const a = prob("0.3", "0.001");
  eq([a.question, a.s, a.t, a.dir, a.g, a.n, a.result], ["count", -1, -3, -1, 2, 3, 300], "3 tenths = 300 thousandths: break, two places");
  eq(a.columns, [-1, -2, -3], "tenths to thousandths");
  const b = prob("700", "70");
  eq([b.question, b.s, b.t, b.g, b.n, b.renamed, b.result], ["times", 2, 1, 1, 7, 70, 10], "700 against 70: 70 tens, 10 times");
  eq(m.placeValueTimesTenPath(b), [v("100"), v("70")], "700 counted in hundreds, then in 70s");
  const c = prob("300", "100", "10");
  eq([c.question, c.s, c.t, c.dir, c.g, c.n, c.result], ["count", 1, 2, 1, 1, 3, 3], "30 tens = 3 hundreds: put together, one place");
  const d = prob("0.5", "0.1", "0.001");
  eq([d.dir, d.g, d.n, d.result], [1, 2, 5, 5], "500 thousandths = 5 tenths, through the hundredths");
  eq(prob("1000", "10").result, 100, "1 thousand = 100 tens");
  eq(prob("3", "0.3").columns, [0, -1], "3 against 0.3: ones and tenths");
  eq(prob("10", "1").question, "count", "digit 1: 1 ten = 10 ones is a count");
  eq(prob("400", "1", "100").result, 400, "start given as the amount's own place");
  eq(prob("2.5", "0.1").fault, "not_one_digit", "2.5 is two digits");
  eq(prob("5550", "50").fault, "not_one_digit", "the whole numeral is not the card's number; 500 and 50 are");
  eq(prob("700", "7").fault, "too_far", "a times pair two places apart");
  eq(prob("700", "60").fault, "not_a_pair", "different digits");
  eq([prob("70", "700").amount, prob("70", "700").target], [v("700"), v("70")], "the smaller number first: the same pair, the larger on top");
  eq(prob("0.3", "3").question, "times", "0.3 and 3: a times pair");
  eq(prob("0.3", "3", "1").question, "times", "0.3 and 3 with the start written for 3");
  eq(prob("0.3", "3", "0.1").question, "times", "0.3 and 3 with the start written for 0.3: moved with it");
  eq(prob("70", "700", "100").renamed, 70, "70 and 700, start 100: 700 against 70");
  eq([prob("0.1", "1").question, prob("0.1", "1").result], ["count", 10], "0.1 and 1: 1 one = 10 tenths");
  eq(prob("1.2", "0.3").fault, "not_one_digit", "dividing by a decimal is not this card");
  eq(prob("0.3", "0.3").fault, "not_a_pair", "same number");
  eq(prob("3", "1").fault, "same_unit", "already in ones");
  eq(prob("3000", "1").fault, "too_far", "three places");
  eq(prob("0.3", "0.0001").fault, "unreadable", "past thousandths");
  eq(prob("0.04", "0.1").fault, "not_whole", "4 hundredths is not a whole number of tenths");
  eq(prob("3000", "100", "10").fault, "too_many", "300 tens put together are 30 hundreds");
  eq(prob("12", "1", "10").fault, "not_one_digit", "12 is two digits");
  eq(prob("30", "10", "100").fault, "not_whole", "30 is not a whole number of hundreds");
  eq(prob("0.3", "0.01", "0.15").fault, "start_not_unit", "the start must be a unit");
  eq(prob("700", "70", "10").fault, "times_start", "a times pair starts in its own place");
  eq(prob("90000000", "9000000").fault, "out_of_range", "past the millions");
  eq(prob("abc", "1").fault, "unreadable", "unreadable");
});

test("sketch: the development cases' expectations are problems the card draws, with their answers", () => {
  for (const c of TIMES_TEN_DEV_CASES) {
    const p = prob(c.amount, c.target, c.start);
    ok(!p.fault, `${c.id}: drawn (${p.fault})`);
    eq(p.question, c.ask, `${c.id}: ${c.ask}`);
    eq(p.result, Number(c.result), `${c.id}: result ${c.result}`);
    if (c.ask === "times") eq(p.renamed, Number(c.renamed), `${c.id}: renamed ${c.renamed}`);
  }
});

test("sketch: words (computed, never a model's)", () => {
  const a = prob("0.3", "0.001"), b = prob("700", "70"), c = prob("300", "100", "10");
  eq(m.placeValueTimesTenProblemText(a, "en-US"), "3 tenths = ? thousandths", "count words en");
  eq(m.placeValueTimesTenProblemText(a, "zh-CN"), "3个十分之一 = ?个千分之一", "count words zh");
  eq(m.placeValueTimesTenProblemText(b, "en-US"), "700 is ? times 70", "times words en");
  eq(m.placeValueTimesTenProblemText(b, "zh-CN"), "700 是 70 的 ? 倍", "times words zh");
  eq(m.placeValueTimesTenProblemText(prob("1000", "10"), "en-US"), "1 thousand = ? tens", "singular");
  eq(m.placeValueTimesTenProblemText(c, "zh-CN"), "30个十 = ?个百", "put together zh");
  const blanks = (p: Problem) => m.placeValueTimesTenAnswerParts(p, "en-US").flatMap((part) => ("blank" in part ? [part.blank.answer] : []));
  eq(blanks(b), [70, 10], "times blanks: 70 tens, then 10");
  eq(m.placeValueTimesTenAnswerParts(b, "en-US")[0], { text: "7 hundreds =" }, "times first blank");
  eq(m.placeValueTimesTenDoneText(prob("3", "0.3"), "en-US"), "✓ 3 = 10 × 0.3. The 3 in 3 is worth ten times the 3 in 0.3; 0.3 is 1/10 of 3.", "times done line, en");
  eq(m.placeValueTimesTenDoneText(a, "zh-CN"), "✓ 3个十分之一 = 300个千分之一", "count done line, zh");
});

test("sketch: practice is of the same shape, simply stated", () => {
  const a = prob("0.3", "0.001"), b = prob("700", "70"), c = prob("300", "100", "10");
  eq(practice(a, "5", "0.01").result, 500, "5 ones = 500 hundredths: break, two places");
  eq(practice(a, "5", "0.1").fault, "not_whole", "practice starts as far from its target as the example");
  eq(practice(a, "0.3", "0.001").fault, "same_as_example", "the same problem");
  eq(practice(b, "4000", "400").question, "times", "times practice");
  eq(practice(b, "0.5", "0.001").fault, "not_same_shape", "a count is not a times practice");
  eq(practice(c, "0.04", "0.01").s, -3, "put-together practice starts one place right of its target");
  for (const lang of ["en", "zh"] as const) for (const item of TIMES_TEN_PROBLEMS[lang]) {
    const p = prob(item.amount, item.target, item.start);
    ok(!p.fault, `${lang} ${item.amount}/${item.target} is a problem`);
    const q = practice(p, item.practice.amount, item.practice.target);
    ok(!q.fault, `${lang} ${item.amount}/${item.target}: practice ${item.practice.amount}/${item.practice.target} fits (${q.fault})`);
  }
});

test("sketch: moves; the tapped thing is the one that moves", () => {
  const a = prob("0.3", "0.001"), b = prob("700", "70"), c = prob("300", "100", "10");
  let s = m.placeValueTimesTenStart(a);
  eq(m.placeValueTimesTenColumn(s, -1).length, 3, "3 tenths at the start");
  s = run(s, 1);
  eq(m.placeValueTimesTenColumn(s, -2), [{ i: 1, size: 10, stage: 1 }], "the tapped tenth is a row of ten hundredths, in its own row");
  eq(m.placeValueTimesTenChartValue(s), 300, "the amount never changes");
  s = run(s, 1);
  eq(m.placeValueTimesTenColumn(s, -3), [{ i: 1, size: 100, stage: 2 }], "the row of ten hundredths is a square of a hundred thousandths");
  eq(reason(m.placeValueTimesTenMove(s, 1)), "at_target", "thousandths already");
  eq(reason(m.placeValueTimesTenMove(s, 7)), "no_thing", "no such row");
  s = m.placeValueTimesTenStart(b);
  eq(m.placeValueTimesTenCopies(s).map((copy) => copy.have), Array(10).fill(0), "ten copies of 70, empty at the start");
  s = run(s, 0, 1, 2);
  eq(m.placeValueTimesTenCopies(s).map((copy) => copy.have), Array(10).fill(3), "three hundreds broken: each copy has 3 tens");
  ok(m.placeValueTimesTenCopies(s).every((copy) => !copy.full), "no copy is a whole 70 yet");
  eq(m.placeValueTimesTenCopies(s)[4]!.slots, [true, true, true, false, false, false, false], "a copy's slot i is filled by hundred i");
  eq(m.placeValueTimesTenChartValue(s), 700000, "the amount never changes");
  s = run(s, 3, 4, 5, 6);
  eq(reason(m.placeValueTimesTenMove(s, 6)), "at_target", "a hundred breaks once");
  ok(m.placeValueTimesTenComplete(s) && m.placeValueTimesTenCopies(s).every((copy) => copy.full), "every hundred broken: ten whole 70s");
  eq(m.placeValueTimesTenCopies(m.placeValueTimesTenStart(a)), [], "a count has no copies");
  eq(m.placeValueTimesTenChartValue(s), 700000, "700, still");
  s = run(m.placeValueTimesTenStart(c), 2);
  eq(m.placeValueTimesTenColumn(s, 2), [{ i: 2, size: 1, stage: 1 }], "ten tens put together: one hundred, in the same row");
});

test("sketch: every listed problem and practice, every reachable state", () => {
  let states = 0;
  for (const p of all) {
    const reach = m.placeValueTimesTenReachable(p);
    states += reach.length;
    const memo = new Map<string, boolean>();
    ok(reach.every((st) => m.placeValueTimesTenChartValue(st) === p.amount), `${p.amount}/${p.target}: value fixed in all ${reach.length} states`);
    ok(reach.every((st) => m.placeValueTimesTenCanStillFinish(st, memo)), `${p.amount}/${p.target}: no dead end`);
    eq(reach.filter(m.placeValueTimesTenComplete).length, 1, `${p.amount}/${p.target}: one finished chart`);
    const fin = reach.find(m.placeValueTimesTenComplete)!;
    const inTarget = m.placeValueTimesTenColumn(fin, p.t).reduce((sum, x) => sum + x.size, 0);
    eq(inTarget, p.question === "count" ? p.result : p.renamed, `${p.amount}/${p.target}: the finished chart holds the answer's count in the target column`);
    const path = m.placeValueTimesTenPath(p);
    eq(path[0], p.start, "counted in starts at the start unit");
    eq(path.at(-1), p.target, "counted in ends at the target");
    const { steps, final } = m.placeValueTimesTenDemoSteps(p);
    eq(steps.length, path.length - 1, "one demonstration step per later value");
    ok(m.placeValueTimesTenComplete(final), "the demonstration finishes");
    steps.forEach((st, k) => eq(m.placeValueTimesTenDemoState(p, k + 1).stages, st.after.stages, `demo at ${st.countedIn} = its step`));
    ok(m.placeValueTimesTenVariableCount(p) <= m.PLACE_VALUE_TIMES_TEN_MAX_VARIABLES, "at most 16 variables");
    // The row sets hold the state exactly (the sketch's variable round trip), each within 0 to 511.
    for (const st of reach.slice(0, 400)) {
      const content = contentOf(st);
      eq(m.placeValueTimesTenState(content).stages, st.stages, "row sets round-trip");
      ok(content.moved_once <= m.PLACE_VALUE_TIMES_TEN_MAX_ROWS && (content.moved_twice ?? 0) <= m.PLACE_VALUE_TIMES_TEN_MAX_ROWS, "row sets stay within 0..511");
    }
  }
  eq(Math.max(...all.map(m.placeValueTimesTenVariableCount)), 5, "the most variables: 5 (amount, target, counted in, two row sets)");
  eq(Math.max(...all.filter((p) => p.question === "times").map(m.placeValueTimesTenVariableCount)), 4, "a times pair: 4");
  ok(states > 50000, `states searched: ${states}`);
});

test("sketch: random problems keep the same invariants", () => {
  let rnd = 7;
  const rand = (k: number) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd % k; };
  const text = (value: number) => placeValueNumeral(value).replace(/,/g, "");
  let made = 0;
  for (let t = 0; t < 400 && made < 150; t += 1) {
    const dig = 1 + rand(9), ap = -3 + rand(10), tp = -3 + rand(10);
    const amount = text(dig * m.placeValueTimesTenUnit(ap));
    const target = rand(2) ? text(m.placeValueTimesTenUnit(tp)) : text(dig * m.placeValueTimesTenUnit(ap - 1));
    const start = rand(3) === 0 ? text(m.placeValueTimesTenUnit(-3 + rand(10))) : undefined;
    const p = prob(amount, target, start);
    if (p.fault) continue;
    made += 1;
    const reach = m.placeValueTimesTenReachable(p), memo = new Map<string, boolean>();
    ok(reach.every((st) => m.placeValueTimesTenChartValue(st) === p.amount) && reach.every((st) => m.placeValueTimesTenCanStillFinish(st, memo)) && reach.filter(m.placeValueTimesTenComplete).length === 1, `random ${amount}/${target}/${start}`);
  }
  ok(made >= 100, `random problems made: ${made}`);
});

// ---------------------------------------------------------------- the card: content, state, taps

test("content: a starting card, its shape, its row sets and counted in", () => {
  const a = prob("0.3", "0.001"), b = prob("700", "70"), c = prob("300", "100", "10");
  for (const p of all) eq(failure(contentOf(m.placeValueTimesTenStart(p))), undefined, `${p.amount}/${p.target}: a fresh card`);
  const fresh = contentOf(m.placeValueTimesTenStart(a));
  eq(fresh, { question: "count", toward: "right", apart: 2, amount: 300, target: 1, counted_in: 100, moved_once: 0, moved_twice: 0 }, "3 tenths -> thousandths as content");
  eq(contentOf(m.placeValueTimesTenStart(c)).counted_in, 10000, "30 tens start counted in tens (10 is 10000 thousandths)");
  ok(failure({ ...fresh, extra: 1 })?.includes("Unknown"), "unknown field");
  ok(failure({ ...fresh, question: "divide" })?.includes("'count' or 'times'"), "question");
  ok(failure({ ...fresh, toward: "up" })?.includes("right"), "toward");
  ok(failure({ ...fresh, apart: 3 })?.includes("1 or 2"), "apart");
  ok(failure({ ...contentOf(m.placeValueTimesTenStart(b)), apart: 2, moved_twice: 0 })?.includes("one place apart"), "a times pair is one place apart");
  ok(failure({ ...fresh, moved_twice: undefined })?.includes("moved twice"), "two places apart needs moved_twice");
  ok(failure({ ...contentOf(m.placeValueTimesTenStart(c)), moved_twice: 0 })?.includes("nothing moves twice"), "one place apart has no moved_twice");
  ok(failure({ ...fresh, amount: 2500 })?.includes("not_one_digit"), "2.5 refused, said");
  ok(failure({ ...fresh, target: 10 })?.includes("not_whole"), "0.3 two places from 0.01 starts in ones: not a whole number of ones");
  ok(failure({ ...contentOf(m.placeValueTimesTenStart(b)), amount: 300, target: 1 })?.includes("not_same_shape"), "a count's numbers on a times card");
  ok(failure({ ...fresh, moved_once: 8 })?.includes("3 rows"), "a row the problem has not");
  ok(failure({ ...fresh, moved_once: 1, moved_twice: 2 })?.includes("after it has moved once"), "twice without once");
  ok(failure({ ...fresh, counted_in: 50 })?.includes("the next values are 10 or 1"), "counted in off the path names the next values");
  ok(failure({ ...fresh, counted_in: 10, moved_once: 1 })?.includes("fresh chart"), "a demonstration plays on a fresh chart");
  eq(failure({ ...fresh, counted_in: 10 }), undefined, "the demonstration at 0.01");
  eq(failure({ ...fresh, counted_in: 1 }), undefined, "the demonstration at the target");
  const timesContent = contentOf(m.placeValueTimesTenStart(b));
  eq(timesContent, { question: "times", toward: "right", apart: 1, amount: 700000, target: 70000, counted_in: 100000, moved_once: 0 }, "700 against 70 as content");
  ok(failure({ ...timesContent, amount: 70000, target: 700000 })?.includes("larger first"), "a times card writes the larger first");
  ok(failure({ ...timesContent, counted_in: 10000 })?.includes("100000 = 100 (hundreds) -> 70000 = 70"), "a times pair's counted in is 100 -> 70 (thousandths 100000 -> 70000)");
  // Bound values: only each field's own range.
  eq(failure({ ...fresh, counted_in: 50, moved_once: 511, moved_twice: 511 }, { boundValues: true }), undefined, "bound values: ranges only");
  ok(failure({ ...fresh, moved_once: 512 }, { boundValues: true })?.includes("0 to 511"), "a row set past 511");
});

test("state: total, the row sets read for the problem's rows, counted in shows the demonstration", () => {
  const a = prob("0.3", "0.001"), b = prob("700", "70");
  const fresh = contentOf(m.placeValueTimesTenStart(a));
  eq(m.placeValueTimesTenState({ ...fresh, moved_once: 8 }).stages, [0, 0, 0], "a bit past the problem's rows is ignored (row 4 of 3)");
  eq(m.placeValueTimesTenState({ ...fresh, moved_once: 511, moved_twice: 511 }).stages, [2, 2, 2], "only the problem's rows are read");
  eq(m.placeValueTimesTenState({ ...fresh, moved_once: 0, moved_twice: 7 }).stages, [0, 0, 0], "twice without once has not moved");
  eq(m.placeValueTimesTenState({ ...fresh, moved_once: 5, moved_twice: 1 }).stages, [2, 0, 1], "rows 1 and 3 once, row 1 twice");
  eq(m.placeValueTimesTenState({ amount: "x" }).problem.n, 0, "a content the card refuses: an empty chart");
  eq(m.placeValueTimesTenState(null).stages, [], "no content at all");
  // Counted in, eased from one value to the next, passes each lineage in turn and never goes back.
  let last = -1;
  for (let value = 100; value >= 1; value -= 1) {
    const st = m.placeValueTimesTenState({ ...fresh, counted_in: value });
    const moved = st.stages.reduce((sum, k) => sum + k, 0);
    ok(moved >= last, `counted in ${value}: no step back`);
    last = moved;
  }
  eq(m.placeValueTimesTenState({ ...fresh, counted_in: 10 }).stages, [1, 1, 1], "at 0.01 every tenth is broken");
  eq(m.placeValueTimesTenState({ ...fresh, counted_in: 55 }).stages, [1, 0, 0], "half way to 0.01: the first of three");
  eq(m.placeValueTimesTenState({ ...fresh, counted_in: 1 }).stages, [2, 2, 2], "at the target");
  eq(m.placeValueTimesTenState({ ...fresh, counted_in: 5000 }).stages, [0, 0, 0], "before the start: the start");
  const times = contentOf(m.placeValueTimesTenStart(b));
  eq(m.placeValueTimesTenState({ ...times, counted_in: 85000 }).stages, [1, 1, 1, 0, 0, 0, 0], "700 half way from 100 to 70: 3 of 7 hundreds dealt");
  eq(m.placeValueTimesTenState({ ...times, counted_in: 70000 }).stages, Array(7).fill(1), "at 70: every hundred dealt");
  // Put together: the path goes up.
  const d = prob("0.5", "0.1", "0.001");
  const up = contentOf(m.placeValueTimesTenStart(d));
  eq(m.placeValueTimesTenPath(d), [1, 10, 100], "500 thousandths counted in 0.001, 0.01, 0.1");
  eq(m.placeValueTimesTenState({ ...up, counted_in: 10 }).stages, Array(5).fill(1), "at 0.01 every square is a row of ten");
});

test("review of #121: a refused problem is never complete, a stray bit never moves a row twice, a times pair on a count card", () => {
  const refused = { question: "count", toward: "right", apart: 2, amount: 2500, target: 1, counted_in: 100, moved_once: 0, moved_twice: 0 };
  ok(!m.placeValueTimesTenComplete(m.placeValueTimesTenState(refused)), "a card the problem refuses is not complete");
  ok(m.placeValueTimesTenStartFault(refused)?.includes("not_one_digit"), "nor a practice start");
  const a = prob("0.3", "0.001");
  const stray = m.placeValueTimesTenState({ ...contentOf(m.placeValueTimesTenStart(a)), moved_once: 0, moved_twice: 1 });
  const tapped = m.placeValueTimesTenMove(stray, 0);
  ok(tapped.ok, "the row moves");
  if (tapped.ok) {
    eq(m.placeValueTimesTenChanges(stray, tapped.state), [{ field: "moved_once", before: 0, after: 1 }, { field: "moved_twice", before: 1, after: 0 }], "the stray bit is cleared as the row moves once");
    eq(m.placeValueTimesTenState({ ...contentOf(m.placeValueTimesTenStart(a)), moved_once: 1, moved_twice: 0 }).stages, [1, 0, 0], "one place, not two");
  }
  const b = prob("700", "70");
  ok(failure({ ...contentOf(m.placeValueTimesTenStart(a)), amount: b.amount, target: b.target })?.includes("not_same_shape"), "a times pair on a count card names the real cause");
  eq(m.placeValueTimesTenLockedText(prob("8000", "800"), "en-US"), "Opens when every row is an 800.", "an 800");
  eq(m.placeValueTimesTenLockedText(prob("8", "0.8"), "en-US"), "Opens when every row is a 0.8.", "a 0.8");
  eq(m.placeValueTimesTenLockedText(prob("80", "8"), "en-US"), "Opens when every row is an 8.", "an 8");
  eq(m.placeValueTimesTenLockedText(prob("80000", "8000"), "en-US"), "Opens when every row is an 8,000.", "an 8,000");
});

test("taps: move, copy and smaller; a demonstration takes none", () => {
  const b = prob("700", "70"), a = prob("0.3", "0.001");
  const s = run(m.placeValueTimesTenStart(b), 0, 1, 2);
  eq(m.applyPlaceValueTimesTenTap(s, { tap: "copy", row: 4 }), { ok: false, reason: "copy_short", have: 3, need: 7 }, "a copy's count");
  eq(reason(m.applyPlaceValueTimesTenTap(run(s, 3, 4, 5, 6), { tap: "copy", row: 4 })), "copy_full", "a whole copy");
  eq(reason(m.applyPlaceValueTimesTenTap(s, { tap: "smaller", row: 0 })), "smaller", "the smaller number");
  eq(reason(m.applyPlaceValueTimesTenTap(m.placeValueTimesTenStart(a), { tap: "copy", row: 0 })), "not_times", "a count has no copies");
  ok(m.applyPlaceValueTimesTenTap(s, { tap: "move", row: 3 }).ok, "a hundred breaks");
  const demo = m.placeValueTimesTenState({ ...contentOf(m.placeValueTimesTenStart(a)), counted_in: 10 });
  eq(reason(m.applyPlaceValueTimesTenTap(demo, { tap: "move", row: 0 })), "demonstrating", "a demonstration's chart takes no taps");
  eq(m.placeValueTimesTenRefusalText(s, { tap: "copy", row: 4 }, "en-US"), "This 70 has 3 tens; 70 is 7 tens.", "the copy's fact, en");
  eq(m.placeValueTimesTenRefusalText(s, { tap: "copy", row: 4 }, "zh-CN"), "这一个 70 只有 3 个十；70 是 7 个十。", "the copy's fact, zh");
  eq(m.placeValueTimesTenRefusalText(s, { tap: "smaller", row: 0 }, "en-US"), "This is 70: 7 tens.", "the smaller number's fact");
  const done = run(m.placeValueTimesTenStart(a), 0, 0);
  eq(m.placeValueTimesTenRefusalText(done, { tap: "move", row: 0 }, "en-US"), "These are thousandths already.", "at the target");
  eq(m.placeValueTimesTenRefusalText(done, { tap: "move", row: 0 }, "zh-CN"), "这些已经是千分之一了。", "at the target, zh");
  eq(m.placeValueTimesTenChanges(m.placeValueTimesTenStart(a), run(m.placeValueTimesTenStart(a), 2)), [{ field: "moved_once", before: 0, after: 4 }], "a tap writes one row set");
  eq(m.placeValueTimesTenChanges(run(m.placeValueTimesTenStart(a), 2), run(m.placeValueTimesTenStart(a), 2, 2)), [{ field: "moved_twice", before: 0, after: 4 }], "the second move writes the other");
});

test("counted in: the compiler's refusal names the next valid values", () => {
  const a = prob("0.3", "0.001"), b = prob("700", "70");
  eq(m.placeValueTimesTenCountedInFault(a, 100, 10), undefined, "0.1 -> 0.01");
  eq(m.placeValueTimesTenCountedInFault(a, 100, 1), undefined, "0.1 -> 0.001 in one write (the program plays 0.01 between)");
  eq(m.placeValueTimesTenCountedInFault(a, 10, 10), undefined, "the same value again");
  ok(m.placeValueTimesTenCountedInFault(a, 10, 100)?.includes("not back to 100; from 10 the next values are 1"), "back is refused");
  ok(m.placeValueTimesTenCountedInFault(b, 100000, 10000)?.includes("100000 = 100 (hundreds) -> 70000 = 70"), "700: hundreds, then 70s");
  ok(m.placeValueTimesTenCountedInFault(b, 100000, 10000)?.includes("from 100000 the next values are 70000"), "the next value, in thousandths");
  ok(m.placeValueTimesTenCountedInFault(b, 70000, 7000)?.includes("reached the target"), "past the end");
  eq(m.placeValueTimesTenStartFault({ ...contentOf(m.placeValueTimesTenStart(a)), counted_in: 0 }), "A practice chart starts fresh: 'counted_in' is its own start unit, 100 (0.1 (tenths)), not 0", "a practice starts at its own unit, never 0");
  eq(m.placeValueTimesTenStartFault(contentOf(m.placeValueTimesTenStart(a))), undefined, "a fresh practice");
  ok(m.placeValueTimesTenStartFault({ ...contentOf(m.placeValueTimesTenStart(a)), moved_once: 1 })?.includes("no row moved"), "a practice with a row moved");
  const shape = m.placeValueTimesTenShapeOf(prob("300", "100", "10"));
  eq(m.placeValueTimesTenStartUnit(shape, v("0.04"), v("0.01")), 1, "the program supplies a put-together practice's start: 0.001");
  eq(m.placeValueTimesTenStartUnit(m.placeValueTimesTenShapeOf(b), v("4000"), v("400")), 1000000, "a times practice starts in the larger number's place");
  eq(m.placeValueTimesTenStartUnit(m.placeValueTimesTenShapeOf(a), v("5"), v("0.01")), 1000, "5 ones -> hundredths starts in ones");
});

test("facts and words for the lesson's later sections", () => {
  const a = prob("0.3", "0.001"), b = prob("700", "70");
  const facts = m.placeValueTimesTenFacts(run(m.placeValueTimesTenStart(a), 0));
  eq([facts.value, facts.counted_in, facts.complete, facts.next], [300, 100, false, [10, 1]], "one tenth broken: still counted in tenths");
  eq(facts.columns, [{ place: -1, disks: 2, rows: 0, squares: 0 }, { place: -2, disks: 0, rows: 1, squares: 0 }, { place: -3, disks: 0, rows: 0, squares: 0 }], "the chart as it stands");
  const all10 = m.placeValueTimesTenFacts(run(m.placeValueTimesTenStart(a), 0, 1, 2));
  eq([all10.counted_in, all10.next], [10, [1]], "every tenth broken: counted in hundredths");
  const t = m.placeValueTimesTenFacts(run(m.placeValueTimesTenStart(b), 0, 1, 2));
  eq([t.counted_in, t.copies, t.complete], [100000, 3, false], "a times pair part way");
  eq(m.placeValueTimesTenStepSentences(a, "en-US"), ["Break each tenth into ten hundredths.", "Break every hundredth into ten thousandths."], "demonstration sentences");
  eq(m.placeValueTimesTenStepSentences(b, "zh-CN"), ["把每个百拆成十个十，每一个 70 里放一个。"], "times demonstration, zh");
  eq(m.placeValueTimesTenInstruction(run(m.placeValueTimesTenStart(a), 0), "en-US"), "Tap a tenth to break it into ten hundredths. Tap a row of ten hundredths to break it into a hundred thousandths.", "the instruction names each kind that can be tapped");
  eq(m.placeValueTimesTenInstruction(m.placeValueTimesTenStart(b), "zh-CN"), "点一个百，把它拆成十个十，每一个 70 里放一个。", "times instruction, zh");
  eq(m.placeValueTimesTenInstruction(run(m.placeValueTimesTenStart(a), 0, 0, 1, 1, 2, 2), "en-US"), "Type how many below.", "finished");
  eq(m.placeValueTimesTenLockedText(a, "en-US"), "Opens when everything is in thousandths.", "lock, count, en");
  eq(m.placeValueTimesTenLockedText(a, "zh-CN"), "全部变成千分之一后才能写。", "lock, count, zh");
  eq(m.placeValueTimesTenLockedText(b, "en-US"), "Opens when every row is a 70.", "lock, times, en");
  eq(m.placeValueTimesTenLockedText(b, "zh-CN"), "每一行都是 70 后才能写。", "lock, times, zh");
  eq(m.placeValueTimesTenHowTo({ question: "times" }), m.PLACE_VALUE_TIMES_TEN_WORDS["en-US"].howto.times, "the fixed how-to by question");
  eq(m.placeValueTimesTenAnswerParts(b, "zh-CN"), [{ text: "7个百 =" }, { blank: { as: "renamed", answer: 70 } }, { text: "个十；" }, { text: "700 是 70 的" }, { blank: { as: "times", answer: 10 } }, { text: "倍" }], "times answer row, zh");
  ok(m.placeValueTimesTenFaultText("same_unit", 300000, 100000).includes("40 hundredths: 0.01"), "a put-together question's own unit, said");
});

test("plan: desktop sizes, room kept from the start", () => {
  for (const p of all) {
    const content = contentOf(m.placeValueTimesTenStart(p));
    const plan = m.planPlaceValueTimesTen(content);
    ok(plan.width <= 958, `${p.amount}/${p.target}: fits a 1024 px window (${Math.round(plan.width)} px)`);
    // The room kept from the start holds every thing in every reachable state (the drawing's own geometry).
    const G = m.PLACE_VALUE_TIMES_TEN_GEOMETRY;
    let deepest = 0, widest = 0;
    for (const st of m.placeValueTimesTenReachable(p)) {
      st.stages.forEach((k, i) => {
        const size = m.placeValueTimesTenSizeAt(p, k);
        const bottom = size === 100 ? G.CP / 2 + Math.floor(i / 3) * (G.SQ + G.SG) + G.SQ : m.placeValueTimesTenSlotTop(p.question === "times" && k === 0 ? 0 : i) + G.D + 2 * G.RP;
        // A times pair's broken disk is a slot in every copy (a copy of n slots, its number beside it).
        const right = p.question === "times" ? (k === 1 ? G.CP + m.placeValueTimesTenRowWidth(p.n) + 8 + 26 : G.CP + m.placeValueTimesTenRowWidth(i + 1))
          : size === 100 ? G.CP + (i % 3 + 1) * (G.SQ + G.SG) - G.SG : size === 10 ? G.CP + m.placeValueTimesTenRowWidth(10) : 0;
        deepest = Math.max(deepest, bottom);
        const column = plan.columns.find((candidate) => candidate.place === m.placeValueTimesTenPlaceAt(p, k))!;
        widest = Math.max(widest, right - column.width);
      });
    }
    if (p.question === "times") deepest = Math.max(deepest, m.placeValueTimesTenSlotTop(m.PLACE_VALUE_TIMES_TEN_COPIES - 1) + G.D + 2 * G.RP);
    ok(deepest <= plan.columns[0]!.cell.height, `${p.amount}/${p.target}: room for the deepest state (${deepest} <= ${plan.columns[0]!.cell.height})`);
    ok(widest <= 0, `${p.amount}/${p.target}: every thing inside its column (${widest})`);
  }
  const times = m.planPlaceValueTimesTen(contentOf(m.placeValueTimesTenStart(prob("700", "70"))));
  eq(times.labels.map((label) => label.text), ["700", "70"], "a times pair's row labels");
  eq(times.columns.map((column) => column.place), [2, 1], "hundreds and tens");
  ok(times.columns[1]!.cell2, "the smaller number's row");
  const point = m.planPlaceValueTimesTen(contentOf(m.placeValueTimesTenStart(prob("3", "0.3"))));
  eq(point.points.length, 2, "the point in both rows between ones and tenths");
  const count = m.planPlaceValueTimesTen(contentOf(m.placeValueTimesTenStart(prob("0.3", "0.001"))));
  eq(count.columns.map((column) => column.target), [false, false, true], "the target column is marked");
  ok(count.columns[0]!.width < count.columns[1]!.width, "a column of single disks is narrow");
});

test("plan: where the answer is read (a count's target column; a times pair's copy numbers), and disk labels that fit", () => {
  const G = m.PLACE_VALUE_TIMES_TEN_GEOMETRY;
  for (const p of all) {
    const plan = m.planPlaceValueTimesTen(contentOf(m.placeValueTimesTenStart(p)));
    const column = plan.columns.find((candidate) => candidate.place === p.t)!;
    if (p.question === "count") {
      eq(plan.answer, column.cell, `${p.amount}/${p.target}: the target column`);
      continue;
    }
    // Beside the copies, across all ten of them, inside the column.
    ok(plan.answer.x > column.cell.x + G.CP + m.placeValueTimesTenRowWidth(p.n), `${p.amount}/${p.target}: right of the copies`);
    ok(plan.answer.x + plan.answer.width <= column.cell.x + column.cell.width + 1e-9 && plan.answer.width >= 24, `${p.amount}/${p.target}: inside the column, room for "10"`);
    eq([plan.answer.y, plan.answer.y + plan.answer.height], [column.cell.y + m.placeValueTimesTenSlotTop(0), column.cell.y + m.placeValueTimesTenSlotTop(9) + G.D + 2 * G.RP], `${p.amount}/${p.target}: copies 1 to 10`);
  }
  // A wide place value is squeezed to its disk; a short one is drawn as it is.
  for (const label of ["100,000", "1,000,000", "10,000"]) ok((m.placeValueTimesTenDiskLabelWidth(label) ?? 99) <= G.D - 6, `${label} fits its disk`);
  for (const label of ["1", "10", "100", "0.1", "0.01", "0.001", "1万"]) eq(m.placeValueTimesTenDiskLabelWidth(label), undefined, `${label} is drawn as it is`);
});

test("0028 revision 4: a pair whose digit is 1 is a times pair on a card that says times, a count on a count card", () => {
  // Without a shape (and on a count card) the reading is today's: 1 hundred = 10 tens; 1 one = 10 tenths.
  eq([prob("100", "10").question, prob("100", "10").result, prob("0.1", "1").question], ["count", 10, "count"], "no shape: a count");
  const counted = shaped({ question: "count", toward: "right", apart: 1 }, "100", "10");
  eq(counted, prob("100", "10"), "a count card reads 100 and 10 as before");
  eq(m.placeValueTimesTenProblemText(counted, "en-US"), "1 hundred = ? tens", "1 hundred = ? tens");
  // On a times card: 100 is ? times 10, as 700 is ? times 70.
  const b = shaped(TIMES, "100", "10");
  eq(b, { question: "times", amount: 100000, target: 10000, s: 2, t: 1, dir: -1, g: 1, n: 1, start: 100000, digit: 1, renamed: 10, result: 10, columns: [2, 1] }, "100 against 10: one hundred, 10 tens, 10 times");
  eq(shaped(TIMES, "10", "100"), b, "written smaller first: the same pair, the larger on top");
  const c = shaped(TIMES, "1", "0.1");
  eq([c.question, c.amount, c.target, c.s, c.t, c.n, c.start, c.renamed, c.columns], ["times", 1000, 100, 0, -1, 1, 1000, 10, [0, -1]], "0.1 is a tenth of 1: 1 against 0.1");
  for (const [amount, target] of DIGIT_ONE_TIMES) {
    const p = shaped(TIMES, amount, target);
    eq([p.question, p.n, p.digit, p.renamed, p.result, p.start, p.amount], ["times", 1, 1, 10, 10, v(amount), v(amount)], `${amount} against ${target}: a times pair started in its own unit`);
  }
  // Every other pair reads as before: not neighbours, another digit, a count's numbers, another stated shape.
  eq(shaped(TIMES, "1000", "10").fault, "not_same_shape", "1,000 and 10 are two places apart: a count's");
  eq(shaped(TIMES, "0.3", "0.001").fault, "not_same_shape", "a count's numbers on a times card");
  eq(shaped(TIMES, "700", "70"), prob("700", "70"), "another digit: as before");
  eq(shaped({ question: "times", toward: "left", apart: 2 }, "100", "10").fault, "not_same_shape", "a times pair breaks right, one place apart");
  // Practice of the same shape: a times example takes a digit-1 practice, and the other way round.
  eq(practice(prob("700", "70"), "100", "10").question, "times", "700 against 70, practised as 100 against 10");
  eq(practice(b, "4000", "400").renamed, 40, "100 against 10, practised as 4,000 against 400");
  eq(practice(b, "1", "0.1").question, "times", "100 against 10, practised as 1 against 0.1");
  eq(practice(b, "0.3", "0.001").fault, "not_same_shape", "a count is not its practice");
  // The card: content, state, taps, answers, path and facts.
  const content = contentOf(m.placeValueTimesTenStart(b));
  eq(content, { question: "times", toward: "right", apart: 1, amount: 100000, target: 10000, counted_in: 100000, moved_once: 0 }, "100 against 10 as content");
  eq(failure(content), undefined, "a valid card");
  ok(failure({ ...content, amount: 10000, target: 100000 })?.includes("larger first"), "written larger first");
  eq(m.placeValueTimesTenContentProblem(content), b, "the content's problem");
  const state = m.placeValueTimesTenState(content);
  eq([state.problem.question, state.stages], ["times", [0]], "one hundred, not yet broken");
  eq(m.placeValueTimesTenCopies(state).map((copy) => copy.have), Array(10).fill(0), "ten empty copies of 10");
  eq(m.applyPlaceValueTimesTenTap(state, { tap: "copy", row: 3 }), { ok: false, reason: "copy_short", have: 0, need: 1 }, "a copy's count");
  eq(m.placeValueTimesTenRefusalText(state, { tap: "copy", row: 3 }, "en-US"), "This 10 has 0 tens; 10 is 1 ten.", "the copy's fact");
  eq(m.placeValueTimesTenRefusalText(state, { tap: "smaller", row: 0 }, "zh-CN"), "这是 10：1 个十。", "the smaller number's fact, zh");
  eq(reason(m.applyPlaceValueTimesTenTap(state, { tap: "move", row: 1 })), "no_thing", "one row only");
  eq(m.placeValueTimesTenInstruction(state, "en-US"), "Tap a hundred to break it into ten tens, one into each 10.", "the instruction");
  const done = run(state, 0);
  ok(m.placeValueTimesTenComplete(done) && m.placeValueTimesTenCopies(done).every((copy) => copy.full && copy.have === 1), "the hundred broken: ten whole 10s");
  eq(m.placeValueTimesTenChanges(state, done), [{ field: "moved_once", before: 0, after: 1 }], "the tap writes row 1");
  eq(m.placeValueTimesTenRefusalText(done, { tap: "copy", row: 3 }, "en-US"), "This row is one 10.", "a whole copy");
  eq(m.placeValueTimesTenState({ ...content, moved_once: 1 }).stages, [1], "the row set round-trips");
  eq([m.placeValueTimesTenFacts(state).counted_in, m.placeValueTimesTenFacts(state).next, m.placeValueTimesTenFacts(state).copies], [100000, [10000], 0], "facts at the start");
  eq([m.placeValueTimesTenFacts(done).counted_in, m.placeValueTimesTenFacts(done).complete, m.placeValueTimesTenFacts(done).copies], [10000, true, 1], "facts once broken");
  eq(m.placeValueTimesTenPath(b), [100000, 10000], "counted in hundreds, then in 10s");
  eq(m.placeValueTimesTenDemoValues(b, 100000, 10000), [10000], "one row's move");
  eq(m.placeValueTimesTenState({ ...content, counted_in: 10000 }).stages, [1], "the demonstration at 10");
  ok(failure({ ...content, counted_in: 50000 })?.includes("100000 = 100 (hundreds) -> 10000 = 10 (tens)"), "counted in off the path names it");
  eq(m.placeValueTimesTenStartFault(content), undefined, "a fresh practice");
  eq(m.placeValueTimesTenProblemText(b, "en-US"), "100 is ? times 10", "words en");
  eq(m.placeValueTimesTenProblemText(c, "zh-CN"), "1 是 0.1 的 ? 倍", "words zh");
  eq(m.placeValueTimesTenAnswerParts(b, "en-US"), [{ text: "1 hundred =" }, { blank: { as: "renamed", answer: 10 } }, { text: "tens;" }, { text: "100 is" }, { blank: { as: "times", answer: 10 } }, { text: "times 10" }], "the answer row");
  eq(m.placeValueTimesTenDoneText(c, "en-US"), "✓ 1 = 10 × 0.1. The 1 in 1 is worth ten times the 1 in 0.1; 0.1 is 1/10 of 1.", "the done line: 0.1 is a tenth of 1");
  eq(m.placeValueTimesTenLockedText(b, "en-US"), "Opens when every row is a 10.", "the lock");
  eq(m.placeValueTimesTenStepSentences(c, "en-US"), ["Break each one into ten tenths, one into each 0.1."], "the demonstration's sentence");
  eq(m.placeValueTimesTenHowTo(content), m.PLACE_VALUE_TIMES_TEN_WORDS["en-US"].howto.times, "the times how-to");
});

test("0028 revision 4: only a stated times card's digit-1 neighbours read differently; every other pair and shape as before", () => {
  // The reading before revision 4, from the unchanged shape-free rules: the shape's start, the rules, the shape.
  const before = (shape: m.PlaceValueTimesTenShape, amount: number, target: number) => {
    const start = m.placeValueTimesTenStartUnit(shape, amount, target);
    if (start === undefined) {
      const other = m.placeValueTimesTenProblem(amount, target);
      return "fault" in other ? { fault: shape.question === "times" ? other.fault : "start_not_unit" } : { fault: "not_same_shape" };
    }
    const p = m.placeValueTimesTenProblem(amount, target, shape.question === "times" ? undefined : start);
    if ("fault" in p) return p;
    const own = m.placeValueTimesTenShapeOf(p);
    return own.question === shape.question && own.toward === shape.toward && own.apart === shape.apart ? p : { fault: "not_same_shape" };
  };
  const shapes: m.PlaceValueTimesTenShape[] = [TIMES, ...(["right", "left"] as const).flatMap((toward) => ([1, 2] as const).map((apart) => ({ question: "count" as const, toward, apart })))];
  const values = Array.from({ length: 11 }, (_, k) => k - 3).flatMap((place) => Array.from({ length: 9 }, (_, d) => (d + 1) * m.placeValueTimesTenUnit(place)));
  let same = 0, changed = 0;
  for (const shape of shapes) for (const amount of values) for (const target of values) {
    const now = m.placeValueTimesTenProblemOfShape(shape, amount, target);
    const large = m.placeValueTimesTenOneDigit(Math.max(amount, target))!, small = m.placeValueTimesTenOneDigit(Math.min(amount, target))!;
    const reads = shape.question === "times" && large.digit === 1 && small.digit === 1 && small.place === large.place - 1 && large.place <= m.PLACE_VALUE_TIMES_TEN_MAX_PLACE;
    // The lesson's feature is declared on exactly the readings that changed (an older plugin read them as counts).
    assert.equal(m.placeValueTimesTenUsesDigitOneTimes({ question: shape.question, amount, target }), reads, `the feature: ${shape.question} ${amount}/${target}`);
    if (reads) {
      assert.deepEqual([("question" in now) && now.question, ("amount" in now) && now.amount, ("renamed" in now) && now.renamed], ["times", Math.max(amount, target), 10], `${amount}/${target}`);
      changed += 1;
    } else {
      assert.deepEqual(now, before(shape, amount, target), `${shape.question}/${shape.toward}/${shape.apart} ${amount}/${target}`);
      same += 1;
    }
  }
  eq([changed, same > 40000], [18, true], `18 readings changed (9 neighbouring pairs, either way round); ${same} the same`);
  // At a start: a bound times card's numbers as a pile lays them.
  const bound = { question: "times", amount: 700_000, target: 70_000, bindings: [{ target: "amount", expression: "a" }, { target: "target", expression: " b " }] };
  eq([m.placeValueTimesTenUsesDigitOneTimes(bound), m.placeValueTimesTenUsesDigitOneTimes(bound, [{ a: 4_000_000, b: 400_000 }]), m.placeValueTimesTenUsesDigitOneTimes(bound, [{ a: 4_000_000, b: 400_000 }, { a: 1000, b: 100 }])], [false, false, true], "700/70 practised as 4,000/400, then as 1/0.1");
  eq(m.placeValueTimesTenUsesDigitOneTimes({ ...bound, question: "count" }, [{ a: 1000, b: 100 }]), false, "a count card never");
  eq(m.placeValueTimesTenUsesDigitOneTimes(bound, [{ c: 1000 }]), false, "a pile of other variables leaves the card as written");
});

test("builder: a stated shape (0028 revision 4); without one, the shape read from the numbers as before", () => {
  const contentIn = (built: { actions: unknown[] }) => (built.actions[0] as unknown as { content: m.PlaceValueTimesTenContent }).content;
  const at = { as: "c", role: "concept", place: {} };
  // Without a shape: 100 and 10 are a count, as before.
  const plain = buildPlaceValueTimesTen({ ...at, amount: 100000, target: 10000 });
  eq(contentIn(plain), { question: "count", toward: "right", apart: 1, amount: 100000, target: 10000, counted_in: 100000, moved_once: 0 }, "no shape: 1 hundred = ? tens");
  eq(buildPlaceValueTimesTen({ ...at, shape: { question: "count", toward: "right", apart: 1 }, amount: 100000, target: 10000 }), plain, "a count shape: the same card");
  // A times shape: 100 is ? times 10.
  const timesCard = buildPlaceValueTimesTen({ ...at, shape: TIMES, amount: 100000, target: 10000 });
  eq(contentIn(timesCard), { question: "times", toward: "right", apart: 1, amount: 100000, target: 10000, counted_in: 100000, moved_once: 0 }, "a times shape: 100 is ? times 10");
  eq([timesCard.problem.question, timesCard.problem.renamed], ["times", 10], "its problem");
  eq(failure(contentIn(timesCard)), undefined, "a valid card");
  const smallFirst = buildPlaceValueTimesTen({ ...at, shape: TIMES, amount: { expression: "small", initial: 100 }, target: { expression: "big", initial: 1000 }, counted_in: { expression: "counted", initial: 1000 } });
  eq([contentIn(smallFirst).amount, contentIn(smallFirst).target, contentIn(smallFirst).bindings], [1000, 100, [{ target: "target", expression: "small" }, { target: "amount", expression: "big" }, { target: "counted_in", expression: "counted" }]], "0.1 and 1: the larger on top, bindings follow");
  // A put-together count: the shape fixes the start unit (40 hundredths: 0.01).
  const together = buildPlaceValueTimesTen({ ...at, shape: { question: "count", toward: "left", apart: 1 }, amount: 400, target: 100 });
  eq(together, buildPlaceValueTimesTen({ ...at, amount: 400, target: 100, start: 10 }), "40 hundredths -> tenths: the same card as with its start");
  // Every listed problem: its own shape stated builds the same card as without it.
  for (const item of [...TIMES_TEN_PROBLEMS.en, ...TIMES_TEN_PROBLEMS.zh]) {
    const input = { ...at, amount: v(item.amount), target: v(item.target), ...(item.start !== undefined ? { start: v(item.start) } : {}) };
    const without = buildPlaceValueTimesTen(input);
    eq(buildPlaceValueTimesTen({ ...input, shape: m.placeValueTimesTenShapeOf(without.problem) }), without, `${item.amount}/${item.target}: the stated shape, the same card`);
  }
  // A shape the numbers do not make: refused, as the card would.
  assert.throws(() => buildPlaceValueTimesTen({ ...at, shape: TIMES, amount: 300, target: 1 }), /not_same_shape/u, "a count's numbers on a times shape");
  assert.throws(() => buildPlaceValueTimesTen({ ...at, shape: { question: "times", toward: "left", apart: 2 }, amount: 100000, target: 10000 }), /not_same_shape/u, "a times pair breaks right, one place apart");
  assert.throws(() => buildPlaceValueTimesTen({ ...at, shape: { question: "count", toward: "right", apart: 2 }, amount: 100000, target: 10000 }), /not_whole/u, "100 two places from 10 starts in thousands");
});

test("builder: the program supplies counted in; a pair written smaller first; bindings", () => {
  const built = buildPlaceValueTimesTen({ as: "chart", role: "concept", place: { region_intent: "new_topic" }, amount: { expression: "amount", initial: 300 }, target: { expression: "target", initial: 1 } });
  const content = (built.actions[0] as unknown as { content: m.PlaceValueTimesTenContent }).content;
  eq([content.question, content.toward, content.apart, content.counted_in, content.moved_once, content.moved_twice], ["count", "right", 2, 100, 0, 0], "3 tenths -> thousandths, counted in 0.1 supplied");
  eq(failure(content), undefined, "a valid card");
  const swapped = buildPlaceValueTimesTen({ as: "c", role: "concept", place: {}, amount: { expression: "small", initial: 300 }, target: { expression: "big", initial: 3000 }, counted_in: { expression: "counted", initial: 1000 }, moved_once: { expression: "rows", initial: 0 } });
  const sc = (swapped.actions[0] as unknown as { content: m.PlaceValueTimesTenContent }).content;
  eq([sc.amount, sc.target, sc.bindings], [3000, 300, [{ target: "target", expression: "small" }, { target: "amount", expression: "big" }, { target: "counted_in", expression: "counted" }, { target: "moved_once", expression: "rows" }]], "0.3 and 3: the larger on top, bindings follow");
  const together = buildPlaceValueTimesTen({ as: "c", role: "concept", place: {}, amount: 400, target: 100, start: 10 });
  eq((together.actions[0] as unknown as { content: m.PlaceValueTimesTenContent }).content.counted_in, 10, "40 hundredths start counted in 0.01 (10 thousandths)");
  assert.throws(() => buildPlaceValueTimesTen({ as: "c", role: "concept", place: {}, amount: 300000, target: 100000 }), /same_unit/u, "30 tens without its start");
  ok(math.PLACE_VALUE_TIMES_TEN_KIND === "place_value_times_ten" && typeof math.renderPlaceValueTimesTen === "function", "exported from the plugin");
  each(all, (p) => ok(m.placeValueTimesTenVariableCount(p) <= 5, "at most 5 variables"));
});

test("ported model checks", () => {
  ok(ported > 7000, `model checks run: ${ported}`);
  console.log(`place-value times-ten: ${ported} checks`);
});
