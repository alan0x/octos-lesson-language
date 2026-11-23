/**
 * A slider on a trading card's count (decision 0023 amendment 4): which lesson variables take one, and
 * the card and place each moves. Each stop of such a slider is one trade made by the card's tap rules
 * (`baseTenSliderMove`), never a direct write, so the total never changes.
 */
import type { CanonicalEvent, SemanticBoardState } from "../../core/src/index.js";
import { BASE_TEN_SLIDER_STEP, baseTenBoundField, baseTenSliderPlace } from "../../plugin-math/src/base-ten-trade.js";

export interface CardSliderTarget {
  /** The card's node. */
  nodeId: string;
  /** The place whose count the slider moves (0 = ones). */
  place: number;
  /** The lesson variable of each count and tray of the card, keyed `<place>.count` / `<place>.tray`. */
  variables: Map<string, string>;
}

/** The card a slider on this variable trades on, or undefined for any other variable. */
export function cardSliderTarget(board: SemanticBoardState | null | undefined, alias: string): CardSliderTarget | undefined {
  const variable = board?.variables?.[alias];
  if (variable?.control?.kind !== "slider" || variable.control.step !== BASE_TEN_SLIDER_STEP) return undefined;
  for (const node of Object.values(board!.nodes)) {
    if (node.kind !== "base_ten_trade") continue;
    const place = baseTenSliderPlace(node.content, alias);
    if (place === undefined) continue;
    const variables = new Map<string, string>();
    for (const binding of (Array.isArray(node.content?.bindings) ? node.content.bindings : []) as Array<{ expression?: unknown }>) {
      const bound = typeof binding?.expression === "string" ? binding.expression.trim() : "";
      const field = bound && board!.variables?.[bound] ? baseTenBoundField(node.content, bound) : undefined;
      if (field) variables.set(`${field.place}.${field.field}`, bound);
    }
    return { nodeId: node.id, place, variables };
  }
  return undefined;
}

/**
 * The lesson variables whose slider trades on a card the lesson writes, whether or not the card is on the
 * board yet: such a slider is never a plain slider, even before its card is drawn.
 */
export function cardSliderAliases(events: readonly CanonicalEvent[]): Set<string> {
  const sliders = events.flatMap((event) => event.lesson?.variables ?? [])
    .filter((variable) => variable.control?.kind === "slider" && variable.control.step === BASE_TEN_SLIDER_STEP)
    .map((variable) => variable.as);
  const aliases = new Set<string>();
  if (!sliders.length) return aliases;
  for (const event of events) {
    for (const beat of event.step?.beats ?? []) {
      for (const action of Object.values(beat.stage ?? {}).flat()) {
        if (action?.op !== "board.create" || action.node?.kind !== "base_ten_trade") continue;
        for (const alias of sliders) if (baseTenSliderPlace(action.node.content, alias) !== undefined) aliases.add(alias);
      }
    }
  }
  return aliases;
}
