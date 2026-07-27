#!/usr/bin/env node
import { resolve } from "node:path";
import { CodexCliProvider, FixtureProvider } from "./providers.js";
import { runSuite } from "./runner.js";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument '${token}'`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function numberArg(args: Record<string, string | boolean>, name: string, fallback: number): number {
  const value = args[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function help(): void {
  console.log(`OLL automatic eval runner

Usage:
  npm run eval -- --suite evals/suites/unseen-v1.json --repetitions 5 --concurrency 2 --resume

Options:
  --suite <path>          Suite manifest (required)
  --run-id <id>           Stable output ID; defaults to UTC timestamp
  --output <directory>    Defaults to evals/runs/<run-id>
  --provider <name>       codex-cli (default) or fixture
  --fixture-dir <path>    Fixture JSON directory for fixture provider
  --model <model>         Defaults to gpt-5.6-sol
  --repetitions <n>       Defaults to 1
  --concurrency <n>       Defaults to 1
  --timeout-ms <n>        Defaults to 300000
  --resume                Reuse completed result.json files and raw outputs
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.suite) {
  help();
  if (!args.help) process.exitCode = 2;
} else {
  const root = process.cwd();
  const runId = String(args["run-id"] ?? new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z"));
  const providerName = String(args.provider ?? "codex-cli");
  const provider = providerName === "fixture"
    ? new FixtureProvider(resolve(root, String(args["fixture-dir"] ?? "packages/eval-runner/test/fixtures")))
    : providerName === "codex-cli" ? new CodexCliProvider() : (() => { throw new Error(`Unknown provider '${providerName}'`); })();
  const outputDirectory = resolve(root, String(args.output ?? `evals/runs/${runId}`));
  const report = await runSuite({
    root,
    suitePath: resolve(root, String(args.suite)),
    outputDirectory,
    runId,
    repetitions: numberArg(args, "repetitions", 1),
    concurrency: numberArg(args, "concurrency", 1),
    timeoutMs: numberArg(args, "timeout-ms", 300_000),
    model: String(args.model ?? "gpt-5.6-sol"),
    resume: args.resume === true,
    provider,
    onProgress(done, total, result) {
      console.log(`[${done}/${total}] ${result.case_id} #${result.repetition}: ${result.first_pass_core_executable ? "core-executable" : `failed:${result.failure_stage}`}${result.resumed ? " (resumed)" : ""}`);
    },
  });
  console.log(`Report: ${resolve(outputDirectory, "REPORT.md")}`);
  console.log(`First-pass Core-executable: ${report.first_pass_core_executable_runs}/${report.completed_runs} (${(report.first_pass_core_executable_rate * 100).toFixed(1)}%)`);
}
