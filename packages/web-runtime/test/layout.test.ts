import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reduceCanonicalEvents } from "../../core/src/index.js";
import { computeBoardLayout, measureSemanticNode, targetRect } from "../src/layout.js";
import { parseCanonicalJsonl } from "../src/runtime.js";

const source = await readFile(resolve(process.cwd(), "examples/quadratic/lesson.canonical.jsonl"), "utf8");
const state = reduceCanonicalEvents(parseCanonicalJsonl(source));

test("semantic placements produce finite browser rectangles", () => {
  const layout = computeBoardLayout(state);
  assert.equal(Object.keys(layout.nodes).length, Object.keys(state.nodes).length);
  assert.equal(Object.keys(layout.groups).length, Object.keys(state.groups).length);
  for (const rect of [...Object.values(layout.nodes), ...Object.values(layout.groups)]) {
    assert.ok(Number.isFinite(rect.x) && Number.isFinite(rect.y));
    assert.ok(rect.width > 0 && rect.height > 0);
  }
  assert.ok(layout.bounds.width > 600);
  assert.ok(layout.bounds.height > 400);
});

test("layout resolves node, group and connection targets", () => {
  const layout = computeBoardLayout(state);
  const nodeId = Object.keys(state.nodes)[0]!;
  const groupId = Object.keys(state.groups)[0]!;
  const connectionId = Object.keys(state.connections)[0]!;
  assert.ok(targetRect(state, layout, { node_id: nodeId }));
  assert.ok(targetRect(state, layout, { group_id: groupId }));
  assert.ok(targetRect(state, layout, { connection_id: connectionId }));
});

test("node measurement expands visual-heavy kinds", () => {
  assert.ok(measureSemanticNode({ kind: "plot", content: {} }).height > measureSemanticNode({ kind: "text", content: { text: "短句" } }).height);
  assert.ok(measureSemanticNode({ kind: "table", content: { columns: [1, 2, 3, 4], rows: [[1, 2, 3, 4]] } }).width >= 400);
});

test("node measurement ignores canonical identifiers that are not rendered", () => {
  const visible = { kind: "math", content: { fragments: [{ latex: "x=1" }] } };
  const canonical = { kind: "math", content: { fragments: [{ id: "lesson:a-very-long-canonical-fragment-identifier", latex: "x=1" }] } };
  assert.deepEqual(measureSemanticNode(canonical), measureSemanticNode(visible));
});

test("measured browser heights replace estimates and move dependent nodes", () => {
  const firstNodeId = Object.keys(state.nodes)[0]!;
  const dependentNode = Object.values(state.nodes).find((node) => node.placement?.anchor === firstNodeId && node.placement?.relation === "below");
  assert.ok(dependentNode);
  const estimated = computeBoardLayout(state);
  const expanded = computeBoardLayout(state, {
    [firstNodeId]: { width: estimated.nodes[firstNodeId]!.width, height: estimated.nodes[firstNodeId]!.height + 180 },
  });
  assert.equal(expanded.nodes[firstNodeId]!.height, estimated.nodes[firstNodeId]!.height + 180);
  assert.ok(expanded.nodes[dependentNode.id]!.y >= expanded.nodes[firstNodeId]!.y + expanded.nodes[firstNodeId]!.height);
  assert.ok(expanded.nodes[dependentNode.id]!.y > estimated.nodes[dependentNode.id]!.y);
});
