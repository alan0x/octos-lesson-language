import type { OllNodeKind } from "./capabilities.js";

export type Alias = string;
export type LocalReference = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
// Node content remains intentionally extensible in v0.1. Kind-specific content
// schemas will replace this boundary as the visual vocabulary stabilizes.
export type JsonObject = { [key: string]: any };

export type Delivery = "neutral" | "patient" | "encouraging" | "careful" | "emphatic";
export type ActionPhase = "before_speech" | "during_speech" | "after_speech";
export type NodeKind = OllNodeKind;
export type PlacementRelation = "new_region" | "below" | "above" | "left_of" | "right_of" | "near" | "inside" | "overlay";
export type RegistryEntryType = "node" | "connection" | "group";

export interface Placement {
  relation: PlacementRelation;
  anchor?: Alias;
  region_role?: string;
  align?: "start" | "center" | "end";
  gap?: "compact" | "normal" | "spacious";
}

interface BaseAction {
  when?: ActionPhase;
}

export interface WriteAction extends BaseAction {
  do: "write";
  as: Alias;
  kind: NodeKind;
  role: string;
  content: JsonObject;
  place: Placement;
}

export interface ReviseAction extends BaseAction {
  do: "revise";
  target: LocalReference;
  content: JsonObject;
  reason: string;
}

export interface EmphasizeAction extends BaseAction {
  do: "emphasize";
  target: LocalReference;
  emphasis: string;
}

export interface ConnectAction extends BaseAction {
  do: "connect";
  as: Alias;
  from: LocalReference;
  to: LocalReference;
  relation: string;
  label?: string;
}

export interface GroupAction extends BaseAction {
  do: "group";
  as: Alias;
  role: string;
  label: string;
  members: LocalReference[];
}

export interface FocusAction extends BaseAction {
  do: "focus";
  targets: LocalReference[];
  intent: string;
}

export interface PointAction extends BaseAction {
  do: "point";
  target: LocalReference;
}

export interface ExpressionAction extends BaseAction {
  do: "expression";
  expression: string;
}

export interface AnimateVariableAction extends BaseAction {
  do: "animate";
  variable: string;
  value: number;
  easing?: "linear" | "ease_in_out";
  duration_intent?: "brief" | "normal" | "extended";
}

export type AuthoringAction =
  | WriteAction
  | ReviseAction
  | EmphasizeAction
  | ConnectAction
  | GroupAction
  | FocusAction
  | PointAction
  | ExpressionAction
  | AnimateVariableAction;

export interface AuthoringBeat {
  key: Alias;
  say?: string;
  delivery?: Delivery;
  actions: AuthoringAction[];
}

export interface AuthoringStep {
  key: Alias;
  purpose: string;
  beats: AuthoringBeat[];
}

export interface AuthoringVariable {
  as: string;
  initial: number;
  min: number;
  max: number;
  label?: string;
  unit?: string;
  control?: {
    kind: "slider";
    step?: number;
  };
}

export type StudentTaskVariableControl = "slider" | "geometry_point";

export type StudentTaskScene3dControl = "orbit" | "zoom" | "preset" | "reset";

export type StudentTaskScene3dViewMatch = "view_direction" | "camera_pose";

interface AuthoringStudentTaskBase {
  as: Alias;
  prompt: string;
  availability: {
    kind: "after_lesson";
  };
  hints: string[];
  hint_after_attempts?: number;
  success_message?: string;
}

export interface AuthoringVariableStudentTask extends AuthoringStudentTaskBase {
  allowed_operations: Array<{
    kind: "variable_change";
    variable: string;
    controls: StudentTaskVariableControl[];
  }>;
  completion: {
    kind: "expression_target";
    expression: string;
    value: number;
    tolerance: number;
  };
}

export interface AuthoringScene3dStudentTask extends AuthoringStudentTaskBase {
  allowed_operations: Array<{
    kind: "scene3d_view";
    node: Alias;
    controls: StudentTaskScene3dControl[];
  }>;
  completion: {
    kind: "scene3d_view_target";
    node: Alias;
    match?: StudentTaskScene3dViewMatch;
    yaw: number;
    pitch: number;
    zoom: number;
    angular_tolerance: number;
    zoom_tolerance: number;
  };
}

export type AuthoringStudentTask = AuthoringVariableStudentTask | AuthoringScene3dStudentTask;

export interface AuthoringLesson {
  dsl: "octos.lesson";
  version: "0.1";
  profile: "authoring";
  board_context?: AuthoringBoardContext;
  lesson: {
    mode: "explain";
    language: string;
    title: string;
    goals: string[];
    variables?: AuthoringVariable[];
    tasks?: AuthoringStudentTask[];
    adaptation?: {
      strategies?: string[];
      context_refs?: string[];
    };
  };
  steps: AuthoringStep[];
  close: {
    summary: string;
    focus: LocalReference[];
  };
}

export interface AuthoringExternalBoardReference {
  as: Alias;
  type: RegistryEntryType;
  target_id: string;
  label?: string;
  fragments: Array<{ as: Alias; target_id: string }>;
}

export interface AuthoringBoardContext {
  board_id: string;
  revision: number;
  references: AuthoringExternalBoardReference[];
}

export interface SessionRegion {
  region_id: string;
  label?: string;
  confidence?: string;
}

export interface SessionAsset {
  asset_id: string;
  media_type?: string;
  alt?: string;
  regions?: SessionRegion[];
}

export interface ResourceContext {
  session_id?: string;
  request?: string;
  assets?: SessionAsset[];
}

export interface NormalizationHost {
  lessonId: string;
  boardId: string;
  baseRevision: number;
  regionIntent?: "new_topic" | "continue_topic" | "extend_near_anchor";
  regionId?: string;
  resourceContext?: ResourceContext;
}

export interface RegistryEntry {
  type: RegistryEntryType;
  fragments: Set<string>;
  id?: string;
  external?: boolean;
  fragmentIds?: Map<string, string>;
}

export interface CanonicalTarget {
  node_id?: string;
  fragment_id?: string;
  group_id?: string;
  connection_id?: string;
}

export interface CanonicalAction {
  action_id: string;
  op: string;
  node?: JsonObject & { id: string; content: JsonObject };
  connection?: JsonObject & { id: string };
  group?: JsonObject & { id: string };
  focus?: { targets: string[]; intent: string };
  target?: CanonicalTarget;
  emphasis?: string;
  expression?: string;
  animation?: {
    variable: string;
    to: number;
    easing: "linear" | "ease_in_out";
    duration_intent: "brief" | "normal" | "extended";
  };
  revision?: { content: JsonObject; reason: string };
}

export interface CanonicalEvent {
  dsl: "octos.lesson";
  version: "0.1";
  profile: "canonical";
  event: "lesson.open" | "lesson.step" | "lesson.close";
  lesson_id: string;
  sequence: number;
  board?: {
    board_id: string;
    base_revision: number;
    region_intent: string;
    region_id?: string;
  };
  lesson?: AuthoringLesson["lesson"];
  step?: {
    id: string;
    purpose: string;
    beats: Array<{
      id: string;
      narration?: { text: string; delivery?: Delivery };
      stage: Record<ActionPhase, CanonicalAction[]>;
    }>;
  };
  result?: {
    summary: string;
    summary_node_refs: string[];
    suggested_focus: string[];
  };
}

export interface SemanticBoardState {
  board_id: string;
  revision: number;
  nodes: Record<string, JsonObject & { id: string; content: JsonObject; emphasis?: JsonObject[] }>;
  connections: Record<string, JsonObject & { id: string; emphasis?: JsonObject[] }>;
  groups: Record<string, JsonObject & { id: string; emphasis?: JsonObject[] }>;
  focus: string[];
  applied_lessons: string[];
  applied_steps: string[];
  applied_actions: string[];
  variables?: Record<string, {
    value: number;
    initial: number;
    min: number;
    max: number;
    label?: string;
    unit?: string;
    control?: {
      kind: "slider";
      step?: number;
    };
  }>;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: Array<{
    instancePath: string;
    schemaPath: string;
    keyword: string;
    message: string;
  }>;
}
