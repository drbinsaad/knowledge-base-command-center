import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

// Compile canary: tiny in-memory fixtures are compiled with the same options as
// tsconfig.test-support.json against the real Obsidian declarations. It proves
// the fake file shape is checked by the compiler: a valid use compiles clean,
// invalid fakes are rejected. No suppression comments are involved.

const root = process.cwd();
const FIXTURE_DIRECTORY = path.join(root, "tests", "__canary__");

function compilerOptions(): ts.CompilerOptions {
  const configPath = path.join(root, "tsconfig.test-support.json");
  const read = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  assert.equal(read.error, undefined, "tsconfig.test-support.json must be readable");
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
  assert.deepEqual(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")), []);
  return parsed.options;
}

function diagnose(name: string, source: string): string[] {
  const options = compilerOptions();
  const fixturePath = path.join(FIXTURE_DIRECTORY, name);
  const host = ts.createCompilerHost(options);
  const original = {
    fileExists: host.fileExists.bind(host),
    readFile: host.readFile.bind(host),
    getSourceFile: host.getSourceFile.bind(host),
  };
  host.fileExists = (file) => file === fixturePath || original.fileExists(file);
  host.readFile = (file) => (file === fixturePath ? source : original.readFile(file));
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) =>
    file === fixturePath
      ? ts.createSourceFile(file, source, languageVersion, true)
      : original.getSourceFile(file, languageVersion, onError, shouldCreate);
  const program = ts.createProgram({ rootNames: [fixturePath], options, host });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const where = diagnostic.file ? `${path.basename(diagnostic.file.fileName)}: ` : "";
    return `${where}TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}

const IMPORTS = [
  'import type { TFile as HostFile, TFolder as HostFolder } from "obsidian";',
  'import { TFile, TFolder } from "../support/obsidian-stub.ts";',
].join("\n");

test("a correctly shaped fake file and folder compile as the real host types", () => {
  const diagnostics = diagnose("valid.ts", `${IMPORTS}
export const file: HostFile = new TFile("Books/Book.md");
export const folder: HostFolder = new TFolder("Books");
export const stat: HostFile["stat"] = new TFile("Books/Book.md").stat;
`);
  assert.deepEqual(diagnostics, []);
});

test("a fake file constructed with the wrong arguments is rejected", () => {
  const diagnostics = diagnose("wrong-constructor.ts", `${IMPORTS}
export const file = new TFile();
export const other = new TFile(42);
`);
  assert.ok(diagnostics.some((line) => line.includes("TS2554")), diagnostics.join("\n"));
  assert.ok(diagnostics.some((line) => line.includes("TS2345")), diagnostics.join("\n"));
});

test("a fake file stat missing required host fields is rejected", () => {
  const diagnostics = diagnose("missing-stat.ts", `${IMPORTS}
export const stat: TFile["stat"] = { mtime: 1 };
export const host: HostFile["stat"] = { mtime: 1 };
`);
  assert.ok(diagnostics.filter((line) => line.includes("TS2739") && line.includes("ctime, size")).length >= 2, diagnostics.join("\n"));
});
