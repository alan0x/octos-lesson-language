import { OLL_NODE_KINDS, OLL_CANONICAL_BINDING_CAPABILITIES } from "./capabilities.js";
import type { CanonicalEvent } from "./types.js";

/** Executable feature versions, independent of the npm prerelease label. */
export const OLL_PLAYER_EXECUTION_VERSION = "0.2.0";
export const OLL_EXECUTION_FEATURES: Readonly<Record<string, string>> = Object.freeze({
  "canonical:0.1": "0.1.0",
  ...Object.fromEntries(OLL_NODE_KINDS.map(kind => [`node:${kind}`, "0.1.0"])),
  ...Object.fromEntries([
    "board.create", "board.revise", "board.emphasize", "board.connect", "board.group",
    "board.focus", "teacher.point", "teacher.expression", "lesson.variable.animate",
  ].map(op => [`action:${op}`, "0.1.0"])),
  "variables": "0.1.0",
  "value-bindings": "0.1.0",
  "binding-labels": "0.2.0",
  "bound-zero-radius": "0.2.0",
  "action:lesson.phase.start": "0.2.0",
  "practice-start": "0.2.0",
  "student-tasks:expression_target": "0.1.0",
  "student-tasks:scene3d_view_target": "0.1.0",
});

export interface ExecutionRequirements {
  minimumPlayerVersion: string;
  requiredCapabilities: string[];
}

export class ExecutionCapabilityError extends Error {
  readonly code = "OLL_UNSUPPORTED_CAPABILITY";
  constructor(readonly path: string, message: string) {
    super(message);
    this.name = "ExecutionCapabilityError";
  }
}

export function compareExecutionVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match) throw new ExecutionCapabilityError("minimumPlayerVersion", `Invalid execution version '${value}'`);
    return match.slice(1).map(Number);
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Inspect structural units only; never infer intention from narration or labels. */
export function deriveExecutionRequirements(events: readonly CanonicalEvent[]): ExecutionRequirements {
  const required = new Set<string>();
  const add = (feature: string, path: string) => {
    if (!Object.hasOwn(OLL_EXECUTION_FEATURES, feature)) {
      throw new ExecutionCapabilityError(path, `Unsupported executable capability '${feature}'`);
    }
    required.add(feature);
  };
  const content = (value: Record<string, unknown> | undefined, path: string) => {
    if (!value) return;
    const bindings = value.bindings;
    if (Array.isArray(bindings) && bindings.length) {
      add("value-bindings", path);
      for (const [index, binding] of bindings.entries()) {
        if ((binding as { label?: unknown }).label !== undefined) add("binding-labels", `${path}/bindings/${index}`);
        if ((binding as { allow_zero?: unknown }).allow_zero !== undefined) add("bound-zero-radius", `${path}/bindings/${index}`);
        const property = { property: (binding as { target?: string }).target?.split(".").at(-1) };
        // Full reference and numerical validation remains owned by the core validator.
        if (property.property && !Object.values(OLL_CANONICAL_BINDING_CAPABILITIES)
          .some(properties => properties.includes(property.property!))) {
          throw new ExecutionCapabilityError(`${path}/bindings/${index}`, `Unsupported binding property '${property.property}'`);
        }
      }
    }
  };
  for (const [index, event] of events.entries()) {
    const path = `/events/${index}`;
    add(`canonical:${event.version}`, `${path}/version`);
    if (event.lesson?.variables?.length) add("variables", `${path}/lesson/variables`);
    for (const task of event.lesson?.tasks ?? []) {
      if (task.start) add("practice-start", `${path}/lesson/tasks/${task.as}/start`);
      add(`student-tasks:${task.completion.kind}`, `${path}/lesson/tasks/${task.as}`);
    }
    for (const beat of event.step?.beats ?? []) {
      for (const actions of Object.values(beat.stage)) for (const action of actions) {
        const actionPath = `${path}/actions/${action.action_id}`;
        add(`action:${action.op}`, actionPath);
        if (action.node) {
          add(`node:${String(action.node.kind)}`, `${actionPath}/node/kind`);
          content(action.node.content, `${actionPath}/node/content`);
        }
        if (action.revision) content(action.revision.content, `${actionPath}/revision/content`);
      }
    }
  }
  const requiredCapabilities = [...required].sort();
  const minimumPlayerVersion = requiredCapabilities.reduce((version, feature) => {
    const minimum = OLL_EXECUTION_FEATURES[feature]!;
    return compareExecutionVersions(minimum, version) > 0 ? minimum : version;
  }, "0.1.0");
  return { minimumPlayerVersion, requiredCapabilities };
}

export function assertExecutionSupported(
  events: readonly CanonicalEvent[],
  playerVersion = OLL_PLAYER_EXECUTION_VERSION,
  supportedCapabilities: readonly string[] = Object.keys(OLL_EXECUTION_FEATURES),
): ExecutionRequirements {
  const requirements = deriveExecutionRequirements(events);
  const available = new Set(supportedCapabilities);
  if (compareExecutionVersions(requirements.minimumPlayerVersion, playerVersion) > 0) {
    throw new ExecutionCapabilityError("minimumPlayerVersion", `Lesson requires player ${requirements.minimumPlayerVersion}`);
  }
  for (const capability of requirements.requiredCapabilities) {
    if (!available.has(capability)) throw new ExecutionCapabilityError("requiredCapabilities", `Player does not support '${capability}'`);
  }
  return requirements;
}

export function assertExecutionDeclaration(
  events: readonly CanonicalEvent[],
  declaration: { minimumPlayerVersion: string; requiredCapabilities?: readonly string[] },
): ExecutionRequirements {
  const requirements = assertExecutionSupported(events);
  if (compareExecutionVersions(declaration.minimumPlayerVersion, requirements.minimumPlayerVersion) < 0) {
    throw new ExecutionCapabilityError("minimumPlayerVersion", "Declared player version is lower than the content requires");
  }
  // Legacy 0.1 packs remain valid without a new declaration. New feature packs must declare it.
  if (!declaration.requiredCapabilities && requirements.minimumPlayerVersion !== "0.1.0") {
    throw new ExecutionCapabilityError("requiredCapabilities", "New executable features require a capability declaration");
  }
  if (declaration.requiredCapabilities) {
    for (const feature of requirements.requiredCapabilities) {
      if (!declaration.requiredCapabilities.includes(feature)) {
        throw new ExecutionCapabilityError("requiredCapabilities", `Declaration omits '${feature}'`);
      }
    }
    for (const feature of declaration.requiredCapabilities) {
      if (!Object.hasOwn(OLL_EXECUTION_FEATURES, feature)) {
        throw new ExecutionCapabilityError("requiredCapabilities", `Unsupported declared capability '${feature}'`);
      }
    }
  }
  return requirements;
}
