import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin, {
  DEVICE_LOCAL_STATE_KEY,
  SYNC_RECOVERY_LOCAL_STATE_KEY,
} from "../src/main.ts";
import { ExportImportCenterModal } from "../src/portability-modal.ts";
import {
  boundedSemanticLineage,
  canonicalInterimEnvelopeString,
  BUILTIN_LIBRARY_DEFINITIONS,
  buildCurriculumTree,
  createDefaultStore,
  createDeviceLocalPluginState,
  createKnowledgeBaseEntry,
  curriculumContainerKey,
  DATA_VERSION,
  DEVICE_LOCAL_STATE_VERSION,
  libraryTabId,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_KNOWLEDGE_BASES,
  MAX_LIBRARIES,
  MAX_TRANSFER_TEXT_LENGTH,
  migrateData,
  migrateStore,
  nextSemanticHead,
  isFreshVaultId,
  parseQuery,
  portablePlaceholderPath,
  provisionalInterimEnvelopeVaultFingerprint,
  provisionalMigratedVaultFingerprint,
  rewritePluginDataPathPrefix,
  resetPluginViewState,
  restoreSnapshot,
  semanticEntryFingerprint,
  snapshotPersonal,
  STORE_KIND,
  STORE_VERSION,
  type KnowledgeBaseEntry,
  type PluginData,
  type PluginStore,
  type VaultRecord,
} from "../src/model.ts";
import {
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  parsePortableExport,
  synchronizePortableRegistry,
} from "../src/portability.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import { ConfirmModal, IndexGroupModal, StringPickerModal, TextPromptModal, VaultFilePickerModal } from "../src/modals.ts";
import { EntCommandCenterSettingsTab } from "../src/settings.ts";
import { QuickAppendModal } from "../src/follow-up-modal.ts";
import { Notice, Plugin, TFile, TFolder, type TAbstractFile } from "obsidian";
import { mergeKnowledgeBaseStores } from "../src/store-merge.ts";
import { createPortfolioExport } from "../src/portfolio.ts";
import { EntVaultCommandCenterView, VIEW_TYPE } from "../src/view.ts";

interface TestPluginBase {
  loadedData: unknown;
  savedData: unknown[];
  deviceLocalWrites: unknown[];
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function migrationFingerprintForTest(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((item) => canonical(item) ?? null);
    if (!input || typeof input !== "object") return input;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(input).sort()) {
      const normalized = canonical((input as Record<string, unknown>)[key]);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  };
  const text = JSON.stringify(canonical(value));
  const hash = (seed: number): string => {
    let result = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result.toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

async function bounded<T>(promise: Promise<T>, label: string, milliseconds = 1000): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

function settingsTabForPlugin(plugin: EntVaultCommandCenterPlugin): EntCommandCenterSettingsTab & {
  save(refresh?: boolean): Promise<boolean>;
} {
  const tab = Object.create(EntCommandCenterSettingsTab.prototype) as EntCommandCenterSettingsTab & Record<string, unknown>;
  Object.assign(tab, {
    host: plugin,
    persistedDataSnapshot: structuredClone(plugin.data),
    settingsSaveRevision: 0,
    persistedSettingsRevision: 0,
    pendingSettingsSaves: 0,
    settingsSaveBarrier: Promise.resolve(true),
    settingsWriteUncertain: false,
    settingsRefreshPending: false,
    settingsRefreshGeneration: 0,
    bufferedTextSaveTimer: null,
    bufferedTextSaveWindow: null,
    bufferedTextSaveBaseId: "",
    bufferedTextSaveDataEpoch: 0,
    bufferedTextSaveExternalGeneration: 0,
    bufferedTextSaveData: null,
    bufferedTextSaveRefresh: false,
    update: () => {},
  });
  return tab as EntCommandCenterSettingsTab & { save(refresh?: boolean): Promise<boolean> };
}

function advanceStoreEntry(
  entry: NonNullable<PluginStore["bases"][number]>,
  change: () => void,
  updatedAt = entry.updatedAt + 1,
): void {
  const parentHead = entry.semanticHead;
  change();
  entry.semanticRevision += 1;
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = nextSemanticHead(parentHead, entry.semanticHash);
  entry.semanticLineage = boundedSemanticLineage([parentHead, ...entry.semanticLineage], entry.semanticHead);
  entry.updatedAt = updatedAt;
}

function neutralSyncedData(data: PluginData): PluginData {
  const snapshot = structuredClone(data);
  resetPluginViewState(snapshot);
  return snapshot;
}

function emptyWritableTestVault(): {
  configDir: string;
  getMarkdownFiles: () => TFile[];
  getAbstractFileByPath: () => null;
  createFolder: () => Promise<void>;
  create: (path: string) => Promise<TFile>;
} {
  return {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path) => new TFile(path),
  };
}

function pluginWith(data: unknown, initialDeviceState: unknown = null): EntVaultCommandCenterPlugin & TestPluginBase {
  const deviceLocalWrites: unknown[] = [];
  let deviceState = structuredClone(initialDeviceState);
  const app = {
    vault: emptyWritableTestVault(),
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: () => structuredClone(deviceState),
    saveLocalStorage: (_key: string, value: unknown) => {
      deviceState = structuredClone(value);
      deviceLocalWrites.push(structuredClone(value));
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  plugin.deviceLocalWrites = deviceLocalWrites;
  return plugin;
}

function pluginWithKeyedLocalStorage(
  data: unknown,
  initialValues: ReadonlyMap<string, unknown> = new Map(),
): {
  plugin: EntVaultCommandCenterPlugin & TestPluginBase;
  localValues: Map<string, unknown>;
  localWrites: Array<[string, unknown]>;
} {
  const localValues = new Map([...initialValues].map(([key, value]) => [key, structuredClone(value)]));
  const localWrites: Array<[string, unknown]> = [];
  const app = {
    vault: emptyWritableTestVault(),
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: (key: string) => structuredClone(localValues.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      localValues.set(key, structuredClone(value));
      localWrites.push([key, structuredClone(value)]);
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  plugin.deviceLocalWrites = localWrites.map(([, value]) => value);
  return { plugin, localValues, localWrites };
}

test("active Library commands are stable, refreshed after rename/archive, and revalidate at use", async () => {
  const data = migrateData(null);
  data.portableIndex.libraries = [
    { id: "library-alpha", name: "Alpha", singularName: "Alpha item", icon: "library", order: 0, sourceKind: null, archivedAt: null },
    { id: "library-archived", name: "Archived", singularName: "Archived item", icon: "archive", order: 1, sourceKind: null, archivedAt: 100 },
  ];
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-library-commands"));
  await plugin.loadPluginData();

  interface RegisteredCommand {
    id: string;
    name: string;
    callback?: () => void;
  }
  const registered = new Map<string, RegisteredCommand>();
  const removed: string[] = [];
  const host = plugin as unknown as {
    addCommand(command: RegisteredCommand): RegisteredCommand;
    removeCommand(commandId: string): void;
    syncLibraryCommands(): void;
    activateView(): Promise<{ openLibrary(libraryId: string): Promise<void> }>;
  };
  host.addCommand = (command) => {
    registered.set(command.id, command);
    return command;
  };
  host.removeCommand = (commandId) => {
    removed.push(commandId);
    registered.delete(commandId);
  };

  host.syncLibraryCommands();
  assert.deepEqual([...registered.keys()], ["open-library-library-alpha"]);
  assert.equal(registered.get("open-library-library-alpha")?.name, "Open Library: Alpha");

  const alpha = plugin.data.portableIndex.libraries.find((library) => library.id === "library-alpha");
  assert.ok(alpha);
  alpha.name = "Renamed Alpha";
  host.syncLibraryCommands();
  assert.deepEqual(removed, ["open-library-library-alpha"]);
  assert.equal(registered.get("open-library-library-alpha")?.name, "Open Library: Renamed Alpha");

  let opened = "";
  host.activateView = async () => ({ openLibrary: async (libraryId) => { opened = libraryId; } });
  registered.get("open-library-library-alpha")?.callback?.();
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(opened, "library-alpha");

  alpha.archivedAt = 200;
  host.syncLibraryCommands();
  assert.equal(registered.size, 0);
  assert.deepEqual(removed, ["open-library-library-alpha", "open-library-library-alpha"]);
});

function pluginWithFiles(
  data: unknown,
  files: TFile[],
  frontmatterByPath: Record<string, Record<string, unknown>>,
  initialDeviceState: unknown = null,
): {
  plugin: EntVaultCommandCenterPlugin & TestPluginBase;
  metadataReadCount: () => number;
  sourceMutationCount: () => number;
  vaultEnumerationCount: () => number;
} {
  let metadataReads = 0;
  let sourceMutations = 0;
  let vaultEnumerations = 0;
  const deviceLocalWrites: unknown[] = [];
  let deviceState = structuredClone(initialDeviceState);
  const forbiddenSourceMutation = (): never => {
    sourceMutations += 1;
    throw new Error("A plugin-only organization action attempted to mutate a vault file.");
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => {
        vaultEnumerations += 1;
        return files;
      },
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      modify: forbiddenSourceMutation,
      process: forbiddenSourceMutation,
      create: forbiddenSourceMutation,
      delete: forbiddenSourceMutation,
      rename: forbiddenSourceMutation,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => {
        metadataReads += 1;
        return { frontmatter: frontmatterByPath[file.path] ?? {} };
      },
      resolvedLinks: {},
    },
    fileManager: {
      renameFile: forbiddenSourceMutation,
      processFrontMatter: forbiddenSourceMutation,
    },
    loadLocalStorage: () => structuredClone(deviceState),
    saveLocalStorage: (_key: string, value: unknown) => {
      deviceState = structuredClone(value);
      deviceLocalWrites.push(structuredClone(value));
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  plugin.deviceLocalWrites = deviceLocalWrites;
  return {
    plugin,
    metadataReadCount: () => metadataReads,
    sourceMutationCount: () => sourceMutations,
    vaultEnumerationCount: () => vaultEnumerations,
  };
}

function invalidEntMedicationIndexData(file: TFile): ReturnType<typeof migrateData> {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.portableIndex.groups = [{ id: "legacy-index", title: "Legacy Index", order: 0 }];
  data.portableIndex.subjects = [{
    id: "legacy-medication",
    title: "Allergodil",
    groupId: "legacy-index",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
    libraryId: null,
  }];
  data.portableIndex.resolvedPathBySubjectId = { "legacy-medication": file.path };
  data.manualIndexPaths = [file.path];
  data.indexGroupByPath = { [file.path]: "Legacy Index" };
  return data;
}

function diverseLegacyEntIndexData(): {
  data: ReturnType<typeof migrateData>;
  files: TFile[];
  frontmatter: Record<string, Record<string, unknown>>;
} {
  const paths = {
    procedure: "04 Procedures/Procedure - Airway endoscopy.md",
    medication: "06 Clinical Tools/Medications/Drug - Allergodil.md",
    syndrome: "06 Clinical Tools/Syndromes/Syndrome - Usher.md",
    topic: "03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md",
    proposal: "01 Inbox/Proposed airway.md",
    note: "Outside/Misleading proposal.md",
    topicPlaceholder: portablePlaceholderPath("topic-placeholder"),
    medicationPlaceholder: portablePlaceholderPath("medication-placeholder"),
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox";
  data.portableIndex.groups = [{ id: "legacy-index", title: "Legacy Index", order: 0 }];
  const definitions = [
    ["procedure", paths.procedure, "topic"],
    ["medication", paths.medication, "topic"],
    ["syndrome", paths.syndrome, "topic"],
    ["topic", paths.topic, "topic"],
    ["proposal", paths.proposal, "topic"],
    ["note", paths.note, "topic"],
    ["topic-placeholder", paths.topicPlaceholder, "topic"],
    ["medication-placeholder", paths.medicationPlaceholder, "medication"],
  ] as const;
  data.portableIndex.subjects = definitions.map(([id, _path, recordKind], order) => ({
    id,
    title: id,
    groupId: "legacy-index",
    parentId: null,
    order,
    indexed: true,
    configuredId: "",
    recordKind,
    libraryId: null,
  }));
  data.portableIndex.resolvedPathBySubjectId = Object.fromEntries(
    definitions
      .filter(([, path]) => !path.startsWith("kbcc-placeholder:"))
      .map(([id, path]) => [id, path]),
  );
  data.manualIndexPaths = definitions.map(([, path]) => path);
  const files = Object.values(paths)
    .filter((path) => !path.startsWith("kbcc-placeholder:"))
    .map((path) => new TFile(path));
  const frontmatter = Object.fromEntries(files.map((file) => [file.path, {
    title: file.basename,
    // Deliberately misleading: upgrade remediation must not depend on a warm
    // or complete metadata cache while vault files are still syncing.
    type: "topic-proposal",
  }]));
  return { data, files, frontmatter };
}

function legacyEntSnapshotWithoutLibraries(label: string): ReturnType<typeof snapshotPersonal> {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.portableIndex.libraries = [];
  data.portableIndex.libraryLayouts = {};
  const missingTab = libraryTabId("missing-library");
  data.settings.defaultTab = missingTab;
  data.activeTab = missingTab;
  data.savedViews = [{ id: "missing-view", name: "Missing library", tab: missingTab, query: "" }];
  return snapshotPersonal(data, label, true, true, false, true);
}

function assertEntLibrariesAndNavigationAreNormalized(data: ReturnType<typeof migrateData>): void {
  assert.deepEqual(
    BUILTIN_LIBRARY_DEFINITIONS.map((library) => library.id).every((id) => data.portableIndex.libraries.some((library) => library.id === id)),
    true,
  );
  assert.equal(data.settings.defaultTab, "curriculum");
  assert.equal(data.activeTab, "curriculum");
  assert.deepEqual(data.savedViews, []);
}

function trackedVaultTree(initial: TAbstractFile[]): {
  entries: Map<string, TAbstractFile>;
  createdFolders: string[];
  trashedFolders: string[];
  createFolder(path: string): Promise<TFolder>;
  renameFile(file: TFile, destination: string): Promise<void>;
  trashFile(file: TAbstractFile): Promise<void>;
  markdownFiles(): TFile[];
} {
  const entries = new Map<string, TAbstractFile>();
  const createdFolders: string[] = [];
  const trashedFolders: string[] = [];
  const parentPath = (path: string): string => path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
  const attach = (file: TAbstractFile): void => {
    entries.set(file.path, file);
    const parent = entries.get(parentPath(file.path));
    if (parent instanceof TFolder && !parent.children.includes(file)) parent.children.push(file);
  };
  const detach = (file: TAbstractFile): void => {
    entries.delete(file.path);
    const parent = entries.get(parentPath(file.path));
    if (parent instanceof TFolder) parent.children = parent.children.filter((child) => child !== file);
  };
  for (const entry of initial) attach(entry);
  return {
    entries,
    createdFolders,
    trashedFolders,
    async createFolder(path): Promise<TFolder> {
      const folder = new TFolder(path);
      attach(folder);
      createdFolders.push(path);
      return folder;
    },
    async renameFile(file, destination): Promise<void> {
      detach(file);
      file.path = destination;
      attach(file);
    },
    async trashFile(file): Promise<void> {
      if (!(file instanceof TFolder) || file.children.length > 0) throw new Error("Only an empty folder can be trashed by this fixture.");
      trashedFolders.push(file.path);
      detach(file);
    },
    markdownFiles(): TFile[] {
      return [...entries.values()].filter((entry): entry is TFile => entry instanceof TFile && entry.extension === "md");
    },
  };
}

test("versionless modern plugin data is migrated and saved without losing organization", async () => {
  const plugin = pluginWith({
    collections: [{ id: "research", title: "Research", collapsed: false, subjects: ["Notes/Paper.md"], subheadings: [] }],
    pinnedPaths: ["Notes/Paper.md"],
    settings: { workspaceMode: "generic", workspaceName: "My KB", setupComplete: true },
  });
  await plugin.loadPluginData();
  assert.equal(plugin.data.version, DATA_VERSION);
  assert.equal(plugin.data.settings.workspaceMode, "generic");
  assert.equal(plugin.data.collections[0]?.title, "Research");
  assert.deepEqual(plugin.data.pinnedPaths, ["Notes/Paper.md"]);
  assert.equal(plugin.savedData.length, 1);
  const saved = plugin.savedData[0] as {
    kind?: string;
    version?: number;
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: { settings?: { workspaceName?: string }; pinnedPaths?: string[] } }>;
  };
  assert.equal(saved.kind, STORE_KIND);
  assert.equal(saved.version, STORE_VERSION);
  assert.equal(saved.activeBaseId, "base-default");
  assert.equal(saved.bases?.[0]?.id, "base-default");
  assert.equal(saved.bases?.[0]?.data?.settings?.workspaceName, "My KB");
  assert.deepEqual(saved.bases?.[0]?.data?.pinnedPaths, ["Notes/Paper.md"]);
});

test("ordinary current-version loading persists structural ID repair exactly once", async () => {
  const active = migrateData(null);
  active.settings.workspaceName = "Primary research";
  active.pinnedPaths = ["Knowledge Base/Important.md"];
  const inactive = migrateData(null);
  inactive.settings.workspaceName = "Secondary research";
  const store = createDefaultStore(active, 100, "vault-current-structural-repair");
  store.bases[0].updatedAt = 150;
  const inactiveEntry = createKnowledgeBaseEntry(inactive, "base-secondary", 200);
  inactiveEntry.updatedAt = 250;
  store.bases.push(inactiveEntry);

  const raw = structuredClone(store) as unknown as {
    bases: Array<{ data: Record<string, unknown> }>;
  };
  raw.bases[0].data.collections = [
    { id: "shared", title: "Local heading", collapsed: false, subjects: [], subheadings: [] },
    {
      id: "shared",
      title: "Damaged duplicate",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "__proto__", title: "Unsafe child", collapsed: false, subjects: [] }],
    },
  ];
  raw.bases[1].data.savedViews = [
    { id: "saved", name: "First", tab: "curriculum", query: "first" },
    { id: "saved", name: "Second", tab: "collections", query: "second" },
  ];
  const plugin = pluginWith(raw);

  const first = await plugin.loadPluginData();

  assert.equal(first.structuralRepairNeedsWriteback, true);
  assert.equal(plugin.savedData.length, 1, "all current-store repairs share one atomic writeback");
  assert.equal(plugin.getKnowledgeBases(true)[0]?.updatedAt, 150, "repair preserves semantic conflict timestamps");
  assert.equal(plugin.getKnowledgeBases(true)[1]?.updatedAt, 250);
  assert.equal(plugin.data.settings.workspaceName, "Primary research");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Important.md"]);
  const activeIds = plugin.data.collections.flatMap((heading) => [
    heading.id,
    ...heading.subheadings.map((subheading) => subheading.id),
  ]);
  const inactiveIds = plugin.getKnowledgeBases(true)[1]?.data.savedViews.map((view) => view.id) ?? [];
  assert.equal(new Set(activeIds).size, activeIds.length);
  assert.equal(activeIds.includes("__proto__"), false);
  assert.equal(new Set(inactiveIds).size, inactiveIds.length);

  plugin.loadedData = plugin.savedData[0];
  plugin.savedData.length = 0;
  const second = await plugin.loadPluginData();
  assert.equal(second.structuralRepairNeedsWriteback, false);
  assert.equal(plugin.savedData.length, 0, "the normalized store does not enter a writeback loop");
  assert.equal(plugin.data.settings.workspaceName, "Primary research");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Important.md"]);
});

test("current structural repair rebases a pristine provisional migration identity", async () => {
  const data = migrateData(null);
  const store = createDefaultStore(data, 100, "vault-current-repair-placeholder");
  store.bases[0].data.collections = [
    { id: "shared", title: "First", collapsed: false, subjects: [], subheadings: [] },
    { id: "shared", title: "Duplicate", collapsed: false, subjects: [], subheadings: [] },
  ];
  const oldFingerprint = migrationFingerprintForTest(store.bases[0].data);
  store.vaultId = `vault-migrated-${oldFingerprint}-abcdefghijkl`;
  const plugin = pluginWith(store);

  const loaded = await plugin.loadPluginData();

  const repairedFingerprint = migrationFingerprintForTest(plugin.data);
  assert.equal(loaded.structuralRepairNeedsWriteback, true);
  assert.notEqual(repairedFingerprint, oldFingerprint);
  assert.equal(provisionalMigratedVaultFingerprint(plugin.getVaultId()), repairedFingerprint);
  assert.match(plugin.getVaultId(), /-abcdefghijkl$/);
  assert.equal(plugin.savedData.length, 1);
});

test("current structural repair rebases legacy deterministic provisional IDs after rotation", async () => {
  const data = migrateData(null);
  const template = createDefaultStore(data, 100, "vault-current-repair-placeholder");
  template.bases[0].data.collections = [
    { id: "shared", title: "First", collapsed: false, subjects: [], subheadings: [] },
    { id: "shared", title: "Duplicate", collapsed: false, subjects: [], subheadings: [] },
  ];
  const oldFingerprint = migrationFingerprintForTest(template.bases[0].data);
  template.vaultId = `vault-migrated-${oldFingerprint}`;
  const left = pluginWith(structuredClone(template));
  const right = pluginWith(structuredClone(template));

  await left.loadPluginData();
  await right.loadPluginData();

  const leftSaved = left.savedData[0] as PluginStore;
  const rightSaved = right.savedData[0] as PluginStore;
  const repairedFingerprint = migrationFingerprintForTest(leftSaved.bases[0]?.data);
  assert.notEqual(repairedFingerprint, oldFingerprint);
  assert.equal(provisionalMigratedVaultFingerprint(leftSaved.vaultId), repairedFingerprint);
  assert.equal(provisionalMigratedVaultFingerprint(rightSaved.vaultId), repairedFingerprint);
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(leftSaved, rightSaved, leftSaved.activeBaseId));
});

test("current structural repair preserves identity-less envelope convergence across devices", async () => {
  const data = migrateData(null);
  const template = createDefaultStore(data, 100, "vault-current-envelope-placeholder");
  template.bases[0].data.collections = [
    { id: "shared", title: "First", collapsed: false, subjects: [], subheadings: [] },
    { id: "shared", title: "Duplicate", collapsed: false, subjects: [], subheadings: [] },
  ];
  const oldFingerprint = migrationFingerprintForTest(
    JSON.parse(canonicalInterimEnvelopeString(template)),
  );
  const leftStore = structuredClone(template);
  const rightStore = structuredClone(template);
  leftStore.vaultId = `vault-envelope-migrated-${oldFingerprint}-aaaaaaaaaaaa`;
  rightStore.vaultId = `vault-envelope-migrated-${oldFingerprint}-bbbbbbbbbbbb`;
  const left = pluginWith(leftStore);
  const right = pluginWith(rightStore);

  await left.loadPluginData();
  await right.loadPluginData();

  const leftSaved = left.savedData[0] as PluginStore;
  const rightSaved = right.savedData[0] as PluginStore;
  const repairedFingerprint = migrationFingerprintForTest(
    JSON.parse(canonicalInterimEnvelopeString(leftSaved)),
  );
  assert.notEqual(repairedFingerprint, oldFingerprint);
  assert.equal(provisionalInterimEnvelopeVaultFingerprint(leftSaved.vaultId), repairedFingerprint);
  assert.equal(provisionalInterimEnvelopeVaultFingerprint(rightSaved.vaultId), repairedFingerprint);
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(leftSaved, rightSaved, leftSaved.activeBaseId));
});

test("old-schema migration rebases pristine provisional identities across devices", async () => {
  const legacyData = migrateData(null);
  legacyData.settings.workspaceName = "Legacy migrated knowledge base";
  (legacyData as { version: number }).version = DATA_VERSION - 2;
  const template = createDefaultStore(legacyData, 100, "vault-old-schema-placeholder");
  (template as { version: number }).version = STORE_VERSION - 2;
  const oldFingerprint = migrationFingerprintForTest(template.bases[0]?.data);
  const leftStore = structuredClone(template);
  const rightStore = structuredClone(template);
  leftStore.vaultId = `vault-migrated-${oldFingerprint}-aaaaaaaaaaaa`;
  rightStore.vaultId = `vault-migrated-${oldFingerprint}-bbbbbbbbbbbb`;
  const left = pluginWith(leftStore);
  const right = pluginWith(rightStore);

  const leftLoad = await left.loadPluginData();
  const rightLoad = await right.loadPluginData();

  assert.equal(leftLoad.sourceVersion, STORE_VERSION - 2);
  assert.equal(rightLoad.sourceVersion, STORE_VERSION - 2);
  assert.equal(leftLoad.structuralRepairNeedsWriteback, false, "schema migration has its own writeback signal");
  assert.equal(left.savedData.length, 1);
  assert.equal(right.savedData.length, 1);
  const leftSaved = left.savedData[0] as PluginStore;
  const rightSaved = right.savedData[0] as PluginStore;
  const migratedFingerprint = migrationFingerprintForTest(leftSaved.bases[0]?.data);
  assert.notEqual(migratedFingerprint, oldFingerprint);
  assert.equal(leftSaved.bases[0]?.data.settings.workspaceName, "Legacy migrated knowledge base");
  assert.equal(provisionalMigratedVaultFingerprint(leftSaved.vaultId), migratedFingerprint);
  assert.equal(provisionalMigratedVaultFingerprint(rightSaved.vaultId), migratedFingerprint);
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(leftSaved, rightSaved, leftSaved.activeBaseId));
});

test("old-schema migration rebases pristine identity-less envelope IDs across devices", async () => {
  const legacyData = migrateData(null);
  legacyData.settings.workspaceName = "Legacy envelope knowledge base";
  (legacyData as { version: number }).version = DATA_VERSION - 2;
  const template = createDefaultStore(legacyData, 100, "vault-old-envelope-placeholder");
  (template as { version: number }).version = STORE_VERSION - 2;
  const oldFingerprint = migrationFingerprintForTest(
    JSON.parse(canonicalInterimEnvelopeString(template)),
  );
  const leftStore = structuredClone(template);
  const rightStore = structuredClone(template);
  leftStore.vaultId = `vault-envelope-migrated-${oldFingerprint}-aaaaaaaaaaaa`;
  rightStore.vaultId = `vault-envelope-migrated-${oldFingerprint}-bbbbbbbbbbbb`;
  const left = pluginWith(leftStore);
  const right = pluginWith(rightStore);

  await left.loadPluginData();
  await right.loadPluginData();

  assert.equal(left.savedData.length, 1);
  assert.equal(right.savedData.length, 1);
  const leftSaved = left.savedData[0] as PluginStore;
  const rightSaved = right.savedData[0] as PluginStore;
  const migratedFingerprint = migrationFingerprintForTest(
    JSON.parse(canonicalInterimEnvelopeString(leftSaved)),
  );
  assert.notEqual(migratedFingerprint, oldFingerprint);
  assert.equal(leftSaved.bases[0]?.data.settings.workspaceName, "Legacy envelope knowledge base");
  assert.equal(provisionalInterimEnvelopeVaultFingerprint(leftSaved.vaultId), migratedFingerprint);
  assert.equal(provisionalInterimEnvelopeVaultFingerprint(rightSaved.vaultId), migratedFingerprint);
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(leftSaved, rightSaved, leftSaved.activeBaseId));
});

test("combined structural and clinical repair rebases once to the final convergent payload", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  data.collections = [
    { id: "shared", title: "First", collapsed: false, subjects: [], subheadings: [] },
    { id: "shared", title: "Duplicate", collapsed: false, subjects: [], subheadings: [] },
  ];
  const oldFingerprint = migrationFingerprintForTest(data);
  const template = createDefaultStore(data, 100, `vault-migrated-${oldFingerprint}-aaaaaaaaaaaa`);
  const other = structuredClone(template);
  other.vaultId = `vault-migrated-${oldFingerprint}-bbbbbbbbbbbb`;
  const frontmatter = { [medication.path]: { title: "Allergodil" } };
  const left = pluginWithFiles(template, [medication], frontmatter).plugin;
  const right = pluginWithFiles(other, [medication], frontmatter).plugin;

  const leftLoad = await left.loadPluginData();
  const rightLoad = await right.loadPluginData();

  assert.equal(leftLoad.structuralRepairNeedsWriteback, true);
  assert.equal(leftLoad.remediationNeedsWriteback, true);
  assert.equal(rightLoad.structuralRepairNeedsWriteback, true);
  assert.equal(rightLoad.remediationNeedsWriteback, true);
  const leftSaved = left.savedData[0] as PluginStore;
  const rightSaved = right.savedData[0] as PluginStore;
  const finalFingerprint = migrationFingerprintForTest(leftSaved.bases[0]?.data);
  assert.equal(provisionalMigratedVaultFingerprint(leftSaved.vaultId), finalFingerprint);
  assert.equal(provisionalMigratedVaultFingerprint(rightSaved.vaultId), finalFingerprint);
  assert.equal(leftSaved.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(leftSaved, rightSaved, leftSaved.activeBaseId));
});

test("numeric-string v2 startup migration preserves legacy organization and writes one envelope", async () => {
  const original = {
    version: "2",
    collections: [{
      id: "legacy-reading",
      title: "Legacy Reading",
      collapsed: false,
      subjects: ["Knowledge Base/Legacy topic.md"],
      subheadings: [],
    }],
    pinnedPaths: ["Knowledge Base/Pinned.md"],
    nextStudyPaths: ["Knowledge Base/Next.md"],
    savedViews: [{ id: "legacy-view", name: "Legacy view", tab: "collections", query: "legacy" }],
    settings: { workspaceName: "Legacy v2 workspace", defaultTab: "collections" },
  };
  const before = structuredClone(original);
  const plugin = pluginWith(original);

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, true);
  assert.equal(plugin.data.settings.workspaceName, "Legacy v2 workspace");
  assert.equal(plugin.data.collections[0]?.title, "Legacy Reading");
  assert.deepEqual(plugin.data.collections[0]?.subjects, ["Knowledge Base/Legacy topic.md"]);
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Pinned.md"]);
  assert.deepEqual(plugin.data.nextStudyPaths, ["Knowledge Base/Next.md"]);
  assert.equal(plugin.data.savedViews[0]?.name, "Legacy view");
  assert.equal(plugin.data.v2MigrationBackup?.version, 2);
  assert.equal(plugin.savedData.length, 1);
  assert.deepEqual(original, before, "startup migration never mutates the source object in place");
  const saved = plugin.savedData[0] as { bases?: Array<{ data?: { collections?: Array<{ title?: string }> } }> };
  assert.equal(saved.bases?.[0]?.data?.collections?.[0]?.title, "Legacy Reading");
});

test("an interim deterministic migrated vault ID rotates once and is persisted", async () => {
  const data = migrateData(null);
  data.settings.workspaceName = "MY MAIN NOTE KB";
  const store = createDefaultStore(data, 100, "vault-migrated-0123456789abcdef");
  const plugin = pluginWith(store);

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, true);
  assert.equal(result.structuralRepairNeedsWriteback, false, "identity rotation is not misclassified as payload repair");
  assert.equal(result.hasVaultId, true, "the rotated in-memory identity is available to Sync");
  assert.match(plugin.getVaultId(), /^vault-migrated-0123456789abcdef-[a-z0-9]{12,64}$/i);
  assert.notEqual(plugin.getVaultId(), "vault-migrated-0123456789abcdef");
  assert.equal(plugin.savedData.length, 1, "rotation must survive restart and recovery export");
  assert.equal((plugin.savedData[0] as { vaultId?: string }).vaultId, plugin.getVaultId());
});

test("an empty proposal folder never reclassifies notes during clinical repair", async () => {
  // Real Obsidian's normalizePath("") returns "/", and "is inside /" matches
  // every path; synced or imported settings can legitimately carry "".
  const topic = new TFile("03 Clinical Topics/Laryngology/Vocal fold palsy.md");
  const plain = new TFile("03 Clinical Topics/Reading notes.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "";
  data.portableIndex.groups = [{ id: "index", title: "Index", order: 0 }];
  data.portableIndex.subjects = [{
    id: "topic-subject",
    title: "Vocal fold palsy",
    groupId: "index",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
    libraryId: null,
  }];
  data.portableIndex.resolvedPathBySubjectId = { "topic-subject": topic.path };
  data.manualIndexPaths = [topic.path, plain.path];
  const store = createDefaultStore(data, 100, "vault-empty-proposal-folder");
  const { plugin } = pluginWithFiles(store, [topic, plain], {
    [topic.path]: { title: "Vocal fold palsy" },
    [plain.path]: { title: "Reading notes" },
  });

  await plugin.loadPluginData();

  assert.deepEqual(plugin.data.manualIndexPaths, [topic.path, plain.path]);
  const subject = plugin.data.portableIndex.subjects.find((entry) => entry.id === "topic-subject");
  assert.equal(subject?.indexed, true);
  assert.equal(subject?.recordKind, "topic");
});

test("startup atomically rehomes invalid ENT Index data across every base and writes the store once", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const procedure = new TFile("04 Procedures/Procedure - Airway endoscopy.md");
  const active = migrateData(null);
  active.settings.workspaceMode = "ent-clinical";
  active.settings.primaryFolder = "03 Clinical Topics";
  active.portableIndex.groups = [{ id: "legacy-index", title: "Legacy Index", order: 0 }];
  active.portableIndex.subjects = [
    {
      id: "medication-collision",
      title: "Imported topic label",
      groupId: "legacy-index",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
      libraryId: null,
    },
    {
      id: "syndrome-placeholder",
      title: "Portable syndrome",
      groupId: "legacy-index",
      parentId: "medication-collision",
      order: 1,
      indexed: true,
      configuredId: "",
      recordKind: "syndrome",
      libraryId: null,
    },
    {
      id: "topic-child",
      title: "Valid child topic",
      groupId: "legacy-index",
      parentId: "medication-collision",
      order: 2,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
      libraryId: null,
    },
  ];
  active.portableIndex.resolvedPathBySubjectId = { "medication-collision": medication.path };
  const syndromePlaceholder = portablePlaceholderPath("syndrome-placeholder");
  active.manualIndexPaths = [medication.path, syndromePlaceholder];
  active.indexGroupByPath = { [medication.path]: "Legacy Index", [syndromePlaceholder]: "Legacy Index" };
  active.curriculumVisual.parentByPath[portablePlaceholderPath("topic-child")] = medication.path;

  const inactive = migrateData(null);
  inactive.settings.workspaceMode = "ent-clinical";
  inactive.settings.workspaceName = "Archived ENT";
  inactive.settings.primaryFolder = "03 Clinical Topics";
  inactive.portableIndex.groups = [{ id: "procedures", title: "Procedures", order: 0 }];
  inactive.portableIndex.subjects = [{
    id: "legacy-procedure",
    title: "Airway endoscopy",
    groupId: "procedures",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "procedure",
    libraryId: null,
  }];
  inactive.portableIndex.resolvedPathBySubjectId = { "legacy-procedure": procedure.path };
  inactive.manualIndexPaths = [procedure.path];

  const generic = migrateData(null);
  generic.settings.workspaceMode = "generic";
  generic.settings.workspaceName = "Generic research";
  generic.portableIndex.groups = [{ id: "generic", title: "Generic", order: 0 }];
  generic.portableIndex.subjects = [{
    id: "generic-syndrome",
    title: "Generic indexed syndrome",
    groupId: "generic",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "syndrome",
    libraryId: null,
  }];

  const store = createDefaultStore(active, 100, "vault-remediation-test");
  const archivedEntry = createKnowledgeBaseEntry(inactive, "base-archived-ent", 200);
  archivedEntry.archivedAt = 300;
  store.bases.push(archivedEntry, createKnowledgeBaseEntry(generic, "base-generic", 400));
  const { plugin, sourceMutationCount } = pluginWithFiles(store, [medication, procedure], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
    [procedure.path]: { title: "Airway endoscopy" },
  });

  await plugin.loadPluginData();

  assert.equal(plugin.savedData.length, 1, "all bases must be remediated in one store write");
  const medicationSubject = plugin.data.portableIndex.subjects.find((subject) => subject.id === "medication-collision");
  const syndromeSubject = plugin.data.portableIndex.subjects.find((subject) => subject.id === "syndrome-placeholder");
  assert.deepEqual(
    { indexed: medicationSubject?.indexed, kind: medicationSubject?.recordKind, libraryId: medicationSubject?.libraryId },
    { indexed: false, kind: "medication", libraryId: "medication" },
  );
  assert.deepEqual(
    { indexed: syndromeSubject?.indexed, kind: syndromeSubject?.recordKind, libraryId: syndromeSubject?.libraryId },
    { indexed: false, kind: "syndrome", libraryId: "syndrome" },
  );
  assert.deepEqual(plugin.data.manualIndexPaths, []);
  assert.equal(plugin.data.portableIndex.subjects.find((subject) => subject.id === "topic-child")?.parentId, null);
  assert.equal(plugin.data.curriculumVisual.parentByPath[portablePlaceholderPath("topic-child")], null);
  assert.equal(plugin.data.indexGroupByPath[medication.path], undefined);

  const remediatedArchived = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-archived-ent");
  const procedureSubject = remediatedArchived?.data.portableIndex.subjects.find((subject) => subject.id === "legacy-procedure");
  assert.deepEqual(
    { indexed: procedureSubject?.indexed, kind: procedureSubject?.recordKind, libraryId: procedureSubject?.libraryId },
    { indexed: false, kind: "procedure", libraryId: "procedure" },
  );
  assert.deepEqual(remediatedArchived?.data.manualIndexPaths, []);
  const genericSubject = plugin.getKnowledgeBases(true)
    .find((entry) => entry.id === "base-generic")?.data.portableIndex.subjects[0];
  assert.equal(genericSubject?.indexed, true, "Generic knowledge bases remain unrestricted");
  assert.equal(sourceMutationCount(), 0);

  plugin.loadedData = plugin.savedData[0];
  plugin.savedData.length = 0;
  await plugin.loadPluginData();
  assert.equal(plugin.savedData.length, 0, "the remediation is idempotent after its first writeback");
  assert.equal(sourceMutationCount(), 0);
});

test("concurrent flat v10 upgrades rebase repaired provisional identities and converge", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const legacy = invalidEntMedicationIndexData(medication);
  legacy.version = 10;
  const files = [medication];
  const frontmatter = { [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] } };
  const left = pluginWithFiles(structuredClone(legacy), files, frontmatter).plugin;
  const right = pluginWithFiles(structuredClone(legacy), files, frontmatter).plugin;

  await left.loadPluginData();
  await right.loadPluginData();

  const leftStore = left.savedData.at(-1) as PluginStore;
  const rightStore = right.savedData.at(-1) as PluginStore;
  assert.notEqual(leftStore.vaultId, rightStore.vaultId, "each device retains an independent random nonce");
  assert.equal(
    provisionalMigratedVaultFingerprint(leftStore.vaultId),
    provisionalMigratedVaultFingerprint(rightStore.vaultId),
    "the embedded fingerprint must describe the deterministically repaired payload",
  );
  assert.equal(leftStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(leftStore.bases[0]?.data.portableIndex.subjects[0]?.libraryId, "medication");
  const leftFirst = mergeKnowledgeBaseStores(leftStore, rightStore).store;
  const rightFirst = mergeKnowledgeBaseStores(rightStore, leftStore).store;
  assert.deepEqual(leftFirst, rightFirst);
});

test("concurrent v11 identity-less envelope upgrades rebase repaired identities and converge", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  const envelope = createDefaultStore(data, 100, "temporary-vault-id");
  envelope.version = 11;
  const identityLessEnvelope = structuredClone(envelope) as unknown as Record<string, unknown>;
  delete identityLessEnvelope.vaultId;
  const files = [medication];
  const frontmatter = { [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] } };
  const left = pluginWithFiles(structuredClone(identityLessEnvelope), files, frontmatter).plugin;
  const right = pluginWithFiles(structuredClone(identityLessEnvelope), files, frontmatter).plugin;

  await left.loadPluginData();
  await right.loadPluginData();

  const leftStore = left.savedData.at(-1) as PluginStore;
  const rightStore = right.savedData.at(-1) as PluginStore;
  assert.notEqual(leftStore.vaultId, rightStore.vaultId, "each device retains an independent random nonce");
  assert.equal(
    provisionalInterimEnvelopeVaultFingerprint(leftStore.vaultId),
    provisionalInterimEnvelopeVaultFingerprint(rightStore.vaultId),
    "the embedded envelope fingerprint must describe the repaired multi-base payload",
  );
  assert.equal(leftStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(leftStore.bases[0]?.data.portableIndex.subjects[0]?.libraryId, "medication");
  const leftFirst = mergeKnowledgeBaseStores(leftStore, rightStore).store;
  const rightFirst = mergeKnowledgeBaseStores(rightStore, leftStore).store;
  assert.deepEqual(leftFirst, rightFirst);
});

test("flat v10 remediation converges while one device is still missing synced Markdown", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const legacy = invalidEntMedicationIndexData(medication);
  legacy.version = 10;
  const complete = pluginWithFiles(structuredClone(legacy), [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  }).plugin;
  const downloading = pluginWithFiles(structuredClone(legacy), [], {}).plugin;

  await complete.loadPluginData();
  await downloading.loadPluginData();

  const completeStore = complete.savedData.at(-1) as PluginStore;
  const downloadingStore = downloading.savedData.at(-1) as PluginStore;
  assert.equal(completeStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(downloadingStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(
    provisionalMigratedVaultFingerprint(completeStore.vaultId),
    provisionalMigratedVaultFingerprint(downloadingStore.vaultId),
  );
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(completeStore, downloadingStore));
});

test("v11 identity-less remediation converges while one device is still missing synced Markdown", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  const envelope = createDefaultStore(data, 100, "temporary-vault-id");
  envelope.version = 11;
  const identityLess = structuredClone(envelope) as unknown as Record<string, unknown>;
  delete identityLess.vaultId;
  const complete = pluginWithFiles(structuredClone(identityLess), [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  }).plugin;
  const downloading = pluginWithFiles(structuredClone(identityLess), [], {}).plugin;

  await complete.loadPluginData();
  await downloading.loadPluginData();

  const completeStore = complete.savedData.at(-1) as PluginStore;
  const downloadingStore = downloading.savedData.at(-1) as PluginStore;
  assert.equal(completeStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(downloadingStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(
    provisionalInterimEnvelopeVaultFingerprint(completeStore.vaultId),
    provisionalInterimEnvelopeVaultFingerprint(downloadingStore.vaultId),
  );
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(completeStore, downloadingStore));
});

test("flat v10 and v11 identity-less repairs are path-deterministic across incomplete Markdown Sync", async () => {
  for (const format of ["flat-v10", "identity-less-v11"] as const) {
    const fixture = diverseLegacyEntIndexData();
    let input: unknown;
    if (format === "flat-v10") {
      fixture.data.version = 10;
      input = fixture.data;
    } else {
      const envelope = createDefaultStore(fixture.data, 100, "temporary-vault-id");
      envelope.version = 11;
      const identityLess = structuredClone(envelope) as unknown as Record<string, unknown>;
      delete identityLess.vaultId;
      input = identityLess;
    }
    const complete = pluginWithFiles(structuredClone(input), fixture.files, fixture.frontmatter).plugin;
    const downloading = pluginWithFiles(structuredClone(input), [], {}).plugin;

    await complete.loadPluginData();
    await downloading.loadPluginData();

    const completeStore = complete.savedData.at(-1) as PluginStore;
    const downloadingStore = downloading.savedData.at(-1) as PluginStore;
    assert.deepEqual(
      completeStore.bases[0]?.data,
      downloadingStore.bases[0]?.data,
      `${format} repair must ignore transient TFile and metadata-cache availability`,
    );
    const subjects = new Map(completeStore.bases[0]?.data.portableIndex.subjects.map((subject) => [subject.id, subject]));
    for (const kind of ["procedure", "medication", "syndrome"] as const) {
      const subject = subjects.get(kind);
      assert.deepEqual(
        { indexed: subject?.indexed, recordKind: subject?.recordKind, libraryId: subject?.libraryId },
        { indexed: false, recordKind: kind, libraryId: kind },
        `${format} ${kind} path is repaired into its protected Library`,
      );
    }
    assert.deepEqual(
      { indexed: subjects.get("note")?.indexed, recordKind: subjects.get("note")?.recordKind, libraryId: subjects.get("note")?.libraryId },
      { indexed: false, recordKind: "note", libraryId: null },
      `${format} ordinary out-of-root path ignores misleading proposal metadata`,
    );
    assert.equal(subjects.get("topic")?.indexed, true);
    assert.equal(subjects.get("proposal")?.indexed, true);
    assert.equal(subjects.get("topic-placeholder")?.indexed, true);
    assert.deepEqual(
      {
        indexed: subjects.get("medication-placeholder")?.indexed,
        recordKind: subjects.get("medication-placeholder")?.recordKind,
        libraryId: subjects.get("medication-placeholder")?.libraryId,
      },
      { indexed: false, recordKind: "medication", libraryId: "medication" },
    );
    assert.doesNotThrow(() => mergeKnowledgeBaseStores(completeStore, downloadingStore));
  }
});

test("persisted pristine provisional identities survive later deterministic ENT remediation", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  data.version = 10;
  const files = [medication];
  const frontmatter = { [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] } };

  const flatLeft = pluginWithFiles(migrateStore(structuredClone(data), 100), files, frontmatter).plugin;
  const flatRight = pluginWithFiles(migrateStore(structuredClone(data), 100), files, frontmatter).plugin;
  await flatLeft.loadPluginData();
  await flatRight.loadPluginData();
  const flatLeftStore = flatLeft.savedData.at(-1) as PluginStore;
  const flatRightStore = flatRight.savedData.at(-1) as PluginStore;
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(flatLeftStore, flatRightStore));

  const envelope = createDefaultStore(invalidEntMedicationIndexData(medication), 100, "temporary-vault-id");
  envelope.version = 11;
  const identityLess = structuredClone(envelope) as unknown as Record<string, unknown>;
  delete identityLess.vaultId;
  const envelopeLeft = pluginWithFiles(migrateStore(structuredClone(identityLess), 100), files, frontmatter).plugin;
  const envelopeRight = pluginWithFiles(migrateStore(structuredClone(identityLess), 100), files, frontmatter).plugin;
  await envelopeLeft.loadPluginData();
  await envelopeRight.loadPluginData();
  const envelopeLeftStore = envelopeLeft.savedData.at(-1) as PluginStore;
  const envelopeRightStore = envelopeRight.savedData.at(-1) as PluginStore;
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(envelopeLeftStore, envelopeRightStore));
});

test("Undo repairs a historical ENT snapshot before persisting it", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  data.undoStack = [snapshotPersonal(data, "Pre-invariant layout", false, true)];
  const initialDeviceState = createDeviceLocalPluginState(createDefaultStore(structuredClone(data), 100, "vault-legacy-undo"));
  const { plugin } = pluginWithFiles(data, [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  }, initialDeviceState);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  await plugin.undo();

  const subject = plugin.data.portableIndex.subjects.find((candidate) => candidate.id === "legacy-medication");
  assert.deepEqual(
    { indexed: subject?.indexed, kind: subject?.recordKind, libraryId: subject?.libraryId },
    { indexed: false, kind: "medication", libraryId: "medication" },
  );
  assert.deepEqual(plugin.data.manualIndexPaths, []);
  assert.equal(plugin.savedData.length, 0, "normalization returned to the committed semantics; only local history changed");
  assert.ok(plugin.deviceLocalWrites.length > 0);
});

test("organization snapshot restoration repairs historical ENT Index membership atomically", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const invalid = invalidEntMedicationIndexData(medication);
  const historical = snapshotPersonal(invalid, "Pre-invariant layout", false, true);
  const current = structuredClone(invalid);
  const subject = current.portableIndex.subjects[0];
  assert.ok(subject);
  subject.indexed = false;
  subject.recordKind = "medication";
  subject.libraryId = "medication";
  current.manualIndexPaths = [];
  current.indexGroupByPath = {};
  const { plugin } = pluginWithFiles(createDefaultStore(current, 100, "vault-snapshot-repair"), [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  await plugin.mutate(
    "Restore historical snapshot",
    () => restoreSnapshot(plugin.data, historical),
    {
      includePortableIndex: true,
      requireUndo: true,
      normalizeAfterRestore: true,
    },
  );

  const restored = plugin.data.portableIndex.subjects.find((candidate) => candidate.id === "legacy-medication");
  assert.equal(restored?.indexed, false);
  assert.equal(restored?.recordKind, "medication");
  assert.equal(restored?.libraryId, "medication");
  assert.deepEqual(plugin.data.manualIndexPaths, []);
  assert.equal(plugin.savedData.length, 1);
});

test("Undo normalizes built-in Libraries and stale navigation from a legacy ENT snapshot", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.undoStack = [legacyEntSnapshotWithoutLibraries("Legacy Undo")];
  const store = createDefaultStore(data, 100, "vault-legacy-undo-libraries");
  const plugin = pluginWith(store, createDeviceLocalPluginState(store));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  await plugin.undo();

  assertEntLibrariesAndNavigationAreNormalized(plugin.data);
  assert.equal(plugin.savedData.length, 0, "an equivalent normalized Undo changes only device-local history");
  assert.ok(plugin.deviceLocalWrites.length > 0);
});

test("named snapshot restoration normalizes legacy ENT Libraries and navigation", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-legacy-named-libraries"));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const snapshot = legacyEntSnapshotWithoutLibraries("Legacy named snapshot");

  await plugin.mutate(
    "Restore legacy named snapshot",
    () => restoreSnapshot(plugin.data, snapshot),
    { includeSettings: true, includePortableIndex: true, includeActiveTab: true, normalizeAfterRestore: true },
  );

  assertEntLibrariesAndNavigationAreNormalized(plugin.data);
  assert.equal(plugin.savedData.length, 0, "equivalent normalized restoration changes only device-local history");
  assert.ok(plugin.deviceLocalWrites.length > 0);
});

test("failed named-snapshot restoration rolls back settings, navigation, snapshots, and portable data", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.workspaceName = "Current ENT";
  data.activeTab = "collections";
  data.layoutSnapshots = [snapshotPersonal(data, "Current named snapshot", true, true, false, true)];
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-snapshot-rollback"));
  await plugin.loadPluginData();
  const before = structuredClone(plugin.data);
  const snapshot = legacyEntSnapshotWithoutLibraries("Legacy named snapshot");
  let saveAttempts = 0;
  plugin.saveData = async (): Promise<void> => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated snapshot save failure");
  };

  await assert.rejects(plugin.mutate(
    "Restore legacy named snapshot",
    () => restoreSnapshot(plugin.data, snapshot),
    {
      includeSettings: Boolean(snapshot.settings),
      includePortableIndex: Boolean(snapshot.portableIndex),
      includeLayoutSnapshots: Boolean(snapshot.layoutSnapshots),
      includeActiveTab: snapshot.activeTab !== undefined,
      requireUndo: true,
      normalizeAfterRestore: true,
    },
  ), /simulated snapshot save failure/i);

  assert.deepEqual(plugin.data, before);
  assert.equal(saveAttempts, 2, "the failed write is followed by one persisted full-data rollback");
  assert.equal(plugin.getActiveKnowledgeBase().semanticRevision, 2, "the compensating rollback causally outranks the rejected revision 1 write");
});

test("a write-then-reject mutation publishes a causal compensating rollback", async () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-write-then-reject");
  const plugin = pluginWith(store);
  await plugin.loadPluginData(false);
  let attempted: PluginStore | null = null;
  let disk = structuredClone(store);
  let writes = 0;
  plugin.saveData = async (value: unknown) => {
    writes += 1;
    disk = structuredClone(value) as PluginStore;
    if (writes === 1) {
      attempted = structuredClone(disk);
      throw new Error("adapter rejected after replacing data.json");
    }
  };

  await assert.rejects(plugin.mutate("Rejected pin", () => {
    plugin.data.pinnedPaths = ["Rejected.md"];
  }), /adapter rejected after replacing/i);

  assert.ok(attempted);
  assert.equal(writes, 2);
  assert.deepEqual(plugin.data.pinnedPaths, []);
  assert.deepEqual(disk.bases[0].data.pinnedPaths, []);
  assert.ok(disk.bases[0].semanticLineage.includes(attempted.bases[0].semanticHead));
  const merged = mergeKnowledgeBaseStores(attempted, disk, disk.activeBaseId);
  assert.equal(merged.semanticConflicts.length, 0);
  assert.equal(merged.store.bases[0].semanticHead, disk.bases[0].semanticHead);
});

test("write-then-reject Undo and Redo each publish a causal rollback and restore local history", async () => {
  for (const direction of ["undo", "redo"] as const) {
    const data = migrateData(null);
    data.pinnedPaths = ["Current.md"];
    const historical = structuredClone(data);
    historical.pinnedPaths = ["Historical.md"];
    const snapshot = snapshotPersonal(historical, `${direction} target`);
    if (direction === "undo") data.undoStack = [snapshot];
    else data.redoStack = [snapshot];
    const store = createDefaultStore(data, 100, `vault-rejected-${direction}`);
    const plugin = pluginWith(store, createDeviceLocalPluginState(store));
    await plugin.loadPluginData(false);
    let attempted: PluginStore | null = null;
    let disk = structuredClone(store);
    let writes = 0;
    plugin.saveData = async (value: unknown) => {
      writes += 1;
      disk = structuredClone(value) as PluginStore;
      if (writes === 1) {
        attempted = structuredClone(disk);
        throw new Error(`rejected ${direction} after write`);
      }
    };

    await assert.rejects(direction === "undo" ? plugin.undo() : plugin.redo(), new RegExp(`rejected ${direction}`));

    assert.ok(attempted);
    assert.equal(writes, 2);
    assert.deepEqual(plugin.data.pinnedPaths, ["Current.md"]);
    assert.ok(disk.bases[0].semanticLineage.includes(attempted.bases[0].semanticHead));
    assert.equal(direction === "undo" ? plugin.data.undoStack.length : plugin.data.redoStack.length, 1);
  }
});

test("recovery restoration normalizes legacy empty ENT Libraries and navigation", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-legacy-recovery-libraries"));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const recovery = legacyEntSnapshotWithoutLibraries("Legacy recovery");

  await plugin.mutate("Import legacy organization recovery", () => {
    plugin.data.settings = structuredClone(recovery.settings ?? plugin.data.settings);
    plugin.data.activeTab = recovery.activeTab ?? plugin.data.activeTab;
    plugin.data.savedViews = recovery.savedViews.map((view) => ({ ...view }));
    plugin.data.portableIndex = structuredClone(recovery.portableIndex ?? plugin.data.portableIndex);
  }, {
    includeSettings: true,
    includePortableIndex: true,
    includeLayoutSnapshots: true,
    includeActiveTab: true,
    requireUndo: true,
    normalizeAfterRestore: true,
  });

  assertEntLibrariesAndNavigationAreNormalized(plugin.data);
  assert.equal(plugin.savedData.length, 0, "equivalent normalized recovery changes only device-local history");
  assert.ok(plugin.deviceLocalWrites.length > 0);
});

test("a failed ENT startup remediation write restores the complete pre-remediation store", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.portableIndex.groups = [{ id: "legacy", title: "Legacy", order: 0 }];
  data.portableIndex.subjects = [{
    id: "legacy-medication",
    title: "Allergodil",
    groupId: "legacy",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "medication",
    libraryId: null,
  }];
  data.portableIndex.resolvedPathBySubjectId = { "legacy-medication": medication.path };
  const { plugin, sourceMutationCount } = pluginWithFiles(
    createDefaultStore(data, 100, "vault-remediation-failure"),
    [medication],
    { [medication.path]: { title: "Allergodil" } },
  );
  let saveAttempts = 0;
  plugin.saveData = async (): Promise<void> => {
    saveAttempts += 1;
    throw new Error("disk full");
  };

  await assert.rejects(plugin.loadPluginData(), /disk full/i);

  const restored = plugin.data.portableIndex.subjects.find((subject) => subject.id === "legacy-medication");
  assert.equal(saveAttempts, 1);
  assert.equal(restored?.indexed, true);
  assert.equal(restored?.recordKind, "medication");
  assert.equal(restored?.libraryId, undefined);
  assert.equal(sourceMutationCount(), 0);
});

test("unrecognized versionless data enters read-only mode and is never overwritten", async () => {
  Notice.messages.length = 0;
  const original = { unrelatedApplicationState: { keep: true } };
  const plugin = pluginWith(original);
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /unrecognized shape/i);
  assert.equal(plugin.savedData.length, 0);
  assert.equal(Notice.messages.some((message) => /read-only/i.test(message)), true);
  await plugin.savePluginData();
  assert.equal(plugin.savedData.length, 0);
});

test("future data versions enter read-only mode rather than being downgraded", async () => {
  const plugin = pluginWith({ version: 99, collections: [], settings: { workspaceMode: "generic" } });
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.equal(plugin.savedData.length, 0);
});

test("oversized current plugin data opens read-only and never overwrites the original envelope", async () => {
  const data = migrateData(null);
  data.savedViews = [{
    id: "view-long",
    name: "Long query",
    tab: "curriculum",
    query: "x".repeat(MAX_TRANSFER_TEXT_LENGTH + 1),
  }];
  const original = createDefaultStore(data, 100, "vault-oversized-current");
  const before = structuredClone(original);
  const plugin = pluginWith(original);

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, false);
  assert.match(plugin.dataCompatibilityWarning, /could not be migrated.*longer than/i);
  assert.equal(plugin.isDataReadOnly(), true);
  assert.equal(plugin.savedData.length, 0);
  assert.deepEqual(original, before, "validation must not mutate the unsafe source object");
  await plugin.savePluginData();
  assert.equal(plugin.savedData.length, 0, "read-only mode cannot replace the unsafe data.json");
});

test("oversized newer flat data also fails closed without crashing or writing defaults", async () => {
  const original = {
    version: DATA_VERSION + 1,
    collections: [],
    savedViews: [{
      id: "future-long",
      name: "Future",
      tab: "curriculum",
      query: "x".repeat(MAX_TRANSFER_TEXT_LENGTH + 1),
    }],
    settings: { workspaceMode: "generic" },
  };
  const plugin = pluginWith(original);

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, false);
  assert.match(plugin.dataCompatibilityWarning, /could not be safely inspected.*read-only/i);
  assert.equal(plugin.savedData.length, 0);
});

test("an oversized current Sync capture leaves the committed base active and the capture untouched", async () => {
  const localData = migrateData(null);
  localData.settings.workspaceName = "Committed local base";
  const local = createDefaultStore(localData, 100, "vault-oversized-sync");
  const plugin = pluginWith(structuredClone(local));
  await plugin.loadPluginData(false);
  plugin.savedData.length = 0;

  const incoming = structuredClone(local);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  incomingBase.updatedAt = 200;
  incomingBase.data.savedViews = [{
    id: "remote-long",
    name: "Remote long query",
    tab: "curriculum",
    query: "x".repeat(MAX_TRANSFER_TEXT_LENGTH + 1),
  }];
  const before = structuredClone(incoming);
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.data.settings.workspaceName, "Committed local base");
  assert.deepEqual(plugin.data.savedViews, []);
  assert.match(plugin.dataCompatibilityWarning, /could not be migrated.*longer than/i);
  assert.equal(plugin.savedData.length, 0, "the incompatible Sync capture remains authoritative on disk");
  assert.deepEqual(incoming, before, "the captured unsafe value is never cleaned in place");
});

test("damaged recognized flat and current shapes start read-only without one corrective write", async () => {
  const current = createDefaultStore(migrateData(null), 100, "vault-damaged-startup");
  (current.bases[0]?.data as unknown as Record<string, unknown>).displayNameByPath = [];
  const cases: Array<[string, unknown]> = [
    ["legacy v1 without headings", { version: 1, selectedPath: "Legacy.md" }],
    ["legacy v2 with an invalid collection shape", { version: 2, collections: {}, settings: { workspaceMode: "generic" } }],
    ["current envelope with an invalid path map", current],
  ];

  for (const [label, original] of cases) {
    const before = structuredClone(original);
    const plugin = pluginWith(original);
    const result = await plugin.loadPluginData();
    assert.equal(result.compatible, false, label);
    assert.equal(plugin.isDataReadOnly(), true, label);
    assert.equal(plugin.savedData.length, 0, label);
    assert.deepEqual(original, before, `${label} must not be cleaned in place`);
    await plugin.savePluginData();
    assert.equal(plugin.savedData.length, 0, `${label} remains protected after a save request`);
  }
});

test("malformed explicit inner and outer versions start read-only without overwriting data", async () => {
  const malformedVersions: unknown[] = ["1e999", "2.5", "banana"];
  for (const location of ["inner", "outer"] as const) {
    for (const version of malformedVersions) {
      const original = createDefaultStore(migrateData(null), 100, `vault-malformed-${location}-${String(version)}`);
      if (location === "inner") {
        (original.bases[0]?.data as unknown as Record<string, unknown>).version = version;
      } else {
        (original as unknown as Record<string, unknown>).version = version;
      }
      const before = structuredClone(original);
      const plugin = pluginWith(original);

      const result = await plugin.loadPluginData();

      assert.equal(result.compatible, false, `${location} ${String(version)}`);
      assert.equal(plugin.isDataReadOnly(), true, `${location} ${String(version)}`);
      assert.equal(plugin.savedData.length, 0, `${location} ${String(version)}`);
      assert.deepEqual(original, before, `${location} ${String(version)} source must remain untouched`);
      await plugin.savePluginData();
      assert.equal(plugin.savedData.length, 0, `${location} ${String(version)} remains protected`);
    }
  }
});

test("same-identity Sync rejects malformed inner and outer versions without a writeback", async () => {
  const malformedVersions: unknown[] = ["1e999", "2.5", "banana"];
  for (const location of ["inner", "outer"] as const) {
    for (const version of malformedVersions) {
      const localData = migrateData(null);
      localData.settings.workspaceName = `Committed ${location} ${String(version)}`;
      const local = createDefaultStore(localData, 100, `vault-sync-version-${location}-${String(version)}`);
      const plugin = pluginWith(structuredClone(local));
      await plugin.loadPluginData(false);
      plugin.savedData.length = 0;

      const incoming = structuredClone(local);
      const incomingBase = incoming.bases[0];
      assert.ok(incomingBase);
      incomingBase.updatedAt = 200;
      if (location === "inner") {
        (incomingBase.data as unknown as Record<string, unknown>).version = version;
      } else {
        (incoming as unknown as Record<string, unknown>).version = version;
      }
      const before = structuredClone(incoming);
      plugin.loadedData = incoming;

      await plugin.onExternalSettingsChange();

      assert.equal(plugin.data.settings.workspaceName, `Committed ${location} ${String(version)}`);
      assert.equal(plugin.isDataReadOnly(), true, `${location} ${String(version)}`);
      assert.equal(plugin.savedData.length, 0, `${location} ${String(version)} must not write back`);
      assert.deepEqual(incoming, before, `${location} ${String(version)} Sync capture remains untouched`);
      assert.match(plugin.dataCompatibilityWarning, /unrecognized shape|could not be migrated/i);
    }
  }
});

test("a wrong-type authoritative list from Sync never replaces or rewrites the committed store", async () => {
  const localData = migrateData(null);
  localData.settings.workspaceName = "Committed before damaged Sync";
  const local = createDefaultStore(localData, 100, "vault-damaged-sync-shape");
  const plugin = pluginWith(structuredClone(local));
  await plugin.loadPluginData(false);
  plugin.savedData.length = 0;

  const incoming = structuredClone(local);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  incomingBase.updatedAt = 200;
  (incomingBase.data as unknown as Record<string, unknown>).pinnedPaths = ["Knowledge Base/Good.md", { nested: true }];
  const before = structuredClone(incoming);
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.data.settings.workspaceName, "Committed before damaged Sync");
  assert.deepEqual(plugin.data.pinnedPaths, []);
  assert.equal(plugin.savedData.length, 0, "the damaged Sync file remains untouched on disk");
  assert.deepEqual(incoming, before);
  assert.match(plugin.dataCompatibilityWarning, /could not be migrated.*must be text/i);
});

test("an older build treats a future semantic store envelope as read-only", async () => {
  const future = createDefaultStore(migrateData(null), 100, "vault-future-semantic-store");
  future.version = STORE_VERSION + 1;
  future.bases[0].semanticRevision = 42;
  future.bases[0].data.settings.workspaceName = "Future organization";
  const plugin = pluginWith(future);

  await plugin.loadPluginData();

  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.equal(plugin.data.settings.workspaceName, "Future organization");
  assert.equal(plugin.getActiveKnowledgeBase().semanticRevision, 42);
  assert.equal(plugin.savedData.length, 0);
  await plugin.savePluginData();
  assert.equal(plugin.savedData.length, 0);
});

test("a future inner data version makes the complete store read-only", async () => {
  const future = createDefaultStore(migrateData(null), 100, "vault-future-inner-data");
  const futureBase = future.bases[0];
  assert.ok(futureBase);
  (futureBase.data as { version: number }).version = DATA_VERSION + 1;
  futureBase.data.settings.workspaceName = "Future inner organization";
  const original = structuredClone(future);
  const plugin = pluginWith(future);

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, false);
  assert.match(plugin.dataCompatibilityWarning, /unsupported data version/i);
  assert.equal(plugin.savedData.length, 0);
  assert.deepEqual(future, original);
});

test("archiving the active knowledge base switches atomically and never archives the last available base", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  assert.equal(plugin.savedData.length, 0, "a current v11 store should not be rewritten during load");

  await plugin.archiveKnowledgeBase("base-default");
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(plugin.data.settings.workspaceName, "Second KB");
  assert.notEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.archivedAt, null);
  assert.deepEqual(plugin.getKnowledgeBases().map((entry) => entry.id), ["base-second"]);

  const savesAfterArchive = plugin.savedData.length;
  await assert.rejects(plugin.archiveKnowledgeBase("base-second"), /last one/i);
  assert.equal(plugin.savedData.length, savesAfterArchive, "a rejected last-base archive must not write data");
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");

  await plugin.restoreKnowledgeBase("base-default");
  await plugin.switchKnowledgeBase("base-default");
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.settings.workspaceName, "First KB");
});

test("permanent deletion accepts only an unchanged archived base and never touches Markdown", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "Keep available";
  const second = migrateData(null);
  second.settings.workspaceName = "Delete archived";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const { plugin, sourceMutationCount, vaultEnumerationCount } = pluginWithFiles(store, [], {});
  await plugin.loadPluginData();

  await assert.rejects(
    plugin.deleteArchivedKnowledgeBase("base-default", plugin.getActiveKnowledgeBase().updatedAt),
    /active knowledge base cannot be permanently deleted/i,
  );
  await assert.rejects(
    plugin.deleteArchivedKnowledgeBase("base-second", plugin.getKnowledgeBases(true)[1]?.updatedAt ?? 0),
    /archive this knowledge base/i,
  );

  await plugin.archiveKnowledgeBase("base-second");
  const archived = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-second");
  assert.ok(archived);
  await assert.rejects(
    plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt - 1),
    /changed after the confirmation opened/i,
  );
  await plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt);

  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.id), ["base-default"]);
  const saved = plugin.savedData.at(-1) as { deletedBaseIds?: Record<string, number> };
  assert.ok((saved.deletedBaseIds?.[archived.id] ?? 0) > archived.updatedAt);
  assert.equal(plugin.getKnowledgeBases().length, 1);
  assert.equal(sourceMutationCount(), 0);
  assert.equal(vaultEnumerationCount(), 0);
});

test("deleting an archived base frees one of the fifty lifecycle slots", async () => {
  const active = migrateData(null);
  active.settings.workspaceName = "Active";
  const store = createDefaultStore(active, 100);
  for (let index = 1; index < MAX_KNOWLEDGE_BASES; index += 1) {
    const data = migrateData(null);
    data.settings.workspaceName = `Archived ${index}`;
    const entry = createKnowledgeBaseEntry(data, `base-archived-${index}`, 100 + index);
    entry.archivedAt = 1_000 + index;
    entry.updatedAt = entry.archivedAt;
    entry.semanticRevision = index;
    store.bases.push(entry);
  }
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  await assert.rejects(
    plugin.createKnowledgeBase("Over capacity", "generic", "Knowledge Bases/Over capacity"),
    /maximum of 50 knowledge bases/i,
  );

  const archived = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-archived-1");
  assert.ok(archived);
  await plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt);
  const created = await plugin.createKnowledgeBase("Replacement", "generic", "Knowledge Bases/Replacement");

  assert.equal(plugin.getKnowledgeBases(true).length, MAX_KNOWLEDGE_BASES);
  assert.equal(plugin.getActiveKnowledgeBaseId(), created.id);
  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.id === archived.id), false);
  const saved = plugin.savedData.at(-1) as { deletedBaseIds?: Record<string, number> };
  assert.ok(saved.deletedBaseIds?.[archived.id]);
});

test("a failed archived-base deletion save restores both the base and its tombstone state", async () => {
  const first = migrateData(null);
  const second = migrateData(null);
  const store = createDefaultStore(first, 100);
  const archived = createKnowledgeBaseEntry(second, "base-archived", 200);
  archived.archivedAt = 300;
  archived.updatedAt = 300;
  archived.semanticRevision = 1;
  store.bases.push(archived);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.saveData = () => Promise.reject(new Error("simulated deletion save failure"));

  await assert.rejects(plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt), /simulated deletion save failure/i);

  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.id === archived.id), true);
  const currentStore = (plugin as unknown as { store: { deletedBaseIds: Record<string, number> } }).store;
  assert.equal(currentStore.deletedBaseIds[archived.id], undefined);
});

test("permanent deletion refuses to evict an older tombstone when its safety map is full", async () => {
  const store = createDefaultStore(migrateData(null), 100);
  const archived = createKnowledgeBaseEntry(migrateData(null), "base-archived", 200);
  archived.archivedAt = 300;
  archived.updatedAt = 300;
  archived.semanticRevision = 1;
  store.bases.push(archived);
  store.deletedBaseIds = Object.fromEntries(Array.from(
    { length: MAX_DELETED_KNOWLEDGE_BASE_IDS },
    (_, index) => [`base-already-deleted-${index}`, index + 1],
  ));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();

  await assert.rejects(
    plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt),
    /already contains 10,000 permanent-deletion tombstones.*no older tombstone was discarded/i,
  );

  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.id === archived.id), true);
});

test("knowledge-base switching is device-local while failed creation restores the active base and base list", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  let saveAttempts = 0;
  let compensated: PluginStore | null = null;
  plugin.saveData = (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) return Promise.reject(new Error("simulated knowledge-base save failure"));
    compensated = structuredClone(value) as PluginStore;
    return Promise.resolve();
  };

  await plugin.switchKnowledgeBase("base-second");
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(plugin.data.settings.workspaceName, "Second KB");
  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.id), ["base-default", "base-second"]);

  await assert.rejects(
    plugin.createKnowledgeBase("Unsaved KB", "generic", "Knowledge Base"),
    /simulated knowledge-base save failure/,
  );
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(plugin.data.settings.workspaceName, "Second KB");
  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.id), ["base-default", "base-second"]);
  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.data.settings.workspaceName === "Unsaved KB"), false);
  assert.equal(saveAttempts, 2, "the rejected creation is followed by a tombstone compensation for its stable ID");
  assert.equal(Object.keys(compensated?.deletedBaseIds ?? {}).length, 1);
  assert.equal(plugin.isDataReadOnly(), false);
});

test("knowledge-base lifecycle changes flush settings before snapshotting or rebinding data", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100, "vault-settings-lifecycle-barrier");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  let barrierCalls = 0;
  (plugin as unknown as {
    settingsTab: { prepareForKnowledgeBaseChange(): Promise<boolean> };
  }).settingsTab = {
    prepareForKnowledgeBaseChange: async () => {
      barrierCalls += 1;
      plugin.data.settings.workspaceSubtitle = "Committed before switch";
      await plugin.savePluginData();
      return true;
    },
  };

  await plugin.switchKnowledgeBase("base-second");

  assert.equal(barrierCalls, 1);
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  const finalStore = plugin.savedData.at(-1) as PluginStore;
  assert.equal(
    finalStore.bases.find((entry) => entry.id === "base-default")?.data.settings.workspaceSubtitle,
    "Committed before switch",
  );
});

test("a busy organization transaction rejects a base change before flushing settings", async () => {
  const first = migrateData(null);
  const second = migrateData(null);
  const store = createDefaultStore(first, 100, "vault-settings-busy-barrier");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  let barrierCalls = 0;
  const internal = plugin as unknown as {
    dataTransactionBusy: boolean;
    settingsTab: { prepareForKnowledgeBaseChange(): Promise<boolean> };
  };
  internal.settingsTab = {
    prepareForKnowledgeBaseChange: async () => {
      barrierCalls += 1;
      return true;
    },
  };
  internal.dataTransactionBusy = true;

  await assert.rejects(
    plugin.switchKnowledgeBase("base-second"),
    /Finish the current organization change/,
  );

  assert.equal(barrierCalls, 0, "the settings draft must not snapshot transaction-owned intermediate memory");
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
});

test("a failed settings convergence barrier blocks the knowledge-base lifecycle change", async () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-settings-failed-barrier");
  store.bases.push(createKnowledgeBaseEntry(migrateData(null), "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  (plugin as unknown as {
    settingsTab: { prepareForKnowledgeBaseChange(): Promise<boolean> };
  }).settingsTab = { prepareForKnowledgeBaseChange: async () => false };

  await assert.rejects(
    plugin.switchKnowledgeBase("base-second"),
    /Save or restore the pending settings change/,
  );

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
});

test("Sync captures of rejected create, duplicate, archive, and restore operations converge on their compensated envelopes", async () => {
  for (const kind of ["create", "duplicate", "archive", "restore"] as const) {
    const app = {
      vault: emptyWritableTestVault(),
      workspace: { getLeavesOfType: () => [] },
      metadataCache: { getFileCache: () => null },
      fileManager: {},
    };
    const primary = migrateData(null);
    primary.settings.workspaceName = "Primary";
    let disk = createDefaultStore(primary, 100, `vault-rejected-envelope-${kind}`);
    const secondary = createKnowledgeBaseEntry(migrateData(null), "base-secondary", 200);
    secondary.data.settings.workspaceName = "Secondary";
    if (kind === "restore") {
      secondary.archivedAt = 300;
      secondary.updatedAt = 300;
      secondary.semanticRevision = 1;
      secondary.semanticHash = semanticEntryFingerprint(secondary);
      secondary.semanticHead = secondary.semanticHash;
    }
    disk.bases.push(secondary);
    const baseline = structuredClone(disk);
    const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
    plugin.loadData = async () => structuredClone(disk);
    const partialWriteReachedDisk = deferred();
    const releaseRejection = deferred();
    let writes = 0;
    let rejectedEnvelope: PluginStore | null = null;
    plugin.saveData = async (value: unknown) => {
      writes += 1;
      disk = structuredClone(value) as PluginStore;
      if (writes === 1) {
        rejectedEnvelope = structuredClone(disk);
        partialWriteReachedDisk.resolve();
        await releaseRejection.promise;
        throw new Error(`rejected ${kind} after replacing data.json`);
      }
    };
    await plugin.loadPluginData(false);

    const operation = kind === "create"
      ? plugin.createKnowledgeBase("Created", "generic", "Knowledge Base")
      : kind === "duplicate"
        ? plugin.duplicateKnowledgeBase("base-default", "Duplicated")
        : kind === "archive"
          ? plugin.archiveKnowledgeBase("base-secondary")
          : plugin.restoreKnowledgeBase("base-secondary");
    await partialWriteReachedDisk.promise;
    const reload = plugin.onExternalSettingsChange();
    releaseRejection.resolve();

    await assert.rejects(operation, new RegExp(`rejected ${kind}`, "i"));
    await reload;

    assert.ok(rejectedEnvelope);
    assert.equal(plugin.isDataReadOnly(), false, `${kind} has a monotonic safe compensation`);
    assert.equal(writes, 2, `${kind} writes one authoritative compensation after the rejected envelope`);
    if (kind === "create" || kind === "duplicate") {
      const rejectedIds = rejectedEnvelope.bases
        .map((entry) => entry.id)
        .filter((id) => !baseline.bases.some((entry) => entry.id === id));
      assert.equal(rejectedIds.length, 1);
      assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.id === rejectedIds[0]), false);
      assert.equal(Object.prototype.hasOwnProperty.call(disk.deletedBaseIds, rejectedIds[0] ?? ""), true);
    } else {
      const restored = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-secondary");
      assert.equal(restored?.archivedAt, baseline.bases.find((entry) => entry.id === "base-secondary")?.archivedAt);
      assert.equal(disk.bases.find((entry) => entry.id === "base-secondary")?.archivedAt, restored?.archivedAt);
    }
  }
});

test("a direct save requested behind a queued Sync reload rejects without deadlocking the reload", async () => {
  let disk = createDefaultStore(migrateData(null), 100, "vault-reload-before-direct-save");
  const plugin = pluginWith(disk);
  plugin.loadData = async () => structuredClone(disk);
  plugin.saveData = async (value: unknown) => { disk = structuredClone(value) as PluginStore; };
  await plugin.loadPluginData(false);

  const reload = plugin.onExternalSettingsChange();
  plugin.data.pinnedPaths = ["Too-late local edit.md"];
  const save = plugin.savePluginData();
  const [reloadResult, saveResult] = await bounded(
    Promise.allSettled([reload, save]),
    "Sync reload followed by direct save",
  );

  assert.equal(reloadResult.status, "fulfilled");
  assert.equal(saveResult.status, "rejected");
  assert.deepEqual(plugin.data.pinnedPaths, [], "the late edit is restored before the Sync payload is adopted");
  assert.equal(plugin.isDataReadOnly(), false);
});

test("a real SettingsTab compensation behind Sync completes without a logical-barrier deadlock", async () => {
  let disk = createDefaultStore(migrateData(null), 100, "vault-settings-sync-progress");
  const plugin = pluginWith(disk);
  plugin.loadData = async () => structuredClone(disk);
  const firstWriteStarted = deferred();
  const releaseFirstWrite = deferred();
  let writes = 0;
  plugin.saveData = async (value: unknown) => {
    writes += 1;
    if (writes === 1) {
      firstWriteStarted.resolve();
      await releaseFirstWrite.promise;
    }
    disk = structuredClone(value) as PluginStore;
  };
  await plugin.loadPluginData(false);
  const settingsTab = settingsTabForPlugin(plugin);

  plugin.data.settings.workspaceSubtitle = "Overlapping settings edit";
  const settingsSave = settingsTab.save(false);
  await firstWriteStarted.promise;
  const remote = createDefaultStore(migrateData(null), 100, "vault-settings-sync-progress");
  const remoteEntry = remote.bases[0];
  if (!remoteEntry) throw new Error("The test remote store has no active base.");
  advanceStoreEntry(remoteEntry, () => { remoteEntry.data.nextStudyPaths = ["Remote.md"]; });
  disk = remote;
  const reload = plugin.onExternalSettingsChange();
  releaseFirstWrite.resolve();

  const [settingsResult, reloadResult] = await bounded(
    Promise.all([settingsSave, reload]),
    "SettingsTab rollback delegated to Sync reload",
  );
  assert.equal(settingsResult, false);
  assert.equal(reloadResult, undefined);
  assert.equal(plugin.data.settings.workspaceSubtitle, migrateData(null).settings.workspaceSubtitle);
  assert.equal(
    disk.bases.find((entry) => entry.id === disk.activeBaseId)?.data.settings.workspaceSubtitle,
    migrateData(null).settings.workspaceSubtitle,
    "the reload worker publishes the restored setting after the rejected adapter write",
  );
  assert.equal(writes, 2, "one rejected setting write is followed by one authoritative Sync writeback");
  assert.equal(plugin.isDataReadOnly(), false);
});

test("an unloaded SettingsTab does not poison a successful host compensation", async () => {
  const sharedApp = {
    vault: emptyWritableTestVault(),
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  let disk = createDefaultStore(migrateData(null), 100, "vault-unloaded-settings-compensation");
  const oldPlugin = new EntVaultCommandCenterPlugin(sharedApp as never, {} as never);
  oldPlugin.loadData = async () => structuredClone(disk);
  await oldPlugin.loadPluginData(false);
  const firstWriteStarted = deferred();
  const releaseFirstWrite = deferred();
  let writes = 0;
  oldPlugin.saveData = async (value: unknown) => {
    writes += 1;
    disk = structuredClone(value) as PluginStore;
    if (writes === 1) {
      firstWriteStarted.resolve();
      await releaseFirstWrite.promise;
      throw new Error("setting rejected after replacing data.json");
    }
  };
  const settingsTab = settingsTabForPlugin(oldPlugin);
  oldPlugin.data.settings.workspaceSubtitle = "Rejected partial setting";
  const settingsSave = settingsTab.save(false);
  await firstWriteStarted.promise;
  oldPlugin.onunload();

  const replacement = new EntVaultCommandCenterPlugin(sharedApp as never, {} as never);
  replacement.loadData = async () => structuredClone(disk);
  const replacementLoad = replacement.loadPluginData(false);
  releaseFirstWrite.resolve();
  assert.equal(await bounded(settingsSave, "unloaded SettingsTab fallback"), false);
  await bounded(replacementLoad, "replacement after host compensation");

  assert.equal(writes, 2, "the host writes one causal compensation; the stale tab adds no third write");
  assert.equal(replacement.data.settings.workspaceSubtitle, migrateData(null).settings.workspaceSubtitle);
  assert.equal(replacement.isDataReadOnly(), false);
});

test("a rejected permanent deletion with a captured tombstone fails closed across replacement instances", async () => {
  const app = {
    vault: emptyWritableTestVault(),
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  let disk = createDefaultStore(migrateData(null), 100, "vault-rejected-permanent-delete");
  const archived = createKnowledgeBaseEntry(migrateData(null), "base-archived", 200);
  archived.archivedAt = 300;
  archived.updatedAt = 300;
  archived.semanticRevision = 1;
  archived.semanticHash = semanticEntryFingerprint(archived);
  archived.semanticHead = archived.semanticHash;
  disk.bases.push(archived);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const partialWriteReachedDisk = deferred();
  const releaseRejection = deferred();
  let writes = 0;
  plugin.saveData = async (value: unknown) => {
    writes += 1;
    disk = structuredClone(value) as PluginStore;
    partialWriteReachedDisk.resolve();
    await releaseRejection.promise;
    throw new Error("rejected permanent delete after replacing data.json");
  };
  await plugin.loadPluginData(false);

  const deletion = plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt);
  await partialWriteReachedDisk.promise;
  const reload = plugin.onExternalSettingsChange();
  releaseRejection.resolve();
  await assert.rejects(deletion, /rejected permanent delete/i);
  await reload;

  assert.equal(writes, 1, "an irreversible tombstone is never followed by a pretend resurrection write");
  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.id === archived.id), true, "the in-memory recovery remains exportable");
  assert.equal(plugin.isDataReadOnly(), true);
  assert.match(plugin.dataCompatibilityWarning, /permanent knowledge-base deletion|tombstone/i);

  plugin.onunload();
  const replacement = new EntVaultCommandCenterPlugin(app as never, {} as never);
  replacement.loadData = async () => structuredClone(disk);
  await replacement.loadPluginData(false);
  assert.equal(replacement.isDataReadOnly(), true, "the shared App uncertainty marker survives plugin replacement");
  assert.match(replacement.dataCompatibilityWarning, /permanent knowledge-base deletion|tombstone/i);
});

test("a failed base-operation compensation enters sticky uncertain-persistence mode", async () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-base-compensation-failure");
  const plugin = pluginWith(store);
  await plugin.loadPluginData(false);
  let writes = 0;
  plugin.saveData = async () => {
    writes += 1;
    throw new Error(writes === 1 ? "base write rejected" : "base compensation rejected");
  };

  await assert.rejects(
    plugin.createKnowledgeBase("Uncertain create", "generic", "Knowledge Base"),
    /organization is now read-only/i,
  );

  assert.equal(writes, 2);
  assert.equal(plugin.isDataReadOnly(), true);
  assert.match(plugin.dataCompatibilityWarning, /compensating rollback could not be saved/i);
  await assert.rejects(plugin.createKnowledgeBase("Blocked", "generic", "Knowledge Base"), /read-only|compensating rollback/i);
});

test("queued saves retain their call-time base snapshot while a knowledge-base switch waits", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  const firstSaveStarted = deferred();
  const releaseFirstSave = deferred();
  const snapshots: Array<{
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: { settings?: { workspaceName?: string } } }>;
  }> = [];
  let saveCall = 0;
  plugin.saveData = async (value: unknown) => {
    snapshots.push(structuredClone(value) as (typeof snapshots)[number]);
    const call = saveCall;
    saveCall += 1;
    if (call === 0) {
      firstSaveStarted.resolve();
      await releaseFirstSave.promise;
      return;
    }
    throw new Error("Unexpected extra save");
  };

  plugin.data.settings.workspaceName = "First snapshot";
  const pendingSave = plugin.savePluginData();
  await firstSaveStarted.promise;
  plugin.data.settings.workspaceName = "First changed after save call";
  const pendingSwitch = plugin.switchKnowledgeBase("base-second");

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default", "the switch must wait for the active adapter write");
  assert.equal(snapshots[0]?.activeBaseId, "base-default");
  assert.equal(snapshots[0]?.bases?.find((entry) => entry.id === "base-default")?.data?.settings?.workspaceName, "First snapshot");

  releaseFirstSave.resolve();
  await pendingSave;
  await pendingSwitch;
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(saveCall, 1, "switching active bases writes only per-vault localStorage");
});

test("a replacement plugin instance waits for an old in-flight write before reading data", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initialData = migrateData(null);
  initialData.settings.workspaceName = "Initial";
  const initialStore = createDefaultStore(initialData, 1, "vault-cross-instance-write-barrier");
  let disk = structuredClone(initialStore);
  const oldPlugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  oldPlugin.loadData = async () => structuredClone(disk);
  await oldPlugin.loadPluginData();
  const oldWriteStarted = deferred();
  const releaseOldWrite = deferred();
  const writeOrder: string[] = [];
  oldPlugin.saveData = async (value: unknown): Promise<void> => {
    oldWriteStarted.resolve();
    await releaseOldWrite.promise;
    disk = structuredClone(value) as typeof disk;
    writeOrder.push("old");
  };
  oldPlugin.data.pinnedPaths = ["Old-instance.md"];
  const oldSave = oldPlugin.savePluginData();
  await oldWriteStarted.promise;
  oldPlugin.onunload();

  const newPlugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  let newReadStarted = false;
  newPlugin.loadData = async () => {
    newReadStarted = true;
    return structuredClone(disk);
  };
  let newLoadFinished = false;
  const newLoad = newPlugin.loadPluginData().then(() => { newLoadFinished = true; });
  await Promise.resolve();
  assert.equal(newReadStarted, false, "the replacement cannot read a stale file while the old adapter write is running");
  assert.equal(newLoadFinished, false);

  releaseOldWrite.resolve();
  await Promise.all([oldSave, newLoad]);
  assert.deepEqual(newPlugin.data.pinnedPaths, ["Old-instance.md"], "the replacement starts from the old instance's final edit");

  let newWriteStarted = false;
  newPlugin.saveData = async (value: unknown): Promise<void> => {
    newWriteStarted = true;
    disk = structuredClone(value) as typeof disk;
    writeOrder.push("new");
  };
  newPlugin.data.nextStudyPaths = ["Replacement-instance.md"];
  await newPlugin.savePluginData();

  assert.equal(newWriteStarted, true);
  assert.deepEqual(writeOrder, ["old", "new"]);
  const persisted = disk.bases.find((entry) => entry.id === disk.activeBaseId)?.data;
  assert.deepEqual(persisted?.pinnedPaths, ["Old-instance.md"]);
  assert.deepEqual(persisted?.nextStudyPaths, ["Replacement-instance.md"]);
});

test("replacement waits for an old write-then-reject transaction through compensation", async () => {
  for (const compensationFails of [false, true]) {
    const app = {
      vault: emptyWritableTestVault(),
      workspace: { getLeavesOfType: () => [] },
      metadataCache: { getFileCache: () => null },
      fileManager: {},
    };
    const initial = createDefaultStore(migrateData(null), 100, `vault-replacement-compensation-${compensationFails}`);
    let disk = structuredClone(initial);
    const oldPlugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
    oldPlugin.loadData = async () => structuredClone(disk);
    await oldPlugin.loadPluginData(false);
    const firstWriteStarted = deferred();
    const releaseFirstWrite = deferred();
    let writes = 0;
    oldPlugin.saveData = async (value: unknown) => {
      writes += 1;
      disk = structuredClone(value) as PluginStore;
      if (writes === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
        throw new Error("old instance rejected after write");
      }
      if (compensationFails) throw new Error("old instance compensation rejected");
    };
    oldPlugin.data.pinnedPaths = ["Old rejected.md"];
    const oldSave = oldPlugin.savePluginData();
    await firstWriteStarted.promise;
    oldPlugin.onunload();

    const replacement = new EntVaultCommandCenterPlugin(app as never, {} as never);
    let readStarted = false;
    replacement.loadData = async () => {
      readStarted = true;
      return structuredClone(disk);
    };
    const replacementLoad = replacement.loadPluginData(false);
    await Promise.resolve();
    assert.equal(readStarted, false, "replacement read waits for the old logical transaction, not only its first adapter write");
    releaseFirstWrite.resolve();
    await assert.rejects(oldSave, /old instance rejected after write|compensating rollback also failed/i);
    await replacementLoad;

    assert.equal(writes, 2);
    assert.deepEqual(disk.bases[0]?.data.pinnedPaths, []);
    assert.deepEqual(replacement.data.pinnedPaths, []);
    assert.equal(replacement.isDataReadOnly(), compensationFails);
    if (compensationFails) assert.match(replacement.dataCompatibilityWarning, /compensating rollback could not be saved/i);
  }
});

test("replacement waits for an old external-Sync writeback to fail closed after a partial write", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const app = {
    vault: {
      ...emptyWritableTestVault(),
      getMarkdownFiles: () => [medication],
      getAbstractFileByPath: (path: string) => path === medication.path ? medication : null,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => file.path === medication.path
        ? { frontmatter: { title: "Allergodil", ent_domains: ["Rhinology"] } }
        : null,
      resolvedLinks: {},
    },
    fileManager: {},
  };
  const initialData = migrateData(null);
  initialData.settings.workspaceMode = "ent-clinical";
  const initial = createDefaultStore(initialData, 100, "vault-replacement-external-writeback");
  let disk: PluginStore = structuredClone(initial);
  const oldPlugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  oldPlugin.loadData = async () => structuredClone(disk);
  await oldPlugin.loadPluginData(false);

  // The incoming file places a medication in the protected topic index. Its
  // deterministic invariant repair requires an authoritative writeback.
  const invalidIncoming = structuredClone(initial);
  const invalidEntry = invalidIncoming.bases[0];
  assert.ok(invalidEntry);
  advanceStoreEntry(invalidEntry, () => {
    invalidEntry.data.portableIndex.groups = [{ id: "remote-index", title: "Remote Index", order: 0 }];
    invalidEntry.data.portableIndex.subjects = [{
      id: "remote-medication",
      title: "Remote topic label",
      groupId: "remote-index",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }];
    invalidEntry.data.portableIndex.resolvedPathBySubjectId = { "remote-medication": medication.path };
    invalidEntry.data.manualIndexPaths = [medication.path];
  }, 200);
  disk = invalidIncoming;
  const writeStarted = deferred();
  const releaseWrite = deferred();
  oldPlugin.saveData = async (value: unknown) => {
    disk = structuredClone(value) as PluginStore;
    writeStarted.resolve();
    await releaseWrite.promise;
    throw new Error("old external writeback rejected after replacing data.json");
  };

  const oldReload = oldPlugin.onExternalSettingsChange();
  await writeStarted.promise;
  oldPlugin.onunload();
  const replacement = new EntVaultCommandCenterPlugin(app as never, {} as never);
  replacement.loadData = async () => structuredClone(disk);
  let replacementLoaded = false;
  const replacementLoad = replacement.loadPluginData(false).then(() => { replacementLoaded = true; });
  await Promise.resolve();
  assert.equal(replacementLoaded, false, "replacement cannot read the partial write before the old Sync worker settles");

  releaseWrite.resolve();
  await oldReload;
  await replacementLoad;

  assert.equal(replacement.isDataReadOnly(), true);
  assert.match(replacement.dataCompatibilityWarning, /may have reached data\.json|uncertain partial write/i);
  await assert.rejects(replacement.savePluginData(), /may have reached data\.json|uncertain partial write/i);
});

test("a rejected direct save restores data and publishes a newer causal rollback", async () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-direct-save-timestamp");
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  const beforeRevision = plugin.getActiveKnowledgeBase().semanticRevision;
  let writes = 0;
  let attempted: PluginStore | null = null;
  let final: PluginStore | null = null;
  plugin.saveData = async (value: unknown) => {
    writes += 1;
    if (writes === 1) {
      attempted = structuredClone(value) as PluginStore;
      throw new Error("adapter rejected direct save");
    }
    final = structuredClone(value) as PluginStore;
  };
  plugin.data.settings.workspaceSubtitle = "Rejected change";

  await assert.rejects(plugin.savePluginData(), /adapter rejected direct save/);

  assert.equal(plugin.data.settings.workspaceSubtitle, migrateData(null).settings.workspaceSubtitle);
  assert.equal(plugin.getActiveKnowledgeBase().semanticRevision, beforeRevision + 2);
  assert.equal(writes, 2);
  assert.ok(attempted && final);
  assert.ok(final.bases[0].semanticLineage.includes(attempted.bases[0].semanticHead));
});

test("direct save transactions serialize baseline capture through compensation in both rejection orders", async () => {
  for (const rejectedCall of [1, 2] as const) {
    const store = createDefaultStore(migrateData(null), 100, `vault-serialized-direct-${rejectedCall}`);
    const plugin = pluginWith(store);
    await plugin.loadPluginData(false);
    let disk = structuredClone(store);
    const firstWriteStarted = deferred();
    const releaseFirstWrite = deferred();
    let writes = 0;
    plugin.saveData = async (value: unknown) => {
      writes += 1;
      if (writes === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      disk = structuredClone(value) as PluginStore;
      if (writes === rejectedCall) throw new Error(`rejected direct call ${rejectedCall} after write`);
    };

    plugin.data.pinnedPaths = ["First.md"];
    const first = plugin.savePluginData();
    await firstWriteStarted.promise;
    plugin.data.nextStudyPaths = ["Second.md"];
    const second = plugin.savePluginData();
    releaseFirstWrite.resolve();
    const outcomes = await Promise.allSettled([first, second]);

    assert.equal(outcomes[rejectedCall - 1]?.status, "rejected");
    assert.equal(outcomes[rejectedCall === 1 ? 1 : 0]?.status, "fulfilled");
    const persisted = disk.bases.find((entry) => entry.id === disk.activeBaseId)?.data;
    if (rejectedCall === 1) {
      assert.deepEqual(plugin.data.pinnedPaths, ["First.md"], "the later successful snapshot includes the still-live first setting");
      assert.deepEqual(plugin.data.nextStudyPaths, ["Second.md"]);
      assert.deepEqual(persisted?.pinnedPaths, ["First.md"]);
      assert.deepEqual(persisted?.nextStudyPaths, ["Second.md"]);
      assert.equal(writes, 2);
    } else {
      assert.deepEqual(plugin.data.pinnedPaths, ["First.md"], "the rejected later save restores the fulfilled first snapshot");
      assert.deepEqual(plugin.data.nextStudyPaths, []);
      assert.deepEqual(persisted?.pinnedPaths, ["First.md"]);
      assert.deepEqual(persisted?.nextStudyPaths, []);
      assert.equal(writes, 3, "the later rejection is followed by one causal compensation");
    }
    assert.equal(plugin.isDataReadOnly(), false);
  }
});

test("switching bases does not manufacture a newer payload timestamp", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "ENT";
  const second = migrateData(null);
  second.settings.workspaceName = "Research";
  const store = createDefaultStore(first, 100, "vault-sync-test");
  const secondEntry = createKnowledgeBaseEntry(second, "base-second", 200);
  store.bases.push(secondEntry);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();

  await plugin.switchKnowledgeBase("base-second");

  assert.equal(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.updatedAt, 100);
  assert.equal(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-second")?.updatedAt, 200);
});

test("a missing data file stays uncommitted and adopts the first identified Sync store", async () => {
  const authoritativeData = migrateData(null);
  authoritativeData.settings.workspaceName = "Synced knowledge base";
  authoritativeData.pinnedPaths = ["Knowledge Base/Synced.md"];
  const authoritative = createDefaultStore(authoritativeData, 500, "vault-authoritative-fresh-install");
  const plugin = pluginWith(null);

  const initial = await plugin.loadPluginData();

  assert.equal(initial.sourceWasMissing, true);
  assert.equal(plugin.savedData.length, 0, "startup must not publish an empty store before Sync settles");

  plugin.loadedData = authoritative;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), authoritative.vaultId);
  assert.equal(plugin.data.settings.workspaceName, "Synced knowledge base");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Synced.md"]);
  assert.equal(plugin.savedData.length, 0, "the already-current identified capture needs no writeback");
});

test("a rejected first edit from a missing-data cold start restores its bootstrap baseline", async () => {
  const plugin = pluginWith(null);
  const loaded = await plugin.loadPluginData(false);
  assert.equal(loaded.sourceWasMissing, true);
  const original = structuredClone(plugin.data);
  let disk: PluginStore | null = null;
  let attempted: PluginStore | null = null;
  let writes = 0;
  plugin.saveData = async (value: unknown) => {
    writes += 1;
    disk = structuredClone(value) as PluginStore;
    if (writes === 1) {
      attempted = structuredClone(disk);
      throw new Error("rejected first cold-start edit after write");
    }
  };
  plugin.data.settings.workspaceSubtitle = "Rejected bootstrap edit";

  await assert.rejects(plugin.savePluginData(), /rejected first cold-start edit/i);

  assert.ok(attempted);
  assert.equal(writes, 2);
  assert.deepEqual(plugin.data, original, "the rejected action cannot remain live in memory");
  assert.deepEqual(disk?.bases[0]?.data.settings.workspaceSubtitle, original.settings.workspaceSubtitle);
  assert.ok(disk?.bases[0]?.semanticLineage.includes(attempted.bases[0].semanticHead));
  await plugin.savePluginData();
  assert.equal(writes, 2, "a later no-op cannot republish the rejected first action");
});

test("a transient missing data file restores the last committed store", async () => {
  const originalData = migrateData(null);
  originalData.settings.workspaceName = "Committed knowledge base";
  originalData.pinnedPaths = ["Knowledge Base/Keep.md"];
  const original = createDefaultStore(originalData, 100, "vault-transient-missing");
  const plugin = pluginWith(original);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  plugin.loadedData = null;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), original.vaultId);
  assert.equal(plugin.data.settings.workspaceName, "Committed knowledge base");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Keep.md"]);
  assert.equal(plugin.savedData.length, 1, "the known-good committed envelope is restored once");
  assert.deepEqual(plugin.savedData[0], migrateStore(original));
});

test("the first real edit persists a fresh store that began without data.json", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  assert.equal(plugin.savedData.length, 0);

  plugin.data.settings.workspaceName = "New offline knowledge base";
  await plugin.savePluginData();

  assert.equal(plugin.savedData.length, 1);
  const persisted = plugin.savedData[0] as PluginStore;
  assert.equal(isFreshVaultId(persisted.vaultId), true);
  assert.equal(persisted.bases[0]?.data.settings.workspaceName, "New offline knowledge base");
});

test("safe view-state saves do not advance semantic revision or the semantic timestamp", async () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-view-save");
  store.bases[0].semanticRevision = 8;
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  plugin.data.selectedPath = "Knowledge/Viewed.md";
  plugin.data.activeTab = "collections";
  plugin.data.collapsed.curriculumDomains = ["ENT"];
  await plugin.saveViewState();

  assert.equal(plugin.savedData.length, 0, "device-only state never rewrites synced data.json");
  assert.equal(plugin.getActiveKnowledgeBase().semanticRevision, 8);
  assert.equal(plugin.getActiveKnowledgeBase().updatedAt, 100);
  const persisted = plugin.deviceLocalWrites.at(-1) as ReturnType<typeof createDeviceLocalPluginState> | undefined;
  assert.equal(persisted?.bases[0]?.view.selectedPath, "Knowledge/Viewed.md");
  assert.equal(persisted?.bases[0]?.view.activeTab, "collections");
});

test("cold start never adopts synced route or Undo history when device-local state is absent", async () => {
  const data = migrateData(null);
  data.selectedPath = "Other device.md";
  data.activeTab = "collections";
  data.undoStack = [snapshotPersonal(data, "Other device undo")];
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-no-local-state"));

  await plugin.loadPluginData(false);

  assert.equal(plugin.data.selectedPath, "");
  assert.equal(plugin.data.activeTab, plugin.data.settings.defaultTab);
  assert.deepEqual(plugin.data.undoStack, []);
  assert.deepEqual(plugin.data.redoStack, []);
});

test("cold start restores strictly parsed per-vault state by stable base ID", async () => {
  const first = migrateData(null);
  const second = migrateData(null);
  second.settings.workspaceName = "Second";
  second.selectedPath = "Second/Local.md";
  second.activeTab = "collections";
  second.undoStack = [snapshotPersonal(second, "Local undo")];
  const store = createDefaultStore(first, 100, "vault-local-state");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  store.activeBaseId = "base-second";
  const local = createDeviceLocalPluginState(store);
  const synced = structuredClone(store);
  synced.activeBaseId = "base-default";
  synced.bases[1].data.selectedPath = "Other device.md";
  synced.bases[1].data.undoStack = [];
  const plugin = pluginWith(synced, local);

  await plugin.loadPluginData(false);

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(plugin.data.selectedPath, "Second/Local.md");
  assert.equal(plugin.data.activeTab, "collections");
  assert.equal(plugin.data.undoStack[0]?.label, "Local undo");
});

test("a retained device profile never attaches after data.json was removed and reinstalled", async () => {
  const former = createDefaultStore(migrateData(null), 100, "vault-before-reinstall");
  former.bases[0].data.selectedPath = "Knowledge/Former.md";
  former.bases[0].data.activeTab = "collections";
  former.bases[0].data.undoStack = [snapshotPersonal(former.bases[0].data, "Former undo")];
  const retained = createDeviceLocalPluginState(former);
  const plugin = pluginWith(null, retained);

  await plugin.loadPluginData(false);

  assert.notEqual(plugin.getVaultId(), former.vaultId);
  assert.equal(plugin.data.selectedPath, "");
  assert.equal(plugin.data.activeTab, plugin.data.settings.defaultTab);
  assert.deepEqual(plugin.data.undoStack, []);
  assert.equal(plugin.deviceLocalWrites.length, 0, "a valid mismatched profile is retained but never applied to the fresh identity");
});

test("transient missing startup retains and later applies the matching established vault profile", async () => {
  const profileSource = createDefaultStore(migrateData(null), 100, "vault-established-transient");
  profileSource.bases[0].data.selectedPath = "Knowledge/Retain.md";
  profileSource.bases[0].data.activeTab = "collections";
  profileSource.bases[0].data.undoStack = [snapshotPersonal(profileSource.bases[0].data, "Retained undo")];
  const retained = createDeviceLocalPluginState(profileSource);
  const incoming = structuredClone(profileSource);
  resetPluginViewState(incoming.bases[0].data);
  const { plugin, localValues, localWrites } = pluginWithKeyedLocalStorage(
    null,
    new Map([[DEVICE_LOCAL_STATE_KEY, retained]]),
  );

  await plugin.loadPluginData(false);
  assert.equal(plugin.data.selectedPath, "", "the random missing-data fallback never receives another vault's route");
  plugin.data.selectedPath = "Knowledge/Temporary fallback click.md";
  await plugin.saveViewState();
  assert.deepEqual(localValues.get(DEVICE_LOCAL_STATE_KEY), retained, "transient missing data does not erase the established profile");
  assert.equal(localWrites.some(([key]) => key === DEVICE_LOCAL_STATE_KEY), false);

  plugin.loadedData = incoming;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getVaultId(), incoming.vaultId);
  assert.equal(plugin.data.selectedPath, "Knowledge/Retain.md");
  assert.equal(plugin.data.activeTab, "collections");
  assert.equal(plugin.data.undoStack.at(-1)?.label, "Retained undo");
});

test("transient missing startup migrates route and Undo when the established v13 store arrives through Sync", async () => {
  const data = migrateData(null);
  data.selectedPath = "Knowledge/Legacy arrival.md";
  data.activeTab = "collections";
  data.undoStack = [snapshotPersonal(data, "Legacy arriving undo")];
  const incoming = createDefaultStore(data, 100, "vault-established-v13-arrival") as PluginStore & { version: number };
  incoming.version = 13;
  const { plugin, localValues } = pluginWithKeyedLocalStorage(null);

  await plugin.loadPluginData(false);
  plugin.loadedData = incoming;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getVaultId(), incoming.vaultId);
  assert.equal(plugin.data.selectedPath, "Knowledge/Legacy arrival.md");
  assert.equal(plugin.data.activeTab, "collections");
  assert.equal(plugin.data.undoStack.at(-1)?.label, "Legacy arriving undo");
  const local = localValues.get(DEVICE_LOCAL_STATE_KEY) as ReturnType<typeof createDeviceLocalPluginState> | undefined;
  assert.equal(local?.vaultId, incoming.vaultId);
  assert.equal(local?.bases[0]?.view.undoStack.at(-1)?.label, "Legacy arriving undo");
  const written = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.equal(written?.version, STORE_VERSION);
  assert.deepEqual(written?.bases[0]?.data.undoStack, [], "the rewritten v14 envelope is neutral only after local migration");
});

test("v13 startup migrates route, collapse, and Undo into vault-bound local state before neutral writeback", async () => {
  const data = migrateData(null);
  data.selectedPath = "Knowledge/Legacy route.md";
  data.activeTab = "collections";
  data.collapsed.curriculumDomains = ["Legacy group"];
  data.undoStack = [snapshotPersonal(data, "Legacy newest undo")];
  const raw = createDefaultStore(data, 100, "vault-v13-device-migration") as PluginStore & { version: number };
  raw.version = 13;
  const plugin = pluginWith(raw);

  await plugin.loadPluginData();

  const local = plugin.deviceLocalWrites.find((value) => (
    value && typeof value === "object" && (value as { vaultId?: string }).vaultId === raw.vaultId
  )) as ReturnType<typeof createDeviceLocalPluginState> | undefined;
  assert.equal(local?.version, DEVICE_LOCAL_STATE_VERSION);
  assert.equal(local?.vaultId, raw.vaultId);
  assert.equal(local?.bases[0]?.view.selectedPath, "Knowledge/Legacy route.md");
  assert.deepEqual(local?.bases[0]?.view.collapsed.curriculumDomains, ["Legacy group"]);
  assert.equal(local?.bases[0]?.view.undoStack.at(-1)?.label, "Legacy newest undo");
  const written = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.equal(written?.version, STORE_VERSION);
  assert.equal(written?.bases[0]?.data.version, DATA_VERSION);
  assert.equal(written?.bases[0]?.data.selectedPath, "");
  assert.deepEqual(written?.bases[0]?.data.undoStack, []);
});

test("oversized v13 history arriving through Sync keeps newest entries and reports truncation", async () => {
  Notice.messages.length = 0;
  const first = migrateData(null);
  const raw = createDefaultStore(first, 100, "vault-v13-large-local") as PluginStore & { version: number };
  for (let baseIndex = 0; baseIndex < 30; baseIndex += 1) {
    const data = baseIndex === 0 ? raw.bases[0]?.data : migrateData(null);
    assert.ok(data);
    data.undoStack = Array.from({ length: 20 }, (_, historyIndex) => {
      const snapshot = snapshotPersonal(data, `${String(historyIndex).padStart(2, "0")}-${"x".repeat(8_900)}`);
      snapshot.at = historyIndex + 1;
      return snapshot;
    });
    if (baseIndex > 0) raw.bases.push(createKnowledgeBaseEntry(data, `base-large-${baseIndex}`, 100 + baseIndex));
  }
  raw.version = 13;
  const { plugin, localValues } = pluginWithKeyedLocalStorage(null);

  await plugin.loadPluginData(false);
  plugin.loadedData = raw;
  await plugin.onExternalSettingsChange();

  const local = localValues.get(DEVICE_LOCAL_STATE_KEY) as ReturnType<typeof createDeviceLocalPluginState> | undefined;
  assert.ok(local);
  assert.ok(new TextEncoder().encode(JSON.stringify(local)).byteLength <= 4 * 1024 * 1024);
  assert.ok(local.bases[0]?.view.undoStack.at(-1)?.label.startsWith("19-"), "the newest active-base snapshot survives");
  assert.ok(Notice.messages.some((message) => /exceeded the safe local limit.*Newest entries were retained/iu.test(message)));
  const written = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.equal(written?.version, STORE_VERSION);
  assert.ok(written?.bases.every((entry) => entry.data.undoStack.length === 0));
});

test("malformed or oversized device-local state is discarded to safe defaults", async () => {
  for (const local of [
    { version: DEVICE_LOCAL_STATE_VERSION, vaultId: "vault-malformed-local", activeBaseId: "base-default", bases: [{ baseId: "base-default", view: { activeTab: "bad" } }] },
    { version: DEVICE_LOCAL_STATE_VERSION, vaultId: "vault-malformed-local", activeBaseId: "base-default", bases: [], padding: "x".repeat(4 * 1024 * 1024 + 1) },
  ]) {
    const data = migrateData(null);
    data.selectedPath = "Synced.md";
    data.undoStack = [snapshotPersonal(data, "Synced undo")];
    const plugin = pluginWith(createDefaultStore(data, 100, "vault-malformed-local"), local);
    await plugin.loadPluginData(false);
    assert.equal(plugin.data.selectedPath, "");
    assert.deepEqual(plugin.data.undoStack, []);
    assert.equal(plugin.deviceLocalWrites.at(-1), null, "damaged state is cleared from localStorage");
  }
});

test("clearing device-local data resets in-memory view/history and all local keys without saving data.json", async () => {
  const first = migrateData(null);
  const second = migrateData(null);
  second.settings.workspaceName = "Second";
  second.selectedPath = "Knowledge/Second route.md";
  second.activeTab = "collections";
  second.collapsed.curriculumDomains = ["Expanded elsewhere"];
  second.undoStack = [snapshotPersonal(second, "Device undo")];
  const store = createDefaultStore(first, 100, "vault-clear-device-local");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  store.activeBaseId = "base-second";
  const localValues = new Map<string, unknown>([
    [DEVICE_LOCAL_STATE_KEY, createDeviceLocalPluginState(store)],
    [SYNC_RECOVERY_LOCAL_STATE_KEY, {
      version: 1,
      lastLocalSaveAt: 100,
      lastExternalReloadAt: 200,
      lastExternalReloadOutcome: "applied",
      lastRecoveryExportAt: 300,
      semanticConflicts: [{ baseId: "base-second", at: 400, count: 1 }],
      highestPluginVersionSeen: "0.12.0",
    }],
  ]);
  const writes: Array<[string, unknown]> = [];
  const app = {
    vault: emptyWritableTestVault(),
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: (key: string) => structuredClone(localValues.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      localValues.set(key, structuredClone(value));
      writes.push([key, structuredClone(value)]);
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = store;
  await plugin.loadPluginData(false);
  plugin.savedData.length = 0;

  await plugin.clearDeviceLocalData();

  assert.deepEqual(writes.slice(-2), [
    [DEVICE_LOCAL_STATE_KEY, null],
    [SYNC_RECOVERY_LOCAL_STATE_KEY, null],
  ]);
  assert.equal(localValues.get(DEVICE_LOCAL_STATE_KEY), null);
  assert.equal(localValues.get(SYNC_RECOVERY_LOCAL_STATE_KEY), null);
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.selectedPath, "");
  assert.equal(plugin.data.activeTab, plugin.data.settings.defaultTab);
  assert.deepEqual(plugin.data.collapsed.curriculumDomains, []);
  assert.deepEqual(plugin.data.undoStack, []);
  assert.deepEqual(plugin.data.redoStack, []);
  assert.equal(plugin.savedData.length, 0, "clear never writes synced plugin data");
  const localFacts = (plugin as unknown as {
    syncRecoveryLocalState: {
      highestPluginVersionSeen: string | null;
      lastLocalSaveAt: number | null;
      semanticConflicts: unknown[];
    };
  }).syncRecoveryLocalState;
  assert.equal(localFacts.lastLocalSaveAt, null);
  assert.equal(localFacts.highestPluginVersionSeen, null);
  assert.deepEqual(localFacts.semanticConflicts, []);

  const writesAfterClear = writes.length;
  plugin.data.selectedPath = "Knowledge/Do not recreate.md";
  await plugin.saveViewState();
  plugin.recordRecoveryExport(900);
  const currentStore = structuredClone((plugin as unknown as { store: PluginStore }).store);
  currentStore.bases.forEach((entry) => resetPluginViewState(entry.data));
  plugin.loadedData = currentStore;
  await plugin.onExternalSettingsChange();
  await plugin.saveViewState(); // equivalent to a pending view onClose flush

  assert.equal(writes.length, writesAfterClear, "later view saves and local fact recorders stay suppressed until restart");
  assert.equal(localValues.get(DEVICE_LOCAL_STATE_KEY), null);
  assert.equal(localValues.get(SYNC_RECOVERY_LOCAL_STATE_KEY), null);
});

test("one semantic save advances its base revision exactly once", async () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-semantic-save");
  store.bases[0].semanticRevision = 8;
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  plugin.data.pinnedPaths = ["Knowledge/Structural.md"];
  await plugin.savePluginData();

  const persisted = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.equal(plugin.savedData.length, 1);
  assert.equal(persisted?.bases[0]?.semanticRevision, 9);
  assert.ok((persisted?.bases[0]?.updatedAt ?? 0) > 100);
  assert.equal(persisted?.bases[0]?.data.selectedPath, "");
  assert.deepEqual(persisted?.bases[0]?.data.undoStack, []);
  assert.deepEqual(persisted?.bases[0]?.data.redoStack, []);
});

test("safe view-state save rejects rather than smuggling an unsaved semantic change", async () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-view-no-smuggle");
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  plugin.data.selectedPath = "Knowledge/Viewed.md";
  plugin.data.pinnedPaths = ["Knowledge/Unsaved.md"];

  await assert.rejects(plugin.saveViewState(), /unsaved organization change/i);
  assert.equal(plugin.savedData.length, 0);
  assert.equal(plugin.getActiveKnowledgeBase().semanticRevision, 0);
  assert.equal(plugin.getActiveKnowledgeBase().updatedAt, 100);
});

test("safe view-state save waits for an active semantic transaction and adds no revision", async () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-view-waits");
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const semanticWriteStarted = deferred();
  const releaseSemanticWrite = deferred();
  let writeCalls = 0;
  plugin.saveData = async (value: unknown): Promise<void> => {
    writeCalls += 1;
    if (writeCalls === 1) {
      semanticWriteStarted.resolve();
      await releaseSemanticWrite.promise;
    }
    plugin.savedData.push(structuredClone(value));
  };

  const semanticSave = plugin.mutate("Structural edit", () => {
    plugin.data.pinnedPaths = ["Knowledge/Committed.md"];
    plugin.data.selectedPath = "Knowledge/Committed.md";
  });
  await semanticWriteStarted.promise;
  const viewSave = plugin.saveViewState();
  await Promise.resolve();
  assert.equal(writeCalls, 1, "the view save must wait behind the semantic transaction");

  releaseSemanticWrite.resolve();
  await Promise.all([semanticSave, viewSave]);

  assert.equal(writeCalls, 1, "the following view save uses per-vault localStorage only");
  const semanticSnapshot = plugin.savedData[0] as PluginStore;
  assert.equal(semanticSnapshot.bases[0]?.semanticRevision, 1);
  const viewSnapshot = plugin.deviceLocalWrites.at(-1) as ReturnType<typeof createDeviceLocalPluginState>;
  assert.equal(viewSnapshot.bases[0]?.view.selectedPath, "Knowledge/Committed.md");
});

test("an automatic fresh-device selection save cannot defeat an established Sync store", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.data.selectedPath = "Knowledge Base/Auto-selected.md";
  await plugin.saveViewState();
  assert.equal(isFreshVaultId(plugin.getVaultId()), true);

  const authoritativeData = migrateData(null);
  authoritativeData.settings.workspaceName = "Established synced knowledge base";
  authoritativeData.pinnedPaths = ["Knowledge Base/Authoritative.md"];
  const authoritative = createDefaultStore(authoritativeData, 800, "vault-established-after-bootstrap");
  plugin.loadedData = authoritative;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), authoritative.vaultId);
  assert.equal(plugin.data.settings.workspaceName, "Established synced knowledge base");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Authoritative.md"]);
});

test("meaningful fresh-device work is rescued before an established Sync store is adopted", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.data.settings.workspaceName = "Offline work that must survive";
  await plugin.savePluginData();
  const localFreshId = plugin.getVaultId();
  let rescuePath = "";
  let rescueContent = "";
  const app = plugin.app as unknown as {
    vault: {
      configDir: string;
      getMarkdownFiles(): TFile[];
      getAbstractFileByPath(path: string): TAbstractFile | null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path, content) => {
      rescuePath = path;
      rescueContent = content;
      return new TFile(path);
    },
  };

  const authoritativeData = migrateData(null);
  authoritativeData.settings.workspaceName = "Established synced knowledge base";
  const authoritative = createDefaultStore(authoritativeData, 900, "vault-established-after-offline-work");
  plugin.loadedData = authoritative;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), authoritative.vaultId);
  assert.match(rescuePath, /knowledge-base-command-center-conflict-/);
  const rescue = JSON.parse(rescueContent) as { kind: string; store: PluginStore };
  assert.equal(rescue.kind, "knowledge-base-command-center-conflict-rescue");
  assert.equal(rescue.store.vaultId, localFreshId);
  assert.equal(rescue.store.bases[0]?.data.settings.workspaceName, "Offline work that must survive");
});

test("a same-identity fresh Sync callback does not create a false conflict rescue", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.data.settings.workspaceName = "Local fresh knowledge base";
  await plugin.savePluginData();
  const persisted = structuredClone(plugin.savedData.at(-1)) as PluginStore;
  let createdFiles = 0;
  const app = plugin.app as unknown as {
    vault: {
      configDir: string;
      getMarkdownFiles(): TFile[];
      getAbstractFileByPath(path: string): null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path) => {
      createdFiles += 1;
      return new TFile(path);
    },
  };
  plugin.loadedData = persisted;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), persisted.vaultId);
  assert.equal(createdFiles, 0);
});

test("view-only Sync divergence needs neither writeback nor conflict rescue", async () => {
  const localData = migrateData(null);
  localData.selectedPath = "Knowledge/Local view.md";
  localData.activeTab = "collections";
  const local = createDefaultStore(localData, 100, "vault-view-only-sync");
  local.bases[0].semanticRevision = 2;
  const plugin = pluginWith(structuredClone(local), createDeviceLocalPluginState(local));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  let rescueFiles = 0;
  const app = plugin.app as unknown as {
    vault: {
      configDir: string;
      getMarkdownFiles(): TFile[];
      getAbstractFileByPath(path: string): TAbstractFile | null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path) => {
      rescueFiles += 1;
      return new TFile(path);
    },
  };
  const incoming = structuredClone((plugin as unknown as { store: PluginStore }).store);
  incoming.bases[0].data.selectedPath = "Knowledge/Incoming view.md";
  incoming.bases[0].data.activeTab = "curriculum";
  incoming.bases[0].updatedAt = 50_000;
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.data.selectedPath, "Knowledge/Local view.md");
  assert.equal(plugin.data.activeTab, "collections");
  assert.equal(plugin.getActiveKnowledgeBase().semanticRevision, 2);
  assert.equal(plugin.savedData.length, 0);
  assert.equal(rescueFiles, 0);
  assert.equal(plugin.dataCompatibilityWarning, "");
});

test("equal-semantics v13 external capture is rewritten as a v14 store with current inner data", async () => {
  const current = createDefaultStore(migrateData(null), 100, "vault-external-v13-equal");
  const plugin = pluginWith(structuredClone(current));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const incoming = structuredClone(current) as PluginStore & { version: number };
  incoming.version = 13;
  (incoming.bases[0]?.data as { version: number }).version = 12;
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  const written = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.equal(written?.version, STORE_VERSION);
  assert.equal(written?.bases[0]?.data.version, DATA_VERSION);
});

test("incoming-winning v13 external capture is adopted and rewritten as v14", async () => {
  const localData = migrateData(null);
  localData.settings.workspaceName = "AAA local";
  const local = createDefaultStore(localData, 100, "vault-external-v13-incoming");
  const incoming = structuredClone(local) as PluginStore & { version: number };
  incoming.version = 13;
  (incoming.bases[0]?.data as { version: number }).version = 12;
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  incomingBase.data.settings.workspaceName = "ZZZ incoming";
  incomingBase.updatedAt = 500;
  const migratedIncoming = migrateStore(incoming);
  const preview = mergeKnowledgeBaseStores(migrateStore(local), migratedIncoming);
  assert.equal(preview.semanticConflicts[0]?.winner, "incoming", "fixture must exercise incoming adoption");

  const plugin = pluginWith(local);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.loadedData = incoming;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.data.settings.workspaceName, "ZZZ incoming");
  const written = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.equal(written?.version, STORE_VERSION);
  assert.equal(written?.bases[0]?.data.version, DATA_VERSION);
  assert.equal(written?.bases[0]?.data.settings.workspaceName, "ZZZ incoming");
});

test("same-revision semantic conflicts rescue the losing complete envelope before adoption", async () => {
  Notice.messages.length = 0;
  const localData = migrateData(null);
  localData.settings.workspaceName = "Alpha organization";
  const local = createDefaultStore(localData, 100, "vault-semantic-conflict");
  local.bases[0].semanticRevision = 5;
  const incoming = structuredClone(local);
  incoming.bases[0].data.settings.workspaceName = "Beta organization";
  incoming.bases[0].updatedAt = 50_000;
  const expected = mergeKnowledgeBaseStores(local, incoming, local.activeBaseId);
  const expectedConflict = expected.semanticConflicts[0];
  assert.ok(expectedConflict);
  const losing = expectedConflict.winner === "local" ? incoming : local;
  const expectedWinnerName = expected.store.bases[0]?.data.settings.workspaceName;

  const plugin = pluginWith(structuredClone(local));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const events: string[] = [];
  let rescueContent = "";
  const app = plugin.app as unknown as {
    vault: {
      configDir: string;
      getMarkdownFiles(): TFile[];
      getAbstractFileByPath(path: string): TAbstractFile | null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path, content) => {
      events.push("rescue");
      rescueContent = content;
      return new TFile(path);
    },
  };
  plugin.refreshViews = async () => { events.push("refresh"); };
  plugin.saveData = async (value: unknown) => {
    events.push("writeback");
    plugin.savedData.push(structuredClone(value));
  };
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(events[0], "rescue", "the losing envelope must be durable before adoption or writeback");
  assert.equal(plugin.data.settings.workspaceName, expectedWinnerName);
  const rescue = JSON.parse(rescueContent) as { kind: string; store: PluginStore };
  assert.equal(rescue.kind, "knowledge-base-command-center-conflict-rescue");
  assert.equal(rescue.store.bases[0]?.data.settings.workspaceName, losing.bases[0]?.data.settings.workspaceName);
  const conflictNotice = Notice.messages.find((message) => message.includes("concurrent knowledge-base edit"));
  assert.ok(conflictNotice);
  assert.equal(conflictNotice.includes("Knowledge Base Command Center Exports"), false, "the conflict notice is path-free");
  assert.equal(plugin.dataCompatibilityWarning, "");
});

test("a failed same-revision conflict rescue fails closed and retains the captured payload", async () => {
  const localData = migrateData(null);
  localData.settings.workspaceName = "Local organization";
  const local = createDefaultStore(localData, 100, "vault-semantic-rescue-failure");
  local.bases[0].semanticRevision = 3;
  const incoming = structuredClone(local);
  incoming.bases[0].data.settings.workspaceName = "Incoming organization";
  const plugin = pluginWith(structuredClone(local));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const app = plugin.app as unknown as {
    vault: {
      configDir: string;
      getMarkdownFiles(): TFile[];
      getAbstractFileByPath(path: string): TAbstractFile | null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async () => { throw new Error("simulated rescue disk failure"); },
  };
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.data.settings.workspaceName, "Local organization");
  assert.match(plugin.dataCompatibilityWarning, /could not be preserved.*read-only/i);
  assert.equal(plugin.savedData.length, 0);
  const retained = (plugin as unknown as { retainedExternalSettingsPayload: unknown }).retainedExternalSettingsPayload;
  assert.deepEqual(retained, incoming);

  const later = structuredClone(incoming);
  later.bases[0].semanticRevision = 4;
  later.bases[0].data.settings.workspaceName = "Later incoming organization";
  plugin.loadedData = later;
  await plugin.onExternalSettingsChange();
  assert.equal(plugin.data.settings.workspaceName, "Local organization", "fail-closed state is sticky until restart");
  assert.deepEqual(
    (plugin as unknown as { retainedExternalSettingsPayload: unknown }).retainedExternalSettingsPayload,
    incoming,
    "the original unrescued capture remains retained",
  );
});

test("an established store silently replaces an incoming bootstrap-only fresh store on disk", async () => {
  const establishedData = migrateData(null);
  establishedData.settings.workspaceName = "Established authority";
  establishedData.pinnedPaths = ["Established.md"];
  const established = createDefaultStore(establishedData, 100, "vault-established-incoming-bootstrap");
  const plugin = pluginWith(structuredClone(established));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.loadedData = migrateStore(null);

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), established.vaultId);
  assert.deepEqual(plugin.data.pinnedPaths, ["Established.md"]);
  const disk = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.equal(disk?.vaultId, established.vaultId);
  const restarted = pluginWith(disk);
  await restarted.loadPluginData();
  assert.equal(restarted.getVaultId(), established.vaultId);
  assert.deepEqual(restarted.data.pinnedPaths, ["Established.md"]);
});

test("an established store rescues meaningful incoming fresh work before restoring disk authority", async () => {
  const establishedData = migrateData(null);
  establishedData.settings.workspaceName = "Established authority";
  establishedData.pinnedPaths = ["Established.md"];
  const established = createDefaultStore(establishedData, 100, "vault-established-incoming-meaningful");
  const plugin = pluginWith(structuredClone(established));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  let rescueContent = "";
  const app = plugin.app as unknown as {
    vault: {
      configDir: string;
      getMarkdownFiles(): TFile[];
      getAbstractFileByPath(path: string): TAbstractFile | null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path, content) => {
      rescueContent = content;
      return new TFile(path);
    },
  };
  const incomingFresh = migrateStore(null);
  const incomingFreshBase = incomingFresh.bases[0];
  assert.ok(incomingFreshBase);
  incomingFreshBase.data.settings.workspaceName = "Fresh offline work";
  incomingFreshBase.data.nextStudyPaths = ["Fresh-device.md"];
  plugin.loadedData = incomingFresh;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  const rescue = JSON.parse(rescueContent) as { kind: string; store: PluginStore };
  assert.equal(rescue.kind, "knowledge-base-command-center-conflict-rescue");
  assert.equal(rescue.store.vaultId, incomingFresh.vaultId);
  assert.deepEqual(rescue.store.bases[0]?.data.nextStudyPaths, ["Fresh-device.md"]);
  const disk = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.equal(disk?.vaultId, established.vaultId);
  assert.deepEqual(disk?.bases[0]?.data.pinnedPaths, ["Established.md"]);
  const restarted = pluginWith(disk);
  await restarted.loadPluginData();
  assert.equal(restarted.getVaultId(), established.vaultId);
  assert.deepEqual(restarted.data.pinnedPaths, ["Established.md"]);
});

test("a valid flat v10 Sync capture recovers startup without a trusted baseline and writes once", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceMode = "generic";
  legacy.settings.workspaceName = "Recovered knowledge base";
  legacy.pinnedPaths = ["Knowledge Base/Recovered.md"];
  const plugin = pluginWith(null);
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(legacy);
  };

  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);
  diskReadable = true;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.data.settings.workspaceName, "Recovered knowledge base");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Recovered.md"]);
  assert.equal(plugin.savedData.length, 1, "migration and identity recovery share one writeback");
  assert.match((plugin.savedData[0] as PluginStore).vaultId, /^vault-migrated-[0-9a-f]{16}-[a-z0-9]{12,64}$/i);
});

test("recovered legacy organization replaces a later bootstrap-only fresh capture", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceName = "Recovered legacy authority";
  legacy.pinnedPaths = ["Recovered-legacy.md"];
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  const captures: unknown[] = [legacy, migrateStore(null)];
  plugin.loadData = async () => structuredClone(captures.shift());

  await Promise.all([plugin.onExternalSettingsChange(), plugin.onExternalSettingsChange()]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.data.settings.workspaceName, "Recovered legacy authority");
  assert.deepEqual(plugin.data.pinnedPaths, ["Recovered-legacy.md"]);
  const disk = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.match(disk?.vaultId ?? "", /^vault-migrated-/);
  assert.equal(isFreshVaultId(disk?.vaultId ?? ""), false);
  assert.deepEqual(disk?.bases[0]?.data.pinnedPaths, ["Recovered-legacy.md"]);
});

test("two no-baseline devices recovering the same flat v10 payload retain provisional convergence", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const legacy = invalidEntMedicationIndexData(medication);
  legacy.version = 10;
  const frontmatter = { [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] } };
  const recover = async (): Promise<PluginStore> => {
    const plugin = pluginWithFiles(null, [medication], frontmatter).plugin;
    let diskReadable = false;
    plugin.loadData = async (): Promise<unknown> => {
      if (!diskReadable) throw new SyntaxError("transient partial JSON");
      return structuredClone(legacy);
    };
    await plugin.loadPluginData();
    diskReadable = true;
    await plugin.onExternalSettingsChange();
    assert.equal(plugin.dataCompatibilityWarning, "");
    assert.equal(plugin.savedData.length, 1);
    return plugin.savedData[0] as PluginStore;
  };

  const left = await recover();
  const right = await recover();

  assert.equal(
    provisionalMigratedVaultFingerprint(left.vaultId),
    provisionalMigratedVaultFingerprint(right.vaultId),
  );
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(left, right));
});

test("duplicate flat v10 callbacks during no-baseline recovery converge into one writeback", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceName = "Recovered once";
  const plugin = pluginWith(null);
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(legacy);
  };
  await plugin.loadPluginData();
  diskReadable = true;

  const first = plugin.onExternalSettingsChange();
  const duplicate = plugin.onExternalSettingsChange();
  await Promise.all([first, duplicate]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.data.settings.workspaceName, "Recovered once");
  assert.equal(plugin.savedData.length, 1);
});

test("a duplicate flat v10 callback arriving during no-baseline writeback is retried safely", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceName = "Recovered during writeback";
  const plugin = pluginWith(null);
  let disk: unknown = legacy;
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(disk);
  };
  await plugin.loadPluginData();
  diskReadable = true;
  const writebackStarted = deferred();
  const releaseWriteback = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown): Promise<void> => {
    saveCalls += 1;
    if (saveCalls === 1) {
      writebackStarted.resolve();
      await releaseWriteback.promise;
    }
    disk = structuredClone(value);
  };

  const first = plugin.onExternalSettingsChange();
  await writebackStarted.promise;
  const duplicate = plugin.onExternalSettingsChange();
  releaseWriteback.resolve();
  await Promise.all([first, duplicate]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.data.settings.workspaceName, "Recovered during writeback");
  assert.equal((disk as PluginStore).kind, STORE_KIND);
  assert.equal(saveCalls, 2, "the superseded first write is followed by one authoritative migrated writeback");
});

test("an identified envelope supersedes provisional legacy recovery when it arrives during writeback", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceName = "Provisional legacy";
  const authoritativeData = migrateData(null);
  authoritativeData.settings.workspaceName = "Authoritative current store";
  authoritativeData.pinnedPaths = ["Knowledge Base/Authoritative.md"];
  const authoritative = createDefaultStore(authoritativeData, 500, "vault-authoritative-current");
  const plugin = pluginWith(null);
  let disk: unknown = legacy;
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(disk);
  };
  await plugin.loadPluginData();
  diskReadable = true;
  const writebackStarted = deferred();
  const releaseWriteback = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown): Promise<void> => {
    saveCalls += 1;
    if (saveCalls === 1) {
      writebackStarted.resolve();
      await releaseWriteback.promise;
    }
    disk = structuredClone(value);
  };

  const legacyReload = plugin.onExternalSettingsChange();
  await writebackStarted.promise;
  disk = structuredClone(authoritative);
  const authoritativeReload = plugin.onExternalSettingsChange();
  releaseWriteback.resolve();
  await Promise.all([legacyReload, authoritativeReload]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), "vault-authoritative-current");
  assert.equal(plugin.data.settings.workspaceName, "Authoritative current store");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Authoritative.md"]);
  assert.equal((disk as PluginStore).vaultId, "vault-authoritative-current");
  assert.equal((disk as PluginStore).bases[0]?.data.settings.workspaceName, "Authoritative current store");
  assert.equal(saveCalls, 2, "the stale provisional write is replaced by one authoritative envelope writeback");
});

test("an identified envelope supersedes identity-less v11 recovery when it arrives during writeback", async () => {
  const provisionalData = migrateData(null);
  provisionalData.settings.workspaceName = "Identity-less v11";
  const provisionalEnvelope = createDefaultStore(provisionalData, 100, "temporary-vault-id");
  provisionalEnvelope.version = 11;
  const identityLess = structuredClone(provisionalEnvelope) as unknown as Record<string, unknown>;
  delete identityLess.vaultId;
  const authoritativeData = migrateData(null);
  authoritativeData.settings.workspaceName = "Authoritative after v11";
  const authoritative = createDefaultStore(authoritativeData, 500, "vault-authoritative-after-v11");
  const plugin = pluginWith(null);
  let disk: unknown = identityLess;
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(disk);
  };
  await plugin.loadPluginData();
  diskReadable = true;
  const writebackStarted = deferred();
  const releaseWriteback = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown): Promise<void> => {
    saveCalls += 1;
    if (saveCalls === 1) {
      writebackStarted.resolve();
      await releaseWriteback.promise;
    }
    disk = structuredClone(value);
  };

  const provisionalReload = plugin.onExternalSettingsChange();
  await writebackStarted.promise;
  disk = structuredClone(authoritative);
  const authoritativeReload = plugin.onExternalSettingsChange();
  releaseWriteback.resolve();
  await Promise.all([provisionalReload, authoritativeReload]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), "vault-authoritative-after-v11");
  assert.equal(plugin.data.settings.workspaceName, "Authoritative after v11");
  assert.equal((disk as PluginStore).vaultId, "vault-authoritative-after-v11");
  assert.equal(saveCalls, 2);
});

test("external Sync merges disjoint base edits and preserves this device's active base", async () => {
  const ent = migrateData(null);
  ent.settings.workspaceName = "ENT";
  const research = migrateData(null);
  research.settings.workspaceName = "Research";
  const original = createDefaultStore(ent, 100, "vault-sync-test");
  original.bases.push(createKnowledgeBaseEntry(research, "base-research", 100));
  const plugin = pluginWith(structuredClone(original));
  await plugin.loadPluginData();
  const epochBeforeSync = plugin.getDataEpoch();
  plugin.savedData.length = 0;

  const localEnt = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default");
  assert.ok(localEnt);
  localEnt.data.pinnedPaths = ["ENT/Airway.md"];
  localEnt.updatedAt = 300;
  localEnt.semanticRevision = 300;
  await plugin.savePluginData();
  plugin.savedData.length = 0;
  const incoming = structuredClone(original);
  incoming.activeBaseId = "base-research";
  const incomingResearch = incoming.bases.find((entry) => entry.id === "base-research");
  assert.ok(incomingResearch);
  incomingResearch.data.pinnedPaths = ["Research/Paper.md"];
  incomingResearch.updatedAt = 400;
  incomingResearch.semanticRevision = 400;
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.ok(plugin.getDataEpoch() > epochBeforeSync, "same-ID Sync replacement advances the data generation");
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.data.pinnedPaths, ["ENT/Airway.md"]);
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-research")?.data.pinnedPaths, ["Research/Paper.md"]);
  assert.equal(plugin.savedData.length, 1, "the merged envelope is written back so other devices converge");
});

test("external Sync remediates an invalid ENT Index payload and writes the corrected envelope once", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const localData = migrateData(null);
  localData.settings.workspaceMode = "ent-clinical";
  const local = createDefaultStore(localData, 100, "vault-sync-remediation");
  const { plugin, sourceMutationCount } = pluginWithFiles(local, [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const incoming = structuredClone((plugin as unknown as { store: PluginStore }).store);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  advanceStoreEntry(incomingBase, () => {
    incomingBase.data.portableIndex.groups = [{ id: "remote-index", title: "Remote Index", order: 0 }];
    incomingBase.data.portableIndex.subjects = [{
      id: "remote-medication",
      title: "Remote topic label",
      groupId: "remote-index",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }];
    incomingBase.data.portableIndex.resolvedPathBySubjectId = { "remote-medication": medication.path };
    incomingBase.data.manualIndexPaths = [medication.path];
  }, 200);
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  const subject = plugin.data.portableIndex.subjects.find((candidate) => candidate.id === "remote-medication");
  assert.deepEqual(
    { indexed: subject?.indexed, kind: subject?.recordKind, libraryId: subject?.libraryId },
    { indexed: false, kind: "medication", libraryId: "medication" },
  );
  assert.deepEqual(plugin.data.manualIndexPaths, []);
  assert.equal(plugin.getActiveKnowledgeBase().updatedAt, 200, "repair must not manufacture a newer LWW timestamp");
  assert.equal(plugin.savedData.length, 1, "the corrected merged store is written back exactly once");
  const persisted = plugin.savedData[0] as typeof incoming;
  const persistedSubject = persisted.bases[0]?.data.portableIndex.subjects.find((candidate) => candidate.id === "remote-medication");
  assert.equal(persistedSubject?.indexed, false);
  assert.equal(persistedSubject?.libraryId, "medication");
  assert.equal(sourceMutationCount(), 0);
});

test("external Sync rescues a concurrent payload before a rejected local write is compensated", async () => {
  const rescueContents: string[] = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      createFolder: async () => {},
      create: async (path: string, content: string) => {
        rescueContents.push(content);
        return new TFile(path);
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initial = migrateData(null);
  initial.settings.workspaceName = "Sync race";
  let disk = createDefaultStore(initial, 100, "vault-sync-race");
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const saveStarted = deferred();
  const releaseSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      saveStarted.resolve();
      await releaseSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const pendingMutation = plugin.mutate("Overlapping local pin", () => {
    plugin.data.pinnedPaths = ["Local.md"];
  });
  await saveStarted.promise;
  const localTimestamp = plugin.getKnowledgeBases(true)[0]?.updatedAt ?? 0;
  const incoming = structuredClone(disk);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  advanceStoreEntry(incomingBase, () => {
    incomingBase.data.nextStudyPaths = ["Remote.md"];
  }, localTimestamp - 1);
  disk = incoming;

  const pendingReload = plugin.onExternalSettingsChange();
  releaseSave.resolve();

  await assert.rejects(pendingMutation, /Sync while this edit was saving|synced copy is being reloaded/i);
  await pendingReload;

  assert.deepEqual(plugin.data.pinnedPaths, [], "the overlapping local edit is rolled back instead of silently winning");
  assert.deepEqual(plugin.data.nextStudyPaths, [], "the causal rollback deterministically supersedes the rejected local attempt");
  const persistedBase = disk.bases.find((entry) => entry.id === disk.activeBaseId);
  assert.deepEqual(persistedBase?.data.pinnedPaths, []);
  assert.deepEqual(persistedBase?.data.nextStudyPaths, []);
  assert.ok(rescueContents.some((content) => content.includes("Remote.md")), "the unrelated remote envelope is rescued before adoption");
  assert.ok((persistedBase?.semanticRevision ?? 0) > incomingBase.semanticRevision);
  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(saveCalls, 2, "one stale local write is followed by one authoritative merged writeback");
});

test("external Sync discards rejected direct and queued saves by merging from the committed baseline", async () => {
  const rescueContents: string[] = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      createFolder: async () => {},
      create: async (path: string, content: string) => {
        rescueContents.push(content);
        return new TFile(path);
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initial = migrateData(null);
  initial.settings.workspaceName = "Direct save race";
  let disk = createDefaultStore(initial, 100, "vault-direct-sync-race");
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const saveStarted = deferred();
  const releaseSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      saveStarted.resolve();
      await releaseSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  plugin.data.selectedPath = "Local-route.md";
  plugin.data.pinnedPaths = ["Local-A.md"];
  const firstLocalSave = plugin.savePluginData();
  await saveStarted.promise;
  plugin.data.manualIndexPaths = ["Local-B.md"];
  const secondLocalSave = plugin.savePluginData();
  const interruptedTimestamp = plugin.getKnowledgeBases(true)[0]?.updatedAt ?? 0;

  const incoming = structuredClone(disk);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  advanceStoreEntry(incomingBase, () => {
    incomingBase.data.nextStudyPaths = ["Remote.md"];
  }, interruptedTimestamp - 1);
  disk = incoming;

  const pendingReload = plugin.onExternalSettingsChange();
  releaseSave.resolve();
  const localResults = await Promise.allSettled([firstLocalSave, secondLocalSave]);
  await pendingReload;

  assert.equal(localResults.every((result) => result.status === "rejected"), true);
  assert.equal(plugin.data.selectedPath, "Local-route.md", "the device-local route survives the rejected semantic saves");
  assert.deepEqual(plugin.data.pinnedPaths, [], "the rejected direct pin save is not treated as committed state");
  assert.deepEqual(plugin.data.manualIndexPaths, [], "the rejected queued manual-path save is not treated as committed state");
  assert.deepEqual(plugin.data.nextStudyPaths, [], "the compensating rollback causally supersedes the rejected write");
  const persistedBase = disk.bases.find((entry) => entry.id === disk.activeBaseId);
  assert.equal(persistedBase?.data.selectedPath, "");
  assert.deepEqual(persistedBase?.data.pinnedPaths, []);
  assert.deepEqual(persistedBase?.data.manualIndexPaths, []);
  assert.deepEqual(persistedBase?.data.nextStudyPaths, []);
  assert.ok(rescueContents.some((content) => content.includes("Remote.md")), "the unrelated remote envelope is rescued before rollback adoption");
  assert.ok((persistedBase?.semanticRevision ?? 0) > incomingBase.semanticRevision);
  assert.equal(saveCalls, 2, "the queued stale save aborts before the adapter and one authoritative writeback follows");
  assert.equal(plugin.dataCompatibilityWarning, "");
});

test("external Sync preserves this device's active base without syncing the switch", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const first = migrateData(null);
  first.settings.workspaceName = "Committed base";
  const second = migrateData(null);
  second.settings.workspaceName = "Rejected target";
  let disk = createDefaultStore(first, 100, "vault-active-switch-sync-race");
  disk.bases.push(createKnowledgeBaseEntry(second, "base-second", 100));
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  await plugin.switchKnowledgeBase("base-second");
  const incoming = structuredClone(disk);
  const incomingCommitted = incoming.bases.find((entry) => entry.id === "base-default");
  assert.ok(incomingCommitted);
  advanceStoreEntry(incomingCommitted, () => {
    incomingCommitted.data.nextStudyPaths = ["Remote.md"];
  }, 1_000);
  disk = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(disk.activeBaseId, "base-default");
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.data.nextStudyPaths, ["Remote.md"]);
  assert.equal(saveCalls, 0, "the local switch and already-authoritative Sync payload require no write");
});

test("external Sync resolves every queued capture before starting one authoritative writeback", async () => {
  const localPrimary = migrateData(null);
  localPrimary.settings.workspaceName = "Local primary";
  localPrimary.pinnedPaths = ["Local.md"];
  const localSecondary = migrateData(null);
  localSecondary.settings.workspaceName = "Shared secondary";
  const local = createDefaultStore(localPrimary, 300, "vault-capture-batch");
  local.bases[0].semanticRevision = 1;
  local.bases.push(createKnowledgeBaseEntry(localSecondary, "base-secondary", 100));
  const plugin = pluginWith(structuredClone(local));
  await plugin.loadPluginData(false);

  const incomingA = structuredClone(local);
  const incomingAPrimary = incomingA.bases.find((entry) => entry.id === "base-default");
  const incomingASecondary = incomingA.bases.find((entry) => entry.id === "base-secondary");
  assert.ok(incomingAPrimary && incomingASecondary);
  incomingAPrimary.data.pinnedPaths = [];
  incomingAPrimary.updatedAt = 100;
  incomingAPrimary.semanticRevision = 0;
  incomingASecondary.data.nextStudyPaths = ["A.md"];
  incomingASecondary.updatedAt = 400;
  incomingASecondary.semanticRevision = 1;
  const incomingB = structuredClone(incomingA);
  const incomingBSecondary = incomingB.bases.find((entry) => entry.id === "base-secondary");
  assert.ok(incomingBSecondary);
  incomingBSecondary.data.nextStudyPaths = ["B.md"];
  incomingBSecondary.updatedAt = 500;
  incomingBSecondary.semanticRevision = 2;

  const releaseSecondRead = deferred();
  let readCalls = 0;
  plugin.loadData = async () => {
    readCalls += 1;
    if (readCalls === 1) return structuredClone(incomingA);
    await releaseSecondRead.promise;
    return structuredClone(incomingB);
  };
  let disk = structuredClone(incomingB);
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    disk = structuredClone(value) as typeof disk;
  };

  const firstReload = plugin.onExternalSettingsChange();
  const secondReload = plugin.onExternalSettingsChange();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(saveCalls, 0, "capture A must not write while capture B is unresolved");
  releaseSecondRead.resolve();
  await Promise.all([firstReload, secondReload]);

  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.data.pinnedPaths, ["Local.md"]);
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-secondary")?.data.nextStudyPaths, ["B.md"]);
  assert.deepEqual(disk.bases.find((entry) => entry.id === "base-default")?.data.pinnedPaths, ["Local.md"]);
  assert.deepEqual(disk.bases.find((entry) => entry.id === "base-secondary")?.data.nextStudyPaths, ["B.md"]);
  assert.equal(saveCalls, 1);
});

test("a missing capture after a valid batched Sync update does not discard that update", async () => {
  const initial = createDefaultStore(migrateData(null), 100, "vault-valid-then-missing");
  const plugin = pluginWith(structuredClone(initial));
  await plugin.loadPluginData(false);
  plugin.savedData.length = 0;
  const valid = structuredClone(initial);
  const validBase = valid.bases[0];
  assert.ok(validBase);
  validBase.data.nextStudyPaths = ["Remote-before-missing.md"];
  validBase.updatedAt = 200;
  validBase.semanticRevision = 1;
  const captures: unknown[] = [valid, null];
  plugin.loadData = async () => structuredClone(captures.shift());

  await Promise.all([plugin.onExternalSettingsChange(), plugin.onExternalSettingsChange()]);

  assert.deepEqual(plugin.data.nextStudyPaths, ["Remote-before-missing.md"]);
  const persisted = plugin.savedData.at(-1) as PluginStore | undefined;
  assert.deepEqual(persisted?.bases[0]?.data.nextStudyPaths, ["Remote-before-missing.md"]);
  assert.equal(plugin.dataCompatibilityWarning, "");
});

test("an incompatible capture in a later Sync worker rescues the committed valid state for restart recovery", async () => {
  const initial = createDefaultStore(migrateData(null), 100, "vault-valid-then-incompatible");
  const plugin = pluginWith(structuredClone(initial));
  await plugin.loadPluginData(false);
  plugin.savedData.length = 0;
  let rescuePath = "";
  let rescueContent = "";
  const app = plugin.app as unknown as {
    vault: {
      configDir: string;
      getMarkdownFiles(): TFile[];
      getAbstractFileByPath(path: string): TAbstractFile | null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path, content) => {
      rescuePath = path;
      rescueContent = content;
      return new TFile(path);
    },
  };
  const valid = structuredClone(initial);
  const validBase = valid.bases[0];
  assert.ok(validBase);
  validBase.data.nextStudyPaths = ["Remote-before-future.md"];
  validBase.updatedAt = 200;
  validBase.semanticRevision = 1;
  plugin.loadedData = valid;
  await plugin.onExternalSettingsChange();
  assert.deepEqual(plugin.data.nextStudyPaths, ["Remote-before-future.md"]);
  plugin.savedData.length = 0;

  const incompatible = structuredClone(valid);
  incompatible.version = STORE_VERSION + 1;
  plugin.loadedData = incompatible;
  await plugin.onExternalSettingsChange();

  assert.deepEqual(plugin.data.nextStudyPaths, ["Remote-before-future.md"]);
  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.match(rescuePath, /knowledge-base-command-center-conflict-/);
  assert.match(plugin.dataCompatibilityWarning, new RegExp(rescuePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(plugin.savedData.length, 0, "the future-version latest capture remains untouched on disk");

  const rescue = JSON.parse(rescueContent) as { kind: string; store: PluginStore };
  assert.equal(rescue.kind, "knowledge-base-command-center-conflict-rescue");
  const restarted = pluginWith(rescue.store);
  await restarted.loadPluginData(false);
  assert.equal(restarted.dataCompatibilityWarning, "");
  assert.deepEqual(restarted.data.nextStudyPaths, ["Remote-before-future.md"]);
});

test("external Sync starts a fresh worker for a callback during worker finalization", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initial = createDefaultStore(migrateData(null), 100, "vault-finalize-gap");
  let disk = structuredClone(initial);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  plugin.saveData = async (value: unknown) => {
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const incomingA = structuredClone(initial);
  const incomingABase = incomingA.bases[0];
  assert.ok(incomingABase);
  advanceStoreEntry(incomingABase, () => {
    incomingABase.data.nextStudyPaths = ["A.md"];
  }, 200);
  disk = incomingA;

  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  let refreshCalls = 0;
  plugin.refreshViews = async () => {
    refreshCalls += 1;
    if (refreshCalls === 1) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
    }
  };

  const firstReload = plugin.onExternalSettingsChange();
  await refreshStarted.promise;

  const incomingB = structuredClone(incomingA);
  const incomingBBase = incomingB.bases[0];
  assert.ok(incomingBBase);
  advanceStoreEntry(incomingBBase, () => {
    incomingBBase.data.nextStudyPaths = ["B.md"];
  }, 300);
  disk = incomingB;

  const secondReload: { current: Promise<void> | null } = { current: null };
  const secondScheduled = deferred();
  releaseRefresh.resolve();
  // The two microtasks place this callback after refreshViews resolves and the
  // first worker runs its cleanup, but before a separately chained promise
  // finalizer could clear the worker pointer. Cleanup and pointer release must
  // therefore be atomic inside the worker itself.
  queueMicrotask(() => queueMicrotask(() => {
    secondReload.current = plugin.onExternalSettingsChange();
    secondScheduled.resolve();
  }));

  await secondScheduled.promise;
  await firstReload;
  assert.ok(secondReload.current);
  await secondReload.current;

  const externalState = plugin as unknown as {
    externalReloadBusy: boolean;
    externalReloadPromise: Promise<void> | null;
    externalReloadCaptures: Array<Promise<unknown>>;
  };
  assert.equal(externalState.externalReloadBusy, false);
  assert.equal(externalState.externalReloadPromise, null);
  assert.equal(externalState.externalReloadCaptures.length, 0);
  assert.deepEqual(plugin.data.nextStudyPaths, ["B.md"]);
  assert.deepEqual(disk.bases[0]?.data.nextStudyPaths, ["B.md"]);
  assert.equal(refreshCalls, 2, "the callback that arrives during finalization starts a second worker");
});

test("external Sync restores a captured future-version file overwritten by an interrupted local save", async () => {
  const app = {
    vault: emptyWritableTestVault(),
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initial = createDefaultStore(migrateData(null), 100, "vault-future-capture");
  let disk: typeof initial = structuredClone(initial);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const saveStarted = deferred();
  const releaseSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      saveStarted.resolve();
      await releaseSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const pendingMutation = plugin.mutate("Interrupted local edit", () => {
    plugin.data.pinnedPaths = ["Local.md"];
  });
  await saveStarted.promise;
  const future = structuredClone(initial);
  future.version = STORE_VERSION + 1;
  const futureBase = future.bases[0];
  assert.ok(futureBase);
  futureBase.updatedAt = (plugin.getKnowledgeBases(true)[0]?.updatedAt ?? 0) + 10_000;
  futureBase.data.nextStudyPaths = ["FUTURE.md"];
  disk = future;

  const pendingReload = plugin.onExternalSettingsChange();
  releaseSave.resolve();
  await assert.rejects(pendingMutation, /Sync while this edit was saving/i);
  await pendingReload;

  assert.equal(disk.version, STORE_VERSION + 1);
  assert.deepEqual(disk.bases[0]?.data.nextStudyPaths, ["FUTURE.md"]);
  assert.deepEqual(plugin.data.pinnedPaths, []);
  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.equal(saveCalls, 2, "the stale local write is followed by exact restoration of the future payload");
});

test("external Sync restores a future capture that arrives during an authoritative writeback", async () => {
  const primary = migrateData(null);
  primary.settings.workspaceName = "Primary";
  primary.pinnedPaths = ["Local.md"];
  const secondary = migrateData(null);
  secondary.settings.workspaceName = "Secondary";
  const local = createDefaultStore(primary, 300, "vault-nested-future");
  local.bases[0].semanticRevision = 1;
  local.bases.push(createKnowledgeBaseEntry(secondary, "base-secondary", 100));
  let disk = structuredClone(local);
  const plugin = pluginWith(structuredClone(local));
  plugin.loadData = async () => structuredClone(disk);
  const writebackStarted = deferred();
  const releaseWriteback = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      writebackStarted.resolve();
      await releaseWriteback.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const remote = structuredClone(local);
  const remotePrimary = remote.bases.find((entry) => entry.id === "base-default");
  const remoteSecondary = remote.bases.find((entry) => entry.id === "base-secondary");
  assert.ok(remotePrimary && remoteSecondary);
  remotePrimary.data.pinnedPaths = [];
  remotePrimary.updatedAt = 100;
  remotePrimary.semanticRevision = 0;
  remoteSecondary.data.nextStudyPaths = ["REMOTE-1.md"];
  remoteSecondary.updatedAt = 400;
  remoteSecondary.semanticRevision = 1;
  disk = remote;
  const firstReload = plugin.onExternalSettingsChange();
  await writebackStarted.promise;

  const future = structuredClone(remote);
  future.version = STORE_VERSION + 1;
  const futureSecondary = future.bases.find((entry) => entry.id === "base-secondary");
  assert.ok(futureSecondary);
  futureSecondary.data.nextStudyPaths = ["FUTURE-ONLY.md"];
  futureSecondary.updatedAt = 500;
  futureSecondary.semanticRevision = 2;
  disk = future;
  const secondReload = plugin.onExternalSettingsChange();
  releaseWriteback.resolve();
  await Promise.all([firstReload, secondReload]);

  assert.equal(disk.version, STORE_VERSION + 1);
  assert.deepEqual(disk.bases.find((entry) => entry.id === "base-secondary")?.data.nextStudyPaths, ["FUTURE-ONLY.md"]);
  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.equal(saveCalls, 2, "the interrupted v14 writeback is followed by exact v15 restoration");
});

test("a valid identified Sync capture recovers after a transient startup data read failure", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async (): Promise<unknown> => { throw new Error("transient partial data.json"); };
  await plugin.loadPluginData(false);
  assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);

  const recovered = createDefaultStore(migrateData(null), 500, "vault-recovered-after-read-error");
  const recoveredBase = recovered.bases[0];
  assert.ok(recoveredBase);
  recoveredBase.data.nextStudyPaths = ["Recovered.md"];
  plugin.loadData = async () => structuredClone(recovered);

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getVaultId(), "vault-recovered-after-read-error");
  assert.deepEqual(plugin.data.nextStudyPaths, ["Recovered.md"]);
  assert.equal(plugin.dataCompatibilityWarning, "");
});

test("startup recovery persists rotated identities from current-version external envelopes", async () => {
  for (const rawVaultId of ["", "vault-migrated-0123456789abcdef"]) {
    const app = {
      vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
      workspace: { getLeavesOfType: () => [] },
      metadataCache: { getFileCache: () => null },
      fileManager: {},
    };
    const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
    plugin.loadData = async (): Promise<unknown> => { throw new Error("transient partial data.json"); };
    await plugin.loadPluginData(false);
    assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);

    const incoming = createDefaultStore(migrateData(null), 500, "temporary-vault-id");
    incoming.vaultId = rawVaultId;
    let disk = structuredClone(incoming);
    let saveCalls = 0;
    plugin.loadData = async () => structuredClone(disk);
    plugin.saveData = async (value: unknown) => {
      saveCalls += 1;
      disk = structuredClone(value) as typeof disk;
    };

    await plugin.onExternalSettingsChange();

    assert.notEqual(plugin.getVaultId(), rawVaultId);
    assert.ok(plugin.getVaultId());
    assert.equal(disk.vaultId, plugin.getVaultId());
    assert.equal(saveCalls, 1, "identity rotation must be persisted exactly once");
    assert.equal(plugin.dataCompatibilityWarning, "");
  }
});

test("external Sync falls back only when this device's active base was archived", async () => {
  const ent = migrateData(null);
  ent.settings.workspaceName = "ENT";
  const research = migrateData(null);
  research.settings.workspaceName = "Research";
  const original = createDefaultStore(ent, 100, "vault-sync-test");
  original.bases.push(createKnowledgeBaseEntry(research, "base-research", 100));
  const plugin = pluginWith(structuredClone(original));
  await plugin.loadPluginData();
  const incoming = structuredClone(original);
  const archived = incoming.bases.find((entry) => entry.id === "base-default");
  assert.ok(archived);
  archived.archivedAt = 500;
  archived.updatedAt = 500;
  archived.semanticRevision = 1;
  incoming.activeBaseId = "base-research";
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-research");
  assert.equal(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.archivedAt, 500);
});

test("a synced legacy single-base payload cannot overwrite a multi-base store", async () => {
  Notice.messages.length = 0;
  const ent = migrateData(null);
  ent.settings.workspaceName = "ENT";
  const research = migrateData(null);
  research.settings.workspaceName = "Research";
  const store = createDefaultStore(ent, 100, "vault-sync-test");
  store.bases.push(createKnowledgeBaseEntry(research, "base-research", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.loadedData = migrateData(null);

  await plugin.onExternalSettingsChange();

  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.data.settings.workspaceName), ["ENT", "Research"]);
  assert.match(plugin.dataCompatibilityWarning, /older build without a vault identity/i);
  assert.equal(plugin.savedData.length, 0);
});

test("an identity-less legacy capture rescues the accumulated store before read-only mode", async () => {
  Notice.messages.length = 0;
  const ent = migrateData(null);
  ent.settings.workspaceName = "ENT";
  const research = migrateData(null);
  research.settings.workspaceName = "Research";
  const store = createDefaultStore(ent, 100, "vault-sync-test");
  store.bases.push(createKnowledgeBaseEntry(research, "base-research", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  let rescueContent = "";
  const app = plugin.app as unknown as {
    vault: {
      configDir: string;
      getMarkdownFiles(): TFile[];
      getAbstractFileByPath(path: string): TAbstractFile | null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path, content) => {
      rescueContent = content;
      return new TFile(path);
    },
  };
  plugin.savedData.length = 0;
  plugin.loadedData = migrateData(null);

  await plugin.onExternalSettingsChange();

  // The identity-less file stays authoritative on disk, so the multi-base
  // store survives a restart only through the rescue export.
  assert.notEqual(rescueContent, "");
  const rescue = JSON.parse(rescueContent) as { kind: string; store: PluginStore };
  assert.equal(rescue.kind, "knowledge-base-command-center-conflict-rescue");
  assert.equal(rescue.store.vaultId, "vault-sync-test");
  assert.deepEqual(
    rescue.store.bases.map((entry) => entry.data.settings.workspaceName),
    ["ENT", "Research"],
  );
  assert.match(plugin.dataCompatibilityWarning, /preserved in a private rescue at/i);
  assert.equal(plugin.savedData.length, 0);
});

test("switching knowledge bases is rejected while a mutate transaction is saving", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  const saveStarted = deferred();
  const releaseSave = deferred();
  plugin.saveData = async () => {
    saveStarted.resolve();
    await releaseSave.promise;
  };

  const pendingMutation = plugin.mutate("Pending organization edit", () => {
    plugin.data.settings.workspaceName = "First KB edited";
  }, { includeSettings: true });
  await saveStarted.promise;

  await assert.rejects(
    plugin.switchKnowledgeBase("base-second"),
    /finish the current organization change before switching/i,
  );
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.settings.workspaceName, "First KB edited");

  releaseSave.resolve();
  await pendingMutation;
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
});

test("mutate rejects without running its action while a base lifecycle change is being saved", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  const baseSaveStarted = deferred();
  const releaseBaseSave = deferred();
  plugin.saveData = async () => {
    baseSaveStarted.resolve();
    await releaseBaseSave.promise;
  };

  const pendingCreate = plugin.createKnowledgeBase("Third KB", "generic", "Knowledge Base");
  await baseSaveStarted.promise;
  let actionRan = false;
  await assert.rejects(
    plugin.mutate("Racing organization edit", () => { actionRan = true; }),
    /finish switching knowledge bases before changing its organization/i,
  );
  assert.equal(actionRan, false);
  assert.equal(plugin.data.settings.workspaceName, "Third KB");

  releaseBaseSave.resolve();
  await pendingCreate;
  assert.equal(plugin.data.settings.workspaceName, "Third KB");
});

test("a vault rename waits when external Sync starts in its initial idle yield", async () => {
  const data = migrateData(null);
  data.pinnedPaths = ["Old/Topic.md"];
  const original = createDefaultStore(data, 100, "vault-rename-sync-yield");
  const plugin = pluginWith(structuredClone(original));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const incoming = structuredClone(original);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  advanceStoreEntry(incomingBase, () => {
    incomingBase.data.nextStudyPaths = ["Remote.md"];
  }, 200);
  plugin.loadedData = incoming;

  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    const pendingRename = handler.handleRename("Old", "New", true);
    const pendingReload = plugin.onExternalSettingsChange();
    await Promise.all([pendingRename, pendingReload]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  assert.deepEqual(plugin.data.pinnedPaths, ["New/Topic.md"]);
  assert.deepEqual(plugin.data.nextStudyPaths, ["Remote.md"]);
  assert.equal(plugin.savedData.length, 1, "only the post-Sync rename needs an adapter write");
});

test("a vault rename retries after repeated Sync callbacks and rewrites every base once", async () => {
  const rescueContents: string[] = [];
  const future = Date.now() + 1_000_000;
  const active = migrateData(null);
  active.settings.workspaceName = "Active";
  active.pinnedPaths = ["Old/Active.md"];
  const inactive = migrateData(null);
  inactive.settings.workspaceName = "Inactive";
  inactive.nextStudyPaths = ["Old/Inactive.md"];
  const archived = migrateData(null);
  archived.settings.workspaceName = "Archived";
  archived.collections = [{ id: "archived", title: "Archived", collapsed: false, subjects: ["Old/Archived.md"], subheadings: [] }];
  const original = createDefaultStore(active, future, "vault-rename-sync-retry");
  original.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive", future + 10));
  const archivedEntry = createKnowledgeBaseEntry(archived, "base-archived", future + 20);
  advanceStoreEntry(archivedEntry, () => {
    archivedEntry.archivedAt = future + 21;
  }, future + 21);
  original.bases.push(archivedEntry);

  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      createFolder: async () => {},
      create: async (path: string, content: string) => {
        rescueContents.push(content);
        return new TFile(path);
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  let disk = structuredClone(original);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const firstRenameSaveStarted = deferred();
  const releaseFirstRenameSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      firstRenameSaveStarted.resolve();
      await releaseFirstRenameSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const incomingA = structuredClone(original);
  const incomingActive = incomingA.bases.find((entry) => entry.id === "base-default");
  assert.ok(incomingActive);
  advanceStoreEntry(incomingActive, () => {
    incomingActive.data.nextStudyPaths = ["Remote active.md"];
  }, future + 100);
  const incomingB = structuredClone(incomingA);
  const incomingInactive = incomingB.bases.find((entry) => entry.id === "base-inactive");
  const incomingArchived = incomingB.bases.find((entry) => entry.id === "base-archived");
  assert.ok(incomingInactive);
  assert.ok(incomingArchived);
  advanceStoreEntry(incomingInactive, () => {
    incomingInactive.data.pinnedPaths = ["Remote inactive.md"];
  }, future + 110);
  advanceStoreEntry(incomingArchived, () => {
    incomingArchived.data.nextStudyPaths = ["Remote archived.md"];
  }, future + 120);

  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    const pendingRename = handler.handleRename("Old", "New", true);
    await firstRenameSaveStarted.promise;
    disk = incomingA;
    const firstReload = plugin.onExternalSettingsChange();
    disk = incomingB;
    const secondReload = plugin.onExternalSettingsChange();
    releaseFirstRenameSave.resolve();
    await Promise.all([pendingRename, firstReload, secondReload]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  const finalActive = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default");
  const finalInactive = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-inactive");
  const finalArchived = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-archived");
  assert.deepEqual(finalActive?.data.pinnedPaths, ["New/Active.md"]);
  assert.deepEqual(finalInactive?.data.nextStudyPaths, ["New/Inactive.md"]);
  assert.deepEqual(finalArchived?.data.collections[0]?.subjects, ["New/Archived.md"]);
  const remoteWasPreserved = (livePaths: string[] | undefined, path: string): boolean => (
    Boolean(livePaths?.includes(path)) || rescueContents.some((content) => content.includes(path))
  );
  assert.equal(remoteWasPreserved(finalActive?.data.nextStudyPaths, "Remote active.md"), true);
  assert.equal(remoteWasPreserved(finalInactive?.data.pinnedPaths, "Remote inactive.md"), true);
  assert.equal(remoteWasPreserved(finalArchived?.data.nextStudyPaths, "Remote archived.md"), true);
  assert.ok((finalActive?.semanticRevision ?? 0) > incomingActive.semanticRevision);
  assert.ok((finalInactive?.semanticRevision ?? 0) > incomingInactive.semanticRevision);
  assert.ok((finalArchived?.semanticRevision ?? 0) > incomingArchived.semanticRevision);
  assert.equal(finalArchived?.archivedAt, future + 21);
  assert.deepEqual(disk, {
    ...disk,
    bases: plugin.getKnowledgeBases(true),
  }, "the final adapter payload contains the same active, inactive, and archived bases as memory");
});

test("the plugin rename handler preserves every note below a renamed folder and saves once", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.collections = [{ id: "c", title: "C", collapsed: false, subjects: ["Old/One.md"], subheadings: [] }];
  plugin.data.pinnedPaths = ["Old/Nested/Two.md"];
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string): Promise<void> };
    await handler.handleRename("Old", "New");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
  assert.deepEqual(plugin.data.collections[0]?.subjects, ["New/One.md"]);
  assert.deepEqual(plugin.data.pinnedPaths, ["New/Nested/Two.md"]);
  assert.equal(plugin.savedData.length, 1);
});

test("a rename confined to route and local history does not advance semantic causality", async () => {
  const data = migrateData(null);
  data.selectedPath = "Old/Viewed.md";
  const historySource = structuredClone(data);
  historySource.pinnedPaths = ["Old/Historical.md"];
  data.undoStack = [snapshotPersonal(historySource, "Local history")];
  const store = createDefaultStore(data, 100, "vault-view-only-rename");
  const plugin = pluginWith(store, createDeviceLocalPluginState(store));
  await plugin.loadPluginData(false);
  plugin.savedData.length = 0;
  plugin.deviceLocalWrites.length = 0;
  const before = plugin.getActiveKnowledgeBase();
  const beforeRevision = before.semanticRevision;
  const beforeHead = before.semanticHead;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Old", "New", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  assert.equal(plugin.data.selectedPath, "New/Viewed.md");
  assert.deepEqual(plugin.data.undoStack[0]?.pinnedPaths, ["New/Historical.md"]);
  assert.equal(plugin.getActiveKnowledgeBase().semanticRevision, beforeRevision);
  assert.equal(plugin.getActiveKnowledgeBase().semanticHead, beforeHead);
  assert.equal(plugin.savedData.length, 0);
  assert.equal(plugin.deviceLocalWrites.length, 1);
});

test("a failed vault-rename compensation enters the same sticky uncertain-persistence mode", async () => {
  const data = migrateData(null);
  data.pinnedPaths = ["Old/Topic.md"];
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-rename-compensation-failure"));
  await plugin.loadPluginData(false);
  let writes = 0;
  plugin.saveData = async () => {
    writes += 1;
    throw new Error(writes === 1 ? "rename write rejected" : "rename compensation rejected");
  };
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await assert.rejects(handler.handleRename("Old", "New", true), /organization is now read-only/i);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  assert.equal(writes, 2);
  assert.deepEqual(plugin.data.pinnedPaths, ["Old/Topic.md"]);
  assert.equal(plugin.isDataReadOnly(), true);
  assert.match(plugin.dataCompatibilityWarning, /vault-rename rewrite|compensating rollback/i);
});

test("an inactive-base rename advances only that base's timestamp monotonically", async () => {
  const active = migrateData(null);
  active.settings.workspaceName = "ENT";
  const inactive = migrateData(null);
  inactive.settings.workspaceName = "Research";
  inactive.pinnedPaths = ["Old/Only inactive.md"];
  const store = createDefaultStore(active, 100, "vault-rename-test");
  const inactiveEntry = createKnowledgeBaseEntry(inactive, "base-research", Date.now() + 60_000);
  const priorInactiveTimestamp = inactiveEntry.updatedAt;
  store.bases.push(inactiveEntry);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Old/Only inactive.md", "New/Only inactive.md", false);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  const [savedActive, savedInactive] = plugin.getKnowledgeBases(true);
  assert.equal(savedActive?.updatedAt, 100);
  assert.ok((savedInactive?.updatedAt ?? 0) > priorInactiveTimestamp);
  assert.deepEqual(savedInactive?.data.pinnedPaths, ["New/Only inactive.md"]);
  assert.equal(plugin.savedData.length, 1);
});

test("folder-derived group renames are isolated by base root, including archived bases", async () => {
  const active = migrateData(null);
  active.settings.workspaceName = "Active matching base";
  active.settings.primaryFolder = "Root A";
  active.indexGroupOrder = ["Old Group", "Other"];
  active.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)] = ["Root A/Old Group/Active.md"];
  active.portableIndex.groups = [{ id: "active-group", title: "Old Group", order: 0 }];

  const inactive = migrateData(null);
  inactive.settings.workspaceName = "Inactive different root";
  inactive.settings.primaryFolder = "Root B";
  inactive.indexGroupAliases = { "Old Group": "Inactive display" };
  inactive.indexGroupOrder = ["Inactive display"];
  inactive.curriculumVisual.orderByContainer[curriculumContainerKey("Inactive display", null)] = ["Root B/Old Group/Inactive.md"];
  inactive.portableIndex.groups = [{ id: "inactive-group", title: "Inactive display", order: 0 }];

  const archived = migrateData(null);
  archived.settings.workspaceName = "Archived matching base";
  archived.settings.primaryFolder = "Root A";
  archived.indexGroupAliases = { "Old Group": "Archived display" };
  archived.indexGroupOrder = ["Old Group", "Archived display"];
  archived.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)] = ["Root A/Old Group/Archived.md"];
  archived.portableIndex.groups = [{ id: "archived-group", title: "Old Group", order: 0 }];

  const store = createDefaultStore(active, 100);
  store.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive", 200));
  const archivedEntry = createKnowledgeBaseEntry(archived, "base-archived", 300);
  archivedEntry.archivedAt = 400;
  store.bases.push(archivedEntry);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Root A/Old Group", "Root A/New Group", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  const [savedActive, savedInactive, savedArchived] = plugin.getKnowledgeBases(true).map((entry) => entry.data);
  assert.deepEqual(savedActive?.indexGroupAliases, {});
  assert.deepEqual(savedActive?.indexGroupOrder, ["Old Group", "New Group", "Other"]);
  assert.deepEqual(savedActive?.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)], ["Root A/New Group/Active.md"]);
  assert.deepEqual(savedActive?.curriculumVisual.orderByContainer[curriculumContainerKey("New Group", null)], ["Root A/New Group/Active.md"]);
  assert.equal(savedActive?.portableIndex.groups[0]?.title, "Old Group");

  assert.deepEqual(savedInactive?.indexGroupAliases, { "Old Group": "Inactive display" });
  assert.deepEqual(savedInactive?.indexGroupOrder, ["Inactive display"]);
  assert.deepEqual(savedInactive?.curriculumVisual.orderByContainer[curriculumContainerKey("Inactive display", null)], ["Root B/Old Group/Inactive.md"]);
  assert.equal(savedInactive?.portableIndex.groups[0]?.title, "Inactive display");

  assert.deepEqual(savedArchived?.indexGroupAliases, {
    "Old Group": "Archived display",
    "New Group": "Archived display",
  });
  assert.deepEqual(savedArchived?.indexGroupOrder, ["Old Group", "Archived display"]);
  assert.deepEqual(savedArchived?.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)], ["Root A/New Group/Archived.md"]);
  assert.deepEqual(savedArchived?.curriculumVisual.orderByContainer[curriculumContainerKey("Archived display", null)], ["Root A/New Group/Archived.md"]);
  assert.equal(savedArchived?.portableIndex.groups[0]?.title, "Old Group");
  assert.equal(plugin.savedData.length, 1);
});

test("folder rename preservation is conservative and does not enumerate the vault", async () => {
  const unrelatedFile = new TFile("References/Unrelated topic.md");
  const data = migrateData(null);
  data.settings.primaryFolder = "Knowledge Base";
  data.settings.groupProperty = "category";
  data.indexGroupAliases = { "Old Group": "Display group" };
  data.indexGroupOrder = ["Display group"];
  data.portableIndex = {
    version: 1,
    groups: [{ id: "stable-old-group", title: "Old Group", order: 0 }],
    subjects: [{
      id: "stable-subject",
      title: "Explicit topic",
      groupId: "stable-old-group",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  const { plugin, sourceMutationCount, vaultEnumerationCount } = pluginWithFiles(data, [unrelatedFile], {
    [unrelatedFile.path]: { category: "Different Group" },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Knowledge Base/Old Group", "Knowledge Base/New Group", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  assert.deepEqual(plugin.data.indexGroupAliases, {
    "Old Group": "Display group",
    "New Group": "Display group",
  });
  assert.deepEqual(plugin.data.portableIndex.groups, [{ id: "stable-old-group", title: "Old Group", order: 0 }]);
  assert.equal(plugin.data.portableIndex.subjects[0]?.groupId, "stable-old-group");
  assert.equal(plugin.savedData.length, 1);
  assert.equal(sourceMutationCount(), 0);
  assert.equal(vaultEnumerationCount(), 0);
});

test("root-folder renames rewrite active, inactive, archived, and nested snapshot settings", async () => {
  const configureBase = (name: string, primaryFolder: string) => {
    const data = migrateData(null);
    data.settings.workspaceName = name;
    data.settings.primaryFolder = primaryFolder;
    data.settings.proposalFolder = "Vault Root/Inbox/Topic Proposals";
    data.settings.templatesFolder = "Vault Root/Templates";
    data.settings.defaultNoteFolder = `${primaryFolder}/Inbox`;
    data.settings.defaultTemplatePath = "Vault Root/Templates/Topic.md";
    const history = snapshotPersonal(data, "Saved base settings", true);
    const nested = snapshotPersonal(data, "Nested base settings", true);
    nested.layoutSnapshots = undefined;
    history.layoutSnapshots = [nested];
    data.layoutSnapshots = [structuredClone(history)];
    data.undoStack = [structuredClone(history)];
    data.redoStack = [structuredClone(history)];
    return data;
  };
  const active = configureBase("Active", "Vault Root/Knowledge");
  const inactive = configureBase("Inactive", "Vault Root/Research");
  const archived = configureBase("Archived", "Vault Root/Archive");
  const store = createDefaultStore(active, 100);
  store.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive", 200));
  const archivedEntry = createKnowledgeBaseEntry(archived, "base-archived", 300);
  archivedEntry.archivedAt = 400;
  store.bases.push(archivedEntry);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Vault Root", "Renamed Root", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  for (const entry of plugin.getKnowledgeBases(true)) {
    const expectedPrimary = `Renamed Root/${entry.data.settings.workspaceName === "Active"
      ? "Knowledge"
      : entry.data.settings.workspaceName === "Inactive" ? "Research" : "Archive"}`;
    const savedSettings = [
      entry.data.layoutSnapshots[0]?.settings,
      entry.data.layoutSnapshots[0]?.layoutSnapshots?.[0]?.settings,
    ];
    for (const settings of [entry.data.settings, ...savedSettings]) {
      assert.equal(settings?.primaryFolder, expectedPrimary);
      assert.equal(settings?.proposalFolder, "Renamed Root/Inbox/Topic Proposals");
      assert.equal(settings?.templatesFolder, "Renamed Root/Templates");
      assert.equal(settings?.defaultNoteFolder, `${expectedPrimary}/Inbox`);
      assert.equal(settings?.defaultTemplatePath, "Renamed Root/Templates/Topic.md");
    }
    assert.deepEqual(entry.data.undoStack, [], "cold start never adopts synced undo history");
    assert.deepEqual(entry.data.redoStack, [], "cold start never adopts synced redo history");
  }
  assert.equal(plugin.savedData.length, 1);
});

test("template file renames update current and nested saved settings without group migration", async () => {
  const data = migrateData(null);
  data.settings.primaryFolder = "Knowledge Base";
  data.settings.defaultTemplatePath = "Templates/Old topic.md";
  data.indexGroupAliases = { "Old topic.md": "Do not migrate this group" };
  const history = snapshotPersonal(data, "Template settings", true);
  history.layoutSnapshots = [snapshotPersonal(data, "Nested template settings", true)];
  data.layoutSnapshots = [structuredClone(history)];
  data.undoStack = [structuredClone(history)];
  data.redoStack = [structuredClone(history)];
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Templates/Old topic.md", "Templates/New topic.md", false);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  for (const settings of [
    plugin.data.settings,
    plugin.data.layoutSnapshots[0]?.settings,
    plugin.data.layoutSnapshots[0]?.layoutSnapshots?.[0]?.settings,
  ]) {
    assert.equal(settings?.defaultTemplatePath, "Templates/New topic.md");
    assert.equal(settings?.primaryFolder, "Knowledge Base");
  }
  assert.deepEqual(plugin.data.undoStack, []);
  assert.deepEqual(plugin.data.redoStack, []);
  assert.deepEqual(plugin.data.indexGroupAliases, { "Old topic.md": "Do not migrate this group" });
  assert.equal(plugin.savedData.length, 1);
});

test("file renames do not trigger folder-derived group migration", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.settings.primaryFolder = "Knowledge Base";
  plugin.data.indexGroupAliases = { "Old Group": "Display group" };
  plugin.data.indexGroupOrder = ["Display group"];
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Knowledge Base/Old Group", "Knowledge Base/New Group", false);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
  assert.deepEqual(plugin.data.indexGroupAliases, { "Old Group": "Display group" });
  assert.deepEqual(plugin.data.indexGroupOrder, ["Display group"]);
  assert.equal(plugin.savedData.length, 0);
});

test("test runtime uses the in-memory Obsidian plugin boundary", () => {
  const base = new Plugin();
  assert.ok(Array.isArray(base.savedData));
});

test("a corrupt data.json opens read-only instead of stopping the plugin from loading", async () => {
  Notice.messages.length = 0;
  const plugin = pluginWith(null);
  // Obsidian's loadData() performs JSON.parse, so a malformed file rejects here.
  (plugin as unknown as { loadData(): Promise<unknown> }).loadData = () =>
    Promise.reject(new SyntaxError("Unexpected end of JSON input"));
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);
  assert.match(plugin.dataCompatibilityWarning, /read-only/i);
  // The plugin still has usable defaults, and never writes over the bad file.
  assert.equal(plugin.data.version, DATA_VERSION);
  assert.equal(plugin.isDataReadOnly(), true);
  assert.equal(plugin.savedData.length, 0);
  await plugin.savePluginData();
  assert.equal(plugin.savedData.length, 0);
  assert.throws(() => plugin.assertDataWritable(), /could not be parsed/i);
  assert.equal(Notice.messages.some((message) => /could not be parsed/i.test(message)), true);
});

function vaultWith(fileCount: number) {
  const files = Array.from({ length: fileCount }, (_, index) => new TFile(`Knowledge Base/Group ${index % 20}/Note ${index}.md`));
  return {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => files,
      getAbstractFileByPath: () => null,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
}

test("index membership lookups stay constant-time across a large vault", async () => {
  const fileCount = 10_000;
  const plugin = new EntVaultCommandCenterPlugin(vaultWith(fileCount) as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  // Half the vault also carries an explicit manual membership. Testing these
  // with Array.includes inside the per-file loop is quadratic.
  plugin.data.manualIndexPaths = Array.from({ length: 5_000 }, (_, index) => `Elsewhere/Manual ${index}.md`);
  plugin.data.excludedIndexPaths = Array.from({ length: 2_000 }, (_, index) => `Knowledge Base/Group ${index % 20}/Note ${index}.md`);
  plugin.invalidateRecordCache();

  const start = performance.now();
  const records = plugin.getRecords();
  const elapsed = performance.now() - start;
  assert.equal(records.length, fileCount - plugin.data.excludedIndexPaths.length);
  assert.ok(elapsed < 750, `building records for ${fileCount} files took ${elapsed.toFixed(1)} ms`);

  // A warm cache must not rescan at all.
  const cachedStart = performance.now();
  assert.equal(plugin.getRecords(), records);
  assert.ok(performance.now() - cachedStart < 100, "a warm record cache should not rebuild");
});

test("ENT Index eligibility validation remains linear across 32,000 portable subjects", async () => {
  const subjectCount = 32_000;
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.portableIndex.groups = [{ id: "bulk-index", title: "Bulk Index", order: 0 }];
  data.portableIndex.subjects = Array.from({ length: subjectCount }, (_, index) => ({
    id: `bulk-topic-${index}`,
    title: `Bulk topic ${index}`,
    groupId: "bulk-index",
    parentId: null,
    order: index,
    indexed: true,
    configuredId: "",
    recordKind: "topic" as const,
    libraryId: null,
  }));
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  const start = performance.now();
  plugin.assertClinicalIndexEligibility();
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 1_000, `validating ${subjectCount.toLocaleString()} indexed subjects took ${elapsed.toFixed(1)} ms`);
});

test("hidden notes leave the index while manual members stay in it", async () => {
  const plugin = new EntVaultCommandCenterPlugin(vaultWith(6) as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  plugin.data.excludedIndexPaths = ["Knowledge Base/Group 0/Note 0.md"];
  plugin.invalidateRecordCache();
  const paths = plugin.getRecords().map((item) => item.path);
  assert.equal(paths.includes("Knowledge Base/Group 0/Note 0.md"), false);
  assert.equal(paths.includes("Knowledge Base/Group 1/Note 1.md"), true);
});

test("display aliases and collection memberships stay local while switching knowledge bases", async () => {
  const file = new TFile("Knowledge Base/Airway/Shared topic.md");
  file.stat.mtime = 12345;
  const frontmatter = { title: "Source title", category: "Airway", aliases: ["Original alias"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  first.settings.workspaceMode = "generic";
  first.settings.primaryFolder = "Knowledge Base";
  first.collections = [{
    id: "first-collection",
    title: "First collection",
    collapsed: false,
    subjects: [file.path],
    subheadings: [],
  }];
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  second.settings.workspaceMode = "generic";
  second.settings.primaryFolder = "Knowledge Base";
  second.collections = [{
    id: "second-collection",
    title: "Second collection",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "second-subheading", title: "Second subheading", collapsed: false, subjects: [file.path] }],
  }];
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const { plugin, sourceMutationCount } = pluginWithFiles(store, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  await plugin.renameRecordDisplay(file.path, "First display label");
  assert.equal(plugin.getRecord(file.path)?.title, "First display label");
  assert.equal(plugin.getRecord(file.path)?.sourceTitle, "Source title");
  assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
  assert.deepEqual(plugin.data.collections[0]?.subheadings[0]?.subjects, undefined);

  await plugin.switchKnowledgeBase("base-second");
  assert.equal(plugin.getRecord(file.path)?.title, "Source title");
  assert.equal(plugin.data.displayNameByPath[file.path], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, []);
  assert.deepEqual(plugin.data.collections[0]?.subheadings[0]?.subjects, [file.path]);
  await plugin.renameRecordDisplay(file.path, "Second display label");

  await plugin.switchKnowledgeBase("base-default");
  assert.equal(plugin.getRecord(file.path)?.title, "First display label");
  assert.equal(plugin.data.displayNameByPath[file.path], "First display label");
  assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);

  await plugin.switchKnowledgeBase("base-second");
  assert.equal(plugin.getRecord(file.path)?.title, "Second display label");
  assert.equal(plugin.data.displayNameByPath[file.path], "Second display label");
  assert.deepEqual(plugin.data.collections[0]?.subjects, []);
  assert.deepEqual(plugin.data.collections[0]?.subheadings[0]?.subjects, [file.path]);
  assert.equal(file.path, "Knowledge Base/Airway/Shared topic.md");
  assert.equal(file.stat.mtime, 12345);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT index removal and restoration only change active-base membership", async () => {
  const file = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  file.stat.mtime = 67890;
  const frontmatter = {
    title: "Pediatric airway",
    curriculum_id: "ENT-PED-001",
    domain: "Pediatric",
    review_status: "unverified",
  };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), true);
  await plugin.removeRecordsFromIndex([file.path]);
  assert.deepEqual(plugin.data.excludedIndexPaths, [file.path]);
  assert.equal(plugin.data.manualIndexPaths.includes(file.path), false);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), false);

  await plugin.restoreRecordsToIndex([file.path]);
  assert.equal(plugin.data.excludedIndexPaths.includes(file.path), false);
  assert.equal(
    plugin.data.manualIndexPaths.includes(file.path),
    false,
    "an in-folder clinical topic is indexed by its source identity, not a redundant manual membership",
  );
  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), true);
  assert.equal(file.path, "03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  assert.equal(file.stat.mtime, 67890);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT batch restore rejects a mixed topic and protected clinical record atomically", async () => {
  const topic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  data.excludedIndexPaths = [topic.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [topic, medication], {
    [topic.path]: { title: "Pediatric airway", curriculum_id: "ENT-PED-001", domain: "Pediatric" },
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const before = structuredClone(plugin.data);

  await assert.rejects(
    plugin.restoreRecordsToIndex([topic.path, medication.path], "Unsafe mixed restore", "Pediatric"),
    /accepts topic subjects only.*No subjects were restored/is,
  );

  assert.deepEqual(plugin.data, before);
  assert.equal(plugin.savedData.length, 0);
  assert.equal(sourceMutationCount(), 0);
});

test("a display-only alias does not rename a legacy canonical filename during an unchanged placement edit", async () => {
  const legacyPath = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - VPI assessment surgery.md";
  const file = new TFile(legacyPath);
  const frontmatter: Record<string, unknown> = {
    type: "clinical-topic",
    title: "VPI: assessment / surgery",
    curriculum_id: "ENT-LAR-010",
    domain: "Laryngology",
    topic_kind: "condition",
    priority: "P2",
    review_status: "unverified",
    sources: [],
  };
  let content = "# Legacy VPI heading\n\nBody remains here.\n";
  let renameCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: (path: string) => path === legacyPath ? file : null,
      read: async () => content,
      process: async (_file: TFile, update: (current: string) => string) => { content = update(content); },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), resolvedLinks: {} },
    fileManager: {
      renameFile: async () => { renameCalls += 1; },
      processFrontMatter: async (_file: TFile, update: (metadata: Record<string, unknown>) => void) => { update(frontmatter); },
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  data.displayNameByPath[legacyPath] = "VPI overview";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  await plugin.loadPluginData();
  const aliasedRecord = plugin.getRecord(legacyPath);
  assert.equal(aliasedRecord?.title, "VPI overview");
  assert.equal(aliasedRecord?.sourceTitle, "VPI: assessment / surgery");

  const result = await plugin.editCanonicalPlacement(legacyPath, {
    title: aliasedRecord?.sourceTitle ?? "",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: false,
    curriculumId: "ent-lar-010",
    addToCollection: false,
  });

  assert.equal(result, file);
  assert.equal(file.path, legacyPath);
  assert.equal(renameCalls, 0, "metadata-only placement changes must preserve a legacy canonical filename");
  assert.equal(frontmatter.title, "VPI: assessment / surgery");
  assert.equal(frontmatter.priority, "P1");
  assert.match(content, /^# VPI: assessment \/ surgery$/m);
  assert.match(content, /Body remains here\./);
  assert.equal(plugin.data.displayNameByPath[legacyPath], "VPI overview");
  assert.equal(plugin.getRecord(legacyPath)?.sourceTitle, "VPI: assessment / surgery");
});

test("a removed clinical portable subject resolved outside the primary folder stays Hidden and can be restored", async () => {
  const proposal = new TFile("01 Inbox/Topic Proposals/Proposal - Laryngeal Cleft.md");
  const frontmatter = {
    type: "topic-proposal",
    title: "Laryngeal Cleft",
    proposed_domain: "Pediatric",
    review_status: "unverified",
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.settings.idProperty = "curriculum_id";
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: "subject-cleft",
      title: "Laryngeal Cleft",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-003.05",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: { "subject-cleft": proposal.path },
  };
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [proposal], { [proposal.path]: frontmatter });
  await plugin.loadPluginData();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: typeof plugin.app;
    plugin: EntVaultCommandCenterPlugin;
    hiddenNotes(): Array<{ path: string; title: string; meta: string }>;
  };
  manager.app = plugin.app;
  manager.plugin = plugin;

  assert.equal(plugin.getIndexRecords().some((record) => record.path === proposal.path), true);
  await plugin.removeRecordsFromIndex([proposal.path]);

  assert.equal(plugin.getPortableSubject("subject-cleft")?.indexed, false);
  assert.deepEqual(plugin.data.excludedIndexPaths, [proposal.path]);
  assert.equal(plugin.getRecord(proposal.path)?.role, "proposal");
  assert.equal(plugin.getRecord(proposal.path)?.portableIndexed, false);
  assert.deepEqual(manager.hiddenNotes(), [{
    path: proposal.path,
    title: "Proposal - Laryngeal Cleft",
    meta: proposal.path,
  }]);

  await plugin.restoreRecordsToIndex([proposal.path]);

  assert.equal(plugin.getPortableSubject("subject-cleft")?.indexed, true);
  assert.equal(plugin.data.excludedIndexPaths.includes(proposal.path), false);
  assert.equal(plugin.data.manualIndexPaths.includes(proposal.path), true);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === proposal.path), true);
  assert.deepEqual(manager.hiddenNotes(), []);
  assert.equal(proposal.path, "01 Inbox/Topic Proposals/Proposal - Laryngeal Cleft.md");
  assert.deepEqual(frontmatter, {
    type: "topic-proposal",
    title: "Laryngeal Cleft",
    proposed_domain: "Pediatric",
    review_status: "unverified",
  });
  assert.equal(sourceMutationCount(), 0);
});

test("removing a whole clinical heading keeps its outside-root subjects restorable in Hidden", async () => {
  const proposal = new TFile("01 Inbox/Topic Proposals/Proposal - Airway.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: "subject-airway",
      title: "Airway",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-001",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: { "subject-airway": proposal.path },
  };
  const { plugin } = pluginWithFiles(data, [proposal], {
    [proposal.path]: { type: "topic-proposal", title: "Airway", proposed_domain: "Pediatric" },
  });
  await plugin.loadPluginData();
  const members = plugin.getIndexRecords().filter((item) => item.domain === "Pediatric");
  assert.equal(members.length, 1);
  let confirmation: Promise<void> = Promise.resolve();
  ConfirmModal.prototype.open = function confirmForTest(): void {
    confirmation = Promise.resolve((this as unknown as { onConfirm(): void | Promise<void> }).onConfirm());
  };
  const manager = new IndexManagerModal(plugin) as unknown as {
    openedBaseId: string;
    openedDataEpoch: number;
    managerOpen: boolean;
    render(): void;
    removeGroup(group: string, records: typeof members): void;
  };
  manager.openedBaseId = plugin.getActiveKnowledgeBaseId();
  manager.openedDataEpoch = plugin.getDataEpoch();
  manager.managerOpen = true;
  manager.render = () => {};
  try {
    manager.removeGroup("Pediatric", members);
    await confirmation;
  } finally {
    delete (ConfirmModal.prototype as { open?: () => void }).open;
  }

  assert.equal(plugin.getPortableSubject("subject-airway")?.indexed, false);
  assert.ok(plugin.data.excludedIndexPaths.includes(proposal.path));
  const hidden = Object.create(IndexManagerModal.prototype) as {
    app: typeof plugin.app;
    plugin: EntVaultCommandCenterPlugin;
    hiddenNotes(): Array<{ path: string }>;
  };
  hidden.app = plugin.app;
  hidden.plugin = plugin;
  assert.deepEqual(hidden.hiddenNotes().map((item) => item.path), [proposal.path]);
});

test("unresolved ENT placeholders keep the imported group order until their notes are linked", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.allowClinicalVisualGroupMoves = false;
  data.indexGroupOrder = ["Pediatric", "Otology"];
  data.portableIndex = {
    version: 1,
    groups: [
      { id: "group-pediatric", title: "Pediatric", order: 0 },
      { id: "group-otology", title: "Otology", order: 1 },
    ],
    subjects: [
      { id: "subject-otology", title: "Hearing loss", groupId: "group-otology", parentId: null, order: 0, indexed: true, configuredId: "ENT-OTO-001", recordKind: "topic" },
      { id: "subject-pediatric", title: "Airway", groupId: "group-pediatric", parentId: null, order: 0, indexed: true, configuredId: "ENT-PED-001", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: {},
  };
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  const byDomain = new Map(plugin.getIndexRecords().map((item) => [item.domain, item.folderOrder]));
  assert.equal(byDomain.get("Pediatric"), "0000");
  assert.equal(byDomain.get("Otology"), "0001");
});

test("reconciliation preserves a temporarily missing synced note binding", async () => {
  const stalePath = "03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md";
  const data = migrateData(null);
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: "subject-airway",
      title: "Airway",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-001",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: { "subject-airway": stalePath },
  };
  data.manualIndexPaths = [stalePath];
  data.selectedPath = stalePath;
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const changed = await plugin.reconcileRecords(plugin.getRecords());

  assert.equal(changed, true, "cold-start route selection may choose the retained placeholder locally");
  assert.deepEqual(plugin.data.portableIndex.resolvedPathBySubjectId, { "subject-airway": stalePath });
  assert.deepEqual(plugin.data.manualIndexPaths, [stalePath]);
  assert.equal(plugin.data.selectedPath, stalePath);
  assert.equal(plugin.savedData.length, 0);
});

test("selection-only reconciliation uses the non-semantic view-state save path", async () => {
  const data = migrateData(null);
  data.selectedPath = "Knowledge/Missing.md";
  const store = createDefaultStore(data, 100, "vault-selection-reconcile");
  store.bases[0].semanticRevision = 6;
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const changed = await plugin.reconcileRecords([{ path: "Knowledge/Fallback.md" } as never]);

  assert.equal(changed, true);
  assert.equal(plugin.data.selectedPath, "Knowledge/Fallback.md");
  assert.equal(plugin.savedData.length, 0, "device-local route changes never rewrite data.json");
  assert.equal(plugin.getKnowledgeBases(true)[0]?.semanticRevision, 6);
  assert.equal(plugin.getKnowledgeBases(true)[0]?.updatedAt, 100);
});

test("portable JSON writes do not create a second success notice", async () => {
  Notice.messages.length = 0;
  const plugin = pluginWith(null);
  let createdPath = "";
  let createdContent = "";
  const app = plugin.app as unknown as {
    vault: {
      getAbstractFileByPath(path: string): null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path, content) => {
      createdPath = path;
      createdContent = content;
      return new TFile(path);
    },
  };

  const file = await plugin.writePortableJson("workspace", { workspace: "test" });

  assert.equal(file.path, createdPath);
  assert.match(createdPath, /^Knowledge Base Command Center Exports\/knowledge-base-command-center-workspace-/);
  assert.equal(createdContent, '{\n  "workspace": "test"\n}\n');
  assert.deepEqual(Notice.messages, []);
});

test("an undo-protected import restores and persists the pre-import state when saving fails", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalName = plugin.data.settings.workspaceName;
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated write failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(
    plugin.mutate("Import portable export", () => {
      plugin.data.settings.workspaceName = "Imported name";
    }, { includeSettings: true, requireUndo: true }),
    /simulated write failure/,
  );

  assert.equal(plugin.data.settings.workspaceName, originalName);
  assert.equal(saveAttempts, 2);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: { settings?: { workspaceName?: string } } }>;
  } | undefined;
  const persistedActive = persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId);
  assert.equal(persistedActive?.data?.settings?.workspaceName, originalName);
});

test("portfolio Replace writes strict recovery first and rolls every base back when the atomic save fails", async () => {
  const destinationData = migrateData(null);
  destinationData.settings.workspaceName = "Portfolio destination";
  const destinationStore = createDefaultStore(destinationData, 100, "vault-portfolio-rollback");
  const plugin = pluginWith(destinationStore);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const sourceData = migrateData(null);
  sourceData.settings.workspaceName = "Portfolio source";
  sourceData.indexGroupOrder = ["Imported empty heading"];
  sourceData.portableIndex.groups = [{ id: "portfolio-empty-heading", title: "Imported empty heading", order: 0 }];
  const sourceEntry = createKnowledgeBaseEntry(sourceData, "base-portfolio-source", 50);
  const bundle = createPortfolioExport([{
    entry: sourceEntry,
    records: [],
    selection: { ...EMPTY_PORTABLE_SELECTION, index: true },
  }], "2026-08-11T00:00:00.000Z", plugin.getVaultId());
  const plan = plugin.createPortfolioImportPlan(bundle, [{
    sourceBaseId: sourceEntry.id,
    destination: { kind: "existing", baseId: plugin.getActiveKnowledgeBaseId() },
    mode: "replace",
  }]);
  const before = structuredClone(plugin.getKnowledgeBases(true));
  const created: Array<{ path: string; content: string }> = [];
  const vault = plugin.app.vault as unknown as {
    getAbstractFileByPath(path: string): null;
    createFolder(path: string): Promise<void>;
    create(path: string, content: string): Promise<TFile>;
  };
  vault.create = async (path, content) => {
    created.push({ path, content });
    return new TFile(path);
  };
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated portfolio store failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(
    plugin.applyPortfolioImportPlan(plan, plan.confirmationPhrase),
    /simulated portfolio store failure/,
  );

  assert.equal(created.length, 1, "the mandatory recovery is written before the store save starts");
  assert.match(created[0]?.path ?? "", /knowledge-base-command-center-backup-/);
  const recovery = parsePortableExport(JSON.parse(created[0]?.content ?? "null") as unknown);
  assert.equal(recovery.components.recovery?.sourceBaseId, plugin.getActiveKnowledgeBaseId());
  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.data), before.map((entry) => entry.data));
  assert.equal(saveAttempts, 2, "the existing base transaction persists one compensating rollback");
  assert.equal(plugin.data.indexGroupOrder.includes("Imported empty heading"), false);
});

test("workspace-only portability import includes dependency Library descriptors in Undo", async () => {
  const libraryId = "library-workspace-dependency";
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.settings.defaultTab = libraryTabId(libraryId);
  source.portableIndex.libraries = [{
    id: libraryId,
    name: "Workspace references",
    singularName: "Reference",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  source.portableIndex.libraryLayouts = { [libraryId]: [] };
  const value = parsePortableExport(createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-09T00:00:00.000Z",
  ));
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  const settingsBefore = structuredClone(plugin.data.settings);
  assert.equal(plugin.getLibrary(libraryId), null);

  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: typeof plugin.app;
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    dataChanged: boolean;
    openedBaseId: string;
    openedDataEpoch: number;
    centerOpen: boolean;
    close(): void;
    importSelected(): Promise<void>;
  };
  center.app = plugin.app;
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.dataChanged = false;
  center.openedBaseId = plugin.getActiveKnowledgeBaseId();
  center.openedDataEpoch = plugin.getDataEpoch();
  center.centerOpen = true;
  center.close = () => { center.centerOpen = false; };

  await center.importSelected();
  assert.equal(plugin.getLibrary(libraryId)?.name, "Workspace references");
  assert.equal(plugin.data.settings.defaultTab, libraryTabId(libraryId));

  await plugin.undo();
  assert.equal(plugin.getLibrary(libraryId), null, "Undo removes the dependency descriptor created by the import");
  assert.deepEqual(plugin.data.settings, settingsBefore, "Undo restores the complete destination settings");
});

test("saved-view-only portability import includes dependency Library descriptors in Undo", async () => {
  const libraryId = "library-saved-view-dependency";
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.portableIndex.libraries = [{
    id: libraryId,
    name: "Saved-view references",
    singularName: "Reference",
    icon: "bookmark",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  source.portableIndex.libraryLayouts = { [libraryId]: [] };
  source.savedViews = [{
    id: "view-library-dependency",
    name: "Library review",
    tab: libraryTabId(libraryId),
    query: "status:unverified",
  }];
  const value = parsePortableExport(createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, savedViews: true },
    "2026-08-09T00:00:00.000Z",
  ));
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  assert.equal(plugin.getLibrary(libraryId), null);
  assert.deepEqual(plugin.data.savedViews, []);

  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: typeof plugin.app;
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    dataChanged: boolean;
    openedBaseId: string;
    openedDataEpoch: number;
    centerOpen: boolean;
    close(): void;
    importSelected(): Promise<void>;
  };
  center.app = plugin.app;
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, savedViews: true };
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.dataChanged = false;
  center.openedBaseId = plugin.getActiveKnowledgeBaseId();
  center.openedDataEpoch = plugin.getDataEpoch();
  center.centerOpen = true;
  center.close = () => { center.centerOpen = false; };

  await center.importSelected();
  assert.equal(plugin.getLibrary(libraryId)?.name, "Saved-view references");
  assert.equal(plugin.data.savedViews[0]?.tab, libraryTabId(libraryId));

  await plugin.undo();
  assert.equal(plugin.getLibrary(libraryId), null, "Undo removes the saved-view dependency descriptor");
  assert.deepEqual(plugin.data.savedViews, [], "Undo removes the imported saved view");
});

test("a failed Undo save restores the current data and both history stacks", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.pinnedPaths = ["Knowledge Base/Before.md"];
  const beforeChange = snapshotPersonal(plugin.data, "Change pinned note");
  plugin.data.pinnedPaths = ["Knowledge Base/After.md"];
  plugin.data.nextStudyPaths = ["Knowledge Base/After.md"];
  plugin.data.undoStack = [beforeChange];
  plugin.data.redoStack = [];
  const expected = structuredClone(plugin.data);
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated Undo save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.undo(), /simulated Undo save failure/);

  assert.equal(saveAttempts, 2, "the restored pre-Undo store must be persisted after the failed write");
  assert.deepEqual(plugin.data, expected);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: unknown }>;
  } | undefined;
  assert.deepEqual(persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId)?.data, neutralSyncedData(expected));
});

test("a failed Redo save restores the current data and both history stacks", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.pinnedPaths = ["Knowledge Base/Original.md"];
  const existingUndo = snapshotPersonal(plugin.data, "Earlier pinned-note change");
  plugin.data.pinnedPaths = ["Knowledge Base/Redone.md"];
  plugin.data.nextStudyPaths = ["Knowledge Base/Redone.md"];
  const redoChange = snapshotPersonal(plugin.data, "Change pinned note");
  plugin.data.pinnedPaths = ["Knowledge Base/Current.md"];
  plugin.data.nextStudyPaths = ["Knowledge Base/Current.md"];
  plugin.data.undoStack = [existingUndo];
  plugin.data.redoStack = [redoChange];
  const expected = structuredClone(plugin.data);
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated Redo save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.redo(), /simulated Redo save failure/);

  assert.equal(saveAttempts, 2, "the restored pre-Redo store must be persisted after the failed write");
  assert.deepEqual(plugin.data, expected);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: unknown }>;
  } | undefined;
  assert.deepEqual(persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId)?.data, neutralSyncedData(expected));
});

test("an ordinary mutate save failure restores personal state and existing history", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.pinnedPaths = ["Knowledge Base/Undo state.md"];
  const existingUndo = snapshotPersonal(plugin.data, "Existing Undo entry");
  plugin.data.pinnedPaths = ["Knowledge Base/Redo state.md"];
  const existingRedo = snapshotPersonal(plugin.data, "Existing Redo entry");
  plugin.data.pinnedPaths = ["Knowledge Base/Current.md"];
  plugin.data.nextStudyPaths = ["Knowledge Base/Current.md"];
  plugin.data.collections = [{
    id: "current",
    title: "Current collection",
    collapsed: false,
    subjects: ["Knowledge Base/Current.md"],
    subheadings: [],
  }];
  plugin.data.selectedPath = "Knowledge Base/Current.md";
  plugin.data.activeTab = "collections";
  plugin.data.collapsed = {
    curriculumDomains: ["ENT"],
    curriculumNodes: ["Knowledge Base/Current.md"],
    queues: ["next"],
  };
  plugin.data.undoStack = [existingUndo];
  plugin.data.redoStack = [existingRedo];
  const expected = structuredClone(plugin.data);
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated ordinary mutation save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(
    plugin.mutate("Unsaved organization change", () => {
      plugin.data.pinnedPaths = ["Knowledge Base/Changed.md"];
      plugin.data.nextStudyPaths = [];
      plugin.data.collections = [];
      plugin.data.selectedPath = "Knowledge Base/Changed.md";
      plugin.data.activeTab = "queues";
      plugin.data.collapsed = { curriculumDomains: [], curriculumNodes: [], queues: [] };
    }),
    /simulated ordinary mutation save failure/,
  );

  assert.equal(saveAttempts, 2, "the restored pre-mutation store must be persisted after the failed write");
  assert.deepEqual(plugin.data, expected);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: unknown }>;
  } | undefined;
  assert.deepEqual(persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId)?.data, neutralSyncedData(expected));
});

test("resolving a portable placeholder preserves placement and Undo only unlinks the note", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-laryngeal-cleft";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 2,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [placeholder];
  plugin.data.indexGroupByPath[placeholder] = "Airway";
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [placeholder], subheadings: [] }];

  await plugin.resolvePortableSubject(subjectId, linkedFile.path);

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], linkedFile.path);
  assert.deepEqual(plugin.data.portableIndex.relinkableSubjectIds, [subjectId]);
  assert.equal(plugin.getRecord(linkedFile.path)?.portableRelinkable, true);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  assert.equal(plugin.data.indexGroupByPath[linkedFile.path], "Airway");
  assert.equal(plugin.data.manualIndexPaths.includes(placeholder), false);

  await plugin.undo();

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [placeholder]);
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
  assert.equal(app.vault.getAbstractFileByPath(linkedFile.path), linkedFile);
});

test("Undo invalidates cached placeholder metadata", async () => {
  const app = {
    vault: { configDir: ".obsidian", getAbstractFileByPath: () => null, getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [{ id: "subject", title: "Old title", groupId: "group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("subject")];
  plugin.invalidateRecordCache();
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "Old title");

  await plugin.mutate("Rename imported subject", () => {
    const subject = plugin.getPortableSubject("subject");
    if (subject) subject.title = "New title";
    plugin.invalidateRecordCache();
  }, { includePortableIndex: true });
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "New title");

  await plugin.undo();
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "Old title");
});

test("confirmed identity reassignment merges bindings without duplicate organization paths and Undo restores both", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Local renamed note.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const importedId = "subject-imported";
  const localId = "subject-local";
  const importedPath = portablePlaceholderPath(importedId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [
      { id: importedId, title: "Imported title", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: localId, title: "Local renamed note", groupId: "group-airway", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { [localId]: linkedFile.path },
  };
  plugin.data.manualIndexPaths = [importedPath, linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [importedPath, linkedFile.path], subheadings: [] }];

  await assert.rejects(plugin.resolvePortableSubject(importedId, linkedFile.path), /identity reassignment/i);
  await plugin.resolvePortableSubject(importedId, linkedFile.path, true);

  assert.equal(plugin.data.portableIndex.subjects.length, 1);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[importedId], linkedFile.path);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[localId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  assert.deepEqual(plugin.data.manualIndexPaths, [linkedFile.path]);

  await plugin.undo();
  assert.equal(plugin.data.portableIndex.subjects.length, 2);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[localId], linkedFile.path);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [importedPath, linkedFile.path]);
});

test("identity reassignment refuses ancestor and descendant merges that would create a cycle", async () => {
  const linkedFile = new TFile("Knowledge Base/Ancestor.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [
      { id: "ancestor", title: "Ancestor", groupId: "group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "middle", title: "Middle", groupId: "group", parentId: "ancestor", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "descendant", title: "Descendant", groupId: "group", parentId: "middle", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { ancestor: linkedFile.path },
  };

  await assert.rejects(
    plugin.resolvePortableSubject("descendant", linkedFile.path, true),
    /ancestors or descendants/i,
  );
  assert.equal(plugin.data.portableIndex.subjects.length, 3);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.ancestor, linkedFile.path);
});

test("unlinking a resolved portable subject restores its placeholder without changing the Markdown file", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-cleft";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{ id: subjectId, title: "Laryngeal Cleft", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { [subjectId]: linkedFile.path },
    relinkableSubjectIds: [subjectId],
  };
  plugin.data.manualIndexPaths = [linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [linkedFile.path], subheadings: [] }];

  await plugin.unlinkPortableSubject(subjectId);

  const placeholder = portablePlaceholderPath(subjectId);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [placeholder]);
  assert.equal(app.vault.getAbstractFileByPath(linkedFile.path), linkedFile);
});

test("Index Manager keeps a removed portable placeholder discoverable under Available", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-available";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.invalidateRecordCache();
  const manager = Object.create(IndexManagerModal.prototype) as {
    plugin: EntVaultCommandCenterPlugin;
    availableNotes(): Array<{ path: string; title: string; meta: string }>;
  };
  manager.plugin = plugin;

  assert.deepEqual(manager.availableNotes(), [{
    path: portablePlaceholderPath(subjectId),
    title: "Laryngeal Cleft",
    meta: "Airway · imported subject without a note",
  }]);
});

test("Index Manager does not mislabel library subjects as Available or Hidden index records", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-library-only";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex.libraries = [{
    id: "library-reference",
    name: "References",
    singularName: "Reference",
    icon: "book-open",
    order: 0,
    archivedAt: null,
    sourceKind: null,
  }];
  plugin.data.portableIndex.groups = [{ id: "group-reference", title: "References", order: 0 }];
  plugin.data.portableIndex.subjects = [{
    id: subjectId,
    title: "Clinical handbook",
    groupId: "group-reference",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "note",
    libraryId: "library-reference",
  }];
  plugin.data.portableIndex.libraryLayouts = {
    "library-reference": [{
      id: "heading-reference",
      title: "References",
      collapsed: false,
      subjects: [subjectId],
      subheadings: [],
    }],
  };
  plugin.data.excludedIndexPaths = [placeholder];
  plugin.invalidateRecordCache();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: typeof app;
    plugin: EntVaultCommandCenterPlugin;
    availableNotes(): Array<{ path: string }>;
    hiddenNotes(): Array<{ path: string }>;
  };
  manager.app = app;
  manager.plugin = plugin;

  assert.deepEqual(manager.availableNotes(), []);
  assert.deepEqual(manager.hiddenNotes(), []);
});

test("Index Manager rename and merge preserve collapsed visual group state", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.data.indexGroupOrder = ["Airway", "Pediatric"];
  plugin.data.collapsed.curriculumDomains = ["Airway"];
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: typeof plugin.app;
    plugin: EntVaultCommandCenterPlugin;
    openedBaseId: string;
    openedDataEpoch: number;
    staleBaseNoticeShown: boolean;
    managerOpen: boolean;
    render(): void;
    renameGroup(group: string): void;
    mergeGroup(group: string): void;
  };
  manager.app = plugin.app;
  manager.plugin = plugin;
  manager.openedBaseId = plugin.getActiveKnowledgeBaseId();
  manager.openedDataEpoch = plugin.getDataEpoch();
  manager.staleBaseNoticeShown = false;
  manager.managerOpen = true;
  manager.render = () => {};

  let renameDone: Promise<void> = Promise.resolve();
  const textOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
  TextPromptModal.prototype.open = function submitRename(): void {
    const options = (this as unknown as { options: { onSubmit(value: string): void | Promise<void> } }).options;
    renameDone = Promise.resolve(options.onSubmit("Upper Airway"));
  };
  try {
    manager.renameGroup("Airway");
    await renameDone;
  } finally {
    if (textOpen) Object.defineProperty(TextPromptModal.prototype, "open", textOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
  }
  assert.deepEqual(plugin.data.collapsed.curriculumDomains, ["Upper Airway"]);

  let mergeDone: Promise<void> = Promise.resolve();
  const pickerOpen = Object.getOwnPropertyDescriptor(StringPickerModal.prototype, "open");
  const confirmOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  StringPickerModal.prototype.open = function choosePediatric(): void {
    (this as unknown as { onChoose(value: string): void | Promise<void> }).onChoose("Pediatric");
  };
  ConfirmModal.prototype.open = function confirmMerge(): void {
    mergeDone = Promise.resolve((this as unknown as { onConfirm(): void | Promise<void> }).onConfirm());
  };
  try {
    manager.mergeGroup("Upper Airway");
    await mergeDone;
  } finally {
    if (pickerOpen) Object.defineProperty(StringPickerModal.prototype, "open", pickerOpen);
    else Reflect.deleteProperty(StringPickerModal.prototype, "open");
    if (confirmOpen) Object.defineProperty(ConfirmModal.prototype, "open", confirmOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }
  assert.deepEqual(plugin.data.collapsed.curriculumDomains, ["Pediatric"]);
});

test("adding an available portable placeholder restores membership and captures it in Undo", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const subjectId = "subject-restore";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.indexGroupOrder = ["Airway"];
  plugin.data.indexGroupByPath[placeholder] = "Airway";
  plugin.invalidateRecordCache();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: typeof app;
    plugin: EntVaultCommandCenterPlugin;
    selected: Set<string>;
    tab: string;
    render(): void;
    chooseGroupForSelection(mode: "add" | "restore" | "move"): void;
  };
  manager.app = app;
  manager.plugin = plugin;
  manager.selected = new Set([placeholder]);
  manager.tab = "available";
  manager.render = () => {};

  let resolveSubmission: () => void = () => {};
  let rejectSubmission: (error: unknown) => void = () => {};
  const submission = new Promise<void>((resolve, reject) => {
    resolveSubmission = resolve;
    rejectSubmission = reject;
  });
  IndexGroupModal.prototype.open = function openForTest(): void {
    const options = (this as unknown as {
      options: { initialValue: string; onSubmit(group: string): void | Promise<void> };
    }).options;
    void Promise.resolve(options.onSubmit(options.initialValue)).then(resolveSubmission, rejectSubmission);
  };
  try {
    manager.chooseGroupForSelection("add");
    await submission;
  } finally {
    delete (IndexGroupModal.prototype as { open?: () => void }).open;
  }

  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, true);
  assert.ok(plugin.data.manualIndexPaths.includes(placeholder));
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.equal(plugin.data.undoStack.at(-1)?.portableIndex?.subjects[0]?.indexed, false);

  await plugin.undo();

  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, false);
  assert.equal(plugin.data.manualIndexPaths.includes(placeholder), false);
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
});

test("an indexed clinical subject linked to an unverified proposal remains in both the index and Inbox export", async () => {
  const proposal = new TFile("01 Inbox/Topic Proposals/Proposal - Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === proposal.path ? proposal : null,
      getMarkdownFiles: () => [proposal],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: () => ({ frontmatter: { type: "topic-proposal", title: "Laryngeal Cleft", proposed_domain: "Pediatric" } }),
      resolvedLinks: {},
    },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "ent-clinical";
  plugin.data.settings.primaryFolder = "03 Clinical Topics";
  plugin.data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  plugin.data.settings.idProperty = "curriculum_id";
  const subjectId = "subject-cleft";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-003.05",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [placeholder];

  await plugin.resolvePortableSubject(subjectId, proposal.path);

  const linked = plugin.getRecord(proposal.path);
  assert.equal(linked?.kind, "topic");
  assert.equal(linked?.role, "proposal");
  assert.equal(linked?.portableIndexed, true);
  assert.deepEqual(plugin.getIndexRecords().map((record) => record.path), [proposal.path]);
  assert.deepEqual(plugin.getRecords().filter((record) => record.role === "proposal").map((record) => record.path), [proposal.path]);

  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  assert.equal(exported.components.index?.subjects[0]?.id, subjectId);
  assert.equal(exported.components.index?.subjects[0]?.configuredId, "ENT-PED-003.05");
  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, true);
});

test("a collection-only generic placeholder can link a new in-folder note without entering the index", async () => {
  const created = new TFile("Knowledge Base/Reference material.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === created.path ? created : null,
      getMarkdownFiles: () => [created],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { title: "Reference material" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  const subjectId = "subject-reference";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-reference", title: "Reference", order: 0 }],
    subjects: [{ id: subjectId, title: "Reference material", groupId: "group-reference", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "note" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.collections = [{ id: "reference", title: "Reference", collapsed: false, subjects: [placeholder], subheadings: [] }];

  await plugin.resolvePortableSubject(subjectId, created.path);

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], created.path);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [created.path]);
  assert.equal(plugin.data.excludedIndexPaths.includes(created.path), true);
  assert.equal(plugin.getRecord(created.path)?.kind, "note");
  assert.equal(plugin.getIndexRecords().some((record) => record.path === created.path), false);
});

test("a non-indexed syndrome linked to an ordinary generic note survives cache rebuild as a library record", async () => {
  const linkedFile = new TFile("Reference/Usher syndrome.md");
  linkedFile.stat.mtime = 24680;
  const frontmatter = { title: "Usher syndrome", tags: ["reference"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const subjectId = "subject-usher-syndrome";
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-syndromes", title: "Syndromes", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Usher syndrome",
      groupId: "group-syndromes",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "syndrome",
    }],
    resolvedPathBySubjectId: {},
  };
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [linkedFile], { [linkedFile.path]: frontmatter });
  await plugin.loadPluginData();

  await plugin.resolvePortableSubject(subjectId, linkedFile.path);
  plugin.invalidateRecordCache();
  const rebuilt = plugin.getRecord(linkedFile.path);

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], linkedFile.path);
  assert.equal(rebuilt?.kind, "syndrome");
  assert.equal(rebuilt?.portableId, subjectId);
  assert.equal(rebuilt?.portableIndexed, false);
  assert.equal(rebuilt?.isPlaceholder, undefined);
  assert.equal(plugin.data.manualIndexPaths.includes(linkedFile.path), false);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === linkedFile.path), false);
  assert.equal(linkedFile.path, "Reference/Usher syndrome.md");
  assert.equal(linkedFile.stat.mtime, 24680);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("custom libraries support stable CRUD, locale-invariant names, ordering, archive, and restore", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const researchId = await plugin.createLibrary({
    name: "Research",
    singularName: "Paper",
    icon: "not-a-lucide-icon",
  });
  assert.match(researchId, /^library-/);
  assert.equal(plugin.getLibrary(researchId)?.icon, "library", "unknown icons use the safe fallback");
  assert.equal(plugin.data.activeTab, libraryTabId(researchId));
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts[researchId], []);

  await assert.rejects(
    plugin.createLibrary({ name: "research", singularName: "Duplicate", icon: "library" }),
    /already exists/i,
  );
  assert.equal(plugin.getLibraries(true).length, 1);

  const guidelinesId = await plugin.createLibrary({
    name: "Guidelines",
    singularName: "Guideline",
    icon: "book-open",
  });
  await plugin.reorderLibrary(guidelinesId, 0);
  assert.deepEqual(plugin.getLibraries().map((library) => library.id), [guidelinesId, researchId]);

  await plugin.updateLibrary(researchId, {
    name: "Evidence",
    singularName: "Study",
    icon: "microscope",
  });
  const exposed = plugin.getLibrary(researchId);
  assert.ok(exposed);
  exposed.name = "Mutated outside Undo";
  assert.deepEqual(plugin.getLibrary(researchId), {
    id: researchId,
    name: "Evidence",
    singularName: "Study",
    icon: "microscope",
    order: 1,
    sourceKind: null,
    archivedAt: null,
  }, "public reads must not expose mutable plugin state");

  plugin.data.activeTab = libraryTabId(researchId);
  plugin.data.settings.defaultTab = libraryTabId(researchId);
  await plugin.archiveLibrary(researchId);
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");
  assert.equal(plugin.getLibraries().some((library) => library.id === researchId), false);
  assert.equal(typeof plugin.getLibrary(researchId)?.archivedAt, "number");

  await plugin.restoreLibrary(researchId);
  assert.equal(plugin.getLibrary(researchId)?.archivedAt, null);
  assert.equal(plugin.getLibrary(researchId)?.id, researchId, "rename, reorder, archive, and restore retain the stable ID");
  assert.equal(plugin.savedData.length, 6, "each accepted CRUD operation persists once; duplicate rejection does not save");
});

test("renaming an imported Library preserves its forward-compatible icon ID", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.portableIndex.libraries = [{
    id: "library-imported",
    name: "Imported references",
    singularName: "Reference",
    icon: "future-library-icon",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  data.portableIndex.libraryLayouts = { "library-imported": [] };
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  await plugin.updateLibrary("library-imported", {
    name: "Renamed references",
    singularName: "Reference",
    icon: "future-library-icon",
  });

  assert.equal(plugin.getLibrary("library-imported")?.name, "Renamed references");
  assert.equal(plugin.getLibrary("library-imported")?.icon, "future-library-icon");
});

test("custom-library names, headings, and groups stay identical on Turkish and Azeri hosts", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "toLocaleLowerCase");
  assert.ok(originalDescriptor);

  for (const locale of ["tr", "az"] as const) {
    Object.defineProperty(String.prototype, "toLocaleLowerCase", {
      ...originalDescriptor,
      value(this: string): string {
        return this.replaceAll("I", "ı").replaceAll("İ", "i").toLowerCase();
      },
    });
    try {
      assert.equal("ISTANBUL".toLocaleLowerCase(), "ıstanbul", `${locale} host simulation must distinguish locale-sensitive casing`);

      const files = [
        new TFile(`Knowledge Base/${locale}/Library upper.md`),
        new TFile(`Knowledge Base/${locale}/Library lower.md`),
        new TFile(`Knowledge Base/${locale}/Topic upper.md`),
        new TFile(`Knowledge Base/${locale}/Topic lower.md`),
      ];
      const frontmatter = Object.fromEntries(files.map((file) => [file.path, { title: file.basename }]));
      const data = migrateData(null);
      data.settings.workspaceMode = "generic";
      data.settings.primaryFolder = "Knowledge Base";
      const { plugin } = pluginWithFiles(data, files, frontmatter);
      await plugin.loadPluginData();

      const libraryId = await plugin.createLibrary({ name: "ISTANBUL", singularName: "Item", icon: "library" });
      await assert.rejects(
        plugin.createLibrary({ name: "istanbul", singularName: "Duplicate", icon: "library" }),
        /already exists/i,
      );
      await plugin.assignRecordToLibrary(files[0].path, libraryId, { headingTitle: "ISTANBUL" });
      await plugin.assignRecordToLibrary(files[1].path, libraryId, { headingTitle: "istanbul" });

      const layout = plugin.data.portableIndex.libraryLayouts[libraryId] ?? [];
      const librarySubjects = plugin.data.portableIndex.subjects.filter((subject) => subject.libraryId === libraryId);
      assert.equal(layout.length, 1, `${locale} host must not create a case-only duplicate library heading`);
      assert.equal(layout[0]?.subjects.length, 2);
      assert.equal(new Set(librarySubjects.map((subject) => subject.groupId)).size, 1,
        `${locale} host must not create a case-only duplicate library group`);

      await plugin.assignRecordToCatalog(files[2].path, "topic", { headingTitle: "ISTANBUL" });
      await plugin.assignRecordToCatalog(files[3].path, "topic", { headingTitle: "istanbul" });
      const topicSubjects = plugin.data.portableIndex.subjects.filter((subject) => subject.indexed
        && (subject.title === files[2].basename || subject.title === files[3].basename));
      assert.equal(topicSubjects.length, 2);
      assert.equal(new Set(topicSubjects.map((subject) => subject.groupId)).size, 1,
        `${locale} host must not create a case-only duplicate topic group`);
    } finally {
      Object.defineProperty(String.prototype, "toLocaleLowerCase", originalDescriptor);
    }
  }
});

test("Library creation profiles inherit by field, validate paths, survive archive, and clean up with deletion Undo", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.defaultNoteFolder = "Knowledge Base";
  data.settings.defaultNewNoteMode = "empty";
  data.settings.defaultTemplatePath = "Templates/Default.md";
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  const libraryId = await plugin.createLibrary({ name: "Research", singularName: "Paper", icon: "microscope" });

  assert.equal(plugin.getLibraryNoteProfile(libraryId), null);
  assert.deepEqual(plugin.getEffectiveLibraryNoteProfile(libraryId), {
    folder: "Knowledge Base",
    mode: "empty",
    templatePath: "Templates/Default.md",
    inherited: { folder: true, mode: true, templatePath: true },
  });
  await assert.rejects(plugin.setLibraryNoteProfile(libraryId, { folder: ".obsidian/plugins" }), /cannot be inside/i);
  await plugin.setLibraryNoteProfile(libraryId, { folder: "Research/Papers", mode: "empty" });
  assert.deepEqual(plugin.getEffectiveLibraryNoteProfile(libraryId), {
    folder: "Research/Papers",
    mode: "empty",
    templatePath: "Templates/Default.md",
    inherited: { folder: false, mode: false, templatePath: true },
  });

  await plugin.undo();
  assert.equal(plugin.getLibraryNoteProfile(libraryId), null);
  await plugin.redo();
  assert.deepEqual(plugin.getLibraryNoteProfile(libraryId), { folder: "Research/Papers", mode: "empty" });
  await plugin.archiveLibrary(libraryId);
  assert.deepEqual(plugin.getLibraryNoteProfile(libraryId), { folder: "Research/Papers", mode: "empty" });
  await plugin.deleteLibrary(libraryId, "unassigned");
  assert.equal(plugin.getLibraryNoteProfile(libraryId), null);
  await plugin.undo();
  assert.deepEqual(plugin.getLibraryNoteProfile(libraryId), { folder: "Research/Papers", mode: "empty" });
});

test("library Create, Archive, and Delete restore navigation and defaults through Undo and Redo", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.activeTab = "collections";
  data.settings.defaultTab = "queues";
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  const libraryId = await plugin.createLibrary({ name: "Research", singularName: "Paper", icon: "microscope" });
  const tab = libraryTabId(libraryId);
  assert.equal(plugin.data.activeTab, tab);
  await plugin.undo();
  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.data.activeTab, "queues", "cold start uses the configured default rather than a synced route");
  assert.equal(plugin.data.settings.defaultTab, "queues");
  await plugin.redo();
  assert.ok(plugin.getLibrary(libraryId));
  assert.equal(plugin.data.activeTab, tab);

  plugin.data.settings.defaultTab = tab;
  await plugin.archiveLibrary(libraryId);
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");
  await plugin.undo();
  assert.equal(plugin.getLibrary(libraryId)?.archivedAt, null);
  assert.equal(plugin.data.activeTab, tab);
  assert.equal(plugin.data.settings.defaultTab, tab);
  await plugin.redo();
  assert.equal(typeof plugin.getLibrary(libraryId)?.archivedAt, "number");
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");

  // Synced or recovered state can still point at an archived tab. Permanent
  // deletion must preserve that exact pre-delete state for history recovery.
  plugin.data.activeTab = tab;
  plugin.data.settings.defaultTab = tab;
  await plugin.deleteLibrary(libraryId, "unassigned");
  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");
  await plugin.undo();
  assert.equal(typeof plugin.getLibrary(libraryId)?.archivedAt, "number");
  assert.equal(plugin.data.activeTab, tab);
  assert.equal(plugin.data.settings.defaultTab, tab);
  await plugin.redo();
  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");
});

test("custom-library assignment is visual-only and Undo or Redo preserves personal memberships", async () => {
  const file = new TFile("Knowledge Base/ENT/Laryngomalacia.md");
  file.stat.mtime = 86420;
  const frontmatter = { title: "Laryngomalacia", aliases: ["Congenital laryngeal collapse"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.collections = [{ id: "study", title: "Study", collapsed: false, subjects: [file.path], subheadings: [] }];
  data.pinnedPaths = [file.path];
  data.nextStudyPaths = [file.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();
  const libraryId = await plugin.createLibrary({ name: "Pediatric airway", singularName: "Topic", icon: "stethoscope" });

  await plugin.assignRecordToLibrary(file.path, libraryId, { headingTitle: "Congenital airway" });

  const assigned = plugin.getRecord(file.path);
  const subjectId = assigned?.portableId ?? "";
  assert.ok(subjectId);
  assert.equal(assigned?.kind, "topic", "custom visual libraries do not rewrite semantic type");
  assert.equal(assigned?.libraryId, libraryId);
  assert.equal(assigned?.role, "library");
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts[libraryId]?.[0]?.subjects, [subjectId]);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
  assert.deepEqual(plugin.data.pinnedPaths, [file.path]);
  assert.deepEqual(plugin.data.nextStudyPaths, [file.path]);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(file.path, "Knowledge Base/ENT/Laryngomalacia.md");
  assert.equal(file.stat.mtime, 86420);
  assert.equal(sourceMutationCount(), 0);

  await plugin.undo();
  assert.equal(plugin.getRecord(file.path)?.libraryId, undefined);
  assert.equal(plugin.getLibrary(libraryId)?.name, "Pediatric airway");
  assert.deepEqual(plugin.data.pinnedPaths, [file.path]);

  await plugin.redo();
  assert.equal(plugin.getRecord(file.path)?.libraryId, libraryId);
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assert.equal(sourceMutationCount(), 0);
});

test("deleting an archived custom library can safely rehome subjects and is fully Undoable", async () => {
  const first = new TFile("Knowledge Base/ENT/Laryngeal cleft.md");
  const second = new TFile("Knowledge Base/ENT/Velopharyngeal insufficiency.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.collections = [{ id: "review", title: "Review", collapsed: false, subjects: [first.path], subheadings: [] }];
  data.pinnedPaths = [first.path];
  data.nextStudyPaths = [second.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [first, second], {
    [first.path]: { title: "Laryngeal cleft" },
    [second.path]: { title: "Velopharyngeal insufficiency" },
  });
  await plugin.loadPluginData();
  const sourceId = await plugin.createLibrary({ name: "Airway", singularName: "Airway topic", icon: "activity" });
  const targetId = await plugin.createLibrary({ name: "Review library", singularName: "Review topic", icon: "bookmark" });
  await plugin.assignRecordToLibrary(first.path, sourceId, { headingTitle: "Congenital" });
  await plugin.assignRecordToLibrary(second.path, sourceId, { headingTitle: "Functional" });
  const subjectIds = [plugin.getRecord(first.path)?.portableId ?? "", plugin.getRecord(second.path)?.portableId ?? ""];
  assert.equal(subjectIds.every(Boolean), true);
  const sourceGroupIds = subjectIds.map((id) => plugin.getPortableSubject(id)?.groupId ?? "");
  const originalLayout = structuredClone(plugin.data.portableIndex.libraryLayouts[sourceId]);
  plugin.data.savedViews = [{ id: "airway-view", name: "Airway", tab: libraryTabId(sourceId), query: "lary" }];

  await plugin.archiveLibrary(sourceId);
  await plugin.deleteLibrary(sourceId, { libraryId: targetId });

  assert.equal(plugin.getLibrary(sourceId), null);
  assert.equal(plugin.data.portableIndex.libraryLayouts[sourceId], undefined);
  assert.equal(plugin.data.savedViews.some((view) => view.tab === libraryTabId(sourceId)), false);
  for (const path of [first.path, second.path]) {
    assert.equal(plugin.getRecord(path)?.libraryId, targetId);
    assert.equal(plugin.getRecord(path)?.portableIndexed, false);
  }
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts[targetId], [], "rehomed subjects start unplaced in the destination layout");
  assert.equal(plugin.data.portableIndex.groups.some((group) => sourceGroupIds.includes(group.id)), false, "orphaned source-only groups are removed");
  assert.deepEqual(plugin.data.collections[0]?.subjects, [first.path]);
  assert.deepEqual(plugin.data.pinnedPaths, [first.path]);
  assert.deepEqual(plugin.data.nextStudyPaths, [second.path]);
  assert.equal(sourceMutationCount(), 0);

  await plugin.undo();
  assert.equal(typeof plugin.getLibrary(sourceId)?.archivedAt, "number");
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts[sourceId], originalLayout);
  assert.deepEqual(subjectIds.map((id) => plugin.getPortableSubject(id)?.libraryId), [sourceId, sourceId]);
  assert.equal(plugin.data.savedViews.some((view) => view.tab === libraryTabId(sourceId)), true);

  await plugin.redo();
  assert.equal(plugin.getLibrary(sourceId), null);
  assert.deepEqual(subjectIds.map((id) => plugin.getPortableSubject(id)?.libraryId), [targetId, targetId]);
  assert.equal(sourceMutationCount(), 0);
});

test("deleting a custom library to the index keeps non-topic semantics visible and never writes Markdown", async () => {
  const file = new TFile("Reference/Imported evidence.md");
  const frontmatter = { title: "Imported evidence", aliases: ["Evidence note"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();
  const libraryId = await plugin.createLibrary({ name: "Evidence", singularName: "Evidence item", icon: "microscope" });
  await plugin.assignRecordToLibrary(file.path, libraryId, { headingTitle: "Imported" });
  const subjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(subjectId);
  assert.equal(plugin.getRecord(file.path)?.kind, "note");

  await plugin.archiveLibrary(libraryId);
  await plugin.deleteLibrary(libraryId, "index");

  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.getRecord(file.path)?.kind, "note", "index placement remains independent of semantic type");
  assert.equal(plugin.getRecord(file.path)?.libraryId, undefined);
  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, true);
  assert.equal(plugin.data.manualIndexPaths.includes(file.path), true, "out-of-root notes need explicit index membership");
  assert.equal(plugin.data.indexGroupByPath[file.path], "Ungrouped");
  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), true);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT library deletion rejects mixed semantic rehomes atomically while custom targets stay unrestricted", async () => {
  const topic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-003 - Laryngeal cleft.md");
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [topic, medication], {
    [topic.path]: { title: "Laryngeal cleft", curriculum_id: "ENT-PED-003", domain: "Pediatric" },
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  const sourceId = await plugin.createLibrary({ name: "Mixed review", singularName: "Record", icon: "flask-conical" });
  const customTargetId = await plugin.createLibrary({ name: "Unrestricted archive", singularName: "Record", icon: "archive" });
  await plugin.assignRecordToLibrary(topic.path, sourceId, { headingTitle: "Topics" });
  await plugin.assignRecordToLibrary(medication.path, sourceId, { headingTitle: "Treatments" });
  await plugin.archiveLibrary(sourceId);

  const before = structuredClone(plugin.data);
  assert.match(plugin.getLibraryRemovalDestinationError(sourceId, "index") ?? "", /index accepts topic subjects only.*Allergodil.*No subjects were moved/is);
  await assert.rejects(plugin.deleteLibrary(sourceId, "index"), /index accepts topic subjects only.*No subjects were moved/is);
  assert.deepEqual(plugin.data, before, "an incompatible index rehome cannot move only the matching subset");

  assert.match(
    plugin.getLibraryRemovalDestinationError(sourceId, { libraryId: "medication" }) ?? "",
    /built-in Medications library accepts medication subjects only.*Laryngeal cleft.*No subjects were moved/is,
  );
  await assert.rejects(
    plugin.deleteLibrary(sourceId, { libraryId: "medication" }),
    /built-in Medications library accepts medication subjects only.*No subjects were moved/is,
  );
  assert.deepEqual(plugin.data, before, "a mixed source library must be all-or-nothing for a protected clinical destination");

  assert.equal(plugin.getLibraryRemovalDestinationError(sourceId, { libraryId: customTargetId }), null);
  await plugin.deleteLibrary(sourceId, { libraryId: customTargetId });
  assert.equal(plugin.getRecord(topic.path)?.libraryId, customTargetId);
  assert.equal(plugin.getRecord(medication.path)?.libraryId, customTargetId);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT library deletion rehomes native topics to the index and same-kind records to built-in libraries", async () => {
  const topic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-004 - Laryngomalacia.md");
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Ciprofloxacin.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [topic, medication], {
    [topic.path]: { title: "Laryngomalacia", curriculum_id: "ENT-PED-004", domain: "Pediatric" },
    [medication.path]: { title: "Ciprofloxacin", ent_domains: ["Otology"] },
  });
  await plugin.loadPluginData();

  const topicSourceId = await plugin.createLibrary({ name: "Topic review", singularName: "Topic", icon: "bookmark" });
  await plugin.assignRecordToLibrary(topic.path, topicSourceId, { headingTitle: "Pediatric" });
  assert.equal(plugin.data.excludedIndexPaths.includes(topic.path), true, "custom placement temporarily hides the native topic");
  await plugin.archiveLibrary(topicSourceId);
  assert.equal(plugin.getLibraryRemovalDestinationError(topicSourceId, "index"), null);
  await plugin.deleteLibrary(topicSourceId, "index");
  assert.equal(plugin.getRecord(topic.path)?.kind, "topic");
  assert.equal(plugin.getRecord(topic.path)?.libraryId, undefined);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === topic.path), true);

  const medicationSourceId = await plugin.createLibrary({ name: "Medication review", singularName: "Medication", icon: "pill" });
  await plugin.assignRecordToLibrary(medication.path, medicationSourceId, { headingTitle: "Otology" });
  await plugin.archiveLibrary(medicationSourceId);
  assert.equal(plugin.getLibraryRemovalDestinationError(medicationSourceId, { libraryId: "medication" }), null);
  await plugin.deleteLibrary(medicationSourceId, { libraryId: "medication" });
  assert.equal(plugin.getRecord(medication.path)?.kind, "medication");
  assert.equal(plugin.getRecord(medication.path)?.libraryId, "medication");
  assert.equal(sourceMutationCount(), 0);
});

test("a failed custom-library deletion save restores the exact definition, subjects, layout, and history", async () => {
  const file = new TFile("Knowledge Base/ENT/Choanal atresia.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: { title: "Choanal atresia" } });
  await plugin.loadPluginData();
  const libraryId = await plugin.createLibrary({ name: "Congenital", singularName: "Condition", icon: "dna" });
  await plugin.assignRecordToLibrary(file.path, libraryId, { headingTitle: "Nasal" });
  await plugin.archiveLibrary(libraryId);
  const expected = structuredClone(plugin.data);
  plugin.savedData.length = 0;
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated library deletion write failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.deleteLibrary(libraryId, "index"), /simulated library deletion write failure/i);

  assert.equal(saveAttempts, 2, "the rollback is persisted after the rejected write");
  assert.deepEqual(plugin.data, expected);
  assert.equal(plugin.getRecord(file.path)?.libraryId, libraryId);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: unknown }>;
  } | undefined;
  assert.deepEqual(persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId)?.data, neutralSyncedData(expected));
  assert.equal(sourceMutationCount(), 0);
});

test("deleting a 50,000-subject custom library removes layout memberships in linear time", async () => {
  const subjectCount = 50_000;
  const libraryId = "library-bulk-delete";
  const groupId = "bulk";
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.portableIndex.libraries.push({
    id: libraryId,
    name: "Bulk archive",
    singularName: "Item",
    icon: "archive",
    order: data.portableIndex.libraries.length,
    sourceKind: null,
    archivedAt: 1,
  });
  data.portableIndex.groups.push({ id: groupId, title: "Bulk", order: data.portableIndex.groups.length });
  data.portableIndex.subjects = Array.from({ length: subjectCount }, (_, index) => ({
    id: `s${index}`,
    title: `S${index}`,
    groupId,
    parentId: null,
    order: index,
    indexed: false,
    configuredId: "",
    recordKind: "note" as const,
    libraryId,
  }));
  data.portableIndex.libraryLayouts[libraryId] = [{
    id: "all",
    title: "All",
    collapsed: false,
    subjects: data.portableIndex.subjects.map((subject) => subject.id),
    subheadings: [],
  }];
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  const start = performance.now();
  await plugin.deleteLibrary(libraryId, "unassigned");
  const elapsed = performance.now() - start;

  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.data.portableIndex.subjects.filter((subject) => subject.libraryId === libraryId).length, 0);
  assert.equal(plugin.data.portableIndex.libraryLayouts[libraryId], undefined);
  assert.ok(elapsed < 2_500, `deleting ${subjectCount} layout memberships took ${elapsed.toFixed(1)} ms`);
});

test("custom-library definitions are isolated per knowledge base", async () => {
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.workspaceName = "ENT";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.workspaceName = "Research";
  const store = createDefaultStore(first, 100, "vault-custom-library-isolation");
  store.bases.push(createKnowledgeBaseEntry(second, "base-research", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();

  const entLibraryId = await plugin.createLibrary({ name: "Guidelines", singularName: "Guideline", icon: "book-open" });
  await plugin.switchKnowledgeBase("base-research");
  assert.equal(plugin.getLibrary(entLibraryId), null);
  assert.deepEqual(plugin.getLibraries(), []);
  const researchLibraryId = await plugin.createLibrary({ name: "Guidelines", singularName: "Paper", icon: "microscope" });
  assert.notEqual(researchLibraryId, entLibraryId);

  await plugin.switchKnowledgeBase("base-default");
  assert.equal(plugin.getLibrary(entLibraryId)?.singularName, "Guideline");
  assert.equal(plugin.getLibrary(researchLibraryId), null);
  assert.deepEqual(plugin.getLibraries().map((library) => library.id), [entLibraryId]);
});

test("custom-library creation enforces the bounded per-base maximum without saving", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.portableIndex.libraries = Array.from({ length: MAX_LIBRARIES }, (_, index) => ({
    id: `custom-${index + 1}`,
    name: `Custom ${index + 1}`,
    singularName: "Item",
    icon: "library",
    order: index,
    sourceKind: null,
    archivedAt: null,
  }));
  data.portableIndex.libraryLayouts = Object.fromEntries(data.portableIndex.libraries.map((library) => [library.id, []]));
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  await assert.rejects(
    plugin.createLibrary({ name: "Over capacity", singularName: "Item", icon: "library" }),
    new RegExp(`at most ${MAX_LIBRARIES} libraries`, "i"),
  );
  assert.equal(plugin.getLibraries(true).length, MAX_LIBRARIES);
  assert.equal(plugin.savedData.length, 0);
});

test("generic notes can be assigned directly to a library without changing Markdown or personal path memberships", async () => {
  const file = new TFile("Knowledge Base/ENT/ALLERGODIL 0.1% NS 10 ML.md");
  file.stat.mtime = 43210;
  const frontmatter = { title: "ALLERGODIL 0.1% NS 10 ML", aliases: ["Azelastine nasal spray"], category: "ENT" };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.manualIndexPaths = [file.path];
  data.indexGroupByPath[file.path] = "ENT";
  data.collections = [{ id: "collection", title: "Review", collapsed: false, subjects: [file.path], subheadings: [] }];
  data.pinnedPaths = [file.path];
  data.nextStudyPaths = [file.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });

  const medication = plugin.getRecord(file.path);
  const subjectId = medication?.portableId ?? "";
  assert.ok(subjectId);
  assert.equal(medication?.kind, "medication");
  assert.equal(medication?.role, "library");
  assert.equal(medication?.domain, "Nasal medications");
  assert.equal(medication?.portableRelinkable, undefined);
  assert.equal(plugin.data.portableIndex.libraryLayouts.medication[0]?.subjects[0], subjectId);
  assert.equal(plugin.data.manualIndexPaths.includes(file.path), false);
  assert.equal(plugin.data.excludedIndexPaths.includes(file.path), true);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
  assert.deepEqual(plugin.data.pinnedPaths, [file.path]);
  assert.deepEqual(plugin.data.nextStudyPaths, [file.path]);
  assert.equal(file.path, "Knowledge Base/ENT/ALLERGODIL 0.1% NS 10 ML.md");
  assert.equal(file.stat.mtime, 43210);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
  await assert.rejects(
    plugin.unlinkPortableSubject(subjectId),
    /only a note explicitly linked from a portable placeholder/i,
  );
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");

  await plugin.undo();
  assert.equal(plugin.getRecord(file.path)?.kind, "topic");
  assert.equal(plugin.getRecord(file.path)?.portableId, undefined);
  assert.deepEqual(plugin.data.manualIndexPaths, [file.path]);
  assert.deepEqual(plugin.data.excludedIndexPaths, []);
  assert.equal(sourceMutationCount(), 0);
});

test("a deliberately deleted library heading stays deleted when the catalog is initialized again", async () => {
  const file = new TFile("Knowledge Base/ENT/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], {
    [file.path]: { title: "Allergodil" },
  });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });
  const subjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(subjectId);

  await plugin.mutate("Delete medication heading", () => {
    plugin.data.portableIndex.libraryLayouts.medication = [];
  }, { includePortableIndex: true, requireUndo: true });
  const saveCountAfterDelete = plugin.savedData.length;

  await plugin.initializeLibraryCatalog("medication");

  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication, []);
  assert.equal(plugin.data.portableIndex.libraries.some((library) => library.id === "medication"), true);
  assert.equal(plugin.savedData.length, saveCountAfterDelete, "re-entering Arrange must not save or recreate deliberate unplacement");
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(sourceMutationCount(), 0);
});

test("classifying one shared Markdown note as a medication is isolated to the active knowledge base", async () => {
  const file = new TFile("Knowledge Base/Shared/Allergodil.md");
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.workspaceName = "ENT medications";
  first.settings.primaryFolder = "Knowledge Base";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.workspaceName = "General notes";
  second.settings.primaryFolder = "Knowledge Base";
  const store = createDefaultStore(first, 100, "vault-library-isolation");
  store.bases.push(createKnowledgeBaseEntry(second, "base-general", 200));
  const { plugin, sourceMutationCount } = pluginWithFiles(store, [file], {
    [file.path]: { title: "Allergodil" },
  });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });
  const firstSubjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(firstSubjectId);
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");

  await plugin.switchKnowledgeBase("base-general");
  assert.equal(plugin.getRecord(file.path)?.kind, "topic");
  assert.equal(plugin.getRecord(file.path)?.portableId, undefined);
  assert.equal(plugin.data.portableIndex.libraryLayouts.medication, undefined);
  assert.equal(plugin.data.portableIndex.libraries.some((library) => library.id === "medication"), false);

  await plugin.switchKnowledgeBase("base-default");
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(plugin.getRecord(file.path)?.portableId, firstSubjectId);
  assert.equal(sourceMutationCount(), 0);
});

test("classification survives a store reload and Undo or Redo never loses pins, collections, or Next", async () => {
  const file = new TFile("Knowledge Base/ENT/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.pinnedPaths = [file.path];
  data.nextStudyPaths = [file.path];
  data.collections = [{
    id: "review",
    title: "Review",
    collapsed: false,
    subjects: [file.path],
    subheadings: [],
  }];
  const firstHarness = pluginWithFiles(data, [file], { [file.path]: { title: "Allergodil" } });
  await firstHarness.plugin.loadPluginData();
  await firstHarness.plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });
  const subjectId = firstHarness.plugin.getRecord(file.path)?.portableId ?? "";
  const persisted = structuredClone(firstHarness.plugin.savedData.at(-1));
  const deviceState = structuredClone(firstHarness.plugin.deviceLocalWrites.at(-1));
  assert.ok(subjectId && persisted);

  const reloadedHarness = pluginWithFiles(
    persisted,
    [file],
    { [file.path]: { title: "Allergodil" } },
    deviceState,
  );
  const plugin = reloadedHarness.plugin;
  await plugin.loadPluginData();
  const assertPersonalMemberships = (): void => {
    assert.deepEqual(plugin.data.pinnedPaths, [file.path]);
    assert.deepEqual(plugin.data.nextStudyPaths, [file.path]);
    assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
  };

  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assertPersonalMemberships();

  await plugin.undo();
  assert.equal(plugin.getRecord(file.path)?.kind, "topic");
  assert.equal(plugin.getRecord(file.path)?.portableId, undefined);
  assertPersonalMemberships();

  await plugin.redo();
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assertPersonalMemberships();
  assert.equal(firstHarness.sourceMutationCount() + reloadedHarness.sourceMutationCount(), 0);
});

test("classified library identity and placement survive file and containing-folder renames", async () => {
  const file = new TFile("Knowledge Base/Old group/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], {
    [file.path]: { title: "Allergodil" },
  });
  await plugin.loadPluginData();
  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });
  const subjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(subjectId);

  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as {
      handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void>;
    };
    const oldFilePath = file.path;
    file.path = "Knowledge Base/Old group/Azelastine.md";
    await handler.handleRename(oldFilePath, file.path, false);
    assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], file.path);

    file.path = "Knowledge Base/New group/Azelastine.md";
    await handler.handleRename("Knowledge Base/Old group", "Knowledge Base/New group", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], file.path);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[0]?.subjects, [subjectId]);
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assert.equal(sourceMutationCount(), 0);
});

test("library moves keep one stable identity, isolate same-title catalog groups, and can return to the topic index", async () => {
  const medicationFile = new TFile("Knowledge Base/Allergodil.md");
  const procedureFile = new TFile("Knowledge Base/Septoplasty.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.pinnedPaths = [medicationFile.path];
  data.nextStudyPaths = [medicationFile.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [medicationFile, procedureFile], {
    [medicationFile.path]: { title: "Allergodil" },
    [procedureFile.path]: { title: "Septoplasty" },
  });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(medicationFile.path, "medication", { headingTitle: "General" });
  const stableId = plugin.getRecord(medicationFile.path)?.portableId ?? "";
  const medicationGroupId = plugin.getPortableSubject(stableId)?.groupId ?? "";
  await plugin.assignRecordToCatalog(procedureFile.path, "procedure", { headingTitle: "General" });
  const procedureId = plugin.getRecord(procedureFile.path)?.portableId ?? "";
  const procedureGroupId = plugin.getPortableSubject(procedureId)?.groupId ?? "";

  assert.ok(stableId);
  assert.ok(procedureId);
  assert.notEqual(medicationGroupId, procedureGroupId);
  assert.equal(plugin.data.portableIndex.groups.find((group) => group.id === medicationGroupId)?.title, "General");
  assert.equal(plugin.data.portableIndex.groups.find((group) => group.id === procedureGroupId)?.title, "General");

  await plugin.assignRecordToCatalog(medicationFile.path, "syndrome", { headingTitle: "General" });
  assert.equal(plugin.getRecord(medicationFile.path)?.portableId, stableId);
  assert.equal(plugin.getRecord(medicationFile.path)?.kind, "syndrome");
  assert.equal(plugin.data.portableIndex.libraryLayouts.medication.some((heading) => heading.subjects.includes(stableId)), false);
  assert.equal(plugin.data.portableIndex.libraryLayouts.syndrome.filter((heading) => heading.subjects.includes(stableId)).length, 1);

  await plugin.assignRecordToCatalog(medicationFile.path, "topic", { headingTitle: "Therapeutics" });
  assert.equal(plugin.getRecord(medicationFile.path)?.portableId, stableId);
  assert.equal(plugin.getRecord(medicationFile.path)?.kind, "syndrome", "moving to the index must not erase semantic type");
  assert.equal(plugin.getRecord(medicationFile.path)?.libraryId, undefined);
  assert.equal(plugin.getPortableSubject(stableId)?.indexed, true);
  assert.equal(plugin.data.indexGroupByPath[medicationFile.path], "Therapeutics");
  assert.equal(plugin.data.excludedIndexPaths.includes(medicationFile.path), false);
  const genericTree = buildCurriculumTree(plugin.getRecords(), plugin.data.curriculumVisual, false);
  assert.equal(genericTree.nodeByPath.has(medicationFile.path), true, "a Generic indexed non-topic remains visible in the rendered Index tree");
  assert.equal(
    buildCurriculumTree(plugin.getRecords(), plugin.data.curriculumVisual, true).nodeByPath.has(medicationFile.path),
    false,
    "the ENT topic-only projection remains defensive",
  );
  for (const kind of ["procedure", "medication", "syndrome"] as const) {
    assert.equal(plugin.data.portableIndex.libraryLayouts[kind].some((heading) => heading.subjects.includes(stableId)
      || heading.subheadings.some((subheading) => subheading.subjects.includes(stableId))), false);
  }
  await plugin.assignRecordToCatalog(medicationFile.path, "medication", { headingTitle: "General" });
  await plugin.removeRecordFromCatalog(medicationFile.path);
  assert.equal(plugin.getRecord(medicationFile.path)?.portableId, stableId);
  assert.equal(plugin.getRecord(medicationFile.path)?.kind, "medication", "unassigning a visual library must preserve semantic type");
  assert.equal(plugin.getRecord(medicationFile.path)?.libraryId, undefined);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === medicationFile.path), false);
  for (const libraryKind of ["procedure", "medication", "syndrome"] as const) {
    assert.equal(plugin.data.portableIndex.libraryLayouts[libraryKind].some((heading) => heading.subjects.includes(stableId)
      || heading.subheadings.some((subheading) => subheading.subjects.includes(stableId))), false);
  }
  assert.deepEqual(plugin.data.pinnedPaths, [medicationFile.path]);
  assert.deepEqual(plugin.data.nextStudyPaths, [medicationFile.path]);
  assert.equal(sourceMutationCount(), 0);
});

test("portable placeholders can be placed once under a library subheading and detach topic children safely", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const parentId = "portable-parent";
  const childId = "portable-child";
  const parentPath = portablePlaceholderPath(parentId);
  const childPath = portablePlaceholderPath(childId);
  data.portableIndex.groups = [{ id: "topic-group", title: "ENT", order: 0 }];
  data.portableIndex.subjects = [
    { id: parentId, title: "Laryngeal cleft", groupId: "topic-group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    { id: childId, title: "Repair", groupId: "topic-group", parentId, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
  ];
  data.manualIndexPaths = [parentPath, childPath];
  data.curriculumVisual.parentByPath[childPath] = parentPath;
  data.portableIndex.libraryLayouts.medication = [{
    id: "medication-heading",
    title: "ENT medications",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "nasal", title: "Nasal", collapsed: false, subjects: [] }],
  }];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [], {});
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(parentPath, "medication", { headingId: "medication-heading", subheadingId: "nasal" });

  assert.equal(plugin.getRecord(parentPath)?.portableId, parentId);
  assert.equal(plugin.getRecord(parentPath)?.kind, "medication");
  assert.equal(plugin.getRecord(parentPath)?.domain, "ENT medications");
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[0]?.subheadings[0]?.subjects, [parentId]);
  assert.equal(plugin.getPortableSubject(parentId)?.parentId, null);
  assert.equal(plugin.getPortableSubject(childId)?.parentId, null);
  assert.equal(plugin.data.curriculumVisual.parentByPath[childPath], null);
  assert.equal(plugin.data.manualIndexPaths.includes(parentPath), false);
  assert.equal(plugin.data.manualIndexPaths.includes(childPath), true);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT protected clinical records and non-topic placeholders cannot enter the Index through direct assignment", async () => {
  const procedure = new TFile("04 Procedures/Procedure - Septoplasty.md");
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const syndrome = new TFile("06 Clinical Tools/Syndromes/Syndrome - Usher.md");
  const proposal = new TFile("01 Inbox/ENT Topic Proposals/Proposal - Bare proposal.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/ENT Topic Proposals";
  data.portableIndex.groups = [{ id: "clinical-imports", title: "Clinical imports", order: 0 }];
  data.portableIndex.subjects = (["procedure", "medication", "syndrome", "proposal", "note"] as const).map((kind, order) => ({
    id: `placeholder-${kind}`,
    title: `${kind} placeholder`,
    groupId: "clinical-imports",
    parentId: null,
    order,
    indexed: false,
    configuredId: "",
    recordKind: kind,
    libraryId: null,
  }));
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [procedure, medication, syndrome, proposal], {
    [procedure.path]: { title: "Septoplasty" },
    [medication.path]: { title: "Allergodil" },
    [syndrome.path]: { title: "Usher syndrome" },
    [proposal.path]: { type: "topic-proposal", title: "Bare proposal" },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const protectedPaths = [
    procedure.path,
    medication.path,
    syndrome.path,
    proposal.path,
    ...data.portableIndex.subjects.map((subject) => portablePlaceholderPath(subject.id)),
  ];
  for (const path of protectedPaths) {
    const before = structuredClone(plugin.data);
    await assert.rejects(
      plugin.assignRecordToCatalog(path, "topic", { headingTitle: "Unsafe" }),
      /accepts topic subjects only/i,
    );
    assert.deepEqual(plugin.data, before, `${path} must be rejected before any Index state changes`);
  }

  assert.equal(plugin.savedData.length, 0);
  assert.equal(sourceMutationCount(), 0);
});

test("an ENT native topic can return from a custom Library to the protected Index", async () => {
  const topic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  const frontmatter = {
    title: "Pediatric airway",
    curriculum_id: "ENT-PED-001",
    domain: "Pediatric",
    topic_kind: "clinical-approach",
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [topic], { [topic.path]: frontmatter });
  await plugin.loadPluginData();
  const customLibraryId = await plugin.createLibrary({ name: "Exam review", singularName: "Review topic", icon: "bookmark" });

  const before = plugin.getRecord(topic.path);
  assert.deepEqual(
    { kind: before?.kind, role: before?.role, topicKind: before?.topicKind },
    { kind: "topic", role: "canonical", topicKind: "clinical-approach" },
  );
  assert.equal(plugin.getIndexRecords().some((record) => record.path === topic.path), true);

  await plugin.assignRecordToLibrary(topic.path, customLibraryId, { headingTitle: "Airway" });
  const during = plugin.getRecord(topic.path);
  assert.deepEqual(
    { kind: during?.kind, role: during?.role, topicKind: during?.topicKind, libraryId: during?.libraryId },
    { kind: "topic", role: "canonical", topicKind: "clinical-approach", libraryId: customLibraryId },
  );
  assert.ok(plugin.data.excludedIndexPaths.includes(topic.path));
  assert.equal(plugin.getIndexRecords().some((record) => record.path === topic.path), false, "Library membership alone removes the source-preserved topic from the Index");
  assert.equal(plugin.getRecordIndexDestinationError(topic.path), null);

  await plugin.assignRecordToCatalog(topic.path, "topic", { headingTitle: "Pediatric" });

  const after = plugin.getRecord(topic.path);
  assert.deepEqual(
    { kind: after?.kind, role: after?.role, topicKind: after?.topicKind, libraryId: after?.libraryId },
    { kind: "topic", role: "canonical", topicKind: "clinical-approach", libraryId: undefined },
  );
  assert.equal(plugin.getPortableSubject(plugin.getRecord(topic.path)?.portableId ?? "")?.indexed, true);
  assert.equal(plugin.data.excludedIndexPaths.includes(topic.path), false);
  assert.equal(sourceMutationCount(), 0);
});

test("the post-import ENT invariant rejects a topic identity resolved to a native medication source", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  // Simulate the state inside an import transaction. Startup remediation has
  // already run, so this specifically exercises the post-apply invariant.
  plugin.data.portableIndex.groups = [{ id: "imported-index", title: "Imported Index", order: 0 }];
  plugin.data.portableIndex.subjects = [{
    id: "incoming-topic-collision",
    title: "Imported topic label",
    groupId: "imported-index",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
    libraryId: null,
  }];
  plugin.data.portableIndex.resolvedPathBySubjectId = { "incoming-topic-collision": medication.path };
  plugin.data.manualIndexPaths = [medication.path];
  const before = structuredClone(plugin.data);

  assert.throws(
    () => plugin.assertClinicalIndexEligibility(),
    /source-classified as medication.*ENT Index was not changed/is,
  );

  assert.deepEqual(plugin.data, before);
  assert.equal(sourceMutationCount(), 0);
});

test("clinical libraries allow same-kind visual placement but reject cross-kind reclassification", async () => {
  const file = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const frontmatter = { title: "Allergodil", ent_domains: ["Rhinology"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Topical nasal therapy" });
  const subjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(subjectId);
  assert.equal(plugin.getRecord(file.path)?.domain, "Topical nasal therapy");
  const before = structuredClone(plugin.data.portableIndex);
  await assert.rejects(
    plugin.assignRecordToCatalog(file.path, "syndrome", { headingTitle: "Rhinology" }),
    /clinical source classification is fixed/i,
  );
  assert.deepEqual(plugin.data.portableIndex, before);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("an ENT native topic keeps its source classification when portable data has a conflicting catalog kind", async () => {
  const file = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  const frontmatter = {
    title: "Pediatric airway",
    curriculum_id: "ENT-PED-001",
    domain: "Pediatric",
    review_status: "unverified",
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  data.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  data.portableIndex.subjects = [{
    id: "conflicting-subject",
    title: "Incorrect imported medication",
    groupId: "medications",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "medication",
  }];
  data.portableIndex.resolvedPathBySubjectId = { "conflicting-subject": file.path };
  data.portableIndex.libraryLayouts.medication = [{
    id: "medications-heading",
    title: "Imported medications",
    collapsed: false,
    subjects: ["conflicting-subject"],
    subheadings: [],
  }];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  const projected = plugin.getRecord(file.path);
  assert.equal(projected?.kind, "topic");
  assert.equal(projected?.role, "canonical");
  assert.equal(projected?.domain, "Pediatric");
  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), true);
  assert.equal(sourceMutationCount(), 0);
});

test("initializing a native clinical library adopts its fallback groups in one idempotent Undo-safe transaction", async () => {
  const rhinology = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const otology = new TFile("06 Clinical Tools/Medications/Drug - Ciprofloxacin.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [rhinology, otology], {
    [rhinology.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
    [otology.path]: { title: "Ciprofloxacin", ent_domains: ["Otology"] },
  });
  await plugin.loadPluginData();

  await plugin.initializeLibraryCatalog("medication");

  const records = plugin.getRecords().filter((record) => record.kind === "medication");
  assert.equal(records.length, 2);
  assert.ok(records.every((record) => record.portableId));
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication.map((heading) => heading.title).sort(), ["Otology", "Rhinology"]);
  for (const record of records) {
    assert.equal(plugin.data.portableIndex.libraryLayouts.medication.filter((heading) => heading.subjects.includes(record.portableId ?? "")
      || heading.subheadings.some((subheading) => subheading.subjects.includes(record.portableId ?? ""))).length, 1);
  }
  const saveCount = plugin.savedData.length;
  await plugin.initializeLibraryCatalog("medication");
  assert.equal(plugin.savedData.length, saveCount);
  assert.equal(sourceMutationCount(), 0);

  await plugin.undo();
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication, []);
  assert.equal(plugin.data.portableIndex.subjects.length, 0);
  assert.equal(sourceMutationCount(), 0);
});

test("Library counts use unique projected records before and after native catalog initialization", async () => {
  const procedure = new TFile("04 Procedures/Procedure - Direct laryngoscopy.md");
  const allergodil = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const ciprofloxacin = new TFile("06 Clinical Tools/Medications/Drug - Ciprofloxacin.md");
  const syndrome = new TFile("06 Clinical Tools/Syndromes/Syndrome - CHARGE.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.portableIndex.groups = [
    { id: "group-imported-medications", title: "Imported medications", order: 0 },
    { id: "group-custom", title: "Reading", order: 1 },
  ];
  data.portableIndex.libraries = [
    ...BUILTIN_LIBRARY_DEFINITIONS.map((library) => ({ ...library })),
    {
      id: "library-reading",
      name: "Reading",
      singularName: "Paper",
      icon: "book-open",
      order: 3,
      sourceKind: null,
      archivedAt: null,
    },
  ];
  data.portableIndex.subjects = [
    {
      id: "subject-imported-medication",
      title: "Imported medication",
      groupId: "group-imported-medications",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "medication",
      libraryId: "medication",
    },
    {
      id: "subject-reading-placeholder",
      title: "Future paper",
      groupId: "group-custom",
      parentId: null,
      order: 1,
      indexed: false,
      configuredId: "",
      recordKind: "note",
      libraryId: "library-reading",
    },
  ];
  data.portableIndex.libraryLayouts = {
    procedure: [],
    medication: [],
    syndrome: [],
    "library-reading": [],
  };
  const { plugin, vaultEnumerationCount } = pluginWithFiles(
    data,
    [procedure, allergodil, ciprofloxacin, syndrome],
    {
      [procedure.path]: { title: "Direct laryngoscopy", domain: "Airway" },
      [allergodil.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
      [ciprofloxacin.path]: { title: "Ciprofloxacin", ent_domains: ["Otology"] },
      [syndrome.path]: { title: "CHARGE", syndrome_group: "Congenital" },
    },
  );
  await plugin.loadPluginData();

  assert.equal(plugin.librarySubjectCount("procedure"), 1);
  assert.equal(plugin.librarySubjectCount("medication"), 3, "two native notes plus one imported placeholder");
  assert.equal(plugin.librarySubjectCount("syndrome"), 1);
  assert.equal(plugin.librarySubjectCount("library-reading"), 1);
  assert.equal(vaultEnumerationCount(), 1, "all Library counts reuse one cached record projection");

  await plugin.initializeLibraryCatalog("medication");

  assert.equal(plugin.librarySubjectCount("medication"), 3, "portable adoption must not double-count native notes");
  assert.equal(
    new Set(plugin.getRecords().filter((record) => record.libraryId === "medication").map((record) => record.path)).size,
    3,
  );
  assert.equal(plugin.librarySubjectCount("library-reading"), 1, "custom placeholders remain counted after adoption");
});

test("immutable source books cannot be assigned to a catalog", async () => {
  const file = new TFile("05 Sources/_books/Reference/Chapter.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: { title: "Chapter" } });
  await plugin.loadPluginData();
  const before = structuredClone(plugin.data.portableIndex);

  await assert.rejects(plugin.assignRecordToCatalog(file.path, "medication"), /immutable source-book/i);

  assert.deepEqual(plugin.data.portableIndex, before);
  assert.equal(sourceMutationCount(), 0);
});

test("portable identity merges rewrite and deduplicate library layout subject IDs", async () => {
  const file = new TFile("Reference/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: { title: "Allergodil" } });
  await plugin.loadPluginData();
  plugin.data.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  plugin.data.portableIndex.subjects = [
    { id: "imported", title: "Allergodil", groupId: "medications", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    { id: "local", title: "Allergodil local", groupId: "medications", parentId: null, order: 1, indexed: false, configuredId: "", recordKind: "medication" },
  ];
  plugin.data.portableIndex.resolvedPathBySubjectId = { local: file.path };
  plugin.data.portableIndex.libraryLayouts.medication = [{
    id: "medications-heading",
    title: "Medications",
    collapsed: false,
    subjects: ["imported", "local"],
    subheadings: [],
  }];
  plugin.invalidateRecordCache();

  await plugin.resolvePortableSubject("imported", file.path, true);

  assert.equal(plugin.getPortableSubject("local"), null);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.imported, file.path);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[0]?.subjects, ["imported"]);
  assert.equal(plugin.getRecord(file.path)?.portableId, "imported");
  assert.equal(sourceMutationCount(), 0);
});

test("portable identity merges preserve the survivor's existing library placement", async () => {
  const file = new TFile("Reference/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: { title: "Allergodil" } });
  await plugin.loadPluginData();
  plugin.data.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  plugin.data.portableIndex.subjects = [
    { id: "survivor", title: "Allergodil", groupId: "medications", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    { id: "owner", title: "Allergodil local", groupId: "medications", parentId: null, order: 1, indexed: false, configuredId: "", recordKind: "medication" },
  ];
  plugin.data.portableIndex.resolvedPathBySubjectId = { owner: file.path };
  plugin.data.portableIndex.libraryLayouts.medication = [
    { id: "owner-heading", title: "Old placement", collapsed: false, subjects: ["owner"], subheadings: [] },
    { id: "survivor-heading", title: "Preferred placement", collapsed: false, subjects: ["survivor"], subheadings: [] },
  ];
  plugin.invalidateRecordCache();

  await plugin.resolvePortableSubject("survivor", file.path, true);

  assert.equal(plugin.getPortableSubject("owner"), null);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[0]?.subjects, []);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[1]?.subjects, ["survivor"]);
  assert.equal(plugin.getRecord(file.path)?.portableId, "survivor");
  assert.equal(sourceMutationCount(), 0);
});

test("a linked generic syndrome keeps its library role and portable group through synchronization and re-export", async () => {
  const linkedFile = new TFile("Reference/Usher syndrome.md");
  linkedFile.stat.mtime = 97531;
  const frontmatter = { title: "Usher syndrome", tags: ["reference"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const subjectId = "subject-usher-portable";
  const groupId = "group-inherited-syndromes";
  data.portableIndex = {
    version: 1,
    groups: [{ id: groupId, title: "Inherited syndromes", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Usher syndrome",
      groupId,
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "syndrome",
    }],
    resolvedPathBySubjectId: {},
  };
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [linkedFile], { [linkedFile.path]: frontmatter });
  await plugin.loadPluginData();
  await plugin.resolvePortableSubject(subjectId, linkedFile.path);

  plugin.invalidateRecordCache();
  const rebuilt = plugin.getRecord(linkedFile.path);
  assert.equal(rebuilt?.kind, "syndrome");
  assert.equal(rebuilt?.role, "library");
  assert.equal(rebuilt?.domain, "Inherited syndromes");

  synchronizePortableRegistry(plugin.data, plugin.getRecords());
  plugin.invalidateRecordCache();
  const synchronized = plugin.getRecord(linkedFile.path);
  const synchronizedSubject = plugin.getPortableSubject(subjectId);
  assert.equal(synchronized?.kind, "syndrome");
  assert.equal(synchronized?.role, "library");
  assert.equal(synchronized?.domain, "Inherited syndromes");
  assert.equal(synchronizedSubject?.groupId, groupId);
  assert.equal(synchronizedSubject?.recordKind, "syndrome");
  assert.equal(synchronizedSubject?.indexed, false);

  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    {
      workspace: false,
      index: false,
      procedures: false,
      medications: false,
      syndromes: true,
      collections: false,
      study: false,
      savedViews: false,
      recovery: false,
    },
    "2026-08-08T00:00:00.000Z",
  )));
  const exportedSubject = exported.components.index?.subjects.find((subject) => subject.id === subjectId);
  assert.equal(exportedSubject?.recordKind, "syndrome");
  assert.equal(exportedSubject?.libraryId, "syndrome");
  assert.equal(exportedSubject?.groupId, groupId);
  assert.equal(exported.components.index?.groups.find((group) => group.id === groupId)?.title, "Inherited syndromes");
  assert.deepEqual(exported.components.index?.includedSections, {
    index: false,
    libraryIds: ["syndrome"],
  });
  assert.equal(linkedFile.stat.mtime, 97531);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("portable linking rejects configured-ID and record-kind mismatches before mutating identity state", async () => {
  const wrongTopic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-999 - Wrong topic.md");
  const wrongDomainSupporting = new TFile("03 Clinical Topics/02 Otology/Supporting note.md");
  const procedure = new TFile("04 Procedures/Procedure - Airway Endoscopy.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => [wrongTopic, wrongDomainSupporting, procedure].find((file) => file.path === path) ?? null,
      getMarkdownFiles: () => [wrongTopic, wrongDomainSupporting, procedure],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => file.path === wrongTopic.path
        ? { frontmatter: { title: "Wrong topic", curriculum_id: "ENT-PED-999", domain: "Pediatric" } }
        : file.path === wrongDomainSupporting.path
          ? { frontmatter: { title: "Supporting note", domain: "Otology" } }
          : { frontmatter: { title: "Airway Endoscopy", type: "procedure", domain: "Airway" } },
      resolvedLinks: {},
    },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "ent-clinical";
  plugin.data.settings.primaryFolder = "03 Clinical Topics";
  plugin.data.settings.idProperty = "curriculum_id";
  const subjectId = "subject-cleft";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{ id: subjectId, title: "Laryngeal Cleft", groupId: "group-pediatric", parentId: null, order: 0, indexed: true, configuredId: "ENT-PED-003.05", recordKind: "topic" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath(subjectId)];
  const before = structuredClone(plugin.data.portableIndex);

  await assert.rejects(plugin.resolvePortableSubject(subjectId, wrongTopic.path), /configured ID mismatch/i);
  await assert.rejects(plugin.resolvePortableSubject(subjectId, wrongDomainSupporting.path), /clinical group mismatch.*Pediatric.*Otology/i);
  await assert.rejects(plugin.resolvePortableSubject(subjectId, procedure.path), /procedure note cannot be linked/i);

  assert.deepEqual(plugin.data.portableIndex, before);
  assert.equal(plugin.data.undoStack.length, 0);
});

test("identity merge deterministically preserves the surviving parent and appends owner children", async () => {
  const ownerFile = new TFile("Knowledge Base/Airway/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Airway" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const path = (id: string): string => portablePlaceholderPath(id);
  plugin.data.portableIndex = {
    version: 3,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [
      { id: "target-parent", title: "Target parent", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-parent", title: "Owner parent", groupId: "group-airway", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "target", title: "Target", groupId: "group-airway", parentId: "target-parent", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-airway", parentId: "owner-parent", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "target-child", title: "Zulu target child", groupId: "group-airway", parentId: "target", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-child", title: "Alpha owner child", groupId: "group-airway", parentId: "owner", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
    relinkableSubjectIds: [],
    libraries: [],
    libraryLayouts: { procedure: [], medication: [], syndrome: [] },
  };
  plugin.data.manualIndexPaths = [path("target-parent"), path("owner-parent"), path("target"), ownerFile.path, path("target-child"), path("owner-child")];
  plugin.data.indexGroupByPath = Object.fromEntries(plugin.data.manualIndexPaths.map((subjectPath) => [subjectPath, "Airway"]));
  // Adversarial insertion order: the old implementation allowed the later
  // owner entry/container to overwrite the target survivor's placement.
  plugin.data.curriculumVisual.parentByPath = {
    [path("target")]: path("target-parent"),
    [ownerFile.path]: path("owner-parent"),
    [path("target-child")]: path("target"),
    [path("owner-child")]: ownerFile.path,
  };
  plugin.data.curriculumVisual.orderByContainer = {
    [`parent:${path("target-parent")}`]: [path("target")],
    [`parent:${path("owner-parent")}`]: [ownerFile.path],
    [`parent:${path("target")}`]: [path("target-child")],
    [`parent:${ownerFile.path}`]: [path("owner-child")],
  };
  const before = structuredClone(plugin.data);

  await plugin.resolvePortableSubject("target", ownerFile.path, true);

  assert.equal(plugin.data.curriculumVisual.parentByPath[ownerFile.path], path("target-parent"));
  assert.deepEqual(plugin.data.curriculumVisual.orderByContainer[`parent:${ownerFile.path}`], [path("target-child"), path("owner-child")]);
  assert.equal(plugin.getPortableSubject("owner"), null);
  assert.equal(plugin.getPortableSubject("owner-child")?.parentId, "target");

  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  const exportedSubjects = exported.components.index?.subjects ?? [];
  assert.equal(exportedSubjects.find((subject) => subject.id === "target")?.parentId, "target-parent");
  assert.deepEqual(exportedSubjects.filter((subject) => subject.parentId === "target").sort((a, b) => a.order - b.order).map((subject) => subject.id), ["target-child", "owner-child"]);

  await plugin.undo();
  assert.deepEqual(plugin.data.portableIndex, before.portableIndex);
  assert.deepEqual(plugin.data.curriculumVisual, before.curriculumVisual);
});

test("identity merge rejects owner children that would become cross-group descendants", async () => {
  const ownerFile = new TFile("Knowledge Base/Group B/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Group B" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-a", title: "Group A", order: 0 }, { id: "group-b", title: "Group B", order: 1 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-a", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-b", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-child", title: "Owner child", groupId: "group-b", parentId: "owner", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("target"), ownerFile.path, portablePlaceholderPath("owner-child")];
  const before = structuredClone(plugin.data.portableIndex);

  await assert.rejects(plugin.resolvePortableSubject("target", ownerFile.path, true), /across groups.*child subjects/i);

  assert.deepEqual(plugin.data.portableIndex, before);
});

test("cross-group identity merge without descendants keeps the surviving target group through export", async () => {
  const ownerFile = new TFile("Knowledge Base/Group B/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Group B" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const targetPath = portablePlaceholderPath("target");
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-a", title: "Group A", order: 0 }, { id: "group-b", title: "Group B", order: 1 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-a", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-b", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [targetPath, ownerFile.path];
  // Put the owner entry last to exercise a colliding path-map rewrite.
  plugin.data.indexGroupByPath = { [targetPath]: "Group A", [ownerFile.path]: "Group B" };

  await plugin.resolvePortableSubject("target", ownerFile.path, true);

  assert.equal(plugin.data.indexGroupByPath[ownerFile.path], "Group A");
  assert.equal(plugin.getRecord(ownerFile.path)?.domain, "Group A");
  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  const target = exported.components.index?.subjects.find((subject) => subject.id === "target");
  const targetGroup = exported.components.index?.groups.find((group) => group.id === target?.groupId);
  assert.equal(targetGroup?.title, "Group A");
  assert.equal(exported.components.index?.subjects.some((subject) => subject.id === "owner"), false);
});

test("linking refuses to mutate when a full portable Undo snapshot exceeds the safety budget", async () => {
  const ownerFile = new TFile("Knowledge Base/Large/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Large" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const longTitle = "x".repeat(500);
  const filler = Array.from({ length: 25_000 }, (_, index) => ({
    id: `filler-${index}`,
    title: `${longTitle}${index}`,
    groupId: "group-large",
    parentId: null,
    order: index + 2,
    indexed: false,
    configuredId: "",
    recordKind: "topic" as const,
  }));
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-large", title: "Large", order: 0 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-large", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-large", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
      ...filler,
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("target"), ownerFile.path];

  await assert.rejects(plugin.resolvePortableSubject("target", ownerFile.path, true), /too large for safe.*Undo/i);

  assert.equal(plugin.getPortableSubject("owner")?.id, "owner");
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.target, undefined);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.owner, ownerFile.path);
  assert.equal(plugin.data.undoStack.length, 0);
});

test("unlink rolls back in memory and on disk when its first save fails", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Linked.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Airway" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{ id: "subject", title: "Linked", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { subject: linkedFile.path },
    relinkableSubjectIds: ["subject"],
  };
  plugin.data.manualIndexPaths = [linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [linkedFile.path], subheadings: [] }];
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated unlink save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.unlinkPortableSubject("subject"), /simulated unlink save failure/);

  assert.equal(saveAttempts, 2);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.subject, linkedFile.path);
  assert.deepEqual(plugin.data.manualIndexPaths, [linkedFile.path]);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{
      id?: string;
      data?: { portableIndex?: { resolvedPathBySubjectId?: Record<string, string> } };
    }>;
  } | undefined;
  const persistedActive = persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId);
  assert.equal(persistedActive?.data?.portableIndex?.resolvedPathBySubjectId?.subject, linkedFile.path);
});

test("note creation applies explicit YAML-safe Library tokens without rewriting the template", async () => {
  const templatesFolder = new TFolder("Templates");
  const researchFolder = new TFolder("Research");
  const template = new TFile("Templates/Paper.md");
  const tree = trackedVaultTree([templatesFolder, researchFolder, template]);
  const templateContent = [
    "---",
    "id: {{yaml:id}}",
    "category: {{yaml:category}}",
    "parent: {{yaml:parent}}",
    "library: {{yaml:library}}",
    "type: {{yaml:type}}",
    "---",
    "# {{title}}",
  ].join("\n");
  let createdContent = "";
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      cachedRead: async (file: TFile) => file === template ? templateContent : "",
      create: async (path: string, content: string) => {
        createdContent = content;
        const file = new TFile(path);
        tree.entries.set(path, file);
        return file;
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { trashFile: (file: TAbstractFile) => tree.trashFile(file) },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.templatesFolder = "Templates";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  await plugin.loadPluginData();

  const file = await plugin.createKnowledgeNote({
    title: "Quoted: paper",
    folder: "Research",
    mode: "template",
    templatePath: template.path,
    addToCollection: false,
  }, {
    id: "REF: [1]",
    category: "Evidence #1",
    parent: "Airway \"review\"",
    library: "Research",
    type: "Paper",
  });

  assert.equal(file.path, "Research/Quoted- paper.md");
  assert.match(createdContent, /id: "REF: \[1\]"/);
  assert.match(createdContent, /category: "Evidence #1"/);
  assert.match(createdContent, /parent: "Airway \\"review\\""/);
  assert.match(createdContent, /library: "Research"/);
  assert.match(createdContent, /type: "Paper"/);
  assert.match(createdContent, /# Quoted: paper/);
  assert.equal(await app.vault.cachedRead(template), templateContent);
});

test("failed note creation removes only folders created by that operation", async () => {
  const existing = new TFolder("Existing");
  const tree = trackedVaultTree([existing]);
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      create: async (): Promise<never> => { throw new Error("simulated note write failure"); },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { trashFile: (file: TAbstractFile) => tree.trashFile(file) },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-create-cleanup-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.createKnowledgeNote({
    title: "Failure",
    folder: "Existing/New/Deep",
    mode: "empty",
    templatePath: "",
    addToCollection: false,
  }), /simulated note write failure/);

  assert.deepEqual(tree.createdFolders, ["Existing/New", "Existing/New/Deep"]);
  assert.deepEqual(tree.trashedFolders, ["Existing/New/Deep", "Existing/New"]);
  assert.equal(tree.entries.get("Existing"), existing, "the pre-existing parent is preserved");
  assert.equal(tree.entries.has("Existing/New"), false);
  assert.equal(tree.entries.has("Existing/New/Deep"), false);
});

test("explicit attachment upload uses the configured folder and appends under one heading", async () => {
  const note = new TFile("Knowledge/Topic.md");
  const files = new Map<string, TAbstractFile>([[note.path, note]]);
  let markdown = "---\ntitle: Topic\n---\n\n## Attachments\n\n![[old.png]]\n\n## Notes\n- Keep\n";
  const createdFolders: string[] = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles: () => [note],
      cachedRead: async () => markdown,
      process: async (file: TFile, update: (value: string) => string) => {
        assert.equal(file, note);
        markdown = update(markdown);
      },
      createFolder: async (path: string) => {
        createdFolders.push(path);
        files.set(path, new TFolder(path));
      },
      createBinary: async (path: string, bytes: ArrayBuffer) => {
        assert.equal(bytes.byteLength, 3);
        const file = new TFile(path);
        files.set(path, file);
        return file;
      },
    },
    workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null, getActiveFile: () => note },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {
      generateMarkdownLink: (file: TFile) => `![[${file.path}]]`,
      getAvailablePathForAttachment: async () => "unused",
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Assets/Uploads";
  data.settings.attachmentInsertionMode = "heading";
  data.settings.attachmentHeading = "Attachments";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-attachment-test");
  await plugin.loadPluginData();

  const created = await plugin.attachFileToNote(note, {
    file: new File([new Uint8Array([1, 2, 3])], "scan.png"),
    requestedFolder: "",
    insertionMode: "heading",
  });

  assert.equal(created.path, "Assets/Uploads/scan.png");
  assert.deepEqual(createdFolders, ["Assets", "Assets/Uploads"]);
  assert.equal(markdown, "---\ntitle: Topic\n---\n\n## Attachments\n\n![[old.png]]\n![[Assets/Uploads/scan.png]]\n\n## Notes\n- Keep\n");
});

test("attachment upload refuses every ambiguous ai_lock form before copying and a replaced note identity", async () => {
  const note = new TFile("Knowledge/Locked.md");
  let current: TAbstractFile = note;
  let markdown = "---\n\"ai_l\\u006fck\": true\n---\n";
  let binaryCreates = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: () => current,
      getMarkdownFiles: () => [note],
      cachedRead: async () => markdown,
      process: async (_file: TFile, update: (value: string) => string) => { markdown = update(markdown); },
      createFolder: async () => {},
      createBinary: async (path: string) => { binaryCreates += 1; return new TFile(path); },
    },
    workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null, getActiveFile: () => note },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { generateMarkdownLink: () => "[[x]]", getAvailablePathForAttachment: async () => "Attachments/x" },
  };
  const data = migrateData(null);
  data.settings.attachmentStorageMode = "obsidian";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-attachment-lock-test");
  await plugin.loadPluginData();
  const value = { file: new File(["x"], "x.txt"), requestedFolder: "", insertionMode: "end" as const };

  for (const unsafe of [
    "---\n\"ai_l\\u006fck\": true\n---\n",
    "--- \nai_lock: true\n...\t\n",
    "---\nai_lock: true\nai_lock: false\n---\n",
    "---\t\nai_lock: true\nai_lock: false\n--- \n",
    "---\nai_lock: false\nai_lock: true\n---\n",
    "---\n\"ai_l\\u006fck\": false\nai_lock: false\n---\n",
    "---\nai_lock: false\n",
  ]) {
    markdown = unsafe;
    await assert.rejects(plugin.attachFileToNote(note, value), /ai_lock: true|malformed YAML frontmatter/i);
    assert.equal(binaryCreates, 0);
  }
  markdown = "# Safe\n";
  current = new TFile(note.path);
  await assert.rejects(plugin.attachFileToNote(note, value), /changed or was replaced/i);
  assert.equal(binaryCreates, 0);
});

test("attachment upload rejects malformed frontmatter and canonical immutable destinations", async () => {
  const note = new TFile("Knowledge/Topic.md");
  const files = new Map<string, TAbstractFile>([[note.path, note]]);
  let markdown = "---\nai_lock: true\n# missing closing delimiter\n";
  let binaryCreates = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles: () => [note],
      cachedRead: async () => markdown,
      process: async (_file: TFile, update: (value: string) => string) => { markdown = update(markdown); },
      createFolder: async (path: string) => {
        const folder = new TFolder(path);
        files.set(path, folder);
        return folder;
      },
      createBinary: async (path: string) => { binaryCreates += 1; return new TFile(path); },
    },
    workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null, getActiveFile: () => note },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { generateMarkdownLink: () => "[[x]]", getAvailablePathForAttachment: async () => "Attachments/x" },
  };
  const data = migrateData(null);
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Assets";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-attachment-malformed-test");
  await plugin.loadPluginData();
  const value = { file: new File(["x"], "x.txt"), requestedFolder: "", insertionMode: "end" as const };

  await assert.rejects(plugin.attachFileToNote(note, value), /malformed YAML frontmatter/i);
  assert.equal(binaryCreates, 0);

  markdown = "# Safe\n";
  plugin.data.settings.attachmentFolder = "05 Sources//_books";
  await assert.rejects(plugin.attachFileToNote(note, value), /immutable source-book folders/i);
  assert.equal(binaryCreates, 0);
});

test("attachment partial failures retain and report the copied path without touching a replacement note", async () => {
  const note = new TFile("Knowledge/Topic.md");
  let current: TAbstractFile = note;
  let markdown = "# Safe\n";
  let processCalls = 0;
  let replaceDuringCreate = false;
  let replaceDuringProcess = false;
  let failLinkGeneration = true;
  let plugin: EntVaultCommandCenterPlugin & TestPluginBase;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: () => current,
      getMarkdownFiles: () => [note],
      cachedRead: async () => markdown,
      process: async (_file: TFile, update: (value: string) => string) => {
        processCalls += 1;
        if (replaceDuringProcess) {
          current = new TFile(note.path);
          (plugin as unknown as { dataEpoch: number }).dataEpoch += 1;
        }
        markdown = update(markdown);
      },
      createFolder: async () => {},
      createBinary: async (path: string) => {
        if (replaceDuringCreate) current = new TFile(note.path);
        return new TFile(path);
      },
    },
    workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null, getActiveFile: () => note },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {
      generateMarkdownLink: (file: TFile) => {
        if (failLinkGeneration) throw new Error("simulated link generator failure");
        return `[[${file.path}]]`;
      },
      getAvailablePathForAttachment: async () => "Attachments/report.pdf",
    },
  };
  const data = migrateData(null);
  data.settings.attachmentStorageMode = "obsidian";
  plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-attachment-partial-test");
  await plugin.loadPluginData();
  const value = { file: new File(["x"], "report.pdf"), requestedFolder: "", insertionMode: "end" as const };

  await assert.rejects(plugin.attachFileToNote(note, value), /copied to Attachments\/report\.pdf[\s\S]*manually/i);
  assert.equal(processCalls, 0);

  failLinkGeneration = false;
  replaceDuringCreate = true;
  await assert.rejects(plugin.attachFileToNote(note, value), /copied to Attachments\/report\.pdf[\s\S]*manually/i);
  assert.equal(processCalls, 0, "a replacement note at the same path is never modified");

  current = note;
  replaceDuringCreate = false;
  replaceDuringProcess = true;
  await assert.rejects(plugin.attachFileToNote(note, value), /copied to Attachments\/report\.pdf[\s\S]*manually/i);
  assert.equal(processCalls, 1, "the atomic process callback ran but refused the replacement before returning content");
  assert.equal(markdown, "# Safe\n");
});

test("attachment upload freezes consented policy and aborts on a mid-operation data epoch change", async () => {
  const note = new TFile("Knowledge/Topic.md");
  const files = new Map<string, TAbstractFile>([[note.path, note]]);
  let markdown = "# Safe\n";
  let plugin: EntVaultCommandCenterPlugin & TestPluginBase;
  let binaryCreates = 0;
  const trashedFolders: string[] = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles: () => [note],
      cachedRead: async () => markdown,
      process: async (_file: TFile, update: (value: string) => string) => { markdown = update(markdown); },
      createFolder: async (path: string) => {
        const folder = new TFolder(path);
        files.set(path, folder);
        return folder;
      },
      createBinary: async (path: string) => {
        binaryCreates += 1;
        plugin.data.settings.attachmentMarker = "<!-- changed-after-consent -->";
        const file = new TFile(path);
        files.set(path, file);
        return file;
      },
    },
    workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null, getActiveFile: () => note },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {
      generateMarkdownLink: (file: TFile) => `[[${file.path}]]`,
      getAvailablePathForAttachment: async () => "Attachments/x.txt",
      trashFile: async (file: TFolder) => {
        trashedFolders.push(file.path);
        files.delete(file.path);
      },
    },
  };
  const data = migrateData(null);
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Assets/Frozen";
  data.settings.attachmentInsertionMode = "marker";
  data.settings.attachmentMarker = "<!-- frozen-consent -->";
  plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-attachment-policy-test");
  await plugin.loadPluginData();

  await plugin.attachFileToNote(note, {
    file: new File(["x"], "x.txt"),
    requestedFolder: "",
    insertionMode: "marker",
  });
  assert.match(markdown, /<!-- frozen-consent -->\n\[\[Assets\/Frozen\/x\.txt\]\]/u);
  assert.doesNotMatch(markdown, /changed-after-consent/u);

  const internal = plugin as unknown as { dataEpoch: number };
  const epochChangingFile = {
    name: "later.txt",
    size: 1,
    arrayBuffer: async () => {
      internal.dataEpoch += 1;
      return new Uint8Array([1]).buffer;
    },
  } as File;
  plugin.data.settings.attachmentFolder = "Stale/New";
  await assert.rejects(plugin.attachFileToNote(note, {
    file: epochChangingFile,
    requestedFolder: "",
    insertionMode: "end",
  }), /synced data changed/i);
  assert.equal(binaryCreates, 1, "the epoch change is detected before a second binary is created");
  assert.deepEqual(trashedFolders, ["Stale/New", "Stale"], "empty folders created before the stale epoch are rolled back");
  assert.equal(files.has("Stale"), false);

  plugin.data.settings.attachmentFolder = "Race";
  const replacement = new TFolder("Race");
  const replacingFile = {
    name: "race.txt",
    size: 1,
    arrayBuffer: async () => {
      files.set("Race", replacement);
      internal.dataEpoch += 1;
      return new Uint8Array([1]).buffer;
    },
  } as File;
  await assert.rejects(plugin.attachFileToNote(note, {
    file: replacingFile,
    requestedFolder: "",
    insertionMode: "end",
  }), /synced data changed/i);
  assert.equal(files.get("Race"), replacement, "rollback never trashes a different folder recreated at the same path");
  assert.deepEqual(trashedFolders, ["Stale/New", "Stale"]);
});

test("attachment storage modes remain collision-safe and cursor insertion uses the exact active editor", async () => {
  const note = new TFile("Knowledge/Topic.md");
  const files = new Map<string, TAbstractFile>([[note.path, note]]);
  let markdown = "---\n---\n# Safe\n";
  let cursorInsert = "";
  const editor = {
    getValue: () => markdown,
    getCursor: () => ({ line: 2, ch: 6 }),
    replaceRange: (value: string) => { cursorInsert = value; },
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles: () => [note],
      cachedRead: async () => markdown,
      process: async (_file: TFile, update: (value: string) => string) => { markdown = update(markdown); },
      createFolder: async (path: string) => { files.set(path, new TFolder(path)); },
      createBinary: async (path: string) => {
        const file = new TFile(path);
        files.set(path, file);
        return file;
      },
    },
    workspace: {
      getLeavesOfType: () => [],
      getActiveViewOfType: () => ({ file: note, editor }),
      getActiveFile: () => note,
    },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {
      generateMarkdownLink: (file: TFile) => `[[${file.path}]]`,
      getAvailablePathForAttachment: async () => "Core/core.pdf",
    },
  };
  const data = migrateData(null);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-attachment-modes-test");
  await plugin.loadPluginData();

  plugin.data.settings.attachmentStorageMode = "note-subfolder";
  const first = await plugin.attachFileToNote(note, {
    file: new File(["a"], "scan.png"), requestedFolder: "", insertionMode: "end",
  });
  const second = await plugin.attachFileToNote(note, {
    file: new File(["b"], "scan.png"), requestedFolder: "", insertionMode: "end",
  });
  assert.equal(first.path, "Knowledge/Topic attachments/scan.png");
  assert.equal(second.path, "Knowledge/Topic attachments/scan 1.png");

  plugin.data.settings.attachmentStorageMode = "ask";
  const asked = await plugin.attachFileToNote(note, {
    file: new File(["c"], "asked.txt"), requestedFolder: "/Chosen//Folder/", insertionMode: "end",
  });
  assert.equal(asked.path, "Chosen/Folder/asked.txt");

  plugin.data.settings.attachmentStorageMode = "obsidian";
  const core = await plugin.attachFileToNote(note, {
    file: new File(["d"], "core.pdf"), requestedFolder: "", insertionMode: "cursor",
  });
  assert.equal(core.path, "Core/core.pdf");
  assert.equal(cursorInsert, "[[Core/core.pdf]]");
});

test("portable JSON serialization fails before creating an export folder", async () => {
  const tree = trackedVaultTree([]);
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => [],
      createFolder: (path: string) => tree.createFolder(path),
      create: async (): Promise<never> => { throw new Error("create must not run"); },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { trashFile: (file: TAbstractFile) => tree.trashFile(file) },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(migrateData(null), 1, "vault-export-serialization-test");
  await plugin.loadPluginData();
  const circular: { self?: unknown } = {};
  circular.self = circular;

  await assert.rejects(plugin.writePortableJson("workspace", circular), /circular/i);

  assert.deepEqual(tree.createdFolders, []);
  assert.deepEqual(tree.trashedFolders, []);
  assert.equal(tree.entries.has("Knowledge Base Command Center Exports"), false);
});

test("proposal promotion restores the original note and removes its empty destination folder when rewriting fails", async () => {
  const proposalsRoot = new TFolder("01 Inbox");
  const proposalFolder = new TFolder("01 Inbox/Topic Proposals");
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const sourcePath = "01 Inbox/Topic Proposals/Laryngeal cleft.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([proposalsRoot, proposalFolder, clinicalRoot, source]);
  const originalContent = "---\ntype: topic-proposal\ntitle: Laryngeal cleft\nreview_status: unverified\n---\n# Laryngeal cleft\n\nOriginal proposal body.\n";
  let content = originalContent;
  const originalFrontmatter: Record<string, unknown> = {
    type: "topic-proposal",
    title: "Laryngeal cleft",
    review_status: "unverified",
  };
  const frontmatter = structuredClone(originalFrontmatter);
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async () => content,
      process: async (_file: TFile, update: (current: string) => string): Promise<void> => {
        processCalls += 1;
        if (processCalls === 1) throw new Error("simulated heading rewrite failure");
        content = update(content);
        for (const key of Object.keys(frontmatter)) delete frontmatter[key];
        Object.assign(frontmatter, originalFrontmatter);
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), resolvedLinks: {} },
    fileManager: {
      renameFile: (file: TFile, destination: string) => tree.renameFile(file, destination),
      processFrontMatter: async (_file: TFile, update: (metadata: Record<string, unknown>) => void) => { update(frontmatter); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-promotion-rollback-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.promoteProposal(sourcePath, {
    title: "Laryngeal cleft",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: true,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  }), /simulated heading rewrite failure/);

  assert.equal(source.path, sourcePath);
  assert.equal(tree.entries.get(sourcePath), source);
  assert.equal(content, originalContent);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.deepEqual(tree.trashedFolders, ["03 Clinical Topics/03 Laryngology"]);
  assert.equal(tree.entries.has("03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Laryngeal cleft.md"), false);
});

test("proposal promotion rollback never overwrites a destination created concurrently by Sync", async () => {
  const proposalFolder = new TFolder("01 Inbox/Topic Proposals");
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const laryngologyFolder = new TFolder("03 Clinical Topics/03 Laryngology");
  const sourcePath = "01 Inbox/Topic Proposals/Laryngeal cleft.md";
  const destination = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Laryngeal cleft.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([proposalFolder, clinicalRoot, laryngologyFolder, source]);
  const originalContent = "---\ntype: topic-proposal\ntitle: Laryngeal cleft\nreview_status: unverified\n---\n# Laryngeal cleft\n\nOriginal proposal body.\n";
  const concurrentContent = "# Unrelated note created by Sync\n\nDo not overwrite.\n";
  let sourceContent = originalContent;
  let destinationContent = concurrentContent;
  let concurrentFile: TFile | null = null;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async (file: TFile) => file === source ? sourceContent : destinationContent,
      process: async (file: TFile, update: (current: string) => string): Promise<void> => {
        if (file === source) sourceContent = update(sourceContent);
        else if (file === concurrentFile) destinationContent = update(destinationContent);
        else throw new Error("Unexpected file passed to rollback processing.");
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: file === source
        ? { type: "topic-proposal", title: "Laryngeal cleft", review_status: "unverified" }
        : { title: "Unrelated note created by Sync" } }),
      resolvedLinks: {},
    },
    fileManager: {
      renameFile: async (): Promise<void> => {
        concurrentFile = new TFile(destination);
        tree.entries.set(destination, concurrentFile);
        laryngologyFolder.children.push(concurrentFile);
        throw new Error("simulated concurrent destination conflict");
      },
      processFrontMatter: async (): Promise<never> => { throw new Error("frontmatter processing must not run after rename rejection"); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-promotion-sync-race-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.promoteProposal(sourcePath, {
    title: "Laryngeal cleft",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: true,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  }), /simulated concurrent destination conflict/);

  assert.equal(source.path, sourcePath);
  assert.equal(tree.entries.get(sourcePath), source);
  assert.equal(sourceContent, originalContent);
  assert.equal(tree.entries.get(destination), concurrentFile);
  assert.equal(destinationContent, concurrentContent, "rollback must not process the concurrently created destination");
  assert.deepEqual(tree.trashedFolders, [], "pre-existing folders remain untouched");
});

test("proposal promotion reports a combined recovery error if content rollback fails", async () => {
  const proposalFolder = new TFolder("01 Inbox/Topic Proposals");
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const sourcePath = "01 Inbox/Topic Proposals/Laryngeal cleft.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([proposalFolder, clinicalRoot, source]);
  const frontmatter: Record<string, unknown> = { type: "topic-proposal", title: "Laryngeal cleft", review_status: "unverified" };
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async () => "# Original proposal\n",
      process: async (): Promise<void> => {
        processCalls += 1;
        throw new Error(processCalls === 1 ? "simulated promotion failure" : "simulated rollback write failure");
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), resolvedLinks: {} },
    fileManager: {
      renameFile: (file: TFile, destination: string) => tree.renameFile(file, destination),
      processFrontMatter: async (_file: TFile, update: (metadata: Record<string, unknown>) => void) => { update(frontmatter); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-promotion-rollback-failure-test");
  await plugin.loadPluginData();

  const loggedRollbackErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]): void => { loggedRollbackErrors.push(values); };
  try {
    await assert.rejects(plugin.promoteProposal(sourcePath, {
      title: "Laryngeal cleft",
      domain: "Laryngology",
      parentPath: "",
      topicKind: "condition",
      priority: "P1",
      safetyCritical: true,
      curriculumId: "ENT-LAR-010",
      addToCollection: false,
    }), (error: unknown) => {
      assert.match(String(error), /simulated promotion failure/);
      assert.match(String(error), /Automatic promotion rollback also failed/);
      assert.match(String(error), /simulated rollback write failure/);
      assert.match(String(error), /Inspect .*Laryngeal cleft\.md/);
      return true;
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(loggedRollbackErrors.length, 1, "the failed automatic rollback is logged once for diagnosis");
  assert.equal(source.path, sourcePath, "path restoration is still attempted after content restoration fails");
  assert.equal(tree.entries.get(sourcePath), source);
  assert.deepEqual(tree.trashedFolders, ["03 Clinical Topics/03 Laryngology"]);
});

test("failed canonical placement restores the original path and content", async () => {
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const laryngologyFolder = new TFolder("03 Clinical Topics/03 Laryngology");
  const sourcePath = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Original title.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([clinicalRoot, laryngologyFolder, source]);
  const originalContent = "---\ntype: clinical-topic\ntitle: Original title\ncurriculum_id: ENT-LAR-010\ndomain: Laryngology\nreview_status: unverified\n---\n# Original title\n\nClinical body.\n";
  let content = originalContent;
  const originalFrontmatter: Record<string, unknown> = {
    type: "clinical-topic",
    title: "Original title",
    curriculum_id: "ENT-LAR-010",
    domain: "Laryngology",
    topic_kind: "condition",
    priority: "P2",
    review_status: "unverified",
  };
  const frontmatter = structuredClone(originalFrontmatter);
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async () => content,
      process: async (_file: TFile, update: (current: string) => string): Promise<void> => {
        processCalls += 1;
        if (processCalls === 1) throw new Error("simulated placement rewrite failure");
        content = update(content);
        for (const key of Object.keys(frontmatter)) delete frontmatter[key];
        Object.assign(frontmatter, originalFrontmatter);
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), resolvedLinks: {} },
    fileManager: {
      renameFile: (file: TFile, destination: string) => tree.renameFile(file, destination),
      processFrontMatter: async (_file: TFile, update: (metadata: Record<string, unknown>) => void) => { update(frontmatter); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-placement-rollback-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.editCanonicalPlacement(sourcePath, {
    title: "Updated title",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: false,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  }), /simulated placement rewrite failure/);

  assert.equal(source.path, sourcePath);
  assert.equal(tree.entries.get(sourcePath), source);
  assert.equal(content, originalContent);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(tree.entries.has("03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Updated title.md"), false);
  assert.deepEqual(tree.trashedFolders, [], "the pre-existing canonical folder is never removed");
});

test("canonical placement rollback never overwrites a destination created concurrently by Sync", async () => {
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const laryngologyFolder = new TFolder("03 Clinical Topics/03 Laryngology");
  const sourcePath = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Original title.md";
  const destination = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Updated title.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([clinicalRoot, laryngologyFolder, source]);
  const originalContent = "---\ntype: clinical-topic\ntitle: Original title\ncurriculum_id: ENT-LAR-010\ndomain: Laryngology\nreview_status: unverified\n---\n# Original title\n\nClinical body.\n";
  const concurrentContent = "# Synced destination\n\nUnrelated content.\n";
  let sourceContent = originalContent;
  let destinationContent = concurrentContent;
  let concurrentFile: TFile | null = null;
  const originalFrontmatter: Record<string, unknown> = {
    type: "clinical-topic",
    title: "Original title",
    curriculum_id: "ENT-LAR-010",
    domain: "Laryngology",
    topic_kind: "condition",
    priority: "P2",
    review_status: "unverified",
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async (file: TFile) => file === source ? sourceContent : destinationContent,
      process: async (file: TFile, update: (current: string) => string): Promise<void> => {
        if (file === source) sourceContent = update(sourceContent);
        else if (file === concurrentFile) destinationContent = update(destinationContent);
        else throw new Error("Unexpected file passed to rollback processing.");
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: file === source
        ? originalFrontmatter
        : { title: "Synced destination" } }),
      resolvedLinks: {},
    },
    fileManager: {
      renameFile: async (): Promise<void> => {
        concurrentFile = new TFile(destination);
        tree.entries.set(destination, concurrentFile);
        laryngologyFolder.children.push(concurrentFile);
        throw new Error("simulated concurrent placement conflict");
      },
      processFrontMatter: async (): Promise<never> => { throw new Error("frontmatter processing must not run after rename rejection"); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-placement-sync-race-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.editCanonicalPlacement(sourcePath, {
    title: "Updated title",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: false,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  }), /simulated concurrent placement conflict/);

  assert.equal(source.path, sourcePath);
  assert.equal(tree.entries.get(sourcePath), source);
  assert.equal(sourceContent, originalContent);
  assert.equal(tree.entries.get(destination), concurrentFile);
  assert.equal(destinationContent, concurrentContent, "rollback must not process the concurrently created destination");
  assert.deepEqual(tree.trashedFolders, []);
});

test("cross-base search records retain each inactive base's own display aliases", async () => {
  const file = new TFile("Shared/Topic.md");
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.workspaceName = "First base";
  first.settings.primaryFolder = "Shared";
  first.displayNameByPath[file.path] = "First display";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.workspaceName = "Second base";
  second.settings.primaryFolder = "Shared";
  second.displayNameByPath[file.path] = "Second display";
  const store = createDefaultStore(first, 1, "vault-cross-base-alias-test");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 2));
  const { plugin } = pluginWithFiles(store, [file], { [file.path]: { title: "Source title" } });
  await plugin.loadPluginData();

  const results = await plugin.searchKnowledgeBases("source", { yieldEvery: Number.MAX_SAFE_INTEGER });

  assert.ok(results);
  assert.deepEqual(results.groups.map((group) => [group.source.baseName, group.records[0]?.title]), [
    ["First base", "First display"],
    ["Second base", "Second display"],
  ]);
  assert.equal(results.groups[1]?.records[0]?.sourceTitle, "Source title");
});

test("cross-base search omits hidden unreferenced ENT topics but preserves referenced source semantics", async () => {
  const file = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Hidden airway.md");
  const hidden = migrateData(null);
  hidden.settings.workspaceMode = "ent-clinical";
  hidden.settings.workspaceName = "Hidden base";
  hidden.settings.primaryFolder = "03 Clinical Topics";
  hidden.settings.idProperty = "curriculum_id";
  hidden.excludedIndexPaths = [file.path];
  const referenced = structuredClone(hidden);
  referenced.settings.workspaceName = "Referenced base";
  referenced.pinnedPaths = [file.path];
  const store = createDefaultStore(hidden, 1, "vault-hidden-search-test");
  store.bases.push(createKnowledgeBaseEntry(referenced, "base-referenced", 2));
  const { plugin } = pluginWithFiles(store, [file], {
    [file.path]: {
      title: "Hidden airway",
      curriculum_id: "ENT-PED-001",
      domain: "Pediatric",
    },
  });
  await plugin.loadPluginData();

  assert.equal(plugin.getRecord(file.path), null, "Hidden alone is not a searchable record reference");
  const results = await plugin.searchKnowledgeBases("hidden airway", { yieldEvery: Number.MAX_SAFE_INTEGER });

  assert.ok(results);
  assert.equal(results.total, 1);
  assert.equal(results.groups[0]?.source.baseName, "Referenced base");
  assert.equal(results.groups[0]?.records[0]?.kind, "topic");
  assert.equal(results.groups[0]?.records[0]?.role, "canonical");
  assert.equal(results.groups[0]?.records[0]?.portableIndexed, false);
});

test("cross-base search streams uncached bases through one bounded catalog without warming their record caches", async () => {
  const files = Array.from({ length: 40 }, (_, index) => new TFile(`Shared/Topic ${index + 1}.md`));
  const frontmatterByPath = Object.fromEntries(files.map((file, index) => [file.path, { title: `Topic ${index + 1}` }]));
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.workspaceName = "Base 1";
  first.settings.primaryFolder = "Shared";
  const store = createDefaultStore(first, 1, "vault-cross-base-snapshot-test");
  for (let index = 2; index <= 12; index += 1) {
    const data = migrateData(null);
    data.settings.workspaceMode = "generic";
    data.settings.workspaceName = `Base ${index}`;
    data.settings.primaryFolder = "Shared";
    store.bases.push(createKnowledgeBaseEntry(data, `base-${index}`, index));
  }
  const archivedData = migrateData(null);
  archivedData.settings.workspaceMode = "generic";
  archivedData.settings.workspaceName = "Archived base";
  archivedData.settings.primaryFolder = "Shared";
  const archivedEntry = createKnowledgeBaseEntry(archivedData, "base-archived-search", 13);
  archivedEntry.archivedAt = 14;
  archivedEntry.updatedAt = 14;
  archivedEntry.semanticRevision = 1;
  store.bases.push(archivedEntry);
  const { plugin, metadataReadCount, vaultEnumerationCount } = pluginWithFiles(store, files, frontmatterByPath);
  const internal = plugin as unknown as {
    recordsCacheByBase: Map<string, unknown[]>;
    inactiveSearchRecordsCache: Map<string, unknown[]>;
    inactiveSearchCachedRecordCount: number;
    invalidateKnowledgeBaseSearchSnapshot(): void;
  };
  await plugin.loadPluginData();
  plugin.getRecords();

  const firstResults = await plugin.searchKnowledgeBases("topic", { yieldEvery: Number.MAX_SAFE_INTEGER });

  assert.ok(firstResults);
  assert.equal(firstResults.total, 12 * files.length);
  assert.equal(firstResults.counts.length, 12);
  assert.equal(firstResults.counts.every(({ total }) => total === files.length), true);
  assert.equal(firstResults.rendered, 300);
  assert.equal(firstResults.stats.peakRetainedCandidates, 300);
  assert.equal(firstResults.stats.sortedCandidates, 300);
  assert.deepEqual([...internal.recordsCacheByBase.keys()], ["base-default"], "search does not retain full inactive-base records");
  assert.deepEqual(
    [...internal.inactiveSearchRecordsCache.keys()],
    ["base-10", "base-11", "base-12", "base-2", "base-3", "base-4", "base-5", "base-6", "base-7", "base-8", "base-9"],
    "the record budget retains every small inactive projection",
  );
  assert.equal(vaultEnumerationCount(), 2, "the active cache and lazy cross-base catalog each enumerate once");
  assert.equal(metadataReadCount(), files.length * 2, "the catalog reads each file once, not once per base");
  assert.equal(internal.inactiveSearchCachedRecordCount, 11 * files.length);
  const retainedInactiveRecord = internal.inactiveSearchRecordsCache.get("base-10")?.[0];

  const secondResults = await plugin.searchKnowledgeBases("topic 1", { yieldEvery: Number.MAX_SAFE_INTEGER });

  assert.ok(secondResults);
  assert.equal(vaultEnumerationCount(), 2, "later queries reuse the bounded catalog generation");
  assert.equal(metadataReadCount(), files.length * 2, "later queries do not reread unchanged metadata");
  assert.deepEqual([...internal.recordsCacheByBase.keys()], ["base-default"]);
  assert.equal(internal.inactiveSearchRecordsCache.size, 11);
  assert.equal(
    secondResults.groups.find((group) => group.source.baseId === "base-10")?.records.includes(retainedInactiveRecord as never),
    true,
    "the next keystroke reuses cached inactive record objects",
  );

  internal.invalidateKnowledgeBaseSearchSnapshot();
  const afterVaultEvent = await plugin.searchKnowledgeBases("topic 1", { yieldEvery: Number.MAX_SAFE_INTEGER });
  assert.ok(afterVaultEvent);
  assert.equal(internal.inactiveSearchRecordsCache.size, 11);
  const rebuiltInactiveRecord = internal.inactiveSearchRecordsCache.get("base-10")?.[0];
  assert.equal(rebuiltInactiveRecord, retainedInactiveRecord, "an unrelated snapshot refresh preserves path-scoped projections");
  assert.equal(vaultEnumerationCount(), 2);
  assert.equal(metadataReadCount(), files.length * 2);

  const afterEventSecondQuery = await plugin.searchKnowledgeBases("topic", { yieldEvery: Number.MAX_SAFE_INTEGER });
  assert.ok(afterEventSecondQuery);
  assert.equal(vaultEnumerationCount(), 2, "retained projections are reused on the next keystroke");
  assert.equal(metadataReadCount(), files.length * 2);
  assert.equal(
    afterEventSecondQuery.groups.find((group) => group.source.baseId === "base-10")?.records.includes(rebuiltInactiveRecord as never),
    true,
  );
});

test("inactive search projections keep a scan-resistant record-budgeted working set", () => {
  const plugin = pluginWith(createDefaultStore(migrateData(null), 1, "vault-search-lru-test"));
  const internal = plugin as unknown as {
    inactiveSearchRecordsCache: Map<string, Array<{ path: string }>>;
    inactiveSearchCachedRecordCount: number;
    retainInactiveSearchRecords(baseId: string, records: Array<{ path: string }>): void;
    getInactiveSearchRecords(baseId: string): Array<{ path: string }> | undefined;
  };
  const records = (baseId: string, count: number): Array<{ path: string }> => (
    Array.from({ length: count }, (_, index) => ({ path: `${baseId}/${index}.md` }))
  );

  internal.retainInactiveSearchRecords("base-a", records("a", 30_000));
  internal.retainInactiveSearchRecords("base-b", records("b", 20_000));
  assert.equal(internal.inactiveSearchCachedRecordCount, 50_000);
  assert.ok(internal.getInactiveSearchRecords("base-a"));
  internal.retainInactiveSearchRecords("base-c", records("c", 10_000));

  assert.deepEqual([...internal.inactiveSearchRecordsCache.keys()], ["base-a", "base-b"]);
  assert.equal(internal.inactiveSearchCachedRecordCount, 50_000);
  assert.equal(internal.inactiveSearchRecordsCache.has("base-c"), false, "a sequential miss must not evict a later cache hit");
});

test("over-budget cross-base searches reuse the stable working set on every later query", async () => {
  const files = Array.from({ length: 10_000 }, (_, index) => new TFile(`Shared/Topic ${index}.md`));
  const frontmatterByPath = Object.fromEntries(files.map((file, index) => [file.path, { title: `Topic ${index}` }]));
  const active = migrateData(null);
  active.settings.workspaceMode = "generic";
  active.settings.primaryFolder = "Shared";
  active.settings.workspaceName = "Active";
  const store = createDefaultStore(active, 1, "vault-over-budget-search-cache");
  for (let index = 1; index <= 6; index += 1) {
    const data = migrateData(null);
    data.settings.workspaceMode = "generic";
    data.settings.primaryFolder = "Shared";
    data.settings.workspaceName = `Inactive ${index}`;
    store.bases.push(createKnowledgeBaseEntry(data, `base-${index}`, index + 1));
  }
  const { plugin } = pluginWithFiles(store, files, frontmatterByPath);
  const internal = plugin as unknown as {
    inactiveSearchRecordsCache: Map<string, unknown[]>;
    iterateRecordScanForEntry(
      entry: KnowledgeBaseEntry,
      files: readonly TFile[],
      frontmatterByPath?: ReadonlyMap<string, Record<string, unknown>>,
    ): Generator<VaultRecord | null>;
  };
  await plugin.loadPluginData();
  plugin.getRecords();
  const originalScan = internal.iterateRecordScanForEntry.bind(plugin);
  let projectionScans = 0;
  internal.iterateRecordScanForEntry = function* (...args): Generator<VaultRecord | null> {
    projectionScans += 1;
    yield* originalScan(...args);
  };

  await plugin.searchKnowledgeBases("topic", { yieldEvery: Number.MAX_SAFE_INTEGER });
  assert.equal(projectionScans, 6);
  assert.equal(internal.inactiveSearchRecordsCache.size, 5);

  projectionScans = 0;
  await plugin.searchKnowledgeBases("topic 9", { yieldEvery: Number.MAX_SAFE_INTEGER });
  assert.equal(projectionScans, 1, "only the one projection outside the record budget is rebuilt");
  assert.equal(internal.inactiveSearchRecordsCache.size, 5);
});

test("a vault rename overlays stale portable paths while asynchronous repair is delayed or rejected", async () => {
  const oldFile = new TFile("Inactive/Old topic.md");
  const newPath = "Inactive/New topic.md";
  const files = [oldFile];
  const frontmatterByPath: Record<string, Record<string, unknown>> = {
    [oldFile.path]: { title: "Old topic" },
  };
  const active = migrateData(null);
  active.settings.workspaceMode = "generic";
  active.settings.primaryFolder = "Active";
  const inactive = migrateData(null);
  inactive.settings.workspaceMode = "generic";
  inactive.settings.primaryFolder = "Inactive";
  inactive.portableIndex.groups = [{ id: "group-inactive", title: "Inactive", order: 0 }];
  inactive.portableIndex.subjects = [{
    id: "subject-old-topic",
    title: "Old topic",
    groupId: "group-inactive",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
  }];
  inactive.portableIndex.resolvedPathBySubjectId = { "subject-old-topic": oldFile.path };
  inactive.displayNameByPath = {
    [oldFile.path]: "Renamed display",
    [newPath]: "Stale destination display",
  };
  inactive.indexGroupByPath = {
    [oldFile.path]: "Renamed group",
    [newPath]: "Stale destination group",
  };
  const store = createDefaultStore(active, 1, "vault-rename-search-cache");
  store.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive", 2));
  const { plugin } = pluginWithFiles(store, files, frontmatterByPath);
  const repairRelease = deferred();
  const internal = plugin as unknown as {
    inactiveSearchRecordsCache: Map<string, Array<{ path: string }>>;
    pendingVaultRenames: Array<{ oldPath: string; newPath: string }>;
    handleRename(oldPath: string, newPath: string, folderRename?: boolean): Promise<void>;
    handleVaultRenameEvent(file: TAbstractFile, oldPath: string): void;
  };
  await plugin.loadPluginData();
  plugin.getRecords();
  const warm = await plugin.searchKnowledgeBases("old topic", { yieldEvery: Number.MAX_SAFE_INTEGER });
  assert.equal(warm?.groups[0]?.records[0]?.path, oldFile.path);
  assert.equal(internal.inactiveSearchRecordsCache.has("base-inactive"), true);

  const newFile = new TFile(newPath);
  files.splice(0, 1, newFile);
  delete frontmatterByPath[oldFile.path];
  frontmatterByPath[newFile.path] = { title: "New topic" };
  internal.handleRename = async () => {
    await repairRelease.promise;
    throw new Error("simulated read-only rename rejection");
  };
  internal.handleVaultRenameEvent(newFile, oldFile.path);

  assert.equal(internal.inactiveSearchRecordsCache.size, 0, "rename eviction is synchronous");
  const duringRepair = await plugin.searchKnowledgeBases("renamed display", { yieldEvery: Number.MAX_SAFE_INTEGER });
  const duringRecords = duringRepair?.groups.flatMap((group) => group.records) ?? [];
  assert.deepEqual(duringRecords.map((record) => record.path), [newFile.path]);
  assert.equal(duringRecords[0]?.portableId, "subject-old-topic", "the pending overlay keeps the linked identity on the new file");
  assert.equal(duringRecords[0]?.title, "Renamed display", "source path display metadata must win a destination-key collision");
  assert.equal(duringRecords[0]?.domain, "Renamed group", "source path group metadata must win a destination-key collision");
  assert.equal(duringRepair?.groups.some((group) => group.records.some((record) => record.path === oldFile.path)), false);
  repairRelease.resolve();
  await repairRelease.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(internal.pendingVaultRenames.length, 1, "a rejected durable repair keeps its safe session overlay");
  const afterRejection = await plugin.searchKnowledgeBases("renamed display", { yieldEvery: Number.MAX_SAFE_INTEGER });
  const afterRecords = afterRejection?.groups.flatMap((group) => group.records) ?? [];
  assert.deepEqual(afterRecords.map((record) => record.path), [newFile.path]);
  assert.equal(afterRecords[0]?.portableId, "subject-old-topic");
});

test("a successful queued rename repair removes its overlay only after durable state advances", async () => {
  const oldFile = new TFile("Knowledge Base/A.md");
  const newFile = new TFile("Knowledge Base/B.md");
  const files = [oldFile];
  const frontmatterByPath: Record<string, Record<string, unknown>> = { [oldFile.path]: { title: "Topic" } };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.portableIndex.groups = [{ id: "group", title: "Group", order: 0 }];
  data.portableIndex.subjects = [{
    id: "subject",
    title: "Topic",
    groupId: "group",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
  }];
  data.portableIndex.resolvedPathBySubjectId = { subject: oldFile.path };
  const { plugin } = pluginWithFiles(createDefaultStore(data, 1, "vault-rename-success"), files, frontmatterByPath);
  const internal = plugin as unknown as {
    pendingVaultRenames: Array<{ oldPath: string; newPath: string }>;
    vaultRenameRepairQueue: Promise<void>;
    handleRename(oldPath: string, newPath: string, folderRename?: boolean): Promise<void>;
    handleVaultRenameEvent(file: TAbstractFile, oldPath: string): void;
  };
  await plugin.loadPluginData();
  internal.handleRename = async (oldPath, newPath) => {
    rewritePluginDataPathPrefix(plugin.data, oldPath, newPath);
  };

  files.splice(0, 1, newFile);
  delete frontmatterByPath[oldFile.path];
  frontmatterByPath[newFile.path] = { title: "Topic" };
  internal.handleVaultRenameEvent(newFile, oldFile.path);
  await internal.vaultRenameRepairQueue;

  assert.deepEqual(internal.pendingVaultRenames, []);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.subject, newFile.path);
  const result = await plugin.searchKnowledgeBases("topic", { yieldEvery: Number.MAX_SAFE_INTEGER });
  const records = result?.groups.flatMap((group) => group.records) ?? [];
  assert.deepEqual(records.map((record) => record.path), [newFile.path]);
  assert.equal(records[0]?.portableId, "subject");
});

test("ordered rename repair keeps a complete A-to-C overlay when the first durable step keeps failing", async () => {
  const fileA = new TFile("Inactive/A.md");
  const fileB = new TFile("Inactive/B.md");
  const fileC = new TFile("Inactive/C.md");
  const files = [fileA];
  const frontmatterByPath: Record<string, Record<string, unknown>> = { [fileA.path]: { title: "Chain topic" } };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Inactive";
  data.portableIndex.groups = [{ id: "group", title: "Group", order: 0 }];
  data.portableIndex.subjects = [{
    id: "subject-chain",
    title: "Chain topic",
    groupId: "group",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
  }];
  data.portableIndex.resolvedPathBySubjectId = { "subject-chain": fileA.path };
  const { plugin } = pluginWithFiles(createDefaultStore(data, 1, "vault-rename-chain"), files, frontmatterByPath);
  const calls: string[] = [];
  const internal = plugin as unknown as {
    pendingVaultRenames: Array<{ oldPath: string; newPath: string }>;
    vaultRenameRepairQueue: Promise<void>;
    handleRename(oldPath: string, newPath: string): Promise<void>;
    handleVaultRenameEvent(file: TAbstractFile, oldPath: string): void;
  };
  await plugin.loadPluginData();
  internal.handleRename = async (oldPath, newPath) => {
    calls.push(`${oldPath}->${newPath}`);
    if (oldPath === fileA.path) throw new Error("first durable step remains read-only");
  };

  files.splice(0, 1, fileB);
  delete frontmatterByPath[fileA.path];
  frontmatterByPath[fileB.path] = { title: "Chain topic" };
  internal.handleVaultRenameEvent(fileB, fileA.path);
  files.splice(0, 1, fileC);
  delete frontmatterByPath[fileB.path];
  frontmatterByPath[fileC.path] = { title: "Chain topic" };
  internal.handleVaultRenameEvent(fileC, fileB.path);
  await internal.vaultRenameRepairQueue;

  assert.deepEqual(calls, [`${fileA.path}->${fileB.path}`, `${fileA.path}->${fileB.path}`]);
  assert.deepEqual(internal.pendingVaultRenames.map((rename) => `${rename.oldPath}->${rename.newPath}`), [
    `${fileA.path}->${fileB.path}`,
    `${fileB.path}->${fileC.path}`,
  ]);
  const result = await plugin.searchKnowledgeBases("chain topic", { yieldEvery: Number.MAX_SAFE_INTEGER });
  const records = result?.groups.flatMap((group) => group.records) ?? [];
  assert.deepEqual(records.map((record) => record.path), [fileC.path]);
  assert.equal(records[0]?.portableId, "subject-chain");
});

test("search projection candidates are restricted to each configured base plus explicit references", () => {
  const rootFiles = Array.from({ length: 12 }, (_, index) => new TFile(`Knowledge A/Topic ${index}.md`));
  const unrelated = Array.from({ length: 500 }, (_, index) => new TFile(`Unrelated/Note ${index}.md`));
  const manual = new TFile("Manual/Outside.md");
  const proposal = new TFile("Incoming/Proposal.md");
  const files = [...rootFiles, ...unrelated, manual, proposal]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge A";
  data.manualIndexPaths = [manual.path];
  const entry = createKnowledgeBaseEntry(data, "base-a", 1);
  const plugin = pluginWith(createDefaultStore(data, 1, "vault-search-candidates-test"));
  const internal = plugin as unknown as {
    filesForSearchEntry(
      candidate: typeof entry,
      snapshot: {
        files: readonly TFile[];
        filesByPath: ReadonlyMap<string, TFile>;
        clinicalProposalFiles: readonly TFile[];
        frontmatterByPath: ReadonlyMap<string, Record<string, unknown>>;
        generation: number;
      },
    ): readonly TFile[];
  };
  const snapshot = {
    files,
    filesByPath: new Map(files.map((file) => [file.path, file])),
    clinicalProposalFiles: [proposal],
    frontmatterByPath: new Map<string, Record<string, unknown>>(),
    generation: 1,
  };

  const genericCandidates = internal.filesForSearchEntry(entry, snapshot);
  assert.equal(genericCandidates.length, rootFiles.length + 1);
  assert.equal(genericCandidates.some((file) => file.path === manual.path), true);
  assert.equal(genericCandidates.some((file) => file.path.startsWith("Unrelated/")), false);
  assert.equal(genericCandidates.some((file) => file.path === proposal.path), false);

  entry.data.settings.workspaceMode = "ent-clinical";
  const clinicalCandidates = internal.filesForSearchEntry(entry, snapshot);
  assert.equal(clinicalCandidates.some((file) => file.path === proposal.path), true);
});

test("an invalidated yielded search never publishes a deleted inactive out-of-folder proposal", async () => {
  const proposal = new TFile("Notes/Adhoc proposal.md");
  const files = [proposal];
  const frontmatterByPath: Record<string, Record<string, unknown>> = {
    [proposal.path]: { type: "topic-proposal", title: "Adhoc proposal" },
  };
  const active = migrateData(null);
  active.settings.workspaceMode = "generic";
  active.settings.primaryFolder = "Active";
  const inactive = migrateData(null);
  inactive.settings.workspaceMode = "ent-clinical";
  inactive.settings.primaryFolder = "Clinical Topics";
  inactive.settings.proposalFolder = "Inbox/Topic Proposals";
  const store = createDefaultStore(active, 1, "vault-cross-base-cancel-test");
  store.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive-clinical", 2));
  const { plugin } = pluginWithFiles(store, files, frontmatterByPath);
  const internal = plugin as unknown as {
    invalidateKnowledgeBaseSearchSnapshot(): void;
    recordsCacheByBase: Map<string, unknown[]>;
  };
  await plugin.loadPluginData();
  plugin.getRecords();

  const staleSearch = plugin.searchKnowledgeBases("adhoc", { yieldEvery: 1 });
  files.splice(0, files.length);
  delete frontmatterByPath[proposal.path];
  internal.invalidateKnowledgeBaseSearchSnapshot();

  assert.equal(await staleSearch, null, "generation invalidation cancels rather than publishing a partial stale result");
  const current = await plugin.searchKnowledgeBases("adhoc", { yieldEvery: Number.MAX_SAFE_INTEGER });
  assert.ok(current);
  assert.equal(current.total, 0);
  assert.deepEqual([...internal.recordsCacheByBase.keys()], ["base-default"], "the inactive clinical base remains lazy");
});

test("path-scoped vault-event invalidation preserves unrelated base caches and active links", async () => {
  const activeFile = new TFile("Active/Topic.md");
  const inactiveFile = new TFile("Inactive/Topic.md");
  const frontmatterByPath: Record<string, Record<string, unknown>> = {
    [activeFile.path]: { title: "Active topic", aliases: ["Active alias"] },
    [inactiveFile.path]: { title: "Inactive topic" },
  };
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.primaryFolder = "Active";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.primaryFolder = "Inactive";
  const store = createDefaultStore(first, 1, "vault-cross-base-relevance-test");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 2));
  const { plugin, metadataReadCount, vaultEnumerationCount } = pluginWithFiles(
    store,
    [activeFile, inactiveFile],
    frontmatterByPath,
  );
  const internal = plugin as unknown as {
    excludedPathsCacheByBase: Map<string, Set<string>>;
    invalidateRecordCachesForPath(path: string): boolean;
    recordLinkIndex: Map<string, { title: string }>;
    recordLinkIndexBaseId: string;
    recordPathsCacheByBase: Map<string, Set<string>>;
    recordsCacheByBase: Map<string, unknown[]>;
    referencedPathsCacheByBase: Map<string, Set<string>>;
  };
  await plugin.loadPluginData();
  const activeRecords = plugin.getRecords();
  internal.recordsCacheByBase.set("base-second", []);
  internal.recordPathsCacheByBase.set("base-second", new Set([inactiveFile.path]));
  internal.referencedPathsCacheByBase.set("base-second", new Set());
  internal.excludedPathsCacheByBase.set("base-second", new Set());
  const activeReferenced = internal.referencedPathsCacheByBase.get("base-default");
  const inactiveReferenced = internal.referencedPathsCacheByBase.get("base-second");
  const activeExcluded = internal.excludedPathsCacheByBase.get("base-default");
  const inactiveExcluded = internal.excludedPathsCacheByBase.get("base-second");

  assert.equal(plugin.isRelevant("Inactive/Changed.md"), false, "the active-base helper remains base-local");
  assert.equal(internal.recordLinkIndexBaseId, "base-default");
  assert.equal(internal.recordLinkIndex.get("active alias")?.title, "Active topic");
  assert.equal(internal.invalidateRecordCachesForPath("Inactive/Changed.md"), true);
  assert.equal(internal.recordsCacheByBase.get("base-default"), activeRecords, "the active cache survives an inactive-only event");
  assert.equal(internal.recordsCacheByBase.has("base-second"), false, "only the affected inactive cache is evicted");
  assert.equal(plugin.getRecords(), activeRecords, "reading the active base remains a cache hit");
  assert.equal(internal.recordLinkIndexBaseId, "base-default", "the active link index remains valid");
  assert.equal(internal.recordLinkIndex.get("active alias")?.title, "Active topic");
  assert.equal(vaultEnumerationCount(), 1);
  assert.equal(metadataReadCount(), 1);
  assert.equal(internal.referencedPathsCacheByBase.get("base-default"), activeReferenced);
  assert.equal(internal.referencedPathsCacheByBase.get("base-second"), inactiveReferenced);
  assert.equal(internal.excludedPathsCacheByBase.get("base-default"), activeExcluded);
  assert.equal(internal.excludedPathsCacheByBase.get("base-second"), inactiveExcluded);

  frontmatterByPath[activeFile.path] = { title: "Updated active topic", aliases: ["Updated active alias"] };
  assert.equal(internal.invalidateRecordCachesForPath("Active/Changed.md"), true);
  assert.equal(internal.recordLinkIndexBaseId, "", "evicting the active base also invalidates its derived link index");
  assert.equal(internal.recordLinkIndex.size, 0);
  plugin.getRecords();
  assert.equal(internal.recordLinkIndexBaseId, "base-default");
  assert.equal(internal.recordLinkIndex.has("active alias"), false);
  assert.equal(internal.recordLinkIndex.get("updated active alias")?.title, "Updated active topic");
  assert.equal(internal.referencedPathsCacheByBase.get("base-default"), activeReferenced, "file events retain membership caches");
  assert.equal(internal.excludedPathsCacheByBase.get("base-default"), activeExcluded, "file events retain exclusion caches");
  assert.equal(internal.invalidateRecordCachesForPath("Outside/Changed.md"), false);
});

test("path-scoped invalidation tracks clinical proposals outside the configured Inbox", async () => {
  const files: TFile[] = [];
  const frontmatterByPath: Record<string, Record<string, unknown>> = {};
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "Clinical Topics";
  data.settings.proposalFolder = "Inbox/Topic Proposals";
  const store = createDefaultStore(data, 1, "vault-outside-proposal-event-test");
  const { plugin } = pluginWithFiles(store, files, frontmatterByPath);
  const internal = plugin as unknown as {
    invalidateRecordCachesForPath(path: string): boolean;
  };
  await plugin.loadPluginData();

  assert.deepEqual(plugin.getRecords(), [], "the initial empty cache is established");

  const file = new TFile("Notes/Adhoc proposal.md");
  files.push(file);
  frontmatterByPath[file.path] = { type: "topic-proposal", title: "Adhoc proposal" };
  assert.equal(internal.invalidateRecordCachesForPath(file.path), true, "a newly created out-of-folder proposal invalidates clinical caches");
  assert.deepEqual(plugin.getRecords().map((record) => [record.path, record.role]), [[file.path, "proposal"]]);

  frontmatterByPath[file.path] = { title: "Ordinary note" };
  assert.equal(internal.invalidateRecordCachesForPath(file.path), true, "the cached proposal path invalidates when its type is removed");
  assert.deepEqual(plugin.getRecords(), [], "the former proposal does not remain as a ghost record");

  frontmatterByPath[file.path] = { type: "topic-proposal", title: "Adhoc proposal" };
  assert.equal(internal.invalidateRecordCachesForPath(file.path), true);
  assert.equal(plugin.getRecords().length, 1);
  files.splice(files.indexOf(file), 1);
  delete frontmatterByPath[file.path];
  assert.equal(internal.invalidateRecordCachesForPath(file.path), true, "deleting the cached outside proposal invalidates by its prior record path");
  assert.deepEqual(plugin.getRecords(), []);
});

test("Quick Append atomically groups repeated categories and keeps only compact transient undo metadata", async () => {
  Notice.messages.length = 0;
  const file = new TFile("Knowledge Base/Airway.md");
  const original = "---\nai_lock: false\n---\n# Airway\n\nExisting text.";
  let content = original;
  let committedWrites = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      process: async (_file: TFile, transform: (value: string) => string) => {
        const next = transform(content);
        if (next !== content) {
          content = next;
          committedWrites += 1;
        }
      },
      createFolder: async () => {},
      create: async (path: string) => new TFile(path),
    },
    workspace: { getLeavesOfType: () => [], getActiveFile: () => file },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-quick-append-test");
  await plugin.loadPluginData();

  await plugin.appendFollowUpToFile(file, "questions", "Why does this happen?");
  const afterFirst = content;
  await plugin.appendFollowUpToFile(file, "questions", "What should I review next?");
  await plugin.appendFollowUpToFile(file, "sources", "[[Airway review article]]");

  assert.equal(committedWrites, 3);
  assert.equal(content.match(/^## Follow-up notes$/gmu)?.length, 1);
  assert.equal(content.match(/kbcc-follow-up:category:questions/gu)?.length, 1);
  assert.equal(content.match(/kbcc-follow-up:category:sources/gu)?.length, 1);
  assert.match(content, /### Questions\n- \[ \] Why does this happen\?\n- \[ \] What should I review next\?/u);
  assert.match(content, /### Sources\n- \[\[Airway review article\]\]/u);

  const internal = plugin as unknown as {
    lastFollowUpUndo: unknown;
    undoLastFollowUpAppend(): Promise<void>;
  };
  const transientUndo = JSON.stringify(internal.lastFollowUpUndo);
  assert.equal(transientUndo.includes("Airway review article"), false, "transient undo fingerprints instead of retaining note text");
  assert.equal(JSON.stringify(plugin.savedData).includes("Airway review article"), false, "plugin data never stores appended note bodies");

  await internal.undoLastFollowUpAppend();
  assert.match(content, /What should I review next\?/u);
  assert.equal(content.includes("Airway review article"), false);

  await plugin.appendFollowUpToFile(file, "sources", "Source that will become stale");
  content += "\nUser edit after append.";
  const staleContent = content;
  await assert.rejects(() => internal.undoLastFollowUpAppend(), /changed after the append/u);
  assert.equal(content, staleContent, "a stale undo must not rewrite any user edit");

  content = "---\nai_lock: true\n---\n# Locked note\n";
  const writesBeforeLock = committedWrites;
  await assert.rejects(
    () => plugin.appendFollowUpToFile(file, "questions", "Must not be written"),
    /ai_lock enabled/u,
  );
  assert.equal(content, "---\nai_lock: true\n---\n# Locked note\n");
  assert.equal(committedWrites, writesBeforeLock, "ai_lock refusal happens inside the atomic transform before commit");

  assert.notEqual(afterFirst, original);
});

test("Quick Append refuses immutable source books and same-path file replacements before processing", async () => {
  const sourceBook = new TFile("05 Sources/_books/Reference/Chapter.md");
  const selected = new TFile("Knowledge Base/Selected.md");
  const replacement = new TFile(selected.path);
  let current: TFile = sourceBook;
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [sourceBook, current],
      getAbstractFileByPath: (path: string) => path === current.path ? current : path === sourceBook.path ? sourceBook : null,
      process: async () => { processCalls += 1; },
      createFolder: async () => {},
      create: async (path: string) => new TFile(path),
    },
    workspace: { getLeavesOfType: () => [], getActiveFile: () => current },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-quick-append-identity-test");
  await plugin.loadPluginData();

  await assert.rejects(
    () => plugin.appendFollowUpToFile(sourceBook, "questions", "Do not write a source book"),
    /immutable source-book/iu,
  );
  current = replacement;
  await assert.rejects(
    () => plugin.appendFollowUpToFile(selected, "questions", "Do not write a replacement"),
    /no longer the same Markdown file/u,
  );
  assert.equal(processCalls, 0, "both refusals happen before Vault.process can commit anything");
});

test("Quick Append refuses a same-path replacement inside the atomic transform", async () => {
  const selected = new TFile("Knowledge Base/Append identity.md");
  let currentFile = selected;
  const original = "# Append identity\n";
  let content = original;
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [currentFile],
      getAbstractFileByPath: (path: string) => path === currentFile.path ? currentFile : null,
      process: async (_file: TFile, transform: (value: string) => string) => {
        processCalls += 1;
        currentFile = new TFile(selected.path);
        content = transform(content);
      },
      createFolder: async () => {},
      create: async (path: string) => new TFile(path),
    },
    workspace: { getLeavesOfType: () => [], getActiveFile: () => currentFile },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-quick-append-process-identity-test");
  await plugin.loadPluginData();

  await assert.rejects(
    () => plugin.appendFollowUpToFile(selected, "questions", "Do not append to the replacement"),
    /no longer the same Markdown file/u,
  );
  assert.equal(processCalls, 1);
  assert.equal(content, original, "the replacement note is not rewritten");
  assert.notEqual(currentFile, selected);
});

test("Quick Append undo refuses a same-path replacement before and during the atomic transform", async () => {
  const selected = new TFile("Knowledge Base/Undo identity.md");
  let currentFile = selected;
  let content = "# Undo identity\n";
  let replaceBeforeTransform = false;
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [currentFile],
      getAbstractFileByPath: (path: string) => path === currentFile.path ? currentFile : null,
      process: async (_file: TFile, transform: (value: string) => string) => {
        processCalls += 1;
        if (replaceBeforeTransform) {
          replaceBeforeTransform = false;
          currentFile = new TFile(selected.path);
        }
        content = transform(content);
      },
      createFolder: async () => {},
      create: async (path: string) => new TFile(path),
    },
    workspace: { getLeavesOfType: () => [], getActiveFile: () => currentFile },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-quick-append-undo-identity-test");
  await plugin.loadPluginData();
  const internal = plugin as unknown as { undoLastFollowUpAppend(): Promise<void> };

  await plugin.appendFollowUpToFile(selected, "questions", "First append");
  currentFile = new TFile(selected.path);
  await assert.rejects(() => internal.undoLastFollowUpAppend(), /no recent Quick Append change/u);
  assert.equal(processCalls, 1, "a replacement detected by the command check is never processed");

  currentFile = selected;
  await plugin.appendFollowUpToFile(selected, "questions", "Second append");
  const appendedContent = content;
  replaceBeforeTransform = true;
  await assert.rejects(() => internal.undoLastFollowUpAppend(), /changed or was replaced/u);
  assert.equal(content, appendedContent, "a replacement during Vault.process is never rewritten");
  assert.notEqual(currentFile, selected);
});

test("Quick Append existing-note picker refuses a base or data-epoch change before opening the form", async () => {
  Notice.messages.length = 0;
  const file = new TFile("Knowledge Base/Topic.md");
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.primaryFolder = "Knowledge Base";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.primaryFolder = "Knowledge Base";
  second.settings.workspaceName = "Second";
  const store = createDefaultStore(first, 1, "vault-quick-append-picker-guard");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 2));
  const { plugin } = pluginWithFiles(store, [file], { [file.path]: { title: "Topic" } });
  await plugin.loadPluginData();

  const pickerOpen = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  const appendOpen = Object.getOwnPropertyDescriptor(QuickAppendModal.prototype, "open");
  let chooseFromPicker: ((chosen: TFile) => void) | null = null;
  let appendFormsOpened = 0;
  VaultFilePickerModal.prototype.open = function capturePicker(): void {
    chooseFromPicker = (chosen) => this.onChooseItem(chosen);
  };
  QuickAppendModal.prototype.open = function countAppendForm(): void { appendFormsOpened += 1; };
  try {
    plugin.openQuickAppendExistingNote();
    assert.ok(chooseFromPicker);
    await plugin.switchKnowledgeBase("base-second");
    chooseFromPicker(file);
    await Promise.resolve();

    assert.equal(appendFormsOpened, 0);
    assert.equal(Notice.messages.some((message) => message.includes("active knowledge base changed")), true);
  } finally {
    if (pickerOpen) Object.defineProperty(VaultFilePickerModal.prototype, "open", pickerOpen);
    else Reflect.deleteProperty(VaultFilePickerModal.prototype, "open");
    if (appendOpen) Object.defineProperty(QuickAppendModal.prototype, "open", appendOpen);
    else Reflect.deleteProperty(QuickAppendModal.prototype, "open");
  }
});

// --- Operation-barrier re-entrancy: a refresh inside a base switch or mutate
// --- transaction must never queue or wait behind the operation that owns it.

interface DeadlockViewHarness {
  plugin: EntVaultCommandCenterPlugin & TestPluginBase;
  attachView: () => void;
}

function pluginWithLiveView(files: TFile[], store: PluginStore): DeadlockViewHarness {
  let deviceState: unknown = null;
  const leaves: Array<{ view: unknown }> = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
    workspace: { getLeavesOfType: (type: string) => (type === VIEW_TYPE ? leaves : []) },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: () => structuredClone(deviceState),
    saveLocalStorage: (_key: string, value: unknown) => { deviceState = structuredClone(value); },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = store;
  plugin.savedData = [];
  plugin.deviceLocalWrites = [];
  const savedData = plugin.savedData;
  plugin.saveData = async (value: unknown) => { savedData.push(structuredClone(value)); };
  const attachView = (): void => {
    // A real prototype (passes the instanceof check inside refreshViews) whose
    // real reload() method runs against the real plugin, with rendering inert.
    const view = Object.create(EntVaultCommandCenterView.prototype) as Record<string, unknown>;
    view.plugin = plugin;
    view.loadedBaseId = plugin.getActiveKnowledgeBaseId();
    view.loadedDataEpoch = plugin.getDataEpoch();
    view.staleViewNoticeShown = false;
    view.viewClosed = false;
    view.query = "";
    view.parsedQuery = parseQuery("");
    view.searchDebounce = null;
    view.selectionSaveTimer = null;
    view.setupTimer = null;
    view.selectionSavePromise = null;
    view.globalSearchResult = null;
    view.globalSearchResultKey = "";
    view.globalSearchResultScopeKey = "";
    view.globalSearchPendingKey = "";
    view.globalSearchErrorKey = "";
    view.globalSearchErrorMessage = "";
    view.globalSearchRequestGeneration = 0;
    view.timerWindow = { clearTimeout: () => {}, setTimeout: () => 0, requestAnimationFrame: () => 0 };
    view.render = () => {};
    view.renderTree = () => {};
    view.refreshChromeCounts = () => {};
    leaves.push({ view });
  };
  return { plugin, attachView };
}

test("switching to a base whose selection needs reconciling completes with an open view", async () => {
  const files = [new TFile("Knowledge Base/Topic.md")];
  const dataA = migrateData(null);
  dataA.settings.setupComplete = true;
  const store = createDefaultStore(dataA, 100, "vault-deadlock-switch");
  const dataB = migrateData(null);
  dataB.settings.setupComplete = true;
  dataB.settings.workspaceName = "Base B";
  // selectedPath is intentionally the fresh-base default: empty, so the
  // in-operation refresh must reconcile a selection fallback.
  store.bases.push(createKnowledgeBaseEntry(dataB, "base-b", 200));
  const { plugin, attachView } = pluginWithLiveView(files, store);
  await plugin.loadPluginData();
  attachView();

  await bounded(plugin.switchKnowledgeBase("base-b"), "switch with open view", 3000);

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-b");
  assert.equal(plugin.data.selectedPath, "Knowledge Base/Topic.md");
  // The barrier must be free afterwards: a follow-up operation also completes.
  await bounded(plugin.switchKnowledgeBase("base-default"), "switch back", 3000);
});

test("a mutate whose action leaves duplicate pins completes with an open view", async () => {
  const files = [new TFile("Knowledge Base/Topic.md")];
  const dataA = migrateData(null);
  dataA.settings.setupComplete = true;
  dataA.selectedPath = "Knowledge Base/Topic.md";
  const store = createDefaultStore(dataA, 100, "vault-deadlock-mutate");
  const { plugin, attachView } = pluginWithLiveView(files, store);
  await plugin.loadPluginData();
  attachView();

  await bounded(plugin.mutate("Pin twice", () => {
    plugin.data.pinnedPaths.push("Knowledge Base/Topic.md", "Knowledge Base/Topic.md");
  }), "mutate with open view", 3000);

  // The in-operation reconcile deduplicated AND persisted the normalization.
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Topic.md"]);
  const lastSaved = plugin.savedData.at(-1) as PluginStore;
  assert.deepEqual(
    lastSaved.bases.find((entry) => entry.id === plugin.getActiveKnowledgeBaseId())?.data.pinnedPaths,
    ["Knowledge Base/Topic.md"],
    "the deduplicated pins must reach data.json, not only memory",
  );
  await bounded(plugin.mutate("Pin again", () => {
    plugin.data.pinnedPaths.push("Knowledge Base/Topic.md");
  }), "follow-up mutate", 3000);
});

// --- data.json backup safety net: every store save writes a parseable twin
// --- first, and a torn data.json is recovered from it at startup.

test("a store save writes the data.json backup twin before the primary write", async () => {
  const events: string[] = [];
  const adapterWrites: Array<{ path: string; content: string }> = [];
  const legacy = migrateData(null);
  legacy.settings.workspaceName = "Backup ordering";
  const app = {
    vault: {
      ...emptyWritableTestVault(),
      adapter: {
        exists: async () => false,
        read: async () => { throw new Error("missing"); },
        write: async (path: string, content: string) => {
          events.push("backup");
          adapterWrites.push({ path, content });
        },
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  const plugin = new EntVaultCommandCenterPlugin(
    app as never,
    { dir: ".obsidian/plugins/knowledge-base-command-center" } as never,
  ) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = legacy;
  const savedData: unknown[] = [];
  plugin.saveData = async (value: unknown) => {
    events.push("save");
    savedData.push(structuredClone(value));
  };

  await plugin.loadPluginData();

  assert.equal(savedData.length, 1, "legacy data triggers one migration writeback");
  assert.deepEqual(events, ["backup", "save"], "the twin must be durable before data.json is replaced");
  assert.equal(adapterWrites[0]?.path, ".obsidian/plugins/knowledge-base-command-center/data.json.bak");
  assert.deepEqual(JSON.parse(adapterWrites[0]?.content ?? "null"), JSON.parse(JSON.stringify(savedData[0])));
});

test("a torn data.json is recovered from the backup twin instead of read-only mode", async () => {
  const backupData = migrateData(null);
  backupData.settings.workspaceName = "Recovered organization";
  const backupStore = createDefaultStore(backupData, 100, "vault-backup-restore");
  const adapterWrites: Array<{ path: string; content: string }> = [];
  const app = {
    vault: {
      ...emptyWritableTestVault(),
      adapter: {
        exists: async (path: string) => path.endsWith("data.json.bak"),
        read: async (path: string) => {
          if (!path.endsWith("data.json.bak")) throw new Error("missing");
          return JSON.stringify(backupStore);
        },
        write: async (path: string, content: string) => { adapterWrites.push({ path, content }); },
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  const plugin = new EntVaultCommandCenterPlugin(
    app as never,
    { dir: ".obsidian/plugins/knowledge-base-command-center" } as never,
  ) as EntVaultCommandCenterPlugin & TestPluginBase;
  const savedData: unknown[] = [];
  plugin.saveData = async (value: unknown) => { savedData.push(structuredClone(value)); };
  plugin.loadData = async () => { throw new Error("Unexpected end of JSON input"); };

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, true, "recovery must not fall into read-only mode");
  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.data.settings.workspaceName, "Recovered organization");
  assert.equal(savedData.length, 1, "the recovered store is written back so data.json is valid again");
  assert.deepEqual((savedData[0] as PluginStore).vaultId, "vault-backup-restore");
});

test("a corrupt data.json with no usable backup still enters read-only protection", async () => {
  const plugin = pluginWith(null);
  plugin.loadData = async () => { throw new Error("Unexpected end of JSON input"); };

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, false);
  assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);
});
