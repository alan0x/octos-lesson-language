import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import authoringSchema from "../../../schema/authoring/v0.1.schema.json" with { type: "json" };
import { compileMathExpression, evaluateMathExpression } from "./math-expression.js";
import type {
  ActionPhase,
  AuthoringAction,
  AuthoringLesson,
  CanonicalAction,
  CanonicalEvent,
  CanonicalTarget,
  JsonObject,
  NormalizationHost,
  Placement,
  RegistryEntry,
  RegistryEntryType,
  ResourceContext,
  SchemaValidationResult,
  SemanticBoardState,
  WriteAction,
} from "./types.js";

export type * from "./types.js";
export * from "./math-expression.js";

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
const ACTIONS = new Set<AuthoringAction["do"]>([
  "write",
  "revise",
  "emphasize",
  "connect",
  "group",
  "focus",
  "point",
  "expression",
]);
const PHASES = new Set<ActionPhase>(["before_speech", "during_speech", "after_speech"]);
const PLACEMENT_RELATIONS = new Set(["new_region", "below", "above", "left_of", "right_of", "near", "inside", "overlay"]);
const ACTION_FIELDS = new Set([
  "do", "when", "as", "kind", "role", "content", "place", "target",
  "from", "to", "relation", "label", "emphasis", "members", "targets",
  "intent", "expression", "reason",
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
    values.set(variable.as, initial);
  }
  return values;
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
  const add = (field: string, properties: string[]) => {
    for (const item of Array.isArray(action.content[field]) ? action.content[field] : []) {
      if (typeof item?.as === "string") targets.set(item.as, new Set(properties));
    }
  };
  if (action.kind === "geometry") {
    add("points", ["x", "y"]);
    add("circles", ["radius"]);
    add("arcs", ["radius", "start_angle", "end_angle"]);
  } else if (action.kind === "plot") {
    add("points", ["x", "y"]);
    add("guides", ["value"]);
  }
  return targets;
}

function validateValueBindings(action: WriteAction, path: string, variables: Map<string, number>): void {
  if (action.content.bindings === undefined) return;
  if (action.kind !== "geometry" && action.kind !== "plot") {
    fail("OLL_INVALID_BINDING", `${path}/content/bindings`, "Bindings are only supported on geometry and plot nodes");
  }
  requireArray(action.content.bindings, `${path}/content/bindings`);
  const targets = bindableTargets(action);
  const seen = new Set<string>();
  action.content.bindings.forEach((binding: unknown, index: number) => {
    const bindingPath = `${path}/content/bindings/${index}`;
    requireObject(binding, bindingPath);
    for (const field of Object.keys(binding)) {
      if (field !== "target" && field !== "expression") fail("OLL_INVALID_BINDING", `${bindingPath}/${field}`, `Unknown binding field '${field}'`);
    }
    const { alias, property } = splitBindingTarget(binding.target, `${bindingPath}/target`);
    if (!targets.get(alias)?.has(property)) {
      fail("OLL_REFERENCE_NOT_FOUND", `${bindingPath}/target`, `Binding target '${binding.target}' is not a supported numeric field`);
    }
    if (seen.has(binding.target as string)) fail("OLL_INVALID_BINDING", `${bindingPath}/target`, `Binding target '${binding.target}' is duplicated`);
    seen.add(binding.target as string);
    requireString(binding.expression, `${bindingPath}/expression`);
    try {
      const evaluate = compileMathExpression(binding.expression as string, variables.keys());
      const result = evaluate(Object.fromEntries(variables));
      if (!Number.isFinite(result)) throw new Error("result is not finite");
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

function collectAddressableContent(content: JsonObject): string[] {
  const result = validateContentFragments(content, "/content");
  for (const field of ["curves", "points", "guides", "regions", "elements", "edges", "circles", "segments", "arcs"]) {
    if (!content?.[field]) continue;
    for (const item of content[field]) {
      if (item?.as) result.push(item.as);
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

function requireFiniteNumber(value: unknown, path: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) fail("OLL_INVALID_OPERATION_PAYLOAD", path, "Expected a finite number");
  return number;
}

function validateGeometryContent(action: WriteAction, path: string): void {
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

  const requirePointReference = (value: unknown, referencePath: string) => {
    requireAlias(value, referencePath);
    if (!pointAliases.has(value)) {
      fail("OLL_REFERENCE_NOT_FOUND", referencePath, `Geometry point '${value}' is not defined`);
    }
  };
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
        if (radius <= 0) fail("OLL_INVALID_OPERATION_PAYLOAD", `${itemPath}/radius`, "Radius must be greater than zero");
      }
      if (field === "arcs") {
        requireFiniteNumber(item.start_angle, `${itemPath}/start_angle`);
        requireFiniteNumber(item.end_angle, `${itemPath}/end_angle`);
      }
    });
  }
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

function validatePlacement(place: Placement, path: string, registry: Registry): void {
  requireObject(place, path);
  if (!PLACEMENT_RELATIONS.has(place.relation)) {
    fail("OLL_INVALID_PLACEMENT", `${path}/relation`, `Unknown placement relation '${place.relation}'`);
  }
  for (const forbidden of ["x", "y", "width", "height", "zoom", "duration_ms"]) {
    if (forbidden in place) fail("OLL_INVALID_PLACEMENT", `${path}/${forbidden}`, `Authoring Profile cannot set '${forbidden}'`);
  }
  if (place.relation === "new_region") {
    if (place.anchor !== undefined) fail("OLL_INVALID_PLACEMENT", `${path}/anchor`, "new_region cannot use an anchor");
  } else {
    resolveLocal(registry, place.anchor, `${path}/anchor`, ["node", "group"]);
  }
}

function validateActionPayload(action: AuthoringAction, path: string): void {
  for (const field of Object.keys(action)) {
    if (!ACTION_FIELDS.has(field)) fail("OLL_INVALID_OPERATION_PAYLOAD", `${path}/${field}`, `Unknown action field '${field}'`);
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
  } else if (action.do === "point") {
    requireString(action.target, `${path}/target`);
  } else if (action.do === "expression") {
    requireString(action.expression, `${path}/expression`);
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
  const lessonVariables = validateLessonVariables(document);
  requireArray(document.steps, "/steps");
  requireObject(document.close, "/close");
  requireArray(document.close.focus, "/close/focus");

  const registry = new Map();
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
      requireArray(beat.actions, `${beatPath}/actions`);

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
          const fragments = collectAddressableContent(action.content);
          const uniqueFragments = new Set<string>();
          for (const fragment of fragments) {
            requireAlias(fragment, `${actionPath}/content`);
            if (uniqueFragments.has(fragment)) fail("OLL_DUPLICATE_ALIAS", `${actionPath}/content`, `Fragment '${fragment}' is duplicated`);
            uniqueFragments.add(fragment);
          }
          validateStructuredContent(action.content, `${actionPath}/content`, uniqueFragments);
          validateImageResource(action, actionPath, resourceContext);
          validateGeometryContent(action, actionPath);
          validateValueBindings(action, actionPath, lessonVariables);
          register(registry, action.as, "node", `${actionPath}/as`, fragments);
          return;
        }

        if (["emphasize", "point"].includes(action.do)) {
          resolveLocal(registry, action.target, `${actionPath}/target`, ["node", "connection", "group"]);
          return;
        }

        if (action.do === "revise") {
          resolveLocal(registry, action.target, `${actionPath}/target`, ["node"]);
          return;
        }

        if (action.do === "connect") {
          resolveLocal(registry, action.from, `${actionPath}/from`);
          resolveLocal(registry, action.to, `${actionPath}/to`);
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
          }
        }
      });
    });
  });

  if (document.close?.focus) {
    for (let index = 0; index < document.close.focus.length; index += 1) {
      resolveLocal(registry, document.close.focus[index], `/close/focus/${index}`, ["node", "group", "connection"]);
    }
  }

  return { registry };
}

function stableId(host: NormalizationHost, type: string, alias: string): string {
  return `${host.lessonId}:${type}:${alias}`;
}

function normalizeAddressableContent(_host: NormalizationHost, nodeId: string, content: JsonObject): JsonObject {
  const clone = structuredClone(content);
  for (const field of ["fragments", "curves", "points", "guides", "regions", "elements", "edges", "circles", "segments", "arcs"]) {
    if (!Array.isArray(clone?.[field])) continue;
    clone[field] = clone[field].map((item) => {
      if (!item.as) return item;
      const { as, ...rest } = item;
      const normalized = { id: `${nodeId}:fragment:${as}`, ...rest };
      if (field === "edges") {
        normalized.from = `${nodeId}:fragment:${item.from}`;
        normalized.to = `${nodeId}:fragment:${item.to}`;
      }
      if (field === "circles") {
        normalized.center = `${nodeId}:fragment:${item.center}`;
      }
      if (field === "segments") {
        normalized.from = `${nodeId}:fragment:${item.from}`;
        normalized.to = `${nodeId}:fragment:${item.to}`;
      }
      if (field === "arcs") {
        normalized.center = `${nodeId}:fragment:${item.center}`;
      }
      if (field === "regions" && Array.isArray(item.members)) {
        normalized.members = item.members.map((member: string) => `${nodeId}:fragment:${member}`);
      }
      return normalized;
    });
  }
  if (Array.isArray(clone.bindings)) {
    clone.bindings = clone.bindings.map((binding) => {
      const { alias, property } = splitBindingTarget(binding.target, "content.bindings.target");
      return {
        target: `${nodeId}:fragment:${alias}.${property}`,
        expression: binding.expression,
      };
    });
  }
  return clone;
}

function buildCanonicalRegistry(document: AuthoringLesson, host: NormalizationHost): Registry {
  const registry: Registry = new Map();
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
    ...(fragment ? { fragment_id: `${entry.id}:fragment:${fragment}` } : {}),
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
    sequence: number;
    beatIndex: number;
    actionIndex: number;
  },
): CanonicalAction {
  const { host, registry, sequence, beatIndex, actionIndex } = context;
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
  if (action.do === "revise") {
    return {
      action_id: actionId,
      op: "board.revise",
      target: canonicalTarget(registry, action.target),
      revision: {
        content: action.content,
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
  const registry = buildCanonicalRegistry(document, host);
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
      lesson: structuredClone(document.lesson),
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
            stage[phase].push(normalizeAction(action, { host, registry, sequence, beatIndex, actionIndex }));
          });
          return {
            id: `${stableId(host, "step", step.key)}:beat:${beat.key}`,
            ...(beat.say ? { narration: { text: beat.say, ...(beat.delivery ? { delivery: beat.delivery } : {}) } } : {}),
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
      ...(variable.label ? { label: variable.label } : {}),
      ...(variable.unit ? { unit: variable.unit } : {}),
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
  const separator = target.lastIndexOf(".");
  if (separator <= 0) fail("OLL_INVALID_BINDING", "content.bindings.target", `Invalid canonical binding target '${target}'`);
  const fragmentId = target.slice(0, separator);
  const property = target.slice(separator + 1);
  const fields: Array<[string, Set<string>]> = [
    ["points", new Set(["x", "y"])],
    ["guides", new Set(["value"])],
    ["circles", new Set(["radius"])],
    ["arcs", new Set(["radius", "start_angle", "end_angle"])],
  ];
  for (const [field, properties] of fields) {
    const record = (Array.isArray(content[field]) ? content[field] : []).find((item: JsonObject) => item.id === fragmentId);
    if (record && properties.has(property)) return { record, property };
    if (record) fail("OLL_INVALID_BINDING", "content.bindings.target", `Property '${property}' cannot be bound on '${field}'`);
  }
  fail("OLL_REFERENCE_NOT_FOUND", "content.bindings.target", `Canonical binding target '${target}' was not found`);
}

export function evaluateContentBindings(content: JsonObject, variables: Record<string, number>): JsonObject {
  const evaluated = structuredClone(content);
  for (const binding of Array.isArray(evaluated.bindings) ? evaluated.bindings : []) {
    const { record, property } = bindingTarget(evaluated, binding.target);
    try {
      record[property] = evaluateMathExpression(binding.expression, variables);
      if (property === "radius" && record[property] <= 0) throw new Error("Bound radius must be greater than zero");
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
  } else if (action.op === "teacher.point") {
    if (!canonicalTargetExists(state, action.target)) fail("OLL_REFERENCE_NOT_FOUND", "action.target", "Point target not found");
  } else if (action.op === "teacher.expression") {
    if (!action.expression) fail("OLL_INVALID_EVENT", "action.expression", "teacher.expression requires expression");
  } else {
    fail("OLL_INVALID_OPERATION", "action.op", `Unknown canonical operation '${action.op}'`);
  }
  state.applied_actions.push(action.action_id);
  return true;
}

export function setLessonVariable(state: SemanticBoardState, alias: string, value: number): SemanticBoardState {
  const variable = state.variables?.[alias];
  if (!variable) fail("OLL_REFERENCE_NOT_FOUND", `variables/${alias}`, `Variable '${alias}' is not defined`);
  if (!Number.isFinite(value) || value < variable.min || value > variable.max) {
    fail("OLL_INVALID_VARIABLE", `variables/${alias}/value`, `Variable '${alias}' must be between ${variable.min} and ${variable.max}`);
  }
  const updated = structuredClone(state);
  updated.variables![alias]!.value = value;
  const values = bindingValues(updated);
  for (const node of Object.values(updated.nodes)) {
    node.content = evaluateContentBindings(node.content, values);
  }
  return canonicalizeState(updated);
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
