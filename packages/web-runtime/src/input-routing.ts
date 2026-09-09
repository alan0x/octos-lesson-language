const nativeInteractiveTags = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
]);

interface InputPathElement {
  tagName?: unknown;
  getAttribute?: (name: string) => string | null;
}

/**
 * Interactive UI may live inside the board's transformed world. Pointer and
 * wheel input on that UI belongs to the control, not to board pan/zoom.
 */
export function boardInputTargetsInteractiveUi(path: readonly unknown[]): boolean {
  return path.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const element = candidate as InputPathElement;
    if (element.getAttribute?.("data-oll-board-input") === "ignore") return true;
    if (element.getAttribute?.("data-oll-ink-input") === "ignore") return true;
    if (element.getAttribute?.("contenteditable") === "true") return true;
    return typeof element.tagName === "string"
      && nativeInteractiveTags.has(element.tagName.toLocaleUpperCase());
  });
}

/**
 * A world-layer card can own pointer input while still allowing the board to
 * zoom when the wheel is over ordinary card content. Controls that explicitly
 * own board input keep their wheel events.
 */
export function boardWheelTargetsInteractiveUi(path: readonly unknown[]): boolean {
  const elements = path.filter((candidate) =>
    Boolean(candidate) && typeof candidate === "object") as InputPathElement[];
  // A host can explicitly make its whole subtree transparent to wheel input.
  // Check this before descendants such as buttons, otherwise a button inside a
  // whiteboard card still prevents the viewport's wheel handler from running.
  if (elements.some((element) =>
    element.getAttribute?.("data-oll-board-wheel") === "pass")) return false;
  return elements.some((element) => {
    if (element.getAttribute?.("data-oll-board-input") === "ignore") return true;
    if (element.getAttribute?.("contenteditable") === "true") return true;
    return typeof element.tagName === "string"
      && nativeInteractiveTags.has(element.tagName.toLocaleUpperCase());
  });
}
