// Problems for the place-value times-ten card's tests (decision 0028): the accepted sketch's list (35P-04 sketch,
// model.mjs PROBLEMS), each shown problem with its practice of the same shape, written as a learner writes them.
// The start is given only where the question names a unit the amount is not in (a put-together question).

export interface TimesTenProblemText {
  amount: string;
  target: string;
  start?: string;
  practice: { amount: string; target: string };
  /** One of the largest charts (a layout check in the sketch). */
  widest?: boolean;
}

const P = (amount: string, target: string, start: string | undefined, practice: { amount: string; target: string }, extra: { widest?: boolean } = {}): TimesTenProblemText =>
  ({ amount, target, ...(start !== undefined ? { start } : {}), practice, ...extra });

export const TIMES_TEN_PROBLEMS: Record<"en" | "zh", TimesTenProblemText[]> = {
  en: [
    P("0.3", "0.001", undefined, { amount: "5", target: "0.01" }),
    P("700", "70", undefined, { amount: "4000", target: "400" }),
    P("1000", "10", undefined, { amount: "300", target: "1" }),
    P("6000", "100", undefined, { amount: "0.8", target: "0.01" }),
    P("300", "100", "10", { amount: "0.04", target: "0.01" }),
    P("0.5", "0.1", "0.001", { amount: "700", target: "100" }),
    P("3", "0.3", undefined, { amount: "0.6", target: "0.06" }),
    P("9", "0.01", undefined, { amount: "9000", target: "10" }, { widest: true }),
    P("9000", "900", undefined, { amount: "0.09", target: "0.009" }, { widest: true }),
    P("9000000", "900000", undefined, { amount: "90", target: "9" }, { widest: true }),
  ],
  zh: [
    P("0.3", "0.001", undefined, { amount: "6", target: "0.01" }),
    P("500", "50", undefined, { amount: "0.7", target: "0.07" }),
    P("10000", "100", undefined, { amount: "2000", target: "10" }),
    P("2000", "1000", "100", { amount: "0.06", target: "0.01" }),
    P("0.8", "0.1", "0.001", { amount: "300", target: "100" }),
    P("0.4", "0.04", undefined, { amount: "2", target: "0.2" }),
    P("9", "0.01", undefined, { amount: "9000", target: "10" }, { widest: true }),
    P("9000", "900", undefined, { amount: "0.09", target: "0.009" }, { widest: true }),
    P("9000000", "900000", undefined, { amount: "90", target: "9" }, { widest: true }),
  ],
};

/** The development cases' served expectations (35P-04 dev-cases.json, PF-01 to PF-15): amount, start, target, answers. */
export const TIMES_TEN_DEV_CASES: Array<{ id: string; ask: "count" | "times"; amount: string; start?: string; target: string; result: string; renamed?: string }> = [
  { id: "PF-01", ask: "count", amount: "1000", start: "1000", target: "10", result: "100" },
  { id: "PF-02", ask: "count", amount: "400", start: "100", target: "1", result: "400" },
  { id: "PF-03", ask: "count", amount: "6000", start: "1000", target: "100", result: "60" },
  { id: "PF-04", ask: "count", amount: "300", start: "10", target: "100", result: "3" },
  { id: "PF-05", ask: "count", amount: "0.4", start: "0.01", target: "0.1", result: "4" },
  { id: "PF-06", ask: "count", amount: "0.5", start: "0.001", target: "0.1", result: "5" },
  { id: "PF-07", ask: "times", amount: "700", target: "70", result: "10", renamed: "70" },
  { id: "PF-08", ask: "times", amount: "8000", target: "800", result: "10", renamed: "80" },
  { id: "PF-09", ask: "times", amount: "300", target: "30", result: "10", renamed: "30" },
  { id: "PF-10", ask: "times", amount: "60000", target: "6000", result: "10", renamed: "60" },
  { id: "PF-11", ask: "count", amount: "0.7", start: "0.1", target: "0.01", result: "70" },
  { id: "PF-12", ask: "count", amount: "0.2", start: "0.1", target: "0.001", result: "200" },
  { id: "PF-13", ask: "count", amount: "0.6", start: "0.1", target: "0.001", result: "600" },
  { id: "PF-14", ask: "times", amount: "3", target: "0.3", result: "10", renamed: "30" },
  { id: "PF-15", ask: "times", amount: "0.4", target: "0.04", result: "10", renamed: "40" },
];
