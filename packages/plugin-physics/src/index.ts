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

/**
 * A quantity of the motion: a lesson variable (`expression`, an OLL
 * expression of lesson variables, usually one variable's name) or a fixed
 * value. `max` sizes the track and the graph, so the object never leaves them.
 */
export interface MotionQuantity {
  expression?: string;
  initial: number;
  max: number;
}

export interface ConstantSpeedMotionInput {
  /** The group's alias; the track and graph are `${as}-track` and `${as}-graph`. */
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  /** Elapsed time, from 0 (seconds by default). */
  time: MotionQuantity;
  /** The constant speed, greater than 0 (metres per second by default). */
  speed: MotionQuantity;
  /** Every label, in the lesson's language. Units are shown as given. */
  text: {
    title: string;
    start: string;
    object: string;
    /** Prefix of the distance readout that labels the moving object, such as "cart: s = ". */
    distance_readout: string;
    distance_unit: string;
    distance_axis: string;
    time_axis: string;
    plot_title: string;
    /** The line's legend, such as "s = v t". */
    curve_label: string;
    current_state: string;
    link_label: string;
    group_label: string;
  };
}

export const CONSTANT_SPEED_PART_IDS = {
  start: "start", object: "object", track: "track", travelled: "travelled", finish: "finish",
  primary_curve: "primary-curve", moving_point: "moving-point",
} as const;

/** A round upper bound for an axis: 1, 2, 2.5 or 5 times a power of ten, at or above `value`. */
export function niceAxisMax(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value * (1 - 1e-9)) ?? 10;
  return Number((step * power).toPrecision(12));
}

function quantityValue(quantity: MotionQuantity): string {
  return quantity.expression ? `(${quantity.expression})` : String(quantity.initial);
}

/**
 * An object moving at constant speed along a track (s = v·t), linked to its
 * distance–time graph, a straight line through the origin whose slope is the
 * speed. Time and speed may each be a lesson variable: dragging time moves the
 * object and the graph's point together; changing speed changes the line's
 * slope. Built only on shared geometry and plot features.
 */
export function buildConstantSpeedMotion(input: ConstantSpeedMotionInput): BuiltRecipe {
  const { text, time, speed } = input;
  if (!(time.max > 0) || !(speed.max > 0)) throw new Error("constant-speed motion needs a positive time and speed maximum");
  if (time.initial < 0 || time.initial > time.max || speed.initial <= 0 || speed.initial > speed.max) {
    throw new Error("constant-speed motion needs 0 <= time <= its maximum and 0 < speed <= its maximum");
  }
  const track = `${input.as}-track`;
  const graph = `${input.as}-graph`;
  const length = niceAxisMax(time.max * speed.max);
  const distance = time.initial * speed.initial;
  const t = quantityValue(time);
  const v = quantityValue(speed);
  const driven = Boolean(time.expression || speed.expression);
  // The track runs just above the distance axis, which reads as a ruler under it
  // and keeps the axis label clear of the moving object's readout.
  const lane = Number((0.08 * length).toPrecision(12));
  const trackContent: Record<string, unknown> = {
    title: text.title,
    axes: { x: { min: -0.05 * length, max: 1.05 * length, label: text.distance_axis }, y: { min: -0.1 * length, max: 0.2 * length, label: "" }, equal_scale: true },
    points: [
      { as: "start", x: 0, y: lane, label: text.start },
      { as: "finish", x: length, y: lane, visible: false },
      { as: "object", x: distance, y: lane, label: driven ? `${text.distance_readout}${distance}${text.distance_unit ? ` ${text.distance_unit}` : ""}` : text.object },
    ],
    segments: [
      { as: "track", from: "start", to: "finish", style: "dashed" },
      { as: "travelled", from: "start", to: "object", style: "solid" },
    ],
    ...(driven ? {
      bindings: [{
        target: "object.x", expression: `${v}*${t}`,
        label: { prefix: text.distance_readout, suffix: text.distance_unit ? ` ${text.distance_unit}` : "", precision: 1 },
      }],
    } : {}),
  };
  const graphContent: Record<string, unknown> = {
    title: text.plot_title,
    axes: { x: { min: 0, max: time.max, label: text.time_axis }, y: { min: 0, max: length, label: text.distance_axis } },
    curves: [{ as: "primary-curve", expression: `${v}*x`, label: text.curve_label }],
    points: [{ as: "moving-point", x: time.initial, y: distance, label: text.current_state }],
    ...(driven ? {
      bindings: [
        { target: "moving-point.x", expression: t },
        { target: "moving-point.y", expression: `${v}*${t}` },
      ],
    } : {}),
  };
  return {
    actions: [
      { do: "write", as: track, kind: "geometry", role: input.role, content: trackContent, place: input.place },
      { do: "write", as: graph, kind: "plot", role: input.role, content: graphContent, place: { relation: "right_of", anchor: track, gap: "normal" } },
      { do: "connect", as: `${input.as}-link`, from: track, to: graph, relation: "same_state", label: text.link_label },
      { do: "group", as: input.as, role: input.role, label: text.group_label, members: [track, graph] },
    ] as AuthoringAction[],
    whole: input.as,
    parts: {
      whole: input.as,
      start: `${track}#start`,
      object: `${track}#object`,
      track: `${track}#track`,
      travelled: `${track}#travelled`,
      primary_curve: `${graph}#primary-curve`,
      moving_point: `${graph}#moving-point`,
      ...(time.expression ? { primary_control: `${graph}#moving-point` } : {}),
    },
  };
}

/** The physics plugin's recipe builders, by recipe name. */
export const PHYSICS_BUILDERS = {
  spring_and_mass: buildSpringAndMass,
  constant_speed_motion: buildConstantSpeedMotion,
} as const;
