import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (name: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path.join(root, name), "utf8")) as Record<string, unknown>;

test("release metadata is internally consistent and mobile-compatible", async () => {
  const manifest = await readJson("manifest.json");
  const packageJson = await readJson("package.json");
  const versions = await readJson("versions.json");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(versions[String(manifest.version)], manifest.minAppVersion);
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(manifest.id, "ent-vault-command-center");
  assert.equal(packageJson.license, "MIT");
});

test("public repository metadata is present", async () => {
  const license = await readFile(path.join(root, "LICENSE"), "utf8");
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.match(license, /MIT License/);
  assert.match(readme, /Privacy and permissions/);
  assert.match(readme, /enumerates Markdown file paths/);
  assert.match(readme, /never reads clipboard contents/);
});

test("manual release surface contains exactly the required nonempty assets", async () => {
  for (const asset of ["main.js", "manifest.json", "styles.css"]) {
    const info = await stat(path.join(root, asset));
    assert.equal(info.isFile(), true);
    assert.ok(info.size > 0, `${asset} should not be empty`);
  }
});

test("release assets do not embed a local absolute workspace path", async () => {
  for (const asset of ["main.js", "manifest.json", "styles.css"]) {
    const content = await readFile(path.join(root, asset), "utf8");
    assert.doesNotMatch(content, /(?:\/Users\/|\/Volumes\/|(?:^|[\s"'(])[A-Za-z]:[\\/])/m);
  }
});

test("runtime source satisfies blocking Obsidian review rules", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  const settings = await readFile(path.join(root, "src/settings.ts"), "utf8");
  const runtimeSources = await Promise.all(["main.ts", "modals.ts", "model.ts", "settings.ts", "view.ts"].map((name) => readFile(path.join(root, "src", name), "utf8")));
  const runtime = runtimeSources.join("\n");
  assert.doesNotMatch(main, /detachLeavesOfType\(VIEW_TYPE\)/);
  assert.doesNotMatch(settings, /setName\("Knowledge Base Command Center"\)\.setHeading\(\)/);
  assert.match(settings, /getSettingDefinitions\(\): SettingDefinitionItem\[\]/);
  assert.doesNotMatch(settings, /\bdisplay\(\): void/);
  assert.doesNotMatch(runtime, /\.flatMap\(/);
  assert.doesNotMatch(runtime, /\.setWarning\(/);
  assert.doesNotMatch(runtime, /\.setDynamicTooltip\(/);
});
