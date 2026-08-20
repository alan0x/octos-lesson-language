import type { InkSelectionBounds } from "./selection-record.js";

function expandedBoundsOverlap(
  left: InkSelectionBounds,
  right: InkSelectionBounds,
  gap: number,
): boolean {
  return left.x <= right.x + right.width + gap
    && left.x + left.width + gap >= right.x
    && left.y <= right.y + right.height + gap
    && left.y + left.height + gap >= right.y;
}

function unionBounds(
  left: InkSelectionBounds,
  right: InkSelectionBounds,
): InkSelectionBounds {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottom - y };
}

/**
 * Coalesces nearby stroke bounds without assigning strokes to a course. The
 * transitive merge keeps handwriting words/diagrams together while preserving
 * genuinely empty board space between distant notes.
 */
export function coalesceInkOccupiedBounds(
  candidates: InkSelectionBounds[],
  gap = 36,
): InkSelectionBounds[] {
  const pending = candidates
    .filter((bounds) =>
      [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width > 0
      && bounds.height > 0)
    .map((bounds) => ({ ...bounds }));
  const result: InkSelectionBounds[] = [];
  while (pending.length > 0) {
    let current = pending.shift()!;
    let merged = true;
    while (merged) {
      merged = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index]!;
        if (!expandedBoundsOverlap(current, candidate, gap)) continue;
        current = unionBounds(current, candidate);
        pending.splice(index, 1);
        merged = true;
      }
    }
    result.push(current);
  }
  return result.sort((left, right) => left.x - right.x || left.y - right.y);
}
