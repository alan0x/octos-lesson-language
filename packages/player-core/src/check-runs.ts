#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import type { CanonicalEvent } from "../../core/src/index.js";
import { runPlaybackConformance } from "./index.js";

interface RunConformanceResult {
  source: string;
  passed: boolean;
  lesson_id?: string;
  operation_count?: number;
  action_count?: number;
  checkpoint_count?: number;
  final_revision?: number;
  node_count?: number;
  connection_count?: number;
  group_count?: number;
  error?: { name: string; message: string; code?: string; path?: string };
}

async function findCanonicalFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await findCanonicalFiles(path));
    else if (entry.name === "canonical.jsonl") result.push(path);
  }
  return result.sort();
}

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

function errorRecord(error: unknown): RunConformanceResult["error"] {
  if (!(error instanceof Error)) return { name: "UnknownError", message: String(error) };
  const value = error as Error & { code?: string; path?: string };
  return { name: value.name, message: value.message, ...(value.code ? { code: value.code } : {}), ...(value.path ? { path: value.path } : {}) };
}

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args.output) throw new Error("Usage: --source <eval run directory> --output <report directory>");
const root = process.cwd();
const source = resolve(root, args.source);
const output = resolve(root, args.output);
const files = await findCanonicalFiles(source);
const results: RunConformanceResult[] = [];

for (const file of files) {
  try {
    const events = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as CanonicalEvent);
    const result = runPlaybackConformance(events);
    results.push({ source: relative(source, file), passed: true, ...result });
  } catch (error) {
    results.push({ source: relative(source, file), passed: false, error: errorRecord(error) });
  }
}

const passed = results.filter((result) => result.passed).length;
const sum = (field: "operation_count" | "action_count") => results.reduce((total, result) => total + (result[field] ?? 0), 0);
const report = {
  profile: "octos.playback.conformance",
  version: "0.1",
  created_at: new Date().toISOString(),
  source_run: basename(source),
  canonical_lessons: results.length,
  passed,
  failed: results.length - passed,
  operation_count: sum("operation_count"),
  action_count: sum("action_count"),
  results,
};
const failures = results.filter((result) => !result.passed).map((result) => `- ${result.source}: ${result.error?.message}`).join("\n") || "- none";
const markdown = `# Headless playback conformance: ${report.source_run}\n\n- Canonical lessons: ${results.length}\n- Passed: **${passed}/${results.length}**\n- Playback operations: ${report.operation_count}\n- Canonical actions: ${report.action_count}\n- Checkpoint strategy: first, midpoint and final action per lesson\n- Final state equality: compared with batch Reducer\n\n## Failures\n\n${failures}\n`;
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resolve(output, "REPORT.md"), markdown);
console.log(`Headless playback conformance: ${passed}/${results.length}`);
console.log(`Report: ${resolve(output, "REPORT.md")}`);
