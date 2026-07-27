import type { CanonicalAction, SemanticBoardState } from "../../../packages/core/src/index.js";
import type { PlaybackOperation } from "../../../packages/player-core/src/index.js";
import katex from "katex";
import { computeConnectionRoute, routePath, stackConnectionLabel } from "./connection-layout.js";
import { computeBoardLayout, targetRect, type BoardLayout, type Rect } from "./layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";

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

function renderMath(parent: HTMLElement, content: Record<string, any>): void {
  const source = mathSource(content);
  const element = document.createElement("div"); element.className = "math-render";
  if (!source) { element.textContent = "（空公式）"; parent.append(element); return; }
  katex.render(source, element, { displayMode: true, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });
  parent.append(element);
}

function plot(parent: HTMLElement, content: Record<string, any>): void {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 300 150");
  svg.classList.add("plot-preview");
  const axisX = document.createElementNS(SVG_NS, "path");
  axisX.setAttribute("d", "M 15 108 H 285 M 150 10 V 140"); axisX.setAttribute("stroke", "#9a958c"); axisX.setAttribute("fill", "none");
  const curve = document.createElementNS(SVG_NS, "path");
  curve.setAttribute("d", "M 35 24 Q 95 134 150 122 Q 205 134 265 24"); curve.setAttribute("stroke", "#23877c"); curve.setAttribute("stroke-width", "3"); curve.setAttribute("fill", "none");
  svg.append(axisX, curve);
  const label = content.curves?.[0]?.label ?? content.curves?.[0]?.expression;
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

function renderContent(parent: HTMLElement, node: Record<string, any>): void {
  const content = node.content ?? {};
  const title = text(content.title || content.label || (node.role && node.kind !== "math" && node.role !== node.kind ? node.role : ""));
  if (title) appendText(parent, title, "node-title");
  if (node.kind === "plot") { plot(parent, content); return; }
  if (node.kind === "diagram" && Array.isArray(content.elements)) { renderDiagram(parent, node); return; }
  if (node.kind === "math") { renderMath(parent, content); if (content.caption) appendText(parent, text(content.caption), "node-caption"); return; }
  if (node.kind === "image") {
    appendText(parent, text(content.alt || "受控课程图片"), "image-placeholder");
    const regions = Array.isArray(content.regions) ? content.regions : [];
    if (regions.length) {
      const pills = document.createElement("div"); pills.className = "region-pills";
      for (const region of regions) appendText(pills, text(region.label || region.as || region.source_region), "");
      parent.append(pills);
    }
    return;
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
    appendText(parent, content.fragments.map((fragment: any) => text(fragment.latex || fragment.text)).join(" "));
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

function targetId(target: Record<string, any> | undefined): string | undefined { return target?.node_id ?? target?.group_id ?? target?.connection_id; }
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

  constructor(
    private readonly viewport: HTMLElement,
    private readonly world: HTMLElement,
    private readonly nodes: HTMLElement,
    private readonly groups: HTMLElement,
    private readonly connections: SVGSVGElement,
    private readonly connectionLabels: SVGSVGElement,
    private readonly pointer: HTMLElement,
  ) {
    viewport.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    viewport.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    window.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", () => this.onPointerUp());
    this.transform();
  }

  render(board: SemanticBoardState | null, operation?: PlaybackOperation): void {
    this.board = board ?? undefined;
    this.operation = operation;
    this.nodes.replaceChildren(); this.groups.replaceChildren(); this.connections.replaceChildren(); this.connectionLabels.replaceChildren(); this.pointer.hidden = true;
    if (!board) return;
    const layout = this.layout = computeBoardLayout(board);
    this.world.style.width = `${Math.max(1800, layout.bounds.x + layout.bounds.width + 300)}px`;
    this.world.style.height = `${Math.max(1200, layout.bounds.y + layout.bounds.height + 300)}px`;
    this.renderGroups(board, layout);
    this.renderNodes(board, layout, operation?.action);
    this.renderConnections(board, layout);
    this.renderPointer(board, layout, operation);
    const focusTargets = operation?.action?.focus?.targets ?? [];
    const focusRects = focusTargets.map((target: string) => targetRect(board, layout, target)).filter(Boolean) as Rect[];
    if (focusRects.length) this.focusRect(this.unionRects(focusRects));
    else {
      const activeId = operation?.action?.node?.id ?? targetId(operation?.action?.target);
      const activeRect = activeId ? targetRect(board, layout, activeId) : undefined;
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

  private renderNodes(board: SemanticBoardState, layout: BoardLayout, action?: CanonicalAction): void {
    const activeId = action?.node?.id ?? targetId(action?.target);
    for (const node of Object.values(board.nodes)) {
      const element = document.createElement("article");
      element.className = `board-node kind-${String(node.kind ?? "text")}`;
      element.dataset.kind = String(node.kind ?? "node");
      element.dataset.id = node.id;
      if (node.id === activeId) element.classList.add("active");
      if (board.focus.includes(node.id)) element.classList.add("focused");
      applyEmphasisClass(element, latestEmphasis(node));
      setRect(element, layout.nodes[node.id]!);
      renderContent(element, node);
      this.nodes.append(element);
    }
  }

  private renderGroups(board: SemanticBoardState, layout: BoardLayout): void {
    for (const group of Object.values(board.groups)) {
      const rect = layout.groups[group.id]; if (!rect) continue;
      const element = document.createElement("div"); element.className = "board-group";
      if (board.focus.includes(group.id)) element.classList.add("focused");
      setRect(element, rect);
      appendText(element, text(group.title || group.role || "知识组"), "group-label");
      this.groups.append(element);
    }
  }

  private renderConnections(board: SemanticBoardState, layout: BoardLayout): void {
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker"); marker.setAttribute("id", "arrowhead"); marker.setAttribute("markerWidth", "8"); marker.setAttribute("markerHeight", "8"); marker.setAttribute("refX", "7"); marker.setAttribute("refY", "4"); marker.setAttribute("orient", "auto");
    const triangle = document.createElementNS(SVG_NS, "path"); triangle.setAttribute("d", "M0,0 L8,4 L0,8 Z"); triangle.setAttribute("fill", "#6e8d86"); marker.append(triangle); defs.append(marker); this.connections.append(defs);
    const occupiedLabels: Rect[] = [];
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
  private unionRects(rects: Rect[]): Rect {
    const left = Math.min(...rects.map((rect) => rect.x)); const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width)); const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  private focusRect(rect: Rect): void {
    const viewport = this.viewport.getBoundingClientRect();
    this.scale = Math.min(1, Math.max(.2, Math.min((viewport.width - 140) / rect.width, (viewport.height - 140) / rect.height)));
    this.panX = viewport.width / 2 - (rect.x + rect.width / 2) * this.scale;
    this.panY = viewport.height / 2 - (rect.y + rect.height / 2) * this.scale;
    this.transform();
  }
  private reveal(rect: Rect): void {
    const margin = 54;
    const left = this.panX + rect.x * this.scale;
    const right = left + rect.width * this.scale;
    const top = this.panY + rect.y * this.scale;
    const bottom = top + rect.height * this.scale;
    if (left < margin) this.panX += margin - left;
    else if (right > this.viewport.clientWidth - margin) this.panX -= right - (this.viewport.clientWidth - margin);
    if (top < margin) this.panY += margin - top;
    else if (bottom > this.viewport.clientHeight - margin) this.panY -= bottom - (this.viewport.clientHeight - margin);
    this.transform();
  }
  private onWheel(event: WheelEvent): void { event.preventDefault(); const rect = this.viewport.getBoundingClientRect(); this.zoomAt(event.deltaY < 0 ? 1.1 : .9, event.clientX - rect.left, event.clientY - rect.top); }
  private zoomAt(factor: number, x: number, y: number): void { const next = Math.min(2.2, Math.max(.15, this.scale * factor)); const worldX = (x - this.panX) / this.scale; const worldY = (y - this.panY) / this.scale; this.scale = next; this.panX = x - worldX * next; this.panY = y - worldY * next; this.transform(); }
  private onPointerDown(event: PointerEvent): void { if ((event.target as HTMLElement).closest("button")) return; this.dragging = { x: event.clientX, y: event.clientY, panX: this.panX, panY: this.panY }; this.viewport.classList.add("dragging"); }
  private onPointerMove(event: PointerEvent): void { if (!this.dragging) return; this.panX = this.dragging.panX + event.clientX - this.dragging.x; this.panY = this.dragging.panY + event.clientY - this.dragging.y; this.transform(); }
  private onPointerUp(): void { this.dragging = undefined; this.viewport.classList.remove("dragging"); }
}
