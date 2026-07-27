import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeAuthoringLesson, reduceCanonicalEvents } from "./index.js";

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
  const document = JSON.parse(await readFile(resolve(example, "lesson.authoring.json"), "utf8"));
  const events = normalizeAuthoringLesson(document, host);
  await writeFile(resolve(example, "lesson.canonical.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  await writeFile(resolve(example, "expected-state.json"), `${JSON.stringify(reduceCanonicalEvents(events), null, 2)}\n`);
}
