import test from "node:test";
import assert from "node:assert/strict";
import {
  curveLegendText,
  plotEdgeIndicator,
  PLOT_HEIGHT_BAND,
  plotSurfaceSize,
  compilePlotExpression,
  evaluatePlotExpression,
  extendPlotRanges,
  plotFrame,
  followPlotSamples,
  plotSampleAnimation,
  plotPathData,
  plotSurfaceHeight,
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


test("equal-unit plotting letterboxes both small and enlarged views", async () => {
  const {plotFrame} = await import("../src/plot.js");
  for (const [width,height] of [[300,150],[1000,520]]) {
    const x={min:-2,max:6}, y={min:-2,max:6};
    const frame=plotFrame(width,height,x,y,true);
    assert.equal(frame.width/(x.max-x.min),frame.height/(y.max-y.min));
    assert.ok(frame.left>=30 && frame.right<=width-12);
    assert.ok(frame.top>=10 && frame.bottom<=height-24);
  }
});

test("formatPointLabel dynamically interpolates coordinates and handles static labels", async () => {
  const { formatPointLabel } = await import("../src/plot.js");
  assert.equal(formatPointLabel("截距 (0, {y})", 0, -2), "截距 (0, -2)");
  assert.equal(formatPointLabel("P({x}, {y})", 1.5, 3), "P(1.5, 3)");
  assert.equal(formatPointLabel("点 {coords}", 0, 0), "点 (0, 0)");
  assert.equal(formatPointLabel("A", 0, 1), "A");
  assert.equal(formatPointLabel("", 0, 0), "");
});

test("formatLinearCurveEquation formats linear functions and ignores non-linear curves", async () => {
  const { formatLinearCurveEquation } = await import("../src/plot.js");
  assert.equal(formatLinearCurveEquation("((m)*(x))+(b)", { m: 2, b: -2 }), "y = 2x - 2");
  assert.equal(formatLinearCurveEquation("m * x + b", { m: 1, b: 3 }), "y = x + 3");
  assert.equal(formatLinearCurveEquation("m * x + b", { m: -1, b: 0 }), "y = -x");
  assert.equal(formatLinearCurveEquation("m * x + b", { m: 0, b: 5 }), "y = 5");
  assert.equal(formatLinearCurveEquation("m * x + b", { m: 0, b: 0 }), "y = 0");
  assert.equal(formatLinearCurveEquation("m * x + b", { m: -3, b: -2 }), "y = -3x - 2");
  assert.equal(formatLinearCurveEquation("x^2", {}), undefined);
  assert.equal(formatLinearCurveEquation("sin(x)", {}), undefined);
});

test("equal-unit plot surfaces grow taller from the published range", () => {
  const bounds = { minHeight: 160, maxHeight: 420 };
  // A tall published view (a translated parabola lesson: x span 16, y span 22)
  // clamps at the maximum card height.
  assert.equal(plotSurfaceHeight(404, { min: -8, max: 8 }, { min: -11, max: 11 }, bounds), 420);
  // A balanced view keeps exact unit scale: a 362 px frame width, span ratio 1.
  assert.equal(plotSurfaceHeight(404, { min: -4, max: 4 }, { min: -4, max: 4 }, bounds), 396);
  // A wide-flat view never shrinks below the minimum card height.
  assert.equal(plotSurfaceHeight(404, { min: -15, max: 15 }, { min: -1, max: 1 }, bounds), 160);
  // Degenerate ranges fall back to the minimum height.
  assert.equal(plotSurfaceHeight(404, { min: 1, max: 1 }, { min: 0, max: 1 }, bounds), 160);
});


test("only opted-in plot sample animations temporarily expand the published view", () => {
  const content = { axes: { follow_samples: true }, bindings: [{ target: "plot#point.x", expression: "number_01" }] };
  const animation = { variable: "number_01", to: 5 };
  assert.equal(plotSampleAnimation(content, animation), animation);
  assert.equal(plotSampleAnimation({ ...content, axes: {} }, animation), undefined);
  assert.equal(plotSampleAnimation(content, { variable: "number_02", to: 5 }), undefined);
  const published = { x: { min: -4, max: 4 }, y: { min: -22, max: 8 } };
  const points = [{ x: -1, y: 4 }, { x: 4, y: -21 }];
  const view = followPlotSamples(published, points, { x: 5, y: -32 });
  assert.ok(view.x.max > 5 && view.y.min < -32);
  assert.deepEqual(published, { x: { min: -4, max: 4 }, y: { min: -22, max: 8 } });
  assert.deepEqual(followPlotSamples(published, points, { x: 0, y: 3 }), published);
});

test("adaptive plots fill the frame by extending the short axis at the existing unit scale", () => {
  const tall = { x: { min: -8, max: 8 }, y: { min: -20, max: 15 } };
  const fitted = extendPlotRanges(404, 420, tall);
  const before = plotFrame(404, 420, tall.x, tall.y, true);
  const after = plotFrame(404, 420, fitted.x, fitted.y, true);
  assert.deepEqual(fitted.y, tall.y);
  assert.ok(fitted.x.min < -16 && fitted.x.max > 16);
  assert.ok(Math.abs(after.width - 362) < 1e-9);
  assert.equal(after.height, before.height);
  assert.ok(Math.abs(after.width / (fitted.x.max - fitted.x.min) - before.width / 16) < 1e-9);

  const wide = { x: { min: -15, max: 15 }, y: { min: 3, max: 5 } };
  const fittedWide = extendPlotRanges(404, 160, wide);
  const wideFrame = plotFrame(404, 160, fittedWide.x, fittedWide.y, true);
  assert.deepEqual(fittedWide.x, wide.x);
  assert.equal((fittedWide.y.min + fittedWide.y.max) / 2, 4);
  assert.ok(Math.abs(wideFrame.height - 126) < 1e-9);
});

test("zoom around the extended area keeps the cursor coordinate and stores the unpadded range", async () => {
  const { zoomPlotRanges } = await import("../src/plot-explorer.js");
  const ranges = { x: { min: -8, max: 8 }, y: { min: -20, max: 15 } };
  const fitted = extendPlotRanges(404, 420, ranges);
  const anchor = { x: .9, y: .5 };
  const next = zoomPlotRanges(ranges, .5, anchor, fitted);
  const displayedNext = extendPlotRanges(404, 420, next);
  const xAtAnchor = (range: typeof fitted.x) => range.min + .9 * (range.max - range.min);
  assert.ok(Math.abs(xAtAnchor(fitted.x) - xAtAnchor(displayedNext.x)) < 1e-9);
  assert.equal(next.x.max - next.x.min, 8);
});

test("adaptive sampling keeps fast oscillation smooth and steep curves connected", () => {
  const fast = samplePlotExpression("sin(20*x)", { min: -0.4, max: 0.4 }, { min: -1.2, max: 1.2 }, 241);
  assert.equal(fast.length, 1);
  const peak = Math.max(...fast[0]!.map(point => point.y));
  assert.ok(peak > 0.999, `peak ${peak}`);
  const steep = samplePlotExpression("2^x", { min: -5, max: 5 }, { min: -2, max: 18 }, 241);
  assert.equal(steep.length, 1, "a steep continuous curve is one stroke");
});

test("adaptive sampling breaks only at real poles and reaches domain edges", () => {
  const tangent = samplePlotExpression("tan(x)", { min: -Math.PI, max: Math.PI }, { min: -5, max: 5 }, 241);
  assert.equal(tangent.length, 3);
  // No stroke crosses a pole from above the frame to below it.
  for (const segment of tangent) {
    for (let i = 1; i < segment.length; i += 1) {
      const [a, b] = [segment[i - 1]!.y, segment[i]!.y];
      assert.ok(!(a > 5 && b < -5) && !(a < -5 && b > 5), `crossing at x=${segment[i]!.x}`);
    }
  }
  const root = samplePlotExpression("sqrt(x)", { min: -1, max: 9 }, { min: -0.5, max: 3.5 }, 241);
  assert.equal(root.length, 1);
  assert.ok(root[0]![0]!.x < 1e-6, `starts at ${root[0]![0]!.x}`);
  const reciprocal = samplePlotExpression("1/x", { min: -5, max: 5 }, { min: -4, max: 4 }, 241);
  assert.equal(reciprocal.length, 2);
});

test("legends add the current equation only for curves that sliders change", () => {
  assert.equal(curveLegendText({ label: "y = 0.5x − 100", expression: "0.5*x-100" }), "y = 0.5x − 100");
  assert.equal(curveLegendText({ label: "y = kx + b", expression: "number_01*x+number_02" }, { number_01: 2, number_02: 1 }), "y = kx + b（y = 2x + 1）");
  assert.equal(curveLegendText({ label: "y = kx", expression: "number_01*x" }, { number_01: 2 }, false), "y = kx");
});

test("an off-screen point is marked on the frame edge in its direction", () => {
  const ranges = { x: { min: -4, max: 4 }, y: { min: -2, max: 10 } };
  assert.equal(plotEdgeIndicator({ x: 1, y: 1 }, ranges), undefined);
  const right = plotEdgeIndicator({ x: 9, y: 4 }, ranges)!;
  assert.deepEqual([right.x, right.y], [4, 4]);
  const corner = plotEdgeIndicator({ x: 12, y: 30 }, ranges)!;
  assert.ok(corner.x <= 4 && corner.y <= 10 && (corner.x === 4 || corner.y === 10));
  const above = plotEdgeIndicator({ x: 0, y: 40 }, ranges)!;
  assert.equal(above.y, 10);
});

test("equal-unit card heights stay inside the height band", () => {
  const width = 404;
  const band = { minHeight: Math.round(width * PLOT_HEIGHT_BAND.min), maxHeight: Math.round(width * PLOT_HEIGHT_BAND.max) };
  assert.equal(plotSurfaceHeight(width, { min: -5, max: 5 }, { min: -60, max: 60 }, band), band.maxHeight);
  assert.equal(plotSurfaceHeight(width, { min: -8, max: 8 }, { min: -0.5, max: 4 }, band), band.minHeight);
  const square = plotSurfaceHeight(width, { min: -5, max: 5 }, { min: -5, max: 5 }, band);
  assert.ok(square > band.minHeight && square <= band.maxHeight);
});

test("large views keep plots inside the height band on desktops and phones", () => {
  const sine = { x: { min: -2 * Math.PI, max: 2 * Math.PI }, y: { min: -1.2, max: 1.2 } };
  const phone = plotSurfaceSize({ large: true, adaptive: false, viewport: { width: 390, height: 760 }, ...sine });
  assert.ok(phone.height <= phone.width && phone.height >= phone.width * 0.55, JSON.stringify(phone));
  const parabola = { x: { min: -4, max: 4 }, y: { min: -1, max: 10 } };
  const desktop = plotSurfaceSize({ large: true, adaptive: true, viewport: { width: 1280, height: 800 }, ...parabola });
  assert.ok(desktop.width < 1000, "a tall equal-unit plot narrows instead of stretching x");
  assert.ok(desktop.height <= desktop.width && desktop.height >= desktop.width * 0.55, JSON.stringify(desktop));
  const card = plotSurfaceSize({ large: false, adaptive: false, viewport: { width: 1280, height: 800 }, ...sine });
  assert.deepEqual(card, { width: 404, height: 235 });
});
