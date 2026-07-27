import type { Rect } from "./layout.js";

export interface Point { x: number; y: number }

export interface ConnectionRoute {
  start: Point;
  end: Point;
  control1: Point;
  control2: Point;
  label: { x: number; y: number; width: number; height: number };
}

function overlaps(left: Rect, right: Rect, padding = 6): boolean {
  return left.x < right.x + right.width + padding && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding && left.y + left.height + padding > right.y;
}

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
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

export function computeConnectionRoute(fromRect: Rect, toRect: Rect, label: string, useCenters = false): ConnectionRoute {
  const fromCenter = center(fromRect);
  const toCenter = center(toRect);
  const start = useCenters ? fromCenter : boundaryPoint(fromRect, toCenter);
  const end = useCenters ? toCenter : boundaryPoint(toRect, fromCenter);
  const width = connectionLabelWidth(label);
  const height = 24;
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const middleX = (start.x + end.x) / 2;
    const horizontalGap = Math.max(0, Math.max(fromRect.x, toRect.x) - Math.min(fromRect.x + fromRect.width, toRect.x + toRect.width));
    if (!useCenters && horizontalGap < width + 24) {
      const routeY = Math.min(fromRect.y, toRect.y) - 34;
      return {
        start, end,
        control1: { x: middleX, y: routeY },
        control2: { x: middleX, y: routeY },
        label: { x: middleX, y: routeY - 10, width, height },
      };
    }
    return {
      start, end,
      control1: { x: middleX, y: start.y },
      control2: { x: middleX, y: end.y },
      label: { x: middleX, y: (start.y + end.y) / 2 - 10, width, height },
    };
  }

  const middleY = (start.y + end.y) / 2;
  if (!useCenters) {
    const routeX = Math.max(fromRect.x + fromRect.width, toRect.x + toRect.width) + 34;
    return {
      start, end,
      control1: { x: routeX, y: middleY },
      control2: { x: routeX, y: middleY },
      label: { x: routeX + width / 2 + 10, y: middleY, width, height },
    };
  }
  return {
    start, end,
    control1: { x: start.x, y: middleY },
    control2: { x: end.x, y: middleY },
    label: { x: (start.x + end.x) / 2 + width / 2 + 10, y: middleY, width, height },
  };
}

export function routePath(route: ConnectionRoute): string {
  return `M ${route.start.x} ${route.start.y} C ${route.control1.x} ${route.control1.y}, ${route.control2.x} ${route.control2.y}, ${route.end.x} ${route.end.y}`;
}

export function stackConnectionLabel(route: ConnectionRoute, occupied: Rect[]): ConnectionRoute {
  const next = {
    ...route,
    control1: { ...route.control1 }, control2: { ...route.control2 },
    label: { ...route.label },
  };
  let guard = 0;
  const labelRect = (): Rect => ({ x: next.label.x - next.label.width / 2, y: next.label.y - next.label.height / 2, width: next.label.width, height: next.label.height });
  while (occupied.some((rect) => overlaps(labelRect(), rect)) && guard < 8) {
    const offset = next.label.height + 8;
    next.label.y -= offset;
    next.control1.y -= offset;
    next.control2.y -= offset;
    guard += 1;
  }
  occupied.push(labelRect());
  return next;
}
