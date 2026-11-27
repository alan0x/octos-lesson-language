// The accepted sketch's picker (handoff runs/early-number/K2N-19/sketch/model.mjs, PROBLEMS and REFUSED): each
// problem with its practice pair (a different pair of the same kind) and its blueprint row (M1-M6).
export interface MakeTenFixture { a: number; b: number; practice: { a: number; b: number }; row: string }
const P = (a: number, b: number, pa: number, pb: number, row: string): MakeTenFixture => ({ a, b, practice: { a: pa, b: pb }, row });

export const MAKE_TEN_PROBLEMS: Record<"en" | "zh", MakeTenFixture[]> = {
  en: [P(8, 6, 7, 5, "M1"), P(9, 5, 9, 7, "M2"), P(3, 8, 4, 9, "M3"), P(6, 5, 5, 7, "M4"), P(7, 7, 6, 6, "M4"), P(9, 9, 8, 8, "M4")],
  zh: [P(8, 5, 9, 6, "M1"), P(9, 4, 9, 8, "M2"), P(4, 9, 3, 8, "M3"), P(7, 6, 6, 5, "M4"), P(7, 7, 8, 8, "M4")],
};

/** Refused by the card: under ten, exactly ten (partners of ten), not one digit. */
export const MAKE_TEN_REFUSED: Array<{ a: number; b: number }> = [{ a: 6, b: 3 }, { a: 7, b: 3 }, { a: 12, b: 5 }];
