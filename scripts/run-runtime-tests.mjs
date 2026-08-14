import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const root = process.cwd();
const testsRoot = path.join(root, "tests");
const options = new Set(process.argv.slice(2));
const supportedOptions = new Set(["--coverage"]);
for (const option of options) {
  if (!supportedOptions.has(option)) throw new Error(`Unknown runtime-test option: ${option}`);
}

async function discoverRuntimeTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await discoverRuntimeTests(absolute));
    else if (entry.isFile() && entry.name.endsWith(".test.ts") && entry.name !== "release.test.ts") files.push(absolute);
  }
  return files;
}

const testFiles = (await discoverRuntimeTests(testsRoot))
  .map((file) => path.relative(root, file))
  .sort((left, right) => left.localeCompare(right, "en"));
if (testFiles.length === 0) throw new Error("No runtime *.test.ts files were discovered.");

const nodeArguments = ["--import", "tsx", "--import", "./tests/support/register.mjs"];
if (options.has("--coverage")) {
  nodeArguments.push(
    "--experimental-test-coverage",
    "--test-coverage-lines=80",
    "--test-coverage-branches=75",
    "--test-coverage-functions=70",
    "--test-coverage-include=src/*.ts",
  );
}
nodeArguments.push("--test", ...testFiles);

process.stdout.write(`Discovered ${testFiles.length} runtime test files${options.has("--coverage") ? " with all-source coverage gates" : ""}.\n`);
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, nodeArguments, { cwd: root, env: process.env, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) reject(new Error(`Runtime tests terminated by ${signal}.`));
    else resolve(code ?? 1);
  });
});
process.exitCode = exitCode;
