/**
 * Builds a `place_value_compare` card (decision 0029) from neutral input, for Coach's recipe and Studio's tool
 * alike. Every value is an exact integer count of thousandths; each number may also give the decimals it is written
 * with (0.70: 2), when more than it needs. A number, its decimals, the demonstration's "compared" and the learner's
 * "marked" and "signed" are a whole number, or a lesson variable's expression with its starting value: the builder
 * writes the starting value into the card and binds it, so a learner's tap, the demonstration or a practice task's
 * start can change it. The card opens fresh: "compared", "marked" and "signed" start at 0 unless given.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { DrivenValue } from "./number-line-builder.js";
import type { PlaceValueLanguage } from "./place-value-chart.js";
import {
  PLACE_VALUE_COMPARE_KIND, placeValueCompareFaultText, placeValueCompareMakePair, placeValueCompareOwnDecimals,
  type PlaceValueCompareContent, type PlaceValueComparePair,
} from "./place-value-compare.js";

export interface PlaceValueCompareInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  /** The card's own words: `zh-CN` for Chinese; leave it out for US English. */
  language?: PlaceValueLanguage;
  /** The two numbers, in integer thousandths (0.625 is 625). */
  a: number | DrivenValue;
  b: number | DrivenValue;
  /** The decimals each number is written with, when more than it needs (0.70: 2). */
  a_decimals?: number | DrivenValue;
  b_decimals?: number | DrivenValue;
  /** The demonstration's "compared" (0 on a fresh card). */
  compared?: number | DrivenValue;
  /** The learner's columns judged and sign chosen (0 on a fresh card). */
  marked?: number | DrivenValue;
  signed?: number | DrivenValue;
}

export interface BuiltPlaceValueCompare {
  actions: AuthoringAction[];
  whole: string;
  parts: Record<string, string>;
  /** The starting pair (its columns, deciding place and relation come from it). */
  pair: PlaceValueComparePair;
}

const driven = (value: unknown): value is DrivenValue =>
  typeof value === "object" && value !== null && typeof (value as DrivenValue).expression === "string";

export function buildPlaceValueCompare(input: PlaceValueCompareInput): BuiltPlaceValueCompare {
  const bindings: Array<{ target: string; expression: string }> = [];
  const value = (raw: number | DrivenValue, target: string): number => {
    if (!driven(raw)) return raw;
    bindings.push({ target, expression: raw.expression });
    return raw.initial;
  };
  const a = value(input.a, "a");
  const b = value(input.b, "b");
  const aDec = input.a_decimals === undefined ? undefined : value(input.a_decimals, "a_decimals");
  const bDec = input.b_decimals === undefined ? undefined : value(input.b_decimals, "b_decimals");
  const numbers = [{ value: a, dec: aDec ?? placeValueCompareOwnDecimals(a) }, { value: b, dec: bDec ?? placeValueCompareOwnDecimals(b) }] as const;
  const made = placeValueCompareMakePair(numbers[0], numbers[1]);
  if ("fault" in made) throw new Error(placeValueCompareFaultText(made.fault, numbers[0], numbers[1]));
  const content: PlaceValueCompareContent = {
    ...(input.language !== undefined ? { language: input.language } : {}),
    a,
    b,
    ...(aDec !== undefined ? { a_decimals: aDec } : {}),
    ...(bDec !== undefined ? { b_decimals: bDec } : {}),
    compared: value(input.compared ?? 0, "compared"),
    marked: value(input.marked ?? 0, "marked"),
    signed: value(input.signed ?? 0, "signed"),
    ...(bindings.length ? { bindings } : {}),
  };
  return {
    actions: [{ do: "write", as: input.as, kind: PLACE_VALUE_COMPARE_KIND, role: input.role, content, place: input.place } as unknown as AuthoringAction],
    whole: input.as,
    parts: { whole: input.as },
    pair: made,
  };
}
