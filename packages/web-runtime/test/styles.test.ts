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

  const dialogRule = /\.oll-plot-dialog,\s*\.oll-coordinate-dialog\s*\{[^}]*\}/;
  const match = styles.match(dialogRule)?.[0] ?? "";
  assert.match(match, /position:\s*fixed/);
  assert.match(match, /inset:\s*50% auto auto 50%/);
  assert.match(match, /transform:\s*translate\(-50%,-50%\)/);
  assert.match(match, /overflow:\s*auto/);
});

test("a latent 3D face shows only when emphasized and is pointable only from the front; a 3D card fits its title", () => {
  const styles = readFileSync(resolve("packages/web-runtime/styles.css"), "utf8");
  assert.match(styles, /\.scene3d-highlight-latent:not\(\[class\*="emphasis-"\]\)\s*\{[^}]*fill-opacity:\s*0/);
  assert.match(styles, /\.scene3d-highlight-latent\[data-facing="back"\]\s*\{[^}]*pointer-events:\s*none/);
  assert.match(styles, /\.scene3d-highlight\.scene3d-highlight-latent\[data-facing="front"\]\s*\{[^}]*pointer-events:\s*all/);
  assert.match(styles, /\.board-node\[data-kind="scene3d"\] > \.scene3d-runtime\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(styles, /\.scene3d-highlight-latent\[data-facing="back"\]:not\(\[class\*="emphasis-"\]\) \+ \.scene3d-highlight-label,/);
  assert.match(styles, /\.scene3d-tracked-highlight\[data-facing="back"\] \+ \.scene3d-highlight-label\s*\{[^}]*display:\s*none/);
  assert.match(styles, /\.scene3d-tracked-highlight\[data-facing="back"\]\[class\*="emphasis-"\]\s*\{[^}]*fill-opacity:\s*0/);
  assert.match(styles, /\.scene3d-face-hidden\s*\{[^}]*stroke-dasharray/);
});

test("a card's layout box includes its padding and border", () => {
  const styles = readFileSync(resolve("packages/web-runtime/styles.css"), "utf8");
  // The layout gives each card its full size; with content-box sizing the
  // padding and border were added on top (38px wider, 34px taller than laid
  // out), so cards crossed group frames and narrowed the gaps between them.
  assert.match(styles, /\.board-node\s*\{[^}]*box-sizing:\s*border-box/);
});
