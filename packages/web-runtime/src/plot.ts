import { compileMathExpression, referencedMathVariables } from "../../core/src/math-expression.js";

export interface PlotRange {
  min: number;
  max: number;
}

export interface PlotSample {
  x: number;
  y: number;
}

export interface ImplicitPlotOptions {
  level?: number;
  samples?: number;
  variables?: Readonly<Record<string, number>>;
}

type PlotExpression = (x: number) => number;

function normalizedExpression(expression: string): string {
  const normalized = expression
    .trim()
    .replace(/^y\s*=/i, "")
    .replaceAll("π", "pi")
    .replaceAll("−", "-")
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .trim();
  if (!normalized) throw new Error("Plot expression is empty");
  if (normalized.length > 256) throw new Error("Plot expression is too long");
  return normalized;
}

/** Return only the current lesson variables that can change these curves. */
export function referencedPlotVariables(
  expressions: readonly string[],
  variables: Readonly<Record<string, number>>,
): Record<string, number> {
  const allowed = Object.keys(variables);
  const referenced = new Set(
    expressions.flatMap((expression) => referencedMathVariables(normalizedExpression(expression), allowed)),
  );
  return Object.fromEntries(
    [...referenced].sort().map((name) => [name, variables[name]!]),
  );
}

export function compilePlotExpression(
  expression: string,
  variables: Readonly<Record<string, number>> = {},
): PlotExpression {
  const normalized = normalizedExpression(expression);
  let evaluate: ReturnType<typeof compileMathExpression>;
  try {
    evaluate = compileMathExpression(normalized, ["x", ...Object.keys(variables)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid expression";
    if (message.startsWith("Unknown variable or function")) throw new Error(`Unsupported function in plot expression: ${message}`);
    throw error;
  }
  return (x) => evaluate({ ...variables, x });
}

export function evaluatePlotExpression(
  expression: string,
  x: number,
  variables: Readonly<Record<string, number>> = {},
): number {
  return compilePlotExpression(expression, variables)(x);
}

export function samplePlotExpression(
  expression: string,
  xRange: PlotRange,
  yRange: PlotRange,
  sampleCount = 241,
  variables: Readonly<Record<string, number>> = {},
): PlotSample[][] {
  if (!Number.isFinite(xRange.min) || !Number.isFinite(xRange.max) || xRange.max <= xRange.min) {
    throw new Error("Plot x axis requires finite min < max");
  }
  if (!Number.isFinite(yRange.min) || !Number.isFinite(yRange.max) || yRange.max <= yRange.min) {
    throw new Error("Plot y axis requires finite min < max");
  }
  const count = Math.max(2, Math.min(1001, Math.floor(sampleCount)));
  const evaluate = compilePlotExpression(expression, variables);
  const ySpan = yRange.max - yRange.min;
  const jumpLimit = ySpan * 2;
  const magnitudeLimit = Math.max(Math.abs(yRange.min), Math.abs(yRange.max), 1) * 10_000;
  const segments: PlotSample[][] = [];
  let segment: PlotSample[] = [];
  const flush = () => {
    if (segment.length > 1) segments.push(segment);
    segment = [];
  };

  for (let index = 0; index < count; index += 1) {
    const x = xRange.min + (xRange.max - xRange.min) * index / (count - 1);
    const y = evaluate(x);
    const prior = segment.at(-1);
    if (!Number.isFinite(y) || Math.abs(y) > magnitudeLimit) {
      flush();
      continue;
    }
    if (prior && Math.abs(y - prior.y) > jumpLimit) flush();
    segment.push({ x, y });
  }
  flush();
  return segments;
}

export function sampleImplicitPlotExpression(
  expression: string,
  xRange: PlotRange,
  yRange: PlotRange,
  options: ImplicitPlotOptions = {},
): PlotSample[][] {
  if (!Number.isFinite(xRange.min) || !Number.isFinite(xRange.max) || xRange.max <= xRange.min) {
    throw new Error("Implicit plot x axis requires finite min < max");
  }
  if (!Number.isFinite(yRange.min) || !Number.isFinite(yRange.max) || yRange.max <= yRange.min) {
    throw new Error("Implicit plot y axis requires finite min < max");
  }
  const level = Number(options.level ?? 0);
  if (!Number.isFinite(level)) throw new Error("Implicit plot level must be finite");
  const samples = Math.max(16, Math.min(200, Math.floor(options.samples ?? 80)));
  const variables = options.variables ?? {};
  const evaluate = compileMathExpression(
    normalizedExpression(expression),
    ["x", "y", ...Object.keys(variables)],
  );
  const grid: number[][] = [];
  for (let xIndex = 0; xIndex <= samples; xIndex += 1) {
    const column: number[] = [];
    const x = xRange.min + (xRange.max - xRange.min) * xIndex / samples;
    for (let yIndex = 0; yIndex <= samples; yIndex += 1) {
      const y = yRange.min + (yRange.max - yRange.min) * yIndex / samples;
      column.push(evaluate({ ...variables, x, y }) - level);
    }
    grid.push(column);
  }
  const interpolate = (
    from: PlotSample,
    to: PlotSample,
    fromValue: number,
    toValue: number,
  ): PlotSample => {
    const denominator = fromValue - toValue;
    const amount = Math.abs(denominator) < 1e-12 ? .5 : fromValue / denominator;
    return {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    };
  };
  const segments: PlotSample[][] = [];
  for (let xIndex = 0; xIndex < samples; xIndex += 1) {
    const x0 = xRange.min + (xRange.max - xRange.min) * xIndex / samples;
    const x1 = xRange.min + (xRange.max - xRange.min) * (xIndex + 1) / samples;
    for (let yIndex = 0; yIndex < samples; yIndex += 1) {
      const y0 = yRange.min + (yRange.max - yRange.min) * yIndex / samples;
      const y1 = yRange.min + (yRange.max - yRange.min) * (yIndex + 1) / samples;
      const points = [
        { x: x0, y: y0 }, { x: x1, y: y0 },
        { x: x1, y: y1 }, { x: x0, y: y1 },
      ];
      const values = [
        grid[xIndex]![yIndex]!, grid[xIndex + 1]![yIndex]!,
        grid[xIndex + 1]![yIndex + 1]!, grid[xIndex]![yIndex + 1]!,
      ];
      if (values.some((value) => !Number.isFinite(value))) continue;
      const crossings: PlotSample[] = [];
      for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
        const fromValue = values[from]!;
        const toValue = values[to]!;
        if ((fromValue <= 0 && toValue > 0) || (fromValue > 0 && toValue <= 0)) {
          crossings.push(interpolate(points[from]!, points[to]!, fromValue, toValue));
        }
      }
      if (crossings.length === 2) {
        segments.push([crossings[0]!, crossings[1]!]);
      } else if (crossings.length === 4) {
        const centerValue = evaluate({
          ...variables,
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
        }) - level;
        const pairs = centerValue <= 0 ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
        for (const [from, to] of pairs) segments.push([crossings[from]!, crossings[to]!]);
      }
    }
  }
  return segments;
}

export function plotPathData(
  segments: PlotSample[][],
  mapX: (value: number) => number,
  mapY: (value: number) => number,
): string {
  return segments
    .map((segment) => segment
      .map((point, index) => `${index === 0 ? "M" : "L"} ${mapX(point.x).toFixed(2)} ${mapY(point.y).toFixed(2)}`)
      .join(" "))
    .join(" ");
}


/** A frame edge is not a zero axis when the origin is outside the window. */
export function zeroAxisPosition(range: PlotRange, map: (value: number) => number): number | undefined {
  return range.min <= 0 && range.max >= 0 ? map(0) : undefined;
}


export function secantMeasurement(a: PlotSample, b: PlotSample): {dx:number;dy:number;slope:number} | undefined {
  const dx=b.x-a.x, dy=b.y-a.y;
  if (![a.x,a.y,b.x,b.y,dx,dy].every(Number.isFinite)
    || Math.abs(dx)<=1e-9*Math.max(1,Math.abs(a.x),Math.abs(b.x))) return;
  const slope=dy/dx;
  return Number.isFinite(slope) ? {dx,dy,slope} : undefined;
}
