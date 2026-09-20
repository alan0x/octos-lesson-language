import {
  coordinateWheelZoomFactor,
  panCoordinateRanges,
  validCoordinateRange,
  zoomCoordinateRanges,
  type CoordinateRanges,
} from "./coordinate-view.js";
import { plotFrame } from "./plot.js";

type Gesture = { host: HTMLElement; pointers: Map<number, { x: number; y: number }> };
type State = {
  disposed?: boolean;
  ranges: CoordinateRanges;
  signature: string;
  exploring: boolean;
  dialog?: HTMLDialogElement;
  gesture?: Gesture;
};

const states = new WeakMap<HTMLElement, State>();

export function disposeGeometryExplorer(parent: HTMLElement): void {
  const state = states.get(parent);
  if (!state) return;
  state.disposed = true;
  state.dialog?.close();
  state.dialog?.remove();
  states.delete(parent);
}

function rangesEqual(left: CoordinateRanges, right: CoordinateRanges): boolean {
  return left.x.min === right.x.min && left.x.max === right.x.max
    && left.y.min === right.y.min && left.y.max === right.y.max;
}

/** View-only geometry state stays outside lesson variables and replay events. */
export function renderGeometryExplorer(
  parent: HTMLElement,
  node: Record<string, any>,
  draw: (host: HTMLElement, node: Record<string, any>, width: number, height: number) => void,
): void {
  const axes = node.content?.axes ?? {};
  const recommended: CoordinateRanges = {
    x: validCoordinateRange(axes.x, { min: -1.25, max: 1.25 }),
    y: validCoordinateRange(axes.y, { min: -1.25, max: 1.25 }),
  };
  const signature = JSON.stringify(recommended);
  const storageKey = parent.dataset.plotViewScope
    ? `oll.geometry.view.v1:${parent.dataset.plotViewScope}:${node.id}`
    : undefined;
  let state = states.get(parent);
  if (!state || state.signature !== signature) {
    const dialog = state?.dialog;
    state = { ranges: structuredClone(recommended), signature, exploring: false, dialog };
    if (storageKey) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (saved?.signature === signature && saved.ranges) {
          state.ranges = {
            x: validCoordinateRange(saved.ranges.x, recommended.x),
            y: validCoordinateRange(saved.ranges.y, recommended.y),
          };
        }
      } catch { /* Ignore unavailable or invalid session storage. */ }
    }
    states.set(parent, state);
  }
  const current = state;
  const surfaces: Array<{ body: HTMLElement; large: boolean }> = [];
  const save = () => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ signature, ranges: current.ranges }));
    } catch { /* View persistence is optional. */ }
  };
  const toolbar = document.createElement("div");
  toolbar.className = "coordinate-toolbar geometry-toolbar";
  toolbar.dataset.ollBoardInput = "ignore";
  toolbar.dataset.ollInkInput = "ignore";
  const button = (label: string, title: string, action: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.title = title;
    element.setAttribute("aria-label", title);
    element.onclick = action;
    toolbar.append(element);
    return element;
  };
  const refresh = () => {
    if (current.disposed) return;
    save();
    for (const surface of surfaces) paint(surface.body, surface.large);
    syncControls();
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; refresh(); });
  };
  const explore = button("探索", "切换图内拖动和平移", () => {
    current.exploring = !current.exploring;
    explore.setAttribute("aria-pressed", String(current.exploring));
    refresh();
  });
  explore.dataset.action = "explore";
  explore.setAttribute("aria-pressed", String(current.exploring));
  const restore = button("恢复", "恢复课程视图，保留教学参数", () => {
    current.ranges = structuredClone(recommended);
    refresh();
  });
  restore.dataset.action = "restore";
  const expand = button("大图", "放大查看几何图", () => {
    if (current.dialog) return;
    const dialog = document.createElement("dialog");
    dialog.className = "oll-coordinate-dialog oll-geometry-dialog";
    current.dialog = dialog;
    document.body.append(dialog);
    mountDialog(dialog);
    dialog.showModal();
    dialog.addEventListener("close", () => {
      current.dialog = undefined;
      dialog.remove();
      expand.focus();
    }, { once: true });
  });
  expand.dataset.action = "expand";
  function syncControls(): void {
    const restored = rangesEqual(current.ranges, recommended);
    for (const root of [toolbar, current.dialog].filter(Boolean) as HTMLElement[]) {
      const exploreControl = root.querySelector<HTMLElement>("[data-action=explore]");
      const restoreControl = root.querySelector<HTMLElement>("[data-action=restore]");
      exploreControl?.setAttribute("aria-pressed", String(current.exploring));
      if (restoreControl) restoreControl.hidden = restored;
    }
  }
  parent.append(toolbar);
  const body = document.createElement("div");
  body.className = "coordinate-explorer-body geometry-explorer-body";
  parent.append(body);
  surfaces.push({ body, large: false });

  function mountDialog(dialog: HTMLDialogElement): void {
    dialog.replaceChildren();
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭大图";
    close.onclick = () => dialog.close();
    dialog.append(close);
    const title = document.createElement("h2");
    title.textContent = node.content?.title ?? "几何图";
    dialog.append(title);
    const controls = toolbar.cloneNode(true) as HTMLElement;
    const originals = Array.from(toolbar.querySelectorAll("button"));
    controls.querySelectorAll("button").forEach((control, index) => {
      if (control.dataset.action === "expand") control.remove();
      else control.onclick = () => originals[index]?.click();
    });
    dialog.append(controls);
    const shell = document.createElement("div");
    shell.className = "oll-board-runtime coordinate-dialog-shell";
    const dialogBody = document.createElement("div");
    shell.append(dialogBody);
    dialog.append(shell);
    surfaces.push({ body: dialogBody, large: true });
    paint(dialogBody, true);
  }

  function paint(host: HTMLElement, large: boolean): void {
    if (!host.isConnected && host !== body) return;
    host.replaceChildren();
    const width = large ? Math.max(400, Math.min(900, window.innerWidth - 80)) : 404;
    const height = large ? Math.max(360, Math.min(700, window.innerHeight - 210)) : 280;
    const content = { ...node.content, axes: { ...axes, ...current.ranges } };
    draw(host, { ...node, content }, width, height);
    const svg = host.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;
    svg.dataset.ollBoardWheel = "capture";
    svg.style.touchAction = current.exploring ? "none" : "";
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", "几何图；滚轮缩放，探索模式可拖动平移");
    const frame = plotFrame(width, height, current.ranges.x, current.ranges.y, true);
    const anchor = (event: PointerEvent | WheelEvent) => {
      const rect = svg.getBoundingClientRect();
      const svgX = (event.clientX - rect.left) / rect.width * width;
      const svgY = (event.clientY - rect.top) / rect.height * height;
      return {
        inside: svgX >= frame.left && svgX <= frame.right && svgY >= frame.top && svgY <= frame.bottom,
        x: Math.max(0, Math.min(1, (svgX - frame.left) / frame.width)),
        y: Math.max(0, Math.min(1, 1 - (svgY - frame.top) / frame.height)),
      };
    };
    svg.addEventListener("wheel", (event) => {
      const point = anchor(event);
      if (!point.inside) return;
      event.preventDefault();
      event.stopPropagation();
      current.ranges = zoomCoordinateRanges(
        current.ranges,
        coordinateWheelZoomFactor(event.deltaY, event.deltaMode),
        point,
      );
      schedule();
    }, { passive: false });
    svg.onpointerdown = (event) => {
      if (!current.exploring || (event.target as Element).closest("[data-oll-variable-control]")) return;
      event.preventDefault();
      event.stopPropagation();
      host.setPointerCapture(event.pointerId);
      if (current.gesture?.host !== host) current.gesture = { host, pointers: new Map() };
      current.gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    host.onpointermove = (event) => {
      const gesture = current.gesture;
      if (!current.exploring || gesture?.host !== host || !gesture.pointers.has(event.pointerId)) return;
      const previous = gesture.pointers.get(event.pointerId)!;
      const before = [...gesture.pointers.values()];
      gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const after = [...gesture.pointers.values()];
      const rect = svg.getBoundingClientRect();
      if (before.length === 2) {
        const distance = (points: typeof before) => Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
        const oldDistance = distance(before);
        const newDistance = distance(after);
        const beforeMidpoint = {
          x: (before[0]!.x + before[1]!.x) / 2,
          y: (before[0]!.y + before[1]!.y) / 2,
        };
        const afterMidpoint = {
          x: (after[0]!.x + after[1]!.x) / 2,
          y: (after[0]!.y + after[1]!.y) / 2,
        };
        const midpoint = {
          clientX: afterMidpoint.x,
          clientY: afterMidpoint.y,
        } as PointerEvent;
        current.ranges = panCoordinateRanges(
          current.ranges,
          (beforeMidpoint.x - afterMidpoint.x) / rect.width * width / frame.width
            * (current.ranges.x.max - current.ranges.x.min),
          (afterMidpoint.y - beforeMidpoint.y) / rect.height * height / frame.height
            * (current.ranges.y.max - current.ranges.y.min),
        );
        if (oldDistance > 1 && newDistance > 1) {
          current.ranges = zoomCoordinateRanges(current.ranges, oldDistance / newDistance, anchor(midpoint));
        }
      } else {
        const dx = (previous.x - event.clientX) / rect.width * width / frame.width
          * (current.ranges.x.max - current.ranges.x.min);
        const dy = (event.clientY - previous.y) / rect.height * height / frame.height
          * (current.ranges.y.max - current.ranges.y.min);
        current.ranges = panCoordinateRanges(current.ranges, dx, dy);
      }
      schedule();
    };
    host.onpointerup = host.onpointercancel = (event) => {
      current.gesture?.pointers.delete(event.pointerId);
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    };
    svg.onkeydown = (event) => {
      if (!["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "0") current.ranges = structuredClone(recommended);
      else if (["+", "=", "-"].includes(event.key)) {
        current.ranges = zoomCoordinateRanges(current.ranges, event.key === "-" ? 1.25 : .8);
      } else {
        const dx = (current.ranges.x.max - current.ranges.x.min) * .08
          * (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0);
        const dy = (current.ranges.y.max - current.ranges.y.min) * .08
          * (event.key === "ArrowDown" ? -1 : event.key === "ArrowUp" ? 1 : 0);
        current.ranges = panCoordinateRanges(current.ranges, dx, dy);
      }
      refresh();
      (host.querySelector("svg") as SVGSVGElement | null)?.focus();
    };
  }

  if (current.dialog) mountDialog(current.dialog);
  refresh();
}
