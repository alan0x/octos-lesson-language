/**
 * The physics subject plugin's shared layer (decision 0012): its manifest,
 * its Jev subject line, and recipe builders that turn neutral input into OLL
 * authoring actions.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";

export const PHYSICS_PLUGIN_MANIFEST = {
  id: "physics",
  version: "0.1.0",
  depends: { shared: "0.1.0" },
  ollCore: ">=0.10.0",
} as const;

/** The plugin's choice in the Jev subject question, per language. */
export const PHYSICS_SUBJECT_DESCRIPTION = {
  "zh-CN": "物理：运动与力、能量、电路、光、声、浮力等",
  "en-US": "Physics: motion and forces, energy, circuits, light, sound, buoyancy",
} as const;

export interface BuiltRecipe {
  actions: AuthoringAction[];
  whole: string;
  /** Logical part name to OLL reference ("node" or "node#fragment"). */
  parts: Record<string, string>;
}

export interface SpringAndMassInput {
  /** The group's alias; the motion and graph are `${as}-motion` and `${as}-plot`. */
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  /**
   * The oscillation phase in radians. `expression` is the phase as an OLL
   * expression of a lesson variable; without it the mass is shown at
   * `fixed_phase` (default 0).
   */
  phase?: { expression: string; initial: number; min: number; max: number };
  fixed_phase?: number;
  /** Every label, in the lesson's language. */
  text: {
    title: string;
    displacement: string;
    anchor: string;
    equilibrium: string;
    mass: string;
    restoring_force: string;
    plot_title: string;
    phase: string;
    current_state: string;
    link_label: string;
    group_label: string;
  };
}

export const SPRING_PART_IDS = {
  spring: "spring", mass: "mass", equilibrium: "equilibrium", force_arrow: "force-arrow", anchor: "anchor",
  primary_curve: "primary-curve", moving_point: "moving-point",
} as const;

/** A mass on a spring moving back and forth (x = cos phase), linked to its displacement graph. Fixed amplitude 1. */
export function buildSpringAndMass(input: SpringAndMassInput): BuiltRecipe {
  const { text } = input;
  const phase = input.phase ? input.phase.initial : input.fixed_phase ?? 0;
  const expression = input.phase?.expression;
  const motion = `${input.as}-motion`;
  const plot = `${input.as}-plot`;
  const geometry: Record<string, unknown> = {
    title: text.title,
    axes: { x: { min: -1.5, max: 1.5, label: text.displacement }, y: { min: -0.6, max: 0.6 }, equal_scale: true },
    points: [
      { as: "anchor", x: -1.25, y: 0, label: text.anchor },
      { as: "equilibrium", x: 0, y: 0, label: text.equilibrium },
      { as: "mass", x: Math.cos(phase), y: 0, label: text.mass },
      { as: "force-tip", x: Math.cos(phase) * 0.5, y: 0, visible: false },
    ],
    segments: [
      { as: "spring", from: "anchor", to: "mass", style: "solid" },
      { as: "force-arrow", from: "mass", to: "force-tip", style: "solid", label: text.restoring_force },
    ],
    ...(expression ? {
      bindings: [
        { target: "mass.x", expression: `cos(${expression})` },
        { target: "force-tip.x", expression: `0.5*cos(${expression})` },
      ],
    } : {}),
  };
  const plotContent: Record<string, unknown> = {
    title: text.plot_title,
    axes: { x: { min: input.phase?.min ?? 0, max: input.phase?.max ?? Math.PI * 2, label: text.phase }, y: { min: -1.2, max: 1.2, label: text.displacement } },
    curves: [{ as: "primary-curve", expression: "cos(x)", label: "x = cos(t)" }],
    points: [{ as: "moving-point", x: phase, y: Math.cos(phase), label: text.current_state }],
    ...(expression ? {
      bindings: [
        { target: "moving-point.x", expression },
        { target: "moving-point.y", expression: `cos(${expression})` },
      ],
    } : {}),
  };
  return {
    actions: [
      { do: "write", as: motion, kind: "geometry", role: input.role, content: geometry, place: input.place },
      { do: "write", as: plot, kind: "plot", role: input.role, content: plotContent, place: { relation: "right_of", anchor: motion, gap: "normal" } },
      { do: "connect", as: `${input.as}-link`, from: motion, to: plot, relation: "same_state", label: text.link_label },
      { do: "group", as: input.as, role: input.role, label: text.group_label, members: [motion, plot] },
    ] as AuthoringAction[],
    whole: input.as,
    parts: {
      whole: input.as,
      spring: `${motion}#spring`,
      mass: `${motion}#mass`,
      equilibrium: `${motion}#equilibrium`,
      force_arrow: `${motion}#force-arrow`,
      primary_curve: `${plot}#primary-curve`,
      moving_point: `${plot}#moving-point`,
      ...(expression ? { primary_control: `${plot}#moving-point` } : {}),
    },
  };
}

/** The physics plugin's recipe builders, by recipe name. */
export const PHYSICS_BUILDERS = {
  spring_and_mass: buildSpringAndMass,
} as const;
