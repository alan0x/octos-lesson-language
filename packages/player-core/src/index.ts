import {
  OllError,
  applyCanonicalAction,
  applyLessonClose,
  assertDeepEqual,
  canonicalizeState,
  commitCanonicalStep,
  createSemanticBoardState,
  reduceCanonicalEvents,
  setLessonVariable,
  type ActionPhase,
  type CanonicalEvent,
  type SemanticBoardState,
} from "../../core/src/index.js";
import type {
  PlaybackAppendResult,
  PlaybackCheckpoint,
  PlaybackConformanceResult,
  PlaybackFrame,
  PlaybackOutlineStep,
  PlaybackOperation,
  PlaybackProjection,
  PlaybackStatus,
} from "./types.js";

export type * from "./types.js";

const PHASES: ActionPhase[] = ["before_speech", "during_speech", "after_speech"];

export interface PlaybackCompileOptions {
  allowIncomplete?: boolean;
}

export class PlaybackError extends OllError {
  constructor(code: string, path: string, message: string) {
    super(code, path, message);
    this.name = "PlaybackError";
  }
}

function playbackFail(code: string, path: string, message: string): never {
  throw new PlaybackError(code, path, message);
}

function fingerprintEvents(events: CanonicalEvent[]): string {
  const input = JSON.stringify(events);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function compilePlaybackOperations(
  events: CanonicalEvent[],
  options: PlaybackCompileOptions = {},
): PlaybackOperation[] {
  if (events.length < 1) playbackFail("OLL_PLAYBACK_BOUNDARY", "events", "Playback requires lesson.open");
  if (!options.allowIncomplete && events.length < 2) playbackFail("OLL_PLAYBACK_BOUNDARY", "events", "Playback requires lesson.open and lesson.close");
  const lessonId = events[0]!.lesson_id;
  const operations: PlaybackOperation[] = [];
  const actionIds = new Set<string>();
  const stepIds = new Set<string>();
  const beatIds = new Set<string>();
  let operationIndex = 0;
  const push = (operation: Omit<PlaybackOperation, "operation_id" | "lesson_id">) => {
    operationIndex += 1;
    operations.push({ ...operation, lesson_id: lessonId, operation_id: `playback:${String(operationIndex).padStart(6, "0")}` });
  };

  events.forEach((event, eventIndex) => {
    if (event.lesson_id !== lessonId) playbackFail("OLL_PLAYBACK_LESSON_MISMATCH", `/events/${eventIndex}/lesson_id`, "All Canonical Events must use the same lesson_id");
    if (event.sequence !== eventIndex) playbackFail("OLL_PLAYBACK_SEQUENCE", `/events/${eventIndex}/sequence`, `Expected sequence ${eventIndex}, received ${event.sequence}`);
    if (eventIndex === 0 && event.event !== "lesson.open") playbackFail("OLL_PLAYBACK_BOUNDARY", "/events/0/event", "First event must be lesson.open");
    if (!options.allowIncomplete && eventIndex === events.length - 1 && event.event !== "lesson.close") playbackFail("OLL_PLAYBACK_BOUNDARY", `/events/${eventIndex}/event`, "Last event must be lesson.close");
    if (event.event === "lesson.close" && eventIndex !== events.length - 1) playbackFail("OLL_PLAYBACK_AFTER_CLOSE", `/events/${eventIndex}/event`, "No event may follow lesson.close");
  });

  push({ type: "lesson.open", event_index: 0 });
  for (let eventIndex = 1; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex]!;
    if (event.event === "lesson.close") {
      push({ type: "lesson.close", event_index: eventIndex });
      continue;
    }
    if (event.event !== "lesson.step" || !event.step) playbackFail("OLL_PLAYBACK_BOUNDARY", `/events/${eventIndex}`, "Only lesson.step is allowed between open and close");
    const step = event.step;
    if (stepIds.has(step.id)) playbackFail("OLL_DUPLICATE_STEP_ID", `/events/${eventIndex}/step/id`, `Step '${step.id}' is duplicated`);
    stepIds.add(step.id);
    push({ type: "step.begin", event_index: eventIndex, step_id: step.id });
    for (const beat of step.beats) {
      if (beatIds.has(beat.id)) playbackFail("OLL_DUPLICATE_BEAT_ID", `/events/${eventIndex}/step/beats`, `Beat '${beat.id}' is duplicated`);
      beatIds.add(beat.id);
      push({ type: "beat.begin", event_index: eventIndex, step_id: step.id, beat_id: beat.id });
      for (const phase of PHASES) {
        if (phase === "during_speech" && beat.narration) {
          push({ type: "narration.begin", event_index: eventIndex, step_id: step.id, beat_id: beat.id, narration: beat.narration });
        }
        push({ type: "phase.begin", event_index: eventIndex, step_id: step.id, beat_id: beat.id, phase });
        for (const action of beat.stage[phase]) {
          if (actionIds.has(action.action_id)) playbackFail("OLL_DUPLICATE_ACTION_ID", `/events/${eventIndex}/step/beats`, `Action '${action.action_id}' is duplicated`);
          actionIds.add(action.action_id);
          push({ type: "action.apply", event_index: eventIndex, step_id: step.id, beat_id: beat.id, phase, action });
        }
        push({ type: "phase.end", event_index: eventIndex, step_id: step.id, beat_id: beat.id, phase });
        if (phase === "during_speech" && beat.narration) {
          push({ type: "narration.end", event_index: eventIndex, step_id: step.id, beat_id: beat.id, narration: beat.narration });
        }
      }
      push({ type: "beat.end", event_index: eventIndex, step_id: step.id, beat_id: beat.id });
    }
    push({ type: "step.commit", event_index: eventIndex, step_id: step.id });
  }
  return operations;
}

function narrationPreview(text: string | undefined, fallback: string): string {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  const sentence = normalized.match(/^.*?[。！？.!?]/)?.[0]?.trim();
  const preview = sentence || normalized;
  return preview.length > 42 ? `${preview.slice(0, 41).trimEnd()}…` : preview;
}

function actionTargetIds(action: PlaybackOperation["action"]): string[] {
  if (!action) return [];
  if (action.op === "board.focus") return action.focus?.targets ?? [];
  const target = action.target;
  return [
    action.node?.id,
    action.connection?.id,
    action.group?.id,
    target?.node_id,
    target?.group_id,
    target?.connection_id,
  ].filter((id): id is string => Boolean(id));
}

function focusTargets(
  operations: PlaybackOperation[],
  start: number,
  end: number,
): string[] {
  const scoped = operations.slice(start, end + 1);
  const declaredFocus = scoped
    .filter((operation) => operation.action?.op === "board.focus")
    .flatMap((operation) => operation.action?.focus?.targets ?? []);
  const candidates = declaredFocus.length > 0
    ? declaredFocus
    : scoped.flatMap((operation) => actionTargetIds(operation.action));
  return [...new Set(candidates)];
}

export function buildPlaybackOutline(
  events: CanonicalEvent[],
  operations = compilePlaybackOperations(events, { allowIncomplete: true }),
): PlaybackOutlineStep[] {
  const steps: PlaybackOutlineStep[] = [];
  for (const [eventIndex, event] of events.entries()) {
    if (event.event !== "lesson.step" || !event.step) continue;
    const stepStart = operations.findIndex(
      (operation) => operation.type === "step.begin" && operation.step_id === event.step!.id,
    );
    const stepEnd = operations.findIndex(
      (operation) => operation.type === "step.commit" && operation.step_id === event.step!.id,
    );
    if (stepStart < 0 || stepEnd < 0) continue;
    steps.push({
      id: event.step.id,
      title: event.step.purpose,
      event_index: eventIndex,
      start_cursor: stepStart,
      end_cursor: stepEnd + 1,
      focus_targets: focusTargets(operations, stepStart, stepEnd),
      beats: event.step.beats.flatMap((beat, beatIndex) => {
        const beatStart = operations.findIndex(
          (operation) => operation.type === "beat.begin" && operation.beat_id === beat.id,
        );
        const beatEnd = operations.findIndex(
          (operation) => operation.type === "beat.end" && operation.beat_id === beat.id,
        );
        if (beatStart < 0 || beatEnd < 0) return [];
        return [{
          id: beat.id,
          title: narrationPreview(beat.narration?.text, `讲解片段 ${beatIndex + 1}`),
          event_index: eventIndex,
          start_cursor: beatStart,
          end_cursor: beatEnd + 1,
          focus_targets: focusTargets(operations, beatStart, beatEnd),
        }];
      }),
    });
  }
  return steps;
}

export class HeadlessLessonPlayer {
  readonly operations: PlaybackOperation[];
  private events: CanonicalEvent[];
  private projection: PlaybackProjection;
  private frames: PlaybackFrame[] = [];
  private readonly allowIncomplete: boolean;

  constructor(events: CanonicalEvent[], options: PlaybackCompileOptions = {}) {
    this.allowIncomplete = options.allowIncomplete ?? false;
    this.events = structuredClone(events);
    this.operations = compilePlaybackOperations(this.events, options);
    this.projection = {
      status: "ready", cursor: 0, total_operations: this.operations.length,
      lesson_id: this.events[0]!.lesson_id, board: null,
    };
  }

  static fromCheckpoint(
    events: CanonicalEvent[],
    checkpoint: PlaybackCheckpoint,
    options: PlaybackCompileOptions = {},
  ): HeadlessLessonPlayer {
    const player = new HeadlessLessonPlayer(events, options);
    if (checkpoint.profile !== "octos.playback.checkpoint" || checkpoint.version !== "0.1") playbackFail("OLL_CHECKPOINT_VERSION", "checkpoint", "Unsupported checkpoint profile or version");
    if (checkpoint.program_fingerprint !== player.program_fingerprint) playbackFail("OLL_CHECKPOINT_PROGRAM_MISMATCH", "checkpoint.program_fingerprint", "Checkpoint does not belong to this Canonical program");
    if (checkpoint.lesson_id !== player.projection.lesson_id) playbackFail("OLL_CHECKPOINT_LESSON_MISMATCH", "checkpoint.lesson_id", "Checkpoint lesson_id does not match");
    if (checkpoint.cursor < 1 || checkpoint.cursor > player.operations.length) playbackFail("OLL_CHECKPOINT_CURSOR", "checkpoint.cursor", "Checkpoint cursor is outside the operation stream");
    if (checkpoint.projection.cursor !== checkpoint.cursor || checkpoint.projection.total_operations !== player.operations.length) playbackFail("OLL_CHECKPOINT_PROJECTION", "checkpoint.projection", "Checkpoint projection metadata is inconsistent");
    player.projection = structuredClone(checkpoint.projection);
    player.projection.status = checkpoint.cursor === player.operations.length
      ? player.isClosed ? "completed" : "waiting"
      : "paused";
    return player;
  }

  get program_fingerprint(): string { return fingerprintEvents(this.events); }
  get canonicalEvents(): CanonicalEvent[] { return structuredClone(this.events); }
  get isClosed(): boolean { return this.events.at(-1)?.event === "lesson.close"; }
  get status(): PlaybackStatus { return this.projection.status; }
  get cursor(): number { return this.projection.cursor; }
  get trace(): PlaybackFrame[] { return structuredClone(this.frames); }
  get snapshot(): PlaybackProjection { return structuredClone(this.projection); }
  get outline(): PlaybackOutlineStep[] {
    return buildPlaybackOutline(this.events, this.operations);
  }

  pause(): void {
    if (this.projection.status === "completed") return;
    if (!this.projection.board) playbackFail("OLL_PLAYBACK_NOT_OPEN", "player", "Cannot pause before lesson.open");
    this.projection.status = "paused";
  }

  resume(): void {
    if (this.projection.status === "completed") return;
    if (!this.projection.board) playbackFail("OLL_PLAYBACK_NOT_OPEN", "player", "Cannot resume before lesson.open");
    this.projection.status = this.projection.cursor < this.operations.length ? "playing" : "waiting";
  }

  appendEvents(events: CanonicalEvent[]): PlaybackAppendResult {
    if (!this.allowIncomplete) {
      playbackFail("OLL_PLAYBACK_NOT_INCREMENTAL", "player", "This player was not created for incremental playback");
    }
    const candidate = structuredClone(this.events);
    let accepted = 0;
    let duplicates = 0;
    for (const event of events) {
      if (event.sequence < candidate.length) {
        if (JSON.stringify(candidate[event.sequence]) !== JSON.stringify(event)) {
          playbackFail("OLL_PLAYBACK_EVENT_CONFLICT", `/events/${event.sequence}`, `Sequence ${event.sequence} conflicts with an accepted event`);
        }
        duplicates += 1;
        continue;
      }
      if (event.sequence !== candidate.length) {
        playbackFail("OLL_PLAYBACK_SEQUENCE", `/events/${candidate.length}/sequence`, `Expected sequence ${candidate.length}, received ${event.sequence}`);
      }
      candidate.push(structuredClone(event));
      accepted += 1;
    }

    const compiled = compilePlaybackOperations(candidate, { allowIncomplete: true });
    if (accepted > 0) {
      const priorStatus = this.projection.status;
      this.events = candidate;
      this.operations.splice(0, this.operations.length, ...compiled);
      this.projection.total_operations = this.operations.length;
      if (priorStatus === "waiting" && this.projection.cursor < this.operations.length) {
        this.projection.status = "paused";
      }
    }
    return { accepted, duplicates, total_events: this.events.length, closed: this.isClosed };
  }

  checkpoint(): PlaybackCheckpoint {
    if (!this.projection.board) playbackFail("OLL_PLAYBACK_NOT_OPEN", "player", "Cannot checkpoint before lesson.open");
    const projection = structuredClone(this.projection);
    projection.status = projection.cursor === projection.total_operations
      ? this.isClosed ? "completed" : "waiting"
      : "paused";
    return {
      profile: "octos.playback.checkpoint", version: "0.1", program_fingerprint: this.program_fingerprint,
      lesson_id: projection.lesson_id, cursor: projection.cursor, projection,
      ...(this.allowIncomplete ? { canonical_events: this.canonicalEvents } : {}),
    };
  }

  advance(): PlaybackFrame | null {
    if (this.projection.status === "completed") return null;
    if (this.projection.status === "waiting" && this.projection.cursor >= this.operations.length) return null;
    if (this.projection.status === "waiting") this.projection.status = "playing";
    if (this.projection.status === "paused") playbackFail("OLL_PLAYBACK_PAUSED", "player", "Call resume() before advancing a paused player");
    this.projection.status = "playing";
    const operation = this.operations[this.projection.cursor]!;
    this.applyOperation(operation);
    this.projection.cursor += 1;
    if (this.projection.cursor === this.operations.length) {
      this.projection.status = this.isClosed ? "completed" : "waiting";
    }
    const frame = { operation: structuredClone(operation), projection: structuredClone(this.projection) };
    this.frames.push(frame);
    return frame;
  }

  playAll(): PlaybackFrame[] {
    const frames: PlaybackFrame[] = [];
    while (this.projection.status !== "completed" && this.projection.status !== "waiting") frames.push(this.advance()!);
    return frames;
  }

  seek(cursor: number): PlaybackProjection {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.operations.length) {
      playbackFail(
        "OLL_PLAYBACK_CURSOR",
        "cursor",
        `Cursor ${cursor} is outside the operation stream`,
      );
    }
    this.projection = {
      status: "ready",
      cursor: 0,
      total_operations: this.operations.length,
      lesson_id: this.events[0]!.lesson_id,
      board: null,
    };
    this.frames = [];
    while (this.projection.cursor < cursor) {
      const operation = this.operations[this.projection.cursor]!;
      this.applyOperation(operation);
      this.projection.cursor += 1;
    }
    this.projection.status = cursor === 0
      ? "ready"
      : cursor === this.operations.length
        ? this.isClosed ? "completed" : "waiting"
        : "paused";
    return this.snapshot;
  }

  finalState(): SemanticBoardState {
    if (this.projection.status !== "completed" || !this.projection.board) playbackFail("OLL_PLAYBACK_INCOMPLETE", "player", "Lesson playback is not complete");
    return canonicalizeState(this.projection.board);
  }

  setVariable(alias: string, value: number): SemanticBoardState {
    if (!this.projection.board) playbackFail("OLL_PLAYBACK_NOT_OPEN", "player", "Cannot set a variable before lesson.open");
    this.projection.board = setLessonVariable(this.projection.board, alias, value);
    return structuredClone(this.projection.board);
  }

  private applyOperation(operation: PlaybackOperation): void {
    if (operation.type === "lesson.open") {
      this.projection.board = createSemanticBoardState(this.events[operation.event_index]!);
    } else if (operation.type === "step.begin") {
      this.projection.current_step_id = operation.step_id;
    } else if (operation.type === "beat.begin") {
      this.projection.current_beat_id = operation.beat_id;
    } else if (operation.type === "phase.begin") {
      this.projection.current_phase = operation.phase;
    } else if (operation.type === "action.apply") {
      if (!this.projection.board || !operation.action) playbackFail("OLL_PLAYBACK_ACTION", "operation", "action.apply requires an open board and action");
      applyCanonicalAction(this.projection.board, operation.action);
    } else if (operation.type === "phase.end") {
      delete this.projection.current_phase;
    } else if (operation.type === "narration.begin") {
      this.projection.current_narration = structuredClone(operation.narration!);
    } else if (operation.type === "narration.end") {
      delete this.projection.current_narration;
    } else if (operation.type === "beat.end") {
      delete this.projection.current_beat_id;
      delete this.projection.current_phase;
      delete this.projection.current_narration;
    } else if (operation.type === "step.commit") {
      if (!this.projection.board || !operation.step_id) playbackFail("OLL_PLAYBACK_STEP", "operation", "step.commit requires an open board and step_id");
      commitCanonicalStep(this.projection.board, operation.step_id);
      delete this.projection.current_step_id;
    } else if (operation.type === "lesson.close") {
      if (!this.projection.board) playbackFail("OLL_PLAYBACK_NOT_OPEN", "operation", "lesson.close requires an open board");
      applyLessonClose(this.projection.board, this.events[operation.event_index]!);
    }
  }
}

export function runPlaybackConformance(events: CanonicalEvent[]): PlaybackConformanceResult {
  const player = new HeadlessLessonPlayer(events);
  const checkpoints: PlaybackCheckpoint[] = [];
  let actionCount = 0;
  while (player.status !== "completed") {
    const frame = player.advance()!;
    if (frame.operation.type === "action.apply") {
      actionCount += 1;
      checkpoints.push(player.checkpoint());
    }
  }
  const expected = reduceCanonicalEvents(events);
  const actual = player.finalState();
  assertDeepEqual(actual, expected);

  const selected = checkpoints.length <= 3
    ? checkpoints
    : [checkpoints[0]!, checkpoints[Math.floor(checkpoints.length / 2)]!, checkpoints.at(-1)!];
  for (const checkpoint of selected) {
    const restored = HeadlessLessonPlayer.fromCheckpoint(events, checkpoint);
    if (restored.status !== "completed") restored.resume();
    restored.playAll();
    assertDeepEqual(restored.finalState(), expected);
  }

  return {
    lesson_id: events[0]!.lesson_id, operation_count: player.operations.length, action_count: actionCount,
    checkpoint_count: selected.length, final_state_matches_reducer: true,
    final_revision: actual.revision, node_count: Object.keys(actual.nodes).length,
    connection_count: Object.keys(actual.connections).length, group_count: Object.keys(actual.groups).length,
  };
}
