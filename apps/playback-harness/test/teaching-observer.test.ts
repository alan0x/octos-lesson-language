import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTeachingObservation, type TeachingFrameObservation } from "../src/teaching-observer.js";

function observation(overrides: Partial<TeachingFrameObservation> = {}): TeachingFrameObservation {
  return {
    profile: "octos.teaching-playback.observation", version: "0.1", lesson_id: "lesson-1", cursor: 10,
    operation_type: "beat.end", beat_id: "beat-1", viewport: { width: 960, height: 608 }, world_scale: 1,
    node_count: 2, connection_count: 0, group_count: 0, new_nodes: 1, new_connections: 0, new_groups: 0,
    focus_targets: ["node-1"],
    focal_nodes: [{ id: "node-1", kind: "math", x: 100, y: 100, width: 320, height: 120, visible: true, fully_in_view: true }],
    active_targets: [], min_focal_node_width: 320, min_focal_body_font_px: 18, min_focal_diagram_edge_px: null,
    math_errors: 0, content_overflows: [], label_node_overlaps: [], duplicate_internal_connections: [],
    ...overrides,
  };
}

test("teaching observer accepts a readable beat boundary", () => {
  assert.deepEqual(evaluateTeachingObservation(observation()), { passed: true, issues: [] });
});

test("teaching observer reports independent browser rendering failures", () => {
  const result = evaluateTeachingObservation(observation({
    min_focal_node_width: 180, min_focal_body_font_px: 12, content_overflows: ["math-1"],
    label_node_overlaps: [{ label_id: "edge-1", node_id: "math-1" }],
  }));
  assert.equal(result.passed, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "G3_CONTENT_OVERFLOW", "G1_LABEL_NODE_OVERLAP", "G3_FOCUS_TOO_SMALL", "G3_TEXT_TOO_SMALL",
  ]);
});

test("action frames require their active target to be visible", () => {
  const result = evaluateTeachingObservation(observation({
    operation_type: "action.apply", action_op: "board.emphasize",
    active_targets: [{ id: "fragment-1", kind: "diagram-edge", x: -20, y: 10, width: 10, height: 80, visible: false, fully_in_view: false }],
  }));
  assert.deepEqual(result.issues.map((issue) => issue.code), ["G1_ACTIVE_TARGET_NOT_VISIBLE"]);
});
