import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertAuthoringSchema,
  deriveExecutionRequirements,
  normalizeAuthoringLesson,
  OllError,
  validateAuthoringLesson,
  validateAuthoringSchema,
  type AuthoringLesson,
  type NormalizationHost,
} from "../src/index.js";

const root = process.cwd();
const unitCircle = JSON.parse(await readFile(resolve(root, "examples/learner-taught-unit-circle-v1/lesson.authoring.json"), "utf8")) as AuthoringLesson;
const host: NormalizationHost = { lessonId: "lesson-learner-001", boardId: "board-learner-001", baseRevision: 0, regionIntent: "new_topic" };
const author = {
  kind: "learner" as const,
  learner_ref: "learner:demo-riley",
  presented_by: { avatar_ref: "avatar:owl", voice_ref: "voice:learner-bright-2" },
};

export function learnerLesson(source: AuthoringLesson = unitCircle): AuthoringLesson {
  const lesson = structuredClone(source);
  lesson.lesson.mode = "learner_taught";
  lesson.lesson.author = structuredClone(author);
  return lesson;
}

function rejects(lesson: AuthoringLesson, code: string, path?: string) {
  assert.throws(() => validateAuthoringLesson(lesson), (error: unknown) => {
    assert.ok(error instanceof OllError);
    assert.equal(error.code, code);
    if (path) assert.equal(error.path, path);
    return true;
  });
}

test("a learner-taught lesson names its learner author and needs player 0.6.0", () => {
  const lesson = learnerLesson();
  assertAuthoringSchema(lesson);
  validateAuthoringLesson(lesson);
  const events = normalizeAuthoringLesson(lesson, host);
  assert.equal(events[0]!.lesson?.mode, "learner_taught");
  assert.deepEqual(events[0]!.lesson?.author, author);
  const requirements = deriveExecutionRequirements(events);
  assert.ok(requirements.requiredCapabilities.includes("lesson-mode:learner_taught"));
  assert.equal(requirements.minimumPlayerVersion, "0.6.0");
});

test("lesson modes cannot be mixed up", () => {
  const withoutAuthor = learnerLesson();
  delete withoutAuthor.lesson.author;
  rejects(withoutAuthor, "OLL_INVALID_OPERATION_PAYLOAD", "/lesson/author");
  const explainWithAuthor = learnerLesson();
  explainWithAuthor.lesson.mode = "explain";
  rejects(explainWithAuthor, "OLL_INVALID_OPERATION_PAYLOAD", "/lesson/author");
});

test("an author is referenced opaquely, never by name or email", () => {
  for (const learner_ref of ["learner:Riley Smith", "riley@example.com", "learner:"]) {
    const lesson = learnerLesson();
    lesson.lesson.author!.learner_ref = learner_ref;
    assert.equal(validateAuthoringSchema(lesson).valid, false, learner_ref);
  }
});

test("explain lessons keep requiring only their existing player version", () => {
  const requirements = deriveExecutionRequirements(normalizeAuthoringLesson(unitCircle, host));
  assert.ok(!requirements.requiredCapabilities.includes("lesson-mode:learner_taught"));
});
