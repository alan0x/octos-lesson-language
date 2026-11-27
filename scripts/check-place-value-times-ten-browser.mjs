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
// - Chinese: put-together questions (300 ones = ? hundreds: squares of a hundred into rows of ten, rows into one;
//   60 thousandths = ? hundredths), the card's words in Chinese;
// - the largest cards (9 ones -> hundredths, 9,000,000 vs 900,000) fit the window and keep their height while
//   worked.
// Numbers are the accepted sketch's. Screenshots go to OLL_PLACE_VALUE_TIMES_TEN_SCREENSHOTS when it is set.
// - the program's demonstration: "counted in" 0.1 -> 0.01 -> 0.001 breaks every tenth, then every row; 700 counted in
//   70s deals every hundred into ten whole copies; a demonstration's chart takes no taps; the moves animate.
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
  zh: timesTenLesson({ language: "zh-CN", amount: "0.8", target: "0.1", start: "0.001", practice: [["300", "100"]] }),
  zhOne: timesTenLesson({ language: "zh-CN", amount: "2000", target: "1000", start: "100", practice: [["0.06", "0.01"]] }),
  widestCount: timesTenLesson({ amount: "9", target: "0.01", practice: [["9000", "10"]] }),
  widestTimes: timesTenLesson({ amount: "9000000", target: "900000", practice: [["90", "9"]] }),
  // The lesson's own demonstration: "counted in" 0.1 -> 0.01, then 0.001; 700 counted in hundreds, then in 70s.
  demoCount: timesTenLesson({ amount: "0.3", target: "0.001", beats: [animate("hundredths", 10), animate("thousandths", 1)] }),
  demoHalf: timesTenLesson({ amount: "0.3", target: "0.001", beats: [animate("hundredths", 10)] }),
  demoTimes: timesTenLesson({ amount: "700", target: "70", beats: [animate("seventies", 70_000)] }),
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

  // The program's demonstration.
  await open(page, "demoHalf");
  now = await read(page);
  check(now.columns[-2].rows === 3 && now.columns[-1].disks === 0 && now.values.counted_in === 10 && now.live === 0, `counted in 0.01: every tenth a row of ten hundredths, nothing to tap: ${JSON.stringify([now.columns, now.values.counted_in, now.live])}`);
  await open(page, "demoCount");
  now = await read(page);
  check(now.columns[-3].squares === 3 && now.values.counted_in === 1, `counted in 0.001: three squares of a hundred thousandths: ${JSON.stringify(now.columns)}`);
  await open(page, "demoTimes");
  now = await read(page);
  check(now.copies.length === 10 && now.copies.every((copy) => copy.full && copy.have === 7) && now.columns[2].disks === 0, `700 counted in 70s: ten whole copies of 70: ${JSON.stringify(now.copies.map((copy) => copy.have))}`);
  // With motion, a demonstration step plays each row's move after another.
  const moving = await page.evaluate(() => {
    const { session, mounted } = window.tens;
    const board = structuredClone(session.projection.board);
    const variable = board.variables.counted_in;
    const node = Object.values(board.nodes).find((candidate) => candidate.kind === "place_value_times_ten");
    // Back to the start, drawn; then 70 again, drawn: the view queues the seven hundreds' moves.
    variable.value = 100000; node.content.counted_in = 100000;
    mounted.view.render(board);
    const again = structuredClone(board);
    again.variables.counted_in.value = 70000; Object.values(again.nodes).find((candidate) => candidate.kind === "place_value_times_ten").content.counted_in = 70000;
    mounted.view.render(again);
    return document.getAnimations().filter((animation) => animation.playState === "running").length;
  });
  check(moving > 0, `the demonstration's moves animate: ${moving} running`);

  // The largest cards fit the window and keep their height while worked.
  for (const name of ["widestCount", "widestTimes"]) {
    await open(page, name, { frame: 1 });
    await page.waitForTimeout(700); // the camera settles on the card
    const first = await read(page);
    const n = Object.values(first.columns).reduce((sum, column) => sum + column.disks + column.rows + column.squares, 0);
    for (let i = 0; i < n; i += 1) await tapAt(page, `move:${i}`);
    const last = await read(page);
    check(first.card.left >= 0 && first.card.right <= 1024 && first.card.overflow <= 1, `${name}: at its natural size the card fits 1,024 px: ${JSON.stringify(first.card)}`);
    check(Math.abs(first.card.height - last.card.height) <= 1, `${name}: the card keeps its height while worked: ${JSON.stringify([first.card, last.card])}`);
    console.log(`  ${name}: card ${first.card.width} x ${first.card.height} px`);
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
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
console.log("place-value times-ten browser checks passed: 5 ones = ? hundredths by real clicks (a one into a row of ten on its own row, a row into a square of a hundred), the line naming every kind that can be tapped in one place, a refusal on the target said as a fact, the task ended by the completing tap with no done, the card's answer row; 4,000 is ? times 400 with ten numbered copies each dealt a hundred per thousand, a copy's fact beside it, the smaller number's fact, the row of two blanks; Chinese put-together questions; the demonstration (counted in 0.1 -> 0.01 -> 0.001, 700 counted in 70s) drawn and animated, taking no taps; the largest cards fit 1,024 px and keep their height");
