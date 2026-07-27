import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  OllError,
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
  validateAuthoringLesson,
} from "../src/oll.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const source = JSON.parse(await readFile(resolve(root, "examples/quadratic/lesson.authoring.json"), "utf8"));
const host = {
  lessonId: "lesson-quadratic-001",
  boardId: "board-session-001",
  baseRevision: 0,
  regionIntent: "new_topic",
};

test("validates and normalizes the full quadratic lesson", () => {
  validateAuthoringLesson(source);
  const events = normalizeAuthoringLesson(source, host);
  assert.equal(events[0].event, "lesson.open");
  assert.equal(events.at(-1).event, "lesson.close");
  assert.equal(events.length, source.steps.length + 2);
  assert.equal(reduceCanonicalEvents(events).revision, source.steps.length);
});

test("rejects a reference before it is defined", () => {
  const invalid = structuredClone(source);
  invalid.steps[0].beats[0].actions[0].place = {
    relation: "below",
    anchor: "not-created",
  };
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_REFERENCE_NOT_FOUND",
  );
});

test("rejects duplicate local aliases", () => {
  const invalid = structuredClone(source);
  invalid.steps[0].beats[0].actions[1].as = "original";
  assert.throws(
    () => validateAuthoringLesson(invalid),
    (error) => error instanceof OllError && error.code === "OLL_DUPLICATE_ALIAS",
  );
});

test("normalization is deterministic", () => {
  assert.deepEqual(
    normalizeAuthoringLesson(source, host),
    normalizeAuthoringLesson(source, host),
  );
});

test("replaying a canonical step is idempotent", () => {
  const events = normalizeAuthoringLesson(source, host);
  const duplicatedStep = structuredClone(events[1]);
  const state = reduceCanonicalEvents([events[0], events[1], duplicatedStep, ...events.slice(2)]);
  const baseline = reduceCanonicalEvents(events);
  assert.deepEqual(state, baseline);
});
