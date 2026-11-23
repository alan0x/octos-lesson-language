/**
 * Draws a `base_ten_trade` card (decision 0023) as SVG from its plan (base-ten-trade.ts): a place-value
 * mat with columns named in words, a tray of ten between each place and the next, and the units. No
 * number is drawn: the learner counts. Values come from the content with bindings already applied.
 *
 * The card is drawn once and then updated in place, so every unit keeps its identity: the unit a learner
 * tapped is the unit that moves (sketch v3, accepted by the owner). A step (the tap that made this state)
 * animates: ten in a tray fade into one unit of the next place, which then moves to its column; a break
 * moves one unit onto the tray below and splits it into ten. Without a step (a reset, a seek, a practice
 * pile arriving) the units are placed directly.
 *
 * Every element a learner can tap carries `data-oll-tap` ("gather:0", "make:0", "break:1", …) and a unit
 * also `data-oll-piece`; the board turns a tap into the card's tap rules. When the card is not live (the
 * lesson is playing, or no open task lets the learner tap it) the same picture is drawn without tap cues.
 */
import {
  BASE_TEN_TRADE_PLACES, BASE_TEN_WORDS, baseTenLanguage, baseTenLooseAt, baseTenMat, baseTenTrayAt, hasTray, planBaseTenTrade,
  type BaseTenLanguage, type BaseTenMat, type BaseTenTap, type BaseTenTradePlan,
} from "./base-ten-trade.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface BaseTenTradeViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** True while an open task lets the learner tap this card. */
  live?: boolean;
  /** A one-line message under the mat (a refused tap's reason). */
  notice?: string;
  /** The tap that made this state, and the unit tapped; it animates. Absent: place units directly. */
  step?: { tap: BaseTenTap; piece?: string };
}

interface MatView {
  plan: BaseTenTradePlan;
  columns: 2 | 3;
  /** The mat's language; a mat whose language changes is drawn again (amendment 3). */
  language: BaseTenLanguage;
  words: typeof BASE_TEN_WORDS[BaseTenLanguage];
  svg: SVGSVGElement;
  units: SVGGElement;
  buttons: SVGGElement[];
  notice: HTMLDivElement;
  caption: HTMLDivElement;
  loose: string[][];
  tray: string[][];
  elements: Map<string, SVGGElement>;
  next: number;
  /** Bumped by every update; a timer from an older update does nothing (review of #88). */
  generation: number;
}

const views = new WeakMap<HTMLElement, MatView>();

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (classes.length) node.classList.add(...classes);
  return node;
}

const round = (value: number) => Math.round(value * 100) / 100;
/** How long a move takes; matches the stylesheet's transform transition (.38s), with a little to spare. */
const MOVE_MS = 420;
let moves = 0;
/** Marks a unit as moving (no pointer events) until its move ends; a later move of the same unit restarts it. */
function moving(unit: SVGGElement): void {
  const token = String(++moves);
  unit.dataset.move = token;
  unit.classList.add("base-ten-moving");
  setTimeout(() => { if (unit.dataset.move === token) unit.classList.remove("base-ten-moving"); }, MOVE_MS);
}
/** How long a fuse or a split takes; matches the stylesheet's opacity transition. */
const FUSE_MS = 450;

function setTappable(target: SVGElement, tap: string | undefined, label: string, live: boolean): void {
  if (tap) target.dataset.ollTap = tap; else delete target.dataset.ollTap;
  const on = live && tap !== undefined;
  target.classList.toggle("base-ten-live", on);
  if (on) {
    target.setAttribute("tabindex", "0");
    target.setAttribute("role", "button");
    target.setAttribute("aria-label", label);
  } else {
    target.removeAttribute("tabindex");
    target.removeAttribute("role");
    target.removeAttribute("aria-label");
  }
}

/** One unit, drawn at the origin and placed by a transform: a one is a square, a ten a rod, a hundred a flat. */
function unitElement(plan: BaseTenTradePlan, place: number, id: string): SVGGElement {
  const U = plan.unit;
  const width = place === 2 ? 10 * U : U;
  const height = place === 0 ? U : 10 * U;
  const group = element("g", {}, "base-ten-unit");
  group.dataset.place = String(place);
  group.dataset.ollPiece = id;
  // A larger tap area than the unit itself, so a one is easy to tap.
  group.append(element("rect", { x: round(-0.5 * U), y: round(-0.5 * U), width: round(width + U), height: round(height + U) }, "base-ten-hit"));
  group.append(element("rect", { x: 0, y: 0, width: round(width), height: round(height), rx: place === 0 ? 2 : 1.5 }, "base-ten-block"));
  if (place >= 1) for (let i = 1; i < 10; i += 1) group.append(element("line", { x1: 0, y1: round(i * U), x2: round(width), y2: round(i * U) }, "base-ten-grid"));
  if (place === 2) {
    for (let i = 1; i < 10; i += 1) group.append(element("line", { x1: round(i * U), y1: 0, x2: round(i * U), y2: round(height) }, "base-ten-grid"));
    group.append(element("rect", { x: 0, y: 0, width: round(width), height: round(height), rx: 1.5 }, "base-ten-flat-edge"));
  }
  return group;
}

const place = (unit: SVGGElement, at: { x: number; y: number }) => { unit.style.transform = `translate(${round(at.x)}px, ${round(at.y)}px)`; };
/** Places a unit without animating (a new unit, or a cut). */
function placeAt(unit: SVGGElement, at: { x: number; y: number }): void {
  unit.classList.add("base-ten-still");
  place(unit, at);
  unit.getBoundingClientRect();
  unit.classList.remove("base-ten-still");
}

function button(plan: BaseTenTradePlan, box: { x: number; y: number; width: number; height: number; text: string }, tap: string, primary: boolean): SVGGElement {
  const group = element("g", {}, "base-ten-button", primary ? "base-ten-button-primary" : "base-ten-button-quiet");
  group.append(element("rect", { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height), rx: round(box.height / 2) }));
  const label = element("text", { x: round(box.x + box.width / 2), y: round(box.y + box.height / 2), "text-anchor": "middle", "dominant-baseline": "central", "font-size": plan.fontSize });
  label.textContent = box.text;
  group.append(label);
  group.dataset.ollTap = tap;
  group.dataset.label = box.text.replace(/[←→]/g, "").trim();
  return group;
}

/** The mat's fixed parts: background, columns, trays, labels and buttons. Drawn once per card. */
function create(parent: HTMLElement, raw: Record<string, unknown>): MatView {
  const plan = planBaseTenTrade(raw);
  const U = plan.unit;
  const svg = element("svg", { viewBox: `0 0 ${round(plan.width)} ${round(plan.height)}`, role: "group", "aria-label": BASE_TEN_WORDS[baseTenLanguage(raw)].matLabel }, "base-ten-mat");
  svg.append(element("rect", { x: 0, y: 0, width: round(plan.width), height: round(plan.height), rx: 12 }, "base-ten-background"));
  for (const column of plan.columns) {
    svg.append(element("rect", { x: round(column.x - 0.5 * U), y: round(plan.top - 2.4 * U), width: round(column.width + U), height: round(plan.height - plan.top + 1.9 * U), rx: 10 }, "base-ten-column"));
    const heading = element("text", { x: round(column.x + column.width / 2), y: round(plan.top - 1.1 * U), "text-anchor": "middle", "font-size": plan.fontSize }, "base-ten-heading");
    heading.textContent = column.heading;
    svg.append(heading);
  }
  const buttons: SVGGElement[] = [];
  for (const tray of plan.trays) {
    const outlineHeight = 10 * U;
    svg.append(element("rect", { x: round(tray.x - 0.25 * U), y: round(plan.top - 0.25 * U), width: round(tray.width + 0.5 * U), height: round(outlineHeight + 0.5 * U), rx: 4 }, "base-ten-tray"));
    for (let k = 1; k < 10; k += 1) {
      svg.append(tray.place === 0
        ? element("line", { x1: round(tray.x), y1: round(plan.top + k * U), x2: round(tray.x + U), y2: round(plan.top + k * U) }, "base-ten-slot")
        : element("line", { x1: round(tray.x + k * U), y1: round(plan.top), x2: round(tray.x + k * U), y2: round(plan.top + outlineHeight) }, "base-ten-slot"));
    }
    const label = element("text", { x: round(tray.zoneX + tray.zoneWidth / 2), y: round(plan.top - 1.1 * U), "text-anchor": "middle", "font-size": round(plan.fontSize * 0.85) }, "base-ten-tray-label");
    label.textContent = tray.label;
    svg.append(label);
    buttons.push(button(plan, tray.make, `make:${tray.place}`, true), button(plan, tray.break, `break:${tray.place + 1}`, false));
  }
  svg.append(...buttons);
  const units = element("g", {}, "base-ten-units");
  svg.append(units);
  parent.append(svg);
  const notice = document.createElement("div");
  notice.className = "base-ten-notice";
  notice.setAttribute("aria-live", "polite");
  const caption = document.createElement("div");
  caption.className = "base-ten-caption";
  parent.append(notice, caption);
  const columns = (raw as { columns?: unknown }).columns === 3 ? 3 : 2;
  const language = baseTenLanguage(raw);
  return { plan, columns, language, words: BASE_TEN_WORDS[language], svg, units, buttons, notice, caption, loose: [[], [], []], tray: [[], [], []], elements: new Map(), next: 0, generation: 0 };
}

/** Moves identities as the step says, then makes every place hold exactly what the mat holds. */
function reconcile(view: MatView, mat: BaseTenMat, step: BaseTenTradeViewContext["step"]): { spawn: Map<string, { x: number; y: number }>; fading: string[] } {
  const spawn = new Map<string, { x: number; y: number }>();
  const fading: string[] = [];
  const fresh = (p: number) => `${"oth"[p]}${view.next++}`;
  const outline = (p: number) => { const tray = view.plan.trays.find((candidate) => candidate.place === p)!; return { x: tray.x, y: view.plan.top }; };
  const take = (list: string[], id: string | undefined): string | undefined => {
    const index = id !== undefined ? list.indexOf(id) : -1;
    return index >= 0 ? list.splice(index, 1)[0] : list.pop();
  };
  if (step) {
    const p = step.tap.place;
    if (step.tap.kind === "gather" && view.loose[p]?.length) {
      const id = take(view.loose[p]!, step.piece);
      if (id) view.tray[p]!.push(id);
    } else if (step.tap.kind === "ungather" && view.tray[p]?.length) {
      const id = take(view.tray[p]!, step.piece);
      if (id) view.loose[p]!.push(id);
    } else if (step.tap.kind === "make" && view.tray[p]?.length === 10) {
      fading.push(...view.tray[p]!.splice(0, 10));
      const made = fresh(p + 1);
      view.loose[p + 1]!.push(made);
      spawn.set(made, outline(p));
    } else if (step.tap.kind === "break" && view.loose[p]?.length && p >= 1) {
      const broken = take(view.loose[p]!, step.piece)!;
      fading.push(broken);
      spawn.set(broken, outline(p - 1));
      for (let k = 0; k < 10; k += 1) view.tray[p - 1]!.push(fresh(p - 1));
    }
  }
  for (let p = 0; p < 3; p += 1) {
    const inTray = p < mat.columns && hasTray(mat.columns, p) ? mat.trays[p]! : 0;
    const loose = p < mat.columns ? mat.counts[p]! - inTray : 0;
    const tray = view.tray[p]!;
    const looseIds = view.loose[p]!;
    while (tray.length > inTray) looseIds.push(tray.pop()!);
    while (tray.length < inTray) tray.push(looseIds.length ? looseIds.pop()! : fresh(p));
    while (looseIds.length > loose) looseIds.pop();
    while (looseIds.length < loose) looseIds.push(fresh(p));
  }
  return { spawn, fading };
}

function update(view: MatView, raw: Record<string, unknown>, context: BaseTenTradeViewContext): void {
  // Every unit is placed below for this state, so a move an older update deferred must not run.
  const generation = ++view.generation;
  const current = () => view.generation === generation;
  const mat = baseTenMat(raw);
  const live = context.live === true;
  view.svg.classList.toggle("base-ten-mat-live", live);
  for (const target of view.buttons) setTappable(target, target.dataset.ollTap, target.dataset.label ?? "", live);
  const { spawn, fading } = reconcile(view, mat, context.step);
  const places = Array.isArray(raw.places) ? raw.places as unknown[] : [];
  const wanted = new Set<string>();
  for (let p = 0; p < view.columns; p += 1) {
    // On the board a place's `as` has become its canonical `id`; emphasis addresses that.
    const placeId = String((places[p] as { id?: unknown } | undefined)?.id ?? BASE_TEN_TRADE_PLACES[p]);
    let group = view.units.querySelector<SVGGElement>(`:scope > g.base-ten-place[data-place="${p}"]`);
    if (!group) {
      group = element("g", {}, "base-ten-place");
      group.dataset.place = String(p);
      view.units.append(group);
    }
    group.dataset.id = placeId;
    context.applyEmphasis(group, placeId);
    const positioned: Array<[string, { x: number; y: number }, boolean]> = [
      ...view.loose[p]!.map((id, i): [string, { x: number; y: number }, boolean] => [id, baseTenLooseAt(view.plan, p, i), false]),
      ...view.tray[p]!.map((id, k): [string, { x: number; y: number }, boolean] => [id, baseTenTrayAt(view.plan, p, k), true]),
    ];
    for (const [id, at, inTray] of positioned) {
      wanted.add(id);
      let unit = view.elements.get(id);
      const isNew = !unit;
      if (!unit) {
        unit = unitElement(view.plan, p, id);
        view.elements.set(id, unit);
        group.append(unit);
      }
      const wasInTray = unit.classList.contains("base-ten-in-tray");
      unit.classList.toggle("base-ten-in-tray", inTray);
      const tap = inTray ? `ungather:${p}` : hasTray(view.columns, p) ? `gather:${p}` : undefined;
      setTappable(unit, tap, (inTray ? view.words.take : view.words.put)[p]!, live);
      if (isNew) {
        const from = spawn.get(id);
        if (from) {
          // A unit made by a trade appears where the ten it replaces lay, then moves to its column.
          unit.classList.add("base-ten-appearing");
          placeAt(unit, from);
          requestAnimationFrame(() => unit!.classList.remove("base-ten-appearing"));
          setTimeout(() => { if (current()) place(unit!, at); }, FUSE_MS);
        } else if (context.step?.tap.kind === "break" && inTray) {
          // Ten units from a break appear in the tray where the broken unit lies.
          unit.classList.add("base-ten-appearing");
          placeAt(unit, at);
          setTimeout(() => unit!.classList.remove("base-ten-appearing"), FUSE_MS / 2);
        } else {
          placeAt(unit, at);
        }
      } else if (context.step) {
        place(unit, at);
        // A unit moving into or out of a tray takes no tap until it arrives: a quick second tap where the next
        // unit now lies hit the one still on its way and took it back (Learn on CI, 2026-11-22).
        if (wasInTray !== inTray) moving(unit);
      } else {
        placeAt(unit, at);
      }
    }
  }
  for (const [id, unit] of view.elements) {
    if (wanted.has(id)) continue;
    view.elements.delete(id);
    const to = spawn.get(id);
    if (context.step && fading.includes(id)) {
      // Ten in a tray fade where they lie; a broken unit first moves onto the tray below.
      if (to) place(unit, to);
      unit.classList.add("base-ten-leaving");
      setTappable(unit, undefined, "", false);
      setTimeout(() => unit.remove(), FUSE_MS + (to ? FUSE_MS : 0));
    } else {
      unit.remove();
    }
  }
  view.notice.textContent = context.notice ?? "";
  const caption = (raw as { caption?: unknown }).caption;
  view.caption.textContent = typeof caption === "string" ? caption : "";
  view.caption.hidden = !view.caption.textContent.trim();
}

/** Draws the card into an empty parent. */
export function renderBaseTenTrade(parent: HTMLElement, raw: Record<string, unknown>, context: BaseTenTradeViewContext): void {
  const view = create(parent, raw);
  views.set(parent, view);
  update(view, raw, { ...context, step: undefined });
}

/**
 * Updates a card drawn by `renderBaseTenTrade` into the same parent, keeping every unit's identity.
 * Returns false when the parent holds no such card or its columns changed; the caller then redraws it.
 */
export function updateBaseTenTrade(parent: HTMLElement, raw: Record<string, unknown>, context: BaseTenTradeViewContext): boolean {
  const view = views.get(parent);
  if (!view || !view.svg.isConnected || view.columns !== ((raw as { columns?: unknown }).columns === 3 ? 3 : 2) || view.language !== baseTenLanguage(raw)) return false;
  update(view, raw, context);
  return true;
}
