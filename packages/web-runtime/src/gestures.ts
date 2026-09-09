/**
 * Pointer-agnostic board gesture recognition.
 *
 * This module is deliberately free of DOM types so the state machine can be
 * unit-tested with plain event tables. `InfiniteBoardView` normalizes
 * PointerEvents into viewport-local coordinates and forwards them here.
 *
 * States and transitions:
 *
 *   idle     --down(1st pointer)---------> panning
 *   panning  --down(2nd pointer)---------> pinching   (dist0/lastDist and the
 *                                                      midpoint baseline are
 *                                                      captured from current
 *                                                      pointer positions, so
 *                                                      the ongoing pan is not
 *                                                      reset)
 *   pinching --up/cancel(one pointer)----> panning    (the remaining pointer
 *                                                      keeps its current
 *                                                      position as the pan
 *                                                      baseline: no jump)
 *   panning  --up/cancel(last pointer)---> idle
 *   any      --cancel/all pointers up----> idle
 *
 * Defense: a third (or later) pointerdown is ignored. The in-flight one- or
 * two-finger gesture keeps its baselines instead of being cancelled, because
 * accidental palm touches are common and dropping the gesture mid-pinch is
 * more disruptive than ignoring the extra contact.
 *
 * Pinch math: every move emits `zoomAt` with an *incremental* factor
 * (dist / lastDist) anchored at the current midpoint, plus a `panBy` for the
 * midpoint's own displacement. Anchored at the new midpoint, pan+scale
 * together keep both fingers glued to their board content, and incremental
 * factors compose correctly under repeated multiplicative `zoomAt` calls.
 * The cumulative factor since the pinch began (dist / dist0) is available via
 * `pinchFactor()` for hosts that prefer absolute bookkeeping.
 */
export type GesturePointerEventType = "down" | "move" | "up" | "cancel";

export interface GesturePointerEvent {
  pointerId: number;
  /** Viewport-local coordinates (any consistent coordinate space works). */
  x: number;
  y: number;
  type: GesturePointerEventType;
}

export type BoardGestureAction =
  | { type: "panBy"; dx: number; dy: number }
  | { type: "zoomAt"; factor: number; x: number; y: number }
  | { type: "none" };

export type BoardGesturePhase = "idle" | "panning" | "pinching";

const NONE: BoardGestureAction = { type: "none" };

interface TrackedPointer {
  x: number;
  y: number;
}

export class BoardGestureRecognizer {
  private readonly pointers = new Map<number, TrackedPointer>();
  /** Pointer that owns the pan baseline while `phase === "panning"`. */
  private panPointerId?: number;
  /** Pinch bookkeeping while `phase === "pinching"`. */
  private pinchDist0 = 0;
  private pinchLastDist = 0;
  private pinchLastMid = { x: 0, y: 0 };

  get phase(): BoardGesturePhase {
    if (this.pointers.size === 0) return "idle";
    return this.pointers.size === 1 ? "panning" : "pinching";
  }

  /** True while any pointer is down, i.e. the gesture owns the camera. */
  isActive(): boolean {
    return this.pointers.size > 0;
  }

  /** Cumulative pinch factor since the second pointer landed (1 outside pinching). */
  pinchFactor(): number {
    if (this.phase !== "pinching" || this.pinchDist0 <= 0) return 1;
    return this.pinchLastDist / this.pinchDist0;
  }

  /** Drops all tracked pointers and baselines (input-owner changes, dispose). */
  reset(): void {
    this.pointers.clear();
    this.panPointerId = undefined;
    this.pinchDist0 = 0;
    this.pinchLastDist = 0;
  }

  handlePointer(event: GesturePointerEvent): BoardGestureAction[] {
    switch (event.type) {
      case "down": return this.onDown(event);
      case "move": return this.onMove(event);
      case "up":
      case "cancel": return this.onUp(event);
    }
  }

  private onDown(event: GesturePointerEvent): BoardGestureAction[] {
    // Ignore a third (or later) contact; see module docstring.
    if (this.pointers.size >= 2 && !this.pointers.has(event.pointerId)) return [NONE];
    this.pointers.set(event.pointerId, { x: event.x, y: event.y });
    if (this.pointers.size === 1) {
      this.panPointerId = event.pointerId;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [TrackedPointer, TrackedPointer];
      this.pinchDist0 = this.pinchLastDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchLastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.panPointerId = undefined;
    }
    return [NONE];
  }

  private onMove(event: GesturePointerEvent): BoardGestureAction[] {
    const tracked = this.pointers.get(event.pointerId);
    if (!tracked) return [NONE];
    if (this.pointers.size === 1 && event.pointerId === this.panPointerId) {
      const dx = event.x - tracked.x;
      const dy = event.y - tracked.y;
      tracked.x = event.x;
      tracked.y = event.y;
      return [{ type: "panBy", dx, dy }];
    }
    if (this.pointers.size === 2) {
      tracked.x = event.x;
      tracked.y = event.y;
      const [a, b] = [...this.pointers.values()] as [TrackedPointer, TrackedPointer];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const actions: BoardGestureAction[] = [];
      const dx = mid.x - this.pinchLastMid.x;
      const dy = mid.y - this.pinchLastMid.y;
      if (dx !== 0 || dy !== 0) actions.push({ type: "panBy", dx, dy });
      // Fingers crossing through dist === 0 must not poison the baseline;
      // only positive distances may replace it.
      if (dist > 0) {
        if (this.pinchLastDist > 0 && dist !== this.pinchLastDist) {
          actions.push({ type: "zoomAt", factor: dist / this.pinchLastDist, x: mid.x, y: mid.y });
        }
        this.pinchLastDist = dist;
      }
      this.pinchLastMid = mid;
      return actions.length ? actions : [NONE];
    }
    tracked.x = event.x;
    tracked.y = event.y;
    return [NONE];
  }

  private onUp(event: GesturePointerEvent): BoardGestureAction[] {
    if (!this.pointers.delete(event.pointerId)) return [NONE];
    if (this.pointers.size === 1) {
      // Rebuild the pan baseline from the remaining pointer's current
      // position so lifting one pinch finger never jumps the camera.
      const [remainingId] = [...this.pointers.entries()][0]!;
      this.panPointerId = remainingId;
      this.pinchDist0 = 0;
      this.pinchLastDist = 0;
    } else {
      this.panPointerId = undefined;
    }
    return [NONE];
  }
}
