// The place-value chart (decision 0025): the number's texts and the chart's rules ported from the accepted
// sketch (its model checks, all but the typed-answer reader, which the player's numeric row replaces), then
// the card's content rules, tap rules, facts, plan and builder. Numbers here are invented.
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/place-value-chart.js";
import {
  PLACE_VALUE_WORDS, applyPlaceValueTap, placeValueChanges, placeValueChartState, placeValueDiskAt, placeValueDrawnCount, placeValueFacts,
  placeValueGivenText, placeValueHowTo, placeValueRefusalText, planPlaceValueChart, validatePlaceValueChartContent,
  type PlaceValueChartState, type PlaceValueTap,
} from "../src/place-value-chart.js";
import { buildPlaceValueChart } from "../src/place-value-chart-builder.js";
import * as math from "../src/index.js";

// ---------------------------------------------------------------- the sketch's model checks (test-model.mjs)

let ported = 0;
const eq = (actual: unknown, expected: unknown, what: string) => { assert.deepEqual(actual, expected, what); ported += 1; };
const v = (text: string) => m.placeValueParse(text)!;

test("sketch: exact values in thousandths, nothing rounded", () => {
  eq(v("4050"), 4050000, "whole");
  eq(v("4,050"), 4050000, "commas");
  eq(v("347.392"), 347392, "decimal");
  eq(v("0.05"), 50, "0.05");
  eq(v("0.3"), v("0.30"), "0.3 = 0.30");
  eq(v("1000000"), 1e9, "a million");
  eq(m.placeValueParse("1.2345"), undefined, "no ten-thousandths");
  eq(m.placeValueParse("-3"), undefined, "no negatives");
  eq(m.placeValueParse("12345678"), undefined, "nothing past millions");
  eq(m.placeValueChartValue(m.placeValueChartOf(v("0.002"), m.placeValueChartColumns(v("0.002")))), 2, "0.002 rebuilds exactly");
});

test("sketch: English names", () => {
  eq(m.placeValueNameEn(v("4050")), "four thousand fifty", "inner zero");
  eq(m.placeValueNameEn(v("1000000")), "one million", "million");
  eq(m.placeValueNameEn(v("3060400")), "three million sixty thousand four hundred", "zeros across periods");
  eq(m.placeValueNameEn(v("115")), "one hundred fifteen", "teen");
  eq(m.placeValueNameEn(v("347.392")), "three hundred forty-seven and three hundred ninety-two thousandths", "5.NBT.A.3");
  eq(m.placeValueNameEn(v("0.05")), "five hundredths", "0.05");
  eq(m.placeValueNameEn(v("2.705")), "two and seven hundred five thousandths", "2.705");
  eq(m.placeValueNameEn(v("6.041")), "six and forty-one thousandths", "6.041");
  eq(m.placeValueNameEn(v("0.1")), "one tenth", "singular");
});

test("sketch: Chinese names (零 rules, 十 vs 一十, decimals read digit by digit)", () => {
  eq(m.placeValueNameZh(v("4050")), "四千零五十", "inner zero");
  eq(m.placeValueNameZh(v("3060400")), "三百零六万零四百", "zero across 万");
  eq(m.placeValueNameZh(v("100010")), "十万零一十", "十 at the start, 一十 inside");
  eq(m.placeValueNameZh(v("120000")), "十二万", "十二万");
  eq(m.placeValueNameZh(v("110")), "一百一十", "一百一十");
  eq(m.placeValueNameZh(v("10")), "十", "十");
  eq(m.placeValueNameZh(v("15")), "十五", "十五");
  eq(m.placeValueNameZh(v("7009")), "七千零九", "two zeros read once");
  eq(m.placeValueNameZh(v("50000")), "五万", "trailing zeros silent");
  eq(m.placeValueNameZh(v("1000000")), "一百万", "一百万");
  eq(m.placeValueNameZh(v("20300")), "二万零三百", "zero at the head of the low group");
  eq(m.placeValueNameZh(v("200000")), "二十万", "二十万");
  eq(m.placeValueNameZh(v("347.392")), "三百四十七点三九二", "decimal");
  eq(m.placeValueNameZh(v("0.05")), "零点零五", "0.05");
  eq(m.placeValueNameZh(v("2.705")), "二点七零五", "inner zero after the point");
});

test("sketch: numerals, expanded forms, place counts and the refused tasks", () => {
  eq(m.placeValueNumeral(v("4050"), "en-US"), "4,050", "en commas");
  eq(m.placeValueNumeral(v("4050"), "zh-CN"), "4050", "zh plain");
  eq(m.placeValueNumeral(v("0.05"), "en-US"), "0.05", "decimal numeral");

  eq(m.placeValueExpanded(v("4050")), "4,000 + 50", "values");
  eq(m.placeValueExpanded(v("347.392")), "300 + 40 + 7 + 0.3 + 0.09 + 0.002", "values, decimals");
  eq(m.placeValueExpandedFactors(v("347.392")), "3 × 100 + 4 × 10 + 7 × 1 + 3 × (1/10) + 9 × (1/100) + 2 × (1/1000)", "5.NBT.A.3.a");
  eq(m.placeValueExpandedFactors(v("4050")), "4 × 1,000 + 5 × 10", "factors");
  eq(m.placeValueParts(v("4050")).map((p) => p.place), [3, 1], "zero places are no part");

  eq(m.placeValueCountsText(v("8063"), "zh-CN"), "8个千、6个十和3个一", "place counts zh");
  eq(m.placeValueCountsText(v("8063"), "en-US"), "8 thousands, 6 tens and 3 ones", "place counts en");
  eq(m.placeValueCountsText(v("0.309"), "zh-CN"), "3个0.1和9个0.001", "decimal place counts zh");
  eq(m.placeValueCountsText(v("1001"), "en-US"), "1 thousand and 1 one", "singular");

  eq(m.placeValueTaskFault(v("4000"), "expanded"), "one_place", "4,000 as a sum shows the answer");
  eq(m.placeValueTaskFault(v("0.05"), "numeral"), "one_place", "0.05 pulled apart is its own part");
  eq(m.placeValueTaskFault(v("4000"), "name"), undefined, "four thousand is fine");
  eq(m.placeValueTaskFault(v("4050"), "expanded"), undefined, "two places");
});

test("sketch: columns are whole periods, so empty columns don't give away the digit count", () => {
  eq(m.placeValueChartColumns(v("4050"), "en-US"), [5, 4, 3, 2, 1, 0], "en: thousands period");
  eq(m.placeValueChartColumns(v("4050"), "zh-CN"), [3, 2, 1, 0], "zh: 个级");
  eq(m.placeValueChartColumns(v("45000"), "zh-CN"), [6, 5, 4, 3, 2, 1, 0], "zh: 万级, capped at 百万");
  eq(m.placeValueChartColumns(v("1000000"), "en-US"), [6, 5, 4, 3, 2, 1, 0], "en: a million");
  eq(m.placeValueChartColumns(v("347.392"), "en-US"), [2, 1, 0, -1, -2, -3], "decimals");
  eq(m.placeValueChartColumns(v("0.05"), "en-US"), [2, 1, 0, -1, -2, -3], "small decimal");
});

test("sketch: building holds nine per place; done means exactly the target", () => {
  let chart = m.placeValueEmptyChart([3, 2, 1, 0]);
  for (let i = 0; i < 9; i += 1) chart = m.placeValueAddDisk(chart, 0).chart!;
  eq(m.placeValueAddDisk(chart, 0).reason, "full", "a tenth disk is refused");
  eq(m.placeValueRemoveDisk(m.placeValueEmptyChart([0]), 0).reason, "empty", "nothing to remove");
  chart = m.placeValueEmptyChart([3, 2, 1, 0]);
  for (const [place, n] of [[3, 4], [1, 5]] as const) for (let i = 0; i < n; i += 1) chart = m.placeValueAddDisk(chart, place).chart!;
  eq(m.placeValueBuiltRight(chart, v("4050")), true, "4,050 built");
  eq(m.placeValueBuiltRight(m.placeValueAddDisk(chart, 2).chart!, v("4050")), false, "a disk in the hundreds is wrong");
});

test("every sketch model check is ported except the 11 typed-answer checks (71 - 11 = 60)", () => {
  assert.equal(ported, 60);
});

// ---------------------------------------------------------------- the card

const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const valid = (content: unknown, options?: { boundValues?: boolean }) => validatePlaceValueChartContent(content, "$", fail, options);
const invalid = (content: unknown, pattern: RegExp, options?: { boundValues?: boolean }) => assert.throws(() => valid(content, options), pattern);

/** A card's content by hand: build starts empty unless counts are given; apart starts full. */
function chart(mode: "build" | "apart", target: string, options: { top?: number; decimals?: boolean; given?: string; language?: "en-US" | "zh-CN"; counts?: Record<number, number>; pulled?: Record<number, number> } = {}) {
  const value = v(target);
  const language = options.language ?? "en-US";
  const top = options.top ?? m.placeValuePeriodTop(m.placeValueTopPlace(value), language);
  const decimals = options.decimals ?? m.placeValueHasFraction(value);
  return {
    ...(options.language ? { language } : {}),
    mode, given: options.given ?? (mode === "apart" ? "numeral" : "name"), top_place: top, decimals, target: value,
    places: m.placeValueColumns(top, decimals).map((place) => ({
      as: m.PLACE_VALUE_PLACE_ALIASES[place]!, place,
      count: options.counts?.[place] ?? (mode === "apart" ? m.placeValueDigitAt(value, place) - (options.pulled?.[place] ?? 0) : 0),
      ...(mode === "apart" ? { pulled: options.pulled?.[place] ?? 0 } : {}),
    })),
  };
}

test("content rules: good charts in both tasks and languages", () => {
  valid(chart("build", "4050"));
  valid(chart("build", "4050", { given: "expanded" }));
  valid(chart("build", "347.392", { given: "expanded_factors" }));
  valid(chart("build", "8063", { given: "place_counts", language: "zh-CN" }));
  valid(chart("build", "4000", { given: "name" }), undefined);
  valid(chart("build", "4050", { counts: { 3: 9, 2: 9 } }));
  valid(chart("apart", "347.392"));
  valid(chart("apart", "250708", { language: "zh-CN" }));
  valid(chart("apart", "347.392", { pulled: { 2: 3, [-1]: 3 } }));
  // Wider columns than the target needs (a practice number is larger), and decimals for a whole target.
  valid(chart("build", "4050", { top: 6, decimals: true }));
});

test("content rules: what a chart refuses", () => {
  invalid({ ...chart("build", "4050"), label: "x" }, /Unknown place-value chart field 'label'/);
  invalid({ ...chart("build", "4050"), language: "fr-FR" }, /language: A chart speaks en-US or zh-CN/);
  invalid({ ...chart("build", "4050"), mode: "compare" }, /mode is 'build' or 'apart'/);
  invalid({ ...chart("build", "4050"), given: "numeral" }, /A build task gives name, expanded, expanded_factors, place_counts/);
  invalid({ ...chart("apart", "4050"), given: "name" }, /A pull-apart task gives the numeral/);
  // Columns: a whole period's top, within millions; the places exactly those columns, highest first.
  invalid(chart("build", "4050", { top: 4 }), /top_place: A en-US chart shows whole periods: its top place is 2, 5, 6/);
  invalid(chart("build", "4050", { top: 5, language: "zh-CN" }), /its top place is 3, 6/);
  invalid({ ...chart("build", "4050"), top_place: 7 }, /top place is a whole number from 0 to 6/);
  invalid({ ...chart("build", "4050"), decimals: "yes" }, /decimals is true or false/);
  invalid({ ...chart("build", "4050"), places: chart("build", "4050").places.slice(1) }, /lists 6 places, highest first/);
  invalid({ ...chart("build", "4050"), places: [...chart("build", "4050").places].reverse() }, /Place 1 is 5 \(Hundred thousands\)/);
  invalid({ ...chart("build", "4050"), places: chart("build", "4050").places.map((item) => ({ ...item, as: item.as === "ones" ? "units" : item.as })) }, /Place 0 is 'ones'/);
  // Counts and pulled are whole numbers 0 to 9.
  invalid(chart("build", "4050", { counts: { 0: 10 } }), /count of ones is a whole number from 0 to 9/);
  invalid(chart("build", "4050", { counts: { 1: 1.5 } }), /count of tens is a whole number/);
  invalid(chart("build", "4050", { counts: { 1: -1 } }), /count of tens is a whole number from 0 to 9/);
  // The target: positive, whole thousandths, within the columns.
  invalid({ ...chart("build", "4050"), target: 0 }, /target \(in thousandths\) is a whole number from 1 to 9999999999/);
  invalid({ ...chart("build", "4050"), target: 4050.5 }, /target \(in thousandths\) is a whole number/);
  invalid({ ...chart("build", "4050"), target: v("1000000") }, /has a place above the chart's columns/);
  invalid({ ...chart("build", "4050"), target: v("4050.3") }, /has a fraction part: the chart needs decimals/);
  // A number with one non-zero place, given as a sum or pulled apart, shows its own answer.
  invalid(chart("build", "4000", { given: "expanded" }), /4,000 has one non-zero place: given as an expanded form, it shows its own answer/);
  invalid(chart("apart", "0.05"), /0.05 has one non-zero place: given as a numeral to pull apart/);
  // Pull apart: every place states pulled, and with its count makes the target's digit. Build pulls nothing.
  invalid({ ...chart("apart", "4050"), places: chart("apart", "4050").places.map(({ pulled: _p, ...item }) => item) }, /states how many of each place are pulled out/);
  invalid(chart("apart", "4050", { counts: { 3: 3 } }), /places\/2: The thousands on the chart and pulled out make 3, not the target's digit 4/);
  invalid(chart("apart", "4050", { pulled: { 2: 1 }, counts: { 2: 0 } }), /The hundreds on the chart and pulled out make 1, not the target's digit 0/);
  invalid(chart("apart", "4050", { pulled: { 3: 10 }, counts: { 3: 0 } }), /pulled thousands is a whole number from 0 to 9/);
  invalid({ ...chart("build", "4050"), places: chart("build", "4050").places.map((item) => ({ ...item, pulled: 0 })) }, /A build task pulls nothing apart/);
});

test("content rules at a bound value: each field's own range only", () => {
  // A variable's corner can leave count + pulled short of the digit, or a one-place number: not refused here.
  valid(chart("apart", "4050", { counts: { 3: 9 } }), { boundValues: true });
  valid(chart("apart", "0.05", { decimals: true }), { boundValues: true });
  invalid(chart("build", "4050", { counts: { 0: 10 } }), /from 0 to 9/, { boundValues: true });
  invalid({ ...chart("build", "4050"), target: 0 }, /from 1 to/, { boundValues: true });
});

/** Applies taps, failing on a refusal. */
function tap(start: PlaceValueChartState, ...taps: PlaceValueTap[]): PlaceValueChartState {
  let current = start;
  for (const one of taps) {
    const result = applyPlaceValueTap(current, one);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    current = result.state;
  }
  return current;
}
const refused = (start: PlaceValueChartState, one: PlaceValueTap) => { const result = applyPlaceValueTap(start, one); return result.ok ? "ok" : result.reason; };
const times = (n: number, one: PlaceValueTap): PlaceValueTap[] => Array.from({ length: n }, () => one);

test("tap rules, building: add refuses a tenth, remove refuses an empty place, no taking out", () => {
  const start = placeValueChartState(chart("build", "4050"));
  assert.deepEqual([start.columns, start.counts, start.pulled], [[5, 4, 3, 2, 1, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]);
  const full = tap(start, ...times(9, { tap: "add", place: 0 }));
  assert.equal(full.counts.at(-1), 9);
  assert.equal(refused(full, { tap: "add", place: 0 }), "full");
  assert.equal(refused(start, { tap: "remove", place: 0 }), "empty");
  assert.equal(refused(start, { tap: "take_out", place: 3 }), "wrong_mode");
  assert.equal(refused(start, { tap: "add", place: -1 }), "no_place", "no tenths column");
  assert.equal(refused(start, { tap: "add", place: 6 }), "no_place");
  // 4,050: four thousands and five tens; a disk in the hundreds is wrong until it is taken away.
  let built = tap(start, ...times(4, { tap: "add", place: 3 }), ...times(5, { tap: "add", place: 1 }));
  assert.deepEqual(placeValueFacts(built), { value: v("4050"), built: true, pulled_all: false });
  built = tap(built, { tap: "add", place: 2 });
  assert.deepEqual(placeValueFacts(built), { value: v("4150"), built: false, pulled_all: false });
  assert.equal(placeValueFacts(tap(built, { tap: "remove", place: 2 })).built, true);
  // What one tap changed, for the host to write to the bound variables.
  assert.deepEqual(placeValueChanges(start, tap(start, { tap: "add", place: 3 })), [{ index: 2, place: 3, field: "count", before: 0, after: 1 }]);
  // Decimals: thousandths, exactly.
  const decimal = tap(placeValueChartState(chart("build", "0.305")), ...times(3, { tap: "add", place: -1 }), ...times(5, { tap: "add", place: -3 }));
  assert.deepEqual(placeValueFacts(decimal), { value: 305, built: true, pulled_all: false });
});

test("tap rules, pulling apart: take out moves a place's disks into its part; an empty place has nothing to take", () => {
  const start = placeValueChartState(chart("apart", "347.392"));
  assert.deepEqual([start.columns, start.counts], [[2, 1, 0, -1, -2, -3], [3, 4, 7, 3, 9, 2]]);
  assert.deepEqual(placeValueFacts(start), { value: 347392, built: false, pulled_all: false });
  for (const kind of ["add", "remove"] as const) assert.equal(refused(start, { tap: kind, place: 2 }), "wrong_mode");
  const one = tap(start, { tap: "take_out", place: 2 });
  assert.deepEqual([one.counts, one.pulled], [[0, 4, 7, 3, 9, 2], [3, 0, 0, 0, 0, 0]]);
  assert.equal(refused(one, { tap: "take_out", place: 2 }), "empty", "already out");
  assert.deepEqual(placeValueChanges(start, one), [{ index: 0, place: 2, field: "count", before: 3, after: 0 }, { index: 0, place: 2, field: "pulled", before: 0, after: 3 }]);
  const all = tap(start, ...[2, 1, 0, -1, -2, -3].map((place): PlaceValueTap => ({ tap: "take_out", place })));
  assert.deepEqual(placeValueFacts(all), { value: 0, built: false, pulled_all: true });
  assert.deepEqual(all.pulled, [3, 4, 7, 3, 9, 2]);
  // A zero place has no disks: nothing to take out.
  const zero = placeValueChartState(chart("apart", "4050"));
  assert.equal(refused(zero, { tap: "take_out", place: 2 }), "empty");
  assert.equal(refused(zero, { tap: "take_out", place: -1 }), "no_place");
  assert.equal(placeValueFacts(tap(zero, { tap: "take_out", place: 3 }, { tap: "take_out", place: 1 })).pulled_all, true);
});

test("refusals speak the chart's language: the sketch's words for a full place", () => {
  assert.equal(placeValueRefusalText("full"), "This place holds nine at most. Ten of them make one of the next place.");
  assert.equal(placeValueRefusalText("full", "zh-CN"), "这一位最多放九个。十个就是左边一位的一个。");
  assert.equal(placeValueRefusalText("empty"), "There is no disk in this place.");
  assert.equal(placeValueRefusalText("empty", "zh-CN"), "这一位没有圆片。");
  assert.equal(placeValueRefusalText("wrong_mode"), "That can't be done here.");
  assert.equal(placeValueRefusalText("no_place", "zh-CN"), "这里不能这样做。");
});

test("a count between whole numbers draws the whole disks reached so far: 0 -> 3 shows them one at a time", () => {
  assert.deepEqual([0, 0.4, 0.999, 1, 1.5, 2.9999999999, 3].map(placeValueDrawnCount), [0, 0, 0, 1, 1, 3, 3]);
  assert.deepEqual([-0.5, 9.7, 12, Number.NaN, undefined].map(placeValueDrawnCount), [0, 9, 9, 0, 0]);
  const mid = chart("build", "4050", { counts: { 3: 2.6 } as Record<number, number> });
  assert.deepEqual(placeValueChartState(mid).counts, [0, 0, 2, 0, 0, 0]);
  assert.equal(placeValueFacts(placeValueChartState(mid)).value, v("2000"));
});

test("texts: what the card gives, in its language, and how to work it per task", () => {
  assert.equal(placeValueGivenText(chart("build", "4050")), "four thousand fifty");
  assert.equal(placeValueGivenText(chart("build", "4050", { language: "zh-CN" })), "四千零五十");
  assert.equal(placeValueGivenText(chart("build", "4050", { given: "expanded" })), "4,000 + 50");
  assert.equal(placeValueGivenText(chart("build", "4050", { given: "expanded", language: "zh-CN" })), "4000 + 50");
  assert.equal(placeValueGivenText(chart("build", "4050", { given: "expanded_factors" })), "4 × 1,000 + 5 × 10");
  assert.equal(placeValueGivenText(chart("build", "8063", { given: "place_counts", language: "zh-CN" })), "8个千、6个十和3个一");
  assert.equal(placeValueGivenText(chart("apart", "347.392")), "347.392");
  assert.equal(placeValueGivenText(chart("apart", "250708")), "250,708");
  assert.equal(placeValueGivenText(chart("apart", "250708", { language: "zh-CN" })), "250708");
  // A build task never gives the numeral.
  for (const given of ["name", "expanded", "expanded_factors", "place_counts"]) {
    for (const language of ["en-US", "zh-CN"] as const) {
      const text = placeValueGivenText(chart("build", "4050", { given, language }));
      assert.ok(!text.includes("4,050") && !text.includes("4050"), `${given} ${language}: ${text}`);
    }
  }
  assert.match(placeValueHowTo(chart("build", "4050")), /^Tap \+ under a place.*Tap a disk to take it away.*I'm done/);
  assert.match(placeValueHowTo(chart("apart", "4050")), /^Tap “Take out” under a place/);
  assert.match(placeValueHowTo(chart("build", "4050", { language: "zh-CN" })), /^点数位下面的“\+”.*“我做完了”。$/);
  assert.match(placeValueHowTo(chart("apart", "4050", { language: "zh-CN" })), /^点数位下面的“拿出来”/);
  // Column, period and disk names.
  assert.equal(m.placeValueColumnName(-2, "zh-CN"), "百分位");
  assert.equal(m.placeValuePeriodName(4, "zh-CN"), "万级");
  assert.equal(m.placeValuePeriodName(4, "en-US"), "Thousands");
  assert.deepEqual([5, 6, -3].map((place) => m.placeValueDiskLabel(place, "zh-CN")), ["10万", "100万", "0.001"]);
  assert.deepEqual([5, 6].map((place) => m.placeValueDiskLabel(place, "en-US")), ["100,000", "1,000,000"]);
});

test("the plan: nine disks in every column and every part, none overlapping, inside the chart", () => {
  const cases = [
    chart("build", "4050", { top: 6, decimals: true }),
    chart("apart", "347.392", { top: 6 }),
    chart("build", "8063", { language: "zh-CN" }),
    chart("apart", "250708", { language: "zh-CN", decimals: true }),
  ];
  for (const content of cases) {
    const plan = planPlaceValueChart(content);
    const r = plan.disk / 2;
    const disks: Array<{ x: number; y: number }> = [];
    for (const column of plan.columns) {
      for (const part of column.part ? [false, true] : [false]) {
        const box = part ? column.part! : column.box;
        for (let i = 0; i < 9; i += 1) {
          const at = placeValueDiskAt(plan, column.place, i, part);
          disks.push(at);
          assert.ok(at.x - r >= box.x && at.x + r <= box.x + box.width && at.y - r >= box.y && at.y + r <= box.y + box.height, `place ${column.place} disk ${i} in its box`);
        }
        assert.ok(box.x >= 0 && box.x + box.width <= plan.width && box.y + box.height <= plan.height);
      }
      assert.ok(column.button.y >= column.box.y + column.box.height && column.button.y + column.button.height <= (column.part?.y ?? plan.height));
    }
    assert.ok(disks.every((a, i) => disks.every((b, j) => j <= i || Math.hypot(a.x - b.x, a.y - b.y) >= 2 * r - 1e-9)), "no two disks overlap");
    // Columns never overlap, and the point sits between the ones and the tenths.
    plan.columns.forEach((column, i) => { if (i) assert.ok(column.x >= plan.columns[i - 1]!.x + plan.columns[i - 1]!.width); });
    if (plan.point) {
      const ones = plan.columns.find((column) => column.place === 0)!, tenths = plan.columns.find((column) => column.place === -1)!;
      assert.ok(plan.point.x > ones.x + ones.width && plan.point.x < tenths.x);
    }
  }
  // The widest chart (millions to thousandths, ten columns) and the narrowest (zh 个级, four).
  const widest = planPlaceValueChart(chart("build", "4050", { top: 6, decimals: true }));
  const narrowest = planPlaceValueChart(chart("build", "8063", { language: "zh-CN" }));
  assert.deepEqual([widest.columns.length, widest.width, narrowest.columns.length, narrowest.width], [10, 830, 4, 334]);
  assert.ok(planPlaceValueChart(chart("apart", "4050")).height > planPlaceValueChart(chart("build", "4050")).height, "a pull-apart chart has its parts below");
  // Heads, periods and buttons: words, in the chart's language; build's button is +, apart's says take out.
  assert.deepEqual(widest.periods.map((period) => period.name), ["Millions", "Thousands", "Ones", ""]);
  assert.deepEqual(widest.columns[1]!.head, ["Hundred", "thousands"]);
  assert.deepEqual(planPlaceValueChart(chart("apart", "250708", { language: "zh-CN", decimals: true })).periods.map((period) => period.name), ["万级", "个级", "小数部分"]);
  assert.equal(widest.columns[0]!.button.text, "+");
  assert.equal(planPlaceValueChart(chart("apart", "250708", { language: "zh-CN" })).columns[0]!.button.text, "拿出来");
  // The chart draws no numeral of a build task's number: its texts are names, values on disks, and buttons.
  const texts = JSON.stringify(planPlaceValueChart(chart("build", "4050")));
  assert.ok(!texts.includes("4,050") && !texts.includes("4050"));
  assert.deepEqual(Object.keys(PLACE_VALUE_WORDS["en-US"].howTo), Object.keys(PLACE_VALUE_WORDS["zh-CN"].howTo));
});

test("the builder: columns cover every number shown, bindings for driven values, output passes its own validator", () => {
  // A lesson number and a larger practice number with a fraction part: millions are not needed, decimals are.
  const built = buildPlaceValueChart({
    as: "chart", role: "main_visual", place: { relation: "new_region" }, mode: "build", given: "name",
    target: { expression: "target", initial: v("4050") }, numbers: [v("52008.3")],
    places: [{ place: 3, count: { expression: "thousands", initial: 0 } }, { place: 1, count: { expression: "tens", initial: 0 } }],
  });
  const action = built.actions[0] as unknown as { kind: string; content: Record<string, unknown> };
  assert.equal(action.kind, "place_value_chart");
  assert.deepEqual([action.content.top_place, action.content.decimals, action.content.target], [5, true, 4050000]);
  assert.ok(!("language" in action.content), "an English chart's bytes carry no language");
  assert.deepEqual((action.content.places as Array<{ place: number }>).map((place) => place.place), [5, 4, 3, 2, 1, 0, -1, -2, -3]);
  assert.deepEqual(action.content.bindings, [
    { target: "target", expression: "target" }, { target: "thousands.count", expression: "thousands" }, { target: "tens.count", expression: "tens" },
  ]);
  assert.equal(built.parts.tenths, "chart#tenths");
  assert.equal(built.parts["hundred-thousands"], "chart#hundred-thousands");
  valid(action.content);
  // Chinese whole periods are four places: 52,008 needs 万级.
  const zh = buildPlaceValueChart({ as: "c", role: "main_visual", place: {}, language: "zh-CN", mode: "build", given: "place_counts", target: v("8063"), numbers: [v("52008")] });
  const zhContent = (zh.actions[0] as unknown as { content: Record<string, unknown> }).content;
  assert.deepEqual([zhContent.language, zhContent.top_place, zhContent.decimals], ["zh-CN", 6, false]);
  valid(zhContent);
  // Pulling apart: every place starts full (the target's digit), nothing pulled.
  const apart = buildPlaceValueChart({ as: "c", role: "main_visual", place: {}, mode: "apart", given: "numeral", target: v("347.392") });
  const apartContent = (apart.actions[0] as unknown as { content: Record<string, unknown> }).content;
  assert.deepEqual((apartContent.places as Array<{ count: number; pulled: number }>).map((place) => [place.count, place.pulled]), [[3, 0], [4, 0], [7, 0], [3, 0], [9, 0], [2, 0]]);
  valid(apartContent);
  // Nothing above millions, whatever the language.
  const million = buildPlaceValueChart({ as: "c", role: "main_visual", place: {}, language: "zh-CN", mode: "build", given: "name", target: v("1000000") });
  assert.equal((million.actions[0] as unknown as { content: { top_place: number } }).content.top_place, 6);
  // A task that would show its own answer is built, and refused by the validator (the compiler's job).
  const leak = buildPlaceValueChart({ as: "c", role: "main_visual", place: {}, mode: "build", given: "expanded", target: v("4000") });
  invalid((leak.actions[0] as unknown as { content: unknown }).content, /shows its own answer/);
});

test("the plugin's index exports the card without registering a recipe yet", () => {
  assert.equal(math.PLACE_VALUE_CHART_KIND, "place_value_chart");
  assert.equal(typeof math.buildPlaceValueChart, "function");
  assert.equal(typeof math.renderPlaceValueChart, "function");
  assert.ok(!("place_value_chart" in math.MATH_BUILDERS));
});
