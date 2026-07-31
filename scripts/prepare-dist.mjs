import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const schema = fileURLToPath(new URL("../schema", import.meta.url));
const distSchema = fileURLToPath(new URL("../dist/schema", import.meta.url));

await rm(dist, { recursive: true, force: true });
await cp(schema, distSchema, { recursive: true });

console.log(`[prepare-dist] rebuilt ${dist} and copied schemas from ${schema}`);
