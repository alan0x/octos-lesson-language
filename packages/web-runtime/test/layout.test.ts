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

test("host course origins are not shifted away from the question card", () => {
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
    },
    groups: {},
    connections: {},
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };

  const layout = computeBoardLayout(board, {}, {
    regions: {
      "course-a": { x: 320, y: 0, reservedWidth: 1_100 },
    },
  });

  assert.equal(layout.nodes.first?.x, 320);
  assert.equal(layout.nodes.first?.y, 0);
});

test("long below chains wrap into readable columns inside one course region", () => {
  const nodeIds = Array.from({ length: 12 }, (_unused, index) => `formula-${index + 1}`);
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: Object.fromEntries(nodeIds.map((id, index) => [id, {
      id,
      kind: "math",
      region_id: "course-a",
      content: { latex: `S_${index + 1}=a_1+\\cdots+a_n` },
      placement: index === 0
        ? { relation: "new_region" }
        : { relation: "below", anchor: nodeIds[index - 1], gap: "normal" },
    }])),
    groups: {},
    connections: {},
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };

  const layout = computeBoardLayout(board, {}, {
    regions: { "course-a": { x: 420, y: 160, reservedWidth: 1_100 } },
  });
  const first = layout.nodes[nodeIds[0]!]!;
  const last = layout.nodes[nodeIds.at(-1)!]!;
  assert.ok(last.x > first.x, "the chain should continue in a later column");
  assert.ok(layout.regions!["course-a"]!.height <= 1_150);
  assert.ok(layout.regions!["course-a"]!.width > first.width * 2);
});

test("reading flow keeps one visual lane beside an ordered derivation lane", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      visual: {
        id: "visual",
        kind: "geometry",
        region_id: "course-a",
        content: {},
        placement: { relation: "new_region" },
      },
      first: {
        id: "first",
        kind: "math",
        region_id: "course-a",
        content: { latex: "a" },
        placement: { relation: "new_region" },
      },
      second: {
        id: "second",
        kind: "math",
        region_id: "course-a",
        content: { latex: "b" },
        placement: { relation: "below", anchor: "visual" },
      },
      third: {
        id: "third",
        kind: "math",
        region_id: "course-a",
        content: { latex: "c" },
        placement: { relation: "below", anchor: "second" },
      },
    },
    groups: {},
    connections: {},
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };
  const layout = computeBoardLayout(board, {
    visual: { width: 380, height: 300 },
    first: { width: 440, height: 96 },
    second: { width: 440, height: 96 },
    third: { width: 440, height: 96 },
  }, {
    regions: {
      "course-a": { x: 420, y: 160, reservedWidth: 1_100, flow: "reading" },
    },
  });
  assert.deepEqual([layout.nodes.first!.y, layout.nodes.second!.y, layout.nodes.third!.y], [160, 284, 408]);
  assert.ok(layout.nodes.first!.x >= layout.nodes.visual!.x + layout.nodes.visual!.width + 54);
});

test("reading flow starts a new narrative column after four cards", () => {
  const ids = Array.from({ length: 9 }, (_unused, index) => `card-${index + 1}`);
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: Object.fromEntries(ids.map((id) => [id, {
      id,
      kind: "math",
      region_id: "course-a",
      content: { latex: id },
      placement: { relation: "new_region" },
    }])),
    groups: {}, connections: {}, focus: [], applied_lessons: [], applied_steps: [], applied_actions: [],
  };
  const layout = computeBoardLayout(board, Object.fromEntries(ids.map((id) => [id, { width: 320, height: 96 }])), {
    regions: { "course-a": { x: 420, y: 160, reservedWidth: 1_100, flow: "reading" } },
  });
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const x = layout.nodes[id]!.x;
    columns.set(x, [...(columns.get(x) ?? []), id]);
  }
  assert.equal(columns.size, 3);
  assert.deepEqual([...columns.values()].map((column) => column.length), [4, 4, 1]);
  assert.ok(layout.regions!["course-a"]!.height <= 760);
});

test("host controls reserve board space below their semantic visual", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      plot: {
        id: "plot",
        kind: "plot",
        region_id: "course-a",
        content: {},
        placement: { relation: "new_region" },
      },
      formula: {
        id: "formula",
        kind: "math",
        region_id: "course-a",
        content: { latex: "y=x^2" },
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
  const layout = computeBoardLayout(board, {
    plot: { width: 340, height: 230 },
    formula: { width: 440, height: 96 },
  }, {
    regions: {
      "course-a": {
        x: 420,
        y: 160,
        reservedWidth: 1_100,
        flow: "reading",
        attachments: [{
          id: "course-a:controls",
          anchorNodeId: "plot",
          width: 520,
          height: 120,
          gap: 42,
        }],
      },
    },
  });
  const controls = layout.attachments["course-a:controls"]!;
  assert.equal(controls.x, layout.nodes.plot!.x);
  assert.equal(controls.y, layout.nodes.plot!.y + layout.nodes.plot!.height + 42);
  assert.ok(layout.regions!["course-a"]!.y + layout.regions!["course-a"]!.height >= controls.y + controls.height);
});

test("one interaction attachment stays with its complete linked visual scene", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      geometry: {
        id: "geometry",
        kind: "geometry",
        region_id: "course-a",
        content: {},
        placement: { relation: "new_region" },
      },
      plot: {
        id: "plot",
        kind: "plot",
        region_id: "course-a",
        content: {},
        placement: { relation: "right_of", anchor: "geometry", gap: "normal" },
      },
      formula: {
        id: "formula",
        kind: "math",
        region_id: "course-a",
        content: { latex: "y=\\sin\\theta" },
        placement: { relation: "new_region" },
      },
      note: {
        id: "note",
        kind: "note",
        region_id: "course-a",
        content: { title: "旋转与波动", items: ["圆上点的高度映射为正弦值"] },
        placement: { relation: "below", anchor: "formula" },
      },
    },
    groups: {},
    connections: {},
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };
  const layout = computeBoardLayout(board, {
    geometry: { width: 420, height: 320 },
    plot: { width: 360, height: 280 },
    formula: { width: 300, height: 100 },
    note: { width: 360, height: 130 },
  }, {
    regions: {
      "course-a": {
        x: 320,
        y: 160,
        reservedWidth: 1_300,
        flow: "reading",
        attachments: [{
          id: "course-a:interaction",
          anchorNodeId: "plot",
          anchorNodeIds: ["geometry", "plot"],
          width: 360,
          height: 250,
          gap: 42,
        }],
      },
    },
  });

  const geometry = layout.nodes.geometry!;
  const plot = layout.nodes.plot!;
  const formula = layout.nodes.formula!;
  const note = layout.nodes.note!;
  const interaction = layout.attachments["course-a:interaction"]!;
  const visualLeft = Math.min(geometry.x, plot.x);
  const visualRight = Math.max(
    geometry.x + geometry.width,
    plot.x + plot.width,
  );
  const visualBottom = Math.max(
    geometry.y + geometry.height,
    plot.y + plot.height,
  );

  assert.equal(interaction.x, visualLeft);
  assert.equal(interaction.y, visualBottom + 42);
  assert.ok(formula.x >= visualRight + 54);
  assert.equal(formula.y, 160);
  assert.equal(note.x, formula.x);
  assert.ok(note.y > formula.y);
  assert.ok(note.y + note.height < interaction.y + interaction.height);
});

test("an independent formula starts below a linked visual row", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      geometry: {
        id: "geometry",
        kind: "geometry",
        region_id: "course-a",
        content: {},
        placement: { relation: "new_region" },
      },
      plot: {
        id: "plot",
        kind: "plot",
        region_id: "course-a",
        content: {},
        placement: { relation: "right_of", anchor: "geometry", gap: "normal" },
      },
      formula: {
        id: "formula",
        kind: "math",
        region_id: "course-a",
        content: { latex: "y=\\sin\\theta" },
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
  const sizes = {
    geometry: { width: 420, height: 320 },
    plot: { width: 360, height: 280 },
    formula: { width: 300, height: 110 },
  };
  const layout = computeBoardLayout(board, sizes, {
    regions: { "course-a": { x: 320, y: 160, reservedWidth: 1_100 } },
  });
  const geometry = layout.nodes.geometry!;
  const plot = layout.nodes.plot!;
  const formula = layout.nodes.formula!;
  const visualBottom = Math.max(geometry.y + geometry.height, plot.y + plot.height);
  assert.ok(formula.y >= visualBottom, "the formula must not collide with either linked visual");
  assert.ok(formula.y - visualBottom <= 88, "the formula should remain adjacent to the visual row");
});

test("a linked visual row is stable when an independent formula arrives between its nodes", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: Object.fromEntries([
      ["geometry", {
        id: "geometry",
        kind: "geometry",
        region_id: "course-a",
        content: {},
        placement: { relation: "new_region" },
      }],
      ["formula", {
        id: "formula",
        kind: "math",
        region_id: "course-a",
        content: { latex: "y=\\sin\\theta" },
        placement: { relation: "new_region" },
      }],
      ["plot", {
        id: "plot",
        kind: "plot",
        region_id: "course-a",
        content: {},
        placement: { relation: "new_region" },
      }],
    ]),
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
  const sizes = {
    geometry: { width: 420, height: 320 },
    plot: { width: 360, height: 280 },
    formula: { width: 300, height: 110 },
  };
  const layout = computeBoardLayout(board, sizes, {
    regions: { "course-a": { x: 320, y: 160, reservedWidth: 1_100 } },
  });
  const geometry = layout.nodes.geometry!;
  const plot = layout.nodes.plot!;
  const formula = layout.nodes.formula!;
  assert.equal(plot.x - (geometry.x + geometry.width), 54);
  assert.ok(formula.y >= Math.max(geometry.y + geometry.height, plot.y + plot.height));
});

test("connection direction places the source before a target created earlier", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: Object.fromEntries([
      ["plot", {
        id: "plot",
        kind: "plot",
        region_id: "course-a",
        content: {},
        placement: { relation: "new_region" },
      }],
      ["geometry", {
        id: "geometry",
        kind: "geometry",
        region_id: "course-a",
        content: {},
        placement: { relation: "new_region" },
      }],
    ]),
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
  const layout = computeBoardLayout(board);
  const geometry = layout.nodes.geometry!;
  const plot = layout.nodes.plot!;
  assert.equal(plot.x - (geometry.x + geometry.width), 54);
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
