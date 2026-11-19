/**
 * Builds a `fraction_model` card (decision 0021, amended) from neutral input, for Coach's recipe and
 * Studio's tool alike. A numerator is a whole number, or a lesson variable's expression with its
 * starting value: the builder writes the starting value into the card and binds it, and then the
 * wholes must be given, so the card keeps one size as the numerator moves.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { DrivenValue } from "./number-line-builder.js";
import type { FractionModelContent, FractionModelFraction, FractionModelKind, FractionRelation } from "./fraction-model.js";

export interface FractionModelInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  title?: string;
  caption?: string;
  model: FractionModelKind;
  /** A grid model's rows and columns; its fractions' denominators are rows × columns. */
  grid?: { rows: number; columns: number };
  /** One or two fractions; their names are `a` and `b` unless given. */
  fractions: Array<{
    as?: string;
    numerator: number | DrivenValue;
    denominator: number;
    wholes?: number;
    split?: number;
    highlight?: number;
  }>;
  relation?: FractionRelation;
}

export interface BuiltFractionModel {
  actions: AuthoringAction[];
  whole: string;
  /** Part name to OLL reference: `whole`, each fraction by its name, and `primary_control` when one is bound. */
  parts: Record<string, string>;
}

const driven = (value: unknown): value is DrivenValue =>
  typeof value === "object" && value !== null && typeof (value as DrivenValue).expression === "string";

export function buildFractionModel(input: FractionModelInput): BuiltFractionModel {
  const bindings: Array<{ target: string; expression: string }> = [];
  const names = ["a", "b"];
  const fractions: FractionModelFraction[] = input.fractions.map((fraction, index) => {
    const as = fraction.as ?? names[index]!;
    let numerator: number;
    if (driven(fraction.numerator)) {
      bindings.push({ target: `${as}.numerator`, expression: fraction.numerator.expression });
      numerator = fraction.numerator.initial;
    } else {
      numerator = fraction.numerator;
    }
    return {
      as, numerator, denominator: fraction.denominator,
      ...(fraction.wholes !== undefined ? { wholes: fraction.wholes } : {}),
      ...(fraction.split !== undefined ? { split: fraction.split } : {}),
      ...(fraction.highlight !== undefined ? { highlight: fraction.highlight } : {}),
    };
  });
  const content: FractionModelContent = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    model: input.model,
    ...(input.grid ? { grid: { ...input.grid } } : {}),
    fractions,
    ...(input.relation ? { relation: input.relation } : {}),
    ...(bindings.length ? { bindings } : {}),
  };
  const parts: Record<string, string> = { whole: input.as };
  for (const fraction of fractions) parts[fraction.as] = `${input.as}#${fraction.as}`;
  const bound = fractions.find((fraction) => bindings.some((binding) => binding.target === `${fraction.as}.numerator`));
  if (bound) parts.primary_control = `${input.as}#${bound.as}`;
  return {
    actions: [{ do: "write", as: input.as, kind: "fraction_model", role: input.role, content, place: input.place } as unknown as AuthoringAction],
    whole: input.as,
    parts,
  };
}
