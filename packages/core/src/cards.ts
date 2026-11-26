/**
 * Cards the learner taps, routed by card kind: the trading mat (decision 0023) and the place-value chart (0025).
 *
 * A tap card is a plugin card whose own program decides what a tap does: it refuses a tap it cannot make
 * (with a reason and a sentence for the learner), and otherwise changes some of its fields, each bound to
 * its own lesson variable. The core validator, the reducer and the web runtime reach a card only through
 * its `TapCardKind` here, so a new card registers one entry instead of adding a branch at each call site.
 *
 * Field keys are binding targets, `${place}.${field}`: a place is named by `as` in authoring content and by
 * its canonical `id` on the board, so a kind derives the key from the content it is handed. A tap names a
 * place by its index into the kind's `places`, as the log does. A kind may also have card-level fields
 * (`cardFields`, the chart's `target`) that taps never change: each is bound by its bare name, and a
 * practice task's start sets it, so a task starts on its own number. This module imports nothing from the core's index (it takes `fail`
 * callbacks), so the core, the reducer and the web runtime can all load it.
 */
import {
  BASE_TEN_TRADE_KIND, BASE_TEN_TRADE_LIMITS, BASE_TEN_TRADE_PLACES, applyBaseTenTap, baseTenChanges, baseTenFacts, baseTenLanguage, baseTenMat,
  baseTenRefusalText, baseTenTapReachable, hasTray, validateBaseTenTradeContent, type BaseTenLanguage, type BaseTenMat, type BaseTenPlaceName, type BaseTenRefusal,
} from "../../plugin-math/src/base-ten-trade.js";
import {
  PLACE_VALUE_CHART_KIND, PLACE_VALUE_PLACE_ALIASES, PLACE_VALUE_TAP_PLACES, applyPlaceValueTap, placeValueChanges, placeValueChartState, placeValueDigitAt,
  placeValueFacts, placeValueLanguage, placeValueRefusalText, placeValueTapIndex, placeValueTapPlace, validatePlaceValueChartContent,
  type PlaceValueChartState, type PlaceValueRefusal, type PlaceValueTap,
} from "../../plugin-math/src/place-value-chart.js";
import type { JsonObject } from "./types.js";

type Fail = (path: string, message: string) => never;

/** One tap on a card: what kind of tap, at which place (an index into the card's places). */
export interface CardTap { kind: string; place: number }

/** One field a tap changed, as content values. */
export interface CardFieldChange { place: number; field: string; before: number; after: number }

/** A field a tap writes, with the range its own lesson variable must have (exactly, so no tap leaves it). */
export interface CardTapField { place: number; field: string; min: number; max: number }

export type CardTapResult<S> = { ok: true; state: S } | { ok: false; reason: string };

/** A `card_fact` task's completion, as authored (its node is the card). */
export type CardFactCompletion = { readonly fact: string } & Readonly<Record<string, unknown>>;

/** What the runtime knows when it lays a done task's pile back on the card. */
export interface CardDonePileContext {
  /** The card's content on the board (canonical: places named by `id`). */
  content: JsonObject;
  completion: CardFactCompletion;
  /** A bound variable's value in the task's practice pile: its start value, else its initial value, else 0. */
  startValue(alias: string | undefined): number;
  /** The pile logged when the learner said done on this task (by variable), if one was logged. */
  submitted?: Readonly<Record<string, number>>;
}

/** A fact a `card_fact` task reads on a card. */
export interface CardFactKind<S> {
  /** The completion fields this fact takes besides `kind`, `node` and `fact`. */
  readonly keys: readonly string[];
  /**
   * Checks the fact's own fields against the practice pile, `state` (a target the learner can reach).
   * `fail` takes the completion field the message is about (`at`, `value`).
   */
  validate?(completion: CardFactCompletion, state: S, fail: (field: string, message: string) => never): void;
  /** Reads the fact on the card as the learner left it, when they say done. */
  read(completion: CardFactCompletion, state: S): { actual: number; target: number; succeeded: boolean };
  /** The pile (by variable) the card shows once this task is done, while later tasks ask about it. */
  donePile(context: CardDonePileContext): Record<string, number> | undefined;
}

/** A card kind the learner (or a demonstration) taps. */
export interface TapCardKind<S = unknown> {
  readonly kind: string;
  /** Tap kinds an authoring `do: "tap"` may name. */
  readonly taps: readonly string[];
  /** Places an authoring tap's `at` may name; a tap's `place` is the index here. */
  readonly places: readonly string[];
  /** Checks content as written or revised (a starting pile). */
  validateContent(raw: unknown, path: string, fail: Fail): void;
  /** The card's state of play from its content (whole numbers). */
  state(content: unknown): S;
  /** The card's tap rules: the state a tap leaves, or the reason the card refuses it. */
  apply(state: S, tap: CardTap): CardTapResult<S>;
  /** The sentence the card says for a refusal, in `language` (the card's default when absent). */
  refusalText(reason: string, place: number, language?: string): string;
  /** The language the card speaks, from its content. */
  language(content: unknown): string;
  /** The fields that differ between two states, in a fixed order. */
  changes(before: S, after: S): CardFieldChange[];
  /** The fields a tap writes, each with the range its variable must have, in a fixed order. */
  tapFields(content: unknown): CardTapField[];
  /** The binding target that drives a field in this content: `${place}.${field}`, by `id` or `as`. */
  fieldTarget(content: unknown, place: number, field: string): string;
  /**
   * Card-level fields a lesson variable may drive, each bound by its bare name (its binding target is the
   * name). Taps never change them; a card task's practice start sets each, so it starts on its own number.
   */
  readonly cardFields?: readonly string[];
  /**
   * The content with its bound fields (tap fields and card fields) at the values `value` gives by binding
   * target (bindings dropped), for checking a pile. A field `value` leaves undefined keeps its written value.
   */
  contentAt(content: JsonObject, value: (target: string) => number | undefined): JsonObject;
  /**
   * The rules a card task's starting pile keeps besides the content's (a chart to build starts empty). A kind
   * that has them is also checked as its variables start it, bound fields at their initial values.
   */
  validateStart?(state: S, fail: (message: string) => never): void;
  /** The facts a `card_fact` task may read, by name. */
  readonly facts: Readonly<Record<string, CardFactKind<S>>>;
}

/** The place's name in content: its canonical `id` on the board, its `as` in authoring content. */
const placeName = (content: unknown, place: number): unknown => {
  const places = (content as { places?: unknown } | null)?.places;
  const item = (Array.isArray(places) ? places[place] : undefined) as { id?: unknown; as?: unknown } | undefined;
  return item?.id ?? item?.as;
};

/** The binding targets of a card's content, each to its trimmed expression (the last binding of a target wins). */
const boundTargets = (content: JsonObject): Map<string, string> =>
  new Map(((content.bindings ?? []) as Array<{ target: string; expression: string }>).map((binding) => [binding.target, binding.expression.trim()]));

/** The trading mat (decision 0023): tap rules, fields and facts of a `base_ten_trade` card. */
export const BASE_TEN_TRADE_CARD: TapCardKind<BaseTenMat> = Object.freeze({
  kind: BASE_TEN_TRADE_KIND,
  taps: ["gather", "ungather", "make", "break"],
  places: BASE_TEN_TRADE_PLACES,
  validateContent: (raw: unknown, path: string, fail: Fail) => validateBaseTenTradeContent(raw, path, fail),
  state: baseTenMat,
  apply: (mat: BaseTenMat, tap: CardTap): CardTapResult<BaseTenMat> => {
    const result = applyBaseTenTap(mat, tap as Parameters<typeof applyBaseTenTap>[1]);
    return result.ok ? { ok: true, state: result.mat } : result;
  },
  refusalText: (reason: string, place: number, language?: string) => baseTenRefusalText(reason as BaseTenRefusal, place, language as BaseTenLanguage | undefined),
  language: baseTenLanguage,
  changes: baseTenChanges,
  tapFields(content: unknown): CardTapField[] {
    const columns = (content as { columns?: unknown } | null)?.columns === 3 ? 3 : 2;
    const fields: CardTapField[] = [];
    for (let p = 0; p < columns; p += 1) {
      fields.push({ place: p, field: "count", min: 0, max: columns === 2 && p === 1 ? 9 : BASE_TEN_TRADE_LIMITS.drawn[p]! });
      if (hasTray(columns, p)) fields.push({ place: p, field: "tray", min: 0, max: BASE_TEN_TRADE_LIMITS.tray });
    }
    return fields;
  },
  fieldTarget: (content: unknown, place: number, field: string) => `${placeName(content, place)}.${field}`,
  contentAt(content: JsonObject, value: (target: string) => number | undefined): JsonObject {
    const at = structuredClone(content);
    delete at.bindings;
    for (const [p, place] of ((Array.isArray(at.places) ? at.places : []) as JsonObject[]).entries()) {
      for (const field of ["count", "tray"]) {
        const v = value(`${placeName(content, p)}.${field}`);
        if (v !== undefined) place[field] = v;
      }
    }
    return at;
  },
  facts: Object.freeze({
    /** Every place below the highest is under ten. */
    no_trade_left: {
      keys: [],
      read: (_completion: CardFactCompletion, mat: BaseTenMat) => {
        const actual = baseTenFacts(mat).no_trade_left ? 1 : 0;
        return { actual, target: 1, succeeded: actual === 1 };
      },
      /** Trading never changes the value: the practice pile's digits, each tray empty. */
      donePile({ content, startValue }: CardDonePileContext): Record<string, number> {
        const places = (Array.isArray(content.places) ? content.places : []) as Array<{ id?: string }>;
        const bound = boundTargets(content);
        const columns = places.length;
        const value = places.reduce((sum, place, p) => sum + startValue(bound.get(`${place.id}.count`)) * 10 ** p, 0);
        const result: Record<string, number> = {};
        places.forEach((place, p) => {
          const count = bound.get(`${place.id}.count`);
          if (count) result[count] = p === columns - 1 ? Math.floor(value / 10 ** p) : Math.floor(value / 10 ** p) % 10;
          const tray = bound.get(`${place.id}.tray`);
          if (tray) result[tray] = 0;
        });
        return result;
      },
    },
    /** The place `at` holds exactly `value`, its tray included (amendment 5). */
    count: {
      keys: ["at", "value"],
      /**
       * A count the learner makes by tapping: a place the card has, a whole number, not met by the practice
       * pile, and reached by an exact search over the card's tap rules from that pile.
       */
      validate(completion: CardFactCompletion, pile: BaseTenMat, fail: (field: string, message: string) => never): void {
        const place = BASE_TEN_TRADE_PLACES.indexOf(completion.at as BaseTenPlaceName);
        if (place < 0 || place >= pile.columns) {
          fail("at", `A count is of a place the card has: ${BASE_TEN_TRADE_PLACES.slice(0, pile.columns).join(", ")}`);
        }
        const value = completion.value;
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          fail("value", "A count is a whole number");
        }
        if (pile.counts[place] === value) {
          fail("value", `The practice pile already has ${value} ${completion.at}`);
        }
        const reached = [...new Set(baseTenTapReachable(pile).map((mat) => mat.counts[place]!))].sort((a, b) => a - b);
        if (!reached.includes(value as number)) {
          fail("value", `Tapping this pile makes ${reached.join(" or ")} ${completion.at}, never ${value}`);
        }
      },
      read: (completion: CardFactCompletion, mat: BaseTenMat) => {
        const actual = mat.counts[BASE_TEN_TRADE_PLACES.indexOf(completion.at as BaseTenPlaceName)] ?? 0;
        const target = completion.value as number;
        return { actual, target, succeeded: actual === target };
      },
      /**
       * The learner's own pile, as logged when they said done, laid tidy (each tray's units loose in their
       * place, so no count changes). Without a usable logged pile: the pile with that count and every tray
       * empty nearest the practice pile.
       */
      donePile({ content, completion, startValue, submitted }: CardDonePileContext): Record<string, number> | undefined {
        const places = (Array.isArray(content.places) ? content.places : []) as Array<{ id?: string }>;
        const bound = boundTargets(content);
        // Only a pile that holds the count asked for, every count and tray of the card, is the learner's done pile.
        const countAlias = bound.get(`${places[BASE_TEN_TRADE_PLACES.indexOf(completion.at as BaseTenPlaceName)]?.id}.count`);
        const usable = submitted && countAlias && submitted[countAlias] === completion.value
          && [...bound.values()].every((alias) => submitted[alias] !== undefined);
        if (usable && submitted) {
          const own: Record<string, number> = {};
          for (const place of places) {
            const count = bound.get(`${place.id}.count`);
            if (count) own[count] = submitted[count]!;
            const tray = bound.get(`${place.id}.tray`);
            if (tray) own[tray] = 0;
          }
          return own;
        }
        const start = baseTenMat({ ...content, places: places.map((place) => ({ ...place, count: startValue(bound.get(`${place.id}.count`)), tray: startValue(bound.get(`${place.id}.tray`)) })) });
        const p = BASE_TEN_TRADE_PLACES.indexOf(completion.at as BaseTenPlaceName);
        const distance = (mat: typeof start) => mat.counts.reduce((sum, count, q) => sum + Math.abs(count - start.counts[q]!), 0);
        const made = baseTenTapReachable(start).filter((mat) => mat.counts[p] === completion.value && mat.trays.every((tray) => tray === 0))
          .sort((a, b) => distance(a) - distance(b))[0];
        if (!made) return undefined;
        const result: Record<string, number> = {};
        places.forEach((place, q) => {
          const count = bound.get(`${place.id}.count`);
          if (count) result[count] = made.counts[q]!;
          const tray = bound.get(`${place.id}.tray`);
          if (tray) result[tray] = 0;
        });
        return result;
      },
    },
  }),
});

/** A chart place's content item: by its place number, never by its position (columns differ per chart). */
const chartPlace = (content: unknown, place: number): { id?: unknown; as?: unknown } | undefined => {
  const places = (content as { places?: unknown } | null)?.places;
  return (Array.isArray(places) ? places : []).find((item) => (item as { place?: unknown } | null)?.place === place) as { id?: unknown; as?: unknown } | undefined;
};
const chartFieldTarget = (content: unknown, index: number, field: string): string => {
  const place = placeValueTapPlace(index);
  const item = chartPlace(content, place);
  return `${item?.id ?? item?.as ?? PLACE_VALUE_PLACE_ALIASES[place]}.${field}`;
};

/** The chart's content at a pile given by variable (bound fields only), for reading a fact on it. */
const chartContentAtPile = (content: JsonObject, bound: Map<string, string>, pile: Readonly<Record<string, number>>): JsonObject =>
  PLACE_VALUE_CHART_CARD.contentAt(content, (target) => {
    const alias = bound.get(target);
    return alias === undefined ? undefined : pile[alias];
  });

/**
 * The chart's pile once a task is done: the learner's own, as logged when they said done, when it holds the
 * fact; else the one the fact describes (built: the number's digits; pulled apart: every place in its part).
 * The number is the task's own, so later tasks ask about the chart the learner made.
 */
function chartDonePile(fact: "built" | "pulled_all") {
  return ({ content, startValue, submitted }: CardDonePileContext): Record<string, number> | undefined => {
    const bound = boundTargets(content);
    const aliases = [...bound.values()];
    if (submitted && aliases.every((alias) => submitted[alias] !== undefined)
      && placeValueFacts(placeValueChartState(chartContentAtPile(content, bound, submitted)))[fact]) {
      return Object.fromEntries(aliases.map((alias) => [alias, submitted[alias]!]));
    }
    const targetAlias = bound.get("target");
    const target = targetAlias ? startValue(targetAlias) : Number(content.target);
    const result: Record<string, number> = {};
    if (targetAlias) result[targetAlias] = target;
    for (const item of (Array.isArray(content.places) ? content.places : []) as Array<{ id?: string; as?: string; place: number }>) {
      const name = item.id ?? item.as;
      const digit = placeValueDigitAt(target, item.place);
      const count = bound.get(`${name}.count`);
      if (count) result[count] = fact === "built" ? digit : 0;
      const pulled = bound.get(`${name}.pulled`);
      if (pulled) result[pulled] = fact === "built" ? 0 : digit;
    }
    return result;
  };
}

/** A fact of one task only: a chart to build is built, a chart to pull apart is pulled apart. */
const chartFact = (fact: "built" | "pulled_all", mode: "build" | "apart"): CardFactKind<PlaceValueChartState> => ({
  keys: [],
  validate(_completion: CardFactCompletion, state: PlaceValueChartState, fail: (field: string, message: string) => never): void {
    if (state.mode !== mode) fail("fact", `'${fact}' is read on a chart whose mode is '${mode}'; this chart's is '${state.mode}'`);
  },
  read: (_completion: CardFactCompletion, state: PlaceValueChartState) => {
    const actual = placeValueFacts(state)[fact] ? 1 : 0;
    return { actual, target: 1, succeeded: actual === 1 };
  },
  donePile: chartDonePile(fact),
});

/**
 * The place-value chart (decision 0025): build a number disk by disk (`add`, `remove`), or pull it apart place
 * by place (`take_out`). A tap's place is its index in `PLACE_VALUE_TAP_PLACES` (the place plus three); an
 * authoring tap's `at` is the place's alias. The number (`target`) is a card-level field.
 */
export const PLACE_VALUE_CHART_CARD: TapCardKind<PlaceValueChartState> = Object.freeze({
  kind: PLACE_VALUE_CHART_KIND,
  taps: ["add", "remove", "take_out"],
  places: PLACE_VALUE_TAP_PLACES,
  cardFields: ["target"],
  validateContent: (raw: unknown, path: string, fail: Fail) => validatePlaceValueChartContent(raw, path, fail),
  state: placeValueChartState,
  apply: (state: PlaceValueChartState, tap: CardTap): CardTapResult<PlaceValueChartState> =>
    applyPlaceValueTap(state, { tap: tap.kind as PlaceValueTap["tap"], place: placeValueTapPlace(tap.place) }),
  refusalText: (reason: string, _place: number, language?: string) => placeValueRefusalText(reason as PlaceValueRefusal, language === "zh-CN" ? "zh-CN" : "en-US"),
  language: placeValueLanguage,
  changes: (before: PlaceValueChartState, after: PlaceValueChartState): CardFieldChange[] =>
    placeValueChanges(before, after).map(({ place, field, before: from, after: to }) => ({ place: placeValueTapIndex(place), field, before: from, after: to })),
  tapFields(content: unknown): CardTapField[] {
    const state = placeValueChartState(content);
    return state.columns.flatMap((place) => [
      { place: placeValueTapIndex(place), field: "count", min: 0, max: 9 },
      ...(state.mode === "apart" ? [{ place: placeValueTapIndex(place), field: "pulled", min: 0, max: 9 }] : []),
    ]);
  },
  fieldTarget: chartFieldTarget,
  contentAt(content: JsonObject, value: (target: string) => number | undefined): JsonObject {
    const at = structuredClone(content);
    delete at.bindings;
    for (const item of (Array.isArray(at.places) ? at.places : []) as JsonObject[]) {
      for (const field of at.mode === "apart" ? ["count", "pulled"] : ["count"]) {
        const v = value(`${item.id ?? item.as}.${field}`);
        if (v !== undefined) item[field] = v;
      }
    }
    const target = value("target");
    if (target !== undefined) at.target = target;
    return at;
  },
  /** A chart to build starts empty; one to pull apart starts whole, nothing pulled out. */
  validateStart(state: PlaceValueChartState, fail: (message: string) => never): void {
    state.columns.forEach((place, i) => {
      const digit = placeValueDigitAt(state.target, place);
      if (state.mode === "build" && state.counts[i] !== 0) fail(`A chart to build starts empty; it has ${state.counts[i]} in place ${place}`);
      if (state.mode === "apart" && (state.counts[i] !== digit || state.pulled[i] !== 0)) {
        fail(`A chart to pull apart starts whole, nothing pulled out; place ${place} has ${state.counts[i]} on the chart and ${state.pulled[i]} pulled out, of ${digit}`);
      }
    });
  },
  facts: Object.freeze({
    /** Build: the chart holds exactly the number (each place under ten, so its digits). */
    built: chartFact("built", "build"),
    /** Pull apart: every place has been taken out. */
    pulled_all: chartFact("pulled_all", "apart"),
  }),
});

/** Every card kind the learner taps, by node kind. */
export const TAP_CARD_KINDS: Readonly<Record<string, TapCardKind>> = Object.freeze({
  [BASE_TEN_TRADE_KIND]: BASE_TEN_TRADE_CARD as TapCardKind,
  [PLACE_VALUE_CHART_KIND]: PLACE_VALUE_CHART_CARD as TapCardKind,
});

/** The tap card of a node kind, or undefined when the kind is not one. */
export function tapCardKind(kind: unknown): TapCardKind | undefined {
  return typeof kind === "string" && Object.hasOwn(TAP_CARD_KINDS, kind) ? TAP_CARD_KINDS[kind] : undefined;
}

/** The node kinds of every tap card, in registration order. */
export const TAP_CARD_KIND_NAMES: readonly string[] = Object.freeze(Object.keys(TAP_CARD_KINDS));

/** Kinds joined for a message: "a", "a or b", "a, b or c". */
export function tapCardKindList(conjunction: "or" | "and" = "or"): string {
  const names = TAP_CARD_KIND_NAMES;
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1)}`;
}
