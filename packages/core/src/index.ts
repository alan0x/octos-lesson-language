export { regularPolygonGeometry } from "./regular-polygon.js";
export * from "./numeric-answer.js";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import authoringSchema from "../../../schema/authoring/v0.1.schema.json" with { type: "json" };
import {
  compileMathExpression,
  evaluateMathExpression,
  referencedMathVariables,
} from "./math-expression.js";
import { NUMERIC_ROW_LIMITS, isSimplestFraction, numericRowBlankCompletion, parseNumericAnswer } from "./numeric-answer.js";
import { solidFaceKeys, solidFaceTarget } from "./solid-face-targets.js";
import { NUMBER_LINE_KIND, numberLineValue, planNumberLineTicks, validateNumberLineContent, type NumberLineContent } from "../../plugin-math/src/number-line.js";
import { FRACTION_MODEL_KIND, FRACTION_MODEL_PART_FIELDS, validateFractionModelContent } from "../../plugin-math/src/fraction-model.js";
import {
  BASE_TEN_SLIDER_STEP, BASE_TEN_TRADE_KIND, BASE_TEN_TRADE_PART_FIELDS, BASE_TEN_TRADE_PLACES, baseTenBoundField,
  baseTenMat, baseTenSliderPlace, baseTenSliderReachable, validateBaseTenTradeContent, type BaseTenPlaceName,
} from "../../plugin-math/src/base-ten-trade.js";
import { PLACE_VALUE_CHART_KIND, PLACE_VALUE_CHART_PART_FIELDS, validatePlaceValueChartContent } from "../../plugin-math/src/place-value-chart.js";
import { PLACE_VALUE_TRADE_KIND, PLACE_VALUE_TRADE_PART_FIELDS, validatePlaceValueTradeContent } from "../../plugin-math/src/place-value-trade.js";
import { BASE_TEN_TRADE_CARD, TAP_CARD_KIND_NAMES, TAP_CARD_KINDS, lessonTapCardKindList, tapCardKind, tapCardKindList, type TapCardKind } from "./cards.js";
import {
  bindingCapabilitiesForNodeKind,
  cardBindingCapabilitiesForNodeKind,
  OLL_CANONICAL_CARD_BINDING_CAPABILITIES,
  OLL_ACTION_NAMES,
  OLL_CANONICAL_BINDING_CAPABILITIES,
} from "./capabilities.js";
import type {
  ActionPhase,
  AuthoringAction,
  AuthoringLesson,
  AuthoringAnswerStudentTask,
  AuthoringCardStudentTask,
  AuthoringRowStudentTask,
  AuthoringScene3dStudentTask,
  AuthoringStudentTask,
  AuthoringVariableStudentTask,
  CanonicalAction,
  CanonicalEvent,
  CanonicalTarget,
  EmphasizeAction,
  JsonObject,
  NormalizationHost,
  Placement,
  PhaseStartPolicy,
  PointAction,
  AuthoringVariable,
  RegistryEntry,
  RegistryEntryType,
  ResourceContext,
  SchemaValidationResult,
  SemanticBoardState,
  WriteAction,
} from "./types.js";

export type * from "./types.js";
export * from "./math-expression.js";
export * from "./capabilities.js";
export * from "./inline-math.js";
export * from "./spoken-math.js";
export * from "./execution-requirements.js";
export * from "./opening.js";

type UnknownRecord = Record<string, unknown>;
type Registry = Map<string, RegistryEntry>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateAuthoringDocument = ajv.compile(authoringSchema);

const ALIAS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const VARIABLE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED_MATH_NAMES = new Set([
  "abs", "acos", "asin", "atan", "ceil", "cos", "e", "exp", "floor",
  "ln", "log", "pi", "round", "sin", "sqrt", "tan",
]);
const ACTIONS = new Set<AuthoringAction["do"]>(OLL_ACTION_NAMES);
const PHASES = new Set<ActionPhase>(["before_speech", "during_speech", "after_speech"]);
const ANIMATION_EASINGS = new Set(["linear", "ease_in_out"]);
const ANIMATION_DURATION_INTENTS = new Set(["brief", "normal", "extended"]);
/** Solids that open into a net (unfold, player 0.9.0). */
const UNFOLDING_KINDS = new Set(["box", "prism", "pyramid", "cylinder", "cone"]);

/** A convex polygon of 3–12 corners with an area (a prism's or pyramid's base). */
function convexPolygon(base: unknown): boolean {
  if (!Array.isArray(base) || base.length < 3 || base.length > 12) return false;
  if (!base.every((point) => point && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const area = base.reduce((sum, point, index) => { const next = base[(index + 1) % base.length]; return sum + point.x * next.y - next.x * point.y; }, 0) / 2;
  if (Math.abs(area) < 1e-9) return false;
  return base.every((point, index) => {
    const next = base[(index + 1) % base.length], after = base[(index + 2) % base.length];
    return Math.sign(area) * ((next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x)) > -1e-9;
  });
}

/** 3D solids with a center and a radius (and, per kind, height, sides, top_radius or tube). */
const SOLID_KINDS = new Set(["sphere", "cylinder", "cone", "prism", "pyramid", "frustum", "hemisphere", "torus", "tetrahedron", "octahedron", "dodecahedron", "icosahedron"]);

const PLACEMENT_RELATIONS = new Set(["new_region", "below", "above", "left_of", "right_of", "near", "inside", "overlay", "annotates", "replaces", "continues"]);
const ACTION_FIELDS = new Set([
  "do", "when", "as", "kind", "role", "content", "place", "target",
  "from", "to", "relation", "label", "emphasis", "members", "targets",
  "intent", "expression", "reason",
  "variable", "value", "easing", "duration_intent", "source", "show", "preset", "tap", "at",
]);

export class OllError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(message);
    this.name = "OllError";
    this.code = code;
    this.path = path;
  }
}

function fail(code: string, path: string, message: string): never {
  throw new OllError(code, path, message);
}

function requireObject(value: unknown, path: string): asserts value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("OLL_INVALID_TYPE", path, "Expected an object");
  }
}

function requireArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("OLL_INVALID_TYPE", path, "Expected a non-empty array");
  }
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    fail("OLL_INVALID_TYPE", path, "Expected a non-empty string");
  }
}

function requireAlias(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !ALIAS_PATTERN.test(value)) {
    fail("OLL_INVALID_ALIAS", path, `Invalid local alias '${String(value)}'`);
  }
}

function requireVariableAlias(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !VARIABLE_PATTERN.test(value)) {
    fail("OLL_INVALID_VARIABLE", path, `Invalid variable alias '${String(value)}'`);
  }
}

// A learner-taught lesson names its learner author; any other lesson must not
// claim one, so lesson modes cannot be mixed up by a generator or a host.
function validateLessonAuthor(document: AuthoringLesson): void {
  const { mode, author } = document.lesson;
  if (mode !== "explain" && mode !== "learner_taught") {
    fail("OLL_INVALID_OPERATION_PAYLOAD", "/lesson/mode", `Unknown lesson mode '${String(mode)}'`);
  }
  if (mode === "learner_taught" && !author) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", "/lesson/author", "A learner-taught lesson must name its learner author");
  }
  if (mode !== "learner_taught" && author) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", "/lesson/author", "Only learner-taught lessons have a learner author");
  }
}

function isLearnerTaught(document: AuthoringLesson): boolean {
  return document.lesson.mode === "learner_taught";
}

function validateLessonVariables(document: AuthoringLesson): Map<string, number> {
  const values = new Map<string, number>();
  for (const [index, variable] of (document.lesson.variables ?? []).entries()) {
    const path = `/lesson/variables/${index}`;
    requireObject(variable, path);
    requireVariableAlias(variable.as, `${path}/as`);
    if (RESERVED_MATH_NAMES.has(variable.as)) fail("OLL_INVALID_VARIABLE", `${path}/as`, `Variable '${variable.as}' uses a reserved math name`);
    if (values.has(variable.as)) fail("OLL_DUPLICATE_ALIAS", `${path}/as`, `Variable '${variable.as}' is duplicated`);
    const initial = requireFiniteNumber(variable.initial, `${path}/initial`);
    const min = requireFiniteNumber(variable.min, `${path}/min`);
    const max = requireFiniteNumber(variable.max, `${path}/max`);
    if (max <= min) fail("OLL_INVALID_VARIABLE", path, "Variable max must be greater than min");
    if (initial < min || initial > max) fail("OLL_INVALID_VARIABLE", `${path}/initial`, "Variable initial value is outside its range");
    if (variable.wrap !== undefined && variable.wrap !== true) fail("OLL_INVALID_VARIABLE", `${path}/wrap`, "Variable wrap must be true when present");
    if (variable.control?.step !== undefined) {
      const step = requireFiniteNumber(variable.control.step, `${path}/control/step`);
      if (step <= 0 || step > max - min) fail("OLL_INVALID_VARIABLE", `${path}/control/step`, "Slider step must be greater than zero and no larger than the variable range");
    }
    values.set(variable.as, initial);
  }
  return values;
}

function scene3dViewDirection(
  view: { yaw: number; pitch: number },
): { x: number; y: number; z: number } {
  const cosPitch = Math.cos(view.pitch);
  return {
    x: cosPitch * Math.sin(view.yaw),
    y: cosPitch * Math.cos(view.yaw),
    z: Math.sin(view.pitch),
  };
}

const SCENE3D_PRESET_VIEWS = {
  front: { yaw: 0, pitch: 0 },
  side: { yaw: Math.PI / 2, pitch: 0 },
  top: { yaw: 0, pitch: Math.PI / 2 },
  isometric: { yaw: 0.72, pitch: 0.55 },
} as const;

/**
 * The camera a 3D view intent turns a scene to. A preset is a named direction;
 * showing a highlighted part looks at it from the side it faces, measured from
 * the centre of the scene's objects. Zoom is kept, and an intent that names no
 * direction (a part at the centre) keeps the current view.
 */
export function scene3dViewForIntent(
  content: JsonObject,
  intent: { show?: { fragment_id?: string }; preset?: keyof typeof SCENE3D_PRESET_VIEWS },
  current: { yaw: number; pitch: number; zoom: number },
): { yaw: number; pitch: number; zoom: number } {
  if (intent.preset) return { ...SCENE3D_PRESET_VIEWS[intent.preset], zoom: current.zoom };
  const highlight = ((content.highlights ?? []) as JsonObject[]).find((candidate) => candidate.id === intent.show?.fragment_id);
  const points = (highlight?.points ?? []) as Array<{ x: number; y: number; z: number }>;
  if (!points.length) return { ...current };
  const average = (values: Array<{ x: number; y: number; z: number }>) => values.reduce(
    (sum, point) => ({ x: sum.x + point.x / values.length, y: sum.y + point.y / values.length, z: sum.z + point.z / values.length }),
    { x: 0, y: 0, z: 0 },
  );
  const centres = ((content.objects ?? []) as JsonObject[]).map((object) => object.center).filter(Boolean) as Array<{ x: number; y: number; z: number }>;
  const centre = centres.length ? average(centres) : { x: 0, y: 0, z: 0 };
  const part = average(points);
  const direction = { x: part.x - centre.x, y: part.y - centre.y, z: part.z - centre.z };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-9) return { ...current };
  const pitch = Math.asin(Math.max(-1, Math.min(1, direction.z / length)));
  const horizontal = Math.hypot(direction.x, direction.y);
  // Straight above or below, square the part to the screen as the top preset does.
  const yaw = horizontal < 1e-9 ? 0 : Math.atan2(direction.x, direction.y);
  return { yaw, pitch, zoom: current.zoom };
}

/**
 * Score a visible 3D camera result against a lesson task. A score at or below
 * one completes the task. `view_direction` only compares the camera's sight
 * line, so yaw naturally stops mattering at a top or bottom view and zoom never
 * becomes a hidden requirement. The omitted legacy mode remains `camera_pose`
 * for backwards compatibility with existing OLL.
 */
export function scene3dViewTargetScore(
  view: { yaw: number; pitch: number; zoom: number },
  target: AuthoringScene3dStudentTask["completion"],
): number {
  let angularDistance: number;
  if (target.match === "view_direction") {
    const actual = scene3dViewDirection(view);
    const expected = scene3dViewDirection(target);
    const dot = Math.max(-1, Math.min(1,
      actual.x * expected.x + actual.y * expected.y + actual.z * expected.z));
    return Math.acos(dot) / target.angular_tolerance;
  }
  const yawDistance = Math.abs(Math.atan2(
    Math.sin(view.yaw - target.yaw),
    Math.cos(view.yaw - target.yaw),
  ));
  angularDistance = Math.max(yawDistance, Math.abs(view.pitch - target.pitch));
  return Math.max(
    angularDistance / target.angular_tolerance,
    Math.abs(view.zoom - target.zoom) / target.zoom_tolerance,
  );
}

function validateScene3dStudentTask(
  task: AuthoringScene3dStudentTask,
  path: string,
  scene3dCameras: Map<string, { yaw: number; pitch: number; zoom: number }>,
): void {
  const completion = task.completion;
  requireAlias(completion.node, `${path}/completion/node`);
  const initial = scene3dCameras.get(completion.node);
  if (!initial) fail("OLL_REFERENCE_NOT_FOUND", `${path}/completion/node`, `3D scene '${completion.node}' is not declared`);
  const target = {
    kind: "scene3d_view_target" as const,
    node: completion.node,
    ...(completion.match ? { match: completion.match } : {}),
    yaw: requireFiniteNumber(completion.yaw, `${path}/completion/yaw`),
    pitch: requireFiniteNumber(completion.pitch, `${path}/completion/pitch`),
    zoom: requireFiniteNumber(completion.zoom, `${path}/completion/zoom`),
    angular_tolerance: requireFiniteNumber(
      completion.angular_tolerance,
      `${path}/completion/angular_tolerance`,
    ),
    zoom_tolerance: requireFiniteNumber(
      completion.zoom_tolerance,
      `${path}/completion/zoom_tolerance`,
    ),
  };
  const angularTolerance = target.angular_tolerance;
  const zoomTolerance = target.zoom_tolerance;
  if (completion.match !== undefined
    && completion.match !== "view_direction"
    && completion.match !== "camera_pose") {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/match`, `Unsupported 3D view match '${String(completion.match)}'`);
  }
  if (target.pitch < -Math.PI / 2 || target.pitch > Math.PI / 2
    || target.zoom < .2 || target.zoom > 5) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion`, "3D target view is outside the supported camera range");
  }
  if (angularTolerance <= 0 || angularTolerance > Math.PI
    || zoomTolerance <= 0 || zoomTolerance > 4.8) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion`, "3D task tolerances must be positive and within the camera range");
  }
  requireArray(task.allowed_operations, `${path}/allowed_operations`);
  const controls = new Set<string>();
  task.allowed_operations.forEach((operation, operationIndex) => {
    const operationPath = `${path}/allowed_operations/${operationIndex}`;
    requireObject(operation, operationPath);
    if (operation.kind !== "scene3d_view" || operation.node !== completion.node) {
      fail("OLL_INVALID_STUDENT_TASK", operationPath, "3D view tasks must reference the completion scene");
    }
    requireArray(operation.controls, `${operationPath}/controls`);
    operation.controls.forEach((control, controlIndex) => {
      if (!["orbit", "zoom", "preset", "reset"].includes(String(control))) {
        fail("OLL_INVALID_STUDENT_TASK", `${operationPath}/controls/${controlIndex}`, `Unsupported 3D task control '${String(control)}'`);
      }
      if (controls.has(String(control))) {
        fail("OLL_INVALID_STUDENT_TASK", `${operationPath}/controls/${controlIndex}`, `3D task control '${String(control)}' is duplicated`);
      }
      controls.add(String(control));
    });
  });
  if (scene3dViewTargetScore(initial!, target) <= 1) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion`, "3D task is already complete at the initial camera view");
  }
  const presets = [
    { yaw: .72, pitch: .55, zoom: 1 },
    { yaw: 0, pitch: 0, zoom: 1 },
    { yaw: 0, pitch: Math.PI / 2, zoom: 1 },
  ];
  const presetReachable = controls.has("preset") && presets.some(
    (preset) => scene3dViewTargetScore(preset, target) <= 1,
  );
  const orbitReachable = controls.has("orbit")
    && (target.match === "view_direction"
      || Math.abs(initial!.zoom - target.zoom) <= zoomTolerance
      || controls.has("zoom"));
  const zoomOnlyReachable = controls.has("zoom")
    && scene3dViewTargetScore(
      { ...initial!, zoom: target.zoom },
      target,
    ) <= 1;
  if (!presetReachable && !orbitReachable && !zoomOnlyReachable) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/allowed_operations`, "No allowed 3D control can reach the target view");
  }
  validateTaskFeedback(task, path);
}

function validateAnswerStudentTask(task: AuthoringAnswerStudentTask, path: string, registry: Registry, feedback = true): void {
  resolveLocal(registry, task.anchor, `${path}/anchor`, ["node"]);
  requireArray(task.allowed_operations, `${path}/allowed_operations`);
  if (task.allowed_operations.length !== 1 || task.allowed_operations[0]?.kind !== "answer_entry") {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/allowed_operations`, "Numeric answer tasks allow exactly one answer_entry operation");
  }
  const completion = task.completion;
  const expected = typeof completion.answer === "string" ? parseNumericAnswer(completion.answer) : undefined;
  if (!expected) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/answer`, "Expected answer must be a whole number, decimal, fraction or mixed number");
  }
  if (completion.tolerance !== undefined
    && (requireFiniteNumber(completion.tolerance, `${path}/completion/tolerance`) < 0)) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/tolerance`, "Answer tolerance must not be negative");
  }
  if (completion.form !== undefined && completion.form !== "any" && completion.form !== "simplest_fraction") {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/form`, `Unsupported answer form '${String(completion.form)}'`);
  }
  if (completion.form === "simplest_fraction" && !isSimplestFraction(expected!)) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/answer`, "Expected answer is not written in its simplest form");
  }
  if (completion.unit !== undefined
    && (typeof completion.unit !== "string" || !completion.unit.trim() || completion.unit.length > 16)) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/unit`, "Answer unit must be 1 to 16 characters");
  }
  if (feedback) validateTaskFeedback(task, path);
}

/**
 * The fields of a trading card a tap writes, each to its own lesson variable (decision 0023): every
 * count, and every tray below the highest column, bound to a bare declared variable that runs from 0 to
 * exactly the most the mat draws, so no tap can leave a variable's range or the mat. Returns the
 * variable of each field, keyed `ones.count`, `ones.tray`, ….
 */
export function baseTenTapVariables(
  content: JsonObject,
  declarations: readonly AuthoringVariable[],
  path: string,
  /** Who writes the fields, for the messages: a tap, or a slider on a count (decision 0023 amendment 4). */
  writer = "Tapping a card",
): Map<string, string> {
  return cardTapVariables(BASE_TEN_TRADE_CARD, content, declarations, path, writer);
}

/**
 * The fields of a tap card a tap writes, each to its own lesson variable: every field the card's kind
 * lists, bound to a bare declared variable whose range is exactly the field's, so no tap can leave a
 * variable's range or the card. Returns the variable of each field, keyed by its binding target, and of
 * each card-level field (the chart's `target`) bound to a bare declared variable of its own.
 */
function cardTapVariables(
  kind: TapCardKind,
  content: JsonObject,
  declarations: readonly AuthoringVariable[],
  path: string,
  writer = "Tapping a card",
): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const binding of (Array.isArray(content.bindings) ? content.bindings : []) as JsonObject[]) {
    if (typeof binding.target === "string" && typeof binding.expression === "string") bindings.set(binding.target, binding.expression.trim());
  }
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const { place, field, min, max } of kind.tapFields(content)) {
    const target = kind.fieldTarget(content, place, field);
    const alias = bindings.get(target);
    const declaration = declarations.find((variable) => variable.as === alias);
    if (!alias || !declaration) {
      fail("OLL_INVALID_STUDENT_TASK", path, `${writer} needs '${target}' bound to its own lesson variable`);
    }
    if (used.has(alias)) fail("OLL_INVALID_STUDENT_TASK", path, `Variable '${alias}' is bound to two fields a tap changes`);
    used.add(alias);
    if (declaration.min !== min || declaration.max !== max || declaration.wrap) {
      fail("OLL_INVALID_STUDENT_TASK", path, `Variable '${alias}' (${target}) must run from ${min} to ${max}, ${kind.kind === BASE_TEN_TRADE_KIND ? "the most a trade can make" : "the most its taps can make"}`);
    }
    result.set(target, alias);
  }
  // A card-level field taps never change (the number a chart shows), when it is bound: its own variable too.
  for (const field of kind.cardFields ?? []) {
    const alias = bindings.get(field);
    if (alias === undefined) continue;
    if (!declarations.some((variable) => variable.as === alias)) fail("OLL_INVALID_STUDENT_TASK", path, `The card's '${field}' is bound to a lesson variable of its own, not '${alias}'`);
    if (used.has(alias)) fail("OLL_INVALID_STUDENT_TASK", path, `Variable '${alias}' is bound to two fields of the card`);
    used.add(alias);
    result.set(field, alias);
  }
  return result;
}

/** The card's content with its tap variables (and bound card-level fields) at the given values, for checking a starting pile. */
function cardContentAt(kind: TapCardKind, content: JsonObject, variables: Map<string, string>, values: Record<string, number>): JsonObject {
  return kind.contentAt(content, (target) => {
    const alias = variables.get(target);
    return alias !== undefined && values[alias] !== undefined ? values[alias] : undefined;
  });
}

/** A tap card of this lesson: its kind and its content as written. */
interface LessonTapCard { kind: TapCardKind; content: JsonObject }

/** The trading mats among a lesson's tap cards, in the order written: the cards a count slider trades on. */
function matCardContents(cards: ReadonlyMap<string, LessonTapCard>): Map<string, JsonObject> {
  return new Map([...cards].filter(([, card]) => card.kind.kind === BASE_TEN_TRADE_KIND).map(([alias, card]) => [alias, card.content]));
}

function validateCardStudentTask(
  task: AuthoringCardStudentTask,
  path: string,
  registry: Registry,
  cards: ReadonlyMap<string, LessonTapCard>,
  declarations: readonly AuthoringVariable[],
  startValues: Record<string, number>,
  availableControls: Map<string, Set<string>>,
  cardSliders: ReadonlyMap<string, CardSlider>,
): void {
  const completion = task.completion;
  resolveLocal(registry, completion.node, `${path}/completion/node`, ["node"]);
  const card = cards.get(completion.node);
  if (!card) fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/node`, `A card_fact task reads a ${tapCardKindList()} card`);
  const { kind, content } = card;
  const fact = typeof completion.fact === "string" && Object.hasOwn(kind.facts, completion.fact) ? kind.facts[completion.fact] : undefined;
  if (!fact) fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/fact`, `Unsupported card fact '${String(completion.fact)}'`);
  // Each fact names its own fields: only a count names a place and a value (amendment 5).
  for (const key of Object.keys(completion)) {
    if (!["kind", "node", "fact", ...fact.keys].includes(key)) {
      fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/${key}`, `Unknown field '${key}' of a ${completion.fact} card fact`);
    }
  }
  requireArray(task.allowed_operations, `${path}/allowed_operations`);
  // Besides its taps and "done", a card task may let the learner trade with its counts' sliders (amendment 4).
  const operations = task.allowed_operations as Array<{ kind?: unknown; node?: unknown; variable?: unknown; controls?: unknown }>;
  const count = (kind: string) => operations.filter((operation) => operation?.kind === kind).length;
  const sliders = operations.filter((operation) => operation?.kind === "variable_change");
  // A fact the card judges on each tap ends the task on the tap that makes it true: no "done" (decision 0026 §3).
  if (fact.judgedOnTap && (operations.length !== 1 || count("card_tap") !== 1 || operations[0]!.node !== completion.node)) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/allowed_operations`, `A ${completion.fact} task allows only tapping its card (card_tap): the tap that completes the card ends the task, with no "done"`);
  }
  if (!fact.judgedOnTap && (count("card_tap") !== 1 || count("card_submit") !== 1 || count("card_tap") + count("card_submit") + sliders.length !== operations.length
    || operations.some((operation) => operation.kind === "card_tap" && operation.node !== completion.node)
    || sliders.some((operation) => cardSliders.get(String(operation.variable))?.card !== completion.node
      || !Array.isArray(operation.controls) || operation.controls.length !== 1 || operation.controls[0] !== "slider")
    || new Set(sliders.map((operation) => operation.variable)).size !== sliders.length)) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/allowed_operations`, "A card task allows tapping its card (card_tap) and saying done (card_submit), and may allow a slider on its counts (variable_change with controls [\"slider\"]), nothing else");
  }
  const variables = cardTapVariables(kind, content, declarations, `${path}/completion/node`);
  // Only taps and the card's own trade sliders change its counts while its task is open (review of #87;
  // amendment 4), so a tap never meets a pile its rules do not keep, and no count leaves its range.
  for (const alias of variables.values()) {
    if ((declarations.find((variable) => variable.as === alias)?.control || availableControls.get(alias)?.size) && cardSliders.get(alias)?.card !== completion.node) {
      fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/node`, `Variable '${alias}' is changed only by tapping the card; it cannot have its own control`);
    }
  }
  // The task starts on its own practice pile, so it never opens on whatever the lesson left (review of #87).
  if (!task.start) fail("OLL_INVALID_PHASE_START", `${path}/start`, "A card task gives the learner's practice pile in start");
  const initial = Object.fromEntries(declarations.map((variable) => [variable.as, variable.initial]));
  const failAt = (message: string, where: string) => (failPath: string, detail: string): never =>
    fail("OLL_INVALID_STUDENT_TASK", where, `${message}: ${detail} (${failPath.replace(/^\$\//, "")})`);
  kind.validateContent(cardContentAt(kind, content, variables, initial), "$", failAt("The lesson's pile is not a starting pile", `${path}/completion/node`));
  if (task.start) {
    const selected = new Set(task.start.variables ?? []);
    const missing = [...variables.values()].filter((alias) => !selected.has(alias));
    if (missing.length) fail("OLL_INVALID_PHASE_START", `${path}/start/variables`, `A card task's practice pile sets every ${kind.kind === BASE_TEN_TRADE_KIND ? "count and tray" : "field the card binds"}; missing ${missing.join(", ")}`);
    const practice = cardContentAt(kind, content, variables, { ...initial, ...startValues });
    kind.validateContent(practice, "$", failAt("The practice pile is not a starting pile", `${path}/start/values`));
    kind.validateStart?.(kind.state(practice), (message) => fail("OLL_INVALID_PHASE_START", `${path}/start/values`, `The practice pile is not a starting pile: ${message}`));
    // The task's problem is its own: never the number the lesson showed (decision 0025 §4), nor the pair (0026 §5).
    const own = kind.practiceFields ?? kind.cardFields ?? [];
    for (const field of own) {
      if (variables.get(field) === undefined) fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/node`, `A card task starts on its own ${field}: bind the card's '${field}' to a lesson variable the task's start sets`);
    }
    if (own.length && own.every((field) => startValues[variables.get(field)!] === initial[variables.get(field)!])) {
      const values = own.map((field) => `${variables.get(field)} = ${startValues[variables.get(field)!]}`).join(", ");
      fail("OLL_INVALID_PHASE_START", `${path}/start/values`, own.length === 1
        ? `The task's ${own[0]} (${values}) is the lesson's own; a practice task starts on another`
        : `The task's ${own.join(" and ")} (${values}) are the lesson's own; a practice task starts on another ${own.length === 2 ? "pair" : "problem"}`);
    }
  }
  // The fact's own target, checked against the practice pile by the card's rules (a count: amendment 5).
  fact.validate?.(completion, kind.state(cardContentAt(kind, content, variables, { ...initial, ...startValues })),
    (field, message) => fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/${field}`, message));
  validateTaskFeedback(task, path);
}

/** A row of blanks (decision 0023 amendment 1): fixed text and one to six blanks, each a numeric answer. */
function validateRowStudentTask(task: AuthoringRowStudentTask, path: string, registry: Registry): void {
  resolveLocal(registry, task.anchor, `${path}/anchor`, ["node"]);
  requireArray(task.allowed_operations, `${path}/allowed_operations`);
  if (task.allowed_operations.length !== 1 || task.allowed_operations[0]?.kind !== "row_entry") {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/allowed_operations`, "A row task allows exactly one row_entry operation");
  }
  const parts = task.completion.parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > NUMERIC_ROW_LIMITS.parts) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/parts`, `A row has 1 to ${NUMERIC_ROW_LIMITS.parts} parts`);
  }
  const names = new Set<string>();
  parts.forEach((part, index) => {
    const at = `${path}/completion/parts/${index}`;
    requireObject(part, at);
    const keys = Object.keys(part);
    if (keys.length !== 1 || (keys[0] !== "text" && keys[0] !== "blank")) fail("OLL_INVALID_STUDENT_TASK", at, "A row part is either text or a blank");
    if ("text" in part) {
      if (typeof part.text !== "string" || !part.text.trim() || part.text.length > NUMERIC_ROW_LIMITS.text) {
        fail("OLL_INVALID_STUDENT_TASK", `${at}/text`, `Row text is 1 to ${NUMERIC_ROW_LIMITS.text} characters`);
      }
      return;
    }
    const blank = part.blank;
    requireObject(blank, `${at}/blank`);
    for (const key of Object.keys(blank)) {
      if (!["as", "answer", "tolerance", "unit", "form", "label"].includes(key)) fail("OLL_INVALID_STUDENT_TASK", `${at}/blank/${key}`, `Unknown blank field '${key}'`);
    }
    requireAlias(blank.as, `${at}/blank/as`);
    if (names.has(blank.as)) fail("OLL_DUPLICATE_ALIAS", `${at}/blank/as`, `Blank '${blank.as}' is duplicated`);
    names.add(blank.as);
    // Each blank is a numeric answer: the same rules, so it is checked the same way.
    validateAnswerStudentTask({ ...task, anchor: task.anchor, allowed_operations: [{ kind: "answer_entry" }], completion: numericRowBlankCompletion(blank) } as AuthoringAnswerStudentTask, `${at}/blank`, registry, false);
    if (blank.label !== undefined && (typeof blank.label !== "string" || !blank.label.trim() || blank.label.length > NUMERIC_ROW_LIMITS.label)) {
      fail("OLL_INVALID_STUDENT_TASK", `${at}/blank/label`, `A blank's label is 1 to ${NUMERIC_ROW_LIMITS.label} characters`);
    }
    // A label names the blank in words; a digit in it could be the number the learner should find (review of #91).
    if (typeof blank.label === "string" && /[0-9０-９]/u.test(blank.label)) {
      fail("OLL_INVALID_STUDENT_TASK", `${at}/blank/label`, "A blank's label is words only, never a number");
    }
  });
  if (names.size < 1 || names.size > NUMERIC_ROW_LIMITS.blanks) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/parts`, `A row has 1 to ${NUMERIC_ROW_LIMITS.blanks} blanks`);
  }
  validateTaskFeedback(task, path);
}

function validateTaskFeedback(task: AuthoringStudentTask, path: string): void {
  requireArray(task.hints, `${path}/hints`);
  if (task.hints.some((hint) => typeof hint !== "string" || !hint.trim())) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/hints`, "Task hints must not be empty");
  }
  if (task.hint_after_attempts !== undefined
    && (!Number.isInteger(task.hint_after_attempts)
      || task.hint_after_attempts < 1 || task.hint_after_attempts > 20)) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/hint_after_attempts`, "hint_after_attempts must be an integer from 1 to 20");
  }
  if (task.success_message !== undefined
    && (typeof task.success_message !== "string" || !task.success_message.trim())) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/success_message`, "Task success_message must not be empty");
  }
}

export function resolvePhaseStart(
  policy: PhaseStartPolicy,
  variables: readonly AuthoringVariable[],
  path: string,
): Record<string, number> {
  requireObject(policy, path);
  if (Object.keys(policy).some(key => !["kind", "variables", "values"].includes(key))) {
    fail("OLL_INVALID_PHASE_START", path, "Unknown phase start field");
  }
  if (policy.kind === "continue") {
    if (policy.variables !== undefined || policy.values !== undefined) fail("OLL_INVALID_PHASE_START", path, "Continuation inherits state without reset targets");
    return {};
  }
  if (policy.kind !== "replay" && policy.kind !== "practice") fail("OLL_INVALID_PHASE_START", path, "Unknown phase kind");
  if (!Array.isArray(policy.variables) || !policy.variables.length || new Set(policy.variables).size !== policy.variables.length) {
    fail("OLL_INVALID_PHASE_START", path, "Independent phases require distinct selected variables");
  }
  if (policy.values !== undefined) requireObject(policy.values, `${path}/values`);
  if (Object.keys(policy.values ?? {}).some(alias => !policy.variables!.includes(alias))) {
    fail("OLL_INVALID_PHASE_START", path, "Start values must belong to selected variables");
  }
  return Object.fromEntries(policy.variables.map(alias => {
    const variable = variables.find(candidate => candidate.as === alias);
    if (!variable) fail("OLL_INVALID_PHASE_START", path, `Unknown start variable '${alias}'`);
    const value = policy.values && Object.hasOwn(policy.values, alias) ? policy.values[alias] : variable.initial;
    if (!Number.isFinite(value) || value < variable.min || value > variable.max) {
      fail("OLL_INVALID_PHASE_START", path, `Start value for '${alias}' is outside its domain`);
    }
    return [alias, value];
  }));
}

function validateReflections(document: AuthoringLesson, registry: Registry): void {
  const reflections = document.lesson.reflections;
  if (reflections === undefined) return;
  requireArray(reflections, "/lesson/reflections");
  const taskAliases = new Set((document.lesson.tasks ?? []).map((task) => task.as));
  const aliases = new Set<string>();
  reflections.forEach((reflection, index) => {
    const path = `/lesson/reflections/${index}`;
    requireObject(reflection, path);
    requireAlias(reflection.as, `${path}/as`);
    if (aliases.has(reflection.as) || taskAliases.has(reflection.as)) {
      fail("OLL_DUPLICATE_ALIAS", `${path}/as`, `Reflection '${reflection.as}' is duplicated`);
    }
    aliases.add(reflection.as);
    for (const field of ["prompt", "answer"] as const) {
      if (typeof reflection[field] !== "string" || !reflection[field].trim()) {
        fail("OLL_INVALID_REFLECTION", `${path}/${field}`, `Reflection ${field} must not be empty`);
      }
    }
    requireObject(reflection.availability, `${path}/availability`);
    if (reflection.availability.kind !== "after_lesson") {
      fail("OLL_INVALID_REFLECTION", `${path}/availability/kind`, `Unsupported reflection availability '${String(reflection.availability.kind)}'`);
    }
    resolveLocal(registry, reflection.anchor, `${path}/anchor`, ["node"]);
  });
}

/** A lesson variable whose slider moves a card's count by trades (decision 0023 amendment 4). */
interface CardSlider { card: string; place: number }

/**
 * The lesson variables that take a slider on a card's count (amendment 4). A variable bound bare to a
 * trading card's field may have a control only as such a slider: on the count of a place with a tray, of
 * step ten, and no other control; the card then has every count and tray bound, since each stop is a trade.
 */
function cardSliderVariables(
  document: AuthoringLesson,
  contents: ReadonlyMap<string, JsonObject>,
  availableControls: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, CardSlider> {
  const sliders = new Map<string, CardSlider>();
  const declarations = document.lesson.variables ?? [];
  for (const [card, content] of contents) {
    for (const [index, declaration] of declarations.entries()) {
      const bound = baseTenBoundField(content, declaration.as);
      const controls = [...(availableControls.get(declaration.as) ?? [])];
      if (!bound || (!declaration.control && !controls.length)) continue;
      const path = `/lesson/variables/${index}`;
      const target = `${BASE_TEN_TRADE_PLACES[bound.place]}.${bound.field}`;
      const place = baseTenSliderPlace(content, declaration.as);
      if (place === undefined) {
        fail("OLL_INVALID_VARIABLE", path, `Variable '${declaration.as}' (${target}) cannot have a control: only the count of a place with a tray takes a slider, and it moves by trades`);
      }
      if (declaration.control?.kind !== "slider" || declaration.control.step !== BASE_TEN_SLIDER_STEP || controls.some((control) => control !== "slider")) {
        fail("OLL_INVALID_VARIABLE", path, `Variable '${declaration.as}' (${target}) takes only a slider of step ${BASE_TEN_SLIDER_STEP}: each stop is one trade`);
      }
      if (sliders.has(declaration.as)) fail("OLL_INVALID_VARIABLE", path, `Variable '${declaration.as}' is a count of two cards; a slider trades on one card`);
      baseTenTapVariables(content, declarations, path, "A slider on a card's count");
      sliders.set(declaration.as, { card, place });
    }
  }
  return sliders;
}

/**
 * Checks an expression task on a card's count sliders and returns every pile they can make by trades from
 * the task's practice pile, which it must give in `start`, as tap-variable values.
 */
function cardSliderTask(
  task: AuthoringVariableStudentTask,
  path: string,
  allowedVariables: ReadonlySet<string>,
  cardSliders: ReadonlyMap<string, CardSlider>,
  contents: ReadonlyMap<string, JsonObject>,
  declarations: readonly AuthoringVariable[],
  startValues: Record<string, number>,
): { piles: Array<Record<string, number>> } {
  const cards = new Set([...allowedVariables].map((alias) => cardSliders.get(alias)?.card));
  if (cards.size !== 1 || cards.has(undefined)) {
    fail("OLL_INVALID_STUDENT_TASK", `${path}/allowed_operations`, "A task on a card's count sliders allows only sliders on that card's counts");
  }
  for (const operation of task.allowed_operations) {
    if (operation.controls.length !== 1 || operation.controls[0] !== "slider") {
      fail("OLL_INVALID_STUDENT_TASK", `${path}/allowed_operations`, "A card's count is moved only by its slider");
    }
  }
  const content = contents.get([...cards][0]!)!;
  const variables = baseTenTapVariables(content, declarations, `${path}/allowed_operations`, "A slider on a card's count");
  // The task starts on its own practice pile, as a card task does (review of #87, of #99): the pile the lesson
  // leaves is not the lesson's initial one once the lesson taps, so a target is only checked from a known pile.
  if (!task.start) fail("OLL_INVALID_PHASE_START", `${path}/start`, "A task on a card's count sliders gives the learner's practice pile in start");
  const missing = [...variables.values()].filter((alias) => !Object.hasOwn(startValues, alias));
  if (missing.length) fail("OLL_INVALID_PHASE_START", `${path}/start/variables`, `A card task's practice pile sets every count and tray; missing ${missing.join(", ")}`);
  const values = { ...Object.fromEntries(declarations.map((variable) => [variable.as, variable.initial])), ...startValues };
  const pile = cardContentAt(BASE_TEN_TRADE_CARD, content, variables, values);
  validateBaseTenTradeContent(pile, "$", (failPath, detail) => fail("OLL_INVALID_STUDENT_TASK", `${path}/start/values`,
    `The task's starting pile is not a starting pile: ${detail} (${failPath.replace(/^\$\//, "")})`));
  const places = [...allowedVariables].map((alias) => cardSliders.get(alias)!.place);
  const piles = baseTenSliderReachable(baseTenMat(pile), places).map((mat) => Object.fromEntries([...variables].map(([target, alias]) => {
    const [name, field] = target.split(".") as [BaseTenPlaceName, "count" | "tray"];
    const p = BASE_TEN_TRADE_PLACES.indexOf(name);
    return [alias, field === "count" ? mat.counts[p]! : mat.trays[p]!];
  })));
  return { piles };
}

function validateStudentTasks(
  document: AuthoringLesson,
  variables: Map<string, number>,
  availableControls: Map<string, Set<string>>,
  scene3dCameras: Map<string, { yaw: number; pitch: number; zoom: number }>,
  registry: Registry,
  numberLineGrids: Map<string, NumberLineContent> = new Map(),
  tapCards: ReadonlyMap<string, LessonTapCard> = new Map(),
  cardSliders: ReadonlyMap<string, CardSlider> = new Map(),
): void {
  // Sliders on a card's count are the trading mat's own (amendment 4).
  const matContents = matCardContents(tapCards);
  const taskAliases = new Set<string>();
  for (const [index, task] of (document.lesson.tasks ?? []).entries()) {
    const path = `/lesson/tasks/${index}`;
    requireObject(task, path);
    requireAlias(task.as, `${path}/as`);
    if (taskAliases.has(task.as)) fail("OLL_DUPLICATE_ALIAS", `${path}/as`, `Student task '${task.as}' is duplicated`);
    taskAliases.add(task.as);
    if (typeof task.prompt !== "string" || !task.prompt.trim()) {
      fail("OLL_INVALID_STUDENT_TASK", `${path}/prompt`, "Student task prompt must not be empty");
    }
    requireObject(task.availability, `${path}/availability`);
    if (task.availability.kind !== "after_lesson") {
      fail("OLL_INVALID_STUDENT_TASK", `${path}/availability/kind`, `Unsupported task availability '${String(task.availability.kind)}'`);
    }
    requireObject(task.completion, `${path}/completion`);
    if (task.start && (task.start.kind !== "practice" || (task.completion.kind !== "expression_target" && task.completion.kind !== "card_fact"))) {
      fail("OLL_INVALID_PHASE_START", `${path}/start`, "Practice starts currently require an expression or card task");
    }
    const startValues = task.start ? resolvePhaseStart(task.start, document.lesson.variables ?? [], `${path}/start`) : {};

    if (task.completion.kind === "scene3d_view_target") {
      validateScene3dStudentTask(task as AuthoringScene3dStudentTask, path, scene3dCameras);
      continue;
    }
    if (task.completion.kind === "numeric_answer") {
      validateAnswerStudentTask(task as AuthoringAnswerStudentTask, path, registry);
      continue;
    }
    if ((task.completion.kind as string) === "numeric_row") {
      validateRowStudentTask(task as AuthoringRowStudentTask, path, registry);
      continue;
    }
    if (task.completion.kind === "card_fact") {
      validateCardStudentTask(task as AuthoringCardStudentTask, path, registry, tapCards, document.lesson.variables ?? [], startValues, availableControls, cardSliders);
      continue;
    }
    const expressionTask = task as AuthoringVariableStudentTask;
    requireArray(expressionTask.allowed_operations, `${path}/allowed_operations`);
    const allowedVariables = new Set<string>();
    expressionTask.allowed_operations.forEach((operation, operationIndex) => {
      const operationPath = `${path}/allowed_operations/${operationIndex}`;
      requireObject(operation, operationPath);
      if (operation.kind !== "variable_change") {
        fail("OLL_INVALID_STUDENT_TASK", `${operationPath}/kind`, `Unsupported student task operation '${String(operation.kind)}'`);
      }
      requireVariableAlias(operation.variable, `${operationPath}/variable`);
      if (!variables.has(operation.variable)) {
        fail("OLL_REFERENCE_NOT_FOUND", `${operationPath}/variable`, `Variable '${operation.variable}' is not declared`);
      }
      if (allowedVariables.has(operation.variable)) {
        fail("OLL_INVALID_STUDENT_TASK", `${operationPath}/variable`, `Variable '${operation.variable}' has duplicate allowed-operation entries`);
      }
      allowedVariables.add(operation.variable);
      requireArray(operation.controls, `${operationPath}/controls`);
      const controls = new Set<string>();
      operation.controls.forEach((control, controlIndex) => {
        if (control !== "slider" && control !== "geometry_point" && control !== "number_line_point") {
          fail("OLL_INVALID_STUDENT_TASK", `${operationPath}/controls/${controlIndex}`, `Unsupported task control '${String(control)}'`);
        }
        if (controls.has(control)) {
          fail("OLL_INVALID_STUDENT_TASK", `${operationPath}/controls/${controlIndex}`, `Task control '${control}' is duplicated`);
        }
        if (!availableControls.get(operation.variable)?.has(control)) {
          fail(
            "OLL_INVALID_STUDENT_TASK",
            `${operationPath}/controls/${controlIndex}`,
            `Task control '${control}' is not available for variable '${operation.variable}' in this lesson`,
          );
        }
        controls.add(control);
      });
    });
    // A slider on a card's count (amendment 4): the task trades on one card, from a whole starting pile.
    const card = [...allowedVariables].some((alias) => cardSliders.has(alias))
      ? cardSliderTask(expressionTask, path, allowedVariables, cardSliders, matContents, document.lesson.variables ?? [], startValues)
      : undefined;
    const target = requireFiniteNumber(expressionTask.completion.value, `${path}/completion/value`);
    const tolerance = requireFiniteNumber(expressionTask.completion.tolerance, `${path}/completion/tolerance`);
    if (tolerance <= 0) fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/tolerance`, "Task tolerance must be greater than zero");
    try {
      const evaluate = compileMathExpression(expressionTask.completion.expression, variables.keys());
      if (task.start && [...allowedVariables].some(alias => !Object.hasOwn(startValues, alias))) {
        throw new Error("Practice start must specify all task variables");
      }
      const initial = evaluate({ ...Object.fromEntries(variables), ...startValues });
      if (!Number.isFinite(initial) || !Number.isFinite(target)) throw new Error("Task completion result is not finite");
      const referenced = new Set(referencedMathVariables(expressionTask.completion.expression, variables.keys()));
      if (referenced.size === 0) throw new Error("Task completion expression must read an allowed lesson variable");
      for (const variable of referenced) {
        if (!allowedVariables.has(variable)) {
          throw new Error(`Task completion expression reads '${variable}', but students are not allowed to change it`);
        }
      }
      for (const variable of allowedVariables) {
        if (!referenced.has(variable)) {
          throw new Error(`Allowed variable '${variable}' does not affect the task completion expression`);
        }
      }
      if (Math.abs(initial - target) <= tolerance) {
        throw new Error("Task completion condition is already satisfied by the lesson's initial values");
      }
      if (card) {
        // An exact search over the piles the card's sliders can make by trades, never a sampled range.
        if (!card.piles.some((values) => {
          const actual = evaluate({ ...Object.fromEntries(variables), ...startValues, ...values });
          return Number.isFinite(actual) && Math.abs(actual - target) <= tolerance;
        })) throw new Error("No pile the card's sliders can make by trades from the task's starting pile satisfies the task completion condition");
      } else if (allowedVariables.size === 1) {
        const [variableAlias] = allowedVariables;
        const declaration = document.lesson.variables?.find((variable) => variable.as === variableAlias);
        if (declaration) {
          let reachable = false;
          const check = (value: number): void => {
            if (reachable) return;
            const actual = evaluate({ [variableAlias]: value });
            if (Number.isFinite(actual) && Math.abs(actual - target) <= tolerance) {
              reachable = true;
            }
          };
          const allowed = expressionTask.allowed_operations.find((operation) => operation.variable === variableAlias);
          const exactSliderSteps = declaration.control?.step
            ? Math.floor(
                (declaration.max - declaration.min) / declaration.control.step
                + 1e-12,
              )
            : -1;
          if (allowed?.controls.includes("slider") && exactSliderSteps > 20_000
            && !allowed.controls.includes("geometry_point")) {
            throw new Error("Task slider has too many discrete steps to verify reachability");
          }
          if (allowed?.controls.includes("slider")
            && exactSliderSteps >= 0
            && exactSliderSteps <= 20_000) {
            for (let sample = 0; sample <= exactSliderSteps && !reachable; sample += 1) {
              check(declaration.min + sample * declaration.control!.step!);
            }
          }
          // A dragged number-line point snaps to the line's smallest ticks: only those values can be reached.
          const grid = numberLineGrids.get(variableAlias!);
          if (!reachable && grid && allowed?.controls.includes("number_line_point")) {
            for (const tick of planNumberLineTicks(grid)) {
              if (tick.value >= declaration.min - 1e-9 && tick.value <= declaration.max + 1e-9) check(tick.value);
            }
          }
          if (!reachable && allowed?.controls.includes("geometry_point")) {
            const sampleCount = 20_000;
            for (let sample = 0; sample <= sampleCount && !reachable; sample += 1) {
              check(declaration.min
                + (declaration.max - declaration.min) * sample / sampleCount);
            }
          }
          if (!reachable) {
            throw new Error("No reachable value in the lesson variable range satisfies the task completion condition");
          }
        }
      }
    } catch (error) {
      fail("OLL_INVALID_STUDENT_TASK", `${path}/completion/expression`, `Invalid task completion expression: ${(error as Error).message}`);
    }
    validateTaskFeedback(task, path);
  }
}

function splitBindingTarget(value: unknown, path: string): { alias: string; property: string } {
  if (typeof value !== "string") fail("OLL_INVALID_BINDING", path, "Binding target must be a string");
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) fail("OLL_INVALID_BINDING", path, `Invalid binding target '${value}'`);
  const alias = value.slice(0, separator);
  const property = value.slice(separator + 1);
  requireAlias(alias, path);
  if (!/^[a-z_][a-z0-9_]*$/.test(property)) fail("OLL_INVALID_BINDING", path, `Invalid binding property '${property}'`);
  return { alias, property };
}

function bindableTargets(action: WriteAction): Map<string, Set<string>> {
  const targets = new Map<string, Set<string>>();
  const add = (field: string, properties: readonly string[]) => {
    for (const item of Array.isArray(action.content[field]) ? action.content[field] : []) {
      if (typeof item?.as === "string") targets.set(item.as, new Set(properties));
    }
  };
  for (const [field, properties] of Object.entries(bindingCapabilitiesForNodeKind(action.kind))) {
    add(field, properties);
  }
  return targets;
}

/** Node kinds whose fields lesson variables may drive: every tap card among them. */
const BINDABLE_NODE_KINDS: readonly string[] = ["geometry", "plot", "scene3d", NUMBER_LINE_KIND, FRACTION_MODEL_KIND, ...TAP_CARD_KIND_NAMES];

function validateValueBindings(action: WriteAction, path: string, variables: Map<string, number>): void {
  if (action.content.bindings === undefined) return;
  if (!BINDABLE_NODE_KINDS.includes(action.kind)) {
    fail("OLL_INVALID_BINDING", `${path}/content/bindings`, `Bindings are only supported on ${BINDABLE_NODE_KINDS.slice(0, -1).join(", ")} and ${BINDABLE_NODE_KINDS.at(-1)} nodes`);
  }
  requireArray(action.content.bindings, `${path}/content/bindings`);
  const targets = bindableTargets(action);
  const seen = new Set<string>();
  const labeled = new Set<string>();
  action.content.bindings.forEach((binding: unknown, index: number) => {
    const bindingPath = `${path}/content/bindings/${index}`;
    requireObject(binding, bindingPath);
    for (const field of Object.keys(binding)) {
      if (!["target", "expression", "label", "allow_zero", "hide_when_undefined"].includes(field)) fail("OLL_INVALID_BINDING", `${bindingPath}/${field}`, `Unknown binding field '${field}'`);
    }
    // A card-level field (the chart's `target`) is bound by its bare name, on a kind that declares it.
    const cardField = typeof binding.target === "string" && !binding.target.includes(".");
    if (cardField && !cardBindingCapabilitiesForNodeKind(action.kind).includes(binding.target as string)) {
      fail("OLL_REFERENCE_NOT_FOUND", `${bindingPath}/target`, `Binding target '${String(binding.target)}' is not a field of a ${action.kind} card`);
    }
    const { alias, property } = cardField ? { alias: "", property: binding.target as string } : splitBindingTarget(binding.target, `${bindingPath}/target`);
    if (!cardField && !targets.get(alias)?.has(property)) {
      fail("OLL_REFERENCE_NOT_FOUND", `${bindingPath}/target`, `Binding target '${binding.target}' is not a supported numeric field`);
    }
    // A mark that does not exist for some values (an intercept that leaves the axis, the symmetry axis of a
    // flattened parabola, a range bar for the other sign) is hidden instead of failing the lesson.
    const hideable = action.kind === "geometry" ? ["x", "y"] : action.kind === "plot" ? ["x", "y", "value", "from", "to"] : [];
    if (binding.hide_when_undefined !== undefined && (binding.hide_when_undefined !== true || !hideable.includes(property))) {
      fail("OLL_INVALID_BINDING", `${bindingPath}/hide_when_undefined`, "hide_when_undefined is only valid on point x/y, plot guide value and plot interval from/to bindings, and must be true");
    }
    if (binding.allow_zero !== undefined && (binding.allow_zero !== true || property !== "radius")) {
      fail("OLL_INVALID_BINDING", `${bindingPath}/allow_zero`, "allow_zero is only valid on radius bindings and must be true");
    }
    if (binding.label !== undefined) {
      requireObject(binding.label, `${bindingPath}/label`);
      const label = binding.label;
      if (Object.keys(label).some(key => !["prefix", "suffix", "precision"].includes(key))
        || !Number.isInteger(label.precision) || Number(label.precision) < 0 || Number(label.precision) > 6
        || [label.prefix, label.suffix].some(value => value !== undefined && (typeof value !== "string" || value.length > 64))) {
        fail("OLL_INVALID_BINDING", `${bindingPath}/label`, "Label requires precision 0..6 and optional prefix/suffix up to 64 characters");
      }
      if (labeled.has(alias)) fail("OLL_INVALID_BINDING", `${bindingPath}/label`, "A fragment may have only one generated label");
      labeled.add(alias);
    }
    if (seen.has(binding.target as string)) fail("OLL_INVALID_BINDING", `${bindingPath}/target`, `Binding target '${binding.target}' is duplicated`);
    seen.add(binding.target as string);
    requireString(binding.expression, `${bindingPath}/expression`);
    try {
      const evaluate = compileMathExpression(binding.expression as string, variables.keys());
      const result = evaluate(Object.fromEntries(variables));
      // A hidden-when-undefined mark may start hidden (a parabola that starts above the x-axis has no x-intercept).
      if (!Number.isFinite(result) && binding.hide_when_undefined !== true) throw new Error("result is not finite");
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid expression";
      fail("OLL_INVALID_BINDING", `${bindingPath}/expression`, message);
    }
  });
}

function splitTarget(value: unknown, path: string): { alias: string; fragment?: string } {
  if (typeof value !== "string") {
    fail("OLL_INVALID_REFERENCE", path, "Reference must be a string");
  }
  const [alias, fragment, ...rest] = value.split("#");
  requireAlias(alias, path);
  if (rest.length > 0 || (fragment !== undefined && !fragment)) {
    fail("OLL_INVALID_REFERENCE", path, `Invalid reference '${value}'`);
  }
  if (fragment !== undefined) requireAlias(fragment, path);
  return { alias, fragment };
}

function register(registry: Registry, alias: unknown, type: RegistryEntryType, path: string, fragments: string[] = []): void {
  requireAlias(alias, path);
  if (registry.has(alias)) {
    fail("OLL_DUPLICATE_ALIAS", path, `Alias '${alias}' is already defined`);
  }
  registry.set(alias, { type, fragments: new Set(fragments) });
}

function validateContentFragments(content: JsonObject, path: string): string[] {
  if (!content?.fragments) return [];
  requireArray(content.fragments, `${path}/fragments`);
  const seen = new Set();
  return content.fragments.map((fragment, index) => {
    const fragmentPath = `${path}/fragments/${index}`;
    requireObject(fragment, fragmentPath);
    requireAlias(fragment.as, `${fragmentPath}/as`);
    if (seen.has(fragment.as)) {
      fail("OLL_DUPLICATE_ALIAS", `${fragmentPath}/as`, `Fragment '${fragment.as}' is duplicated`);
    }
    seen.add(fragment.as);
    return fragment.as;
  });
}

function collectAddressableContent(content: JsonObject, path = "/content"): string[] {
  const result = validateContentFragments(content, path);
  for (const field of ["curves", "points", "guides", "regions", "elements", "edges", "polygons", "regular_polygons", "circles", "segments", "arcs", "objects", "sections", "highlights", "selections", "jumps", "intervals", "fractions", "places"]) {
    if (!content?.[field]) continue;
    for (const [index, item] of content[field].entries()) {
      if (item?.as) result.push(item.as);
      if (field === "objects" && item?.face_targets === true && typeof item.as === "string") {
        const faces = solidFaceKeys(item).map((face) => solidFaceTarget(item.as, face));
        if (ALIAS_PATTERN.test(item.as) && faces.some((face) => !ALIAS_PATTERN.test(face))) {
          fail("OLL_INVALID_ALIAS", `${path}/objects/${index}/as`, "Shorten the object alias to leave room for its face target names");
        }
        result.push(...faces);
      }
    }
  }
  return result;
}

function validateStructuredContent(content: JsonObject, path: string, addressable: Set<string>): void {
  if (Array.isArray(content?.edges)) {
    content.edges.forEach((edge, index) => {
      for (const field of ["from", "to"]) {
        if (!addressable.has(edge[field])) {
          fail("OLL_REFERENCE_NOT_FOUND", `${path}/edges/${index}/${field}`, `Diagram element '${edge[field]}' is not defined`);
        }
      }
    });
  }
  if (Array.isArray(content?.regions)) {
    content.regions.forEach((region, regionIndex) => {
      if (!Array.isArray(region.members)) return;
      region.members.forEach((member: string, memberIndex: number) => {
        if (!addressable.has(member)) {
          fail("OLL_REFERENCE_NOT_FOUND", `${path}/regions/${regionIndex}/members/${memberIndex}`, `Diagram element '${member}' is not defined`);
        }
      });
    });
  }
}

/**
 * A number line's bound values stay drawable for every value its variables
 * can take (decision 0013): the card is evaluated with each referenced
 * variable at its minimum, its maximum and its starting value (up to four
 * variables), and every result is checked like authored content. A jump may
 * then stop between ticks; the runtime draws a shorter last hop.
 */
function checkNumberLineBoundValues(content: JsonObject, path: string, declarations: readonly { as: string; initial: number; min: number; max: number }[]): void {
  checkPluginBoundValues(content, path, declarations, ["points", "jumps", "intervals"], (evaluated, failAt) => validateNumberLineContent(evaluated, path, failAt, { boundValues: true }));
}

/**
 * A fraction model's bound numerators stay drawable for every value their variables can take
 * (decision 0021): the same check as the number line's, against the fraction model's rules.
 */
function checkFractionModelBoundValues(content: JsonObject, path: string, declarations: readonly { as: string; initial: number; min: number; max: number }[]): void {
  checkPluginBoundValues(content, path, declarations, FRACTION_MODEL_PART_FIELDS, (evaluated, failAt) => validateFractionModelContent(evaluated, path, failAt, { boundValues: true }));
}

/**
 * A base-ten trade card stays drawable for every value its variables can take (decision 0023): each
 * count and tray within what the mat draws. The joint rules (a tray holds no more than its place has, the
 * pile's value) belong to a starting pile and are kept by the card's tap rules.
 */
function checkBaseTenTradeBoundValues(content: JsonObject, path: string, declarations: readonly { as: string; initial: number; min: number; max: number }[]): void {
  const validate = (evaluated: JsonObject, failAt: (failPath: string, message: string) => never) => validateBaseTenTradeContent(evaluated, path, failAt, { boundValues: true });
  checkPluginBoundValues(content, path, declarations, BASE_TEN_TRADE_PART_FIELDS, validate);
  // A three-column mat binds five variables and the corner check varies only four, so each variable is
  // also checked on its own at its minimum and maximum (review of #86): no count can leave the mat.
  checkEachBoundVariable(content, path, declarations, BASE_TEN_TRADE_PART_FIELDS, validate);
}

/**
 * A place-value chart stays drawable for every value its variables can take (decision 0025): each count and
 * pulled count within nine, and the number within its columns. The joint rules (a place's disks make its
 * digit; a task that would show its answer; a chart already built) belong to a starting chart: the card as
 * its variables start it and each task's start are checked against them.
 */
function checkPlaceValueChartBoundValues(content: JsonObject, path: string, declarations: readonly { as: string; initial: number; min: number; max: number }[]): void {
  const validate = (evaluated: JsonObject, failAt: (failPath: string, message: string) => never) => validatePlaceValueChartContent(evaluated, path, failAt, { boundValues: true });
  checkPluginBoundValues(content, path, declarations, PLACE_VALUE_CHART_PART_FIELDS, validate);
  // A chart binds up to 21 variables and the corner check varies only four, so each is also checked alone.
  checkEachBoundVariable(content, path, declarations, PLACE_VALUE_CHART_PART_FIELDS, validate);
}

/**
 * A place-value trade card stays drawable for every value its variables can take (decision 0026): each number
 * within the card's columns and two decimals, each status and "columns finished" in range. The joint rules
 * (the pair the card refuses, the pair's columns, statuses the taps make) belong to a starting card: the card
 * as its variables start it and each task's start are checked against them.
 */
function checkPlaceValueTradeBoundValues(content: JsonObject, path: string, declarations: readonly { as: string; initial: number; min: number; max: number }[]): void {
  const validate = (evaluated: JsonObject, failAt: (failPath: string, message: string) => never) => validatePlaceValueTradeContent(evaluated, path, failAt, { boundValues: true });
  checkPluginBoundValues(content, path, declarations, PLACE_VALUE_TRADE_PART_FIELDS, validate);
  // Up to nine variables, and the corner check varies only four: each is also checked alone.
  checkEachBoundVariable(content, path, declarations, PLACE_VALUE_TRADE_PART_FIELDS, validate);
}

/** Each referenced variable on its own at its minimum and maximum, the others at their start. */
function checkEachBoundVariable(
  content: JsonObject,
  path: string,
  declarations: readonly { as: string; initial: number; min: number; max: number }[],
  fields: readonly string[],
  validate: (evaluated: JsonObject, failAt: (failPath: string, message: string) => never) => void,
): void {
  const bindings = Array.isArray(content.bindings) ? content.bindings as JsonObject[] : [];
  const known = new Set(declarations.map((declaration) => declaration.as));
  const referenced = new Set(bindings.flatMap((binding) => referencedMathVariables(String(binding.expression), known)));
  const withIds = structuredClone(content);
  for (const field of fields) if (Array.isArray(withIds[field])) withIds[field] = withIds[field].map((item: JsonObject) => ({ ...item, id: item.as }));
  const initials = Object.fromEntries(declarations.map((declaration) => [declaration.as, declaration.initial]));
  for (const declaration of declarations.filter((each) => referenced.has(each.as))) {
    for (const value of new Set([declaration.min, declaration.max])) {
      const where = `When ${declaration.as} = ${value}`;
      let evaluated: JsonObject;
      try {
        evaluated = evaluateContentBindings(withIds, { ...initials, [declaration.as]: value });
      } catch (error) {
        fail("OLL_INVALID_BINDING", `${path}/bindings`, `${where}: ${(error as Error).message}`);
      }
      for (const field of fields) if (Array.isArray(evaluated[field])) evaluated[field] = evaluated[field].map(({ id: _id, ...item }: JsonObject) => item);
      validate(evaluated, (failPath, message) => fail("OLL_INVALID_BINDING", failPath, `${where}: ${message}`));
    }
  }
}

/**
 * A lesson animates a variable of a card it shows by a demonstration field (decision 0026): only that field's
 * own variable, a whole number, never back ("columns finished" goes forward a column at a time; the same value
 * again leaves the card as it is). The card's tap fields change only by the learner's taps.
 */
function checkDemonstrationAnimate(
  cards: ReadonlyMap<string, LessonTapCard>,
  variable: string,
  value: number,
  before: number | undefined,
  path: string,
): void {
  for (const { kind, content } of cards.values()) {
    if (!kind.demonstration) continue;
    const bound = bareBindings(content);
    if (bound.get(kind.demonstration.field) === variable) {
      const from = before ?? 0;
      if (!Number.isInteger(value)) fail("OLL_INVALID_VARIABLE", `${path}/value`, `'${variable}' counts the columns a ${kind.kind} card has finished: a whole number, not ${value}; from ${from}, ${kind.demonstration.next(content, from)}`);
      if (value < from) fail("OLL_INVALID_VARIABLE", `${path}/value`, `'${variable}' counts the columns a ${kind.kind} card has finished: it goes forward, not from ${from} back to ${value}; ${kind.demonstration.next(content, from)}`);
    }
    for (const { place, field } of kind.tapFields(content)) {
      if (bound.get(kind.fieldTarget(content, place, field)) === variable) {
        fail("OLL_INVALID_VARIABLE", `${path}/variable`, `'${variable}' is a column's state on a ${kind.kind} card: only the learner's taps change it; the lesson animates '${bound.get(kind.demonstration.field) ?? kind.demonstration.field}'`);
      }
    }
    // The card's problem changes only at a start (a replay or a task's), where the pair is checked whole: an
    // animated number would pass through pairs the card refuses (decision 0026 §5).
    for (const field of kind.practiceFields ?? []) {
      if (bound.get(field) === variable) {
        fail("OLL_INVALID_VARIABLE", `${path}/variable`, `'${variable}' is a number of a ${kind.kind} card's problem: the lesson does not animate it; a replay or a task's start sets the pair`);
      }
    }
  }
}

/**
 * The cards of a lesson shown by a demonstration field (decision 0026), by alias, wherever they are written: a
 * beat before the card is written cannot animate its fields either.
 */
function demonstrationCards(document: AuthoringLesson): Map<string, LessonTapCard> {
  const cards = new Map<string, LessonTapCard>();
  for (const step of Array.isArray(document.steps) ? document.steps : []) {
    for (const beat of Array.isArray(step?.beats) ? step.beats : []) {
      for (const action of (Array.isArray(beat?.actions) ? beat.actions : []) as Array<Partial<WriteAction>>) {
        const kind = action?.do === "write" ? tapCardKind(action.kind) : undefined;
        if (kind?.demonstration && typeof action.as === "string" && action.content && typeof action.content === "object") cards.set(action.as, { kind, content: action.content });
      }
    }
  }
  return cards;
}

/**
 * A card shown by a demonstration field binds each field to one lesson variable by name, a variable of its own
 * (decision 0026): an expression ("finished + 0") would hide the field's variable from the demonstration's rules.
 */
function requirePlainCardBindings(kind: TapCardKind, content: JsonObject, path: string): void {
  const seen = new Map<string, string>();
  ((Array.isArray(content.bindings) ? content.bindings : []) as JsonObject[]).forEach((binding, index) => {
    const expression = String(binding.expression ?? "").trim();
    if (!VARIABLE_PATTERN.test(expression)) {
      fail("OLL_INVALID_BINDING", `${path}/content/bindings/${index}/expression`, `A ${kind.kind} card binds each field to one lesson variable by name, not '${expression}'`);
    }
    const other = seen.get(expression);
    if (other !== undefined) fail("OLL_INVALID_BINDING", `${path}/content/bindings/${index}/expression`, `Variable '${expression}' is bound to two fields of a ${kind.kind} card ('${other}' and '${String(binding.target)}')`);
    seen.set(expression, String(binding.target));
  });
}

/**
 * A replay start on a card shown by a demonstration field restarts the demonstration (decision 0026): that field
 * at a whole number (it may go back: the replay shows it again), every column's state fresh, and the card's
 * numbers a pair it takes.
 */
function checkDemonstrationReplay(cards: ReadonlyMap<string, LessonTapCard>, values: Readonly<Record<string, number>>, played: Readonly<Record<string, number>>, path: string): void {
  for (const { kind, content } of cards.values()) {
    if (!kind.demonstration) continue;
    const bound = bareBindings(content);
    const field = bound.get(kind.demonstration.field);
    if (field !== undefined && Object.hasOwn(values, field) && !Number.isInteger(values[field])) {
      fail("OLL_INVALID_PHASE_START", `${path}/values/${field}`, `'${field}' counts the columns a ${kind.kind} card has finished: a whole number, not ${values[field]}`);
    }
    let touched = field !== undefined && Object.hasOwn(values, field);
    for (const { place, field: tapField } of kind.tapFields(content)) {
      const alias = bound.get(kind.fieldTarget(content, place, tapField));
      if (alias === undefined || !Object.hasOwn(values, alias)) continue;
      touched = true;
      if (values[alias] !== 0) fail("OLL_INVALID_PHASE_START", `${path}/values/${alias}`, `'${alias}' is a column's state on a ${kind.kind} card: a replay lays a fresh chart (0), not ${values[alias]}`);
    }
    for (const cardField of kind.practiceFields ?? []) if (bound.get(cardField) !== undefined && Object.hasOwn(values, bound.get(cardField)!)) touched = true;
    if (!touched) continue;
    const at = kind.contentAt(content, (target) => {
      const alias = bound.get(target);
      return alias === undefined ? undefined : ({ ...played, ...values })[alias];
    });
    kind.validateContent(at, "$", (failPath, message) => fail("OLL_INVALID_PHASE_START", path, `The replay's card is not one this card takes: ${message} (${failPath.replace(/^\$\//, "")})`));
  }
}

/** A card's bindings to a bare variable, by binding target (an expression that is more than a name is left out). */
function bareBindings(content: JsonObject): Map<string, string> {
  const result = new Map<string, string>();
  for (const binding of (Array.isArray(content.bindings) ? content.bindings : []) as JsonObject[]) {
    if (typeof binding.target === "string" && typeof binding.expression === "string" && VARIABLE_PATTERN.test(binding.expression.trim())) result.set(binding.target, binding.expression.trim());
  }
  return result;
}

/** Evaluates a plugin card at each referenced variable's minimum, maximum and start, and checks each result. */
function checkPluginBoundValues(
  content: JsonObject,
  path: string,
  declarations: readonly { as: string; initial: number; min: number; max: number }[],
  fields: readonly string[],
  validate: (evaluated: JsonObject, failAt: (failPath: string, message: string) => never) => void,
): void {
  const bindings = Array.isArray(content.bindings) ? content.bindings as JsonObject[] : [];
  if (!bindings.length) return;
  const known = new Map(declarations.map((declaration) => [declaration.as, declaration]));
  const referenced = [...new Set(bindings.flatMap((binding) => referencedMathVariables(String(binding.expression), known.keys())))].slice(0, 4);
  let combinations: Array<Record<string, number>> = [{}];
  for (const variable of referenced) {
    const { min, max, initial } = known.get(variable)!;
    combinations = combinations.flatMap((combination) => [...new Set([min, max, initial])].map((value) => ({ ...combination, [variable]: value })));
  }
  const withIds = (value: JsonObject): JsonObject => {
    const clone = structuredClone(value);
    for (const field of fields) {
      if (Array.isArray(clone[field])) clone[field] = clone[field].map((item: JsonObject) => ({ ...item, id: item.as }));
    }
    return clone;
  };
  for (const combination of combinations) {
    const values = { ...Object.fromEntries(declarations.map((declaration) => [declaration.as, declaration.initial])), ...combination };
    const where = Object.entries(combination).map(([name, value]) => `${name} = ${value}`).join(", ");
    let evaluated: JsonObject;
    try {
      evaluated = evaluateContentBindings(withIds(content), values);
    } catch (error) {
      fail("OLL_INVALID_BINDING", `${path}/bindings`, `When ${where}: ${(error as Error).message}`);
    }
    for (const field of fields) {
      if (Array.isArray(evaluated[field])) evaluated[field] = evaluated[field].map(({ id: _id, ...item }: JsonObject) => item);
    }
    validate(evaluated, (failPath, message) => fail("OLL_INVALID_BINDING", failPath, `When ${where}: ${message}`));
  }
}

function requireFiniteNumber(value: unknown, path: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) fail("OLL_INVALID_OPERATION_PAYLOAD", path, "Expected a finite number");
  return number;
}

function validateGeometryContent(
  action: WriteAction,
  path: string,
  variables: Map<string, number>,
): void {
  if (action.kind !== "geometry") return;
  const content = action.content;
  requireObject(content.axes, `${path}/content/axes`);
  for (const axisName of ["x", "y"] as const) {
    const axisPath = `${path}/content/axes/${axisName}`;
    requireObject(content.axes[axisName], axisPath);
    const min = requireFiniteNumber(content.axes[axisName].min, `${axisPath}/min`);
    const max = requireFiniteNumber(content.axes[axisName].max, `${axisPath}/max`);
    if (max <= min) fail("OLL_INVALID_OPERATION_PAYLOAD", axisPath, "Geometry axis max must be greater than min");
  }
  if (content.axes.equal_scale !== true) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/axes/equal_scale`, "Geometry requires equal_scale=true");
  }

  requireArray(content.points, `${path}/content/points`);
  const pointAliases = new Set<string>();
  content.points.forEach((point, index: number) => {
    const pointPath = `${path}/content/points/${index}`;
    requireObject(point, pointPath);
    requireAlias(point.as, `${pointPath}/as`);
    pointAliases.add(point.as);
    requireFiniteNumber(point.x, `${pointPath}/x`);
    requireFiniteNumber(point.y, `${pointPath}/y`);
  });

  content.points.forEach((point, index: number) => {
    requireObject(point, `${path}/content/points/${index}`);
    if (point.interaction === undefined) return;
    const interactionPath = `${path}/content/points/${index}/interaction`;
    requireObject(point.interaction, interactionPath);
    if (point.interaction.kind !== "angle_control") {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${interactionPath}/kind`, "Geometry point interaction kind must be 'angle_control'");
    }
    requireVariableAlias(point.interaction.variable, `${interactionPath}/variable`);
    if (!variables.has(point.interaction.variable)) {
      fail("OLL_REFERENCE_NOT_FOUND", `${interactionPath}/variable`, `Lesson variable '${point.interaction.variable}' is not defined`);
    }
    requireAlias(point.interaction.center, `${interactionPath}/center`);
    if (!pointAliases.has(point.interaction.center)) {
      fail("OLL_REFERENCE_NOT_FOUND", `${interactionPath}/center`, `Geometry point '${point.interaction.center}' is not defined`);
    }
    if (point.interaction.center === point.as) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${interactionPath}/center`, "An angle control point cannot use itself as its center");
    }
  });

  const requirePointReference = (value: unknown, referencePath: string) => {
    requireAlias(value, referencePath);
    if (!pointAliases.has(value)) {
      fail("OLL_REFERENCE_NOT_FOUND", referencePath, `Geometry point '${value}' is not defined`);
    }
  };
  if (content.polygons !== undefined) {
    if (!Array.isArray(content.polygons)) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/polygons`, "Expected an array");
    }
    content.polygons.forEach((polygon: JsonObject, index: number) => {
      const polygonPath = `${path}/content/polygons/${index}`;
      requireObject(polygon, polygonPath);
      if (!Array.isArray(polygon.points) || polygon.points.length < 3) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${polygonPath}/points`, "A geometry polygon requires at least three points");
      }
      polygon.points.forEach((point: unknown, pointIndex: number) => {
        requirePointReference(point, `${polygonPath}/points/${pointIndex}`);
      });
      if (new Set(polygon.points).size < 3) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${polygonPath}/points`, "A geometry polygon requires at least three distinct points");
      }
    });
  }
  if (content.regular_polygons !== undefined) {
    requireArray(content.regular_polygons, `${path}/content/regular_polygons`);
    if (content.regular_polygons.length > 8) fail("OLL_INVALID_OPERATION_PAYLOAD", path, "At most 8 regular polygons");
    content.regular_polygons.forEach((polygon: unknown, index: number) => {
      const p = `${path}/content/regular_polygons/${index}`;
      requireObject(polygon, p);
      requireAlias(polygon.as, `${p}/as`);
      requirePointReference(polygon.center, `${p}/center`);
      const radius = requireFiniteNumber(polygon.radius, `${p}/radius`);
      const sides = requireFiniteNumber(polygon.sides, `${p}/sides`);
      if (radius <= 0 || !Number.isInteger(sides) || sides < 3 || sides > 384)
        fail("OLL_INVALID_OPERATION_PAYLOAD", p, "Regular polygons require positive radius and integer sides 3..384");
      if (polygon.relation !== "inscribed" && polygon.relation !== "circumscribed") fail("OLL_INVALID_OPERATION_PAYLOAD", `${p}/relation`, "Expected inscribed or circumscribed");
      if (polygon.rotation !== undefined) requireFiniteNumber(polygon.rotation, `${p}/rotation`);
    });
  }
  for (const [field, references] of [
    ["circles", ["center"]],
    ["segments", ["from", "to"]],
    ["arcs", ["center"]],
  ] as const) {
    if (content[field] === undefined) continue;
    if (!Array.isArray(content[field])) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/${field}`, "Expected an array");
    }
    content[field].forEach((item: JsonObject, index: number) => {
      const itemPath = `${path}/content/${field}/${index}`;
      requireObject(item, itemPath);
      for (const reference of references) requirePointReference(item[reference], `${itemPath}/${reference}`);
      if (field === "circles" || field === "arcs") {
        const radius = requireFiniteNumber(item.radius, `${itemPath}/radius`);
        const zeroAllowed = radius === 0 && (content.bindings ?? []).some((binding: JsonObject) =>
          binding.target === `${item.as}.radius` && binding.allow_zero === true);
        if (radius < 0 || (radius === 0 && !zeroAllowed)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${itemPath}/radius`, "Radius must be positive unless explicitly bound with allow_zero");
      }
      if (field === "arcs") {
        if (item.filled !== undefined && typeof item.filled !== "boolean") fail("OLL_INVALID_OPERATION_PAYLOAD", `${itemPath}/filled`, "Sector fill must be boolean");
        requireFiniteNumber(item.start_angle, `${itemPath}/start_angle`);
        requireFiniteNumber(item.end_angle, `${itemPath}/end_angle`);
      }
    });
  }
}

function validateScene3dContent(
  action: WriteAction,
  path: string,
  variables: Map<string, number>,
): void {
  if (action.kind !== "scene3d") return;
  const content = action.content;
  requireString(content.fallback, `${path}/content/fallback`);
  requireObject(content.camera, `${path}/content/camera`);
  requireFiniteNumber(content.camera.yaw, `${path}/content/camera/yaw`);
  const pitch = requireFiniteNumber(content.camera.pitch, `${path}/content/camera/pitch`);
  const zoom = requireFiniteNumber(content.camera.zoom, `${path}/content/camera/zoom`);
  if (pitch < -Math.PI / 2 || pitch > Math.PI / 2) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/camera/pitch`, "3D camera pitch must be between -pi/2 and pi/2");
  }
  if (zoom < .2 || zoom > 5) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/camera/zoom`, "3D camera zoom must be from 0.2 to 5");
  }
  requireArray(content.objects, `${path}/content/objects`);
  if (content.objects.length === 0 || content.objects.length > 24) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/objects`, "A 3D scene requires 1 to 24 objects");
  }
  const aliases = new Set<string>();
  const objectAliases = new Set<string>();
  const point = (value: unknown, pointPath: string) => {
    requireObject(value, pointPath);
    for (const axis of ["x", "y", "z"] as const) {
      requireFiniteNumber(value[axis], `${pointPath}/${axis}`);
    }
  };
  const size = (value: unknown, sizePath: string) => {
    requireObject(value, sizePath);
    for (const axis of ["x", "y", "z"] as const) {
      if (requireFiniteNumber(value[axis], `${sizePath}/${axis}`) <= 0) fail("OLL_INVALID_OPERATION_PAYLOAD", `${sizePath}/${axis}`, "3D size must be greater than zero");
    }
  };
  const range = (value: unknown, rangePath: string): { min: number; max: number } => {
    requireObject(value, rangePath);
    const min = requireFiniteNumber(value.min, `${rangePath}/min`);
    const max = requireFiniteNumber(value.max, `${rangePath}/max`);
    if (max <= min) fail("OLL_INVALID_OPERATION_PAYLOAD", rangePath, "3D range max must be greater than min");
    return { min, max };
  };
  content.objects.forEach((rawObject: unknown, index: number) => {
    const objectPath = `${path}/content/objects/${index}`;
    requireObject(rawObject, objectPath);
    const object = rawObject;
    requireAlias(object.as, `${objectPath}/as`);
    if (aliases.has(object.as)) fail("OLL_DUPLICATE_ALIAS", `${objectPath}/as`, `3D object '${object.as}' is duplicated`);
    aliases.add(object.as);
    objectAliases.add(object.as);
    const objectKind = String(object.kind);
    if (!["box", "sphere", "cylinder", "cone", "surface", "implicit_surface", "prism", "pyramid", "frustum", "hemisphere", "torus", "tetrahedron", "octahedron", "dodecahedron", "icosahedron", "ellipsoid"].includes(objectKind)) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/kind`, `Unknown 3D object kind '${object.kind}'`);
    }
    if (object.face_targets === true && !solidFaceKeys(object).length) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/face_targets`, "Face targets require a solid with selectable surfaces");
    }
    if (object.unfold !== undefined) {
      if (!UNFOLDING_KINDS.has(objectKind)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/unfold`, "Only a box, prism, pyramid, cylinder or cone unfolds into a net");
      const unfold = requireFiniteNumber(object.unfold, `${objectPath}/unfold`);
      if (unfold < 0 || unfold > 1) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/unfold`, "unfold is between 0 (closed) and 1 (a flat net)");
    }
    if (object.color !== undefined
      && (typeof object.color !== "string" || !/^(#[0-9a-fA-F]{6}|teal|blue|purple|orange|red|gray)$/.test(object.color))) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/color`, "3D colors must use a safe palette name or six-digit hex value");
    }
    if (objectKind === "box") {
      point(object.center, `${objectPath}/center`);
      size(object.size, `${objectPath}/size`);
    } else if (objectKind === "ellipsoid") {
      point(object.center, `${objectPath}/center`);
      const radii = object.radii as Record<string, unknown> | undefined;
      if (!radii || !["x", "y", "z"].every((axis) => typeof radii[axis] === "number" && (radii[axis] as number) > 0)) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/radii`, "An ellipsoid needs three radii above zero");
      }
    } else if (SOLID_KINDS.has(objectKind)) {
      point(object.center, `${objectPath}/center`);
      const based = (objectKind === "prism" || objectKind === "pyramid") && object.base !== undefined;
      const radius = based ? 1 : requireFiniteNumber(object.radius, `${objectPath}/radius`);
      if (radius <= 0) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/radius`, "3D radius must be greater than zero");
      if (["cylinder", "cone", "prism", "pyramid", "frustum"].includes(objectKind)) {
        const height = requireFiniteNumber(object.height, `${objectPath}/height`);
        if (height <= 0) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/height`, "3D height must be greater than zero");
      }
      if (based) {
        if (object.sides !== undefined) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/sides`, "A prism or pyramid has either sides (a regular base) or a base polygon, not both");
        if (!convexPolygon(object.base)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/base`, "A base is a convex polygon of 3 to 12 corners with an area");
      } else if (objectKind === "prism" || objectKind === "pyramid") {
        const sides = Number(object.sides);
        if (!Number.isInteger(sides) || sides < 3 || sides > 12) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/sides`, "A prism or pyramid has 3 to 12 sides");
      }
      if (object.top_scale !== undefined && objectKind !== "pyramid") fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/top_scale`, "Only a pyramid is truncated (top_scale)");
      if (objectKind === "frustum") {
        const top = requireFiniteNumber(object.top_radius, `${objectPath}/top_radius`);
        if (top <= 0) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/top_radius`, "A frustum's top radius must be greater than zero");
      }
      if (objectKind === "torus") {
        const tube = requireFiniteNumber(object.tube, `${objectPath}/tube`);
        if (tube <= 0 || tube >= radius) fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/tube`, "A torus's tube must be thinner than its ring: 0 < tube < radius");
      }
    } else if (objectKind === "implicit_surface") {
      requireString(object.expression, `${objectPath}/expression`);
      const xRange = range(object.x_range, `${objectPath}/x_range`);
      const yRange = range(object.y_range, `${objectPath}/y_range`);
      const zRange = range(object.z_range, `${objectPath}/z_range`);
      const level = object.level === undefined
        ? 0
        : requireFiniteNumber(object.level, `${objectPath}/level`);
      const sampleCount = Number(object.samples ?? 12);
      if (!Number.isInteger(sampleCount) || sampleCount < 4 || sampleCount > 18) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/samples`, "3D implicit surface samples must be an integer from 4 to 18");
      }
      try {
        const variableNames = ["x", "y", "z", ...variables.keys()];
        const evaluate = compileMathExpression(object.expression, variableNames);
        const values = Object.fromEntries(variables);
        const sampled: number[] = [];
        for (let xIndex = 0; xIndex <= sampleCount; xIndex += 1) {
          const x = xRange.min + (xRange.max - xRange.min) * xIndex / sampleCount;
          for (let yIndex = 0; yIndex <= sampleCount; yIndex += 1) {
            const y = yRange.min + (yRange.max - yRange.min) * yIndex / sampleCount;
            for (let zIndex = 0; zIndex <= sampleCount; zIndex += 1) {
              const z = zRange.min + (zRange.max - zRange.min) * zIndex / sampleCount;
              const value = evaluate({ ...values, x, y, z });
              if (Number.isFinite(value)) sampled.push(value);
            }
          }
        }
        if (sampled.length === 0
          || Math.min(...sampled) > level
          || Math.max(...sampled) < level) {
          throw new Error("the requested level is outside the sampled value range");
        }
      } catch (error) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/expression`, `Invalid 3D implicit surface expression: ${(error as Error).message}`);
      }
    } else {
      requireString(object.expression, `${objectPath}/expression`);
      const xRange = range(object.x_range, `${objectPath}/x_range`);
      const yRange = range(object.y_range, `${objectPath}/y_range`);
      const sampleCount = Number(object.samples ?? 12);
      if (!Number.isInteger(sampleCount) || sampleCount < 4 || sampleCount > 24) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/samples`, "3D surface samples must be an integer from 4 to 24");
      }
      try {
        const variableNames = ["x", "y", ...variables.keys()];
        const evaluate = compileMathExpression(object.expression, variableNames);
        const values = Object.fromEntries(variables);
        for (const x of [xRange.min, (xRange.min + xRange.max) / 2, xRange.max]) {
          for (const y of [yRange.min, (yRange.min + yRange.max) / 2, yRange.max]) {
            if (!Number.isFinite(evaluate({ ...values, x, y }))) throw new Error("surface is not finite");
          }
        }
      } catch (error) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${objectPath}/expression`, `Invalid 3D surface expression: ${(error as Error).message}`);
      }
    }
  });
  if (content.sections !== undefined) {
    requireArray(content.sections, `${path}/content/sections`);
    if (content.sections.length > 8) fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/sections`, "A 3D scene supports at most 8 sections");
    content.sections.forEach((rawSection: unknown, index: number) => {
      const sectionPath = `${path}/content/sections/${index}`;
      requireObject(rawSection, sectionPath);
      const section = rawSection;
      requireAlias(section.as, `${sectionPath}/as`);
      if (aliases.has(section.as)) fail("OLL_DUPLICATE_ALIAS", `${sectionPath}/as`, `3D element '${section.as}' is duplicated`);
      aliases.add(section.as);
      if (!["x", "y", "z"].includes(String(section.axis))) fail("OLL_INVALID_OPERATION_PAYLOAD", `${sectionPath}/axis`, "3D section axis must be x, y, or z");
      requireFiniteNumber(section.value, `${sectionPath}/value`);
      const display = String(section.display ?? "plane");
      if (!["plane", "intersection", "plane_and_intersection"].includes(display)) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${sectionPath}/display`, `Unknown 3D section display '${display}'`);
      }
      if (section.targets !== undefined) {
        requireArray(section.targets, `${sectionPath}/targets`);
        if (section.targets.length === 0 || section.targets.length > 24) {
          fail("OLL_INVALID_OPERATION_PAYLOAD", `${sectionPath}/targets`, "3D section targets must contain 1 to 24 objects");
        }
        const seenTargets = new Set<string>();
        section.targets.forEach((target: unknown, targetIndex: number) => {
          requireAlias(target, `${sectionPath}/targets/${targetIndex}`);
          if (!objectAliases.has(target as string)) {
            fail("OLL_REFERENCE_NOT_FOUND", `${sectionPath}/targets/${targetIndex}`, `3D section target '${String(target)}' does not exist`);
          }
          if (seenTargets.has(target as string)) {
            fail("OLL_INVALID_OPERATION_PAYLOAD", `${sectionPath}/targets/${targetIndex}`, `3D section target '${String(target)}' is duplicated`);
          }
          seenTargets.add(target as string);
        });
      } else if (display !== "plane") {
        fail("OLL_REFERENCE_NOT_FOUND", `${sectionPath}/targets`, `3D section display '${display}' requires at least one target object`);
      }
    });
  }
  if (content.highlights !== undefined) {
    requireArray(content.highlights, `${path}/content/highlights`);
    if (content.highlights.length > 24) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/highlights`, "A 3D scene supports at most 24 highlights");
    }
    content.highlights.forEach((rawHighlight: unknown, index: number) => {
      const highlightPath = `${path}/content/highlights/${index}`;
      requireObject(rawHighlight, highlightPath);
      const highlight = rawHighlight;
      requireAlias(highlight.as, `${highlightPath}/as`);
      if (aliases.has(highlight.as)) fail("OLL_DUPLICATE_ALIAS", `${highlightPath}/as`, `3D element '${highlight.as}' is duplicated`);
      aliases.add(highlight.as);
      if (!["point", "edge", "face"].includes(String(highlight.kind))) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${highlightPath}/kind`, `Unknown 3D highlight kind '${String(highlight.kind)}'`);
      }
      if (highlight.shown !== undefined && highlight.shown !== "always" && highlight.shown !== "when_emphasized") {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${highlightPath}/shown`, "3D highlight shown must be 'always' or 'when_emphasized'");
      }
      requireArray(highlight.points, `${highlightPath}/points`);
      const requiredCount = highlight.kind === "point" ? 1 : highlight.kind === "edge" ? 2 : 3;
      if (highlight.points.length < requiredCount
        || (highlight.kind !== "face" && highlight.points.length !== requiredCount)
        || highlight.points.length > 12) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${highlightPath}/points`, `3D ${String(highlight.kind)} highlight has an invalid point count`);
      }
      highlight.points.forEach((rawPoint: unknown, pointIndex: number) => point(
        rawPoint,
        `${highlightPath}/points/${pointIndex}`,
      ));
    });
  }
}

/**
 * A curve drawn only on an interval (one piece of a piecewise function): `from` and `to` are finite x
 * values, either may be left out for an unbounded side, and each given end is closed (filled dot) or
 * open (ring). Pieces of one function share a `series` name, so they are styled and listed as one.
 */
function validateCurveInterval(curve: JsonObject, curvePath: string): void {
  const interval = ["from", "to", "from_closed", "to_closed"].some((field) => curve[field] !== undefined);
  if (curve.series !== undefined && (typeof curve.series !== "string" || !/^[a-z][a-z0-9-]{0,31}$/u.test(curve.series))) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${curvePath}/series`, "A curve series is a name of 1 to 32 lowercase letters, digits or hyphens");
  }
  if (!interval) return;
  if (curve.kind === "implicit") fail("OLL_INVALID_OPERATION_PAYLOAD", curvePath, "Only y = f(x) curves can be drawn on an interval");
  for (const end of ["from", "to"] as const) {
    if (curve[end] !== undefined) requireFiniteNumber(curve[end], `${curvePath}/${end}`);
    const closed = curve[`${end}_closed`];
    if (closed !== undefined && typeof closed !== "boolean") fail("OLL_INVALID_OPERATION_PAYLOAD", `${curvePath}/${end}_closed`, "An end is closed (true) or open (false)");
    if (closed !== undefined && curve[end] === undefined) fail("OLL_INVALID_OPERATION_PAYLOAD", `${curvePath}/${end}_closed`, `An unbounded side has no ${end}_closed`);
  }
  if (curve.from !== undefined && curve.to !== undefined && Number(curve.from) >= Number(curve.to)) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", curvePath, "A curve interval needs from < to");
  }
}

/**
 * Pieces of one function (curves sharing a `series`) cover each x at most once: their intervals may
 * meet only at an end that at most one of them includes. Malformed ends are left to the curve check.
 */
function validateSeriesPieces(curves: readonly unknown[], path: string): void {
  const bySeries = new Map<string, Array<{ index: number; from: number; to: number; fromClosed: boolean; toClosed: boolean }>>();
  curves.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null) return;
    const curve = raw as JsonObject;
    if (typeof curve.series !== "string") return;
    const from = curve.from === undefined ? -Infinity : curve.from, to = curve.to === undefined ? Infinity : curve.to;
    if (typeof from !== "number" || typeof to !== "number") return;
    const pieces = bySeries.get(curve.series) ?? [];
    pieces.push({ index, from, to, fromClosed: curve.from_closed !== false, toClosed: curve.to_closed !== false });
    bySeries.set(curve.series, pieces);
  });
  for (const pieces of bySeries.values()) {
    pieces.sort((a, b) => a.from - b.from);
    for (let i = 1; i < pieces.length; i += 1) {
      const before = pieces[i - 1]!, piece = pieces[i]!;
      if (piece.from < before.to || (piece.from === before.to && piece.fromClosed && before.toClosed && Number.isFinite(piece.from))) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/curves/${piece.index}`, `Pieces of one function overlap: curves ${before.index} and ${piece.index} both cover x = ${Number.isFinite(piece.from) ? piece.from : before.to}`);
      }
    }
  }
}

/**
 * Intervals marked on a plot's axes (a domain on the x-axis, a range on the y-axis), drawn like the
 * number line's: `from` and `to` are finite or null (unbounded), each finite end closed or open. One
 * value is an interval from it to itself, closed at both ends.
 */
function validatePlotIntervals(content: JsonObject, path: string): void {
  if (content.intervals === undefined) return;
  requireArray(content.intervals, `${path}/content/intervals`);
  if (content.intervals.length > 8) fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/intervals`, "A plot marks at most 8 intervals");
  content.intervals.forEach((interval: unknown, index: number) => {
    const intervalPath = `${path}/content/intervals/${index}`;
    requireObject(interval, intervalPath);
    for (const field of Object.keys(interval)) {
      if (!["as", "id", "axis", "from", "to", "from_closed", "to_closed", "label"].includes(field)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${intervalPath}/${field}`, `Unknown interval field '${field}'`);
    }
    if (interval.axis !== "x" && interval.axis !== "y") fail("OLL_INVALID_OPERATION_PAYLOAD", `${intervalPath}/axis`, "An interval lies on the x or the y axis");
    if (!("from" in interval) || !("to" in interval)) fail("OLL_INVALID_OPERATION_PAYLOAD", intervalPath, "An interval has from and to (null for an unbounded end)");
    for (const end of ["from", "to"] as const) {
      if (interval[end] !== null) requireFiniteNumber(interval[end], `${intervalPath}/${end}`);
      const closed = interval[`${end}_closed`];
      if (closed !== undefined && typeof closed !== "boolean") fail("OLL_INVALID_OPERATION_PAYLOAD", `${intervalPath}/${end}_closed`, "An end is closed (true) or open (false)");
      if (closed !== undefined && interval[end] === null) fail("OLL_INVALID_OPERATION_PAYLOAD", `${intervalPath}/${end}_closed`, `An unbounded end has no ${end}_closed`);
    }
    if (interval.from !== null && interval.to !== null) {
      const from = Number(interval.from), to = Number(interval.to);
      if (from > to) fail("OLL_INVALID_OPERATION_PAYLOAD", intervalPath, "An interval needs from <= to");
      if (from === to && (interval.from_closed === false || interval.to_closed === false)) fail("OLL_INVALID_OPERATION_PAYLOAD", intervalPath, "A single value is closed at both ends");
    }
    if (interval.label !== undefined && (typeof interval.label !== "string" || interval.label.length > 64)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${intervalPath}/label`, "An interval label is text up to 64 characters");
  });
}

function validatePlotContent(
  action: WriteAction,
  path: string,
  variables: Map<string, number>,
): void {
  if (action.kind !== "plot" || !Array.isArray(action.content.curves)) return;
  const axes = action.content.axes ?? {};
  if (axes.layout !== undefined && (axes.layout !== "adaptive" || axes.equal_scale !== true)) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/axes/layout`, "Adaptive plot layout requires equal_scale=true");
  }
  if (axes.follow_samples !== undefined && typeof axes.follow_samples !== "boolean") {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/axes/follow_samples`, "Sample following must be a boolean");
  }
  for (const axis of ["x", "y"] as const) {
    const ticks = (axes[axis] as Record<string, unknown> | undefined)?.ticks;
    if (ticks !== undefined && ticks !== "pi") {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/axes/${axis}/ticks`, "Axis ticks may only be \"pi\"");
    }
  }
  (action.content.curves as unknown[]).forEach((curve, index) => {
    const holes = (curve as Record<string, unknown> | null)?.holes;
    if (holes === undefined) return;
    if (!Array.isArray(holes) || holes.length > 16 || !holes.every(hole => hole && typeof hole === "object"
      && Number.isFinite((hole as Record<string, unknown>).x) && Number.isFinite((hole as Record<string, unknown>).y))) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/curves/${index}/holes`, "Curve holes are up to 16 finite {x, y} points");
    }
  });
  const plotRange = (
    value: unknown,
    rangePath: string,
    fallback: { min: number; max: number },
  ): { min: number; max: number } => {
    if (value === undefined) return fallback;
    requireObject(value, rangePath);
    const min = requireFiniteNumber(value.min, `${rangePath}/min`);
    const max = requireFiniteNumber(value.max, `${rangePath}/max`);
    if (max <= min) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", rangePath, "Plot range max must be greater than min");
    }
    return { min, max };
  };
  const xRange = plotRange(axes.x, `${path}/content/axes/x`, { min: -5, max: 5 });
  const yRange = plotRange(axes.y, `${path}/content/axes/y`, { min: -5, max: 5 });
  validatePlotIntervals(action.content, path);
  validateSeriesPieces(action.content.curves, path);
  action.content.curves.forEach((rawCurve: unknown, index: number) => {
    const curvePath = `${path}/content/curves/${index}`;
    requireObject(rawCurve, curvePath);
    const curve = rawCurve;
    requireString(curve.expression, `${curvePath}/expression`);
    validateCurveInterval(curve, curvePath);
    if (curve.kind !== "implicit") {
      const expression = curve.expression.trim().replace(/^y\s*=/iu, "").trim();
      try {
        compileMathExpression(expression, ["x", ...variables.keys()]);
      } catch (error) {
        fail(
          "OLL_INVALID_OPERATION_PAYLOAD",
          `${curvePath}/expression`,
          `Invalid plot expression: ${(error as Error).message}`,
        );
      }
      return;
    }
    const level = curve.level === undefined
      ? 0
      : requireFiniteNumber(curve.level, `${curvePath}/level`);
    const sampleCount = Number(curve.samples ?? 80);
    if (!Number.isInteger(sampleCount) || sampleCount < 16 || sampleCount > 200) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${curvePath}/samples`, "Implicit plot samples must be an integer from 16 to 200");
    }
    try {
      const evaluate = compileMathExpression(
        curve.expression,
        ["x", "y", ...variables.keys()],
      );
      const values = Object.fromEntries(variables);
      let minimum = Infinity;
      let maximum = -Infinity;
      for (let xIndex = 0; xIndex <= sampleCount; xIndex += 1) {
        const x = xRange.min + (xRange.max - xRange.min) * xIndex / sampleCount;
        for (let yIndex = 0; yIndex <= sampleCount; yIndex += 1) {
          const y = yRange.min + (yRange.max - yRange.min) * yIndex / sampleCount;
          const result = evaluate({ ...values, x, y });
          if (!Number.isFinite(result)) continue;
          minimum = Math.min(minimum, result);
          maximum = Math.max(maximum, result);
        }
      }
      if (!Number.isFinite(minimum) || minimum > level || maximum < level) {
        throw new Error("the requested level has no visible contour in the plot range");
      }
    } catch (error) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${curvePath}/expression`, `Invalid implicit plot expression: ${(error as Error).message}`);
    }
  });
}

function validateImageResource(action: WriteAction, path: string, resourceContext: ResourceContext | null): void {
  if (action.kind !== "image") return;
  const assetId = action.content?.asset_id;
  if (typeof assetId !== "string" || assetId.length === 0) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/asset_id`, "Image requires a controlled asset_id");
  }
  if (!resourceContext) return;
  const asset = resourceContext.assets?.find((candidate) => candidate.asset_id === assetId);
  if (!asset) fail("OLL_RESOURCE_DENIED", `${path}/content/asset_id`, `Asset '${assetId}' is not available in Session Context`);
  const allowedRegions = new Set((asset.regions ?? []).map((region) => region.region_id));
  (action.content.regions ?? []).forEach((region: JsonObject, index: number) => {
    if (!allowedRegions.has(region.source_region)) {
      fail("OLL_RESOURCE_DENIED", `${path}/content/regions/${index}/source_region`, `Region '${region.source_region}' is not available for '${assetId}'`);
    }
  });
}

// Learner ink is shown from a frozen snapshot of the learner's own selection,
// never from the live ink document, so replay cannot change with later writing.
function validateInkResource(action: WriteAction, path: string, resourceContext: ResourceContext | null): void {
  if (action.kind !== "ink") return;
  const content = action.content;
  if (content.annotation !== undefined && action.place.relation !== "annotates") {
    fail("OLL_INVALID_PLACEMENT", `${path}/content/annotation`, "Only an annotation carries a position on its anchor");
  }
  if (action.place.relation === "annotates" && content.annotation === undefined) {
    fail("OLL_INVALID_PLACEMENT", `${path}/content/annotation`, "An annotation needs its position on the anchor");
  }
  if (content.shown_strokes !== undefined && (!Number.isInteger(content.shown_strokes) || content.shown_strokes < 1)) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/content/shown_strokes`, "shown_strokes is a whole number of strokes, at least 1");
  }
  validateDrawnSize(content.drawn_size, `${path}/content/drawn_size`);
  if (!resourceContext) return;
  const snapshot = resourceContext.ink_snapshots?.find((candidate) => candidate.snapshot_id === content.snapshot_id);
  if (!snapshot) fail("OLL_RESOURCE_DENIED", `${path}/content/snapshot_id`, `Ink snapshot '${content.snapshot_id}' is not available in Session Context`);
  if (snapshot.sha256 !== content.sha256) fail("OLL_RESOURCE_DENIED", `${path}/content/sha256`, `Ink snapshot '${content.snapshot_id}' does not match its checksum`);
  const allowed = new Set(snapshot.selection_ids ?? []);
  (content.selections ?? []).forEach((selection: JsonObject, index: number) => {
    if (!allowed.has(selection.selection_id)) {
      fail("OLL_RESOURCE_DENIED", `${path}/content/selections/${index}/selection_id`, `Selection '${selection.selection_id}' is not part of '${content.snapshot_id}'`);
    }
  });
}

/** Ink keeps the size it was drawn at, in board units (player 0.9.0). */
function validateDrawnSize(size: unknown, path: string): void {
  if (size === undefined) return;
  const value = size as { width?: unknown; height?: unknown };
  const fine = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 4000;
  if (!size || typeof size !== "object" || Array.isArray(size) || !fine(value.width) || !fine(value.height)
    || Object.keys(size).some((key) => key !== "width" && key !== "height")) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", path, "drawn_size is { width, height } in board units, each above 0 and at most 4000");
  }
}

function validatePlacement(place: Placement, path: string, registry: Registry): void {
  requireObject(place, path);
  if (!PLACEMENT_RELATIONS.has(place.relation)) {
    fail("OLL_INVALID_PLACEMENT", `${path}/relation`, `Unknown placement relation '${place.relation}'`);
  }
  for (const forbidden of ["x", "y", "width", "height", "zoom", "duration_ms"]) {
    if (forbidden in place) fail("OLL_INVALID_PLACEMENT", `${path}/${forbidden}`, `Authoring Profile cannot set '${forbidden}'`);
  }
  if (place.relation === "continues") {
    const offset = place.offset as { x?: unknown; y?: unknown } | undefined;
    const fine = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 4000;
    if (!offset || typeof offset !== "object" || Array.isArray(offset) || !fine(offset.x) || !fine(offset.y)
      || Object.keys(offset).some((key) => key !== "x" && key !== "y")) {
      fail("OLL_INVALID_PLACEMENT", `${path}/offset`, "A continuation needs its offset { x, y } from the anchor's top-left, in board units within ±4000");
    }
  } else {
    if (place.offset !== undefined) fail("OLL_INVALID_PLACEMENT", `${path}/offset`, "Only a continuation has an offset");
    if (place.align === "equals" && place.relation !== "replaces") fail("OLL_INVALID_PLACEMENT", `${path}/align`, "Only a continuation, or what replaces one, lines up its '='");
  }
  if (place.relation === "new_region") {
    if (place.anchor !== undefined) fail("OLL_INVALID_PLACEMENT", `${path}/anchor`, "new_region cannot use an anchor");
  } else if (place.relation === "annotates" || place.relation === "replaces" || place.relation === "continues") {
    // All attach to one card: an annotation moves with it; a replacement takes
    // its place; a continuation grows it, where the learner drew.
    resolveLocal(registry, place.anchor, `${path}/anchor`, ["node"]);
  } else {
    resolveLocal(registry, place.anchor, `${path}/anchor`, ["node", "group"]);
  }
}

function validateActionPayload(action: AuthoringAction, path: string): void {
  for (const field of Object.keys(action)) {
    if (!ACTION_FIELDS.has(field)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/${field}`, `Unknown action field '${field}'`);
  }
  if (action.do !== "write" && "source" in action) {
    fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/source`, "Only a new card has a source");
  }
  if (action.do === "write") {
    requireAlias(action.as, `${path}/as`);
    requireString(action.kind, `${path}/kind`);
    requireString(action.role, `${path}/role`);
    requireObject(action.content, `${path}/content`);
    requireObject(action.place, `${path}/place`);
  } else if (action.do === "revise") {
    requireString(action.target, `${path}/target`);
    requireObject(action.content, `${path}/content`);
    if (action.content.bindings !== undefined) {
      fail("OLL_INVALID_BINDING", `${path}/content/bindings`, "Authoring bindings must be declared when a geometry or plot node is created");
    }
    requireString(action.reason, `${path}/reason`);
  } else if (action.do === "emphasize") {
    requireString(action.target, `${path}/target`);
    requireString(action.emphasis, `${path}/emphasis`);
  } else if (action.do === "connect") {
    requireAlias(action.as, `${path}/as`);
    requireString(action.from, `${path}/from`);
    requireString(action.to, `${path}/to`);
    requireString(action.relation, `${path}/relation`);
  } else if (action.do === "group") {
    requireAlias(action.as, `${path}/as`);
    requireString(action.role, `${path}/role`);
    requireString(action.label, `${path}/label`);
    requireArray(action.members, `${path}/members`);
  } else if (action.do === "focus") {
    requireArray(action.targets, `${path}/targets`);
    requireString(action.intent, `${path}/intent`);
  } else if (action.do === "point" || action.do === "hide") {
    requireString(action.target, `${path}/target`);
  } else if (action.do === "view") {
    requireString(action.target, `${path}/target`);
    if ((action.show === undefined) === (action.preset === undefined)) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", path, "A view shows either one highlighted part or one preset");
    }
  } else if (action.do === "expression") {
    requireString(action.expression, `${path}/expression`);
  } else if (action.do === "tap") {
    requireString(action.target, `${path}/target`);
    // The target is not resolved yet: a tap and a place some tap card has (its own card checks them when played).
    if (!Object.values(TAP_CARD_KINDS).some((card) => card.taps.includes(action.tap))) fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/tap`, `Unknown tap '${String(action.tap)}'`);
    if (!Object.values(TAP_CARD_KINDS).some((card) => card.places.includes(action.at))) fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/at`, `Unknown place '${String(action.at)}'`);
  } else if (action.do === "animate") {
    requireVariableAlias(action.variable, `${path}/variable`);
    requireFiniteNumber(action.value, `${path}/value`);
    if (action.easing !== undefined && !ANIMATION_EASINGS.has(action.easing)) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/easing`, `Unknown animation easing '${action.easing}'`);
    }
    if (action.duration_intent !== undefined && !ANIMATION_DURATION_INTENTS.has(action.duration_intent)) {
      fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/duration_intent`, `Unknown animation duration intent '${action.duration_intent}'`);
    }
  }
}

function resolveLocal(
  registry: Registry,
  value: unknown,
  path: string,
  allowedTypes: RegistryEntryType[] | null = null,
): { alias: string; fragment?: string; type: RegistryEntryType } {
  const { alias, fragment } = splitTarget(value, path);
  const entry = registry.get(alias);
  if (!entry) {
    fail("OLL_REFERENCE_NOT_FOUND", path, `Alias '${alias}' is not defined before use`);
  }
  if (allowedTypes && !allowedTypes.includes(entry.type)) {
    fail("OLL_INVALID_REFERENCE", path, `Alias '${alias}' has type '${entry.type}'`);
  }
  if (fragment && !entry.fragments.has(fragment)) {
    fail("OLL_REFERENCE_NOT_FOUND", path, `Fragment '${fragment}' does not exist on '${alias}'`);
  }
  return { alias, fragment, type: entry.type };
}

export function validateAuthoringSchema(document: unknown): SchemaValidationResult {
  const valid = validateAuthoringDocument(document);
  return {
    valid: Boolean(valid),
    errors: (validateAuthoringDocument.errors ?? []).map((error: ErrorObject) => ({
      instancePath: error.instancePath,
      schemaPath: error.schemaPath,
      keyword: error.keyword,
      message: error.message ?? "Schema validation failed",
    })),
  };
}

export function assertAuthoringSchema(document: unknown): asserts document is AuthoringLesson {
  const result = validateAuthoringSchema(document);
  if (!result.valid) {
    const first = result.errors[0];
    fail("OLL_SCHEMA_INVALID", first?.instancePath ?? "", first?.message ?? "Authoring Schema validation failed");
  }
}

export function parseAuthoringLessonJson(
  source: string,
  resourceContext: ResourceContext | null = null,
): AuthoringLesson {
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    fail("OLL_INVALID_JSON", "", message);
  }
  assertAuthoringSchema(document);
  validateAuthoringLesson(document, resourceContext);
  return document;
}

export function validateAuthoringLesson(document: AuthoringLesson, resourceContext: ResourceContext | null = null): { registry: Registry } {
  requireObject(document, "");
  if (document.dsl !== "octos.lesson" || document.version !== "0.1" || document.profile !== "authoring") {
    fail("OLL_UNSUPPORTED_PROFILE", "", "Expected octos.lesson 0.1 Authoring Profile");
  }
  requireObject(document.lesson, "/lesson");
  requireArray(document.lesson.goals, "/lesson/goals");
  validateLessonAuthor(document);
  const lessonVariables = validateLessonVariables(document);
  const availableStudentControls = new Map<string, Set<string>>();
  // Variables a learner drags on a number line, with the line whose ticks the drag snaps to.
  const numberLineGrids = new Map<string, NumberLineContent>();
  const scene3dCameras = new Map<string, { yaw: number; pitch: number; zoom: number }>();
  for (const variable of document.lesson.variables ?? []) {
    if (variable.control?.kind === "slider") {
      availableStudentControls.set(variable.as, new Set(["slider"]));
    }
  }
  requireArray(document.steps, "/steps");
  requireObject(document.close, "/close");
  requireArray(document.close.focus, "/close/focus");

  const registry: Registry = new Map();
  // Learner-taught lessons may hide or replace the learner's own cards; hidden
  // cards cannot be referenced again, and ink revisions must stay ink.
  const hidden = new Set<string>();
  // Learner ink cards, with how each was placed: a revision keeps the placement.
  const inkNodes = new Map<string, Placement["relation"]>();
  // Number lines of this lesson, so a revision is checked by the same rules (decision 0013).
  const numberLineNodes = new Set<string>();
  const fractionModelNodes = new Set<string>();
  /** Cards the learner (or a demonstration) taps, by alias, each with its kind and content as written. */
  const tapCards = new Map<string, LessonTapCard>();
  /** Cards shown by a demonstration field, wherever written, so a beat before the card is checked too. */
  const shownCards = demonstrationCards(document);
  /** Cards the lesson taps; their counts change only by taps (review of #89). */
  const tappedCards = new Set<string>();
  /** Lesson variables as playback leaves them, so each demonstration tap is checked in the state it meets. */
  const playedValues: Record<string, number> = Object.fromEntries((document.lesson.variables ?? []).map((variable) => [variable.as, variable.initial]));
  // Highlighted parts of each 3D scene, which a view can turn to show.
  const scene3dHighlights = new Map<string, Set<string>>();
  // A card made from ink names a selection the lesson's ink or Session Context provides.
  const knownSelections = new Set<string>((resourceContext?.ink_snapshots ?? []).flatMap((snapshot) => snapshot.selection_ids ?? []));
  const requireLearnerTaught = (path: string, what: string) => {
    if (!isLearnerTaught(document)) fail("OLL_INVALID_OPERATION", path, `${what} is only available in learner-taught lessons`);
  };
  const requireVisible = (value: unknown, path: string) => {
    if (typeof value !== "string") return;
    const alias = value.split("#")[0]!;
    if (hidden.has(alias)) fail("OLL_INVALID_REFERENCE", path, `'${alias}' is hidden`);
  };
  if (document.board_context) {
    requireString(document.board_context.board_id, "/board_context/board_id");
    if (!Number.isSafeInteger(document.board_context.revision)
      || document.board_context.revision < 0) {
      fail("OLL_INVALID_REFERENCE", "/board_context/revision", "Board revision must be a non-negative integer");
    }
    if (!Array.isArray(document.board_context.references)) {
      fail("OLL_INVALID_REFERENCE", "/board_context/references", "Board references must be an array");
    }
    document.board_context.references.forEach((reference, index) => {
      const path = `/board_context/references/${index}`;
      requireAlias(reference.as, `${path}/as`);
      if (registry.has(reference.as)) {
        fail("OLL_DUPLICATE_ALIAS", `${path}/as`, `Alias '${reference.as}' is already defined`);
      }
      if (!["node", "group", "connection"].includes(reference.type)) {
        fail("OLL_INVALID_REFERENCE", `${path}/type`, `Unknown reference type '${reference.type}'`);
      }
      requireString(reference.target_id, `${path}/target_id`);
      if (!Array.isArray(reference.fragments)) {
        fail("OLL_INVALID_REFERENCE", `${path}/fragments`, "Reference fragments must be an array");
      }
      const fragmentIds = new Map<string, string>();
      reference.fragments.forEach((fragment, fragmentIndex) => {
        const fragmentPath = `${path}/fragments/${fragmentIndex}`;
        requireAlias(fragment.as, `${fragmentPath}/as`);
        requireString(fragment.target_id, `${fragmentPath}/target_id`);
        if (fragmentIds.has(fragment.as)) {
          fail("OLL_DUPLICATE_ALIAS", `${fragmentPath}/as`, `Fragment '${fragment.as}' is duplicated`);
        }
        fragmentIds.set(fragment.as, fragment.target_id);
      });
      if (reference.type !== "node" && fragmentIds.size > 0) {
        fail("OLL_INVALID_REFERENCE", `${path}/fragments`, "Only node references can expose fragments");
      }
      registry.set(reference.as, {
        type: reference.type,
        id: reference.target_id,
        fragments: new Set(fragmentIds.keys()),
        fragmentIds,
        external: true,
      });
    });
  }
  const stepKeys = new Set();

  document.steps.forEach((step, stepIndex) => {
    const stepPath = `/steps/${stepIndex}`;
    requireObject(step, stepPath);
    requireAlias(step.key, `${stepPath}/key`);
    if (stepKeys.has(step.key)) fail("OLL_DUPLICATE_ALIAS", `${stepPath}/key`, `Step '${step.key}' is duplicated`);
    stepKeys.add(step.key);
    requireArray(step.beats, `${stepPath}/beats`);
    const beatKeys = new Set();

    step.beats.forEach((beat, beatIndex) => {
      const beatPath = `${stepPath}/beats/${beatIndex}`;
      requireObject(beat, beatPath);
      requireAlias(beat.key, `${beatPath}/key`);
      if (beatKeys.has(beat.key)) fail("OLL_DUPLICATE_ALIAS", `${beatPath}/key`, `Beat '${beat.key}' is duplicated`);
      beatKeys.add(beat.key);
      if (!Array.isArray(beat.actions)) fail("OLL_INVALID_TYPE", `${beatPath}/actions`, "Expected an array");
      // A learner says each sentence as its own beat; one with nothing done on the board is words only.
      if (!beat.actions.length && !(isLearnerTaught(document) && beat.say?.trim())) {
        fail("OLL_INVALID_OPERATION_PAYLOAD", `${beatPath}/actions`, "A beat needs at least one action; only a learner-taught beat may be words alone");
      }
      if (beat.start) {
        if (beat.start.kind === "practice") fail("OLL_INVALID_PHASE_START", `${beatPath}/start`, "Practice belongs on a student task");
        resolvePhaseStart(beat.start, document.lesson.variables ?? [], `${beatPath}/start`);
      }

      beat.actions.forEach((action, actionIndex) => {
        const actionPath = `${beatPath}/actions/${actionIndex}`;
        requireObject(action, actionPath);
        if (!ACTIONS.has(action.do)) fail("OLL_INVALID_OPERATION", `${actionPath}/do`, `Unknown action '${action.do}'`);
        validateActionPayload(action, actionPath);
        const phase = action.when ?? "during_speech";
        if (!PHASES.has(phase)) fail("OLL_INVALID_PHASE", `${actionPath}/when`, `Unknown phase '${phase}'`);

        if (action.do === "write") {
          requireAlias(action.as, `${actionPath}/as`);
          requireObject(action.content, `${actionPath}/content`);
          validatePlacement(action.place, `${actionPath}/place`, registry);
          if (action.kind === "ink") requireLearnerTaught(`${actionPath}/kind`, "Learner ink");
          if (action.place.relation === "annotates") {
            requireLearnerTaught(`${actionPath}/place/relation`, "Annotating a card");
            if (action.kind !== "ink") fail("OLL_INVALID_PLACEMENT", `${actionPath}/place/relation`, "Only learner ink annotates a card");
          }
          if (action.place.anchor !== undefined) requireVisible(action.place.anchor, `${actionPath}/place/anchor`);
          if (action.place.relation === "replaces" && action.place.align === "equals" && action.kind !== "math") {
            fail("OLL_INVALID_PLACEMENT", `${actionPath}/place/align`, "Only math lines up its '='");
          }
          if (action.place.relation === "continues") {
            requireLearnerTaught(`${actionPath}/place/relation`, "Continuing a card");
            if (action.kind !== "ink" && action.kind !== "math") fail("OLL_INVALID_PLACEMENT", `${actionPath}/place/relation`, "Only learner ink or math continues a card");
            if (action.place.align === "equals" && action.kind !== "math") fail("OLL_INVALID_PLACEMENT", `${actionPath}/place/align`, "Only math lines up its '='");
          }
          if (action.place.relation === "replaces") {
            requireLearnerTaught(`${actionPath}/place/relation`, "Replacing a card");
            if (registry.get(action.place.anchor!)?.external) {
              fail("OLL_INVALID_REFERENCE", `${actionPath}/place/anchor`, "External board references are read-only");
            }
            hidden.add(action.place.anchor!);
          }
          validateInkResource(action, actionPath, resourceContext);
          if (action.kind === "ink") {
            inkNodes.set(action.as, action.place.relation);
            for (const selection of (action.content.selections ?? []) as JsonObject[]) knownSelections.add(selection.selection_id);
          }
          if (action.source !== undefined) {
            requireLearnerTaught(`${actionPath}/source`, "A learner-confirmed source");
            if (!knownSelections.has(action.source.selection)) {
              fail("OLL_REFERENCE_NOT_FOUND", `${actionPath}/source/selection`, `Selection '${action.source.selection}' is not part of this lesson's ink`);
            }
          }
          const fragments = collectAddressableContent(action.content, `${actionPath}/content`);
          const uniqueFragments = new Set<string>();
          for (const fragment of fragments) {
            requireAlias(fragment, `${actionPath}/content`);
            if (uniqueFragments.has(fragment)) fail("OLL_DUPLICATE_ALIAS", `${actionPath}/content`, `Fragment '${fragment}' is duplicated`);
            uniqueFragments.add(fragment);
          }
          validateStructuredContent(action.content, `${actionPath}/content`, uniqueFragments);
          validateImageResource(action, actionPath, resourceContext);
          validateGeometryContent(action, actionPath, lessonVariables);
          validatePlotContent(action, actionPath, lessonVariables);
          validateScene3dContent(action, actionPath, lessonVariables);
          if (action.kind === NUMBER_LINE_KIND) {
            numberLineNodes.add(action.as);
            validateNumberLineContent(action.content, `${actionPath}/content`, (failPath, message) => fail("OLL_INVALID_OPERATION_PAYLOAD", failPath, message));
            for (const [pointIndex, point] of ((action.content.points ?? []) as JsonObject[]).entries()) {
              const variable = point.interaction?.variable;
              if (typeof variable !== "string") continue;
              const pointPath = `${actionPath}/content/points/${pointIndex}/interaction/variable`;
              if (!lessonVariables.has(variable)) fail("OLL_REFERENCE_NOT_FOUND", pointPath, `Variable '${variable}' is not declared`);
              // The learner drags the point to set the variable, so the point must follow the variable itself.
              const bound = ((action.content.bindings ?? []) as JsonObject[]).some((binding) =>
                binding.target === `${point.as}.value` && String(binding.expression).trim() === variable);
              if (!bound) fail("OLL_INVALID_BINDING", pointPath, `A draggable point is bound to its variable: add {"target": "${point.as}.value", "expression": "${variable}"}`);
              if (numberLineGrids.has(variable)) fail("OLL_INVALID_OPERATION_PAYLOAD", pointPath, `Variable '${variable}' is already dragged on a number line`);
              numberLineGrids.set(variable, action.content as unknown as NumberLineContent);
              const controls = availableStudentControls.get(variable) ?? new Set<string>();
              controls.add("number_line_point");
              availableStudentControls.set(variable, controls);
            }
          }
          if (action.kind === FRACTION_MODEL_KIND) {
            fractionModelNodes.add(action.as);
            validateFractionModelContent(action.content, `${actionPath}/content`, (failPath, message) => fail("OLL_INVALID_OPERATION_PAYLOAD", failPath, message));
          }
          const tapCard = tapCardKind(action.kind);
          if (tapCard) {
            tapCards.set(action.as, { kind: tapCard, content: action.content });
            tapCard.validateContent(action.content, `${actionPath}/content`, (failPath, message) => fail("OLL_INVALID_OPERATION_PAYLOAD", failPath, message));
          }
          if (action.kind === "scene3d") {
            scene3dHighlights.set(action.as, new Set(((action.content.highlights ?? []) as JsonObject[]).map((highlight) => highlight.as as string)));
            const camera = action.content.camera as UnknownRecord;
            scene3dCameras.set(action.as, {
              yaw: camera.yaw as number,
              pitch: camera.pitch as number,
              zoom: camera.zoom as number,
            });
          }
          if (action.kind === "geometry" && Array.isArray(action.content.points)) {
            for (const point of action.content.points) {
              const interaction = point?.interaction;
              if (interaction?.kind !== "angle_control" || typeof interaction.variable !== "string") continue;
              const controls = availableStudentControls.get(interaction.variable) ?? new Set<string>();
              controls.add("geometry_point");
              availableStudentControls.set(interaction.variable, controls);
            }
          }
          validateValueBindings(action, actionPath, lessonVariables);
          if (tapCard?.demonstration) requirePlainCardBindings(tapCard, action.content, actionPath);
          if (action.kind === NUMBER_LINE_KIND) checkNumberLineBoundValues(action.content, `${actionPath}/content`, document.lesson.variables ?? []);
          if (action.kind === FRACTION_MODEL_KIND) checkFractionModelBoundValues(action.content, `${actionPath}/content`, document.lesson.variables ?? []);
          if (action.kind === BASE_TEN_TRADE_KIND) checkBaseTenTradeBoundValues(action.content, `${actionPath}/content`, document.lesson.variables ?? []);
          if (action.kind === PLACE_VALUE_CHART_KIND) checkPlaceValueChartBoundValues(action.content, `${actionPath}/content`, document.lesson.variables ?? []);
          if (action.kind === PLACE_VALUE_TRADE_KIND) checkPlaceValueTradeBoundValues(action.content, `${actionPath}/content`, document.lesson.variables ?? []);
          // A card with starting rules is checked as its variables start it, not only as written (review of #111).
          if (tapCard?.validateStart && Array.isArray(action.content.bindings)) {
            const initials = Object.fromEntries((document.lesson.variables ?? []).map((variable) => [variable.as, variable.initial]));
            tapCard.validateContent(cardContentAt(tapCard, action.content, bareBindings(action.content), initials), `${actionPath}/content`,
              (failPath, message) => fail("OLL_INVALID_OPERATION_PAYLOAD", failPath, `As its variables start it: ${message}`));
          }
          register(registry, action.as, "node", `${actionPath}/as`, fragments);
          return;
        }

        if (action.do === "tap") {
          const target = resolveLocal(registry, action.target, `${actionPath}/target`, ["node"]);
          const card = tapCards.get(target.alias);
          if (!card || target.fragment) fail("OLL_INVALID_REFERENCE", `${actionPath}/target`, `A tap acts on a whole ${lessonTapCardKindList()} card of this lesson`);
          // The model never names a control (decision 0026): such a card is shown by its demonstration field.
          if (card.kind.demonstration) {
            fail("OLL_INVALID_OPERATION", `${actionPath}/do`, `A ${card.kind.kind} card is not tapped by the lesson: animate the variable bound to its '${card.kind.demonstration.field}' (columns finished, counting from the right), and the program plays each column`);
          }
          requireVisible(action.target, `${actionPath}/target`);
          // The tap and place the shape check let through are this card's own (always so with one kind of tap card).
          if (!card.kind.taps.includes(action.tap)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${actionPath}/tap`, `Unknown tap '${String(action.tap)}'`);
          if (!card.kind.places.includes(action.at)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${actionPath}/at`, `Unknown place '${String(action.at)}'`);
          cardTapVariables(card.kind, card.content, document.lesson.variables ?? [], `${actionPath}/target`);
          tappedCards.add(target.alias);
          return;
        }

        if (action.do === "animate") {
          const variable = document.lesson.variables?.find((candidate) => candidate.as === action.variable);
          if (!variable) fail("OLL_REFERENCE_NOT_FOUND", `${actionPath}/variable`, `Variable '${action.variable}' is not declared`);
          if (action.value < variable.min || action.value > variable.max) {
            // A card's demonstration field says its own range (decision 0026: columns finished, 0 to the columns).
            const shown = [...shownCards.values()].find(({ kind, content }) => kind.demonstration && bareBindings(content).get(kind.demonstration.field) === action.variable);
            if (shown?.kind.demonstration) {
              const { min, max } = shown.kind.demonstration.range(shown.content);
              fail("OLL_INVALID_VARIABLE", `${actionPath}/value`, `'${action.variable}' counts the columns a ${shown.kind.kind} card has finished: ${min} to ${max}, not ${action.value}`);
            }
            fail("OLL_INVALID_VARIABLE", `${actionPath}/value`, `Animation target for '${action.variable}' is outside its range`);
          }
          return;
        }

        if (["emphasize", "point"].includes(action.do)) {
          resolveLocal(registry, (action as EmphasizeAction | PointAction).target, `${actionPath}/target`, ["node", "connection", "group"]);
          requireVisible((action as EmphasizeAction | PointAction).target, `${actionPath}/target`);
          return;
        }

        if (action.do === "view") {
          const target = resolveLocal(registry, action.target, `${actionPath}/target`, ["node"]);
          const highlights = scene3dHighlights.get(target.alias);
          if (!highlights || target.fragment) fail("OLL_INVALID_REFERENCE", `${actionPath}/target`, "A view turns a whole 3D scene of this lesson");
          requireVisible(action.target, `${actionPath}/target`);
          if (action.show !== undefined) {
            const shown = resolveLocal(registry, action.show, `${actionPath}/show`, ["node"]);
            if (shown.alias !== target.alias || !shown.fragment || !highlights.has(shown.fragment)) {
              fail("OLL_INVALID_REFERENCE", `${actionPath}/show`, "A view shows a highlighted part of the same scene");
            }
          }
          return;
        }

        if (action.do === "hide") {
          requireLearnerTaught(`${actionPath}/do`, "Hiding a card");
          const resolved = resolveLocal(registry, action.target, `${actionPath}/target`, ["node"]);
          if (resolved.fragment) fail("OLL_INVALID_REFERENCE", `${actionPath}/target`, "Hide a whole card, not part of it");
          if (registry.get(resolved.alias)?.external) {
            fail("OLL_INVALID_REFERENCE", `${actionPath}/target`, "External board references are read-only");
          }
          requireVisible(action.target, `${actionPath}/target`);
          hidden.add(resolved.alias);
          return;
        }

        if (action.do === "revise") {
          const resolved = resolveLocal(registry, action.target, `${actionPath}/target`, ["node"]);
          if (registry.get(resolved.alias)?.external) {
            fail("OLL_INVALID_REFERENCE", `${actionPath}/target`, "External board references are read-only");
          }
          requireVisible(action.target, `${actionPath}/target`);
          if (inkNodes.has(resolved.alias)) {
            // Erasing and rewriting shows a newer snapshot of the same ink.
            validateInkResource({ do: "write", as: resolved.alias, kind: "ink", role: "ink", content: action.content, place: { relation: inkNodes.get(resolved.alias)! } } as WriteAction, actionPath, resourceContext);
          }
          if (numberLineNodes.has(resolved.alias)) {
            validateNumberLineContent(action.content, `${actionPath}/content`, (failPath, message) => fail("OLL_INVALID_OPERATION_PAYLOAD", failPath, message));
            if (((action.content.points ?? []) as JsonObject[]).some((point) => point.interaction !== undefined)) {
              fail("OLL_INVALID_OPERATION_PAYLOAD", `${actionPath}/content/points`, "A draggable point is declared when the number line is written");
            }
          }
          if (fractionModelNodes.has(resolved.alias)) {
            validateFractionModelContent(action.content, `${actionPath}/content`, (failPath, message) => fail("OLL_INVALID_OPERATION_PAYLOAD", failPath, message));
          }
          const revisedCard = tapCards.get(resolved.alias);
          if (revisedCard) {
            // A revision replaces the content and cannot carry bindings, so a bound mat would freeze (review of #87).
            if (Array.isArray(revisedCard.content.bindings)) {
              fail("OLL_INVALID_OPERATION_PAYLOAD", `${actionPath}/target`, revisedCard.kind.kind === BASE_TEN_TRADE_KIND
                ? "A trading card bound to lesson variables is not revised: its counts change by taps"
                : `A ${revisedCard.kind.kind} card bound to lesson variables is not revised: its fields change by taps and task starts`);
            }
            revisedCard.kind.validateContent(action.content, `${actionPath}/content`, (failPath, message) => fail("OLL_INVALID_OPERATION_PAYLOAD", failPath, message));
          }
          // A revision that declares addressable parts (a point added to a
          // grid) makes exactly those parts addressable from then on; one that
          // declares none keeps the card's existing parts.
          const revisedFragments = collectAddressableContent(action.content, `${actionPath}/content`);
          if (revisedFragments.length) {
            const unique = new Set<string>();
            for (const fragment of revisedFragments) {
              requireAlias(fragment, `${actionPath}/content`);
              if (unique.has(fragment)) fail("OLL_DUPLICATE_ALIAS", `${actionPath}/content`, `Fragment '${fragment}' is duplicated`);
              unique.add(fragment);
            }
            validateStructuredContent(action.content, `${actionPath}/content`, unique);
            registry.get(resolved.alias)!.fragments = unique;
          }
          return;
        }

        if (action.do === "connect") {
          resolveLocal(registry, action.from, `${actionPath}/from`);
          resolveLocal(registry, action.to, `${actionPath}/to`);
          requireVisible(action.from, `${actionPath}/from`);
          requireVisible(action.to, `${actionPath}/to`);
          register(registry, action.as, "connection", `${actionPath}/as`);
          return;
        }

        if (action.do === "group") {
          requireArray(action.members, `${actionPath}/members`);
          for (let index = 0; index < action.members.length; index += 1) {
            resolveLocal(registry, action.members[index], `${actionPath}/members/${index}`, ["node", "group"]);
          }
          register(registry, action.as, "group", `${actionPath}/as`);
          return;
        }

        if (action.do === "focus") {
          requireArray(action.targets, `${actionPath}/targets`);
          for (let index = 0; index < action.targets.length; index += 1) {
            resolveLocal(registry, action.targets[index], `${actionPath}/targets/${index}`, ["node", "group", "connection"]);
            requireVisible(action.targets[index], `${actionPath}/targets/${index}`);
          }
        }
      });
      // Play the beat's variable changes in playback order (a replay start, then each phase), so every
      // demonstration tap is checked by the card's rules in the state it will meet (decision 0023).
      if (beat.start?.kind === "replay") {
        const replayed = resolvePhaseStart(beat.start, document.lesson.variables ?? [], `${beatPath}/start`);
        checkDemonstrationReplay(shownCards, replayed, playedValues, `${beatPath}/start`);
        Object.assign(playedValues, replayed);
      }
      for (const phase of ["before_speech", "during_speech", "after_speech"] as const) {
        beat.actions.forEach((action, actionIndex) => {
          if ((action.when ?? "during_speech") !== phase) return;
          if (action.do === "animate") {
            checkDemonstrationAnimate(shownCards, action.variable, action.value, playedValues[action.variable], `${beatPath}/actions/${actionIndex}`);
            playedValues[action.variable] = action.value;
          }
          if (action.do !== "tap") return;
          const { kind, content } = tapCards.get(splitTarget(action.target, `${beatPath}/actions/${actionIndex}/target`).alias)!;
          const variables = cardTapVariables(kind, content, document.lesson.variables ?? [], `${beatPath}/actions/${actionIndex}/target`);
          const place = kind.places.indexOf(action.at);
          const state = kind.state(cardContentAt(kind, content, variables, playedValues));
          const result = kind.apply(state, { kind: action.tap, place });
          if (!result.ok) {
            fail("OLL_INVALID_OPERATION_PAYLOAD", `${beatPath}/actions/${actionIndex}`, `The card refuses this tap here: ${kind.refusalText(result.reason, place)}`);
          }
          for (const change of kind.changes(state, result.state)) {
            const alias = variables.get(kind.fieldTarget(content, change.place, change.field))!;
            const declaration = (document.lesson.variables ?? []).find((variable) => variable.as === alias)!;
            // The reducer writes the change to the variable, so it must lie in the variable's range (review of #89).
            if (change.after < declaration.min || change.after > declaration.max) {
              fail("OLL_INVALID_OPERATION_PAYLOAD", `${beatPath}/actions/${actionIndex}`, `This tap would make ${alias} ${change.after}, outside ${declaration.min} to ${declaration.max}`);
            }
            playedValues[alias] = change.after;
          }
        });
      }
    });
  });

  // A learner's slider or point on a tapped card's counts could leave a pile a later demonstration tap meets
  // differently than checked here (review of #89): those counts change only by taps.
  // A slider on a card's count moves by trades and is live only while a task that allows it is open
  // (amendment 4), so no learner changes the pile a demonstration tap meets.
  const cardSliders = cardSliderVariables(document, matCardContents(tapCards), availableStudentControls);
  for (const alias of tappedCards) {
    const card = tapCards.get(alias)!;
    for (const variable of cardTapVariables(card.kind, card.content, document.lesson.variables ?? [], `/content`).values()) {
      if (cardSliders.get(variable)?.card === alias) continue;
      if ((document.lesson.variables ?? []).find((declaration) => declaration.as === variable)?.control || availableStudentControls.get(variable)?.size) {
        fail("OLL_INVALID_VARIABLE", "/lesson/variables", `Variable '${variable}' is changed only by tapping the card; it cannot have its own control`);
      }
    }
  }
  validateStudentTasks(document, lessonVariables, availableStudentControls, scene3dCameras, registry, numberLineGrids, tapCards, cardSliders);
  validateReflections(document, registry);

  if (document.close?.focus) {
    for (let index = 0; index < document.close.focus.length; index += 1) {
      resolveLocal(registry, document.close.focus[index], `/close/focus/${index}`, ["node", "group", "connection"]);
      requireVisible(document.close.focus[index], `/close/focus/${index}`);
    }
  }

  return { registry };
}

function stableId(host: NormalizationHost, type: string, alias: string): string {
  return `${host.lessonId}:${type}:${alias}`;
}

function normalizeAddressableContent(_host: NormalizationHost, nodeId: string, content: JsonObject): JsonObject {
  const clone = structuredClone(content);
  for (const field of ["fragments", "curves", "points", "guides", "regions", "elements", "edges", "polygons", "regular_polygons", "circles", "segments", "arcs", "objects", "sections", "highlights", "selections", "jumps", "intervals", "fractions", "places"]) {
    if (!Array.isArray(clone?.[field])) continue;
    clone[field] = clone[field].map((item) => {
      if (!item.as) return item;
      const { as, ...rest } = item;
      const normalized = { id: `${nodeId}:fragment:${as}`, ...rest };
      if (field === "edges") {
        normalized.from = `${nodeId}:fragment:${item.from}`;
        normalized.to = `${nodeId}:fragment:${item.to}`;
      }
      if (field === "circles" || field === "regular_polygons") {
        normalized.center = `${nodeId}:fragment:${item.center}`;
      }
      if (field === "segments") {
        normalized.from = `${nodeId}:fragment:${item.from}`;
        normalized.to = `${nodeId}:fragment:${item.to}`;
      }
      if (field === "arcs") {
        normalized.center = `${nodeId}:fragment:${item.center}`;
      }
      // A number-line jump starts at a point of the same card, or at a value.
      if (field === "jumps" && typeof item.from === "string" && numberLineValue(item.from) === undefined) {
        normalized.from = `${nodeId}:fragment:${item.from}`;
      }
      if (field === "polygons" && Array.isArray(item.points)) {
        normalized.points = item.points.map((point: string) => `${nodeId}:fragment:${point}`);
      }
      if (field === "points" && item.interaction?.kind === "angle_control") {
        normalized.interaction = {
          ...structuredClone(item.interaction),
          center: `${nodeId}:fragment:${item.interaction.center}`,
        };
      }
      if (field === "regions" && Array.isArray(item.members)) {
        normalized.members = item.members.map((member: string) => `${nodeId}:fragment:${member}`);
      }
      if (field === "sections" && Array.isArray(item.targets)) {
        normalized.targets = item.targets.map((target: string) => `${nodeId}:fragment:${target}`);
      }
      return normalized;
    });
  }
  if (Array.isArray(clone.bindings)) {
    clone.bindings = clone.bindings.map((binding) => {
      // A card-level field keeps its bare name: it is the card's own, not a part's.
      const cardField = typeof binding.target === "string" && !binding.target.includes(".");
      const { alias, property } = cardField ? { alias: "", property: binding.target } : splitBindingTarget(binding.target, "content.bindings.target");
      return {
        target: cardField ? property : `${nodeId}:fragment:${alias}.${property}`,
        expression: binding.expression,
        ...(binding.label !== undefined ? { label: structuredClone(binding.label) } : {}),
        ...(binding.allow_zero === true ? { allow_zero: true } : {}),
        ...(binding.hide_when_undefined === true ? { hide_when_undefined: true } : {}),
      };
    });
  }
  return clone;
}

function buildCanonicalRegistry(document: AuthoringLesson, host: NormalizationHost): Registry {
  const registry: Registry = new Map();
  for (const reference of document.board_context?.references ?? []) {
    registry.set(reference.as, {
      type: reference.type,
      id: reference.target_id,
      fragments: new Set(reference.fragments.map((fragment) => fragment.as)),
      fragmentIds: new Map(reference.fragments.map((fragment) => [
        fragment.as,
        fragment.target_id,
      ])),
      external: true,
    });
  }
  for (const step of document.steps) {
    for (const beat of step.beats) {
      for (const action of beat.actions) {
        if (action.do === "write") {
          registry.set(action.as, {
            type: "node",
            id: stableId(host, "node", action.as),
            fragments: new Set(collectAddressableContent(action.content)),
          });
        } else if (action.do === "connect") {
          registry.set(action.as, { type: "connection", id: stableId(host, "connection", action.as), fragments: new Set() });
        } else if (action.do === "group") {
          registry.set(action.as, { type: "group", id: stableId(host, "group", action.as), fragments: new Set() });
        }
      }
    }
  }
  return registry;
}

function canonicalTarget(registry: Registry, value: string): CanonicalTarget {
  const { alias, fragment } = splitTarget(value, "target");
  const entry = registry.get(alias);
  if (!entry) fail("OLL_REFERENCE_NOT_FOUND", "target", `Unknown alias '${alias}'`);
  if (entry.type === "group") return { group_id: entry.id };
  if (entry.type === "connection") return { connection_id: entry.id };
  return {
    node_id: entry.id,
    ...(fragment ? {
      fragment_id: entry.fragmentIds?.get(fragment) ?? `${entry.id}:fragment:${fragment}`,
    } : {}),
  };
}

function requireRegistryId(registry: Registry, alias: string): string {
  const id = registry.get(alias)?.id;
  if (!id) fail("OLL_REFERENCE_NOT_FOUND", "target", `No canonical ID exists for alias '${alias}'`);
  return id;
}

function requireCanonicalId(target: CanonicalTarget): string {
  const id = target.node_id ?? target.group_id ?? target.connection_id;
  if (!id) fail("OLL_REFERENCE_NOT_FOUND", "target", "Canonical target has no addressable ID");
  return id;
}

function normalizePlacement(registry: Registry, place: Placement): JsonObject {
  const result = { ...place };
  if (place.anchor) {
    const target = canonicalTarget(registry, place.anchor);
    delete result.anchor;
    result.anchor = requireCanonicalId(target);
  }
  return result;
}

function normalizeAction(
  action: AuthoringAction,
  context: {
    host: NormalizationHost;
    registry: Registry;
    /** The kind of each tap card the lesson writes, by alias: a tap's place is an index into its card's places. */
    tapCards: ReadonlyMap<string, TapCardKind>;
    sequence: number;
    beatIndex: number;
    actionIndex: number;
  },
): CanonicalAction {
  const { host, registry, tapCards, sequence, beatIndex, actionIndex } = context;
  const actionId = `${host.lessonId}:action:${sequence}:${beatIndex + 1}:${actionIndex + 1}`;

  if (action.do === "write") {
    const nodeId = requireRegistryId(registry, action.as);
    return {
      action_id: actionId,
      op: "board.create",
      node: {
        id: nodeId,
        kind: action.kind,
        role: action.role,
        content: normalizeAddressableContent(host, nodeId, action.content),
        placement: normalizePlacement(registry, action.place),
        ...(action.source ? { source: structuredClone(action.source) } : {}),
        ...(host.regionId ? { region_id: host.regionId } : {}),
      },
    };
  }
  if (action.do === "emphasize") {
    return { action_id: actionId, op: "board.emphasize", target: canonicalTarget(registry, action.target), emphasis: action.emphasis };
  }
  if (action.do === "point") {
    return { action_id: actionId, op: "teacher.point", target: canonicalTarget(registry, action.target) };
  }
  if (action.do === "expression") {
    return { action_id: actionId, op: "teacher.expression", expression: action.expression };
  }
  if (action.do === "animate") {
    return {
      action_id: actionId,
      op: "lesson.variable.animate",
      animation: {
        variable: action.variable,
        to: action.value,
        easing: action.easing ?? "linear",
        duration_intent: action.duration_intent ?? "normal",
      },
    };
  }
  if (action.do === "connect") {
    return {
      action_id: actionId,
      op: "board.connect",
      connection: {
        id: requireRegistryId(registry, action.as),
        from: canonicalTarget(registry, action.from),
        to: canonicalTarget(registry, action.to),
        relation: action.relation,
        ...(action.label ? { label: action.label } : {}),
      },
    };
  }
  if (action.do === "group") {
    return {
      action_id: actionId,
      op: "board.group",
      group: {
        id: requireRegistryId(registry, action.as),
        title: action.label,
        role: action.role,
        members: action.members.map((member) => {
          const target = canonicalTarget(registry, member);
          return requireCanonicalId(target);
        }),
      },
    };
  }
  if (action.do === "focus") {
    return {
      action_id: actionId,
      op: "board.focus",
      focus: {
        targets: action.targets.map((target) => {
          const resolved = canonicalTarget(registry, target);
          return requireCanonicalId(resolved);
        }),
        intent: action.intent,
      },
    };
  }
  if (action.do === "hide") {
    return { action_id: actionId, op: "board.hide", target: canonicalTarget(registry, action.target) };
  }
  if (action.do === "tap") {
    return {
      action_id: actionId,
      op: "card.tap",
      target: canonicalTarget(registry, action.target),
      tap: { kind: action.tap, place: tapCards.get(splitTarget(action.target, "target").alias)?.places.indexOf(action.at) ?? -1 },
    };
  }
  if (action.do === "view") {
    return {
      action_id: actionId,
      op: "scene3d.view",
      target: canonicalTarget(registry, action.target),
      view: action.show !== undefined ? { show: canonicalTarget(registry, action.show) } : { preset: action.preset! },
    };
  }
  if (action.do === "revise") {
    const target = canonicalTarget(registry, action.target);
    return {
      action_id: actionId,
      op: "board.revise",
      target,
      revision: {
        content: normalizeAddressableContent(host, target.node_id!, action.content),
        reason: action.reason,
      },
    };
  }
  fail("OLL_INVALID_OPERATION", "action", "Unsupported authoring action");
}

export function normalizeAuthoringLesson(document: AuthoringLesson, host: NormalizationHost): CanonicalEvent[] {
  validateAuthoringLesson(document, host?.resourceContext);
  requireObject(host, "host");
  for (const field of ["lessonId", "boardId", "baseRevision"]) {
    if (host[field] === undefined || host[field] === null) fail("OLL_MISSING_HOST_FIELD", `host/${field}`, `Missing host field '${field}'`);
  }
  if (document.board_context) {
    if (document.board_context.board_id !== host.boardId) {
      fail("OLL_INVALID_REFERENCE", "/board_context/board_id", "Board context does not match the host board");
    }
    if (document.board_context.revision !== host.baseRevision) {
      fail("OLL_INVALID_REFERENCE", "/board_context/revision", "Board context revision does not match the host revision");
    }
  }
  const registry = buildCanonicalRegistry(document, host);
  const tapCards = new Map<string, TapCardKind>();
  for (const step of document.steps) {
    for (const beat of step.beats) {
      for (const action of beat.actions) {
        if (action.do !== "write") continue;
        const card = tapCardKind(action.kind);
        if (card) tapCards.set(action.as, card);
      }
    }
  }
  const canonicalLesson = structuredClone(document.lesson);
  for (const reflection of canonicalLesson.reflections ?? []) {
    reflection.anchor = requireRegistryId(registry, reflection.anchor);
  }
  for (const candidate of canonicalLesson.tasks ?? []) {
    if (candidate.start) candidate.start.values = resolvePhaseStart(candidate.start, document.lesson.variables ?? [], `/lesson/tasks/${candidate.as}/start`);
    if (candidate.completion.kind === "numeric_answer" || candidate.completion.kind === "numeric_row") {
      const answerTask = candidate as AuthoringAnswerStudentTask | AuthoringRowStudentTask;
      answerTask.anchor = requireRegistryId(registry, answerTask.anchor);
      continue;
    }
    if (candidate.completion.kind === "card_fact") {
      const cardTask = candidate as AuthoringCardStudentTask;
      cardTask.completion.node = requireRegistryId(registry, cardTask.completion.node);
      for (const operation of cardTask.allowed_operations) {
        if (operation.kind === "card_tap") operation.node = cardTask.completion.node;
      }
      continue;
    }
    const task = candidate as AuthoringScene3dStudentTask;
    if (task.completion.kind !== "scene3d_view_target") continue;
    task.completion.node = requireRegistryId(registry, task.completion.node);
    for (const operation of task.allowed_operations) {
      operation.node = requireRegistryId(registry, operation.node);
    }
  }
  const events: CanonicalEvent[] = [
    {
      dsl: "octos.lesson",
      version: "0.1",
      profile: "canonical",
      event: "lesson.open",
      lesson_id: host.lessonId,
      sequence: 0,
      board: {
        board_id: host.boardId,
        base_revision: host.baseRevision,
        region_intent: host.regionIntent ?? "new_topic",
        ...(host.regionId ? { region_id: host.regionId } : {}),
      },
      lesson: canonicalLesson,
    },
  ];

  document.steps.forEach((step, stepIndex) => {
    const sequence = stepIndex + 1;
    events.push({
      dsl: "octos.lesson",
      version: "0.1",
      profile: "canonical",
      event: "lesson.step",
      lesson_id: host.lessonId,
      sequence,
      step: {
        id: stableId(host, "step", step.key),
        purpose: step.purpose,
        beats: step.beats.map((beat, beatIndex) => {
          const stage: Record<ActionPhase, CanonicalAction[]> = { before_speech: [], during_speech: [], after_speech: [] };
          beat.actions.forEach((action, actionIndex) => {
            const phase = action.when ?? "during_speech";
            stage[phase].push(normalizeAction(action, { host, registry, tapCards, sequence, beatIndex, actionIndex }));
          });
          if (beat.start?.kind === "replay") {
            stage.before_speech.unshift({
              action_id: `${stableId(host, "step", step.key)}:beat:${beat.key}:phase-start`,
              op: "lesson.phase.start",
              transition: {
                kind: "replay",
                values: resolvePhaseStart(beat.start, document.lesson.variables ?? [], `/steps/${stepIndex}/beats/${beatIndex}/start`),
                source_path: `/steps/${stepIndex}/beats/${beatIndex}/start`,
              },
            });
          }
          return {
            id: `${stableId(host, "step", step.key)}:beat:${beat.key}`,
            ...(beat.say ? { narration: { text: beat.say, ...(beat.delivery ? { delivery: beat.delivery } : {}) } } : {}),
            ...(beat.pace ? { pace: beat.pace } : {}),
            stage,
          };
        }),
      },
    });
  });

  const focus = (document.close?.focus ?? []).map((target) => {
    const resolved = canonicalTarget(registry, target);
    return requireCanonicalId(resolved);
  });
  events.push({
    dsl: "octos.lesson",
    version: "0.1",
    profile: "canonical",
    event: "lesson.close",
    lesson_id: host.lessonId,
    sequence: document.steps.length + 1,
    result: {
      summary: document.close?.summary ?? "",
      summary_node_refs: [],
      suggested_focus: focus,
    },
  });
  return events;
}

export function createSemanticBoardState(open: CanonicalEvent): SemanticBoardState {
  if (open.event !== "lesson.open") fail("OLL_INVALID_EVENT", "/0/event", "First event must be lesson.open");
  if (!open.board) fail("OLL_INVALID_EVENT", "/0/board", "lesson.open must include board state");
  const variables = Object.fromEntries((open.lesson?.variables ?? []).map((variable) => [
    variable.as,
    {
      value: variable.initial,
      initial: variable.initial,
      min: variable.min,
      max: variable.max,
      ...(variable.wrap ? { wrap: true as const } : {}),
      ...(variable.label ? { label: variable.label } : {}),
      ...(variable.unit ? { unit: variable.unit } : {}),
      ...(variable.control ? { control: structuredClone(variable.control) } : {}),
    },
  ]));
  return {
    board_id: open.board.board_id,
    revision: open.board.base_revision,
    nodes: {},
    connections: {},
    groups: {},
    focus: [],
    applied_lessons: [open.lesson_id],
    applied_steps: [],
    applied_actions: [],
    ...(Object.keys(variables).length ? { variables } : {}),
  };
}

function bindingValues(state: SemanticBoardState): Record<string, number> {
  return Object.fromEntries(Object.entries(state.variables ?? {}).map(([alias, variable]) => [alias, variable.value]));
}

function bindingTarget(content: JsonObject, target: string): { record: JsonObject; property: string } {
  // A card-level field (the chart's `target`) is bound by its bare name and lives on the content itself.
  if (!target.includes(".") && OLL_CANONICAL_CARD_BINDING_CAPABILITIES.includes(target)) return { record: content, property: target };
  const separator = target.lastIndexOf(".");
  if (separator <= 0) fail("OLL_INVALID_BINDING", "content.bindings.target", `Invalid canonical binding target '${target}'`);
  const fragmentId = target.slice(0, separator);
  const property = target.slice(separator + 1);
  for (const [field, properties] of Object.entries(OLL_CANONICAL_BINDING_CAPABILITIES)) {
    const record = (Array.isArray(content[field]) ? content[field] : []).find((item: JsonObject) => item.id === fragmentId);
    if (record && properties.includes(property)) return { record, property };
    if (record) fail("OLL_INVALID_BINDING", "content.bindings.target", `Property '${property}' cannot be bound on '${field}'`);
  }
  fail("OLL_REFERENCE_NOT_FOUND", "content.bindings.target", `Canonical binding target '${target}' was not found`);
}

/** Locale-independent, fixed precision, trailing-zero trimming, and no negative zero. */
export function formatBoundNumericLabel(value: number, format: { precision: number; prefix?: string; suffix?: string }): string {
  if (!Number.isFinite(value) || !Number.isInteger(format.precision) || format.precision < 0 || format.precision > 6) {
    fail("OLL_INVALID_BINDING", "binding.label", "Cannot format a non-finite value or invalid precision");
  }
  const rounded = Number(value.toFixed(format.precision));
  return `${format.prefix ?? ""}${Object.is(rounded, -0) ? 0 : rounded}${format.suffix ?? ""}`;
}

export function evaluateContentBindings(content: JsonObject, variables: Record<string, number>): JsonObject {
  const evaluated = structuredClone(content);
  // Content is re-evaluated in place, so clear any earlier "undefined" mark.
  for (const binding of Array.isArray(evaluated.bindings) ? evaluated.bindings : []) {
    if (binding.hide_when_undefined === true) delete bindingTarget(evaluated, binding.target).record.binding_undefined;
  }
  for (const binding of Array.isArray(evaluated.bindings) ? evaluated.bindings : []) {
    const { record, property } = bindingTarget(evaluated, binding.target);
    if (binding.hide_when_undefined === true) {
      // A point with no defined position (e.g. the intersection of two
      // parallel lines) is hidden instead of failing the lesson.
      let value: number | undefined;
      try { value = evaluateMathExpression(binding.expression, variables); } catch { value = undefined; }
      if (value === undefined || !Number.isFinite(value)) {
        record.binding_undefined = true;
        continue;
      }
    }
    try {
      record[property] = evaluateMathExpression(binding.expression, variables);
      if (property === "radius" && (record[property] < 0 || (record[property] === 0 && binding.allow_zero !== true))) {
        throw new Error("Bound radius must be positive unless explicitly allowed to degenerate to zero");
      }
      // A net opens from 0 (closed) to 1 (flat); a slider past either end stays there.
      if (property === "unfold") record[property] = Math.min(1, Math.max(0, record[property]));
      if (property === "sides" && (record[property] < 3 || record[property] > 384)) {
        throw new Error("Bound polygon sides must be in 3..384");
      }
      if (binding.label) record.label = formatBoundNumericLabel(record[property], binding.label);
    } catch (error) {
      const message = error instanceof Error ? error.message : "binding evaluation failed";
      fail("OLL_BINDING_EVALUATION_FAILED", "content.bindings.expression", message);
    }
  }
  return evaluated;
}

function canonicalTargetExists(state: SemanticBoardState, target: CanonicalTarget | undefined): boolean {
  if (!target) return false;
  if (target.node_id) return Boolean(state.nodes[target.node_id]);
  if (target.connection_id) return Boolean(state.connections[target.connection_id]);
  if (target.group_id) return Boolean(state.groups[target.group_id]);
  return false;
}

export function applyCanonicalAction(state: SemanticBoardState, action: CanonicalAction): boolean {
  if (state.applied_actions.includes(action.action_id)) return false;
  if (action.op === "board.create") {
    if (!action.node) fail("OLL_INVALID_EVENT", "action.node", "board.create requires node");
    if (state.nodes[action.node.id]) fail("OLL_DUPLICATE_NODE_ID", "action.node.id", `Node '${action.node.id}' already exists`);
    const anchor = action.node.placement?.anchor;
    if (anchor && !state.nodes[anchor] && !state.groups[anchor]) fail("OLL_REFERENCE_NOT_FOUND", "action.node.placement.anchor", `Anchor '${anchor}' not found`);
    const node = structuredClone(action.node);
    node.content = evaluateContentBindings(node.content, bindingValues(state));
    state.nodes[action.node.id] = node;
    if (action.node.placement?.relation === "replaces") {
      const replaced = state.nodes[anchor!];
      if (!replaced) fail("OLL_REFERENCE_NOT_FOUND", "action.node.placement.anchor", `Replaced node '${anchor}' not found`);
      replaced.hidden = true;
      replaced.replaced_by = action.node.id;
      state.focus = state.focus.filter((id) => id !== anchor);
    }
  } else if (action.op === "board.connect") {
    if (!action.connection) fail("OLL_INVALID_EVENT", "action.connection", "board.connect requires connection");
    if (state.connections[action.connection.id]) fail("OLL_DUPLICATE_CONNECTION_ID", "action.connection.id", `Connection '${action.connection.id}' already exists`);
    if (!canonicalTargetExists(state, action.connection.from)) fail("OLL_REFERENCE_NOT_FOUND", "action.connection.from", "Connection source not found");
    if (!canonicalTargetExists(state, action.connection.to)) fail("OLL_REFERENCE_NOT_FOUND", "action.connection.to", "Connection target not found");
    state.connections[action.connection.id] = structuredClone(action.connection);
  } else if (action.op === "board.group") {
    if (!action.group) fail("OLL_INVALID_EVENT", "action.group", "board.group requires group");
    if (state.groups[action.group.id]) fail("OLL_DUPLICATE_GROUP_ID", "action.group.id", `Group '${action.group.id}' already exists`);
    for (const member of action.group.members ?? []) {
      if (!state.nodes[member] && !state.groups[member]) fail("OLL_REFERENCE_NOT_FOUND", "action.group.members", `Group member '${member}' not found`);
    }
    state.groups[action.group.id] = structuredClone(action.group);
  } else if (action.op === "board.focus") {
    if (!action.focus) fail("OLL_INVALID_EVENT", "action.focus", "board.focus requires focus");
    for (const target of action.focus.targets) {
      if (!state.nodes[target] && !state.groups[target] && !state.connections[target]) fail("OLL_REFERENCE_NOT_FOUND", "action.focus.targets", `Focus target '${target}' not found`);
    }
    state.focus = [...action.focus.targets];
  } else if (action.op === "board.revise") {
    if (!action.target?.node_id || !action.revision) fail("OLL_INVALID_EVENT", "action", "board.revise requires a node target and revision");
    const node = state.nodes[action.target.node_id];
    if (!node) fail("OLL_REFERENCE_NOT_FOUND", "action.target", `Node '${action.target.node_id}' not found`);
    node.content = evaluateContentBindings(action.revision.content, bindingValues(state));
  } else if (action.op === "board.emphasize") {
    if (!action.target || !action.emphasis) fail("OLL_INVALID_EVENT", "action.target", "board.emphasize requires target and emphasis");
    const target = action.target.node_id
      ? state.nodes[action.target.node_id]
      : action.target.connection_id
        ? state.connections[action.target.connection_id]
        : action.target.group_id
          ? state.groups[action.target.group_id]
          : undefined;
    if (!target) fail("OLL_REFERENCE_NOT_FOUND", "action.target", "Emphasis target not found");
    target.emphasis = [...(target.emphasis ?? []), { target: action.target, emphasis: action.emphasis }];
  } else if (action.op === "board.hide") {
    const node = action.target?.node_id ? state.nodes[action.target.node_id] : undefined;
    if (!node) fail("OLL_REFERENCE_NOT_FOUND", "action.target", "Hidden node not found");
    node.hidden = true;
    state.focus = state.focus.filter((id) => id !== node.id);
  } else if (action.op === "scene3d.view") {
    const node = action.target?.node_id ? state.nodes[action.target.node_id] : undefined;
    if (!node || node.kind !== "scene3d" || !action.view) fail("OLL_REFERENCE_NOT_FOUND", "action.target", "View target is not a 3D scene");
    node.view_intent = structuredClone(action.view);
  } else if (action.op === "teacher.point") {
    if (!canonicalTargetExists(state, action.target)) fail("OLL_REFERENCE_NOT_FOUND", "action.target", "Point target not found");
  } else if (action.op === "teacher.expression") {
    if (!action.expression) fail("OLL_INVALID_EVENT", "action.expression", "teacher.expression requires expression");
  } else if (action.op === "lesson.phase.start") {
    if (!action.transition) fail("OLL_INVALID_EVENT", "action.transition", "Phase start requires transition targets");
    Object.assign(state, setLessonVariables(state, action.transition.values));
  } else if (action.op === "card.tap") {
    const node = action.target?.node_id ? state.nodes[action.target.node_id] : undefined;
    const card = tapCardKind(node?.kind);
    if (!node || !card || !action.tap) fail("OLL_REFERENCE_NOT_FOUND", "action.target", `A tap acts on a ${lessonTapCardKindList()} card`);
    // A card shown by a demonstration field is never tapped by a lesson (decision 0026), also as canonical events.
    if (card.demonstration) fail("OLL_INVALID_EVENT", "action.target", `A ${card.kind} card is not tapped by a lesson: it is shown by its '${card.demonstration.field}'`);
    const before = card.state(node.content);
    const result = card.apply(before, action.tap);
    if (!result.ok) fail("OLL_INVALID_EVENT", "action.tap", `The card refuses this tap: ${card.refusalText(result.reason, action.tap.place)}`);
    const bound = new Map(((node.content.bindings ?? []) as JsonObject[]).map((binding) => [binding.target, String(binding.expression).trim()]));
    const values = Object.fromEntries(card.changes(before, result.state).map((change) => {
      const alias = bound.get(card.fieldTarget(node.content, change.place, change.field));
      if (!alias) fail("OLL_INVALID_EVENT", "action.target", `The card has no variable for ${change.field} of place ${change.place}`);
      return [alias, change.after];
    }));
    Object.assign(state, setLessonVariables(state, values));
  } else if (action.op === "lesson.variable.animate") {
    if (!action.animation) fail("OLL_INVALID_EVENT", "action.animation", "lesson.variable.animate requires animation");
    const updated = setLessonVariable(state, action.animation.variable, action.animation.to);
    Object.assign(state, updated);
  } else {
    fail("OLL_INVALID_OPERATION", "action.op", `Unknown canonical operation '${action.op}'`);
  }
  state.applied_actions.push(action.action_id);
  return true;
}

export function setLessonVariable(state: SemanticBoardState, alias: string, value: number): SemanticBoardState {
  return setLessonVariables(state, { [alias]: value });
}

/** Evaluate dependent fields only after all values have changed, atomically. */
export function setLessonVariables(state: SemanticBoardState, changes: Record<string, number>): SemanticBoardState {
  const updated = structuredClone(state);
  for (const [alias, value] of Object.entries(changes)) {
    const variable = updated.variables?.[alias];
    if (!variable) fail("OLL_REFERENCE_NOT_FOUND", `variables/${alias}`, `Variable '${alias}' is not defined`);
    if (!Number.isFinite(value) || value < variable.min || value > variable.max) {
      fail("OLL_INVALID_VARIABLE", `variables/${alias}/value`, `Variable '${alias}' must be between ${variable.min} and ${variable.max}`);
    }
    variable.value = value;
  }
  const values = bindingValues(updated);
  for (const node of Object.values(updated.nodes)) {
    node.content = evaluateContentBindings(node.content, values);
  }
  return updated;
}

export function commitCanonicalStep(state: SemanticBoardState, stepId: string): boolean {
  if (state.applied_steps.includes(stepId)) return false;
  state.applied_steps.push(stepId);
  state.revision += 1;
  return true;
}

export function applyLessonClose(state: SemanticBoardState, event: CanonicalEvent): void {
  if (event.event !== "lesson.close") fail("OLL_INVALID_EVENT", "event", "Expected lesson.close");
  state.focus = [...(event.result?.suggested_focus ?? state.focus)];
}

export function reduceCanonicalEvents(events: CanonicalEvent[]): SemanticBoardState {
  requireArray(events, "events");
  const open = events[0]!;
  const state = createSemanticBoardState(open);

  for (const event of events.slice(1)) {
    if (event.event === "lesson.close") {
      applyLessonClose(state, event);
      continue;
    }
    if (event.event !== "lesson.step") fail("OLL_INVALID_EVENT", "event", `Unexpected event '${event.event}'`);
    if (!event.step) fail("OLL_INVALID_EVENT", "event.step", "lesson.step must include a step");
    const step = event.step;
    if (state.applied_steps.includes(step.id)) continue;
    for (const beat of step.beats) {
      for (const phase of ["before_speech", "during_speech", "after_speech"] as const) {
        for (const action of beat.stage[phase]) {
          applyCanonicalAction(state, action);
        }
      }
    }
    commitCanonicalStep(state, step.id);
  }
  return canonicalizeState(state);
}

export function canonicalizeState(state: SemanticBoardState): SemanticBoardState {
  const sortObject = <T>(value: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return {
    ...structuredClone(state),
    nodes: sortObject(state.nodes),
    connections: sortObject(state.connections),
    groups: sortObject(state.groups),
    ...(state.variables ? { variables: sortObject(state.variables) } : {}),
    applied_actions: [...state.applied_actions],
  };
}

export function assertDeepEqual(actual: unknown, expected: unknown): void {
  const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
    if (!item || Array.isArray(item) || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  });
  const actualJson = stableJson(actual);
  const expectedJson = stableJson(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`OLL values are not deeply equal\nactual: ${actualJson}\nexpected: ${expectedJson}`);
  }
}
