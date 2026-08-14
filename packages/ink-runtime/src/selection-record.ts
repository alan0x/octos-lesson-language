import { InkRuntimeError, inkSvgChecksum } from "./persistence.js";

export const INK_SELECTION_FORMAT = "oll.student-ink.selection" as const;
export const INK_SELECTION_FORMAT_VERSION = 1 as const;

export interface InkSelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InkSelectionSnapshot {
  format: typeof INK_SELECTION_FORMAT;
  format_version: typeof INK_SELECTION_FORMAT_VERSION;
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

export function validateInkSelectionSnapshot(value: unknown): InkSelectionSnapshot {
  if (!value || typeof value !== "object") {
    throw new InkRuntimeError("INK_INVALID_RECORD", "Ink selection source must be an object");
  }
  const snapshot = value as Partial<InkSelectionSnapshot>;
  const bounds = snapshot.bounds;
  if (
    snapshot.format !== INK_SELECTION_FORMAT
    || snapshot.format_version !== INK_SELECTION_FORMAT_VERSION
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
    || snapshot.checksum?.algorithm !== "sha-256"
    || !/^[a-f0-9]{64}$/.test(snapshot.checksum.value ?? "")
    || typeof snapshot.svg !== "string"
    || !snapshot.svg.includes("<svg")
  ) {
    throw new InkRuntimeError("INK_INVALID_RECORD", "Ink selection source metadata is invalid");
  }
  return structuredClone(snapshot as InkSelectionSnapshot);
}

export async function assertInkSelectionIntegrity(
  snapshot: InkSelectionSnapshot,
): Promise<void> {
  const actual = await inkSvgChecksum(snapshot.svg);
  if (actual !== snapshot.checksum.value) {
    throw new InkRuntimeError(
      "INK_CHECKSUM_MISMATCH",
      "Ink selection SVG does not match its checksum",
    );
  }
}
