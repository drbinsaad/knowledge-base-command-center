import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

// Self-test for the include-all test type gate: every TypeScript file under tests/
// must be a root of exactly one of the two test configs (runtime vs browser/layout),
// so a future test file enters the gate automatically and cannot be forgotten.

const root = process.cwd();

function resolvedFiles(configName: string): string[] {
  const configPath = path.join(root, configName);
  const read = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  assert.equal(read.error, undefined, `${configName} must be readable`);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
  assert.deepEqual(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")), []);
  return parsed.fileNames.map((file) => path.normalize(file));
}

async function testTypeScriptFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue; // AppleDouble metadata, never a real test file
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await testTypeScriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(path.normalize(absolute));
  }
  return found;
}

test("every tests/**/*.ts file is type-checked by exactly one test config", async () => {
  const runtime = new Set(resolvedFiles("tsconfig.tests.json").filter((file) => file.startsWith(path.join(root, "tests") + path.sep)));
  const browser = new Set(resolvedFiles("tsconfig.browser-tests.json").filter((file) => file.startsWith(path.join(root, "tests") + path.sep)));
  const all = await testTypeScriptFiles(path.join(root, "tests"));
  assert.ok(all.length > 50, `expected the full test tree, found ${all.length} files`);

  const uncovered = all.filter((file) => !runtime.has(file) && !browser.has(file));
  assert.deepEqual(uncovered.map((file) => path.relative(root, file)), [], "test files outside both type configs");
  const doubled = all.filter((file) => runtime.has(file) && browser.has(file));
  assert.deepEqual(doubled.map((file) => path.relative(root, file)), [], "test files claimed by both configs");

  // The browser/layout split is by directory and the gate must really contain both lanes.
  assert.ok([...browser].some((file) => file.includes(`${path.sep}tests${path.sep}layout${path.sep}`)), "layout specs are in the browser config");
  assert.ok([...browser].some((file) => file.includes(`${path.sep}tests${path.sep}browser${path.sep}`)), "browser harnesses are in the browser config");
  assert.ok([...runtime].some((file) => file.endsWith("main.test.ts")), "runtime tests are in the runtime config");
  assert.ok([...runtime].some((file) => file.endsWith(".perf.ts")), "performance tests are in the runtime config");
});

test("the coverage check flags a file outside both lanes and a file claimed twice", () => {
  const lanes = (all: string[], runtime: string[], browser: string[]) => ({
    uncovered: all.filter((file) => !runtime.includes(file) && !browser.includes(file)),
    doubled: all.filter((file) => runtime.includes(file) && browser.includes(file)),
  });
  const result = lanes(["a.test.ts", "b.test.ts", "c.spec.ts", "d.test.ts"], ["a.test.ts", "d.test.ts"], ["c.spec.ts", "d.test.ts"]);
  assert.deepEqual(result.uncovered, ["b.test.ts"]);
  assert.deepEqual(result.doubled, ["d.test.ts"]);
});
