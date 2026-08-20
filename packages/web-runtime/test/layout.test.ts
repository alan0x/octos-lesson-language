import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reduceCanonicalEvents, type SemanticBoardState } from "../../core/src/index.js";
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
  assert.ok(measureSemanticNode({ kind: "geometry", content: {} }).height > measureSemanticNode({ kind: "plot", content: {} }).height);
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

test("a new topic starts beyond prior group bounds without moving existing content", () => {
  const oldTopic: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      "old-a": {
        id: "old-a",
        region_id: "topic-old",
        content: { text: "旧课程" },
        placement: { relation: "new_region" },
      },
      "old-b": {
        id: "old-b",
        region_id: "topic-old",
        content: { text: "旧课程答案" },
        placement: { relation: "below", anchor: "old-a" },
      },
    },
    groups: {
      "old-group": {
        id: "old-group",
        members: ["old-a", "old-b"],
      },
    },
    connections: {},
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };
  const priorLayout = computeBoardLayout(oldTopic);
  const combined: SemanticBoardState = structuredClone(oldTopic);
  combined.nodes["new-a"] = {
    id: "new-a",
    region_id: "topic-new",
    content: { text: "圆周长公式" },
    placement: { relation: "new_region" },
  };
  combined.nodes["new-b"] = {
    id: "new-b",
    region_id: "topic-new",
    content: { text: "C = πd" },
    placement: { relation: "below", anchor: "new-a" },
  };

  const layout = computeBoardLayout(combined);
  assert.deepEqual(layout.nodes["old-a"], priorLayout.nodes["old-a"]);
  assert.deepEqual(layout.nodes["old-b"], priorLayout.nodes["old-b"]);
  const oldGroup = layout.groups["old-group"]!;
  assert.ok(layout.nodes["new-a"]!.x > oldGroup.x + oldGroup.width);
  assert.equal(layout.nodes["new-b"]!.x, layout.nodes["new-a"]!.x);
});

test("host course origins keep independent regions stable as content arrives", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      first: {
        id: "first",
        region_id: "course-a",
        content: { text: "第一课" },
        placement: { relation: "new_region" },
      },
      second: {
        id: "second",
        region_id: "course-b",
        content: { text: "第二课" },
        placement: { relation: "new_region" },
      },
    },
    groups: {},
    connections: {},
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };
  const constraints = {
    "course-a": { x: 420, y: 160, reservedWidth: 1_100 },
    "course-b": { x: 1_800, y: 160, reservedWidth: 1_100 },
  };
  const initial = computeBoardLayout(board, {}, { regions: constraints });
  assert.equal(initial.nodes.first?.x, 420);
  assert.equal(initial.nodes.second?.x, 1_800);
  assert.deepEqual(initial.regions?.["course-a"], initial.nodes.first);
  assert.deepEqual(initial.regions?.["course-b"], initial.nodes.second);

  board.nodes["first-detail"] = {
    id: "first-detail",
    region_id: "course-a",
    content: { text: "第一课后续分段内容" },
    placement: { relation: "below", anchor: "first" },
  };
  const expanded = computeBoardLayout(board, {}, { regions: constraints });
  assert.equal(expanded.nodes.first?.x, initial.nodes.first?.x);
  assert.equal(expanded.nodes.second?.x, initial.nodes.second?.x);
  assert.ok(expanded.regions!["course-a"]!.height > initial.regions!["course-a"]!.height);
});

test("connected visual nodes in one region are laid out as one nearby teaching scene", () => {
  const related: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      geometry: {
        id: "geometry",
        kind: "geometry",
        region_id: "topic",
        content: {},
        placement: { relation: "new_region" },
      },
      plot: {
        id: "plot",
        kind: "plot",
        region_id: "topic",
        content: {},
        placement: { relation: "new_region" },
      },
    },
    groups: {},
    connections: {
      mapping: {
        id: "mapping",
        from: { node_id: "geometry" },
        to: { node_id: "plot" },
        relation: "maps_to",
      },
    },
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };
  const layout = computeBoardLayout(related);
  const geometry = layout.nodes.geometry!;
  const plot = layout.nodes.plot!;
  assert.equal(plot.x - (geometry.x + geometry.width), 54);
  assert.ok(Math.abs((plot.y + plot.height / 2) - (geometry.y + geometry.height / 2)) < .001);
});

test("a later connection cannot reuse an occupied teaching-scene column", () => {
  const related: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: Object.fromEntries(["geometry", "plot", "formula"].map((id) => [id, {
      id,
      kind: id === "geometry" ? "geometry" : id === "plot" ? "plot" : "math",
      region_id: "topic",
      content: {},
      placement: { relation: "new_region" },
    }])),
    groups: {},
    connections: {
      mapping: {
        id: "mapping",
        from: { node_id: "geometry" },
        to: { node_id: "plot" },
        relation: "maps_to",
      },
      explanation: {
        id: "explanation",
        from: { node_id: "geometry" },
        to: { node_id: "formula" },
        relation: "explains",
      },
    },
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };
  const layout = computeBoardLayout(related);
  const plot = layout.nodes.plot!;
  const formula = layout.nodes.formula!;
  assert.ok(formula.y >= plot.y + plot.height, "the third node starts a new row");
});
