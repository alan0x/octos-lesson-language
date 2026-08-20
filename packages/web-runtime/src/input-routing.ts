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
