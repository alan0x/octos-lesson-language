import type { ResourceContext } from "../../core/src/index.js";

export interface MechanicalChecks {
  required_any?: string[][];
  forbidden?: string[];
}

export interface EvalCase {
  case_id: string;
  domain: string;
  language: string;
  learner_request: string;
  tutor_context?: unknown;
  learner_context?: unknown;
  session_context?: ResourceContext | string;
  required_coverage: string[];
  mechanical_checks?: MechanicalChecks;
}

export interface EvalSuite {
  suite_id: string;
  description?: string;
  cases: string[];
}

export interface GenerationRequest {
  caseId: string;
  prompt: string;
  outputPath: string;
  model: string;
  timeoutMs: number;
}

export interface GenerationResult {
  provider: string;
  model: string;
  duration_ms: number;
  exit_code: number;
  stderr?: string;
}

export interface GenerationProvider {
  readonly name: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

export type FailureStage = "generation" | "parse" | "schema" | "semantic" | "normalize" | "reduce";
export type CoverageStatus = "passed" | "failed" | "not_evaluated";

export interface RunResult {
  case_id: string;
  domain: string;
  repetition: number;
  provider: string;
  model: string;
  resumed: boolean;
  duration_ms: number;
  parsed: boolean;
  schema_valid: boolean;
  semantic_valid: boolean;
  normalized: boolean;
  reduced: boolean;
  first_pass_core_executable: boolean;
  mechanical_coverage_status: CoverageStatus;
  missing_coverage: string[];
  forbidden_hits: string[];
  failure_stage?: FailureStage;
  error?: { name: string; message: string; code?: string; path?: string };
}

export interface EvalReport {
  run_id: string;
  suite_id: string;
  created_at: string;
  provider: string;
  model: string;
  repetitions: number;
  case_count: number;
  total_runs: number;
  completed_runs: number;
  first_pass_core_executable_runs: number;
  first_pass_core_executable_rate: number;
  mechanical_coverage_evaluated_runs: number;
  mechanical_coverage_passed_runs: number;
  mechanical_coverage_rate: number;
  by_domain: Record<string, { runs: number; executable: number; rate: number }>;
  failure_stages: Record<string, number>;
  results: RunResult[];
}
