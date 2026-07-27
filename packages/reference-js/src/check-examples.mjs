import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  assertDeepEqual,
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
  validateAuthoringLesson,
} from "./oll.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const example = resolve(root, "examples/quadratic");
const authoring = JSON.parse(await readFile(resolve(example, "lesson.authoring.json"), "utf8"));
const expectedEvents = (await readFile(resolve(example, "lesson.canonical.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const expectedState = JSON.parse(await readFile(resolve(example, "expected-state.json"), "utf8"));

validateAuthoringLesson(authoring);
const actualEvents = normalizeAuthoringLesson(authoring, {
  lessonId: "lesson-quadratic-001",
  boardId: "board-session-001",
  baseRevision: 0,
  regionIntent: "new_topic",
});
assertDeepEqual(actualEvents, expectedEvents);
assertDeepEqual(reduceCanonicalEvents(actualEvents), expectedState);

console.log(`quadratic: ${actualEvents.length} events, ${expectedState.revision} board revisions, ${Object.keys(expectedState.nodes).length} nodes`);
