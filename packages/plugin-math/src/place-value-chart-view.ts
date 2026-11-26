/**
 * Draws a `place_value_chart` card (decision 0025) from its plan (place-value-chart.ts): what the card gives
 * the learner (the number's name, an expanded form, its place counts, or, pulling apart, its numeral), then
 * the chart as SVG (a band naming each whole period, a head per column, a column of disks per place, the
 * decimal point, a button row) and, pulling apart, each place's part below. Values come from the content with
 * bindings already applied. A build task never shows the number's numeral.
 *
 * The card is drawn once and then updated in place: a disk already drawn stays, a new one is added (class
 * `place-value-disk-new`, for the stylesheet's pop), so a count animating 0 -> 3 shows disks one at a time.
 * Fills and sizes are attributes, so the chart reads without the stylesheet; its classes are for styling.
 *
 * Every element a learner can tap carries `data-oll-tap`, the tap and its place's index (`placeValueTapIndex`:
 * the place plus three, so "add:6" is the thousands and "take_out:2" the tenths); the board turns a tap into
 * the card's tap rules. When the card is not live (the lesson is playing, or no open task
 * lets the learner tap it) the same chart is drawn without buttons or tap cues.
 */
import {
  PLACE_VALUE_PLACE_ALIASES, PLACE_VALUE_WORDS, placeValueChartState, placeValueColumnName, placeValueDiskAt, placeValueDiskFont,
  placeValueGivenText, placeValueLanguage, placeValueTapIndex, planPlaceValueChart, type PlaceValueChartPlan, type PlaceValueLanguage,
} from "./place-value-chart.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface PlaceValueChartViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** True while an open task lets the learner tap this card. */
  live?: boolean;
  /** A one-line message under the chart (a refused tap's reason). */
  notice?: string;
  /**
   * The width in screen pixels the card can take at most; on a narrow screen the chart wraps its periods
   * into rows (`planPlaceValueChart`). The board passes the same width to its layout.
   */
  fitWidth?: number;
}

interface ChartView {
  plan: PlaceValueChartPlan;
  /** The chart's frame: a chart whose language, task or columns change is drawn again. */
  frame: string;
  language: PlaceValueLanguage;
  svg: SVGSVGElement;
  given: HTMLDivElement;
  notice: HTMLDivElement;
  groups: Map<number, SVGGElement>;
  disks: Map<number, SVGGElement[]>;
  pulled: Map<number, SVGGElement[]>;
  layers: Map<number, { disks: SVGGElement; pulled: SVGGElement }>;
  buttons: Map<number, SVGGElement>;
}

const views = new WeakMap<HTMLElement, ChartView>();

const COLORS = {
  background: "#eef1f8", column: "#ffffff", ink: "#1d2433", muted: "#5b6478", line: "#d5dae6", accent: "#2f5bd3",
  part: "#e3f4f0", partEdge: "#1f9e89", diskInk: "#ffffff",
} as const;

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (classes.length) node.classList.add(...classes);
  return node;
}

const round = (value: number) => Math.round(value * 100) / 100;

function frameOf(raw: Record<string, unknown>, plan: PlaceValueChartPlan): string {
  return JSON.stringify([placeValueLanguage(raw), raw.mode === "apart" ? "apart" : "build", raw.top_place, raw.decimals === true, plan.bands]);
}

function setTappable(target: SVGElement, tap: string | undefined, label: string, live: boolean): void {
  if (tap) target.dataset.ollTap = tap; else delete target.dataset.ollTap;
  const on = live && tap !== undefined;
  target.classList.toggle("place-value-live", on);
  if (on) {
    target.setAttribute("tabindex", "0");
    target.setAttribute("role", "button");
    target.setAttribute("aria-label", label);
    target.setAttribute("cursor", "pointer");
  } else {
    target.removeAttribute("tabindex");
    target.removeAttribute("role");
    target.removeAttribute("aria-label");
    target.removeAttribute("cursor");
  }
}

/** One disk, centred at a point: a circle of its place's fill, its place's value written on it. */
function diskElement(plan: PlaceValueChartPlan, place: number, at: { x: number; y: number }): SVGGElement {
  const column = plan.columns.find((candidate) => candidate.place === place)!;
  const group = element("g", {}, "place-value-disk");
  group.dataset.place = String(place);
  group.append(element("circle", { cx: round(at.x), cy: round(at.y), r: plan.disk / 2, fill: column.fill }, "place-value-disk-face"));
  const label = element("text", {
    x: round(at.x), y: round(at.y), "text-anchor": "middle", "dominant-baseline": "central", "font-size": placeValueDiskFont(column.diskLabel),
    "font-weight": 700, fill: COLORS.diskInk, "pointer-events": "none",
    // A long label (1,000,000) is fitted inside the disk.
    ...(column.diskLabel.length >= 6 ? { textLength: plan.disk - 5, lengthAdjust: "spacingAndGlyphs" } : {}),
  }, "place-value-disk-label");
  label.textContent = column.diskLabel;
  group.append(label);
  return group;
}

/** The chart's fixed parts: background, period band, heads, columns, parts, point and buttons. Drawn once per frame. */
function create(parent: HTMLElement, raw: Record<string, unknown>, fitWidth: number | undefined): ChartView {
  const plan = planPlaceValueChart(raw, fitWidth === undefined ? {} : { fitWidth });
  const language = placeValueLanguage(raw);
  const words = PLACE_VALUE_WORDS[language];
  const given = document.createElement("div");
  given.className = "place-value-given";
  const svg = element("svg", { viewBox: `0 0 ${round(plan.width)} ${round(plan.height)}`, role: "group", "aria-label": words.chartLabel, "font-family": "ui-sans-serif, system-ui, sans-serif" }, "place-value-chart");
  svg.append(element("rect", { x: 0, y: 0, width: round(plan.width), height: round(plan.height), rx: 12, fill: COLORS.background }, "place-value-background"));
  for (const period of plan.periods) {
    if (!period.name) continue;
    const label = element("text", { x: round(period.x + period.width / 2), y: round(period.y + 12), "text-anchor": "middle", "font-size": plan.fontSize, "font-weight": 600, fill: COLORS.muted }, "place-value-period");
    label.textContent = period.name;
    svg.append(label, element("line", { x1: round(period.x + 2), y1: round(period.y + 19), x2: round(period.x + period.width - 2), y2: round(period.y + 19), stroke: COLORS.line, "stroke-width": 2 }, "place-value-period-rule"));
  }
  const groups = new Map<number, SVGGElement>();
  const layers = new Map<number, { disks: SVGGElement; pulled: SVGGElement }>();
  const buttons = new Map<number, SVGGElement>();
  for (const column of plan.columns) {
    const group = element("g", {}, "place-value-place");
    group.dataset.place = String(column.place);
    const head = element("text", { x: round(column.x + column.width / 2), y: round(column.headY), "text-anchor": "middle", "font-size": plan.fontSize, "font-weight": 700, fill: COLORS.ink }, "place-value-head");
    column.head.forEach((line, k) => {
      const span = element("tspan", { x: round(column.x + column.width / 2), dy: k === 0 ? (column.head.length === 1 ? 13 : 0) : 13 });
      span.textContent = line;
      head.append(span);
    });
    group.append(head);
    group.append(element("rect", { x: column.box.x, y: column.box.y, width: column.box.width, height: column.box.height, rx: 10, fill: COLORS.column }, "place-value-column"));
    if (column.part) {
      group.append(element("rect", { x: column.part.x + 1, y: column.part.y + 1, width: column.part.width - 2, height: column.part.height - 2, rx: 10, fill: "none", stroke: COLORS.line, "stroke-width": 1.5, "stroke-dasharray": "5 4" }, "place-value-part"));
    }
    const disks = element("g", {}, "place-value-disks");
    const pulled = element("g", {}, "place-value-pulled");
    group.append(disks, pulled);
    const button = element("g", {}, "place-value-button");
    button.append(element("rect", { x: column.button.x + 4, y: column.button.y, width: column.button.width - 8, height: column.button.height, rx: column.button.height / 2, fill: COLORS.column, stroke: COLORS.accent, "stroke-width": 1.5 }));
    const text = element("text", {
      x: round(column.button.x + column.button.width / 2), y: round(column.button.y + column.button.height / 2), "text-anchor": "middle", "dominant-baseline": "central",
      "font-size": column.button.text === "+" ? 20 : 12.5, "font-weight": 700, fill: COLORS.accent, "pointer-events": "none",
    });
    text.textContent = column.button.text;
    button.append(text);
    group.append(button);
    svg.append(group);
    groups.set(column.place, group);
    layers.set(column.place, { disks, pulled });
    buttons.set(column.place, button);
  }
  if (plan.point) {
    const point = element("text", { x: round(plan.point.x), y: round(plan.point.y), "text-anchor": "middle", "dominant-baseline": "central", "font-size": 36, "font-weight": 700, fill: COLORS.ink, "aria-label": words.point }, "place-value-point");
    point.textContent = ".";
    svg.append(point);
  }
  const notice = document.createElement("div");
  notice.className = "place-value-notice";
  notice.setAttribute("aria-live", "polite");
  parent.append(given, svg, notice);
  return {
    plan, frame: frameOf(raw, plan), language, svg, given, notice, groups,
    disks: new Map(plan.columns.map((column) => [column.place, []])), pulled: new Map(plan.columns.map((column) => [column.place, []])), layers, buttons,
  };
}

/** Makes a layer hold exactly `count` disks: those drawn stay, new ones are added at the end, extra ones go. */
function reconcile(view: ChartView, place: number, list: SVGGElement[], layer: SVGGElement, count: number, part: boolean): void {
  while (list.length > count) list.pop()!.remove();
  for (const disk of list) disk.classList.remove("place-value-disk-new");
  while (list.length < count) {
    const disk = diskElement(view.plan, place, placeValueDiskAt(view.plan, place, list.length, part));
    disk.classList.add("place-value-disk-new");
    list.push(disk);
    layer.append(disk);
  }
}

function update(view: ChartView, raw: Record<string, unknown>, context: PlaceValueChartViewContext): void {
  const state = placeValueChartState(raw);
  const live = context.live === true;
  const words = PLACE_VALUE_WORDS[view.language];
  view.svg.classList.toggle("place-value-chart-live", live);
  view.given.textContent = placeValueGivenText(raw);
  const places = Array.isArray(raw.places) ? raw.places as Array<{ place?: unknown; id?: unknown }> : [];
  state.columns.forEach((place, i) => {
    const group = view.groups.get(place)!;
    // On the board a place's `as` has become its canonical `id`; emphasis addresses that.
    const placeId = String(places.find((item) => item?.place === place)?.id ?? PLACE_VALUE_PLACE_ALIASES[place]);
    group.dataset.id = placeId;
    context.applyEmphasis(group, placeId);
    const name = placeValueColumnName(place, view.language);
    const layer = view.layers.get(place)!;
    const disks = view.disks.get(place)!;
    reconcile(view, place, disks, layer.disks, state.counts[i]!, false);
    // Building, a disk on the chart is tapped to take it away.
    for (const disk of disks) setTappable(disk, state.mode === "build" ? `remove:${placeValueTapIndex(place)}` : undefined, words.removeLabel(name), live);
    if (state.mode === "apart") reconcile(view, place, view.pulled.get(place)!, layer.pulled, state.pulled[i]!, true);
    const button = view.buttons.get(place)!;
    // Buttons show only while the learner can tap; a place with nothing on the chart has nothing to take out.
    const shown = live && (state.mode === "build" || state.counts[i]! > 0);
    button.setAttribute("visibility", shown ? "visible" : "hidden");
    setTappable(button, shown ? `${state.mode === "apart" ? "take_out" : "add"}:${placeValueTapIndex(place)}` : undefined, state.mode === "apart" ? words.takeOutLabel(name) : words.addLabel(name), live);
  });
  view.notice.textContent = context.notice ?? "";
}

/** Draws the card into an empty parent. */
export function renderPlaceValueChart(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueChartViewContext): void {
  const view = create(parent, raw, context.fitWidth);
  views.set(parent, view);
  update(view, raw, context);
}

/**
 * Updates a card drawn by `renderPlaceValueChart` into the same parent, keeping every drawn disk. Returns
 * false when the parent holds no such card or its frame (language, task, columns) changed; the caller then
 * redraws it.
 */
export function updatePlaceValueChart(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueChartViewContext): boolean {
  const view = views.get(parent);
  if (!view || !view.svg.isConnected || view.frame !== frameOf(raw, planPlaceValueChart(raw, context.fitWidth === undefined ? {} : { fitWidth: context.fitWidth }))) return false;
  update(view, raw, context);
  return true;
}
