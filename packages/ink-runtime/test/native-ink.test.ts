import test from "node:test";
import assert from "node:assert/strict";
import {
  collectNativeInkExclusionRects,
  NATIVE_INK_EXCLUSION_SELECTOR,
  type NativeInkRect,
} from "../src/native-ink-exclusion.js";
import { smoothedInkPathData } from "../src/native-ink-path.js";

test("smooths a native stroke through sample midpoints and ends on the last sample", () => {
  assert.equal(
    smoothedInkPathData([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]),
    "M0.000 0.000 L5.000 0.000 Q10.000 0.000 10.000 5.000 "
      + "Q10.000 10.000 15.000 10.000 L20.000 10.000",
  );
});

test("keeps taps and two-sample strokes as straight marks", () => {
  assert.equal(smoothedInkPathData([]), "");
  assert.equal(smoothedInkPathData([{ x: 1, y: 2 }]), "M1.000 2.000 L1.010 2.000");
  assert.equal(
    smoothedInkPathData([{ x: 0, y: 0 }, { x: 4, y: 2 }]),
    "M0.000 0.000 L2.000 1.000 L4.000 2.000",
  );
});

interface FakeElement {
  rect: NativeInkRect;
  children: FakeElement[];
  getBoundingClientRect(): NativeInkRect;
  contains(other: unknown): boolean;
}

function element(rect: NativeInkRect, children: FakeElement[] = []): FakeElement {
  return {
    rect,
    children,
    getBoundingClientRect: () => rect,
    contains(other) {
      return other === this || children.some((child) => child.contains(other));
    },
  };
}

const board = { left: 0, top: 50, right: 800, bottom: 600 };

test("excludes topmost controls clipped to the board", () => {
  const icon = element({ left: 12, top: 32, right: 28, bottom: 48 });
  const toolbar = element({ left: 10.4, top: 30, right: 60.2, bottom: 80.5 }, [icon]);
  const outside = element({ left: 900, top: 60, right: 950, bottom: 90 });
  let selector = "";
  const document = {
    querySelectorAll(query: string) {
      selector = query;
      return [toolbar, outside];
    },
    // The centre of the clipped toolbar lands on its own icon child.
    elementFromPoint: () => icon,
  };

  assert.deepEqual(collectNativeInkExclusionRects(document, board), [10, 50, 61, 81]);
  assert.equal(selector, NATIVE_INK_EXCLUSION_SELECTOR);
});

test("ignores controls covered by another surface", () => {
  const buried = element({ left: 100, top: 100, right: 200, bottom: 140 });
  const cover = element({ left: 0, top: 0, right: 800, bottom: 600 });
  const document = {
    querySelectorAll: () => [buried],
    elementFromPoint: () => cover,
  };

  assert.deepEqual(collectNativeInkExclusionRects(document, board), []);
});
