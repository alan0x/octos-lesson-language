import { checkNumericAnswer, checkNumericRow, numericRowBlanks, scene3dViewForIntent, type AuthoringCardStudentTask, type AuthoringStudentTask, type CanonicalEvent, type Delivery } from "../../core/src/index.js";
import {
  BASE_TEN_TRADE_PLACES, applyBaseTenTap, baseTenChanges, baseTenLanguage, baseTenMat, baseTenRefusalText, baseTenSliderMove, baseTenTapReachable,
  type BaseTenMat, type BaseTenRefusal, type BaseTenStep, type BaseTenTap,
} from "../../plugin-math/src/base-ten-trade.js";
import { cardSliderAliases, cardSliderTarget, type CardSliderTarget } from "./card-slider.js";
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
  type StudentAnswerOperation,
  type StudentCardSubmitOperation,
  type StudentCardTapOperation,
  type StudentInputMethod,
  type StudentRowOperation,
  type StudentOperation,
  type StudentOperationLog,
  type StudentScene3dControl,
  type StudentScene3dViewOperation,
  type StudentScene3dViewState,
  type StudentVariableOperation,
  type StudentVariableOperationContext,
  STUDENT_VARIABLE_CONTROLS,
} from "./student-operations.js";
import {
  emptyStudentTaskProgressLog,
  evaluateStudentTaskOperation,
  parseStudentTaskProgressLog,
  taskSnapshots,
  type StudentTaskProgressLog,
  type StudentTaskSnapshot,
} from "./student-tasks.js";

export interface PlaybackFailure {
  stage: "append" | "playback" | "animation" | "seek" | "input";
  code: string;
  path?: string;
  message: string;
  cursor: number;
  eventIndex?: number;
}

export interface PhaseTransition {
  key: string;
  kind: "replay" | "practice";
  from: Record<string, number>;
  to: Record<string, number>;
  progress: number;
}

type PhaseCheckpoint = {
  epoch: number;
  practiceEpochs: Record<string, number>;
  ready: string[];
  transition?: PhaseTransition;
};
type BrowserCheckpoint = PlaybackCheckpoint & {
  runtime_failure?: PlaybackFailure;
  phase_state?: PhaseCheckpoint;
};

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

function lessonOpenCanExtend(
  delivered: CanonicalEvent,
  saved: CanonicalEvent,
): boolean {
  if (delivered.event !== "lesson.open" || saved.event !== "lesson.open") {
    return false;
  }
  const deliveredCopy = structuredClone(delivered);
  const savedCopy = structuredClone(saved);
  const deliveredVariables = deliveredCopy.lesson?.variables ?? [];
  const savedVariables = savedCopy.lesson?.variables ?? [];
  const deliveredTasks = deliveredCopy.lesson?.tasks ?? [];
  const savedTasks = savedCopy.lesson?.tasks ?? [];
  const deliveredReflections = deliveredCopy.lesson?.reflections ?? [];
  const savedReflections = savedCopy.lesson?.reflections ?? [];
  // Later teaching turns may add thinking questions as well as variables
  // and tasks. Existing definitions must still retain their meaning.
  if (deliveredCopy.lesson) {
    delete deliveredCopy.lesson.tasks;
    delete deliveredCopy.lesson.variables;
    delete deliveredCopy.lesson.reflections;
  }
  if (savedCopy.lesson) {
    delete savedCopy.lesson.tasks;
    delete savedCopy.lesson.variables;
    delete savedCopy.lesson.reflections;
  }
  if (JSON.stringify(deliveredCopy) !== JSON.stringify(savedCopy)) return false;
  const deliveredByAlias = new Map(
    deliveredVariables.map((variable) => [variable.as, variable]),
  );
  const deliveredTasksByAlias = new Map(
    deliveredTasks.map((task) => [task.as, task]),
  );
  const deliveredReflectionsByAlias = new Map(
    deliveredReflections.map((reflection) => [reflection.as, reflection]),
  );
  return savedVariables.every((variable) =>
    JSON.stringify(deliveredByAlias.get(variable.as)) === JSON.stringify(variable))
    && savedTasks.every((task) =>
      JSON.stringify(deliveredTasksByAlias.get(task.as)) === JSON.stringify(task))
    && savedReflections.every((reflection) =>
      JSON.stringify(deliveredReflectionsByAlias.get(reflection.as)) === JSON.stringify(reflection));
}

function checkpointPrefixMatchesDeliveredProgram(
  delivered: CanonicalEvent[],
  checkpointEvents: CanonicalEvent[],
  requireCompleteCheckpointCoverage: boolean,
): boolean {
  if (requireCompleteCheckpointCoverage && checkpointEvents.length > delivered.length) {
    return false;
  }
  const overlap = Math.min(delivered.length, checkpointEvents.length);
  if (overlap === 0) return false;
  for (let index = 0; index < overlap; index += 1) {
    const current = delivered[index]!;
    const saved = checkpointEvents[index]!;
    if (index === 0 && lessonOpenCanExtend(current, saved)) continue;
    if (JSON.stringify(current) !== JSON.stringify(saved)) {
      return false;
    }
  }
  return true;
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
/**
 * A value part-way through a variable animation. A wrapping variable (an angle
 * over one full turn) goes the shorter way round, crossing from max to min.
 */
export function animatedVariableValue(
  from: number,
  to: number,
  eased: number,
  variable?: { min: number; max: number; wrap?: true },
): number {
  if (!variable?.wrap) return from + (to - from) * eased;
  const period = variable.max - variable.min;
  let delta = to - from;
  if (Math.abs(delta) > period / 2) delta -= Math.sign(delta) * period;
  const value = from + delta * eased;
  const inside = ((value - variable.min) % period + period) % period + variable.min;
  // The end of the range is the same place as its start: keep an exact max.
  return Math.abs(value - variable.max) < 1e-9 ? variable.max : inside;
}

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
    if (["diagram", "plot", "image", "ink", "shape"].includes(kind)) return 1_800;
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

/** The pause between two sentences of the same speech. */
const CONTINUOUS_BEAT_GAP_MS = 250;

function operationBaseDelay(operation: PlaybackOperation): number {
  if (operation.type === "action.apply") return actionBaseDelay(operation);
  if (operation.continues) return operation.type === "beat.end" ? CONTINUOUS_BEAT_GAP_MS : 18;
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

const dragPersistIntervalMs = 400;

export function variableAnimationDuration(
  intent: PlaybackVariableAnimation["duration_intent"],
  speed = 1,
): number {
  const duration = intent === "brief" ? 1_800 : intent === "extended" ? 5_400 : 3_200;
  return Math.max(32, duration / normalizedSpeed(speed));
}

export interface ReflectionSnapshot {
  id: string;
  prompt: string;
  answer: string;
  /** Canonical node ID of the board card that poses the question. */
  anchor: string;
  /** True once the after-lesson window is open. */
  available: boolean;
}

export interface BrowserLessonSessionOptions {
  incremental?: boolean;
  /**
   * Latest complete prefix currently delivered by the host. It is used only
   * to reject a stale incremental checkpoint before that checkpoint can
   * replace the host's newer lesson structure.
   */
  deliveredProgram?: CanonicalEvent[];
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
  private failureState?: PlaybackFailure;
  private phaseState: PhaseCheckpoint = { epoch: 1, practiceEpochs: {}, ready: [] };
  private phaseTimer?: ReturnType<typeof setTimeout>;
  private phaseStartedAt?: number;
  private phaseStartProgress = 0;
  private phaseLastPersistAt = 0;
  private readonly invalidatedStudentOperations = new Set<string>();
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
  private dragPersistTimer?: ReturnType<typeof setTimeout>;
  private lastDragPersistAt = 0;
  private variableAnimationStartedAt?: number;
  private variableAnimationStartProgress = 0;
  private readonly listeners = new Set<() => void>();
  private studentOperationLog: StudentOperationLog;
  private readonly studentTaskDefinitions: AuthoringStudentTask[];
  private studentTaskProgressLog: StudentTaskProgressLog;
  private deliverySettled = false;
  private nextStudentOperationSequence = 1;
  private suppressStudentTaskEvaluation = false;
  private readonly pendingStudentVariableOperations = new Map<string, {
    sequence: number;
    alias: string;
    before: number;
    control: StudentVariableOperationContext["control"];
    input: StudentVariableOperationContext["input"];
    accepted: boolean;
    /** A slider on a card's count (decision 0023 amendment 4): its moves are trades, each tap logged. */
    card?: CardSliderTarget;
  }>();
  /** The variables whose slider trades on a card (amendment 4), by the number of events they were read from. */
  private cardSliderCache?: { events: number; aliases: Set<string> };
  /** Taps a card's slider made since the board last drew them, per card, so it animates each trade. */
  private readonly cardSliderSteps = new Map<string, BaseTenStep[]>();
  private readonly pendingStudentScene3dOperations = new Map<string, {
    sequence: number;
    nodeId: string;
    before: StudentScene3dViewState;
    after: StudentScene3dViewState;
    control: StudentScene3dControl;
    input: StudentInputMethod;
  }>();
  private discardedIncompatibleCheckpoint = false;

  constructor(
    readonly events: CanonicalEvent[],
    private readonly store: PlaybackStore,
    private readonly storageKey: string,
    private readonly options: BrowserLessonSessionOptions = {},
  ) {
    // Incremental hosts can replace an early playable prefix with the final
    // artifact while restoring playback from the prefix checkpoint. Keep the
    // newest lesson-level task definitions before restorePlayer() replaces
    // this.events with the checkpoint's Canonical events.
    const deliveredStudentTasks = structuredClone(this.events[0]?.lesson?.tasks ?? []);
    this.player = this.restorePlayer();
    this.studentOperationLog = this.restoreStudentOperations();
    this.studentTaskDefinitions = deliveredStudentTasks;
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

  get playbackEpoch(): number { return this.phaseState.epoch; }

  get activePhaseTransition(): PhaseTransition | undefined {
    return this.phaseState.transition ? structuredClone(this.phaseState.transition) : undefined;
  }

  get failure(): PlaybackFailure | undefined {
    return this.failureState ? structuredClone(this.failureState) : undefined;
  }

  /** Stop at the last accepted state. Recovery is explicit (reset/new source). */
  reportFailure(stage: PlaybackFailure["stage"], error: unknown): void {
    if (this.failureState) return;
    const detail = error instanceof Error ? error : new Error(String(error));
    const fields = detail as Error & { code?: unknown; path?: unknown };
    this.failureState = {
      stage,
      code: typeof fields.code === "string" ? fields.code : "OLL_RUNTIME_FAILURE",
      ...(typeof fields.path === "string" ? { path: fields.path } : {}),
      message: detail.message,
      cursor: this.player.cursor,
      eventIndex: this.player.operations[this.player.cursor]?.event_index,
    };
    // Do not freeze by evaluating another animation frame: that can fail again.
    this.discardScheduledDelay();
    this.stopPhaseTimer();
    if (this.variableAnimationTimer !== undefined) clearTimeout(this.variableAnimationTimer);
    this.variableAnimationTimer = undefined;
    this.variableAnimationStartedAt = undefined;
    this.playing = false;
    this.followAppends = false;
    this.pendingStudentVariableOperations.clear();
    this.pendingStudentScene3dOperations.clear();
    if (this.player.cursor > 0 && this.player.status !== "completed") this.player.pause();
    this.persist();
    this.emit();
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
      if (!beat) continue;
      // Cards this Beat writes belong to what the narration is about, even
      // when its declared focus names only the diagram being discussed.
      const created = this.player.operations
        .slice(beat.start_cursor, Math.min(beat.end_cursor, this.player.cursor) + 1)
        .flatMap((operation) => operation.action?.op === "board.create" && operation.action.node?.id
          ? [operation.action.node.id as string] : []);
      return [...new Set([...beat.focus_targets, ...created])];
    }
    return [];
  }
  /**
   * Cards the current Step wrote before the current Beat. The camera keeps
   * them in frame beside the Beat's own targets while both stay readable, so
   * a formula written a moment ago does not drop off screen when the next
   * Beat of the same Step points back at the diagram.
   */
  get stepContextTargets(): string[] {
    const beatId = this.currentOperation?.beat_id ?? this.player.snapshot.current_beat_id;
    if (!beatId) return [];
    for (const step of this.player.outline) {
      const beat = step.beats.find((candidate) => candidate.id === beatId);
      if (!beat) continue;
      return [...new Set(this.player.operations
        .slice(step.start_cursor, beat.start_cursor)
        .flatMap((operation) => operation.action?.op === "board.create" && operation.action.node?.id
          ? [operation.action.node.id as string] : []))];
    }
    return [];
  }
  get studentOperations(): StudentOperation[] { return structuredClone(this.studentOperationLog.operations); }
  /**
   * Each scene shows its authored camera, then the latest lesson view intent
   * played so far, then any later turn by the learner. A learner turn recorded
   * before that intent played gives way to it; older records without a
   * playback position count as after it.
   */
  get scene3dViews(): Record<string, StudentScene3dViewState> {
    const views: Record<string, StudentScene3dViewState> = {};
    const intentPlayedAt = new Map<string, number>();
    for (let index = 0; index < this.player.cursor; index += 1) {
      const action = this.player.operations[index]?.action;
      if (action?.op === "scene3d.view" && action.target?.node_id) intentPlayedAt.set(action.target.node_id, index);
    }
    for (const node of Object.values(this.player.snapshot.board?.nodes ?? {})) {
      if (node.kind !== "scene3d") continue;
      const camera = structuredClone(node.content.camera) as StudentScene3dViewState;
      views[node.id] = node.view_intent ? scene3dViewForIntent(node.content, node.view_intent, camera) : camera;
    }
    for (const operation of this.studentOperationLog.operations) {
      if (operation.kind !== "scene3d_view") continue;
      const playedAt = intentPlayedAt.get(operation.target.node_id);
      if (playedAt !== undefined && operation.playback_cursor !== undefined && operation.playback_cursor <= playedAt) continue;
      views[operation.target.node_id] = structuredClone(operation.after);
    }
    return views;
  }
  get studentTasks(): StudentTaskSnapshot[] {
    return taskSnapshots(
      this.studentTaskDefinitions,
      this.studentTaskProgressLog,
      this.studentTaskWindowOpen,
    );
  }
  /**
   * Thinking questions of this lesson. They become available with the
   * after-lesson window; the host shows each as its own card beside its
   * anchor, with the answer collapsed.
   */
  get reflections(): ReflectionSnapshot[] {
    return (this.events[0]?.lesson?.reflections ?? []).map((reflection) => ({
      id: reflection.as,
      prompt: reflection.prompt,
      answer: reflection.answer,
      anchor: reflection.anchor,
      available: this.studentTaskWindowOpen,
    }));
  }
  get isDeliverySettled(): boolean { return this.studentTaskWindowOpen; }
  get isPlaying(): boolean { return this.playing; }
  get activeVariableAnimation(): PlaybackVariableAnimation | undefined { return this.variableAnimation ? structuredClone(this.variableAnimation) : undefined; }
  get status(): PlaybackProjection["status"] { return this.player.status === "playing" && !this.playing ? "paused" : this.player.status; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.activatePractice();
    if (this.phaseState.transition?.kind === "practice" && !this.failureState) this.schedulePhaseTransition();
    return () => this.listeners.delete(listener);
  }
  /**
   * Tell an incremental Runtime that every event currently promised by the
   * host has arrived. The classroom may remain open for a future turn, but
   * after-lesson tasks for the current delivery can now be attempted.
   */
  setDeliverySettled(settled: boolean): void {
    if (!this.options.incremental || this.deliverySettled === settled) return;
    this.deliverySettled = settled;
    this.activatePractice();
    this.emit();
  }
  setSpeed(speed: number): void {
    if (this.failureState) return;
    const nextSpeed = normalizedSpeed(speed);
    if (nextSpeed === this.speed) return;
    this.freezeScheduledDelay();
    this.freezeVariableAnimation();
    this.freezePhaseTransition();
    this.speed = nextSpeed;
    if (this.phaseState.transition && !this.failureState) this.schedulePhaseTransition();
    if (this.playing && this.variableAnimation) this.scheduleVariableAnimation();
    if (this.playing && this.scheduledBaseDelay !== undefined) {
      this.schedulePendingDelay();
    }
  }

  play(): void {
    if (this.failureState) return;
    if (this.phaseState.transition?.kind === "practice") {
      this.schedulePhaseTransition();
      return;
    }
    if (this.failureState || this.player.status === "completed" || this.playing) return;
    this.followAppends = true;
    if (this.player.status === "waiting") {
      this.emit();
      return;
    }
    if (this.player.status === "paused") this.player.resume();
    this.playing = true;
    this.emit();
    if (this.phaseState.transition) {
      this.schedulePhaseTransition();
      return;
    }
    if (this.variableAnimation) {
      this.scheduleVariableAnimation();
      return;
    }
    if (this.scheduledBaseDelay !== undefined) this.schedulePendingDelay();
    else this.tick();
  }

  pause(): void {
    if (this.failureState) return;
    this.freezePhaseTransition();
    this.freezeScheduledDelay();
    this.freezeVariableAnimation();
    this.playing = false;
    this.followAppends = false;
    if (this.player.cursor > 0 && this.player.status !== "completed") this.player.pause();
    this.persist();
    this.emit();
  }

  advance(): PlaybackFrame | undefined {
    if (this.failureState) return undefined;
    try {
      const completedPhase = Boolean(this.phaseState.transition);
      if (this.phaseState.transition) this.completePhaseTransition();
      if (this.player.status === "completed") {
        if (completedPhase) {
          this.persist();
          this.emit();
        }
        return undefined;
      }
      if (this.variableAnimation) this.completeVariableAnimation();
      if (this.player.status === "paused") this.player.resume();
      const nextOperation = this.player.operations[this.player.cursor];
      const phase = nextOperation?.action?.transition;
      const phaseFrom = phase ? Object.fromEntries(Object.keys(phase.values).map(alias =>
        [alias, this.player.snapshot.board?.variables?.[alias]?.value as number])) : undefined;
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
      if (phase && frame) {
        const key = `playback:${this.phaseState.epoch}:${frame.operation.action!.action_id}`;
        this.beginPhaseTransition(key, "replay", phase.values, phaseFrom);
      }
      this.activatePractice();
      this.persist();
      this.emit();
      return frame;
    } catch (error) {
      this.reportFailure("playback", error);
      return undefined;
    }
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
  startNarration(beatId: string, epoch = this.phaseState.epoch): void {
    if (epoch !== this.phaseState.epoch || this.phaseState.transition || this.failureState) return;
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
  completeNarration(beatId: string, epoch = this.phaseState.epoch): void {
    if (epoch !== this.phaseState.epoch || this.phaseState.transition || this.failureState) return;
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

  seek(cursor: number, attentionTargets: string[] = [], newEpoch = true): void {
    if (this.failureState) return;
    try {
      const projection = this.player.seek(cursor);
      this.stopPhaseTimer();
      this.phaseState.transition = undefined;
      if (newEpoch) {
        this.phaseState.epoch += 1;
        // A card task's practice pile is laid again when the lesson ends again (review of #87): after a
        // replay the board holds the lesson's pile, which the narration has already answered.
        const cardPractice = this.studentTaskDefinitions.filter((task) => task.completion.kind === "card_fact" || this.tradesOnCard(task)).map((task) => `practice:${task.as}:`);
        this.phaseState.ready = this.phaseState.ready.filter(key => !key.startsWith("playback:") && !cardPractice.some((prefix) => key.startsWith(prefix)));
      }
      this.freezeScheduledDelay();
      this.discardScheduledDelay();
      this.playing = false;
      this.cardSliderSteps.clear();
      this.followAppends = false;
      this.narrationRemainingBaseMs = undefined;
      this.startedExternalNarrationBeatId = undefined;
      this.completedExternalNarrationBeatId = undefined;
      this.discardVariableAnimation();
      this.pendingStudentVariableOperations.clear();
      this.seekAttentionTargets = [...attentionTargets];
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
      this.activatePractice();
      if (cursor === 0) this.store.remove(this.storageKey);
      else this.persist();
      this.emit();
    } catch (error) {
      this.reportFailure("seek", error);
      return;
    }
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
      boundary === "start",
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
      boundary === "start",
    );
  }

  appendEvents(events: CanonicalEvent[]): PlaybackAppendResult {
    if (this.failureState) throw new Error(this.failureState.message);
    try {
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
    } catch (error) {
      this.reportFailure("append", error);
      throw error;
    }
  }

  reset(): void {
    this.pause();
    this.stopPhaseTimer();
    this.phaseState = { epoch: this.phaseState.epoch + 1, practiceEpochs: {}, ready: [] };
    this.discardScheduledDelay();
    this.narrationRemainingBaseMs = undefined;
    this.startedExternalNarrationBeatId = undefined;
    this.completedExternalNarrationBeatId = undefined;
    this.seekAttentionTargets = [];
    this.discardVariableAnimation();
    this.pendingStudentVariableOperations.clear();
    this.cardSliderSteps.clear();
    this.store.remove(this.storageKey);
    this.player = new HeadlessLessonPlayer(this.events, { allowIncomplete: this.options.incremental });
    this.currentFrame = undefined;
    this.failureState = undefined;
    this.emit();
  }

  private tick(): void {
    if (!this.playing || this.failureState) return;
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
    if (this.phaseState.transition) {
      this.schedulePhaseTransition();
      return;
    }
    if (this.variableAnimation) {
      this.scheduleVariableAnimation();
      return;
    }
    this.scheduleBaseDelay(operationBaseDelay(frame.operation));
  }

  setVariable(alias: string, value: number): void {
    // A slider on a card's count trades, and only while a task allows it (decision 0023 amendment 4).
    if (this.isCardSlider(alias)) {
      const card = cardSliderTarget(this.player.snapshot.board, alias);
      if (card && this.cardSliderLive(alias)) this.moveCardSlider(card, value, "unknown");
      else this.emit();
      return;
    }
    this.applyManualVariable(alias, value);
  }

  /** Whether this variable's slider trades on a card the lesson writes (amendment 4), drawn yet or not. */
  private isCardSlider(alias: string): boolean {
    if (this.cardSliderCache?.events !== this.events.length) this.cardSliderCache = { events: this.events.length, aliases: cardSliderAliases(this.events) };
    return this.cardSliderCache.aliases.has(alias);
  }

  /**
   * Whether the learner may move this variable's slider now. A slider on a card's count (decision 0023
   * amendment 4) is live only while the open task allows it, so it never changes the pile a lesson's own
   * tap meets; any other slider is live as before.
   */
  studentVariableLive(alias: string): boolean {
    return !this.isCardSlider(alias) || this.cardSliderLive(alias);
  }

  /**
   * The taps a card's slider made since this was last asked, each with the mat it leaves, and forgets them:
   * the board animates each trade from them, one after another (decision 0023 amendment 4).
   */
  takeStudentCardSteps(nodeId: string): BaseTenStep[] {
    const steps = this.cardSliderSteps.get(nodeId) ?? [];
    this.cardSliderSteps.delete(nodeId);
    return structuredClone(steps);
  }

  /**
   * Start one learner gesture. Reusing an already committed operationId is a
   * no-op so a host retry cannot duplicate the student's history.
   */
  beginStudentVariableOperation(
    alias: string,
    context: StudentVariableOperationContext,
  ): string {
    if (this.failureState) throw new Error(this.failureState.message);
    if (this.phaseState.transition) return "";
    const variable = this.player.snapshot.board?.variables?.[alias];
    if (!variable) throw new Error(`Unknown lesson variable '${alias}'`);
    if (!Number.isFinite(variable.value)) throw new Error(`Lesson variable '${alias}' has no finite value`);
    if (!STUDENT_VARIABLE_CONTROLS.has(context.control)) {
      throw new Error(`Unsupported student variable control '${String(context.control)}'`);
    }
    if (!["mouse", "touch", "pen", "keyboard", "unknown"].includes(context.input)) {
      throw new Error(`Unsupported student input method '${String(context.input)}'`);
    }
    // A card's count moves only by its slider while a task allows it. A host's reset of one count is refused
    // (review of Learn #233: it drew a pile the card's rules never made); a task's retry lays its whole pile.
    const card = !this.isCardSlider(alias) ? undefined : cardSliderTarget(this.player.snapshot.board, alias);
    if (this.isCardSlider(alias) && (!card || context.control !== "slider" || !this.cardSliderLive(alias))) {
      this.emit();
      return "";
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
      accepted: false,
      ...(card ? { card } : {}),
    });
    return id;
  }

  updateStudentVariableOperation(operationId: string, value: number): void {
    if (!operationId || this.failureState || this.phaseState.transition || this.invalidatedStudentOperations.has(operationId)) return;
    if (this.studentOperationLog.operations.some((operation) => operation.id === operationId)) return;
    const pending = this.pendingStudentVariableOperations.get(operationId);
    if (!pending) throw new Error(`Student operation '${operationId}' has not started`);
    pending.accepted = (pending.card
      ? this.moveCardSlider(pending.card, value, pending.input, true)
      : this.applyManualVariable(pending.alias, value, true)) || pending.accepted;
  }

  commitStudentVariableOperation(
    operationId: string,
    value?: number,
  ): StudentVariableOperation | undefined {
    if (!operationId || this.failureState || this.phaseState.transition || this.invalidatedStudentOperations.has(operationId)) return undefined;
    const completed = this.studentOperationLog.operations.find((operation) => operation.id === operationId);
    if (completed) {
      if (completed.kind !== "variable_change") {
        throw new Error("Student operation ID is not a variable operation");
      }
      return structuredClone(completed);
    }
    const pending = this.pendingStudentVariableOperations.get(operationId);
    if (!pending) throw new Error(`Student operation '${operationId}' has not started`);
    if (value !== undefined) {
      pending.accepted = (pending.card
        ? this.moveCardSlider(pending.card, value, pending.input)
        : this.applyManualVariable(pending.alias, value)) || pending.accepted;
    }
    if (this.failureState) return undefined;
    const after = this.player.snapshot.board?.variables?.[pending.alias]?.value;
    this.pendingStudentVariableOperations.delete(operationId);
    if (!pending.accepted) return undefined;
    if (!Number.isFinite(after)) throw new Error(`Lesson variable '${pending.alias}' has no finite value`);
    if (Math.abs((after as number) - pending.before) <= 1e-12) return undefined;
    const operation: StudentVariableOperation = {
      profile: "octos.student.operation",
      version: "0.1",
      id: operationId,
      // A card slider's gesture follows the trades it logged, so the log replays in order (amendment 4).
      sequence: pending.card ? this.nextStudentOperationSequence++ : pending.sequence,
      lesson_id: this.player.snapshot.lesson_id,
      kind: "variable_change",
      target: { kind: "lesson_variable", alias: pending.alias },
      before: { value: pending.before },
      after: { value: after as number },
      control: pending.control,
      input: pending.input,
    };
    const previousProgress = structuredClone(this.studentTaskProgressLog);
    try {
      this.evaluateStudentTasks(operation);
    } catch (error) {
      this.studentTaskProgressLog = previousProgress;
      this.reportFailure("input", error);
      return undefined;
    }
    this.studentOperationLog.operations.push(operation);
    this.studentOperationLog.operations.sort((left, right) => left.sequence - right.sequence);
    this.persistStudentOperations();
    this.persistStudentTaskProgress();
    this.activatePractice();
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
    if (this.failureState || this.phaseState.transition) return undefined;
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
      playbackCursor: this.player.cursor,
    });
    const previousProgress = structuredClone(this.studentTaskProgressLog);
    try {
      this.evaluateStudentTasks(operation);
    } catch (error) {
      this.studentTaskProgressLog = previousProgress;
      this.reportFailure("input", error);
      return undefined;
    }
    this.studentOperationLog.operations.push(operation);
    this.studentOperationLog.operations.sort((left, right) => left.sequence - right.sequence);
    this.persistStudentOperations();
    this.persistStudentTaskProgress();
    this.activatePractice();
    this.emit();
    return structuredClone(operation);
  }

  requestStudentTaskHint(taskId: string): StudentTaskSnapshot {
    const definition = this.studentTaskDefinitions.find((task) => task.as === taskId);
    const progress = this.studentTaskProgressLog.tasks.find((task) => task.task_id === taskId);
    if (!definition || !progress) throw new Error(`Unknown student task '${taskId}'`);
    if (!this.studentTaskWindowOpen) throw new Error(`Student task '${taskId}' is not available before the lesson completes`);
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

  /**
   * Submit a typed answer to the open numeric answer task. Text that cannot be
   * read as a number is returned as `unreadable` and is not an attempt.
   */
  submitStudentAnswer(
    taskId: string,
    text: string,
    input: StudentInputMethod = "keyboard",
  ): StudentTaskSnapshot | { unreadable: true } {
    const definition = this.studentTaskDefinitions.find((task) => task.as === taskId);
    const progress = this.studentTaskProgressLog.tasks.find((task) => task.task_id === taskId);
    if (!definition || !progress) throw new Error(`Unknown student task '${taskId}'`);
    if (definition.completion.kind !== "numeric_answer") throw new Error(`Student task '${taskId}' does not take a typed answer`);
    if (!this.studentTaskWindowOpen) throw new Error(`Student task '${taskId}' is not available before the lesson completes`);
    if (!this.studentTasks.find((task) => task.task_id === taskId)?.available) {
      throw new Error(`Student task '${taskId}' is not currently available`);
    }
    if (progress.status === "succeeded") return this.studentTasks.find((task) => task.task_id === taskId)!;
    if (!checkNumericAnswer(definition.completion, text).readable) return { unreadable: true };
    const sequence = this.nextStudentOperationSequence;
    this.nextStudentOperationSequence += 1;
    const operation: StudentAnswerOperation = {
      profile: "octos.student.operation",
      version: "0.1",
      id: `${this.player.snapshot.lesson_id}:answer:${sequence}`,
      sequence,
      lesson_id: this.player.snapshot.lesson_id,
      kind: "answer_submit",
      target: { kind: "student_task", task_id: taskId },
      answer: text,
      input,
    };
    const previousProgress = structuredClone(this.studentTaskProgressLog);
    try {
      this.evaluateStudentTasks(operation);
    } catch (error) {
      this.studentTaskProgressLog = previousProgress;
      this.reportFailure("input", error);
      return this.studentTasks.find((task) => task.task_id === taskId)!;
    }
    this.studentOperationLog.operations.push(operation);
    this.persistStudentOperations();
    this.persistStudentTaskProgress();
    this.emit();
    return this.studentTasks.find((task) => task.task_id === taskId)!;
  }

  /**
   * Whether the open task lets the learner tap this card now (decision 0023). Outside such a task (the
   * lesson playing, another task open, a practice pile still arriving) the card is inert, so taps never
   * fight the lesson and the picture never changes under a typed answer.
   */
  studentCardLive(nodeId: string): boolean {
    if (this.failureState || !this.studentTaskWindowOpen) return false;
    const active = this.studentTaskProgressLog.tasks.find((task) => task.status !== "succeeded");
    const definition = this.studentTaskDefinitions.find((task) => task.as === active?.task_id);
    return definition?.completion.kind === "card_fact"
      && (definition as AuthoringCardStudentTask).allowed_operations.some((operation) => operation.kind === "card_tap" && operation.node === nodeId);
  }

  /**
   * One tap on a card. The card's rules decide what it changes; every changed count is written to its
   * bound lesson variable in one step and logged as one operation. A tap the rules refuse changes
   * nothing, is not logged, and returns the card's reason for the learner.
   */
  tapStudentCard(
    nodeId: string,
    tap: BaseTenTap,
    input: StudentInputMethod = "unknown",
  ): { operation: StudentCardTapOperation } | { refused: BaseTenRefusal | "inert"; message: string } {
    if (!this.studentCardLive(nodeId)) return { refused: "inert", message: "" };
    const node = this.player.snapshot.board?.nodes?.[nodeId];
    if (!node || node.kind !== "base_ten_trade") throw new Error(`Card '${nodeId}' is not a base-ten trade card`);
    const before = baseTenMat(node.content);
    const result = applyBaseTenTap(before, tap);
    if (!result.ok) return { refused: result.reason, message: baseTenRefusalText(result.reason, tap.place, baseTenLanguage(node.content)) };
    const changes = this.cardChanges(nodeId, before, result.mat);
    try {
      this.player.setVariables(Object.fromEntries(changes.map((change) => [change.alias, change.after])));
    } catch (error) {
      this.reportFailure("input", error);
      return { refused: "inert", message: "" };
    }
    const sequence = this.nextStudentOperationSequence;
    this.nextStudentOperationSequence += 1;
    const operation: StudentCardTapOperation = {
      profile: "octos.student.operation",
      version: "0.1",
      id: `${this.player.snapshot.lesson_id}:card-tap:${sequence}`,
      sequence,
      lesson_id: this.player.snapshot.lesson_id,
      kind: "card_tap",
      target: { kind: "card_node", node_id: nodeId },
      tap: { kind: tap.kind, place: tap.place },
      changes,
      input,
    };
    this.studentOperationLog.operations.push(operation);
    this.persistStudentOperations();
    this.persist();
    this.emit();
    return { operation: structuredClone(operation) };
  }

  /** Whether the open task lets the learner move this card count's slider (decision 0023 amendment 4). */
  private cardSliderLive(alias: string): boolean {
    if (this.failureState || !this.studentTaskWindowOpen || !cardSliderTarget(this.player.snapshot.board, alias)) return false;
    const active = this.studentTaskProgressLog.tasks.find((task) => task.status !== "succeeded");
    const definition = this.studentTaskDefinitions.find((task) => task.as === active?.task_id);
    return (definition?.allowed_operations as Array<{ kind: string; variable?: string; controls?: string[] }> | undefined)
      ?.some((operation) => operation.kind === "variable_change" && operation.variable === alias && operation.controls?.includes("slider")) ?? false;
  }

  /** Whether a task lets the learner trade with a slider on a card's count, whether or not the card is drawn yet. */
  private tradesOnCard(task: AuthoringStudentTask): boolean {
    return (task.allowed_operations as Array<{ kind: string; variable?: string }>).some((operation) => operation.kind === "variable_change"
      && operation.variable !== undefined && this.isCardSlider(operation.variable));
  }

  /** The lesson variables a change of the card's mat writes, each with its value before and after. */
  private cardChanges(nodeId: string, before: BaseTenMat, after: BaseTenMat): Array<{ alias: string; before: number; after: number }> {
    const node = this.player.snapshot.board?.nodes?.[nodeId];
    const places = (Array.isArray(node?.content?.places) ? node.content.places : []) as Array<{ id?: string }>;
    const bound = new Map(((node?.content?.bindings ?? []) as Array<{ target: string; expression: string }>)
      .map((binding) => [binding.target, binding.expression.trim()]));
    return baseTenChanges(before, after).map((change) => {
      const alias = bound.get(`${places[change.place]?.id}.${change.field}`);
      if (!alias || !this.player.snapshot.board?.variables?.[alias]) throw new Error(`Card '${nodeId}' has no variable for ${change.field} of place ${change.place}`);
      return { alias, before: change.before, after: change.after };
    });
  }

  /**
   * Moves a slider on a card's count toward a value (decision 0023 amendment 4). Each stop is one trade made
   * by the card's own tap rules, never a direct write: down, ten of the place gather into its tray and make
   * one of the next place; up, one of the next place breaks into the tray and the ten are taken out. A stop
   * the rules refuse cannot be reached, so the slider settles on the nearest stop it can. Every tap is
   * logged as a `card_tap` (`control: "slider"`), so replaying the log through the tap rules makes the same
   * pile; the board is given each tap to animate. Returns whether the pile changed.
   */
  private moveCardSlider(card: CardSliderTarget, value: number, input: StudentInputMethod, duringDrag = false): boolean {
    if (this.failureState || this.phaseState.transition) return false;
    const node = this.player.snapshot.board?.nodes?.[card.nodeId];
    if (!node || node.kind !== "base_ten_trade") return false;
    const before = baseTenMat(node.content);
    const move = baseTenSliderMove(before, card.place, value);
    if (!move.steps.length) {
      // The thumb settles back on the stop the pile is at; a gesture's end saves the pile its drag left.
      if (!duringDrag) this.persist();
      this.emit();
      return false;
    }
    let operations: StudentCardTapOperation[];
    try {
      let mat = before;
      let sequence = this.nextStudentOperationSequence;
      operations = move.steps.map((step) => {
        const changes = this.cardChanges(card.nodeId, mat, step.mat);
        mat = step.mat;
        return {
          profile: "octos.student.operation", version: "0.1",
          id: `${this.player.snapshot.lesson_id}:card-tap:${sequence}`, sequence: sequence++,
          lesson_id: this.player.snapshot.lesson_id, kind: "card_tap",
          target: { kind: "card_node", node_id: card.nodeId },
          tap: { kind: step.tap.kind, place: step.tap.place }, changes, input, control: "slider",
        };
      });
      this.player.setVariables(Object.fromEntries(this.cardChanges(card.nodeId, before, move.mat).map((change) => [change.alias, change.after])));
      this.nextStudentOperationSequence = sequence;
    } catch (error) {
      this.reportFailure("input", error);
      return false;
    }
    this.studentOperationLog.operations.push(...operations);
    // The taps and the pile they make are saved together, as a tap's are, also mid-drag (review of #99): a page
    // closed at any moment restores the pile its saved taps replay to.
    this.persistStudentOperations();
    this.persist();
    const steps = [...(this.cardSliderSteps.get(card.nodeId) ?? []), ...move.steps];
    // A host that never draws them keeps only the latest few trades.
    this.cardSliderSteps.set(card.nodeId, steps.slice(-240));
    this.emit();
    return true;
  }

  /**
   * Submit a row of blanks to the open row task (decision 0023 amendment 1), each blank's text by its name.
   * A blank left empty or unreadable makes the row `unreadable` (those blanks are named) and is not an attempt.
   */
  submitStudentRow(
    taskId: string,
    answers: Readonly<Record<string, string>>,
    input: StudentInputMethod = "keyboard",
  ): StudentTaskSnapshot | { unreadable: string[] } {
    const definition = this.studentTaskDefinitions.find((task) => task.as === taskId);
    const progress = this.studentTaskProgressLog.tasks.find((task) => task.task_id === taskId);
    if (!definition || !progress) throw new Error(`Unknown student task '${taskId}'`);
    if (definition.completion.kind !== "numeric_row") throw new Error(`Student task '${taskId}' is not a row of blanks`);
    if (!this.studentTaskWindowOpen) throw new Error(`Student task '${taskId}' is not available before the lesson completes`);
    if (!this.studentTasks.find((task) => task.task_id === taskId)?.available) {
      throw new Error(`Student task '${taskId}' is not currently available`);
    }
    if (progress.status === "succeeded") return this.studentTasks.find((task) => task.task_id === taskId)!;
    const check = checkNumericRow(definition.completion, answers);
    if (!check.readable) return { unreadable: check.unreadable };
    const sequence = this.nextStudentOperationSequence;
    this.nextStudentOperationSequence += 1;
    const operation: StudentRowOperation = {
      profile: "octos.student.operation",
      version: "0.1",
      id: `${this.player.snapshot.lesson_id}:row:${sequence}`,
      sequence,
      lesson_id: this.player.snapshot.lesson_id,
      kind: "row_submit",
      target: { kind: "student_task", task_id: taskId },
      // Only the row's own blanks are kept, so a saved row always parses again (review of #91).
      answers: Object.fromEntries(numericRowBlanks(definition.completion).map((blank) => blank.as).map((name) => [name, String(answers[name] ?? "").slice(0, 64)])),
      input,
    };
    const previousProgress = structuredClone(this.studentTaskProgressLog);
    try {
      this.evaluateStudentTasks(operation);
    } catch (error) {
      this.studentTaskProgressLog = previousProgress;
      this.reportFailure("input", error);
      return this.studentTasks.find((task) => task.task_id === taskId)!;
    }
    this.studentOperationLog.operations.push(operation);
    this.persistStudentOperations();
    this.persistStudentTaskProgress();
    this.emit();
    return this.studentTasks.find((task) => task.task_id === taskId)!;
  }

  /** The learner says "done" on the open card task; the card's program judges what the learner made. */
  submitStudentCard(taskId: string, input: StudentInputMethod = "unknown"): StudentTaskSnapshot {
    const definition = this.studentTaskDefinitions.find((task) => task.as === taskId);
    const progress = this.studentTaskProgressLog.tasks.find((task) => task.task_id === taskId);
    if (!definition || !progress) throw new Error(`Unknown student task '${taskId}'`);
    if (definition.completion.kind !== "card_fact") throw new Error(`Student task '${taskId}' is not a card task`);
    if (!this.studentTaskWindowOpen) throw new Error(`Student task '${taskId}' is not available before the lesson completes`);
    if (!this.studentTasks.find((task) => task.task_id === taskId)?.available) {
      throw new Error(`Student task '${taskId}' is not currently available`);
    }
    if (progress.status === "succeeded") return this.studentTasks.find((task) => task.task_id === taskId)!;
    const sequence = this.nextStudentOperationSequence;
    this.nextStudentOperationSequence += 1;
    const pile = this.cardPile(definition.completion.node);
    const operation: StudentCardSubmitOperation = {
      profile: "octos.student.operation",
      version: "0.1",
      id: `${this.player.snapshot.lesson_id}:card-submit:${sequence}`,
      sequence,
      lesson_id: this.player.snapshot.lesson_id,
      kind: "card_submit",
      target: { kind: "student_task", task_id: taskId },
      input,
      ...(pile ? { pile } : {}),
    };
    const previousProgress = structuredClone(this.studentTaskProgressLog);
    try {
      this.evaluateStudentTasks(operation);
    } catch (error) {
      this.studentTaskProgressLog = previousProgress;
      this.reportFailure("input", error);
      return this.studentTasks.find((task) => task.task_id === taskId)!;
    }
    this.studentOperationLog.operations.push(operation);
    this.persistStudentOperations();
    this.persistStudentTaskProgress();
    this.activatePractice();
    // The tidy pile laid after "done" is saved now, not only on the next change (review of #93).
    this.persist();
    this.emit();
    return this.studentTasks.find((task) => task.task_id === taskId)!;
  }

  retryStudentTask(
    taskId: string,
    input: StudentVariableOperationContext["input"] = "unknown",
  ): StudentTaskSnapshot {
    const definition = this.studentTaskDefinitions.find((task) => task.as === taskId);
    const progress = this.studentTaskProgressLog.tasks.find((task) => task.task_id === taskId);
    if (!definition || !progress) throw new Error(`Unknown student task '${taskId}'`);
    if (!this.studentTaskWindowOpen) throw new Error(`Student task '${taskId}' is not available before the lesson completes`);
    if (!this.studentTasks.find((task) => task.task_id === taskId)?.available) {
      throw new Error(`Student task '${taskId}' is not currently available`);
    }
    if (definition.start) {
      progress.status = "not_started";
      this.phaseState.practiceEpochs[taskId] = (this.phaseState.practiceEpochs[taskId] ?? 0) + 1;
      this.activatePractice();
      this.persistStudentTaskProgress();
      this.emit();
      return this.studentTasks.find(task => task.task_id === taskId)!;
    }
    this.suppressStudentTaskEvaluation = true;
    try {
      if (definition.completion.kind === "expression_target") {
        const allowed = definition.allowed_operations.flatMap((operation) => operation.kind === "variable_change" ? [operation.variable] : []);
        // A task with a card's count slider always has a start (amendment 4), so it is retried above.
        const variables = allowed;
        for (const alias of variables) {
          const initial = this.player.snapshot.board?.variables?.[alias]?.initial;
          if (Number.isFinite(initial)) this.changeStudentVariable(alias, initial as number, { control: "reset", input });
        }
      } else if (definition.completion.kind === "scene3d_view_target") {
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

  private applyManualVariable(alias: string, value: number, duringDrag = false): boolean {
    if (this.failureState || this.phaseState.transition) return false;
    if (this.playing && this.variableAnimation?.variable === alias) return false;
    if (!this.playing && this.variableAnimation?.variable === alias) this.discardVariableAnimation();
    try {
      this.player.setVariable(alias, value);
    } catch (error) {
      this.reportFailure("input", error);
      return false;
    }
    if (duringDrag) this.persistDuringDrag();
    else this.persist();
    this.emit();
    return true;
  }

  /**
   * A drag emits an update per frame. Each checkpoint clones the whole
   * projection and rewrites the stored document, so save at most every
   * `dragPersistIntervalMs` plus once more when the drag pauses; the commit
   * that ends the gesture still saves immediately.
   */
  private persistDuringDrag(): void {
    // Throttle, not debounce: an armed timer keeps its deadline while updates
    // keep arriving, so a long drag still saves every interval.
    if (this.dragPersistTimer !== undefined) return;
    const wait = dragPersistIntervalMs - (Date.now() - this.lastDragPersistAt);
    if (wait <= 0) {
      this.persist();
      return;
    }
    this.dragPersistTimer = setTimeout(() => {
      this.dragPersistTimer = undefined;
      this.persist();
    }, wait);
  }

  private practiceKey(taskId: string): string {
    return `practice:${taskId}:${this.phaseState.practiceEpochs[taskId] ?? 0}`;
  }

  private activatePractice(): void {
    if (!this.baseStudentTaskWindowOpen || this.phaseState.transition) return;
    const activeIndex = this.studentTaskProgressLog.tasks.findIndex(task => task.status !== "succeeded");
    const active = this.studentTaskProgressLog.tasks[activeIndex];
    const definition = this.studentTaskDefinitions.find(task => task.as === active?.task_id);
    let key: string;
    let values: Record<string, number>;
    if (definition?.start) {
      key = this.practiceKey(definition.as);
      values = Object.fromEntries((definition.start.variables ?? []).map(alias => [
        alias, definition.start!.values?.[alias] ?? this.player.snapshot.board?.variables?.[alias]?.initial as number,
      ]));
    } else {
      // A card task already done (decision 0023): its mat shows the learner's traded pile while later tasks
      // ask about it, also after a replay (review of #87). Trading never changes the value, so a finished mat
      // holds the practice pile's digits; it is laid tidy, trays empty (a learner may finish with a few in a tray).
      const done = this.studentTaskDefinitions.slice(0, activeIndex < 0 ? undefined : activeIndex).reverse()
        .find(task => task.completion.kind === "card_fact") as AuthoringCardStudentTask | undefined;
      const traded = done?.start ? (done.completion.fact === "count" ? this.countedPracticePile(done) : this.tradedPracticePile(done)) : undefined;
      if (!done || !traded) return;
      key = `${this.practiceKey(done.as)}:done`;
      values = traded;
    }
    try {
      this.beginPhaseTransition(key, "practice", values);
      if (this.phaseState.transition) this.schedulePhaseTransition();
    } catch (error) {
      this.reportFailure("animation", error);
    }
  }

  /** A card task's practice pile once every trade is made: the tap variables at each place's digit, trays empty. */
  private tradedPracticePile(task: AuthoringCardStudentTask): Record<string, number> | undefined {
    const node = this.player.snapshot.board?.nodes?.[task.completion.node];
    const variables = this.player.snapshot.board?.variables;
    if (!node || node.kind !== "base_ten_trade" || !variables || !task.start) return undefined;
    const places = (Array.isArray(node.content.places) ? node.content.places : []) as Array<{ id?: string }>;
    const bound = new Map(((node.content.bindings ?? []) as Array<{ target: string; expression: string }>)
      .map((binding) => [binding.target, binding.expression.trim()]));
    const at = (alias: string | undefined) => alias === undefined ? 0 : task.start!.values?.[alias] ?? variables[alias]?.initial ?? 0;
    const columns = places.length;
    const value = places.reduce((sum, place, p) => sum + at(bound.get(`${place.id}.count`)) * 10 ** p, 0);
    const result: Record<string, number> = {};
    places.forEach((place, p) => {
      const count = bound.get(`${place.id}.count`);
      if (count) result[count] = p === columns - 1 ? Math.floor(value / 10 ** p) : Math.floor(value / 10 ** p) % 10;
      const tray = bound.get(`${place.id}.tray`);
      if (tray) result[tray] = 0;
    });
    return result;
  }

  /** A card's bound counts and trays as they stand, by variable (whole numbers), or undefined. */
  private cardPile(nodeId: string): Record<string, number> | undefined {
    const node = this.player.snapshot.board?.nodes?.[nodeId];
    const variables = this.player.snapshot.board?.variables;
    if (!node || node.kind !== "base_ten_trade" || !variables) return undefined;
    const pile: Record<string, number> = {};
    for (const binding of (node.content.bindings ?? []) as Array<{ expression: string }>) {
      const value = variables[binding.expression.trim()]?.value;
      if (typeof value === "number" && Number.isFinite(value)) pile[binding.expression.trim()] = Math.max(0, Math.round(value));
    }
    return Object.keys(pile).length ? pile : undefined;
  }

  /**
   * A count task's pile once it is done (amendment 5): the learner's own pile, as logged when they said done,
   * laid tidy (each tray's units loose in their place, so no count changes). A log from before the pile was
   * recorded falls back to the pile with that count and every tray empty nearest the practice pile.
   */
  private countedPracticePile(task: AuthoringCardStudentTask): Record<string, number> | undefined {
    const node = this.player.snapshot.board?.nodes?.[task.completion.node];
    const variables = this.player.snapshot.board?.variables;
    if (!node || node.kind !== "base_ten_trade" || !variables || !task.start) return undefined;
    const places = (Array.isArray(node.content.places) ? node.content.places : []) as Array<{ id?: string }>;
    const bound = new Map(((node.content.bindings ?? []) as Array<{ target: string; expression: string }>)
      .map((binding) => [binding.target, binding.expression.trim()]));
    const logged = [...this.studentOperationLog.operations].reverse()
      .find((operation) => operation.kind === "card_submit" && operation.target.task_id === task.as && operation.pile) as StudentCardSubmitOperation | undefined;
    // Only a pile that holds the count asked for, every count and tray of the card, is the learner's done pile.
    const countAlias = bound.get(`${places[BASE_TEN_TRADE_PLACES.indexOf(task.completion.at!)]?.id}.count`);
    const usable = logged?.pile && countAlias && logged.pile[countAlias] === task.completion.value
      && [...bound.values()].every((alias) => logged.pile![alias] !== undefined);
    if (usable && logged?.pile) {
      const own: Record<string, number> = {};
      for (const place of places) {
        const count = bound.get(`${place.id}.count`);
        if (count) own[count] = logged.pile[count]!;
        const tray = bound.get(`${place.id}.tray`);
        if (tray) own[tray] = 0;
      }
      return own;
    }
    const at = (alias: string | undefined) => alias === undefined ? 0 : task.start!.values?.[alias] ?? variables[alias]?.initial ?? 0;
    const start = baseTenMat({ ...node.content, places: places.map((place) => ({ ...place, count: at(bound.get(`${place.id}.count`)), tray: at(bound.get(`${place.id}.tray`)) })) });
    const p = BASE_TEN_TRADE_PLACES.indexOf(task.completion.at!);
    const distance = (mat: typeof start) => mat.counts.reduce((sum, count, q) => sum + Math.abs(count - start.counts[q]!), 0);
    const made = baseTenTapReachable(start).filter((mat) => mat.counts[p] === task.completion.value && mat.trays.every((tray) => tray === 0))
      .sort((a, b) => distance(a) - distance(b))[0];
    if (!made) return undefined;
    const result: Record<string, number> = {};
    places.forEach((place, q) => {
      const count = bound.get(`${place.id}.count`);
      if (count) result[count] = made.counts[q]!;
      const tray = bound.get(`${place.id}.tray`);
      if (tray) result[tray] = 0;
    });
    return result;
  }

  private beginPhaseTransition(key: string, kind: PhaseTransition["kind"], to: Record<string, number>, from?: Record<string, number>): void {
    if (this.phaseState.ready.includes(key)) return;
    const initial = from ?? Object.fromEntries(Object.keys(to).map(alias =>
      [alias, this.player.snapshot.board?.variables?.[alias]?.value as number]));
    if (this.options.reducedMotion || Object.entries(to).every(([alias, value]) => initial[alias] === value)) {
      this.player.setVariables(to);
      this.phaseState.ready.push(key);
      return;
    }
    this.player.setVariables(initial);
    this.cardSliderSteps.clear();
    for (const id of this.pendingStudentVariableOperations.keys()) this.invalidatedStudentOperations.add(id);
    this.pendingStudentVariableOperations.clear();
    this.pendingStudentScene3dOperations.clear();
    this.phaseState.transition = { key, kind, from: initial, to: structuredClone(to), progress: 0 };
  }

  private stopPhaseTimer(): void {
    if (this.phaseTimer !== undefined) clearTimeout(this.phaseTimer);
    this.phaseTimer = undefined;
    this.phaseStartedAt = undefined;
  }

  private applyPhaseProgress(progress: number): void {
    const transition = this.phaseState.transition;
    if (!transition) return;
    const bounded = Math.max(0, Math.min(1, progress));
    const eased = bounded < .5 ? 2 * bounded * bounded : 1 - (-2 * bounded + 2) ** 2 / 2;
    this.player.setVariables(Object.fromEntries(Object.entries(transition.to).map(([alias, to]) =>
      [alias, transition.from[alias]! + (to - transition.from[alias]!) * eased])));
    transition.progress = bounded;
  }

  private completePhaseTransition(): void {
    const transition = this.phaseState.transition;
    if (!transition) return;
    this.applyPhaseProgress(1);
    this.phaseState.ready.push(transition.key);
    this.phaseState.transition = undefined;
    this.stopPhaseTimer();
  }

  private freezePhaseTransition(): void {
    if (!this.phaseState.transition || this.phaseStartedAt === undefined) return;
    const progress = this.phaseStartProgress + (Date.now() - this.phaseStartedAt) / variableAnimationDuration("brief", this.speed);
    try { this.applyPhaseProgress(progress); }
    catch (error) { this.reportFailure("animation", error); }
    this.stopPhaseTimer();
  }

  private schedulePhaseTransition(): void {
    const transition = this.phaseState.transition;
    if (!transition || this.failureState || (transition.kind === "replay" && !this.playing)) return;
    this.stopPhaseTimer();
    this.phaseStartedAt = Date.now();
    this.phaseStartProgress = transition.progress;
    const update = () => {
      if (this.phaseState.transition !== transition || this.failureState || this.phaseStartedAt === undefined) return;
      try {
        const progress = this.phaseStartProgress + (Date.now() - this.phaseStartedAt) / variableAnimationDuration("brief", this.speed);
        this.applyPhaseProgress(progress);
        if (progress >= 1) {
          this.completePhaseTransition();
          this.persist();
          this.emit();
          if (this.playing) this.tick();
          return;
        }
        if (Date.now() - this.phaseLastPersistAt >= 200) {
          this.persist();
          this.phaseLastPersistAt = Date.now();
        }
        this.emit();
        this.phaseTimer = setTimeout(update, 16);
      } catch (error) { this.reportFailure("animation", error); }
    };
    this.phaseTimer = setTimeout(update, 16);
    this.persist();
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
    const next = { ...animation, progress: Math.max(0, Math.min(1, progress)) };
    const eased = this.easedVariableProgress(next);
    const declaration = this.player.snapshot.board?.variables?.[animation.variable];
    this.player.setVariable(animation.variable, next.progress >= 1 ? animation.to : animatedVariableValue(animation.from, animation.to, eased, declaration));
    animation.progress = next.progress;
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
      try {
        this.applyVariableAnimationProgress(progress);
      } catch (error) {
        this.reportFailure("animation", error);
        return;
      }
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
    try {
      this.applyVariableAnimationProgress(progress);
    } catch (error) {
      this.reportFailure("animation", error);
      return;
    }
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
      const checkpointEvents = this.options.incremental
        && checkpoint.canonical_events?.length
        ? checkpoint.canonical_events
        : undefined;
      const deliveredProgram = this.options.deliveredProgram ?? this.events;
      if (checkpointEvents
        && !checkpointPrefixMatchesDeliveredProgram(
          deliveredProgram,
          checkpointEvents,
          Boolean(this.options.deliveredProgram),
        )) {
        throw new Error("Saved incremental program does not match the delivered lesson");
      }
      const events = checkpointEvents ? structuredClone(checkpointEvents) : this.events;
      const restoredCheckpoint = structuredClone(checkpoint);
      if (checkpointEvents && lessonOpenCanExtend(deliveredProgram[0]!, events[0]!)) {
        const deliveredOpen = structuredClone(deliveredProgram[0]!);
        const savedAliases = new Set(
          events[0]?.lesson?.variables?.map((variable) => variable.as) ?? [],
        );
        const addedVariables = (deliveredOpen.lesson?.variables ?? []).filter(
          (variable) => !savedAliases.has(variable.as),
        );
        events[0] = deliveredOpen;
        if (restoredCheckpoint.projection.board && addedVariables.length > 0) {
          restoredCheckpoint.projection.board.variables ??= {};
          for (const variable of addedVariables) {
            restoredCheckpoint.projection.board.variables[variable.as] ??= {
              value: variable.initial,
              initial: variable.initial,
              min: variable.min,
              max: variable.max,
              ...(variable.label ? { label: variable.label } : {}),
              ...(variable.unit ? { unit: variable.unit } : {}),
              ...(variable.control ? { control: structuredClone(variable.control) } : {}),
            };
          }
        }
        restoredCheckpoint.program_fingerprint = new HeadlessLessonPlayer(
          events,
          options,
        ).program_fingerprint;
      }
      const player = HeadlessLessonPlayer.fromCheckpoint(
        events,
        restoredCheckpoint,
        options,
      );
      this.variableAnimation = checkpoint.variable_animation ? structuredClone(checkpoint.variable_animation) : undefined;
      const savedPhases = (checkpoint as BrowserCheckpoint).phase_state;
      if (savedPhases) {
        if (!Number.isSafeInteger(savedPhases.epoch) || !Array.isArray(savedPhases.ready)
          || !savedPhases.practiceEpochs || (savedPhases.transition && (
            !Number.isFinite(savedPhases.transition.progress) || savedPhases.transition.progress < 0 || savedPhases.transition.progress > 1
          ))) throw new Error("Invalid phase checkpoint");
        this.phaseState = structuredClone(savedPhases);
      }
      const savedFailure = (checkpoint as BrowserCheckpoint).runtime_failure;
      if (savedFailure && typeof savedFailure.message === "string" && typeof savedFailure.code === "string") {
        this.failureState = structuredClone(savedFailure);
      }
      this.events.splice(0, this.events.length, ...player.canonicalEvents);
      return player;
    }
    catch {
      this.discardedIncompatibleCheckpoint = true;
      this.store.remove(this.storageKey);
      return new HeadlessLessonPlayer(this.events, options);
    }
  }

  private restoreStudentOperations(): StudentOperationLog {
    const lessonId = this.player.snapshot.lesson_id;
    if (this.discardedIncompatibleCheckpoint) {
      this.store.removeStudentOperations?.(this.storageKey);
      return emptyStudentOperationLog(lessonId);
    }
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
    if (this.discardedIncompatibleCheckpoint) {
      this.store.removeStudentTaskProgress?.(this.storageKey);
      return empty;
    }
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
    if (this.suppressStudentTaskEvaluation || !this.studentTaskWindowOpen) return;
    const board = this.player.snapshot.board;
    if (!board) return;
    const activeProgress = this.studentTaskProgressLog.tasks.find((task) => task.status !== "succeeded");
    if (!activeProgress) return;
    const definition = this.studentTaskDefinitions.find((task) => task.as === activeProgress.task_id);
    if (definition) evaluateStudentTaskOperation(definition, activeProgress, operation, board);
  }

  private get studentTaskWindowOpen(): boolean {
    if (this.phaseState.transition || !this.baseStudentTaskWindowOpen) return false;
    const active = this.studentTaskProgressLog.tasks.find(task => task.status !== "succeeded");
    const definition = this.studentTaskDefinitions.find(task => task.as === active?.task_id);
    return !definition?.start || this.phaseState.ready.includes(this.practiceKey(definition.as));
  }

  private get baseStudentTaskWindowOpen(): boolean {
    return !this.failureState && (this.player.status === "completed"
      || (
        Boolean(this.options.incremental)
        && this.deliverySettled
        && this.player.cursor === this.player.operations.length
      ));
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
    if (this.dragPersistTimer !== undefined) {
      clearTimeout(this.dragPersistTimer);
      this.dragPersistTimer = undefined;
    }
    this.lastDragPersistAt = Date.now();
    if (this.player.cursor === 0) return;
    try {
      const checkpoint: BrowserCheckpoint = this.player.checkpoint();
      if (this.failureState) checkpoint.runtime_failure = structuredClone(this.failureState);
      checkpoint.phase_state = structuredClone(this.phaseState);
      if (this.variableAnimation) checkpoint.variable_animation = structuredClone(this.variableAnimation);
      this.store.save(this.storageKey, checkpoint);
    } catch {}
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}
