/**
 * A typed numeric answer. Learners write whole numbers, decimals, fractions
 * and mixed numbers; full-width digits and signs from Chinese input methods
 * are read the same as ASCII. Every form is reduced to one correctly rounded
 * division of integers (or one decimal parse), so two spellings of the same
 * rational number always give the same double and exact comparison is sound.
 */
export type NumericAnswerForm = "integer" | "decimal" | "fraction" | "mixed";

export interface ParsedNumericAnswer {
  value: number;
  form: NumericAnswerForm;
  /** Set for fractions and mixed numbers: the written fraction part. */
  numerator?: number;
  denominator?: number;
}

// A type alias, not an interface: validators narrow completions to plain records.
export type NumericAnswerCompletion = {
  kind: "numeric_answer";
  /** The expected answer, written the way a learner could type it. */
  answer: string;
  /** Absolute tolerance; omitted means the value must be exact. */
  tolerance?: number;
  /** Display-only unit shown after the input, never part of the answer. */
  unit?: string;
  /** `simplest_fraction` also requires a fraction in lowest terms. */
  form?: "any" | "simplest_fraction";
};

export type NumericAnswerCheck =
  | { readable: false }
  | { readable: true; value: number; succeeded: boolean; reason?: "value" | "form" };

const FULL_WIDTH: Record<string, string> = {
  "－": "-", "−": "-", "–": "-", "／": "/", "÷": "/", "．": ".", "。": ".", "，": ",", "　": " ",
};

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[－−–／÷．。，　]/g, (char) => FULL_WIDTH[char]!)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/^-\s+/, "-");
}

const INTEGER = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)$/;
const DECIMAL = /^(-?)(\d{1,3}(?:,\d{3})+|\d*)\.(\d+)$/;
const FRACTION = /^(-?)(\d+)\/(\d+)$/;
const MIXED = /^(-?)(\d+) (\d+)\/(\d+)$/;

function safe(...values: number[]): boolean {
  return values.every(Number.isSafeInteger);
}

export function parseNumericAnswer(text: string): ParsedNumericAnswer | undefined {
  if (typeof text !== "string" || text.length > 64) return undefined;
  const written = normalize(text);
  let match = INTEGER.exec(written);
  if (match) {
    const value = Number(match[2]!.replace(/,/g, ""));
    if (!safe(value)) return undefined;
    return { value: match[1] && value !== 0 ? -value : value, form: "integer" };
  }
  match = DECIMAL.exec(written);
  if (match) {
    const value = Number(`${match[2]!.replace(/,/g, "") || "0"}.${match[3]}`);
    if (!Number.isFinite(value)) return undefined;
    return { value: match[1] && value !== 0 ? -value : value, form: "decimal" };
  }
  match = FRACTION.exec(written);
  if (match) {
    const numerator = Number(match[2]), denominator = Number(match[3]);
    if (!safe(numerator, denominator) || denominator === 0) return undefined;
    const value = numerator / denominator;
    return { value: match[1] && value !== 0 ? -value : value, form: "fraction", numerator, denominator };
  }
  match = MIXED.exec(written);
  if (match) {
    const whole = Number(match[2]), numerator = Number(match[3]), denominator = Number(match[4]);
    // A mixed number's fraction part is proper; "2 5/4" is not a way to write 3 1/4.
    if (!safe(whole, numerator, denominator) || denominator === 0
      || numerator === 0 || numerator >= denominator || !safe(whole * denominator + numerator)) return undefined;
    const value = (whole * denominator + numerator) / denominator;
    return { value: match[1] ? -value : value, form: "mixed", numerator, denominator };
  }
  return undefined;
}

function greatestCommonDivisor(left: number, right: number): number {
  while (right) [left, right] = [right, left % right];
  return left;
}

/** A whole number, or a fraction / mixed number whose fraction is in lowest terms. */
export function isSimplestFraction(answer: ParsedNumericAnswer): boolean {
  if (answer.form === "integer") return true;
  if (answer.form === "decimal") return false;
  if (answer.form === "fraction" && answer.denominator === 1) return false;
  return greatestCommonDivisor(answer.numerator!, answer.denominator!) === 1;
}

export function checkNumericAnswer(completion: NumericAnswerCompletion, text: string): NumericAnswerCheck {
  const parsed = parseNumericAnswer(text);
  if (!parsed) return { readable: false };
  const expected = parseNumericAnswer(completion.answer);
  if (!expected) throw new Error("Numeric answer task has an unreadable expected answer");
  const tolerance = completion.tolerance ?? 0;
  if (Math.abs(parsed.value - expected.value) > tolerance) {
    return { readable: true, value: parsed.value, succeeded: false, reason: "value" };
  }
  if (completion.form === "simplest_fraction" && !isSimplestFraction(parsed)) {
    return { readable: true, value: parsed.value, succeeded: false, reason: "form" };
  }
  return { readable: true, value: parsed.value, succeeded: true };
}
