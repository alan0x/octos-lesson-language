import {
  Mat33,
  Rect2,
  SVGRenderer,
  Vec2,
  Viewport,
  type AbstractComponent,
} from "js-draw";
import { InkRuntimeError, inkSvgChecksum } from "./persistence.js";

export interface InkSelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InkSelectionSnapshot {
  source_id: string;
  document_id: string;
  document_version: number;
  created_at: string;
  bounds: InkSelectionBounds;
  checksum: {
    algorithm: "sha-256";
    value: string;
  };
  svg: string;
}

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
}): Promise<InkSelectionSnapshot> {
  const selection = selectedComponentsToSvg(options.components);
  return {
    source_id: options.sourceId ?? `ink-source:${crypto.randomUUID()}`,
    document_id: options.documentId,
    document_version: options.documentVersion,
    created_at: options.createdAt ?? new Date().toISOString(),
    bounds: selection.bounds,
    checksum: { algorithm: "sha-256", value: await inkSvgChecksum(selection.svg) },
    svg: selection.svg,
  };
}
