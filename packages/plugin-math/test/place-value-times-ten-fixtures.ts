// Problems for the place-value times-ten card's tests (decision 0028): the accepted sketch's list (35P-04 sketch,
// model.mjs PROBLEMS), each shown problem with its practice of the same shape, written as a learner writes them.
// The start is given only where the question names a unit the amount is not in (a put-together question). And
// lessons: the card built by the recipe builder, every field bound to its own variable, practice tasks on their own
// problem, each followed by the card's answer row anchored to it; a lesson may state the card's shape (0028
// revision 4: 100 and 10 as a times pair).
import type { AuthoringLesson } from "../../core/src/index.js";
import type { PlaceValueLanguage } from "../src/place-value-chart.js";
import { buildPlaceValueTimesTen } from "../src/place-value-times-ten-builder.js";
import {
  placeValueTimesTenAnswerParts, placeValueTimesTenParse, placeValueTimesTenPath, placeValueTimesTenPracticeProblem, placeValueTimesTenProblem,
  placeValueTimesTenProblemOfShape, placeValueTimesTenRowFields, type PlaceValueTimesTenProblem, type PlaceValueTimesTenShape,
} from "../src/place-value-times-ten.js";

export interface TimesTenProblemText {
  amount: string;
  target: string;
  start?: string;
  practice: { amount: string; target: string };
  /** One of the largest charts (a layout check in the sketch). */
  widest?: boolean;
}

const P = (amount: string, target: string, start: string | undefined, practice: { amount: string; target: string }, extra: { widest?: boolean } = {}): TimesTenProblemText =>
  ({ amount, target, ...(start !== undefined ? { start } : {}), practice, ...extra });

export const TIMES_TEN_PROBLEMS: Record<"en" | "zh", TimesTenProblemText[]> = {
  en: [
    P("0.3", "0.001", undefined, { amount: "5", target: "0.01" }),
    P("700", "70", undefined, { amount: "4000", target: "400" }),
    P("1000", "10", undefined, { amount: "300", target: "1" }),
    P("6000", "100", undefined, { amount: "0.8", target: "0.01" }),
    P("300", "100", "10", { amount: "0.04", target: "0.01" }),
    P("0.5", "0.1", "0.001", { amount: "700", target: "100" }),
    P("3", "0.3", undefined, { amount: "0.6", target: "0.06" }),
    P("9", "0.01", undefined, { amount: "9000", target: "10" }, { widest: true }),
    P("9000", "900", undefined, { amount: "0.09", target: "0.009" }, { widest: true }),
    P("9000000", "900000", undefined, { amount: "90", target: "9" }, { widest: true }),
  ],
  zh: [
    P("0.3", "0.001", undefined, { amount: "6", target: "0.01" }),
    P("500", "50", undefined, { amount: "0.7", target: "0.07" }),
    P("10000", "100", undefined, { amount: "2000", target: "10" }),
    P("2000", "1000", "100", { amount: "0.06", target: "0.01" }),
    P("0.8", "0.1", "0.001", { amount: "300", target: "100" }),
    P("0.4", "0.04", undefined, { amount: "2", target: "0.2" }),
    P("9", "0.01", undefined, { amount: "9000", target: "10" }, { widest: true }),
    P("9000", "900", undefined, { amount: "0.09", target: "0.009" }, { widest: true }),
    P("9000000", "900000", undefined, { amount: "90", target: "9" }, { widest: true }),
  ],
};

/** The development cases' served expectations (35P-04 dev-cases.json, PF-01 to PF-15): amount, start, target, answers. */
export const TIMES_TEN_DEV_CASES: Array<{ id: string; ask: "count" | "times"; amount: string; start?: string; target: string; result: string; renamed?: string }> = [
  { id: "PF-01", ask: "count", amount: "1000", start: "1000", target: "10", result: "100" },
  { id: "PF-02", ask: "count", amount: "400", start: "100", target: "1", result: "400" },
  { id: "PF-03", ask: "count", amount: "6000", start: "1000", target: "100", result: "60" },
  { id: "PF-04", ask: "count", amount: "300", start: "10", target: "100", result: "3" },
  { id: "PF-05", ask: "count", amount: "0.4", start: "0.01", target: "0.1", result: "4" },
  { id: "PF-06", ask: "count", amount: "0.5", start: "0.001", target: "0.1", result: "5" },
  { id: "PF-07", ask: "times", amount: "700", target: "70", result: "10", renamed: "70" },
  { id: "PF-08", ask: "times", amount: "8000", target: "800", result: "10", renamed: "80" },
  { id: "PF-09", ask: "times", amount: "300", target: "30", result: "10", renamed: "30" },
  { id: "PF-10", ask: "times", amount: "60000", target: "6000", result: "10", renamed: "60" },
  { id: "PF-11", ask: "count", amount: "0.7", start: "0.1", target: "0.01", result: "70" },
  { id: "PF-12", ask: "count", amount: "0.2", start: "0.1", target: "0.001", result: "200" },
  { id: "PF-13", ask: "count", amount: "0.6", start: "0.1", target: "0.001", result: "600" },
  { id: "PF-14", ask: "times", amount: "3", target: "0.3", result: "10", renamed: "30" },
  { id: "PF-15", ask: "times", amount: "0.4", target: "0.04", result: "10", renamed: "40" },
];

// ---------------------------------------------------------------- lessons


/** A written number in thousandths ("0.3" -> 300). */
export const timesTenValue = (text: string): number => placeValueTimesTenParse(text)!;

export interface TimesTenLessonInput {
  language?: PlaceValueLanguage;
  /** The lesson's problem, written ("0.3", "0.001"; a put-together question's own start). */
  amount: string;
  target: string;
  start?: string;
  /** The card's shape, when the lesson states it (the builder's `shape`); left out, it is read from the numbers. */
  shape?: PlaceValueTimesTenShape;
  /** Each practice task's numbers: a card task, then the card's answer row anchored to it. */
  practice?: Array<[string, string]>;
  beats?: AuthoringLesson["steps"][number]["beats"];
  /** Tasks besides the practice ones (appended after them). */
  extraTasks?: unknown[];
}

type TimesTenProblemInput = Pick<TimesTenLessonInput, "amount" | "target" | "start" | "shape">;

export function timesTenProblemOf(input: TimesTenProblemInput): PlaceValueTimesTenProblem {
  const p = input.shape
    ? placeValueTimesTenProblemOfShape(input.shape, timesTenValue(input.amount), timesTenValue(input.target))
    : placeValueTimesTenProblem(timesTenValue(input.amount), timesTenValue(input.target), input.start === undefined ? undefined : timesTenValue(input.start));
  if ("fault" in p) throw new Error(`fixture problem refused: ${p.fault}`);
  return p;
}
export function timesTenPracticeOf(input: TimesTenProblemInput, amount: string, target: string): PlaceValueTimesTenProblem {
  const p = placeValueTimesTenPracticeProblem(timesTenProblemOf(input), timesTenValue(amount), timesTenValue(target));
  if ("fault" in p) throw new Error(`fixture practice refused: ${p.fault}`);
  return p;
}

/** A practice start: the task's own numbers, "counted in" at its own start unit (the program's), every row unmoved. */
export function timesTenStart(input: TimesTenProblemInput, amount: string, target: string) {
  const p = timesTenPracticeOf(input, amount, target);
  const values: Record<string, number> = { amount: p.amount, target: p.target, counted_in: p.start };
  for (const field of placeValueTimesTenRowFields(p.g)) values[field] = 0;
  return { kind: "practice" as const, variables: Object.keys(values), values };
}

/** The card's answer row for a problem, as a numeric_row's parts (answers as a learner writes them). */
export function timesTenRow(p: PlaceValueTimesTenProblem, language: PlaceValueLanguage = "en-US") {
  return placeValueTimesTenAnswerParts(p, language).map((part) => ("blank" in part ? { blank: { as: part.blank.as, answer: String(part.blank.answer) } } : part));
}

export function timesTenLesson(input: TimesTenLessonInput): AuthoringLesson {
  const p = timesTenProblemOf(input);
  const practices = (input.practice ?? []).map(([amount, target]) => timesTenPracticeOf(input, amount, target));
  const all = [p, ...practices];
  const span = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) + (Math.min(...values) === Math.max(...values) ? 1 : 0) });
  const counted = all.flatMap((q) => placeValueTimesTenPath(q));
  const variables: Array<Record<string, unknown>> = [
    { as: "amount", label: "amount", initial: p.amount, ...span(all.map((q) => q.amount)) },
    { as: "target", label: "target", initial: p.target, ...span(all.map((q) => q.target)) },
    { as: "counted_in", label: "counted in", initial: p.start, ...span(counted) },
    ...placeValueTimesTenRowFields(p.g).map((field) => ({ as: field, label: field, initial: 0, min: 0, max: 511 })),
  ];
  const built = buildPlaceValueTimesTen({
    as: "chart", role: "main_visual", place: { relation: "new_region" },
    ...(input.language ? { language: input.language } : {}),
    amount: { expression: "amount", initial: p.amount }, target: { expression: "target", initial: p.target },
    ...(input.shape ? { shape: input.shape } : {}),
    ...(input.start !== undefined ? { start: timesTenValue(input.start) } : {}),
    counted_in: { expression: "counted_in", initial: p.start },
    moved_once: { expression: "moved_once", initial: 0 },
    ...(p.g === 2 ? { moved_twice: { expression: "moved_twice", initial: 0 } } : {}),
  });
  const tasks = (input.practice ?? []).flatMap(([amount, target], i) => [
    {
      as: `practice-${i + 1}`, prompt: "Move every disk to the target column.", availability: { kind: "after_lesson" },
      start: timesTenStart(input, amount, target),
      allowed_operations: [{ kind: "card_tap", node: "chart" }],
      completion: { kind: "card_fact", node: "chart", fact: "complete" },
      hints: ["Tap any disk."],
    },
    {
      as: `answer-${i + 1}`, anchor: "chart", prompt: "How many?", availability: { kind: "after_lesson" },
      allowed_operations: [{ kind: "row_entry" }],
      completion: { kind: "numeric_row", parts: timesTenRow(practices[i]!, input.language) },
      hints: ["Count the target column."],
    },
  ]);
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: input.language ?? "en-US", title: "Ten of one place", goals: ["Count an amount in another unit"],
      variables, tasks: [...tasks, ...(input.extraTasks ?? [])],
    },
    steps: [{ key: "show", purpose: "See the problem", beats: [{ key: "draw", say: "Here is the amount.", actions: built.actions }, ...(input.beats ?? [])] }],
    close: { summary: "Ten of one place make one of the next.", focus: [built.whole] },
  } as unknown as AuthoringLesson;
}

export const timesTenHost = (lessonId: string) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" as const });
