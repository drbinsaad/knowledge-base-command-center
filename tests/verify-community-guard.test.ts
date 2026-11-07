import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkJsonExportRoutes } from "../scripts/json-export-routes.mjs";

type Sources = Array<[string, string]>;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");

async function realSources(directory = sourceRoot): Promise<Sources> {
  const out: Sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await realSources(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push([path.relative(sourceRoot, absolute), await readFile(absolute, "utf8")]);
  }
  return out;
}

function mutate(sources: Sources, name: string, from: string | RegExp, to: string): Sources {
  let hit = false;
  const next = sources.map(([file, content]): [string, string] => {
    if (file !== name) return [file, content];
    const changed = content.replace(from, to);
    hit = changed !== content;
    return [file, changed];
  });
  assert.ok(hit, `mutation must change ${name} (otherwise the test would be vacuous)`);
  return next;
}

test("the real source passes the JSON export route guard", async () => {
  const sources = await realSources();
  assert.ok(sources.length > 10);
  checkJsonExportRoutes(sources);
});

test("removing the recovery-backup route fails the guard", async () => {
  const sources = await realSources();
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "sync-recovery-modal.ts", /new ExportImportCenterModal\(this\.plugin, "export", undefined, "backup"\)/, 'new ExportImportCenterModal(this.plugin, "export")')), /Sync recovery modal/);
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "portability-modal.ts", /if \(purpose === "backup"\) this\.exportSelection\.recovery = true;/, "")), /recovery export/);
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "main.ts", /await this\.writePortableJson\("backup", recovery\.package\)/, "await this.writePortableJson(\"conflict\", recovery.package)")), /automatic recovery/);
});

test("a direct vault JSON write that bypasses the helper fails the guard", async () => {
  const sources = await realSources();
  const bypass = 'async leak(value: unknown) { await this.plugin.app.vault.create("export.json", JSON.stringify(value)); }';
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "portfolio-modal.ts", "export class", `${bypass}\nexport class`)), /directly/);
  const adapter = 'void this.app.vault.adapter.write("export.json", "{}");';
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "view.ts", /^/, `${adapter}\n`)), /directly/);
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "view.ts", /^/, "void this.plugin.writePortableJson(\"portable\", {});\n")), /only through deliverJsonExport/);
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "modals.ts", "file: await plugin.writePortableJson(kind, value)", "file: await plugin.app.vault.create(\"x.json\", \"{}\")")), /mobile branch/);
});

test("moved or renamed export code that no longer reaches the helper fails the guard", async () => {
  const sources = await realSources();
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "modals.ts", "export async function deliverJsonExport(", "export async function deliverJsonExportRenamed(")), /deliverJsonExport must exist/);
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "portability-modal.ts", "await deliverJsonExport(", "await somethingElse(")), /portable package/);
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "portfolio-modal.ts", "await deliverJsonExport(", "await somethingElse(")), /portfolio export/);
  assert.throws(() => checkJsonExportRoutes(sources.filter(([name]) => name !== "sync-recovery-modal.ts")), /sync-recovery-modal\.ts is required/);
  assert.throws(() => checkJsonExportRoutes(mutate(sources, "view.ts", /^/, "await deliverJsonExport(this.plugin, \"portable\", \"x\", {});\n")), /only from the audited export modals/);
});
