/**
 * Draws a `number_line` card (decision 0013) as SVG. The board passes in its
 * emphasis helpers, so parts are marked like every other card's parts
 * (`data-id`). Values come from the content as the board state holds it, with
 * bindings already applied.
 */
import {
  jumpEnds, jumpHops, numberLineValue, planNumberLineTicks, planTickLabels, planTickStep, stackLabels,
  type NumberLineContent, type NumberLineJump, type NumberLinePoint, type NumberLineInterval, type TickLabel,
} from "./number-line.js";
import { evaluateMathExpression, referencedMathVariables } from "../../core/src/math-expression.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export const NUMBER_LINE_VIEW_WIDTH = 520;
const SIDE = 30;

export interface NumberLineViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** The lesson's variables with their ranges, so a moving card can size itself for every reachable state. */
  variables?: Readonly<Record<string, { value: number; initial: number; min: number; max: number }>>;
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

/** About how wide a point's name is drawn (12px; a CJK character is about 13 units). */
const textWidth = (text: string) => [...text].reduce((width, char) => width + (char.codePointAt(0)! >= 0x2e80 ? 13 : 7.2), 0);

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

/**
 * Lanes for jump arcs: each jump goes one lane above the highest earlier jump whose span it overlaps
 * (sharing an end is not overlapping), so later moves sit above earlier ones in reading order.
 * Zero-length jumps are not drawn and take lane 0.
 */
function planJumpLanes(content: NumberLineContent, jumps: readonly unknown[]): number[] {
  const placed: Array<{ low: number; high: number; tier: number }> = [];
  return jumps.map((jump) => {
    const ends = jumpEnds(content, jump as NumberLineJump);
    if (!ends || ends.from === ends.to) return 0;
    const low = Math.min(ends.from, ends.to), high = Math.max(ends.from, ends.to);
    const overlapped = placed.filter((other) => low < other.high - 1e-9 && other.low < high - 1e-9);
    const tier = overlapped.length ? Math.max(...overlapped.map((other) => other.tier)) + 1 : 0;
    placed.push({ low, high, tier });
    return tier;
  });
}

/** Lane counts already worked out, by the card's unbound parts, bindings and variable ranges. */
const reachableLaneCache = new Map<string, number>();

/**
 * The most lanes a bound card needs over the states its variables can reach. Each variable its bindings
 * read is sampled at its minimum, maximum and starting value and on an even grid between them, since
 * two jumps can overlap only in the middle of a slider (a short jump dragged past a fixed one). The grid
 * is as fine as about a thousand states allow (33 steps for one variable, 2 for four); an overlap
 * narrower than a grid step can still be missed, and the card then grows while it lasts. Without the
 * variables' ranges, a moving card with several jumps reserves one lane per jump.
 */
function reachableLaneCount(content: NumberLineContent, variables: NumberLineViewContext["variables"]): number {
  const jumps = content.jumps ?? [];
  const bindings = (content.bindings ?? []) as Array<{ target?: unknown; expression?: unknown }>;
  if (!variables) return jumps.length;
  const names = Object.keys(variables);
  const referenced = [...new Set(bindings.flatMap((binding) => typeof binding.expression === "string" ? referencedMathVariables(binding.expression, names) : []))];
  const sampled = referenced.slice(0, 4);
  const targetOf = (state: Record<string, unknown>, target: string) => {
    const separator = target.lastIndexOf(".");
    const id = target.slice(0, separator);
    const part = (["points", "jumps", "intervals"] as const).flatMap((field) => (state[field] ?? []) as Array<Record<string, unknown>>)
      .find((item) => item.id === id || item.as === id);
    return part ? { part, property: target.slice(separator + 1) } : undefined;
  };
  // Every sampled state overwrites the bound fields, so their current values do not change the answer:
  // a card re-rendered while its variable moves reuses it.
  const unbound = structuredClone({ points: content.points ?? [], jumps }) as unknown as Record<string, unknown>;
  for (const binding of bindings) {
    const found = typeof binding.target === "string" ? targetOf(unbound, binding.target) : undefined;
    if (found) delete found.part[found.property];
  }
  const key = JSON.stringify([unbound, bindings, sampled.map((name) => [name, variables[name]!.min, variables[name]!.max, variables[name]!.initial]),
    referenced.slice(4).map((name) => [name, variables[name]!.value])]);
  const cached = reachableLaneCache.get(key);
  if (cached !== undefined) return cached;
  const steps = sampled.length ? Math.min(33, Math.max(1, Math.floor(1024 ** (1 / sampled.length)) - 3)) : 0;
  let combinations: Array<Record<string, number>> = [Object.fromEntries(names.map((name) => [name, variables[name]!.value]))];
  for (const name of sampled) {
    const { min, max, initial } = variables[name]!;
    const grid = Array.from({ length: steps }, (_, index) => min + (max - min) * (index + 1) / (steps + 1));
    combinations = combinations.flatMap((combination) => [...new Set([min, max, initial, ...grid])].map((v) => ({ ...combination, [name]: v })));
  }
  let most = 1;
  for (const values of combinations) {
    const state = structuredClone(content) as NumberLineContent & Record<string, unknown>;
    let defined = true;
    for (const binding of bindings) {
      if (typeof binding.target !== "string" || typeof binding.expression !== "string") continue;
      const found = targetOf(state, binding.target);
      if (!found) continue;
      try { found.part[found.property] = evaluateMathExpression(binding.expression, values); } catch { defined = false; }
    }
    if (defined) most = Math.max(most, ...planJumpLanes(state, state.jumps ?? []).map((lane) => lane + 1));
  }
  if (reachableLaneCache.size >= 64) reachableLaneCache.delete(reachableLaneCache.keys().next().value!);
  reachableLaneCache.set(key, most);
  return most;
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
  // Moving cards keep one geometry (below), so the arc zone is sized from the card's parts.
  const moving = points.some((point) => (point as NumberLinePoint).interaction) || (content.bindings ?? []).length > 0;
  // A jump whose span overlaps an earlier jump's (up 6, down 4, up 3) goes on a higher lane: a raised
  // baseline with dashed leaders down to its start and end, so no arc crosses another and each label sits
  // over its own arc (0017). Raising the arc alone is not enough: a later jump ending inside an earlier
  // one's span crosses it. Chained jumps in one direction only touch at their ends and share lane 0.
  const jumpLanes = planJumpLanes(content, jumps);
  const laneCount = Math.max(1, ...jumpLanes.map((lane) => lane + 1));
  // A static card is as tall as its lanes. A moving card reserves the most lanes any state can need: a
  // reversing jump appears only once its change grows from 0, and the card must not grow then.
  const reservedLanes = moving && jumps.length > 1 ? Math.max(laneCount, reachableLaneCount(content, context.variables)) : laneCount;
  const JUMP_LANE = 36, LANE_ARC = 22;
  const jumpZone = !jumps.length ? 0 : reservedLanes === 1 ? 58 : 44 + (reservedLanes - 1) * JUMP_LANE;
  const intervalZone = intervals.some((interval) => interval.label) ? 20 : 0;
  // Point labels sit above the line unless jump arcs are there; below, they clear the tick labels.
  const labelsAbove = jumps.length === 0;
  const labelledPoints = points.some((point) => point.label);
  const x0 = SIDE, x1 = NUMBER_LINE_VIEW_WIDTH - SIDE;
  const mapX = (value: number) => x0 + (value - min) / (max - min) * (x1 - x0);
  // Point names that would overlap (Start and End a quarter apart) go on further rows, away from the line.
  // A card whose points move (bound or dragged) keeps one geometry in every state: it reserves the
  // rows its labels could need, so the axis never jumps under the pointer and the card never resizes.
  const named = points.flatMap((point) => { const value = numberLineValue(point.value); return point.label && value !== undefined ? [{ point, x: mapX(value), width: textWidth(point.label) }] : []; });
  const nameRows = new Map(stackLabels(named).map((row, index) => [named[index]!.point, row]));
  const nameRowCount = Math.max(1, ...[...nameRows.values()].map((row) => row + 1), moving ? named.length : 1);
  const nameRowHeight = 16;
  const lineY = 18 + jumpZone + intervalZone + (labelsAbove && labelledPoints ? 24 + (nameRowCount - 1) * nameRowHeight : 0);
  // Labels thin out on a regular stride when they would overlap, but the values the card marks
  // (points the learner sees, and where jumps start and end) keep theirs, on extra rows if needed.
  // A point shown only when emphasized is an answer kept back: its value is never pinned, even where a jump ends.
  const latent = points.filter((point) => point.shown === "when_emphasized").map((point) => numberLineValue(point.value));
  const marked = [
    ...points.filter((point) => point.shown !== "when_emphasized").map((point) => numberLineValue(point.value)),
    ...jumps.flatMap((jump) => { const ends = jumpEnds(content, jump as NumberLineJump); return ends ? [ends.from, ends.to] : []; }),
    // An interval's or a ray's ends are the boundary of a solution set: their numbers stay too (0016).
    ...intervals.flatMap((interval) => [interval.from, interval.to].filter((end) => end !== null).map((end) => numberLineValue(end as never))),
  ].filter((value): value is number => value !== undefined && !latent.some((hidden) => hidden !== undefined && Math.abs(hidden - value) < 1e-9));
  const labelled = ticks.filter((tick) => tick.label);
  const labelPlan = planTickLabels(labelled.map((tick) => ({ x: mapX(tick.value), width: tickLabelWidth(tick.label!), major: tick.major, value: tick.value })), planTickStep(content), marked);
  const labelRow = new Map([...labelPlan.shown].map((index) => [labelled[index]!.value, labelPlan.rows.get(index) ?? 0]));
  const rowHeight = fractions ? 32 : 18;
  // As many rows as there could be marked numbers in any state, counted from the card's parts, never
  // from their current values (review of #51: a jump whose end has no point of its own separates from
  // its start as its change grows from 0, and the card grew mid-animation): one per visible point, and
  // one per jump end, plus its start unless that is one of the points.
  const visiblePoints = points.filter((point) => point.shown !== "when_emphasized").length;
  const jumpMarks = jumps.reduce((count, jump) => count + 1
    + (typeof jump.from === "string" && points.some((point) => point.as === jump.from) ? 0 : 1), 0);
  const intervalMarks = intervals.reduce((count, interval) => count + (interval.from === null ? 0 : 1) + (interval.to === null ? 0 : 1), 0);
  // At most two of them can crowd one label's width at once in practice (a point next to a jump's end);
  // reserving a row for every part left a rounding line's four points and jump with five empty rows
  // (decision 0016). A rarer state that needs a third row grows the card when it happens.
  const tickRows = moving && labelPlan.thinned ? Math.max(labelPlan.rowCount, Math.min(2, visiblePoints + jumpMarks + intervalMarks)) : labelPlan.rowCount;
  const tickLabelHeight = rowHeight * tickRows;
  const pointLabelY = labelsAbove ? lineY - 16 : lineY + 14 + tickLabelHeight + 14;
  const height = (labelsAbove || !labelledPoints ? lineY + 14 + tickLabelHeight : pointLabelY + (nameRowCount - 1) * nameRowHeight) + 8;

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

  // Every tick is drawn, before the intervals, so no tick runs through an interval's open end; its label
  // only when the plan above keeps it.
  for (const tick of ticks) {
    const x = mapX(tick.value);
    svg.append(element("line", { x1: x, x2: x, y1: lineY - (tick.major ? 8 : 5), y2: lineY + (tick.major ? 8 : 5) }, tick.major ? "number-line-tick" : "number-line-tick number-line-tick-minor"));
    const row = labelRow.get(tick.value);
    if (tick.label && row !== undefined) tickLabel(svg, tick.label, x, lineY + 10 + row * rowHeight);
  }

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
      // Above the point names when they sit above the line, so the two never overlap (0016).
      const labelY = labelsAbove && labelledPoints ? lineY - 16 - nameRowCount * nameRowHeight - 2 : lineY - 12;
      const text = element("text", { x: (Math.max(start, x0) + Math.min(end, x1)) / 2, y: labelY, "text-anchor": "middle" }, "number-line-interval-label");
      text.textContent = interval.label;
      group.append(text);
    }
    context.applyEmphasis(group, idOf(interval as Part));
    svg.append(group);
  }

  for (const jump of jumps) {
    const ends = jumpEnds(content, jump as NumberLineJump);
    if (!ends || ends.from === ends.to) continue;
    const group = element("g", {}, "number-line-jump");
    group.dataset.id = idOf(jump as Part);
    // Lane 0 stands on the line; higher lanes on a raised baseline. Hops stand on the line, under any arc
    // over them, so a jump on a higher lane is one arc even when it has hops.
    const lane = jumpLanes[jumps.indexOf(jump)] ?? 0;
    const hops = Boolean(jump.hops) && lane === 0;
    const base = lineY - 4 - lane * JUMP_LANE;
    // Whole hops, then a shorter last one when a variable stops between ticks: the arrow ends at ends.to.
    const pieces = jumpHops(content, ends, hops);
    const span = (piece: { from: number; to: number }) => Math.abs(mapX(piece.to) - mapX(piece.from));
    const natural = hops ? 18 : Math.min(46, 14 + span(ends) / 5);
    // With lanes, every arc stays low enough to clear the lane above it. The cap follows the reserved
    // lanes, so an arc keeps its height when a reversing jump appears.
    const hopHeight = reservedLanes > 1 ? Math.min(natural, LANE_ARC) : natural;
    pieces.forEach((piece, index) => {
      const a = mapX(piece.from), b = mapX(piece.to);
      // A short last hop is lower, in proportion to its length.
      const height = hops && pieces.length > 1 && index === pieces.length - 1 ? hopHeight * Math.min(1, span(piece) / span(pieces[0]!)) : hopHeight;
      const path = element("path", { d: `M${a},${base} Q${(a + b) / 2},${base - height * 2} ${b},${base}` }, "number-line-jump-arc");
      if (index === pieces.length - 1 && lane === 0) path.setAttribute("marker-end", arrow);
      group.append(path);
    });
    if (lane > 0) {
      // Leaders tie a raised arc to the line: plain at its start, with the arrow at its end.
      group.append(element("line", { x1: mapX(ends.from), x2: mapX(ends.from), y1: base, y2: lineY - 4 }, "number-line-jump-leader"));
      const leader = element("line", { x1: mapX(ends.to), x2: mapX(ends.to), y1: base, y2: lineY - 6 }, "number-line-jump-leader");
      leader.setAttribute("marker-end", arrow);
      group.append(leader);
    }
    if (jump.label) {
      const text = element("text", { x: (mapX(ends.from) + mapX(ends.to)) / 2, y: base - 4 - hopHeight - 4, "text-anchor": "middle" }, "number-line-jump-label");
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
      const row = nameRows.get(point) ?? 0;
      const y = labelsAbove ? pointLabelY - row * nameRowHeight : pointLabelY + row * nameRowHeight;
      const text = element("text", { x, y, "text-anchor": "middle" }, "number-line-point-label");
      text.textContent = point.label;
      if (!labelsAbove) group.append(element("line", { x1: x, x2: x, y1: lineY + 8, y2: y - 12 }, "number-line-point-leader"));
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
