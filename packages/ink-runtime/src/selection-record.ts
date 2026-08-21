import { InkRuntimeError, inkSvgChecksum } from "./persistence.js";

export const INK_SELECTION_FORMAT = "oll.student-ink.selection" as const;
export const INK_SELECTION_FORMAT_VERSION = 3 as const;
export const LEGACY_INK_SELECTION_FORMAT_VERSION = 1 as const;
export const REGION_INK_SELECTION_FORMAT_VERSION = 2 as const;

export interface InkSelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InkSelectionPoint {
  x: number;
  y: number;
}

export interface InkSelectionRegion {
  kind: "rectangle" | "path";
  points: InkSelectionPoint[];
  closed: boolean;
}

/** Convert the first and last pointer positions of a rectangle gesture into
 * the exact board-space rectangle that was shown by the selection tool. */
export function inkSelectionRectangleRegion(
  points: InkSelectionPoint[],
): InkSelectionRegion | undefined {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length < 2) return undefined;
  const first = finite[0]!;
  const last = finite.at(-1)!;
  const left = Math.min(first.x, last.x);
  const right = Math.max(first.x, last.x);
  const top = Math.min(first.y, last.y);
  const bottom = Math.max(first.y, last.y);
  if (right <= left || bottom <= top) return undefined;
  return {
    kind: "rectangle",
    closed: true,
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
  };
}

export interface InkSelectionSnapshot {
  format: typeof INK_SELECTION_FORMAT;
  format_version:
    | typeof LEGACY_INK_SELECTION_FORMAT_VERSION
    | typeof REGION_INK_SELECTION_FORMAT_VERSION
    | typeof INK_SELECTION_FORMAT_VERSION;
  source_id: string;
  document_id: string;
  document_version: number;
  created_at: string;
  bounds: InkSelectionBounds;
  region?: InkSelectionRegion;
  /** IDs of the immutable js-draw components captured by this snapshot.
   * Version 3 records use them only to detect that source ink was erased;
   * the saved SVG remains the content sent to an assistant. */
  component_ids?: string[];
  checksum: {
    algorithm: "sha-256";
    value: string;
  };
  svg: string;
}

/** Preserve the learner's actual lasso in board coordinates. Sampling is
 * bounded so one long gesture cannot create an unbounded persisted record. */
export function inkSelectionPathRegion(
  points: InkSelectionPoint[],
): InkSelectionRegion | undefined {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const distinct = finite.filter((point, index) => {
    const previous = finite[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y;
  });
  if (distinct.length < 3) return undefined;
  if (distinct.length <= 512) return { kind: "path", closed: true, points: distinct };
  const last = distinct.at(-1)!;
  const stride = Math.ceil((distinct.length - 1) / 511);
  const sampled = distinct.filter((_point, index) => index % stride === 0).slice(0, 511);
  if (sampled.at(-1) !== last) sampled.push(last);
  return { kind: "path", closed: true, points: sampled };
}

function validRegion(value: unknown): value is InkSelectionRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Partial<InkSelectionRegion>;
  return (region.kind === "rectangle" || region.kind === "path")
    && typeof region.closed === "boolean"
    && Array.isArray(region.points)
    && region.points.length >= (region.closed ? 3 : 2)
    && region.points.length <= 512
    && region.points.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function selectionChecksumSource(
  snapshot: Pick<InkSelectionSnapshot, "format_version" | "svg" | "region" | "component_ids">,
): string {
  if (snapshot.format_version === LEGACY_INK_SELECTION_FORMAT_VERSION) {
    return snapshot.svg;
  }
  if (snapshot.format_version === REGION_INK_SELECTION_FORMAT_VERSION) {
    return JSON.stringify({ svg: snapshot.svg, region: snapshot.region });
  }
  return JSON.stringify({
    svg: snapshot.svg,
    region: snapshot.region,
    component_ids: snapshot.component_ids,
  });
}

export function validateInkSelectionSnapshot(value: unknown): InkSelectionSnapshot {
  if (!value || typeof value !== "object") {
    throw new InkRuntimeError("INK_INVALID_RECORD", "Ink selection source must be an object");
  }
  const snapshot = value as Partial<InkSelectionSnapshot>;
  const bounds = snapshot.bounds;
  if (
    snapshot.format !== INK_SELECTION_FORMAT
    || (snapshot.format_version !== LEGACY_INK_SELECTION_FORMAT_VERSION
      && snapshot.format_version !== REGION_INK_SELECTION_FORMAT_VERSION
      && snapshot.format_version !== INK_SELECTION_FORMAT_VERSION)
    || typeof snapshot.source_id !== "string"
    || !snapshot.source_id
    || typeof snapshot.document_id !== "string"
    || !snapshot.document_id
    || !Number.isInteger(snapshot.document_version)
    || (snapshot.document_version ?? 0) < 0
    || typeof snapshot.created_at !== "string"
    || !bounds
    || !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width)
    || bounds.width <= 0
    || !Number.isFinite(bounds.height)
    || bounds.height <= 0
    || (snapshot.format_version !== LEGACY_INK_SELECTION_FORMAT_VERSION && !validRegion(snapshot.region))
    || (snapshot.format_version === LEGACY_INK_SELECTION_FORMAT_VERSION && snapshot.region !== undefined)
    || (snapshot.format_version === INK_SELECTION_FORMAT_VERSION
      && (!Array.isArray(snapshot.component_ids)
        || snapshot.component_ids.length === 0
        || snapshot.component_ids.length > 4096
        || snapshot.component_ids.some((id) => typeof id !== "string" || !id)
        || new Set(snapshot.component_ids).size !== snapshot.component_ids.length))
    || (snapshot.format_version !== INK_SELECTION_FORMAT_VERSION
      && snapshot.component_ids !== undefined)
    || snapshot.checksum?.algorithm !== "sha-256"
    || !/^[a-f0-9]{64}$/.test(snapshot.checksum.value ?? "")
    || typeof snapshot.svg !== "string"
    || !snapshot.svg.includes("<svg")
  ) {
    throw new InkRuntimeError("INK_INVALID_RECORD", "Ink selection source metadata is invalid");
  }
  return structuredClone(snapshot as InkSelectionSnapshot);
}

/**
 * Return whether every stroke captured by a selection still exists.
 * Old snapshots did not record component IDs, so their status is unknown.
 */
export function inkSelectionSourceExists(
  snapshot: InkSelectionSnapshot,
  lookupComponent: (id: string) => unknown,
): boolean | null {
  if (snapshot.format_version !== INK_SELECTION_FORMAT_VERSION) return null;
  return snapshot.component_ids!.every((id) => Boolean(lookupComponent(id)));
}

export async function assertInkSelectionIntegrity(
  snapshot: InkSelectionSnapshot,
): Promise<void> {
  const actual = await inkSvgChecksum(selectionChecksumSource(snapshot));
  if (actual !== snapshot.checksum.value) {
    throw new InkRuntimeError(
      "INK_CHECKSUM_MISMATCH",
      "Ink selection SVG does not match its checksum",
    );
  }
}
