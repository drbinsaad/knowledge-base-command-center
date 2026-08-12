import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDefaultStore,
  createKnowledgeBaseEntry,
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  PORTABLE_PLACEHOLDER_PREFIX,
  semanticEntryFingerprint,
  type KnowledgeBaseEntry,
  type PluginData,
  type PluginStore,
} from "../src/model";
import {
  applyPortfolioImportPlan,
  createPortfolioExport,
  createPortfolioImportPlan,
  MAX_PORTFOLIO_BUNDLE_BYTES,
  parsePortfolioExport,
  portfolioLayoutStructureCount,
  portfolioStoreGuard,
  serializePortfolioExport,
  type PortfolioExportV1,
  type PortfolioImportMapping,
} from "../src/portfolio";
import {
  EMPTY_PORTABLE_SELECTION,
  parsePortableExport,
  type PortableExportSelection,
} from "../src/portability";
import { PortfolioTransferModal } from "../src/portfolio-modal";
import { asHtmlElement, createFakeDom } from "./support/fake-dom";

function selection(overrides: Partial<PortableExportSelection> = {}): PortableExportSelection {
  return {
    ...EMPTY_PORTABLE_SELECTION,
    ...overrides,
    libraryIds: [...(overrides.libraryIds ?? [])],
  };
}

function data(name: string, mode: "generic" | "ent-clinical" = "generic"): PluginData {
  const value = structuredClone(DEFAULT_DATA);
  value.settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    setupComplete: true,
    workspaceName: name,
    workspaceMode: mode,
    primaryFolder: mode === "generic" ? `${name} Notes` : "03 Clinical Topics",
    defaultNoteFolder: mode === "generic" ? `${name} Notes` : "01 Inbox",
  };
  return value;
}

function entry(id: string, name: string, createdAt = 100): KnowledgeBaseEntry {
  return createKnowledgeBaseEntry(data(name), id, createdAt);
}

function storeWith(entries: KnowledgeBaseEntry[], vaultId = "vault-local"): PluginStore {
  const store = createDefaultStore(structuredClone(entries[0]?.data ?? data("Fallback")), 1, vaultId);
  store.bases = entries.map((item) => structuredClone(item));
  store.activeBaseId = entries[0]?.id ?? "base-default";
  return store;
}

function addPortableFixtures(value: PluginData, suffix: string): void {
  const indexGroup = `group-index-${suffix}`;
  const libraryGroup = `group-library-${suffix}`;
  const libraryId = `library-${suffix}`;
  value.indexGroupOrder = ["Empty index heading", "Topics"];
  value.portableIndex.groups = [
    { id: `group-empty-${suffix}`, title: "Empty index heading", order: 0 },
    { id: indexGroup, title: "Topics", order: 1 },
    { id: libraryGroup, title: "References", order: 2 },
  ];
  value.portableIndex.libraries = [{
    id: libraryId,
    name: "References",
    singularName: "Reference",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  value.portableIndex.subjects = [
    {
      id: `subject-topic-${suffix}`,
      title: "Portable topic",
      groupId: indexGroup,
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
      libraryId: null,
    },
    {
      id: `subject-unplaced-${suffix}`,
      title: "Unplaced reference",
      groupId: libraryGroup,
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "note",
      libraryId,
    },
  ];
  value.portableIndex.libraryLayouts = {
    [libraryId]: [{
      id: `heading-empty-${suffix}`,
      title: "Empty heading",
      collapsed: false,
      subjects: [],
      subheadings: [{
        id: `subheading-empty-${suffix}`,
        title: "Empty subheading",
        collapsed: false,
        subjects: [],
      }],
    }],
  };
  value.manualIndexPaths = [`${PORTABLE_PLACEHOLDER_PREFIX}subject-topic-${suffix}`];
}

function bundleFor(entries: KnowledgeBaseEntry[], vaultId = "vault-source"): PortfolioExportV1 {
  return createPortfolioExport(entries.map((source) => ({
    entry: source,
    records: [],
    selection: selection({
      workspace: true,
      index: true,
      libraryIds: source.data.portableIndex.libraries.map((library) => library.id),
      collections: true,
      study: true,
      savedViews: true,
    }),
  })), "2026-08-11T00:00:00.000Z", vaultId);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

test("portfolio export is a bounded manifest plus independent strict portable packages", () => {
  const first = entry("base-source-a", "Source A");
  const second = entry("base-source-b", "Source B");
  addPortableFixtures(first.data, "a");
  addPortableFixtures(second.data, "b");
  // Deliberate non-schema secrets prove the exporter cannot accidentally copy
  // note bodies or attachment payloads from adjacent runtime objects.
  (first.data as PluginData & { noteBodies?: unknown }).noteBodies = { secret: "BODY_SENTINEL" };
  (first.data as PluginData & { attachments?: unknown }).attachments = ["ATTACHMENT_SENTINEL"];

  const bundle = bundleFor([first, second]);
  const serialized = serializePortfolioExport(bundle);
  assert.equal(bundle.manifest.baseCount, 2);
  assert.equal(bundle.packages.length, 2);
  assert.equal(serialized.includes("BODY_SENTINEL"), false);
  assert.equal(serialized.includes("ATTACHMENT_SENTINEL"), false);
  assert.equal(new TextEncoder().encode(serialized).byteLength <= MAX_PORTFOLIO_BUNDLE_BYTES, true);

  const parsed = parsePortfolioExport(JSON.parse(serialized) as unknown);
  for (const packageEntry of parsed.packages) {
    assert.doesNotThrow(() => parsePortableExport(structuredClone(packageEntry.package)));
    const index = packageEntry.package.components.index;
    assert.ok(index?.groups.some((group) => group.title === "Empty index heading"));
    assert.ok(Object.values(index?.libraryLayouts ?? {}).some((layout) => (
      layout.some((heading) => heading.title === "Empty heading"
        && heading.subjects.length === 0
        && heading.subheadings.some((subheading) => subheading.title === "Empty subheading" && subheading.subjects.length === 0))
    )));
    assert.ok(index?.subjects.some((subject) => subject.title === "Unplaced reference"));
  }
});

test("portfolio parser delegates malicious inner IDs to the existing strict parser and strips unknown content fields", () => {
  const source = entry("base-source", "Source");
  addPortableFixtures(source.data, "malicious");
  const valid = bundleFor([source]);

  const malicious = structuredClone(valid) as unknown as Record<string, unknown>;
  const packages = malicious.packages as Array<Record<string, unknown>>;
  const portable = packages[0]?.package as { components: { index: { subjects: Array<Record<string, unknown>> } } };
  if (!portable) assert.fail("portable fixture missing");
  portable.components.index.subjects[0].id = "__proto__";
  assert.throws(() => parsePortfolioExport(malicious), /invalid/i);

  const padded = { ...structuredClone(valid), noteBodies: "x".repeat(MAX_PORTFOLIO_BUNDLE_BYTES) };
  assert.throws(() => parsePortfolioExport(padded), /larger than the 32 MB/i);

  const withUnknown = structuredClone(valid) as unknown as {
    packages: Array<{ package: { components: Record<string, unknown> } }>;
  };
  withUnknown.packages[0].package.components.noteBodies = { secret: "not retained" };
  const sanitized = parsePortfolioExport(withUnknown);
  assert.equal("noteBodies" in sanitized.packages[0].package.components, false);

  const unsafeManifest = structuredClone(valid);
  unsafeManifest.manifest.entries[0].sourceBaseId = "../escape";
  assert.throws(() => parsePortfolioExport(unsafeManifest), /invalid stable ID/i);

  const coercedCount = structuredClone(valid) as unknown as { manifest: { totalSubjects: unknown } };
  coercedCount.manifest.totalSubjects = String(valid.manifest.totalSubjects);
  assert.throws(() => parsePortfolioExport(coercedCount), /non-negative integer/i);
});

test("portfolio parser rejects more than 50 bases before accepting aggregate declarations", () => {
  const source = entry("base-source", "Source");
  const valid = bundleFor([source]);
  const oversized = structuredClone(valid);
  oversized.manifest.entries = Array.from({ length: 51 }, (_, index) => ({
    ...structuredClone(valid.manifest.entries[0]),
    sourceBaseId: `base-${index}`,
  }));
  oversized.packages = Array.from({ length: 51 }, (_, index) => ({
    sourceBaseId: `base-${index}`,
    package: structuredClone(valid.packages[0].package),
  }));
  oversized.manifest.baseCount = 51;
  assert.throws(() => parsePortfolioExport(oversized), /at most 50/i);
});

test("one immutable mutation plan drives exact preview and exact apply", () => {
  const source = entry("base-source", "Source");
  addPortableFixtures(source.data, "identity");
  const bundle = deepFreeze(bundleFor([source], "vault-local"));
  const destination = entry("base-destination", "Destination", 10);
  destination.data.portableIndex.libraries = [{
    id: "library-local-only",
    name: "Local only",
    singularName: "Local item",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  destination.data.portableIndex.libraryLayouts = { "library-local-only": [] };
  const store = storeWith([destination], "vault-local");
  const beforeBundle = JSON.stringify(bundle);
  const mapping: PortfolioImportMapping = {
    sourceBaseId: "base-source",
    destination: { kind: "existing", baseId: "base-destination" },
    mode: "replace",
  };
  const plan = createPortfolioImportPlan(store, bundle, [mapping], { now: 1_700_000_000_000 });

  assert.equal(JSON.stringify(bundle), beforeBundle, "planning must not mutate a frozen source package");
  assert.equal(plan.confirmationPhrase, "REPLACE 1 BASE");
  assert.ok(plan.diff.basesReplace.length > 0);
  assert.ok(plan.diff.headingsAdd.some((item) => item.includes("Empty heading")));
  assert.ok(plan.diff.subjectsAdd.some((item) => item.includes("Portable topic")));
  assert.ok(plan.diff.subjectsUnplaced.some((item) => item.includes("Unplaced reference")));
  assert.ok(plan.diff.librariesArchive.some((item) => item.includes("Local only")));
  assert.ok(plan.diff.willNotChange.some((item) => item.includes("note bodies and attachments")));
  assert.equal(plan.recoveryPackages.length, 1);
  assert.doesNotThrow(() => parsePortableExport(structuredClone(plan.recoveryPackages[0].package)));

  const unchanged = structuredClone(store);
  assert.throws(() => applyPortfolioImportPlan(unchanged, plan, "replace 1 base"), /Type REPLACE 1 BASE exactly/i);
  assert.deepEqual(unchanged, store);

  applyPortfolioImportPlan(store, plan, "REPLACE 1 BASE");
  assert.equal(portfolioStoreGuard(store), plan.expectedAfterStoreGuard);
  assert.deepEqual(store.bases.find((item) => item.id === "base-destination"), plan.operations[0].afterEntry);
  assert.equal(store.activeBaseId, "base-destination");
  assert.notEqual(store.bases[0]?.data.portableIndex.libraries.find((library) => library.id === "library-local-only")?.archivedAt, null);
});

test("multi-base mapping is collision-safe and rejects two sources targeting one destination", () => {
  const first = entry("base-source-one", "Source One");
  const second = entry("base-source-two", "Source Two");
  addPortableFixtures(first.data, "one");
  addPortableFixtures(second.data, "two");
  // Force a stable-ID collision whose title differs; the preview must expose it.
  second.data.portableIndex.subjects[0].id = "shared-subject";
  first.data.portableIndex.subjects[0].id = "shared-subject";
  first.data.portableIndex.subjects[0].title = "First meaning";
  second.data.portableIndex.subjects[0].title = "Second meaning";
  first.data.manualIndexPaths = [`${PORTABLE_PLACEHOLDER_PREFIX}shared-subject`];
  second.data.manualIndexPaths = [`${PORTABLE_PLACEHOLDER_PREFIX}shared-subject`];
  const bundle = bundleFor([first, second], "vault-different");
  const destinationOne = entry("base-dest-one", "Destination One", 10);
  const destinationTwo = entry("base-dest-two", "Destination Two", 20);
  destinationOne.data.portableIndex.groups = structuredClone(first.data.portableIndex.groups);
  destinationOne.data.portableIndex.subjects = [{ ...structuredClone(first.data.portableIndex.subjects[0]), title: "Local meaning" }];
  const store = storeWith([destinationOne, destinationTwo], "vault-local");
  const mappings: PortfolioImportMapping[] = [
    { sourceBaseId: first.id, destination: { kind: "existing", baseId: destinationOne.id }, mode: "merge" },
    { sourceBaseId: second.id, destination: { kind: "existing", baseId: destinationTwo.id }, mode: "merge" },
  ];
  const plan = createPortfolioImportPlan(store, bundle, mappings, { now: 1_700_000_000_100 });
  assert.equal(plan.operations.length, 2);
  assert.ok(plan.diff.conflicts.some((item) => item.includes("shared-subject")));
  applyPortfolioImportPlan(store, plan);
  assert.ok(store.bases.find((item) => item.id === destinationOne.id)?.data.portableIndex.subjects.length);
  assert.ok(store.bases.find((item) => item.id === destinationTwo.id)?.data.portableIndex.subjects.length);

  assert.throws(() => createPortfolioImportPlan(storeWith([destinationOne, destinationTwo]), bundle, [
    { sourceBaseId: first.id, destination: { kind: "existing", baseId: destinationOne.id }, mode: "merge" },
    { sourceBaseId: second.id, destination: { kind: "existing", baseId: destinationOne.id }, mode: "merge" },
  ], { now: 1_700_000_000_200 }), /mapped more than once/i);
});

test("cross-vault Replace is separately gated while Merge and new-base import remain portable", () => {
  const source = entry("base-source", "Source");
  const bundle = bundleFor([source], "vault-elsewhere");
  const destination = entry("base-destination", "Destination");
  const store = storeWith([destination], "vault-here");
  const replace: PortfolioImportMapping = {
    sourceBaseId: source.id,
    destination: { kind: "existing", baseId: destination.id },
    mode: "replace",
  };
  assert.throws(() => createPortfolioImportPlan(store, bundle, [replace], { now: 1_700_000_000_300 }), /cross-vault Replace requires/i);
  assert.doesNotThrow(() => createPortfolioImportPlan(store, bundle, [replace], {
    now: 1_700_000_000_300,
    allowCrossVaultReplace: true,
  }));
  assert.doesNotThrow(() => createPortfolioImportPlan(store, bundle, [{ ...replace, mode: "merge" }], {
    now: 1_700_000_000_300,
  }));
  const add = createPortfolioImportPlan(store, bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "new", name: "Imported Source" },
    mode: "merge",
  }], { now: 1_700_000_000_300 });
  assert.equal(add.diff.basesAdd.length, 1);
  const addedEntry = add.operations[0]?.afterEntry;
  assert.ok(addedEntry);
  assert.equal(addedEntry.semanticHash, semanticEntryFingerprint(addedEntry));
  assert.throws(() => createPortfolioImportPlan(store, bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "new", name: "Imported Source" },
    mode: "replace",
  }], { now: 1_700_000_000_301 }), /new knowledge base is initialized with Merge/i);
});

test("selective Replace preserves unselected Libraries and reports only selected conflicts", () => {
  const source = entry("base-source", "Source");
  addPortableFixtures(source.data, "selective");
  const bundle = bundleFor([source], "vault-local");
  const destination = entry("base-destination", "Destination");
  destination.data.portableIndex.libraries = [{
    id: "library-local-only",
    name: "Local only",
    singularName: "Local item",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  destination.data.portableIndex.libraryLayouts = { "library-local-only": [] };
  destination.data.portableIndex.groups = structuredClone(source.data.portableIndex.groups);
  destination.data.portableIndex.subjects = source.data.portableIndex.subjects.map((subject) => ({
    ...structuredClone(subject),
    title: `Local ${subject.title}`,
  }));
  const store = storeWith([destination], "vault-local");

  const indexOnly = createPortfolioImportPlan(store, bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "existing", baseId: destination.id },
    mode: "replace",
    selection: selection({ index: true }),
  }], { now: 1_700_000_000_350 });
  const localLibrary = indexOnly.operations[0]?.afterEntry.data.portableIndex.libraries
    .find((library) => library.id === "library-local-only");
  assert.equal(localLibrary?.archivedAt, null);
  assert.equal(indexOnly.diff.librariesArchive.length, 0);
  assert.ok(indexOnly.diff.conflicts.some((item) => item.includes("Portable topic")));

  const workspaceOnly = createPortfolioImportPlan(store, bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "existing", baseId: destination.id },
    mode: "merge",
    selection: selection({ workspace: true }),
  }], { now: 1_700_000_000_351 });
  assert.deepEqual(workspaceOnly.diff.conflicts, []);
});

test("unavailable folders and templates are exact plan fallbacks", () => {
  const source = entry("base-source", "Source");
  source.data.settings.primaryFolder = "Missing Primary";
  source.data.settings.defaultNoteFolder = "Missing Notes";
  source.data.settings.templatesFolder = "Missing Templates";
  source.data.settings.proposalFolder = "Missing Inbox";
  source.data.settings.defaultNewNoteMode = "template";
  source.data.settings.defaultTemplatePath = "Missing Templates/Template.md";
  const bundle = bundleFor([source], "vault-local");
  const destination = entry("base-destination", "Destination");
  const store = storeWith([destination], "vault-local");
  const plan = createPortfolioImportPlan(store, bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "existing", baseId: destination.id },
    mode: "merge",
  }], {
    now: 1_700_000_000_400,
    resources: {
      configDir: ".obsidian",
      folderExists: () => false,
      templateExists: () => false,
    },
  });
  const after = plan.operations[0].afterEntry.data.settings;
  assert.equal(after.primaryFolder, destination.data.settings.primaryFolder);
  assert.equal(after.defaultNoteFolder, destination.data.settings.defaultNoteFolder);
  assert.equal(after.defaultNewNoteMode, "empty");
  assert.equal(after.defaultTemplatePath, "");
  assert.ok(plan.diff.fallbacks.some((item) => item.includes("unavailable primaryFolder")));
  assert.ok(plan.diff.fallbacks.some((item) => item.includes("Empty note")));
});

test("malicious workspace paths fail before a plan exists", () => {
  const source = entry("base-source", "Source");
  source.data.settings.primaryFolder = "../Outside";
  const bundle = bundleFor([source], "vault-local");
  const destination = entry("base-destination", "Destination");
  assert.throws(() => createPortfolioImportPlan(storeWith([destination], "vault-local"), bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "existing", baseId: destination.id },
    mode: "merge",
  }], { now: 1_700_000_000_500 }), /relative segments|outside|folder/i);
});

test("portfolio workspace preflight rejects an unsafe fixed attachment folder", () => {
  const source = entry("base-source", "Source");
  source.data.settings.attachmentStorageMode = "fixed-folder";
  source.data.settings.attachmentFolder = "../Outside";
  const bundle = bundleFor([source], "vault-local");
  const destination = entry("base-destination", "Destination");

  assert.throws(() => createPortfolioImportPlan(storeWith([destination], "vault-local"), bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "existing", baseId: destination.id },
    mode: "merge",
  }], {
    now: 1_700_000_000_501,
    resources: { configDir: ".obsidian" },
  }), /relative segments|outside|folder/i);
});

test("stale or tampered plans leave the store byte-for-byte unchanged", () => {
  const source = entry("base-source", "Source");
  const bundle = bundleFor([source], "vault-local");
  const destination = entry("base-destination", "Destination");
  const store = storeWith([destination], "vault-local");
  const plan = createPortfolioImportPlan(store, bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "existing", baseId: destination.id },
    mode: "merge",
  }], { now: 1_700_000_000_600, expectedExternalGeneration: 7 });

  const staleStore = structuredClone(store);
  staleStore.bases[0].data.settings.workspaceSubtitle = "changed after preview";
  staleStore.bases[0].semanticHash = semanticEntryFingerprint(staleStore.bases[0]);
  const staleBefore = structuredClone(staleStore);
  assert.throws(() => applyPortfolioImportPlan(staleStore, plan, "", 7), /changed after the portfolio preview/i);
  assert.deepEqual(staleStore, staleBefore);

  const generationStore = structuredClone(store);
  const generationBefore = structuredClone(generationStore);
  assert.throws(() => applyPortfolioImportPlan(generationStore, plan, "", 8), /Synced plugin data changed/i);
  assert.deepEqual(generationStore, generationBefore);

  const viewStateStore = structuredClone(store);
  viewStateStore.bases[0].data.selectedPath = "changed-after-preview";
  const viewStateBefore = structuredClone(viewStateStore);
  assert.throws(() => applyPortfolioImportPlan(viewStateStore, plan, "", 7), /changed after the portfolio preview/i);
  assert.deepEqual(viewStateStore, viewStateBefore);

  const tamperedStore = structuredClone(store);
  const tamperedBefore = structuredClone(tamperedStore);
  const tamperedPlan = structuredClone(plan);
  tamperedPlan.operations[0].afterEntry.data.settings.workspaceSubtitle = "tampered post-state";
  assert.throws(() => applyPortfolioImportPlan(tamperedStore, tamperedPlan), /plan changed after preview/i);
  assert.deepEqual(tamperedStore, tamperedBefore);
});

test("portfolio tabs expose one labelled panel and support Arrow, Home, and End navigation", () => {
  const dom = createFakeDom();
  const plugin = { app: {}, getKnowledgeBases: () => [] };
  const modal = new PortfolioTransferModal(plugin as never) as unknown as {
    mode: "export" | "import";
    busy: null;
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    panelEl: HTMLElement | null;
    renderExport(): void;
    renderImport(): void;
    onOpen(): void;
    onClose(): void;
  };
  modal.modalEl = asHtmlElement(dom.document.body.createDiv());
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  modal.renderExport = () => modal.panelEl?.createDiv({ text: "Export body" });
  modal.renderImport = () => modal.panelEl?.createDiv({ text: "Import body" });
  modal.onOpen();

  type FakeInteractive = {
    dispatch(type: string, init: { key: string }): { defaultPrevented: boolean };
    getAttribute(name: string): string | null;
  };
  const activeTab = (): FakeInteractive | null => modal.contentEl.querySelector('[role="tab"][aria-selected="true"]') as unknown as FakeInteractive | null;
  const panel = (): HTMLElement | null => modal.contentEl.querySelector('[role="tabpanel"]');
  assert.equal(modal.contentEl.querySelectorAll('[role="tabpanel"]').length, 1);
  assert.equal(activeTab()?.getAttribute("aria-controls"), panel()?.getAttribute("id"));
  assert.equal(panel()?.getAttribute("aria-labelledby"), activeTab()?.getAttribute("id"));
  assert.equal(panel()?.textContent, "Export body");
  assert.equal(modal.contentEl.querySelector('[data-portfolio-focus="close"]')?.textContent, "Cancel");

  const keydown = (key: string): boolean => {
    const tab = activeTab();
    assert.ok(tab);
    return tab.dispatch("keydown", { key }).defaultPrevented;
  };
  assert.equal(keydown("ArrowRight"), true);
  assert.equal(modal.mode, "import");
  assert.equal(dom.document.activeElement?.getAttribute("data-portfolio-focus"), "mode-import");
  assert.equal(panel()?.textContent, "Import body");
  assert.equal(keydown("Home"), true);
  assert.equal(modal.mode, "export");
  assert.equal(keydown("End"), true);
  assert.equal(modal.mode, "import");
  assert.equal(keydown("ArrowLeft"), true);
  assert.equal(modal.mode, "export");
  modal.onClose();
});

test("portfolio rerender focus restoration covers source, destination, acknowledgement, and show-more fallbacks", () => {
  const dom = createFakeDom();
  const plugin = { app: {}, getKnowledgeBases: () => [] };
  const modal = new PortfolioTransferModal(plugin as never) as unknown as {
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    pendingFocusKey: string | null;
    pendingFocusFallbackKey: string | null;
    render(): void;
    rerenderFromControl(focusKey: string, fallbackFocusKey?: string): void;
    restorePendingFocus(): void;
  };
  modal.modalEl = asHtmlElement(dom.document.body.createDiv());
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  const keys = ["source-base-a", "destination-base-a", "cross-vault-ack", "diff-more-conflicts"];
  modal.render = () => {
    modal.contentEl.empty();
    for (const key of keys) modal.contentEl.createEl("button", { attr: { "data-portfolio-focus": key } });
    modal.restorePendingFocus();
  };
  for (const key of keys) {
    modal.rerenderFromControl(key);
    assert.equal(dom.document.activeElement?.getAttribute("data-portfolio-focus"), key);
  }
  keys.pop();
  modal.render = () => {
    modal.contentEl.empty();
    modal.contentEl.createEl("section", { attr: { "data-portfolio-focus": "diff-section-conflicts" } });
    modal.restorePendingFocus();
  };
  modal.rerenderFromControl("diff-more-conflicts", "diff-section-conflicts");
  assert.equal(dom.document.activeElement?.getAttribute("data-portfolio-focus"), "diff-section-conflicts");
});

test("portfolio viewport lifecycle uses its owner window and removes every keyboard listener and CSS override", () => {
  const dom = createFakeDom();
  dom.window.innerHeight = 844;
  dom.window.visualViewport.height = 430;
  dom.window.visualViewport.offsetTop = 20;
  dom.window.keyboardHeightCss = "414px";
  const plugin = { app: {}, getKnowledgeBases: () => [] };
  const modal = new PortfolioTransferModal(plugin as never) as unknown as {
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    panelEl: HTMLElement | null;
    renderExport(): void;
    renderImport(): void;
    onOpen(): void;
    onClose(): void;
  };
  modal.modalEl = asHtmlElement(dom.document.body.createDiv());
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  modal.renderExport = () => undefined;
  modal.renderImport = () => undefined;
  modal.onOpen();

  assert.equal(dom.window.listenerCount("resize"), 1);
  assert.equal(dom.window.visualViewport.listenerCount("resize"), 1);
  assert.equal(dom.window.visualViewport.listenerCount("scroll"), 1);
  assert.equal(modal.modalEl.style.getPropertyValue("--ent-cc-portfolio-visual-height"), "410px");
  assert.equal(modal.modalEl.hasClass("is-virtual-keyboard-open"), true);

  modal.onClose();
  assert.equal(dom.window.listenerCount("resize"), 0);
  assert.equal(dom.window.visualViewport.listenerCount("resize"), 0);
  assert.equal(dom.window.visualViewport.listenerCount("scroll"), 0);
  assert.equal(modal.modalEl.style.getPropertyValue("--ent-cc-portfolio-visual-height"), "");
  assert.equal(modal.modalEl.hasClass("is-virtual-keyboard-open"), false);
});

test("portfolio mobile source declares stable focus keys, a sole scroll panel, and iOS keyboard geometry", () => {
  const source = readFileSync(new URL("../src/portfolio-modal.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(source, /data-portfolio-focus", `source-\$\{manifest\.sourceBaseId\}`/);
  assert.match(source, /data-portfolio-focus", `destination-\$\{manifest\.sourceBaseId\}`/);
  assert.match(source, /data-portfolio-focus", "cross-vault-ack"/);
  assert.match(source, /diff-more-\$\{category\}/);
  assert.match(source, /calculateModalViewportLayout/);
  assert.match(source, /--keyboard-height/);
  assert.match(source, /visualViewport\?\.removeEventListener/);
  assert.match(source, /ent-cc-portfolio-preview-status[\s\S]*?role: "status"[\s\S]*?"aria-atomic": "true"/);
  assert.doesNotMatch(source, /ent-cc-portfolio-preview", attr: \{ "aria-live"/);
  assert.match(styles, /\.ent-cc-portfolio-panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(styles, /\.ent-cc-portfolio-center\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.ent-cc-portfolio-footer \.ent-cc-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /--ent-cc-portfolio-visual-height/);
});

test("portfolio transfers nested organization with recursive budgets and full path labels", () => {
  const source = entry("base-source-nested", "Nested Source");
  source.data.portableIndex.groups = [{ id: "group-refs", title: "References", order: 0 }];
  source.data.portableIndex.libraries = [{
    id: "library-refs",
    name: "References",
    singularName: "Reference",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  source.data.portableIndex.subjects = [{
    id: "subject-deep",
    title: "Deep reference",
    groupId: "group-refs",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "note",
    libraryId: "library-refs",
  }];
  source.data.portableIndex.libraryLayouts = {
    "library-refs": [{
      id: "heading-alpha",
      title: "Alpha",
      collapsed: false,
      subjects: [],
      subheadings: [{
        id: "sub-beta",
        title: "Beta",
        collapsed: false,
        subjects: [],
        subheadings: [{ id: "sub-gamma", title: "Gamma", collapsed: false, subjects: ["subject-deep"] }],
      }],
    }],
  };
  source.data.collections = [{
    id: "collection-reading",
    title: "Reading",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: "collection-cases",
      title: "Cases",
      collapsed: false,
      subjects: [],
      subheadings: [{
        id: "collection-airway",
        title: "Airway",
        collapsed: false,
        subjects: [`${PORTABLE_PLACEHOLDER_PREFIX}subject-deep`],
      }],
    }],
  }];

  assert.equal(
    portfolioLayoutStructureCount(source.data.portableIndex.libraryLayouts["library-refs"]),
    3,
    "structure counting recurses through every nested level",
  );

  const bundle = bundleFor([source], "vault-local");
  const manifestEntry = bundle.manifest.entries[0];
  const packageIndex = bundle.packages[0]?.package.components.index;
  assert.ok(manifestEntry);
  assert.deepEqual(
    packageIndex?.libraryLayouts?.["library-refs"],
    source.data.portableIndex.libraryLayouts["library-refs"],
    "the portfolio package carries the exact nested library layout",
  );
  assert.equal(
    manifestEntry.structures,
    (packageIndex?.groups.length ?? 0) + (packageIndex?.libraries?.length ?? 0) + 3 + 3,
    "budgets charge every nested library-layout and collection node",
  );
  assert.equal(manifestEntry.references, 2, "each nested placement counts as one reference");

  const destination = entry("base-destination", "Destination", 10);
  const store = storeWith([destination], "vault-local");
  const plan = createPortfolioImportPlan(store, bundle, [{
    sourceBaseId: source.id,
    destination: { kind: "existing", baseId: destination.id },
    mode: "merge",
  }], { now: 1_700_000_000_700 });
  assert.ok(
    plan.diff.headingsAdd.some((item) => item.includes("References subheading “Alpha / Beta / Gamma”")),
    "nested headings are labelled with their full title path",
  );
  assert.ok(
    plan.diff.subjectsAdd.some((item) => item.includes("References / Alpha / Beta / Gamma")),
    "nested placements are labelled with their full title path",
  );

  applyPortfolioImportPlan(store, plan);
  const imported = store.bases.find((item) => item.id === destination.id)?.data;
  assert.deepEqual(
    imported?.portableIndex.libraryLayouts["library-refs"],
    source.data.portableIndex.libraryLayouts["library-refs"],
    "the nested library layout arrives intact",
  );
  assert.equal(
    imported?.collections[0]?.subheadings[0]?.subheadings?.[0]?.title,
    "Airway",
    "the nested collection levels arrive intact",
  );
  assert.deepEqual(
    imported?.collections[0]?.subheadings[0]?.subheadings?.[0]?.subjects,
    [`${PORTABLE_PLACEHOLDER_PREFIX}subject-deep`],
    "deeply nested collection subjects stay bound to the stable subject identity",
  );
});

test("plan previews key layout structures collision-proof against crafted local IDs", () => {
  const source = entry("base-source", "Source");
  source.data.portableIndex.libraries = [{
    id: "library-x",
    name: "Crafted",
    singularName: "Item",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  source.data.portableIndex.libraryLayouts = {
    "library-x": [{ id: "safe-heading", title: "Safe heading", collapsed: false, subjects: [], subheadings: [] }],
  };
  const bundle = bundleFor([source], "vault-local");

  // Local layout IDs are only isSafeObjectKey-constrained, so a crafted
  // data.json can smuggle any joiner character into an ID. The two pairs
  // below describe four distinct nodes whose ancestor ID paths must never
  // collapse into one preview key.
  const NUL = String.fromCharCode(0);
  const destination = entry("base-destination", "Destination", 10);
  destination.data.portableIndex.libraries = structuredClone(source.data.portableIndex.libraries);
  destination.data.portableIndex.libraryLayouts = {
    "library-x": [
      {
        id: `a${NUL}b`,
        title: "Heading One",
        collapsed: false,
        subjects: [],
        subheadings: [{ id: "c", title: "Child of One", collapsed: false, subjects: [] }],
      },
      {
        id: "a",
        title: "Heading Two",
        collapsed: false,
        subjects: [],
        subheadings: [{ id: `b${NUL}c`, title: "Child of Two", collapsed: false, subjects: [] }],
      },
    ],
  };
  const store = storeWith([destination], "vault-local");
  const plan = createPortfolioImportPlan(store, bundle, [{
    sourceBaseId: "base-source",
    destination: { kind: "existing", baseId: "base-destination" },
    mode: "replace",
  }], { now: 1_700_000_000_800 });

  const removed = plan.diff.headingsRemove;
  assert.ok(removed.some((line) => line.includes("Child of One")), "the first crafted child keeps its own preview key");
  assert.ok(removed.some((line) => line.includes("Child of Two")), "a crafted sibling cannot shadow another node's key");
  assert.ok(removed.some((line) => line.includes("Heading One")), "both crafted headings stay distinct in the preview");
  assert.ok(removed.some((line) => line.includes("Heading Two")), "both crafted headings stay distinct in the preview");
});
