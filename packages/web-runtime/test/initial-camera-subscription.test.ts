import test from "node:test";
import assert from "node:assert/strict";
import { InfiniteBoardView } from "../src/board-view.js";
import type { CameraState } from "../src/camera.js";

function createTransitionHarness() {
  let visible: CameraState = { panX: 0, panY: 0, scale: 1 };
  let now = 0;
  const frames: FrameRequestCallback[] = [];
  const view = Object.assign(Object.create(InfiniteBoardView.prototype), {
    world: { style: { transform: "" } },
    viewport: { classList: { contains: () => false } },
    panX: 80, panY: 60, scale: .78,
    cameraListeners: new Set<(camera: CameraState) => void>(),
    cameraNotifyUntil: 0, cameraFrame: undefined,
    hostWindow: {
      performance: { now: () => now },
      requestAnimationFrame(callback: FrameRequestCallback) {
        frames.push(callback);
        return frames.length;
      },
    },
    getCameraState: () => ({ ...visible }),
  }) as InfiniteBoardView;
  return {
    view, frames,
    startInitialTransition() {
      (view as unknown as { transform(): void }).transform();
    },
    finishTransition() {
      visible = { panX: 80, panY: 60, scale: .78 };
      now = 800;
      frames.shift()?.(now);
    },
  };
}

test("first camera subscription follows an initial transform started before listeners", () => {
  const harness = createTransitionHarness();
  harness.startInitialTransition();
  assert.equal(harness.frames.length, 0);
  const received: CameraState[] = [];
  harness.view.subscribeCamera(camera => received.push(camera));
  assert.deepEqual(received, [{ panX: 0, panY: 0, scale: 1 }]);
  harness.finishTransition();
  assert.deepEqual(received.at(-1), { panX: 80, panY: 60, scale: .78 });
});

test("subscribing to an already settled camera schedules no extra frames", () => {
  const harness = createTransitionHarness();
  harness.finishTransition();
  const received: CameraState[] = [];
  harness.view.subscribeCamera(camera => received.push(camera));
  assert.deepEqual(received, [{ panX: 80, panY: 60, scale: .78 }]);
  assert.equal(harness.frames.length, 0);
});

test("camera subscribers share the transition frame and unsubscribe normally", () => {
  const harness = createTransitionHarness();
  harness.startInitialTransition();
  const first: CameraState[] = [];
  const second: CameraState[] = [];
  const unsubscribe = harness.view.subscribeCamera(camera => first.push(camera));
  harness.view.subscribeCamera(camera => second.push(camera));
  assert.equal(harness.frames.length, 1);
  unsubscribe();
  harness.finishTransition();
  assert.equal(first.length, 1);
  assert.deepEqual(second.at(-1), { panX: 80, panY: 60, scale: .78 });
});
