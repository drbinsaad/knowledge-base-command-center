import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Notice, Setting } from "obsidian";
import { migrateData, portablePlaceholderPath, type VaultRecord } from "../src/model.ts";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import { ManageKnowledgeBasesModal } from "../src/knowledge-base-modal.ts";
import { ConfirmModal, TextPromptModal } from "../src/modals.ts";
import { TaxonomyHealthModal, TaxonomyRepairPreviewModal } from "../src/taxonomy-health-modal.ts";
import {
  applyTaxonomyRepairToData,
  buildTaxonomyHealthFindings,
  localeInvariantTaxonomyKey,
  taxonomyConfusableSkeleton,
  taxonomyVariantKey,
  type TaxonomyHealthFinding,
} from "../src/taxonomy-health.ts";
import { asHtmlElement, createFakeDom, FakeElement } from "./support/fake-dom.ts";

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
  // Staleness is delegated to the one shared guard factory in src/modals.ts.
  assert.match(source, /createOpenedBaseGuard\(this\.plugin, \{/);
  assert.doesNotMatch(source, /getActiveKnowledgeBaseId\(\) !== this\.openedBaseId/);
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

/**
 * Fake elements have no text-selection API. Installing one for the duration of a
 * test lets the filter inputs of the manager modals restore a caret like the
 * real DOM does, and records what they asked for.
 */
function withCaretSupport<T>(run: (restores: Array<[number, number]>) => T): T {
  const restores: Array<[number, number]> = [];
  const prototype = FakeElement.prototype as unknown as Record<string, unknown>;
  prototype.setSelectionRange = function setSelectionRange(start: number, end: number): void {
    restores.push([start, end]);
  };
  try {
    return run(restores);
  } finally {
    Reflect.deleteProperty(prototype, "setSelectionRange");
  }
}

test("the taxonomy filter keeps the caret where the user is typing", () => {
  const findings: TaxonomyHealthFinding[] = [
    { id: "one", kind: "duplicate-name", severity: "warning", title: "Duplicate note names", detail: "Two notes share a name.", scope: "Index" },
    { id: "two", kind: "empty-structure", severity: "info", title: "Empty collection", detail: "A collection has no subjects.", scope: "Collections" },
  ];
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base",
    getDataEpoch: () => 1,
    getTaxonomyHealthFindings: () => findings,
    isDataReadOnly: () => false,
  };
  const dom = createFakeDom();
  const modal = new TaxonomyHealthModal(plugin as never) as TaxonomyHealthModal & {
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
  };
  modal.modalEl = asHtmlElement(dom.document.body.createDiv());
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));

  const restores = withCaretSupport((captured) => {
    modal.onOpen();
    const search = modal.contentEl.querySelector('.ent-cc-taxonomy-toolbar input[type="search"]') as unknown as {
      value: string;
      selectionStart: number | null;
      selectionEnd: number | null;
      dispatch(type: string): void;
    } | null;
    assert.ok(search);
    // "duplcate" with the missing "i" typed back in leaves the caret mid-string.
    search.value = "duplicate";
    search.selectionStart = 5;
    search.selectionEnd = 5;
    search.dispatch("input");
    return captured;
  });

  assert.deepEqual(restores, [[5, 5]], "the caret must not jump to the end of the filter");
});

test("knowledge-base manager actions refuse to act on rows a synced replacement invalidated", () => {
  Notice.messages.length = 0;
  let dataEpoch = 1;
  const entry = {
    id: "base-b",
    updatedAt: 1,
    archivedAt: null,
    data: {
      settings: { workspaceName: "Research", workspaceMode: "generic", primaryFolder: "Knowledge Base" },
      portableIndex: { subjects: [] },
      collections: [],
    },
  };
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => dataEpoch,
    getIndexRecords: () => [],
    renameKnowledgeBase: async () => undefined,
  };
  const dom = createFakeDom();
  const modal = Object.create(ManageKnowledgeBasesModal.prototype) as {
    app: unknown;
    plugin: typeof plugin;
    openedBaseId: string;
    openedDataEpoch: number;
    close(): void;
    render(): void;
    renderEntry(parent: HTMLElement, entry: unknown, archived: boolean, availableCount: number): void;
  };
  modal.app = plugin.app;
  modal.plugin = plugin;
  modal.openedBaseId = "base-a";
  modal.openedDataEpoch = dataEpoch;
  modal.render = () => undefined;
  let closes = 0;
  modal.close = () => { closes += 1; };

  const list = dom.document.body.createDiv();
  modal.renderEntry(asHtmlElement(list), entry, false, 2);
  const rename = list.querySelectorAll("button").find((button) => button.getAttribute("aria-label") === "Rename");
  assert.ok(rename);

  const prompts: unknown[] = [];
  const promptOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
  TextPromptModal.prototype.open = function capturePrompt(): void { prompts.push(this); };
  try {
    rename.click();
    assert.equal(prompts.length, 1, "a current row still opens its rename prompt");

    dataEpoch = 2;
    rename.click();
  } finally {
    if (promptOpen) Object.defineProperty(TextPromptModal.prototype, "open", promptOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
  }

  assert.equal(prompts.length, 1, "a stale row must not act on replaced knowledge-base data");
  assert.equal(closes, 1);
  assert.match(Notice.messages.at(-1) ?? "", /Knowledge-base data changed/u);
});

test("index manager bulk selection matches the notes the filter shows", () => {
  const notes = [
    { path: "A.md", title: "Alpha", meta: "A.md" },
    { path: "B.md", title: "Beta", meta: "B.md" },
  ];
  const plugin = {
    data: {
      settings: { groupLabel: "Group", indexLabel: "Index", itemSingular: "note", itemPlural: "notes" },
      manualIndexPaths: [],
      excludedIndexPaths: [],
    },
    isClinicalMode: () => false,
    canVisuallyMoveAcrossGroups: () => true,
  };
  const dom = createFakeDom();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: unknown;
    plugin: typeof plugin;
    contentEl: HTMLElement;
    tab: string;
    query: string;
    selected: Set<string>;
    managerOpen: boolean;
    searchTimer: number | null;
    pendingTimers: Set<number>;
    selectionButtons: unknown[];
    guardOpenedBase(): boolean;
    render(): void;
    renderSnapshot(): void;
    renderNoteManager(notes: Array<{ path: string; title: string; meta: string }>, availableCount: () => number): void;
  };
  manager.app = { vault: { getAbstractFileByPath: () => null } };
  manager.plugin = plugin;
  manager.contentEl = asHtmlElement(dom.document.body.createDiv());
  manager.tab = "indexed";
  // A selection made before the current filter was typed: only "Beta" matches.
  manager.query = "beta";
  manager.selected = new Set(["A.md"]);
  manager.managerOpen = true;
  manager.searchTimer = null;
  manager.pendingTimers = new Set();
  manager.selectionButtons = [];
  manager.guardOpenedBase = () => true;
  manager.render = () => undefined;
  manager.renderSnapshot = () => undefined;

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { setTimeout: (callback: () => void) => { callback(); return 1; }, clearTimeout: () => undefined } },
  });
  try {
    withCaretSupport(() => {
      manager.renderNoteManager(notes, () => 0);
      const toggle = manager.contentEl.querySelector(".ent-cc-manager-toolbar button");
      assert.ok(toggle);
      assert.match(toggle.textContent, /Select matches/u, "a selection holding hidden notes is not a full selection");
      toggle.click();
      assert.deepEqual([...manager.selected].sort(), ["A.md", "B.md"]);

      const search = manager.contentEl.querySelector('.ent-cc-manager-toolbar input[type="search"]') as unknown as {
        value: string;
        dispatch(type: string): void;
      } | null;
      assert.ok(search);
      search.value = "alpha";
      search.dispatch("input");
      assert.equal(manager.selected.size, 0, "a new query drops notes the filter no longer shows");
    });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("in-modal mutations drop the cached diagnostics so the next Diagnostics view recomputes", async () => {
  // In-modal mutations change diagnostics inputs without bumping the data
  // epoch, so no stale-base guard can force a recompute; the modal must drop
  // its own cache on every deliberate refresh while still computing lazily.
  let issues = [{
    kind: "invalid-visual-parent",
    title: "Cross-group visual parent",
    detail: "The visual parent lives in another group.",
    path: "KB/Child.md",
  }];
  let indexRecords = [record("KB/Child.md", "Child", { domain: "Group A" })];
  let computes = 0;
  const plugin = {
    data: {
      settings: { indexLabel: "Index", groupLabel: "Group", itemSingular: "note", itemPlural: "notes" },
      manualIndexPaths: [],
      excludedIndexPaths: [],
      displayNameByPath: {},
    },
    getIndexRecords: () => indexRecords,
    getRecords: () => [],
    getIndexCandidateFiles: () => [],
    getIndexGroups: () => ["Group A"],
    getIndexDiagnostics: () => { computes += 1; return [...issues]; },
    async removeRecordsFromIndex(paths: string[]): Promise<void> {
      indexRecords = indexRecords.filter((item) => !paths.includes(item.path));
      issues = [];
    },
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    canVisuallyMoveAcrossGroups: () => true,
  };
  const dom = createFakeDom();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: unknown;
    plugin: typeof plugin;
    contentEl: HTMLElement;
    tab: string;
    query: string;
    selected: Set<string>;
    managerOpen: boolean;
    openedBaseId: string;
    searchTimer: number | null;
    pendingTimers: Set<number>;
    selectionButtons: unknown[];
    noteListCache: Map<string, unknown>;
    diagnosticsCache: unknown[] | null;
    render(): void;
    removeSelectedFromIndex(): void;
  };
  manager.app = { vault: { getAbstractFileByPath: () => null } };
  manager.plugin = plugin;
  manager.contentEl = asHtmlElement(dom.document.body.createDiv());
  manager.tab = "diagnostics";
  manager.query = "";
  manager.selected = new Set();
  manager.managerOpen = true;
  manager.openedBaseId = "";
  manager.searchTimer = null;
  manager.pendingTimers = new Set();
  manager.selectionButtons = [];
  manager.noteListCache = new Map();
  manager.diagnosticsCache = null;

  const settingPrototype = Setting.prototype as unknown as Record<string, unknown>;
  const settingButton = {
    setButtonText: (): typeof settingButton => settingButton,
    onClick: (): typeof settingButton => settingButton,
    setCta: (): typeof settingButton => settingButton,
    setDisabled: (): typeof settingButton => settingButton,
  };
  settingPrototype.addButton = function addButton(this: unknown, callback: (value: typeof settingButton) => void): unknown {
    callback(settingButton);
    return this;
  };
  settingPrototype.settingEl = { addClass: (): void => undefined };
  const confirms: Array<{ onConfirm(): void | Promise<void> }> = [];
  const confirmOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureConfirm(): void {
    confirms.push(this as unknown as { onConfirm(): void | Promise<void> });
  };
  try {
    manager.render();
    assert.equal(computes, 1, "opening the Diagnostics tab computes once");
    assert.equal(manager.contentEl.querySelectorAll(".ent-cc-manager-diagnostic").length, 1);
    assert.equal(manager.contentEl.querySelector('[data-manager-tab="diagnostics"]')?.textContent, "Diagnostics1");

    const indexedTab = manager.contentEl.querySelector('[data-manager-tab="indexed"]');
    assert.ok(indexedTab);
    indexedTab.click();
    assert.equal(computes, 1, "no other tab pays for a diagnostics recompute");

    manager.selected = new Set(["KB/Child.md"]);
    manager.removeSelectedFromIndex();
    assert.equal(confirms.length, 1);
    await confirms[0]?.onConfirm();
    assert.equal(computes, 1, "the mutation itself does not recompute either");
    const staleBadge = manager.contentEl.querySelector('[data-manager-tab="diagnostics"]');
    assert.equal(staleBadge?.textContent, "Diagnostics—", "the badge no longer advertises the pre-mutation count");

    staleBadge?.click();
    assert.equal(computes, 2, "returning to Diagnostics recomputes instead of serving the stale list");
    assert.equal(manager.contentEl.querySelectorAll(".ent-cc-manager-diagnostic").length, 0);
    assert.match(manager.contentEl.querySelector(".ent-cc-manager-toolbar p")?.textContent ?? "", /No index-organization problems detected/u);
  } finally {
    Reflect.deleteProperty(settingPrototype, "addButton");
    Reflect.deleteProperty(settingPrototype, "settingEl");
    if (confirmOpen) Object.defineProperty(ConfirmModal.prototype, "open", confirmOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }
});

test("Repair safe issues confirms before pruning missing-note registrations and runs immediately when nothing would be pruned", async () => {
  // On a device whose file sync is still catching up, "missing" registrations
  // may belong to perfectly valid notes. The one-click repair must therefore
  // ask before dropping them, and stay one-click when nothing would be dropped.
  const missingPaths = [
    "KB/Missing 1.md", "KB/Missing 2.md", "KB/Missing 3.md", "KB/Missing 4.md",
    "KB/Missing 5.md", "KB/Missing 6.md", "KB/Missing 7.md", "KB/Missing 8.md",
    "KB/Missing 9.md",
  ];
  let preview = { prunedPaths: missingPaths, otherFixCount: 1 };
  let repairs = 0;
  const plugin = {
    data: {
      settings: { indexLabel: "Index", groupLabel: "Group", itemSingular: "note", itemPlural: "notes" },
      manualIndexPaths: [],
      excludedIndexPaths: [],
      displayNameByPath: {},
    },
    getIndexRecords: () => [],
    getRecords: () => [],
    getIndexCandidateFiles: () => [],
    getIndexGroups: () => [],
    getIndexDiagnostics: () => [{
      kind: "missing-note",
      title: "Missing note reference",
      detail: "A registered note no longer exists.",
      path: "KB/Missing 1.md",
    }],
    previewIndexRepair: () => ({ ...preview, prunedPaths: [...preview.prunedPaths] }),
    async repairIndexOrganization(): Promise<void> { repairs += 1; },
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    canVisuallyMoveAcrossGroups: () => true,
  };
  const dom = createFakeDom();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: unknown;
    plugin: typeof plugin;
    contentEl: HTMLElement;
    tab: string;
    query: string;
    selected: Set<string>;
    managerOpen: boolean;
    openedBaseId: string;
    searchTimer: number | null;
    pendingTimers: Set<number>;
    selectionButtons: unknown[];
    noteListCache: Map<string, unknown>;
    diagnosticsCache: unknown[] | null;
    render(): void;
  };
  manager.app = { vault: { getAbstractFileByPath: () => null } };
  manager.plugin = plugin;
  manager.contentEl = asHtmlElement(dom.document.body.createDiv());
  manager.tab = "diagnostics";
  manager.query = "";
  manager.selected = new Set();
  manager.managerOpen = true;
  manager.openedBaseId = "";
  manager.searchTimer = null;
  manager.pendingTimers = new Set();
  manager.selectionButtons = [];
  manager.noteListCache = new Map();
  manager.diagnosticsCache = null;

  const settingPrototype = Setting.prototype as unknown as Record<string, unknown>;
  const settingButton = {
    setButtonText: (): typeof settingButton => settingButton,
    onClick: (): typeof settingButton => settingButton,
    setCta: (): typeof settingButton => settingButton,
    setDisabled: (): typeof settingButton => settingButton,
  };
  settingPrototype.addButton = function addButton(this: unknown, callback: (value: typeof settingButton) => void): unknown {
    callback(settingButton);
    return this;
  };
  settingPrototype.settingEl = { addClass: (): void => undefined };
  const confirms: Array<{ titleText: string; message: string; confirmLabel: string; onConfirm(): void | Promise<void> }> = [];
  const confirmOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureConfirm(): void {
    confirms.push(this as unknown as (typeof confirms)[number]);
  };
  // run() fires the repair without awaiting it; drain the task queue so the
  // completion notice and re-render have happened before asserting.
  const drainRepair = async (): Promise<void> => new Promise((resolve) => { globalThis.setTimeout(resolve, 0); });
  const repairButton = (): FakeElement => {
    const button = (manager.contentEl.querySelectorAll(".ent-cc-manager-toolbar button") as unknown as FakeElement[])
      .find((candidate) => /Repair safe issues/u.test(candidate.textContent));
    assert.ok(button);
    return button;
  };
  Notice.messages.length = 0;
  try {
    manager.render();
    repairButton().click();
    assert.equal(confirms.length, 1, "missing-note registrations demand a confirmation");
    assert.equal(repairs, 0, "nothing is pruned before the user confirms");
    const confirm = confirms[0];
    assert.ok(confirm);
    assert.equal(confirm.titleText, "Remove registrations for missing notes?");
    assert.equal(confirm.confirmLabel, "Repair and remove");
    assert.match(confirm.message, /9 registered notes are missing on this device/u);
    assert.ok(confirm.message.includes("KB/Missing 8.md"), "the first eight paths are listed");
    assert.ok(!confirm.message.includes("KB/Missing 9.md"), "the ninth path folds into the overflow count");
    assert.match(confirm.message, /…and 1 more/u);
    assert.match(confirm.message, /have not synced yet, cancel and wait for Sync/u);
    assert.match(confirm.message, /index memberships, collection memberships, and pins/u);
    await confirm.onConfirm();
    await drainRepair();
    assert.equal(repairs, 1, "confirming runs the existing repair");
    assert.equal(Notice.messages.filter((message) => /Safe plugin-state repairs completed/u.test(message)).length, 1);

    preview = { prunedPaths: [], otherFixCount: 3 };
    repairButton().click();
    await drainRepair();
    assert.equal(confirms.length, 1, "a repair with nothing to prune never asks");
    assert.equal(repairs, 2, "it runs immediately, exactly as before");
  } finally {
    Reflect.deleteProperty(settingPrototype, "addButton");
    Reflect.deleteProperty(settingPrototype, "settingEl");
    if (confirmOpen) Object.defineProperty(ConfirmModal.prototype, "open", confirmOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }
});

test("health center flags an empty depth-3 node without flagging its subject-bearing ancestor chain", () => {
  const data = migrateData(null);
  const memberPath = "Knowledge Base/member.md";
  data.collections = [{
    id: "heading-deep",
    title: "Board review",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: "sub-airway",
      title: "Airway",
      collapsed: false,
      subjects: [],
      subheadings: [
        { id: "sub-pediatric", title: "Pediatric", collapsed: false, subjects: [memberPath] },
        { id: "sub-neonatal", title: "Neonatal", collapsed: false, subjects: [] },
      ],
    }],
  }];
  data.portableIndex.libraries = [{
    id: "library-reading", name: "Reading", singularName: "Paper", icon: "book-open",
    order: 0, sourceKind: null, archivedAt: null,
  }];
  data.portableIndex.groups = [{ id: "group-reading", title: "Reading", order: 0 }];
  data.portableIndex.subjects = [{
    id: "subject-paper", title: "Kept paper", groupId: "group-reading", parentId: null,
    order: 0, indexed: false, configuredId: "", recordKind: "note", libraryId: "library-reading",
  }];
  data.portableIndex.libraryLayouts = {
    "library-reading": [{
      id: "reading-heading",
      title: "Current",
      collapsed: false,
      subjects: [],
      subheadings: [{
        id: "reading-level-2",
        title: "To discuss",
        collapsed: false,
        subjects: ["subject-paper"],
        subheadings: [{ id: "reading-level-3", title: "Journal club", collapsed: false, subjects: [] }],
      }],
    }],
  };

  const findings = analyze(data, [record(memberPath, "Member")]);
  const empty = findings.filter((item) => item.kind === "empty-structure");
  const emptyIds = empty.map((item) => item.id);

  assert.ok(emptyIds.some((id) => id.endsWith(":sub-neonatal")), "the empty depth-3 collection node is flagged");
  assert.equal(empty.find((item) => item.id.endsWith(":sub-neonatal"))?.detail.includes("Board review / Airway / Neonatal"), true, "the finding names the full path");
  assert.ok(emptyIds.some((id) => id.endsWith(":reading-level-3")), "the empty depth-3 library node is flagged");
  assert.equal(empty.find((item) => item.id.endsWith(":reading-level-3"))?.detail.includes("Reading / Current / To discuss / Journal club"), true);
  for (const ancestorId of ["heading-deep", "sub-airway", "sub-pediatric", "reading-heading", "reading-level-2"]) {
    assert.equal(emptyIds.some((id) => id.endsWith(`:${ancestorId}`)), false, `${ancestorId} has a subject-bearing subtree and is not empty`);
  }
  assert.equal(findings.some((item) => item.kind === "unreachable-structure"), false);
});

test("the taxonomy health stale guard closes every time but notices only once", () => {
  Notice.messages.length = 0;
  let epoch = 1;
  let closes = 0;
  const plugin = {
    app: {},
    data: { id: "opened" },
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => epoch,
  };
  const modal = Object.create(TaxonomyHealthModal.prototype) as {
    plugin: typeof plugin;
    ownsBase: (() => boolean) | null;
    openedBaseId: string;
    openedDataEpoch: number;
    close(): void;
    guardOpenedBase(): boolean;
  };
  modal.plugin = plugin;
  modal.ownsBase = null;
  // Also seed the fields the hand-rolled copy used, so this stays a test about
  // notice deduplication rather than about which fields the guard reads.
  modal.openedBaseId = "base-a";
  modal.openedDataEpoch = 1;
  modal.close = () => { closes += 1; };

  assert.equal(modal.guardOpenedBase(), true);
  epoch = 2;
  assert.equal(modal.guardOpenedBase(), false);
  assert.equal(modal.guardOpenedBase(), false);
  assert.equal(modal.guardOpenedBase(), false);

  assert.equal(closes, 3, "each blocked action still closes the modal");
  assert.equal(
    Notice.messages.filter((message) => message.includes("Reopen taxonomy health")).length,
    1,
    "the promoted guard dedupes the notice this copy used to spam",
  );
});
