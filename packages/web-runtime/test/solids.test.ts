import test from "node:test";
import assert from "node:assert/strict";
import { solidFacets } from "../src/solids.js";
import { gluedFaces, scene3dSectionIntersections } from "../src/scene3d.js";

const c = { x: 0, y: 0, z: 0 };
const centreOf = (points: Array<{ x: number; y: number; z: number }>) => points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 });

test("every new solid has the faces it should, all turned outwards", () => {
  const cases: Array<[Record<string, unknown>, number, number[]]> = [
    [{ kind: "prism", sides: 6, radius: 1, height: 2 }, 8, [4, 4, 4, 4, 4, 4, 6, 6]],
    [{ kind: "pyramid", sides: 4, radius: 1, height: 2 }, 5, [3, 3, 3, 3, 4]],
    [{ kind: "tetrahedron", radius: 1 }, 4, [3, 3, 3, 3]],
    [{ kind: "octahedron", radius: 1 }, 8, Array(8).fill(3)],
    [{ kind: "dodecahedron", radius: 1 }, 12, Array(12).fill(5)],
    [{ kind: "icosahedron", radius: 1 }, 20, Array(20).fill(3)],
  ];
  for (const [object, count, corners] of cases) {
    const facets = solidFacets({ ...object, center: c });
    assert.equal(facets.length, count, String(object.kind));
    assert.deepEqual(facets.map((facet) => facet.points.length).sort(), [...corners].sort(), String(object.kind));
    for (const facet of facets) {
      const middle = centreOf(facet.points);
      assert.ok(middle.x * facet.normal.x + middle.y * facet.normal.y + middle.z * facet.normal.z > 0, `${object.kind} normals point outwards`);
      assert.equal(facet.part, "face");
    }
  }
  for (const object of [{ kind: "frustum", radius: 2, top_radius: 1, height: 2 }, { kind: "hemisphere", radius: 1 }, { kind: "torus", radius: 2, tube: 0.5 }]) {
    const facets = solidFacets({ ...object, center: c });
    assert.ok(facets.length > 40, String(object.kind));
    assert.ok(facets.some((facet) => facet.part === "side"));
  }
  // A dodecahedron's pentagons are regular: all edges equal.
  const pentagon = solidFacets({ kind: "dodecahedron", radius: 1, center: c })[0]!.points;
  const edges = pentagon.map((point, index) => { const next = pentagon[(index + 1) % 5]!; return Math.hypot(point.x - next.x, point.y - next.y, point.z - next.z); });
  assert.ok(Math.max(...edges) - Math.min(...edges) < 1e-9);
  // Wrong sizes draw nothing rather than a broken shape.
  assert.deepEqual(solidFacets({ kind: "torus", radius: 1, tube: 2, center: c }), []);
  assert.deepEqual(solidFacets({ kind: "prism", sides: 2, radius: 1, height: 1, center: c }), []);
});

test("a cut through a new solid gives its cross-section", () => {
  const cut = (object: Record<string, unknown>, value: number) => scene3dSectionIntersections(
    { objects: [{ as: "solid", center: c, ...object }] }, { as: "cut", axis: "z", value, targets: ["solid"], display: "intersection" });
  const square = cut({ kind: "pyramid", sides: 4, radius: 2, height: 4 }, 0);
  assert.equal(square.length, 1);
  assert.ok(square[0]!.closed && square[0]!.solid);
  // Halfway up a pyramid of base circumradius 2, the square's corners are 1 from the axis.
  for (const point of square[0]!.points) assert.ok(Math.abs(Math.hypot(point.x, point.y) - 1) < 1e-6 || Math.hypot(point.x, point.y) < 1);
  // A horizontal cut through a torus's middle is two rings.
  assert.equal(cut({ kind: "torus", radius: 2, tube: 0.5 }, 0).filter((path) => path.closed).length, 2);
  assert.equal(cut({ kind: "hemisphere", radius: 1 }, 0.5).length, 1);
});

const allPoints = (facets: Array<{ points: Array<{ x: number; y: number; z: number }> }>) => facets.flatMap((facet) => facet.points);

test("a prism or pyramid takes any convex base, and a pyramid can be cut flat at the top", () => {
  const triangle = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }];
  const prism = solidFacets({ kind: "prism", base: triangle, height: 2, center: c });
  assert.deepEqual(prism.map((facet) => facet.points.length).sort(), [3, 3, 4, 4, 4]);
  const pyramid = solidFacets({ kind: "pyramid", base: triangle, height: 2, center: c });
  assert.deepEqual(pyramid.map((facet) => facet.points.length).sort(), [3, 3, 3, 3]);
  for (const facet of [...prism, ...pyramid]) {
    const middle = centreOf(facet.points), inside = c; // the base is centred on its centroid
    const away = { x: middle.x - inside.x, y: middle.y - inside.y, z: middle.z - inside.z };
    assert.ok(away.x * facet.normal.x + away.y * facet.normal.y + away.z * facet.normal.z > 0, "normals point outwards");
  }
  const apex = allPoints(pyramid).reduce((high, point) => (point.z > high.z ? point : high));
  assert.ok(Math.abs(apex.x) < 1e-9 && Math.abs(apex.y) < 1e-9, "the apex rises above the base's centroid");
  // A truncated pyramid: a smaller copy of the base on top.
  const cut = solidFacets({ kind: "pyramid", sides: 4, radius: 2, height: 2, top_scale: 0.5, center: c });
  assert.deepEqual(cut.map((facet) => facet.points.length).sort(), [4, 4, 4, 4, 4, 4]);
  const top = cut.filter((facet) => facet.normal.z > 0.99)[0]!.points;
  assert.ok(Math.abs(Math.hypot(top[0]!.x, top[0]!.y) - 1) < 1e-9);
  // A base that is not convex draws nothing.
  assert.deepEqual(solidFacets({ kind: "prism", base: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0.2 }, { x: 1, y: 2 }], height: 1, center: c }), []);
});

test("an ellipsoid stretches a sphere along its three radii", () => {
  const facets = solidFacets({ kind: "ellipsoid", radii: { x: 3, y: 2, z: 1 }, center: c });
  const points = allPoints(facets);
  assert.ok(Math.abs(Math.max(...points.map((p) => p.x)) - 3) < 1e-9);
  assert.ok(Math.abs(Math.max(...points.map((p) => p.y)) - 2) < 0.05);
  assert.ok(Math.abs(Math.max(...points.map((p) => p.z)) - 1) < 1e-9);
  for (const point of points) assert.ok(Math.abs((point.x / 3) ** 2 + (point.y / 2) ** 2 + point.z ** 2 - 1) < 1e-9);
});

test("unfolding opens a solid into its net: closed at 0, flat at 1", () => {
  const flatAt = (facets: ReturnType<typeof solidFacets>, z: number) => allPoints(facets).every((point) => Math.abs(point.z - z) < 1e-9);
  for (const object of [
    { kind: "box", size: { x: 2, y: 3, z: 1 } },
    { kind: "prism", sides: 5, radius: 1, height: 2 },
    { kind: "pyramid", sides: 4, radius: 1, height: 2 },
    { kind: "pyramid", base: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }], height: 2 },
  ]) {
    const closed = solidFacets({ ...object, center: c });
    const zero = solidFacets({ ...object, center: c, unfold: 0 });
    assert.deepEqual(zero, closed, `${object.kind} at 0 is the closed solid`);
    const net = solidFacets({ ...object, center: c, unfold: 1 });
    assert.equal(net.length, closed.length);
    const bottom = Math.min(...allPoints(closed).map((point) => point.z));
    assert.ok(flatAt(net, bottom), `${object.kind} lies flat at 1`);
    // Every face keeps its area: the net is the surface, not a stretched copy.
    const area = (facets: ReturnType<typeof solidFacets>) => facets.reduce((sum, facet) => {
      let total = { x: 0, y: 0, z: 0 };
      facet.points.forEach((point, index) => {
        const next = facet.points[(index + 1) % facet.points.length]!;
        total = { x: total.x + point.y * next.z - point.z * next.y, y: total.y + point.z * next.x - point.x * next.z, z: total.z + point.x * next.y - point.y * next.x };
      });
      return sum + Math.hypot(total.x, total.y, total.z) / 2;
    }, 0);
    assert.ok(Math.abs(area(net) - area(closed)) < 1e-6, `${object.kind} keeps its surface area`);
    // Half open lies between: not flat.
    assert.ok(!flatAt(solidFacets({ ...object, center: c, unfold: 0.5 }), bottom));
  }
  // A cylinder's side unrolls into a rectangle 2πr wide; its discs fold flat beside it.
  const cylinder = solidFacets({ kind: "cylinder", radius: 1, height: 2, center: c, unfold: 1 });
  const sides = cylinder[0]!.points;
  assert.ok(sides.every((point) => Math.abs(point.y + 1) < 1e-9), "the unrolled side lies in one plane");
  assert.equal(cylinder.length, 3, "a flat net is one rectangle and two discs, not strips");
  const width = Math.max(...sides.map((point) => point.x)) - Math.min(...sides.map((point) => point.x));
  assert.ok(Math.abs(width - 2 * Math.PI) < 1e-6);
  assert.ok(allPoints(cylinder).every((point) => Math.abs(point.y + 1) < 1e-9), "the discs fold into the same plane");
  // A cone's side opens into a sector with the slant height as its radius.
  const cone = solidFacets({ kind: "cone", radius: 1, height: 2, center: c, unfold: 1 });
  const coneSide = [cone[0]!];
  const slant = Math.hypot(1, 2);
  // Opened, the front line stands upright on its foot (0, −1, −1): the apex is one slant height above it, and the net lies in y = −1.
  const apex = { x: 0, y: -1, z: -1 + slant };
  assert.ok(allPoints(cone).every((point) => Math.abs(point.y + 1) < 1e-9), "the cone's net lies in the plane y = −1");
  assert.equal(cone.length, 2, "a flat net is one sector and a disc, not strips");
  for (const point of allPoints(coneSide)) {
    const d = Math.hypot(point.x - apex.x, point.y - apex.y, point.z - apex.z);
    assert.ok(d < 1e-9 || Math.abs(d - slant) < 1e-6, "every rim point sits one slant height from the apex");
  }
  const normal = coneSide[0]!.normal;
  assert.ok(coneSide.every((facet) => Math.abs(facet.normal.x * normal.x + facet.normal.y * normal.y + facet.normal.z * normal.z - 1) < 1e-6), "the sector is flat");
});

test("where two solids are stacked, the face they share is found (and drawn as a seam only)", () => {
  const cylinder = { kind: "cylinder", center: { x: 0, y: 0, z: -1 }, radius: 1, height: 4 };
  assert.equal(gluedFaces([cylinder, { kind: "cone", center: { x: 0, y: 0, z: 2 }, radius: 1, height: 2 }]).size, 1);
  assert.equal(gluedFaces([cylinder, { kind: "hemisphere", center: { x: 0, y: 0, z: 1 }, radius: 1 }]).size, 1);
  assert.equal(gluedFaces([{ kind: "box", center: { x: 0, y: 0, z: -1 }, size: { x: 2, y: 2, z: 2 } }, { kind: "pyramid", center: { x: 0, y: 0, z: 0.5 }, sides: 4, radius: Math.SQRT2, height: 1 }]).size, 1);
  // A smaller cylinder on a larger one: the larger one's top still shows round it.
  assert.equal(gluedFaces([cylinder, { kind: "cylinder", center: { x: 0, y: 0, z: 2 }, radius: 0.5, height: 2 }]).size, 0);
  // Two solids side by side share nothing.
  assert.equal(gluedFaces([cylinder, { ...cylinder, center: { x: 5, y: 0, z: -1 } }]).size, 0);
});
