import test from "node:test";
import assert from "node:assert/strict";
import { InfiniteBoardView } from "../src/board-view.js";
import type { CameraState } from "../src/camera.js";
import type { Rect } from "../src/layout.js";

interface ReadableFocus {
  readableRects(rects: Rect[], current: CameraState, viewport: DOMRect): Rect[];
  towardLeftContext(camera: CameraState, kept: Rect[], all: Rect[], viewport: DOMRect): CameraState;
}

const chromebook = { x: 0, y: 0, width: 1366, height: 768, left: 0, top: 0, right: 1366, bottom: 768 } as DOMRect;
const camera: CameraState = { panX: 0, panY: 0, scale: 1 };
// A photo at the top of a Step and the note that closes it, far below.
const photo: Rect = { x: 0, y: 0, width: 340, height: 270 };
const note: Rect = { x: 600, y: 760, width: 250, height: 150 };

function view(minimumScale: number): ReadableFocus {
  return Object.assign(Object.create(InfiniteBoardView.prototype), {
    automaticCameraMinimumScale: minimumScale,
    automaticCameraMaximumScale: 1.1,
    viewportInsets: { top: 70, bottom: 190 },
  }) as ReadableFocus;
}

test("related cards that cannot share the screen at the host floor keep the newest", () => {
  assert.deepEqual(view(.9).readableRects([photo, note], camera, chromebook), [note]);
});

test("without a host floor every related card stays in the frame", () => {
  assert.deepEqual(view(.18).readableRects([photo, note], camera, chromebook), [photo, note]);
});

test("cards that fit together at the floor are all kept", () => {
  const beside: Rect = { x: 380, y: 0, width: 250, height: 150 };
  assert.deepEqual(view(.9).readableRects([photo, beside], camera, chromebook), [photo, beside]);
});

test("a narrowed frame moves toward the cards it left out while keeping the newest inside", () => {
  const scale = .9;
  const centred: CameraState = { scale, panX: 683 - 725 * scale, panY: 359 - 835 * scale };
  const moved = view(scale).towardLeftContext(centred, [note], [photo, note], chromebook);
  const top = moved.panY + note.y * scale;
  const bottom = moved.panY + (note.y + note.height) * scale;
  assert.equal(moved.scale, scale);
  assert.ok(moved.panY > centred.panY, "frame moves up toward the photo");
  assert.ok(top >= 70 + 16 - .001 && bottom <= 768 - 190 - 16 + .001, "the note stays fully in the usable area");
});
