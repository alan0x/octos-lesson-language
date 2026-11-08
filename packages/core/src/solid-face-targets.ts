/** The selectable surfaces of a solid, independent of its view and folding state. */
export function solidFaceKeys(object: Record<string, unknown>): string[] {
  const numbered = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
  switch (object.kind) {
    case "box": return ["bottom", "top", ...numbered("side", 4)];
    case "prism":
    case "pyramid": {
      const sides = Array.isArray(object.base) ? object.base.length : Number(object.sides);
      if (!Number.isInteger(sides) || sides < 3 || sides > 12) return [];
      return ["bottom", ...numbered("side", sides),
        ...(object.kind === "prism" || Number(object.top_scale) > 0 ? ["top"] : [])];
    }
    case "cylinder": case "frustum": return ["bottom", "top", "side"];
    case "cone": case "hemisphere": return ["bottom", "side"];
    case "sphere": case "ellipsoid": case "torus": return ["side"];
    case "tetrahedron": return numbered("face", 4);
    case "octahedron": return numbered("face", 8);
    case "dodecahedron": return numbered("face", 12);
    case "icosahedron": return numbered("face", 20);
    default: return [];
  }
}

/** The same suffix is used for authoring aliases and canonical fragment IDs. */
export function solidFaceTarget(objectId: string, face: string): string {
  return `${objectId}-${face}-face`;
}
