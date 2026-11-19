import test from "node:test";
import assert from "node:assert/strict";
import { compileMathExpression } from "../../core/src/math-expression.js";
import { PlotDerivationRefusal, plotFormulaText, plotFormulaTokens } from "../src/plot-tokens.js";
import { markParts, polynomialOf } from "../src/plot-marks.js";
import { formulaBars, pieceBars } from "../src/plot-domain-range.js";
import { intervalOf, signOf } from "../src/interval.js";

const labels = (text: string) => text;
const at = (expression: string, values: Record<string, number>) => compileMathExpression(expression, Object.keys(values))(values);

test("formula tokens follow OLL's expression grammar: precedence, a signed power, functions", () => {
  for (const [expression, variables] of [["-x^2+2*x-3", []], ["a*(x-2)^2+1", ["a"]], ["2^-x", []], ["sqrt(x-3)+1", []], ["−k*x + π", ["k"]], ["e^(x/2)", []]] as const) {
    const tokens = plotFormulaTokens(expression, variables);
    const names = ["x", ...variables];
    for (const x of [-2.5, 0.5, 4]) {
      const values = Object.fromEntries(names.map((name, index) => [name, name === "x" ? x : 1.5 + index]));
      const expected = compileMathExpression(expression, names)(values), actual = compileMathExpression(plotFormulaText(tokens), names)(values);
      if (Number.isFinite(expected)) assert.ok(Math.abs(expected - actual) < 1e-12, `${expression} at ${x}`);
    }
  }
  assert.throws(() => plotFormulaTokens("b*x"), /unknown variable or function 'b'/u);
  assert.throws(() => plotFormulaTokens("(x+1"), /expected '\)'/u);
});

test("marks of a quadratic and of a line, bound to the lesson's variables", () => {
  const parts = markParts(plotFormulaTokens("a*(x-2)^2+1", ["a"]), ["vertex", "symmetry_axis", "intercepts"], labels, { variables: ["a"], samples: [{ a: 1 }, { a: -2 }] }, "$plot");
  const vertex = parts.find((part) => part.as === "mark-vertex")!;
  assert.ok(Math.abs(at(vertex.x!, { a: 1 }) - 2) < 1e-12 && Math.abs(at(vertex.y!, { a: 1 }) - 1) < 1e-12);
  assert.ok(Math.abs(at(parts.find((part) => part.as === "mark-axis")!.value!, { a: -2 }) - 2) < 1e-12);
  // a = −2 crosses the x-axis at 2 ± 1/√2.
  const xs = parts.filter((part) => part.as.startsWith("mark-x-intercept")).map((part) => at(part.x!, { a: -2 })).sort((p, q) => p - q);
  assert.ok(Math.abs(xs[0]! - (2 - Math.SQRT1_2)) < 1e-12 && Math.abs(xs[1]! - (2 + Math.SQRT1_2)) < 1e-12);
  const line = markParts(plotFormulaTokens("3*x-2"), ["intercepts"], labels, { variables: [], samples: [{}] }, "$plot");
  // Constants are written to 12 significant digits, as Coach always wrote them.
  assert.deepEqual(line.map((part) => [part.as, Number(at(part.x!, {}).toPrecision(9)), at(part.y!, {})]), [["mark-y-intercept", 0, -2], ["mark-x-intercept", 0.666666667, 0]]);
});

test("a mark the formula cannot give is a refusal with its path, never a guess", () => {
  assert.throws(() => markParts(plotFormulaTokens("3*x-2"), ["vertex"], labels, { variables: [], samples: [{}] }, "$plot"),
    (error) => error instanceof PlotDerivationRefusal && error.path === "$plot.marks" && /vertex mark needs a quadratic/u.test(error.message));
  assert.throws(() => markParts(plotFormulaTokens("x^3"), ["intercepts"], labels, { variables: [], samples: [{}] }, "$plot"), PlotDerivationRefusal);
  assert.equal(polynomialOf(plotFormulaTokens("x^3"), 3)!.length, 4);
});

test("domain and range bars, from exact formulas only", () => {
  const sign = (text: string) => signOf(intervalOf(text, { a: [-1, 1] }));
  const root = formulaBars(plotFormulaTokens("sqrt(x-3)+1"), { domain: true, range: true }, { sign }, "$plot");
  assert.deepEqual(root.map((bar) => [bar.axis, bar.from === null ? null : at(bar.from, {}), bar.to, bar.from_closed]), [["x", 3, null, true], ["y", 1, null, true]]);
  // A range whose side a slider decides (a from −1 to 1): two guarded bars, never one guessed side.
  const flip = formulaBars(plotFormulaTokens("a*(x+2)^2+5", ["a"]), { domain: false, range: true }, { sign }, "$plot");
  assert.equal(flip.length, 2);
  assert.throws(() => formulaBars(plotFormulaTokens("x^4-x"), { domain: false, range: true }, { sign }, "$plot"), PlotDerivationRefusal);
  const pieces = pieceBars([
    { tokens: plotFormulaTokens("x+2"), from: null, to: 1, from_closed: false, to_closed: false },
    { tokens: plotFormulaTokens("4"), from: 1, to: null, from_closed: true, to_closed: false },
  ], { domain: true, range: false }, "$plot");
  assert.equal(pieces.length > 0, true);
});

test("signs are proved over the variables' ranges", () => {
  assert.equal(signOf(intervalOf("n1^2+1", { n1: [-3, 3] })), "positive");
  assert.equal(signOf(intervalOf("n1^2-1", { n1: [-3, 3] })), "unknown");
});

test("the shared API refuses or keeps working where outside callers could break it (review of #69)", () => {
  // A Studio slider keeps its spelling, and its sign is still proved.
  const tokens = plotFormulaTokens("A*x^2+1", ["A"]);
  assert.deepEqual(tokens.filter((token) => token.kind === "variable"), [{ kind: "variable", name: "A" }]);
  assert.equal(markParts(tokens, ["vertex"], labels, { variables: ["A"], samples: [{ A: 1 }] }, "$plot").length, 1);
  // Names that would read as something else, and numbers that are not finite, are refused when parsing.
  assert.throws(() => plotFormulaTokens("sqrt*x", ["sqrt"]), /cannot name a variable/u);
  assert.throws(() => plotFormulaTokens("1e400*x+1"), /invalid number/u);
  // Only the marks derived here are drawn; none asked is none drawn.
  assert.deepEqual(markParts(plotFormulaTokens("x^2-1"), ["domain", "range", "slope_triangle"], labels, { variables: [], samples: [{}] }, "$plot"), []);
  // Malformed tokens and a formula too long to compile once bracketed are refusals with a path, not crashes.
  assert.throws(() => formulaBars([{ kind: "negate" }], { domain: true, range: false }, { sign: () => "unknown" }, "$plot"), PlotDerivationRefusal);
  const long = plotFormulaTokens(`x^2+2*x+1+${Array.from({ length: 20 }, (_, i) => `a*${i + 1}`).join("+")}`, ["a"]);
  assert.throws(() => markParts(long, ["vertex"], labels, { variables: ["a"], samples: [{ a: 1 }] }, "$plot"), PlotDerivationRefusal);
  // A power of constants is a constant, so (2^0 − 1)x² + x is a line: no vertex.
  assert.throws(() => markParts(plotFormulaTokens("(2^0-1)*x^2+x"), ["vertex"], labels, { variables: [], samples: [{}] }, "$plot"), /needs a quadratic/u);
});

test("a coefficient that cancels to a rounding residue hides its marks as at an exact 0", () => {
  // a = 0.1·n − 0.3 is 5.6e-17 at n = 3 in floating point: the vertex must hide, as it does at a = 0.
  const parts = markParts(plotFormulaTokens("(0.1*n-0.3)*x^2+x+1", ["n"]), ["vertex", "symmetry_axis", "intercepts"], labels, { variables: ["n"], samples: [{ n: 1 }, { n: 5 }] }, "$plot");
  const vertex = parts.find((part) => part.as === "mark-vertex")!;
  assert.ok(!Number.isFinite(at(vertex.x!, { n: 3 })), "the vertex hides at the residue");
  assert.ok(Math.abs(at(vertex.x!, { n: 5 }) - -2.5) < 1e-9, "and is where it was elsewhere: -1/(2·0.2)");
  for (const part of parts.filter((item) => item.as.startsWith("mark-x-intercept"))) assert.ok(!Number.isFinite(at(part.x!, { n: 3 })));
  // A double root whose discriminant cancels to −2.2e-16 is still drawn: 0.45x² + 0.9x + 0.45 has x = −1
  // twice, but with b = 0.3·m at m = 3, b² − 4ac is −2.2e-16 in floating point and its square root fails.
  const double = markParts(plotFormulaTokens("0.45*x^2+0.3*m*x+0.45", ["m"]), ["intercepts"], labels, { variables: ["m"], samples: [{ m: 1 }, { m: 4 }] }, "$plot");
  for (const part of double.filter((item) => item.as.startsWith("mark-x-intercept"))) assert.ok(Math.abs(at(part.x!, { m: 3 }) - -1) < 1e-5, part.x!);
  // A single product cannot cancel, so it is written as before.
  const plain = markParts(plotFormulaTokens("a*x^2+1", ["a"]), ["vertex"], labels, { variables: ["a"], samples: [{ a: 1 }] }, "$plot");
  assert.ok(!plain[0]!.x!.includes("round("));
});
