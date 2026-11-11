import test from "node:test";
import assert from "node:assert/strict";
import { EARTH_SPACE_BUILDERS, EARTH_SPACE_PLUGIN_MANIFEST, EARTH_SPACE_SUBJECT_DESCRIPTION } from "../src/index.js";

test("the earth_space plugin depends on shared, has a subject line in both languages and no recipes yet", () => {
  assert.equal(EARTH_SPACE_PLUGIN_MANIFEST.id, "earth_space");
  assert.deepEqual(EARTH_SPACE_PLUGIN_MANIFEST.depends, { shared: "0.1.0" });
  for (const language of ["zh-CN", "en-US"] as const) assert.ok(EARTH_SPACE_SUBJECT_DESCRIPTION[language].length > 10);
  assert.deepEqual(Object.keys(EARTH_SPACE_BUILDERS), []);
});
