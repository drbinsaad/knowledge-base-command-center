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
  assert.equal(versions["0.8.1"], undefined, "the unreleased 0.8.1 must not be advertised as an installable version");
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(manifest.id, "ent-vault-command-center");
  assert.equal(packageJson.license, "MIT");
});

test("the manifest release has curated one-time news and an exact immutable GitHub tag link", async () => {
  const manifest = await readJson("manifest.json");
  const version = String(manifest.version);
  const announcement = await readFile(path.join(root, "src", "update-announcement.ts"), "utf8");
  const main = await readFile(path.join(root, "src", "main.ts"), "utf8");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const exactUrl = `https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/${version}`;
  const escapedUrl = exactUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  assert.match(
    announcement,
    new RegExp(`version:\\s*"${escapedVersion}"[\\s\\S]*?releaseUrl:\\s*"${escapedUrl}"`, "u"),
    "every published manifest version must carry curated news linked to its exact immutable release tag",
  );
  assert.match(main, /id: "open-whats-new"/u);
  assert.match(main, /maybeShowUpdateAnnouncement\(initialLoad\)/u);
  assert.doesNotMatch(announcement, /\b(?:fetch|XMLHttpRequest|WebSocket|requestUrl|sendBeacon)\b/u);
});

test("public repository metadata is present", async () => {
  const manifest = await readJson("manifest.json");
  const license = await readFile(path.join(root, "LICENSE"), "utf8");
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
  const iphoneChecklist = await readFile(path.join(root, "docs", "manual-iphone-release-checklist.md"), "utf8");
  const userGuide = await readFile(path.join(root, "docs", "USER_GUIDE.md"), "utf8");
  const packageJson = await readFile(path.join(root, "package.json"), "utf8");
  assert.match(license, /MIT License/);
  assert.match(readme, /Privacy and permissions/);
  assert.match(readme, /enumerates whole-vault Markdown file paths/);
  assert.match(readme, /enumerates all loaded vault entries before retaining folder paths/);
  assert.match(readme, /enumerates all vault file paths before retaining JSON packages/);
  assert.match(readme, /never reads clipboard contents/);
  assert.match(readme, /direct BRAT install link/);
  assert.match(readme, /### Updating on iPhone and iPad/);
  assert.match(readme, /### Uninstall/);
  assert.match(readme, /Visual movement on iPhone/);
  assert.match(readme, /## Backup and recovery/);
  assert.match(readme, /## Known limitations/);
  assert.match(readme, /every available, non-archived knowledge base/);
  assert.match(readme, /Showing the first 300 of _N_ results/);
  assert.match(readme, /Two additional ENT-only workflows can change selected files/);
  assert.match(readme, /Quick append is a deliberate generic exception/);
  assert.match(readme, /stable internal ID `ent-vault-command-center`/);
  assert.match(readme, /Portable packages created by version .* use format version 4/i);
  assert.match(readme, /Current v9 (?:snapshots|files)/i);
  assert.match(readme, /obsidian:\/\/kbcc-quick-entry/);
  assert.match(readme, /obsidian:\/\/kbcc-create-subject/);
  assert.match(readme, /obsidian:\/\/kbcc-create-heading/);
  assert.match(readme, /obsidian:\/\/kbcc-create-subheading/);
  assert.match(readme, /obsidian:\/\/kbcc-create-note/);
  assert.match(readme, /obsidian:\/\/kbcc-add-current-note/);
  assert.match(readme, /obsidian:\/\/kbcc-add-existing-note/);
  assert.match(readme, /obsidian:\/\/kbcc-quick-append-current/);
  assert.match(readme, /obsidian:\/\/kbcc-quick-append-existing/);
  assert.match(readme, /obsidian:\/\/kbcc-attach-current/);
  assert.match(readme, /Quick append follow-up notes/);
  assert.match(readme, /Settings → Mobile → Manage toolbar options/);
  const latestChangelogVersion = /^##\s+(\d+\.\d+\.\d+)\s*$/m.exec(changelog)?.[1];
  assert.equal(latestChangelogVersion, manifest.version, "the first changelog release must match the release manifest");
  assert.match(changelog, /Version 0\.8\.1 was not published as a tag or GitHub release/);
  assert.doesNotMatch(changelog, /^## 0\.8\.1$/m);
  assert.match(iphoneChecklist, /physical iPhone/);
  assert.match(iphoneChecklist, /no more than 300 result rows are rendered/);
  assert.match(iphoneChecklist, /grouped by knowledge base and then library section/);
  assert.match(iphoneChecklist, /Taxonomy health center/);
  assert.match(iphoneChecklist, /Manage categories/);
  assert.match(iphoneChecklist, /Turn on VoiceOver/);
  assert.match(iphoneChecklist, /What’s new/);
  assert.match(iphoneChecklist, /releases\/tag\/0\.12\.0/);
  const commandAppendix = userGuide.slice(userGuide.indexOf("\n## Commands\n"), userGuide.indexOf("\n## Safety boundary\n"));
  for (const command of [
    "Quick append: Add to current note…",
    "Quick append: Choose a note…",
    "Quick append: Undo last append",
  ]) assert.match(commandAppendix, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.match(userGuide, /Any focused Quick Entry or Quick Append command/);
  assert.match(userGuide, /Open Library: _Library name_/);
  assert.match(packageJson, /tests\/follow-up\.test\.ts/);
  assert.match(packageJson, /tests\/update-announcement\.test\.ts/);
});

test("manual release surface contains the three required nonempty assets", async () => {
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
  const followUpModal = await readFile(path.join(root, "src/follow-up-modal.ts"), "utf8");
  const libraryModal = await readFile(path.join(root, "src/library-modal.ts"), "utf8");
  const styles = await readFile(path.join(root, "styles.css"), "utf8");
  assert.match(view, /Add existing \$\{settings\.itemPlural\}/);
  assert.match(view, /ent-cc-history-action/);
  assert.match(manager, /Browse \$\{availableCount\} available/);
  assert.match(manager, /aria-selected/);
  assert.match(styles, /grid-auto-flow: column/);
  assert.match(styles, /\.ent-cc-header-actions\s*\{[^}]*overflow-x: auto/s);
  assert.match(styles, /\.ent-cc-quick-entry-button\s*\{[^}]*min-width: 44px/s);
  assert.match(styles, /scroll-snap-type: x proximity/);
  assert.match(styles, /height: calc\(100dvh - 16px\)/);
  assert.match(styles, /ent-cc-manager-bulk-actions\.is-idle/);
  assert.match(modals, /visualViewport/);
  assert.match(modals, /calculateModalViewportLayout/);
  assert.match(libraryModal, /Manage libraries/);
  assert.match(libraryModal, /Archive this library before permanently deleting it|Delete library/);
  assert.match(libraryModal, /setDestructive\(\)/);
  assert.match(styles, /ent-cc-library-manager-action/);
  assert.match(styles, /ent-cc-knowledge-note-content/);
  assert.match(styles, /--ent-cc-modal-visual-height/);
  assert.match(styles, /\.ent-cc-knowledge-note-modal > \.modal-content\.ent-cc-knowledge-note-content\s*\{[^}]*flex: 1 1 0;[^}]*height: 0;/s);
  assert.match(styles, /scroll-padding-block: 12px 88px/);
  assert.match(modals, /handleViewportFocus/);
  assert.match(modals, /\[0, 60, 180, 420\]/);
  assert.match(modals, /--keyboard-height/);
  assert.match(followUpModal, /calculateModalViewportLayout/);
  assert.match(followUpModal, /--keyboard-height/);
  assert.match(followUpModal, /\[0, 60, 180, 420\]/);
  assert.match(followUpModal, /ent-cc-modal-footer/);
  assert.match(styles, /\.ent-cc-follow-up-modal textarea\s*\{[^}]*width: 100%;/s);
  assert.match(styles, /\.ent-cc-follow-up-category-manager/);
  assert.match(modals, /setName\(this\.options\.placeholder\)/);
  assert.match(modals, /setAttribute\("aria-label", this\.options\.placeholder\)/);
  assert.match(modals, /ent-cc-action-suggestion-title[\s\S]*?attr: \{ dir: "auto" \}/);
  assert.match(modals, /ent-cc-action-suggestion-description[\s\S]*?attr: \{ dir: "auto" \}/);
  assert.match(styles, /\.ent-cc-action-suggestion-description\s*\{[^}]*font-size:\s*var\(--font-ui-small\);[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s);
  assert.doesNotMatch(styles, /\.ent-cc-action-suggestion-description\s*\{[^}]*(?:font-size:\s*10px|text-overflow:\s*ellipsis|white-space:\s*nowrap)/s);
  assert.match(styles, /\.ent-cc-catalog-context\s*\{[^}]*border-inline-start:/s);
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
  assert.match(view, /calculateSearchViewportLayout/);
  assert.match(view, /matchingKnowledgeBaseRecords/);
  assert.match(view, /visualViewport/);
  assert.match(view, /Clear search/);
  assert.match(styles, /ent-cc-shell\.is-search-focused/);
  assert.match(styles, /--ent-cc-search-visual-height/);
  for (const selector of [
    ".ent-cc-view .ent-cc-subject-row button.ent-cc-subject-title {",
    ".ent-cc-shell.is-search-focused {",
  ]) {
    const selectorIndex = styles.indexOf(selector);
    assert.notEqual(selectorIndex, -1, `missing responsive selector: ${selector}`);
    const mediaIndex = styles.lastIndexOf("@media", selectorIndex);
    assert.equal(
      styles.slice(mediaIndex, mediaIndex + "@media (max-width: 1024px)".length),
      "@media (max-width: 1024px)",
      `${selector} must remain active at modern iPhone landscape widths`,
    );
  }
  assert.match(styles, /\.ent-cc-search-box input \{\s*height: 44px;[\s\S]*?font-size: 16px;/);
  assert.match(styles, /translate: 0 var\(--ent-cc-search-visual-shift, 0px\)/);
  assert.match(styles, /min-height: max\(100%, 180px\)/);
  assert.match(styles, /overflow-anchor: none/);
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
  const buildIndex = scripts.review.indexOf("npm run build");
  const communityIndex = scripts.review.indexOf("npm run verify-community");
  assert.notEqual(buildIndex, -1, "review must build main.js");
  assert.notEqual(communityIndex, -1, "review must run Community verification");
  assert.ok(buildIndex < communityIndex, "review must build main.js before Community verification scans it");
  const communityVerifier = await readFile(path.join(root, "scripts", "verify-community.mjs"), "utf8");
  assert.match(communityVerifier, /readFile\(path\.join\(root, "main\.js"\)/);
  assert.match(communityVerifier, /built main\.js must not require external module/);
  const [ciWorkflow, releaseWorkflow] = await Promise.all(["ci.yml", "release.yml"].map((name) => readFile(path.join(root, ".github", "workflows", name), "utf8")));
  const workflow = `${ciWorkflow}\n${releaseWorkflow}`;
  const actionReferences = [...workflow.matchAll(/^[ \t]*uses:[ \t]*([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(actionReferences.length > 0, "workflows must contain pinned actions");
  for (const reference of actionReferences) assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/, `action must use a full commit SHA: ${reference}`);
  assert.equal((ciWorkflow.match(/^permissions:/gm) ?? []).length, 1);
  assert.equal((ciWorkflow.match(/^[ \t]+permissions:/gm) ?? []).length, 0);
  assert.match(ciWorkflow, /^permissions:\n {2}contents: read\n\njobs:/m);
  assert.equal((releaseWorkflow.match(/^permissions:/gm) ?? []).length, 0);
  assert.deepEqual(releaseWorkflow.match(/^ {4}permissions:\n(?:^ {6}[\w-]+: (?:read|write)\n)+/gm), [
    "    permissions:\n      contents: read\n",
    "    permissions:\n      contents: write\n      id-token: write\n      attestations: write\n",
  ]);
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

test("mobile-affecting pull requests require a physical-iPhone sign-off", async () => {
  const template = await readFile(path.join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "utf8");
  assert.match(template, /physical-iPhone release checklist/);
  assert.match(template, /Checklist result and tester/);
  assert.match(template, /Device \/ iOS \/ Obsidian versions/);
  assert.match(template, /Evidence or follow-up issue link/);
});
