import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reduceCanonicalEvents, type SemanticBoardState } from "../../core/src/index.js";
import { computeBoardLayout, measureSemanticNode, targetRect, type MeasuredNodeSizes } from "../src/layout.js";
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
  assert.ok(measureSemanticNode({ kind: "plot", content: {} }).height >= 300, "plot reserves room for exploration and feedback controls");
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

test("narrative cards below an interactive visual group use its adjacent reading lane", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      intro: {
        id: "intro",
        kind: "math",
        region_id: "course-a",
        content: { latex: "y=\\sin(x)" },
        placement: { relation: "new_region" },
      },
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
      note: {
        id: "note",
        kind: "note",
        region_id: "course-a",
        content: { title: "正弦函数基本认识" },
        placement: { relation: "below", anchor: "visuals" },
      },
      formula: {
        id: "formula",
        kind: "math",
        region_id: "course-a",
        content: { latex: "y=\\sin(x)" },
        placement: { relation: "below", anchor: "visuals" },
      },
    },
    groups: {
      visuals: {
        id: "visuals",
        members: ["geometry", "plot"],
      },
    },
    connections: {},
    focus: [],
    applied_lessons: [],
    applied_steps: [],
    applied_actions: [],
  };
  const layout = computeBoardLayout(board, {
    intro: { width: 280, height: 96 },
    geometry: { width: 380, height: 300 },
    plot: { width: 360, height: 297 },
    note: { width: 400, height: 135 },
    formula: { width: 280, height: 96 },
  }, {
    regions: {
      "course-a": {
        x: 340,
        y: 90,
        reservedWidth: 1_180,
        flow: "reading",
        attachments: [{
          id: "course-a:interaction",
          anchorNodeId: "plot",
          anchorNodeIds: ["geometry", "plot"],
          width: 360,
          height: 420,
          gap: 42,
        }],
      },
    },
  });

  const interaction = layout.attachments["course-a:interaction"]!;
  const geometry = layout.nodes.geometry!;
  const plot = layout.nodes.plot!;
  const note = layout.nodes.note!;
  const formula = layout.nodes.formula!;
  const visualBottom = Math.max(
    geometry.y + geometry.height,
    plot.y + plot.height,
  );

  assert.equal(interaction.x, Math.min(geometry.x, plot.x));
  assert.equal(interaction.y, visualBottom + 42);
  assert.equal(note.x, layout.nodes.intro!.x);
  assert.ok(
    note.x >= interaction.x + interaction.width + 12,
    "narrative must stay beside, rather than below, the interaction lane",
  );
  assert.ok(
    note.y < interaction.y + interaction.height,
    "future interaction height must not push narrative below the whole attachment",
  );
  assert.equal(formula.x, note.x);
  assert.ok(formula.y >= note.y + note.height + 12);
});

test("host obstacles move new lesson cards out of occupied whiteboard space", () => {
  const board: SemanticBoardState = {
    board_id: "board",
    revision: 1,
    nodes: {
      formula: {
        id: "formula",
        kind: "math",
        region_id: "course-a",
        content: { latex: "x^2" },
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
  const obstacle = { x: 100, y: 90, width: 360, height: 180 };
  const layout = computeBoardLayout(
    board,
    { formula: { width: 300, height: 100 } },
    {
      regions: {
        "course-a": {
          x: 100,
          y: 90,
          obstacles: [obstacle],
        },
      },
    },
  );

  assert.equal(layout.nodes.formula!.x, obstacle.x + obstacle.width + 28);
  assert.equal(layout.nodes.formula!.y, 90);
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

test("teaching layout keeps comparisons aligned despite earlier notes and isolates practice", () => {
  const board: SemanticBoardState = { board_id: "teaching", revision: 1, nodes: {
    intro: {id:"intro",kind:"note",region_id:"r",content:{}},
    a: {id:"a",kind:"scene3d",region_id:"r",content:{}},
    b: {id:"b",kind:"geometry",region_id:"r",content:{},placement:{relation:"right_of",anchor:"a"}},
    formula: {id:"formula",kind:"math",region_id:"r",content:{latex:"r^2=h"},placement:{relation:"below",anchor:"b"}},
  }, groups:{},connections:{},focus:[],applied_lessons:[],applied_steps:[],applied_actions:[] };
  const controls = {id:"controls",kind:"control" as const,anchorNodeId:"b",anchorNodeIds:["a","b"],width:360,height:44,gap:24};
  const region = {x:20,y:20,reservedWidth:1100,flow:"teaching" as const,nodeSections:{intro:"1",a:"1",b:"1",formula:"2"},attachments:[controls]};
  const first = computeBoardLayout(board,{}, {regions:{r:region}});
  assert.equal(first.nodes.a!.y,first.nodes.b!.y);
  assert.ok(first.nodes.a!.y>first.nodes.intro!.y+first.nodes.intro!.height);
  assert.equal(first.attachments.controls!.y,Math.max(first.nodes.a!.y+first.nodes.a!.height,first.nodes.b!.y+first.nodes.b!.height)+24);
  assert.equal(first.attachments.controls!.x,20+(460+28+440-360)/2);
  const practice=computeBoardLayout(board,{}, {regions:{r:{...region,attachments:[controls,{...controls,id:"task",kind:"task",height:180}]}}});
  assert.deepEqual(practice.nodes,first.nodes);
  assert.deepEqual(practice.attachments.controls,first.attachments.controls);
  assert.ok(practice.attachments.task!.y>practice.nodes.formula!.y+practice.nodes.formula!.height);
  const narrow=computeBoardLayout(board,{}, {regions:{r:{...region,reservedWidth:500}}});
  assert.equal(narrow.nodes.a!.x,narrow.nodes.b!.x);
  assert.ok(narrow.nodes.b!.y>narrow.nodes.a!.y+narrow.nodes.a!.height);
  const obstacle={x:20,y:first.nodes.a!.y,width:500,height:200};
  const avoided=computeBoardLayout(board,{}, {regions:{r:{...region,obstacles:[obstacle]}}});
  assert.equal(avoided.nodes.a!.y,avoided.nodes.b!.y);
  assert.ok(avoided.nodes.a!.y>=obstacle.y+obstacle.height);
});

test("teaching narrative flow keeps five cards within the reading width", () => {
  const nodes=Object.fromEntries(Array.from({length:5},(_,i)=>[`n${i}`,{id:`n${i}`,kind:"note",region_id:"r",content:{text:"note"}}]));
  const board={board_id:"b",revision:1,nodes,groups:{},connections:{},focus:[],applied_lessons:[],applied_steps:[],applied_actions:[]} as SemanticBoardState;
  const result=computeBoardLayout(board,{}, {regions:{r:{x:20,y:20,reservedWidth:600,flow:"teaching"}}});
  for(const r of Object.values(result.nodes))assert.ok(r.x+r.width<=620);
  assert.ok(result.nodes.n4!.y>result.nodes.n0!.y);
  assert.deepEqual(computeBoardLayout(board,{}, {regions:{r:{x:20,y:20,reservedWidth:600,flow:"teaching"}}}),result);
});

test('viewport-aware overview uses horizontal space, includes tasks and preserves comparison alignment', () => {
  const board: SemanticBoardState = {board_id:'b',revision:1,nodes:{
    a:{id:'a',kind:'scene3d',region_id:'r',content:{}},
    b:{id:'b',kind:'scene3d',region_id:'r',content:{},placement:{relation:'right_of',anchor:'a'}},
    c:{id:'c',kind:'plot',region_id:'r',content:{}},
    d:{id:'d',kind:'note',region_id:'r',content:{}},
    e:{id:'e',kind:'math',region_id:'r',content:{}},
  },groups:{},connections:{},focus:[],applied_lessons:[],applied_steps:[],applied_actions:[]};
  const region = {x:20,y:20,flow:'teaching' as const,nodeSections:{a:'1',b:'1',c:'2',d:'3',e:'4'},
    composition:{width:1920,height:1080,mode:'overview' as const,insets:{top:92,bottom:120}},
    attachments:[{id:'slider',kind:'control' as const,anchorNodeId:'a',width:360,height:44,gap:24},
      {id:'task',kind:'task' as const,anchorNodeId:'a',width:360,height:240}]};
  const layout = computeBoardLayout(board,{}, {regions:{r:region}});
  assert.equal(layout.nodes.a!.y,layout.nodes.b!.y);
  assert.equal(layout.attachments.slider!.y,layout.nodes.a!.y+layout.nodes.a!.height+24);
  assert.ok(layout.bounds.width >= 900, 'comparison pair still uses horizontal space');
  const rects=[...Object.values(layout.nodes),...Object.values(layout.attachments)];
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++) {
    const a=rects[i]!,b=rects[j]!;
    assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y),'cards and attachments must not overlap');
  }
  assert.deepEqual(computeBoardLayout(board,{}, {regions:{r:region}}),layout);
  const narrow=computeBoardLayout(board,{}, {regions:{r:{...region,composition:{...region.composition,width:700}}}});
  assert.ok(narrow.nodes.b!.y>=narrow.nodes.a!.y+narrow.nodes.a!.height,'a comparison pair that does not fit the narrow stream stacks');
  assert.ok(narrow.nodes.c!.y>narrow.nodes.b!.y+narrow.nodes.b!.height);
  const obstacle={...layout.bounds};
  const avoided=computeBoardLayout(board,{}, {regions:{r:{...region,obstacles:[obstacle]}}});
  assert.ok(Math.min(...Object.values(avoided.nodes).map(r=>r.y))>=obstacle.y+obstacle.height);
});

test('progressive composition does not relocate existing controls when practice opens', () => {
  const board={board_id:'b',revision:1,nodes:{a:{id:'a',kind:'scene3d',region_id:'r',content:{}}},groups:{},connections:{},focus:[],applied_lessons:[],applied_steps:[],applied_actions:[]} as SemanticBoardState;
  const control={id:'c',kind:'control' as const,anchorNodeId:'a',width:360,height:44};
  const region={x:20,y:20,flow:'teaching' as const,composition:{width:1920,height:1080,mode:'progressive' as const},attachments:[control]};
  const before=computeBoardLayout(board,{}, {regions:{r:region}});
  const after=computeBoardLayout(board,{}, {regions:{r:{...region,attachments:[control,{...control,id:'t',kind:'task',height:400}]}}});
  assert.deepEqual(after.nodes,before.nodes);
  assert.deepEqual(after.attachments.c,before.attachments.c);
});


test("annotated cards retain their positions when an overview is requested", () => {
  const board={board_id:'b',revision:1,nodes:{a:{id:'a',kind:'scene3d',region_id:'r',content:{}},b:{id:'b',kind:'note',region_id:'r',content:{}}},groups:{},connections:{},focus:[],applied_lessons:[],applied_steps:[],applied_actions:[]} as SemanticBoardState;
  const pinned={x:150,y:200,width:460,height:360};
  const result=computeBoardLayout(board,{}, {regions:{r:{x:20,y:20,flow:'teaching',composition:{width:1920,height:1080,mode:'overview'},pinned:{nodes:{a:pinned},attachments:{}}}}});
  assert.deepEqual(result.nodes.a,pinned);
  assert.ok(result.nodes.b!.y>=pinned.y+pinned.height);
});

// --- Stage Rows × Step Columns teaching layout ---

const emptyBoard = (nodes: Record<string, unknown>) => ({ board_id: "b", revision: 1, nodes, groups: {}, connections: {},
  focus: [], applied_lessons: [], applied_steps: [], applied_actions: [] }) as unknown as SemanticBoardState;
const card = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, region_id: "r", content: {}, ...extra });
const wideComposition = { width: 1920, height: 1080, mode: "progressive" as const, insets: { top: 92, bottom: 120, left: 28, right: 28 } };

test("each stage is one row and each step opens its own column in narration order", () => {
  const board = emptyBoard({ s1v: card("s1v", "scene3d"), s1m: card("s1m", "math"),
    s2v: card("s2v", "plot"), s2m: card("s2m", "math"), s3n: card("s3n", "note") });
  const region = { x: 20, y: 20, flow: "teaching" as const,
    nodeSections: { s1v: "1", s1m: "1", s2v: "2", s2m: "2", s3n: "3" }, composition: wideComposition };
  const layout = computeBoardLayout(board, {}, { regions: { r: region } });
  const n = layout.nodes;
  assert.ok(Math.max(n.s1v!.y + n.s1v!.height, n.s1m!.y + n.s1m!.height) <= Math.min(n.s2v!.y, n.s2m!.y), "stage 1 row is above stage 2 row");
  assert.equal(n.s1m!.y, n.s1v!.y, "explanation starts on the stage's top line");
  assert.ok(n.s1m!.x > n.s1v!.x + n.s1v!.width, "explanation reads after the visual");
  assert.equal(n.s3n!.y, n.s2m!.y, "a step without a visual joins the current stage row");
  assert.ok(n.s3n!.x >= n.s2m!.x + n.s2m!.width + 40, "a new step opens a new column to the right");
  assert.equal(n.s2v!.x, n.s1v!.x, "rows share one left edge");
  assert.deepEqual(computeBoardLayout(board, {}, { regions: { r: region } }), layout, "layout is deterministic");
});

test("arriving cards never move existing cards; widths may only grow", () => {
  const kinds: Record<string, string> = { a: "scene3d", b: "math", c: "note", d: "math", e: "plot", f: "note" };
  const sections: Record<string, string> = { a: "1", b: "1", c: "2", d: "2", e: "3", f: "3" };
  const order = ["a", "b", "c", "d", "e", "f"];
  const measured: MeasuredNodeSizes = { a: { width: 460, height: 360 }, b: { width: 200, height: 72 }, c: { width: 300, height: 140 },
    d: { width: 520, height: 90 }, e: { width: 440, height: 360 }, f: { width: 330, height: 150 } };
  const run = (count: number) => {
    const keys = order.slice(0, count);
    return computeBoardLayout(emptyBoard(Object.fromEntries(keys.map(k => [k, card(k, kinds[k]!)]))),
      Object.fromEntries(keys.map(k => [k, measured[k]!])), { regions: { r: { x: 20, y: 20, flow: "teaching",
        nodeSections: Object.fromEntries(keys.map(k => [k, sections[k]!])),
        plannedSteps: { "1": { visual: 1, math: 1 }, "2": { math: 1, text: 1 }, "3": { visual: 1, text: 1 } },
        composition: wideComposition } } });
  };
  let previous = run(1);
  for (let count = 2; count <= order.length; count++) {
    const next = run(count);
    for (const [id, rect] of Object.entries(previous.nodes)) {
      assert.equal(next.nodes[id]!.x, rect.x, `${id} keeps x when card ${count} arrives`);
      assert.equal(next.nodes[id]!.y, rect.y, `${id} keeps y when card ${count} arrives`);
      assert.ok(next.nodes[id]!.width >= rect.width, `${id} never narrows`);
    }
    previous = next;
  }
  assert.equal(previous.nodes.c!.width, previous.nodes.d!.width, "text cards in one column share its width");
});

test("a single visual's controls and practice form an operation column on its left", () => {
  const board = emptyBoard({ scene: card("scene", "scene3d"), m: card("m", "math") });
  const control = { id: "slider", kind: "control" as const, anchorNodeId: "scene", width: 360, height: 44, gap: 24 };
  const region = { x: 20, y: 20, flow: "teaching" as const, nodeSections: { scene: "1", m: "2" },
    plannedSteps: { "1": { visual: 1 }, "2": { math: 1 } }, composition: wideComposition, attachments: [control] };
  const before = computeBoardLayout(board, {}, { regions: { r: region } });
  const after = computeBoardLayout(board, {}, { regions: { r: { ...region,
    attachments: [control, { id: "task", kind: "task" as const, anchorNodeId: "scene", width: 330, height: 190 }] } } });
  assert.deepEqual(after.attachments.slider, before.attachments.slider, "the control does not move when practice opens");
  assert.equal(before.attachments.slider!.y, before.nodes.scene!.y, "controls share the visual's top line");
  assert.ok(before.attachments.slider!.x + 360 <= before.nodes.scene!.x, "controls sit left of the visual");
  assert.equal(after.attachments.task!.x, after.attachments.slider!.x, "practice aligns with its controls");
  assert.equal(after.attachments.task!.y, after.attachments.slider!.y + 44 + 16, "practice sits directly below its controls");
  assert.equal(before.nodes.m!.x, before.nodes.scene!.x + before.nodes.scene!.width + 28, "explanation starts right next to the visual");
});

test("comparison visuals share controls below them and practice beside the controls", () => {
  const board = emptyBoard({ a: card("a", "scene3d"), b: card("b", "geometry", { role: "comparison_visual", placement: { relation: "right_of", anchor: "a" } }) });
  const control = { id: "slider", kind: "control" as const, anchorNodeId: "b", anchorNodeIds: ["a", "b"], width: 360, height: 44 };
  const region = { x: 20, y: 20, flow: "teaching" as const, nodeSections: { a: "1", b: "1" },
    plannedSteps: { "1": { visual: 2 } }, composition: wideComposition, attachments: [control] };
  const layout = computeBoardLayout(board, {}, { regions: { r: region } });
  assert.equal(layout.nodes.a!.y, layout.nodes.b!.y, "comparison visuals share a top line");
  assert.equal(layout.attachments.slider!.y, Math.max(layout.nodes.a!.y + layout.nodes.a!.height, layout.nodes.b!.y + layout.nodes.b!.height) + 24);
  const opened = computeBoardLayout(board, {}, { regions: { r: { ...region,
    attachments: [control, { id: "task", kind: "task" as const, anchorNodeId: "b", anchorNodeIds: ["a", "b"], width: 330, height: 190 }] } } });
  assert.equal(opened.attachments.task!.y, opened.attachments.slider!.y, "practice sits beside the shared controls");
  assert.deepEqual(opened.attachments.slider, layout.attachments.slider, "controls keep their place when practice opens");
  assert.deepEqual(opened.nodes, layout.nodes);
});

test("opening practice shifts later content without re-splitting any step", () => {
  const board = emptyBoard({ a: card("a", "geometry"), b: card("b", "plot", { role: "comparison_visual", placement: { relation: "right_of", anchor: "a" } }),
    m1: card("m1", "math"), n1: card("n1", "note"), m2: card("m2", "math"), n2: card("n2", "note") });
  const measured: MeasuredNodeSizes = { a: { width: 440, height: 380 }, b: { width: 440, height: 360 }, m1: { width: 300, height: 72 },
    n1: { width: 300, height: 135 }, m2: { width: 590, height: 72 }, n2: { width: 590, height: 135 } };
  const control = { id: "slider", kind: "control" as const, anchorNodeId: "b", anchorNodeIds: ["a", "b"], width: 360, height: 44 };
  const region = { x: 20, y: 20, flow: "teaching" as const, nodeSections: { a: "1", b: "1", m1: "4", n1: "4", m2: "4", n2: "4" },
    plannedSteps: { "1": { visual: 2 }, "4": { math: 2, text: 2 } }, composition: { ...wideComposition, width: 1440, height: 900 }, attachments: [control] };
  const before = computeBoardLayout(board, measured, { regions: { r: region } });
  const after = computeBoardLayout(board, measured, { regions: { r: { ...region,
    attachments: [control, { id: "task", kind: "task" as const, anchorNodeId: "b", anchorNodeIds: ["a", "b"], width: 360, height: 190 }] } } });
  const dy = after.nodes.m1!.y - before.nodes.m1!.y;
  for (const id of ["m1", "n1", "m2", "n2"]) {
    assert.equal(after.nodes[id]!.x, before.nodes[id]!.x, `${id} keeps its column`);
    assert.equal(after.nodes[id]!.y - before.nodes[id]!.y, dy, `${id} shifts with its row`);
  }
});

test("no space is reserved for practice before it opens", () => {
  const board = emptyBoard({ a: card("a", "geometry"), b: card("b", "plot", { role: "comparison_visual", placement: { relation: "right_of", anchor: "a" } }),
    c: card("c", "plot"), m: card("m", "math") });
  const control = { id: "slider", kind: "control" as const, anchorNodeId: "b", anchorNodeIds: ["a", "b"], width: 360, height: 44 };
  const region = { x: 20, y: 20, flow: "teaching" as const, nodeSections: { a: "1", b: "1", c: "2", m: "2" },
    plannedSteps: { "1": { visual: 2 }, "2": { visual: 1, math: 1 } }, composition: wideComposition, attachments: [control] };
  const layout = computeBoardLayout(board, {}, { regions: { r: region } });
  const rowOneBottom = layout.attachments.slider!.y + layout.attachments.slider!.height;
  assert.equal(layout.nodes.c!.y, rowOneBottom + 72, "the next row starts right after the controls");
});

test("a later comparison visual declared right_of an earlier visual joins that row", () => {
  const board = emptyBoard({ circle: card("circle", "geometry"), cos: card("cos", "plot"),
    compare: card("compare", "plot", { role: "comparison_visual", placement: { relation: "right_of", anchor: "pair" } }),
    f: card("f", "math") });
  (board.groups as Record<string, unknown>).pair = { id: "pair", members: ["circle", "cos"] };
  const region = { x: 20, y: 20, flow: "teaching" as const, nodeSections: { circle: "1", cos: "1", compare: "3", f: "3" },
    plannedSteps: { "1": { visual: 2 }, "3": { visual: 1, math: 1 } }, composition: wideComposition };
  const layout = computeBoardLayout(board, {}, { regions: { r: region } });
  assert.equal(layout.nodes.compare!.y, layout.nodes.circle!.y, "the comparison view shares the earlier row's top line");
  assert.ok(layout.nodes.compare!.x > layout.nodes.cos!.x + layout.nodes.cos!.width, "and sits to the right of the compared figures");
  assert.ok(layout.nodes.f!.x > layout.nodes.compare!.x + layout.nodes.compare!.width, "the step's text follows it on the same row");
  const plainBoard = emptyBoard({ circle: card("circle", "geometry"), cos: card("cos", "plot"), other: card("other", "plot"), f: card("f", "math") });
  const plain = computeBoardLayout(plainBoard, {}, { regions: { r: { ...region, nodeSections: { circle: "1", cos: "1", other: "3", f: "3" } } } });
  assert.ok(plain.nodes.other!.y > plain.nodes.circle!.y + plain.nodes.circle!.height, "an undeclared new visual still opens a new row");
});

test("a lead-in column never splits a comparison pair that fits the reading width", () => {
  const board = emptyBoard({ f: card("f", "math"), a: card("a", "scene3d"),
    b: card("b", "scene3d", { role: "comparison_visual", placement: { relation: "right_of", anchor: "a" } }) });
  const measured: MeasuredNodeSizes = { f: { width: 382, height: 100 }, a: { width: 460, height: 360 }, b: { width: 440, height: 360 } };
  const layout = computeBoardLayout(board, measured, { regions: { r: { x: 20, y: 20, flow: "teaching",
    nodeSections: { f: "1", a: "1", b: "1" }, plannedSteps: { "1": { visual: 2, math: 1 } },
    composition: { width: 1280, height: 720, mode: "progressive", insets: { top: 92, bottom: 120, left: 28, right: 28 } } } } });
  assert.equal(layout.nodes.a!.y, layout.nodes.b!.y, "the pair keeps one top line");
  assert.ok(layout.nodes.a!.x > layout.nodes.f!.x + layout.nodes.f!.width, "the lead-in stays left of the pair");
});

test("planned step contents split a long step into balanced columns when it starts", () => {
  const cards = ["n1", "m1", "m2", "n2", "m3"];
  const kinds: Record<string, string> = { v: "plot", n1: "note", m1: "math", m2: "math", n2: "note", m3: "math" };
  const measured: MeasuredNodeSizes = { v: { width: 440, height: 360 }, n1: { width: 330, height: 150 }, m1: { width: 200, height: 60 },
    m2: { width: 480, height: 60 }, n2: { width: 300, height: 150 }, m3: { width: 580, height: 60 } };
  const run = (keys: string[]) => computeBoardLayout(emptyBoard(Object.fromEntries(keys.map(k => [k, card(k, kinds[k]!)]))),
    Object.fromEntries(keys.map(k => [k, measured[k]!])), { regions: { r: { x: 20, y: 20, flow: "teaching",
      nodeSections: Object.fromEntries(keys.map(k => [k, k === "v" ? "1" : "2"])),
      plannedSteps: { "1": { visual: 1 }, "2": { math: 3, text: 2 } }, composition: wideComposition } } });
  const full = run(["v", ...cards]);
  const columns = new Set(cards.map(id => full.nodes[id]!.x));
  assert.ok(columns.size >= 2, "a step taller than the row is split into columns up front");
  const rowBottom = full.nodes.v!.y + full.nodes.v!.height;
  for (const id of cards) assert.ok(full.nodes[id]!.y + full.nodes[id]!.height <= rowBottom + 200, `${id} stays near the row height`);
  for (let count = 1; count < cards.length; count++) {
    const partial = run(["v", ...cards.slice(0, count)]);
    for (const id of cards.slice(0, count)) {
      assert.equal(partial.nodes[id]!.x, full.nodes[id]!.x, `${id} x is fixed from the moment it appears`);
      assert.equal(partial.nodes[id]!.y, full.nodes[id]!.y, `${id} y is fixed from the moment it appears`);
    }
  }
});

test("a step that does not fit the reading width starts the next band at the row's left edge", () => {
  const nodes: Record<string, unknown> = { v: card("v", "plot") };
  const nodeSections: Record<string, string> = { v: "1" };
  const measured: MeasuredNodeSizes = { v: { width: 440, height: 360 } };
  for (let step = 2; step <= 7; step++) {
    nodes[`m${step}`] = card(`m${step}`, "math");
    nodeSections[`m${step}`] = String(step);
    measured[`m${step}`] = { width: 420, height: 80 };
  }
  const layout = computeBoardLayout(emptyBoard(nodes), measured, { regions: { r: { x: 20, y: 20, flow: "teaching", nodeSections,
    composition: { ...wideComposition, width: 1440, height: 900 } } } });
  const readingRight = 20 + (1440 - 56 - 80) / 0.9;
  for (const rect of Object.values(layout.nodes)) assert.ok(rect.x + rect.width <= readingRight + 1, "no column passes the reading width");
  const wrapped = Object.keys(nodes).filter(id => layout.nodes[id]!.y > layout.nodes.v!.y + layout.nodes.v!.height);
  assert.ok(wrapped.length > 0, "later steps continue on a band below");
  assert.equal(Math.min(...wrapped.map(id => layout.nodes[id]!.x)), 20, "the band starts at the row's left edge");
});

test("explicit relations place a card under the visual it explains or beside the card it explains", () => {
  const board = emptyBoard({ a: card("a", "scene3d"), b: card("b", "scene3d", { role: "comparison_visual", placement: { relation: "right_of", anchor: "a" } }),
    fb: card("fb", "math"), f: card("f", "math"), n: card("n", "note") });
  const region = { x: 20, y: 20, flow: "teaching" as const, nodeSections: { a: "1", b: "1", fb: "2", f: "2", n: "2" },
    plannedSteps: { "1": { visual: 2 }, "2": { math: 2, text: 1 } }, composition: wideComposition };
  const plain = computeBoardLayout(board, {}, { regions: { r: region } });
  const related = computeBoardLayout(board, {}, { regions: { r: { ...region, relations: { fb: ["b"], n: ["f"] } } } });
  assert.equal(related.nodes.fb!.x, related.nodes.b!.x, "a card explaining a visual is written under it");
  assert.ok(related.nodes.fb!.y >= related.nodes.b!.y + related.nodes.b!.height);
  assert.equal(related.nodes.n!.y, related.nodes.f!.y, "a note explaining a card shares its top line");
  assert.ok(related.nodes.n!.x > related.nodes.f!.x + related.nodes.f!.width - 1, "and sits to its right");
  assert.notDeepEqual(plain.nodes.fb, related.nodes.fb, "without relations the card stays in the step column");
});

test("narrow windows use one readable stream with text cards at stream width", () => {
  const board = emptyBoard({ a: card("a", "scene3d"), b: card("b", "math"), c: card("c", "math"), d: card("d", "note") });
  const region = { x: 20, y: 20, flow: "teaching" as const, nodeSections: { a: "1", b: "1", c: "2", d: "3" },
    composition: { width: 700, height: 1000, mode: "progressive" as const, insets: { top: 78, bottom: 180, left: 18, right: 18 } } };
  const layout = computeBoardLayout(board, {}, { regions: { r: region } });
  const order = ["a", "b", "c", "d"].map(id => layout.nodes[id]!);
  for (let i = 1; i < order.length; i++) assert.ok(order[i]!.y >= order[i - 1]!.y + order[i - 1]!.height, "cards stack in narration order");
  for (const rect of order) assert.equal(rect.x, 20, "one left edge");
  assert.equal(layout.nodes.b!.width, layout.nodes.d!.width, "text cards share the stream width");
});

test("planned visual capacity reserves the second slot before the card exists", () => {
  const board = { board_id: "b", revision: 1, nodes: {
    v1: { id: "v1", kind: "scene3d", region_id: "r", content: {} },
    f1: { id: "f1", kind: "math", region_id: "r", content: {} },
  }, groups: {}, connections: {}, focus: [], applied_lessons: [], applied_steps: [], applied_actions: [] } as unknown as SemanticBoardState;
  const region = { x: 20, y: 20, flow: "teaching" as const,
    nodeSections: { v1: "1", f1: "1" },
    plannedSteps: { "1": { visual: 2, math: 1 } },
    composition: { width: 1920, height: 1080, mode: "overview" as const } };
  const before = computeBoardLayout(board, {}, { regions: { r: region } });
  assert.ok(before.nodes.f1!.x >= 936 + 28, "math waits behind the reserved double visual slot");
  const withSecond = { ...board, nodes: { ...board.nodes,
    v2: { id: "v2", kind: "scene3d", region_id: "r", content: {} } } } as unknown as SemanticBoardState;
  const after = computeBoardLayout(withSecond, {}, { regions: { r: { ...region,
    nodeSections: { v1: "1", f1: "1", v2: "1" } } } });
  assert.deepEqual(after.nodes.v1, before.nodes.v1, "first visual never moves");
  assert.deepEqual(after.nodes.f1, before.nodes.f1, "formula never moves");
  assert.ok(after.nodes.v2!.x > after.nodes.v1!.x && after.nodes.v2!.y === after.nodes.v1!.y, "second visual fills the reserved slot beside the first");
});

test("animation camera frames the Beat target with the animated visuals only when readable", async () => {
  const { animationFocusTargets } = await import("../src/board-view.js");
  assert.deepEqual(animationFocusTargets(["circle", "cos"], ["circle"], () => false), ["circle", "cos"], "a Beat target among the animated visuals changes nothing");
  assert.deepEqual(animationFocusTargets(["circle", "cos"], ["compare"], () => true), ["circle", "cos", "compare"], "frame both when readable");
  assert.deepEqual(animationFocusTargets(["circle", "cos"], ["compare"], () => false), ["compare"], "otherwise keep the Beat target");
  assert.deepEqual(animationFocusTargets(["circle", "cos"], [], () => false), ["circle", "cos"], "without a Beat target follow the animation");
});
