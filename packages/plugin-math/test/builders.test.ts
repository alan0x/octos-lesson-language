import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import {
  MATH_BUILDERS,
  MATH_PLUGIN_MANIFEST,
  buildCirclePolygons,
  buildFunctionPlot,
  buildUnitCircle,
  type BuiltRecipe,
} from "../src/index.js";

function lessonWith(built: BuiltRecipe, variables: unknown[]): AuthoringLesson {
  return {
    dsl: "octos.lesson",
    version: "0.1",
    profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Builder check", goals: ["Check the builder output"], variables },
    steps: [{ key: "show", purpose: "Show the recipe", beats: [{ key: "beat", say: "Here it is.", actions: built.actions }] }],
    close: { summary: "That is the recipe.", focus: [built.whole] },
  } as unknown as AuthoringLesson;
}

const theta = { as: "theta", initial: 0, min: 0, max: 2 * Math.PI, label: "θ", unit: "rad", control: { kind: "slider", step: 0.01 } };
const sides = { as: "n1", initial: 6, min: 3, max: 96, label: "sides", control: { kind: "slider", step: 1 } };

test("the manifest names the math plugin and its builders", () => {
  assert.equal(MATH_PLUGIN_MANIFEST.id, "math");
  assert.deepEqual(Object.keys(MATH_BUILDERS).sort(), ["circle_and_arc", "circle_area_rearrangement", "circle_polygon_bounds", "coordinate_circle", "cube_with_section", "function_plot", "function_surface_with_section", "geometric_rearrangement", "implicit_surface_with_section", "rectangle_unit_square_array", "solid_3d", "unit_circle_projection"]);
});

test("a unit circle with a draggable angle validates, alone or with its graph", () => {
  const alone = buildUnitCircle({
    as: "circle-1", role: "diagram", place: { relation: "new_region" },
    angle: { variable: "theta", expression: "theta", initial: 0 },
    text: { point_label: "P", radius_label: "1", foot_label: "" },
  });
  validateAuthoringLesson(lessonWith(alone, [theta]));
  assert.equal(alone.whole, "circle-1");
  assert.equal(alone.parts.moving_point, "circle-1#moving-point");
  assert.equal(alone.parts.primary_control, "circle-1#moving-point");

  const withGraph = buildUnitCircle({
    as: "visual-1", role: "main_visual", place: { relation: "new_region" },
    angle: { variable: "theta", expression: "theta", initial: Math.PI / 3, min: 0, max: 2 * Math.PI },
    text: { title: "Unit circle" },
    graph: { projection: "cos", title: "Cosine graph", link_label: "angle to wave", group_label: "circle and graph" },
  });
  validateAuthoringLesson(lessonWith(withGraph, [theta]));
  assert.deepEqual(withGraph.actions.map((action) => action.do), ["write", "write", "connect", "group"]);
  assert.equal(withGraph.parts.primary_curve, "visual-1-plot#primary-curve");
});

test("a fixed unit circle has no control and no bindings", () => {
  const fixed = buildUnitCircle({ as: "c", role: "diagram", place: { relation: "new_region" }, text: { title: "t" } });
  validateAuthoringLesson(lessonWith(fixed, []));
  const content = (fixed.actions[0] as { content: Record<string, unknown> }).content;
  assert.equal(content.bindings, undefined);
  assert.equal(fixed.parts.primary_control, undefined);
});

test("regular polygons in a circle validate, inscribed alone or with the circumscribed bound", () => {
  const inscribed = buildCirclePolygons({
    as: "poly", role: "diagram", place: { relation: "new_region" }, radius: 1,
    sides: { expression: "n1", initial: 6 }, circumscribed: false, text: { inscribed_label: "regular polygon" },
  });
  validateAuthoringLesson(lessonWith(inscribed, [sides]));
  const inscribedContent = (inscribed.actions[0] as { content: Record<string, any> }).content;
  assert.equal(inscribedContent.regular_polygons.length, 1);
  assert.equal("tone" in inscribedContent.regular_polygons[0], false, "one polygon needs no tone to tell it apart");
  assert.deepEqual(inscribedContent.axes.x, { min: -1.3, max: 1.3, label: "x" });

  const bounds = buildCirclePolygons({
    as: "bounds", role: "main_visual", place: { relation: "new_region" }, radius: 2,
    sides: { expression: "round(n1)", initial: 6, min: 3 }, circumscribed: true,
    text: { title: "Bounds", inscribed_label: "inscribed", circumscribed_label: "circumscribed", caption: "inner < circle < outer" },
  });
  validateAuthoringLesson(lessonWith(bounds, [sides]));
  const content = (bounds.actions[0] as { content: Record<string, any> }).content;
  assert.deepEqual(content.regular_polygons.map((p: { tone: string }) => p.tone), ["primary", "accent"]);
  assert.deepEqual(content.bindings.map((b: { target: string }) => b.target), ["inscribed.sides", "circumscribed.sides"]);
  // The outer polygon fits at the smallest side count: 2 / cos(π/3) * 1.18.
  assert.ok(Math.abs(content.axes.x.max - 4.72) < 1e-9);
});

test("a function plot names its curves and makes sample points follow the primary curve", () => {
  const x = { as: "n1", initial: 1, min: -3, max: 3, label: "x of A", control: { kind: "slider", step: 0.25 } };
  const x2 = { as: "n2", initial: 2, min: -3, max: 3, label: "x of B", control: { kind: "slider", step: 0.25 } };
  const secant = buildFunctionPlot({
    as: "plot", role: "main_visual", place: { relation: "new_region" }, title: "Parabola",
    axes: { x: { min: -3, max: 3, label: "x" }, y: { min: -1, max: 9, label: "y" } },
    curves: [{ expression: "x^2", label: "y = x^2" }, { expression: "x", label: "y = x" }],
    samples: [{ x: 1, y: 1, label: "A", x_expression: "n1" }, { x: 2, y: 4, label: "B", x_expression: "n2" }],
  });
  validateAuthoringLesson(lessonWith(secant, [x, x2]));
  const content = (secant.actions[0] as { content: Record<string, any> }).content;
  assert.deepEqual(content.curves.map((curve: { as: string }) => curve.as), ["primary-curve", "curve-02"]);
  assert.deepEqual(content.bindings, [
    { target: "moving-point.x", expression: "n1" }, { target: "moving-point.y", expression: "n1^2" },
    { target: "second-point.x", expression: "n2" }, { target: "second-point.y", expression: "n2^2" },
  ]);
  assert.equal(content.measurement, "secant");

  const slope = { as: "n1", initial: 2, min: -3, max: 3, label: "k", control: { kind: "slider", step: 0.1 } };
  const references = buildFunctionPlot({
    as: "line", role: "main_visual", place: { relation: "new_region" },
    axes: { x: { min: -3, max: 3 }, y: { min: -9, max: 9 } },
    curves: [{ expression: "n1*x", label: "y = kx" }],
    references: [{ x: 0, y: 0, label: "A" }, { x: 1, y: 2, label: "B" }],
  });
  validateAuthoringLesson(lessonWith(references, [slope]));
  const fixed = (references.actions[0] as { content: Record<string, any> }).content;
  assert.deepEqual(fixed.bindings, [{ target: "reference-a.y", expression: "n1*0" }, { target: "reference-b.y", expression: "n1*1" }]);
  assert.equal(fixed.sample_input, "fixed_x");
});

test("a sample point at a compound x stays on the curve, and the builder names every curve", () => {
  const plot = buildFunctionPlot({
    as: "p", role: "diagram", place: { relation: "new_region" }, axes: { x: { min: -3, max: 3 }, y: { min: 0, max: 9 } },
    curves: [{ as: "custom", expression: "x^2", label: "y = x^2" }],
    samples: [{ x: 3, y: 9, label: "P", x_expression: "theta+1" }],
    references: [],
  });
  const content = (plot.actions[0] as { content: Record<string, any> }).content;
  assert.equal(content.bindings[1].expression, "(theta+1)^2");
  assert.equal(content.curves[0].as, "primary-curve");
  assert.equal(plot.parts.primary_curve, "p#primary-curve");
  const negative = buildFunctionPlot({ as: "q", role: "diagram", place: { relation: "new_region" }, axes: {},
    curves: [{ expression: "x^2", label: "" }], references: [{ x: -1, y: 1, label: "A" }] });
  assert.equal((negative.actions[0] as { content: Record<string, any> }).content.bindings[0].expression, "(-1)^2");
});
