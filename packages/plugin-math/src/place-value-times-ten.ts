/**
 * Ten of one place make one of the next (decision 0028, need 35P-04): a `place_value_times_ten` card of the math
 * plugin. The same amount counted in another unit, on the place-value chart.
 *
 * One question in two shapes:
 * - a count, "3 tenths = ? thousandths": the amount's disks move toward the target column one place at a time,
 *   breaking (one disk becomes a row of ten in the column on its right; a row of ten becomes a square of a hundred)
 *   or putting together (a row of ten becomes one disk on the left; a square of a hundred a row of ten);
 * - a times pair, "700 is ? times 70": the larger number's disks break, and each one deals its ten, one into each of
 *   ten copies of the smaller number drawn under it; once every disk is broken each copy is a whole 70.
 *
 * The amount is made of `n` lineages, one disk of the larger unit each (1 to 9). Each lineage is at a stage, how
 * many places it has moved toward the target (0 to `apart`, at most 2). The learner's state is one set of rows per
 * move (`moved_once`, and two places apart `moved_twice`), bit i for row i, so the piece tapped is the piece that
 * moves. A demonstration moves through one more number, "counted in": the unit the amount is counted in now, from
 * the unit the question names (0.1 for "3 tenths") to the target (0.001; a times pair goes 100 -> 70).
 *
 * The rules, the invariants and the demonstration are ported from the accepted sketch (35P-04 sketch, model.mjs);
 * the columns, place names, decimal point, disks and fills are the place-value chart's (decision 0025), shared,
 * not copied. Every value is an exact integer count of thousandths (0.3 is 300). Every text the card shows about
 * the numbers is computed here, never written by a model. This module imports only the chart's module, so the
 * core validator, the reducer and the web runtime can all load it (decision 0013 §3).
 */
import {
  PLACE_VALUE_CHART_LANGUAGES, PLACE_VALUE_FILLS, PLACE_VALUE_MAX_PLACE, PLACE_VALUE_MIN_PLACE, placeValueColumnName, placeValueDiskLabel,
  placeValueEnUnitWord, placeValueLanguage, placeValueNumeral, type PlaceValueLanguage,
} from "./place-value-chart.js";

export const PLACE_VALUE_TIMES_TEN_KIND = "place_value_times_ten";
export const PLACE_VALUE_TIMES_TEN_FEATURE = "plugin:math/place-value-times-ten@1";
/** The math plugin version that introduced the card. */
export const PLACE_VALUE_TIMES_TEN_PLUGIN_VERSION = "0.11.0";
/**
 * A `times` card on a pair whose digit is 1 (100 and 10; 1 and 0.1), as written or at a start (0028 revision 4). An
 * older plugin read such a pair as a count, refused the content and drew an empty chart, so it refuses the lesson.
 */
export const PLACE_VALUE_TIMES_TEN_DIGIT_ONE_TIMES_FEATURE = "plugin:math/place-value-times-ten-digit-one-times@1";
export const PLACE_VALUE_TIMES_TEN_DIGIT_ONE_TIMES_VERSION = "0.12.1";
/** The languages the card speaks: the chart's. A card without `language` speaks US English. */
export const PLACE_VALUE_TIMES_TEN_LANGUAGES = PLACE_VALUE_CHART_LANGUAGES;

export const PLACE_VALUE_TIMES_TEN_MIN_PLACE = PLACE_VALUE_MIN_PLACE; // thousandths
export const PLACE_VALUE_TIMES_TEN_MAX_PLACE = PLACE_VALUE_MAX_PLACE; // millions
/** The larger unit's count: 1 to 9 lineages. */
export const PLACE_VALUE_TIMES_TEN_MAX_LINEAGES = 9;
/** A times pair: the amount always holds ten copies of the smaller number. */
export const PLACE_VALUE_TIMES_TEN_COPIES = 10;
/** A row set holds one bit per lineage row: 0 to 511 whatever the problem, so a practice of another digit fits. */
export const PLACE_VALUE_TIMES_TEN_MAX_ROWS = 2 ** PLACE_VALUE_TIMES_TEN_MAX_LINEAGES - 1;
/** A lesson holds at most 16 variables (OLL); this card binds 3 numbers and 1 or 2 row sets, at most 5. */
export const PLACE_VALUE_TIMES_TEN_MAX_VARIABLES = 16;

export const PLACE_VALUE_TIMES_TEN_QUESTIONS = ["count", "times"] as const;
export type PlaceValueTimesTenQuestion = typeof PLACE_VALUE_TIMES_TEN_QUESTIONS[number];
export const PLACE_VALUE_TIMES_TEN_TOWARD = ["right", "left"] as const;
export type PlaceValueTimesTenToward = typeof PLACE_VALUE_TIMES_TEN_TOWARD[number];

/** The learner's row sets: a tap writes them; each is bound to its own variable, 0 to 511. */
export const PLACE_VALUE_TIMES_TEN_ROW_FIELDS = ["moved_once", "moved_twice"] as const;
export type PlaceValueTimesTenRowField = typeof PLACE_VALUE_TIMES_TEN_ROW_FIELDS[number];
/**
 * Card-level fields a lesson variable may drive, each bound by its bare name: the amount and the target (a practice
 * task's start sets them, so it starts on its own problem) and the demonstration's "counted in".
 */
export const PLACE_VALUE_TIMES_TEN_CARD_BINDINGS = ["amount", "target", "counted_in"] as const;
/** The card-level fields that make the task's own problem: a practice differs from the lesson's as a pair. */
export const PLACE_VALUE_TIMES_TEN_PROBLEM_FIELDS = ["amount", "target"] as const;
/** The demonstration's field. */
export const PLACE_VALUE_TIMES_TEN_DEMONSTRATION_FIELD = "counted_in";
/** Rows a tap names (a lineage row; a times pair's copy row): `row-1` to `row-10`. A tap's place is the index here. */
export const PLACE_VALUE_TIMES_TEN_TAP_PLACES: readonly string[] = Object.freeze(Array.from({ length: PLACE_VALUE_TIMES_TEN_COPIES }, (_, i) => `row-${i + 1}`));
/**
 * The taps a learner makes: `move` a disk, row or square (row = its lineage); on a times pair, `copy` asks about one
 * copy of the smaller number and `smaller` about the smaller number itself. `copy` and `smaller` are always
 * refused with a fact (they change nothing), so a learner's question is answered by the card's own words.
 */
export const PLACE_VALUE_TIMES_TEN_TAPS = ["move", "copy", "smaller"] as const;
export type PlaceValueTimesTenTapKind = typeof PLACE_VALUE_TIMES_TEN_TAPS[number];

const SHORT: Record<PlaceValueLanguage, "en" | "zh"> = { "en-US": "en", "zh-CN": "zh" };
const short = (language: PlaceValueLanguage | undefined): "en" | "zh" => SHORT[language ?? "en-US"] ?? "en";

/** Thousandths in one disk of a place. */
export const placeValueTimesTenUnit = (place: number): number => 10 ** (place + 3);
const unit = placeValueTimesTenUnit;

// ---------------------------------------------------------------- numbers (sketch model, ported)

/** "4,000", "0.3", "60000" -> integer thousandths; undefined when unreadable, negative, or finer than thousandths. */
export function placeValueTimesTenParse(text: string): number | undefined {
  const written = String(text ?? "").trim().replace(/,/g, "");
  const match = /^(\d{1,8})(?:\.(\d+))?$/.exec(written);
  if (!match) return undefined;
  const frac = (match[2] ?? "").replace(/0+$/u, "");
  if (frac.length > 3) return undefined;
  return Number(match[1]) * 1000 + Number(frac.padEnd(3, "0") || "0");
}

/** A value with exactly one nonzero digit -> its digit and place; otherwise undefined. */
export function placeValueTimesTenOneDigit(value: number): { digit: number; place: number } | undefined {
  if (!Number.isSafeInteger(value) || value <= 0) return undefined;
  for (let place = PLACE_VALUE_TIMES_TEN_MAX_PLACE + 3; place >= PLACE_VALUE_TIMES_TEN_MIN_PLACE; place -= 1) {
    const u = unit(place);
    if (value % u === 0) { const digit = value / u; return digit <= 9 ? { digit, place } : undefined; }
  }
  return undefined;
}
/** The place of a unit (1000 -> 3, 0.01 -> -2); undefined when the value is not a power of ten. */
export function placeValueTimesTenPlaceOfUnit(value: number): number | undefined {
  const d = placeValueTimesTenOneDigit(value);
  return d && d.digit === 1 ? d.place : undefined;
}

// ---------------------------------------------------------------- problems

/** A problem as the card holds it. Values in thousandths; places -3 to 6. */
export interface PlaceValueTimesTenProblem {
  question: PlaceValueTimesTenQuestion;
  amount: number;
  target: number;
  /** The start place (the unit the question counts in) and the target's place (a times pair: the smaller number's). */
  s: number;
  t: number;
  /** -1: toward the right (break); +1: toward the left (put together). A times pair breaks. */
  dir: -1 | 1;
  /** Places apart: 1 or 2 (a times pair, 1). */
  g: 1 | 2;
  /** Lineages: the larger unit's count, 1 to 9. */
  n: number;
  /** The start unit, in thousandths: the demonstration's first "counted in". */
  start: number;
  /** A times pair: the digit, and the amount counted in the smaller number's place (700 in tens: 70). */
  digit?: number;
  renamed?: number;
  /** The answer: a count's count in the target unit; a times pair's 10. */
  result: number;
  /** Columns, highest place first. */
  columns: number[];
}

export type PlaceValueTimesTenFault =
  | "unreadable" | "not_one_digit" | "out_of_range" | "not_a_pair" | "start_not_unit" | "same_unit" | "too_far" | "too_many" | "not_whole" | "times_start";

/**
 * A problem from the lesson's numbers: amount, target, and (optionally) start, the unit the amount is shown in at
 * first. Without start, the amount is shown in its own place (0.3 as 3 tenths). A pair written smaller first (0.3
 * and 3) is the same pair: the larger goes on top. Refused: unreadable; not_one_digit (2.5, 1,200, 5550);
 * out_of_range; not_a_pair (the target is neither a unit nor the same digit one place right); start_not_unit;
 * same_unit; too_far (more than two places; a times pair, more than one); too_many (more than 9 of the larger unit);
 * not_whole; times_start (a times pair starts in its own place). Without a shape, a pair whose digit is 1 (100 and
 * 10) is read as a count (1 hundred = 10 tens); a card that says `times` reads it as a times pair
 * (`placeValueTimesTenProblemOfShape`; 0028 revision 4).
 */
export function placeValueTimesTenProblem(amount: number, target: number, start?: number): PlaceValueTimesTenProblem | { fault: PlaceValueTimesTenFault } {
  let A = amount, T = target;
  const ok = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (!ok(A) || !ok(T) || (start !== undefined && !ok(start))) return { fault: "unreadable" };
  let S = start;
  if (T === 10 * A) {
    // A count never has a target ten times its amount, so this cannot hide a count; a start written for the
    // smaller number (its own place) moves with it.
    [A, T] = [T, A];
    const small = placeValueTimesTenOneDigit(T), large = placeValueTimesTenOneDigit(A);
    if (S !== undefined && small && large && S === unit(small.place)) S = unit(large.place);
  }
  const a = placeValueTimesTenOneDigit(A);
  if (!a) return { fault: "not_one_digit" };
  if (a.place > PLACE_VALUE_TIMES_TEN_MAX_PLACE) return { fault: "out_of_range" };
  const t = placeValueTimesTenOneDigit(T);
  if (!t || t.place > PLACE_VALUE_TIMES_TEN_MAX_PLACE) return { fault: t ? "out_of_range" : "not_a_pair" };
  if (t.digit !== 1) {
    if (t.digit !== a.digit) return { fault: "not_a_pair" };
    if (t.place !== a.place - 1) return { fault: a.place - t.place > 1 ? "too_far" : "not_a_pair" };
    if (S !== undefined && S !== unit(a.place)) return { fault: "times_start" };
    return timesPair(A, a, T, t.place);
  }
  const s = S === undefined ? a.place : placeValueTimesTenPlaceOfUnit(S);
  if (s === undefined || s > PLACE_VALUE_TIMES_TEN_MAX_PLACE || s < PLACE_VALUE_TIMES_TEN_MIN_PLACE) return { fault: "start_not_unit" };
  if (A % unit(s) !== 0) return { fault: "not_whole" };
  if (s === t.place) return { fault: "same_unit" };
  const g = Math.abs(s - t.place);
  if (g > 2) return { fault: "too_far" };
  const dir = t.place < s ? -1 : 1;
  if (A % T !== 0) return { fault: "not_whole" };
  const larger = dir < 0 ? A / unit(s) : A / T;
  if (larger > PLACE_VALUE_TIMES_TEN_MAX_LINEAGES) return { fault: "too_many" };
  return finish({ question: "count", amount: A, target: T, s, t: t.place, dir, g: g as 1 | 2, n: larger, start: unit(s), result: A / T });
}
/** A times pair, the larger first: d of one place against d of the place on its right, started in its own place. */
function timesPair(A: number, a: { digit: number; place: number }, T: number, tPlace: number): PlaceValueTimesTenProblem {
  return finish({ question: "times", amount: A, target: T, s: a.place, t: tPlace, dir: -1, g: 1, n: a.digit, start: unit(a.place), digit: a.digit, renamed: A / unit(tPlace), result: 10 });
}
function finish(p: Omit<PlaceValueTimesTenProblem, "columns">): PlaceValueTimesTenProblem {
  const lo = Math.min(p.s, p.t), hi = Math.max(p.s, p.t);
  const columns: number[] = [];
  for (let place = hi; place >= lo; place -= 1) columns.push(place);
  return { ...p, columns };
}
const isFault = <F extends string>(p: PlaceValueTimesTenProblem | { fault: F }): p is { fault: F } => "fault" in p;

/** A card's fixed shape: the question, and for a count the direction and how many places apart. */
export interface PlaceValueTimesTenShape { question: PlaceValueTimesTenQuestion; toward: PlaceValueTimesTenToward; apart: 1 | 2 }
export const placeValueTimesTenShapeOf = (p: PlaceValueTimesTenProblem): PlaceValueTimesTenShape => ({ question: p.question, toward: p.dir < 0 ? "right" : "left", apart: p.g });

/**
 * The start unit a problem of this shape has for these numbers (thousandths): a times pair starts in the larger
 * number's own place; a count starts `apart` places from its target, on the side away from `toward`. This is what
 * the program supplies as "counted in" at a lesson's start and at each practice's start (Coach never asks the
 * model for it, except as a put-together question's own unit). Undefined when the numbers give no place.
 */
export function placeValueTimesTenStartUnit(shape: PlaceValueTimesTenShape, amount: number, target: number): number | undefined {
  if (shape.question === "times") {
    const large = placeValueTimesTenOneDigit(Math.max(amount, target));
    return large ? unit(large.place) : undefined;
  }
  const t = placeValueTimesTenPlaceOfUnit(target);
  if (t === undefined) return undefined;
  const s = shape.toward === "right" ? t + shape.apart : t - shape.apart;
  return s >= PLACE_VALUE_TIMES_TEN_MIN_PLACE && s <= PLACE_VALUE_TIMES_TEN_MAX_PLACE ? unit(s) : undefined;
}

/**
 * The problem a shape and its numbers make, or the fault (the shape's start, then the sketch's rules, then the shape).
 * The shape says the question: a pair whose digit is 1, one place apart (100 and 10; 1 and 0.1), is a count on a
 * `count` card (1 hundred = 10 tens) and a times pair on a `times` card (100 is 10 times 10), as any other digit is
 * (0028 revision 4). Every other pair reads as without a shape.
 */
export function placeValueTimesTenProblemOfShape(shape: PlaceValueTimesTenShape, amount: number, target: number): PlaceValueTimesTenProblem | { fault: PlaceValueTimesTenFault | "not_same_shape" } {
  const start = placeValueTimesTenStartUnit(shape, amount, target);
  if (start === undefined) {
    // Numbers that make a problem of another shape (a times pair's on a count card) say so, not the start they lack.
    const other = placeValueTimesTenProblem(amount, target);
    if (!isFault(other)) return { fault: "not_same_shape" };
    return { fault: shape.question === "times" ? other.fault : "start_not_unit" };
  }
  const found = placeValueTimesTenProblem(amount, target, shape.question === "times" ? undefined : start);
  if (isFault(found)) return found;
  const p = shape.question === "times" ? digitOneTimesPair(found) ?? found : found;
  const own = placeValueTimesTenShapeOf(p);
  if (own.question !== shape.question || own.toward !== shape.toward || own.apart !== shape.apart) return { fault: "not_same_shape" };
  return p;
}

/** Two numbers whose digit is 1, one place apart, either way round (100 and 10; 0.1 and 1): in thousandths. */
export function placeValueTimesTenDigitOnePair(amount: number, target: number): boolean {
  const large = placeValueTimesTenOneDigit(Math.max(amount, target)), small = placeValueTimesTenOneDigit(Math.min(amount, target));
  return !!large && !!small && large.digit === 1 && small.digit === 1 && small.place === large.place - 1 && large.place <= PLACE_VALUE_TIMES_TEN_MAX_PLACE;
}

/**
 * Whether a card asks a times pair whose digit is 1 (0028 revision 4; `PLACE_VALUE_TIMES_TEN_DIGIT_ONE_TIMES_FEATURE`):
 * its content says `times` and its numbers are such a pair as written, or at any of the lesson's start piles (a
 * variable's initial values, a practice's or a replay's start), each field bound by its bare name read from the
 * pile's value for its variable.
 */
export function placeValueTimesTenUsesDigitOneTimes(raw: unknown, piles: ReadonlyArray<Readonly<Record<string, number>>> = []): boolean {
  const content = (raw ?? {}) as Record<string, unknown>;
  if (content.question !== "times") return false;
  const bound = new Map(((Array.isArray(content.bindings) ? content.bindings : []) as Array<{ target?: unknown; expression?: unknown }>)
    .filter((binding) => typeof binding.target === "string" && typeof binding.expression === "string")
    .map((binding) => [binding.target as string, (binding.expression as string).trim()]));
  const at = (pile: Readonly<Record<string, number>> | undefined, field: "amount" | "target"): unknown => {
    const alias = bound.get(field);
    return pile && alias !== undefined && typeof pile[alias] === "number" ? pile[alias] : content[field];
  };
  return [undefined, ...piles].some((pile) => {
    const amount = at(pile, "amount"), target = at(pile, "target");
    return typeof amount === "number" && typeof target === "number" && placeValueTimesTenDigitOnePair(amount, target);
  });
}

/** A count of digit 1 one place to the right (1 hundred = 10 tens) as its times pair (100 is 10 times 10), else undefined. */
function digitOneTimesPair(p: PlaceValueTimesTenProblem): PlaceValueTimesTenProblem | undefined {
  if (p.question !== "count") return undefined;
  const a = placeValueTimesTenOneDigit(p.amount), t = placeValueTimesTenOneDigit(p.target);
  if (!a || !t || a.digit !== 1 || t.digit !== 1 || t.place !== a.place - 1) return undefined;
  return timesPair(p.amount, a, p.target, t.place);
}

/**
 * A practice of the example's shape (the same question, direction and places apart: its start unit is the
 * program's), on its own numbers: the problem, or why not (also `same_as_example`, the example's own pair).
 */
export function placeValueTimesTenPracticeProblem(example: PlaceValueTimesTenProblem, amount: number, target: number): PlaceValueTimesTenProblem | { fault: PlaceValueTimesTenFault | "not_same_shape" | "same_as_example" } {
  const p = placeValueTimesTenProblemOfShape(placeValueTimesTenShapeOf(example), amount, target);
  if (isFault(p)) return p;
  if (p.amount === example.amount && p.target === example.target) return { fault: "same_as_example" };
  return p;
}

// ---------------------------------------------------------------- the card's state

export interface PlaceValueTimesTenState {
  problem: PlaceValueTimesTenProblem;
  /** Each lineage's stage (0 to g). */
  stages: number[];
  /** The row sets as the content holds them (stray bits included), so a tap's changes are against what is written. */
  rows?: Record<PlaceValueTimesTenRowField, number>;
  /**
   * Above 0, the chart is the demonstration's (a position along the "counted in" path, possibly between two of its
   * values while a variable eases) and the learner's taps are refused. Absent or 0 for the learner's own chart.
   */
  demo?: number;
}

export const placeValueTimesTenStart = (problem: PlaceValueTimesTenProblem): PlaceValueTimesTenState => ({ problem, stages: Array(problem.n).fill(0) });
const withStage = (s: PlaceValueTimesTenState, i: number, k: number): PlaceValueTimesTenState => ({ problem: s.problem, stages: s.stages.map((v, j) => (j === i ? k : v)), ...(s.rows ? { rows: s.rows } : {}) });

/** Where a lineage at stage k sits (its place), and the size of its thing (1 disk, a row of 10, a square of 100). */
export const placeValueTimesTenPlaceAt = (p: PlaceValueTimesTenProblem, k: number): number => p.s + p.dir * k;
export const placeValueTimesTenSizeAt = (p: PlaceValueTimesTenProblem, k: number): number => (p.dir < 0 ? 10 ** k : 10 ** (p.g - k));
const placeAt = placeValueTimesTenPlaceAt;
const sizeAt = placeValueTimesTenSizeAt;

/** What one column holds: the lineages there, each with the size of its thing. */
export function placeValueTimesTenColumn(state: PlaceValueTimesTenState, place: number): Array<{ i: number; size: number; stage: number }> {
  const out: Array<{ i: number; size: number; stage: number }> = [];
  state.stages.forEach((k, i) => { if (placeAt(state.problem, k) === place) out.push({ i, size: sizeAt(state.problem, k), stage: k }); });
  return out;
}
/** The value of everything on the chart (the amount's disks), in thousandths. */
export function placeValueTimesTenChartValue(state: PlaceValueTimesTenState): number {
  return state.stages.reduce((sum, k) => sum + sizeAt(state.problem, k) * unit(placeAt(state.problem, k)), 0);
}
/** Times: how many disks of the smaller place each copy holds now (one per broken lineage). */
export const placeValueTimesTenBrokenCount = (state: PlaceValueTimesTenState): number => state.stages.filter((k) => k >= 1).length;
/** Times: the ten copies, each with a slot per lineage (filled once that lineage is broken). */
export function placeValueTimesTenCopies(state: PlaceValueTimesTenState): Array<{ slots: boolean[]; full: boolean; have: number }> {
  if (state.problem.question !== "times") return [];
  const slots = state.stages.map((k) => k >= 1);
  return Array.from({ length: PLACE_VALUE_TIMES_TEN_COPIES }, () => ({ slots: [...slots], full: slots.every(Boolean), have: slots.filter(Boolean).length }));
}

export type PlaceValueTimesTenRefusal = "no_thing" | "at_target" | "demonstrating" | "copy_short" | "copy_full" | "smaller" | "not_times" | "no_tap";

export type PlaceValueTimesTenAnim = { kind: "break" | "bundle"; i: number; from: number; to: number; size: number; becomes: number };

export type PlaceValueTimesTenResult =
  | { ok: true; state: PlaceValueTimesTenState; anim: PlaceValueTimesTenAnim }
  | { ok: false; reason: PlaceValueTimesTenRefusal; have?: number; need?: number; place?: number };

const refuse = (reason: PlaceValueTimesTenRefusal, extra: { have?: number; need?: number; place?: number } = {}): PlaceValueTimesTenResult => ({ ok: false, reason, ...extra });

/** Lineage i's thing moves one place toward the target (one disk breaks into ten; ten go together into one). */
export function placeValueTimesTenMove(state: PlaceValueTimesTenState, i: number): PlaceValueTimesTenResult {
  const p = state.problem;
  if (!Number.isInteger(i) || i < 0 || i >= p.n) return refuse("no_thing");
  const k = state.stages[i]!;
  if (k >= p.g) return refuse("at_target", { place: placeAt(p, k) });
  return { ok: true, state: withStage(state, i, k + 1), anim: { kind: p.dir < 0 ? "break" : "bundle", i, from: placeAt(p, k), to: placeAt(p, k + 1), size: sizeAt(p, k), becomes: sizeAt(p, k + 1) } };
}

/** One learner tap on the card: a kind, at a row (0-based; a lineage's row, or a times pair's copy row). */
export interface PlaceValueTimesTenTap { tap: PlaceValueTimesTenTapKind; row: number }

/**
 * The tap rules. `move` moves lineage `row`'s thing. `copy` and `smaller` (a times pair) never change the card:
 * they are refused with the fact they ask about (a copy's count; the smaller number). A chart showing a
 * demonstration takes no taps: it is the program's.
 */
export function applyPlaceValueTimesTenTap(state: PlaceValueTimesTenState, tap: PlaceValueTimesTenTap): PlaceValueTimesTenResult {
  if ((state.demo ?? 0) > 0) return refuse("demonstrating");
  const p = state.problem;
  if (tap.tap === "move") return placeValueTimesTenMove(state, tap.row);
  if (tap.tap === "copy" || tap.tap === "smaller") {
    if (p.question !== "times") return refuse("not_times");
    if (tap.tap === "smaller") return refuse("smaller", { need: p.digit! });
    if (!Number.isInteger(tap.row) || tap.row < 0 || tap.row >= PLACE_VALUE_TIMES_TEN_COPIES) return refuse("no_thing");
    const have = placeValueTimesTenBrokenCount(state);
    return refuse(have < p.n ? "copy_short" : "copy_full", { have, need: p.digit! });
  }
  return refuse("no_tap");
}

/**
 * Every lineage at the target: a count's chart holds the amount in the target unit; a times pair's copies are whole.
 * A card with no problem (numbers the card refuses draw an empty chart) is never complete.
 */
export const placeValueTimesTenComplete = (state: PlaceValueTimesTenState): boolean => state.problem.n > 0 && state.stages.every((k) => k === state.problem.g);

/** Every action the card allows from this state (the view's `move` taps reach exactly these). */
export function placeValueTimesTenMoves(state: PlaceValueTimesTenState): Array<Extract<PlaceValueTimesTenResult, { ok: true }>> {
  const out: Array<Extract<PlaceValueTimesTenResult, { ok: true }>> = [];
  for (let i = 0; i < state.problem.n; i += 1) { const r = placeValueTimesTenMove(state, i); if (r.ok) out.push(r); }
  return out;
}
export const placeValueTimesTenStateKey = (state: PlaceValueTimesTenState): string => state.stages.join("");
/** Every state reachable from the start, by any taps in any order (at most 3^9). */
export function placeValueTimesTenReachable(problem: PlaceValueTimesTenProblem): PlaceValueTimesTenState[] {
  const seen = new Map<string, PlaceValueTimesTenState>(), queue = [placeValueTimesTenStart(problem)];
  while (queue.length) {
    const s = queue.pop()!, key = placeValueTimesTenStateKey(s);
    if (seen.has(key)) continue;
    seen.set(key, s);
    for (const r of placeValueTimesTenMoves(s)) queue.push(r.state);
  }
  return [...seen.values()];
}
/** Can the learner still reach a finished chart from here? (Searched, not assumed; the tests show it is always yes.) */
export function placeValueTimesTenCanStillFinish(state: PlaceValueTimesTenState, memo = new Map<string, boolean>()): boolean {
  if (placeValueTimesTenComplete(state)) return true;
  const key = placeValueTimesTenStateKey(state);
  if (memo.has(key)) return memo.get(key)!;
  memo.set(key, false);
  const ok = placeValueTimesTenMoves(state).some((r) => placeValueTimesTenCanStillFinish(r.state, memo));
  memo.set(key, ok);
  return ok;
}

// ---------------------------------------------------------------- the demonstration: "counted in"

/**
 * "Counted in": the unit the amount is counted in now, in thousandths. It starts at the start unit and moves toward
 * the target: 0.1 -> 0.01 -> 0.001 (100 -> 10 -> 1), or for a times pair 100 -> 70 (700 counted in hundreds, then
 * in 70s, every hundred broken and dealt). The last value is always the target.
 */
export function placeValueTimesTenPath(problem: PlaceValueTimesTenProblem): number[] {
  const path = [problem.start];
  if (problem.question === "times") path.push(problem.target);
  else for (let k = 1; k <= problem.g; k += 1) path.push(unit(placeAt(problem, k)));
  return path;
}
/**
 * Where a "counted in" value lies along the path: 0 at the start, the path's index at each of its values, and in
 * between (a variable easing from one value to the next) linearly between them. Values before the start or past
 * the target are taken to the ends. Total and monotone, so an animation passes every stage in order.
 */
export function placeValueTimesTenPosition(problem: PlaceValueTimesTenProblem, countedIn: number): number {
  const path = placeValueTimesTenPath(problem);
  if (!Number.isFinite(countedIn)) return 0;
  for (let k = 0; k < path.length - 1; k += 1) {
    const a = path[k]!, b = path[k + 1]!;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (countedIn >= lo && countedIn <= hi) return k + (countedIn - a) / (b - a);
  }
  // Outside the path: before its start, or past its end (the path runs one way, down or up).
  const down = path.at(-1)! < path[0]!;
  return (down ? countedIn > path[0]! : countedIn < path[0]!) ? 0 : path.length - 1;
}
/** The demonstration's chart at a position along the path: whole steps for every lineage, the part step one row at a time. */
export function placeValueTimesTenDemoState(problem: PlaceValueTimesTenProblem, position: number): PlaceValueTimesTenState {
  const steps = placeValueTimesTenPath(problem).length - 1;
  const at = Math.min(steps, Math.max(0, Number.isFinite(position) ? position : 0));
  const whole = Math.floor(at + 1e-9), part = at - whole;
  const moved = Math.floor(part * problem.n + 1e-9);
  return { problem, stages: Array.from({ length: problem.n }, (_, i) => Math.min(problem.g, whole + (i < moved ? 1 : 0))), demo: at };
}
/**
 * The values of "counted in" the player sets from `from` to `to`, one per row's move, in order (owner, 2026-11-27:
 * a demonstration plays one action at a time). Between two values of the path a value moves the rows one at a
 * time (`placeValueTimesTenDemoState`), so the r-th row of n is at r/n of the way; the last is `to`'s path value.
 * Empty when `to` is not past `from` along the path.
 */
export function placeValueTimesTenDemoValues(problem: PlaceValueTimesTenProblem, from: number, to: number): number[] {
  const path = placeValueTimesTenPath(problem);
  const n = Math.max(1, problem.n);
  const index = (value: number) => Math.floor(placeValueTimesTenPosition(problem, value) * n + 1e-6);
  const values: number[] = [];
  for (let t = index(from) + 1; t <= index(to); t += 1) {
    const k = Math.floor(t / n), r = t - k * n;
    values.push(r === 0 ? path[k]! : path[k]! + (path[k + 1]! - path[k]!) * r / n);
  }
  return values;
}
/** One step per later "counted in" value: each lineage moved once, top row first. */
export function placeValueTimesTenDemoSteps(problem: PlaceValueTimesTenProblem): { steps: Array<{ countedIn: number; actions: Array<{ kind: "break" | "bundle"; i: number; stage: number }>; after: PlaceValueTimesTenState }>; final: PlaceValueTimesTenState } {
  let state = placeValueTimesTenStart(problem);
  const path = placeValueTimesTenPath(problem);
  const steps: Array<{ countedIn: number; actions: Array<{ kind: "break" | "bundle"; i: number; stage: number }>; after: PlaceValueTimesTenState }> = [];
  for (let k = 0; k < problem.g; k += 1) {
    const actions: Array<{ kind: "break" | "bundle"; i: number; stage: number }> = [];
    for (let i = 0; i < problem.n; i += 1) {
      actions.push({ kind: problem.dir < 0 ? "break" : "bundle", i, stage: k });
      const r = placeValueTimesTenMove(state, i);
      if (!r.ok) throw new Error(`demo step refused: ${r.reason}`);
      state = r.state;
    }
    steps.push({ countedIn: path[k + 1]!, actions, after: state });
  }
  return { steps, final: state };
}

/** "0.1 (tenths)", 「0.1（十分之一）」; a times pair's target "70". */
function countedInText(problem: PlaceValueTimesTenProblem, value: number, language: PlaceValueLanguage = "en-US"): string {
  const place = placeValueTimesTenPlaceOfUnit(value);
  if (place === undefined) return placeValueNumeral(value, language);
  return short(language) === "en" ? `${placeValueNumeral(value)} (${placeValueEnUnitWord(place, true)})` : `${placeValueNumeral(value, language)}（${ZH_UNIT[place]}）`;
}

/** What "counted in" is on this problem, for a refusal: "is the unit the amount is counted in now, in thousandths: 100 = 0.1 (tenths) -> …". */
export function placeValueTimesTenCountedInMeaning(problem: PlaceValueTimesTenProblem): string {
  return `is the unit the amount is counted in now, in thousandths: ${placeValueTimesTenPath(problem).map((value) => `${value} = ${countedInText(problem, value)}`).join(" -> ")}`;
}
/** The values "counted in" may take next from `from` ("from 100 the next values are 10 or 1"). */
function countedInNext(problem: PlaceValueTimesTenProblem, from: number): string {
  const path = placeValueTimesTenPath(problem);
  const at = placeValueTimesTenPosition(problem, from);
  const next = path.filter((value, k) => k >= Math.ceil(at - 1e-9) && value !== from);
  return next.length ? `from ${from} the next values are ${next.join(" or ")}` : `from ${from} it has reached the target, ${problem.target}`;
}

/**
 * Why the lesson cannot move "counted in" from `from` to `to`, or undefined when it can: `to` must be a value of
 * the path at or after `from`'s position (the same value again leaves the chart as it is). The sentence follows the
 * variable's name ("'counted_in' is the unit …") and names the next valid values, in thousandths and as written.
 */
export function placeValueTimesTenCountedInFault(problem: PlaceValueTimesTenProblem, from: number, to: number): string | undefined {
  const path = placeValueTimesTenPath(problem);
  const index = path.indexOf(to);
  if (index >= 0 && index + 1e-9 >= placeValueTimesTenPosition(problem, from)) return undefined;
  const why = index < 0 ? `${to} is not one of its values` : `it goes forward, not back to ${to}`;
  return `${placeValueTimesTenCountedInMeaning(problem)}; ${why}; ${countedInNext(problem, from)}`;
}
/** Why a replay cannot set "counted in" to `value` (it may go back, to any value of the path), or undefined. */
export function placeValueTimesTenCountedInReplayFault(problem: PlaceValueTimesTenProblem, value: number): string | undefined {
  return placeValueTimesTenPath(problem).includes(value) ? undefined : `${placeValueTimesTenCountedInMeaning(problem)}; a replay sets one of these, not ${value}`;
}

// ---------------------------------------------------------------- content

export interface PlaceValueTimesTenContent {
  /** The language of the card's own words; absent means US English. */
  language?: PlaceValueLanguage;
  /** The card's fixed shape: the question, its direction and how many places apart (a times pair: right, 1). */
  question: PlaceValueTimesTenQuestion;
  toward: PlaceValueTimesTenToward;
  apart: 1 | 2;
  /** The amount and the target, in integer thousandths (0.3 is 300; 700 is 700000). */
  amount: number;
  target: number;
  /** The demonstration: the unit the amount is counted in now (thousandths), from the start unit to the target. */
  counted_in: number;
  /** The learner's rows moved once (bit i = row i), and two places apart, moved twice: 0 to 511. */
  moved_once: number;
  moved_twice?: number;
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
const MAX_VALUE = 9 * unit(PLACE_VALUE_TIMES_TEN_MAX_PLACE);

/** What a fault says, for the compiler's refusal. */
export function placeValueTimesTenFaultText(fault: PlaceValueTimesTenFault | "not_same_shape", amount: unknown, target: unknown): string {
  const ok = typeof amount === "number" && typeof target === "number" && Number.isSafeInteger(amount) && Number.isSafeInteger(target) && amount >= 0 && target >= 0;
  const pair = ok ? `${placeValueNumeral(amount as number)} and ${placeValueNumeral(target as number)}` : "These numbers";
  switch (fault) {
    case "not_one_digit": return `${pair}: the amount is one digit in one place (500 for the 5 in 5,550; 0.3 for 3 tenths), never a whole numeral (not_one_digit)`;
    case "out_of_range": return `${pair}: the card's places run from the millions to the thousandths (out_of_range)`;
    case "not_a_pair": return `${pair}: the target is a unit (0.001, 10, 100) or the same digit one place right (700 and 70) (not_a_pair)`;
    case "start_not_unit": return `${pair}: the unit the amount starts in is a place's unit (0.01, 10) (start_not_unit)`;
    case "same_unit": return `${pair}: the amount starts in the target's own unit; a put-together question starts in the smaller unit it names (40 hundredths: 0.01) (same_unit)`;
    case "too_far": return `${pair}: the two units are at most two places apart, and a times pair's are neighbours (too_far)`;
    case "too_many": return `${pair}: the larger unit holds 1 to 9 (300 tens are 30 hundreds) (too_many)`;
    case "not_whole": return `${pair}: the amount is a whole number of both units (4 hundredths is not a whole number of tenths) (not_whole)`;
    case "times_start": return `${pair}: a times pair starts in the larger number's own place (times_start)`;
    case "not_same_shape": return `${pair}: the card's question, direction and places apart are fixed; this pair is of another shape (not_same_shape)`;
    default: return "The numbers are whole numbers of thousandths from 0 to the millions (unreadable)";
  }
}

const shapeOfContent = (content: Record<string, unknown>): PlaceValueTimesTenShape => ({
  question: content.question === "times" ? "times" : "count",
  toward: content.question === "times" ? "right" : content.toward === "left" ? "left" : "right",
  apart: content.question === "times" ? 1 : content.apart === 2 ? 2 : 1,
});

/** The problem a content's own fields make (its shape and its two numbers), or its fault. */
export function placeValueTimesTenContentProblem(raw: unknown): PlaceValueTimesTenProblem | { fault: PlaceValueTimesTenFault | "not_same_shape" } {
  const content = (raw ?? {}) as Record<string, unknown>;
  const amount = content.amount, target = content.target;
  if (typeof amount !== "number" || typeof target !== "number") return { fault: "unreadable" };
  return placeValueTimesTenProblemOfShape(shapeOfContent(content), amount, target);
}

/**
 * Checks a card's content. With `boundValues` (the core checking the card at a value a variable can take) only each
 * field's own range is checked: the joint rules (the problem, its shape, a row set the problem has, "counted in" on
 * the path, a demonstration on a fresh chart) belong to a starting card.
 */
export function validatePlaceValueTimesTenContent(raw: unknown, path: string, fail: Fail, options: { boundValues?: boolean } = {}): void {
  const content = record(raw, path, fail);
  for (const key of Object.keys(content)) {
    if (!["language", "question", "toward", "apart", "amount", "target", "counted_in", "moved_once", "moved_twice", "bindings"].includes(key)) fail(`${path}/${key}`, `Unknown place-value times-ten field '${key}'`);
  }
  if (content.language !== undefined && !PLACE_VALUE_TIMES_TEN_LANGUAGES.includes(content.language as PlaceValueLanguage)) {
    fail(`${path}/language`, `The card speaks ${PLACE_VALUE_TIMES_TEN_LANGUAGES.join(" or ")}`);
  }
  if (!PLACE_VALUE_TIMES_TEN_QUESTIONS.includes(content.question as PlaceValueTimesTenQuestion)) fail(`${path}/question`, "The question is 'count' or 'times'");
  if (!PLACE_VALUE_TIMES_TEN_TOWARD.includes(content.toward as PlaceValueTimesTenToward)) fail(`${path}/toward`, "The card moves toward the 'right' (breaking) or the 'left' (putting together)");
  if (content.apart !== 1 && content.apart !== 2) fail(`${path}/apart`, "The two units are 1 or 2 places apart");
  if (content.question === "times" && (content.toward !== "right" || content.apart !== 1)) fail(`${path}/apart`, "A times pair breaks toward the right, one place apart");
  // A variable may pass 0 (its range is the lesson's); a starting card's numbers are at least one thousandth.
  const low = options.boundValues ? 0 : 1;
  const amount = wholeNumber(content.amount, `${path}/amount`, low, MAX_VALUE, fail, "The amount (in thousandths)");
  const target = wholeNumber(content.target, `${path}/target`, low, MAX_VALUE, fail, "The target (in thousandths)");
  const countedIn = wholeNumber(content.counted_in, `${path}/counted_in`, low, MAX_VALUE, fail, "Counted in (in thousandths)");
  const once = wholeNumber(content.moved_once, `${path}/moved_once`, 0, PLACE_VALUE_TIMES_TEN_MAX_ROWS, fail, "The rows moved once");
  if (content.apart === 2) {
    if (content.moved_twice === undefined) fail(`${path}/moved_twice`, "Two places apart, the card has the rows moved twice");
  } else if (content.moved_twice !== undefined) fail(`${path}/moved_twice`, "One place apart, nothing moves twice");
  const twice = content.moved_twice === undefined ? 0 : wholeNumber(content.moved_twice, `${path}/moved_twice`, 0, PLACE_VALUE_TIMES_TEN_MAX_ROWS, fail, "The rows moved twice");
  if (options.boundValues) return;
  const problem = placeValueTimesTenContentProblem(content);
  if (isFault(problem)) fail(`${path}/${problem.fault === "not_same_shape" || problem.fault === "start_not_unit" ? "target" : "amount"}`, placeValueTimesTenFaultText(problem.fault, amount, target));
  const p = problem as PlaceValueTimesTenProblem;
  if (p.amount !== amount) fail(`${path}/amount`, `A times pair is written larger first: amount ${p.amount}, target ${p.target}`);
  const rows = 2 ** p.n - 1;
  if ((once & ~rows) !== 0) fail(`${path}/moved_once`, `${placeValueNumeral(amount)} has ${p.n} rows: no bit past row ${p.n} (at most ${rows})`);
  if ((twice & ~once) !== 0) fail(`${path}/moved_twice`, "A row moves twice only after it has moved once");
  const pathValues = placeValueTimesTenPath(p);
  if (!pathValues.includes(countedIn)) {
    fail(`${path}/counted_in`, `'counted_in' ${placeValueTimesTenCountedInFault(p, p.start, countedIn) ?? `is one of ${pathValues.join(", ")}`}`);
  }
  if (countedIn !== p.start && (once !== 0 || twice !== 0)) {
    fail(`${path}/counted_in`, "A demonstration (counted in past its start) plays on a fresh chart: no row moved");
  }
}

/** The card's language from its content: Chinese when it says so, else US English. */
export const placeValueTimesTenLanguage = (raw: unknown): PlaceValueLanguage => placeValueLanguage(raw);

const FALLBACK: PlaceValueTimesTenProblem = finish({ question: "count", amount: 0, target: 1, s: -2, t: -3, dir: -1, g: 1, n: 0, start: 10, result: 0 });

/**
 * The card a content describes, as the rules hold it (what it draws and taps act on). Total: any content gives a
 * state. A problem the card refuses draws an empty chart. Row sets are read for the problem's rows only (a bit past
 * them is ignored; a row moved twice but not once has not moved). "Counted in" past its start shows the
 * demonstration's chart at that position (the row sets are then ignored).
 */
export function placeValueTimesTenState(raw: unknown): PlaceValueTimesTenState & { demo: number } {
  const content = (raw ?? {}) as Partial<PlaceValueTimesTenContent>;
  const found = placeValueTimesTenContentProblem(content);
  const problem = isFault(found) ? FALLBACK : found;
  const countedIn = Number(content.counted_in);
  const position = Number.isFinite(countedIn) ? placeValueTimesTenPosition(problem, countedIn) : 0;
  if (position > 0) return { ...placeValueTimesTenDemoState(problem, position), demo: position };
  const bits = (value: unknown, i: number) => (typeof value === "number" && Number.isFinite(value) ? Math.floor(Math.max(0, value) / 2 ** i) % 2 : 0);
  const stages = Array.from({ length: problem.n }, (_, i) => {
    const once = bits(content.moved_once, i);
    return Math.min(problem.g, once + (once && problem.g === 2 ? bits(content.moved_twice, i) : 0));
  });
  const written = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return { problem, stages, demo: 0, rows: { moved_once: written(content.moved_once), moved_twice: written(content.moved_twice) } };
}

/** The row-set fields a problem's shape binds: one place apart, `moved_once`; two, also `moved_twice`. */
export const placeValueTimesTenRowFields = (apart: 1 | 2): PlaceValueTimesTenRowField[] => (apart === 2 ? ["moved_once", "moved_twice"] : ["moved_once"]);

/** A state's row sets, as content values. */
export function placeValueTimesTenRowSets(state: PlaceValueTimesTenState): Record<PlaceValueTimesTenRowField, number> {
  const mask = (bits: boolean[]) => bits.reduce((sum, on, i) => sum + (on ? 2 ** i : 0), 0);
  return { moved_once: mask(state.stages.map((k) => k >= 1)), moved_twice: mask(state.stages.map((k) => k >= 2)) };
}
/**
 * The fields one tap changes, as content values: each row set that differs from what the content holds. The new
 * values are the state's own, so a stray bit (a row "moved twice" but not once) is cleared, never left to make a
 * row jump two places.
 */
export function placeValueTimesTenChanges(before: PlaceValueTimesTenState, after: PlaceValueTimesTenState): Array<{ field: PlaceValueTimesTenRowField; before: number; after: number }> {
  const a = before.rows ?? placeValueTimesTenRowSets(before), b = placeValueTimesTenRowSets(after);
  return placeValueTimesTenRowFields(after.problem.g).filter((field) => a[field] !== b[field]).map((field) => ({ field, before: a[field], after: b[field] }));
}

/**
 * Why a card cannot start a learner's task (a practice start), or undefined: the chart starts fresh, "counted in"
 * at the task's own start unit (not 0, not the demonstration's) and no row moved.
 */
export function placeValueTimesTenStartFault(raw: unknown): string | undefined {
  const content = (raw ?? {}) as Partial<PlaceValueTimesTenContent>;
  const problem = placeValueTimesTenContentProblem(content);
  if (isFault(problem)) return placeValueTimesTenFaultText(problem.fault, content.amount, content.target);
  if (content.counted_in !== problem.start) {
    return `A practice chart starts fresh: 'counted_in' is its own start unit, ${problem.start} (${countedInText(problem, problem.start)}), not ${content.counted_in}`;
  }
  if (content.moved_once || content.moved_twice) return "A practice chart starts fresh: no row moved (moved_once and moved_twice are 0)";
  return undefined;
}

/** The same, for a state (the core checks a practice pile as the card's state): its demonstration or a moved row. */
export function placeValueTimesTenStateStartFault(state: PlaceValueTimesTenState): string | undefined {
  const p = state.problem;
  if ((state.demo ?? 0) > 0) return `A practice chart starts fresh: 'counted_in' is its own start unit, ${p.start} (${countedInText(p, p.start)}), not a value the demonstration reaches`;
  if (state.stages.some((k) => k > 0)) return "A practice chart starts fresh: no row moved (moved_once and moved_twice are 0)";
  return undefined;
}

/** The lesson's variables: three numbers (amount, target, counted in) and one or two row sets, at most 5. */
export const placeValueTimesTenVariableCount = (problem: PlaceValueTimesTenProblem): number => 3 + placeValueTimesTenRowFields(problem.g).length;

/** Facts for a task, and for the lesson's later sections. */
export interface PlaceValueTimesTenFacts {
  /** The value of the amount's disks, in thousandths (always the amount). */
  value: number;
  /** "Counted in" the chart shows: the start unit, the target when finished, a unit in between on the way. */
  counted_in: number;
  /** Every row at the target: a count's chart holds the amount in the target unit; a times pair's copies are whole. */
  complete: boolean;
  /** The values "counted in" may take next (empty once finished). */
  next: number[];
  /** Each column's things, highest place first: disks, rows of ten, squares of a hundred. */
  columns: Array<{ place: number; disks: number; rows: number; squares: number }>;
  /** Times: how many of the smaller place each copy holds. */
  copies?: number;
}

export function placeValueTimesTenFacts(state: PlaceValueTimesTenState): PlaceValueTimesTenFacts {
  const p = state.problem, path = placeValueTimesTenPath(p);
  const reached = Math.min(...state.stages, p.g);
  const shown = p.question === "times" ? (placeValueTimesTenComplete(state) ? p.target : p.start) : path[reached]!;
  const index = path.indexOf(shown);
  return {
    value: placeValueTimesTenChartValue(state),
    counted_in: shown,
    complete: placeValueTimesTenComplete(state),
    next: path.slice(index + 1),
    columns: p.columns.map((place) => {
      const things = placeValueTimesTenColumn(state, place);
      const count = (size: number) => things.filter((thing) => thing.size === size).length;
      return { place, disks: count(1), rows: count(10), squares: count(100) };
    }),
    ...(p.question === "times" ? { copies: placeValueTimesTenBrokenCount(state) } : {}),
  };
}

// ---------------------------------------------------------------- words (sketch page.js, ported)

/** zh counting units: 「3个十分之一」. */
const ZH_UNIT: Record<number, string> = { 6: "百万", 5: "十万", 4: "万", 3: "千", 2: "百", 1: "十", 0: "一", [-1]: "十分之一", [-2]: "百分之一", [-3]: "千分之一" };
/** "3 tenths", "1 thousand" / 「3个十分之一」. */
export function placeValueTimesTenCountOf(n: number, place: number, language: PlaceValueLanguage = "en-US"): string {
  return short(language) === "zh" ? `${n}个${ZH_UNIT[place]}` : `${n.toLocaleString("en-US")} ${placeValueEnUnitWord(place, n !== 1)}`;
}
/** A unit as a word: "tenths" (en, plural unless one), 「十分之一」 (zh). */
export function placeValueTimesTenUnitWord(place: number, language: PlaceValueLanguage = "en-US", plural = true): string {
  return short(language) === "zh" ? ZH_UNIT[place]! : placeValueEnUnitWord(place, plural);
}
const one = (place: number) => placeValueEnUnitWord(place, false);
const an = (place: number) => `${/^[aeiou]/u.test(one(place)) && place !== 0 ? "an" : "a"} ${one(place)}`;
const plural = (place: number) => placeValueEnUnitWord(place, true);
/** "a 70", "an 8", "an 80", "an 800", "an 8,000" (a number said with "eight" first takes "an"). */
const aNumber = (written: string) => `${/^(8|11|18)(\D|$)|^8\d/u.test(written) ? "an" : "a"} ${written}`;

/** The card's own words, whole sentences per language: never a word put into another language's sentence. */
export const PLACE_VALUE_TIMES_TEN_WORDS = {
  "en-US": {
    chartLabel: "Counting an amount in another unit on a place-value chart",
    point: "Decimal point",
    howto: {
      count: "Tap a disk to break it into ten of the column on its right, or a row of ten to put them together into one of the column on its left.",
      times: "Tap a disk of the larger number to break it into ten: one goes into each copy of the smaller number.",
    },
    step: {
      breakDisk: (from: number, to: number) => `Tap ${an(from)} to break it into ten ${plural(to)}.`,
      breakRow: (from: number, to: number) => `Tap a row of ten ${plural(from)} to break it into a hundred ${plural(to)}.`,
      joinRow: (from: number, to: number) => `Tap a row of ten ${plural(from)} to put them together into one ${one(to)}.`,
      joinSquare: (from: number, to: number) => `Tap a square of a hundred ${plural(from)} to put it together into ten ${plural(to)}.`,
      deal: (from: number, to: number, B: string) => `Tap ${an(from)} to break it into ten ${plural(to)}, one into each ${B}.`,
      doneCount: "Type how many below.", doneTimes: "Type the answers below.",
    },
    locked: { count: (t: number) => `Opens when everything is in ${plural(t)}.`, times: (B: string) => `Opens when every row is ${aNumber(B)}.` },
    refusal: {
      at_target: (t: number) => `These are ${plural(t)} already.`,
      copy_short: (have: number, d: number, t: number, B: string) => `This ${B} has ${placeValueTimesTenCountOf(have, t, "en-US")}; ${B} is ${placeValueTimesTenCountOf(d, t, "en-US")}.`,
      copy_full: (B: string) => `This row is one ${B}.`,
      smaller: (B: string, d: number, t: number) => `This is ${B}: ${placeValueTimesTenCountOf(d, t, "en-US")}.`,
      demonstrating: "This chart shows the demonstration.",
    },
    other: "That can't be done here.",
    demo: {
      breakDisk: (from: number, to: number) => `Break each ${one(from)} into ten ${plural(to)}.`,
      breakRow: (from: number, to: number) => `Break every ${one(from)} into ten ${plural(to)}.`,
      joinRow: (from: number, to: number) => `Put each ten ${plural(from)} together into one ${one(to)}.`,
      joinSquare: (from: number, to: number) => `Put every ten ${plural(from)} together into one ${one(to)}.`,
      deal: (from: number, to: number, B: string) => `Break each ${one(from)} into ten ${plural(to)}, one into each ${B}.`,
    },
  },
  "zh-CN": {
    chartLabel: "在数位表上换一个单位来数",
    point: "小数点",
    howto: {
      count: "点一个圆片，把它拆成右边一位的十个；或点一排十个，把它们合成左边一位的一个。",
      times: "点大的数的一个圆片，把它拆成十个：每一个小的数里放一个。",
    },
    step: {
      breakDisk: (from: number, to: number) => `点一个${ZH_UNIT[from]}，把它拆成十个${ZH_UNIT[to]}。`,
      breakRow: (from: number, to: number) => `点一排十个${ZH_UNIT[from]}，把它拆成一百个${ZH_UNIT[to]}。`,
      joinRow: (from: number, to: number) => `点一排十个${ZH_UNIT[from]}，把它们合成一个${ZH_UNIT[to]}。`,
      joinSquare: (from: number, to: number) => `点一块一百个${ZH_UNIT[from]}，把它合成十个${ZH_UNIT[to]}。`,
      deal: (from: number, to: number, B: string) => `点一个${ZH_UNIT[from]}，把它拆成十个${ZH_UNIT[to]}，每一个 ${B} 里放一个。`,
      doneCount: "在下面写出有多少个。", doneTimes: "在下面写出答案。",
    },
    locked: { count: (t: number) => `全部变成${ZH_UNIT[t]}后才能写。`, times: (B: string) => `每一行都是 ${B} 后才能写。` },
    refusal: {
      at_target: (t: number) => `这些已经是${ZH_UNIT[t]}了。`,
      copy_short: (have: number, d: number, t: number, B: string) => `这一个 ${B} 只有 ${have} 个${ZH_UNIT[t]}；${B} 是 ${d} 个${ZH_UNIT[t]}。`,
      copy_full: (B: string) => `这一行是一个 ${B}。`,
      smaller: (B: string, d: number, t: number) => `这是 ${B}：${d} 个${ZH_UNIT[t]}。`,
      demonstrating: "这张表是演示。",
    },
    other: "这里不能这样做。",
    demo: {
      breakDisk: (from: number, to: number) => `把每个${ZH_UNIT[from]}拆成十个${ZH_UNIT[to]}。`,
      breakRow: (from: number, to: number) => `把每个${ZH_UNIT[from]}都拆成十个${ZH_UNIT[to]}。`,
      joinRow: (from: number, to: number) => `每十个${ZH_UNIT[from]}合成一个${ZH_UNIT[to]}。`,
      joinSquare: (from: number, to: number) => `每十个${ZH_UNIT[from]}合成一个${ZH_UNIT[to]}。`,
      deal: (from: number, to: number, B: string) => `把每个${ZH_UNIT[from]}拆成十个${ZH_UNIT[to]}，每一个 ${B} 里放一个。`,
    },
  },
} as const;

const wordsOf = (language: PlaceValueLanguage) => PLACE_VALUE_TIMES_TEN_WORDS[language] ?? PLACE_VALUE_TIMES_TEN_WORDS["en-US"];

/** The problem's words: "3 tenths = ? thousandths", "700 is ? times 70" (the ? is the blank). */
export function placeValueTimesTenProblemText(p: PlaceValueTimesTenProblem, language: PlaceValueLanguage = "en-US"): string {
  if (p.question === "times") {
    return short(language) === "en" ? `${placeValueNumeral(p.amount)} is ? times ${placeValueNumeral(p.target)}` : `${placeValueNumeral(p.amount, language)} 是 ${placeValueNumeral(p.target, language)} 的 ? 倍`;
  }
  const c = p.amount / unit(p.s);
  return short(language) === "en" ? `${placeValueTimesTenCountOf(c, p.s)} = ? ${plural(p.t)}` : `${placeValueTimesTenCountOf(c, p.s, language)} = ?个${ZH_UNIT[p.t]}`;
}

/** How to work the card, in its language, for its question: fixed text a host shows with a task on the card. */
export function placeValueTimesTenHowTo(raw: unknown): string {
  const words = wordsOf(placeValueTimesTenLanguage(raw));
  return (raw as { question?: unknown } | null)?.question === "times" ? words.howto.times : words.howto.count;
}

/** The sentence for the things at one stage (also their tap label). */
export function placeValueTimesTenStepSentence(p: PlaceValueTimesTenProblem, stage: number, language: PlaceValueLanguage = "en-US"): string {
  const h = wordsOf(language).step, place = placeAt(p, stage), to = place + p.dir, size = sizeAt(p, stage);
  if (p.question === "times") return h.deal(place, to, placeValueNumeral(p.target, language));
  if (p.dir < 0) return size === 1 ? h.breakDisk(place, to) : h.breakRow(place, to);
  return size === 10 ? h.joinRow(place, to) : h.joinSquare(place, to);
}

/** The instruction on the card, which follows the chart: every kind of thing that can be tapped now, nothing else. */
export function placeValueTimesTenInstruction(state: PlaceValueTimesTenState, language: PlaceValueLanguage = "en-US"): string {
  const p = state.problem, h = wordsOf(language).step;
  if (placeValueTimesTenComplete(state)) return p.question === "times" ? h.doneTimes : h.doneCount;
  const stages = [...new Set(state.stages.filter((k) => k < p.g))].sort();
  return stages.map((k) => placeValueTimesTenStepSentence(p, k, language)).join(short(language) === "en" ? " " : "");
}

/** What the answer row says while it is locked: what "finished" means, as a fact. */
export function placeValueTimesTenLockedText(p: PlaceValueTimesTenProblem, language: PlaceValueLanguage = "en-US"): string {
  const l = wordsOf(language).locked;
  return p.question === "times" ? l.times(placeValueNumeral(p.target, language)) : l.count(p.t);
}

/** The answer row's parts (text and blanks), and each blank's answer: for the typed task tied to the card. */
export function placeValueTimesTenAnswerParts(p: PlaceValueTimesTenProblem, language: PlaceValueLanguage = "en-US"): Array<{ text: string } | { blank: { as: string; answer: number } }> {
  const en = short(language) === "en";
  if (p.question === "count") {
    const c = p.amount / unit(p.s);
    return [{ text: `${placeValueTimesTenCountOf(c, p.s, language)} =` }, { blank: { as: "count", answer: p.result } }, { text: en ? plural(p.t) : `个${ZH_UNIT[p.t]}` }];
  }
  const A = placeValueNumeral(p.amount, language), B = placeValueNumeral(p.target, language);
  return en
    ? [{ text: `${placeValueTimesTenCountOf(p.digit!, p.s)} =` }, { blank: { as: "renamed", answer: p.renamed! } }, { text: `${plural(p.t)};` }, { text: `${A} is` }, { blank: { as: "times", answer: 10 } }, { text: `times ${B}` }]
    : [{ text: `${placeValueTimesTenCountOf(p.digit!, p.s, language)} =` }, { blank: { as: "renamed", answer: p.renamed! } }, { text: `个${ZH_UNIT[p.t]}；` }, { text: `${A} 是 ${B} 的` }, { blank: { as: "times", answer: 10 } }, { text: "倍" }];
}

/** The line once every blank is right: the fact the card is for (a times pair says the 1/10 here). */
export function placeValueTimesTenDoneText(p: PlaceValueTimesTenProblem, language: PlaceValueLanguage = "en-US"): string {
  const en = short(language) === "en";
  if (p.question === "count") {
    const c = p.amount / unit(p.s);
    return `✓ ${placeValueTimesTenCountOf(c, p.s, language)} = ${placeValueTimesTenCountOf(p.result, p.t, language)}`;
  }
  const A = placeValueNumeral(p.amount, language), B = placeValueNumeral(p.target, language), d = p.digit!;
  return en
    ? `✓ ${A} = 10 × ${B}. The ${d} in ${A} is worth ten times the ${d} in ${B}; ${B} is 1/10 of ${A}.`
    : `✓ ${A} = 10 × ${B}。${A} 里的 ${d} 是 ${B} 里的 ${d} 的 10 倍；${B} 是 ${A} 的十分之一。`;
}

/** What the card says when a tap is refused, in its language: a fact, never an instruction. */
export function placeValueTimesTenRefusalText(state: PlaceValueTimesTenState, tap: PlaceValueTimesTenTap, language: PlaceValueLanguage = "en-US"): string {
  const words = wordsOf(language), r = words.refusal, p = state.problem;
  const result = applyPlaceValueTimesTenTap(state, tap);
  if (result.ok) return "";
  const B = placeValueNumeral(p.target, language);
  switch (result.reason) {
    case "at_target": return r.at_target(p.t);
    case "copy_short": return r.copy_short(result.have!, result.need!, p.t, B);
    case "copy_full": return r.copy_full(B);
    case "smaller": return r.smaller(B, p.digit!, p.t);
    case "demonstrating": return r.demonstrating;
    default: return words.other;
  }
}

/** What each demonstration step does, as one sentence per later "counted in" value: for a lesson's later sections. */
export function placeValueTimesTenStepSentences(p: PlaceValueTimesTenProblem, language: PlaceValueLanguage = "en-US"): string[] {
  const dm = wordsOf(language).demo, B = placeValueNumeral(p.target, language);
  return Array.from({ length: p.g }, (_, k) => {
    const from = placeAt(p, k), to = placeAt(p, k + 1), size = sizeAt(p, k);
    if (p.question === "times") return dm.deal(from, to, B);
    if (p.dir < 0) return size === 1 ? dm.breakDisk(from, to) : dm.breakRow(from, to);
    return size === 10 ? dm.joinRow(from, to) : dm.joinSquare(from, to);
  });
}

// ---------------------------------------------------------------- plan

export interface PlaceValueTimesTenBox { x: number; y: number; width: number; height: number }

export interface PlaceValueTimesTenColumnPlan {
  place: number;
  x: number;
  width: number;
  head: string[];
  /** Row 1 (the amount), and a times pair's row 2 (the smaller number). */
  cell: PlaceValueTimesTenBox;
  cell2?: PlaceValueTimesTenBox;
  diskLabel: string;
  fill: string;
  /** A count's target column (the "?" by its name). */
  target: boolean;
}

export interface PlaceValueTimesTenPlan {
  width: number;
  height: number;
  disk: number;
  gap: number;
  columns: PlaceValueTimesTenColumnPlan[];
  /** A times pair's row labels: the two numbers at the left edge. */
  labels: Array<{ row: 1 | 2; text: string; x: number; y: number }>;
  /** The decimal point's dots, between the ones and the tenths. */
  points: Array<{ x: number; y: number }>;
  /**
   * Where the answer is read (drawn as `.place-value-times-ten-answer`, for a player to frame when the answer row
   * opens): a count's target column; a times pair's column of copy numbers (1 to 10), beside its copies.
   */
  answer: PlaceValueTimesTenBox;
}

/** The sketch's geometry (px): disks of 30, rows of 42, squares of 106. */
export const PLACE_VALUE_TIMES_TEN_GEOMETRY = { D: 30, G: 3, RP: 4, CP: 12, RH: 42, SQ: 106, SG: 8, NARROW: 150, POINT: 14, GAP: 8, EDGE: 12, HEAD: 34, LABEL: 22 } as const;
const GEO = PLACE_VALUE_TIMES_TEN_GEOMETRY;
/** A ringed row of k disks. */
export const placeValueTimesTenRowWidth = (k: number): number => k * (GEO.D + GEO.G) - GEO.G + 2 * GEO.RP;
const ROW_W = placeValueTimesTenRowWidth(10), WIDE = ROW_W + 2 * GEO.CP;
/** The top of row slot i in a cell. */
export const placeValueTimesTenSlotTop = (i: number): number => GEO.CP / 2 + i * GEO.RH;

/** Each column's width: a column of single disks is narrow; one that can hold rows of ten or squares is wide. */
function columnWidth(p: PlaceValueTimesTenProblem, place: number): number {
  if (p.question === "times") return place === p.s ? Math.max(GEO.NARROW, placeValueTimesTenRowWidth(p.n) + 2 * GEO.CP) : placeValueTimesTenRowWidth(p.n) + 2 * GEO.CP + 44;
  return sizeAt(p, Math.abs(place - p.s)) === 1 ? GEO.NARROW : WIDE;
}
/** The height row 1 needs for the most it can ever hold: kept from the start, so nothing jumps. */
function rowOneHeight(p: PlaceValueTimesTenProblem): number {
  if (p.question === "times") return GEO.CP + PLACE_VALUE_TIMES_TEN_COPIES * GEO.RH - 2;
  const n = Math.max(1, p.n);
  return Math.max(...Array.from({ length: p.g + 1 }, (_, k) => (sizeAt(p, k) === 100 ? GEO.CP + Math.ceil(n / 3) * (GEO.SQ + GEO.SG) - GEO.SG : GEO.CP + n * GEO.RH - 2)));
}

/** The card's layout, from the sketch: a head per column; row 1; a times pair's row 2 with the two numbers at the left. */
export function planPlaceValueTimesTen(raw: unknown): PlaceValueTimesTenPlan {
  const content = (raw ?? {}) as Partial<PlaceValueTimesTenContent>;
  const language = placeValueTimesTenLanguage(content);
  const { problem: p } = placeValueTimesTenState(content);
  const times = p.question === "times";
  const labelWidth = times ? Math.ceil((Math.max(placeValueNumeral(p.amount, language).length, placeValueNumeral(p.target, language).length) + 0.5) * GEO.LABEL * 0.6) + 10 : 0;
  const pointAt = p.columns.indexOf(-1) > 0 ? p.columns.indexOf(-1) : -1;
  let x = GEO.EDGE + labelWidth;
  const top = GEO.EDGE / 2 + GEO.HEAD;
  const h1 = rowOneHeight(p), h2 = times ? GEO.CP + GEO.RH - 2 : 0;
  const columns: PlaceValueTimesTenColumnPlan[] = [];
  const points: PlaceValueTimesTenPlan["points"] = [];
  p.columns.forEach((place, k) => {
    if (k === pointAt) {
      points.push({ x: x + GEO.POINT / 2, y: top + h1 - 10 });
      if (times) points.push({ x: x + GEO.POINT / 2, y: top + h1 + 8 + h2 - 10 });
      x += GEO.POINT + GEO.GAP;
    }
    const width = columnWidth(p, place);
    const name = placeValueColumnName(place, language);
    columns.push({
      place, x, width,
      head: short(language) === "en" && name.includes(" ") && width < 200 ? name.split(" ") : [name],
      cell: { x, y: top, width, height: h1 },
      ...(times ? { cell2: { x, y: top + h1 + 8, width, height: h2 } } : {}),
      diskLabel: placeValueDiskLabel(place, language),
      fill: PLACE_VALUE_FILLS[place]!,
      target: !times && place === p.t,
    });
    x += width + GEO.GAP;
  });
  const width = x - GEO.GAP + GEO.EDGE;
  const height = top + h1 + (times ? 8 + h2 : 0) + GEO.EDGE;
  const labels: PlaceValueTimesTenPlan["labels"] = times ? [
    { row: 1, text: placeValueNumeral(p.amount, language), x: GEO.EDGE + labelWidth - 10, y: top + h1 / 2 },
    { row: 2, text: placeValueNumeral(p.target, language), x: GEO.EDGE + labelWidth - 10, y: top + h1 + 8 + h2 / 2 },
  ] : [];
  const asked = columns.find((column) => column.place === p.t)!;
  const numbers = asked.cell.x + GEO.CP + placeValueTimesTenRowWidth(p.n) + 2;
  const answer = times
    ? { x: numbers, y: asked.cell.y + placeValueTimesTenSlotTop(0), width: asked.cell.x + asked.cell.width - numbers, height: placeValueTimesTenSlotTop(PLACE_VALUE_TIMES_TEN_COPIES - 1) - placeValueTimesTenSlotTop(0) + GEO.D + 2 * GEO.RP }
    : { ...asked.cell };
  return { width, height, disk: GEO.D, gap: GEO.G, columns, labels, points, answer };
}

/** The font size a disk label fits at, by the label's length. */
export function placeValueTimesTenDiskFont(label: string, disk: number = GEO.D): number {
  return label.length >= 7 ? disk * 0.26 : label.length >= 5 ? disk * 0.29 : label.length >= 4 ? disk * 0.35 : disk * 0.4;
}

/**
 * The width a disk label is drawn to when at its font it would run past the disk (a wide place value: 100,000 and
 * 1,000,000 on disks of 30 px), or undefined when it fits as it is. Estimated from bold digits (0.6 em) and
 * separators (0.3 em); the label is then squeezed to the disk's inner width, so it is read whole on its own disk.
 */
export function placeValueTimesTenDiskLabelWidth(label: string, disk: number = GEO.D): number | undefined {
  const font = placeValueTimesTenDiskFont(label, disk);
  const natural = [...label].reduce((sum, char) => sum + (/[0-9]/u.test(char) ? 0.6 : /[,.]/u.test(char) ? 0.3 : 1) * font, 0);
  const inner = disk - 6;
  return natural > inner ? inner : undefined;
}
