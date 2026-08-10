import test from "node:test";
import assert from "node:assert/strict";
import {
  compilePlotExpression,
  evaluatePlotExpression,
  plotPathData,
  samplePlotExpression,
} from "../src/plot.js";

test("restricted plot expressions evaluate trigonometric and polynomial functions", () => {
  assert.ok(Math.abs(evaluatePlotExpression("sin(x)", Math.PI / 2) - 1) < 1e-12);
  assert.ok(Math.abs(evaluatePlotExpression("y = cos(x)", Math.PI) + 1) < 1e-12);
  assert.equal(evaluatePlotExpression("(x+3)^2-4", -3), -4);
  assert.equal(evaluatePlotExpression("-x^2", 3), -9);
  assert.equal(evaluatePlotExpression("sin(π/2)", 0), 1);
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
