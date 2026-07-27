import type { CanonicalEvent } from "../../../packages/core/src/index.js";
import "../../../packages/web-runtime/styles.css";
import {
  BrowserLessonSession,
  LocalPlaybackStore,
  mountInfiniteBoard,
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
  { id: "quadratic-v1", label: "探针 · 二次函数配方法 V1", path: "/examples/quadratic/lesson.canonical.jsonl" },
  { id: "geometry", label: "数学 · 几何辅助线 V2", path: "/examples/geometry-auxiliary-line-v2/lesson.canonical.jsonl" },
  { id: "geometry-v1", label: "回归 · 几何辅助线 V1", path: "/examples/geometry-auxiliary-line/lesson.canonical.jsonl" },
  { id: "science", label: "科学 · 植物蒸腾作用 V2", path: "/examples/science-transpiration-v2/lesson.canonical.jsonl" },
  { id: "english", label: "语言 · 英语定语从句 V2", path: "/examples/english-relative-clause-v2/lesson.canonical.jsonl" },
  { id: "english-v1", label: "探针 · 英语定语从句 V1", path: "/examples/english-relative-clause/lesson.canonical.jsonl" },
];
const selectedLessonKey = "oll-harness:selected-lesson";
const requestedLessonId = new URLSearchParams(window.location.search).get("lesson");

declare global {
  interface Window {
    __OLL_HARNESS__: {
      ready: boolean;
      lessonIds: string[];
      loadLesson(id: string): Promise<void>;
      reset(): void;
      advance(): unknown;
      advanceBeat(): void;
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
const store = new LocalPlaybackStore();
let session: BrowserLessonSession;
let events: CanonicalEvent[] = [];
let unsubscribe: (() => void) | undefined;

async function loadLesson(id: string): Promise<void> {
  const fixture = fixtures.find((item) => item.id === id) ?? fixtures[0]!;
  localStorage.setItem(selectedLessonKey, fixture.id);
  const response = await fetch(fixture.path);
  if (!response.ok) throw new Error(`Failed to load ${fixture.path}: ${response.status}`);
  events = parseCanonicalJsonl(await response.text());
  unsubscribe?.(); session?.pause();
  session = new BrowserLessonSession(events, store, `oll-harness:${events[0]!.lesson_id}`);
  unsubscribe = session.subscribe(render);
  render();
  requestAnimationFrame(() => boardView.fit());
}

function render(): void {
  const projection = session.projection;
  const operation = session.currentOperation;
  boardView.render(projection.board, operation);
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
window.addEventListener("resize", () => boardView.fit());

void harnessApi.loadLesson(lessonSelect.value).catch((error) => { requireElement("#lesson-title").textContent = error instanceof Error ? error.message : String(error); });
