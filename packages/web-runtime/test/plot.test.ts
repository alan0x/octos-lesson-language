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


test("zero axes are omitted outside the visible range instead of impersonating frame edges", async () => {
  const {zeroAxisPosition} = await import("../src/plot.js");
  assert.equal(zeroAxisPosition({min:2,max:5}, v=>v*10), undefined);
  assert.equal(zeroAxisPosition({min:-5,max:-2}, v=>v*10), undefined);
  assert.equal(zeroAxisPosition({min:-2,max:5}, v=>100+v*10), 100);
  assert.equal(zeroAxisPosition({min:0,max:5}, v=>20+v*10), 20);
});


test("secant feedback uses mathematical coordinates and rejects coincident points", async () => {
  const {secantMeasurement} = await import("../src/plot.js");
  assert.deepEqual(secantMeasurement({x:1,y:3},{x:4,y:9}),{dx:3,dy:6,slope:2});
  assert.equal(secantMeasurement({x:1,y:1},{x:1,y:1}),undefined);
  assert.equal(secantMeasurement({x:1,y:1},{x:1+1e-12,y:2}),undefined);
  assert.equal(secantMeasurement({x:1,y:1},{x:2,y:Infinity}),undefined);
  assert.equal(secantMeasurement({x:1,y:1},{x:2,y:4})?.slope,3);
  assert.equal(secantMeasurement({x:1,y:1},{x:3,y:9})?.slope,4);
});


test("plot zoom preserves the selected mathematical anchor and pan does not change spans", async () => {
  const {zoomPlotRanges,panPlotRanges}=await import("../src/plot-explorer.js");
  const r={x:{min:-4,max:4},y:{min:-2,max:6}};
  const zoom=zoomPlotRanges(r,.5,{x:.25,y:.75});
  assert.equal(zoom.x.min+(zoom.x.max-zoom.x.min)*.25,-2);
  assert.equal(zoom.y.min+(zoom.y.max-zoom.y.min)*.75,4);
  assert.deepEqual(panPlotRanges(r,2,-1),{x:{min:-2,max:6},y:{min:-3,max:5}});
  assert.deepEqual(zoomPlotRanges(r,Infinity),r);
  assert.deepEqual(r,{x:{min:-4,max:4},y:{min:-2,max:6}});
});
