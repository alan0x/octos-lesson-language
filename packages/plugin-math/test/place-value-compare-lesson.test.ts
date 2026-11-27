// The place-value compare card inside a lesson (decision 0029): the card-kind registry entry, core validation of
// its tasks (a practice on its own pair, starting fresh), the card-level bindings, the demonstration ("compared"
// forward from 0 to the sign, a card that opens fresh as the lesson has played), the reducer and execution
// requirements.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCanonicalAction, assertAuthoringSchema, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson, reduceCanonicalEvents,
  setLessonVariables, validateAuthoringLesson, OLL_PLAYER_EXECUTION_VERSION, type AuthoringLesson,
} from "../../core/src/index.js";
import { PLACE_VALUE_COMPARE_CARD, PLACE_VALUE_COMPARE_DEMONSTRATION, tapCardKind } from "../../core/src/cards.js";
import { MATH_BUILDERS, MATH_PLUGIN_MANIFEST, cardHowTo } from "../src/index.js";
import { buildPlaceValueCompare } from "../src/place-value-compare-builder.js";
import {
  PLACE_VALUE_COMPARE_FEATURE, PLACE_VALUE_COMPARE_KIND, PLACE_VALUE_COMPARE_PLUGIN_VERSION, PLACE_VALUE_COMPARE_TAP_PLACES, placeValueCompareHowTo,
} from "../src/place-value-compare.js";
import { compareHost, compareLesson, compareStart, type CompareLessonInput } from "./place-value-compare-fixtures.js";

const whole = (extra: Partial<CompareLessonInput> = {}) => compareLesson({ a: "4530", b: "4503", practice: [["6281", "6218"]], ...extra });
const decimal = (extra: Partial<CompareLessonInput> = {}) => compareLesson({ a: "0.625", b: "0.7", practice: [["0.48", "0.5"]], ...extra });
const equal = (extra: Partial<CompareLessonInput> = {}) => compareLesson({ language: "zh-CN", a: "0.7", b: "0.70", practice: [["2.50", "2.5"]], decimals: true, ...extra });
const task = (lesson: AuthoringLesson, index = 0) => (lesson.lesson.tasks as any[])[index];
const card = (lesson: AuthoringLesson) => (lesson.steps[0]!.beats[0]!.actions[0] as any);
const variable = (lesson: AuthoringLesson, as: string) => (lesson.lesson.variables as any[]).find((candidate) => candidate.as === as);
const animate = (key: string, values: Record<string, number>) => ({ key, say: "Look.", actions: Object.entries(values).map(([name, value]) => ({ do: "animate", variable: name, value })) });

test("the registry entry: judgements and signs by place index, every field card-level and bound by bare name", () => {
  const kind = PLACE_VALUE_COMPARE_CARD;
  assert.equal(tapCardKind(PLACE_VALUE_COMPARE_KIND), kind);
  assert.deepEqual(kind.taps, ["same", "different", "sign", "column"]);
  assert.deepEqual(kind.places, PLACE_VALUE_COMPARE_TAP_PLACES);
  assert.deepEqual([kind.cardFields, kind.practiceFields, kind.demonstration?.field, kind.fieldsAtOnce], [["a", "b", "a_decimals", "b_decimals", "compared"], ["a", "b"], "compared", true]);
  const content = card(whole()).content;
  // One range for every pair, so a practice on a wider pair binds the same variables.
  assert.deepEqual(kind.tapFields(content).map(({ field, min, max }) => `${field} ${min}..${max}`), ["marked 0..7", "signed 0..1"]);
  assert.equal(kind.fieldTarget(content, 0, "signed"), "signed");
  // The demonstration: "compared" from 0, forward a whole number at a time, never past the sign.
  const demo = kind.demonstration!;
  assert.equal(demo, PLACE_VALUE_COMPARE_DEMONSTRATION);
  assert.deepEqual([demo.start(content), demo.opensAtStart], [0, true]);
  assert.equal(demo.refuseStep(content, 0, 4), undefined, "straight to the sign: the program plays each column between");
  assert.equal(demo.refuseStep(content, 2, 2), undefined, "the same value again");
  assert.equal(demo.refuseStep(content, 3, 1), "counts the columns a place_value_compare card's demonstration has judged from the left, then one more for the sign: it goes forward, not from 3 back to 1; the next value, 4, chooses the sign");
  assert.equal(demo.refuseStep(content, 1, 5), "counts the columns a place_value_compare card's demonstration has judged from the left, then one more for the sign: 0 to 4 on this pair, not 5; the next value, 2, judges the hundreds");
  assert.equal(demo.refuseStep(content, 0, 1.5), "counts the columns a place_value_compare card's demonstration has judged from the left, then one more for the sign: a whole number, not 1.5; from 0, the next value, 1, judges the thousands");
  // The player's steps (0026 revision 2): one per column judged, then the sign.
  assert.deepEqual(demo.stepValues(content, 0, 4), [1, 2, 3, 4]);
  assert.deepEqual(demo.stepValues(content, 2, 3), [3]);
  assert.deepEqual(demo.stepValues(content, 3, 3), []);
  assert.equal(demo.refuseReplay(content, 3), undefined);
  assert.match(demo.refuseReplay(content, 6)!, /0 to 4 on this pair, not 6$/);
  // A tap names a place index; a judgement changes `marked`, the true sign `signed`.
  let state = kind.state(content);
  for (const tap of [{ kind: "same", place: 6 }, { kind: "same", place: 5 }, { kind: "different", place: 4 }]) {
    const result = kind.apply(state, tap);
    assert.ok(result.ok, JSON.stringify(tap));
    assert.deepEqual(kind.changes(state, result.state), [{ place: 0, field: "marked", before: state.marked, after: state.marked + 1 }]);
    state = result.state;
  }
  assert.deepEqual(kind.apply(state, { kind: "sign", place: 12 }), { ok: false, reason: "not_true" });
  assert.equal(kind.refusalText("not_true", 12, "en-US", state), "“4,530 < 4,503” is not true.");
  const signed = kind.apply(state, { kind: "sign", place: 10 });
  assert.ok(signed.ok);
  assert.deepEqual(kind.changes(state, signed.state), [{ place: 0, field: "signed", before: 0, after: 1 }]);
  // Refusals are facts, with the column's digits when the card as tapped is given.
  const fresh = kind.state(content);
  assert.deepEqual(kind.apply(fresh, { kind: "same", place: 3 }), { ok: false, reason: "left_unjudged" });
  assert.equal(kind.refusalText("left_unjudged", 3, "en-US", fresh), "Ones: 0 and 3. The thousands haven't been compared yet.");
  assert.equal(kind.refusalText("not_different", 6, "zh-CN", fresh), "千位：4 和 4。");
  assert.equal(kind.refusalText("not_decided", 11, "en-US", fresh), "Opens when a place differs, or every place is the same.");
  assert.equal(kind.refusalText("left_unjudged", 3), "That can't be done here.", "without the card, no digits are made up");
  const shown = kind.state({ ...content, compared: 2 });
  assert.deepEqual(kind.apply(shown, { kind: "same", place: 4 }), { ok: false, reason: "demonstrating" });
  assert.equal(kind.refusalText("demonstrating", 4), "This chart shows the demonstration.");
  // The content at a pile: every field by its bare binding target.
  const pile = kind.contentAt({ ...content, bindings: [] }, (target) => ({ a: 625, b: 700, compared: 0, marked: 2, signed: 1 } as Record<string, number>)[target]);
  assert.equal(pile.bindings, undefined);
  assert.deepEqual([pile.a, pile.b, pile.marked, pile.signed], [625, 700, 2, 1]);
  // A practice chart starts fresh.
  const throwsStart = (s: unknown) => () => kind.validateStart!(s as any, (message) => { throw new Error(message); });
  assert.throws(throwsStart(shown), /nothing demonstrated: compared is 2, not 0/);
  assert.throws(throwsStart(state), /marked is 3, not 0/);
  assert.throws(throwsStart(kind.state({ a: 4530000, b: 4530000, compared: 0, marked: 0, signed: 0 })), /same_numeral/);
  assert.doesNotThrow(throwsStart(fresh));
  assert.equal(cardHowTo(PLACE_VALUE_COMPARE_KIND, content), placeValueCompareHowTo(content));
  assert.equal(MATH_BUILDERS.place_value_compare, buildPlaceValueCompare);
  assert.equal(MATH_PLUGIN_MANIFEST.version, PLACE_VALUE_COMPARE_PLUGIN_VERSION);
});

test("the complete fact: judged on each tap; done, the task's own pair compared to its deciding place and signed", () => {
  const fact = PLACE_VALUE_COMPARE_CARD.facts.complete!;
  assert.equal(fact.judgedOnTap, true);
  assert.deepEqual(Object.keys(PLACE_VALUE_COMPARE_CARD.facts), ["complete"]);
  const content = card(whole()).content;
  assert.deepEqual(fact.read({ fact: "complete" }, PLACE_VALUE_COMPARE_CARD.state({ ...content, marked: 3 })), { actual: 0, target: 1, succeeded: false }, "decided is not complete");
  assert.deepEqual(fact.read({ fact: "complete" }, PLACE_VALUE_COMPARE_CARD.state({ ...content, marked: 3, signed: 1 })), { actual: 1, target: 1, succeeded: true });
  // The demonstration's chart is the program's (review of #128): at its end, the sign shown, the learner's card is not complete.
  for (const compared of [1, 3, 4]) assert.deepEqual(fact.read({ fact: "complete" }, PLACE_VALUE_COMPARE_CARD.state({ ...content, compared })), { actual: 0, target: 1, succeeded: false }, `compared ${compared}`);
  const start = compareStart("6281", "6218").values;
  // 6,281 and 6,218: thousands, hundreds the same, the tens decide: three columns judged.
  assert.deepEqual(fact.donePile({ content, completion: { fact: "complete" }, startValue: (alias) => (alias === undefined ? 0 : start[alias] ?? 0) }),
    { a: 6281000, b: 6218000, compared: 0, marked: 3, signed: 1 });
  const eqContent = card(equal()).content;
  const eqStart = compareStart("2.50", "2.5", true).values;
  assert.deepEqual(fact.donePile({ content: eqContent, completion: { fact: "complete" }, startValue: (alias) => (alias === undefined ? 0 : eqStart[alias] ?? 0) }),
    { a: 2500, b: 2500, a_decimals: 2, b_decimals: 1, compared: 0, marked: 3, signed: 1 }, "an equal pair: every column the same");
});

test("a lesson with the card: schema, validation, normalization, execution requirements (player 0.20.0, math 0.12.0)", () => {
  for (const lesson of [whole(), decimal(), equal(), whole({ language: "zh-CN" })]) {
    assertAuthoringSchema(lesson);
    validateAuthoringLesson(lesson);
    const events = normalizeAuthoringLesson(lesson, compareHost(`l${task(lesson).start.values.a}`));
    const requirements = deriveExecutionRequirements(events);
    for (const feature of [PLACE_VALUE_COMPARE_FEATURE, "card:place_value_compare", "student-tasks:card_fact:complete", "value-bindings:card-field"]) {
      assert.ok(requirements.requiredCapabilities.includes(feature), `${feature} required`);
    }
    assert.ok(!requirements.requiredCapabilities.includes("node:place_value_compare"));
    assert.equal(requirements.minimumPlayerVersion, "0.20.0");
    assert.deepEqual(requirements.requiredPlugins, { math: "0.12.0" });
    assert.doesNotThrow(() => assertExecutionSupported(events));
    assert.throws(() => assertExecutionSupported(events, "0.19.0"), /0.20.0/);
    // The reducer evaluates the bare bindings: a practice start puts the task's own pair on the card.
    const board = reduceCanonicalEvents(events);
    const node = Object.values(board.nodes).find((candidate: any) => candidate.kind === PLACE_VALUE_COMPARE_KIND) as any;
    assert.deepEqual([node.content.compared, node.content.marked, node.content.signed], [0, 0, 0]);
    const practice = setLessonVariables(board, task(lesson).start.values);
    assert.equal(practice.nodes[node.id]!.content.a, task(lesson).start.values.a);
  }
  assert.equal(OLL_PLAYER_EXECUTION_VERSION, "0.20.0");
  // A lesson of fewer than 16 variables: 5, or 7 with the written decimals bound.
  assert.deepEqual([whole().lesson.variables!.length, equal().lesson.variables!.length], [5, 7]);
});

test("the pairs the card refuses, at the card's content, so only the picture is lost", () => {
  const refused = (lesson: AuthoringLesson, pattern: RegExp) => assert.throws(() => validateAuthoringLesson(lesson), (error: any) => {
    assert.match(`${error.path}: ${error.message}`, pattern);
    assert.equal(error.code, "OLL_INVALID_OPERATION_PAYLOAD");
    assert.match(error.path, /^\/steps\/0\/beats\/0\/actions\/0\/content/);
    return true;
  });
  const same = whole({ practice: [] });
  card(same).content.b = 4530000;
  variable(same, "b").initial = 4530000;
  refused(same, /content\/b: 4,530 and 4,530: the same numeral twice; there is nothing to compare/);
  const wide = whole({ practice: [] });
  card(wide).content.b = 500;
  card(wide).content.a = 1234567000;
  variable(wide, "a").initial = 1234567000; variable(wide, "a").max = 1234567000;
  variable(wide, "b").initial = 500; variable(wide, "b").min = 500;
  refused(wide, /\(too_wide\)/);
  // A card that opens with columns judged, a sign chosen or a demonstration shown (as written, as its variables start it).
  for (const [field, value, message] of [["marked", 1, "A card opens fresh: nothing judged, not 1"], ["compared", 2, "A card opens fresh: nothing compared, not 2"]] as const) {
    const opened = whole();
    card(opened).content[field] = value;
    variable(opened, field).initial = value;
    assert.throws(() => validateAuthoringLesson(opened), (error: any) => { assert.equal(`${error.path}: ${error.message}`, `/steps/0/beats/0/actions/0/content/${field}: ${message}`); return true; });
    const byVariable = whole();
    variable(byVariable, field).initial = value;
    assert.throws(() => validateAuthoringLesson(byVariable), new RegExp(`As its variables start it: ${message}`));
  }
  // Nor as the lesson has played when the card is written (review of #122): a beat before it, a replay, or an
  // earlier card on the same variables may not have moved its demonstration.
  const played = (lesson: AuthoringLesson, value: number) => assert.throws(() => validateAuthoringLesson(lesson), (error: any) => {
    assert.equal(error.message, `As the lesson has played when the card is written: A card opens fresh: nothing compared, not ${value}`);
    assert.equal(error.code, "OLL_INVALID_OPERATION_PAYLOAD");
    return true;
  });
  const before = whole();
  before.steps[0]!.beats.unshift(animate("pre", { compared: 2 }) as any);
  played(before, 2);
  const samePhase = whole();
  (samePhase.steps[0]!.beats[0]!.actions as any[]).unshift({ do: "animate", variable: "compared", value: 3, when: "before_speech" });
  played(samePhase, 3);
  const replayed = whole();
  replayed.steps[0]!.beats.unshift({ key: "pre", say: "Look.", start: { kind: "replay", variables: ["compared"], values: { compared: 1 } }, actions: [{ do: "write", as: "note", kind: "text", role: "note", content: { text: "4,530" }, place: { relation: "new_region" } }] } as any);
  played(replayed, 1);
  const second = whole();
  const again = structuredClone(card(second));
  again.as = "chart-2";
  second.steps[0]!.beats.push(animate("all", { compared: 4 }) as any, { key: "again", say: "Another card.", actions: [again] } as any);
  played(second, 4);
});

test("a practice pair is the task's own, starting fresh: nothing compared, judged or signed", () => {
  validateAuthoringLesson(whole({ practice: [["607198", "607912"]] }));
  assert.throws(() => validateAuthoringLesson(whole({ practice: [["4530", "4503"]] })), /The task's a and b \(a = 4530000, b = 4503000\) are the lesson's own; a practice task starts on another pair/);
  const twice = whole();
  task(twice).start.values.b = task(twice).start.values.a;
  assert.throws(() => validateAuthoringLesson(twice), /practice pile is not a starting pile: .*6,281 and 6,281: the same numeral twice/);
  for (const [field, pattern] of [["marked", /practice pile is not a starting pile: A card opens fresh: nothing judged, not 1/], ["signed", /practice pile is not a starting pile: The sign is chosen only once the comparing is done/], ["compared", /practice pile is not a starting pile: A card opens fresh: nothing compared, not 1/]] as const) {
    const worked = whole();
    task(worked).start.values[field] = 1;
    assert.throws(() => validateAuthoringLesson(worked), pattern);
  }
  const partial = whole();
  task(partial).start.variables = ["a", "b"];
  task(partial).start.values = { a: 6281000, b: 6218000 };
  assert.throws(() => validateAuthoringLesson(partial), /sets every field the card binds; missing marked, signed, compared/);
  // The judged count runs 0..7, the most columns: one range fits every pair.
  const narrow = whole();
  variable(narrow, "marked").max = 4;
  assert.throws(() => validateAuthoringLesson(narrow), /Variable 'marked' \(marked\) must run from 0 to 7/);
  // A practice with another pair's written decimals binds them: 2.50 and 2.5 after 0.7 and 0.70.
  validateAuthoringLesson(equal());
});

test("a complete task has no done: it allows only tapping its card", () => {
  const withDone = whole();
  task(withDone).allowed_operations.push({ kind: "card_submit" });
  assert.throws(() => validateAuthoringLesson(withDone), /A complete task allows only tapping its card \(card_tap\)/);
  const wrongFact = whole();
  task(wrongFact).completion.fact = "decided";
  assert.throws(() => validateAuthoringLesson(wrongFact), /Unsupported card fact 'decided'/);
});

test("the lesson shows the card by compared: forward, whole, never past the sign; it never taps it nor judges for the learner", () => {
  validateAuthoringLesson(whole({ beats: [animate("two", { compared: 2 }), animate("again", { compared: 2 }), animate("all", { compared: 4 })] as any }));
  validateAuthoringLesson(whole({ beats: [animate("partial", { compared: 3 })] as any })); // a lesson may stop partway (no "must finish")
  assert.throws(() => validateAuthoringLesson(whole({ beats: [animate("all", { compared: 4 }), animate("back", { compared: 2 })] as any })),
    /'compared' counts the columns a place_value_compare card's demonstration has judged from the left, then one more for the sign: it goes forward, not from 4 back to 2; the sign is chosen at 4, the last value/);
  assert.throws(() => validateAuthoringLesson(whole({ beats: [animate("past", { compared: 5 })] as any })), /'compared' counts .*: 0 to 4 on this pair, not 5$/);
  for (const field of ["marked", "signed"]) {
    assert.throws(() => validateAuthoringLesson(whole({ beats: [animate("learner", { [field]: 1 })] as any })),
      new RegExp(`'${field}' is the learner's judgements or sign on a place_value_compare card: only the learner's taps change it; the lesson animates 'compared'`));
  }
  assert.throws(() => validateAuthoringLesson(whole({ beats: [animate("pair", { a: 5000000 })] as any })), /'a' is a number of a place_value_compare card's problem: the lesson does not animate it/);
  assert.throws(() => validateAuthoringLesson(whole({ beats: [{ key: "tap", say: "Look.", actions: [{ do: "tap", target: "chart", tap: "same", at: "thousands" }] } as any] })),
    /A place_value_compare card is not tapped by the lesson: animate the variable bound to its 'compared'/);
  // Outside the variable's range: the card says its own range.
  const far = whole();
  assert.throws(() => validateAuthoringLesson({ ...far, steps: [{ ...far.steps[0]!, beats: [...far.steps[0]!.beats, animate("far", { compared: 9 })] }] } as AuthoringLesson),
    /'compared' counts the columns .*: 0 to 4 on this pair, not 9/);
  // A replay restarts the demonstration: any value up to the sign, the learner's fields 0.
  const replay = (values: Record<string, number>): AuthoringLesson => whole({ beats: [animate("all", { compared: 4 }),
    { key: "again", say: "Once more.", start: { kind: "replay", variables: Object.keys(values), values }, actions: [{ do: "animate", variable: "compared", value: 4 }] }] as any });
  validateAuthoringLesson(replay({ compared: 0 }));
  validateAuthoringLesson(replay({ compared: 2 }));
  assert.throws(() => validateAuthoringLesson(replay({ compared: 0, marked: 1 })), /'marked' is the learner's judgements or sign on a place_value_compare card: a replay lays a fresh chart \(0\), not 1/);
  // Past the sign, within the variable's range (a wider practice pair may need it), the card says its own range.
  const wide = replay({ compared: 5 });
  variable(wide, "compared").max = 8;
  assert.throws(() => validateAuthoringLesson(wide), /'compared' counts .*: 0 to 4 on this pair, not 5/);
  // A replay on another pair: its own demonstration (6,281 and 6,218 also end at 4).
  validateAuthoringLesson(replay({ a: 6281000, b: 6218000, compared: 0 }));
});

test("the demonstration's rules cannot be bypassed: plain bindings; a demonstration-only lesson needs player 0.20.0", () => {
  const expression = whole();
  for (const binding of card(expression).content.bindings) if (binding.target === "compared") binding.expression = "compared + 0";
  assert.throws(() => validateAuthoringLesson(expression), /A place_value_compare card binds each field to one lesson variable by name, not 'compared \+ 0'/);
  const events = normalizeAuthoringLesson(compareLesson({ a: "0.625", b: "0.7", beats: [animate("all", { compared: 3 })] as any }), compareHost("only"));
  const requirements = deriveExecutionRequirements(events);
  assert.equal(requirements.minimumPlayerVersion, "0.20.0");
  assert.ok(requirements.requiredCapabilities.includes("card:place_value_compare"));
  assert.throws(() => assertExecutionSupported(events, "0.19.0"), /0.20.0/);
  const board = reduceCanonicalEvents(events);
  assert.throws(() => applyCanonicalAction(board, { action_id: "x", op: "card.tap", target: { node_id: "only:node:chart" }, tap: { kind: "same", place: 3 } } as any),
    /A place_value_compare card is not tapped by a lesson: it is shown by its 'compared'/);
});

test("no field bound to the card takes a learner's slider, task or no task", () => {
  for (const as of ["a", "b", "compared", "marked", "signed"]) {
    const lesson = whole({ practice: [] });
    variable(lesson, as).control = { kind: "slider", step: 1 };
    assert.throws(() => validateAuthoringLesson(lesson), new RegExp(`Variable '${as}' is bound to a place_value_compare card's '${as}': the card changes it, so it cannot have its own control`));
  }
});
