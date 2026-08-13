export type StudentInputMethod = "mouse" | "touch" | "pen" | "keyboard" | "unknown";
export type StudentVariableControl = "slider" | "geometry_point" | "reset";

export interface StudentVariableOperationContext {
  control: StudentVariableControl;
  input: StudentInputMethod;
  operationId?: string;
}

export interface StudentVariableOperation {
  profile: "octos.student.operation";
  version: "0.1";
  id: string;
  sequence: number;
  lesson_id: string;
  kind: "variable_change";
  target: {
    kind: "lesson_variable";
    alias: string;
  };
  before: { value: number };
  after: { value: number };
  control: StudentVariableControl;
  input: StudentInputMethod;
}

export type StudentOperation = StudentVariableOperation;

export interface StudentOperationLog {
  profile: "octos.student.operation-log";
  version: "0.1";
  lesson_id: string;
  operations: StudentOperation[];
}

export type StudentVariableInputPhase = "start" | "update" | "commit";

export interface StudentVariableInputEvent {
  phase: StudentVariableInputPhase;
  control: StudentVariableControl;
  input: StudentInputMethod;
  operation_id?: string;
}

export type StudentVariableInputHandler = (
  alias: string,
  value: number,
  event: StudentVariableInputEvent,
) => string | void;

const controls = new Set<StudentVariableControl>(["slider", "geometry_point", "reset"]);
const inputMethods = new Set<StudentInputMethod>(["mouse", "touch", "pen", "keyboard", "unknown"]);

export function emptyStudentOperationLog(lessonId: string): StudentOperationLog {
  return {
    profile: "octos.student.operation-log",
    version: "0.1",
    lesson_id: lessonId,
    operations: [],
  };
}

export function parseStudentOperationLog(
  candidate: unknown,
  lessonId: string,
): StudentOperationLog | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const value = candidate as Partial<StudentOperationLog>;
  if (
    value.profile !== "octos.student.operation-log" ||
    value.version !== "0.1" ||
    value.lesson_id !== lessonId ||
    !Array.isArray(value.operations)
  ) {
    return undefined;
  }
  const ids = new Set<string>();
  let lastSequence = 0;
  const operations: StudentOperation[] = [];
  for (const raw of value.operations) {
    if (!raw || typeof raw !== "object") return undefined;
    const operation = raw as Partial<StudentVariableOperation>;
    const alias = operation.target?.alias;
    const before = operation.before?.value;
    const after = operation.after?.value;
    if (
      operation.profile !== "octos.student.operation" ||
      operation.version !== "0.1" ||
      operation.lesson_id !== lessonId ||
      operation.kind !== "variable_change" ||
      typeof operation.id !== "string" ||
      !operation.id ||
      ids.has(operation.id) ||
      !Number.isInteger(operation.sequence) ||
      (operation.sequence ?? 0) <= lastSequence ||
      operation.target?.kind !== "lesson_variable" ||
      typeof alias !== "string" ||
      !alias ||
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      !controls.has(operation.control as StudentVariableControl) ||
      !inputMethods.has(operation.input as StudentInputMethod)
    ) {
      return undefined;
    }
    ids.add(operation.id);
    lastSequence = operation.sequence as number;
    operations.push({
      profile: "octos.student.operation",
      version: "0.1",
      id: operation.id,
      sequence: operation.sequence as number,
      lesson_id: lessonId,
      kind: "variable_change",
      target: { kind: "lesson_variable", alias },
      before: { value: before as number },
      after: { value: after as number },
      control: operation.control as StudentVariableControl,
      input: operation.input as StudentInputMethod,
    });
  }
  return { ...emptyStudentOperationLog(lessonId), operations };
}

export function studentInputMethod(pointerType: string | undefined): StudentInputMethod {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  if (!pointerType || pointerType === "mouse") return "mouse";
  return "unknown";
}
