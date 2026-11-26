// Browser checks for the place-value chart (decision 0025), with the runtime's own stylesheet:
// - a task on its own number: after the lesson the card gives the task's number (its name), never the lesson's;
// - building 4,050 from its name in English and 三百零六万零四百 in Chinese by real clicks on "+" and on disks;
//   a tenth disk in a place is refused with the card's words, a tapped disk is taken away, "done" is refused
//   before the number is built and accepted after, and the chart is inert once done; no numeral is drawn;
// - pulling 347.392 apart by real clicks on "Take out", each place's disks moving into its part, then the row of
//   blanks under it answered;
// - a demonstration: a count animating 0 -> 4 draws its disks one at a time, and a lesson's take_out tap plays
//   by the card's rules;
// - a phone 375 px wide (the camera's 24 px margins, as Learn sets on phones): the widest chart (ten columns)
//   wraps its periods into rows, and every disk and button measures at least 24 px, in both languages and
//   both tasks, as an embedded Learn host off Android frames a task's card (24 px focus margin, reading floor
//   0.9; the card is panned, not shrunk, when taller than the screen); a screenshot of each. Other cameras logged;
// - emphasis on one place marks that place only; a resize that changes the screen's width redraws the rows.
// Numbers here are invented for the check. Screenshots go to OLL_PLACE_VALUE_SCREENSHOTS when it is set.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { chartHost, chartLesson, chartVariable } from "../dist/packages/plugin-math/test/place-value-chart-fixtures.js";

const index = (place) => place + 3;
const animate = (key, variable, value) => ({ key, say: "Look.", actions: [{ do: "animate", variable, value }] });
const row = {
  as: "parts", anchor: "chart", prompt: "Write what each part is worth.", availability: { kind: "after_lesson" },
  allowed_operations: [{ kind: "row_entry" }],
  completion: { kind: "numeric_row", parts: [{ text: "347.392 =" },
    ...[["h", "300", "hundreds"], ["t", "40", "tens"], ["o", "7", "ones"], ["a", "0.3", "tenths"], ["b", "0.09", "hundredths"], ["c", "0.002", "thousandths"]]
      .flatMap(([as, answer, label], i) => [...(i ? [{ text: "+" }] : []), { blank: { as, answer, label } }])] },
  hints: ["Each part is its disks' value."],
};
const lessons = {
  // The lesson shows 2,306; the task builds 4,050 from its name.
  en: chartLesson({ mode: "build", given: "name", target: 2_306_000, practice: [4_050_000] }),
  // The lesson shows 1,250,800; the task builds 3,060,400 from its Chinese name.
  zh: chartLesson({ mode: "build", given: "name", language: "zh-CN", target: 1_250_800_000, practice: [3_060_400_000] }),
  // The lesson pulls 128.56 apart; the task pulls 347.392 apart, then a row asks for the parts.
  apart: chartLesson({ mode: "apart", given: "numeral", target: 128_560, practice: [347_392], extraTasks: [row],
    beats: [{ key: "out", say: "Take out the hundreds.", actions: [{ do: "tap", target: "chart", tap: "take_out", at: "hundreds" }] }] }),
  // A count animating 0 -> 4 in the lesson.
  demo: chartLesson({ mode: "build", given: "place_counts", target: 4_050_000, fixedNumber: true, beats: [animate("four", chartVariable("count", 3), 4)] }),
  emphasis: chartLesson({ mode: "apart", given: "numeral", target: 347_392, fixedNumber: true,
    beats: [{ key: "tens", say: "Look at the tens.", actions: [{ do: "emphasize", target: "chart#tens", emphasis: "focus" }] }] }),
  // The widest charts: millions to thousandths, both languages, both tasks.
  phoneEn: chartLesson({ mode: "build", given: "name", target: 2_306_000, practice: [1_204_030_560] }),
  phoneZh: chartLesson({ mode: "build", given: "name", language: "zh-CN", target: 2_306_000, practice: [3_060_400_250] }),
  phoneApart: chartLesson({ mode: "apart", given: "numeral", target: 2_306_000, practice: [1_204_030_560] }),
  phoneApartZh: chartLesson({ mode: "apart", given: "numeral", language: "zh-CN", target: 2_306_000, practice: [3_060_400_250] }),
};
const events = Object.fromEntries(Object.entries(lessons).map(([name, authored]) => [name, normalizeAuthoringLesson(authored, chartHost(name))]));

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
const shots = process.env.OLL_PLACE_VALUE_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

/**
 * Plays a lesson to its end on a fresh board, its card live for the open task; `insets` as a host sets them, and
 * with `frame` the board's teaching camera framing the card (as a host does with a task on it), a number being
 * the host's reading floor (`setAutomaticCameraMinimumScale`).
 */
const open = (page, name, { insets, frame } = {}) => page.evaluate(({ events, name, insets, frame }) => {
  document.querySelector("#board").replaceChildren();
  localStorage.clear();
  const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), name, { reducedMotion: true });
  const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
  if (insets) mounted.view.setViewportInsets(insets);
  while (session.projection.status !== "completed") session.advance();
  mounted.view.setCardTapHandler({
    live: (id) => session.studentCardLive(id),
    tap: (id, tap, input) => { const result = session.tapStudentCard(id, tap, input); mounted.view.render(session.projection.board); return result; },
  });
  mounted.view.render(session.projection.board);
  if (typeof frame === "number") mounted.view.setAutomaticCameraMinimumScale(frame);
  if (frame) mounted.view.focusTargets([`${name}:node:chart`]);
  window.chart = { session, mounted };
}, { events: events[name], name, insets, frame });

/** What the chart shows: the given line, disks per place (on the chart and pulled out), the notice, live elements. */
const read = (page) => page.evaluate(() => {
  const svg = document.querySelector(".place-value-chart");
  const card = svg.closest(".board-node");
  const disks = {};
  for (const group of svg.querySelectorAll(".place-value-place")) {
    disks[group.dataset.place] = [group.querySelectorAll(".place-value-disks .place-value-disk").length, group.querySelectorAll(".place-value-pulled .place-value-disk").length];
  }
  const values = Object.fromEntries(Object.entries(window.chart.session.projection.board.variables).map(([k, v]) => [k, v.value]));
  return {
    given: card.querySelector(".place-value-given")?.textContent ?? "", notice: card.querySelector(".place-value-notice")?.textContent ?? "",
    disks, live: svg.querySelectorAll(".place-value-live").length, values, text: card.textContent,
    statuses: window.chart.session.studentTasks.map((task) => task.status),
  };
});
const click = async (page, selector) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing to click: ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const plus = (page, place) => click(page, `.place-value-button[data-oll-tap="add:${index(place)}"] rect`);
const takeOut = (page, place) => click(page, `.place-value-button[data-oll-tap="take_out:${index(place)}"] rect`);
const disk = (page, place) => click(page, `.place-value-place[data-place="${place}"] .place-value-disks .place-value-disk[data-oll-tap]`);
const submit = (page, task) => page.evaluate((task) => {
  const result = window.chart.session.submitStudentCard(task);
  window.chart.mounted.view.render(window.chart.session.projection.board);
  return result.status;
}, task);

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);

  // Building 4,050 from its name, by real clicks.
  await open(page, "en");
  let now = await read(page);
  check(now.given === "four thousand fifty" && now.values.number === 4_050_000, `the task gives its own number's name, not the lesson's 2,306: ${JSON.stringify([now.given, now.values.number])}`);
  check(!/4,?050/.test(now.text) && !/2,?306/.test(now.text), `a build task draws no numeral: ${now.text}`);
  check(now.live === 6, `six "+" buttons are live on an empty chart: ${now.live}`);
  check(await submit(page, "practice-1") === "in_progress", "done before the number is built is refused");
  for (let i = 0; i < 9; i += 1) await plus(page, 0);
  await plus(page, 0);
  now = await read(page);
  check(now.disks[0][0] === 9 && now.values[chartVariable("count", 0)] === 9 && now.notice === "This place holds nine at most. Ten of them make one of the next place.",
    `a tenth disk is refused with the card's words: ${JSON.stringify([now.disks[0], now.notice])}`);
  for (let i = 0; i < 9; i += 1) await disk(page, 0);
  now = await read(page);
  check(now.disks[0][0] === 0 && now.notice === "", `tapping a disk takes it away; the notice clears: ${JSON.stringify(now.disks[0])}`);
  for (let i = 0; i < 4; i += 1) await plus(page, 3);
  for (let i = 0; i < 5; i += 1) await plus(page, 1);
  now = await read(page);
  check(JSON.stringify([3, 2, 1, 0].map((place) => now.disks[place][0])) === "[4,0,5,0]", `4 thousands and 5 tens drawn: ${JSON.stringify(now.disks)}`);
  await page.focus(`.place-value-button[data-oll-tap="add:${index(2)}"]`);
  await page.keyboard.press("Enter");
  check((await read(page)).disks[2][0] === 1, "Enter on a focused + adds a disk");
  check(await submit(page, "practice-1") !== "succeeded", "done with a hundred too many is refused");
  await disk(page, 2);
  if (shots) await page.screenshot({ path: `${shots}/build-en.png` });
  check(await submit(page, "practice-1") === "succeeded", "done on 4,050 is accepted");
  now = await read(page);
  check(now.live === 0 && JSON.stringify([3, 2, 1, 0].map((place) => now.disks[place][0])) === "[4,0,5,0]", `after done the chart is inert and keeps the learner's chart: ${JSON.stringify(now)}`);

  // Building 三百零六万零四百 from its Chinese name.
  await open(page, "zh");
  now = await read(page);
  check(now.given === "三百零六万零四百", `the task gives its Chinese name: ${now.given}`);
  check(await page.evaluate(() => document.querySelector(".place-value-chart").getAttribute("aria-label")) === "数位表", "the chart speaks Chinese");
  for (const [place, digit] of [[6, 3], [4, 6], [2, 4]]) for (let i = 0; i < digit; i += 1) await plus(page, place);
  await plus(page, 2);
  check(await submit(page, "practice-1") !== "succeeded", "done with five hundreds is refused");
  await disk(page, 2);
  now = await read(page);
  check(JSON.stringify([6, 5, 4, 3, 2, 1, 0].map((place) => now.disks[place][0])) === "[3,0,6,0,4,0,0]", `3,060,400 drawn: ${JSON.stringify(now.disks)}`);
  for (let i = 0; i < 10; i += 1) await plus(page, 0);
  check((await read(page)).notice === "这一位最多放九个。十个就是左边一位的一个。", "a tenth disk is refused in Chinese");
  for (let i = 0; i < 9; i += 1) await disk(page, 0);
  if (shots) await page.screenshot({ path: `${shots}/build-zh.png` });
  check(await submit(page, "practice-1") === "succeeded", "done on 三百零六万零四百 is accepted");

  // Pulling 347.392 apart, then the row of blanks.
  await open(page, "apart");
  now = await read(page);
  check(now.given === "347.392", `the task gives its own numeral: ${now.given}`);
  check(JSON.stringify([2, 1, 0, -1, -2, -3].map((place) => now.disks[place])) === "[[3,0],[4,0],[7,0],[3,0],[9,0],[2,0]]", `347.392 whole on the chart: ${JSON.stringify(now.disks)}`);
  check(await page.evaluate(() => !!document.querySelector(".place-value-point")), "the decimal point is drawn");
  for (const place of [2, 1, 0, -1, -2]) await takeOut(page, place);
  check(await submit(page, "practice-1") !== "succeeded", "done with the thousandths still in is refused");
  await takeOut(page, -3);
  now = await read(page);
  check(JSON.stringify([2, 1, 0, -1, -2, -3].map((place) => now.disks[place])) === "[[0,3],[0,4],[0,7],[0,3],[0,9],[0,2]]", `every place's disks in its part: ${JSON.stringify(now.disks)}`);
  check(await page.evaluate(() => [...document.querySelectorAll(".place-value-button")].every((button) => button.getAttribute("visibility") === "hidden")), "a place taken out has nothing more to take");
  check(await submit(page, "practice-1") === "succeeded", "done once every place is out is accepted");
  const rowStatus = await page.evaluate(() => {
    const session = window.chart.session;
    const wrong = session.submitStudentRow("parts", { h: "300", t: "4", o: "7", a: "0.3", b: "0.09", c: "0.002" }).status;
    const right = session.submitStudentRow("parts", { h: "300", t: "40", o: "7", a: ".3", b: "0.09", c: "2/1000" }).status;
    window.chart.mounted.view.render(session.projection.board);
    return [wrong, right];
  });
  check(JSON.stringify(rowStatus) === '["in_progress","succeeded"]', `the row of parts is judged whole: ${JSON.stringify(rowStatus)}`);
  now = await read(page);
  check(now.disks[2][1] === 3 && now.disks[-3][1] === 2, "the row sits over the learner's pulled-apart chart");
  if (shots) await page.screenshot({ path: `${shots}/apart.png` });

  // A demonstration: the lesson's take_out tap played by the card's rules (the lesson's 128.56).
  const tapped = await page.evaluate(({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "apart-demo", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const seen = [];
    for (let step = 0; step < 100 && session.projection.status !== "completed"; step += 1) {
      session.advance();
      mounted.view.render(session.projection.board);
      const group = document.querySelector('.place-value-place[data-place="2"]');
      if (group) seen.push([group.querySelectorAll(".place-value-disks .place-value-disk").length, group.querySelectorAll(".place-value-pulled .place-value-disk").length]);
      if (session.projection.board?.variables?.pulled_hundreds?.value === 1) break;
    }
    return seen;
  }, { events: events.apart });
  check(JSON.stringify(tapped[0]) === "[1,0]" && JSON.stringify(tapped.at(-1)) === "[0,1]", `the lesson takes the hundred out: ${JSON.stringify(tapped)}`);

  // A demonstration: a count animating 0 -> 4 draws its disks one at a time, each drawn disk staying.
  const drawn = await page.evaluate(({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "demo", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const chartOf = () => Object.values(session.projection.board?.nodes ?? {}).find((candidate) => candidate.kind === "place_value_chart");
    for (let step = 0; step < 20 && !chartOf(); step += 1) session.advance();
    mounted.view.render(session.projection.board);
    const board = structuredClone(session.projection.board);
    const node = Object.values(board.nodes).find((candidate) => candidate.kind === "place_value_chart");
    const thousands = node.content.places.find((item) => item.place === 3);
    const seen = [];
    let first;
    for (const count of [0, 0.4, 1, 1.7, 2.2, 3, 3.9, 4]) {
      thousands.count = count;
      mounted.view.render(structuredClone(board));
      const disks = [...document.querySelectorAll('.place-value-place[data-place="3"] .place-value-disks .place-value-disk')];
      first ??= disks[0];
      seen.push([disks.length, disks.filter((disk) => disk.classList.contains("place-value-disk-new")).length, !first || disks[0] === first]);
    }
    return seen;
  }, { events: events.demo });
  check(JSON.stringify(drawn.map(([count]) => count)) === "[0,0,1,1,2,3,3,4]" && drawn.every(([, , kept]) => kept) && drawn.filter(([, fresh]) => fresh === 1).length === 4,
    `a count animating 0 -> 4 draws its disks one at a time, each staying: ${JSON.stringify(drawn)}`);

  // Emphasis on one place marks that place only.
  const emphasized = await page.evaluate(({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "emphasis", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    while (session.projection.status !== "completed") session.advance();
    mounted.view.render(session.projection.board);
    return [...document.querySelectorAll(".place-value-place")].filter((group) => group.classList.contains("emphasis-focus")).map((group) => group.dataset.place);
  }, { events: events.emphasis });
  check(JSON.stringify(emphasized) === '["1"]', `emphasis on the tens marks the tens only: ${JSON.stringify(emphasized)}`);

  // A screen turned narrow redraws a chart in rows (the board's resize), and wide again in one row.
  const turned = [];
  await open(page, "phoneEn", { insets: { focusMargin: 24 } });
  const rowsNow = () => page.evaluate(() => new Set([...document.querySelectorAll(".place-value-column")].map((column) => Math.round(column.getBoundingClientRect().top))).size);
  turned.push(await rowsNow());
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.chart.mounted.view.resize());
  turned.push(await rowsNow());
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.evaluate(() => window.chart.mounted.view.resize());
  turned.push(await rowsNow());
  check(JSON.stringify(turned) === "[1,3,1]", `a resize redraws the chart's rows: ${JSON.stringify(turned)}`);

  // A phone 375 px wide: the widest charts wrap into rows; every disk and button at least 24 px. Asserted as an
  // embedded Learn host on a phone frames a task's card: a 24 px focus margin and a reading floor of 0.9 (Learn's
  // `teachingCameraFloor` off Android), so the card is drawn at 0.9 and a tall one is panned, not shrunk. Logged
  // only: the board's own camera without a floor (it fits the whole card in the screen's height), and the default
  // 70 px focus margin (a narrower width for the card, so more rows). Android's camera (floor .55, ceiling .8)
  // draws a disk at 24 px at best.
  await page.setViewportSize({ width: 375, height: 812 });
  const measure = () => page.evaluate(() => {
    const size = (element) => { const r = element.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, right: r.right }; };
    const card = document.querySelector(".place-value-chart").closest(".board-node");
    const disks = [...document.querySelectorAll(".place-value-disk-face")].map(size);
    const buttons = [...document.querySelectorAll(".place-value-button")].filter((button) => button.getAttribute("visibility") !== "hidden").map((button) => size(button.querySelector("rect")));
    const rows = new Set([...document.querySelectorAll(".place-value-column")].map((column) => Math.round(column.getBoundingClientRect().top))).size;
    const smallest = (list, key) => Math.min(...list.map((item) => item[key]));
    return { disks: disks.length, disk: smallest(disks, "w"), button: Math.min(smallest(buttons, "w"), smallest(buttons, "h")), rows, card: size(card), scroll: document.documentElement.scrollWidth };
  });
  for (const name of ["phoneEn", "phoneZh", "phoneApart", "phoneApartZh"]) {
    await open(page, name, { insets: { focusMargin: 24 }, frame: 0.9 });
    await page.waitForTimeout(700);
    // Real taps at the phone's size.
    if (name === "phoneEn" || name === "phoneZh") for (const place of [6, 0, -3]) await plus(page, place);
    else await takeOut(page, 6);
    await page.waitForTimeout(400);
    const sizes = await measure();
    const taken = await read(page);
    check(name.includes("Apart") ? taken.disks[6][0] === 0 && taken.disks[6][1] > 0 : taken.disks[-3][0] === 1, `${name}: real taps at the phone's size reach the card: ${JSON.stringify(taken.disks)}`);
    check(sizes.rows === 3, `${name}: ten columns wrap into three rows: ${JSON.stringify(sizes)}`);
    check(sizes.disks > 0 && sizes.disk >= 24 && sizes.button >= 24, `${name}: disks and buttons at least 24 px on a 375 px phone: ${JSON.stringify(sizes)}`);
    check(sizes.card.left >= 0 && sizes.card.right <= 375 && sizes.scroll <= 375, `${name}: the card fits the phone's width: ${JSON.stringify(sizes)}`);
    if (shots) await page.screenshot({ path: `${shots}/phone-${name}.png` });
    await open(page, name, { insets: { focusMargin: 24 }, frame: true });
    await page.waitForTimeout(700);
    const fitted = await measure();
    await open(page, name, { frame: 0.9 });
    await page.waitForTimeout(700);
    const margins = await measure();
    console.log(`${name} at 375x812: 24 px margin, floor 0.9: disk ${sizes.disk.toFixed(1)} px, button side ${sizes.button.toFixed(1)} px, card ${sizes.card.w.toFixed(0)} px wide, ${sizes.rows} rows;`
      + ` no floor (whole card fitted): button side ${fitted.button.toFixed(1)} px; default 70 px margin, floor 0.9: ${margins.rows} rows, button side ${margins.button.toFixed(1)} px, card ${margins.card.w.toFixed(0)} px wide`);
  }
  check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`place-value chart browser checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("place-value chart browser checks passed: a task on its own number (its name given, no numeral drawn); 4,050 built from its name and 三百零六万零四百 from its Chinese name by real clicks on + and on disks; a tenth disk refused in the card's words, a tapped disk taken away, Enter adds, done refused then accepted, inert after; 347.392 pulled apart by Take out, then its row answered; a lesson's take_out and a count animating 0 -> 4 drawn one disk at a time; on a 375 px phone the widest charts wrap into three rows with disks and buttons at least 24 px, in both languages and both tasks");
