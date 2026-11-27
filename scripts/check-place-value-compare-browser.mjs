// Browser checks for the place-value compare card (decision 0029), with the runtime's own stylesheet, on a desktop
// window (1024 x 768; the card has no phone layout):
// - whole numbers, practised as 6,281 and 6,218 (the task's own pair, never the lesson's 4,530 and 4,503), by real
//   clicks: the first screen (the instruction right under the problem, "Same" and "Different" under every column,
//   the sentence greyed with its lock and fact, nothing focused); a column right of an unjudged one refused with a
//   fact (both buttons), that column dimmed and the leftmost unjudged column ringed; a judgement that is not true
//   refused with the column's digits only, its button grey and dashed; a locked sign refused; judged from the left;
//   the deciding column "≠" with its paired disks faded and the extra ones ringed, the columns after it "Doesn't
//   matter", and a tap on a decided chart's column states its fact (a later one doesn't matter); no conclusion said
//   before the sign; a wrong sign refused as a fact with the signs still there; the true
//   sign ends the task with no "done"; a tap on the chart after it changes nothing; Enter on a focused button;
// - Chinese decimals (0.625 and 0.7): the points lined up, a faint 0 in every empty cell, the facts in Chinese;
// - an equal pair (2.50 and 2.5, written decimals bound): "Same" all the way, then "=";
// - the widest cards (1,000,000 and 999,999; 3,456.789 and 3,456.798), each a practice card: seven columns fit
//   1,024 px with no horizontal scroll, every disk label inside its disk, the card's height kept while it is worked;
// - the program's demonstration: "compared" played by the session with motion, the columns judged one at a time,
//   then the sign; then the practice opens fresh on its own pair.
// What it does not show: how long a step holds (the view's `stepMs`); it checks the order of the steps, not their pace.
// Pairs are the accepted sketch's. Screenshots go to OLL_PLACE_VALUE_COMPARE_SCREENSHOTS when it is set.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { compareHost, compareLesson } from "../dist/packages/plugin-math/test/place-value-compare-fixtures.js";

const animate = (key, value) => ({ key, say: "Look.", actions: [{ do: "animate", variable: "compared", value }] });
const lessons = {
  whole: compareLesson({ a: "4530", b: "4503", practice: [["6281", "6218"]] }),
  zh: compareLesson({ language: "zh-CN", a: "0.45", b: "0.405", practice: [["0.625", "0.7"]] }),
  equal: compareLesson({ a: "0.7", b: "0.70", decimals: true, practice: [["2.50", "2.5"]] }),
  widestWhole: compareLesson({ a: "2000000", b: "1999999", practice: [["1000000", "999999"]] }),
  widestDecimal: compareLesson({ a: "2345.678", b: "2345.687", practice: [["3456.789", "3456.798"]] }),
  // The lesson's own demonstration: 4,530 and 4,503 compared to the sign, then a practice.
  demo: compareLesson({ a: "4530", b: "4503", practice: [["6281", "6218"]], beats: [animate("all", 4)] }),
};
const events = Object.fromEntries(Object.entries(lessons).map(([name, authored]) => [name, normalizeAuthoringLesson(authored, compareHost(name))]));

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
let checks = 0;
const check = (condition, message) => { checks += 1; if (!condition) failures.push(message); };
const shots = process.env.OLL_PLACE_VALUE_COMPARE_SCREENSHOTS;
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
  window.cmp = { session, mounted };
}, { events: events[name], name, frame });

/** What the card shows: its lines, each column's status and disks, the sentence, live elements, tasks, variables. */
const read = (page) => page.evaluate(() => {
  const svg = document.querySelector(".place-value-compare");
  const card = svg.closest(".board-node");
  const columns = [...svg.querySelectorAll(".place-value-compare-column")].map((column) => ({
    place: Number(column.dataset.place),
    status: ["open", "same", "decides", "after"].find((status) => column.classList.contains(`place-value-compare-${status}`)),
    a: column.querySelectorAll('.place-value-compare-cell[data-row="a"] .place-value-compare-disk').length,
    b: column.querySelectorAll('.place-value-compare-cell[data-row="b"] .place-value-compare-disk').length,
    zeros: column.querySelectorAll(".place-value-compare-zero").length,
    buttons: [...column.querySelectorAll(".place-value-compare-button")].map((button) => button.textContent),
    mark: column.querySelector(".place-value-compare-mark")?.textContent ?? "",
    paired: column.querySelectorAll(".place-value-compare-paired").length,
    extra: column.querySelectorAll(".place-value-compare-extra").length,
    dimmed: column.querySelector(".place-value-compare-cell")?.getAttribute("opacity") === "0.4",
    ringed: column.querySelectorAll(".place-value-compare-next").length,
    refused: [...column.querySelectorAll(".place-value-compare-refused")].map((button) => button.dataset.judge),
  }));
  const sentence = card.querySelector(".place-value-compare-sentence");
  const values = Object.fromEntries(Object.entries(window.cmp.session.projection.board.variables).map(([k, v]) => [k, v.value]));
  const box = (selector) => { const r = card.querySelector(selector)?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } : null; };
  return {
    given: card.querySelector(".place-value-compare-given")?.textContent ?? "", howto: card.querySelector(".place-value-compare-howto")?.textContent ?? "",
    notice: card.querySelector(".place-value-compare-notice")?.textContent ?? "", done: card.querySelector(".place-value-compare-notice")?.classList.contains("place-value-compare-done"),
    columns, caption: svg.querySelector(".place-value-compare-caption")?.textContent ?? "",
    whole: [...svg.querySelectorAll(".place-value-compare-whole")].map((node) => node.textContent), frac: [...svg.querySelectorAll(".place-value-compare-frac")].map((node) => node.textContent),
    signs: [...sentence.querySelectorAll(".place-value-compare-sign")].map((sign) => ({ sign: sign.dataset.sign, live: sign.hasAttribute("data-oll-tap"), refused: sign.classList.contains("place-value-compare-refused") })),
    chosen: sentence.querySelector(".place-value-compare-chosen")?.textContent ?? "", greyed: sentence.querySelector(".place-value-compare-line")?.getAttribute("opacity") === "0.45",
    lock: sentence.querySelector(".place-value-compare-lock-text")?.textContent ?? "", sentence: [...sentence.querySelectorAll(".place-value-compare-a, .place-value-compare-b")].map((node) => node.textContent),
    live: card.querySelectorAll("[data-oll-tap]").length, focused: document.activeElement?.closest?.(".board-node") === card && document.activeElement !== card,
    values, statuses: window.cmp.session.studentTasks.map((task) => task.status), text: card.textContent,
    givenBox: box(".place-value-compare-given"), howtoBox: box(".place-value-compare-howto"),
    card: (() => { const r = card.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: card.offsetWidth, height: card.offsetHeight, overflow: card.scrollHeight - card.clientHeight }; })(),
  };
});
/** Clicks the middle of an element once the card's animations (but its endless ring) have finished. */
const click = async (page, selector) => {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity));
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing to click: ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const at = (place) => place + 3;
const judge = (page, judgement, place) => click(page, `[data-oll-tap="${judgement}:${at(place)}"]`);
const sign = (page, s) => click(page, `[data-oll-tap="sign:${10 + [">", "=", "<"].indexOf(s)}"]`);

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);

  // Whole numbers: 6,281 and 6,218, by real clicks.
  await open(page, "whole");
  let now = await read(page);
  check(now.given === "Compare 6,281 and 6,218." && now.values.a === 6281000 && now.values.marked === 0, `the task shows its own pair, fresh: ${JSON.stringify([now.given, now.values])}`);
  check(now.howto === "From the left, judge each place until one is different." && now.howtoBox && now.givenBox && now.howtoBox.top >= now.givenBox.bottom - 2 && now.howtoBox.top - now.givenBox.bottom < 12,
    `the one-line instruction right under the problem: ${JSON.stringify([now.howto, now.givenBox, now.howtoBox])}`);
  check(now.columns.length === 4 && now.columns.every((column) => column.status === "open" && column.buttons.join() === "Same,Different"), `"Same" and "Different" under every column: ${JSON.stringify(now.columns.map((column) => column.buttons))}`);
  check(JSON.stringify(now.columns.map((column) => [column.a, column.b])) === "[[6,6],[2,2],[8,1],[1,8]]", `the disks of both rows: ${JSON.stringify(now.columns.map((column) => [column.a, column.b]))}`);
  check(now.greyed && now.lock === "Opens when a place differs, or every place is the same." && now.signs.length === 3 && now.signs.every((s) => !s.live), `the sentence greyed, locked, its fact: ${JSON.stringify([now.greyed, now.lock, now.signs])}`);
  check(!now.focused && now.notice === "", "nothing focused on load; nothing said yet");
  if (shots) await page.screenshot({ path: `${shots}/whole-first.png` });
  for (const judgement of ["same", "different"]) {
    await judge(page, judgement, 0);
    now = await read(page);
    check(now.notice === "Ones: 1 and 8. The thousands haven't been compared yet." && now.values.marked === 0, `${judgement} on the ones: refused with the column's digits and the place not compared yet: ${JSON.stringify([now.notice, now.values.marked])}`);
    check(now.columns[3].dimmed && now.columns[0].ringed === 1 && JSON.stringify(now.columns[3].refused) === JSON.stringify([judgement]), `the ones dimmed, the thousands ringed, the button marked refused: ${JSON.stringify(now.columns.map((c) => [c.dimmed, c.ringed, c.refused]))}`);
  }
  check(!/6,281 [<>]|greater|less than/u.test(now.notice), "the refusal names no larger number");
  if (shots) await page.screenshot({ path: `${shots}/whole-refused.png` });
  await sign(page, ">").catch(() => {}); // locked: no tap target
  now = await read(page);
  check(now.values.signed === 0 && now.chosen === "", "a locked sign cannot be chosen");
  await judge(page, "different", 3);
  now = await read(page);
  check(now.notice === "Thousands: 6 and 6." && now.columns[0].refused.join() === "different" && now.columns.every((c) => !c.dimmed), `Different on the thousands: just its digits, the button marked: ${JSON.stringify([now.notice, now.columns[0].refused])}`);
  await judge(page, "same", 3);
  now = await read(page);
  check(now.notice === "Thousands: 6 and 6, the same." && now.columns[0].mark === "=" && now.columns[0].refused.length === 0, `Same on the thousands: "=": ${JSON.stringify([now.notice, now.columns[0]])}`);
  await judge(page, "same", 2);
  await judge(page, "same", 1);
  now = await read(page);
  check(now.notice === "Tens: 8 and 1." && now.values.marked === 2, `Same on the tens is not true: ${now.notice}`);
  await judge(page, "different", 1);
  now = await read(page);
  check(now.columns[2].status === "decides" && now.columns[2].mark === "≠" && now.columns[2].paired === 2 && now.columns[2].extra === 7, `the tens decide: one pair faded (a disk in each row), seven extra ringed: ${JSON.stringify(now.columns[2])}`);
  check(now.columns[3].status === "after" && now.caption === "Doesn't matter", `the ones don't matter: ${JSON.stringify([now.columns[3].status, now.caption])}`);
  check(now.notice === "Tens: 8 and 1, the first place that differs. 6,281 has more tens." && now.howto === "Choose >, = or < between the two numbers below.", `the deciding fact, and the line opens the sentence: ${JSON.stringify([now.notice, now.howto])}`);
  check(!now.text.includes("6,281 > 6,218") && !/greater/u.test(now.text), "no conclusion before the sign");
  check(!now.greyed && now.lock === "" && now.signs.every((s) => s.live), `the sentence opens: ${JSON.stringify(now.signs)}`);
  // The sketch's tap on a decided chart's column: its fact, the later places don't matter (review of #128).
  await click(page, `[data-oll-tap="column:${at(0)}"]`);
  now = await read(page);
  check(now.notice === "The tens decide; the ones come after and don't matter." && now.values.marked === 3, `a tap on a later column: it doesn't matter, nothing changes: ${JSON.stringify([now.notice, now.values.marked])}`);
  await click(page, `[data-oll-tap="column:${at(1)}"]`);
  now = await read(page);
  check(now.notice === "Tens: 8 and 1, the first place that differs.", `a tap on the deciding column: ${now.notice}`);
  await sign(page, "<");
  now = await read(page);
  check(now.notice === "“6,281 < 6,218” is not true." && now.signs.length === 3 && now.signs.find((s) => s.sign === "<").refused && JSON.stringify(now.statuses) === '["not_started"]',
    `a wrong sign: a fact, the signs still there: ${JSON.stringify([now.notice, now.signs, now.statuses])}`);
  if (shots) await page.screenshot({ path: `${shots}/whole-wrong-sign.png` });
  await sign(page, ">");
  now = await read(page);
  check(JSON.stringify(now.statuses) === '["succeeded"]' && now.chosen === ">" && now.live === 0, `the true sign ends the task, with no "done": ${JSON.stringify([now.statuses, now.chosen, now.live])}`);
  check(now.notice === "✓ 6,281 > 6,218: the tens decide; the places after them don't matter." && now.done && now.howto === "", `the full sentence, in green: ${JSON.stringify([now.notice, now.done])}`);
  await click(page, '.place-value-compare-column[data-index="0"] .place-value-compare-strip');
  now = await read(page);
  check(now.notice.startsWith("✓") && now.chosen === ">", "a tap on the chart after it never covers the result");
  if (shots) await page.screenshot({ path: `${shots}/whole-done.png` });

  // Enter on a focused button.
  await open(page, "whole");
  await page.focus(`[data-oll-tap="same:${at(3)}"]`);
  await page.keyboard.press("Enter");
  now = await read(page);
  check(now.values.marked === 1 && now.columns[0].mark === "=", `Enter judges the focused button: ${now.values.marked}`);

  // Chinese decimals: 0.625 and 0.7.
  await open(page, "zh");
  now = await read(page);
  check(now.given === "比较 0.625 和 0.7。" && now.howto === "从左边起，一位一位判断，直到有一位不一样。", `the problem and the line in Chinese: ${JSON.stringify([now.given, now.howto])}`);
  check(JSON.stringify(now.whole) === '["0","0"]' && JSON.stringify(now.frac) === '[".625",".7"]', `written as given, split at the point: ${JSON.stringify([now.whole, now.frac])}`);
  const points = await page.evaluate(() => [...document.querySelectorAll(".place-value-compare-frac")].map((node) => Math.round(node.getBoundingClientRect().left)));
  check(points.length === 2 && Math.abs(points[0] - points[1]) <= 1, `the two points lined up: ${JSON.stringify(points)}`);
  check(now.columns.map((c) => c.zeros).join() === "2,0,1,1" && now.columns[0].buttons.join() === "一样,不一样", `a faint 0 in every empty cell; the buttons in Chinese: ${JSON.stringify(now.columns.map((c) => [c.zeros, c.buttons]))}`);
  check(now.columns.reduce((sum, c) => sum + c.a, 0) === 13 && now.columns.reduce((sum, c) => sum + c.b, 0) === 7, "0.625 has 13 disks, 0.7 has 7");
  await judge(page, "same", -2);
  now = await read(page);
  check(now.notice === "百分位：2 和 0。个位还没有比。", `the Chinese refusal: ${now.notice}`);
  await judge(page, "same", 0);
  await judge(page, "different", -1);
  now = await read(page);
  check(now.notice === "十分位：6 和 7，第一位不同。0.7 的 0.1 多。" && now.caption === "不影响" && now.columns[1].extra === 1 && now.columns[1].paired === 12 /* six pairs, both rows */, `the Chinese deciding fact: ${JSON.stringify([now.notice, now.caption, now.columns[1]])}`);
  await sign(page, ">");
  now = await read(page);
  check(now.notice === "「0.625 > 0.7」不成立。", `the Chinese wrong sign: ${now.notice}`);
  await sign(page, "<");
  now = await read(page);
  check(now.notice === "✓ 0.625 < 0.7：由十分位决定，后面的数位不影响。" && JSON.stringify(now.statuses) === '["succeeded"]', `done in Chinese: ${JSON.stringify([now.notice, now.statuses])}`);
  if (shots) await page.screenshot({ path: `${shots}/zh-done.png` });

  // An equal pair: 2.50 and 2.5, the written decimals bound.
  await open(page, "equal");
  now = await read(page);
  check(now.given === "Compare 2.50 and 2.5." && JSON.stringify(now.sentence) === '["2.50","2.5"]', `0.70-style written decimals kept: ${JSON.stringify([now.given, now.sentence])}`);
  await judge(page, "same", 0);
  await judge(page, "same", -1);
  now = await read(page);
  check(now.greyed && now.values.marked === 2, "not open before the last place");
  await judge(page, "different", -2);
  now = await read(page);
  check(now.notice === "Hundredths: 0 and 0." && now.values.marked === 2, `Different on 0 and 0 is not true: ${now.notice}`);
  await judge(page, "same", -2);
  now = await read(page);
  check(now.notice === "Hundredths: 0 and 0, the same. Every place is the same." && !now.greyed && now.caption === "", `Same all the way: every place the same, nothing hatched: ${JSON.stringify([now.notice, now.caption])}`);
  await sign(page, "=");
  now = await read(page);
  check(now.notice === "✓ 2.50 = 2.5: every place is the same." && now.chosen === "=", `"=": ${now.notice}`);
  if (shots) await page.screenshot({ path: `${shots}/equal-done.png` });

  // The widest cards fit the window and keep their height while worked.
  for (const [name, a] of [["widestWhole", 1_000_000_000], ["widestDecimal", 3_456_789]]) {
    await open(page, name, { frame: 1 });
    await page.waitForTimeout(700); // the camera settles on the card
    const first = await read(page);
    check(first.values.a === a && first.columns.length === 7, `${name}: the card measured is the practice card, seven columns: ${JSON.stringify([first.values.a, first.columns.length])}`);
    const fit = await page.evaluate(() => {
      const labels = [...document.querySelectorAll(".place-value-compare-disk")].map((disk) => ({ label: disk.querySelector("text").textContent, width: disk.querySelector("text").getBBox().width, disk: 2 * Number(disk.querySelector("circle").getAttribute("r")) }));
      const buttons = [...document.querySelectorAll(".place-value-compare-button")].map((button) => ({ text: button.querySelector("text").getBBox().width, box: button.querySelector("rect").getBBox().width }));
      return { over: labels.filter((each) => each.width > each.disk - 1).slice(0, 3), labels: labels.length, buttons: buttons.filter((each) => each.text > each.box - 6).length, scroll: document.documentElement.scrollWidth };
    });
    check(fit.labels > 0 && fit.over.length === 0 && fit.buttons === 0, `${name}: every disk label inside its disk, every button's word inside it: ${JSON.stringify(fit)}`);
    check(first.card.left >= 0 && first.card.right <= 1024 && fit.scroll <= 1024 && first.card.overflow <= 0, `${name}: the card fits 1,024 px with no horizontal scroll: ${JSON.stringify([first.card, fit.scroll])}`);
    const decides = name === "widestWhole" ? 6 : -2;
    for (const place of first.columns.map((c) => c.place).filter((place) => place > decides)) await judge(page, "same", place);
    await judge(page, "different", decides);
    const worked = await read(page);
    check(worked.card.height === first.card.height && worked.card.width === first.card.width, `${name}: the card keeps its size while worked: ${JSON.stringify([first.card, worked.card])}`);
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
  }

  // The program's demonstration, played by the session with motion: one column at a time, then the sign.
  const played = await page.evaluate(async ({ events }) => {
    document.querySelector("#board").replaceChildren();
    localStorage.clear();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "demo", { reducedMotion: false });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    const read = () => {
      const marks = [...document.querySelectorAll(".place-value-compare-mark")].map((mark) => mark.textContent).join("");
      return `${marks}${document.querySelector(".place-value-compare-chosen")?.textContent ?? ""}`;
    };
    const seen = [], focused = [];
    const note = () => {
      const now = read(); if (seen.at(-1) !== now) seen.push(now);
      const focus = document.querySelector(".place-value-compare-focus")?.closest(".place-value-compare-column")?.dataset.index;
      if (focus !== undefined && focused.at(-1) !== focus) focused.push(focus);
    };
    const node = () => Object.values(session.projection.board?.nodes ?? {}).find((candidate) => candidate.kind === "place_value_compare");
    for (let i = 0; i < 600 && Number(node()?.content.compared) !== 4; i += 1) { session.advance(); mounted.view.render(session.projection.board); note(); await wait(20); }
    const notices = [];
    for (let t = 0; t < 70; t += 1) { await wait(150); mounted.view.render(session.projection.board); note(); notices.push(document.querySelector(".place-value-compare-notice")?.textContent ?? ""); }
    const live = document.querySelectorAll(".place-value-compare [data-oll-tap]").length;
    for (let i = 0; i < 600 && session.projection.status !== "completed"; i += 1) { session.advance(); mounted.view.render(session.projection.board); await wait(20); }
    for (let t = 0; t < 20; t += 1) { await wait(100); mounted.view.render(session.projection.board); }
    const values = Object.fromEntries(Object.entries(session.projection.board.variables).map(([k, v]) => [k, v.value]));
    return { seen, focused, notices: [...new Set(notices)], live, values, given: document.querySelector(".place-value-compare-given")?.textContent,
      available: session.studentTasks.map((task) => task.available), marks: document.querySelectorAll(".place-value-compare-mark").length };
  }, { events: events.demo });
  const inOrder = (seen, expected) => { let k = 0; for (const state of seen) if (state === expected[k]) k += 1; return k === expected.length; };
  check(inOrder(played.seen, ["", "=", "==", "==≠", "==≠>"]) && played.seen.at(-1) === "==≠>", `the demonstration judges one column at a time, then the sign: ${JSON.stringify(played.seen)}`);
  check(inOrder(played.focused, ["0", "1", "2"]), `the column being judged is ringed in turn: ${JSON.stringify(played.focused)}`);
  check(played.notices.every((text) => text === ""), `the card narrates nothing while the demonstration shows (the lesson does): ${JSON.stringify(played.notices)}`);
  check(played.live === 0, "nothing to tap while the demonstration shows");
  check(played.given === "Compare 6,281 and 6,218." && played.values.compared === 0 && played.values.marked === 0 && played.values.signed === 0 && played.available[0] === true && played.marks === 0,
    `from the demonstration to a fresh practice on its own pair: ${JSON.stringify([played.given, played.values, played.available, played.marks])}`);

  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`place-value compare browser checks failed (${failures.length} of ${checks}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`place-value compare browser checks passed (${checks}): 6,281 and 6,218 by real clicks (the instruction under the problem, "Same" and "Different" under every column, the sentence locked with its fact, nothing focused; refusals as facts with the refused button marked, the right column dimmed and the leftmost unjudged one ringed; "=", the deciding "≠" with its pairs faded and its extra disks ringed, "Doesn't matter" after it, a decided column's tap stating its fact; no conclusion before the sign; a wrong sign a fact; the true sign ending the task with no done; Enter); Chinese decimals with their points lined up and a faint 0 in every empty cell; an equal pair with its written decimals, "Same" all the way then "="; the widest cards (seven columns) fitting 1,024 px and keeping their size; the demonstration played one column at a time then the sign, the card saying nothing over it, then a fresh practice. Not checked: how long a step holds.`);
