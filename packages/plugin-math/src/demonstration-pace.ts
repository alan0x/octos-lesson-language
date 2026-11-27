/**
 * How fast a lesson's demonstration plays on a tap card (owner, 2026-11-27: "the learner barely has time to see
 * what's happening before the next step begins"). A demonstration plays one card action at a time: a column
 * coming down, a break, a trade, a take, one row moving, one counter moving, one lesson tap on the mat or the
 * chart. Each step's animation takes `DEMONSTRATION_STEP_MS`, then the card holds still for
 * `DEMONSTRATION_HOLD_MS` before the next step, and the lesson goes on only after the last hold. The playback
 * speed divides both. A learner's own taps keep their quick response (each view's own timings).
 *
 * The player (web runtime) owns the clock: it moves the demonstration one step at a time and waits a step's
 * slot between them. A card view only stretches its animation of one step to the step's time.
 */

/** How long one demonstration step's animation takes, at speed 1. */
export const DEMONSTRATION_STEP_MS = 2_000;
/** How long the card holds still after a step, before the next starts (or the lesson goes on), at speed 1. */
export const DEMONSTRATION_HOLD_MS = 600;
/** One step's whole slot, its animation and its hold, at speed 1. */
export const DEMONSTRATION_SLOT_MS = DEMONSTRATION_STEP_MS + DEMONSTRATION_HOLD_MS;

/** The step's animation time at a playback speed (a speed that is not a positive number counts as 1). */
export function demonstrationStepMs(speed = 1): number {
  return DEMONSTRATION_STEP_MS / (Number.isFinite(speed) && speed > 0 ? speed : 1);
}
