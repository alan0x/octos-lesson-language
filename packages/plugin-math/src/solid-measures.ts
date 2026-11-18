/**
 * A solid's volume, surface area and face, edge and vertex counts, computed
 * from its shape and sizes (decision 0019 §2), and the line that shows them
 * under the scene. The model names which quantities to show; it never writes
 * their values.
 */
import { centredBaseCorners, type CompositeSolid, type Solid } from "./solids.js";

export type SolidMeasureKind = "volume" | "surface_area" | "counts";

/** A quantity as a number, or as a multiple of π (the coefficient), so it can be written exactly. */
export interface SolidQuantity { value: number; pi?: number }

export interface SolidMeasures {
  volume?: SolidQuantity;
  surfaceArea?: SolidQuantity;
  counts?: { faces: number; edges: number; vertices: number };
}

const plain = (value: number): SolidQuantity => ({ value });
const ofPi = (coefficient: number): SolidQuantity => ({ value: coefficient * Math.PI, pi: coefficient });

/** A polygon's area (positive) and perimeter. */
function polygonAreaPerimeter(corners: Array<{ x: number; y: number }>): { area: number; perimeter: number } {
  let twice = 0, perimeter = 0;
  corners.forEach((point, index) => {
    const next = corners[(index + 1) % corners.length]!;
    twice += point.x * next.y - next.x * point.y;
    perimeter += Math.hypot(next.x - point.x, next.y - point.y);
  });
  return { area: Math.abs(twice) / 2, perimeter };
}

/**
 * A pyramid's side faces (topScale 0) or a truncated pyramid's: each a
 * trapezoid between a base edge and its copy scaled by k about the centroid at
 * height h. Its slant height rises h while moving in by (1 − k) times the
 * edge's distance from the centroid.
 */
function slantedSides(corners: Array<{ x: number; y: number }>, height: number, k: number): number {
  let total = 0;
  corners.forEach((point, index) => {
    const next = corners[(index + 1) % corners.length]!;
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    const distance = Math.abs(point.x * next.y - next.x * point.y) / length;
    total += length * (1 + k) / 2 * Math.hypot(height, (1 - k) * distance);
  });
  return total;
}

function compositeVolume(solid: CompositeSolid): SolidQuantity {
  switch (solid.parts) {
    case "cylinder_cone": return ofPi(solid.radius ** 2 * (solid.height + solid.topHeight / 3));
    case "cylinder_hemisphere": return ofPi(solid.radius ** 2 * solid.height + 2 / 3 * solid.radius ** 3);
    case "two_cylinders": return ofPi(solid.radius ** 2 * solid.height + solid.topRadius ** 2 * solid.topHeight);
    case "box_pyramid": return plain(solid.width ** 2 * (solid.height + solid.topHeight / 3));
    case "two_boxes": return plain(solid.size.x * solid.size.y * solid.size.z + solid.sideSize.x * solid.sideSize.y * solid.sideSize.z);
  }
}

/**
 * The quantities a solid has a formula for. Volume and surface area for the
 * shapes AI lessons offer (a composite's surface area is left out, since the
 * joined faces would have to come off); counts only for polyhedra (box, prism,
 * pyramid). A shape outside those gets nothing.
 */
export function solidMeasures(solid: Solid): SolidMeasures {
  switch (solid.shape) {
    case "box": {
      const { x, y, z } = solid.size;
      return { volume: plain(x * y * z), surfaceArea: plain(2 * (x * y + y * z + x * z)), counts: { faces: 6, edges: 12, vertices: 8 } };
    }
    case "cylinder": return { volume: ofPi(solid.radius ** 2 * solid.height), surfaceArea: ofPi(2 * solid.radius * (solid.radius + solid.height)) };
    case "cone": return { volume: ofPi(solid.radius ** 2 * solid.height / 3), surfaceArea: ofPi(solid.radius * (solid.radius + Math.hypot(solid.radius, solid.height))) };
    case "sphere": return { volume: ofPi(4 / 3 * solid.radius ** 3), surfaceArea: ofPi(4 * solid.radius ** 2) };
    // The whole surface: the curved half and the flat disc.
    case "hemisphere": return { volume: ofPi(2 / 3 * solid.radius ** 3), surfaceArea: ofPi(3 * solid.radius ** 2) };
    case "frustum": {
      const { radius: r1, topRadius: r2, height: h } = solid;
      return { volume: ofPi(h * (r1 * r1 + r1 * r2 + r2 * r2) / 3), surfaceArea: ofPi(r1 * r1 + r2 * r2 + (r1 + r2) * Math.hypot(h, r1 - r2)) };
    }
    case "prism": case "pyramid": {
      const corners = centredBaseCorners(solid);
      const { area, perimeter } = polygonAreaPerimeter(corners);
      const n = corners.length;
      if (solid.shape === "prism") {
        return { volume: plain(area * solid.height), surfaceArea: plain(2 * area + perimeter * solid.height), counts: { faces: n + 2, edges: 3 * n, vertices: 2 * n } };
      }
      const k = solid.topScale ?? 0;
      const sides = slantedSides(corners, solid.height, k);
      return {
        volume: plain(solid.height * area * (1 + k + k * k) / 3),
        surfaceArea: plain(area * (1 + k * k) + sides),
        counts: k > 0 ? { faces: n + 2, edges: 3 * n, vertices: 2 * n } : { faces: n + 1, edges: 2 * n, vertices: n + 1 },
      };
    }
    case "composite": return { volume: compositeVolume(solid) };
    default: return {};
  }
}

/** Whether a solid has this quantity (see `solidMeasures`). */
export function solidHasMeasure(solid: Solid, kind: SolidMeasureKind): boolean {
  const measures = solidMeasures(solid);
  return kind === "volume" ? measures.volume !== undefined : kind === "surface_area" ? measures.surfaceArea !== undefined : measures.counts !== undefined;
}

/** Whether `value` is a whole number up to floating-point noise. */
// Floating-point noise only (a few units in the last place): a relative 1e-9 grew with the scaled value and
// passed a rounded volume as exact (123.45³ = 1881365.963625 shown as "= 1881365.964", owner review of #73).
const whole = (value: number) => Math.abs(value - Math.round(value)) <= 64 * Number.EPSILON * Math.max(1, Math.abs(value));

/**
 * Beyond this many units of the last place written, a double carries too few digits to tell a value that
 * really ends there from one rounded there (12345.67³ shown as "= 1881672302290.56", owner review of #73).
 */
const EXACT_LIMIT = 1e12;

/**
 * Whether `scaled` (a value times 10^places) is a whole number that really is the value: within the digits a
 * double can tell apart, and never a zero standing for a positive value (0.00001³ shown as "= 0").
 */
const exactAt = (value: number, scaled: number) => Math.abs(scaled) < EXACT_LIMIT && whole(scaled) && (Math.round(scaled) !== 0 || value === 0);

/** A number written with at most three decimal places, when that is exact. */
function exactDecimal(value: number): string | undefined {
  for (let places = 0; places <= 3; places += 1) {
    const scaled = value * 10 ** places;
    if (exactAt(value, scaled)) return (Math.round(scaled) / 10 ** places).toFixed(places);
  }
  return undefined;
}

/** Two decimal places, or three significant digits for a value too small to show in two (never "≈ 0.00"). */
const approximate = (value: number) => (value !== 0 && Math.abs(value) < 0.005 ? value.toPrecision(3) : (Math.round(value * 100) / 100).toFixed(2));

/** A multiple of π written exactly: 12π, 4.5π, 16π/3, π/3; undefined when the coefficient is not a simple fraction. */
function piText(coefficient: number): string | undefined {
  const decimal = exactDecimal(coefficient);
  if (decimal !== undefined) return decimal === "1" ? "π" : `${decimal}π`;
  for (let denominator = 2; denominator <= 12; denominator += 1) {
    if (exactAt(coefficient, coefficient * denominator)) {
      const numerator = Math.round(coefficient * denominator);
      return `${numerator === 1 ? "" : numerator}π/${denominator}`;
    }
  }
  return undefined;
}

/** A quantity as "= 24", "= 12π ≈ 37.70" or "≈ 75.40". */
export function quantityText(quantity: SolidQuantity): string {
  if (quantity.pi !== undefined) {
    const exact = piText(quantity.pi);
    return exact !== undefined ? `= ${exact} ≈ ${approximate(quantity.value)}` : `≈ ${approximate(quantity.value)}`;
  }
  const exact = exactDecimal(quantity.value);
  return exact !== undefined ? `= ${exact}` : `≈ ${approximate(quantity.value)}`;
}

/**
 * The measures line for one solid, in Chinese or English, in the order asked.
 * Throws when the solid has no formula for an asked quantity, so the caller
 * decides (drop it or refuse) instead of a silent gap.
 */
export function solidMeasuresText(solid: Solid, show: readonly SolidMeasureKind[], language: string): string {
  const zh = language.toLowerCase().startsWith("zh");
  const measures = solidMeasures(solid);
  const parts = [...new Set(show)].map((kind) => {
    if (kind === "volume") {
      if (!measures.volume) throw new Error(`A ${solid.shape} has no volume formula here`);
      return `${zh ? "体积" : "Volume"} ${quantityText(measures.volume)}`;
    }
    if (kind === "surface_area") {
      if (!measures.surfaceArea) throw new Error(`A ${solid.shape} has no surface area formula here`);
      return `${zh ? "表面积" : "Surface area"} ${quantityText(measures.surfaceArea)}`;
    }
    if (!measures.counts) throw new Error(`A ${solid.shape} has no face, edge and vertex counts here`);
    const { faces, edges, vertices } = measures.counts;
    return zh ? `${faces} 个面，${edges} 条棱，${vertices} 个顶点` : `${faces} faces, ${edges} edges, ${vertices} vertices`;
  });
  return parts.join(zh ? "；" : "; ");
}
