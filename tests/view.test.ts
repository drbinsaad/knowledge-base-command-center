import assert from "node:assert/strict";
import test from "node:test";
import { Notice } from "obsidian";
import { calculateModalViewportLayout, ConfirmModal, KnowledgeNoteModal, TextPromptModal, TopicEditorModal } from "../src/modals.ts";
import {
  calculateSearchViewportLayout,
  EntVaultCommandCenterView,
  matchingKnowledgeBaseRecords,
  prepareKnowledgeBaseSearchResults,
  tabDefinitions,
} from "../src/view.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import { ExportImportCenterModal, preparePortableExport } from "../src/portability-modal.ts";
import { createPortableExport, EMPTY_PORTABLE_SELECTION } from "../src/portability.ts";
import { createPersonalBackup, migrateData, parseQuery, type VaultRecord } from "../src/model.ts";
import { collectKnowledgeBaseSearchResults } from "../src/search.ts";
import { EntCommandCenterSettingsTab } from "../src/settings.ts";

function record(path: string, title: string, kind: VaultRecord["kind"] = "topic"): VaultRecord {
  return {
    path,
    title,
    kind,
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

test("generic workspaces expose only the library tabs represented by their records", () => {
  const settings = migrateData(null).settings;
  settings.workspaceMode = "generic";
  const ids = (records: VaultRecord[]): string[] => tabDefinitions(settings, records).map((tab) => tab.id);
  const coreTabs = ["curriculum", "inbox", "collections", "queues"];

  assert.deepEqual(ids([]), coreTabs);
  assert.deepEqual(ids([record("Knowledge Base/Topic.md", "Topic")]), coreTabs);
  assert.deepEqual(ids([record("Portable/Procedure.md", "Procedure", "procedure")]), [...coreTabs, "procedures"]);
  assert.deepEqual(ids([record("Portable/Medication.md", "Medication", "medication")]), [...coreTabs, "medications"]);
  assert.deepEqual(ids([record("Portable/Syndrome.md", "Syndrome", "syndrome")]), [...coreTabs, "syndromes"]);
  assert.deepEqual(ids([
    record("Portable/Procedure.md", "Procedure", "procedure"),
    record("Portable/Medication.md", "Medication", "medication"),
    record("Portable/Syndrome.md", "Syndrome", "syndrome"),
  ]), [...coreTabs, "procedures", "medications", "syndromes"]);
});

test("ENT workspaces keep every clinical library tab visible even when it is empty", () => {
  const settings = migrateData(null).settings;
  settings.workspaceMode = "ent-clinical";

  assert.deepEqual(tabDefinitions(settings, []).map((tab) => tab.id), [
    "curriculum",
    "inbox",
    "collections",
    "queues",
    "procedures",
    "medications",
    "syndromes",
  ]);
});

test("reload returns to the index when the active dynamic library tab no longer exists", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.activeTab = "syndromes";
  let saves = 0;
  let renders = 0;
  const records = [record("Knowledge Base/Topic.md", "Topic")];
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    plugin: {
      data: typeof data;
      getActiveKnowledgeBaseId(): string;
      getDataEpoch(): number;
      getRecords(): VaultRecord[];
      reconcileRecords(records: VaultRecord[]): Promise<boolean>;
      isDataReadOnly(): boolean;
      savePluginData(): Promise<void>;
    };
    render(): void;
    reload(): Promise<void>;
  };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getRecords: () => records,
    reconcileRecords: async () => false,
    isDataReadOnly: () => false,
    savePluginData: async () => { saves += 1; },
  };
  view.render = () => { renders += 1; };

  await view.reload();

  assert.equal(data.activeTab, "curriculum");
  assert.equal(saves, 1);
  assert.equal(renders, 1);
});

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

test("focused mobile search subtracts the iOS keyboard from the command-center height", () => {
  assert.deepEqual(calculateSearchViewportLayout(844, 780, 430, 20, 64), {
    height: 386,
    keyboardInset: 394,
    keyboardOpen: true,
    shift: 0,
  });
  assert.deepEqual(calculateSearchViewportLayout(844, 780, 844), {
    height: 780,
    keyboardInset: 0,
    keyboardOpen: false,
    shift: 0,
  });
  assert.deepEqual(calculateSearchViewportLayout(844, 780, 430, 120, 64), {
    height: 430,
    keyboardInset: 294,
    keyboardOpen: true,
    shift: 56,
  });
});

test("search finds records across every library instead of the last selected tab", () => {
  const records = [
    record("Knowledge Base/Laryngomalacia.md", "Laryngomalacia"),
    record("Procedures/Laryngeal injection.md", "Laryngeal injection", "procedure"),
    record("Syndromes/Stickler syndrome.md", "Stickler syndrome", "syndrome"),
  ];
  const domainOnly = record("Knowledge Base/Voice.md", "Voice assessment");
  domainOnly.domain = "Laryngology";
  records.unshift(domainOnly);

  assert.deepEqual(
    matchingKnowledgeBaseRecords(records, "laryn").map((item) => item.title),
    ["Laryngomalacia", "Laryngeal injection", "Voice assessment"],
  );
});

test("the global result cap keeps a better inactive-base match visible", () => {
  const activeRecords = Array.from({ length: 300 }, (_, index) => record(
    `Active/Laryngeal ${index.toString().padStart(3, "0")}.md`,
    `Laryngeal ${index.toString().padStart(3, "0")}`,
  ));
  const exactInactiveMatch = record("Inactive/Laryn.md", "laryn");

  const results = prepareKnowledgeBaseSearchResults([
    { baseId: "active", baseName: "Active base", records: activeRecords },
    { baseId: "inactive", baseName: "Inactive base", records: [exactInactiveMatch] },
  ], "laryn", 300);

  assert.equal(results.total, 301);
  assert.equal(results.rendered, 300);
  assert.deepEqual(results.groups.map((group) => [group.source.baseId, group.records.length, group.total]), [
    ["active", 299, 300],
    ["inactive", 1, 1],
  ]);
  assert.equal(results.groups[1]?.records[0], exactInactiveMatch);
});

test("cross-base deduplication keeps the first matching copy when an earlier same-path record does not match", () => {
  const missed = record("Shared/Topic.md", "Unrelated title");
  const matched = record("Shared/Topic.md", "Laryngomalacia");

  const results = prepareKnowledgeBaseSearchResults([
    { baseId: "active", baseName: "Active base", records: [missed, matched] },
  ], "laryn");

  assert.equal(results.total, 1);
  assert.equal(results.groups[0]?.records[0], matched);
});

test("bounded cross-base collection counts 250k overlapping matches but retains and sorts only 300", () => {
  const baseCount = 500;
  const recordsPerBase = 500;
  const sources = Array.from({ length: baseCount }, (_, baseIndex) => ({
    source: { baseId: `base-${baseIndex}`, baseName: `Base ${baseIndex}` },
    records: {
      *[Symbol.iterator](): Generator<VaultRecord> {
        for (let recordIndex = 0; recordIndex < recordsPerBase; recordIndex += 1) {
          yield record(
            `Shared/Result ${recordIndex.toString().padStart(3, "0")}.md`,
            `Result ${recordIndex.toString().padStart(3, "0")}`,
          );
        }
      },
    },
  }));

  const results = collectKnowledgeBaseSearchResults(sources, parseQuery("result"), 300);

  assert.equal(results.total, baseCount * recordsPerBase);
  assert.equal(results.counts.length, baseCount);
  assert.equal(results.counts.every(({ total }) => total === recordsPerBase), true);
  assert.equal(results.rendered, 300);
  assert.equal(results.stats.examinedRecords, baseCount * recordsPerBase);
  assert.equal(results.stats.matchedRecords, baseCount * recordsPerBase);
  assert.equal(results.stats.peakRetainedCandidates, 300);
  assert.equal(results.stats.sortedCandidates, 300);
});

test("selecting an inactive-base search result switches bases and restores the global query", async () => {
  const inactiveData = migrateData(null);
  inactiveData.settings.workspaceName = "Inactive base";
  const searchedRecord = record("Inactive/Laryngomalacia.md", "Laryngomalacia");
  let activeBaseId = "active";
  let switchedTo = "";
  let selectedPath = "";
  let renders = 0;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    query: string;
    parsedQuery: ReturnType<typeof parseQuery>;
    plugin: {
      getActiveKnowledgeBaseId(): string;
      switchKnowledgeBase(id: string): Promise<void>;
      getRecord(path: string): VaultRecord | null;
    };
    render(): void;
    selectRecord(path: string): void;
    activateSearchResult(
      source: { baseId: string; baseName: string; data: typeof inactiveData; records: VaultRecord[] },
      record: VaultRecord,
      action: "select",
    ): Promise<void>;
  };
  view.query = "laryn";
  view.parsedQuery = parseQuery(view.query);
  view.plugin = {
    getActiveKnowledgeBaseId: () => activeBaseId,
    switchKnowledgeBase: async (id) => {
      switchedTo = id;
      activeBaseId = id;
      view.query = ""; // Simulate the base-local reload performed by the plugin.
      view.parsedQuery = parseQuery("");
    },
    getRecord: (path) => path === searchedRecord.path ? searchedRecord : null,
  };
  view.render = () => { renders += 1; };
  view.selectRecord = (path) => { selectedPath = path; };

  await view.activateSearchResult({
    baseId: "inactive",
    baseName: "Inactive base",
    data: inactiveData,
    records: [searchedRecord],
  }, searchedRecord, "select");

  assert.equal(switchedTo, "inactive");
  assert.equal(view.query, "laryn");
  assert.deepEqual(view.parsedQuery, parseQuery("laryn"));
  assert.equal(renders, 1);
  assert.equal(selectedPath, searchedRecord.path);
});

test("Index Manager normalizes Arabic variants and indexes manual membership once per projection", () => {
  const manualIndexPaths = ["Knowledge Base/Manual.md"];
  let linearProbes = 0;
  const includes = manualIndexPaths.includes.bind(manualIndexPaths);
  manualIndexPaths.includes = (path, fromIndex) => {
    linearProbes += 1;
    return includes(path, fromIndex);
  };
  const records = [
    record("Knowledge Base/Manual.md", "مستشفى"),
    record("Knowledge Base/Folder.md", "حنجرة"),
  ];
  const manager = Object.create(IndexManagerModal.prototype) as {
    query: string;
    plugin: {
      data: { manualIndexPaths: string[] };
      getIndexRecords(): VaultRecord[];
    };
    indexedNotes(): Array<{ path: string; title: string; meta: string }>;
    filterNotes(notes: Array<{ path: string; title: string; meta: string }>): Array<{ path: string; title: string; meta: string }>;
  };
  manager.plugin = { data: { manualIndexPaths }, getIndexRecords: () => records };

  const notes = manager.indexedNotes();
  assert.match(notes[0]?.meta ?? "", /manual membership/);
  assert.match(notes[1]?.meta ?? "", /folder index/);
  assert.equal(linearProbes, 0);

  manager.query = "مستشفي";
  assert.deepEqual(manager.filterNotes(notes).map((note) => note.path), ["Knowledge Base/Manual.md"]);
  manager.query = "حـنـجـرة";
  assert.deepEqual(manager.filterNotes(notes).map((note) => note.path), ["Knowledge Base/Folder.md"]);
});

test("mobile note-sheet viewport values are clamped to the layout viewport", () => {
  assert.deepEqual(calculateModalViewportLayout(600, 900), {
    height: 600,
    keyboardOpen: false,
    shift: 0,
  });
});

test("topic editor canonical previews use the knowledge base root captured at open", () => {
  let preview = "";
  const modal = Object.create(TopicEditorModal.prototype) as {
    value: {
      title: string;
      domain: string;
      parentPath: string;
      topicKind: string;
      priority: string;
      safetyCritical: boolean;
      curriculumId: string;
      addToCollection: boolean;
    };
    options: {
      mode: "canonical";
      canonicalRoot: string;
      previewDetails?: (value: unknown) => string[];
    };
    previewEl: { setText(value: string): void };
    detailsEl: null;
    updatePreview(): void;
  };
  modal.value = {
    title: "Laryngeal cleft",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P2",
    safetyCritical: false,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  };
  modal.options = { mode: "canonical", canonicalRoot: "ENT Library/Clinical Topics" };
  modal.previewEl = { setText: (value) => { preview = value; } };
  modal.detailsEl = null;

  modal.updatePreview();

  assert.match(preview, /^ENT Library\/Clinical Topics\/03 Laryngology\//);
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
      "vault-ent-main",
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

test("stale modal callbacks close once and never start work in another knowledge base", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-a";
  let closes = 0;
  let starts = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string };
    openedBaseId: string;
    staleBaseNoticeShown: boolean;
    centerOpen: boolean;
    busyAction: "export" | "import" | "file" | null;
    close(): void;
    run(kind: "export" | "import" | "file", action: () => Promise<void>): void;
  };
  center.plugin = { getActiveKnowledgeBaseId: () => activeBaseId };
  center.openedBaseId = "base-a";
  center.staleBaseNoticeShown = false;
  center.centerOpen = true;
  center.busyAction = null;
  center.close = () => { closes += 1; center.centerOpen = false; };

  activeBaseId = "base-b";
  center.run("import", async () => { starts += 1; });
  center.run("import", async () => { starts += 1; });

  assert.equal(starts, 0);
  assert.equal(closes, 1);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("same-base Sync reload invalidates an open portability center before work starts", () => {
  Notice.messages.length = 0;
  let starts = 0;
  let closes = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string; getDataEpoch(): number };
    openedBaseId: string;
    openedDataEpoch: number;
    staleBaseNoticeShown: boolean;
    centerOpen: boolean;
    busyAction: "export" | "import" | "file" | null;
    close(): void;
    run(kind: "export" | "import" | "file", action: () => Promise<void>): void;
  };
  center.plugin = { getActiveKnowledgeBaseId: () => "base-a", getDataEpoch: () => 8 };
  center.openedBaseId = "base-a";
  center.openedDataEpoch = 7;
  center.staleBaseNoticeShown = false;
  center.centerOpen = true;
  center.busyAction = null;
  center.close = () => { closes += 1; center.centerOpen = false; };

  center.run("import", async () => { starts += 1; });
  center.run("export", async () => { starts += 1; });

  assert.equal(starts, 0);
  assert.equal(closes, 1);
  assert.equal(Notice.messages.filter((message) => message.includes("data was reloaded")).length, 1);
});

test("the index manager rejects a stale mutation callback after a base switch", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-b";
  let closes = 0;
  let starts = 0;
  const manager = Object.create(IndexManagerModal.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string };
    openedBaseId: string;
    staleBaseNoticeShown: boolean;
    managerOpen: boolean;
    close(): void;
    run(action: () => Promise<unknown>): void;
  };
  manager.plugin = { getActiveKnowledgeBaseId: () => activeBaseId };
  manager.openedBaseId = "base-a";
  manager.staleBaseNoticeShown = false;
  manager.managerOpen = true;
  manager.close = () => { closes += 1; manager.managerOpen = false; };

  manager.run(async () => { starts += 1; });
  manager.run(async () => { starts += 1; });

  assert.equal(activeBaseId, "base-b");
  assert.equal(starts, 0);
  assert.equal(closes, 1);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("view workflow guards stay bound to the base that opened the picker", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-a";
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string };
    createOpenedBaseGuard(): () => boolean;
  };
  view.plugin = { getActiveKnowledgeBaseId: () => activeBaseId };
  const ownsBase = view.createOpenedBaseGuard();

  assert.equal(ownsBase(), true);
  activeBaseId = "base-b";
  assert.equal(ownsBase(), false);
  assert.equal(ownsBase(), false);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("a guard created by an old A row during the pre-reload B window still owns A", () => {
  Notice.messages.length = 0;
  let mutationsInB = 0;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string; getDataEpoch(): number };
    loadedBaseId: string;
    loadedDataEpoch: number;
    createOpenedBaseGuard(): () => boolean;
  };
  // Plugin state has already switched, but the visible DOM still belongs to A.
  view.plugin = { getActiveKnowledgeBaseId: () => "base-b", getDataEpoch: () => 2 };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;

  const ownsRenderedBase = view.createOpenedBaseGuard();
  if (ownsRenderedBase()) mutationsInB += 1;
  if (ownsRenderedBase()) mutationsInB += 1;

  assert.equal(mutationsInB, 0);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("view and settings guards reject stale same-base objects after a Sync replacement", () => {
  Notice.messages.length = 0;
  let epoch = 1;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string; getDataEpoch(): number };
    createOpenedBaseGuard(): () => boolean;
  };
  view.plugin = { getActiveKnowledgeBaseId: () => "base-a", getDataEpoch: () => epoch };
  const viewGuard = view.createOpenedBaseGuard();
  assert.equal(viewGuard(), true);

  const settingsTab = Object.create(EntCommandCenterSettingsTab.prototype) as {
    host: { getActiveKnowledgeBaseId(): string; getDataEpoch(): number };
    createOpenedBaseGuard(openedBaseId?: string): () => boolean;
  };
  settingsTab.host = { getActiveKnowledgeBaseId: () => "base-a", getDataEpoch: () => epoch };
  const settingsGuard = settingsTab.createOpenedBaseGuard();
  assert.equal(settingsGuard(), true);

  epoch = 2;
  assert.equal(viewGuard(), false);
  assert.equal(settingsGuard(), false);
});

test("stale rendered rows cannot write selection or collapse state into a newly active base", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-b";
  let saves = 0;
  const data = migrateData(null);
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: {
      data: typeof data;
      getActiveKnowledgeBaseId(): string;
      savePluginData(): Promise<void>;
    };
    loadedBaseId: string;
    staleViewNoticeShown: boolean;
    collapsedQueues: Set<string>;
    collapsedCurriculumDomains: Set<string>;
    collapsedCurriculumNodes: Set<string>;
    persistCollapseState(): void;
    selectRecord(path: string): void;
  };
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => activeBaseId,
    savePluginData: async () => { saves += 1; },
  };
  view.loadedBaseId = "base-a";
  view.staleViewNoticeShown = false;
  view.collapsedQueues = new Set(["old-queue"]);
  view.collapsedCurriculumDomains = new Set(["Old domain"]);
  view.collapsedCurriculumNodes = new Set(["Old/Subject.md"]);

  view.persistCollapseState();
  view.selectRecord("Old/Subject.md");

  assert.equal(data.selectedPath, "");
  assert.deepEqual(data.collapsed.curriculumDomains, []);
  assert.equal(saves, 0);
  assert.equal(Notice.messages.filter((message) => message.includes("knowledge base changed")).length, 1);
  activeBaseId = "base-a";
});

test("reload cancels A selection and search timers before adopting B", async () => {
  const dataB = migrateData(null);
  dataB.settings.workspaceName = "Base B";
  const pendingCallbacks = new Map<number, () => void>();
  let savesIntoB = 0;
  let renders = 0;
  const cleared: number[] = [];
  pendingCallbacks.set(41, () => { renders += 100; });
  pendingCallbacks.set(42, () => { savesIntoB += 1; });
  const plugin = {
    data: dataB,
    getActiveKnowledgeBaseId: () => "base-b",
    getDataEpoch: () => 2,
    getRecords: (): VaultRecord[] => [],
    reconcileRecords: async () => false,
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    timerWindow: { clearTimeout(timer: number): void };
    query: string;
    parsedQuery: ReturnType<typeof parseQuery>;
    editMode: boolean;
    curriculumArrangeMode: boolean;
    mobileInspectorOpen: boolean;
    mobileInspectorNeedsFocus: boolean;
    mobileTreeScrollTop: number;
    mobileInspectorScrollTop: number;
    collapsedQueues: Set<string>;
    collapsedCurriculumDomains: Set<string>;
    collapsedCurriculumNodes: Set<string>;
    render(): void;
    reload(): Promise<void>;
  };
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = true;
  view.searchDebounce = 41;
  view.selectionSaveTimer = 42;
  view.timerWindow = {
    clearTimeout: (timer) => {
      cleared.push(timer);
      pendingCallbacks.delete(timer);
    },
  };
  view.query = "stale A search";
  view.parsedQuery = parseQuery(view.query);
  view.editMode = true;
  view.curriculumArrangeMode = true;
  view.mobileInspectorOpen = true;
  view.mobileInspectorNeedsFocus = true;
  view.mobileTreeScrollTop = 100;
  view.mobileInspectorScrollTop = 200;
  view.collapsedQueues = new Set(["A queue"]);
  view.collapsedCurriculumDomains = new Set(["A domain"]);
  view.collapsedCurriculumNodes = new Set(["A note"]);
  view.render = () => { renders += 1; };

  await view.reload();
  for (const callback of pendingCallbacks.values()) callback();

  assert.deepEqual(cleared, [41, 42]);
  assert.equal(pendingCallbacks.size, 0);
  assert.equal(savesIntoB, 0);
  assert.equal(renders, 1, "only reload renders B; the stale search callback never runs");
  assert.equal(view.searchDebounce, null);
  assert.equal(view.selectionSaveTimer, null);
  assert.equal(view.loadedBaseId, "base-b");
  assert.equal(view.loadedDataEpoch, 2);
  assert.equal(view.query, "");
});

test("settings callbacks stay bound to the knowledge base that rendered them", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-a";
  const settingsTab = Object.create(EntCommandCenterSettingsTab.prototype) as {
    host: { getActiveKnowledgeBaseId(): string };
    createOpenedBaseGuard(openedBaseId?: string): () => boolean;
  };
  settingsTab.host = { getActiveKnowledgeBaseId: () => activeBaseId };
  const ownsBase = settingsTab.createOpenedBaseGuard();

  assert.equal(ownsBase(), true);
  activeBaseId = "base-b";
  assert.equal(ownsBase(), false);
  assert.equal(ownsBase(), false);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("a create-note form cannot submit into a different active knowledge base", async () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-a";
  let createCalls = 0;
  let submit: ((value: {
    title: string;
    folder: string;
    mode: "empty";
    templatePath: string;
    addToCollection: boolean;
  }) => void | Promise<void>) | null = null;
  const plugin = {
    data: {
      settings: {
        itemSingular: "note",
        indexLabel: "Index",
        defaultNoteFolder: "Notes",
        defaultNewNoteMode: "empty" as const,
        defaultTemplatePath: "",
      },
    },
    getActiveKnowledgeBaseId: () => activeBaseId,
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    getTemplateFiles: () => [],
    validateGenericNote: () => null,
    async createKnowledgeNote(): Promise<never> {
      createCalls += 1;
      throw new Error("must not run");
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startCreateKnowledgeNote(): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  KnowledgeNoteModal.prototype.open = function openForTest(): void {
    submit = (this as unknown as { options: { onSubmit: typeof submit } }).options.onSubmit;
  };
  try {
    view.startCreateKnowledgeNote();
    activeBaseId = "base-b";
    await submit?.({ title: "Stale", folder: "Notes", mode: "empty", templatePath: "", addToCollection: false });
  } finally {
    delete (KnowledgeNoteModal.prototype as { open?: () => void }).open;
  }

  assert.equal(createCalls, 0);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("an export failure after a base switch never rolls the old registry into the new base", async () => {
  Notice.messages.length = 0;
  const oldData = migrateData(null);
  oldData.settings.workspaceName = "Base A";
  const newData = migrateData(null);
  newData.settings.workspaceName = "Base B";
  newData.portableIndex.groups = [{ id: "base-b-group", title: "Base B heading", order: 0 }];
  const newRegistryBefore = structuredClone(newData.portableIndex);
  let activeBaseId = "base-a";
  let saveCalls = 0;
  const plugin = {
    data: oldData,
    getActiveKnowledgeBaseId: () => activeBaseId,
    isDataReadOnly: () => false,
    getRecords: (): VaultRecord[] => [],
    invalidateRecordCache(): void {},
    async savePluginData(): Promise<void> {
      saveCalls += 1;
      activeBaseId = "base-b";
      this.data = newData;
      throw new Error("forced export save failure");
    },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: typeof plugin;
    exportSelection: typeof EMPTY_PORTABLE_SELECTION;
    exportRecoveryConfirmed: boolean;
    dataChanged: boolean;
    openedBaseId: string;
    staleBaseNoticeShown: boolean;
    centerOpen: boolean;
    close(): void;
    exportSelected(): Promise<void>;
  };
  center.plugin = plugin;
  center.exportSelection = { ...EMPTY_PORTABLE_SELECTION, index: true };
  center.exportRecoveryConfirmed = false;
  center.dataChanged = false;
  center.openedBaseId = "base-a";
  center.staleBaseNoticeShown = false;
  center.centerOpen = true;
  center.close = () => { center.centerOpen = false; };

  await center.exportSelected();

  assert.equal(saveCalls, 1, "no rollback save is attempted against the newly active base");
  assert.deepEqual(newData.portableIndex, newRegistryBefore);
  assert.equal(center.centerOpen, false);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
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

test("portability center rejects cross-vault recovery before mutate starts", async () => {
  const source = migrateData(null);
  source.collections = [{ id: "ent", title: "ENT", collapsed: false, subjects: ["03 Clinical Topics/Larynx.md"], subheadings: [] }];
  const value = createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, recovery: true },
    "2026-08-08T00:00:00.000Z",
    "vault-ent-main-vault",
    "base-ent",
    "ENT",
  );
  const data = migrateData(null);
  data.collections = [{ id: "local", title: "Local", collapsed: false, subjects: [], subheadings: [] }];
  const before = structuredClone(data);
  let mutateCalls = 0;
  const plugin = {
    data,
    isDataReadOnly: () => false,
    getVaultId: () => "vault-my-main-note-kb",
    getActiveKnowledgeBaseId: () => "base-main",
    async mutate(): Promise<void> { mutateCalls += 1; },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    importSelected(): Promise<void>;
  };
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
  center.importMode = "replace";
  center.recoveryConfirmed = true;

  await assert.rejects(center.importSelected(), /different Obsidian vault/i);
  assert.equal(mutateCalls, 0);
  assert.deepEqual(plugin.data, before);
});

test("portability center requires the separate cross-base override before mutate starts", async () => {
  const source = migrateData(null);
  source.settings.workspaceName = "ENT";
  const value = createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, recovery: true },
    "2026-08-08T00:00:00.000Z",
    "vault-shared",
    "base-ent",
    "ENT",
  );
  const data = migrateData(null);
  data.settings.workspaceName = "Research";
  const before = structuredClone(data);
  let mutateCalls = 0;
  const plugin = {
    data,
    isDataReadOnly: () => false,
    getVaultId: () => "vault-shared",
    getActiveKnowledgeBaseId: () => "base-research",
    async mutate(): Promise<void> { mutateCalls += 1; },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    importSelected(): Promise<void>;
  };
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
  center.importMode = "replace";
  center.recoveryConfirmed = true;
  center.crossBaseRecoveryConfirmed = false;

  await assert.rejects(center.importSelected(), /different or unverified source knowledge base/i);
  assert.equal(mutateCalls, 0);
  assert.deepEqual(plugin.data, before);
});

test("direct organization recovery refuses to apply when safe Undo cannot be guaranteed", async () => {
  const data = migrateData(null);
  data.settings.workspaceName = "ENT";
  const backup = createPersonalBackup(
    data,
    "2026-08-08T00:00:00.000Z",
    "vault-shared",
    "base-ent",
    "ENT",
  );
  let mutateOptions: { requireUndo?: boolean } | null = null;
  const plugin = {
    data,
    getVaultId: () => "vault-shared",
    getActiveKnowledgeBaseId: () => "base-ent",
    async mutate(
      _label: string,
      _action: () => void,
      options: { requireUndo?: boolean },
    ): Promise<void> {
      mutateOptions = options;
      if (options.requireUndo) throw new Error("simulated Undo budget refusal");
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: { vault: { getAbstractFileByPath(path: string): null } };
    plugin: typeof plugin;
    confirmOrganizationImport(input: Promise<unknown>, ownsBase: () => boolean): void;
  };
  view.app = { vault: { getAbstractFileByPath: () => null } };
  view.plugin = plugin;
  const opened: Array<{ onConfirm(): void | Promise<void> }> = [];
  const hadOwnOpen = Object.prototype.hasOwnProperty.call(ConfirmModal.prototype, "open");
  const originalOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureConfirm(): void {
    opened.push(this);
  };
  try {
    view.confirmOrganizationImport(Promise.resolve(backup), () => true);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(opened.length, 1, "an exact-base recovery proceeds directly to the final confirmation");
    await assert.rejects(Promise.resolve(opened[0]?.onConfirm()), /Undo budget refusal/i);
    assert.equal(mutateOptions?.requireUndo, true);
  } finally {
    if (hadOwnOpen && originalOpen) Object.defineProperty(ConfirmModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }
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

test("bulk collection actions use current global search text during the render debounce", () => {
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
  view.plugin = { data: { activeTab: "syndromes" } };

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
    selectionSavePromise: Promise<void> | null;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    timerWindow: { clearTimeout(timer: number): void };
    plugin: {
      savePluginData(): Promise<void>;
      getActiveKnowledgeBaseId(): string;
      getDataEpoch(): number;
    };
    onClose(): Promise<void>;
  };
  view.setupTimer = 1;
  view.searchDebounce = 2;
  view.selectionSaveTimer = 3;
  view.selectionSavePromise = null;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.timerWindow = { clearTimeout: (timer) => { cleared.push(timer); } };
  view.plugin = {
    savePluginData: async () => {
      await saveGate;
      saveFinished = true;
    },
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
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

test("mobile search resets both possible result scroll containers", () => {
  const content = { scrollTop: 125 };
  const workspace = { scrollTop: 840 };
  const tree = { scrollTop: 320 };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    contentEl: typeof content;
    workspaceEl: typeof workspace;
    treeEl: typeof tree;
    resetSearchScrollPosition(): void;
  };
  view.contentEl = content;
  view.workspaceEl = workspace;
  view.treeEl = tree;

  view.resetSearchScrollPosition();

  assert.equal(content.scrollTop, 0);
  assert.equal(workspace.scrollTop, 0);
  assert.equal(tree.scrollTop, 0);
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

test("organization snapshots cannot mutate memory or report success in compatibility read-only mode", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  const snapshotsBefore = structuredClone(data.layoutSnapshots);
  let saveCalls = 0;
  let submit: ((name: string) => void | Promise<void>) | null = null;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-default",
    getDataEpoch: () => 7,
    isClinicalMode: () => false,
    isDataReadOnly: () => true,
    assertDataWritable(): never { throw new Error("Organization is read-only for this compatibility test."); },
    async savePluginData(): Promise<void> { saveCalls += 1; },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    saveOrganizationSnapshot(): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-default";
  view.loadedDataEpoch = 7;
  view.staleViewNoticeShown = false;

  TextPromptModal.prototype.open = function openForTest(): void {
    submit = (this as unknown as { options: { onSubmit: typeof submit } }).options.onSubmit;
  };
  try {
    view.saveOrganizationSnapshot();
    assert.ok(submit);
    await assert.rejects(async () => { await submit?.("Blocked snapshot"); }, /read-only/i);
  } finally {
    delete (TextPromptModal.prototype as { open?: () => void }).open;
  }

  assert.deepEqual(data.layoutSnapshots, snapshotsBefore);
  assert.equal(saveCalls, 0);
  assert.equal(Notice.messages.some((message) => /Saved organization snapshot/i.test(message)), false);
});
