import test from "node:test";
import assert from "node:assert/strict";
import {
  describeBoardTarget,
  pointInPolygon,
  rankBoardTargets,
  targetQueryScore,
  type BoardTargetCandidate,
} from "../src/board-targets.js";

test("board targets expose semantic plot and 3D values instead of DOM-only ids", () => {
  const plot = {
    kind: "plot",
    content: {
      curves: [{ id: "lesson:node:plot:fragment:sine", label: "y = sin x", expression: "sin(x)" }],
      points: [{ id: "lesson:node:plot:fragment:peak", label: "π/2", x: 1.5708, y: 1 }],
    },
  };
  assert.deepEqual(
    describeBoardTarget(plot, "lesson:node:plot:fragment:peak"),
    {
      kind: "plot-point",
      label: "π/2",
      value: { x: 1.5708, y: 1 },
    },
  );

  const scene = {
    kind: "scene3d",
    content: {
      highlights: [{
        id: "lesson:node:cube:fragment:top-face",
        kind: "face",
        label: "上表面",
        points: [{ x: 0, y: 0, z: 1 }],
      }],
    },
  };
  assert.deepEqual(
    describeBoardTarget(scene, "lesson:node:cube:fragment:top-face"),
    {
      kind: "scene3d-face",
      label: "上表面",
      value: { points: [{ x: 0, y: 0, z: 1 }] },
    },
  );
});

test("target queries honor a closed selection path and rank fragments before cards", () => {
  const path = [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 50 },
    { x: 10, y: 50 },
  ];
  assert.equal(pointInPolygon({ x: 20, y: 20 }, path), true);
  assert.equal(pointInPolygon({ x: 80, y: 80 }, path), false);
  assert.deepEqual(
    targetQueryScore(
      { x: 20, y: 20, width: 10, height: 10 },
      { bounds: { x: 10, y: 10, width: 40, height: 40 }, path },
    ),
    { overlap: 1, distance: 7.0710678118654755 },
  );
  assert.equal(
    targetQueryScore(
      { x: 70, y: 70, width: 10, height: 10 },
      { bounds: { x: 10, y: 10, width: 40, height: 40 }, path },
    ),
    undefined,
  );

  const base = {
    node_id: "lesson:node:plot",
    kind: "node" as const,
    world_bounds: { x: 0, y: 0, width: 300, height: 200 },
    overlap: .3,
    distance: 0,
    z_index: 1,
  };
  const candidates: BoardTargetCandidate[] = [
    { ...base, target_id: base.node_id },
    {
      ...base,
      target_id: "lesson:node:plot:fragment:peak",
      element_id: "lesson:node:plot:fragment:peak",
      kind: "plot-point",
      world_bounds: { x: 20, y: 20, width: 8, height: 8 },
      overlap: 1,
    },
  ];
  assert.equal(rankBoardTargets(candidates)[0]?.kind, "plot-point");
});
