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
  const currentIphoneEvidence = await readFile(
    path.join(root, "docs", "release-evidence", `${String(manifest.version)}-iphone.md`),
    "utf8",
  );
  const released017IphoneEvidence = await readFile(
    path.join(root, "docs", "release-evidence", "0.17.0-iphone.md"),
    "utf8",
  );
  const userGuide = await readFile(path.join(root, "docs", "USER_GUIDE.md"), "utf8");
  const security = await readFile(path.join(root, "SECURITY.md"), "utf8");
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
  // The README must state the versions the code actually writes, so a format
  // bump cannot silently leave the public documentation behind.
  const portability = await readFile(path.join(root, "src", "portability.ts"), "utf8");
  const portableVersion = /export const PORTABLE_EXPORT_VERSION = (\d+) as const/u.exec(portability)?.[1];
  assert.ok(portableVersion, "src/portability.ts must declare PORTABLE_EXPORT_VERSION");
  const model = await readFile(path.join(root, "src", "model.ts"), "utf8");
  const backupVersion = /export interface PersonalBackup extends PersonalOrganizationState \{[\s\S]*?\n {2}version: (\d+);/u.exec(model)?.[1];
  const dataVersion = /export const DATA_VERSION = (\d+);/u.exec(model)?.[1];
  const storeVersion = /export const STORE_VERSION = (\d+);/u.exec(model)?.[1];
  const deviceLocalVersion = /export const DEVICE_LOCAL_STATE_VERSION = (\d+);/u.exec(model)?.[1];
  assert.ok(backupVersion, "src/model.ts must declare the PersonalBackup version");
  assert.ok(dataVersion, "src/model.ts must declare DATA_VERSION");
  assert.ok(storeVersion, "src/model.ts must declare STORE_VERSION");
  assert.ok(deviceLocalVersion, "src/model.ts must declare DEVICE_LOCAL_STATE_VERSION");
  const recoveryGuide = await readFile(path.join(root, "docs", "PORTABILITY_AND_RECOVERY.md"), "utf8");
  const gettingStarted = await readFile(path.join(root, "docs", "GETTING_STARTED.md"), "utf8");
  const troubleshooting = await readFile(path.join(root, "docs", "TROUBLESHOOTING.md"), "utf8");
  for (const localDataGuide of [readme, gettingStarted, troubleshooting, userGuide]) {
    assert.match(localDataGuide, /rename-recovery journal/iu);
    assert.match(localDataGuide, /vault identity[^.]*old\/new vault-relative paths/iu);
    assert.match(localDataGuide, /return-navigation history/iu);
    assert.match(localDataGuide, /up to 24 opened-note paths/iu);
    assert.match(localDataGuide, /literal search text/iu);
    assert.match(localDataGuide, /search text can itself be sensitive/iu);
    assert.match(localDataGuide, /all four plugin-owned App-local values/iu);
  }
  assert.match(security, /bounded vault-scoped rename-recovery journal/iu);
  assert.match(security, /vault identity plus the old and new vault-relative paths/iu);
  assert.match(security, /return-navigation history/iu);
  assert.match(security, /up to 24 opened-note paths/iu);
  assert.match(security, /literal search text/iu);
  assert.match(security, /search text can itself be sensitive/iu);
  assert.match(security, /all four plugin-owned App-local values/iu);
  assert.match(readme, new RegExp(`Portable packages created by version .* use format version ${portableVersion}`, "iu"));
  assert.match(readme, new RegExp(`Current v${backupVersion} (?:snapshots|files)`, "iu"));
  assert.match(recoveryGuide, new RegExp(`Current version-${backupVersion} recovery files`, "iu"));
  assert.match(recoveryGuide, new RegExp(`\\*\\*Version ${backupVersion}:\\*\\* current format`, "iu"));
  assert.match(gettingStarted, new RegExp(`version-${storeVersion} store and schema-${dataVersion} knowledge-base data`, "iu"));
  assert.match(recoveryGuide, new RegExp(`version-${storeVersion} store with version-${dataVersion} knowledge-base data`, "iu"));
  assert.match(troubleshooting, new RegExp(`version-${storeVersion} store with schema-${dataVersion} knowledge-base data`, "iu"));
  assert.match(userGuide, new RegExp(`version-${deviceLocalVersion} device-local pending-Undo journal`, "iu"));
  assert.match(recoveryGuide, new RegExp(`version-${deviceLocalVersion} device-local pending-Undo journal`, "iu"));
  assert.match(userGuide, /pending Undo\/Redo transition journal/iu);
  assert.match(recoveryGuide, /pending Undo\/Redo transition journal/iu);
  assert.match(userGuide, /multi-base portfolio import stages[^.]*required Undo[^.]*one bounded causal batch/iu);
  assert.match(recoveryGuide, /all destination snapshots[^.]*one bounded pending-Undo batch/iu);
  assert.match(userGuide, /Global Note Organizer Apply[^.]*other multi-base author[^.]*same mechanism/iu);
  assert.match(recoveryGuide, /Global Note Organizer Apply[^.]*other author[^.]*multi-base form[^.]*same mechanism/iu);
  assert.match(recoveryGuide, /exact protected batch cannot fit[^.]*4 MiB[^.]*rejected[^.]*before any primary store mutation/iu);
  for (const organizerCommand of [
    "Organize vault notes across knowledge bases…",
    "Organize current note across knowledge bases…",
    "Show current note’s knowledge-base memberships",
    "Note organizer: Undo last multi-base change",
    "Note organizer: Redo last multi-base change",
  ]) {
    assert.match(userGuide, new RegExp(`^- ${organizerCommand.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"),
      `the commands appendix must include ${organizerCommand}`);
  }
  const currentChangelogStart = changelog.indexOf(`## ${String(manifest.version)}`);
  assert.notEqual(currentChangelogStart, -1, "the current release must have a changelog section");
  const nextChangelogStart = changelog.indexOf("\n## ", currentChangelogStart + 1);
  const currentChangelog = changelog.slice(currentChangelogStart, nextChangelogStart < 0 ? undefined : nextChangelogStart);
  assert.match(currentChangelog, /false \*\*No linked note\*\* placeholders/iu);
  assert.match(currentChangelog, /workspace layout ready/iu);
  assert.match(currentChangelog, /initial metadata scan finishes/iu);
  assert.match(currentChangelog, /does not change synced KBCC organization/iu);
  assert.match(currentChangelog, /configured per device/iu);
  const released019Start = changelog.indexOf("## 0.19.0");
  assert.notEqual(released019Start, -1, "the published 0.19.0 release record must remain in the changelog");
  const released019End = changelog.indexOf("\n## ", released019Start + 1);
  const released019Changelog = changelog.slice(released019Start, released019End < 0 ? undefined : released019End);
  assert.match(released019Changelog, /Create note here/iu);
  assert.match(released019Changelog, /Return to KBCC/iu);
  assert.match(released019Changelog, /survives Obsidian restarts/iu);
  assert.match(released019Changelog, /at most 24 vault-scoped note routes[^.]*256 KiB/iu);
  const released018Start = changelog.indexOf("## 0.18.0");
  assert.notEqual(released018Start, -1, "the published 0.18.0 release record must remain in the changelog");
  const released018End = changelog.indexOf("\n## ", released018Start + 1);
  const released018Changelog = changelog.slice(released018Start, released018End < 0 ? undefined : released018End);
  assert.match(released018Changelog, new RegExp(`version-${deviceLocalVersion} device-local journals`, "iu"));
  assert.match(released018Changelog, /user-invoked Undo\/Redo restart-durable/iu);
  assert.match(released018Changelog, /multi-base portfolio import stages every destination's required Undo[^.]*one causally verified batch/iu);
  const released017Start = changelog.indexOf("## 0.17.0");
  assert.notEqual(released017Start, -1, "the published 0.17.0 release record must remain in the changelog");
  const released017End = changelog.indexOf("\n## ", released017Start + 1);
  const released017Changelog = changelog.slice(released017Start, released017End < 0 ? undefined : released017End);
  assert.match(released017Changelog, /500,000-record performance budget, seven real-Chromium row-layout variants/iu);
  assert.doesNotMatch(released017Changelog, /Organizer (?:performance )?budget/iu);
  assert.match(readme, /at most 5,000 selected Markdown notes[^.]*20,000 effective note\/base destinations/iu);
  assert.match(userGuide, /up to 5,000 selected Markdown notes[^.]*one review/iu);
  assert.match(userGuide, /at most 20,000 effective note\/base directives/iu);
  assert.match(readme, /aggregate required-Undo snapshots[\s\S]{0,220}4 MiB[\s\S]{0,220}rejected before any primary plugin-store mutation/iu);
  assert.match(userGuide, /aggregate snapshots[^.]*4 MiB[^.]*whole Apply is refused/iu);
  assert.match(readme, /vault-qualified `obsidian:\/\/open`[^.]*including one naming the current vault/iu);
  assert.match(userGuide, /vault-qualified `obsidian:\/\/open` URI is rejected[^.]*current vault/iu);
  assert.match(readme, /every eligible Markdown note in the vault[^.]*including unindexed notes and notes outside/iu);
  assert.match(recoveryGuide, /counts placeholders with at least one candidate, not the raw number of candidate notes/iu);
  assert.match(recoveryGuide, /Import Workspace settings alone first[^.]*refresh the vault[^.]*import the subject-catalog sections/iu);
  assert.match(troubleshooting, /previously linked Markdown file[^.]*temporarily missing[\s\S]*retains the prior path binding/iu);
  assert.match(readme, /known-good previous committed authority[\s\S]*post-commit backup failure[\s\S]{0,220}one commit behind/iu);
  assert.match(recoveryGuide, /prerequisite write[^.]*Sync-generation fence fails, no primary or compensating write is attempted/iu);
  assert.doesNotMatch(readme, /Every save maintains a parseable twin of the last successfully committed `data\.json`/u);
  assert.doesNotMatch(recoveryGuide, /safety twin of the last successfully committed plugin state/iu);
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
  assert.match(readme, /Return to KBCC[^.]*beside/iu);
  assert.match(readme, /Create note here/iu);
  assert.match(userGuide, /Return to KBCC/iu);
  assert.match(userGuide, /path-bound destination survives Obsidian restarts/iu);
  assert.match(userGuide, /browse-row and structural-section limits are each capped at 10,000/iu);
  assert.match(userGuide, /Create note here/iu);
  assert.match(userGuide, /immediately before Markdown creation/iu);
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
  assert.match(iphoneChecklist, /0\.18\.0 Global Note Organizer additions/);
  assert.match(iphoneChecklist, /0\.19\.0 in-place creation and return-navigation additions/iu);
  assert.match(iphoneChecklist, /Unverified — not executed on a physical iPhone/);
  assert.match(iphoneChecklist, /Notes → Destinations → Review using touch only/);
  assert.match(iphoneChecklist, /5,001-note selection[^.]*more than 20,000 effective note\/base directives/iu);
  assert.match(iphoneChecklist, /aggregate required-Undo snapshots exceed[^.]*4 MiB/iu);
  assert.match(iphoneChecklist, /Create note here/iu);
  assert.match(iphoneChecklist, /Return to KBCC/iu);
  assert.match(iphoneChecklist, /Obsidian restart/iu);
  const escapedManifestVersion = String(manifest.version).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  assert.match(iphoneChecklist, new RegExp(`releases/tag/${escapedManifestVersion}`, "u"));
  assert.match(currentIphoneEvidence, new RegExp(`Candidate version:\\s*${escapedManifestVersion}`, "u"));
  assert.doesNotMatch(currentIphoneEvidence, /\bPending\b/iu);
  assert.doesNotMatch(
    currentIphoneEvidence,
    /FINAL_LOCAL_[A-Z0-9_]+/u,
    "candidate evidence must contain exact final local results before release",
  );
  assert.doesNotMatch(
    currentIphoneEvidence,
    /(?:_Record\b|complete before tag|must be replaced with the clean Node 22 gate facts)/iu,
    "candidate evidence must not retain prose staging placeholders before release",
  );
  assert.match(released017IphoneEvidence, /maintainer-authorized waiver/iu);
  assert.match(released017IphoneEvidence, /physical-iPhone matrix not executed/iu);
  assert.doesNotMatch(released017IphoneEvidence, /^\s*-?\s*(?:Status|Final result):\s*\*\*?Pass\b/imu);
  const explicitPhysicalPass = /^\s*-?\s*(?:Status|Final result):\s*\*\*?Pass\b/imu.test(currentIphoneEvidence);
  const executedPhysicalMatrix = /physical-iPhone matrix executed/iu.test(currentIphoneEvidence);
  const explicitWaiver = /maintainer-authorized waiver/iu.test(currentIphoneEvidence);
  const unexecutedPhysicalMatrix = /physical-iPhone matrix not executed/iu.test(currentIphoneEvidence);
  assert.notEqual(
    explicitPhysicalPass && explicitWaiver,
    true,
    "a candidate cannot claim a physical-device Pass and a waiver at the same time",
  );
  assert.ok(
    (explicitPhysicalPass && executedPhysicalMatrix && !explicitWaiver && !unexecutedPhysicalMatrix)
      || (explicitWaiver && unexecutedPhysicalMatrix && !explicitPhysicalPass),
    "current physical-device evidence must record either an executed Pass or an explicit maintainer-authorized unexecuted waiver",
  );
  if (explicitPhysicalPass) {
    assert.match(currentIphoneEvidence, /physical-iPhone matrix executed/iu);
    assert.doesNotMatch(currentIphoneEvidence, /maintainer-authorized waiver|matrix not executed/iu);
  } else {
    assert.match(currentIphoneEvidence, /not Passed|not a (?:device|physical-device) Pass/iu);
    assert.match(currentIphoneEvidence, /(?:for this candidate|for 0\.\d+\.\d+ only|must not be reused)/iu);
    assert.doesNotMatch(currentIphoneEvidence, /^\s*-?\s*(?:Status|Final result):\s*\*\*?Pass\b/imu);
  }
  if (manifest.version === "0.17.0") {
    assert.equal(currentIphoneEvidence, released017IphoneEvidence);
  }
  if (manifest.version === "0.18.0") {
    assert.match(currentIphoneEvidence, /Obsidian 1\.13\.7 on macOS/iu);
    assert.match(currentIphoneEvidence, /400 × 1267 portrait/iu);
    assert.match(currentIphoneEvidence, /1267 × 400 landscape/iu);
    assert.match(currentIphoneEvidence, /LTR 1267 × 400/iu);
    assert.match(currentIphoneEvidence, /RTL 844 × 390/iu);
    assert.match(currentIphoneEvidence, /Every applicable item[\s\S]{0,300}remains unexecuted on a physical device/iu);
    assert.match(currentIphoneEvidence, /Dynamic Type[^.]*VoiceOver/iu);
  }
  assert.doesNotMatch(iphoneChecklist, /recorded by the release workflow/iu);
  const commandAppendix = userGuide.slice(userGuide.indexOf("\n## Commands\n"), userGuide.indexOf("\n## Safety boundary\n"));
  for (const command of [
    "Quick append: Add to current note…",
    "Quick append: Choose a note…",
    "Quick append: Undo last append",
    "Open imported placeholder queue",
    "Resolve next imported placeholder…",
    "Review legacy index source…",
  ]) assert.match(commandAppendix, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.match(userGuide, /Any focused Quick Entry or Quick Append command/);
  assert.match(userGuide, /Open Library: _Library name_/);
  assert.match(packageJson, /node scripts\/run-runtime-tests\.mjs/);
  assert.doesNotMatch(packageJson, /tests\/(?:follow-up|update-announcement|view-provenance)\.test\.ts/, "runtime tests must be discovered instead of manually enumerated");
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
  // The count binding was renamed when the list became lazy; pin the button
  // label, not the local variable's name.
  assert.match(manager, /Browse \$\{available[A-Za-z]*\} available/);
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
  const discoverRuntimeSources = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith("._")) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await discoverRuntimeSources(absolute));
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolute);
    }
    return files;
  };
  const runtimePaths = await discoverRuntimeSources(path.join(root, "src"));
  const runtimeSources = await Promise.all(runtimePaths.map((file) => readFile(file, "utf8")));
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
  for (const name of [
    "typecheck", "lint", "test", "test:coverage", "test:performance", "test:layout", "verify-release",
    "verify-community", "verify-bundle-size", "audit:high", "review", "check", "release:checksums", "release:bundle",
  ]) {
    assert.equal(typeof scripts[name], "string", `missing npm script ${name}`);
  }
  const buildIndex = scripts.review.indexOf("npm run build");
  const bundleSizeIndex = scripts.review.indexOf("npm run verify-bundle-size");
  const communityIndex = scripts.review.indexOf("npm run verify-community");
  assert.notEqual(buildIndex, -1, "review must build main.js");
  assert.notEqual(bundleSizeIndex, -1, "review must enforce the bundle budget");
  assert.notEqual(communityIndex, -1, "review must run Community verification");
  assert.ok(buildIndex < bundleSizeIndex, "review must build main.js before measuring it");
  assert.ok(buildIndex < communityIndex, "review must build main.js before Community verification scans it");
  assert.match(scripts.review, /npm run test:coverage/);
  assert.match(scripts.review, /npm run test:performance/);
  assert.match(scripts.check, /npm run test:layout/);
  assert.match(scripts["release:bundle"], /npm run check/);
  const runtimeRunner = await readFile(path.join(root, "scripts", "run-runtime-tests.mjs"), "utf8");
  assert.match(runtimeRunner, /entry\.name\.endsWith\("\.test\.ts"\)/);
  assert.match(runtimeRunner, /entry\.name !== "release\.test\.ts"/);
  assert.match(runtimeRunner, /--test-coverage-lines=80/);
  assert.match(runtimeRunner, /--test-coverage-branches=75/);
  assert.match(runtimeRunner, /--test-coverage-functions=70/);
  assert.match(runtimeRunner, /--test-coverage-include=src\/\*\.ts/);
  assert.doesNotMatch(runtimeRunner, /--test-coverage-include=src\/(?:model|view)\.ts/);
  const bundleVerifier = await readFile(path.join(root, "scripts", "check-bundle-size.mjs"), "utf8");
  assert.match(bundleVerifier, /main\.js/);
  assert.match(bundleVerifier, /gzipSync/);
  const layoutTest = await readFile(path.join(root, "tests", "layout", "index-row-geometry.spec.ts"), "utf8");
  assert.match(layoutTest, /readFile\(stylesPath/);
  assert.match(layoutTest, /metadata must not collide with its badges/);
  assert.match(layoutTest, /phone-width RTL at 125% text/);
  const communityVerifier = await readFile(path.join(root, "scripts", "verify-community.mjs"), "utf8");
  assert.match(communityVerifier, /readFile\(path\.join\(root, "main\.js"\)/);
  assert.match(communityVerifier, /built main\.js must not require external module/);
  assert.match(communityVerifier, /discoverRuntimeSources\(absolute\)/);
  const [ciWorkflow, releaseWorkflow, securityWorkflow] = await Promise.all(
    ["ci.yml", "release.yml", "security-audit.yml"].map((name) => readFile(path.join(root, ".github", "workflows", name), "utf8")),
  );
  const workflow = `${ciWorkflow}\n${releaseWorkflow}\n${securityWorkflow}`;
  const actionReferences = [...workflow.matchAll(/^[ \t]*uses:[ \t]*([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(actionReferences.length > 0, "workflows must contain pinned actions");
  for (const reference of actionReferences) assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/, `action must use a full commit SHA: ${reference}`);
  assert.equal((ciWorkflow.match(/^permissions:/gm) ?? []).length, 1);
  assert.equal((ciWorkflow.match(/^[ \t]+permissions:/gm) ?? []).length, 0);
  assert.match(ciWorkflow, /^permissions:\n {2}contents: read\n\nconcurrency:/m);
  assert.match(ciWorkflow, /cancel-in-progress: true/);
  assert.match(ciWorkflow, /npm run audit:high/);
  assert.match(ciWorkflow, /playwright install --with-deps chromium/);
  assert.equal((releaseWorkflow.match(/^permissions:/gm) ?? []).length, 0);
  assert.deepEqual(releaseWorkflow.match(/^ {4}permissions:\n(?:^ {6}[\w-]+: (?:read|write)\n)+/gm), [
    "    permissions:\n      contents: read\n",
    "    permissions:\n      contents: write\n      id-token: write\n      attestations: write\n",
  ]);
  assert.match(releaseWorkflow, /fetch-depth: 0/);
  assert.match(releaseWorkflow, /verify-tag-ancestry\.mjs/);
  assert.match(releaseWorkflow, /refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(releaseWorkflow, /SHA256SUMS\.txt/);
  assert.match(releaseWorkflow, /npm run audit:high/);
  assert.match(workflow, /--notes-file release-notes\.md/);
  assert.match(workflow, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /attest-build-provenance@[0-9a-f]{40}/);
  assert.match(securityWorkflow, /^ {2}schedule:/m);
  assert.match(securityWorkflow, /^ {2}workflow_dispatch:/m);
  assert.match(securityWorkflow, /^permissions:\n {2}contents: read/m);
  assert.match(securityWorkflow, /npm ci --ignore-scripts/);
  assert.match(securityWorkflow, /npm run audit:high/);
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
