import type { Rect } from "./layout.js";

export interface BoardTargetPoint {
  x: number;
  y: number;
}

export interface BoardTargetQuery {
  bounds: Rect;
  path?: BoardTargetPoint[];
  limit?: number;
}

export type BoardTargetKind =
  | "node"
  | "text-fragment"
  | "math-fragment"
  | "plot-curve"
  | "plot-point"
  | "plot-guide"
  | "geometry-point"
  | "geometry-segment"
  | "geometry-polygon"
  | "geometry-circle"
  | "geometry-arc"
  | "diagram-element"
  | "diagram-edge"
  | "diagram-region"
  | "image-region"
  | "table-cell"
  | "scene3d-object"
  | "scene3d-section"
  | "scene3d-point"
  | "scene3d-edge"
  | "scene3d-face"
  | "connection"
  | "unknown-fragment";

export interface BoardTargetCandidate {
  target_id: string;
  node_id: string;
  element_id?: string;
  kind: BoardTargetKind;
  label?: string;
  value?: unknown;
  world_bounds: Rect;
  overlap: number;
  distance: number;
  z_index: number;
}

export interface BoardTargetDescription {
  kind: BoardTargetKind;
  label?: string;
  value?: unknown;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function compactValue(item: Record<string, unknown>, fields: string[]): Record<string, unknown> | undefined {
  const entries = fields.flatMap((field) => item[field] === undefined ? [] : [[field, structuredClone(item[field])]] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function addressableItem(
  content: Record<string, unknown>,
  elementId: string,
): { field: string; item: Record<string, unknown> } | undefined {
  for (const field of [
    "fragments", "curves", "points", "guides", "regions", "elements", "edges",
    "polygons", "circles", "segments", "arcs", "objects", "sections", "highlights",
  ]) {
    const values = content[field];
    if (!Array.isArray(values)) continue;
    const item = values.find((candidate) => candidate && typeof candidate === "object"
      && (candidate as Record<string, unknown>).id === elementId);
    if (item) return { field, item: item as Record<string, unknown> };
  }
  return undefined;
}

export function describeBoardTarget(
  node: Record<string, unknown>,
  elementId?: string,
  fallbackText?: string,
): BoardTargetDescription {
  const nodeKind = String(node.kind ?? "text");
  const content = node.content && typeof node.content === "object"
    ? node.content as Record<string, unknown>
    : {};
  if (!elementId) {
    return {
      kind: "node",
      label: text(content.title) ?? text(content.label) ?? text(fallbackText) ?? nodeKind,
      value: compactValue(content, ["text", "latex", "expression", "caption"]),
    };
  }
  const found = addressableItem(content, elementId);
  if (!found) {
    return { kind: "unknown-fragment", label: text(fallbackText) ?? elementId };
  }
  const { field, item } = found;
  const label = text(item.label) ?? text(item.text) ?? text(item.latex)
    ?? text(item.expression) ?? text(fallbackText) ?? elementId;
  if (field === "fragments") {
    return {
      kind: nodeKind === "math" ? "math-fragment" : "text-fragment",
      label,
      value: compactValue(item, ["text", "latex"]),
    };
  }
  if (nodeKind === "plot") {
    const suffix = field === "curves" ? "curve" : field === "points" ? "point" : "guide";
    return {
      kind: `plot-${suffix}` as BoardTargetKind,
      label,
      value: compactValue(item, ["expression", "x", "y", "kind", "value"]),
    };
  }
  if (nodeKind === "geometry") {
    const suffix = field === "points" ? "point"
      : field === "segments" ? "segment"
        : field === "polygons" ? "polygon"
        : field === "circles" ? "circle"
          : "arc";
    return {
      kind: `geometry-${suffix}` as BoardTargetKind,
      label,
      value: compactValue(item, ["x", "y", "points", "from", "to", "center", "radius", "start_angle", "end_angle"]),
    };
  }
  if (nodeKind === "diagram") {
    const suffix = field === "elements" ? "element" : field === "edges" ? "edge" : "region";
    return {
      kind: `diagram-${suffix}` as BoardTargetKind,
      label,
      value: compactValue(item, ["from", "to", "members", "semantic_position"]),
    };
  }
  if (nodeKind === "image" && field === "regions") {
    return { kind: "image-region", label, value: compactValue(item, ["source_region"]) };
  }
  if (nodeKind === "scene3d") {
    if (field === "objects") {
      return {
        kind: "scene3d-object",
        label,
        value: compactValue(item, ["kind", "center", "size", "radius", "height", "expression"]),
      };
    }
    if (field === "sections") {
      return {
        kind: "scene3d-section",
        label,
        value: compactValue(item, ["axis", "value", "targets", "display"]),
      };
    }
    const highlightKind = String(item.kind ?? "face");
    return {
      kind: `scene3d-${highlightKind}` as BoardTargetKind,
      label,
      value: compactValue(item, ["points"]),
    };
  }
  return { kind: "unknown-fragment", label, value: compactValue(item, Object.keys(item)) };
}

export function rectIntersection(left: Rect, right: Rect): Rect | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge <= x || bottom <= y) return undefined;
  return { x, y, width: rightEdge - x, height: bottom - y };
}

export function pointInPolygon(point: BoardTargetPoint, polygon: BoardTargetPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index, index += 1) {
    const current = polygon[index]!;
    const previous = polygon[prior]!;
    const crosses = (current.y > point.y) !== (previous.y > point.y)
      && point.x < (previous.x - current.x) * (point.y - current.y)
        / ((previous.y - current.y) || Number.EPSILON) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function targetQueryScore(
  candidate: Rect,
  query: BoardTargetQuery,
): { overlap: number; distance: number } | undefined {
  const intersection = rectIntersection(candidate, query.bounds);
  const candidateCenter = {
    x: candidate.x + candidate.width / 2,
    y: candidate.y + candidate.height / 2,
  };
  const queryCenter = {
    x: query.bounds.x + query.bounds.width / 2,
    y: query.bounds.y + query.bounds.height / 2,
  };
  const path = query.path?.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!intersection && !(path && pointInPolygon(candidateCenter, path))) return undefined;
  if (path && path.length >= 3) {
    const corners = [
      { x: candidate.x, y: candidate.y },
      { x: candidate.x + candidate.width, y: candidate.y },
      { x: candidate.x + candidate.width, y: candidate.y + candidate.height },
      { x: candidate.x, y: candidate.y + candidate.height },
    ];
    if (!pointInPolygon(candidateCenter, path)
      && !corners.some((corner) => pointInPolygon(corner, path))
      && !path.some((point) => point.x >= candidate.x && point.x <= candidate.x + candidate.width
        && point.y >= candidate.y && point.y <= candidate.y + candidate.height)) {
      return undefined;
    }
  }
  const candidateArea = Math.max(1, candidate.width * candidate.height);
  const overlap = intersection ? Math.min(1, intersection.width * intersection.height / candidateArea) : 0;
  return {
    overlap,
    distance: Math.hypot(candidateCenter.x - queryCenter.x, candidateCenter.y - queryCenter.y),
  };
}

export function rankBoardTargets(
  candidates: BoardTargetCandidate[],
  limit = 12,
): BoardTargetCandidate[] {
  return [...candidates]
    .sort((left, right) => {
      const leftSpecific = left.element_id ? 1 : 0;
      const rightSpecific = right.element_id ? 1 : 0;
      return rightSpecific - leftSpecific
        || right.overlap - left.overlap
        || left.distance - right.distance
        || left.world_bounds.width * left.world_bounds.height
          - right.world_bounds.width * right.world_bounds.height
        || right.z_index - left.z_index
        || left.target_id.localeCompare(right.target_id);
    })
    .slice(0, Math.max(1, Math.min(50, Math.trunc(limit))));
}
