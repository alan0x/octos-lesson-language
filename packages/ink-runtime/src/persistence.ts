export const INK_DOCUMENT_FORMAT = "oll.student-ink.svg" as const;
export const INK_DOCUMENT_FORMAT_VERSION = 1 as const;

export interface InkDocumentRecord {
  format: typeof INK_DOCUMENT_FORMAT;
  format_version: typeof INK_DOCUMENT_FORMAT_VERSION;
  editor: {
    name: "js-draw";
    version: string;
  };
  document_id: string;
  document_version: number;
  checksum: {
    algorithm: "sha-256";
    value: string;
  };
  updated_at: string;
  svg: string;
}

export interface InkDocumentStore {
  load(key: string): InkDocumentRecord | null | Promise<InkDocumentRecord | null>;
  save(key: string, record: InkDocumentRecord): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
}

export class InkRuntimeError extends Error {
  constructor(
    readonly code: "INK_INVALID_RECORD" | "INK_CHECKSUM_MISMATCH" | "INK_NO_SELECTION",
    message: string,
  ) {
    super(message);
    this.name = "InkRuntimeError";
  }
}

export async function inkSvgChecksum(svg: string): Promise<string> {
  const data = new TextEncoder().encode(svg);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createInkDocumentRecord(options: {
  documentId: string;
  documentVersion: number;
  editorVersion: string;
  svg: string;
  updatedAt?: string;
}): Promise<InkDocumentRecord> {
  if (!options.documentId || !Number.isInteger(options.documentVersion) || options.documentVersion < 1) {
    throw new InkRuntimeError("INK_INVALID_RECORD", "Ink document ID and positive version are required");
  }
  return {
    format: INK_DOCUMENT_FORMAT,
    format_version: INK_DOCUMENT_FORMAT_VERSION,
    editor: { name: "js-draw", version: options.editorVersion },
    document_id: options.documentId,
    document_version: options.documentVersion,
    checksum: { algorithm: "sha-256", value: await inkSvgChecksum(options.svg) },
    updated_at: options.updatedAt ?? new Date().toISOString(),
    svg: options.svg,
  };
}

export function validateInkDocumentRecord(value: unknown): InkDocumentRecord {
  if (!value || typeof value !== "object") throw new InkRuntimeError("INK_INVALID_RECORD", "Ink document must be an object");
  const record = value as Partial<InkDocumentRecord>;
  if (
    record.format !== INK_DOCUMENT_FORMAT
    || record.format_version !== INK_DOCUMENT_FORMAT_VERSION
    || record.editor?.name !== "js-draw"
    || typeof record.editor.version !== "string"
    || typeof record.document_id !== "string"
    || !Number.isInteger(record.document_version)
    || (record.document_version ?? 0) < 1
    || record.checksum?.algorithm !== "sha-256"
    || !/^[a-f0-9]{64}$/.test(record.checksum.value ?? "")
    || typeof record.updated_at !== "string"
    || typeof record.svg !== "string"
  ) {
    throw new InkRuntimeError("INK_INVALID_RECORD", "Ink document metadata is invalid");
  }
  return structuredClone(record as InkDocumentRecord);
}

export async function assertInkDocumentIntegrity(record: InkDocumentRecord): Promise<void> {
  const actual = await inkSvgChecksum(record.svg);
  if (actual !== record.checksum.value) {
    throw new InkRuntimeError("INK_CHECKSUM_MISMATCH", "Saved ink SVG does not match its checksum");
  }
}

export class LocalInkDocumentStore implements InkDocumentStore {
  constructor(private readonly storage: Storage = localStorage) {}

  load(key: string): InkDocumentRecord | null {
    const source = this.storage.getItem(key);
    if (!source) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(source); }
    catch { throw new InkRuntimeError("INK_INVALID_RECORD", "Saved ink document is not valid JSON"); }
    return validateInkDocumentRecord(parsed);
  }

  save(key: string, record: InkDocumentRecord): void {
    this.storage.setItem(key, JSON.stringify(validateInkDocumentRecord(record)));
  }

  remove(key: string): void { this.storage.removeItem(key); }
}
