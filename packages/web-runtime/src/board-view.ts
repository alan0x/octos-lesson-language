import type { CanonicalAction, SemanticBoardState } from "../../core/src/index.js";
import type { PlaybackOperation } from "../../player-core/src/index.js";
import katex from "katex";
import type { ImageAssetResolver } from "./assets.js";
import { planFocusCamera, planRevealCamera, type AttentionMode } from "./camera.js";
import { computeConnectionRoute, routePath, stackConnectionLabel } from "./connection-layout.js";
import { computeBoardLayout, targetRect, type BoardLayout, type MeasuredNodeSizes, type Rect } from "./layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const EMPHASIS_CLASSES = ["emphasis-focus", "emphasis-supporting", "emphasis-warning", "emphasis-resolved"];

function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function setRect(element: HTMLElement, rect: Rect): void {
  Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}

function appendText(parent: HTMLElement, value: string, className?: string): HTMLElement {
  const element = document.createElement("div");
  if (className) element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

function latestEmphasis(owner: Record<string, any>, fragmentId?: string): string | undefined {
  const entries = Array.isArray(owner.emphasis) ? owner.emphasis : [];
  return [...entries].reverse().find((entry: Record<string, any>) => fragmentId
    ? entry.target?.fragment_id === fragmentId
    : !entry.target?.fragment_id)?.emphasis;
}

function applyEmphasisClass(element: Element, emphasis: string | undefined): void {
  if (emphasis) element.classList.add(`emphasis-${emphasis}`);
}

function syncEmphasisClass(element: Element, emphasis: string | undefined): void {
  element.classList.remove(...EMPHASIS_CLASSES);
  applyEmphasisClass(element, emphasis);
}

function nodeContentSignature(node: Record<string, any>): string {
  return JSON.stringify({ kind: node.kind, role: node.role, content: node.content });
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

function renderMath(parent: HTMLElement, node: Record<string, any>): void {
  const content = node.content ?? {};
  const fragments = Array.isArray(content.fragments) ? content.fragments as Record<string, any>[] : [];
  const element = document.createElement("div"); element.className = "math-render";
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
  katex.render(source, element, { displayMode: true, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });
  parent.append(element);
}

function plot(parent: HTMLElement, node: Record<string, any>): void {
  const content = node.content ?? {};
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 300 150");
  svg.classList.add("plot-preview");
  const axisX = document.createElementNS(SVG_NS, "path");
  axisX.setAttribute("d", "M 15 108 H 285 M 150 10 V 140"); axisX.setAttribute("stroke", "#9a958c"); axisX.setAttribute("fill", "none");
  const curve = document.createElementNS(SVG_NS, "path");
  curve.setAttribute("d", "M 35 24 Q 95 134 150 122 Q 205 134 265 24"); curve.setAttribute("stroke", "#23877c"); curve.setAttribute("stroke-width", "3"); curve.setAttribute("fill", "none");
  const curveFragment = content.curves?.[0];
  if (curveFragment?.id) { curve.dataset.id = text(curveFragment.id); applyEmphasisClass(curve, latestEmphasis(node, text(curveFragment.id))); }
  svg.append(axisX);
  const axes = content.axes ?? {}; const xRange = axes.x ?? { min: -5, max: 5 }; const yRange = axes.y ?? { min: -5, max: 5 };
  const mapX = (value: number) => 15 + (value - Number(xRange.min)) / Math.max(1, Number(xRange.max) - Number(xRange.min)) * 270;
  const mapY = (value: number) => 140 - (value - Number(yRange.min)) / Math.max(1, Number(yRange.max) - Number(yRange.min)) * 130;
  for (const guide of Array.isArray(content.guides) ? content.guides : []) {
    const line = document.createElementNS(SVG_NS, "line"); const x = mapX(Number(guide.value));
    line.setAttribute("x1", String(x)); line.setAttribute("x2", String(x)); line.setAttribute("y1", "10"); line.setAttribute("y2", "140");
    line.classList.add("plot-guide"); line.dataset.id = text(guide.id); applyEmphasisClass(line, latestEmphasis(node, text(guide.id))); svg.append(line);
  }
  svg.append(curve);
  for (const point of Array.isArray(content.points) ? content.points : []) {
    const x = mapX(Number(point.x)); const y = mapY(Number(point.y));
    const dot = document.createElementNS(SVG_NS, "circle"); dot.setAttribute("cx", String(x)); dot.setAttribute("cy", String(y)); dot.setAttribute("r", "5");
    dot.classList.add("plot-point"); dot.dataset.id = text(point.id); applyEmphasisClass(dot, latestEmphasis(node, text(point.id))); svg.append(dot);
    if (point.label) { const pointLabel = document.createElementNS(SVG_NS, "text"); pointLabel.setAttribute("x", String(x + 8)); pointLabel.setAttribute("y", String(y - 8)); pointLabel.classList.add("plot-label"); pointLabel.textContent = text(point.label); svg.append(pointLabel); }
  }
  const label = curveFragment?.label ?? curveFragment?.expression;
  if (label) appendText(parent, String(label), "node-caption");
  parent.append(svg);
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

function diagramPoints(content: Record<string, any>): Map<string, { x: number; y: number; label: string }> {
  const elements = Array.isArray(content.elements) ? content.elements : [];
  return new Map(elements.map((element: Record<string, any>, index: number) => [
    text(element.id),
    { ...diagramPosition(text(element.semantic_position), index, elements.length), label: text(element.label) },
  ]));
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

export interface MountedInfiniteBoard {
  view: InfiniteBoardView;
  elements: InfiniteBoardElements;
  destroy(): void;
}

export function diagramConnectionGeometry(content: Record<string, any>, connection: Record<string, any>): DiagramConnectionGeometry | undefined {
  const points = diagramPoints(content);
  const from = points.get(text(connection.from?.fragment_id));
  const to = points.get(text(connection.to?.fragment_id));
  if (!from || !to) return undefined;
  const label = text(connection.label || connection.relation);
  const width = Math.min(112, Math.max(42, [...label].reduce((total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 12 : 7), 0) + 16));
  return {
    from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, label,
    labelPosition: { x: (from.x + to.x) / 2 + width / 2 + 12, y: (from.y + to.y) / 2, width },
  };
}

function renderDiagram(parent: HTMLElement, node: Record<string, any>): void {
  const content = node.content ?? {};
  const points = diagramPoints(content);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 300 190");
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
    const dot = document.createElementNS(SVG_NS, "circle"); dot.setAttribute("cx", String(point.x)); dot.setAttribute("cy", String(point.y)); dot.setAttribute("r", "4"); dot.classList.add("diagram-point"); dot.dataset.id = pointId; applyEmphasisClass(dot, latestEmphasis(node, pointId)); svg.append(dot);
    const label = document.createElementNS(SVG_NS, "text"); label.setAttribute("x", String(point.x + 8)); label.setAttribute("y", String(point.y - 7)); label.classList.add("diagram-label"); label.textContent = point.label; svg.append(label);
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

function renderContent(parent: HTMLElement, node: Record<string, any>, resolveAsset: ImageAssetResolver): void {
  const content = node.content ?? {};
  const title = text(content.title || content.label || (node.role && node.kind !== "math" && node.role !== node.kind ? node.role : ""));
  if (title) appendText(parent, title, "node-title");
  if (node.kind === "plot") { plot(parent, node); return; }
  if (node.kind === "diagram" && Array.isArray(content.elements)) { renderDiagram(parent, node); return; }
  if (node.kind === "math") { renderMath(parent, node); if (content.caption) appendText(parent, text(content.caption), "node-caption"); return; }
  if (node.kind === "image") {
    renderImage(parent, node, resolveAsset); return;
  }
  if (node.kind === "table") {
    const table = document.createElement("table"); table.className = "content-table";
    if (Array.isArray(content.columns)) {
      const row = document.createElement("tr");
      for (const column of content.columns) { const cell = document.createElement("th"); cell.textContent = text(column); row.append(cell); }
      table.append(row);
    }
    for (const values of Array.isArray(content.rows) ? content.rows : []) {
      const row = document.createElement("tr");
      for (const value of values) { const cell = document.createElement("td"); cell.textContent = text(value); row.append(cell); }
      table.append(row);
    }
    parent.append(table); return;
  }
  if (Array.isArray(content.fragments)) {
    const fragments = document.createElement("div"); fragments.className = "text-fragments";
    for (const fragment of content.fragments) {
      const part = document.createElement("span"); part.className = "text-fragment"; part.dataset.id = text(fragment.id);
      part.textContent = text(fragment.text || fragment.latex); applyEmphasisClass(part, latestEmphasis(node, text(fragment.id))); fragments.append(part);
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
    for (const item of items) { const li = document.createElement("li"); li.textContent = text(item) || JSON.stringify(item); list.append(li); }
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
      const point = diagramPoints(node.content ?? {}).get(fragmentId);
      if (point) {
        const innerWidth = Math.max(1, nodeRect.width - 36); const innerHeight = Math.max(1, nodeRect.height - 52);
        return { x: nodeRect.x + 18 + point.x / 300 * innerWidth - 4, y: nodeRect.y + 36 + point.y / 190 * innerHeight - 4, width: 8, height: 8 };
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
  private dragging?: { x: number; y: number; panX: number; panY: number };
  private manualMotionTimer?: ReturnType<typeof setTimeout>;
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
    this.board = board ?? undefined;
    this.operation = operation;
    this.pointer.hidden = true;
    if (!board) { this.clearBoard(); return; }
    const provisionalLayout = computeBoardLayout(board);
    const measuredNodeSizes = this.syncNodes(board, provisionalLayout, operation?.action);
    const layout = this.layout = computeBoardLayout(board, measuredNodeSizes);
    this.world.style.width = `${Math.max(1800, layout.bounds.x + layout.bounds.width + 300)}px`;
    this.world.style.height = `${Math.max(1200, layout.bounds.y + layout.bounds.height + 300)}px`;
    this.positionNodes(layout);
    this.syncGroups(board, layout, operation?.action);
    this.renderConnections(board, layout);
    this.renderPointer(board, layout, operation);
    const operationFocus = operation?.action?.focus?.targets ?? [];
    const focusTargets = operationFocus.length
      ? operationFocus
      : operation?.type === "beat.end"
        ? board.focus
        : [];
    const focusRects = this.resolveFocusRects(focusTargets, board, layout);
    if (focusRects.length) this.focusRects(focusTargets, focusRects, board);
    else if (["board.create", "board.revise", "board.emphasize", "teacher.point"].includes(operation?.action?.op ?? "")) {
      const activeTarget = operation?.action?.op === "board.create" ? operation.action.node?.id : operation?.action?.target;
      const activeRect = targetRect(board, layout, activeTarget);
      if (activeRect) this.reveal(activeRect);
    }
  }

  fit(): void {
    if (!this.layout) return;
    const rect = this.viewport.getBoundingClientRect();
    this.scale = Math.min(1, Math.max(.18, Math.min((rect.width - 100) / this.layout.bounds.width, (rect.height - 100) / this.layout.bounds.height)));
    this.panX = (rect.width - this.layout.bounds.width * this.scale) / 2 - this.layout.bounds.x * this.scale;
    this.panY = (rect.height - this.layout.bounds.height * this.scale) / 2 - this.layout.bounds.y * this.scale;
    this.transform();
  }

  zoomBy(factor: number): void { this.zoomAt(factor, this.viewport.clientWidth / 2, this.viewport.clientHeight / 2); }

  dispose(): void {
    this.viewport.removeEventListener("wheel", this.handleWheel);
    this.viewport.removeEventListener("pointerdown", this.handlePointerDown);
    this.hostWindow.removeEventListener("pointermove", this.handlePointerMove);
    this.hostWindow.removeEventListener("pointerup", this.handlePointerUp);
    if (this.manualMotionTimer) clearTimeout(this.manualMotionTimer);
    this.dragging = undefined;
    this.viewport.classList.remove("dragging", "manual-navigation");
  }

  private clearBoard(): void {
    this.nodes.replaceChildren(); this.groups.replaceChildren(); this.connections.replaceChildren(); this.connectionLabels.replaceChildren();
    this.nodeElements.clear(); this.nodeContentSignatures.clear(); this.groupElements.clear(); this.layout = undefined;
  }

  private syncNodes(board: SemanticBoardState, layout: BoardLayout, action?: CanonicalAction): MeasuredNodeSizes {
    const activeCreateId = action?.op === "board.create" ? action.node?.id : undefined;
    const arrivingFocus = action?.op === "board.focus" ? new Set(action.focus?.targets ?? []) : undefined;
    const measured: MeasuredNodeSizes = {};
    for (const [id, element] of this.nodeElements) {
      if (board.nodes[id]) continue;
      element.remove(); this.nodeElements.delete(id); this.nodeContentSignatures.delete(id);
    }
    for (const node of Object.values(board.nodes)) {
      const kind = String(node.kind ?? "text");
      const fixedVisualSize = kind === "plot"
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
      if (created && node.id === activeCreateId) element.classList.add("active");
      if (board.focus.includes(node.id)) element.classList.add("focused");
      if (arrivingFocus?.has(node.id)) element.classList.add("focus-arrive");
      applyEmphasisClass(element, latestEmphasis(node));
      const signature = nodeContentSignature(node);
      if (this.nodeContentSignatures.get(node.id) !== signature) {
        element.replaceChildren();
        renderContent(element, node, this.resolveAsset);
        this.nodeContentSignatures.set(node.id, signature);
      }
      this.syncNodeFragmentEmphasis(element, node);
      setRect(element, layout.nodes[node.id]!);
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
      const labelText = text(connection.label || connection.relation);
      const internalFragments = connection.from.node_id === connection.to.node_id && Boolean(connection.from.fragment_id && connection.to.fragment_id);
      const route = labelText
        ? stackConnectionLabel(computeConnectionRoute(fromRect, toRect, labelText, internalFragments), occupiedLabels)
        : computeConnectionRoute(fromRect, toRect, labelText, internalFragments);
      const path = document.createElementNS(SVG_NS, "path"); path.classList.add("connection-line"); path.dataset.id = connection.id; path.setAttribute("d", routePath(route)); this.connections.append(path);
      if (this.operation?.action?.op === "board.focus" && this.operation.action.focus?.targets.includes(connection.id)) path.classList.add("focus-arrive");
      if (labelText) {
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

  private transform(): void { this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`; }
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
    return rects;
  }
  private focusRects(targetIds: string[], rects: Rect[], board: SemanticBoardState): void {
    const viewport = this.viewport.getBoundingClientRect();
    const mode: AttentionMode = targetIds.length > 1 || targetIds.some((id) => Boolean(board.connections[id]))
      ? "relationship"
      : targetIds.some((id) => Boolean(board.groups[id]))
        ? "overview"
        : "detail";
    const camera = planFocusCamera(
      rects,
      { panX: this.panX, panY: this.panY, scale: this.scale },
      viewport,
      mode,
    );
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.scale = camera.scale;
    this.transform();
  }
  private reveal(rect: Rect): void {
    const camera = planRevealCamera(
      rect,
      { panX: this.panX, panY: this.panY, scale: this.scale },
      { width: this.viewport.clientWidth, height: this.viewport.clientHeight },
    );
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.transform();
  }
  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.viewport.classList.add("manual-navigation");
    if (this.manualMotionTimer) clearTimeout(this.manualMotionTimer);
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(event.deltaY < 0 ? 1.1 : .9, event.clientX - rect.left, event.clientY - rect.top);
    this.manualMotionTimer = setTimeout(() => this.viewport.classList.remove("manual-navigation"), 140);
  }
  private zoomAt(factor: number, x: number, y: number): void { const next = Math.min(2.2, Math.max(.15, this.scale * factor)); const worldX = (x - this.panX) / this.scale; const worldY = (y - this.panY) / this.scale; this.scale = next; this.panX = x - worldX * next; this.panY = y - worldY * next; this.transform(); }
  private onPointerDown(event: PointerEvent): void { if ((event.target as HTMLElement).closest("button")) return; this.dragging = { x: event.clientX, y: event.clientY, panX: this.panX, panY: this.panY }; this.viewport.classList.add("dragging"); }
  private onPointerMove(event: PointerEvent): void { if (!this.dragging) return; this.panX = this.dragging.panX + event.clientX - this.dragging.x; this.panY = this.dragging.panY + event.clientY - this.dragging.y; this.transform(); }
  private onPointerUp(): void { this.dragging = undefined; this.viewport.classList.remove("dragging"); }
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
