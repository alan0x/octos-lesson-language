// Browser checks for decision 0019's render work, with the runtime's own stylesheet:
// - two solids side by side (a cone beside a cylinder of the same base and height): both drawn, apart,
//   framed inside the scene (that they stand on one floor is checked in 3D by the plugin's tests);
// - the measures line under the scene (computed by buildSolid): shown, one line per solid, inside the card;
// - one plane cuts both solids, so a slider moves one section through the pair;
// - both nets open together;
// - two boxes side by side (an L shape): both drawn, their bottoms level;
// - a solid alone builds and draws as before, with no measures line.
// Screenshots go to OLL_SOLIDS_SCREENSHOTS when it is set.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { buildSolid, describeSolid } from "../dist/packages/plugin-math/src/index.js";

const place = { relation: "new_region" };
const slider = (as, min, max, initial = min) => ({ as, initial, min, max, label: as, control: { kind: "slider", step: 0.02 } });
const animate = (key, variable, value) => ({ key, say: "Look.", actions: [{ do: "animate", variable, value }] });
const lesson = (built, variables = [], beats = [], language = "en-US") => ({
  dsl: "octos.lesson", version: "0.1", profile: "authoring",
  lesson: { mode: "explain", language, title: "Solids", goals: ["Look at the solids"], variables },
  steps: [{ key: "s", purpose: "Look", beats: [{ key: "b", say: "Here they are.", actions: built.actions }, ...beats] }],
  close: { summary: "Done.", focus: [built.whole] },
});
const host = (lessonId) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
const cone = { shape: "cone", radius: 3, height: 4 };
const cylinder = { shape: "cylinder", radius: 3, height: 4 };
const lShape = { shape: "composite", parts: "two_boxes", size: { x: 4, y: 3, z: 2 }, sideSize: { x: 2, y: 3, z: 5 } };
const scene = (solid, extra = {}) => buildSolid({ as: "scene", role: "main_visual", place, solid, ...extra,
  fallback: [solid, extra.beside].filter(Boolean).map((each) => describeSolid(each, "en-US")).join(" ") });
const cases = {
  pair: lesson(scene(cone, { beside: cylinder, show: { measures: ["volume"], language: "en-US" } })),
  pairZh: lesson(scene({ shape: "box", size: { x: 4, y: 4, z: 4 } }, { beside: { shape: "sphere", radius: 1 }, show: { measures: ["volume", "surface_area"], language: "zh-CN" } }), [], [], "zh-CN"),
  cut: lesson(scene(cone, { beside: cylinder, cut: { expression: "h" } }), [slider("h", -2, 2, 0)], [animate("low", "h", -1.5), animate("high", "h", 1.5)]),
  unfold: lesson(scene({ shape: "box", size: { x: 2, y: 2, z: 2 } }, { beside: { shape: "cylinder", radius: 1, height: 2 }, unfold: { expression: "u" } }), [slider("u", 0, 1)], [animate("open", "u", 1)]),
  lShape: lesson(scene(lShape, { show: { measures: ["volume"], language: "en-US" } })),
  alone: lesson(scene(cone)),
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
    : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/probe.css"><div id="board" style="position:relative;width:1000px;height:700px"></div><script type="module" src="/probe.js"></script>');
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const executablePath = process.env.OLL_CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => existsSync(path));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const shots = process.env.OLL_SOLIDS_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);
  // Every state of a lesson: each object's drawn box (screen pixels), the sections, the caption.
  const states = async (name) => {
    const seen = await page.evaluate(({ events, name }) => {
      document.querySelector("#board").replaceChildren();
      const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), name);
      const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
      const seen = [];
      // A lesson that fails part-way never completes: stop after a bound and report it.
      for (let step = 0; session.projection.status !== "completed"; step += 1) {
        if (step > 200) { seen.push({ stuck: session.projection.status }); break; }
        session.advance();
        mounted.view.render(session.projection.board);
        const svg = document.querySelector(".scene3d-runtime svg");
        if (!svg) continue;
        const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const union = (rects) => rects.length ? { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)), top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) } : null;
        const objects = {};
        for (const element of svg.querySelectorAll(".scene3d-face, .scene3d-facet")) {
          const id = String(element.dataset.scene3dObjectId ?? element.dataset.id).split(":").at(-1);
          (objects[id] ??= []).push(rect(element));
        }
        const card = document.querySelector(".board-node");
        const caption = document.querySelector(".scene3d-caption");
        seen.push({
          variables: Object.fromEntries(Object.entries(session.projection.board.variables ?? {}).map(([k, v]) => [k, v.value])),
          svg: rect(svg),
          objects: Object.fromEntries(Object.entries(objects).map(([id, rects]) => [id, union(rects)])),
          intersections: [...svg.querySelectorAll(".scene3d-intersection")].map((path) => String(path.dataset.targetId).split(":").at(-1)),
          caption: caption ? { text: caption.innerText, box: rect(caption), lines: caption.innerText.split("\n").length } : null,
          card: card ? rect(card) : null,
        });
      }
      return seen;
    }, { events: events[name], name });
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
    return seen;
  };
  const inside = (inner, outer, slack = 1) => inner && outer && inner.left >= outer.left - slack && inner.right <= outer.right + slack && inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack;

  const [pair] = await states("pair");
  const pairCone = pair.objects.solid, pairCylinder = pair.objects.beside;
  check(pairCone && pairCylinder, `both solids are drawn: ${JSON.stringify(Object.keys(pair.objects))}`);
  const middle = (box) => (box.left + box.right) / 2;
  check(pairCone && pairCylinder && pairCone.right < middle(pairCylinder) && middle(pairCone) < pairCylinder.left, `the cone stands left of the cylinder, apart: ${JSON.stringify([pairCone, pairCylinder])}`);
  check(inside(pairCone, pair.svg) && inside(pairCylinder, pair.svg), `the camera frames both: ${JSON.stringify([pair.svg, pairCone, pairCylinder])}`);
  check(pair.caption?.text === "Cone: Volume = 12π ≈ 37.70\nCylinder: Volume = 36π ≈ 113.10" && pair.caption.lines === 2, `the measures line, one line per solid: ${JSON.stringify(pair.caption)}`);
  check(pair.caption && pair.caption.box.top >= pair.svg.bottom - 1 && inside(pair.caption.box, pair.card), `the measures line sits under the scene, inside the card: ${JSON.stringify([pair.caption?.box, pair.svg, pair.card])}`);

  const [pairZh] = await states("pairZh");
  check(pairZh.caption?.text === "正方体：体积 = 64；表面积 = 96\n球：体积 = 4π/3 ≈ 4.19；表面积 = 4π ≈ 12.57" && inside(pairZh.caption.box, pairZh.card), `Chinese measures line, inside the card: ${JSON.stringify(pairZh.caption)}`);
  check(inside(pairZh.objects.solid, pairZh.svg) && inside(pairZh.objects.beside, pairZh.svg), `a cube and a small sphere, both framed: ${JSON.stringify(pairZh.objects)}`);

  const cut = await states("cut");
  check(!cut.some((state) => state.stuck), "the cut lesson plays through");
  for (const state of cut.filter((each) => !each.stuck)) {
    check(state.intersections.includes("solid") && state.intersections.includes("beside"), `one plane cuts both solids (h = ${state.variables.h}): ${state.intersections.join(" ")}`);
  }

  const unfold = await states("unfold");
  check(!unfold.some((state) => state.stuck) && unfold.at(-1)?.variables.u === 1, `both nets open: ${JSON.stringify(unfold.at(-1)?.variables)}`);
  const opened = unfold.at(-1);
  check(opened && opened.objects.solid && opened.objects.beside && inside(opened.objects.solid, opened.svg) && inside(opened.objects.beside, opened.svg), `both opened nets stay framed: ${JSON.stringify(opened)}`);

  const [lShapeState] = await states("lShape");
  const low = lShapeState.objects.solid, tall = lShapeState.objects["solid-side"];
  check(low && tall && low.left < tall.left && tall.top < low.top, `an L shape: the low box left, the tall box right: ${JSON.stringify([low, tall])}`);
  check(lShapeState.caption?.text === "Volume = 54", `the L shape's volume: ${JSON.stringify(lShapeState.caption)}`);

  const [alone] = await states("alone");
  check(alone.caption === null && alone.objects.solid && inside(alone.objects.solid, alone.svg), `a solid alone: drawn, no measures line: ${JSON.stringify(alone)}`);
  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("solids browser checks passed: two solids side by side on one floor and framed, the measures line under the scene inside the card (English and Chinese), one plane cutting both, both nets opening, the L shape, a solid alone unchanged");
