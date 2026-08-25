import type { SemanticBoardState } from "../../core/src/index.js";

export interface Rect { x: number; y: number; width: number; height: number }
export interface BoardLayout {
  nodes: Record<string, Rect>;
  groups: Record<string, Rect>;
  /** Host-rendered course UI that participates in board collision layout. */
  attachments: Record<string, Rect>;
  /** Actual rendered bounds for each logical course region. */
  regions?: Record<string, Rect>;
  bounds: Rect;
}

export type MeasuredNodeSizes = Record<string, Pick<Rect, "width" | "height">>;

export interface RegionLayoutConstraint {
  x: number;
  y: number;
  /** Space reserved for a progressively delivered course before every node exists. */
  reservedWidth?: number;
  /** Arrange lesson content as a visual lane beside a reading lane. */
  flow?: "semantic" | "reading";
  /** Host-rendered controls or tasks anchored to a lesson node. */
  attachments?: Array<{
    id: string;
    anchorNodeId: string;
    width: number;
    height: number;
    gap?: number;
  }>;
}

export interface BoardLayoutOptions {
  regions?: Record<string, RegionLayoutConstraint>;
}

const GAP = { compact: 28, normal: 54, spacious: 88 } as const;
const TOPIC_GUTTER = 180;
const MAX_READING_COLUMN_HEIGHT = 1_150;
const VISUAL_LANE_KINDS = new Set(["geometry", "scene3d", "plot", "image", "diagram"]);

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

export function computeBoardLayout(
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
    width: number;
    height: number;
    gap?: number;
    regionId: string;
  }>>();
  for (const [regionId, constraint] of Object.entries(options.regions ?? {})) {
    for (const attachment of constraint.attachments ?? []) {
      const anchored = attachmentsByAnchor.get(attachment.anchorNodeId) ?? [];
      anchored.push({ ...attachment, regionId });
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
    return [
      ...Object.values(nodes),
      ...Object.values(attachments),
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

  for (const node of orderedNodes()) {
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
    const authoredVisualRelationship = Boolean(anchor) && (
      Boolean(placement.anchor && state.groups[placement.anchor])
      || (nodeIsVisual && VISUAL_LANE_KINDS.has(String(anchorNode?.kind ?? "")))
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
      if (y + size.height > regionTop + MAX_READING_COLUMN_HEIGHT) {
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
      const attachmentConstraint = options.regions?.[attachment.regionId];
      const regionLeft = attachmentConstraint?.x ?? flowRegion?.x ?? candidate.x;
      const reservedWidth = Math.max(0, attachmentConstraint?.reservedWidth ?? 0);
      const maximumX = reservedWidth > 0
        ? Math.max(regionLeft, regionLeft + reservedWidth - attachmentWidth)
        : candidate.x;
      let attachmentCandidate: Rect = {
        x: Math.min(Math.max(regionLeft, candidate.x), maximumX),
        y: candidate.y + candidate.height + attachmentGap,
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
    if (flowRegion && flowLane === "narrative") flowRegion.narrativeBottom = attachedBottom;
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
