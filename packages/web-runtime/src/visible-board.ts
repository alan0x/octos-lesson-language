import type { JsonObject, SemanticBoardState } from "../../core/src/index.js";

type BoardNode = SemanticBoardState["nodes"][string];

/** The card that now shows in place of `id`: itself, its final replacement, or none. */
function shownInPlaceOf(state: SemanticBoardState, id: string, seen = new Set<string>()): string | undefined {
  const node = state.nodes[id];
  if (!node || seen.has(id)) return undefined;
  seen.add(id);
  if (!node.hidden) return id;
  return typeof node.replaced_by === "string" ? shownInPlaceOf(state, node.replaced_by, seen) : undefined;
}

/** Where a card anchored to `id` should anchor once hidden cards leave the board. */
function visibleAnchor(state: SemanticBoardState, id: string, seen = new Set<string>()): string | undefined {
  if (seen.has(id)) return undefined;
  seen.add(id);
  if (state.groups[id]) return id;
  const shown = shownInPlaceOf(state, id);
  if (shown) return shown;
  const anchor = state.nodes[id]?.placement?.anchor;
  return typeof anchor === "string" ? visibleAnchor(state, anchor, seen) : undefined;
}

function reanchored(state: SemanticBoardState, placement: JsonObject | undefined): JsonObject | undefined {
  if (!placement || typeof placement.anchor !== "string") return placement;
  const anchor = visibleAnchor(state, placement.anchor);
  if (anchor === placement.anchor) return placement;
  return anchor ? { ...placement, anchor } : { relation: "new_region" };
}

/**
 * The board as the learner shows it. Hidden cards leave the board; a card that
 * replaced another takes that card's place in creation order and its placement;
 * cards, groups, connections and focus that referred to hidden cards follow the
 * replacement or drop out. A board without hidden cards is returned unchanged.
 */
export function visibleBoard(state: SemanticBoardState): SemanticBoardState {
  const nodes = Object.values(state.nodes);
  if (!nodes.some((node) => node.hidden)) return state;
  const shown: Record<string, BoardNode> = {};
  for (const node of nodes) {
    if (node.placement?.relation === "replaces") continue;
    if (!node.hidden) {
      shown[node.id] = { ...node, placement: reanchored(state, node.placement) };
      continue;
    }
    const replacementId = shownInPlaceOf(state, node.id);
    if (!replacementId || shown[replacementId]) continue;
    const replacement = state.nodes[replacementId]!;
    shown[replacementId] = {
      ...replacement,
      placement: reanchored(state, node.placement),
      ...(node.region_id !== undefined ? { region_id: node.region_id } : {}),
    };
  }
  const visible = (id: string) => Boolean(shown[id]) || Boolean(state.groups[id]);
  const groups = Object.fromEntries(Object.entries(state.groups).map(([id, group]) => [id, {
    ...group,
    members: ((group.members ?? []) as string[]).map((member) => (state.groups[member] ? member : shownInPlaceOf(state, member)))
      .filter((member): member is string => Boolean(member) && visible(member!)),
  }]));
  const endpointVisible = (endpoint: JsonObject | undefined) => {
    const id = endpoint?.node_id ?? endpoint?.group_id ?? endpoint?.connection_id;
    return typeof id !== "string" || Boolean(state.connections[id]) || visible(id);
  };
  const connections = Object.fromEntries(Object.entries(state.connections)
    .filter(([, connection]) => endpointVisible(connection.from) && endpointVisible(connection.to)));
  const focus = [...new Set(state.focus.map((id) => (shown[id] || state.groups[id] || state.connections[id] ? id : shownInPlaceOf(state, id)))
    .filter((id): id is string => Boolean(id)))];
  return { ...state, nodes: shown, groups, connections, focus };
}
