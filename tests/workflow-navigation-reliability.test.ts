import assert from "node:assert/strict";
import test from "node:test";
import { Menu, Notice, Setting } from "obsidian";
import Plugin from "../src/main.ts";
import { ConfirmModal } from "../src/modals.ts";
import { buildCurriculumTree, cleanSearchViewFilters, createDefaultStore, createKnowledgeBaseEntry, migrateData, parseQuery, type LayoutHeading, type LayoutSubheading, type VaultRecord } from "../src/model.ts";
import { parseKbccReturnRoute } from "../src/kbcc-return-navigation.ts";
import { applyPortableExport, createPortableExport, EMPTY_PORTABLE_SELECTION, parsePortableExport } from "../src/portability.ts";
import { collectionSearchPaths, type KnowledgeBaseSearchSource } from "../src/search.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

function record(path: string, isPlaceholder = false): VaultRecord {
  return {
    path, title: "Example", kind: "topic", role: "supporting", curriculumId: "", domain: "Research", topicKind: "Note",
    priority: "", reviewStatus: "unverified", synthesisStatus: "", autoresearchStatus: "", safetyCritical: false,
    sourceCount: 0, aliases: [], relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "", sourceCoverage: "",
    folderOrder: "", mtime: 0, aiLock: false, ...(isPlaceholder ? { isPlaceholder } : {}),
  };
}

function pluginFixture() {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.setupComplete = true;
  const store = createDefaultStore(data, 1, "navigation-reliability-vault");
  store.bases.push(createKnowledgeBaseEntry(migrateData(data), "second", 2));
  const firstId = store.activeBaseId;
  const records = [record("Notes/A.md"), record("Notes/B.md"), record("kbcc-placeholder:c", true)];
  const plugin = new Plugin({ vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } as never, {} as never);
  Object.assign(plugin, { store, data: store.bases[0].data, recordsCacheByBase: new Map([[firstId, records], ["second", records]]) });
  return { plugin, data: plugin.data, store, firstId, records };
}

test("collection searches include nested members, intersect availability, and fail closed after deletion", async () => {
  const { plugin, data, firstId, records } = pluginFixture();
  data.collections = [{ id: "reading", title: "Reading", collapsed: false, subjects: [records[0].path], subheadings: [
    { id: "nested", title: "Nested", collapsed: false, subjects: [], subheadings: [
      { id: "deep", title: "Deep", collapsed: false, subjects: [records[2].path, records[0].path] },
    ] },
  ] }];
  assert.deepEqual([...collectionSearchPaths(data, "reading")], [records[0].path, records[2].path]);
  const options = { baseIds: [firstId], collectionId: "reading" };
  assert.equal((await plugin.searchKnowledgeBases("", options))?.total, 2);
  assert.equal((await plugin.searchKnowledgeBases("example", { ...options, availability: "linked" }))?.total, 1);
  assert.equal((await plugin.searchKnowledgeBases("", { ...options, availability: "placeholders" }))?.groups[0]?.records[0]?.path, records[2].path);
  assert.equal((await plugin.searchKnowledgeBases("", { ...options, linkedFirst: true, limit: 1 }))?.groups[0]?.records[0]?.path, records[0].path);
  data.collections = [];
  assert.equal((await plugin.searchKnowledgeBases("", options))?.total, 0);
  assert.equal((await plugin.searchKnowledgeBases("", { ...options, collectionId: "" }))?.total, 0);
  assert.equal((await plugin.searchKnowledgeBases("", { baseIds: [firstId] }))?.total, 3, "filtered searches never contaminate cached records");
});

test("collection scope persists through saved-view and return-route normalization without widening invalid identities", () => {
  const filters = { scope: "collection" as const, collectionId: "_قراءة", availability: "linked" as const, linkedFirst: true };
  assert.deepEqual(cleanSearchViewFilters(filters), filters);
  for (const collectionId of ["", "__proto__", "x\u0000", "x".repeat(4097), 2]) {
    assert.deepEqual(cleanSearchViewFilters({ scope: "collection", collectionId }), { scope: "collection" });
  }
  const data = migrateData(null);
  data.savedViews = [{ id: "reading-view", name: "Reading", tab: "collections", query: "example", ...filters }];
  assert.deepEqual(migrateData(data).savedViews, data.savedViews);
  const bundle = createPortableExport(data, [], { ...EMPTY_PORTABLE_SELECTION, savedViews: true }, { name: "Filtered views" });
  assert.deepEqual(parsePortableExport(bundle).components.savedViews?.views, data.savedViews);
  const route = parseKbccReturnRoute({ notePath: "Notes/A.md", baseId: "base-a", capturedAt: 1, view: {
    ...filters, activeTab: "collections", selectedPath: "Notes/A.md", query: "", detailVisible: false,
    browseRowLimit: 300, browseStructureLimit: 300, listScrollTop: 0, detailScrollTop: 0,
  } });
  assert.equal(route.view.collectionId, filters.collectionId);
  assert.equal(route.view.scope, "collection");
});

test("opening another base's result preserves complete query and queryless filters through the real reload", async () => {
  for (const query of ["example", ""]) {
    const { plugin, data, store, firstId, records } = pluginFixture();
    const view = Object.create(EntVaultCommandCenterView.prototype) as {
      query: string; searchScope: string; searchAvailability: string; searchLinkedFirst: boolean; loadedBaseId: string;
      reload(): Promise<void>; hasGlobalSearch(): boolean;
      activateSearchResult(source: KnowledgeBaseSearchSource, record: VaultRecord, action: "select"): Promise<void>;
    };
    let renders = 0;
    let selected = "";
    Object.assign(view, { plugin, loadedBaseId: firstId, loadedDataEpoch: 0, query, parsedQuery: parseQuery(query),
      searchScope: "all", searchAvailability: "linked", searchLinkedFirst: true, searchDebounce: null, selectionSaveTimer: null,
      globalSearchRequestGeneration: 0, render: () => { renders += 1; }, selectRecord: (path: string) => { selected = path; },
      timerWindow: { clearTimeout: () => undefined },
    });
    Object.assign(plugin, {
      reconcileRecords: async () => false,
      switchKnowledgeBase: async (baseId: string) => {
        store.activeBaseId = baseId;
        plugin.data = store.bases.find((base) => base.id === baseId)!.data;
        await view.reload();
        assert.equal(view.query, "", "production reload really clears the previous base's query");
        assert.equal(view.searchAvailability, "all", "production reload really clears previous filters");
      },
    });
    await view.activateSearchResult({ baseId: "second", baseName: "Second", data }, records[0], "select");
    assert.equal(view.loadedBaseId, "second");
    assert.equal(renders, 2);
    assert.equal(view.query, query);
    assert.equal(view.searchScope, "all");
    assert.equal(view.searchAvailability, "linked");
    assert.equal(view.searchLinkedFirst, true);
    assert.equal(view.hasGlobalSearch(), true);
    assert.equal(selected, records[0].path);
  }
});

test("portable collection filters import only with an unchanged, selected collection dependency", () => {
  const source = migrateData(null);
  source.collections = [{ id: "reading", title: "Reading", collapsed: false, subjects: [], subheadings: [] }];
  source.savedViews = [{ id: "reading-view", name: "Reading search", tab: "collections", query: "", scope: "collection", collectionId: "reading" }];
  const selection = { ...EMPTY_PORTABLE_SELECTION, collections: true, savedViews: true };
  const bundle = parsePortableExport(createPortableExport(source, [], selection, { name: "Reading collection" }));
  const unchanged = migrateData(null);
  assert.equal(applyPortableExport(unchanged, bundle, selection, "merge").importedViews, 1);
  assert.equal(unchanged.savedViews[0].collectionId, "reading");
  const noDependency = migrateData(null);
  assert.equal(applyPortableExport(noDependency, bundle, { ...selection, collections: false }, "merge").importedViews, 0);
  const collision = migrateData(null);
  collision.collections = [{ id: "reading", title: "Unrelated", collapsed: false, subjects: [], subheadings: [] }];
  assert.equal(applyPortableExport(collision, bundle, selection, "merge").importedViews, 0);
  assert.equal(collision.savedViews.length, 0);
  assert.ok(collision.collections.some((heading) => heading.title === "Reading" && heading.id !== "reading"));
});

test("starting and restoring collection searches keeps the exact scope on bulk toolbar actions", () => {
  const { plugin, data, firstId, records } = pluginFixture();
  data.collections = [{ id: "reading", title: "Reading", collapsed: false, subjects: [records[0].path], subheadings: [] }];
  const dom = createFakeDom();
  const content = dom.document.body.createDiv();
  const input = content.createDiv({ cls: "ent-cc-search-box" }).createEl("input", { type: "search" });
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    searchCollectionId: string; searchScope: string; query: string;
    startCollectionSearch(id: string): void; currentSearchFilters(): object; restoreSearchFilters(filters: object, tab: string): void;
    matchingRecordsForCurrentView(): VaultRecord[]; globalSearchKey(): string; globalSearchScopeKey(): string;
  };
  Object.assign(view, { plugin, contentEl: asHtmlElement(content), loadedBaseId: firstId, loadedDataEpoch: 0, records,
    query: "old query", searchAvailability: "linked", searchLinkedFirst: true, render: () => undefined,
  });
  view.startCollectionSearch("reading");
  assert.equal(view.query, "");
  assert.equal(dom.document.activeElement, input);
  assert.deepEqual(view.currentSearchFilters(), { scope: "collection", collectionId: "reading", availability: "linked", linkedFirst: true });
  assert.deepEqual(view.matchingRecordsForCurrentView().map((item) => item.path), [records[0].path]);
  const key = view.globalSearchKey();
  const scopeKey = view.globalSearchScopeKey();
  view.restoreSearchFilters({ scope: "collection", collectionId: "missing" }, "collections");
  assert.notEqual(view.globalSearchKey(), key);
  assert.notEqual(view.globalSearchScopeKey(), scopeKey);
  assert.deepEqual(view.matchingRecordsForCurrentView(), [], "a missing saved destination cannot broaden a bulk operation");
  view.restoreSearchFilters({}, "collections");
  assert.equal(view.searchCollectionId, "");
});

test("queue browsing hides empty groups until an accessible ephemeral toggle is selected", () => {
  const { plugin, records } = pluginFixture();
  const dom = createFakeDom();
  const parent = dom.document.body.createDiv();
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    showEmptyQueues: boolean; renderQueues(parent: HTMLElement): number;
  };
  let renders = 0;
  Object.assign(view, { plugin, collapsedQueues: new Set(), query: "", parsedQuery: parseQuery(""),
    browseRowLimit: 300, browseStructureLimit: 300, browseStructuresRendered: 0, browseRowsRendered: 0,
    smartQueues: () => [
      { id: "empty", title: "Empty queue", description: "Empty description", records: [] },
      { id: "active", title: "Active queue", description: "Active description", records },
    ], renderBrowseRecordRow: () => undefined, renderTree: () => { renders += 1; },
  });
  assert.equal(view.renderQueues(asHtmlElement(parent)), 3);
  assert.equal(parent.querySelectorAll(".ent-cc-queue").length, 1);
  const toggle = parent.querySelector(".ent-cc-queue-empty-toggle");
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.getAttribute("type"), "button");
  toggle.click();
  assert.equal(renders, 1);
  assert.equal(view.showEmptyQueues, true);
  parent.empty();
  view.renderQueues(asHtmlElement(parent));
  assert.equal(parent.querySelectorAll(".ent-cc-queue").length, 2);
  assert.equal(parent.querySelector(".ent-cc-queue-empty-toggle")?.getAttribute("aria-pressed"), "true");
  parent.querySelector(".ent-cc-queue-empty-toggle")?.click();
  assert.equal(view.showEmptyQueues, false);
});

function captureMenuAndConfirm() {
  const entries: Array<{ title: string; click?: () => void }> = [];
  const confirmations: Array<{ onConfirm(): Promise<void> }> = [];
  const descriptors = ["addItem", "addSeparator", "showAtMouseEvent"].map((key) => [key, Object.getOwnPropertyDescriptor(Menu.prototype, key)] as const);
  const openDescriptor = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  Object.defineProperty(Menu.prototype, "addItem", { configurable: true, value(configure: (item: unknown) => void) {
    const entry: typeof entries[number] = { title: "" };
    const item = { setTitle(title: string) { entry.title = title; return item; }, setIcon() { return item; }, setDisabled() { return item; }, onClick(click: () => void) { entry.click = click; return item; } };
    configure(item); entries.push(entry); return this;
  } });
  for (const key of ["addSeparator", "showAtMouseEvent"]) Object.defineProperty(Menu.prototype, key, { configurable: true, value() { return this; } });
  Object.defineProperty(ConfirmModal.prototype, "open", { configurable: true, value() { confirmations.push(this); } });
  return { entries, confirmations, restore() {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, key, descriptor); else Reflect.deleteProperty(Menu.prototype, key);
    }
    if (openDescriptor) Object.defineProperty(ConfirmModal.prototype, "open", openDescriptor); else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  } };
}

test("destructive collection and arrangement confirmations refuse oversized real Undo before modifying data", async () => {
  const { plugin, data, firstId } = pluginFixture();
  data.collections = [{ id: "large", title: "Large", collapsed: false,
    subjects: Array.from({ length: 12_000 }, (_, index) => `Notes/${String(index).padStart(5, "0")}-${"long".repeat(14)}.md`),
    subheadings: [{ id: "child", title: "Child", collapsed: false, subjects: ["Notes/Child.md"] }],
  }];
  data.curriculumVisual.parentByPath = { "Notes/Child.md": "Notes/Parent.md" };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    showHeadingMenu(event: MouseEvent, heading: LayoutHeading): void;
    showSubheadingMenu(event: MouseEvent, heading: LayoutHeading, subheading: LayoutSubheading): void;
    showGlobalMenu(event: MouseEvent): void;
  };
  Object.assign(view, { plugin, app: {}, records: [], loadedBaseId: firstId, loadedDataEpoch: 0, unresolvedPlaceholderQueue: () => ({ total: 0 }) });
  const capture = captureMenuAndConfirm();
  let saves = 0;
  Object.assign(plugin, { savePluginDataOperation: async () => { saves += 1; } });
  const before = structuredClone(data);
  const actions = [
    ["Delete collection", () => view.showHeadingMenu({} as MouseEvent, data.collections[0])],
    ["Remove subheading", () => view.showSubheadingMenu({} as MouseEvent, data.collections[0], data.collections[0].subheadings[0])],
    ["Clear my collections", () => { data.activeTab = "collections"; view.showGlobalMenu({} as MouseEvent); }],
    [`Reset all visual ${data.settings.indexLabel.toLowerCase()} arrangement`, () => { data.activeTab = "curriculum"; view.showGlobalMenu({} as MouseEvent); }],
  ] as const;
  try {
    for (const [title, show] of actions) {
      capture.entries.length = 0;
      show();
      const action = capture.entries.find((entry) => entry.title === title);
      assert.ok(action, title);
      action.click?.();
      assert.deepEqual(data.collections, before.collections, "opening confirmation never mutates");
      const confirmation = capture.confirmations.pop();
      assert.ok(confirmation);
      await assert.rejects(confirmation.onConfirm(), /too large for safe in-plugin Undo/);
      assert.deepEqual(data.collections, before.collections, title);
      assert.deepEqual(data.curriculumVisual, before.curriculumVisual, title);
      assert.deepEqual(data.undoStack, [], title);
      assert.equal(saves, 0, title);
    }
  } finally { capture.restore(); }
});

test("confirmation keeps its dialog open and presents required-Undo failures", async () => {
  const dom = createFakeDom();
  const callbacks: Array<() => Promise<void> | void> = [];
  const descriptor = Object.getOwnPropertyDescriptor(Setting.prototype, "addButton");
  Object.defineProperty(Setting.prototype, "addButton", { configurable: true, value(configure: (button: unknown) => void) {
    const button = { setButtonText() { return button; }, setDestructive() { return button; }, onClick(callback: () => Promise<void> | void) { callbacks.push(callback); return button; } };
    configure(button); return this;
  } });
  const modal = new ConfirmModal({} as never, "Delete collection?", "Undo remains available.", "Delete", async () => { throw new Error("This change is too large for safe in-plugin Undo."); });
  let closed = false;
  Object.assign(modal, { contentEl: asHtmlElement(dom.document.body.createDiv()), titleEl: asHtmlElement(dom.document.body.createDiv()), close: () => { closed = true; } });
  Notice.messages.length = 0;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    modal.onOpen();
    await callbacks[1]();
    assert.equal(closed, false);
    assert.match(Notice.messages.at(-1) ?? "", /too large for safe in-plugin Undo/);
  } finally {
    console.error = originalError;
    if (descriptor) Object.defineProperty(Setting.prototype, "addButton", descriptor); else Reflect.deleteProperty(Setting.prototype, "addButton");
  }
});

test("individual removal, reparent, desktop drag, and visual reset paths all require safe Undo", async () => {
  const { plugin, data, firstId, records } = pluginFixture();
  data.collections = [{ id: "reading", title: "Reading", collapsed: false,
    subjects: Array.from({ length: 12_000 }, (_, index) => `Notes/${index}-${"long".repeat(14)}.md`).concat(records[0].path),
    subheadings: [
      { id: "child", title: "Child", collapsed: false, subjects: [records[1].path] },
      { id: "destination", title: "Destination", collapsed: false, subjects: [] },
    ],
  }];
  data.curriculumVisual.parentByPath = { [records[0].path]: records[1].path };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    showRecordMenu(event: MouseEvent, record: VaultRecord, membership: { headingId: string }): void;
    resetCurriculumRecord(record: VaultRecord): void;
    moveCurriculumRecord(record: VaultRecord, parent: string | null, siblings: string[], index: number, label: string): Promise<void>;
    moveIndexRecordToGroup(record: VaultRecord, group: string, parent: null, siblings: string[], index: number, label: string): Promise<void>;
    reparentSubheading(libraryId: null, headingId: string, subheadingId: string, destinationId: string): Promise<void>;
    applyDrop(element: HTMLElement, target: { headingId: string; subheadingId?: string }): void;
    applyRowDrop(element: HTMLElement, target: { headingId: string; subheadingId?: string }, path: string): void;
  };
  let pending = Promise.resolve<unknown>(undefined);
  Object.assign(view, { plugin, app: {}, loadedBaseId: firstId, loadedDataEpoch: 0, recordByPath: new Map(records.map((item) => [item.path, item])),
    curriculum: buildCurriculumTree(records, data.curriculumVisual, false), run: (action: () => Promise<unknown>) => { pending = action(); },
  });
  const before = structuredClone(data);
  const capture = captureMenuAndConfirm();
  const dom = createFakeDom();
  const source = { kind: "membership", path: records[0].path, headingId: "reading" };
  const dataTransfer = { getData: () => JSON.stringify(source) } as unknown as DataTransfer;
  try {
    view.showRecordMenu({} as MouseEvent, records[0], { headingId: "reading" });
    const remove = capture.entries.find((entry) => entry.title === "Remove from this collection");
    assert.ok(remove);
    remove.click?.();
    await assert.rejects(pending, /safe in-plugin Undo/);
    view.resetCurriculumRecord(records[0]);
    await assert.rejects(pending, /safe in-plugin Undo/);
    await assert.rejects(view.moveCurriculumRecord(records[0], null, [records[0].path], 0, "Move visual record"), /safe in-plugin Undo/);
    await assert.rejects(view.moveIndexRecordToGroup(records[0], "New group", null, [], 0, "Move group"), /safe in-plugin Undo/);
    await assert.rejects(view.reparentSubheading(null, "reading", "child", "destination"), /safe in-plugin Undo/);
    const target = { headingId: "reading", subheadingId: "child" };
    const drop = dom.document.body.createDiv();
    view.applyDrop(asHtmlElement(drop), target);
    drop.dispatch("drop", { dataTransfer });
    await assert.rejects(pending, /safe in-plugin Undo/);
    const row = dom.document.body.createDiv();
    view.applyRowDrop(asHtmlElement(row), target, records[1].path);
    row.dispatch("drop", { dataTransfer });
    await assert.rejects(pending, /safe in-plugin Undo/);
    assert.deepEqual(data, before, "all rejected actions preserve data and history");
  } finally { capture.restore(); }
});

test("a disappeared desktop collection-row destination cannot silently remove the dragged membership", async () => {
  const { plugin, data, records } = pluginFixture();
  data.collections = [{ id: "reading", title: "Reading", collapsed: false, subjects: [records[0].path], subheadings: [] }];
  Object.assign(plugin, { mutate: async (_label: string, action: () => void) => action() });
  let pending = Promise.resolve<unknown>(undefined);
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    applyRowDrop(element: HTMLElement, target: { headingId: string }, path: string): void;
  };
  Object.assign(view, { plugin, run: (action: () => Promise<unknown>) => { pending = action(); } });
  const dom = createFakeDom();
  const row = dom.document.body.createDiv();
  view.applyRowDrop(asHtmlElement(row), { headingId: "removed" }, records[1].path);
  row.dispatch("drop", { dataTransfer: { getData: () => JSON.stringify({ kind: "membership", path: records[0].path, headingId: "reading" }) } as unknown as DataTransfer });
  await assert.rejects(pending, /destination changed/);
  assert.deepEqual(data.collections[0].subjects, [records[0].path]);
});
