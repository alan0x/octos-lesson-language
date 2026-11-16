/**
 * A function plot's formula as postfix tokens, the form the plot derivations read (marks, domain and
 * range; OLL decision 0018). Coach's lesson plans carry these tokens already; Studio and others parse the
 * formula they hand to buildFunctionPlot with `plotFormulaTokens`, by the same grammar as OLL's expression
 * compiler.
 */

export type PlotFunctionName = "abs" | "acos" | "asin" | "atan" | "ceil" | "cos" | "exp" | "floor" | "ln" | "log" | "round" | "sin" | "sqrt" | "tan";

export type PlotToken =
  | { kind: "input" }
  /** A lesson variable, by the name bindings use (Coach's number_01, a Studio slider's name). */
  | { kind: "variable"; name: string }
  | { kind: "literal"; value: number }
  | { kind: "constant"; name: "pi" | "e" }
  | { kind: "negate" }
  | { kind: "operator"; operator: "add" | "subtract" | "multiply" | "divide" | "power" }
  | { kind: "function"; name: PlotFunctionName };

export type PlotFormula = PlotToken[];

/**
 * A derivation the program cannot make for this formula (a vertex of a line, the range of an even quartic),
 * with the path and message a caller reports. The caller decides: Coach leaves the mark out, Studio says why.
 */
export class PlotDerivationRefusal extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
    this.name = "PlotDerivationRefusal";
  }
}

const FUNCTION_NAMES = new Set<string>(["abs", "acos", "asin", "atan", "ceil", "cos", "exp", "floor", "ln", "log", "round", "sin", "sqrt", "tan"]);
const OPERATORS = { add: "+", subtract: "-", multiply: "*", divide: "/", power: "^" } as const;

/** The formula written back as OLL expression text, fully bracketed. */
export function plotFormulaText(tokens: PlotFormula): string {
  const stack: string[] = [];
  for (const token of tokens) {
    if (token.kind === "input") stack.push("x");
    else if (token.kind === "variable") stack.push(token.name);
    else if (token.kind === "literal") stack.push(String(token.value));
    else if (token.kind === "constant") stack.push(token.name);
    else if (token.kind === "negate" || token.kind === "function") {
      const value = stack.pop();
      if (value === undefined) throw new Error(`${token.kind} is missing an operand`);
      stack.push(token.kind === "negate" ? `-(${value})` : `${token.name}(${value})`);
    } else {
      const right = stack.pop(), left = stack.pop();
      if (left === undefined || right === undefined) throw new Error("operator is missing operands");
      stack.push(`(${left})${OPERATORS[token.operator]}(${right})`);
    }
  }
  if (stack.length !== 1) throw new Error("expression does not produce one result");
  return stack[0]!;
}

/**
 * Parses a formula in x and the named variables into postfix tokens, by the grammar of OLL's expression
 * compiler: + and − lowest, then * and /, then a unary sign, then ^ (right of it, a signed power).
 */
export function plotFormulaTokens(expression: string, variables: Iterable<string> = []): PlotFormula {
  // Variables keep the caller's spelling (a Studio slider "A"), matched without case as OLL's compiler does.
  // A variable may not be named like x, a constant or a function: derived texts would read it as that.
  const known = new Map<string, string>();
  for (const name of variables) {
    const lower = name.toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/u.test(lower) || lower === "x" || lower === "pi" || lower === "e" || FUNCTION_NAMES.has(lower)) {
      throw new Error(`'${name}' cannot name a variable in a plot formula`);
    }
    known.set(lower, name);
  }
  const text = expression.trim().replaceAll("π", "pi").replaceAll("−", "-").replaceAll("×", "*").replaceAll("÷", "/");
  if (!text || text.length > 256) throw new Error("expected a formula of 1 to 256 characters");
  const lexemes = text.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z][a-z0-9_]*|[-+*/^()]|\S/giu) ?? [];
  let position = 0;
  const peek = () => lexemes[position];
  const take = (expected?: string) => {
    const lexeme = lexemes[position++];
    if (expected !== undefined && lexeme !== expected) throw new Error(`expected '${expected}'`);
    return lexeme;
  };
  const out: PlotFormula = [];
  const sum = (): void => {
    product();
    while (peek() === "+" || peek() === "-") { const operator = take(); product(); out.push({ kind: "operator", operator: operator === "+" ? "add" : "subtract" }); }
  };
  const product = (): void => {
    unary();
    while (peek() === "*" || peek() === "/") { const operator = take(); unary(); out.push({ kind: "operator", operator: operator === "*" ? "multiply" : "divide" }); }
  };
  const unary = (): void => {
    if (peek() === "+") { take(); unary(); return; }
    if (peek() === "-") { take(); unary(); out.push({ kind: "negate" }); return; }
    power();
  };
  const power = (): void => {
    primary();
    if (peek() === "^") { take(); unary(); out.push({ kind: "operator", operator: "power" }); }
  };
  const primary = (): void => {
    const lexeme = take();
    if (lexeme === undefined) throw new Error("formula ended before a value");
    if (/^(?:\d|\.\d)/u.test(lexeme)) {
      const value = Number(lexeme);
      if (!Number.isFinite(value)) throw new Error(`invalid number '${lexeme}'`);
      out.push({ kind: "literal", value });
      return;
    }
    if (lexeme === "(") { sum(); take(")"); return; }
    const name = lexeme.toLowerCase();
    if (!/^[a-z]/u.test(name)) throw new Error(`unexpected '${lexeme}'`);
    if (name === "x") { out.push({ kind: "input" }); return; }
    if (name === "pi" || name === "e") { out.push({ kind: "constant", name }); return; }
    if (known.has(name)) { out.push({ kind: "variable", name: known.get(name)! }); return; }
    if (!FUNCTION_NAMES.has(name)) throw new Error(`unknown variable or function '${lexeme}'`);
    take("(");
    sum();
    take(")");
    out.push({ kind: "function", name: name as PlotFunctionName });
  };
  sum();
  if (position !== lexemes.length) throw new Error(`unexpected '${peek()}'`);
  return out;
}

/**
 * A formula handed to a derivation must be well formed (each operator has its operands, one result, finite
 * literals); otherwise the derivation refuses with this path instead of failing on the malformed tokens.
 */
export function checkPlotFormula(tokens: PlotFormula, path: string): void {
  try {
    plotFormulaText(tokens);
    if (tokens.some((token) => token.kind === "literal" && !Number.isFinite(token.value))) throw new Error("non-finite literal");
  } catch (error) {
    throw new PlotDerivationRefusal(path, `the formula is not well formed (${(error as Error).message})`);
  }
}
