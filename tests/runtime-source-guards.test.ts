import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkRuntimeSources, discoverRuntimeSources, findCommandDefinitions } from "../scripts/runtime-source-guards.mjs";

type Sources = Array<[string, string]>;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = "extracted/probe.ts";

/** Appends a fixture at a NEW nested path and proves the source set really changed. */
function withProbe(base: Sources, code: string): Sources {
  assert.equal(base.some(([name]) => name === PROBE), false, "probe path must be new");
  const next: Sources = [...base, [PROBE, code]];
  assert.equal(next.length, base.length + 1);
  return next;
}

function replaceIn(base: Sources, file: string, from: string, to: string): Sources {
  let changed = false;
  const next = base.map(([name, content]): [string, string] => {
    if (name !== file) return [name, content];
    const updated = content.replace(from, to);
    changed = updated !== content;
    return [name, updated];
  });
  assert.ok(changed, `replacement must change ${file}`);
  return next;
}

let baseline: Sources;
test("baseline: the real discovered source passes every all-source guard", async () => {
  baseline = await discoverRuntimeSources(path.join(root, "src"));
  assert.ok(baseline.length > 10);
  assert.ok(baseline.some(([name]) => name === "library-cover.ts"));
  checkRuntimeSources(baseline);
});

const negatives: Array<[string, string, RegExp]> = [
  ["network: fetch call", 'export const a = () => fetch("https://example.invalid");', /network API/],
  ["network: named Obsidian request import", 'import { request } from "obsidian";\nexport const a = request;', /Obsidian network APIs/],
  ["network: namespace Obsidian import", 'import * as obs from "obsidian";\nexport const a = obs;', /named Obsidian imports/],
  ["execution: eval call", 'export const a = () => eval("1");', /dynamic code/],
  ["execution: Function constructor", 'export const a = () => new Function("return 1");', /dynamic code/],
  ["DOM: innerHTML assignment", 'export const a = (el: HTMLElement) => { el.innerHTML = "<b>x</b>"; };', /safe DOM/],
  ["DOM: insertAdjacentHTML", 'export const a = (el: HTMLElement) => { el.insertAdjacentHTML("beforeend", "x"); };', /safe DOM/],
  ["clipboard: readText", "export const a = () => navigator.clipboard.readText();", /write-only/],
  ["clipboard: second writer", 'export const a = (c: Clipboard) => c.writeText("x");', /exactly one clipboard writer/],
  ["runtime: node:fs import", 'import { readFileSync } from "node:fs";\nexport const a = readFileSync;', /Node or Electron/],
  ["runtime: require", 'export const a = require("x");', /Node or Electron/],
  ["runtime: process access", "export const a = process.env;", /Node or Electron/],
  ["runtime: structuredClone", "export const a = (v: unknown) => structuredClone(v);", /structuredClone/],
  ["runtime: flatMap", "export const a = (v: number[][]) => v.flatMap((x) => x);", /flatMap/],
  ["settings: deprecated setWarning", "export const a = (b: { setWarning(): void }) => b.setWarning();", /deprecated settings/],
  ["settings: deprecated setDynamicTooltip", "export const a = (b: { setDynamicTooltip(): void }) => b.setDynamicTooltip();", /deprecated settings/],
  ["settings: deprecated display method", "class T { display(): void {} }", /deprecated settings/],
  ["settings: redundant heading in extracted module", 'export const a = (s: any) => s.setName("Knowledge Base Command Center")\n  .setHeading();', /redundant product settings heading/],
  ["commands: inline prefixed id", 'export const a = (p: any) => p.addCommand({ id: "ent-vault-command-center-open", name: "Open", callback: () => {} });', /concise and unprefixed/],
  ["commands: inline id containing command", 'export const a = (p: any) => p.addCommand({ id: "run-command", name: "Run", callback: () => {} });', /concise and unprefixed/],
  ["commands: inline redundant name", 'export const a = (p: any) => p.addCommand({ id: "open", name: "Open command", callback: () => {} });', /redundant word command/],
  ["commands: returned Command[] prefixed id", 'export function f(): Command[] {\n  return [{ id: "ent-vault-command-center-x", name: "Open", callback: () => {} }];\n}', /concise and unprefixed/],
  ["commands: returned Command[] redundant name", 'export function f(): Command[] {\n  return [{ id: "open", name: "Open command", icon: "zap", checkCallback: () => true }];\n}', /redundant word command/],
  ["commands: unsupported addCommand argument form (audit boundary)", "export const a = (p: any, c: unknown) => p.addCommand(c);", /unsupported addCommand/],
  ["commands: Command[] factory with unrecognizable definitions", "export function f(): Command[] {\n  return build();\n}", /no command-shaped definitions/],
  ["unload: detach in a new helper module", "export const a = (ws: any) => ws.detachLeavesOfType(VIEW_TYPE);", /must not be detached/],
  ["unload: whitespace-split detach", "export const a = (ws: any) => ws.detachLeavesOfType (\n  VIEW_TYPE\n);", /must not be detached/],
  ["images: second createEl img", 'export const a = (el: HTMLElement) => el.createEl("img");', /library-cover\.ts/],
  ["images: direct .src assignment", 'export const a = (i: HTMLImageElement) => { i.src = "x"; };', /expected to not match[\s\S]*\\\.src/],
  ["images: extra src attribute writer", 'export const a = (e: HTMLElement) => e.setAttribute("src", "x");', /2 !== 1/],
  ["images: external-image switch", "export const allowExternal = true;", /expected to not match[\s\S]*allowExternal/],
];

for (const [label, code, reason] of negatives) {
  test(`negative: ${label} fails in a new nested module`, async () => {
    const base = baseline ?? await discoverRuntimeSources(path.join(root, "src"));
    assert.throws(() => checkRuntimeSources(withProbe(base, code)), reason);
  });
}

const reviewNegatives: Array<[string, (base: Sources) => Sources, RegExp]> = [
  ["dynamic-name library registration with a forbidden literal id", (base) => replaceIn(base, "main.ts", "        id: commandId,\n        name: `Open Library: ${libraryName}`,", '        id: "ent-vault-command-center-bad",\n        name: `Open Library: ${libraryName}`,'), /concise and unprefixed/],
  ["real open-workspace name containing {command}", (base) => replaceIn(base, "main.ts", 'name: "Open main page"', 'name: "Open {command}"'), /redundant word command/],
  ["apostrophe and braces in a literal command name", (base) => withProbe(base, `export const a = (p: any) => p.addCommand({ id: "ok", name: "Don't {use} the command", callback: () => {} });`), /redundant word command/],
  ["escaped quotes and braces in a literal command name", (base) => withProbe(base, 'export const a = (p: any) => p.addCommand({ id: "ok", name: "Say \\"{hi}\\" command", callback: () => {} });'), /redundant word command/],
  ["request alias with a brace-containing comment", (base) => withProbe(base, 'import { request as send, /* { rationale } */ Notice } from "obsidian";\nexport const sendLocal = send;'), /Obsidian network APIs/],
  ["request alias in a multiline import with line comments", (base) => withProbe(base, 'import {\n  Notice, // keep\n  request as send, // network\n} from "obsidian";\nexport const s = send;'), /Obsidian network APIs/],
];

for (const [label, mutate, reason] of reviewNegatives) {
  test(`negative (review): ${label}`, async () => {
    const base = baseline ?? await discoverRuntimeSources(path.join(root, "src"));
    assert.throws(() => checkRuntimeSources(mutate(base)), reason);
  });
}

const reviewPositives: Array<[string, string]> = [
  ["safe title with braces and quotes", `export const a = (p: any) => p.addCommand({ id: "ok", name: "Don't {use} \\"this\\"", callback: () => {} });`],
  ["safe Obsidian imports with a brace comment", 'import { Notice, /* { why } */ Modal } from "obsidian";\nexport const k = [Notice, Modal];'],
  ["commented-out forbidden command", '// addCommand({ id: "x-command", name: "command", callback: 1 })\nexport const z = 1;'],
];

for (const [label, code] of reviewPositives) {
  test(`positive (review): ${label}`, async () => {
    const base = baseline ?? await discoverRuntimeSources(path.join(root, "src"));
    checkRuntimeSources(withProbe(base, code));
  });
}

test("negative: removing the sole clipboard writer fails", async () => {
  const base = baseline ?? await discoverRuntimeSources(path.join(root, "src"));
  assert.throws(() => checkRuntimeSources(replaceIn(base, "view.ts", "clipboard.writeText(text)", "clipboard.copy(text)")), /exactly one clipboard writer/);
});

test("negative: dropping the settings entry point fails", async () => {
  const base = baseline ?? await discoverRuntimeSources(path.join(root, "src"));
  assert.throws(() => checkRuntimeSources(replaceIn(base, "settings.ts", "getSettingDefinitions(): SettingDefinitionItem[]", "getSettings(): SettingDefinitionItem[]")), /getSettingDefinitions entry point/);
  assert.throws(() => checkRuntimeSources(base.filter(([name]) => name !== "settings.ts")), /getSettingDefinitions entry point/);
});

test("negative: empty discovery fails closed", () => {
  assert.throws(() => checkRuntimeSources([]), /no files/);
});

test("positive controls: safe helpers, factory commands and label-only objects pass", async () => {
  const base = baseline ?? await discoverRuntimeSources(path.join(root, "src"));
  checkRuntimeSources(withProbe(base, 'export const helper = (el: HTMLElement) => { el.createEl("p", { text: "ok" }); return [1, 2].map((n) => n + 1); };'));
  checkRuntimeSources(withProbe(base, 'export const labels = { id: "a", name: "Command palette label" };'));
  checkRuntimeSources(withProbe(base, 'export function g(): Command[] {\n  return [{ id: "ok-one", name: "Fine", callback: () => {} }];\n}'));
  const factory = base.find(([name]) => name === "quick-entry.ts")?.[1] ?? "";
  const found = findCommandDefinitions(factory);
  assert.ok(found.length >= 8, `quick-entry factory commands must be recognized, found ${found.length}`);
  assert.ok(found.some((command) => command.id === "quick-entry"));
  assert.equal(findCommandDefinitions('const x = { id: "a", name: "Command label" };').length, 0);
});

test("discovery includes nested files, ignores AppleDouble entries, and the nested file is then guarded", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kbcc-guard-"));
  try {
    await mkdir(path.join(dir, "extracted"));
    await writeFile(path.join(dir, "top.ts"), "export const top = 1;\n");
    await writeFile(path.join(dir, "._top.ts"), "fetch('ignored');\n");
    await writeFile(path.join(dir, "extracted", "probe.ts"), "export const safe = 1;\n");
    await writeFile(path.join(dir, "extracted", "._probe.ts"), "fetch('ignored');\n");
    await writeFile(path.join(dir, "extracted", "notes.md"), "fetch\n");
    const found = await discoverRuntimeSources(dir);
    assert.deepEqual(found.map(([name]) => name), ["extracted/probe.ts", "top.ts"]);
    await writeFile(path.join(dir, "extracted", "probe.ts"), 'export const bad = () => fetch("x");\n');
    const after = await discoverRuntimeSources(dir);
    assert.match(after.find(([name]) => name === PROBE)?.[1] ?? "", /fetch/);
    const real = await discoverRuntimeSources(path.join(root, "src"));
    assert.throws(() => checkRuntimeSources([...real, ...after.filter(([name]) => name === PROBE)]), /network API/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
