import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { normalizeAuthoringLesson, reduceCanonicalEvents } from "./oll.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const example = resolve(root, "examples/quadratic");
const document = JSON.parse(await readFile(resolve(example, "lesson.authoring.json"), "utf8"));
const events = normalizeAuthoringLesson(document, {
  lessonId: "lesson-quadratic-001",
  boardId: "board-session-001",
  baseRevision: 0,
  regionIntent: "new_topic",
});
await writeFile(resolve(example, "lesson.canonical.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
await writeFile(resolve(example, "expected-state.json"), `${JSON.stringify(reduceCanonicalEvents(events), null, 2)}\n`);
