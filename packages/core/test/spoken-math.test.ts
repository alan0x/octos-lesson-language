import test from "node:test";
import assert from "node:assert/strict";
import { spokenText } from "../src/index.js";

// Every construct found in narration of generated lessons (171 local lessons, 2026-11-13): equals,
// signs, coordinates, subscripts, powers, fractions, ×; plus the common ones a lesson can reach.
const CHINESE: Array<[string, string]> = [
  ["所以 $2x = 12$。", "所以 2 x 等于 12。"],
  ["直线 $y = k_1 x + b_1$ 与 $y = -x + 2$", "直线 y 等于 k1 x 加 b1 与 y 等于 负x 加 2"],
  ["解出 $x = \\frac{2}{3}$", "解出 x 等于 3 分之 2"],
  ["交点 $(1.5, 0.5)$ 与 $(-1, 2)$", "交点 (1.5, 0.5) 与 (负1, 2)"],
  ["写成 $k = \\frac{y_2 - y_1}{x_2 - x_1}$！", "写成 k 等于 分子 y2 减 y1，分母 x2 减 x1！"],
  ["$y = 3 \\times 1^2 = 3$", "y 等于 3 乘 1 的平方 等于 3"],
  ["$a > 0$ 且 $a \\ne b$", "a 大于 0 且 a 不等于 b"],
  ["$-3 + 5 = 2$", "负3 加 5 等于 2"],
  ["$(x+1)^2$ 与 $x^{10}$ 和 $x^3$", "x 加 1 整体的平方 与 x 的 10 次方 和 x 的立方"],
  ["$\\sqrt{16} = 4$，$\\pi r^2$", "根号 16 等于 4，派 r 的平方"],
  ["切线 $y - y_0 = f'(x_0)(x - x_0)$", "切线 y 减 y0 等于 f 撇 (x0) (x 减 x0)"],
  ["角是 $45^\\circ$，占 $50\\%$", "角是 45 度，占 百分之50"],
  ["当 $x \\le 3$ 时", "当 x 小于等于 3 时"],
];

const ENGLISH: Array<[string, string]> = [
  ["So $2x = 12$.", "So 2 x equals 12."],
  ["Solve $\\frac{x+1}{2} = 3$.", "Solve the quantity x plus 1, over 2 equals 3."],
  ["Then $(a-b)^2$ and $\\sqrt{16} = 4$.", "Then the quantity a minus b, squared and the square root of 16 equals 4."],
  ["The point $(-1, 2)$ lies on $y = -x + 1$.", "The point (negative 1, 2) lies on y equals negative x plus 1."],
  ["Here $x_1 < x_2$ and $x^2 \\ge 0$.", "Here x 1 is less than x 2 and x squared is greater than or equal to 0."],
];

test("narration math is spoken as words in the sentence's language", () => {
  for (const [text, spoken] of CHINESE) assert.equal(spokenText(text, "zh-CN"), spoken, text);
  for (const [text, spoken] of ENGLISH) assert.equal(spokenText(text, "en-US"), spoken, text);
});

test("without a language, Chinese characters choose the Chinese reading", () => {
  assert.equal(spokenText("解出 $x = \\frac{2}{3}$"), "解出 x 等于 3 分之 2");
  assert.equal(spokenText("So $x = \\frac{2}{3}$."), "So x equals 2 over 3.");
});

test("no markup reaches the voice: no dollars, backslashes, carets, underscores or braces from a formula", () => {
  const unknown = "未知命令 $\\foo{x} + \\left( y \\right)$ 与 $\\text{cm}^2$";
  for (const [text] of [...CHINESE, ...ENGLISH, [unknown, ""]]) {
    const spoken = spokenText(text);
    assert.doesNotMatch(spoken, /[$\\^_{}]/u, `${text} → ${spoken}`);
  }
});

test("plain text, prices and escaped dollars are left as written", () => {
  assert.equal(spokenText("今天我们学习一次函数。"), "今天我们学习一次函数。");
  assert.equal(spokenText("A book costs $5 and a pen costs $10."), "A book costs $5 and a pen costs $10.");
  assert.equal(spokenText("价格是 \\$3"), "价格是 $3");
});
