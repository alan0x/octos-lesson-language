import test from "node:test";
import assert from "node:assert/strict";
import { BIOLOGY_BUILDERS, BIOLOGY_PLUGIN_MANIFEST, BIOLOGY_SUBJECT_DESCRIPTION } from "../src/index.js";

test("the biology plugin depends on shared, has a subject line in both languages and no recipes yet", () => {
  assert.equal(BIOLOGY_PLUGIN_MANIFEST.id, "biology");
  assert.deepEqual(BIOLOGY_PLUGIN_MANIFEST.depends, { shared: "0.1.0" });
  for (const language of ["zh-CN", "en-US"] as const) assert.ok(BIOLOGY_SUBJECT_DESCRIPTION[language].length > 10);
  assert.deepEqual(Object.keys(BIOLOGY_BUILDERS), []);
});
