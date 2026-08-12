import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const builtSchemaPath = fileURLToPath(
  new URL("../dist/schema/authoring/v0.1.schema.json", import.meta.url),
);
const builtInkRuntimePath = fileURLToPath(
  new URL("../dist/packages/ink-runtime/src/index.js", import.meta.url),
);
const inkStylesPath = fileURLToPath(new URL("../packages/ink-runtime/styles.css", import.meta.url));
const inkReadmePath = fileURLToPath(new URL("../packages/ink-runtime/README.md", import.meta.url));
const thirdPartyNoticesPath = fileURLToPath(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url));
const harnessAppPath = fileURLToPath(new URL("../dist/apps/playback-harness/browser/app.js", import.meta.url));
const harnessInkPath = fileURLToPath(new URL("../dist/apps/playback-harness/browser/ink-entry.js", import.meta.url));
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

if (!packageJson.files?.includes("dist/schema/")) {
  throw new Error("package files must include dist/schema/");
}

await access(builtSchemaPath);
await Promise.all([
  access(builtInkRuntimePath),
  access(inkStylesPath),
  access(inkReadmePath),
  access(thirdPartyNoticesPath),
]);
JSON.parse(await readFile(builtSchemaPath, "utf8"));

if (packageJson.dependencies?.["js-draw"] !== "1.33.0") {
  throw new Error("optional Ink Runtime must pin js-draw to exact version 1.33.0");
}
if (!packageJson.exports?.["./ink-runtime"] || !packageJson.exports?.["./ink-runtime/styles.css"]) {
  throw new Error("package exports must expose the optional Ink Runtime and its stylesheet");
}
const [harnessApp, harnessInk] = await Promise.all([
  readFile(harnessAppPath, "utf8"),
  readFile(harnessInkPath, "utf8"),
]);
if (harnessApp.includes("Octos student ink") || !harnessInk.includes("Octos student ink")) {
  throw new Error("Harness must load js-draw only through the lazy ink entry bundle");
}

console.log(`[check-package-contents] verified Schema, optional Ink Runtime, notices, and lazy Harness split`);
