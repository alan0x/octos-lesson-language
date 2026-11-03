import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import type { PlaybackCheckpoint } from "../../player-core/src/index.js";
import { BrowserLessonSession, type PlaybackStore } from "../src/runtime.js";
import type { StudentOperationLog } from "../src/student-operations.js";
import type { StudentTaskProgressLog } from "../src/student-tasks.js";

class MemoryStore implements PlaybackStore {
  values = new Map<string, PlaybackCheckpoint>();
  operations = new Map<string, StudentOperationLog>();
  progress = new Map<string, StudentTaskProgressLog>();
  load(key: string) { return structuredClone(this.values.get(key)); }
  save(key: string, checkpoint: PlaybackCheckpoint) { this.values.set(key, structuredClone(checkpoint)); }
  remove(key: string) { this.values.delete(key); }
  loadStudentOperations(key: string): unknown { return structuredClone(this.operations.get(key)); }
  saveStudentOperations(key: string, log: StudentOperationLog) { this.operations.set(key, structuredClone(log)); }
  removeStudentOperations(key: string) { this.operations.delete(key); }
  loadStudentTaskProgress(key: string): unknown { return structuredClone(this.progress.get(key)); }
  saveStudentTaskProgress(key: string, log: StudentTaskProgressLog) { this.progress.set(key, structuredClone(log)); }
  removeStudentTaskProgress(key: string) { this.progress.delete(key); }
}

const box = {
  do: "write", as: "box", kind: "scene3d", role: "diagram", place: { relation: "new_region" },
  content: {
    fallback: "A box", camera: { yaw: 0.7, pitch: 0.5, zoom: 1 },
    objects: [{ as: "prism", kind: "box", center: { x: 0, y: 0, z: 1 }, size: { x: 4, y: 3, z: 2 } }],
    highlights: [{ as: "bottom-face", kind: "face", points: [{ x: -2, y: -1.5, z: 0 }, { x: 2, y: -1.5, z: 0 }, { x: 2, y: 1.5, z: 0 }, { x: -2, y: 1.5, z: 0 }] }],
  },
};

const lesson: AuthoringLesson = {
  dsl: "octos.lesson", version: "0.1", profile: "authoring",
  lesson: { mode: "learner_taught", language: "en-US", title: "Box", goals: ["See every face"],
    author: { kind: "learner", learner_ref: "learner:demo", presented_by: { avatar_ref: "avatar:fox", voice_ref: "voice:learner-warm-1" } } },
  steps: [{ key: "faces", purpose: "Show the faces", beats: [
    { key: "card-1", say: "Here is the box.", actions: [box as never, { do: "focus", targets: ["box"], intent: "show_box" }] },
    { key: "card-2", say: "Now look underneath.", actions: [{ do: "view", target: "box", show: "box#bottom-face" }] },
  ] }],
  close: { summary: "Every face counts.", focus: ["box"] },
};

function session() {
  const events = normalizeAuthoringLesson(lesson, { lessonId: "box", boardId: "box-board", baseRevision: 0 });
  return new BrowserLessonSession(events, new MemoryStore(), "box-lesson");
}

function turn(current: BrowserLessonSession, nodeId: string, view: { yaw: number; pitch: number; zoom: number }) {
  const id = current.handleStudentScene3dInput(nodeId, current.scene3dViews[nodeId]!, { phase: "start", control: "orbit", input: "touch" });
  current.handleStudentScene3dInput(nodeId, view, { phase: "commit", control: "orbit", input: "touch", operation_id: id as string });
}

test("a lesson view turns the scene when its Beat plays, over an earlier learner turn", () => {
  const current = session();
  const nodeId = "box:node:box";
  while (!current.scene3dViews[nodeId]) current.advance();
  assert.deepEqual(current.scene3dViews[nodeId], { yaw: 0.7, pitch: 0.5, zoom: 1 });
  turn(current, nodeId, { yaw: 1.2, pitch: 0.3, zoom: 1.5 });
  assert.deepEqual(current.scene3dViews[nodeId], { yaw: 1.2, pitch: 0.3, zoom: 1.5 });
  while (current.projection.status !== "completed") current.advance();
  const view = current.scene3dViews[nodeId]!;
  assert.ok(Math.abs(view.pitch + Math.PI / 2) < 1e-9, "the lesson turned the box to show its bottom");
});

test("a learner turn after the lesson view keeps the learner's view", () => {
  const current = session();
  const nodeId = "box:node:box";
  while (current.projection.status !== "completed") current.advance();
  turn(current, nodeId, { yaw: 0.2, pitch: 0.1, zoom: 2 });
  assert.deepEqual(current.scene3dViews[nodeId], { yaw: 0.2, pitch: 0.1, zoom: 2 });
});
