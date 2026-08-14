import {
  BaseTool,
  Color4,
  Editor,
  EditorEventType,
  EraserTool,
  getLocalizationTable,
  isRestylableComponent,
  Mat33,
  PanZoomTool,
  PenTool,
  Pointer,
  PointerDevice,
  InputEvtType,
  SelectionMode,
  SelectionTool,
  uniteCommands,
  Vec2,
  __js_draw__version,
  type AbstractComponent,
} from "js-draw";
import type {
  InfiniteBoardView,
  StudentInputMethod,
} from "../../web-runtime/src/index.js";
import {
  LocalInkDocumentStore,
  InkRuntimeError,
  assertInkDocumentIntegrity,
  createInkDocumentRecord,
  type InkDocumentRecord,
  type InkDocumentStore,
} from "./persistence.js";
import { createInkSelectionSnapshot } from "./selection.js";
import type { InkSelectionSnapshot } from "./selection-record.js";
import {
  lockSelectionTransform,
  type LockableSelectionTool,
} from "./selection-lock.js";
import {
  planInkWorldLayerBounds,
  viewportPointToInkSurface,
  type InkWorldLayerBounds,
} from "./world-layer.js";

export type InkMode = "navigate" | "draw" | "erase" | "select";

export interface InkRuntimeState {
  mode: InkMode;
  component_count: number;
  selected_count: number;
  pen_color: string;
  selection_color: string | null;
  selection_input: StudentInputMethod;
  document_version: number;
  saved: boolean;
}

export interface MountInkRuntimeOptions {
  board: InfiniteBoardView;
  viewport: HTMLElement;
  storageKey: string;
  documentId: string;
  locale?: string;
  store?: InkDocumentStore;
  autosaveDelayMs?: number;
}

export class InkRuntime {
  readonly ready: Promise<void>;
  private editor: Editor;
  private modeValue: InkMode = "navigate";
  private selectedComponents: AbstractComponent[] = [];
  private penColor = "#176b62";
  private selectionInput: StudentInputMethod = "unknown";
  private documentVersion = 0;
  private savedSvg = "";
  private changeRevision = 0;
  private savedChangeRevision = 0;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saveQueue: Promise<InkDocumentRecord | null> = Promise.resolve(null);
  private destroyPromise?: Promise<void>;
  private restoreFailure?: unknown;
  private suppressSave = false;
  private layerBounds: InkWorldLayerBounds;
  private expectedViewportTransform = Mat33.identity;
  private readonly activePointers = new Map<number, Pointer>();
  private readonly listeners = new Set<(state: InkRuntimeState) => void>();
  private readonly unmountWorldLayer: () => void;
  private readonly removeInputListeners: () => void;
  private readonly unsubscribeCamera: () => void;

  private constructor(
    private readonly options: MountInkRuntimeOptions,
    private readonly host: HTMLElement,
    layerBounds: InkWorldLayerBounds,
    unmountWorldLayer: () => void,
  ) {
    this.layerBounds = layerBounds;
    this.editor = this.createEditor();
    this.prepareEditor();
    this.unmountWorldLayer = unmountWorldLayer;
    this.removeInputListeners = this.prepareBoardInput();
    this.unsubscribeCamera = options.board.subscribeCamera((camera) => {
      this.updateWorldLayer(camera);
    });
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
    const layerBounds = planInkWorldLayerBounds({
      camera: options.board.getCameraState(),
      viewport: {
        width: options.viewport.clientWidth,
        height: options.viewport.clientHeight,
      },
    });
    InkRuntime.applyWorldLayerBounds(host, layerBounds);
    const unmountWorldLayer = options.board.mountWorldLayer(host);
    try {
      return new InkRuntime(options, host, layerBounds, unmountWorldLayer);
    } catch (cause) {
      unmountWorldLayer();
      throw cause;
    }
  }

  private static applyWorldLayerBounds(host: HTMLElement, bounds: InkWorldLayerBounds): void {
    host.style.left = `${bounds.left}px`;
    host.style.top = `${bounds.top}px`;
    host.style.width = `${bounds.width}px`;
    host.style.height = `${bounds.height}px`;
  }

  private createEditor(): Editor {
    const documentLocale = this.host.ownerDocument.documentElement.lang;
    const userLocales = this.options.locale
      ? [this.options.locale]
      : documentLocale
        ? [documentLocale]
        : this.host.ownerDocument.defaultView?.navigator.languages;
    return new Editor(this.host, {
      wheelEventsEnabled: false,
      minZoom: .15,
      maxZoom: 2.2,
      localization: getLocalizationTable(userLocales),
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
    this.enableInfiniteCanvas();
    this.resetEditorViewport();
    for (const tool of this.editor.toolController.getMatchingTools(PanZoomTool)) tool.setEnabled(false);
    for (const pen of this.editor.toolController.getMatchingTools(PenTool)) {
      pen.setPressureSensitivityEnabled(true);
      pen.setStrokeAutocorrectEnabled(false);
    }
    this.getTool(PenTool).setColor(Color4.fromHex(this.penColor));
    this.editor.notifier.on(EditorEventType.SelectionUpdated, (event) => {
      if (event.kind !== EditorEventType.SelectionUpdated) return;
      this.selectedComponents = [...event.selectedComponents];
      lockSelectionTransform(this.getTool(SelectionTool) as unknown as LockableSelectionTool);
      this.emit();
    });
    this.editor.notifier.on(EditorEventType.ViewportChanged, () => {
      // Selection and imported documents can ask js-draw to zoom. Ignore that:
      // Octos' world is the only camera and this nested viewport is fixed.
      if (!this.editor.viewport.canvasToScreenTransform.eq(this.expectedViewportTransform, 1e-6)) {
        this.editor.viewport.resetTransform(this.expectedViewportTransform);
      }
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

  private resetEditorViewport(): void {
    this.expectedViewportTransform = Mat33.translation(
      Vec2.of(-this.layerBounds.left, -this.layerBounds.top),
    );
    this.editor.viewport.resetTransform(this.expectedViewportTransform);
  }

  private updateWorldLayer(camera: { panX: number; panY: number; scale: number }): void {
    const nextBounds = planInkWorldLayerBounds({
      camera,
      viewport: {
        width: this.options.viewport.clientWidth,
        height: this.options.viewport.clientHeight,
      },
      current: this.layerBounds,
    });
    if (nextBounds !== this.layerBounds) {
      this.layerBounds = nextBounds;
      InkRuntime.applyWorldLayerBounds(this.host, nextBounds);
      this.resetEditorViewport();
    }
    const hostWindow = this.options.viewport.ownerDocument.defaultView;
    if (hostWindow) {
      const effectivePixelRatio = Math.max(.1, Math.min(4, hostWindow.devicePixelRatio * camera.scale));
      void this.editor.display.setDevicePixelRatio(effectivePixelRatio);
    }
  }

  private prepareBoardInput(): () => void {
    const inputTarget = this.options.viewport;
    const listeners: Array<[string, EventListener]> = [];
    const add = (name: string, listener: EventListener) => {
      inputTarget.addEventListener(name, listener);
      listeners.push([name, listener]);
    };
    const pointerDevice = (event: PointerEvent): PointerDevice => {
      if (event.pointerType === "pen" && (event.buttons & 0x20) !== 0) return PointerDevice.Eraser;
      if (event.pointerType === "pen") return PointerDevice.Pen;
      if (event.pointerType === "touch") return PointerDevice.Touch;
      if (event.pointerType === "mouse" && (event.buttons & 0x2) !== 0) return PointerDevice.RightButtonMouse;
      if (event.pointerType === "mouse") return PointerDevice.PrimaryButtonMouse;
      return PointerDevice.Other;
    };
    const mappedPointer = (event: PointerEvent, down: boolean): Pointer => {
      const viewportRect = this.options.viewport.getBoundingClientRect();
      const camera = this.options.board.getCameraState();
      const surfacePoint = viewportPointToInkSurface(
        { x: event.clientX - viewportRect.left, y: event.clientY - viewportRect.top },
        camera,
        this.layerBounds,
      );
      return Pointer.ofCanvasPoint(
        Vec2.of(surfacePoint.x + this.layerBounds.left, surfacePoint.y + this.layerBounds.top),
        down,
        this.editor.viewport,
        event.pointerId,
        pointerDevice(event),
        event.isPrimary,
        event.pressure,
        event.timeStamp,
      );
    };
    const allPointers = (): Pointer[] => [...this.activePointers.values()];
    const onPointerDown = (rawEvent: Event) => {
      if (this.modeValue === "navigate") return;
      const event = rawEvent as PointerEvent;
      if (this.modeValue === "select") {
        this.selectionInput = event.pointerType === "touch"
          ? "touch"
          : event.pointerType === "pen"
            ? "pen"
            : event.pointerType === "mouse"
              ? "mouse"
              : "unknown";
      }
      event.preventDefault();
      event.stopPropagation();
      const pointer = mappedPointer(event, true);
      this.activePointers.set(pointer.id, pointer);
      try { inputTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic tests may not support capture. */ }
      this.editor.display.onPointerEvent(event);
      this.editor.toolController.dispatchInputEvent({
        kind: InputEvtType.PointerDownEvt,
        current: pointer,
        allPointers: allPointers(),
      });
    };
    const onPointerMove = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      const previous = this.activePointers.get(event.pointerId);
      if (!previous) return;
      event.preventDefault();
      event.stopPropagation();
      const pointer = mappedPointer(event, true);
      this.activePointers.set(pointer.id, pointer);
      this.editor.display.onPointerEvent(event);
      this.editor.toolController.dispatchInputEvent({
        kind: InputEvtType.PointerMoveEvt,
        current: pointer,
        allPointers: allPointers(),
      });
    };
    const onPointerUp = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (!this.activePointers.has(event.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();
      const pointer = mappedPointer(event, false);
      this.activePointers.set(pointer.id, pointer);
      this.editor.display.onPointerEvent(event);
      this.editor.toolController.dispatchInputEvent({
        kind: InputEvtType.PointerUpEvt,
        current: pointer,
        allPointers: allPointers(),
      });
      this.activePointers.delete(pointer.id);
      try { inputTarget.releasePointerCapture(event.pointerId); } catch { /* Synthetic tests may not support capture. */ }
    };
    add("pointerdown", onPointerDown);
    add("pointermove", onPointerMove);
    add("pointerup", onPointerUp);
    add("pointercancel", onPointerUp);
    add("contextmenu", (event) => {
      if (this.modeValue !== "navigate") event.preventDefault();
    });
    return () => {
      for (const [name, listener] of listeners) inputTarget.removeEventListener(name, listener);
      this.activePointers.clear();
    };
  }

  private enableInfiniteCanvas(): void {
    // js-draw uses a fixed export rectangle by default and renders that rectangle
    // as a grey page boundary. Student ink lives on Octos' infinite board, so its
    // export bounds must follow the ink instead of appearing as a separate page.
    this.editor.dispatchNoAnnounce(this.editor.image.setAutoresizeEnabled(true), false);
  }

  private getSelectionColor(): string | null {
    const colors = this.selectedComponents.flatMap((component) => {
      if (!isRestylableComponent(component)) return [];
      const color = component.getStyle().color;
      return color ? [color] : [];
    });
    return colors.length > 0 ? Color4.average(colors).toHexString().slice(0, 7) : null;
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
    try {
      await this.editor.loadFromSVG(record.svg);
      // Documents saved before infinite-canvas mode may restore js-draw's fixed
      // export rectangle. Normalize them without adding an undoable user action.
      this.enableInfiniteCanvas();
    }
    finally { this.suppressSave = false; }
    this.documentVersion = record.document_version;
    this.savedSvg = this.editor.toSVG().outerHTML;
    this.resetEditorViewport();
    this.emit();
  }

  get state(): InkRuntimeState {
    return {
      mode: this.modeValue,
      component_count: this.editor.image.getAllComponents().filter((component) => component.isSelectable()).length,
      selected_count: this.selectedComponents.length,
      pen_color: this.penColor,
      selection_color: this.getSelectionColor(),
      selection_input: this.selectionInput,
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
    this.options.board.setInputOwner(mode === "navigate" ? "runtime" : "ink");
    for (const pen of this.editor.toolController.getMatchingTools(PenTool)) pen.setEnabled(false);
    for (const eraser of this.editor.toolController.getMatchingTools(EraserTool)) eraser.setEnabled(false);
    for (const selection of this.editor.toolController.getMatchingTools(SelectionTool)) selection.setEnabled(false);
    if (mode !== "select") this.selectedComponents = [];
    if (mode === "draw") this.getTool(PenTool).setEnabled(true);
    if (mode === "erase") this.getTool(EraserTool).setEnabled(true);
    if (mode === "select") {
      const selection = this.getTool(SelectionTool);
      selection.modeValue.set(SelectionMode.Rectangle);
      selection.setEnabled(true);
      lockSelectionTransform(selection as unknown as LockableSelectionTool);
    }
    this.emit();
  }

  undo(): void | Promise<void> { return this.editor.history.undo(); }
  redo(): void | Promise<void> { return this.editor.history.redo(); }

  selectAll(): void {
    if (this.modeValue !== "select") this.setMode("select");
    const selection = this.getTool(SelectionTool);
    selection.setEnabled(true);
    selection.setSelection(this.editor.image.getAllComponents());
  }

  clearSelection(): void { this.getTool(SelectionTool).clearSelection(); }

  setPenColor(color: string): void {
    const parsed = Color4.fromHex(color);
    this.penColor = parsed.toHexString().slice(0, 7);
    this.getTool(PenTool).setColor(parsed);
    this.emit();
  }

  setSelectionColor(color: string): void | Promise<void> {
    const parsed = Color4.fromHex(color);
    const commands = this.selectedComponents.flatMap((component) =>
      isRestylableComponent(component) ? [component.updateStyle({ color: parsed })] : [],
    );
    if (commands.length === 0) return;
    return this.editor.dispatch(uniteCommands(commands));
  }

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

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.unsubscribeCamera();
    this.removeInputListeners();
    this.options.board.setInputOwner("runtime");
    this.destroyPromise = (async () => {
      try { await this.ready; }
      catch { /* Keep a failed restore read-only; never replace the saved source. */ }
      let saveFailure: unknown;
      try {
        if (!this.restoreFailure) await this.saveNow();
      } catch (cause) {
        saveFailure = cause;
      } finally {
        this.listeners.clear();
        this.editor.remove();
        this.unmountWorldLayer();
      }
      if (saveFailure) throw saveFailure;
    })();
    return this.destroyPromise;
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
