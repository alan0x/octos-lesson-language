import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertDeepEqual,
  assertAuthoringSchema,
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
  validateAuthoringLesson,
} from "./index.js";

const root = process.cwd();
const manifest = JSON.parse(await readFile(resolve(root, "examples/manifest.json"), "utf8"));

for (const entry of manifest) {
  const example = resolve(root, "examples", entry.name);
  const host = {
    ...entry,
    ...(entry.contextFile
      ? { resourceContext: JSON.parse(await readFile(resolve(example, entry.contextFile), "utf8")) }
      : {}),
  };
  const authoring = JSON.parse(await readFile(resolve(example, "lesson.authoring.json"), "utf8"));
  const expectedEvents = (await readFile(resolve(example, "lesson.canonical.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line: string) => JSON.parse(line));
  const expectedState = JSON.parse(await readFile(resolve(example, "expected-state.json"), "utf8"));

  assertAuthoringSchema(authoring);
  validateAuthoringLesson(authoring, host.resourceContext);
  const actualEvents = normalizeAuthoringLesson(authoring, host);
  assertDeepEqual(actualEvents, expectedEvents);
  assertDeepEqual(reduceCanonicalEvents(actualEvents), expectedState);

  console.log(`${entry.name}: ${actualEvents.length} events, ${expectedState.revision} board revisions, ${Object.keys(expectedState.nodes).length} nodes`);
}
