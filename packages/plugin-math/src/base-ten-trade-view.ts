/**
 * Draws a `base_ten_trade` card (decision 0023) as SVG from its plan (base-ten-trade.ts): a place-value
 * mat with columns named in words, a tray of ten between each place and the next, and the units. No
 * number is drawn: the learner counts. Values come from the content with bindings already applied.
 *
 * Every element a learner can tap carries `data-oll-tap` ("gather:0", "make:0", "break:1", …); the board
 * turns a tap into the card's tap rules. When the card is not live (the lesson is playing, or no open
 * task lets the learner tap it) the same picture is drawn without tap cues.
 */
import {
  BASE_TEN_TRADE_PLACES, baseTenLooseAt, baseTenMat, baseTenTrayAt, hasTray, planBaseTenTrade,
  type BaseTenTradePlan,
} from "./base-ten-trade.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface BaseTenTradeViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** True while an open task lets the learner tap this card. */
  live?: boolean;
  /** A one-line message under the mat (a refused tap's reason). */
  notice?: string;
}

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (classes.length) node.classList.add(...classes);
  return node;
}

const round = (value: number) => Math.round(value * 100) / 100;
const UNIT_NAMES = ["one", "ten", "hundred"] as const;

function tappable(target: SVGElement, tap: string, label: string, live: boolean): void {
  target.dataset.ollTap = tap;
  if (!live) return;
  target.classList.add("base-ten-live");
  target.setAttribute("tabindex", "0");
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", label);
}

/** One unit: a one is a square, a ten a rod of ten squares, a hundred a flat of ten rods. */
function unitElement(plan: BaseTenTradePlan, place: number, x: number, y: number): SVGGElement {
  const U = plan.unit;
  const width = place === 2 ? 10 * U : U;
  const height = place === 0 ? U : 10 * U;
  const group = element("g", { transform: `translate(${round(x)} ${round(y)})` }, "base-ten-unit");
  group.dataset.place = String(place);
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

function button(plan: BaseTenTradePlan, box: { x: number; y: number; width: number; height: number; text: string }, tap: string, primary: boolean, live: boolean): SVGGElement {
  const group = element("g", {}, "base-ten-button", primary ? "base-ten-button-primary" : "base-ten-button-quiet");
  group.append(element("rect", { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height), rx: round(box.height / 2) }));
  const label = element("text", { x: round(box.x + box.width / 2), y: round(box.y + box.height / 2), "text-anchor": "middle", "dominant-baseline": "central", "font-size": plan.fontSize });
  label.textContent = box.text;
  group.append(label);
  tappable(group, tap, box.text.replace(/[←→]/g, "").trim(), live);
  return group;
}

export function renderBaseTenTrade(parent: HTMLElement, raw: Record<string, unknown>, context: BaseTenTradeViewContext): void {
  const plan = planBaseTenTrade(raw);
  const mat = baseTenMat(raw);
  const live = context.live === true;
  const U = plan.unit;
  const places = Array.isArray(raw.places) ? raw.places as unknown[] : [];
  const svg = element("svg", { viewBox: `0 0 ${round(plan.width)} ${round(plan.height)}`, role: "group", "aria-label": "A place-value mat" }, "base-ten-mat");
  if (live) svg.classList.add("base-ten-mat-live");
  svg.append(element("rect", { x: 0, y: 0, width: round(plan.width), height: round(plan.height), rx: 12 }, "base-ten-background"));
  for (const column of plan.columns) {
    svg.append(element("rect", { x: round(column.x - 0.5 * U), y: round(plan.top - 2.4 * U), width: round(column.width + U), height: round(plan.height - plan.top + 1.9 * U), rx: 10 }, "base-ten-column"));
    const heading = element("text", { x: round(column.x + column.width / 2), y: round(plan.top - 1.1 * U), "text-anchor": "middle", "font-size": plan.fontSize }, "base-ten-heading");
    heading.textContent = column.heading;
    svg.append(heading);
  }
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
    svg.append(button(plan, tray.make, `make:${tray.place}`, true, live));
    svg.append(button(plan, tray.break, `break:${tray.place + 1}`, false, live));
  }
  for (let p = 0; p < mat.columns; p += 1) {
    const inTray = hasTray(mat.columns, p) ? mat.trays[p]! : 0;
    const looseCount = mat.counts[p]! - inTray;
    const group = element("g", {}, "base-ten-place");
    // On the board a place's `as` has become its canonical `id`; emphasis addresses that.
    const placeId = String((places[p] as { id?: unknown } | undefined)?.id ?? BASE_TEN_TRADE_PLACES[p]);
    group.dataset.id = placeId;
    for (let i = 0; i < looseCount; i += 1) {
      const at = baseTenLooseAt(plan, p, i);
      const unit = unitElement(plan, p, at.x, at.y);
      if (hasTray(mat.columns, p)) tappable(unit, `gather:${p}`, `Put this ${UNIT_NAMES[p]} in the tray`, live);
      group.append(unit);
    }
    for (let k = 0; k < inTray; k += 1) {
      const at = baseTenTrayAt(plan, p, k);
      const unit = unitElement(plan, p, at.x, at.y);
      unit.classList.add("base-ten-in-tray");
      tappable(unit, `ungather:${p}`, `Take this ${UNIT_NAMES[p]} out of the tray`, live);
      group.append(unit);
    }
    context.applyEmphasis(group, placeId);
    svg.append(group);
  }
  parent.append(svg);
  const notice = document.createElement("div");
  notice.className = "base-ten-notice";
  notice.setAttribute("aria-live", "polite");
  notice.textContent = context.notice ?? "";
  parent.append(notice);
  const caption = (raw as { caption?: unknown }).caption;
  if (typeof caption === "string" && caption.trim()) {
    const div = document.createElement("div");
    div.className = "base-ten-caption";
    div.textContent = caption;
    parent.append(div);
  }
}
