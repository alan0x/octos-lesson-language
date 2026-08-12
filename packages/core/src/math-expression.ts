export type MathVariableValues = Readonly<Record<string, number>>;
export type CompiledMathExpression = (variables: MathVariableValues) => number;

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

function normalizeExpression(expression: string): string {
  const normalized = expression
    .trim()
    .replaceAll("π", "pi")
    .replaceAll("−", "-")
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .trim();
  if (!normalized) throw new Error("Expression is empty");
  if (normalized.length > 256) throw new Error("Expression is too long");
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
    const identifier = remaining.match(/^[a-z][a-z0-9_]*/i);
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
    throw new Error(`Unsupported token '${symbol}'`);
  }
  result.push({ kind: "eof", value: "" });
  return result;
}

class ExpressionParser {
  private cursor = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly allowedVariables: ReadonlySet<string>,
  ) {}

  parse(): CompiledMathExpression {
    const expression = this.parseSum();
    if (this.current().kind !== "eof") throw new Error(`Unexpected token '${this.current().value}'`);
    return expression;
  }

  private current(): Token { return this.tokens[this.cursor]!; }

  private take(value?: string): Token {
    const token = this.current();
    if (value !== undefined && token.value !== value) throw new Error(`Expected '${value}'`);
    this.cursor += 1;
    return token;
  }

  private parseSum(): CompiledMathExpression {
    let left = this.parseProduct();
    while (this.current().value === "+" || this.current().value === "-") {
      const operator = this.take().value;
      const right = this.parseProduct();
      const prior = left;
      left = operator === "+"
        ? (variables) => prior(variables) + right(variables)
        : (variables) => prior(variables) - right(variables);
    }
    return left;
  }

  private parseProduct(): CompiledMathExpression {
    let left = this.parseUnary();
    while (this.current().value === "*" || this.current().value === "/") {
      const operator = this.take().value;
      const right = this.parseUnary();
      const prior = left;
      left = operator === "*"
        ? (variables) => prior(variables) * right(variables)
        : (variables) => prior(variables) / right(variables);
    }
    return left;
  }

  private parseUnary(): CompiledMathExpression {
    if (this.current().value === "+") {
      this.take("+");
      return this.parseUnary();
    }
    if (this.current().value === "-") {
      this.take("-");
      const operand = this.parseUnary();
      return (variables) => -operand(variables);
    }
    return this.parsePower();
  }

  private parsePower(): CompiledMathExpression {
    const base = this.parsePrimary();
    if (this.current().value !== "^") return base;
    this.take("^");
    const exponent = this.parseUnary();
    return (variables) => base(variables) ** exponent(variables);
  }

  private parsePrimary(): CompiledMathExpression {
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
    if (token.kind !== "identifier") throw new Error("Expected a number, variable, or function");
    const identifier = this.take().value;
    if (identifier === "pi") return () => Math.PI;
    if (identifier === "e") return () => Math.E;
    if (this.allowedVariables.has(identifier)) {
      return (variables) => {
        const value = variables[identifier];
        if (!Number.isFinite(value)) throw new Error(`Variable '${identifier}' has no finite value`);
        return value;
      };
    }
    const operation = FUNCTIONS[identifier];
    if (!operation) throw new Error(`Unknown variable or function '${identifier}'`);
    this.take("(");
    const argument = this.parseSum();
    this.take(")");
    return (variables) => operation(argument(variables));
  }
}

export function compileMathExpression(
  expression: string,
  allowedVariables: Iterable<string>,
): CompiledMathExpression {
  const variables = new Set([...allowedVariables].map((value) => value.toLowerCase()));
  return new ExpressionParser(tokenize(normalizeExpression(expression)), variables).parse();
}

export function evaluateMathExpression(
  expression: string,
  variables: MathVariableValues,
): number {
  const result = compileMathExpression(expression, Object.keys(variables))(variables);
  if (!Number.isFinite(result)) throw new Error("Expression result is not finite");
  return result;
}
