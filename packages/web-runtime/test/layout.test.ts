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
  assert.equal(narrow.nodes.a!.y,narrow.nodes.b!.y,'dual comparison visuals stay side-by-side in top-banner topology');
  assert.ok(narrow.nodes.c!.y>narrow.nodes.a!.y+narrow.nodes.a!.height);
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

// --- Stage-Anchored Step-Stream teaching layout ---

test("stage-anchored step-stream groups non-visual steps into the active visual stage spine", () => {
  const mk = (id: string, kind: string) => ({ id, kind, region_id: "r", content: {} });
  const board = { board_id: "b", revision: 1, nodes: {
    s1v: mk("s1v", "scene3d"), s1m: mk("s1m", "math"),
    s2v: mk("s2v", "plot"), s2m: mk("s2m", "math"),
    s3n: mk("s3n", "note"),
  }, groups: {}, connections: {}, focus: [], applied_lessons: [], applied_steps: [], applied_actions: [] } as unknown as SemanticBoardState;
  const region = { x: 20, y: 20, flow: "teaching" as const,
    nodeSections: { s1v: "1", s1m: "1", s2v: "2", s2m: "2", s3n: "3" },
    composition: { width: 1920, height: 1080, mode: "overview" as const } };
  const layout = computeBoardLayout(board, {}, { regions: { r: region } });
  const bottom = (ids: string[]) => Math.max(...ids.map(id => layout.nodes[id]!.y + layout.nodes[id]!.height));
  const top = (ids: string[]) => Math.min(...ids.map(id => layout.nodes[id]!.y));
  assert.ok(bottom(["s1v", "s1m"]) <= top(["s2v", "s2m"]), "stage 1 sits entirely above stage 2");
  assert.ok(bottom(["s2m"]) <= top(["s3n"]), "step 3 stacks below step 2 in stage 2's explanation spine");
  assert.equal(layout.nodes.s3n!.x, layout.nodes.s2m!.x, "step 2 and step 3 share stage 2's explanation spine column");
  assert.ok(layout.nodes.s1m!.x > layout.nodes.s1v!.x, "explanation spine sits right of visual workbench");
  assert.ok(Math.abs(layout.nodes.s1v!.y - layout.nodes.s1m!.y) < 1, "opening step shares stage top");
  assert.ok(layout.nodes.s2m!.x <= 20 + 460 + 48, "a single-visual stage does not reserve a double slot");
  assert.deepEqual(computeBoardLayout(board, {}, { regions: { r: region } }), layout, "layout is deterministic");
});

test("appending cards never moves existing cards", () => {
  const mk = (id: string, kind: string, section: string) => ({ id, kind, region_id: "r", content: {} });
  const nodeSectionsOf = (keys: string[]) => Object.fromEntries(keys.map(k => [k, { a: "1", b: "1", c: "2", d: "2", e: "3" }[k]!]));
  const makeBoard = (keys: string[]) => ({ board_id: "b", revision: 1,
    nodes: Object.fromEntries(keys.map(k => [k, mk(k, { a: "scene3d", b: "math", c: "note", d: "math", e: "plot" }[k]!, "")])),
    groups: {}, connections: {}, focus: [], applied_lessons: [], applied_steps: [], applied_actions: [] }) as unknown as SemanticBoardState;
  const makeRegion = (keys: string[]) => ({ x: 20, y: 20, flow: "teaching" as const,
    nodeSections: nodeSectionsOf(keys),
    plannedSteps: { "1": { visual: 1, math: 1 }, "2": { math: 1, text: 1 }, "3": { visual: 1 } },
    composition: { width: 1920, height: 1080, mode: "overview" as const } });
  const before = computeBoardLayout(makeBoard(["a", "b", "c"]), {}, { regions: { r: makeRegion(["a", "b", "c"]) } });
  const after = computeBoardLayout(makeBoard(["a", "b", "c", "d", "e"]), {}, { regions: { r: makeRegion(["a", "b", "c", "d", "e"]) } });
  for (const id of ["a", "b", "c"]) assert.deepEqual(after.nodes[id], before.nodes[id], `${id} must not move when new cards arrive`);
});

test("practice cards opening never moves any card or control and docks adjacent to controls", () => {
  const board = { board_id: "b", revision: 1, nodes: {
    scene: { id: "scene", kind: "scene3d", region_id: "r", content: {} },
    m: { id: "m", kind: "math", region_id: "r", content: {} },
  }, groups: {}, connections: {}, focus: [], applied_lessons: [], applied_steps: [], applied_actions: [] } as unknown as SemanticBoardState;
  const control = { id: "slider", kind: "control" as const, anchorNodeId: "scene", width: 360, height: 44, gap: 24 };
  const region = { x: 20, y: 20, flow: "teaching" as const,
    nodeSections: { scene: "1", m: "2" },
    composition: { width: 1920, height: 1080, mode: "overview" as const },
    attachments: [control] };
  const before = computeBoardLayout(board, {}, { regions: { r: region } });
  const after = computeBoardLayout(board, {}, { regions: { r: { ...region,
    attachments: [control, { id: "task", kind: "task" as const, anchorNodeId: "scene", width: 360, height: 240 }] } } });
  assert.deepEqual(after.nodes, before.nodes, "no card moves when practice opens");
  assert.deepEqual(after.attachments.slider, before.attachments.slider, "no control moves when practice opens");
  assert.equal(after.attachments.slider!.y, before.nodes.scene!.y + before.nodes.scene!.height + 24, "control sits directly below its visual");
  assert.equal(after.attachments.task!.x, after.attachments.slider!.x, "task aligns with its control in the visual workbench");
  assert.equal(after.attachments.task!.y, after.attachments.slider!.y + after.attachments.slider!.height + 16, "task sits immediately below its control");
});

test("narrow viewport keeps single-visual stage side-by-side and step spine ordered", () => {
  const mk = (id: string, kind: string) => ({ id, kind, region_id: "r", content: {} });
  const board = { board_id: "b", revision: 1, nodes: {
    a: mk("a", "scene3d"), b: mk("b", "math"), c: mk("c", "math"), d: mk("d", "note"),
  }, groups: {}, connections: {}, focus: [], applied_lessons: [], applied_steps: [], applied_actions: [] } as unknown as SemanticBoardState;
  const region = { x: 20, y: 20, flow: "teaching" as const,
    nodeSections: { a: "1", b: "1", c: "2", d: "3" },
    composition: { width: 700, height: 1000, mode: "overview" as const } };
  const layout = computeBoardLayout(board, {}, { regions: { r: region } });
  assert.equal(layout.nodes.a!.x, 20, "visual starts at left of stage");
  assert.ok(layout.nodes.b!.x > layout.nodes.a!.x + layout.nodes.a!.width, "explanation spine sits beside single visual");
  const ys = ["b", "c", "d"].map(id => layout.nodes[id]!.y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! > ys[i - 1]!, "steps in spine ordered top to bottom");
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
