/**
 * Inline math in learner-facing text: `$…$`, `$$…$$` or `\(…\)`. An escaped `\$`, an unpaired `$` and
 * prices stay text (as in Pandoc, a closing `$` follows a non-space and is not followed by a digit).
 * One rule for every place lesson text is drawn or shortened: board cards, host cards, outline titles.
 */
export interface InlineTextSegment {
  kind: "text" | "math";
  value: string;
}

function isEscaped(value: string, cursor: number): boolean {
  let escapes = 0;
  for (let prior = cursor - 1; prior >= 0 && value[prior] === "\\"; prior -= 1) escapes += 1;
  return escapes % 2 !== 0;
}

function closingDollar(value: string, start: number, delimiter: "$" | "$$"): number {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (!value.startsWith(delimiter, cursor) || isEscaped(value, cursor)) continue;
    if (delimiter === "$" && value[cursor + 1] === "$") continue;
    // A closing single dollar follows a non-space and is not followed by a digit (as in Pandoc), so
    // "costs $5 and $10" stays text: prices are common in word problems.
    if (delimiter === "$" && (/\s/u.test(value[cursor - 1] ?? " ") || /[0-9]/u.test(value[cursor + 1] ?? ""))) continue;
    if (delimiter === "$$" && value[cursor + 2] === "$") continue;
    return cursor;
  }
  return -1;
}

export function inlineMathSegments(value: string): InlineTextSegment[] {
  const segments: InlineTextSegment[] = [];
  let textStart = 0;
  let cursor = 0;
  const appendMath = (start: number, end: number, delimiterLength: number): boolean => {
    const source = value.slice(start + delimiterLength, end).trim();
    if (!source) return false;
    if (start > textStart) segments.push({ kind: "text", value: value.slice(textStart, start) });
    segments.push({ kind: "math", value: source });
    cursor = end + delimiterLength;
    textStart = cursor;
    return true;
  };

  while (cursor < value.length) {
    if (value.startsWith("$$", cursor) && !isEscaped(value, cursor)) {
      const end = closingDollar(value, cursor + 2, "$$");
      if (end >= 0 && appendMath(cursor, end, 2)) continue;
    } else if (value.startsWith("\\(", cursor) && !isEscaped(value, cursor)) {
      const end = value.indexOf("\\)", cursor + 2);
      if (end >= 0 && appendMath(cursor, end, 2)) continue;
    } else if (value[cursor] === "$" && value[cursor + 1] !== "$" && !/\s/u.test(value[cursor + 1] ?? " ") && !isEscaped(value, cursor)) {
      const end = closingDollar(value, cursor + 1, "$");
      if (end >= 0 && appendMath(cursor, end, 1)) continue;
    }
    cursor += 1;
  }
  if (textStart < value.length) segments.push({ kind: "text", value: value.slice(textStart) });
  return segments.length ? segments : [{ kind: "text", value }];
}
