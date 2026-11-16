/**
 * The checks of a number-line form, where a person (Studio) types a range, ticks, a start and up to three
 * moves (OLL decision 0017, Studio section). Each move starts where the one before it lands. The result is
 * a code and the move it is about, never wording: the form says it in its own language.
 */
import { NUMBER_LINE_LIMITS, numberLineValue } from "./number-line.js";

/** What a form offers: a span of at most 40 units, each split into as many parts as OLL draws, and up to three moves. */
export const NUMBER_LINE_FORM_LIMITS = { span: 40, subdivisions: NUMBER_LINE_LIMITS.subdivisions, moves: 3 } as const;

export interface NumberLineFormMove {
  /** The change, as typed: "5", "−5", "1/4". With a slider, its starting value. */
  by: string;
  /** Hop by hop, one hop per tick. */
  hops?: boolean;
  /** The learner drags this move; only the last move may have one, so the earlier landings stay put. */
  slider?: boolean;
}

export interface NumberLineFormInput {
  range: readonly [number, number];
  subdivisions: number;
  start?: string;
  moves?: readonly NumberLineFormMove[];
}

export type NumberLineFormProblemCode =
  | "range" | "subdivisions" | "ticks" | "start" | "start_missing" | "too_many_moves"
  | "move_value" | "move_outside" | "slider_not_last" | "hops_turn_back" | "hops";

export interface NumberLineFormProblem { code: NumberLineFormProblemCode; /** 1-based, for a move's problem. */ move?: number }

/** A typed value: a plain number ("3", "−5", "0.5") as a number; a fraction ("3/4", "1 1/2") as an exact string. */
export function numberLineFormValue(text: string): number | string | undefined {
  const typed = text.trim().replace(/−/gu, "-");
  if (/^-?\d+(?:\.\d+)?$/u.test(typed)) return Number(typed);
  return numberLineValue(typed) === undefined ? undefined : typed;
}

const asNumber = (text: string) => { const value = numberLineFormValue(text); return value === undefined ? undefined : numberLineValue(value); };

/** The first problem of a form, or undefined when the builder can draw it. */
export function numberLineFormProblem(form: NumberLineFormInput): NumberLineFormProblem | undefined {
  const [min, max] = form.range;
  if (!Number.isInteger(min) || !Number.isInteger(max) || !(min < max) || max - min > NUMBER_LINE_FORM_LIMITS.span) return { code: "range" };
  if (!Number.isInteger(form.subdivisions) || form.subdivisions < 1 || form.subdivisions > NUMBER_LINE_FORM_LIMITS.subdivisions) return { code: "subdivisions" };
  if ((max - min) * form.subdivisions > NUMBER_LINE_LIMITS.ticks) return { code: "ticks" };
  const start = form.start === undefined ? undefined : asNumber(form.start);
  if (form.start !== undefined && (start === undefined || start < min || start > max)) return { code: "start" };
  const moves = form.moves ?? [];
  if (!moves.length) return undefined;
  if (start === undefined) return { code: "start_missing" };
  if (moves.length > NUMBER_LINE_FORM_LIMITS.moves) return { code: "too_many_moves" };
  const unit = 1 / form.subdivisions;
  const whole = (value: number) => Math.abs(value / unit - Math.round(value / unit)) <= 1e-9;
  const changes: number[] = [];
  let at = start;
  for (const [index, move] of moves.entries()) {
    const number = index + 1;
    if (move.slider && index !== moves.length - 1) return { code: "slider_not_last", move: number };
    const by = asNumber(move.by);
    if (by === undefined || by === 0) return { code: "move_value", move: number };
    // The builder's validator allows 1e-9 at the ends; so does the form (0.1 + 2.7 + 0.2 ends at 3).
    if (at + by < min - 1e-9 || at + by > max + 1e-9) return { code: "move_outside", move: number };
    changes.push(by);
    // A slider lets the move reach either end of the line from where it starts; hop by hop, that must stay
    // within the hop limit, and every value it reaches is whole parts only if it starts on a tick.
    const longest = move.slider ? Math.max(at - min, max - at) : Math.abs(by);
    if (move.hops && (!whole(by) || (move.slider && !whole(at)) || Math.ceil(longest / unit - 1e-9) > NUMBER_LINE_LIMITS.hops)) return { code: "hops", move: number };
    at = Number((at + by).toPrecision(12));
  }
  // A move that turns back is drawn raised as one arc, never hop by hop (OLL #61), and a slider can turn
  // either way: hops only when every move goes the same way and none has a slider beside another move.
  const oneWay = changes.every((change) => change > 0) || changes.every((change) => change < 0);
  if (moves.some((move) => move.hops) && moves.length > 1 && (!oneWay || moves.some((move) => move.slider))) {
    // Name the move that turns back (or the slider), the one the person must change.
    const turning = changes.findIndex((change) => Math.sign(change) !== Math.sign(changes[0]!));
    const slider = moves.findIndex((move) => move.slider);
    return { code: "hops_turn_back", move: (turning >= 0 ? turning : slider) + 1 };
  }
  return undefined;
}
