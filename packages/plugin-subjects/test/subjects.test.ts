import test from "node:test";
import assert from "node:assert/strict";
import { SUBJECT_PLUGINS, selectSubjectPlugins, subjectDescription, subjectQuestion } from "../src/index.js";

test("the five subject plugins are listed in a fixed order with their subject lines", () => {
  assert.deepEqual(SUBJECT_PLUGINS.map((plugin) => plugin.manifest.id), ["math", "physics", "chemistry", "biology", "earth_space"]);
  for (const plugin of SUBJECT_PLUGINS) assert.deepEqual(plugin.manifest.depends, { shared: "0.1.0" });
  assert.match(subjectDescription("earth_space", "zh-CN")!, /水循环/);
  assert.match(subjectDescription("biology", "en-US")!, /cells/);
  assert.match(subjectDescription("chemistry", "fr-FR")!, /Chemistry/);
  assert.equal(subjectDescription("shared", "en-US"), undefined);
  assert.equal(subjectDescription("history", "en-US"), undefined);
});


test("the Jev subject question offers the plugins' subject lines plus none and unclear", () => {
  const question = subjectQuestion(["math", "physics", "earth_space", "shared"], "en-US");
  assert.deepEqual(Object.keys(question.criteria), ["math", "physics", "earth_space", "none", "unclear"]);
  assert.match(question.criteria.earth_space!, /water cycle/);
});

test("plugins are selected from Jev's probabilities with T1 0.6 and T2 0.05", () => {
  const installed = ["math", "physics", "chemistry", "biology", "earth_space", "shared"];
  assert.deepEqual(selectSubjectPlugins({ math: 0.9, physics: 0.04, none: 0.06 }, installed), { plugins: ["math"], confidence: 0.9 });
  assert.deepEqual(selectSubjectPlugins({ physics: 0.7, math: 0.25, unclear: 0.05 }, installed)?.plugins, ["physics", "math"]);
  assert.deepEqual(selectSubjectPlugins({ none: 0.8, math: 0.1 }, installed)?.plugins, ["shared"]);
  assert.equal(selectSubjectPlugins({ math: 0.5, physics: 0.4 }, installed), undefined);
  assert.equal(selectSubjectPlugins({ unclear: 0.7, math: 0.2 }, installed), undefined);
  assert.equal(selectSubjectPlugins({ biology: 0.9 }, ["math", "physics", "shared"]), undefined);
  assert.equal(selectSubjectPlugins(undefined, installed), undefined);
});
