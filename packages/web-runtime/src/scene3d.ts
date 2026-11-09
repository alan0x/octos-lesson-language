import { bindUi, ui } from "./ui-localization.js";
import { solidFacets, solidTriangles } from "./solids.js";
import { compileMathExpression } from "../../core/src/index.js";
import { solidFaceTarget } from "../../core/src/solid-face-targets.js";
import type { StudentInputMethod } from "./student-operations.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface Scene3dViewState {
  yaw: number;
  pitch: number;
  zoom: number;
}

export type Scene3dViewControl = "orbit" | "zoom" | "preset" | "reset";
export type Scene3dViewPhase = "start" | "update" | "commit";

export interface Scene3dViewInputEvent {
  phase: Scene3dViewPhase;
  control: Scene3dViewControl;
  input: StudentInputMethod;
  operation_id?: string;
}

export type Scene3dViewInputHandler = (
  nodeId: string,
  view: Scene3dViewState,
  event: Scene3dViewInputEvent,
) => string | void;

export interface Point3d { x: number; y: number; z: number }
interface ProjectedPoint { x: number; y: number; depth: number }
type SectionAxis = "x" | "y" | "z";
type SectionDisplay = "plane" | "intersection" | "plane_and_intersection";

interface Triangle3d { points: [Point3d, Point3d, Point3d] }
interface SceneMesh {
  target: string;
  solid: boolean;
  triangles: Triangle3d[];
  surfaceFaces?: Point3d[][];
}

const MAX_IMPLICIT_SURFACE_TRIANGLES = 20_000;

export interface Scene3dSectionPath {
  target: string;
  solid: boolean;
  closed: boolean;
  points: Point3d[];
}

const WIDTH = 420;
const HEIGHT = 270;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2 + 8;

export function normalizeScene3dView(view: Scene3dViewState): Scene3dViewState {
  return {
    yaw: Number.isFinite(view.yaw) ? view.yaw : 0,
    pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
      Number.isFinite(view.pitch) ? view.pitch : .45)),
    zoom: Math.max(.2, Math.min(5, Number.isFinite(view.zoom) ? view.zoom : 1)),
  };
}

type Projector = (point: Point3d) => ProjectedPoint;
const viewProjectors = new WeakMap<Scene3dViewState, Projector>();

function createProjector(view: Scene3dViewState, scale: number): Projector {
  const normalized = normalizeScene3dView(view);
  const cosYaw = Math.cos(normalized.yaw);
  const sinYaw = Math.sin(normalized.yaw);
  const cosPitch = Math.cos(normalized.pitch);
  const sinPitch = Math.sin(normalized.pitch);
  return (point) => {
    const horizontal = cosYaw * point.x - sinYaw * point.y;
    const depthBeforePitch = sinYaw * point.x + cosYaw * point.y;
    const vertical = cosPitch * point.z - sinPitch * depthBeforePitch;
    const depth = sinPitch * point.z + cosPitch * depthBeforePitch;
    return {
      x: CENTER_X + horizontal * scale * normalized.zoom,
      y: CENTER_Y - vertical * scale * normalized.zoom,
      depth,
    };
  };
}

export function projectScene3dPoint(
  point: Point3d,
  view: Scene3dViewState,
  scale = 54,
): ProjectedPoint {
  // Public callers may mutate a view object; only render-owned projectors are cached.
  return ((scale === 54 ? viewProjectors.get(view) : undefined)
    ?? createProjector(view, scale))(point);
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

// Slots follow painter order, retaining the existing transparency semantics.
const layerCursors = new WeakMap<SVGElement, number>();
function beginLayer(layer: SVGElement, reuse: boolean): void {
  if (!reuse) layer.replaceChildren();
  layerCursors.set(layer, 0);
}
function layerElement<K extends keyof SVGElementTagNameMap>(
  layer: SVGElement, name: K, attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const index = layerCursors.get(layer) ?? 0;
  layerCursors.set(layer, index + 1);
  let element = layer.children[index] as SVGElementTagNameMap[K] | undefined;
  if (!element || element.localName !== name) {
    const replacement = svgElement(name);
    if (element) element.replaceWith(replacement);
    else layer.append(replacement);
    element = replacement;
  }
  for (const [key, value] of Object.entries(attributes)) {
    const text = String(value);
    if (element.getAttribute(key) !== text) element.setAttribute(key, text);
  }
  return element;
}
function endLayer(layer: SVGElement): void {
  const count = layerCursors.get(layer) ?? 0;
  while (layer.children.length > count) layer.lastElementChild!.remove();
}

function safeColor(value: unknown, fallback = "#277c75"): string {
  return typeof value === "string"
    && /^(#[0-9a-fA-F]{6}|teal|blue|purple|orange|red|gray)$/.test(value)
    ? value
    : fallback;
}

function line(
  svg: SVGElement,
  from: Point3d,
  to: Point3d,
  view: Scene3dViewState,
  className: string,
  color?: string,
): void {
  const a = projectScene3dPoint(from, view);
  const b = projectScene3dPoint(to, view);
  const element = layerElement(svg, "line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  element.setAttribute("class", className);
  if (color) element.setAttribute("stroke", color);

}

function averagePoint(points: Point3d[]): Point3d {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }), { x: 0, y: 0, z: 0 });
  return { x: total.x / points.length, y: total.y / points.length, z: total.z / points.length };
}

/** A cylinder, cone or sphere as facets (kept for callers of the first version; see solidFacets). */
export const roundSolidFacets = solidFacets;

/** A flat face's place: its centre and area, rounded, so the same face of two solids matches. */
function faceKey(points: Point3d[]): string {
  const centre = averagePoint(points);
  let normal = { x: 0, y: 0, z: 0 };
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    normal = { x: normal.x + point.y * next.z - point.z * next.y, y: normal.y + point.z * next.x - point.x * next.z, z: normal.z + point.x * next.y - point.y * next.x };
  });
  const area = Math.hypot(normal.x, normal.y, normal.z) / 2;
  return [centre.x, centre.y, centre.z, area].map((value) => (Math.abs(value) < 5e-4 ? 0 : value).toFixed(3)).join(",");
}

/** Faces two different solids share, facing opposite ways: a cone standing on a cylinder's top, a roof on a box. */
export function gluedFaces(objects: Array<Record<string, any>>): Set<string> {
  const seen = new Map<string, Array<{ object: number; normal: Point3d }>>();
  const glued = new Set<string>();
  objects.forEach((object, index) => {
    if (Number(object.unfold) > 0) return;
    for (const facet of solidFacets(object)) {
      if (facet.part !== "face") continue;
      const key = faceKey(facet.points);
      const others = seen.get(key) ?? [];
      if (others.some((other) => other.object !== index && other.normal.x * facet.normal.x + other.normal.y * facet.normal.y + other.normal.z * facet.normal.z < -.99)) glued.add(key);
      seen.set(key, [...others, { object: index, normal: facet.normal }]);
    }
  });
  return glued;
}

function polygon(
  svg: SVGElement,
  points: Point3d[],
  view: Scene3dViewState,
  color: string,
  opacity: number,
  className: string,
): SVGPolygonElement {
  const projected = points.map((point) => projectScene3dPoint(point, view));
  const element = layerElement(svg, "polygon", {
    points: projected.map((point) => `${point.x},${point.y}`).join(" "),
    fill: color,
    "fill-opacity": opacity,
    stroke: color,
  });
  element.setAttribute("class", className);

  return element;
}

function boxFaces(object: Record<string, any>): Point3d[][] {
  const center = object.center;
  const size = object.size;
  const xs = [center.x - size.x / 2, center.x + size.x / 2];
  const ys = [center.y - size.y / 2, center.y + size.y / 2];
  const zs = [center.z - size.z / 2, center.z + size.z / 2];
  const p = (x: number, y: number, z: number): Point3d => ({ x, y, z });
  return [
    [p(xs[0], ys[0], zs[0]), p(xs[1], ys[0], zs[0]), p(xs[1], ys[1], zs[0]), p(xs[0], ys[1], zs[0])],
    [p(xs[0], ys[0], zs[1]), p(xs[1], ys[0], zs[1]), p(xs[1], ys[1], zs[1]), p(xs[0], ys[1], zs[1])],
    [p(xs[0], ys[0], zs[0]), p(xs[1], ys[0], zs[0]), p(xs[1], ys[0], zs[1]), p(xs[0], ys[0], zs[1])],
    [p(xs[0], ys[1], zs[0]), p(xs[1], ys[1], zs[0]), p(xs[1], ys[1], zs[1]), p(xs[0], ys[1], zs[1])],
    [p(xs[0], ys[0], zs[0]), p(xs[0], ys[1], zs[0]), p(xs[0], ys[1], zs[1]), p(xs[0], ys[0], zs[1])],
    [p(xs[1], ys[0], zs[0]), p(xs[1], ys[1], zs[0]), p(xs[1], ys[1], zs[1]), p(xs[1], ys[0], zs[1])],
  ];
}

function trianglesForFace(points: Point3d[]): Triangle3d[] {
  if (points.length < 3) return [];
  const triangles: Triangle3d[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    triangles.push({ points: [points[0]!, points[index]!, points[index + 1]!] });
  }
  return triangles;
}

function objectTarget(object: Record<string, any>): string {
  return String(object.id ?? object.as ?? "");
}

function surfaceMesh(
  object: Record<string, any>,
  variables: Record<string, number>,
): SceneMesh {
  const samples = Math.max(4, Math.min(24, Number(object.samples) || 12));
  const evaluate = compileMathExpression(object.expression, ["x", "y", ...Object.keys(variables)]);
  const points: Point3d[][] = [];
  for (let xIndex = 0; xIndex <= samples; xIndex += 1) {
    const column: Point3d[] = [];
    const x = object.x_range.min
      + (object.x_range.max - object.x_range.min) * xIndex / samples;
    for (let yIndex = 0; yIndex <= samples; yIndex += 1) {
      const y = object.y_range.min
        + (object.y_range.max - object.y_range.min) * yIndex / samples;
      column.push({ x, y, z: evaluate({ ...variables, x, y }) });
    }
    points.push(column);
  }
  const triangles: Triangle3d[] = [];
  const surfaceFaces: Point3d[][] = [];
  for (let xIndex = 0; xIndex < samples; xIndex += 1) {
    for (let yIndex = 0; yIndex < samples; yIndex += 1) {
      const a = points[xIndex]![yIndex]!;
      const b = points[xIndex + 1]![yIndex]!;
      const c = points[xIndex + 1]![yIndex + 1]!;
      const d = points[xIndex]![yIndex + 1]!;
      triangles.push({ points: [a, b, c] }, { points: [a, c, d] });
      surfaceFaces.push([a, b, c, d]);
    }
  }
  return { target: objectTarget(object), solid: false, triangles, surfaceFaces };
}

function interpolateLevel(
  from: Point3d,
  to: Point3d,
  fromValue: number,
  toValue: number,
): Point3d {
  const denominator = fromValue - toValue;
  const amount = Math.abs(denominator) < 1e-12 ? .5 : fromValue / denominator;
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: from.z + (to.z - from.z) * amount,
  };
}

function tetrahedronTriangles(
  points: [Point3d, Point3d, Point3d, Point3d],
  values: [number, number, number, number],
): Triangle3d[] {
  if (values.some((value) => !Number.isFinite(value))) return [];
  const inside = [0, 1, 2, 3].filter((index) => values[index]! <= 0);
  const outside = [0, 1, 2, 3].filter((index) => values[index]! > 0);
  const crossing = (from: number, to: number) => interpolateLevel(
    points[from]!,
    points[to]!,
    values[from]!,
    values[to]!,
  );
  if (inside.length === 0 || inside.length === 4) return [];
  if (inside.length === 1) {
    const origin = inside[0]!;
    return [{ points: [
      crossing(origin, outside[0]!),
      crossing(origin, outside[1]!),
      crossing(origin, outside[2]!),
    ] }];
  }
  if (inside.length === 3) {
    const origin = outside[0]!;
    return [{ points: [
      crossing(origin, inside[2]!),
      crossing(origin, inside[1]!),
      crossing(origin, inside[0]!),
    ] }];
  }
  const [insideA, insideB] = inside as [number, number];
  const [outsideA, outsideB] = outside as [number, number];
  const a = crossing(insideA, outsideA);
  const b = crossing(insideA, outsideB);
  const c = crossing(insideB, outsideA);
  const d = crossing(insideB, outsideB);
  return [
    { points: [a, b, c] },
    { points: [b, d, c] },
  ];
}

function implicitSurfaceMesh(
  object: Record<string, any>,
  variables: Record<string, number>,
): SceneMesh {
  const samples = Math.max(4, Math.min(18, Number(object.samples) || 12));
  const level = Number(object.level ?? 0);
  const evaluate = compileMathExpression(
    object.expression,
    ["x", "y", "z", ...Object.keys(variables)],
  );
  const grid: Array<Array<Array<{ point: Point3d; value: number }>>> = [];
  for (let xIndex = 0; xIndex <= samples; xIndex += 1) {
    const xColumn: Array<Array<{ point: Point3d; value: number }>> = [];
    const x = object.x_range.min
      + (object.x_range.max - object.x_range.min) * xIndex / samples;
    for (let yIndex = 0; yIndex <= samples; yIndex += 1) {
      const yColumn: Array<{ point: Point3d; value: number }> = [];
      const y = object.y_range.min
        + (object.y_range.max - object.y_range.min) * yIndex / samples;
      for (let zIndex = 0; zIndex <= samples; zIndex += 1) {
        const z = object.z_range.min
          + (object.z_range.max - object.z_range.min) * zIndex / samples;
        const point = { x, y, z };
        yColumn.push({
          point,
          value: evaluate({ ...variables, x, y, z }) - level,
        });
      }
      xColumn.push(yColumn);
    }
    grid.push(xColumn);
  }
  const cubeTetrahedra = [
    [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
    [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
  ] as const;
  const triangles: Triangle3d[] = [];
  for (let x = 0; x < samples; x += 1) {
    for (let y = 0; y < samples; y += 1) {
      for (let z = 0; z < samples; z += 1) {
        const vertices = [
          grid[x]![y]![z]!, grid[x + 1]![y]![z]!,
          grid[x + 1]![y + 1]![z]!, grid[x]![y + 1]![z]!,
          grid[x]![y]![z + 1]!, grid[x + 1]![y]![z + 1]!,
          grid[x + 1]![y + 1]![z + 1]!, grid[x]![y + 1]![z + 1]!,
        ];
        for (const tetrahedron of cubeTetrahedra) {
          const tetrahedronSamples = tetrahedron.map((index) => vertices[index]!);
          triangles.push(...tetrahedronTriangles(
            tetrahedronSamples.map((sample) => sample.point) as [Point3d, Point3d, Point3d, Point3d],
            tetrahedronSamples.map((sample) => sample.value) as [number, number, number, number],
          ));
          if (triangles.length > MAX_IMPLICIT_SURFACE_TRIANGLES) {
            throw new Error("Implicit 3D surface is too complex for interactive rendering");
          }
        }
      }
    }
  }
  return { target: objectTarget(object), solid: true, triangles };
}

function radialPoint(
  center: Point3d,
  radius: number,
  z: number,
  angle: number,
): Point3d {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
    z,
  };
}

/** 3D solids added in player 0.9.0, drawn and sliced from their facets. */
const FACETED_KINDS = new Set(["prism", "pyramid", "frustum", "hemisphere", "torus", "tetrahedron", "octahedron", "dodecahedron", "icosahedron", "ellipsoid"]);

function primitiveMesh(object: Record<string, any>): SceneMesh {
  const target = objectTarget(object);
  // Solids added later are sliced from the same facets they are drawn with.
  if (FACETED_KINDS.has(String(object.kind)) || Number(object.unfold) > 0) return { target, solid: Number(object.unfold) > 0 ? false : true, triangles: solidTriangles(object) };
  if (object.kind === "box") {
    return {
      target,
      solid: true,
      triangles: boxFaces(object).flatMap(trianglesForFace),
    };
  }
  const center = object.center as Point3d;
  const segments = 24;
  const triangles: Triangle3d[] = [];
  if (object.kind === "sphere") {
    const latitudes = 12;
    const rows: Point3d[][] = [];
    for (let latitude = 0; latitude <= latitudes; latitude += 1) {
      const phi = -Math.PI / 2 + Math.PI * latitude / latitudes;
      const ringRadius = object.radius * Math.cos(phi);
      const z = center.z + object.radius * Math.sin(phi);
      const row: Point3d[] = [];
      for (let longitude = 0; longitude < segments; longitude += 1) {
        row.push(radialPoint(center, ringRadius, z, Math.PI * 2 * longitude / segments));
      }
      rows.push(row);
    }
    for (let latitude = 0; latitude < latitudes; latitude += 1) {
      for (let longitude = 0; longitude < segments; longitude += 1) {
        const next = (longitude + 1) % segments;
        const a = rows[latitude]![longitude]!;
        const b = rows[latitude + 1]![longitude]!;
        const c = rows[latitude + 1]![next]!;
        const d = rows[latitude]![next]!;
        if (latitude > 0) triangles.push({ points: [a, b, d] });
        if (latitude < latitudes - 1) triangles.push({ points: [d, b, c] });
      }
    }
    return { target, solid: true, triangles };
  }
  const topZ = center.z + object.height / 2;
  const bottomZ = center.z - object.height / 2;
  const bottomCenter = { ...center, z: bottomZ };
  const topCenter = { ...center, z: topZ };
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const angle = Math.PI * 2 * index / segments;
    const nextAngle = Math.PI * 2 * next / segments;
    const bottom = radialPoint(center, object.radius, bottomZ, angle);
    const bottomNext = radialPoint(center, object.radius, bottomZ, nextAngle);
    triangles.push({ points: [bottomCenter, bottomNext, bottom] });
    if (object.kind === "cone") {
      triangles.push({ points: [topCenter, bottom, bottomNext] });
    } else {
      const top = radialPoint(center, object.radius, topZ, angle);
      const topNext = radialPoint(center, object.radius, topZ, nextAngle);
      triangles.push(
        { points: [bottom, top, topNext] },
        { points: [bottom, topNext, bottomNext] },
        { points: [topCenter, top, topNext] },
      );
    }
  }
  return { target, solid: true, triangles };
}

const sceneMeshCache = new Map<string, SceneMesh[]>();
const SCENE_MESH_CACHE_LIMIT = 32;

function expressionVariables(
  objects: Record<string, any>[],
  variables: Record<string, number>,
): Record<string, number> {
  const expressions = objects
    .filter((object) =>
      ["surface", "implicit_surface"].includes(object.kind)
      && typeof object.expression === "string"
    )
    .map((object) => object.expression as string);
  return Object.fromEntries(Object.entries(variables)
    .filter(([name]) => expressions.some((expression) => new RegExp(
      `(^|[^a-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`,
      "i",
    ).test(expression)))
    .sort(([left], [right]) => left.localeCompare(right)));
}

function sceneMeshes(
  content: Record<string, any>,
  variables: Record<string, number>,
): SceneMesh[] {
  const objects = (content.objects ?? []) as Record<string, any>[];
  const cacheKey = JSON.stringify([objects, expressionVariables(objects, variables)]);
  const cached = sceneMeshCache.get(cacheKey);
  if (cached) {
    sceneMeshCache.delete(cacheKey);
    sceneMeshCache.set(cacheKey, cached);
    return cached;
  }
  const meshes = objects.map((object) => {
    if (object.kind === "surface") return surfaceMesh(object, variables);
    if (object.kind === "implicit_surface") {
      return implicitSurfaceMesh(object, variables);
    }
    return primitiveMesh(object);
  });
  sceneMeshCache.set(cacheKey, meshes);
  if (sceneMeshCache.size > SCENE_MESH_CACHE_LIMIT) {
    sceneMeshCache.delete(sceneMeshCache.keys().next().value as string);
  }
  return meshes;
}

function axisCoordinate(point: Point3d, axis: SectionAxis): number {
  return point[axis];
}

const INTERSECTION_EPSILON = 1e-7;
const POINT_KEY_SCALE = 1e6;

function pointKey(point: Point3d): string {
  return [point.x, point.y, point.z]
    .map((value) => Math.round(value * POINT_KEY_SCALE))
    .join(":");
}

function segmentKey(from: Point3d, to: Point3d): string {
  const a = pointKey(from);
  const b = pointKey(to);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function interpolate(from: Point3d, to: Point3d, amount: number): Point3d {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: from.z + (to.z - from.z) * amount,
  };
}

function squaredDistance(from: Point3d, to: Point3d): number {
  return (from.x - to.x) ** 2 + (from.y - to.y) ** 2 + (from.z - to.z) ** 2;
}

interface IntersectionSegment { from: Point3d; to: Point3d }

function meshPlaneSegments(
  mesh: SceneMesh,
  axis: SectionAxis,
  value: number,
): IntersectionSegment[] {
  const ordinary = new Map<string, IntersectionSegment>();
  const coplanar = new Map<string, { segment: IntersectionSegment; count: number }>();
  for (const triangle of mesh.triangles) {
    const distances = triangle.points.map((point) => axisCoordinate(point, axis) - value);
    if (distances.every((distance) => Math.abs(distance) <= INTERSECTION_EPSILON)) {
      for (const [from, to] of [
        [triangle.points[0], triangle.points[1]],
        [triangle.points[1], triangle.points[2]],
        [triangle.points[2], triangle.points[0]],
      ] as const) {
        const key = segmentKey(from, to);
        const prior = coplanar.get(key);
        coplanar.set(key, { segment: { from, to }, count: (prior?.count ?? 0) + 1 });
      }
      continue;
    }
    const points = new Map<string, Point3d>();
    for (const [fromIndex, toIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
      const from = triangle.points[fromIndex];
      const to = triangle.points[toIndex];
      const fromDistance = distances[fromIndex]!;
      const toDistance = distances[toIndex]!;
      if (Math.abs(fromDistance) <= INTERSECTION_EPSILON) points.set(pointKey(from), from);
      if (fromDistance * toDistance < 0) {
        const point = interpolate(from, to, fromDistance / (fromDistance - toDistance));
        points.set(pointKey(point), point);
      }
    }
    const candidates = [...points.values()];
    if (candidates.length < 2) continue;
    let pair: [Point3d, Point3d] = [candidates[0]!, candidates[1]!];
    for (let left = 0; left < candidates.length; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        if (squaredDistance(candidates[left]!, candidates[right]!)
          > squaredDistance(pair[0], pair[1])) {
          pair = [candidates[left]!, candidates[right]!];
        }
      }
    }
    if (squaredDistance(pair[0], pair[1]) <= INTERSECTION_EPSILON ** 2) continue;
    ordinary.set(segmentKey(pair[0], pair[1]), { from: pair[0], to: pair[1] });
  }
  for (const [key, entry] of coplanar) {
    if (entry.count % 2 === 1) ordinary.set(key, entry.segment);
  }
  return [...ordinary.values()];
}

function chainSegments(segments: IntersectionSegment[]): Array<{ points: Point3d[]; closed: boolean }> {
  const endpoints = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    for (const point of [segment.from, segment.to]) {
      const key = pointKey(point);
      endpoints.set(key, [...(endpoints.get(key) ?? []), index]);
    }
  });
  const unused = new Set(segments.map((_, index) => index));
  const paths: Array<{ points: Point3d[]; closed: boolean }> = [];
  while (unused.size > 0) {
    const fallbackIndex = unused.values().next().value as number;
    const fallback = segments[fallbackIndex]!;
    const start = [fallback.from, fallback.to].find((point) =>
      (endpoints.get(pointKey(point))?.filter((index) => unused.has(index)).length ?? 0) === 1)
      ?? fallback.from;
    const points = [start];
    let currentKey = pointKey(start);
    const startKey = currentKey;
    while (true) {
      const nextIndex = endpoints.get(currentKey)?.find((index) => unused.has(index));
      if (nextIndex === undefined) break;
      unused.delete(nextIndex);
      const segment = segments[nextIndex]!;
      const next = pointKey(segment.from) === currentKey ? segment.to : segment.from;
      points.push(next);
      currentKey = pointKey(next);
      if (currentKey === startKey) break;
    }
    const closed = points.length > 2 && currentKey === startKey;
    if (closed) points.pop();
    if (points.length >= 2) paths.push({ points, closed });
  }
  return paths;
}

export function scene3dSectionIntersections(
  content: Record<string, any>,
  section: Record<string, any>,
  variables: Record<string, number> = {},
): Scene3dSectionPath[] {
  const display = (section.display ?? "plane") as SectionDisplay;
  if (display === "plane") return [];
  const targets = new Set((section.targets ?? []).map(String));
  const axis = section.axis as SectionAxis;
  const value = Number(section.value);
  if (!targets.size || !["x", "y", "z"].includes(axis) || !Number.isFinite(value)) return [];
  return sceneMeshes(content, variables)
    .filter((mesh) => targets.has(mesh.target))
    .flatMap((mesh) => chainSegments(meshPlaneSegments(mesh, axis, value)).map((path) => ({
      target: mesh.target,
      solid: mesh.solid,
      closed: path.closed,
      points: path.points,
    })));
}

function sectionPlanePoints(
  section: Record<string, any>,
  meshes: SceneMesh[],
): Point3d[] {
  const targets = new Set((section.targets ?? []).map(String));
  const selected = targets.size ? meshes.filter((mesh) => targets.has(mesh.target)) : meshes;
  const points = selected.flatMap((mesh) => mesh.triangles.flatMap((triangle) => triangle.points));
  const range = (axis: SectionAxis): [number, number] => {
    if (!points.length) return [-2.5, 2.5];
    const values = points.map((point) => point[axis]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(.2, (max - min) * .12);
    return [min - padding, max + padding];
  };
  const [xs, ys, zs] = [range("x"), range("y"), range("z")];
  const value = Number(section.value);
  return section.axis === "x"
    ? [{ x: value, y: ys[0], z: zs[0] }, { x: value, y: ys[1], z: zs[0] }, { x: value, y: ys[1], z: zs[1] }, { x: value, y: ys[0], z: zs[1] }]
    : section.axis === "y"
      ? [{ x: xs[0], y: value, z: zs[0] }, { x: xs[1], y: value, z: zs[0] }, { x: xs[1], y: value, z: zs[1] }, { x: xs[0], y: value, z: zs[1] }]
      : [{ x: xs[0], y: ys[0], z: value }, { x: xs[1], y: ys[0], z: value }, { x: xs[1], y: ys[1], z: value }, { x: xs[0], y: ys[1], z: value }];
}

function renderSectionIntersection(
  svg: SVGElement,
  section: Record<string, any>,
  intersection: Scene3dSectionPath,
  view: Scene3dViewState,
): void {
  const projected = intersection.points.map((point) => projectScene3dPoint(point, view));
  if (projected.length < 2) return;
  const path = layerElement(svg, "path", {
    d: `${projected.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}${intersection.closed ? " Z" : ""}`,
    fill: intersection.solid && intersection.closed ? safeColor(section.color, "#d28a31") : "none",
    "fill-opacity": intersection.solid && intersection.closed ? .38 : 0,
    stroke: safeColor(section.color, "#d28a31"),
  });
  path.setAttribute("class", `scene3d-intersection scene3d-intersection-${intersection.solid ? "solid" : "surface"}`);
  path.dataset.sectionId = String(section.id ?? section.as ?? "");
  path.dataset.id = String(section.id ?? section.as ?? "");
  path.dataset.targetId = intersection.target;

}

function renderSurface(
  svg: SVGElement,
  object: Record<string, any>,
  mesh: SceneMesh,
  view: Scene3dViewState,
): void {
  const color = safeColor(object.color, "#3479a8");
  // Shared mesh vertices are evaluated once per mesh and projected once per view.
  const projected = new Map<Point3d, ProjectedPoint>();
  const project = (point: Point3d) => {
    let value = projected.get(point);
    if (!value) {
      value = projectScene3dPoint(point, view);
      projected.set(point, value);
    }
    return value;
  };
  const faces = (mesh.surfaceFaces ?? []).map(points => {
    const vertices = points.map(project);
    return { vertices, depth: vertices.reduce((sum, point) => sum + point.depth, 0) / 4 };
  }).sort((left, right) => left.depth - right.depth);
  for (const face of faces) {
    const element = layerElement(svg, "polygon", {
      points: face.vertices.map(point => `${point.x},${point.y}`).join(" "),
      fill: color, "fill-opacity": .22, stroke: color,
      class: "scene3d-surface-cell",
    });
    element.dataset.id = objectTarget(object);

  }
}

function renderImplicitSurface(
  svg: SVGElement,
  object: Record<string, any>,
  mesh: SceneMesh,
  view: Scene3dViewState,
): void {
  const color = safeColor(object.color, "#3479a8");
  const projected = new Map<Point3d, ProjectedPoint>();
  const project = (point: Point3d) => {
    let value = projected.get(point);
    if (!value) {
      value = projectScene3dPoint(point, view);
      projected.set(point, value);
    }
    return value;
  };
  const faces = mesh.triangles.map((triangle) => {
    const vertices = triangle.points.map(project);
    return { vertices, depth: vertices.reduce((sum, point) => sum + point.depth, 0) / 3 };
  }).sort((left, right) => left.depth - right.depth);
  for (const face of faces) {
    const element = layerElement(svg, "polygon", {
      points: face.vertices.map(point => `${point.x},${point.y}`).join(" "),
      fill: color, "fill-opacity": .24, stroke: color,
      class: "scene3d-implicit-surface-cell",
    });
    element.dataset.id = String(object.id ?? object.as ?? "");
  }
}

interface SceneRenderState {
  frame: SVGGElement;
  base: SVGGElement;
  sections: SVGGElement;
  highlights: SVGGElement;
  baseGeometryKey?: string;
  sectionGeometryKey?: string;
  highlightGeometryKey?: string;
  sectionGeometry?: Array<{ section: Record<string, any>; plane?: Point3d[]; paths: Scene3dSectionPath[] }>;
  baseKey?: string;
  sectionKey?: string;
  highlightKey?: string;
  fitKey?: string;
}
const sceneRenderStates = new WeakMap<SVGElement, SceneRenderState>();

export function scene3dVariableSignature(
  node: Record<string, any>, variables: Record<string, number>,
): string {
  return JSON.stringify(expressionVariables(node.content?.objects ?? [], variables));
}

interface PreparedScene {
  meshKey: string;
  baseKey: string;
  sectionKey: string;
  highlightKey: string;
  highlights: Array<Record<string, any>>;
  meshes: SceneMesh[];
}

function faceVerticesKey(points: Point3d[]): string {
  return points.map(({ x, y, z }) => [x, y, z].map((value) => value.toFixed(9)).join(",")).sort().join(";");
}

/** An opted-in box face named in its closed position follows the corresponding hinge. */
function boxFaceHighlights(content: Record<string, any>): Array<Record<string, any>> {
  const highlights: Array<Record<string, any>> = content.highlights ?? [];
  if (!highlights.some((highlight) => highlight.kind === "face" && highlight.shown === "when_emphasized")) return highlights;
  const faces = new Map<string, { points: Point3d[]; unfolded: boolean } | undefined>();
  for (const object of content.objects ?? []) {
    if (object.kind !== "box" || object.face_targets !== true) continue;
    const unfolded = Number(object.unfold) > 0;
    const closed = solidFacets({ ...object, unfold: 0 });
    const shown = unfolded ? solidFacets(object) : closed;
    closed.forEach((face, index) => {
      const key = faceVerticesKey(face.points);
      const points = shown[index]?.points;
      // Coincident faces have no unique hinge to follow.
      faces.set(key, points && !faces.has(key) ? { points, unfolded } : undefined);
    });
  }
  if (!faces.size) return highlights;
  return highlights.map((highlight) => {
    if (highlight.kind !== "face" || highlight.shown !== "when_emphasized") return highlight;
    const face = faces.get(faceVerticesKey(highlight.points));
    return face ? { ...highlight, ...face, tracksFace: true } : highlight;
  });
}

function prepareScene(content: Record<string, any>, variables: Record<string, number>, prior?: PreparedScene): PreparedScene {
  const objects = content.objects ?? [];
  const meshKey = JSON.stringify([objects, expressionVariables(objects, variables)]);
  const highlights = boxFaceHighlights(content);
  return {
    meshKey,
    baseKey: JSON.stringify([content.axes, meshKey]),
    sectionKey: JSON.stringify([content.sections, meshKey]),
    highlightKey: JSON.stringify(highlights),
    highlights,
    meshes: prior?.meshKey === meshKey ? prior.meshes : sceneMeshes(content, variables),
  };
}

/** Omit a net label when the face is too foreshortened to contain it. */
function netLabelFits(face: ProjectedPoint[], centre: ProjectedPoint, lines: string[], fit: number): boolean {
  const fontSize = 11 / fit;
  const width = Math.max(...lines.map((line) => Array.from(line).reduce(
    (sum, char) => sum + (/[^\u0000-\u00ff]/u.test(char) ? 1 : char === " " ? 0.35 : 0.65), 0,
  )));
  const halfWidth = (width / 2 + 0.1) * fontSize;
  const halfHeight = (lines.length * 0.55 + 0.05) * fontSize;
  return face.every((point, index) => {
    const next = face[(index + 1) % face.length]!;
    const dx = next.x - point.x, dy = next.y - point.y;
    const clearance = Math.abs(dx * (centre.y - point.y) - dy * (centre.x - point.x));
    return clearance > Math.abs(dx) * halfHeight + Math.abs(dy) * halfWidth;
  });
}

function renderScene(
  svg: SVGElement,
  content: Record<string, any>,
  view: Scene3dViewState,
  variables: Record<string, number>,
  prepared: PreparedScene,
): void {
  let state = sceneRenderStates.get(svg);
  if (!state || state.frame.parentNode !== svg) {
    state = {
      frame: svgElement("g"), base: svgElement("g"),
      sections: svgElement("g"), highlights: svgElement("g"),
    };
    state.frame.append(state.base, state.sections, state.highlights);
    svg.replaceChildren(state.frame);
    sceneRenderStates.set(svg, state);
  }
  const viewKey = JSON.stringify(view);
  const baseGeometryKey = prepared.baseKey;
  const baseKey = `${baseGeometryKey}\0${viewKey}`;
  viewProjectors.set(view, createProjector(view, 54));
  const meshes = prepared.meshes;
  if (state.baseKey !== baseKey) {
    beginLayer(state.base, state.baseGeometryKey === baseGeometryKey);
    const svg = state.base;
    if (content.axes !== false) {
      for (const [axis, end, color] of [
        ["x", { x: 2.7, y: 0, z: 0 }, "#c75b52"],
        ["y", { x: 0, y: 2.7, z: 0 }, "#377fa4"],
        ["z", { x: 0, y: 0, z: 2.7 }, "#377568"],
      ] as const) {
        line(svg, { x: 0, y: 0, z: 0 }, end, view, "scene3d-axis", color);
        const labelPoint = projectScene3dPoint(end, view);
        const label = layerElement(svg, "text", { x: labelPoint.x + 5, y: labelPoint.y - 4 });
        if (label.textContent !== axis) label.textContent = axis;
        label.setAttribute("class", "scene3d-axis-label");
      }
    }
    const faces: Array<{ points: Point3d[]; color: string; depth: number; objectId: string; faceId?: string; hidden?: boolean; opacity?: number; facet?: "side" | "face"; glued?: boolean }> = [];
    const glued = gluedFaces(content.objects ?? []);
    for (const object of content.objects ?? []) {
      const color = safeColor(object.color);
      if (object.kind === "surface") {
        const mesh = meshes.find(candidate => candidate.target === objectTarget(object));
        if (mesh) renderSurface(svg, object, mesh, view);
        continue;
      }
      if (object.kind === "implicit_surface") {
        const mesh = meshes.find((candidate) =>
          candidate.target === objectTarget(object));
        if (mesh) renderImplicitSurface(svg, object, mesh, view);
        continue;
      }
      const opening = Number(object.unfold) > 0;
      const objectId = objectTarget(object);
      const target = (face: string | undefined) => object.face_targets === true && face ? solidFaceTarget(objectId, face) : undefined;
      if (object.kind === "box" && !opening) {
        // A see-through box reads two ways (near faces seen as far). Faces turned
        // away are drawn as dashed hidden edges, as in a textbook, so the box
        // reads one way: the way it is drawn and pointed at.
        const centreDepth = projectScene3dPoint(object.center as Point3d, view).depth;
        const box = object.face_targets === true ? solidFacets(object) : boxFaces(object).map((points) => ({ points, surface: undefined }));
        for (const { points, surface } of box) {
          const depth = points.reduce((sum, point) =>
            sum + projectScene3dPoint(point, view).depth, 0) / points.length;
          faces.push({ points, color, depth, objectId, faceId: target(surface), hidden: depth <= centreDepth + 1e-6, glued: glued.has(faceKey(points)) });
        }
        continue;
      }
      // Round solids are built from small facets, like the box: only facets
      // turned towards the viewer are drawn, shaded by how squarely they face
      // it, so a cylinder, cone or sphere turns and tilts correctly.
      for (const facet of solidFacets(object)) {
        const centre = averagePoint(facet.points);
        const here = projectScene3dPoint(centre, view).depth;
        const toward = projectScene3dPoint({ x: centre.x + facet.normal.x * .01, y: centre.y + facet.normal.y * .01, z: centre.z + facet.normal.z * .01 }, view).depth - here;
        // An opening net shows both sides of its faces (an opened face shows its inside).
        if (toward <= 1e-9 && !opening) continue;
        const facing = Math.min(1, Math.abs(toward) / .01);
        faces.push({ points: facet.points, color, depth: here, objectId, faceId: target(facet.surface), opacity: .1 + .32 * facing, facet: facet.part, glued: facet.part === "face" && glued.has(faceKey(facet.points)) });
      }
    }
    faces.sort((left, right) => left.depth - right.depth);
    for (const face of faces) {
      const element = polygon(svg, face.points, view, face.color, face.opacity ?? .23,
        face.facet ? `scene3d-solid scene3d-facet scene3d-facet-${face.facet}` : face.hidden ? "scene3d-face scene3d-face-hidden" : "scene3d-face");
      // A round solid's side has no edges of its own: its facets meet without lines.
      // A thin stroke at half the fill's strength closes hairline gaps between facets without drawing a grid.
      if (face.facet === "side") {
        element.setAttribute("stroke-opacity", String((face.opacity ?? .23) * .5));
        element.setAttribute("stroke-width", ".6");
      } else {
        // A cap can take over a painter-order slot previously used by a side facet.
        element.removeAttribute("stroke-opacity");
        element.removeAttribute("stroke-width");
      }
      // Where two solids are stacked, the face they share is inside the composite: only its edge (the seam) is drawn.
      if (face.glued) { element.setAttribute("fill-opacity", "0"); element.classList.add("scene3d-face-glued"); }
      if (face.faceId && !face.hidden && !face.glued) {
        element.classList.add("scene3d-selectable-face");
        element.dataset.id = face.faceId;
        element.dataset.scene3dObjectId = face.objectId;
      } else {
        element.dataset.id = face.objectId;
        delete element.dataset.scene3dObjectId;
      }
    }
    endLayer(state.base);
    state.baseGeometryKey = baseGeometryKey;
    state.baseKey = baseKey;
  }
  const sectionGeometryKey = prepared.sectionKey;
  const sectionKey = `${sectionGeometryKey}\0${viewKey}`;
  if (state.sectionKey !== sectionKey) {
    const reuse = state.sectionGeometryKey === sectionGeometryKey;
    if (!reuse) {
      state.sectionGeometry = (content.sections ?? []).map((section: Record<string, any>) => ({
        section,
        plane: section.display === "intersection" ? undefined : sectionPlanePoints(section, meshes),
        paths: scene3dSectionIntersections(content, section, variables),
      }));
    }
    beginLayer(state.sections, reuse);
    const svg = state.sections;
    for (const { section, plane: points, paths } of state.sectionGeometry ?? []) {
      if (points) {
        const plane = polygon(svg, points, view, safeColor(section.color, "#d28a31"), .12, "scene3d-section");
        plane.dataset.sectionId = String(section.id ?? section.as ?? "");
        plane.dataset.id = String(section.id ?? section.as ?? "");
      }
      for (const intersection of paths) renderSectionIntersection(svg, section, intersection, view);
    }
    endLayer(state.sections);
    state.sectionGeometryKey = sectionGeometryKey;
    state.sectionKey = sectionKey;
  }
  // Section-only updates retain the mesh projection and fit transform.
  if (state.fitKey !== baseKey) {
    const baseView = { ...view, zoom: 1 };
    viewProjectors.set(baseView, createProjector(baseView, 54));
    const included = new Set<Point3d>();
    let minX = CENTER_X, maxX = CENTER_X, minY = CENTER_Y, maxY = CENTER_Y;
    const include = (point: Point3d) => {
      if (included.has(point)) return;
      included.add(point);
      const projected = projectScene3dPoint(point, baseView);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return;
      minX = Math.min(minX, projected.x); maxX = Math.max(maxX, projected.x);
      minY = Math.min(minY, projected.y); maxY = Math.max(maxY, projected.y);
    };
    for (const mesh of meshes) for (const triangle of mesh.triangles) for (const point of triangle.points) include(point);
    if (content.axes !== false) {
      include({ x: 2.7, y: 0, z: 0 }); include({ x: 0, y: 2.7, z: 0 }); include({ x: 0, y: 0, z: 2.7 });
    }
    const margin = 20;
    if (minX < margin || maxX > WIDTH - margin || minY < margin || maxY > HEIGHT - margin) {
      const fit = Math.min(1, (WIDTH - margin * 2) / Math.max(1, maxX - minX),
        (HEIGHT - margin * 2) / Math.max(1, maxY - minY));
      const centerX = CENTER_X + ((minX + maxX) / 2 - CENTER_X) * view.zoom;
      const centerY = CENTER_Y + ((minY + maxY) / 2 - CENTER_Y) * view.zoom;
      state.frame.style.setProperty("--scene3d-fit", String(fit));
      state.frame.setAttribute("class", "scene3d-fitted-frame");
      state.frame.setAttribute("transform",
        `translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${fit}) translate(${-centerX} ${-centerY})`);
    } else {
      state.frame.style.removeProperty("--scene3d-fit");
      state.frame.removeAttribute("class");
      state.frame.removeAttribute("transform");
    }
    state.fitKey = baseKey;
  }
  const highlightGeometryKey = prepared.highlightKey;
  const fit = Number(state.frame.style.getPropertyValue("--scene3d-fit")) || 1;
  const highlightKey = `${highlightGeometryKey}\0${viewKey}\0${fit}`;
  if (state.highlightKey !== highlightKey) {
    beginLayer(state.highlights, state.highlightGeometryKey === highlightGeometryKey);
    const svg = state.highlights;
    // A face shown only when emphasized can be pointed at only while it faces
    // the viewer: its centre is nearer than the centre of the scene's solids.
    const solidPoints = meshes.flatMap((mesh) => mesh.triangles.flatMap((triangle) => triangle.points));
    const centreDepth = solidPoints.length
      ? solidPoints.reduce((sum, point) => sum + projectScene3dPoint(point, view).depth, 0) / solidPoints.length : 0;
    const depthOf = (highlight: Record<string, any>) => projectScene3dPoint(averagePoint(highlight.points), view).depth;
    const highlights = prepared.highlights;
    const unfolded = highlights.filter((highlight) => highlight.unfolded).sort((a, b) => depthOf(a) - depthOf(b));
    for (const highlight of [...unfolded, ...highlights.filter((highlight) => !highlight.unfolded)]) {
      const points = highlight.points as Point3d[];
      const color = safeColor(highlight.color, "#d04f45");
      const id = String(highlight.id ?? highlight.as ?? "");
      let labelPoint: ProjectedPoint | undefined;
      let netFace: ProjectedPoint[] | undefined;
      if (highlight.kind === "point") {
        labelPoint = projectScene3dPoint(points[0]!, view);
        const point = layerElement(svg, "circle", {
          cx: labelPoint.x,
          cy: labelPoint.y,
          r: 7,
          fill: color,
          stroke: "#fff",
          "stroke-width": 2,
        });
        point.setAttribute("class", "scene3d-highlight scene3d-highlight-point");
        point.dataset.id = id;

      } else if (highlight.kind === "edge") {
        const from = projectScene3dPoint(points[0]!, view);
        const to = projectScene3dPoint(points[1]!, view);
        labelPoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, depth: 0 };
        const edge = layerElement(svg, "line", {
          x1: from.x, y1: from.y, x2: to.x, y2: to.y,
          stroke: color, "stroke-width": 5, "stroke-linecap": "round",
        });
        edge.setAttribute("class", "scene3d-highlight scene3d-highlight-edge");
        edge.dataset.id = id;

      } else {
        const latent = highlight.shown === "when_emphasized";
        const face = polygon(svg, points, view, color, .42, `scene3d-highlight scene3d-highlight-face${latent ? " scene3d-highlight-latent" : ""}`);
        if (highlight.tracksFace) face.classList.add("scene3d-tracked-highlight");
        face.dataset.id = id;
        const projected = points.map((point) => projectScene3dPoint(point, view));
        if (highlight.unfolded) netFace = projected;
        if (latent) {
          const depth = projected.reduce((sum, point) => sum + point.depth, 0) / projected.length;
          const [a, b, c] = projected as [ProjectedPoint, ProjectedPoint, ProjectedPoint, ...ProjectedPoint[]];
          const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
          const visible = highlight.unfolded ? area > 0.1 : depth > centreDepth + 1e-6;
          face.dataset.facing = visible ? "front" : "back";
        } else delete face.dataset.facing;
        labelPoint = {
          x: projected.reduce((sum, point) => sum + point.x, 0) / projected.length,
          y: projected.reduce((sum, point) => sum + point.y, 0) / projected.length,
          depth: 0,
        };
      }
      if (highlight.label && labelPoint) {
        const label = layerElement(svg, "text", { x: labelPoint.x, y: labelPoint.y });
        const words = String(highlight.label);
        if (netFace) {
          const lines = words.split("\n");
          label.setAttribute("visibility", netLabelFits(netFace, labelPoint, lines, fit) ? "visible" : "hidden");
          if (label.childElementCount !== lines.length) label.replaceChildren(...lines.map(() => svgElement("tspan")));
          lines.forEach((line, index) => {
            const span = label.children[index]!;
            span.setAttribute("x", String(labelPoint.x));
            span.setAttribute("dy", index ? "1.1em" : lines.length > 1 ? "-0.55em" : "0");
            if (span.textContent !== line) span.textContent = line;
          });
          label.setAttribute("class", "scene3d-highlight-label scene3d-net-label");
        } else {
          label.removeAttribute("visibility");
          label.setAttribute("x", String(labelPoint.x + 8));
          label.setAttribute("y", String(labelPoint.y - 8));
          if (label.textContent !== words || label.childElementCount) label.textContent = words;
          label.setAttribute("class", "scene3d-highlight-label");
        }
      }
    }
    endLayer(state.highlights);
    state.highlightGeometryKey = highlightGeometryKey;
    state.highlightKey = highlightKey;
  }
}

function inputMethod(pointerType: string | undefined): StudentInputMethod {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return pointerType === "mouse" || !pointerType ? "mouse" : "unknown";
}

interface SceneController {
  shell: HTMLElement;
  titleKey: string;
  dispose: () => void;
  update: (node: Record<string, any>, storedView: Scene3dViewState | undefined,
    variables: Record<string, number>, onInput?: Scene3dViewInputHandler) => void;
}
const sceneControllers = new WeakMap<HTMLElement, SceneController>();
function sceneTitleKey(node: Record<string, any>): string {
  return JSON.stringify([node.role, node.content?.title, node.content?.label]);
}

export function disposeScene3d(parent: HTMLElement): void {
  sceneControllers.get(parent)?.dispose();
  sceneControllers.delete(parent);
}

export function updateScene3d(
  parent: HTMLElement, node: Record<string, any>, storedView: Scene3dViewState | undefined,
  variables: Record<string, number>, onInput?: Scene3dViewInputHandler,
): boolean {
  const controller = sceneControllers.get(parent);
  if (!controller || controller.shell.parentNode !== parent
    || controller.titleKey !== sceneTitleKey(node)) return false;
  controller.update(node, storedView, variables, onInput);
  return true;
}

export function renderScene3d(
  parent: HTMLElement,
  node: Record<string, any>,
  storedView: Scene3dViewState | undefined,
  variables: Record<string, number>,
  onInput?: Scene3dViewInputHandler,
): void {
  disposeScene3d(parent);
  let content = node.content ?? {};
  let view = normalizeScene3dView(storedView ?? content.camera ?? { yaw: .65, pitch: .5, zoom: 1 });
  let initial = normalizeScene3dView(content.camera ?? view);
  let prepared = prepareScene(content, variables);
  const shell = document.createElement("div");
  shell.className = "scene3d-runtime";
  shell.dataset.ollScene3d = node.id;
  const svg = svgElement("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}` });
  svg.setAttribute("role", "img");
  bindUi(parent,svg,"aria",()=>{svg.setAttribute("aria-label",textLabel(content.title,ui(parent,"可旋转三维场景")));});
  const controls = document.createElement("div");
  controls.className = "scene3d-controls";
  const applyView = (
    next: Scene3dViewState,
    control: Scene3dViewControl,
    input: StudentInputMethod,
  ) => {
    finishOrbit();
    finishWheel();
    const operationId = onInput?.(node.id, view, { phase: "start", control, input });
    view = normalizeScene3dView(next);
    renderScene(svg, content, view, variables, prepared);
    onInput?.(node.id, view, {
      phase: "commit", control, input,
      ...(typeof operationId === "string" ? { operation_id: operationId } : {}),
    });
  };
  for (const preset of [
    { label: "等轴", view: { yaw: .72, pitch: .55, zoom: 1 } },
    { label: "正视", view: { yaw: 0, pitch: 0, zoom: 1 } },
    { label: "俯视", view: { yaw: 0, pitch: Math.PI / 2, zoom: 1 } },
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    bindUi(parent,button,"text",()=>{button.textContent=ui(parent,preset.label);});
    button.addEventListener("click", (event) => applyView(
      preset.view,
      "preset",
      event.detail === 0 ? "keyboard" : "mouse",
    ));
    controls.append(button);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  bindUi(parent,reset,"text",()=>{reset.textContent=ui(parent,"复位");});
  reset.addEventListener("click", (event) => applyView(
    initial,
    "reset",
    event.detail === 0 ? "keyboard" : "mouse",
  ));
  controls.append(reset);
  const hostWindow = parent.ownerDocument.defaultView!;
  let orbitFrame: number | undefined;
  const cancelOrbitFrame = () => {
    if (orbitFrame !== undefined) hostWindow.cancelAnimationFrame(orbitFrame);
    orbitFrame = undefined;
  };
  let drag: { pointerId: number; x: number; y: number; start: Scene3dViewState; input: StudentInputMethod; operationId?: string } | undefined;
  svg.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Extra fingers belong to the orbit; they must not reach board navigation.
    if (drag) return;
    finishWheel();
    svg.setPointerCapture(event.pointerId);
    const input = inputMethod(event.pointerType);
    const operationId = onInput?.(node.id, view, { phase: "start", control: "orbit", input });
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: { ...view }, input,
      ...(typeof operationId === "string" ? { operationId } : {}) };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    view = normalizeScene3dView({
      ...drag.start,
      yaw: drag.start.yaw + (event.clientX - drag.x) * .012,
      pitch: drag.start.pitch - (event.clientY - drag.y) * .01,
    });
    if (orbitFrame === undefined) orbitFrame = hostWindow.requestAnimationFrame(() => {
      orbitFrame = undefined;
      if (!drag) return;
      renderScene(svg, content, view, variables, prepared);
      onInput?.(node.id, view, { phase: "update", control: "orbit", input: drag.input,
        ...(drag.operationId ? { operation_id: drag.operationId } : {}) });
    });
  });
  const finishOrbit = () => {
    if (!drag) return;
    cancelOrbitFrame();
    renderScene(svg, content, view, variables, prepared);
    const finished = drag;
    drag = undefined;
    onInput?.(node.id, view, { phase: "commit", control: "orbit", input: finished.input,
      ...(finished.operationId ? { operation_id: finished.operationId } : {}) });
  };
  const finishDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    finishOrbit();
  };
  svg.addEventListener("pointerup", finishDrag);
  svg.addEventListener("pointercancel", finishDrag);
  svg.addEventListener("lostpointercapture", finishDrag);
  let wheelFrame: number | undefined;
  const cancelWheelFrame = () => {
    if (wheelFrame !== undefined) hostWindow.cancelAnimationFrame(wheelFrame);
    wheelFrame = undefined;
  };
  let wheelGesture: {
    operationId?: string;
    timer?: ReturnType<typeof setTimeout>;
  } | undefined;
  const finishWheel = () => {
    if (!wheelGesture) return;
    if (wheelGesture.timer) clearTimeout(wheelGesture.timer);
    cancelWheelFrame();
    renderScene(svg, content, view, variables, prepared);
    const finished = wheelGesture;
    wheelGesture = undefined;
    onInput?.(node.id, view, {
      phase: "commit", control: "zoom", input: "mouse",
      ...(finished.operationId ? { operation_id: finished.operationId } : {}),
    });
  };
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (drag) return;
    if (!wheelGesture) {
      const operationId = onInput?.(node.id, view, {
        phase: "start",
        control: "zoom",
        input: "mouse",
      });
      wheelGesture = typeof operationId === "string" ? { operationId } : {};
    }
    view = normalizeScene3dView({
      ...view,
      zoom: view.zoom * Math.exp(-event.deltaY * .0015),
    });
    if (wheelFrame === undefined) wheelFrame = hostWindow.requestAnimationFrame(() => {
      wheelFrame = undefined;
      if (!wheelGesture) return;
      renderScene(svg, content, view, variables, prepared);
      onInput?.(node.id, view, {
        phase: "update", control: "zoom", input: "mouse",
        ...(wheelGesture.operationId ? { operation_id: wheelGesture.operationId } : {}),
      });
    });
    if (wheelGesture.timer) clearTimeout(wheelGesture.timer);
    wheelGesture.timer = setTimeout(finishWheel, 140);
  }, { passive: false });
  renderScene(svg, content, view, variables, prepared);
  const fallback = document.createElement("p");
  fallback.className = "scene3d-fallback";
  bindUi(parent,fallback,"text",()=>{fallback.textContent=ui(parent,"静态说明：{description}",{description:textLabel(content.fallback,ui(parent,"请结合旁白和标注理解这个三维场景。"))});});
  shell.append(controls, svg, fallback);
  parent.append(shell);
  sceneControllers.set(parent, {
    shell, titleKey: sceneTitleKey(node),
    dispose() {
      cancelOrbitFrame();
      cancelWheelFrame();
      drag = undefined;
      if (wheelGesture?.timer) clearTimeout(wheelGesture.timer);
      wheelGesture = undefined;
      onInput = undefined;
    },
    update(nextNode, storedView, nextVariables, nextInput) {
      content = nextNode.content ?? {};
      variables = nextVariables;
      prepared = prepareScene(content, variables, prepared);
      onInput = nextInput;
      // A delayed runtime echo must not rewind the most recent local pointer position.
      if (!drag && !wheelGesture) view = normalizeScene3dView(storedView ?? content.camera ?? view);
      initial = normalizeScene3dView(content.camera ?? view);
      const label = textLabel(content.title, ui(parent,"可旋转三维场景"));
      if (svg.getAttribute("aria-label") !== label) svg.setAttribute("aria-label", label);
      const explanation = ui(parent,"静态说明：{description}",{description:textLabel(content.fallback,ui(parent,"请结合旁白和标注理解这个三维场景。"))});
      if (fallback.textContent !== explanation) fallback.textContent = explanation;
      renderScene(svg, content, view, variables, prepared);
    },
  });
}

function textLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
