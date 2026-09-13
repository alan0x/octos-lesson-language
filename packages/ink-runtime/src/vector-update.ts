export interface InkVectorIdentity<T extends object> {
  id: string;
  reference: T;
}

export interface InkVectorUpdatePlan {
  kind: "full" | "delta";
  upsert_ids: string[];
  remove_ids: string[];
}

/**
 * Decide whether a content revision can be represented as structural SVG
 * additions/removals. A retained component reference means js-draw kept the
 * same object; if content changed without a structural difference, that object
 * was transformed or restyled and the mirror needs a complete refresh.
 */
export function planInkVectorUpdate<T extends object>(
  previous: ReadonlyMap<string, T> | null,
  current: readonly InkVectorIdentity<T>[],
  contentChanged: boolean,
): InkVectorUpdatePlan {
  const currentById = new Map(current.map(({ id, reference }) => [id, reference]));
  if (!previous) {
    return {
      kind: "full",
      upsert_ids: current.map(({ id }) => id),
      remove_ids: [],
    };
  }

  const removeIds = [...previous.keys()].filter((id) => !currentById.has(id));
  const upsertIds = current
    .filter(({ id }) => !previous.has(id))
    .map(({ id }) => id);
  const retainedReferenceChanged = current.some(({ id, reference }) => {
    const prior = previous.get(id);
    return prior !== undefined && prior !== reference;
  });
  const unexplainedMutation = contentChanged
    && removeIds.length === 0
    && upsertIds.length === 0;

  if (retainedReferenceChanged || unexplainedMutation) {
    return {
      kind: "full",
      upsert_ids: current.map(({ id }) => id),
      remove_ids: [...previous.keys()],
    };
  }
  return { kind: "delta", upsert_ids: upsertIds, remove_ids: removeIds };
}
