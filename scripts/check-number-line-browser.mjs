// Browser checks for the number line (decision 0013), with the runtime's own
// stylesheet:
// - a real pointer drag on a point goes through the board and the lesson
//   session, wired as the playback harness and Learn wire them, snaps to a
//   tick, and completes the drag task;
// - dense tick labels thin out so no two drawn labels overlap, while every
//   tick stays;
// - quarter-step decimal labels read 0.25 and 0.75;
// - several jumps on one line (0017): landing numbers drawn, labels apart, a move that reverses over an
//   earlier one on its own lane with no arc crossing another, steady card height while moves animate.
// - the card's own zoom (0024): ticks thinned at rest with marked values kept; "−", "+" and "whole line"
//   with their limits; the wheel over the card zooms the line and never the board, outside it the board;
//   a two-finger pinch on the card zooms the line; a drag on the zoomed line moves it; a point dragged
//   on a zoomed line lands on the same stop; the card never resizes; the teaching camera brings back
//   the whole line; the buttons speak the board's language.
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

// 0017: several jumps on one line.
const makeTen = normalizeAuthoringLesson(lesson({
  range: { min: 0, max: 20 }, ticks: { step: 1 },
  points: [{ as: "start", value: 8, label: "起点" }, { as: "ten", value: 10, label: "凑十" }, { as: "end", value: 13, label: "终点" }],
  jumps: [{ as: "j1", from: "start", by: 2, label: "+2", hops: true }, { as: "j2", from: "ten", by: 3, label: "+3", hops: true }],
}), host("make-ten"));
// Up 6, down 4, up 3 with hops: the second and third moves overlap earlier ones.
const upDownUp = normalizeAuthoringLesson(lesson({
  range: { min: 0, max: 12 }, ticks: { step: 1 },
  points: [{ as: "start", value: 2, label: "起点" }, { as: "end", value: 7, label: "终点" }],
  jumps: [{ as: "j1", from: 2, by: 6, label: "+6", hops: true }, { as: "j2", from: 8, by: -4, label: "−4", hops: true }, { as: "j3", from: 4, by: 3, label: "+3", hops: true }],
}), host("up-down-up"));
// Moves animated from 0 on a bound card: up 4, then down 6 back over it.
const reverseLesson = lesson({
  range: { min: -2, max: 12 }, ticks: { step: 1 },
  points: [{ as: "start", value: 5, label: "起点" }, { as: "end", value: 5, label: "终点" }],
  jumps: [{ as: "j1", from: "start", by: 0, label: "+4" }, { as: "j2", from: 5, by: 0, label: "−6" }],
  bindings: [{ target: "j1.by", expression: "a" }, { target: "j2.from", expression: "5 + a" }, { target: "j2.by", expression: "-b" }, { target: "end.value", expression: "5 + a - b" }],
}, { variables: [{ as: "a", initial: 0, min: 0, max: 4, label: "上" }, { as: "b", initial: 0, min: 0, max: 6, label: "下" }] });
reverseLesson.steps[0].beats.push({ key: "up", say: "上 4。", actions: [{ do: "animate", variable: "a", value: 4 }] }, { key: "down", say: "下 6。", actions: [{ do: "animate", variable: "b", value: 6 }] });
const reverse = normalizeAuthoringLesson(reverseLesson, host("reverse"));
// G68-01's shape on a bound card: up 6, down 4, up 3, each animated from 0; three lanes at the end.
const boundUpDownUpLesson = lesson({
  range: { min: -3, max: 12 }, ticks: { step: 1 },
  points: [{ as: "start", value: 2, label: "起点" }, { as: "end", value: 2, label: "终点" }],
  jumps: [{ as: "j1", from: "start", by: 0, label: "+6" }, { as: "j2", from: 2, by: 0, label: "−4" }, { as: "j3", from: 2, by: 0, label: "+3" }],
  bindings: [
    { target: "j1.by", expression: "a" }, { target: "j2.from", expression: "2 + a" }, { target: "j2.by", expression: "-b" },
    { target: "j3.from", expression: "2 + a - b" }, { target: "j3.by", expression: "c" }, { target: "end.value", expression: "2 + a - b + c" },
  ],
}, { variables: [{ as: "a", initial: 0, min: 0, max: 6, label: "上" }, { as: "b", initial: 0, min: 0, max: 4, label: "下" }, { as: "c", initial: 0, min: 0, max: 3, label: "上" }] });
for (const [variable, value] of [["a", 6], ["b", 4], ["c", 3]]) boundUpDownUpLesson.steps[0].beats.push({ key: `k${variable}`, say: "走。", actions: [{ do: "animate", variable, value }] });
const boundUpDownUp = normalizeAuthoringLesson(boundUpDownUpLesson, host("bound-up-down-up"));
// Tens then ones on a bound card: 27 + 10 + 10 + 5, each landing number labelled on a thinned line.
const stepsLesson = lesson({
  range: { min: 20, max: 60 }, ticks: { step: 1 },
  points: [{ as: "start", value: 27, label: "起点" }, { as: "end", value: 27, label: "终点" }],
  jumps: [{ as: "j1", from: "start", by: 0, label: "+10" }, { as: "j2", from: 27, by: 0, label: "+10" }, { as: "j3", from: 27, by: 0, label: "+5", hops: true }],
  bindings: [
    { target: "j1.by", expression: "a" }, { target: "j2.from", expression: "27 + a" }, { target: "j2.by", expression: "b" },
    { target: "j3.from", expression: "27 + a + b" }, { target: "j3.by", expression: "c" }, { target: "end.value", expression: "27 + a + b + c" },
  ],
}, { variables: [{ as: "a", initial: 0, min: 0, max: 10, label: "一" }, { as: "b", initial: 0, min: 0, max: 10, label: "二" }, { as: "c", initial: 0, min: 0, max: 5, label: "三" }] });
for (const [variable, value] of [["a", 10], ["b", 10], ["c", 5]]) stepsLesson.steps[0].beats.push({ key: `k${variable}`, say: "走。", actions: [{ do: "animate", variable, value }] });
const steps = normalizeAuthoringLesson(stepsLesson, host("steps"));
// A dragged start whose short jump slides past a fixed one: they overlap only for starts in the middle of
// the slider (3 to 4), never at its ends or its starting value, and the card must not grow mid-drag.
const sliding = normalizeAuthoringLesson(lesson({
  range: { min: 0, max: 12 }, ticks: { step: 1 },
  points: [{ as: "start", value: 0, label: "起点", interaction: { kind: "drag", variable: "s" } }],
  jumps: [{ as: "j1", from: "start", by: 1, label: "+1" }, { as: "j2", from: 5, by: -2, label: "−2" }],
  bindings: [{ target: "start.value", expression: "s" }],
}, {
  variables: [{ as: "s", initial: 0, min: 0, max: 10, label: "起点" }],
  tasks: [{
    as: "move", prompt: "把起点拖到 8。", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "variable_change", variable: "s", controls: ["number_line_point"] }],
    completion: { kind: "expression_target", expression: "s", value: 8, tolerance: 0.01 },
    hints: ["拖动起点。"],
  }],
}), host("sliding"));
// Unit jumps on a 0..100 line: the dragged +1 overlaps the fixed −1 (50 to 49) only from the start 49.
const unitSliding = normalizeAuthoringLesson(lesson({
  range: { min: 0, max: 101 }, ticks: { step: 1 },
  points: [{ as: "start", value: 0, label: "起点", interaction: { kind: "drag", variable: "s" } }],
  jumps: [{ as: "j1", from: "start", by: 1, label: "+1" }, { as: "j2", from: 50, by: -1, label: "−1" }],
  bindings: [{ target: "start.value", expression: "s" }],
}, {
  variables: [{ as: "s", initial: 0, min: 0, max: 100, label: "起点" }],
  tasks: [{
    as: "move", prompt: "把起点拖到 80。", availability: { kind: "after_lesson" },
    allowed_operations: [{ kind: "variable_change", variable: "s", controls: ["number_line_point"] }],
    completion: { kind: "expression_target", expression: "s", value: 80, tolerance: 0.01 },
    hints: ["拖动起点。"],
  }],
}), host("unit-sliding"));
// Counting by 25 on a 25-unit line: one jump, five hops.
const by25 = normalizeAuthoringLesson(lesson({
  range: { min: 0, max: 200 }, ticks: { step: 25 },
  points: [{ as: "start", value: 0, label: "起点" }, { as: "end", value: 125, label: "终点" }],
  jumps: [{ as: "j1", from: "start", by: 125, label: "5 个 25", hops: true }],
}), host("by-25"));

// 0024: BT-20 (round 347 to the nearest ten) with a title, and BT-19's line with a point the learner drags.
const rounding = normalizeAuthoringLesson(lesson({
  title: "把 347 四舍五入到十位", range: { min: 300, max: 410 }, ticks: { step: 1 },
  points: [{ as: "low", value: 340 }, { as: "half", value: 345, style: "open" }, { as: "n", value: 347, label: "要取整的数" }, { as: "high", value: 350 }],
  jumps: [{ as: "up", from: "n", by: 3 }],
}), host("rounding"));
const pages = normalizeAuthoringLesson(lesson({
  range: { min: 0, max: 70 }, ticks: { step: 1 },
  points: [{ as: "start", value: 47, label: "起点", interaction: { kind: "drag", variable: "s" } }],
  bindings: [{ target: "start.value", expression: "s" }],
}, { variables: [{ as: "s", initial: 47, min: 0, max: 70, label: "页" }] }), host("pages"));

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
  // 0017: several jumps. Each state of the lesson is drawn and measured.
  const jumpStates = (events, id) => page.evaluate(({ events, id }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), id);
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const box = (node) => { const b = node.getBBox(); return { x: b.x, right: b.x + b.width, y: b.y, bottom: b.y + b.height }; };
    const seen = [];
    while (session.projection.status !== "completed") {
      session.advance();
      mounted.view.render(session.projection.board);
      const svg = document.querySelector(".number-line-preview");
      if (!svg) continue;
      const jumps = [...svg.querySelectorAll(".number-line-jump")].map((group) => ({
        label: group.querySelector(".number-line-jump-label")?.textContent,
        labelBox: group.querySelector(".number-line-jump-label") ? box(group.querySelector(".number-line-jump-label")) : undefined,
        arcs: [...group.querySelectorAll(".number-line-jump-arc")].map(box),
        // Points along each arc and leader, for tests against the drawn curve rather than its box.
        trace: [...group.querySelectorAll(".number-line-jump-arc, .number-line-jump-leader")].flatMap((node) => {
          const length = node.getTotalLength();
          return Array.from({ length: 41 }, (_, i) => { const p = node.getPointAtLength(length * i / 40); return { x: p.x, y: p.y }; });
        }),
        leaders: group.querySelectorAll(".number-line-jump-leader").length,
      }));
      const texts = [...svg.querySelectorAll("text")].map((node) => ({ text: node.textContent, ...box(node) }));
      const overlaps = texts.filter((a, i) => texts.some((b, j) => j < i && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom)).map((t) => t.text);
      seen.push({
        viewBox: svg.getAttribute("viewBox"),
        ticks: [...svg.querySelectorAll(".number-line-tick-label")].map((node) => node.textContent),
        jumps, overlaps,
      });
    }
    return seen;
  }, { events, id });
  // A label belongs to its own arc: no other jump's arc or leader runs through it.
  const labelOnOtherArc = (state) => state.jumps.some((jump, i) => jump.labelBox && state.jumps.some((other, j) => j !== i
    && other.trace.some((p) => p.x > jump.labelBox.x && p.x < jump.labelBox.right && p.y > jump.labelBox.y + 2 && p.y < jump.labelBox.bottom - 2)));
  const [makeTenView] = (await jumpStates(makeTen, "make-ten")).slice(-1);
  check(["8", "10", "13"].every((value) => makeTenView.ticks.includes(value)), `make ten keeps 8, 10 and 13 labelled: ${makeTenView.ticks.join(" ")}`);
  check(makeTenView.jumps.map((jump) => jump.label).join(" ") === "+2 +3" && makeTenView.jumps.every((jump) => jump.leaders === 0), `make ten draws two jumps on the line: ${JSON.stringify(makeTenView.jumps)}`);
  check(makeTenView.overlaps.length === 0, `make ten labels overlap: ${makeTenView.overlaps.join(", ")}`);
  // 130 for the line, its jumps and labels, and 14 for the zoom's overview strip (0024).
  check(makeTenView.viewBox === "0 0 520 144", `chained jumps in one direction share one lane, as tall as one jump: ${makeTenView.viewBox}`);
  const [upDownUpView] = (await jumpStates(upDownUp, "up-down-up")).slice(-1);
  check(upDownUpView.jumps.map((jump) => jump.leaders).join(" ") === "0 2 2", `the moves that overlap earlier ones are raised with leaders: ${upDownUpView.jumps.map((jump) => jump.leaders).join(" ")}`);
  check(upDownUpView.jumps[1].arcs.length === 1 && upDownUpView.jumps[0].arcs.length === 6, `a raised move is one arc; the first keeps its hops: ${upDownUpView.jumps.map((jump) => jump.arcs.length).join(" ")}`);
  // No crossing: each raised arc lies wholly above the arcs of the lanes below it.
  const [low, middle, high] = upDownUpView.jumps;
  const above = (upper, lower) => upper.arcs.every((arc) => lower.arcs.every((other) => arc.right <= other.x || other.right <= arc.x || arc.bottom <= other.y + 0.5));
  check(above(middle, low) && above(high, middle) && above(high, low), `raised arcs stay above the lanes below: ${JSON.stringify(upDownUpView.jumps.map((jump) => jump.arcs))}`);
  check(!labelOnOtherArc(upDownUpView) && upDownUpView.overlaps.length === 0, `up, down, up: every label clears the other arcs and texts: ${upDownUpView.overlaps.join(", ")}`);
  const reverseViews = await jumpStates(reverse, "reverse");
  check(new Set(reverseViews.map((state) => state.viewBox)).size === 1, `a reversing move keeps the card's height as it animates: ${[...new Set(reverseViews.map((state) => state.viewBox))].join(" | ")}`);
  const reverseEnd = reverseViews.at(-1);
  // The first arc keeps its shape when the reversing move appears over it.
  const firstArcs = new Set(reverseViews.filter((state) => state.jumps[0]?.arcs.length).map((state) => JSON.stringify(state.jumps[0].arcs)));
  check(firstArcs.size === 1, `up 4 keeps its arc when down 6 appears: ${[...firstArcs].join(" | ")}`);
  check(reverseEnd.jumps.map((jump) => jump.leaders).join(" ") === "0 2" && !labelOnOtherArc(reverseEnd), `down 6 over up 4 is raised and labelled clear: ${JSON.stringify(reverseEnd.jumps)}`);
  check(["3", "5", "9"].every((value) => reverseEnd.ticks.includes(value)), `up 4 then down 6 keeps 5, 9 and 3 labelled: ${reverseEnd.ticks.join(" ")}`);
  const boundUpDownUpViews = await jumpStates(boundUpDownUp, "bound-up-down-up");
  check(new Set(boundUpDownUpViews.map((state) => state.viewBox)).size === 1, `up, down, up on a bound card keeps one height as the third lane appears: ${[...new Set(boundUpDownUpViews.map((state) => state.viewBox))].join(" | ")}`);
  const boundUpDownUpEnd = boundUpDownUpViews.at(-1);
  check(boundUpDownUpEnd.jumps.map((jump) => jump.leaders).join(" ") === "0 2 2" && !labelOnOtherArc(boundUpDownUpEnd), `up, down, up on a bound card ends on three lanes, labels clear: ${boundUpDownUpEnd.jumps.map((jump) => jump.leaders).join(" ")}`);
  const dragStates = (events, id, top, step) => page.evaluate(({ events, id, top, step }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), id);
    while (session.projection.status !== "completed") session.advance();
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const seen = [];
    const operation = session.beginStudentVariableOperation("s", { control: "number_line_point", input: "mouse" });
    for (let value = 0; value <= top; value += step) {
      session.updateStudentVariableOperation(operation, value);
      mounted.view.render(session.projection.board);
      const svg = document.querySelector(".number-line-preview");
      seen.push(`${value}:${svg.getAttribute("viewBox")}:${svg.querySelector(".number-line-axis").getAttribute("y1")}:${svg.querySelectorAll(".number-line-jump-leader").length}`);
    }
    return seen;
  }, { events, id, top, step });
  const slidingBoxes = await dragStates(sliding, "sliding", 10, 0.5);
  check(slidingBoxes.some((state) => state.endsWith(":2")), `the sliding jump is raised while it overlaps: ${slidingBoxes.join(" ")}`);
  check(new Set(slidingBoxes.map((state) => state.split(":")[1])).size === 1, `dragging a jump past another keeps one card height: ${slidingBoxes.join(" ")}`);
  const unitBoxes = await dragStates(unitSliding, "unit-sliding", 100, 1);
  // The lanes above the line are reserved: the axis never moves. (Tick labels crowding under the line near
  // 49 to 50 add label rows below it; that predates the lanes and is not checked here.)
  check(unitBoxes.some((state) => state.endsWith(":2")) && new Set(unitBoxes.map((state) => state.split(":")[2])).size === 1,
    `a unit jump dragged past another on a 0..100 line keeps the line where it is: ${[...new Set(unitBoxes.map((state) => state.split(":").slice(2).join(":")))].join(" ")}`);
  const stepViews = await jumpStates(steps, "steps");
  check(new Set(stepViews.map((state) => state.viewBox)).size === 1, `tens then ones keeps one card height: ${[...new Set(stepViews.map((state) => state.viewBox))].join(" | ")}`);
  const stepsEnd = stepViews.at(-1);
  check(["27", "37", "47", "52"].every((value) => stepsEnd.ticks.includes(value)), `tens then ones keeps 27, 37, 47 and 52 labelled on a thinned line: ${stepsEnd.ticks.join(" ")}`);
  check(stepsEnd.jumps.every((jump) => jump.leaders === 0) && stepsEnd.overlaps.length === 0, `tens then ones stays on one lane, labels apart: ${stepsEnd.overlaps.join(", ")}`);
  const [by25View] = (await jumpStates(by25, "by-25")).slice(-1);
  check(by25View.jumps[0].arcs.length === 5 && by25View.ticks.join(" ") === "0 25 50 75 100 125 150 175 200", `counting by 25: five hops on 25-unit ticks: ${by25View.jumps[0].arcs.length} hops, ${by25View.ticks.join(" ")}`);
  // 0024: the card's own zoom.
  // The board eases its camera in once mounted (a 760 ms transition); measure after it settles.
  const settle = (target = page) => target.waitForTimeout(900);
  // A fresh board element: the boards mounted above are never disposed, and their wheel and pointer
  // handlers on the old element would act on this card too.
  const mountZoom = async (events, id) => { await page.evaluate(({ events, id }) => {
    const old = document.querySelector("#board");
    old.replaceWith(old.cloneNode(false));
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), id);
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
  }, { events, id }); await settle(); };
  // The window, read from the overview strip; the camera; the card's size; the buttons.
  const zoomState = () => page.evaluate(() => {
    const svg = document.querySelector(".number-line-preview");
    const strip = svg.querySelector(".number-line-overview-window");
    const card = svg.closest(".board-node").getBoundingClientRect();
    const range = window.session.projection.board.nodes[Object.keys(window.session.projection.board.nodes).find((id) => id.endsWith(":node:line"))].content.range;
    const at = (x) => range.min + (x - 30) / 460 * (range.max - range.min);
    const x = Number(strip.getAttribute("x")), width = Number(strip.getAttribute("width"));
    const ticks = [...svg.querySelectorAll(".number-line-tick")].map((node) => Number(node.getAttribute("x1")));
    const buttons = Object.fromEntries([...document.querySelectorAll(".number-line-zoom button")].map((node) => [node.className.replace("number-line-zoom-", ""), { disabled: node.disabled, text: node.textContent, label: node.getAttribute("aria-label") }]));
    return {
      window: [at(x), at(x + width)], viewBox: svg.getAttribute("viewBox"), cardHeight: Math.round(card.height), camera: window.mounted.view.getCameraState(),
      ticks: ticks.length, gap: Math.min(...ticks.slice(1).map((value, index) => value - ticks[index])),
      labels: [...svg.querySelectorAll(".number-line-tick-label")].map((node) => node.textContent), buttons,
      zoomed: svg.classList.contains("number-line-zoomed"), manual: document.querySelector("#board").classList.contains("manual-navigation"),
      s: window.session.projection.board.variables?.s?.value,
    };
  });
  const sameCamera = (a, b) => ["panX", "panY", "scale"].every((key) => Math.abs(a[key] - b[key]) < 1e-6);
  await mountZoom(rounding, "rounding");
  const roundingRest = await zoomState();
  check(roundingRest.ticks === 58, `300..410 at rest: every second tick plus the marked 345 and 347 (58): ${roundingRest.ticks}`);
  check(["340", "345", "347", "350"].every((value) => roundingRest.labels.includes(value)), `the marked values keep their labels at rest: ${roundingRest.labels.join(" ")}`);
  check(roundingRest.buttons.out?.text === "−" && roundingRest.buttons.in?.text === "+" && roundingRest.buttons.whole?.text === "整条", `the card draws −, + and 整条: ${JSON.stringify(roundingRest.buttons)}`);
  check(roundingRest.buttons.out.disabled && roundingRest.buttons.whole.disabled && !roundingRest.buttons.in.disabled, `at rest only + is live: ${JSON.stringify(roundingRest.buttons)}`);
  check(Object.values(roundingRest.buttons).every((button) => button.label), `every zoom button has an accessible name: ${JSON.stringify(roundingRest.buttons)}`);
  // The wheel over the line zooms the line, anchored under the pointer, and leaves the board's camera alone.
  const roundingBox = await (await page.$(".number-line-preview")).boundingBox();
  const pointerAt = (value) => roundingBox.x + roundingBox.width * (30 + 460 * (value - 300) / 110) / 520;
  await page.mouse.move(pointerAt(347), roundingBox.y + roundingBox.height * 0.4);
  for (let notch = 0; notch < 6; notch += 1) await page.mouse.wheel(0, -100);
  const wheeled = await zoomState();
  check(wheeled.window[1] - wheeled.window[0] < 60 && wheeled.window[0] > 300, `the wheel over the line zoomed it: ${wheeled.window.join("..")}`);
  check(Math.abs((347 - wheeled.window[0]) / (wheeled.window[1] - wheeled.window[0]) - 47 / 110) < 0.02, `the wheel zooms around the value under the pointer: ${wheeled.window.join("..")}`);
  check(sameCamera(wheeled.camera, roundingRest.camera), `the wheel over the line never zooms the board: ${JSON.stringify([roundingRest.camera, wheeled.camera])}`);
  check(wheeled.viewBox === roundingRest.viewBox && wheeled.cardHeight === roundingRest.cardHeight, `the card keeps its size as it zooms: ${roundingRest.viewBox} → ${wheeled.viewBox}, ${roundingRest.cardHeight} → ${wheeled.cardHeight}`);
  check(wheeled.manual, "zooming the line is manual navigation");
  // Over the card's title, too; outside the card the wheel zooms the board as before.
  const title = await (await page.$(".board-node .node-title")).boundingBox();
  await page.mouse.move(title.x + 10, title.y + title.height / 2);
  await page.mouse.wheel(0, -100);
  const overTitle = await zoomState();
  check(sameCamera(overTitle.camera, roundingRest.camera) && overTitle.window[1] - overTitle.window[0] < wheeled.window[1] - wheeled.window[0], `the wheel over the card's title zooms the line, not the board: ${overTitle.window.join("..")}`);
  const cardBox = await (await page.$(".board-node")).boundingBox();
  await page.mouse.move(Math.min(990, cardBox.x + cardBox.width + 60), Math.min(590, cardBox.y + cardBox.height + 40));
  await page.mouse.wheel(0, -100);
  const outside = await zoomState();
  check(!sameCamera(outside.camera, overTitle.camera) && outside.window.join() === overTitle.window.join(), `the wheel outside the card zooms the board and not the line: ${JSON.stringify([overTitle.camera, outside.camera])}`);
  // The buttons: + up to one tick about 48 units wide, then disabled; whole line back to the start.
  await mountZoom(rounding, "rounding");
  for (let press = 0; press < 12; press += 1) {
    const plus = await page.$(".number-line-zoom-in:not([disabled])");
    if (plus) await plus.click();
  }
  const deepest = await zoomState();
  check(deepest.buttons.in.disabled && !deepest.buttons.out.disabled && !deepest.buttons.whole.disabled, `at the limit + is disabled: ${JSON.stringify(deepest.buttons)}`);
  check(Math.abs(deepest.gap - 48) < 0.5, `at the limit one tick is about 48 units: ${deepest.gap}`);
  check(deepest.window[0] <= 347 && deepest.window[1] >= 347, `+ zooms around the marked values: ${deepest.window.join("..")}`);
  check(deepest.viewBox === roundingRest.viewBox, `the card keeps its height at the limit: ${deepest.viewBox}`);
  // A drag on the zoomed line's track moves it, not the board.
  const deepBox = await (await page.$(".number-line-preview")).boundingBox();
  await page.mouse.move(deepBox.x + deepBox.width * 0.3, deepBox.y + deepBox.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(deepBox.x + deepBox.width * 0.6, deepBox.y + deepBox.height * 0.25, { steps: 6 });
  await page.mouse.up();
  const panned = await zoomState();
  check(panned.window[0] < deepest.window[0] - 1 && Math.abs((panned.window[1] - panned.window[0]) - (deepest.window[1] - deepest.window[0])) < 1e-6, `dragging the zoomed line moves it: ${deepest.window.join("..")} → ${panned.window.join("..")}`);
  check(sameCamera(panned.camera, deepest.camera), `dragging the zoomed line leaves the board where it is: ${JSON.stringify([deepest.camera, panned.camera])}`);
  await page.click(".number-line-zoom-whole");
  const whole = await zoomState();
  check(Math.abs(whole.window[0] - 300) < 1e-6 && Math.abs(whole.window[1] - 410) < 1e-6 && whole.buttons.whole.disabled && whole.ticks === roundingRest.ticks, `whole line shows the whole range again: ${whole.window.join("..")}`);
  // Enter on a focused button zooms; the language follows the board's.
  await page.focus(".number-line-zoom-in");
  await page.keyboard.press("Enter");
  const keyed = await zoomState();
  check(keyed.zoomed, "Enter on + zooms the line");
  // A button that disables itself hands the focus on: "整条" by keyboard leaves the focus on "+".
  await page.focus(".number-line-zoom-whole");
  await page.keyboard.press("Enter");
  const handedOn = await page.evaluate(() => document.activeElement?.className);
  check(handedOn === "number-line-zoom-in", `after 整条 the focus moves to an enabled button: ${handedOn}`);
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.mounted.view.setLocale("en-US"));
  const english = await zoomState();
  check(english.buttons.whole.text === "Whole line" && english.buttons.in.label === "Zoom in", `the buttons speak English on an English board: ${JSON.stringify(english.buttons)}`);
  // The teaching camera taking over brings the whole line back.
  await page.evaluate(() => window.mounted.view.focusTargets([Object.keys(window.session.projection.board.nodes).find((id) => id.endsWith(":node:line"))]));
  const resumed = await zoomState();
  check(!resumed.zoomed && Math.abs(resumed.window[1] - resumed.window[0] - 110) < 1e-6, `the teaching camera brings back the whole line: ${resumed.window.join("..")}`);
  // A redrawn line keeps the board's emphasis: an end shown only when emphasized stays shown as the line
  // zooms and as the teaching camera brings the whole line back.
  await mountZoom(latentCases[1][1], "latent-zoom");
  const endShown = () => page.evaluate(() => {
    const end = [...document.querySelectorAll(".number-line-point")].find((group) => /end/.test(group.dataset.id ?? ""));
    return end ? getComputedStyle(end).display !== "none" : null;
  });
  check(await endShown(), "the emphasized end is shown at rest");
  await page.click(".number-line-zoom-in");
  check((await zoomState()).zoomed && await endShown(), "the emphasized end stays shown on the zoomed line");
  await page.evaluate(() => window.mounted.view.focusTargets([Object.keys(window.session.projection.board.nodes).find((id) => id.endsWith(":node:line"))]));
  check(!(await zoomState()).zoomed && await endShown(), "the emphasized end stays shown when the whole line comes back");
  // A line too short to zoom (0..4, already over 48 units a tick) still keeps the wheel from the board.
  await mountZoom(normalizeAuthoringLesson(lesson({ range: { min: 0, max: 4 }, ticks: { step: 1 } }), host("short")), "short");
  const short = await zoomState();
  check(short.buttons.in.disabled && short.buttons.out.disabled && short.buttons.whole.disabled, `a line that cannot zoom shows its buttons disabled: ${JSON.stringify(short.buttons)}`);
  const shortBox = await (await page.$(".number-line-preview")).boundingBox();
  await page.mouse.move(shortBox.x + shortBox.width / 2, shortBox.y + shortBox.height / 2);
  await page.mouse.wheel(0, -100);
  check(sameCamera((await zoomState()).camera, short.camera), "the wheel over a line that cannot zoom does not zoom the board");
  // A point dragged on a zoomed line lands on the same stop as on the whole line, and the card keeps its size.
  const dragTo = async (value) => {
    const state = await zoomState();
    const box = await (await page.$(".number-line-preview")).boundingBox();
    const handleBox = await (await page.$(".number-line-drag-handle")).boundingBox();
    const y = handleBox.y + handleBox.height / 2;
    await page.mouse.move(handleBox.x + handleBox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * (30 + 460 * (value - state.window[0]) / (state.window[1] - state.window[0])) / 520, y, { steps: 6 });
    await page.mouse.up();
    return zoomState();
  };
  await mountZoom(pages, "pages");
  const pagesRest = await zoomState();
  check(pagesRest.ticks === 71, `0..70 at 6.57 units a tick keeps every tick: ${pagesRest.ticks}`);
  const restDrag = await dragTo(52.3);
  await mountZoom(pages, "pages");
  for (let press = 0; press < 3; press += 1) await page.click(".number-line-zoom-in");
  const zoomedPages = await zoomState();
  const zoomDrag = await dragTo(52.3);
  check(restDrag.s === 52 && zoomDrag.s === 52, `a drag to 52.3 stops at 52 at rest and zoomed in: ${restDrag.s}, ${zoomDrag.s}`);
  check(zoomDrag.zoomed && zoomDrag.window.join() === zoomedPages.window.join() && zoomDrag.viewBox === pagesRest.viewBox, `the zoomed line stays put while its point is dragged: ${zoomedPages.window.join("..")} → ${zoomDrag.window.join("..")}`);
  check(zoomedPages.cardHeight === pagesRest.cardHeight, `the dragged card keeps its height zoomed: ${pagesRest.cardHeight}, ${zoomedPages.cardHeight}`);
  // Two fingers on the card zoom the line, not the board.
  const touchPage = await browser.newPage({ viewport: { width: 1000, height: 600 }, hasTouch: true });
  touchPage.on("pageerror", (error) => errors.push(error.message));
  await touchPage.goto(`http://127.0.0.1:${server.address().port}/`);
  await touchPage.waitForFunction(() => window.BrowserLessonSession);
  await touchPage.evaluate((events) => {
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "pinch");
    while (session.projection.status !== "completed") session.advance();
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    mounted.view.render(session.projection.board);
    Object.assign(window, { session, mounted });
  }, rounding);
  await settle(touchPage);
  const pinchState = () => touchPage.evaluate(() => {
    const strip = document.querySelector(".number-line-overview-window");
    return { width: Number(strip.getAttribute("width")), camera: window.mounted.view.getCameraState() };
  });
  const beforePinch = await pinchState();
  const pinchBox = await (await touchPage.$(".number-line-preview")).boundingBox();
  const client = await touchPage.context().newCDPSession(touchPage);
  const cy = pinchBox.y + pinchBox.height * 0.3, cx = pinchBox.x + pinchBox.width * 0.6;
  const fingers = (spread) => [{ x: cx - spread, y: cy, id: 1 }, { x: cx + spread, y: cy, id: 2 }];
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(20) });
  for (const spread of [30, 45, 60, 80, 100]) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(spread) });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const afterPinch = await pinchState();
  check(afterPinch.width < beforePinch.width * 0.4, `a pinch on the card zooms the line: strip ${beforePinch.width} → ${afterPinch.width}`);
  check(sameCamera(afterPinch.camera, beforePinch.camera), `a pinch on the card never zooms the board: ${JSON.stringify([beforePinch.camera, afterPinch.camera])}`);
  await touchPage.close();
  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("number line browser checks passed: drag through the session, dense labels, decimal labels, bound jump end, point values labelled on a thinned line, point names apart, several jumps (landing numbers, lanes for reversing moves, no crossing arcs, steady height), hidden answers kept back, steady geometry while dragging, tall cards measured, steady height as a lone jump end moves, emphasis (not pointing) reveals a hidden point, solution sets readable, the card's own zoom (thinned ticks at rest, buttons and limits, wheel and pinch on the line not the board, drag to move, same stops, steady size, whole line on the teaching camera)");
