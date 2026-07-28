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

const FOCUS_MARGIN = 70;
const REVEAL_MARGIN = FOCUS_MARGIN;
const MIN_READABLE_FOCUS_WIDTH = 280;
const AUTOMATIC_ZOOM_IN_THRESHOLD = .45;
const MAX_AUTOMATIC_FOCUS_SCALE = .82;

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

export function planFocusCamera(
  rect: Rect,
  current: CameraState,
  viewport: ViewportSize,
): CameraState {
  const readable = rect.width * current.scale >= MIN_READABLE_FOCUS_WIDTH;
  const comfortable = readable || current.scale >= AUTOMATIC_ZOOM_IN_THRESHOLD;
  if (comfortable && visibleAt(rect, current, viewport, FOCUS_MARGIN)) return current;

  const fitScale = Math.min(
    1,
    Math.max(
      .2,
      Math.min(
        (viewport.width - FOCUS_MARGIN * 2) / Math.max(1, rect.width),
        (viewport.height - FOCUS_MARGIN * 2) / Math.max(1, rect.height),
      ),
    ),
  );
  const readableScale = Math.min(1, MIN_READABLE_FOCUS_WIDTH / Math.max(1, rect.width));
  let scale = current.scale;
  if (scale > fitScale) scale = fitScale;
  else if (
    scale < AUTOMATIC_ZOOM_IN_THRESHOLD
    && scale < readableScale
    && readableScale <= fitScale
  ) {
    scale = Math.min(readableScale, MAX_AUTOMATIC_FOCUS_SCALE);
  }
  return centeredCamera(rect, scale, viewport);
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
