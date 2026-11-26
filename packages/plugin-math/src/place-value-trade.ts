/**
 * Adding and subtracting on the place-value chart, drawn as the written column method (decision 0026, need
 * 35P-07): a `place_value_trade` card of the math plugin.
 *
 * The content states two numbers, the operation, the card's columns (fixed for the card) and one small status
 * per column. Top to bottom the card is the written method in disks: a carry spot (adding), row 1 (the first
 * number's disks), row 2 (the second number's disks, or, subtracting, dashed rings for what is taken away),
 * the sum line with a ↓ under each column, and the answer row. Adding, ↓ brings a column's two rows (and its
 * carry) down below the line together, and a ringed ten below the line is traded for one disk in the next
 * column's carry spot. Subtracting, ↓ takes row 2's amount away and the rest comes down; a short column is
 * given ten by breaking one disk of the nearest column on its left that has one.
 *
 * The whole state of the card is one integer per column (its status); every count on the chart is derived
 * from the two numbers and those statuses. A demonstration moves through one more number, "columns finished,
 * counting from the right" (0 to the number of columns): the program plays each column's bring-down, trades
 * and breaks by these rules. The rules, the invariants and the demonstration are ported from the accepted
 * sketch (sketch v2, model.mjs); the columns, place names, decimal point, disks and fills are the place-value
 * chart's (decision 0025), shared, not copied.
 *
 * Every value is an exact integer count of thousandths, as on the chart (2.75 is 2750); a number has at most
 * two decimals, so its thousandths digit is 0. Nothing is rounded. Every text the card shows about the numbers
 * is computed here, never written by a model. This module imports only the chart's module, so the core
 * validator, the reducer and the web runtime can all load it (decision 0013 §3).
 */
import {
  PLACE_VALUE_CHART_LANGUAGES, PLACE_VALUE_FILLS, PLACE_VALUE_PLACE_ALIASES, placeValueColumnName, placeValueDigitAt, placeValueDiskLabel,
  placeValueLanguage, placeValueNumeral, placeValueTopPlace, placeValueUnitName, type PlaceValueLanguage,
} from "./place-value-chart.js";

export const PLACE_VALUE_TRADE_KIND = "place_value_trade";
export const PLACE_VALUE_TRADE_FEATURE = "plugin:math/place-value-trade@1";
/** The math plugin version that introduced the card. */
export const PLACE_VALUE_TRADE_PLUGIN_VERSION = "0.9.0";
/** The languages the card speaks: the chart's. A card without `language` speaks US English. */
export const PLACE_VALUE_TRADE_LANGUAGES = PLACE_VALUE_CHART_LANGUAGES;

export const PLACE_VALUE_TRADE_MIN_PLACE = -2; // hundredths
export const PLACE_VALUE_TRADE_MAX_PLACE = 5; // hundred thousands
export const PLACE_VALUE_TRADE_MAX_COLUMNS = 6;
export const PLACE_VALUE_TRADE_MAX_DECIMALS = 2;
/** A lesson holds at most 16 variables (OLL); this card binds 3 + its columns, at most 9. */
export const PLACE_VALUE_TRADE_MAX_VARIABLES = 16;
/** The largest number the card takes, in thousandths: 999,999.99. */
export const PLACE_VALUE_TRADE_MAX_VALUE = 10 ** (PLACE_VALUE_TRADE_MAX_PLACE + 1) * 1000 - 10;

export const PLACE_VALUE_TRADE_OPERATIONS = ["add", "subtract"] as const;
export type PlaceValueTradeOperation = typeof PLACE_VALUE_TRADE_OPERATIONS[number];

/** Numeric fields of a column that lesson variables may drive: its status. */
export const PLACE_VALUE_TRADE_BINDINGS = { places: ["status"] } as const;
/**
 * Card-level fields a lesson variable may drive, each bound by its bare name: the two numbers (a practice
 * task's start sets them, so it starts on its own pair) and the demonstration's "columns finished".
 */
export const PLACE_VALUE_TRADE_CARD_BINDINGS = ["a", "b", "finished"] as const;
/** The card-level fields that make the task's own problem: a practice pair differs from the lesson's as a pair. */
export const PLACE_VALUE_TRADE_PROBLEM_FIELDS = ["a", "b"] as const;
/** Content fields whose items are addressable parts (`sum#tens`). */
export const PLACE_VALUE_TRADE_PART_FIELDS = ["places"] as const;
/** The taps a learner makes: ↓ under a column, a ringed ten (adding), a disk to break (subtracting). */
export const PLACE_VALUE_TRADE_TAPS = ["down", "trade", "break"] as const;
export type PlaceValueTradeTapKind = typeof PLACE_VALUE_TRADE_TAPS[number];

const SHORT: Record<PlaceValueLanguage, "en" | "zh"> = { "en-US": "en", "zh-CN": "zh" };
const short = (language: PlaceValueLanguage | undefined): "en" | "zh" => SHORT[language ?? "en-US"] ?? "en";

/** Thousandths in one disk of a place. */
const unit = (place: number): number => 10 ** (place + 3);

// ---------------------------------------------------------------- numbers (sketch model, ported)

/** How many decimals a value writes (0 to 3), from its digits: 2.5 writes one, 2.75 two. */
export function placeValueTradeDecimals(value: number): number {
  const frac = value % 1000;
  return !frac ? 0 : frac % 100 === 0 ? 1 : frac % 10 === 0 ? 2 : 3;
}

/**
 * "3,486", "2.75", "5" -> the value in thousandths and the decimals written ("1.30" writes two). More than two
 * decimals: `{ value: undefined, dec }`. Unreadable (a sign, more than six whole digits): undefined.
 */
export function placeValueTradeParse(text: string): { value: number | undefined; dec: number } | undefined {
  const written = String(text).trim().replace(/,/g, "");
  const match = /^(\d{1,6})(?:\.(\d+))?$/.exec(written);
  if (!match) return undefined;
  const dec = (match[2] ?? "").length;
  if (dec > PLACE_VALUE_TRADE_MAX_DECIMALS) return { value: undefined, dec };
  return { value: Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0") || "0"), dec };
}

/** A numeral written with a fixed number of decimals (a row label: "5.00" when the other number has hundredths). */
export function placeValueTradeNumeralFixed(value: number, dec: number, language: PlaceValueLanguage = "en-US"): string {
  const whole = Math.floor(value / 1000), frac = value % 1000;
  const wholeText = placeValueNumeral(whole * 1000, language);
  return dec ? `${wholeText}.${String(frac).padStart(3, "0").slice(0, dec)}` : wholeText;
}

/** A place's unit in a sentence: "100" (en) or 「百」 (zh). */
export const placeValueTradeUnitWord = (place: number, language: PlaceValueLanguage = "en-US"): string => placeValueUnitName(place, language);

// ---------------------------------------------------------------- problems

const OP: Record<PlaceValueTradeOperation, "+" | "-"> = { add: "+", subtract: "-" };

/** A problem as the card holds it: the pair, its columns (highest first) and each column's digits. */
export interface PlaceValueTradeProblem {
  operation: PlaceValueTradeOperation;
  op: "+" | "-";
  /** The two numbers and the answer, in thousandths. */
  a: number;
  b: number;
  result: number;
  /** The decimals the row labels write: the more of the two numbers'. */
  dec: number;
  columns: number[];
  da: Record<number, number>;
  db: Record<number, number>;
}

export type PlaceValueTradeFault = "unreadable" | "decimals" | "negative" | "too_wide" | "no_trade";

const readable = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= PLACE_VALUE_TRADE_MAX_VALUE;

/**
 * The columns a pair needs, highest first: from the lowest place either number writes up to the highest place of
 * either number or the answer (a sum that gains a place gets its column). A pair below 1 (0.35 + 0.48) has no ones
 * column, as the sketch draws it; the top place is then negative. Not checked against the limits. Places come from
 * the values, so a written trailing zero ("2.50") adds no column: a lesson number cannot carry it.
 */
export function placeValueTradeColumnsFor(operation: PlaceValueTradeOperation, a: number, b: number): { top_place: number; low_place: number } {
  const result = operation === "add" ? a + b : Math.max(0, a - b);
  const low = 0 - Math.min(PLACE_VALUE_TRADE_MAX_DECIMALS, Math.max(placeValueTradeDecimals(a), placeValueTradeDecimals(b)));
  const top = Math.max(placeValueTopPlace(a), placeValueTopPlace(b), placeValueTopPlace(result), low);
  return { top_place: top, low_place: low };
}

/** The columns from a top place down to a low place, highest first. */
export function placeValueTradeColumns(topPlace: number, lowPlace: number): number[] {
  const columns: number[] = [];
  for (let place = topPlace; place >= lowPlace; place -= 1) columns.push(place);
  return columns;
}

/**
 * The card's problem on fixed columns (the content's), whatever the pair: what the card draws and its taps
 * act on. Numbers are taken to whole hundredths within the card's range, so a number between two values (a
 * variable animating) never draws a fraction of a disk. Use `placeValueTradeFault` for the pairs a lesson may use.
 */
export function placeValueTradeProblemOn(operation: PlaceValueTradeOperation, a: number, b: number, columns: readonly number[]): PlaceValueTradeProblem {
  const whole = (value: number) => (Number.isFinite(value) ? Math.min(PLACE_VALUE_TRADE_MAX_VALUE, Math.max(0, Math.round(value / 10) * 10)) : 0);
  const A = whole(a), B = whole(b);
  const op = OP[operation] ?? "+";
  const da = Object.fromEntries(columns.map((place) => [place, placeValueDigitAt(A, place)]));
  const db = Object.fromEntries(columns.map((place) => [place, placeValueDigitAt(B, place)]));
  return {
    operation: op === "+" ? "add" : "subtract", op, a: A, b: B, result: op === "+" ? A + B : A - B,
    dec: Math.max(placeValueTradeDecimals(A), placeValueTradeDecimals(B)), columns: [...columns], da, db,
  };
}

/**
 * A pair the card refuses (decision 0026 §5): a number that is not a whole number of thousandths from 0 to
 * 999,999.99 (`unreadable`), more than two decimals, a difference below zero, more than six columns, or no
 * column that carries or borrows (not this card's need).
 */
export function placeValueTradeFault(operation: PlaceValueTradeOperation, a: unknown, b: unknown): PlaceValueTradeFault | undefined {
  if (!readable(a) || !readable(b) || !PLACE_VALUE_TRADE_OPERATIONS.includes(operation)) return "unreadable";
  if (a % 10 || b % 10) return "decimals";
  if (operation === "subtract" && b > a) return "negative";
  const { top_place, low_place } = placeValueTradeColumnsFor(operation, a, b);
  if (top_place > PLACE_VALUE_TRADE_MAX_PLACE || top_place - low_place + 1 > PLACE_VALUE_TRADE_MAX_COLUMNS) return "too_wide";
  const problem = placeValueTradeProblemOn(operation, a, b, placeValueTradeColumns(top_place, low_place));
  const { da, db, columns } = problem;
  const trades = operation === "add" ? columns.some((p) => da[p]! + db[p]! >= 10) : columns.some((p) => da[p]! < db[p]!);
  return trades ? undefined : "no_trade";
}

/** The sketch's `makeProblem`: the pair's own problem on the columns it needs, or the fault the card refuses it for. */
export function placeValueTradeMakeProblem(operation: PlaceValueTradeOperation, a: number, b: number): PlaceValueTradeProblem | { fault: PlaceValueTradeFault } {
  const fault = placeValueTradeFault(operation, a, b);
  if (fault) return { fault };
  const { top_place, low_place } = placeValueTradeColumnsFor(operation, a, b);
  return placeValueTradeProblemOn(operation, a, b, placeValueTradeColumns(top_place, low_place));
}

/** "3,486 + 2,739", 「3000 − 1468」. */
export function placeValueTradeProblemText(problem: PlaceValueTradeProblem, language: PlaceValueLanguage = "en-US"): string {
  return `${placeValueNumeral(problem.a, language)} ${problem.op === "+" ? "+" : "−"} ${placeValueNumeral(problem.b, language)}`;
}

// ---------------------------------------------------------------- the chart's state: one status per column

// Adding:      0 = still in rows 1 and 2;  1 = brought down below the line;  2 = brought down and its ten traded.
// Subtracting: bit 0 = taken away (the rest is below the line);  bit 1 = received ten from one broken disk on its left.
export const PLACE_VALUE_TRADE_ADD = { UP: 0, DOWN: 1, TRADED: 2 } as const;
export const PLACE_VALUE_TRADE_SUB = { TAKEN: 1, RECEIVED: 2 } as const;
/** The largest status of a column: adding 2, subtracting 3. */
export const placeValueTradeMaxStatus = (operation: PlaceValueTradeOperation): number => (operation === "subtract" ? 3 : 2);

export interface PlaceValueTradeState {
  problem: PlaceValueTradeProblem;
  /** Each column's status, by place. */
  status: Record<number, number>;
  /**
   * A card's demonstration, columns finished (`placeValueTradeState`): above 0 the chart is the demonstration's,
   * and the learner's taps are refused. Absent for the rules' own states.
   */
  finished?: number;
}

export function placeValueTradeStart(problem: PlaceValueTradeProblem): PlaceValueTradeState {
  return { problem, status: Object.fromEntries(problem.columns.map((p) => [p, 0])) };
}
const has = (state: PlaceValueTradeState, place: number): boolean => state.problem.columns.includes(place);
const withStatus = (state: PlaceValueTradeState, place: number, value: number): PlaceValueTradeState => ({ problem: state.problem, status: { ...state.status, [place]: value } });

// Adding
const isDown = (s: PlaceValueTradeState, p: number): boolean => s.status[p]! >= PLACE_VALUE_TRADE_ADD.DOWN;
const isTraded = (s: PlaceValueTradeState, p: number): boolean => s.status[p] === PLACE_VALUE_TRADE_ADD.TRADED;
const carryInto = (s: PlaceValueTradeState, p: number): number => (has(s, p - 1) && isTraded(s, p - 1) ? 1 : 0);
// Subtracting
export const placeValueTradeIsTaken = (s: PlaceValueTradeState, p: number): boolean => (s.status[p]! & PLACE_VALUE_TRADE_SUB.TAKEN) !== 0;
const isTaken = placeValueTradeIsTaken;
const received = (s: PlaceValueTradeState, p: number): boolean => (s.status[p]! & PLACE_VALUE_TRADE_SUB.RECEIVED) !== 0;
const gave = (s: PlaceValueTradeState, p: number): number => (has(s, p - 1) && received(s, p - 1) ? 1 : 0);
/** Subtracting: the disks this column holds now (in row 1 before its take-away, below the line after). */
function holds(s: PlaceValueTradeState, p: number): number {
  const { da, db } = s.problem;
  return da[p]! + 10 * (received(s, p) ? 1 : 0) - gave(s, p) - (isTaken(s, p) ? db[p]! : 0);
}

/**
 * What the chart shows in one column. carry: disks in the carry spot (adding). top: row 1 disks. second: row 2
 * disks (adding) or take-away rings (subtracting). answer: disks below the line. topRing / answerRing: the first
 * ten of that cell are drawn as one ringed group (adding: a ten ready to trade; subtracting: the ten that one
 * broken disk became).
 */
export interface PlaceValueTradeCell {
  down: boolean;
  carry: number;
  top: number;
  second: number;
  answer: number;
  topRing: boolean;
  answerRing: boolean;
}

export function placeValueTradeCell(state: PlaceValueTradeState, place: number): PlaceValueTradeCell {
  const { op, da, db } = state.problem;
  if (op === "+") {
    const down = isDown(state, place), c = carryInto(state, place);
    const answer = down ? da[place]! + db[place]! + c - (isTraded(state, place) ? 10 : 0) : 0;
    return { down, carry: down ? 0 : c, top: down ? 0 : da[place]!, second: down ? 0 : db[place]!, answer, topRing: false, answerRing: answer >= 10 };
  }
  const taken = isTaken(state, place), n = holds(state, place), ring = received(state, place) && n >= 10;
  return { down: taken, carry: 0, top: taken ? 0 : n, second: db[place]!, answer: taken ? n : 0, topRing: !taken && ring, answerRing: taken && ring };
}
const cell = placeValueTradeCell;

/**
 * A cell as the card draws it: the rules' counts, never below zero nor past what a cell holds (19). Statuses no
 * taps make (a variable between values, a restored pile) can make the rules' counts negative; they are drawn
 * as empty, never as a negative number of disks. Reachable states draw exactly the rules' counts.
 */
export function placeValueTradeDrawnCell(state: PlaceValueTradeState, place: number): PlaceValueTradeCell {
  const c = cell(state, place);
  const clamp = (n: number) => Math.min(19, Math.max(0, n));
  const top = clamp(c.top), answer = clamp(c.answer);
  return { down: c.down, carry: clamp(c.carry), top, second: clamp(c.second), answer, topRing: c.topRing && top >= 10, answerRing: c.answerRing && answer >= 10 };
}

/** The value of every disk on the chart, in thousandths (rings are not disks). */
export function placeValueTradeChartValue(state: PlaceValueTradeState): number {
  return state.problem.columns.reduce((sum, p) => {
    const c = cell(state, p);
    return sum + (c.carry + c.top + (state.problem.op === "+" ? c.second : 0) + c.answer) * unit(p);
  }, 0);
}
/** Subtracting: what has been taken away so far, in thousandths. */
export function placeValueTradeTakenValue(state: PlaceValueTradeState): number {
  return state.problem.op === "-" ? state.problem.columns.reduce((sum, p) => sum + (isTaken(state, p) ? state.problem.db[p]! * unit(p) : 0), 0) : 0;
}
/** The invariant: adding, the chart always holds a + b; subtracting, the chart plus what was taken always holds a. */
export function placeValueTradeInvariantHolds(state: PlaceValueTradeState): boolean {
  const { op, a, b } = state.problem;
  const counts = state.problem.columns.every((p) => Object.values(cell(state, p)).every((v) => typeof v === "boolean" || (Number.isInteger(v) && v >= 0)));
  return counts && (op === "+" ? placeValueTradeChartValue(state) === a + b : placeValueTradeChartValue(state) + placeValueTradeTakenValue(state) === a);
}

export type PlaceValueTradeRefusal =
  | "wrong_op" | "no_place" | "already_down" | "not_down" | "not_ten" | "no_left"
  | "already_taken" | "not_enough" | "none_to_break" | "no_right" | "not_needed" | "demonstrating";

/** An animation the view plays for an action the rules made. */
export type PlaceValueTradeAnim =
  | { kind: "down"; place: number }
  | { kind: "trade"; from: number; to: number; landed: "answer" | "carry" }
  | { kind: "take"; place: number; n: number }
  | { kind: "break"; from: number; to: number; landed: "answer" | "top" };

export type PlaceValueTradeResult =
  | { ok: true; state: PlaceValueTradeState; anim: PlaceValueTradeAnim }
  | { ok: false; reason: PlaceValueTradeRefusal; have?: number; need?: number; right?: number; taken?: boolean };

const refuse = (reason: PlaceValueTradeRefusal, extra: { have?: number; need?: number; right?: number; taken?: boolean } = {}): PlaceValueTradeResult => ({ ok: false, reason, ...extra });
const done = (state: PlaceValueTradeState, anim: PlaceValueTradeAnim): PlaceValueTradeResult => ({ ok: true, state, anim });

// Adding
/** ↓ on a column: both rows and its carry come down below the line together. */
export function placeValueTradeBringDown(state: PlaceValueTradeState, place: number): PlaceValueTradeResult {
  if (state.problem.op !== "+") return refuse("wrong_op");
  if (!has(state, place)) return refuse("no_place");
  if (isDown(state, place)) return refuse("already_down");
  return done(withStatus(state, place, PLACE_VALUE_TRADE_ADD.DOWN), { kind: "down", place });
}
/** Tap a ringed ten below the line: the ten become one disk of the next place left (in its carry spot, or below its line if it is already down). */
export function placeValueTradeTradeTen(state: PlaceValueTradeState, place: number): PlaceValueTradeResult {
  if (state.problem.op !== "+") return refuse("wrong_op");
  if (!has(state, place)) return refuse("no_place");
  if (!isDown(state, place)) return refuse("not_down");
  if (cell(state, place).answer < 10) return refuse("not_ten");
  if (!has(state, place + 1)) return refuse("no_left");
  return done(withStatus(state, place, PLACE_VALUE_TRADE_ADD.TRADED), { kind: "trade", from: place, to: place + 1, landed: isDown(state, place + 1) ? "answer" : "carry" });
}

// Subtracting
/**
 * Does this column need ten from its left? It does when it hasn't been taken away and has fewer than it must
 * give, or when it is empty and the column on its right needs ten (a borrow across zeros passes through it).
 */
export function placeValueTradeWantsTen(state: PlaceValueTradeState, place: number): boolean {
  if (!has(state, place) || received(state, place)) return false;
  if (!isTaken(state, place) && holds(state, place) < state.problem.db[place]!) return true;
  return holds(state, place) === 0 && has(state, place - 1) && placeValueTradeWantsTen(state, place - 1);
}
/**
 * A short column's only legal break: the nearest column on its left that has a disk (every column between is
 * empty, so they all pass the ten on). Undefined when the column needs nothing. The view lightly marks those disks.
 */
export function placeValueTradeBreakSource(state: PlaceValueTradeState, place: number): number | undefined {
  if (state.problem.op !== "-" || !placeValueTradeWantsTen(state, place)) return undefined;
  for (let q = place + 1; has(state, q); q += 1) if (holds(state, q) > 0) return q;
  return undefined;
}
/** ↓ on a column: take away row 2's amount; the rest comes down below the line. Only when the column has that many. */
export function placeValueTradeTakeAway(state: PlaceValueTradeState, place: number): PlaceValueTradeResult {
  if (state.problem.op !== "-") return refuse("wrong_op");
  if (!has(state, place)) return refuse("no_place");
  if (isTaken(state, place)) return refuse("already_taken");
  const n = holds(state, place), k = state.problem.db[place]!;
  if (n < k) return refuse("not_enough", { have: n, need: k });
  return done(withStatus(state, place, state.status[place]! | PLACE_VALUE_TRADE_SUB.TAKEN), { kind: "take", place, n: k });
}
/**
 * Tap a disk: it breaks into ten disks of the column on its right. Only when that column needs them (it is
 * short, or it is empty and passes them on). A disk below the line can break too, so the order is free.
 */
export function placeValueTradeBreakOne(state: PlaceValueTradeState, place: number): PlaceValueTradeResult {
  if (state.problem.op !== "-") return refuse("wrong_op");
  if (!has(state, place)) return refuse("no_place");
  if (holds(state, place) < 1) return refuse("none_to_break");
  if (!has(state, place - 1)) return refuse("no_right");
  const right = place - 1;
  if (!placeValueTradeWantsTen(state, right)) {
    return refuse("not_needed", { right, taken: isTaken(state, right), have: holds(state, right), need: state.problem.db[right]! });
  }
  return done(withStatus(state, right, state.status[right]! | PLACE_VALUE_TRADE_SUB.RECEIVED), { kind: "break", from: place, to: right, landed: isTaken(state, right) ? "answer" : "top" });
}

/** The ↓ under a column: adding brings it down; subtracting takes away. */
export function placeValueTradeDown(state: PlaceValueTradeState, place: number): PlaceValueTradeResult {
  return state.problem.op === "+" ? placeValueTradeBringDown(state, place) : placeValueTradeTakeAway(state, place);
}

/** One learner tap on the card: ↓ under a column, a ringed ten, or a disk to break, at a place (5 to -2). */
export interface PlaceValueTradeTap { tap: PlaceValueTradeTapKind; place: number }

/**
 * The tap rules: ↓ brings down or takes away, `trade` trades a ringed ten (adding), `break` breaks a disk
 * (subtracting). A chart showing a demonstration (columns finished above 0) takes no taps: its columns are the
 * program's. Subtracting, a tap on an answer cell nothing has come down to yet (the view sends `trade` there) is
 * refused as the sketch says it: nothing below the line yet.
 */
export function applyPlaceValueTradeTap(state: PlaceValueTradeState, tap: PlaceValueTradeTap): PlaceValueTradeResult {
  if ((state.finished ?? 0) > 0) return refuse("demonstrating");
  if (tap.tap === "trade" && state.problem.op === "-") return has(state, tap.place) && !isTaken(state, tap.place) ? refuse("not_down") : refuse("wrong_op");
  if (tap.tap === "down") return placeValueTradeDown(state, tap.place);
  if (tap.tap === "trade") return placeValueTradeTradeTen(state, tap.place);
  if (tap.tap === "break") return placeValueTradeBreakOne(state, tap.place);
  return refuse("wrong_op");
}

// ---------------------------------------------------------------- finishing

/** A column is finished: adding, it is down and no ten is left in it (its carry has gone); subtracting, it is taken away and reads one digit. */
export function placeValueTradeColumnFinished(state: PlaceValueTradeState, place: number): boolean {
  const c = cell(state, place);
  return c.down && c.answer <= 9;
}
/** Every column finished: the answer row reads the answer in disks. There is no "I'm done". */
export function placeValueTradeComplete(state: PlaceValueTradeState): boolean {
  return state.problem.columns.every((p) => placeValueTradeColumnFinished(state, p));
}
/** Columns finished, counting from the right: the demonstration's lesson number (0..n). */
export function placeValueTradeFinishedCount(state: PlaceValueTradeState): number {
  let k = 0;
  for (const p of [...state.problem.columns].reverse()) {
    if (!placeValueTradeColumnFinished(state, p)) break;
    k += 1;
  }
  return k;
}

/** Every action the chart allows from this state (the view's taps reach exactly these). */
export function placeValueTradeMoves(state: PlaceValueTradeState): Array<Extract<PlaceValueTradeResult, { ok: true }>> {
  const out: Array<Extract<PlaceValueTradeResult, { ok: true }>> = [];
  for (const p of state.problem.columns) {
    const tries = state.problem.op === "+" ? [placeValueTradeBringDown(state, p), placeValueTradeTradeTen(state, p)] : [placeValueTradeTakeAway(state, p), placeValueTradeBreakOne(state, p)];
    for (const r of tries) if (r.ok) out.push(r);
  }
  return out;
}
/** A state's key: its statuses, highest column first. */
export const placeValueTradeStateKey = (state: PlaceValueTradeState): string => state.problem.columns.map((p) => state.status[p]).join("");

/** Every state reachable from the start, by any taps in any order. Small: at most 3^6 (adding) or 4^6 (subtracting). */
export function placeValueTradeReachable(problem: PlaceValueTradeProblem): PlaceValueTradeState[] {
  const seen = new Map<string, PlaceValueTradeState>(), queue = [placeValueTradeStart(problem)];
  while (queue.length) {
    const s = queue.pop()!, key = placeValueTradeStateKey(s);
    if (seen.has(key)) continue;
    seen.set(key, s);
    for (const r of placeValueTradeMoves(s)) queue.push(r.state);
  }
  return [...seen.values()];
}
/** Can the child still reach a finished chart from here? (Searched, not assumed; the tests show it is always yes.) */
export function placeValueTradeCanStillFinish(state: PlaceValueTradeState, memo = new Map<string, boolean>()): boolean {
  if (placeValueTradeComplete(state)) return true;
  const key = placeValueTradeStateKey(state);
  if (memo.has(key)) return memo.get(key)!;
  memo.set(key, false);
  const ok = placeValueTradeMoves(state).some((r) => placeValueTradeCanStillFinish(r.state, memo));
  memo.set(key, ok);
  return ok;
}

export interface PlaceValueTradeRoom { carry: number; top: number; second: number; answer: number }
const ROOM_CACHE = new Map<string, PlaceValueTradeRoom>();
const problemKey = (problem: PlaceValueTradeProblem): string => `${problem.op}${problem.a}:${problem.b}@${problem.columns.join(",")}`;
/** The most disks any cell of each row can ever hold in this problem: the view reserves that much room, so nothing jumps. */
export function placeValueTradeRoomNeeded(problem: PlaceValueTradeProblem): PlaceValueTradeRoom {
  const key = problemKey(problem);
  const cached = ROOM_CACHE.get(key);
  if (cached) return { ...cached };
  const most: PlaceValueTradeRoom = { carry: 0, top: 0, second: 0, answer: 0 };
  for (const s of placeValueTradeReachable(problem)) {
    for (const p of problem.columns) {
      const c = cell(s, p);
      for (const k of Object.keys(most) as Array<keyof PlaceValueTradeRoom>) most[k] = Math.max(most[k], c[k]);
    }
  }
  if (ROOM_CACHE.size > 64) ROOM_CACHE.clear();
  ROOM_CACHE.set(key, most);
  return { ...most };
}

// ---------------------------------------------------------------- the lesson's variables

/**
 * Why a card cannot start a learner's task (a practice start), or undefined: the chart starts fresh, nothing
 * demonstrated (columns finished 0) and no column worked (every status 0). A practice that opened on a
 * demonstrated chart would open finished, the answer already in disks.
 */
export function placeValueTradeStartFault(state: PlaceValueTradeState): string | undefined {
  const finished = state.finished ?? 0;
  if (finished !== 0) return `A practice chart starts with no column demonstrated; columns finished is ${finished}`;
  for (const place of state.problem.columns) {
    if (state.status[place] !== 0) return `A practice chart starts fresh; the ${PLACE_VALUE_PLACE_ALIASES[place]} column's status is ${state.status[place]}`;
  }
  return undefined;
}

/** Two numbers, the demonstration's "columns finished", and one status per column: 3 + columns ≤ 9. */
export const placeValueTradeVariableCount = (problem: PlaceValueTradeProblem): number => 3 + problem.columns.length;

// ---------------------------------------------------------------- the program's demonstration

export type PlaceValueTradeDemoAction =
  | { kind: "down"; place: number; carried: number }
  | { kind: "trade"; place: number }
  | { kind: "break"; place: number }
  | { kind: "take"; place: number };

export interface PlaceValueTradeDemoStep {
  /** The column this step finishes. */
  place: number;
  actions: PlaceValueTradeDemoAction[];
  /** The chart before each action, then after the last: `states[i]` is what action i meets. */
  states: PlaceValueTradeState[];
  after: PlaceValueTradeState;
}

const DEMO_CACHE = new Map<string, { steps: PlaceValueTradeDemoStep[]; final: PlaceValueTradeState }>();

/**
 * One step per column, lowest first; after step k the lowest k columns are finished. Adding: bring the column
 * down (its carry comes with it), then trade its ten if it has one (the one goes to the next column's carry
 * spot). Subtracting: when the column is short, break one from the nearest column on the left that has a disk,
 * and on down through each empty column (50,003 − 2,476: 1 ten thousand → 10 thousands → … → 10 ones); then
 * take away. Throws when a step is refused (a pair the card refuses).
 */
export function placeValueTradeDemoSteps(problem: PlaceValueTradeProblem): { steps: PlaceValueTradeDemoStep[]; final: PlaceValueTradeState } {
  const key = problemKey(problem);
  const cached = DEMO_CACHE.get(key);
  if (cached) return cached;
  let state = placeValueTradeStart(problem);
  const steps: PlaceValueTradeDemoStep[] = [];
  const apply = (result: PlaceValueTradeResult) => {
    if (!result.ok) throw new Error(`demo step refused: ${result.reason}`);
    state = result.state;
  };
  for (const place of [...problem.columns].reverse()) {
    const actions: PlaceValueTradeDemoAction[] = [];
    const states: PlaceValueTradeState[] = [];
    const act = (action: PlaceValueTradeDemoAction, result: () => PlaceValueTradeResult) => { states.push(state); actions.push(action); apply(result()); };
    if (problem.op === "+") {
      act({ kind: "down", place, carried: carryInto(state, place) }, () => placeValueTradeBringDown(state, place));
      if (cell(state, place).answer >= 10) act({ kind: "trade", place }, () => placeValueTradeTradeTen(state, place));
    } else {
      if (holds(state, place) < problem.db[place]!) {
        let from = place + 1;
        while (has(state, from) && holds(state, from) === 0) from += 1;
        for (let p = from; p > place; p -= 1) act({ kind: "break", place: p }, () => placeValueTradeBreakOne(state, p));
      }
      act({ kind: "take", place }, () => placeValueTradeTakeAway(state, place));
    }
    steps.push({ place, actions, states: [...states, state], after: state });
  }
  const demo = { steps, final: state };
  if (DEMO_CACHE.size > 64) DEMO_CACHE.clear();
  DEMO_CACHE.set(key, demo);
  return demo;
}
/** The chart with the lowest k columns demonstrated: what "columns finished = k" shows. Same k, same chart. */
export function placeValueTradeDemoState(problem: PlaceValueTradeProblem, k: number): PlaceValueTradeState {
  if (!Number.isInteger(k) || k < 0 || k > problem.columns.length) throw new Error(`columns finished must be 0..${problem.columns.length}`);
  return k === 0 ? placeValueTradeStart(problem) : placeValueTradeDemoSteps(problem).steps[k - 1]!.after;
}

// ---------------------------------------------------------------- content

export interface PlaceValueTradePlace {
  /** The place's alias (`ones`, `tenths`, `hundred-thousands`): the part a binding or emphasis names. */
  as: string;
  /** 5 (hundred thousands) to -2 (hundredths). */
  place: number;
  /** The column's status (adding 0..2, subtracting 0..3); 0 at a start. */
  status: number;
}

export interface PlaceValueTradeContent {
  /** The language of the card's own words; absent means US English. */
  language?: PlaceValueLanguage;
  operation: PlaceValueTradeOperation;
  /** The card's columns, fixed for the card: from `top_place` down to `low_place` (0, -1 or -2). */
  top_place: number;
  low_place: number;
  /** The two numbers, in integer thousandths (3,486 is 3486000; 2.75 is 2750). */
  a: number;
  b: number;
  /** The demonstration: columns finished, counting from the right (0 to the number of columns). */
  finished: number;
  /** One per column, highest place first. */
  places: PlaceValueTradePlace[];
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

/** What a fault says, for the compiler's refusal (the card's capability is the write's kind). */
export function placeValueTradeFaultText(fault: PlaceValueTradeFault, operation: PlaceValueTradeOperation, a: unknown, b: unknown): string {
  const pair = readable(a) && readable(b) ? `${placeValueNumeral(a)} ${operation === "subtract" ? "−" : "+"} ${placeValueNumeral(b)}` : "This pair";
  switch (fault) {
    case "decimals": return `${pair}: a number has more than two decimals (decimals)`;
    case "negative": return `${pair} is below zero: the first number is the larger (negative)`;
    case "too_wide": {
      const { top_place, low_place } = placeValueTradeColumnsFor(operation, a as number, b as number);
      return `${pair} needs ${top_place - low_place + 1} columns; the card draws at most ${PLACE_VALUE_TRADE_MAX_COLUMNS}, up to the hundred thousands (too_wide)`;
    }
    case "no_trade": return `${pair} has no column that ${operation === "subtract" ? "borrows" : "carries"}: this card is for trading (no_trade)`;
    default: return "The numbers are whole numbers of thousandths from 0 to 999,999.99 (unreadable)";
  }
}

/**
 * Checks a card's content. With `boundValues` (the core checking the card at a value a variable can take)
 * only each field's own range is checked: the joint rules (the pair the card refuses, the pair's columns, a
 * state the rules can reach, a demonstration on a fresh chart) belong to a starting card.
 */
export function validatePlaceValueTradeContent(raw: unknown, path: string, fail: Fail, options: { boundValues?: boolean } = {}): void {
  const content = record(raw, path, fail);
  for (const key of Object.keys(content)) {
    if (!["language", "operation", "top_place", "low_place", "a", "b", "finished", "places", "bindings"].includes(key)) fail(`${path}/${key}`, `Unknown place-value trade field '${key}'`);
  }
  if (content.language !== undefined && !PLACE_VALUE_TRADE_LANGUAGES.includes(content.language as PlaceValueLanguage)) {
    fail(`${path}/language`, `The card speaks ${PLACE_VALUE_TRADE_LANGUAGES.join(" or ")}`);
  }
  const operation = content.operation as PlaceValueTradeOperation;
  if (!PLACE_VALUE_TRADE_OPERATIONS.includes(operation)) fail(`${path}/operation`, "The operation is 'add' or 'subtract'");
  // A pair the card refuses is said as the pair's fault first, before the columns it would need.
  const pairFault = options.boundValues || !readable(content.a) || !readable(content.b) ? undefined : placeValueTradeFault(operation, content.a, content.b);
  if (pairFault) {
    fail(`${path}/${pairFault === "negative" || pairFault === "no_trade" ? "b" : pairFault === "decimals" ? ((content.a as number) % 10 ? "a" : "b") : "a"}`, placeValueTradeFaultText(pairFault, operation, content.a, content.b));
  }
  const top = wholeNumber(content.top_place, `${path}/top_place`, PLACE_VALUE_TRADE_MIN_PLACE, PLACE_VALUE_TRADE_MAX_PLACE, fail, "The top place");
  const low = wholeNumber(content.low_place, `${path}/low_place`, PLACE_VALUE_TRADE_MIN_PLACE, 0, fail, "The low place");
  if (top < low) fail(`${path}/top_place`, `The top place (${top}) is below the low place (${low})`);
  const columns = placeValueTradeColumns(top, low);
  if (columns.length > PLACE_VALUE_TRADE_MAX_COLUMNS) fail(`${path}/top_place`, `The card draws at most ${PLACE_VALUE_TRADE_MAX_COLUMNS} columns; ${top} to ${low} is ${columns.length} (too_wide)`);
  const a = wholeNumber(content.a, `${path}/a`, 0, PLACE_VALUE_TRADE_MAX_VALUE, fail, "The first number (in thousandths)");
  const b = wholeNumber(content.b, `${path}/b`, 0, PLACE_VALUE_TRADE_MAX_VALUE, fail, "The second number (in thousandths)");
  for (const [name, value] of [["a", a], ["b", b]] as const) {
    if (value % 10) fail(`${path}/${name}`, `${placeValueNumeral(value)} has more than two decimals (decimals)`);
    if (value > 0 && placeValueTopPlace(value) > top) fail(`${path}/${name}`, `${placeValueNumeral(value)} has a place above the card's columns`);
    if (placeValueTradeDecimals(value) > -low) fail(`${path}/${name}`, `${placeValueNumeral(value)} has a place below the card's columns`);
  }
  const finished = wholeNumber(content.finished, `${path}/finished`, 0, columns.length, fail, "The columns finished");
  if (!Array.isArray(content.places) || content.places.length !== columns.length) {
    fail(`${path}/places`, `A card of these columns lists ${columns.length} places, highest first`);
  }
  const statuses: number[] = [];
  for (const [i, item] of (content.places as unknown[]).entries()) {
    const at = `${path}/places/${i}`;
    const place = record(item, at, fail);
    for (const key of Object.keys(place)) if (!["as", "place", "status"].includes(key)) fail(`${at}/${key}`, `Unknown place-value trade field '${key}'`);
    const expected = columns[i]!;
    if (place.place !== expected) fail(`${at}/place`, `Place ${i + 1} is ${expected} (${placeValueColumnName(expected)}): places are listed highest first`);
    if (place.as !== PLACE_VALUE_PLACE_ALIASES[expected]) fail(`${at}/as`, `Place ${expected} is '${PLACE_VALUE_PLACE_ALIASES[expected]}'`);
    statuses.push(wholeNumber(place.status, `${at}/status`, 0, placeValueTradeMaxStatus(operation), fail, `The status of the ${placeValueColumnName(expected).toLowerCase()}`));
  }
  if (options.boundValues) return;
  // The card draws only the columns its numbers need (0026 §2): a practice pair is of the same shape as the lesson's.
  const need = placeValueTradeColumnsFor(operation, a, b);
  if (need.top_place !== top || need.low_place !== low) {
    fail(`${path}/top_place`, `${placeValueNumeral(a)} ${operation === "subtract" ? "−" : "+"} ${placeValueNumeral(b)} needs the columns from ${placeValueColumnName(need.top_place).toLowerCase()} to ${placeValueColumnName(need.low_place).toLowerCase()}; the card draws ${placeValueColumnName(top).toLowerCase()} to ${placeValueColumnName(low).toLowerCase()}`);
  }
  if (finished > 0 && statuses.some((status) => status !== 0)) {
    fail(`${path}/finished`, "A demonstration (columns finished) plays on a fresh chart: every column's status is 0");
  }
  const problem = placeValueTradeProblemOn(operation, a, b, columns);
  const key = statuses.join("");
  if (!placeValueTradeReachable(problem).some((state) => placeValueTradeStateKey(state) === key)) {
    fail(`${path}/places`, `No taps make these column statuses (${key}) from the start of ${placeValueTradeProblemText(problem)}`);
  }
}

/** The card's language from its content: Chinese when it says so, else US English. */
export const placeValueTradeLanguage = (raw: unknown): PlaceValueLanguage => placeValueLanguage(raw);

/**
 * The card a content describes, as the rules hold it (what it draws and taps act on). Total: any content gives a
 * state. Numbers are taken to whole hundredths in range, statuses to whole numbers in range, and "columns
 * finished" to a whole number of columns reached so far (a demonstration animating 0 -> 2 shows each column in
 * turn). When it is above 0 the chart is the demonstration's at that many columns (the statuses are then all 0).
 */
export function placeValueTradeState(raw: unknown): PlaceValueTradeState & { finished: number } {
  const content = (raw ?? {}) as Partial<PlaceValueTradeContent>;
  const operation: PlaceValueTradeOperation = content.operation === "subtract" ? "subtract" : "add";
  const int = (value: unknown, low: number, high: number, fallback = low) => (typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.floor(value + 1e-9))) : fallback);
  const low = int(content.low_place, PLACE_VALUE_TRADE_MIN_PLACE, 0, 0);
  const top = Math.max(low, int(content.top_place, PLACE_VALUE_TRADE_MIN_PLACE, PLACE_VALUE_TRADE_MAX_PLACE, 0));
  const columns = placeValueTradeColumns(top, low).slice(0, PLACE_VALUE_TRADE_MAX_COLUMNS);
  const problem = placeValueTradeProblemOn(operation, Number(content.a), Number(content.b), columns);
  const places = Array.isArray(content.places) ? content.places : [];
  const max = placeValueTradeMaxStatus(operation);
  const status = Object.fromEntries(columns.map((place) => [place, Math.min(max, Math.max(0, Math.round(Number(places.find((item) => item?.place === place)?.status) || 0)))]));
  const finished = int(content.finished, 0, columns.length);
  if (finished > 0) {
    try { return { ...placeValueTradeDemoState(problem, finished), finished }; } catch { /* a pair the card refuses: its statuses */ }
  }
  return { problem, status, finished };
}

/** The fields one tap changes, as content values: each column (place) to its new status. */
export function placeValueTradeChanges(before: PlaceValueTradeState, after: PlaceValueTradeState): Array<{ place: number; field: "status"; before: number; after: number }> {
  return after.problem.columns.filter((place) => after.status[place] !== before.status[place])
    .map((place) => ({ place, field: "status" as const, before: before.status[place]!, after: after.status[place]! }));
}

/** Facts for a task, and for the lesson's later sections (decision 0026 §5). */
export interface PlaceValueTradeFacts {
  /** The value of the disks on the chart, in thousandths (adding: always a + b). */
  value: number;
  /** Subtracting: what has been taken away so far, in thousandths. */
  taken: number;
  /** Columns finished, counting from the right. */
  finished: number;
  /** Every column finished: the answer row reads the answer in disks (a task's typed answer opens). */
  complete: boolean;
  /** The next value of "columns finished" and the column it would finish; absent when every column is. */
  next?: { finished: number; place: number };
  /** The chart as it stands, highest column first. */
  cells: Array<{ place: number } & PlaceValueTradeCell>;
}

/** Facts a task reads, and what a later section is told about the card. */
export function placeValueTradeFacts(state: PlaceValueTradeState): PlaceValueTradeFacts {
  const finished = placeValueTradeFinishedCount(state);
  const columns = state.problem.columns;
  const place = columns[columns.length - 1 - finished];
  return {
    value: placeValueTradeChartValue(state),
    taken: placeValueTradeTakenValue(state),
    finished,
    complete: placeValueTradeComplete(state),
    ...(place !== undefined ? { next: { finished: finished + 1, place } } : {}),
    cells: columns.map((p) => ({ place: p, ...cell(state, p) })),
  };
}

// ---------------------------------------------------------------- words (sketch page.js, ported)

const ZH_ONE: Record<number, string> = { 5: "十万", 4: "一万", 3: "一千", 2: "一百", 1: "十", 0: "一", [-1]: "0.1", [-2]: "0.01" }; // 「一个标出的一万」
/** "tens, hundreds and thousands" / 「十位、百位和千位」 */
function list(items: readonly string[], zh: boolean): string {
  if (items.length < 2) return items.join("");
  return zh ? `${items.slice(0, -1).join("、")}和${items.at(-1)}` : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The card's own words, whole sentences per language: never a word put into another language's sentence. */
export const PLACE_VALUE_TRADE_WORDS = {
  "en-US": {
    chartLabel: "Adding and subtracting on a place-value chart",
    point: "Decimal point",
    howto: {
      add: "Tap ↓ to put a column together.", ring: (hi: string) => `Tap the ringed ten to trade it for one ${hi}.`, addDone: "Type the total below.",
      sub: "Tap ↓ to take away. Short? Break a disk from a column to the left into ten.", marked: (hi: string, lo: string) => `Tap a marked ${hi} to break it into ten ${lo}s.`, subDone: "Type the difference below.",
    },
    total: "Total:", difference: "Difference:",
    askSum: "What is the total?", askDiff: "What is left?",
    downAdd: (name: string) => `Put the ${name.toLowerCase()} together below the line`,
    downSub: (name: string) => `Take away in the ${name.toLowerCase()}`,
    tenAdd: (lo: string, hi: string) => `Ten ${lo}s: trade them for one ${hi}`,
    diskBreak: (u: string) => `Break this ${u} into ten`,
    refusal: {
      already_down: "This column is already below the line.",
      not_ten: "Fewer than ten here.",
      nothing_yet: "Nothing below the line here yet.",
      no_left: "There is no column to the left on this chart.",
      no_right: "There is no column to the right to break into.",
      none_to_break: (u: string) => `There is no ${u} to break.`,
      empty: "This column is empty.",
      not_needed: (name: string, n: number, k: number) => `The ${name.toLowerCase()} have ${n}; taking away ${k} needs no more.`,
      not_needed_taken: (name: string) => `The ${name.toLowerCase()} are already taken away.`,
      already_taken: "This column's take-away is done.",
      demonstrating: "This chart shows the demonstration's columns.",
      not_enough: (n: number, k: number) => `This column has ${n}; taking away ${k} needs more.`,
    },
    other: "That can't be done here.",
    demo: {
      together: (step: string) => `${step}: put both rows together.`,
      togetherCarry: (step: string, hi: string) => `${step}: put both rows together, with the carried ${hi}.`,
      carryOnly: (step: string, hi: string) => `${step}: bring the carried ${hi} down.`,
      nothingHere: (step: string) => `${step}: no disks in either row.`,
      trade: (lo: string, hi: string, next: string) => `Ten ${lo}s make one ${hi}. It goes above the ${next.toLowerCase()}.`,
      brkFirst: (step: string, k: number, empties: string[], hi: string, lo: string) => `${step}: not enough to take away ${k}. ` + (empties.length
        ? `The ${list(empties.map((n) => n.toLowerCase()), false)} ${empties.length > 1 ? "are" : "is"} empty, so break one ${hi} into ten ${lo}s.`
        : `Break one ${hi} into ten ${lo}s.`),
      brkNext: (hi: string, lo: string) => `Break one ${hi} into ten ${lo}s.`,
      take: (step: string, k: number) => `${step}: take away ${k}.`,
      nothing: (step: string) => `${step}: nothing to take away.`,
    },
  },
  "zh-CN": {
    chartLabel: "在数位表上加减",
    point: "小数点",
    howto: {
      add: "点 ↓ 把一位合在一起。", ring: (hi: string) => `点圈起来的十个，换成一个${hi}。`, addDone: "在下面写出和。",
      sub: "点 ↓ 拿走。不够时，把左边某一位的一个圆片拆成十个。", marked: (hi: string, lo: string) => `点一个标出的${hi}，把它拆成十个${lo}。`, subDone: "在下面写出差。",
    },
    total: "和：", difference: "差：",
    askSum: "一共是多少？", askDiff: "还剩多少？",
    downAdd: (name: string) => `把${name}合到横线下面`,
    downSub: (name: string) => `在${name}拿走`,
    tenAdd: (lo: string, hi: string) => `十个${lo}：换成一个${hi}`,
    diskBreak: (u: string) => `把这个${u}拆成十个`,
    refusal: {
      already_down: "这一位已经在横线下面了。",
      not_ten: "这里不满十个。",
      nothing_yet: "这一位横线下面还没有圆片。",
      no_left: "这张表上左边没有数位了。",
      no_right: "右边没有数位可以拆进去。",
      none_to_break: (u: string) => `没有${u}可以拆开。`,
      empty: "这一位没有圆片。",
      not_needed: (name: string, n: number, k: number) => `${name}有 ${n} 个，拿走 ${k} 个已经够了。`,
      not_needed_taken: (name: string) => `${name}已经拿走了。`,
      already_taken: "这一位已经拿走了。",
      demonstrating: "这张表是演示。",
      not_enough: (n: number, k: number) => `这一位只有 ${n} 个，拿走 ${k} 个不够。`,
    },
    other: "这里不能这样做。",
    demo: {
      together: (step: string) => `${step}：把两行合在一起。`,
      togetherCarry: (step: string, hi: string) => `${step}：把两行和进上来的一个${hi}合在一起。`,
      carryOnly: (step: string, hi: string) => `${step}：把进上来的一个${hi}移下来。`,
      nothingHere: (step: string) => `${step}：两行都没有圆片。`,
      trade: (lo: string, hi: string, next: string) => `十个${lo}换成一个${hi}，放到${next}上面。`,
      brkFirst: (step: string, k: number, empties: string[], hi: string, lo: string) => `${step}：不够拿走 ${k} 个。` + (empties.length
        ? `${list(empties, true)}${empties.length > 1 ? "都" : ""}没有圆片，所以把一个${hi}拆成十个${lo}。`
        : `把一个${hi}拆成十个${lo}。`),
      brkNext: (hi: string, lo: string) => `把一个${hi}拆成十个${lo}。`,
      take: (step: string, k: number) => `${step}：拿走 ${k} 个。`,
      nothing: (step: string) => `${step}：不用拿走。`,
    },
  },
} as const;

/** How to work the card, in its language, for its operation: fixed text a host shows with a task on the card. */
export function placeValueTradeHowTo(raw: unknown): string {
  const words = PLACE_VALUE_TRADE_WORDS[placeValueTradeLanguage(raw)];
  return (raw as { operation?: unknown } | null)?.operation === "subtract" ? words.howto.sub : words.howto.add;
}

/**
 * The one-line instruction on the card, which follows the chart and names only what is on it (0026 §2): a
 * ringed ten to trade, the disks marked for a short column (`short`: the column whose take-away was refused),
 * or, finished, the answer to type.
 */
export function placeValueTradeInstruction(state: PlaceValueTradeState, language: PlaceValueLanguage = "en-US", short?: number): string {
  const h = PLACE_VALUE_TRADE_WORDS[language].howto, { problem } = state;
  if (placeValueTradeComplete(state)) return problem.op === "+" ? h.addDone : h.subDone;
  if (problem.op === "+") {
    const ring = [...problem.columns].reverse().find((p) => cell(state, p).answerRing);
    return ring === undefined ? h.add : h.ring(placeValueTradeUnitWord(ring + 1, language));
  }
  const q = short === undefined ? undefined : placeValueTradeBreakSource(state, short);
  if (q === undefined) return h.sub;
  return language === "en-US" ? h.marked(placeValueTradeUnitWord(q, language), placeValueTradeUnitWord(q - 1, language)) : h.marked(ZH_ONE[q]!, ZH_ONE[q - 1]!);
}

/**
 * What the card says when a tap is refused, in its language: a fact, never an instruction (counts included:
 * "This column has 3; taking away 6 needs more.").
 */
export function placeValueTradeRefusalText(state: PlaceValueTradeState, tap: PlaceValueTradeTap, language: PlaceValueLanguage = "en-US"): string {
  const words = PLACE_VALUE_TRADE_WORDS[language] ?? PLACE_VALUE_TRADE_WORDS["en-US"];
  const result = applyPlaceValueTradeTap(state, tap);
  if (result.ok) return "";
  const r = words.refusal;
  switch (result.reason) {
    case "not_enough": return r.not_enough(result.have!, result.need!);
    case "none_to_break": return cell(state, tap.place).top + cell(state, tap.place).answer ? r.none_to_break(placeValueTradeUnitWord(tap.place, language)) : r.empty;
    case "not_needed": return result.taken ? r.not_needed_taken(placeValueColumnName(result.right!, language)) : r.not_needed(placeValueColumnName(result.right!, language), result.have!, result.need!);
    case "not_down": return r.nothing_yet;
    case "already_down": case "not_ten": case "no_left": case "no_right": case "already_taken": case "demonstrating": return r[result.reason];
    default: return words.other;
  }
}

/** Where a refusal is said: the column it is about (a "not needed" break is about the column on the right). */
export function placeValueTradeRefusalPlace(state: PlaceValueTradeState, tap: PlaceValueTradeTap): number | undefined {
  const result = applyPlaceValueTradeTap(state, tap);
  if (result.ok) return undefined;
  return result.reason === "not_needed" ? result.right : has(state, tap.place) ? tap.place : undefined;
}

/**
 * What step k of the demonstration does (1 to the number of columns), in the card's language, one sentence per
 * action: for a lesson's later sections, which narrate the chart the program animates. Never drawn on the card.
 */
export function placeValueTradeStepSentences(problem: PlaceValueTradeProblem, k: number, language: PlaceValueLanguage = "en-US"): string[] {
  const dm = PLACE_VALUE_TRADE_WORDS[language].demo;
  const step = placeValueTradeDemoSteps(problem).steps[k - 1];
  if (!step) return [];
  const u = (place: number) => placeValueTradeUnitWord(place, language);
  const name = (place: number) => placeValueColumnName(place, language);
  const head = name(step.place);
  const sentences: string[] = [];
  let firstBreak = true;
  step.actions.forEach((action, i) => {
    const before = step.states[i]!;
    if (action.kind === "down") {
      const v = cell(before, step.place);
      const empty = v.top + v.second === 0;
      sentences.push(action.carried ? (empty ? dm.carryOnly(head, u(step.place)) : dm.togetherCarry(head, u(step.place))) : (empty ? dm.nothingHere(head) : dm.together(head)));
    } else if (action.kind === "trade") {
      sentences.push(dm.trade(u(action.place), u(action.place + 1), name(action.place + 1)));
    } else if (action.kind === "break") {
      if (firstBreak) {
        // The columns between the short one and the one broken from are empty: say so, so the chain makes sense.
        const empties: string[] = [];
        for (let q = step.place + 1; q < action.place; q += 1) empties.push(name(q));
        sentences.push(dm.brkFirst(head, problem.db[step.place]!, empties, u(action.place), u(action.place - 1)));
        firstBreak = false;
      } else sentences.push(dm.brkNext(u(action.place), u(action.place - 1)));
    } else {
      sentences.push(problem.db[step.place] ? dm.take(head, problem.db[step.place]!) : dm.nothing(head));
    }
  });
  return sentences;
}

// ---------------------------------------------------------------- plan

export interface PlaceValueTradeBox { x: number; y: number; width: number; height: number }

export type PlaceValueTradeRow = "carry" | "top" | "second" | "answer";

/** A column of the card: its head, its strip, a cell per row, and the ↓ on the sum line. */
export interface PlaceValueTradeColumnPlan {
  place: number;
  x: number;
  width: number;
  head: string[];
  strip: PlaceValueTradeBox;
  cells: Partial<Record<PlaceValueTradeRow, PlaceValueTradeBox>>;
  down: { x: number; y: number; r: number };
  diskLabel: string;
  fill: string;
}

export interface PlaceValueTradePlan {
  width: number;
  height: number;
  /** A disk's diameter, gap between disks and a cell's padding (by the number of columns: 34, 28 or 24). */
  disk: number;
  gap: number;
  pad: number;
  /** The room each row keeps (disks), so the card never grows while it is worked. */
  room: PlaceValueTradeRoom;
  /** The row labels at the left edge: the two numbers as a written problem ("3,486" / "+ 2,739"). */
  labels: Array<{ row: "top" | "second"; op: string; text: string; x: number; y: number; size: number }>;
  /** The sum line across the card. */
  rule: { x1: number; x2: number; y: number };
  columns: PlaceValueTradeColumnPlan[];
  /** The decimal point's dots, between the ones and the tenths. */
  points: Array<{ x: number; y: number }>;
}

const SIZES: Record<4 | 5 | 6, { D: number; g: number; cp: number; cg: number; pw: number; lab: number }> = {
  4: { D: 34, g: 4, cp: 6, cg: 8, pw: 14, lab: 22 },
  5: { D: 28, g: 3, cp: 5, cg: 8, pw: 14, lab: 21 },
  6: { D: 24, g: 2, cp: 3, cg: 5, pw: 10, lab: 19 },
};
const EDGE_X = 12;
const EDGE_TOP = 10;
const EDGE_BOTTOM = 14;
const HEAD = 38;
const LINE = 48;
const DOWN_R = 20;
/** The answer row is never lower than this, so a fact said at a column fits in its empty answer cell. */
const NOTE_ROOM = 64;
/** Room above a cell that may show a ringed ten, for its badge, and around the ring. */
const RING_TOP = 22;
const RING_EXTRA = 16;
/** Disks to a line in a cell. */
export const PLACE_VALUE_TRADE_PER_LINE = 5;

const lines = (n: number): number => Math.max(1, Math.ceil(n / PLACE_VALUE_TRADE_PER_LINE));

/**
 * The card's layout, from the sketch: a head per column; then, top to bottom, the carry spot (adding), row 1,
 * row 2, the sum line with a ↓ under each column, and the answer row; the two numbers written at the left edge
 * like a written problem; the decimal point between the ones and the tenths. Disks are 34, 28 or 24 px for up
 * to four, five or six columns. Each cell keeps from the start the room it can ever need in this problem, so
 * the card never grows while it is worked; only a new pair (a practice task's) can change it.
 */
export function planPlaceValueTrade(raw: unknown): PlaceValueTradePlan {
  const content = (raw ?? {}) as Partial<PlaceValueTradeContent>;
  const language = placeValueTradeLanguage(content);
  const { problem } = placeValueTradeState(content);
  const columns = problem.columns;
  const size = SIZES[Math.min(6, Math.max(4, columns.length)) as 4 | 5 | 6];
  const { D, g, cp, cg, pw, lab } = size;
  const colw = PLACE_VALUE_TRADE_PER_LINE * D + (PLACE_VALUE_TRADE_PER_LINE - 1) * g + 2 * cp;
  let room: PlaceValueTradeRoom;
  try {
    room = placeValueTradeFault(problem.operation, problem.a, problem.b) ? { carry: 1, top: 18, second: 9, answer: 19 } : placeValueTradeRoomNeeded(problem);
  } catch {
    room = { carry: 1, top: 18, second: 9, answer: 19 };
  }
  const add = problem.op === "+";
  const cellHeight = (n: number) => 2 * cp + lines(n) * D + (lines(n) - 1) * g + (n >= 10 ? RING_TOP + RING_EXTRA : 0);
  const textA = placeValueTradeNumeralFixed(problem.a, problem.dec, language);
  const textB = placeValueTradeNumeralFixed(problem.b, problem.dec, language);
  // The labels are set in tabular figures: under 0.6 em a character, with the operator and a space.
  const labelWidth = Math.ceil((Math.max(textA.length, textB.length) + 1.2) * lab * 0.58) + 6;
  const left = EDGE_X + labelWidth;
  const pointAt = columns.indexOf(-1);
  const xOf = (k: number) => left + k * (colw + cg) + (pointAt !== -1 && k >= pointAt ? pw + cg : 0);
  const width = xOf(columns.length - 1) + colw + EDGE_X;
  const headTop = EDGE_TOP;
  let y = headTop + HEAD;
  const rowTop: Partial<Record<PlaceValueTradeRow, number>> = {};
  const rowHeight: Partial<Record<PlaceValueTradeRow, number>> = {};
  if (add) { rowTop.carry = y; rowHeight.carry = D + 8; y += D + 8; }
  rowTop.top = y; rowHeight.top = cellHeight(room.top); y += rowHeight.top;
  rowTop.second = y; rowHeight.second = cellHeight(room.second); y += rowHeight.second;
  const lineY = y + LINE / 2;
  y += LINE;
  rowTop.answer = y + 6; rowHeight.answer = Math.max(NOTE_ROOM, cellHeight(room.answer) + 4); y += 6 + rowHeight.answer + 2;
  const height = y + EDGE_BOTTOM;
  const plans: PlaceValueTradeColumnPlan[] = columns.map((place, k) => {
    const x = xOf(k);
    const name = placeValueColumnName(place, language);
    const cells: Partial<Record<PlaceValueTradeRow, PlaceValueTradeBox>> = {};
    for (const row of (add ? ["carry", "top", "second", "answer"] : ["top", "second", "answer"]) as PlaceValueTradeRow[]) {
      cells[row] = row === "answer"
        ? { x: x + Math.min(4, cp), y: rowTop.answer!, width: colw - 2 * Math.min(4, cp), height: rowHeight.answer! }
        : { x, y: rowTop[row]!, width: colw, height: rowHeight[row]! };
    }
    const firstTop = add ? rowTop.carry! : rowTop.top!;
    return {
      place, x, width: colw,
      head: language === "en-US" && name.includes(" ") ? name.split(" ") : [name],
      strip: { x, y: firstTop, width: colw, height: y - 2 - firstTop },
      cells,
      down: { x: x + colw / 2, y: lineY, r: DOWN_R },
      diskLabel: placeValueDiskLabel(place, language),
      fill: PLACE_VALUE_FILLS[place]!,
    };
  });
  const labels: PlaceValueTradePlan["labels"] = [
    { row: "top", op: "", text: textA, x: left - 8, y: rowTop.top! + rowHeight.top! / 2, size: lab },
    { row: "second", op: add ? "+" : "−", text: textB, x: left - 8, y: rowTop.second! + rowHeight.second! / 2, size: lab },
  ];
  const points: PlaceValueTradePlan["points"] = [];
  if (pointAt !== -1) {
    const px = xOf(pointAt) - cg - pw / 2;
    for (const row of ["top", "second"] as const) points.push({ x: px, y: rowTop[row]! + rowHeight[row]! - 12 });
    points.push({ x: px, y: rowTop.answer! + D * 0.8 + 12 });
  }
  return {
    width, height, disk: D, gap: g, pad: cp, room, labels,
    rule: { x1: EDGE_X, x2: width - EDGE_X + 4, y: lineY },
    columns: plans, points,
  };
}

/**
 * Where the i-th disk of a cell lies (its centre), five to a line, a ringed ten (`ring`) taking the first two
 * lines. Given the cell's `count`, the disks of the carry spot and rows 1 and 2 are centred in their cell, as
 * the sketch draws them; the answer row fills from its top.
 */
export function placeValueTradeDiskAt(plan: PlaceValueTradePlan, place: number, row: PlaceValueTradeRow, index: number, ring = false, count?: number): { x: number; y: number } {
  const column = plan.columns.find((candidate) => candidate.place === place)!;
  const box = column.cells[row] ?? column.cells.top!;
  const { disk: D, gap: g, pad } = plan;
  const roomy = (plan.room[row] ?? 0) >= 10;
  let top = box.y + pad + (roomy ? RING_TOP : 0) + (row === "answer" ? 4 : 0);
  if (row !== "answer" && count !== undefined && count > 0) {
    const used = lines(count) * D + (lines(count) - 1) * g + (ring ? RING_EXTRA : 0);
    top += Math.max(0, (box.y + box.height - pad - top - used) / 2);
  }
  const lineOf = Math.floor(index / PLACE_VALUE_TRADE_PER_LINE);
  // A ringed ten sits inside its ring's margin; the rest sit below the ring, past both margins.
  const shift = ring ? (index >= 10 ? RING_EXTRA : RING_EXTRA / 2) : 0;
  const x0 = box.x + (box.width - (PLACE_VALUE_TRADE_PER_LINE * D + (PLACE_VALUE_TRADE_PER_LINE - 1) * g)) / 2;
  return { x: x0 + (index % PLACE_VALUE_TRADE_PER_LINE) * (D + g) + D / 2, y: top + shift + lineOf * (D + g) + D / 2 };
}

/** The font size a disk label fits at: the sketch's three sizes, by the label's length. */
export function placeValueTradeDiskFont(label: string, disk: number): number {
  return label.length >= 5 ? disk * 0.25 : label.length >= 4 ? disk * 0.31 : disk * 0.4;
}
