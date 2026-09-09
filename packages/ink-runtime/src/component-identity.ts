import type { AbstractComponent, Stroke } from "js-draw";

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
  const seen = new Set<string>();
  return components.map((component) => {
    preserveInkDescendantOrigins(component);
    const existing = persistentInkComponentId(component);
    if (existing && !seen.has(existing)) { seen.add(existing); return existing; }
    if (existing) {
      const data = component.getLoadSaveData();
      data[SVG_ATTRIBUTE_DATA_KEY] = (data[SVG_ATTRIBUTE_DATA_KEY] ?? []).filter((attribute) =>
        !Array.isArray(attribute) || attribute[0] !== PERSISTENT_COMPONENT_ID_ATTRIBUTE);
    }
    const id = `${PERSISTENT_COMPONENT_ID_PREFIX}${crypto.randomUUID()}`;
    component.attachLoadSaveData(SVG_ATTRIBUTE_DATA_KEY, [
      PERSISTENT_COMPONENT_ID_ATTRIBUTE,
      id,
    ]);
    seen.add(id);
    return id;
  });
}

export function hasPersistentInkComponentId(
  component: AbstractComponent,
  id: string,
): boolean {
  return persistentInkComponentId(component) === id;
}

export type InkComponentOrigin = "student" | "ai";
const ORIGIN_ATTRIBUTE = "data-octos-ink-origin";

export function inkComponentOrigin(component: AbstractComponent): InkComponentOrigin {
  const attributes = component.getLoadSaveData()[SVG_ATTRIBUTE_DATA_KEY] ?? [];
  const origins = attributes.filter((attribute) => Array.isArray(attribute)
    && attribute[0] === ORIGIN_ATTRIBUTE);
  if (origins.length === 0) return "student";
  if (origins.every((attribute) => Array.isArray(attribute) && attribute[1] === "ai")) return "ai";
  if (origins.every((attribute) => Array.isArray(attribute) && attribute[1] === "student")) return "student";
  throw new Error("Invalid ink component origin");
}

export function markAiInkComponent(component: AbstractComponent): void {
  component.attachLoadSaveData(SVG_ATTRIBUTE_DATA_KEY, [ORIGIN_ATTRIBUTE, "ai"]);
}


const adaptedComponents = new WeakSet<AbstractComponent>();
/** js-draw's partial eraser constructs fresh Stroke objects without SVG data. */
function preserveInkDescendantOrigins(component: AbstractComponent): void {
  if (adaptedComponents.has(component)) return;
  adaptedComponents.add(component);
  const erased = component as AbstractComponent & { withRegionErased?: Stroke["withRegionErased"] };
  const originalErase = erased.withRegionErased;
  if (originalErase) {
    erased.withRegionErased = (...args: Parameters<Stroke["withRegionErased"]>) => {
      const parts = originalErase.apply(erased, args);
      for (const part of parts) {
        if (part === component) continue;
        if (inkComponentOrigin(component) === "ai") markAiInkComponent(part);
      }
      ensurePersistentInkComponentIds(parts);
      return parts;
    };
  }
  if (typeof component.clone !== "function") return;
  const originalClone = component.clone.bind(component);
  component.clone = () => {
    const copy = originalClone();
    // A clone inherits provenance, but is a distinct persistent component.
    const data = copy.getLoadSaveData();
    data[SVG_ATTRIBUTE_DATA_KEY] = (data[SVG_ATTRIBUTE_DATA_KEY] ?? []).filter((attribute) =>
      !Array.isArray(attribute) || attribute[0] !== PERSISTENT_COMPONENT_ID_ATTRIBUTE);
    ensurePersistentInkComponentIds([copy]);
    return copy;
  };
}
