// The place-value trade card inside a lesson (decision 0026): the card-kind registry entry, core validation of
// its tasks and demonstrations, the card-level bindings (the pair and "columns finished"), the reducer, and
// execution requirements. Numbers are the sketch's.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCanonicalAction, assertAuthoringSchema, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson, reduceCanonicalEvents,
  setLessonVariables, validateAuthoringLesson, OLL_PLAYER_EXECUTION_VERSION, type AuthoringLesson,
} from "../../core/src/index.js";
import { PLACE_VALUE_TRADE_CARD, PLACE_VALUE_TRADE_DEMONSTRATION, tapCardKind } from "../../core/src/cards.js";
import { MATH_PLUGIN_MANIFEST, cardHowTo } from "../src/index.js";
import { PLACE_VALUE_TAP_PLACES, placeValueTapIndex } from "../src/place-value-chart.js";
import {
  PLACE_VALUE_TRADE_FEATURE, PLACE_VALUE_TRADE_KIND, placeValueTradeCell, placeValueTradeHowTo, placeValueTradeState, type PlaceValueTradeState,
} from "../src/place-value-trade.js";
import { tradeHost, tradeLesson, tradeStart, tradeValue, tradeVariable, type TradeLessonInput } from "./place-value-trade-fixtures.js";

const add = (extra: Partial<TradeLessonInput> = {}) => tradeLesson({ operation: "add", a: "3486", b: "2739", practice: [["4658", "1573"]], ...extra });
const sub = (extra: Partial<TradeLessonInput> = {}) => tradeLesson({ operation: "subtract", a: "50003", b: "2476", practice: [["40002", "3585"]], ...extra });
const task = (lesson: AuthoringLesson, index = 0) => (lesson.lesson.tasks as any[])[index];
const card = (lesson: AuthoringLesson) => (lesson.steps[0]!.beats[0]!.actions[0] as any);
const animate = (key: string, values: Record<string, number>): any => ({ key, say: "Look.", actions: Object.entries(values).map(([variable, value]) => ({ do: "animate", variable, value })) });
const at = (place: number) => placeValueTapIndex(place);

test("the registry entry: taps by a place's index, one status per column, the pair and columns finished card-level", () => {
  const kind = PLACE_VALUE_TRADE_CARD;
  assert.equal(tapCardKind(PLACE_VALUE_TRADE_KIND), kind);
  assert.deepEqual(kind.taps, ["down", "trade", "break"]);
  assert.deepEqual(kind.places, PLACE_VALUE_TAP_PLACES);
  assert.deepEqual([kind.cardFields, kind.practiceFields, kind.demonstration?.field, kind.fieldsAtOnce], [["a", "b", "finished"], ["a", "b"], "finished", true]);
  const content = card(sub({ noDemo: true })).content;
  // What each next value of columns finished does on this card, for the compiler's refusals.
  assert.equal(kind.demonstration, PLACE_VALUE_TRADE_DEMONSTRATION);
  assert.deepEqual(PLACE_VALUE_TRADE_DEMONSTRATION.range(content), { min: 0, max: 5 });
  assert.deepEqual([0, 2, 4, 5].map((k) => PLACE_VALUE_TRADE_DEMONSTRATION.next(content, k)), [
    "the next value, 1, finishes the ones", "the next value, 3, finishes the hundreds", "the next value, 5, finishes the ten thousands", "every column is finished at 5",
  ]);
  assert.deepEqual(kind.tapFields(content).map(({ place, field, min, max }) => `${kind.places[place]}.${field} ${min}..${max}`),
    ["ten-thousands.status 0..3", "thousands.status 0..3", "hundreds.status 0..3", "tens.status 0..3", "ones.status 0..3"]);
  assert.deepEqual(kind.tapFields(card(add()).content).map(({ max }) => max), [2, 2, 2, 2]);
  assert.equal(kind.fieldTarget(content, at(0), "status"), "ones.status");
  const onBoard = { ...content, places: content.places.map(({ as, ...rest }: any) => ({ ...rest, id: `l:node:sum:fragment:${as}` })) };
  assert.equal(kind.fieldTarget(onBoard, at(4), "status"), "l:node:sum:fragment:ten-thousands.status");
  // The ones are short: ↓ is refused with the counts, said in the card's words; a break across the zeros is taken.
  const state = kind.state(content);
  assert.deepEqual(kind.apply(state, { kind: "down", place: at(0) }), { ok: false, reason: "not_enough" });
  assert.equal(kind.refusalText("not_enough", at(0), "en-US", state), "This column has 3; taking away 6 needs more.");
  assert.equal(kind.refusalText("not_enough", at(0), "zh-CN", state), "这一位只有 3 个，拿走 6 个不够。");
  assert.equal(kind.refusalText("not_enough", at(0)), "That can't be done here.", "without the card, a sentence that needs counts is not made up");
  assert.equal(kind.refusalText("no_right", at(0)), "There is no column to the right to break into.");
  assert.equal(kind.refusalText("not_down", at(0), "zh-CN"), "这一位横线下面还没有圆片。");
  // A chart showing a demonstration takes no taps (review of #115), said in the card's words.
  const shown = kind.state({ ...content, finished: 1 });
  assert.deepEqual(kind.apply(shown, { kind: "down", place: at(4) }), { ok: false, reason: "demonstrating" });
  assert.equal(kind.refusalText("demonstrating", at(4), "en-US", shown), "This chart shows the demonstration's columns.");
  assert.equal(kind.refusalText("demonstrating", at(4)), "This chart shows the demonstration's columns.");
  const broke = kind.apply(state, { kind: "break", place: at(4) });
  assert.ok(broke.ok);
  assert.deepEqual(kind.changes(state, broke.state), [{ place: at(3), field: "status", before: 0, after: 2 }]);
  // The content at a pile: statuses and the card-level fields, by binding target.
  const pile = kind.contentAt({ ...content, bindings: [] }, (target) => ({ "ones.status": 3, a: 4_000_200, b: 358_500, finished: 2 } as Record<string, number>)[target]);
  assert.equal(pile.bindings, undefined);
  assert.deepEqual([pile.a, pile.b, pile.finished, (pile.places as any[]).at(-1).status], [4_000_200, 358_500, 2, 3]);
  // A practice chart starts fresh.
  assert.throws(() => kind.validateStart!(kind.state({ ...content, finished: 1 }), (message) => { throw new Error(message); }), /no column demonstrated; columns finished is 1/);
  assert.throws(() => kind.validateStart!({ ...state, status: { ...state.status, 3: 2 } }, (message) => { throw new Error(message); }), /the thousands column's status is 2/);
  assert.equal(cardHowTo(PLACE_VALUE_TRADE_KIND, content), placeValueTradeHowTo(content));
});

test("the complete fact: judged on each tap; done, the card lays the one finished chart of the task's own pair", () => {
  const fact = PLACE_VALUE_TRADE_CARD.facts.complete!;
  assert.equal(fact.judgedOnTap, true);
  assert.deepEqual(fact.keys, []);
  const content = card(add()).content;
  const fresh = PLACE_VALUE_TRADE_CARD.state(content);
  assert.deepEqual(fact.read({ fact: "complete" }, fresh), { actual: 0, target: 1, succeeded: false });
  assert.deepEqual(fact.read({ fact: "complete" }, PLACE_VALUE_TRADE_CARD.state({ ...content, finished: 4 })), { actual: 1, target: 1, succeeded: true });
  const start = tradeStart({ operation: "add", a: "3486", b: "2739" }, "4658", "1573").values;
  const pile = fact.donePile({ content, completion: { fact: "complete" }, startValue: (alias) => (alias === undefined ? 0 : start[alias] ?? 0) })!;
  // 4,658 + 1,573: every column down; the ones, tens and hundreds each traded their ten.
  assert.deepEqual(pile, { a: 4_658_000, b: 1_573_000, finished: 0, col_thousands: 1, col_hundreds: 2, col_tens: 2, col_ones: 2 });
  const done = placeValueTradeState({ ...content, a: pile.a, b: pile.b, places: content.places.map((p: any) => ({ ...p, status: (pile as Record<string, number>)[tradeVariable(p.place)] })) });
  assert.deepEqual(done.problem.columns.map((p) => placeValueTradeCell(done, p).answer), [6, 2, 3, 1]);
});

test("a trade lesson with a practice pair and a typed answer: validated, normalized, the pair and columns finished bound bare", () => {
  const lesson = add();
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);
  assert.deepEqual(card(lesson).content.bindings.slice(0, 3), [{ target: "a", expression: "a" }, { target: "b", expression: "b" }, { target: "finished", expression: "finished" }]);
  assert.equal(lesson.lesson.variables!.length, 7, "3 + 4 columns");
  const events = normalizeAuthoringLesson(lesson, tradeHost("pt"));
  const node = (events[1] as any).step.beats[0].stage.during_speech[0].node;
  assert.deepEqual(node.content.bindings.slice(0, 4).map((binding: any) => binding.target), ["a", "b", "finished", "pt:node:sum:fragment:thousands.status"]);
  const board = reduceCanonicalEvents(events);
  assert.equal(board.nodes["pt:node:sum"]!.content.a, 3_486_000);
  // A practice start sets the pair; the reducer evaluates the bare bindings.
  const practice = setLessonVariables(board, tradeStart({ operation: "add", a: "3486", b: "2739" }, "4658", "1573").values);
  assert.deepEqual([practice.nodes["pt:node:sum"]!.content.a, practice.nodes["pt:node:sum"]!.content.b], [4_658_000, 1_573_000]);
  // Six columns: 9 variables, within the lesson's 16.
  const widest = tradeLesson({ operation: "subtract", a: "9000", b: "2345.67", practice: [["8000", "3456.78"]] });
  validateAuthoringLesson(widest);
  assert.equal(widest.lesson.variables!.length, 9);
  validateAuthoringLesson(tradeLesson({ operation: "subtract", language: "zh-CN", a: "8.2", b: "3.75", practice: [["9.3", "4.68"]] }));
  // A pair below 1: no ones column (review of #115); the schema takes the negative top place.
  const below = tradeLesson({ operation: "add", a: "0.35", b: "0.48", practice: [["0.27", "0.56"]] });
  assertAuthoringSchema(below);
  validateAuthoringLesson(below);
  assert.deepEqual([card(below).content.top_place, card(below).content.low_place, below.lesson.variables!.length], [-1, -2, 5]);
  assert.throws(() => validateAuthoringLesson(tradeLesson({ operation: "add", a: "0.35", b: "0.48", practice: [["0.65", "0.48"]] })),
    /0.65 \+ 0.48 needs the columns from ones to hundredths; the card draws tenths to hundredths/);
});

test("a trade lesson requires the card's feature, its fact and the card-level bindings: player 0.17.0, math 0.9.0", () => {
  // The make-ten card (0027) moved both on since; a trade lesson still needs only player 0.17.0 and math 0.9.0.
  assert.equal(MATH_PLUGIN_MANIFEST.version, "0.11.0");
  assert.equal(OLL_PLAYER_EXECUTION_VERSION, "0.19.0");
  const events = normalizeAuthoringLesson(add(), tradeHost("pt"));
  const requirements = deriveExecutionRequirements(events);
  for (const feature of [PLACE_VALUE_TRADE_FEATURE, "student-tasks:card_fact:complete", "value-bindings:card-field", "student-tasks:numeric_answer"]) assert.ok(requirements.requiredCapabilities.includes(feature), feature);
  assert.ok(!requirements.requiredCapabilities.includes("node:place_value_trade"));
  assert.equal(requirements.minimumPlayerVersion, "0.17.0");
  assert.deepEqual(requirements.requiredPlugins, { math: "0.9.0" });
  assert.doesNotThrow(() => assertExecutionSupported(events));
  // An older player, or math plugin, refuses the lesson before playback.
  assert.throws(() => assertExecutionSupported(events, "0.16.0"), /0.17.0/);
  assert.throws(() => assertExecutionSupported(events, undefined, undefined, { extensions: [{ plugin: { id: "math", version: "0.8.0" }, features: {} }] }), /math' plugin 0.9.0; installed 0.8.0/);
});

test("the pairs the card refuses, at the card's content, so only the picture is lost (decision 0026 §5)", () => {
  const refused = (input: TradeLessonInput, pattern: RegExp) => assert.throws(() => validateAuthoringLesson(tradeLesson(input)), (error: any) => {
    assert.match(`${error.path}: ${error.message}`, pattern);
    assert.equal(error.code, "OLL_INVALID_OPERATION_PAYLOAD");
    assert.match(error.path, /^\/steps\/0\/beats\/0\/actions\/0\/content/);
    return true;
  });
  refused({ operation: "add", a: "1234", b: "4321" }, /content\/b: .*1,234 \+ 4,321 has no column that carries: this card is for trading \(no_trade\)/);
  refused({ operation: "subtract", a: "8765", b: "4321" }, /no column that borrows: .*\(no_trade\)/);
  refused({ operation: "add", a: "389457", b: "947568" }, /needs 7 columns; the card draws at most 6.*\(too_wide\)/);
  refused({ operation: "add", a: "12345", b: "0.05" }, /\(too_wide\)/);
  refused({ operation: "subtract", a: "2476", b: "50003" }, /2,476 − 50,003 is below zero.*\(negative\)/);
  // More than two decimals cannot even be written as a lesson number of the card: a thousandths digit.
  const lesson = add({ practice: [] });
  card(lesson).content.a = 3_486_005;
  (lesson.lesson.variables as any[])[0].initial = 3_486_005;
  (lesson.lesson.variables as any[])[0].min = 3_486_005;
  (lesson.lesson.variables as any[])[0].max = 3_487_005;
  assert.throws(() => validateAuthoringLesson(lesson), /3,486.005 \+ 2,739: a number has more than two decimals \(decimals\)/);
});

test("a practice pair is the task's own: another pair of the same shape, checked at its start", () => {
  validateAuthoringLesson(add({ practice: [["3486", "2738"]] }));
  assert.throws(() => validateAuthoringLesson(add({ practice: [["3486", "2739"]] })), /The task's a and b \(a = 3486000, b = 2739000\) are the lesson's own; a practice task starts on another pair/);
  assert.throws(() => validateAuthoringLesson(add({ practice: [["1234", "4321"]] })), /practice pile is not a starting pile: .*has no column that carries/);
  assert.throws(() => validateAuthoringLesson(add({ practice: [["6500", "4700"]] })), /practice pile is not a starting pile: 6,500 \+ 4,700 needs the columns from ten thousands to ones; the card draws thousands to ones/);
  assert.throws(() => validateAuthoringLesson(add({ practice: [["465.8", "157.3"]] })), /When a = 465800.*: 465.8 has a place below the card's columns/);
  // A practice pile starts fresh: nothing demonstrated, no column worked.
  const demoed = add();
  task(demoed).start.values.finished = 2;
  assert.throws(() => validateAuthoringLesson(demoed), /practice pile is not a starting pile: .*A demonstration \(columns finished\) plays on a fresh chart|no column demonstrated/);
  const worked = add();
  task(worked).start.values[tradeVariable(0)] = 1;
  assert.throws(() => validateAuthoringLesson(worked), /practice pile is not a starting pile: .*the ones column's status is 1/);
  // Every bound field is set by the start.
  const partial = add();
  task(partial).start.variables = ["a", "b"];
  task(partial).start.values = { a: tradeValue("4658"), b: tradeValue("1573") };
  assert.throws(() => validateAuthoringLesson(partial), /sets every field the card binds; missing col_thousands, col_hundreds, col_tens, col_ones, finished/);
});

test("a complete task has no done: it allows only tapping its card", () => {
  const withDone = add();
  task(withDone).allowed_operations.push({ kind: "card_submit" });
  assert.throws(() => validateAuthoringLesson(withDone), /A complete task allows only tapping its card \(card_tap\): the tap that completes the card ends the task, with no "done"/);
  const other = add();
  task(other).allowed_operations = [{ kind: "card_tap", node: "elsewhere" }];
  assert.throws(() => validateAuthoringLesson(other), /allows only tapping its card/);
  // The chart's own facts still take "done".
  const wrongFact = add();
  task(wrongFact).completion.fact = "built";
  assert.throws(() => validateAuthoringLesson(wrongFact), /Unsupported card fact 'built'/);
});

test("the lesson shows the card by columns finished: forward, whole columns; it never taps it nor sets a column", () => {
  validateAuthoringLesson(add({ beats: [animate("ones", { finished: 1 }), animate("two", { finished: 2 }), animate("again", { finished: 2 }), animate("all", { finished: 4 })] }));
  assert.throws(() => validateAuthoringLesson(add({ beats: [animate("two", { finished: 2 }), animate("back", { finished: 1 })] })),
    /'finished' counts the columns a place_value_trade card has finished: it goes forward, not from 2 back to 1/);
  assert.throws(() => validateAuthoringLesson(add({ beats: [animate("half", { finished: 1.5 })] })), /a whole number, not 1.5/);
  assert.throws(() => validateAuthoringLesson(add({ beats: [animate("set", { [tradeVariable(0)]: 1 })] })),
    /'col_ones' is a column's state on a place_value_trade card: only the learner's taps change it; the lesson animates 'finished'/);
  assert.throws(() => validateAuthoringLesson(add({ beats: [{ key: "tap", say: "Look.", actions: [{ do: "tap", target: "sum", tap: "break", at: "ones" }] } as any] })),
    /A place_value_trade card is not tapped by the lesson: animate the variable bound to its 'finished'/);
  // A refusal says what the next value would do (decision 0026 §9).
  assert.throws(() => validateAuthoringLesson(add({ beats: [animate("two", { finished: 2 }), animate("back", { finished: 1 })] })),
    /not from 2 back to 1; the next value, 3, finishes the hundreds/);
  assert.throws(() => validateAuthoringLesson(add({ beats: [animate("half", { finished: 0.5 })] })), /not 0.5; from 0, the next value, 1, finishes the ones/);
  assert.throws(() => validateAuthoringLesson(add({ beats: [animate("all", { finished: 4 }), animate("back", { finished: 3 })] })), /every column is finished at 4/);
  const narrow = add();
  (narrow.lesson.variables as any[]).find((variable) => variable.as === "finished").max = 4;
  assert.throws(() => validateAuthoringLesson({ ...narrow, steps: [{ ...narrow.steps[0]!, beats: [...narrow.steps[0]!.beats, animate("far", { finished: 5 })] }] } as AuthoringLesson),
    /'finished' counts the columns a place_value_trade card has finished: 0 to 4, not 5/);
  // A replay restarts the demonstration: columns finished may go back, whole; every column fresh; a pair the card takes.
  const replay = (values: Record<string, number>, variables = Object.keys(values)): AuthoringLesson => add({ beats: [animate("two", { finished: 2 }),
    { key: "again", say: "Once more.", start: { kind: "replay", variables, values }, actions: [{ do: "animate", variable: "finished", value: 1 }] } as any] });
  validateAuthoringLesson(replay({ finished: 0 }));
  assert.throws(() => validateAuthoringLesson(replay({ finished: 0.5 })), /'finished' counts the columns a place_value_trade card has finished: a whole number, not 0.5/);
  assert.throws(() => validateAuthoringLesson(replay({ finished: 0, [tradeVariable(0)]: 1 })), /'col_ones' is a column's state on a place_value_trade card: a replay lays a fresh chart \(0\), not 1/);
  validateAuthoringLesson(replay({ finished: 0, a: tradeValue("4658"), b: tradeValue("1573") }));
  const replayNoTrade = add({ practice: [["4658", "1573"]] });
  (replayNoTrade.lesson.variables as any[])[0].min = tradeValue("1234");
  (replayNoTrade.lesson.variables as any[])[1].max = tradeValue("4321");
  replayNoTrade.steps[0]!.beats.push({ key: "again", say: "Another.", start: { kind: "replay", variables: ["a", "b", "finished"], values: { a: tradeValue("1234"), b: tradeValue("4321"), finished: 0 } }, actions: [{ do: "animate", variable: "finished", value: 1 }] } as any);
  assert.throws(() => validateAuthoringLesson(replayNoTrade), /The replay's card is not one this card takes: 1,234 \+ 4,321 has no column that carries/);
  // Columns finished runs to the card's columns at most.
  const long = add();
  (long.lesson.variables as any[]).find((variable) => variable.as === "finished").max = 5;
  assert.throws(() => validateAuthoringLesson(long), /finished = 5.*: The columns finished is a whole number from 0 to 4/);
  // The pair's numbers may change as a lesson number would (an animated pair passes no part of a disk); the card
  // stays drawable at every value its variables can take.
  const state: PlaceValueTradeState = placeValueTradeState({ ...card(add()).content, a: 3_486_400.5 });
  assert.equal(state.problem.a, 3_486_400);
  assert.equal(tradeValue("3,486"), 3_486_000);
});

test("a card valid as written is checked as its variables start it: a starting pair the card refuses is refused there", () => {
  const lesson = add();
  (lesson.lesson.variables as any[])[0].initial = tradeValue("1234");
  (lesson.lesson.variables as any[])[0].min = tradeValue("1234");
  (lesson.lesson.variables as any[])[1].initial = tradeValue("4321");
  (lesson.lesson.variables as any[])[1].max = tradeValue("4321");
  assert.throws(() => validateAuthoringLesson(lesson), (error: any) => {
    assert.match(error.message, /As its variables start it: 1,234 \+ 4,321 has no column that carries: this card is for trading \(no_trade\)/);
    assert.match(error.path, /^\/steps\/0\/beats\/0\/actions\/0\/content/);
    return true;
  });
});

test("the demonstration's rules cannot be bypassed (review of #116): plain bindings, beats before the card, the pair", () => {
  // Each field is bound to one variable by name.
  const expression = add();
  for (const binding of card(expression).content.bindings) if (binding.target === "finished") binding.expression = "finished + 0";
  assert.throws(() => validateAuthoringLesson(expression), /A place_value_trade card binds each field to one lesson variable by name, not 'finished \+ 0'/);
  const status = add();
  for (const binding of card(status).content.bindings) if (binding.target === "ones.status") binding.expression = "col_ones * 1";
  assert.throws(() => validateAuthoringLesson(status), /not 'col_ones \* 1'/);
  // A beat before the card is written cannot move its fields either.
  const before = (values: Record<string, number>) => { const lesson = add(); lesson.steps[0]!.beats.unshift(animate("pre", values)); return lesson; };
  assert.throws(() => validateAuthoringLesson(before({ [tradeVariable(0)]: 1 })), /'col_ones' is a column's state on a place_value_trade card/);
  assert.throws(() => validateAuthoringLesson(before({ finished: 1.5 })), /a whole number, not 1.5/);
  // The pair is not animated: it would pass through pairs the card refuses (4,000 + 1,600 carries nowhere).
  assert.throws(() => validateAuthoringLesson(add({ beats: [animate("pair", { a: tradeValue("4000"), b: tradeValue("1600") })] })),
    /'a' is a number of a place_value_trade card's problem: the lesson does not animate it; a replay or a task's start sets the pair/);
  assert.throws(() => validateAuthoringLesson(add({ beats: [animate("pair", { b: tradeValue("1573") })] })), /'b' is a number of a place_value_trade card's problem/);
});

test("a lesson that only demonstrates the card needs the player that draws it (0.17.0); a canonical card.tap on it is refused", () => {
  const events = normalizeAuthoringLesson(tradeLesson({ operation: "add", a: "3486", b: "2739", beats: [animate("two", { finished: 2 })] }), tradeHost("only"));
  const requirements = deriveExecutionRequirements(events);
  assert.equal(requirements.minimumPlayerVersion, "0.17.0");
  assert.ok(requirements.requiredCapabilities.includes("card:place_value_trade"));
  assert.throws(() => assertExecutionSupported(events, "0.16.0"), /0.17.0/);
  // A hand-written canonical tap on the card never reaches its rules.
  const board = reduceCanonicalEvents(events);
  assert.throws(() => applyCanonicalAction(board, { action_id: "x", op: "card.tap", target: { node_id: "only:node:sum" }, tap: { kind: "down", place: 3 } } as any),
    /A place_value_trade card is not tapped by a lesson: it is shown by its 'finished'/);
});

test("no field bound to the card takes a learner's slider, task or no task (review of #123)", () => {
  const variable = (lesson: AuthoringLesson, as: string) => (lesson.lesson.variables as any[]).find((candidate) => candidate.as === as);
  for (const [as, field] of [["a", "a"], ["b", "b"], ["finished", "finished"], [tradeVariable(0), "places.0.status"]] as const) {
    const lesson = add({ practice: [] });
    variable(lesson, as).control = { kind: "slider", step: 1 };
    assert.throws(() => validateAuthoringLesson(lesson), new RegExp(`Variable '${as}' is bound to a place_value_trade card's '[^']+': the card changes it, so it cannot have its own control`), field);
  }
  const other = add({ practice: [] });
  (other.lesson.variables as any[]).push({ as: "other", label: "other", initial: 0, min: 0, max: 5, control: { kind: "slider", step: 1 } });
  assert.doesNotThrow(() => validateAuthoringLesson(other));
});
