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

export interface StudentInkSelectionSource {
  source_id: string;
  document_id: string;
  document_version: number;
  bounds: { x: number; y: number; width: number; height: number };
  checksum: { algorithm: "sha-256"; value: string };
}

export interface StudentInkSelectionOperation {
  profile: "octos.student.operation";
  version: "0.1";
  id: string;
  sequence: number;
  lesson_id: string;
  kind: "ink_selection";
  target: {
    kind: "ink_selection_source";
  } & StudentInkSelectionSource;
  input: StudentInputMethod;
}

export type StudentScene3dControl = "orbit" | "zoom" | "preset" | "reset";

export interface StudentScene3dViewState {
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface StudentScene3dViewOperation {
  profile: "octos.student.operation";
  version: "0.1";
  id: string;
  sequence: number;
  lesson_id: string;
  kind: "scene3d_view";
  target: { kind: "scene3d_node"; node_id: string };
  before: StudentScene3dViewState;
  after: StudentScene3dViewState;
  control: StudentScene3dControl;
  input: StudentInputMethod;
}

export type StudentOperation =
  | StudentVariableOperation
  | StudentInkSelectionOperation
  | StudentScene3dViewOperation;

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
const scene3dControls = new Set<StudentScene3dControl>(["orbit", "zoom", "preset", "reset"]);

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
    const candidateOperation = raw as Partial<StudentOperation>;
    if (candidateOperation.kind === "scene3d_view") {
      const operation = raw as Partial<StudentScene3dViewOperation>;
      const finiteView = (view: Partial<StudentScene3dViewState> | undefined) =>
        view && Number.isFinite(view.yaw) && Number.isFinite(view.pitch)
        && Number.isFinite(view.zoom) && (view.zoom ?? 0) >= .2 && (view.zoom ?? 0) <= 5;
      if (
        operation.profile !== "octos.student.operation"
        || operation.version !== "0.1"
        || operation.lesson_id !== lessonId
        || typeof operation.id !== "string"
        || !operation.id
        || ids.has(operation.id)
        || !Number.isInteger(operation.sequence)
        || (operation.sequence ?? 0) <= lastSequence
        || operation.target?.kind !== "scene3d_node"
        || typeof operation.target.node_id !== "string"
        || !operation.target.node_id
        || !finiteView(operation.before)
        || !finiteView(operation.after)
        || !scene3dControls.has(operation.control as StudentScene3dControl)
        || !inputMethods.has(operation.input as StudentInputMethod)
      ) return undefined;
      ids.add(operation.id);
      lastSequence = operation.sequence as number;
      operations.push(structuredClone(operation as StudentScene3dViewOperation));
      continue;
    }
    if (candidateOperation.kind === "ink_selection") {
      const operation = raw as Partial<StudentInkSelectionOperation>;
      const target = operation.target;
      const bounds = target?.bounds;
      if (
        operation.profile !== "octos.student.operation" ||
        operation.version !== "0.1" ||
        operation.lesson_id !== lessonId ||
        typeof operation.id !== "string" ||
        !operation.id ||
        ids.has(operation.id) ||
        !Number.isInteger(operation.sequence) ||
        (operation.sequence ?? 0) <= lastSequence ||
        target?.kind !== "ink_selection_source" ||
        typeof target.source_id !== "string" ||
        !target.source_id ||
        typeof target.document_id !== "string" ||
        !target.document_id ||
        !Number.isInteger(target.document_version) ||
        (target.document_version ?? -1) < 0 ||
        !bounds ||
        !Number.isFinite(bounds.x) ||
        !Number.isFinite(bounds.y) ||
        !Number.isFinite(bounds.width) ||
        bounds.width <= 0 ||
        !Number.isFinite(bounds.height) ||
        bounds.height <= 0 ||
        target.checksum?.algorithm !== "sha-256" ||
        !/^[a-f0-9]{64}$/.test(target.checksum.value ?? "") ||
        !inputMethods.has(operation.input as StudentInputMethod)
      ) {
        return undefined;
      }
      ids.add(operation.id);
      lastSequence = operation.sequence as number;
      operations.push(structuredClone(operation as StudentInkSelectionOperation));
      continue;
    }
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

export function createStudentScene3dViewOperation(options: {
  lessonId: string;
  sequence: number;
  nodeId: string;
  before: StudentScene3dViewState;
  after: StudentScene3dViewState;
  control: StudentScene3dControl;
  input: StudentInputMethod;
  operationId?: string;
}): StudentScene3dViewOperation {
  const operation: StudentScene3dViewOperation = {
    profile: "octos.student.operation",
    version: "0.1",
    id: options.operationId ?? [options.lessonId, "scene3d", options.sequence].join(":"),
    sequence: options.sequence,
    lesson_id: options.lessonId,
    kind: "scene3d_view",
    target: { kind: "scene3d_node", node_id: options.nodeId },
    before: structuredClone(options.before),
    after: structuredClone(options.after),
    control: options.control,
    input: options.input,
  };
  const parsed = parseStudentOperationLog({
    ...emptyStudentOperationLog(options.lessonId),
    operations: [operation],
  }, options.lessonId);
  if (!parsed || parsed.operations[0]?.kind !== "scene3d_view") {
    throw new Error("Invalid student 3D view operation");
  }
  return parsed.operations[0];
}

export function createStudentInkSelectionOperation(options: {
  lessonId: string;
  sequence: number;
  source: StudentInkSelectionSource;
  input: StudentInputMethod;
}): StudentInkSelectionOperation {
  if (!Number.isInteger(options.sequence) || options.sequence < 1) {
    throw new Error("Student operation sequence must be a positive integer");
  }
  const operation: StudentInkSelectionOperation = {
    profile: "octos.student.operation",
    version: "0.1",
    id: [options.lessonId, "ink-selection", options.source.source_id].join(":"),
    sequence: options.sequence,
    lesson_id: options.lessonId,
    kind: "ink_selection",
    target: {
      kind: "ink_selection_source",
      ...structuredClone(options.source),
    },
    input: options.input,
  };
  const parsed = parseStudentOperationLog({
    ...emptyStudentOperationLog(options.lessonId),
    operations: [operation],
  }, options.lessonId);
  if (!parsed || parsed.operations[0]?.kind !== "ink_selection") {
    throw new Error("Invalid student ink selection operation");
  }
  return parsed.operations[0];
}

export function studentInputMethod(pointerType: string | undefined): StudentInputMethod {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  if (!pointerType || pointerType === "mouse") return "mouse";
  return "unknown";
}
