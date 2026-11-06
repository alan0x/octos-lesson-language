// 3D solids as facets with outward normals, centred on `center` with their
// axis along z. Side facets of round solids meet smoothly ("side"); flat faces
// keep their edges ("face"). The board draws the facets that face the viewer,
// shaded by how squarely they face it, and slices them for cross-sections.
//
// A solid with `unfold` between 0 and 1 opens into its net: a prism's or
// pyramid's side faces swing out about their base edges and its top rides on
// the front side; a cylinder's or cone's side unrolls onto the plane that
// touches it along its front line, its discs swinging out to touch the net.

export interface Point3 { x: number; y: number; z: number }
export interface Facet { points: Point3[]; normal: Point3; part: "side" | "face" }

/** How many facets go round a round solid, and how many bands a sphere has. */
const ROUND = 40;
const BANDS = 16;
const TUBE = 18;

const add = (a: Point3, b: Point3): Point3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Point3, k: number): Point3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Point3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Point3) => { const l = length(a) || 1; return scale(a, 1 / l); };
const average = (points: Point3[]) => scale(points.reduce(add, { x: 0, y: 0, z: 0 }), 1 / points.length);
const UP = { x: 0, y: 0, z: 1 };

/** Rotates a vector about a unit axis (Rodrigues). */
function turn(vector: Point3, axis: Point3, angle: number): Point3 {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return add(add(scale(vector, cos), scale(cross(axis, vector), sin)), scale(axis, dot(axis, vector) * (1 - cos)));
}

/** A turn about the line through `at` along `axis`, for points and for normals. */
interface Hinge { at: Point3; axis: Point3; angle: number }
const turnPoint = (point: Point3, hinge: Hinge) => add(hinge.at, turn(sub(point, hinge.at), hinge.axis, hinge.angle));
/** Applies hinges in order (the face's own hinge first, then its parents'). */
function hinged(facet: Facet, hinges: Hinge[]): Facet {
  if (!hinges.length) return facet;
  return {
    ...facet,
    points: facet.points.map((point) => hinges.reduce(turnPoint, point)),
    normal: hinges.reduce((normal, hinge) => turn(normal, hinge.axis, hinge.angle), facet.normal),
  };
}

/** A flat face's normal (Newell's method), turned to point away from the solid's centre. */
function flatFace(points: Point3[], centre: Point3): Facet {
  let normal = { x: 0, y: 0, z: 0 };
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    normal = add(normal, { x: (point.y - next.y) * (point.z + next.z), y: (point.z - next.z) * (point.x + next.x), z: (point.x - next.x) * (point.y + next.y) });
  });
  normal = unit(normal);
  if (dot(normal, sub(average(points), centre)) < 0) normal = scale(normal, -1);
  return { points, normal, part: "face" };
}

/** A regular polygon of `sides` round the origin, with a side facing -y (towards the default view). */
function regularBase(radius: number, sides: number): Array<{ x: number; y: number }> {
  return Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + Math.PI / sides + (2 * Math.PI * index) / sides;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

/** The polygon's signed area (positive when its corners go counter-clockwise). */
function signedArea(base: Array<{ x: number; y: number }>): number {
  return base.reduce((sum, point, index) => { const next = base[(index + 1) % base.length]!; return sum + point.x * next.y - next.x * point.y; }, 0) / 2;
}

/** Whether a base polygon is usable: 3–12 corners, convex, with an area. */
export function convexBase(base: unknown): base is Array<{ x: number; y: number }> {
  if (!Array.isArray(base) || base.length < 3 || base.length > 12) return false;
  if (!base.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const area = signedArea(base);
  if (Math.abs(area) < 1e-9) return false;
  const sign = Math.sign(area);
  return base.every((point, index) => {
    const next = base[(index + 1) % base.length]!, after = base[(index + 2) % base.length]!;
    return sign * ((next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x)) > -1e-9;
  });
}

function circleRing(c: Point3, radius: number, z: number): Point3[] {
  return Array.from({ length: ROUND }, (_, index) => {
    const angle = (2 * Math.PI * index) / ROUND;
    return { x: c.x + radius * Math.cos(angle), y: c.y + radius * Math.sin(angle), z };
  });
}

/** Round sides between two rings (radius may differ: a cone or a frustum), smooth. */
function roundSides(bottom: Point3[], top: Point3[], height: number, bottomRadius: number, topRadius: number): Facet[] {
  const slant = Math.hypot(height, bottomRadius - topRadius);
  return bottom.map((point, index) => {
    const next = (index + 1) % bottom.length;
    const angle = (2 * Math.PI * (index + .5)) / bottom.length;
    const normal = { x: Math.cos(angle) * height / slant, y: Math.sin(angle) * height / slant, z: (bottomRadius - topRadius) / slant };
    const points = topRadius > 0 ? [point, bottom[next]!, top[next]!, top[index]!] : [point, bottom[next]!, top[0]!];
    return { points, normal, part: "side" as const };
  });
}

/** The vertices of a regular polyhedron with circumradius 1. */
function polyhedronVertices(kind: string): Point3[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: Array<[number, number, number]> = kind === "tetrahedron" ? [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]
    : kind === "octahedron" ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      : [[0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi], [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0], [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]];
  return raw.map(([x, y, z]) => unit({ x, y, z }));
}

/** The triangles of a polyhedron whose faces are all triangles with equal edges (tetra-, octa-, icosahedron). */
function triangleFaces(vertices: Point3[]): Point3[][] {
  const distances = vertices.flatMap((a, i) => vertices.slice(i + 1).map((b) => length(sub(a, b))));
  const edge = Math.min(...distances);
  const near = (a: Point3, b: Point3) => Math.abs(length(sub(a, b)) - edge) < edge * 1e-6;
  const faces: Point3[][] = [];
  for (let i = 0; i < vertices.length; i += 1) for (let j = i + 1; j < vertices.length; j += 1) for (let k = j + 1; k < vertices.length; k += 1) {
    const [a, b, c] = [vertices[i]!, vertices[j]!, vertices[k]!];
    if (near(a, b) && near(b, c) && near(a, c)) faces.push([a, b, c]);
  }
  return faces;
}

/** Orders a face's points round its centre, so it draws as one polygon. */
function aroundCentre(points: Point3[], normal: Point3): Point3[] {
  const centre = average(points);
  const u = unit(sub(points[0]!, centre));
  const v = cross(normal, u);
  return [...points].sort((a, b) => Math.atan2(dot(sub(a, centre), v), dot(sub(a, centre), u)) - Math.atan2(dot(sub(b, centre), v), dot(sub(b, centre), u)));
}

/** A regular polyhedron of circumradius `radius` round `c`. The dodecahedron is the icosahedron's dual. */
function polyhedronFacets(kind: string, c: Point3, radius: number): Facet[] {
  let faces: Point3[][];
  if (kind === "dodecahedron") {
    const icosahedron = polyhedronVertices("icosahedron");
    const triangles = triangleFaces(icosahedron);
    const centres = triangles.map((triangle) => unit(average(triangle)));
    // One pentagon per icosahedron vertex: the centres of the five triangles round it.
    faces = icosahedron.map((vertex) => aroundCentre(triangles.flatMap((triangle, index) => (triangle.includes(vertex) ? [centres[index]!] : [])), vertex));
  } else faces = triangleFaces(polyhedronVertices(kind));
  return faces.map((face) => flatFace(face.map((point) => add(c, scale(point, radius))), c));
}

/**
 * A prism (top_scale 1) or a pyramid (0) or a truncated pyramid (between) on
 * a base polygon, opened by `unfold`: each side swings out about its base
 * edge by (π − its angle to the base), the top about the front side's top edge.
 */
function prismLike(c: Point3, base: Array<{ x: number; y: number }>, height: number, topScale: number, unfold: number): Facet[] {
  // The base is moved so its own centre (centroid) sits under the solid's centre: a pyramid's apex rises above it.
  const area = signedArea(base);
  const middle = base.reduce((sum, point, index) => {
    const next = base[(index + 1) % base.length]!, k = point.x * next.y - next.x * point.y;
    return { x: sum.x + ((point.x + next.x) * k) / (6 * area), y: sum.y + ((point.y + next.y) * k) / (6 * area) };
  }, { x: 0, y: 0 });
  const centred = base.map((point) => ({ x: point.x - middle.x, y: point.y - middle.y }));
  const corners = area < 0 ? [...centred].reverse() : centred;
  const bottomZ = c.z - height / 2, topZ = c.z + height / 2;
  const bottom = corners.map((point) => ({ x: c.x + point.x, y: c.y + point.y, z: bottomZ }));
  const top = corners.map((point) => ({ x: c.x + point.x * topScale, y: c.y + point.y * topScale, z: topZ }));
  // Faces turn away from a point inside the solid; the centre need not be inside a base given by its corners.
  const inside = average([...bottom, ...top]);
  const facets: Facet[] = [flatFace([...bottom].reverse(), inside)];
  // The front side (nearest the default view, -y) carries the top when the net opens.
  let front = 0;
  bottom.forEach((point, index) => { const mid = average([point, bottom[(index + 1) % bottom.length]!]); if (mid.y < average([bottom[front]!, bottom[(front + 1) % bottom.length]!]).y) front = index; });
  bottom.forEach((point, index) => {
    const next = (index + 1) % bottom.length;
    const face = flatFace(topScale > 0 ? [point, bottom[next]!, top[next]!, top[index]!] : [point, bottom[next]!, top[0]!], inside);
    const axis = unit(sub(bottom[next]!, point));
    const outward = cross(axis, UP);
    // Its angle to the base, measured inside the solid: from the inward floor to the side's rise.
    const toward = unit(sub(average(face.points.slice(2)), average([point, bottom[next]!])));
    const angle = Math.atan2(dot(toward, UP), -dot(toward, outward));
    const hinge = { at: point, axis, angle: unfold * (Math.PI - angle) };
    facets.push(hinged(face, [hinge]));
    if (index === front && topScale > 0) {
      // The top swings about this side's top edge by the side's own angle to it, then rides with the side.
      const topHinge = { at: top[index]!, axis: unit(sub(top[next]!, top[index]!)), angle: unfold * angle };
      facets.push(hinged(flatFace(top, inside), [topHinge, hinge]));
    }
  });
  return facets;
}

/**
 * A cylinder or cone whose side unrolls onto the plane that touches it along
 * its front line (y = −r for a cylinder): the side's curvature eases to zero.
 * Its discs swing about where they touch that line, to lie in the same plane.
 */
function unrolledRound(c: Point3, radius: number, height: number, cone: boolean, unfold: number): Facet[] {
  const half = height / 2;
  const facets: Facet[] = [];
  const arc = (index: number) => -Math.PI * radius + (2 * Math.PI * radius * index) / ROUND;
  if (!cone) {
    // A circle of radius R / (1 − unfold) through the front line: the side, flattening.
    const bend = 1 - unfold;
    const at = (s: number, z: number) => (bend < 1e-6
      ? { x: c.x + s, y: c.y - radius, z }
      : { x: c.x + (radius / bend) * Math.sin((s * bend) / radius), y: c.y - radius + (radius / bend) * (1 - Math.cos((s * bend) / radius)), z });
    const normalAt = (s: number) => ({ x: Math.sin((s * bend) / radius), y: -Math.cos((s * bend) / radius), z: 0 });
    if (bend < 1e-6) {
      // Flat: one rectangle 2πr wide with its edges, not strips (whose edges would draw a grid).
      facets.push({ points: [at(arc(0), c.z - half), at(arc(ROUND), c.z - half), at(arc(ROUND), c.z + half), at(arc(0), c.z + half)], normal: normalAt(0), part: "face" });
    } else for (let index = 0; index < ROUND; index += 1) {
      const [s0, s1] = [arc(index), arc(index + 1)];
      facets.push({ points: [at(s0, c.z - half), at(s1, c.z - half), at(s1, c.z + half), at(s0, c.z + half)], normal: normalAt((s0 + s1) / 2), part: "side" });
    }
    // The discs touch the front line at its ends, and swing up (top) and down (bottom) into its plane.
    for (const [z, direction] of [[c.z + half, 1], [c.z - half, -1]] as const) {
      const hinge = { at: { x: c.x, y: c.y - radius, z }, axis: { x: direction, y: 0, z: 0 }, angle: unfold * Math.PI / 2 };
      const disc = circleRing(c, radius, z);
      facets.push(hinged({ points: direction > 0 ? disc : [...disc].reverse(), normal: { x: 0, y: 0, z: direction }, part: "face" }, [hinge]));
    }
    return facets;
  }
  // A cone: same slant l, its base radius growing from r to l (flat) while its front line stays put.
  const slant = Math.hypot(radius, height);
  const apex = { x: c.x, y: c.y, z: c.z + half };
  const contact = { x: c.x, y: c.y - radius, z: c.z - half };
  const g = unit(sub(contact, apex));
  const e1 = { x: 1, y: 0, z: 0 };
  // Towards the cone's axis from its front line, so axis = g·cosβ + inward·sinβ points from the apex to the base.
  const inward = cross(e1, g);
  const reach = radius + unfold * (slant - radius);
  const beta = Math.asin(Math.min(1, reach / slant));
  const axis = add(scale(g, Math.cos(beta)), scale(inward, Math.sin(beta)));
  const towardG = Math.sin(beta) > 1e-9 ? unit(sub(g, scale(axis, Math.cos(beta)))) : g;
  const direction = (psi: number) => add(scale(axis, Math.cos(beta)), scale(add(scale(towardG, Math.cos(psi)), scale(e1, Math.sin(psi))), Math.sin(beta)));
  // As it opens, the whole net also tips back about the front line's foot until that line stands upright:
  // the flat sector then faces the viewer as a cylinder's unrolled side does, instead of leaning away.
  const tilt = { at: contact, axis: e1, angle: unfold * Math.atan2(radius, height) };
  const strips: Facet[] = [];
  for (let index = 0; index < ROUND; index += 1) {
    const [s0, s1] = [arc(index), arc(index + 1)];
    const [p0, p1] = [s0 / reach, s1 / reach];
    const middle = direction((p0 + p1) / 2);
    const normal = unit(cross(sub(direction(p1), direction(p0)), middle));
    strips.push({ points: [add(apex, scale(direction(p0), slant)), add(apex, scale(direction(p1), slant)), apex], normal: dot(normal, sub(middle, axis)) < 0 ? scale(normal, -1) : normal, part: "side" });
  }
  if (unfold >= 1 - 1e-9) {
    // Flat: one sector with its edges, not strips (whose edges would draw a fan of lines).
    facets.push(hinged({ points: [apex, ...strips.map((strip) => strip.points[0]!), strips.at(-1)!.points[1]!], normal: strips[0]!.normal, part: "face" }, [tilt]));
  } else facets.push(...strips.map((strip) => hinged(strip, [tilt])));
  // The base disc swings about the line touching the base at the front, until its centre lies on the front line extended.
  const from = { x: 0, y: radius, z: 0 };
  const to = scale(g, radius);
  const full = Math.atan2(dot(cross(from, to), e1), dot(from, to));
  const hinge = { at: contact, axis: e1, angle: unfold * full };
  facets.push(hinged({ points: [...circleRing(c, radius, c.z - half)].reverse(), normal: { x: 0, y: 0, z: -1 }, part: "face" }, [hinge, tilt]));
  return facets;
}

/** The facets of a solid, or none for kinds drawn otherwise (surfaces) or with sizes that do not make a solid. */
export function solidFacets(object: Record<string, any>): Facet[] {
  const c = object.center as Point3;
  if (!c) return [];
  const kind = String(object.kind);
  const unfold = Math.min(1, Math.max(0, Number(object.unfold) || 0));
  const radius = Number(object.radius);
  const height = Number(object.height);
  const half = height / 2;
  if (kind === "box") {
    const size = object.size as Point3 | undefined;
    if (!size || !(size.x > 0 && size.y > 0 && size.z > 0)) return [];
    return prismLike(c, [{ x: -size.x / 2, y: -size.y / 2 }, { x: size.x / 2, y: -size.y / 2 }, { x: size.x / 2, y: size.y / 2 }, { x: -size.x / 2, y: size.y / 2 }], size.z, 1, unfold);
  }
  if (kind === "prism" || kind === "pyramid") {
    if (!(height > 0)) return [];
    const base = convexBase(object.base) ? object.base : radius > 0 && Number.isInteger(Number(object.sides)) && Number(object.sides) >= 3 && Number(object.sides) <= 12 ? regularBase(radius, Number(object.sides)) : undefined;
    if (!base) return [];
    const topScale = kind === "prism" ? 1 : Math.min(1, Math.max(0, Number(object.top_scale) || 0));
    return prismLike(c, base, height, topScale, unfold);
  }
  if (kind === "ellipsoid") {
    const radii = object.radii as Point3 | undefined;
    if (!radii || !(radii.x > 0 && radii.y > 0 && radii.z > 0)) return [];
    return sphereBands(c, radii, false);
  }
  if (!(radius > 0)) return [];
  if (kind === "sphere" || kind === "hemisphere") {
    const facets = sphereBands(c, { x: radius, y: radius, z: radius }, kind === "hemisphere");
    if (kind === "hemisphere") facets.push({ points: [...circleRing(c, radius, c.z)].reverse(), normal: { x: 0, y: 0, z: -1 }, part: "face" });
    return facets;
  }
  if (kind === "torus") {
    const tube = Number(object.tube);
    if (!(tube > 0 && tube < radius)) return [];
    const facets: Facet[] = [];
    const at = (u: number, v: number) => add(c, { x: (radius + tube * Math.cos(v)) * Math.cos(u), y: (radius + tube * Math.cos(v)) * Math.sin(u), z: tube * Math.sin(v) });
    for (let i = 0; i < ROUND; i += 1) for (let j = 0; j < TUBE; j += 1) {
      const [u0, u1] = [i, i + 1].map((step) => (2 * Math.PI * step) / ROUND) as [number, number];
      const [v0, v1] = [j, j + 1].map((step) => (2 * Math.PI * step) / TUBE) as [number, number];
      const u = (u0 + u1) / 2, v = (v0 + v1) / 2;
      facets.push({ points: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], normal: { x: Math.cos(v) * Math.cos(u), y: Math.cos(v) * Math.sin(u), z: Math.sin(v) }, part: "side" });
    }
    return facets;
  }
  if (kind === "tetrahedron" || kind === "octahedron" || kind === "dodecahedron" || kind === "icosahedron") return polyhedronFacets(kind, c, radius);
  if (!(height > 0)) return [];
  if ((kind === "cylinder" || kind === "cone") && unfold > 0) return unrolledRound(c, radius, height, kind === "cone", unfold);
  if (kind === "cylinder" || kind === "cone" || kind === "frustum") {
    const topRadius = kind === "cylinder" ? radius : kind === "cone" ? 0 : Number(object.top_radius);
    if (!(topRadius >= 0)) return [];
    const bottom = circleRing(c, radius, c.z - half);
    const top = topRadius > 0 ? circleRing(c, topRadius, c.z + half) : [{ x: c.x, y: c.y, z: c.z + half }];
    const facets = roundSides(bottom, top, height, radius, topRadius);
    if (topRadius > 0) facets.push({ points: top, normal: { x: 0, y: 0, z: 1 }, part: "face" });
    facets.push({ points: [...bottom].reverse(), normal: { x: 0, y: 0, z: -1 }, part: "face" });
    return facets;
  }
  return [];
}

/** A sphere, ellipsoid or (upper) hemisphere as latitude bands. */
function sphereBands(c: Point3, radii: Point3, upperHalf: boolean): Facet[] {
  const facets: Facet[] = [];
  for (let band = upperHalf ? BANDS / 2 : 0; band < BANDS; band += 1) {
    const [low, high] = [band, band + 1].map((step) => -Math.PI / 2 + (Math.PI * step) / BANDS) as [number, number];
    for (let index = 0; index < ROUND; index += 1) {
      const [a, b] = [index, index + 1].map((step) => (2 * Math.PI * step) / ROUND) as [number, number];
      const at = (lat: number, lon: number) => add(c, { x: radii.x * Math.cos(lat) * Math.cos(lon), y: radii.y * Math.cos(lat) * Math.sin(lon), z: radii.z * Math.sin(lat) });
      const lat = (low + high) / 2, lon = (a + b) / 2;
      // An ellipsoid's normal at a point p is (p.x/a², p.y/b², p.z/c²).
      const normal = unit({ x: Math.cos(lat) * Math.cos(lon) / radii.x, y: Math.cos(lat) * Math.sin(lon) / radii.y, z: Math.sin(lat) / radii.z });
      facets.push({ points: [at(low, a), at(low, b), at(high, b), at(high, a)], normal, part: "side" });
    }
  }
  return facets;
}

/** A solid's facets as triangles (a fan from each facet's first corner), for slicing cross-sections. */
export function solidTriangles(object: Record<string, any>): Array<{ points: [Point3, Point3, Point3] }> {
  return solidFacets(object).flatMap((facet) => facet.points.slice(1, -1).map((point, index) => ({ points: [facet.points[0]!, point, facet.points[index + 2]!] as [Point3, Point3, Point3] })));
}
