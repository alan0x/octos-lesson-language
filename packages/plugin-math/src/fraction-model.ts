/**
 * The fraction model (decision 0021, amended): a `fraction_model` card of the math plugin.
 *
 * The content states the meaning: a model (bar, circle or grid), one or two fractions, each a whole
 * number of equal parts shaded out of a denominator, over one or more wholes, and how two fractions
 * relate. This module is the card's program: its content rules and the plan the view draws, so the
 * view, the layout and a judge all read the same numbers. It imports nothing at run time, so the core
 * validator and the web runtime can both load it (decision 0013 §3).
 *
 * A bound numerator may pass between whole numbers while it animates; the plan shades whole parts
 * only (the nearest), so a part is never drawn half shaded.
 */

export const FRACTION_MODEL_KIND = "fraction_model";
export const FRACTION_MODEL_FEATURE = "plugin:math/fraction-model@1";
/** The math plugin version that introduced the fraction model. */
export const FRACTION_MODEL_PLUGIN_VERSION = "0.4.0";

/** Numeric fields of a fraction model that lesson variables may drive. */
export const FRACTION_MODEL_BINDINGS = {
  fractions: ["numerator"],
} as const;

/** Content fields whose items are addressable parts (`model#a`). */
export const FRACTION_MODEL_PART_FIELDS = ["fractions"] as const;

export const FRACTION_MODEL_LIMITS = {
  fractions: 2,
  /** Bars and circles (decision 0021, question 3). */
  denominator: 12,
  /** A grid has at most this many rows and columns (hundredths: 10 × 10). */
  gridSide: 10,
  wholes: 8,
  gridWholes: 4,
  splitMin: 2,
  splitMax: 6,
  /** Parts after splitting each part. */
  splitParts: 24,
} as const;

export type FractionModelKind = "bar" | "circle" | "grid";
export type FractionRelation = "compare" | "equivalent";

export interface FractionModelFraction {
  as: string;
  numerator: number;
  denominator: number;
  /** How many wholes are drawn; by default as many as the numerator fills (at least one). */
  wholes?: number;
  /** Each part is split again into this many equal parts (dashed). */
  split?: number;
  /** The first this many of the smallest parts are marked (one share), counted through the shaded parts. */
  highlight?: number;
}

export interface FractionModelContent {
  title?: string;
  caption?: string;
  model: FractionModelKind;
  grid?: { rows: number; columns: number };
  fractions: FractionModelFraction[];
  relation?: FractionRelation;
  bindings?: unknown[];
}

type Fail = (path: string, message: string) => never;

function record(value: unknown, path: string, fail: Fail): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "Expected an object");
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, allowed: readonly string[], path: string, fail: Fail): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}/${key}`, `Unknown fraction model field '${key}'`);
}

function text(raw: unknown, path: string, fail: Fail, max = 120): void {
  if (raw !== undefined && (typeof raw !== "string" || raw.length > max)) fail(path, `Expected text of at most ${max} characters`);
}

function wholeNumber(raw: unknown, path: string, low: number, high: number, fail: Fail, what: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < low || raw > high) fail(path, `${what} is a whole number from ${low} to ${high}`);
  return raw as number;
}

/** The wholes a fraction is drawn over: as written, or as many as its numerator fills. */
export function fractionWholes(fraction: Pick<FractionModelFraction, "numerator" | "denominator" | "wholes">): number {
  return fraction.wholes ?? Math.max(1, Math.ceil(Math.round(fraction.numerator) / fraction.denominator));
}

/** The whole parts shaded: the nearest whole number, within what the wholes hold. */
export function shadedParts(fraction: Pick<FractionModelFraction, "numerator" | "denominator" | "wholes">): number {
  return Math.min(Math.max(0, Math.round(fraction.numerator)), fraction.denominator * fractionWholes(fraction));
}

/**
 * Checks a fraction model's content. `boundValues` is set when the core checks the card at a value a
 * variable can take: the numerator may then stop between whole numbers (the view shades whole parts).
 */
export function validateFractionModelContent(raw: unknown, path: string, fail: Fail, options: { boundValues?: boolean } = {}): void {
  const content = record(raw, path, fail);
  only(content, ["title", "caption", "model", "grid", "fractions", "relation", "bindings"], path, fail);
  text(content.title, `${path}/title`, fail);
  text(content.caption, `${path}/caption`, fail, 480);
  const model = content.model;
  if (model !== "bar" && model !== "circle" && model !== "grid") fail(`${path}/model`, "The model is bar, circle or grid");
  let cells: number | undefined;
  if (model === "grid") {
    const grid = record(content.grid, `${path}/grid`, fail);
    only(grid, ["rows", "columns"], `${path}/grid`, fail);
    const rows = wholeNumber(grid.rows, `${path}/grid/rows`, 1, FRACTION_MODEL_LIMITS.gridSide, fail, "A grid's row count");
    const columns = wholeNumber(grid.columns, `${path}/grid/columns`, 1, FRACTION_MODEL_LIMITS.gridSide, fail, "A grid's column count");
    cells = rows * columns;
  } else if (content.grid !== undefined) {
    fail(`${path}/grid`, "Only a grid model has rows and columns");
  }

  if (!Array.isArray(content.fractions) || content.fractions.length < 1 || content.fractions.length > FRACTION_MODEL_LIMITS.fractions) {
    fail(`${path}/fractions`, "A fraction model shows one or two fractions");
  }
  const bound = new Set((Array.isArray(content.bindings) ? content.bindings : [])
    .map((binding) => (binding as { target?: unknown }).target).filter((target): target is string => typeof target === "string"));
  const fractions = (content.fractions as unknown[]).map((item, index) => record(item, `${path}/fractions/${index}`, fail));
  const aliases = new Set<string>();
  for (const [index, fraction] of fractions.entries()) {
    const at = `${path}/fractions/${index}`;
    only(fraction, ["as", "numerator", "denominator", "wholes", "split", "highlight"], at, fail);
    if (typeof fraction.as === "string") {
      if (aliases.has(fraction.as)) fail(`${at}/as`, `Fraction '${fraction.as}' is duplicated`);
      aliases.add(fraction.as);
    }
    const denominator = model === "grid"
      ? wholeNumber(fraction.denominator, `${at}/denominator`, 1, cells!, fail, "A grid fraction's denominator")
      : wholeNumber(fraction.denominator, `${at}/denominator`, 1, FRACTION_MODEL_LIMITS.denominator, fail, "A denominator");
    if (model === "grid" && denominator !== cells) fail(`${at}/denominator`, `A grid fraction's denominator is its cell count (${cells})`);
    const isBound = bound.has(`${fraction.as}.numerator`);
    if (isBound && fraction.wholes === undefined) fail(`${at}/wholes`, "A bound numerator needs its wholes written, so the card keeps one size as it moves");
    const maxWholes = model === "grid" ? FRACTION_MODEL_LIMITS.gridWholes : FRACTION_MODEL_LIMITS.wholes;
    if (fraction.wholes !== undefined) wholeNumber(fraction.wholes, `${at}/wholes`, 1, maxWholes, fail, "The number of wholes");
    const numerator = fraction.numerator;
    if (typeof numerator !== "number" || !Number.isFinite(numerator)) fail(`${at}/numerator`, "The numerator is a number");
    if (!Number.isInteger(numerator) && !options.boundValues && !isBound) fail(`${at}/numerator`, "The numerator is a whole number of parts");
    const wholes = fractionWholes({ numerator: numerator as number, denominator, wholes: fraction.wholes as number | undefined });
    if (wholes > maxWholes) fail(`${at}/numerator`, `The numerator fills at most ${maxWholes} wholes`);
    if ((numerator as number) < -1e-9 || Math.round(numerator as number) > denominator * wholes) {
      fail(`${at}/numerator`, `The numerator is from 0 to ${denominator * wholes} (${wholes} whole${wholes === 1 ? "" : "s"} of ${denominator})`);
    }
    let smallest = 1;
    if (fraction.split !== undefined) {
      if (model === "grid") fail(`${at}/split`, "A grid's parts are not split again");
      smallest = wholeNumber(fraction.split, `${at}/split`, FRACTION_MODEL_LIMITS.splitMin, FRACTION_MODEL_LIMITS.splitMax, fail, "A split");
      if (denominator * smallest > FRACTION_MODEL_LIMITS.splitParts) fail(`${at}/split`, `After splitting, a whole has at most ${FRACTION_MODEL_LIMITS.splitParts} parts`);
    }
    if (fraction.highlight !== undefined) {
      const highlight = wholeNumber(fraction.highlight, `${at}/highlight`, 1, denominator * smallest * wholes, fail, "A highlight");
      const shaded = shadedParts({ numerator: numerator as number, denominator, wholes: fraction.wholes as number | undefined }) * smallest;
      if (highlight > shaded) fail(`${at}/highlight`, `A highlight marks shaded parts only (${shaded} here)`);
    }
  }

  if (fractions.length === 2) {
    if (content.relation !== "compare" && content.relation !== "equivalent") fail(`${path}/relation`, "Two fractions are compared or shown equivalent");
    if (content.relation === "equivalent") {
      if (bound.size) fail(`${path}/bindings`, "An equivalence is fixed: its numerators are not bound");
      const [a, b] = fractions as unknown as FractionModelFraction[];
      if (a!.numerator * b!.denominator !== b!.numerator * a!.denominator) fail(`${path}/relation`, "Fractions shown equivalent are equal");
    }
  } else if (content.relation !== undefined) {
    fail(`${path}/relation`, "A relation needs two fractions");
  }
}

// ---------------------------------------------------------------- the plan the view draws

export const FRACTION_MODEL_VIEW_WIDTH = 520;
const SIDE = 20;
/** The stacked fraction label to the right of each model. */
const LABEL_COLUMN = 72;
const DRAW_WIDTH = FRACTION_MODEL_VIEW_WIDTH - 2 * SIDE - LABEL_COLUMN;
const ROW_GAP = 22;
/** From the last model's bottom to the relation line's baseline. */
const RELATION_ROW = 32;

/** One equal part of a whole, as the view draws it. */
export type FractionPartShape =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  /** Angles in degrees, clockwise from 12 o'clock; a full turn is a whole disc. */
  | { kind: "sector"; cx: number; cy: number; r: number; from: number; to: number };

export interface PlannedPart {
  shape: FractionPartShape;
  shaded: boolean;
}

export interface PlannedWhole {
  outline: FractionPartShape;
  parts: PlannedPart[];
  /** Dashed lines that split each part again: [x1, y1, x2, y2]. */
  splits: Array<[number, number, number, number]>;
  /** The smallest parts marked as one share. */
  highlights: FractionPartShape[];
}

export interface PlannedFraction {
  id: string;
  numerator: number;
  denominator: number;
  wholes: PlannedWhole[];
  /** Where the stacked label is centred. */
  label: { x: number; y: number };
  top: number;
  bottom: number;
}

export interface FractionModelPlan {
  width: number;
  height: number;
  fractions: PlannedFraction[];
  /** "3/4 > 2/3", computed from the values, centred under the drawings and labels; absent for one fraction. */
  relation?: { text: string; x: number; y: number };
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** <, = or > between two fractions, exactly. */
export function compareFractions(a: { numerator: number; denominator: number }, b: { numerator: number; denominator: number }): "<" | "=" | ">" {
  const left = a.numerator * b.denominator, right = b.numerator * a.denominator;
  return left < right ? "<" : left > right ? ">" : "=";
}

/** "3/4", as written: 4/4 stays 4/4 and 6/3 stays 6/3 (the lesson is about the parts). */
export const fractionText = (fraction: { numerator: number; denominator: number }) => `${fraction.numerator}/${fraction.denominator}`;

/** The size one whole is drawn at, the same for both fractions so they share a whole. */
function wholeSize(model: FractionModelKind, mostWholes: number): number {
  if (model === "bar") return 40;
  if (model === "circle") return mostWholes === 1 ? 72 : mostWholes === 2 ? 64 : 44;
  return mostWholes === 1 ? 200 : mostWholes === 2 ? 180 : 90;
}

/** The plan for content with bindings already applied (values as the board state holds them). */
export function planFractionModel(raw: Record<string, unknown>): FractionModelPlan {
  const content = raw as unknown as FractionModelContent;
  const fractions = content.fractions;
  const counts = fractions.map((fraction) => fractionWholes(fraction));
  const size = wholeSize(content.model, Math.max(...counts));
  const rows = content.grid?.rows ?? 1, columns = content.grid?.columns ?? 1;
  const planned: PlannedFraction[] = [];
  let y = 10;
  for (const [index, fraction] of fractions.entries()) {
    const wholes = counts[index]!;
    const shaded = shadedParts(fraction);
    const split = fraction.split ?? 1;
    const highlighted = fraction.highlight ?? 0;
    const d = fraction.denominator;
    const top = y;
    const planWholes: PlannedWhole[] = [];
    for (let whole = 0; whole < wholes; whole += 1) {
      const parts: PlannedPart[] = [];
      const splits: Array<[number, number, number, number]> = [];
      let outline: FractionPartShape;
      // A part is shaded when it is among the first `shaded` parts, counted through the wholes in order.
      const partState = (part: number) => ({ shaded: whole * d + part < shaded });
      // The smallest parts of this whole that the highlight marks, counted the same way.
      const small = d * split;
      const marked = Math.max(0, Math.min(small, highlighted - whole * small));
      const highlights: FractionPartShape[] = [];
      if (content.model === "bar") {
        const x = SIDE, top = y + whole * (size + 8), width = DRAW_WIDTH;
        outline = { kind: "rect", x, y: top, width, height: size };
        for (let piece = 0; piece < marked; piece += 1) highlights.push({ kind: "rect", x: x + piece * width / small, y: top, width: width / small, height: size });
        for (let part = 0; part < d; part += 1) {
          parts.push({ shape: { kind: "rect", x: x + part * width / d, y: top, width: width / d, height: size }, ...partState(part) });
          for (let cut = 1; cut < split; cut += 1) {
            const at = x + (part + cut / split) * width / d;
            splits.push([at, top, at, top + size]);
          }
        }
      } else if (content.model === "circle") {
        const perRow = 4;
        const column = whole % perRow, row = Math.floor(whole / perRow);
        const r = size;
        const cx = SIDE + r + column * (2 * r + 14), cy = y + r + row * (2 * r + 14);
        outline = { kind: "sector", cx, cy, r, from: 0, to: 360 };
        for (let piece = 0; piece < marked; piece += 1) highlights.push({ kind: "sector", cx, cy, r, from: piece * 360 / small, to: (piece + 1) * 360 / small });
        for (let part = 0; part < d; part += 1) {
          parts.push({ shape: { kind: "sector", cx, cy, r, from: part * 360 / d, to: (part + 1) * 360 / d }, ...partState(part) });
          for (let cut = 1; cut < split; cut += 1) {
            const angle = ((part + cut / split) * 360 / d - 90) * Math.PI / 180;
            splits.push([cx, cy, cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
          }
        }
      } else {
        const side = size;
        const x = SIDE + whole * (side + 14), top = y;
        const cellWidth = side / columns, cellHeight = side / rows;
        outline = { kind: "rect", x, y: top, width: side, height: side };
        for (let part = 0; part < d; part += 1) {
          const row = Math.floor(part / columns), column = part % columns;
          parts.push({ shape: { kind: "rect", x: x + column * cellWidth, y: top + row * cellHeight, width: cellWidth, height: cellHeight }, ...partState(part) });
          if (part < marked) highlights.push(parts.at(-1)!.shape);
        }
      }
      planWholes.push({ outline, parts, splits, highlights });
    }
    let height: number;
    if (content.model === "bar") height = wholes * (size + 8) - 8;
    else if (content.model === "circle") { const rowsOfCircles = Math.ceil(wholes / 4); height = rowsOfCircles * (2 * size + 14) - 14; }
    else height = size;
    planned.push({
      id: fraction.as, numerator: Math.round(fraction.numerator), denominator: d, wholes: planWholes,
      label: { x: FRACTION_MODEL_VIEW_WIDTH - SIDE - LABEL_COLUMN / 2, y: top + height / 2 },
      top, bottom: top + height,
    });
    y = top + height + ROW_GAP;
  }
  // Labels stand just right of the widest drawing, one column for both fractions.
  const right = Math.max(...planned.flatMap((fraction) => fraction.wholes.map((whole) => whole.outline.kind === "rect"
    ? whole.outline.x + whole.outline.width : whole.outline.cx + whole.outline.r)));
  for (const fraction of planned) fraction.label.x = Math.min(FRACTION_MODEL_VIEW_WIDTH - SIDE - LABEL_COLUMN / 2, right + LABEL_COLUMN / 2);
  const bottom = planned.at(-1)!.bottom;
  if (planned.length === 2 && content.relation) {
    const [a, b] = planned as [PlannedFraction, PlannedFraction];
    const relation = { text: `${fractionText(a)} ${compareFractions(a, b)} ${fractionText(b)}`, x: (SIDE + a.label.x + LABEL_COLUMN / 2) / 2, y: bottom + RELATION_ROW };
    return { width: FRACTION_MODEL_VIEW_WIDTH, height: Math.ceil(bottom + RELATION_ROW + 12), fractions: planned, relation };
  }
  return { width: FRACTION_MODEL_VIEW_WIDTH, height: Math.ceil(bottom + 12), fractions: planned };
}

/** A fraction in lowest terms, for a judge or a caption ("4/6" is 2/3). */
export function simplestFraction(fraction: { numerator: number; denominator: number }): { numerator: number; denominator: number } {
  const divisor = gcd(fraction.numerator, fraction.denominator) || 1;
  return { numerator: fraction.numerator / divisor, denominator: fraction.denominator / divisor };
}
