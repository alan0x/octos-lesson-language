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

test("the enlarged plot stays centered in the viewport", () => {
  const styles = readFileSync(
    resolve("packages/web-runtime/styles.css"),
    "utf8",
  );

  assert.match(styles, /\.oll-plot-dialog\s*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.oll-plot-dialog\s*\{[^}]*inset:\s*50% auto auto 50%/);
  assert.match(styles, /\.oll-plot-dialog\s*\{[^}]*transform:\s*translate\(-50%,-50%\)/);
  assert.match(styles, /\.oll-plot-dialog\s*\{[^}]*overflow:\s*auto/);
});
