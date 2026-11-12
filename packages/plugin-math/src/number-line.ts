/**
 * The number line (decision 0013): a `number_line` card of the math plugin.
 *
 * This module is the card's program: its content rules, exact fraction values,
 * tick planning and jump arithmetic. It imports nothing at run time, so the
 * core validator and the web runtime can both load it (first-party plugins are
 * registered statically, decision 0013 §3).
 *
 * Values are numbers or exact fractions written as strings ("3/4", "-5/2",
 * "1 1/2"); a fraction stays a string in the lesson, so 1/3 is never stored as
 * 0.333…. Bindings write plain numbers.
 */

export const NUMBER_LINE_KIND = "number_line";
export const NUMBER_LINE_FEATURE = "plugin:math/number-line@1";
/** The math plugin version that introduced the number line. */
export const NUMBER_LINE_PLUGIN_VERSION = "0.2.0";

/** Numeric fields of a number line that lesson variables may drive. */
export const NUMBER_LINE_BINDINGS = {
  points: ["value"],
  jumps: ["from", "by"],
  intervals: ["from", "to"],
} as const;

/** Content fields whose items are addressable parts (`line#start`). */
export const NUMBER_LINE_PART_FIELDS = ["points", "jumps", "intervals"] as const;

export const NUMBER_LINE_LIMITS = {
  points: 12,
  jumps: 8,
  intervals: 4,
  /** Smallest ticks across the whole range. */
  ticks: 240,
  subdivisions: 12,
  denominator: 1000,
  /** A jump drawn hop by hop has at most this many hops. */
  hops: 24,
} as const;

export type NumberLineValue = number | string;
export type TickLabels = "major" | "all" | "none";
export type TickFormat = "integer" | "decimal" | "fraction" | "mixed";

export interface NumberLinePoint {
  as: string;
  value: NumberLineValue;
  label?: string;
  style?: "closed" | "open";
  shown?: "always" | "when_emphasized";
  /** The learner may drag the point; it snaps to the smallest tick and sets the variable. */
  interaction?: { kind: "drag"; variable: string };
}

export interface NumberLineJump {
  as: string;
  /** A point's alias in the same card, or a value. */
  from: string | number;
  by: NumberLineValue;
  label?: string;
  /** Draw one small hop per smallest tick instead of one arc. */
  hops?: boolean;
}

export interface NumberLineInterval {
  as: string;
  /** Null extends the interval past the end of the line. */
  from: NumberLineValue | null;
  to: NumberLineValue | null;
  from_closed?: boolean;
  to_closed?: boolean;
  label?: string;
}

export interface NumberLineContent {
  title?: string;
  caption?: string;
  range: { min: number; max: number };
  ticks?: { step?: number; subdivisions?: number; labels?: TickLabels; format?: TickFormat };
  points?: NumberLinePoint[];
  jumps?: NumberLineJump[];
  intervals?: NumberLineInterval[];
  bindings?: unknown[];
}

/** An exact rational p/q with q > 0 and the sign on p. */
export interface Fraction { numerator: number; denominator: number }

const FRACTION = /^\s*(-)?\s*(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)\s*$/u;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** Parses "3/4", "-5/2" or "1 1/2" (a mixed number); undefined for anything else. */
export function parseFraction(text: string): Fraction | undefined {
  const match = FRACTION.exec(text);
  if (!match) return undefined;
  const [, sign, whole, top, bottom] = match;
  const denominator = Number(bottom);
  if (!Number.isSafeInteger(denominator) || denominator < 1 || denominator > NUMBER_LINE_LIMITS.denominator) return undefined;
  const numerator = Number(whole ?? 0) * denominator + Number(top);
  if (!Number.isSafeInteger(numerator)) return undefined;
  return { numerator: sign ? -numerator : numerator, denominator };
}

/** The number a value stands for, or undefined when it is neither a finite number nor a fraction. */
export function numberLineValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const fraction = parseFraction(value);
  return fraction ? fraction.numerator / fraction.denominator : undefined;
}

type Fail = (path: string, message: string) => never;

function record(value: unknown, path: string, fail: Fail): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "Expected an object");
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, allowed: readonly string[], path: string, fail: Fail): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}/${key}`, `Unknown number line field '${key}'`);
}

function value(raw: unknown, path: string, fail: Fail): number {
  const parsed = numberLineValue(raw);
  if (parsed === undefined) fail(path, "Expected a finite number or an exact fraction such as \"3/4\"");
  return parsed;
}

function text(raw: unknown, path: string, fail: Fail, max = 120): void {
  if (raw !== undefined && (typeof raw !== "string" || raw.length > max)) fail(path, `Expected text of at most ${max} characters`);
}

function list(raw: unknown, path: string, limit: number, fail: Fail): Record<string, unknown>[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(path, "Expected an array");
  if (raw.length > limit) fail(path, `A number line has at most ${limit} of these`);
  return raw.map((item, index) => record(item, `${path}/${index}`, fail));
}

/** The smallest tick interval, in value units. */
export function tickUnit(content: Pick<NumberLineContent, "range" | "ticks">): number {
  return planTickStep(content) / (content.ticks?.subdivisions ?? 1);
}

/** The major tick step: the author's, or 1, 2, 5 × 10ⁿ giving about ten steps over the range. */
export function planTickStep(content: Pick<NumberLineContent, "range" | "ticks">): number {
  if (content.ticks?.step !== undefined) return content.ticks.step;
  const span = content.range.max - content.range.min;
  const raw = span / 10;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw * (1 - 1e-9)) ?? 10 * power;
  return Number(step.toPrecision(12));
}

const near = (a: number, b: number, scale = 1) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(scale));

/**
 * Checks a number line's content (decision 0013). `fail` throws the caller's
 * error with a JSON path. Aliases, bindings and variables are checked by the
 * core validator; this checks what only the number line knows.
 */
export function validateNumberLineContent(raw: unknown, path: string, fail: Fail, options: { boundValues?: boolean } = {}): void {
  const content = record(raw, path, fail);
  only(content, ["title", "caption", "range", "ticks", "points", "jumps", "intervals", "bindings"], path, fail);
  text(content.title, `${path}/title`, fail);
  text(content.caption, `${path}/caption`, fail, 480);
  const range = record(content.range, `${path}/range`, fail);
  only(range, ["min", "max"], `${path}/range`, fail);
  const min = value(range.min, `${path}/range/min`, fail);
  const max = value(range.max, `${path}/range/max`, fail);
  if (typeof range.min !== "number" || typeof range.max !== "number") fail(`${path}/range`, "The range is given as numbers");
  if (!(min < max) || max - min > 1e6) fail(`${path}/range`, "The range needs min < max and a span of at most 1,000,000");

  const ticks = content.ticks === undefined ? {} : record(content.ticks, `${path}/ticks`, fail);
  only(ticks, ["step", "subdivisions", "labels", "format"], `${path}/ticks`, fail);
  if (ticks.step !== undefined && !(typeof ticks.step === "number" && ticks.step > 0 && Number.isFinite(ticks.step))) fail(`${path}/ticks/step`, "The tick step is a positive number");
  const subdivisions = ticks.subdivisions ?? 1;
  if (!Number.isInteger(subdivisions) || (subdivisions as number) < 1 || (subdivisions as number) > NUMBER_LINE_LIMITS.subdivisions) {
    fail(`${path}/ticks/subdivisions`, `Subdivisions are a whole number from 1 to ${NUMBER_LINE_LIMITS.subdivisions}`);
  }
  if (ticks.labels !== undefined && !["major", "all", "none"].includes(ticks.labels as string)) fail(`${path}/ticks/labels`, "Tick labels are major, all or none");
  if (ticks.format !== undefined && !["integer", "decimal", "fraction", "mixed"].includes(ticks.format as string)) fail(`${path}/ticks/format`, "The tick format is integer, decimal, fraction or mixed");
  const shape = { range: { min, max }, ticks: ticks as NumberLineContent["ticks"] };
  const step = planTickStep(shape);
  const unit = step / (subdivisions as number);
  if ((max - min) / unit > NUMBER_LINE_LIMITS.ticks + 1e-9) fail(`${path}/ticks`, `The range holds more than ${NUMBER_LINE_LIMITS.ticks} of the smallest ticks; use a larger step or fewer subdivisions`);
  if ((ticks.format === "fraction" || ticks.format === "mixed") && !Number.isInteger(step)) fail(`${path}/ticks/format`, "Fraction labels need a whole-number major step");
  if (ticks.format === "integer" && !Number.isInteger(step)) fail(`${path}/ticks/format`, "Integer labels need a whole-number major step");
  // Fraction ticks cannot carry integer labels: they would be rounded and name the wrong value.
  if (ticks.format === "integer" && ticks.labels === "all" && !Number.isInteger(unit)) {
    fail(`${path}/ticks`, "Integer labels on every tick need whole-number ticks; label only the major ticks, or use fraction or decimal labels");
  }

  const pointAliases = new Set<string>();
  for (const [index, point] of list(content.points, `${path}/points`, NUMBER_LINE_LIMITS.points, fail).entries()) {
    const pointPath = `${path}/points/${index}`;
    only(point, ["as", "value", "label", "style", "shown", "interaction"], pointPath, fail);
    const at = value(point.value, `${pointPath}/value`, fail);
    if (at < min - 1e-9 || at > max + 1e-9) fail(`${pointPath}/value`, "A point lies inside the line's range");
    text(point.label, `${pointPath}/label`, fail, 64);
    if (point.style !== undefined && point.style !== "closed" && point.style !== "open") fail(`${pointPath}/style`, "A point is closed or open");
    if (point.shown !== undefined && point.shown !== "always" && point.shown !== "when_emphasized") fail(`${pointPath}/shown`, "A point is shown always or when emphasized");
    if (point.interaction !== undefined) {
      const interaction = record(point.interaction, `${pointPath}/interaction`, fail);
      only(interaction, ["kind", "variable"], `${pointPath}/interaction`, fail);
      if (interaction.kind !== "drag" || typeof interaction.variable !== "string") fail(`${pointPath}/interaction`, "A point's interaction is {kind: \"drag\", variable}");
    }
    if (typeof point.as === "string") pointAliases.add(point.as);
  }

  // A value a variable drives is only where that variable starts; the core checks
  // it at every value the variable can take (boundValues), so the rules for
  // authored values (a jump moves, hops are whole) do not apply to it here.
  const bound = new Set((Array.isArray(content.bindings) ? content.bindings : [])
    .map((binding) => (binding as { target?: unknown }).target).filter((target): target is string => typeof target === "string"));
  for (const [index, jump] of list(content.jumps, `${path}/jumps`, NUMBER_LINE_LIMITS.jumps, fail).entries()) {
    const jumpPath = `${path}/jumps/${index}`;
    only(jump, ["as", "from", "by", "label", "hops"], jumpPath, fail);
    const loose = options.boundValues || bound.has(`${jump.as}.by`) || bound.has(`${jump.as}.from`);
    let start: number;
    if (typeof jump.from === "string" && numberLineValue(jump.from) === undefined) {
      if (!pointAliases.has(jump.from)) fail(`${jumpPath}/from`, `Jump start '${jump.from}' is not a point of this number line`);
      const point = (content.points as NumberLinePoint[]).find((candidate) => candidate.as === jump.from)!;
      start = numberLineValue(point.value)!;
    } else {
      start = value(jump.from, `${jumpPath}/from`, fail);
    }
    const by = value(jump.by, `${jumpPath}/by`, fail);
    // A variable may pass through 0 (a jump growing from nothing); an authored jump moves.
    if (by === 0 && !loose) fail(`${jumpPath}/by`, "A jump moves by a nonzero amount");
    const end = start + by;
    if (start < min - 1e-9 || start > max + 1e-9 || end < min - 1e-9 || end > max + 1e-9) fail(jumpPath, "A jump starts and ends inside the line's range");
    text(jump.label, `${jumpPath}/label`, fail, 32);
    if (jump.hops !== undefined && typeof jump.hops !== "boolean") fail(`${jumpPath}/hops`, "hops is true or false");
    if (jump.hops) {
      const count = Math.abs(by) / unit;
      // A variable may stop between ticks (the last hop is then drawn short), but never needs more hops than the limit.
      const whole = near(count, Math.round(count), count);
      if ((!whole && !loose) || Math.ceil(count - 1e-9) > NUMBER_LINE_LIMITS.hops) {
        fail(`${jumpPath}/hops`, `A jump drawn hop by hop moves a whole number of the smallest ticks, at most ${NUMBER_LINE_LIMITS.hops}`);
      }
    }
  }

  for (const [index, interval] of list(content.intervals, `${path}/intervals`, NUMBER_LINE_LIMITS.intervals, fail).entries()) {
    const intervalPath = `${path}/intervals/${index}`;
    only(interval, ["as", "from", "to", "from_closed", "to_closed", "label"], intervalPath, fail);
    if (!("from" in interval) || !("to" in interval)) fail(intervalPath, "An interval has from and to (null for an unbounded end)");
    const from = interval.from === null ? -Infinity : value(interval.from, `${intervalPath}/from`, fail);
    const to = interval.to === null ? Infinity : value(interval.to, `${intervalPath}/to`, fail);
    if (!(from < to)) fail(intervalPath, "An interval runs from a smaller value to a larger one");
    if (from !== -Infinity && (from < min - 1e-9 || from > max + 1e-9)) fail(`${intervalPath}/from`, "An interval's ends lie inside the line's range");
    if (to !== Infinity && (to < min - 1e-9 || to > max + 1e-9)) fail(`${intervalPath}/to`, "An interval's ends lie inside the line's range");
    for (const end of ["from_closed", "to_closed"]) {
      if (interval[end] !== undefined && typeof interval[end] !== "boolean") fail(`${intervalPath}/${end}`, `${end} is true or false`);
    }
    if (interval.from === null && interval.from_closed === true || interval.to === null && interval.to_closed === true) {
      fail(intervalPath, "An unbounded end cannot be closed");
    }
    text(interval.label, `${intervalPath}/label`, fail, 64);
  }
}

/** A tick label: plain text, or a fraction drawn stacked (with an optional whole part). */
export type TickLabel =
  | { kind: "text"; text: string }
  | { kind: "fraction"; negative: boolean; whole?: number; numerator: number; denominator: number };

export interface PlannedTick { value: number; major: boolean; label?: TickLabel }

/**
 * Decimal places that write every multiple of `unit` exactly: 0.25 needs two,
 * 0.5 one, 2 none. A unit with no short decimal (1/3) gets three places.
 */
export function decimalPlaces(unit: number): number {
  for (let digits = 0; digits <= 6; digits += 1) {
    const scaled = unit * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) <= 1e-9 * Math.max(1, Math.abs(scaled))) return digits;
  }
  return 3;
}

function formatDecimal(value: number, unit: number): string {
  const text = value.toFixed(decimalPlaces(unit)).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
  return text === "-0" || text === "−0" ? "0" : text.replace("-", "−");
}

/**
 * Every tick from the first at or after min to the last at or before max, on
 * the grid of the smallest tick (multiples of unit, counted from 0, so 0 is
 * always a tick when it is in range), with the labels the content asks for.
 */
export function planNumberLineTicks(content: Pick<NumberLineContent, "range" | "ticks">): PlannedTick[] {
  const step = planTickStep(content);
  const subdivisions = content.ticks?.subdivisions ?? 1;
  const unit = step / subdivisions;
  const labels = content.ticks?.labels ?? "major";
  const format = content.ticks?.format
    ?? (Number.isInteger(step) ? (subdivisions > 1 ? "fraction" : "integer") : "decimal");
  const first = Math.ceil(content.range.min / unit - 1e-9);
  const last = Math.floor(content.range.max / unit + 1e-9);
  const ticks: PlannedTick[] = [];
  for (let index = first; index <= last; index += 1) {
    const tickValue = Number((index * unit).toPrecision(12));
    const major = index % subdivisions === 0;
    const labelled = labels === "all" || (labels === "major" && major);
    let label: TickLabel | undefined;
    if (labelled) {
      if (format === "fraction" || format === "mixed") {
        // Tick index × step / subdivisions, over the subdivisions' denominator and not
        // reduced (0, 1/4, 2/4, 3/4, 1), so the learner can count the parts.
        const common = gcd(step, subdivisions);
        const denominator = subdivisions / common;
        const numerator = index * (step / common);
        if (numerator % denominator === 0) {
          label = { kind: "text", text: formatDecimal(numerator / denominator, 1) };
        } else {
          const negative = numerator < 0;
          const size = Math.abs(numerator);
          label = format === "mixed" && size > denominator
            ? { kind: "fraction", negative, whole: Math.floor(size / denominator), numerator: size % denominator, denominator }
            : { kind: "fraction", negative, numerator: size, denominator };
        }
      } else {
        // Integer labels go only on integer ticks; any other tick stays unlabelled rather than rounded.
        label = format === "integer" && !Number.isInteger(tickValue) ? undefined : { kind: "text", text: formatDecimal(tickValue, format === "integer" ? 1 : unit) };
      }
    }
    ticks.push({ value: tickValue, major, ...(label ? { label } : {}) });
  }
  return ticks;
}

/** A jump's start and end values, after bindings have been applied. */
export function jumpEnds(content: NumberLineContent, jump: NumberLineJump): { from: number; to: number } | undefined {
  const start = typeof jump.from === "string" && numberLineValue(jump.from) === undefined
    // Authoring names the point by alias; canonical content by fragment id.
    ? numberLineValue(content.points?.find((point) => point.as === jump.from || (point as { id?: string }).id === jump.from)?.value)
    : numberLineValue(jump.from);
  const by = numberLineValue(jump.by);
  if (start === undefined || by === undefined) return undefined;
  return { from: start, to: start + by };
}

/** The value nearest `value` on the smallest-tick grid, kept inside the range. */
export function snapToTick(content: Pick<NumberLineContent, "range" | "ticks">, value: number): number {
  const unit = tickUnit(content);
  const snapped = Math.round(value / unit) * unit;
  const first = Math.ceil(content.range.min / unit - 1e-9) * unit;
  const last = Math.floor(content.range.max / unit + 1e-9) * unit;
  return Number(Math.min(last, Math.max(first, snapped)).toPrecision(12));
}

/** A planned tick label as drawn: its centre, width (board units) and whether its tick is major. */
export interface LabelBox { x: number; width: number; major: boolean; value: number }

/**
 * Which tick labels to draw so none overlap (decision 0013 §1): every tick
 * stays, but labels thin out on a regular stride. Major labels come first, on
 * the smallest stride that fits, counted from 0 so 0 keeps its label; minor
 * labels are added only if all of them fit between. Returns the indexes of
 * the boxes to draw.
 */
export function visibleTickLabels(boxes: readonly LabelBox[], step: number, gap = 6): Set<number> {
  return planTickLabels(boxes, step, [], gap).shown;
}

/**
 * Rows for labels that must all be drawn (point names, marked tick values):
 * each takes the first row, counted from 0, where it clears the labels already
 * there. Returns each label's row, in the order given.
 */
export function stackLabels(labels: ReadonlyArray<{ x: number; width: number }>, gap = 6): number[] {
  const rows: number[] = new Array(labels.length).fill(0);
  const lastInRow: Array<{ x: number; width: number }> = [];
  const order = labels.map((_label, index) => index).sort((a, b) => labels[a]!.x - labels[b]!.x);
  for (const index of order) {
    const label = labels[index]!;
    let row = lastInRow.findIndex((previous) => label.x - label.width / 2 - (previous.x + previous.width / 2) >= gap);
    if (row < 0) row = lastInRow.length;
    lastInRow[row] = label;
    rows[index] = row;
  }
  return rows;
}

/** The tick labels to draw, and the row each sits in (0 is just under the line). */
export interface TickLabelPlan { shown: Set<number>; rows: Map<number, number>; rowCount: number }

/**
 * Like `visibleTickLabels`, but the values the card marks (its points and jump
 * ends) always keep their tick's label, so thinning never hides the number a
 * point sits on (−7 on a line labelled every 2). Only a tick the label policy
 * labels can be kept: a marked value on an unlabelled tick (a fourth under
 * "major" labels) stays unlabelled, as the author chose.
 * - On a thinned line, a stride label next to a marked label (the
 *   neighbouring labelled tick) or overlapping it is dropped; a marked value wins over 0.
 * - Marked labels that would overlap each other (−3 and −2 on a long line)
 *   go on further rows below, so every one is drawn and none overlap.
 */
export function planTickLabels(boxes: readonly LabelBox[], step: number, marked: readonly number[], gap = 6): TickLabelPlan {
  const clear = (a: LabelBox, b: LabelBox) => Math.abs(a.x - b.x) - a.width / 2 - b.width / 2 >= gap;
  const fits = (chosen: number[]) => chosen.every((index, position) => position === 0 || clear(boxes[chosen[position - 1]!]!, boxes[index]!));
  const all = boxes.map((_box, index) => index);
  const pinned = all.filter((index) => marked.some((value) => Math.abs(value - boxes[index]!.value) <= 1e-9 * Math.max(1, Math.abs(value))));
  const pinnedRows = stackLabels(pinned.map((index) => boxes[index]!), gap);
  const rows = new Map(pinned.map((index, position) => [index, pinnedRows[position]!]));
  const firstRow = pinned.filter((index) => rows.get(index) === 0);
  // On a thinned line a marked number stands apart: its labelled neighbours give way ("5", not "5 6").
  const free = (index: number) => firstRow.every((other) => other === index || (Math.abs(other - index) > 1 && clear(boxes[other]!, boxes[index]!)));
  if (fits(all)) return { shown: new Set(all), rows: new Map(all.map((index) => [index, 0])), rowCount: 1 };
  const majors = all.filter((index) => boxes[index]!.major);
  let chosen: number[] = [];
  for (let stride = 1; stride <= Math.max(1, majors.length); stride += 1) {
    const candidate = majors.filter((index) => Math.round(boxes[index]!.value / step) % stride === 0);
    if (fits(candidate)) { chosen = candidate; break; }
  }
  const shown = new Set([...chosen.filter((index) => !rows.has(index) && free(index)), ...pinned]);
  for (const index of shown) if (!rows.has(index)) rows.set(index, 0);
  return { shown, rows, rowCount: Math.max(1, ...pinnedRows.map((row) => row + 1)) };
}

/**
 * The pieces a jump is drawn in: one arc, or one hop per smallest tick. When
 * the distance is not a whole number of ticks (a variable between values),
 * the last hop is shorter, so the arrow still ends exactly at the jump's end.
 */
export function jumpHops(content: Pick<NumberLineContent, "range" | "ticks">, ends: { from: number; to: number }, hops: boolean): Array<{ from: number; to: number }> {
  const distance = ends.to - ends.from;
  if (!hops || distance === 0) return [{ ...ends }];
  const unit = tickUnit(content);
  const direction = Math.sign(distance);
  const count = Math.abs(distance) / unit;
  const whole = Math.floor(count + 1e-9);
  const pieces: Array<{ from: number; to: number }> = [];
  for (let hop = 0; hop < Math.min(whole, NUMBER_LINE_LIMITS.hops); hop += 1) {
    pieces.push({ from: ends.from + direction * hop * unit, to: ends.from + direction * (hop + 1) * unit });
  }
  const reached = pieces.at(-1)?.to ?? ends.from;
  if (Math.abs(ends.to - reached) > 1e-9 * Math.max(1, Math.abs(ends.to))) pieces.push({ from: reached, to: ends.to });
  return pieces;
}
