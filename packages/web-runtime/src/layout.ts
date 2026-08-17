import type { SemanticBoardState } from "../../core/src/index.js";

export interface Rect { x: number; y: number; width: number; height: number }
export interface BoardLayout {
  nodes: Record<string, Rect>;
  groups: Record<string, Rect>;
  bounds: Rect;
}

export type MeasuredNodeSizes = Record<string, Pick<Rect, "width" | "height">>;

const GAP = { compact: 28, normal: 54, spacious: 88 } as const;
const TOPIC_GUTTER = 180;

interface RegionCursor {
  x: number;
  y: number;
  itemIndex: number;
  rowY: number;
  rowHeight: number;
  firstColumnWidth: number;
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

export function measureSemanticNode(node: Record<string, any>): Pick<Rect, "width" | "height"> {
  const content = node.content ?? {};
  const length = visibleContentLength(content);
  const kind = String(node.kind ?? "text");
  if (kind === "geometry") return { width: 380, height: 300 };
  if (kind === "scene3d") return { width: 460, height: 360 };
  if (kind === "plot" || kind === "image") return { width: 340, height: 230 };
  if (kind === "table") {
    const columns = Array.isArray(content.columns) ? content.columns.length : 3;
    const rows = Array.isArray(content.rows) ? content.rows.length : 2;
    return { width: Math.min(600, Math.max(320, columns * 100)), height: 90 + rows * 34 };
  }
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

export function computeBoardLayout(state: SemanticBoardState, measuredNodeSizes: MeasuredNodeSizes = {}): BoardLayout {
  const nodes: Record<string, Rect> = {};
  const groups: Record<string, Rect> = {};
  const regions = new Map<string, RegionCursor>();

  const endpointId = (endpoint: unknown): string | undefined => {
    if (typeof endpoint === "string") return endpoint;
    if (!endpoint || typeof endpoint !== "object") return undefined;
    const value = endpoint as Record<string, unknown>;
    return [value.node_id, value.group_id, value.connection_id]
      .find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
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
    return [
      ...Object.values(nodes),
      ...Object.entries(groups)
        .filter(([groupId]) => !groupContains(groupId, nodeId))
        .map(([, rect]) => rect),
    ];
  };

  for (const node of Object.values(state.nodes)) {
    const size = measuredNodeSizes[node.id] ?? measureSemanticNode(node);
    const placement = node.placement ?? { relation: "new_region" };
    const anchor = placement.anchor ? nodes[placement.anchor] ?? groupRect(placement.anchor) : undefined;
    const gap = GAP[placement.gap as keyof typeof GAP] ?? GAP.normal;
    let x = 100;
    let y = 90;
    if (!anchor || placement.relation === "new_region") {
      const regionId = typeof node.region_id === "string" && node.region_id
        ? node.region_id
        : "__legacy__";
      let region = regions.get(regionId);
      if (!region) {
        const occupied = collisionRects(node.id);
        const right = occupied.length
          ? Math.max(...occupied.map((rect) => rect.x + rect.width))
          : 100 - TOPIC_GUTTER;
        region = {
          x: regions.size === 0 ? 100 : right + TOPIC_GUTTER,
          y: 90,
          itemIndex: 0,
          rowY: 90,
          rowHeight: 0,
          firstColumnWidth: 0,
        };
        regions.set(regionId, region);
      }
      const connected = connectedLaidOutNode(node.id, regionId);
      if (connected && region.itemIndex % 2 === 1) {
        x = connected.x + connected.width + GAP.normal;
        y = connected.y + (connected.height - size.height) / 2;
        region.rowHeight = Math.max(
          region.rowHeight,
          size.height + Math.max(0, y - region.rowY),
        );
        region.itemIndex += 1;
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
    if (placement.align === "center" && anchor && ["below", "above"].includes(placement.relation)) x = anchor.x + (anchor.width - size.width) / 2;
    if (placement.align === "end" && anchor && ["below", "above"].includes(placement.relation)) x = anchor.x + anchor.width - size.width;
    let candidate: Rect = { x, y, ...size };
    if (!["inside", "overlay"].includes(placement.relation)) {
      let guard = 0;
      while (collisionRects(node.id).some((rect) => intersects(candidate, rect)) && guard < 40) {
        candidate = { ...candidate, y: candidate.y + 36 };
        guard += 1;
      }
    }
    nodes[node.id] = candidate;
  }

  for (const groupId of Object.keys(state.groups)) groupRect(groupId);
  const all = [...Object.values(nodes), ...Object.values(groups)];
  const rawBounds = union(all, 100) ?? { x: 0, y: 0, width: 1200, height: 800 };
  const shiftX = rawBounds.x < 20 ? 20 - rawBounds.x : 0;
  const shiftY = rawBounds.y < 20 ? 20 - rawBounds.y : 0;
  if (shiftX || shiftY) {
    for (const rect of [...Object.values(nodes), ...Object.values(groups)]) { rect.x += shiftX; rect.y += shiftY; }
  }
  const bounds = union([...Object.values(nodes), ...Object.values(groups)], 100) ?? rawBounds;
  return { nodes, groups, bounds };
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
