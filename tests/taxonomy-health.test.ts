import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrateData, portablePlaceholderPath, type VaultRecord } from "../src/model.ts";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { TaxonomyRepairPreviewModal } from "../src/taxonomy-health-modal.ts";
import {
  applyTaxonomyRepairToData,
  buildTaxonomyHealthFindings,
  localeInvariantTaxonomyKey,
  taxonomyConfusableSkeleton,
  taxonomyVariantKey,
} from "../src/taxonomy-health.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

function record(path: string, title: string, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    path,
    title,
    kind: "topic",
    role: "supporting",
    curriculumId: "",
    domain: "Research",
    topicKind: "note",
    priority: "",
    reviewStatus: "",
    synthesisStatus: "",
    autoresearchStatus: "",
    safetyCritical: false,
    sourceCount: 0,
    aliases: [],
    relatedTopics: [],
    parentTopic: "",
    imageStatus: "",
    doseStatus: "",
    sourceCoverage: "",
    folderOrder: "Research",
    mtime: 1,
    aiLock: false,
    ...overrides,
  };
}

function analyze(data = migrateData(null), records: VaultRecord[] = []) {
  return buildTaxonomyHealthFindings({
    data,
    records,
    existingMarkdownPaths: new Set(records.filter((item) => !item.isPlaceholder).map((item) => item.path)),
    existingFolderPaths: new Set(["Knowledge Base", "Templates", "Inbox"]),
    configDir: ".obsidian",
  });
}

test("taxonomy normalization is locale-invariant and detects curated confusables", () => {
  assert.equal(localeInvariantTaxonomyKey("  İNDEX  "), "i̇ndex");
  assert.equal(taxonomyVariantKey("Alpha—Beta"), taxonomyVariantKey("alpha beta"));
  assert.equal(taxonomyConfusableSkeleton("Αlpha"), taxonomyConfusableSkeleton("Alpha"));

  const records = [
    record("Knowledge Base/a.md", "Duplicate"),
    record("Knowledge Base/b.md", "Duplicate"),
    record("Knowledge Base/c.md", "Alpha-Beta"),
    record("Knowledge Base/d.md", "alpha beta"),
    record("Knowledge Base/e.md", "Alpha"),
    record("Knowledge Base/f.md", "Αlpha"),
  ];
  const findings = analyze(migrateData(null), records);
  assert.ok(findings.some((item) => item.kind === "duplicate-name"));
  assert.ok(findings.some((item) => item.kind === "name-variant" && item.detail.includes("Alpha-Beta")));
  assert.ok(findings.some((item) => item.kind === "confusable-name" && item.detail.includes("Αlpha")));
  assert.ok(findings.filter((item) => ["duplicate-name", "name-variant", "confusable-name"].includes(item.kind)).every((item) => !item.repair));
});

test("invalid visual and portable parent repairs are exact, previewable, and stale-safe", () => {
  const data = migrateData(null);
  const child = record("Knowledge Base/child.md", "Child");
  data.curriculumVisual.parentByPath[child.path] = "Knowledge Base/missing.md";
  data.portableIndex.groups = [{ id: "group", title: "Research", order: 0 }];
  data.portableIndex.subjects = [{
    id: "subject-child", title: "Portable child", groupId: "group", parentId: "missing-parent",
    order: 0, indexed: true, configuredId: "", recordKind: "topic", libraryId: null,
  }];
  const findings = analyze(data, [child]);
  const visual = findings.find((item) => item.repair?.kind === "clear-visual-parent");
  const portable = findings.find((item) => item.repair?.kind === "clear-portable-parent");
  assert.ok(visual?.repair);
  assert.ok(portable?.repair);
  assert.match(visual.repair.preview, /Undo/);
  assert.equal(applyTaxonomyRepairToData(data, visual.repair), true);
  assert.equal(data.curriculumVisual.parentByPath[child.path], undefined);
  assert.equal(applyTaxonomyRepairToData(data, visual.repair), false, "the preview cannot apply twice or after state changes");
  assert.equal(applyTaxonomyRepairToData(data, portable.repair), true);
  assert.equal(data.portableIndex.subjects[0]?.parentId, null);
});

test("the plugin repair service revalidates the finding and requires one Undo transaction", async () => {
  const data = migrateData(null);
  const child = record("Knowledge Base/child.md", "Child");
  data.curriculumVisual.parentByPath[child.path] = "Knowledge Base/missing.md";
  const findings = analyze(data, [child]);
  const finding = findings.find((item) => item.repair?.kind === "clear-visual-parent");
  assert.ok(finding?.repair);
  let options: Record<string, unknown> | undefined;
  let mutations = 0;
  const plugin = Object.create(EntVaultCommandCenterPlugin.prototype) as EntVaultCommandCenterPlugin & {
    data: typeof data;
    getTaxonomyHealthFindings: () => typeof findings;
    mutate: (label: string, action: () => void, value: Record<string, unknown>) => Promise<void>;
    invalidateRecordCache: () => void;
  };
  plugin.data = data;
  plugin.getTaxonomyHealthFindings = () => findings;
  plugin.invalidateRecordCache = () => undefined;
  plugin.mutate = async (_label, action, value) => {
    mutations += 1;
    options = value;
    action();
  };
  await plugin.applyTaxonomyHealthRepair(finding.id, finding.repair);
  assert.equal(mutations, 1);
  assert.equal(options?.requireUndo, true);
  assert.equal(data.curriculumVisual.parentByPath[child.path], undefined);
});

test("queued taxonomy repair revalidates its exact preview at the mutation boundary", async () => {
  const data = migrateData(null);
  const child = record("Knowledge Base/child.md", "Child");
  data.curriculumVisual.parentByPath[child.path] = "Knowledge Base/missing.md";
  const finding = analyze(data, [child]).find((item) => item.repair?.kind === "clear-visual-parent");
  assert.ok(finding?.repair);
  let checks = 0;
  const plugin = Object.create(EntVaultCommandCenterPlugin.prototype) as EntVaultCommandCenterPlugin & {
    data: typeof data;
    getTaxonomyHealthFindings: () => Array<typeof finding>;
    mutate: (label: string, action: () => void) => Promise<void>;
    invalidateRecordCache: () => void;
  };
  plugin.data = data;
  plugin.getTaxonomyHealthFindings = () => {
    checks += 1;
    return checks === 1 ? [finding] : [];
  };
  plugin.invalidateRecordCache = () => undefined;
  plugin.mutate = async (_label, action) => {
    // Represents a queued transaction resuming after the formerly missing
    // parent appeared in the vault without a plugin data-epoch change.
    action();
  };

  await assert.rejects(
    plugin.applyTaxonomyHealthRepair(finding.id, finding.repair),
    /changed after the preview/i,
  );
  assert.equal(checks, 2);
  assert.equal(data.curriculumVisual.parentByPath[child.path], "Knowledge Base/missing.md");
});

test("cycles and ambiguous identity findings remain report-only", () => {
  const data = migrateData(null);
  const a = record("Knowledge Base/a.md", "A");
  const b = record("Knowledge Base/b.md", "B");
  data.curriculumVisual.parentByPath[a.path] = b.path;
  data.curriculumVisual.parentByPath[b.path] = a.path;
  data.portableIndex.groups = [{ id: "group", title: "Research", order: 0 }];
  data.portableIndex.subjects = [
    { id: "a", title: "A", groupId: "group", parentId: "b", order: 0, indexed: true, configuredId: "", recordKind: "topic", libraryId: null },
    { id: "b", title: "B", groupId: "group", parentId: "a", order: 1, indexed: true, configuredId: "", recordKind: "topic", libraryId: null },
  ];
  data.portableIndex.resolvedPathBySubjectId = { a: a.path, b: a.path };
  const findings = analyze(data, [a, b]);
  assert.ok(findings.filter((item) => item.kind === "parent-cycle").length >= 2);
  assert.ok(findings.some((item) => item.kind === "duplicate-binding"));
  assert.ok(findings.filter((item) => ["parent-cycle", "duplicate-binding"].includes(item.kind)).every((item) => !item.repair));
});

test("health center finds empty structure, unavailable configuration, and possible placeholder matches", () => {
  const data = migrateData(null);
  data.collections = [{ id: "empty", title: "Empty collection", collapsed: false, subjects: [], subheadings: [{ id: "empty-sub", title: "Later", collapsed: false, subjects: [] }] }];
  data.indexGroupOrder = ["Future work"];
  data.settings.primaryFolder = "Missing folder";
  data.settings.defaultNewNoteMode = "template";
  data.settings.defaultTemplatePath = "Templates/Missing.md";
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Assets/Attachments";
  data.portableIndex.libraries = [{
    id: "library-research", name: "Research", singularName: "Paper", icon: "microscope",
    order: 0, sourceKind: null, archivedAt: null,
  }];
  data.portableIndex.libraryLayouts = { "library-research": [] };
  data.settings.libraryNoteProfiles = {
    "library-research": {
      folder: "Missing Library notes",
      mode: "template",
      templatePath: "Templates/Missing Paper.md",
    },
  };
  data.portableIndex.groups = [{ id: "group", title: "Research", order: 0 }];
  data.portableIndex.subjects = [{
    id: "placeholder", title: "Matching note", groupId: "group", parentId: null,
    order: 0, indexed: true, configuredId: "MATCH-1", recordKind: "topic", libraryId: null,
  }];
  const local = record("Knowledge Base/match.md", "Matching note", { curriculumId: "MATCH-1" });
  const placeholder = record(portablePlaceholderPath("placeholder"), "Matching note", { portableId: "placeholder", isPlaceholder: true, role: "placeholder" });
  const findings = analyze(data, [local, placeholder]);
  assert.ok(findings.some((item) => item.kind === "empty-structure"));
  assert.ok(findings.some((item) => item.kind === "unavailable-path" && item.detail.includes("Missing folder")));
  assert.ok(findings.some((item) => item.scope === "Attachments" && item.detail.includes("Assets/Attachments")));
  assert.ok(findings.some((item) => item.scope === "Library profile: Research" && item.detail.includes("Missing Library notes")));
  assert.ok(findings.some((item) => item.scope === "Library profile: Research" && item.detail.includes("Missing Paper.md")));
  assert.ok(findings.some((item) => item.kind === "placeholder-match" && item.path === local.path));
});

test("health center reports a damaged template-mode Library profile without a template", () => {
  const data = migrateData(null);
  data.settings.defaultNewNoteMode = "empty";
  data.settings.defaultTemplatePath = "";
  data.portableIndex.libraries = [{
    id: "library-damaged", name: "Damaged", singularName: "Record", icon: "folder",
    order: 0, sourceKind: null, archivedAt: null,
  }];
  data.portableIndex.libraryLayouts = { "library-damaged": [] };
  data.settings.libraryNoteProfiles = { "library-damaged": { mode: "template" } };

  const findings = analyze(data, []);
  assert.ok(findings.some((item) => item.scope === "Library profile: Damaged"
    && item.detail === "The Library creation profile requests Template mode without a template."));
});

test("taxonomy analysis remains linear at large-data scale", () => {
  const data = migrateData(null);
  const records = Array.from({ length: 50_000 }, (_, index) => record(
    `Knowledge Base/Topic ${index}.md`,
    `Topic ${index}`,
    { domain: `Group ${index % 50}` },
  ));
  const start = performance.now();
  const findings = analyze(data, records);
  const elapsed = performance.now() - start;
  assert.equal(findings.filter((item) => item.kind === "duplicate-name").length, 0);
  assert.ok(elapsed < 3_000, `50,000-record taxonomy analysis took ${elapsed.toFixed(1)} ms`);
});

test("taxonomy health UI is bounded, touch-sized, and uses one scrolling list", () => {
  const source = readFileSync(new URL("../src/taxonomy-health-modal.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(source, /const PAGE_SIZE = 200/);
  assert.match(source, /role: "list"/);
  assert.match(source, /Review repair…/);
  assert.match(source, /getActiveKnowledgeBaseId\(\) !== this\.openedBaseId/);
  assert.match(styles, /\.ent-cc-taxonomy-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.ent-cc-taxonomy-finding-actions \.ent-cc-button,[\s\S]*?min-height:\s*44px/);
  assert.doesNotMatch(styles, /\.ent-cc-taxonomy-finding-content\s*\{[^}]*overflow-y:/s);
});

test("taxonomy repair preview has definite mobile scroll ownership and large-text-safe fixed actions", () => {
  const source = readFileSync(new URL("../src/taxonomy-health-modal.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(source, /class TaxonomyRepairPreviewModal/);
  assert.match(source, /role: "region", "aria-label": "Taxonomy repair details", tabindex: "0"/);
  assert.match(source, /text: repair\.label, attr: \{ dir: "auto" \}/);
  assert.doesNotMatch(source, /apply\.focus\(\)/);
  assert.match(styles, /\.ent-cc-taxonomy-preview-modal\s*\{[^}]*height:[^;}]*100dvh[^}]*max-height:[^;}]*100dvh/s);
  assert.match(styles, /\.ent-cc-taxonomy-preview-modal > \.modal-content\.ent-cc-taxonomy-preview\s*\{[^}]*flex:\s*1 1 0;[^}]*height:\s*0;[^}]*min-height:\s*0/s);
  assert.match(styles, /\.ent-cc-taxonomy-preview-body\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.ent-cc-taxonomy-footer,[\s\S]*?\.ent-cc-taxonomy-preview-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*flex-wrap:\s*wrap/s);
  assert.match(styles, /\.ent-cc-taxonomy-preview-actions \.ent-cc-button\s*\{[^}]*min-height:\s*44px;[^}]*white-space:\s*normal/s);
  assert.doesNotMatch(styles, /\.ent-cc-taxonomy-preview\s*\{[^}]*overflow-y:\s*auto/s);
});

test("taxonomy repair preview leaves initial focus on modal context instead of Apply", () => {
  const data = migrateData(null);
  const child = record("Knowledge Base/child.md", "Child");
  data.curriculumVisual.parentByPath[child.path] = "Knowledge Base/missing.md";
  const finding = analyze(data, [child]).find((item) => item.repair?.kind === "clear-visual-parent");
  assert.ok(finding?.repair);
  const dom = createFakeDom();
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base",
    getDataEpoch: () => 1,
    applyTaxonomyHealthRepair: async () => undefined,
  };
  const modal = new TaxonomyRepairPreviewModal(plugin as never, finding, () => undefined) as TaxonomyRepairPreviewModal & {
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
  };
  modal.modalEl = asHtmlElement(dom.document.body.createDiv());
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  modal.onOpen();

  assert.equal(dom.document.activeElement, null);
  assert.equal(modal.titleEl.textContent, "Review taxonomy repair");
  assert.match(modal.contentEl.querySelector(".ent-cc-taxonomy-preview-body")?.textContent ?? "", /Undo/u);
  assert.equal(modal.contentEl.querySelector(".ent-cc-taxonomy-preview-actions .mod-cta")?.textContent, "Apply repair");
});
