/**
 * Builds a `place_value_chart` card (decision 0025) from neutral input, for Coach's recipe and Studio's tool
 * alike. Every value is an exact integer count of thousandths. The target, each count and each pulled count
 * is a whole number, or a lesson variable's expression with its starting value: the builder writes the
 * starting value into the card and binds it, so a tap (or a practice task's start) can change it.
 *
 * The columns are fixed for the card: the builder covers every number the card will show (the lesson's and
 * each practice task's) with whole periods in the card's language, and adds tenths to thousandths when any
 * of them has a fraction part.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { DrivenValue } from "./number-line-builder.js";
import {
  PLACE_VALUE_CHART_KIND, PLACE_VALUE_PLACE_ALIASES, placeValueColumns, placeValueColumnsFor, placeValueDigitAt,
  type PlaceValueChartContent, type PlaceValueChartPlace, type PlaceValueGiven, type PlaceValueLanguage, type PlaceValueMode,
} from "./place-value-chart.js";

export interface PlaceValueChartInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  /** The chart's own words: `zh-CN` for Chinese; leave it out for US English. */
  language?: PlaceValueLanguage;
  mode: PlaceValueMode;
  /** Build: name, expanded, expanded_factors or place_counts. Pull apart: numeral. */
  given: PlaceValueGiven;
  /** The number, in integer thousandths. */
  target: number | DrivenValue;
  /**
   * Every other number the card will show, in integer thousandths (each practice task's): the columns cover
   * them all, so the card never resizes. The target's starting value is always covered.
   */
  numbers?: number[];
  /**
   * Counts per place, by place (6 to -3); a place left out starts empty when building, and full (the
   * target's digit, nothing pulled) when pulling apart.
   */
  places?: Array<{ place: number; count?: number | DrivenValue; pulled?: number | DrivenValue }>;
}

export interface BuiltPlaceValueChart {
  actions: AuthoringAction[];
  whole: string;
  /** Part name to OLL reference: `whole`, and each place by its alias (`ones`, `tenths`, `hundred-thousands`). */
  parts: Record<string, string>;
}

const driven = (value: unknown): value is DrivenValue =>
  typeof value === "object" && value !== null && typeof (value as DrivenValue).expression === "string";

export function buildPlaceValueChart(input: PlaceValueChartInput): BuiltPlaceValueChart {
  const bindings: Array<{ target: string; expression: string }> = [];
  const value = (raw: number | DrivenValue, target: string): number => {
    if (!driven(raw)) return raw;
    bindings.push({ target, expression: raw.expression });
    return raw.initial;
  };
  const target = value(input.target, "target");
  const { top_place, decimals } = placeValueColumnsFor([target, ...(input.numbers ?? [])], input.language);
  const given = new Map((input.places ?? []).map((item) => [item.place, item]));
  const places: PlaceValueChartPlace[] = placeValueColumns(top_place, decimals).map((place) => {
    const as = PLACE_VALUE_PLACE_ALIASES[place]!;
    const item = given.get(place);
    const count = value(item?.count ?? (input.mode === "apart" ? placeValueDigitAt(target, place) : 0), `${as}.count`);
    if (input.mode !== "apart") return { as, place, count };
    return { as, place, count, pulled: value(item?.pulled ?? 0, `${as}.pulled`) };
  });
  const content: PlaceValueChartContent = {
    ...(input.language !== undefined ? { language: input.language } : {}),
    mode: input.mode,
    given: input.given,
    top_place,
    decimals,
    target,
    places,
    ...(bindings.length ? { bindings } : {}),
  };
  const parts: Record<string, string> = { whole: input.as };
  for (const place of places) parts[place.as] = `${input.as}#${place.as}`;
  return {
    actions: [{ do: "write", as: input.as, kind: PLACE_VALUE_CHART_KIND, role: input.role, content, place: input.place } as unknown as AuthoringAction],
    whole: input.as,
    parts,
  };
}
