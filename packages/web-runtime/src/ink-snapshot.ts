// Learner ink cards show a frozen snapshot that the host resolves. Inline
// markup is reduced to plain drawing elements before it reaches the page, so a
// snapshot can never carry scripts, links, styles or external references.

const SVG_NS = "http://www.w3.org/2000/svg";
const DRAWING_ELEMENTS = new Set(["svg", "g", "path", "polyline", "line", "circle", "ellipse", "rect"]);
const DRAWING_ATTRIBUTES = new Set([
  "viewBox", "width", "height", "d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "fill-opacity", "opacity", "transform",
]);
const SAFE_VALUE = /^[\w\s.,#%()+-]*$/;
const STROKE_ATTRIBUTE = "data-oll-stroke";
const STROKE_ELEMENTS = "path, polyline, line, circle, ellipse, rect";

function copyDrawing(source: Element, document: Document): Element | undefined {
  const name = source.localName;
  if (!DRAWING_ELEMENTS.has(name)) return undefined;
  const target = document.createElementNS(SVG_NS, name);
  for (const attribute of Array.from(source.attributes)) {
    if (DRAWING_ATTRIBUTES.has(attribute.name) && SAFE_VALUE.test(attribute.value)) target.setAttribute(attribute.name, attribute.value);
  }
  // A stroke's number in drawing order, on the group holding its paths.
  const stroke = source.getAttribute(STROKE_ATTRIBUTE);
  if (name === "g" && stroke !== null && /^\d{1,5}$/.test(stroke)) target.setAttribute(STROKE_ATTRIBUTE, stroke);
  for (const child of Array.from(source.children)) {
    const copied = copyDrawing(child, document);
    if (copied) target.append(copied);
  }
  return target;
}

/** Parses snapshot markup into a drawing-only SVG element, or undefined when it is not SVG. */
export function sanitizeInkSvg(markup: string, document: Document): SVGSVGElement | undefined {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (!root || root.localName !== "svg" || parsed.getElementsByTagName("parsererror").length) return undefined;
  return copyDrawing(root, document) as SVGSVGElement | undefined;
}

/** Drawn elements in the order they were drawn. */
export function inkStrokes(svg: SVGSVGElement): SVGGeometryElement[] {
  return Array.from(svg.querySelectorAll<SVGGeometryElement>(STROKE_ELEMENTS));
}

/**
 * The learner's strokes in drawing order, each with the elements that draw
 * it. Snapshots that number their strokes group a stroke's paths together;
 * in older snapshots every drawn element is a stroke of its own.
 */
export function inkStrokeGroups(svg: SVGSVGElement): SVGGeometryElement[][] {
  const numbered = Array.from(svg.querySelectorAll<SVGGElement>(`g[${STROKE_ATTRIBUTE}]`));
  if (!numbered.length) return inkStrokes(svg).map((element) => [element]);
  return numbered
    .sort((left, right) => Number(left.getAttribute(STROKE_ATTRIBUTE)) - Number(right.getAttribute(STROKE_ATTRIBUTE)))
    .map((group) => Array.from(group.querySelectorAll<SVGGeometryElement>(STROKE_ELEMENTS)));
}

/** Shows only the first `count` strokes; the rest are removed until a later revision shows them. */
export function limitInkStrokes(svg: SVGSVGElement, count: number): void {
  inkStrokeGroups(svg).slice(Math.max(0, count)).flat().forEach((element) => element.remove());
}

/**
 * Prepares strokes to be drawn one after another, from stroke `from` on;
 * earlier strokes are already on the board and stay still. Each stroke gets
 * its length and start delay as custom properties; the stylesheet animates
 * them and skips the animation when the viewer prefers reduced motion.
 */
export function prepareStrokeReplay(svg: SVGSVGElement, totalMs = 1_800, from = 0): void {
  const groups = inkStrokeGroups(svg);
  const drawn = groups.slice(Math.max(0, from));
  if (!drawn.length) return;
  // A few strokes added to writing already on the board are drawn at writing pace, not stretched.
  const step = from > 0 ? Math.min(totalMs / drawn.length, 300) : totalMs / drawn.length;
  groups.slice(0, Math.max(0, from)).flat().forEach((element) => element.classList.add("ink-still"));
  drawn.forEach((group, index) => {
    for (const stroke of group) {
      let length = 1_000;
      try { length = Math.max(1, Math.ceil(stroke.getTotalLength())); } catch { /* Lengths need layout; a generous dash still reveals the stroke. */ }
      stroke.style.setProperty("--ink-length", String(length));
      stroke.style.setProperty("--ink-delay", `${Math.round(index * step)}ms`);
      stroke.style.setProperty("--ink-duration", `${Math.max(120, Math.round(step))}ms`);
    }
  });
  svg.classList.add("ink-replay");
}
