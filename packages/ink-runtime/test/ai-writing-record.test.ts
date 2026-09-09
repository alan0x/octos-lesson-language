import test from "node:test";
import assert from "node:assert/strict";
import { readAiWritingRecords, writeAiWritingRecords } from "../src/ai-writing-record.js";

function element(): SVGElement {
  const attributes = new Map<string, string>();
  return { getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => attributes.set(key, value) } as unknown as SVGElement;
}
test("AI consumption ledger travels in the same SVG as the document", () => {
  const svg = element();
  assert.deepEqual(readAiWritingRecords(svg), []);
  const records = [{ artifact_id: "turn-A", component_ids: ["stroke-A"] }];
  writeAiWritingRecords(svg, records);
  assert.deepEqual(readAiWritingRecords(svg), records);
});
test("invalid or duplicate AI transaction records cannot silently reset delivery", () => {
  for (const value of ['{}', '[null]', '[{"artifact_id":"a","component_ids":[]},{"artifact_id":"a","component_ids":[]}]']) {
    const svg = element(); svg.setAttribute("data-octos-ai-writing", value);
    assert.throws(() => readAiWritingRecords(svg), /Invalid AI writing ledger/);
  }
});
