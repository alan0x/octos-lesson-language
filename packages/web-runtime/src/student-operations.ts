import { TAP_CARD_KINDS } from "../../core/src/cards.js";
import type { CardTapKind } from "../../core/src/types.js";

/**
 * The most fields a card's pile binds: a ten-column place-value chart to pull apart binds a count and a
 * pulled count per place and its number (decision 0025); the mat binds five at most.
 */
const CARD_PILE_MAX_FIELDS = 21;

/** A tap some card kind takes, at a place that kind has (the log names a place by its index). */
function knownCardTap(tap: { kind?: unknown; place?: unknown }): boolean {
  return Number.isInteger(tap.place) && (tap.place as number) >= 0
    && Object.values(TAP_CARD_KINDS).some((card) => card.taps.includes(tap.kind as string) && (tap.place as number) < card.places.length);
}

export type StudentInputMethod = "mouse" | "touch" | "pen" | "keyboard" | "unknown";
export type StudentVariableControl = "slider" | "geometry_point" | "number_line_point" | "reset";

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
  /** Playback position when the learner turned the scene; later lesson views turn it again. */
  playback_cursor?: number;
}

/** A typed answer submitted to a numeric answer task. */
export interface StudentAnswerOperation {
  profile: "octos.student.operation";
  version: "0.1";
  id: string;
  sequence: number;
  lesson_id: string;
  kind: "answer_submit";
  target: { kind: "student_task"; task_id: string };
  answer: string;
  input: StudentInputMethod;
}

/** One tap on a card (decision 0023): the card's own rules decide which lesson variables it changes. */
export interface StudentCardTapOperation {
  profile: "octos.student.operation";
  version: "0.1";
  id: string;
  sequence: number;
  lesson_id: string;
  kind: "card_tap";
  target: { kind: "card_node"; node_id: string };
  /**
   * What was tapped, at a place's index in its card kind's places: on the mat gather, ungather, make or break
   * (0 = ones); on a place-value chart add, remove or take_out (the place plus three, 3 = ones; decision 0025); on
   * a place-value trade card down, trade or break, at the same index (decision 0026); on a place-value times-ten
   * card move, copy or smaller, at a row (0 = the first row; decision 0028).
   */
  tap: { kind: CardTapKind; place: number };
  /** Every variable the tap changed, in one step. */
  changes: Array<{ alias: string; before: number; after: number }>;
  input: StudentInputMethod;
  /**
   * Present when a slider on the card's count made the tap, as one of a trade's taps (decision 0023
   * amendment 4). The gesture's own `variable_change` follows its taps in the log.
   */
  control?: "slider";
}

/** The learner says "done" on a card task; the card's program judges what the learner made. */
export interface StudentCardSubmitOperation {
  profile: "octos.student.operation";
  version: "0.1";
  id: string;
  sequence: number;
  lesson_id: string;
  kind: "card_submit";
  target: { kind: "student_task"; task_id: string };
  input: StudentInputMethod;
  /**
   * The card's bound fields (counts and trays; a chart's counts, pulled counts and number), by variable, when
   * the learner said done (decision 0023 amendment 5).
   * A later task without its own pile opens on the learner's own pile from it, also after a replay.
   */
  pile?: Record<string, number>;
}

/** A row of blanks submitted in one go (decision 0023 amendment 1): each blank's typed text by its name. */
export interface StudentRowOperation {
  profile: "octos.student.operation";
  version: "0.1";
  id: string;
  sequence: number;
  lesson_id: string;
  kind: "row_submit";
  target: { kind: "student_task"; task_id: string };
  answers: Record<string, string>;
  input: StudentInputMethod;
}

export type StudentOperation =
  | StudentRowOperation
  | StudentVariableOperation
  | StudentInkSelectionOperation
  | StudentScene3dViewOperation
  | StudentAnswerOperation
  | StudentCardTapOperation
  | StudentCardSubmitOperation;

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

/** Every control a learner can change a lesson variable with; the session and the log both check against it. */
export const STUDENT_VARIABLE_CONTROLS: ReadonlySet<StudentVariableControl> = new Set<StudentVariableControl>(["slider", "geometry_point", "number_line_point", "reset"]);
const controls = STUDENT_VARIABLE_CONTROLS;
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
        || (operation.playback_cursor !== undefined && (!Number.isInteger(operation.playback_cursor) || operation.playback_cursor < 0))
      ) return undefined;
      ids.add(operation.id);
      lastSequence = operation.sequence as number;
      operations.push(structuredClone(operation as StudentScene3dViewOperation));
      continue;
    }
    if (candidateOperation.kind === "answer_submit") {
      const operation = raw as Partial<StudentAnswerOperation>;
      if (
        operation.profile !== "octos.student.operation"
        || operation.version !== "0.1"
        || operation.lesson_id !== lessonId
        || typeof operation.id !== "string"
        || !operation.id
        || ids.has(operation.id)
        || !Number.isInteger(operation.sequence)
        || (operation.sequence ?? 0) <= lastSequence
        || operation.target?.kind !== "student_task"
        || typeof operation.target.task_id !== "string"
        || !operation.target.task_id
        || typeof operation.answer !== "string"
        || operation.answer.length > 64
        || !inputMethods.has(operation.input as StudentInputMethod)
      ) return undefined;
      ids.add(operation.id);
      lastSequence = operation.sequence as number;
      operations.push(structuredClone(operation as StudentAnswerOperation));
      continue;
    }
    if (candidateOperation.kind === "row_submit") {
      const operation = raw as Partial<StudentRowOperation>;
      const answers = operation.answers;
      if (
        operation.profile !== "octos.student.operation"
        || operation.version !== "0.1"
        || operation.lesson_id !== lessonId
        || typeof operation.id !== "string" || !operation.id || ids.has(operation.id)
        || !Number.isInteger(operation.sequence) || (operation.sequence ?? 0) <= lastSequence
        || operation.target?.kind !== "student_task" || typeof operation.target.task_id !== "string" || !operation.target.task_id
        || !answers || typeof answers !== "object" || Array.isArray(answers)
        || Object.keys(answers).length < 1 || Object.keys(answers).length > 6
        || Object.values(answers).some((text) => typeof text !== "string" || text.length > 64)
        || !inputMethods.has(operation.input as StudentInputMethod)
      ) return undefined;
      ids.add(operation.id);
      lastSequence = operation.sequence as number;
      operations.push(structuredClone(operation as StudentRowOperation));
      continue;
    }
    if (candidateOperation.kind === "card_tap" || candidateOperation.kind === "card_submit") {
      const operation = raw as Partial<StudentCardTapOperation> & Partial<StudentCardSubmitOperation>;
      const common = operation.profile === "octos.student.operation"
        && operation.version === "0.1"
        && operation.lesson_id === lessonId
        && typeof operation.id === "string" && !!operation.id && !ids.has(operation.id)
        && Number.isInteger(operation.sequence) && (operation.sequence ?? 0) > lastSequence
        && inputMethods.has(operation.input as StudentInputMethod);
      if (!common) return undefined;
      if (candidateOperation.kind === "card_tap") {
        const tap = (operation as Partial<StudentCardTapOperation>).tap;
        const changes = (operation as Partial<StudentCardTapOperation>).changes;
        const target = (operation as Partial<StudentCardTapOperation>).target;
        if (
          target?.kind !== "card_node" || typeof target.node_id !== "string" || !target.node_id
          || !tap || !knownCardTap(tap)
          || !Array.isArray(changes) || changes.length < 1 || changes.length > 6
          || changes.some((change) => !change || typeof change.alias !== "string" || !change.alias
            || !Number.isFinite(change.before) || !Number.isFinite(change.after))
          || new Set(changes.map((change) => change.alias)).size !== changes.length
          || ((operation as Partial<StudentCardTapOperation>).control !== undefined && (operation as Partial<StudentCardTapOperation>).control !== "slider")
        ) return undefined;
      } else {
        const target = (operation as Partial<StudentCardSubmitOperation>).target;
        if (target?.kind !== "student_task" || typeof target.task_id !== "string" || !target.task_id) return undefined;
        const pile = (operation as Partial<StudentCardSubmitOperation>).pile;
        if (pile !== undefined && (!pile || typeof pile !== "object" || Array.isArray(pile)
          || Object.keys(pile).length < 1 || Object.keys(pile).length > CARD_PILE_MAX_FIELDS
          || Object.values(pile).some((value) => !Number.isInteger(value) || value < 0))) return undefined;
      }
      ids.add(operation.id as string);
      lastSequence = operation.sequence as number;
      operations.push(structuredClone(operation as StudentCardTapOperation | StudentCardSubmitOperation));
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
  playbackCursor?: number;
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
    ...(options.playbackCursor !== undefined ? { playback_cursor: options.playbackCursor } : {}),
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
