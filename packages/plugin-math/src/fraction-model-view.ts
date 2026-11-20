/**
 * Draws a `fraction_model` card (decision 0021, amended) as SVG from its plan (fraction-model.ts).
 * Values come from the content as the board state holds it, with bindings already applied. The view
 * draws whole parts only: a full turn is a disc, an empty fraction shades nothing.
 */
import { planFractionModel, type FractionPartShape } from "./fraction-model.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface FractionModelViewContext {
  /** Applies the latest emphasis of a part (`data-id`) to its element. */
  applyEmphasis(element: Element, id: string): void;
}

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>, ...classes: string[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (classes.length) node.classList.add(...classes);
  return node;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** A point on a circle, the angle in degrees clockwise from 12 o'clock. */
function onCircle(cx: number, cy: number, r: number, degrees: number): [number, number] {
  const radians = (degrees - 90) * Math.PI / 180;
  return [round(cx + r * Math.cos(radians)), round(cy + r * Math.sin(radians))];
}

/** The SVG element for one part: a rectangle, a disc (a full turn) or a sector. */
export function partElement(shape: FractionPartShape, ...classes: string[]): SVGElement {
  if (shape.kind === "rect") {
    return element("rect", { x: round(shape.x), y: round(shape.y), width: round(shape.width), height: round(shape.height) }, ...classes);
  }
  if (shape.to - shape.from >= 360 - 1e-9) return element("circle", { cx: round(shape.cx), cy: round(shape.cy), r: round(shape.r) }, ...classes);
  const [x1, y1] = onCircle(shape.cx, shape.cy, shape.r, shape.from);
  const [x2, y2] = onCircle(shape.cx, shape.cy, shape.r, shape.to);
  const large = shape.to - shape.from > 180 ? 1 : 0;
  const d = `M ${round(shape.cx)} ${round(shape.cy)} L ${x1} ${y1} A ${round(shape.r)} ${round(shape.r)} 0 ${large} 1 ${x2} ${y2} Z`;
  return element("path", { d }, ...classes);
}

/** A stacked fraction (numerator over a bar over the denominator), centred on (x, y). */
function stackedFraction(group: SVGGElement, numerator: number, denominator: number, x: number, y: number): void {
  const width = Math.max(String(numerator).length, String(denominator).length) * 10 + 10;
  const top = element("text", { x, y: y - 7, "text-anchor": "middle" }, "fraction-model-label");
  top.textContent = String(numerator);
  const bottom = element("text", { x, y: y + 21, "text-anchor": "middle" }, "fraction-model-label");
  bottom.textContent = String(denominator);
  group.append(top, element("line", { x1: x - width / 2, x2: x + width / 2, y1: y, y2: y }, "fraction-model-label-bar"), bottom);
}

export function renderFractionModel(parent: HTMLElement, raw: Record<string, unknown>, context: FractionModelViewContext): void {
  const plan = planFractionModel(raw);
  const svg = element("svg", { viewBox: `0 0 ${plan.width} ${plan.height}`, role: "img" }, "fraction-model-preview");
  for (const fraction of plan.fractions) {
    const group = element("g", {}, "fraction-model-fraction");
    group.dataset.id = fraction.id;
    for (const whole of fraction.wholes) {
      for (const part of whole.parts) group.append(partElement(part.shape, "fraction-model-part", part.shaded ? "fraction-model-part-shaded" : "fraction-model-part-empty"));
      for (const piece of whole.highlights) group.append(partElement(piece, "fraction-model-highlight"));
      for (const [x1, y1, x2, y2] of whole.splits) group.append(element("line", { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) }, "fraction-model-split"));
      group.append(partElement(whole.outline, "fraction-model-outline"));
    }
    stackedFraction(group, fraction.numerator, fraction.denominator, fraction.label.x, fraction.label.y);
    if (fraction.form) {
      const form = element("text", { x: round(fraction.form.x), y: round(fraction.form.y), "text-anchor": "start" }, "fraction-model-form");
      form.textContent = fraction.form.text;
      group.append(form);
    }
    context.applyEmphasis(group, fraction.id);
    svg.append(group);
  }
  if (plan.relation) {
    const relation = element("text", { x: round(plan.relation.x), y: plan.relation.y, "text-anchor": "middle" }, "fraction-model-relation");
    relation.textContent = plan.relation.text;
    svg.append(relation);
  }
  parent.append(svg);
  const caption = (raw as { caption?: unknown }).caption;
  if (typeof caption === "string" && caption) {
    const node = document.createElement("div");
    node.className = "fraction-model-caption";
    node.textContent = caption;
    parent.append(node);
  }
}
