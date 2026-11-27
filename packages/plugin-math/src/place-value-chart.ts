/**
 * The place-value chart (decision 0025, need 35P-05): a `place_value_chart` card of the math plugin.
 *
 * The content states a number and a chart of disks: one column per place, from the highest place of the
 * card's whole periods down to the ones (and tenths to thousandths when the card has decimals), each
 * column holding up to nine disks, each disk worth its place. Two tasks share the card: building a number
 * from its name, an expanded form or its place counts (`build`), and pulling a numeral apart place by place
 * (`apart`), each place's disks moving into its own part below the chart. This module is the card's
 * program: the number's texts (ported from the accepted sketch's model), its content rules, its tap rules,
 * the facts a task reads, and the plan the view draws. It imports nothing at run time, so the core
 * validator, the reducer and the web runtime can all load it (decision 0013 §3).
 *
 * Every value is an exact integer count of thousandths: 0.3 is 300 and nothing is ever rounded (a rounded
 * target, 2 -> 1.99, has lost lessons before). Every text the card shows about the number is computed
 * here, never written by a model. Counts may pass between whole numbers while a variable animates; the
 * card draws (and counts) the whole disks reached so far, so a count animating 0 -> 3 shows disks one at
 * a time.
 */

export const PLACE_VALUE_CHART_KIND = "place_value_chart";
export const PLACE_VALUE_CHART_FEATURE = "plugin:math/place-value-chart@1";
/** The math plugin version that is to introduce the card (the manifest is bumped when the card is wired in). */
export const PLACE_VALUE_CHART_PLUGIN_VERSION = "0.8.0";
/** The languages a chart speaks. A chart without `language` speaks US English. */
export const PLACE_VALUE_CHART_LANGUAGES = ["en-US", "zh-CN"] as const;
export type PlaceValueLanguage = typeof PLACE_VALUE_CHART_LANGUAGES[number];

/** Numeric fields of a place that lesson variables may drive. */
export const PLACE_VALUE_CHART_BINDINGS = {
  places: ["count", "pulled"],
} as const;
/**
 * The card-level field a lesson variable may drive: a practice task's start changes the number. A binding
 * names it bare (`{ target: "target", expression }`); the core's binding targets are `part.field` today, so
 * the core learns this form when the card is wired in.
 */
export const PLACE_VALUE_CHART_CARD_BINDINGS = ["target"] as const;
/** Content fields whose items are addressable parts (`chart#tens`). */
export const PLACE_VALUE_CHART_PART_FIELDS = ["places"] as const;

export const PLACE_VALUE_MIN_PLACE = -3; // thousandths
export const PLACE_VALUE_MAX_PLACE = 6; // millions (4.NBT's limit is 1,000,000)
export const PLACE_VALUE_MAX_PER_PLACE = 9;
/** The largest value a chart holds, in thousandths: 9,999,999.999. */
export const PLACE_VALUE_MAX_VALUE = 10 ** (PLACE_VALUE_MAX_PLACE + 1) * 1000 - 1;

export const PLACE_VALUE_CHART_MODES = ["build", "apart"] as const;
export type PlaceValueMode = typeof PLACE_VALUE_CHART_MODES[number];
/** What a build task gives the learner; a pull-apart task always gives the numeral. */
export const PLACE_VALUE_BUILD_GIVENS = ["name", "expanded", "expanded_factors", "place_counts"] as const;
export type PlaceValueGiven = typeof PLACE_VALUE_BUILD_GIVENS[number] | "numeral";

/** Each place's alias (a part's `as`), place 6 (millions) to -3 (thousandths). */
export const PLACE_VALUE_PLACE_ALIASES: Readonly<Record<number, string>> = {
  6: "millions", 5: "hundred-thousands", 4: "ten-thousands", 3: "thousands", 2: "hundreds", 1: "tens", 0: "ones",
  [-1]: "tenths", [-2]: "hundredths", [-3]: "thousandths",
};

/**
 * The places a tap names, by index: a canonical `card.tap`'s and a logged tap's `place` is an index here, the
 * place plus three (thousandths 0, ones 3, millions 9). The index does not depend on the card's columns, so a
 * log means the same on every chart. An authoring tap's `at` is the alias.
 */
export const PLACE_VALUE_TAP_PLACES: readonly string[] = Object.freeze(Array.from({ length: PLACE_VALUE_MAX_PLACE - PLACE_VALUE_MIN_PLACE + 1 }, (_, i) => PLACE_VALUE_PLACE_ALIASES[i + PLACE_VALUE_MIN_PLACE]!));
/** A place (6 to -3) as a tap's index, and back. */
export const placeValueTapIndex = (place: number): number => place - PLACE_VALUE_MIN_PLACE;
export const placeValueTapPlace = (index: number): number => index + PLACE_VALUE_MIN_PLACE;

const SHORT: Record<PlaceValueLanguage, "en" | "zh"> = { "en-US": "en", "zh-CN": "zh" };
const short = (language: PlaceValueLanguage | undefined): "en" | "zh" => SHORT[language ?? "en-US"] ?? "en";

// ---------------------------------------------------------------- the number (sketch model, ported)

/** "4050", "347.392", "0.05", "4,050" -> integer thousandths; undefined when not a number this chart holds. */
export function placeValueParse(text: string): number | undefined {
  const written = String(text).trim().replace(/,/g, "");
  const match = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(written);
  if (!match) return undefined;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? "").padEnd(3, "0") || "0");
  const value = whole * 1000 + frac;
  if (value > PLACE_VALUE_MAX_VALUE) return undefined;
  return value;
}

/** The digit of a value (in thousandths) in a place, 6 (millions) to -3 (thousandths). */
export function placeValueDigitAt(value: number, place: number): number {
  return Math.floor(value / 10 ** (place + 3)) % 10;
}

/** The highest non-zero place of a value; 0 for zero. */
export function placeValueTopPlace(value: number): number {
  for (let place = PLACE_VALUE_MAX_PLACE; place >= PLACE_VALUE_MIN_PLACE; place -= 1) if (placeValueDigitAt(value, place)) return place;
  return 0;
}

export function placeValueHasFraction(value: number): boolean { return value % 1000 !== 0; }

const groupThousands = (whole: number): string => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The numeral as a learner writes it: en groups thousands with commas; zh writes plain digits. */
export function placeValueNumeral(value: number, language: PlaceValueLanguage = "en-US"): string {
  const whole = Math.floor(value / 1000);
  const frac = value % 1000;
  const wholeText = short(language) === "en" ? groupThousands(whole) : String(whole);
  if (!frac) return wholeText;
  return `${wholeText}.${String(frac).padStart(3, "0").replace(/0+$/u, "")}`;
}

/** A place's own value as text, for a disk or a part: 100, 0.01, 10,000 (en) or 1万 (zh, on disks). */
export function placeValueUnitText(place: number, language: PlaceValueLanguage = "en-US", { disk = false }: { disk?: boolean } = {}): string {
  if (place < 0) return `0.${"0".repeat(-place - 1)}1`;
  if (disk && short(language) === "zh" && place >= 4) return `${10 ** (place - 4)}万`;
  return short(language) === "en" ? groupThousands(10 ** place) : String(10 ** place);
}

/** The label a disk of a place carries (its value; zh writes 1万 to 100万). */
export const placeValueDiskLabel = (place: number, language: PlaceValueLanguage = "en-US"): string => placeValueUnitText(place, language, { disk: true });

const EN_PLACE: Record<number, string> = { 6: "Millions", 5: "Hundred thousands", 4: "Ten thousands", 3: "Thousands", 2: "Hundreds", 1: "Tens", 0: "Ones", [-1]: "Tenths", [-2]: "Hundredths", [-3]: "Thousandths" };
const ZH_PLACE: Record<number, string> = { 6: "百万位", 5: "十万位", 4: "万位", 3: "千位", 2: "百位", 1: "十位", 0: "个位", [-1]: "十分位", [-2]: "百分位", [-3]: "千分位" };
/** A column's name: "Hundred thousands", 「十分位」. */
export function placeValueColumnName(place: number, language: PlaceValueLanguage = "en-US"): string {
  return (short(language) === "en" ? EN_PLACE : ZH_PLACE)[place]!;
}

/** Whole places per period: en groups by three (ones, thousands, millions), zh by four (个级, 万级). */
const periodSize = (language: PlaceValueLanguage): number => (short(language) === "en" ? 3 : 4);

/** The highest column of the whole period a place belongs to; nothing above millions. */
export function placeValuePeriodTop(place: number, language: PlaceValueLanguage = "en-US"): number {
  const size = periodSize(language);
  return Math.min(PLACE_VALUE_MAX_PLACE, (Math.floor(Math.max(place, 0) / size) + 1) * size - 1);
}

/** The columns of a chart, highest first: top_place down to the ones, then tenths to thousandths with decimals. */
export function placeValueColumns(topPlace: number, decimals: boolean): number[] {
  const columns: number[] = [];
  for (let place = topPlace; place >= 0; place -= 1) columns.push(place);
  if (decimals) columns.push(-1, -2, -3);
  return columns;
}

/**
 * The chart's columns for one value, highest first. Whole periods are shown, so the empty columns do not give
 * away how many digits the number has: en groups by three, zh by four. Nothing above millions. Tenths to
 * thousandths appear whenever the number has a fraction part (or when asked to).
 */
export function placeValueChartColumns(value: number, language: PlaceValueLanguage = "en-US", { decimals = placeValueHasFraction(value) }: { decimals?: boolean } = {}): number[] {
  return placeValueColumns(placeValuePeriodTop(placeValueTopPlace(value), language), decimals);
}

/**
 * The fixed columns of a card that shows several numbers (the lesson's and each practice task's): the whole
 * periods covering the largest, and decimals when any has a fraction part.
 */
export function placeValueColumnsFor(values: readonly number[], language: PlaceValueLanguage = "en-US"): { top_place: number; decimals: boolean } {
  const top = Math.max(0, ...values.map((value) => placeValueTopPlace(value)));
  return { top_place: placeValuePeriodTop(top, language), decimals: values.some((value) => placeValueHasFraction(value)) };
}

/** Which period a place belongs to, for the label over a group of columns. */
export function placeValuePeriodName(place: number, language: PlaceValueLanguage = "en-US"): string {
  if (place < 0) return short(language) === "en" ? "" : "小数部分";
  if (short(language) === "en") return ["Ones", "Thousands", "Millions"][Math.floor(place / 3)]!;
  return ["个级", "万级"][Math.floor(place / 4)]!;
}

// English names (US: no "and" in whole numbers; "and" marks the point).
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function enBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : ""));
  else if (n > 0) parts.push(ONES[n]!);
  return parts.join(" ");
}
function enWhole(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  const millions = Math.floor(n / 1e6), thousands = Math.floor(n / 1e3) % 1000, rest = n % 1000;
  if (millions) parts.push(`${enBelowThousand(millions)} million`);
  if (thousands) parts.push(`${enBelowThousand(thousands)} thousand`);
  if (rest) parts.push(enBelowThousand(rest));
  return parts.join(" ");
}
/** The US English name of a value: "four thousand fifty", "three hundred forty-seven and three hundred ninety-two thousandths". */
export function placeValueNameEn(value: number): string {
  const whole = Math.floor(value / 1000), frac = value % 1000;
  if (!frac) return enWhole(whole);
  const digits = String(frac).padStart(3, "0").replace(/0+$/u, "");
  const unit = ["tenth", "hundredth", "thousandth"][digits.length - 1];
  const count = Number(digits);
  const fracText = `${enWhole(count)} ${unit}${count === 1 ? "" : "s"}`;
  return whole ? `${enWhole(whole)} and ${fracText}` : fracText;
}

// Chinese names (textbook reading: 二 not 两; 零 for each run of inner zeros; 十 not 一十 at the start).
const ZH_DIGIT = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const ZH_UNIT = ["", "十", "百", "千"];
/** One four-digit group, without leading 零 handling (the caller adds it). */
function zhGroup(n: number): string {
  let text = "", zero = false;
  for (let i = 3; i >= 0; i -= 1) {
    const d = Math.floor(n / 10 ** i) % 10;
    if (d === 0) { if (text) zero = true; continue; }
    if (zero) { text += "零"; zero = false; }
    text += ZH_DIGIT[d]! + ZH_UNIT[i]!;
  }
  return text;
}
function zhWhole(n: number): string {
  if (n === 0) return "零";
  const high = Math.floor(n / 1e4), low = n % 1e4;
  let text = "";
  if (high) text += `${zhGroup(high)}万`;
  if (low) text += (high && low < 1000 ? "零" : "") + zhGroup(low);
  // 十 at the very start is read without 一 (十二万, 十五), but 一百一十 keeps it.
  return text.startsWith("一十") ? text.slice(1) : text;
}
/** The Chinese reading of a value: 「四千零五十」, 「三百四十七点三九二」. */
export function placeValueNameZh(value: number): string {
  const whole = Math.floor(value / 1000), frac = value % 1000;
  if (!frac) return zhWhole(whole);
  const digits = String(frac).padStart(3, "0").replace(/0+$/u, "");
  return `${zhWhole(whole)}点${[...digits].map((d) => ZH_DIGIT[Number(d)]).join("")}`;
}
/** A value's name in a language. */
export function placeValueNumberName(value: number, language: PlaceValueLanguage = "en-US"): string {
  return short(language) === "en" ? placeValueNameEn(value) : placeValueNameZh(value);
}

/** One part of a number pulled apart: a non-zero place, its digit, and what it is worth (thousandths). */
export interface PlaceValuePart { place: number; digit: number; value: number }

/** The number's non-zero places, highest first: each is one part when the number is pulled apart. */
export function placeValueParts(value: number): PlaceValuePart[] {
  const list: PlaceValuePart[] = [];
  for (let place = PLACE_VALUE_MAX_PLACE; place >= PLACE_VALUE_MIN_PLACE; place -= 1) {
    const digit = placeValueDigitAt(value, place);
    if (digit) list.push({ place, digit, value: digit * 10 ** (place + 3) });
  }
  return list;
}

/** Expanded form as a sum of values: "4,000 + 50"; "300 + 40 + 7 + 0.3 + 0.09 + 0.002". */
export function placeValueExpanded(value: number, language: PlaceValueLanguage = "en-US"): string {
  const list = placeValueParts(value);
  return list.length ? list.map((part) => placeValueNumeral(part.value, language)).join(" + ") : "0";
}

/** Expanded form with factors (5.NBT.A.3.a): "3 × 100 + 4 × 10 + 7 × 1 + 3 × (1/10) + …". */
export function placeValueExpandedFactors(value: number, language: PlaceValueLanguage = "en-US"): string {
  const list = placeValueParts(value);
  if (!list.length) return "0";
  return list.map(({ place, digit }) => `${digit} × ${place < 0 ? `(1/${10 ** -place})` : placeValueUnitText(place, language)}`).join(" + ");
}

const EN_UNIT: Record<number, [string, string]> = { 6: ["million", "millions"], 5: ["hundred thousand", "hundred thousands"], 4: ["ten thousand", "ten thousands"], 3: ["thousand", "thousands"], 2: ["hundred", "hundreds"], 1: ["ten", "tens"], 0: ["one", "ones"], [-1]: ["tenth", "tenths"], [-2]: ["hundredth", "hundredths"], [-3]: ["thousandth", "thousandths"] };
const ZH_UNIT_NAME: Record<number, string> = { 6: "百万", 5: "十万", 4: "万", 3: "千", 2: "百", 1: "十", 0: "一", [-1]: "0.1", [-2]: "0.01", [-3]: "0.001" };
/**
 * A place's unit as a sentence names it: "1,000", "0.1" (en, the disk's value) or 「千」「十万」「0.1」 (zh, the
 * counting unit). Shared with the cards built on this chart (decision 0026 §6).
 */
export function placeValueUnitName(place: number, language: PlaceValueLanguage = "en-US"): string {
  return short(language) === "en" ? placeValueUnitText(place, "en-US") : ZH_UNIT_NAME[place]!;
}
/** A place's unit as an English word, one or many: "tenth" / "tenths", "hundred thousand" (shared with 0028). */
export function placeValueEnUnitWord(place: number, plural: boolean): string {
  return EN_UNIT[place]![plural ? 1 : 0];
}
/** How many of each place (zh 「8个千、6个十和3个一」; en "8 thousands, 6 tens and 3 ones"): the non-zero places only. */
export function placeValueCountsText(value: number, language: PlaceValueLanguage = "en-US"): string {
  const list = placeValueParts(value);
  if (short(language) === "en") {
    const items = list.map(({ place, digit }) => `${digit} ${EN_UNIT[place]![digit === 1 ? 0 : 1]}`);
    return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0] ?? "0";
  }
  const items = list.map(({ place, digit }) => `${digit}个${ZH_UNIT_NAME[place]}`);
  return items.length > 1 ? `${items.slice(0, -1).join("、")}和${items.at(-1)}` : items[0] ?? "0";
}

export type PlaceValueTaskFault = "zero" | "one_place";

/**
 * A task the card refuses because what it shows would be the answer: a number with one non-zero place, given
 * as a sum of values ("4,000"), as one times its place ("1 × 1,000") or pulled apart ("0.05 = __"), shows the
 * numeral the child is asked to write.
 * The compiler refuses such a number with the chart's capability, so the section is written again.
 */
export function placeValueTaskFault(value: number, given: PlaceValueGiven | string): PlaceValueTaskFault | undefined {
  if (!value) return "zero";
  const parts = placeValueParts(value);
  if ((given === "expanded" || given === "numeral") && parts.length < 2) return "one_place";
  // "1 × 1,000" writes the place's value, which is the number itself (review of #111).
  if (given === "expanded_factors" && parts.length === 1 && parts[0]!.digit === 1) return "one_place";
  return undefined;
}

// The chart's state as the sketch holds it: disks per place.
export type PlaceValueDisks = Record<number, number>;
export function placeValueEmptyChart(columns: readonly number[]): PlaceValueDisks { return Object.fromEntries(columns.map((place) => [place, 0])); }
export function placeValueChartOf(value: number, columns: readonly number[]): PlaceValueDisks { return Object.fromEntries(columns.map((place) => [place, placeValueDigitAt(value, place)])); }

export type PlaceValueDiskResult = { ok: true; chart: PlaceValueDisks; reason?: undefined } | { ok: false; reason: "no_place" | "full" | "empty"; chart?: undefined };

/** Adding a disk: refused at nine, because ten of a place make one of the next (that is 35P-04's card). */
export function placeValueAddDisk(chart: PlaceValueDisks, place: number): PlaceValueDiskResult {
  if (!(place in chart)) return { ok: false, reason: "no_place" };
  if (chart[place]! >= PLACE_VALUE_MAX_PER_PLACE) return { ok: false, reason: "full" };
  return { ok: true, chart: { ...chart, [place]: chart[place]! + 1 } };
}
export function placeValueRemoveDisk(chart: PlaceValueDisks, place: number): PlaceValueDiskResult {
  if (!(place in chart) || chart[place] === 0) return { ok: false, reason: "empty" };
  return { ok: true, chart: { ...chart, [place]: chart[place]! - 1 } };
}
export function placeValueChartValue(chart: PlaceValueDisks): number {
  return Object.entries(chart).reduce((sum, [place, count]) => sum + count * 10 ** (Number(place) + 3), 0);
}
/** "I'm done" for building: every place holds the target's digit. Says nothing about which place is wrong. */
export function placeValueBuiltRight(chart: PlaceValueDisks, target: number): boolean { return placeValueChartValue(chart) === target; }

// ---------------------------------------------------------------- content

export interface PlaceValueChartPlace {
  /** The place's alias (`ones`, `tenths`, `hundred-thousands`): the part a binding or emphasis names. */
  as: string;
  /** 6 (millions) to -3 (thousandths). */
  place: number;
  /** Disks on the chart in this place, 0 to 9. */
  count: number;
  /** Pull-apart only: disks taken out of this place into its part below the chart. */
  pulled?: number;
}

export interface PlaceValueChartContent {
  /** The language of the chart's own words; absent means US English. */
  language?: PlaceValueLanguage;
  mode: PlaceValueMode;
  given: PlaceValueGiven;
  /** The highest column (the top of a whole period for the language), fixed for the card. */
  top_place: number;
  /** Whether the chart has tenths to thousandths, fixed for the card. */
  decimals: boolean;
  /** The number, in integer thousandths (4,050 is 4050000; 0.3 is 300). */
  target: number;
  /** One per column, highest place first. */
  places: PlaceValueChartPlace[];
  bindings?: unknown[];
}

type Fail = (path: string, message: string) => never;

function record(value: unknown, path: string, fail: Fail): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "Expected an object");
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, allowed: readonly string[], path: string, fail: Fail): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}/${key}`, `Unknown place-value chart field '${key}'`);
}

function wholeNumber(raw: unknown, path: string, low: number, high: number, fail: Fail, what: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < low || raw > high) fail(path, `${what} is a whole number from ${low} to ${high}`);
  return raw as number;
}

/** The chart's language from its content: Chinese when it says so, else US English. */
export function placeValueLanguage(raw: unknown): PlaceValueLanguage {
  return (raw as { language?: unknown } | null)?.language === "zh-CN" ? "zh-CN" : "en-US";
}

/** The tops a chart's columns may start at for a language: the top of each whole period. */
export function placeValuePeriodTops(language: PlaceValueLanguage = "en-US"): number[] {
  return [...new Set(Array.from({ length: PLACE_VALUE_MAX_PLACE + 1 }, (_, place) => placeValuePeriodTop(place, language)))];
}

/**
 * Checks a card's content. With `boundValues` (the core checking the card at a value a variable can take)
 * only each field's own range is checked: the joint rules (a pulled place and its count make the number's
 * digit; a task that would show its own answer) belong to a starting chart and are kept by the tap rules.
 */
export function validatePlaceValueChartContent(raw: unknown, path: string, fail: Fail, options: { boundValues?: boolean } = {}): void {
  const content = record(raw, path, fail);
  only(content, ["language", "mode", "given", "top_place", "decimals", "target", "places", "bindings"], path, fail);
  if (content.language !== undefined && !PLACE_VALUE_CHART_LANGUAGES.includes(content.language as PlaceValueLanguage)) {
    fail(`${path}/language`, `A chart speaks ${PLACE_VALUE_CHART_LANGUAGES.join(" or ")}`);
  }
  const language = placeValueLanguage(content);
  const mode = content.mode;
  if (!PLACE_VALUE_CHART_MODES.includes(mode as PlaceValueMode)) fail(`${path}/mode`, "A chart's mode is 'build' or 'apart'");
  const given = content.given;
  if (mode === "build" && !PLACE_VALUE_BUILD_GIVENS.includes(given as typeof PLACE_VALUE_BUILD_GIVENS[number])) {
    fail(`${path}/given`, `A build task gives ${PLACE_VALUE_BUILD_GIVENS.join(", ")}`);
  }
  if (mode === "apart" && given !== "numeral") fail(`${path}/given`, "A pull-apart task gives the numeral");
  const tops = placeValuePeriodTops(language);
  const top = wholeNumber(content.top_place, `${path}/top_place`, 0, PLACE_VALUE_MAX_PLACE, fail, "The top place");
  if (!tops.includes(top)) fail(`${path}/top_place`, `A ${language} chart shows whole periods: its top place is ${tops.join(", ")}`);
  if (typeof content.decimals !== "boolean") fail(`${path}/decimals`, "decimals is true or false");
  const columns = placeValueColumns(top, content.decimals as boolean);
  const target = wholeNumber(content.target, `${path}/target`, 1, PLACE_VALUE_MAX_VALUE, fail, "The target (in thousandths)");
  if (placeValueTopPlace(target) > top) fail(`${path}/target`, `The target ${placeValueNumeral(target)} has a place above the chart's columns`);
  if (placeValueHasFraction(target) && !content.decimals) fail(`${path}/target`, `The target ${placeValueNumeral(target)} has a fraction part: the chart needs decimals`);
  if (!Array.isArray(content.places) || content.places.length !== columns.length) {
    fail(`${path}/places`, `A chart of these columns lists ${columns.length} places, highest first`);
  }
  for (const [i, item] of (content.places as unknown[]).entries()) {
    const at = `${path}/places/${i}`;
    const place = record(item, at, fail);
    only(place, ["as", "place", "count", "pulled"], at, fail);
    const expected = columns[i]!;
    if (place.place !== expected) fail(`${at}/place`, `Place ${i + 1} is ${expected} (${placeValueColumnName(expected)}): places are listed highest first`);
    if (place.as !== PLACE_VALUE_PLACE_ALIASES[expected]) fail(`${at}/as`, `Place ${expected} is '${PLACE_VALUE_PLACE_ALIASES[expected]}'`);
    const name = placeValueColumnName(expected).toLowerCase();
    const count = wholeNumber(place.count, `${at}/count`, 0, PLACE_VALUE_MAX_PER_PLACE, fail, `The count of ${name}`);
    if (mode === "build") {
      if (place.pulled !== undefined) fail(`${at}/pulled`, "A build task pulls nothing apart");
      continue;
    }
    if (place.pulled === undefined) fail(`${at}/pulled`, "A pull-apart task states how many of each place are pulled out");
    const pulled = wholeNumber(place.pulled, `${at}/pulled`, 0, PLACE_VALUE_MAX_PER_PLACE, fail, `The pulled ${name}`);
    if (!options.boundValues && count + pulled !== placeValueDigitAt(target, expected)) {
      fail(`${at}`, `The ${name} on the chart and pulled out make ${count + pulled}, not the target's digit ${placeValueDigitAt(target, expected)}`);
    }
  }
  if (options.boundValues) return;
  if (placeValueTaskFault(target, given as PlaceValueGiven) === "one_place") {
    fail(`${path}/target`, `${placeValueNumeral(target)} has one non-zero place: given as ${given === "numeral" ? "a numeral to pull apart" : "an expanded form"}, it shows its own answer`);
  }
  // A chart that already holds the number leaves nothing to build (review of #111).
  if (mode === "build" && (content.places as Array<{ place: number; count: number }>).reduce((sum, item) => sum + item.count * 10 ** (item.place + 3), 0) === target) {
    fail(`${path}/places`, `The chart already holds ${placeValueNumeral(target)}: a build task starts before the number is built`);
  }
}

// ---------------------------------------------------------------- state, taps and facts

/** A chart as whole numbers: its columns highest first, and each column's disks on the chart and pulled out. */
export interface PlaceValueChartState {
  mode: PlaceValueMode;
  columns: number[];
  counts: number[];
  pulled: number[];
  target: number;
}

/**
 * The disks a count draws: a count between whole numbers (a variable animating) draws the whole disks
 * reached so far, so 0 -> 3 shows them one at a time; never fewer than none or more than nine.
 */
export function placeValueDrawnCount(count: unknown): number {
  if (typeof count !== "number" || !Number.isFinite(count)) return 0;
  return Math.min(PLACE_VALUE_MAX_PER_PLACE, Math.max(0, Math.floor(count + 1e-9)));
}

/** The chart a content describes, as whole numbers (what it draws). */
export function placeValueChartState(raw: unknown): PlaceValueChartState {
  const content = (raw ?? {}) as Partial<PlaceValueChartContent>;
  const top = typeof content.top_place === "number" && Number.isInteger(content.top_place) ? Math.min(PLACE_VALUE_MAX_PLACE, Math.max(0, content.top_place)) : 0;
  const columns = placeValueColumns(top, content.decimals === true);
  const places = Array.isArray(content.places) ? content.places : [];
  const find = (place: number) => places.find((item) => item?.place === place);
  const target = typeof content.target === "number" && Number.isFinite(content.target) ? Math.max(0, Math.round(content.target)) : 0;
  return {
    mode: content.mode === "apart" ? "apart" : "build",
    columns,
    counts: columns.map((place) => placeValueDrawnCount(find(place)?.count)),
    pulled: columns.map((place) => placeValueDrawnCount(find(place)?.pulled)),
    target,
  };
}

const disksOf = (state: PlaceValueChartState): PlaceValueDisks => Object.fromEntries(state.columns.map((place, i) => [place, state.counts[i]!]));

/** One learner tap on the card: a disk added to or removed from a place (build), or a place taken out (apart). */
export interface PlaceValueTap { tap: "add" | "remove" | "take_out"; place: number }

export type PlaceValueRefusal = "no_place" | "full" | "empty" | "wrong_mode";

export type PlaceValueTapResult = { ok: true; state: PlaceValueChartState } | { ok: false; reason: PlaceValueRefusal };

/**
 * The tap rules. Building: a place holds nine at most (a tenth is refused, not traded: that is 35P-04) and an
 * empty place has nothing to remove. Pulling apart: taking a place out moves all its disks into its part, and
 * a place with no disks (a zero, or already out) has nothing to take. Each task refuses the other's taps.
 */
export function applyPlaceValueTap(state: PlaceValueChartState, tap: PlaceValueTap): PlaceValueTapResult {
  const index = state.columns.indexOf(tap.place);
  if (index < 0) return { ok: false, reason: "no_place" };
  if (tap.tap === "take_out") {
    if (state.mode !== "apart") return { ok: false, reason: "wrong_mode" };
    if (state.counts[index] === 0) return { ok: false, reason: "empty" };
    return {
      ok: true,
      state: { ...state, counts: state.counts.map((count, i) => (i === index ? 0 : count)), pulled: state.pulled.map((pulled, i) => (i === index ? pulled + state.counts[index]! : pulled)) },
    };
  }
  if (tap.tap !== "add" && tap.tap !== "remove") return { ok: false, reason: "wrong_mode" };
  if (state.mode !== "build") return { ok: false, reason: "wrong_mode" };
  const result = tap.tap === "add" ? placeValueAddDisk(disksOf(state), tap.place) : placeValueRemoveDisk(disksOf(state), tap.place);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, state: { ...state, counts: state.columns.map((place) => result.chart[place]!) } };
}

/** The fields one tap changes, as content values: each place (and its column index) to its new count or pulled. */
export function placeValueChanges(before: PlaceValueChartState, after: PlaceValueChartState): Array<{ index: number; place: number; field: "count" | "pulled"; before: number; after: number }> {
  const changes: Array<{ index: number; place: number; field: "count" | "pulled"; before: number; after: number }> = [];
  after.columns.forEach((place, index) => {
    if (after.counts[index] !== before.counts[index]) changes.push({ index, place, field: "count", before: before.counts[index]!, after: after.counts[index]! });
    if (after.pulled[index] !== before.pulled[index]) changes.push({ index, place, field: "pulled", before: before.pulled[index]!, after: after.pulled[index]! });
  });
  return changes;
}

export interface PlaceValueFacts {
  /** The value of the disks on the chart, in thousandths. */
  value: number;
  /** Build: the chart holds exactly the number. Says nothing about which place is wrong. */
  built: boolean;
  /** Pull apart: every place has been taken out. */
  pulled_all: boolean;
}

/** Facts a task reads. */
export function placeValueFacts(state: PlaceValueChartState): PlaceValueFacts {
  const value = placeValueChartValue(disksOf(state));
  return {
    value,
    built: state.mode === "build" && placeValueBuiltRight(disksOf(state), state.target),
    pulled_all: state.mode === "apart" && state.counts.every((count) => count === 0),
  };
}

// ---------------------------------------------------------------- words

/** The chart's own words, whole sentences per language: never a word put into another language's sentence. */
export const PLACE_VALUE_WORDS = {
  "en-US": {
    chartLabel: "A place-value chart",
    point: "Decimal point",
    add: "+",
    takeOut: "Take out",
    addLabel: (name: string) => `Put a disk in the ${name.toLowerCase()}`,
    removeLabel: (name: string) => `Take a disk from the ${name.toLowerCase()}`,
    takeOutLabel: (name: string) => `Take out the ${name.toLowerCase()}`,
    refusal: {
      full: "This place holds nine at most. Ten of them make one of the next place.",
      empty: "There is no disk in this place.",
    },
    other: "That can't be done here.",
    /** How to work the chart, per task (fixed text the host shows with a task on the card). */
    howTo: {
      build: "Tap + under a place to put a disk there. Tap a disk to take it away. Tap “I'm done” when the chart shows the number.",
      apart: "Tap “Take out” under a place to pull its disks out. When every place is out, write what each part is worth.",
    },
  },
  "zh-CN": {
    chartLabel: "数位表",
    point: "小数点",
    add: "+",
    takeOut: "拿出来",
    addLabel: (name: string) => `在${name}上放一个`,
    removeLabel: (name: string) => `从${name}上拿走一个`,
    takeOutLabel: (name: string) => `把${name}的都拿出来`,
    refusal: {
      full: "这一位最多放九个。十个就是左边一位的一个。",
      empty: "这一位没有圆片。",
    },
    other: "这里不能这样做。",
    howTo: {
      build: "点数位下面的“+”，在这一位放一个；点一个就拿走它。摆好了点“我做完了”。",
      apart: "点数位下面的“拿出来”，把这一位的都拿出来。每一位都拿出来以后，写出每一部分是多少。",
    },
  },
} as const;

/** How to work the chart, in its language, for its task: fixed text, so the lesson's words need not say it. */
export function placeValueHowTo(raw: unknown): string {
  const words = PLACE_VALUE_WORDS[placeValueLanguage(raw)];
  return words.howTo[(raw as { mode?: unknown } | null)?.mode === "apart" ? "apart" : "build"];
}

/** What the card tells a learner when a tap is refused, in the chart's language (US English by default). */
export function placeValueRefusalText(reason: PlaceValueRefusal, language: PlaceValueLanguage = "en-US"): string {
  const words = PLACE_VALUE_WORDS[language] ?? PLACE_VALUE_WORDS["en-US"];
  return (words.refusal as Record<string, string>)[reason] ?? words.other;
}

/**
 * What the card gives the learner above the chart, in its language, written by the program: the number's
 * name, an expanded form, its place counts (build), or its numeral (pull apart). A build task never shows
 * the numeral.
 */
export function placeValueGivenText(raw: unknown): string {
  const content = (raw ?? {}) as Partial<PlaceValueChartContent>;
  const language = placeValueLanguage(content);
  const target = placeValueChartState(content).target;
  if (content.mode === "apart") return placeValueNumeral(target, language);
  switch (content.given) {
    case "expanded": return placeValueExpanded(target, language);
    case "expanded_factors": return placeValueExpandedFactors(target, language);
    case "place_counts": return placeValueCountsText(target, language);
    default: return placeValueNumberName(target, language);
  }
}

// ---------------------------------------------------------------- plan

export interface PlaceValueBox { x: number; y: number; width: number; height: number }

/** A column of the chart: its head, its box of disks, its button row, and (pull apart) its part below. */
export interface PlaceValueColumnPlan {
  place: number;
  x: number;
  width: number;
  /** The baseline of the head's first line (each band has its own). */
  headY: number;
  /** The column's name, in one or two lines. */
  head: string[];
  box: PlaceValueBox;
  button: PlaceValueBox & { text: string };
  /** Pull apart: where the place's pulled disks lie. */
  part?: PlaceValueBox;
  diskLabel: string;
  fill: string;
}

export interface PlaceValueChartPlan {
  width: number;
  height: number;
  /** A disk's diameter. */
  disk: number;
  fontSize: number;
  /** The baseline of each head's first line in the first band. */
  headY: number;
  /**
   * The rows the columns are laid in, each a run of whole periods (the decimals are one): one row, or on a
   * narrow screen several, highest places first. Each lists its columns' places.
   */
  bands: number[][];
  periods: Array<{ name: string; x: number; width: number; y: number }>;
  columns: PlaceValueColumnPlan[];
  /** The decimal point, between the ones and the tenths (at the start of the decimals' band when wrapped). */
  point?: { x: number; y: number };
}

export interface PlaceValueChartPlanOptions {
  /**
   * The width in screen pixels the card can take at most (a phone's screen less the board's margins). A chart
   * whose disks would draw smaller than `PLACE_VALUE_FIT_DISK_PX` across that width in one row wraps its
   * periods into bands instead (decision 0025: the real card needs a phone layout). Absent: one row.
   */
  fitWidth?: number;
}

/**
 * The size a disk keeps on a narrow screen, in pixels: 24 is the smallest a learner taps reliably, with room
 * for the board's own margins around the card.
 */
export const PLACE_VALUE_FIT_DISK_PX = 25;

/** One fill per place, so neighbouring places differ (the sketch's palette). */
export const PLACE_VALUE_FILLS: Readonly<Record<number, string>> = {
  6: "#7b5cd6", 5: "#2f8fb8", 4: "#2fa36b", 3: "#d06a2a", 2: "#c9a227", 1: "#3a76d8", 0: "#d24c6b",
  [-1]: "#148a8a", [-2]: "#8a5a2b", [-3]: "#5d6478",
};

const DISK = 30;
const GAP = 4;
const PAD = 5;
const COLUMN = 2 * DISK + GAP + 2 * PAD;
const COLUMN_GAP = 6;
const POINT = 16;
const EDGE = 10;
const BAND = 20;
const HEAD = 30;
const BUTTON = 30;
/** Between two bands of a wrapped chart. */
const BAND_GAP = 14;
/** Nine disks two to a row. */
const ROWS = Math.ceil(PLACE_VALUE_MAX_PER_PLACE / 2);
const BOX = 2 * PAD + ROWS * DISK + (ROWS - 1) * GAP;

/** A run of columns' width: their columns, the gaps between them, and the point before tenths. */
const runWidth = (places: readonly number[]): number =>
  places.length * COLUMN + (places.length - 1) * COLUMN_GAP + (places.includes(-1) ? POINT : 0);

/**
 * The bands of a chart's columns: one row, unless `fitWidth` is given and one row would draw its disks under
 * `PLACE_VALUE_FIT_DISK_PX` across it. Then whole periods (the decimals are one) are packed in order into rows
 * that each fit, so a period is never split; a period too wide alone keeps a row of its own.
 */
export function placeValueChartBands(columns: readonly number[], language: PlaceValueLanguage = "en-US", { fitWidth }: PlaceValueChartPlanOptions = {}): number[][] {
  const fits = (places: readonly number[]) => fitWidth === undefined || DISK * fitWidth / (runWidth(places) + 2 * EDGE) >= PLACE_VALUE_FIT_DISK_PX;
  if (fits(columns)) return [[...columns]];
  const periods: number[][] = [];
  for (const place of columns) {
    const last = periods.at(-1);
    if (last && placeValuePeriodName(last[0]!, language) === placeValuePeriodName(place, language) && (last[0]! < 0) === (place < 0)) last.push(place);
    else periods.push([place]);
  }
  const bands: number[][] = [];
  for (const period of periods) {
    const last = bands.at(-1);
    if (last && fits([...last, ...period])) last.push(...period);
    else bands.push([...period]);
  }
  return bands;
}

/**
 * The chart's layout, from the sketch: a band naming each whole period, a head per column, a column per
 * place with its disks two to a row, the decimal point between the ones and the tenths, a row of buttons,
 * and (pull apart) each place's part below. Sized for nine in every place, so the card keeps one size
 * whatever the learner does; only the columns (fixed content) and the screen's width change it. On a narrow
 * screen (`fitWidth`) the periods wrap into rows, each drawn the same way, so disks and buttons keep their size.
 */
export function planPlaceValueChart(raw: unknown, options: PlaceValueChartPlanOptions = {}): PlaceValueChartPlan {
  const content = (raw ?? {}) as Partial<PlaceValueChartContent>;
  const language = placeValueLanguage(content);
  const words = PLACE_VALUE_WORDS[language];
  const state = placeValueChartState(content);
  const fontSize = 12;
  const bands = placeValueChartBands(state.columns, language, options);
  // Within a band, top to bottom: the period names, the heads, the disks, the buttons, then the parts.
  const bandHeight = BAND + 4 + HEAD + 4 + BOX + 6 + BUTTON + (state.mode === "apart" ? 8 + BOX : 0);
  const columns: PlaceValueColumnPlan[] = [];
  const periods: PlaceValueChartPlan["periods"] = [];
  let point: { x: number; y: number } | undefined;
  let width = 0;
  bands.forEach((band, b) => {
    const bandY = EDGE + b * (bandHeight + BAND_GAP);
    const headTop = bandY + BAND + 4;
    const boxY = headTop + HEAD + 4;
    const buttonY = boxY + BOX + 6;
    const partY = buttonY + BUTTON + 8;
    let x = EDGE;
    const first = columns.length;
    for (const place of band) {
      if (place === -1) {
        point = { x: x + POINT / 2 - (x === EDGE ? 0 : COLUMN_GAP / 2), y: boxY + BOX / 2 };
        x += POINT;
      }
      const name = placeValueColumnName(place, language);
      columns.push({
        place,
        x,
        width: COLUMN,
        headY: headTop + fontSize,
        head: language === "en-US" && name.includes(" ") ? name.split(" ") : [name],
        box: { x, y: boxY, width: COLUMN, height: BOX },
        button: { x, y: buttonY, width: COLUMN, height: BUTTON, text: state.mode === "apart" ? words.takeOut : words.add },
        ...(state.mode === "apart" ? { part: { x, y: partY, width: COLUMN, height: BOX } } : {}),
        diskLabel: placeValueDiskLabel(place, language),
        fill: PLACE_VALUE_FILLS[place]!,
      });
      x += COLUMN + COLUMN_GAP;
    }
    width = Math.max(width, x - COLUMN_GAP + EDGE);
    const inBand = columns.slice(first);
    for (let i = 0; i < inBand.length;) {
      const name = placeValuePeriodName(inBand[i]!.place, language);
      let j = i;
      while (j + 1 < inBand.length && placeValuePeriodName(inBand[j + 1]!.place, language) === name) j += 1;
      periods.push({ name, x: inBand[i]!.x, width: inBand[j]!.x + COLUMN - inBand[i]!.x, y: bandY });
      i = j + 1;
    }
  });
  const height = EDGE + bands.length * bandHeight + (bands.length - 1) * BAND_GAP + EDGE;
  return { width, height, disk: DISK, fontSize, headY: columns[0]?.headY ?? EDGE + BAND + 4 + fontSize, bands, periods, columns, ...(point ? { point } : {}) };
}


/** Where the i-th disk of a column (or of its part, `part: true`) lies: its centre, two to a row. */
export function placeValueDiskAt(plan: PlaceValueChartPlan, place: number, index: number, part = false): { x: number; y: number } {
  const column = plan.columns.find((candidate) => candidate.place === place)!;
  const box = part ? column.part ?? column.box : column.box;
  const D = plan.disk;
  return { x: box.x + PAD + (index % 2) * (D + GAP) + D / 2, y: box.y + PAD + Math.floor(index / 2) * (D + GAP) + D / 2 };
}

/** The font size a disk label fits at: the sketch's three sizes, by the label's length. */
export function placeValueDiskFont(label: string): number {
  return label.length >= 6 ? 7.5 : label.length >= 4 ? 9.5 : 12;
}
