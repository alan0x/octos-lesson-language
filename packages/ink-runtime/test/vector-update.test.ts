import test from "node:test";
import assert from "node:assert/strict";
import { planInkVectorUpdate } from "../src/vector-update.js";

test("the initial vector mirror renders every component", () => {
  const first = {};
  const second = {};
  assert.deepEqual(planInkVectorUpdate(null, [
    { id: "a", reference: first },
    { id: "b", reference: second },
  ], true), {
    kind: "full",
    upsert_ids: ["a", "b"],
    remove_ids: [],
  });
});

test("ordinary handwriting appends only the newly added component", () => {
  const first = {};
  const second = {};
  assert.deepEqual(planInkVectorUpdate(new Map([["a", first]]), [
    { id: "a", reference: first },
    { id: "b", reference: second },
  ], true), {
    kind: "delta",
    upsert_ids: ["b"],
    remove_ids: [],
  });
});

test("erase and undo remove components without rebuilding retained ink", () => {
  const first = {};
  const second = {};
  assert.deepEqual(planInkVectorUpdate(new Map([
    ["a", first],
    ["b", second],
  ]), [{ id: "b", reference: second }], true), {
    kind: "delta",
    upsert_ids: [],
    remove_ids: ["a"],
  });
});

test("an in-place transform or restyle requires a complete refresh", () => {
  const retained = {};
  assert.equal(planInkVectorUpdate(
    new Map([["a", retained]]),
    [{ id: "a", reference: retained }],
    true,
  ).kind, "full");
});
