import test from "node:test";
import assert from "node:assert/strict";
import type { SemanticBoardState } from "../../core/src/index.js";
import { visibleBoard } from "../src/visible-board.js";

function board(nodes: Array<Record<string, unknown>>, extra: Partial<SemanticBoardState> = {}): SemanticBoardState {
  return {
    board_id: "b", revision: 1, focus: [], groups: {}, connections: {},
    applied_lessons: [], applied_steps: [], applied_actions: [],
    nodes: Object.fromEntries(nodes.map((node) => [node.id as string, { content: {}, ...node }])) as SemanticBoardState["nodes"],
    ...extra,
  };
}

const grid = { id: "grid", kind: "geometry", placement: { relation: "new_region" } };
const ink = { id: "ink", kind: "ink", placement: { relation: "below", anchor: "grid" } };
const note = { id: "note", kind: "note", placement: { relation: "below", anchor: "ink" } };
const neat = { id: "neat", kind: "math", placement: { relation: "replaces", anchor: "ink" } };

test("a board with nothing hidden is unchanged", () => {
  const state = board([grid, ink]);
  assert.equal(visibleBoard(state), state);
});

test("a replacement takes the replaced card's place, placement and followers", () => {
  const state = board([grid, { ...ink, hidden: true, replaced_by: "neat" }, note, neat], { focus: ["ink", "note"] });
  const shown = visibleBoard(state);
  assert.deepEqual(Object.keys(shown.nodes), ["grid", "neat", "note"]);
  assert.deepEqual(shown.nodes.neat!.placement, { relation: "below", anchor: "grid" });
  assert.deepEqual(shown.nodes.note!.placement, { relation: "below", anchor: "neat" });
  assert.deepEqual(shown.focus, ["neat", "note"]);
});

test("a hidden card leaves; its followers anchor where it was anchored", () => {
  const state = board([grid, { ...ink, hidden: true }, note], {
    groups: { pair: { id: "pair", members: ["grid", "ink"] } },
    connections: { arrow: { id: "arrow", from: { node_id: "ink" }, to: { node_id: "grid" } }, keep: { id: "keep", from: { node_id: "note" }, to: { node_id: "grid" } } },
  });
  const shown = visibleBoard(state);
  assert.deepEqual(Object.keys(shown.nodes), ["grid", "note"]);
  assert.deepEqual(shown.nodes.note!.placement, { relation: "below", anchor: "grid" });
  assert.deepEqual(shown.groups.pair!.members, ["grid"]);
  assert.deepEqual(Object.keys(shown.connections), ["keep"]);
});

test("a chain of replacements shows only the last one, in the first card's place", () => {
  const second = { id: "second", kind: "math", placement: { relation: "replaces", anchor: "neat" } };
  const state = board([grid, { ...ink, hidden: true, replaced_by: "neat" }, { ...neat, hidden: true, replaced_by: "second" }, second]);
  const shown = visibleBoard(state);
  assert.deepEqual(Object.keys(shown.nodes), ["grid", "second"]);
  assert.deepEqual(shown.nodes.second!.placement, { relation: "below", anchor: "grid" });
});

test("neat math that replaces handwriting drawn on a card sits over that handwriting", () => {
  const box = { x: 0.1, y: 0.6, width: 0.3, height: 0.2 };
  const drawn = { id: "ink", kind: "ink", content: { annotation: box }, placement: { relation: "annotates", anchor: "grid" }, hidden: true, replaced_by: "neat" };
  const shown = visibleBoard(board([grid, drawn, neat]));
  assert.deepEqual(shown.nodes.neat!.placement, { relation: "annotates", anchor: "grid", annotation: box });
});

test("a continuation whose card left the board keeps its place (player 0.9.0)", () => {
  const formula = { id: "formula", kind: "math", placement: { relation: "new_region" } };
  const steps = { id: "steps", kind: "ink", placement: { relation: "continues", anchor: "formula", offset: { x: 10, y: 80 } } };
  const result = { id: "result", kind: "ink", placement: { relation: "continues", anchor: "steps", offset: { x: 4, y: 60 } } };
  // The middle card is erased: what continued it now continues the formula, at the same place.
  let shown = visibleBoard(board([formula, { ...steps, hidden: true }, result]));
  assert.deepEqual(shown.nodes.result!.placement, { relation: "continues", anchor: "formula", offset: { x: 14, y: 140 } });
  // The middle card is made neat: what continued it continues the neat math.
  const neatSteps = { id: "neat-steps", kind: "math", placement: { relation: "replaces", anchor: "steps" } };
  shown = visibleBoard(board([formula, { ...steps, hidden: true, replaced_by: "neat-steps" }, neatSteps, result]));
  assert.deepEqual(shown.nodes["neat-steps"]!.placement, steps.placement);
  // Asking to line up, the neat math continues the formula with its "=" lined up.
  const aligned = { ...neatSteps, placement: { ...neatSteps.placement, align: "equals" } };
  assert.deepEqual(visibleBoard(board([formula, { ...steps, hidden: true, replaced_by: "neat-steps" }, aligned])).nodes["neat-steps"]!.placement,
    { ...steps.placement, align: "equals" });
  assert.deepEqual(shown.nodes.result!.placement, { relation: "continues", anchor: "neat-steps", offset: { x: 4, y: 60 } });
  // The first card is erased: the next one takes its place on the board.
  shown = visibleBoard(board([{ ...formula, hidden: true }, steps, result]));
  assert.deepEqual(shown.nodes.steps!.placement, { relation: "new_region" });
  assert.deepEqual(shown.nodes.result!.placement, result.placement);
});
