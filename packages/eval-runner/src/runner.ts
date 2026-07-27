import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  normalizeAuthoringLesson,
  reduceCanonicalEvents,
  validateAuthoringLesson,
  validateAuthoringSchema,
  type AuthoringLesson,
  type ResourceContext,
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

function evaluateCoverage(document: AuthoringLesson, evalCase: EvalCase): { passed: boolean; missing: string[]; forbidden: string[] } {
  const text = JSON.stringify(document).toLowerCase();
  const missing = (evalCase.mechanical_checks?.required_any ?? []).filter((alternatives) =>
    !alternatives.some((term) => text.includes(term.toLowerCase())),
  ).map((alternatives) => alternatives.join(" | "));
  const forbidden = [...DEFAULT_FORBIDDEN, ...(evalCase.mechanical_checks?.forbidden ?? [])]
    .filter((term, index, all) => all.indexOf(term) === index && text.includes(term.toLowerCase()));
  return { passed: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

async function runOne(options: RunnerOptions, evalCase: EvalCase, casePath: string, repetition: number): Promise<RunResult> {
  const runDirectory = resolve(options.outputDirectory, evalCase.case_id, `run-${String(repetition).padStart(3, "0")}`);
  const rawPath = resolve(runDirectory, "raw.json");
  const resultPath = resolve(runDirectory, "result.json");
  await mkdir(runDirectory, { recursive: true });
  if (options.resume && await exists(resultPath)) return { ...(await loadJson<RunResult>(resultPath)), resumed: true };

  const started = Date.now();
  let result: RunResult = {
    case_id: evalCase.case_id, domain: evalCase.domain, repetition,
    provider: options.provider.name, model: options.model, resumed: false, duration_ms: 0,
    parsed: false, schema_valid: false, semantic_valid: false, normalized: false, reduced: false,
    first_pass_playable: false, mechanical_coverage_passed: false, missing_coverage: [], forbidden_hits: [],
  };
  try {
    if (!(options.resume && await exists(rawPath))) {
      const prompt = await buildPrompt(options.root, evalCase, casePath);
      const generation = await options.provider.generate({ caseId: evalCase.case_id, prompt, outputPath: rawPath, model: options.model, timeoutMs: options.timeoutMs });
      await writeFile(resolve(runDirectory, "generation.json"), `${JSON.stringify(generation, null, 2)}\n`);
      if (generation.exit_code !== 0) throw Object.assign(new Error(`Provider exited with code ${generation.exit_code}`), { stage: "generation" });
    }

    let document: AuthoringLesson;
    try { document = JSON.parse(await readFile(rawPath, "utf8")) as AuthoringLesson; result.parsed = true; }
    catch (error) { throw Object.assign(error as object, { stage: "parse" }); }

    const schema = validateAuthoringSchema(document);
    if (!schema.valid) throw Object.assign(new Error(schema.errors.map((item) => `${item.instancePath || "/"} ${item.message}`).join("; ")), { stage: "schema" });
    result.schema_valid = true;

    const sessionContext = await resolveSessionContext(evalCase.session_context, casePath);
    try { validateAuthoringLesson(document, sessionContext); result.semantic_valid = true; }
    catch (error) { throw Object.assign(error as object, { stage: "semantic" }); }

    const host = { lessonId: `${options.runId}:${evalCase.case_id}:${repetition}`, boardId: `eval:${evalCase.case_id}`, baseRevision: 0, resourceContext: sessionContext };
    let events;
    try { events = normalizeAuthoringLesson(document, host); result.normalized = true; }
    catch (error) { throw Object.assign(error as object, { stage: "normalize" }); }
    await writeFile(resolve(runDirectory, "canonical.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    try {
      const state = reduceCanonicalEvents(events);
      result.reduced = true;
      await writeFile(resolve(runDirectory, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
    } catch (error) { throw Object.assign(error as object, { stage: "reduce" }); }

    result.first_pass_playable = true;
    const coverage = evaluateCoverage(document, evalCase);
    result.mechanical_coverage_passed = coverage.passed;
    result.missing_coverage = coverage.missing;
    result.forbidden_hits = coverage.forbidden;
    if (!coverage.passed) result.failure_stage = "coverage";
  } catch (error) {
    const stage = (error as { stage?: RunResult["failure_stage"] }).stage ?? "generation";
    result.failure_stage = stage;
    result.error = asError(error);
  }
  result.duration_ms = Date.now() - started;
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function summarize(options: RunnerOptions, suite: EvalSuite, results: RunResult[]): EvalReport {
  const byDomain: EvalReport["by_domain"] = {};
  const failureStages: Record<string, number> = {};
  for (const result of results) {
    const item = byDomain[result.domain] ??= { runs: 0, playable: 0, rate: 0 };
    item.runs += 1;
    if (result.first_pass_playable) item.playable += 1;
    if (result.failure_stage) failureStages[result.failure_stage] = (failureStages[result.failure_stage] ?? 0) + 1;
  }
  for (const item of Object.values(byDomain)) item.rate = item.runs ? item.playable / item.runs : 0;
  const playable = results.filter((result) => result.first_pass_playable).length;
  const covered = results.filter((result) => result.mechanical_coverage_passed).length;
  return {
    run_id: options.runId, suite_id: suite.suite_id, created_at: new Date().toISOString(),
    provider: options.provider.name, model: options.model, repetitions: options.repetitions,
    case_count: suite.cases.length, total_runs: suite.cases.length * options.repetitions, completed_runs: results.length,
    first_pass_playable_runs: playable, first_pass_playable_rate: results.length ? playable / results.length : 0,
    mechanical_coverage_runs: covered, mechanical_coverage_rate: results.length ? covered / results.length : 0,
    by_domain: byDomain, failure_stages: failureStages, results,
  };
}

export function renderReport(report: EvalReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const domains = Object.entries(report.by_domain).map(([domain, value]) => `| ${domain} | ${value.playable}/${value.runs} | ${pct(value.rate)} |`).join("\n");
  const failures = Object.entries(report.failure_stages).map(([stage, count]) => `- ${stage}: ${count}`).join("\n") || "- none";
  return `# OLL eval: ${report.run_id}\n\n- Suite: ${report.suite_id}\n- Provider/model: ${report.provider} / ${report.model}\n- Runs: ${report.completed_runs}/${report.total_runs}\n- First-pass playable: **${report.first_pass_playable_runs}/${report.completed_runs} (${pct(report.first_pass_playable_rate)})**\n- Mechanical coverage: ${report.mechanical_coverage_runs}/${report.completed_runs} (${pct(report.mechanical_coverage_rate)})\n\n## By domain\n\n| Domain | Playable | Rate |\n|---|---:|---:|\n${domains}\n\n## Failure stages\n\n${failures}\n`;
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
