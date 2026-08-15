import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MarkdownView, Notice, TFile, TFolder } from "obsidian";
import EntVaultCommandCenterPlugin, { DEVICE_LOCAL_STATE_KEY } from "../src/main";
import {
  createDefaultStore,
  createKnowledgeBaseEntry,
  migrateData,
} from "../src/model";
import type {
  NoteOrganizerDraft,
  OrganizerApplyResult,
  OrganizerBaseOption,
  OrganizerPreparedPlan,
} from "../src/note-organizer-modal";
import type {
  NoteOrganizerSelectedVaultItem,
  NoteOrganizerSelectionSnapshot,
} from "../src/note-organizer-surfaces";
import { asHtmlElement, createFakeDom } from "./support/fake-dom";

interface OrganizerPluginHarness {
  loadedData: unknown;
  loadPluginData(persistMigration?: boolean): Promise<void>;
  noteOrganizerBaseOptions(): OrganizerBaseOption[];
  prepareNoteOrganizer(draft: NoteOrganizerDraft): Promise<OrganizerPreparedPlan>;
  applyPreparedNoteOrganizer(token: unknown): Promise<OrganizerApplyResult>;
  applyNoteOrganizerBatchHistory(direction: "undo" | "redo"): Promise<void>;
  canUndoNoteOrganizerBatch(): boolean;
  canRedoNoteOrganizerBatch(): boolean;
  clearDeviceLocalData(): Promise<void>;
  assertDataWritable(): void;
  commitBaseStoreChange(
    change: () => void | Promise<void>,
    requireUndo?: boolean,
    requiredUndoBatchBaseIds?: readonly string[],
    requiredUndoBatchOperationLabel?: "Note Organizer" | "portfolio import" | "multi-base change",
  ): Promise<void>;
  activateAppWriteBarrier(): void;
  noteOrganizerSelection(selectedItems: readonly NoteOrganizerSelectedVaultItem[]): NoteOrganizerSelectionSnapshot;
  activeNoteOrganizerModal: unknown;
}

function genericBase(name: string, primaryFolder: string) {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.setupComplete = true;
  data.settings.workspaceName = name;
  data.settings.primaryFolder = primaryFolder;
  data.settings.defaultNoteFolder = primaryFolder;
  data.indexGroupOrder = ["General"];
  return data;
}

function organizerApp(files: readonly TFile[]) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [...files],
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
}

test("editor indicator distinguishes organized and neutral notes without relying on color", async () => {
  const file = new TFile("Notes/Airway.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.directIndexPaths = [file.path];
  const view = new MarkdownView();
  view.file = file;
  const dom = createFakeDom();
  const action = asHtmlElement(dom.document.body.createEl("button"));
  let activate: (() => void) | null = null;
  (view as unknown as { addAction(icon: string, label: string, callback: () => void): HTMLElement }).addAction = (
    _icon,
    _label,
    callback,
  ) => {
    activate = callback;
    return action;
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
    },
    workspace: {
      getLeavesOfType: (type: string) => type === "markdown" ? [{ view }] : [],
    },
    metadataCache: { getFileCache: () => ({ frontmatter: { title: "Airway" } }), resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & {
    loadedData: unknown;
    syncNoteOrganizerIndicators(): void;
    invalidateRecordCache(): void;
    openNoteOrganizerMembership(path: string): void;
  };
  plugin.loadedData = createDefaultStore(data, 1, "vault-note-indicator");
  await (plugin as unknown as { loadPluginData(): Promise<void> }).loadPluginData();
  let opened = "";
  plugin.openNoteOrganizerMembership = (path) => { opened = path; };

  plugin.syncNoteOrganizerIndicators();
  assert.equal(action.getAttribute("data-icon"), "circle-check");
  assert.match(action.getAttribute("aria-label") ?? "", /Organized in/u);
  assert.equal(action.classList.contains("ent-cc-note-membership-organized-current"), true);
  activate?.();
  assert.equal(opened, file.path);

  plugin.data.directIndexPaths = [];
  plugin.invalidateRecordCache();
  plugin.syncNoteOrganizerIndicators();
  assert.equal(action.getAttribute("data-icon"), "circle");
  assert.match(action.getAttribute("aria-label") ?? "", /not organized/iu);
  assert.equal(action.classList.contains("ent-cc-note-membership-not-organized"), true);
});

test("editor indicator refreshes coalesce and each visible path is summarized once per sync", async () => {
  const files = [new TFile("Notes/Alpha.md"), new TFile("Notes/Beta.md")];
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.directIndexPaths = files.map((file) => file.path);
  const dom = createFakeDom();
  const views = files.map((file) => {
    const view = new MarkdownView();
    view.file = file;
    (view as unknown as { addAction(icon: string, label: string, callback: () => void): HTMLElement }).addAction = () => (
      asHtmlElement(dom.document.body.createEl("button"))
    );
    return view;
  });
  const byPath = new Map(files.map((file) => [file.path, file]));
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [...files],
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
    },
    workspace: {
      getLeavesOfType: (type: string) => type === "markdown" ? views.map((view) => ({ view })) : [],
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  (plugin as unknown as { loadedData: unknown }).loadedData = createDefaultStore(data, 1, "vault-indicator-cache");
  await (plugin as unknown as { loadPluginData(): Promise<void> }).loadPluginData();
  const originalSummary = plugin.getNoteOrganizerMembershipSummary.bind(plugin);
  const calls = new Map<string, number>();
  plugin.getNoteOrganizerMembershipSummary = (path) => {
    calls.set(path, (calls.get(path) ?? 0) + 1);
    return originalSummary(path);
  };
  const internal = plugin as unknown as {
    syncNoteOrganizerIndicators(): void;
    scheduleNoteOrganizerIndicatorSync(): void;
  };

  internal.syncNoteOrganizerIndicators();
  assert.deepEqual(Object.fromEntries(calls), {
    "Notes/Alpha.md": 1,
    "Notes/Beta.md": 1,
  });
  const alphaFirst = originalSummary(files[0].path);
  originalSummary(files[1].path);
  const alphaAfterBeta = originalSummary(files[0].path);
  assert.equal(alphaAfterBeta, alphaFirst, "multiple visible-note summaries remain in the bounded per-path cache");

  let coalescedSyncs = 0;
  internal.syncNoteOrganizerIndicators = () => { coalescedSyncs += 1; };
  const globalWithWindow = globalThis as typeof globalThis & { window?: unknown };
  const hadWindow = Object.hasOwn(globalWithWindow, "window");
  const previousWindow = globalWithWindow.window;
  const timerWindow = {
    setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  };
  globalWithWindow.window = { activeWindow: timerWindow, ...timerWindow };
  try {
    internal.scheduleNoteOrganizerIndicatorSync();
    internal.scheduleNoteOrganizerIndicatorSync();
    internal.scheduleNoteOrganizerIndicatorSync();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 150));
  } finally {
    if (hadWindow) globalWithWindow.window = previousWindow;
    else delete globalWithWindow.window;
  }
  assert.equal(coalescedSyncs, 1, "rapid layout events collapse into one indicator refresh");
});

test("one reviewed integration transaction organizes two bases and batch Undo/Redo stays atomic", async () => {
  const file = new TFile("Vault/Shared airway.md");
  Object.assign(file.stat, { mtime: 1_000, size: 400 });
  const alpha = genericBase("Zulu active", "Alpha Notes");
  alpha.collections = [{ id: "collection-cases", title: "Cases", collapsed: false, subjects: [], subheadings: [] }];
  const beta = genericBase("Alpha inactive", "Beta Notes");
  beta.portableIndex.libraries.push({
    id: "library-reading",
    name: "Reading",
    singularName: "Reading note",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  });
  beta.portableIndex.libraryLayouts["library-reading"] = [{
    id: "heading-books",
    title: "Books",
    collapsed: false,
    subjects: [],
    subheadings: [],
  }];
  const first = createKnowledgeBaseEntry(alpha, "base-alpha", 100);
  const second = createKnowledgeBaseEntry(beta, "base-beta", 200);
  const store = createDefaultStore(alpha, 1, "vault-note-organizer-integration");
  store.bases = [first, second];
  store.activeBaseId = first.id;

  const app = organizerApp([file]);
  let vaultMutationCalls = 0;
  const unexpectedVaultMutation = async (): Promise<never> => {
    vaultMutationCalls += 1;
    throw new Error("The Note Organizer must not mutate vault files.");
  };
  Object.assign(app.vault, {
    create: unexpectedVaultMutation,
    createFolder: unexpectedVaultMutation,
    modify: unexpectedVaultMutation,
    rename: unexpectedVaultMutation,
    delete: unexpectedVaultMutation,
  });
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  harness.loadedData = store;
  await harness.loadPluginData(false);
  const requiredBatches: string[][] = [];
  const requiredBatchLabels: string[] = [];
  harness.commitBaseStoreChange = async (change, _requireUndo, requiredBaseIds = [], operationLabel = "multi-base change") => {
    await change();
    requiredBatches.push([...requiredBaseIds].sort());
    requiredBatchLabels.push(operationLabel);
  };

  const options = harness.noteOrganizerBaseOptions();
  const alphaOption = options.find((option) => option.id === first.id);
  const betaOption = options.find((option) => option.id === second.id);
  assert.equal(options[0]?.id, first.id);
  assert.equal(alphaOption?.current, true);
  assert.equal(betaOption?.current, false);
  assert.ok(alphaOption?.indexHeadings[0]);
  assert.ok(alphaOption.collections[0]);
  assert.ok(betaOption?.libraries[0]?.headings[0]);
  const draft: NoteOrganizerDraft = {
    version: 1,
    source: "command",
    selectedPaths: [file.path],
    overrides: [],
    destinations: [{
      baseId: first.id,
      primary: {
        mode: "index",
        libraryId: null,
        headingId: alphaOption.indexHeadings[0].id,
        subheadingId: null,
      },
      collections: {
        mode: "add",
        targets: [{ headingId: alphaOption.collections[0].id, subheadingId: null }],
      },
    }, {
      baseId: second.id,
      primary: {
        mode: "library",
        libraryId: betaOption.libraries[0].id,
        headingId: betaOption.libraries[0].headings[0].id,
        subheadingId: null,
      },
      collections: { mode: "keep", targets: [] },
    }],
  };

  const prepared = await harness.prepareNoteOrganizer(draft);
  assert.equal(prepared.errors.length, 0);
  assert.equal(prepared.summary.baseCount, 2);
  const result = await harness.applyPreparedNoteOrganizer(prepared.preparedToken);
  assert.deepEqual(requiredBatches[0], [first.id, second.id]);
  assert.deepEqual([result.changedNotes, result.changedBases], [1, 2]);
  assert.equal(plugin.getActiveKnowledgeBaseId(), first.id, "cross-base organization never switches the active base");
  let [appliedAlpha, appliedBeta] = plugin.getKnowledgeBases();
  assert.equal(appliedAlpha?.data.directIndexPaths.includes(file.path), true);
  const betaOwner = Object.entries(appliedBeta?.data.portableIndex.resolvedPathBySubjectId ?? {})
    .find(([, path]) => path === file.path)?.[0];
  assert.ok(betaOwner);
  assert.equal(appliedBeta?.data.portableIndex.subjects.find((subject) => subject.id === betaOwner)?.libraryId, "library-reading");

  await harness.applyNoteOrganizerBatchHistory("undo");
  [appliedAlpha, appliedBeta] = plugin.getKnowledgeBases();
  assert.equal(appliedAlpha?.data.directIndexPaths.includes(file.path), false);
  assert.equal(Object.values(appliedBeta?.data.portableIndex.resolvedPathBySubjectId ?? {}).includes(file.path), false);
  assert.deepEqual(requiredBatches[1], [first.id, second.id]);

  await harness.applyNoteOrganizerBatchHistory("redo");
  [appliedAlpha, appliedBeta] = plugin.getKnowledgeBases();
  assert.equal(appliedAlpha?.data.directIndexPaths.includes(file.path), true);
  assert.equal(Object.values(appliedBeta?.data.portableIndex.resolvedPathBySubjectId ?? {}).includes(file.path), true);
  assert.deepEqual(requiredBatches[2], [first.id, second.id]);
  assert.deepEqual(requiredBatchLabels, ["Note Organizer", "Note Organizer", "Note Organizer"]);
  assert.equal(vaultMutationCalls, 0, "Apply, multi-base Undo, and Redo change only KBCC plugin data");

  assert.equal(harness.canUndoNoteOrganizerBatch(), true);
  (plugin.getKnowledgeBases()[1] as { semanticRevision: number }).semanticRevision += 1;
  await assert.rejects(
    () => harness.applyNoteOrganizerBatchHistory("undo"),
    /session-wide Note Organizer Undo is no longer available.*each affected knowledge base's own durable Undo/iu,
  );
  assert.equal(harness.canUndoNoteOrganizerBatch(), false, "a stale projection invalidates the permanently failing session token");
  assert.equal(harness.canRedoNoteOrganizerBatch(), false);

  plugin.openNoteOrganizer();
  assert.ok(harness.activeNoteOrganizerModal);
  await harness.clearDeviceLocalData();
  assert.equal(harness.activeNoteOrganizerModal, null, "privacy reset dismisses a review that can no longer persist local Undo");
  assert.equal(harness.canUndoNoteOrganizerBatch(), false, "privacy reset discards the in-memory whole-batch Undo token");
  assert.equal(harness.canRedoNoteOrganizerBatch(), false);
});

test("real Organizer commit persists once, finalizes its bounded batch journal, survives restart, and consumes its token", async () => {
  const file = new TFile("Notes/Persisted airway.md");
  Object.assign(file.stat, { mtime: 2_000, size: 512 });
  const alpha = genericBase("Persistent active", "Alpha Notes");
  const beta = genericBase("Persistent inactive", "Beta Notes");
  const first = createKnowledgeBaseEntry(alpha, "base-persist-alpha", 100);
  const second = createKnowledgeBaseEntry(beta, "base-persist-beta", 200);
  const store = createDefaultStore(alpha, 1, "vault-note-organizer-real-commit");
  store.bases = [first, second];
  store.activeBaseId = first.id;

  const app = organizerApp([file]);
  const localValues = new Map<string, unknown>();
  const backupWrites: Array<{ path: string; value: unknown }> = [];
  Object.assign(app, {
    loadLocalStorage: (key: string) => structuredClone(localValues.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { localValues.set(key, structuredClone(value)); },
  });
  Object.assign(app.vault, {
    adapter: {
      write: async (path: string, content: string) => {
        backupWrites.push({ path, value: JSON.parse(content) as unknown });
      },
    },
  });
  const manifest = { dir: ".obsidian/plugins/knowledge-base-command-center" } as never;
  const plugin = new EntVaultCommandCenterPlugin(app as never, manifest);
  const harness = plugin as unknown as OrganizerPluginHarness;
  const primarySaves: unknown[] = [];
  plugin.saveData = async (value: unknown) => { primarySaves.push(structuredClone(value)); };
  harness.loadedData = store;
  await harness.loadPluginData(false);

  const options = harness.noteOrganizerBaseOptions();
  const destinations = [first, second].map((entry) => {
    const option = options.find((candidate) => candidate.id === entry.id);
    const heading = option?.indexHeadings.find((candidate) => candidate.name === "General");
    assert.ok(heading);
    return {
      baseId: entry.id,
      primary: { mode: "index" as const, libraryId: null, headingId: heading.id, subheadingId: null },
      collections: { mode: "keep" as const, targets: [] },
    };
  });
  const prepared = await harness.prepareNoteOrganizer({
    version: 1,
    source: "command",
    selectedPaths: [file.path],
    overrides: [],
    destinations,
  });
  assert.deepEqual(prepared.errors, []);
  const preparedToken = prepared.preparedToken;

  await harness.applyPreparedNoteOrganizer(preparedToken);

  assert.equal(primarySaves.length, 1, "Organizer Apply reaches the real synced saveData boundary exactly once");
  assert.equal(backupWrites.length, 2, "the committed backup is refreshed before and after the one primary write");
  assert.ok(backupWrites.every((write) => write.path.endsWith("/data.json.bak")));
  const persistedStore = primarySaves[0] as ReturnType<typeof createDefaultStore>;
  for (const baseId of [first.id, second.id]) {
    const persisted = persistedStore.bases.find((entry) => entry.id === baseId);
    assert.equal(persisted?.data.directIndexPaths.includes(file.path), true, "persistSyncedStore writes every reviewed base");
  }
  const finalizedLocal = localValues.get(DEVICE_LOCAL_STATE_KEY) as {
    pendingRequiredUndoBatchCommit?: unknown;
    bases?: Array<{ baseId: string; view: { undoStack: Array<{ label?: string }> } }>;
  } | undefined;
  assert.ok(finalizedLocal);
  assert.equal(finalizedLocal.pendingRequiredUndoBatchCommit, undefined, "the durable pre-commit marker is removed after causal finalization");
  assert.ok(JSON.stringify(finalizedLocal).length < 4 * 1024 * 1024, "the finalized device-local journal remains bounded");
  for (const baseId of [first.id, second.id]) {
    const localBase = finalizedLocal.bases?.find((entry) => entry.baseId === baseId);
    assert.match(localBase?.view.undoStack.at(-1)?.label ?? "", /Organize 1 note across 2 knowledge bases/u);
  }

  const writesAfterFirstApply = {
    primary: primarySaves.length,
    backup: backupWrites.length,
    local: JSON.stringify([...localValues]),
  };
  await assert.rejects(
    () => harness.applyPreparedNoteOrganizer(preparedToken),
    /prepared organizer review is stale or was already used/iu,
  );
  assert.equal(primarySaves.length, writesAfterFirstApply.primary, "reusing a consumed token never reaches saveData");
  assert.equal(backupWrites.length, writesAfterFirstApply.backup, "reusing a consumed token never refreshes the adapter backup");
  assert.equal(JSON.stringify([...localValues]), writesAfterFirstApply.local, "reusing a consumed token never rewrites local history");

  plugin.onunload();
  const restarted = new EntVaultCommandCenterPlugin(app as never, manifest);
  const restartedHarness = restarted as unknown as OrganizerPluginHarness;
  restartedHarness.loadedData = persistedStore;
  await restartedHarness.loadPluginData(false);
  for (const baseId of [first.id, second.id]) {
    const restartedBase = restarted.getKnowledgeBases().find((entry) => entry.id === baseId);
    assert.match(
      restartedBase?.data.undoStack.at(-1)?.label ?? "",
      /Organize 1 note across 2 knowledge bases/u,
      "each affected base retains restart-durable Undo",
    );
  }
  restarted.onunload();
});

test("prepared integration rejects a replaced file before any multi-base commit", async () => {
  const file = new TFile("Vault/Guarded.md");
  Object.assign(file.stat, { mtime: 10, size: 20 });
  const data = genericBase("Guarded", "Guarded Notes");
  const store = createDefaultStore(data, 1, "vault-note-organizer-stale-file");
  const app = organizerApp([file]);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  harness.loadedData = store;
  await harness.loadPluginData(false);
  const option = harness.noteOrganizerBaseOptions()[0];
  assert.ok(option?.indexHeadings[0]);
  const prepared = await harness.prepareNoteOrganizer({
    version: 1,
    source: "command",
    selectedPaths: [file.path],
    overrides: [],
    destinations: [{
      baseId: store.activeBaseId,
      primary: { mode: "index", libraryId: null, headingId: option.indexHeadings[0].id, subheadingId: null },
      collections: { mode: "keep", targets: [] },
    }],
  });
  const replacement = new TFile(file.path);
  Object.assign(replacement.stat, { mtime: 10, size: 20 });
  (app.vault as { getAbstractFileByPath(path: string): TFile | null }).getAbstractFileByPath = () => replacement;
  let commits = 0;
  harness.commitBaseStoreChange = async (change) => { commits += 1; await change(); };
  await assert.rejects(() => harness.applyPreparedNoteOrganizer(prepared.preparedToken), /moved, disappeared, or was replaced/iu);
  assert.equal(commits, 0);
  assert.equal(plugin.getActiveKnowledgeBase().data.directIndexPaths.includes(file.path), false);
});

test("Organizer required-Undo failures consistently identify the Organizer operation", async () => {
  Notice.messages.length = 0;
  const file = new TFile("Notes/Journal.md");
  Object.assign(file.stat, { mtime: 70, size: 80 });
  const data = genericBase("Journal", "Notes");
  const store = createDefaultStore(data, 1, "vault-note-organizer-journal-label");
  const app = organizerApp([file]);
  const localValues = new Map<string, unknown>();
  let deviceStateWrites = 0;
  app.loadLocalStorage = (key: string) => localValues.get(key) ?? null;
  app.saveLocalStorage = (key: string, value: unknown) => {
    if (key === DEVICE_LOCAL_STATE_KEY) {
      deviceStateWrites += 1;
      if (deviceStateWrites > 1) throw new Error("simulated Organizer journal finalization failure");
    }
    localValues.set(key, structuredClone(value));
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  harness.loadedData = store;
  await harness.loadPluginData(false);
  const option = harness.noteOrganizerBaseOptions()[0];
  assert.ok(option?.indexHeadings[0]);
  const prepared = await harness.prepareNoteOrganizer({
    version: 1,
    source: "command",
    selectedPaths: [file.path],
    overrides: [],
    destinations: [{
      baseId: store.activeBaseId,
      primary: { mode: "index", libraryId: null, headingId: option.indexHeadings[0].id, subheadingId: null },
      collections: { mode: "keep", targets: [] },
    }],
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  let result: OrganizerApplyResult;
  try {
    result = await harness.applyPreparedNoteOrganizer(prepared.preparedToken);
  } finally {
    console.error = originalConsoleError;
  }

  const finalizationNotice = Notice.messages.find((message) => /finalization failed/iu.test(message)) ?? "";
  assert.match(finalizationNotice, /Note Organizer change was saved/iu);
  assert.doesNotMatch(finalizationNotice, /portfolio/iu);
  assert.throws(() => harness.assertDataWritable(), /Note Organizer Undo finalization is pending/iu);
  const recovery = plugin.getSyncRecoveryCenterSnapshot();
  assert.match(recovery.readOnlyReason, /committed Note Organizer change.*undo finalization/iu);
  assert.doesNotMatch(recovery.readOnlyReason, /portfolio/iu);
  assert.match(result.message, /device-local Undo finalization is pending.*Restart Obsidian/iu);
  assert.match(result.message, /Session batch Undo is unavailable/iu);
  assert.doesNotMatch(result.message, /Use the note organizer Undo command/iu);
  assert.equal(harness.canUndoNoteOrganizerBatch(), false);
  assert.equal(harness.canRedoNoteOrganizerBatch(), false);
});

test("a cold inactive protected ENT base offers and resolves the canonical source group", async () => {
  const file = new TFile("03 Clinical Topics/Pediatric/Cold topic.md");
  Object.assign(file.stat, { mtime: 25, size: 40 });
  const active = genericBase("Active generic", "Generic Notes");
  const clinical = migrateData(null);
  Object.assign(clinical.settings, {
    setupComplete: true,
    workspaceMode: "ent-clinical",
    workspaceName: "Cold ENT",
    indexLabel: "Curriculum",
    primaryFolder: "03 Clinical Topics",
    defaultNoteFolder: "03 Clinical Topics",
    idProperty: "curriculum_id",
    groupProperty: "domain",
    parentProperty: "parent_topic",
    allowClinicalVisualGroupMoves: false,
  });
  clinical.indexGroupOrder = [];
  clinical.indexGroupByPath = {};
  const activeEntry = createKnowledgeBaseEntry(active, "base-active-generic", 100);
  const clinicalEntry = createKnowledgeBaseEntry(clinical, "base-cold-ent", 200);
  const store = createDefaultStore(active, 1, "vault-note-organizer-cold-ent");
  store.bases = [activeEntry, clinicalEntry];
  store.activeBaseId = activeEntry.id;
  const app = organizerApp([file]);
  app.metadataCache.getFileCache = () => ({
    frontmatter: { curriculum_id: "ENT-PED-001", domain: "Pediatric" },
  });
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  harness.loadedData = store;
  await harness.loadPluginData(false);

  const clinicalOption = harness.noteOrganizerBaseOptions().find((option) => option.id === clinicalEntry.id);
  const canonical = clinicalOption?.indexHeadings.find((heading) => heading.sourceDerived);
  assert.ok(canonical);
  assert.equal(canonical.name, "Canonical source group (per note)");
  const prepared = await harness.prepareNoteOrganizer({
    version: 1,
    source: "command",
    selectedPaths: [file.path],
    overrides: [],
    destinations: [{
      baseId: clinicalEntry.id,
      primary: { mode: "index", libraryId: null, headingId: canonical.id, subheadingId: null },
      collections: { mode: "keep", targets: [] },
    }],
  });
  assert.deepEqual(prepared.errors, []);
  assert.equal(prepared.reviewRows.length, 1);
  assert.match(prepared.reviewRows[0]?.after.primary ?? "", /Pediatric/u);
  assert.equal(plugin.getActiveKnowledgeBaseId(), activeEntry.id);
});

test("review discloses when a linked-folder Index note is strengthened into durable direct membership", async () => {
  const file = new TFile("Notes/Linked.md");
  Object.assign(file.stat, { mtime: 50, size: 60 });
  const data = genericBase("Linked source", "Notes");
  data.indexFolderSources = [{ id: "source-notes", path: "Notes", origin: "user" }];
  data.indexGroupByPath[file.path] = "General";
  data.collections = [{ id: "collection-linked", title: "Linked", collapsed: false, subjects: [], subheadings: [] }];
  const store = createDefaultStore(data, 1, "vault-note-organizer-linked-review");
  const plugin = new EntVaultCommandCenterPlugin(organizerApp([file]) as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  harness.loadedData = store;
  await harness.loadPluginData(false);
  const option = harness.noteOrganizerBaseOptions()[0];
  const general = option?.indexHeadings.find((heading) => heading.name === "General");
  assert.ok(general);
  const prepared = await harness.prepareNoteOrganizer({
    version: 1,
    source: "command",
    selectedPaths: [file.path],
    overrides: [],
    destinations: [{
      baseId: store.activeBaseId,
      primary: { mode: "index", libraryId: null, headingId: general.id, subheadingId: null },
      collections: { mode: "keep", targets: [] },
    }],
  });
  assert.equal(prepared.reviewRows[0]?.outcome, "change");
  assert.equal(prepared.reviewRows[0]?.before.primary, prepared.reviewRows[0]?.after.primary);
  assert.match(
    prepared.reviewRows[0]?.warnings?.join(" ") ?? "",
    /durable direct Index membership.*portable KBCC identity/iu,
  );

  const collection = option?.collections[0];
  assert.ok(collection);
  const collectionOnly = await harness.prepareNoteOrganizer({
    version: 1,
    source: "command",
    selectedPaths: [file.path],
    overrides: [],
    destinations: [{
      baseId: store.activeBaseId,
      primary: { mode: "keep", libraryId: null, headingId: null, subheadingId: null },
      collections: { mode: "add", targets: [{ headingId: collection.id, subheadingId: null }] },
    }],
  });
  assert.equal(collectionOnly.reviewRows[0]?.outcome, "change");
  assert.doesNotMatch(collectionOnly.reviewRows[0]?.warnings?.join(" ") ?? "", /direct Index membership/iu);
});

test("a file-only organizer selection does not enumerate a huge vault", () => {
  const file = new TFile("Selected/Only.md");
  const app = organizerApp([file]);
  let enumerations = 0;
  app.vault.getMarkdownFiles = () => {
    enumerations += 1;
    throw new Error("A file-only selection must not enumerate the vault.");
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  const snapshot = harness.noteOrganizerSelection([{ path: file.path, kind: "file" }]);
  assert.deepEqual(snapshot.paths, [file.path]);
  assert.equal(snapshot.complete, true);
  assert.equal(enumerations, 0);
});

test("official single, multi, and folder context menus pass one-time Markdown snapshots", () => {
  const first = new TFile("Folder/A.md");
  const second = new TFile("Folder/B.md");
  const image = new TFile("Folder/image.png");
  const restricted = new TFile(".obsidian/Private.md");
  const folder = new TFolder("Folder", [first, second, image]);
  const callbacks = new Map<string, (...args: never[]) => void>();
  const app = organizerApp([first, second, restricted]);
  Object.assign(app.workspace, {
    on: (event: string, callback: (...args: never[]) => void) => {
      callbacks.set(event, callback);
      return {};
    },
  });
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & {
    registerNoteOrganizerContextMenus(): void;
  };
  const opened: Array<{ paths: readonly string[]; source: string }> = [];
  plugin.openNoteOrganizer = (paths = [], source = "command") => { opened.push({ paths, source }); };
  plugin.registerNoteOrganizerContextMenus();

  const menuSurface = (): {
    menu: unknown;
    actions: Array<{ title: string; click: () => void }>;
  } => {
    const actions: Array<{ title: string; click: () => void }> = [];
    const menu = {
      addSeparator: () => {},
      addItem: (build: (item: unknown) => void) => {
        const action = { title: "", click: () => {} };
        const item = {
          setTitle: (title: string) => { action.title = title; return item; },
          setIcon: () => item,
          setDisabled: () => item,
          onClick: (click: () => void) => { action.click = click; return item; },
        };
        build(item);
        actions.push(action);
      },
    };
    return { menu, actions };
  };
  const invoke = (event: "file-menu" | "files-menu", files: TFile | TFolder | Array<TFile | TFolder>): void => {
    const { menu, actions } = menuSurface();
    callbacks.get(event)?.(menu as never, files as never);
    const organize = actions.find((action) => /Organize/iu.test(action.title));
    assert.ok(organize);
    organize.click();
  };

  invoke("file-menu", folder);
  assert.deepEqual(opened[0], { paths: [first.path, second.path], source: "file-menu" });
  invoke("files-menu", [second, first]);
  assert.deepEqual(opened[1], { paths: [first.path, second.path], source: "files-menu" });
  invoke("file-menu", first);
  assert.deepEqual(opened[2], { paths: [first.path], source: "file-menu" });

  const editor = menuSurface();
  callbacks.get("editor-menu")?.(editor.menu as never, {} as never, { file: second } as never);
  const editorOrganize = editor.actions.find((action) => /Organize/iu.test(action.title));
  assert.ok(editorOrganize);
  editorOrganize.click();
  assert.deepEqual(opened[3], { paths: [second.path], source: "file-menu" });

  const restrictedMenu = menuSurface();
  callbacks.get("file-menu")?.(restrictedMenu.menu as never, restricted as never);
  assert.equal(restrictedMenu.actions.length, 0);
  const imageMenu = menuSurface();
  callbacks.get("file-menu")?.(imageMenu.menu as never, image as never);
  assert.equal(imageMenu.actions.length, 0);
});

test("a changed context-menu snapshot never opens a silent partial selection", async () => {
  Notice.messages.length = 0;
  const first = new TFile("Folder/A.md");
  const second = new TFile("Folder/B.md");
  const available = new Map([[first.path, first], [second.path, second]]);
  const app = organizerApp([first, second]);
  app.vault.getAbstractFileByPath = (path: string) => available.get(path) ?? null;
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  harness.loadedData = createDefaultStore(genericBase("Context", "Folder"), 1, "vault-note-organizer-context");
  await harness.loadPluginData(false);

  plugin.openNoteOrganizer([first.path, second.path], "files-menu");
  const exactModal = harness.activeNoteOrganizerModal as {
    contentEl: HTMLElement;
    dismissImmediately(): void;
    onClose(): void;
  } | null;
  assert.ok(exactModal, "the unchanged exact snapshot opens normally");
  exactModal.dismissImmediately();
  exactModal.contentEl = asHtmlElement(createFakeDom().document.body.createDiv());
  exactModal.onClose(); // The shared Obsidian Modal stub does not dispatch lifecycle callbacks.
  assert.equal(harness.activeNoteOrganizerModal, null);

  available.delete(second.path);
  plugin.openNoteOrganizer([first.path, second.path], "files-menu");
  assert.equal(harness.activeNoteOrganizerModal, null, "a missing snapshot member cannot shrink into a partial review");
  assert.match(Notice.messages.at(-1) ?? "", /selected notes changed, moved, or became unavailable/iu);
});

test("a restricted membership entry point reports the protected-area reason instead of a stale-selection error", async () => {
  Notice.messages.length = 0;
  const restricted = new TFile(".obsidian/Private.md");
  const plugin = new EntVaultCommandCenterPlugin(organizerApp([restricted]) as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  harness.loadedData = createDefaultStore(genericBase("Restricted", "Notes"), 1, "vault-note-organizer-restricted");
  await harness.loadPluginData(false);

  plugin.openNoteOrganizer([restricted.path], "command");

  assert.equal(harness.activeNoteOrganizerModal, null);
  assert.match(Notice.messages.at(-1) ?? "", /protected source or Obsidian configuration area.*cannot be organized.*Nothing was opened/iu);
  assert.doesNotMatch(Notice.messages.at(-1) ?? "", /changed, moved, or became unavailable/iu);
});

test("an accepted external reload dismisses an open Organizer with an explanation", async () => {
  Notice.messages.length = 0;
  const file = new TFile("Notes/Reload.md");
  const store = createDefaultStore(genericBase("Reload", "Notes"), 1, "vault-note-organizer-external-reload");
  const plugin = new EntVaultCommandCenterPlugin(organizerApp([file]) as never, {} as never);
  const harness = plugin as unknown as OrganizerPluginHarness;
  harness.loadedData = store;
  await harness.loadPluginData(false);
  plugin.openNoteOrganizer([file.path]);
  assert.ok(harness.activeNoteOrganizerModal);

  harness.loadedData = structuredClone(store);
  await plugin.onExternalSettingsChange();

  assert.equal(harness.activeNoteOrganizerModal, null);
  assert.match(Notice.messages.at(-1) ?? "", /Synced knowledge-base data changed.*organizer was closed.*latest bases and memberships/iu);
});

test("safe text drops open exact vault notes and operating-system files fail closed", () => {
  Notice.messages.length = 0;
  const file = new TFile("Vault/Drop.md");
  const plugin = new EntVaultCommandCenterPlugin(organizerApp([file]) as never, {} as never);
  const opened: Array<{ paths: readonly string[]; source: string }> = [];
  plugin.openNoteOrganizer = (paths = [], source = "command") => { opened.push({ paths, source }); };
  plugin.openNoteOrganizerDrop({
    types: ["text/plain"],
    files: { length: 0 },
    getData: () => file.path,
  } as unknown as DataTransfer);
  assert.deepEqual(opened[0], { paths: [file.path], source: "drop" });

  plugin.openNoteOrganizerDrop({
    types: ["Files", "text/plain"],
    files: { length: 1 },
    getData: () => file.path,
  } as unknown as DataTransfer);
  assert.equal(opened.length, 1);
  assert.match(Notice.messages.at(-1) ?? "", /Operating-system files cannot be imported/iu);

  plugin.openNoteOrganizerDrop({
    types: ["text/plain"],
    files: { length: 0 },
    getData: () => `${file.path}\n../Other vault.md`,
  } as unknown as DataTransfer);
  assert.equal(opened.length, 1, "a mixed safe/unsafe payload must not silently organize only a subset");
  assert.match(Notice.messages.at(-1) ?? "", /did not contain safe existing Markdown note paths/iu);

  plugin.openNoteOrganizerDrop({
    types: ["text/plain"],
    files: { length: 0 },
    getData: () => `obsidian://open?vault=Other&file=${encodeURIComponent(file.path)}`,
  } as unknown as DataTransfer);
  assert.equal(opened.length, 1, "a link qualified for another vault must fail closed");
});

test("the App-wide organizer claim blocks replacement instances and unload releases it", () => {
  Notice.messages.length = 0;
  const app = organizerApp([]);
  const first = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const second = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const firstHarness = first as unknown as OrganizerPluginHarness;
  const secondHarness = second as unknown as OrganizerPluginHarness;
  firstHarness.activateAppWriteBarrier();
  secondHarness.activateAppWriteBarrier();
  first.openNoteOrganizer();
  assert.ok(firstHarness.activeNoteOrganizerModal);
  second.openNoteOrganizer();
  assert.equal(secondHarness.activeNoteOrganizerModal, null);
  assert.match(Notice.messages.at(-1) ?? "", /another Obsidian window/iu);

  const firstModal = firstHarness.activeNoteOrganizerModal as { dismissImmediately(): void };
  firstModal.dismissImmediately = () => { throw new Error("simulated modal close failure"); };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    first.onunload();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(firstHarness.activeNoteOrganizerModal, null, "a close failure cannot leak the App-wide claim");
  second.openNoteOrganizer();
  assert.ok(secondHarness.activeNoteOrganizerModal);
  second.onunload();
});

test("membership indicator styles distinguish success, neutral, and broken states accessibly", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.ent-cc-note-membership-organized-current[\s\S]*?var\(--color-green\)/u);
  assert.match(css, /\.ent-cc-note-membership-not-organized[\s\S]*?var\(--text-faint\)/u);
  assert.match(css, /\.ent-cc-note-membership-broken[\s\S]*?var\(--text-error\)/u);
  assert.match(css, /data-kbcc-count[\s\S]*?font-size:\s*0\.5625rem/u);
  assert.doesNotMatch(css, /\.ent-cc-note-organizer-actions[\s\S]{0,220}flex-direction:\s*column-reverse/u);
});
