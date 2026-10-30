export type UiLocale = "zh-CN" | "en-US";

const EN: Readonly<Record<string, string>> = {
  "探索": "Explore", "恢复": "Restore", "大图": "Expand", "关闭大图": "Close expanded view",
  "函数图": "Function graph", "几何图": "Geometry", "等轴": "Isometric", "正视": "Front", "俯视": "Top", "复位": "Reset",
  "切换图内平移和缩放": "Toggle graph panning and zooming",
  "恢复课程视图和图层，保留参数": "Restore the lesson view and layers, keeping parameters",
  "放大查看函数图": "Expand the function graph",
  "部分曲线已隐藏；练习前请恢复课程视图。": "Some curves are hidden. Restore the lesson view before practising.",
  "探索中：拖动空白平移，滚轮/双指缩放。": "Exploring: drag empty space to pan; use the wheel or pinch to zoom.",
  "指向曲线查看坐标": "Point at a curve to read its coordinates",
  "函数图；滚轮缩放，探索模式可拖动平移": "Function graph; scroll to zoom, or drag to pan in Explore mode",
  "当前位置没有可读曲线": "No readable curve at this position",
  "{label}（{equation}）：{x} ≈ {xValue}，{y} ≈ {yValue}": "{label} ({equation}): {x} ≈ {xValue}, {y} ≈ {yValue}",
  "{label}：{x} ≈ {xValue}，{y} ≈ {yValue}": "{label}: {x} ≈ {xValue}, {y} ≈ {yValue}",
  "{first}、{second}": "{first} and {second}",
  "切换图内拖动和平移": "Toggle geometry dragging and panning",
  "恢复课程视图，保留教学参数": "Restore the lesson view, keeping teaching parameters",
  "放大查看几何图": "Expand the geometry diagram",
  "几何图；滚轮缩放，探索模式可拖动平移": "Geometry; scroll to zoom, or drag to pan in Explore mode",
  "可旋转三维场景": "Rotatable 3D scene",
  "静态说明：{description}": "Static description: {description}",
  "请结合旁白和标注理解这个三维场景。": "Use the narration and labels to understand this 3D scene.",
  "（空公式）": "(Empty formula)", "说明": "Description", "两点": "the two points",
  "Δx = {dx} · Δy = {dy} · 割线斜率 ≈ {slope}": "Δx = {dx} · Δy = {dy} · Secant slope ≈ {slope}",
  "两点横坐标重合或过近，不能用 Δy/Δx 计算斜率。": "The points have equal or nearly equal x-coordinates; Δy/Δx cannot be used to calculate the slope.",
  "{points}的横坐标固定；曲线参数变化时同步观察两点与割线。": "The x-coordinates of {points} are fixed. Watch the points and secant as the curve parameters change.",
  "通过滑块调整{points}的横坐标。": "Use the sliders to adjust the x-coordinates of {points}.",
  "{label}，{sides} 边": "{label}, {sides} sides",
  "{label}：拖动改变角度": "{label}: drag to change the angle",
  "{label} · {sides} 边 · 周长 {perimeter} · 周长÷直径 {ratio}": "{label} · {sides} sides · Perimeter {perimeter} · Perimeter ÷ diameter {ratio}",
  "受控课程图片": "Lesson image", "课程图片": "Lesson image", "知识组": "Knowledge group",
  "请结合旁白理解空间关系。": "Use the narration to understand the spatial relationships.",
  "三维场景暂时无法交互。静态说明：{description}": "The 3D scene is temporarily unavailable for interaction. Static description: {description}",
};

/** Explicit UI bindings only: authored lesson text is never translated here. */
class UiLocalization {
  locale: UiLocale = "zh-CN";
  bindings = new Map<Element, Map<string, () => void>>();
  pruning = false;
  pruneAfterRender(): void {
    if (this.pruning) return;
    this.pruning = true;
    queueMicrotask(() => {
      this.pruning = false;
      for (const element of this.bindings.keys()) if (!element.isConnected) this.bindings.delete(element);
    });
  }
  setLocale(locale: string): void {
    const next = /^zh(?:-|$)/i.test(locale) ? "zh-CN" : "en-US";
    if (next === this.locale) return;
    this.locale = next;
    for (const [element, updates] of this.bindings) {
      if (!element.isConnected) this.bindings.delete(element);
      else for (const update of updates.values()) update();
    }
  }
}
const scopes = new WeakMap<Element, UiLocalization>();
const defaults = new WeakMap<Document, UiLocalization>();
function scope(parent: Element): UiLocalization {
  for (let node: Element | null = parent; node; node = node.parentElement) {
    const existing = scopes.get(node);
    if (existing) return existing;
  }
  let fallback = defaults.get(parent.ownerDocument);
  if (!fallback) { fallback = new UiLocalization(); defaults.set(parent.ownerDocument, fallback); }
  return fallback;
}
export function inheritUiLocale(element: Element, parent: Element): void { scopes.set(element, scope(parent)); }
export function setBoardUiLocale(root: Element, locale: string): void {
  let value = scopes.get(root);
  if (!value) { value = new UiLocalization(); scopes.set(root, value); }
  value.setLocale(locale);
}
export function disposeBoardUiLocale(root: Element): void { scopes.get(root)?.bindings.clear(); scopes.delete(root); }
export function ui(parent: Element, source: string, values: Record<string, string | number> = {}): string {
  const message = scope(parent).locale === "en-US" ? EN[source] ?? source : source;
  return message.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}
export function bindUi(parent: Element, element: Element, property: string, update: () => void): void {
  const localization = scope(parent);
  let updates = localization.bindings.get(element);
  if (!updates) { updates = new Map(); localization.bindings.set(element, updates); }
  updates.set(property, update);
  update();
  localization.pruneAfterRender();
}
