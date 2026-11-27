// Browser checks for the make-ten card (decision 0027), with the runtime's own stylesheet, on a desktop window
// (1024 x 768; the card has no phone layout):
// - 7 + 5 (the task's own pair, never the lesson's 8 + 6) by real clicks: the first screen (live counts, the line
//   naming the giving colour in that colour, the movable counters marked, dashed places only in the bigger frame,
//   the arrow before the first move); a red counter refused with a fact at its frame, the counter ringed in grey and
//   the movable ones pointed out; the blue counter clicked is the one that crosses, the frame it left closes up; a
//   counter that crossed clicked goes back; Enter on a focused counter taps it; the click that makes the ten ends
//   the task with no "done"; then the row of four blanks; the split (the number moved, 3) and the total (12) are
//   never drawn before they are typed; the ones left is drawn, by design, as the second frame's live count;
// - Chinese: 3 + 8, the line and the refusal in Chinese, the colour word in its colour;
// - the program's demonstration: the lesson animates the count in the bigger frame 8 -> 10 and the card moves one
//   counter at a time; then the practice start lays its own pair fresh;
// - the card fits a 1,024 px window; counters are drawn at least 30 px at the teaching camera's framing (the drawn
//   size is logged; the card's own counters are 50 units).
// Pairs are the accepted sketch's. Screenshots go to OLL_MAKE_TEN_SCREENSHOTS when it is set.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { makeTenHost, makeTenLesson } from "../dist/packages/plugin-math/test/make-ten-fixtures.js";

const animate = (key, variable, value) => ({ key, say: "Look.", actions: [{ do: "animate", variable, value }] });
const lessons = {
  en: makeTenLesson({ a: 8, b: 6, practice: [[7, 5]] }),
  zh: makeTenLesson({ a: 4, b: 9, language: "zh-CN", practice: [[3, 8]] }),
  demo: makeTenLesson({ a: 8, b: 6, practice: [[7, 5]], beats: [animate("ten", "filled", 10)] }),
};
const events = Object.fromEntries(Object.entries(lessons).map(([name, authored]) => [name, normalizeAuthoringLesson(authored, makeTenHost(name))]));

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
    : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>html,body{margin:0}</style><div id="board" style="position:relative;width:100vw;height:100vh"></div><script type="module" src="/probe.js"></script>');
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const executablePath = process.env.OLL_CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => existsSync(path));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const shots = process.env.OLL_MAKE_TEN_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

/** Plays a lesson to its end on a fresh board, its card live for the open task, the teaching camera framing the card. */
const open = (page, name) => page.evaluate(({ events, name }) => {
  document.querySelector("#board").replaceChildren();
  localStorage.clear();
  const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), name, { reducedMotion: true });
  const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
  while (session.projection.status !== "completed") session.advance();
  mounted.view.setCardTapHandler({
    live: (id) => session.studentCardLive(id),
    tap: (id, tap, input) => { const result = session.tapStudentCard(id, tap, input); mounted.view.render(session.projection.board); return result; },
  });
  mounted.view.render(session.projection.board);
  mounted.view.focusTargets([`${name}:node:frames`]);
  window.mt = { session, mounted };
}, { events: events[name], name });

/** What the card shows: its lines, each frame's counters (by colour and piece, in place order), marks, notes, tasks. */
const read = (page) => page.evaluate(() => {
  const svg = document.querySelector("svg.make-ten");
  const card = svg.closest(".board-node");
  const frames = [0, 1].map((frame) => {
    const counters = [...svg.querySelectorAll(`.make-ten-counter[data-frame="${frame}"]`)];
    return {
      caption: svg.querySelector(`.make-ten-caption[data-frame="${frame}"]`)?.textContent,
      red: counters.filter((c) => c.classList.contains("make-ten-c0")).length, blue: counters.filter((c) => c.classList.contains("make-ten-c1")).length,
      pieces: counters.map((c) => c.dataset.piece), movable: counters.filter((c) => c.classList.contains("make-ten-movable")).length,
      landing: 0, full: svg.querySelector(`.make-ten-frame[data-frame="${frame}"]`)?.classList.contains("make-ten-full") ?? false,
    };
  });
  // Dashed places: count those inside each frame's box.
  for (const circle of svg.querySelectorAll(".make-ten-landing")) {
    const x = Number(circle.getAttribute("cx"));
    const box0 = svg.querySelector('.make-ten-frame[data-frame="1"] .make-ten-place');
    frames[x < Number(box0.getAttribute("x")) ? 0 : 1].landing += 1;
  }
  const note = card.querySelector(".make-ten-note");
  const values = Object.fromEntries(Object.entries(window.mt.session.projection.board.variables).map(([k, v]) => [k, v.value]));
  return {
    given: card.querySelector(".make-ten-given")?.textContent ?? "", howto: card.querySelector(".make-ten-howto")?.textContent ?? "",
    howtoColour: [...card.querySelectorAll(".make-ten-howto .make-ten-cword")].map((word) => `${word.textContent}:${word.className.match(/make-ten-n(\d)/)?.[1]}`),
    note: note?.textContent ?? "", noteAt: note?.dataset.frame ?? null, noteColour: [...card.querySelectorAll(".make-ten-note .make-ten-cword")].map((word) => word.className.match(/make-ten-n(\d)/)?.[1]),
    refused: [...svg.querySelectorAll(".make-ten-refused")].map((c) => c.dataset.piece), pointing: [...svg.querySelectorAll(".make-ten-movable-ring")].map((ring) => ring.getAttribute("stroke-width")),
    arrow: svg.querySelector(".make-ten-arrow")?.dataset.to ?? null, frames, live: svg.querySelectorAll("[data-oll-tap]").length, text: card.textContent, values,
    statuses: window.mt.session.studentTasks.map((task) => task.status), label: svg.getAttribute("aria-label"),
  };
});
const click = async (page, selector) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing to click: ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const counter = (frame, colour, nth = 0) => `.make-ten-counter[data-frame="${frame}"].make-ten-c${colour} >> nth=${nth}`;
const row = (page, task, answers) => page.evaluate(({ task, answers }) => {
  const result = window.mt.session.submitStudentRow(task, answers);
  window.mt.mounted.view.render(window.mt.session.projection.board);
  return result.status ?? "unreadable";
}, { task, answers });

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);

  // 7 + 5, the task's own pair, by real clicks.
  await open(page, "en");
  let now = await read(page);
  check(now.given === "7 + 5" && now.values.a === 7 && now.values.filled === 7, `the task shows its own pair, fresh: ${JSON.stringify([now.given, now.values])}`);
  check(now.frames[0].caption === "7" && now.frames[1].caption === "5" && now.frames[0].red === 7 && now.frames[1].blue === 5, `each frame its addend, apart: ${JSON.stringify(now.frames)}`);
  // The live counts are the hook a host anchors the row of blanks to: one `.make-ten-caption` per frame, by `data-frame`.
  check(await page.evaluate(() => [...document.querySelectorAll("svg.make-ten .make-ten-caption")].map((caption) => caption.dataset.frame).join()) === "0,1", "one .make-ten-caption per frame (data-frame 0 and 1), the host's answer anchor");
  check(now.howto === "Make a ten: tap a blue counter to fill the empty places." && JSON.stringify(now.howtoColour) === '["blue:1"]', `the line names the giving colour, in that colour: ${JSON.stringify([now.howto, now.howtoColour])}`);
  check(now.frames[1].movable === 5 && now.frames[0].movable === 0 && now.frames[0].landing === 3 && now.frames[1].landing === 0 && now.arrow === "0",
    `the blue counters marked, dashed places only in the 7's frame, an arrow toward them: ${JSON.stringify([now.frames, now.arrow])}`);
  if (shots) await page.screenshot({ path: `${shots}/first-en.png` });
  // A red counter stays: a fact at its frame, that counter ringed in grey, the blue ones pointed out.
  const red = await page.locator(counter(0, 0, 2)).getAttribute("data-piece");
  await click(page, counter(0, 0, 2));
  now = await read(page);
  check(now.note === "Red counters stay in their frame." && now.noteAt === "0" && JSON.stringify(now.noteColour) === '["0"]', `a refused red counter: a fact at its frame, its colour word in red: ${JSON.stringify([now.note, now.noteAt, now.noteColour])}`);
  check(JSON.stringify(now.refused) === JSON.stringify([red]) && now.frames[1].movable === 5 && now.pointing.length === now.frames[1].movable && now.pointing.every((width) => width === "3") && now.frames[0].red === 7, `that counter ringed, the movable ones pointed out, nothing moved: ${JSON.stringify([now.refused, now.pointing])}`);
  if (shots) await page.screenshot({ path: `${shots}/refused-en.png` });
  // The blue counter clicked (the third) is the one that crosses; its frame closes up.
  const blue = await page.locator(counter(1, 1, 2)).getAttribute("data-piece");
  await click(page, counter(1, 1, 2));
  now = await read(page);
  check(now.frames[0].pieces.at(-1) === blue && now.frames[1].blue === 4 && now.note === "" && now.refused.length === 0, `the blue counter clicked crossed into the 7's frame; the fact cleared: ${JSON.stringify(now.frames)}`);
  check(now.frames[0].caption === "8" && now.frames[1].caption === "4" && now.arrow === null && now.howto === "Keep tapping blue counters until the frame is full. A counter that crossed goes back when tapped.", `the counts follow, 8 and 4; the arrow is gone: ${JSON.stringify([now.frames.map((f) => f.caption), now.arrow, now.howto])}`);
  check(now.values.moved === 1 && JSON.stringify(now.statuses) === '["not_started","not_started"]', `taps are not attempts: ${JSON.stringify([now.values.moved, now.statuses])}`);
  // The crossed counter clicked goes home.
  await click(page, `.make-ten-counter[data-piece="${blue}"]`);
  now = await read(page);
  check(now.frames[1].pieces.includes(blue) && now.frames[0].caption === "7" && now.values.moved === 0, `the crossed counter goes back: ${JSON.stringify(now.frames)}`);
  // Enter on a focused blue counter taps it; two more clicks make the ten, and that click ends the task.
  await page.focus(`.make-ten-counter[data-frame="1"].make-ten-c1`);
  await page.keyboard.press("Enter");
  check((await read(page)).values.moved === 1, "Enter on a focused counter taps it");
  await click(page, counter(1, 1, 0));
  if (shots) await page.screenshot({ path: `${shots}/nine-en.png` });
  await click(page, counter(1, 1, 0));
  now = await read(page);
  check(JSON.stringify(now.statuses) === '["succeeded","not_started"]' && now.live === 0 && now.frames[0].full, `the click that makes the ten ends the task, with no "done": ${JSON.stringify([now.statuses, now.live])}`);
  check(now.frames[0].caption === "10" && now.frames[1].caption === "2" && !/\b12\b/.test(now.text) && !/\b3\b/.test(now.text),
    `ten and 2; neither the split (3) nor the total (12) is drawn before the row is typed: ${JSON.stringify(now.frames.map((f) => f.caption))} ${now.text}`);
  if (shots) await page.screenshot({ path: `${shots}/ten-en.png` });
  check(await row(page, "row-1", { "to-ten": "2", rest: "3", ones: "2", total: "12" }) === "in_progress" && await row(page, "row-1", { "to-ten": "3", rest: "2", ones: "2", total: "12" }) === "succeeded",
    "the row: the part beside the 7 makes ten (3 + 2, not 2 + 3)");

  // Chinese: 3 + 8, the 8's frame fills from the red 3.
  await open(page, "zh");
  now = await read(page);
  check(now.label === "两个十格框凑十" && now.given === "3 + 8" && now.howto === "凑成十：点红色的圆片，把空位填满。" && JSON.stringify(now.howtoColour) === '["红色:0"]', `the card speaks Chinese: ${JSON.stringify([now.label, now.given, now.howto, now.howtoColour])}`);
  check(now.frames[1].landing === 2 && now.frames[0].landing === 0 && now.arrow === "1" && now.frames[0].movable === 3, `the 8's frame has the dashed places; the arrow points to it: ${JSON.stringify([now.frames, now.arrow])}`);
  await click(page, counter(1, 1, 0));
  now = await read(page);
  check(now.note === "蓝色的圆片留在自己的框里。" && now.noteAt === "1", `the refusal in Chinese: ${JSON.stringify([now.note, now.noteAt])}`);
  if (shots) await page.screenshot({ path: `${shots}/refused-zh.png` });

  // The program's demonstration, played by the lesson itself (its own animate of the count in the bigger frame,
  // 8 -> 10, with motion): one counter at a time; then the practice start lays its own pair fresh.
  const demo = await page.evaluate(async ({ events }) => {
    document.querySelector("#board").replaceChildren();
    localStorage.clear();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "demo", { reducedMotion: false });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    const node = () => Object.values(session.projection.board?.nodes ?? {}).find((candidate) => candidate.kind === "make_ten");
    const read = () => [0, 1].map((frame) => document.querySelectorAll(`.make-ten-counter[data-frame="${frame}"]`).length).join(",");
    const seen = [];
    const note = () => { const now = read(); if (seen.at(-1) !== now) seen.push(now); };
    for (let i = 0; i < 400 && !(Number(node()?.content.filled) >= 10); i += 1) { session.advance(); mounted.view.render(session.projection.board); note(); await wait(20); }
    for (let t = 0; t < 30; t += 1) { await wait(100); mounted.view.render(session.projection.board); note(); }
    for (let i = 0; i < 400 && session.projection.status !== "completed"; i += 1) { session.advance(); mounted.view.render(session.projection.board); await wait(20); }
    for (let t = 0; t < 10; t += 1) { await wait(100); mounted.view.render(session.projection.board); }
    return { seen, after: read(), given: document.querySelector(".make-ten-given")?.textContent, values: Object.fromEntries(Object.entries(session.projection.board.variables).map(([k, v]) => [k, v.value])) };
  }, { events: events.demo });
  check(JSON.stringify(demo.seen.filter((state) => state !== "0,0").slice(0, 3)) === '["8,6","9,5","10,4"]', `the lesson's 8 -> 10 moves one counter at a time: ${JSON.stringify(demo.seen)}`);
  check(demo.given === "7 + 5" && demo.after === "7,5" && demo.values.filled === 7 && demo.values.moved === 0, `then a fresh practice on its own pair: ${JSON.stringify(demo)}`);

  // The card fits a 1,024 px window; counters are drawn big enough to tap.
  await open(page, "en");
  await page.waitForTimeout(500);
  const size = await page.evaluate(() => {
    const card = document.querySelector("svg.make-ten").closest(".board-node").getBoundingClientRect();
    const faces = [...document.querySelectorAll(".make-ten-counter-face")].map((face) => face.getBoundingClientRect().width);
    return { left: card.left, right: card.right, top: card.top, bottom: card.bottom, counter: Math.min(...faces), scroll: document.documentElement.scrollWidth };
  });
  check(size.left >= 0 && size.right <= 1024 && size.scroll <= 1024, `the card fits a 1,024 px window: ${JSON.stringify(size)}`);
  check(size.counter >= 30, `counters stay big enough to tap at the teaching camera: ${size.counter.toFixed(1)} px`);
  console.log(`make-ten at 1024x768 (the teaching camera framing the card): counter ${size.counter.toFixed(1)} px, card ${(size.right - size.left).toFixed(0)} x ${(size.bottom - size.top).toFixed(0)} px`);
  check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`make-ten browser checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("make-ten browser checks passed: 7 + 5 by real clicks (the line naming blue in blue, the blue counters marked, dashed places and an arrow toward the 7's frame), a red counter refused with a fact at its frame and ringed while the movable ones are pointed out, the clicked blue counter crossing and coming back, Enter, the click that makes the ten ending the task with no done, the row answered in the owner's order; Chinese words and refusal; the lesson's demonstration moving one counter at a time, then a fresh practice; the card fitting 1,024 px");
