import { OLL_NODE_KINDS, OLL_CANONICAL_BINDING_CAPABILITIES } from "./capabilities.js";
import type { CanonicalEvent } from "./types.js";

/** Executable feature versions, independent of the npm prerelease label. */
export const OLL_PLAYER_EXECUTION_VERSION = "0.10.0";
export const OLL_EXECUTION_FEATURES: Readonly<Record<string, string>> = Object.freeze({
  "canonical:0.1": "0.1.0",
  ...Object.fromEntries(OLL_NODE_KINDS.map(kind => [`node:${kind}`, "0.1.0"])),
  ...Object.fromEntries([
    "board.create", "board.revise", "board.emphasize", "board.connect", "board.group",
    "board.focus", "teacher.point", "teacher.expression", "lesson.variable.animate",
  ].map(op => [`action:${op}`, "0.1.0"])),
  "variables": "0.1.0",
  "geometry:regular-polygons": "0.4.0",
  "value-bindings": "0.1.0",
  "binding-labels": "0.2.0",
  "bound-zero-radius": "0.2.0",
  "action:lesson.phase.start": "0.2.0",
  "practice-start": "0.2.0",
  "student-tasks:expression_target": "0.1.0",
  "student-tasks:scene3d_view_target": "0.1.0",
  "student-tasks:numeric_answer": "0.5.0",
  "reflections": "0.3.0",
  "binding-hide-undefined": "0.3.0",
  "lesson-mode:learner_taught": "0.6.0",
  "node:ink": "0.6.0",
  "placement:annotates": "0.6.0",
  "placement:replaces": "0.6.0",
  "action:board.hide": "0.6.0",
  "write-source": "0.6.0",
  "action:scene3d.view": "0.6.0",
  "emphasis:none": "0.7.0",
  "variables:wrap": "0.7.0",
  "scene3d:latent-highlights": "0.7.0",
  "ink:shown-strokes": "0.8.0",
  "beat-pace:continuous": "0.8.0",
  "placement:continues": "0.9.0",
  "ink:drawn-size": "0.9.0",
  "scene3d:more-solids": "0.9.0",
  "scene3d:unfold": "0.9.0",
  "scene3d:face-targets": "0.10.0",
});

/** 3D solids added in player 0.9.0 (prisms, pyramids, frustums, hemispheres, tori, regular polyhedra). */
const MORE_SOLIDS = new Set(["prism", "pyramid", "frustum", "hemisphere", "torus", "tetrahedron", "octahedron", "dodecahedron", "icosahedron", "ellipsoid"]);

export interface ExecutionRequirements {
  minimumPlayerVersion: string;
  requiredCapabilities: string[];
  /** Subject plugins the lesson needs, each with the lowest version that has every feature used. Absent when none. */
  requiredPlugins?: Record<string, string>;
}

/**
 * A subject plugin's runtime extension (decision 0012). The host installs it
 * next to the player; lessons only name its features.
 */
export interface ExecutionExtension {
  plugin: { id: string; version: string };
  /** Feature name, `plugin:<id>/<name>@<major>`, to the plugin version that introduced it. */
  features: Readonly<Record<string, string>>;
  /**
   * Reports the plugin features a node's or revision's content uses. `kind`
   * is the node's kind; it is undefined for a revision of a node created
   * outside these events (already on the board), so a detector must then
   * judge from the content alone.
   */
  detect?(content: Readonly<Record<string, unknown>>, kind: string | undefined, use: (feature: string) => void): void;
}

export interface ExecutionOptions {
  /** Installed plugin extensions; their features join the core table. */
  extensions?: readonly ExecutionExtension[];
}

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,31}$/;
const PLUGIN_FEATURE = /^plugin:([a-z][a-z0-9-]{0,31})\/[a-z0-9][a-z0-9-]{0,47}@[1-9]\d*$/;

/**
 * The core feature table plus the installed plugins' features. A plugin may
 * only declare namespaced features of its own, introduced no later than its
 * installed version; core features cannot be redefined.
 */
export function composeExecutionFeatures(extensions: readonly ExecutionExtension[] = []): Readonly<Record<string, string>> {
  const table: Record<string, string> = { ...OLL_EXECUTION_FEATURES };
  const plugins = new Set<string>();
  for (const [index, extension] of extensions.entries()) {
    const path = `extensions/${index}`;
    const { id, version } = extension.plugin;
    if (!PLUGIN_ID.test(id)) throw new ExecutionCapabilityError(`${path}/plugin/id`, `Invalid plugin id '${id}'`);
    if (plugins.has(id)) throw new ExecutionCapabilityError(`${path}/plugin/id`, `Plugin '${id}' is installed twice`);
    plugins.add(id);
    compareExecutionVersions(version, version);
    for (const [feature, minimum] of Object.entries(extension.features)) {
      const match = PLUGIN_FEATURE.exec(feature);
      if (!match || match[1] !== id) {
        throw new ExecutionCapabilityError(`${path}/features`, `Plugin '${id}' may only declare features named 'plugin:${id}/<name>@<major>', not '${feature}'`);
      }
      if (compareExecutionVersions(minimum, version) > 0) {
        throw new ExecutionCapabilityError(`${path}/features`, `Feature '${feature}' needs plugin ${id} ${minimum}, newer than installed ${version}`);
      }
      table[feature] = minimum;
    }
  }
  return Object.freeze(table);
}

const pluginOf = (feature: string) => PLUGIN_FEATURE.exec(feature)?.[1];

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
export function deriveExecutionRequirements(events: readonly CanonicalEvent[], options: ExecutionOptions = {}): ExecutionRequirements {
  const extensions = options.extensions ?? [];
  const features = extensions.length ? composeExecutionFeatures(extensions) : OLL_EXECUTION_FEATURES;
  const required = new Set<string>();
  // Node kinds created in these events, so revisions reach detectors with their kind.
  const kinds = new Map<string, string>();
  const add = (feature: string, path: string) => {
    if (!Object.hasOwn(features, feature)) {
      throw new ExecutionCapabilityError(path, `Unsupported executable capability '${feature}'`);
    }
    required.add(feature);
  };
  const content = (value: Record<string, unknown> | undefined, path: string, kind?: string) => {
    if (!value) return;
    for (const extension of extensions) extension.detect?.(value, kind, (feature) => add(feature, path));
    if (Array.isArray(value.regular_polygons) && value.regular_polygons.length) add("geometry:regular-polygons", path);
    if (Array.isArray(value.highlights) && value.highlights.some((highlight) => (highlight as { shown?: unknown }).shown === "when_emphasized")) add("scene3d:latent-highlights", path);
    if (Array.isArray(value.objects) && value.objects.some((object) => object.face_targets === true)) add("scene3d:face-targets", path);
    const bindings = value.bindings;
    if (Array.isArray(bindings) && bindings.length) {
      add("value-bindings", path);
      for (const [index, binding] of bindings.entries()) {
        if ((binding as { label?: unknown }).label !== undefined) add("binding-labels", `${path}/bindings/${index}`);
        if ((binding as { allow_zero?: unknown }).allow_zero !== undefined) add("bound-zero-radius", `${path}/bindings/${index}`);
        if ((binding as { hide_when_undefined?: unknown }).hide_when_undefined !== undefined) add("binding-hide-undefined", `${path}/bindings/${index}`);
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
    if (event.lesson?.mode === "learner_taught") add("lesson-mode:learner_taught", `${path}/lesson/mode`);
    if (event.lesson?.variables?.length) add("variables", `${path}/lesson/variables`);
    if (event.lesson?.variables?.some((variable) => variable.wrap)) add("variables:wrap", `${path}/lesson/variables`);
    if (event.lesson?.reflections?.length) add("reflections", `${path}/lesson/reflections`);
    for (const task of event.lesson?.tasks ?? []) {
      if (task.start) add("practice-start", `${path}/lesson/tasks/${task.as}/start`);
      add(`student-tasks:${task.completion.kind}`, `${path}/lesson/tasks/${task.as}`);
    }
    for (const beat of event.step?.beats ?? []) {
      if (beat.pace === "continuous") add("beat-pace:continuous", `${path}/step/beats/${beat.id}/pace`);
      // Scan in playback order so a revision sees the kind of a node created
      // earlier in the beat, regardless of the stage keys' order in JSON.
      for (const phase of ["before_speech", "during_speech", "after_speech"] as const) for (const action of beat.stage[phase] ?? []) {
        const actionPath = `${path}/actions/${action.action_id}`;
        add(`action:${action.op}`, actionPath);
        if (action.op === "board.emphasize" && action.emphasis === "none") add("emphasis:none", `${actionPath}/emphasis`);
        const inkContent = action.node?.kind === "ink" ? action.node.content : action.op === "board.revise" ? action.revision?.content : undefined;
        if (inkContent && (inkContent as { shown_strokes?: unknown }).shown_strokes !== undefined) add("ink:shown-strokes", `${actionPath}`);
        if (inkContent && (inkContent as { drawn_size?: unknown }).drawn_size !== undefined) add("ink:drawn-size", `${actionPath}`);
        if (action.node) {
          add(`node:${String(action.node.kind)}`, `${actionPath}/node/kind`);
          const relation = action.node.placement?.relation;
          if (relation === "annotates" || relation === "replaces" || relation === "continues") add(`placement:${relation}`, `${actionPath}/node/placement`);
          if (action.node.source !== undefined) add("write-source", `${actionPath}/node/source`);
          kinds.set(action.node.id, String(action.node.kind));
          content(action.node.content, `${actionPath}/node/content`, String(action.node.kind));
          if (action.node.kind === "scene3d") {
            const scene = action.node.content as { objects?: Array<Record<string, unknown>>; bindings?: Array<{ target?: string }> };
            if ((scene.objects ?? []).some((object) => MORE_SOLIDS.has(String(object.kind)) || object.base !== undefined || object.top_scale !== undefined)) {
              add("scene3d:more-solids", `${actionPath}/node/content/objects`);
            }
            if ((scene.objects ?? []).some((object) => object.unfold !== undefined) || (scene.bindings ?? []).some((binding) => String(binding.target).endsWith(".unfold"))) {
              add("scene3d:unfold", `${actionPath}/node/content`);
            }
          }
        }
        if (action.revision) {
          const target = action.target?.node_id;
          content(action.revision.content, `${actionPath}/revision/content`, target === undefined ? undefined : kinds.get(target));
        }
      }
    }
  }
  const requiredCapabilities = [...required].sort();
  // Core features set the player version; plugin features set their plugin's version.
  let minimumPlayerVersion = "0.1.0";
  // A Map: plugin ids such as "constructor" must not meet inherited properties.
  const pluginMinimums = new Map<string, string>();
  for (const feature of requiredCapabilities) {
    const minimum = features[feature]!;
    const plugin = pluginOf(feature);
    if (plugin) {
      const current = pluginMinimums.get(plugin);
      if (current === undefined || compareExecutionVersions(minimum, current) > 0) pluginMinimums.set(plugin, minimum);
    } else if (compareExecutionVersions(minimum, minimumPlayerVersion) > 0) {
      minimumPlayerVersion = minimum;
    }
  }
  return { minimumPlayerVersion, requiredCapabilities, ...(pluginMinimums.size ? { requiredPlugins: Object.fromEntries(pluginMinimums) } : {}) };
}

export function assertExecutionSupported(
  events: readonly CanonicalEvent[],
  playerVersion = OLL_PLAYER_EXECUTION_VERSION,
  supportedCapabilities?: readonly string[],
  options: ExecutionOptions = {},
): ExecutionRequirements {
  const extensions = options.extensions ?? [];
  const requirements = deriveExecutionRequirements(events, options);
  const available = new Set(supportedCapabilities ?? Object.keys(composeExecutionFeatures(extensions)));
  if (compareExecutionVersions(requirements.minimumPlayerVersion, playerVersion) > 0) {
    throw new ExecutionCapabilityError("minimumPlayerVersion", `Lesson requires player ${requirements.minimumPlayerVersion}`);
  }
  for (const [plugin, minimum] of Object.entries(requirements.requiredPlugins ?? {})) {
    const installed = extensions.find((extension) => extension.plugin.id === plugin)?.plugin.version;
    if (!installed) throw new ExecutionCapabilityError("requiredPlugins", `Lesson requires the '${plugin}' plugin ${minimum}, which is not installed`);
    if (compareExecutionVersions(minimum, installed) > 0) {
      throw new ExecutionCapabilityError("requiredPlugins", `Lesson requires the '${plugin}' plugin ${minimum}; installed ${installed}`);
    }
  }
  for (const capability of requirements.requiredCapabilities) {
    if (!available.has(capability)) throw new ExecutionCapabilityError("requiredCapabilities", `Player does not support '${capability}'`);
  }
  return requirements;
}

export function assertExecutionDeclaration(
  events: readonly CanonicalEvent[],
  declaration: { minimumPlayerVersion: string; requiredCapabilities?: readonly string[] },
  options: ExecutionOptions = {},
): ExecutionRequirements {
  const features = composeExecutionFeatures(options.extensions);
  const requirements = assertExecutionSupported(events, undefined, undefined, options);
  if (compareExecutionVersions(declaration.minimumPlayerVersion, requirements.minimumPlayerVersion) < 0) {
    throw new ExecutionCapabilityError("minimumPlayerVersion", "Declared player version is lower than the content requires");
  }
  // Legacy 0.1 packs remain valid without a new declaration. New feature packs,
  // and any lesson that needs a plugin, must declare it.
  if (!declaration.requiredCapabilities && (requirements.minimumPlayerVersion !== "0.1.0" || requirements.requiredPlugins)) {
    throw new ExecutionCapabilityError("requiredCapabilities", "New executable features require a capability declaration");
  }
  if (declaration.requiredCapabilities) {
    for (const feature of requirements.requiredCapabilities) {
      if (!declaration.requiredCapabilities.includes(feature)) {
        throw new ExecutionCapabilityError("requiredCapabilities", `Declaration omits '${feature}'`);
      }
    }
    for (const feature of declaration.requiredCapabilities) {
      if (!Object.hasOwn(features, feature)) {
        throw new ExecutionCapabilityError("requiredCapabilities", `Unsupported declared capability '${feature}'`);
      }
    }
  }
  return requirements;
}

/**
 * Checks a lesson package's declared requirements against this player before
 * any lesson event is read: its version, each core feature, and each plugin
 * feature with the installed plugin. Messages name what is missing.
 */
export function assertDeclarationPlayable(
  declaration: { minimumPlayerVersion: string; requiredCapabilities?: readonly string[] },
  playerVersion = OLL_PLAYER_EXECUTION_VERSION,
  options: ExecutionOptions = {},
): void {
  if (compareExecutionVersions(declaration.minimumPlayerVersion, playerVersion) > 0) {
    throw new ExecutionCapabilityError("minimumPlayerVersion", `Lesson requires player ${declaration.minimumPlayerVersion}`);
  }
  const extensions = options.extensions ?? [];
  const features = composeExecutionFeatures(extensions);
  for (const feature of declaration.requiredCapabilities ?? []) {
    if (Object.hasOwn(features, feature)) continue;
    const plugin = pluginOf(feature);
    if (!plugin) throw new ExecutionCapabilityError("requiredCapabilities", `Player does not support '${feature}'`);
    const installed = extensions.find((extension) => extension.plugin.id === plugin)?.plugin.version;
    throw new ExecutionCapabilityError("requiredPlugins", installed
      ? `Lesson uses '${feature}', which the installed '${plugin}' plugin ${installed} does not have`
      : `Lesson requires the '${plugin}' plugin, which is not installed`);
  }
}

