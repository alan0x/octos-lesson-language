import { compileMathExpression } from "../../core/src/index.js";
import type { StudentInputMethod } from "./student-operations.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface Scene3dViewState {
  yaw: number;
  pitch: number;
  zoom: number;
}

export type Scene3dViewControl = "orbit" | "zoom" | "preset" | "reset";
export type Scene3dViewPhase = "start" | "update" | "commit";

export interface Scene3dViewInputEvent {
  phase: Scene3dViewPhase;
  control: Scene3dViewControl;
  input: StudentInputMethod;
  operation_id?: string;
}

export type Scene3dViewInputHandler = (
  nodeId: string,
  view: Scene3dViewState,
  event: Scene3dViewInputEvent,
) => string | void;

interface Point3d { x: number; y: number; z: number }
interface ProjectedPoint { x: number; y: number; depth: number }

const WIDTH = 420;
const HEIGHT = 270;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2 + 8;

export function normalizeScene3dView(view: Scene3dViewState): Scene3dViewState {
  return {
    yaw: Number.isFinite(view.yaw) ? view.yaw : 0,
    pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
      Number.isFinite(view.pitch) ? view.pitch : .45)),
    zoom: Math.max(.2, Math.min(5, Number.isFinite(view.zoom) ? view.zoom : 1)),
  };
}

export function projectScene3dPoint(
  point: Point3d,
  view: Scene3dViewState,
  scale = 54,
): ProjectedPoint {
  const normalized = normalizeScene3dView(view);
  const cosYaw = Math.cos(normalized.yaw);
  const sinYaw = Math.sin(normalized.yaw);
  const cosPitch = Math.cos(normalized.pitch);
  const sinPitch = Math.sin(normalized.pitch);
  const horizontal = cosYaw * point.x - sinYaw * point.y;
  const depthBeforePitch = sinYaw * point.x + cosYaw * point.y;
  const vertical = cosPitch * point.z - sinPitch * depthBeforePitch;
  const depth = sinPitch * point.z + cosPitch * depthBeforePitch;
  return {
    x: CENTER_X + horizontal * scale * normalized.zoom,
    y: CENTER_Y - vertical * scale * normalized.zoom,
    depth,
  };
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function safeColor(value: unknown, fallback = "#277c75"): string {
  return typeof value === "string"
    && /^(#[0-9a-fA-F]{6}|teal|blue|purple|orange|red|gray)$/.test(value)
    ? value
    : fallback;
}

function line(
  svg: SVGSVGElement,
  from: Point3d,
  to: Point3d,
  view: Scene3dViewState,
  className: string,
  color?: string,
): void {
  const a = projectScene3dPoint(from, view);
  const b = projectScene3dPoint(to, view);
  const element = svgElement("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  element.setAttribute("class", className);
  if (color) element.setAttribute("stroke", color);
  svg.append(element);
}

function polygon(
  svg: SVGSVGElement,
  points: Point3d[],
  view: Scene3dViewState,
  color: string,
  opacity: number,
  className: string,
): SVGPolygonElement {
  const projected = points.map((point) => projectScene3dPoint(point, view));
  const element = svgElement("polygon", {
    points: projected.map((point) => `${point.x},${point.y}`).join(" "),
    fill: color,
    "fill-opacity": opacity,
    stroke: color,
  });
  element.setAttribute("class", className);
  svg.append(element);
  return element;
}

function boxFaces(object: Record<string, any>): Point3d[][] {
  const center = object.center;
  const size = object.size;
  const xs = [center.x - size.x / 2, center.x + size.x / 2];
  const ys = [center.y - size.y / 2, center.y + size.y / 2];
  const zs = [center.z - size.z / 2, center.z + size.z / 2];
  const p = (x: number, y: number, z: number): Point3d => ({ x, y, z });
  return [
    [p(xs[0], ys[0], zs[0]), p(xs[1], ys[0], zs[0]), p(xs[1], ys[1], zs[0]), p(xs[0], ys[1], zs[0])],
    [p(xs[0], ys[0], zs[1]), p(xs[1], ys[0], zs[1]), p(xs[1], ys[1], zs[1]), p(xs[0], ys[1], zs[1])],
    [p(xs[0], ys[0], zs[0]), p(xs[1], ys[0], zs[0]), p(xs[1], ys[0], zs[1]), p(xs[0], ys[0], zs[1])],
    [p(xs[0], ys[1], zs[0]), p(xs[1], ys[1], zs[0]), p(xs[1], ys[1], zs[1]), p(xs[0], ys[1], zs[1])],
    [p(xs[0], ys[0], zs[0]), p(xs[0], ys[1], zs[0]), p(xs[0], ys[1], zs[1]), p(xs[0], ys[0], zs[1])],
    [p(xs[1], ys[0], zs[0]), p(xs[1], ys[1], zs[0]), p(xs[1], ys[1], zs[1]), p(xs[1], ys[0], zs[1])],
  ];
}

function renderSurface(
  svg: SVGSVGElement,
  object: Record<string, any>,
  view: Scene3dViewState,
  variables: Record<string, number>,
): void {
  const samples = Math.max(4, Math.min(24, Number(object.samples) || 12));
  const evaluate = compileMathExpression(object.expression, ["x", "y", ...Object.keys(variables)]);
  const color = safeColor(object.color, "#3479a8");
  const point = (xIndex: number, yIndex: number): Point3d => {
    const x = object.x_range.min
      + (object.x_range.max - object.x_range.min) * xIndex / samples;
    const y = object.y_range.min
      + (object.y_range.max - object.y_range.min) * yIndex / samples;
    return { x, y, z: evaluate({ ...variables, x, y }) };
  };
  const faces: Array<{ points: Point3d[]; depth: number }> = [];
  for (let x = 0; x < samples; x += 1) {
    for (let y = 0; y < samples; y += 1) {
      const points = [point(x, y), point(x + 1, y), point(x + 1, y + 1), point(x, y + 1)];
      const depth = points.reduce((sum, candidate) =>
        sum + projectScene3dPoint(candidate, view).depth, 0) / 4;
      faces.push({ points, depth });
    }
  }
  faces.sort((left, right) => left.depth - right.depth);
  for (const face of faces) polygon(svg, face.points, view, color, .22, "scene3d-surface-cell");
}

function renderScene(
  svg: SVGSVGElement,
  content: Record<string, any>,
  view: Scene3dViewState,
  variables: Record<string, number>,
): void {
  svg.replaceChildren();
  if (content.axes !== false) {
    for (const [axis, end, color] of [
      ["x", { x: 2.7, y: 0, z: 0 }, "#c75b52"],
      ["y", { x: 0, y: 2.7, z: 0 }, "#377fa4"],
      ["z", { x: 0, y: 0, z: 2.7 }, "#377568"],
    ] as const) {
      line(svg, { x: 0, y: 0, z: 0 }, end, view, "scene3d-axis", color);
      const labelPoint = projectScene3dPoint(end, view);
      const label = svgElement("text", { x: labelPoint.x + 5, y: labelPoint.y - 4 });
      label.textContent = axis;
      label.setAttribute("class", "scene3d-axis-label");
      svg.append(label);
    }
  }
  const faces: Array<{ points: Point3d[]; color: string; depth: number }> = [];
  for (const object of content.objects ?? []) {
    const color = safeColor(object.color);
    if (object.kind === "surface") {
      renderSurface(svg, object, view, variables);
      continue;
    }
    if (object.kind === "box") {
      for (const points of boxFaces(object)) {
        const depth = points.reduce((sum, point) =>
          sum + projectScene3dPoint(point, view).depth, 0) / points.length;
        faces.push({ points, color, depth });
      }
      continue;
    }
    const center = object.center as Point3d;
    const projected = projectScene3dPoint(center, view);
    if (object.kind === "sphere") {
      const radius = object.radius * 54 * view.zoom;
      const sphere = svgElement("ellipse", {
        cx: projected.x, cy: projected.y, rx: radius, ry: radius * .74,
        fill: color, "fill-opacity": .28, stroke: color,
      });
      sphere.setAttribute("class", "scene3d-solid");
      svg.append(sphere);
    } else {
      const top = projectScene3dPoint({ ...center, z: center.z + object.height / 2 }, view);
      const bottom = projectScene3dPoint({ ...center, z: center.z - object.height / 2 }, view);
      const radius = object.radius * 54 * view.zoom;
      if (object.kind === "cone") {
        const cone = svgElement("path", {
          d: `M ${top.x} ${top.y} L ${bottom.x - radius} ${bottom.y} A ${radius} ${radius * .3} 0 0 0 ${bottom.x + radius} ${bottom.y} Z`,
          fill: color, "fill-opacity": .28, stroke: color,
        });
        cone.setAttribute("class", "scene3d-solid");
        svg.append(cone);
      } else {
        const cylinder = svgElement("path", {
          d: `M ${top.x - radius} ${top.y} L ${bottom.x - radius} ${bottom.y} A ${radius} ${radius * .3} 0 0 0 ${bottom.x + radius} ${bottom.y} L ${top.x + radius} ${top.y} A ${radius} ${radius * .3} 0 0 0 ${top.x - radius} ${top.y} Z`,
          fill: color, "fill-opacity": .25, stroke: color,
        });
        cylinder.setAttribute("class", "scene3d-solid");
        svg.append(cylinder);
      }
    }
  }
  faces.sort((left, right) => left.depth - right.depth);
  for (const face of faces) polygon(svg, face.points, view, face.color, .23, "scene3d-face");
  for (const section of content.sections ?? []) {
    const extent = 2.5;
    const value = section.value;
    const points: Point3d[] = section.axis === "x"
      ? [{ x: value, y: -extent, z: -extent }, { x: value, y: extent, z: -extent }, { x: value, y: extent, z: extent }, { x: value, y: -extent, z: extent }]
      : section.axis === "y"
        ? [{ x: -extent, y: value, z: -extent }, { x: extent, y: value, z: -extent }, { x: extent, y: value, z: extent }, { x: -extent, y: value, z: extent }]
        : [{ x: -extent, y: -extent, z: value }, { x: extent, y: -extent, z: value }, { x: extent, y: extent, z: value }, { x: -extent, y: extent, z: value }];
    polygon(svg, points, view, safeColor(section.color, "#d28a31"), .12, "scene3d-section");
  }
  for (const highlight of content.highlights ?? []) {
    const points = highlight.points as Point3d[];
    const color = safeColor(highlight.color, "#d04f45");
    const id = String(highlight.id ?? highlight.as ?? "");
    let labelPoint: ProjectedPoint | undefined;
    if (highlight.kind === "point") {
      labelPoint = projectScene3dPoint(points[0]!, view);
      const point = svgElement("circle", {
        cx: labelPoint.x,
        cy: labelPoint.y,
        r: 7,
        fill: color,
        stroke: "#fff",
        "stroke-width": 2,
      });
      point.setAttribute("class", "scene3d-highlight scene3d-highlight-point");
      point.dataset.id = id;
      svg.append(point);
    } else if (highlight.kind === "edge") {
      const from = projectScene3dPoint(points[0]!, view);
      const to = projectScene3dPoint(points[1]!, view);
      labelPoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, depth: 0 };
      const edge = svgElement("line", {
        x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        stroke: color, "stroke-width": 5, "stroke-linecap": "round",
      });
      edge.setAttribute("class", "scene3d-highlight scene3d-highlight-edge");
      edge.dataset.id = id;
      svg.append(edge);
    } else {
      const face = polygon(svg, points, view, color, .42, "scene3d-highlight scene3d-highlight-face");
      face.dataset.id = id;
      const projected = points.map((point) => projectScene3dPoint(point, view));
      labelPoint = {
        x: projected.reduce((sum, point) => sum + point.x, 0) / projected.length,
        y: projected.reduce((sum, point) => sum + point.y, 0) / projected.length,
        depth: 0,
      };
    }
    if (highlight.label && labelPoint) {
      const label = svgElement("text", { x: labelPoint.x + 8, y: labelPoint.y - 8 });
      label.textContent = String(highlight.label);
      label.setAttribute("class", "scene3d-highlight-label");
      svg.append(label);
    }
  }
}

function inputMethod(pointerType: string | undefined): StudentInputMethod {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return pointerType === "mouse" || !pointerType ? "mouse" : "unknown";
}

export function renderScene3d(
  parent: HTMLElement,
  node: Record<string, any>,
  storedView: Scene3dViewState | undefined,
  variables: Record<string, number>,
  onInput?: Scene3dViewInputHandler,
): void {
  const content = node.content ?? {};
  let view = normalizeScene3dView(storedView ?? content.camera ?? { yaw: .65, pitch: .5, zoom: 1 });
  const initial = normalizeScene3dView(content.camera ?? view);
  const shell = document.createElement("div");
  shell.className = "scene3d-runtime";
  shell.dataset.ollScene3d = node.id;
  const svg = svgElement("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}` });
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", textLabel(content.title, "可旋转三维场景"));
  const controls = document.createElement("div");
  controls.className = "scene3d-controls";
  const applyView = (
    next: Scene3dViewState,
    control: Scene3dViewControl,
    input: StudentInputMethod,
  ) => {
    const operationId = onInput?.(node.id, view, { phase: "start", control, input });
    view = normalizeScene3dView(next);
    renderScene(svg, content, view, variables);
    onInput?.(node.id, view, {
      phase: "commit", control, input,
      ...(typeof operationId === "string" ? { operation_id: operationId } : {}),
    });
  };
  for (const preset of [
    { label: "等轴", view: { yaw: .72, pitch: .55, zoom: 1 } },
    { label: "正视", view: { yaw: 0, pitch: 0, zoom: 1 } },
    { label: "俯视", view: { yaw: 0, pitch: Math.PI / 2, zoom: 1 } },
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.label;
    button.addEventListener("click", (event) => applyView(
      preset.view,
      "preset",
      event.detail === 0 ? "keyboard" : "mouse",
    ));
    controls.append(button);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "复位";
  reset.addEventListener("click", (event) => applyView(
    initial,
    "reset",
    event.detail === 0 ? "keyboard" : "mouse",
  ));
  controls.append(reset);
  let drag: { x: number; y: number; start: Scene3dViewState; input: StudentInputMethod; operationId?: string } | undefined;
  svg.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    const input = inputMethod(event.pointerType);
    const operationId = onInput?.(node.id, view, { phase: "start", control: "orbit", input });
    drag = { x: event.clientX, y: event.clientY, start: { ...view }, input,
      ...(typeof operationId === "string" ? { operationId } : {}) };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    view = normalizeScene3dView({
      ...drag.start,
      yaw: drag.start.yaw + (event.clientX - drag.x) * .012,
      pitch: drag.start.pitch - (event.clientY - drag.y) * .01,
    });
    renderScene(svg, content, view, variables);
    onInput?.(node.id, view, { phase: "update", control: "orbit", input: drag.input,
      ...(drag.operationId ? { operation_id: drag.operationId } : {}) });
  });
  const finishDrag = (event: PointerEvent) => {
    if (!drag) return;
    event.stopPropagation();
    onInput?.(node.id, view, { phase: "commit", control: "orbit", input: drag.input,
      ...(drag.operationId ? { operation_id: drag.operationId } : {}) });
    drag = undefined;
  };
  svg.addEventListener("pointerup", finishDrag);
  svg.addEventListener("pointercancel", finishDrag);
  let wheelGesture: {
    operationId?: string;
    timer?: ReturnType<typeof setTimeout>;
  } | undefined;
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!wheelGesture) {
      const operationId = onInput?.(node.id, view, {
        phase: "start",
        control: "zoom",
        input: "mouse",
      });
      wheelGesture = typeof operationId === "string" ? { operationId } : {};
    }
    view = normalizeScene3dView({
      ...view,
      zoom: view.zoom * Math.exp(-event.deltaY * .0015),
    });
    renderScene(svg, content, view, variables);
    onInput?.(node.id, view, {
      phase: "update",
      control: "zoom",
      input: "mouse",
      ...(wheelGesture.operationId ? { operation_id: wheelGesture.operationId } : {}),
    });
    if (wheelGesture.timer) clearTimeout(wheelGesture.timer);
    wheelGesture.timer = setTimeout(() => {
      if (!wheelGesture) return;
      onInput?.(node.id, view, {
        phase: "commit",
        control: "zoom",
        input: "mouse",
        ...(wheelGesture.operationId ? { operation_id: wheelGesture.operationId } : {}),
      });
      wheelGesture = undefined;
    }, 140);
  }, { passive: false });
  renderScene(svg, content, view, variables);
  const fallback = document.createElement("p");
  fallback.className = "scene3d-fallback";
  fallback.textContent = `静态说明：${textLabel(content.fallback, "请结合旁白和标注理解这个三维场景。")}`;
  shell.append(controls, svg, fallback);
  parent.append(shell);
}

function textLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
