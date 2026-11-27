// The make-ten card inside a lesson (decision 0027): the card-kind registry entry, core validation of its tasks and
// demonstrations, the card-level bindings (the pair, the demonstration's count in the bigger frame, the count
// moved), the row of four blanks anchored on the card, the reducer, and execution requirements. Pairs are the sketch's.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCanonicalAction, assertAuthoringSchema, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson, reduceCanonicalEvents,
  setLessonVariables, validateAuthoringLesson, OLL_PLAYER_EXECUTION_VERSION, type AuthoringLesson,
} from "../../core/src/index.js";
import { MAKE_TEN_CARD, MAKE_TEN_DEMONSTRATION, tapCardKind } from "../../core/src/cards.js";
import { MATH_PLUGIN_MANIFEST, cardHowTo } from "../src/index.js";
import { MAKE_TEN_FEATURE, MAKE_TEN_KIND, makeTenComplete, makeTenFrame, makeTenHowTo, makeTenState } from "../src/make-ten.js";
import { makeTenHost, makeTenLesson, makeTenStart, type MakeTenLessonInput } from "./make-ten-fixtures.js";

const lesson86 = (extra: Partial<MakeTenLessonInput> = {}) => makeTenLesson({ a: 8, b: 6, practice: [[7, 5]], ...extra });
const task = (lesson: AuthoringLesson, index = 0) => (lesson.lesson.tasks as any[])[index];
const card = (lesson: AuthoringLesson) => (lesson.steps[0]!.beats[0]!.actions[0] as any);
const animate = (key: string, values: Record<string, number>): any => ({ key, say: "Look.", actions: Object.entries(values).map(([variable, value]) => ({ do: "animate", variable, value })) });
const variable = (lesson: AuthoringLesson, as: string) => (lesson.lesson.variables as any[]).find((candidate) => candidate.as === as);

test("the registry entry: taps at a frame, the count moved, the pair and the count in the bigger frame card-level", () => {
  const kind = MAKE_TEN_CARD;
  assert.equal(tapCardKind(MAKE_TEN_KIND), kind);
  assert.deepEqual([kind.taps, kind.places], [["give", "back"], ["first", "second"]]);
  assert.deepEqual([kind.cardFields, kind.practiceFields, kind.demonstration?.field, kind.fieldsAtOnce], [["a", "b", "filled"], ["a", "b"], "filled", true]);
  const content = card(lesson86()).content;
  // The demonstration's count starts at the pair's bigger addend, taken from the pair.
  assert.equal(kind.demonstration, MAKE_TEN_DEMONSTRATION);
  assert.deepEqual([MAKE_TEN_DEMONSTRATION.start(content), MAKE_TEN_DEMONSTRATION.opensAtStart], [8, true]);
  assert.deepEqual(MAKE_TEN_DEMONSTRATION.range(content), { min: 8, max: 10 });
  assert.deepEqual([8, 9, 10].map((k) => MAKE_TEN_DEMONSTRATION.next(content, k)), [
    "the next value, 9, moves one of the 6 into the 8's frame", "the next value, 10, moves one of the 6 into the 8's frame", "the 8's frame holds ten at 10",
  ]);
  assert.deepEqual(MAKE_TEN_DEMONSTRATION.range(card(makeTenLesson({ a: 3, b: 8 })).content), { min: 8, max: 10 }, "3 + 8 starts at 8 too");
  assert.deepEqual(kind.tapFields(content), [{ place: 0, field: "moved", min: 0, max: 4 }]);
  assert.equal(kind.fieldTarget(content, 0, "moved"), "moved", "bound by its bare name");
  // A tap on the 8's own counters is refused with a fact naming their colour; a counter of the 6 crosses.
  const state = kind.state(content);
  assert.deepEqual(kind.apply(state, { kind: "give", place: 0 }), { ok: false, reason: "stays" });
  assert.equal(kind.refusalText("stays", 0, "en-US", state), "Red counters stay in their frame.");
  assert.equal(kind.refusalText("stays", 1, "zh-CN", kind.state({ ...content, a: 4, b: 9, filled: 9 })), "蓝色的圆片留在自己的框里。");
  const moved = kind.apply(state, { kind: "give", place: 1 });
  assert.ok(moved.ok);
  assert.deepEqual(kind.changes(state, moved.state), [{ place: 0, field: "moved", before: 0, after: 1 }]);
  // Frames showing a demonstration take no taps.
  const shown = kind.state({ ...content, filled: 9 });
  assert.deepEqual(kind.apply(shown, { kind: "give", place: 1 }), { ok: false, reason: "demonstrating" });
  assert.equal(kind.refusalText("demonstrating", 1, "en-US", shown), "These frames show the demonstration.");
  // The content at a pile: every bound field by its bare name.
  const pile = kind.contentAt({ ...content, bindings: [] }, (target) => ({ a: 7, b: 5, filled: 7, moved: 3 } as Record<string, number>)[target]);
  assert.equal(pile.bindings, undefined);
  assert.deepEqual([pile.a, pile.b, pile.filled, pile.moved], [7, 5, 7, 3]);
  // A practice card starts fresh.
  assert.throws(() => kind.validateStart!(kind.state({ ...content, filled: 10 }), (message) => { throw new Error(message); }), /nothing demonstrated: filled is 10, not 8/);
  assert.throws(() => kind.validateStart!({ ...state, moved: 1 }, (message) => { throw new Error(message); }), /moved is 1, not 0/);
  assert.equal(cardHowTo(MAKE_TEN_KIND, content), makeTenHowTo(content));
});

test("the complete fact: judged on each tap; done, the card lays the task's own pair with its ten made", () => {
  const fact = MAKE_TEN_CARD.facts.complete!;
  assert.deepEqual([fact.judgedOnTap, fact.keys], [true, []]);
  const content = card(lesson86()).content;
  assert.deepEqual(fact.read({ fact: "complete" }, MAKE_TEN_CARD.state(content)), { actual: 0, target: 1, succeeded: false });
  assert.deepEqual(fact.read({ fact: "complete" }, MAKE_TEN_CARD.state({ ...content, moved: 2 })), { actual: 1, target: 1, succeeded: true });
  assert.deepEqual(fact.read({ fact: "complete" }, MAKE_TEN_CARD.state({ ...content, filled: 10 })).succeeded, true, "also a demonstration's ten");
  const start = makeTenStart({}, 7, 5).values;
  const pile = fact.donePile({ content, completion: { fact: "complete" }, startValue: (alias) => (alias === undefined ? 0 : start[alias] ?? 0) })!;
  assert.deepEqual(pile, { a: 7, b: 5, filled: 7, moved: 3 });
  const done = makeTenState({ a: 7, b: 5, filled: 7, moved: 3 });
  assert.deepEqual([makeTenComplete(done), makeTenFrame(done, 1).count], [true, 2]);
});

test("a make-ten lesson with a practice pair and the row anchored on the card: validated, normalized, every field bound bare", () => {
  const lesson = lesson86();
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);
  assert.deepEqual(card(lesson).content, {
    a: 8, b: 6, filled: 8, moved: 0,
    bindings: [{ target: "a", expression: "a" }, { target: "b", expression: "b" }, { target: "filled", expression: "filled" }, { target: "moved", expression: "moved" }],
  });
  assert.equal(lesson.lesson.variables!.length, 4, "the pair, the count in the bigger frame, the count moved");
  // The row of four blanks is a task anchored on the card, right after its card task; the program wrote it.
  assert.deepEqual([task(lesson, 1).anchor, task(lesson, 1).completion.kind, task(lesson, 1).completion.parts.filter((part: any) => part.blank).map((part: any) => part.blank.answer)],
    ["frames", "numeric_row", ["3", "2", "2", "12"]]);
  assert.equal(task(lesson, 1).success_message, "7 + 5 = 7 + 3 + 2 = 10 + 2 = 12");
  const events = normalizeAuthoringLesson(lesson, makeTenHost("mt"));
  const node = (events[1] as any).step.beats[0].stage.during_speech[0].node;
  assert.deepEqual(node.content.bindings.map((binding: any) => binding.target), ["a", "b", "filled", "moved"]);
  const board = reduceCanonicalEvents(events);
  assert.equal(board.nodes["mt:node:frames"]!.content.filled, 8);
  // A practice start sets the pair and its fresh count; the reducer evaluates the bare bindings.
  const practice = setLessonVariables(board, makeTenStart({}, 7, 5).values);
  assert.deepEqual(["a", "b", "filled", "moved"].map((field) => practice.nodes["mt:node:frames"]!.content[field]), [7, 5, 7, 0]);
  validateAuthoringLesson(makeTenLesson({ a: 4, b: 9, practice: [[3, 8], [9, 8]], language: "zh-CN" }));
  validateAuthoringLesson(makeTenLesson({ a: 9, b: 5, practice: [[9, 7]], noDemo: true }));
  // Unbound, the count in the bigger frame keeps the lesson's value: a practice pair with another bigger number
  // cannot start it there (review of #122), and the refusal says to bind it.
  assert.throws(() => validateAuthoringLesson(makeTenLesson({ a: 9, b: 5, practice: [[7, 5]], noDemo: true })), (error: any) => {
    assert.equal(error.message, "The practice starts the card's 'filled' at 7, not the 9 written on the card: bind 'filled' to a lesson variable the task's start sets");
    return true;
  });
});

test("a make-ten lesson requires the card's feature, its fact, the card-level bindings and the row: player 0.18.0, math 0.10.0", () => {
  // The times-ten card (0028) moved both on since; a make-ten lesson still needs only player 0.18.0 and math 0.10.0.
  assert.equal(MATH_PLUGIN_MANIFEST.version, "0.11.0");
  assert.equal(OLL_PLAYER_EXECUTION_VERSION, "0.19.0");
  const events = normalizeAuthoringLesson(lesson86(), makeTenHost("mt"));
  const requirements = deriveExecutionRequirements(events);
  for (const feature of [MAKE_TEN_FEATURE, "card:make_ten", "student-tasks:card_fact:complete", "value-bindings:card-field", "student-tasks:numeric_row"]) {
    assert.ok(requirements.requiredCapabilities.includes(feature), feature);
  }
  assert.ok(!requirements.requiredCapabilities.includes("node:make_ten"));
  assert.equal(requirements.minimumPlayerVersion, "0.18.0");
  assert.deepEqual(requirements.requiredPlugins, { math: "0.10.0" });
  assert.doesNotThrow(() => assertExecutionSupported(events));
  assert.throws(() => assertExecutionSupported(events, "0.17.0"), /0.18.0/);
  assert.throws(() => assertExecutionSupported(events, undefined, undefined, { extensions: [{ plugin: { id: "math", version: "0.9.0" }, features: {} }] }), /math' plugin 0.10.0; installed 0.9.0/);
});

test("the pairs the card refuses, at the card's content, so only the picture is lost", () => {
  const refused = (input: MakeTenLessonInput, pattern: RegExp) => assert.throws(() => validateAuthoringLesson(makeTenLesson(input)), (error: any) => {
    assert.match(`${error.path}: ${error.message}`, pattern);
    assert.equal(error.code, "OLL_INVALID_OPERATION_PAYLOAD");
    assert.match(error.path, /^\/steps\/0\/beats\/0\/actions\/0\/content/);
    return true;
  });
  refused({ a: 6, b: 3 }, /content\/b: 6 \+ 3 is less than ten: there is no ten to make \(under_ten\)/);
  refused({ a: 7, b: 3 }, /7 \+ 3 is exactly ten: .*partners of ten.*\(exactly_ten\)/);
  // The demonstration's count does not start at 0: it starts at the pair's bigger addend (decision 0027).
  const zero = lesson86({ practice: [] });
  card(zero).content.filled = 0;
  variable(zero, "filled").initial = 0;
  assert.throws(() => validateAuthoringLesson(zero), /'filled' counts the counters in the bigger addend's frame: for 8 \+ 6 it starts at 8, the bigger addend, not 0/);
  // Checked as its variables start it too, when only the variable says 0.
  const startsAtZero = lesson86({ practice: [] });
  variable(startsAtZero, "filled").initial = 0;
  assert.throws(() => validateAuthoringLesson(startsAtZero), /As its variables start it: 'filled' counts the counters .* starts at 8, the bigger addend, not 0/);
  // Nor above it: the card would open with the ten already made (review of #119), as written or as its variables start it.
  const made = lesson86({ practice: [] });
  card(made).content.filled = 10;
  variable(made, "filled").initial = 10;
  assert.throws(() => validateAuthoringLesson(made), (error: any) => {
    assert.equal(error.message, "A card opens fresh: for 8 + 6 'filled' starts at 8, the bigger addend, not 10");
    assert.equal(error.path, "/steps/0/beats/0/actions/0/content/filled");
    assert.equal(error.code, "OLL_INVALID_OPERATION_PAYLOAD");
    return true;
  });
  const madeByVariable = lesson86({ practice: [] });
  variable(madeByVariable, "filled").initial = 9;
  assert.throws(() => validateAuthoringLesson(madeByVariable), (error: any) => {
    assert.equal(error.message, "As its variables start it: A card opens fresh: for 8 + 6 'filled' starts at 8, the bigger addend, not 9");
    return true;
  });
  // Nor with counters already moved.
  const moved = lesson86();
  card(moved).content.moved = 1;
  variable(moved, "moved").initial = 1;
  assert.throws(() => validateAuthoringLesson(moved), (error: any) => {
    assert.equal(`${error.path}: ${error.message}`, "/steps/0/beats/0/actions/0/content/moved: A card opens fresh: nothing moved, not 1");
    return true;
  });
  // Nor as the lesson has played when the card is written (review of #122): a beat before it, an earlier phase of
  // its own beat, a replay before it, or an earlier card on the same variables may not have filled the frame.
  const played = (lesson: AuthoringLesson, pattern: string) => assert.throws(() => validateAuthoringLesson(lesson), (error: any) => {
    assert.equal(error.message, pattern);
    assert.equal(error.code, "OLL_INVALID_OPERATION_PAYLOAD");
    return true;
  });
  const fresh = "As the lesson has played when the card is written: A card opens fresh: for 8 + 6 'filled' starts at 8, the bigger addend, not ";
  const before = lesson86();
  before.steps[0]!.beats.unshift(animate("pre", { filled: 10 }));
  played(before, `${fresh}10`);
  const samePhase = lesson86();
  (samePhase.steps[0]!.beats[0]!.actions as any[]).unshift({ do: "animate", variable: "filled", value: 10, when: "before_speech" });
  played(samePhase, `${fresh}10`);
  const replayed = lesson86();
  replayed.steps[0]!.beats.unshift({ key: "pre", say: "Look.", start: { kind: "replay", variables: ["filled"], values: { filled: 9 } }, actions: [{ do: "write", as: "note", kind: "text", role: "note", content: { text: "8 + 6" }, place: { relation: "new_region" } }] } as any);
  played(replayed, `${fresh}9`);
  const second = lesson86();
  const again = structuredClone(card(second));
  again.as = "frames-2";
  second.steps[0]!.beats.push(animate("ten", { filled: 10 }), { key: "again", say: "Another card.", actions: [again] } as any);
  played(second, `${fresh}10`);
  // A card written after its demonstration, on variables still at their start, opens fresh.
  const later = lesson86();
  later.steps[0]!.beats.unshift({ key: "intro", say: "Two numbers.", actions: [{ do: "write", as: "note", kind: "text", role: "note", content: { text: "8 + 6" }, place: { relation: "new_region" } }] } as any);
  validateAuthoringLesson(later);
});

test("a practice pair is the task's own, starting fresh: its bigger addend in the bigger frame, nothing moved", () => {
  validateAuthoringLesson(lesson86({ practice: [[9, 6]] }));
  assert.throws(() => validateAuthoringLesson(lesson86({ practice: [[8, 6]] })), /The task's a and b \(a = 8, b = 6\) are the lesson's own; a practice task starts on another pair/);
  assert.throws(() => validateAuthoringLesson(lesson86({ practice: [[5, 4]] })), /practice pile is not a starting pile: .*5 \+ 4 is less than ten/);
  // The practice's count in the bigger frame is its own pair's bigger addend, not the lesson's.
  const lessonCount = lesson86({ practice: [[7, 5]] });
  task(lessonCount).start.values.filled = 8;
  assert.throws(() => validateAuthoringLesson(lessonCount), /practice pile is not a starting pile: A card opens fresh: for 7 \+ 5 'filled' starts at 7, the bigger addend, not 8/);
  const fromZero = lesson86();
  task(fromZero).start.values.filled = 0;
  assert.throws(() => validateAuthoringLesson(fromZero), /practice pile is not a starting pile: 'filled' counts the counters .* for 7 \+ 5 it starts at 7, the bigger addend, not 0/);
  const worked = lesson86();
  task(worked).start.values.moved = 1;
  assert.throws(() => validateAuthoringLesson(worked), /practice pile is not a starting pile: A card opens fresh: nothing moved, not 1/);
  const partial = lesson86();
  task(partial).start.variables = ["a", "b"];
  task(partial).start.values = { a: 7, b: 5 };
  assert.throws(() => validateAuthoringLesson(partial), /sets every field the card binds; missing moved, filled/);
  // The count moved runs 0..4, the most that ever cross: one range fits every pair.
  const narrow = lesson86();
  variable(narrow, "moved").max = 2;
  assert.throws(() => validateAuthoringLesson(narrow), /Variable 'moved' \(moved\) must run from 0 to 4/);
});

test("a complete task has no done: it allows only tapping its card", () => {
  const withDone = lesson86();
  task(withDone).allowed_operations.push({ kind: "card_submit" });
  assert.throws(() => validateAuthoringLesson(withDone), /A complete task allows only tapping its card \(card_tap\)/);
  const wrongFact = lesson86();
  task(wrongFact).completion.fact = "no_trade_left";
  assert.throws(() => validateAuthoringLesson(wrongFact), /Unsupported card fact 'no_trade_left'/);
});

test("the lesson shows the card by the count in the bigger frame: forward from the bigger addend, whole; it never taps it nor moves a counter", () => {
  validateAuthoringLesson(lesson86({ beats: [animate("one", { filled: 9 }), animate("again", { filled: 9 }), animate("ten", { filled: 10 })] }));
  validateAuthoringLesson(lesson86({ beats: [animate("partial", { filled: 9 })] })); // a lesson may stop partway
  assert.throws(() => validateAuthoringLesson(lesson86({ beats: [animate("ten", { filled: 10 }), animate("back", { filled: 9 })] })),
    /'filled' counts the counters in the bigger addend's frame of a make_ten card: it goes forward, not from 10 back to 9; the 8's frame holds ten at 10/);
  assert.throws(() => validateAuthoringLesson(lesson86({ beats: [animate("half", { filled: 8.5 })] })), /a whole number, not 8.5; from 8, the next value, 9, moves one of the 6 into the 8's frame/);
  assert.throws(() => validateAuthoringLesson(lesson86({ beats: [animate("move", { moved: 1 })] })),
    /'moved' is the count the learner moved on a make_ten card: only the learner's taps change it; the lesson animates 'filled'/);
  assert.throws(() => validateAuthoringLesson(lesson86({ beats: [animate("pair", { a: 9 })] })), /'a' is a number of a make_ten card's problem: the lesson does not animate it/);
  assert.throws(() => validateAuthoringLesson(lesson86({ beats: [{ key: "tap", say: "Look.", actions: [{ do: "tap", target: "frames", tap: "give", at: "second" }] } as any] })),
    /A make_ten card is not tapped by the lesson: animate the variable bound to its 'filled' \(the count in the bigger addend's frame, from the bigger addend up to 10\), and the program moves each counter/);
  // Past ten is refused at the variable's range by the card's own range.
  const far = lesson86();
  variable(far, "filled").max = 10;
  assert.throws(() => validateAuthoringLesson({ ...far, steps: [{ ...far.steps[0]!, beats: [...far.steps[0]!.beats, animate("far", { filled: 11 })] }] } as AuthoringLesson),
    /'filled' counts the counters in the bigger addend's frame of a make_ten card: 8 to 10, not 11/);
  // A replay restarts the demonstration: the count back to a whole number the pair allows, nothing moved.
  const replay = (values: Record<string, number>): AuthoringLesson => lesson86({ beats: [animate("ten", { filled: 10 }),
    { key: "again", say: "Once more.", start: { kind: "replay", variables: Object.keys(values), values }, actions: [{ do: "animate", variable: "filled", value: 10 }] } as any] });
  validateAuthoringLesson(replay({ filled: 8 }));
  assert.throws(() => validateAuthoringLesson(replay({ filled: 8, moved: 1 })), /'moved' is the count the learner moved on a make_ten card: a replay lays a fresh card \(0\), not 1/);
  assert.throws(() => validateAuthoringLesson(replay({ filled: 3 })), /The replay's card is not one this card takes: 'filled' .* starts at 8, the bigger addend, not 3/);
  validateAuthoringLesson(replay({ a: 9, b: 7, filled: 9 }));
});

test("the demonstration's rules cannot be bypassed: plain bindings, beats before the card; a demonstration-only lesson needs player 0.18.0", () => {
  const expression = lesson86();
  for (const binding of card(expression).content.bindings) if (binding.target === "filled") binding.expression = "filled + 0";
  assert.throws(() => validateAuthoringLesson(expression), /A make_ten card binds each field to one lesson variable by name, not 'filled \+ 0'/);
  const before = lesson86();
  before.steps[0]!.beats.unshift(animate("pre", { moved: 1 }));
  assert.throws(() => validateAuthoringLesson(before), /'moved' is the count the learner moved on a make_ten card/);
  const events = normalizeAuthoringLesson(makeTenLesson({ a: 8, b: 6, beats: [animate("ten", { filled: 10 })] }), makeTenHost("only"));
  const requirements = deriveExecutionRequirements(events);
  assert.equal(requirements.minimumPlayerVersion, "0.18.0");
  assert.ok(requirements.requiredCapabilities.includes("card:make_ten"));
  assert.throws(() => assertExecutionSupported(events, "0.17.0"), /0.18.0/);
  const board = reduceCanonicalEvents(events);
  assert.throws(() => applyCanonicalAction(board, { action_id: "x", op: "card.tap", target: { node_id: "only:node:frames" }, tap: { kind: "give", place: 1 } } as any),
    /A make_ten card is not tapped by a lesson: it is shown by its 'filled'/);
});
