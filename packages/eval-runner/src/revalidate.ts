#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ResourceContext } from "../../core/src/index.js";
import { evaluateRawAuthoring, renderReport } from "./runner.js";
import type { EvalCase, EvalReport, EvalSuite, RunResult } from "./types.js";

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Expected --name value, received '${key ?? ""}'`);
    result[key.slice(2)] = value;
  }
  return result;
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function sessionContext(evalCase: EvalCase, casePath: string): Promise<ResourceContext | undefined> {
  const value = evalCase.session_context;
  if (!value) return undefined;
  return typeof value === "string" ? loadJson<ResourceContext>(resolve(dirname(casePath), value)) : value;
}

function summarize(runId: string, suite: EvalSuite, repetitions: number, results: RunResult[]): EvalReport {
  const byDomain: EvalReport["by_domain"] = {};
  const failureStages: Record<string, number> = {};
  for (const result of results) {
    const item = byDomain[result.domain] ??= { runs: 0, executable: 0, rate: 0 };
    item.runs += 1;
    if (result.first_pass_core_executable) item.executable += 1;
    if (result.failure_stage) failureStages[result.failure_stage] = (failureStages[result.failure_stage] ?? 0) + 1;
  }
  for (const value of Object.values(byDomain)) value.rate = value.executable / value.runs;
  const executable = results.filter((result) => result.first_pass_core_executable).length;
  const coverageEvaluated = results.filter((result) => result.mechanical_coverage_status !== "not_evaluated").length;
  const coveragePassed = results.filter((result) => result.mechanical_coverage_status === "passed").length;
  return {
    run_id: runId, suite_id: suite.suite_id, created_at: new Date().toISOString(), provider: "offline-revalidation", model: "preserved-raw",
    repetitions, case_count: suite.cases.length, total_runs: results.length, completed_runs: results.length,
    first_pass_core_executable_runs: executable, first_pass_core_executable_rate: executable / results.length,
    mechanical_coverage_evaluated_runs: coverageEvaluated, mechanical_coverage_passed_runs: coveragePassed,
    mechanical_coverage_rate: coverageEvaluated ? coveragePassed / coverageEvaluated : 0,
    by_domain: byDomain, failure_stages: failureStages, results,
  };
}

const args = parseArgs(process.argv.slice(2));
for (const required of ["suite", "source", "output", "run-id"]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}
const root = process.cwd();
const suitePath = resolve(root, args.suite!);
const source = resolve(root, args.source!);
const output = resolve(root, args.output!);
const repetitions = Number(args.repetitions ?? "5");
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("--repetitions must be a positive integer");
const suite = await loadJson<EvalSuite>(suitePath);
const results: RunResult[] = [];

for (const relativeCasePath of suite.cases) {
  const casePath = resolve(dirname(suitePath), relativeCasePath);
  const evalCase = await loadJson<EvalCase>(casePath);
  const resourceContext = await sessionContext(evalCase, casePath);
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const rawPath = resolve(source, evalCase.case_id, `run-${String(repetition).padStart(3, "0")}`, "raw.json");
    const started = Date.now();
    const evaluation = evaluateRawAuthoring(
      await readFile(rawPath, "utf8"), evalCase,
      { repetition, provider: "offline-revalidation", model: "preserved-raw", resumed: false },
      { lessonId: `${args["run-id"]}:${evalCase.case_id}:${repetition}`, boardId: `revalidation:${evalCase.case_id}`, baseRevision: 0, resourceContext },
    );
    evaluation.result.duration_ms = Date.now() - started;
    results.push(evaluation.result);
  }
}

const report = summarize(args["run-id"]!, suite, repetitions, results);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resolve(output, "REPORT.md"), `${renderReport(report)}\n> Post-hoc offline revalidation of preserved raw outputs. This is not a fresh model-generation rate.\n`);
console.log(`Post-hoc Core-executable: ${report.first_pass_core_executable_runs}/${report.completed_runs} (${(report.first_pass_core_executable_rate * 100).toFixed(1)}%)`);
console.log(`Report: ${resolve(output, "REPORT.md")}`);
