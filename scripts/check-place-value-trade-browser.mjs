// Browser checks for the place-value trade card (decision 0026), with the runtime's own stylesheet, on a desktop
// window (about 1024 px wide; the card has no phone layout):
// - adding 4,658 + 1,573 (the task's own pair, never the lesson's 3,486 + 2,739) by real clicks: the arrow under a
//   column, a disk above the line, a ringed ten; a refused tap said at its column; the instruction line follows the
//   chart; the tap that completes the chart ends the task with no "done"; then the total typed; no answer numeral drawn;
// - subtracting 40,002 − 3,585: a short column's fact with its counts at the column, the disks that can break for it
//   marked, a borrow across zeros by clicking each marked disk, columns taken in any order; then the difference;
// - Chinese: 5000 − 2367, the card's words and the marked break in Chinese;
// - the program's demonstration: "columns finished" 0 -> 1 -> 2 plays each column's bring-down and trade, one
//   action after another, and 0 -> 1 on 50,003 − 2,476 plays the whole chain of breaks across the zeros; a learner's
//   tap animates;
// - the widest charts (six columns) at 1024 x 768, both operations and both languages: the card fits the window, the
//   disks' drawn size is logged, and a fact said at a six-column cell fits it; the narrowest (two columns) keep
//   their lines inside the card; emphasis on one column marks that column only.
// Numbers are the accepted sketch's. Screenshots go to OLL_PLACE_VALUE_TRADE_SCREENSHOTS when it is set.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { tradeHost, tradeLesson, tradeVariable } from "../dist/packages/plugin-math/test/place-value-trade-fixtures.js";

const index = (place) => place + 3;
const animate = (key, variable, value) => ({ key, say: "Look.", actions: [{ do: "animate", variable, value }] });
const lessons = {
  add: tradeLesson({ operation: "add", a: "3486", b: "2739", practice: [["4658", "1573"]] }),
  sub: tradeLesson({ operation: "subtract", a: "50003", b: "2476", practice: [["40002", "3585"]] }),
  zh: tradeLesson({ operation: "subtract", language: "zh-CN", a: "3000", b: "1468", practice: [["5000", "2367"]] }),
  demoAdd: tradeLesson({ operation: "add", a: "3486", b: "2739", beats: [animate("two", "finished", 2)] }),
  demoSub: tradeLesson({ operation: "subtract", a: "50003", b: "2476", beats: [animate("ones", "finished", 1)] }),
  emphasis: tradeLesson({ operation: "add", a: "3486", b: "2739",
    beats: [{ key: "tens", say: "Look at the tens.", actions: [{ do: "emphasize", target: "sum#tens", emphasis: "focus" }] }] }),
  widestAdd: tradeLesson({ operation: "add", a: "4999.99", b: "3999.99", practice: [["2999.99", "4999.99"]] }),
  widestSub: tradeLesson({ operation: "subtract", a: "9000", b: "2345.67", practice: [["8000", "3456.78"]] }),
  widestWhole: tradeLesson({ operation: "add", a: "389457", b: "247568", practice: [["456789", "278436"]] }),
  widestZh: tradeLesson({ operation: "subtract", language: "zh-CN", a: "9000", b: "2345.67", practice: [["8000", "3456.78"]] }),
  // The narrowest cards: two columns.
  narrowSub: tradeLesson({ operation: "subtract", a: "62", b: "37", practice: [["81", "45"]] }),
  narrowAdd: tradeLesson({ operation: "add", language: "zh-CN", a: "45", b: "38", practice: [["27", "56"]] }),
};
const events = Object.fromEntries(Object.entries(lessons).map(([name, authored]) => [name, normalizeAuthoringLesson(authored, tradeHost(name))]));

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
const shots = process.env.OLL_PLACE_VALUE_TRADE_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

/**
 * Plays a lesson to its end on a fresh board, its card live for the open task, the teaching camera framing the card;
 * `frame` a number is a host's reading floor (`setAutomaticCameraMinimumScale`) as well.
 */
const open = (page, name, { frame = true } = {}) => page.evaluate(({ events, name, frame }) => {
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
  if (typeof frame === "number") mounted.view.setAutomaticCameraMinimumScale(frame);
  if (frame) mounted.view.focusTargets([`${name}:node:sum`]);
  window.trade = { session, mounted };
}, { events: events[name], name, frame });

/** What the card shows: its lines, each column's disks per row, rings, marks, notes, live elements, tasks. */
const read = (page) => page.evaluate(() => {
  const svg = document.querySelector(".place-value-trade");
  const card = svg.closest(".board-node");
  const columns = {};
  for (const group of svg.querySelectorAll(".place-value-trade-place")) {
    const count = (row) => group.querySelectorAll(`.place-value-trade-disks .place-value-trade-disk[data-row="${row}"]`).length;
    columns[group.dataset.place] = {
      carry: count("carry"), top: count("top"), second: count("second"), answer: count("answer"),
      rings: group.querySelectorAll(".place-value-trade-ring").length, ten: group.querySelectorAll(".place-value-trade-ten").length,
      canBreak: group.querySelectorAll(".place-value-trade-can-break").length,
    };
  }
  const values = Object.fromEntries(Object.entries(window.trade.session.projection.board.variables).map(([k, v]) => [k, v.value]));
  return {
    given: card.querySelector(".place-value-trade-given")?.textContent ?? "", howto: card.querySelector(".place-value-trade-howto")?.textContent ?? "",
    notice: card.querySelector(".place-value-trade-notice")?.textContent ?? "", colnote: card.querySelector(".place-value-trade-colnote")?.textContent ?? "",
    colnoteAt: card.querySelector(".place-value-trade-note")?.closest(".place-value-trade-overlay") ? card.querySelector(".place-value-trade-note").getAttribute("x") : null,
    columns, live: svg.querySelectorAll(".place-value-trade-live").length, downs: [...svg.querySelectorAll(".place-value-trade-down")].filter((b) => b.getAttribute("visibility") !== "hidden").length,
    landing: svg.querySelectorAll(".place-value-trade-landing").length, arrows: svg.querySelectorAll(".place-value-trade-arrow").length,
    labels: [...svg.querySelectorAll(".place-value-trade-label")].map((label) => label.textContent), values, text: card.textContent,
    statuses: window.trade.session.studentTasks.map((task) => task.status), label: svg.getAttribute("aria-label"),
  };
});
const click = async (page, selector) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing to click: ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const down = (page, place) => click(page, `.place-value-trade-down[data-oll-tap="down:${index(place)}"] circle`);
const ring = (page, place) => click(page, `.place-value-trade-place[data-place="${place}"] .place-value-trade-ten[data-oll-tap] rect`);
const marked = (page) => click(page, ".place-value-trade-can-break[data-oll-tap] circle");
const cell = (page, place, row) => click(page, `.place-value-trade-place[data-place="${place}"] rect.place-value-trade-cell-${row}`);
const answer = (page, task, text) => page.evaluate(({ task, text }) => {
  const result = window.trade.session.submitStudentAnswer(task, text);
  window.trade.mounted.view.render(window.trade.session.projection.board);
  return result.status ?? "unreadable";
}, { task, text });

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);

  // Adding 4,658 + 1,573, by real clicks.
  await open(page, "add");
  let now = await read(page);
  check(now.given === "4,658 + 1,573" && now.values.a === 4_658_000, `the task shows its own pair, not the lesson's: ${JSON.stringify([now.given, now.values.a])}`);
  check(JSON.stringify(now.labels) === '["4,658","+ 1,573"]', `the rows are labelled like a written problem: ${JSON.stringify(now.labels)}`);
  check(now.howto === "Tap ↓ to put a column together." && now.downs === 4, `four ↓ and the first line: ${JSON.stringify([now.howto, now.downs])}`);
  check(JSON.stringify([3, 2, 1, 0].map((p) => [now.columns[p].top, now.columns[p].second, now.columns[p].answer])) === "[[4,1,0],[6,5,0],[5,7,0],[8,3,0]]", `row 1 and row 2 are the two numbers: ${JSON.stringify(now.columns)}`);
  // A trade before anything is below the line is refused, said at its column.
  await cell(page, 0, "answer");
  now = await read(page);
  check(now.colnote === "Nothing below the line here yet." && now.notice === "", `a refused tap is said at its column: ${JSON.stringify([now.colnote, now.notice])}`);
  await down(page, 0);
  now = await read(page);
  check(now.columns[0].answer === 11 && now.columns[0].ten === 1 && now.colnote === "", `↓ puts the ones together below the line, ten ringed: ${JSON.stringify(now.columns[0])}`);
  check(now.howto === "Tap the ringed ten to trade it for one 10." && now.landing === 1 && now.arrows === 1, `the line names the ringed ten; a landing spot and an arrow: ${JSON.stringify([now.howto, now.landing, now.arrows])}`);
  check(await page.evaluate(() => document.getAnimations().length > 0), "a learner's ↓ animates the disks coming down");
  if (shots) { await page.waitForTimeout(1300); await page.screenshot({ path: `${shots}/add-ring-en.png` }); }
  await ring(page, 0);
  now = await read(page);
  check(now.columns[0].answer === 1 && now.columns[1].carry === 1 && now.values[tradeVariable(0)] === 2, `ten ones become one 10 in the tens' carry spot: ${JSON.stringify([now.columns[0], now.columns[1]])}`);
  // A disk above the line brings its column down too; the carry comes with it.
  await click(page, `.place-value-trade-place[data-place="1"] .place-value-trade-disk[data-row="top"]`);
  now = await read(page);
  check(now.columns[1].answer === 13 && now.columns[1].carry === 0, `tapping a disk above the line brings the tens down with the carry: ${JSON.stringify(now.columns[1])}`);
  await page.focus(`.place-value-trade-place[data-place="1"] .place-value-trade-ten[data-oll-tap]`);
  await page.keyboard.press("Enter");
  now = await read(page);
  check(now.columns[2].carry === 1, `Enter on a focused ringed ten trades it: ${JSON.stringify(now.columns[2])}`);
  await down(page, 2);
  await click(page, `.place-value-trade-place[data-place="2"] .place-value-trade-disk[data-row="answer"]`);
  now = await read(page);
  check(now.columns[3].carry === 1 && JSON.stringify(now.statuses) === '["not_started","not_started"]', `a disk of the ringed ten trades it; taps are not attempts: ${JSON.stringify([now.columns[3], now.statuses])}`);
  await down(page, 3);
  now = await read(page);
  check(JSON.stringify(now.statuses) === '["succeeded","not_started"]' && now.live === 0, `the tap that completes the chart ends the task, with no "done": ${JSON.stringify([now.statuses, now.live])}`);
  check(JSON.stringify([3, 2, 1, 0].map((p) => now.columns[p].answer)) === "[6,2,3,1]" && !/6,?231/.test(now.text), `the answer row reads 6,231 in disks, never in digits: ${JSON.stringify(now.columns)} ${now.text}`);
  check(await answer(page, "answer-1", "6230") === "in_progress" && await answer(page, "answer-1", "6,231") === "succeeded", "the total is typed and read by the number reader");
  if (shots) { await page.waitForTimeout(1300); await page.screenshot({ path: `${shots}/add-done-en.png` }); }

  // Subtracting 40,002 − 3,585: a short column, a borrow across zeros, any order.
  await open(page, "sub");
  now = await read(page);
  check(now.given === "40,002 − 3,585" && now.columns[0].rings === 5, `row 2 is the take-away in dashed rings: ${JSON.stringify([now.given, now.columns[0]])}`);
  await down(page, 0);
  now = await read(page);
  check(now.colnote === "This column has 2; taking away 5 needs more.", `a short column's fact, with its counts, at its column: ${now.colnote}`);
  check(now.columns[4].canBreak === 4 && now.howto === "Tap a marked 10,000 to break it into ten 1,000s.", `the ten thousands are marked; the line names them: ${JSON.stringify([now.columns[4], now.howto])}`);
  if (shots) { await page.waitForTimeout(1300); await page.screenshot({ path: `${shots}/sub-short-en.png` }); }
  await marked(page);
  now = await read(page);
  check(now.columns[3].top === 10 && now.columns[3].ten === 1 && now.columns[3].canBreak === 10 && now.howto === "Tap a marked 1,000 to break it into ten 100s.", `one 10,000 into ten 1,000s, ringed; the chain goes on: ${JSON.stringify([now.columns[3], now.howto])}`);
  await marked(page);
  await marked(page);
  if (shots) { await page.waitForTimeout(1300); await page.screenshot({ path: `${shots}/sub-chain-en.png` }); }
  await marked(page);
  now = await read(page);
  check(now.columns[0].top === 12 && now.howto === "Tap ↓ to take away. Short? Break a disk from a column to the left into ten." && now.colnote === "", `the ones have 12; the marks and the fact are gone: ${JSON.stringify([now.columns[0], now.howto, now.colnote])}`);
  await click(page, `.place-value-trade-place[data-place="4"] .place-value-trade-disk[data-row="top"]`);
  now = await read(page);
  check(now.notice === "The thousands have 9; taking away 3 needs no more." || now.colnote === "The thousands have 9; taking away 3 needs no more.", `a break not needed is refused with the facts: ${JSON.stringify([now.notice, now.colnote])}`);
  for (const place of [4, 3, 1, 2, 0]) await down(page, place);
  now = await read(page);
  check(JSON.stringify(now.statuses) === '["succeeded","not_started"]' && JSON.stringify([4, 3, 2, 1, 0].map((p) => now.columns[p].answer)) === "[3,6,4,1,7]", `taken in any order; complete: ${JSON.stringify([now.statuses, now.columns])}`);
  check(await answer(page, "answer-1", "３６４１７") === "succeeded", "the difference is typed in full-width digits and read");

  // Chinese: 5000 − 2367.
  await open(page, "zh");
  now = await read(page);
  check(now.label === "在数位表上加减" && now.given === "5000 − 2367" && now.howto === "点 ↓ 拿走。不够时，把左边某一位的一个圆片拆成十个。", `the card speaks Chinese: ${JSON.stringify([now.label, now.given, now.howto])}`);
  await down(page, 0);
  now = await read(page);
  check(now.colnote === "这一位只有 0 个，拿走 7 个不够。" && now.howto === "点一个标出的一千，把它拆成十个一百。", `the short column in Chinese: ${JSON.stringify([now.colnote, now.howto])}`);
  if (shots) { await page.waitForTimeout(1300); await page.screenshot({ path: `${shots}/sub-short-zh.png` }); }

  // The program's demonstration: columns finished 0 -> 1 -> 2, each column's actions one after another.
  const demo = await page.evaluate(async ({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "demoAdd", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const find = () => Object.values(session.projection.board?.nodes ?? {}).find((candidate) => candidate.kind === "place_value_trade");
    for (let step = 0; step < 20 && !find(); step += 1) session.advance();
    mounted.view.render(session.projection.board);
    const board = structuredClone(session.projection.board);
    const node = Object.values(board.nodes).find((candidate) => candidate.kind === "place_value_trade");
    const count = (place, row) => document.querySelectorAll(`.place-value-trade-place[data-place="${place}"] .place-value-trade-disk[data-row="${row}"]`).length;
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    const seen = [];
    for (const finished of [0.5, 1]) { node.content.finished = finished; mounted.view.render(structuredClone(board)); }
    seen.push(["ones down", count(0, "answer"), count(1, "carry")]);
    await wait(1400);
    seen.push(["ones traded", count(0, "answer"), count(1, "carry")]);
    node.content.finished = 2;
    mounted.view.render(structuredClone(board));
    seen.push(["tens down", count(1, "answer"), count(1, "carry"), count(2, "carry")]);
    await wait(1500);
    seen.push(["tens traded", count(1, "answer"), count(2, "carry")]);
    return seen;
  }, { events: events.demoAdd });
  check(JSON.stringify(demo) === '[["ones down",15,0],["ones traded",5,1],["tens down",12,0,0],["tens traded",2,1]]',
    `columns finished plays each bring-down, then its trade: ${JSON.stringify(demo)}`);
  const chain = await page.evaluate(async ({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "demoSub", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const find = () => Object.values(session.projection.board?.nodes ?? {}).find((candidate) => candidate.kind === "place_value_trade");
    for (let step = 0; step < 20 && !find(); step += 1) session.advance();
    mounted.view.render(session.projection.board);
    const board = structuredClone(session.projection.board);
    const node = Object.values(board.nodes).find((candidate) => candidate.kind === "place_value_trade");
    const tops = () => [4, 3, 2, 1, 0].map((place) => document.querySelectorAll(`.place-value-trade-place[data-place="${place}"] .place-value-trade-disk[data-row="top"]`).length).join(" ");
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    node.content.finished = 1;
    mounted.view.render(structuredClone(board));
    const seen = [tops()];
    for (let i = 0; i < 5; i += 1) { await wait(870); seen.push(tops()); }
    return seen;
  }, { events: events.demoSub });
  check(JSON.stringify(chain) === '["4 10 0 0 3","4 9 10 0 3","4 9 9 10 3","4 9 9 9 13","4 9 9 9 0","4 9 9 9 0"]',
    `one column finished on 50,003 − 2,476 breaks across the zeros, one disk at a time, then takes away: ${JSON.stringify(chain)}`);
  if (shots) await page.screenshot({ path: `${shots}/demo-chain-en.png` });

  // Emphasis on one column marks that column only.
  const emphasized = await page.evaluate(({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "emphasis", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    while (session.projection.status !== "completed") session.advance();
    mounted.view.render(session.projection.board);
    return [...document.querySelectorAll(".place-value-trade-place")].filter((group) => group.classList.contains("emphasis-focus")).map((group) => group.dataset.place);
  }, { events: events.emphasis });
  check(JSON.stringify(emphasized) === '["1"]', `emphasis on the tens marks the tens only: ${JSON.stringify(emphasized)}`);

  // The widest charts at 1024 x 768: six columns fit the window; the disks' drawn size is logged, with the board's
  // own teaching camera (which composes a card well inside the window) and with a host's floor of 1 (natural size).
  const measure = () => page.evaluate(() => {
    const card = document.querySelector(".place-value-trade").closest(".board-node").getBoundingClientRect();
    const disks = [...document.querySelectorAll(".place-value-trade-disk-face")].map((disk) => disk.getBoundingClientRect().width);
    return { left: card.left, right: card.right, disk: Math.min(...disks) };
  });
  for (const name of ["add", "sub"]) {
    await open(page, name);
    await page.waitForTimeout(700);
    const size = await measure();
    console.log(`${name} (${name === "add" ? 4 : 5} columns) at 1024x768, the board's camera: disk ${size.disk.toFixed(1)} px, card ${(size.right - size.left).toFixed(0)} px wide`);
  }
  for (const name of ["widestAdd", "widestSub", "widestWhole", "widestZh"]) {
    await open(page, name, { frame: 1 });
    await page.waitForTimeout(700);
    const natural = await measure();
    check(natural.left >= 0 && natural.right <= 1024, `${name}: at its natural size six columns still fit a 1,024 px window: ${JSON.stringify(natural)}`);
    console.log(`${name} at 1024x768 with a floor of 1: disk ${natural.disk.toFixed(1)} px, card ${(natural.right - natural.left).toFixed(0)} px wide (${natural.left.toFixed(0)} to ${natural.right.toFixed(0)})`);
    if (shots) await page.screenshot({ path: `${shots}/widest-1024-natural-${name}.png` });
    await open(page, name);
    await page.waitForTimeout(700);
    const size = await page.evaluate(() => {
      const card = document.querySelector(".place-value-trade").closest(".board-node").getBoundingClientRect();
      const disks = [...document.querySelectorAll(".place-value-trade-disk-face")].map((disk) => disk.getBoundingClientRect().width);
      const downs = [...document.querySelectorAll(".place-value-trade-down circle")].map((button) => button.getBoundingClientRect().width);
      return { left: card.left, right: card.right, top: card.top, bottom: card.bottom, disk: Math.min(...disks), down: Math.min(...downs), columns: document.querySelectorAll(".place-value-trade-place").length, scroll: document.documentElement.scrollWidth };
    });
    check(size.columns === 6 && size.left >= 0 && size.right <= 1024 && size.scroll <= 1024, `${name}: six columns fit a 1,024 px window: ${JSON.stringify(size)}`);
    console.log(`${name} at 1024x768 (the teaching camera framing the card): disk ${size.disk.toFixed(1)} px, ↓ ${size.down.toFixed(1)} px, card ${(size.right - size.left).toFixed(0)} x ${(size.bottom - size.top).toFixed(0)} px`);
    if (shots) await page.screenshot({ path: `${shots}/widest-1024-${name}.png` });
  }
  // A fact said at a column fits its cell on the narrowest columns (six), in both languages.
  const noteFits = () => page.evaluate(() => {
    const object = document.querySelector(".place-value-trade-note"), note = document.querySelector(".place-value-trade-colnote");
    if (!object || !note) return null;
    const box = object.getBoundingClientRect(), text = note.getBoundingClientRect();
    return { text: note.textContent, fits: text.height <= box.height + 1 && text.width <= box.width + 1, note: Math.round(text.height), cell: Math.round(box.height) };
  });
  for (const name of ["widestSub", "widestZh"]) {
    await open(page, name);
    await page.waitForTimeout(500);
    await down(page, -2);
    const fit = await noteFits();
    check(fit?.fits === true, `${name}: the short column's fact fits its six-column cell: ${JSON.stringify(fit)}`);
    if (shots) await page.screenshot({ path: `${shots}/widest-note-${name}.png` });
  }
  // The narrowest cards keep the problem, the line (on two lines if it must), the chart and the notice inside the card.
  for (const name of ["narrowSub", "narrowAdd"]) {
    await open(page, name);
    await page.waitForTimeout(500);
    await down(page, 0);
    await page.waitForTimeout(900);
    const inside = await page.evaluate(() => {
      const card = document.querySelector(".place-value-trade").closest(".board-node");
      const bottom = Math.max(...[...card.querySelectorAll(".place-value-trade-given, .place-value-trade-howto, .place-value-trade, .place-value-trade-notice")].map((element) => element.getBoundingClientRect().bottom));
      return { howto: card.querySelector(".place-value-trade-howto").textContent, overflow: card.scrollHeight - card.clientHeight, lastBottom: Math.round(bottom), cardBottom: Math.round(card.getBoundingClientRect().bottom) };
    });
    check(inside.overflow <= 1 && inside.lastBottom <= inside.cardBottom, `${name}: everything stays inside a two-column card: ${JSON.stringify(inside)}`);
    if (shots) await page.screenshot({ path: `${shots}/narrow-${name}.png` });
  }
  check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`place-value trade browser checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("place-value trade browser checks passed: 4,658 + 1,573 added by real clicks (↓, a disk above the line, a ringed ten, Enter), a refused tap said at its column, the line following the chart, the task ended by the completing tap with no done, the total typed; 40,002 − 3,585 with its short column's counts, the marked chain of breaks and any order, the difference typed in full-width digits; Chinese words; the demonstration playing each column's actions one after another, the chain across zeros included; emphasis on one column; six columns fitting 1,024 px in both operations and languages");
