/**
 * Draws a `place_value_times_ten` card (decision 0028) from its plan (place-value-times-ten.ts): the problem as the
 * program writes it ("3 tenths = ? thousandths"), the one-line instruction that follows the chart (on its own line,
 * in one place), then the chart as SVG, and under it a notice. Values come from the content with bindings applied.
 * The card never writes the answer's digits.
 *
 * Every thing keeps its own row: a disk, the row of ten it breaks into (in the next column, same row), the square
 * of a hundred a row breaks into. A times pair draws the smaller number in row 2 as a ringed row of its disks, and
 * under the larger number ten copies of that shape (dashed, numbered 1-10) which fill as its disks are dealt.
 *
 * Every element a learner can tap carries `data-oll-tap`: `move:<row>` a thing, `copy:<row>` a copy, `smaller:0`
 * the smaller number (the place is an index into the card's tap places, `row-1` to `row-10`). A refused tap's
 * sentence is said at the copy it is about, else under the chart. A change the rules made (a tap, or the
 * demonstration moving "counted in") is animated one move at a time; with reduced motion the chart changes at once.
 */
import { placeValueNumeral, type PlaceValueLanguage } from "./place-value-chart.js";
import {
  PLACE_VALUE_TIMES_TEN_COPIES, PLACE_VALUE_TIMES_TEN_GEOMETRY as GEO, PLACE_VALUE_TIMES_TEN_WORDS, placeValueTimesTenColumn,
  placeValueTimesTenCopies, placeValueTimesTenDiskFont, placeValueTimesTenInstruction, placeValueTimesTenLanguage,
  placeValueTimesTenProblemText, placeValueTimesTenRowWidth, placeValueTimesTenSlotTop, placeValueTimesTenState,
  placeValueTimesTenStateKey, placeValueTimesTenStepSentence, planPlaceValueTimesTen,
  type PlaceValueTimesTenPlan, type PlaceValueTimesTenProblem, type PlaceValueTimesTenState,
} from "./place-value-times-ten.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export interface PlaceValueTimesTenViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** True while an open task lets the learner tap this card. */
  live?: boolean;
  /** A refused tap's sentence, in the card's words. */
  notice?: string;
  /** The refused tap the notice answers (its place is the row index), so a copy's fact is said at that copy. */
  refused?: { kind: string; place: number };
  /** Draw changes at once (also when the page asks for reduced motion). */
  reducedMotion?: boolean;
}

interface View {
  plan: PlaceValueTimesTenPlan;
  frame: string;
  language: PlaceValueLanguage;
  svg: SVGSVGElement;
  given: HTMLDivElement;
  howto: HTMLParagraphElement;
  notice: HTMLDivElement;
  layers: Map<number, SVGGElement>;
  second?: SVGGElement;
  overlay: SVGGElement;
  shown?: PlaceValueTimesTenState;
  target?: PlaceValueTimesTenState;
  context: PlaceValueTimesTenViewContext;
  note?: { row?: number; text: string };
  refusedKey?: string;
  drawnContext?: string;
  timer?: ReturnType<typeof setTimeout>;
  queue: Array<{ state: PlaceValueTimesTenState; moved?: number }>;
}

const views = new WeakMap<HTMLElement, View>();
const COLORS = { background: "#eef1f8", column: "#ffffff", ink: "#1d2433", muted: "#5b6478", slot: "#c9d0df", loop: "#6a3fc1", accent: "#2f5bd3", diskInk: "#ffffff" } as const;
const round = (value: number) => Math.round(value * 100) / 100;

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (classes.length) node.classList.add(...classes);
  return node;
}

function setTappable(target: SVGElement, tap: string | undefined, label: string, live: boolean): void {
  const on = live && tap !== undefined;
  if (on) target.dataset.ollTap = tap; else delete target.dataset.ollTap;
  target.classList.toggle("place-value-times-ten-live", on);
  if (on) {
    target.setAttribute("tabindex", "0");
    target.setAttribute("role", "button");
    target.setAttribute("aria-label", label);
    target.setAttribute("cursor", "pointer");
  } else for (const attribute of ["tabindex", "role", "aria-label", "cursor"]) target.removeAttribute(attribute);
}

function frameOf(raw: Record<string, unknown>, plan: PlaceValueTimesTenPlan): string {
  return JSON.stringify([placeValueTimesTenLanguage(raw), plan.width, plan.height, plan.columns.map((column) => [column.place, column.width]), plan.labels.map((label) => label.text)]);
}

/** One disk, centred at a point: a circle of its place's fill, its place's value written on it. */
function disk(plan: PlaceValueTimesTenPlan, place: number, x: number, y: number): SVGGElement {
  const column = plan.columns.find((candidate) => candidate.place === place)!;
  const group = element("g", {}, "place-value-times-ten-disk");
  group.dataset.place = String(place);
  group.append(element("circle", { cx: round(x), cy: round(y), r: GEO.D / 2, fill: column.fill }));
  const label = element("text", { x: round(x), y: round(y), "text-anchor": "middle", "dominant-baseline": "central", "font-size": round(placeValueTimesTenDiskFont(column.diskLabel)), "font-weight": 700, fill: COLORS.diskInk, "pointer-events": "none" });
  label.textContent = column.diskLabel;
  group.append(label);
  return group;
}

function create(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueTimesTenViewContext): View {
  const plan = planPlaceValueTimesTen(raw);
  const language = placeValueTimesTenLanguage(raw);
  const words = PLACE_VALUE_TIMES_TEN_WORDS[language];
  const given = document.createElement("div");
  given.className = "place-value-times-ten-given";
  const howto = document.createElement("p");
  howto.className = "place-value-times-ten-howto";
  // The instruction keeps one place, on its own line under the problem, whatever it says (or when empty).
  howto.style.minHeight = "1.5em";
  const svg = element("svg", { viewBox: `0 0 ${round(plan.width)} ${round(plan.height)}`, role: "group", "aria-label": words.chartLabel, "font-family": "ui-sans-serif, system-ui, sans-serif" }, "place-value-times-ten");
  svg.append(element("rect", { x: 0, y: 0, width: round(plan.width), height: round(plan.height), rx: 14, fill: COLORS.background }));
  const layers = new Map<number, SVGGElement>();
  let second: SVGGElement | undefined;
  for (const column of plan.columns) {
    const head = element("text", { x: round(column.x + column.width / 2), y: round(column.cell.y - 8), "text-anchor": "middle", "font-size": 15, "font-weight": 600, fill: COLORS.ink }, "place-value-times-ten-head");
    column.head.forEach((line, k) => {
      const span = element("tspan", { x: round(column.x + column.width / 2), dy: k === 0 ? -(column.head.length - 1) * 16 : 16 });
      span.textContent = line + (column.target && k === column.head.length - 1 ? "  ?" : "");
      head.append(span);
    });
    svg.append(head);
    const cell = element("rect", { x: column.cell.x, y: column.cell.y, width: column.cell.width, height: column.cell.height, rx: 10, fill: COLORS.column }, "place-value-times-ten-cell");
    if (column.target) { cell.setAttribute("stroke", COLORS.slot); cell.setAttribute("stroke-width", "2"); cell.setAttribute("stroke-dasharray", "6 5"); }
    svg.append(cell);
    if (column.cell2) svg.append(element("rect", { x: column.cell2.x, y: column.cell2.y, width: column.cell2.width, height: column.cell2.height, rx: 10, fill: COLORS.column }, "place-value-times-ten-cell"));
    const layer = element("g", {}, "place-value-times-ten-things");
    layer.dataset.place = String(column.place);
    svg.append(layer);
    layers.set(column.place, layer);
  }
  if (plan.labels.length) {
    second = element("g", {}, "place-value-times-ten-smaller");
    svg.append(second);
  }
  for (const label of plan.labels) {
    const text = element("text", { x: round(label.x), y: round(label.y), "text-anchor": "end", "dominant-baseline": "central", "font-size": GEO.LABEL, "font-weight": 600, fill: COLORS.ink, "font-variant-numeric": "tabular-nums" }, "place-value-times-ten-label");
    text.textContent = label.text;
    svg.append(text);
  }
  for (const point of plan.points) svg.append(element("circle", { cx: round(point.x), cy: round(point.y), r: 4, fill: COLORS.ink, "aria-label": words.point }, "place-value-times-ten-point"));
  const overlay = element("g", { "pointer-events": "none" }, "place-value-times-ten-overlay");
  svg.append(overlay);
  const notice = document.createElement("div");
  notice.className = "place-value-times-ten-notice";
  notice.setAttribute("aria-live", "polite");
  parent.append(given, howto, svg, notice);
  return { plan, frame: frameOf(raw, plan), language, svg, given, howto, notice, layers, ...(second ? { second } : {}), overlay, context, queue: [] };
}

/** A copy of the smaller number: a ringed row of slots, filled where a disk has arrived; numbered (1-10) on the right. */
function copyElement(view: View, p: PlaceValueTimesTenProblem, x: number, y: number, slots: boolean[], full: boolean, number?: number): SVGGElement {
  const fill = view.plan.columns.find((column) => column.place === p.t)!.fill;
  const group = element("g", {}, "place-value-times-ten-copy", full ? "place-value-times-ten-copy-full" : "place-value-times-ten-copy-part");
  const width = placeValueTimesTenRowWidth(slots.length), height = GEO.D + 2 * GEO.RP;
  group.append(element("rect", { x: round(x), y: round(y), width: round(width), height, rx: height / 2, fill: full ? COLORS.loop : "none", "fill-opacity": full ? 0.09 : 0, stroke: COLORS.loop, "stroke-width": full ? 3 : 2, "stroke-opacity": full ? 1 : 0.55, "stroke-dasharray": full ? "none" : "6 4" }));
  slots.forEach((filled, i) => {
    const cx = x + GEO.RP + i * (GEO.D + GEO.G) + GEO.D / 2, cy = y + GEO.RP + GEO.D / 2;
    if (filled) {
      const d = disk(view.plan, p.t, cx, cy);
      d.dataset.slot = String(i);
      group.append(d);
    } else group.append(element("circle", { cx: round(cx), cy: round(cy), r: GEO.D / 2 - 1, fill: "none", stroke: fill, "stroke-opacity": 0.45, "stroke-width": 2, "stroke-dasharray": "4 3" }, "place-value-times-ten-slot"));
  });
  if (number !== undefined) {
    const n = element("text", { x: round(x + width + 8), y: round(y + height / 2), "dominant-baseline": "central", "font-size": full ? 17 : 15, "font-weight": full ? 700 : 600, fill: full ? COLORS.loop : COLORS.muted }, "place-value-times-ten-number");
    n.textContent = String(number);
    group.append(n);
  }
  return group;
}

/** Draws one state: every column's things, a times pair's copies and smaller number, live taps and the note. */
function draw(view: View, state: PlaceValueTimesTenState): void {
  const { plan, context } = view;
  const live = context.live === true && view.queue.length === 0;
  const p = state.problem, words = PLACE_VALUE_TIMES_TEN_WORDS[view.language];
  const times = p.question === "times";
  view.overlay.replaceChildren();
  for (const column of plan.columns) {
    const layer = view.layers.get(column.place)!;
    layer.replaceChildren();
    const stage = Math.abs(column.place - p.s);
    const { x, y } = column.cell;
    if (times && column.place === p.t) {
      // Ten copies of the smaller number, numbered; they fill as the larger number's disks are dealt.
      placeValueTimesTenCopies(state).forEach((copy, r) => {
        const group = copyElement(view, p, x + GEO.CP, y + placeValueTimesTenSlotTop(r), copy.slots, copy.full, r + 1);
        group.dataset.row = String(r);
        setTappable(group, `copy:${r}`, words.refusal.copy_short(copy.have, p.digit!, p.t, placeValueNumeral(p.target, view.language)), live);
        if (view.note?.row === r) {
          // The copy the fact is about is marked where it is.
          group.classList.add("place-value-times-ten-asked");
          const height = GEO.D + 2 * GEO.RP;
          group.prepend(element("rect", { x: round(x + GEO.CP - 3), y: round(y + placeValueTimesTenSlotTop(r) - 3), width: round(placeValueTimesTenRowWidth(p.n) + 6), height: height + 6, rx: height / 2 + 3, fill: "none", stroke: COLORS.accent, "stroke-width": 3, "stroke-opacity": 0.45 }));
        }
        layer.append(group);
      });
      continue;
    }
    for (const { i, size } of placeValueTimesTenColumn(state, column.place)) {
      const canMove = stage < p.g;
      const label = canMove ? placeValueTimesTenStepSentence(p, stage, view.language) : words.refusal.at_target(p.t);
      let thing: SVGGElement;
      if (size === 1) {
        // A times pair's larger number sits in one row, each disk above the slot its ten fill; a count's disks stack.
        const cx = times ? x + GEO.CP + GEO.RP + i * (GEO.D + GEO.G) + GEO.D / 2 : x + column.width / 2;
        const cy = y + (times ? placeValueTimesTenSlotTop(0) : placeValueTimesTenSlotTop(i)) + GEO.RP + GEO.D / 2;
        thing = disk(plan, column.place, cx, cy);
      } else if (size === 10) {
        thing = element("g", {}, "place-value-times-ten-ten");
        const ty = y + placeValueTimesTenSlotTop(i);
        thing.append(element("rect", { x: round(x + GEO.CP), y: round(ty), width: placeValueTimesTenRowWidth(10), height: GEO.D + 2 * GEO.RP, rx: (GEO.D + 2 * GEO.RP) / 2, fill: column.fill, "fill-opacity": 0.13, stroke: column.fill, "stroke-width": canMove ? 3 : 2 }));
        for (let j = 0; j < 10; j += 1) thing.append(disk(plan, column.place, x + GEO.CP + GEO.RP + j * (GEO.D + GEO.G) + GEO.D / 2, ty + GEO.RP + GEO.D / 2));
      } else {
        thing = element("g", {}, "place-value-times-ten-square");
        const sx = x + GEO.CP + (i % 3) * (GEO.SQ + GEO.SG), sy = y + GEO.CP / 2 + Math.floor(i / 3) * (GEO.SQ + GEO.SG);
        thing.append(element("rect", { x: round(sx), y: round(sy), width: GEO.SQ, height: GEO.SQ, rx: 8, fill: column.fill, "fill-opacity": 0.12, stroke: column.fill, "stroke-width": canMove ? 3 : 2 }));
        const pitch = (GEO.SQ - 2 * 5.6 + 1.6) / 10;
        for (let r = 0; r < 10; r += 1) for (let c = 0; c < 10; c += 1) {
          thing.append(element("circle", { cx: round(sx + 5.6 + c * pitch + 4), cy: round(sy + 5.6 + r * pitch + 4), r: 4, fill: column.fill }, "place-value-times-ten-dot"));
        }
      }
      thing.dataset.i = String(i);
      thing.dataset.size = String(size);
      if (canMove && live) thing.classList.add("place-value-times-ten-ready");
      setTappable(thing, `move:${i}`, label, live);
      layer.append(thing);
    }
  }
  if (view.second && times) {
    const column = plan.columns.find((candidate) => candidate.place === p.t)!;
    view.second.replaceChildren();
    const smaller = copyElement(view, p, column.cell2!.x + GEO.CP, column.cell2!.y + placeValueTimesTenSlotTop(0), Array(p.n).fill(true), true);
    setTappable(smaller, "smaller:0", words.refusal.smaller(placeValueNumeral(p.target, view.language), p.digit!, p.t), live);
    view.second.append(smaller);
  }
  drawNote(view, state);
  view.howto.textContent = context.live === true ? placeValueTimesTenInstruction(state, view.language) : "";
  view.shown = state;
  view.drawnContext = JSON.stringify([context.live === true, view.note ?? null]);
}

/** A copy's fact is said in the Tens area right under that copy (above it, for the last); any other under the chart. */
function drawNote(view: View, state: PlaceValueTimesTenState): void {
  const note = view.note;
  const column = view.plan.columns.find((candidate) => candidate.place === state.problem.t);
  if (note && note.row !== undefined && column && state.problem.question === "times") {
    const last = note.row === PLACE_VALUE_TIMES_TEN_COPIES - 1;
    const y = column.cell.y + (last ? placeValueTimesTenSlotTop(note.row) - 30 : placeValueTimesTenSlotTop(note.row + 1) + 1);
    const object = element("foreignObject", { x: round(column.cell.x + GEO.CP), y: round(y), width: round(column.cell.width - 2 * GEO.CP), height: 30 }, "place-value-times-ten-note");
    const text = document.createElementNS(XHTML_NS, "p") as HTMLParagraphElement;
    text.className = "place-value-times-ten-colnote";
    text.textContent = `${last ? "↓" : "↑"} ${note.text}`;
    object.append(text);
    view.overlay.append(object);
    view.notice.textContent = "";
  } else view.notice.textContent = note?.text ?? "";
}

// ---------------------------------------------------------------- animation

const reduced = (view: View): boolean => view.context.reducedMotion === true || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
const canAnimate = (node: Element): boolean => typeof (node as Element & { animate?: unknown }).animate === "function";

function centre(node: Element | null | undefined): { x: number; y: number } | undefined {
  const box = (node as SVGGraphicsElement | null)?.getBBox?.();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : undefined;
}
function fly(node: Element, from: { x: number; y: number }, to: { x: number; y: number }, delay: number, duration: number): void {
  if (!canAnimate(node)) return;
  node.animate([{ transform: `translate(${round(from.x - to.x)}px, ${round(from.y - to.y)}px) scale(.6)`, opacity: 0.3 }, { transform: "none", opacity: 1 }], { duration, delay, easing: "cubic-bezier(.3,.7,.3,1)", fill: "backwards" });
}

/** Animates lineage i's move: a break flies out of the thing it came from; a put-together grows where its ten met. */
function animateMove(view: View, before: Map<string, { x: number; y: number }>, i: number, state: PlaceValueTimesTenState): void {
  const from = before.get(`i${i}`);
  if (!from) return;
  const p = state.problem;
  if (p.question === "times") {
    const layer = view.layers.get(p.t)!;
    [...layer.querySelectorAll(`.place-value-times-ten-disk[data-slot="${i}"]`)].forEach((node, r) => { const at = centre(node); if (at) fly(node, from, at, r * 55, 520); });
    return;
  }
  const node = [...view.layers.values()].map((layer) => layer.querySelector(`[data-i="${i}"]`)).find(Boolean);
  if (!node) return;
  const parts = [...node.querySelectorAll(".place-value-times-ten-disk, .place-value-times-ten-dot")];
  if (p.dir < 0) parts.forEach((part, k) => { const at = centre(part); if (at) fly(part, from, at, Math.floor(k / 10) * 25 + (k % 10) * 30 / (parts.length > 10 ? 4 : 1), 560); });
  else { const at = centre(node); if (at && canAnimate(node)) node.animate([{ transform: `translate(${round(from.x - at.x)}px, ${round(from.y - at.y)}px) scale(.3)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 800, easing: "ease-in-out", fill: "backwards" }); }
}
function centres(view: View): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const layer of view.layers.values()) for (const node of layer.querySelectorAll("[data-i]")) { const at = centre(node); if (at) out.set(`i${(node as SVGElement).dataset.i}`, at); }
  return out;
}

const MOVE_MS = 700;
function play(view: View): void {
  if (view.timer !== undefined) return;
  const next = view.queue.shift();
  if (!next) return;
  const before = centres(view);
  draw(view, next.state);
  if (next.moved !== undefined && !reduced(view)) { try { animateMove(view, before, next.moved, next.state); } catch { /* drawing goes on */ } }
  if (!view.queue.length) return;
  view.timer = setTimeout(() => {
    view.timer = undefined;
    if (!view.svg.isConnected) { view.queue = []; return; }
    play(view);
  }, next.moved !== undefined ? MOVE_MS : 0);
}

const sameProblem = (x: PlaceValueTimesTenState | undefined, y: PlaceValueTimesTenState): boolean =>
  !!x && x.problem.amount === y.problem.amount && x.problem.target === y.problem.target && x.problem.start === y.problem.start;

/** The moves from the state drawn to a new one, when every lineage only went forward: one move at a time, in row order. */
function movesBetween(from: PlaceValueTimesTenState, to: PlaceValueTimesTenState): Array<{ state: PlaceValueTimesTenState; moved: number }> | undefined {
  if (!sameProblem(from, to)) return undefined;
  if (to.stages.some((k, i) => k < from.stages[i]!)) return undefined;
  const out: Array<{ state: PlaceValueTimesTenState; moved: number }> = [];
  let stages = [...from.stages];
  for (let k = 0; k < to.problem.g; k += 1) {
    for (let i = 0; i < stages.length; i += 1) {
      if (stages[i] === k && to.stages[i]! > k) {
        stages = stages.map((v, j) => (j === i ? k + 1 : v));
        out.push({ state: { ...to, stages: [...stages] }, moved: i });
      }
    }
  }
  return out;
}

function update(view: View, raw: Record<string, unknown>, context: PlaceValueTimesTenViewContext): void {
  view.context = context;
  const state = placeValueTimesTenState(raw);
  view.svg.classList.toggle("place-value-times-ten-live", context.live === true);
  // The problem, its blank drawn as a dashed "?".
  const text = placeValueTimesTenProblemText(state.problem, view.language);
  const [left, right] = text.split("?");
  const blank = document.createElement("span");
  blank.className = "place-value-times-ten-blank";
  blank.textContent = "?";
  view.given.replaceChildren(left ?? "", ...(right === undefined ? [] : [blank, right]));
  const refusedKey = context.refused && context.notice ? `${context.refused.kind}:${context.refused.place}:${context.notice}` : undefined;
  if (refusedKey !== view.refusedKey) {
    view.refusedKey = refusedKey;
    view.note = context.notice ? { ...(context.refused?.kind === "copy" ? { row: context.refused.place } : {}), text: context.notice } : undefined;
  }
  const shown = view.target ?? view.shown;
  // An eased "counted in" between two rows' moves changes nothing drawn: compare the rows, and only whether it demonstrates.
  if (shown && sameProblem(shown, state) && placeValueTimesTenStateKey(shown) === placeValueTimesTenStateKey(state) && ((shown.demo ?? 0) > 0) === ((state.demo ?? 0) > 0)) {
    const key = JSON.stringify([context.live === true, view.note ?? null]);
    if (!view.queue.length && view.timer === undefined && key !== view.drawnContext) draw(view, view.shown ?? state);
    return;
  }
  const moves = shown ? movesBetween(shown, state) : undefined;
  view.target = state;
  if (!moves || !moves.length || reduced(view)) {
    if (view.timer !== undefined) { clearTimeout(view.timer); view.timer = undefined; }
    view.queue = [];
    draw(view, state);
    return;
  }
  // The last queued state is the full one (its demonstration position, its notes).
  moves[moves.length - 1] = { state, moved: moves[moves.length - 1]!.moved };
  view.queue.push(...moves);
  play(view);
}

/** Draws the card into an empty parent. */
export function renderPlaceValueTimesTen(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueTimesTenViewContext): void {
  const view = create(parent, raw, context);
  views.set(parent, view);
  update(view, raw, context);
}

/**
 * Updates a card drawn by `renderPlaceValueTimesTen` into the same parent. Returns false when the parent holds no
 * such card or its frame (language, columns and their widths, the numbers' labels) changed; the caller then redraws.
 */
export function updatePlaceValueTimesTen(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueTimesTenViewContext): boolean {
  const view = views.get(parent);
  if (!view || !view.svg.isConnected || view.frame !== frameOf(raw, planPlaceValueTimesTen(raw))) {
    if (view?.timer !== undefined) clearTimeout(view.timer);
    return false;
  }
  update(view, raw, context);
  return true;
}
