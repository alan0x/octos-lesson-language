import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContentBindings, validateAuthoringLesson, type AuthoringLesson } from "../../core/src/index.js";
import { PHYSICS_BUILDERS, PHYSICS_PLUGIN_MANIFEST, buildConstantSpeedMotion, buildSpringAndMass, niceAxisMax } from "../src/index.js";

const text = {
  title: "Spring", displacement: "displacement", anchor: "fixed end", equilibrium: "equilibrium", mass: "mass",
  restoring_force: "restoring force", plot_title: "Displacement against phase", phase: "phase", current_state: "now",
  link_label: "same moment", group_label: "spring and graph",
};

function validates(built: { actions: unknown[]; whole: string }, variables: unknown[]) {
  validateAuthoringLesson({
    dsl: "octos.lesson", version: "0.1", profile: "authoring",
    lesson: { mode: "explain", language: "en-US", title: "Spring", goals: ["Watch the spring"], variables },
    steps: [{ key: "s", purpose: "Show it", beats: [{ key: "b", say: "Here it is.", actions: built.actions }] }],
    close: { summary: "Done.", focus: [built.whole] },
  } as unknown as AuthoringLesson);
}

test("the physics plugin depends on shared and offers the spring", () => {
  assert.deepEqual(PHYSICS_PLUGIN_MANIFEST.depends, { shared: "0.1.0" });
  assert.deepEqual(Object.keys(PHYSICS_BUILDERS), ["spring_and_mass", "constant_speed_motion"]);
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

/** Authoring content with canonical fragment ids, as the player evaluates it. */
const canonical = (content: Record<string, any>) => JSON.parse(JSON.stringify(content).replace(/"as":/gu, '"id":'));

const motionText = {
  title: "A cart at constant speed", start: "start", object: "cart", distance_readout: "cart: s = ", distance_unit: "m",
  distance_axis: "distance s (m)", time_axis: "time t (s)", plot_title: "Distance against time", curve_label: "s = v t", current_state: "now",
  link_label: "same moment", group_label: "motion and graph",
};

test("constant-speed motion: time and speed sliders move the cart and the graph together", () => {
  const built = buildConstantSpeedMotion({
    as: "motion", role: "main_visual", place: { relation: "new_region" },
    time: { expression: "t", initial: 2, max: 10 }, speed: { expression: "v", initial: 3, max: 5 }, text: motionText,
  });
  validates(built, [
    { as: "t", initial: 2, min: 0, max: 10, label: "t", unit: "s", control: { kind: "slider", step: 0.1 } },
    { as: "v", initial: 3, min: 0.5, max: 5, label: "v", unit: "m/s", control: { kind: "slider", step: 0.5 } },
  ]);
  assert.deepEqual(built.actions.map((action) => action.do), ["write", "write", "connect", "group"]);
  assert.equal(built.parts.primary_control, "motion-graph#moving-point");
  assert.equal(built.parts.object, "motion-track#object");
  const track = (built.actions[0] as { content: Record<string, any> }).content;
  const graph = (built.actions[1] as { content: Record<string, any> }).content;
  assert.equal(graph.curves[0].expression, "(v)*x");
  assert.deepEqual(graph.axes.y, { min: 0, max: 50, label: "distance s (m)" });
  assert.equal(track.points.find((point: any) => point.as === "finish").x, 50);
  const evaluated = evaluateContentBindings(canonical(track), { t: 7, v: 4 }) as Record<string, any>;
  assert.equal(evaluated.points.find((point: any) => point.id === "object").x, 28);
  const plotted = evaluateContentBindings(canonical(graph), { t: 7, v: 4 }) as Record<string, any>;
  const point = plotted.points.find((entry: any) => entry.id === "moving-point");
  assert.deepEqual([point.x, point.y], [7, 28]);
});

test("constant-speed motion with a fixed speed and a fixed time is a still picture", () => {
  const still = buildConstantSpeedMotion({
    as: "still", role: "main_visual", place: { relation: "new_region" },
    time: { initial: 4, max: 8 }, speed: { initial: 1.5, max: 1.5 }, text: motionText,
  });
  validates(still, []);
  const track = (still.actions[0] as { content: Record<string, any> }).content;
  assert.equal(track.bindings, undefined);
  assert.equal(track.points.find((point: any) => point.as === "object").x, 6);
  assert.equal((still.actions[1] as { content: Record<string, any> }).content.curves[0].expression, "1.5*x");
  assert.equal(still.parts.primary_control, undefined);
});

test("constant-speed motion rejects a time or speed outside its range", () => {
  const base = { as: "m", role: "main_visual", place: { relation: "new_region" }, text: motionText };
  assert.throws(() => buildConstantSpeedMotion({ ...base, time: { initial: 11, max: 10 }, speed: { initial: 1, max: 2 } }));
  assert.throws(() => buildConstantSpeedMotion({ ...base, time: { initial: 1, max: 10 }, speed: { initial: 0, max: 2 } }));
  assert.throws(() => buildConstantSpeedMotion({ ...base, time: { initial: 0, max: 0 }, speed: { initial: 1, max: 2 } }));
});

test("axis maxima round up to 1, 2, 2.5 or 5 times a power of ten", () => {
  assert.deepEqual([50, 51, 7, 0.3, 120, 250, 1000].map(niceAxisMax), [50, 100, 10, 0.5, 200, 250, 1000]);
});
