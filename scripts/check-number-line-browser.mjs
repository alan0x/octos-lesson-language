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
// Run 4's NL-05 shape: a 34-unit line, thinned to every 5. The end point is animated to 7, then the
// learner drags the start; the numbers under both points must be drawn wherever they are.
const markedLesson = lesson({
  range: { min: -17, max: 17 }, ticks: { step: 1 },
  points: [
    { as: "start", value: -3, label: "起点", interaction: { kind: "drag", variable: "s" } },
    { as: "end", value: 5, label: "终点" },
  ],
  jumps: [{ as: "move", from: "start", by: 8, hops: true }],
  bindings: [{ target: "start.value", expression: "s" }, { target: "end.value", expression: "s + c" }, { target: "move.by", expression: "c" }],
}, {
  variables: [{ as: "s", initial: -3, min: -10, max: 0, label: "起点" }, { as: "c", initial: 8, min: 0, max: 10, label: "移动" }],
  tasks: [{
    as: "drag-start", prompt: "把起点拖到 −10。", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "variable_change", variable: "s", controls: ["number_line_point"] }],
    completion: { kind: "expression_target", expression: "s", value: -10, tolerance: 0.5 },
    hints: ["往左拖。"],
  }],
});
markedLesson.steps[0].beats.push({ key: "c", say: "再多走两格。", actions: [{ do: "animate", variable: "c", value: 10 }] });
const marked = normalizeAuthoringLesson(markedLesson, host("marked"));
// The same line with the end kept back until it is emphasized: its value must not be pinned.
const hiddenLesson = structuredClone(markedLesson);
hiddenLesson.steps[0].beats[0].actions[0].content.points[1].shown = "when_emphasized";
const hidden = normalizeAuthoringLesson(hiddenLesson, host("hidden"));
// Names above the line (no jumps), one point dragged across the other: the axis and the card keep
// their geometry in every state, so nothing jumps under the pointer.
const crossing = normalizeAuthoringLesson(lesson({
  range: { min: -20, max: 20 }, ticks: { step: 1 },
  points: [
    { as: "mover", value: -6, label: "起点", interaction: { kind: "drag", variable: "m" } },
    { as: "fixed", value: 0, label: "终点" },
  ],
  bindings: [{ target: "mover.value", expression: "m" }],
}, { variables: [{ as: "m", initial: -6, min: -20, max: 20, label: "位置" }] }), host("crossing"));
// The tallest number line: thinned fraction labels, moving points with names, a jump, a title. Its
// reserved rows make it taller than the board's first estimate; the board measures it after drawing,
// so the note placed below it must start below its real bottom.
const tallLesson = lesson({
  title: "从 −1/2 出发", range: { min: -10, max: 10 }, ticks: { step: 1, subdivisions: 4, labels: "all" },
  points: [
    { as: "start", value: "-1/2", label: "起点", interaction: { kind: "drag", variable: "s" } },
    { as: "end", value: "1/4", label: "终点" },
  ],
  jumps: [{ as: "move", from: "start", by: "3/4", hops: true }],
  bindings: [{ target: "start.value", expression: "s" }, { target: "end.value", expression: "s + 0.75" }],
}, { variables: [{ as: "s", initial: -0.5, min: -9, max: 9, label: "起点" }] });
tallLesson.steps[0].beats[0].actions.push({ do: "write", as: "note", kind: "note", role: "note", place: { relation: "below", anchor: "line" }, content: { title: "下面的卡片" } });
const tall = normalizeAuthoringLesson(tallLesson, host("tall"));
// Review of #51: one named start, and a jump whose end has no point of its own, its change animated
// 0 → 1 → 5 → 0 on a thinned line. The card keeps one height throughout.
const jumpOnlyLesson = lesson({
  range: { min: -20, max: 20 }, ticks: { step: 1 },
  points: [{ as: "start", value: 0, label: "起点" }],
  jumps: [{ as: "move", from: "start", by: 0, hops: false }],
  bindings: [{ target: "move.by", expression: "delta" }],
}, { variables: [{ as: "delta", initial: 0, min: 0, max: 5, label: "移动" }] });
for (const value of [1, 5, 0]) jumpOnlyLesson.steps[0].beats.push({ key: `j${value}`, say: "看。", actions: [{ do: "animate", variable: "delta", value }] });
const jumpOnly = normalizeAuthoringLesson(jumpOnlyLesson, host("jump-only"));
// A point shown only when emphasized: pointing at it leaves it hidden; emphasizing it shows it; emphasis
// "none" hides it again (Coach's quality judge relies on exactly this; review of Coach #63).
const latentLesson = (extra) => lesson({
  range: { min: -1, max: 2 }, ticks: { step: 1, subdivisions: 4, labels: "all" },
  points: [{ as: "start", value: 0, label: "起点" }, { as: "end", value: "3/4", label: "终点", shown: "when_emphasized" }],
});
const latentWith = (actions) => {
  const authored = latentLesson();
  authored.steps[0].beats.push({ key: "c", say: "终点。", actions });
  return normalizeAuthoringLesson(authored, host(`latent-${actions.map((action) => action.do + (action.emphasis ?? "")).join("-")}`));
};
const latentCases = [
  ["point", latentWith([{ do: "point", target: "line#end" }]), false],
  ["emphasize", latentWith([{ do: "emphasize", target: "line#end", emphasis: "focus" }]), true],
  ["emphasize then none", latentWith([{ do: "emphasize", target: "line#end", emphasis: "focus" }, { do: "emphasize", target: "line#end", emphasis: "none" }]), false],
];
// 0016: a solution set on a thinned line. The interval's ends keep their numbers, its label clears the
// point name above the line, and no tick is drawn over its open ends.
const solution = normalizeAuthoringLesson(lesson({
  range: { min: -17, max: 17 }, ticks: { step: 1 },
  points: [{ as: "center", value: 3, label: "中心" }],
  intervals: [{ as: "set", from: 1, to: 7, from_closed: false, to_closed: false, label: "1 < x < 7" }],
}), host("solution"));
// Run 4's NL-04: Start at 0 and End at 1/4 on a 4-unit line; their names must not run together.
const names = normalizeAuthoringLesson(lesson({
  range: { min: -1, max: 3 }, ticks: { step: 1, subdivisions: 4, labels: "all" },
  points: [{ as: "start", value: 0, label: "Start" }, { as: "end", value: "1/4", label: "End" }],
  jumps: [{ as: "move", from: "start", by: "1/4", hops: true }],
}), host("names"));

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

  // 5. Points keep the number under them on a thinned line, after an animation and during a drag.
  const markedLabels = () => page.evaluate(() => {
    const svg = document.querySelector(".number-line-preview");
    const labels = [...svg.querySelectorAll(".number-line-tick-label")].map((node) => {
      const box = node.getBBox();
      return { text: node.textContent, x: box.x, right: box.x + box.width, y: Math.round(box.y) };
    });
    const overlaps = labels.filter((a, i) => labels.some((b, j) => j < i && a.y === b.y && a.x < b.right && b.x < a.right)).length;
    return { texts: labels.map((label) => label.text), overlaps, s: window.session.projection.board.variables.s.value };
  });
  await page.evaluate((events) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "marked");
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
  }, marked);
  const animated = await markedLabels();
  check(animated.texts.includes("7") && animated.texts.includes("−3"), `after the animation, −3 and 7 are labelled: ${animated.texts.join(" ")}`);
  check(!animated.texts.includes("4") && !animated.texts.includes("8"), `labels off the stride appear only under points: ${animated.texts.join(" ")}`);
  check(animated.overlaps === 0, `marked labels overlap ${animated.overlaps} times`);
  const markedLine = await (await page.$(".number-line-preview")).boundingBox();
  const markedHandle = await (await page.$(".number-line-drag-handle")).boundingBox();
  const markedY = markedHandle.y + markedHandle.height / 2;
  await page.mouse.move(markedHandle.x + markedHandle.width / 2, markedY);
  await page.mouse.down();
  await page.mouse.move(markedLine.x + markedLine.width * (30 + 460 * 7.8 / 34) / 520, markedY, { steps: 8 });
  const dragging = await markedLabels();
  await page.mouse.up();
  const sign = (value) => (value < 0 ? `−${-value}` : String(value));
  check(dragging.s !== -3, "the drag moved the start");
  check(dragging.texts.includes(sign(dragging.s)) && dragging.texts.includes(sign(dragging.s + 10)), `while dragging, the start ${dragging.s} and its end ${dragging.s + 10} are labelled: ${dragging.texts.join(" ")}`);
  check(dragging.overlaps === 0, `labels overlap ${dragging.overlaps} times while dragging`);
  const hiddenLabels = await page.evaluate((events) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "hidden");
    while (session.projection.status !== "completed") session.advance();
    window.mountInfiniteBoard(document.querySelector("#board")).view.render(session.projection.board);
    return [...document.querySelectorAll(".number-line-tick-label")].map((node) => node.textContent);
  }, hidden);
  check(hiddenLabels.includes("−3") && !hiddenLabels.includes("7"), `a hidden end keeps its value back: ${hiddenLabels.join(" ")}`);
  const geometry = () => page.evaluate(() => {
    const svg = document.querySelector(".number-line-preview");
    return { axis: svg.querySelector(".number-line-axis").getAttribute("y1"), box: svg.getAttribute("viewBox"), m: window.session.projection.board.variables.m.value };
  });
  await page.evaluate((events) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "crossing");
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
  }, crossing);
  const before = await geometry();
  const crossLine = await (await page.$(".number-line-preview")).boundingBox();
  const crossHandle = await (await page.$(".number-line-drag-handle")).boundingBox();
  const crossY = crossHandle.y + crossHandle.height / 2;
  await page.mouse.move(crossHandle.x + crossHandle.width / 2, crossY);
  await page.mouse.down();
  const seen = [];
  for (const target of [-3, -1, 0, 1, 3, 6]) {
    await page.mouse.move(crossLine.x + crossLine.width * (30 + 460 * (target + 20) / 40) / 520, crossY, { steps: 3 });
    seen.push(await geometry());
  }
  await page.mouse.up();
  check(seen.some((state) => state.m >= 0) && seen.some((state) => state.m < 0), `the drag crossed the other point: ${seen.map((state) => state.m).join(", ")}`);
  check(seen.every((state) => state.axis === before.axis && state.box === before.box), `the axis and card stay put while names cross: ${JSON.stringify([before, ...seen])}`);
  const stacking = await page.evaluate((events) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "tall");
    while (session.projection.status !== "completed") session.advance();
    window.mountInfiniteBoard(document.querySelector("#board")).view.render(session.projection.board);
    const card = (id) => document.querySelector(`.board-node[data-id$=":node:${id}"]`);
    const line = card("line").getBoundingClientRect(), note = card("note").getBoundingClientRect();
    const svg = document.querySelector(".number-line-preview").getBoundingClientRect();
    return { lineBottom: line.bottom, svgBottom: svg.bottom, noteTop: note.top, clipped: card("line").scrollHeight > card("line").clientHeight + 1 };
  }, tall);
  check(!stacking.clipped && stacking.svgBottom <= stacking.lineBottom + 1, `the tall number line fits its card: ${JSON.stringify(stacking)}`);
  check(stacking.noteTop >= stacking.lineBottom - 1, `the note below starts below the number line's real bottom: ${JSON.stringify(stacking)}`);
  const jumpBoxes = await page.evaluate((events) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "jump-only");
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const seen = [];
    while (session.projection.status !== "completed") {
      session.advance();
      mounted.view.render(session.projection.board);
      const svg = document.querySelector(".number-line-preview");
      if (svg) seen.push([session.projection.board.variables.delta.value, svg.getAttribute("viewBox")]);
    }
    return seen;
  }, jumpOnly);
  const deltas = new Set(jumpBoxes.map(([delta]) => delta));
  check([0, 1, 5].every((value) => deltas.has(value)), `the jump's change passed 0, 1 and 5: ${[...deltas].join(", ")}`);
  check(new Set(jumpBoxes.map(([, box]) => box)).size === 1, `a jump whose end has no point keeps one card height: ${JSON.stringify([...new Set(jumpBoxes.map(([delta, box]) => `${delta}:${box}`))])}`);
  for (const [name, events, visible] of latentCases) {
    const shown = await page.evaluate((events) => {
      document.querySelector("#board").replaceChildren();
      const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), events[0].lesson_id ?? "latent");
      while (session.projection.status !== "completed") session.advance();
      window.mountInfiniteBoard(document.querySelector("#board")).view.render(session.projection.board);
      const end = [...document.querySelectorAll(".number-line-point")].find((group) => /end/.test(group.dataset.id ?? ""));
      return end ? getComputedStyle(end).display !== "none" : null;
    }, events);
    check(shown === visible, `a point shown only when emphasized, after ${name}: expected ${visible ? "visible" : "hidden"}, got ${shown}`);
  }
  const solutionView = await page.evaluate((events) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "solution");
    while (session.projection.status !== "completed") session.advance();
    window.mountInfiniteBoard(document.querySelector("#board")).view.render(session.projection.board);
    const svg = document.querySelector(".number-line-preview");
    const box = (node) => { const b = node.getBBox(); return { x: b.x, right: b.x + b.width, y: b.y, bottom: b.y + b.height }; };
    const name = box(svg.querySelector(".number-line-point-label"));
    const label = box(svg.querySelector(".number-line-interval-label"));
    const children = [...svg.children];
    const lastTick = Math.max(...children.map((node, index) => (node.classList?.contains("number-line-tick") ? index : -1)));
    const interval = children.findIndex((node) => node.classList?.contains("number-line-interval"));
    return {
      labels: [...svg.querySelectorAll(".number-line-tick-label")].map((node) => node.textContent),
      overlap: name.x < label.right && label.x < name.right && name.y < label.bottom && label.y < name.bottom,
      ticksBeforeInterval: lastTick < interval,
    };
  }, solution);
  check(solutionView.labels.includes("1") && solutionView.labels.includes("7"), `an interval's ends keep their numbers on a thinned line: ${solutionView.labels.join(" ")}`);
  check(!solutionView.overlap, "the interval's label clears the point's name");
  check(solutionView.ticksBeforeInterval, "ticks are drawn before the interval, so none crosses an open end");
  const nameBoxes = await page.evaluate((events) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "names");
    while (session.projection.status !== "completed") session.advance();
    window.mountInfiniteBoard(document.querySelector("#board")).view.render(session.projection.board);
    return [...document.querySelectorAll(".number-line-point-label")].map((node) => { const box = node.getBBox(); return { x: box.x, right: box.x + box.width, y: box.y, bottom: box.y + box.height }; });
  }, names);
  const [first, second] = nameBoxes;
  // On the same row, names need a clear gap; touching reads as one word ("Start End").
  const sameRow = first && second && first.y < second.bottom && second.y < first.bottom;
  check(nameBoxes.length === 2 && (!sameRow || Math.max(first.x, second.x) - Math.min(first.right, second.right) >= 5), `point names run together: ${JSON.stringify(nameBoxes)}`);
  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("number line browser checks passed: drag through the session, dense labels, decimal labels, bound jump end, point values labelled on a thinned line, point names apart, hidden answers kept back, steady geometry while dragging, tall cards measured, steady height as a lone jump end moves, emphasis (not pointing) reveals a hidden point, solution sets readable");
