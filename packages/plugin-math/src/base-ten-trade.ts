/**
 * Trading tens and ones (decision 0023): a `base_ten_trade` card of the math plugin.
 *
 * The content states a pile of base-ten units on a place-value mat: how many ones, tens and hundreds,
 * and how many of them sit in each tray. A tray is the size of one unit of the next place and holds
 * exactly ten; ten in a tray make one of the next place when the learner says so ("Make a ten"), and one
 * unit can be broken back into ten of the place below. This module is the card's program: its content
 * rules, its tap rules, the facts a task reads, and the plan the view draws. It imports nothing at run
 * time, so the core validator, the reducer and the web runtime can all load it (decision 0013 §3).
 *
 * The card never draws a number: the learner counts and types. Counts may pass between whole numbers
 * while a variable animates; the card reads the nearest whole number.
 */

export const BASE_TEN_TRADE_KIND = "base_ten_trade";
export const BASE_TEN_TRADE_FEATURE = "plugin:math/base-ten-trade@1";
/** The math plugin version that introduced the card. */
export const BASE_TEN_TRADE_PLUGIN_VERSION = "0.5.0";
/** A mat that speaks Chinese (decision 0023 amendment 3): a player without it refuses the `language` field. */
export const BASE_TEN_TRADE_LANGUAGE_FEATURE = "plugin:math/base-ten-trade-language@1";
export const BASE_TEN_TRADE_LANGUAGE_VERSION = "0.6.0";
/**
 * A slider on a place's count (decision 0023 amendment 4): each stop is one trade made by the card's tap
 * rules. A player without it would write the count directly, changing the total, so it refuses such a lesson.
 */
export const BASE_TEN_TRADE_SLIDER_FEATURE = "plugin:math/base-ten-trade-slider@1";
export const BASE_TEN_TRADE_SLIDER_VERSION = "0.7.0";
/** A slider on a count moves ten of that place per stop: one trade. */
export const BASE_TEN_SLIDER_STEP = 10;
/** The languages a mat speaks. A mat without `language` speaks US English, as before amendment 3. */
export const BASE_TEN_TRADE_LANGUAGES = ["en-US", "zh-CN"] as const;
export type BaseTenLanguage = typeof BASE_TEN_TRADE_LANGUAGES[number];

/** Numeric fields of a place that lesson variables may drive. */
export const BASE_TEN_TRADE_BINDINGS = {
  places: ["count", "tray"],
} as const;

/** Content fields whose items are addressable parts (`mat#ones`). */
export const BASE_TEN_TRADE_PART_FIELDS = ["places"] as const;

/** Place names, lowest first: index 0 is ones. */
export const BASE_TEN_TRADE_PLACES = ["ones", "tens", "hundreds"] as const;
export type BaseTenPlaceName = typeof BASE_TEN_TRADE_PLACES[number];

export const BASE_TEN_TRADE_LIMITS = {
  /** The most of each place the mat draws (tens: 29 after a break, plus five trades from 59 ones). */
  drawn: [59, 34, 9],
  /** The most of each place a pile may start with. */
  start: [59, 19, 9],
  /** A break is refused if the place below would then hold more than this. */
  room: [59, 29],
  /** A tray holds exactly ten: the size of one unit of the next place (owner, 2026-11-22). */
  tray: 10,
} as const;

export interface BaseTenTradePlace {
  as: BaseTenPlaceName;
  count: number;
  /** How many of `count` sit in this place's tray (ones; tens when there is a hundreds column). */
  tray?: number;
}

export interface BaseTenTradeContent {
  title?: string;
  caption?: string;
  /** 2: tens and ones. 3: hundreds, tens and ones. Fixed for the card, so it never resizes. */
  columns: 2 | 3;
  /** One entry per column, lowest place first. */
  places: BaseTenTradePlace[];
  bindings?: unknown[];
  /** The language of the mat's own words; absent means US English (amendment 3). */
  language?: BaseTenLanguage;
}

/** A mat as whole numbers, lowest place first. Hundreds have no tray. */
export interface BaseTenMat {
  columns: 2 | 3;
  counts: number[];
  trays: number[];
}

type Fail = (path: string, message: string) => never;

function record(value: unknown, path: string, fail: Fail): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "Expected an object");
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, allowed: readonly string[], path: string, fail: Fail): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}/${key}`, `Unknown base-ten trade field '${key}'`);
}

function text(raw: unknown, path: string, fail: Fail, max = 120): void {
  if (raw !== undefined && (typeof raw !== "string" || raw.length > max)) fail(path, `Expected text of at most ${max} characters`);
}

function wholeNumber(raw: unknown, path: string, low: number, high: number, fail: Fail, what: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < low || raw > high) fail(path, `${what} is a whole number from ${low} to ${high}`);
  return raw as number;
}

/** Whether place `p` has a tray on a mat of this many columns: every place below the highest column. */
export const hasTray = (columns: number, p: number): boolean => p >= 0 && p < columns - 1;

const valueOf = (counts: readonly number[]): number => counts.reduce((sum, count, p) => sum + count * 10 ** p, 0);

/**
 * Checks a card's content. With `boundValues` (the core checking the card at a value a variable can
 * take) only each field's own range is checked: a tray at its maximum while its count sits at its start
 * is not a state the learner can reach, and the joint rules are kept by the tap rules. Without it the
 * content is a starting pile: the joint rules and the starting limits apply too.
 */
export function validateBaseTenTradeContent(raw: unknown, path: string, fail: Fail, options: { boundValues?: boolean } = {}): void {
  const content = record(raw, path, fail);
  only(content, ["title", "caption", "columns", "places", "bindings", "language"], path, fail);
  if (content.language !== undefined && !BASE_TEN_TRADE_LANGUAGES.includes(content.language as BaseTenLanguage)) {
    fail(`${path}/language`, `A mat speaks ${BASE_TEN_TRADE_LANGUAGES.join(" or ")}`);
  }
  text(content.title, `${path}/title`, fail);
  text(content.caption, `${path}/caption`, fail, 480);
  const columns = content.columns;
  if (columns !== 2 && columns !== 3) fail(`${path}/columns`, "A mat has 2 columns (tens and ones) or 3 (hundreds, tens and ones)");
  if (!Array.isArray(content.places) || content.places.length !== columns) {
    fail(`${path}/places`, `A mat of ${columns} columns lists ${columns} places, ones first`);
  }
  const counts: number[] = [];
  const trays: number[] = [];
  for (const [p, item] of (content.places as unknown[]).entries()) {
    const at = `${path}/places/${p}`;
    const place = record(item, at, fail);
    only(place, ["as", "count", "tray"], at, fail);
    if (place.as !== BASE_TEN_TRADE_PLACES[p]) fail(`${at}/as`, `Place ${p + 1} is '${BASE_TEN_TRADE_PLACES[p]}' (places are listed ones first)`);
    const most = columns === 2 && p === 1 ? 9 : (options.boundValues ? BASE_TEN_TRADE_LIMITS.drawn : BASE_TEN_TRADE_LIMITS.start)[p]!;
    counts.push(wholeNumber(place.count, `${at}/count`, 0, most, fail, `The count of ${place.as}`));
    if (hasTray(columns as number, p)) {
      trays.push(place.tray === undefined ? 0 : wholeNumber(place.tray, `${at}/tray`, 0, BASE_TEN_TRADE_LIMITS.tray, fail, `The ${place.as} tray`));
    } else if (place.tray !== undefined) {
      fail(`${at}/tray`, `The ${place.as} have no tray: there is no column above them`);
    }
  }
  if (options.boundValues) return;
  for (const [p, tray] of trays.entries()) {
    if (tray > counts[p]!) fail(`${path}/places/${p}/tray`, `The ${BASE_TEN_TRADE_PLACES[p]} tray holds more than there are ${BASE_TEN_TRADE_PLACES[p]}`);
  }
  const most = columns === 2 ? 99 : 999;
  if (valueOf(counts) > most) {
    fail(`${path}/places`, columns === 2
      ? "This pile makes a hundred or more: use 3 columns"
      : "This pile makes more than 9 hundreds after trading");
  }
}

/** The mat a content describes, as whole numbers (a value between whole numbers reads as the nearest). */
export function baseTenMat(raw: unknown): BaseTenMat {
  const content = raw as BaseTenTradeContent;
  const columns = content.columns === 3 ? 3 : 2;
  const whole = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  const places = Array.isArray(content.places) ? content.places : [];
  // Never more of a place than the mat draws, whatever a variable holds (the validator refuses such ranges).
  const counts = Array.from({ length: columns }, (_, p) => Math.min(whole(places[p]?.count), columns === 2 && p === 1 ? 9 : BASE_TEN_TRADE_LIMITS.drawn[p]!));
  const trays = Array.from({ length: columns - 1 }, (_, p) => Math.min(whole(places[p]?.tray), counts[p]!, BASE_TEN_TRADE_LIMITS.tray));
  return { columns, counts, trays };
}

const set = (values: readonly number[], index: number, value: number): number[] => values.map((x, i) => (i === index ? value : x));
const loose = (mat: BaseTenMat, p: number): number => mat.counts[p]! - (hasTray(mat.columns, p) ? mat.trays[p]! : 0);

/** One learner tap on the card. */
export type BaseTenTap =
  | { kind: "gather"; place: number }    // a loose unit of this place goes into its tray
  | { kind: "ungather"; place: number }  // a unit in this place's tray goes back
  | { kind: "make"; place: number }      // ten in this place's tray become one of the next place
  | { kind: "break"; place: number };    // one loose unit of this place becomes ten of the place below, in that tray

export type BaseTenRefusal = "no_tray" | "none_loose" | "tray_full" | "tray_empty" | "tray_not_ten" | "tray_not_empty" | "no_room";

export type BaseTenTapResult = { ok: true; mat: BaseTenMat } | { ok: false; reason: BaseTenRefusal };

/**
 * The tap rules. The learner makes every trade; the card only refuses what cannot happen: a tray
 * holds ten and no more, only exactly ten make one of the next place, and a break needs an empty tray
 * below and room on the mat.
 */
export function applyBaseTenTap(mat: BaseTenMat, tap: BaseTenTap): BaseTenTapResult {
  const p = tap.place;
  if (!Number.isInteger(p) || p < 0 || p >= mat.columns) return { ok: false, reason: "no_tray" };
  if (tap.kind === "gather") {
    if (!hasTray(mat.columns, p)) return { ok: false, reason: "no_tray" };
    if (mat.trays[p]! >= BASE_TEN_TRADE_LIMITS.tray) return { ok: false, reason: "tray_full" };
    if (loose(mat, p) <= 0) return { ok: false, reason: "none_loose" };
    return { ok: true, mat: { ...mat, trays: set(mat.trays, p, mat.trays[p]! + 1) } };
  }
  if (tap.kind === "ungather") {
    if (!hasTray(mat.columns, p)) return { ok: false, reason: "no_tray" };
    if (mat.trays[p]! <= 0) return { ok: false, reason: "tray_empty" };
    return { ok: true, mat: { ...mat, trays: set(mat.trays, p, mat.trays[p]! - 1) } };
  }
  if (tap.kind === "make") {
    if (!hasTray(mat.columns, p)) return { ok: false, reason: "no_tray" };
    if (mat.trays[p] === 0) return { ok: false, reason: "tray_empty" };
    if (mat.trays[p] !== BASE_TEN_TRADE_LIMITS.tray) return { ok: false, reason: "tray_not_ten" };
    const counts = set(set(mat.counts, p, mat.counts[p]! - 10), p + 1, mat.counts[p + 1]! + 1);
    return { ok: true, mat: { ...mat, counts, trays: set(mat.trays, p, 0) } };
  }
  if (p < 1) return { ok: false, reason: "no_tray" };
  if (loose(mat, p) <= 0) return { ok: false, reason: "none_loose" };
  if (mat.trays[p - 1] !== 0) return { ok: false, reason: "tray_not_empty" };
  if (mat.counts[p - 1]! + 10 > BASE_TEN_TRADE_LIMITS.room[p - 1]!) return { ok: false, reason: "no_room" };
  const counts = set(set(mat.counts, p, mat.counts[p]! - 1), p - 1, mat.counts[p - 1]! + 10);
  return { ok: true, mat: { ...mat, counts, trays: set(mat.trays, p - 1, 10) } };
}

/** The most of a place the mat draws: tens on a mat of two columns stop at nine. */
const drawnMost = (columns: number, p: number): number => (columns === 2 && p === 1 ? 9 : BASE_TEN_TRADE_LIMITS.drawn[p]!);

/** One tap of a slider-made trade and the mat it leaves. */
export interface BaseTenStep { tap: BaseTenTap; mat: BaseTenMat }

/**
 * The field of a card a variable drives through a bare binding (`ones.count` = `ones`), or undefined. A
 * place is named by its canonical `id` on the board and by `as` in authoring content.
 */
export function baseTenBoundField(raw: unknown, alias: string): { place: number; field: "count" | "tray" } | undefined {
  const content = raw as { places?: unknown; bindings?: unknown } | null;
  const places = (Array.isArray(content?.places) ? content!.places : []) as Array<{ id?: unknown; as?: unknown }>;
  for (const binding of (Array.isArray(content?.bindings) ? content!.bindings : []) as Array<{ target?: unknown; expression?: unknown }>) {
    if (typeof binding?.target !== "string" || typeof binding.expression !== "string" || binding.expression.trim() !== alias) continue;
    const separator = binding.target.lastIndexOf(".");
    const name = binding.target.slice(0, separator);
    const field = binding.target.slice(separator + 1);
    const place = places.findIndex((item) => (item?.id ?? item?.as) === name);
    if (place >= 0 && (field === "count" || field === "tray")) return { place, field };
  }
  return undefined;
}

/**
 * The place whose count a slider on this variable moves by trades (amendment 4), or undefined. Only the
 * count of a place with a tray takes one: ones, and tens on a mat of three columns. A tray or the highest
 * place never does.
 */
export function baseTenSliderPlace(raw: unknown, alias: string): number | undefined {
  const bound = baseTenBoundField(raw, alias);
  const columns = (raw as { columns?: unknown } | null)?.columns === 3 ? 3 : 2;
  return bound && bound.field === "count" && hasTray(columns, bound.place) ? bound.place : undefined;
}

/**
 * One stop of a slider on a place's count, made only by the card's tap rules (amendment 4). Down (count
 * −10): loose units of the place go into its tray until it holds ten, then the ten make one of the next
 * place. Up (+10): the tray is emptied, one unit of the next place is broken into it, and the ten are taken
 * out loose. Either way the place's tray is empty after the stop and the total is unchanged. A stop any tap
 * of which the rules refuse, or that would leave a place above what the mat draws, is refused whole.
 */
export function baseTenSliderStop(mat: BaseTenMat, place: number, direction: -1 | 1): { ok: true; steps: BaseTenStep[]; mat: BaseTenMat } | { ok: false; reason: BaseTenRefusal } {
  if (!hasTray(mat.columns, place)) return { ok: false, reason: "no_tray" };
  const steps: BaseTenStep[] = [];
  let current = mat;
  const tap = (kind: BaseTenTap["kind"], at: number): BaseTenRefusal | undefined => {
    const result = applyBaseTenTap(current, { kind, place: at });
    if (!result.ok) return result.reason;
    current = result.mat;
    steps.push({ tap: { kind, place: at }, mat: current });
    return undefined;
  };
  let refused: BaseTenRefusal | undefined;
  if (direction < 0) {
    while (!refused && current.trays[place]! < BASE_TEN_TRADE_LIMITS.tray) refused = tap("gather", place);
    refused ??= tap("make", place);
    if (!refused && current.counts[place + 1]! > drawnMost(mat.columns, place + 1)) refused = "no_room";
  } else {
    while (!refused && current.trays[place]! > 0) refused = tap("ungather", place);
    refused ??= tap("break", place + 1);
    while (!refused && current.trays[place]! > 0) refused = tap("ungather", place);
  }
  return refused ? { ok: false, reason: refused } : { ok: true, steps, mat: current };
}

/** Every stop a slider on a place's count can reach, in one direction, nearest first. */
function sliderStops(mat: BaseTenMat, place: number, direction: -1 | 1): Array<{ steps: BaseTenStep[]; mat: BaseTenMat }> {
  const stops: Array<{ steps: BaseTenStep[]; mat: BaseTenMat }> = [];
  let current = mat;
  let steps: BaseTenStep[] = [];
  // A place never holds more than 59, so at most six stops each way.
  for (let i = 0; i < 6; i += 1) {
    const stop = baseTenSliderStop(current, place, direction);
    if (!stop.ok) break;
    steps = [...steps, ...stop.steps];
    current = stop.mat;
    stops.push({ steps, mat: current });
  }
  return stops;
}

/**
 * Moves a slider on a place's count toward a value, one trade per stop (amendment 4). A stop the rules
 * refuse cannot be reached, so the slider settles on the reachable stop nearest the value (the nearer to
 * where it was on a tie). Returns each tap made, in order, with the mat it leaves; no taps when it stays.
 */
export function baseTenSliderMove(mat: BaseTenMat, place: number, value: number): { steps: BaseTenStep[]; mat: BaseTenMat } {
  const count = mat.counts[place];
  if (count === undefined || !Number.isFinite(value) || !hasTray(mat.columns, place)) return { steps: [], mat };
  let best = { steps: [] as BaseTenStep[], mat, distance: Math.abs(value - count) };
  for (const direction of [-1, 1] as const) {
    if (Math.sign(value - count) !== direction) continue;
    for (const stop of sliderStops(mat, place, direction)) {
      const distance = Math.abs(value - stop.mat.counts[place]!);
      if (distance < best.distance) best = { ...stop, distance };
    }
  }
  return { steps: best.steps, mat: best.mat };
}

/** The lowest and highest count a slider on a place's count can reach from this mat: its track, ten apart. */
export function baseTenSliderTrack(mat: BaseTenMat, place: number): { min: number; max: number } {
  const count = mat.counts[place] ?? 0;
  if (!hasTray(mat.columns, place)) return { min: count, max: count };
  return {
    min: sliderStops(mat, place, -1).at(-1)?.mat.counts[place] ?? count,
    max: sliderStops(mat, place, 1).at(-1)?.mat.counts[place] ?? count,
  };
}

/**
 * Every mat the sliders on these places can reach from a mat, the mat itself first: an exact search over
 * trades, so a task's target is checked against the piles a learner can make.
 */
export function baseTenSliderReachable(mat: BaseTenMat, places: readonly number[]): BaseTenMat[] {
  const key = (state: BaseTenMat) => `${state.counts.join(",")}/${state.trays.join(",")}`;
  const seen = new Set([key(mat)]);
  const found = [mat];
  for (let i = 0; i < found.length; i += 1) {
    for (const place of places) {
      for (const direction of [-1, 1] as const) {
        const stop = baseTenSliderStop(found[i]!, place, direction);
        if (!stop.ok || seen.has(key(stop.mat))) continue;
        seen.add(key(stop.mat));
        found.push(stop.mat);
      }
    }
  }
  return found;
}

/** A card's content showing this mat: each place's count and tray replaced (a frame of a slider's trades). */
export function baseTenContentWith<T>(raw: T, mat: BaseTenMat): T {
  const content = structuredClone(raw) as { places?: Array<{ count?: number; tray?: number }> };
  for (const [p, item] of (Array.isArray(content.places) ? content.places : []).entries()) {
    if (!item || p >= mat.columns) continue;
    item.count = mat.counts[p]!;
    if (p < mat.trays.length) item.tray = mat.trays[p]!;
  }
  return content as T;
}

/** The mat's language from its content: Chinese when it says so, else US English. */
export function baseTenLanguage(raw: unknown): BaseTenLanguage {
  return (raw as { language?: unknown } | null)?.language === "zh-CN" ? "zh-CN" : "en-US";
}

/**
 * The mat's own words, whole sentences per language (amendment 3): never a word put into another
 * language's sentence. `place` is the lower place of a tray, or the unit's own place.
 */
export const BASE_TEN_WORDS = {
  "en-US": {
    /** The mat's own name, for a screen reader (review of #95). */
    matLabel: "A place-value mat",
    headings: ["Ones", "Tens", "Hundreds"],
    trayLabel: ["Ten ones make a ten", "Ten tens make a hundred"],
    make: ["← Make a ten", "← Make a hundred"],
    break: ["Break a ten →", "Break a hundred →"],
    put: ["Put this one in the tray", "Put this ten in the tray", "Put this hundred in the tray"],
    take: ["Take this one out of the tray", "Take this ten out of the tray", "Take this hundred out of the tray"],
    refusal: {
      tray_full: ["The tray holds only ten.", "The tray holds only ten."],
      // A fact, true whether more can still go in or not (first-use test): never "fill it", which can be impossible.
      tray_not_ten: ["This tray does not hold a ten: a ten is ten ones.", "This tray does not hold a hundred: a hundred is ten tens."],
      tray_empty: ["Tap ones to put them in the tray first.", "Tap tens to put them in the tray first."],
      tray_not_empty: ["Empty the tray first.", "Empty the tray first."],
      no_room: ["There is no room on the mat for ten more.", "There is no room on the mat for ten more."],
      none_loose: ["There is no loose one to use.", "There is no loose ten to use.", "There is no loose hundred to use."],
    },
    other: "That can't be done here.",
  },
  "zh-CN": {
    matLabel: "数位方块",
    headings: ["个位", "十位", "百位"],
    trayLabel: ["十个一是一个十", "十个十是一个百"],
    make: ["← 换成一个十", "← 换成一个百"],
    break: ["拆开一个十 →", "拆开一个百 →"],
    put: ["把这个一放进托盘", "把这个十放进托盘", "把这个百放进托盘"],
    take: ["把这个一从托盘里拿出来", "把这个十从托盘里拿出来", "把这个百从托盘里拿出来"],
    refusal: {
      tray_full: ["托盘里只能放十个。", "托盘里只能放十个。"],
      tray_not_ten: ["托盘里还不是一个十：一个十是十个一。", "托盘里还不是一个百：一个百是十个十。"],
      tray_empty: ["先点个位里的一，把它们放进托盘。", "先点十位里的十，把它们放进托盘。"],
      tray_not_empty: ["先把托盘清空。", "先把托盘清空。"],
      no_room: ["没有地方再放十个了。", "没有地方再放十个了。"],
      none_loose: ["没有散的一可以用了。", "没有散的十可以用了。", "没有散的百可以用了。"],
    },
    other: "这里不能这样做。",
  },
} as const;

/** What the card tells a learner when a tap is refused, in the mat's language (US English by default). */
export function baseTenRefusalText(reason: BaseTenRefusal, place: number, language: BaseTenLanguage = "en-US"): string {
  const words = BASE_TEN_WORDS[language] ?? BASE_TEN_WORDS["en-US"];
  const sentences = (words.refusal as Record<string, readonly string[]>)[reason];
  if (!sentences) return words.other;
  return sentences[Math.min(Math.max(0, Number.isInteger(place) ? place : 0), sentences.length - 1)]!;
}

/** The fields one tap changes, as content values: place index to its new count and tray. */
export function baseTenChanges(before: BaseTenMat, after: BaseTenMat): Array<{ place: number; field: "count" | "tray"; before: number; after: number }> {
  const changes: Array<{ place: number; field: "count" | "tray"; before: number; after: number }> = [];
  for (let p = 0; p < after.columns; p += 1) {
    if (after.counts[p] !== before.counts[p]) changes.push({ place: p, field: "count", before: before.counts[p]!, after: after.counts[p]! });
    if (p < after.trays.length && after.trays[p] !== before.trays[p]) changes.push({ place: p, field: "tray", before: before.trays[p]!, after: after.trays[p]! });
  }
  return changes;
}

export interface BaseTenFacts {
  value: number;
  /**
   * No place below the highest holds ten or more. A tray of fewer than ten does not stop it: a full tray
   * already makes its place ten or more, so a tray can only matter when the learner has rightly found that
   * the last ones do not make a ten (first-use test, decision 0023 amendment 2).
   */
  no_trade_left: boolean;
  digits: number;
  /** Counts highest place first, as many as the number has digits: 706 is [7, 0, 6]. */
  counts: number[];
  /** What each place is worth, highest first: [700, 0, 6]. */
  parts: number[];
  /** "706 = 700 + 0 + 6". */
  equation: string;
}

/** Facts a task reads. Trading never changes the value; it only makes each place under ten. */
export function baseTenFacts(mat: BaseTenMat): BaseTenFacts {
  const value = valueOf(mat.counts);
  const noTradeLeft = mat.counts.slice(0, mat.columns - 1).every((count) => count < 10);
  let digits = 1;
  while (digits < mat.columns && value >= 10 ** digits) digits += 1;
  const places = Array.from({ length: digits }, (_, i) => digits - 1 - i);
  const parts = places.map((p) => mat.counts[p]! * 10 ** p);
  return { value, no_trade_left: noTradeLeft, digits, counts: places.map((p) => mat.counts[p]!), parts, equation: `${value} = ${parts.join(" + ")}` };
}

/** A place in the plan: a column the units of that place lie in. */
export interface BaseTenColumnPlan { place: number; x: number; width: number; heading: string }
/** A tray: its outline is exactly one unit of the next place; its zone holds the label and two buttons. */
export interface BaseTenTrayPlan {
  place: number;
  x: number;
  width: number;
  zoneX: number;
  zoneWidth: number;
  label: string;
  make: { x: number; y: number; width: number; height: number; text: string };
  break: { x: number; y: number; width: number; height: number; text: string };
}

export interface BaseTenTradePlan {
  width: number;
  height: number;
  /** One unit's side: a one is U × U, a ten U × 10U, a hundred 10U × 10U. */
  unit: number;
  fontSize: number;
  /** Where the units' first row starts (below the headings). */
  top: number;
  columns: BaseTenColumnPlan[];
  trays: BaseTenTrayPlan[];
}

/**
 * The mat's layout, from sketch v3 (owner, 2026-11-22): columns side by side, highest on the left,
 * each tray between its place and the next, its buttons under it. Sized for the most each place can
 * reach, so the card keeps one size whatever the learner does.
 */
export function planBaseTenTrade(raw: unknown): BaseTenTradePlan {
  const columns = (raw as BaseTenTradeContent).columns === 3 ? 3 : 2;
  const words = BASE_TEN_WORDS[baseTenLanguage(raw)];
  const U = columns === 2 ? 22 : 12;
  const fontSize = columns === 2 ? 17 : 14;
  const top = 3.2 * U;
  const gap = 1.4 * U;
  const columnPlans: BaseTenColumnPlan[] = [];
  const trays: BaseTenTrayPlan[] = [];
  let x = gap;
  const column = (place: number, width: number) => { columnPlans.push({ place, x, width, heading: words.headings[place]! }); x += width + gap; };
  const tray = (place: number, outline: number, zone: number) => {
    const buttonWidth = columns === 3 ? zone : Math.min(zone, fontSize * 9.2);
    const buttonX = x + (zone - buttonWidth) / 2;
    const height = fontSize * 2.1;
    const y = top + 10 * U + U;
    trays.push({
      place, x: x + (zone - outline) / 2, width: outline, zoneX: x, zoneWidth: zone,
      label: words.trayLabel[place]!,
      make: { x: buttonX, y, width: buttonWidth, height, text: words.make[place]! },
      break: { x: buttonX, y: y + fontSize * 2.5, width: buttonWidth, height, text: words.break[place]! },
    });
    x += zone + gap;
  };
  if (columns === 3) { column(2, 3 * 10 * U + 2 * 0.6 * U); tray(1, 10 * U, 13.5 * U); }
  column(1, (columns === 2 ? 10 : 12) * 1.35 * U);
  tray(0, U, columns === 2 ? 8 * U : 11 * U);
  column(0, 7 * 1.5 * U);
  return { width: x, height: top + (columns === 2 ? 15.6 : 34) * U, unit: U, fontSize, top, columns: columnPlans, trays };
}

/** Where the i-th loose unit of a place lies (its top-left corner). */
export function baseTenLooseAt(plan: BaseTenTradePlan, place: number, index: number): { x: number; y: number } {
  const U = plan.unit;
  const column = plan.columns.find((candidate) => candidate.place === place)!;
  if (place === 0) return { x: column.x + (index % 7) * 1.5 * U, y: plan.top + Math.floor(index / 7) * 1.5 * U };
  if (place === 1) {
    const perRow = plan.columns.length === 2 ? 10 : 12;
    return { x: column.x + (index % perRow) * 1.35 * U, y: plan.top + Math.floor(index / perRow) * 11 * U };
  }
  return { x: column.x + (index % 3) * 10.6 * U, y: plan.top + Math.floor(index / 3) * 10.6 * U };
}

/** Where the k-th unit in a place's tray lies: ones fill the tray from the bottom, tens from the left. */
export function baseTenTrayAt(plan: BaseTenTradePlan, place: number, slot: number): { x: number; y: number } {
  const tray = plan.trays.find((candidate) => candidate.place === place)!;
  return place === 0 ? { x: tray.x, y: plan.top + (9 - slot) * plan.unit } : { x: tray.x + slot * plan.unit, y: plan.top };
}
