// Problems for the place-value trade card's tests (decision 0026): the accepted sketch's list (sketch v2,
// model.mjs PROBLEMS), each shown problem with its practice pair, written as a learner writes them.

/** A problem as written: the two numbers, the operation, and its practice pair of the same kind. */
export interface TradeProblemText {
  a: string;
  op: "+" | "-";
  b: string;
  practice: { a: string; op: "+" | "-"; b: string };
  /** One of the widest charts (a layout check in the sketch). */
  widest?: boolean;
}

const P = (a: string, op: "+" | "-", b: string, pa: string, pb: string, extra: { widest?: boolean } = {}): TradeProblemText =>
  ({ a, op, b, practice: { a: pa, op, b: pb }, ...extra });

export const TRADE_PROBLEMS: Record<"en" | "zh", TradeProblemText[]> = {
  en: [
    P("3486", "+", "2739", "4658", "1573"),
    P("5960", "+", "2047", "3870", "4136"),
    P("68957", "+", "21068", "57846", "32175"),
    P("7352", "-", "2618", "8461", "3729"),
    P("50003", "-", "2476", "40002", "3585"),
    P("6004", "-", "2756", "7003", "4865"),
    P("2.75", "+", "1.48", "3.86", "2.57"),
    P("5", "-", "1.36", "7", "2.48"),
    P("4999.99", "+", "3999.99", "2999.99", "4999.99", { widest: true }),
    P("9000", "-", "2345.67", "8000", "3456.78", { widest: true }),
    P("389457", "+", "247568", "456789", "278436", { widest: true }),
  ],
  zh: [
    P("4527", "+", "1685", "3648", "2575"),
    P("8452", "-", "3671", "9361", "4582"),
    P("3000", "-", "1468", "5000", "2367"),
    P("3.68", "+", "4.57", "4.86", "2.38"),
    P("8.2", "-", "3.75", "9.3", "4.68"),
    P("4999.99", "+", "3999.99", "2999.99", "4999.99", { widest: true }),
    P("9000", "-", "2345.67", "8000", "3456.78", { widest: true }),
    P("389457", "+", "247568", "456789", "278436", { widest: true }),
  ],
};

export const tradeProblemKey = (p: { a: string; op: string; b: string }): string => `${p.a}${p.op}${p.b}`;
