import {
  evaluateMathExpression,
  type AuthoringStudentTask,
  type StudentTaskVariableControl,
} from "../../core/src/index.js";
import type { SemanticBoardState } from "../../core/src/index.js";
import type { StudentVariableOperation } from "./student-operations.js";

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
        attempt.target !== definition.completion.value ||
        attempt.succeeded !== (Math.abs(attempt.actual - attempt.target) <= definition.completion.tolerance)
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

function operationAllowed(task: AuthoringStudentTask, operation: StudentVariableOperation): boolean {
  return task.allowed_operations.some((allowed) =>
    allowed.variable === operation.target.alias
    && allowed.controls.includes(operation.control as StudentTaskVariableControl));
}

export function evaluateStudentTaskOperation(
  task: AuthoringStudentTask,
  progress: StudentTaskProgress,
  operation: StudentVariableOperation,
  board: SemanticBoardState,
): boolean {
  if (progress.status === "succeeded" || !operationAllowed(task, operation)) return false;
  if (progress.attempts.some((attempt) => attempt.operation_id === operation.id)) return false;
  const values = Object.fromEntries(Object.entries(board.variables ?? {}).map(([alias, variable]) => [alias, variable.value]));
  const actual = evaluateMathExpression(task.completion.expression, values);
  const succeeded = Math.abs(actual - task.completion.value) <= task.completion.tolerance;
  progress.attempts.push({
    sequence: progress.attempts.length + 1,
    operation_id: operation.id,
    actual,
    target: task.completion.value,
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
