#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ResourceContext } from "../../core/src/index.js";
import { evaluateRawAuthoring } from "../../eval-runner/src/runner.js";
import { CodexCliProvider } from "../../eval-runner/src/providers.js";
import type { EvalCase, EvalSuite } from "../../eval-runner/src/types.js";
import { computeQualityGate, validateQualityJudgment } from "./quality.js";
import type { QualityCaseResult, QualityJudgment } from "./types.js";

interface SelectedLesson {
  evalCase: EvalCase;
  repetition: number;
  raw: string;
  resourceContext?: ResourceContext;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument '${token}'`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[token.slice(2)] = true;
    else { result[token.slice(2)] = next; index += 1; }
  }
  return result;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function contextFor(evalCase: EvalCase, casePath: string): Promise<ResourceContext | undefined> {
  const value = evalCase.session_context;
  if (!value) return undefined;
  return typeof value === "string" ? json<ResourceContext>(resolve(dirname(casePath), value)) : value;
}

async function selectLessons(suitePath: string, source: string, repetitions: number): Promise<SelectedLesson[]> {
  const suite = await json<EvalSuite>(suitePath);
  const selected: SelectedLesson[] = [];
  for (const relativeCase of suite.cases) {
    const casePath = resolve(dirname(suitePath), relativeCase);
    const evalCase = await json<EvalCase>(casePath);
    const resourceContext = await contextFor(evalCase, casePath);
    let found: SelectedLesson | undefined;
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const rawPath = resolve(source, evalCase.case_id, `run-${String(repetition).padStart(3, "0")}`, "raw.json");
      const raw = await readFile(rawPath, "utf8");
      const evaluation = evaluateRawAuthoring(
        raw, evalCase, { repetition, provider: "selection", model: "preserved-raw", resumed: false },
        { lessonId: `quality:${evalCase.case_id}:${repetition}`, boardId: `quality:${evalCase.case_id}`, baseRevision: 0, resourceContext },
      );
      if (evaluation.result.first_pass_core_executable) {
        found = { evalCase, repetition, raw, resourceContext };
        break;
      }
    }
    if (!found) throw new Error(`No Core-executable sample found for '${evalCase.case_id}'`);
    selected.push(found);
  }
  return selected;
}

const args = parseArgs(process.argv.slice(2));
for (const required of ["suite", "source", "output"]) if (!args[required]) throw new Error(`Missing --${required}`);
const root = process.cwd();
const suitePath = resolve(root, String(args.suite));
const source = resolve(root, String(args.source));
const output = resolve(root, String(args.output));
const model = String(args.model ?? "gpt-5.6-terra");
const repetitions = Number(args.repetitions ?? 5);
const concurrency = Number(args.concurrency ?? 3);
const resume = args.resume === true;
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("--repetitions must be a positive integer");
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("--concurrency must be a positive integer");
const [rubric, schema, contract, selected] = await Promise.all([
  readFile(resolve(root, "evals/rubrics/lesson-quality-v0.2.md"), "utf8"),
  readFile(resolve(root, "evals/rubrics/lesson-quality-v0.2.schema.json"), "utf8"),
  readFile(resolve(root, "evals/prompts/quality-judge-v0.2.md"), "utf8"),
  selectLessons(suitePath, source, repetitions),
]);
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(resolve(output, "rubric.snapshot.md"), rubric),
  writeFile(resolve(output, "judge-contract.snapshot.md"), contract),
  writeFile(resolve(output, "judgment-schema.snapshot.json"), schema),
  writeFile(resolve(output, "run-config.json"), `${JSON.stringify({ rubric_version: "0.2", model, repetitions, concurrency, suite: String(args.suite), source: String(args.source) }, null, 2)}\n`),
]);
await writeFile(resolve(output, "selection.json"), `${JSON.stringify(selected.map((item) => ({ case_id: item.evalCase.case_id, domain: item.evalCase.domain, source_repetition: item.repetition })), null, 2)}\n`);
const provider = new CodexCliProvider();
const results: QualityCaseResult[] = [];
let cursor = 0;

const workers = Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
  while (cursor < selected.length) {
    const item = selected[cursor++]!;
    const directory = resolve(output, item.evalCase.case_id);
    const rawOutput = resolve(directory, "judgment.raw.json");
    const resultPath = resolve(directory, "result.json");
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(resolve(directory, "lesson.authoring.json"), item.raw.endsWith("\n") ? item.raw : `${item.raw}\n`),
      writeFile(resolve(directory, "case.json"), `${JSON.stringify(item.evalCase, null, 2)}\n`),
      writeFile(resolve(directory, "resolved-context.json"), `${JSON.stringify(item.resourceContext ?? { assets: [] }, null, 2)}\n`),
    ]);
    if (resume && await exists(resultPath)) {
      results.push(await json<QualityCaseResult>(resultPath));
      continue;
    }
    const prompt = [
      contract.trim(), "\n## Rubric\n", rubric.trim(), "\n## Judgment Schema\n", schema.trim(),
      "\n## Case and Context\n", JSON.stringify(item.evalCase, null, 2),
      "\n## Resolved Session Context\n", JSON.stringify(item.resourceContext ?? { assets: [] }, null, 2),
      "\n## OLL Authoring Lesson\n", item.raw.trim(),
      "\n现在只输出 Quality Judgment JSON。",
    ].join("\n");
    const generation = await provider.generate({ caseId: item.evalCase.case_id, prompt, outputPath: rawOutput, model, timeoutMs: 300_000 });
    await writeFile(resolve(directory, "generation.json"), `${JSON.stringify(generation, null, 2)}\n`);
    let result: QualityCaseResult = {
      case_id: item.evalCase.case_id, domain: item.evalCase.domain, source_repetition: item.repetition,
      judge_model: model, judge_output_valid: false,
    };
    try {
      if (generation.exit_code !== 0) throw new Error(`Judge provider exited with ${generation.exit_code}`);
      const judgment = JSON.parse(await readFile(rawOutput, "utf8")) as QualityJudgment;
      const validation = validateQualityJudgment(judgment);
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      if (judgment.case_id !== item.evalCase.case_id) throw new Error(`Judgment case_id '${judgment.case_id}' does not match`);
      result = { ...result, judge_output_valid: true, judgment, gate: computeQualityGate(judgment) };
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    results.push(result);
    console.log(`[${results.length}/${selected.length}] ${result.case_id}: ${result.judge_output_valid ? `${result.gate!.total_score}/32 ${result.gate!.passed ? "pass" : "fail"}` : "judge-invalid"}`);
  }
});
await Promise.all(workers);
results.sort((a, b) => a.case_id.localeCompare(b.case_id));
const evaluated = results.filter((result) => result.judge_output_valid);
const passed = evaluated.filter((result) => result.gate?.passed).length;
const average = evaluated.length ? evaluated.reduce((sum, result) => sum + result.gate!.total_score, 0) / evaluated.length : 0;
const byDomain: Record<string, { evaluated: number; passed: number; average_score: number }> = {};
for (const result of evaluated) {
  const value = byDomain[result.domain] ??= { evaluated: 0, passed: 0, average_score: 0 };
  value.evaluated += 1;
  value.passed += Number(result.gate!.passed);
  value.average_score += result.gate!.total_score;
}
for (const value of Object.values(byDomain)) value.average_score /= value.evaluated;
const report = { profile: "octos.lesson-quality.eval", version: "0.2", created_at: new Date().toISOString(), judge_model: model, selected: selected.length, evaluated: evaluated.length, judge_invalid: results.length - evaluated.length, gate_passed: passed, gate_failed: evaluated.length - passed, average_score: average, by_domain: byDomain, results };
await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const domains = Object.entries(byDomain).map(([domain, value]) => `| ${domain} | ${value.passed}/${value.evaluated} | ${value.average_score.toFixed(1)}/32 |`).join("\n");
await writeFile(resolve(output, "REPORT.md"), `# OLL lesson quality sample\n\n- Judge: ${model}\n- Deterministic sample: lowest Core-executable repetition per case\n- Valid judgments: ${evaluated.length}/${selected.length}\n- Quality gate: **${passed}/${evaluated.length}**\n- Average: ${average.toFixed(1)}/32\n\n| Domain | Passed | Average |\n|---|---:|---:|\n${domains}\n\n> Model-judge result; requires stratified human audit before product gating.\n`);
console.log(`Quality gate: ${passed}/${evaluated.length}; average ${average.toFixed(1)}/32`);
