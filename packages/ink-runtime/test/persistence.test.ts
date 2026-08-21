import test from "node:test";
import assert from "node:assert/strict";
import {
  InkRuntimeError,
  LocalInkDocumentStore,
  assertInkDocumentIntegrity,
  createInkDocumentRecord,
  inkSvgChecksum,
  readInkDocumentForMerge,
  validateInkDocumentRecord,
} from "../src/persistence.js";
import {
  INK_SELECTION_FORMAT,
  INK_SELECTION_FORMAT_VERSION,
  LEGACY_INK_SELECTION_FORMAT_VERSION,
  REGION_INK_SELECTION_FORMAT_VERSION,
  assertInkSelectionIntegrity,
  inkSelectionSourceExists,
  validateInkSelectionSnapshot,
} from "../src/selection-record.js";

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

test("reading a corrupted saved resource never rewrites its recoverable source", async () => {
  const storage = new MemoryStorage();
  const key = "oll-ink:damaged";
  const damagedSource = JSON.stringify({
    format: "oll.student-ink.svg",
    format_version: 1,
    editor: { name: "js-draw", version: "1.33.0" },
    document_id: "lesson-1:student-ink",
    document_version: 1,
    checksum: { algorithm: "sha-256", value: "invalid" },
    updated_at: "2026-08-12T12:00:00.000Z",
    svg: '<svg viewBox="0 0 10 10"/>',
  });
  storage.setItem(key, damagedSource);
  const store = new LocalInkDocumentStore(storage);

  assert.throws(
    () => store.load(key),
    (error) => error instanceof InkRuntimeError && error.code === "INK_INVALID_RECORD",
  );
  assert.equal(storage.getItem(key), damagedSource);
});

test("a replay can read earlier ink without changing its source document", async () => {
  const storage = new MemoryStorage();
  const store = new LocalInkDocumentStore(storage);
  const source = await createInkDocumentRecord({
    documentId: "lesson-1:original-ink",
    documentVersion: 4,
    editorVersion: "1.33.0",
    svg: '<svg viewBox="0 0 20 20"><path d="M1 1L19 19"/></svg>',
  });
  store.save("oll-ink:lesson-1:original", source);
  const before = storage.getItem("oll-ink:lesson-1:original");

  assert.deepEqual(
    await readInkDocumentForMerge(
      store,
      "oll-ink:lesson-1:original",
      "lesson-1:original-ink",
    ),
    source,
  );
  assert.equal(storage.getItem("oll-ink:lesson-1:original"), before);
  await assert.rejects(
    () => readInkDocumentForMerge(
      store,
      "oll-ink:lesson-1:original",
      "another-lesson:student-ink",
    ),
    (error) => error instanceof InkRuntimeError && error.code === "INK_INVALID_RECORD",
  );
});

test("selection sources preserve immutable content and track their source strokes", async () => {
  const svg = '<svg data-oll-ink-selection="1" viewBox="0 0 40 20"><path d="M1 1L39 19"/></svg>';
  const snapshot = {
    format: INK_SELECTION_FORMAT,
    format_version: INK_SELECTION_FORMAT_VERSION,
    source_id: "ink-source:stable-1",
    document_id: "lesson-1:student-ink",
    document_version: 4,
    created_at: "2026-08-14T12:00:00.000Z",
    bounds: { x: 120, y: 80, width: 40, height: 20 },
    region: {
      kind: "rectangle" as const,
      closed: true,
      points: [{ x: 120, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 100 }, { x: 120, y: 100 }],
    },
    component_ids: ["stroke:1", "stroke:2"],
    checksum: { algorithm: "sha-256" as const, value: "" },
    svg,
  };
  snapshot.checksum.value = await inkSvgChecksum(JSON.stringify({
    svg,
    region: snapshot.region,
    component_ids: snapshot.component_ids,
  }));
  assert.deepEqual(validateInkSelectionSnapshot(snapshot), snapshot);
  await assertInkSelectionIntegrity(snapshot);

  const damaged = structuredClone(snapshot);
  damaged.svg = damaged.svg.replace("39 19", "20 19");
  await assert.rejects(
    () => assertInkSelectionIntegrity(damaged),
    (error) => error instanceof InkRuntimeError && error.code === "INK_CHECKSUM_MISMATCH",
  );

  const present = new Set(["stroke:1", "stroke:2"]);
  assert.equal(inkSelectionSourceExists(snapshot, (id) => present.has(id)), true);
  present.delete("stroke:2");
  assert.equal(inkSelectionSourceExists(snapshot, (id) => present.has(id)), false);
});

test("version 2 selection snapshots remain readable but cannot prove source presence", async () => {
  const svg = '<svg data-oll-ink-selection="1" viewBox="0 0 40 20"><path d="M1 1L39 19"/></svg>';
  const snapshot = {
    format: INK_SELECTION_FORMAT,
    format_version: REGION_INK_SELECTION_FORMAT_VERSION,
    source_id: "ink-source:region-v2",
    document_id: "lesson-1:student-ink",
    document_version: 4,
    created_at: "2026-08-14T12:00:00.000Z",
    bounds: { x: 120, y: 80, width: 40, height: 20 },
    region: {
      kind: "rectangle" as const,
      closed: true,
      points: [{ x: 120, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 100 }, { x: 120, y: 100 }],
    },
    checksum: { algorithm: "sha-256" as const, value: "" },
    svg,
  };
  snapshot.checksum.value = await inkSvgChecksum(JSON.stringify({ svg, region: snapshot.region }));
  assert.deepEqual(validateInkSelectionSnapshot(snapshot), snapshot);
  await assertInkSelectionIntegrity(snapshot);
  assert.equal(inkSelectionSourceExists(snapshot, () => true), null);
});

test("legacy selection snapshots remain readable after region paths are added", async () => {
  const svg = '<svg data-oll-ink-selection="1" viewBox="0 0 20 20"><path d="M0 0L20 20"/></svg>';
  const legacy = {
    format: INK_SELECTION_FORMAT,
    format_version: LEGACY_INK_SELECTION_FORMAT_VERSION,
    source_id: "ink-source:legacy",
    document_id: "lesson-1:student-ink",
    document_version: 2,
    created_at: "2026-08-14T12:00:00.000Z",
    bounds: { x: 10, y: 10, width: 20, height: 20 },
    checksum: { algorithm: "sha-256" as const, value: await inkSvgChecksum(svg) },
    svg,
  };
  assert.deepEqual(validateInkSelectionSnapshot(legacy), legacy);
  await assertInkSelectionIntegrity(legacy);
});
