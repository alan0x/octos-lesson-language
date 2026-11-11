/**
 * Draws a `number_line` card (decision 0013) as SVG. The board passes in its
 * emphasis helpers, so parts are marked like every other card's parts
 * (`data-id`). Values come from the content as the board state holds it, with
 * bindings already applied.
 */
import {
  jumpEnds, numberLineValue, planNumberLineTicks, planTickStep, tickUnit, visibleTickLabels,
  type NumberLineContent, type NumberLineJump, type NumberLinePoint, type NumberLineInterval, type TickLabel,
} from "./number-line.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export const NUMBER_LINE_VIEW_WIDTH = 520;
const SIDE = 30;

export interface NumberLineViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
}

type Part = { id?: string; as?: string };
const idOf = (part: Part) => String(part.id ?? part.as ?? "");

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  const names = classes.flatMap((name) => name.split(/\s+/u)).filter(Boolean);
  if (names.length) node.classList.add(...names);
  return node;
}

function label(svg: SVGSVGElement, value: string, x: number, y: number, className: string, anchor = "middle"): SVGTextElement {
  const node = element("text", { x, y, "text-anchor": anchor }, className);
  node.textContent = value;
  svg.append(node);
  return node;
}

/** About how wide a tick label is drawn (12px labels, about 7 board units per character). */
function tickLabelWidth(tick: TickLabel): number {
  if (tick.kind === "text") return tick.text.length * 7.2;
  const fraction = Math.max(String(tick.numerator).length, String(tick.denominator).length) * 7 + 4;
  const whole = tick.whole !== undefined ? String(tick.whole).length * 7.2 + 4 : 0;
  return fraction + whole + (tick.negative ? 8 : 0);
}

/** A tick label; a fraction is drawn stacked, with its whole part to the left. Returns its height below y. */
function tickLabel(svg: SVGSVGElement, tick: TickLabel, x: number, y: number): void {
  if (tick.kind === "text") { label(svg, tick.text, x, y + 12, "number-line-tick-label"); return; }
  const top = String(tick.numerator), bottom = String(tick.denominator);
  const width = Math.max(top.length, bottom.length) * 7 + 4;
  const offset = tick.whole !== undefined ? 6 : 0;
  const sign = tick.negative ? "−" : "";
  if (tick.whole !== undefined || sign) label(svg, `${sign}${tick.whole ?? ""}`, x - width / 2 + offset - 2, y + 18, "number-line-tick-label", "end");
  label(svg, top, x + offset, y + 10, "number-line-tick-label number-line-fraction");
  svg.append(element("line", { x1: x + offset - width / 2, x2: x + offset + width / 2, y1: y + 14, y2: y + 14 }, "number-line-fraction-bar"));
  label(svg, bottom, x + offset, y + 26, "number-line-tick-label number-line-fraction");
}

/** The SVG for a number line, with its parts marked for emphasis and dragging. */
export function renderNumberLine(parent: HTMLElement, raw: Record<string, unknown>, context: NumberLineViewContext): void {
  const content = raw as unknown as NumberLineContent;
  const { min, max } = content.range;
  const ticks = planNumberLineTicks(content);
  const fractions = ticks.some((tick) => tick.label?.kind === "fraction");
  const jumps = content.jumps ?? [];
  const intervals = content.intervals ?? [];
  const points = content.points ?? [];
  const jumpZone = jumps.length ? 58 : 0;
  const intervalZone = intervals.some((interval) => interval.label) ? 20 : 0;
  // Point labels sit above the line unless jump arcs are there; below, they clear the tick labels.
  const labelsAbove = jumps.length === 0;
  const labelledPoints = points.some((point) => point.label);
  const lineY = 18 + jumpZone + intervalZone + (labelsAbove && labelledPoints ? 24 : 0);
  const tickLabelHeight = fractions ? 32 : 18;
  const pointLabelY = labelsAbove ? lineY - 16 : lineY + 14 + tickLabelHeight + 14;
  const height = (labelsAbove || !labelledPoints ? lineY + 14 + tickLabelHeight : pointLabelY) + 8;
  const x0 = SIDE, x1 = NUMBER_LINE_VIEW_WIDTH - SIDE;
  const mapX = (value: number) => x0 + (value - min) / (max - min) * (x1 - x0);

  const svg = element("svg", { viewBox: `0 0 ${NUMBER_LINE_VIEW_WIDTH} ${height}`, role: "img" }, "number-line-preview");
  const defs = element("defs", {});
  const marker = element("marker", { id: `number-line-arrow-${Math.random().toString(36).slice(2, 9)}`, markerUnits: "userSpaceOnUse", markerWidth: 11, markerHeight: 11, refX: 8, refY: 5, orient: "auto" });
  marker.append(element("path", { d: "M0,0 L10,5 L0,10 Z" }, "number-line-arrowhead"));
  defs.append(marker);
  svg.append(defs);
  const arrow = `url(#${marker.id})`;

  // The line, with arrows showing it goes on past both ends.
  svg.append(element("line", { x1: x0 - 18, x2: x1 + 18, y1: lineY, y2: lineY }, "number-line-axis"));
  svg.append(element("path", { d: `M${x1 + 18},${lineY} l-7,-5 m7,5 l-7,5 M${x0 - 18},${lineY} l7,-5 m-7,5 l7,5` }, "number-line-axis"));

  for (const interval of intervals) {
    const from = interval.from === null ? undefined : numberLineValue(interval.from);
    const to = interval.to === null ? undefined : numberLineValue(interval.to);
    const start = from === undefined ? x0 - 18 : mapX(from), end = to === undefined ? x1 + 18 : mapX(to);
    const group = element("g", {}, "number-line-interval");
    group.dataset.id = idOf(interval as Part);
    group.append(element("line", { x1: start, x2: end, y1: lineY, y2: lineY }, "number-line-interval-bar"));
    if (from === undefined) group.append(element("path", { d: `M${start},${lineY} l9,-6 m-9,6 l9,6` }, "number-line-interval-bar"));
    if (to === undefined) group.append(element("path", { d: `M${end},${lineY} l-9,-6 m9,6 l-9,6` }, "number-line-interval-bar"));
    for (const [value, closed] of [[from, interval.from_closed ?? true], [to, interval.to_closed ?? true]] as const) {
      if (value === undefined) continue;
      group.append(element("circle", { cx: mapX(value), cy: lineY, r: 6 }, closed ? "number-line-end-closed" : "number-line-end-open"));
    }
    if (interval.label) {
      const text = element("text", { x: (Math.max(start, x0) + Math.min(end, x1)) / 2, y: lineY - 12, "text-anchor": "middle" }, "number-line-interval-label");
      text.textContent = interval.label;
      group.append(text);
    }
    context.applyEmphasis(group, idOf(interval as Part));
    svg.append(group);
  }

  // Every tick is drawn; labels thin out on a regular stride when they would overlap.
  const labelled = ticks.filter((tick) => tick.label);
  const shown = visibleTickLabels(labelled.map((tick) => ({ x: mapX(tick.value), width: tickLabelWidth(tick.label!), major: tick.major, value: tick.value })), planTickStep(content));
  const shownValues = new Set([...shown].map((index) => labelled[index]!.value));
  for (const tick of ticks) {
    const x = mapX(tick.value);
    svg.append(element("line", { x1: x, x2: x, y1: lineY - (tick.major ? 8 : 5), y2: lineY + (tick.major ? 8 : 5) }, tick.major ? "number-line-tick" : "number-line-tick number-line-tick-minor"));
    if (tick.label && shownValues.has(tick.value)) tickLabel(svg, tick.label, x, lineY + 10);
  }

  for (const jump of jumps) {
    const ends = jumpEnds(content, jump as NumberLineJump);
    if (!ends || ends.from === ends.to) continue;
    const group = element("g", {}, "number-line-jump");
    group.dataset.id = idOf(jump as Part);
    const unit = tickUnit(content);
    const hops = jump.hops ? Math.round(Math.abs(ends.to - ends.from) / unit) : 1;
    const direction = Math.sign(ends.to - ends.from);
    const hopHeight = hops > 1 ? 18 : Math.min(46, 14 + Math.abs(mapX(ends.to) - mapX(ends.from)) / 5);
    for (let hop = 0; hop < hops; hop += 1) {
      const a = mapX(ends.from + direction * hop * (hops > 1 ? unit : Math.abs(ends.to - ends.from)));
      const b = hops > 1 ? mapX(ends.from + direction * (hop + 1) * unit) : mapX(ends.to);
      const path = element("path", { d: `M${a},${lineY - 4} Q${(a + b) / 2},${lineY - 4 - hopHeight * 2} ${b},${lineY - 4}` }, "number-line-jump-arc");
      if (hop === hops - 1) path.setAttribute("marker-end", arrow);
      group.append(path);
    }
    if (jump.label) {
      const text = element("text", { x: (mapX(ends.from) + mapX(ends.to)) / 2, y: lineY - 8 - hopHeight - 4, "text-anchor": "middle" }, "number-line-jump-label");
      text.textContent = jump.label;
      group.append(text);
    }
    context.applyEmphasis(group, idOf(jump as Part));
    svg.append(group);
  }

  for (const point of points) {
    const value = numberLineValue(point.value);
    if (value === undefined) continue;
    const x = mapX(value);
    const group = element("g", {}, "number-line-point", point.shown === "when_emphasized" ? "number-line-latent" : "");
    group.dataset.id = idOf(point as Part);
    group.append(element("circle", { cx: x, cy: lineY, r: 6.5 }, point.style === "open" ? "number-line-dot-open" : "number-line-dot"));
    if (point.label) {
      const text = element("text", { x, y: pointLabelY, "text-anchor": "middle" }, "number-line-point-label");
      text.textContent = point.label;
      if (!labelsAbove) group.append(element("line", { x1: x, x2: x, y1: lineY + 8, y2: pointLabelY - 12 }, "number-line-point-leader"));
      group.append(text);
    }
    const variable = (point as NumberLinePoint).interaction?.variable;
    if (variable) {
      // The board's pointer handler turns a drag into a value on the smallest-tick grid.
      const handle = element("circle", { cx: x, cy: lineY, r: 14 }, "number-line-drag-handle");
      Object.assign(handle.dataset, {
        ollVariableControl: variable, ollControlKind: "number_line_point",
        lineX0: String(x0), lineX1: String(x1), lineMin: String(min), lineMax: String(max),
        lineTicks: JSON.stringify({ range: content.range, ticks: content.ticks ?? {} }),
      });
      group.classList.add("number-line-draggable");
      group.append(handle);
    }
    context.applyEmphasis(group, idOf(point as Part));
    svg.append(group);
  }
  parent.append(svg);
  if (content.caption) {
    const caption = document.createElement("div");
    caption.className = "number-line-caption";
    caption.textContent = content.caption;
    parent.append(caption);
  }
}

export type { NumberLineInterval };
