import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import { SHARED_PLUGIN_MANIFEST, buildProcessDiagram, processDiagramContent } from "../src/index.js";

function lessonWith(actions: unknown[], focus: string): AuthoringLesson {
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Diagram check", goals: ["Check the diagram"], variables: [] },
    steps: [{ key: "show", purpose: "Show it", beats: [{ key: "beat", say: "Here it is.", actions }] }],
    close: { summary: "Done.", focus: [focus] },
  } as unknown as AuthoringLesson;
}

test("the shared plugin is never a subject", () => {
  assert.equal(SHARED_PLUGIN_MANIFEST.id, "shared");
});

test("a process diagram is a chain of steps, or a cycle back to the first", () => {
  const chain = buildProcessDiagram({
    as: "steps", role: "diagram", place: { relation: "new_region" }, title: "Method",
    steps: [{ label: "Observe" }, { label: "Measure" }, { label: "Conclude" }], link_label: "next",
  });
  validateAuthoringLesson(lessonWith(chain.actions, chain.whole));
  const content = (chain.actions[0] as { content: Record<string, any> }).content;
  assert.deepEqual(content.elements.map((element: { as: string }) => element.as), ["step-01", "step-02", "step-03"]);
  assert.deepEqual(content.edges, [
    { as: "edge-01", from: "step-01", to: "step-02", label: "next" },
    { as: "edge-02", from: "step-02", to: "step-03", label: "next" },
  ]);
  assert.deepEqual(chain.parts, { whole: "steps", first_step: "steps#step-01", current_step: "steps#step-02", last_step: "steps#step-03" });

  const water = buildProcessDiagram({
    as: "water", role: "diagram", place: { relation: "new_region" }, shape: "cycle",
    steps: [{ label: "Evaporation" }, { label: "Condensation", link: "cools" }, { label: "Rain" }],
  });
  validateAuthoringLesson(lessonWith(water.actions, water.whole));
  const cycle = processDiagramContent({ shape: "cycle", steps: [{ label: "Evaporation" }, { label: "Condensation", link: "cools" }, { label: "Rain" }] });
  assert.equal("title" in cycle, false);
  assert.deepEqual((cycle.edges as unknown[]).slice(-2), [
    { as: "edge-02", from: "step-02", to: "step-03" },
    { as: "edge-close", from: "step-03", to: "step-01" },
  ]);
  assert.deepEqual((cycle.edges as unknown[])[0], { as: "edge-01", from: "step-01", to: "step-02", label: "cools" });
});
