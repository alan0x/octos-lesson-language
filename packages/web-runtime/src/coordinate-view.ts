import type { PlotRange } from "./plot.js";

export interface CoordinateRanges {
  x: PlotRange;
  y: PlotRange;
}

const MIN_SPAN = 1e-7;
const MAX_SPAN = 1e9;
const MAX_ABSOLUTE_VALUE = 1e12;

export function validCoordinateRange(value: unknown, fallback: PlotRange): PlotRange {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const min = Number(candidate.min);
  const max = Number(candidate.max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : { ...fallback };
}

export function zoomCoordinateRanges(
  ranges: CoordinateRanges,
  factor: number,
  anchor = { x: .5, y: .5 },
): CoordinateRanges {
  if (!Number.isFinite(factor) || factor <= 0) return structuredClone(ranges);
  const nextSpans = {
    x: (ranges.x.max - ranges.x.min) * factor,
    y: (ranges.y.max - ranges.y.min) * factor,
  };
  if ([nextSpans.x, nextSpans.y].some((span) => !Number.isFinite(span) || span < MIN_SPAN || span > MAX_SPAN)) {
    return structuredClone(ranges);
  }
  const axis = (range: PlotRange, nextSpan: number, amount: number): PlotRange => {
    const safeAmount = Math.max(0, Math.min(1, amount));
    const fixed = range.min + (range.max - range.min) * safeAmount;
    return { min: fixed - nextSpan * safeAmount, max: fixed + nextSpan * (1 - safeAmount) };
  };
  const next = { x: axis(ranges.x, nextSpans.x, anchor.x), y: axis(ranges.y, nextSpans.y, anchor.y) };
  return [next.x.min, next.x.max, next.y.min, next.y.max].every((value) =>
    Number.isFinite(value) && Math.abs(value) <= MAX_ABSOLUTE_VALUE)
    ? next
    : structuredClone(ranges);
}

export function panCoordinateRanges(ranges: CoordinateRanges, dx: number, dy: number): CoordinateRanges {
  const next = {
    x: { min: ranges.x.min + dx, max: ranges.x.max + dx },
    y: { min: ranges.y.min + dy, max: ranges.y.max + dy },
  };
  return [next.x.min, next.x.max, next.y.min, next.y.max].every((value) =>
    Number.isFinite(value) && Math.abs(value) <= MAX_ABSOLUTE_VALUE)
    ? next
    : structuredClone(ranges);
}

/** Positive wheel deltas zoom out; negative deltas zoom in. */
export function coordinateWheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 240 : deltaY;
  return Math.exp(Math.max(-.24, Math.min(.24, pixels * .0018)));
}
