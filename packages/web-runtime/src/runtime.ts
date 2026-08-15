import type { AuthoringStudentTask, CanonicalEvent, Delivery } from "../../core/src/index.js";
import {
  HeadlessLessonPlayer,
  type PlaybackAppendResult,
  type PlaybackCheckpoint,
  type PlaybackFrame,
  type PlaybackOutlineStep,
  type PlaybackOperation,
  type PlaybackProjection,
  type PlaybackVariableAnimation,
} from "../../player-core/src/index.js";
import {
  createStudentScene3dViewOperation,
  createStudentInkSelectionOperation,
  emptyStudentOperationLog,
  parseStudentOperationLog,
  type StudentInkSelectionOperation,
  type StudentInkSelectionSource,
  type StudentInputMethod,
  type StudentOperation,
  type StudentOperationLog,
  type StudentScene3dControl,
  type StudentScene3dViewOperation,
  type StudentScene3dViewState,
  type StudentVariableOperation,
  type StudentVariableOperationContext,
} from "./student-operations.js";
import {
  emptyStudentTaskProgressLog,
  evaluateStudentTaskOperation,
  parseStudentTaskProgressLog,
  taskSnapshots,
  type StudentTaskProgressLog,
  type StudentTaskSnapshot,
} from "./student-tasks.js";

export interface PlaybackStore {
  load(key: string): PlaybackCheckpoint | undefined;
  save(key: string, checkpoint: PlaybackCheckpoint): void;
  remove(key: string): void;
  loadStudentOperations?(key: string): unknown;
  saveStudentOperations?(key: string, log: StudentOperationLog): void;
  removeStudentOperations?(key: string): void;
  loadStudentTaskProgress?(key: string): unknown;
  saveStudentTaskProgress?(key: string, log: StudentTaskProgressLog): void;
  removeStudentTaskProgress?(key: string): void;
}

export class LocalPlaybackStore implements PlaybackStore {
  load(key: string): PlaybackCheckpoint | undefined {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as PlaybackCheckpoint : undefined; } catch { return undefined; }
  }
  save(key: string, checkpoint: PlaybackCheckpoint): void { try { localStorage.setItem(key, JSON.stringify(checkpoint)); } catch {} }
  remove(key: string): void { try { localStorage.removeItem(key); } catch {} }
  loadStudentOperations(key: string): unknown {
    try {
      const value = localStorage.getItem(`${key}:student-operations:v1`);
      return value ? JSON.parse(value) : undefined;
    } catch {
      this.removeStudentOperations(key);
      return undefined;
    }
  }
  saveStudentOperations(key: string, log: StudentOperationLog): void {
    try { localStorage.setItem(`${key}:student-operations:v1`, JSON.stringify(log)); } catch {}
  }
  removeStudentOperations(key: string): void {
    try { localStorage.removeItem(`${key}:student-operations:v1`); } catch {}
  }
  loadStudentTaskProgress(key: string): unknown {
    try {
      const value = localStorage.getItem(`${key}:student-task-progress:v1`);
      return value ? JSON.parse(value) : undefined;
    } catch {
      this.removeStudentTaskProgress(key);
      return undefined;
    }
  }
  saveStudentTaskProgress(key: string, log: StudentTaskProgressLog): void {
    try { localStorage.setItem(`${key}:student-task-progress:v1`, JSON.stringify(log)); } catch {}
  }
  removeStudentTaskProgress(key: string): void {
    try { localStorage.removeItem(`${key}:student-task-progress:v1`); } catch {}
  }
}

export function parseCanonicalJsonl(source: string): CanonicalEvent[] {
  return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as CanonicalEvent);
}

const MIN_NARRATION_MS = 1_800;
const MAX_NARRATION_MS = 45_000;

function normalizedSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function deliveryMultiplier(delivery?: Delivery): number {
  if (delivery === "careful") return 1.2;
  if (delivery === "patient") return 1.15;
  if (delivery === "emphatic") return 1.1;
  if (delivery === "encouraging") return 1.05;
  return 1;
}

/**
 * Estimate a learner-readable narration duration. This is deliberately a
 * teaching clock rather than a TTS synchronizer: the host may play audio in
 * parallel, while the Runtime guarantees that the caption and its Beat do not
 * disappear before a learner has had a reasonable chance to follow them.
 */
export function narrationDuration(
  text: string,
  delivery?: Delivery,
  speed = 1,
): number {
  const cjkCharacters = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
  const mathTokens = text.match(/(?:\d+(?:\.\d+)?|[=+\-×÷√∠△π²³])/g)?.length ?? 0;
  const shortPauses = text.match(/[,，、;；:：]/g)?.length ?? 0;
  const sentencePauses = text.match(/[.!?。！？]/g)?.length ?? 0;
  const estimated = (
    700
    + cjkCharacters * 170
    + latinWords * 300
    + mathTokens * 180
    + shortPauses * 100
    + sentencePauses * 220
  ) * deliveryMultiplier(delivery);
  const base = Math.min(MAX_NARRATION_MS, Math.max(MIN_NARRATION_MS, estimated));
  return Math.max(18, base / normalizedSpeed(speed));
}

function visibleContentLength(value: unknown): number {
  if (typeof value === "string") return [...value].length;
  if (typeof value === "number") return String(value).length;
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + visibleContentLength(item), 0);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce(
      (total, [key, item]) => total + (
        key === "id" || key.endsWith("_id") ? 0 : visibleContentLength(item)
      ),
      0,
    );
  }
  return 0;
}

function actionBaseDelay(operation: PlaybackOperation): number {
  const action = operation.action;
  if (!action) return 650;
  if (action.op === "board.create") {
    const kind = typeof action.node?.kind === "string" ? action.node.kind : "";
    const length = visibleContentLength(action.node?.content);
    if (kind === "math") return 1_100 + Math.min(2_200, length * 55);
    if (kind === "table") return 1_600 + Math.min(1_800, length * 12);
    if (["diagram", "plot", "image", "shape"].includes(kind)) return 1_800;
    if (kind === "text" || kind === "note") {
      return 700 + Math.min(1_700, length * 28);
    }
    return 1_000 + Math.min(1_200, length * 20);
  }
  if (action.op === "board.revise") {
    return 850 + Math.min(1_800, visibleContentLength(action.revision?.content) * 35);
  }
  if (action.op === "board.focus") return 900;
  if (action.op === "board.group") return 850;
  if (action.op === "board.connect") return 700;
  if (action.op === "board.emphasize") return 650;
  if (action.op === "teacher.point") return 450;
  if (action.op === "teacher.expression") return 500;
  return 650;
}

function operationBaseDelay(operation: PlaybackOperation): number {
  if (operation.type === "action.apply") return actionBaseDelay(operation);
  if (operation.type === "narration.begin") return 180;
  if (operation.type === "narration.end") return 160;
  if (operation.type === "beat.end") return 700;
  if (operation.type === "step.commit") return 1_200;
  if (operation.type === "step.begin") return 120;
  if (operation.type === "beat.begin") return 100;
  if (operation.type === "phase.begin" || operation.type === "phase.end") return 50;
  return 100;
}

export function operationDelay(operation: PlaybackOperation, speed = 1): number {
  return Math.max(18, operationBaseDelay(operation) / normalizedSpeed(speed));
}

export function variableAnimationDuration(
  intent: PlaybackVariableAnimation["duration_intent"],
  speed = 1,
): number {
  const duration = intent === "brief" ? 1_800 : intent === "extended" ? 5_400 : 3_200;
  return Math.max(32, duration / normalizedSpeed(speed));
}

export interface BrowserLessonSessionOptions {
  incremental?: boolean;
  /**
   * `estimated` advances from narration using the Runtime's reading budget.
   * `external` waits for the host audio player to call startNarration() before
   * during-speech actions and completeNarration() before the narration ends.
   */
  narrationTiming?: "estimated" | "external";
  reducedMotion?: boolean;
}

export class BrowserLessonSession {
  private player: HeadlessLessonPlayer;
  private timer?: ReturnType<typeof setTimeout>;
  private timerStartedAt?: number;
  private scheduledBaseDelay?: number;
  private scheduledSpeed = 1;
  private narrationRemainingBaseMs?: number;
  private startedExternalNarrationBeatId?: string;
  private completedExternalNarrationBeatId?: string;
  private playing = false;
  private followAppends = false;
  private speed = 1;
  private seekAttentionTargets: string[] = [];
  private currentFrame?: PlaybackFrame;
  private variableAnimation?: PlaybackVariableAnimation;
  private variableAnimationTimer?: ReturnType<typeof setTimeout>;
  private variableAnimationStartedAt?: number;
  private variableAnimationStartProgress = 0;
  private readonly listeners = new Set<() => void>();
  private studentOperationLog: StudentOperationLog;
  private readonly studentTaskDefinitions: AuthoringStudentTask[];
  private studentTaskProgressLog: StudentTaskProgressLog;
  private nextStudentOperationSequence = 1;
  private suppressStudentTaskEvaluation = false;
  private readonly pendingStudentVariableOperations = new Map<string, {
    sequence: number;
    alias: string;
    before: number;
    control: StudentVariableOperationContext["control"];
    input: StudentVariableOperationContext["input"];
  }>();
  private readonly pendingStudentScene3dOperations = new Map<string, {
    sequence: number;
    nodeId: string;
    before: StudentScene3dViewState;
    after: StudentScene3dViewState;
    control: StudentScene3dControl;
    input: StudentInputMethod;
  }>();

  constructor(
    readonly events: CanonicalEvent[],
    private readonly store: PlaybackStore,
    private readonly storageKey: string,
    private readonly options: BrowserLessonSessionOptions = {},
  ) {
    this.player = this.restorePlayer();
    this.studentOperationLog = this.restoreStudentOperations();
    this.studentTaskDefinitions = structuredClone(this.events[0]?.lesson?.tasks ?? []);
    this.studentTaskProgressLog = this.restoreStudentTaskProgress();
    this.nextStudentOperationSequence =
      (this.studentOperationLog.operations.at(-1)?.sequence ?? 0) + 1;
    if (this.player.cursor > 0) this.currentFrame = {
      operation: this.player.operations[this.player.cursor - 1]!,
      projection: this.player.snapshot,
    };
    const narration = this.player.snapshot.current_narration;
    if (narration && this.options.narrationTiming !== "external") {
      this.narrationRemainingBaseMs = narrationDuration(
        narration.text,
        narration.delivery,
      );
    }
  }

  get operations(): PlaybackOperation[] { return this.player.operations; }
  get cursor(): number { return this.player.cursor; }
  get projection(): PlaybackProjection { return this.player.snapshot; }
  get outline(): PlaybackOutlineStep[] { return this.player.outline; }
  get currentOperation(): PlaybackOperation | undefined { return this.currentFrame?.operation; }
  get attentionTargets(): string[] { return [...this.seekAttentionTargets]; }
  /**
   * The composition already declared by the current Beat's focus action.
   * Hosts may use this as a zero-delay camera hint while board content is
   * arriving; it does not apply another OLL action or change playback timing.
   */
  get compositionTargets(): string[] {
    const beatId = this.currentOperation?.beat_id ?? this.player.snapshot.current_beat_id;
    if (!beatId) return [];
    for (const step of this.player.outline) {
      const beat = step.beats.find((candidate) => candidate.id === beatId);
      if (beat) return [...beat.focus_targets];
    }
    return [];
  }
  get studentOperations(): StudentOperation[] { return structuredClone(this.studentOperationLog.operations); }
  get scene3dViews(): Record<string, StudentScene3dViewState> {
    const views: Record<string, StudentScene3dViewState> = {};
    for (const node of Object.values(this.player.snapshot.board?.nodes ?? {})) {
      if (node.kind === "scene3d") views[node.id] = structuredClone(node.content.camera);
    }
    for (const operation of this.studentOperationLog.operations) {
      if (operation.kind === "scene3d_view") {
        views[operation.target.node_id] = structuredClone(operation.after);
      }
    }
    return views;
  }
  get studentTasks(): StudentTaskSnapshot[] {
    return taskSnapshots(
      this.studentTaskDefinitions,
      this.studentTaskProgressLog,
      this.player.status === "completed",
    );
  }
  get isPlaying(): boolean { return this.playing; }
  get activeVariableAnimation(): PlaybackVariableAnimation | undefined { return this.variableAnimation ? structuredClone(this.variableAnimation) : undefined; }
  get status(): PlaybackProjection["status"] { return this.player.status === "playing" && !this.playing ? "paused" : this.player.status; }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setSpeed(speed: number): void {
    const nextSpeed = normalizedSpeed(speed);
    if (nextSpeed === this.speed) return;
    this.freezeScheduledDelay();
    this.freezeVariableAnimation();
    this.speed = nextSpeed;
    if (this.playing && this.variableAnimation) this.scheduleVariableAnimation();
    if (this.playing && this.scheduledBaseDelay !== undefined) {
      this.schedulePendingDelay();
    }
  }

  play(): void {
    if (this.player.status === "completed" || this.playing) return;
    this.followAppends = true;
    if (this.player.status === "waiting") {
      this.emit();
      return;
    }
    if (this.player.status === "paused") this.player.resume();
    this.playing = true;
    this.emit();
    if (this.variableAnimation) {
      this.scheduleVariableAnimation();
      return;
    }
    if (this.scheduledBaseDelay !== undefined) this.schedulePendingDelay();
    else this.tick();
  }

  pause(): void {
    this.freezeScheduledDelay();
    this.freezeVariableAnimation();
    this.playing = false;
    this.followAppends = false;
    if (this.player.cursor > 0 && this.player.status !== "completed") this.player.pause();
    this.persist();
    this.emit();
  }

  advance(): PlaybackFrame | undefined {
    if (this.player.status === "completed") return undefined;
    if (this.variableAnimation) this.completeVariableAnimation();
    if (this.player.status === "paused") this.player.resume();
    const nextOperation = this.player.operations[this.player.cursor];
    const animation = nextOperation?.action?.op === "lesson.variable.animate"
      ? nextOperation.action.animation
      : undefined;
    const from = animation
      ? this.player.snapshot.board?.variables?.[animation.variable]?.value
      : undefined;
    const frame = this.player.advance() ?? undefined;
    this.seekAttentionTargets = [];
    this.currentFrame = frame;
    if (frame?.operation.type === "narration.begin" && frame.operation.narration) {
      this.startedExternalNarrationBeatId = undefined;
      this.completedExternalNarrationBeatId = undefined;
      this.narrationRemainingBaseMs = this.options.narrationTiming === "external"
        ? undefined
        : narrationDuration(
            frame.operation.narration.text,
            frame.operation.narration.delivery,
          );
    } else if (frame?.operation.type === "narration.end") {
      this.narrationRemainingBaseMs = undefined;
      this.startedExternalNarrationBeatId = undefined;
      this.completedExternalNarrationBeatId = undefined;
    }
    if (
      frame?.operation.type === "action.apply"
      && frame.operation.action?.animation
      && from !== undefined
      && from !== frame.operation.action.animation.to
      && !this.options.reducedMotion
    ) {
      const declaration = frame.operation.action.animation;
      this.player.setVariable(declaration.variable, from);
      this.variableAnimation = {
        action_id: frame.operation.action.action_id,
        variable: declaration.variable,
        from,
        to: declaration.to,
        progress: 0,
        easing: declaration.easing,
        duration_intent: declaration.duration_intent,
      };
    }
    this.persist();
    this.emit();
    return frame;
  }

  step(): PlaybackFrame | undefined {
    this.pause();
    this.discardScheduledDelay();
    const frame = this.advance();
    this.pause();
    return frame;
  }

  advanceBeat(): void {
    this.pause();
    this.discardScheduledDelay();
    let frame: PlaybackFrame | undefined;
    do { frame = this.advance(); } while (frame && frame.operation.type !== "beat.end" && this.player.status !== "completed");
    if (this.player.status !== "completed" && this.player.status !== "waiting") this.pause();
  }

  /**
   * Release the externally timed start boundary for during-speech actions.
   * Stale starts are ignored so a late audio decode from an interrupted Beat
   * cannot release the current Beat.
   */
  startNarration(beatId: string): void {
    if (this.options.narrationTiming !== "external") return;
    if (
      !this.player.snapshot.current_narration ||
      this.player.snapshot.current_beat_id !== beatId
    ) {
      return;
    }
    const nextOperation = this.player.operations[this.player.cursor];
    const wasWaitingForStart =
      (nextOperation?.type === "phase.begin" &&
        nextOperation.phase === "during_speech") ||
      this.player.snapshot.current_phase === "during_speech";
    this.startedExternalNarrationBeatId = beatId;
    if (
      this.playing &&
      this.scheduledBaseDelay === undefined &&
      wasWaitingForStart
    ) {
      this.tick();
    }
  }

  /**
   * Release an externally timed narration boundary. Stale completions are
   * ignored so an interrupted clip from the previous Beat cannot advance the
   * current lesson. Completion also releases the start boundary so disabled
   * or failed audio can fall back to visible narration without deadlocking.
   */
  completeNarration(beatId: string): void {
    if (this.options.narrationTiming !== "external") return;
    if (
      !this.player.snapshot.current_narration ||
      this.player.snapshot.current_beat_id !== beatId
    ) {
      return;
    }
    this.startedExternalNarrationBeatId = beatId;
    this.completedExternalNarrationBeatId = beatId;
    const nextOperation = this.player.operations[this.player.cursor];
    const wasWaitingForStart =
      (nextOperation?.type === "phase.begin" &&
        nextOperation.phase === "during_speech") ||
      this.player.snapshot.current_phase === "during_speech";
    if (
      this.playing &&
      this.scheduledBaseDelay === undefined &&
      (nextOperation?.type === "narration.end" ||
        wasWaitingForStart)
    ) {
      this.tick();
    }
  }

  seek(cursor: number, attentionTargets: string[] = []): void {
    this.freezeScheduledDelay();
    this.discardScheduledDelay();
    this.playing = false;
    this.followAppends = false;
    this.narrationRemainingBaseMs = undefined;
    this.startedExternalNarrationBeatId = undefined;
    this.completedExternalNarrationBeatId = undefined;
    this.discardVariableAnimation();
    this.pendingStudentVariableOperations.clear();
    this.seekAttentionTargets = [...attentionTargets];
    const projection = this.player.seek(cursor);
    this.currentFrame = cursor > 0
      ? {
          operation: this.player.operations[cursor - 1]!,
          projection,
        }
      : undefined;
    const narration = projection.current_narration;
    if (narration && this.options.narrationTiming !== "external") {
      this.narrationRemainingBaseMs = narrationDuration(
        narration.text,
        narration.delivery,
      );
    }
    if (cursor === 0) this.store.remove(this.storageKey);
    else this.persist();
    this.emit();
  }

  seekToStep(
    stepId: string,
    boundary: "start" | "end" = "end",
  ): void {
    const step = this.outline.find((item) => item.id === stepId);
    if (!step) throw new RangeError(`Unknown lesson step '${stepId}'`);
    this.seek(
      boundary === "start" ? step.start_cursor : step.end_cursor,
      step.focus_targets,
    );
  }

  seekToBeat(
    beatId: string,
    boundary: "start" | "end" = "end",
  ): void {
    const beat = this.outline
      .flatMap((step) => step.beats)
      .find((item) => item.id === beatId);
    if (!beat) throw new RangeError(`Unknown lesson beat '${beatId}'`);
    this.seek(
      boundary === "start" ? beat.start_cursor : beat.end_cursor,
      beat.focus_targets,
    );
  }

  appendEvents(events: CanonicalEvent[]): PlaybackAppendResult {
    const result = this.player.appendEvents(events);
    if (result.accepted > 0) {
      this.events.splice(0, this.events.length, ...this.player.canonicalEvents);
      this.persist();
      this.emit();
      if (this.followAppends && !this.playing && this.player.status !== "completed") {
        if (this.player.status === "paused") this.player.resume();
        this.playing = true;
        this.emit();
        this.tick();
      }
    }
    return result;
  }

  reset(): void {
    this.pause();
    this.discardScheduledDelay();
    this.narrationRemainingBaseMs = undefined;
    this.startedExternalNarrationBeatId = undefined;
    this.completedExternalNarrationBeatId = undefined;
    this.seekAttentionTargets = [];
    this.discardVariableAnimation();
    this.pendingStudentVariableOperations.clear();
    this.store.remove(this.storageKey);
    this.player = new HeadlessLessonPlayer(this.events, { allowIncomplete: this.options.incremental });
    this.currentFrame = undefined;
    this.emit();
  }

  private tick(): void {
    if (!this.playing) return;
    const nextOperation = this.player.operations[this.player.cursor];
    if (
      this.options.narrationTiming === "external" &&
      this.player.snapshot.current_narration &&
      ((nextOperation?.type === "phase.begin" &&
        nextOperation.phase === "during_speech") ||
        this.player.snapshot.current_phase === "during_speech")
    ) {
      if (this.startedExternalNarrationBeatId !== nextOperation.beat_id) return;
    }
    if (
      nextOperation?.type === "narration.end" &&
      this.options.narrationTiming === "external"
    ) {
      if (this.completedExternalNarrationBeatId !== nextOperation.beat_id) return;
      this.startedExternalNarrationBeatId = undefined;
      this.completedExternalNarrationBeatId = undefined;
    }
    if (
      nextOperation?.type === "narration.end" &&
      this.options.narrationTiming !== "external" &&
      this.narrationRemainingBaseMs !== undefined &&
      this.narrationRemainingBaseMs > 0
    ) {
      this.scheduleBaseDelay(this.narrationRemainingBaseMs);
      return;
    }
    const frame = this.advance();
    if (!frame || this.player.status === "completed") {
      this.playing = false;
      if (this.player.status === "completed") this.followAppends = false;
      this.emit();
      return;
    }
    if (this.variableAnimation) {
      this.scheduleVariableAnimation();
      return;
    }
    this.scheduleBaseDelay(operationBaseDelay(frame.operation));
  }

  setVariable(alias: string, value: number): void {
    this.applyManualVariable(alias, value);
  }

  /**
   * Start one learner gesture. Reusing an already committed operationId is a
   * no-op so a host retry cannot duplicate the student's history.
   */
  beginStudentVariableOperation(
    alias: string,
    context: StudentVariableOperationContext,
  ): string {
    const variable = this.player.snapshot.board?.variables?.[alias];
    if (!variable) throw new Error(`Unknown lesson variable '${alias}'`);
    if (!Number.isFinite(variable.value)) throw new Error(`Lesson variable '${alias}' has no finite value`);
    if (!["slider", "geometry_point", "reset"].includes(context.control)) {
      throw new Error(`Unsupported student variable control '${String(context.control)}'`);
    }
    if (!["mouse", "touch", "pen", "keyboard", "unknown"].includes(context.input)) {
      throw new Error(`Unsupported student input method '${String(context.input)}'`);
    }
    const requestedId = context.operationId?.trim();
    if (context.operationId !== undefined && (!requestedId || requestedId.length > 256)) {
      throw new Error("Student operationId must be between 1 and 256 characters");
    }
    const id = requestedId
      ?? `${this.player.snapshot.lesson_id}:student-operation:${this.nextStudentOperationSequence}`;
    const completed = this.studentOperationLog.operations.find((operation) => operation.id === id);
    if (completed) {
      if (
        completed.kind !== "variable_change" ||
        completed.target.alias !== alias ||
        completed.control !== context.control ||
        completed.input !== context.input
      ) {
        throw new Error(`Student operationId '${id}' was already used for a different operation`);
      }
      return id;
    }
    const pending = this.pendingStudentVariableOperations.get(id);
    if (pending) {
      if (pending.alias !== alias || pending.control !== context.control || pending.input !== context.input) {
        throw new Error(`Student operationId '${id}' is already active for a different operation`);
      }
      return id;
    }
    const activeAlias = [...this.pendingStudentVariableOperations.entries()]
      .find(([, operation]) => operation.alias === alias);
    if (activeAlias) {
      const [activeId, operation] = activeAlias;
      if (operation.control === context.control && operation.input === context.input) return activeId;
      throw new Error(`Lesson variable '${alias}' already has an active student operation`);
    }
    const sequence = this.nextStudentOperationSequence;
    this.nextStudentOperationSequence += 1;
    this.pendingStudentVariableOperations.set(id, {
      sequence,
      alias,
      before: variable.value,
      control: context.control,
      input: context.input,
    });
    return id;
  }

  updateStudentVariableOperation(operationId: string, value: number): void {
    if (this.studentOperationLog.operations.some((operation) => operation.id === operationId)) return;
    const pending = this.pendingStudentVariableOperations.get(operationId);
    if (!pending) throw new Error(`Student operation '${operationId}' has not started`);
    this.applyManualVariable(pending.alias, value);
  }

  commitStudentVariableOperation(
    operationId: string,
    value?: number,
  ): StudentVariableOperation | undefined {
    const completed = this.studentOperationLog.operations.find((operation) => operation.id === operationId);
    if (completed) {
      if (completed.kind !== "variable_change") {
        throw new Error("Student operation ID is not a variable operation");
      }
      return structuredClone(completed);
    }
    const pending = this.pendingStudentVariableOperations.get(operationId);
    if (!pending) throw new Error(`Student operation '${operationId}' has not started`);
    if (value !== undefined) this.applyManualVariable(pending.alias, value);
    const after = this.player.snapshot.board?.variables?.[pending.alias]?.value;
    this.pendingStudentVariableOperations.delete(operationId);
    if (!Number.isFinite(after)) throw new Error(`Lesson variable '${pending.alias}' has no finite value`);
    if (Math.abs((after as number) - pending.before) <= 1e-12) return undefined;
    const operation: StudentVariableOperation = {
      profile: "octos.student.operation",
      version: "0.1",
      id: operationId,
      sequence: pending.sequence,
      lesson_id: this.player.snapshot.lesson_id,
      kind: "variable_change",
      target: { kind: "lesson_variable", alias: pending.alias },
      before: { value: pending.before },
      after: { value: after as number },
      control: pending.control,
      input: pending.input,
    };
    this.studentOperationLog.operations.push(operation);
    this.studentOperationLog.operations.sort((left, right) => left.sequence - right.sequence);
    this.persistStudentOperations();
    this.evaluateStudentTasks(operation);
    this.emit();
    return structuredClone(operation);
  }

  changeStudentVariable(
    alias: string,
    value: number,
    context: StudentVariableOperationContext,
  ): StudentVariableOperation | undefined {
    const operationId = this.beginStudentVariableOperation(alias, context);
    return this.commitStudentVariableOperation(operationId, value);
  }

  recordStudentInkSelection(
    source: StudentInkSelectionSource,
    input: StudentInputMethod,
  ): StudentInkSelectionOperation {
    const id = [
      this.player.snapshot.lesson_id,
      "ink-selection",
      source.source_id,
    ].join(":");
    const existing = this.studentOperationLog.operations.find(
      (operation) => operation.id === id,
    );
    if (existing) {
      if (
        existing.kind !== "ink_selection"
        || JSON.stringify(existing.target) !== JSON.stringify({
          kind: "ink_selection_source",
          ...source,
        })
        || existing.input !== input
      ) {
        throw new Error("Student selection source was already recorded differently");
      }
      return structuredClone(existing);
    }
    const operation = createStudentInkSelectionOperation({
      lessonId: this.player.snapshot.lesson_id,
      sequence: this.nextStudentOperationSequence,
      source,
      input,
    });
    this.nextStudentOperationSequence += 1;
    this.studentOperationLog.operations.push(operation);
    this.persistStudentOperations();
    this.emit();
    return structuredClone(operation);
  }

  handleStudentScene3dInput(
    nodeId: string,
    view: StudentScene3dViewState,
    event: {
      phase: "start" | "update" | "commit";
      control: StudentScene3dControl;
      input: StudentInputMethod;
      operation_id?: string;
    },
  ): string | StudentScene3dViewOperation | undefined {
    const node = this.player.snapshot.board?.nodes?.[nodeId];
    if (node?.kind !== "scene3d") throw new Error(`Unknown 3D scene '${nodeId}'`);
    if (![view.yaw, view.pitch, view.zoom].every(Number.isFinite)
      || view.pitch < -Math.PI / 2 || view.pitch > Math.PI / 2
      || view.zoom < .2 || view.zoom > 5) {
      throw new Error("Invalid 3D view state");
    }
    if (event.phase === "start") {
      const id = event.operation_id?.trim()
        || `${this.player.snapshot.lesson_id}:student-operation:${this.nextStudentOperationSequence}`;
      if (!id || id.length > 256) throw new Error("Student operationId must be between 1 and 256 characters");
      const completed = this.studentOperationLog.operations.find((operation) => operation.id === id);
      if (completed) {
        if (completed.kind !== "scene3d_view" || completed.target.node_id !== nodeId) {
          throw new Error(`Student operationId '${id}' was already used differently`);
        }
        return id;
      }
      if (!this.pendingStudentScene3dOperations.has(id)) {
        const sequence = this.nextStudentOperationSequence;
        this.nextStudentOperationSequence += 1;
        this.pendingStudentScene3dOperations.set(id, {
          sequence,
          nodeId,
          before: structuredClone(view),
          after: structuredClone(view),
          control: event.control,
          input: event.input,
        });
      }
      return id;
    }
    const id = event.operation_id?.trim();
    if (!id) throw new Error("3D view update requires operation_id");
    if (this.studentOperationLog.operations.some((operation) => operation.id === id)) {
      return this.studentOperationLog.operations.find(
        (operation): operation is StudentScene3dViewOperation =>
          operation.id === id && operation.kind === "scene3d_view",
      );
    }
    const pending = this.pendingStudentScene3dOperations.get(id);
    if (!pending || pending.nodeId !== nodeId) throw new Error(`3D operation '${id}' has not started`);
    pending.after = structuredClone(view);
    if (event.phase === "update") return id;
    this.pendingStudentScene3dOperations.delete(id);
    const unchanged = Math.abs(pending.before.yaw - view.yaw) <= 1e-12
      && Math.abs(pending.before.pitch - view.pitch) <= 1e-12
      && Math.abs(pending.before.zoom - view.zoom) <= 1e-12;
    if (unchanged) return undefined;
    const operation = createStudentScene3dViewOperation({
      lessonId: this.player.snapshot.lesson_id,
      sequence: pending.sequence,
      nodeId,
      before: pending.before,
      after: view,
      control: pending.control,
      input: pending.input,
      operationId: id,
    });
    this.studentOperationLog.operations.push(operation);
    this.studentOperationLog.operations.sort((left, right) => left.sequence - right.sequence);
    this.persistStudentOperations();
    this.evaluateStudentTasks(operation);
    this.emit();
    return structuredClone(operation);
  }

  requestStudentTaskHint(taskId: string): StudentTaskSnapshot {
    const definition = this.studentTaskDefinitions.find((task) => task.as === taskId);
    const progress = this.studentTaskProgressLog.tasks.find((task) => task.task_id === taskId);
    if (!definition || !progress) throw new Error(`Unknown student task '${taskId}'`);
    if (this.player.status !== "completed") throw new Error(`Student task '${taskId}' is not available before the lesson completes`);
    if (!this.studentTasks.find((task) => task.task_id === taskId)?.available) {
      throw new Error(`Student task '${taskId}' is not currently available`);
    }
    if (progress.status !== "succeeded") {
      progress.hints_revealed = Math.min(definition.hints.length, progress.hints_revealed + 1);
      progress.status = "needs_hint";
      this.persistStudentTaskProgress();
      this.emit();
    }
    return this.studentTasks.find((task) => task.task_id === taskId)!;
  }

  retryStudentTask(
    taskId: string,
    input: StudentVariableOperationContext["input"] = "unknown",
  ): StudentTaskSnapshot {
    const definition = this.studentTaskDefinitions.find((task) => task.as === taskId);
    const progress = this.studentTaskProgressLog.tasks.find((task) => task.task_id === taskId);
    if (!definition || !progress) throw new Error(`Unknown student task '${taskId}'`);
    if (this.player.status !== "completed") throw new Error(`Student task '${taskId}' is not available before the lesson completes`);
    if (!this.studentTasks.find((task) => task.task_id === taskId)?.available) {
      throw new Error(`Student task '${taskId}' is not currently available`);
    }
    this.suppressStudentTaskEvaluation = true;
    try {
      if (definition.completion.kind === "expression_target") {
        const variables = [...new Set(definition.allowed_operations.flatMap((operation) =>
          operation.kind === "variable_change" ? [operation.variable] : []))];
        for (const alias of variables) {
          const initial = this.player.snapshot.board?.variables?.[alias]?.initial;
          if (Number.isFinite(initial)) this.changeStudentVariable(alias, initial as number, { control: "reset", input });
        }
      } else {
        const nodeId = definition.completion.node;
        const node = this.player.snapshot.board?.nodes?.[nodeId];
        const current = this.scene3dViews[nodeId];
        const initial = node?.kind === "scene3d" ? node.content.camera as StudentScene3dViewState : undefined;
        if (current && initial) {
          const operationId = this.handleStudentScene3dInput(nodeId, current, {
            phase: "start", control: "reset", input,
          });
          if (typeof operationId === "string") {
            this.handleStudentScene3dInput(nodeId, initial, {
              phase: "commit", control: "reset", input, operation_id: operationId,
            });
          }
        }
      }
    } finally {
      this.suppressStudentTaskEvaluation = false;
    }
    progress.status = "not_started";
    this.persistStudentTaskProgress();
    this.emit();
    return this.studentTasks.find((task) => task.task_id === taskId)!;
  }

  private applyManualVariable(alias: string, value: number): void {
    this.pause();
    this.discardVariableAnimation();
    this.player.setVariable(alias, value);
    this.persist();
    this.emit();
  }

  private easedVariableProgress(animation: PlaybackVariableAnimation): number {
    if (animation.easing === "ease_in_out") {
      return animation.progress < .5
        ? 2 * animation.progress * animation.progress
        : 1 - (-2 * animation.progress + 2) ** 2 / 2;
    }
    return animation.progress;
  }

  private applyVariableAnimationProgress(progress: number): void {
    const animation = this.variableAnimation;
    if (!animation) return;
    animation.progress = Math.max(0, Math.min(1, progress));
    const eased = this.easedVariableProgress(animation);
    this.player.setVariable(animation.variable, animation.from + (animation.to - animation.from) * eased);
  }

  private scheduleVariableAnimation(): void {
    const animation = this.variableAnimation;
    if (!this.playing || !animation) return;
    if (this.variableAnimationTimer !== undefined) clearTimeout(this.variableAnimationTimer);
    this.variableAnimationStartProgress = animation.progress;
    this.variableAnimationStartedAt = Date.now();
    const duration = variableAnimationDuration(animation.duration_intent, this.speed);
    const remainingDuration = duration * (1 - animation.progress);
    const update = () => {
      const active = this.variableAnimation;
      if (!this.playing || !active || this.variableAnimationStartedAt === undefined) return;
      const elapsed = Math.max(0, Date.now() - this.variableAnimationStartedAt);
      const progress = this.variableAnimationStartProgress
        + (1 - this.variableAnimationStartProgress) * Math.min(1, elapsed / Math.max(1, remainingDuration));
      this.applyVariableAnimationProgress(progress);
      this.emit();
      if (progress >= 1) {
        this.variableAnimation = undefined;
        this.variableAnimationTimer = undefined;
        this.variableAnimationStartedAt = undefined;
        this.persist();
        this.scheduleBaseDelay(180);
        return;
      }
      this.variableAnimationTimer = setTimeout(update, 16);
    };
    this.variableAnimationTimer = setTimeout(update, 16);
  }

  private freezeVariableAnimation(): void {
    if (!this.variableAnimation || this.variableAnimationStartedAt === undefined) return;
    const duration = variableAnimationDuration(this.variableAnimation.duration_intent, this.speed);
    const remainingDuration = duration * (1 - this.variableAnimationStartProgress);
    const elapsed = Math.max(0, Date.now() - this.variableAnimationStartedAt);
    const progress = this.variableAnimationStartProgress
      + (1 - this.variableAnimationStartProgress) * Math.min(1, elapsed / Math.max(1, remainingDuration));
    this.applyVariableAnimationProgress(progress);
    if (this.variableAnimationTimer !== undefined) clearTimeout(this.variableAnimationTimer);
    this.variableAnimationTimer = undefined;
    this.variableAnimationStartedAt = undefined;
  }

  private completeVariableAnimation(): void {
    const animation = this.variableAnimation;
    if (!animation) return;
    if (this.variableAnimationTimer !== undefined) clearTimeout(this.variableAnimationTimer);
    this.player.setVariable(animation.variable, animation.to);
    this.variableAnimation = undefined;
    this.variableAnimationTimer = undefined;
    this.variableAnimationStartedAt = undefined;
  }

  private discardVariableAnimation(): void {
    if (this.variableAnimationTimer !== undefined) clearTimeout(this.variableAnimationTimer);
    this.variableAnimation = undefined;
    this.variableAnimationTimer = undefined;
    this.variableAnimationStartedAt = undefined;
  }

  private scheduleBaseDelay(baseDelay: number): void {
    this.scheduledBaseDelay = Math.max(0, baseDelay);
    this.schedulePendingDelay();
  }

  private schedulePendingDelay(): void {
    if (!this.playing || this.scheduledBaseDelay === undefined) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.scheduledSpeed = this.speed;
    this.timerStartedAt = Date.now();
    const delay = Math.max(18, this.scheduledBaseDelay / this.scheduledSpeed);
    this.timer = setTimeout(() => {
      const consumed = this.scheduledBaseDelay ?? 0;
      this.consumeNarrationTime(consumed);
      this.timer = undefined;
      this.timerStartedAt = undefined;
      this.scheduledBaseDelay = undefined;
      this.tick();
    }, delay);
  }

  private freezeScheduledDelay(): void {
    if (
      this.timer === undefined ||
      this.timerStartedAt === undefined ||
      this.scheduledBaseDelay === undefined
    ) return;
    const elapsed = Math.max(0, Date.now() - this.timerStartedAt);
    const consumed = Math.min(
      this.scheduledBaseDelay,
      elapsed * this.scheduledSpeed,
    );
    this.scheduledBaseDelay -= consumed;
    this.consumeNarrationTime(consumed);
    clearTimeout(this.timer);
    this.timer = undefined;
    this.timerStartedAt = undefined;
    if (this.scheduledBaseDelay <= 0) this.scheduledBaseDelay = undefined;
  }

  private discardScheduledDelay(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.timerStartedAt = undefined;
    this.scheduledBaseDelay = undefined;
  }

  private consumeNarrationTime(baseDuration: number): void {
    if (this.narrationRemainingBaseMs === undefined) return;
    this.narrationRemainingBaseMs = Math.max(
      0,
      this.narrationRemainingBaseMs - baseDuration,
    );
  }

  private restorePlayer(): HeadlessLessonPlayer {
    const checkpoint = this.store.load(this.storageKey);
    const options = { allowIncomplete: this.options.incremental };
    if (!checkpoint) return new HeadlessLessonPlayer(this.events, options);
    try {
      const events = this.options.incremental && checkpoint.canonical_events?.length
        ? checkpoint.canonical_events
        : this.events;
      const player = HeadlessLessonPlayer.fromCheckpoint(events, checkpoint, options);
      this.variableAnimation = checkpoint.variable_animation ? structuredClone(checkpoint.variable_animation) : undefined;
      this.events.splice(0, this.events.length, ...player.canonicalEvents);
      return player;
    }
    catch { this.store.remove(this.storageKey); return new HeadlessLessonPlayer(this.events, options); }
  }

  private restoreStudentOperations(): StudentOperationLog {
    const lessonId = this.player.snapshot.lesson_id;
    const raw = this.store.loadStudentOperations?.(this.storageKey);
    if (raw === undefined) return emptyStudentOperationLog(lessonId);
    const restored = parseStudentOperationLog(raw, lessonId);
    if (restored) return restored;
    this.store.removeStudentOperations?.(this.storageKey);
    return emptyStudentOperationLog(lessonId);
  }

  private restoreStudentTaskProgress(): StudentTaskProgressLog {
    const lessonId = this.player.snapshot.lesson_id;
    const empty = emptyStudentTaskProgressLog(lessonId, this.studentTaskDefinitions);
    const raw = this.store.loadStudentTaskProgress?.(this.storageKey);
    if (raw === undefined) return empty;
    const restored = parseStudentTaskProgressLog(raw, lessonId, this.studentTaskDefinitions);
    const operationIds = new Set(this.studentOperationLog.operations.map((operation) => operation.id));
    if (restored && restored.tasks.every((task) =>
      task.attempts.every((attempt) => operationIds.has(attempt.operation_id)))) return restored;
    this.store.removeStudentTaskProgress?.(this.storageKey);
    return empty;
  }

  private evaluateStudentTasks(operation: StudentOperation): void {
    if (this.suppressStudentTaskEvaluation || this.player.status !== "completed") return;
    const board = this.player.snapshot.board;
    if (!board) return;
    const activeProgress = this.studentTaskProgressLog.tasks.find((task) => task.status !== "succeeded");
    if (!activeProgress) return;
    const definition = this.studentTaskDefinitions.find((task) => task.as === activeProgress.task_id);
    if (definition && evaluateStudentTaskOperation(definition, activeProgress, operation, board)) {
      this.persistStudentTaskProgress();
    }
  }

  private persistStudentOperations(): void {
    try {
      this.store.saveStudentOperations?.(
        this.storageKey,
        structuredClone(this.studentOperationLog),
      );
    } catch {}
  }

  private persistStudentTaskProgress(): void {
    try {
      this.store.saveStudentTaskProgress?.(
        this.storageKey,
        structuredClone(this.studentTaskProgressLog),
      );
    } catch {}
  }

  private persist(): void {
    if (this.player.cursor === 0) return;
    try {
      const checkpoint = this.player.checkpoint();
      if (this.variableAnimation) checkpoint.variable_animation = structuredClone(this.variableAnimation);
      this.store.save(this.storageKey, checkpoint);
    } catch {}
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}
