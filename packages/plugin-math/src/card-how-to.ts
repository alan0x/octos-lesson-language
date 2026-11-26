/**
 * How to work a card the learner taps, by card kind (owner, 2026-11-24: how a component is used is its own
 * fixed text). A host shows it with a task on the card. Only the trading mat has one so far.
 */
import { BASE_TEN_TRADE_KIND, baseTenHowTo } from "./base-ten-trade.js";

const HOW_TO: Readonly<Record<string, (content: unknown) => string>> = Object.freeze({
  [BASE_TEN_TRADE_KIND]: baseTenHowTo,
});

/** The card's how-to text in its language, or undefined for a kind that has none. */
export function cardHowTo(kind: string, content: unknown): string | undefined {
  return Object.hasOwn(HOW_TO, kind) ? HOW_TO[kind]!(content) : undefined;
}
