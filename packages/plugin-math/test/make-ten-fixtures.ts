// The accepted sketch's picker (handoff runs/early-number/K2N-19/sketch/model.mjs, PROBLEMS and REFUSED): each
// problem with its practice pair (a different pair of the same kind) and its blueprint row (M1-M6).
import type { AuthoringLesson } from "../../core/src/index.js";
import { buildMakeTen } from "../src/make-ten-builder.js";
import { makeTenChainText, makeTenFreshCount, makeTenProblemOf, makeTenRow, type MakeTenLanguage } from "../src/make-ten.js";
export interface MakeTenFixture { a: number; b: number; practice: { a: number; b: number }; row: string }
const P = (a: number, b: number, pa: number, pb: number, row: string): MakeTenFixture => ({ a, b, practice: { a: pa, b: pb }, row });

export const MAKE_TEN_PROBLEMS: Record<"en" | "zh", MakeTenFixture[]> = {
  en: [P(8, 6, 7, 5, "M1"), P(9, 5, 9, 7, "M2"), P(3, 8, 4, 9, "M3"), P(6, 5, 5, 7, "M4"), P(7, 7, 6, 6, "M4"), P(9, 9, 8, 8, "M4")],
  zh: [P(8, 5, 9, 6, "M1"), P(9, 4, 9, 8, "M2"), P(4, 9, 3, 8, "M3"), P(7, 6, 6, 5, "M4"), P(7, 7, 8, 8, "M4")],
};

/** Refused by the card: under ten, exactly ten (partners of ten), not one digit. */
export const MAKE_TEN_REFUSED: Array<{ a: number; b: number }> = [{ a: 6, b: 3 }, { a: 7, b: 3 }, { a: 12, b: 5 }];

// ---------------------------------------------------------------- lessons


export interface MakeTenLessonInput {
  language?: MakeTenLanguage;
  /** The lesson's pair. */
  a: number;
  b: number;
  /** Each practice task's pair: a card task, then the row of four blanks anchored on the card. */
  practice?: Array<[number, number]>;
  /** The lesson's beats after the one that writes the card. */
  beats?: AuthoringLesson["steps"][number]["beats"];
  /** Leave `filled` unbound (a card the lesson does not demonstrate). */
  noDemo?: boolean;
}

/** A practice start on a pair: the pair, its bigger addend in the bigger frame (nothing demonstrated), nothing moved. */
export function makeTenStart(input: Pick<MakeTenLessonInput, "noDemo">, a: number, b: number) {
  const values: Record<string, number> = { a, b, ...(input.noDemo ? {} : { filled: makeTenFreshCount(a, b) }), moved: 0 };
  return { kind: "practice" as const, variables: Object.keys(values), values };
}

/**
 * A make-ten lesson as Coach would compile it: the four variables (the pair 1..9, the demonstration's count in
 * the bigger frame 0..10 starting at the bigger addend, the count moved 0..4 starting at 0), the card, and per
 * practice pair a card task followed by the program-written row anchored on the card.
 */
function rowOrPlaceholder(a: number, b: number, language: MakeTenLanguage) {
  try { return makeTenRow(a, b, language); } catch { return [{ text: `${a} + ${b} =` }, { blank: { as: "total", answer: String(a + b) } }]; }
}

export function makeTenLesson(input: MakeTenLessonInput): AuthoringLesson {
  const practice = input.practice ?? [];
  const variables: Array<Record<string, unknown>> = [
    { as: "a", label: "a", initial: input.a, min: 1, max: 9 },
    { as: "b", label: "b", initial: input.b, min: 1, max: 9 },
    ...(input.noDemo ? [] : [{ as: "filled", label: "in the bigger frame", initial: makeTenFreshCount(input.a, input.b), min: 0, max: 10 }]),
    { as: "moved", label: "moved", initial: 0, min: 0, max: 4 },
  ];
  const built = buildMakeTen({
    as: "frames", role: "main_visual", place: { relation: "new_region" },
    ...(input.language ? { language: input.language } : {}),
    a: { expression: "a", initial: input.a }, b: { expression: "b", initial: input.b },
    ...(input.noDemo ? {} : { filled: { expression: "filled", initial: makeTenFreshCount(input.a, input.b) } }),
    moved: { expression: "moved", initial: 0 },
  });
  const tasks = practice.flatMap(([pa, pb], i) => [
    {
      as: `practice-${i + 1}`,
      prompt: "Make a ten.",
      availability: { kind: "after_lesson" },
      start: makeTenStart(input, pa, pb),
      allowed_operations: [{ kind: "card_tap", node: "frames" }],
      completion: { kind: "card_fact", node: "frames", fact: "complete" },
      hints: ["How many more does the bigger number need to make ten?"],
    },
    {
      as: `row-${i + 1}`, anchor: "frames",
      prompt: "Write it as a number sentence.",
      availability: { kind: "after_lesson" },
      allowed_operations: [{ kind: "row_entry" }],
      // A pair the card refuses has no row: a placeholder, so the card's own refusal is what a test meets.
      completion: { kind: "numeric_row", parts: rowOrPlaceholder(pa, pb, input.language ?? "en-US") },
      hints: ["Read the full frame, then the other one."],
      success_message: makeTenChainText(makeTenProblemOf(pa, pb)),
    },
  ]);
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: input.language ?? "en-US", title: "Making ten", goals: ["Add by making ten"], variables, tasks },
    steps: [{ key: "show", purpose: "See the problem", beats: [{ key: "draw", say: "Here are the two numbers.", actions: built.actions }, ...(input.beats ?? [])] }],
    close: { summary: "One number gives part of itself to make the other ten.", focus: [built.whole] },
  } as unknown as AuthoringLesson;
}

export const makeTenHost = (lessonId: string) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" as const });
