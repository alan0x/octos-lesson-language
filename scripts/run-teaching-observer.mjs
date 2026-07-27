import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { chromium } from "playwright-core";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function findChrome() {
  const candidates = [
    process.env.OLL_CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("Chrome/Chromium not found. Set OLL_CHROME_PATH to a browser executable.");
  return executable;
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 4173;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForServer(url, processHandle) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (processHandle.exitCode !== null) throw new Error(`Harness server exited with code ${processHandle.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Harness server did not become ready at ${url}`);
}

function localBeatId(id) { return id?.split(":").at(-1) ?? "—"; }

function markdown(report) {
  const lines = [
    "# Teaching playback observer report",
    "",
    `- Lesson: \`${report.lesson_id}\``,
    `- Viewport: ${report.viewport.width} × ${report.viewport.height}`,
    `- Browser: ${report.browser}`,
    `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Expected result: **${report.expected_result.toUpperCase()}** (${report.expectation_met ? "met" : "not met"})`,
    `- Beat keyframes: ${report.beats.length}`,
    `- Captured action frames: ${report.action_frames.length}`,
    "",
    "| Beat | Cursor | Scale | Min card | Min text | Min diagram edge | New nodes | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const frame of report.beats) {
    lines.push(`| ${localBeatId(frame.observation.beat_id)} | ${frame.observation.cursor} | ${frame.observation.world_scale} | ${frame.observation.min_focal_node_width ?? "—"} | ${frame.observation.min_focal_body_font_px ?? "—"} | ${frame.observation.min_focal_diagram_edge_px ?? "—"} | ${frame.observation.new_nodes} | ${frame.gate.passed ? "PASS" : frame.gate.issues.map((issue) => issue.code).join(", ")} |`);
  }
  if (report.console_messages.length) {
    lines.push("", "## Browser console", "");
    for (const message of report.console_messages) lines.push(`- ${message.type}: ${message.text}`);
  }
  const failed = [...report.beats, ...report.action_frames].filter((frame) => !frame.gate.passed);
  if (failed.length) {
    lines.push("", "## Gate failures", "");
    for (const frame of failed) {
      lines.push(`### Cursor ${frame.observation.cursor}: ${frame.observation.operation_type}${frame.observation.action_op ? ` / ${frame.observation.action_op}` : ""}`, "");
      for (const issue of frame.gate.issues) lines.push(`- ${issue.code}: ${issue.message}${issue.targets?.length ? ` (${issue.targets.join(", ")})` : ""}`);
      if (frame.screenshot) lines.push(`- Screenshot: \`${frame.screenshot}\``);
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const root = process.cwd();
const lesson = argument("lesson", "geometry");
const output = resolve(root, argument("output", "evals/teaching-playback/latest/report.json"));
const width = Number(argument("width", "1280"));
const height = Number(argument("height", "720"));
const expectedResult = argument("expect", "pass");
const screenshotMode = argument("screenshots", "failures");
if (!["pass", "fail"].includes(expectedResult)) throw new Error("--expect must be 'pass' or 'fail'");
if (!["failures", "none"].includes(screenshotMode)) throw new Error("--screenshots must be 'failures' or 'none'");
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-playback-harness.mjs"], {
  cwd: root,
  env: { ...process.env, OLL_HARNESS_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;

try {
  await waitForServer(origin, server);
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const consoleMessages = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => consoleMessages.push({ type: "pageerror", text: error.message }));
  await page.goto(`${origin}/?lesson=${encodeURIComponent(lesson)}`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await page.waitForFunction(() => globalThis.__OLL_HARNESS__?.ready === true);
  await page.evaluate(() => globalThis.__OLL_HARNESS__.reset());

  const beats = [];
  const actionFrames = [];
  let previousBeatCounts = { nodes: 0, connections: 0, groups: 0 };
  const screenshotDirectory = resolve(dirname(output), "screenshots");
  await rm(screenshotDirectory, { recursive: true, force: true });
  const capturedScreenshots = new Set();
  let lessonId = "unknown";

  while (true) {
    const operation = await page.evaluate(() => globalThis.__OLL_HARNESS__.advance());
    if (!operation) break;
    if (operation.type !== "action.apply" && operation.type !== "beat.end") continue;
    await page.waitForFunction(() => [...document.querySelectorAll("img.lesson-image")].every((image) => image.complete), undefined, { timeout: 3000 });
    const observation = await page.evaluate(() => globalThis.__OLL_HARNESS__.observe());
    lessonId = observation.lesson_id;
    if (operation.type === "beat.end") {
      observation.new_nodes = observation.node_count - previousBeatCounts.nodes;
      observation.new_connections = observation.connection_count - previousBeatCounts.connections;
      observation.new_groups = observation.group_count - previousBeatCounts.groups;
      previousBeatCounts = { nodes: observation.node_count, connections: observation.connection_count, groups: observation.group_count };
    }
    const gate = await page.evaluate((frame) => globalThis.__OLL_HARNESS__.evaluate(frame), observation);
    const record = { observation, gate };
    if (!gate.passed && screenshotMode === "failures" && !capturedScreenshots.has(observation.cursor)) {
      await mkdir(screenshotDirectory, { recursive: true });
      const screenshotName = `cursor-${String(observation.cursor).padStart(3, "0")}.png`;
      await page.screenshot({ path: resolve(screenshotDirectory, screenshotName) });
      record.screenshot = `screenshots/${screenshotName}`;
      capturedScreenshots.add(observation.cursor);
    }
    if (operation.type === "beat.end") beats.push(record); else actionFrames.push(record);
  }

  const browserVersion = await browser.version();
  const passed = beats.every((frame) => frame.gate.passed)
    && actionFrames.every((frame) => frame.gate.passed)
    && consoleMessages.length === 0;
  const expectationMet = expectedResult === (passed ? "pass" : "fail");
  const report = {
    profile: "octos.teaching-playback.report", version: "0.1", generated_at: new Date().toISOString(),
    lesson_id: lessonId, fixture: lesson, viewport: { width, height }, browser: browserVersion,
    passed, expected_result: expectedResult, expectation_met: expectationMet,
    console_messages: consoleMessages, beats, action_frames: actionFrames,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(dirname(output), "REPORT.md"), markdown(report));
  console.log(`${passed ? "PASS" : "FAIL"} ${lessonId}: ${beats.length} beats, ${actionFrames.length} action frames; expectation ${expectationMet ? "met" : "NOT MET"}`);
  console.log(relative(root, output));
  if (!expectationMet) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
