import test from "node:test";
import assert from "node:assert/strict";
import {
  compilePlotExpression,
  evaluatePlotExpression,
  plotPathData,
  referencedPlotVariables,
  sampleImplicitPlotExpression,
  samplePlotExpression,
} from "../src/plot.js";

test("plot invalidation tracks only variables actually used by a curve", () => {
  assert.deepEqual(
    referencedPlotVariables(
      ["(x-number_01)^2+number_02", "sin(x)"],
      { number_01: 2, number_02: -1, unrelated: 99 },
    ),
    { number_01: 2, number_02: -1 },
  );
});

test("restricted plot expressions evaluate trigonometric and polynomial functions", () => {
  assert.ok(Math.abs(evaluatePlotExpression("sin(x)", Math.PI / 2) - 1) < 1e-12);
  assert.ok(Math.abs(evaluatePlotExpression("y = cos(x)", Math.PI) + 1) < 1e-12);
  assert.equal(evaluatePlotExpression("(x+3)^2-4", -3), -4);
  assert.equal(evaluatePlotExpression("-x^2", 3), -9);
  assert.equal(evaluatePlotExpression("sin(π/2)", 0), 1);
});

test("plot expressions read lesson variables when sampling a changing curve", () => {
  assert.equal(
    evaluatePlotExpression("(x-number_01)^2+number_02", 2, {
      number_01: 2,
      number_02: -1,
    }),
    -1,
  );
  const shifted = samplePlotExpression(
    "(x-number_01)^2+number_02",
    { min: -4, max: 4 },
    { min: -2, max: 10 },
    9,
    { number_01: 2, number_02: -1 },
  );
  const vertex = shifted.flat().find((point) => point.x === 2);
  assert.deepEqual(vertex, { x: 2, y: -1 });
});

test("plot expression parser rejects executable or unknown syntax", () => {
  assert.throws(() => compilePlotExpression("globalThis.alert(1)"), /Unsupported token|Unsupported function|Unexpected token/);
  assert.throws(() => compilePlotExpression("x.constructor"), /Unsupported token/);
  assert.throws(() => compilePlotExpression("mystery(x)"), /Unsupported function/);
});

test("curve sampling follows the requested expression and splits discontinuities", () => {
  const sine = samplePlotExpression(
    "sin(x)",
    { min: 0, max: Math.PI * 2 },
    { min: -1.2, max: 1.2 },
    101,
  );
  assert.equal(sine.length, 1);
  assert.ok(Math.abs(sine[0]![25]!.y - 1) < 1e-12);

  const tangent = samplePlotExpression(
    "tan(x)",
    { min: -Math.PI, max: Math.PI },
    { min: -2, max: 2 },
    241,
  );
  assert.ok(tangent.length >= 3, "asymptotes should not be connected by vertical strokes");
});

test("sampled curves produce SVG path data in plot coordinates", () => {
  const segments = samplePlotExpression("x", { min: -1, max: 1 }, { min: -1, max: 1 }, 3);
  assert.equal(
    plotPathData(segments, (value) => value * 10, (value) => 100 - value * 10),
    "M -10.00 110.00 L 0.00 100.00 L 10.00 90.00",
  );
});

test("implicit plot sampling draws equations that cannot be written as one y=f(x)", () => {
  const segments = sampleImplicitPlotExpression(
    "x^2+y^2-1",
    { min: -1.5, max: 1.5 },
    { min: -1.5, max: 1.5 },
    { samples: 80 },
  );
  assert.ok(segments.length > 100);
  const points = segments.flat();
  assert.ok(Math.min(...points.map((point) => point.x)) < -.99);
  assert.ok(Math.max(...points.map((point) => point.x)) > .99);
  assert.ok(Math.min(...points.map((point) => point.y)) < -.99);
  assert.ok(Math.max(...points.map((point) => point.y)) > .99);
});

test("implicit plot expressions can also read lesson variables", () => {
  const segments = sampleImplicitPlotExpression(
    "x^2+y^2-radius^2",
    { min: -3, max: 3 },
    { min: -3, max: 3 },
    { samples: 80, variables: { radius: 2 } },
  );
  assert.ok(segments.length > 100);
  assert.ok(Math.min(...segments.flat().map((point) => point.x)) < -1.95);
  assert.ok(Math.max(...segments.flat().map((point) => point.x)) > 1.95);
});
