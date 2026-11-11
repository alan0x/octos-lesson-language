import test from "node:test";
import assert from "node:assert/strict";
import { SUBJECT_PLUGINS, subjectDescription } from "../src/index.js";

test("the five subject plugins are listed in a fixed order with their subject lines", () => {
  assert.deepEqual(SUBJECT_PLUGINS.map((plugin) => plugin.manifest.id), ["math", "physics", "chemistry", "biology", "earth_space"]);
  for (const plugin of SUBJECT_PLUGINS) assert.deepEqual(plugin.manifest.depends, { shared: "0.1.0" });
  assert.match(subjectDescription("earth_space", "zh-CN")!, /水循环/);
  assert.match(subjectDescription("biology", "en-US")!, /cells/);
  assert.match(subjectDescription("chemistry", "fr-FR")!, /Chemistry/);
  assert.equal(subjectDescription("shared", "en-US"), undefined);
  assert.equal(subjectDescription("history", "en-US"), undefined);
});
