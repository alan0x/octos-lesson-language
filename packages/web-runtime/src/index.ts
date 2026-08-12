export type { ImageAssetResolver, ImageRegionBounds, ResolvedImageAsset } from "./assets.js";
export {
  InfiniteBoardView,
  diagramConnectionGeometry,
  mathSource,
  mountInfiniteBoard,
  variableAnimationFocusTargets,
  type DiagramConnectionGeometry,
  type InfiniteBoardElements,
  type MountedInfiniteBoard,
} from "./board-view.js";
export type { CameraState, ViewportInsets, ViewportSize } from "./camera.js";
export {
  boundaryPoint,
  computeConnectionRoute,
  connectionLabelWidth,
  routePath,
  stackConnectionLabel,
  type ConnectionRoute,
  type Point,
} from "./connection-layout.js";
export {
  computeBoardLayout,
  measureSemanticNode,
  targetRect,
  type BoardLayout,
  type MeasuredNodeSizes,
  type Rect,
} from "./layout.js";
export {
  BrowserLessonSession,
  LocalPlaybackStore,
  narrationDuration,
  operationDelay,
  parseCanonicalJsonl,
  type BrowserLessonSessionOptions,
  type PlaybackStore,
} from "./runtime.js";
export {
  VariableControlsView,
  formatVariableValue,
  mountVariableControls,
  variableControlModels,
  type VariableControlModel,
} from "./variable-controls.js";
