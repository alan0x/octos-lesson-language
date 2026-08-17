import { compileMathExpression } from "../../core/src/index.js";
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

export function projectScene3dPoint(
  point: Point3d,
  view: Scene3dViewState,
  scale = 54,
): ProjectedPoint {
  const normalized = normalizeScene3dView(view);
  const cosYaw = Math.cos(normalized.yaw);
  const sinYaw = Math.sin(normalized.yaw);
  const cosPitch = Math.cos(normalized.pitch);
  const sinPitch = Math.sin(normalized.pitch);
  const horizontal = cosYaw * point.x - sinYaw * point.y;
  const depthBeforePitch = sinYaw * point.x + cosYaw * point.y;
  const vertical = cosPitch * point.z - sinPitch * depthBeforePitch;
  const depth = sinPitch * point.z + cosPitch * depthBeforePitch;
  return {
    x: CENTER_X + horizontal * scale * normalized.zoom,
    y: CENTER_Y - vertical * scale * normalized.zoom,
    depth,
  };
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

function safeColor(value: unknown, fallback = "#277c75"): string {
  return typeof value === "string"
    && /^(#[0-9a-fA-F]{6}|teal|blue|purple|orange|red|gray)$/.test(value)
    ? value
    : fallback;
}

function line(
  svg: SVGSVGElement,
  from: Point3d,
  to: Point3d,
  view: Scene3dViewState,
  className: string,
  color?: string,
): void {
  const a = projectScene3dPoint(from, view);
  const b = projectScene3dPoint(to, view);
  const element = svgElement("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  element.setAttribute("class", className);
  if (color) element.setAttribute("stroke", color);
  svg.append(element);
}

function polygon(
  svg: SVGSVGElement,
  points: Point3d[],
  view: Scene3dViewState,
  color: string,
  opacity: number,
  className: string,
): SVGPolygonElement {
  const projected = points.map((point) => projectScene3dPoint(point, view));
  const element = svgElement("polygon", {
    points: projected.map((point) => `${point.x},${point.y}`).join(" "),
    fill: color,
    "fill-opacity": opacity,
    stroke: color,
  });
  element.setAttribute("class", className);
  svg.append(element);
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
  for (let xIndex = 0; xIndex < samples; xIndex += 1) {
    for (let yIndex = 0; yIndex < samples; yIndex += 1) {
      const a = points[xIndex]![yIndex]!;
      const b = points[xIndex + 1]![yIndex]!;
      const c = points[xIndex + 1]![yIndex + 1]!;
      const d = points[xIndex]![yIndex + 1]!;
      triangles.push({ points: [a, b, c] }, { points: [a, c, d] });
    }
  }
  return { target: objectTarget(object), solid: false, triangles };
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

function primitiveMesh(object: Record<string, any>): SceneMesh {
  const target = objectTarget(object);
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
  svg: SVGSVGElement,
  section: Record<string, any>,
  intersection: Scene3dSectionPath,
  view: Scene3dViewState,
): void {
  const projected = intersection.points.map((point) => projectScene3dPoint(point, view));
  if (projected.length < 2) return;
  const path = svgElement("path", {
    d: `${projected.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}${intersection.closed ? " Z" : ""}`,
    fill: intersection.solid && intersection.closed ? safeColor(section.color, "#d28a31") : "none",
    "fill-opacity": intersection.solid && intersection.closed ? .38 : 0,
    stroke: safeColor(section.color, "#d28a31"),
  });
  path.setAttribute("class", `scene3d-intersection scene3d-intersection-${intersection.solid ? "solid" : "surface"}`);
  path.dataset.sectionId = String(section.id ?? section.as ?? "");
  path.dataset.id = String(section.id ?? section.as ?? "");
  path.dataset.targetId = intersection.target;
  svg.append(path);
}

function renderSurface(
  svg: SVGSVGElement,
  object: Record<string, any>,
  view: Scene3dViewState,
  variables: Record<string, number>,
): void {
  const samples = Math.max(4, Math.min(24, Number(object.samples) || 12));
  const evaluate = compileMathExpression(object.expression, ["x", "y", ...Object.keys(variables)]);
  const color = safeColor(object.color, "#3479a8");
  const point = (xIndex: number, yIndex: number): Point3d => {
    const x = object.x_range.min
      + (object.x_range.max - object.x_range.min) * xIndex / samples;
    const y = object.y_range.min
      + (object.y_range.max - object.y_range.min) * yIndex / samples;
    return { x, y, z: evaluate({ ...variables, x, y }) };
  };
  const faces: Array<{ points: Point3d[]; depth: number }> = [];
  for (let x = 0; x < samples; x += 1) {
    for (let y = 0; y < samples; y += 1) {
      const points = [point(x, y), point(x + 1, y), point(x + 1, y + 1), point(x, y + 1)];
      const depth = points.reduce((sum, candidate) =>
        sum + projectScene3dPoint(candidate, view).depth, 0) / 4;
      faces.push({ points, depth });
    }
  }
  faces.sort((left, right) => left.depth - right.depth);
  for (const face of faces) {
    const element = polygon(svg, face.points, view, color, .22, "scene3d-surface-cell");
    element.dataset.id = String(object.id ?? object.as ?? "");
  }
}

function renderImplicitSurface(
  svg: SVGSVGElement,
  object: Record<string, any>,
  mesh: SceneMesh,
  view: Scene3dViewState,
): void {
  const color = safeColor(object.color, "#3479a8");
  const faces = mesh.triangles.map((triangle) => ({
    points: triangle.points,
    depth: triangle.points.reduce((sum, point) =>
      sum + projectScene3dPoint(point, view).depth, 0) / 3,
  })).sort((left, right) => left.depth - right.depth);
  for (const face of faces) {
    const element = polygon(
      svg,
      face.points,
      view,
      color,
      .24,
      "scene3d-implicit-surface-cell",
    );
    element.dataset.id = String(object.id ?? object.as ?? "");
  }
}

function renderScene(
  svg: SVGSVGElement,
  content: Record<string, any>,
  view: Scene3dViewState,
  variables: Record<string, number>,
): void {
  svg.replaceChildren();
  const meshes = sceneMeshes(content, variables);
  if (content.axes !== false) {
    for (const [axis, end, color] of [
      ["x", { x: 2.7, y: 0, z: 0 }, "#c75b52"],
      ["y", { x: 0, y: 2.7, z: 0 }, "#377fa4"],
      ["z", { x: 0, y: 0, z: 2.7 }, "#377568"],
    ] as const) {
      line(svg, { x: 0, y: 0, z: 0 }, end, view, "scene3d-axis", color);
      const labelPoint = projectScene3dPoint(end, view);
      const label = svgElement("text", { x: labelPoint.x + 5, y: labelPoint.y - 4 });
      label.textContent = axis;
      label.setAttribute("class", "scene3d-axis-label");
      svg.append(label);
    }
  }
  const faces: Array<{ points: Point3d[]; color: string; depth: number; objectId: string }> = [];
  for (const object of content.objects ?? []) {
    const color = safeColor(object.color);
    if (object.kind === "surface") {
      renderSurface(svg, object, view, variables);
      continue;
    }
    if (object.kind === "implicit_surface") {
      const mesh = meshes.find((candidate) =>
        candidate.target === objectTarget(object));
      if (mesh) renderImplicitSurface(svg, object, mesh, view);
      continue;
    }
    if (object.kind === "box") {
      for (const points of boxFaces(object)) {
        const depth = points.reduce((sum, point) =>
          sum + projectScene3dPoint(point, view).depth, 0) / points.length;
        faces.push({ points, color, depth, objectId: String(object.id ?? object.as ?? "") });
      }
      continue;
    }
    const center = object.center as Point3d;
    const projected = projectScene3dPoint(center, view);
    if (object.kind === "sphere") {
      const radius = object.radius * 54 * view.zoom;
      const sphere = svgElement("ellipse", {
        cx: projected.x, cy: projected.y, rx: radius, ry: radius * .74,
        fill: color, "fill-opacity": .28, stroke: color,
      });
      sphere.setAttribute("class", "scene3d-solid");
      sphere.dataset.id = String(object.id ?? object.as ?? "");
      svg.append(sphere);
    } else {
      const top = projectScene3dPoint({ ...center, z: center.z + object.height / 2 }, view);
      const bottom = projectScene3dPoint({ ...center, z: center.z - object.height / 2 }, view);
      const radius = object.radius * 54 * view.zoom;
      if (object.kind === "cone") {
        const cone = svgElement("path", {
          d: `M ${top.x} ${top.y} L ${bottom.x - radius} ${bottom.y} A ${radius} ${radius * .3} 0 0 0 ${bottom.x + radius} ${bottom.y} Z`,
          fill: color, "fill-opacity": .28, stroke: color,
        });
        cone.setAttribute("class", "scene3d-solid");
        cone.dataset.id = String(object.id ?? object.as ?? "");
        svg.append(cone);
      } else {
        const cylinder = svgElement("path", {
          d: `M ${top.x - radius} ${top.y} L ${bottom.x - radius} ${bottom.y} A ${radius} ${radius * .3} 0 0 0 ${bottom.x + radius} ${bottom.y} L ${top.x + radius} ${top.y} A ${radius} ${radius * .3} 0 0 0 ${top.x - radius} ${top.y} Z`,
          fill: color, "fill-opacity": .25, stroke: color,
        });
        cylinder.setAttribute("class", "scene3d-solid");
        cylinder.dataset.id = String(object.id ?? object.as ?? "");
        svg.append(cylinder);
      }
    }
  }
  faces.sort((left, right) => left.depth - right.depth);
  for (const face of faces) {
    const element = polygon(svg, face.points, view, face.color, .23, "scene3d-face");
    element.dataset.id = face.objectId;
  }
  for (const section of content.sections ?? []) {
    const display = (section.display ?? "plane") as SectionDisplay;
    if (display !== "intersection") {
      const plane = polygon(
        svg,
        sectionPlanePoints(section, meshes),
        view,
        safeColor(section.color, "#d28a31"),
        .12,
        "scene3d-section",
      );
      plane.dataset.sectionId = String(section.id ?? section.as ?? "");
      plane.dataset.id = String(section.id ?? section.as ?? "");
    }
    for (const intersection of scene3dSectionIntersections(content, section, variables)) {
      renderSectionIntersection(svg, section, intersection, view);
    }
  }
  for (const highlight of content.highlights ?? []) {
    const points = highlight.points as Point3d[];
    const color = safeColor(highlight.color, "#d04f45");
    const id = String(highlight.id ?? highlight.as ?? "");
    let labelPoint: ProjectedPoint | undefined;
    if (highlight.kind === "point") {
      labelPoint = projectScene3dPoint(points[0]!, view);
      const point = svgElement("circle", {
        cx: labelPoint.x,
        cy: labelPoint.y,
        r: 7,
        fill: color,
        stroke: "#fff",
        "stroke-width": 2,
      });
      point.setAttribute("class", "scene3d-highlight scene3d-highlight-point");
      point.dataset.id = id;
      svg.append(point);
    } else if (highlight.kind === "edge") {
      const from = projectScene3dPoint(points[0]!, view);
      const to = projectScene3dPoint(points[1]!, view);
      labelPoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, depth: 0 };
      const edge = svgElement("line", {
        x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        stroke: color, "stroke-width": 5, "stroke-linecap": "round",
      });
      edge.setAttribute("class", "scene3d-highlight scene3d-highlight-edge");
      edge.dataset.id = id;
      svg.append(edge);
    } else {
      const face = polygon(svg, points, view, color, .42, "scene3d-highlight scene3d-highlight-face");
      face.dataset.id = id;
      const projected = points.map((point) => projectScene3dPoint(point, view));
      labelPoint = {
        x: projected.reduce((sum, point) => sum + point.x, 0) / projected.length,
        y: projected.reduce((sum, point) => sum + point.y, 0) / projected.length,
        depth: 0,
      };
    }
    if (highlight.label && labelPoint) {
      const label = svgElement("text", { x: labelPoint.x + 8, y: labelPoint.y - 8 });
      label.textContent = String(highlight.label);
      label.setAttribute("class", "scene3d-highlight-label");
      svg.append(label);
    }
  }
}

function inputMethod(pointerType: string | undefined): StudentInputMethod {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return pointerType === "mouse" || !pointerType ? "mouse" : "unknown";
}

export function renderScene3d(
  parent: HTMLElement,
  node: Record<string, any>,
  storedView: Scene3dViewState | undefined,
  variables: Record<string, number>,
  onInput?: Scene3dViewInputHandler,
): void {
  const content = node.content ?? {};
  let view = normalizeScene3dView(storedView ?? content.camera ?? { yaw: .65, pitch: .5, zoom: 1 });
  const initial = normalizeScene3dView(content.camera ?? view);
  const shell = document.createElement("div");
  shell.className = "scene3d-runtime";
  shell.dataset.ollScene3d = node.id;
  const svg = svgElement("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}` });
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", textLabel(content.title, "可旋转三维场景"));
  const controls = document.createElement("div");
  controls.className = "scene3d-controls";
  const applyView = (
    next: Scene3dViewState,
    control: Scene3dViewControl,
    input: StudentInputMethod,
  ) => {
    const operationId = onInput?.(node.id, view, { phase: "start", control, input });
    view = normalizeScene3dView(next);
    renderScene(svg, content, view, variables);
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
    button.textContent = preset.label;
    button.addEventListener("click", (event) => applyView(
      preset.view,
      "preset",
      event.detail === 0 ? "keyboard" : "mouse",
    ));
    controls.append(button);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "复位";
  reset.addEventListener("click", (event) => applyView(
    initial,
    "reset",
    event.detail === 0 ? "keyboard" : "mouse",
  ));
  controls.append(reset);
  let drag: { x: number; y: number; start: Scene3dViewState; input: StudentInputMethod; operationId?: string } | undefined;
  svg.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    const input = inputMethod(event.pointerType);
    const operationId = onInput?.(node.id, view, { phase: "start", control: "orbit", input });
    drag = { x: event.clientX, y: event.clientY, start: { ...view }, input,
      ...(typeof operationId === "string" ? { operationId } : {}) };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    view = normalizeScene3dView({
      ...drag.start,
      yaw: drag.start.yaw + (event.clientX - drag.x) * .012,
      pitch: drag.start.pitch - (event.clientY - drag.y) * .01,
    });
    renderScene(svg, content, view, variables);
    onInput?.(node.id, view, { phase: "update", control: "orbit", input: drag.input,
      ...(drag.operationId ? { operation_id: drag.operationId } : {}) });
  });
  const finishDrag = (event: PointerEvent) => {
    if (!drag) return;
    event.stopPropagation();
    onInput?.(node.id, view, { phase: "commit", control: "orbit", input: drag.input,
      ...(drag.operationId ? { operation_id: drag.operationId } : {}) });
    drag = undefined;
  };
  svg.addEventListener("pointerup", finishDrag);
  svg.addEventListener("pointercancel", finishDrag);
  let wheelGesture: {
    operationId?: string;
    timer?: ReturnType<typeof setTimeout>;
  } | undefined;
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
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
    renderScene(svg, content, view, variables);
    onInput?.(node.id, view, {
      phase: "update",
      control: "zoom",
      input: "mouse",
      ...(wheelGesture.operationId ? { operation_id: wheelGesture.operationId } : {}),
    });
    if (wheelGesture.timer) clearTimeout(wheelGesture.timer);
    wheelGesture.timer = setTimeout(() => {
      if (!wheelGesture) return;
      onInput?.(node.id, view, {
        phase: "commit",
        control: "zoom",
        input: "mouse",
        ...(wheelGesture.operationId ? { operation_id: wheelGesture.operationId } : {}),
      });
      wheelGesture = undefined;
    }, 140);
  }, { passive: false });
  renderScene(svg, content, view, variables);
  const fallback = document.createElement("p");
  fallback.className = "scene3d-fallback";
  fallback.textContent = `静态说明：${textLabel(content.fallback, "请结合旁白和标注理解这个三维场景。")}`;
  shell.append(controls, svg, fallback);
  parent.append(shell);
}

function textLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
