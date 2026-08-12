export type Alias = string;
export type LocalReference = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
// Node content remains intentionally extensible in v0.1. Kind-specific content
// schemas will replace this boundary as the visual vocabulary stabilizes.
export type JsonObject = { [key: string]: any };

export type Delivery = "neutral" | "patient" | "encouraging" | "careful" | "emphatic";
export type ActionPhase = "before_speech" | "during_speech" | "after_speech";
export type NodeKind = "text" | "math" | "shape" | "diagram" | "geometry" | "plot" | "image" | "table" | "note";
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

export type AuthoringAction =
  | WriteAction
  | ReviseAction
  | EmphasizeAction
  | ConnectAction
  | GroupAction
  | FocusAction
  | PointAction
  | ExpressionAction;

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
}

export interface AuthoringLesson {
  dsl: "octos.lesson";
  version: "0.1";
  profile: "authoring";
  lesson: {
    mode: "explain";
    language: string;
    title: string;
    goals: string[];
    variables?: AuthoringVariable[];
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
