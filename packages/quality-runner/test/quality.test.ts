import test from "node:test";
import assert from "node:assert/strict";
import { computeQualityGate, validateQualityJudgment } from "../src/quality.js";
import { QUALITY_DIMENSIONS, type QualityJudgment } from "../src/types.js";

function judgment(score = 4): QualityJudgment {
  return {
    rubric_version: "0.2", case_id: "case",
    dimensions: Object.fromEntries(
      QUALITY_DIMENSIONS.map((dimension) => [dimension, { score, evidence: [`${dimension} evidence`], concerns: [] }]),
    ) as unknown as QualityJudgment["dimensions"],
    critical_errors: [], confidence: "high", limitations: [],
  };
}

test("quality judgment schema and host gate accept a strong lesson", () => {
  const value = judgment();
  assert.deepEqual(validateQualityJudgment(value), { valid: true, errors: [] });
  assert.deepEqual(computeQualityGate(value), { total_score: 32, maximum_score: 32, passed: true, reasons: [] });
});

test("host gate rejects a critical error regardless of total score", () => {
  const value = judgment();
  value.critical_errors.push({ severity: "major", category: "factual", description: "wrong result", evidence: "beat-result" });
  const gate = computeQualityGate(value);
  assert.equal(gate.passed, false);
  assert.match(gate.reasons[0]!, /critical/);
});

test("host gate enforces core teaching dimensions", () => {
  const value = judgment();
  value.dimensions.progression.score = 2;
  const gate = computeQualityGate(value);
  assert.equal(gate.total_score, 30);
  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.includes("progression below 3"));
});

test("host gate rejects unsupported learner claims even when the total is high", () => {
  const value = judgment();
  value.dimensions.no_unsupported_learner_claims.score = 0;
  const gate = computeQualityGate(value);
  assert.equal(gate.total_score, 28);
  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.includes("no_unsupported_learner_claims below 3"));
});

test("quality schema rejects ungrounded evidence-free scores", () => {
  const value = judgment() as any;
  value.dimensions.correctness.evidence = [];
  const validation = validateQualityJudgment(value);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("fewer than 1 items")));
});
