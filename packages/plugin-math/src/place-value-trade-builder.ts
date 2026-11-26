/**
 * Builds a `place_value_trade` card (decision 0026) from neutral input, for Coach's recipe and Studio's tool
 * alike. Every value is an exact integer count of thousandths (two decimals at most). The two numbers, the
 * demonstration's "columns finished" and each column's status are a whole number, or a lesson variable's
 * expression with its starting value: the builder writes the starting value into the card and binds it, so a
 * learner's tap, the demonstration or a practice task's start can change it.
 *
 * The columns are fixed for the card: the ones the starting pair needs (0026 §2). A practice pair of the same
 * shape needs the same columns; the core refuses one that does not.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { DrivenValue } from "./number-line-builder.js";
import { PLACE_VALUE_PLACE_ALIASES, type PlaceValueLanguage } from "./place-value-chart.js";
import {
  PLACE_VALUE_TRADE_KIND, placeValueTradeColumns, placeValueTradeColumnsFor,
  type PlaceValueTradeContent, type PlaceValueTradeOperation, type PlaceValueTradePlace,
} from "./place-value-trade.js";

export interface PlaceValueTradeInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  /** The card's own words: `zh-CN` for Chinese; leave it out for US English. */
  language?: PlaceValueLanguage;
  operation: PlaceValueTradeOperation;
  /** The first and second number, in integer thousandths (subtracting, the first is the larger). */
  a: number | DrivenValue;
  b: number | DrivenValue;
  /** The demonstration: columns finished, counting from the right (0 when left out). */
  finished?: number | DrivenValue;
  /** Each column's status, by place (5 to -2); a place left out starts at 0. */
  places?: Array<{ place: number; status?: number | DrivenValue }>;
}

export interface BuiltPlaceValueTrade {
  actions: AuthoringAction[];
  whole: string;
  /** Part name to OLL reference: `whole`, and each column by its alias (`ones`, `tenths`, `hundred-thousands`). */
  parts: Record<string, string>;
}

const driven = (value: unknown): value is DrivenValue =>
  typeof value === "object" && value !== null && typeof (value as DrivenValue).expression === "string";

export function buildPlaceValueTrade(input: PlaceValueTradeInput): BuiltPlaceValueTrade {
  const bindings: Array<{ target: string; expression: string }> = [];
  const value = (raw: number | DrivenValue, target: string): number => {
    if (!driven(raw)) return raw;
    bindings.push({ target, expression: raw.expression });
    return raw.initial;
  };
  const a = value(input.a, "a");
  const b = value(input.b, "b");
  const finished = value(input.finished ?? 0, "finished");
  const { top_place, low_place } = placeValueTradeColumnsFor(input.operation, a, b);
  const given = new Map((input.places ?? []).map((item) => [item.place, item]));
  const places: PlaceValueTradePlace[] = placeValueTradeColumns(top_place, low_place).map((place) => {
    const as = PLACE_VALUE_PLACE_ALIASES[place]!;
    return { as, place, status: value(given.get(place)?.status ?? 0, `${as}.status`) };
  });
  const content: PlaceValueTradeContent = {
    ...(input.language !== undefined ? { language: input.language } : {}),
    operation: input.operation,
    top_place,
    low_place,
    a,
    b,
    finished,
    places,
    ...(bindings.length ? { bindings } : {}),
  };
  const parts: Record<string, string> = { whole: input.as };
  for (const place of places) parts[place.as] = `${input.as}#${place.as}`;
  return {
    actions: [{ do: "write", as: input.as, kind: PLACE_VALUE_TRADE_KIND, role: input.role, content, place: input.place } as unknown as AuthoringAction],
    whole: input.as,
    parts,
  };
}
