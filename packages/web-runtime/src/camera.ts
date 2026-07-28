import type { Rect } from "./layout.js";

export interface CameraState {
  panX: number;
  panY: number;
  scale: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export type AttentionMode = "detail" | "relationship" | "overview";

const FOCUS_MARGIN = 70;
const REVEAL_MARGIN = FOCUS_MARGIN;
const MIN_READABLE_FOCUS_WIDTH = 240;
const MIN_AUTOMATIC_SCALE = .18;
const MAX_AUTOMATIC_SCALE = 1;

const COMPOSITION_TARGET: Record<AttentionMode, number> = {
  detail: .64,
  relationship: .72,
  overview: .78,
};

function unionRects(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function visibleAt(
  rect: Rect,
  camera: CameraState,
  viewport: ViewportSize,
  margin: number,
): boolean {
  const left = camera.panX + rect.x * camera.scale;
  const right = left + rect.width * camera.scale;
  const top = camera.panY + rect.y * camera.scale;
  const bottom = top + rect.height * camera.scale;
  return left >= margin
    && right <= viewport.width - margin
    && top >= margin
    && bottom <= viewport.height - margin;
}

function centeredCamera(
  rect: Rect,
  scale: number,
  viewport: ViewportSize,
): CameraState {
  return {
    scale,
    panX: viewport.width / 2 - (rect.x + rect.width / 2) * scale,
    panY: viewport.height / 2 - (rect.y + rect.height / 2) * scale,
  };
}

/**
 * Compose an explicit teaching focus. The resulting scale is not a camera preset:
 * it is derived from the target geometry and current viewport so the complete
 * teaching scene stays readable and occupies a deliberate share of the view.
 */
export function planFocusCamera(
  targets: Rect[],
  current: CameraState,
  viewport: ViewportSize,
  mode: AttentionMode,
): CameraState {
  if (!targets.length) return current;
  const scene = unionRects(targets);
  const safeWidth = Math.max(1, viewport.width - FOCUS_MARGIN * 2);
  const safeHeight = Math.max(1, viewport.height - FOCUS_MARGIN * 2);
  const fitScale = Math.min(
    MAX_AUTOMATIC_SCALE,
    Math.max(
      MIN_AUTOMATIC_SCALE,
      Math.min(safeWidth / Math.max(1, scene.width), safeHeight / Math.max(1, scene.height)),
    ),
  );

  const sceneExtent = Math.max(scene.width / safeWidth, scene.height / safeHeight);
  const compositionScale = COMPOSITION_TARGET[mode] / Math.max(.001, sceneExtent);
  const readableScale = Math.max(...targets.map((rect) => MIN_READABLE_FOCUS_WIDTH / Math.max(1, rect.width)));
  const scale = Math.min(fitScale, Math.max(MIN_AUTOMATIC_SCALE, readableScale, compositionScale));

  if (scale === current.scale && visibleAt(scene, current, viewport, FOCUS_MARGIN)) return current;
  return centeredCamera(scene, scale, viewport);
}

export function planRevealCamera(
  rect: Rect,
  current: CameraState,
  viewport: ViewportSize,
): CameraState {
  if (visibleAt(rect, current, viewport, REVEAL_MARGIN)) return current;
  let { panX, panY } = current;
  const left = panX + rect.x * current.scale;
  const right = left + rect.width * current.scale;
  const top = panY + rect.y * current.scale;
  const bottom = top + rect.height * current.scale;
  if (left < REVEAL_MARGIN) panX += REVEAL_MARGIN - left;
  else if (right > viewport.width - REVEAL_MARGIN) panX -= right - (viewport.width - REVEAL_MARGIN);
  if (top < REVEAL_MARGIN) panY += REVEAL_MARGIN - top;
  else if (bottom > viewport.height - REVEAL_MARGIN) panY -= bottom - (viewport.height - REVEAL_MARGIN);
  return { panX, panY, scale: current.scale };
}
