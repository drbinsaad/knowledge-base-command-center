import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import {
  createDefaultStore,
  createKnowledgeBaseEntry,
  curriculumContainerKey,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_KNOWLEDGE_BASES,
  migrateData,
  portablePlaceholderPath,
  snapshotPersonal,
  STORE_KIND,
  STORE_VERSION,
} from "../src/model.ts";
import { createPortableExport, parsePortableExport, synchronizePortableRegistry } from "../src/portability.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import { ConfirmModal, IndexGroupModal } from "../src/modals.ts";
import { Notice, Plugin, TFile } from "obsidian";

interface TestPluginBase {
  loadedData: unknown;
  savedData: unknown[];
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function pluginWith(data: unknown): EntVaultCommandCenterPlugin & TestPluginBase {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  return plugin;
}

function pluginWithFiles(
  data: unknown,
  files: TFile[],
  frontmatterByPath: Record<string, Record<string, unknown>>,
): {
  plugin: EntVaultCommandCenterPlugin & TestPluginBase;
  sourceMutationCount: () => number;
  vaultEnumerationCount: () => number;
} {
  let sourceMutations = 0;
  let vaultEnumerations = 0;
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
      getFileCache: (file: TFile) => ({ frontmatter: frontmatterByPath[file.path] ?? {} }),
      resolvedLinks: {},
    },
    fileManager: {
      renameFile: forbiddenSourceMutation,
      processFrontMatter: forbiddenSourceMutation,
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  return {
    plugin,
    sourceMutationCount: () => sourceMutations,
    vaultEnumerationCount: () => vaultEnumerations,
  };
}

test("versionless modern plugin data is migrated and saved without losing organization", async () => {
  const plugin = pluginWith({
    collections: [{ id: "research", title: "Research", collapsed: false, subjects: ["Notes/Paper.md"], subheadings: [] }],
    pinnedPaths: ["Notes/Paper.md"],
    settings: { workspaceMode: "generic", workspaceName: "My KB", setupComplete: true },
  });
  await plugin.loadPluginData();
  assert.equal(plugin.data.version, 10);
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

test("an interim deterministic migrated vault ID rotates once and is persisted", async () => {
  const data = migrateData(null);
  data.settings.workspaceName = "MY MAIN NOTE KB";
  const store = createDefaultStore(data, 100, "vault-migrated-0123456789abcdef");
  const plugin = pluginWith(store);

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, true);
  assert.equal(result.hasVaultId, true, "the rotated in-memory identity is available to Sync");
  assert.match(plugin.getVaultId(), /^vault-migrated-0123456789abcdef-[a-z0-9]{12,64}$/i);
  assert.notEqual(plugin.getVaultId(), "vault-migrated-0123456789abcdef");
  assert.equal(plugin.savedData.length, 1, "rotation must survive restart and recovery export");
  assert.equal((plugin.savedData[0] as { vaultId?: string }).vaultId, plugin.getVaultId());
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

test("failed knowledge-base switching and creation restore the active base and base list", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  let saveAttempts = 0;
  plugin.saveData = () => {
    saveAttempts += 1;
    return Promise.reject(new Error("simulated knowledge-base save failure"));
  };

  await assert.rejects(plugin.switchKnowledgeBase("base-second"), /simulated knowledge-base save failure/);
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.settings.workspaceName, "First KB");
  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.id), ["base-default", "base-second"]);

  await assert.rejects(
    plugin.createKnowledgeBase("Unsaved KB", "generic", "Knowledge Base"),
    /simulated knowledge-base save failure/,
  );
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.settings.workspaceName, "First KB");
  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.id), ["base-default", "base-second"]);
  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.data.settings.workspaceName === "Unsaved KB"), false);
  assert.equal(saveAttempts, 2);
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
  const secondSaveStarted = deferred();
  const releaseSecondSave = deferred();
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
    if (call === 1) {
      secondSaveStarted.resolve();
      await releaseSecondSave.promise;
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
  await secondSaveStarted.promise;
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(snapshots[1]?.activeBaseId, "base-second");
  assert.equal(
    snapshots[1]?.bases?.find((entry) => entry.id === "base-default")?.data?.settings?.workspaceName,
    "First changed after save call",
  );
  assert.equal(snapshots[1]?.bases?.find((entry) => entry.id === "base-second")?.data?.settings?.workspaceName, "Second KB");

  releaseSecondSave.resolve();
  await pendingSwitch;
  assert.equal(saveCall, 2);
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
  const incoming = structuredClone(original);
  incoming.activeBaseId = "base-research";
  const incomingResearch = incoming.bases.find((entry) => entry.id === "base-research");
  assert.ok(incomingResearch);
  incomingResearch.data.pinnedPaths = ["Research/Paper.md"];
  incomingResearch.updatedAt = 400;
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.ok(plugin.getDataEpoch() > epochBeforeSync, "same-ID Sync replacement advances the data generation");
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.data.pinnedPaths, ["ENT/Airway.md"]);
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-research")?.data.pinnedPaths, ["Research/Paper.md"]);
  assert.equal(plugin.savedData.length, 1, "the merged envelope is written back so other devices converge");
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

test("mutate rejects without running its action while a base switch is being saved", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  const switchSaveStarted = deferred();
  const releaseSwitchSave = deferred();
  plugin.saveData = async () => {
    switchSaveStarted.resolve();
    await releaseSwitchSave.promise;
  };

  const pendingSwitch = plugin.switchKnowledgeBase("base-second");
  await switchSaveStarted.promise;
  let actionRan = false;
  await assert.rejects(
    plugin.mutate("Racing organization edit", () => { actionRan = true; }),
    /finish switching knowledge bases before changing its organization/i,
  );
  assert.equal(actionRan, false);
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(plugin.data.settings.workspaceName, "Second KB");

  releaseSwitchSave.resolve();
  await pendingSwitch;
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
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
    const savedSettings = [entry.data.layoutSnapshots, entry.data.undoStack, entry.data.redoStack]
      .flatMap((stack) => [stack[0]?.settings, stack[0]?.layoutSnapshots?.[0]?.settings]);
    for (const settings of [entry.data.settings, ...savedSettings]) {
      assert.equal(settings?.primaryFolder, expectedPrimary);
      assert.equal(settings?.proposalFolder, "Renamed Root/Inbox/Topic Proposals");
      assert.equal(settings?.templatesFolder, "Renamed Root/Templates");
      assert.equal(settings?.defaultNoteFolder, `${expectedPrimary}/Inbox`);
      assert.equal(settings?.defaultTemplatePath, "Renamed Root/Templates/Topic.md");
    }
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
    ...[plugin.data.layoutSnapshots, plugin.data.undoStack, plugin.data.redoStack]
      .flatMap((stack) => [stack[0]?.settings, stack[0]?.layoutSnapshots?.[0]?.settings]),
  ]) {
    assert.equal(settings?.defaultTemplatePath, "Templates/New topic.md");
    assert.equal(settings?.primaryFolder, "Knowledge Base");
  }
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
  assert.equal(plugin.data.version, 10);
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

test("reconciliation converts dead cross-vault recovery bindings back to portable placeholders", async () => {
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
  const placeholder = portablePlaceholderPath("subject-airway");

  assert.equal(changed, true);
  assert.deepEqual(plugin.data.portableIndex.resolvedPathBySubjectId, {});
  assert.deepEqual(plugin.data.manualIndexPaths, [placeholder]);
  assert.equal(plugin.getRecord(placeholder)?.title, "Airway");
  assert.equal(plugin.savedData.length, 1);
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
    version: 1,
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
  assert.equal(exportedSubject?.groupId, groupId);
  assert.equal(exported.components.index?.groups.find((group) => group.id === groupId)?.title, "Inherited syndromes");
  assert.deepEqual(exported.components.index?.includedSections, {
    index: false,
    procedures: false,
    medications: false,
    syndromes: true,
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
    version: 1,
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
