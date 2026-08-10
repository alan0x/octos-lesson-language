export interface PlotRange {
  min: number;
  max: number;
}

export interface PlotSample {
  x: number;
  y: number;
}

type PlotExpression = (x: number) => number;
type TokenKind = "number" | "identifier" | "symbol" | "eof";

interface Token {
  kind: TokenKind;
  value: string;
}

const FUNCTIONS: Record<string, (value: number) => number> = {
  abs: Math.abs,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};

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

function tokenize(expression: string): Token[] {
  const result: Token[] = [];
  let cursor = 0;
  while (cursor < expression.length) {
    const remaining = expression.slice(cursor);
    const whitespace = remaining.match(/^\s+/);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    const number = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      result.push({ kind: "number", value: number[0] });
      cursor += number[0].length;
      continue;
    }
    const identifier = remaining.match(/^[a-z]+/i);
    if (identifier) {
      result.push({ kind: "identifier", value: identifier[0].toLowerCase() });
      cursor += identifier[0].length;
      continue;
    }
    const symbol = remaining[0]!;
    if ("+-*/^()".includes(symbol)) {
      result.push({ kind: "symbol", value: symbol });
      cursor += 1;
      continue;
    }
    throw new Error(`Unsupported token '${symbol}' in plot expression`);
  }
  result.push({ kind: "eof", value: "" });
  return result;
}

class ExpressionParser {
  private cursor = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): PlotExpression {
    const expression = this.parseSum();
    if (this.current().kind !== "eof") {
      throw new Error(`Unexpected token '${this.current().value}' in plot expression`);
    }
    return expression;
  }

  private current(): Token {
    return this.tokens[this.cursor]!;
  }

  private take(value?: string): Token {
    const token = this.current();
    if (value !== undefined && token.value !== value) {
      throw new Error(`Expected '${value}' in plot expression`);
    }
    this.cursor += 1;
    return token;
  }

  private parseSum(): PlotExpression {
    let left = this.parseProduct();
    while (this.current().value === "+" || this.current().value === "-") {
      const operator = this.take().value;
      const right = this.parseProduct();
      const prior = left;
      left = operator === "+"
        ? (x) => prior(x) + right(x)
        : (x) => prior(x) - right(x);
    }
    return left;
  }

  private parseProduct(): PlotExpression {
    let left = this.parseUnary();
    while (this.current().value === "*" || this.current().value === "/") {
      const operator = this.take().value;
      const right = this.parseUnary();
      const prior = left;
      left = operator === "*"
        ? (x) => prior(x) * right(x)
        : (x) => prior(x) / right(x);
    }
    return left;
  }

  private parseUnary(): PlotExpression {
    if (this.current().value === "+") {
      this.take("+");
      return this.parseUnary();
    }
    if (this.current().value === "-") {
      this.take("-");
      const operand = this.parseUnary();
      return (x) => -operand(x);
    }
    return this.parsePower();
  }

  private parsePower(): PlotExpression {
    const base = this.parsePrimary();
    if (this.current().value !== "^") return base;
    this.take("^");
    const exponent = this.parseUnary();
    return (x) => base(x) ** exponent(x);
  }

  private parsePrimary(): PlotExpression {
    const token = this.current();
    if (token.kind === "number") {
      this.take();
      const value = Number(token.value);
      return () => value;
    }
    if (token.value === "(") {
      this.take("(");
      const value = this.parseSum();
      this.take(")");
      return value;
    }
    if (token.kind !== "identifier") {
      throw new Error(`Expected a number, x, or function in plot expression`);
    }
    const identifier = this.take().value;
    if (identifier === "x") return (x) => x;
    if (identifier === "pi") return () => Math.PI;
    if (identifier === "e") return () => Math.E;
    const operation = FUNCTIONS[identifier];
    if (!operation) throw new Error(`Unsupported function '${identifier}' in plot expression`);
    this.take("(");
    const argument = this.parseSum();
    this.take(")");
    return (x) => operation(argument(x));
  }
}

export function compilePlotExpression(expression: string): PlotExpression {
  const normalized = normalizedExpression(expression);
  return new ExpressionParser(tokenize(normalized)).parse();
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
