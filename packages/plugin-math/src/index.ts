/**
 * The math subject plugin's shared layer (decision 0012): its manifest, its
 * Jev subject line, and recipe builders that turn neutral input into OLL
 * authoring actions. Coach (from a Lesson Plan) and Studio (from a recording)
 * both call these builders, so a recipe is written once. Part names are the
 * builder's; callers map any older names they saved.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";

export const MATH_PLUGIN_MANIFEST = {
  id: "math",
  version: "0.1.0",
  depends: {},
  ollCore: ">=0.10.0",
} as const;

/** The plugin's choice in the Jev subject question, per language. */
export const MATH_SUBJECT_DESCRIPTION = {
  "zh-CN": "数学：数与运算、代数、函数与图像、几何、统计与概率",
  "en-US": "Mathematics: number, algebra, functions and graphs, geometry, statistics and probability",
} as const;

/** A lesson number driving a recipe, as the caller's OLL expression. */
export interface BuilderNumber {
  /** OLL expression for the value, such as "theta" or "round(n1)". */
  expression: string;
  /** The value when the lesson starts, in the recipe's own unit. */
  initial: number;
  min?: number;
  max?: number;
}

export interface BuiltRecipe {
  actions: AuthoringAction[];
  /** The node a reference to the whole recipe points at. */
  whole: string;
  /** Logical part name to OLL reference ("node" or "node#fragment"). */
  parts: Record<string, string>;
}

// ---------------------------------------------------------------- unit circle

export interface UnitCircleInput {
  /** Node alias the caller chose. With a graph, the circle and graph are `${as}-circle` and `${as}-plot`, grouped as `as`. */
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  /**
   * The angle in radians. `variable` is the OLL variable the moving point
   * drags; `expression` is the angle as an expression of it (for example a
   * degree variable scaled to radians). Without it the point is fixed.
   */
  angle?: BuilderNumber & { variable: string };
  /** The fixed angle in radians when there is no angle number. Default π/3. */
  fixed_angle?: number;
  text: {
    title?: string;
    /** Label of the moving point. Default "P(cos θ, sin θ)". */
    point_label?: string;
    radius_label?: string;
    foot_label?: string;
  };
  /** Also draw the sin or cos graph, linked and grouped with the circle. */
  graph?: {
    projection: "sin" | "cos";
    title: string;
    link_label: string;
    group_label: string;
  };
}

export const UNIT_CIRCLE_PART_IDS = {
  unit_circle: "unit-circle",
  moving_point: "moving-point",
  projection_foot: "projection-foot",
  radius: "radius",
  projection_line: "projection",
  angle: "angle",
  origin: "origin",
} as const;

export function buildUnitCircle(input: UnitCircleInput): BuiltRecipe {
  const theta = input.angle ? input.angle.initial : input.fixed_angle ?? Math.PI / 3;
  const variable = input.angle?.variable;
  const angleExpression = input.angle?.expression;
  const circle = input.graph ? `${input.as}-circle` : input.as;
  const geometry: Record<string, unknown> = {
    ...(input.text.title !== undefined ? { title: input.text.title } : {}),
    axes: {
      x: { min: -1.25, max: 1.25, label: "x" },
      y: { min: -1.25, max: 1.25, label: "y" },
      equal_scale: true,
    },
    points: [
      { as: "origin", x: 0, y: 0, label: "O" },
      {
        as: "moving-point",
        x: Math.cos(theta),
        y: Math.sin(theta),
        label: input.text.point_label ?? "P(cos θ, sin θ)",
        ...(variable ? { interaction: { kind: "angle_control", variable, center: "origin" } } : {}),
      },
      { as: "projection-foot", x: Math.cos(theta), y: 0, ...(input.text.foot_label !== undefined ? { label: input.text.foot_label } : {}) },
    ],
    circles: [{ as: "unit-circle", center: "origin", radius: 1, label: "r = 1" }],
    segments: [
      { as: "radius", from: "origin", to: "moving-point", ...(input.text.radius_label !== undefined ? { label: input.text.radius_label } : {}), style: "solid" },
      { as: "projection", from: "moving-point", to: "projection-foot", style: "projection", label: "sin θ" },
    ],
    arcs: [{ as: "angle", center: "origin", radius: 0.28, start_angle: 0, end_angle: theta, label: "θ" }],
    ...(angleExpression ? {
      bindings: [
        { target: "moving-point.x", expression: `cos(${angleExpression})` },
        { target: "moving-point.y", expression: `sin(${angleExpression})` },
        { target: "projection-foot.x", expression: `cos(${angleExpression})` },
        { target: "angle.end_angle", expression: angleExpression },
      ],
    } : {}),
  };
  const circleParts = {
    unit_circle: `${circle}#unit-circle`,
    moving_point: `${circle}#moving-point`,
    radius: `${circle}#radius`,
    projection_line: `${circle}#projection`,
  };
  if (!input.graph) {
    return {
      actions: [{ do: "write", as: circle, kind: "geometry", role: input.role, content: geometry, place: input.place } as AuthoringAction],
      whole: circle,
      parts: { whole: circle, ...circleParts, ...(variable ? { primary_control: `${circle}#moving-point` } : {}) },
    };
  }
  const { projection, title, link_label, group_label } = input.graph;
  const plot = `${input.as}-plot`;
  const plotContent: Record<string, unknown> = {
    title,
    axes: {
      x: { min: input.angle?.min ?? 0, max: input.angle?.max ?? Math.PI * 2, label: "θ" },
      y: { min: -1.2, max: 1.2, label: "y" },
    },
    curves: [{ as: "primary-curve", expression: `${projection}(x)`, label: `y = ${projection}(x)` }],
    points: [{ as: "moving-point", x: theta, y: Math[projection](theta), label: `P(θ, ${projection}(θ))` }],
    ...(angleExpression ? {
      bindings: [
        { target: "moving-point.x", expression: angleExpression },
        { target: "moving-point.y", expression: `${projection}(${angleExpression})` },
      ],
    } : {}),
  };
  return {
    actions: [
      { do: "write", as: circle, kind: "geometry", role: input.role, content: geometry, place: input.place },
      { do: "write", as: plot, kind: "plot", role: input.role, content: plotContent, place: { relation: "right_of", anchor: circle, gap: "normal" } },
      { do: "connect", as: `${input.as}-link`, from: circle, to: plot, relation: "maps_to", label: link_label },
      { do: "group", as: input.as, role: input.role, label: group_label, members: [circle, plot] },
    ] as AuthoringAction[],
    whole: input.as,
    parts: {
      whole: input.as,
      ...circleParts,
      primary_curve: `${plot}#primary-curve`,
      ...(variable ? { primary_control: `${circle}#moving-point` } : {}),
    },
  };
}

// ------------------------------------------------------- regular polygons

export interface CirclePolygonsInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  radius: number;
  /** The side count: a number (driven by `expression`) or a fixed count. */
  sides: BuilderNumber | number;
  /** Also draw the circumscribed polygon, for perimeter bounds on π. */
  circumscribed: boolean;
  text: {
    title?: string;
    inscribed_label: string;
    circumscribed_label?: string;
    caption?: string;
  };
}

export const CIRCLE_POLYGON_PART_IDS = {
  center: "center",
  circle: "circle",
  inscribed_polygon: "inscribed",
  circumscribed_polygon: "circumscribed",
} as const;

export function buildCirclePolygons(input: CirclePolygonsInput): BuiltRecipe {
  const { radius } = input;
  const driven = typeof input.sides === "number" ? undefined : input.sides;
  const sides = typeof input.sides === "number" ? input.sides : input.sides.initial;
  // The outer polygon fits even at the smallest permitted side count.
  const extent = input.circumscribed
    ? radius / Math.cos(Math.PI / (driven?.min ?? sides)) * 1.18
    : radius * 1.3;
  const polygon = (as: "inscribed" | "circumscribed", label: string | undefined) => ({
    as, center: "center", radius, sides, relation: as,
    ...(input.circumscribed ? { tone: as === "inscribed" ? "primary" : "accent" } : {}),
    label, show_measurements: true,
  });
  const content: Record<string, unknown> = {
    ...(input.text.title !== undefined ? { title: input.text.title } : {}),
    axes: { x: { min: -extent, max: extent, label: "x" }, y: { min: -extent, max: extent, label: "y" }, equal_scale: true },
    points: [{ as: "center", x: 0, y: 0, label: "O" }],
    circles: [{ as: "circle", center: "center", radius, label: `r = ${radius}` }],
    regular_polygons: [
      polygon("inscribed", input.text.inscribed_label),
      ...(input.circumscribed ? [polygon("circumscribed", input.text.circumscribed_label)] : []),
    ],
    ...(input.text.caption !== undefined ? { caption: input.text.caption } : {}),
    ...(driven ? { bindings: [
      { target: "inscribed.sides", expression: driven.expression },
      ...(input.circumscribed ? [{ target: "circumscribed.sides", expression: driven.expression }] : []),
    ] } : {}),
  };
  return {
    actions: [{ do: "write", as: input.as, kind: "geometry", role: input.role, content, place: input.place } as AuthoringAction],
    whole: input.as,
    parts: {
      whole: input.as,
      circle: `${input.as}#circle`,
      inscribed_polygon: `${input.as}#inscribed`,
      ...(input.circumscribed ? { circumscribed_polygon: `${input.as}#circumscribed` } : {}),
      primary_control: input.as,
    },
  };
}


// -------------------------------------------------------------- function plot

/** The curve name of curve `index` (0-based): the first is the primary curve. */
export const functionCurveId = (index: number) => (index === 0 ? "primary-curve" : `curve-${String(index + 1).padStart(2, "0")}`);

/** Replaces a whole-word identifier, the way bindings substitute x. */
function replaceIdentifier(expression: string, source: string, target: string): string {
  return expression.replace(new RegExp(`\\b${source}\\b`, "gu"), target);
}

export interface FunctionPlotInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  title?: string;
  /** Axes as the plot shows them; the caller decides the viewport. */
  axes: Record<string, unknown>;
  /** Curves in order; the first is the primary curve the points follow. */
  curves: Array<Record<string, unknown> & { expression: string }>;
  /**
   * Points that move along the primary curve: x follows `x_expression`, y is
   * the primary curve at that x. Two points are A and B of a secant.
   */
  samples?: Array<{ x: number; y: number; label: string; x_expression: string }>;
  /** Fixed-x points whose y follows the primary curve as its parameters change (slope references). */
  references?: Array<{ x: number; y: number; label: string }>;
}

export const FUNCTION_PLOT_POINT_IDS = { samples: ["moving-point", "second-point"], references: ["reference-a", "reference-b"] } as const;

export function buildFunctionPlot(input: FunctionPlotInput): BuiltRecipe {
  const primary = input.curves[0]!.expression;
  const content: Record<string, unknown> = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    axes: input.axes,
    curves: input.curves.map((curve, index) => ({ as: functionCurveId(index), ...curve })),
  };
  if (input.samples?.length) {
    content.points = input.samples.map((sample, index) => ({ as: FUNCTION_PLOT_POINT_IDS.samples[index], x: sample.x, y: sample.y, label: sample.label }));
    content.bindings = input.samples.flatMap((sample, index) => {
      const point = FUNCTION_PLOT_POINT_IDS.samples[index];
      return [{ target: `${point}.x`, expression: sample.x_expression },
        { target: `${point}.y`, expression: replaceIdentifier(primary, "x", sample.x_expression) }];
    });
    if (input.samples.length === 2) content.measurement = "secant";
  } else if (input.references?.length) {
    content.points = input.references.map((reference, index) => ({ as: FUNCTION_PLOT_POINT_IDS.references[index], x: reference.x, y: reference.y, label: reference.label }));
    content.bindings = input.references.map((reference, index) => ({ target: `${FUNCTION_PLOT_POINT_IDS.references[index]}.y`, expression: replaceIdentifier(primary, "x", String(reference.x)) }));
    content.measurement = "secant";
    content.sample_input = "fixed_x";
  }
  return {
    actions: [{ do: "write", as: input.as, kind: "plot", role: input.role, content, place: input.place } as AuthoringAction],
    whole: input.as,
    parts: {
      whole: input.as,
      primary_curve: `${input.as}#primary-curve`,
      ...(input.samples?.length ? { moving_point: `${input.as}#moving-point` } : {}),
    },
  };
}

/** The math plugin's recipe builders, by recipe name. */
export const MATH_BUILDERS = {
  function_plot: buildFunctionPlot,
  unit_circle_projection: buildUnitCircle,
  circle_polygon_bounds: buildCirclePolygons,
} as const;
