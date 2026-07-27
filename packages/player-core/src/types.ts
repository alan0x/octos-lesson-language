import type { ActionPhase, CanonicalAction, Delivery, SemanticBoardState } from "../../core/src/index.js";

export type PlaybackStatus = "ready" | "playing" | "paused" | "completed";
export type PlaybackOperationType =
  | "lesson.open" | "step.begin" | "beat.begin"
  | "phase.begin" | "action.apply" | "phase.end"
  | "narration.begin" | "narration.end"
  | "beat.end" | "step.commit" | "lesson.close";

export interface PlaybackNarration {
  text: string;
  delivery?: Delivery;
}

export interface PlaybackOperation {
  operation_id: string;
  type: PlaybackOperationType;
  lesson_id: string;
  step_id?: string;
  beat_id?: string;
  phase?: ActionPhase;
  narration?: PlaybackNarration;
  action?: CanonicalAction;
  event_index: number;
}

export interface PlaybackProjection {
  status: PlaybackStatus;
  cursor: number;
  total_operations: number;
  lesson_id: string;
  current_step_id?: string;
  current_beat_id?: string;
  current_phase?: ActionPhase;
  current_narration?: PlaybackNarration;
  board: SemanticBoardState | null;
}

export interface PlaybackFrame {
  operation: PlaybackOperation;
  projection: PlaybackProjection;
}

export interface PlaybackCheckpoint {
  profile: "octos.playback.checkpoint";
  version: "0.1";
  program_fingerprint: string;
  lesson_id: string;
  cursor: number;
  projection: PlaybackProjection;
}

export interface PlaybackConformanceResult {
  lesson_id: string;
  operation_count: number;
  action_count: number;
  checkpoint_count: number;
  final_state_matches_reducer: boolean;
  final_revision: number;
  node_count: number;
  connection_count: number;
  group_count: number;
}
