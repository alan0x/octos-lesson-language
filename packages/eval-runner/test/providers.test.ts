import test from "node:test";
import assert from "node:assert/strict";
import { codexExecArgs } from "../src/providers.js";

test("Codex provider passes an explicit structured output schema", () => {
  const args = codexExecArgs({
    caseId: "case",
    prompt: "prompt",
    outputPath: "/tmp/output.json",
    model: "model",
    timeoutMs: 1_000,
    outputSchemaPath: "/tmp/schema.json",
  });
  const schemaFlag = args.indexOf("--output-schema");
  assert.ok(schemaFlag >= 0);
  assert.equal(args[schemaFlag + 1], "/tmp/schema.json");
  assert.equal(args.at(-1), "-");
});

test("Codex provider keeps schema optional for fixture-compatible callers", () => {
  const args = codexExecArgs({
    caseId: "case",
    prompt: "prompt",
    outputPath: "/tmp/output.json",
    model: "model",
    timeoutMs: 1_000,
  });
  assert.equal(args.includes("--output-schema"), false);
});
