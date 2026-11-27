/**
 * Making ten to add on two ten frames (decision 0027, need K2N-19, 1.OA.C.6 "8 + 6 = 8 + 2 + 4 = 10 + 4 = 14"):
 * a `make_ten` card of the math plugin.
 *
 * The content states two addends (1 to 9, sum more than ten). Frame 0 holds the first addend's counters (red),
 * frame 1 the second's (blue). The frame that fills is always the bigger addend's (the first when they are
 * equal), shown from the start: only it has dashed empty places. The smaller addend gives: a giver's counter
 * tapped at home crosses into the next empty place of the bigger frame; a counter that crossed, tapped, goes
 * home. The bigger frame's own counters stay ("Red counters stay in their frame."). A frame has ten places (the
 * trading mat's tray rule, 0023), so the card is finished when the bigger frame holds ten: the sum reads as ten
 * and the ones left, and a row of four blanks anchored on the card asks `8 + 6 = 8 + __ + __ = 10 + __ = __`.
 *
 * The whole state of the card is one count, `moved` (the giver's counters now in the bigger frame, 0 at a
 * start). A demonstration moves through another number, `filled`, the count in the bigger frame: it starts at
 * the bigger addend, taken from the pair, never 0 (8 + 6 starts at 8), and the program moves one counter at a
 * time until it reaches the target (10, or a partial stop such as 9). While a demonstration shows (`filled`
 * above the bigger addend) the card refuses every tap, and a practice card starts fresh: `filled` at its own
 * pair's bigger addend and `moved` at 0 (as decision 0026 keeps "columns finished" apart from the statuses).
 *
 * The rules are ported from the accepted sketch (handoff `runs/early-number/K2N-19/sketch/model.mjs`); the
 * typed row is the player's `numeric_row`, so the sketch's own reader is not ported. The language is read as
 * the trading mat reads it. Every text the card shows is computed here, never written by a model. This module
 * imports only the mat's module, so the core validator, the reducer and the web runtime can all load it
 * (decision 0013 §3).
 */
import { BASE_TEN_TRADE_LANGUAGES, baseTenLanguage, type BaseTenLanguage } from "./base-ten-trade.js";

export const MAKE_TEN_KIND = "make_ten";
export const MAKE_TEN_FEATURE = "plugin:math/make-ten@1";
/** The math plugin version that introduced the card. */
export const MAKE_TEN_PLUGIN_VERSION = "0.10.0";
/** The languages the card speaks: the mat's. A card without `language` speaks US English. */
export const MAKE_TEN_LANGUAGES = BASE_TEN_TRADE_LANGUAGES;
export type MakeTenLanguage = BaseTenLanguage;

/** Places in one ten frame. */
export const MAKE_TEN_PLACES = 10;
export const MAKE_TEN_MIN_ADDEND = 1;
export const MAKE_TEN_MAX_ADDEND = 9;
/** The most counters that ever cross: 6 + 5 moves 4 (the bigger addend is at least 6 when the sum passes ten). */
export const MAKE_TEN_MAX_MOVED = 4;
/** A lesson holds at most 16 variables (OLL); this card binds 4. */
export const MAKE_TEN_MAX_VARIABLES = 16;

/** Every field a lesson variable may drive, each by its bare name (no part): the pair, the demonstration, the taps' count. */
export const MAKE_TEN_CARD_BINDINGS = ["a", "b", "filled", "moved"] as const;
/** The card-level fields taps never change: the pair and the demonstration's count. */
export const MAKE_TEN_CARD_FIELDS = ["a", "b", "filled"] as const;
/** The card-level fields that make the task's own problem: a practice pair differs from the lesson's as a pair. */
export const MAKE_TEN_PROBLEM_FIELDS = ["a", "b"] as const;
/** The field the learner's taps change: the giver's counters now in the bigger frame. */
export const MAKE_TEN_TAP_FIELD = "moved";
/** The card has no addressable parts. */
export const MAKE_TEN_PART_FIELDS = [] as const;
/** A tap's place is the frame tapped: 0 the first addend's, 1 the second's. */
export const MAKE_TEN_TAP_PLACES = ["first", "second"] as const;
/** The taps a learner makes: a counter in its own frame (`give`), or one that crossed (`back`). */
export const MAKE_TEN_TAPS = ["give", "back"] as const;
export type MakeTenTapKind = typeof MAKE_TEN_TAPS[number];

// ---------------------------------------------------------------- problems

export interface MakeTenProblem {
  a: number;
  b: number;
  sum: number;
  /** The ones left once the ten is made. */
  left: number;
  /** The frame that fills: the bigger addend's, the first when they are equal. */
  big: 0 | 1;
}

/** The pair's fault: an addend outside 1–9, a sum below ten (no ten to make), or exactly ten (partners of ten, K2N-11). */
export type MakeTenFault = "unreadable" | "not_one_digit" | "under_ten" | "exactly_ten";

/** Why the card refuses this pair, or undefined. The card's shape in one line: two numbers from 1 to 9 whose sum is more than ten. */
export function makeTenFault(a: unknown, b: unknown): MakeTenFault | undefined {
  if (typeof a !== "number" || typeof b !== "number" || !Number.isInteger(a) || !Number.isInteger(b)) return "unreadable";
  if (a < MAKE_TEN_MIN_ADDEND || a > MAKE_TEN_MAX_ADDEND || b < MAKE_TEN_MIN_ADDEND || b > MAKE_TEN_MAX_ADDEND) return "not_one_digit";
  if (a + b < MAKE_TEN_PLACES) return "under_ten";
  if (a + b === MAKE_TEN_PLACES) return "exactly_ten";
  return undefined;
}

/** A pair as the card holds it (also a pair it refuses: the state stays total). */
export function makeTenProblemOf(a: number, b: number): MakeTenProblem {
  return { a, b, sum: a + b, left: a + b - MAKE_TEN_PLACES, big: a >= b ? 0 : 1 };
}

/** The sketch's `makeProblem`: the pair, or the fault the card refuses it for. */
export function makeTenMakeProblem(a: unknown, b: unknown): MakeTenProblem | { fault: MakeTenFault } {
  const fault = makeTenFault(a, b);
  return fault ? { fault } : makeTenProblemOf(a as number, b as number);
}

export const makeTenAddend = (problem: MakeTenProblem, frame: number): number => (frame === 0 ? problem.a : problem.b);
/** The frame that fills (the bigger addend's) and the frame that gives. */
export const makeTenFilling = (problem: MakeTenProblem): 0 | 1 => problem.big;
export const makeTenGiver = (problem: MakeTenProblem): 0 | 1 => (problem.big === 0 ? 1 : 0);
/** The count in the bigger frame on a fresh card: the bigger addend, taken from the pair. A demonstration starts here. */
export const makeTenFreshCount = (a: number, b: number): number => Math.max(a, b);
/** How many counters cross to make the ten: 10 minus the bigger addend. */
export const makeTenToTen = (problem: MakeTenProblem): number => MAKE_TEN_PLACES - makeTenAddend(problem, problem.big);
/** "8 + 6". */
export const makeTenProblemText = (problem: MakeTenProblem): string => `${problem.a} + ${problem.b}`;

/** The practice pair fits the same shape and differs from the lesson's (in either order). */
export function makeTenPracticeFault(problem: MakeTenProblem, a: unknown, b: unknown): MakeTenFault | "same_pair" | undefined {
  const fault = makeTenFault(a, b);
  if (fault) return fault;
  return (a === problem.a && b === problem.b) || (a === problem.b && b === problem.a) ? "same_pair" : undefined;
}

// ---------------------------------------------------------------- state

export interface MakeTenState {
  problem: MakeTenProblem;
  /** The giver's counters now in the bigger frame: 0 at a start, up to 10 minus the bigger addend. */
  moved: number;
  /** The demonstration's count in the bigger frame (the bigger addend when nothing is demonstrated). */
  filled?: number;
}

export function makeTenStart(problem: MakeTenProblem): MakeTenState {
  return { problem, moved: 0, filled: makeTenAddend(problem, problem.big) };
}

export interface MakeTenFrame {
  /** Its own counters still at home. */
  home: number;
  /** Counters that crossed from the other frame. */
  visitors: number;
  count: number;
  empty: number;
}

/** What one frame holds. */
export function makeTenFrame(state: MakeTenState, frame: number): MakeTenFrame {
  const { problem, moved } = state;
  const filling = frame === problem.big;
  const home = makeTenAddend(problem, frame) - (filling ? 0 : moved);
  const visitors = filling ? moved : 0;
  return { home, visitors, count: home + visitors, empty: MAKE_TEN_PLACES - home - visitors };
}

/** The frame that holds ten, or -1. */
export function makeTenFullFrame(state: MakeTenState): number {
  for (const frame of [0, 1]) if (makeTenFrame(state, frame).count === MAKE_TEN_PLACES) return frame;
  return -1;
}
/** The ten is made: the bigger frame holds ten. There is no "I'm done". */
export const makeTenComplete = (state: MakeTenState): boolean => makeTenFullFrame(state) !== -1;
/** Every counter on the card: always a + b. */
export const makeTenTotal = (state: MakeTenState): number => makeTenFrame(state, 0).count + makeTenFrame(state, 1).count;
/** The count in the bigger frame (the demonstration's number). */
export const makeTenCount = (state: MakeTenState): number => makeTenFrame(state, state.problem.big).count;
/** A demonstration shows: the bigger frame holds more than its own addend through `filled`. */
export const makeTenDemonstrating = (state: MakeTenState): boolean => (state.filled ?? makeTenAddend(state.problem, state.problem.big)) > makeTenAddend(state.problem, state.problem.big);

// ---------------------------------------------------------------- taps

/** One learner tap: a counter in frame `place` (0 or 1), in its own frame (`give`) or one that crossed (`back`). */
export interface MakeTenTap { tap: MakeTenTapKind; place: number }

/**
 * Refusals are facts: `stays` (a counter of the filling frame's own colour stays in its frame), `none` (no such
 * counter there), `demonstrating` (the frames show the demonstration). `full` (the filling frame has no empty
 * place) is a guard only: it holds ten only when the card is finished, and then its task has ended.
 */
export type MakeTenRefusal = "stays" | "none" | "full" | "demonstrating";
export type MakeTenResult = { ok: true; state: MakeTenState; to: number } | { ok: false; reason: MakeTenRefusal };

const withMoved = (state: MakeTenState, moved: number): MakeTenState => ({ ...state, moved });

/** The sketch's `tap`: a counter at home crosses to the other frame; a counter that crossed goes home. */
export function applyMakeTenTap(state: MakeTenState, tap: MakeTenTap): MakeTenResult {
  const f = tap.place;
  if (f !== 0 && f !== 1) return { ok: false, reason: "none" };
  if (makeTenDemonstrating(state)) return { ok: false, reason: "demonstrating" };
  const here = makeTenFrame(state, f), other = makeTenFrame(state, 1 - f);
  if (tap.tap === "back") {
    if (!here.visitors) return { ok: false, reason: "none" };
    return { ok: true, state: withMoved(state, state.moved - 1), to: 1 - f };
  }
  if (!here.home) return { ok: false, reason: "none" };
  if (f === state.problem.big) return { ok: false, reason: "stays" };
  if (!other.empty) return { ok: false, reason: "full" };
  return { ok: true, state: withMoved(state, state.moved + 1), to: 1 - f };
}

/** Every state reachable from the start, by any taps in any order: one per count, 0 to 10 minus the bigger addend. */
export function makeTenReachable(problem: MakeTenProblem): MakeTenState[] {
  const seen = new Map<number, MakeTenState>();
  const queue = [makeTenStart(problem)];
  seen.set(0, queue[0]!);
  while (queue.length) {
    const state = queue.shift()!;
    for (const tap of MAKE_TEN_TAPS) for (const place of [0, 1]) {
      const result = applyMakeTenTap(state, { tap, place });
      if (result.ok && !seen.has(result.state.moved)) { seen.set(result.state.moved, result.state); queue.push(result.state); }
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- the demonstration ("filled", from the pair's bigger addend)

/** Why a demonstration target for `filled` is refused, from `from`: not whole, past ten, below the bigger addend, or backward. */
export function makeTenDemoTargetFault(problem: MakeTenProblem, from: number, target: number): "not_whole" | "past_ten" | "below_start" | "backward" | undefined {
  if (!Number.isInteger(target)) return "not_whole";
  if (target > MAKE_TEN_PLACES) return "past_ten";
  if (target < makeTenAddend(problem, problem.big)) return "below_start";
  if (target < from) return "backward";
  return undefined;
}

/** The card a demonstration count shows: that many counters in the bigger frame, the rest left in the giver's. */
export function makeTenDemoState(problem: MakeTenProblem, filled: number): MakeTenState {
  const start = makeTenAddend(problem, problem.big);
  if (!Number.isInteger(filled) || filled < start || filled > MAKE_TEN_PLACES) throw new Error(`filled must be ${start}..${MAKE_TEN_PLACES}`);
  return { problem, moved: filled - start, filled };
}

/** The taps that take the card from `from` to `to` counters in the bigger frame, one counter at a time. */
export function makeTenDemoTaps(problem: MakeTenProblem, from: number, to: number): MakeTenTap[] {
  const fault = makeTenDemoTargetFault(problem, from, to);
  if (fault) throw new Error(`demonstration target refused: ${fault}`);
  return Array.from({ length: to - from }, () => ({ tap: "give" as const, place: makeTenGiver(problem) }));
}

// ---------------------------------------------------------------- the written chain (a row of four blanks)

export type MakeTenChainToken = string | { n: number; frame?: number; ten?: true } | { blank: number; part: "moved" | "left" | "total"; value: number; giver: number | null };

/**
 * The chain with the bigger frame as the ten. Filling frame 0 (8 + 6): 8 + 6 = 8 + [2] + [4] = 10 + [4] = [14].
 * Filling frame 1 (3 + 8): 3 + 8 = [1] + [2] + 8 = [1] + 10 = [11]. The "moved" blank sits beside the bigger
 * addend and makes ten with it.
 */
export function makeTenChain(problem: MakeTenProblem): MakeTenChainToken[] {
  const ten = problem.big, giver = makeTenGiver(problem), moved = makeTenToTen(problem), left = problem.left;
  let k = 0;
  const blank = (part: "moved" | "left" | "total", value: number) => ({ blank: k++, part, value, giver: part === "total" ? null : giver });
  const head: MakeTenChainToken[] = [{ n: problem.a, frame: 0 }, "+", { n: problem.b, frame: 1 }, "="];
  if (ten === 0) return [...head, { n: problem.a, frame: 0 }, "+", blank("moved", moved), "+", blank("left", left), "=", { n: MAKE_TEN_PLACES, ten: true }, "+", blank("left", left), "=", blank("total", problem.sum)];
  return [...head, blank("left", left), "+", blank("moved", moved), "+", { n: problem.b, frame: 1 }, "=", blank("left", left), "+", { n: MAKE_TEN_PLACES, ten: true }, "=", blank("total", problem.sum)];
}
type Blank = Extract<MakeTenChainToken, { blank: number }>;
const isBlank = (token: MakeTenChainToken): token is Blank => typeof token === "object" && "blank" in token;
export const makeTenBlanks = (tokens: readonly MakeTenChainToken[]): Blank[] => tokens.filter(isBlank);
/** The chain written out, every blank filled: "8 + 6 = 8 + 2 + 4 = 10 + 4 = 14" (a success message). */
export function makeTenChainText(problem: MakeTenProblem): string {
  return makeTenChain(problem).map((token) => (typeof token === "string" ? token : isBlank(token) ? String(token.value) : String(token.n))).join(" ");
}
/** Each side of every "=" in the chain, summed: all equal the sum (the chain is true arithmetic). */
export function makeTenChainSides(problem: MakeTenProblem): number[] {
  const sides: number[][] = [[]];
  for (const token of makeTenChain(problem)) {
    if (token === "=") sides.push([]);
    else if (typeof token === "object") sides.at(-1)!.push(isBlank(token) ? token.value : token.n);
  }
  return sides.map((terms) => terms.reduce((sum, n) => sum + n, 0));
}

/** A part of a `numeric_row` (the player's row of blanks): text, or a blank with its answer and a label under it. */
export type MakeTenRowPart = { text: string } | { blank: { as: string; answer: string; label?: string } };

const BLANK_NAMES: Record<string, string> = { moved: "to_ten", total: "total" };

/**
 * The row of four blanks a task anchored on the card asks, for the pair (decision 0027 §4): the program writes
 * it, never a model. The blank beside the bigger addend is labelled "to make ten" (the owner chose this order,
 * 2026-11-27): only 8 + 2 + 4 is right, not 8 + 4 + 2. Blanks: `to_ten`, `rest` (the ones left of the giver),
 * `ones` (the ones after the ten), `total`.
 */
export function makeTenRow(a: number, b: number, language: MakeTenLanguage = "en-US"): MakeTenRowPart[] {
  const problem = makeTenProblemOf(a, b);
  const words = MAKE_TEN_WORDS[language] ?? MAKE_TEN_WORDS["en-US"];
  const parts: MakeTenRowPart[] = [];
  let text: string[] = [];
  let leftSeen = 0;
  const flush = () => { if (text.length) { parts.push({ text: text.join(" ") }); text = []; } };
  for (const token of makeTenChain(problem)) {
    if (!isBlank(token)) { text.push(typeof token === "string" ? token : String(token.n)); continue; }
    flush();
    const as = token.part === "left" ? (leftSeen++ === 0 ? "rest" : "ones") : BLANK_NAMES[token.part]!;
    parts.push({ blank: { as, answer: String(token.value), ...(token.part === "moved" ? { label: words.toTen } : {}) } });
  }
  flush();
  return parts;
}

// ---------------------------------------------------------------- facts

export interface MakeTenFacts {
  /** The count in each frame now. */
  counts: [number, number];
  /** Every counter on the card: always a + b. */
  total: number;
  /** The giver's counters now in the bigger frame. */
  moved: number;
  /** The bigger frame holds ten (a task's row of blanks opens). */
  complete: boolean;
  /** The frame that fills and the frame that gives. */
  filling: 0 | 1;
  giver: 0 | 1;
  /** How many cross to make ten, and the ones left then. */
  toTen: number;
  left: number;
}

/** Facts a task reads, and what a later section is told about the card. */
export function makeTenFacts(state: MakeTenState): MakeTenFacts {
  return {
    counts: [makeTenFrame(state, 0).count, makeTenFrame(state, 1).count],
    total: makeTenTotal(state),
    moved: state.moved,
    complete: makeTenComplete(state),
    filling: state.problem.big,
    giver: makeTenGiver(state.problem),
    toTen: makeTenToTen(state.problem),
    left: state.problem.left,
  };
}

// ---------------------------------------------------------------- content

export interface MakeTenContent {
  /** The language of the card's own words; absent means US English. */
  language?: MakeTenLanguage;
  /** The two addends, 1 to 9, sum more than ten. */
  a: number;
  b: number;
  /** The demonstration: the count in the bigger addend's frame, from the bigger addend (fresh) to 10. */
  filled: number;
  /** The learner's taps: the giver's counters now in the bigger frame, 0 at a start. */
  moved: number;
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
export function makeTenFaultText(fault: MakeTenFault, a: unknown, b: unknown): string {
  const pair = typeof a === "number" && typeof b === "number" ? `${a} + ${b}` : "This pair";
  switch (fault) {
    case "not_one_digit": return `${pair}: each number is from 1 to 9 (not_one_digit)`;
    case "under_ten": return `${pair} is less than ten: there is no ten to make (under_ten)`;
    case "exactly_ten": return `${pair} is exactly ten: nothing is left over; that is partners of ten, not this card (exactly_ten)`;
    default: return "The two numbers are whole numbers from 1 to 9 (unreadable)";
  }
}

/**
 * Checks a card's content. With `boundValues` (the core checking the card at a value a variable can take) only
 * each field's own range is checked: the joint rules (the pair the card refuses, `filled` starting at the pair's
 * bigger addend, a demonstration on fresh frames, a count the pair allows) belong to a starting card.
 */
export function validateMakeTenContent(raw: unknown, path: string, fail: Fail, options: { boundValues?: boolean } = {}): void {
  const content = record(raw, path, fail);
  for (const key of Object.keys(content)) {
    if (!["language", "a", "b", "filled", "moved", "bindings"].includes(key)) fail(`${path}/${key}`, `Unknown make-ten field '${key}'`);
  }
  if (content.language !== undefined && !MAKE_TEN_LANGUAGES.includes(content.language as MakeTenLanguage)) {
    fail(`${path}/language`, `The card speaks ${MAKE_TEN_LANGUAGES.join(" or ")}`);
  }
  const a = wholeNumber(content.a, `${path}/a`, MAKE_TEN_MIN_ADDEND, MAKE_TEN_MAX_ADDEND, fail, "The first number");
  const b = wholeNumber(content.b, `${path}/b`, MAKE_TEN_MIN_ADDEND, MAKE_TEN_MAX_ADDEND, fail, "The second number");
  const filled = wholeNumber(content.filled, `${path}/filled`, 0, MAKE_TEN_PLACES, fail, "The count in the bigger addend's frame (filled)");
  const moved = wholeNumber(content.moved, `${path}/moved`, 0, MAKE_TEN_MAX_MOVED, fail, "The counters moved");
  if (options.boundValues) return;
  const fault = makeTenFault(a, b);
  if (fault) fail(`${path}/b`, makeTenFaultText(fault, a, b));
  const problem = makeTenProblemOf(a, b);
  const start = makeTenFreshCount(a, b);
  // The demonstration's count starts at the pair's bigger addend (decision 0027, wiring 3): never 0.
  if (filled < start) {
    fail(`${path}/filled`, `'filled' counts the counters in the bigger addend's frame: for ${makeTenProblemText(problem)} it starts at ${start}, the bigger addend, not ${filled}`);
  }
  if (moved > makeTenToTen(problem)) {
    fail(`${path}/moved`, `${makeTenProblemText(problem)} fills its ten with ${makeTenToTen(problem)} moved; ${moved} cannot be`);
  }
  if (filled > start && moved !== 0) {
    fail(`${path}/filled`, "A demonstration (filled above the bigger addend) plays on fresh frames: moved is 0");
  }
}

/** The card's language from its content (read as the mat reads it): Chinese when it says so, else US English. */
export const makeTenLanguage = (raw: unknown): MakeTenLanguage => baseTenLanguage(raw);

/**
 * The card a content describes, as the rules hold it (what it draws and taps act on). Total: any content gives a
 * state. The addends are taken to whole numbers 1 to 9; `filled` to a whole number from the bigger addend to 10
 * (a demonstration animating 8 -> 10 shows each counter in turn); `moved` to what the pair allows. When `filled`
 * is above the bigger addend the card is the demonstration's at that count (`moved` is then ignored).
 */
export function makeTenState(raw: unknown): MakeTenState & { filled: number } {
  const content = (raw ?? {}) as Partial<MakeTenContent>;
  const int = (value: unknown, low: number, high: number, fallback = low) => (typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.floor(value + 1e-9))) : fallback);
  const a = int(content.a, MAKE_TEN_MIN_ADDEND, MAKE_TEN_MAX_ADDEND, MAKE_TEN_MAX_ADDEND);
  const b = int(content.b, MAKE_TEN_MIN_ADDEND, MAKE_TEN_MAX_ADDEND, MAKE_TEN_MAX_ADDEND);
  const problem = makeTenProblemOf(a, b);
  const start = makeTenAddend(problem, problem.big);
  const most = Math.max(0, Math.min(MAKE_TEN_PLACES - start, makeTenAddend(problem, makeTenGiver(problem))));
  const filled = int(content.filled, start, start + most, start);
  if (filled > start) return { problem, moved: filled - start, filled };
  return { problem, moved: int(content.moved, 0, most), filled };
}

/** Why a card cannot start a learner's task (a practice start), or undefined: fresh frames, nothing demonstrated and nothing moved. */
export function makeTenStartFault(state: MakeTenState): string | undefined {
  const start = makeTenAddend(state.problem, state.problem.big);
  if ((state.filled ?? start) !== start) return `A practice card starts with nothing demonstrated: filled is ${state.filled}, not ${start} (${makeTenProblemText(state.problem)}'s bigger addend)`;
  if (state.moved !== 0) return `A practice card starts fresh: moved is ${state.moved}, not 0`;
  return undefined;
}

/** The fields one tap changes: the count moved. */
export function makeTenChanges(before: MakeTenState, after: MakeTenState): Array<{ place: number; field: "moved"; before: number; after: number }> {
  return before.moved === after.moved ? [] : [{ place: 0, field: "moved", before: before.moved, after: after.moved }];
}

/** The pair, the demonstration's count and the count moved: 4 variables. */
export const MAKE_TEN_VARIABLE_COUNT = MAKE_TEN_CARD_BINDINGS.length;

// ---------------------------------------------------------------- words (sketch page.js, ported)

/**
 * The card's own words, whole sentences per language. In a sentence, `{c}` is the giving addend's colour word and
 * `{K}` the filling frame's, capitalised; the card draws each in that colour.
 */
export const MAKE_TEN_WORDS = {
  "en-US": {
    cardLabel: "Making ten on two ten frames",
    howto: {
      start: "Make a ten: tap a {c} counter to fill the empty places.",
      going: "Keep tapping {c} counters until the frame is full.",
      done: "The frame is a ten. Fill in the blanks.",
      shown: "The frame is a ten.",
    },
    colour: ["red", "blue"],
    refusal: {
      stays: "{K} counters stay in their frame.",
      full: "That frame is full: a frame has ten places.",
      demonstrating: "These frames show the demonstration.",
      none: "That can't be done here.",
    },
    moveAway: "Move this counter to the other frame",
    moveBack: "Move this counter back to its own frame",
    frameName: (n: number) => `Ten frame of the ${n}`,
    toTen: "to make ten",
    demo: {
      start: (big: number) => `Fill the ${big}'s frame to make a ten.`,
      move: (small: number) => `Move one of the ${small} across.`,
      ten: (left: number) => `A full frame is ten, and ${left} ${left === 1 ? "is" : "are"} left: 10 + ${left}.`,
    },
    fixedHowTo: "Tap a {c} counter to move it into an empty place of the other frame; tap it again to bring it back. When that frame holds ten, fill in the blanks.",
  },
  "zh-CN": {
    cardLabel: "两个十格框凑十",
    howto: {
      start: "凑成十：点{c}的圆片，把空位填满。",
      going: "接着点{c}的圆片，直到框满了。",
      done: "框满十了。在下面填空。",
      shown: "框满十了。",
    },
    colour: ["红色", "蓝色"],
    refusal: {
      stays: "{K}的圆片留在自己的框里。",
      full: "那个框满了：一个框只有十个格子。",
      demonstrating: "这是演示。",
      none: "这里不能这样做。",
    },
    moveAway: "把这个圆片移到另一个框",
    moveBack: "把这个圆片移回它自己的框",
    frameName: (n: number) => `${n} 的十格框`,
    toTen: "凑成十",
    demo: {
      start: (big: number) => `把 ${big} 的框补满，凑成十。`,
      move: (small: number) => `从 ${small} 里移一个过去。`,
      ten: (left: number) => `满框是十，另一个框还剩 ${left} 个：10 + ${left}。`,
    },
    fixedHowTo: "点{c}的圆片，把它移到另一个框的空位里；再点一下就移回来。那个框满十了，就在下面填空。",
  },
} as const;

/** A sentence's pieces: text, and colour words with the frame whose colour they name. */
export type MakeTenRichText = Array<string | { word: string; frame: 0 | 1 }>;

/** Splits a sentence with `{c}` / `{K}` into text and colour words (the view draws each word in its colour). */
export function makeTenRich(sentence: string, problem: MakeTenProblem, language: MakeTenLanguage = "en-US"): MakeTenRichText {
  const words = MAKE_TEN_WORDS[language] ?? MAKE_TEN_WORDS["en-US"];
  const give = makeTenGiver(problem), keep = problem.big;
  const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  return sentence.split(/(\{[cK]\})/u).filter(Boolean).map((part) => {
    if (part === "{c}") return { word: words.colour[give], frame: give };
    if (part === "{K}") return { word: cap(words.colour[keep]), frame: keep };
    return part;
  });
}
/** The plain text of a rich sentence. */
export const makeTenPlain = (rich: MakeTenRichText): string => rich.map((part) => (typeof part === "string" ? part : part.word)).join("");

/** How to work the card, in its language, naming the giving colour: fixed text a host shows with a task on the card. */
export function makeTenHowTo(raw: unknown): string {
  const language = makeTenLanguage(raw);
  return makeTenPlain(makeTenRich(MAKE_TEN_WORDS[language].fixedHowTo, makeTenState(raw).problem, language));
}

/** The one-line instruction on the card, which follows the frames (only while the learner can tap). */
export function makeTenInstruction(state: MakeTenState, language: MakeTenLanguage = "en-US"): MakeTenRichText {
  const h = MAKE_TEN_WORDS[language].howto;
  return makeTenRich(makeTenComplete(state) ? h.done : state.moved !== 0 ? h.going : h.start, state.problem, language);
}

/** What the card says when a tap is refused, in its language: a fact, never an instruction. */
export function makeTenRefusalRich(state: MakeTenState, reason: string, language: MakeTenLanguage = "en-US"): MakeTenRichText {
  const words = MAKE_TEN_WORDS[language] ?? MAKE_TEN_WORDS["en-US"];
  const sentence = (words.refusal as Record<string, string>)[reason] ?? words.refusal.none;
  return makeTenRich(sentence, state.problem, language);
}
export const makeTenRefusalText = (state: MakeTenState, reason: string, language: MakeTenLanguage = "en-US"): string => makeTenPlain(makeTenRefusalRich(state, reason, language));

/**
 * What the demonstration says as it fills the bigger frame from `from` to `to` (sentences for a lesson's later
 * sections, which narrate what the program animates; never drawn on the card).
 */
export function makeTenStepSentences(problem: MakeTenProblem, from: number, to: number, language: MakeTenLanguage = "en-US"): string[] {
  const dm = MAKE_TEN_WORDS[language].demo;
  const start = makeTenAddend(problem, problem.big);
  const sentences: string[] = [];
  if (from === start && to > from) sentences.push(dm.start(start));
  for (let k = from; k < to; k += 1) sentences.push(dm.move(makeTenAddend(problem, makeTenGiver(problem))));
  if (to === MAKE_TEN_PLACES && from < to) sentences.push(dm.ten(problem.left));
  return sentences;
}

// ---------------------------------------------------------------- plan (sketch layout, at desktop size)

export interface MakeTenBox { x: number; y: number; width: number; height: number }

export interface MakeTenPlan {
  width: number;
  height: number;
  /** A place's side and a counter's diameter. */
  unit: number;
  counter: number;
  /** Each frame's grid, its caption (the live count) and where its note goes. */
  frames: Array<{ frame: 0 | 1; box: MakeTenBox; caption: { x: number; y: number }; note: MakeTenBox }>;
  /** The "+" between the frames, and the arrow above it (before the first move). */
  plus: { x: number; y: number };
  arrow: { x1: number; x2: number; y: number };
  /** Fills of the two addends' counters, and the full frame's ring. */
  fills: [string, string];
  done: string;
}

export const MAKE_TEN_FILLS: [string, string] = ["#d24c6b", "#3a76d8"];
const U = 64;
const COUNTER = 50;
const EDGE = 16;
const CAPTION = 56;
const GAP = 96;
const NOTE = 44;

/** The card's layout, from the sketch: two frames of 2 × 5 places side by side, a big "+" between them, each frame's live count above it. */
export function planMakeTen(_raw: unknown): MakeTenPlan {
  const frameWidth = 5 * U, frameHeight = 2 * U;
  const top = EDGE + CAPTION;
  const x0 = EDGE, x1 = EDGE + frameWidth + GAP;
  const frames = ([0, 1] as const).map((frame) => {
    const x = frame === 0 ? x0 : x1;
    return {
      frame,
      box: { x, y: top, width: frameWidth, height: frameHeight },
      caption: { x: x + frameWidth / 2, y: EDGE + CAPTION / 2 - 4 },
      note: { x, y: top + frameHeight + 8, width: frameWidth, height: NOTE - 8 },
    };
  });
  const midX = x0 + frameWidth + GAP / 2;
  return {
    width: x1 + frameWidth + EDGE,
    height: top + frameHeight + NOTE + EDGE,
    unit: U,
    counter: COUNTER,
    frames,
    plus: { x: midX, y: top + frameHeight / 2 },
    arrow: { x1: midX - 30, x2: midX + 30, y: top + 14 },
    fills: MAKE_TEN_FILLS,
    done: "#1d7a4e",
  };
}

/** Where place `slot` (0 to 9) of a frame lies (its centre): the top row left to right, then the bottom row. */
export function makeTenPlaceAt(plan: MakeTenPlan, frame: number, slot: number): { x: number; y: number } {
  const box = plan.frames[frame === 1 ? 1 : 0]!.box;
  return { x: box.x + (slot % 5) * plan.unit + plan.unit / 2, y: box.y + Math.floor(slot / 5) * plan.unit + plan.unit / 2 };
}
