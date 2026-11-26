// The place-value chart inside a lesson (decision 0025): the card-kind registry entry, core validation of its
// tasks and demonstrations, the card-level number binding, the reducer, and execution requirements.
// Numbers here are invented for the checks.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthoringSchema, assertExecutionSupported, deriveExecutionRequirements, normalizeAuthoringLesson, reduceCanonicalEvents,
  setLessonVariables, validateAuthoringLesson, OLL_PLAYER_EXECUTION_VERSION, type AuthoringLesson,
} from "../../core/src/index.js";
import { PLACE_VALUE_CHART_CARD, tapCardKind } from "../../core/src/cards.js";
import { MATH_PLUGIN_MANIFEST, cardHowTo } from "../src/index.js";
import { PLACE_VALUE_CHART_FEATURE, PLACE_VALUE_CHART_KIND, PLACE_VALUE_TAP_PLACES, placeValueHowTo, placeValueTapIndex } from "../src/place-value-chart.js";
import { chartHost, chartLesson, chartStart, chartVariable } from "./place-value-chart-fixtures.js";

const build = (extra: Partial<Parameters<typeof chartLesson>[0]> = {}) => chartLesson({ mode: "build", given: "name", target: 4_050_000, practice: [3_012_000], ...extra });
const apart = (extra: Partial<Parameters<typeof chartLesson>[0]> = {}) => chartLesson({ mode: "apart", given: "numeral", target: 347_392, practice: [256_418], ...extra });
const task = (lesson: AuthoringLesson, index = 0) => (lesson.lesson.tasks as any[])[index];
const animate = (key: string, values: Record<string, number>): any => ({ key, say: "Look.", actions: Object.entries(values).map(([variable, value]) => ({ do: "animate", variable, value })) });
const tap = (key: string, kind: string, at: string): any => ({ key, say: "Look.", actions: [{ do: "tap", target: "chart", tap: kind, at }] });

test("the chart's registry entry: taps by a place's index, fields by place number, the number a card-level field", () => {
  const card = PLACE_VALUE_CHART_CARD;
  assert.equal(tapCardKind(PLACE_VALUE_CHART_KIND), card);
  assert.deepEqual(card.taps, ["add", "remove", "take_out"]);
  assert.deepEqual(card.places, PLACE_VALUE_TAP_PLACES);
  assert.equal(card.places[placeValueTapIndex(0)], "ones");
  assert.equal(card.places[placeValueTapIndex(-1)], "tenths");
  assert.equal(card.places[placeValueTapIndex(5)], "hundred-thousands");
  assert.deepEqual(card.cardFields, ["target"]);
  const content = { mode: "apart", given: "numeral", top_place: 2, decimals: false, target: 307_000,
    places: [{ as: "hundreds", place: 2, count: 3, pulled: 0 }, { as: "tens", place: 1, count: 0, pulled: 0 }, { as: "ones", place: 0, count: 7, pulled: 0 }] };
  assert.deepEqual(card.tapFields(content).map(({ place, field }) => `${card.places[place]}.${field}`),
    ["hundreds.count", "hundreds.pulled", "tens.count", "tens.pulled", "ones.count", "ones.pulled"]);
  // Fields are found by place number, also on the board where a place's `as` became its `id`.
  assert.equal(card.fieldTarget(content, placeValueTapIndex(0), "pulled"), "ones.pulled");
  const onBoard = { ...content, places: content.places.map(({ as, ...rest }) => ({ ...rest, id: `l:node:chart:fragment:${as}` })) };
  assert.equal(card.fieldTarget(onBoard, placeValueTapIndex(2), "count"), "l:node:chart:fragment:hundreds.count");
  // Taking out the hundreds moves its three disks into its part; the zero tens has nothing to take.
  const state = card.state(content);
  const result = card.apply(state, { kind: "take_out", place: placeValueTapIndex(2) });
  assert.ok(result.ok);
  assert.deepEqual(card.changes(state, result.state), [{ place: placeValueTapIndex(2), field: "count", before: 3, after: 0 }, { place: placeValueTapIndex(2), field: "pulled", before: 0, after: 3 }]);
  assert.deepEqual(card.apply(state, { kind: "take_out", place: placeValueTapIndex(1) }), { ok: false, reason: "empty" });
  assert.deepEqual(card.apply(state, { kind: "add", place: placeValueTapIndex(0) }), { ok: false, reason: "wrong_mode" });
  assert.equal(card.refusalText("empty", 0, "zh-CN"), "这一位没有圆片。");
  // The content at a pile: tap fields and the number, by binding target.
  const at = card.contentAt({ ...content, bindings: [] }, (target) => ({ "ones.count": 0, "ones.pulled": 7, target: 108_000 } as Record<string, number>)[target]);
  assert.equal(at.bindings, undefined);
  assert.equal(at.target, 108_000);
  assert.deepEqual((at.places as any[])[2], { as: "ones", place: 0, count: 0, pulled: 7 });
  // How it is worked is the card's own text, by its kind.
  assert.equal(cardHowTo(PLACE_VALUE_CHART_KIND, content), placeValueHowTo(content));
});

test("a chart lesson with a practice task on its own number: validated, normalized, and the number bound bare", () => {
  const lesson = build();
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);
  const content = (lesson.steps[0]!.beats[0]!.actions[0] as any).content;
  assert.deepEqual(content.bindings[0], { target: "target", expression: "number" });
  const events = normalizeAuthoringLesson(lesson, chartHost("pv"));
  const node = (events[1] as any).step.beats[0].stage.during_speech[0].node;
  // A card-level binding keeps its bare name; a place's is canonical.
  assert.deepEqual(node.content.bindings.slice(0, 2).map((binding: any) => binding.target), ["target", "pv:node:chart:fragment:hundred-thousands.count"]);
  const board = reduceCanonicalEvents(events);
  assert.equal(board.nodes["pv:node:chart"]!.content.target, 4_050_000);
  // The practice start sets the number (and empties the chart): the reducer evaluates the bare binding.
  const practice = setLessonVariables(board, chartStart({ mode: "build", target: 4_050_000, practice: [3_012_000] }, 3_012_000).values);
  assert.equal(practice.nodes["pv:node:chart"]!.content.target, 3_012_000);
});

test("a chart lesson requires the chart's feature, its facts and the card-level binding: player 0.16.0, math 0.8.0", () => {
  assert.equal(MATH_PLUGIN_MANIFEST.version, "0.8.0");
  assert.equal(OLL_PLAYER_EXECUTION_VERSION, "0.16.0");
  const requirements = deriveExecutionRequirements(normalizeAuthoringLesson(build(), chartHost("pv")));
  for (const feature of [PLACE_VALUE_CHART_FEATURE, "student-tasks:card_fact:built", "value-bindings:card-field"]) assert.ok(requirements.requiredCapabilities.includes(feature), feature);
  assert.ok(!requirements.requiredCapabilities.includes("node:place_value_chart"));
  assert.equal(requirements.minimumPlayerVersion, "0.16.0");
  assert.deepEqual(requirements.requiredPlugins, { math: "0.8.0" });
  assert.ok(deriveExecutionRequirements(normalizeAuthoringLesson(apart(), chartHost("pv"))).requiredCapabilities.includes("student-tasks:card_fact:pulled_all"));
  // A chart that only shows a number, nothing bound, needs the plugin only.
  const shown = deriveExecutionRequirements(normalizeAuthoringLesson(chartLesson({ mode: "build", given: "name", target: 4_050_000, fixedNumber: true }), chartHost("pv")));
  assert.deepEqual(shown.requiredPlugins, { math: "0.8.0" });
  assert.ok(!shown.requiredCapabilities.includes("value-bindings:card-field"));
  // An older player, or an older math plugin, refuses the lesson before playback.
  const events = normalizeAuthoringLesson(build(), chartHost("pv"));
  assert.doesNotThrow(() => assertExecutionSupported(events));
  assert.throws(() => assertExecutionSupported(events, "0.15.0"), /0\.16\.0/);
  assert.throws(() => assertExecutionSupported(events, undefined, undefined, { extensions: [{ plugin: { id: "math", version: "0.7.0" }, features: {} }] }), /math' plugin 0.8.0; installed 0.7.0/);
});

test("a bare binding target is the chart's number only", () => {
  const other = build();
  (other.steps[0]!.beats[0]!.actions[0] as any).content.bindings.push({ target: "mode", expression: "number" });
  assert.throws(() => validateAuthoringLesson(other), /'mode' is not a field of a place_value_chart card/);
  const mat = {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Mat", goals: ["Trade"], variables: [{ as: "n", label: "n", initial: 3, min: 0, max: 9 }] },
    steps: [{ key: "s", purpose: "See", beats: [{ key: "b", say: "A mat.", actions: [{ do: "write", as: "mat", kind: "base_ten_trade", role: "main_visual", place: { relation: "new_region" },
      content: { columns: 2, places: [{ as: "ones", count: 3 }, { as: "tens", count: 1 }], bindings: [{ target: "target", expression: "n" }] } }] }] }],
    close: { summary: "Done.", focus: ["mat"] },
  } as unknown as AuthoringLesson;
  assert.throws(() => validateAuthoringLesson(mat), /'target' is not a field of a base_ten_trade card/);
});

test("a practice task starts on its own number, on a starting chart its columns cover", () => {
  const lesson = build();
  // The number bound and set by the start; never the lesson's own.
  const unbound = chartLesson({ mode: "build", given: "name", target: 4_050_000, practice: [3_012_000], fixedNumber: true });
  task(unbound).start.variables = task(unbound).start.variables.filter((alias: string) => alias !== "number");
  delete task(unbound).start.values.number;
  assert.throws(() => validateAuthoringLesson(unbound), /starts on its own target: bind the card's 'target'/);
  const missing = structuredClone(lesson);
  task(missing).start.variables = task(missing).start.variables.filter((alias: string) => alias !== "number");
  delete task(missing).start.values.number;
  assert.throws(() => validateAuthoringLesson(missing), /practice pile sets every field the card binds; missing number/);
  const same = structuredClone(lesson);
  task(same).start.values.number = 4_050_000;
  assert.throws(() => validateAuthoringLesson(same), /is the lesson's own; a practice task starts on another/);
  // A chart to build starts empty.
  const begun = structuredClone(lesson);
  task(begun).start.values[chartVariable("count", 3)] = 2;
  assert.throws(() => validateAuthoringLesson(begun), /A chart to build starts empty/);
  // A chart to pull apart starts whole, nothing pulled out.
  const pulled = apart();
  task(pulled).start.values[chartVariable("pulled", 2)] = 2;
  task(pulled).start.values[chartVariable("count", 2)] = 0;
  assert.throws(() => validateAuthoringLesson(pulled), /starts whole, nothing pulled out/);
  const short = apart();
  task(short).start.values[chartVariable("count", 2)] = 1;
  assert.throws(() => validateAuthoringLesson(short), /practice pile is not a starting pile: .*not the target's digit/);
  // The columns cover the task's number: a chart of hundreds cannot show 4,050.
  const wide = chartLesson({ mode: "build", given: "name", target: 347_000, practice: [256_000] });
  (wide.lesson.variables as any[])[0].max = 4_050_000;
  task(wide).start.values.number = 4_050_000;
  assert.throws(() => validateAuthoringLesson(wide), /has a place above the chart's columns/);
  // The fact is the task's own: a pull-apart chart is never "built".
  const wrongFact = apart();
  task(wrongFact).completion.fact = "built";
  assert.throws(() => validateAuthoringLesson(wrongFact), /'built' is read on a chart whose mode is 'build'/);
});

test("a number that shows its own answer is refused at the chart's start and at every task's start (review of #111)", () => {
  // Given as an expanded form, 4,000 is its own answer: refused as the task's number.
  const lesson = chartLesson({ mode: "build", given: "expanded", target: 4_050_000, practice: [3_012_000] });
  validateAuthoringLesson(lesson);
  task(lesson).start.values.number = 4_000_000;
  assert.throws(() => validateAuthoringLesson(lesson), /4,000 has one non-zero place/);
  // "1 × 1,000" too.
  const factors = chartLesson({ mode: "build", given: "expanded_factors", target: 4_050_000, practice: [3_012_000] });
  (factors.lesson.variables as any[])[0].min = 1_000_000;
  task(factors).start.values.number = 1_000_000;
  assert.throws(() => validateAuthoringLesson(factors), /1,000 has one non-zero place/);
  // A pulled-apart 0.05 has one part.
  const numeral = chartLesson({ mode: "apart", given: "numeral", target: 347_392, practice: [50] });
  assert.throws(() => validateAuthoringLesson(numeral), /practice pile is not a starting pile: .*0\.05 has one non-zero place/);
  // The chart as its variables start it, not as written: the written number is fine, the variable's start is not.
  const written = chartLesson({ mode: "build", given: "expanded", target: 4_050_000, practice: [3_012_000] });
  (written.lesson.variables as any[])[0].initial = 3_000_000;
  (written.lesson.variables as any[])[0].min = 3_000_000;
  assert.throws(() => validateAuthoringLesson(written), /As its variables start it: .*3,000 has one non-zero place/);
});

test("a chart to build that already holds its number is refused, as written and as its variables start it", () => {
  const built = chartLesson({ mode: "build", given: "name", target: 4_050_000, practice: [3_012_000] });
  for (const variable of built.lesson.variables as any[]) {
    if (variable.as === chartVariable("count", 3)) variable.initial = 4;
    if (variable.as === chartVariable("count", 1)) variable.initial = 5;
  }
  assert.throws(() => validateAuthoringLesson(built), /As its variables start it: The chart already holds 4,050/);
  const written = build();
  const content = (written.steps[0]!.beats[0]!.actions[0] as any).content;
  content.places.find((item: any) => item.place === 3).count = 4;
  content.places.find((item: any) => item.place === 1).count = 5;
  assert.throws(() => validateAuthoringLesson(written), /The chart already holds 4,050/);
});

test("a demonstration animates the counts and takes places out, each tap checked by the card's rules", () => {
  // Building 4,050 by animating each place's count from 0 to its digit.
  const shown = build({ beats: [animate("thousands", { [chartVariable("count", 3)]: 4 }), animate("tens", { [chartVariable("count", 1)]: 5 })] });
  validateAuthoringLesson(shown);
  const board = reduceCanonicalEvents(normalizeAuthoringLesson(shown, chartHost("pv")));
  const counts = (board.nodes["pv:node:chart"]!.content.places as any[]).map((item) => item.count);
  assert.deepEqual(counts, [0, 0, 4, 0, 5, 0]);
  // Pulling 347.392 apart by taps; the reducer replays each by the card's rules.
  const pulled = apart({ beats: [tap("hundreds", "take_out", "hundreds"), tap("tenths", "take_out", "tenths")] });
  validateAuthoringLesson(pulled);
  const events = normalizeAuthoringLesson(pulled, chartHost("pv"));
  const action = (events[1] as any).step.beats[1].stage.during_speech[0];
  assert.deepEqual(action.tap, { kind: "take_out", place: placeValueTapIndex(2) });
  const after = reduceCanonicalEvents(events);
  const places = after.nodes["pv:node:chart"]!.content.places as any[];
  assert.deepEqual(places.map((item) => [item.place, item.count, item.pulled]), [[2, 0, 3], [1, 4, 0], [0, 7, 0], [-1, 0, 3], [-2, 9, 0], [-3, 2, 0]]);
  assert.equal(after.variables!.pulled_hundreds!.value, 3);
  // A tap the card refuses is refused before playback, with the card's reason.
  assert.throws(() => validateAuthoringLesson(apart({ beats: [tap("a", "take_out", "tens"), tap("b", "take_out", "tens")] })), /The card refuses this tap here: There is no disk in this place/);
  assert.throws(() => validateAuthoringLesson(apart({ beats: [tap("a", "add", "tens")] })), /The card refuses this tap here/);
  assert.throws(() => validateAuthoringLesson(apart({ beats: [tap("a", "take_out", "millions")] })), /The card refuses this tap here/);
  assert.throws(() => validateAuthoringLesson(apart({ beats: [tap("a", "gather", "tens")] })), /Unknown tap 'gather'/);
  // A tenth disk in one place is refused (a ten is the next place's one, another card's need).
  const nine = build({ beats: [animate("nine", { [chartVariable("count", 0)]: 9 }), tap("tenth", "add", "ones")] });
  assert.throws(() => validateAuthoringLesson(nine), /This place holds nine at most/);
});

test("each count's variable runs from 0 to 9 exactly, its own, and the number's range stays on the chart", () => {
  const wide = build();
  (wide.lesson.variables as any[]).find((variable) => variable.as === chartVariable("count", 0)).max = 12;
  assert.throws(() => validateAuthoringLesson(wide), /must run from 0 to 9, the most its taps can make|The count of ones is a whole number from 0 to 9/);
  // The number's variable at its minimum or maximum is drawn on the chart's columns.
  const far = build();
  (far.lesson.variables as any[])[0].max = 4_050_000_000;
  assert.throws(() => validateAuthoringLesson(far), /When number = 4050000000.*above the chart's columns/);
});
