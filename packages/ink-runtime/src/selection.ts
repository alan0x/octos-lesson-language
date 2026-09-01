import {
  Mat33,
  Rect2,
  SVGRenderer,
  Vec2,
  Viewport,
  type AbstractComponent,
} from "js-draw";
import { InkRuntimeError, inkSvgChecksum } from "./persistence.js";
import {
  INK_SELECTION_FORMAT,
  INK_SELECTION_FORMAT_VERSION,
  type InkSelectionBounds,
  type InkSelectionRegion,
  type InkSelectionSnapshot,
} from "./selection-record.js";
import { ensurePersistentInkComponentIds } from "./component-identity.js";

export function selectedComponentsToSvg(components: AbstractComponent[]): {
  bounds: InkSelectionBounds;
  svg: string;
} {
  if (components.length === 0) throw new InkRuntimeError("INK_NO_SELECTION", "Select student ink before creating a source snapshot");
  const ordered = [...components].sort((left, right) => left.getZIndex() - right.getZIndex());
  const bounds = Rect2.union(...ordered.map((component) => component.getExactBBox())).grownBy(8);
  const viewport = new Viewport(() => {});
  viewport.updateScreenSize(Vec2.of(Math.max(1, bounds.width), Math.max(1, bounds.height)));
  viewport.resetTransform(Mat33.translation(Vec2.of(-bounds.x, -bounds.y)));
  const { element, renderer } = SVGRenderer.fromViewport(viewport, { sanitize: true });
  for (const component of ordered) component.render(renderer, bounds);
  element.setAttribute("data-oll-ink-selection", "1");
  return {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    svg: element.outerHTML,
  };
}

export async function createInkSelectionSnapshot(options: {
  components: AbstractComponent[];
  documentId: string;
  documentVersion: number;
  sourceId?: string;
  createdAt?: string;
  region?: InkSelectionRegion;
}): Promise<InkSelectionSnapshot> {
  const selection = selectedComponentsToSvg(options.components);
  const componentIds = ensurePersistentInkComponentIds(
    [...options.components].sort((left, right) => left.getZIndex() - right.getZIndex()),
  );
  const region: InkSelectionRegion = options.region ?? {
    kind: "rectangle",
    closed: true,
    points: [
      { x: selection.bounds.x, y: selection.bounds.y },
      { x: selection.bounds.x + selection.bounds.width, y: selection.bounds.y },
      { x: selection.bounds.x + selection.bounds.width, y: selection.bounds.y + selection.bounds.height },
      { x: selection.bounds.x, y: selection.bounds.y + selection.bounds.height },
    ],
  };
  return {
    format: INK_SELECTION_FORMAT,
    format_version: INK_SELECTION_FORMAT_VERSION,
    source_id: options.sourceId ?? `ink-source:${crypto.randomUUID()}`,
    document_id: options.documentId,
    document_version: options.documentVersion,
    created_at: options.createdAt ?? new Date().toISOString(),
    bounds: selection.bounds,
    region,
    component_ids: componentIds,
    checksum: {
      algorithm: "sha-256",
      value: await inkSvgChecksum(JSON.stringify({
        svg: selection.svg,
        region,
        component_ids: componentIds,
      })),
    },
    svg: selection.svg,
  };
}
