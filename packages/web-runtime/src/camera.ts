import type { Rect } from "./layout.js";

export interface CameraState {
  panX: number;
  panY: number;
  scale: number;
}

export interface BoardPoint {
  x: number;
  y: number;
}

/** Convert a point in persistent whiteboard coordinates to viewport-local pixels. */
export function boardToViewportPoint(point: BoardPoint, camera: CameraState): BoardPoint {
  return {
    x: camera.panX + point.x * camera.scale,
    y: camera.panY + point.y * camera.scale,
  };
}

/** Convert viewport-local pixels back to persistent whiteboard coordinates. */
export function viewportToBoardPoint(point: BoardPoint, camera: CameraState): BoardPoint {
  if (!Number.isFinite(camera.scale) || camera.scale <= 0) {
    throw new Error("Camera scale must be a positive finite number");
  }
  return {
    x: (point.x - camera.panX) / camera.scale,
    y: (point.y - camera.panY) / camera.scale,
  };
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
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
  insets: ViewportInsets,
): boolean {
  const safe = safeViewport(viewport, insets, margin);
  const left = camera.panX + rect.x * camera.scale;
  const right = left + rect.width * camera.scale;
  const top = camera.panY + rect.y * camera.scale;
  const bottom = top + rect.height * camera.scale;
  return left >= safe.left
    && right <= safe.right
    && top >= safe.top
    && bottom <= safe.bottom;
}

function inset(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function safeViewport(
  viewport: ViewportSize,
  insets: ViewportInsets,
  margin: number,
): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  const left = inset(insets.left) + margin;
  const top = inset(insets.top) + margin;
  const right = Math.max(left + 1, viewport.width - inset(insets.right) - margin);
  const bottom = Math.max(top + 1, viewport.height - inset(insets.bottom) - margin);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function centeredCamera(
  rect: Rect,
  scale: number,
  viewport: ViewportSize,
  insets: ViewportInsets,
): CameraState {
  const safe = safeViewport(viewport, insets, FOCUS_MARGIN);
  return {
    scale,
    panX: safe.left + safe.width / 2 - (rect.x + rect.width / 2) * scale,
    panY: safe.top + safe.height / 2 - (rect.y + rect.height / 2) * scale,
  };
}

function composedAt(
  rect: Rect,
  camera: CameraState,
  viewport: ViewportSize,
  insets: ViewportInsets,
): boolean {
  const safe = safeViewport(viewport, insets, FOCUS_MARGIN);
  const sceneCenterX = camera.panX + (rect.x + rect.width / 2) * camera.scale;
  const sceneCenterY = camera.panY + (rect.y + rect.height / 2) * camera.scale;
  return Math.abs(sceneCenterX - (safe.left + safe.width / 2)) < 1
    && Math.abs(sceneCenterY - (safe.top + safe.height / 2)) < 1;
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
  insets: ViewportInsets = {},
): CameraState {
  if (!targets.length) return current;
  const scene = unionRects(targets);
  const safe = safeViewport(viewport, insets, FOCUS_MARGIN);
  const safeWidth = safe.width;
  const safeHeight = safe.height;
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

  if (
    Math.abs(scale - current.scale) < .000_001
    && visibleAt(scene, current, viewport, FOCUS_MARGIN, insets)
    && composedAt(scene, current, viewport, insets)
  ) return current;
  return centeredCamera(scene, scale, viewport, insets);
}

export function planRevealCamera(
  rect: Rect,
  current: CameraState,
  viewport: ViewportSize,
  insets: ViewportInsets = {},
): CameraState {
  if (visibleAt(rect, current, viewport, REVEAL_MARGIN, insets)) return current;
  const safe = safeViewport(viewport, insets, REVEAL_MARGIN);
  let { panX, panY } = current;
  const left = panX + rect.x * current.scale;
  const right = left + rect.width * current.scale;
  const top = panY + rect.y * current.scale;
  const bottom = top + rect.height * current.scale;
  if (left < safe.left) panX += safe.left - left;
  else if (right > safe.right) panX -= right - safe.right;
  if (top < safe.top) panY += safe.top - top;
  else if (bottom > safe.bottom) panY -= bottom - safe.bottom;
  return { panX, panY, scale: current.scale };
}
