import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertAuthoringSchema,
  OllError,
  parseAuthoringLessonJson,
  validateAuthoringLesson,
  type AuthoringLesson,
  type ResourceContext,
} from "../src/index.js";

interface Mutation {
  op: "set" | "delete";
  pointer: string;
  value?: unknown;
}

interface InvalidFixture {
  id: string;
  description: string;
  layer: "parse" | "schema" | "semantic";
  input?: string;
  base?: string;
  context?: string;
  mutation?: Mutation;
  expected: { code: string; path: string };
}

const root = process.cwd();
const fixtureRoot = resolve(root, "fixtures/invalid");
const fixtures = JSON.parse(
  await readFile(resolve(fixtureRoot, "manifest.json"), "utf8"),
) as InvalidFixture[];

function mutate(document: unknown, mutation: Mutation): void {
  const segments = mutation.pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  assert.ok(segments.length > 0, "fixture mutation must not target the document root");
  let parent = document as Record<string, unknown> | unknown[];
  for (const segment of segments.slice(0, -1)) {
    const next = Array.isArray(parent)
      ? parent[Number(segment)]
      : parent[segment];
    assert.ok(next && typeof next === "object", `mutation path '${mutation.pointer}' must exist`);
    parent = next as Record<string, unknown> | unknown[];
  }
  const key = segments.at(-1)!;
  if (mutation.op === "delete") {
    if (Array.isArray(parent)) {
      delete parent[Number(key)];
    } else {
      delete parent[key];
    }
  } else if (Array.isArray(parent)) {
    parent[Number(key)] = structuredClone(mutation.value);
  } else {
    parent[key] = structuredClone(mutation.value);
  }
}

for (const fixture of fixtures) {
  test(`${fixture.id}: ${fixture.description}`, async () => {
    let execute: () => unknown;
    if (fixture.layer === "parse") {
      const source = await readFile(resolve(fixtureRoot, fixture.input!), "utf8");
      execute = () => parseAuthoringLessonJson(source);
    } else {
      const exampleRoot = resolve(root, "examples", fixture.base!);
      const document = JSON.parse(
        await readFile(resolve(exampleRoot, "lesson.authoring.json"), "utf8"),
      ) as AuthoringLesson;
      mutate(document, fixture.mutation!);
      if (fixture.layer === "schema") {
        execute = () => assertAuthoringSchema(document);
      } else {
        const context = fixture.context
          ? JSON.parse(
              await readFile(resolve(exampleRoot, fixture.context), "utf8"),
            ) as ResourceContext
          : null;
        execute = () => validateAuthoringLesson(document, context);
      }
    }

    assert.throws(
      execute,
      (error) =>
        error instanceof OllError &&
        error.code === fixture.expected.code &&
        error.path === fixture.expected.path,
    );
  });
}
