/**
 * How to work a card the learner taps, by card kind (owner, 2026-11-24: how a component is used is its own
 * fixed text). A host shows it with a task on the card: the trading mat, the place-value chart, and the
 * place-value trade card (whose card also draws its own line that follows the chart; decision 0026), and the
 * make-ten card (which names the giving addend's colour; decision 0027).
 */
import { BASE_TEN_TRADE_KIND, baseTenHowTo } from "./base-ten-trade.js";
import { PLACE_VALUE_CHART_KIND, placeValueHowTo } from "./place-value-chart.js";
import { PLACE_VALUE_TRADE_KIND, placeValueTradeHowTo } from "./place-value-trade.js";
import { MAKE_TEN_KIND, makeTenHowTo } from "./make-ten.js";

const HOW_TO: Readonly<Record<string, (content: unknown) => string>> = Object.freeze({
  [BASE_TEN_TRADE_KIND]: baseTenHowTo,
  [PLACE_VALUE_CHART_KIND]: placeValueHowTo,
  [PLACE_VALUE_TRADE_KIND]: placeValueTradeHowTo,
  [MAKE_TEN_KIND]: makeTenHowTo,
});

/** The card's how-to text in its language, or undefined for a kind that has none. */
export function cardHowTo(kind: string, content: unknown): string | undefined {
  return Object.hasOwn(HOW_TO, kind) ? HOW_TO[kind]!(content) : undefined;
}
