/**
 * Palm rejection for pen input.
 *
 * While a pen is actively in use, touch contacts are almost always a resting
 * palm or an accidental finger, not deliberate touch input. The ink layer
 * drops those touches (without intercepting them, so the board can still use
 * them to pan) for a short window after the last pen activity.
 */

/** How long after the last pen down/move a touch is still considered a palm. */
export const PALM_REJECTION_WINDOW_MS = 600;

/**
 * True when a touch contact at time `now` should be treated as a palm rather
 * than input. `lastPenActiveAt` is the timestamp of the most recent pen
 * down/move; a timestamp in the future (clock skew between event sources)
 * still counts as active, since `now - lastPenActiveAt` stays below the
 * window.
 */
export function shouldIgnoreTouchForPalmRejection(
  now: number,
  lastPenActiveAt: number | undefined,
  windowMs: number = PALM_REJECTION_WINDOW_MS,
): boolean {
  if (lastPenActiveAt === undefined) return false;
  return now - lastPenActiveAt < windowMs;
}
