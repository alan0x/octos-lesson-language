/**
 * Draws a `place_value_trade` card (decision 0026) from its plan (place-value-trade.ts): the problem as the
 * program writes it ("3,486 + 2,739"), the one-line instruction that follows the chart (only while the learner
 * can tap it), then the chart as SVG, the written column method in disks: a head per column, the carry spots
 * (adding), row 1 and row 2 with the two numbers written at the left edge, the sum line with a ↓ under each
 * column, and the answer row; and under it a notice. Values come from the content with bindings applied. The
 * card never writes the answer's digits.
 *
 * The frame (columns, rows, labels) is drawn once; each update redraws the disks from the state. A change the
 * rules made (a learner's tap, or the demonstration's next columns) is animated one action at a time: a column
 * coming down, ten disks gathering into one of the next place, disks taken onto their rings, one disk breaking
 * into ten. A demonstration's action, which the player sets one at a time, is drawn at the demonstration's slower
 * pace (`demonstrationMs`; owner, 2026-11-27); a learner's tap keeps its quick one. With reduced motion the chart
 * changes at once.
 *
 * Every element a learner can tap carries `data-oll-tap`, the tap and its place's index (the place plus three,
 * as on the chart: "down:3" is ↓ under the ones, "trade:4" the tens' ringed ten, "break:5" a hundred); the board
 * turns a tap into the card's tap rules. When the card is not live the same chart is drawn without ↓ buttons
 * or tap cues. A refused tap's sentence is said at its column, inside its empty answer cell, when it can be;
 * a short column's take-away marks the disks that can break for it while it stays short.
 */
import { PLACE_VALUE_PLACE_ALIASES, placeValueColumnName, placeValueDiskLabel, placeValueTapIndex, placeValueTapPlace, type PlaceValueLanguage } from "./place-value-chart.js";
import {
  PLACE_VALUE_TRADE_WORDS, applyPlaceValueTradeTap, placeValueTradeBreakSource, placeValueTradeDemoAt, placeValueTradeDemoSteps, placeValueTradeDiskAt, placeValueTradeDrawnCell,
  placeValueTradeDiskFont, placeValueTradeInstruction, placeValueTradeLanguage, placeValueTradeProblemText, placeValueTradeRefusalPlace,
  placeValueTradeStart, placeValueTradeState, placeValueTradeStateKey, placeValueTradeUnitWord, planPlaceValueTrade,
  type PlaceValueTradeAnim, type PlaceValueTradePlan, type PlaceValueTradeRow, type PlaceValueTradeState, type PlaceValueTradeTapKind,
} from "./place-value-trade.js";

const SVG_NS = "http://www.w3.org/2000/svg";
/** The card draws its cells' counts clamped (statuses no taps make never draw a negative count). */
const placeValueTradeCell = placeValueTradeDrawnCell;
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export interface PlaceValueTradeViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** True while an open task lets the learner tap this card. */
  live?: boolean;
  /** A refused tap's sentence, in the card's words. */
  notice?: string;
  /** The refused tap the notice answers (its place is the index, the place plus three), so it is said at its column. */
  refused?: { kind: string; place: number };
  /** Draw changes at once (also when the page asks for reduced motion). */
  reducedMotion?: boolean;
  /**
   * How long one step of the lesson's demonstration animates (`DEMONSTRATION_STEP_MS` at the playback speed; owner,
   * 2026-11-27). The player moves "columns finished" one action at a time; that one action is drawn this slowly.
   * A learner's tap keeps its quick pace, and a jump of several actions (a seek, a restore) plays at the tap pace.
   */
  demonstrationMs?: number;
}

interface TradeView {
  plan: PlaceValueTradePlan;
  frame: string;
  language: PlaceValueLanguage;
  root: HTMLElement;
  svg: SVGSVGElement;
  given: HTMLDivElement;
  howto: HTMLParagraphElement;
  notice: HTMLDivElement;
  groups: Map<number, SVGGElement>;
  layers: Map<number, SVGGElement>;
  hits: Map<number, Partial<Record<PlaceValueTradeRow, SVGRectElement>>>;
  buttons: Map<number, SVGGElement>;
  overlay: SVGGElement;
  /** The state drawn now, and the problem it belongs to. */
  shown?: PlaceValueTradeState;
  /** The state the latest update asked for. */
  target?: PlaceValueTradeState;
  context: PlaceValueTradeViewContext;
  /** A short column whose take-away was refused: its break source is marked while it stays short. */
  short?: number;
  /** A refused tap's sentence and its column. */
  note?: { place: number; text: string; short: boolean };
  refusedKey?: string;
  /** What the context drew last (live, the note, the short column). */
  drawnContext?: string;
  timer?: ReturnType<typeof setTimeout>;
  /** Actions still to draw; `scale` stretches one's animation (a demonstration step). */
  queue: Array<{ state: PlaceValueTradeState; anim?: PlaceValueTradeAnim; scale?: number }>;
}

const views = new WeakMap<HTMLElement, TradeView>();

const COLORS = {
  background: "#eef1f8", column: "#ffffff", ink: "#1d2433", muted: "#5b6478", line: "#d5dae6", accent: "#2f5bd3", slot: "#c9d0df", diskInk: "#ffffff", card: "#ffffff",
} as const;

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (classes.length) node.classList.add(...classes);
  return node;
}

const round = (value: number) => Math.round(value * 100) / 100;

function frameOf(raw: Record<string, unknown>, plan: PlaceValueTradePlan): string {
  return JSON.stringify([placeValueTradeLanguage(raw), raw.operation === "subtract" ? "subtract" : "add", plan.width, plan.height, plan.columns.map((column) => column.place), plan.labels.map((label) => label.text)]);
}

function setTappable(target: SVGElement, tap: string | undefined, label: string, live: boolean): void {
  const on = live && tap !== undefined;
  if (on) target.dataset.ollTap = tap; else delete target.dataset.ollTap;
  target.classList.toggle("place-value-trade-live", on);
  if (on) {
    target.setAttribute("tabindex", "0");
    target.setAttribute("role", "button");
    target.setAttribute("aria-label", label);
    target.setAttribute("cursor", "pointer");
  } else {
    for (const attribute of ["tabindex", "role", "aria-label", "cursor"]) target.removeAttribute(attribute);
  }
}

/** One disk, centred at a point: a circle of its place's fill, its place's value written on it. */
function diskElement(plan: PlaceValueTradePlan, place: number, at: { x: number; y: number }): SVGGElement {
  const column = plan.columns.find((candidate) => candidate.place === place)!;
  const group = element("g", {}, "place-value-trade-disk");
  group.dataset.place = String(place);
  group.append(element("circle", { cx: round(at.x), cy: round(at.y), r: plan.disk / 2, fill: column.fill }, "place-value-trade-disk-face"));
  const label = element("text", {
    x: round(at.x), y: round(at.y), "text-anchor": "middle", "dominant-baseline": "central", "font-size": round(placeValueTradeDiskFont(column.diskLabel, plan.disk)),
    "font-weight": 700, fill: COLORS.diskInk, "pointer-events": "none",
  }, "place-value-trade-disk-label");
  label.textContent = column.diskLabel;
  group.append(label);
  return group;
}

/** The frame: background, heads, strips, row labels, the sum line, the point, the cells' tap areas and the ↓ buttons. */
function create(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueTradeViewContext): TradeView {
  const plan = planPlaceValueTrade(raw);
  const language = placeValueTradeLanguage(raw);
  const words = PLACE_VALUE_TRADE_WORDS[language];
  const given = document.createElement("div");
  given.className = "place-value-trade-given";
  const howto = document.createElement("p");
  howto.className = "place-value-trade-howto";
  const svg = element("svg", { viewBox: `0 0 ${round(plan.width)} ${round(plan.height)}`, role: "group", "aria-label": words.chartLabel, "font-family": "ui-sans-serif, system-ui, sans-serif" }, "place-value-trade");
  svg.append(element("rect", { x: 0, y: 0, width: round(plan.width), height: round(plan.height), rx: 14, fill: COLORS.background }, "place-value-trade-background"));
  const groups = new Map<number, SVGGElement>();
  const layers = new Map<number, SVGGElement>();
  const hits = new Map<number, Partial<Record<PlaceValueTradeRow, SVGRectElement>>>();
  const buttons = new Map<number, SVGGElement>();
  for (const column of plan.columns) {
    const group = element("g", {}, "place-value-trade-place");
    group.dataset.place = String(column.place);
    group.append(element("rect", { x: column.strip.x, y: column.strip.y, width: column.strip.width, height: column.strip.height, rx: 10, fill: COLORS.column }, "place-value-trade-strip"));
    const head = element("text", { x: round(column.x + column.width / 2), y: round(column.strip.y - 6), "text-anchor": "middle", "font-size": 14, "font-weight": 600, fill: COLORS.ink }, "place-value-trade-head");
    column.head.forEach((line, k) => {
      const span = element("tspan", { x: round(column.x + column.width / 2), dy: k === 0 ? -(column.head.length - 1) * 16 : 16 });
      span.textContent = line;
      head.append(span);
    });
    group.append(head);
    const cells: Partial<Record<PlaceValueTradeRow, SVGRectElement>> = {};
    for (const [row, box] of Object.entries(column.cells) as Array<[PlaceValueTradeRow, NonNullable<PlaceValueTradeColumnCells[PlaceValueTradeRow]>]>) {
      const rect = element("rect", { x: box.x, y: box.y, width: box.width, height: box.height, rx: 9, fill: "transparent" }, "place-value-trade-cell", `place-value-trade-cell-${row}`);
      rect.dataset.place = String(column.place);
      rect.dataset.row = row;
      cells[row] = rect;
      group.append(rect);
    }
    const layer = element("g", {}, "place-value-trade-disks");
    group.append(layer);
    const button = element("g", {}, "place-value-trade-down");
    button.dataset.place = String(column.place);
    button.append(element("circle", { cx: round(column.down.x), cy: round(column.down.y), r: column.down.r, fill: COLORS.accent }));
    const arrow = element("text", { x: round(column.down.x), y: round(column.down.y + 1), "text-anchor": "middle", "dominant-baseline": "central", "font-size": 22, "font-weight": 700, fill: "#ffffff", "pointer-events": "none" });
    arrow.textContent = "↓";
    button.append(arrow);
    svg.append(group);
    groups.set(column.place, group);
    layers.set(column.place, layer);
    hits.set(column.place, cells);
    buttons.set(column.place, button);
  }
  for (const label of plan.labels) {
    const text = element("text", { x: round(label.x), y: round(label.y), "text-anchor": "end", "dominant-baseline": "central", "font-size": label.size, "font-weight": 600, fill: COLORS.ink, "font-variant-numeric": "tabular-nums" }, "place-value-trade-label");
    if (label.op) {
      const op = element("tspan", { fill: COLORS.muted });
      op.textContent = `${label.op} `;
      text.append(op);
    }
    const number = element("tspan", {});
    number.textContent = label.text;
    text.append(number);
    svg.append(text);
  }
  svg.append(element("line", { x1: plan.rule.x1, y1: round(plan.rule.y), x2: plan.rule.x2, y2: round(plan.rule.y), stroke: COLORS.ink, "stroke-width": 3 }, "place-value-trade-rule"));
  for (const button of buttons.values()) svg.append(button);
  for (const point of plan.points) svg.append(element("circle", { cx: round(point.x), cy: round(point.y), r: 4, fill: COLORS.ink, "aria-label": words.point }, "place-value-trade-point"));
  const overlay = element("g", { "pointer-events": "none" }, "place-value-trade-overlay");
  svg.append(overlay);
  const notice = document.createElement("div");
  notice.className = "place-value-trade-notice";
  notice.setAttribute("aria-live", "polite");
  parent.append(given, howto, svg, notice);
  return { plan, frame: frameOf(raw, plan), language, root: parent, svg, given, howto, notice, groups, layers, hits, buttons, overlay, context, queue: [] };
}
type PlaceValueTradeColumnCells = PlaceValueTradePlan["columns"][number]["cells"];

/** A disk's centre in a state's drawing: its row, its index, and whether that cell shows a ringed ten. */
function diskPosition(view: TradeView, state: PlaceValueTradeState, place: number, row: PlaceValueTradeRow, index: number): { x: number; y: number } {
  const c = placeValueTradeCell(state, place);
  const ring = row === "answer" ? c.answerRing : row === "top" ? c.topRing : false;
  return placeValueTradeDiskAt(view.plan, place, row, index, ring, c[row === "answer" ? "answer" : row]);
}

/** Draws one state: every column's disks, rings, ringed tens, the landing spots, live taps, marks and notes. */
function draw(view: TradeView, state: PlaceValueTradeState): void {
  const { plan, context } = view;
  const live = context.live === true && view.queue.length === 0;
  const words = PLACE_VALUE_TRADE_WORDS[view.language];
  const add = state.problem.op === "+";
  const columns = state.problem.columns;
  const source = view.short === undefined ? undefined : placeValueTradeBreakSource(state, view.short);
  if (source === undefined && view.short !== undefined) {
    view.short = undefined;
    if (view.note?.short) view.note = undefined;
  }
  view.overlay.replaceChildren();
  const u = (place: number) => placeValueTradeUnitWord(place, view.language);
  for (const column of plan.columns) {
    const place = column.place;
    const v = placeValueTradeCell(state, place);
    const layer = view.layers.get(place)!;
    layer.replaceChildren();
    const name = placeValueColumnName(place, view.language);
    const index = placeValueTapIndex(place);
    const disks = (row: PlaceValueTradeRow, n: number, tap?: PlaceValueTradeTapKind) => {
      for (let i = 0; i < n; i += 1) {
        const disk = diskElement(plan, place, diskPosition(view, state, place, row, i));
        disk.dataset.row = row;
        disk.dataset.index = String(i);
        // A disk answers a tap as its cell does: ↓ above the line (adding), a trade below it, a break (subtracting).
        if (tap) setTappable(disk, `${tap}:${index}`, tap === "break" ? words.diskBreak(u(place)) : tap === "trade" ? words.tenAdd(u(place), u(place + 1)) : words.downAdd(name), live);
        if (source === place && row === (v.down ? "answer" : "top")) disk.classList.add("place-value-trade-can-break");
        layer.append(disk);
      }
    };
    const ten = (row: "top" | "answer", ready: boolean) => {
      const first = diskPosition(view, state, place, row, 0), last = diskPosition(view, state, place, row, 9);
      const D = plan.disk;
      const ring = element("g", {}, "place-value-trade-ten", ready ? "place-value-trade-ten-ready" : "place-value-trade-ten-got");
      ring.dataset.row = row;
      ring.append(element("rect", {
        x: round(first.x - D / 2 - 5), y: round(first.y - D / 2 - 5), width: round(last.x - first.x + D + 10), height: round(last.y - first.y + D + 10), rx: round(D / 2 + 5),
        fill: column.fill, "fill-opacity": ready ? 0.14 : 0, stroke: column.fill, "stroke-width": ready ? 3 : 2, "stroke-opacity": ready ? 1 : 0.7,
      }, "place-value-trade-ten-ring"));
      // The badge says what the ten is worth: "← one of the next place" (adding) or "one of the place on the left →".
      const mini = Math.max(22, D * 0.85);
      const bx = (first.x + last.x) / 2, by = first.y - D / 2 - 5 - mini / 2 - 2;
      const badge = element("g", {}, "place-value-trade-badge");
      badge.setAttribute("aria-hidden", "true");
      const width = mini + 30;
      badge.append(element("rect", { x: round(bx - width / 2), y: round(by - mini / 2 - 3), width: round(width), height: round(mini + 6), rx: round(mini / 2 + 3), fill: COLORS.card, stroke: column.fill, "stroke-width": 2 }));
      const arrow = element("text", { x: round(ready ? bx - width / 2 + 11 : bx + width / 2 - 11), y: round(by + 1), "text-anchor": "middle", "dominant-baseline": "central", "font-size": 17, "font-weight": 700, fill: COLORS.ink });
      arrow.textContent = ready ? "←" : "→";
      const cx = ready ? bx + 9 : bx - 9;
      const next = place + 1;
      badge.append(arrow, element("circle", { cx: round(cx), cy: round(by), r: round(mini / 2), fill: plan.columns.find((c) => c.place === next)?.fill ?? column.fill }));
      const label = element("text", { x: round(cx), y: round(by), "text-anchor": "middle", "dominant-baseline": "central", "font-size": round(Math.max(8, mini * 0.36)), "font-weight": 700, fill: COLORS.diskInk });
      label.textContent = placeValueDiskLabel(next, view.language);
      badge.append(label);
      ring.append(badge);
      return ring;
    };
    if (add) {
      disks("carry", v.carry, "down");
      disks("top", v.top, "down");
      disks("second", v.second, "down");
      if (v.answerRing) {
        const ring = ten("answer", true);
        setTappable(ring, `trade:${index}`, words.tenAdd(u(place), u(place + 1)), live);
        layer.append(ring);
      }
      disks("answer", v.answer, "trade");
      // While the column on the right has a ten ready, a dashed spot shows where its one will land.
      if (columns.includes(place - 1) && placeValueTradeCell(state, place - 1).answerRing) {
        const at = v.down ? diskPosition(view, state, place, "answer", v.answer) : placeValueTradeDiskAt(plan, place, "carry", 0);
        layer.append(element("circle", { cx: round(at.x), cy: round(at.y), r: round(plan.disk / 2 - 1), fill: column.fill, "fill-opacity": 0.12, stroke: column.fill, "stroke-width": 2.5, "stroke-dasharray": "5 4" }, "place-value-trade-landing"));
      }
    } else {
      if (v.topRing) layer.append(ten("top", false));
      disks("top", v.top, "break");
      for (let i = 0; i < v.second; i += 1) {
        const at = placeValueTradeDiskAt(plan, place, "second", i, false, v.second);
        layer.append(element("circle", { cx: round(at.x), cy: round(at.y), r: round(plan.disk / 2 - 1.5), fill: "none", stroke: column.fill, "stroke-width": 2.5, "stroke-dasharray": v.down ? "none" : "5 4", "stroke-opacity": v.down ? 0.3 : 1 }, "place-value-trade-ring"));
      }
      if (v.answerRing) layer.append(ten("answer", false));
      disks("answer", v.answer, "break");
    }
    // The cells answer taps too: adding, the rows of a column still above the line bring it down and its answer
    // trades; subtracting, row 2 takes away, the disks above or below the line break, and an answer cell nothing
    // has come down to yet says so (the rules refuse a `trade` there: nothing below the line yet).
    const hits = view.hits.get(place)!;
    const cellTap: Partial<Record<PlaceValueTradeRow, string>> = add
      ? { carry: `down:${index}`, top: `down:${index}`, second: `down:${index}`, answer: `trade:${index}` }
      : { top: `break:${index}`, second: `down:${index}`, answer: v.down ? `break:${index}` : `trade:${index}` };
    for (const [row, rect] of Object.entries(hits) as Array<[PlaceValueTradeRow, SVGRectElement]>) {
      setTappable(rect, cellTap[row], row === "second" || row === "carry" || (add && row === "top") ? (add ? words.downAdd(name) : words.downSub(name)) : add ? words.tenAdd(u(place), u(place + 1)) : words.diskBreak(u(place)), live);
      rect.classList.toggle("place-value-trade-cell-empty", row === "answer" && !v.down);
      rect.classList.toggle("place-value-trade-short", row === "second" && view.short === place);
    }
    const button = view.buttons.get(place)!;
    const shown = live && !v.down;
    button.setAttribute("visibility", shown ? "visible" : "hidden");
    setTappable(button, shown ? `down:${index}` : undefined, add ? words.downAdd(name) : words.downSub(name), live);
  }
  drawArrows(view, state);
  drawNote(view, state);
  view.howto.textContent = context.live === true ? placeValueTradeInstruction(state, view.language, view.short) : "";
  view.shown = state;
  view.drawnContext = JSON.stringify([context.live === true, view.note ?? null, view.short ?? null]);
}

/** While a ten is ready to trade, a faint dashed arrow runs from its badge to where the one will land. */
function drawArrows(view: TradeView, state: PlaceValueTradeState): void {
  if (state.problem.op !== "+") return;
  for (const place of state.problem.columns) {
    if (!placeValueTradeCell(state, place).answerRing || !state.problem.columns.includes(place + 1)) continue;
    const plan = view.plan, D = plan.disk;
    const first = placeValueTradeDiskAt(plan, place, "answer", 0, true), last = placeValueTradeDiskAt(plan, place, "answer", 9, true);
    const mini = Math.max(22, D * 0.85);
    const x0 = (first.x + last.x) / 2 - (mini + 30) / 2, y0 = first.y - D / 2 - 5 - mini / 2 - 2;
    const next = placeValueTradeCell(state, place + 1);
    const to = next.down ? diskPosition(view, state, place + 1, "answer", next.answer) : placeValueTradeDiskAt(plan, place + 1, "carry", 0);
    const x1 = to.x + D / 2 + 4, y1 = to.y;
    const bx = Math.min(x0 - 14, (x0 + x1) / 2 + 30);
    const fill = plan.columns.find((column) => column.place === place + 1)!.fill;
    view.overlay.append(
      element("path", { d: y1 < y0 - 20 ? `M${round(x0)} ${round(y0)} H${round(bx)} V${round(y1)} H${round(x1)}` : `M${round(x0)} ${round(y0)} Q${round((x0 + x1) / 2)} ${round(Math.min(y0, y1) - 30)} ${round(x1)} ${round(y1)}`, fill: "none", stroke: fill, "stroke-width": 2.5, "stroke-dasharray": "6 5", opacity: 0.75 }, "place-value-trade-arrow"),
      element("polygon", { points: `${round(x1 - 2)},${round(y1)} ${round(x1 + 9)},${round(y1 - 6)} ${round(x1 + 9)},${round(y1 + 6)}`, fill, opacity: 0.75 }, "place-value-trade-arrow-head"),
    );
  }
}

/** A refused tap's fact is said at its column, inside its empty answer cell; when that cell holds disks, under the chart. */
function drawNote(view: TradeView, state: PlaceValueTradeState): void {
  const note = view.note;
  const box = note ? view.plan.columns.find((column) => column.place === note.place)?.cells.answer : undefined;
  if (note && box && !placeValueTradeCell(state, note.place).down) {
    const object = element("foreignObject", { x: round(box.x + 2), y: round(box.y + 2), width: round(box.width - 4), height: round(box.height - 4) }, "place-value-trade-note");
    const text = document.createElementNS(XHTML_NS, "p") as HTMLParagraphElement;
    text.className = "place-value-trade-colnote";
    // Narrower columns (five or six) say it smaller, so it fits the cell.
    text.style.fontSize = `${view.plan.disk <= 24 ? 11 : view.plan.disk <= 28 ? 12.5 : 13.5}px`;
    text.textContent = note.text;
    object.append(text);
    view.overlay.append(object);
    view.notice.textContent = "";
  } else {
    view.notice.textContent = note?.text ?? "";
  }
}

// ---------------------------------------------------------------- animation

const reduced = (view: TradeView): boolean => view.context.reducedMotion === true
  || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

const canAnimate = (node: Element): boolean => typeof (node as Element & { animate?: unknown }).animate === "function";

function fly(node: Element, from: { x: number; y: number }, to: { x: number; y: number }, delay: number, duration: number): void {
  if (!canAnimate(node) || (from.x === to.x && from.y === to.y)) return;
  node.animate([{ transform: `translate(${round(from.x - to.x)}px, ${round(from.y - to.y)}px)` }, { transform: "none" }], { duration, delay, easing: "cubic-bezier(.3,.7,.3,1)", fill: "backwards" });
}

/** A disk drawn only for the animation (it leaves the chart), removed when its animation ends. */
function ghost(view: TradeView, place: number, at: { x: number; y: number }, to: { x: number; y: number }, delay: number, duration: number, shrink: number): void {
  const disk = diskElement(view.plan, place, at);
  disk.classList.add("place-value-trade-ghost");
  view.overlay.append(disk);
  if (!canAnimate(disk)) { disk.remove(); return; }
  const move = `translate(${round(to.x - at.x)}px, ${round(to.y - at.y)}px)`;
  const animation = disk.animate([{ transform: "none", opacity: 1 }, { transform: move, opacity: 1, offset: 0.7 }, { transform: `${move} scale(${shrink})`, opacity: 0 }], { duration, delay, easing: "ease-in", fill: "forwards" });
  animation.onfinish = () => disk.remove();
}

const diskNode = (view: TradeView, place: number, row: PlaceValueTradeRow, index: number): SVGGElement | undefined =>
  view.layers.get(place)?.querySelector<SVGGElement>(`.place-value-trade-disk[data-row="${row}"][data-index="${index}"]`) ?? undefined;

/** The milliseconds an action's animation takes before the next may start. */
const ACTION_MS: Record<PlaceValueTradeAnim["kind"], number> = { down: 700, trade: 1300, take: 1000, break: 850 };

/**
 * Animates one action from the state drawn before it (`before`) to the one drawn now. `scale` stretches every
 * duration and delay: 1 at a tap's pace, more for a demonstration step.
 */
function animate(view: TradeView, before: PlaceValueTradeState, after: PlaceValueTradeState, anim: PlaceValueTradeAnim, scale = 1): void {
  const t = (ms: number) => ms * scale;
  const cellBefore = (place: number) => placeValueTradeCell(before, place);
  const cellAfter = (place: number) => placeValueTradeCell(after, place);
  if (anim.kind === "down") {
    const v = cellBefore(anim.place);
    const sources = [
      ...Array.from({ length: v.top }, (_, i) => diskPosition(view, before, anim.place, "top", i)),
      ...Array.from({ length: v.second }, (_, i) => diskPosition(view, before, anim.place, "second", i)),
      ...Array.from({ length: v.carry }, (_, i) => diskPosition(view, before, anim.place, "carry", i)),
    ];
    for (let i = 0; i < cellAfter(anim.place).answer; i += 1) {
      const node = diskNode(view, anim.place, "answer", i);
      if (node && sources[i]) fly(node, sources[i]!, diskPosition(view, after, anim.place, "answer", i), t(i * 22), t(520));
    }
  } else if (anim.kind === "trade") {
    const ten = Array.from({ length: 10 }, (_, i) => diskPosition(view, before, anim.from, "answer", i));
    const mid = { x: ten.reduce((sum, p) => sum + p.x, 0) / 10, y: ten.reduce((sum, p) => sum + p.y, 0) / 10 };
    ten.forEach((at, i) => ghost(view, anim.from, at, mid, t(i * 15), t(620), 0.3));
    // The rest of the column close up under where the ring was.
    for (let i = 0; i < cellAfter(anim.from).answer; i += 1) {
      const node = diskNode(view, anim.from, "answer", i);
      if (node) fly(node, diskPosition(view, before, anim.from, "answer", i + 10), diskPosition(view, after, anim.from, "answer", i), t(300), t(420));
    }
    const target = anim.landed === "carry" ? diskNode(view, anim.to, "carry", 0) : diskNode(view, anim.to, "answer", cellAfter(anim.to).answer - 1);
    if (target && canAnimate(target)) {
      const to = anim.landed === "carry" ? diskPosition(view, after, anim.to, "carry", 0) : diskPosition(view, after, anim.to, "answer", cellAfter(anim.to).answer - 1);
      const move = `translate(${round(mid.x - to.x)}px, ${round(mid.y - to.y)}px)`;
      target.animate([{ transform: `${move} scale(.3)`, opacity: 0 }, { transform: `${move} scale(1.3)`, opacity: 1, offset: 0.35 }, { transform: "none" }], { duration: t(900), delay: t(560), easing: "ease-in-out", fill: "backwards" });
    }
  } else if (anim.kind === "take") {
    const v = cellBefore(anim.place);
    const stay = v.top - anim.n;
    for (let i = 0; i < anim.n; i += 1) {
      const at = diskPosition(view, before, anim.place, "top", stay + i);
      ghost(view, anim.place, at, placeValueTradeDiskAt(view.plan, anim.place, "second", i, false, cellBefore(anim.place).second), t(i * 30), t(820), 0.5);
    }
    for (let i = 0; i < cellAfter(anim.place).answer; i += 1) {
      const node = diskNode(view, anim.place, "answer", i);
      if (node && i < stay) fly(node, diskPosition(view, before, anim.place, "top", i), diskPosition(view, after, anim.place, "answer", i), t(300 + i * 22), t(520));
    }
  } else {
    const fromRow: PlaceValueTradeRow = cellBefore(anim.from).down ? "answer" : "top";
    const from = diskPosition(view, before, anim.from, fromRow, (fromRow === "answer" ? cellBefore(anim.from).answer : cellBefore(anim.from).top) - 1);
    const toRow: PlaceValueTradeRow = anim.landed;
    const had = toRow === "answer" ? cellBefore(anim.to).answer : cellBefore(anim.to).top;
    const now = toRow === "answer" ? cellAfter(anim.to).answer : cellAfter(anim.to).top;
    const ringed = toRow === "answer" ? cellAfter(anim.to).answerRing : cellAfter(anim.to).topRing;
    for (let i = 0; i < now; i += 1) {
      const node = diskNode(view, anim.to, toRow, i);
      if (!node) continue;
      const at = diskPosition(view, after, anim.to, toRow, i);
      // The ten new disks (drawn first, ringed) come from the broken disk; the ones already there close up behind them.
      if (ringed ? i < 10 : i >= had) fly(node, from, at, t(i * 35), t(600));
      else fly(node, diskPosition(view, before, anim.to, toRow, ringed ? i - 10 : i), at, 0, t(400));
    }
  }
}

/** Plays the queued actions one after another, each drawn then animated. */
function play(view: TradeView): void {
  if (view.timer !== undefined) return;
  const next = view.queue.shift();
  if (!next) return;
  const before = view.shown;
  draw(view, next.state);
  if (before && next.anim && !reduced(view)) {
    try { animate(view, before, next.state, next.anim, next.scale); } catch { /* drawing goes on without the animation */ }
  }
  if (!view.queue.length) return;
  view.timer = setTimeout(() => {
    view.timer = undefined;
    if (!view.svg.isConnected) { view.queue = []; return; }
    play(view);
  }, next.anim ? ACTION_MS[next.anim.kind] * (next.scale ?? 1) : 0);
}

const sameProblem = (x: PlaceValueTradeState | undefined, y: PlaceValueTradeState): boolean =>
  !!x && x.problem.op === y.problem.op && x.problem.a === y.problem.a && x.problem.b === y.problem.b && x.problem.columns.join() === y.problem.columns.join();

/**
 * The actions from the state drawn to a new one, when the rules make it in a few known actions: the learner's
 * one tap (one column's status changed), or the demonstration's next actions (columns finished went up; the
 * player moves it one action at a time, `placeValueTradeDemoAt`), with `demo` set. Undefined when the change is
 * anything else (a practice start, a done pile): it is drawn at once.
 */
function actionsBetween(from: PlaceValueTradeState & { finished?: number }, to: PlaceValueTradeState & { finished?: number }): { demo: boolean; actions: Array<{ state: PlaceValueTradeState; anim: PlaceValueTradeAnim }> } | undefined {
  if (!sameProblem(from, to)) return undefined;
  const k0 = from.finished ?? 0, k1 = to.finished ?? 0;
  if (k1 > k0) {
    const at0 = placeValueTradeDemoAt(from.problem, k0), at1 = placeValueTradeDemoAt(from.problem, k1);
    const flat = placeValueTradeDemoSteps(from.problem).steps.flatMap((step) => step.actions.map((action, i) => ({ action, before: step.states[i]!, after: step.states[i + 1]! })));
    // Only from the demonstration's own chart where it stands: a fresh one, or one it left.
    const expected = at0.index === 0 ? placeValueTradeStart(from.problem) : flat[at0.index - 1]!.after;
    if (placeValueTradeStateKey(from) !== placeValueTradeStateKey(expected)) return undefined;
    const actions = flat.slice(at0.index, at1.index).map(({ action, before, after }) => {
      const anim: PlaceValueTradeAnim = action.kind === "down" ? { kind: "down", place: action.place }
        : action.kind === "trade" ? { kind: "trade", from: action.place, to: action.place + 1, landed: placeValueTradeCell(before, action.place + 1).down ? "answer" : "carry" }
          : action.kind === "take" ? { kind: "take", place: action.place, n: before.problem.db[action.place]! }
            : { kind: "break", from: action.place, to: action.place - 1, landed: placeValueTradeCell(before, action.place - 1).down ? "answer" : "top" };
      return { state: after, anim };
    });
    return { demo: true, actions };
  }
  if (k1 < k0) return undefined;
  const changed = from.problem.columns.filter((place) => from.status[place] !== to.status[place]);
  if (changed.length !== 1) return undefined;
  for (const tap of ["down", "trade", "break"] as const) {
    for (const place of [changed[0]!, changed[0]! + 1]) {
      const result = applyPlaceValueTradeTap(from, { tap, place });
      if (result.ok && placeValueTradeStateKey(result.state) === placeValueTradeStateKey(to)) return { demo: false, actions: [{ state: to, anim: result.anim }] };
    }
  }
  return undefined;
}

function update(view: TradeView, raw: Record<string, unknown>, context: PlaceValueTradeViewContext): void {
  view.context = context;
  const state = placeValueTradeState(raw);
  view.svg.classList.toggle("place-value-trade-live", context.live === true);
  view.given.textContent = placeValueTradeProblemText(state.problem, view.language);
  const places = Array.isArray(raw.places) ? raw.places as Array<{ place?: unknown; id?: unknown }> : [];
  for (const [place, group] of view.groups) {
    // On the board a place's `as` has become its canonical `id`; emphasis addresses that.
    const placeId = String(places.find((item) => item?.place === place)?.id ?? PLACE_VALUE_PLACE_ALIASES[place]);
    group.dataset.id = placeId;
    context.applyEmphasis(group, placeId);
  }
  // A refused tap: said at its column; a short column's take-away marks its break source while it stays short.
  const refusedKey = context.refused && context.notice ? `${context.refused.kind}:${context.refused.place}:${context.notice}` : undefined;
  if (refusedKey !== view.refusedKey) {
    view.refusedKey = refusedKey;
    if (context.refused && context.notice) {
      const tap = { tap: context.refused.kind as PlaceValueTradeTapKind, place: placeValueTapPlace(context.refused.place) };
      const result = applyPlaceValueTradeTap(state, tap);
      const short = !result.ok && result.reason === "not_enough";
      if (short) view.short = tap.place;
      const at = placeValueTradeRefusalPlace(state, tap);
      view.note = at === undefined ? { place: Number.NaN, text: context.notice, short } : { place: at, text: context.notice, short };
    } else if (context.notice) {
      view.note = { place: Number.NaN, text: context.notice, short: false };
    } else if (!view.note?.short) {
      view.note = undefined;
    }
  }
  const target = state as PlaceValueTradeState & { finished?: number };
  const shown = view.target ?? view.shown;
  if (shown && placeValueTradeStateKey(shown) === placeValueTradeStateKey(target) && sameProblem(shown, target) && (shown as { finished?: number }).finished === target.finished) {
    // Nothing new to animate: redraw only when what the context draws changed (live, a note), and not while
    // actions are still playing, so a repeated render never cuts an animation short.
    const key = JSON.stringify([context.live === true, view.note ?? null, view.short ?? null]);
    if (!view.queue.length && view.timer === undefined && key !== view.drawnContext) draw(view, view.shown ?? state);
    return;
  }
  const between = shown ? actionsBetween(shown as PlaceValueTradeState & { finished?: number }, target) : undefined;
  view.target = target;
  if (!between || !between.actions.length || reduced(view)) {
    if (view.timer !== undefined) { clearTimeout(view.timer); view.timer = undefined; }
    view.queue = [];
    draw(view, state);
    return;
  }
  // One action of the demonstration is a step at its own pace; a learner's tap, or a jump of several, at the tap's.
  const only = between.actions.length === 1 ? between.actions[0]! : undefined;
  const scale = between.demo && only && context.demonstrationMs ? Math.max(1, context.demonstrationMs / ACTION_MS[only.anim.kind]) : undefined;
  view.queue.push(...between.actions.map((action) => (scale ? { ...action, scale } : action)));
  play(view);
}

/** Draws the card into an empty parent. */
export function renderPlaceValueTrade(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueTradeViewContext): void {
  const view = create(parent, raw, context);
  views.set(parent, view);
  update(view, raw, context);
}

/**
 * Updates a card drawn by `renderPlaceValueTrade` into the same parent. Returns false when the parent holds no
 * such card or its frame (language, operation, columns, the numbers' labels, the room its cells keep) changed;
 * the caller then redraws it.
 */
export function updatePlaceValueTrade(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueTradeViewContext): boolean {
  const view = views.get(parent);
  if (!view || !view.svg.isConnected || view.frame !== frameOf(raw, planPlaceValueTrade(raw))) {
    if (view?.timer !== undefined) clearTimeout(view.timer);
    return false;
  }
  update(view, raw, context);
  return true;
}
