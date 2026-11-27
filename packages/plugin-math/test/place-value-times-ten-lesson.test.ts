// The place-value times-ten card inside a lesson (decision 0028): the card-kind registry entry, core validation of
// its tasks (a practice on its own problem, "counted in" at its own start unit, the card's answer row after it),
// the card-level bindings, the reducer and execution requirements. The demonstration's own rules ("counted in"
// moving along its path) plug into the core's demonstration hook and are tested with it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCanonicalAction, assertAuthoringSchema, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson, reduceCanonicalEvents,
  setLessonVariables, validateAuthoringLesson, OLL_PLAYER_EXECUTION_VERSION, type AuthoringLesson,
} from "../../core/src/index.js";
import { PLACE_VALUE_TIMES_TEN_CARD, tapCardKind } from "../../core/src/cards.js";
import { MATH_BUILDERS, MATH_PLUGIN_MANIFEST, cardHowTo } from "../src/index.js";
import { buildPlaceValueTimesTen } from "../src/place-value-times-ten-builder.js";
import {
  PLACE_VALUE_TIMES_TEN_FEATURE, PLACE_VALUE_TIMES_TEN_KIND, PLACE_VALUE_TIMES_TEN_TAP_PLACES, placeValueTimesTenHowTo, type PlaceValueTimesTenState,
} from "../src/place-value-times-ten.js";
import { timesTenHost, timesTenLesson, timesTenPracticeOf, timesTenRow, timesTenStart, type TimesTenLessonInput } from "./place-value-times-ten-fixtures.js";

const count = (extra: Partial<TimesTenLessonInput> = {}) => timesTenLesson({ amount: "0.3", target: "0.001", practice: [["5", "0.01"]], ...extra });
const times = (extra: Partial<TimesTenLessonInput> = {}) => timesTenLesson({ amount: "700", target: "70", practice: [["4000", "400"]], ...extra });
const together = (extra: Partial<TimesTenLessonInput> = {}) => timesTenLesson({ language: "zh-CN", amount: "2000", target: "1000", start: "100", practice: [["0.06", "0.01"]], ...extra });
const task = (lesson: AuthoringLesson, index = 0) => (lesson.lesson.tasks as any[])[index];
const card = (lesson: AuthoringLesson) => (lesson.steps[0]!.beats[0]!.actions[0] as any);

test("the registry entry: row taps, the row sets and the card's numbers card-level, all bound by bare name", () => {
  const kind = PLACE_VALUE_TIMES_TEN_CARD;
  assert.equal(tapCardKind(PLACE_VALUE_TIMES_TEN_KIND), kind);
  assert.deepEqual(kind.taps, ["move", "copy", "smaller"]);
  assert.deepEqual(kind.places, PLACE_VALUE_TIMES_TEN_TAP_PLACES);
  assert.deepEqual([kind.cardFields, kind.practiceFields, kind.demonstration?.field, kind.fieldsAtOnce], [["amount", "target", "counted_in"], ["amount", "target"], "counted_in", true]);
  const content = card(count()).content;
  assert.deepEqual(kind.tapFields(content).map(({ field, min, max }) => `${field} ${min}..${max}`), ["moved_once 0..511", "moved_twice 0..511"]);
  assert.deepEqual(kind.tapFields(card(times()).content).map(({ field }) => field), ["moved_once"]);
  assert.equal(kind.fieldTarget(content, 0, "moved_twice"), "moved_twice");
  assert.deepEqual(kind.demonstration!.range(content), { min: 1, max: 100 });
  assert.equal(kind.demonstration!.next(content, 100), "the next values are 10 or 1");
  assert.equal(kind.demonstration!.next(card(times()).content, 70000), "it has reached the target, 70000");
  // A tap names a row; the tapped thing moves, and only its row's bit changes.
  const state = kind.state(content);
  const moved = kind.apply(state, { kind: "move", place: 2 });
  assert.ok(moved.ok);
  assert.deepEqual(kind.changes(state, moved.state), [{ place: 0, field: "moved_once", before: 0, after: 4 }]);
  assert.deepEqual(kind.apply(state, { kind: "move", place: 5 }), { ok: false, reason: "no_thing" });
  // Refusals are facts, with the card's counts when the card as tapped is given.
  const timesState = kind.state({ ...card(times()).content, moved_once: 7 });
  assert.deepEqual(kind.apply(timesState, { kind: "copy", place: 3 }), { ok: false, reason: "copy_short" });
  assert.equal(kind.refusalText("copy_short", 3, "en-US", timesState), "This 70 has 3 tens; 70 is 7 tens.");
  assert.equal(kind.refusalText("copy_short", 3, "zh-CN", timesState), "这一个 70 只有 3 个十；70 是 7 个十。");
  assert.equal(kind.refusalText("smaller", 0, "en-US", timesState), "This is 70: 7 tens.");
  assert.equal(kind.refusalText("copy_short", 3), "That can't be done here.", "without the card, no counts are made up");
  const shown = kind.state({ ...content, counted_in: 10 });
  assert.deepEqual(kind.apply(shown, { kind: "move", place: 0 }), { ok: false, reason: "demonstrating" });
  assert.equal(kind.refusalText("demonstrating", 0), "This chart shows the demonstration.");
  // The content at a pile: every field by its bare binding target.
  const pile = kind.contentAt({ ...content, bindings: [] }, (target) => ({ amount: 5000, target: 10, counted_in: 1000, moved_once: 3, moved_twice: 1 } as Record<string, number>)[target]);
  assert.equal(pile.bindings, undefined);
  assert.deepEqual([pile.amount, pile.target, pile.counted_in, pile.moved_once, pile.moved_twice], [5000, 10, 1000, 3, 1]);
  // A practice chart starts fresh: at its own start unit (never 0, never a demonstration's value), no row moved.
  const throwsStart = (s: PlaceValueTimesTenState) => () => kind.validateStart!(s, (message) => { throw new Error(message); });
  assert.throws(throwsStart(shown), /'counted_in' is its own start unit, 100/);
  assert.throws(throwsStart(moved.state), /no row moved/);
  assert.doesNotThrow(throwsStart(state));
  assert.equal(cardHowTo(PLACE_VALUE_TIMES_TEN_KIND, content), placeValueTimesTenHowTo(content));
  assert.equal(MATH_BUILDERS.place_value_times_ten, buildPlaceValueTimesTen);
  assert.equal(MATH_PLUGIN_MANIFEST.version, "0.10.0");
});

test("the complete fact: judged on each tap; done, the task's own problem at its own start unit, every row moved", () => {
  const fact = PLACE_VALUE_TIMES_TEN_CARD.facts.complete!;
  assert.equal(fact.judgedOnTap, true);
  const content = card(count()).content;
  assert.deepEqual(fact.read({ fact: "complete" }, PLACE_VALUE_TIMES_TEN_CARD.state(content)), { actual: 0, target: 1, succeeded: false });
  assert.deepEqual(fact.read({ fact: "complete" }, PLACE_VALUE_TIMES_TEN_CARD.state({ ...content, moved_once: 7, moved_twice: 7 })), { actual: 1, target: 1, succeeded: true });
  const start = timesTenStart({ amount: "0.3", target: "0.001" }, "5", "0.01").values;
  const pile = fact.donePile({ content, completion: { fact: "complete" }, startValue: (alias) => (alias === undefined ? 0 : start[alias] ?? 0) });
  // 5 ones -> hundredths: started counted in ones (1000), five rows moved twice.
  assert.deepEqual(pile, { amount: 5000, target: 10, counted_in: 1000, moved_once: 31, moved_twice: 31 });
  const timesPile = PLACE_VALUE_TIMES_TEN_CARD.facts.complete!.donePile({
    content: card(times()).content, completion: { fact: "complete" },
    startValue: (alias) => (timesTenStart({ amount: "700", target: "70" }, "4000", "400").values as Record<string, number>)[alias ?? ""] ?? 0,
  });
  assert.deepEqual(timesPile, { amount: 4_000_000, target: 400_000, counted_in: 1_000_000, moved_once: 15 });
});

test("a lesson with the card: schema, validation, normalization, execution requirements", () => {
  for (const lesson of [count(), times(), together(), count({ language: "zh-CN" })]) {
    assertAuthoringSchema(lesson);
    validateAuthoringLesson(lesson);
    const events = normalizeAuthoringLesson(lesson, timesTenHost(`l${task(lesson).start.values.amount}`));
    const requirements = deriveExecutionRequirements(events);
    for (const feature of [PLACE_VALUE_TIMES_TEN_FEATURE, "card:place_value_times_ten", "student-tasks:card_fact:complete", "value-bindings:card-field"]) {
      assert.ok(requirements.requiredCapabilities.includes(feature), `${feature} required`);
    }
    assert.ok(!requirements.requiredCapabilities.includes("node:place_value_times_ten"));
    assert.equal(requirements.minimumPlayerVersion, "0.18.0");
    assert.deepEqual(requirements.requiredPlugins, { math: "0.10.0" });
    assert.doesNotThrow(() => assertExecutionSupported(events));
    assert.throws(() => assertExecutionSupported(events, "0.17.0"), /0.18.0/);
    // The reducer evaluates the bare bindings: a practice start puts the task's own numbers on the card.
    const board = reduceCanonicalEvents(events);
    const node = Object.values(board.nodes).find((candidate: any) => candidate.kind === PLACE_VALUE_TIMES_TEN_KIND) as any;
    assert.equal(node.content.counted_in, PLACE_VALUE_TIMES_TEN_CARD.state(node.content).problem.start);
    const practice = setLessonVariables(board, task(lesson).start.values);
    assert.equal(practice.nodes[node.id]!.content.amount, task(lesson).start.values.amount);
  }
  assert.equal(OLL_PLAYER_EXECUTION_VERSION, "0.18.0");
});

test("practice: its own problem of the card's shape, counted in at its own start unit, rows fresh", () => {
  const withStart = (values: Record<string, number>) => {
    const lesson = count();
    task(lesson).start = { ...task(lesson).start, values: { ...task(lesson).start.values, ...values } };
    return lesson;
  };
  assert.throws(() => validateAuthoringLesson(withStart({ counted_in: 0 })), /counted_in/, "0 is never a start");
  assert.throws(() => validateAuthoringLesson(withStart({ counted_in: 10 })), /'counted_in' is its own start unit, 1000/);
  assert.throws(() => validateAuthoringLesson(withStart({ moved_once: 1 })), /no row moved/);
  assert.throws(() => validateAuthoringLesson(withStart({ amount: 300, target: 1, counted_in: 100 })), /are the lesson's own; a practice task starts on another pair/);
  // Another shape: a times pair's numbers on a count card.
  assert.throws(() => validateAuthoringLesson(withStart({ amount: 700_000, target: 70_000, counted_in: 100_000 })), /not_same_shape|outside/);
  // Every field the card binds is in the start.
  const missing = count();
  task(missing).start = { kind: "practice", variables: ["amount", "target", "counted_in", "moved_once"], values: { amount: 5000, target: 10, counted_in: 1000, moved_once: 0 } };
  assert.throws(() => validateAuthoringLesson(missing), /missing moved_twice/);
  // The task allows only tapping the card (the completing tap ends it).
  const done = count();
  task(done).allowed_operations = [{ kind: "card_tap", node: "chart" }, { kind: "card_submit" }];
  assert.throws(() => validateAuthoringLesson(done), /allows only tapping its card/);
});

test("the answer right after the card's task is the card's own", () => {
  // A wrong blank in the row after the task.
  const wrong = times();
  task(wrong, 1).completion.parts = timesTenRow(timesTenPracticeOf({ amount: "700", target: "70" }, "4000", "400")).map((part: any) => ("blank" in part && part.blank.as === "renamed" ? { blank: { ...part.blank, answer: "400" } } : part));
  assert.throws(() => validateAuthoringLesson(wrong), /asks the card's own answers \(4,000 = 10 × 400.*2 blanks, 40 and 10/);
  // One blank where the card has two.
  const short = times();
  task(short, 1).completion.parts = [{ text: "4,000 is" }, { blank: { as: "times", answer: "10" } }, { text: "times 400" }];
  assert.throws(() => validateAuthoringLesson(short), /2 blanks, 40 and 10/);
  // A single typed answer after a count: the card's count.
  const single = (answer: string) => {
    const lesson = count();
    (lesson.lesson.tasks as any[])[1] = { as: "a", anchor: "chart", prompt: "How many hundredths?", availability: { kind: "after_lesson" }, allowed_operations: [{ kind: "answer_entry" }], completion: { kind: "numeric_answer", answer }, hints: ["Count."] };
    return lesson;
  };
  assert.doesNotThrow(() => validateAuthoringLesson(single("500")));
  assert.throws(() => validateAuthoringLesson(single("50")), /the card's own \(5 ones = 500 hundredths\): 500/);
  // A typed question anchored to the card that does not follow a task on it is the lesson's own.
  const own = count({ extraTasks: [{ as: "q", anchor: "chart", prompt: "What is 0.3 × 10?", availability: { kind: "after_lesson" }, allowed_operations: [{ kind: "answer_entry" }], completion: { kind: "numeric_answer", answer: "3" }, hints: ["Think."] }] });
  task(own, 2).as = "q";
  const swapped = own.lesson.tasks as any[];
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.throws(() => validateAuthoringLesson(own), /the card's own/, "right after the card task it is checked");
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.doesNotThrow(() => validateAuthoringLesson(own), "after the card's own row it is the lesson's");
});

test("the lesson never taps the card, nor moves its row sets or its problem", () => {
  const tapped = count({ beats: [{ key: "tap", say: "Watch.", actions: [{ do: "tap", target: "chart", tap: "move", at: "row-1" }] } as any] });
  assert.throws(() => validateAuthoringLesson(tapped), /not tapped by the lesson/);
  const rows = count({ beats: [{ key: "a", say: "Look.", actions: [{ do: "animate", variable: "moved_once", value: 1 }] } as any] });
  assert.throws(() => validateAuthoringLesson(rows), /'moved_once' is a column's state on a place_value_times_ten card: only the learner's taps change it/);
  const problem = count({ beats: [{ key: "a", say: "Look.", actions: [{ do: "animate", variable: "amount", value: 5000 }] } as any] });
  assert.throws(() => validateAuthoringLesson(problem), /'amount' is a number of a place_value_times_ten card's problem: the lesson does not animate it/);
  // As canonical events too: a card.tap on the card is refused by the reducer.
  const state = reduceCanonicalEvents(normalizeAuthoringLesson(count(), timesTenHost("reduce")));
  const node = Object.values(state.nodes).find((candidate: any) => candidate.kind === PLACE_VALUE_TIMES_TEN_KIND) as any;
  assert.throws(() => applyCanonicalAction(structuredClone(state), { op: "card.tap", target: { node_id: node.id }, tap: { kind: "move", place: 0 } } as any), /not tapped by a lesson/);
});

test("bound values: every field in its own range, the card drawable at each", () => {
  const lesson = count();
  const counted = (lesson.lesson.variables as any[]).find((variable) => variable.as === "counted_in");
  counted.min = 0;
  assert.doesNotThrow(() => validateAuthoringLesson(lesson), "a variable may pass 0: the card's state is total");
  const rows = count();
  (rows.lesson.variables as any[]).find((variable) => variable.as === "moved_once").max = 1023;
  assert.throws(() => validateAuthoringLesson(rows), /0 to 511/, "a row set's variable runs 0 to 511");
});
