/**
 * A solid's volume, surface area and face, edge and vertex counts, computed
 * from its shape and sizes (decision 0019 §2), and the line that shows them
 * under the scene. The model names which quantities to show; it never writes
 * their values.
 */
import { centredBaseCorners, type CompositeSolid, type Solid } from "./solids.js";

export type SolidMeasureKind = "volume" | "surface_area" | "counts";

// ---- Exact arithmetic on the sizes as written ---------------------------------------------------------
// Whether a measure can be written exactly is decided on exact fractions built from the sizes' decimal
// digits, never on floating-point tolerance (owner review of #73: every tolerance either called a rounded
// value exact, 1345.87³ shown as "= 2437863235", or a positive value zero).

/** An exact fraction n/d (d > 0, lowest terms). */
export interface Fraction { n: bigint; d: bigint }

const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const fraction = (n: bigint, d: bigint = 1n): Fraction => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Fraction, b: Fraction) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (...factors: Fraction[]) => factors.reduce((a, b) => fraction(a.n * b.n, a.d * b.d), fraction(1n));
const ratio = (n: number, d: number) => fraction(BigInt(n), BigInt(d));

/** A size's exact value from its shortest decimal form ("12.5", "1e-7"); undefined if it has none. */
export function exactNumber(value: number): Fraction | undefined {
  if (!Number.isFinite(value)) return undefined;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/u.exec(String(value));
  if (!match) return undefined;
  const digits = BigInt(`${match[2]}${match[3] ?? ""}`) * (match[1] ? -1n : 1n);
  const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  return exponent >= 0 ? fraction(digits * 10n ** BigInt(exponent)) : fraction(digits, 10n ** BigInt(-exponent));
}

/**
 * ⌊√value⌋ by integer Newton iteration, all in BigInt. The seed 2^⌈bits/2⌉ is at least the root, and each
 * step then decreases until it stops, in about log₂(bits) steps. (A seed through Number lost precision past
 * 2^53 and the old one-by-one correction could take trillions of steps on a decimal cone's slant: review of #73.)
 */
export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError("integerSqrt of a negative number");
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (x + value / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}
/** A square root that is itself a fraction (5 for 25, 1.5 for 2.25); undefined when it is irrational. */
const root = (value: Fraction): Fraction | undefined => {
  if (value.n < 0n) return undefined;
  const [n, d] = [integerSqrt(value.n), integerSqrt(value.d)];
  return n * n === value.n && d * d === value.d ? fraction(n, d) : undefined;
};
/** All parts exact, or undefined: one irrational or unreadable size makes the whole measure inexact. */
const all = <T>(values: Array<T | undefined>): T[] | undefined => (values.some((value) => value === undefined) ? undefined : values as T[]);

/** A quantity: its value, its multiple of π when it is one, and its exact value (or π coefficient) when known. */
export interface SolidQuantity { value: number; pi?: number; exact?: Fraction }

export interface SolidMeasures {
  volume?: SolidQuantity;
  surfaceArea?: SolidQuantity;
  counts?: { faces: number; edges: number; vertices: number };
}

const plain = (value: number, exact?: Fraction): SolidQuantity => ({ value, ...(exact ? { exact } : {}) });
const ofPi = (coefficient: number, exact?: Fraction): SolidQuantity => ({ value: coefficient * Math.PI, pi: coefficient, ...(exact ? { exact } : {}) });

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

/**
 * A base's exact area, perimeter and edges (each with its distance from the centroid), when they are
 * fractions: a rectangle; a right triangle whose hypotenuse is a fraction (volumes need only the area);
 * a square given by its edge. Other bases are irrational (a regular hexagon's area has √3), or are not
 * worked out here (a triangle by three sides), and stay approximate.
 */
function exactBase(solid: Extract<Solid, { shape: "prism" | "pyramid" }>): { area?: Fraction; perimeter?: Fraction; edges?: Array<{ length: Fraction; distance: Fraction }> } {
  if ("base" in solid) {
    const base = solid.base;
    if (base.kind === "rectangle") {
      const [l, w] = all([exactNumber(base.length), exactNumber(base.width)]) ?? [];
      if (!l || !w) return {};
      const half = (value: Fraction) => mul(value, ratio(1, 2));
      return { area: mul(l, w), perimeter: mul(ratio(2, 1), add(l, w)), edges: [{ length: l, distance: half(w) }, { length: w, distance: half(l) }, { length: l, distance: half(w) }, { length: w, distance: half(l) }] };
    }
    if (base.kind === "right_triangle") {
      const [a, b] = all([exactNumber(base.a), exactNumber(base.b)]) ?? [];
      if (!a || !b) return {};
      const hypotenuse = root(add(mul(a, a), mul(b, b)));
      return { area: mul(a, b, ratio(1, 2)), ...(hypotenuse ? { perimeter: add(add(a, b), hypotenuse) } : {}) };
    }
    return {};
  }
  if (solid.sides === 4 && "side" in solid) {
    const s = exactNumber(solid.side);
    if (!s) return {};
    const edge = { length: s, distance: mul(s, ratio(1, 2)) };
    return { area: mul(s, s), perimeter: mul(ratio(4, 1), s), edges: [edge, edge, edge, edge] };
  }
  return {};
}

function compositeVolume(solid: CompositeSolid): SolidQuantity {
  const third = ratio(1, 3);
  switch (solid.parts) {
    case "cylinder_cone": {
      const [r, h, t] = all([exactNumber(solid.radius), exactNumber(solid.height), exactNumber(solid.topHeight)]) ?? [];
      return ofPi(solid.radius ** 2 * (solid.height + solid.topHeight / 3), r && h && t ? mul(r, r, add(h, mul(t, third))) : undefined);
    }
    case "cylinder_hemisphere": {
      const [r, h] = all([exactNumber(solid.radius), exactNumber(solid.height)]) ?? [];
      return ofPi(solid.radius ** 2 * solid.height + 2 / 3 * solid.radius ** 3, r && h ? add(mul(r, r, h), mul(ratio(2, 3), r, r, r)) : undefined);
    }
    case "two_cylinders": {
      const [r, h, R, H] = all([exactNumber(solid.radius), exactNumber(solid.height), exactNumber(solid.topRadius), exactNumber(solid.topHeight)]) ?? [];
      return ofPi(solid.radius ** 2 * solid.height + solid.topRadius ** 2 * solid.topHeight, r && h && R && H ? add(mul(r, r, h), mul(R, R, H)) : undefined);
    }
    case "box_pyramid": {
      const [w, h, t] = all([exactNumber(solid.width), exactNumber(solid.height), exactNumber(solid.topHeight)]) ?? [];
      return plain(solid.width ** 2 * (solid.height + solid.topHeight / 3), w && h && t ? mul(w, w, add(h, mul(t, third))) : undefined);
    }
    case "two_boxes": {
      const sizes = all([solid.size.x, solid.size.y, solid.size.z, solid.sideSize.x, solid.sideSize.y, solid.sideSize.z].map(exactNumber));
      const value = solid.size.x * solid.size.y * solid.size.z + solid.sideSize.x * solid.sideSize.y * solid.sideSize.z;
      return plain(value, sizes ? add(mul(sizes[0]!, sizes[1]!, sizes[2]!), mul(sizes[3]!, sizes[4]!, sizes[5]!)) : undefined);
    }
  }
}

/**
 * The quantities a solid has a formula for. Volume and surface area for the
 * shapes AI lessons offer (a composite's surface area is left out, since the
 * joined faces would have to come off); counts only for polyhedra (box, prism,
 * pyramid). A shape outside those gets nothing. Each quantity carries its exact
 * value when the sizes make it a fraction (or a fraction of π).
 */
export function solidMeasures(solid: Solid): SolidMeasures {
  switch (solid.shape) {
    case "box": {
      const { x, y, z } = solid.size;
      const [a, b, c] = all([exactNumber(x), exactNumber(y), exactNumber(z)]) ?? [];
      return {
        volume: plain(x * y * z, a && b && c ? mul(a, b, c) : undefined),
        surfaceArea: plain(2 * (x * y + y * z + x * z), a && b && c ? mul(ratio(2, 1), add(add(mul(a, b), mul(b, c)), mul(a, c))) : undefined),
        counts: { faces: 6, edges: 12, vertices: 8 },
      };
    }
    case "cylinder": {
      const [r, h] = all([exactNumber(solid.radius), exactNumber(solid.height)]) ?? [];
      return { volume: ofPi(solid.radius ** 2 * solid.height, r && h ? mul(r, r, h) : undefined), surfaceArea: ofPi(2 * solid.radius * (solid.radius + solid.height), r && h ? mul(ratio(2, 1), r, add(r, h)) : undefined) };
    }
    case "cone": {
      const [r, h] = all([exactNumber(solid.radius), exactNumber(solid.height)]) ?? [];
      const slant = r && h ? root(add(mul(r, r), mul(h, h))) : undefined;
      return {
        volume: ofPi(solid.radius ** 2 * solid.height / 3, r && h ? mul(r, r, h, ratio(1, 3)) : undefined),
        surfaceArea: ofPi(solid.radius * (solid.radius + Math.hypot(solid.radius, solid.height)), r && slant ? mul(r, add(r, slant)) : undefined),
      };
    }
    case "sphere": {
      const r = exactNumber(solid.radius);
      return { volume: ofPi(4 / 3 * solid.radius ** 3, r ? mul(ratio(4, 3), r, r, r) : undefined), surfaceArea: ofPi(4 * solid.radius ** 2, r ? mul(ratio(4, 1), r, r) : undefined) };
    }
    // The whole surface: the curved half and the flat disc.
    case "hemisphere": {
      const r = exactNumber(solid.radius);
      return { volume: ofPi(2 / 3 * solid.radius ** 3, r ? mul(ratio(2, 3), r, r, r) : undefined), surfaceArea: ofPi(3 * solid.radius ** 2, r ? mul(ratio(3, 1), r, r) : undefined) };
    }
    case "frustum": {
      const { radius: r1, topRadius: r2, height: h } = solid;
      const [a, b, c] = all([exactNumber(r1), exactNumber(r2), exactNumber(h)]) ?? [];
      const slant = a && b && c ? root(add(mul(c, c), mul(sub(a, b), sub(a, b)))) : undefined;
      return {
        volume: ofPi(h * (r1 * r1 + r1 * r2 + r2 * r2) / 3, a && b && c ? mul(c, add(add(mul(a, a), mul(a, b)), mul(b, b)), ratio(1, 3)) : undefined),
        surfaceArea: ofPi(r1 * r1 + r2 * r2 + (r1 + r2) * Math.hypot(h, r1 - r2), a && b && slant ? add(add(mul(a, a), mul(b, b)), mul(add(a, b), slant)) : undefined),
      };
    }
    case "prism": case "pyramid": {
      const corners = centredBaseCorners(solid);
      const { area, perimeter } = polygonAreaPerimeter(corners);
      const n = corners.length;
      const exact = exactBase(solid);
      const h = exactNumber(solid.height);
      if (solid.shape === "prism") {
        return {
          volume: plain(area * solid.height, exact.area && h ? mul(exact.area, h) : undefined),
          surfaceArea: plain(2 * area + perimeter * solid.height, exact.area && exact.perimeter && h ? add(mul(ratio(2, 1), exact.area), mul(exact.perimeter, h)) : undefined),
          counts: { faces: n + 2, edges: 3 * n, vertices: 2 * n },
        };
      }
      const k = solid.topScale ?? 0;
      const sides = slantedSides(corners, solid.height, k);
      const scale = exactNumber(k);
      // Each side face: a trapezoid ½·edge·(1 + k)·slant, slant = √(h² + ((1 − k)·distance)²).
      const faces = exact.edges && h && scale ? all(exact.edges.map(({ length, distance }) => {
        const inward = mul(sub(fraction(1n), scale), distance);
        const slant = root(add(mul(h, h), mul(inward, inward)));
        return slant ? mul(ratio(1, 2), length, add(fraction(1n), scale), slant) : undefined;
      })) : undefined;
      return {
        volume: plain(solid.height * area * (1 + k + k * k) / 3, exact.area && h && scale ? mul(h, exact.area, add(add(fraction(1n), scale), mul(scale, scale)), ratio(1, 3)) : undefined),
        surfaceArea: plain(area * (1 + k * k) + sides, exact.area && scale && faces ? faces.reduce(add, mul(exact.area, add(fraction(1n), mul(scale, scale)))) : undefined),
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

/** An exact fraction as a decimal of at most three places ("24", "3.375"); undefined when it needs more. */
function decimalText(value: Fraction): string | undefined {
  for (let places = 0; places <= 3; places += 1) {
    const scale = 10n ** BigInt(places);
    if ((value.n * scale) % value.d !== 0n) continue;
    const scaled = (value.n * scale) / value.d;
    const sign = scaled < 0n ? "-" : "";
    const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(places + 1, "0");
    return places ? `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}` : `${sign}${digits}`;
  }
  return undefined;
}

/** Two decimal places, or three significant digits for a value too small to show in two (never "≈ 0.00"). */
const approximate = (value: number) => (value !== 0 && Math.abs(value) < 0.005 ? value.toPrecision(3) : (Math.round(value * 100) / 100).toFixed(2));

/** A multiple of π written exactly: 12π, 4.5π, 16π/3, π/3; undefined when the coefficient is not a simple fraction. */
function piText(coefficient: Fraction): string | undefined {
  if (coefficient.n === 0n) return undefined;
  const decimal = decimalText(coefficient);
  if (decimal !== undefined) return decimal === "1" ? "π" : `${decimal}π`;
  if (coefficient.d <= 12n) return `${coefficient.n === 1n ? "" : coefficient.n}π/${coefficient.d}`;
  return undefined;
}

/** A quantity as "= 24", "= 12π ≈ 37.70" or "≈ 75.40": exact only when its exact value says so. */
export function quantityText(quantity: SolidQuantity): string {
  if (quantity.pi !== undefined) {
    const exact = quantity.exact ? piText(quantity.exact) : undefined;
    return exact !== undefined ? `= ${exact} ≈ ${approximate(quantity.value)}` : `≈ ${approximate(quantity.value)}`;
  }
  const exact = quantity.exact && quantity.exact.n !== 0n ? decimalText(quantity.exact) : undefined;
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
