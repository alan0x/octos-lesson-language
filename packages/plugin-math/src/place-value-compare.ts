/**
 * Comparing two numbers by place, from the largest place down (decision 0029, need 35P-06; 4.NBT.A.2 to 1,000,000,
 * 5.NBT.A.3.b to thousandths): a `place_value_compare` card of the math plugin.
 *
 * The two numbers are two rows of one place-value chart, lined up by place (the points lined up), each written at
 * the left edge as given (0.7 stays 0.7, 0.70 stays 0.70). Each column has two buttons between the rows, "Same" and
 * "Different". The learner judges the columns from the left, one at a time; only a true judgement is accepted. The
 * first column rightly judged "Different" decides: its disks that pair up fade, the extra ones stand out, and the
 * columns after it are hatched "Doesn't matter". When every column is the same, the last "Same" ends the comparing.
 * Then the sentence "a [> = <] b", greyed from the start, opens, and the learner's own sign is the check: the card
 * accepts only the true one. Nothing is marked for the learner (decision 0029, owner 2026-11-27).
 *
 * The learner's state is two numbers: `marked`, the columns judged from the left (0 to the deciding column plus
 * one), and `signed`, 1 once the true sign is chosen. Every column left of the deciding one is the same, so the
 * count is the whole chart. A demonstration moves through one more number, `compared`: the columns the program has
 * judged (0 to the deciding column plus one), and one more for the sign. While it shows (above 0) the card refuses
 * every tap, and a card opens, and a practice starts, fresh: nothing compared, judged or signed.
 *
 * The rules, the invariants and the demonstration are ported from the accepted sketch (35P-06 sketch, model.mjs);
 * the place names, fills, disk labels, decimal point and digits are the place-value chart's (decision 0025), and the
 * numeral with its own decimals is the trade card's (0026), shared, not copied. Every value is an exact integer
 * count of thousandths (0.625 is 625); each number also keeps the decimals it is written with. Every text the card
 * shows is computed here, never written by a model. This module imports only the chart's and the trade card's
 * modules, so the core validator, the reducer and the web runtime can all load it (decision 0013 §3).
 */
import {
  PLACE_VALUE_CHART_LANGUAGES, PLACE_VALUE_FILLS, PLACE_VALUE_MAX_PLACE, PLACE_VALUE_MAX_VALUE, PLACE_VALUE_MIN_PLACE, PLACE_VALUE_TAP_PLACES,
  placeValueColumnName, placeValueDigitAt, placeValueDiskLabel, placeValueEnUnitWord, placeValueLanguage, placeValueTapIndex, placeValueTapPlace,
  placeValueTopPlace, placeValueUnitName, type PlaceValueLanguage,
} from "./place-value-chart.js";
import { placeValueTradeDecimals, placeValueTradeNumeralFixed } from "./place-value-trade.js";

export const PLACE_VALUE_COMPARE_KIND = "place_value_compare";
export const PLACE_VALUE_COMPARE_FEATURE = "plugin:math/place-value-compare@1";
/** The math plugin version that introduced the card. */
export const PLACE_VALUE_COMPARE_PLUGIN_VERSION = "0.12.0";
/** The languages the card speaks: the chart's. A card without `language` speaks US English. */
export const PLACE_VALUE_COMPARE_LANGUAGES = PLACE_VALUE_CHART_LANGUAGES;

/** 1,000,000 against 999,999; 3,456.789 against 3,456.798. */
export const PLACE_VALUE_COMPARE_MAX_COLUMNS = 7;
export const PLACE_VALUE_COMPARE_MAX_DECIMALS = 3;
/** The largest number the card takes, in thousandths (the chart's: 9,999,999.999). */
export const PLACE_VALUE_COMPARE_MAX_VALUE = PLACE_VALUE_MAX_VALUE;
/** A lesson holds at most 16 variables (OLL); this card binds 5 to 7. */
export const PLACE_VALUE_COMPARE_MAX_VARIABLES = 16;

/** The card-level fields a lesson variable may drive, each by its bare name: the pair, its written decimals and the demonstration. */
export const PLACE_VALUE_COMPARE_CARD_BINDINGS = ["a", "b", "a_decimals", "b_decimals", "compared"] as const;
/** The card-level fields that make a task's own problem: a practice pair differs from the lesson's. */
export const PLACE_VALUE_COMPARE_PROBLEM_FIELDS = ["a", "b"] as const;
/** The demonstration's field: the columns the program has judged, and one more for the sign. */
export const PLACE_VALUE_COMPARE_DEMONSTRATION_FIELD = "compared";
/** The fields the learner's taps change, bound by their bare names: the columns judged, the true sign chosen. */
export const PLACE_VALUE_COMPARE_TAP_FIELDS = ["marked", "signed"] as const;
export type PlaceValueCompareTapField = typeof PLACE_VALUE_COMPARE_TAP_FIELDS[number];
/** Every field a lesson variable may drive. */
export const PLACE_VALUE_COMPARE_BINDINGS = [...PLACE_VALUE_COMPARE_CARD_BINDINGS, ...PLACE_VALUE_COMPARE_TAP_FIELDS] as const;

/** The three signs, in the order the card draws them. */
export const PLACE_VALUE_COMPARE_SIGNS = [">", "=", "<"] as const;
export type PlaceValueCompareSign = typeof PLACE_VALUE_COMPARE_SIGNS[number];
/** A sign's place name (a tap's `at`). */
export const PLACE_VALUE_COMPARE_SIGN_PLACES = ["greater", "equal", "less"] as const;
/**
 * The places a tap names, by index: the chart's places (the place plus three: thousandths 0, ones 3, millions 9),
 * then the three signs (10 to 12). A judgement names a column, a sign tap names a sign.
 */
export const PLACE_VALUE_COMPARE_TAP_PLACES: readonly string[] = Object.freeze([...PLACE_VALUE_TAP_PLACES, ...PLACE_VALUE_COMPARE_SIGN_PLACES]);
/** A sign as a tap's place index, and back (undefined when the index is not a sign). */
export const placeValueCompareSignIndex = (sign: PlaceValueCompareSign): number => PLACE_VALUE_TAP_PLACES.length + PLACE_VALUE_COMPARE_SIGNS.indexOf(sign);
export const placeValueCompareSignAt = (index: number): PlaceValueCompareSign | undefined =>
  Number.isInteger(index) && index >= PLACE_VALUE_TAP_PLACES.length ? PLACE_VALUE_COMPARE_SIGNS[index - PLACE_VALUE_TAP_PLACES.length] : undefined;
/** The taps a learner makes: "Same" or "Different" under a column, and a sign between the numbers. */
export const PLACE_VALUE_COMPARE_TAPS = ["same", "different", "sign"] as const;
export type PlaceValueCompareTapKind = typeof PLACE_VALUE_COMPARE_TAPS[number];
export const PLACE_VALUE_COMPARE_JUDGEMENTS = ["same", "different"] as const;
export type PlaceValueCompareJudgement = typeof PLACE_VALUE_COMPARE_JUDGEMENTS[number];

const SHORT: Record<PlaceValueLanguage, "en" | "zh"> = { "en-US": "en", "zh-CN": "zh" };
const short = (language: PlaceValueLanguage | undefined): "en" | "zh" => SHORT[language ?? "en-US"] ?? "en";

// ---------------------------------------------------------------- numbers (sketch model, ported)

/** A number as the card holds it: its value in thousandths and the decimals it is written with. */
export interface PlaceValueCompareNumber { value: number; dec: number }

/**
 * "4,530", "0.70", "12.4" -> the value in thousandths and the decimals written (0.70 keeps two). More than three
 * decimals: `{ value: undefined, dec }`. Unreadable (a sign, more than seven whole digits): undefined.
 */
export function placeValueCompareParse(text: string): { value: number | undefined; dec: number } | undefined {
  const written = String(text).trim().replace(/,/g, "");
  const match = /^(\d{1,7})(?:\.(\d+))?$/.exec(written);
  if (!match) return undefined;
  const dec = (match[2] ?? "").length;
  if (dec > PLACE_VALUE_COMPARE_MAX_DECIMALS) return { value: undefined, dec };
  return { value: Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0") || "0"), dec };
}

/**
 * A decimal as a lesson plan writes it, `{ mantissa, scale }` (0.70 is 70 and 2), as the card holds it: the value in
 * thousandths and the decimals written (the scale). Undefined when it is not a number the card takes (negative, more
 * than three decimals, past the millions).
 */
export function placeValueCompareFromDecimal(mantissa: number, scale: number): PlaceValueCompareNumber | undefined {
  if (!Number.isSafeInteger(mantissa) || mantissa < 0 || !Number.isInteger(scale) || scale < 0 || scale > PLACE_VALUE_COMPARE_MAX_DECIMALS) return undefined;
  const value = mantissa * 10 ** (PLACE_VALUE_COMPARE_MAX_DECIMALS - scale);
  return value <= PLACE_VALUE_COMPARE_MAX_VALUE ? { value, dec: scale } : undefined;
}

/** How many decimals a value needs (0 to 3): 0.7 one, 0.625 three. A number may be written with more (0.70). */
export const placeValueCompareOwnDecimals = (value: number): number => placeValueTradeDecimals(value);

/** The numeral as written, with its own decimals (0.70 stays 0.70): en groups thousands with commas; zh writes plain digits. */
export const placeValueCompareNumeral = (value: number, dec: number, language: PlaceValueLanguage = "en-US"): string =>
  placeValueTradeNumeralFixed(value, dec, language);

// ---------------------------------------------------------------- pairs

export type PlaceValueCompareRelation = PlaceValueCompareSign;

/** A pair as the card holds it: its columns (highest first) and each number's digit in each column (by column index). */
export interface PlaceValueComparePair {
  a: number;
  b: number;
  aDec: number;
  bDec: number;
  /** From the highest place either number has (at least the ones) down to the lowest place either is written to. */
  columns: number[];
  da: number[];
  db: number[];
  /** The index of the first column whose digits differ (the place that decides), or the last column when every place matches. */
  stop: number;
  /** The deciding place (the last column's, for an equal pair). */
  place: number;
  equal: boolean;
  relation: PlaceValueCompareRelation;
}

/**
 * The pair's fault: a number that is not a whole number of thousandths from 0 to 9,999,999.999 (`unreadable`), a
 * number written with fewer decimals than it has or more than three (`decimals`), more than seven columns
 * (`too_wide`), or the same numeral twice, nothing to compare (`same_numeral`). Equal values written differently
 * (0.7 and 0.70) are a pair.
 */
export type PlaceValueCompareFault = "unreadable" | "decimals" | "too_wide" | "same_numeral";

/** Why the card refuses this pair, or undefined. */
export function placeValueCompareFault(a: PlaceValueCompareNumber, b: PlaceValueCompareNumber): PlaceValueCompareFault | undefined {
  for (const n of [a, b]) {
    if (!Number.isSafeInteger(n.value) || n.value < 0 || n.value > PLACE_VALUE_COMPARE_MAX_VALUE) return "unreadable";
    if (!Number.isInteger(n.dec) || n.dec < placeValueCompareOwnDecimals(n.value) || n.dec > PLACE_VALUE_COMPARE_MAX_DECIMALS) return "decimals";
  }
  const low = -Math.max(a.dec, b.dec);
  const high = Math.max(placeValueTopPlace(a.value), placeValueTopPlace(b.value), 0);
  if (high - low + 1 > PLACE_VALUE_COMPARE_MAX_COLUMNS) return "too_wide";
  if (a.value === b.value && a.dec === b.dec) return "same_numeral";
  return undefined;
}

/** The pair's columns, digits, deciding place and relation (also for a pair the card refuses: the state stays total). */
export function placeValueComparePairOf(a: PlaceValueCompareNumber, b: PlaceValueCompareNumber): PlaceValueComparePair {
  const low = -Math.max(a.dec, b.dec);
  const high = Math.max(placeValueTopPlace(a.value), placeValueTopPlace(b.value), 0);
  const columns: number[] = [];
  for (let place = high; place >= low; place -= 1) columns.push(place);
  const da = columns.map((place) => placeValueDigitAt(a.value, place));
  const db = columns.map((place) => placeValueDigitAt(b.value, place));
  const first = columns.findIndex((_, k) => da[k] !== db[k]);
  const equal = first === -1;
  const stop = equal ? columns.length - 1 : first;
  const relation: PlaceValueCompareRelation = equal ? "=" : da[stop]! > db[stop]! ? ">" : "<";
  return { a: a.value, b: b.value, aDec: a.dec, bDec: b.dec, columns, da, db, stop, place: columns[stop] ?? 0, equal, relation };
}

/** The sketch's `makePair`: the pair, or the fault the card refuses it for. */
export function placeValueCompareMakePair(a: PlaceValueCompareNumber, b: PlaceValueCompareNumber): PlaceValueComparePair | { fault: PlaceValueCompareFault } {
  const fault = placeValueCompareFault(a, b);
  return fault ? { fault } : placeValueComparePairOf(a, b);
}

/** Two pairs are the same pair: the same numerals, in either order. */
export function placeValueCompareSamePair(x: PlaceValueComparePair, y: PlaceValueComparePair): boolean {
  const same = (p: number, pd: number, q: number, qd: number) => p === q && pd === qd;
  return (same(x.a, x.aDec, y.a, y.aDec) && same(x.b, x.bDec, y.b, y.bDec)) || (same(x.a, x.aDec, y.b, y.bDec) && same(x.b, x.bDec, y.a, y.aDec));
}

/** A practice pair fits when the card takes it and it is not the shown pair (in either order). */
export function placeValueComparePracticeFault(shown: PlaceValueComparePair, a: PlaceValueCompareNumber, b: PlaceValueCompareNumber): PlaceValueCompareFault | "same_pair" | undefined {
  const fault = placeValueCompareFault(a, b);
  if (fault) return fault;
  return placeValueCompareSamePair(shown, placeValueComparePairOf(a, b)) ? "same_pair" : undefined;
}

// ---------------------------------------------------------------- state

/**
 * The card's state of play: the pair (columns empty when the card refuses it), how many columns are judged from the
 * left, whether the true sign is chosen, and the demonstration's `compared` (0 when none shows). While a
 * demonstration shows, `marked` and `signed` are what it shows.
 */
export interface PlaceValueCompareState {
  pair: PlaceValueComparePair;
  fault?: PlaceValueCompareFault;
  marked: number;
  signed: boolean;
  compared: number;
}

/** A fresh card on a pair: nothing judged, no sign, nothing demonstrated. */
export const placeValueCompareStart = (pair: PlaceValueComparePair): PlaceValueCompareState => ({ pair, marked: 0, signed: false, compared: 0 });
/** The comparing is done: the deciding column is found, or every column matched. The sentence opens. */
export const placeValueCompareDecided = (state: PlaceValueCompareState): boolean => !state.fault && state.pair.columns.length > 0 && state.marked === state.pair.stop + 1;
/** The card is complete: the true sign is chosen (a refused pair never is). */
export const placeValueCompareComplete = (state: PlaceValueCompareState): boolean => placeValueCompareDecided(state) && state.signed;
/** A demonstration shows. */
export const placeValueCompareDemonstrating = (state: PlaceValueCompareState): boolean => state.compared > 0;
/** The last value of the demonstration: every column to the deciding one judged, and the sign chosen. */
export const placeValueCompareDemoEnd = (pair: PlaceValueComparePair): number => pair.stop + 2;

export type PlaceValueCompareStatus = "open" | "same" | "decides" | "after";

/** What one column shows. `paired`: disks in each row that pair up (the deciding column); `extra`: the row with more and how many more. */
export interface PlaceValueCompareColumn {
  place: number;
  a: number;
  b: number;
  status: PlaceValueCompareStatus;
  paired: number;
  extra: { row: "a" | "b"; n: number } | null;
}

/** The sketch's `column`. */
export function placeValueCompareColumn(state: PlaceValueCompareState, index: number): PlaceValueCompareColumn {
  const { pair } = state;
  const place = pair.columns[index]!, a = pair.da[index]!, b = pair.db[index]!;
  let status: PlaceValueCompareStatus = "open";
  if (index < state.marked) status = index === pair.stop && !pair.equal ? "decides" : "same";
  else if (placeValueCompareDecided(state) && index > pair.stop) status = "after";
  const paired = status === "same" || status === "decides" ? Math.min(a, b) : 0;
  const extra = status === "decides" ? { row: a > b ? "a" as const : "b" as const, n: Math.abs(a - b) } : null;
  return { place, a, b, status, paired, extra };
}

// ---------------------------------------------------------------- taps

/** One learner tap: a judgement under the column at `index` (an index into the pair's columns), or a sign. */
export type PlaceValueCompareMove = { tap: PlaceValueCompareJudgement; index: number } | { tap: "sign"; sign: PlaceValueCompareSign };

/**
 * Refusals are facts. A judgement: `left_unjudged` (a column to the left is not judged yet), `not_same` /
 * `not_different` (the judgement is not true), `already_same` / `already_decides` (judged already), `after_decided`
 * (after the deciding column). A sign: `not_decided` (the sentence is not open yet), `not_true`, `already_signed`.
 * `demonstrating` (the chart shows the demonstration), `no_place` (no such column), `no_sign` (no such sign),
 * `no_judgement` (a column tap that is neither "Same" nor "Different").
 */
export type PlaceValueCompareRefusal =
  | "left_unjudged" | "not_same" | "not_different" | "already_same" | "already_decides" | "after_decided"
  | "not_decided" | "not_true" | "already_signed" | "demonstrating" | "no_place" | "no_sign" | "no_judgement";
export type PlaceValueCompareAnim = { kind: "same" | "decide"; index: number; place: number; a: number; b: number; done: boolean } | { kind: "sign"; sign: PlaceValueCompareSign };
export type PlaceValueCompareResult = { ok: true; state: PlaceValueCompareState; anim: PlaceValueCompareAnim } | { ok: false; reason: PlaceValueCompareRefusal };

/**
 * The sketch's `tap` and `chooseSign`. Columns are judged from the left, one at a time; every true judgement is
 * accepted ("Same" on a matching column marks it "="; "Different" on the first column that differs decides). A
 * judgement that is not true, or a column with an unjudged column to its left, is refused. The sign opens once the
 * chart is decided, and only the true sign is accepted. No column is ever marked for the learner.
 */
export function placeValueCompareMove(state: PlaceValueCompareState, move: PlaceValueCompareMove): PlaceValueCompareResult {
  if (placeValueCompareDemonstrating(state)) return { ok: false, reason: "demonstrating" };
  const { pair } = state;
  if (move.tap === "sign") {
    if (!PLACE_VALUE_COMPARE_SIGNS.includes(move.sign)) return { ok: false, reason: "no_sign" };
    if (!placeValueCompareDecided(state)) return { ok: false, reason: "not_decided" };
    if (state.signed) return { ok: false, reason: "already_signed" };
    if (move.sign !== pair.relation) return { ok: false, reason: "not_true" };
    return { ok: true, state: { ...state, signed: true }, anim: { kind: "sign", sign: move.sign } };
  }
  if (move.tap !== "same" && move.tap !== "different") return { ok: false, reason: "no_judgement" };
  const k = move.index;
  if (state.fault || !Number.isInteger(k) || k < 0 || k >= pair.columns.length) return { ok: false, reason: "no_place" };
  if (placeValueCompareDecided(state)) return { ok: false, reason: k > pair.stop ? "after_decided" : k === pair.stop && !pair.equal ? "already_decides" : "already_same" };
  if (k < state.marked) return { ok: false, reason: "already_same" };
  if (k > state.marked) return { ok: false, reason: "left_unjudged" };
  const a = pair.da[k]!, b = pair.db[k]!;
  if (move.tap === "same" && a !== b) return { ok: false, reason: "not_same" };
  if (move.tap === "different" && a === b) return { ok: false, reason: "not_different" };
  const next = { ...state, marked: k + 1 };
  return { ok: true, state: next, anim: { kind: move.tap === "different" ? "decide" : "same", index: k, place: pair.columns[k]!, a, b, done: placeValueCompareDecided(next) } };
}

/** One tap as the card kind takes it: a kind and a place index (a chart place, or a sign). */
export interface PlaceValueCompareTap { tap: PlaceValueCompareTapKind; place: number }

/** A tap by place index: a judgement at a chart place (not on the pair's chart: `no_place`), a sign at a sign. */
export function applyPlaceValueCompareTap(state: PlaceValueCompareState, tap: PlaceValueCompareTap): PlaceValueCompareResult {
  if (placeValueCompareDemonstrating(state)) return { ok: false, reason: "demonstrating" };
  if (tap.tap === "sign") {
    const sign = placeValueCompareSignAt(tap.place);
    return sign ? placeValueCompareMove(state, { tap: "sign", sign }) : { ok: false, reason: "no_sign" };
  }
  if (tap.tap !== "same" && tap.tap !== "different") return { ok: false, reason: "no_place" };
  if (!Number.isInteger(tap.place) || tap.place < 0 || tap.place >= PLACE_VALUE_TAP_PLACES.length) return { ok: false, reason: "no_place" };
  const index = state.pair.columns.indexOf(placeValueTapPlace(tap.place));
  return index < 0 ? { ok: false, reason: "no_place" } : placeValueCompareMove(state, { tap: tap.tap, index });
}

/** The column index a tap names on this pair's chart, or -1 (a sign, or a place the chart does not have). */
export const placeValueCompareTapColumn = (state: PlaceValueCompareState, tap: PlaceValueCompareTap): number =>
  tap.tap === "sign" || !Number.isInteger(tap.place) || tap.place < 0 || tap.place >= PLACE_VALUE_TAP_PLACES.length ? -1 : state.pair.columns.indexOf(placeValueTapPlace(tap.place));

/** Every state reachable from the start by any taps in any order: one per judged count, and the sign (stop + 3). */
export function placeValueCompareReachable(pair: PlaceValueComparePair): PlaceValueCompareState[] {
  const key = (s: PlaceValueCompareState) => `${s.marked}${s.signed ? "s" : ""}`;
  const seen = new Map<string, PlaceValueCompareState>();
  const queue = [placeValueCompareStart(pair)];
  while (queue.length) {
    const state = queue.pop()!;
    if (seen.has(key(state))) continue;
    seen.set(key(state), state);
    for (let index = 0; index < pair.columns.length; index += 1) for (const tap of PLACE_VALUE_COMPARE_JUDGEMENTS) {
      const result = placeValueCompareMove(state, { tap, index });
      if (result.ok) queue.push(result.state);
    }
    for (const sign of PLACE_VALUE_COMPARE_SIGNS) {
      const result = placeValueCompareMove(state, { tap: "sign", sign });
      if (result.ok) queue.push(result.state);
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- the demonstration ("compared")

/** The program's demonstration: "Same" on each column from the left, "Different" on the deciding one (an equal pair: "Same" to the last), then the sign. */
export function placeValueCompareDemoSteps(pair: PlaceValueComparePair): { steps: Array<{ index: number; tap: PlaceValueCompareJudgement | "sign"; anim: PlaceValueCompareAnim; after: PlaceValueCompareState }>; final: PlaceValueCompareState } {
  let state = placeValueCompareStart(pair);
  const steps: Array<{ index: number; tap: PlaceValueCompareJudgement | "sign"; anim: PlaceValueCompareAnim; after: PlaceValueCompareState }> = [];
  for (let index = 0; index <= pair.stop; index += 1) {
    const tap: PlaceValueCompareJudgement = index === pair.stop && !pair.equal ? "different" : "same";
    const result = placeValueCompareMove(state, { tap, index });
    if (!result.ok) throw new Error(`demonstration step refused: ${result.reason}`);
    state = result.state;
    steps.push({ index, tap, anim: result.anim, after: state });
  }
  const signed = placeValueCompareMove(state, { tap: "sign", sign: pair.relation });
  if (!signed.ok) throw new Error(`demonstration sign refused: ${signed.reason}`);
  state = signed.state;
  steps.push({ index: pair.stop + 1, tap: "sign", anim: signed.anim, after: state });
  return { steps, final: state };
}

/** The chart "compared = k" shows: k columns judged (k up to the deciding column plus one), the sign chosen at the end. Same k, same chart. */
export function placeValueCompareDemoState(pair: PlaceValueComparePair, k: number): PlaceValueCompareState {
  const end = placeValueCompareDemoEnd(pair);
  if (!Number.isInteger(k) || k < 0 || k > end) throw new Error(`compared must be 0..${end}`);
  return { pair, marked: Math.min(k, pair.stop + 1), signed: k === end, compared: k };
}

/** What "compared" counts on this pair, for a refusal: "'compared' counts …: 0 to 4". */
export function placeValueCompareComparedMeaning(pair: PlaceValueComparePair): string {
  return `counts the columns a ${PLACE_VALUE_COMPARE_KIND} card's demonstration has judged from the left, then one more for the sign: 0 to ${placeValueCompareDemoEnd(pair)} on this pair`;
}

/** What the next value after `value` does on this pair ("the next value, 3, judges the tens"), or that the demonstration is at its end. */
export function placeValueCompareComparedNext(pair: PlaceValueComparePair, value: number): string {
  const end = placeValueCompareDemoEnd(pair);
  const k = Math.max(0, Math.floor(value));
  if (k >= end) return `the sign is chosen at ${end}, the last value`;
  if (k === end - 1) return `the next value, ${end}, chooses the sign`;
  const place = pair.columns[k]!;
  return `the next value, ${k + 1}, judges the ${placeValueColumnName(place).toLowerCase()}`;
}

// ---------------------------------------------------------------- content

export interface PlaceValueCompareContent {
  /** The language of the card's own words; absent means US English. */
  language?: PlaceValueLanguage;
  /** The two numbers, in integer thousandths (4,530 is 4530000; 0.625 is 625). */
  a: number;
  b: number;
  /** The decimals each number is written with, when more than it needs (0.70: 2). Absent: the value's own. */
  a_decimals?: number;
  b_decimals?: number;
  /** The demonstration: the columns judged from the left, then one more for the sign (0 when none shows). */
  compared: number;
  /** The learner's columns judged from the left (0 to 7), and the true sign chosen (0 or 1). */
  marked: number;
  signed: number;
  bindings?: unknown[];
}

type Fail = (path: string, message: string) => never;

function record(value: unknown, path: string, fail: Fail): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "Expected an object");
  return value as Record<string, unknown>;
}
function wholeNumber(raw: unknown, path: string, low: number, high: number, fail: Fail, what: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < low || raw > high) fail(path, `${what} is a whole number from ${low} to ${high}`);
  return raw as number;
}

/** A number of the content: its value and its written decimals (the value's own when not given). */
function numberOf(content: Record<string, unknown>, field: "a" | "b"): PlaceValueCompareNumber {
  const value = Number(content[field]);
  const written = content[`${field}_decimals`];
  return { value, dec: written === undefined ? (Number.isSafeInteger(value) && value >= 0 ? placeValueCompareOwnDecimals(value) : 0) : Number(written) };
}

/** What a fault says, for the compiler's refusal (the card's capability is the write's kind). */
export function placeValueCompareFaultText(fault: PlaceValueCompareFault | "same_pair", a?: PlaceValueCompareNumber, b?: PlaceValueCompareNumber): string {
  const ok = (n?: PlaceValueCompareNumber) => !!n && Number.isSafeInteger(n.value) && n.value >= 0 && n.value <= PLACE_VALUE_COMPARE_MAX_VALUE && Number.isInteger(n.dec) && n.dec >= 0 && n.dec <= 3;
  const show = (n: PlaceValueCompareNumber) => placeValueCompareNumeral(n.value, Math.max(n.dec, placeValueCompareOwnDecimals(n.value)));
  const pair = ok(a) && ok(b) ? `${show(a!)} and ${show(b!)}` : "This pair";
  switch (fault) {
    case "decimals": return `${pair}: a number has at most three decimals, and is written with at least the decimals it has (0.625 writes three) (decimals)`;
    case "too_wide": return `${pair}: the two numbers need more than seven columns (the highest place to the lowest written) (too_wide)`;
    case "same_numeral": return `${pair}: the same numeral twice; there is nothing to compare (0.7 and 0.70 are a pair) (same_numeral)`;
    case "same_pair": return `${pair}: a practice pair is not the shown pair, in either order (same_pair)`;
    default: return "The numbers are whole numbers of thousandths from 0 to 9,999,999.999 (unreadable)";
  }
}

/** The pair a content's own fields make (its two numbers and their written decimals), or its fault. */
export function placeValueCompareContentPair(raw: unknown): PlaceValueComparePair | { fault: PlaceValueCompareFault } {
  const content = (raw ?? {}) as Record<string, unknown>;
  if (typeof content.a !== "number" || typeof content.b !== "number") return { fault: "unreadable" };
  return placeValueCompareMakePair(numberOf(content, "a"), numberOf(content, "b"));
}

/**
 * Checks a card's content. With `boundValues` (the core checking the card at a value a variable can take) only each
 * field's own range is checked: the joint rules (the pair the card takes, a number written with the decimals it
 * has, a judged count and a sign the pair allows, a demonstration on an unjudged chart) belong to a card a lesson
 * shows. With `start` (the card as a lesson opens it, or a practice start) the card is fresh: nothing compared,
 * judged or signed. Without it, `compared` may be past 0: a replay may set a value the demonstration reached.
 */
export function validatePlaceValueCompareContent(raw: unknown, path: string, fail: Fail, options: { boundValues?: boolean; start?: boolean } = {}): void {
  const content = record(raw, path, fail);
  for (const key of Object.keys(content)) {
    if (!["language", ...PLACE_VALUE_COMPARE_BINDINGS, "bindings"].includes(key)) fail(`${path}/${key}`, `Unknown place-value compare field '${key}'`);
  }
  if (content.language !== undefined && !PLACE_VALUE_COMPARE_LANGUAGES.includes(content.language as PlaceValueLanguage)) {
    fail(`${path}/language`, `The card speaks ${PLACE_VALUE_COMPARE_LANGUAGES.join(" or ")}`);
  }
  wholeNumber(content.a, `${path}/a`, 0, PLACE_VALUE_COMPARE_MAX_VALUE, fail, "The first number (in thousandths)");
  wholeNumber(content.b, `${path}/b`, 0, PLACE_VALUE_COMPARE_MAX_VALUE, fail, "The second number (in thousandths)");
  for (const field of ["a_decimals", "b_decimals"]) {
    if (content[field] !== undefined) wholeNumber(content[field], `${path}/${field}`, 0, PLACE_VALUE_COMPARE_MAX_DECIMALS, fail, `The decimals the ${field === "a_decimals" ? "first" : "second"} number is written with`);
  }
  const compared = wholeNumber(content.compared, `${path}/compared`, 0, PLACE_VALUE_COMPARE_MAX_COLUMNS + 1, fail, "Compared (the columns the demonstration judged, then the sign)");
  const marked = wholeNumber(content.marked, `${path}/marked`, 0, PLACE_VALUE_COMPARE_MAX_COLUMNS, fail, "Marked (the columns the learner judged)");
  const signed = wholeNumber(content.signed, `${path}/signed`, 0, 1, fail, "Signed (the true sign chosen)");
  if (options.boundValues) return;
  const a = numberOf(content, "a"), b = numberOf(content, "b");
  const fault = placeValueCompareFault(a, b);
  if (fault) {
    const at = fault === "decimals" ? (a.dec < placeValueCompareOwnDecimals(a.value) ? "a_decimals" : "b_decimals") : "b";
    fail(`${path}/${at}`, placeValueCompareFaultText(fault, a, b));
  }
  const pair = placeValueComparePairOf(a, b);
  const end = placeValueCompareDemoEnd(pair);
  if (marked > pair.stop + 1) {
    fail(`${path}/marked`, `${placeValueCompareNumeral(a.value, a.dec)} and ${placeValueCompareNumeral(b.value, b.dec)} are decided at ${pair.stop + 1} column${pair.stop ? "s" : ""} judged; ${marked} cannot be`);
  }
  if (signed && marked !== pair.stop + 1) fail(`${path}/signed`, "The sign is chosen only once the comparing is done (marked is the deciding column plus one)");
  if (compared > end) fail(`${path}/compared`, `'compared' ${placeValueCompareComparedMeaning(pair)}, not ${compared}`);
  if (compared > 0 && (marked !== 0 || signed !== 0)) fail(`${path}/compared`, "A demonstration (compared past 0) plays on an unjudged chart: marked and signed are 0");
  // A card opens fresh: nothing compared, judged or signed (reviews of #119, #121 and #123).
  if (options.start && compared !== 0) fail(`${path}/compared`, `A card opens fresh: nothing compared, not ${compared}`);
  if (options.start && marked !== 0) fail(`${path}/marked`, `A card opens fresh: nothing judged, not ${marked}`);
  if (options.start && signed !== 0) fail(`${path}/signed`, "A card opens fresh: no sign chosen");
}

/** The card's language from its content: Chinese when it says so, else US English. */
export const placeValueCompareLanguage = (raw: unknown): PlaceValueLanguage => placeValueLanguage(raw);

const EMPTY_PAIR: PlaceValueComparePair = { a: 0, b: 0, aDec: 0, bDec: 0, columns: [], da: [], db: [], stop: -1, place: 0, equal: false, relation: "=" };

/**
 * The card a content describes, as the rules hold it (what it draws and taps act on). Total: any content gives a
 * state. A pair the card refuses draws an empty chart that takes no tap and is never complete. `compared` above 0
 * is the demonstration's chart at that value (the learner's fields are then ignored); else `marked` is taken to
 * what the pair allows and `signed` counts only once the chart is decided.
 */
export function placeValueCompareState(raw: unknown): PlaceValueCompareState {
  const content = (raw ?? {}) as Partial<PlaceValueCompareContent>;
  const int = (value: unknown, low: number, high: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.floor(value + 1e-9))) : low);
  const made = placeValueCompareContentPair(content);
  if ("fault" in made) return { pair: EMPTY_PAIR, fault: made.fault, marked: 0, signed: false, compared: 0 };
  const compared = int(content.compared, 0, placeValueCompareDemoEnd(made));
  if (compared > 0) return placeValueCompareDemoState(made, compared);
  const marked = int(content.marked, 0, made.stop + 1);
  return { pair: made, marked, signed: marked === made.stop + 1 && int(content.signed, 0, 1) === 1, compared: 0 };
}

/** The learner's fields of a state, as the content holds them. */
export const placeValueCompareTapValues = (state: PlaceValueCompareState): Record<PlaceValueCompareTapField, number> =>
  ({ marked: placeValueCompareDemonstrating(state) ? 0 : state.marked, signed: placeValueCompareDemonstrating(state) ? 0 : state.signed ? 1 : 0 });

/** The fields one tap changes, in a fixed order. */
export function placeValueCompareChanges(before: PlaceValueCompareState, after: PlaceValueCompareState): Array<{ field: PlaceValueCompareTapField; before: number; after: number }> {
  const from = placeValueCompareTapValues(before), to = placeValueCompareTapValues(after);
  return PLACE_VALUE_COMPARE_TAP_FIELDS.filter((field) => from[field] !== to[field]).map((field) => ({ field, before: from[field], after: to[field] }));
}

/** Why a card cannot start a learner's task (a practice start), or undefined: a pair the card takes, nothing compared, judged or signed. */
export function placeValueCompareStartFault(state: PlaceValueCompareState): string | undefined {
  if (state.fault) return placeValueCompareFaultText(state.fault);
  if (state.compared !== 0) return `A practice card starts with nothing demonstrated: compared is ${state.compared}, not 0`;
  if (state.marked !== 0) return `A practice card starts fresh: marked is ${state.marked}, not 0`;
  if (state.signed) return "A practice card starts fresh: no sign chosen";
  return undefined;
}

/** The pair and its demonstration, the learner's two fields, and the written decimals when bound: 5 to 7 variables. */
export const placeValueCompareVariableCount = (decimalsBound: 0 | 1 | 2 = 0): number => 5 + decimalsBound;

// ---------------------------------------------------------------- facts

export interface PlaceValueCompareFacts {
  /** The chart's columns, highest first. */
  columns: number[];
  /** The deciding place, or null for an equal pair (every place matches). */
  deciding: number | null;
  /** The two numbers' digits in the deciding place (null for an equal pair). */
  digits: [number, number] | null;
  /** The true sign: >, = or <. */
  relation: PlaceValueCompareRelation;
  /** Columns judged from the left so far, and the next place to judge (null once decided). */
  judged: number;
  next: number | null;
  /** The comparing is done (the sentence opens), and the true sign is chosen. */
  decided: boolean;
  complete: boolean;
}

/** Facts a task reads, and what a lesson's later sections are told about the card. */
export function placeValueCompareFacts(state: PlaceValueCompareState): PlaceValueCompareFacts {
  const { pair } = state, decided = placeValueCompareDecided(state);
  return {
    columns: [...pair.columns],
    deciding: pair.equal || state.fault ? null : pair.place,
    digits: pair.equal || state.fault ? null : [pair.da[pair.stop]!, pair.db[pair.stop]!],
    relation: pair.relation,
    judged: state.marked,
    next: decided || state.fault ? null : pair.columns[state.marked] ?? null,
    decided,
    complete: placeValueCompareComplete(state),
  };
}

// ---------------------------------------------------------------- words (sketch page.js, ported)

/** The card's own words, whole sentences per language: facts about the chart, never a model's. */
export const PLACE_VALUE_COMPARE_WORDS = {
  "en-US": {
    chartLabel: "Two numbers on a place-value chart, lined up by place",
    sentenceLabel: "The two numbers, with a sign to choose between them",
    point: "Decimal point",
    howto: "From the left, judge each place until one is different.",
    howtoSign: "Choose >, = or < between the two numbers below.",
    lock: "Opens when a place differs, or every place is the same.",
    button: { same: "Same", different: "Different" },
    ask: (name: string, judgement: PlaceValueCompareJudgement) => `${name}: ${judgement === "same" ? "the same" : "different"}`,
    signLabel: { ">": "is greater than", "=": "is equal to", "<": "is less than" } as Record<PlaceValueCompareSign, string>,
    caption: "Doesn't matter",
    same: (name: string, a: number, b: number) => `${name}: ${a} and ${b}, the same.`,
    allSame: "Every place is the same.",
    decide: (name: string, a: number, b: number, more: string, unit: string) => `${name}: ${a} and ${b}, the first place that differs. ${more} has more ${unit}.`,
    refusal: {
      left_unjudged: (name: string, a: number, b: number, first: string) => `${name}: ${a} and ${b}. The ${first.toLowerCase()} haven't been compared yet.`,
      not_judged: (name: string, a: number, b: number) => `${name}: ${a} and ${b}.`,
      after_decided: (deciding: string, name: string) => `The ${deciding.toLowerCase()} decide; the ${name.toLowerCase()} come after and don't matter.`,
      already_same: (name: string, a: number, b: number) => `${name}: ${a} and ${b}, the same.`,
      already_decides: (name: string, a: number, b: number) => `${name}: ${a} and ${b}, the first place that differs.`,
      not_true: (x: string, s: string, y: string) => `“${x} ${s} ${y}” is not true.`,
      demonstrating: "This chart shows the demonstration.",
    },
    result: (x: string, s: string, y: string, name: string, after: boolean, equal: boolean) =>
      equal ? `✓ ${x} = ${y}: every place is the same.` : `✓ ${x} ${s} ${y}: the ${name.toLowerCase()} decide${after ? "; the places after them don't matter." : "."}`,
    demo: {
      same: (name: string, a: number, b: number) => `${name}: ${a} and ${b}, the same. Look at the next place.`,
      decide: (name: string, a: number, b: number) => `${name}: ${a} and ${b}, the first place that differs, so the ${name.toLowerCase()} decide.`,
      lastSame: (name: string, a: number, b: number) => `${name}: ${a} and ${b}, the same. Every place is the same.`,
      sign: (x: string, s: string, y: string, name: string, after: boolean, equal: boolean) =>
        equal ? `So ${x} = ${y}.` : `So ${x} ${s} ${y}.${after ? ` The places after the ${name.toLowerCase()} don't matter.` : ""}`,
    },
    other: "That can't be done here.",
    fixedHowTo: "From the left, tap Same or Different under each place, one place at a time, until one is different. Then choose >, = or < between the two numbers.",
  },
  "zh-CN": {
    chartLabel: "数位表上的两个数，按数位对齐",
    sentenceLabel: "两个数，中间选一个符号",
    point: "小数点",
    howto: "从左边起，一位一位判断，直到有一位不一样。",
    howtoSign: "在下面两个数中间选 >、= 或 <。",
    lock: "找到不一样的一位，或每一位都一样后才能选。",
    button: { same: "一样", different: "不一样" },
    ask: (name: string, judgement: PlaceValueCompareJudgement) => `${name}：${judgement === "same" ? "一样" : "不一样"}`,
    signLabel: { ">": "大于", "=": "等于", "<": "小于" } as Record<PlaceValueCompareSign, string>,
    caption: "不影响",
    same: (name: string, a: number, b: number) => `${name}：${a} 和 ${b}，一样。`,
    allSame: "每一位都一样。",
    decide: (name: string, a: number, b: number, more: string, unit: string) => `${name}：${a} 和 ${b}，第一位不同。${more} 的${/^\d/u.test(unit) ? ` ${unit} ` : unit}多。`,
    refusal: {
      left_unjudged: (name: string, a: number, b: number, first: string) => `${name}：${a} 和 ${b}。${first}还没有比。`,
      not_judged: (name: string, a: number, b: number) => `${name}：${a} 和 ${b}。`,
      after_decided: (deciding: string, name: string) => `已经由${deciding}决定了；${name}在后面，不影响。`,
      already_same: (name: string, a: number, b: number) => `${name}：${a} 和 ${b}，一样。`,
      already_decides: (name: string, a: number, b: number) => `${name}：${a} 和 ${b}，第一个不一样的数位。`,
      not_true: (x: string, s: string, y: string) => `「${x} ${s} ${y}」不成立。`,
      demonstrating: "这是演示。",
    },
    result: (x: string, s: string, y: string, name: string, after: boolean, equal: boolean) =>
      equal ? `✓ ${x} = ${y}：每一位都一样。` : `✓ ${x} ${s} ${y}：由${name}决定${after ? "，后面的数位不影响。" : "。"}`,
    demo: {
      same: (name: string, a: number, b: number) => `${name}：${a} 和 ${b}，一样。看下一位。`,
      decide: (name: string, a: number, b: number) => `${name}：${a} 和 ${b}，第一个不一样，所以由${name}决定。`,
      lastSame: (name: string, a: number, b: number) => `${name}：${a} 和 ${b}，一样。每一位都一样。`,
      sign: (x: string, s: string, y: string, name: string, after: boolean, equal: boolean) =>
        equal ? `所以 ${x} = ${y}。` : `所以 ${x} ${s} ${y}。${after ? `${name}后面的数位不影响。` : ""}`,
    },
    other: "这里不能这样做。",
    fixedHowTo: "从左边起，一位一位点它下面的「一样」或「不一样」，直到有一位不一样；然后在两个数中间选 >、= 或 <。",
  },
} as const;

const wordsOf = (language: PlaceValueLanguage) => PLACE_VALUE_COMPARE_WORDS[language] ?? PLACE_VALUE_COMPARE_WORDS["en-US"];
const nameOf = (place: number, language: PlaceValueLanguage) => placeValueColumnName(place, language);
/** The pair's two numerals as written. */
export function placeValueCompareNumerals(pair: PlaceValueComparePair, language: PlaceValueLanguage = "en-US"): [string, string] {
  return [placeValueCompareNumeral(pair.a, pair.aDec, language), placeValueCompareNumeral(pair.b, pair.bDec, language)];
}
/** Columns follow the deciding one. */
const hasAfter = (pair: PlaceValueComparePair): boolean => pair.stop < pair.columns.length - 1;

/** The problem: "Compare 0.625 and 0.7." (not "which is greater": "=" is plainly allowed). */
export function placeValueCompareProblemText(pair: PlaceValueComparePair, language: PlaceValueLanguage = "en-US"): string {
  const [x, y] = placeValueCompareNumerals(pair, language);
  return short(language) === "en" ? `Compare ${x} and ${y}.` : `比较 ${x} 和 ${y}。`;
}
/** The true sentence: "0.625 < 0.7"; "0.7 = 0.70". */
export function placeValueCompareResultText(pair: PlaceValueComparePair, language: PlaceValueLanguage = "en-US"): string {
  const [x, y] = placeValueCompareNumerals(pair, language);
  return `${x} ${pair.relation} ${y}`;
}
/** The line said once the true sign is chosen (a task's success feedback may say it too). */
export function placeValueCompareDoneText(pair: PlaceValueComparePair, language: PlaceValueLanguage = "en-US"): string {
  const [x, y] = placeValueCompareNumerals(pair, language);
  return wordsOf(language).result(x, pair.relation, y, nameOf(pair.place, language), hasAfter(pair), pair.equal);
}

/** How to work the card, in its language: fixed text a host shows with a task on the card. */
export function placeValueCompareHowTo(raw: unknown): string {
  return wordsOf(placeValueCompareLanguage(raw)).fixedHowTo;
}

/** The one-line instruction on the card (only while the learner can tap): judge the places, then choose the sign. */
export function placeValueCompareInstruction(state: PlaceValueCompareState, language: PlaceValueLanguage = "en-US"): string {
  if (state.fault || placeValueCompareComplete(state)) return "";
  const words = wordsOf(language);
  return placeValueCompareDecided(state) ? words.howtoSign : words.howto;
}

/**
 * The fact of the chart as it stands, said under it: the last column judged ("Tens: 3 and 0, the first place that
 * differs. 4,530 has more tens."), and once the true sign is chosen the full sentence. Before the sign it never says
 * which number is greater; it says which row has more of the deciding place, which the disks already show. Empty on
 * a fresh chart.
 */
export function placeValueCompareFactText(state: PlaceValueCompareState, language: PlaceValueLanguage = "en-US"): string {
  if (state.fault || state.marked === 0) return "";
  const { pair } = state, words = wordsOf(language);
  if (placeValueCompareComplete(state)) return placeValueCompareDoneText(pair, language);
  const k = state.marked - 1, place = pair.columns[k]!, a = pair.da[k]!, b = pair.db[k]!;
  if (k === pair.stop && !pair.equal) {
    const [x, y] = placeValueCompareNumerals(pair, language);
    const unit = short(language) === "en" ? placeValueEnUnitWord(place, true) : placeValueUnitName(place, language);
    return words.decide(nameOf(place, language), a, b, a > b ? x : y, unit);
  }
  const text = words.same(nameOf(place, language), a, b);
  return placeValueCompareDecided(state) ? `${text} ${words.allSame}` : text;
}

/**
 * What the card says when a tap is refused, in its language: a fact, never an instruction. A judgement states the
 * column's own digits (and, on a column with an unjudged one to its left, which place is not compared yet); it never
 * names the deciding place before it is found, nor the larger number before the sign.
 */
export function placeValueCompareRefusalText(state: PlaceValueCompareState, tap: PlaceValueCompareTap, language: PlaceValueLanguage = "en-US"): string {
  const words = wordsOf(language);
  const result = applyPlaceValueCompareTap(state, tap);
  if (result.ok) return "";
  const { pair } = state, reason = result.reason;
  if (reason === "demonstrating") return words.refusal.demonstrating;
  if (reason === "not_decided") return words.lock;
  if (reason === "not_true" || reason === "already_signed") {
    const sign = placeValueCompareSignAt(tap.place)!;
    const [x, y] = placeValueCompareNumerals(pair, language);
    return reason === "not_true" ? words.refusal.not_true(x, sign, y) : placeValueCompareDoneText(pair, language);
  }
  const k = placeValueCompareTapColumn(state, tap);
  if (k < 0) return words.other;
  const name = nameOf(pair.columns[k]!, language), a = pair.da[k]!, b = pair.db[k]!;
  switch (reason) {
    case "left_unjudged": return words.refusal.left_unjudged(name, a, b, nameOf(pair.columns[state.marked]!, language));
    case "not_same": case "not_different": return words.refusal.not_judged(name, a, b);
    case "after_decided": return words.refusal.after_decided(nameOf(pair.place, language), name);
    case "already_decides": return words.refusal.already_decides(name, a, b);
    case "already_same": return words.refusal.already_same(name, a, b);
    default: return words.other;
  }
}

/**
 * What the demonstration says as it compares from `from` to `to` (sentences for a lesson's later sections, which
 * narrate what the program animates; never drawn on the card).
 */
export function placeValueCompareStepSentences(pair: PlaceValueComparePair, from: number, to: number, language: PlaceValueLanguage = "en-US"): string[] {
  const dm = wordsOf(language).demo;
  const { steps } = placeValueCompareDemoSteps(pair);
  const [x, y] = placeValueCompareNumerals(pair, language);
  const sentences: string[] = [];
  for (let k = Math.max(0, from); k < Math.min(to, steps.length); k += 1) {
    const step = steps[k]!;
    if (step.anim.kind === "sign") { sentences.push(dm.sign(x, pair.relation, y, nameOf(pair.place, language), hasAfter(pair), pair.equal)); continue; }
    const name = nameOf(step.anim.place, language);
    sentences.push(step.anim.kind === "decide" ? dm.decide(name, step.anim.a, step.anim.b) : step.anim.done ? dm.lastSame(name, step.anim.a, step.anim.b) : dm.same(name, step.anim.a, step.anim.b));
  }
  return sentences;
}

// ---------------------------------------------------------------- plan (sketch layout, at desktop size)

export interface PlaceValueCompareBox { x: number; y: number; width: number; height: number }

export interface PlaceValueCompareColumnPlan {
  place: number;
  /** The column's left edge and width; the strip runs from row 1's top to row 2's bottom. */
  x: number;
  width: number;
  /** The column name, one or two lines. */
  head: string[];
  fill: string;
  diskLabel: string;
  /** The disk label's font size (it fits the disk). */
  diskFont: number;
}

export interface PlaceValueComparePlan {
  width: number;
  height: number;
  /** A disk's diameter and the gap between disks; disks sit three to a line. */
  disk: number;
  gap: number;
  /** A cell's padding, and how many lines of disks each cell keeps room for (the most this pair needs). */
  pad: number;
  lines: number;
  columns: PlaceValueCompareColumnPlan[];
  /** The two rows' cells (y and height), and the band between them where the buttons sit. */
  rowA: { y: number; height: number };
  mid: { y: number; height: number };
  rowB: { y: number; height: number };
  /** Where the column names sit (their baseline). */
  headY: number;
  /** The numerals at the left edge: the whole part ends and the fraction part starts at `pointX`. */
  labels: { pointX: number; font: number; a: { whole: string; frac: string }; b: { whole: string; frac: string } };
  /** The decimal point's line between the ones and the tenths (absent without decimals). */
  point?: { x: number };
  /** The "Same" and "Different" buttons: their size within a column's band. */
  button: { width: number; height: number; gap: number; font: number };
  /** The sentence under the chart: "a [> = <] b", and the lock note under it. */
  sentence: PlaceValueCompareSentencePlan;
}

export interface PlaceValueCompareSentencePlan {
  width: number;
  height: number;
  font: number;
  /** The two numerals (their left edges and baseline), and the slot of three sign buttons between them. */
  a: { x: number; text: string };
  b: { x: number; text: string };
  baseline: number;
  slot: PlaceValueCompareBox;
  signs: Array<{ sign: PlaceValueCompareSign; box: PlaceValueCompareBox }>;
  lock: { x: number; y: number };
}

/** The sketch's sizes by the number of columns: a disk, the gap, a cell's padding, the gap between columns, the point's track, the numerals' font. */
const SIZES: Record<number, { d: number; g: number; cp: number; cg: number; pw: number; lab: number }> = {
  4: { d: 34, g: 5, cp: 8, cg: 8, pw: 22, lab: 24 },
  5: { d: 31, g: 5, cp: 8, cg: 8, pw: 22, lab: 24 },
  6: { d: 30, g: 4, cp: 7, cg: 8, pw: 22, lab: 22 },
  7: { d: 28, g: 3, cp: 6, cg: 6, pw: 18, lab: 21 },
};
const EDGE_X = 14;
const EDGE_TOP = 10;
const EDGE_BOTTOM = 14;
const HEAD = 42;
const MID = 92;
const LABEL_PAD = 12;
const BUTTON_H = 36;
const BUTTON_GAP = 6;
const SIGN_W = 46;
const SIGN_H = 42;
const SIGN_GAP = 6;
const SLOT_PAD = 5;
const SENTENCE_FONT = 28;
const LOCK_LINE = 26;

/** A text's width at a font size, estimated for the card's sans-serif (digits are tabular): wide enough for layout, never measured. */
export function placeValueCompareTextWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) em += /[0-9]/u.test(ch) ? 0.62 : /[,.]/u.test(ch) ? 0.3 : /\s/u.test(ch) ? 0.28 : /[　-鿿＀-￯]/u.test(ch) ? 1 : 0.6;
  return em * size;
}

/** A disk label's font size for a disk: the sketch's sizes, by the label's length. */
export function placeValueCompareDiskFont(label: string, disk: number): number {
  const scale = label.length >= 8 ? 0.17 : label.length >= 6 ? 0.22 : label.length >= 5 ? 0.29 : label.length >= 4 ? 0.31 : 0.4;
  return Math.round(disk * scale * 10) / 10;
}

/** A column name on one line, or two when it is too wide for the column ("Hundred / thousands"). */
function headLines(name: string, width: number): string[] {
  const space = name.indexOf(" ");
  return space > 0 && placeValueCompareTextWidth(name, 14) > width - 6 ? [name.slice(0, space), name.slice(space + 1)] : [name];
}

/**
 * The card's layout, from the sketch, at desktop size: the numerals at the left, one column per place, two rows of
 * disks with the buttons between them, and under the chart the sentence with its three signs. Every cell keeps room
 * for the most disks this pair has in any place, so the card never grows while it is worked.
 */
export function planPlaceValueCompare(raw: unknown): PlaceValueComparePlan {
  const language = placeValueCompareLanguage(raw);
  const state = placeValueCompareState(raw);
  const { pair } = state;
  const columns = pair.columns.length ? pair.columns : [0];
  const size = SIZES[Math.min(7, Math.max(4, columns.length))]!;
  const { d, g, cp, cg, pw } = size;
  const colw = 3 * d + 2 * g + 2 * cp;
  const most = Math.max(1, ...pair.da, ...pair.db);
  const lines = Math.ceil(most / 3);
  const cellH = lines * d + (lines - 1) * g + 2 * cp;
  const [x, y] = pair.columns.length ? placeValueCompareNumerals(pair, language) : ["", ""];
  const split = (text: string) => { const dot = text.indexOf("."); return dot < 0 ? { whole: text, frac: "" } : { whole: text.slice(0, dot), frac: text.slice(dot) }; };
  const la = split(x), lb = split(y);
  const wholeW = Math.max(placeValueCompareTextWidth(la.whole, size.lab), placeValueCompareTextWidth(lb.whole, size.lab));
  const fracW = Math.max(placeValueCompareTextWidth(la.frac, size.lab), placeValueCompareTextWidth(lb.frac, size.lab));
  const x0 = EDGE_X + wholeW + fracW + LABEL_PAD;
  const pointAt = columns.indexOf(-1);
  const plans: PlaceValueCompareColumnPlan[] = columns.map((place, k) => {
    const left = x0 + k * (colw + cg) + (pointAt > 0 && k >= pointAt ? pw + cg : 0);
    const label = placeValueDiskLabel(place, language);
    return { place, x: left, width: colw, head: headLines(nameOf(place, language), colw), fill: PLACE_VALUE_FILLS[place]!, diskLabel: label, diskFont: placeValueCompareDiskFont(label, d) };
  });
  const last = plans.at(-1)!;
  const width = last.x + last.width + EDGE_X;
  const rowA = { y: EDGE_TOP + HEAD, height: cellH };
  const mid = { y: rowA.y + cellH, height: MID };
  const rowB = { y: mid.y + MID, height: cellH };
  const height = rowB.y + cellH + EDGE_BOTTOM;
  const point = pointAt > 0 ? { x: plans[pointAt]!.x - cg - pw / 2 } : undefined;
  const button = { width: Math.min(colw - 8, 112), height: BUTTON_H, gap: BUTTON_GAP, font: columns.length >= 6 ? 14 : 15 };
  // The sentence: the numerals as written, and between them the slot of three signs.
  const font = SENTENCE_FONT;
  const aW = placeValueCompareTextWidth(x, font), bW = placeValueCompareTextWidth(y, font);
  const slotW = 3 * SIGN_W + 2 * SIGN_GAP + 2 * SLOT_PAD + 4;
  const slotH = SIGN_H + 2 * SLOT_PAD + 4;
  const sx = EDGE_X;
  const slot = { x: sx + aW + 14, y: 0, width: slotW, height: slotH };
  const signs = PLACE_VALUE_COMPARE_SIGNS.map((sign, i) => ({ sign, box: { x: slot.x + 2 + SLOT_PAD + i * (SIGN_W + SIGN_GAP), y: 2 + SLOT_PAD, width: SIGN_W, height: SIGN_H } }));
  const sentence: PlaceValueCompareSentencePlan = {
    width: Math.max(slot.x + slotW + 14 + bW + EDGE_X, sx + placeValueCompareTextWidth(wordsOf(language).lock, 14.5) + 24 + EDGE_X),
    height: slotH + LOCK_LINE + 4,
    font,
    a: { x: sx, text: x },
    b: { x: slot.x + slotW + 14, text: y },
    baseline: slotH / 2 + font * 0.36,
    slot,
    signs,
    lock: { x: sx, y: slotH + LOCK_LINE / 2 + 4 },
  };
  return {
    width, height, disk: d, gap: g, pad: cp, lines, columns: plans, rowA, mid, rowB,
    headY: EDGE_TOP + HEAD - 8,
    labels: { pointX: EDGE_X + wholeW, font: size.lab, a: la, b: lb },
    ...(point ? { point } : {}),
    button,
    sentence,
  };
}

/** Where disk `i` of a cell sits (its centre): three to a line, the lines centred in the room the cell keeps. */
export function placeValueCompareDiskAt(plan: PlaceValueComparePlan, column: PlaceValueCompareColumnPlan, row: "a" | "b", count: number, i: number): { x: number; y: number } {
  const own = Math.max(1, Math.ceil(count / 3));
  const box = row === "a" ? plan.rowA : plan.rowB;
  const grid = 3 * plan.disk + 2 * plan.gap;
  const left = column.x + (column.width - grid) / 2;
  const top = box.y + plan.pad + ((plan.lines - own) * (plan.disk + plan.gap)) / 2;
  return { x: left + (i % 3) * (plan.disk + plan.gap) + plan.disk / 2, y: top + Math.floor(i / 3) * (plan.disk + plan.gap) + plan.disk / 2 };
}

/** The tap index of a column's place (the chart's place plus three). */
export const placeValueCompareColumnTapIndex = (place: number): number => placeValueTapIndex(place);

/** The range of places the card's columns may run over. */
export const PLACE_VALUE_COMPARE_PLACES = { min: PLACE_VALUE_MIN_PLACE, max: PLACE_VALUE_MAX_PLACE } as const;
