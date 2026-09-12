import test from "node:test";
import assert from "node:assert/strict";
import { coalescedPointerSamples } from "../src/pointer-samples.js";

function pointerSample(
  clientX: number,
  clientY: number,
  timeStamp: number,
  pressure = 0.5,
): PointerEvent {
  return {
    pointerId: 7,
    clientX,
    clientY,
    timeStamp,
    pressure,
  } as PointerEvent;
}

test("falls back to the dispatched pointer event when coalescing is unavailable", () => {
  const event = pointerSample(30, 40, 10);

  assert.deepEqual(coalescedPointerSamples(event), [event]);
});

test("replays intermediate hardware samples before the dispatched event", () => {
  const first = pointerSample(10, 20, 8);
  const second = pointerSample(20, 30, 9);
  const event = Object.assign(pointerSample(30, 40, 10), {
    getCoalescedEvents: () => [first, second],
  });

  assert.deepEqual(coalescedPointerSamples(event), [first, second, event]);
});

test("does not duplicate a final event already present in coalesced samples", () => {
  const first = pointerSample(10, 20, 8);
  const event = pointerSample(30, 40, 10);
  const eventWithSamples = Object.assign(event, {
    getCoalescedEvents: () => [first, event],
  });

  assert.deepEqual(coalescedPointerSamples(eventWithSamples), [first, event]);
});

test("keeps a same-position sample when pressure or timestamp differs", () => {
  const intermediate = pointerSample(30, 40, 9, 0.25);
  const event = Object.assign(pointerSample(30, 40, 10, 0.5), {
    getCoalescedEvents: () => [intermediate],
  });

  assert.deepEqual(coalescedPointerSamples(event), [intermediate, event]);
});

test("falls back safely when a browser exposes a broken coalescing method", () => {
  const event = Object.assign(pointerSample(30, 40, 10), {
    getCoalescedEvents: () => { throw new Error("driver failure"); },
  });

  assert.deepEqual(coalescedPointerSamples(event), [event]);
});
