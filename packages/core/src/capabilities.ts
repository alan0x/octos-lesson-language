/**
 * Executable capabilities implemented by the current OLL core/runtime.
 *
 * This is deliberately a code-owned table, not a model-authored plan. New
 * entries must be backed by validation and runtime behavior before they are
 * added here.
 */

export const OLL_NODE_KINDS = [
  "text",
  "math",
  "shape",
  "diagram",
  "geometry",
  "plot",
  "scene3d",
  "image",
  "table",
  "note",
] as const;

export type OllNodeKind = typeof OLL_NODE_KINDS[number];

export const OLL_ACTION_NAMES = [
  "write",
  "revise",
  "emphasize",
  "connect",
  "group",
  "focus",
  "point",
  "expression",
  "animate",
] as const;

export type OllActionName = typeof OLL_ACTION_NAMES[number];

/** Numeric fragment fields that can be driven by lesson variables. */
export const OLL_BINDING_CAPABILITIES = {
  geometry: {
    points: ["x", "y"],
    circles: ["radius"],
    arcs: ["radius", "start_angle", "end_angle"],
  },
  plot: {
    points: ["x", "y"],
    guides: ["value"],
  },
  scene3d: {
    sections: ["value"],
  },
} as const;

export type OllBindableNodeKind = keyof typeof OLL_BINDING_CAPABILITIES;
export type OllBindingCollections = Readonly<Record<string, readonly string[]>>;

const EMPTY_BINDING_COLLECTIONS: OllBindingCollections = Object.freeze({});

export function bindingCapabilitiesForNodeKind(kind: string): OllBindingCollections {
  if (Object.hasOwn(OLL_BINDING_CAPABILITIES, kind)) {
    return OLL_BINDING_CAPABILITIES[kind as OllBindableNodeKind];
  }
  return EMPTY_BINDING_COLLECTIONS;
}

function collectBindingCapabilities(): OllBindingCollections {
  const collected: Record<string, string[]> = {};
  for (const collections of Object.values(OLL_BINDING_CAPABILITIES)) {
    for (const [collection, properties] of Object.entries(collections)) {
      const values = collected[collection] ?? [];
      for (const property of properties) {
        if (!values.includes(property)) values.push(property);
      }
      collected[collection] = values;
    }
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(collected).map(([collection, properties]) => [
      collection,
      Object.freeze(properties),
    ]),
  ));
}

/** Canonical content has fragment IDs instead of authoring aliases. */
export const OLL_CANONICAL_BINDING_CAPABILITIES = collectBindingCapabilities();

export const OLL_VARIABLE_CONTROL_KINDS = ["slider", "geometry_point"] as const;
export const OLL_SCENE3D_CONTROL_KINDS = ["orbit", "zoom", "preset", "reset"] as const;
export const OLL_TASK_COMPLETION_KINDS = ["expression_target", "scene3d_view_target"] as const;
export const OLL_SCENE3D_VIEW_MATCH_KINDS = ["view_direction", "camera_pose"] as const;

/**
 * Serializable discovery surface for generators and hosts. It describes what
 * this version can execute; it does not say what a particular lesson must use.
 */
export const OLL_EXECUTION_CAPABILITIES = {
  version: "0.1",
  node_kinds: OLL_NODE_KINDS,
  action_names: OLL_ACTION_NAMES,
  value_bindings: OLL_BINDING_CAPABILITIES,
  student_controls: {
    variable: OLL_VARIABLE_CONTROL_KINDS,
    scene3d: OLL_SCENE3D_CONTROL_KINDS,
  },
  student_tasks: {
    completion: OLL_TASK_COMPLETION_KINDS,
    scene3d_view_match: OLL_SCENE3D_VIEW_MATCH_KINDS,
  },
} as const;
