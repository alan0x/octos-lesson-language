import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import {
  MATH_BUILDERS,
  MATH_PLUGIN_MANIFEST,
  buildCirclePolygons,
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
  assert.deepEqual(Object.keys(MATH_BUILDERS).sort(), ["circle_polygon_bounds", "unit_circle_projection"]);
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
