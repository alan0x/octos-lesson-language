/**
 * Cards the learner taps, routed by card kind: the trading mat (decision 0023), the place-value chart (0025),
 * the place-value trade card, adding and subtracting on the chart as the written method (0026), and the
 * place-value times-ten card, an amount counted in another unit (0028).
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
  PLACE_VALUE_CHART_KIND, PLACE_VALUE_PLACE_ALIASES, PLACE_VALUE_TAP_PLACES, applyPlaceValueTap, placeValueChanges, placeValueChartState, placeValueColumnName, placeValueDigitAt,
  placeValueFacts, placeValueLanguage, placeValueRefusalText, placeValueTapIndex, placeValueTapPlace, validatePlaceValueChartContent,
  type PlaceValueChartState, type PlaceValueRefusal, type PlaceValueTap,
} from "../../plugin-math/src/place-value-chart.js";
import {
  PLACE_VALUE_TRADE_CARD_BINDINGS, PLACE_VALUE_TRADE_KIND, PLACE_VALUE_TRADE_PROBLEM_FIELDS, PLACE_VALUE_TRADE_TAPS, PLACE_VALUE_TRADE_WORDS,
  applyPlaceValueTradeTap, placeValueTradeChanges, placeValueTradeColumns, placeValueTradeComplete, placeValueTradeDemoSteps, placeValueTradeLanguage,
  placeValueTradeMaxStatus, placeValueTradeProblemOn, placeValueTradeRefusalText, placeValueTradeStartFault, placeValueTradeState, validatePlaceValueTradeContent,
  type PlaceValueTradeOperation, type PlaceValueTradeState, type PlaceValueTradeTapKind,
} from "../../plugin-math/src/place-value-trade.js";
import {
  PLACE_VALUE_TIMES_TEN_CARD_BINDINGS, PLACE_VALUE_TIMES_TEN_DEMONSTRATION_FIELD, PLACE_VALUE_TIMES_TEN_KIND, PLACE_VALUE_TIMES_TEN_MAX_ROWS,
  PLACE_VALUE_TIMES_TEN_PROBLEM_FIELDS, PLACE_VALUE_TIMES_TEN_ROW_FIELDS, PLACE_VALUE_TIMES_TEN_TAP_PLACES, PLACE_VALUE_TIMES_TEN_TAPS, PLACE_VALUE_TIMES_TEN_WORDS,
  applyPlaceValueTimesTenTap, placeValueTimesTenChanges, placeValueTimesTenComplete, placeValueTimesTenContentProblem, placeValueTimesTenCountedInFault, placeValueTimesTenCountedInMeaning, placeValueTimesTenCountedInReplayFault,
  placeValueTimesTenAnswerParts, placeValueTimesTenDoneText, placeValueTimesTenLanguage, placeValueTimesTenPath, placeValueTimesTenPosition, placeValueTimesTenRefusalText, placeValueTimesTenRowFields,
  placeValueTimesTenState, placeValueTimesTenStateStartFault, validatePlaceValueTimesTenContent,
  type PlaceValueTimesTenContent, type PlaceValueTimesTenState, type PlaceValueTimesTenTapKind,
} from "../../plugin-math/src/place-value-times-ten.js";
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
  /**
   * The card judges this fact itself, on each of the learner's taps: the tap that makes it true ends the task
   * (the player submits it), so there is no "done" (decision 0026 §3). A task on it allows only tapping its card.
   */
  readonly judgedOnTap?: boolean;
  /** The pile (by variable) the card shows once this task is done, while later tasks ask about it. */
  donePile(context: CardDonePileContext): Record<string, number> | undefined;
}

/**
 * How a lesson shows a card through one of its card-level fields instead of tapping it (decision 0026: "columns
 * finished"). The card itself says which values the field takes, what the next valid value does (for a refusal),
 * and where a fresh card starts; core applies these to every animation, replay and practice start, wherever the
 * card is written. Each refusal is the sentence that follows the variable's name ("'finished' counts the columns
 * …: it goes forward, not from 2 back to 1; the next value, 3, finishes the hundreds").
 */
export interface CardDemonstration {
  /** The card-level field the lesson animates. */
  readonly field: string;
  /** What a tap field is, for a refusal: "a column's state". */
  readonly tapState: string;
  /** How the lesson shows the card instead, after the field's name in a refusal: "(columns finished, counting from the right), and the program plays each column". */
  readonly shows: string;
  /** The card a replay lays fresh, for a refusal: "chart". */
  readonly fresh: string;
  /**
   * The card opens fresh: as written, and as its variables start it, the field is at `start` (a card that would
   * open with its demonstration already played is refused). Absent: a card may open at any value it takes.
   */
  readonly opensAtStart?: boolean;
  /** The field's value on a fresh card, nothing demonstrated (decision 0026: 0). A practice start sets it here. */
  start(content: unknown): number;
  /** Why the lesson may not animate the field from `from` to `to` on this card (a refusal), or undefined. */
  refuseStep(content: unknown, from: number, to: number): string | undefined;
  /** Why a replay may not set the field to `value` (a refusal; the card's own content rules follow), or undefined. */
  refuseReplay(content: unknown, value: number): string | undefined;
  /** The field's values on this card, for an animation outside its variable's range (a refusal). */
  outside(content: unknown, value: number): string;
}

/**
 * A demonstration field that counts forward a whole number at a time (decision 0026's "columns finished"): from its
 * start, never back (the same value again changes nothing), within `range`. `counts` begins each refusal ("counts
 * the columns a place_value_trade card has finished"); `next` says what the next value after one does.
 */
export interface WholeForwardDemonstration extends CardDemonstration {
  /** The field's range on this card ("0 to 4 columns"). */
  range(content: unknown): { min: number; max: number };
  /** What the next value after `value` does on this card ("the next value, 3, finishes the hundreds"), or why none. */
  next(content: unknown, value: number): string;
}
export function wholeForwardDemonstration(spec: {
  field: string; counts: string; tapState: string; shows: string; fresh: string; opensAtStart?: boolean;
  start(content: unknown): number;
  range(content: unknown): { min: number; max: number };
  next(content: unknown, value: number): string;
}): WholeForwardDemonstration {
  return Object.freeze({
    range: spec.range, next: spec.next,
    field: spec.field, tapState: spec.tapState, shows: spec.shows, fresh: spec.fresh, ...(spec.opensAtStart ? { opensAtStart: true } : {}),
    start: spec.start,
    refuseStep(content: unknown, from: number, to: number): string | undefined {
      if (!Number.isInteger(to)) return `${spec.counts}: a whole number, not ${to}; from ${from}, ${spec.next(content, from)}`;
      if (to < from) return `${spec.counts}: it goes forward, not from ${from} back to ${to}; ${spec.next(content, from)}`;
      return undefined;
    },
    refuseReplay: (_content: unknown, value: number): string | undefined => (Number.isInteger(value) ? undefined : `${spec.counts}: a whole number, not ${value}`),
    outside(content: unknown, value: number): string {
      const { min, max } = spec.range(content);
      return `${spec.counts}: ${min} to ${max}, not ${value}`;
    },
  });
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
  /**
   * The sentence the card says for a refusal, in `language` (the card's default when absent). With `state`, the
   * card as it was tapped, a card may state the counts behind it ("This column has 3; taking away 6 needs more.").
   */
  refusalText(reason: string, place: number, language?: string, state?: S): string;
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
   * The card-level fields that make a task's own problem (all of `cardFields` when absent): each is bound, a
   * card task's start sets it, and the start's values are not all the lesson's own (a chart's number; the
   * trade card's pair, which differs as a pair).
   */
  readonly practiceFields?: readonly string[];
  /**
   * A card the lesson shows only through one card-level field (decision 0026: "columns finished"): the lesson
   * never taps it nor moves its tap fields, and that field's variable moves forward, a whole number at a time.
   */
  readonly demonstration?: CardDemonstration;
  /** Every bound field changes at once when a task starts (a column's status is a state, not an amount to ease). */
  readonly fieldsAtOnce?: boolean;
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
  /**
   * The typed answers the card's own problem has, in order, with the sentence that states them (decision 0028):
   * a typed task anchored to the card right after a task on it asks these, so its answers are the card's.
   */
  answers?(state: S, language?: string): { values: number[]; text: string } | undefined;
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
    const targetAlias = bound.get("target");
    const target = targetAlias ? startValue(targetAlias) : Number(content.target);
    // A logged pile is the learner's only if it is a chart they could have made on this task: the task's own
    // number (never one read from the pile itself), every place 0 to 9, and in pulling apart each place's
    // disks either on the chart or in its part (review of #113: a tampered pile replayed as wrong maths).
    const places = (Array.isArray(content.places) ? content.places : []) as Array<{ id?: string; as?: string; place: number }>;
    const fits = (pile: Readonly<Record<string, number>>): boolean => {
      if (targetAlias && pile[targetAlias] !== target) return false;
      return places.every((item) => {
        const name = item.id ?? item.as;
        const count = bound.get(`${name}.count`);
        const pulled = bound.get(`${name}.pulled`);
        const values = [count, pulled].filter((alias): alias is string => alias !== undefined).map((alias) => pile[alias]!);
        if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 9)) return false;
        return pulled === undefined || (count !== undefined && pile[count]! + pile[pulled]! === placeValueDigitAt(target, item.place));
      });
    };
    if (submitted && aliases.every((alias) => submitted[alias] !== undefined) && fits(submitted)
      && placeValueFacts(placeValueChartState(chartContentAtPile(content, bound, submitted)))[fact]) {
      return Object.fromEntries(aliases.map((alias) => [alias, submitted[alias]!]));
    }
    const result: Record<string, number> = {};
    if (targetAlias) result[targetAlias] = target;
    for (const item of places) {
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

/** The tap a trade card's refusal answers: each reason belongs to one tap. */
const TRADE_TAP_OF_REASON: Readonly<Record<string, PlaceValueTradeTapKind>> = Object.freeze({
  already_down: "down", already_taken: "down", not_enough: "down",
  not_down: "trade", not_ten: "trade", no_left: "trade",
  none_to_break: "break", no_right: "break", not_needed: "break",
  // A chart showing a demonstration refuses every tap alike.
  demonstrating: "down",
});

/** The trade card's content at a pile given by binding target (bound fields only). */
const tradeContentAt = (content: JsonObject, value: (target: string) => number | undefined): JsonObject => {
  const at = structuredClone(content);
  delete at.bindings;
  for (const item of (Array.isArray(at.places) ? at.places : []) as JsonObject[]) {
    const v = value(`${item.id ?? item.as}.status`);
    if (v !== undefined) item.status = v;
  }
  for (const field of PLACE_VALUE_TRADE_CARD_BINDINGS) {
    const v = value(field);
    if (v !== undefined) at[field] = v;
  }
  return at;
};

/** The trade card's demonstration (decision 0026): "columns finished, counting from the right", 0 to the columns, forward only. */
export const PLACE_VALUE_TRADE_DEMONSTRATION: WholeForwardDemonstration = wholeForwardDemonstration({
  field: "finished",
  counts: `counts the columns a ${PLACE_VALUE_TRADE_KIND} card has finished`,
  tapState: "a column's state",
  shows: "(columns finished, counting from the right), and the program plays each column",
  fresh: "chart",
  start: () => 0,
  range: (content: unknown) => ({ min: 0, max: placeValueTradeState(content).problem.columns.length }),
  next(content: unknown, value: number): string {
    const columns = placeValueTradeState(content).problem.columns;
    const k = Math.max(0, Math.floor(value));
    const place = columns[columns.length - 1 - k];
    return place === undefined ? `every column is finished at ${columns.length}` : `the next value, ${k + 1}, finishes the ${placeValueColumnName(place).toLowerCase()}`;
  },
});

/**
 * The place-value trade card (decision 0026): add or subtract on the chart drawn as the written method. The
 * learner's taps are `down` (the arrow under a column), `trade` (a ringed ten) and `break` (a disk), at a
 * place's index in `PLACE_VALUE_TAP_PLACES` (the place plus three); each changes one column's status. The two
 * numbers and the demonstration's "columns finished" are card-level fields. The lesson never taps the card:
 * it shows it by "columns finished", and the program plays each column's bring-down, trades and breaks.
 */
export const PLACE_VALUE_TRADE_CARD: TapCardKind<PlaceValueTradeState> = Object.freeze({
  kind: PLACE_VALUE_TRADE_KIND,
  taps: PLACE_VALUE_TRADE_TAPS,
  places: PLACE_VALUE_TAP_PLACES,
  cardFields: PLACE_VALUE_TRADE_CARD_BINDINGS,
  practiceFields: PLACE_VALUE_TRADE_PROBLEM_FIELDS,
  demonstration: PLACE_VALUE_TRADE_DEMONSTRATION,
  fieldsAtOnce: true,
  validateContent: (raw: unknown, path: string, fail: Fail) => validatePlaceValueTradeContent(raw, path, fail),
  state: placeValueTradeState,
  apply: (state: PlaceValueTradeState, tap: CardTap): CardTapResult<PlaceValueTradeState> => {
    const result = applyPlaceValueTradeTap(state, { tap: tap.kind as PlaceValueTradeTapKind, place: placeValueTapPlace(tap.place) });
    return result.ok ? { ok: true, state: result.state } : { ok: false, reason: result.reason };
  },
  refusalText(reason: string, place: number, language?: string, state?: PlaceValueTradeState): string {
    const lang = language === "zh-CN" ? "zh-CN" : "en-US";
    const tap = TRADE_TAP_OF_REASON[reason];
    if (state && tap) {
      const text = placeValueTradeRefusalText(state, { tap, place: placeValueTapPlace(place) }, lang);
      if (text) return text;
    }
    // Without the card as tapped: the reason's own sentence when it has no counts.
    const words = PLACE_VALUE_TRADE_WORDS[lang];
    const plain = reason === "not_down" ? words.refusal.nothing_yet : (words.refusal as Record<string, unknown>)[reason];
    return typeof plain === "string" ? plain : words.other;
  },
  language: placeValueTradeLanguage,
  changes: (before: PlaceValueTradeState, after: PlaceValueTradeState): CardFieldChange[] =>
    placeValueTradeChanges(before, after).map(({ place, field, before: from, after: to }) => ({ place: placeValueTapIndex(place), field, before: from, after: to })),
  tapFields(content: unknown): CardTapField[] {
    const { problem } = placeValueTradeState(content);
    return problem.columns.map((place) => ({ place: placeValueTapIndex(place), field: "status", min: 0, max: placeValueTradeMaxStatus(problem.operation) }));
  },
  fieldTarget: chartFieldTarget,
  contentAt: tradeContentAt,
  /** A practice chart starts fresh: no column worked, nothing demonstrated. */
  validateStart(state: PlaceValueTradeState, fail: (message: string) => never): void {
    const fault = placeValueTradeStartFault(state);
    if (fault) fail(fault);
  },
  facts: Object.freeze({
    /**
     * Every column is finished: the answer row reads the answer in disks. Judged on each tap, so the task ends
     * on the tap that completes the chart (there is no "done"); the typed answer is a task of its own after it.
     */
    complete: {
      keys: [],
      judgedOnTap: true,
      read: (_completion: CardFactCompletion, state: PlaceValueTradeState) => {
        const actual = placeValueTradeComplete(state) ? 1 : 0;
        return { actual, target: 1, succeeded: actual === 1 };
      },
      /**
       * The one finished chart of the task's own pair (every tap order ends on it, 0026 §3), computed, never read
       * from a logged pile: the numbers are the task's, nothing is demonstrated, each column's status as finished.
       */
      donePile({ content, startValue }: CardDonePileContext): Record<string, number> | undefined {
        const bound = boundTargets(content);
        const number = (field: "a" | "b") => (bound.has(field) ? startValue(bound.get(field)) : Number(content[field]));
        const columns = placeValueTradeColumns(Number(content.top_place), Number(content.low_place));
        const operation: PlaceValueTradeOperation = content.operation === "subtract" ? "subtract" : "add";
        let final: PlaceValueTradeState;
        try {
          final = placeValueTradeDemoSteps(placeValueTradeProblemOn(operation, number("a"), number("b"), columns)).final;
        } catch {
          return undefined;
        }
        const result: Record<string, number> = {};
        for (const [target, alias] of bound) {
          if (target === "a" || target === "b") result[alias] = number(target);
          else if (target === "finished") result[alias] = 0;
          else {
            const item = ((Array.isArray(content.places) ? content.places : []) as Array<{ id?: string; as?: string; place: number }>)
              .find((candidate) => `${candidate.id ?? candidate.as}.status` === target);
            if (item) result[alias] = final.status[item.place] ?? 0;
          }
        }
        return result;
      },
    },
  }),
});

/** The tap a times-ten card's refusal answers: each reason belongs to one tap. */
const TIMES_TEN_TAP_OF_REASON: Readonly<Record<string, PlaceValueTimesTenTapKind>> = Object.freeze({
  no_thing: "move", at_target: "move", demonstrating: "move", copy_short: "copy", copy_full: "copy", not_times: "copy", smaller: "smaller",
});

/** The times-ten card's content at a pile given by binding target (bound fields only; every field is card-level). */
const timesTenContentAt = (content: JsonObject, value: (target: string) => number | undefined): JsonObject => {
  const at = structuredClone(content);
  delete at.bindings;
  for (const field of [...PLACE_VALUE_TIMES_TEN_CARD_BINDINGS, ...PLACE_VALUE_TIMES_TEN_ROW_FIELDS]) {
    const v = value(field);
    if (v !== undefined && (field !== "moved_twice" || at.apart === 2)) at[field] = v;
  }
  return at;
};

/** The problem a times-ten content's numbers make, or undefined when the card refuses them. */
const timesTenProblem = (content: unknown) => {
  const problem = placeValueTimesTenContentProblem(content);
  return "fault" in problem ? undefined : problem;
};
const TIMES_TEN_NO_PROBLEM = "is a place_value_times_ten card's demonstration, but the card's numbers are not a problem it takes";

/**
 * The times-ten card's demonstration (decision 0028): "counted in", the unit the amount is counted in now, in
 * thousandths. It starts at the unit the question names (never 0), and moves along the problem's path toward the
 * target (0.1 -> 0.01 -> 0.001, or 100 -> 70 for a times pair), never back; a replay sets any value of the path.
 * Each refusal names the path and the next valid values.
 */
export const PLACE_VALUE_TIMES_TEN_DEMONSTRATION: CardDemonstration = Object.freeze({
  field: PLACE_VALUE_TIMES_TEN_DEMONSTRATION_FIELD,
  tapState: "a set of the rows the learner moved",
  shows: "(counted in: the unit the amount is counted in now, from the unit the question names to the target, in thousandths), and the program plays each row's move",
  fresh: "chart",
  opensAtStart: true,
  start(content: unknown): number {
    const problem = timesTenProblem(content);
    return problem ? problem.start : Number((content as { counted_in?: unknown } | null)?.counted_in);
  },
  refuseStep(content: unknown, from: number, to: number): string | undefined {
    const problem = timesTenProblem(content);
    return problem ? placeValueTimesTenCountedInFault(problem, from, to) : TIMES_TEN_NO_PROBLEM;
  },
  refuseReplay(content: unknown, value: number): string | undefined {
    const problem = timesTenProblem(content);
    return problem ? placeValueTimesTenCountedInReplayFault(problem, value) : TIMES_TEN_NO_PROBLEM;
  },
  outside(content: unknown, value: number): string {
    const problem = timesTenProblem(content);
    return problem ? `${placeValueTimesTenCountedInMeaning(problem)}; ${value} is outside its variable's range` : TIMES_TEN_NO_PROBLEM;
  },
});

/**
 * The place-value times-ten card (decision 0028): an amount counted in another unit, a count (3 tenths = ?
 * thousandths) or a times pair (700 is ? times 70). The learner's taps are `move` (a row's disk, row of ten or
 * square moves one place toward the target), and on a times pair `copy` and `smaller`, always refused with the
 * fact they ask about; a tap's place is its row (`row-1` to `row-10`). The learner's state is one or two row sets
 * (`moved_once`, `moved_twice`, 0 to 511, bit i = row i), bound by their bare names like the card's numbers. The
 * lesson never taps the card: it shows it by "counted in", and the program plays each row's move.
 */
export const PLACE_VALUE_TIMES_TEN_CARD: TapCardKind<PlaceValueTimesTenState> = Object.freeze({
  kind: PLACE_VALUE_TIMES_TEN_KIND,
  taps: PLACE_VALUE_TIMES_TEN_TAPS,
  places: PLACE_VALUE_TIMES_TEN_TAP_PLACES,
  cardFields: PLACE_VALUE_TIMES_TEN_CARD_BINDINGS,
  practiceFields: PLACE_VALUE_TIMES_TEN_PROBLEM_FIELDS,
  demonstration: PLACE_VALUE_TIMES_TEN_DEMONSTRATION,
  fieldsAtOnce: true,
  validateContent: (raw: unknown, path: string, fail: Fail) => validatePlaceValueTimesTenContent(raw, path, fail),
  state: placeValueTimesTenState,
  apply: (state: PlaceValueTimesTenState, tap: CardTap): CardTapResult<PlaceValueTimesTenState> => {
    const result = applyPlaceValueTimesTenTap(state, { tap: tap.kind as PlaceValueTimesTenTapKind, row: tap.place });
    return result.ok ? { ok: true, state: result.state } : { ok: false, reason: result.reason };
  },
  refusalText(reason: string, place: number, language?: string, state?: PlaceValueTimesTenState): string {
    const lang = language === "zh-CN" ? "zh-CN" : "en-US";
    const tap = TIMES_TEN_TAP_OF_REASON[reason];
    if (state && tap) {
      const text = placeValueTimesTenRefusalText(state, { tap, row: place }, lang);
      if (text) return text;
    }
    const words = PLACE_VALUE_TIMES_TEN_WORDS[lang];
    return reason === "demonstrating" ? words.refusal.demonstrating : words.other;
  },
  language: placeValueTimesTenLanguage,
  // A row set is a card-level field: its change is named by the field, at the card's first place.
  changes: (before: PlaceValueTimesTenState, after: PlaceValueTimesTenState): CardFieldChange[] =>
    placeValueTimesTenChanges(before, after).map(({ field, before: from, after: to }) => ({ place: 0, field, before: from, after: to })),
  tapFields(content: unknown): CardTapField[] {
    const apart = (content as { apart?: unknown } | null)?.apart === 2 ? 2 : 1;
    return placeValueTimesTenRowFields(apart).map((field) => ({ place: 0, field, min: 0, max: PLACE_VALUE_TIMES_TEN_MAX_ROWS }));
  },
  fieldTarget: (_content: unknown, _place: number, field: string) => field,
  contentAt: timesTenContentAt,
  /** A practice chart starts fresh: counted in at its own start unit, no row moved. */
  validateStart(state: PlaceValueTimesTenState, fail: (message: string) => never): void {
    const fault = placeValueTimesTenStateStartFault(state);
    if (fault) fail(fault);
  },
  answers(state: PlaceValueTimesTenState, language?: string) {
    const p = state.problem;
    if (!p.n) return undefined;
    const lang = language === "zh-CN" ? "zh-CN" : "en-US";
    const values = placeValueTimesTenAnswerParts(p, lang).flatMap((part) => ("blank" in part ? [part.blank.answer] : []));
    return { values, text: placeValueTimesTenDoneText(p, lang).replace(/^✓ /u, "") };
  },
  facts: Object.freeze({
    /**
     * Every row has reached the target: the chart holds the amount in the target unit (a times pair: ten whole
     * copies). Judged on each tap, so the task ends on the tap that completes the chart; the typed answer is a
     * task of its own after it.
     */
    complete: {
      keys: [],
      judgedOnTap: true,
      read: (_completion: CardFactCompletion, state: PlaceValueTimesTenState) => {
        const actual = placeValueTimesTenComplete(state) ? 1 : 0;
        return { actual, target: 1, succeeded: actual === 1 };
      },
      /**
       * The one finished chart of the task's own problem (every tap order ends on it), computed, never read from a
       * logged pile: the task's numbers, "counted in" at the task's own start unit, every row moved.
       */
      donePile({ content, startValue }: CardDonePileContext): Record<string, number> | undefined {
        const bound = boundTargets(content);
        const number = (field: string) => (bound.has(field) ? startValue(bound.get(field)) : Number(content[field]));
        const own = { ...content, amount: number("amount"), target: number("target") } as Partial<PlaceValueTimesTenContent>;
        const problem = placeValueTimesTenContentProblem(own);
        if ("fault" in problem) return undefined;
        const rows = 2 ** problem.n - 1;
        const result: Record<string, number> = {};
        for (const [target, alias] of bound) {
          if (target === "amount" || target === "target") result[alias] = number(target);
          else if (target === "counted_in") result[alias] = problem.start;
          else if (target === "moved_once" || target === "moved_twice") result[alias] = rows;
        }
        return result;
      },
    },
  }),
});

/** Every card kind the learner taps, by node kind. */
export const TAP_CARD_KINDS: Readonly<Record<string, TapCardKind>> = Object.freeze({
  [BASE_TEN_TRADE_KIND]: BASE_TEN_TRADE_CARD as TapCardKind,
  [PLACE_VALUE_CHART_KIND]: PLACE_VALUE_CHART_CARD as TapCardKind,
  [PLACE_VALUE_TRADE_KIND]: PLACE_VALUE_TRADE_CARD as TapCardKind,
  [PLACE_VALUE_TIMES_TEN_KIND]: PLACE_VALUE_TIMES_TEN_CARD as TapCardKind,
});

/** The tap card of a node kind, or undefined when the kind is not one. */
export function tapCardKind(kind: unknown): TapCardKind | undefined {
  return typeof kind === "string" && Object.hasOwn(TAP_CARD_KINDS, kind) ? TAP_CARD_KINDS[kind] : undefined;
}

/** The node kinds of every tap card, in registration order. */
export const TAP_CARD_KIND_NAMES: readonly string[] = Object.freeze(Object.keys(TAP_CARD_KINDS));

/** Kinds joined for a message: "a", "a or b", "a, b or c". */
export function tapCardKindList(conjunction: "or" | "and" = "or", names: readonly string[] = TAP_CARD_KIND_NAMES): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1)}`;
}

/** The kinds a lesson may tap (a demonstration tap): every tap card except those shown by a demonstration field. */
export const LESSON_TAP_CARD_KIND_NAMES: readonly string[] = Object.freeze(TAP_CARD_KIND_NAMES.filter((name) => !TAP_CARD_KINDS[name]!.demonstration));

/** The kinds a lesson may tap, joined for a message. */
export const lessonTapCardKindList = (conjunction: "or" | "and" = "or"): string => tapCardKindList(conjunction, LESSON_TAP_CARD_KIND_NAMES);
