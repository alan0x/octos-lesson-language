// 3D solids as facets with outward normals, centred on `center` with their
// axis along z. Side facets of round solids meet smoothly ("side"); flat faces
// keep their edges ("face"). The board draws the facets that face the viewer,
// shaded by how squarely they face it, and slices them for cross-sections.

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
const length = (a: Point3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Point3) => { const l = length(a) || 1; return scale(a, 1 / l); };
const average = (points: Point3[]) => scale(points.reduce(add, { x: 0, y: 0, z: 0 }), 1 / points.length);

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

/** A regular polygon of `sides` round the z axis at height z, with a side facing -y (towards the default view). */
function polygonRing(c: Point3, radius: number, z: number, sides: number): Point3[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + Math.PI / sides + (2 * Math.PI * index) / sides;
    return { x: c.x + radius * Math.cos(angle), y: c.y + radius * Math.sin(angle), z };
  });
}

function circleRing(c: Point3, radius: number, z: number): Point3[] {
  return Array.from({ length: ROUND }, (_, index) => {
    const angle = (2 * Math.PI * index) / ROUND;
    return { x: c.x + radius * Math.cos(angle), y: c.y + radius * Math.sin(angle), z };
  });
}

/** Round sides between two rings (radius may differ: a cone or a frustum), smooth. */
function roundSides(c: Point3, bottom: Point3[], top: Point3[], height: number, bottomRadius: number, topRadius: number): Facet[] {
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
  const v = { x: normal.y * u.z - normal.z * u.y, y: normal.z * u.x - normal.x * u.z, z: normal.x * u.y - normal.y * u.x };
  return [...points].sort((a, b) => Math.atan2(dot(sub(a, centre), v), dot(sub(a, centre), u)) - Math.atan2(dot(sub(b, centre), v), dot(sub(b, centre), u)));
}

/** A regular polyhedron of circumradius `radius` round `c`. The dodecahedron is the icosahedron's dual. */
function polyhedronFacets(kind: string, c: Point3, radius: number): Facet[] {
  const origin = { x: 0, y: 0, z: 0 };
  let faces: Point3[][];
  if (kind === "dodecahedron") {
    const icosahedron = polyhedronVertices("icosahedron");
    const triangles = triangleFaces(icosahedron);
    const centres = triangles.map((triangle) => unit(average(triangle)));
    // One pentagon per icosahedron vertex: the centres of the five triangles round it.
    faces = icosahedron.map((vertex) => aroundCentre(triangles.flatMap((triangle, index) => (triangle.includes(vertex) ? [centres[index]!] : [])), vertex));
  } else faces = triangleFaces(polyhedronVertices(kind));
  return faces.map((face) => flatFace(face.map((point) => add(c, scale(point, radius))), add(c, origin)));
}

/** The facets of a solid, or none for kinds drawn otherwise (box, surfaces). */
export function solidFacets(object: Record<string, any>): Facet[] {
  const c = object.center as Point3;
  const radius = Number(object.radius);
  if (!c || !(radius > 0)) return [];
  const kind = String(object.kind);
  const height = Number(object.height);
  const half = height / 2;
  const facets: Facet[] = [];
  if (kind === "sphere" || kind === "hemisphere") {
    // A hemisphere is the upper half, its flat face at the centre's height.
    const fromBand = kind === "hemisphere" ? BANDS / 2 : 0;
    for (let band = fromBand; band < BANDS; band += 1) {
      const [low, high] = [band, band + 1].map((step) => -Math.PI / 2 + (Math.PI * step) / BANDS) as [number, number];
      for (let index = 0; index < ROUND; index += 1) {
        const [a, b] = [index, index + 1].map((step) => (2 * Math.PI * step) / ROUND) as [number, number];
        const at = (lat: number, lon: number) => add(c, scale({ x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) }, radius));
        const lat = (low + high) / 2, lon = (a + b) / 2;
        facets.push({ points: [at(low, a), at(low, b), at(high, b), at(high, a)], normal: { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) }, part: "side" });
      }
    }
    if (kind === "hemisphere") facets.push({ points: [...circleRing(c, radius, c.z)].reverse(), normal: { x: 0, y: 0, z: -1 }, part: "face" });
    return facets;
  }
  if (kind === "torus") {
    const tube = Number(object.tube);
    if (!(tube > 0 && tube < radius)) return [];
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
  if (kind === "prism" || kind === "pyramid") {
    const sides = Math.round(Number(object.sides));
    if (!(sides >= 3 && sides <= 12)) return [];
    const bottom = polygonRing(c, radius, c.z - half, sides);
    if (kind === "prism") {
      const top = polygonRing(c, radius, c.z + half, sides);
      bottom.forEach((point, index) => { const next = (index + 1) % sides; facets.push(flatFace([point, bottom[next]!, top[next]!, top[index]!], c)); });
      facets.push(flatFace(top, c));
    } else {
      const apex = { x: c.x, y: c.y, z: c.z + half };
      bottom.forEach((point, index) => facets.push(flatFace([point, bottom[(index + 1) % sides]!, apex], c)));
    }
    facets.push(flatFace([...bottom].reverse(), c));
    return facets;
  }
  if (kind === "cylinder" || kind === "cone" || kind === "frustum") {
    const topRadius = kind === "cylinder" ? radius : kind === "cone" ? 0 : Number(object.top_radius);
    if (!(topRadius >= 0)) return [];
    const bottom = circleRing(c, radius, c.z - half);
    const top = topRadius > 0 ? circleRing(c, topRadius, c.z + half) : [{ x: c.x, y: c.y, z: c.z + half }];
    facets.push(...roundSides(c, bottom, top, height, radius, topRadius));
    if (topRadius > 0) facets.push({ points: top, normal: { x: 0, y: 0, z: 1 }, part: "face" });
    facets.push({ points: [...bottom].reverse(), normal: { x: 0, y: 0, z: -1 }, part: "face" });
    return facets;
  }
  return [];
}

/** A solid's facets as triangles (a fan from each facet's first corner), for slicing cross-sections. */
export function solidTriangles(object: Record<string, any>): Array<{ points: [Point3, Point3, Point3] }> {
  return solidFacets(object).flatMap((facet) => facet.points.slice(1, -1).map((point, index) => ({ points: [facet.points[0]!, point, facet.points[index + 2]!] as [Point3, Point3, Point3] })));
}
