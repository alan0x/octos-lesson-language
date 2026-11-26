// Tap cards routed by card kind: the registry and the trading mat's entry in it. Piles here are invented.
import test from "node:test";
import assert from "node:assert/strict";
import { BASE_TEN_TRADE_CARD, TAP_CARD_KIND_NAMES, TAP_CARD_KINDS, tapCardKind, tapCardKindList } from "../src/cards.js";
import {
  BASE_TEN_TRADE_KIND, applyBaseTenTap, baseTenChanges, baseTenHowTo, baseTenMat, baseTenRefusalText, type BaseTenMat,
} from "../../plugin-math/src/base-ten-trade.js";
import { cardHowTo } from "../../plugin-math/src/index.js";

const authored = (ones: number, tens: number, tray = 0) => ({
  columns: 2,
  places: [{ as: "ones", count: ones, tray }, { as: "tens", count: tens }],
  bindings: [
    { target: "ones.count", expression: "ones" }, { target: "ones.tray", expression: "ones_tray" }, { target: "tens.count", expression: "tens" },
  ],
});
const canonical = (ones: number, tens: number, tray = 0) => ({
  columns: 2,
  places: [{ id: "l:node:mat:fragment:ones", count: ones, tray }, { id: "l:node:mat:fragment:tens", count: tens }],
  bindings: [
    { target: "l:node:mat:fragment:ones.count", expression: "ones" }, { target: "l:node:mat:fragment:ones.tray", expression: "ones_tray" },
    { target: "l:node:mat:fragment:tens.count", expression: " tens " },
  ],
});

test("the registry holds the trading mat only, looked up by node kind", () => {
  assert.deepEqual(TAP_CARD_KIND_NAMES, [BASE_TEN_TRADE_KIND]);
  assert.equal(TAP_CARD_KINDS[BASE_TEN_TRADE_KIND], BASE_TEN_TRADE_CARD);
  assert.equal(tapCardKind(BASE_TEN_TRADE_KIND), BASE_TEN_TRADE_CARD);
  for (const kind of ["number_line", "fraction_model", "toString", "__proto__", "", undefined, 3]) assert.equal(tapCardKind(kind), undefined);
  assert.equal(tapCardKindList(), "base_ten_trade");
  assert.equal(tapCardKindList("and"), "base_ten_trade");
  assert.ok(Object.isFrozen(TAP_CARD_KINDS) && Object.isFrozen(BASE_TEN_TRADE_CARD));
});

test("the mat's tap rules, refusals and changes are the plugin's own", () => {
  const card = BASE_TEN_TRADE_CARD;
  assert.deepEqual(card.taps, ["gather", "ungather", "make", "break"]);
  assert.deepEqual(card.places, ["ones", "tens", "hundreds"]);
  const mat = card.state(authored(14, 3, 9));
  assert.deepEqual(mat, baseTenMat(authored(14, 3, 9)));
  const gathered = card.apply(mat, { kind: "gather", place: 0 });
  assert.ok(gathered.ok);
  assert.deepEqual(gathered.state, (applyBaseTenTap(mat, { kind: "gather", place: 0 }) as { mat: BaseTenMat }).mat);
  assert.deepEqual(card.changes(mat, gathered.state), baseTenChanges(mat, gathered.state));
  const made = card.apply(gathered.state, { kind: "make", place: 0 });
  assert.ok(made.ok);
  // Count before tray, place by place: the order a tap's changes are logged in.
  assert.deepEqual(card.changes(gathered.state, made.state).map(({ place, field }) => `${place}.${field}`), ["0.count", "0.tray", "1.count"]);
  const refused = card.apply(mat, { kind: "make", place: 0 });
  assert.deepEqual(refused, { ok: false, reason: "tray_not_ten" });
  // No language: US English, as the validator and the reducer say it; the card's own language when given.
  assert.equal(card.refusalText("tray_not_ten", 0), baseTenRefusalText("tray_not_ten", 0));
  assert.equal(card.refusalText("tray_not_ten", 0, card.language({ ...authored(1, 1), language: "zh-CN" })), baseTenRefusalText("tray_not_ten", 0, "zh-CN"));
  assert.equal(card.language(authored(1, 1)), "en-US");
});

test("the mat's tap fields, binding targets and content at values", () => {
  const card = BASE_TEN_TRADE_CARD;
  assert.deepEqual(card.tapFields(authored(1, 1)), [
    { place: 0, field: "count", min: 0, max: 59 }, { place: 0, field: "tray", min: 0, max: 10 }, { place: 1, field: "count", min: 0, max: 9 },
  ]);
  assert.deepEqual(card.tapFields({ columns: 3 }).map(({ place, field, max }) => `${place}.${field}<=${max}`),
    ["0.count<=59", "0.tray<=10", "1.count<=34", "1.tray<=10", "2.count<=9"]);
  // Authoring content names a place by `as`; the board by its canonical `id`.
  assert.equal(card.fieldTarget(authored(1, 1), 0, "tray"), "ones.tray");
  assert.equal(card.fieldTarget(canonical(1, 1), 1, "count"), "l:node:mat:fragment:tens.count");
  const at = card.contentAt(authored(1, 1), (place, field) => (place === 0 && field === "count" ? 23 : undefined));
  assert.equal(at.bindings, undefined);
  assert.deepEqual(at.places, [{ as: "ones", count: 23, tray: 0 }, { as: "tens", count: 1 }]);
});

test("the mat's facts: fields, targets, reading and the pile a done task leaves", () => {
  const { no_trade_left: noTrade, count } = BASE_TEN_TRADE_CARD.facts;
  assert.deepEqual(Object.keys(BASE_TEN_TRADE_CARD.facts), ["no_trade_left", "count"]);
  assert.deepEqual(noTrade!.keys, []);
  assert.deepEqual(count!.keys, ["at", "value"]);
  assert.deepEqual(noTrade!.read({ fact: "no_trade_left" }, baseTenMat(authored(14, 3))), { actual: 0, target: 1, succeeded: false });
  assert.deepEqual(noTrade!.read({ fact: "no_trade_left" }, baseTenMat(authored(4, 4))), { actual: 1, target: 1, succeeded: true });
  assert.deepEqual(count!.read({ fact: "count", at: "ones", value: 14 }, baseTenMat(authored(14, 3, 10))), { actual: 14, target: 14, succeeded: true });

  const failures: string[] = [];
  const fail = (field: string, message: string): never => {
    failures.push(`${field}: ${message}`);
    throw new Error(message);
  };
  assert.throws(() => count!.validate!({ fact: "count", at: "hundreds", value: 1 }, baseTenMat(authored(14, 3)), fail));
  assert.throws(() => count!.validate!({ fact: "count", at: "ones", value: 14 }, baseTenMat(authored(14, 3)), fail));
  assert.throws(() => count!.validate!({ fact: "count", at: "ones", value: 5 }, baseTenMat(authored(14, 3)), fail));
  count!.validate!({ fact: "count", at: "ones", value: 24 }, baseTenMat(authored(14, 3)), fail);
  assert.deepEqual(failures, [
    "at: A count is of a place the card has: ones, tens",
    "value: The practice pile already has 14 ones",
    "value: Tapping this pile makes 4 or 14 or 24 or 34 or 44 ones, never 5",
  ]);

  const start: Record<string, number> = { ones: 14, ones_tray: 3, tens: 3 };
  const startValue = (alias: string | undefined) => (alias === undefined ? 0 : start[alias] ?? 0);
  // Trading never changes the value: 44, each tray empty.
  assert.deepEqual(noTrade!.donePile({ content: canonical(0, 0), completion: { fact: "no_trade_left" }, startValue }), { ones: 4, ones_tray: 0, tens: 4 });
  // A count task: the learner's own logged pile, laid tidy; else the nearest pile with that count.
  const completion = { fact: "count", at: "ones", value: 24 };
  assert.deepEqual(count!.donePile({ content: canonical(0, 0), completion, startValue, submitted: { ones: 24, ones_tray: 10, tens: 2 } }), { ones: 24, ones_tray: 0, tens: 2 });
  assert.deepEqual(count!.donePile({ content: canonical(0, 0), completion, startValue, submitted: { ones: 14, ones_tray: 0, tens: 3 } }), { ones: 24, ones_tray: 0, tens: 2 });
  assert.deepEqual(count!.donePile({ content: canonical(0, 0), completion, startValue }), { ones: 24, ones_tray: 0, tens: 2 });
  assert.equal(count!.donePile({ content: canonical(0, 0), completion: { ...completion, value: 5 }, startValue }), undefined);
});

test("how to work a card is found by its kind", () => {
  const content = authored(14, 3);
  assert.equal(cardHowTo(BASE_TEN_TRADE_KIND, content), baseTenHowTo(content));
  assert.equal(cardHowTo(BASE_TEN_TRADE_KIND, { ...content, columns: 3, language: "zh-CN" }), baseTenHowTo({ ...content, columns: 3, language: "zh-CN" }));
  assert.equal(cardHowTo("number_line", content), undefined);
  assert.equal(cardHowTo("toString", content), undefined);
});
