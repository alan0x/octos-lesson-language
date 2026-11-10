/**
 * 3D recipes of the math plugin with a sliding section plane: a cube, a
 * function surface z=f(x,y) and an implicit surface F(x,y,z)=level. Callers
 * resolve their own numbers and pass a translator for the Chinese labels.
 */
import type { AuthoringAction, Placement } from "../../core/src/index.js";
import type { Translate } from "./geometry.js";
import { buildImplicitSurfaceObject } from "./scene3d-surfaces.js";

interface Built { actions: AuthoringAction[]; whole: string; parts: Record<string, string> }
interface Common { as: string; role: string; place: Placement | Record<string, unknown>; t: Translate; title: string }

/** The scenes' initial camera. */
export const SURFACE_SCENE_CAMERA = { yaw: 0.72, pitch: 0.55, zoom: 1 } as const;

/** The section plane's position: its starting value, and the variable that moves it. */
export interface SectionInput { value: number; variable?: string }

function sectionScene(input: Common, content: Record<string, unknown>, section: SectionInput, parts: Record<string, string>): Built {
  const base = input.as;
  return {
    actions: [{ do: "write", as: base, kind: "scene3d", role: input.role, content: {
      ...content,
      ...(section.variable ? { bindings: [{ target: "section.value", expression: section.variable }] } : {}),
    }, place: input.place } as AuthoringAction],
    whole: base,
    parts: { whole: base, ...parts, ...(section.variable ? { primary_control: `${base}#section` } : {}) },
  };
}

/** A cube of side 2 centred on the origin, with a labelled vertex, edge and face and a horizontal section. */
export function buildCubeWithSection(input: Common & { section: SectionInput }): Built {
  const { t } = input;
  const base = input.as;
  return sectionScene(input, {
    title: input.title,
    fallback: t("一个中心在原点、边长为 2 的正方体，标出了顶点、棱、面和水平截面。"),
    axes: true,
    camera: { ...SURFACE_SCENE_CAMERA },
    objects: [{
      as: "solid", kind: "box", label: t("正方体"), color: "teal",
      center: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 },
    }],
    sections: [{
      as: "section", axis: "z", value: input.section.value, targets: ["solid"],
      display: "plane_and_intersection", label: t("水平截面"), color: "orange",
    }],
    highlights: [
      { as: "vertex", kind: "point", points: [{ x: -1, y: -1, z: 1 }], label: t("顶点"), color: "red" },
      { as: "edge", kind: "edge", points: [{ x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 }], label: t("棱"), color: "orange" },
      { as: "face", kind: "face", points: [{ x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 }], label: t("面"), color: "purple" },
    ],
  }, input.section, {
    solid: `${base}#solid`, vertex: `${base}#vertex`, edge: `${base}#edge`, face: `${base}#face`, section: `${base}#section`,
  });
}

export interface FunctionSurfaceInput extends Common {
  /** z as an expression of x and y. */
  expression: string;
  x_range: { min: number; max: number };
  y_range: { min: number; max: number };
  samples: number;
  axis: "x" | "y" | "z";
  section: SectionInput;
}

/** The surface z=f(x,y) cut by a plane across one axis. */
export function buildFunctionSurface(input: FunctionSurfaceInput): Built {
  const { t, expression } = input;
  const base = input.as;
  return sectionScene(input, {
    title: input.title,
    fallback: t("函数曲面 z={{v0}} 与可变截面。", { v0: expression }),
    axes: true,
    camera: { ...SURFACE_SCENE_CAMERA },
    objects: [{
      as: "surface", kind: "surface", label: `z=${expression}`, color: "teal", expression,
      x_range: input.x_range, y_range: input.y_range, samples: input.samples,
    }],
    sections: [{
      as: "section", axis: input.axis, value: input.section.value, targets: ["surface"],
      display: "plane_and_intersection", label: t("截面"), color: "orange",
    }],
  }, input.section, { surface: `${base}#surface`, section: `${base}#section`, intersection: `${base}#section` });
}

export interface ImplicitSurfaceInput extends Common {
  /** F(x,y,z) of the surface F = level. */
  expression: string;
  level: number;
  axis: "x" | "y" | "z";
  section: SectionInput;
}

/** The surface F(x,y,z)=level cut by a plane across one axis. Throws when it has no stable finite viewport. */
export function buildImplicitSurface(input: ImplicitSurfaceInput): Built {
  const { t, expression, level } = input;
  const base = input.as;
  const surface = buildImplicitSurfaceObject({ as: "surface", expression, level, samples: 12, color: "teal", label: `${expression}=${level}` });
  return sectionScene(input, {
    title: input.title,
    fallback: t("隐式曲面 {{v0}}={{v1}} 与可变轴向截面。", { v0: expression, v1: level }),
    axes: true,
    camera: { ...SURFACE_SCENE_CAMERA },
    objects: [surface],
    sections: [{
      as: "section", axis: input.axis, value: input.section.value, targets: ["surface"],
      display: "plane_and_intersection", label: t("截面"), color: "orange",
    }],
  }, input.section, { surface: `${base}#surface`, section: `${base}#section`, intersection: `${base}#section` });
}
