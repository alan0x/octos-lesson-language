import type { CanonicalEvent } from "../../../packages/core/src/index.js";
import { HeadlessLessonPlayer, type PlaybackCheckpoint, type PlaybackFrame, type PlaybackOperation, type PlaybackProjection } from "../../../packages/player-core/src/index.js";

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

export function operationDelay(operation: PlaybackOperation, speed = 1): number {
  const base = operation.type === "action.apply"
    ? operation.action?.op === "board.create" ? 760 : 420
    : operation.type === "narration.begin" ? 320
      : operation.type === "narration.end" ? 520
        : operation.type === "beat.end" ? 260
          : 70;
  return Math.max(18, base / speed);
}

export class BrowserLessonSession {
  private player: HeadlessLessonPlayer;
  private timer?: ReturnType<typeof setTimeout>;
  private playing = false;
  private speed = 1;
  private currentFrame?: PlaybackFrame;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly events: CanonicalEvent[],
    private readonly store: PlaybackStore,
    private readonly storageKey: string,
  ) {
    this.player = this.restorePlayer();
    if (this.player.cursor > 0) this.currentFrame = {
      operation: this.player.operations[this.player.cursor - 1]!,
      projection: this.player.snapshot,
    };
  }

  get operations(): PlaybackOperation[] { return this.player.operations; }
  get cursor(): number { return this.player.cursor; }
  get projection(): PlaybackProjection { return this.player.snapshot; }
  get currentOperation(): PlaybackOperation | undefined { return this.currentFrame?.operation; }
  get isPlaying(): boolean { return this.playing; }
  get status(): PlaybackProjection["status"] { return this.player.status === "playing" && !this.playing ? "paused" : this.player.status; }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setSpeed(speed: number): void { this.speed = speed; }

  play(): void {
    if (this.player.status === "completed" || this.playing) return;
    if (this.player.status === "paused") this.player.resume();
    this.playing = true;
    this.emit();
    this.tick();
  }

  pause(): void {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.player.cursor > 0 && this.player.status !== "completed") this.player.pause();
    this.persist();
    this.emit();
  }

  advance(): PlaybackFrame | undefined {
    if (this.player.status === "completed") return undefined;
    if (this.player.status === "paused") this.player.resume();
    const frame = this.player.advance() ?? undefined;
    this.currentFrame = frame;
    this.persist();
    this.emit();
    return frame;
  }

  step(): PlaybackFrame | undefined {
    this.pause();
    const frame = this.advance();
    this.pause();
    return frame;
  }

  advanceBeat(): void {
    this.pause();
    let frame: PlaybackFrame | undefined;
    do { frame = this.advance(); } while (frame && frame.operation.type !== "beat.end" && this.player.status !== "completed");
    if (this.player.status !== "completed") this.pause();
  }

  reset(): void {
    this.pause();
    this.store.remove(this.storageKey);
    this.player = new HeadlessLessonPlayer(this.events);
    this.currentFrame = undefined;
    this.emit();
  }

  private tick(): void {
    if (!this.playing) return;
    const frame = this.advance();
    if (!frame || this.player.status === "completed") {
      this.playing = false;
      this.emit();
      return;
    }
    this.timer = setTimeout(() => this.tick(), operationDelay(frame.operation, this.speed));
  }

  private restorePlayer(): HeadlessLessonPlayer {
    const checkpoint = this.store.load(this.storageKey);
    if (!checkpoint) return new HeadlessLessonPlayer(this.events);
    try { return HeadlessLessonPlayer.fromCheckpoint(this.events, checkpoint); }
    catch { this.store.remove(this.storageKey); return new HeadlessLessonPlayer(this.events); }
  }

  private persist(): void {
    if (this.player.cursor === 0) return;
    try { this.store.save(this.storageKey, this.player.checkpoint()); } catch {}
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}
