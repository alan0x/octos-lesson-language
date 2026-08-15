export type { ImageAssetResolver, ImageRegionBounds, ResolvedImageAsset } from "./assets.js";
export {
  describeBoardTarget,
  pointInPolygon,
  rankBoardTargets,
  rectIntersection,
  targetQueryScore,
  type BoardTargetCandidate,
  type BoardTargetDescription,
  type BoardTargetKind,
  type BoardTargetPoint,
  type BoardTargetQuery,
} from "./board-targets.js";
export {
  InfiniteBoardView,
  angleControlValue,
  diagramConnectionGeometry,
  mathSource,
  mountInfiniteBoard,
  variableAnimationFocusTargets,
  type BoardInputOwner,
  type CameraListener,
  type DiagramConnectionGeometry,
  type InfiniteBoardElements,
  type MountedInfiniteBoard,
  type VariableInputHandler,
} from "./board-view.js";
export {
  normalizeScene3dView,
  projectScene3dPoint,
  renderScene3d,
  scene3dSectionIntersections,
  type Point3d,
  type Scene3dSectionPath,
  type Scene3dViewControl,
  type Scene3dViewInputEvent,
  type Scene3dViewInputHandler,
  type Scene3dViewPhase,
  type Scene3dViewState,
} from "./scene3d.js";
export {
  boardToViewportPoint,
  viewportToBoardPoint,
  type BoardPoint,
  type CameraState,
  type ViewportInsets,
  type ViewportSize,
} from "./camera.js";
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
  plotPathData,
  samplePlotExpression,
  type PlotRange,
  type PlotSample,
} from "./plot.js";
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
  createStudentInkSelectionOperation,
  createStudentScene3dViewOperation,
  emptyStudentOperationLog,
  parseStudentOperationLog,
  studentInputMethod,
  type StudentInputMethod,
  type StudentInkSelectionOperation,
  type StudentInkSelectionSource,
  type StudentOperation,
  type StudentOperationLog,
  type StudentScene3dControl,
  type StudentScene3dViewOperation,
  type StudentScene3dViewState,
  type StudentVariableControl,
  type StudentVariableInputEvent,
  type StudentVariableInputHandler,
  type StudentVariableInputPhase,
  type StudentVariableOperation,
  type StudentVariableOperationContext,
} from "./student-operations.js";
export {
  emptyStudentTaskProgressLog,
  evaluateStudentTaskOperation,
  parseStudentTaskProgressLog,
  taskSnapshots,
  type StudentTaskAttempt,
  type StudentTaskProgress,
  type StudentTaskProgressLog,
  type StudentTaskSnapshot,
  type StudentTaskStatus,
} from "./student-tasks.js";
export {
  VariableControlsView,
  formatVariableValue,
  mountVariableControls,
  variableControlModels,
  type VariableControlModel,
} from "./variable-controls.js";
