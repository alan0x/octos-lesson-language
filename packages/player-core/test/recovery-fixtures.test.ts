import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  OllError,
  normalizeAuthoringLesson,
  parseAuthoringLessonJson,
  reduceCanonicalEvents,
  type AuthoringLesson,
  type CanonicalEvent,
} from "../../core/src/index.js";
import { HeadlessLessonPlayer, PlaybackError } from "../src/index.js";

interface RecoveryFixture {
  id: string;
  description: string;
  driver: string;
  requirements: string[];
  status?: "covered_in_octos_web";
  evidence?: string;
  expected: string;
}

const root = process.cwd();
const fixtures = JSON.parse(
  await readFile(resolve(root, "fixtures/recovery/manifest.json"), "utf8"),
) as RecoveryFixture[];
const manifest = JSON.parse(
  await readFile(resolve(root, "examples/manifest.json"), "utf8"),
) as Array<{
  name: string;
  lessonId: string;
  boardId: string;
  baseRevision: number;
  regionIntent?: "new_topic" | "continue_topic" | "extend_near_anchor";
}>;
const host = manifest.find((entry) => entry.name === "quadratic")!;
const sourceText = await readFile(
  resolve(root, "examples/quadratic/lesson.authoring.json"),
  "utf8",
);
const source = JSON.parse(sourceText) as AuthoringLesson;
const events = normalizeAuthoringLesson(source, host);

for (const fixture of fixtures.filter((item) => item.status === undefined)) {
  test(`${fixture.id} ${fixture.requirements.join(", ")}: ${fixture.description}`, () => {
    if (fixture.driver === "partial-json") {
      assert.throws(
        () => parseAuthoringLessonJson(sourceText.slice(0, -24)),
        (error) => error instanceof OllError && error.code === "OLL_INVALID_JSON",
      );
      return;
    }

    if (fixture.driver === "duplicate-step") {
      const prefix = events.slice(0, 2);
      const player = new HeadlessLessonPlayer(prefix, { allowIncomplete: true });
      player.playAll();
      const before = player.snapshot;
      assert.deepEqual(player.appendEvents([structuredClone(prefix[1]!)]), {
        accepted: 0,
        duplicates: 1,
        total_events: 2,
        closed: false,
      });
      assert.deepEqual(player.snapshot, before);
      return;
    }

    if (fixture.driver === "sequence-gap") {
      const prefix = events.slice(0, 2);
      const player = new HeadlessLessonPlayer(prefix, { allowIncomplete: true });
      const before = player.canonicalEvents;
      const gap = structuredClone(events[2]!);
      gap.sequence += 1;
      assert.throws(
        () => player.appendEvents([gap]),
        (error) =>
          error instanceof PlaybackError &&
          error.code === "OLL_PLAYBACK_SEQUENCE",
      );
      assert.deepEqual(player.canonicalEvents, before);
      return;
    }

    if (fixture.driver === "checkpoint-refresh") {
      const player = new HeadlessLessonPlayer(events);
      while (player.cursor < Math.floor(player.operations.length / 2)) {
        player.advance();
      }
      player.pause();
      const restored = HeadlessLessonPlayer.fromCheckpoint(
        events,
        JSON.parse(JSON.stringify(player.checkpoint())),
      );
      restored.resume();
      restored.playAll();
      assert.deepEqual(restored.finalState(), reduceCanonicalEvents(events));
      return;
    }

    if (fixture.driver === "log-rebuild") {
      const first = reduceCanonicalEvents(JSON.parse(JSON.stringify(events)));
      const second = reduceCanonicalEvents(JSON.parse(JSON.stringify(events)));
      assert.deepEqual(second, first);
      return;
    }

    if (fixture.driver === "invalid-later-step") {
      const prefix = events.slice(0, 3);
      const player = new HeadlessLessonPlayer(prefix, { allowIncomplete: true });
      player.playAll();
      const committed = structuredClone(player.snapshot.board);
      const invalid = structuredClone(events[3]!) as CanonicalEvent;
      const action = invalid.step!.beats[0]!.stage.during_speech[0]!;
      action.op = "board.execute-script";
      player.appendEvents([invalid]);
      player.resume();
      assert.throws(
        () => player.playAll(),
        (error) =>
          error instanceof OllError &&
          error.code === "OLL_INVALID_OPERATION",
      );
      assert.deepEqual(player.snapshot.board, committed);
      return;
    }

    assert.fail(`Recovery fixture driver '${fixture.driver}' is not implemented`);
  });
}

test("R-007 records its external Web Runtime conformance evidence", () => {
  const fixture = fixtures.find((item) => item.id === "R-007");
  assert.equal(fixture?.status, "covered_in_octos_web");
  assert.equal(fixture?.driver, "web-tts-failure");
  assert.equal(
    fixture?.evidence,
    "../octos-web/src/learning/oll/use-oll-narration-tts.test.ts",
  );
});
