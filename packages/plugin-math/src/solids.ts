/**
 * 3D solids for the math plugin's shared layer: the shape model, its geometry
 * helpers, a scene builder (cut plane, net that unfolds, highlightable box
 * faces) and a zh/en description. Studio's 3D panel uses it; Coach can adopt
 * it for AI lessons.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";

/** A prism's or pyramid's base other than a regular polygon: a rectangle, a right triangle by its legs, or a triangle by its three sides. */
export type SolidBase =
  | { kind: "rectangle"; length: number; width: number }
  | { kind: "right_triangle"; a: number; b: number }
  | { kind: "triangle"; a: number; b: number; c: number };

/** Two solids stacked: a cylinder with a cone or a hemisphere on top, a box with a pyramid roof, or a smaller cylinder on a larger one. */
export type CompositeSolid =
  | { shape: "composite"; parts: "cylinder_cone"; radius: number; height: number; topHeight: number }
  | { shape: "composite"; parts: "cylinder_hemisphere"; radius: number; height: number }
  | { shape: "composite"; parts: "box_pyramid"; width: number; height: number; topHeight: number }
  | { shape: "composite"; parts: "two_cylinders"; radius: number; height: number; topRadius: number; topHeight: number };

/** A 3D solid, centred on the origin, its height along z (a hemisphere's flat face on the origin). */
export type Solid =
  | { shape: "box"; size: { x: number; y: number; z: number } }
  | { shape: "cylinder" | "cone"; radius: number; height: number }
  /** A regular base of `sides` in a circle of `radius`; a pyramid with topScale (0 < k < 1) is truncated. */
  | { shape: "prism" | "pyramid"; sides: number; radius: number; height: number; topScale?: number }
  | { shape: "prism" | "pyramid"; base: SolidBase; height: number; topScale?: number }
  | { shape: "ellipsoid"; radii: { x: number; y: number; z: number } }
  | CompositeSolid
  | { shape: "frustum"; radius: number; topRadius: number; height: number }
  | { shape: "torus"; radius: number; tube: number }
  | { shape: "sphere" | "hemisphere" | "tetrahedron" | "octahedron" | "dodecahedron" | "icosahedron"; radius: number };

export type SolidShape = Solid["shape"];

/** How high a regular polyhedron of circumradius 1 reaches above (and below) its centre. */
const POLYHEDRON_REACH: Record<string, number> = { tetrahedron: 1 / Math.sqrt(3), octahedron: 1, dodecahedron: 0.7947, icosahedron: 0.8507 };

/** Where a solid is along z, from its bottom to its top, to bound a cutting plane. */
export function solidZRange(solid: Solid): [number, number] {
  switch (solid.shape) {
    case "box": return [-solid.size.z / 2, solid.size.z / 2];
    case "sphere": return [-solid.radius, solid.radius];
    case "hemisphere": return [0, solid.radius];
    case "torus": return [-solid.tube, solid.tube];
    case "ellipsoid": return [-solid.radii.z, solid.radii.z];
    case "composite": { const total = compositeHeight(solid); return [-total / 2, total / 2]; }
    case "tetrahedron": case "octahedron": case "dodecahedron": case "icosahedron": {
      const reach = solid.radius * POLYHEDRON_REACH[solid.shape]!;
      return [-reach, reach];
    }
    default: return [-solid.height / 2, solid.height / 2];
  }
}

/** A composite solid's total height, bottom to top. */
export function compositeHeight(solid: CompositeSolid): number {
  return solid.parts === "cylinder_hemisphere" ? solid.height + solid.radius : solid.height + solid.topHeight;
}

/** Whether a solid opens into a net (a box, prism, pyramid, cylinder or cone). */
export function solidUnfolds(solid: Solid): boolean {
  return ["box", "prism", "pyramid", "cylinder", "cone"].includes(solid.shape);
}

/** A base as its corners, going round counter-clockwise (the player centres it on its centroid). */
export function baseCorners(base: SolidBase): Array<{ x: number; y: number }> | undefined {
  switch (base.kind) {
    case "rectangle": return [{ x: 0, y: 0 }, { x: base.length, y: 0 }, { x: base.length, y: base.width }, { x: 0, y: base.width }];
    case "right_triangle": return [{ x: 0, y: 0 }, { x: base.a, y: 0 }, { x: 0, y: base.b }];
    case "triangle": {
      // Side a along the bottom; c from its left end and b from its right end meet at the top corner.
      const { a, b, c } = base;
      if (!(a + b > c && b + c > a && a + c > b)) return undefined;
      const x = (a * a + c * c - b * b) / (2 * a);
      return [{ x: 0, y: 0 }, { x: a, y: 0 }, { x, y: Math.sqrt(c * c - x * x) }];
    }
  }
}

/** A composite's two parts, stacked from the bottom: "solid", then "solid-top". */
function compositeObjects(solid: CompositeSolid, base: Record<string, unknown>): Array<Record<string, unknown>> {
  const at = (z: number) => ({ x: 0, y: 0, z: Number(z.toFixed(6)) });
  const bottom = -compositeHeight(solid) / 2;
  const lower = { ...base, center: at(bottom + solid.height / 2) };
  const upper = { as: "solid-top", center: at(bottom + solid.height + ("topHeight" in solid ? solid.topHeight / 2 : 0)) };
  switch (solid.parts) {
    case "cylinder_cone": return [{ ...lower, kind: "cylinder", radius: solid.radius, height: solid.height }, { ...upper, kind: "cone", radius: solid.radius, height: solid.topHeight }];
    case "cylinder_hemisphere": return [{ ...lower, kind: "cylinder", radius: solid.radius, height: solid.height }, { ...upper, kind: "hemisphere", radius: solid.radius }];
    // A square pyramid's corners are on a circle of radius width/√2, its sides facing the box's.
    case "box_pyramid": return [{ ...lower, kind: "box", size: { x: solid.width, y: solid.width, z: solid.height } },
      { ...upper, kind: "pyramid", sides: 4, radius: Number((solid.width / Math.SQRT2).toFixed(6)), height: solid.topHeight }];
    case "two_cylinders": return [{ ...lower, kind: "cylinder", radius: solid.radius, height: solid.height }, { ...upper, kind: "cylinder", radius: solid.topRadius, height: solid.topHeight }];
  }
}

/**
 * A solid as OLL scene3d objects, centred on the origin: one, or a
 * composite's parts stacked from the bottom ("solid", then "solid-top").
 * Throws when a triangle base's three sides do not make a triangle.
 */
export function solidObjects(solid: Solid): Array<Record<string, unknown>> {
  const at = (z: number) => ({ x: 0, y: 0, z: Number(z.toFixed(6)) });
  const base = { as: "solid", kind: solid.shape, center: at(0) };
  switch (solid.shape) {
    case "box": return [{ ...base, size: solid.size }];
    case "cylinder": case "cone": return [{ ...base, radius: solid.radius, height: solid.height }];
    case "prism": case "pyramid": {
      const top = solid.shape === "pyramid" && solid.topScale !== undefined ? { top_scale: solid.topScale } : {};
      if ("base" in solid) {
        const corners = baseCorners(solid.base);
        if (!corners) throw new Error("The three sides do not make a triangle");
        return [{ ...base, base: corners.map((corner) => ({ x: Number(corner.x.toFixed(6)), y: Number(corner.y.toFixed(6)) })), height: solid.height, ...top }];
      }
      return [{ ...base, sides: solid.sides, radius: solid.radius, height: solid.height, ...top }];
    }
    case "frustum": return [{ ...base, radius: solid.radius, top_radius: solid.topRadius, height: solid.height }];
    case "torus": return [{ ...base, radius: solid.radius, tube: solid.tube }];
    case "ellipsoid": return [{ ...base, radii: solid.radii }];
    case "composite": return compositeObjects(solid, base);
    default: return [{ ...base, radius: solid.radius }];
  }
}

/** The six box faces' names, in the lesson's language. */
export interface BoxFaceNames { top: string; bottom: string; front: string; back: string; left: string; right: string }

/**
 * The box's six faces, around its centre at the origin (the view turns about
 * the origin, so the box stays put). Each is drawn only once it is
 * emphasized. `legacy` keeps the labels of lessons recorded before faces were
 * named in the lesson's language.
 */
export function boxFaces(size: { x: number; y: number; z: number }, names: BoxFaceNames, unfolds: boolean, legacy = false) {
  const [hx, hy, hz] = [size.x / 2, size.y / 2, size.z / 2];
  const face = (as: string, name: string, a: number, b: number, corners: Array<[number, number, number]>) => {
    const points = corners.map(([x, y, z]) => ({ x, y, z }));
    if (legacy) return { as, kind: "face", label: `${as.slice(0, -5)} ${a} × ${b}`, shown: "when_emphasized", points };
    return { as, kind: "face", shown: "when_emphasized", label: `${name}${unfolds ? "\n" : " "}${a} × ${b}`, points };
  };
  return [
    face("top-face", names.top, size.x, size.y, [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]),
    face("bottom-face", names.bottom, size.x, size.y, [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz]]),
    // The viewer looks from +y (OLL's "front" preset), so the front face is the +y one.
    face("front-face", names.front, size.x, size.z, [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]]),
    face("back-face", names.back, size.x, size.z, [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]),
    face("left-face", names.left, size.y, size.z, [[-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], [-hx, -hy, hz]]),
    face("right-face", names.right, size.y, size.z, [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]),
  ];
}

const POLYGON_ZH = ["", "", "", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

function compositeDescription(solid: CompositeSolid, zh: boolean): string {
  switch (solid.parts) {
    case "cylinder_cone": return zh ? `半径 ${solid.radius}、高 ${solid.height} 的圆柱，上面是高 ${solid.topHeight} 的圆锥。` : `A cylinder of radius ${solid.radius} and height ${solid.height} with a cone of height ${solid.topHeight} on top.`;
    case "cylinder_hemisphere": return zh ? `半径 ${solid.radius}、高 ${solid.height} 的圆柱，上面是半球。` : `A cylinder of radius ${solid.radius} and height ${solid.height} with a hemisphere on top.`;
    case "box_pyramid": return zh ? `底面边长 ${solid.width}、高 ${solid.height} 的长方体，上面是高 ${solid.topHeight} 的四棱锥。` : `A box ${solid.width} wide and ${solid.height} high with a square pyramid of height ${solid.topHeight} on top.`;
    case "two_cylinders": return zh ? `半径 ${solid.radius}、高 ${solid.height} 的圆柱，上面是半径 ${solid.topRadius}、高 ${solid.topHeight} 的圆柱。` : `A cylinder of radius ${solid.radius} and height ${solid.height} with a cylinder of radius ${solid.topRadius} and height ${solid.topHeight} on top.`;
  }
}

/** A 3D solid in words, in Chinese or English, shown under the scene (and instead of it if it cannot be drawn). */
export function describeSolid(solid: Solid, language: string): string {
  const zh = language.toLowerCase().startsWith("zh");
  switch (solid.shape) {
    case "box": return zh ? `长 ${solid.size.x}、宽 ${solid.size.y}、高 ${solid.size.z} 的长方体。` : `A box ${solid.size.x} by ${solid.size.y} by ${solid.size.z}.`;
    case "sphere": return zh ? `半径 ${solid.radius} 的球。` : `A sphere of radius ${solid.radius}.`;
    case "hemisphere": return zh ? `半径 ${solid.radius} 的半球。` : `A hemisphere of radius ${solid.radius}.`;
    case "cylinder": case "cone": return zh ? `半径 ${solid.radius}、高 ${solid.height} 的${solid.shape === "cone" ? "圆锥" : "圆柱"}。` : `A ${solid.shape} of radius ${solid.radius} and height ${solid.height}.`;
    case "prism": case "pyramid": {
      const truncated = solid.shape === "pyramid" && solid.topScale !== undefined;
      const kind = zh ? (solid.shape === "prism" ? "棱柱" : truncated ? "棱台" : "棱锥") : solid.shape === "prism" ? "prism" : truncated ? "truncated pyramid" : "pyramid";
      const top = truncated ? (zh ? `，上底是下底的 ${solid.topScale} 倍` : `, its top ${solid.topScale} times the base`) : "";
      if (!("base" in solid)) return zh ? `底面是正${POLYGON_ZH[solid.sides]}边形的${kind}，高 ${solid.height}${top}。` : `A ${solid.sides}-sided ${kind} of height ${solid.height}${top}.`;
      const base = solid.base;
      const shape = base.kind === "rectangle" ? (zh ? `长 ${base.length}、宽 ${base.width} 的长方形` : `a ${base.length} by ${base.width} rectangle`)
        : base.kind === "right_triangle" ? (zh ? `直角边为 ${base.a} 和 ${base.b} 的直角三角形` : `a right triangle with legs ${base.a} and ${base.b}`)
        : zh ? `三边长 ${base.a}、${base.b}、${base.c} 的三角形` : `a triangle with sides ${base.a}, ${base.b} and ${base.c}`;
      return zh ? `底面是${shape}的${kind}，高 ${solid.height}${top}。` : `A ${kind} on ${shape}, height ${solid.height}${top}.`;
    }
    case "ellipsoid": return zh ? `三个半轴是 ${solid.radii.x}、${solid.radii.y}、${solid.radii.z} 的椭球。` : `An ellipsoid with semi-axes ${solid.radii.x}, ${solid.radii.y} and ${solid.radii.z}.`;
    case "composite": return compositeDescription(solid, zh);
    case "torus": return zh ? `环半径 ${solid.radius}、管半径 ${solid.tube} 的圆环。` : `A torus of ring radius ${solid.radius} and tube radius ${solid.tube}.`;
    case "frustum": return zh ? `下底半径 ${solid.radius}、上底半径 ${solid.topRadius}、高 ${solid.height} 的圆台。` : `A frustum of radii ${solid.radius} and ${solid.topRadius}, height ${solid.height}.`;
    default: {
      const names = { tetrahedron: ["正四面体", "tetrahedron"], octahedron: ["正八面体", "octahedron"], dodecahedron: ["正十二面体", "dodecahedron"], icosahedron: ["正二十面体", "icosahedron"] }[solid.shape];
      return zh ? `${names[0]}。` : `A regular ${names[1]}.`;
    }
  }
}

export interface SolidSceneInput {
  as: string;
  role: string;
  place: Placement | Record<string, unknown>;
  title?: string;
  solid: Solid;
  /** Text shown under the scene, and instead of it if it cannot be drawn. */
  fallback: string;
  /** Give every object stable face targets (`<scene>#<object>-<surface>-face`). */
  face_targets?: boolean;
  /** A box's six highlightable faces. */
  box_faces?: { names: BoxFaceNames; legacy?: boolean };
  /** The net opens from 0 (closed) to 1 (flat) as this expression. Only for a solid that unfolds. */
  unfold?: { expression: string };
  /** A horizontal cutting plane at this expression's height, starting halfway up. */
  cut?: { expression: string };
}

/** The scene's initial camera. */
export const SOLID_SCENE_CAMERA = { yaw: 0.72, pitch: 0.55, zoom: 1 } as const;

export function buildSolid(input: SolidSceneInput): { actions: AuthoringAction[]; whole: string; parts: Record<string, string> } {
  const { solid } = input;
  if (input.cut && input.unfold) throw new Error("A solid is either cut or unfolded, not both");
  if (input.unfold && !solidUnfolds(solid)) throw new Error(`A ${solid.shape} has no net to unfold`);
  const objects = solidObjects(solid);
  if (input.face_targets) for (const object of objects) object.face_targets = true;
  const content: Record<string, unknown> = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    fallback: input.fallback,
    axes: false,
    camera: { ...SOLID_SCENE_CAMERA },
    objects: input.unfold ? objects.map((object) => ({ ...object, unfold: 0 })) : objects,
    ...(solid.shape === "box" && input.box_faces
      ? { highlights: boxFaces(solid.size, input.box_faces.names, Boolean(input.unfold), input.box_faces.legacy) } : {}),
  };
  if (input.unfold) content.bindings = [{ target: "solid.unfold", expression: input.unfold.expression }];
  if (input.cut) {
    const [bottom, top] = solidZRange(solid);
    const middle = Number(((bottom + top) / 2).toFixed(6));
    content.sections = [{ as: "cut", axis: "z", value: middle, targets: objects.map((object) => object.as), display: "plane_and_intersection", color: "orange" }];
    content.bindings = [{ target: "cut.value", expression: input.cut.expression }];
  }
  return {
    actions: [{ do: "write", as: input.as, kind: "scene3d", role: input.role, content, place: input.place } as AuthoringAction],
    whole: input.as,
    parts: {
      whole: input.as,
      solid: `${input.as}#solid`,
      ...(objects.length > 1 ? { solid_top: `${input.as}#solid-top` } : {}),
      ...(input.cut ? { section: `${input.as}#cut`, primary_control: `${input.as}#cut` } : {}),
      ...(input.unfold ? { primary_control: `${input.as}#solid` } : {}),
    },
  };
}
