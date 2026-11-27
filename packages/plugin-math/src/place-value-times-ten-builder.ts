/**
 * Builds a `place_value_times_ten` card (decision 0028) from neutral input, for Coach's recipe and Studio's tool
 * alike. Every value is an exact integer count of thousandths. The amount, the target, "counted in" and the row
 * sets are a whole number, or a lesson variable's expression with its starting value: the builder writes the
 * starting value into the card and binds it, so a learner's tap, the demonstration or a practice task's start
 * can change it.
 *
 * The card's shape (count or times; toward the right or the left; one or two places apart) is fixed by the
 * starting problem. "Counted in" starts at the problem's start unit: when the caller leaves it out, the builder
 * supplies it (the program's number, never the model's); a put-together question names its own (40 hundredths:
 * 0.01), given as `start`.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { DrivenValue } from "./number-line-builder.js";
import type { PlaceValueLanguage } from "./place-value-chart.js";
import {
  PLACE_VALUE_TIMES_TEN_KIND, placeValueTimesTenFaultText, placeValueTimesTenProblem, placeValueTimesTenRowFields, placeValueTimesTenShapeOf,
  type PlaceValueTimesTenContent, type PlaceValueTimesTenProblem,
} from "./place-value-times-ten.js";

export interface PlaceValueTimesTenInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  /** The card's own words: `zh-CN` for Chinese; leave it out for US English. */
  language?: PlaceValueLanguage;
  /** The amount and the target, in integer thousandths (a times pair may be written either way round). */
  amount: number | DrivenValue;
  target: number | DrivenValue;
  /** The unit the amount starts in (thousandths), when it is not the amount's own place: a put-together question's. */
  start?: number;
  /** The demonstration's "counted in" (thousandths); its starting value is the problem's start unit. */
  counted_in?: number | DrivenValue;
  /** The learner's row sets (0 at a start). */
  moved_once?: number | DrivenValue;
  moved_twice?: number | DrivenValue;
}

export interface BuiltPlaceValueTimesTen {
  actions: AuthoringAction[];
  whole: string;
  parts: Record<string, string>;
  /** The starting problem (its shape, start unit, path and answers come from it). */
  problem: PlaceValueTimesTenProblem;
}

const driven = (value: unknown): value is DrivenValue =>
  typeof value === "object" && value !== null && typeof (value as DrivenValue).expression === "string";

export function buildPlaceValueTimesTen(input: PlaceValueTimesTenInput): BuiltPlaceValueTimesTen {
  const bindings: Array<{ target: string; expression: string }> = [];
  const value = (raw: number | DrivenValue, target: string): number => {
    if (!driven(raw)) return raw;
    bindings.push({ target, expression: raw.expression });
    return raw.initial;
  };
  const amountIn = value(input.amount, "amount");
  const targetIn = value(input.target, "target");
  const found = placeValueTimesTenProblem(amountIn, targetIn, input.start);
  if ("fault" in found) throw new Error(placeValueTimesTenFaultText(found.fault, amountIn, targetIn));
  const problem = found;
  if (problem.amount !== amountIn) {
    // Written smaller first: the larger goes on top, so the two bindings change places too.
    for (const binding of bindings) binding.target = binding.target === "amount" ? "target" : binding.target === "target" ? "amount" : binding.target;
  }
  const shape = placeValueTimesTenShapeOf(problem);
  const countedIn = value(input.counted_in ?? problem.start, "counted_in");
  const rows: Partial<Record<"moved_once" | "moved_twice", number>> = {};
  for (const field of placeValueTimesTenRowFields(problem.g)) rows[field] = value(input[field] ?? 0, field);
  const content: PlaceValueTimesTenContent = {
    ...(input.language !== undefined ? { language: input.language } : {}),
    question: shape.question,
    toward: shape.toward,
    apart: shape.apart,
    amount: problem.amount,
    target: problem.target,
    counted_in: countedIn,
    moved_once: rows.moved_once ?? 0,
    ...(rows.moved_twice !== undefined ? { moved_twice: rows.moved_twice } : {}),
    ...(bindings.length ? { bindings } : {}),
  };
  return {
    actions: [{ do: "write", as: input.as, kind: PLACE_VALUE_TIMES_TEN_KIND, role: input.role, content, place: input.place } as unknown as AuthoringAction],
    whole: input.as,
    parts: { whole: input.as },
    problem,
  };
}
