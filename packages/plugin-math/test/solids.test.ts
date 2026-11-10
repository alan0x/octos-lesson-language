import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import { buildSolid, describeSolid, solidZRange, type Solid } from "../src/index.js";

const names = { top: "top", bottom: "bottom", front: "front", back: "back", left: "left", right: "right" };

function validates(built: ReturnType<typeof buildSolid>, variables: unknown[] = []) {
  validateAuthoringLesson({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Solid", goals: ["Look at the solid"], variables },
    steps: [{ key: "s", purpose: "Show it", beats: [{ key: "b", say: "Here it is.", actions: built.actions }] }],
    close: { summary: "Done.", focus: [built.whole] },
  } as unknown as AuthoringLesson);
}
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
