import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import {
  REARRANGEMENT_CONSTRUCTIONS, buildCircleAndArc, buildCircleAreaRearrangement, buildCoordinateCircle,
  buildGeometricRearrangement, buildUnitSquareArray, type RearrangementConstruction,
} from "../src/index.js";

const place = { relation: "new_region" };
const t = (source: string, values: Record<string, unknown> = {}) => source.replace(/\{\{(\w+)\}\}/g, (_m, key) => String(values[key]));
const slider = (as: string, initial: number, min: number, max: number, step = 0.05) => ({ as, initial, min, max, label: as, control: { kind: "slider", step } });

function validates(built: { actions: unknown[]; whole: string }, variables: unknown[]) {
  validateAuthoringLesson({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "zh-CN", title: "几何", goals: ["看图"], variables },
    steps: [{ key: "s", purpose: "展示", beats: [{ key: "b", say: "看这里。", actions: built.actions }] }],
    close: { summary: "完成。", focus: [built.whole] },
  } as unknown as AuthoringLesson);
}

test("a circle and arc follows its angle and radius numbers", () => {
  const built = buildCircleAndArc({ as: "arc", role: "main_visual", place, t, title: "圆弧", radius: 2, angle: Math.PI / 3,
    angle_number: { variable: "n1", expression: "n1" }, radius_number: { variable: "n2", min: 1, max: 3 } });
  validates(built, [slider("n1", Math.PI / 3, 0, 6.28), slider("n2", 2, 1, 3)]);
  const content = (built.actions[0] as { content: Record<string, any> }).content;
  assert.equal(content.axes.x.max, 3.75);
  assert.equal(content.circles[0].label, "半径 r");
  assert.equal(built.parts.primary_control, "arc#moving-point");
});

test("a coordinate circle's radius can follow a formula of a lesson number", () => {
  const built = buildCoordinateCircle({ as: "c", role: "main_visual", place, t, title: "圆", center: { x: 1, y: -1 }, radius: 1, maximum_radius: 2,
    radius_binding: { expression: "sqrt(n1)", formula: true } });
  validates(built, [slider("n1", 1, 0, 4)]);
  const content = (built.actions[0] as { content: Record<string, any> }).content;
  assert.deepEqual(content.bindings, [{ target: "circle.radius", expression: "sqrt(n1)", allow_zero: true, label: { prefix: "r = ", precision: 2 } }]);
  assert.deepEqual(content.axes.x, { min: -2, max: 4, label: "x" });
});

test("unit squares fill a rectangle as its columns and rows change", () => {
  const built = buildUnitSquareArray({ as: "grid", role: "main_visual", place, t, title: "面积",
    columns: { variable: "n1", initial: 5, max: 6 }, rows: { variable: "n2", initial: 3, max: 4 } });
  validates(built, [slider("n1", 5, 1, 6, 1), slider("n2", 3, 1, 4, 1)]);
  const content = (built.actions[0] as { content: Record<string, any> }).content;
  assert.equal(content.segments.length, 7 + 5);
});

test("the circle area rearranges in 8 and 16 sectors", () => {
  const built = buildCircleAreaRearrangement({ as: "area", role: "main_visual", place, t, radius: 2, progress: { expression: "(n1-0)/(1)", initial: 0 } });
  validates(built, [slider("n1", 0, 0, 1)]);
  assert.deepEqual(built.actions.map((action) => (action as { as: string }).as), ["area", "area-refined"]);
  assert.equal(((built.actions[1] as { content: Record<string, any> }).content.arcs as unknown[]).length, 16);
});

test("every rigid rearrangement construction builds a valid proof figure", () => {
  for (const construction of Object.keys(REARRANGEMENT_CONSTRUCTIONS) as RearrangementConstruction[]) {
    const built = buildGeometricRearrangement({ as: "proof", role: "main_visual", place, construction, legs: { a: 3, b: 2 },
      progress: { expression: "((n1)-(0))/((1)-(0))", initial: 0 } });
    validates(built, [slider("n1", 0, 0, 1)]);
    assert.equal((built.actions[0] as { content: Record<string, any> }).content.title, REARRANGEMENT_CONSTRUCTIONS[construction].title);
  }
  assert.throws(() => buildGeometricRearrangement({ as: "x", role: "r", place, construction: "nope" as RearrangementConstruction, legs: { a: 1, b: 1 } }), /Unsupported/);
});

test("the cube and both surfaces build valid scenes whose section follows a number", async () => {
  const { buildCubeWithSection, buildFunctionSurface, buildImplicitSurface } = await import("../src/index.js");
  const h = slider("n1", 0.5, -1, 1);
  const cube = buildCubeWithSection({ as: "cube", role: "main_visual", place, t, title: "正方体", section: { value: 0.5, variable: "n1" } });
  validates(cube, [h]);
  assert.equal(cube.parts.primary_control, "cube#section");
  const surface = buildFunctionSurface({ as: "surf", role: "main_visual", place, t, title: "曲面", expression: "x^2+y^2",
    x_range: { min: -2, max: 2 }, y_range: { min: -2, max: 2 }, samples: 12, axis: "z", section: { value: 1, variable: "n1" } });
  validates(surface, [slider("n1", 1, 0, 8)]);
  const sphere = buildImplicitSurface({ as: "ball", role: "main_visual", place, t, title: "球面", expression: "x^2+y^2+z^2", level: 1, axis: "z", section: { value: 0 } });
  validates(sphere, []);
  assert.equal(((sphere.actions[0] as { content: Record<string, any> }).content.bindings), undefined);
  assert.throws(() => buildImplicitSurface({ as: "x", role: "r", place, t, title: "x", expression: "x^2+y^2+z^2", level: -1, axis: "z", section: { value: 0 } }), "a sphere of radius² −1 has no points");
});
