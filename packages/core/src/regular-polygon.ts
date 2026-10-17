/** Radius is the reference circle radius, not the outer polygon circumradius. */
export function regularPolygonGeometry(
  center: { x: number; y: number }, radius: number, sides: number,
  relation: "inscribed" | "circumscribed", rotation = 0,
) {
  if (![center.x, center.y, radius, sides, rotation].every(Number.isFinite)
    || radius <= 0 || sides < 3 || sides > 384
    || !["inscribed", "circumscribed"].includes(relation)) {
    throw new Error("Regular polygon requires a positive radius and 3..384 sides");
  }
  // Animations interpolate numbers continuously; topology is always integral.
  const count = Math.round(sides);
  const halfAngle = Math.PI / count;
  const circumradius = relation === "inscribed" ? radius : radius / Math.cos(halfAngle);
  const vertices = Array.from({ length: count }, (_, index) => {
    const angle = rotation + 2 * Math.PI * index / count;
    return { x: center.x + circumradius * Math.cos(angle), y: center.y + circumradius * Math.sin(angle) };
  });
  const ratio = count * (relation === "inscribed" ? Math.sin(halfAngle) : Math.tan(halfAngle));
  return { sides: count, vertices, perimeter: 2 * radius * ratio, perimeterOverDiameter: ratio };
}
