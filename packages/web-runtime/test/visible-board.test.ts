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
