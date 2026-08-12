import type {
  BoardPoint,
  CameraState,
  ViewportSize,
} from "../../web-runtime/src/index.js";

export interface InkWorldLayerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function visibleBoardRect(
  camera: CameraState,
  viewport: ViewportSize,
): InkWorldLayerBounds {
  const width = Math.max(1, viewport.width) / camera.scale;
  const height = Math.max(1, viewport.height) / camera.scale;
  return {
    left: -camera.panX / camera.scale,
    top: -camera.panY / camera.scale,
    width,
    height,
  };
}

function contains(
  outer: InkWorldLayerBounds,
  inner: InkWorldLayerBounds,
  guard: number,
): boolean {
  return inner.left - guard >= outer.left
    && inner.top - guard >= outer.top
    && inner.left + inner.width + guard <= outer.left + outer.width
    && inner.top + inner.height + guard <= outer.top + outer.height;
}

/**
 * Keeps the rendered ink surface around the currently visible part of the
 * infinite board. The surface is re-centered only after the camera consumes
 * its buffer, avoiding a canvas resize on every animation frame.
 */
export function planInkWorldLayerBounds(options: {
  camera: CameraState;
  viewport: ViewportSize;
  current?: InkWorldLayerBounds;
}): InkWorldLayerBounds {
  const { camera, viewport, current } = options;
  if (!Number.isFinite(camera.scale) || camera.scale <= 0) {
    throw new Error("Ink world layer requires a positive finite camera scale");
  }
  const visible = visibleBoardRect(camera, viewport);
  const bufferPixels = Math.max(320, Math.min(900, Math.max(viewport.width, viewport.height) * .5));
  const buffer = bufferPixels / camera.scale;
  const guard = Math.min(buffer * .35, 240 / camera.scale);
  if (current && contains(current, visible, guard)) return current;

  const left = Math.floor(visible.left - buffer);
  const top = Math.floor(visible.top - buffer);
  const right = Math.ceil(visible.left + visible.width + buffer);
  const bottom = Math.ceil(visible.top + visible.height + buffer);
  return { left, top, width: right - left, height: bottom - top };
}

/** Converts a viewport-local pointer into the js-draw surface coordinates. */
export function viewportPointToInkSurface(
  point: BoardPoint,
  camera: CameraState,
  bounds: InkWorldLayerBounds,
): BoardPoint {
  const boardX = (point.x - camera.panX) / camera.scale;
  const boardY = (point.y - camera.panY) / camera.scale;
  return { x: boardX - bounds.left, y: boardY - bounds.top };
}
