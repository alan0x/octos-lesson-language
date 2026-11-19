// Browser checks for the fraction model (decision 0021, amended), with the runtime's own stylesheet:
// - a full circle (4/4) is four shaded sectors with area, an empty one (0/4) shades nothing, and one
//   whole of one part (1/1) is a shaded disc;
// - two fractions share one whole (same drawn size), and the relation line reads the values;
// - eight wholes of twelve and a 10 × 10 grid stay inside the card, wholes apart;
// - a bound numerator shades whole parts as it moves, and the card keeps one size;
// - splitting draws the cuts, and the highlight marks one smallest part;
// - the stacked labels sit beside their models, inside the card.
// Fractions here are invented for the check. Screenshots go to OLL_FRACTION_SCREENSHOTS when it is set.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { buildFractionModel } from "../dist/packages/plugin-math/src/index.js";

const place = { relation: "new_region" };
const lesson = (input, variables = [], beats = []) => {
  const built = buildFractionModel({ as: "model", role: "main_visual", place, ...input });
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Fractions", goals: ["Look at the parts"], variables },
    steps: [{ key: "s", purpose: "Look", beats: [{ key: "b", say: "Here it is.", actions: built.actions }, ...beats] }],
    close: { summary: "Done.", focus: [built.whole] },
  };
};
const animate = (key, variable, value) => ({ key, say: "Look.", actions: [{ do: "animate", variable, value }] });
const host = (lessonId) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
const cases = {
  full: lesson({ model: "circle", fractions: [{ numerator: 4, denominator: 4 }] }),
  empty: lesson({ model: "circle", fractions: [{ numerator: 0, denominator: 4 }] }),
  disc: lesson({ model: "circle", fractions: [{ numerator: 1, denominator: 1 }] }),
  compare: lesson({ model: "bar", fractions: [{ numerator: 3, denominator: 4 }, { numerator: 2, denominator: 3 }], relation: "compare" }),
  pies: lesson({ model: "circle", fractions: [{ numerator: 5, denominator: 8 }, { numerator: 3, denominator: 5 }], relation: "compare" }),
  many: lesson({ model: "circle", fractions: [{ numerator: 90, denominator: 12, wholes: 8 }] }),
  bars: lesson({ model: "bar", fractions: [{ numerator: 22, denominator: 3 }] }),
  grid: lesson({ model: "grid", grid: { rows: 10, columns: 10 }, fractions: [{ numerator: 37, denominator: 100 }] }),
  grids: lesson({ model: "grid", grid: { rows: 10, columns: 10 }, fractions: [{ numerator: 125, denominator: 100 }] }),
  slider: lesson({ model: "circle", fractions: [{ numerator: { expression: "n", initial: 0 }, denominator: 8, wholes: 1 }] },
    [{ as: "n", initial: 0, min: 0, max: 8, label: "n", control: { kind: "slider", step: 1 } }],
    [animate("three", "n", 3), animate("all", "n", 8), animate("back", "n", 1)]),
  split: lesson({ model: "bar", fractions: [{ numerator: 1, denominator: 3, split: 4, highlight: 1 }] }),
  share: lesson({ model: "circle", fractions: [{ numerator: 2, denominator: 1, split: 3, highlight: 2 }] }),
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
    : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/probe.css"><div id="board" style="position:relative;width:1000px;height:760px"></div><script type="module" src="/probe.js"></script>');
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const executablePath = process.env.OLL_CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => existsSync(path));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const shots = process.env.OLL_FRACTION_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);
  // Every state of a lesson: the card, the svg, each fraction's parts and labels, in screen pixels.
  const states = async (name) => {
    const seen = await page.evaluate(({ events, name }) => {
      document.querySelector("#board").replaceChildren();
      const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), name);
      const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
      const seen = [];
      const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      for (let step = 0; session.projection.status !== "completed"; step += 1) {
        if (step > 200) { seen.push({ stuck: `${session.projection.status} at ${session.projection.cursor} of ${session.projection.total_operations}; failure ${JSON.stringify(session.failure ?? session.projection.failure ?? null)}` }); break; }
        session.advance();
        mounted.view.render(session.projection.board);
        const svg = document.querySelector(".fraction-model-preview");
        if (!svg) continue;
        const fractions = [...svg.querySelectorAll(".fraction-model-fraction")].map((group) => ({
          shaded: [...group.querySelectorAll(".fraction-model-part-shaded")].map((part) => ({ tag: part.tagName, box: rect(part) })),
          empty: group.querySelectorAll(".fraction-model-part-empty").length,
          outlines: [...group.querySelectorAll(".fraction-model-outline")].map(rect),
          splits: group.querySelectorAll(".fraction-model-split").length,
          highlights: [...group.querySelectorAll(".fraction-model-highlight")].map(rect),
          labels: [...group.querySelectorAll(".fraction-model-label")].map((label) => ({ text: label.textContent, box: rect(label) })),
        }));
        const relation = svg.querySelector(".fraction-model-relation");
        const card = svg.closest(".board-node");
        seen.push({
          variables: Object.fromEntries(Object.entries(session.projection.board.variables ?? {}).map(([k, v]) => [k, v.value])),
          svg: rect(svg), card: card ? rect(card) : null, fractions,
          relation: relation ? { text: relation.textContent, box: rect(relation) } : null,
        });
      }
      return seen;
    }, { events: events[name], name });
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
    return seen;
  };
  const inside = (inner, outer, slack = 1) => inner && outer && inner.left >= outer.left - slack && inner.right <= outer.right + slack && inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack;
  const apart = (a, b) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
  const allApart = (boxes) => boxes.every((a, i) => boxes.slice(i + 1).every((b) => apart(a, b)));
  const last = (seen) => seen.filter((state) => !state.stuck).at(-1);

  const full = last(await states("full"));
  check(full?.fractions[0].shaded.length === 4 && full.fractions[0].shaded.every((part) => part.box.width > 20 && part.box.height > 20), `4/4: four shaded sectors with area: ${JSON.stringify(full?.fractions[0].shaded)}`);
  const empty = last(await states("empty"));
  check(empty?.fractions[0].shaded.length === 0 && empty.fractions[0].empty === 4, `0/4: nothing shaded, four empty parts: ${JSON.stringify(empty?.fractions[0])}`);
  const disc = last(await states("disc"));
  check(disc?.fractions[0].shaded.length === 1 && disc.fractions[0].shaded[0].tag === "circle" && disc.fractions[0].shaded[0].box.width > 100, `1/1: one shaded disc: ${JSON.stringify(disc?.fractions[0].shaded)}`);

  const pairs = {};
  for (const name of ["compare", "pies"]) {
    const state = pairs[name] = last(await states(name));
    const [a, b] = state?.fractions ?? [];
    check(a && b && Math.abs(a.outlines[0].width - b.outlines[0].width) < 0.5 && Math.abs(a.outlines[0].height - b.outlines[0].height) < 0.5, `${name}: one whole, the same size twice: ${JSON.stringify([a?.outlines, b?.outlines])}`);
    check(a && b && a.outlines[0].bottom <= b.outlines[0].top, `${name}: the second fraction below the first: ${JSON.stringify([a?.outlines, b?.outlines])}`);
    check(state?.relation && inside(state.relation.box, state.card) && state.relation.box.top >= b.outlines[0].bottom, `${name}: the relation line under both, inside the card: ${JSON.stringify(state?.relation)}`);
    for (const fraction of [a, b].filter(Boolean)) {
      const labels = fraction.labels.map((label) => label.box);
      check(labels.every((label) => inside(label, state.card) && fraction.outlines.every((outline) => label.left >= outline.right)), `${name}: labels to the right of their model, inside the card: ${JSON.stringify(fraction.labels)}`);
    }
  }
  check(pairs.compare?.relation?.text === "3/4 > 2/3", `compare reads 3/4 > 2/3: ${JSON.stringify(pairs.compare?.relation?.text)}`);
  check(pairs.pies?.relation?.text === "5/8 > 3/5", `pies read 5/8 > 3/5: ${JSON.stringify(pairs.pies?.relation?.text)}`);

  for (const [name, wholes, shaded] of [["many", 8, 90], ["bars", 8, 22], ["grid", 1, 37], ["grids", 2, 125]]) {
    const state = last(await states(name));
    const fraction = state?.fractions[0];
    check(fraction?.outlines.length === wholes, `${name}: ${wholes} wholes drawn: ${fraction?.outlines.length}`);
    check(fraction?.shaded.length === shaded, `${name}: ${shaded} shaded parts: ${fraction?.shaded.length}`);
    check(fraction && fraction.outlines.every((outline) => inside(outline, state.card)) && allApart(fraction.outlines), `${name}: every whole inside the card, apart: ${JSON.stringify(fraction?.outlines)}`);
  }

  const slider = await states("slider");
  check(!slider.some((state) => state.stuck), `the slider lesson plays through: ${JSON.stringify(slider.slice(-3).map((state) => state.stuck ?? state.variables))}`);
  for (const state of slider.filter((each) => !each.stuck)) {
    check(state.fractions[0].shaded.length === Math.round(state.variables.n) && state.fractions[0].labels[0].text === String(Math.round(state.variables.n)), `n = ${state.variables.n}: that many parts shaded and named: ${state.fractions[0].shaded.length}, ${state.fractions[0].labels[0].text}`);
  }
  const sizes = new Set(slider.filter((each) => !each.stuck).map((state) => `${Math.round(state.svg.width)}x${Math.round(state.svg.height)}`));
  check(sizes.size === 1, `the card keeps one size as the numerator moves: ${[...sizes].join(" ")}`);
  check(slider.some((state) => !state.stuck && state.variables.n === 8 && state.fractions[0].shaded.length === 8), "the slider reaches a full circle");

  const split = last(await states("split"));
  check(split?.fractions[0].splits === 9 && split.fractions[0].highlights.length === 1, `a third cut into fourths: 9 cuts, one marked twelfth: ${JSON.stringify(split?.fractions[0])}`);
  const piece = split?.fractions[0].highlights[0], outline = split?.fractions[0].outlines[0];
  check(piece && outline && Math.abs(piece.width * 12 - outline.width) < 3, `the marked piece is a twelfth of the whole: ${JSON.stringify([piece, outline])}`);
  const share = last(await states("share"));
  check(share?.fractions[0].highlights.length === 2 && share.fractions[0].outlines.length === 2 && inside(share.fractions[0].highlights[0], share.fractions[0].outlines[0]) && inside(share.fractions[0].highlights[1], share.fractions[0].outlines[0]), `two wholes in thirds, a share of two thirds marked in the first: ${JSON.stringify(share?.fractions[0].highlights)}`);
  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("fraction model browser checks passed: full, empty and one-part circles; two fractions on one whole with the relation line; eight wholes and hundredths grids inside the card; a bound numerator shading whole parts at one size; splits and a marked share; labels beside their models");
