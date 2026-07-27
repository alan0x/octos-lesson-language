import { Ajv2020 } from "ajv/dist/2020.js";
import qualitySchema from "../../../evals/rubrics/lesson-quality.schema.json" with { type: "json" };
import { QUALITY_DIMENSIONS, type QualityGate, type QualityJudgment } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(qualitySchema);

export function validateQualityJudgment(value: unknown): { valid: boolean; errors: string[] } {
  const valid = validate(value);
  return {
    valid: Boolean(valid),
    errors: valid ? [] : (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`),
  };
}

export function computeQualityGate(judgment: QualityJudgment): QualityGate {
  const total = QUALITY_DIMENSIONS.reduce((sum, dimension) => sum + judgment.dimensions[dimension].score, 0);
  const reasons: string[] = [];
  for (const dimension of ["correctness", "request_coverage", "progression", "narration_board_alignment"] as const) {
    if (judgment.dimensions[dimension].score < 3) reasons.push(`${dimension} below 3`);
  }
  if (total < 24) reasons.push("total score below 24");
  if (judgment.critical_errors.length > 0) reasons.push(`${judgment.critical_errors.length} critical error(s)`);
  return { total_score: total, maximum_score: 32, passed: reasons.length === 0, reasons };
}
