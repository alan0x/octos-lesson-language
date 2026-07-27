import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FixtureProvider } from "../src/providers.js";
import { runSuite } from "../src/runner.js";

test("runner records deterministic playability and resumes completed runs", async () => {
  const root = process.cwd();
  const temporary = await mkdtemp(resolve(tmpdir(), "oll-runner-test-"));
  const fixtures = resolve(temporary, "fixtures");
  const cases = resolve(temporary, "cases");
  await mkdir(fixtures);
  await mkdir(cases);
  const evalCase = {
    case_id: "runner-smoke", domain: "math", language: "zh-CN",
    learner_request: "解释配方法", required_coverage: ["配方法"],
    mechanical_checks: { required_any: [["顶点式", "vertex form"]] },
  };
  await writeFile(resolve(cases, "case.json"), JSON.stringify(evalCase));
  await writeFile(resolve(temporary, "suite.json"), JSON.stringify({ suite_id: "smoke", cases: ["cases/case.json"] }));
  await writeFile(resolve(fixtures, "runner-smoke.json"), await readFile(resolve(root, "examples/quadratic/lesson.authoring.json"), "utf8"));
  const outputDirectory = resolve(temporary, "output");
  const common = {
    root, suitePath: resolve(temporary, "suite.json"), outputDirectory, runId: "smoke",
    repetitions: 2, concurrency: 2, model: "fixture", timeoutMs: 1000,
    provider: new FixtureProvider(fixtures),
  };
  const first = await runSuite({ ...common, resume: false });
  assert.equal(first.first_pass_playable_rate, 1);
  assert.equal(first.mechanical_coverage_rate, 1);
  const resumed = await runSuite({ ...common, resume: true });
  assert.ok(resumed.results.every((result) => result.resumed));
  assert.match(await readFile(resolve(outputDirectory, "REPORT.md"), "utf8"), /100\.0%/);
});

test("runner does not repair fenced JSON", async () => {
  const root = process.cwd();
  const temporary = await mkdtemp(resolve(tmpdir(), "oll-runner-test-"));
  await mkdir(resolve(temporary, "fixtures"));
  await mkdir(resolve(temporary, "cases"));
  await writeFile(resolve(temporary, "cases/case.json"), JSON.stringify({ case_id: "fenced", domain: "test", language: "en", learner_request: "test", required_coverage: [] }));
  await writeFile(resolve(temporary, "suite.json"), JSON.stringify({ suite_id: "fenced", cases: ["cases/case.json"] }));
  await writeFile(resolve(temporary, "fixtures/fenced.json"), "```json\n{}\n```\n");
  const report = await runSuite({
    root, suitePath: resolve(temporary, "suite.json"), outputDirectory: resolve(temporary, "output"), runId: "fenced",
    repetitions: 1, concurrency: 1, model: "fixture", timeoutMs: 1000, resume: false,
    provider: new FixtureProvider(resolve(temporary, "fixtures")),
  });
  assert.equal(report.first_pass_playable_rate, 0);
  assert.equal(report.results[0]!.failure_stage, "parse");
});

test("unseen suite contains at least 20 unique cross-disciplinary cases", async () => {
  const root = process.cwd();
  const suitePath = resolve(root, "evals/suites/unseen-v1.json");
  const suite = JSON.parse(await readFile(suitePath, "utf8")) as { cases: string[] };
  assert.ok(suite.cases.length >= 20);
  const cases = await Promise.all(suite.cases.map(async (path) => JSON.parse(await readFile(resolve(root, "evals/suites", path), "utf8")) as { case_id: string; domain: string; reference_authoring?: string }));
  assert.equal(new Set(cases.map((item) => item.case_id)).size, cases.length);
  assert.ok(new Set(cases.map((item) => item.domain)).size >= 8);
  assert.ok(cases.every((item) => !item.reference_authoring));
});
