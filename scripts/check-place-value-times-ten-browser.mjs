// Browser checks for the place-value times-ten card (decision 0028), with the runtime's own stylesheet, on a desktop
// window (1024 x 768; the card has no phone layout):
// - a count, practised as 5 ones = ? hundredths (the task's own problem, never the lesson's 3 tenths): by real
//   clicks, a one breaks into a row of ten tenths on its own row, a row of ten breaks into a square of a hundred;
//   the instruction (in one place under the problem) names every kind that can be tapped; a tap on the target
//   column is refused with a fact; the tap that completes the chart ends the task with no "done"; then the card's
//   answer row; no answer numeral drawn;
// - a times pair, practised as 4,000 is ? times 400: ten empty copies of the 400, numbered; each thousand broken
//   deals one hundred into every copy, at the slot under it; a copy's fact said beside that copy; the smaller
//   number's fact; ten whole copies; the row of two blanks;
// - a stated times pair whose digit is 1 (0028 revision 4), practised as 1,000,000 is ? times 100,000: the card's
//   narrowest copies column holds its head and its copy numbers; a copy's fact and the smaller number's are said;
//   one tap fills all ten copies;
// - Chinese: put-together questions (300 ones = ? hundreds: squares of a hundred into rows of ten, rows into one;
//   60 thousandths = ? hundredths), the card's words in Chinese;
// - the largest cards (9 ones -> hundredths, 9,000,000 vs 900,000), each a lesson's practice card (the card the
//   learner works), fit the window and keep their height while worked; every disk's label fits its disk (a wide
//   place value, 1,000,000, squeezed to it); the answer's element (`.place-value-times-ten-answer`) is a count's
//   target column and a times pair's copy numbers.
// Numbers are the accepted sketch's. Screenshots go to OLL_PLACE_VALUE_TIMES_TEN_SCREENSHOTS when it is set.
// - the program's demonstration: "counted in" 0.1 -> 0.01 -> 0.001 breaks every tenth, then every row; 700 counted in
//   70s deals every hundred into ten whole copies; played by the session with motion, one row at a time; then the
//   practice opens fresh on its own problem;
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { timesTenHost, timesTenLesson } from "../dist/packages/plugin-math/test/place-value-times-ten-fixtures.js";

const animate = (key, value) => ({ key, say: "Look.", actions: [{ do: "animate", variable: "counted_in", value }] });
const lessons = {
  count: timesTenLesson({ amount: "0.3", target: "0.001", practice: [["5", "0.01"]] }),
  times: timesTenLesson({ amount: "700", target: "70", practice: [["4000", "400"]] }),
  digitOne: timesTenLesson({ amount: "100", target: "10", shape: { question: "times", toward: "right", apart: 1 }, practice: [["1000000", "100000"]] }),
  zh: timesTenLesson({ language: "zh-CN", amount: "0.8", target: "0.1", start: "0.001", practice: [["300", "100"]] }),
  zhOne: timesTenLesson({ language: "zh-CN", amount: "2000", target: "1000", start: "100", practice: [["0.06", "0.01"]] }),
  // The largest problems are the practice cards: those are the cards worked (opened at frame 1).
  widestCount: timesTenLesson({ amount: "9000", target: "10", practice: [["9", "0.01"]] }),
  widestTimes: timesTenLesson({ amount: "90", target: "9", practice: [["9000000", "900000"]] }),
  // The lesson's own demonstration: "counted in" 0.1 -> 0.01, then 0.001; 700 counted in hundreds, then in 70s.
  demoCount: timesTenLesson({ amount: "0.3", target: "0.001", beats: [animate("hundredths", 10), animate("thousandths", 1)] }),
  demoHalf: timesTenLesson({ amount: "0.3", target: "0.001", beats: [animate("hundredths", 10)] }),
  demoTimes: timesTenLesson({ amount: "700", target: "70", practice: [["4000", "400"]], beats: [animate("seventies", 70_000)] }),
};
const events = Object.fromEntries(Object.entries(lessons).map(([name, authored]) => [name, normalizeAuthoringLesson(authored, timesTenHost(name))]));

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
const shots = process.env.OLL_PLACE_VALUE_TIMES_TEN_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

/** Plays a lesson to its end on a fresh board, its card live for the open task, the camera framing the card. */
const open = (page, name, { frame } = {}) => page.evaluate(({ events, name, frame }) => {
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
  mounted.view.focusTargets([`${name}:node:chart`]);
  window.tens = { session, mounted };
}, { events: events[name], name, frame });

/** What the card shows: its lines, each column's things, the copies, live elements, tasks, variables. */
const read = (page) => page.evaluate(() => {
  const svg = document.querySelector(".place-value-times-ten");
  const card = svg.closest(".board-node");
  const columns = {};
  for (const layer of svg.querySelectorAll(".place-value-times-ten-things")) {
    const own = (selector) => [...layer.children].filter((child) => child.matches(selector));
    columns[layer.dataset.place] = { disks: own(".place-value-times-ten-disk").length, rows: own(".place-value-times-ten-ten").length, squares: own(".place-value-times-ten-square").length };
  }
  const copies = [...svg.querySelectorAll(".place-value-times-ten-things .place-value-times-ten-copy")].map((copy) => ({
    have: copy.querySelectorAll(".place-value-times-ten-disk").length, full: copy.classList.contains("place-value-times-ten-copy-full"),
    number: copy.querySelector(".place-value-times-ten-number")?.textContent ?? "",
  }));
  const values = Object.fromEntries(Object.entries(window.tens.session.projection.board.variables).map(([k, v]) => [k, v.value]));
  const box = (selector) => { const r = card.querySelector(selector)?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } : null; };
  return {
    given: card.querySelector(".place-value-times-ten-given")?.textContent ?? "", howto: card.querySelector(".place-value-times-ten-howto")?.textContent ?? "",
    notice: card.querySelector(".place-value-times-ten-notice")?.textContent ?? "", colnote: card.querySelector(".place-value-times-ten-colnote")?.textContent ?? "",
    columns, copies, live: svg.querySelectorAll(".place-value-times-ten-live").length, ready: svg.querySelectorAll(".place-value-times-ten-ready").length,
    labels: [...svg.querySelectorAll(".place-value-times-ten-label")].map((label) => label.textContent), values, text: card.textContent,
    statuses: window.tens.session.studentTasks.map((task) => task.status), howtoBox: box(".place-value-times-ten-howto"), givenBox: box(".place-value-times-ten-given"),
    card: (() => { const r = card.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), overflow: card.scrollHeight - card.clientHeight, width: card.offsetWidth, height: card.offsetHeight }; })(),
    // Where the instruction sits in the card, in the card's own units (the camera's zoom aside).
    howtoAt: card.querySelector(".place-value-times-ten-howto")?.offsetTop ?? null,
  };
});
/** Clicks the middle of an element once the card's moves have finished animating (a moving piece is clicked where it lands). */
const click = async (page, selector) => {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity));
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing to click: ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const tapAt = (page, tap) => click(page, `[data-oll-tap="${tap}"]`);
const row = (page, task, answers) => page.evaluate(({ task, answers }) => {
  const result = window.tens.session.submitStudentRow(task, answers);
  window.tens.mounted.view.render(window.tens.session.projection.board);
  return result.status ?? "unreadable";
}, { task, answers });
/** The middle height of the thing a row's tap moves, in the chart's own units. */
const thingTop = (page, i) => page.evaluate((i) => {
  const node = document.querySelector(`.place-value-times-ten [data-i="${i}"]`);
  if (!node) return null;
  const box = node.getBBox();
  return Math.round(box.y + box.height / 2);
}, i);

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);

  // A count: 5 ones = ? hundredths, by real clicks.
  await open(page, "count");
  let now = await read(page);
  check(now.given === "5 ones = ? hundredths" && now.values.amount === 5000 && now.values.counted_in === 1000, `the task shows its own problem, counted in its own start unit: ${JSON.stringify([now.given, now.values])}`);
  check(now.howto === "Tap a one to break it into ten tenths." && now.ready === 5 && now.live === 5, `the first line and five tappable ones: ${JSON.stringify([now.howto, now.ready, now.live])}`);
  check(JSON.stringify(now.columns) === '{"0":{"disks":5,"rows":0,"squares":0},"-1":{"disks":0,"rows":0,"squares":0},"-2":{"disks":0,"rows":0,"squares":0}}', `five ones, the other columns empty: ${JSON.stringify(now.columns)}`);
  const howtoTop = now.howtoAt;
  const before = await thingTop(page, 3);
  await tapAt(page, "move:3");
  now = await read(page);
  const after = await thingTop(page, 3);
  check(now.columns[-1].rows === 1 && now.columns[0].disks === 4 && now.values.moved_once === 8, `the tapped one is a row of ten tenths: ${JSON.stringify([now.columns, now.values.moved_once])}`);
  check(before !== null && after !== null && Math.abs(before - after) < 2, `its ten sit on its own row, one column over: ${JSON.stringify([before, after])}`);
  check(now.howto === "Tap a one to break it into ten tenths. Tap a row of ten tenths to break it into a hundred hundredths." && now.ready === 5, `the line names both kinds that can be tapped; all five are marked: ${JSON.stringify([now.howto, now.ready])}`);
  check(now.howtoAt === howtoTop, `the line keeps its place under the problem, though it is longer: ${JSON.stringify([howtoTop, now.howtoAt])}`);
  if (shots) await page.screenshot({ path: `${shots}/count-after-one.png` });
  await tapAt(page, "move:3");
  now = await read(page);
  check(now.columns[-2].squares === 1 && now.values.moved_twice === 8, `the row of ten is a square of a hundred hundredths: ${JSON.stringify([now.columns, now.values.moved_twice])}`);
  await click(page, '.place-value-times-ten-square[data-i="3"] rect');
  now = await read(page);
  check(now.notice === "These are hundredths already." && JSON.stringify(now.statuses) === '["not_started","not_started"]', `a tap on the target is refused with a fact, no attempt: ${JSON.stringify([now.notice, now.statuses])}`);
  for (const i of [0, 4, 1, 2]) await tapAt(page, `move:${i}`);
  for (const i of [2, 0, 1, 4]) await tapAt(page, `move:${i}`);
  now = await read(page);
  check(now.columns[-2].squares === 5 && JSON.stringify(now.statuses) === '["succeeded","not_started"]' && now.live === 0, `the tap that completes the chart ends the task, with no "done": ${JSON.stringify([now.columns, now.statuses, now.live])}`);
  check(now.howto === "" && !/500/.test(now.text), `nothing to tap, and 500 is never written: ${JSON.stringify([now.howto])}`);
  check(await row(page, "answer-1", { count: "50" }) === "in_progress" && await row(page, "answer-1", { count: "500" }) === "succeeded", "the card's answer row: 500");
  if (shots) await page.screenshot({ path: `${shots}/count-done.png` });

  // A times pair: 4,000 is ? times 400.
  await open(page, "times");
  now = await read(page);
  check(now.given === "4,000 is ? times 400" && JSON.stringify(now.labels) === '["4,000","400"]', `the problem and the two rows: ${JSON.stringify([now.given, now.labels])}`);
  check(now.copies.length === 10 && now.copies.every((copy) => copy.have === 0 && !copy.full) && now.copies.map((copy) => copy.number).join() === "1,2,3,4,5,6,7,8,9,10", `ten empty copies of 400, numbered: ${JSON.stringify(now.copies)}`);
  check(now.howto === "Tap a thousand to break it into ten hundreds, one into each 400.", `the times line: ${now.howto}`);
  await tapAt(page, "move:0");
  await tapAt(page, "move:2");
  now = await read(page);
  check(now.copies.every((copy) => copy.have === 2) && now.values.moved_once === 5, `each broken thousand deals one hundred into every copy: ${JSON.stringify([now.copies.map((copy) => copy.have), now.values.moved_once])}`);
  const slots = await page.evaluate(() => [...document.querySelectorAll('.place-value-times-ten-copy[data-row="0"] .place-value-times-ten-disk')].map((disk) => disk.dataset.slot));
  check(JSON.stringify(slots) === '["0","2"]', `the hundreds sit in the slots under the thousands tapped: ${JSON.stringify(slots)}`);
  await tapAt(page, "copy:4");
  now = await read(page);
  check(now.colnote.endsWith("This 400 has 2 hundreds; 400 is 4 hundreds.") && now.notice === "", `a copy's fact, said beside that copy: ${JSON.stringify([now.colnote, now.notice])}`);
  const besides = await page.evaluate(() => {
    const note = document.querySelector(".place-value-times-ten-note").getBoundingClientRect();
    const copy = document.querySelector('.place-value-times-ten-copy[data-row="4"]').getBoundingClientRect();
    return Math.abs(note.top - copy.bottom) < 8;
  });
  check(besides, "the fact sits right under the copy it is about");
  if (shots) await page.screenshot({ path: `${shots}/times-part.png` });
  await tapAt(page, "smaller:0");
  now = await read(page);
  check(now.notice === "This is 400: 4 hundreds.", `the smaller number's fact: ${now.notice}`);
  await tapAt(page, "move:1");
  await tapAt(page, "move:3");
  now = await read(page);
  check(now.copies.every((copy) => copy.full && copy.have === 4) && JSON.stringify(now.statuses) === '["succeeded","not_started"]', `ten whole copies of 400; the task ends: ${JSON.stringify([now.copies, now.statuses])}`);
  check(await row(page, "answer-1", { renamed: "400", times: "10" }) === "in_progress" && await row(page, "answer-1", { renamed: "40", times: "10" }) === "succeeded", "the row of two blanks: 40 hundreds, 10 times");
  if (shots) await page.screenshot({ path: `${shots}/times-done.png` });

  // A stated times pair whose digit is 1 (0028 revision 4): 1,000,000 is ? times 100,000, the narrowest copies column.
  await open(page, "digitOne");
  now = await read(page);
  check(now.given === "1,000,000 is ? times 100,000" && JSON.stringify(now.labels) === '["1,000,000","100,000"]', `a digit-1 times pair: ${JSON.stringify([now.given, now.labels])}`);
  check(now.copies.length === 10 && now.copies.every((copy) => copy.have === 0 && !copy.full) && now.copies.map((copy) => copy.number).join() === "1,2,3,4,5,6,7,8,9,10", `ten empty copies of 100,000, numbered: ${JSON.stringify(now.copies)}`);
  const narrow = await page.evaluate(() => {
    const svg = document.querySelector(".place-value-times-ten");
    const heads = [...svg.querySelectorAll(".place-value-times-ten-head")].map((head) => {
      const box = head.getBBox(), cell = head.nextElementSibling;
      const x = Number(cell.getAttribute("x")), width = Number(cell.getAttribute("width"));
      return { text: head.textContent, left: box.x, right: box.x + box.width, x, width };
    });
    const answer = svg.querySelector(".place-value-times-ten-answer").getBoundingClientRect();
    const numbers = [...svg.querySelectorAll(".place-value-times-ten-number")].map((number) => number.getBoundingClientRect());
    return { heads, inside: numbers.length >= 10 && numbers.slice(0, 10).every((r) => r.left >= answer.left - 1 && r.right <= answer.right + 1 && r.top >= answer.top - 1 && r.bottom <= answer.bottom + 1) };
  });
  check(narrow.heads.length === 2 && narrow.heads.every((head) => head.left >= head.x && head.right <= head.x + head.width), `each column's head fits its column: ${JSON.stringify(narrow.heads)}`);
  check(narrow.inside, "the answer element holds the copy numbers 1 to 10");
  check(now.card.left >= 0 && now.card.right <= 1024 && now.card.overflow <= 1, `the card fits 1,024 px: ${JSON.stringify(now.card)}`);
  // An empty copy is tapped on its number (its ring and slot are outlines).
  await click(page, '[data-oll-tap="copy:4"] .place-value-times-ten-number');
  now = await read(page);
  if (shots) await page.screenshot({ path: `${shots}/digit-one-copy.png` });
  check(now.colnote.endsWith("This 100,000 has 0 hundred thousands; 100,000 is 1 hundred thousand.") && now.notice === "", `a copy's fact, beside that copy: ${JSON.stringify([now.colnote, now.notice])}`);
  await tapAt(page, "smaller:0");
  now = await read(page);
  check(now.notice === "This is 100,000: 1 hundred thousand.", `the smaller number's fact: ${now.notice}`);
  if (shots) await page.screenshot({ path: `${shots}/digit-one-start.png` });
  await tapAt(page, "move:0");
  now = await read(page);
  check(now.copies.every((copy) => copy.full && copy.have === 1) && now.values.moved_once === 1 && JSON.stringify(now.statuses) === '["succeeded","not_started"]', `the million broken: ten whole copies of 100,000; the task ends: ${JSON.stringify([now.copies, now.values.moved_once, now.statuses])}`);
  check(await row(page, "answer-1", { renamed: "1", times: "10" }) === "in_progress" && await row(page, "answer-1", { renamed: "10", times: "10" }) === "succeeded", "the row of two blanks: 10 hundred thousands, 10 times");
  if (shots) { await page.waitForTimeout(1500); await page.screenshot({ path: `${shots}/digit-one-done.png` }); }

  // Chinese, putting together: 300 ones = ? hundreds (squares of a hundred become rows, rows become one).
  await open(page, "zh");
  now = await read(page);
  check(now.given === "300个一 = ?个百" && now.columns[0].squares === 3, `the problem in Chinese, three squares of a hundred ones: ${JSON.stringify([now.given, now.columns])}`);
  check(now.howto === "点一块一百个一，把它合成十个十。", `the Chinese line: ${now.howto}`);
  await tapAt(page, "move:1");
  now = await read(page);
  check(now.columns[1].rows === 1 && now.howto === "点一块一百个一，把它合成十个十。点一排十个十，把它们合成一个百。", `a square put together is a row of ten tens: ${JSON.stringify([now.columns, now.howto])}`);
  await tapAt(page, "move:1");
  await click(page, '.place-value-times-ten-disk[data-i="1"] circle');
  now = await read(page);
  check(now.columns[2].disks === 1 && now.notice === "这些已经是百了。", `a row put together is one hundred; the target refuses in Chinese: ${JSON.stringify([now.columns, now.notice])}`);
  await open(page, "zhOne");
  now = await read(page);
  check(now.given === "60个千分之一 = ?个百分之一" && now.columns[-3].rows === 6, `a one-place put-together in Chinese: ${JSON.stringify([now.given, now.columns])}`);

  // The program's demonstration, played by the session with motion: the card plays each row's move in turn.
  const playDemo = (name, sample, stopAt) => page.evaluate(async ({ events, name, sample, stopAt }) => {
    document.querySelector("#board").replaceChildren();
    localStorage.clear();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), name, { reducedMotion: false });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    const read = () => sample === "copy" ? String(document.querySelectorAll('.place-value-times-ten-copy[data-row="0"] .place-value-times-ten-disk').length)
      : [...document.querySelectorAll(".place-value-times-ten-things")].map((layer) => [...layer.children].filter((child) => child.matches("[data-i]")).length).join(",");
    const seen = [], eased = [];
    const note = () => {
      const now = read(); if (seen.at(-1) !== now) seen.push(now);
      const value = session.projection.board?.variables?.counted_in?.value;
      if (typeof value === "number" && !eased.includes(value)) eased.push(value);
    };
    const node = () => Object.values(session.projection.board?.nodes ?? {}).find((candidate) => candidate.kind === "place_value_times_ten");
    // The lesson plays until "counted in" reaches the value, the narration standing still while the card works.
    for (let i = 0; i < 600 && Number(node()?.content.counted_in) !== stopAt; i += 1) { session.advance(); mounted.view.render(session.projection.board); note(); await wait(20); }
    for (let t = 0; t < 60; t += 1) { await wait(150); mounted.view.render(session.projection.board); note(); }
    // The rest of the lesson, then its practice start.
    for (let i = 0; i < 600 && session.projection.status !== "completed"; i += 1) { session.advance(); mounted.view.render(session.projection.board); await wait(20); }
    for (let t = 0; t < 20; t += 1) { await wait(100); mounted.view.render(session.projection.board); }
    const values = Object.fromEntries(Object.entries(session.projection.board.variables).map(([k, v]) => [k, v.value]));
    return { seen, between: eased.filter((value) => ![100000, 70000, 100, 10, 1, 1000000].includes(value)).length, values,
      given: document.querySelector(".place-value-times-ten-given")?.textContent, available: session.studentTasks.map((task) => task.available),
      copies: [...document.querySelectorAll(".place-value-times-ten-things .place-value-times-ten-copy")].map((copy) => copy.querySelectorAll(".place-value-times-ten-disk").length) };
  }, { events: events[name], name, sample, stopAt });
  const inOrder = (seen, expected) => { let at = 0; for (const state of seen) if (state === expected[at]) at += 1; return at === expected.length; };
  const dealt = await playDemo("demoTimes", "copy", 70_000);
  check(inOrder(dealt.seen, ["0", "1", "2", "3", "4", "5", "6", "7"]), `700 counted in 70s deals one hundred at a time into the copies: ${JSON.stringify(dealt.seen)}`);
  // This check advances the session by hand, which sets the demonstration field at once (a skip), so the card plays
  // the moves itself at the tap's pace; the values seen are logged, not claimed. The player's own pace, one row a
  // step, is measured by check-demonstration-pace-browser.mjs.
  console.log(`  demoTimes: counted in values seen between its path's values: ${dealt.between}`);
  check(dealt.given === "4,000 is ? times 400" && dealt.values.counted_in === 1_000_000 && dealt.values.moved_once === 0 && dealt.available[0] === true && dealt.copies.every((n) => n === 0),
    `from the demonstration to a fresh practice on its own problem, at its own start unit: ${JSON.stringify([dealt.given, dealt.values, dealt.available, dealt.copies])}`);
  const counted = await playDemo("demoCount", "things", 1);
  check(inOrder(counted.seen, ["3,0,0", "2,1,0", "1,2,0", "0,3,0", "0,2,1", "0,1,2", "0,0,3"]), `0.3 counted in 0.01, then 0.001: one tenth, then one row, at a time: ${JSON.stringify(counted.seen)}`);
  await open(page, "demoHalf");
  now = await read(page);
  check(now.columns[-2].rows === 3 && now.columns[-1].disks === 0 && now.values.counted_in === 10, `counted in 0.01 at rest: every tenth a row of ten hundredths: ${JSON.stringify([now.columns, now.values.counted_in])}`);
  if (shots) await page.screenshot({ path: `${shots}/demo-half.png` });

  // The largest cards fit the window and keep their height while worked.
  for (const name of ["widestCount", "widestTimes"]) {
    await open(page, name, { frame: 1 });
    await page.waitForTimeout(700); // the camera settles on the card
    const first = await read(page);
    // The card measured is the practice's: its own amount (9 ones; 9,000,000), not the lesson's.
    const practiceAmount = name === "widestCount" ? 9000 : 9_000_000_000;
    check(first.values.amount === practiceAmount, `${name}: the card measured is the practice card (amount ${practiceAmount}), not ${first.values.amount}`);
    // Every disk's label is read whole on its own disk (a wide place value, 1,000,000, is squeezed to fit), and
    // the answer's element is where the answer is read: a count's target column, a times pair's copy numbers.
    const fit = await page.evaluate(() => {
      const svg = document.querySelector(".place-value-times-ten");
      const labels = [...svg.querySelectorAll(".place-value-times-ten-disk")].map((disk) => {
        const circle = disk.querySelector("circle"), text = disk.querySelector("text");
        return { label: text.textContent, width: text.getBBox().width, disk: 2 * Number(circle.getAttribute("r")) };
      });
      const answer = svg.querySelectorAll(".place-value-times-ten-answer");
      const box = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      const at = answer.length === 1 ? box(answer[0]) : null;
      const numbers = [...svg.querySelectorAll(".place-value-times-ten-number")].map(box);
      const target = [...svg.querySelectorAll(".place-value-times-ten-cell")].find((cell) => cell.getAttribute("stroke-dasharray"));
      return { over: labels.filter((each) => each.width > each.disk - 2).slice(0, 3), labels: labels.length, count: answer.length, at, numbers, target: target ? box(target) : null };
    });
    check(fit.labels > 0 && fit.over.length === 0, `${name}: every disk label fits its disk: ${JSON.stringify(fit.over)}`);
    const inside = (outer, inner) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    if (name === "widestTimes") {
      check(fit.count === 1 && fit.numbers.length >= 10 && fit.numbers.slice(0, 10).every((number) => inside(fit.at, number)), `${name}: one answer element holds the copy numbers 1 to 10: ${JSON.stringify([fit.at, fit.numbers.slice(0, 10)])}`);
    } else {
      check(fit.count === 1 && fit.target && inside(fit.at, fit.target) && inside(fit.target, fit.at), `${name}: the answer element is the target column: ${JSON.stringify([fit.at, fit.target])}`);
    }
    const n = Object.values(first.columns).reduce((sum, column) => sum + column.disks + column.rows + column.squares, 0);
    await tapAt(page, "move:0");
    const mid = await read(page); // two kinds can be tapped: the instruction is two sentences
    for (let i = 1; i < n; i += 1) await tapAt(page, `move:${i}`);
    if (name === "widestCount") for (let i = 0; i < n; i += 1) await tapAt(page, `move:${i}`);
    const last = await read(page);
    check(Math.abs(first.card.height - mid.card.height) <= 1 && mid.card.overflow <= 1, `${name}: with the longest instruction the card keeps its height and holds its lines: ${JSON.stringify([first.card, mid.card, mid.howto])}`);
    check(first.card.left >= 0 && first.card.right <= 1024 && first.card.overflow <= 1, `${name}: at its natural size the card fits 1,024 px: ${JSON.stringify(first.card)}`);
    check(Math.abs(first.card.height - last.card.height) <= 1, `${name}: the card keeps its height while worked: ${JSON.stringify([first.card, last.card])}`);
    console.log(`  ${name}: card ${first.card.width} x ${first.card.height} px`);
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
    if (shots && name === "widestTimes") {
      await open(page, name, { frame: 1 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${shots}/${name}-start.png` });
    }
  }
  check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`place-value times-ten browser checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("place-value times-ten browser checks passed: 5 ones = ? hundredths by real clicks (a one into a row of ten on its own row, a row into a square of a hundred), the line naming every kind that can be tapped in one place, a refusal on the target said as a fact, the task ended by the completing tap with no done, the card's answer row; 4,000 is ? times 400 with ten numbered copies each dealt a hundred per thousand, a copy's fact beside it, the smaller number's fact, the row of two blanks; 1,000,000 is ? times 100,000 (a stated digit-1 times pair) in its narrowest copies column; Chinese put-together questions; the demonstration played with motion (0.3 counted in 0.01 then 0.001, 700 counted in 70s), one row at a time, then a fresh practice; the largest cards fit 1,024 px and keep their height");
