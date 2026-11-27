// Browser checks for a demonstration's pace on tap cards (owner, 2026-11-27: "the learner barely has time to see
// what's happening before the next step begins"), played by the session in real time with the runtime's own
// stylesheet, the board told the session's speed, and every time measured on the page:
// - the trade card: 3,000 − 1,468, "columns finished" 0 -> 1 (three breaks from the thousands down, then the
//   take-away): each action starts a step's slot after the last, its motion lasts about a step, and the lesson's
//   next operation waits for the last hold; at double speed every time halves; paused, the card holds still and
//   goes on when resumed; a learner's tap afterwards keeps its quick motion;
// - the times-ten card: 0.2 counted in thousandths (two rows, each two places along), one row's move a step;
// - the make-ten card: 8 + 6, `filled` 8 -> 10, one counter a step;
// - the compare card: 4,530 and 4,503, `compared` 0 -> 4, one column judged a step, then the sign (decision 0029);
// - the trading mat (default-on): the lesson's own taps, one a step; the place-value chart's own take-outs too;
// - reduced motion: the card changes at once and the lesson does not wait;
// - a card without a title shows no heading: its role ("main_visual") is never drawn as one.
// The times measured are printed. Each run serves its own page on a free port.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { buildBaseTenTrade } from "../dist/packages/plugin-math/src/index.js";
import { DEMONSTRATION_HOLD_MS, DEMONSTRATION_STEP_MS } from "../dist/packages/plugin-math/src/demonstration-pace.js";
import { tradeHost, tradeLesson } from "../dist/packages/plugin-math/test/place-value-trade-fixtures.js";
import { timesTenHost, timesTenLesson } from "../dist/packages/plugin-math/test/place-value-times-ten-fixtures.js";
import { makeTenHost, makeTenLesson } from "../dist/packages/plugin-math/test/make-ten-fixtures.js";
import { chartHost, chartLesson } from "../dist/packages/plugin-math/test/place-value-chart-fixtures.js";
import { compareHost, compareLesson } from "../dist/packages/plugin-math/test/place-value-compare-fixtures.js";

const SLOT = DEMONSTRATION_STEP_MS + DEMONSTRATION_HOLD_MS;
const animate = (key, variable, value) => ({ key, say: "Look.", actions: [{ do: "animate", variable, value }] });
const matLesson = () => {
  const built = buildBaseTenTrade({ as: "mat", role: "main_visual", place: { relation: "new_region" }, columns: 2,
    places: [{ count: { expression: "ones", initial: 13 }, tray: { expression: "tray_ones", initial: 7 } }, { count: { expression: "tens", initial: 2 } }] });
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Trading tens and ones", goals: ["Ten ones make a ten"],
      variables: [{ as: "ones", initial: 13, min: 0, max: 59, label: "ones" }, { as: "tray_ones", initial: 7, min: 0, max: 10, label: "tray" }, { as: "tens", initial: 2, min: 0, max: 9, label: "tens" }] },
    steps: [{ key: "s", purpose: "Look", beats: [{ key: "b", say: "Here is the pile.", actions: built.actions },
      { key: "fill", say: "Three more ones go in the tray, and ten ones make a ten.", actions: [
        ...Array.from({ length: 3 }, () => ({ do: "tap", target: "mat", tap: "gather", at: "ones" })), { do: "tap", target: "mat", tap: "make", at: "ones" }] }] }],
    close: { summary: "Done.", focus: [built.whole] },
  };
};
const lessons = {
  trade: normalizeAuthoringLesson(tradeLesson({ operation: "subtract", a: "3000", b: "1468", practice: [["5000", "2367"]], beats: [animate("ones", "finished", 1)] }), tradeHost("trade")),
  timesTen: normalizeAuthoringLesson(timesTenLesson({ amount: "0.2", target: "0.001", beats: [animate("thousandths", "counted_in", 1)] }), timesTenHost("timesTen")),
  makeTen: normalizeAuthoringLesson(makeTenLesson({ a: 8, b: 6, beats: [animate("ten", "filled", 10)] }), makeTenHost("makeTen")),
  compare: normalizeAuthoringLesson(compareLesson({ a: "4530", b: "4503", beats: [animate("all", "compared", 4)] }), compareHost("compare")),
  mat: normalizeAuthoringLesson(matLesson(), { lessonId: "mat", boardId: "b", baseRevision: 0, regionIntent: "new_topic" }),
  // The place-value chart pulled apart by the lesson's own taps: the hundreds, the tens, the ones.
  chart: normalizeAuthoringLesson(chartLesson({ mode: "apart", given: "numeral", target: 347_000, fixedNumber: true,
    beats: [{ key: "apart", say: "Take out each place.", actions: ["hundreds", "tens", "ones"].map((at) => ({ do: "tap", target: "chart", tap: "take_out", at })) }] }), chartHost("chart")),
};

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
const near = (actual, expected, slack) => Math.abs(actual - expected) <= slack;

/**
 * Plays a lesson's demonstration in real time and measures it: when each step began on the card (its drawing
 * changed), how long the card's own motion lasted after it, and when the lesson's next operation came. `pauseAt`
 * pauses the session there for `pauseFor` ms. Runs until the lesson's next operation, or `limit` ms.
 */
const measure = (page, name, { kind, speed = 1, reducedMotion = false, pauseAt, pauseFor = 0, limit = 30_000 }) => page.evaluate(async ({ events, name, kind, speed, reducedMotion, pauseAt, pauseFor, limit }) => {
  document.querySelector("#board").replaceChildren();
  localStorage.clear();
  // `reducedMotion` "page": the host does not say; the page asks for reduced motion.
  const pageReduced = reducedMotion === "page";
  const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), `${name}-${speed}-${reducedMotion}-${pauseAt ?? ""}`, pageReduced ? {} : { reducedMotion });
  const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
  session.setSpeed(speed);
  mounted.view.setPlaybackSpeed(speed);
  const render = () => mounted.view.render(session.projection.board, session.currentOperation);
  session.subscribe(render);
  const isDemo = () => session.activeVariableAnimation || session.currentOperation?.action?.op === "card.tap"
    || (reducedMotion !== false && session.currentOperation?.action?.op === "lesson.variable.animate");
  // Every operation before the demonstration at once; the demonstration's first operation applied.
  for (let i = 0; i < 400 && !isDemo(); i += 1) session.advance();
  render();
  // Whether the demonstration's operation left anything to play (with reduced motion it changes at once).
  const animating = Boolean(session.activeVariableAnimation);
  await new Promise((done) => setTimeout(done, 300));
  const card = () => document.querySelector(`.board-node[data-kind="${kind}"]`) ?? document.body;
  // What the card shows, counted the way its own browser check reads it.
  const key = () => {
    const root = card();
    const count = (scope, selector) => scope.querySelectorAll(selector).length;
    if (kind === "place_value_trade") return [...root.querySelectorAll(".place-value-trade-place")].map((group) => ["carry", "top", "second", "answer"]
      .map((row) => count(group, `.place-value-trade-disks .place-value-trade-disk[data-row="${row}"]`)).join(",")).join("|");
    if (kind === "place_value_times_ten") return [...root.querySelectorAll(".place-value-times-ten-things")].map((layer) => [...layer.children].filter((child) => child.matches("[data-i]")).length).join(",");
    if (kind === "place_value_chart") return [...root.querySelectorAll(".place-value-place")].map((group) => `${count(group, ".place-value-disks .place-value-disk")}/${count(group, ".place-value-pulled .place-value-disk")}`).join("|");
    if (kind === "place_value_compare") return [...root.querySelectorAll(".place-value-compare-mark")].map((mark) => mark.textContent).join("") + (root.querySelector(".place-value-compare-chosen")?.textContent ?? "");
    if (kind === "make_ten") return [0, 1].map((frame) => count(root, `.make-ten-counter[data-frame="${frame}"]`)).join(",");
    return [...root.querySelectorAll("g.base-ten-place")].map((group) => `${count(group, ".base-ten-unit.base-ten-in-tray:not(.base-ten-leaving)")}/${count(group, ".base-ten-unit:not(.base-ten-in-tray):not(.base-ten-leaving)")}`).join("|");
  };
  // The card's own motion: finite animations and transitions of its elements.
  const moving = () => document.getAnimations().some((animation) => {
    const target = animation.effect?.target;
    return animation.playState === "running" && target instanceof Element && card().contains(target) && animation.effect.getComputedTiming().endTime !== Infinity;
  });
  const first = session.currentOperation?.action?.action_id;
  const firstOp = session.currentOperation?.action?.op;
  const steps = [];
  let last = key();
  let next;
  const t0 = performance.now();
  session.play();
  let paused = false, resumed = false;
  while (performance.now() - t0 < limit) {
    await new Promise((done) => requestAnimationFrame(done));
    const now = performance.now() - t0;
    if (pauseAt !== undefined && !paused && now >= pauseAt) { session.pause(); paused = true; steps.push({ pause: Math.round(now) }); }
    if (paused && !resumed && now >= pauseAt + pauseFor) { session.play(); resumed = true; steps.push({ resume: Math.round(now) }); }
    const k = key();
    if (k !== last) { last = k; steps.push({ at: Math.round(now), motion: 0 }); }
    const step = steps.findLast((each) => each.at !== undefined);
    if (step && moving()) step.motion = Math.round(now - step.at);
    const action = session.currentOperation?.action;
    const lessonTap = firstOp === "card.tap" && action?.op === "card.tap";
    if (next === undefined && action?.action_id !== first && !lessonTap) { next = Math.round(now); break; }
  }
  // Let the last motion end, then a learner's tap on a practice card (when the lesson has one).
  await new Promise((done) => setTimeout(done, 400));
  // A card's role ("main_visual") is never its heading: these cards have no title, so no heading at all.
  const board = document.querySelector("#board");
  return { steps, next, animating, value: session.activeVariableAnimation ? "animating" : "settled",
    titles: [...board.querySelectorAll(".node-title")].map((title) => title.textContent), roleShown: board.textContent.includes("main_visual") };
}, { events: lessons[name], name, kind, speed, reducedMotion, pauseAt, pauseFor, limit });

const report = [];
const untitled = (name, run) => check(run.titles.length === 0 && !run.roleShown, `${name}: a card without a title shows no heading, never its role: ${JSON.stringify(run.titles)}`);
const stepsOf = (run) => run.steps.filter((each) => each.at !== undefined);
const gaps = (steps) => steps.slice(1).map((step, i) => step.at - steps[i].at);
const summarize = (label, run) => {
  const steps = stepsOf(run);
  const line = `${label}: steps at ${steps.map((step) => step.at).join(", ")} ms (gaps ${gaps(steps).join(", ")}), motion ${steps.map((step) => step.motion).join(", ")} ms, next operation at ${run.next} ms`;
  report.push(line);
  return steps;
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);

  // The trade card's cascade, 3,000 − 1,468: four actions, a slot apart; the lesson waits for the last hold.
  const trade = await measure(page, "trade", { kind: "place_value_trade" });
  let steps = summarize("trade 3,000 − 1,468, finished 0 -> 1", trade);
  untitled("trade", trade);
  check(steps.length === 4, `four actions (three breaks, the take-away): ${JSON.stringify(trade.steps)}`);
  check(gaps(steps).every((gap) => near(gap, SLOT, 150)), `each action a slot (${SLOT} ms) after the last: ${gaps(steps)}`);
  check(steps.every((step) => step.motion >= DEMONSTRATION_STEP_MS * 0.6 && step.motion <= DEMONSTRATION_STEP_MS + 300), `each action moves for about a step (${DEMONSTRATION_STEP_MS} ms): ${steps.map((step) => step.motion)}`);
  check(trade.next >= steps[0].at + 4 * SLOT - 50, `the lesson's next operation waits for the last hold: ${trade.next} ms`);

  // Double speed: every time halves.
  const fast = await measure(page, "trade", { kind: "place_value_trade", speed: 2 });
  steps = summarize("trade at speed 2", fast);
  check(steps.length === 4 && gaps(steps).every((gap) => near(gap, SLOT / 2, 120)), `at double speed a slot is ${SLOT / 2} ms: ${gaps(steps)}`);
  check(steps.every((step) => step.motion <= DEMONSTRATION_STEP_MS / 2 + 300), `at double speed the motion halves: ${steps.map((step) => step.motion)}`);
  check(fast.next >= steps[0].at + 2 * SLOT - 50 && fast.next <= steps[0].at + 2 * SLOT + 600, `the next operation after the last half slot: ${fast.next} ms`);

  // Paused in the second step's hold for 3 s: nothing moves, then the demonstration goes on where it was.
  const paused = await measure(page, "trade", { kind: "place_value_trade", pauseAt: SLOT + DEMONSTRATION_STEP_MS + 200, pauseFor: 3_000 });
  steps = summarize("trade paused 3 s in step 2's hold", paused);
  const pause = paused.steps.find((each) => each.pause !== undefined)?.pause, resume = paused.steps.find((each) => each.resume !== undefined)?.resume;
  check(steps.length === 4 && !steps.some((step) => step.at > pause && step.at < resume), `nothing moves while paused: ${JSON.stringify(paused.steps)}`);
  check(near(steps[2].at - resume, SLOT - (pause - steps[1].at), 200), `after resuming, the rest of the slot, then the next step: ${steps[2].at - resume} ms`);

  // Reduced motion, as the host says or, when it does not say, as the page asks: the card's demonstration changes at
  // once, with no steps to play (the runtime's tests time the lesson going on).
  const still = await measure(page, "trade", { kind: "place_value_trade", reducedMotion: true, limit: 3_000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pageStill = await measure(page, "trade", { kind: "place_value_trade", reducedMotion: "page", limit: 3_000 });
  await page.emulateMedia({ reducedMotion: null });
  for (const [label, run] of [["the host's reduced motion", still], ["the page's reduced motion", pageStill]]) {
    report.push(`trade with ${label}: steps to play ${run.animating ? "yes" : "none"}, card changes after it ${stepsOf(run).length}`);
    check(!run.animating && stepsOf(run).length === 0 && run.value === "settled", `with ${label} the demonstration changes at once: ${JSON.stringify(run)}`);
  }

  // A learner's tap on the practice card afterwards keeps its quick motion.
  const tap = await page.evaluate(async ({ events }) => {
    document.querySelector("#board").replaceChildren();
    localStorage.clear();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "trade-tap", { reducedMotion: false });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    while (session.projection.status !== "completed") session.advance();
    mounted.view.setCardTapHandler({
      live: (id) => session.studentCardLive(id),
      tap: (id, tap, input) => { const result = session.tapStudentCard(id, tap, input); mounted.view.render(session.projection.board); return result; },
    });
    mounted.view.render(session.projection.board);
    mounted.view.focusTargets(["trade:node:sum"]);
    await new Promise((done) => setTimeout(done, 900));
    const button = document.querySelector('.place-value-trade-place[data-place="3"] .place-value-trade-disk[data-oll-tap^="break"], .place-value-trade-can-break[data-oll-tap], [data-oll-tap^="break:6"]');
    return { found: Boolean(button), tap: button?.dataset.ollTap };
  }, { events: lessons.trade });
  if (tap.found) {
    const box = await page.locator(`[data-oll-tap="${tap.tap}"]`).first().boundingBox();
    const t0 = await page.evaluate(() => performance.now());
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const motion = await page.evaluate(async (t0) => {
      let last = 0;
      const card = document.querySelector(".place-value-trade").closest(".board-node");
      for (let i = 0; i < 180; i += 1) {
        await new Promise((done) => requestAnimationFrame(done));
        if (document.getAnimations().some((a) => a.playState === "running" && a.effect?.target instanceof Element && card.contains(a.effect.target) && a.effect.getComputedTiming().endTime !== Infinity)) last = performance.now() - t0;
      }
      return Math.round(last);
    }, t0);
    report.push(`a learner's break tap on the practice card: motion ends ${motion} ms after the click`);
    check(motion > 0 && motion < 1_200, `a learner's tap keeps its quick motion: ${motion} ms`);
  } else check(false, `the practice card offers a break to tap: ${JSON.stringify(tap)}`);

  // The times-ten card: 0.2 counted in thousandths, two rows each two places along: four moves.
  const timesTen = await measure(page, "timesTen", { kind: "place_value_times_ten" });
  steps = summarize("times-ten 0.2 counted in thousandths (two rows, two places)", timesTen);
  untitled("times-ten", timesTen);
  check(steps.length === 4 && gaps(steps).every((gap) => near(gap, SLOT, 150)), `one row's move a slot: ${JSON.stringify(timesTen.steps)}`);
  check(steps.every((step) => step.motion >= DEMONSTRATION_STEP_MS * 0.6 && step.motion <= DEMONSTRATION_STEP_MS + 300), `each move lasts about a step: ${steps.map((step) => step.motion)}`);
  check(timesTen.next >= steps[0].at + 4 * SLOT - 50, `the next operation waits: ${timesTen.next} ms`);

  // The make-ten card: 8 + 6, two counters.
  const makeTen = await measure(page, "makeTen", { kind: "make_ten" });
  steps = summarize("make-ten 8 + 6, filled 8 -> 10", makeTen);
  untitled("make-ten", makeTen);
  check(steps.length === 2 && near(gaps(steps)[0], SLOT, 150), `one counter a slot: ${JSON.stringify(makeTen.steps)}`);
  check(steps.every((step) => step.motion >= DEMONSTRATION_STEP_MS * 0.6 && step.motion <= DEMONSTRATION_STEP_MS + 300), `each counter moves for about a step: ${steps.map((step) => step.motion)}`);
  check(makeTen.next >= steps[0].at + 2 * SLOT - 50, `the next operation waits: ${makeTen.next} ms`);

  // The compare card: 4,530 and 4,503, the thousands, the hundreds and the tens judged, then the sign.
  const compare = await measure(page, "compare", { kind: "place_value_compare" });
  steps = summarize("compare 4,530 and 4,503, compared 0 -> 4", compare);
  untitled("compare", compare);
  check(steps.length === 4 && gaps(steps).every((gap) => near(gap, SLOT, 150)), `one column judged a slot, then the sign: ${JSON.stringify(compare.steps)}`);
  check(steps.every((step) => step.motion >= DEMONSTRATION_STEP_MS * 0.6 && step.motion <= DEMONSTRATION_STEP_MS + 300), `each step moves for about a step: ${steps.map((step) => step.motion)}`);
  check(compare.next >= steps[0].at + 4 * SLOT - 50, `the next operation waits: ${compare.next} ms`);

  // The mat: the lesson's own taps, three into the tray and the make, one a slot.
  const mat = await measure(page, "mat", { kind: "base_ten_trade" });
  steps = summarize("mat: the lesson's taps (gather, gather, gather, make)", mat);
  untitled("mat", mat);
  check(steps.length >= 3 && gaps(steps).every((gap) => near(gap, SLOT, 200)), `one lesson tap a slot: ${JSON.stringify(mat.steps)}`);
  check(steps.slice(1).every((step) => step.motion >= DEMONSTRATION_STEP_MS * 0.5 && step.motion <= DEMONSTRATION_STEP_MS + 600), `each tap moves for about a step: ${steps.map((step) => step.motion)}`);

  // The chart: the lesson's own take-outs, one a slot; its new disks pop in over a step.
  const chart = await measure(page, "chart", { kind: "place_value_chart" });
  steps = summarize("place-value chart 347 pulled apart by the lesson's taps (hundreds, tens, ones)", chart);
  untitled("chart", chart);
  check(steps.length >= 2 && gaps(steps).every((gap) => near(gap, SLOT, 200)), `one lesson tap a slot: ${JSON.stringify(chart.steps)}`);
  check(steps.slice(1).every((step) => step.motion >= DEMONSTRATION_STEP_MS * 0.6 && step.motion <= DEMONSTRATION_STEP_MS + 300), `each take-out pops in over about a step: ${steps.map((step) => step.motion)}`);

  check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
for (const line of report) console.log(`  ${line}`);
if (failures.length) {
  console.error(`demonstration pace browser checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`demonstration pace browser checks passed: a step's slot is ${SLOT} ms (${DEMONSTRATION_STEP_MS} ms of motion, ${DEMONSTRATION_HOLD_MS} ms held) on the trade card's cascade, the times-ten card's rows, the make-ten card's counters, the compare card's columns and sign, the mat's and the chart's lesson taps; the lesson waits for the last; double speed halves it; a pause holds it; reduced motion changes at once; a learner's tap stays quick; no card shows its role as a heading`);
