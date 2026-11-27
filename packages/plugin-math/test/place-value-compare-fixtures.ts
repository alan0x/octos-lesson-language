// Pairs for the place-value compare card's tests (decision 0029): the accepted sketch's list (35P-06 sketch,
// model.mjs PROBLEMS), each shown pair with its practice pair, written as a learner writes them.
import { placeValueCompareParse, type PlaceValueCompareNumber } from "../src/place-value-compare.js";

export interface ComparePairText {
  a: string;
  b: string;
  practice: { a: string; b: string };
  /** One of the widest charts (a layout check in the sketch). */
  widest?: boolean;
}

const P = (a: string, b: string, pa: string, pb: string, extra: { widest?: boolean } = {}): ComparePairText => ({ a, b, practice: { a: pa, b: pb }, ...extra });

export const COMPARE_PROBLEMS: Record<"en" | "zh", ComparePairText[]> = {
  en: [
    P("4530", "4503", "6281", "6218"), // C1: the tens decide
    P("10200", "9876", "100050", "99999"), // C2: different lengths
    P("607198", "607912", "345612", "345216"), // C3: late difference, big digits after it
    P("0.625", "0.7", "0.48", "0.5"), // C4: more digits, smaller
    P("0.45", "0.405", "0.36", "0.306"), // C4: the hundredths decide
    P("2.35", "2.305", "4.07", "4.7"), // C5: points lined up
    P("12.4", "9.87", "10.5", "8.96"), // C5: whole parts decide
    P("0.7", "0.70", "0.40", "0.4"), // C6: equal
    P("1000000", "999999", "2000000", "1999999", { widest: true }),
    P("3456.789", "3456.798", "2345.678", "2345.687", { widest: true }),
  ],
  zh: [
    P("36815", "36851", "52734", "52743"),
    P("120345", "98765", "100200", "99800"),
    P("0.45", "0.405", "0.36", "0.306"),
    P("5.06", "5.6", "7.08", "7.8"),
    P("4.300", "4.3", "2.50", "2.5"),
    P("1000000", "999999", "2000000", "1999999", { widest: true }),
    P("3456.789", "3456.798", "2345.678", "2345.687", { widest: true }),
  ],
};

/** A written number as the card holds it (its value and written decimals); throws when the card cannot read it. */
export function compareNumber(text: string): PlaceValueCompareNumber {
  const parsed = placeValueCompareParse(text);
  if (!parsed || parsed.value === undefined) throw new Error(`not a number the card takes: ${text}`);
  return { value: parsed.value, dec: parsed.dec };
}
