// Generates tests/fixtures/teaching-reference.json from the real Web modules:
// core reducer, player-core operations, web-runtime computeBoardLayout
// (stage rows teaching layout) and planFocusCamera, plus the octos-learn host
// inputs (nodeSections, plannedSteps, interaction-cluster control panels).
//
// Run from crates/oll-runtime; NODE_PATH points at an OLL checkout with
// node_modules installed (the core schema validator imports ajv).
//   NODE_PATH=<oll>/node_modules esbuild tools/teaching-reference.ts --bundle --platform=node --format=esm \
//     --alias:octos-lesson-language=../../packages/core/src/index.ts \
//     --outfile=/tmp/teaching-reference.mjs
//   node /tmp/teaching-reference.mjs <pack-root> > tests/fixtures/teaching-reference.json
//
// <pack-root> holds <packId>/<version>/course.oll.jsonl (the product app bundle).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { applyCanonicalAction, createSemanticBoardState } from "../../../packages/core/src/index.ts";
import { compilePlaybackOperations } from "../../../packages/player-core/src/index.ts";
import { computeBoardLayout, measureSemanticNode } from "../../../packages/web-runtime/src/layout.ts";
import { holdsTeachingFrame, planFocusCamera } from "../../../packages/web-runtime/src/camera.ts";
import { variableControlModels } from "../../../packages/web-runtime/src/variable-controls.ts";
// Host module from the sibling octos-learn checkout (workspace layout); its
// "octos-lesson-language" import resolves through the esbuild alias.
import { buildInteractionClusters } from "../../../../octos-learn/src/learning/oll/interaction-clusters.ts";

const [packRoot] = process.argv.slice(2);
const visualKinds = ["geometry", "scene3d", "plot", "image", "diagram"];
// Desktop host insets after boardChromeInsets: the top bar and the input dock
// become bands (under the 92/120 floors); nothing is left as an occlusion.
const INSETS = { top: 92, right: 28, bottom: 120, left: 28, occlusions: [] };
// Host compositions: desktop (reading scale .9) at a wide and a narrow width,
// and a meeting display (reading scale .68).
const COMPOSITIONS = [
  { width: 1440, height: 868, readingScale: .9 },
  { width: 700, height: 868, readingScale: .9 },
  { width: 1920, height: 1080, readingScale: .68 },
];

function courseInputs(events: any[]) {
  const nodeSections: Record<string, string> = {};
  const plannedSteps: Record<string, { visual: number; math: number; text: number }> = {};
  for (const event of events) {
    if (event.event !== "lesson.step" || !event.step) continue;
    const counts = { visual: 0, math: 0, text: 0 };
    for (const beat of event.step.beats) for (const actions of Object.values<any[]>(beat.stage)) for (const action of actions) {
      if (action.op !== "board.create" || !action.node) continue;
      nodeSections[action.node.id] = event.step.id;
      const kind = String(action.node.kind ?? "");
      if (visualKinds.includes(kind)) counts.visual += 1; else if (kind === "math") counts.math += 1; else counts.text += 1;
    }
    plannedSteps[event.step.id] = counts;
  }
  return { nodeSections, plannedSteps };
}

function attachmentsFor(state: any, events: any[], regionId: string, nodeIds: string[], practice: boolean) {
  const open = events[0];
  const controls = variableControlModels(state).map((c: any) => c.alias);
  const tasks = practice ? (open.lesson?.tasks ?? []).map((t: any) => t.as) : [];
  const taskTargets = Object.fromEntries((open.lesson?.tasks ?? []).map((task: any) => [task.as, {
    variableAliases: task.allowed_operations.flatMap((o: any) => o.kind === "variable_change" ? [o.variable] : []),
    nodeIds: task.allowed_operations.flatMap((o: any) => o.kind === "scene3d_view" ? [o.node] : []),
  }]));
  const clusters = buildInteractionClusters(state, {
    id: regionId, nodeIds,
    variableAliases: (open.lesson?.variables ?? []).map((v: any) => v.as), taskTargets,
  }, controls, tasks);
  // oll-lesson-runtime.tsx interactionPlans + regionLayoutConstraints.
  return [...clusters.flatMap((cluster: any) => {
    const n = cluster.variableAliases.filter((a: string) => controls.includes(a)).length;
    const controlsHeight = n > 0 ? 12 + n * 24 + Math.max(0, n - 1) * 4 : 0;
    const tasksHeight = cluster.taskIds.length ? 60 + cluster.taskIds.length * 220 : 0;
    return [
      ...(n ? [{ id: cluster.id, kind: "control", anchorNodeId: cluster.anchorNodeId,
        ownerNodeId: cluster.nodeIds[0] ?? cluster.anchorNodeId, anchorNodeIds: cluster.nodeIds,
        width: 360, height: controlsHeight, focusHeight: controlsHeight, gap: 24 }] : []),
      ...(cluster.taskIds.length ? [{ id: `${cluster.id}:tasks`, kind: "task", anchorNodeId: cluster.anchorNodeId,
        ownerNodeId: cluster.anchorNodeId, anchorNodeIds: cluster.nodeIds, width: 330, height: tasksHeight, gap: 28 }] : []),
    ];
  }),
  // Thinking questions open with the after-lesson window (estimated height).
  ...(practice ? (open.lesson?.reflections ?? []) : []).map((r: any) => ({
    id: `reflection:${regionId}:${r.as}`, kind: "reflection", anchorNodeId: r.anchor, width: 330, height: 150 }))];
}

const courses: any[] = [];
for (const pack of readdirSync(packRoot).sort()) {
  if (!statSync(join(packRoot, pack)).isDirectory()) continue;
  for (const version of readdirSync(join(packRoot, pack))) {
    let source: string;
    try { source = readFileSync(join(packRoot, pack, version, "course.oll.jsonl"), "utf8"); } catch { continue; }
    const events = source.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const operations = compilePlaybackOperations(events);
    const { nodeSections, plannedSteps } = courseInputs(events);
    for (const viewport of COMPOSITIONS) {
      const state = createSemanticBoardState(events[0]);
      const frames: any[] = [];
      const visualContent: Record<string, any> = {};
      const composition = { ...viewport, mode: "progressive", insets: INSETS };
      const record = (actionId: string, practice: boolean) => {
        const nodes = Object.values<any>(state.nodes);
        if (!nodes.length) { frames.push({ action_id: actionId }); return; }
        const regionId = nodes[0].region_id ?? "__legacy__";
        const sizes = Object.fromEntries(nodes.map((n) => [n.id, measureSemanticNode(n)]));
        const attachments = attachmentsFor(state, events, regionId, Object.keys(nodeSections), practice);
        const constraint = { x: 20, y: 20, flow: "teaching", nodeSections, plannedSteps, composition,
          reservedWidth: 1300, attachments };
        const layout = computeBoardLayout(state, sizes, { regions: { [regionId]: constraint } });
        frames.push({
          action_id: actionId,
          // Minimal board snapshot: everything the layout reads.
          board: {
            nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, role: n.role, placement: n.placement, region_id: n.region_id })),
            groups: Object.values(state.groups), connections: Object.values(state.connections),
          },
          sizes, attachments, layout: { nodes: layout.nodes, attachments: layout.attachments },
        });
      };
      for (const operation of operations) {
        if (!operation.action) continue;
        // Visual content (variable references) is structural: keep it once.
        if (operation.action.op === "board.create" && visualKinds.includes(String(operation.action.node?.kind)))
          visualContent[operation.action.node.id] = operation.action.node.content;
        applyCanonicalAction(state, operation.action);
        record(operation.action.action_id, false);
      }
      record("practice", true);
      courses.push({ pack, version, nodeSections, plannedSteps, composition,
        variables: events[0].lesson?.variables ?? [], visualContent, frames });
    }
  }
}

// planFocusCamera over randomized geometry (deterministic LCG).
let seed = 20260928;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const modes = ["detail", "relationship", "overview", "course"] as const;
const cameras: any[] = [];
for (let i = 0; i < 400; i++) {
  const targets = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
    x: rand() * 2000 - 200, y: rand() * 1500 - 100, width: 80 + rand() * 900, height: 60 + rand() * 700 }));
  const current = { panX: rand() * 400 - 200, panY: rand() * 400 - 200, scale: .2 + rand() * 1.2 };
  const viewport = { width: 600 + rand() * 1200, height: 400 + rand() * 700 };
  const occlusions = Array.from({ length: Math.floor(rand() * 4) }, () => ({
    x: rand() * viewport.width, y: rand() * viewport.height, width: 20 + rand() * 500, height: 10 + rand() * 300 }));
  const insets = { top: rand() * 100, right: rand() * 40, bottom: rand() * 140, left: rand() * 40,
    ...(rand() < .2 ? { focusMargin: rand() * 60 } : {}), occlusions };
  const mode = modes[Math.floor(rand() * 4)]!;
  const floor = .18 + rand() * .6;
  const ceiling = rand() < .5 ? 1 : .5 + rand() * .7;
  // Parts: the targets themselves, or nothing (whole scene counts).
  const parts = rand() < .5 ? targets : undefined;
  cameras.push({ targets, current, viewport, mode, insets, floor, ceiling, parts,
    result: planFocusCamera(targets, current, viewport, mode, insets, floor, ceiling, parts) });
}
// holdsTeachingFrame: current near a planned frame.
const holds: any[] = [];
for (let i = 0; i < 300; i++) {
  const { targets, viewport, insets, mode, floor, ceiling, parts } = cameras[i % cameras.length];
  const planned = planFocusCamera(targets, { panX: 0, panY: 0, scale: 1 }, viewport, mode, insets, floor, ceiling, parts);
  const current = { panX: planned.panX + (rand() - .5) * 300, panY: planned.panY + (rand() - .5) * 300,
    scale: planned.scale * (.7 + rand() * .6) };
  const centerShare = rand() < .5 ? .05 : null;
  const readable = rand() < .5 ? .55 + rand() * .3 : null;
  holds.push({ targets, current, planned, viewport, insets, centerShare, readable,
    result: holdsTeachingFrame(targets, current, planned, viewport, insets,
      centerShare ?? Number.POSITIVE_INFINITY, readable ?? Number.POSITIVE_INFINITY) });
}

process.stdout.write(JSON.stringify({ courses, cameras, holds }));
