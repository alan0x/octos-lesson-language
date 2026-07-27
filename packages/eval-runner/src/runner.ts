import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
  validateAuthoringLesson,
  validateAuthoringSchema,
  type AuthoringLesson,
  type CanonicalEvent,
  type NormalizationHost,
  type ResourceContext,
  type SemanticBoardState,
} from "../../core/src/index.js";
import type { EvalCase, EvalReport, EvalSuite, GenerationProvider, RunResult } from "./types.js";

export interface RunnerOptions {
  root: string;
  suitePath: string;
  outputDirectory: string;
  runId: string;
  repetitions: number;
  concurrency: number;
  model: string;
  timeoutMs: number;
  resume: boolean;
  provider: GenerationProvider;
  onProgress?: (done: number, total: number, result: RunResult) => void;
}

const DEFAULT_FORBIDDEN = ["等待你回答", "等你回答", "请回答", "你来试一试", "暂停一下", "wait for your answer"];

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function resolveSessionContext(value: EvalCase["session_context"], casePath: string): Promise<ResourceContext | undefined> {
  if (!value) return undefined;
  return typeof value === "string" ? loadJson<ResourceContext>(resolve(dirname(casePath), value)) : value;
}

function asError(error: unknown): RunResult["error"] {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: string; path?: string };
    return { name: error.name, message: error.message, ...(candidate.code ? { code: candidate.code } : {}), ...(candidate.path ? { path: candidate.path } : {}) };
  }
  return { name: "UnknownError", message: String(error) };
}

export async function buildPrompt(root: string, evalCase: EvalCase, casePath: string): Promise<string> {
  const [contract, schema, sessionContext] = await Promise.all([
    readFile(resolve(root, "evals/prompts/authoring-v0.1.md"), "utf8"),
    readFile(resolve(root, "schema/authoring/v0.1.schema.json"), "utf8"),
    resolveSessionContext(evalCase.session_context, casePath),
  ]);
  return [
    contract.trim(),
    "\n## Authoring JSON Schema\n", schema.trim(),
    "\n## Eval case\n", JSON.stringify(evalCase, null, 2),
    "\n## Resolved Session Context\n", JSON.stringify(sessionContext ?? { assets: [] }, null, 2),
    "\n现在仅输出最终的 OLL Authoring JSON 对象。",
  ].join("\n");
}

function collectStringValues(value: unknown, result: string[] = []): string[] {
  if (typeof value === "string") result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStringValues(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStringValues(item, result));
  return result;
}

function normalizeCoverageText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
}

export function evaluateCoverage(document: AuthoringLesson, evalCase: EvalCase): { passed: boolean; missing: string[]; forbidden: string[] } {
  const text = normalizeCoverageText(collectStringValues(document).join("\n"));
  const missing = (evalCase.mechanical_checks?.required_any ?? []).filter((alternatives) =>
    !alternatives.some((term) => text.includes(normalizeCoverageText(term))),
  ).map((alternatives) => alternatives.join(" | "));
  const forbidden = [...DEFAULT_FORBIDDEN, ...(evalCase.mechanical_checks?.forbidden ?? [])]
    .filter((term, index, all) => all.indexOf(term) === index && text.includes(normalizeCoverageText(term)));
  return { passed: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

export interface RawEvaluation {
  result: RunResult;
  events?: CanonicalEvent[];
  state?: SemanticBoardState;
}

export function evaluateRawAuthoring(
  raw: string,
  evalCase: EvalCase,
  identity: Pick<RunResult, "repetition" | "provider" | "model" | "resumed">,
  host: NormalizationHost,
): RawEvaluation {
  const result: RunResult = {
    case_id: evalCase.case_id, domain: evalCase.domain, ...identity, duration_ms: 0,
    parsed: false, schema_valid: false, semantic_valid: false, normalized: false, reduced: false,
    first_pass_core_executable: false, mechanical_coverage_status: "not_evaluated", missing_coverage: [], forbidden_hits: [],
  };
  try {
    let document: AuthoringLesson;
    try { document = JSON.parse(raw) as AuthoringLesson; result.parsed = true; }
    catch (error) { throw Object.assign(error as object, { stage: "parse" }); }

    const schema = validateAuthoringSchema(document);
    if (!schema.valid) throw Object.assign(new Error(schema.errors.map((item) => `${item.instancePath || "/"} ${item.message}`).join("; ")), { stage: "schema" });
    result.schema_valid = true;

    try { validateAuthoringLesson(document, host.resourceContext); result.semantic_valid = true; }
    catch (error) { throw Object.assign(error as object, { stage: "semantic" }); }

    let events: CanonicalEvent[];
    try { events = normalizeAuthoringLesson(document, host); result.normalized = true; }
    catch (error) { throw Object.assign(error as object, { stage: "normalize" }); }
    let state: SemanticBoardState;
    try { state = reduceCanonicalEvents(events); result.reduced = true; }
    catch (error) { throw Object.assign(error as object, { stage: "reduce" }); }

    result.first_pass_core_executable = true;
    const coverage = evaluateCoverage(document, evalCase);
    result.mechanical_coverage_status = coverage.passed ? "passed" : "failed";
    result.missing_coverage = coverage.missing;
    result.forbidden_hits = coverage.forbidden;
    return { result, events, state };
  } catch (error) {
    result.failure_stage = (error as { stage?: RunResult["failure_stage"] }).stage ?? "generation";
    result.error = asError(error);
    return { result };
  }
}

async function runOne(options: RunnerOptions, evalCase: EvalCase, casePath: string, repetition: number): Promise<RunResult> {
  const runDirectory = resolve(options.outputDirectory, evalCase.case_id, `run-${String(repetition).padStart(3, "0")}`);
  const rawPath = resolve(runDirectory, "raw.json");
  const resultPath = resolve(runDirectory, "result.json");
  await mkdir(runDirectory, { recursive: true });
  if (options.resume && await exists(resultPath)) return { ...(await loadJson<RunResult>(resultPath)), resumed: true };

  const started = Date.now();
  let result: RunResult;
  try {
    if (!(options.resume && await exists(rawPath))) {
      const prompt = await buildPrompt(options.root, evalCase, casePath);
      const generation = await options.provider.generate({
        caseId: evalCase.case_id,
        prompt,
        outputPath: rawPath,
        model: options.model,
        timeoutMs: options.timeoutMs,
        outputSchemaPath: resolve(options.root, "schema/authoring/v0.1.schema.json"),
      });
      await writeFile(resolve(runDirectory, "generation.json"), `${JSON.stringify(generation, null, 2)}\n`);
      if (generation.exit_code !== 0) throw Object.assign(new Error(`Provider exited with code ${generation.exit_code}`), { stage: "generation" });
    }

    const sessionContext = await resolveSessionContext(evalCase.session_context, casePath);
    const host = { lessonId: `${options.runId}:${evalCase.case_id}:${repetition}`, boardId: `eval:${evalCase.case_id}`, baseRevision: 0, resourceContext: sessionContext };
    const evaluation = evaluateRawAuthoring(
      await readFile(rawPath, "utf8"), evalCase,
      { repetition, provider: options.provider.name, model: options.model, resumed: false }, host,
    );
    result = evaluation.result;
    if (evaluation.events) await writeFile(resolve(runDirectory, "canonical.jsonl"), `${evaluation.events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    if (evaluation.state) await writeFile(resolve(runDirectory, "state.json"), `${JSON.stringify(evaluation.state, null, 2)}\n`);
  } catch (error) {
    result = {
      case_id: evalCase.case_id, domain: evalCase.domain, repetition,
      provider: options.provider.name, model: options.model, resumed: false, duration_ms: 0,
      parsed: false, schema_valid: false, semantic_valid: false, normalized: false, reduced: false,
      first_pass_core_executable: false, mechanical_coverage_status: "not_evaluated", missing_coverage: [], forbidden_hits: [],
      failure_stage: "generation", error: asError(error),
    };
  }
  result.duration_ms = Date.now() - started;
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function summarize(options: RunnerOptions, suite: EvalSuite, results: RunResult[]): EvalReport {
  const byDomain: EvalReport["by_domain"] = {};
  const failureStages: Record<string, number> = {};
  for (const result of results) {
    const item = byDomain[result.domain] ??= { runs: 0, executable: 0, rate: 0 };
    item.runs += 1;
    if (result.first_pass_core_executable) item.executable += 1;
    if (result.failure_stage) failureStages[result.failure_stage] = (failureStages[result.failure_stage] ?? 0) + 1;
  }
  for (const item of Object.values(byDomain)) item.rate = item.runs ? item.executable / item.runs : 0;
  const executable = results.filter((result) => result.first_pass_core_executable).length;
  const coverageEvaluated = results.filter((result) => result.mechanical_coverage_status !== "not_evaluated").length;
  const coveragePassed = results.filter((result) => result.mechanical_coverage_status === "passed").length;
  return {
    run_id: options.runId, suite_id: suite.suite_id, created_at: new Date().toISOString(),
    provider: options.provider.name, model: options.model, repetitions: options.repetitions,
    case_count: suite.cases.length, total_runs: suite.cases.length * options.repetitions, completed_runs: results.length,
    first_pass_core_executable_runs: executable, first_pass_core_executable_rate: results.length ? executable / results.length : 0,
    mechanical_coverage_evaluated_runs: coverageEvaluated, mechanical_coverage_passed_runs: coveragePassed,
    mechanical_coverage_rate: coverageEvaluated ? coveragePassed / coverageEvaluated : 0,
    by_domain: byDomain, failure_stages: failureStages, results,
  };
}

export function renderReport(report: EvalReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const domains = Object.entries(report.by_domain).map(([domain, value]) => `| ${domain} | ${value.executable}/${value.runs} | ${pct(value.rate)} |`).join("\n");
  const failures = Object.entries(report.failure_stages).map(([stage, count]) => `- ${stage}: ${count}`).join("\n") || "- none";
  return `# OLL eval: ${report.run_id}\n\n- Suite: ${report.suite_id}\n- Provider/model: ${report.provider} / ${report.model}\n- Runs: ${report.completed_runs}/${report.total_runs}\n- First-pass Core-executable: **${report.first_pass_core_executable_runs}/${report.completed_runs} (${pct(report.first_pass_core_executable_rate)})**\n- Mechanical coverage among executable results: ${report.mechanical_coverage_passed_runs}/${report.mechanical_coverage_evaluated_runs} (${pct(report.mechanical_coverage_rate)})\n\n## By domain\n\n| Domain | Core-executable | Rate |\n|---|---:|---:|\n${domains}\n\n## Failure stages\n\n${failures}\n`;
}

export async function runSuite(options: RunnerOptions): Promise<EvalReport> {
  const suite = await loadJson<EvalSuite>(options.suitePath);
  const cases = await Promise.all(suite.cases.map(async (relativePath) => {
    const path = resolve(dirname(options.suitePath), relativePath);
    return { path, evalCase: await loadJson<EvalCase>(path) };
  }));
  const jobs = cases.flatMap(({ path, evalCase }) => Array.from({ length: options.repetitions }, (_, index) => ({ path, evalCase, repetition: index + 1 })));
  const results: RunResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(options.concurrency, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]!;
      const result = await runOne(options, job.evalCase, job.path, job.repetition);
      results.push(result);
      options.onProgress?.(results.length, jobs.length, result);
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => a.case_id.localeCompare(b.case_id) || a.repetition - b.repetition);
  const report = summarize(options, suite, results);
  await mkdir(options.outputDirectory, { recursive: true });
  await writeFile(resolve(options.outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(options.outputDirectory, "REPORT.md"), renderReport(report));
  return report;
}
