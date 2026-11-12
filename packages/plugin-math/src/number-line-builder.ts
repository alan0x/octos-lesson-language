/**
 * Builds a `number_line` card (decision 0013) from neutral input, for Coach's
 * recipe and Studio's tool alike. A value is a number, an exact fraction
 * ("3/4"), or a lesson variable's expression with its starting value; the
 * builder writes the starting value into the card and binds it.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { NumberLineContent, NumberLineValue, TickFormat, TickLabels } from "./number-line.js";

/** A value driven by lesson variables: the OLL expression and the value it starts at. */
export interface DrivenValue { expression: string; initial: number }
export type BuilderValue = NumberLineValue | DrivenValue;

export interface NumberLineInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  title?: string;
  caption?: string;
  range: { min: number; max: number };
  ticks?: { step?: number; subdivisions?: number; labels?: TickLabels; format?: TickFormat };
  points?: Array<{
    as: string; value: BuilderValue; label?: string; style?: "closed" | "open"; shown?: "always" | "when_emphasized";
    /** The learner drags the point to set this variable; the point follows it. */
    draggable?: { variable: string };
  }>;
  jumps?: Array<{ as: string; from: string | BuilderValue; by: BuilderValue; label?: string; hops?: boolean }>;
  intervals?: Array<{ as: string; from: BuilderValue | null; to: BuilderValue | null; from_closed?: boolean; to_closed?: boolean; label?: string }>;
}

export interface BuiltNumberLine {
  actions: AuthoringAction[];
  whole: string;
  /** Part name to OLL reference: `whole` and every point, jump and interval by its own name. */
  parts: Record<string, string>;
}

const driven = (value: unknown): value is DrivenValue =>
  typeof value === "object" && value !== null && typeof (value as DrivenValue).expression === "string";

export function buildNumberLine(input: NumberLineInput): BuiltNumberLine {
  const bindings: Array<{ target: string; expression: string }> = [];
  const resolve = (value: BuilderValue, target: string): NumberLineValue => {
    if (!driven(value)) return value;
    bindings.push({ target, expression: value.expression });
    return value.initial;
  };
  const content: NumberLineContent = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    range: { ...input.range },
    ...(input.ticks ? { ticks: { ...input.ticks } } : {}),
  };
  if (input.points?.length) {
    content.points = input.points.map((point) => {
      const value = point.draggable && !driven(point.value)
        ? (bindings.push({ target: `${point.as}.value`, expression: point.draggable.variable }), point.value)
        : resolve(point.value, `${point.as}.value`);
      return {
        as: point.as, value,
        ...(point.label !== undefined ? { label: point.label } : {}),
        ...(point.style ? { style: point.style } : {}),
        ...(point.shown ? { shown: point.shown } : {}),
        ...(point.draggable ? { interaction: { kind: "drag" as const, variable: point.draggable.variable } } : {}),
      };
    });
  }
  if (input.jumps?.length) {
    content.jumps = input.jumps.map((jump) => ({
      as: jump.as,
      from: typeof jump.from === "string" && input.points?.some((point) => point.as === jump.from) ? jump.from : resolve(jump.from as BuilderValue, `${jump.as}.from`),
      by: resolve(jump.by, `${jump.as}.by`),
      ...(jump.label !== undefined ? { label: jump.label } : {}),
      ...(jump.hops !== undefined ? { hops: jump.hops } : {}),
    }));
  }
  if (input.intervals?.length) {
    content.intervals = input.intervals.map((interval) => ({
      as: interval.as,
      from: interval.from === null ? null : resolve(interval.from, `${interval.as}.from`),
      to: interval.to === null ? null : resolve(interval.to, `${interval.as}.to`),
      ...(interval.from_closed !== undefined ? { from_closed: interval.from_closed } : {}),
      ...(interval.to_closed !== undefined ? { to_closed: interval.to_closed } : {}),
      ...(interval.label !== undefined ? { label: interval.label } : {}),
    }));
  }
  if (bindings.length) content.bindings = bindings;
  const parts: Record<string, string> = { whole: input.as };
  for (const part of [...(input.points ?? []), ...(input.jumps ?? []), ...(input.intervals ?? [])]) parts[part.as] = `${input.as}#${part.as}`;
  return {
    actions: [{ do: "write", as: input.as, kind: "number_line", role: input.role, content, place: input.place } as unknown as AuthoringAction],
    whole: input.as,
    parts,
  };
}
