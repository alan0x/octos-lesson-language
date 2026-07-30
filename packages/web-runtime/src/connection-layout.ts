import type { Rect } from "./layout.js";

export interface Point { x: number; y: number }

export interface ConnectionRoute {
  start: Point;
  end: Point;
  points: Point[];
  label: { x: number; y: number; width: number; height: number; hidden?: boolean };
  labelCandidates: Point[];
}

type Side = "top" | "right" | "bottom" | "left";

const ROUTE_CLEARANCE = 28;
const CORNER_RADIUS = 8;

function overlaps(left: Rect, right: Rect, padding = 6): boolean {
  return left.x < right.x + right.width + padding && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding && left.y + left.height + padding > right.y;
}

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function sameRect(left: Rect, right: Rect): boolean {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}

function port(rect: Rect, side: Side, useCenter: boolean): Point {
  if (useCenter) return center(rect);
  const middle = center(rect);
  if (side === "top") return { x: middle.x, y: rect.y };
  if (side === "right") return { x: rect.x + rect.width, y: middle.y };
  if (side === "bottom") return { x: middle.x, y: rect.y + rect.height };
  return { x: rect.x, y: middle.y };
}

function compactPoints(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const prior = result.at(-1);
    if (prior?.x === point.x && prior.y === point.y) continue;
    const beforePrior = result.at(-2);
    if (
      beforePrior
      && prior
      && (
        (beforePrior.x === prior.x && prior.x === point.x)
        || (beforePrior.y === prior.y && prior.y === point.y)
      )
    ) {
      result[result.length - 1] = point;
      continue;
    }
    result.push(point);
  }
  return result;
}

function dogleg(start: Point, end: Point, axis: "horizontal" | "vertical"): Point[] {
  if (start.x === end.x || start.y === end.y) return compactPoints([start, end]);
  if (axis === "horizontal") {
    const middleX = (start.x + end.x) / 2;
    return compactPoints([
      start,
      { x: middleX, y: start.y },
      { x: middleX, y: end.y },
      end,
    ]);
  }
  const middleY = (start.y + end.y) / 2;
  return compactPoints([
    start,
    { x: start.x, y: middleY },
    { x: end.x, y: middleY },
    end,
  ]);
}

function outsideRoute(
  fromRect: Rect,
  toRect: Rect,
  side: Side,
  obstacles: Rect[],
  useCenters: boolean,
): Point[] {
  const start = port(fromRect, side, useCenters);
  const end = port(toRect, side, useCenters);
  const all = [fromRect, toRect, ...obstacles];
  if (side === "top" || side === "bottom") {
    const routeY = side === "top"
      ? Math.min(...all.map((rect) => rect.y)) - ROUTE_CLEARANCE
      : Math.max(...all.map((rect) => rect.y + rect.height)) + ROUTE_CLEARANCE;
    return compactPoints([start, { x: start.x, y: routeY }, { x: end.x, y: routeY }, end]);
  }
  const routeX = side === "left"
    ? Math.min(...all.map((rect) => rect.x)) - ROUTE_CLEARANCE
    : Math.max(...all.map((rect) => rect.x + rect.width)) + ROUTE_CLEARANCE;
  return compactPoints([start, { x: routeX, y: start.y }, { x: routeX, y: end.y }, end]);
}

function segmentLength(from: Point, to: Point): number {
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
}

function segmentOverlapsRect(from: Point, to: Point, rect: Rect, padding = 10): boolean {
  const expanded = {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
  if (from.x === to.x) {
    return from.x >= expanded.x
      && from.x <= expanded.x + expanded.width
      && Math.max(from.y, to.y) >= expanded.y
      && Math.min(from.y, to.y) <= expanded.y + expanded.height;
  }
  if (from.y === to.y) {
    return from.y >= expanded.y
      && from.y <= expanded.y + expanded.height
      && Math.max(from.x, to.x) >= expanded.x
      && Math.min(from.x, to.x) <= expanded.x + expanded.width;
  }
  return true;
}

function routeScore(points: Point[], obstacles: Rect[]): number {
  let length = 0;
  let collisions = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    length += segmentLength(from, to);
    collisions += obstacles.filter((rect) => segmentOverlapsRect(from, to, rect)).length;
  }
  return collisions * 1_000_000 + length + Math.max(0, points.length - 2) * 18;
}

function labelCandidates(points: Point[], width: number, height: number): Point[] {
  const segments = points.slice(1).map((to, index) => {
    const from = points[index]!;
    return { from, to, length: segmentLength(from, to) };
  }).sort((left, right) => right.length - left.length);
  const candidates: Point[] = [];
  for (const segment of segments) {
    const middle = {
      x: (segment.from.x + segment.to.x) / 2,
      y: (segment.from.y + segment.to.y) / 2,
    };
    if (segment.from.y === segment.to.y) {
      candidates.push(
        { x: middle.x, y: middle.y - height / 2 - 7 },
        { x: middle.x, y: middle.y + height / 2 + 7 },
      );
    } else {
      candidates.push(
        { x: middle.x + width / 2 + 7, y: middle.y },
        { x: middle.x - width / 2 - 7, y: middle.y },
      );
    }
  }
  return candidates.length ? candidates : [{ ...points[0]! }];
}

export function boundaryPoint(rect: Rect, toward: Point): Point {
  const origin = center(rect);
  const dx = toward.x - origin.x;
  const dy = toward.y - origin.y;
  if (dx === 0 && dy === 0) return origin;
  const xScale = dx === 0 ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(dx);
  const yScale = dy === 0 ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(dy);
  const scale = Math.min(xScale, yScale);
  return { x: origin.x + dx * scale, y: origin.y + dy * scale };
}

export function connectionLabelWidth(label: string): number {
  const units = [...label].reduce((total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 12 : 7), 0);
  return Math.min(220, Math.max(64, units + 22));
}

export function computeConnectionRoute(
  fromRect: Rect,
  toRect: Rect,
  label: string,
  useCenters = false,
  occupied: Rect[] = [],
): ConnectionRoute {
  const corridor = {
    x: Math.min(fromRect.x, toRect.x),
    y: Math.min(fromRect.y, toRect.y),
    width: Math.max(fromRect.x + fromRect.width, toRect.x + toRect.width)
      - Math.min(fromRect.x, toRect.x),
    height: Math.max(fromRect.y + fromRect.height, toRect.y + toRect.height)
      - Math.min(fromRect.y, toRect.y),
  };
  const obstacles = occupied.filter((rect) =>
    !sameRect(rect, fromRect)
    && !sameRect(rect, toRect)
    && overlaps(rect, corridor, ROUTE_CLEARANCE));
  const candidates: Array<{ points: Point[]; exterior: boolean }> = [];
  const fromCenter = center(fromRect);
  const toCenter = center(toRect);
  const belowGap = toRect.y - (fromRect.y + fromRect.height);
  const aboveGap = fromRect.y - (toRect.y + toRect.height);
  const rightGap = toRect.x - (fromRect.x + fromRect.width);
  const leftGap = fromRect.x - (toRect.x + toRect.width);

  if (belowGap >= 0) {
    candidates.push({
      points: dogleg(port(fromRect, "bottom", useCenters), port(toRect, "top", useCenters), "vertical"),
      exterior: false,
    });
  }
  if (aboveGap >= 0) {
    candidates.push({
      points: dogleg(port(fromRect, "top", useCenters), port(toRect, "bottom", useCenters), "vertical"),
      exterior: false,
    });
  }
  if (rightGap >= 0) {
    candidates.push({
      points: dogleg(port(fromRect, "right", useCenters), port(toRect, "left", useCenters), "horizontal"),
      exterior: false,
    });
  }
  if (leftGap >= 0) {
    candidates.push({
      points: dogleg(port(fromRect, "left", useCenters), port(toRect, "right", useCenters), "horizontal"),
      exterior: false,
    });
  }

  if (!candidates.length && useCenters) {
    candidates.push({
      points: dogleg(fromCenter, toCenter, Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y) ? "horizontal" : "vertical"),
      exterior: false,
    });
  }
  for (const side of ["top", "right", "bottom", "left"] as const) {
    candidates.push({
      points: outsideRoute(fromRect, toRect, side, obstacles, useCenters),
      exterior: true,
    });
  }

  const candidateScore = (candidate: { points: Point[]; exterior: boolean }): number =>
    routeScore(candidate.points, obstacles) + (candidate.exterior ? 80 : 0);
  const points = candidates
    .map((candidate) => ({ ...candidate, points: compactPoints(candidate.points) }))
    .sort((left, right) => candidateScore(left) - candidateScore(right))[0]!.points;
  const width = connectionLabelWidth(label);
  const height = 24;
  const candidatesForLabel = labelCandidates(points, width, height);
  return {
    start: points[0]!,
    end: points.at(-1)!,
    points,
    label: { ...candidatesForLabel[0]!, width, height },
    labelCandidates: candidatesForLabel,
  };
}

function moveToward(from: Point, to: Point, distance: number): Point {
  const length = segmentLength(from, to);
  if (length === 0) return { ...from };
  const ratio = Math.min(1, distance / length);
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

export function routePath(route: ConnectionRoute, cornerRadius = CORNER_RADIUS): string {
  const points = compactPoints(route.points);
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const prior = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const radius = Math.min(
      cornerRadius,
      segmentLength(prior, corner) / 2,
      segmentLength(corner, next) / 2,
    );
    const before = moveToward(corner, prior, radius);
    const after = moveToward(corner, next, radius);
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const end = points.at(-1)!;
  return `${path} L ${end.x} ${end.y}`;
}

export function stackConnectionLabel(route: ConnectionRoute, occupied: Rect[]): ConnectionRoute {
  const next = {
    ...route,
    points: route.points.map((point) => ({ ...point })),
    labelCandidates: route.labelCandidates.map((point) => ({ ...point })),
    label: { ...route.label },
  };
  const candidate = next.labelCandidates.find((point) => {
    const rect = {
      x: point.x - next.label.width / 2,
      y: point.y - next.label.height / 2,
      width: next.label.width,
      height: next.label.height,
    };
    return !occupied.some((item) => overlaps(rect, item));
  });
  if (!candidate) {
    next.label.hidden = true;
    return next;
  }
  next.label.x = candidate.x;
  next.label.y = candidate.y;
  const labelRect = {
    x: candidate.x - next.label.width / 2,
    y: candidate.y - next.label.height / 2,
    width: next.label.width,
    height: next.label.height,
  };
  occupied.push(labelRect);
  return next;
}
