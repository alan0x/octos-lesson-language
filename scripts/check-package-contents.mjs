import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const builtSchemaPath = fileURLToPath(
  new URL("../dist/schema/authoring/v0.1.schema.json", import.meta.url),
);
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

if (!packageJson.files?.includes("dist/schema/")) {
  throw new Error("package files must include dist/schema/");
}

await access(builtSchemaPath);
JSON.parse(await readFile(builtSchemaPath, "utf8"));

console.log(`[check-package-contents] verified ${builtSchemaPath}`);
