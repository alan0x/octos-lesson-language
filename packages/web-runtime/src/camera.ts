import type { Rect } from "./layout.js";

/**
 * Keeps learner camera movement authoritative until a genuinely new teaching
 * camera request is applied. Re-rendering the same playback operation and
 * recomputing host insets are not teaching requests.
 */
export class TeachingCameraAuthority {
  private manual = false;
  private boardId?: string;
  private operationId?: string;
  private exclusiveHost = false;

  observeRender(boardId: string | undefined, operationId: string | undefined): boolean {
    const changed = boardId !== this.boardId || operationId !== this.operationId;
    this.boardId = boardId;
    this.operationId = operationId;
    return changed;
  }

  beginManualNavigation(): void {
    this.manual = true;
  }

  /**
   * Keep a host-requested camera position stable across ordinary layout and
   * viewport-inset refreshes. A genuinely new teaching operation may still
   * call resumeTeachingCamera before applying its own focus request.
   */
  holdHostCamera(exclusive = false): void {
    this.manual = true;
    this.exclusiveHost = exclusive;
  }

  resumeTeachingCamera(): boolean {
    if (this.exclusiveHost) return false;
    this.manual = false;
    return true;
  }

  releaseHostCamera(): void {
    this.exclusiveHost = false;
    this.manual = false;
  }

  get layoutReframeAllowed(): boolean {
    return !this.manual;
  }

  reset(): void {
    this.manual = false;
    this.exclusiveHost = false;
    this.boardId = undefined;
    this.operationId = undefined;
  }
}

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
  /** Viewport-local rectangles occupied by floating host UI. */
  occlusions?: ViewportOcclusion[];
}

export interface ViewportOcclusion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AttentionMode = "detail" | "relationship" | "overview" | "course";

const FOCUS_MARGIN = 70;
const REVEAL_MARGIN = FOCUS_MARGIN;
const MIN_READABLE_FOCUS_WIDTH = 240;
const MIN_AUTOMATIC_SCALE = .18;
const MAX_AUTOMATIC_SCALE = 1;

const COMPOSITION_TARGET: Record<AttentionMode, number> = {
  detail: .64,
  relationship: .72,
  overview: .78,
  // Course framing is a navigation boundary, not a teaching close-up. Keep
  // the complete course visible, but do not reserve the broad surrounding
  // context used while a teacher is explaining one diagram.
  course: 1,
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
  const base = {
    left: inset(insets.left) + margin,
    top: inset(insets.top) + margin,
    right: viewport.width - inset(insets.right) - margin,
    bottom: viewport.height - inset(insets.bottom) - margin,
  };
  base.right = Math.max(base.left + 1, base.right);
  base.bottom = Math.max(base.top + 1, base.bottom);
  const occlusions = (insets.occlusions ?? []).flatMap((occlusion) => {
    if (![occlusion.x, occlusion.y, occlusion.width, occlusion.height].every(Number.isFinite)
      || occlusion.width <= 0 || occlusion.height <= 0) return [];
    const left = Math.max(base.left, occlusion.x - margin);
    const top = Math.max(base.top, occlusion.y - margin);
    const right = Math.min(base.right, occlusion.x + occlusion.width + margin);
    const bottom = Math.min(base.bottom, occlusion.y + occlusion.height + margin);
    return right > left && bottom > top ? [{ left, top, right, bottom }] : [];
  });
  if (occlusions.length === 0) {
    return { ...base, width: base.right - base.left, height: base.bottom - base.top };
  }
  const xs = [...new Set([base.left, base.right, ...occlusions.flatMap((item) => [item.left, item.right])])];
  const ys = [...new Set([base.top, base.bottom, ...occlusions.flatMap((item) => [item.top, item.bottom])])];
  let best = { ...base, width: base.right - base.left, height: base.bottom - base.top };
  let bestArea = -1;
  for (const left of xs) for (const right of xs) for (const top of ys) for (const bottom of ys) {
    if (right <= left || bottom <= top) continue;
    const overlaps = occlusions.some((item) => left < item.right && right > item.left
      && top < item.bottom && bottom > item.top);
    if (overlaps) continue;
    const area = (right - left) * (bottom - top);
    if (area > bestArea) {
      bestArea = area;
      best = { left, top, right, bottom, width: right - left, height: bottom - top };
    }
  }
  return best;
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
