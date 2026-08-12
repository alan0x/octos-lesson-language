import {
  BaseTool,
  Editor,
  EditorEventType,
  EraserTool,
  Mat33,
  PanZoomTool,
  PenTool,
  SelectionMode,
  SelectionTool,
  Vec2,
  __js_draw__version,
  type AbstractComponent,
} from "js-draw";
import type { CameraState, InfiniteBoardView } from "../../web-runtime/src/index.js";
import {
  LocalInkDocumentStore,
  InkRuntimeError,
  assertInkDocumentIntegrity,
  createInkDocumentRecord,
  type InkDocumentRecord,
  type InkDocumentStore,
} from "./persistence.js";
import { createInkSelectionSnapshot, type InkSelectionSnapshot } from "./selection.js";

export type InkMode = "navigate" | "draw" | "erase" | "select";

export interface InkRuntimeState {
  mode: InkMode;
  component_count: number;
  selected_count: number;
  document_version: number;
  saved: boolean;
}

export interface MountInkRuntimeOptions {
  board: InfiniteBoardView;
  viewport: HTMLElement;
  storageKey: string;
  documentId: string;
  store?: InkDocumentStore;
  autosaveDelayMs?: number;
}

export class InkRuntime {
  readonly ready: Promise<void>;
  private editor: Editor;
  private modeValue: InkMode = "navigate";
  private selectedComponents: AbstractComponent[] = [];
  private documentVersion = 0;
  private savedSvg = "";
  private changeRevision = 0;
  private savedChangeRevision = 0;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saveQueue: Promise<InkDocumentRecord | null> = Promise.resolve(null);
  private restoreFailure?: unknown;
  private suppressSave = false;
  private readonly listeners = new Set<(state: InkRuntimeState) => void>();
  private readonly unsubscribeCamera: () => void;

  private constructor(
    private readonly options: MountInkRuntimeOptions,
    private readonly host: HTMLElement,
  ) {
    this.editor = this.createEditor();
    this.prepareEditor();
    this.unsubscribeCamera = options.board.subscribeCamera((camera) => this.syncCamera(camera));
    this.setMode("navigate");
    this.ready = this.restoreSavedDocument().catch((cause) => {
      this.restoreFailure = cause;
      throw cause;
    });
  }

  static mount(options: MountInkRuntimeOptions): InkRuntime {
    const host = options.viewport.ownerDocument.createElement("div");
    host.className = "oll-ink-layer";
    host.dataset.ollInkLayer = "";
    options.viewport.append(host);
    for (const eventName of ["pointerdown", "pointermove", "pointerup", "wheel"] as const) {
      host.addEventListener(eventName, (event) => event.stopPropagation());
    }
    return new InkRuntime(options, host);
  }

  private createEditor(): Editor {
    return new Editor(this.host, {
      wheelEventsEnabled: false,
      minZoom: .15,
      maxZoom: 2.2,
      appInfo: { name: "Octos student ink" },
    });
  }

  private get store(): InkDocumentStore { return this.options.store ?? new LocalInkDocumentStore(); }
  private get autosaveDelay(): number { return Math.max(0, this.options.autosaveDelayMs ?? 420); }

  private getTool<T extends BaseTool>(tool: new (...args: any[]) => T): T {
    const match = this.editor.toolController.getMatchingTools(tool)[0];
    if (!match) throw new Error(`js-draw did not provide ${tool.name}`);
    return match;
  }

  private prepareEditor(): void {
    for (const tool of this.editor.toolController.getMatchingTools(PanZoomTool)) tool.setEnabled(false);
    for (const pen of this.editor.toolController.getMatchingTools(PenTool)) {
      pen.setPressureSensitivityEnabled(true);
      pen.setStrokeAutocorrectEnabled(false);
    }
    this.editor.notifier.on(EditorEventType.SelectionUpdated, (event) => {
      if (event.kind !== EditorEventType.SelectionUpdated) return;
      this.selectedComponents = [...event.selectedComponents];
      this.emit();
    });
    this.editor.notifier.on(EditorEventType.CommandDone, (event) => {
      if (event.kind !== EditorEventType.CommandDone || this.suppressSave) return;
      this.changeRevision += 1;
      this.scheduleSave();
      this.emit();
    });
    this.editor.notifier.on(EditorEventType.CommandUndone, (event) => {
      if (event.kind !== EditorEventType.CommandUndone || this.suppressSave) return;
      this.changeRevision += 1;
      this.scheduleSave();
      this.emit();
    });
  }

  private syncCamera(camera: CameraState): void {
    this.editor.viewport.resetTransform(
      Mat33.translation(Vec2.of(camera.panX, camera.panY)).rightMul(Mat33.scaling2D(camera.scale)),
    );
  }

  private async restoreSavedDocument(): Promise<void> {
    const record = await this.store.load(this.options.storageKey);
    if (!record) {
      this.savedSvg = this.editor.toSVG().outerHTML;
      this.emit();
      return;
    }
    await assertInkDocumentIntegrity(record);
    if (record.document_id !== this.options.documentId) {
      throw new InkRuntimeError("INK_INVALID_RECORD", "Saved ink document belongs to a different session");
    }
    this.suppressSave = true;
    try { await this.editor.loadFromSVG(record.svg); }
    finally { this.suppressSave = false; }
    this.documentVersion = record.document_version;
    this.savedSvg = this.editor.toSVG().outerHTML;
    this.syncCamera(this.options.board.getCameraState());
    this.emit();
  }

  get state(): InkRuntimeState {
    return {
      mode: this.modeValue,
      component_count: this.editor.image.getAllComponents().length,
      selected_count: this.selectedComponents.length,
      document_version: this.documentVersion,
      saved: this.changeRevision === this.savedChangeRevision,
    };
  }

  subscribe(listener: (state: InkRuntimeState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setMode(mode: InkMode): void {
    this.modeValue = mode;
    this.host.style.pointerEvents = mode === "navigate" ? "none" : "auto";
    this.options.board.setInputOwner(mode === "navigate" ? "runtime" : "ink");
    if (mode === "draw") this.getTool(PenTool).setEnabled(true);
    if (mode === "erase") this.getTool(EraserTool).setEnabled(true);
    if (mode === "select") {
      const selection = this.getTool(SelectionTool);
      selection.modeValue.set(SelectionMode.Rectangle);
      selection.setEnabled(true);
    }
    this.emit();
  }

  undo(): void | Promise<void> { return this.editor.history.undo(); }
  redo(): void | Promise<void> { return this.editor.history.redo(); }

  selectAll(): void {
    const selection = this.getTool(SelectionTool);
    selection.setEnabled(true);
    selection.setSelection(this.editor.image.getAllComponents());
  }

  clearSelection(): void { this.getTool(SelectionTool).clearSelection(); }

  saveNow(): Promise<InkDocumentRecord | null> {
    if (this.restoreFailure) return Promise.reject(this.restoreFailure);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const svg = this.editor.toSVG().outerHTML;
    const revision = this.changeRevision;
    this.saveQueue = this.saveQueue.then(async () => {
      if (svg === this.savedSvg) {
        if (this.changeRevision === revision) this.savedChangeRevision = revision;
        this.emit();
        return null;
      }
      const record = await createInkDocumentRecord({
        documentId: this.options.documentId,
        documentVersion: this.documentVersion + 1,
        editorVersion: __js_draw__version.number,
        svg,
      });
      await this.store.save(this.options.storageKey, record);
      this.documentVersion = record.document_version;
      this.savedSvg = svg;
      if (this.changeRevision === revision) this.savedChangeRevision = revision;
      this.emit();
      return record;
    });
    return this.saveQueue;
  }

  async captureSelectionSnapshot(): Promise<InkSelectionSnapshot> {
    await this.saveNow();
    return createInkSelectionSnapshot({
      components: this.selectedComponents,
      documentId: this.options.documentId,
      documentVersion: this.documentVersion,
    });
  }

  serialize(): string { return this.editor.toSVG().outerHTML; }

  async destroy(): Promise<void> {
    try { await this.ready; }
    catch { /* Keep a failed restore read-only; never replace the saved source. */ }
    if (!this.restoreFailure) await this.saveNow();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.unsubscribeCamera();
    this.options.board.setInputOwner("runtime");
    this.listeners.clear();
    this.editor.remove();
    this.host.remove();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.saveNow(); }, this.autosaveDelay);
  }

  private emit(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
}

export function mountInkRuntime(options: MountInkRuntimeOptions): InkRuntime {
  return InkRuntime.mount(options);
}
