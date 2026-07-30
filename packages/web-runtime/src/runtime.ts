import type { CanonicalEvent, Delivery } from "../../core/src/index.js";
import {
  HeadlessLessonPlayer,
  type PlaybackAppendResult,
  type PlaybackCheckpoint,
  type PlaybackFrame,
  type PlaybackOutlineStep,
  type PlaybackOperation,
  type PlaybackProjection,
} from "../../player-core/src/index.js";

export interface PlaybackStore {
  load(key: string): PlaybackCheckpoint | undefined;
  save(key: string, checkpoint: PlaybackCheckpoint): void;
  remove(key: string): void;
}

export class LocalPlaybackStore implements PlaybackStore {
  load(key: string): PlaybackCheckpoint | undefined {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as PlaybackCheckpoint : undefined; } catch { return undefined; }
  }
  save(key: string, checkpoint: PlaybackCheckpoint): void { try { localStorage.setItem(key, JSON.stringify(checkpoint)); } catch {} }
  remove(key: string): void { try { localStorage.removeItem(key); } catch {} }
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

export interface BrowserLessonSessionOptions {
  incremental?: boolean;
}

export class BrowserLessonSession {
  private player: HeadlessLessonPlayer;
  private timer?: ReturnType<typeof setTimeout>;
  private timerStartedAt?: number;
  private scheduledBaseDelay?: number;
  private scheduledSpeed = 1;
  private narrationRemainingBaseMs?: number;
  private playing = false;
  private followAppends = false;
  private speed = 1;
  private seekAttentionTargets: string[] = [];
  private currentFrame?: PlaybackFrame;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly events: CanonicalEvent[],
    private readonly store: PlaybackStore,
    private readonly storageKey: string,
    private readonly options: BrowserLessonSessionOptions = {},
  ) {
    this.player = this.restorePlayer();
    if (this.player.cursor > 0) this.currentFrame = {
      operation: this.player.operations[this.player.cursor - 1]!,
      projection: this.player.snapshot,
    };
    const narration = this.player.snapshot.current_narration;
    if (narration) {
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
  get isPlaying(): boolean { return this.playing; }
  get status(): PlaybackProjection["status"] { return this.player.status === "playing" && !this.playing ? "paused" : this.player.status; }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setSpeed(speed: number): void {
    const nextSpeed = normalizedSpeed(speed);
    if (nextSpeed === this.speed) return;
    this.freezeScheduledDelay();
    this.speed = nextSpeed;
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
    if (this.scheduledBaseDelay !== undefined) this.schedulePendingDelay();
    else this.tick();
  }

  pause(): void {
    this.freezeScheduledDelay();
    this.playing = false;
    this.followAppends = false;
    if (this.player.cursor > 0 && this.player.status !== "completed") this.player.pause();
    this.persist();
    this.emit();
  }

  advance(): PlaybackFrame | undefined {
    if (this.player.status === "completed") return undefined;
    if (this.player.status === "paused") this.player.resume();
    const frame = this.player.advance() ?? undefined;
    this.seekAttentionTargets = [];
    this.currentFrame = frame;
    if (frame?.operation.type === "narration.begin" && frame.operation.narration) {
      this.narrationRemainingBaseMs = narrationDuration(
        frame.operation.narration.text,
        frame.operation.narration.delivery,
      );
    } else if (frame?.operation.type === "narration.end") {
      this.narrationRemainingBaseMs = undefined;
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

  seek(cursor: number, attentionTargets: string[] = []): void {
    this.freezeScheduledDelay();
    this.discardScheduledDelay();
    this.playing = false;
    this.followAppends = false;
    this.narrationRemainingBaseMs = undefined;
    this.seekAttentionTargets = [...attentionTargets];
    const projection = this.player.seek(cursor);
    this.currentFrame = cursor > 0
      ? {
          operation: this.player.operations[cursor - 1]!,
          projection,
        }
      : undefined;
    const narration = projection.current_narration;
    if (narration) {
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
    this.seekAttentionTargets = [];
    this.store.remove(this.storageKey);
    this.player = new HeadlessLessonPlayer(this.events, { allowIncomplete: this.options.incremental });
    this.currentFrame = undefined;
    this.emit();
  }

  private tick(): void {
    if (!this.playing) return;
    const nextOperation = this.player.operations[this.player.cursor];
    if (
      nextOperation?.type === "narration.end" &&
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
    this.scheduleBaseDelay(operationBaseDelay(frame.operation));
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
      this.events.splice(0, this.events.length, ...player.canonicalEvents);
      return player;
    }
    catch { this.store.remove(this.storageKey); return new HeadlessLessonPlayer(this.events, options); }
  }

  private persist(): void {
    if (this.player.cursor === 0) return;
    try { this.store.save(this.storageKey, this.player.checkpoint()); } catch {}
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}
