import assert from "node:assert/strict";
import test from "node:test";
import { calculateModalViewportLayout } from "../src/modals.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import { ExportImportCenterModal, preparePortableExport } from "../src/portability-modal.ts";
import { createPortableExport, EMPTY_PORTABLE_SELECTION } from "../src/portability.ts";
import { migrateData, parseQuery, type VaultRecord } from "../src/model.ts";

function record(path: string, title: string): VaultRecord {
  return {
    path,
    title,
    kind: "topic",
    role: "supporting",
    curriculumId: "",
    domain: "Research",
    topicKind: "Note",
    priority: "",
    reviewStatus: "unverified",
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
    mtime: 0,
    aiLock: false,
  };
}

test("mobile note sheets follow the visual viewport when the keyboard opens", () => {
  assert.deepEqual(calculateModalViewportLayout(844, 844), {
    height: 844,
    keyboardOpen: false,
    shift: 0,
  });
  assert.deepEqual(calculateModalViewportLayout(844, 430, 20), {
    height: 430,
    keyboardOpen: true,
    shift: -187,
  });
});

test("mobile note-sheet viewport values are clamped to the layout viewport", () => {
  assert.deepEqual(calculateModalViewportLayout(600, 900), {
    height: 600,
    keyboardOpen: false,
    shift: 0,
  });
});

test("oversized export preparation never mutates the live portable registry", () => {
  const data = migrateData(null);
  const before = structuredClone(data.portableIndex);
  const records = Array.from({ length: 9_500 }, (_, index) => record(
    `Knowledge Base/Topic ${index}.md`,
    `Topic ${index} ${"x".repeat(980)}`,
  ));

  assert.throws(
    () => preparePortableExport(
      data,
      records,
      { ...EMPTY_PORTABLE_SELECTION, index: true },
      "2026-08-08T00:00:00.000Z",
    ),
    /above the 10 MB/i,
  );
  assert.deepEqual(data.portableIndex, before);
});

test("portability center ignores a second action while an import is busy", async () => {
  let finish: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let starts = 0;
  let renders = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as {
    busyAction: "export" | "import" | "file" | null;
    centerOpen: boolean;
    pendingFocusKey: string | null;
    render(): void;
    run(kind: "export" | "import" | "file", action: () => Promise<void>): void;
  };
  center.busyAction = null;
  center.centerOpen = true;
  center.pendingFocusKey = null;
  center.render = () => { renders += 1; };

  center.run("import", async () => { starts += 1; await gate; });
  center.run("import", async () => { starts += 1; });
  assert.equal(starts, 1);
  assert.equal(center.busyAction, "import");
  finish?.();
  await gate;
  await new Promise<void>((resolve) => { setImmediate(resolve); });

  assert.equal(center.busyAction, null);
  assert.equal(starts, 1);
  assert.equal(renders, 2, "one busy render and one completion render");
});

test("recovery export cannot run without the exact-path confirmation", async () => {
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { isDataReadOnly(): boolean };
    exportSelection: typeof EMPTY_PORTABLE_SELECTION;
    exportRecoveryConfirmed: boolean;
    exportSelected(): Promise<void>;
  };
  center.plugin = { isDataReadOnly: () => false };
  center.exportSelection = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
  center.exportRecoveryConfirmed = false;
  await assert.rejects(center.exportSelected(), /exact private vault paths/i);
});

test("compatibility read-only mode blocks recovery export and import", async () => {
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { isDataReadOnly(): boolean };
    exportSelection: typeof EMPTY_PORTABLE_SELECTION;
    exportRecoveryConfirmed: boolean;
    exportSelected(): Promise<void>;
    importSelected(): Promise<void>;
  };
  center.plugin = { isDataReadOnly: () => true };
  center.exportSelection = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
  center.exportRecoveryConfirmed = true;

  await assert.rejects(center.exportSelected(), /recovery is unavailable.*read-only/i);
  await assert.rejects(center.importSelected(), /import is unavailable.*read-only/i);
});

test("template fallback stays transactional and does not mutate the selected import package", async () => {
  const data = migrateData(null);
  data.settings.defaultNewNoteMode = "template";
  data.settings.templatesFolder = "Templates";
  data.settings.defaultTemplatePath = "Templates/Missing.md";
  const value = createPortableExport(
    data,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-08T00:00:00.000Z",
  );
  const originalPackage = structuredClone(value);
  const localData = migrateData(null);
  const originalLocalData = structuredClone(localData);
  let fallbackObservedInsideMutation = false;
  const plugin = {
    data: localData,
    isDataReadOnly(): boolean { return false; },
    async mutate(_label: string, action: () => void): Promise<void> {
      const before = structuredClone(this.data);
      action();
      fallbackObservedInsideMutation = this.data.settings.defaultNewNoteMode === "empty"
        && this.data.settings.defaultTemplatePath === "";
      this.data = before;
      throw new Error("simulated save failure");
    },
    invalidateRecordCache(): void {},
    getRecords(): VaultRecord[] { return []; },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: { vault: { configDir: string; getAbstractFileByPath(path: string): null } };
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    dataChanged: boolean;
    importSelected(): Promise<void>;
  };
  center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.dataChanged = false;

  await assert.rejects(center.importSelected(), /simulated save failure/);
  assert.equal(fallbackObservedInsideMutation, true);
  assert.deepEqual(value, originalPackage);
  assert.deepEqual(plugin.data, originalLocalData);
});

test("Index Manager refreshes stale state after a child portability mutation", () => {
  let renders = 0;
  let title = "";
  const manager = Object.create(IndexManagerModal.prototype) as {
    managerOpen: boolean;
    searchTimer: number | null;
    query: string;
    selected: Set<string>;
    diagnosticsCache: unknown[] | null;
    tab: "indexed" | "available" | "hidden" | "groups" | "diagnostics";
    plugin: { isClinicalMode(): boolean; data: { settings: { indexLabel: string } } };
    titleEl: { setText(value: string): void };
    render(): void;
    refreshAfterPortability(dataChanged: boolean): void;
  };
  manager.managerOpen = true;
  manager.searchTimer = null;
  manager.query = "stale";
  manager.selected = new Set(["Old.md"]);
  manager.diagnosticsCache = [{}];
  manager.tab = "available";
  manager.plugin = {
    isClinicalMode: () => true,
    data: { settings: { indexLabel: "Clinical Index" } },
  };
  manager.titleEl = { setText: (value) => { title = value; } };
  manager.render = () => { renders += 1; };

  manager.refreshAfterPortability(true);
  assert.equal(manager.query, "");
  assert.equal(manager.selected.size, 0);
  assert.equal(manager.diagnosticsCache, null);
  assert.equal(manager.tab, "indexed");
  assert.equal(title, "Manage Clinical Index");
  assert.equal(renders, 1);

  manager.managerOpen = false;
  manager.refreshAfterPortability(true);
  assert.equal(renders, 1, "a closed parent modal is never re-rendered");
});

test("bulk collection actions use current search text during the render debounce", () => {
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    query: string;
    parsedQuery: ReturnType<typeof parseQuery>;
    records: VaultRecord[];
    plugin: { data: { activeTab: string } };
    matchingRecordsForCurrentView(): VaultRecord[];
  };
  view.query = "beta";
  view.parsedQuery = parseQuery("alpha");
  view.records = [record("KB/alpha.md", "Alpha"), record("KB/beta.md", "Beta")];
  view.plugin = { data: { activeTab: "curriculum" } };

  assert.deepEqual(view.matchingRecordsForCurrentView().map((item) => item.title), ["Beta"]);
});

test("closing the view waits for a pending selection save", async () => {
  let finishSave: (() => void) | null = null;
  let saveFinished = false;
  const saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
  const cleared: number[] = [];
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    setupTimer: number | null;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    timerWindow: { clearTimeout(timer: number): void };
    plugin: { savePluginData(): Promise<void> };
    onClose(): Promise<void>;
  };
  view.setupTimer = 1;
  view.searchDebounce = 2;
  view.selectionSaveTimer = 3;
  view.timerWindow = { clearTimeout: (timer) => { cleared.push(timer); } };
  view.plugin = {
    savePluginData: async () => {
      await saveGate;
      saveFinished = true;
    },
  };

  const closing = view.onClose();
  await Promise.resolve();
  assert.equal(saveFinished, false);
  finishSave?.();
  await closing;

  assert.equal(saveFinished, true);
  assert.deepEqual(cleared, [1, 2, 3]);
  assert.equal(view.selectionSaveTimer, null);
});

test("closing the view also waits for a selection save already in flight", async () => {
  let finishSave: (() => void) | null = null;
  let closeFinished = false;
  const inFlight = new Promise<void>((resolve) => { finishSave = resolve; });
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    setupTimer: number | null;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    selectionSavePromise: Promise<void> | null;
    timerWindow: { clearTimeout(timer: number): void };
    plugin: { savePluginData(): Promise<void> };
    onClose(): Promise<void>;
  };
  view.setupTimer = null;
  view.searchDebounce = null;
  view.selectionSaveTimer = null;
  view.selectionSavePromise = inFlight;
  view.timerWindow = { clearTimeout: () => {} };
  view.plugin = { savePluginData: () => Promise.resolve() };

  const closing = view.onClose().then(() => { closeFinished = true; });
  await Promise.resolve();
  assert.equal(closeFinished, false);
  finishSave?.();
  await closing;
  assert.equal(closeFinished, true);
});

test("closing the compact record inspector hides it and restores row focus", () => {
  let focusCount = 0;
  let renderCount = 0;
  const selected = { focus: (_options?: FocusOptions) => { focusCount += 1; } };
  const workspace = { scrollTop: 0 };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    mobileInspectorNeedsFocus: boolean;
    mobileTreeScrollTop: number;
    workspaceEl: typeof workspace;
    treeEl: { querySelector(): typeof selected; focus(options?: FocusOptions): void };
    timerWindow: { setTimeout(callback: () => void): number };
    render(): void;
    closeMobileInspector(): void;
  };
  view.mobileInspectorOpen = true;
  view.mobileInspectorNeedsFocus = true;
  view.mobileTreeScrollTop = 73;
  view.workspaceEl = workspace;
  view.treeEl = { querySelector: () => selected, focus: () => { focusCount += 1; } };
  view.render = () => { renderCount += 1; };
  view.timerWindow = { setTimeout: (callback) => { callback(); return 1; } };

  view.closeMobileInspector();

  assert.equal(view.mobileInspectorOpen, false);
  assert.equal(view.mobileInspectorNeedsFocus, false);
  assert.equal(renderCount, 1);
  assert.equal(workspace.scrollTop, 73);
  assert.equal(focusCount, 1);
});

test("compact record inspector traps forward focus at its last control", () => {
  let firstFocusCount = 0;
  let prevented = false;
  const first = { offsetParent: {}, focus: () => { firstFocusCount += 1; } };
  const last = { offsetParent: {}, focus: () => {} };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    inspectorEl: {
      ownerDocument: { activeElement: typeof last };
      querySelectorAll(): Array<typeof first | typeof last>;
      contains(): boolean;
    };
    contentEl: { ownerDocument: { defaultView: { matchMedia(): { matches: boolean } } } };
    handleMobileInspectorKeydown(event: { key: string; shiftKey: boolean; preventDefault(): void }): void;
  };
  view.mobileInspectorOpen = true;
  view.contentEl = { ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } };
  view.inspectorEl = {
    ownerDocument: { activeElement: last },
    querySelectorAll: () => [first, last],
    contains: () => true,
  };

  view.handleMobileInspectorKeydown({
    key: "Tab",
    shiftKey: false,
    preventDefault: () => { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(firstFocusCount, 1);
});

test("compact record inspector traps backward focus at its first control", () => {
  let lastFocusCount = 0;
  let prevented = false;
  const first = { offsetParent: {}, focus: () => {} };
  const last = { offsetParent: {}, focus: () => { lastFocusCount += 1; } };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    inspectorEl: {
      ownerDocument: { activeElement: typeof first };
      querySelectorAll(): Array<typeof first | typeof last>;
      contains(): boolean;
    };
    contentEl: { ownerDocument: { defaultView: { matchMedia(): { matches: boolean } } } };
    handleMobileInspectorKeydown(event: { key: string; shiftKey: boolean; preventDefault(): void }): void;
  };
  view.mobileInspectorOpen = true;
  view.contentEl = { ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } };
  view.inspectorEl = {
    ownerDocument: { activeElement: first },
    querySelectorAll: () => [first, last],
    contains: () => true,
  };

  view.handleMobileInspectorKeydown({
    key: "Tab",
    shiftKey: true,
    preventDefault: () => { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(lastFocusCount, 1);
});
