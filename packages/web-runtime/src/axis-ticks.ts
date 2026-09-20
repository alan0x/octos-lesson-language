import type { PlotRange } from "./plot.js";

export interface AxisTickPlan {
  major: number[];
  minor: number[];
  step: number;
  format(value: number): string;
}

export interface AxisTickOptions {
  minMajorPixelSpacing?: number;
  minMinorPixelSpacing?: number;
  previousStep?: number;
  maxTickCount?: number;
}

const NICE_MULTIPLIERS = [1, 2, 5, 10] as const;

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / power;
  return (NICE_MULTIPLIERS.find((value) => normalized <= value) ?? 10) * power;
}

function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, Math.min(12, -Math.floor(Math.log10(step))));
}

function tickValues(range: PlotRange, step: number, maxTickCount: number): number[] {
  const epsilon = step * 1e-9;
  const first = Math.ceil((range.min - epsilon) / step);
  const last = Math.floor((range.max + epsilon) / step);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];
  if (last - first + 1 > maxTickCount) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const value = (first + index) * step;
    return Math.abs(value) <= epsilon ? 0 : value;
  });
}

/**
 * Choose readable ticks independently from the authored view boundaries.
 * A range such as [-.75, 8.75] therefore produces 0, 2, 4, 6, 8 in a
 * compact card instead of treating the padding boundaries as labels.
 */
export function planAxisTicks(
  range: PlotRange,
  pixelLength: number,
  options: AxisTickOptions = {},
): AxisTickPlan {
  const span = range.max - range.min;
  const maxTickCount = Math.max(2, Math.floor(options.maxTickCount ?? 200));
  const minMajorPixelSpacing = Math.max(24, options.minMajorPixelSpacing ?? 48);
  const safePixels = Number.isFinite(pixelLength) && pixelLength > 0 ? pixelLength : 240;
  const targetIntervals = Math.max(1, Math.floor(safePixels / minMajorPixelSpacing));
  let step = niceStep(span / targetIntervals);

  const previous = options.previousStep;
  if (previous && Number.isFinite(previous) && previous > 0) {
    const previousSpacing = safePixels * previous / span;
    if (previousSpacing >= minMajorPixelSpacing * .82
      && previousSpacing <= minMajorPixelSpacing * 2.35) step = previous;
  }

  let major = tickValues(range, step, maxTickCount);
  while (!major.length && step < span * 10) {
    step = niceStep(step * 1.01);
    major = tickValues(range, step, maxTickCount);
  }

  const minMinorPixelSpacing = Math.max(10, options.minMinorPixelSpacing ?? 20);
  const minorStep = step / (Math.abs(step / 10 ** Math.floor(Math.log10(step)) - 2) < 1e-10 ? 2 : 5);
  const minorSpacing = safePixels * minorStep / span;
  const majorKeys = new Set(major.map((value) => Math.round(value / minorStep)));
  const minor = minorSpacing >= minMinorPixelSpacing
    ? tickValues(range, minorStep, maxTickCount * 5)
      .filter((value) => !majorKeys.has(Math.round(value / minorStep)))
    : [];
  const decimals = decimalsForStep(step);

  return {
    major,
    minor,
    step,
    format(value: number): string {
      if (!Number.isFinite(value)) return "";
      const normalized = Math.abs(value) < step * 1e-9 ? 0 : value;
      if (Math.abs(normalized) >= 1e9 || (Math.abs(normalized) > 0 && Math.abs(normalized) < 1e-6)) {
        return normalized.toExponential(2).replace(/\.00e/u, "e").replace(/\.0e/u, "e");
      }
      return Number(normalized.toFixed(decimals)).toString();
    },
  };
}
