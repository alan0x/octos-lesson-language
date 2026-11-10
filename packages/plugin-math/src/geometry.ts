/**
 * 2D geometry recipes of the math plugin: circle and arc, circle in
 * coordinates, unit squares filling a rectangle, the circle-area sector
 * rearrangement and rigid rearrangement proofs. Callers resolve their own
 * numbers (scaled angles, normalized progress) and pass a translator for the
 * Chinese source labels.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import { REARRANGEMENT_CONSTRUCTIONS, rearrangementRecipe, type RearrangementConstruction, type RigidPose } from "./rearrangement.js";

/** Translates a Chinese source label into the lesson's language. */
export type Translate = (source: string, values?: Record<string, unknown>) => string;

interface Built { actions: AuthoringAction[]; whole: string; parts: Record<string, string> }
interface Common { as: string; role: string; place: Placement | Record<string, unknown>; t: Translate }

const write = (input: Common, kind: string, content: Record<string, unknown>) =>
  ({ do: "write", as: input.as, kind, role: input.role, content, place: input.place }) as AuthoringAction;

// ------------------------------------------------------------ circle and arc

export interface CircleAndArcInput extends Common {
  title: string;
  radius: number;
  /** The arc's angle in radians when the lesson starts. */
  angle: number;
  /** The angle number: `variable` drives the point; `expression` is the angle in radians. */
  angle_number?: { variable: string; expression: string };
  radius_number?: { variable: string; min: number; max: number };
}

export function buildCircleAndArc(input: CircleAndArcInput): Built {
  const { radius, angle, t } = input;
  const angleVariable = input.angle_number?.variable;
  const angleExpression = input.angle_number?.expression;
  const radiusVariable = input.radius_number?.variable;
  const radiusExpression = radiusVariable ?? String(radius);
  const maximumRadius = input.radius_number
    ? Math.max(Math.abs(input.radius_number.min), Math.abs(input.radius_number.max))
    : radius;
  const geometry: Record<string, unknown> = {
    title: input.title,
    axes: {
      x: { min: -maximumRadius * 1.25, max: maximumRadius * 1.25, label: "x" },
      y: { min: -maximumRadius * 1.25, max: maximumRadius * 1.25, label: "y" },
      equal_scale: true,
    },
    points: [
      { as: "center", x: 0, y: 0, label: "O" },
      {
        as: "moving-point",
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        label: "P",
        ...(angleVariable ? { interaction: { kind: "angle_control", variable: angleVariable, center: "center" } } : {}),
      },
    ],
    circles: [{ as: "circle", center: "center", radius, label: radiusVariable ? t("半径 r") : `r = ${radius}` }],
    segments: [{ as: "radius", from: "center", to: "moving-point", style: "solid" }],
    arcs: [{ as: "arc", center: "center", radius, start_angle: 0, end_angle: angle, label: t("圆弧") }],
    ...((angleVariable || radiusVariable) ? {
      bindings: [
        ...(angleExpression ? [
          { target: "moving-point.x", expression: `${radiusExpression}*cos(${angleExpression})` },
          { target: "moving-point.y", expression: `${radiusExpression}*sin(${angleExpression})` },
          { target: "arc.end_angle", expression: angleExpression },
        ] : []),
        ...(radiusVariable ? [
          { target: "circle.radius", expression: radiusVariable },
          { target: "arc.radius", expression: radiusVariable },
        ] : []),
      ],
    } : {}),
  };
  const base = input.as;
  return {
    actions: [write(input, "geometry", geometry)],
    whole: base,
    parts: { whole: base, circle: `${base}#circle`, arc: `${base}#arc`, radius: `${base}#radius`,
      ...(angleVariable ? { primary_control: `${base}#moving-point` } : {}) },
  };
}

// -------------------------------------------------- circle in coordinates

export interface CoordinateCircleInput extends Common {
  title: string;
  center: { x: number; y: number };
  radius: number;
  /** The largest radius the circle reaches, for the viewport. */
  maximum_radius: number;
  /** A lesson number drives the radius: the variable itself, or a formula of it (which may reach 0). */
  radius_binding?: { expression: string; formula: boolean };
}

export function buildCoordinateCircle(input: CoordinateCircleInput): Built {
  const { center, radius, t } = input;
  const extent = input.maximum_radius * 1.5;
  const binding = input.radius_binding;
  const geometry = {
    title: input.title,
    axes: {
      x: { min: center.x - extent, max: center.x + extent, label: "x" },
      y: { min: center.y - extent, max: center.y + extent, label: "y" },
      equal_scale: true,
    },
    points: [{ as: "center", x: center.x, y: center.y, label: `(${center.x}, ${center.y})` }],
    circles: [{ as: "circle", center: "center", radius, label: binding ? t("半径 r") : `r = ${radius}` }],
    ...(binding ? { bindings: [{ target: "circle.radius", expression: binding.expression,
      ...(binding.formula ? { allow_zero: true, label: { prefix: "r = ", precision: 2 } } : {}) }] } : {}),
  };
  const base = input.as;
  return {
    actions: [write(input, "geometry", geometry)],
    whole: base,
    parts: { whole: base, circle: `${base}#circle`, center: `${base}#center`, radius: `${base}#circle`,
      ...(binding ? { primary_control: `${base}#circle` } : {}) },
  };
}

// ---------------------------------------------------- unit squares in a rectangle

function minimumExpression(value: number, variable: string): string {
  return `((${value})+(${variable})-abs((${value})-(${variable})))/2`;
}

export interface UnitSquareArrayInput extends Common {
  title: string;
  /** Squares per row and number of rows, each a lesson variable. */
  columns: { variable: string; initial: number; max: number };
  rows: { variable: string; initial: number; max: number };
}

export function buildUnitSquareArray(input: UnitSquareArrayInput): Built {
  const { t } = input;
  const columnVariable = input.columns.variable;
  const rowVariable = input.rows.variable;
  const columns = Math.round(input.columns.initial);
  const rows = Math.round(input.rows.initial);
  const maximumColumns = Math.round(input.columns.max);
  const maximumRows = Math.round(input.rows.max);
  const points: Array<Record<string, unknown>> = [
    { as: "boundary-bottom-left", x: 0, y: 0, visible: false },
    { as: "boundary-bottom-right", x: columns, y: 0, visible: false },
    { as: "boundary-top-right", x: columns, y: rows, visible: false },
    { as: "boundary-top-left", x: 0, y: rows, visible: false },
    { as: "unit-bottom-left", x: 0, y: 0, visible: false },
    { as: "unit-bottom-right", x: 1, y: 0, visible: false },
    { as: "unit-top-right", x: 1, y: 1, visible: false },
    { as: "unit-top-left", x: 0, y: 1, visible: false },
  ];
  const segments: Array<Record<string, unknown>> = [];
  const bindings: Array<{ target: string; expression: string }> = [
    { target: "boundary-bottom-right.x", expression: columnVariable },
    { target: "boundary-top-right.x", expression: columnVariable },
    { target: "boundary-top-right.y", expression: rowVariable },
    { target: "boundary-top-left.y", expression: rowVariable },
  ];
  for (let column = 0; column <= maximumColumns; column += 1) {
    const x = Math.min(column, columns);
    points.push(
      { as: `column-${column}-bottom`, x, y: 0, visible: false },
      { as: `column-${column}-top`, x, y: rows, visible: false },
    );
    segments.push({
      as: `column-${column}`, from: `column-${column}-bottom`, to: `column-${column}-top`,
      style: column === 0 || column === maximumColumns ? "solid" : "dashed",
    });
    bindings.push(
      { target: `column-${column}-bottom.x`, expression: minimumExpression(column, columnVariable) },
      { target: `column-${column}-top.x`, expression: minimumExpression(column, columnVariable) },
      { target: `column-${column}-top.y`, expression: rowVariable },
    );
  }
  for (let row = 0; row <= maximumRows; row += 1) {
    const y = Math.min(row, rows);
    points.push(
      { as: `row-${row}-left`, x: 0, y, visible: false },
      { as: `row-${row}-right`, x: columns, y, visible: false },
    );
    segments.push({
      as: `row-${row}`, from: `row-${row}-left`, to: `row-${row}-right`,
      style: row === 0 || row === maximumRows ? "solid" : "dashed",
    });
    bindings.push(
      { target: `row-${row}-left.y`, expression: minimumExpression(row, rowVariable) },
      { target: `row-${row}-right.x`, expression: columnVariable },
      { target: `row-${row}-right.y`, expression: minimumExpression(row, rowVariable) },
    );
  }
  const geometry = {
    title: input.title,
    caption: t("每个小方格面积为 1 平方单位；每行方格数 × 行数 = 方格总数 = 长方形面积。"),
    axes: {
      x: { min: -0.75, max: maximumColumns + 0.75, label: t("每行方格数（长）") },
      y: { min: -0.75, max: maximumRows + 0.75, label: t("行数（宽）") },
      equal_scale: true,
    },
    points,
    polygons: [
      { as: "interior", points: ["boundary-bottom-left", "boundary-bottom-right", "boundary-top-right", "boundary-top-left"], tone: "primary" },
      { as: "unit-square", points: ["unit-bottom-left", "unit-bottom-right", "unit-top-right", "unit-top-left"], label: t("1 平方单位"), tone: "accent" },
    ],
    segments,
    bindings,
  };
  const base = input.as;
  return {
    actions: [write(input, "geometry", geometry)],
    whole: base,
    parts: {
      whole: base, unit_square: `${base}#unit-square`, row: `${base}#row-1`, column: `${base}#column-1`,
      interior: `${base}#interior`, boundary: `${base}#interior`, primary_control: `${base}#interior`, secondary_control: `${base}#interior`,
    },
  };
}

// ------------------------------------------------ circle-area rearrangement

function linearExpression(start: number, end: number, progress: string): string {
  return `${start}+(${end - start})*(${progress})`;
}

export interface CircleAreaInput extends Common {
  radius: number;
  /** Rearrangement progress from 0 (circle) to 1 (near-rectangle): its expression and starting value. */
  progress?: { expression: string; initial: number };
}

/** A circle cut into 8 sectors (and 16 below) that rearrange into a near-rectangle of base πr and height r. */
export function buildCircleAreaRearrangement(input: CircleAreaInput): Built {
  const { radius: r, t } = input;
  const base = input.as;
  const progress = input.progress?.expression ?? "0";
  const initial = input.progress?.initial ?? 0;
  const actions: AuthoringAction[] = [];
  for (const [panel, n] of [8, 16].entries()) {
    const id = panel === 0 ? base : `${base}-refined`;
    const angle = 2 * Math.PI / n, chord = 2 * r * Math.sin(angle / 2), height = r * Math.cos(angle / 2);
    const points: Array<Record<string, unknown>> = [];
    const arcs: Array<Record<string, unknown>> = [];
    const bindings: Array<{ target: string; expression: string }> = [];
    for (let i = 0; i < n; i++) {
      const center = `center-${i}`, sector = `sector-${i}`;
      const up = i % 2 === 0;
      const endX = (i / 2) * chord, endY = up ? 0 : height;
      const start = i * angle, end = (up ? Math.PI / 2 : -Math.PI / 2) - angle / 2;
      points.push({ as: center, x: endX * initial, y: endY * initial, visible: false });
      arcs.push({ as: sector, center, radius: r, start_angle: start + (end - start) * initial, end_angle: start + angle + (end - start) * initial, filled: true });
      if (input.progress) bindings.push(
        { target: `${center}.x`, expression: `${endX}*(${progress})` },
        { target: `${center}.y`, expression: `${endY}*(${progress})` },
        { target: `${sector}.start_angle`, expression: linearExpression(start, end, progress) },
        { target: `${sector}.end_angle`, expression: linearExpression(start + angle, end + angle, progress) },
      );
    }
    actions.push({ do: "write", as: id, kind: "geometry", role: input.role, place: panel === 0 ? input.place : { relation: "below", anchor: base, gap: "normal" }, content: {
      title: t("{{v0}} 等分圆的面积重排", { v0: n }),
      caption: t("半径 r={{v0}}；每块均为真实扇形，重排面积不变。有限等分的边缘仍弯曲；等分越细，底趋近 πr，高趋近 r，面积为 πr²。", { v0: r }),
      axes: { x: { min: -r * 1.3, max: Math.PI * r + r }, y: { min: -r * 1.3, max: r * 1.6 }, equal_scale: true },
      points, arcs, ...(bindings.length ? { bindings } : {}),
    } } as AuthoringAction);
  }
  return { actions, whole: base, parts: { whole: base, ...(input.progress ? { primary_control: base } : {}) } };
}

// --------------------------------------------------- rigid rearrangement

function transformedPoint(point: [number, number], pose: RigidPose): [number, number] {
  const angle = pose.angle ?? 0;
  return [
    pose.x + point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
    pose.y + point[0] * Math.sin(angle) + point[1] * Math.cos(angle),
  ];
}

export interface GeometricRearrangementInput extends Omit<Common, "t"> {
  construction: RearrangementConstruction;
  legs: { a: number; b: number };
  /** Rearrangement progress from 0 to 1: its expression and starting value. */
  progress?: { expression: string; initial: number };
}

/** Rigid pieces that move from one layout to another to prove an area relation (Pythagoras, (a+b)², triangle area). */
export function buildGeometricRearrangement(input: GeometricRearrangementInput): Built {
  const { construction, legs: { a: legA, b: legB } } = input;
  const base = input.as;
  const recipe = rearrangementRecipe(construction, legA, legB);
  if (!recipe) throw new Error(`Unsupported geometric construction '${String(construction)}'`);
  const facts = REARRANGEMENT_CONSTRUCTIONS[construction];
  const progressExpression = input.progress?.expression ?? "0";
  const progressInitial = input.progress?.initial ?? 0;
  const pieces = recipe.pieces.map((piece, index) => ({ ...piece, role: `piece-${index + 1}` }));
  const targetPoints = recipe.target.map(([x, y], index) => ({ as: `target-point-${index + 1}`, x, y, visible: false }));
  const points: Array<Record<string, unknown>> = [
    ...targetPoints,
    ...pieces.flatMap((piece) => {
      const pose = {
        x: piece.start.x + (piece.end.x - piece.start.x) * progressInitial,
        y: piece.start.y + (piece.end.y - piece.start.y) * progressInitial,
        angle: (piece.start.angle ?? 0) + ((piece.end.angle ?? 0) - (piece.start.angle ?? 0)) * progressInitial,
      };
      return piece.points.map((point, pointIndex) => {
        const [x, y] = transformedPoint(point, pose);
        return { as: `${piece.role}-point-${pointIndex + 1}`, x, y, visible: false };
      });
    }),
  ];
  const polygons = [
    { as: "target-shape", points: targetPoints.map((point) => point.as), tone: "neutral" },
    ...pieces.map((piece) => ({
      as: piece.role,
      points: piece.points.map((_point, index) => `${piece.role}-point-${index + 1}`),
      label: piece.label,
      tone: piece.tone,
    })),
  ];
  const segments: Array<Record<string, unknown>> = [
    ...recipe.target.map((_point, pointIndex) => ({
      as: `target-edge-${pointIndex + 1}`,
      from: `target-point-${pointIndex + 1}`,
      to: `target-point-${(pointIndex + 1) % recipe.target.length + 1}`,
      style: "dashed",
      ...(pointIndex === 2 ? { label: construction === "triangle_to_rectangle" ? "a" : "a+b" } : {}),
    })),
  ];
  // The representative triangle stays fixed in the Pythagorean recipe; labels
  // also follow its existing point bindings in the other triangle recipe.
  if (construction !== "square_area_identity") {
    segments.push(
      { as: "leg-a", from: "piece-1-point-1", to: "piece-1-point-2", style: "solid", label: "a" },
      { as: "leg-b", from: "piece-1-point-1", to: "piece-1-point-3", style: "solid", label: "b" },
      { as: "hypotenuse", from: "piece-1-point-2", to: "piece-1-point-3", style: "solid", label: "c" },
    );
    if (construction === "right_triangle_square") {
      const marker = Math.min(legA, legB) * 0.12;
      const pose = pieces[0]!.start;
      for (const [index, point] of [[marker, 0], [marker, marker], [0, marker]].entries()) {
        const [x, y] = transformedPoint(point as [number, number], pose);
        points.push({ as: `right-angle-point-${index + 1}`, x, y, visible: false });
      }
      segments.push(
        { as: "right-angle-1", from: "right-angle-point-1", to: "right-angle-point-2", style: "solid" },
        { as: "right-angle-2", from: "right-angle-point-2", to: "right-angle-point-3", style: "solid" },
      );
    }
  }
  const bindings = input.progress
    ? pieces.flatMap((piece) => piece.points.flatMap(([localX, localY], pointIndex) => {
        const translateX = linearExpression(piece.start.x, piece.end.x, progressExpression);
        const translateY = linearExpression(piece.start.y, piece.end.y, progressExpression);
        const angle = linearExpression(piece.start.angle ?? 0, piece.end.angle ?? 0, progressExpression);
        const target = `${piece.role}-point-${pointIndex + 1}`;
        return [
          { target: `${target}.x`, expression: `(${translateX})+(${localX})*cos(${angle})-(${localY})*sin(${angle})` },
          { target: `${target}.y`, expression: `(${translateY})+(${localX})*sin(${angle})+(${localY})*cos(${angle})` },
        ];
      }))
    : [];
  if (construction === "right_triangle_square") {
    // A focus anchor in the initial c² gap and the final b² gap. The whole
    // outer square is not the central area; intermediate poses make no area claim.
    const start = (legA + legB) / 2;
    const endX = legA + legB / 2, endY = legB / 2;
    points.push({ as: "central-area", x: start + (endX - start) * progressInitial, y: start + (endY - start) * progressInitial, visible: false });
    if (input.progress) bindings.push(
      { target: "central-area.x", expression: linearExpression(start, endX, progressExpression) },
      { target: "central-area.y", expression: linearExpression(start, endY, progressExpression) },
    );
  }
  const endpointPoints = [
    ...recipe.target,
    ...pieces.flatMap((piece) => [piece.start, piece.end].flatMap((pose) => piece.points.map((point) => transformedPoint(point, pose)))),
  ];
  const xs = endpointPoints.map((point) => point[0]);
  const ys = endpointPoints.map((point) => point[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const margin = span * 0.1;
  const geometry = {
    // A fixed recipe owns its name just as it owns its shapes and proof.
    title: recipe.title,
    caption: facts.caption,
    axes: {
      x: { min: Math.min(...xs) - margin, max: Math.max(...xs) + margin },
      y: { min: Math.min(...ys) - margin, max: Math.max(...ys) + margin },
      equal_scale: true,
    },
    points,
    polygons,
    segments,
    ...(bindings.length ? { bindings } : {}),
  };
  return {
    actions: [{ do: "write", as: base, kind: "geometry", role: input.role, content: geometry, place: input.place } as AuthoringAction],
    whole: base,
    parts: {
      whole: base, target_shape: `${base}#target-shape`, outer_square: `${base}#target-shape`,
      ...Object.fromEntries(pieces.map((piece, index) => [`piece_${index + 1}`, `${base}#${piece.role}`])),
      central_area: `${base}#${construction === "right_triangle_square" ? "central-area" : "target-shape"}`,
      ...(construction !== "square_area_identity" ? { leg_a: `${base}#leg-a`, leg_b: `${base}#leg-b`, hypotenuse: `${base}#hypotenuse` } : {}),
      ...(input.progress ? { primary_control: base } : {}),
    },
  };
}
