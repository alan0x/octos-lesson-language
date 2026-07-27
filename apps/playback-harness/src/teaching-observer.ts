import type { CanonicalAction, SemanticBoardState } from "../../../packages/core/src/index.js";
import type { PlaybackOperation } from "../../../packages/player-core/src/index.js";

export interface TeachingRectObservation {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  fully_in_view: boolean;
}

export interface TeachingFrameObservation {
  profile: "octos.teaching-playback.observation";
  version: "0.1";
  lesson_id: string;
  cursor: number;
  operation_type: PlaybackOperation["type"];
  beat_id?: string;
  action_op?: CanonicalAction["op"];
  viewport: { width: number; height: number };
  world_scale: number;
  node_count: number;
  connection_count: number;
  group_count: number;
  new_nodes: number;
  new_connections: number;
  new_groups: number;
  focus_targets: string[];
  focal_nodes: TeachingRectObservation[];
  active_targets: TeachingRectObservation[];
  min_focal_node_width: number | null;
  min_focal_body_font_px: number | null;
  min_focal_diagram_edge_px: number | null;
  math_errors: number;
  content_overflows: string[];
  label_node_overlaps: Array<{ label_id: string; node_id: string }>;
  duplicate_internal_connections: string[];
  image_load_failures: string[];
  image_pending: string[];
}

export interface TeachingGateIssue {
  code: string;
  message: string;
  targets?: string[];
}

export interface TeachingGateResult {
  passed: boolean;
  issues: TeachingGateIssue[];
}

const ROUND = 100;
function rounded(value: number): number { return Math.round(value * ROUND) / ROUND; }

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function observeRect(element: Element, viewport: DOMRect, id: string): TeachingRectObservation {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
    && rect.width >= 0 && rect.height >= 0 && intersects(
      new DOMRect(rect.left, rect.top, Math.max(1, rect.width), Math.max(1, rect.height)),
      viewport,
    );
  const tolerance = 1;
  return {
    id,
    kind: element instanceof HTMLElement ? element.dataset.kind ?? element.classList[0] ?? element.tagName.toLowerCase() : element.classList[0] ?? element.tagName.toLowerCase(),
    x: rounded(rect.left - viewport.left), y: rounded(rect.top - viewport.top),
    width: rounded(rect.width), height: rounded(rect.height), visible,
    fully_in_view: visible && rect.left >= viewport.left - tolerance && rect.top >= viewport.top - tolerance
      && rect.right <= viewport.right + tolerance && rect.bottom <= viewport.bottom + tolerance,
  };
}

function elementById(root: ParentNode, id: string): Element | undefined {
  const candidates = [...root.querySelectorAll<Element>("[data-id]")].filter((element) => (element as HTMLElement).dataset.id === id);
  const preferred = ["board-node", "board-group", "diagram-edge", "diagram-point", "diagram-region", "diagram-connection", "connection-line"];
  return preferred.flatMap((className) => candidates.filter((element) => element.classList.contains(className)))[0] ?? candidates[0];
}

function targetId(target: Record<string, unknown> | undefined): string | undefined {
  return target?.fragment_id as string | undefined
    ?? target?.node_id as string | undefined
    ?? target?.connection_id as string | undefined
    ?? target?.group_id as string | undefined;
}

function activeTargetIds(action: CanonicalAction | undefined): string[] {
  if (!action) return [];
  if (action.op === "board.focus") return [...(action.focus?.targets ?? [])];
  const direct = action.node?.id ?? action.connection?.id ?? action.group?.id ?? targetId(action.target as Record<string, unknown> | undefined);
  return direct ? [direct] : [];
}

function focalNodeIds(board: SemanticBoardState): string[] {
  const result = new Set<string>();
  const visit = (id: string, seen = new Set<string>()) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (board.nodes[id]) { result.add(id); return; }
    const group = board.groups[id];
    for (const member of (group?.members as string[] | undefined) ?? []) visit(member, seen);
  };
  for (const target of board.focus) visit(target);
  return [...result];
}

function minimumFontSize(nodes: Element[]): number | null {
  const sizes: number[] = [];
  for (const node of nodes) {
    const candidates = node.querySelectorAll<Element>(
      ".node-title, .content-list, .content-table, .diagram-sequence, .math-render, :scope > div:not(.node-caption):not(.node-title)",
    );
    for (const element of candidates) {
      if (!element.textContent?.trim()) continue;
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      if (Number.isFinite(size)) sizes.push(size);
    }
  }
  return sizes.length ? rounded(Math.min(...sizes)) : null;
}

function minimumDiagramEdge(nodes: Element[]): number | null {
  const majorEdges = nodes.map((node) => [...node.querySelectorAll<SVGElement>(".diagram-edge")].map((edge) => {
    const rect = edge.getBoundingClientRect();
    return Math.hypot(rect.width, rect.height);
  })).filter((lengths) => lengths.length).map((lengths) => Math.max(...lengths));
  return majorEdges.length ? rounded(Math.min(...majorEdges)) : null;
}

function worldScale(world: HTMLElement): number {
  const transform = getComputedStyle(world).transform;
  if (!transform || transform === "none") return 1;
  return rounded(new DOMMatrixReadOnly(transform).a);
}

export function collectTeachingObservation(input: {
  viewport: HTMLElement;
  world: HTMLElement;
  board: SemanticBoardState;
  operation: PlaybackOperation;
  cursor: number;
}): TeachingFrameObservation {
  const { viewport, world, board, operation, cursor } = input;
  const viewportRect = viewport.getBoundingClientRect();
  const focalPairs = focalNodeIds(board).map((id) => ({ id, element: elementById(world, id) })).filter((pair) => pair.element) as Array<{ id: string; element: Element }>;
  const focalElements = focalPairs.map((pair) => pair.element);
  const focalNodes = focalPairs.map((pair) => observeRect(pair.element, viewportRect, pair.id));
  const activeIds = activeTargetIds(operation.action);
  const activeTargets = activeIds.map((id) => {
    const element = elementById(world, id);
    return element ? observeRect(element, viewportRect, id) : {
      id, kind: "missing", x: 0, y: 0, width: 0, height: 0, visible: false, fully_in_view: false,
    };
  });

  const contentOverflows = [...world.querySelectorAll<HTMLElement>(".math-render, .content-table")]
    .filter((element) => {
      if (element.matches(".content-table")) return element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2;
      const card = element.closest<HTMLElement>(".board-node");
      const rendered = element.matches(".math-fragments") ? [...element.children] : [element.querySelector<HTMLElement>(".katex-display") ?? element.firstElementChild].filter(Boolean);
      if (!rendered.length || !card) return element.scrollWidth > element.clientWidth + 2;
      const cardRect = card.getBoundingClientRect(); const tolerance = 2;
      return element.scrollWidth > element.clientWidth + 2 || rendered.some((child) => {
        const contentRect = child!.getBoundingClientRect();
        return contentRect.left < cardRect.left - tolerance || contentRect.right > cardRect.right + tolerance
          || contentRect.top < cardRect.top - tolerance || contentRect.bottom > cardRect.bottom + tolerance;
      });
    })
    .map((element) => element.closest<HTMLElement>(".board-node")?.dataset.id ?? "unknown");

  const nodeElements = [...world.querySelectorAll<HTMLElement>(".board-node")];
  const labelNodeOverlaps: Array<{ label_id: string; node_id: string }> = [];
  for (const label of world.querySelectorAll<SVGGElement>(".connection-label-badge")) {
    const labelRect = label.getBoundingClientRect();
    for (const node of nodeElements) {
      if (intersects(labelRect, node.getBoundingClientRect())) {
        labelNodeOverlaps.push({ label_id: label.dataset.id ?? "unknown", node_id: node.dataset.id ?? "unknown" });
      }
    }
  }

  const internalIds = new Set([...world.querySelectorAll<SVGElement>(".diagram-connection")].map((element) => element.dataset.id).filter(Boolean) as string[]);
  const externalIds = new Set([...world.querySelectorAll<SVGElement>(".connection-line")].map((element) => element.dataset.id).filter(Boolean) as string[]);
  const duplicateInternalConnections = [...internalIds].filter((id) => externalIds.has(id));
  const images = [...world.querySelectorAll<HTMLImageElement>(".lesson-image")];
  const imageLoadFailures = images.filter((image) => image.complete && image.naturalWidth === 0)
    .map((image) => image.closest<HTMLElement>(".board-node")?.dataset.id ?? image.src);
  const imagePending = images.filter((image) => !image.complete)
    .map((image) => image.closest<HTMLElement>(".board-node")?.dataset.id ?? image.src);

  return {
    profile: "octos.teaching-playback.observation", version: "0.1", lesson_id: operation.lesson_id,
    cursor, operation_type: operation.type, ...(operation.beat_id ? { beat_id: operation.beat_id } : {}),
    ...(operation.action?.op ? { action_op: operation.action.op } : {}),
    viewport: { width: rounded(viewportRect.width), height: rounded(viewportRect.height) }, world_scale: worldScale(world),
    node_count: Object.keys(board.nodes).length, connection_count: Object.keys(board.connections).length, group_count: Object.keys(board.groups).length,
    new_nodes: 0, new_connections: 0, new_groups: 0,
    focus_targets: [...board.focus], focal_nodes: focalNodes, active_targets: activeTargets,
    min_focal_node_width: focalNodes.length ? rounded(Math.min(...focalNodes.map((node) => node.width))) : null,
    min_focal_body_font_px: minimumFontSize(focalElements), min_focal_diagram_edge_px: minimumDiagramEdge(focalElements),
    math_errors: world.querySelectorAll(".katex-error").length, content_overflows: [...new Set(contentOverflows)],
    label_node_overlaps: labelNodeOverlaps, duplicate_internal_connections: duplicateInternalConnections,
    image_load_failures: imageLoadFailures, image_pending: imagePending,
  };
}

export function evaluateTeachingObservation(observation: TeachingFrameObservation): TeachingGateResult {
  const issues: TeachingGateIssue[] = [];
  const add = (code: string, message: string, targets?: string[]) => issues.push({ code, message, ...(targets?.length ? { targets } : {}) });

  if (observation.math_errors) add("G3_MATH_ERROR", `${observation.math_errors} KaTeX render error(s)`);
  if (observation.content_overflows.length) add("G3_CONTENT_OVERFLOW", "Rendered content exceeds its board card", observation.content_overflows);
  if (observation.label_node_overlaps.length) add("G1_LABEL_NODE_OVERLAP", "Connection label overlaps a board node", observation.label_node_overlaps.map((item) => `${item.label_id}->${item.node_id}`));
  if (observation.duplicate_internal_connections.length) add("G1_DUPLICATE_DIAGRAM_CONNECTION", "Diagram-internal connection was also rendered on the outer board", observation.duplicate_internal_connections);
  if (observation.image_load_failures.length) add("G3_ASSET_LOAD_FAILED", "A lesson image failed to load", observation.image_load_failures);
  if (observation.image_pending.length) add("G3_ASSET_NOT_READY", "A lesson image was observed before loading completed", observation.image_pending);

  if (observation.operation_type === "action.apply" && observation.active_targets.length) {
    const missing = observation.active_targets.filter((target) => !target.visible).map((target) => target.id);
    if (missing.length) add("G1_ACTIVE_TARGET_NOT_VISIBLE", "The current action target is not visible", missing);
  }

  if (observation.operation_type === "beat.end") {
    if (!observation.focus_targets.length) add("G1_MISSING_BEAT_FOCUS", "Beat ends without an explicit teaching focus");
    const outOfView = observation.focal_nodes.filter((node) => !node.fully_in_view).map((node) => node.id);
    if (outOfView.length) add("G3_FOCUS_OUT_OF_VIEW", "Focused board node is outside the viewport", outOfView);
    if (observation.min_focal_node_width !== null && observation.min_focal_node_width < 239.5) {
      add("G3_FOCUS_TOO_SMALL", `Smallest focused card is ${observation.min_focal_node_width}px; expected at least 240px`);
    }
    if (observation.min_focal_body_font_px !== null && observation.min_focal_body_font_px < 14) {
      add("G3_TEXT_TOO_SMALL", `Smallest focused body text is ${observation.min_focal_body_font_px}px; expected at least 14px`);
    }
    if (observation.min_focal_diagram_edge_px !== null && observation.min_focal_diagram_edge_px < 120) {
      add("G3_DIAGRAM_TOO_SMALL", `Smallest focused diagram edge is ${observation.min_focal_diagram_edge_px}px; expected at least 120px`);
    }
    if (observation.new_nodes > 3) add("G2_TOO_MANY_NEW_NODES", `Beat creates ${observation.new_nodes} nodes; expected at most 3`);
  }
  return { passed: issues.length === 0, issues };
}
