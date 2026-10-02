export interface InkPathPoint {
  x: number;
  y: number;
}

const coordinate = (value: number): string => value.toFixed(3);

/**
 * SVG path data for one native-ink stroke, smoothed with quadratic curves
 * through the midpoints of consecutive samples.
 *
 * The Android overlay (NativeInkOverlayView.StrokePath) builds the same curve
 * live: a line to the first midpoint, one quadratic per later sample, and a
 * straight tail to the newest sample. Keep the two in step, or the stroke
 * visibly shifts when the committed SVG replaces the native preview.
 */
export function smoothedInkPathData(points: readonly InkPathPoint[]): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) {
    return `M${coordinate(first.x)} ${coordinate(first.y)} `
      + `L${coordinate(first.x + .01)} ${coordinate(first.y)}`;
  }
  const commands = [`M${coordinate(first.x)} ${coordinate(first.y)}`];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const midX = (previous.x + current.x) / 2;
    const midY = (previous.y + current.y) / 2;
    commands.push(index === 1
      ? `L${coordinate(midX)} ${coordinate(midY)}`
      : `Q${coordinate(previous.x)} ${coordinate(previous.y)} `
        + `${coordinate(midX)} ${coordinate(midY)}`);
  }
  const last = points.at(-1)!;
  commands.push(`L${coordinate(last.x)} ${coordinate(last.y)}`);
  return commands.join(" ");
}
