// Browser checks for the trading mat (decision 0023), with the runtime's own stylesheet:
// - two columns (tens and ones) or three, named in words; no number is drawn on the mat;
// - each place draws as many units as its count, a tray's units inside its outline of ten;
// - at the most each place can reach (59 ones, 34 tens, 9 hundreds) every unit stays inside the card and
//   no two loose units overlap; hundreds stand three to a row, never overlapping (owner, 2026-11-22);
// - the card keeps one size as its counts move;
// - two buttons under each tray, not tappable until a task opens the mat;
// - emphasizing a place marks that place only;
// - with a card task open (decision 0023, PR C), real taps: the unit tapped is the unit that moves into the
//   tray, a refused tap shows the card's reason, ten make a ten (the counts settle after the animation),
//   Enter on a focused unit taps it, and the card is inert again once the learner says done;
// - a slider on the ones' count (decision 0023 amendment 4): disabled while the lesson plays, its track on the
//   stops trades reach, and two stops by keyboard animate two trades one after another (the tray fills to ten,
//   ten fuse into a ten), not a jump, the last drawn to its end before the next task's pile arrives.
// Piles here are invented for the check. Screenshots go to OLL_BASE_TEN_SCREENSHOTS when it is set.
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { normalizeAuthoringLesson } from "../dist/packages/core/src/index.js";
import { buildBaseTenTrade } from "../dist/packages/plugin-math/src/index.js";

const place = { relation: "new_region" };
const drive = (as, initial) => ({ expression: as, initial });
const variable = (as, initial, max) => ({ as, initial, min: 0, max, label: as });
const lesson = (input, variables = [], beats = []) => {
  const built = buildBaseTenTrade({ as: "mat", role: "main_visual", place, ...input });
  return {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Trading tens and ones", goals: ["Ten ones make a ten"], variables },
    steps: [{ key: "s", purpose: "Look", beats: [{ key: "b", say: "Here is the pile.", actions: built.actions }, ...beats] }],
    close: { summary: "Done.", focus: [built.whole] },
  };
};
const animate = (key, values) => ({ key, say: "Look.", actions: Object.entries(values).map(([variable, value]) => ({ do: "animate", variable, value })) });
const host = (lessonId) => ({ lessonId, boardId: "b", baseRevision: 0, regionIntent: "new_topic" });
const twoVars = [variable("ones", 17, 59), variable("tray_ones", 0, 10), variable("tens", 2, 9)];
const threeVars = [variable("ones", 16, 59), variable("tray_ones", 0, 10), variable("tens", 12, 34), variable("tray_tens", 0, 10), variable("hundreds", 6, 9)];
const cases = {
  two: lesson({ columns: 2, places: [{ count: 17 }, { count: 2 }] }),
  three: lesson({ columns: 3, places: [{ count: 16 }, { count: 9 }, { count: 6 }] }),
  // The tray fills to ten, then the counts move to the most the mat draws.
  moving: lesson({ columns: 3, places: [{ count: drive("ones", 16), tray: drive("tray_ones", 0) }, { count: drive("tens", 12), tray: drive("tray_tens", 0) }, { count: drive("hundreds", 6) }] },
    threeVars, [animate("fill", { tray_ones: 10 }), animate("tens", { tray_tens: 10 }), animate("most", { tray_ones: 0, tray_tens: 0, ones: 59, tens: 34, hundreds: 9 })]),
  filled: lesson({ columns: 2, places: [{ count: drive("ones", 17), tray: drive("tray_ones", 0) }, { count: drive("tens", 2) }] },
    twoVars, [animate("fill", { tray_ones: 10 })]),
  demo: lesson({ columns: 2, places: [{ count: drive("ones", 17), tray: drive("tray_ones", 0) }, { count: drive("tens", 2) }] },
    [variable("ones", 17, 59), variable("tray_ones", 0, 10), variable("tens", 2, 9)],
    [{ key: "fill", say: "Put ones in the tray.", actions: Array.from({ length: 10 }, () => ({ do: "tap", target: "mat", tap: "gather", at: "ones" })) },
      { key: "make", say: "Ten ones make a ten.", actions: [{ do: "tap", target: "mat", tap: "make", at: "ones" }] }]),
  taps: { ...lesson({ columns: 2, places: [{ count: drive("ones", 14), tray: drive("tray_ones", 0) }, { count: drive("tens", 3) }] },
    [variable("ones", 14, 59), variable("tray_ones", 0, 10), variable("tens", 3, 9)]) },
  // A mat that speaks Chinese (amendment 3): the same layout, its own words.
  zh: lesson({ columns: 3, language: "zh-CN", places: [{ count: 16 }, { count: 9 }, { count: 6 }] }),
  emphasis: lesson({ columns: 2, places: [{ count: 17 }, { count: 2 }] }, [],
    [{ key: "focus", say: "Look at the tens.", actions: [{ do: "emphasize", target: "mat#tens", emphasis: "focus" }] }]),
};
cases.taps3 = lesson({ columns: 3, places: [{ count: drive("ones", 16), tray: drive("tray_ones", 0) }, { count: drive("tens", 12), tray: drive("tray_tens", 0) }, { count: drive("hundreds", 1) }] },
  [variable("ones", 16, 59), variable("tray_ones", 0, 10), variable("tens", 12, 34), variable("tray_tens", 0, 10), variable("hundreds", 1, 9)]);
cases.taps3.lesson.tasks = [{
  as: "trade", start: { kind: "practice", variables: ["ones", "tray_ones", "tens", "tray_tens", "hundreds"], values: { ones: 13, tens: 9, hundreds: 1 } },
  prompt: "Make tens and hundreds until you can't. Then tap I'm done.", availability: { kind: "after_lesson" },
  allowed_operations: [{ kind: "card_tap", node: "mat" }, { kind: "card_submit" }],
  completion: { kind: "card_fact", node: "mat", fact: "no_trade_left" }, hints: ["Put ones in the tray; when ten fill it, make a ten."],
}];
cases.tapsZh = lesson({ columns: 2, language: "zh-CN", places: [{ count: drive("ones", 14), tray: drive("tray_ones", 0) }, { count: drive("tens", 3) }] },
  [variable("ones", 14, 59), variable("tray_ones", 0, 10), variable("tens", 3, 9)]);
cases.taps.lesson.tasks = [{
  as: "trade", start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 17, tray_ones: 0, tens: 2 } },
  prompt: "Make tens until you can't. Then tap I'm done.", availability: { kind: "after_lesson" },
  allowed_operations: [{ kind: "card_tap", node: "mat" }, { kind: "card_submit" }],
  completion: { kind: "card_fact", node: "mat", fact: "no_trade_left" }, hints: ["Put ones in the tray; when ten fill it, make a ten."],
}];
cases.tapsZh.lesson.tasks = cases.taps.lesson.tasks;
cases.slider = lesson({ columns: 2, places: [{ count: drive("ones", 14), tray: drive("tray_ones", 0) }, { count: drive("tens", 3) }] },
  [{ ...variable("ones", 14, 59), control: { kind: "slider", step: 10 } }, variable("tray_ones", 0, 10), variable("tens", 3, 9)]);
cases.slider.lesson.tasks = [{
  as: "slide", start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 26, tray_ones: 0, tens: 3 } },
  prompt: "Slide the ones until there are 6.", availability: { kind: "after_lesson" },
  allowed_operations: [{ kind: "variable_change", variable: "ones", controls: ["slider"] }],
  completion: { kind: "expression_target", expression: "ones", value: 6, tolerance: 0.5 }, hints: ["Each stop trades ten ones for a ten."],
}, {
  // A next task with its own pile: it arrives at once, while the last trade is still being drawn.
  as: "again", start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 35, tray_ones: 0, tens: 1 } },
  prompt: "Slide the ones until there are 15.", availability: { kind: "after_lesson" },
  allowed_operations: [{ kind: "variable_change", variable: "ones", controls: ["slider"] }],
  completion: { kind: "expression_target", expression: "ones", value: 15, tolerance: 0.5 }, hints: ["Each stop trades ten ones for a ten."],
}];
const events = Object.fromEntries(Object.entries(cases).map(([name, authored]) => [name, normalizeAuthoringLesson(authored, host(name))]));

const bundle = await build({
  stdin: { contents: `
    import "./packages/web-runtime/styles.css";
    import { mountInfiniteBoard } from "./packages/web-runtime/src/board-view.ts";
    import { BrowserLessonSession, LocalPlaybackStore } from "./packages/web-runtime/src/runtime.ts";
    import { mountVariableControls } from "./packages/web-runtime/src/variable-controls.ts";
    Object.assign(window, { mountInfiniteBoard, BrowserLessonSession, LocalPlaybackStore, mountVariableControls });
  `, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "esm", platform: "browser", write: false, outdir: "/out",
  loader: { ".woff2": "empty", ".woff": "empty", ".ttf": "empty", ".svg": "text" },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).contents;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.contents ?? "";
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/probe.js" ? "text/javascript" : request.url === "/probe.css" ? "text/css" : "text/html");
  response.end(request.url === "/probe.js" ? js : request.url === "/probe.css" ? css
    : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/probe.css"><div id="board" style="position:relative;width:1000px;height:760px"></div><script type="module" src="/probe.js"></script>');
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const executablePath = process.env.OLL_CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => existsSync(path));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const shots = process.env.OLL_BASE_TEN_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BrowserLessonSession);
  const played = {};
  const states = async (name) => (played[name] ??= await play(name));
  const play = async (name) => {
    const seen = await page.evaluate(({ events, name }) => {
      document.querySelector("#board").replaceChildren();
      const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), name);
      const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
      const seen = [];
      const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      for (let step = 0; session.projection.status !== "completed"; step += 1) {
        if (step > 200) { seen.push({ stuck: session.projection.status }); break; }
        session.advance();
        mounted.view.render(session.projection.board);
        const svg = document.querySelector(".base-ten-mat");
        if (!svg) continue;
        const card = svg.closest(".board-node");
        const places = [...svg.querySelectorAll(".base-ten-place")].map((group) => ({
          id: group.dataset.id, focused: group.classList.contains("emphasis-focus"),
          loose: [...group.querySelectorAll(".base-ten-unit:not(.base-ten-in-tray) .base-ten-block")].map(rect),
          tray: [...group.querySelectorAll(".base-ten-in-tray .base-ten-block")].map(rect),
          place: Number(group.querySelector(".base-ten-unit")?.dataset.place ?? -1),
        }));
        seen.push({
          variables: Object.fromEntries(Object.entries(session.projection.board.variables ?? {}).map(([k, v]) => [k, v.value])),
          svg: rect(svg), card: card ? rect(card) : null, places,
          trays: [...svg.querySelectorAll(".base-ten-tray")].map(rect),
          texts: [...svg.querySelectorAll("text")].map((text) => text.textContent),
          headings: [...svg.querySelectorAll(".base-ten-heading")].map((text) => text.textContent),
          buttons: [...svg.querySelectorAll(".base-ten-button")].map((button) => ({ text: button.textContent, focusable: button.hasAttribute("tabindex") })),
          live: svg.querySelectorAll(".base-ten-live").length,
        });
      }
      return seen;
    }, { events: events[name], name });
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
    return seen;
  };
  const inside = (inner, outer, slack = 1) => inner && outer && inner.left >= outer.left - slack && inner.right <= outer.right + slack && inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack;
  const apart = (a, b) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
  const allApart = (boxes) => boxes.every((a, i) => boxes.slice(i + 1).every((b) => apart(a, b)));
  const last = (seen) => seen.filter((state) => !state.stuck).at(-1);
  const counted = (state) => state.places.map((place) => place.loose.length + place.tray.length);

  const two = last(await states("two"));
  check(JSON.stringify(two?.headings) === JSON.stringify(["Tens", "Ones"]), `two columns, named in words: ${JSON.stringify(two?.headings)}`);
  check(JSON.stringify(counted(two)) === "[17,2]", `2 tens and 17 ones drawn: ${JSON.stringify(two && counted(two))}`);
  const three = last(await states("three"));
  check(JSON.stringify(three?.headings) === JSON.stringify(["Hundreds", "Tens", "Ones"]), `three columns, named in words: ${JSON.stringify(three?.headings)}`);
  check(JSON.stringify(counted(three)) === "[16,9,6]", `6 hundreds, 9 tens, 16 ones drawn: ${JSON.stringify(three && counted(three))}`);
  const zh = last(await states("zh"));
  check(JSON.stringify(zh?.headings) === JSON.stringify(["百位", "十位", "个位"]), `a Chinese mat names its columns in Chinese: ${JSON.stringify(zh?.headings)}`);
  check(JSON.stringify(zh?.buttons.map((button) => button.text)) === JSON.stringify(["← 换成一个百", "拆开一个百 →", "← 换成一个十", "拆开一个十 →"]), `a Chinese mat's buttons: ${JSON.stringify(zh?.buttons)}`);
  check(zh && JSON.stringify(counted(zh)) === "[16,9,6]" && JSON.stringify(zh.svg) === JSON.stringify(three.svg), `a Chinese mat is drawn as the English one: ${JSON.stringify(zh && [counted(zh), zh.svg, three.svg])}`);
  for (const name of Object.keys(cases)) {
    if (name === "taps" || name === "taps3" || name === "tapsZh" || name === "slider") continue;
    for (const state of (await states(name)).filter((each) => !each.stuck)) {
      check(state.texts.every((text) => !/\d/.test(text)), `${name}: no number drawn on the mat: ${JSON.stringify(state.texts)}`);
      const boxes = state.places.flatMap((place) => [...place.loose, ...place.tray]);
      check(boxes.every((box) => inside(box, state.card)), `${name}: every unit inside the card`);
      check(allApart(state.places.flatMap((place) => place.loose)), `${name}: no two loose units overlap (${JSON.stringify(state.variables)})`);
      check(state.buttons.length === state.trays.length * 2 && state.buttons.every((button) => !button.focusable) && state.live === 0, `${name}: two buttons per tray, nothing tappable while the lesson plays: ${JSON.stringify(state.buttons)}`);
    }
  }
  const moving = (await states("moving")).filter((state) => !state.stuck);
  check(moving.length > 0 && !(await states("moving")).some((state) => state.stuck), "the moving lesson plays through");
  const most = moving.at(-1);
  check(most && JSON.stringify(counted(most).map((n, i) => n)) === "[59,34,9]", `the most the mat draws: 59 ones, 34 tens, 9 hundreds: ${JSON.stringify(most && counted(most))}`);
  const hundreds = most?.places.find((place) => place.place === 2)?.loose ?? [];
  check(hundreds.length === 9 && allApart(hundreds), `nine hundreds, each whole and apart: ${JSON.stringify(hundreds.map((box) => [Math.round(box.left), Math.round(box.top)]))}`);
  const sizes = new Set(moving.map((state) => `${Math.round(state.svg.width)}x${Math.round(state.svg.height)}`));
  check(sizes.size === 1, `the card keeps one size as its counts move: ${[...sizes].join(" ")}`);
  const tensFull = moving.find((state) => state.variables.tray_tens === 10);
  const tensTray = tensFull?.places.find((place) => place.place === 1)?.tray ?? [];
  check(tensTray.length === 10 && tensTray.every((box) => inside(box, tensFull.trays[0], 3)), `ten tens fill the tens tray's outline: ${tensTray.length}`);
  const filled = last(await states("filled"));
  const onesTray = filled?.places.find((place) => place.place === 0)?.tray ?? [];
  check(onesTray.length === 10 && onesTray.every((box) => inside(box, filled.trays.at(-1), 3)) && allApart(onesTray), `ten ones fill the ones tray's outline: ${onesTray.length}`);
  check(filled && filled.places.find((place) => place.place === 0).loose.length === 7, "seven ones stay loose");
  const emphasis = last(await states("emphasis"));
  check(emphasis && emphasis.places.every((place) => place.id && place.id.includes(":fragment:")), `each place has its canonical id: ${JSON.stringify(emphasis?.places.map((place) => place.id))}`);
  check(emphasis && emphasis.places.find((place) => place.id.endsWith(":tens"))?.focused && !emphasis.places.find((place) => place.id.endsWith(":ones"))?.focused, "emphasizing mat#tens marks the tens only");
  // A demonstration of taps plays through: the tray fills, then ten ones become a ten.
  const demo = (await states("demo")).filter((state) => !state.stuck);
  check(!(await states("demo")).some((state) => state.stuck), "the demonstration plays through");
  const filledDemo = demo.find((state) => state.variables.tray_ones === 10);
  check(filledDemo && filledDemo.places.find((place) => place.place === 0)?.tray.length === 10, "the demonstration fills the tray with ten");
  check(demo.at(-1) && JSON.stringify(counted(demo.at(-1))) === "[7,3]" && demo.at(-1).variables.tens === 3, `after the demonstration: 3 tens and 7 ones: ${JSON.stringify(demo.at(-1) && counted(demo.at(-1)))}`);
  // Real taps on a card task's mat.
  await page.evaluate(({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "taps-live", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    while (session.projection.status !== "completed") session.advance();
    mounted.view.setCardTapHandler({
      live: (id) => session.studentCardLive(id),
      tap: (id, tap, input) => { const result = session.tapStudentCard(id, tap, input); mounted.view.render(session.projection.board); return result; },
    });
    mounted.view.render(session.projection.board);
    window.trade = { session, mounted };
  }, { events: events.taps });
  const mat = () => page.evaluate(() => {
    const svg = document.querySelector(".base-ten-mat");
    const values = Object.fromEntries(Object.entries(window.trade.session.projection.board.variables).map(([k, v]) => [k, v.value]));
    return {
      values, live: svg.querySelectorAll(".base-ten-live").length, notice: document.querySelector(".base-ten-notice")?.textContent ?? "",
      tray: [...svg.querySelectorAll(".base-ten-in-tray")].map((unit) => unit.dataset.ollPiece),
      loose: [...svg.querySelectorAll('.base-ten-unit[data-place="0"]:not(.base-ten-in-tray):not(.base-ten-leaving)')].map((unit) => unit.dataset.ollPiece),
      tens: svg.querySelectorAll('.base-ten-unit[data-place="1"]:not(.base-ten-leaving)').length,
    };
  });
  const clickPiece = async (piece) => {
    const box = await page.locator(`.base-ten-unit[data-oll-piece="${piece}"] .base-ten-block`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const clickButton = async (tap) => {
    const box = await page.locator(`.base-ten-button[data-oll-tap="${tap}"] rect`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  let now = await mat();
  check(JSON.stringify(now.values) === JSON.stringify({ ones: 17, tray_ones: 0, tens: 2 }) && now.live > 0, `the practice pile is on a live mat: ${JSON.stringify(now)}`);
  const chosen = now.loose[5];
  await clickPiece(chosen);
  now = await mat();
  check(now.tray.length === 1 && now.tray[0] === chosen && now.values.tray_ones === 1, `the unit tapped is the unit in the tray: ${JSON.stringify({ chosen, tray: now.tray })}`);
  // A unit on its way to the tray is not tapped: a quick second tap at the same spot never takes it back out.
  // It reaches the next loose unit if that has slid there, else it does nothing; it never falls through to a
  // button or the board (Learn on CI: the moving unit was taken back out; review of #96).
  const [first, second] = (await mat()).loose;
  const spot = await page.locator(`.base-ten-unit[data-oll-piece="${first}"] .base-ten-block`).boundingBox();
  const [sx, sy] = [spot.x + spot.width / 2, spot.y + spot.height / 2];
  await page.mouse.click(sx, sy);
  // Logged, not required: on a slow machine the move may already have ended (review of #96).
  const inFlight = await page.evaluate((piece) => document.querySelector(`.base-ten-unit[data-oll-piece="${piece}"]`).classList.contains("base-ten-moving"), first);
  await page.mouse.click(sx, sy);
  now = await mat();
  const afterQuick = now.tray.includes(second) ? 3 : 2;
  check(now.tray.includes(first) && now.values.tray_ones === afterQuick && now.notice === "" && now.tens === 2,
    `a quick second tap never undoes the first: ${JSON.stringify({ inFlight, first, second, tray: now.tray, notice: now.notice })}`);
  await page.waitForTimeout(600);
  check(await page.evaluate((piece) => !document.querySelector(`.base-ten-unit[data-oll-piece="${piece}"]`).classList.contains("base-ten-moving"), first), "a unit is settled once it is in the tray");
  while ((await mat()).tray.length < 9) await clickPiece((await mat()).loose[0]);
  await clickButton("make:0");
  now = await mat();
  check(now.notice === "This tray does not hold a ten: a ten is ten ones." && now.values.tens === 2, `nine in the tray: refused with the card's reason: ${JSON.stringify(now)}`);
  // Enter on a focused unit taps it.
  await page.locator(`.base-ten-unit[data-oll-piece="${(await mat()).loose[0]}"]`).focus();
  await page.keyboard.press("Enter");
  now = await mat();
  check(now.values.tray_ones === 10 && now.notice === "", `Enter taps the focused unit; the notice clears: ${JSON.stringify(now)}`);
  await clickPiece(now.loose[0]);
  check((await mat()).notice === "The tray holds only ten.", "an eleventh is refused: the tray holds only ten");
  await clickButton("make:0");
  await page.waitForTimeout(1200);
  now = await mat();
  check(JSON.stringify(now.values) === JSON.stringify({ ones: 7, tray_ones: 0, tens: 3 }) && now.tens === 3 && now.tray.length === 0 && now.loose.length === 7, `ten make a ten; after the animation 3 tens and 7 ones are drawn: ${JSON.stringify(now)}`);
  const settled = await page.evaluate(() => {
    const card = document.querySelector(".base-ten-mat").closest(".board-node").getBoundingClientRect();
    return [...document.querySelectorAll(".base-ten-unit .base-ten-block")].every((block) => { const r = block.getBoundingClientRect(); return r.left >= card.left - 1 && r.right <= card.right + 1 && r.top >= card.top - 1 && r.bottom <= card.bottom + 1; });
  });
  check(settled, "after the animation every unit sits inside the card");
  if (shots) await page.screenshot({ path: `${shots}/taps.png` });
  await page.evaluate(() => { window.trade.session.submitStudentCard("trade"); window.trade.mounted.view.render(window.trade.session.projection.board); });
  now = await mat();
  check(now.live === 0, `after "done" the mat is inert: ${now.live} live elements`);
  // Make a ten, then at once tap the ten just made into the tens tray (review of #88): no stale move.
  await page.evaluate(({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "taps3-live", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    while (session.projection.status !== "completed") session.advance();
    mounted.view.setCardTapHandler({
      live: (id) => session.studentCardLive(id),
      tap: (id, tap, input) => { const result = session.tapStudentCard(id, tap, input); mounted.view.render(session.projection.board); return result; },
    });
    mounted.view.render(session.projection.board);
    window.trade = { session, mounted };
  }, { events: events.taps3 });
  for (let i = 0; i < 10; i += 1) await clickPiece((await mat()).loose[0]);
  await clickButton("make:0");
  const madeTen = await page.evaluate(() => [...document.querySelectorAll('.base-ten-unit[data-place="1"]:not(.base-ten-leaving)')].at(-1).dataset.ollPiece);
  await clickPiece(madeTen);
  await page.waitForTimeout(1200);
  const quick = await page.evaluate(() => {
    const trays = [...document.querySelectorAll(".base-ten-tray")].map((tray) => tray.getBoundingClientRect());
    const tensTray = trays[0];
    const inTray = [...document.querySelectorAll('.base-ten-unit.base-ten-in-tray[data-place="1"] .base-ten-block')].map((block) => block.getBoundingClientRect());
    return { tray_tens: window.trade.session.projection.board.variables.tray_tens.value, inTray: inTray.length,
      inside: inTray.every((r) => r.left >= tensTray.left - 2 && r.right <= tensTray.right + 2 && r.top >= tensTray.top - 2 && r.bottom <= tensTray.bottom + 2) };
  });
  check(quick.tray_tens === 1 && quick.inTray === 1 && quick.inside, `a ten tapped right after it was made sits in the tens tray: ${JSON.stringify(quick)}`);
  // A Chinese mat's task: its units are named, and a refused tap explained, in Chinese.
  const zhTask = await page.evaluate(({ events }) => {
    document.querySelector("#board").replaceChildren();
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "taps-zh", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    while (session.projection.status !== "completed") session.advance();
    mounted.view.setCardTapHandler({ live: (id) => session.studentCardLive(id), tap: (id, tap, input) => session.tapStudentCard(id, tap, input) });
    mounted.view.render(session.projection.board);
    const id = document.querySelector(".base-ten-mat").closest(".board-node").dataset.nodeId
      ?? Object.keys(session.projection.board.nodes).find((key) => key.endsWith(":node:mat"));
    const refused = session.tapStudentCard(id, { kind: "make", place: 0 });
    return { mat: document.querySelector(".base-ten-mat").getAttribute("aria-label"), label: document.querySelector(".base-ten-unit.base-ten-live")?.getAttribute("aria-label"), message: refused.message, texts: [...document.querySelectorAll(".base-ten-mat text")].map((text) => text.textContent) };
  }, { events: events.tapsZh });
  check(zhTask.mat === "数位方块" && zhTask.label === "把这个一放进托盘" && zhTask.message === "先点个位里的一，把它们放进托盘。", `a Chinese mat's task speaks Chinese: ${JSON.stringify(zhTask)}`);
  check(zhTask.texts.every((text) => !/\d/.test(text)), `a Chinese mat draws no number: ${JSON.stringify(zhTask.texts)}`);
  // A slider on the ones' count (amendment 4): each stop is a trade, drawn as the taps are.
  const slider = () => page.evaluate(() => {
    const input = document.querySelector('.oll-variable-control[data-variable="ones"] input');
    const svg = document.querySelector(".base-ten-mat");
    return {
      input: input && { min: input.min, max: input.max, step: input.step, value: input.value, disabled: input.disabled },
      values: Object.fromEntries(Object.entries(window.slide.session.projection.board.variables).map(([k, v]) => [k, v.value])),
      loose: svg ? svg.querySelectorAll('.base-ten-unit[data-place="0"]:not(.base-ten-in-tray):not(.base-ten-leaving)').length : -1,
      tray: svg ? svg.querySelectorAll(".base-ten-unit.base-ten-in-tray:not(.base-ten-leaving)").length : -1,
      tens: svg ? svg.querySelectorAll('.base-ten-unit[data-place="1"]:not(.base-ten-leaving)').length : -1,
      status: window.slide.session.studentTasks[0].status,
    };
  });
  await page.evaluate(({ events }) => {
    document.querySelector("#board").replaceChildren();
    const controls = document.createElement("div");
    controls.style.cssText = "position:absolute;left:10px;bottom:10px;width:320px";
    document.body.append(controls);
    const session = new window.BrowserLessonSession(events, new window.LocalPlaybackStore(), "slider-live", { reducedMotion: true });
    const mounted = window.mountInfiniteBoard(document.querySelector("#board"));
    // Wired as a host wires it (the playback harness): the session decides, the board animates each trade.
    const onChange = (alias, value, event) => {
      if (event.phase === "start") return session.beginStudentVariableOperation(alias, { control: event.control, input: event.input });
      if (!event.operation_id) return;
      if (event.phase === "update") session.updateStudentVariableOperation(event.operation_id, value);
      else session.commitStudentVariableOperation(event.operation_id, value);
    };
    const view = window.mountVariableControls(controls, onChange);
    mounted.view.setCardTapHandler({ live: (id) => session.studentCardLive(id), tap: (id, tap, input) => session.tapStudentCard(id, tap, input), takeSteps: (id) => session.takeStudentCardSteps(id) });
    const render = () => { mounted.view.render(session.projection.board); view.render(session.projection.board, undefined, { live: (alias) => session.studentVariableLive(alias) }); };
    session.subscribe(render);
    window.slide = { session, render };
    while (!session.projection.board?.nodes || !Object.keys(session.projection.board.nodes).length) session.advance();
    render();
  }, { events: events.slider });
  let slid = await slider();
  check(slid.input?.disabled === true, `while the lesson plays the slider on a count is disabled: ${JSON.stringify(slid)}`);
  await page.evaluate(() => { while (window.slide.session.projection.status !== "completed") window.slide.session.advance(); window.slide.render(); });
  slid = await slider();
  check(slid.input && !slid.input.disabled && slid.input.min === "6" && slid.input.max === "56" && slid.input.step === "10" && slid.input.value === "26"
    && slid.loose === 26 && slid.tens === 3, `the slider is live on the practice pile, its stops where trades reach (6 to 56): ${JSON.stringify(slid)}`);
  // Watch the mat while two stops are pressed: the tray must fill to ten before each ten is made.
  await page.evaluate(() => {
    window.slideSeen = { maxTray: 0, frames: 0, ended: false };
    const watch = () => {
      const tray = document.querySelectorAll(".base-ten-unit.base-ten-in-tray:not(.base-ten-leaving)").length;
      window.slideSeen.maxTray = Math.max(window.slideSeen.maxTray, tray);
      const loose = document.querySelectorAll('.base-ten-unit[data-place="0"]:not(.base-ten-in-tray):not(.base-ten-leaving)').length;
      const tens = document.querySelectorAll('.base-ten-unit[data-place="1"]:not(.base-ten-leaving)').length;
      // The second trade drawn to its end (6 ones, 5 tens) before the next task's pile.
      if (loose === 6 && tens === 5 && tray === 0) window.slideSeen.ended = true;
      window.slideSeen.frames += 1;
      if (window.slideSeen.frames < 600) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  const started = Date.now();
  await page.locator('.oll-variable-control[data-variable="ones"] input').focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  slid = await slider();
  check(slid.status === "succeeded" && JSON.stringify(slid.values) === JSON.stringify({ ones: 35, tray_ones: 0, tens: 1 }),
    `two stops are two trades in the session (ones 6, tens 5: done), then the next task's pile: ${JSON.stringify(slid)}`);
  check(slid.tens < 5 || slid.loose > 6, `the mat does not jump to the end: ${JSON.stringify(slid)}`);
  await page.waitForFunction(() => {
    const svg = document.querySelector(".base-ten-mat");
    return svg.querySelectorAll('.base-ten-unit[data-place="0"]:not(.base-ten-in-tray):not(.base-ten-leaving)').length === 35
      && svg.querySelectorAll('.base-ten-unit[data-place="1"]:not(.base-ten-leaving)').length === 1
      && svg.querySelectorAll(".base-ten-unit.base-ten-in-tray").length === 0;
  }, undefined, { timeout: 8000 });
  const took = Date.now() - started;
  const seen = await page.evaluate(() => window.slideSeen);
  slid = await slider();
  check(seen.maxTray === 10, `each trade fills the tray to ten before ten make a ten: ${JSON.stringify(seen)}`);
  check(seen.ended, `the last trade is drawn to its end before the next task's pile: ${JSON.stringify(seen)}`);
  check(took > 1500, `two trades are drawn one after another, not at once (${took} ms)`);
  check(slid.tray === 0 && !slid.input.disabled && slid.input.value === "35" && slid.input.min === "5" && slid.input.max === "45",
    `then the next task's pile, its slider live on its own stops: ${JSON.stringify(slid)}`);
  if (shots) await page.screenshot({ path: `${shots}/slider.png` });
  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("trading mat browser checks passed: two and three columns named in words, no number drawn; each place drawn to its count, trays filled inside their outlines; the most each place reaches inside the card, loose units apart, nine hundreds whole and apart; one size as counts move; buttons inert while the lesson plays; emphasis on one place; a demonstration of taps; real taps on a card task (the unit tapped moves, a quick second tap never undoes the first, refusals explained, a ten made, Enter taps, inert after done); a mat in Chinese, drawn the same, its words and refusals in Chinese; a slider on the ones' count, disabled while the lesson plays, stopping where trades reach, drawing each trade as the taps do");
