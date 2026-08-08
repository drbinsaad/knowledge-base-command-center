import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
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
  assert.match(readme, /direct BRAT install link/);
  assert.match(readme, /### Uninstall/);
  assert.match(readme, /Visual movement on iPhone/);
  assert.match(readme, /stable internal ID `ent-vault-command-center`/);
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

test("mobile flows keep primary actions visible and empty states actionable", async () => {
  const view = await readFile(path.join(root, "src/view.ts"), "utf8");
  const manager = await readFile(path.join(root, "src/index-manager.ts"), "utf8");
  const modals = await readFile(path.join(root, "src/modals.ts"), "utf8");
  const styles = await readFile(path.join(root, "styles.css"), "utf8");
  assert.match(view, /Add existing \$\{settings\.itemPlural\}/);
  assert.match(view, /ent-cc-history-action/);
  assert.match(manager, /Browse \$\{availableCount\} available/);
  assert.match(manager, /aria-selected/);
  assert.match(styles, /grid-template-columns: repeat\(3, max-content\) 44px/);
  assert.match(styles, /scroll-snap-type: x proximity/);
  assert.match(styles, /height: calc\(100dvh - 16px\)/);
  assert.match(styles, /ent-cc-manager-bulk-actions\.is-idle/);
  assert.match(modals, /visualViewport/);
  assert.match(modals, /calculateModalViewportLayout/);
  assert.match(styles, /ent-cc-knowledge-note-content/);
  assert.match(styles, /--ent-cc-modal-visual-height/);
  assert.match(view, /const backLabel = "Back to main page"/);
  assert.match(view, /"aria-label": backLabel, title: backLabel/);
  assert.match(view, /createSpan\(\{ text: backLabel \}\)/);
  assert.match(view, /aria-modal/);
  assert.match(view, /handleMobileInspectorKeydown/);
  assert.match(styles, /ent-cc-inspector\.is-mobile-open/);
  assert.match(styles, /ent-cc-shell\.is-inspector-route/);
  assert.match(styles, /min-width: 118px/);
  assert.match(styles, /\.ent-cc-subject-row \{\s*grid-template-columns: 44px minmax\(0, 1fr\) max-content 44px;\s*grid-template-rows: 44px/);
  assert.match(styles, /\.ent-cc-subject-row \.ent-cc-disclosure,\s*\.ent-cc-subject-row \.ent-cc-record-icon \{\s*grid-column: 1;\s*grid-row: 1/);
  assert.match(styles, /\.ent-cc-curriculum-row \.ent-cc-record-icon \{\s*display: none/);
  assert.match(styles, /\.ent-cc-view \.ent-cc-subject-row button\.ent-cc-subject-title \{\s*grid-row: 1;\s*min-height: 44px/);
  assert.match(styles, /\.ent-cc-subject-row \.ent-cc-row-badges \{\s*grid-column: 3;\s*grid-row: 1/);
  assert.match(styles, /\.ent-cc-subject-row \.ent-cc-row-more \{\s*display: inline-grid;\s*grid-column: 4;\s*grid-row: 1/);
  assert.match(styles, /calc\(112px \+ var\(--safe-area-inset-bottom, env\(safe-area-inset-bottom, 0px\)\)\)/);
  assert.match(styles, /overscroll-behavior-y: contain/);
  assert.match(view, /resetSearchScrollPosition/);
  assert.match(view, /Clear search/);
  assert.match(styles, /ent-cc-shell\.is-search-focused/);
  assert.match(styles, /font-size: 16px/);
});

test("runtime source satisfies blocking Obsidian review rules", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  const settings = await readFile(path.join(root, "src/settings.ts"), "utf8");
  const runtimeNames = (await readdir(path.join(root, "src"))).filter((name) => name.endsWith(".ts") && !name.startsWith("._"));
  const runtimeSources = await Promise.all(runtimeNames.map((name) => readFile(path.join(root, "src", name), "utf8")));
  const runtime = runtimeSources.join("\n");
  assert.doesNotMatch(main, /detachLeavesOfType\(VIEW_TYPE\)/);
  assert.doesNotMatch(settings, /setName\("Knowledge Base Command Center"\)\.setHeading\(\)/);
  assert.match(settings, /getSettingDefinitions\(\): SettingDefinitionItem\[\]/);
  assert.doesNotMatch(settings, /\bdisplay\(\): void/);
  assert.doesNotMatch(runtime, /\.flatMap\(/);
  assert.doesNotMatch(runtime, /\.setWarning\(/);
  assert.doesNotMatch(runtime, /\.setDynamicTooltip\(/);
});

test("review and release automation is reproducible and least-privilege", async () => {
  const packageJson = await readJson("package.json");
  const scripts = packageJson.scripts as Record<string, string>;
  for (const name of ["typecheck", "lint", "test", "verify-release", "verify-community", "review", "release:bundle"]) {
    assert.equal(typeof scripts[name], "string", `missing npm script ${name}`);
  }
  const workflows = await Promise.all(["ci.yml", "release.yml"].map((name) => readFile(path.join(root, ".github", "workflows", name), "utf8")));
  const workflow = workflows.join("\n");
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /--notes-file release-notes\.md/);
  assert.match(workflow, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /attest-build-provenance@[0-9a-f]{40}/);
});

test("public issue intake prevents accidental private-vault disclosure", async () => {
  const template = await readFile(path.join(root, ".github", "ISSUE_TEMPLATE", "bug_report.yml"), "utf8");
  assert.match(template, /Do not attach private notes/);
  assert.match(template, /patient information/);
  assert.match(template, /copyrighted source/);
});
