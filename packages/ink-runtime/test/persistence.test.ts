import test from "node:test";
import assert from "node:assert/strict";
import {
  InkRuntimeError,
  LocalInkDocumentStore,
  assertInkDocumentIntegrity,
  createInkDocumentRecord,
  inkSvgChecksum,
  validateInkDocumentRecord,
} from "../src/persistence.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test("student SVG is saved as a versioned, checksummed resource", async () => {
  const svg = '<svg viewBox="0 0 20 20"><path d="M1 1L19 19"/></svg>';
  const record = await createInkDocumentRecord({
    documentId: "lesson-1:student-ink",
    documentVersion: 3,
    editorVersion: "1.33.0",
    updatedAt: "2026-08-12T12:00:00.000Z",
    svg,
  });
  assert.equal(record.document_version, 3);
  assert.equal(record.editor.version, "1.33.0");
  assert.equal(record.checksum.value, await inkSvgChecksum(svg));
  await assertInkDocumentIntegrity(record);
  assert.deepEqual(validateInkDocumentRecord(record), record);
});

test("corrupted SVG is rejected instead of silently replacing student work", async () => {
  const record = await createInkDocumentRecord({
    documentId: "lesson-1:student-ink",
    documentVersion: 1,
    editorVersion: "1.33.0",
    svg: '<svg viewBox="0 0 10 10"/>',
  });
  record.svg = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>';
  await assert.rejects(
    () => assertInkDocumentIntegrity(record),
    (error) => error instanceof InkRuntimeError && error.code === "INK_CHECKSUM_MISMATCH",
  );
});

test("ink persistence stays separate from the Canonical playback checkpoint", async () => {
  const storage = new MemoryStorage();
  storage.setItem("oll-playback:lesson-1", JSON.stringify({ cursor: 12 }));
  const store = new LocalInkDocumentStore(storage);
  const record = await createInkDocumentRecord({
    documentId: "lesson-1:student-ink",
    documentVersion: 1,
    editorVersion: "1.33.0",
    svg: '<svg viewBox="0 0 10 10"/>',
  });
  store.save("oll-ink:lesson-1", record);
  assert.deepEqual(store.load("oll-ink:lesson-1"), record);
  assert.equal(storage.getItem("oll-playback:lesson-1"), JSON.stringify({ cursor: 12 }));
});
