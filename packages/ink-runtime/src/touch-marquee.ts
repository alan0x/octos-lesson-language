/**
 * Touch long-press marquee arbitration.
 *
 * In select mode a touch down is ambiguous: a quick drag should pan the
 * board, a long press should start marquee (rectangle) selection. This pure
 * state machine makes the pending→pan|marquee decision; the ink runtime owns
 * the actual hold timer and event buffering (see prepareBoardInput in
 * runtime.ts).
 *
 *   idle --begin(touch down)------------------------> pending
 *   pending --move ≥ cancelPx-----------------------> pan      (drag: board pans)
 *   pending --holdElapsed(holdMs timer fired)-------> marquee  (long press: select)
 *   pending --end(finger lifted before the timer)---> idle, reported as "tap"
 *   pan/marquee --end-------------------------------> idle, reported as "settled"
 */

/** How long a touch must hold still before it becomes a marquee selection. */
export const TOUCH_MARQUEE_HOLD_MS = 400;

/** Travel that cancels the hold and commits the gesture to board panning. */
export const TOUCH_MARQUEE_CANCEL_PX = 10;

export type TouchMarqueePhase = "idle" | "pending" | "pan" | "marquee";

export class TouchMarqueeArbiter {
  private phase: TouchMarqueePhase = "idle";
  private startX = 0;
  private startY = 0;

  constructor(private readonly cancelPx: number = TOUCH_MARQUEE_CANCEL_PX) {}

  getPhase(): TouchMarqueePhase {
    return this.phase;
  }

  /** Starts tracking a touch down. Returns false if a touch is already pending. */
  begin(x: number, y: number): boolean {
    if (this.phase === "pending") return false;
    this.phase = "pending";
    this.startX = x;
    this.startY = y;
    return true;
  }

  /** Reports the phase after a move: too much travel commits the gesture to pan. */
  move(x: number, y: number): TouchMarqueePhase {
    if (this.phase === "pending" && Math.hypot(x - this.startX, y - this.startY) >= this.cancelPx) {
      this.phase = "pan";
    }
    return this.phase;
  }

  /** Reports the phase after the hold timer elapsed. */
  holdElapsed(): TouchMarqueePhase {
    if (this.phase === "pending") this.phase = "marquee";
    return this.phase;
  }

  /**
   * The finger lifted. "tap" means the hold never elapsed — the runtime may
   * still turn it into a click-selection; anything else is already settled.
   */
  end(): "tap" | "settled" {
    const tapped = this.phase === "pending";
    this.phase = "idle";
    return tapped ? "tap" : "settled";
  }

  /** Drops all tracking (mode change, dispose, a second finger joining). */
  cancel(): void {
    this.phase = "idle";
  }
}
