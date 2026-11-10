import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import { PHYSICS_BUILDERS, PHYSICS_PLUGIN_MANIFEST, buildSpringAndMass } from "../src/index.js";

const text = {
  title: "Spring", displacement: "displacement", anchor: "fixed end", equilibrium: "equilibrium", mass: "mass",
  restoring_force: "restoring force", plot_title: "Displacement against phase", phase: "phase", current_state: "now",
  link_label: "same moment", group_label: "spring and graph",
};

function validates(built: ReturnType<typeof buildSpringAndMass>, variables: unknown[]) {
  validateAuthoringLesson({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Spring", goals: ["Watch the spring"], variables },
    steps: [{ key: "s", purpose: "Show it", beats: [{ key: "b", say: "Here it is.", actions: built.actions }] }],
    close: { summary: "Done.", focus: [built.whole] },
  } as unknown as AuthoringLesson);
}

test("the physics plugin depends on shared and offers the spring", () => {
  assert.deepEqual(PHYSICS_PLUGIN_MANIFEST.depends, { shared: "0.1.0" });
  assert.deepEqual(Object.keys(PHYSICS_BUILDERS), ["spring_and_mass"]);
});

test("a spring driven by a phase moves its mass and its graph point together", () => {
  const driven = buildSpringAndMass({
    as: "spring", role: "main_visual", place: { relation: "new_region" },
    phase: { expression: "n1", initial: 0, min: 0, max: 2 * Math.PI }, text,
  });
  validates(driven, [{ as: "n1", initial: 0, min: 0, max: 2 * Math.PI, label: "phase", unit: "rad", control: { kind: "slider", step: 0.01 } }]);
  assert.deepEqual(driven.actions.map((action) => action.do), ["write", "write", "connect", "group"]);
  assert.equal(driven.parts.primary_control, "spring-plot#moving-point");

  const fixed = buildSpringAndMass({ as: "still", role: "main_visual", place: { relation: "new_region" }, fixed_phase: Math.PI, text });
  validates(fixed, []);
  const geometry = (fixed.actions[0] as { content: Record<string, any> }).content;
  assert.equal(geometry.bindings, undefined);
  assert.equal(geometry.points[2].x, -1);
});
