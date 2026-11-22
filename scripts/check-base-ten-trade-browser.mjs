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
//   Enter on a focused unit taps it, and the card is inert again once the learner says done.
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
  emphasis: lesson({ columns: 2, places: [{ count: 17 }, { count: 2 }] }, [],
    [{ key: "focus", say: "Look at the tens.", actions: [{ do: "emphasize", target: "mat#tens", emphasis: "focus" }] }]),
};
cases.taps.lesson.tasks = [{
  as: "trade", start: { kind: "practice", variables: ["ones", "tray_ones", "tens"], values: { ones: 17, tray_ones: 0, tens: 2 } },
  prompt: "Make tens until you can't. Then tap I'm done.", availability: { kind: "after_lesson" },
  allowed_operations: [{ kind: "card_tap", node: "mat" }, { kind: "card_submit" }],
  completion: { kind: "card_fact", node: "mat", fact: "no_trade_left" }, hints: ["Fill the tray."],
}];
const events = Object.fromEntries(Object.entries(cases).map(([name, authored]) => [name, normalizeAuthoringLesson(authored, host(name))]));

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
  for (const name of Object.keys(cases)) {
    if (name === "taps") continue;
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
  for (let i = 0; i < 8; i += 1) await clickPiece((await mat()).loose[0]);
  await clickButton("make:0");
  now = await mat();
  check(now.notice === "Fill the tray first: a ten is ten ones." && now.values.tens === 2, `nine in the tray: refused with the card's reason: ${JSON.stringify(now)}`);
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
  check(errors.length === 0, `page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("trading mat browser checks passed: two and three columns named in words, no number drawn; each place drawn to its count, trays filled inside their outlines; the most each place reaches inside the card, loose units apart, nine hundreds whole and apart; one size as counts move; buttons inert while the lesson plays; emphasis on one place; a demonstration of taps; real taps on a card task (the unit tapped moves, refusals explained, a ten made, Enter taps, inert after done)");
