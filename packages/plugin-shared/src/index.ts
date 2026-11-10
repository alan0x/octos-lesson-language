/**
 * The shared subject plugin's shared layer (decision 0012): tools every
 * subject uses. It is never a choice in the Jev subject question. Coach and
 * Studio both call these builders.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";

export const SHARED_PLUGIN_MANIFEST = {
  id: "shared",
  version: "0.1.0",
  depends: {},
  ollCore: ">=0.10.0",
} as const;

export interface BuiltRecipe {
  actions: AuthoringAction[];
  whole: string;
  /** Logical part name to OLL reference ("node" or "node#fragment"). */
  parts: Record<string, string>;
}

const pad = (index: number) => String(index).padStart(2, "0");

/** The element name of step `index` (1-based). */
export const processStepId = (index: number) => `step-${pad(index)}`;
/** The edge leading from step `index` to the next one (1-based). */
export const processEdgeId = (index: number) => `edge-${pad(index)}`;
/** The edge that closes a cycle, from the last step back to the first. */
export const PROCESS_CYCLE_EDGE_ID = "edge-close";

export interface ProcessDiagramInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  title?: string;
  /** Steps in order. `link` labels the edge arriving at this step. */
  steps: Array<{ label: string; link?: string }>;
  /** A cycle also joins the last step back to the first (with three or more steps). */
  shape?: "chain" | "cycle";
  /** Label for edges whose step has no `link`. */
  link_label?: string;
}

/** The diagram's content alone, for writing it or revising it after steps are added. */
export function processDiagramContent(input: Omit<ProcessDiagramInput, "as" | "role" | "place">): Record<string, unknown> {
  const { steps } = input;
  const elements = steps.map((step, index) => ({ as: processStepId(index + 1), label: step.label }));
  const edges: Array<Record<string, unknown>> = steps.slice(1).map((step, index) => {
    const label = step.link ?? input.link_label;
    return { as: processEdgeId(index + 1), from: processStepId(index + 1), to: processStepId(index + 2), ...(label !== undefined ? { label } : {}) };
  });
  if (input.shape === "cycle" && steps.length > 2) {
    edges.push({ as: PROCESS_CYCLE_EDGE_ID, from: processStepId(steps.length), to: processStepId(1) });
  }
  return { ...(input.title !== undefined ? { title: input.title } : {}), elements, edges };
}

export function buildProcessDiagram(input: ProcessDiagramInput): BuiltRecipe {
  const count = input.steps.length;
  return {
    actions: [{ do: "write", as: input.as, kind: "diagram", role: input.role, content: processDiagramContent(input), place: input.place } as AuthoringAction],
    whole: input.as,
    parts: {
      whole: input.as,
      first_step: `${input.as}#${processStepId(1)}`,
      current_step: `${input.as}#${processStepId(Math.min(2, count))}`,
      last_step: `${input.as}#${processStepId(count)}`,
    },
  };
}

export const SHARED_BUILDERS = {
  process_diagram: buildProcessDiagram,
} as const;
