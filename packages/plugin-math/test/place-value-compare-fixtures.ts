// Pairs for the place-value compare card's tests (decision 0029): the accepted sketch's list (35P-06 sketch,
// model.mjs PROBLEMS), each shown pair with its practice pair, written as a learner writes them. And lessons: the
// card built by the recipe builder, every field bound to its own variable, practice tasks on their own pair.
import type { AuthoringLesson } from "../../core/src/index.js";
import type { PlaceValueLanguage } from "../src/place-value-chart.js";
import { buildPlaceValueCompare } from "../src/place-value-compare-builder.js";
import {
  PLACE_VALUE_COMPARE_MAX_COLUMNS, placeValueCompareDemoEnd, placeValueCompareMakePair, placeValueCompareOwnDecimals, placeValueCompareParse,
  type PlaceValueCompareNumber, type PlaceValueComparePair,
} from "../src/place-value-compare.js";

export interface ComparePairText {
  a: string;
  b: string;
  practice: { a: string; b: string };
  /** One of the widest charts (a layout check in the sketch). */
  widest?: boolean;
}

const P = (a: string, b: string, pa: string, pb: string, extra: { widest?: boolean } = {}): ComparePairText => ({ a, b, practice: { a: pa, b: pb }, ...extra });

export const COMPARE_PROBLEMS: Record<"en" | "zh", ComparePairText[]> = {
  en: [
    P("4530", "4503", "6281", "6218"), // C1: the tens decide
    P("10200", "9876", "100050", "99999"), // C2: different lengths
    P("607198", "607912", "345612", "345216"), // C3: late difference, big digits after it
    P("0.625", "0.7", "0.48", "0.5"), // C4: more digits, smaller
    P("0.45", "0.405", "0.36", "0.306"), // C4: the hundredths decide
    P("2.35", "2.305", "4.07", "4.7"), // C5: points lined up
    P("12.4", "9.87", "10.5", "8.96"), // C5: whole parts decide
    P("0.7", "0.70", "0.40", "0.4"), // C6: equal
    P("1000000", "999999", "2000000", "1999999", { widest: true }),
    P("3456.789", "3456.798", "2345.678", "2345.687", { widest: true }),
  ],
  zh: [
    P("36815", "36851", "52734", "52743"),
    P("120345", "98765", "100200", "99800"),
    P("0.45", "0.405", "0.36", "0.306"),
    P("5.06", "5.6", "7.08", "7.8"),
    P("4.300", "4.3", "2.50", "2.5"),
    P("1000000", "999999", "2000000", "1999999", { widest: true }),
    P("3456.789", "3456.798", "2345.678", "2345.687", { widest: true }),
  ],
};

/** A written number as the card holds it (its value and written decimals); throws when the card cannot read it. */
export function compareNumber(text: string): PlaceValueCompareNumber {
  const parsed = placeValueCompareParse(text);
  if (!parsed || parsed.value === undefined) throw new Error(`not a number the card takes: ${text}`);
  return { value: parsed.value, dec: parsed.dec };
}

// ---------------------------------------------------------------- lessons

export interface CompareLessonInput {
  language?: PlaceValueLanguage;
  /** The lesson's pair, written ("0.625", "0.7"; "0.70" keeps its decimals). */
  a: string;
  b: string;
  /** Each practice task's pair. */
  practice?: Array<[string, string]>;
  /** Bind the written decimals (a lesson whose numbers end in a written zero, or whose practice does). */
  decimals?: boolean;
  beats?: AuthoringLesson["steps"][number]["beats"];
  /** Tasks besides the practice ones (appended after them). */
  extraTasks?: unknown[];
}

export function comparePairOf(a: string, b: string): PlaceValueComparePair {
  const p = placeValueCompareMakePair(compareNumber(a), compareNumber(b));
  if ("fault" in p) throw new Error(`fixture pair refused: ${p.fault}`);
  return p;
}

/** A practice start: the task's own pair, nothing compared, judged or signed. */
export function compareStart(a: string, b: string, decimals = false) {
  const p = comparePairOf(a, b);
  const values: Record<string, number> = { a: p.a, b: p.b, ...(decimals ? { a_decimals: p.aDec, b_decimals: p.bDec } : {}), compared: 0, marked: 0, signed: 0 };
  return { kind: "practice" as const, variables: Object.keys(values), values };
}

export function compareLesson(input: CompareLessonInput): AuthoringLesson {
  const p = comparePairOf(input.a, input.b);
  const practices = (input.practice ?? []).map(([a, b]) => comparePairOf(a, b));
  const all = [p, ...practices];
  const span = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) + (Math.min(...values) === Math.max(...values) ? 1 : 0) });
  const decimals = input.decimals === true;
  const variables: Array<Record<string, unknown>> = [
    { as: "a", label: "first number", initial: p.a, ...span(all.flatMap((q) => [q.a, q.b])) },
    { as: "b", label: "second number", initial: p.b, ...span(all.flatMap((q) => [q.a, q.b])) },
    ...(decimals ? [{ as: "a_decimals", label: "first decimals", initial: p.aDec, min: 0, max: 3 }, { as: "b_decimals", label: "second decimals", initial: p.bDec, min: 0, max: 3 }] : []),
    { as: "compared", label: "compared", initial: 0, min: 0, max: Math.max(...all.map((q) => placeValueCompareDemoEnd(q))) },
    { as: "marked", label: "marked", initial: 0, min: 0, max: PLACE_VALUE_COMPARE_MAX_COLUMNS },
    { as: "signed", label: "signed", initial: 0, min: 0, max: 1 },
  ];
  const own = (n: PlaceValueCompareNumber) => n.dec !== placeValueCompareOwnDecimals(n.value);
  const A = compareNumber(input.a), B = compareNumber(input.b);
  const built = buildPlaceValueCompare({
    as: "chart", role: "main_visual", place: { relation: "new_region" },
    ...(input.language ? { language: input.language } : {}),
    a: { expression: "a", initial: p.a }, b: { expression: "b", initial: p.b },
    ...(decimals ? { a_decimals: { expression: "a_decimals", initial: p.aDec }, b_decimals: { expression: "b_decimals", initial: p.bDec } } : {
      ...(own(A) ? { a_decimals: A.dec } : {}), ...(own(B) ? { b_decimals: B.dec } : {}),
    }),
    compared: { expression: "compared", initial: 0 },
    marked: { expression: "marked", initial: 0 },
    signed: { expression: "signed", initial: 0 },
  });
  const tasks = (input.practice ?? []).map(([a, b], i) => ({
    as: `practice-${i + 1}`, prompt: "Compare the two numbers.", availability: { kind: "after_lesson" },
    start: compareStart(a, b, decimals),
    allowed_operations: [{ kind: "card_tap", node: "chart" }],
    completion: { kind: "card_fact", node: "chart", fact: "complete" },
    hints: ["Start at the left."],
  }));
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: input.language ?? "en-US", title: "Comparing by place", goals: ["Compare two numbers by place"],
      variables, tasks: [...tasks, ...(input.extraTasks ?? [])],
    },
    steps: [{ key: "show", purpose: "See the pair", beats: [{ key: "draw", say: "Here are two numbers.", actions: built.actions }, ...(input.beats ?? [])] }],
    close: { summary: "The first place that differs decides.", focus: [built.whole] },
  } as unknown as AuthoringLesson;
}

export const compareHost = (lessonId: string) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" as const });
