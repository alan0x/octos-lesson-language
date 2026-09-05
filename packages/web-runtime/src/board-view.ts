import { renderPlotExplorer } from "./plot-explorer.js";
import type { CanonicalAction, SemanticBoardState } from "../../core/src/index.js";
import type { PlaybackOperation } from "../../player-core/src/index.js";
import katex from "katex";
import type { ImageAssetResolver } from "./assets.js";
import {
  describeBoardTarget,
  rankBoardTargets,
  targetQueryScore,
  type BoardTargetCandidate,
  type BoardTargetQuery,
} from "./board-targets.js";
import {
  boardToViewportPoint,
  planFocusCamera,
  viewportToBoardPoint,
  type AttentionMode,
  TeachingCameraAuthority,
  type BoardPoint,
  type CameraState,
  type ViewportInsets,
} from "./camera.js";
import { boardInputTargetsInteractiveUi } from "./input-routing.js";
import { computeConnectionRoute, routePath, stackConnectionLabel } from "./connection-layout.js";
import {
  computeBoardLayout,
  targetRect,
  type BoardLayout,
  type MeasuredNodeSizes,
  type Rect,
  type RegionLayoutConstraint,
} from "./layout.js";
import {
  secantMeasurement,
  zeroAxisPosition,
  plotPathData,
  referencedPlotVariables,
  sampleImplicitPlotExpression,
  samplePlotExpression,
  type PlotRange,
} from "./plot.js";
import {
  studentInputMethod,
  type StudentInputMethod,
  type StudentVariableInputHandler,
} from "./student-operations.js";
import {
  renderScene3d,
  type Scene3dViewInputHandler,
  type Scene3dViewState,
} from "./scene3d.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const EMPHASIS_CLASSES = ["emphasis-focus", "emphasis-supporting", "emphasis-warning", "emphasis-resolved"];
const EMPHASIS_KINDS = new Set(["focus", "supporting", "warning", "resolved"]);

function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function setRect(element: HTMLElement, rect: Rect): void {
  Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}

export interface InlineTextSegment {
  kind: "text" | "math";
  value: string;
}

function isEscaped(value: string, cursor: number): boolean {
  let escapes = 0;
  for (let prior = cursor - 1; prior >= 0 && value[prior] === "\\"; prior -= 1) escapes += 1;
  return escapes % 2 !== 0;
}

function closingDollar(value: string, start: number, delimiter: "$" | "$$"): number {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (!value.startsWith(delimiter, cursor) || isEscaped(value, cursor)) continue;
    if (delimiter === "$" && value[cursor + 1] === "$") continue;
    if (delimiter === "$$" && value[cursor + 2] === "$") continue;
    return cursor;
  }
  return -1;
}

export function inlineMathSegments(value: string): InlineTextSegment[] {
  const segments: InlineTextSegment[] = [];
  let textStart = 0;
  let cursor = 0;
  const appendMath = (start: number, end: number, delimiterLength: number): boolean => {
    const source = value.slice(start + delimiterLength, end).trim();
    if (!source) return false;
    if (start > textStart) segments.push({ kind: "text", value: value.slice(textStart, start) });
    segments.push({ kind: "math", value: source });
    cursor = end + delimiterLength;
    textStart = cursor;
    return true;
  };

  while (cursor < value.length) {
    if (value.startsWith("$$", cursor) && !isEscaped(value, cursor)) {
      const end = closingDollar(value, cursor + 2, "$$");
      if (end >= 0 && appendMath(cursor, end, 2)) continue;
    } else if (value.startsWith("\\(", cursor) && !isEscaped(value, cursor)) {
      const end = value.indexOf("\\)", cursor + 2);
      if (end >= 0 && appendMath(cursor, end, 2)) continue;
    } else if (value[cursor] === "$" && value[cursor + 1] !== "$" && !isEscaped(value, cursor)) {
      const end = closingDollar(value, cursor + 1, "$");
      if (end >= 0 && appendMath(cursor, end, 1)) continue;
    }
    cursor += 1;
  }
  if (textStart < value.length) segments.push({ kind: "text", value: value.slice(textStart) });
  return segments.length ? segments : [{ kind: "text", value }];
}

function renderInlineText(element: HTMLElement, value: string): void {
  const segments = inlineMathSegments(value);
  if (segments.every((segment) => segment.kind === "text")) {
    element.textContent = value;
  } else {
    for (const segment of segments) {
      if (segment.kind === "text") {
        element.append(document.createTextNode(segment.value));
        continue;
      }
      const math = document.createElement("span");
      math.className = "inline-math";
      katex.render(segment.value, math, {
        displayMode: false,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml",
      });
      element.append(math);
    }
  }
}

function appendText(parent: HTMLElement, value: string, className?: string): HTMLElement {
  const element = document.createElement("div");
  if (className) element.className = className;
  renderInlineText(element, value);
  parent.append(element);
  return element;
}

function latestEmphasis(owner: Record<string, any>, fragmentId?: string): string | undefined {
  const entries = Array.isArray(owner.emphasis) ? owner.emphasis : [];
  return [...entries].reverse().find((entry: Record<string, any>) => fragmentId
    ? entry.target?.fragment_id === fragmentId
    : !entry.target?.fragment_id)?.emphasis;
}

export function emphasisClassName(emphasis: string | undefined): string | undefined {
  const normalized = emphasis?.trim().toLowerCase();
  if (!normalized) return undefined;
  // The frozen OLL schema permits descriptive strings here, while the visual
  // runtime currently exposes four semantic emphasis styles. Unknown values
  // still mean "draw attention"; degrade them to focus instead of injecting
  // model-authored prose into DOMTokenList and crashing the whole lesson.
  return `emphasis-${EMPHASIS_KINDS.has(normalized) ? normalized : "focus"}`;
}

export function cameraFocusTargets(
  operation: PlaybackOperation | undefined,
  boardFocus: string[],
  lastAttentionTargets: string[],
): string[] {
  const operationFocus = operation?.action?.focus?.targets ?? [];
  if (operationFocus.length) return operationFocus;
  if (operation?.type !== "beat.end" && operation?.type !== "step.commit") return [];
  return lastAttentionTargets.length ? lastAttentionTargets : boardFocus;
}

export function focusTargetsInRegion(
  board: SemanticBoardState,
  targetIds: string[],
  regionId: string | undefined,
): string[] {
  if (!regionId) return [...targetIds];
  const regionsFor = (id: string, visited = new Set<string>()): Set<string> => {
    if (visited.has(id)) return new Set();
    visited.add(id);
    const node = board.nodes[id];
    if (node) return new Set([node.region_id ?? "__legacy__"]);
    const regions = new Set<string>();
    const group = board.groups[id];
    for (const member of group?.members ?? []) {
      for (const memberRegion of regionsFor(member, new Set(visited))) regions.add(memberRegion);
    }
    const connection = board.connections[id];
    for (const endpoint of [connection?.from, connection?.to]) {
      const endpointId = endpoint?.node_id ?? endpoint?.group_id ?? endpoint?.connection_id;
      if (!endpointId) continue;
      for (const endpointRegion of regionsFor(endpointId, new Set(visited))) regions.add(endpointRegion);
    }
    return regions;
  };
  return targetIds.filter((id) => regionsFor(id).has(regionId));
}

export function variableAnimationFocusTargets(
  board: SemanticBoardState,
  variable: string,
): string[] {
  const token = new RegExp(`(^|[^a-z0-9_])${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`, "i");
  return Object.values(board.nodes)
    .filter((node) => (
      (Array.isArray(node.content?.bindings) ? node.content.bindings : [])
        .some((binding: Record<string, unknown>) => typeof binding.expression === "string" && token.test(binding.expression))
      || (node.kind === "plot" && (Array.isArray(node.content?.curves) ? node.content.curves : [])
        .some((curve: Record<string, unknown>) => typeof curve.expression === "string" && token.test(curve.expression)))
    ))
    .map((node) => node.id);
}

const PRIMARY_TEACHING_VISUAL_KINDS = new Set([
  "geometry",
  "plot",
  "scene3d",
  "diagram",
  "image",
  "table",
]);

function connectionPeerId(
  connection: Record<string, any>,
  nodeId: string,
): string | undefined {
  const endpointId = (endpoint: Record<string, any> | undefined) =>
    endpoint?.node_id ?? endpoint?.group_id ?? endpoint?.connection_id;
  const from = endpointId(connection.from);
  const to = endpointId(connection.to);
  return from === nodeId ? to : to === nodeId ? from : undefined;
}

/**
 * Keep the visual being explained in the camera composition even when a Beat
 * focuses only a supporting formula or note. This uses existing region,
 * connection, and layout data; it does not infer meaning from lesson prose.
 */
export function supportingVisualFocusTargets(
  targetIds: string[],
  board: SemanticBoardState,
  layout: BoardLayout,
): string[] {
  const result = new Set<string>();
  for (const targetId of targetIds) {
    const node = board.nodes[targetId];
    if (!node || typeof node.region_id !== "string" || !node.region_id) continue;
    const nodeKind = String(node.kind ?? "");
    if (PRIMARY_TEACHING_VISUAL_KINDS.has(nodeKind)) {
      for (const connection of Object.values(board.connections)) {
        const peerId = connectionPeerId(connection, targetId);
        const peer = peerId ? board.nodes[peerId] : undefined;
        if (peer && peer.region_id === node.region_id
          && PRIMARY_TEACHING_VISUAL_KINDS.has(String(peer.kind ?? ""))) {
          result.add(peer.id);
        }
      }
      continue;
    }

    const targetRect = layout.nodes[targetId];
    if (!targetRect) continue;
    const candidates = Object.values(board.nodes).filter((candidate) =>
      candidate.id !== targetId
      && candidate.region_id === node.region_id
      && PRIMARY_TEACHING_VISUAL_KINDS.has(String(candidate.kind ?? ""))
      && Boolean(layout.nodes[candidate.id]));
    const centerDistance = (candidate: typeof candidates[number]) => {
      const rect = layout.nodes[candidate.id]!;
      return Math.hypot(
        rect.x + rect.width / 2 - (targetRect.x + targetRect.width / 2),
        rect.y + rect.height / 2 - (targetRect.y + targetRect.height / 2),
      );
    };
    candidates.sort((left, right) => centerDistance(left) - centerDistance(right));
    if (candidates[0]) result.add(candidates[0].id);
  }
  return [...result];
}

function applyEmphasisClass(element: Element, emphasis: string | undefined): void {
  const className = emphasisClassName(emphasis);
  if (className) element.classList.add(className);
}

function syncEmphasisClass(element: Element, emphasis: string | undefined): void {
  element.classList.remove(...EMPHASIS_CLASSES);
  applyEmphasisClass(element, emphasis);
}

function nodeContentSignature(node: Record<string, any>): string {
  return JSON.stringify({ kind: node.kind, role: node.role, content: node.content });
}

function plotVariableSignature(node: Record<string, any>, variables: Record<string, number>): string {
  const expressions = Array.isArray(node.content?.curves)
    ? node.content.curves.map((curve: Record<string, any>) => text(curve.expression)).filter(Boolean)
    : [];
  return JSON.stringify(referencedPlotVariables(expressions, variables));
}

export function mathSource(content: Record<string, any>): string {
  const raw = Array.isArray(content.fragments)
    ? content.fragments.map((fragment: Record<string, any>) => text(fragment.latex || fragment.text)).filter(Boolean).join(" ")
    : text(content.latex || content.expression || content.statement || content.rule || content.derivation || content.result || content.text);
  const trimmed = raw.trim();
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) return trimmed.slice(2, -2).trim();
  if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) return trimmed.slice(2, -2).trim();
  if (trimmed.startsWith("$") && trimmed.endsWith("$")) return trimmed.slice(1, -1).trim();
  return trimmed;
}

export function isPlainTextMathContent(content: Record<string, any>): boolean {
  return typeof content.text === "string"
    && content.text.trim().length > 0
    && !content.latex
    && !content.expression
    && !content.statement
    && !content.rule
    && !content.derivation
    && !content.result
    && !Array.isArray(content.fragments);
}

export function mathDisplayLines(source: string): string[] {
  const parts = source
    .split(/\s*(?:=>|⟹|⇒|\\Rightarrow|\\Longrightarrow|\\implies)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || (parts.length === 2 && source.length < 52)) {
    return [source];
  }
  return [parts[0]!, ...parts.slice(1).map((part) => `\\Rightarrow ${part}`)];
}

export function fitMathScale(contentWidth: number, availableWidth: number): number {
  if (contentWidth <= 0 || availableWidth <= 0 || contentWidth <= availableWidth) return 1;
  return availableWidth / contentWidth;
}

function fitRenderedMath(parent: HTMLElement): void {
  const render = parent.querySelector<HTMLElement>(".math-render");
  if (!render || render.classList.contains("math-fragments") || render.classList.contains("math-plain-text")) return;
  const displays = render.querySelectorAll<HTMLElement>(".katex-display");
  for (const display of displays) {
    const formula = display.querySelector<HTMLElement>(".katex");
    const container = display.closest<HTMLElement>(".math-line") ?? render;
    if (!formula) continue;
    display.classList.remove("math-fitted");
    formula.style.removeProperty("transform");
    formula.style.removeProperty("transform-origin");
    const scale = fitMathScale(formula.scrollWidth, container.clientWidth);
    if (scale >= 1) continue;
    display.classList.add("math-fitted");
    formula.style.transform = `scale(${scale})`;
    formula.style.transformOrigin = "left center";
  }
}

function renderMath(parent: HTMLElement, node: Record<string, any>): void {
  const content = node.content ?? {};
  const fragments = Array.isArray(content.fragments) ? content.fragments as Record<string, any>[] : [];
  const element = document.createElement("div"); element.className = "math-render";
  // Authoring models occasionally classify a multi-line explanation as a
  // math card while supplying only `content.text`. Feeding that prose to
  // KaTeX collapses line breaks into one enormous formula and forces a
  // horizontal scrollbar. Keep the semantic card, but render its actual
  // payload as readable multi-line text when no mathematical source exists.
  if (isPlainTextMathContent(content)) {
    element.classList.add("math-plain-text");
    element.textContent = content.text;
    parent.append(element);
    return;
  }
  if (fragments.length) {
    element.classList.add("math-fragments");
    for (const fragment of fragments) {
      const part = document.createElement("span"); part.className = "math-fragment"; part.dataset.id = text(fragment.id);
      applyEmphasisClass(part, latestEmphasis(node, text(fragment.id)));
      katex.render(text(fragment.latex || fragment.text), part, { displayMode: false, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });
      element.append(part);
    }
    parent.append(element); return;
  }
  const source = mathSource(content);
  if (!source) { element.textContent = "（空公式）"; parent.append(element); return; }
  const lines = mathDisplayLines(source);
  if (lines.length > 1) {
    element.classList.add("math-lines");
    for (const line of lines) {
      const part = document.createElement("div");
      part.className = "math-line";
      katex.render(line, part, { displayMode: true, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });
      element.append(part);
    }
    parent.append(element);
    return;
  }
  katex.render(source, element, { displayMode: true, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });
  parent.append(element);
}

const PLOT_LEFT = 28;
const PLOT_RIGHT = 292;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 132;

function plotRange(value: unknown, fallback: PlotRange): PlotRange {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const min = Number(candidate.min);
  const max = Number(candidate.max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : fallback;
}

function plotTicks(range: PlotRange, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, index) => range.min + (range.max - range.min) * index / count);
}

function plotTickLabel(value: number): string {
  const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toPrecision(3));
  return String(rounded);
}

function appendPlotLine(
  svg: SVGSVGElement,
  className: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.classList.add(className);
  svg.append(line);
  return line;
}

function appendPlotLabel(svg: SVGSVGElement, value: string, x: number, y: number, anchor = "middle"): void {
  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(x));
  label.setAttribute("y", String(y));
  label.setAttribute("text-anchor", anchor);
  label.classList.add("plot-axis-label");
  label.textContent = value;
  svg.append(label);
}

let plotClipSequence = 0;

function drawPlot(
  parent: HTMLElement,
  node: Record<string, any>,
  variables: Record<string, number>,
  width = 300,
  height = 150,
): void {
  const PLOT_LEFT = 30, PLOT_RIGHT = width-12, PLOT_TOP = 10, PLOT_BOTTOM = height-24;
  const content = node.content ?? {};
  const axes = content.axes ?? {};
  const xRange = plotRange(axes.x, { min: -5, max: 5 });
  const yRange = plotRange(axes.y, { min: -5, max: 5 });
  const mapX = (value: number) => PLOT_LEFT + (value - xRange.min) / (xRange.max - xRange.min) * (PLOT_RIGHT - PLOT_LEFT);
  const mapY = (value: number) => PLOT_BOTTOM - (value - yRange.min) / (yRange.max - yRange.min) * (PLOT_BOTTOM - PLOT_TOP);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("plot-preview");

  for (const value of plotTicks(xRange)) {
    const x = mapX(value);
    appendPlotLine(svg, "plot-grid", x, PLOT_TOP, x, PLOT_BOTTOM);
    appendPlotLabel(svg, plotTickLabel(value), x, height-4);
  }
  for (const value of plotTicks(yRange)) {
    const y = mapY(value);
    appendPlotLine(svg, "plot-grid", PLOT_LEFT, y, PLOT_RIGHT, y);
    appendPlotLabel(svg, plotTickLabel(value), PLOT_LEFT - 5, y + 3, "end");
  }
  const xAxisY = zeroAxisPosition(yRange, mapY);
  const yAxisX = zeroAxisPosition(xRange, mapX);
  if (xAxisY !== undefined) appendPlotLine(svg, "plot-axis", PLOT_LEFT, xAxisY, PLOT_RIGHT, xAxisY);
  if (yAxisX !== undefined) appendPlotLine(svg, "plot-axis", yAxisX, PLOT_TOP, yAxisX, PLOT_BOTTOM);
  appendPlotLabel(svg, text(axes.x?.label || "x"), PLOT_RIGHT, PLOT_BOTTOM - 5, "end");
  appendPlotLabel(svg, text(axes.y?.label || "y"), PLOT_LEFT + 6, PLOT_TOP + 9, "start");
  const clipId = `plot-clip-${++plotClipSequence}`;
  const defs = document.createElementNS(SVG_NS, "defs");
  const clip = document.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", clipId);
  const clipRect = document.createElementNS(SVG_NS, "rect");
  for (const [key, value] of Object.entries({x:PLOT_LEFT,y:PLOT_TOP,width:PLOT_RIGHT-PLOT_LEFT,height:PLOT_BOTTOM-PLOT_TOP})) clipRect.setAttribute(key, String(value));
  clip.append(clipRect); defs.append(clip); svg.append(defs);

  for (const guide of Array.isArray(content.guides) ? content.guides : []) {
    const value = Number(guide.value);
    if (!Number.isFinite(value)) continue;
    const horizontal = guide.kind === "horizontal_line";
    if (horizontal ? value < yRange.min || value > yRange.max : value < xRange.min || value > xRange.max) continue;
    const line = horizontal
      ? appendPlotLine(svg, "plot-guide", PLOT_LEFT, mapY(value), PLOT_RIGHT, mapY(value))
      : appendPlotLine(svg, "plot-guide", mapX(value), PLOT_TOP, mapX(value), PLOT_BOTTOM);
    line.dataset.id = text(guide.id);
    applyEmphasisClass(line, latestEmphasis(node, text(guide.id)));
    if (guide.label) {
      appendPlotLabel(
        svg,
        text(guide.label),
        horizontal ? PLOT_RIGHT - 3 : mapX(value) + 4,
        horizontal ? mapY(value) - 4 : PLOT_TOP + 10,
        horizontal ? "end" : "start",
      );
    }
  }

  const curves = Array.isArray(content.curves) ? content.curves : [];
  const renderedCurves: Array<{ curve: Record<string, any>; series: number }> = [];
  curves.forEach((curve: Record<string, any>, index: number) => {
    const expression = text(curve.expression);
    if (!expression) return;
    try {
      const pathData = plotPathData(
        curve.kind === "implicit"
          ? sampleImplicitPlotExpression(expression, xRange, yRange, {
              level: Number(curve.level ?? 0),
              samples: Number(curve.samples ?? 80),
              variables,
            })
          : samplePlotExpression(expression, xRange, yRange, Math.min(1001, Math.max(241, width)), variables),
        mapX,
        mapY,
      );
      if (!pathData) return;
      const path = document.createElementNS(SVG_NS, "path");
      const series = Number(curve.plotSeries ?? index) % 6;
      path.setAttribute("d", pathData);
      path.setAttribute("clip-path", `url(#${clipId})`);
      path.classList.add("plot-curve", `plot-series-${series}`);
      if (series > 0) path.setAttribute("stroke-dasharray", ["", "6 3", "2 3", "8 3 2 3", "10 4", "3 2"][series]!);
      if (curve.id) {
        path.dataset.id = text(curve.id);
        applyEmphasisClass(path, latestEmphasis(node, text(curve.id)));
      }
      svg.append(path);
      renderedCurves.push({ curve, series });
    } catch {
      // Invalid model-authored expressions must not crash the rest of the lesson.
    }
  });

  if (content.measurement === "secant" && content.points?.length === 2) {
    const [a,b] = content.points;
    const measurement = secantMeasurement(a,b);
    if (measurement) {
      const line = appendPlotLine(svg, "plot-secant", mapX(a.x), mapY(a.y), mapX(b.x), mapY(b.y));
      line.setAttribute("clip-path", `url(#${clipId})`);
      const dx = appendPlotLine(svg, "plot-guide", mapX(a.x), mapY(a.y), mapX(b.x), mapY(a.y));
      const dy = appendPlotLine(svg, "plot-guide", mapX(b.x), mapY(a.y), mapX(b.x), mapY(b.y));
      dx.setAttribute("clip-path", `url(#${clipId})`); dy.setAttribute("clip-path", `url(#${clipId})`);
    }
    const display = (n:number) => Number(n.toPrecision(5)).toString();
    appendText(parent, measurement
      ? `Δx = ${display(measurement.dx)} · Δy = ${display(measurement.dy)} · 割线斜率 ≈ ${display(measurement.slope)}`
      : "两点横坐标重合或过近，不能用 Δy/Δx 计算斜率。", "plot-measurement");
    appendText(parent, "通过两个滑块分别调整 A、B 的横坐标。", "plot-control-hint");
  }

  for (const point of Array.isArray(content.points) ? content.points : []) {
    const pointX = Number(point.x);
    const pointY = Number(point.y);
    if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) continue;
    if (pointX < xRange.min || pointX > xRange.max || pointY < yRange.min || pointY > yRange.max) continue;
    const x = mapX(pointX);
    const y = mapY(pointY);
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "5");
    dot.classList.add("plot-point");
    dot.dataset.id = text(point.id);
    applyEmphasisClass(dot, latestEmphasis(node, text(point.id)));
    svg.append(dot);
    if (point.label) {
      const pointLabel = document.createElementNS(SVG_NS, "text");
      pointLabel.setAttribute("x", String(x + 8));
      pointLabel.setAttribute("y", String(y - 8));
      pointLabel.classList.add("plot-label");
      pointLabel.textContent = text(point.label);
      svg.append(pointLabel);
    }
  }
  parent.append(svg);

  if (renderedCurves.length) {
    const legend = document.createElement("div");
    legend.className = "plot-legend";
    for (const { curve, series } of renderedCurves) {
      appendText(
        legend,
        text(curve.label || curve.expression),
        `plot-legend-item plot-series-${series}`,
      );
    }
    parent.append(legend);
  }
}

const GEOMETRY_LEFT = 30;
const GEOMETRY_RIGHT = 288;
const GEOMETRY_TOP = 10;
const GEOMETRY_BOTTOM = 194;

export interface GeometryViewport {
  xRange: PlotRange;
  yRange: PlotRange;
  scale: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  mapX(value: number): number;
  mapY(value: number): number;
}

export function geometryViewport(axes: Record<string, any>): GeometryViewport {
  const xRange = plotRange(axes?.x, { min: -1.25, max: 1.25 });
  const yRange = plotRange(axes?.y, { min: -1.25, max: 1.25 });
  const width = GEOMETRY_RIGHT - GEOMETRY_LEFT;
  const height = GEOMETRY_BOTTOM - GEOMETRY_TOP;
  const scale = Math.min(width / (xRange.max - xRange.min), height / (yRange.max - yRange.min));
  const renderedWidth = (xRange.max - xRange.min) * scale;
  const renderedHeight = (yRange.max - yRange.min) * scale;
  const left = GEOMETRY_LEFT + (width - renderedWidth) / 2;
  const top = GEOMETRY_TOP + (height - renderedHeight) / 2;
  return {
    xRange,
    yRange,
    scale,
    left,
    right: left + renderedWidth,
    top,
    bottom: top + renderedHeight,
    mapX: (value: number) => left + (value - xRange.min) * scale,
    mapY: (value: number) => top + (yRange.max - value) * scale,
  };
}

export function geometryArcPath(
  viewport: GeometryViewport,
  center: { x: number; y: number },
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const delta = endAngle - startAngle;
  const startX = viewport.mapX(center.x + Math.cos(startAngle) * radius);
  const startY = viewport.mapY(center.y + Math.sin(startAngle) * radius);
  const endX = viewport.mapX(center.x + Math.cos(endAngle) * radius);
  const endY = viewport.mapY(center.y + Math.sin(endAngle) * radius);
  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta >= 0 ? 0 : 1;
  const renderedRadius = radius * viewport.scale;
  return `M ${startX} ${startY} A ${renderedRadius} ${renderedRadius} 0 ${largeArc} ${sweep} ${endX} ${endY}`;
}

function appendGeometryLabel(svg: SVGSVGElement, value: unknown, x: number, y: number, anchor = "start"): void {
  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(x));
  label.setAttribute("y", String(y));
  label.setAttribute("text-anchor", anchor);
  label.classList.add("geometry-label");
  label.textContent = text(value);
  svg.append(label);
}

function renderGeometry(parent: HTMLElement, node: Record<string, any>): void {
  const content = node.content ?? {};
  const viewport = geometryViewport(content.axes ?? {});
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 300 210");
  svg.classList.add("geometry-preview");

  for (const value of plotTicks(viewport.xRange)) {
    const x = viewport.mapX(value);
    appendPlotLine(svg, "geometry-grid", x, GEOMETRY_TOP, x, GEOMETRY_BOTTOM);
    appendGeometryLabel(svg, plotTickLabel(value), x, 207, "middle");
  }
  for (const value of plotTicks(viewport.yRange)) {
    const y = viewport.mapY(value);
    appendPlotLine(svg, "geometry-grid", GEOMETRY_LEFT, y, GEOMETRY_RIGHT, y);
    appendGeometryLabel(svg, plotTickLabel(value), GEOMETRY_LEFT - 5, y + 3, "end");
  }
  const zeroY = zeroAxisPosition(viewport.yRange, viewport.mapY);
  const zeroX = zeroAxisPosition(viewport.xRange, viewport.mapX);
  if (zeroY !== undefined) appendPlotLine(svg, "geometry-axis", GEOMETRY_LEFT, zeroY, GEOMETRY_RIGHT, zeroY);
  if (zeroX !== undefined) appendPlotLine(svg, "geometry-axis", zeroX, GEOMETRY_TOP, zeroX, GEOMETRY_BOTTOM);
  const xAxisY = zeroY ?? GEOMETRY_BOTTOM;
  const yAxisX = zeroX ?? GEOMETRY_LEFT;
  appendGeometryLabel(svg, content.axes?.x?.label ?? "x", GEOMETRY_RIGHT - 2, xAxisY - 5, "end");
  appendGeometryLabel(svg, content.axes?.y?.label ?? "y", yAxisX + 5, GEOMETRY_TOP + 10);

  const points = new Map<string, Record<string, any>>();
  for (const point of Array.isArray(content.points) ? content.points : []) {
    const x = Number(point.x);
    const y = Number(point.y);
    if (point.id && Number.isFinite(x) && Number.isFinite(y)) points.set(text(point.id), { ...point, x, y });
  }

  for (const polygon of Array.isArray(content.polygons) ? content.polygons : []) {
    const vertices = Array.isArray(polygon.points)
      ? polygon.points.map((point: unknown) => points.get(text(point))).filter(Boolean)
      : [];
    if (vertices.length < 3 || vertices.length !== polygon.points.length) continue;
    const element = document.createElementNS(SVG_NS, "polygon");
    element.setAttribute("points", vertices.map((point: any) => (
      `${viewport.mapX(point.x)},${viewport.mapY(point.y)}`
    )).join(" "));
    element.classList.add("geometry-polygon", `geometry-polygon-${text(polygon.tone || "primary")}`);
    element.dataset.id = text(polygon.id);
    applyEmphasisClass(element, latestEmphasis(node, text(polygon.id)));
    svg.append(element);
    if (polygon.label) {
      const centroid = vertices.reduce((sum: { x: number; y: number }, point: any) => ({
        x: sum.x + point.x / vertices.length,
        y: sum.y + point.y / vertices.length,
      }), { x: 0, y: 0 });
      appendGeometryLabel(svg, polygon.label, viewport.mapX(centroid.x), viewport.mapY(centroid.y), "middle");
    }
  }

  for (const circle of Array.isArray(content.circles) ? content.circles : []) {
    const center = points.get(text(circle.center));
    const radius = Number(circle.radius);
    if (!center || !Number.isFinite(radius) || radius <= 0) continue;
    const element = document.createElementNS(SVG_NS, "circle");
    element.setAttribute("cx", String(viewport.mapX(center.x)));
    element.setAttribute("cy", String(viewport.mapY(center.y)));
    element.setAttribute("r", String(radius * viewport.scale));
    element.classList.add("geometry-circle");
    element.dataset.id = text(circle.id);
    applyEmphasisClass(element, latestEmphasis(node, text(circle.id)));
    svg.append(element);
    if (circle.label) appendGeometryLabel(svg, circle.label, viewport.mapX(center.x + radius) - 4, viewport.mapY(center.y) - 8, "end");
  }

  for (const segment of Array.isArray(content.segments) ? content.segments : []) {
    const from = points.get(text(segment.from));
    const to = points.get(text(segment.to));
    if (!from || !to) continue;
    const line = appendPlotLine(svg, "geometry-segment", viewport.mapX(from.x), viewport.mapY(from.y), viewport.mapX(to.x), viewport.mapY(to.y));
    line.classList.add(`geometry-segment-${text(segment.style || "solid")}`);
    line.dataset.id = text(segment.id);
    applyEmphasisClass(line, latestEmphasis(node, text(segment.id)));
    if (segment.label) appendGeometryLabel(svg, segment.label, (viewport.mapX(from.x) + viewport.mapX(to.x)) / 2 + 5, (viewport.mapY(from.y) + viewport.mapY(to.y)) / 2 - 6);
  }

  for (const arc of Array.isArray(content.arcs) ? content.arcs : []) {
    const center = points.get(text(arc.center));
    const radius = Number(arc.radius);
    const startAngle = Number(arc.start_angle);
    const endAngle = Number(arc.end_angle);
    if (!center || ![radius, startAngle, endAngle].every(Number.isFinite) || radius <= 0) continue;
    const path = document.createElementNS(SVG_NS, "path");
    const arcPath = geometryArcPath(viewport, { x: center.x, y: center.y }, radius, startAngle, endAngle);
    path.setAttribute("d", arc.filled ? `${arcPath} L ${viewport.mapX(center.x)} ${viewport.mapY(center.y)} Z` : arcPath);
    if (arc.filled) path.classList.add("geometry-sector");
    path.classList.add("geometry-arc");
    path.dataset.id = text(arc.id);
    applyEmphasisClass(path, latestEmphasis(node, text(arc.id)));
    svg.append(path);
    if (arc.label) {
      const middle = (startAngle + endAngle) / 2;
      appendGeometryLabel(svg, arc.label, viewport.mapX(center.x + Math.cos(middle) * (radius + .1)), viewport.mapY(center.y + Math.sin(middle) * (radius + .1)), "middle");
    }
  }

  for (const point of points.values()) {
    if (point.visible === false) continue;
    const x = viewport.mapX(point.x);
    const y = viewport.mapY(point.y);
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "4.5");
    dot.classList.add("geometry-point");
    dot.dataset.id = text(point.id);
    const interaction = point.interaction;
    const interactionCenter = interaction?.kind === "angle_control"
      ? points.get(text(interaction.center))
      : undefined;
    if (interactionCenter && typeof interaction.variable === "string") {
      dot.classList.add("geometry-control-point");
      dot.dataset.ollVariableControl = interaction.variable;
      dot.dataset.angleCenterX = String(viewport.mapX(interactionCenter.x));
      dot.dataset.angleCenterY = String(viewport.mapY(interactionCenter.y));
      dot.setAttribute("aria-label", `${point.label || interaction.variable}：拖动改变角度`);
    }
    applyEmphasisClass(dot, latestEmphasis(node, text(point.id)));
    svg.append(dot);
    if (point.label) appendGeometryLabel(svg, point.label, x + 7, y - 7);
  }
  parent.append(svg);
  if (content.caption) appendText(parent, text(content.caption), "geometry-caption");
}

function diagramPosition(position: string | undefined, index: number, total: number): { x: number; y: number } {
  const semantic: Record<string, { x: number; y: number }> = {
    top: { x: 150, y: 24 }, top_left: { x: 58, y: 34 }, top_right: { x: 242, y: 34 },
    left: { x: 44, y: 94 }, center: { x: 150, y: 94 }, right: { x: 256, y: 94 },
    bottom_left: { x: 42, y: 164 }, bottom_center: { x: 150, y: 164 }, bottom_right: { x: 258, y: 164 }, bottom: { x: 150, y: 164 },
  };
  if (position && semantic[position]) return semantic[position]!;
  const angle = (Math.PI * 2 * index / Math.max(1, total)) - Math.PI / 2;
  return { x: 150 + Math.cos(angle) * 105, y: 94 + Math.sin(angle) * 68 };
}

function orderedDiagramPath(content: Record<string, any>): string[] | undefined {
  const elements = Array.isArray(content.elements) ? content.elements : [];
  const edges = Array.isArray(content.edges) ? content.edges : [];
  if (elements.length < 2 || elements.length > 8 || edges.length !== elements.length - 1) return undefined;
  if (elements.some((element: Record<string, any>) => text(element.semantic_position))) return undefined;
  const ids = new Set(elements.map((element: Record<string, any>) => text(element.id)).filter(Boolean));
  if (ids.size !== elements.length) return undefined;
  const incoming = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    const from = text(edge.from);
    const to = text(edge.to);
    if (!ids.has(from) || !ids.has(to) || from === to) return undefined;
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
    outgoing.get(from)!.push(to);
  }
  const starts = [...ids].filter((id) => (incoming.get(id) ?? 0) === 0);
  const ends = [...ids].filter((id) => (outgoing.get(id)?.length ?? 0) === 0);
  if (starts.length !== 1 || ends.length !== 1) return undefined;
  if ([...ids].some((id) => (incoming.get(id) ?? 0) > 1 || (outgoing.get(id)?.length ?? 0) > 1)) return undefined;
  const ordered: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = starts[0];
  while (current && !visited.has(current)) {
    ordered.push(current);
    visited.add(current);
    current = outgoing.get(current)?.[0];
  }
  return ordered.length === ids.size ? ordered : undefined;
}

function diagramTextUnits(value: string): number {
  return [...value].reduce((total, character) => total + (/[^\u0000-\u00ff]/u.test(character) ? 2 : 1), 0);
}

export function wrapDiagramLabel(value: string, maxUnits: number): string[] {
  const lines: string[] = [];
  let line = "";
  let units = 0;
  for (const character of [...value.trim()]) {
    const characterUnits = /[^\u0000-\u00ff]/u.test(character) ? 2 : 1;
    if (line && units + characterUnits > maxUnits) {
      lines.push(line.trimEnd());
      line = "";
      units = 0;
    }
    if (!line && /\s/u.test(character)) continue;
    line += character;
    units += characterUnits;
  }
  if (line) lines.push(line.trimEnd());
  return lines.length ? lines : [""];
}

export interface DiagramPointLayout {
  x: number;
  y: number;
  label: string;
  lines: string[];
  width?: number;
  height?: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  points: Map<string, DiagramPointLayout>;
  ordered: boolean;
}

export function diagramLayout(content: Record<string, any>): DiagramLayout {
  const elements = Array.isArray(content.elements) ? content.elements : [];
  const orderedPath = orderedDiagramPath(content);
  if (!orderedPath) {
    return {
      width: 300,
      height: 190,
      ordered: false,
      points: new Map(elements.map((element: Record<string, any>, index: number) => {
        const label = text(element.label);
        return [text(element.id), {
          ...diagramPosition(text(element.semantic_position), index, elements.length),
          label,
          lines: [label],
        }];
      })),
    };
  }

  const elementById = new Map(elements.map((element: Record<string, any>) => [text(element.id), element]));
  const longestLabel = Math.max(0, ...elements.map((element: Record<string, any>) => diagramTextUnits(text(element.label))));
  const columns = longestLabel > 12 ? Math.min(2, elements.length) : Math.min(4, elements.length);
  const nodeWidth = columns <= 2 ? 190 : 96;
  const maxLabelUnits = columns <= 2 ? 18 : 8;
  const rows = Math.ceil(elements.length / columns);
  const lineSets = orderedPath.map((id) => wrapDiagramLabel(text(elementById.get(id)?.label), maxLabelUnits));
  const nodeHeights = lineSets.map((lines) => Math.max(42, 18 + lines.length * 17));
  const rowHeights = Array.from({ length: rows }, (_unused, row) => Math.max(
    ...nodeHeights.slice(row * columns, Math.min((row + 1) * columns, nodeHeights.length)),
  ));
  const rowCenters: number[] = [];
  let cursorY = 22;
  for (const rowHeight of rowHeights) {
    rowCenters.push(cursorY + rowHeight / 2);
    cursorY += rowHeight + 54;
  }
  const width = 480;
  const height = Math.max(190, cursorY - 32);
  const orderedIndex = new Map(orderedPath.map((id, index) => [id, index]));
  return {
    width,
    height,
    ordered: true,
    points: new Map(elements.map((element: Record<string, any>) => {
      const index = orderedIndex.get(text(element.id))!;
      const row = Math.floor(index / columns);
      const indexInRow = index % columns;
      const column = row % 2 === 0 ? indexInRow : columns - 1 - indexInRow;
      const x = columns === 1 ? width / 2 : width * (column + .5) / columns;
      const label = text(element.label);
      return [text(element.id), {
        x,
        y: rowCenters[row]!,
        label,
        lines: lineSets[index]!,
        width: nodeWidth,
        height: nodeHeights[index]!,
      }];
    })),
  };
}

function diagramPoints(content: Record<string, any>): Map<string, DiagramPointLayout> {
  return diagramLayout(content).points;
}

export interface DiagramConnectionGeometry {
  from: { x: number; y: number };
  to: { x: number; y: number };
  label: string;
  labelPosition: { x: number; y: number; width: number };
}

export interface InfiniteBoardElements {
  viewport: HTMLElement;
  world: HTMLElement;
  nodes: HTMLElement;
  groups: HTMLElement;
  connections: SVGSVGElement;
  connectionLabels: SVGSVGElement;
  pointer: HTMLElement;
}

export function connectionDisplayLabel(connection: Record<string, any>): string {
  return text(connection.label);
}

export interface MountedInfiniteBoard {
  view: InfiniteBoardView;
  elements: InfiniteBoardElements;
  destroy(): void;
}

export type BoardInputOwner = "runtime" | "ink" | "course-object";
export type CameraListener = (camera: CameraState) => void;
export type VariableInputHandler = StudentVariableInputHandler;

export function angleControlValue(
  rawAngle: number,
  currentValue: number,
  min: number,
  max: number,
  unit?: string,
): number {
  const normalizedUnit = unit?.trim().toLowerCase() ?? "";
  const usesDegrees = !/弧度|radian|rad/u.test(normalizedUnit)
    && /角度|度|°|degree|deg/u.test(normalizedUnit);
  const valueAtPointer = usesDegrees ? rawAngle * 180 / Math.PI : rawAngle;
  const turn = usesDegrees ? 360 : Math.PI * 2;
  const firstTurn = Math.ceil((min - valueAtPointer) / turn - 1e-10);
  const lastTurn = Math.floor((max - valueAtPointer) / turn + 1e-10);
  if (firstTurn <= lastTurn) {
    const closestTurn = Math.min(
      lastTurn,
      Math.max(firstTurn, Math.round((currentValue - valueAtPointer) / turn)),
    );
    return Math.min(max, Math.max(min, valueAtPointer + closestTurn * turn));
  }
  return Math.min(max, Math.max(min, valueAtPointer));
}

export function diagramConnectionGeometry(content: Record<string, any>, connection: Record<string, any>): DiagramConnectionGeometry | undefined {
  const points = diagramPoints(content);
  const from = points.get(text(connection.from?.fragment_id));
  const to = points.get(text(connection.to?.fragment_id));
  if (!from || !to) return undefined;
  const label = connectionDisplayLabel(connection);
  const width = Math.min(112, Math.max(42, [...label].reduce((total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 12 : 7), 0) + 16));
  return {
    from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, label,
    labelPosition: { x: (from.x + to.x) / 2 + width / 2 + 12, y: (from.y + to.y) / 2, width },
  };
}

function renderDiagram(parent: HTMLElement, node: Record<string, any>): void {
  const content = node.content ?? {};
  const layout = diagramLayout(content);
  const points = layout.points;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.classList.add("diagram-preview");
  for (const region of Array.isArray(content.regions) ? content.regions : []) {
    const members = (region.members ?? []).map((id: string) => points.get(id)).filter(Boolean) as { x: number; y: number }[];
    if (members.length < 3) continue;
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", members.map((point) => `${point.x},${point.y}`).join(" "));
    polygon.classList.add("diagram-region"); polygon.dataset.id = text(region.id); applyEmphasisClass(polygon, latestEmphasis(node, text(region.id))); svg.append(polygon);
  }
  for (const edge of Array.isArray(content.edges) ? content.edges : []) {
    const from = points.get(text(edge.from)); const to = points.get(text(edge.to));
    if (!from || !to) continue;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(from.x)); line.setAttribute("y1", String(from.y)); line.setAttribute("x2", String(to.x)); line.setAttribute("y2", String(to.y));
    line.classList.add("diagram-edge"); line.dataset.id = text(edge.id); applyEmphasisClass(line, latestEmphasis(node, text(edge.id))); svg.append(line);
    if (edge.label) {
      const label = document.createElementNS(SVG_NS, "text"); label.setAttribute("x", String((from.x + to.x) / 2)); label.setAttribute("y", String((from.y + to.y) / 2 - 6));
      label.setAttribute("text-anchor", "middle"); label.classList.add("diagram-edge-label"); label.textContent = text(edge.label); svg.append(label);
    }
  }
  for (const [pointId, point] of points) {
    if (point.width && point.height) {
      const box = document.createElementNS(SVG_NS, "rect");
      box.setAttribute("x", String(point.x - point.width / 2)); box.setAttribute("y", String(point.y - point.height / 2));
      box.setAttribute("width", String(point.width)); box.setAttribute("height", String(point.height)); box.setAttribute("rx", "10");
      box.classList.add("diagram-node"); box.dataset.id = pointId; applyEmphasisClass(box, latestEmphasis(node, pointId)); svg.append(box);
      const anchor = document.createElementNS(SVG_NS, "circle"); anchor.setAttribute("cx", String(point.x)); anchor.setAttribute("cy", String(point.y)); anchor.setAttribute("r", "0"); anchor.classList.add("diagram-point", "diagram-anchor"); svg.append(anchor);
      const label = document.createElementNS(SVG_NS, "text"); label.setAttribute("x", String(point.x)); label.setAttribute("text-anchor", "middle"); label.classList.add("diagram-label");
      const firstY = point.y - (point.lines.length - 1) * 8.5 + 5;
      point.lines.forEach((line, index) => {
        const span = document.createElementNS(SVG_NS, "tspan"); span.setAttribute("x", String(point.x)); span.setAttribute("y", String(firstY + index * 17)); span.textContent = line; label.append(span);
      });
      svg.append(label);
    } else {
      const dot = document.createElementNS(SVG_NS, "circle"); dot.setAttribute("cx", String(point.x)); dot.setAttribute("cy", String(point.y)); dot.setAttribute("r", "4"); dot.classList.add("diagram-point"); dot.dataset.id = pointId; applyEmphasisClass(dot, latestEmphasis(node, pointId)); svg.append(dot);
      const label = document.createElementNS(SVG_NS, "text"); label.setAttribute("x", String(point.x + 8)); label.setAttribute("y", String(point.y - 7)); label.classList.add("diagram-label"); label.textContent = point.label; svg.append(label);
    }
  }
  parent.append(svg);
}

function renderImage(parent: HTMLElement, node: Record<string, any>, resolveAsset: ImageAssetResolver): void {
  const content = node.content ?? {};
  const asset = resolveAsset(text(content.asset_id));
  if (!asset) {
    appendText(parent, text(content.alt || "受控课程图片"), "image-placeholder");
    const regions = Array.isArray(content.regions) ? content.regions : [];
    if (regions.length) {
      const pills = document.createElement("div"); pills.className = "region-pills";
      for (const region of regions) {
        const pill = appendText(pills, text(region.label || region.source_region), "");
        pill.dataset.id = text(region.id); applyEmphasisClass(pill, latestEmphasis(node, text(region.id)));
      }
      parent.append(pills);
    }
    return;
  }
  const frame = document.createElement("figure");
  frame.className = "lesson-image-frame";
  frame.style.aspectRatio = `${asset.intrinsic_width} / ${asset.intrinsic_height}`;
  const image = document.createElement("img");
  image.className = "lesson-image";
  image.src = asset.src;
  image.alt = text(content.alt || "课程图片");
  image.draggable = false;
  frame.append(image);
  for (const region of Array.isArray(content.regions) ? content.regions : []) {
    const bounds = asset.regions[text(region.source_region)];
    if (!bounds) continue;
    const overlay = document.createElement("div");
    overlay.className = "image-region";
    overlay.dataset.id = text(region.id);
    overlay.dataset.label = text(region.label);
    Object.assign(overlay.style, {
      left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%`,
      width: `${bounds.width * 100}%`, height: `${bounds.height * 100}%`,
    });
    applyEmphasisClass(overlay, latestEmphasis(node, text(region.id)));
    frame.append(overlay);
  }
  parent.append(frame);
}

function renderContent(
  parent: HTMLElement,
  node: Record<string, any>,
  resolveAsset: ImageAssetResolver,
  sceneView?: Scene3dViewState,
  sceneInput?: Scene3dViewInputHandler,
  variables: Record<string, number> = {},
): void {
  const content = node.content ?? {};
  const title = text(content.title || content.label || (node.role && node.kind !== "math" && node.role !== node.kind ? node.role : ""));
  if (title) appendText(parent, title, "node-title");
  if (node.kind === "geometry") { renderGeometry(parent, node); return; }
  if (node.kind === "plot") { renderPlotExplorer(parent, node, variables, drawPlot); return; }
  if (node.kind === "scene3d") {
    try {
      renderScene3d(parent, node, sceneView, variables, sceneInput);
    } catch {
      appendText(
        parent,
        `三维场景暂时无法交互。静态说明：${text(content.fallback || content.caption || "请结合旁白理解空间关系。")}`,
        "scene3d-fallback-error",
      );
    }
    return;
  }
  if (node.kind === "diagram" && Array.isArray(content.elements)) { renderDiagram(parent, node); return; }
  if (node.kind === "math") { renderMath(parent, node); if (content.caption) appendText(parent, text(content.caption), "node-caption"); return; }
  if (node.kind === "image") {
    renderImage(parent, node, resolveAsset); return;
  }
  if (node.kind === "table") {
    const table = document.createElement("table"); table.className = "content-table";
    if (Array.isArray(content.columns)) {
      const row = document.createElement("tr");
      content.columns.forEach((column: unknown, columnIndex: number) => {
        const cell = document.createElement("th");
        const value = text(column);
        cell.dataset.ollTargetId = `${node.id}:table:header:${columnIndex}`;
        cell.dataset.ollTargetKind = "table-cell";
        cell.dataset.ollTargetLabel = value;
        cell.dataset.ollTargetValue = value;
        renderInlineText(cell, value);
        row.append(cell);
      });
      table.append(row);
    }
    for (const [rowIndex, values] of (Array.isArray(content.rows) ? content.rows : []).entries()) {
      const row = document.createElement("tr");
      for (const [columnIndex, value] of values.entries()) {
        const cell = document.createElement("td");
        const rendered = text(value);
        cell.dataset.ollTargetId = `${node.id}:table:row:${rowIndex}:column:${columnIndex}`;
        cell.dataset.ollTargetKind = "table-cell";
        cell.dataset.ollTargetLabel = rendered;
        cell.dataset.ollTargetValue = rendered;
        renderInlineText(cell, rendered);
        row.append(cell);
      }
      table.append(row);
    }
    parent.append(table); return;
  }
  if (Array.isArray(content.fragments)) {
    const fragments = document.createElement("div"); fragments.className = "text-fragments";
    for (const fragment of content.fragments) {
      const part = document.createElement("span"); part.className = "text-fragment"; part.dataset.id = text(fragment.id);
      renderInlineText(part, text(fragment.text || fragment.latex)); applyEmphasisClass(part, latestEmphasis(node, text(fragment.id))); fragments.append(part);
    }
    parent.append(fragments);
  } else if (node.kind === "diagram" && (Array.isArray(content.sequence) || Array.isArray(content.items))) {
    const sequence = document.createElement("div"); sequence.className = "diagram-sequence";
    const values = content.sequence ?? content.items;
    values.forEach((value: unknown, index: number) => {
      appendText(sequence, typeof value === "object" ? text((value as any).text || (value as any).label || JSON.stringify(value)) : text(value));
      if (index < values.length - 1) appendText(sequence, "→", "").tagName && (sequence.lastElementChild!.className = "");
    });
    parent.append(sequence);
  } else {
    const items = content.items ?? content.details ?? content.lines;
    const primary = text(content.text || content.expression || content.statement || content.rule || content.derivation || content.result || content.caption);
    if (primary) appendText(parent, primary);
    else if (Object.keys(content).length && !Array.isArray(items)) appendText(parent, Object.entries(content).slice(0, 5).map(([key, value]) => `${key}: ${text(value) || JSON.stringify(value)}`).join("\n"));
  }
  const items = content.items ?? content.details ?? content.lines;
  if (Array.isArray(items)) {
    const list = document.createElement("ul"); list.className = "content-list";
    for (const item of items) { const li = document.createElement("li"); renderInlineText(li, text(item) || JSON.stringify(item)); list.append(li); }
    parent.append(list);
  }
  if (content.caption) appendText(parent, text(content.caption), "node-caption");
}

function connectionTargetRect(board: SemanticBoardState, layout: BoardLayout, target: Record<string, any>): Rect | undefined {
  const nodeId = target?.node_id;
  const fragmentId = target?.fragment_id;
  if (nodeId && fragmentId) {
    const node = board.nodes[nodeId]; const nodeRect = layout.nodes[nodeId];
    if (node?.kind === "diagram" && nodeRect) {
      const diagram = diagramLayout(node.content ?? {});
      const point = diagram.points.get(fragmentId);
      if (point) {
        const innerWidth = Math.max(1, nodeRect.width - 36); const innerHeight = Math.max(1, nodeRect.height - 52);
        return { x: nodeRect.x + 18 + point.x / diagram.width * innerWidth - 4, y: nodeRect.y + 36 + point.y / diagram.height * innerHeight - 4, width: 8, height: 8 };
      }
    }
  }
  return targetRect(board, layout, target);
}

export class InfiniteBoardView {
  private panX = 80;
  private panY = 60;
  private scale = .78;
  private layout?: BoardLayout;
  private board?: SemanticBoardState;
  private operation?: PlaybackOperation;
  private lastAttentionTargets: string[] = [];
  private activeRegionId?: string;
  private dragging?: { x: number; y: number; panX: number; panY: number };
  private variableDragging?: {
    alias: string;
    operationId?: string;
    input: StudentInputMethod;
    lastValue: number;
    centerX: number;
    centerY: number;
    rect: DOMRect;
    viewBoxWidth: number;
    viewBoxHeight: number;
  };
  private variableInputHandler?: VariableInputHandler;
  private scene3dInputHandler?: Scene3dViewInputHandler;
  private scene3dViews: Record<string, Scene3dViewState> = {};
  private regionLayouts: Record<string, RegionLayoutConstraint> = {};
  private readonly cameraAuthority = new TeachingCameraAuthority();
  private cameraFrame?: number;
  private cameraNotifyUntil = 0;
  private inputOwner: BoardInputOwner = "runtime";
  private viewportInsets: ViewportInsets = {};
  private readonly cameraListeners = new Set<CameraListener>();
  private readonly nodeElements = new Map<string, HTMLElement>();
  private readonly nodeContentSignatures = new Map<string, string>();
  private readonly groupElements = new Map<string, HTMLElement>();
  private nodeInstanceSequence = 0;
  private readonly hostWindow: Window;
  private readonly handleWheel = (event: WheelEvent): void => this.onWheel(event);
  private readonly handlePointerDown = (event: PointerEvent): void => this.onPointerDown(event);
  private readonly handlePointerMove = (event: PointerEvent): void => this.onPointerMove(event);
  private readonly handlePointerUp = (): void => this.onPointerUp();

  constructor(
    private readonly viewport: HTMLElement,
    private readonly world: HTMLElement,
    private readonly nodes: HTMLElement,
    private readonly groups: HTMLElement,
    private readonly connections: SVGSVGElement,
    private readonly connectionLabels: SVGSVGElement,
    private readonly pointer: HTMLElement,
    private readonly resolveAsset: ImageAssetResolver = () => undefined,
  ) {
    const hostWindow = viewport.ownerDocument.defaultView;
    if (!hostWindow) throw new Error("InfiniteBoardView requires a viewport attached to a browser document");
    this.hostWindow = hostWindow;
    viewport.addEventListener("wheel", this.handleWheel, { passive: false });
    viewport.addEventListener("pointerdown", this.handlePointerDown);
    hostWindow.addEventListener("pointermove", this.handlePointerMove);
    hostWindow.addEventListener("pointerup", this.handlePointerUp);
    this.transform();
  }

  render(board: SemanticBoardState | null, operation?: PlaybackOperation): void {
    const teachingCameraChanged = this.cameraAuthority.observeRender(
      board?.board_id,
      operation?.operation_id,
    );
    if (this.board?.board_id !== board?.board_id) this.lastAttentionTargets = [];
    this.board = board ?? undefined;
    this.operation = operation;
    this.pointer.hidden = true;
    if (!board) { this.clearBoard(); return; }
    const layoutOptions = { regions: this.regionLayouts };
    const provisionalLayout = computeBoardLayout(board, {}, layoutOptions);
    const measuredNodeSizes = this.syncNodes(board, provisionalLayout, operation?.action);
    const layout = this.layout = computeBoardLayout(board, measuredNodeSizes, layoutOptions);
    this.world.style.width = `${Math.max(1800, layout.bounds.x + layout.bounds.width + 300)}px`;
    this.world.style.height = `${Math.max(1200, layout.bounds.y + layout.bounds.height + 300)}px`;
    this.positionNodes(layout);
    this.syncGroups(board, layout, operation?.action);
    this.renderConnections(board, layout);
    this.renderPointer(board, layout, operation);
    const animatedTargets = operation?.action?.animation
      ? variableAnimationFocusTargets(board, operation.action.animation.variable)
      : [];
    const requestedFocusTargets = animatedTargets.length
      ? animatedTargets
      : cameraFocusTargets(operation, board.focus, this.lastAttentionTargets);
    const focusTargets = focusTargetsInRegion(board, requestedFocusTargets, this.activeRegionId);
    const focusRects = this.resolveFocusRects(focusTargets, board, layout);
    if (teachingCameraChanged && focusRects.length && this.resumeAutomaticCamera()) {
      this.focusRects(focusTargets, focusRects, board);
    }
    else if (teachingCameraChanged && ["board.create", "board.revise", "board.emphasize", "teacher.point"].includes(operation?.action?.op ?? "")) {
      const activeTarget = operation?.action?.op === "board.create" ? operation.action.node?.id : operation?.action?.target;
      const activeId = operation?.action?.op === "board.create"
        ? operation.action.node?.id
        : operation?.action?.target?.node_id
          ?? operation?.action?.target?.group_id
          ?? operation?.action?.target?.connection_id;
      const activeRect = activeId && focusTargetsInRegion(board, [activeId], this.activeRegionId).length
        ? targetRect(board, layout, activeTarget)
        : undefined;
      if (activeRect && this.resumeAutomaticCamera()) {
        this.focusRects(activeId ? [activeId] : [], [activeRect], board);
      }
    }
  }

  setViewportInsets(insets: ViewportInsets): void {
    this.viewportInsets = { ...insets };
    this.resize();
  }

  /** Returns the camera currently visible on screen, including CSS-transition frames. */
  getCameraState(): CameraState {
    const transform = this.hostWindow.getComputedStyle(this.world).transform;
    if (transform && transform !== "none") {
      const match2d = /^matrix\(([^)]+)\)$/.exec(transform);
      if (match2d) {
        const values = match2d[1]!.split(",").map(Number);
        if (values.length === 6 && values.every(Number.isFinite)) {
          return { panX: values[4]!, panY: values[5]!, scale: Math.hypot(values[0]!, values[1]!) };
        }
      }
      const match3d = /^matrix3d\(([^)]+)\)$/.exec(transform);
      if (match3d) {
        const values = match3d[1]!.split(",").map(Number);
        if (values.length === 16 && values.every(Number.isFinite)) {
          return { panX: values[12]!, panY: values[13]!, scale: Math.hypot(values[0]!, values[1]!) };
        }
      }
    }
    return { panX: this.panX, panY: this.panY, scale: this.scale };
  }

  subscribeCamera(listener: CameraListener): () => void {
    this.cameraListeners.add(listener);
    listener(this.getCameraState());
    return () => this.cameraListeners.delete(listener);
  }

  boardToViewport(point: BoardPoint): BoardPoint {
    return boardToViewportPoint(point, this.getCameraState());
  }

  viewportToBoard(point: BoardPoint): BoardPoint {
    return viewportToBoardPoint(point, this.getCameraState());
  }

  /**
   * Resolves lesson-owned objects under a student selection. This is a
   * read-only, on-demand query: normal lesson rendering never builds or walks
   * this index, so adding selection assistance cannot delay first playback.
   */
  queryBoardTargets(query: BoardTargetQuery): BoardTargetCandidate[] {
    if (!this.board || !this.layout
      || !Number.isFinite(query.bounds.x) || !Number.isFinite(query.bounds.y)
      || !Number.isFinite(query.bounds.width) || query.bounds.width <= 0
      || !Number.isFinite(query.bounds.height) || query.bounds.height <= 0) {
      return [];
    }
    const candidates: BoardTargetCandidate[] = [];
    const viewportRect = this.viewport.getBoundingClientRect();
    const domWorldRect = (element: Element): Rect | undefined => {
      const rect = element.getBoundingClientRect();
      if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0) return undefined;
      const topLeft = this.viewportToBoard({
        x: rect.left - viewportRect.left,
        y: rect.top - viewportRect.top,
      });
      const bottomRight = this.viewportToBoard({
        x: rect.right - viewportRect.left,
        y: rect.bottom - viewportRect.top,
      });
      return {
        x: Math.min(topLeft.x, bottomRight.x),
        y: Math.min(topLeft.y, bottomRight.y),
        width: Math.abs(bottomRight.x - topLeft.x),
        height: Math.abs(bottomRight.y - topLeft.y),
      };
    };
    const push = (
      targetId: string,
      nodeId: string,
      bounds: Rect,
      zIndex: number,
      elementId?: string,
      description = describeBoardTarget(this.board!.nodes[nodeId] as Record<string, unknown>, elementId),
    ) => {
      const score = targetQueryScore(bounds, query);
      if (!score) return;
      candidates.push({
        target_id: targetId,
        node_id: nodeId,
        ...(elementId ? { element_id: elementId } : {}),
        ...description,
        world_bounds: bounds,
        ...score,
        z_index: zIndex,
      });
    };
    const nodes = Object.values(this.board.nodes);
    nodes.forEach((node, nodeIndex) => {
      const nodeBounds = this.layout!.nodes[node.id];
      if (!nodeBounds) return;
      push(node.id, node.id, nodeBounds, nodeIndex);
      const nodeElement = this.nodeElements.get(node.id);
      if (!nodeElement) return;
      for (const element of nodeElement.querySelectorAll<HTMLElement | SVGElement>(
        "[data-id], [data-oll-target-id]",
      )) {
        const elementId = element.dataset.ollTargetId ?? element.dataset.id;
        if (!elementId) continue;
        const bounds = domWorldRect(element);
        if (!bounds) continue;
        if (element.dataset.ollTargetKind === "table-cell") {
          push(
            elementId,
            node.id,
            bounds,
            nodeIndex + 1,
            elementId,
            {
              kind: "table-cell",
              label: element.dataset.ollTargetLabel,
              value: element.dataset.ollTargetValue,
            },
          );
        } else {
          push(elementId, node.id, bounds, nodeIndex + 1, elementId,
            describeBoardTarget(node as Record<string, unknown>, elementId, element.textContent ?? undefined));
        }
      }
    });
    const bestByTarget = new Map<string, BoardTargetCandidate>();
    for (const candidate of candidates) {
      const current = bestByTarget.get(candidate.target_id);
      if (!current || candidate.overlap > current.overlap
        || (candidate.overlap === current.overlap && candidate.distance < current.distance)) {
        bestByTarget.set(candidate.target_id, candidate);
      }
    }
    return rankBoardTargets([...bestByTarget.values()], query.limit);
  }

  setInputOwner(owner: BoardInputOwner): void {
    if (owner === this.inputOwner) return;
    this.inputOwner = owner;
    if (owner !== "runtime") {
      this.dragging = undefined;
      this.finishVariableDrag();
      this.viewport.classList.remove("dragging");
    }
  }

  getInputOwner(): BoardInputOwner { return this.inputOwner; }

  setVariableInputHandler(handler: VariableInputHandler | undefined): void {
    if (!handler) this.finishVariableDrag();
    this.variableInputHandler = handler;
  }

  setScene3dInputHandler(handler: Scene3dViewInputHandler | undefined): void {
    this.scene3dInputHandler = handler;
  }

  setScene3dViews(views: Record<string, Scene3dViewState>): void {
    this.scene3dViews = structuredClone(views);
  }

  /**
   * Pins logical course regions to host-selected board coordinates. Updating
   * these constraints reflows the board without creating a teaching-camera
   * request, so ordinary layout bookkeeping cannot steal the learner's view.
   */
  setRegionLayouts(layouts: Record<string, RegionLayoutConstraint>): void {
    if (JSON.stringify(layouts) === JSON.stringify(this.regionLayouts)) return;
    this.regionLayouts = structuredClone(layouts);
    if (this.board) this.render(this.board, this.operation);
  }

  /** Limits automatic teaching-camera decisions to the currently playing course. */
  setActiveRegion(regionId: string | undefined): void {
    if (regionId === this.activeRegionId) return;
    this.activeRegionId = regionId;
    this.lastAttentionTargets = [];
  }

  getRegionBounds(regionId: string): Rect | undefined {
    const bounds = this.layout?.regions?.[regionId];
    return bounds ? { ...bounds } : undefined;
  }

  getRegionBoundsMap(): Record<string, Rect> {
    return structuredClone(this.layout?.regions ?? {});
  }

  getAttachmentBoundsMap(): Record<string, Rect> {
    return structuredClone(this.layout?.attachments ?? {});
  }

  /**
   * Adds a course-owned layer to the board's world coordinate space.
   *
   * The layer inherits the exact same pan/zoom transform as lesson nodes,
   * connections, and plots. Interactive content must use this instead of
   * mounting a second full-viewport canvas with a separately synchronized
   * camera.
   */
  mountWorldLayer(layer: HTMLElement): () => void {
    if (layer.ownerDocument !== this.viewport.ownerDocument) {
      throw new Error("Board world layers must belong to the viewport document");
    }
    layer.dataset.ollBoardWorldLayer = "";
    this.world.append(layer);
    return () => {
      delete layer.dataset.ollBoardWorldLayer;
      layer.remove();
    };
  }

  focusTargets(targetIds: string[]): void {
    if (!this.layout || !this.board || targetIds.length === 0) return;
    const activeTargets = focusTargetsInRegion(this.board, targetIds, this.activeRegionId);
    if (activeTargets.length === 0) return;
    const rects = this.resolveFocusRects(activeTargets, this.board, this.layout);
    if (rects.length === 0) return;
    if (!this.resumeAutomaticCamera()) return;
    this.focusRects(activeTargets, rects, this.board);
  }

  /**
   * Moves the teaching camera to host-owned content mounted in board/world
   * coordinates, such as a pending learner question and its loading card.
   * This is an explicit one-shot request from the host; ordinary renders and
   * elapsed time never call it automatically.
   */
  focusWorldRect(
    rect: Rect,
    options: { exclusive?: boolean; framing?: "content" | "course" } = {},
  ): Rect | undefined {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0) return undefined;
    const viewport = this.viewport.getBoundingClientRect();
    const camera = planFocusCamera(
      [rect],
      { panX: this.panX, panY: this.panY, scale: this.scale },
      viewport,
      options.framing === "course" ? "course" : "detail",
      this.viewportInsets,
    );
    this.cameraAuthority.holdHostCamera(options.exclusive === true);
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.scale = camera.scale;
    this.transform();
    return {
      x: -camera.panX / camera.scale,
      y: -camera.panY / camera.scale,
      width: viewport.width / camera.scale,
      height: viewport.height / camera.scale,
    };
  }

  releaseHostCamera(): void {
    this.cameraAuthority.releaseHostCamera();
    this.viewport.classList.remove("manual-navigation");
  }

  resize(): void {
    if (!this.layout || !this.board || !this.cameraAuthority.layoutReframeAllowed) return;
    const operationFocus = focusTargetsInRegion(
      this.board,
      this.operation?.action?.focus?.targets ?? [],
      this.activeRegionId,
    );
    const operationFocusRects = this.resolveFocusRects(operationFocus, this.board, this.layout);
    if (operationFocusRects.length) {
      this.focusRects(operationFocus, operationFocusRects, this.board);
      return;
    }
    const activeTarget = this.operation?.action?.op === "board.create"
      ? this.operation.action.node?.id
      : this.operation?.action?.target;
    const activeId = this.operation?.action?.op === "board.create"
      ? this.operation.action.node?.id
      : this.operation?.action?.target?.node_id
        ?? this.operation?.action?.target?.group_id
        ?? this.operation?.action?.target?.connection_id;
    const activeRect = activeId && focusTargetsInRegion(this.board, [activeId], this.activeRegionId).length
      ? targetRect(this.board, this.layout, activeTarget)
      : undefined;
    if (activeRect) {
      this.focusRects(activeId ? [activeId] : [], [activeRect], this.board);
      return;
    }
    const priorTargets = focusTargetsInRegion(this.board, this.lastAttentionTargets, this.activeRegionId);
    const priorRects = this.resolveFocusRects(priorTargets, this.board, this.layout);
    if (priorRects.length) {
      this.focusRects(priorTargets, priorRects, this.board);
      return;
    }
    const boardFocus = focusTargetsInRegion(this.board, this.board.focus, this.activeRegionId);
    const focusRects = this.resolveFocusRects(boardFocus, this.board, this.layout);
    if (focusRects.length) this.focusRects(boardFocus, focusRects, this.board);
  }

  fit(): void {
    if (!this.layout) return;
    const camera = planFocusCamera(
      [this.layout.bounds],
      { panX: this.panX, panY: this.panY, scale: this.scale },
      this.viewport.getBoundingClientRect(),
      "overview",
      this.viewportInsets,
    );
    this.scale = camera.scale;
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.transform();
  }

  zoomBy(factor: number): void { this.zoomAt(factor, this.viewport.clientWidth / 2, this.viewport.clientHeight / 2); }

  dispose(): void {
    this.viewport.removeEventListener("wheel", this.handleWheel);
    this.viewport.removeEventListener("pointerdown", this.handlePointerDown);
    this.hostWindow.removeEventListener("pointermove", this.handlePointerMove);
    this.hostWindow.removeEventListener("pointerup", this.handlePointerUp);
    this.cameraAuthority.reset();
    if (this.cameraFrame !== undefined) this.hostWindow.cancelAnimationFrame(this.cameraFrame);
    this.dragging = undefined;
    this.finishVariableDrag();
    this.variableInputHandler = undefined;
    this.scene3dInputHandler = undefined;
    this.regionLayouts = {};
    this.activeRegionId = undefined;
    this.cameraListeners.clear();
    this.viewport.classList.remove("dragging", "manual-navigation");
  }

  private clearBoard(): void {
    this.nodes.replaceChildren(); this.groups.replaceChildren(); this.connections.replaceChildren(); this.connectionLabels.replaceChildren();
    this.nodeElements.clear(); this.nodeContentSignatures.clear(); this.groupElements.clear(); this.layout = undefined;
    this.lastAttentionTargets = [];
  }

  private syncNodes(board: SemanticBoardState, layout: BoardLayout, action?: CanonicalAction): MeasuredNodeSizes {
    const activeCreateId = action?.op === "board.create" ? action.node?.id : undefined;
    const arrivingFocus = action?.op === "board.focus" ? new Set(action.focus?.targets ?? []) : undefined;
    const variableValues = Object.fromEntries(Object.entries(board.variables ?? {}).map(
      ([alias, variable]) => [alias, variable.value],
    ));
    const measured: MeasuredNodeSizes = {};
    for (const [id, element] of this.nodeElements) {
      if (board.nodes[id]) continue;
      element.remove(); this.nodeElements.delete(id); this.nodeContentSignatures.delete(id);
    }
    for (const node of Object.values(board.nodes)) {
      const kind = String(node.kind ?? "text");
      const fixedVisualSize = kind === "plot" || kind === "geometry" || kind === "scene3d"
        || (kind === "diagram" && Array.isArray(node.content?.elements));
      let element = this.nodeElements.get(node.id);
      const created = !element;
      if (!element) {
        element = document.createElement("article");
        element.dataset.id = node.id;
        element.dataset.instanceId = `node-instance-${++this.nodeInstanceSequence}`;
        this.nodeElements.set(node.id, element);
        this.nodes.append(element);
      }
      element.className = `board-node kind-${kind}`;
      element.dataset.kind = kind;
      element.dataset.plotViewScope = board.board_id;
      if (created && node.id === activeCreateId) element.classList.add("active");
      if (board.focus.includes(node.id)) element.classList.add("focused");
      if (arrivingFocus?.has(node.id)) element.classList.add("focus-arrive");
      applyEmphasisClass(element, latestEmphasis(node));
      const signature = nodeContentSignature(node)
        + JSON.stringify(kind === "scene3d" ? this.scene3dViews[node.id] ?? null : null)
        + (kind === "plot" ? plotVariableSignature(node, variableValues) : "");
      if (this.nodeContentSignatures.get(node.id) !== signature) {
        element.replaceChildren();
        renderContent(
          element,
          node,
          this.resolveAsset,
          this.scene3dViews[node.id],
          this.scene3dInputHandler,
          variableValues,
        );
        this.nodeContentSignatures.set(node.id, signature);
      }
      this.syncNodeFragmentEmphasis(element, node);
      setRect(element, layout.nodes[node.id]!);
      if (kind === "math") fitRenderedMath(element);
      if (!fixedVisualSize) element.style.height = "auto";
      const provisional = layout.nodes[node.id]!;
      measured[node.id] = {
        width: provisional.width,
        height: fixedVisualSize ? provisional.height : Math.max(72, Math.ceil(element.scrollHeight + 8)),
      };
    }
    return measured;
  }

  private syncNodeFragmentEmphasis(element: HTMLElement, node: Record<string, any>): void {
    for (const fragment of element.querySelectorAll<HTMLElement | SVGElement>("[data-id]")) {
      const fragmentId = (fragment as HTMLElement).dataset.id;
      if (fragmentId) syncEmphasisClass(fragment, latestEmphasis(node, fragmentId));
    }
  }

  private positionNodes(layout: BoardLayout): void {
    for (const element of this.nodes.querySelectorAll<HTMLElement>(".board-node")) {
      const id = element.dataset.id;
      if (id && layout.nodes[id]) setRect(element, layout.nodes[id]!);
    }
  }

  private syncGroups(board: SemanticBoardState, layout: BoardLayout, action?: CanonicalAction): void {
    const arrivingFocus = action?.op === "board.focus" ? new Set(action.focus?.targets ?? []) : undefined;
    for (const [id, element] of this.groupElements) {
      if (board.groups[id]) continue;
      element.remove(); this.groupElements.delete(id);
    }
    for (const group of Object.values(board.groups)) {
      const rect = layout.groups[group.id]; if (!rect) continue;
      let element = this.groupElements.get(group.id);
      if (!element) {
        element = document.createElement("div"); element.dataset.id = group.id;
        appendText(element, "", "group-label"); this.groupElements.set(group.id, element); this.groups.append(element);
      }
      element.className = "board-group";
      if (board.focus.includes(group.id)) element.classList.add("focused");
      if (arrivingFocus?.has(group.id)) element.classList.add("focus-arrive");
      setRect(element, rect);
      const label = element.querySelector<HTMLElement>(".group-label");
      if (label) label.textContent = text(group.title || group.role || "知识组");
    }
  }

  private renderConnections(board: SemanticBoardState, layout: BoardLayout): void {
    this.connections.replaceChildren(); this.connectionLabels.replaceChildren();
    for (const element of this.nodes.querySelectorAll(".diagram-connection, .diagram-connection-badge")) element.remove();
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker"); marker.setAttribute("id", "arrowhead"); marker.setAttribute("markerWidth", "8"); marker.setAttribute("markerHeight", "8"); marker.setAttribute("refX", "7"); marker.setAttribute("refY", "4"); marker.setAttribute("orient", "auto");
    const triangle = document.createElementNS(SVG_NS, "path"); triangle.setAttribute("d", "M0,0 L8,4 L0,8 Z"); triangle.setAttribute("fill", "#6e8d86"); marker.append(triangle); defs.append(marker); this.connections.append(defs);
    const occupiedLabels: Rect[] = Object.values(layout.nodes).map((rect) => ({ ...rect }));
    for (const connection of Object.values(board.connections)) {
      if (this.renderInternalDiagramConnection(board, connection)) continue;
      const fromRect = connectionTargetRect(board, layout, connection.from); const toRect = connectionTargetRect(board, layout, connection.to);
      if (!fromRect || !toRect) continue;
      const labelText = connectionDisplayLabel(connection);
      const internalFragments = connection.from.node_id === connection.to.node_id && Boolean(connection.from.fragment_id && connection.to.fragment_id);
      const routeObstacles = Object.entries(layout.nodes)
        .filter(([nodeId]) => nodeId !== connection.from.node_id && nodeId !== connection.to.node_id)
        .map(([, rect]) => rect);
      const route = labelText
        ? stackConnectionLabel(
            computeConnectionRoute(fromRect, toRect, labelText, internalFragments, routeObstacles),
            occupiedLabels,
          )
        : computeConnectionRoute(fromRect, toRect, labelText, internalFragments, routeObstacles);
      const path = document.createElementNS(SVG_NS, "path"); path.classList.add("connection-line"); path.dataset.id = connection.id; path.setAttribute("d", routePath(route)); this.connections.append(path);
      if (this.operation?.action?.op === "board.focus" && this.operation.action.focus?.targets.includes(connection.id)) path.classList.add("focus-arrive");
      if (labelText && !route.label.hidden) {
        const badge = document.createElementNS(SVG_NS, "g"); badge.classList.add("connection-label-badge"); badge.dataset.id = connection.id;
        const background = document.createElementNS(SVG_NS, "rect"); background.setAttribute("x", String(route.label.x - route.label.width / 2)); background.setAttribute("y", String(route.label.y - route.label.height / 2)); background.setAttribute("width", String(route.label.width)); background.setAttribute("height", String(route.label.height)); background.setAttribute("rx", "9");
        const label = document.createElementNS(SVG_NS, "text"); label.classList.add("connection-label"); label.setAttribute("x", String(route.label.x)); label.setAttribute("y", String(route.label.y)); label.setAttribute("text-anchor", "middle"); label.setAttribute("dominant-baseline", "middle"); label.textContent = labelText;
        badge.append(background, label); this.connectionLabels.append(badge);
      }
    }
  }

  private renderInternalDiagramConnection(board: SemanticBoardState, connection: Record<string, any>): boolean {
    const nodeId = connection.from?.node_id;
    if (!nodeId || nodeId !== connection.to?.node_id || !connection.from?.fragment_id || !connection.to?.fragment_id) return false;
    const node = board.nodes[nodeId];
    if (node?.kind !== "diagram") return false;
    const geometry = diagramConnectionGeometry(node.content ?? {}, connection);
    if (!geometry) return false;
    const nodeElement = [...this.nodes.querySelectorAll<HTMLElement>(".board-node")].find((element) => element.dataset.id === nodeId);
    const svg = nodeElement?.querySelector<SVGSVGElement>(".diagram-preview");
    if (!svg) return false;

    const line = document.createElementNS(SVG_NS, "line");
    line.classList.add("diagram-connection"); line.dataset.id = connection.id;
    applyEmphasisClass(line, latestEmphasis(connection));
    if (board.focus.includes(connection.id)) line.classList.add("focused");
    line.setAttribute("x1", String(geometry.from.x)); line.setAttribute("y1", String(geometry.from.y));
    line.setAttribute("x2", String(geometry.to.x)); line.setAttribute("y2", String(geometry.to.y));
    const firstPoint = svg.querySelector(".diagram-point");
    svg.insertBefore(line, firstPoint);

    if (geometry.label) {
      const badge = document.createElementNS(SVG_NS, "g"); badge.classList.add("diagram-connection-badge"); badge.dataset.id = connection.id;
      const background = document.createElementNS(SVG_NS, "rect");
      background.setAttribute("x", String(geometry.labelPosition.x - geometry.labelPosition.width / 2)); background.setAttribute("y", String(geometry.labelPosition.y - 11));
      background.setAttribute("width", String(geometry.labelPosition.width)); background.setAttribute("height", "22"); background.setAttribute("rx", "8");
      const label = document.createElementNS(SVG_NS, "text"); label.setAttribute("x", String(geometry.labelPosition.x)); label.setAttribute("y", String(geometry.labelPosition.y));
      label.setAttribute("text-anchor", "middle"); label.setAttribute("dominant-baseline", "middle"); label.textContent = geometry.label;
      badge.append(background, label); svg.append(badge);
    }
    return true;
  }

  private renderPointer(board: SemanticBoardState, layout: BoardLayout, operation?: PlaybackOperation): void {
    if (operation?.type !== "action.apply" || operation.action?.op !== "teacher.point") return;
    const rect = targetRect(board, layout, operation.action.target); if (!rect) return;
    this.pointer.style.left = `${rect.x + rect.width - 8}px`; this.pointer.style.top = `${rect.y - 18}px`; this.pointer.hidden = false;
  }

  private transform(): void {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    this.scheduleCameraNotifications();
  }
  private scheduleCameraNotifications(): void {
    if (this.cameraListeners.size === 0) return;
    const transitionDuration = this.viewport.classList.contains("manual-navigation") ? 0 : 760;
    this.cameraNotifyUntil = Math.max(this.cameraNotifyUntil, this.hostWindow.performance.now() + transitionDuration);
    if (this.cameraFrame !== undefined) return;
    const notify = (timestamp: number): void => {
      const camera = this.getCameraState();
      for (const listener of this.cameraListeners) listener(camera);
      if (timestamp < this.cameraNotifyUntil) this.cameraFrame = this.hostWindow.requestAnimationFrame(notify);
      else this.cameraFrame = undefined;
    };
    this.cameraFrame = this.hostWindow.requestAnimationFrame(notify);
  }
  private resolveFocusRects(targetIds: string[], board: SemanticBoardState, layout: BoardLayout): Rect[] {
    const rects: Rect[] = [];
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const rect = targetRect(board, layout, id);
      if (rect) rects.push(rect);
      const group = board.groups[id];
      for (const member of group?.members ?? []) visit(member);
      const connection = board.connections[id];
      for (const endpoint of [connection?.from, connection?.to]) {
        const endpointId = endpoint?.node_id ?? endpoint?.group_id ?? endpoint?.connection_id;
        if (endpointId) visit(endpointId);
      }
    };
    for (const id of targetIds) visit(id);
    for (const id of supportingVisualFocusTargets(targetIds, board, layout)) visit(id);
    return rects;
  }
  private focusRects(targetIds: string[], rects: Rect[], board: SemanticBoardState): void {
    if (targetIds.length) this.lastAttentionTargets = [...targetIds];
    const viewport = this.viewport.getBoundingClientRect();
    const mode: AttentionMode = rects.length > 1 || targetIds.some((id) => Boolean(board.connections[id]))
      ? "relationship"
      : targetIds.some((id) => Boolean(board.groups[id]))
        ? "overview"
        : "detail";
    const camera = planFocusCamera(
      rects,
      { panX: this.panX, panY: this.panY, scale: this.scale },
      viewport,
      mode,
      this.viewportInsets,
    );
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.scale = camera.scale;
    this.transform();
  }
  private onWheel(event: WheelEvent): void {
    if (
      this.inputOwner === "course-object"
      || boardInputTargetsInteractiveUi(event.composedPath())
    ) return;
    event.preventDefault();
    this.beginManualNavigation();
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(event.deltaY < 0 ? 1.1 : .9, event.clientX - rect.left, event.clientY - rect.top);
  }
  private beginManualNavigation(): void {
    this.cameraAuthority.beginManualNavigation();
    this.viewport.classList.add("manual-navigation");
  }
  private resumeAutomaticCamera(): boolean {
    if (!this.cameraAuthority.resumeTeachingCamera()) return false;
    this.viewport.classList.remove("manual-navigation");
    return true;
  }
  private zoomAt(factor: number, x: number, y: number): void { const next = Math.min(2.2, Math.max(.15, this.scale * factor)); const worldX = (x - this.panX) / this.scale; const worldY = (y - this.panY) / this.scale; this.scale = next; this.panX = x - worldX * next; this.panY = y - worldY * next; this.transform(); }
  private updateVariableDrag(event: PointerEvent): void {
    const drag = this.variableDragging;
    const variable = drag && this.board?.variables?.[drag.alias];
    if (!drag || !variable || !this.variableInputHandler || drag.rect.width <= 0 || drag.rect.height <= 0) return;
    const x = (event.clientX - drag.rect.left) / drag.rect.width * drag.viewBoxWidth;
    const y = (event.clientY - drag.rect.top) / drag.rect.height * drag.viewBoxHeight;
    const rawAngle = Math.atan2(drag.centerY - y, x - drag.centerX);
    const value = angleControlValue(rawAngle, variable.value, variable.min, variable.max, variable.unit);
    if (Number.isFinite(value)) {
      drag.lastValue = value;
      this.variableInputHandler(drag.alias, value, {
        phase: "update",
        control: "geometry_point",
        input: drag.input,
        ...(drag.operationId ? { operation_id: drag.operationId } : {}),
      });
    }
  }
  private onPointerDown(event: PointerEvent): void {
    if (
      this.inputOwner !== "runtime"
      || boardInputTargetsInteractiveUi(event.composedPath())
    ) return;
    const control = (event.target as Element).closest<SVGElement>("[data-oll-variable-control]");
    const svg = control?.closest<SVGSVGElement>("svg");
    const alias = control?.dataset.ollVariableControl;
    const centerX = Number(control?.dataset.angleCenterX);
    const centerY = Number(control?.dataset.angleCenterY);
    const viewBox = svg?.viewBox.baseVal;
    const variable = alias ? this.board?.variables?.[alias] : undefined;
    if (
      control && svg && alias && variable && this.variableInputHandler
      && Number.isFinite(centerX) && Number.isFinite(centerY)
      && viewBox && Number.isFinite(viewBox.width) && viewBox.width > 0
      && Number.isFinite(viewBox.height) && viewBox.height > 0
    ) {
      event.preventDefault();
      const input = studentInputMethod(event.pointerType);
      const operationId = this.variableInputHandler(alias, variable.value, {
        phase: "start",
        control: "geometry_point",
        input,
      });
      this.variableDragging = {
        alias,
        ...(typeof operationId === "string" ? { operationId } : {}),
        input,
        lastValue: variable.value,
        centerX,
        centerY,
        rect: svg.getBoundingClientRect(),
        viewBoxWidth: viewBox.width,
        viewBoxHeight: viewBox.height,
      };
      this.updateVariableDrag(event);
      return;
    }
    this.beginManualNavigation();
    this.dragging = { x: event.clientX, y: event.clientY, panX: this.panX, panY: this.panY };
    this.viewport.classList.add("dragging");
  }
  private onPointerMove(event: PointerEvent): void {
    if (this.variableDragging) {
      event.preventDefault();
      this.updateVariableDrag(event);
      return;
    }
    if (!this.dragging) return;
    this.beginManualNavigation();
    this.panX = this.dragging.panX + event.clientX - this.dragging.x;
    this.panY = this.dragging.panY + event.clientY - this.dragging.y;
    this.transform();
  }
  private onPointerUp(): void {
    this.finishVariableDrag();
    if (this.dragging) this.beginManualNavigation();
    this.dragging = undefined;
    this.viewport.classList.remove("dragging");
  }

  private finishVariableDrag(): void {
    const drag = this.variableDragging;
    if (!drag) return;
    this.variableDragging = undefined;
    this.variableInputHandler?.(drag.alias, drag.lastValue, {
      phase: "commit",
      control: "geometry_point",
      input: drag.input,
      ...(drag.operationId ? { operation_id: drag.operationId } : {}),
    });
  }
}

export function mountInfiniteBoard(
  viewport: HTMLElement,
  resolveAsset: ImageAssetResolver = () => undefined,
): MountedInfiniteBoard {
  if (viewport.querySelector(":scope > [data-oll-board-runtime-world]")) {
    throw new Error("This viewport already contains a mounted OLL board Runtime");
  }
  const document = viewport.ownerDocument;
  const createLayer = (className: string): HTMLDivElement => {
    const element = document.createElement("div");
    element.className = className;
    return element;
  };
  const createSvgLayer = (className: string): SVGSVGElement => {
    const element = document.createElementNS(SVG_NS, "svg");
    element.setAttribute("class", className);
    return element;
  };

  const world = createLayer("world");
  world.dataset.ollBoardRuntimeWorld = "";
  const connections = createSvgLayer("connection-layer");
  const groups = createLayer("layer group-layer");
  const nodes = createLayer("layer node-layer");
  const connectionLabels = createSvgLayer("connection-label-layer");
  const pointer = createLayer("teacher-pointer");
  pointer.hidden = true;
  pointer.textContent = "●";
  world.append(connections, groups, nodes, connectionLabels, pointer);
  const addedViewportClass = !viewport.classList.contains("viewport");
  viewport.classList.add("viewport", "oll-board-runtime");
  viewport.prepend(world);

  const elements: InfiniteBoardElements = { viewport, world, nodes, groups, connections, connectionLabels, pointer };
  const view = new InfiniteBoardView(viewport, world, nodes, groups, connections, connectionLabels, pointer, resolveAsset);
  return {
    view,
    elements,
    destroy() {
      view.dispose();
      world.remove();
      viewport.classList.remove("oll-board-runtime");
      if (addedViewportClass) viewport.classList.remove("viewport");
    },
  };
}
