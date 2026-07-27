import { deepStrictEqual } from "node:assert";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import authoringSchema from "../../../schema/authoring/v0.1.schema.json" with { type: "json" };
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

type UnknownRecord = Record<string, unknown>;
type Registry = Map<string, RegistryEntry>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateAuthoringDocument = ajv.compile(authoringSchema);

const ALIAS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
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
  for (const field of ["curves", "points", "guides", "regions", "elements", "edges"]) {
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

export function validateAuthoringLesson(document: AuthoringLesson, resourceContext: ResourceContext | null = null): { registry: Registry } {
  requireObject(document, "");
  if (document.dsl !== "octos.lesson" || document.version !== "0.1" || document.profile !== "authoring") {
    fail("OLL_UNSUPPORTED_PROFILE", "", "Expected octos.lesson 0.1 Authoring Profile");
  }
  requireObject(document.lesson, "/lesson");
  requireArray(document.lesson.goals, "/lesson/goals");
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
  for (const field of ["fragments", "curves", "points", "guides", "regions", "elements", "edges"]) {
    if (!Array.isArray(clone?.[field])) continue;
    clone[field] = clone[field].map((item) => {
      if (!item.as) return item;
      const { as, ...rest } = item;
      const normalized = { id: `${nodeId}:fragment:${as}`, ...rest };
      if (field === "edges") {
        normalized.from = `${nodeId}:fragment:${item.from}`;
        normalized.to = `${nodeId}:fragment:${item.to}`;
      }
      if (field === "regions" && Array.isArray(item.members)) {
        normalized.members = item.members.map((member: string) => `${nodeId}:fragment:${member}`);
      }
      return normalized;
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

export function reduceCanonicalEvents(events: CanonicalEvent[]): SemanticBoardState {
  requireArray(events, "events");
  const open = events[0]!;
  if (open.event !== "lesson.open") fail("OLL_INVALID_EVENT", "/0/event", "First event must be lesson.open");
  if (!open.board) fail("OLL_INVALID_EVENT", "/0/board", "lesson.open must include board state");
  const state: SemanticBoardState = {
    board_id: open.board.board_id,
    revision: open.board.base_revision,
    nodes: {},
    connections: {},
    groups: {},
    focus: [],
    applied_lessons: [open.lesson_id],
    applied_steps: [],
    applied_actions: [],
  };

  for (const event of events.slice(1)) {
    if (event.event === "lesson.close") {
      state.focus = [...(event.result?.suggested_focus ?? state.focus)];
      continue;
    }
    if (event.event !== "lesson.step") fail("OLL_INVALID_EVENT", "event", `Unexpected event '${event.event}'`);
    if (!event.step) fail("OLL_INVALID_EVENT", "event.step", "lesson.step must include a step");
    const step = event.step;
    if (state.applied_steps.includes(step.id)) continue;
    for (const beat of step.beats) {
      for (const phase of ["before_speech", "during_speech", "after_speech"] as const) {
        for (const action of beat.stage[phase]) {
          if (state.applied_actions.includes(action.action_id)) continue;
          state.applied_actions.push(action.action_id);
          if (action.op === "board.create") {
            if (!action.node) fail("OLL_INVALID_EVENT", "action.node", "board.create requires node");
            state.nodes[action.node.id] = structuredClone(action.node);
          } else if (action.op === "board.connect") {
            if (!action.connection) fail("OLL_INVALID_EVENT", "action.connection", "board.connect requires connection");
            state.connections[action.connection.id] = structuredClone(action.connection);
          } else if (action.op === "board.group") {
            if (!action.group) fail("OLL_INVALID_EVENT", "action.group", "board.group requires group");
            state.groups[action.group.id] = structuredClone(action.group);
          } else if (action.op === "board.focus") {
            if (!action.focus) fail("OLL_INVALID_EVENT", "action.focus", "board.focus requires focus");
            state.focus = [...action.focus.targets];
          }
          else if (action.op === "board.revise") {
            if (!action.target?.node_id || !action.revision) fail("OLL_INVALID_EVENT", "action", "board.revise requires a node target and revision");
            const node = state.nodes[action.target.node_id];
            if (!node) fail("OLL_REFERENCE_NOT_FOUND", "action.target", `Node '${action.target.node_id}' not found`);
            node.content = structuredClone(action.revision.content);
          } else if (action.op === "board.emphasize") {
            if (!action.target) fail("OLL_INVALID_EVENT", "action.target", "board.emphasize requires target");
            const target = action.target.node_id
              ? state.nodes[action.target.node_id]
              : action.target.connection_id
                ? state.connections[action.target.connection_id]
                : action.target.group_id
                  ? state.groups[action.target.group_id]
                  : undefined;
            if (!target) fail("OLL_REFERENCE_NOT_FOUND", "action.target", "Emphasis target not found");
            target.emphasis = [...(target.emphasis ?? []), { target: action.target, emphasis: action.emphasis }];
          }
        }
      }
    }
    state.applied_steps.push(step.id);
    state.revision += 1;
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
    applied_actions: [...state.applied_actions],
  };
}

export function assertDeepEqual(actual: unknown, expected: unknown): void {
  deepStrictEqual(actual, expected);
}
