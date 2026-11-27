/**
 * Builds a `make_ten` card (decision 0027) from neutral input, for Coach's recipe and Studio's tool alike. The two
 * addends, the demonstration's count in the bigger addend's frame (`filled`) and the count moved are each a whole
 * number, or a lesson variable's expression with its starting value: the builder writes the starting value into
 * the card and binds it, so a learner's tap, the demonstration or a practice task's start can change it.
 *
 * `filled` starts at the pair's bigger addend (taken from the pair: 8 + 6 starts at 8), never 0; when it is left
 * out the builder writes that value. A driven `filled` must give it as its starting value; the core refuses one
 * that does not.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { DrivenValue } from "./number-line-builder.js";
import { MAKE_TEN_KIND, makeTenFreshCount, type MakeTenContent, type MakeTenLanguage } from "./make-ten.js";

export interface MakeTenInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  /** The card's own words: `zh-CN` for Chinese; leave it out for US English. */
  language?: MakeTenLanguage;
  /** The two addends, 1 to 9, their sum more than ten. */
  a: number | DrivenValue;
  b: number | DrivenValue;
  /** The demonstration: the count in the bigger addend's frame (the bigger addend when left out). */
  filled?: number | DrivenValue;
  /** The learner's taps: the counters moved (0 when left out). */
  moved?: number | DrivenValue;
}

export interface BuiltMakeTen {
  actions: AuthoringAction[];
  whole: string;
  /** Part name to OLL reference: only `whole` (the card has no addressable parts). */
  parts: Record<string, string>;
}

const driven = (value: unknown): value is DrivenValue =>
  typeof value === "object" && value !== null && typeof (value as DrivenValue).expression === "string";

export function buildMakeTen(input: MakeTenInput): BuiltMakeTen {
  const bindings: Array<{ target: string; expression: string }> = [];
  const value = (raw: number | DrivenValue, target: string): number => {
    if (!driven(raw)) return raw;
    bindings.push({ target, expression: raw.expression });
    return raw.initial;
  };
  const a = value(input.a, "a");
  const b = value(input.b, "b");
  const filled = value(input.filled ?? makeTenFreshCount(a, b), "filled");
  const moved = value(input.moved ?? 0, "moved");
  const content: MakeTenContent = {
    ...(input.language !== undefined ? { language: input.language } : {}),
    a,
    b,
    filled,
    moved,
    ...(bindings.length ? { bindings } : {}),
  };
  return {
    actions: [{ do: "write", as: input.as, kind: MAKE_TEN_KIND, role: input.role, content, place: input.place } as unknown as AuthoringAction],
    whole: input.as,
    parts: { whole: input.as },
  };
}
