/**
 * Draws a `place_value_compare` card (decision 0029) from its plan (place-value-compare.ts): the problem as the
 * program writes it ("Compare 0.625 and 0.7."), the one-line instruction (on its own line right under the problem,
 * only while the learner can tap), the chart as SVG, the line that states the chart's fact or a refusal, and the
 * sentence "a [> = <] b" with its lock note. Values come from the content with bindings applied. The card never
 * names the larger number before the true sign is chosen, and never shows a title of its own.
 *
 * Every element a learner can tap carries `data-oll-tap`: `same:<place>` and `different:<place>` (the place is an
 * index into the card's tap places, the chart's place plus three), `sign:<10..12>`, and once the chart is decided
 * `column:<place>` on each column, whose refusal is that column's fact (the later places don't matter). A refused judgement's button
 * shakes and stays grey and dashed until the next tap; on a column with an unjudged column to its left that column
 * also dims and the leftmost unjudged column is lightly ringed. A learner's accepted judgement pulses the column's
 * disks with their partners. A demonstration moving "compared" forward plays one step at a time, the column being
 * judged ringed: the player sets "compared" one step a slot apart (0026 revision 2), and each step is drawn over the
 * context's `demonstrationMs` (`DEMONSTRATION_STEP_MS` at the playback speed). A jump of several steps (a seek, a
 * restore, an older player) plays at a quick pace. With reduced motion the chart changes at once.
 */
import type { PlaceValueLanguage } from "./place-value-chart.js";
import {
  PLACE_VALUE_COMPARE_JUDGEMENTS, PLACE_VALUE_COMPARE_WORDS, applyPlaceValueCompareTap, placeValueCompareColumn,
  placeValueCompareColumnTapIndex, placeValueCompareDecided, placeValueCompareDemonstrating, placeValueCompareDiskAt,
  placeValueCompareFactText, placeValueCompareInstruction, placeValueCompareLanguage, placeValueCompareProblemText, placeValueCompareSignIndex, placeValueCompareSigned,
  placeValueCompareState, placeValueCompareTapColumn, placeValueCompareTextWidth, planPlaceValueCompare,
  type PlaceValueComparePlan, type PlaceValueCompareRefusal, type PlaceValueCompareState, type PlaceValueCompareTapKind,
} from "./place-value-compare.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** How long each step of a jump of several (a seek, a restore) shows before the next, in milliseconds. */
export const PLACE_VALUE_COMPARE_QUICK_MS = 700;

export interface PlaceValueCompareViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
  /** True while an open task lets the learner tap this card. */
  live?: boolean;
  /** A refused tap's sentence, in the card's words. */
  notice?: string;
  /** The refused tap the notice answers: its button is marked, and a column refused for an unjudged one to its left dims. */
  refused?: { kind: string; place: number };
  /** Draw changes at once (also when the page asks for reduced motion). */
  reducedMotion?: boolean;
  /**
   * How long one step of the lesson's demonstration animates (`DEMONSTRATION_STEP_MS` at the playback speed; owner,
   * 2026-11-27). The player moves "compared" one step at a time; that step is drawn this slowly. A learner's tap keeps
   * its quick pace, and a jump of several steps plays at `PLACE_VALUE_COMPARE_QUICK_MS` a step.
   */
  demonstrationMs?: number;
}

interface View {
  plan: PlaceValueComparePlan;
  frame: string;
  language: PlaceValueLanguage;
  given: HTMLDivElement;
  howto: HTMLParagraphElement;
  svg: SVGSVGElement;
  chart: SVGGElement;
  notice: HTMLDivElement;
  sentence: SVGSVGElement;
  hatch: string;
  context: PlaceValueCompareViewContext;
  shown?: PlaceValueCompareState;
  target?: PlaceValueCompareState;
  refused?: { kind: PlaceValueCompareTapKind; place: number; reason: PlaceValueCompareRefusal; text: string; key: string };
  /** A refusal the card has moved on from (its state changed); a host that keeps passing it is not heard again. */
  dropped?: string;
  /** The column the demonstration is judging now (ringed while its step shows). */
  focus?: number;
  drawnContext?: string;
  timer?: ReturnType<typeof setTimeout>;
  /** Demonstration steps still to draw, each with how long it shows. */
  queue: Array<{ state: PlaceValueCompareState; pace: number }>;
}

const views = new WeakMap<HTMLElement, View>();
let patterns = 0;
const COLORS = {
  background: "#eef1f8", column: "#ffffff", ink: "#1d2433", muted: "#5b6478", slot: "#c9d0df", accent: "#2f5bd3",
  same: "#1d7a4e", sameStrip: "#e9f3ee", tried: "#f3f5fa", gold: "#c9a227", diskInk: "#ffffff", hatch: "#dde2ec",
} as const;
const round = (value: number) => Math.round(value * 100) / 100;

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (classes.length) node.classList.add(...classes);
  return node;
}
function text(x: number, y: number, content: string, attributes: Record<string, string | number>, ...classes: string[]): SVGTextElement {
  const node = element("text", { x: round(x), y: round(y), ...attributes }, ...classes);
  node.textContent = content;
  return node;
}

/** Marks an element tappable (a button for keyboard and screen readers) while live; nothing gets focus on its own. */
function setTappable(target: SVGElement, tap: string | undefined, label: string, live: boolean): void {
  const on = live && tap !== undefined;
  if (on) target.dataset.ollTap = tap; else delete target.dataset.ollTap;
  target.classList.toggle("place-value-compare-live", on);
  target.setAttribute("aria-label", label);
  if (on) {
    target.setAttribute("tabindex", "0");
    target.setAttribute("role", "button");
    target.setAttribute("cursor", "pointer");
  } else for (const attribute of ["tabindex", "role", "cursor"]) target.removeAttribute(attribute);
}

function frameOf(raw: Record<string, unknown>, plan: PlaceValueComparePlan): string {
  return JSON.stringify([placeValueCompareLanguage(raw), plan.width, plan.height, plan.columns.map((column) => [column.place, column.x]), plan.labels, plan.sentence.a.text, plan.sentence.b.text]);
}

function create(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueCompareViewContext): View {
  const plan = planPlaceValueCompare(raw);
  const language = placeValueCompareLanguage(raw);
  const words = PLACE_VALUE_COMPARE_WORDS[language];
  const given = document.createElement("div");
  given.className = "place-value-compare-given";
  const howto = document.createElement("p");
  howto.className = "place-value-compare-howto";
  // The instruction keeps one place, right under the problem, whatever it says (or when empty).
  howto.style.minHeight = "1.5em";
  const svg = element("svg", { viewBox: `0 0 ${round(plan.width)} ${round(plan.height)}`, width: round(plan.width), role: "group", "aria-label": words.chartLabel, "font-family": "ui-sans-serif, system-ui, sans-serif" }, "place-value-compare");
  const hatch = `place-value-compare-hatch-${(patterns += 1)}`;
  const defs = element("defs", {});
  const pattern = element("pattern", { id: hatch, width: 11, height: 11, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pattern.append(element("rect", { width: 11, height: 11, fill: COLORS.column }), element("rect", { x: 9, width: 2, height: 11, fill: COLORS.hatch }));
  defs.append(pattern);
  svg.append(defs, element("rect", { x: 0, y: 0, width: round(plan.width), height: round(plan.height), rx: 14, fill: COLORS.background }));
  const chart = element("g", {}, "place-value-compare-chart");
  svg.append(chart);
  const notice = document.createElement("div");
  notice.className = "place-value-compare-notice";
  notice.setAttribute("aria-live", "polite");
  const { sentence: sp } = plan;
  const sentence = element("svg", { viewBox: `0 0 ${round(sp.width)} ${round(sp.height)}`, width: round(sp.width), role: "group", "aria-label": words.sentenceLabel, "font-family": "ui-sans-serif, system-ui, sans-serif" }, "place-value-compare-sentence");
  parent.append(given, howto, svg, notice, sentence);
  return { plan, frame: frameOf(raw, plan), language, given, howto, svg, chart, notice, sentence, hatch, context, queue: [] };
}

/** One disk, centred at a point: a circle of its place's fill, its place's value written on it. */
function disk(plan: PlaceValueComparePlan, k: number, x: number, y: number): SVGGElement {
  const column = plan.columns[k]!;
  const group = element("g", {}, "place-value-compare-disk");
  group.dataset.place = String(column.place);
  group.append(element("circle", { cx: round(x), cy: round(y), r: plan.disk / 2, fill: column.fill }));
  // A wide place value (100,000; 1,000,000) is squeezed to the disk, so it is read whole inside it (as decision 0028's).
  const room = plan.disk - 5;
  const squeeze: Record<string, string | number> = placeValueCompareTextWidth(column.diskLabel, column.diskFont) * 1.2 > room ? { textLength: round(room), lengthAdjust: "spacingAndGlyphs" } : {};
  group.append(text(x, y, column.diskLabel, { "text-anchor": "middle", "dominant-baseline": "central", "font-size": column.diskFont, "font-weight": 700, fill: COLORS.diskInk, "pointer-events": "none", ...squeeze }));
  return group;
}

/** The leftmost column not judged yet, when a refused tap was on a column to its right (it is lightly ringed). */
const triedColumn = (view: View, state: PlaceValueCompareState): number | undefined =>
  view.refused?.reason === "left_unjudged" ? placeValueCompareTapColumn(state, { tap: view.refused.kind, place: view.refused.place }) : undefined;

/** Draws the chart: every column's strip, name, disks (or a faint 0), its buttons or mark, the hatch after the deciding column. */
function drawChart(view: View, state: PlaceValueCompareState, live: boolean): void {
  const { plan, chart } = view;
  const words = PLACE_VALUE_COMPARE_WORDS[view.language];
  const { pair } = state;
  chart.replaceChildren();
  // The numerals at the left edge, as written, lined up on their points (whole numbers on their ones).
  const { labels } = plan;
  for (const [row, label] of [["a", labels.a], ["b", labels.b]] as const) {
    const box = row === "a" ? plan.rowA : plan.rowB;
    const y = box.y + box.height / 2;
    const common = { "dominant-baseline": "central", "font-size": labels.font, "font-weight": 600, fill: COLORS.ink, "font-variant-numeric": "tabular-nums" };
    const group = element("g", {}, "place-value-compare-label");
    group.dataset.row = row;
    group.append(text(labels.pointX, y, label.whole, { ...common, "text-anchor": "end" }, "place-value-compare-whole"));
    if (label.frac) group.append(text(labels.pointX, y, label.frac, { ...common, "text-anchor": "start" }, "place-value-compare-frac"));
    chart.append(group);
  }
  if (state.fault) return;
  const tried = triedColumn(view, state);
  const decided = placeValueCompareDecided(state);
  const top = plan.rowA.y, bottom = plan.rowB.y + plan.rowB.height;
  pair.columns.forEach((place, k) => {
    const column = plan.columns[k]!;
    const v = placeValueCompareColumn(state, k);
    const group = element("g", {}, "place-value-compare-column", `place-value-compare-${v.status}`);
    group.dataset.index = String(k);
    group.dataset.place = String(place);
    const strip = element("rect", {
      x: round(column.x), y: round(top), width: round(column.width), height: round(bottom - top), rx: 10,
      fill: v.status === "after" ? `url(#${view.hatch})` : v.status === "same" ? COLORS.sameStrip : tried === k ? COLORS.tried : COLORS.column,
    }, "place-value-compare-strip");
    group.append(strip);
    if (v.status === "decides") group.append(element("rect", { x: round(column.x - 1.5), y: round(top - 1.5), width: round(column.width + 3), height: round(bottom - top + 3), rx: 11.5, fill: "none", stroke: COLORS.accent, "stroke-width": 3 }, "place-value-compare-decides-ring"));
    if (view.focus === k) group.append(element("rect", { x: round(column.x - 1.5), y: round(top - 1.5), width: round(column.width + 3), height: round(bottom - top + 3), rx: 11.5, fill: "none", stroke: COLORS.gold, "stroke-width": 3 }, "place-value-compare-focus"));
    const head = element("text", { x: round(column.x + column.width / 2), y: round(plan.headY), "text-anchor": "middle", "font-size": 14, "font-weight": 600, fill: COLORS.ink }, "place-value-compare-head");
    column.head.forEach((line, i) => {
      const span = element("tspan", { x: round(column.x + column.width / 2), dy: i === 0 ? -(column.head.length - 1) * 16 : 16 });
      span.textContent = line;
      head.append(span);
    });
    group.append(head);
    for (const row of ["a", "b"] as const) {
      const n = row === "a" ? v.a : v.b;
      const cell = element("g", {}, "place-value-compare-cell");
      cell.dataset.row = row;
      if (tried === k) cell.setAttribute("opacity", "0.4");
      if (n === 0) {
        // An empty cell is 0 of its place: a faint 0, so 0 and 0 read as the same.
        const box = row === "a" ? plan.rowA : plan.rowB;
        cell.append(text(column.x + column.width / 2, box.y + box.height / 2, "0", { "text-anchor": "middle", "dominant-baseline": "central", "font-size": round(plan.disk * 0.95), "font-weight": 600, fill: COLORS.slot }, "place-value-compare-zero"));
      }
      for (let i = 0; i < n; i += 1) {
        const at = placeValueCompareDiskAt(plan, column, row, n, i);
        const d = disk(plan, k, at.x, at.y);
        d.dataset.i = String(i);
        if (v.status === "decides") {
          if (i < v.paired) { d.classList.add("place-value-compare-paired"); d.setAttribute("opacity", "0.35"); }
          else {
            d.classList.add("place-value-compare-extra");
            d.prepend(element("circle", { cx: round(at.x), cy: round(at.y), r: round(plan.disk / 2 + 3.5), fill: "none", stroke: column.fill, "stroke-width": 2.5 }, "place-value-compare-extra-ring"));
          }
        }
        if (v.status === "after") d.setAttribute("opacity", "0.28");
        cell.append(d);
      }
      group.append(cell);
    }
    // Between the rows: the two buttons while the column is open; "=" (the same) or "≠" (the first difference) once judged.
    const cx = column.x + column.width / 2, cy = plan.mid.y + plan.mid.height / 2;
    if (v.status === "open") {
      const { button } = plan;
      const pairTop = cy - button.height - button.gap / 2;
      const judge = element("g", {}, "place-value-compare-judge");
      if (tried === k) judge.setAttribute("opacity", "0.4");
      if (tried !== undefined && k === state.marked) {
        // The leftmost place not yet compared is lightly marked.
        judge.append(element("rect", { x: round(cx - button.width / 2 - 6), y: round(pairTop - 6), width: round(button.width + 12), height: round(2 * button.height + button.gap + 12), rx: 24, fill: "none", stroke: COLORS.accent, "stroke-opacity": 0.4, "stroke-width": 3 }, "place-value-compare-next"));
      }
      PLACE_VALUE_COMPARE_JUDGEMENTS.forEach((judgement, j) => {
        const refused = view.refused?.kind === judgement && placeValueCompareTapColumn(state, { tap: view.refused.kind, place: view.refused.place }) === k;
        const y = pairTop + j * (button.height + button.gap);
        const b = element("g", {}, "place-value-compare-button", `place-value-compare-${judgement}`);
        b.dataset.judge = judgement;
        if (refused) b.classList.add("place-value-compare-refused");
        b.append(element("rect", {
          x: round(cx - button.width / 2), y: round(y), width: round(button.width), height: button.height, rx: button.height / 2,
          fill: refused ? "#eceef3" : COLORS.column, stroke: refused ? COLORS.muted : COLORS.accent, "stroke-width": 2, ...(refused ? { "stroke-dasharray": "5 4" } : {}),
        }));
        b.append(text(cx, y + button.height / 2, words.button[judgement], { "text-anchor": "middle", "dominant-baseline": "central", "font-size": button.font, "font-weight": 700, fill: refused ? COLORS.muted : COLORS.accent, "pointer-events": "none" }));
        setTappable(b, `${judgement}:${placeValueCompareColumnTapIndex(place)}`, words.ask(column.head.join(" "), judgement), live);
        judge.append(b);
      });
      group.append(judge);
    } else if (v.status === "same" || v.status === "decides") {
      const mark = element("g", {}, "place-value-compare-mark", `place-value-compare-mark-${v.status}`);
      mark.append(element("circle", { cx: round(cx), cy: round(cy), r: 23, fill: v.status === "same" ? "#e3f0e9" : COLORS.accent, stroke: v.status === "same" ? "#86b9a0" : "none", "stroke-width": 2 }));
      mark.append(text(cx, cy, v.status === "same" ? "=" : "≠", { "text-anchor": "middle", "dominant-baseline": "central", "font-size": 26, "font-weight": 700, fill: v.status === "same" ? COLORS.same : "#ffffff", "pointer-events": "none" }));
      group.append(mark);
    }
    // Once the chart is decided, a tap on a column states its fact (the sketch's): the deciding column, a column the
    // same, or one after it that doesn't matter.
    if (decided) setTappable(group, `column:${placeValueCompareColumnTapIndex(place)}`, column.head.join(" "), live);
    chart.append(group);
  });
  // The columns after the deciding one: one caption across them, "Doesn't matter".
  if (decided && pair.stop < pair.columns.length - 1) {
    const first = plan.columns[pair.stop + 1]!, last = plan.columns.at(-1)!;
    const cx = (first.x + last.x + last.width) / 2, cy = plan.mid.y + plan.mid.height / 2;
    const width = Math.min(last.x + last.width - first.x - 8, placeValueCompareTextWidth(words.caption, 13.5) + 28);
    const caption = element("g", { "pointer-events": "none" }, "place-value-compare-caption");
    caption.append(element("rect", { x: round(cx - width / 2), y: round(cy - 15), width: round(width), height: 30, rx: 15, fill: COLORS.column, stroke: COLORS.slot, "stroke-dasharray": "4 3" }));
    caption.append(text(cx, cy, words.caption, { "text-anchor": "middle", "dominant-baseline": "central", "font-size": 13.5, "font-weight": 600, fill: COLORS.muted }));
    chart.append(caption);
  }
  // The decimal point: a dotted line between the ones and the tenths across both rows, a large point in each.
  if (plan.point) {
    const x = plan.point.x;
    chart.append(element("line", { x1: round(x), x2: round(x), y1: round(top + 10), y2: round(bottom - 10), stroke: COLORS.ink, "stroke-opacity": 0.55, "stroke-width": 3, "stroke-dasharray": "1 6", "stroke-linecap": "round" }, "place-value-compare-pointline"));
    for (const box of [plan.rowA, plan.rowB]) chart.append(element("circle", { cx: round(x), cy: round(box.y + box.height / 2), r: 6.5, fill: COLORS.ink, "aria-label": words.point }, "place-value-compare-point"));
  }
}

/** Draws the sentence "a [> = <] b": greyed and locked until the chart is decided, the sign written once it is chosen. */
function drawSentence(view: View, state: PlaceValueCompareState, live: boolean): void {
  const { sentence: sp } = view.plan;
  const words = PLACE_VALUE_COMPARE_WORDS[view.language];
  const svg = view.sentence;
  svg.replaceChildren();
  if (state.fault) return;
  const decided = placeValueCompareDecided(state);
  const complete = placeValueCompareSigned(state);
  const line = element("g", { opacity: decided ? 1 : 0.45 }, "place-value-compare-line");
  const common = { "font-size": sp.font, "font-weight": 600, fill: COLORS.ink, "font-variant-numeric": "tabular-nums" };
  line.append(text(sp.a.x, sp.baseline, sp.a.text, common, "place-value-compare-a"));
  line.append(text(sp.b.x, sp.baseline, sp.b.text, common, "place-value-compare-b"));
  const slot = element("rect", { x: round(sp.slot.x), y: round(sp.slot.y + 1), width: round(sp.slot.width), height: round(sp.slot.height - 2), rx: 12, fill: "none", stroke: complete ? COLORS.same : COLORS.slot, "stroke-width": 2, ...(complete ? {} : { "stroke-dasharray": "6 4" }) }, "place-value-compare-slot");
  line.append(slot);
  if (complete) {
    line.append(text(sp.slot.x + sp.slot.width / 2, sp.baseline, state.pair.relation, { "text-anchor": "middle", "font-size": 30, "font-weight": 700, fill: COLORS.same }, "place-value-compare-chosen"));
  } else {
    const refusedSign = view.refused?.kind === "sign" ? view.refused.place : undefined;
    for (const { sign, box } of sp.signs) {
      const button = element("g", {}, "place-value-compare-sign");
      button.dataset.sign = sign;
      const refused = refusedSign === placeValueCompareSignIndex(sign);
      if (refused) button.classList.add("place-value-compare-refused");
      button.append(element("rect", { x: round(box.x), y: round(box.y), width: box.width, height: box.height, rx: 9, fill: refused ? "#eceef3" : COLORS.column, stroke: refused ? COLORS.muted : COLORS.accent, "stroke-width": 2, ...(refused ? { "stroke-dasharray": "5 4" } : {}) }));
      button.append(text(box.x + box.width / 2, box.y + box.height / 2, sign, { "text-anchor": "middle", "dominant-baseline": "central", "font-size": 24, "font-weight": 700, fill: refused ? COLORS.muted : COLORS.accent, "pointer-events": "none" }));
      setTappable(button, `sign:${placeValueCompareSignIndex(sign)}`, `${sp.a.text} ${words.signLabel[sign]} ${sp.b.text}`, live && decided);
      line.append(button);
    }
  }
  svg.append(line);
  if (!decided) {
    // While locked: a lock and the fact of when the sentence opens.
    const lock = element("g", {}, "place-value-compare-lock");
    const { x, y } = sp.lock;
    lock.append(element("rect", { x: round(x + 2), y: round(y - 2), width: 11, height: 8, rx: 1.5, fill: COLORS.muted }));
    lock.append(element("path", { d: `M ${round(x + 4.5)} ${round(y - 2)} V ${round(y - 4.5)} a 3 3 0 0 1 6 0 V ${round(y - 2)}`, fill: "none", stroke: COLORS.muted, "stroke-width": 1.8 }));
    lock.append(text(x + 20, y + 2, words.lock, { "dominant-baseline": "central", "font-size": 14.5, "font-weight": 600, fill: COLORS.muted }, "place-value-compare-lock-text"));
    svg.append(lock);
  }
}

/** Draws one state: the chart, the sentence, the instruction (while live) and the line under the chart. */
function draw(view: View, state: PlaceValueCompareState): void {
  const { context } = view;
  const live = context.live === true && view.queue.length === 0 && view.timer === undefined && !placeValueCompareDemonstrating(state);
  drawChart(view, state, live);
  drawSentence(view, state, live);
  view.howto.textContent = context.live === true ? placeValueCompareInstruction(state, view.language) : "";
  // A refusal says its fact; else the chart's own fact (not while the demonstration shows: the lesson narrates it).
  const fact = view.refused ? view.refused.text : placeValueCompareDemonstrating(state) ? "" : placeValueCompareFactText(state, view.language);
  view.notice.textContent = fact;
  view.notice.classList.toggle("place-value-compare-done", !view.refused && placeValueCompareSigned(state) && !placeValueCompareDemonstrating(state));
  view.shown = state;
  view.drawnContext = JSON.stringify([context.live === true, view.refused?.key ?? null, view.focus ?? null]);
}

// ---------------------------------------------------------------- animation

const reduced = (view: View): boolean => view.context.reducedMotion === true || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
const canAnimate = (node: Element): boolean => typeof (node as Element & { animate?: unknown }).animate === "function";

/** The column just judged: each disk pulses together with its partner in the other row; with `pace`, over that long. */
function pulse(view: View, k: number, pace?: number): void {
  const group = view.chart.querySelector(`.place-value-compare-column[data-index="${k}"]`);
  if (!group) return;
  for (const row of ["a", "b"]) {
    for (const node of group.querySelectorAll(`.place-value-compare-cell[data-row="${row}"] .place-value-compare-disk`)) {
      if (!canAnimate(node)) continue;
      const i = Number((node as SVGElement).dataset.i);
      const n = group.querySelectorAll(`.place-value-compare-cell[data-row="${row}"] .place-value-compare-disk`).length;
      const stretch = pace ? Math.max(1, pace / (380 + Math.max(0, n - 1) * 70)) : 1;
      (node as SVGGElement).style.transformBox = "fill-box";
      (node as SVGGElement).style.transformOrigin = "center";
      node.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 380 * stretch, delay: i * 70 * stretch });
    }
  }
}

/** A refused button shakes. */
function shake(view: View): void {
  const node = view.svg.querySelector(".place-value-compare-refused") ?? view.sentence.querySelector(".place-value-compare-refused");
  if (node && canAnimate(node)) node.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 380 });
}

/** Plays the demonstration's queued steps, one at a time: the column being judged is ringed while its step shows. */
function play(view: View): void {
  if (view.timer !== undefined) return;
  const step = view.queue.shift();
  if (!step) { view.focus = undefined; if (view.shown) draw(view, view.shown); return; }
  const next = step.state;
  view.focus = next.marked > 0 && next.marked <= next.pair.stop + 1 && !next.signed ? next.marked - 1 : undefined;
  draw(view, next);
  if (view.focus !== undefined && !reduced(view)) { try { pulse(view, view.focus, step.pace); } catch { /* drawing goes on */ } }
  view.timer = setTimeout(() => {
    view.timer = undefined;
    if (!view.svg.isConnected) { view.queue = []; return; }
    play(view);
  }, step.pace);
}

const samePair = (x: PlaceValueCompareState | undefined, y: PlaceValueCompareState): boolean =>
  !!x && !x.fault && !y.fault && x.pair.a === y.pair.a && x.pair.b === y.pair.b && x.pair.aDec === y.pair.aDec && x.pair.bDec === y.pair.bDec;

/** The demonstration's steps from the state drawn to a new one, when "compared" only went forward on the same pair. */
function stepsBetween(from: PlaceValueCompareState, to: PlaceValueCompareState): PlaceValueCompareState[] | undefined {
  if (!samePair(from, to) || !placeValueCompareDemonstrating(to)) return undefined;
  if (from.compared === 0 && (from.marked !== 0 || from.signed)) return undefined;
  if (to.compared <= from.compared) return undefined;
  const out: PlaceValueCompareState[] = [];
  for (let k = from.compared + 1; k <= to.compared; k += 1) out.push({ ...to, marked: Math.min(k, to.pair.stop + 1), signed: k === to.pair.stop + 2, compared: k });
  return out;
}

const stateKey = (state: PlaceValueCompareState): string => JSON.stringify([state.pair.a, state.pair.aDec, state.pair.b, state.pair.bDec, state.fault ?? null, state.marked, state.signed, state.compared]);

function update(view: View, raw: Record<string, unknown>, context: PlaceValueCompareViewContext): void {
  view.context = context;
  const state = placeValueCompareState(raw);
  view.given.textContent = state.fault ? "" : placeValueCompareProblemText(state.pair, view.language);
  // The refused tap the notice answers, with its reason on the card as it stands (a refusal never changes the card).
  const refusedKey = context.refused && context.notice ? `${context.refused.kind}:${context.refused.place}:${context.notice}` : undefined;
  let refusedNow = false;
  if (refusedKey === undefined) view.dropped = undefined;
  if (refusedKey !== view.refused?.key && refusedKey !== view.dropped) {
    view.refused = undefined;
    if (refusedKey && context.refused) {
      const tap = { tap: context.refused.kind as PlaceValueCompareTapKind, place: context.refused.place };
      const result = applyPlaceValueCompareTap(state, tap);
      if (!result.ok) { view.refused = { kind: tap.tap, place: tap.place, reason: result.reason, text: context.notice!, key: refusedKey }; refusedNow = true; }
    }
  }
  const shown = view.target ?? view.shown;
  if (shown && stateKey(shown) === stateKey(state)) {
    const key = JSON.stringify([context.live === true, view.refused?.key ?? null, view.focus ?? null]);
    if (!view.queue.length && view.timer === undefined && key !== view.drawnContext) draw(view, view.shown ?? state);
    if (refusedNow && !reduced(view)) { try { shake(view); } catch { /* drawing goes on */ } }
    return;
  }
  // The card changed: an old refusal no longer answers it (a restart or a replay may leave the host's notice behind).
  if (!refusedNow && view.refused) view.dropped = view.refused.key;
  view.refused = refusedNow ? view.refused : undefined;
  const steps = shown ? stepsBetween(shown, state) : undefined;
  view.target = state;
  if (steps && steps.length && !reduced(view)) {
    // One step of the demonstration at its own pace (the player sets "compared" a step at a time); a jump of several quickly.
    const pace = steps.length === 1 && context.demonstrationMs ? context.demonstrationMs : PLACE_VALUE_COMPARE_QUICK_MS;
    view.queue.push(...steps.map((state) => ({ state, pace })));
    play(view);
    return;
  }
  if (view.timer !== undefined) { clearTimeout(view.timer); view.timer = undefined; }
  view.queue = [];
  view.focus = undefined;
  const judged = shown && samePair(shown, state) && !placeValueCompareDemonstrating(state) && state.marked === shown.marked + 1 ? shown.marked : undefined;
  draw(view, state);
  if (judged !== undefined && !reduced(view)) { try { pulse(view, judged); } catch { /* drawing goes on */ } }
}

/** Draws the card into an empty parent. */
export function renderPlaceValueCompare(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueCompareViewContext): void {
  const view = create(parent, raw, context);
  views.set(parent, view);
  update(view, raw, context);
}

/**
 * Updates a card drawn by `renderPlaceValueCompare` into the same parent. Returns false when the parent holds no such
 * card or its frame (language, columns, the numerals) changed; the caller then redraws.
 */
export function updatePlaceValueCompare(parent: HTMLElement, raw: Record<string, unknown>, context: PlaceValueCompareViewContext): boolean {
  const view = views.get(parent);
  if (!view || !view.svg.isConnected || view.frame !== frameOf(raw, planPlaceValueCompare(raw))) {
    if (view?.timer !== undefined) clearTimeout(view.timer);
    return false;
  }
  update(view, raw, context);
  return true;
}
