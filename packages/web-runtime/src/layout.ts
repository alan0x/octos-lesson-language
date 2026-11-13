import { layoutTeachingRegion } from "./teaching-layout.js";
import { OLL_PLUGIN_NODE_KINDS, type SemanticBoardState } from "../../core/src/index.js";

export interface Rect { x: number; y: number; width: number; height: number }
export interface BoardLayout {
  nodes: Record<string, Rect>;
  groups: Record<string, Rect>;
  /** Host-rendered course UI that participates in board collision layout. */
  attachments: Record<string, Rect>;
  /** Actual rendered bounds for each logical course region. */
  regions?: Record<string, Rect>;
  /** A card and the cards that continue it (player 0.9.0), framed as one block, by the first card's id. */
  blocks?: Record<string, Rect>;
  bounds: Rect;
}

export type MeasuredNodeSizes = Record<string, Pick<Rect, "width" | "height">>;

export interface RegionLayoutConstraint {
  x: number;
  y: number;
  /** Host-owned world-space rectangles that lesson cards must avoid. */
  obstacles?: Rect[];
  /** Space reserved for a progressively delivered course before every node exists. */
  reservedWidth?: number;
  /** Arrange lesson content as a visual lane beside a reading lane. */
  flow?: "semantic" | "reading" | "teaching";
  /** Stable node creation-step IDs supplied by the host. */
  nodeSections?: Record<string, string>;
  /** Planned per-step card counts by column kind, known to the host ahead of
   *  playback for packaged lessons (and growing for live ones). Lets a row
   *  reserve its visual cell capacity before every card exists. */
  plannedSteps?: Record<string, { visual?: number; math?: number; text?: number }>;
  /**
   * Optional explicit "explains" relations: card id -> ids of the visual or
   * earlier card it explains. Absent relations leave layout in narration order.
   */
  relations?: Record<string, string[]>;
  /** Conservative positions retained for cards with unanchored student ink. */
  pinned?: { nodes: Record<string, Rect>; attachments: Record<string, Rect> };
  /** Physical viewport and occlusions; independent of current pan/zoom. */
  composition?: {
    width: number;
    height: number;
    mode: "progressive" | "overview";
    insets?: import('./camera.js').ViewportInsets;
    /**
     * Camera scale at which the host reads a teaching row. Rows and columns
     * are sized so the row stays readable at this scale; hosts should keep
     * their automatic camera near it. Defaults to 0.9.
     */
    readingScale?: number;
  };
  /** Host-rendered controls or tasks anchored to a lesson node. */
  attachments?: Array<{
    id: string;
    /** `reflection`: a thinking-question card placed directly under its anchor card. */
    kind?: "control" | "task" | "reflection";
    anchorNodeId: string;
    /** Display owner; only its teaching row reserves space for this attachment. */
    ownerNodeId?: string;
    /**
     * All semantic visuals controlled by this attachment. When present, the
     * dependency set can span teaching rows; it does not imply display ownership
     * in each row. Controls default to the first target, tasks to anchorNodeId.
     */
    anchorNodeIds?: string[];
    width: number;
    height: number;
    /** Currently rendered attachment height used by teaching-camera focus. */
    focusHeight?: number;
    gap?: number;
  }>;
}

export interface BoardLayoutOptions {
  regions?: Record<string, RegionLayoutConstraint>;
  /** Where each math card's first "=" is, from its left edge in board units, as the host measured it. */
  equalsX?: Record<string, number>;
}

const GAP = { compact: 28, normal: 54, spacious: 88 } as const;
const TOPIC_GUTTER = 180;
const MAX_READING_COLUMN_HEIGHT = 760;
const MAX_READING_COLUMN_ITEMS = 4;
const MAX_AUTHORED_COLUMN_HEIGHT = 1_150;
// Plugin visuals (the number line) take the visual lane like a plot; as text, a number line was
// stacked into the reading column with the cards that explain it.
const VISUAL_LANE_KINDS = new Set<string>(["geometry", "scene3d", "plot", "image", "ink", "diagram", ...OLL_PLUGIN_NODE_KINDS]);

interface RegionCursor {
  x: number;
  y: number;
  reservedWidth: number;
  itemIndex: number;
  rowY: number;
  rowHeight: number;
  firstColumnWidth: number;
  visualBottom?: number;
  narrativeBottom?: number;
  narrativeX?: number;
  narrativeColumnWidth?: number;
  narrativeColumnItems?: number;
}

function visibleContentLength(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (Array.isArray(value)) return value.reduce((total, item) => total + visibleContentLength(item), 0);
  if (typeof value !== "object") return 0;
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !["id", "as", "asset_id", "source_region"].includes(key))
    .reduce((total, [, item]) => total + visibleContentLength(item), 0);
}

/** The largest a card of learner ink drawn at its own size may be; larger ink is scaled down to fit. */
export const MAX_DRAWN_INK_WIDTH = 1_200;
const MIN_DRAWN_INK = 1;

/** Learner ink kept at the size it was drawn (player 0.9.0), within readable limits. */
export function inkDrawnSize(content: Record<string, any> | undefined): Pick<Rect, "width" | "height"> | undefined {
  const size = content?.drawn_size;
  const width = Number(size?.width), height = Number(size?.height);
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return undefined;
  const scale = Math.min(1, MAX_DRAWN_INK_WIDTH / width);
  return { width: Math.max(MIN_DRAWN_INK, width * scale), height: Math.max(MIN_DRAWN_INK, height * scale) };
}

/**
 * The boxes of a cycle in order, when a diagram's edges join 3–8 boxes (not
 * geometry points, none with a semantic position) in one ring: every box has
 * one arrow in and one arrow out.
 */
export function cycleDiagramPath(content: Record<string, any>): string[] | undefined {
  const elements = Array.isArray(content.elements) ? content.elements : [];
  const edges = Array.isArray(content.edges) ? content.edges : [];
  if (elements.length < 3 || elements.length > 8 || edges.length !== elements.length) return undefined;
  if (elements.some((element: Record<string, any>) => label(element.semantic_position) || label(element.kind) === "point")) return undefined;
  const ids = new Set(elements.map((element: Record<string, any>) => label(element.id)).filter(Boolean));
  if (ids.size !== elements.length) return undefined;
  const next = new Map<string, string>();
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    const from = label(edge.from), to = label(edge.to);
    if (!ids.has(from) || !ids.has(to) || from === to || next.has(from)) return undefined;
    next.set(from, to);
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
  }
  if ([...ids].some((id) => incoming.get(id) !== 1)) return undefined;
  const first = label(elements[0].id);
  const ring: string[] = [];
  for (let current: string | undefined = first; current && !ring.includes(current); current = next.get(current)) ring.push(current);
  return ring.length === elements.length && next.get(ring.at(-1)!) === first ? ring : undefined;
}

const label = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

/** The ring a cycle diagram is drawn on (board view), as a width-to-height ratio of its drawing. */
export function cycleDiagramAspect(boxes: number): number {
  return boxes <= 4 ? 300 / 520 : 360 / 520;
}

export function measureSemanticNode(node: Record<string, any>): Pick<Rect, "width" | "height"> {
  const content = node.content ?? {};
  const length = visibleContentLength(content);
  const kind = String(node.kind ?? "text");
  if (kind === "geometry") {
    const measurementRows = Array.isArray(content.regular_polygons)
      ? content.regular_polygons.filter((polygon: Record<string, unknown>) => polygon.show_measurements).length
      : 0;
    return { width: 440, height: (content.caption ? 420 : 380) + (measurementRows ? 16 + measurementRows * 40 : 0) };
  }
  if (kind === "scene3d") return { width: 460, height: 360 };
  // A wide, low strip; the board measures its real height after drawing.
  if (kind === "number_line") return { width: 560, height: 120 + (Array.isArray(content.jumps) && content.jumps.length ? 58 : 0) + (content.title ? 32 : 0) };
  if (kind === "plot") return { width: 440, height: 390 };
  if (kind === "image") return { width: 340, height: 230 };
  if (kind === "ink") return inkDrawnSize(content) ?? { width: 340, height: 230 };
  if (kind === "table") {
    const columns = Array.isArray(content.columns) ? content.columns.length : 3;
    const rows = Array.isArray(content.rows) ? content.rows.length : 2;
    return { width: Math.min(600, Math.max(320, columns * 100)), height: 90 + rows * 34 };
  }
  // A cycle is drawn on a ring of its boxes: the card keeps the ring's proportions, plus its title.
  const ring = kind === "diagram" ? cycleDiagramPath(content) : undefined;
  if (ring) return { width: 480, height: Math.round(480 * cycleDiagramAspect(ring.length) + (content.title ? 78 : 44)) };
  if (kind === "diagram") return { width: Math.min(480, Math.max(280, length * 3.2)), height: Math.min(260, 105 + Math.ceil(length / 60) * 28) };
  if (
    kind === "math"
    && typeof content.text === "string"
    && !content.latex
    && !content.expression
    && !content.statement
    && !content.rule
    && !content.derivation
    && !content.result
    && !Array.isArray(content.fragments)
  ) {
    const sourceLines = content.text.split(/\r?\n/);
    const visualLines = sourceLines.reduce(
      (total: number, line: string) => total + Math.max(1, Math.ceil([...line].length / 30)),
      0,
    );
    return {
      width: Math.min(620, Math.max(360, Math.max(...sourceLines.map((line: string) => [...line].length), 1) * 18)),
      height: Math.max(112, 44 + visualLines * 31),
    };
  }
  if (kind === "math") return { width: Math.min(680, Math.max(280, length * 11.2)), height: length > 65 ? 136 : 96 };
  return { width: Math.min(440, Math.max(240, length * 5.4)), height: Math.min(260, 82 + Math.ceil(length / 48) * 24) };
}

function intersects(a: Rect, b: Rect, padding = 12): boolean {
  return a.x < b.x + b.width + padding && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
}

function union(rects: Rect[], padding = 0): Rect | undefined {
  if (rects.length === 0) return undefined;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

/** Where an annotation sits on its anchor, as fractions of the anchor's box. */
interface AnnotationBox { x: number; y: number; width: number; height: number }

function annotationBox(node: SemanticBoardState["nodes"][string]): AnnotationBox | undefined {
  const box = (node.content?.annotation ?? node.placement?.annotation) as Partial<AnnotationBox> | undefined;
  return box && [box.x, box.y, box.width, box.height].every((value) => typeof value === "number") ? box as AnnotationBox : undefined;
}

/**
 * Lays out the board. Learner ink that annotates a card does not take part in
 * the flow: it is drawn on its anchor at the position stored with the ink, so
 * it moves and scales with that card. A card shown in place of such ink keeps
 * its own measured size, centred where the ink was. An annotation whose anchor
 * is not on the board joins the flow instead, so every card has a place.
 */
export function computeBoardLayout(
  state: SemanticBoardState,
  measuredNodeSizes: MeasuredNodeSizes = {},
  options: BoardLayoutOptions = {},
): BoardLayout {
  const onAnchor = (node: SemanticBoardState["nodes"][string]) => {
    const anchor = state.nodes[String(node.placement?.anchor)];
    return node.placement?.relation === "annotates" && Boolean(annotationBox(node)) && Boolean(anchor) && anchor!.placement?.relation !== "annotates";
  };
  const annotations = Object.values(state.nodes).filter(onAnchor);
  const blocks = continuationBlocks(state, measuredNodeSizes, options.equalsX ?? {});
  if (!annotations.length && !blocks.size) return computeFlowLayout(state, measuredNodeSizes, options);
  const members = new Set([...blocks.values()].flatMap((block) => [...block.members.keys()]));
  const flowNodes = Object.fromEntries(Object.entries(state.nodes).filter(([id, node]) => !onAnchor(node) && !members.has(id)));
  // A card that others continue takes part in the flow as the whole block.
  const flowSizes: MeasuredNodeSizes = { ...measuredNodeSizes };
  for (const [root, block] of blocks) flowSizes[root] = { width: block.maxX - block.minX, height: block.maxY - block.minY };
  const layout = computeFlowLayout({ ...state, nodes: flowNodes }, flowSizes, options);
  if (blocks.size) layout.blocks = {};
  for (const [root, block] of blocks) {
    const box = layout.nodes[root];
    if (!box) continue;
    layout.blocks![root] = box;
    const origin = { x: box.x - block.minX, y: box.y - block.minY };
    layout.nodes[root] = { x: origin.x, y: origin.y, ...block.rootSize };
    for (const [id, rect] of block.members) layout.nodes[id] = { x: origin.x + rect.x, y: origin.y + rect.y, width: rect.width, height: rect.height };
  }
  for (const node of annotations) {
    const anchor = layout.nodes[String(node.placement?.anchor)];
    if (!anchor) continue;
    const box = annotationBox(node)!;
    const ink = {
      x: anchor.x + box.x * anchor.width,
      y: anchor.y + box.y * anchor.height,
      width: box.width * anchor.width,
      height: box.height * anchor.height,
    };
    const size = node.content?.annotation ? undefined : measuredNodeSizes[node.id];
    layout.nodes[node.id] = size
      ? { x: ink.x + (ink.width - size.width) / 2, y: ink.y + (ink.height - size.height) / 2, width: size.width, height: size.height }
      : ink;
  }
  return layout;
}

interface ContinuationBlock {
  rootSize: Pick<Rect, "width" | "height">;
  /** Each continuing card's box relative to the first card's top-left. */
  members: Map<string, Rect>;
  minX: number; minY: number; maxX: number; maxY: number;
}

/**
 * Cards that continue another (placement `continues`, player 0.9.0) sit at
 * their offset from their anchor, as the learner drew them, so a worked
 * solution grows in one place. A chain of continuations shares the first
 * card's block. A math card with `align: "equals"` moves sideways so its "="
 * lines up with the nearest math above it in the block whose "=" the host measured.
 */
function continuationBlocks(state: SemanticBoardState, sizes: MeasuredNodeSizes, equalsX: Record<string, number>): Map<string, ContinuationBlock> {
  const size = (id: string) => sizes[id] ?? measureSemanticNode(state.nodes[id]!);
  const continues = (id: string) => {
    const node = state.nodes[id];
    const anchor = String(node?.placement?.anchor);
    return node?.placement?.relation === "continues" && Boolean(state.nodes[anchor])
      && state.nodes[anchor]!.placement?.relation !== "annotates" && anchor !== id;
  };
  const rootOf = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    while (continues(current) && !seen.has(current)) { seen.add(current); current = String(state.nodes[current]!.placement!.anchor); }
    return current;
  };
  const blocks = new Map<string, ContinuationBlock>();
  // Creation order, so every anchor is placed before the cards that continue it.
  const order = Object.keys(state.nodes);
  const position = new Map<string, { x: number; y: number }>();
  for (const id of order) {
    if (!continues(id)) continue;
    const root = rootOf(id);
    if (root === id) continue;
    let block = blocks.get(root);
    if (!block) {
      const rootSize = size(root);
      block = { rootSize: { width: rootSize.width, height: rootSize.height }, members: new Map(), minX: 0, minY: 0, maxX: rootSize.width, maxY: rootSize.height };
      blocks.set(root, block);
      position.set(root, { x: 0, y: 0 });
    }
    const node = state.nodes[id]!;
    const anchor = String(node.placement!.anchor);
    const from = position.get(anchor) ?? { x: 0, y: 0 };
    const offset = node.placement!.offset as { x?: number; y?: number } | undefined;
    const at = { x: from.x + (Number(offset?.x) || 0), y: from.y + (Number(offset?.y) || 0) };
    if (node.placement!.align === "equals" && Number.isFinite(equalsX[id])) {
      const above = [root, ...block.members.keys()].reverse().find((other) => Number.isFinite(equalsX[other]));
      if (above) at.x = position.get(above)!.x + equalsX[above]! - equalsX[id]!;
    }
    const own = size(id);
    position.set(id, at);
    block.members.set(id, { x: at.x, y: at.y, width: own.width, height: own.height });
    block.minX = Math.min(block.minX, at.x); block.minY = Math.min(block.minY, at.y);
    block.maxX = Math.max(block.maxX, at.x + own.width); block.maxY = Math.max(block.maxY, at.y + own.height);
  }
  return blocks;
}

function computeFlowLayout(
  state: SemanticBoardState,
  measuredNodeSizes: MeasuredNodeSizes = {},
  options: BoardLayoutOptions = {},
): BoardLayout {
  const nodes: Record<string, Rect> = {};
  const groups: Record<string, Rect> = {};
  const attachments: Record<string, Rect> = {};
  const attachmentRegions: Record<string, string> = {};
  const attachmentsByAnchor = new Map<string, Array<{
    id: string;
    anchorNodeId: string;
    anchorNodeIds?: string[];
    width: number;
    height: number;
    gap?: number;
    regionId: string;
  }>>();
  for (const [regionId, constraint] of Object.entries(options.regions ?? {})) {
    for (const attachment of constraint.attachments ?? []) {
      const anchored = attachmentsByAnchor.get(attachment.anchorNodeId) ?? [];
      anchored.push({
        ...attachment,
        anchorNodeIds: attachment.anchorNodeIds?.filter((id) => Boolean(id)),
        regionId,
      });
      attachmentsByAnchor.set(attachment.anchorNodeId, anchored);
    }
  }
  const regionCursors = new Map<string, RegionCursor>();
  const regionFlowProfiles = new Map<string, { hasVisual: boolean; visualWidth: number }>();
  for (const node of Object.values(state.nodes)) {
    const regionId = typeof node.region_id === "string" && node.region_id
      ? node.region_id
      : "__legacy__";
    if (options.regions?.[regionId]?.flow !== "reading") continue;
    if (["inside", "overlay"].includes(node.placement?.relation ?? "")) continue;
    if (!VISUAL_LANE_KINDS.has(String(node.kind ?? "text"))) continue;
    const size = measuredNodeSizes[node.id] ?? measureSemanticNode(node);
    const profile = regionFlowProfiles.get(regionId) ?? { hasVisual: false, visualWidth: 0 };
    profile.hasVisual = true;
    profile.visualWidth = Math.max(profile.visualWidth, size.width);
    regionFlowProfiles.set(regionId, profile);
  }

  const endpointId = (endpoint: unknown): string | undefined => {
    if (typeof endpoint === "string") return endpoint;
    if (!endpoint || typeof endpoint !== "object") return undefined;
    const value = endpoint as Record<string, unknown>;
    return [value.node_id, value.group_id, value.connection_id]
      .find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  };

  const orderedNodes = (): Array<SemanticBoardState["nodes"][string]> => {
    const source = Object.values(state.nodes);
    const sourceIndex = new Map(source.map((node, index) => [node.id, index]));
    const neighbors = new Map(source.map((node) => [node.id, new Set<string>()]));
    const dependents = new Map(source.map((node) => [node.id, new Set<string>()]));
    const prerequisites = new Map(source.map((node) => [node.id, new Set<string>()]));
    const sameRegion = (left: string, right: string): boolean => (
      (state.nodes[left]?.region_id ?? "__legacy__") === (state.nodes[right]?.region_id ?? "__legacy__")
    );
    const relate = (before: string, after: string, keepTogether: boolean): void => {
      if (!state.nodes[before] || !state.nodes[after] || !sameRegion(before, after)) return;
      if (keepTogether) {
        neighbors.get(before)?.add(after);
        neighbors.get(after)?.add(before);
      }
      dependents.get(before)?.add(after);
      prerequisites.get(after)?.add(before);
    };
    for (const node of source) {
      const anchor = node.placement?.anchor;
      if (typeof anchor === "string" && state.nodes[anchor]) {
        relate(anchor, node.id,
          VISUAL_LANE_KINDS.has(String(state.nodes[anchor]?.kind ?? ""))
          && VISUAL_LANE_KINDS.has(String(node.kind ?? "")));
      }
    }
    for (const connection of Object.values(state.connections)) {
      const from = endpointId(connection.from);
      const to = endpointId(connection.to);
      if (from && to) {
        relate(from, to,
          VISUAL_LANE_KINDS.has(String(state.nodes[from]?.kind ?? ""))
          && VISUAL_LANE_KINDS.has(String(state.nodes[to]?.kind ?? "")));
      }
    }

    const components: string[][] = [];
    const visited = new Set<string>();
    for (const node of source) {
      if (visited.has(node.id)) continue;
      const component: string[] = [];
      const pending = [node.id];
      visited.add(node.id);
      while (pending.length > 0) {
        const current = pending.shift()!;
        component.push(current);
        for (const neighbor of neighbors.get(current) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
      components.push(component);
    }
    const componentByNode = new Map<string, number>();
    components.forEach((component, componentIndex) => {
      for (const id of component) componentByNode.set(id, componentIndex);
    });
    const componentPrerequisites = new Map(components.map((_component, index) => [index, new Set<number>()]));
    const componentDependents = new Map(components.map((_component, index) => [index, new Set<number>()]));
    for (const [nodeId, requiredNodes] of prerequisites) {
      const component = componentByNode.get(nodeId)!;
      for (const requiredNode of requiredNodes) {
        const requiredComponent = componentByNode.get(requiredNode)!;
        if (requiredComponent === component) continue;
        componentPrerequisites.get(component)?.add(requiredComponent);
        componentDependents.get(requiredComponent)?.add(component);
      }
    }
    const componentSourceIndex = (componentIndex: number): number => Math.min(
      ...components[componentIndex]!.map((id) => sourceIndex.get(id) ?? Number.MAX_SAFE_INTEGER),
    );
    const readyComponents = components
      .map((_component, index) => index)
      .filter((index) => componentPrerequisites.get(index)?.size === 0)
      .sort((left, right) => componentSourceIndex(left) - componentSourceIndex(right));
    const orderedComponents: number[] = [];
    while (readyComponents.length > 0) {
      const current = readyComponents.shift()!;
      orderedComponents.push(current);
      for (const dependent of componentDependents.get(current) ?? []) {
        const required = componentPrerequisites.get(dependent)!;
        required.delete(current);
        if (required.size === 0 && !orderedComponents.includes(dependent) && !readyComponents.includes(dependent)) {
          readyComponents.push(dependent);
          readyComponents.sort((left, right) => componentSourceIndex(left) - componentSourceIndex(right));
        }
      }
    }
    for (const componentIndex of components
      .map((_component, index) => index)
      .sort((left, right) => componentSourceIndex(left) - componentSourceIndex(right))) {
      if (!orderedComponents.includes(componentIndex)) orderedComponents.push(componentIndex);
    }

    return orderedComponents.flatMap((componentIndex) => {
      const component = components[componentIndex]!;
      const componentIds = new Set(component);
      const remainingPrerequisites = new Map(component.map((id) => [
        id,
        new Set([...(prerequisites.get(id) ?? [])].filter((candidate) => componentIds.has(candidate))),
      ]));
      const ready = component
        .filter((id) => remainingPrerequisites.get(id)?.size === 0)
        .sort((left, right) => (sourceIndex.get(left) ?? 0) - (sourceIndex.get(right) ?? 0));
      const ordered: string[] = [];
      while (ready.length > 0) {
        const current = ready.shift()!;
        ordered.push(current);
        for (const dependent of dependents.get(current) ?? []) {
          if (!componentIds.has(dependent)) continue;
          const required = remainingPrerequisites.get(dependent)!;
          required.delete(current);
          if (required.size === 0 && !ordered.includes(dependent) && !ready.includes(dependent)) {
            ready.push(dependent);
            ready.sort((left, right) => (sourceIndex.get(left) ?? 0) - (sourceIndex.get(right) ?? 0));
          }
        }
      }
      for (const id of component.sort((left, right) => (sourceIndex.get(left) ?? 0) - (sourceIndex.get(right) ?? 0))) {
        if (!ordered.includes(id)) ordered.push(id);
      }
      return ordered.map((id) => state.nodes[id]!);
    });
  };

  const connectedLaidOutNode = (nodeId: string, regionId: string): Rect | undefined => {
    for (const connection of Object.values(state.connections)) {
      const from = endpointId(connection.from);
      const to = endpointId(connection.to);
      const peerId = from === nodeId ? to : to === nodeId ? from : undefined;
      if (!peerId || !nodes[peerId]) continue;
      const peer = state.nodes[peerId];
      if (peer && (peer.region_id ?? "__legacy__") === regionId) return nodes[peerId];
    }
    return undefined;
  };

  const groupRect = (id: string, seen = new Set<string>()): Rect | undefined => {
    if (groups[id]) return groups[id];
    if (seen.has(id)) return undefined;
    seen.add(id);
    const group = state.groups[id];
    if (!group) return undefined;
    const members = (group.members ?? []).map((member: string) => nodes[member] ?? groupRect(member, new Set(seen)));
    if (members.some((rect: Rect | undefined) => !rect)) return undefined;
    const rect = union(members, 34);
    if (rect) groups[id] = rect;
    return rect;
  };

  const groupContains = (groupId: string, nodeId: string, seen = new Set<string>()): boolean => {
    if (seen.has(groupId)) return false;
    seen.add(groupId);
    const members = state.groups[groupId]?.members ?? [];
    return members.some((member: string) => member === nodeId
      || Boolean(state.groups[member] && groupContains(member, nodeId, seen)));
  };

  const collisionRects = (nodeId: string): Rect[] => {
    for (const groupId of Object.keys(state.groups)) groupRect(groupId);
    const node = state.nodes[nodeId];
    const regionId = typeof node?.region_id === "string" && node.region_id
      ? node.region_id
      : "__legacy__";
    return [
      ...Object.values(nodes),
      ...Object.values(attachments),
      ...(options.regions?.[regionId]?.obstacles ?? []),
      ...Object.entries(groups)
        .filter(([groupId]) => !groupContains(groupId, nodeId))
        .map(([, rect]) => rect),
    ];
  };

  const regionCursor = (regionId: string, nodeId: string): RegionCursor => {
    const existing = regionCursors.get(regionId);
    if (existing) return existing;
    const constraint = options.regions?.[regionId];
    const occupied = collisionRects(nodeId);
    const reservedRightEdges = [...regionCursors.values()].map((cursor) =>
      cursor.x + cursor.reservedWidth);
    const right = occupied.length || reservedRightEdges.length
      ? Math.max(
          ...occupied.map((rect) => rect.x + rect.width),
          ...reservedRightEdges,
        )
      : 100 - TOPIC_GUTTER;
    const created: RegionCursor = {
      x: constraint?.x ?? (regionCursors.size === 0 ? 100 : right + TOPIC_GUTTER),
      y: constraint?.y ?? 90,
      reservedWidth: Math.max(0, constraint?.reservedWidth ?? 0),
      itemIndex: 0,
      rowY: constraint?.y ?? 90,
      rowHeight: 0,
      firstColumnWidth: 0,
    };
    regionCursors.set(regionId, created);
    return created;
  };

  const teachingIds = new Set<string>();
  for (const [regionId, constraint] of Object.entries(options.regions ?? {})) {
    if (constraint.flow !== "teaching") continue;
    const ids = Object.values(state.nodes).filter(n => (n.region_id ?? "__legacy__") === regionId).map(n => n.id);
    // Nested/overlay layouts retain their authored geometry until grouped layout
    // supports their internal coordinate systems.
    if (ids.some(id => ["inside", "overlay"].includes(state.nodes[id]!.placement?.relation ?? ""))) continue;
    if (!ids.length) continue;
    const sizes = Object.fromEntries(ids.map(id => [id, measuredNodeSizes[id] ?? measureSemanticNode(state.nodes[id]!)]));
    const result = layoutTeachingRegion(state, ids, sizes, constraint, [...Object.values(nodes), ...Object.values(attachments)]);
    Object.assign(nodes, result.nodes); Object.assign(attachments, result.attachments);
    ids.forEach(id => teachingIds.add(id));
    Object.keys(result.attachments).forEach(id => attachmentRegions[id] = regionId);
  }
  for (const node of orderedNodes()) {
    if (teachingIds.has(node.id)) continue;
    let size = measuredNodeSizes[node.id] ?? measureSemanticNode(node);
    const placement = node.placement ?? { relation: "new_region" };
    const regionId = typeof node.region_id === "string" && node.region_id
      ? node.region_id
      : "__legacy__";
    const anchor = placement.anchor ? nodes[placement.anchor] ?? groupRect(placement.anchor) : undefined;
    const connected = connectedLaidOutNode(node.id, regionId);
    const gap = GAP[placement.gap as keyof typeof GAP] ?? GAP.normal;
    const constraint = options.regions?.[regionId];
    const nodeIsVisual = VISUAL_LANE_KINDS.has(String(node.kind ?? "text"));
    const anchorNode = typeof placement.anchor === "string" ? state.nodes[placement.anchor] : undefined;
    const connectedNodeId = connected
      ? Object.entries(nodes).find(([, rect]) => rect === connected)?.[0]
      : undefined;
    const connectedNode = connectedNodeId ? state.nodes[connectedNodeId] : undefined;
    const anchoredGroupHasInteractionLane = Boolean(
      !nodeIsVisual
      && placement.relation === "below"
      && placement.anchor
      && state.groups[placement.anchor]
      && (constraint?.attachments ?? []).some((attachment) => {
        const semanticAnchors = attachment.anchorNodeIds?.length
          ? attachment.anchorNodeIds
          : [attachment.anchorNodeId];
        return semanticAnchors.some((id) => groupContains(placement.anchor!, id));
      }),
    );
    const authoredVisualRelationship = (
      Boolean(anchor) && (
        (Boolean(placement.anchor && state.groups[placement.anchor])
          && !anchoredGroupHasInteractionLane)
        || (nodeIsVisual && VISUAL_LANE_KINDS.has(String(anchorNode?.kind ?? "")))
      )
    ) || Boolean(connected && nodeIsVisual
      && VISUAL_LANE_KINDS.has(String(connectedNode?.kind ?? "")));
    const readingFlow = constraint?.flow === "reading"
      && !["inside", "overlay"].includes(placement.relation)
      && !authoredVisualRelationship;
    let flowLane: "visual" | "narrative" | undefined;
    let flowRegion: RegionCursor | undefined;
    let x = 100;
    let y = 90;
    if (readingFlow) {
      const region = regionCursor(regionId, node.id);
      const profile = regionFlowProfiles.get(regionId) ?? { hasVisual: false, visualWidth: 0 };
      flowLane = nodeIsVisual ? "visual" : "narrative";
      flowRegion = region;
      if (flowLane === "visual") {
        x = region.x;
        y = region.visualBottom === undefined
          ? region.y
          : region.visualBottom + GAP.normal;
      } else {
        const visualRight = Object.entries(nodes).reduce((right, [id, rect]) => {
          const candidate = state.nodes[id];
          if (!candidate || (candidate.region_id ?? "__legacy__") !== regionId) return right;
          return VISUAL_LANE_KINDS.has(String(candidate.kind ?? "text"))
            ? Math.max(right, rect.x + rect.width)
            : right;
        }, profile.hasVisual ? region.x + profile.visualWidth : region.x);
        x = region.narrativeX ?? (profile.hasVisual ? visualRight + GAP.normal : region.x);
        region.narrativeX ??= x;
        const nextY = region.narrativeBottom === undefined
          ? region.y
          : region.narrativeBottom + GAP.compact;
        const columnIsFull = (region.narrativeColumnItems ?? 0) >= MAX_READING_COLUMN_ITEMS
          || nextY + size.height > region.y + MAX_READING_COLUMN_HEIGHT;
        if (region.narrativeBottom !== undefined && columnIsFull) {
          region.narrativeX = x + Math.max(280, region.narrativeColumnWidth ?? 0) + GAP.normal;
          region.narrativeBottom = undefined;
          region.narrativeColumnWidth = 0;
          region.narrativeColumnItems = 0;
          x = region.narrativeX;
        }
        const usedWidth = x - region.x;
        const availableWidth = region.reservedWidth > usedWidth
          ? region.reservedWidth - usedWidth
          : 0;
        if (availableWidth >= 280) size = { ...size, width: Math.min(size.width, availableWidth) };
        y = region.narrativeBottom === undefined
          ? region.y
          : region.narrativeBottom + GAP.compact;
      }
    } else if (!anchor || placement.relation === "new_region") {
      const region = regionCursor(regionId, node.id);
      if (connected && nodeIsVisual && VISUAL_LANE_KINDS.has(String(connectedNode?.kind ?? ""))) {
        x = connected.x + connected.width + GAP.normal;
        y = connected.y + (connected.height - size.height) / 2;
        region.rowHeight = Math.max(
          region.rowHeight,
          size.height + Math.max(0, y - region.rowY),
        );
        region.itemIndex = Math.max(2, region.itemIndex + 1);
      } else {
        const column = region.itemIndex % 2;
        if (column === 0 && region.itemIndex > 0) {
          region.rowY += region.rowHeight + GAP.spacious;
          region.rowHeight = 0;
          region.firstColumnWidth = 0;
        }
        x = column === 0
          ? region.x
          : region.x + region.firstColumnWidth + GAP.normal;
        y = region.rowY;
        if (column === 0) region.firstColumnWidth = size.width;
        region.rowHeight = Math.max(region.rowHeight, size.height);
        region.itemIndex += 1;
      }
    } else if (placement.relation === "below") {
      x = anchor.x;
      y = anchor.y + anchor.height + gap;
    } else if (placement.relation === "above") {
      x = anchor.x;
      y = anchor.y - size.height - gap;
    } else if (placement.relation === "right_of") {
      x = anchor.x + anchor.width + gap;
      y = anchor.y + (anchor.height - size.height) / 2;
    } else if (placement.relation === "left_of") {
      x = anchor.x - size.width - gap;
      y = anchor.y + (anchor.height - size.height) / 2;
    } else if (placement.relation === "near") {
      x = anchor.x + anchor.width + GAP.compact;
      y = anchor.y + GAP.compact;
    } else if (placement.relation === "inside" || placement.relation === "overlay") {
      x = anchor.x + 24;
      y = anchor.y + 24;
    }
    if (!readingFlow && placement.align === "center" && anchor && ["below", "above"].includes(placement.relation)) x = anchor.x + (anchor.width - size.width) / 2;
    if (!readingFlow && placement.align === "end" && anchor && ["below", "above"].includes(placement.relation)) x = anchor.x + anchor.width - size.width;
    if (anchor && placement.relation === "below") {
      const region = regionCursors.get(regionId);
      const regionTop = options.regions?.[regionId]?.y
        ?? region?.y
        ?? Math.min(anchor.y, ...Object.entries(nodes).flatMap(([id, rect]) => {
          const candidate = state.nodes[id];
          return candidate && (candidate.region_id ?? "__legacy__") === regionId ? [rect.y] : [];
        }));
      if (y + size.height > regionTop + MAX_AUTHORED_COLUMN_HEIGHT) {
        const sameRegionRects = Object.entries(nodes).flatMap(([id, rect]) => {
          const candidate = state.nodes[id];
          return candidate && (candidate.region_id ?? "__legacy__") === regionId ? [rect] : [];
        });
        if (sameRegionRects.length > 0) {
          x = Math.max(...sameRegionRects.map((rect) => rect.x + rect.width)) + GAP.spacious;
          y = regionTop;
          if (flowRegion && flowLane === "narrative") flowRegion.narrativeX = x;
        }
      }
    }
    let candidate: Rect = { x, y, ...size };
    if (!["inside", "overlay"].includes(placement.relation)) {
      const externalObstacles = constraint?.obstacles ?? [];
      const blockingRightEdges = externalObstacles
        .filter((rect) => intersects(candidate, rect))
        .map((rect) => rect.x + rect.width);
      if (blockingRightEdges.length > 0) {
        candidate = {
          ...candidate,
          x: Math.max(candidate.x, ...blockingRightEdges) + GAP.compact,
        };
      }
      let guard = 0;
      while (collisionRects(node.id).some((rect) => intersects(candidate, rect)) && guard < 40) {
        candidate = { ...candidate, y: candidate.y + 36 };
        guard += 1;
      }
    }
    nodes[node.id] = candidate;
    let attachedBottom = candidate.y + candidate.height;
    for (const attachment of attachmentsByAnchor.get(node.id) ?? []) {
      const attachmentWidth = Math.max(1, attachment.width);
      const attachmentHeight = Math.max(1, attachment.height);
      const attachmentGap = Math.max(12, attachment.gap ?? 42);
      const semanticAnchors = (attachment.anchorNodeIds?.length
        ? attachment.anchorNodeIds
        : [attachment.anchorNodeId])
        .flatMap((id) => nodes[id] ? [nodes[id]!] : []);
      const attachmentAnchor = union(semanticAnchors) ?? candidate;
      const attachmentConstraint = options.regions?.[attachment.regionId];
      const regionLeft = attachmentConstraint?.x ?? flowRegion?.x ?? attachmentAnchor.x;
      const reservedWidth = Math.max(0, attachmentConstraint?.reservedWidth ?? 0);
      const maximumX = reservedWidth > 0
        ? Math.max(regionLeft, regionLeft + reservedWidth - attachmentWidth)
        : attachmentAnchor.x;
      let attachmentCandidate: Rect = {
        x: Math.min(Math.max(regionLeft, attachmentAnchor.x), maximumX),
        y: attachmentAnchor.y + attachmentAnchor.height + attachmentGap,
        width: attachmentWidth,
        height: attachmentHeight,
      };
      let guard = 0;
      while (collisionRects(node.id).some((rect) => intersects(attachmentCandidate, rect)) && guard < 80) {
        attachmentCandidate = { ...attachmentCandidate, y: attachmentCandidate.y + 36 };
        guard += 1;
      }
      attachments[attachment.id] = attachmentCandidate;
      attachmentRegions[attachment.id] = attachment.regionId;
      attachedBottom = Math.max(attachedBottom, attachmentCandidate.y + attachmentCandidate.height);
    }
    if (flowRegion && flowLane === "visual") flowRegion.visualBottom = attachedBottom;
    if (flowRegion && flowLane === "narrative") {
      flowRegion.narrativeBottom = attachedBottom;
      flowRegion.narrativeColumnWidth = Math.max(flowRegion.narrativeColumnWidth ?? 0, candidate.width);
      flowRegion.narrativeColumnItems = (flowRegion.narrativeColumnItems ?? 0) + 1;
    }
    const region = regionCursors.get(regionId);
    if (
      region
      && placement.relation !== "new_region"
      && anchor
      && candidate.y < region.rowY + region.rowHeight
      && candidate.y + candidate.height > region.rowY
    ) {
      region.rowHeight = Math.max(region.rowHeight, candidate.y + candidate.height - region.rowY);
      if (["right_of", "left_of", "near"].includes(placement.relation)) {
        // A related visual extends the current teaching row. The next
        // independent card starts below the complete visual cluster.
        region.itemIndex = Math.max(2, region.itemIndex);
      }
    }
  }

  for (const groupId of Object.keys(state.groups)) groupRect(groupId);
  const all = [...Object.values(nodes), ...Object.values(groups), ...Object.values(attachments)];
  const rawBounds = union(all, 100) ?? { x: 0, y: 0, width: 1200, height: 800 };
  const hostPositioned = Object.keys(options.regions ?? {}).length > 0;
  const shiftX = !hostPositioned && rawBounds.x < 20 ? 20 - rawBounds.x : 0;
  const shiftY = !hostPositioned && rawBounds.y < 20 ? 20 - rawBounds.y : 0;
  if (shiftX || shiftY) {
    for (const rect of [...Object.values(nodes), ...Object.values(groups), ...Object.values(attachments)]) { rect.x += shiftX; rect.y += shiftY; }
  }
  const regionRects = new Map<string, Rect[]>();
  for (const node of Object.values(state.nodes)) {
    const rect = nodes[node.id];
    if (!rect) continue;
    const regionId = typeof node.region_id === "string" && node.region_id
      ? node.region_id
      : "__legacy__";
    const rects = regionRects.get(regionId) ?? [];
    rects.push(rect);
    regionRects.set(regionId, rects);
  }
  const groupRegionIds = (groupId: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(groupId)) return new Set();
    seen.add(groupId);
    const ids = new Set<string>();
    for (const member of state.groups[groupId]?.members ?? []) {
      const node = state.nodes[member];
      if (node) {
        ids.add(typeof node.region_id === "string" && node.region_id
          ? node.region_id
          : "__legacy__");
      } else if (state.groups[member]) {
        for (const id of groupRegionIds(member, new Set(seen))) ids.add(id);
      }
    }
    return ids;
  };
  for (const [groupId, rect] of Object.entries(groups)) {
    const ids = groupRegionIds(groupId);
    if (ids.size !== 1) continue;
    const regionId = [...ids][0]!;
    const rects = regionRects.get(regionId) ?? [];
    rects.push(rect);
    regionRects.set(regionId, rects);
  }
  for (const [attachmentId, rect] of Object.entries(attachments)) {
    const regionId = attachmentRegions[attachmentId];
    if (!regionId) continue;
    const rects = regionRects.get(regionId) ?? [];
    rects.push(rect);
    regionRects.set(regionId, rects);
  }
  const regionBounds = Object.fromEntries(
    [...regionRects.entries()].flatMap(([regionId, rects]) => {
      const bounds = union(rects);
      return bounds ? [[regionId, bounds]] : [];
    }),
  );
  const bounds = union([...Object.values(nodes), ...Object.values(groups), ...Object.values(attachments)], 100) ?? rawBounds;
  return { nodes, groups, attachments, regions: regionBounds, bounds };
}

export function targetRect(state: SemanticBoardState, layout: BoardLayout, target: Record<string, any> | string | undefined): Rect | undefined {
  if (!target) return undefined;
  const id = typeof target === "string" ? target : target.node_id ?? target.group_id ?? target.connection_id;
  if (!id) return undefined;
  if (layout.nodes[id]) return layout.nodes[id];
  if (layout.groups[id]) return layout.groups[id];
  const connection = state.connections[id];
  if (connection) {
    const from = targetRect(state, layout, connection.from);
    const to = targetRect(state, layout, connection.to);
    return from && to ? union([from, to]) : undefined;
  }
  return undefined;
}
