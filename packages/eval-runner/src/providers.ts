import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { GenerationProvider, GenerationRequest, GenerationResult } from "./types.js";

export function codexExecArgs(request: GenerationRequest): string[] {
  return [
    "exec", "-m", request.model, "--ephemeral", "--ignore-user-config", "--ignore-rules",
    "--skip-git-repo-check", "--sandbox", "read-only",
    ...(request.outputSchemaPath ? ["--output-schema", request.outputSchemaPath] : []),
    "--output-last-message", request.outputPath, "-",
  ];
}

export class CodexCliProvider implements GenerationProvider {
  readonly name = "codex-cli";
  constructor(private readonly executable = process.env.OLL_CODEX_BIN ?? "/Applications/ChatGPT.app/Contents/Resources/codex") {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    await mkdir(dirname(request.outputPath), { recursive: true });
    const started = Date.now();
    const args = codexExecArgs(request);
    const child = spawn(this.executable, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.stdin.end(request.prompt);
    const timer = setTimeout(() => child.kill("SIGTERM"), request.timeoutMs);
    const exitCode = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("close", (code) => done(code ?? 1));
    }).finally(() => clearTimeout(timer));
    return {
      provider: this.name,
      model: request.model,
      duration_ms: Date.now() - started,
      exit_code: exitCode,
      ...(stderr ? { stderr: stderr.slice(-8000) } : {}),
    };
  }
}

export class FixtureProvider implements GenerationProvider {
  readonly name = "fixture";
  constructor(private readonly fixtureDirectory: string) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const started = Date.now();
    await mkdir(dirname(request.outputPath), { recursive: true });
    const fixture = resolve(this.fixtureDirectory, `${request.caseId}.json`);
    await copyFile(fixture, request.outputPath);
    return { provider: this.name, model: "fixture", duration_ms: Date.now() - started, exit_code: 0 };
  }
}
