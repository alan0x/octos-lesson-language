/**
 * Draws a `make_ten` card (decision 0027) from its plan (make-ten.ts): the problem as the program writes it
 * ("8 + 6", each addend in its counters' colour), the one-line instruction that follows the frames (only while the
 * learner can tap it; its colour word drawn in that colour), then the two ten frames as SVG: each frame's live
 * count above it, the counters, the bigger frame's empty places dashed, a "+" between the frames and, before the
 * first move, a faint arrow from the giving frame toward the dashed places. Values come from the content with
 * bindings applied. The card never writes the split, the ones left or the total.
 *
 * The tapped counter is the one that moves (the sketch): every counter carries `data-oll-piece` (its own id) and
 * `data-oll-tap` (`give:<frame>` at home, `back:<frame>` once it crossed; the frame is 0 or 1). The board turns a
 * tap into the card's tap rules and hands back the step with the piece tapped; the counters of the frame it left
 * close up from the first place. The demonstration (`filled` going up) moves one counter at a time. With reduced
 * motion the frames change at once. A refused tap's fact is said at the frame tapped, the tapped counter gets a
 * grey dashed ring (and shakes once), and the counters that can move are pointed out for a moment.
 */
import {
  MAKE_TEN_FILLS, MAKE_TEN_PLACES, MAKE_TEN_WORDS, applyMakeTenTap, makeTenAddend, makeTenComplete, makeTenDemonstrating, makeTenFrame, makeTenGiver, makeTenInstruction,
  makeTenLanguage, makeTenPlaceAt, makeTenRefusalRich, makeTenState, planMakeTen,
  type MakeTenLanguage, type MakeTenPlan, type MakeTenRichText, type MakeTenState, type MakeTenTapKind,
} from "./make-ten.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export interface MakeTenViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** True while an open task lets the learner tap this card. */
  live?: boolean;
  /** A refused tap's sentence, in the card's words. */
  notice?: string;
  /** The refused tap the notice answers (its place is the frame), so it is said at that frame. */
  refused?: { kind: string; place: number };
  /** The tap that made this state, and the counter tapped; that counter moves. */
  step?: { tap: { kind: string; place: number }; piece?: string };
  /** Draw changes at once (also when the page asks for reduced motion). */
  reducedMotion?: boolean;
  /**
   * How long one step of the lesson's demonstration animates (`DEMONSTRATION_STEP_MS` at the playback speed; owner,
   * 2026-11-27). The player moves `filled` one counter at a time; that one counter's move is drawn this slowly. A
   * learner's tap keeps its quick pace, and a jump of several counters (a seek, a restore) plays at the tap pace.
   */
  demonstrationMs?: number;
}

interface MakeTenView {
  plan: MakeTenPlan;
  language: MakeTenLanguage;
  root: HTMLElement;
  given: HTMLDivElement;
  howto: HTMLParagraphElement;
  svg: SVGSVGElement;
  captions: [SVGTextElement, SVGTextElement];
  frames: [SVGGElement, SVGGElement];
  counters: SVGGElement;
  overlay: SVGGElement;
  notice: HTMLDivElement;
  context: MakeTenViewContext;
  /** Counter ids in each frame, in place order. */
  order: [string[], string[]];
  /** The pair the order belongs to. */
  pair?: string;
  shown?: MakeTenState;
  /** The counter last pressed (a refusal marks it). */
  pressed?: string;
  refusedKey?: string;
  note?: { frame: number; rich: MakeTenRichText };
  refusedPiece?: string;
  pointingUntil: number;
  timer?: ReturnType<typeof setTimeout>;
  /** Moves still to draw; `scale` stretches one's animation (a demonstration step). */
  queue: Array<{ state: MakeTenState; piece?: string; scale?: number }>;
}

const views = new WeakMap<HTMLElement, MakeTenView>();

const COLORS = { background: "#eef1f8", place: "#ffffff", ink: "#1d2433", muted: "#5b6478", slot: "#c9d0df", accent: "#2f5bd3", noteBg: "#e9eefb" } as const;
/** The milliseconds one counter's move takes before the next may start (the demonstration). */
const MOVE_MS = 700;
const POINT_MS = 1500;

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (classes.length) node.classList.add(...classes);
  return node;
}

const round = (value: number) => Math.round(value * 100) / 100;
const pairOf = (state: MakeTenState) => `${state.problem.a}+${state.problem.b}`;

/** Fills an HTML element with a rich sentence: each colour word drawn in its addend's colour. */
function richInto(target: HTMLElement, rich: MakeTenRichText): void {
  target.replaceChildren(...rich.map((part) => {
    if (typeof part === "string") return document.createTextNode(part);
    const span = document.createElement("span");
    span.className = `make-ten-cword make-ten-n${part.frame}`;
    span.style.color = MAKE_TEN_FILLS[part.frame];
    span.style.fontWeight = "700";
    span.textContent = part.word;
    return span;
  }));
}

/** The frame: background, captions, the two grids, the "+", the counters' layer and the overlay. */
function create(parent: HTMLElement, raw: Record<string, unknown>, context: MakeTenViewContext): MakeTenView {
  const plan = planMakeTen(raw);
  const language = makeTenLanguage(raw);
  const words = MAKE_TEN_WORDS[language];
  const given = document.createElement("div");
  given.className = "make-ten-given";
  const howto = document.createElement("p");
  howto.className = "make-ten-howto";
  const svg = element("svg", { viewBox: `0 0 ${round(plan.width)} ${round(plan.height)}`, role: "group", "aria-label": words.cardLabel, "font-family": "ui-sans-serif, system-ui, sans-serif" }, "make-ten");
  svg.append(element("rect", { x: 0, y: 0, width: round(plan.width), height: round(plan.height), rx: 14, fill: COLORS.background }, "make-ten-background"));
  const captions: SVGTextElement[] = [];
  const frames: SVGGElement[] = [];
  for (const frame of plan.frames) {
    // `.make-ten-caption` with `data-frame` is a stable hook: hosts anchor the row of blanks to these live counts (Learn).
    const caption = element("text", { x: round(frame.caption.x), y: round(frame.caption.y), "text-anchor": "middle", "dominant-baseline": "central", "font-size": 34, "font-weight": 600, fill: COLORS.ink, "font-variant-numeric": "tabular-nums" }, "make-ten-caption");
    caption.dataset.frame = String(frame.frame);
    svg.append(caption);
    captions.push(caption);
    const group = element("g", {}, "make-ten-frame");
    group.dataset.frame = String(frame.frame);
    const { x, y, width, height } = frame.box;
    group.append(element("rect", { x: x - 3, y: y - 3, width: width + 6, height: height + 6, rx: 6, fill: COLORS.ink }, "make-ten-frame-edge"));
    for (let slot = 0; slot < MAKE_TEN_PLACES; slot += 1) {
      const at = makeTenPlaceAt(plan, frame.frame, slot);
      group.append(element("rect", { x: round(at.x - plan.unit / 2 + 1), y: round(at.y - plan.unit / 2 + 1), width: plan.unit - 2, height: plan.unit - 2, fill: COLORS.place }, "make-ten-place"));
    }
    svg.append(group);
    frames.push(group);
  }
  const plus = element("text", { x: round(plan.plus.x), y: round(plan.plus.y), "text-anchor": "middle", "dominant-baseline": "central", "font-size": 44, "font-weight": 600, fill: COLORS.muted, "aria-hidden": "true" }, "make-ten-plus");
  plus.textContent = "+";
  svg.append(plus);
  const counters = element("g", {}, "make-ten-counters");
  const overlay = element("g", {}, "make-ten-overlay");
  svg.append(counters, overlay);
  const notice = document.createElement("div");
  notice.className = "make-ten-notice";
  notice.setAttribute("aria-live", "polite");
  parent.append(given, howto, svg, notice);
  const view: MakeTenView = {
    plan, language, root: parent, given, howto, svg, captions: captions as [SVGTextElement, SVGTextElement], frames: frames as [SVGGElement, SVGGElement],
    counters, overlay, notice, context, order: [[], []], pointingUntil: 0, queue: [],
  };
  // The counter pressed: a refusal is shown on it (the board hands back a piece only with a tap it made).
  svg.addEventListener("pointerdown", (event) => {
    const piece = (event.target as Element | null)?.closest?.("[data-oll-piece]")?.getAttribute("data-oll-piece");
    if (piece) view.pressed = piece;
  }, true);
  svg.addEventListener("keydown", (event) => {
    const piece = (event.target as Element | null)?.closest?.("[data-oll-piece]")?.getAttribute("data-oll-piece");
    if (piece) view.pressed = piece;
  }, true);
  return view;
}

/** The order of a fresh pair: each addend's counters in its own frame. */
function freshOrder(state: MakeTenState): [string[], string[]] {
  return [0, 1].map((frame) => Array.from({ length: makeTenAddend(state.problem, frame) }, (_, k) => `c${frame}-${k}`)) as [string[], string[]];
}
const colourOf = (id: string): number => Number(id[1]);

/** Moves counters between the frames until the order holds `state` (the tapped piece first, else the last one). */
function reconcile(view: MakeTenView, state: MakeTenState, piece?: string): void {
  if (view.pair !== pairOf(state)) { view.order = freshOrder(state); view.pair = pairOf(state); }
  const big = state.problem.big, giver = makeTenGiver(state.problem);
  const visitors = () => view.order[big].filter((id) => colourOf(id) === giver).length;
  let guard = 0;
  while (visitors() < state.moved && guard++ < 20) {
    const homes = view.order[giver].filter((id) => colourOf(id) === giver);
    const id = piece && homes.includes(piece) ? piece : homes.at(-1);
    if (!id) break;
    view.order[giver] = view.order[giver].filter((x) => x !== id);
    view.order[big].push(id);
    piece = undefined;
  }
  while (visitors() > state.moved && guard++ < 40) {
    const back = view.order[big].filter((id) => colourOf(id) === giver);
    const id = piece && back.includes(piece) ? piece : back.at(-1);
    if (!id) break;
    view.order[big] = view.order[big].filter((x) => x !== id);
    view.order[giver].push(id);
    piece = undefined;
  }
}

/** Every counter's centre now, by id. */
function positions(view: MakeTenView): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  view.order.forEach((ids, frame) => ids.forEach((id, slot) => out.set(id, makeTenPlaceAt(view.plan, frame, slot))));
  return out;
}

/** Draws one state: counters, dashed places, the full frame's ring, captions, the arrow, the note and the instruction. */
function draw(view: MakeTenView, state: MakeTenState, before?: Map<string, { x: number; y: number }>, scale = 1): void {
  const { plan, context } = view;
  const live = context.live === true && view.queue.length === 0 && !makeTenDemonstrating(state);
  const words = MAKE_TEN_WORDS[view.language];
  const complete = makeTenComplete(state);
  const big = state.problem.big, giver = makeTenGiver(state.problem);
  const pointing = Date.now() < view.pointingUntil;
  view.counters.replaceChildren();
  view.overlay.replaceChildren();
  for (const frame of [0, 1] as const) {
    view.captions[frame].textContent = String(makeTenFrame(state, frame).count);
    const full = makeTenFrame(state, frame).count === MAKE_TEN_PLACES;
    const edge = view.frames[frame].querySelector(".make-ten-frame-edge");
    edge?.setAttribute("stroke", full ? plan.done : "none");
    edge?.setAttribute("stroke-width", full ? "8" : "0");
    view.frames[frame].classList.toggle("make-ten-full", full);
    const ids = view.order[frame];
    for (let slot = 0; slot < MAKE_TEN_PLACES; slot += 1) {
      const at = makeTenPlaceAt(plan, frame, slot);
      const id = ids[slot];
      if (!id) {
        // The bigger frame's empty places: where a counter lands.
        if (frame === big && !complete) view.counters.append(element("circle", { cx: round(at.x), cy: round(at.y), r: plan.counter / 2, fill: "none", stroke: COLORS.slot, "stroke-width": 2.5, "stroke-dasharray": "6 5" }, "make-ten-landing"));
        continue;
      }
      const colour = colourOf(id);
      const home = colour === frame;
      const fill = MAKE_TEN_FILLS[colour as 0 | 1];
      const counter = element("g", {}, "make-ten-counter", `make-ten-c${colour}`);
      counter.dataset.piece = id;
      counter.dataset.frame = String(frame);
      counter.dataset.kind = home ? "home" : "visitor";
      if (!home) counter.classList.add("make-ten-visitor");
      const movable = live && home && frame === giver && !complete;
      if (movable) counter.classList.add("make-ten-movable");
      const refused = view.refusedPiece === id && view.note !== undefined;
      if (refused) counter.classList.add("make-ten-refused");
      const r = plan.counter / 2;
      if (!home) counter.append(element("circle", { cx: round(at.x), cy: round(at.y), r: r + 5, fill: "none", stroke: fill, "stroke-width": 2.5 }, "make-ten-visitor-ring"));
      if (movable) counter.append(element("circle", { cx: round(at.x), cy: round(at.y), r: r + 6, fill: "none", stroke: fill, "stroke-width": pointing ? 3 : 2, "stroke-opacity": pointing ? 1 : 0.55, "stroke-dasharray": "5 4" }, "make-ten-movable-ring"));
      if (refused) counter.append(element("circle", { cx: round(at.x), cy: round(at.y), r: r + 6, fill: "none", stroke: COLORS.muted, "stroke-width": 2.5, "stroke-dasharray": "5 4" }, "make-ten-refused-ring"));
      counter.append(element("circle", { cx: round(at.x), cy: round(at.y), r, fill }, "make-ten-counter-face"));
      counter.append(element("ellipse", { cx: round(at.x), cy: round(at.y + r * 0.55), rx: round(r * 0.8), ry: round(r * 0.28), fill: "#000000", "fill-opacity": 0.12, "pointer-events": "none" }));
      const tap: MakeTenTapKind = home ? "give" : "back";
      if (live) {
        counter.dataset.ollTap = `${tap}:${frame}`;
        counter.dataset.ollPiece = id;
        counter.setAttribute("tabindex", "0");
        counter.setAttribute("role", "button");
        counter.setAttribute("aria-label", home ? words.moveAway : words.moveBack);
        counter.setAttribute("cursor", "pointer");
      }
      view.counters.append(counter);
    }
  }
  // Before the first move: a faint arrow from the giving frame toward the dashed places.
  if (live && state.moved === 0 && !complete) {
    const { x1, x2, y } = plan.arrow;
    const toLeft = big === 0;
    const fill = MAKE_TEN_FILLS[giver];
    const tip = toLeft ? x1 : x2, tail = toLeft ? x2 : x1, head = toLeft ? 12 : -12;
    const arrow = element("g", { "aria-hidden": "true" }, "make-ten-arrow");
    arrow.dataset.to = String(big);
    arrow.append(
      element("path", { d: `M${round(tail)} ${round(y)} H${round(tip + head)}`, stroke: fill, "stroke-width": 3, "stroke-dasharray": "6 4", fill: "none", opacity: 0.6 }),
      element("polygon", { points: `${round(tip)},${round(y)} ${round(tip + head)},${round(y - 7)} ${round(tip + head)},${round(y + 7)}`, fill, opacity: 0.6 }),
    );
    view.overlay.append(arrow);
  }
  drawNote(view);
  if (live) richInto(view.howto, makeTenInstruction(state, view.language)); else view.howto.textContent = "";
  view.shown = state;
  if (before) animateFrom(view, before, scale);
}

/** A refused tap's fact is said under the frame tapped. */
function drawNote(view: MakeTenView): void {
  const note = view.note;
  if (!note) { view.notice.textContent = ""; return; }
  const box = view.plan.frames[note.frame === 1 ? 1 : 0]!.note;
  const object = element("foreignObject", { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) }, "make-ten-note");
  object.dataset.frame = String(note.frame);
  const text = document.createElementNS(XHTML_NS, "p") as HTMLParagraphElement;
  text.className = "make-ten-framenote";
  text.style.cssText = `margin:0;padding:5px 8px;font:600 14px/1.3 ui-sans-serif,system-ui,sans-serif;color:${COLORS.ink};background:${COLORS.noteBg};border-left:3px solid ${COLORS.accent};border-radius:6px`;
  richInto(text, note.rich);
  object.append(text);
  view.overlay.append(object);
  view.notice.textContent = "";
}

// ---------------------------------------------------------------- animation

const reduced = (view: MakeTenView): boolean => view.context.reducedMotion === true
  || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
const canAnimate = (node: Element): boolean => typeof (node as Element & { animate?: unknown }).animate === "function";

/**
 * Every counter that changed place glides from where it was: the one that crossed far, the ones closing up near.
 * `scale` stretches the glide: 1 at a tap's pace, more for a demonstration step.
 */
function animateFrom(view: MakeTenView, before: Map<string, { x: number; y: number }>, scale = 1): void {
  if (reduced(view)) return;
  const now = positions(view);
  for (const counter of view.counters.querySelectorAll<SVGGElement>(".make-ten-counter")) {
    const id = counter.dataset.piece!;
    const from = before.get(id), to = now.get(id);
    if (!from || !to || (from.x === to.x && from.y === to.y) || !canAnimate(counter)) continue;
    const far = Math.abs(from.x - to.x) > view.plan.unit * 2;
    counter.animate([{ transform: `translate(${round(from.x - to.x)}px, ${round(from.y - to.y)}px)` }, { transform: "none" }], { duration: (far ? 620 : 260) * scale, easing: "cubic-bezier(.3,.7,.3,1)", fill: "backwards" });
  }
}

function shake(view: MakeTenView): void {
  if (reduced(view) || !view.refusedPiece) return;
  const counter = view.counters.querySelector<SVGGElement>(`[data-piece="${view.refusedPiece}"]`);
  if (counter && canAnimate(counter)) {
    counter.animate([{ transform: "none" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(3px)" }, { transform: "none" }], { duration: 380 });
  }
}

/** Plays the queued moves one after another (the demonstration), each drawn then animated. */
function play(view: MakeTenView): void {
  if (view.timer !== undefined) return;
  const next = view.queue.shift();
  if (!next) return;
  const before = positions(view);
  reconcile(view, next.state, next.piece);
  draw(view, next.state, before, next.scale);
  if (!view.queue.length) return;
  view.timer = setTimeout(() => {
    view.timer = undefined;
    if (!view.svg.isConnected) { view.queue = []; return; }
    play(view);
  }, MOVE_MS * (next.scale ?? 1));
}

function update(view: MakeTenView, raw: Record<string, unknown>, context: MakeTenViewContext): void {
  view.context = context;
  const state = makeTenState(raw);
  view.svg.classList.toggle("make-ten-live", context.live === true);
  view.given.replaceChildren(...[0, 1].flatMap((frame) => {
    const span = document.createElement("span");
    span.className = `make-ten-n${frame}`;
    span.style.color = MAKE_TEN_FILLS[frame as 0 | 1];
    span.textContent = String(makeTenAddend(state.problem, frame));
    return frame === 0 ? [span, document.createTextNode(" + ")] : [span];
  }));
  context.applyEmphasis(view.svg, "whole");
  // A refused tap: said at the frame tapped; the counter pressed is marked, and the movable ones pointed out.
  const refusedKey = context.refused && context.notice ? `${context.refused.kind}:${context.refused.place}:${context.notice}:${view.pressed ?? ""}` : undefined;
  let refusedNow = false;
  if (refusedKey !== view.refusedKey) {
    view.refusedKey = refusedKey;
    if (context.refused && context.notice) {
      // The reason, from the card's own rules on the tap refused: its fact is drawn with its colour word in colour.
      const result = applyMakeTenTap(state, { tap: context.refused.kind as MakeTenTapKind, place: context.refused.place });
      view.note = { frame: context.refused.place, rich: result.ok ? [context.notice] : makeTenRefusalRich(state, result.reason, view.language) };
      view.refusedPiece = view.pressed;
      view.pointingUntil = Date.now() + POINT_MS;
      refusedNow = true;
      setTimeout(() => { if (view.svg.isConnected && view.shown && Date.now() >= view.pointingUntil) draw(view, view.shown); }, POINT_MS + 20);
    } else {
      view.note = undefined;
      view.refusedPiece = undefined;
    }
  }
  const shown = view.shown;
  const sameTarget = (x?: MakeTenState) => !!x && pairOf(x) === pairOf(state) && x.moved === state.moved && x.filled === state.filled;
  const last = view.queue.at(-1)?.state ?? shown;
  if (sameTarget(last)) {
    if (!view.queue.length && view.timer === undefined) { draw(view, shown ?? state); if (refusedNow) shake(view); }
    return;
  }
  // From the state drawn: the learner's one tap (moved by one, its piece), or the demonstration's next counters.
  if (shown && pairOf(shown) === pairOf(state) && !reduced(view)) {
    const from = (last ?? shown);
    const k0 = from.filled ?? 0, k1 = state.filled;
    if (k1 > k0 && makeTenDemonstrating(state)) {
      // One counter of the demonstration is a step at its own pace; a jump of several plays at the tap's.
      const scale = k1 - k0 === 1 && context.demonstrationMs ? Math.max(1, context.demonstrationMs / MOVE_MS) : undefined;
      for (let k = k0 + 1; k <= k1; k += 1) view.queue.push({ state: { problem: state.problem, moved: k - makeTenAddend(state.problem, state.problem.big), filled: k }, ...(scale ? { scale } : {}) });
      play(view);
      return;
    }
    if (Math.abs(state.moved - from.moved) === 1 && k1 === k0) {
      const before = positions(view);
      if (view.timer !== undefined) { clearTimeout(view.timer); view.timer = undefined; view.queue = []; }
      reconcile(view, state, context.step?.piece);
      draw(view, state, before);
      return;
    }
  }
  if (view.timer !== undefined) { clearTimeout(view.timer); view.timer = undefined; }
  view.queue = [];
  reconcile(view, state, context.step?.piece);
  draw(view, state);
}

/** Draws the card into an empty parent. */
export function renderMakeTen(parent: HTMLElement, raw: Record<string, unknown>, context: MakeTenViewContext): void {
  const view = create(parent, raw, context);
  views.set(parent, view);
  update(view, raw, context);
}

/**
 * Updates a card drawn by `renderMakeTen` into the same parent. Returns false when the parent holds no such card
 * or its language changed; the caller then redraws it.
 */
export function updateMakeTen(parent: HTMLElement, raw: Record<string, unknown>, context: MakeTenViewContext): boolean {
  const view = views.get(parent);
  if (!view || !view.svg.isConnected || view.language !== makeTenLanguage(raw)) {
    if (view?.timer !== undefined) clearTimeout(view.timer);
    return false;
  }
  update(view, raw, context);
  return true;
}
