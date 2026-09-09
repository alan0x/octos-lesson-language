import { InkRuntimeError } from "./persistence.js";

export interface AiWritingRecord {
  artifact_id: string;
  component_ids: string[];
}
const ATTRIBUTE = "data-octos-ai-writing";

export function readAiWritingRecords(svg: SVGElement): AiWritingRecord[] {
  const raw = svg.getAttribute(ATTRIBUTE);
  if (!raw) return [];
  try {
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records) || records.length > 4096) throw new Error();
    const seen = new Set<string>();
    for (const record of records) {
      if (!record || typeof record.artifact_id !== "string" || !record.artifact_id
        || seen.has(record.artifact_id) || !Array.isArray(record.component_ids)
        || record.component_ids.length > 4096
        || record.component_ids.some((id: unknown) => typeof id !== "string" || !id)) throw new Error();
      seen.add(record.artifact_id);
    }
    return records;
  } catch {
    throw new InkRuntimeError("INK_INVALID_RECORD", "Invalid AI writing ledger");
  }
}

export function writeAiWritingRecords(svg: SVGElement, records: AiWritingRecord[]): void {
  if (records.length) svg.setAttribute(ATTRIBUTE, JSON.stringify(records));
}
