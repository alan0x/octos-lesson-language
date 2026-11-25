/**
 * Draws a `number_line` card (decision 0013) as SVG. The board passes in its
 * emphasis helpers, so parts are marked like every other card's parts
 * (`data-id`). Values come from the content as the board state holds it, with
 * bindings already applied.
 *
 * The card has its own zoom (decision 0024): "−", "+" and "whole line" buttons,
 * and a strip under the line showing the part in view. The board routes the
 * wheel, pinches and drags on the zoomed line to it (`numberLineZoomControl`),
 * and keeps the window across redraws (`zoom` in the context).
 */
import {
  clampNumberLineWindow, isZoomedWindow, jumpEnds, jumpHops, numberLineValue, numberLineZoomCentre, numberLineZoomLimits, NUMBER_LINE_ZOOM,
  panNumberLineWindow, planJumpLanes, planNumberLineTicks, planTickLabels, planTickStep, stackLabels, thinNumberLineTicks, tickUnit, zoomNumberLineWindow,
  type NumberLineContent, type NumberLineJump, type NumberLinePoint, type NumberLineInterval, type NumberLineWindow, type PlannedTick, type TickLabel,
} from "./number-line.js";
import { evaluateMathExpression, referencedMathVariables } from "../../core/src/math-expression.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export const NUMBER_LINE_VIEW_WIDTH = 520;
const SIDE = 30;

export interface NumberLineViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** The lesson's variables with their ranges, so a moving card can size itself for every reachable state. */
  variables?: Readonly<Record<string, { value: number; initial: number; min: number; max: number; control?: { step?: number } }>>;
  /**
   * The window the learner zoomed to, kept by the board across redraws, and how the card tells the board
   * the learner zoomed or moved the line (undefined: the whole line). Without it the card still zooms,
   * until it is drawn again.
   */
  zoom?: { window?: NumberLineWindow; change(window: NumberLineWindow | undefined): void };
  /**
   * Sets the card's own UI text (its buttons) in the board's language: `apply` is called with a function
   * from the Chinese source text to the text to show, now and again when the language changes.
   */
  localize?(element: Element, apply: (text: (source: string) => string) => void): void;
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

function label(svg: Element, value: string, x: number, y: number, className: string, anchor = "middle"): SVGTextElement {
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

/** Lane counts already worked out, by the card's unbound parts, bindings and variable ranges. */
const reachableLaneCache = new Map<string, number>();

/**
 * The most lanes a bound card needs over the states its variables can reach. Two jumps can overlap only in
 * the middle of a slider (a short jump dragged past a fixed one), so each variable its bindings read is
 * sampled at every stop it can rest on (its slider step, or the smallest tick for a point dragged on this
 * card) when there are few enough, else at its ends, its start and an even grid between them. About a
 * thousand states in all: every stop of one variable up to 1,000 (32 each for two, 10 for three, 5 for
 * four). An overlap narrower than both a stop and a grid step can still be missed, while the value passes
 * between stops in an animation, and the card then grows while it lasts. Without the variables' ranges, a
 * moving card with several jumps reserves one lane per jump.
 */
function reachableLaneCount(content: NumberLineContent, variables: NumberLineViewContext["variables"]): number {
  const jumps = content.jumps ?? [];
  const bindings = (content.bindings ?? []) as Array<{ target?: unknown; expression?: unknown }>;
  if (!variables) return jumps.length;
  const names = Object.keys(variables);
  const referenced = [...new Set(bindings.flatMap((binding) => typeof binding.expression === "string" ? referencedMathVariables(binding.expression, names) : []))];
  const sampled = referenced.slice(0, 4);
  const dragged = new Set((content.points ?? []).flatMap((point) => point.interaction ? [point.interaction.variable] : []));
  const stopOf = (name: string) => dragged.has(name) ? tickUnit(content) : variables[name]!.control?.step;
  const targetOf = (state: Record<string, unknown>, target: string) => {
    const separator = target.lastIndexOf(".");
    const id = target.slice(0, separator);
    const part = (["points", "jumps", "intervals"] as const).flatMap((field) => (state[field] ?? []) as Array<Record<string, unknown>>)
      .find((item) => item.id === id || item.as === id);
    return part ? { part, property: target.slice(separator + 1) } : undefined;
  };
  // The key holds only what lanes depend on, without the bound values (every sampled state overwrites
  // them) or labels (a bound label changes as its value moves), so renders while a variable moves reuse it.
  const unbound: Record<string, unknown> = {
    points: (content.points ?? []).map((point) => ({ id: (point as { id?: string }).id, as: point.as, value: point.value })),
    jumps: jumps.map((jump) => ({ id: (jump as { id?: string }).id, as: jump.as, from: jump.from, by: jump.by })),
  };
  for (const binding of bindings) {
    const found = typeof binding.target === "string" ? targetOf(unbound, binding.target) : undefined;
    if (found) delete found.part[found.property];
  }
  const key = JSON.stringify([unbound, bindings.map((binding) => [binding.target, binding.expression]), content.range, content.ticks,
    sampled.map((name) => [name, variables[name]!.min, variables[name]!.max, variables[name]!.initial, stopOf(name)]),
    referenced.slice(4).map((name) => [name, variables[name]!.value])]);
  const cached = reachableLaneCache.get(key);
  if (cached !== undefined) return cached;
  const perVariable = sampled.length ? Math.min(1000, Math.floor(1024 ** (1 / sampled.length) + 1e-9)) : 0;
  let combinations: Array<Record<string, number>> = [Object.fromEntries(names.map((name) => [name, variables[name]!.value]))];
  for (const name of sampled) {
    const { min, max, initial } = variables[name]!;
    const stop = stopOf(name);
    const stops = stop && stop > 0 ? Math.floor((max - min) / stop + 1e-9) + 1 : Infinity;
    const values = stops + 2 <= perVariable
      ? Array.from({ length: stops }, (_, index) => min + index * stop!)
      : Array.from({ length: Math.max(1, perVariable - 3) }, (_, index) => min + (max - min) * (index + 1) / (Math.max(1, perVariable - 3) + 1));
    combinations = combinations.flatMap((combination) => [...new Set([min, max, initial, ...values])].map((v) => ({ ...combination, [name]: v })));
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

/** Board units from the line's last row to the overview strip's middle, and below it. */
const STRIP_GAP = 12, STRIP_BELOW = 10;

/** Where a number line card draws everything, for one window of its range (decision 0024). */
export interface NumberLineCardPlan {
  /** The window drawn; the whole range when not zoomed. */
  window: NumberLineWindow;
  zoomed: boolean;
  x0: number; x1: number;
  mapX(value: number): number;
  inView(value: number): boolean;
  lineY: number; height: number;
  /** The ticks drawn (thinned, in the window) and the label row of each labelled one. */
  ticks: PlannedTick[]; labelRow: Map<number, number>; rowHeight: number;
  /** The stride, in smallest ticks, the ticks are drawn on. */
  tickStride: number;
  nameRows: Map<NumberLinePoint, number>; nameRowCount: number; nameRowHeight: number;
  labelsAbove: boolean; labelledPoints: boolean; pointLabelY: number;
  jumpLanes: number[]; reservedLanes: number; jumpLane: number; laneArc: number;
  /** The values the card marks (their ticks and labels always stay). */
  marked: number[];
  /** The middle of the overview strip under the line. */
  stripY: number;
}

/**
 * The card's geometry for a window (the whole range when none). The card's height and its line's height
 * are the same in every window: label rows are reserved for the whole line as well as the window, so a
 * card never resizes as the learner zooms (decision 0024 §6).
 */
export function planNumberLineCard(raw: Record<string, unknown>, variables?: NumberLineViewContext["variables"], requested?: NumberLineWindow): NumberLineCardPlan {
  const content = raw as unknown as NumberLineContent;
  const x0 = SIDE, x1 = NUMBER_LINE_VIEW_WIDTH - SIDE;
  const whole: NumberLineWindow = { min: content.range.min, max: content.range.max };
  const window = clampNumberLineWindow(content, requested, x1 - x0);
  const zoomed = isZoomedWindow(content, window);
  const allTicks = planNumberLineTicks(content);
  const fractions = allTicks.some((tick) => tick.label?.kind === "fraction");
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
  const reservedLanes = moving && jumps.length > 1 ? Math.max(laneCount, reachableLaneCount(content, variables)) : laneCount;
  const JUMP_LANE = 36, LANE_ARC = 22;
  const jumpZone = !jumps.length ? 0 : reservedLanes === 1 ? 58 : 44 + (reservedLanes - 1) * JUMP_LANE;
  const intervalZone = intervals.some((interval) => interval.label) ? 20 : 0;
  // Point labels sit above the line unless jump arcs are there; below, they clear the tick labels.
  const labelsAbove = jumps.length === 0;
  const labelledPoints = points.some((point) => point.label);
  const mapperFor = (view: NumberLineWindow) => (value: number) => x0 + (value - view.min) / (view.max - view.min) * (x1 - x0);
  const inViewFor = (view: NumberLineWindow) => {
    const tolerance = 1e-9 * Math.max(1, Math.abs(view.min), Math.abs(view.max));
    return (value: number) => value >= view.min - tolerance && value <= view.max + tolerance;
  };
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
  // As many rows as there could be marked numbers in any state, counted from the card's parts, never
  // from their current values (review of #51: a jump whose end has no point of its own separates from
  // its start as its change grows from 0, and the card grew mid-animation): one per visible point, and
  // one per jump end, plus its start unless that is one of the points.
  const visiblePoints = points.filter((point) => point.shown !== "when_emphasized").length;
  const jumpMarks = jumps.reduce((count, jump) => count + 1
    + (typeof jump.from === "string" && points.some((point) => point.as === jump.from) ? 0 : 1), 0);
  const intervalMarks = intervals.reduce((count, interval) => count + (interval.from === null ? 0 : 1) + (interval.to === null ? 0 : 1), 0);
  const allNamed = points.filter((point) => point.label && numberLineValue(point.value) !== undefined);
  // Ticks closer than six board units are drawn on a 1-2-5 stride (decision 0024, also at rest); labels
  // then thin among the drawn ticks, so every label has its tick.
  const layout = (view: NumberLineWindow) => {
    const mapX = mapperFor(view), inView = inViewFor(view);
    const thinned = thinNumberLineTicks(content, allTicks, view, x1 - x0, marked, latent.filter((value): value is number => value !== undefined));
    const labelled = thinned.ticks.filter((tick) => tick.label);
    const labelPlan = planTickLabels(labelled.map((tick) => ({ x: mapX(tick.value), width: tickLabelWidth(tick.label!), major: tick.major, value: tick.value })), planTickStep(content), marked);
    const labelRow = new Map([...labelPlan.shown].map((index) => [labelled[index]!.value, labelPlan.rows.get(index) ?? 0]));
    // At most two of them can crowd one label's width at once in practice (a point next to a jump's end);
    // reserving a row for every part left a rounding line's four points and jump with five empty rows
    // (decision 0016). A rarer state that needs a third row grows the card when it happens. A line is
    // crowded when not every tick's label fits: its labels thin, or its ticks do (0024).
    const crowded = labelPlan.thinned || thinned.stride > 1;
    const tickRows = moving && crowded ? Math.max(labelPlan.rowCount, Math.min(2, visiblePoints + jumpMarks + intervalMarks)) : labelPlan.rowCount;
    // Point names that would overlap (Start and End a quarter apart) go on further rows, away from the line.
    // A card whose points move (bound or dragged) keeps one geometry in every state: it reserves the
    // rows its labels could need, so the axis never jumps under the pointer and the card never resizes.
    const named = allNamed.flatMap((point) => { const value = numberLineValue(point.value)!; return inView(value) ? [{ point, x: mapX(value), width: textWidth(point.label!) }] : []; });
    const nameRows = new Map(stackLabels(named).map((row, index) => [named[index]!.point, row]));
    const nameRowCount = Math.max(1, ...[...nameRows.values()].map((row) => row + 1), moving ? allNamed.length : 1);
    return { mapX, inView, ticks: thinned.ticks, stride: thinned.stride, labelRow, tickRows, nameRows, nameRowCount };
  };
  const current = layout(window);
  // Rows are reserved for the whole line too, so zooming never changes the card's height.
  const rest = zoomed ? layout(whole) : current;
  const tickRows = Math.max(current.tickRows, rest.tickRows);
  const nameRowCount = Math.max(current.nameRowCount, rest.nameRowCount);
  const nameRowHeight = 16;
  const lineY = 18 + jumpZone + intervalZone + (labelsAbove && labelledPoints ? 24 + (nameRowCount - 1) * nameRowHeight : 0);
  const rowHeight = fractions ? 32 : 18;
  const tickLabelHeight = rowHeight * tickRows;
  const pointLabelY = labelsAbove ? lineY - 16 : lineY + 14 + tickLabelHeight + 14;
  const bottom = labelsAbove || !labelledPoints ? lineY + 14 + tickLabelHeight : pointLabelY + (nameRowCount - 1) * nameRowHeight;
  const stripY = bottom + STRIP_GAP;
  return {
    window, zoomed, x0, x1, mapX: current.mapX, inView: current.inView, lineY, height: stripY + STRIP_BELOW,
    ticks: current.ticks, labelRow: current.labelRow, rowHeight, tickStride: current.stride,
    nameRows: current.nameRows, nameRowCount, nameRowHeight, labelsAbove, labelledPoints, pointLabelY,
    jumpLanes, reservedLanes, jumpLane: JUMP_LANE, laneArc: LANE_ARC, marked, stripY,
  };
}

/** Draws a number line's SVG for a planned window. */
function drawNumberLine(content: NumberLineContent, plan: NumberLineCardPlan, context: NumberLineViewContext): SVGSVGElement {
  const { x0, x1, mapX, inView, lineY, height, rowHeight, labelsAbove, labelledPoints, pointLabelY, nameRowCount, nameRowHeight, jumpLanes, reservedLanes } = plan;
  const { min, max } = plan.window;
  const jumps = content.jumps ?? [];
  const intervals = content.intervals ?? [];
  const points = content.points ?? [];

  const svg = element("svg", { viewBox: `0 0 ${NUMBER_LINE_VIEW_WIDTH} ${height}`, role: "img" }, "number-line-preview", plan.zoomed ? "number-line-zoomed" : "");
  const defs = element("defs", {});
  const marker = element("marker", { id: `number-line-arrow-${Math.random().toString(36).slice(2, 9)}`, markerUnits: "userSpaceOnUse", markerWidth: 11, markerHeight: 11, refX: 8, refY: 5, orient: "auto" });
  marker.append(element("path", { d: "M0,0 L10,5 L0,10 Z" }, "number-line-arrowhead"));
  defs.append(marker);
  // Zoomed in, arcs and bars that run past the window stop at the line's ends.
  let clip: string | undefined;
  if (plan.zoomed) {
    const clipPath = element("clipPath", { id: `number-line-window-${Math.random().toString(36).slice(2, 9)}` });
    clipPath.append(element("rect", { x: x0 - 18, y: 0, width: x1 - x0 + 36, height }));
    defs.append(clipPath);
    clip = `url(#${clipPath.id})`;
  }
  svg.append(defs);
  const arrow = `url(#${marker.id})`;

  // The line, with arrows showing it goes on past both ends.
  svg.append(element("line", { x1: x0 - 18, x2: x1 + 18, y1: lineY, y2: lineY }, "number-line-axis"));
  svg.append(element("path", { d: `M${x1 + 18},${lineY} l-7,-5 m7,5 l-7,5 M${x0 - 18},${lineY} l7,-5 m-7,5 l7,5` }, "number-line-axis"));

  // The ticks the plan keeps are drawn, before the intervals, so no tick runs through an interval's open
  // end; a label only when the plan keeps it.
  for (const tick of plan.ticks) {
    const x = mapX(tick.value);
    svg.append(element("line", { x1: x, x2: x, y1: lineY - (tick.major ? 8 : 5), y2: lineY + (tick.major ? 8 : 5) }, tick.major ? "number-line-tick" : "number-line-tick number-line-tick-minor"));
    const row = plan.labelRow.get(tick.value);
    if (tick.label && row !== undefined) tickLabel(svg, tick.label, x, lineY + 10 + row * rowHeight);
  }

  for (const interval of intervals) {
    const from = interval.from === null ? undefined : numberLineValue(interval.from);
    const to = interval.to === null ? undefined : numberLineValue(interval.to);
    if ((from !== undefined && from > max) || (to !== undefined && to < min)) continue;
    const start = from === undefined ? x0 - 18 : mapX(from), end = to === undefined ? x1 + 18 : mapX(to);
    const group = element("g", clip ? { "clip-path": clip } : {}, "number-line-interval");
    group.dataset.id = idOf(interval as Part);
    group.append(element("line", { x1: start, x2: end, y1: lineY, y2: lineY }, "number-line-interval-bar"));
    if (from === undefined) group.append(element("path", { d: `M${start},${lineY} l9,-6 m-9,6 l9,6` }, "number-line-interval-bar"));
    if (to === undefined) group.append(element("path", { d: `M${end},${lineY} l-9,-6 m9,6 l-9,6` }, "number-line-interval-bar"));
    for (const [value, closed] of [[from, interval.from_closed ?? true], [to, interval.to_closed ?? true]] as const) {
      if (value === undefined || !inView(value)) continue;
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
    // Zoomed in, a jump wholly on one side of the window is not drawn.
    if (Math.max(ends.from, ends.to) < min || Math.min(ends.from, ends.to) > max) continue;
    const group = element("g", clip ? { "clip-path": clip } : {}, "number-line-jump");
    group.dataset.id = idOf(jump as Part);
    // Lane 0 stands on the line; higher lanes on a raised baseline. Hops stand on the line, under any arc
    // over them, so a jump on a higher lane is one arc even when it has hops.
    const lane = jumpLanes[jumps.indexOf(jump)] ?? 0;
    const hops = Boolean(jump.hops) && lane === 0;
    const base = lineY - 4 - lane * plan.jumpLane;
    // Whole hops, then a shorter last one when a variable stops between ticks: the arrow ends at ends.to.
    const pieces = jumpHops(content, ends, hops);
    const span = (piece: { from: number; to: number }) => Math.abs(mapX(piece.to) - mapX(piece.from));
    const natural = hops ? 18 : Math.min(46, 14 + span(ends) / 5);
    // With lanes, every arc stays low enough to clear the lane above it. The cap follows the reserved
    // lanes, so an arc keeps its height when a reversing jump appears.
    const hopHeight = reservedLanes > 1 ? Math.min(natural, plan.laneArc) : natural;
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
    // Zoomed in, a point outside the window is not drawn; the strip below counts it.
    if (value === undefined || !inView(value)) continue;
    const x = mapX(value);
    const group = element("g", {}, "number-line-point", point.shown === "when_emphasized" ? "number-line-latent" : "");
    group.dataset.id = idOf(point as Part);
    group.append(element("circle", { cx: x, cy: lineY, r: 6.5 }, point.style === "open" ? "number-line-dot-open" : "number-line-dot"));
    if (point.label) {
      const row = plan.nameRows.get(point) ?? 0;
      const y = labelsAbove ? pointLabelY - row * nameRowHeight : pointLabelY + row * nameRowHeight;
      const text = element("text", { x, y, "text-anchor": "middle" }, "number-line-point-label");
      text.textContent = point.label;
      if (!labelsAbove) group.append(element("line", { x1: x, x2: x, y1: lineY + 8, y2: y - 12 }, "number-line-point-leader"));
      group.append(text);
    }
    const variable = (point as NumberLinePoint).interaction?.variable;
    if (variable) {
      // The board's pointer handler turns a drag into a value on the smallest-tick grid, inside the
      // window shown (numberLineDragValue): the same stops whatever the zoom.
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

  // The overview strip: the whole line, and the part of it in view. Marked values outside the window
  // are counted at its ends.
  const strip = element("g", {}, "number-line-overview");
  const whole = content.range;
  const stripX = (value: number) => x0 + (value - whole.min) / (whole.max - whole.min) * (x1 - x0);
  strip.append(element("rect", { x: x0, y: plan.stripY - 2, width: x1 - x0, height: 4, rx: 2 }, "number-line-overview-track"));
  const left = stripX(min), right = stripX(max);
  strip.append(element("rect", { x: left, y: plan.stripY - 4, width: Math.max(4, right - left), height: 8, rx: 3 }, "number-line-overview-window"));
  const outside = [...new Set(plan.marked.map((value) => Number(value.toPrecision(12))))];
  const before = outside.filter((value) => !inView(value) && value < min).length;
  const after = outside.filter((value) => !inView(value) && value > max).length;
  if (before) label(strip, `◀ ${before}`, x0 - 6, plan.stripY + 4, "number-line-overview-count", "end");
  if (after) label(strip, `${after} ▶`, x1 + 6, plan.stripY + 4, "number-line-overview-count", "start");
  svg.append(strip);
  return svg;
}

/**
 * A number line card's zoom, for the board to drive (decision 0024): the board routes the wheel and
 * two-finger pinches over the card, and a drag on the zoomed line, here instead of to its camera.
 */
export interface NumberLineZoomControl {
  /** Whether the line can zoom at all (its whole range is wider than the zoom limit). */
  readonly zoomable: boolean;
  /** Whether it shows less than the whole line now. */
  readonly zoomed: boolean;
  /** Zooms by `factor` (above 1 zooms in) around the value under `clientX`. */
  zoomAt(factor: number, clientX: number): void;
  /** Moves the line with a pointer that moved `clientDx` pixels. */
  panBy(clientDx: number): void;
  /** Back to the whole line, without telling the board (the teaching camera is taking over). */
  showWhole(): void;
  /** Whether an event target is on the line's drawing (not its buttons). */
  onLine(target: EventTarget | null): boolean;
}

const zoomControls = new WeakMap<Element, NumberLineZoomControl>();

/** The zoom of the number line drawn in `card` (or of the card's view itself), if it has one. */
export function numberLineZoomControl(card: Element | null | undefined): NumberLineZoomControl | undefined {
  if (!card) return undefined;
  const view = zoomControls.has(card) ? card : card.querySelector?.(".number-line-view");
  return view ? zoomControls.get(view) : undefined;
}

/** The SVG for a number line, with its parts marked for emphasis and dragging, and its own zoom (0024). */
export function renderNumberLine(parent: HTMLElement, raw: Record<string, unknown>, context: NumberLineViewContext): void {
  const content = raw as unknown as NumberLineContent;
  const width = NUMBER_LINE_VIEW_WIDTH - 2 * SIDE;
  const limits = numberLineZoomLimits(content, width);
  let plan = planNumberLineCard(raw, context.variables, context.zoom?.window);
  const view = document.createElement("div");
  view.className = "number-line-view";
  // The card's own buttons: real buttons, outside the board's pan and the learner's ink.
  const toolbar = document.createElement("div");
  toolbar.className = "number-line-zoom";
  toolbar.setAttribute("role", "group");
  toolbar.dataset.ollBoardInput = "ignore";
  toolbar.dataset.ollInkInput = "ignore";
  const localize = context.localize ?? ((_element: Element, apply: (text: (source: string) => string) => void) => apply((source) => source));
  localize(toolbar, (text) => toolbar.setAttribute("aria-label", text("数轴缩放")));
  const button = (face: string, name: string, action: () => void, className: string) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className;
    localize(node, (text) => { node.textContent = text(face); node.setAttribute("aria-label", text(name)); node.title = text(name); });
    node.addEventListener("click", action);
    toolbar.append(node);
    return node;
  };
  let svg = drawNumberLine(content, plan, context);
  const valueAt = (clientX: number) => {
    const rect = svg.getBoundingClientRect();
    const x = rect.width > 0 ? (clientX - rect.left) / rect.width * NUMBER_LINE_VIEW_WIDTH : (plan.x0 + plan.x1) / 2;
    return plan.window.min + (x - plan.x0) / (plan.x1 - plan.x0) * (plan.window.max - plan.window.min);
  };
  const sync = () => {
    const span = plan.window.max - plan.window.min;
    const focused = toolbar.contains(document.activeElement) ? document.activeElement : null;
    zoomIn.disabled = !limits.zoomable || span <= limits.minSpan * (1 + 1e-9);
    zoomOut.disabled = whole.disabled = !plan.zoomed;
    // A button that reached its limit hands the keyboard focus to one that still works.
    if (focused instanceof HTMLButtonElement && focused.disabled) (zoomIn.disabled ? zoomOut : zoomIn).focus();
  };
  const show = (next: NumberLineWindow | undefined, notify: boolean) => {
    const window = clampNumberLineWindow(content, next, width);
    if (window.min === plan.window.min && window.max === plan.window.max) return;
    plan = planNumberLineCard(raw, context.variables, window);
    const drawn = drawNumberLine(content, plan, context);
    svg.replaceWith(drawn);
    svg = drawn;
    sync();
    if (notify) context.zoom?.change(plan.zoomed ? { ...plan.window } : undefined);
  };
  const zoomBy = (factor: number, anchor: number) => show(zoomNumberLineWindow(content, plan.window, factor, anchor, width), true);
  const zoomOut = button("−", "缩小数轴", () => zoomBy(1 / NUMBER_LINE_ZOOM.buttonFactor, numberLineZoomCentre(plan.window, plan.marked)), "number-line-zoom-out");
  const zoomIn = button("+", "放大数轴", () => zoomBy(NUMBER_LINE_ZOOM.buttonFactor, numberLineZoomCentre(plan.window, plan.marked)), "number-line-zoom-in");
  const whole = button("整条", "显示整条数轴", () => show(undefined, true), "number-line-zoom-whole");
  sync();
  view.append(toolbar, svg);
  zoomControls.set(view, {
    get zoomable() { return limits.zoomable; },
    get zoomed() { return plan.zoomed; },
    zoomAt: (factor, clientX) => zoomBy(factor, valueAt(clientX)),
    panBy: (clientDx) => {
      const rect = svg.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      const delta = -clientDx / rect.width * NUMBER_LINE_VIEW_WIDTH / (plan.x1 - plan.x0) * (plan.window.max - plan.window.min);
      show(panNumberLineWindow(content, plan.window, delta, width), true);
    },
    showWhole: () => show(undefined, false),
    onLine: (target) => typeof Node !== "undefined" && target instanceof Node && svg.contains(target),
  });
  parent.append(view);
  if (content.caption) {
    const caption = document.createElement("div");
    caption.className = "number-line-caption";
    caption.textContent = content.caption;
    parent.append(caption);
  }
}

export type { NumberLineInterval };
