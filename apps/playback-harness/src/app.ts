import type { CanonicalEvent } from "../../../packages/core/src/index.js";
import type {
  InkMode,
  InkRuntime,
  InkRuntimeState,
  InkSelectionSnapshot,
} from "../../../packages/ink-runtime/src/index.js";
import "../../../packages/web-runtime/styles.css";
import {
  BrowserLessonSession,
  LocalPlaybackStore,
  mountInfiniteBoard,
  mountVariableControls,
  parseCanonicalJsonl,
} from "../../../packages/web-runtime/src/index.js";
import {
  collectTeachingObservation,
  evaluateTeachingObservation,
  type TeachingFrameObservation,
  type TeachingGateResult,
} from "../../../packages/web-runtime/src/testing.js";
import { resolveHarnessAsset } from "./assets.js";

const fixtures = [
  { id: "quadratic", label: "数学 · 二次函数配方法 V2", path: "/examples/quadratic-v2/lesson.canonical.jsonl" },
  { id: "unit-circle", label: "数学 · 单位圆与正弦图像", path: "/examples/unit-circle-sine/lesson.canonical.jsonl" },
  { id: "quadratic-v1", label: "探针 · 二次函数配方法 V1", path: "/examples/quadratic/lesson.canonical.jsonl" },
  { id: "geometry", label: "数学 · 几何辅助线 V2", path: "/examples/geometry-auxiliary-line-v2/lesson.canonical.jsonl" },
  { id: "geometry-v1", label: "回归 · 几何辅助线 V1", path: "/examples/geometry-auxiliary-line/lesson.canonical.jsonl" },
  { id: "science", label: "科学 · 植物蒸腾作用 V2", path: "/examples/science-transpiration-v2/lesson.canonical.jsonl" },
  { id: "english", label: "语言 · 英语定语从句 V2", path: "/examples/english-relative-clause-v2/lesson.canonical.jsonl" },
  { id: "english-v1", label: "探针 · 英语定语从句 V1", path: "/examples/english-relative-clause/lesson.canonical.jsonl" },
];
const selectedLessonKey = "oll-harness:selected-lesson";
const requestedLessonId = new URLSearchParams(window.location.search).get("lesson");
const inkDemoEnabled = new URLSearchParams(window.location.search).get("ink-demo") === "1";
const inkDemoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><path d="M 30 96 C 82 28, 136 136, 196 66 C 230 40, 270 72, 292 42" fill="none" stroke="#176b62" stroke-width="8" stroke-linecap="round"/></svg>';
type InkModule = typeof import("../../../packages/ink-runtime/src/index.js");

declare global {
  interface Window {
    __OLL_HARNESS__: {
      ready: boolean;
      lessonIds: string[];
      loadLesson(id: string): Promise<void>;
      reset(): void;
      advance(): unknown;
      advanceBeat(): void;
      setVariable(alias: string, value: number): void;
      enableInk(): Promise<void>;
      setInkMode(mode: InkMode): void;
      inkState(): InkRuntimeState | null;
      saveInk(): Promise<unknown>;
      selectAllInk(): void;
      captureInkSelection(): Promise<InkSelectionSnapshot>;
      observe(): TeachingFrameObservation;
      evaluate(observation: TeachingFrameObservation): TeachingGateResult;
    };
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
}

const lessonSelect = requireElement<HTMLSelectElement>("#lesson-select");
for (const fixture of fixtures) { const option = document.createElement("option"); option.value = fixture.id; option.textContent = fixture.label; lessonSelect.append(option); }
const restoredLessonId = localStorage.getItem(selectedLessonKey);
lessonSelect.value = fixtures.some((fixture) => fixture.id === requestedLessonId) ? requestedLessonId!
  : fixtures.some((fixture) => fixture.id === restoredLessonId) ? restoredLessonId! : fixtures[0]!.id;
const mountedBoard = mountInfiniteBoard(requireElement("#viewport"), resolveHarnessAsset);
const boardView = mountedBoard.view;
boardView.setViewportInsets({ top: 70, bottom: 190 });
const store = new LocalPlaybackStore();
let session: BrowserLessonSession;
boardView.setVariableInputHandler((alias, value) => session.setVariable(alias, value));
const variableControls = mountVariableControls(
  requireElement("#variable-controls"),
  (alias, value) => session.setVariable(alias, value),
);
let events: CanonicalEvent[] = [];
let unsubscribe: (() => void) | undefined;
let inkRuntime: InkRuntime | undefined;
let unsubscribeInk: (() => void) | undefined;
let inkEnabled = false;
let inkModulePromise: Promise<InkModule> | undefined;
let latestInkSource: InkSelectionSnapshot | undefined;
let latestInkError = "";

function loadInkModule(): Promise<InkModule> {
  if (inkModulePromise) return inkModulePromise;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/dist/apps/playback-harness/browser/ink-entry.css";
  stylesheet.dataset.ollInkStyles = "";
  const stylesheetReady = new Promise<void>((resolve, reject) => {
    stylesheet.addEventListener("load", () => resolve(), { once: true });
    stylesheet.addEventListener("error", () => reject(new Error("Failed to load Ink Runtime styles")), { once: true });
  });
  document.head.append(stylesheet);
  const entryUrl = new URL("/dist/apps/playback-harness/browser/ink-entry.js", window.location.origin).href;
  inkModulePromise = Promise.all([
    import(entryUrl) as Promise<InkModule>,
    stylesheetReady,
  ]).then(([module]) => module);
  return inkModulePromise;
}

function renderInkState(state: InkRuntimeState): void {
  const tools = requireElement<HTMLElement>("#ink-tools");
  tools.hidden = false;
  requireElement<HTMLButtonElement>("#ink-enable").hidden = true;
  requireElement("#ink-status").textContent = latestInkError || `${state.component_count} 项笔迹 · 已选 ${state.selected_count} · v${state.document_version}${state.saved ? " · 已保存" : " · 保存中"}${latestInkSource ? ` · 快照 ${latestInkSource.source_id.split(":").at(-1)?.slice(0, 8)}` : ""}`;
  requireElement<HTMLInputElement>("#ink-pen-color").value = state.pen_color;
  const selectionColorControl = requireElement<HTMLElement>("#ink-selection-color-control");
  selectionColorControl.hidden = state.selected_count === 0;
  if (state.selection_color) requireElement<HTMLInputElement>("#ink-selection-color").value = state.selection_color;
  for (const button of tools.querySelectorAll<HTMLButtonElement>("[data-ink-mode]")) {
    const active = button.dataset.inkMode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

async function mountInkForCurrentLesson(initialMode: InkMode): Promise<void> {
  const module = await loadInkModule();
  unsubscribeInk?.();
  if (inkRuntime) await inkRuntime.destroy();
  latestInkSource = undefined;
  latestInkError = "";
  const lessonId = events[0]?.lesson_id;
  if (!lessonId) throw new Error("Cannot mount student ink before lesson.open");
  const storageKey = `oll-harness:ink:${lessonId}${inkDemoEnabled ? ":demo-v2" : ""}`;
  const documentId = `${lessonId}:student-ink`;
  if (inkDemoEnabled) {
    const demoStore = new module.LocalInkDocumentStore();
    if (!demoStore.load(storageKey)) {
      demoStore.save(storageKey, await module.createInkDocumentRecord({
        documentId,
        documentVersion: 1,
        editorVersion: "1.33.0",
        svg: inkDemoSvg,
      }));
    }
  }
  inkRuntime = module.mountInkRuntime({
    board: boardView,
    viewport: mountedBoard.elements.viewport,
    storageKey,
    documentId,
  });
  await inkRuntime.ready;
  unsubscribeInk = inkRuntime.subscribe(renderInkState);
  inkRuntime.setMode(initialMode);
}

async function enableInk(): Promise<void> {
  inkEnabled = true;
  await mountInkForCurrentLesson("draw");
}

async function loadLesson(id: string): Promise<void> {
  const fixture = fixtures.find((item) => item.id === id) ?? fixtures[0]!;
  localStorage.setItem(selectedLessonKey, fixture.id);
  const response = await fetch(fixture.path);
  if (!response.ok) throw new Error(`Failed to load ${fixture.path}: ${response.status}`);
  events = parseCanonicalJsonl(await response.text());
  unsubscribe?.(); session?.pause();
  session = new BrowserLessonSession(events, store, `oll-harness:${events[0]!.lesson_id}`, {
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  });
  unsubscribe = session.subscribe(render);
  if (inkEnabled) await mountInkForCurrentLesson("navigate");
  render();
  requestAnimationFrame(() => boardView.fit());
}

function render(): void {
  const projection = session.projection;
  const operation = session.currentOperation;
  boardView.render(projection.board, operation);
  variableControls.render(projection.board, session.activeVariableAnimation);
  const title = events[0]?.lesson?.title ?? events[0]?.lesson_id ?? "OLL Lesson";
  requireElement("#lesson-title").textContent = title;
  const status = session.status;
  const chip = requireElement("#lesson-status"); chip.textContent = status.toUpperCase(); chip.className = `status-chip ${status}`;
  const progress = projection.total_operations ? projection.cursor / projection.total_operations : 0;
  (requireElement("#progress-bar") as HTMLElement).style.width = `${progress * 100}%`;
  requireElement("#progress-label").textContent = `${projection.cursor} / ${projection.total_operations}`;
  const playButton = requireElement<HTMLButtonElement>("#play-button"); playButton.textContent = session.isPlaying ? "暂停" : projection.status === "completed" ? "已完成" : "播放"; playButton.disabled = projection.status === "completed";
  const narration = requireElement<HTMLElement>("#narration"); narration.hidden = !projection.current_narration; narration.textContent = projection.current_narration?.text ?? "";
  renderState(status); renderTimeline();
}

function renderState(status: string): void {
  const projection = session.projection; const board = projection.board;
  const values = {
    status,
    revision: board?.revision ?? "—",
    step: projection.current_step_id?.split(":step:").at(-1) ?? "—",
    beat: projection.current_beat_id?.split(":beat:").at(-1) ?? "—",
    phase: projection.current_phase ?? "—",
    nodes: board ? Object.keys(board.nodes).length : 0,
    connections: board ? Object.keys(board.connections).length : 0,
    groups: board ? Object.keys(board.groups).length : 0,
    variables: board?.variables
      ? Object.entries(board.variables).map(([alias, variable]) => `${alias}=${Number(variable.value.toFixed(3))}`).join(", ")
      : "—",
  };
  const grid = requireElement("#state-grid"); grid.replaceChildren();
  for (const [key, value] of Object.entries(values)) {
    const wrapper = document.createElement("div"); const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = key; dd.textContent = String(value); wrapper.append(dt, dd); grid.append(wrapper);
  }
}

function renderTimeline(): void {
  const list = requireElement<HTMLOListElement>("#timeline"); const previousScroll = list.scrollTop; list.replaceChildren();
  session.operations.forEach((operation, index) => {
    const item = document.createElement("li"); if (index < session.cursor) item.classList.add("done"); if (index === session.cursor - 1) item.classList.add("current");
    const number = document.createElement("span"); number.className = "index"; number.textContent = String(index + 1).padStart(3, "0");
    const detail = document.createElement("span"); detail.className = "detail"; detail.textContent = [operation.type, operation.phase, operation.action?.op, operation.beat_id?.split(":beat:").at(-1)].filter(Boolean).join(" · "); item.append(number, detail); list.append(item);
  });
  const current = list.querySelector(".current"); if (current) current.scrollIntoView({ block: "nearest" }); else list.scrollTop = previousScroll;
}

const harnessApi: Window["__OLL_HARNESS__"] = window.__OLL_HARNESS__ = {
  ready: false,
  lessonIds: fixtures.map((fixture) => fixture.id),
  async loadLesson(id: string) {
    harnessApi.ready = false;
    lessonSelect.value = fixtures.some((fixture) => fixture.id === id) ? id : fixtures[0]!.id;
    await loadLesson(lessonSelect.value);
    harnessApi.ready = true;
  },
  reset() { session.reset(); boardView.fit(); },
  advance() { return session.step()?.operation ?? null; },
  advanceBeat() { session.advanceBeat(); },
  setVariable(alias: string, value: number) { session.setVariable(alias, value); },
  enableInk,
  setInkMode(mode) {
    if (!inkRuntime) throw new Error("Ink Runtime has not been enabled");
    inkRuntime.setMode(mode);
  },
  inkState: () => inkRuntime?.state ?? null,
  saveInk: () => inkRuntime?.saveNow() ?? Promise.resolve(null),
  selectAllInk() {
    if (!inkRuntime) throw new Error("Ink Runtime has not been enabled");
    inkRuntime.selectAll();
  },
  captureInkSelection() {
    if (!inkRuntime) throw new Error("Ink Runtime has not been enabled");
    return inkRuntime.captureSelectionSnapshot();
  },
  observe() {
    const board = session.projection.board;
    const operation = session.currentOperation;
    if (!board || !operation) throw new Error("Teaching observation requires at least one playback operation");
    return collectTeachingObservation({
      viewport: mountedBoard.elements.viewport, world: mountedBoard.elements.world, board, operation, cursor: session.cursor,
    });
  },
  evaluate: evaluateTeachingObservation,
};

lessonSelect.addEventListener("change", () => void harnessApi.loadLesson(lessonSelect.value));
requireElement("#play-button").addEventListener("click", () => session.isPlaying ? session.pause() : session.play());
requireElement("#step-button").addEventListener("click", () => { session.step(); });
requireElement("#beat-button").addEventListener("click", () => session.advanceBeat());
requireElement("#reset-button").addEventListener("click", () => { session.reset(); boardView.fit(); });
requireElement<HTMLSelectElement>("#speed-select").addEventListener("change", (event) => session.setSpeed(Number((event.target as HTMLSelectElement).value)));
requireElement("#fit-button").addEventListener("click", () => boardView.fit());
requireElement("#zoom-in").addEventListener("click", () => boardView.zoomBy(1.18));
requireElement("#zoom-out").addEventListener("click", () => boardView.zoomBy(.84));
requireElement("#ink-enable").addEventListener("click", () => {
  void enableInk().catch((error) => {
    inkEnabled = false;
    latestInkError = error instanceof Error ? `笔迹加载失败：${error.message}` : "笔迹加载失败";
    const tools = requireElement<HTMLElement>("#ink-tools");
    tools.hidden = false;
    requireElement("#ink-status").textContent = latestInkError;
  });
});
requireElement("#ink-tools").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  const mode = button?.dataset.inkMode as InkMode | undefined;
  if (mode) inkRuntime?.setMode(mode);
  if (button?.dataset.inkAction === "undo") void inkRuntime?.undo();
  if (button?.dataset.inkAction === "redo") void inkRuntime?.redo();
  if (button?.dataset.inkAction === "select-all") inkRuntime?.selectAll();
  if (button?.dataset.inkAction === "snapshot" && inkRuntime) {
    void inkRuntime.captureSelectionSnapshot().then((snapshot) => {
      latestInkSource = snapshot;
      latestInkError = "";
      renderInkState(inkRuntime!.state);
    }).catch(() => {
      latestInkError = "请先框选学生笔迹";
      renderInkState(inkRuntime!.state);
    });
  }
});
requireElement<HTMLInputElement>("#ink-pen-color").addEventListener("input", (event) => {
  inkRuntime?.setPenColor((event.target as HTMLInputElement).value);
});
requireElement<HTMLInputElement>("#ink-selection-color").addEventListener("input", (event) => {
  void inkRuntime?.setSelectionColor((event.target as HTMLInputElement).value);
});
window.addEventListener("resize", () => boardView.fit());

void harnessApi.loadLesson(lessonSelect.value).catch((error) => { requireElement("#lesson-title").textContent = error instanceof Error ? error.message : String(error); });
