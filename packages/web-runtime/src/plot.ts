import { compileMathExpression } from "../../core/src/math-expression.js";

export interface PlotRange {
  min: number;
  max: number;
}

export interface PlotSample {
  x: number;
  y: number;
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

export function compilePlotExpression(expression: string): PlotExpression {
  const normalized = normalizedExpression(expression);
  let evaluate: ReturnType<typeof compileMathExpression>;
  try {
    evaluate = compileMathExpression(normalized, ["x"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid expression";
    if (message.startsWith("Unknown variable or function")) throw new Error(`Unsupported function in plot expression: ${message}`);
    throw error;
  }
  return (x) => evaluate({ x });
}

export function evaluatePlotExpression(expression: string, x: number): number {
  return compilePlotExpression(expression)(x);
}

export function samplePlotExpression(
  expression: string,
  xRange: PlotRange,
  yRange: PlotRange,
  sampleCount = 241,
): PlotSample[][] {
  if (!Number.isFinite(xRange.min) || !Number.isFinite(xRange.max) || xRange.max <= xRange.min) {
    throw new Error("Plot x axis requires finite min < max");
  }
  if (!Number.isFinite(yRange.min) || !Number.isFinite(yRange.max) || yRange.max <= yRange.min) {
    throw new Error("Plot y axis requires finite min < max");
  }
  const count = Math.max(2, Math.min(1001, Math.floor(sampleCount)));
  const evaluate = compilePlotExpression(expression);
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
