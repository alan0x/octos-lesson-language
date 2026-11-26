// Problems for the place-value trade card's tests (decision 0026): the accepted sketch's list (sketch v2,
// model.mjs PROBLEMS), each shown problem with its practice pair, written as a learner writes them; and
// trade lessons for the tests and the browser check: a card built by the recipe builder, the two numbers,
// "columns finished" and every column's status bound to its own variable, and practice tasks on their own
// pair, each followed by a typed answer anchored to the card.
import type { AuthoringLesson } from "../../core/src/index.js";
import { PLACE_VALUE_PLACE_ALIASES, placeValueNumeral, type PlaceValueLanguage } from "../src/place-value-chart.js";
import { buildPlaceValueTrade } from "../src/place-value-trade-builder.js";
import {
  placeValueTradeColumns, placeValueTradeColumnsFor, placeValueTradeMaxStatus, placeValueTradeParse, type PlaceValueTradeOperation,
} from "../src/place-value-trade.js";

/** A problem as written: the two numbers, the operation, and its practice pair of the same kind. */
export interface TradeProblemText {
  a: string;
  op: "+" | "-";
  b: string;
  practice: { a: string; op: "+" | "-"; b: string };
  /** One of the widest charts (a layout check in the sketch). */
  widest?: boolean;
}

const P = (a: string, op: "+" | "-", b: string, pa: string, pb: string, extra: { widest?: boolean } = {}): TradeProblemText =>
  ({ a, op, b, practice: { a: pa, op, b: pb }, ...extra });

export const TRADE_PROBLEMS: Record<"en" | "zh", TradeProblemText[]> = {
  en: [
    P("3486", "+", "2739", "4658", "1573"),
    P("5960", "+", "2047", "3870", "4136"),
    P("68957", "+", "21068", "57846", "32175"),
    P("7352", "-", "2618", "8461", "3729"),
    P("50003", "-", "2476", "40002", "3585"),
    P("6004", "-", "2756", "7003", "4865"),
    P("2.75", "+", "1.48", "3.86", "2.57"),
    P("5", "-", "1.36", "7", "2.48"),
    P("4999.99", "+", "3999.99", "2999.99", "4999.99", { widest: true }),
    P("9000", "-", "2345.67", "8000", "3456.78", { widest: true }),
    P("389457", "+", "247568", "456789", "278436", { widest: true }),
  ],
  zh: [
    P("4527", "+", "1685", "3648", "2575"),
    P("8452", "-", "3671", "9361", "4582"),
    P("3000", "-", "1468", "5000", "2367"),
    P("3.68", "+", "4.57", "4.86", "2.38"),
    P("8.2", "-", "3.75", "9.3", "4.68"),
    P("4999.99", "+", "3999.99", "2999.99", "4999.99", { widest: true }),
    P("9000", "-", "2345.67", "8000", "3456.78", { widest: true }),
    P("389457", "+", "247568", "456789", "278436", { widest: true }),
  ],
};

export const tradeProblemKey = (p: { a: string; op: string; b: string }): string => `${p.a}${p.op}${p.b}`;

// ---------------------------------------------------------------- lessons

/** A written number in thousandths ("3,486" -> 3486000). */
export const tradeValue = (text: string): number => placeValueTradeParse(text)!.value!;
/** A column's status variable: `col_tens`, `col_hundred_thousands`. */
export const tradeVariable = (place: number): string => `col_${PLACE_VALUE_PLACE_ALIASES[place]!.replace(/-/g, "_")}`;

export interface TradeLessonInput {
  operation: PlaceValueTradeOperation;
  language?: PlaceValueLanguage;
  /** The lesson's pair, written ("3486", "2.75"). */
  a: string;
  b: string;
  /** Each practice task's pair: a card task, then a typed answer anchored to the card. */
  practice?: Array<[string, string]>;
  /** The lesson's beats after the one that writes the card. */
  beats?: AuthoringLesson["steps"][number]["beats"];
  /** Leave "columns finished" unbound (a card the lesson does not demonstrate). */
  noDemo?: boolean;
  /** Tasks besides the practice ones (appended after them). */
  extraTasks?: unknown[];
}

/** The columns a trade lesson draws: the lesson's pair's. */
export function tradeColumns(input: Pick<TradeLessonInput, "operation" | "a" | "b">): number[] {
  const { top_place, low_place } = placeValueTradeColumnsFor(input.operation, tradeValue(input.a), tradeValue(input.b));
  return placeValueTradeColumns(top_place, low_place);
}

/** A practice start on a pair: the two numbers, nothing demonstrated, every column fresh. */
export function tradeStart(input: Pick<TradeLessonInput, "operation" | "a" | "b" | "noDemo">, a: string, b: string) {
  const values: Record<string, number> = { a: tradeValue(a), b: tradeValue(b), ...(input.noDemo ? {} : { finished: 0 }) };
  for (const place of tradeColumns(input)) values[tradeVariable(place)] = 0;
  return { kind: "practice" as const, variables: Object.keys(values), values };
}

/** The answer a pair's typed-answer task expects, as a learner writes it (no grouping commas). */
export function tradeAnswer(operation: PlaceValueTradeOperation, a: string, b: string): string {
  const result = operation === "add" ? tradeValue(a) + tradeValue(b) : tradeValue(a) - tradeValue(b);
  return placeValueNumeral(result, "zh-CN");
}

export function tradeLesson(input: TradeLessonInput): AuthoringLesson {
  const practice = input.practice ?? [];
  const as = practice.map(([a]) => tradeValue(a)), bs = practice.map(([, b]) => tradeValue(b));
  const a = tradeValue(input.a), b = tradeValue(input.b);
  const columns = tradeColumns(input);
  const variables: Array<Record<string, unknown>> = [
    // Each number's range covers the lesson's and every practice pair's (a range is never one value: one more whole).
    { as: "a", label: "a", initial: a, min: Math.min(a, ...as), max: Math.max(a + 1000, ...as) },
    { as: "b", label: "b", initial: b, min: Math.min(b, ...bs), max: Math.max(b + 1000, ...bs) },
    ...(input.noDemo ? [] : [{ as: "finished", label: "columns finished", initial: 0, min: 0, max: columns.length }]),
    ...columns.map((place) => ({ as: tradeVariable(place), label: tradeVariable(place), initial: 0, min: 0, max: placeValueTradeMaxStatus(input.operation) })),
  ];
  const built = buildPlaceValueTrade({
    as: "sum", role: "main_visual", place: { relation: "new_region" },
    ...(input.language ? { language: input.language } : {}),
    operation: input.operation,
    a: { expression: "a", initial: a }, b: { expression: "b", initial: b },
    ...(input.noDemo ? {} : { finished: { expression: "finished", initial: 0 } }),
    places: columns.map((place) => ({ place, status: { expression: tradeVariable(place), initial: 0 } })),
  });
  const tasks = practice.flatMap(([pa, pb], i) => [
    {
      as: `practice-${i + 1}`,
      prompt: input.operation === "add" ? "Add on the chart, column by column." : "Subtract on the chart, column by column.",
      availability: { kind: "after_lesson" },
      start: tradeStart(input, pa, pb),
      allowed_operations: [{ kind: "card_tap", node: "sum" }],
      completion: { kind: "card_fact", node: "sum", fact: "complete" },
      hints: ["Start with any column."],
    },
    {
      as: `answer-${i + 1}`, anchor: "sum",
      prompt: input.operation === "add" ? "What is the total?" : "What is left?",
      availability: { kind: "after_lesson" },
      allowed_operations: [{ kind: "answer_entry" }],
      completion: { kind: "numeric_answer", answer: tradeAnswer(input.operation, pa, pb) },
      hints: ["Read the answer row, one digit per column."],
    },
  ]);
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: input.language ?? "en-US", title: "Column method", goals: ["Add and subtract with trades"],
      variables, tasks: [...tasks, ...(input.extraTasks ?? [])],
    },
    steps: [{ key: "show", purpose: "See the problem", beats: [{ key: "draw", say: "Here is the problem.", actions: built.actions }, ...(input.beats ?? [])] }],
    close: { summary: "Ten of a place make one of the next.", focus: [built.whole] },
  } as unknown as AuthoringLesson;
}

export const tradeHost = (lessonId: string) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" as const });
