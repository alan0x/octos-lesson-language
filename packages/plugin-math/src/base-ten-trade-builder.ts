/**
 * Builds a `base_ten_trade` card (decision 0023) from neutral input, for Coach's recipe and Studio's
 * tool alike. Each count and tray is a whole number, or a lesson variable's expression with its
 * starting value: the builder writes the starting value into the card and binds it. A card the learner
 * taps binds every count and tray to its own variable, so a tap can change them.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { DrivenValue } from "./number-line-builder.js";
import { BASE_TEN_TRADE_KIND, BASE_TEN_TRADE_PLACES, type BaseTenTradeContent, type BaseTenTradePlace } from "./base-ten-trade.js";

export interface BaseTenTradeInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  title?: string;
  caption?: string;
  /** 2 (tens and ones) or 3 (hundreds, tens and ones); fixed, so the card never resizes. */
  columns: 2 | 3;
  /** Lowest place first: ones, tens, then hundreds when there are 3 columns. */
  places: Array<{ count: number | DrivenValue; tray?: number | DrivenValue }>;
}

export interface BuiltBaseTenTrade {
  actions: AuthoringAction[];
  whole: string;
  /** Part name to OLL reference: `whole`, and each place by its name (`ones`, `tens`, `hundreds`). */
  parts: Record<string, string>;
}

const driven = (value: unknown): value is DrivenValue =>
  typeof value === "object" && value !== null && typeof (value as DrivenValue).expression === "string";

export function buildBaseTenTrade(input: BaseTenTradeInput): BuiltBaseTenTrade {
  const bindings: Array<{ target: string; expression: string }> = [];
  const value = (raw: number | DrivenValue, target: string): number => {
    if (!driven(raw)) return raw;
    bindings.push({ target, expression: raw.expression });
    return raw.initial;
  };
  const places: BaseTenTradePlace[] = input.places.map((place, p) => {
    const as = BASE_TEN_TRADE_PLACES[p]!;
    return {
      as,
      count: value(place.count, `${as}.count`),
      ...(place.tray !== undefined ? { tray: value(place.tray, `${as}.tray`) } : {}),
    };
  });
  const content: BaseTenTradeContent = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    columns: input.columns,
    places,
    ...(bindings.length ? { bindings } : {}),
  };
  const parts: Record<string, string> = { whole: input.as };
  for (const place of places) parts[place.as] = `${input.as}#${place.as}`;
  return {
    actions: [{ do: "write", as: input.as, kind: BASE_TEN_TRADE_KIND, role: input.role, content, place: input.place } as unknown as AuthoringAction],
    whole: input.as,
    parts,
  };
}
