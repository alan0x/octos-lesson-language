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

function copyDrawing(source: Element, document: Document): Element | undefined {
  const name = source.localName;
  if (!DRAWING_ELEMENTS.has(name)) return undefined;
  const target = document.createElementNS(SVG_NS, name);
  for (const attribute of Array.from(source.attributes)) {
    if (DRAWING_ATTRIBUTES.has(attribute.name) && SAFE_VALUE.test(attribute.value)) target.setAttribute(attribute.name, attribute.value);
  }
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

/** Strokes in the order they were drawn, for replay. */
export function inkStrokes(svg: SVGSVGElement): SVGGeometryElement[] {
  return Array.from(svg.querySelectorAll<SVGGeometryElement>("path, polyline, line, circle, ellipse, rect"));
}

/**
 * Prepares strokes to be drawn one after another. Each stroke gets its length
 * and start delay as custom properties; the stylesheet animates them and skips
 * the animation when the viewer prefers reduced motion.
 */
export function prepareStrokeReplay(svg: SVGSVGElement, totalMs = 1_800): void {
  const strokes = inkStrokes(svg);
  if (!strokes.length) return;
  const step = totalMs / strokes.length;
  strokes.forEach((stroke, index) => {
    let length = 1_000;
    try { length = Math.max(1, Math.ceil(stroke.getTotalLength())); } catch { /* Lengths need layout; a generous dash still reveals the stroke. */ }
    stroke.style.setProperty("--ink-length", String(length));
    stroke.style.setProperty("--ink-delay", `${Math.round(index * step)}ms`);
    stroke.style.setProperty("--ink-duration", `${Math.max(120, Math.round(step))}ms`);
  });
  svg.classList.add("ink-replay");
}
