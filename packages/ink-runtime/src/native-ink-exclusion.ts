/**
 * Elements whose pointer input is never ink. Mirrors inkInputTargetsInteractiveUi.
 */
export const NATIVE_INK_EXCLUSION_SELECTOR = [
  '[data-oll-ink-input="ignore"]',
  '[contenteditable="true"]',
  "a",
  "button",
  "input",
  "select",
  "textarea",
].join(",");

export interface NativeInkRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ExclusionElement {
  getBoundingClientRect(): NativeInkRect;
  contains(other: unknown): boolean;
}

interface ExclusionDocument {
  querySelectorAll(selector: string): Iterable<unknown>;
  elementFromPoint(x: number, y: number): unknown;
}

/**
 * Viewport rectangles (CSS px, flattened as left, top, right, bottom) where
 * the Android native overlay must not start a stroke.
 *
 * Native ink paints before JavaScript can hit-test the touch, so without this
 * a tap on a control over the board flashes a dot. A control counts only where
 * it is the topmost hit, matching the runtime's own pointer-down check, so a
 * button hidden under another surface does not block drawing there.
 */
export function collectNativeInkExclusionRects(
  document: ExclusionDocument,
  bounds: NativeInkRect,
): number[] {
  const rects: number[] = [];
  for (const candidate of document.querySelectorAll(NATIVE_INK_EXCLUSION_SELECTOR)) {
    const element = candidate as ExclusionElement;
    const rect = element.getBoundingClientRect();
    const left = Math.max(rect.left, bounds.left);
    const top = Math.max(rect.top, bounds.top);
    const right = Math.min(rect.right, bounds.right);
    const bottom = Math.min(rect.bottom, bounds.bottom);
    if (right <= left || bottom <= top) continue;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    if (!hit || (hit !== element && !element.contains(hit))) continue;
    rects.push(Math.floor(left), Math.floor(top), Math.ceil(right), Math.ceil(bottom));
  }
  return rects;
}
