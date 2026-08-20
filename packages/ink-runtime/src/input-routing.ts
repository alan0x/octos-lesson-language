const nativeControlTags = new Set([
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
 * Ink owns empty board space while a drawing tool is active, but it must not
 * consume pointer input that belongs to UI mounted inside the board world.
 * Hosts can mark an entire interactive surface with data-oll-ink-input="ignore";
 * native form controls remain usable even when a host forgets the marker.
 */
export function inkInputTargetsInteractiveUi(path: readonly unknown[]): boolean {
  return path.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const element = candidate as InputPathElement;
    if (element.getAttribute?.("data-oll-ink-input") === "ignore") return true;
    if (element.getAttribute?.("contenteditable") === "true") return true;
    return typeof element.tagName === "string"
      && nativeControlTags.has(element.tagName.toLocaleUpperCase());
  });
}
