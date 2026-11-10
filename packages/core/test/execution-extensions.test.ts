import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDeclarationPlayable, assertExecutionDeclaration, assertExecutionSupported, composeExecutionFeatures, deriveExecutionRequirements,
  normalizeAuthoringLesson, OLL_EXECUTION_FEATURES, type AuthoringLesson, type ExecutionExtension,
} from "../src/index.js";
import { compilePlaybackOperations } from "../../player-core/src/index.js";

// A stand-in physics plugin: a geometry card titled "vectors" uses its vector feature.
const physics = (version: string, introducedIn = "0.2.0"): ExecutionExtension => ({
  plugin: { id: "physics", version },
  features: { "plugin:physics/vectors@1": introducedIn },
  detect: (content, kind, use) => { if (kind === "geometry" && content.title === "vectors") use("plugin:physics/vectors@1"); },
});

function events(title: string) {
  const lesson = {
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Forces", goals: ["See the forces"] },
    steps: [{ key: "s", purpose: "Show", beats: [{ key: "b", say: "Look.", actions: [{ do: "write", as: "card", kind: "geometry", role: "diagram",
      content: { title, axes: { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, equal_scale: true }, points: [{ as: "o", x: 0, y: 0 }] }, place: { relation: "new_region" } }] }] }],
    close: { summary: "Done.", focus: ["card"] },
  } as unknown as AuthoringLesson;
  return normalizeAuthoringLesson(lesson, { lessonId: "l", boardId: "b", baseRevision: 0 });
}

test("a lesson without plugin features is unchanged by installed extensions", () => {
  const plain = events("forces");
  assert.deepEqual(deriveExecutionRequirements(plain, { extensions: [physics("0.2.0")] }), deriveExecutionRequirements(plain));
  assert.equal(deriveExecutionRequirements(plain).requiredPlugins, undefined);
});

test("a plugin feature is required with its plugin version, not a player version", () => {
  const vectors = events("vectors");
  const requirements = deriveExecutionRequirements(vectors, { extensions: [physics("0.3.0")] });
  assert.ok(requirements.requiredCapabilities.includes("plugin:physics/vectors@1"));
  assert.deepEqual(requirements.requiredPlugins, { physics: "0.2.0" });
  assert.equal(requirements.minimumPlayerVersion, deriveExecutionRequirements(events("forces")).minimumPlayerVersion);
  assert.doesNotThrow(() => assertExecutionSupported(vectors, undefined, undefined, { extensions: [physics("0.3.0")] }));
  assert.doesNotThrow(() => compilePlaybackOperations(vectors, { executionExtensions: [physics("0.3.0")] }));
});

test("a player without the plugin, or with an older one, refuses before playback", () => {
  const vectors = events("vectors");
  const declared = deriveExecutionRequirements(vectors, { extensions: [physics("0.3.0")] });
  assert.doesNotThrow(() => assertDeclarationPlayable(declared, undefined, { extensions: [physics("0.3.0")] }));
  assert.throws(() => assertDeclarationPlayable(declared, undefined, {}), /requires the 'physics' plugin, which is not installed/);
  const older: ExecutionExtension = { plugin: { id: "physics", version: "0.1.0" }, features: {} };
  assert.throws(() => assertDeclarationPlayable(declared, undefined, { extensions: [older] }), /'plugin:physics\/vectors@1', which the installed 'physics' plugin 0.1.0 does not have/);
  assert.throws(() => assertDeclarationPlayable({ minimumPlayerVersion: "99.0.0" }), /requires player 99.0.0/);
  // An older plugin cannot even declare a feature it does not have yet.
  assert.throws(() => composeExecutionFeatures([physics("0.1.0")]), /needs plugin physics 0.2.0, newer than installed 0.1.0/);
  // Detected but undeclared by any installed plugin: refused, never played without it.
  const detectingOnly: ExecutionExtension = { plugin: { id: "physics", version: "0.3.0" }, features: {}, detect: physics("0.3.0").detect };
  assert.throws(() => compilePlaybackOperations(vectors, { executionExtensions: [detectingOnly] }), /Unsupported executable capability 'plugin:physics\/vectors@1'/);
});

test("a declaration must name the plugin features a lesson uses", () => {
  const vectors = events("vectors");
  const extensions = [physics("0.2.0")];
  const derived = deriveExecutionRequirements(vectors, { extensions });
  assert.doesNotThrow(() => assertExecutionDeclaration(vectors, { minimumPlayerVersion: derived.minimumPlayerVersion, requiredCapabilities: derived.requiredCapabilities }, { extensions }));
  assert.throws(() => assertExecutionDeclaration(vectors, {
    minimumPlayerVersion: derived.minimumPlayerVersion,
    requiredCapabilities: derived.requiredCapabilities.filter((feature) => !feature.startsWith("plugin:")),
  }, { extensions }), /Declaration omits 'plugin:physics\/vectors@1'/);
});

test("plugins may only declare their own namespaced features, once each", () => {
  assert.throws(() => composeExecutionFeatures([{ plugin: { id: "physics", version: "1.0.0" }, features: { "variables": "0.1.0" } }]), /may only declare features named/);
  assert.throws(() => composeExecutionFeatures([{ plugin: { id: "physics", version: "1.0.0" }, features: { "plugin:math/vectors@1": "0.1.0" } }]), /may only declare features named/);
  assert.throws(() => composeExecutionFeatures([physics("0.2.0"), physics("0.2.0")]), /installed twice/);
  assert.throws(() => composeExecutionFeatures([{ plugin: { id: "Physics", version: "1.0.0" }, features: {} }]), /Invalid plugin id/);
  assert.equal(composeExecutionFeatures([physics("0.2.0")])["plugin:physics/vectors@1"], "0.2.0");
  assert.equal(composeExecutionFeatures()["variables"], OLL_EXECUTION_FEATURES["variables"]);
});

test("a lesson that needs a plugin must declare its capabilities, even at core 0.1.0", () => {
  const vectors = events("vectors");
  const extensions = [physics("0.2.0")];
  assert.equal(deriveExecutionRequirements(vectors, { extensions }).minimumPlayerVersion, deriveExecutionRequirements(events("forces")).minimumPlayerVersion);
  assert.throws(() => assertExecutionDeclaration(vectors, { minimumPlayerVersion: "0.1.0" }, { extensions }), /require a capability declaration/);
});

test("a revision reaches detectors with the kind of the node it revises", () => {
  const base = events("plain");
  const card = base.flatMap((event) => event.step?.beats ?? []).flatMap((beat) => Object.values(beat.stage).flat()).find((action) => action.node)!;
  const revision = structuredClone(base);
  const beat = revision.find((event) => event.step)!.step!.beats[0]!;
  beat.stage.after_speech = [...(beat.stage.after_speech ?? []), {
    action_id: "l:action:revise", op: "board.revise", target: { node_id: card.node!.id },
    revision: { content: { ...card.node!.content, title: "vectors" }, reason: "now with vectors" },
  } as never];
  assert.deepEqual(deriveExecutionRequirements(revision, { extensions: [physics("0.2.0")] }).requiredPlugins, { physics: "0.2.0" });
});

test("a plugin id that names an inherited property is still counted correctly", () => {
  const ctor: ExecutionExtension = { plugin: { id: "constructor", version: "1.0.0" }, features: { "plugin:constructor/x@1": "1.0.0" }, detect: (_content, _kind, use) => use("plugin:constructor/x@1") };
  assert.deepEqual(deriveExecutionRequirements(events("plain"), { extensions: [ctor] }).requiredPlugins, { constructor: "1.0.0" });
});
