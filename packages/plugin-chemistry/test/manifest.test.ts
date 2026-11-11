import test from "node:test";
import assert from "node:assert/strict";
import { CHEMISTRY_BUILDERS, CHEMISTRY_PLUGIN_MANIFEST, CHEMISTRY_SUBJECT_DESCRIPTION } from "../src/index.js";

test("the chemistry plugin depends on shared, has a subject line in both languages and no recipes yet", () => {
  assert.equal(CHEMISTRY_PLUGIN_MANIFEST.id, "chemistry");
  assert.deepEqual(CHEMISTRY_PLUGIN_MANIFEST.depends, { shared: "0.1.0" });
  for (const language of ["zh-CN", "en-US"] as const) assert.ok(CHEMISTRY_SUBJECT_DESCRIPTION[language].length > 10);
  assert.deepEqual(Object.keys(CHEMISTRY_BUILDERS), []);
});
