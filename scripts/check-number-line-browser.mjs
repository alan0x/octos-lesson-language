// Browser checks for the number line (decision 0013), with the runtime's own
// stylesheet:
// - a real pointer drag on a point goes through the board and the lesson
//   session, wired as the playback harness and Learn wire them, snaps to a
//   tick, and completes the drag task;
// - dense tick labels thin out so no two drawn labels overlap, while every
//   tick stays;
// - quarter-step decimal labels read 0.25 and 0.75.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";

const lesson = (content, extra = {}) => ({
  dsl: "octos.lesson", version: "0.1", profile: "authoring",
  lesson: { mode: "explain", language: "zh-CN", title: "数轴", goals: ["看数轴"], ...extra },
  steps: [{ key: "s", purpose: "看", beats: [{ key: "b", say: "看这条数轴。", actions: [
    { do: "write", as: "line", kind: "number_line", role: "main_visual", content, place: { relation: "new_region" } },
  ] }] }],
  close: { summary: "完。", focus: ["line"] },
});
const host = (lessonId) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
const drag = normalizeAuthoringLesson(lesson({
  range: { min: 0, max: 2 }, ticks: { step: 1, subdivisions: 4 },
  points: [{ as: "dot", value: 0, label: "你的点", interaction: { kind: "drag", variable: "p" } }],
  bindings: [{ target: "dot.value", expression: "p" }],
}, {
  variables: [{ as: "p", initial: 0, min: 0, max: 2, label: "位置" }],
  tasks: [{
    as: "place", prompt: "把点拖到 3/4。", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "variable_change", variable: "p", controls: ["number_line_point"] }],
    completion: { kind: "expression_target", expression: "p", value: 0.75, tolerance: 0.01 },
    hints: ["每个大格分成四份。"],
  }],
}), host("drag"));
const dense = normalizeAuthoringLesson(lesson({ range: { min: -5, max: 5 }, ticks: { step: 1, subdivisions: 4, labels: "all" } }), host("dense"));
const quarters = normalizeAuthoringLesson(lesson({ range: { min: 0, max: 1 }, ticks: { step: 0.25 } }), host("quarters"));
// A jump drawn hop by hop, driven by a variable to 2.6: the arrow must end at 2.6, not 3.
const boundJump = lesson({
  range: { min: 0, max: 4 }, ticks: { step: 1 },
  jumps: [{ as: "move", from: 0, by: 1, label: "move", hops: true }],
  bindings: [{ target: "move.by", expression: "delta" }],
}, { variables: [{ as: "delta", initial: 1, min: 1, max: 2.6, label: "跳多远" }] });
boundJump.steps[0].beats.push({ key: "c", say: "跳得更远。", actions: [{ do: "animate", variable: "delta", value: 2.6 }] });
const bound = normalizeAuthoringLesson(boundJump, host("bound"));

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

  // 1. Drag through the session, wired as apps/playback-harness/src/app.ts wires it.
  await page.evaluate((events) => {
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "drag");
    while (session.projection.status !== "completed") session.advance();
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    mounted.view.setVariableInputHandler((alias, value, event) => {
      if (event.phase === "start") return session.beginStudentVariableOperation(alias, { control: event.control, input: event.input });
      if (!event.operation_id) return;
      if (event.phase === "update") session.updateStudentVariableOperation(event.operation_id, value);
      else session.commitStudentVariableOperation(event.operation_id, value);
      mounted.view.render(session.projection.board);
    });
    mounted.view.render(session.projection.board);
    Object.assign(window, { session, mounted });
  }, drag);
  const handle = await page.$(".number-line-drag-handle");
  const line = await (await page.$(".number-line-preview")).boundingBox();
  const start = await handle.boundingBox();
  const y = start.y + start.height / 2;
  await page.mouse.move(start.x + start.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(line.x + line.width * (30 + 460 * 0.7 / 2) / 520, y, { steps: 8 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => ({
    value: window.session.projection.board.variables.p.value,
    task: window.session.studentTasks[0].status,
    control: window.session.studentOperations.at(-1)?.control,
  }));
  check(dragged.value === 0.75, `drag toward 0.7 should snap to 0.75, got ${dragged.value}`);
  check(dragged.task === "succeeded", `the drag task should succeed, got ${dragged.task}`);
  check(dragged.control === "number_line_point", `the operation should be logged as number_line_point, got ${dragged.control}`);

  // 2. and 3. Labels.
  const labels = async (events, id) => page.evaluate(({ events, id }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), id);
    while (session.projection.status !== "completed") session.advance();
    window.mountInfiniteBoard(document.querySelector("#board")).view.render(session.projection.board);
    const svg = document.querySelector(".number-line-preview");
    // A stacked fraction is three parts; group them by their tick's x.
    const boxes = [...svg.querySelectorAll(".number-line-tick-label")].map((node) => {
      const { x, width } = node.getBBox();
      return { text: node.textContent, box: { x, width } };
    });
    return { ticks: svg.querySelectorAll(".number-line-tick").length, boxes };
  }, { events, id });
  const denseLabels = await labels(dense, "dense");
  check(denseLabels.ticks === 41, `every tick stays: expected 41, got ${denseLabels.ticks}`);
  const rows = new Map();
  for (const { box } of denseLabels.boxes) {
    const key = Math.round(box.x + box.width / 2);
    const merged = rows.get(key);
    rows.set(key, merged ? { x: Math.min(merged.x, box.x), right: Math.max(merged.right, box.x + box.width) } : { x: box.x, right: box.x + box.width });
  }
  const spans = [...rows.values()].sort((a, b) => a.x - b.x);
  const overlaps = spans.filter((span, index) => index > 0 && span.x < spans[index - 1].right);
  check(overlaps.length === 0, `dense labels overlap ${overlaps.length} times`);
  check(denseLabels.boxes.some(({ text }) => text === "0"), "0 keeps its label on a dense line");
  const quarterLabels = await labels(quarters, "quarters");
  check(JSON.stringify(quarterLabels.boxes.map(({ text }) => text)) === JSON.stringify(["0", "0.25", "0.5", "0.75", "1"]), `quarter labels: ${quarterLabels.boxes.map(({ text }) => text).join(", ")}`);
  const arrowEnd = await page.evaluate((events) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "bound");
    while (session.projection.status !== "completed") session.advance();
    window.mountInfiniteBoard(document.querySelector("#board")).view.render(session.projection.board);
    const arcs = [...document.querySelectorAll(".number-line-jump-arc")];
    const end = arcs.at(-1).getAttribute("d").trim().split(/\s+/u).at(-1).split(",").map(Number)[0];
    return { arcs: arcs.length, end, by: session.projection.board.variables.delta.value };
  }, bound);
  const expectedEnd = 30 + 2.6 / 4 * 460;
  check(arrowEnd.by === 2.6 && Math.abs(arrowEnd.end - expectedEnd) < 0.01, `the bound jump should end at x=${expectedEnd} (2.6), got x=${arrowEnd.end} for delta=${arrowEnd.by}`);
  check(arrowEnd.arcs === 3, `2.6 is drawn as two whole hops and a short one, got ${arrowEnd.arcs} arcs`);
  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("number line browser checks passed: drag through the session, dense labels, decimal labels, bound jump end");
