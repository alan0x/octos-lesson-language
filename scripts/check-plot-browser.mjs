// Browser checks for the function plot's decision 0018 parts, with the runtime's own stylesheet:
// - pieces of a piecewise function: each drawn only on its interval, a filled dot at a closed end and a
//   ring at an open one (the filled dot wins where they meet), no dot where the piece has no finite end,
//   one legend entry for the function;
// - intervals on the axes (domain, range): bar, closed or open ends, arrowheads for unbounded ends, on
//   the zero axis or the frame edge when 0 is outside the window; a range that flips with the sign of a;
// - marks hidden while undefined: a symmetry axis at a = 0, x-intercepts that appear as k falls;
// - the slope triangle: legs named Δx and Δy, "斜率" on a straight line, "割线斜率" on a curve; it stays
//   when mark points (intercepts) follow the two references; leg labels stay inside the frame;
// - coinciding marks keep readable labels: no two overlap, and two identical labels at one spot draw once.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";

const lesson = (content, extra = {}, beats = []) => ({
  dsl: "octos.lesson", version: "0.1", profile: "authoring",
  lesson: { mode: "explain", language: "zh-CN", title: "图", goals: ["看图"], ...extra },
  steps: [{ key: "s", purpose: "看", beats: [{ key: "b", say: "看这张图。", actions: [
    { do: "write", as: "graph", kind: "plot", role: "main_visual", content, place: { relation: "new_region" } },
  ] }, ...beats] }],
  close: { summary: "完。", focus: ["graph"] },
});
const host = (lessonId) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
const animate = (key, variable, value) => ({ key, say: "看。", actions: [{ do: "animate", variable, value }] });
const axes = (x0, x1, y0, y1) => ({ x: { min: x0, max: x1 }, y: { min: y0, max: y1 } });
const a = [{ as: "a", initial: 1, min: -2, max: 2, label: "a" }];
const cases = {
  jump: lesson({ axes: axes(-4, 4, -3, 4), curves: [
    { as: "left", expression: "x + 1", to: 0, to_closed: false, series: "f", label: "x + 1（x < 0）" },
    { as: "right", expression: "2", from: 0, from_closed: true, series: "f", label: "2（x ≥ 0）" }] }),
  join: lesson({ axes: axes(-3, 4, -2, 3), curves: [
    { as: "left", expression: "x", to: 1, to_closed: true, series: "g" },
    { as: "right", expression: "1", from: 1, from_closed: false, series: "g" },
    { as: "other", expression: "x - 2" }] }),
  pole: lesson({ axes: axes(-3, 4, -5, 5), curves: [
    { as: "left", expression: "-1", to: 0, to_closed: true, series: "h" },
    { as: "right", expression: "1/x", from: 0, from_closed: false, series: "h" }] }),
  root: lesson({ axes: axes(-2, 8, -1, 4), curves: [{ as: "f", expression: "sqrt(x)" }], intervals: [
    { as: "dom", axis: "x", from: 0, to: null, from_closed: true, label: "定义域" }, { as: "ran", axis: "y", from: 0, to: null, from_closed: true, label: "值域" }] }),
  pointed: lesson({ axes: axes(-2, 8, -1, 4), curves: [{ as: "f", expression: "sqrt(x)" }], intervals: [
    { as: "dom", axis: "x", from: 0, to: null, from_closed: true, label: "定义域" }] }, {},
  [{ key: "show-domain", say: "定义域在这里。", actions: [{ do: "emphasize", target: "graph#dom", emphasis: "focus" }, { do: "point", target: "graph#dom" }] }]),
  edge: lesson({ axes: axes(2, 10, 1, 5), curves: [{ as: "f", expression: "sqrt(x - 3) + 2" }], intervals: [
    { as: "dom", axis: "x", from: 3, to: null, from_closed: true }, { as: "ran", axis: "y", from: 2, to: null, from_closed: true }] }),
  reciprocal: lesson({ axes: axes(-3, 7, -4, 6), curves: [{ as: "f", expression: "1/(x - 2) + 1" }], intervals: [
    { as: "d1", axis: "x", from: null, to: 2, to_closed: false }, { as: "d2", axis: "x", from: 2, to: null, from_closed: false },
    { as: "r1", axis: "y", from: null, to: 1, to_closed: false }, { as: "r2", axis: "y", from: 1, to: null, from_closed: false }] }),
  flip: lesson({ axes: axes(-3, 5, -5, 6), curves: [{ as: "f", expression: "a*(x - 1)^2 + 1" }],
    intervals: [{ as: "up", axis: "y", from: 1, to: null, from_closed: true }, { as: "down", axis: "y", from: null, to: 1, to_closed: true }],
    bindings: [{ target: "up.from", expression: "1 + 0*log(a)", hide_when_undefined: true }, { target: "down.to", expression: "1 + 0*log(-a)", hide_when_undefined: true }] },
  { variables: a }, [animate("zero", "a", 0), animate("down", "a", -1)]),
  symmetry: lesson({ axes: axes(-4, 4, -5, 5), curves: [{ as: "f", expression: "a*x^2 + 2*x" }],
    guides: [{ as: "sym", kind: "vertical_line", value: -1, label: "对称轴" }], points: [{ as: "v", x: -1, y: -1, label: "顶点" }],
    bindings: [{ target: "sym.value", expression: "-1/a", hide_when_undefined: true }, { target: "v.x", expression: "-1/a", hide_when_undefined: true }, { target: "v.y", expression: "-1/a", hide_when_undefined: true }] },
  { variables: a }, [animate("zero", "a", 0), animate("down", "a", -1)]),
  roots: lesson({ axes: axes(-4, 4, -3, 4), curves: [{ as: "f", expression: "x^2 + k" }],
    points: [{ as: "r1", x: 0, y: 0, label: "x 截距" }, { as: "r2", x: 0, y: 0, label: "x 截距" }],
    bindings: [{ target: "r1.x", expression: "-sqrt(-k)", hide_when_undefined: true }, { target: "r2.x", expression: "sqrt(-k)", hide_when_undefined: true }] },
  { variables: [{ as: "k", initial: 2, min: -3, max: 3, label: "k" }] }, [animate("fall", "k", -2)]),
  line: lesson({ axes: axes(-2, 4, -6, 6), curves: [{ as: "primary-curve", expression: "2*x - 3" }], measurement: "secant", sample_input: "fixed_x",
    points: [{ as: "reference-a", x: 0, y: -3, label: "A" }, { as: "reference-b", x: 2, y: 1, label: "B" }],
    bindings: [{ target: "reference-a.y", expression: "2*0 - 3" }, { target: "reference-b.y", expression: "2*2 - 3" }] }),
  curve: lesson({ axes: axes(-2, 4, -6, 6), curves: [{ as: "primary-curve", expression: "x^2/2 - 3" }], measurement: "secant", sample_input: "fixed_x",
    points: [{ as: "reference-a", x: 0, y: -3, label: "A" }, { as: "reference-b", x: 2, y: -1, label: "B" }],
    bindings: [{ target: "reference-a.y", expression: "0^2/2 - 3" }, { target: "reference-b.y", expression: "2^2/2 - 3" }] }),
  // A tangent line drawn before the parabola the points sample: the readout follows the parabola.
  tangent: lesson({ axes: axes(-2, 4, -6, 6), curves: [{ as: "tangent-line", expression: "2*x - 5" }, { as: "primary-curve", expression: "x^2/2 - 3" }], measurement: "secant", sample_input: "fixed_x",
    points: [{ as: "reference-a", x: 0, y: -3, label: "A" }, { as: "reference-b", x: 2, y: -1, label: "B" }],
    bindings: [{ target: "reference-a.y", expression: "0^2/2 - 3" }, { target: "reference-b.y", expression: "2^2/2 - 3" }] }),
  // y = 0.3x sampled at 1 and 3 (0.6 / 2 computes as 0.29999999999999993): the computed rise has rounding noise, the slope is still exactly 0.3.
  tenths: lesson({ axes: axes(-2, 4, -6, 6), curves: [{ as: "primary-curve", expression: "0.3*x" }], measurement: "secant", sample_input: "fixed_x",
    points: [{ as: "reference-a", x: 1, y: 0.3, label: "A" }, { as: "reference-b", x: 3, y: 0.9, label: "B" }],
    bindings: [{ target: "reference-a.y", expression: "0.3*1" }, { target: "reference-b.y", expression: "0.3*3" }] }),
  marks: lesson({ axes: axes(-2, 4, -6, 6), curves: [{ as: "primary-curve", expression: "m*x + c" }], measurement: "secant", sample_input: "fixed_x",
    points: [{ as: "reference-a", x: 0, y: -3, label: "A" }, { as: "reference-b", x: 1, y: -1, label: "B" }, { as: "yi", x: 0, y: -3, label: "y 截距" }, { as: "xi", x: 1.5, y: 0, label: "x 截距" }],
    bindings: [{ target: "reference-a.y", expression: "m*0 + c" }, { target: "reference-b.y", expression: "m*1 + c" }, { target: "yi.y", expression: "c" }, { target: "xi.x", expression: "-c/m", hide_when_undefined: true }] },
  { variables: [{ as: "m", initial: 2, min: -3, max: 3, label: "m" }, { as: "c", initial: -3, min: -4, max: 4, label: "c" }] }, [animate("tilt", "m", -1.5)]),
  offscreen: lesson({ axes: axes(-2, 4, -6, 6), curves: [{ as: "primary-curve", expression: "3*x - 3" }], measurement: "secant", sample_input: "fixed_x",
    points: [{ as: "reference-a", x: 1, y: 0, label: "A" }, { as: "reference-b", x: 4, y: 9, label: "B" }],
    bindings: [{ target: "reference-a.y", expression: "3*1 - 3" }, { target: "reference-b.y", expression: "3*4 - 3" }] }),
  double: lesson({ axes: axes(-3, 3, -2, 4), curves: [{ as: "f", expression: "(x - h)^2" }],
    points: [{ as: "r1", x: 0, y: 0, label: "x 截距" }, { as: "r2", x: 0, y: 0, label: "x 截距" }, { as: "v", x: 0, y: 0, label: "顶点" }],
    bindings: [{ target: "r1.x", expression: "h" }, { target: "r2.x", expression: "h" }, { target: "v.x", expression: "h" }] },
  { variables: [{ as: "h", initial: 0, min: -2, max: 2, label: "h" }] }),
};
const events = Object.fromEntries(Object.entries(cases).map(([name, authored]) => [name, normalizeAuthoringLesson(authored, host(name))]));

const bundle = await build({
  stdin: { contents: `
    import "./packages/web-runtime/styles.css";
    import { mountInfiniteBoard } from "./packages/web-runtime/src/board-view.ts";
    import { BrowserLessonSession, LocalPlaybackStore } from "./packages/web-runtime/src/runtime.ts";
    Object.assign(window, { mountInfiniteBoard, BrowserLessonSession, LocalPlaybackStore });
  `, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "esm", platform: "browser", write: false, outdir: "/out",
  loader: { ".woff2": "empty", ".woff": "empty", ".ttf": "empty", ".svg": "text" },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).contents;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.contents ?? "";
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/probe.js" ? "text/javascript" : request.url === "/probe.css" ? "text/css" : "text/html");
  response.end(request.url === "/probe.js" ? js : request.url === "/probe.css" ? css
    : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/probe.css"><div id="board" style="position:relative;width:1000px;height:600px"></div><script type="module" src="/probe.js"></script>');
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const executablePath = process.env.OLL_CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => existsSync(path));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);
  // Every state of a lesson, measured in plot coordinates (the axes' own mapping, read from the grid).
  const states = (name) => page.evaluate(({ events, name }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), name);
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const seen = [];
    while (session.projection.status !== "completed") {
      session.advance();
      mounted.view.render(session.projection.board);
      const svg = document.querySelector(".plot-preview");
      if (!svg) continue;
      const node = Object.values(session.projection.board.nodes).find((item) => item.kind === "plot");
      const { x, y } = node.content.axes;
      const box = svg.viewBox.baseVal;
      // Recover the plot frame from the clip rectangle.
      const clip = svg.querySelector("clipPath rect");
      const left = Number(clip.getAttribute("x")), top = Number(clip.getAttribute("y"));
      const right = left + Number(clip.getAttribute("width")), bottom = top + Number(clip.getAttribute("height"));
      const toX = (px) => x.min + (px - left) / (right - left) * (x.max - x.min);
      const toY = (py) => y.min + (bottom - py) / (bottom - top) * (y.max - y.min);
      const dots = (selector) => [...svg.querySelectorAll(selector)].map((dot) => ({ x: toX(Number(dot.getAttribute("cx"))), y: toY(Number(dot.getAttribute("cy"))), index: [...svg.querySelectorAll("*")].indexOf(dot) }));
      const paths = [...svg.querySelectorAll(".plot-curve")].map((path) => {
        const numbers = (path.getAttribute("d").match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
        const xs = numbers.filter((_, i) => i % 2 === 0);
        return { min: toX(Math.min(...xs)), max: toX(Math.max(...xs)), series: [...path.classList].find((c) => c.startsWith("plot-series-")) };
      });
      const bars = [...svg.querySelectorAll(".plot-interval")].map((group) => {
        const bar = group.querySelector("line.plot-interval-bar");
        return {
          id: group.dataset.id.split(":").at(-1),
          focused: group.classList.contains("emphasis-focus"),
          bar: bar ? [bar.x1, bar.y1, bar.x2, bar.y2].map((a) => a.baseVal.value) : null,
          closed: group.querySelectorAll(".plot-interval-end-closed").length,
          open: group.querySelectorAll(".plot-interval-end-open").length,
          arrows: [...group.querySelectorAll(".plot-interval-arrow")].map((arrow) => arrow.getAttribute("d").split(" ")[0]),
        };
      });
      seen.push({
        variables: Object.fromEntries(Object.entries(session.projection.board.variables ?? {}).map(([k, v]) => [k, v.value])),
        frame: { left, right, top, bottom, zeroY: y.min <= 0 && y.max >= 0 ? bottom - (0 - y.min) / (y.max - y.min) * (bottom - top) : undefined, zeroX: x.min <= 0 && x.max >= 0 ? left + (0 - x.min) / (x.max - x.min) * (right - left) : undefined },
        paths, closed: dots(".plot-curve-end"), rings: dots(".plot-hole"), bars,
        guides: svg.querySelectorAll(".plot-guide:not([clip-path])").length,
        points: svg.querySelectorAll(".plot-point").length,
        legend: [...document.querySelectorAll(".plot-legend-item")].map((item) => ({ text: item.textContent, checkbox: Boolean(item.querySelector("input")) })),
        legs: [...svg.querySelectorAll(".plot-leg-label")].map((label) => label.textContent),
        labels: [...svg.querySelectorAll(".plot-label, .plot-leg-label")].map((label) => { const b = label.getBBox(); return { text: label.textContent, x: b.x, right: b.x + b.width, y: b.y, bottom: b.y + b.height }; }),
        legLabelsInFrame: [...svg.querySelectorAll(".plot-leg-label")].every((label) => { const b = label.getBBox(); return b.x >= left - 1 && b.x + b.width <= right + 40 && b.y >= top - 1 && b.y + b.height <= bottom + 14; }),
        secant: svg.querySelectorAll(".plot-secant").length,
        readout: document.querySelector(".board-node")?.innerText ?? "",
        box: [box.width, box.height],
      });
    }
    return seen;
  }, { events: events[name], name });
  const near = (a, b, tolerance = 0.05) => Math.abs(a - b) <= tolerance;
  const at = (list, x, y) => list.find((dot) => near(dot.x, x) && near(dot.y, y));

  const [jump] = await states("jump");
  check(jump.paths.length === 2 && jump.paths[0].max <= 0.01 && jump.paths[1].min >= -0.01, `each piece is drawn only on its interval: ${JSON.stringify(jump.paths)}`);
  check(jump.paths[0].series === jump.paths[1].series, "the pieces of one function share a colour");
  check(at(jump.closed, 0, 2) && at(jump.rings, 0, 1) && jump.closed.length === 1 && jump.rings.length === 1, `a jump: filled dot at (0, 2), ring at (0, 1): ${JSON.stringify([jump.closed, jump.rings])}`);
  check(jump.legend.length === 1 && !jump.legend[0].checkbox && jump.legend[0].text.includes("x + 1（x < 0）") && jump.legend[0].text.includes("2（x ≥ 0）"), `one legend entry for the function: ${JSON.stringify(jump.legend)}`);
  const [join] = await states("join");
  const filled = at(join.closed, 1, 1), ring = at(join.rings, 1, 1);
  check(filled && ring && filled.index > ring.index, `where an open end meets a closed one the filled dot is drawn over the ring: ${JSON.stringify([join.closed, join.rings])}`);
  check(join.legend.length === 2 && join.legend.every((item) => item.checkbox), `the function and the other curve are two legend entries: ${JSON.stringify(join.legend)}`);
  const [pole] = await states("pole");
  check(pole.rings.length === 0 && at(pole.closed, 0, -1) && pole.closed.length === 1, `no ring where a piece has no finite end (1/x at 0): ${JSON.stringify([pole.closed, pole.rings])}`);

  const [root] = await states("root");
  const dom = root.bars.find((bar) => bar.id === "dom"), ran = root.bars.find((bar) => bar.id === "ran");
  check(dom && near(dom.bar[1], root.frame.zeroY, 0.5) && near(dom.bar[3], root.frame.zeroY, 0.5) && dom.closed === 1 && dom.open === 0 && dom.arrows.length === 1, `the domain [0, ∞) lies on the x-axis, closed at 0, arrow at the right: ${JSON.stringify(dom)}`);
  check(ran && near(ran.bar[0], root.frame.zeroX, 0.5) && ran.closed === 1 && ran.arrows.length === 1, `the range [0, ∞) lies on the y-axis: ${JSON.stringify(ran)}`);
  const pointed = await states("pointed");
  check(!pointed[0].bars[0].focused && pointed.at(-1).bars[0].focused, `a lesson can emphasize an axis interval (graph#dom): ${pointed.map((state) => state.bars[0]?.focused).join(" → ")}`);
  const [edge] = await states("edge");
  const edgeDom = edge.bars.find((bar) => bar.id === "dom"), edgeRan = edge.bars.find((bar) => bar.id === "ran");
  check(edgeDom && near(edgeDom.bar[1], edge.frame.bottom, 0.5) && edgeRan && near(edgeRan.bar[0], edge.frame.left, 0.5), `with 0 outside the window the bars lie on the frame's bottom and left edges: ${JSON.stringify([edgeDom, edgeRan, edge.frame])}`);
  const [reciprocal] = await states("reciprocal");
  check(reciprocal.bars.length === 4 && reciprocal.bars.every((bar) => bar.open === 1 && bar.closed === 0 && bar.arrows.length === 1), `x ≠ 2 and y ≠ 1: two bars per axis, open at the gap, arrows outward: ${JSON.stringify(reciprocal.bars)}`);

  const flip = await states("flip");
  const shown = (state) => state.bars.map((bar) => bar.id).join(" ");
  const byA = new Map(flip.map((state) => [state.variables.a, shown(state)]));
  check(byA.get(1) === "up" && byA.get(0) === "" && byA.get(-1) === "down", `the range bar follows the sign of a, hidden at a = 0: ${JSON.stringify([...byA])}`);
  const symmetry = await states("symmetry");
  const hiddenMarks = new Map(symmetry.map((state) => [state.variables.a, [state.guides, state.points]]));
  check(JSON.stringify(hiddenMarks.get(1)) === "[1,1]" && JSON.stringify(hiddenMarks.get(0)) === "[0,0]" && JSON.stringify(hiddenMarks.get(-1)) === "[1,1]", `the symmetry axis and vertex hide while a = 0: ${JSON.stringify([...hiddenMarks])}`);
  const roots = await states("roots");
  check(roots[0].points === 0 && roots.at(-1).points === 2, `x-intercepts start hidden and appear once the parabola crosses the axis: ${roots.map((state) => state.points).join(" → ")}`);

  const [line] = await states("line");
  check(line.legs.join(" ") === "Δx Δy", `the slope triangle's legs are named: ${line.legs.join(" ")}`);
  check(line.readout.includes("斜率 = 2") && !line.readout.includes("割线"), `a straight line reads "斜率", not "割线斜率": ${line.readout.replace(/\s+/gu, " ")}`);
  const [curve] = await states("curve");
  check(curve.readout.includes("割线斜率 ≈ 1"), `a curve keeps "割线斜率": ${curve.readout.replace(/\s+/gu, " ")}`);
  const [tangent] = await states("tangent");
  check(tangent.readout.includes("割线斜率 ≈ 1"), `points on a parabola drawn after a line keep "割线斜率": ${tangent.readout.replace(/\s+/gu, " ")}`);
  const [tenths] = await states("tenths");
  check(tenths.readout.includes("斜率 = 0.3") && !tenths.readout.includes("割线"), `rounding noise does not turn "=" into "≈": ${tenths.readout.replace(/\s+/gu, " ")}`);
  const overlapping = (state) => state.labels.filter((a, i) => state.labels.some((b, j) => j < i && a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5)).map((label) => label.text);
  const marks = await states("marks");
  for (const state of marks) {
    check(state.secant === 1 && state.legs.join(" ") === "Δx Δy" && /斜率 = /u.test(state.readout), `with intercept marks after A and B the slope triangle stays (m = ${state.variables.m}): ${state.secant} secant, legs ${state.legs.join(" ")}`);
    check(overlapping(state).length === 0, `a y-intercept on A: no labels overlap (m = ${state.variables.m}): ${overlapping(state).join(", ")} ${JSON.stringify(state.labels)}`);
  }
  const [offscreen] = await states("offscreen");
  check(offscreen.legLabelsInFrame && !offscreen.legs.includes("Δy"), `a leg whose label spot is off the frame is left unnamed: ${offscreen.legs.join(" ")}`);
  const [double] = await states("double");
  check(double.labels.filter((label) => label.text === "x 截距").length === 1 && double.labels.some((label) => label.text === "顶点") && overlapping(double).length === 0, `a double root under the vertex: one "x 截距", one "顶点", apart: ${JSON.stringify(double.labels)}`);
  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("plot browser checks passed: pieces on their intervals with filled and open ends, one legend entry per function, domain and range bars on the axes and frame edges, a range that flips with a, hidden symmetry axis and intercepts, named slope legs, slope wording, the triangle kept beside marks, leg labels inside the frame, coinciding marks labelled apart");
