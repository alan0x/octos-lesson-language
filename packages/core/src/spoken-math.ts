import { inlineMathSegments } from "./inline-math.js";

/**
 * Lesson text as it should be spoken. Narration and practice text carry inline math (`$x = \frac{2}{3}$`)
 * for captions and cards; a speech voice must never receive that markup, whatever a provider would do
 * with it. Each formula becomes words in the sentence's language; plain text, prices and escaped
 * dollars are left as written (an escaped `\$` loses its backslash). Anything the reader does not know
 * is spoken as its plain letters, never as LaTeX.
 */
export function spokenText(text: string, language?: string): string {
  const chinese = language ? /^zh(?:-|$)/i.test(language) : /[㐀-鿿]/u.test(text);
  const words = chinese ? ZH : EN;
  return inlineMathSegments(text)
    .map((segment) => segment.kind === "math"
      ? ` ${speakSafely(segment.value, words)} `
      : segment.value.replace(/\\\$/gu, "$"))
    .join("")
    .replace(/ {2,}/gu, " ")
    .replace(/ ([，。！？、；：,.!?;:）)])/gu, "$1")
    .replace(/([（(，。！？、；：]) /gu, "$1")
    .trim();
}

/**
 * A formula as words. Whatever the input, nothing that reads as markup survives: an unexpected
 * failure falls back to the formula's plain letters, and any `$ \ ^ _ { }` left is removed.
 */
function speakSafely(source: string, words: Words): string {
  let spoken: string;
  try { spoken = speakMath(source, words).text; }
  catch { spoken = source.replace(/\\([A-Za-z]+)/gu, " $1 "); }
  return spoken.replace(/[$\\^_{}]/gu, " ").replace(/ {2,}/gu, " ").trim();
}

interface Words {
  plus: string; minus: string; negative: string; times: string; divided: string; equals: string;
  notEqual: string; approx: string; less: string; greater: string; lessEq: string; greaterEq: string;
  plusMinus: string; degree: string; percent: string; prime: string;
  /** `compound`: a part holds an operation ("y2 − y1"), so the reading must keep it together. */
  fraction: (numerator: Part, denominator: Part) => string;
  power: (base: Part, exponent: string) => string;
  root: (radicand: string, index?: string) => string;
  subscript: (base: string, index: string) => string;
  greek: Record<string, string>;
}

/**
 * `compound`: the part holds an operation ("y2 − y1"), so a fraction is read part by part.
 * `grouped`: the part is more than one item ("x + 1", "xy"), so a power applies to all of it.
 */
interface Part { text: string; compound: boolean; grouped?: boolean }

const GREEK_EN: Record<string, string> = {
  alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta", theta: "theta", lambda: "lambda", mu: "mu",
  pi: "pi", sigma: "sigma", phi: "phi", omega: "omega", Delta: "delta", varphi: "phi", epsilon: "epsilon",
};

const ZH: Words = {
  plus: "加", minus: "减", negative: "负", times: "乘", divided: "除以", equals: "等于", notEqual: "不等于",
  approx: "约等于", less: "小于", greater: "大于", lessEq: "小于等于", greaterEq: "大于等于", plusMinus: "正负",
  degree: "度", percent: "百分之", prime: "撇",
  fraction: (n, d) => n.compound || d.compound ? `分子 ${n.text}，分母 ${d.text}` : `${d.text} 分之 ${n.text}`,
  power: (base, exponent) => {
    const of = base.grouped ? `${base.text} 整体的` : `${base.text} 的`;
    return exponent === "2" ? `${of}平方` : exponent === "3" ? `${of}立方` : `${of} ${exponent} 次方`;
  },
  root: (radicand, index) => index && index !== "2" ? `${index} 次根号 ${radicand}` : `根号 ${radicand}`,
  subscript: (base, index) => `${base}${index}`,
  greek: { ...GREEK_EN, pi: "派" },
};

const EN: Words = {
  plus: "plus", minus: "minus", negative: "negative", times: "times", divided: "divided by", equals: "equals",
  notEqual: "is not equal to", approx: "is approximately", less: "is less than", greater: "is greater than",
  lessEq: "is less than or equal to", greaterEq: "is greater than or equal to", plusMinus: "plus or minus",
  degree: "degrees", percent: "percent", prime: "prime",
  fraction: (n, d) => n.compound || d.compound
    ? `${n.compound ? `the quantity ${n.text}` : n.text}, over ${d.compound ? `the quantity ${d.text}` : d.text}`
    : `${n.text} over ${d.text}`,
  power: (base, exponent) => {
    const of = base.grouped ? `the quantity ${base.text},` : base.text;
    return exponent === "2" ? `${of} squared` : exponent === "3" ? `${of} cubed` : `${of} to the power ${exponent}`;
  },
  root: (radicand, index) => index === "3" ? `the cube root of ${radicand}` : index && index !== "2" ? `the ${index}th root of ${radicand}` : `the square root of ${radicand}`,
  subscript: (base, index) => `${base} ${index}`,
  greek: GREEK_EN,
};

/** Commands that only space or size a formula. */
const SILENT = new Set(["left", "right", "displaystyle", "textstyle", ",", ";", ":", "!", "quad", "qquad", " ", "big", "Big", "bigl", "bigr"]);
/** Commands that only style the formula they wrap: their argument is read as math. */
const MATH_WRAPPERS = new Set(["mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathbb", "boldsymbol", "bm", "operatorname"]);
/** Commands whose argument is ordinary text (which may itself hold `$…$`). */
const TEXT_COMMANDS = new Set(["text", "textbf", "textit", "textrm", "mbox"]);

/** An operation at the top of a formula part (a leading sign does not count). */
function isCompound(source: string): boolean {
  return /[+\-−=<>±×÷]|\\(?:times|cdot|div|pm|le|ge|ne)\b/u.test(source.trim().replace(/^[-−+]/u, ""));
}

interface Spoken { text: string; size: number }

function speakMath(source: string, words: Words): Spoken {
  let cursor = 0;
  const peek = () => source[cursor];
  const skipSpace = () => { while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1; };

  const readCommand = (): string => {
    cursor += 1; // backslash
    const start = cursor;
    if (/[A-Za-z]/u.test(source[cursor] ?? "")) { while (/[A-Za-z]/u.test(source[cursor] ?? "")) cursor += 1; }
    else cursor += 1;
    return source.slice(start, cursor);
  };

  /** The source of a balanced `{…}` at the cursor (to the end if it never closes); the cursor moves past it. */
  const readBraced = (): string => {
    cursor += 1;
    const start = cursor;
    let depth = 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") { cursor += 2; continue; }
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}" && --depth === 0) { cursor += 1; return source.slice(start, cursor - 1); }
      cursor += 1;
    }
    cursor = source.length;
    return source.slice(start);
  };

  /** A `{…}` group or one token, read as a whole expression. */
  const readArgument = (): Part => {
    skipSpace();
    if (peek() === "{") {
      const inner = readBraced();
      const spoken = speakMath(inner, words);
      return { text: spoken.text, compound: isCompound(inner), grouped: spoken.size > 1 };
    }
    if (/\d/u.test(peek() ?? "")) { cursor += 1; return { text: source[cursor - 1]!, compound: false }; }
    return { text: readAtom()?.text ?? "", compound: false };
  };

  const atoms: Atom[] = [];

  const readAtom = (): Atom | null => {
    skipSpace();
    const char = peek();
    if (char === undefined) return null;
    if (/\d/u.test(char)) {
      const match = /^\d+(?:\.\d+)?/u.exec(source.slice(cursor))!;
      cursor += match[0].length;
      return { text: match[0] };
    }
    if (/[A-Za-z]/u.test(char)) { cursor += 1; return { text: char }; }
    if (char === "{") { const group = readArgument(); return { text: group.text, grouped: group.grouped }; }
    if (char === "\\") {
      const command = readCommand();
      if (SILENT.has(command)) return { text: "" };
      if (command === "frac" || command === "dfrac" || command === "tfrac") {
        const numerator = readArgument();
        return { text: words.fraction(numerator, readArgument()) };
      }
      if (command === "sqrt") {
        skipSpace();
        let index: string | undefined;
        // An index without its "]" is left to be read as plain text.
        const end = peek() === "[" ? source.indexOf("]", cursor) : -1;
        if (end > cursor) { index = speakMath(source.slice(cursor + 1, end), words).text; cursor = end + 1; }
        return { text: words.root(readArgument().text, index) };
      }
      if (MATH_WRAPPERS.has(command)) {
        const wrapped = readArgument();
        return { text: wrapped.text, grouped: wrapped.grouped };
      }
      if (TEXT_COMMANDS.has(command)) {
        skipSpace();
        if (peek() !== "{") return { text: "" };
        return { text: textModeWords(readBraced(), words) };
      }
      const operator = ({ times: words.times, cdot: words.times, div: words.divided, pm: words.plusMinus,
        le: words.lessEq, leq: words.lessEq, ge: words.greaterEq, geq: words.greaterEq, ne: words.notEqual,
        neq: words.notEqual, approx: words.approx, lt: words.less, gt: words.greater } as Record<string, string>)[command];
      if (operator) return { text: operator, operator: true };
      if (command === "circ") return { text: words.degree };
      if (command === "%") return { text: "%" };
      if (command === "{" || command === "}") return { text: "" };
      if (command in words.greek) return { text: words.greek[command]! };
      // An unknown command is spoken as its letters, never as markup.
      return { text: command };
    }
    cursor += 1;
    switch (char) {
      case "+": return { text: words.plus, operator: true };
      case "-": case "−": return { text: "-", operator: true };
      case "×": case "*": case "·": return { text: words.times, operator: true };
      case "÷": return { text: words.divided, operator: true };
      case "/": return { text: words.divided, operator: true };
      case "=": return { text: words.equals, operator: true };
      case "≠": return { text: words.notEqual, operator: true };
      case "≈": return { text: words.approx, operator: true };
      case "<": return { text: words.less, operator: true };
      case ">": return { text: words.greater, operator: true };
      case "≤": return { text: words.lessEq, operator: true };
      case "≥": return { text: words.greaterEq, operator: true };
      case "±": return { text: words.plusMinus, operator: true };
      case "π": return { text: words.greek.pi! };
      case "°": return { text: words.degree };
      case "²": return { text: "^2" };
      case "³": return { text: "^3" };
      case "(": case "[": return { text: char, open: true };
      case ",": return { text: ",", operator: true };
      case "}": return { text: "" };
      case "'": case "′": return { text: words.prime };
      default: return { text: char };
    }
  };

  /** The thing a power applies to: the last atom, or a whole bracket ("(x + 1)^2"). */
  const popBase = (): Part => {
    const last = atoms.pop();
    if (!last) return { text: "", compound: false };
    if (last.text !== ")") return { text: last.text, compound: false, grouped: last.grouped };
    const inner: Atom[] = [];
    let depth = 1;
    while (atoms.length) {
      const atom = atoms.pop()!;
      if (atom.text === ")") depth += 1;
      if (atom.open && atom.text === "(" && --depth === 0) break;
      inner.unshift(atom);
    }
    return { text: assemble(inner, words), compound: inner.some((atom) => atom.operator), grouped: inner.length > 1 };
  };

  while (cursor < source.length) {
    skipSpace();
    const char = peek();
    if (char === undefined) break;
    if (char === "^" || char === "_") {
      cursor += 1;
      const argument = readArgument().text;
      const base = popBase();
      // "45^\circ" is an angle, not a power.
      if (char === "^" && argument === words.degree) atoms.push({ text: `${base.text} ${words.degree}` });
      else atoms.push({ text: char === "^" ? words.power(base, argument) : words.subscript(base.text, argument) });
      continue;
    }
    const atom = readAtom();
    if (!atom) break;
    if (atom.text === "^2" || atom.text === "^3") {
      atoms.push({ text: words.power(popBase(), atom.text.slice(1)) });
      continue;
    }
    if (atom.text === "%") {
      const base = atoms.pop() ?? { text: "" };
      atoms.push({ text: words === ZH ? `${words.percent}${base.text}` : `${base.text} ${words.percent}` });
      continue;
    }
    if (atom.text) atoms.push(atom);
  }

  return { text: assemble(atoms, words), size: atoms.length };
}

/** Text inside `\text{…}`: escapes become their characters, an inner `$…$` is read as math, other commands as letters. */
function textModeWords(source: string, words: Words): string {
  return source
    .replace(/\$([^$]+)\$/gu, (_formula, math: string) => ` ${speakMath(math, words).text} `)
    .replace(/\\([%$&_#{}])/gu, "$1")
    .replace(/\\([A-Za-z]+)/gu, " $1 ")
    .replace(/[{}]/gu, "")
    .trim();
}

interface Atom { text: string; operator?: boolean; open?: boolean; grouped?: boolean }

/**
 * Words from atoms. A minus sign is "negative" where no value precedes it: at the start, after an
 * operator or an opening bracket ("-3 + 5", "x = -2", "(-1, 2)"); in Chinese it joins its number ("负3").
 */
function assemble(atoms: Atom[], words: Words): string {
  const spoken: string[] = [];
  let negative = false;
  atoms.forEach((atom, index) => {
    if (atom.text === "-") {
      const before = atoms[index - 1];
      negative = !before || Boolean(before.operator) || Boolean(before.open);
      spoken.push(negative ? words.negative : words.minus);
      return;
    }
    if (negative && words === ZH) spoken[spoken.length - 1] += atom.text;
    else spoken.push(atom.text);
    negative = false;
  });
  return spoken.join(" ").replace(/([([]) /gu, "$1").replace(/ ([)\],])/gu, "$1").trim();
}
