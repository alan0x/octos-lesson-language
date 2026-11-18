import test from "node:test";
import assert from "node:assert/strict";
import { deriveExecutionRequirements, normalizeAuthoringLesson, validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import { solidFacets } from "../../web-runtime/src/solids.js";
import { buildSolid, describeSolid, solidMeasures, solidMeasuresText, solidXReach, solidZRange, type Solid } from "../src/index.js";

const names = { top: "top", bottom: "bottom", front: "front", back: "back", left: "left", right: "right" };

function lessonOf(built: ReturnType<typeof buildSolid>, variables: unknown[] = []): AuthoringLesson {
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Solid", goals: ["Look at the solid"], variables },
    steps: [{ key: "s", purpose: "Show it", beats: [{ key: "b", say: "Here it is.", actions: built.actions }] }],
    close: { summary: "Done.", focus: [built.whole] },
  } as unknown as AuthoringLesson;
}
function validates(built: ReturnType<typeof buildSolid>, variables: unknown[] = []) {
  validateAuthoringLesson(lessonOf(built, variables));
}
const needs = (built: ReturnType<typeof buildSolid>, variables: unknown[] = []) =>
  deriveExecutionRequirements(normalizeAuthoringLesson(lessonOf(built, variables), { lessonId: "s", boardId: "board", baseRevision: 0, regionIntent: "new_topic" }));
const content = (built: ReturnType<typeof buildSolid>) => (built.actions[0] as { content: Record<string, any> }).content;

test("every solid shape builds a valid scene with its description", () => {
  const solids: Solid[] = [
    { shape: "box", size: { x: 3, y: 2, z: 1 } },
    { shape: "cylinder", radius: 1, height: 2 },
    { shape: "prism", sides: 6, radius: 1, height: 2 },
    { shape: "pyramid", base: { kind: "triangle", a: 3, b: 4, c: 5 }, height: 2, topScale: 0.5 },
    { shape: "composite", parts: "cylinder_cone", radius: 1, height: 2, topHeight: 1 },
    { shape: "torus", radius: 2, tube: 0.5 },
    { shape: "icosahedron", radius: 1 },
  ];
  for (const solid of solids) {
    const built = buildSolid({ as: "scene", role: "diagram", place: { relation: "new_region" }, solid, fallback: describeSolid(solid, "en-US"), face_targets: solid.shape !== "box" });
    validates(built);
    assert.ok(describeSolid(solid, "zh-CN").endsWith("。"), solid.shape);
  }
  const composite = buildSolid({ as: "s", role: "diagram", place: { relation: "new_region" }, solid: solids[4]!, fallback: "x" });
  assert.deepEqual(content(composite).objects.map((object: { as: string }) => object.as), ["solid", "solid-top"]);
  assert.equal(composite.parts.solid_top, "s#solid-top");
});

test("a box can be cut by a sliding plane, or unfold into its net with highlightable faces", () => {
  const box: Solid = { shape: "box", size: { x: 4, y: 2, z: 2 } };
  const cut = buildSolid({ as: "cut-box", role: "diagram", place: { relation: "new_region" }, solid: box, fallback: "box", cut: { expression: "h" } });
  validates(cut, [{ as: "h", initial: 0, min: -1, max: 1, label: "height", control: { kind: "slider", step: 0.02 } }]);
  assert.deepEqual(content(cut).sections[0], { as: "cut", axis: "z", value: 0, targets: ["solid"], display: "plane_and_intersection", color: "orange" });
  assert.deepEqual(solidZRange(box), [-1, 1]);

  const net = buildSolid({ as: "net", role: "diagram", place: { relation: "new_region" }, solid: box, fallback: "box", face_targets: true,
    box_faces: { names }, unfold: { expression: "u" } });
  validates(net, [{ as: "u", initial: 0, min: 0, max: 1, label: "unfold", control: { kind: "slider", step: 0.02 } }]);
  const scene = content(net);
  assert.deepEqual(Object.keys(scene.objects[0]).slice(-2), ["face_targets", "unfold"]);
  assert.equal(scene.highlights.length, 6);
  assert.equal(scene.highlights[0].label, "top\n4 × 2");
  assert.deepEqual(scene.bindings, [{ target: "solid.unfold", expression: "u" }]);
});

test("a solid is cut or unfolded, not both, and only nets unfold", () => {
  const place = { relation: "new_region" };
  assert.throws(() => buildSolid({ as: "s", role: "diagram", place, solid: { shape: "box", size: { x: 1, y: 1, z: 1 } }, fallback: "", cut: { expression: "a" }, unfold: { expression: "b" } }), /either cut or unfolded/);
  assert.throws(() => buildSolid({ as: "s", role: "diagram", place, solid: { shape: "sphere", radius: 1 }, fallback: "", unfold: { expression: "b" } }), /no net/);
  assert.throws(() => buildSolid({ as: "s", role: "diagram", place, solid: { shape: "prism", base: { kind: "triangle", a: 1, b: 1, c: 5 }, height: 1 }, fallback: "" }), /do not make a triangle/);
});

const place = { relation: "new_region" };
const slider = (as: string, min: number, max: number) => ({ as, initial: min, min, max, label: as, control: { kind: "slider", step: 0.02 } });

test("measures come from the shape and sizes: exact when they can be, π kept as π", () => {
  const line = (solid: Solid, language = "en-US") => solidMeasuresText(solid, ["volume", "surface_area"], language);
  assert.equal(line({ shape: "box", size: { x: 2, y: 3, z: 4 } }), "Volume = 24; Surface area = 52");
  assert.equal(line({ shape: "box", size: { x: 2, y: 3, z: 4 } }, "zh-CN"), "体积 = 24；表面积 = 52");
  assert.equal(line({ shape: "cylinder", radius: 2, height: 3 }), "Volume = 12π ≈ 37.70; Surface area = 20π ≈ 62.83");
  assert.equal(line({ shape: "cone", radius: 3, height: 4 }), "Volume = 12π ≈ 37.70; Surface area = 24π ≈ 75.40");
  assert.equal(line({ shape: "cone", radius: 1, height: 1 }), "Volume = π/3 ≈ 1.05; Surface area ≈ 7.58", "slant √2: no exact multiple of π");
  assert.equal(line({ shape: "sphere", radius: 3 }), "Volume = 36π ≈ 113.10; Surface area = 36π ≈ 113.10");
  assert.equal(line({ shape: "sphere", radius: 1 }), "Volume = 4π/3 ≈ 4.19; Surface area = 4π ≈ 12.57");
  assert.equal(line({ shape: "hemisphere", radius: 3 }), "Volume = 18π ≈ 56.55; Surface area = 27π ≈ 84.82", "the flat disc counts");
  assert.equal(line({ shape: "cylinder", radius: 1.5, height: 2 }), "Volume = 4.5π ≈ 14.14; Surface area = 10.5π ≈ 32.99");
  assert.equal(line({ shape: "frustum", radius: 2, topRadius: 1, height: 3 }), "Volume = 7π ≈ 21.99; Surface area ≈ 45.51");
  // A right-triangle prism: base 6, perimeter 12.
  assert.equal(line({ shape: "prism", base: { kind: "right_triangle", a: 3, b: 4 }, height: 10 }), "Volume = 60; Surface area = 132");
  // A square pyramid, slant height 5.
  assert.equal(line({ shape: "pyramid", base: { kind: "rectangle", length: 6, width: 6 }, height: 4 }), "Volume = 48; Surface area = 96");
  // A square pyramid by its circumradius: the same solid.
  assert.equal(line({ shape: "pyramid", sides: 4, radius: 3 * Math.SQRT2, height: 4 }), "Volume = 48; Surface area = 96");
  // Truncated at half: h/3 (16 + 4 + 8); sides are trapezoids (4 + 2)/2 × √(3² + 1²).
  assert.equal(line({ shape: "pyramid", base: { kind: "rectangle", length: 4, width: 4 }, height: 3, topScale: 0.5 }), `Volume = 28; Surface area ≈ ${(20 + 12 * Math.sqrt(10)).toFixed(2)}`);
  assert.equal(line({ shape: "prism", sides: 6, radius: 1, height: 2 }), "Volume ≈ 5.20; Surface area ≈ 17.20");
  assert.equal(line({ shape: "box", size: { x: 0.1, y: 0.2, z: 0.5 } }), "Volume = 0.01; Surface area = 0.34", "no floating-point tails");
  // A volume needing more than three places is rounded, and says so (owner review of #73).
  assert.equal(solidMeasuresText({ shape: "box", size: { x: 123.45, y: 123.45, z: 123.45 } }, ["volume"], "en-US"), "Volume ≈ 1881365.96");
  assert.equal(solidMeasuresText({ shape: "box", size: { x: 1.5, y: 1.5, z: 1.5 } }, ["volume"], "en-US"), "Volume = 3.375");
  assert.equal(solidMeasuresText({ shape: "sphere", radius: 3 }, ["volume"], "en-US"), "Volume = 36π ≈ 113.10", "4/3 × 27 computed with noise is still exact");
});

test("counts only for polyhedra; a composite has a volume but no surface area", () => {
  const counts = (solid: Solid) => solidMeasuresText(solid, ["counts"], "en-US");
  assert.equal(counts({ shape: "box", size: { x: 1, y: 1, z: 1 } }), "6 faces, 12 edges, 8 vertices");
  assert.equal(counts({ shape: "prism", sides: 3, radius: 1, height: 2 }), "5 faces, 9 edges, 6 vertices");
  assert.equal(counts({ shape: "pyramid", sides: 5, radius: 1, height: 2 }), "6 faces, 10 edges, 6 vertices");
  assert.equal(counts({ shape: "pyramid", sides: 4, radius: 1, height: 2, topScale: 0.5 }), "6 faces, 12 edges, 8 vertices");
  assert.equal(solidMeasuresText({ shape: "prism", sides: 3, radius: 1, height: 2 }, ["counts"], "zh-CN"), "5 个面，9 条棱，6 个顶点");
  assert.throws(() => counts({ shape: "cylinder", radius: 1, height: 1 }), /no face, edge and vertex counts/);
  const lShape: Solid = { shape: "composite", parts: "two_boxes", size: { x: 4, y: 3, z: 2 }, sideSize: { x: 2, y: 3, z: 5 } };
  assert.equal(solidMeasuresText(lShape, ["volume"], "en-US"), "Volume = 54");
  assert.equal(solidMeasuresText({ shape: "composite", parts: "cylinder_cone", radius: 1, height: 2, topHeight: 3 }, ["volume"], "en-US"), "Volume = 3π ≈ 9.42");
  assert.throws(() => solidMeasuresText(lShape, ["surface_area"], "en-US"), /no surface area/);
  assert.deepEqual(solidMeasures({ shape: "torus", radius: 2, tube: 1 }), {}, "shapes AI lessons do not offer get nothing");
});

test("two boxes stand side by side on one floor: an L shape", () => {
  const lShape: Solid = { shape: "composite", parts: "two_boxes", size: { x: 4, y: 3, z: 2 }, sideSize: { x: 2, y: 3, z: 5 } };
  const built = buildSolid({ as: "l", role: "diagram", place, solid: lShape, fallback: describeSolid(lShape, "en-US"), face_targets: true, cut: { expression: "h" } });
  validates(built, [slider("h", -2.5, 2.5)]);
  const scene = content(built);
  assert.deepEqual(scene.objects.map((object: Record<string, unknown>) => [object.as, object.kind, object.center, object.size]), [
    ["solid", "box", { x: -1, y: 0, z: -1.5 }, { x: 4, y: 3, z: 2 }],
    ["solid-side", "box", { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 5 }],
  ]);
  assert.deepEqual(solidZRange(lShape), [-2.5, 2.5]);
  assert.deepEqual(scene.sections[0].targets, ["solid", "solid-side"]);
  assert.equal(built.parts.solid_side, "l#solid-side");
  assert.equal(describeSolid(lShape, "zh-CN"), "长 4、宽 3、高 2 的长方体，右边紧挨着长 2、宽 3、高 5 的长方体。");
  assert.equal(solidXReach(lShape), 3);
});

test("a second solid stands beside the first: one floor, the pair centred, apart", () => {
  const cone: Solid = { shape: "cone", radius: 3, height: 4 };
  const cylinder: Solid = { shape: "cylinder", radius: 3, height: 4 };
  const built = buildSolid({ as: "pair", role: "diagram", place, solid: cone, beside: cylinder, fallback: "A cone and a cylinder.",
    show: { measures: ["volume"], language: "en-US" } });
  validates(built);
  const scene = content(built);
  assert.deepEqual(scene.objects.map((object: Record<string, unknown>) => [object.as, object.center]), [
    ["solid", { x: -3.75, y: 0, z: 0 }], ["beside", { x: 3.75, y: 0, z: 0 }],
  ]);
  assert.equal(scene.caption, "Cone: Volume = 12π ≈ 37.70\nCylinder: Volume = 36π ≈ 113.10");
  assert.deepEqual(built.parts, { whole: "pair", solid: "pair#solid", beside: "pair#beside" });
  const required = needs(built);
  assert.ok(required.requiredCapabilities.includes("scene3d:caption"));
  assert.equal(required.minimumPlayerVersion, "0.13.0", "an older player leaves the measures line out");

  // Different heights stand on one floor: a sphere of radius 1 beside a cube of 4.
  const sphere = buildSolid({ as: "s", role: "diagram", place, solid: { shape: "box", size: { x: 4, y: 4, z: 4 } }, beside: { shape: "sphere", radius: 1 }, fallback: "x",
    show: { measures: ["volume", "surface_area"], language: "zh-CN" } });
  const [box, ball] = content(sphere).objects as Array<{ center: { x: number; z: number } }>;
  assert.equal(box!.center.z - 2, ball!.center.z - 1, "bottoms level");
  assert.ok(ball!.center.x - 1 > box!.center.x + 2, "apart");
  assert.equal(content(sphere).caption, "正方体：体积 = 64；表面积 = 96\n球：体积 = 4π/3 ≈ 4.19；表面积 = 4π ≈ 12.57");

  // Two of a kind are named by side; a composite beside keeps its parts.
  const two = buildSolid({ as: "t", role: "diagram", place, solid: { shape: "box", size: { x: 1, y: 2, z: 3 } }, beside: { shape: "composite", parts: "cylinder_cone", radius: 1, height: 1, topHeight: 1 },
    fallback: "x", show: { measures: ["volume"], language: "en-US" } });
  assert.deepEqual(Object.keys(two.parts), ["whole", "solid", "beside", "beside_top"]);
  const boxes = buildSolid({ as: "b", role: "diagram", place, solid: { shape: "box", size: { x: 1, y: 2, z: 3 } }, beside: { shape: "box", size: { x: 2, y: 2, z: 2 } }, fallback: "x", show: { measures: ["volume"], language: "en-US" } });
  assert.equal(content(boxes).caption, "Box: Volume = 6\nCube: Volume = 8");
  const same = buildSolid({ as: "b", role: "diagram", place, solid: { shape: "cylinder", radius: 1, height: 2 }, beside: { shape: "cylinder", radius: 2, height: 1 }, fallback: "x", show: { measures: ["volume"], language: "en-US" } });
  assert.equal(content(same).caption, "Left: Volume = 2π ≈ 6.28\nRight: Volume = 4π ≈ 12.57");
});

test("beside: one plane cuts both, both nets open together, box faces stay for a box alone", () => {
  const cone: Solid = { shape: "cone", radius: 1, height: 2 };
  const cylinder: Solid = { shape: "cylinder", radius: 1, height: 3 };
  const cut = buildSolid({ as: "c", role: "diagram", place, solid: cone, beside: cylinder, fallback: "x", cut: { expression: "h" } });
  validates(cut, [slider("h", -1.5, 1.5)]);
  assert.deepEqual(content(cut).sections[0], { as: "cut", axis: "z", value: 0, targets: ["solid", "beside"], display: "plane_and_intersection", color: "orange" });
  assert.deepEqual(cut.cutRange, [-1.5, 1.5], "the plane travels the pair's height, for the caller's slider");
  // A hemisphere (its own range 0..2) beside a taller cone: the pair's range, not the hemisphere's.
  const dome = buildSolid({ as: "d", role: "diagram", place, solid: { shape: "hemisphere", radius: 2 }, beside: { shape: "cone", radius: 1, height: 4 }, fallback: "x", cut: { expression: "h" } });
  assert.deepEqual(dome.cutRange, [-2, 2]);
  assert.deepEqual(content(dome).objects.map((object: { center: { z: number } }) => object.center.z), [-2, 0], "the dome's flat face and the cone's centre: both bottoms at -2");
  assert.deepEqual(buildSolid({ as: "c", role: "diagram", place, solid: { shape: "hemisphere", radius: 2 }, fallback: "x", cut: { expression: "h" } }).cutRange, [0, 2]);
  const net = buildSolid({ as: "n", role: "diagram", place, solid: cone, beside: cylinder, fallback: "x", unfold: { expression: "u" } });
  validates(net, [slider("u", 0, 1)]);
  assert.deepEqual(content(net).bindings, [{ target: "solid.unfold", expression: "u" }, { target: "beside.unfold", expression: "u" }]);
  // The nets open without running into each other, at every stage (the player's own facets).
  for (const [first, second] of [[{ shape: "box", size: { x: 2, y: 2, z: 2 } }, { shape: "cylinder", radius: 1, height: 2 }], [{ shape: "cylinder", radius: 3, height: 1 }, { shape: "box", size: { x: 1, y: 1, z: 4 } }],
    [{ shape: "pyramid", base: { kind: "rectangle", length: 4, width: 2 }, height: 3, topScale: 0.5 }, { shape: "cone", radius: 1, height: 3 }]] as Array<[Solid, Solid]>) {
    const objects = content(buildSolid({ as: "n", role: "diagram", place, solid: first, beside: second, fallback: "x", unfold: { expression: "u" } })).objects as Array<Record<string, any>>;
    for (let step = 0; step <= 40; step += 1) {
      const xs = (as: string) => objects.filter((object) => object.as.startsWith(as))
        .flatMap((object) => solidFacets({ ...object, unfold: step / 40 }).flatMap((facet) => facet.points.map((point) => point.x)));
      assert.ok(Math.max(...xs("solid")) < Math.min(...xs("beside")), `${first.shape} and ${second.shape} nets apart at ${step / 40}`);
    }
  }
  assert.throws(() => buildSolid({ as: "n", role: "diagram", place, solid: cone, beside: { shape: "sphere", radius: 1 }, fallback: "x", unfold: { expression: "u" } }), /no net/);
  assert.throws(() => buildSolid({ as: "n", role: "diagram", place, solid: { shape: "box", size: { x: 1, y: 1, z: 1 } }, beside: cone, fallback: "x", box_faces: { names } }), /on its own/);
});

test("the measures line is gated where it is written or revised in; an empty caption needs nothing", () => {
  const built = buildSolid({ as: "scene", role: "diagram", place, solid: { shape: "cone", radius: 1, height: 2 }, fallback: "A cone." });
  const revised = lessonOf(built);
  revised.steps[0]!.beats.push({ key: "r", say: "Its volume.", actions: [{ do: "revise", target: "scene", content: { ...content(built), caption: "Volume = 2π/3 ≈ 2.09" }, reason: "Show the volume" }] } as never);
  assert.ok(deriveExecutionRequirements(normalizeAuthoringLesson(revised, { lessonId: "s", boardId: "board", baseRevision: 0, regionIntent: "new_topic" })).requiredCapabilities.includes("scene3d:caption"));
  const empty = buildSolid({ as: "scene", role: "diagram", place, solid: { shape: "cone", radius: 1, height: 2 }, fallback: "A cone." });
  (empty.actions[0] as { content: Record<string, unknown> }).content.caption = " ";
  assert.ok(!needs(empty).requiredCapabilities.includes("scene3d:caption"));
  const pair = buildSolid({ as: "p", role: "diagram", place, solid: { shape: "pyramid", sides: 4, radius: 1, height: 2, topScale: 0 }, beside: { shape: "cone", radius: 1, height: 2 }, fallback: "x", show: { measures: ["volume"], language: "en-US" } });
  assert.match(String(content(pair).caption), /^Pyramid: /u, "top scale 0 is a whole pyramid");
});

test("a lesson without beside or show builds exactly as before", () => {
  const built = buildSolid({ as: "scene", role: "diagram", place, solid: { shape: "cone", radius: 1, height: 2 }, fallback: "A cone." });
  assert.deepEqual(content(built), { fallback: "A cone.", axes: false, camera: { yaw: 0.72, pitch: 0.55, zoom: 1 },
    objects: [{ as: "solid", kind: "cone", center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2 }] });
  assert.ok(!needs(built).requiredCapabilities.includes("scene3d:caption"));
});
