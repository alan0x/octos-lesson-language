// Browser checks for learner ink cards: snapshot markup is reduced to drawing
// elements, strokes replay in order, and a missing snapshot fails visibly.
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

const temp = await mkdtemp(join(tmpdir(), 'oll-learner-ink-'));
const outfile = join(temp, 'probe.js');
await build({ stdin: { contents: `
import './packages/web-runtime/styles.css';
import { mountInfiniteBoard } from './packages/web-runtime/src/board-view.ts';
import { sanitizeInkSvg } from './packages/web-runtime/src/ink-snapshot.ts';
Object.assign(window, { mountInfiniteBoard, sanitizeInkSvg });
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', outfile,
loader: { '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty' } });
const bundle = await readFile(outfile);
const styles = existsSync(join(temp, 'probe.css')) ? await readFile(join(temp, 'probe.css')) : '';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/probe.js' ? 'text/javascript' : req.url === '/probe.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/probe.js' ? bundle : req.url === '/probe.css' ? styles
    : '<link rel="stylesheet" href="/probe.css"><div id="board" style="position:relative;width:1000px;height:700px"></div><script type="module" src="/probe.js"></script>');
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const executablePath = process.env.OLL_CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => { errors.push(`dialog: ${dialog.message()}`); void dialog.dismiss(); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.mountInfiniteBoard);
  const result = await page.evaluate(async () => {
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" onload="alert(1)">
      <script>alert(2)</script><style>path{fill:red}</style>
      <a href="javascript:alert(3)"><path d="M 1 1 L 9 9"/></a>
      <image href="https://example.com/x.png" width="10" height="10"/>
      <foreignObject><div>html</div></foreignObject>
      <g transform="translate(1 2)"><path d="M 10 10 L 90 10" stroke="#000" stroke-width="4" onclick="alert(4)" style="stroke:red"/></g>
      <path d="M 10 30 L 90 30" stroke="url(https://example.com/#p)"/>
    </svg>`;
    const clean = window.sanitizeInkSvg(hostile, document);
    check(clean, 'hostile but valid SVG still yields a drawing');
    const markup = clean.outerHTML;
    for (const forbidden of ['script', 'style', 'onload', 'onclick', 'href', 'image', 'foreignObject', 'javascript', 'example.com', '<a']) {
      check(!markup.includes(forbidden), `sanitized markup keeps '${forbidden}'`);
    }
    check(clean.querySelectorAll('path').length === 2, 'drawing strokes outside links survive');
    check(window.sanitizeInkSvg('<div>not svg</div>', document) === undefined, 'non-SVG markup is refused');

    const viewport = document.querySelector('#board');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M 5 5 L 95 5" stroke="#000" stroke-width="3"/><path d="M 5 25 L 95 25" stroke="#000" stroke-width="3"/><path d="M 5 45 L 95 45" stroke="#000" stroke-width="3"/></svg>';
    const assets = { 'ink-snap:a@v4': { src: '/a.svg', svg, intrinsic_width: 100, intrinsic_height: 50, regions: { 'sel-a': { x: 0, y: 0, width: 1, height: 0.5 } } } };
    const mounted = window.mountInfiniteBoard(viewport, (id) => assets[id]);
    const node = (id, snapshot) => ({ id, kind: 'ink', role: 'derivation', placement: { relation: 'new_region' },
      content: { snapshot_id: snapshot, sha256: 'a'.repeat(64), replay: 'stroke_order', alt: 'three lines', selections: [{ id: `${id}:fragment:top`, selection_id: 'sel-a', label: 'top' }] } });
    const board = { board_id: 'b', revision: 1, focus: [], groups: {}, connections: {}, applied_lessons: [], applied_steps: [], applied_actions: [],
      nodes: { ink: node('ink', 'ink-snap:a@v4'), missing: { ...node('missing', 'ink-snap:gone@v1'), placement: { relation: 'below', anchor: 'ink' } } } };
    mounted.view.render(board, { type: 'action.apply', operation_id: 'op', lesson_id: 'l', action: { action_id: 'a', op: 'board.create', node: board.nodes.ink } });
    const strokes = [...viewport.querySelectorAll('.board-node[data-id="ink"] .ink-replay path')];
    check(strokes.length === 3, 'a new ink card replays its strokes');
    const delays = strokes.map((stroke) => parseFloat(stroke.style.getPropertyValue('--ink-delay')));
    check(delays[0] === 0 && delays[1] > 0 && delays[2] > delays[1], 'strokes start in drawing order');
    check(getComputedStyle(strokes[0]).animationName === 'ink-stroke', 'replay animates the strokes');
    check(viewport.querySelector('.board-node[data-id="ink"] .image-region[data-id="ink:fragment:top"]'), 'selections are addressable overlays');
    check(viewport.querySelector('.board-node[data-id="missing"] .lesson-ink-missing'), 'a missing snapshot fails visibly');
    await new Promise((done) => setTimeout(done, 2500));
    const settled = getComputedStyle(strokes[2]).strokeDashoffset;
    check(settled === '0px' || settled === '0', `strokes end fully drawn (${settled})`);
    return 'ok';
  });
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(`learner ink browser checks: ${result}`);
} finally {
  await browser.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
