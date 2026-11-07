import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildRuntimeGraph, evaluateGraph, findCycles } from "../scripts/check-import-graph.mjs";
import { discoverRuntimeSources } from "../scripts/runtime-source-guards.mjs";

type Files = Array<[string, string]>;

test("a synthetic runtime A -> B -> A cycle is reported and fails", () => {
  const files: Files = [
    ["a.ts", 'import { b } from "./b";\nexport const a = () => b;\n'],
    ["b.ts", 'import { a } from "./a";\nexport const b = () => a;\n'],
  ];
  const result = evaluateGraph(files);
  assert.deepEqual(result.cycles, [["a.ts", "b.ts"]]);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /runtime import cycle: a\.ts <-> b\.ts/);
});

test("an explicitly allowed cyclic component is reported but not a failure; a new one still fails", () => {
  const files: Files = [
    ["a.ts", 'import { b } from "./b";\nexport const a = b;\n'],
    ["b.ts", 'import { a } from "./a";\nexport const b = a;\n'],
    ["c.ts", 'import { d } from "./d";\nexport const c = d;\n'],
    ["d.ts", 'import { c } from "./c";\nexport const d = c;\n'],
  ];
  const result = evaluateGraph(files, [["b.ts", "a.ts"]]);
  assert.equal(result.cycles.length, 2);
  assert.deepEqual(result.problems, ["runtime import cycle: c.ts <-> d.ts"]);
});

test("a retained self-import is a cycle", () => {
  const self = 'import { a as me } from "./a";\nexport const a = 1;\nexport function again() { return me; }\n';
  assert.deepEqual(findCycles(buildRuntimeGraph([["a.ts", self]])), [["a.ts"]]);
});

test("ordinary imports used only as types, and unused value imports, are elided and are not cycles", () => {
  const typeOnlyUse: Files = [
    ["a.ts", 'import { B } from "./b";\nexport interface A { b: B }\n'],
    ["b.ts", 'import { A } from "./a";\nexport interface B { a: A }\n'],
  ];
  const unusedValue: Files = [
    ["a.ts", 'import { b } from "./b";\nexport const a = 1;\n'],
    ["b.ts", 'import { a } from "./a";\nexport const b = 2;\n'],
  ];
  for (const files of [typeOnlyUse, unusedValue]) {
    const result = evaluateGraph(files);
    assert.deepEqual(result.cycles, []);
    assert.deepEqual(result.problems, []);
  }
});

test("retained side-effect imports and value re-exports still form runtime cycles", () => {
  const sideEffect: Files = [
    ["a.ts", 'import "./b";\nexport const a = 1;\n'],
    ["b.ts", 'import "./a";\nexport const b = 1;\n'],
  ];
  const reexport: Files = [
    ["a.ts", 'export * from "./b";\n'],
    ["b.ts", 'export { a } from "./a";\n'],
  ];
  for (const files of [sideEffect, reexport]) assert.deepEqual(evaluateGraph(files).cycles, [["a.ts", "b.ts"]]);
});

test("an apparent cycle through type-only imports is not a runtime cycle", () => {
  const files: Files = [
    ["a.ts", 'import type { B } from "./b";\nexport interface A { b: B }\nexport const a = 1;\n'],
    ["b.ts", 'import { type A, a } from "./a";\nexport interface B { a: A }\nexport const b = a;\n'],
    ["c.ts", 'import type * as All from "./a";\nexport type { A } from "./a";\nexport const c = 1;\n'],
    ["d.ts", 'export { type A } from "./a";\nexport const d = 1;\n'],
  ];
  const result = evaluateGraph(files);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.cycles, []);
  const graph = buildRuntimeGraph(files);
  assert.deepEqual([...(graph.edges.get("b.ts") ?? [])], ["a.ts"], "inline type specifier with a value import keeps the runtime edge");
  assert.deepEqual([...(graph.edges.get("a.ts") ?? [])], []);
  assert.deepEqual([...(graph.edges.get("c.ts") ?? [])], []);
  assert.deepEqual([...(graph.edges.get("d.ts") ?? [])], []);
});

test("re-exports are runtime edges and can close a cycle", () => {
  const files: Files = [
    ["a.ts", 'export { b } from "./b";\nexport * from "./sub/index";\n'],
    ["b.ts", 'import { a } from "./a";\nexport const b = a;\n'],
    ["sub/index.ts", 'export const s = 1;\n'],
  ];
  const graph = buildRuntimeGraph(files);
  assert.deepEqual([...(graph.edges.get("a.ts") ?? [])].sort(), ["b.ts", "sub/index.ts"]);
  assert.deepEqual(findCycles(graph), [["a.ts", "b.ts"]]);
});

test("unresolved local runtime edges and dynamic imports fail instead of being dropped", () => {
  const files: Files = [
    ["a.ts", 'import { gone } from "./missing";\nimport { ok } from "obsidian";\nexport const a = [gone, ok];\n'],
    ["b.ts", 'export const lazy = () => import("./a");\n'],
  ];
  const result = evaluateGraph(files);
  assert.ok(result.problems.some((problem: string) => /unresolved local runtime import: a\.ts -> \.\/missing/.test(problem)));
  assert.ok(result.problems.some((problem: string) => /dynamic import\(\) in b\.ts/.test(problem)));
});

test("a type-only import of a missing file is erased, not an unresolved runtime edge", () => {
  const result = evaluateGraph([["a.ts", 'import type { X } from "./missing";\nexport type Y = X;\n']]);
  assert.deepEqual(result.problems, []);
});

test("real src graph: no unresolved edges and no runtime import cycle (main and library modals included)", async () => {
  const files = (await discoverRuntimeSources(path.resolve(import.meta.dirname, "..", "src"))) as Files;
  assert.ok(files.length > 20, "the real graph must actually be discovered");
  const result = evaluateGraph(files);
  assert.deepEqual(result.graph.unresolved, []);
  assert.deepEqual(result.graph.unsupported, []);
  // Record the observed real state honestly: at this head the only duplicate left is the
  // tuple in main.ts, and no module imports main at runtime, so the graph is acyclic.
  assert.deepEqual(result.cycles, []);
  assert.deepEqual(result.problems, []);
  for (const file of result.graph.nodes) {
    assert.ok(!result.graph.edges.get(file)?.has("main.ts"), `${file} must not import main.ts at runtime`);
  }
  const edgesOf = (file: string) => result.graph.edges.get(file) ?? new Set<string>();
  assert.ok(edgesOf("library-modal.ts").has("library-form-modals.ts"));
  assert.ok(edgesOf("library-form-modals.ts").has("library-icons.ts"));
  assert.ok(edgesOf("main.ts").has("library-modal.ts"));
});
