import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("Scene3D controls and fallback occupy separate layout rows", () => {
  const styles = readFileSync(
    resolve("packages/web-runtime/styles.css"),
    "utf8",
  );

  assert.match(
    styles,
    /grid-template-areas:\s*"visual"\s*"controls"\s*"fallback"/,
  );
  assert.match(styles, /\.scene3d-controls\s*\{[^}]*grid-area:\s*controls/);
  assert.doesNotMatch(
    styles,
    /\.scene3d-controls\s*\{[^}]*(?:position:\s*absolute|bottom:)/,
  );
  assert.match(styles, /\.scene3d-fallback\s*\{[^}]*grid-area:\s*fallback/);
});
