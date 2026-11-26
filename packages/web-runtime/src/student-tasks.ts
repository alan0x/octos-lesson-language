import {
  checkNumericAnswer,
  checkNumericRow,
  evaluateMathExpression,
  parseNumericAnswer,
  scene3dViewTargetScore,
  type AuthoringAnswerStudentTask,
  type AuthoringScene3dStudentTask,
  type AuthoringStudentTask,
  type AuthoringVariableStudentTask,
  type StudentTaskScene3dControl,
  type StudentTaskVariableControl,
} from "../../core/src/index.js";
import type { AuthoringCardStudentTask, SemanticBoardState } from "../../core/src/index.js";
import { tapCardKind } from "../../core/src/cards.js";
import type {
  StudentAnswerOperation,
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
  /** The typed text, kept for numeric answer tasks so the check can be repeated. */
  answer?: string;
  /** Each blank's typed text, kept for row tasks so the check can be repeated (decision 0023 amendment 1). */
  answers?: Record<string, string>;
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
  /**
   * Present (true) on a card task with no "done": the tap that completes the card submits it (decision 0026), so
   * a host shows no "done" button for it.
   */
  auto_submit?: true;
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
        !attemptMatchesDefinition(definition, attempt as StudentTaskAttempt)
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

/** A saved attempt must be what its task would record for the same input. */
function attemptMatchesDefinition(definition: AuthoringStudentTask, attempt: StudentTaskAttempt): boolean {
  const completion = definition.completion;
  if (completion.kind === "numeric_answer") {
    if (typeof attempt.answer !== "string" || attempt.answers !== undefined) return false;
    const check = checkNumericAnswer(completion, attempt.answer);
    return check.readable
      && attempt.actual === check.value
      && attempt.target === parseNumericAnswer(completion.answer)!.value
      && attempt.succeeded === check.succeeded;
  }
  if (completion.kind === "numeric_row") {
    if (attempt.answer !== undefined || !attempt.answers || typeof attempt.answers !== "object") return false;
    const check = checkNumericRow(completion, attempt.answers);
    return check.readable && attempt.actual === check.right && attempt.target === check.total && attempt.succeeded === check.succeeded;
  }
  if (attempt.answer !== undefined || attempt.answers !== undefined) return false;
  // A card fact is true (1) or not (0); the card's program judged it when the learner said done.
  if (completion.kind === "card_fact") {
    // A count (amendment 5) is the place's count against the value asked for.
    if (completion.fact === "count") {
      return attempt.target === completion.value && Number.isInteger(attempt.actual) && attempt.succeeded === (attempt.actual === attempt.target);
    }
    return attempt.target === 1 && (attempt.actual === 0 || attempt.actual === 1) && attempt.succeeded === (attempt.actual === 1);
  }
  const target = completion.kind === "expression_target" ? completion.value : 0;
  const tolerance = completion.kind === "expression_target" ? completion.tolerance : 1;
  return attempt.target === target
    && attempt.succeeded === (Math.abs(attempt.actual - attempt.target) <= tolerance);
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

function answerOperationAllowed(
  task: AuthoringAnswerStudentTask,
  operation: StudentAnswerOperation,
): boolean {
  return operation.target.task_id === task.as;
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
  let answer: string | undefined;
  let answers: Record<string, string> | undefined;
  if (task.completion.kind === "numeric_answer") {
    if (operation.kind !== "answer_submit" || !answerOperationAllowed(task as AuthoringAnswerStudentTask, operation)) return false;
    const check = checkNumericAnswer(task.completion, operation.answer);
    if (!check.readable) return false;
    actual = check.value;
    target = parseNumericAnswer(task.completion.answer)!.value;
    succeeded = check.succeeded;
    answer = operation.answer;
  } else if (task.completion.kind === "numeric_row") {
    if (operation.kind !== "row_submit" || operation.target.task_id !== task.as) return false;
    const check = checkNumericRow(task.completion, operation.answers);
    if (!check.readable) return false;
    // Counted blanks right, of all; the learner is told only whether the whole row is right.
    actual = check.right;
    target = check.total;
    succeeded = check.succeeded;
    answers = structuredClone(operation.answers);
  } else if (task.completion.kind === "card_fact") {
    // Taps are not attempts; only saying "done" on this task is.
    if (operation.kind !== "card_submit" || operation.target.task_id !== task.as) return false;
    const node = board.nodes[(task as AuthoringCardStudentTask).completion.node];
    const card = tapCardKind(node?.kind);
    if (!node || !card) throw new Error(`Card '${(task as AuthoringCardStudentTask).completion.node}' is not on the board`);
    const completion = (task as AuthoringCardStudentTask).completion;
    // The card's own program reads the fact (a count: the place's count, its tray included; amendment 5).
    const fact = typeof completion.fact === "string" && Object.hasOwn(card.facts, completion.fact) ? card.facts[completion.fact] : undefined;
    if (!fact) throw new Error(`Card '${completion.node}' has no fact '${completion.fact}'`);
    ({ actual, target, succeeded } = fact.read(completion, card.state(node.content)));
  } else if (task.completion.kind === "expression_target") {
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
    ...(answer !== undefined ? { answer } : {}),
    ...(answers !== undefined ? { answers } : {}),
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
      ...(task.completion.kind === "card_fact" && !(task.allowed_operations as Array<{ kind: string }>).some((operation) => operation.kind === "card_submit") ? { auto_submit: true as const } : {}),
      ...(task.success_message ? { success_message: task.success_message } : {}),
      ...(currentHint ? { current_hint: currentHint } : {}),
    };
  });
}
