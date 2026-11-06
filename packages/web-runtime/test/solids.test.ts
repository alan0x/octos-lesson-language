import test from "node:test";
import assert from "node:assert/strict";
import { solidFacets } from "../src/solids.js";
import { scene3dSectionIntersections } from "../src/scene3d.js";

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
