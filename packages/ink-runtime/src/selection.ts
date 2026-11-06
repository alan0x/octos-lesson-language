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
  AI_INK_SELECTION_FORMAT_VERSION,
  type InkSelectionBounds,
  type InkSelectionRegion,
  type InkSelectionSnapshot,
} from "./selection-record.js";
import { ensurePersistentInkComponentIds, inkComponentDrawnAt, inkComponentOrigin } from "./component-identity.js";

export function selectedComponentsToSvg(components: AbstractComponent[]): {
  bounds: InkSelectionBounds;
  svg: string;
} {
  if (components.length === 0) throw new InkRuntimeError("INK_NO_SELECTION", "Select student ink before creating a source snapshot");
  const ordered = [...components].sort((left, right) => left.getZIndex() - right.getZIndex());
  const bounds = Rect2.union(...ordered.map((component) => component.getExactBBox()));
  const viewport = new Viewport(() => {});
  viewport.updateScreenSize(Vec2.of(Math.max(1, bounds.width), Math.max(1, bounds.height)));
  viewport.resetTransform(Mat33.translation(Vec2.of(-bounds.x, -bounds.y)));
  const { element } = SVGRenderer.fromViewport(viewport, { sanitize: true });
  // Each stroke is drawn on its own and kept in a group numbered in drawing
  // order, so a player can show a stroke at a time even when js-draw draws
  // one stroke as several paths.
  ordered.forEach((component, index) => {
    const { element: drawn, renderer } = SVGRenderer.fromViewport(viewport, { sanitize: true });
    component.render(renderer, bounds);
    const group = element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("data-oll-stroke", String(index));
    group.append(...Array.from(drawn.childNodes));
    element.append(group);
  });
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
  const origins = [...options.components].sort((left, right) => left.getZIndex() - right.getZIndex()).map(inkComponentOrigin);
  const ai = origins.includes("ai");
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
  // When each stroke was drawn, in the same order, when the runtime saw every one drawn.
  const drawnAt = [...options.components].sort((left, right) => left.getZIndex() - right.getZIndex()).map(inkComponentDrawnAt);
  const times = drawnAt.every((value): value is number => value !== undefined) ? drawnAt : undefined;
  return {
    format: INK_SELECTION_FORMAT,
    format_version: ai ? AI_INK_SELECTION_FORMAT_VERSION : INK_SELECTION_FORMAT_VERSION,
    source_id: options.sourceId ?? `ink-source:${crypto.randomUUID()}`,
    document_id: options.documentId,
    document_version: options.documentVersion,
    created_at: options.createdAt ?? new Date().toISOString(),
    bounds: selection.bounds,
    region,
    component_ids: componentIds,
    ...(ai ? { component_origins: origins } : {}),
    ...(times ? { component_drawn_at: times } : {}),
    checksum: {
      algorithm: "sha-256",
      value: await inkSvgChecksum(JSON.stringify({
        svg: selection.svg,
        region,
        component_ids: componentIds,
        ...(ai ? { component_origins: origins } : {}),
      })),
    },
    svg: selection.svg,
  };
}
