export const QUALITY_DIMENSIONS = [
  "correctness", "request_coverage", "progression", "narration_board_alignment",
  "board_use", "continuous_completion", "context_grounding", "no_unsupported_learner_claims",
] as const;

export type QualityDimensionName = typeof QUALITY_DIMENSIONS[number];

export interface DimensionJudgment {
  score: number;
  evidence: string[];
  concerns: string[];
}

export interface QualityJudgment {
  rubric_version: "0.1";
  case_id: string;
  dimensions: Record<QualityDimensionName, DimensionJudgment>;
  critical_errors: Array<{
    severity: "major" | "fatal";
    category: "factual" | "coverage" | "pedagogy" | "alignment" | "context" | "safety";
    description: string;
    evidence: string;
  }>;
  confidence: "low" | "medium" | "high";
  limitations: string[];
}

export interface QualityGate {
  total_score: number;
  maximum_score: 32;
  passed: boolean;
  reasons: string[];
}

export interface QualityCaseResult {
  case_id: string;
  domain: string;
  source_repetition: number;
  judge_model: string;
  judge_output_valid: boolean;
  judgment?: QualityJudgment;
  gate?: QualityGate;
  error?: string;
}
