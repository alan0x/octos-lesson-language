function samePointerSample(left: PointerEvent, right: PointerEvent): boolean {
  return left.pointerId === right.pointerId
    && left.timeStamp === right.timeStamp
    && left.clientX === right.clientX
    && left.clientY === right.clientY
    && left.pressure === right.pressure;
}

/**
 * Returns every hardware sample represented by a browser pointermove event.
 *
 * Some Android pen drivers deliver pointermove slowly while retaining the
 * intermediate digitizer samples in getCoalescedEvents(). Replaying those
 * samples prevents long straight chords between sparse event endpoints. The
 * dispatched event is appended when the browser did not include it itself.
 */
export function coalescedPointerSamples(event: PointerEvent): PointerEvent[] {
  let coalesced: PointerEvent[];
  try {
    coalesced = typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [];
  } catch {
    return [event];
  }

  if (coalesced.length === 0) return [event];
  const last = coalesced.at(-1);
  if (last && samePointerSample(last, event)) return coalesced;
  return [...coalesced, event];
}
