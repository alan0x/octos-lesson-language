// Place-value chart lessons for tests and the browser check (decision 0025): a chart built by the recipe
// builder, every count (and pulled count) bound to its own variable, the number bound to `number`, and
// practice tasks that start on their own number. Numbers here are invented for the checks.
import type { AuthoringLesson } from "../../core/src/index.js";
import { buildPlaceValueChart } from "../src/place-value-chart-builder.js";
import {
  PLACE_VALUE_PLACE_ALIASES, placeValueColumns, placeValueColumnsFor, placeValueDigitAt,
  type PlaceValueGiven, type PlaceValueLanguage, type PlaceValueMode,
} from "../src/place-value-chart.js";

/** A place's count variable and pulled variable: `count_tens`, `pulled_hundred_thousands`. */
export const chartVariable = (field: "count" | "pulled", place: number): string => `${field}_${PLACE_VALUE_PLACE_ALIASES[place]!.replace(/-/g, "_")}`;

export interface ChartLessonInput {
  mode: PlaceValueMode;
  given: PlaceValueGiven;
  language?: PlaceValueLanguage;
  /** The lesson's number, in thousandths. */
  target: number;
  /** Each practice task's number, in thousandths (the chart's columns cover them all). */
  practice?: number[];
  /** The lesson's beats after the one that writes the chart. */
  beats?: AuthoringLesson["steps"][number]["beats"];
  /** Tasks besides one card task per practice number (appended after them). */
  extraTasks?: unknown[];
  /** Leave the number unbound (a chart that only demonstrates). */
  fixedNumber?: boolean;
}

/** The columns a chart lesson draws, highest first. */
export function chartColumns(input: Pick<ChartLessonInput, "target" | "practice" | "language">): number[] {
  const { top_place, decimals } = placeValueColumnsFor([input.target, ...(input.practice ?? [])], input.language);
  return placeValueColumns(top_place, decimals);
}

/** The practice start of a task on `number`: an empty chart to build, or a whole one to pull apart. */
export function chartStart(input: Pick<ChartLessonInput, "mode" | "target" | "practice" | "language">, number: number) {
  const values: Record<string, number> = { number };
  for (const place of chartColumns(input)) {
    values[chartVariable("count", place)] = input.mode === "apart" ? placeValueDigitAt(number, place) : 0;
    if (input.mode === "apart") values[chartVariable("pulled", place)] = 0;
  }
  return { kind: "practice" as const, variables: Object.keys(values), values };
}

export function chartLesson(input: ChartLessonInput): AuthoringLesson {
  const practice = input.practice ?? [];
  const numbers = [input.target, ...practice];
  const variables: Array<Record<string, unknown>> = input.fixedNumber ? [] : [{ as: "number", label: "number", initial: input.target, min: Math.min(...numbers), max: Math.max(...numbers) }];
  const places = chartColumns(input).map((place) => {
    const count = input.mode === "apart" ? placeValueDigitAt(input.target, place) : 0;
    variables.push({ as: chartVariable("count", place), label: chartVariable("count", place), initial: count, min: 0, max: 9 });
    if (input.mode !== "apart") return { place, count: { expression: chartVariable("count", place), initial: count } };
    variables.push({ as: chartVariable("pulled", place), label: chartVariable("pulled", place), initial: 0, min: 0, max: 9 });
    return { place, count: { expression: chartVariable("count", place), initial: count }, pulled: { expression: chartVariable("pulled", place), initial: 0 } };
  });
  const built = buildPlaceValueChart({
    as: "chart", role: "main_visual", place: { relation: "new_region" },
    ...(input.language ? { language: input.language } : {}),
    mode: input.mode, given: input.given,
    target: input.fixedNumber ? input.target : { expression: "number", initial: input.target },
    numbers: practice, places,
  });
  const fact = input.mode === "build" ? "built" : "pulled_all";
  const tasks = practice.map((number, i) => ({
    as: `practice-${i + 1}`,
    prompt: input.mode === "build" ? "Build the number on the chart. Then tap I'm done." : "Take out every place. Then tap I'm done.",
    availability: { kind: "after_lesson" },
    start: chartStart(input, number),
    allowed_operations: [{ kind: "card_tap", node: "chart" }, { kind: "card_submit" }],
    completion: { kind: "card_fact", node: "chart", fact },
    hints: [input.mode === "build" ? "Read the number again, one place at a time." : "Take out each place that has disks."],
  }));
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: {
      mode: "explain", language: input.language ?? "en-US", title: "Place value", goals: ["Read a number by its places"],
      variables, tasks: [...tasks, ...(input.extraTasks ?? [])],
    },
    steps: [{ key: "show", purpose: "See the chart", beats: [{ key: "draw", say: "Here is a place-value chart.", actions: built.actions }, ...(input.beats ?? [])] }],
    close: { summary: "Each place has its own value.", focus: [built.whole] },
  } as unknown as AuthoringLesson;
}

export const chartHost = (lessonId: string) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" as const });
