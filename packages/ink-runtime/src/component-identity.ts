import type { AbstractComponent } from "js-draw";

const SVG_ATTRIBUTE_DATA_KEY = "svgAttrs";
const PERSISTENT_COMPONENT_ID_ATTRIBUTE = "data-octos-ink-component-id";
const PERSISTENT_COMPONENT_ID_PREFIX = "octos-ink-component:";

function persistentInkComponentId(
  component: AbstractComponent,
): string | null {
  const attributes = component.getLoadSaveData()[SVG_ATTRIBUTE_DATA_KEY] ?? [];
  for (const attribute of attributes) {
    if (
      Array.isArray(attribute)
      && attribute[0] === PERSISTENT_COMPONENT_ID_ATTRIBUTE
      && typeof attribute[1] === "string"
      && attribute[1].startsWith(PERSISTENT_COMPONENT_ID_PREFIX)
    ) return attribute[1];
  }
  return null;
}

/**
 * Give selected strokes identities that survive js-draw's SVG save/load
 * boundary. Unknown data-* attributes are preserved by js-draw, whereas its
 * internal component IDs are recreated when a document is restored.
 */
export function ensurePersistentInkComponentIds(
  components: AbstractComponent[],
): string[] {
  return components.map((component) => {
    const existing = persistentInkComponentId(component);
    if (existing) return existing;
    const id = `${PERSISTENT_COMPONENT_ID_PREFIX}${crypto.randomUUID()}`;
    component.attachLoadSaveData(SVG_ATTRIBUTE_DATA_KEY, [
      PERSISTENT_COMPONENT_ID_ATTRIBUTE,
      id,
    ]);
    return id;
  });
}

export function hasPersistentInkComponentId(
  component: AbstractComponent,
  id: string,
): boolean {
  return persistentInkComponentId(component) === id;
}
