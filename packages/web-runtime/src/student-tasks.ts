import {
  evaluateMathExpression,
  scene3dViewTargetScore,
  type AuthoringScene3dStudentTask,
  type AuthoringStudentTask,
  type AuthoringVariableStudentTask,
  type StudentTaskScene3dControl,
  type StudentTaskVariableControl,
} from "../../core/src/index.js";
import type { SemanticBoardState } from "../../core/src/index.js";
import type {
  StudentOperation,
  StudentScene3dViewOperation,
  StudentVariableOperation,
} from "./student-operations.js";

export type StudentTaskStatus = "not_started" | "in_progress" | "needs_hint" | "succeeded";

export interface StudentTaskAttempt {
  sequence: number;
  operation_id: string;
  actual: number;
  target: number;
  succeeded: boolean;
}

export interface StudentTaskProgress {
  task_id: string;
  status: StudentTaskStatus;
  hints_revealed: number;
  attempts: StudentTaskAttempt[];
}

export interface StudentTaskProgressLog {
  profile: "octos.student.task-progress-log";
  version: "0.1";
  lesson_id: string;
  tasks: StudentTaskProgress[];
}

export interface StudentTaskSnapshot extends StudentTaskProgress {
  available: boolean;
  prompt: string;
  hints: string[];
  success_message?: string;
  current_hint?: string;
}

export function emptyStudentTaskProgressLog(
  lessonId: string,
  tasks: AuthoringStudentTask[],
): StudentTaskProgressLog {
  return {
    profile: "octos.student.task-progress-log",
    version: "0.1",
    lesson_id: lessonId,
    tasks: tasks.map((task) => ({
      task_id: task.as,
      status: "not_started",
      hints_revealed: 0,
      attempts: [],
    })),
  };
}

export function parseStudentTaskProgressLog(
  candidate: unknown,
  lessonId: string,
  definitions: AuthoringStudentTask[],
): StudentTaskProgressLog | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const value = candidate as Partial<StudentTaskProgressLog>;
  if (
    value.profile !== "octos.student.task-progress-log" ||
    value.version !== "0.1" ||
    value.lesson_id !== lessonId ||
    !Array.isArray(value.tasks)
  ) return undefined;
  const definitionIds = new Set(definitions.map((task) => task.as));
  const seen = new Set<string>();
  const tasksById = new Map<string, StudentTaskProgress>();
  for (const raw of value.tasks) {
    if (!raw || typeof raw !== "object") return undefined;
    const progress = raw as Partial<StudentTaskProgress>;
    if (
      typeof progress.task_id !== "string" ||
      !definitionIds.has(progress.task_id) ||
      seen.has(progress.task_id) ||
      !["not_started", "in_progress", "needs_hint", "succeeded"].includes(String(progress.status)) ||
      !Number.isInteger(progress.hints_revealed) ||
      (progress.hints_revealed ?? -1) < 0 ||
      !Array.isArray(progress.attempts)
    ) return undefined;
    const definition = definitions.find((task) => task.as === progress.task_id)!;
    let lastSequence = 0;
    const operationIds = new Set<string>();
    const attempts: StudentTaskAttempt[] = [];
    for (const attemptRaw of progress.attempts) {
      if (!attemptRaw || typeof attemptRaw !== "object") return undefined;
      const attempt = attemptRaw as Partial<StudentTaskAttempt>;
      if (
        !Number.isInteger(attempt.sequence) ||
        (attempt.sequence ?? 0) <= lastSequence ||
        typeof attempt.operation_id !== "string" ||
        !attempt.operation_id ||
        operationIds.has(attempt.operation_id) ||
        typeof attempt.actual !== "number" ||
        !Number.isFinite(attempt.actual) ||
        typeof attempt.target !== "number" ||
        !Number.isFinite(attempt.target) ||
        typeof attempt.succeeded !== "boolean" ||
        attempt.target !== (definition.completion.kind === "expression_target"
          ? definition.completion.value
          : 0) ||
        attempt.succeeded !== (Math.abs(attempt.actual - attempt.target) <= (
          definition.completion.kind === "expression_target"
            ? definition.completion.tolerance
            : 1
        ))
      ) return undefined;
      lastSequence = attempt.sequence as number;
      operationIds.add(attempt.operation_id);
      attempts.push(attempt as StudentTaskAttempt);
    }
    if ((progress.status === "succeeded") !== attempts.some((attempt) => attempt.succeeded)) {
      return undefined;
    }
    seen.add(progress.task_id);
    tasksById.set(progress.task_id, {
      task_id: progress.task_id,
      status: progress.status as StudentTaskStatus,
      hints_revealed: Math.min(progress.hints_revealed as number, definition.hints.length),
      attempts,
    });
  }
  if (seen.size !== definitions.length) return undefined;
  const tasks = definitions.map((definition) => tasksById.get(definition.as)!);
  return { ...emptyStudentTaskProgressLog(lessonId, []), tasks };
}

function variableOperationAllowed(
  task: AuthoringVariableStudentTask,
  operation: StudentVariableOperation,
): boolean {
  return task.allowed_operations.some((allowed) => allowed.kind === "variable_change"
    && allowed.variable === operation.target.alias
    && allowed.controls.includes(operation.control as StudentTaskVariableControl));
}

function scene3dOperationAllowed(
  task: AuthoringScene3dStudentTask,
  operation: StudentScene3dViewOperation,
): boolean {
  return task.allowed_operations.some((allowed) => allowed.kind === "scene3d_view"
    && allowed.node === operation.target.node_id
    && allowed.controls.includes(operation.control as StudentTaskScene3dControl));
}

function scene3dViewScore(
  view: StudentScene3dViewOperation["after"],
  completion: AuthoringScene3dStudentTask["completion"],
): number {
  return scene3dViewTargetScore(view, completion);
}

export function evaluateStudentTaskOperation(
  task: AuthoringStudentTask,
  progress: StudentTaskProgress,
  operation: StudentOperation,
  board: SemanticBoardState,
): boolean {
  if (progress.status === "succeeded") return false;
  if (progress.attempts.some((attempt) => attempt.operation_id === operation.id)) return false;
  let actual: number;
  let target: number;
  let succeeded: boolean;
  if (task.completion.kind === "expression_target") {
    const variableTask = task as AuthoringVariableStudentTask;
    if (operation.kind !== "variable_change" || !variableOperationAllowed(variableTask, operation)) return false;
    const values = Object.fromEntries(Object.entries(board.variables ?? {}).map(([alias, variable]) => [alias, variable.value]));
    actual = evaluateMathExpression(task.completion.expression, values);
    target = task.completion.value;
    succeeded = Math.abs(actual - target) <= task.completion.tolerance;
  } else {
    const sceneTask = task as AuthoringScene3dStudentTask;
    if (operation.kind !== "scene3d_view" || !scene3dOperationAllowed(sceneTask, operation)) return false;
    actual = scene3dViewScore(operation.after, sceneTask.completion);
    target = 0;
    succeeded = actual <= 1;
  }
  progress.attempts.push({
    sequence: progress.attempts.length + 1,
    operation_id: operation.id,
    actual,
    target,
    succeeded,
  });
  const hintThreshold = task.hint_after_attempts ?? 2;
  progress.status = succeeded
    ? "succeeded"
    : progress.attempts.length >= hintThreshold
      ? "needs_hint"
      : "in_progress";
  return true;
}

export function taskSnapshots(
  definitions: AuthoringStudentTask[],
  log: StudentTaskProgressLog,
  lessonCompleted: boolean,
): StudentTaskSnapshot[] {
  const activeTaskIndex = log.tasks.findIndex((task) => task.status !== "succeeded");
  return definitions.map((task, index) => {
    const progress = log.tasks.find((candidate) => candidate.task_id === task.as)!;
    const currentHint = progress.hints_revealed > 0
      ? task.hints[Math.min(progress.hints_revealed, task.hints.length) - 1]
      : undefined;
    return {
      ...structuredClone(progress),
      available: lessonCompleted
        && task.availability.kind === "after_lesson"
        && (progress.status === "succeeded" || index === activeTaskIndex),
      prompt: task.prompt,
      hints: [...task.hints],
      ...(task.success_message ? { success_message: task.success_message } : {}),
      ...(currentHint ? { current_hint: currentHint } : {}),
    };
  });
}
