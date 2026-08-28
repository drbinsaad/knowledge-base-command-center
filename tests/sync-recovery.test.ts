import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Notice, TFile, TFolder } from "obsidian";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { createDefaultStore, migrateData, type PluginStore } from "../src/model.ts";
import { ClearDeviceLocalDataModal, SyncRecoveryCenterModal } from "../src/sync-recovery-modal.ts";
import {
  MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES,
  createDefaultSyncRecoveryLocalState,
  describeConfigProfile,
  describePlatform,
  formatLocalAge,
  isDocumentedConflictRescuePath,
  isDocumentedNamedRecoveryPath,
  parseSyncRecoveryLocalState,
  privacySafeBaseName,
  privacySafeReadOnlyReason,
  summarizeRecoveryArtifacts,
  type SyncRecoveryCenterSnapshot,
} from "../src/sync-recovery.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

const SYNC_RECOVERY_STATE_KEY = "ent-vault-command-center.sync-recovery-state.v1";

function artifact(path: string, mtime: number): { path: string; mtime: number } {
  return { path, mtime };
}

function validConflict(index: number, mtime = index): { path: string; mtime: number } {
  const suffix = index === 0 ? "" : `-${index + 1}`;
  return artifact(
    `Knowledge Base Command Center Exports/knowledge-base-command-center-conflict-2026-08-11T10-20-30-000Z${suffix}.json`,
    mtime,
  );
}

function pluginHarness(
  store: PluginStore,
  exportFiles: Array<TFile | TFolder> = [],
  syncRecoveryState: unknown = null,
): {
  plugin: EntVaultCommandCenterPlugin;
  localStorage: Map<string, unknown>;
  noteBodyReads: () => number;
} {
  const localStorage = new Map<string, unknown>();
  if (syncRecoveryState !== null) localStorage.set(SYNC_RECOVERY_STATE_KEY, structuredClone(syncRecoveryState));
  let reads = 0;
  const exportFolder = new TFolder("Knowledge Base Command Center Exports", exportFiles);
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === exportFolder.path ? exportFolder : null,
      getMarkdownFiles: () => [],
      cachedRead: async (): Promise<string> => { reads += 1; throw new Error("note bodies must not be read"); },
      read: async (): Promise<string> => { reads += 1; throw new Error("note bodies must not be read"); },
      createFolder: async () => {},
      create: async (path: string) => new TFile(path),
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: (key: string) => structuredClone(localStorage.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { localStorage.set(key, structuredClone(value)); },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadedData = structuredClone(store);
  return { plugin, localStorage, noteBodyReads: () => reads };
}

function snapshot(overrides: Partial<SyncRecoveryCenterSnapshot> = {}): SyncRecoveryCenterSnapshot {
  return {
    activeBaseName: "Research",
    workspaceProfile: "Generic knowledge base",
    semanticRevision: 7,
    semanticHeadSummary: "1234abcd…",
    semanticCommitState: "committed",
    lastLocalSaveAt: 100,
    lastExternalReloadAt: 200,
    lastExternalReloadOutcome: "applied",
    conflictRescueCount: 2,
    conflictRescueCountIsLowerBound: false,
    artifactInspectionAvailable: true,
    newestConflictRescueAt: 300,
    newestRecoveryExportAt: 400,
    readOnly: false,
    readOnlyReason: "Writable",
    stickyUntilRestart: false,
    activeBaseConcurrentEditAt: null,
    activeBaseConcurrentEditCount: 0,
    deviceProfile: "Desktop app",
    configProfile: "Default Obsidian configuration folder",
    deviceLocalStateProfile: "Active-base view profile stored on this device",
    ...overrides,
  };
}

test("artifact inventory accepts only documented direct-child names and reports ages without reading files", () => {
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const files = [
    validConflict(0, now - 120_000),
    validConflict(1, now - 60_000),
    artifact("Knowledge Base Command Center Exports/knowledge-base-command-center-conflict-manual.json", now),
    artifact("Knowledge Base Command Center Exports/nested/knowledge-base-command-center-conflict-2026-08-11T10-20-30-000Z.json", now),
    artifact("Elsewhere/knowledge-base-command-center-conflict-2026-08-11T10-20-30-000Z.json", now),
    artifact("Knowledge Base Command Center Exports/knowledge-base-command-center-backup-2026-08-11T10-20-30-000Z.json", now - 30_000),
  ];
  const result = summarizeRecoveryArtifacts(files);
  assert.equal(result.conflictRescueCount, 2);
  assert.equal(result.newestConflictRescueAt, now - 60_000);
  assert.equal(result.newestNamedRecoveryAt, now - 30_000);
  assert.equal(result.scanTruncated, false);
  assert.equal(formatLocalAge(result.newestConflictRescueAt, now), "1 minute ago");
  assert.equal(isDocumentedConflictRescuePath(files[0]?.path ?? ""), true);
  assert.equal(isDocumentedNamedRecoveryPath(files.at(-1)?.path ?? ""), true);
});

test("artifact inventory is bounded and marks its count as a lower bound", () => {
  const files = Array.from({ length: MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES + 25 }, (_, index) => validConflict(index));
  const result = summarizeRecoveryArtifacts(files);
  assert.equal(result.scannedEntries, MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES);
  assert.equal(result.conflictRescueCount, MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES);
  assert.equal(result.scanTruncated, true);
  assert.equal(summarizeRecoveryArtifacts(files, Number.MAX_SAFE_INTEGER).scannedEntries, MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES);
});

test("device-local state is validated, bounded, and never treats a timestamp-less outcome as observed", () => {
  const base = createDefaultSyncRecoveryLocalState();
  const parsed = parseSyncRecoveryLocalState({
    ...base,
    lastExternalReloadAt: null,
    lastExternalReloadOutcome: "blocked",
    semanticConflicts: Array.from({ length: 75 }, (_, index) => ({ baseId: `base-${index}`, at: index + 1, count: 1 })),
  });
  assert.equal(parsed.lastExternalReloadOutcome, null);
  assert.equal(parsed.semanticConflicts.length, 50);
  assert.equal(parsed.highestPluginVersionSeen, null);
  assert.equal(parseSyncRecoveryLocalState({
    ...base,
    highestPluginVersionSeen: "0.12.0-rc.1",
  }).highestPluginVersionSeen, "0.12.0-rc.1");
  assert.equal(parseSyncRecoveryLocalState({
    ...base,
    highestPluginVersionSeen: `0.12.0+${"x".repeat(128)}`,
  }).highestPluginVersionSeen, null);
  assert.throws(() => parseSyncRecoveryLocalState({ version: 2 }), /unsupported/i);
});

test("the plugin records successful local saves and completed external reloads as device-only facts", async () => {
  const data = migrateData(null);
  data.settings.workspaceName = "Research";
  const store = createDefaultStore(data, 100, "vault-local-diagnostics");
  const { plugin, localStorage, noteBodyReads } = pluginHarness(store);
  await plugin.loadPluginData();

  plugin.data.settings.workspaceSubtitle = "Changed locally";
  await plugin.savePluginData();
  const afterLocal = plugin.getSyncRecoveryCenterSnapshot();
  assert.ok(afterLocal.lastLocalSaveAt !== null);
  const localSaveAt = afterLocal.lastLocalSaveAt;

  const disk = structuredClone(plugin.savedData.at(-1) ?? store);
  plugin.loadData = async () => structuredClone(disk);
  await plugin.onExternalSettingsChange();
  const afterExternal = plugin.getSyncRecoveryCenterSnapshot();
  assert.equal(afterExternal.lastLocalSaveAt, localSaveAt);
  assert.equal(afterExternal.lastExternalReloadOutcome, "applied");
  assert.ok(afterExternal.lastExternalReloadAt !== null);
  assert.ok(localStorage.has(SYNC_RECOVERY_STATE_KEY));
  assert.equal(noteBodyReads(), 0);
});

test("snapshot remains path-safe in read-only mode and reports active-base conflict metadata without identifiers", async () => {
  const data = migrateData(null);
  data.settings.workspaceName = "/Users/private/Research/data.json";
  const store = createDefaultStore(data, 100, "vault-private-identifier");
  const state = {
    ...createDefaultSyncRecoveryLocalState(),
    lastLocalSaveAt: 10,
    lastExternalReloadAt: 20,
    lastExternalReloadOutcome: "blocked",
    semanticConflicts: [{ baseId: store.activeBaseId, at: 30, count: 1 }],
  };
  const rescue = new TFile("Knowledge Base Command Center Exports/knowledge-base-command-center-conflict-2026-08-11T10-20-30-000Z.json");
  rescue.stat.mtime = 40;
  const mimickingFolder = new TFolder("Knowledge Base Command Center Exports/knowledge-base-command-center-conflict-2026-08-11T10-20-30-001Z.json");
  const { plugin, noteBodyReads } = pluginHarness(store, [rescue, mimickingFolder], state);
  await plugin.loadPluginData();
  plugin.dataCompatibilityWarning = "Plugin data version 99 is newer than this build at /Users/private/base-secret.json";
  const result = plugin.getSyncRecoveryCenterSnapshot();
  const serialized = JSON.stringify(result);

  assert.equal(result.readOnly, true);
  assert.equal(result.activeBaseConcurrentEditCount, 1);
  assert.equal(result.conflictRescueCount, 1);
  assert.equal(result.activeBaseName, "Active knowledge base (path-like name hidden)");
  assert.match(result.readOnlyReason, /newer than this build/i);
  assert.doesNotMatch(serialized, /\/Users\/private|vault-private-identifier|base-secret|data\.json/i);
  assert.equal(noteBodyReads(), 0);
});

test("privacy helpers never echo paths, raw warnings, custom config names, or full semantic identifiers", () => {
  const reason = privacySafeReadOnlyReason(
    "Could not merge /Users/private/Vault/.obsidian/plugins/example/data.json for base-secret-123",
    { persistenceUncertain: false, semanticConflictRescueFailed: false },
  );
  assert.doesNotMatch(reason, /\/Users|base-secret|\.obsidian|data\.json/iu);
  assert.equal(privacySafeBaseName("C:\\Users\\private\\Vault"), "Active knowledge base (path-like name hidden)");
  assert.equal(privacySafeBaseName("Research /Users/private/Vault"), "Active knowledge base (path-like name hidden)");
  assert.equal(privacySafeBaseName("private/project"), "Active knowledge base (path-like name hidden)");
  assert.equal(privacySafeBaseName("file://private.example/Vault"), "Active knowledge base (path-like name hidden)");
  assert.equal(describeConfigProfile(".custom-private-config"), "Custom Obsidian configuration folder (name hidden)");
  assert.equal(describePlatform({ isIosApp: true, isPhone: true }), "iPhone app");
});

test("stale base and same-base epoch guards close once with a path-free notice", () => {
  Notice.messages.length = 0;
  for (const mode of ["base", "epoch"] as const) {
    let activeBaseId = "base-private-identifier";
    let epoch = 4;
    let closes = 0;
    const plugin = {
      app: {},
      getActiveKnowledgeBaseId: () => activeBaseId,
      getDataEpoch: () => epoch,
    };
    const modal = new SyncRecoveryCenterModal(plugin as never) as unknown as {
      openedBaseId: string;
      openedDataEpoch: number;
      staleNoticeShown: boolean;
      close(): void;
      guardOpenedBase(): boolean;
    };
    modal.openedBaseId = activeBaseId;
    modal.openedDataEpoch = epoch;
    modal.staleNoticeShown = false;
    modal.close = () => { closes += 1; };
    if (mode === "base") activeBaseId = "/Users/private/other-base";
    else epoch += 1;
    assert.equal(modal.guardOpenedBase(), false);
    assert.equal(modal.guardOpenedBase(), false);
    assert.equal(closes, 2);
  }
  assert.equal(Notice.messages.length, 2);
  assert.ok(Notice.messages.every((message) => !message.includes("base-private-identifier") && !message.includes("/Users/private")));
});

test("modal renders read-only local facts in its owner document with accessible fixed actions", () => {
  const dom = createFakeDom();
  let ownerWindowTimers = 0;
  const originalSetTimeout = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (callback, delay) => {
    ownerWindowTimers += 1;
    return originalSetTimeout(callback, delay);
  };
  const sensitive = "/Users/private/vault/base-secret";
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base-secret",
    getDataEpoch: () => 1,
    getSyncRecoveryCenterSnapshot: () => snapshot({
      activeBaseName: "Active knowledge base (path-like name hidden)",
      readOnly: true,
      readOnlyReason: "The stored plugin data is newer than this build, so this build will not overwrite it.",
      stickyUntilRestart: true,
      activeBaseConcurrentEditAt: Date.now(),
      activeBaseConcurrentEditCount: 1,
    }),
  };
  const modal = new SyncRecoveryCenterModal(plugin as never) as SyncRecoveryCenterModal & {
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
  };
  modal.modalEl = asHtmlElement(dom.document.body.createDiv());
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  modal.onOpen();

  const scroll = modal.contentEl.querySelector(".ent-cc-sync-recovery-scroll");
  const actions = modal.contentEl.querySelector(".ent-cc-sync-recovery-actions");
  assert.ok(scroll);
  assert.ok(actions);
  assert.equal(scroll.ownerDocument, dom.document as unknown as Document);
  assert.equal(actions.ownerDocument, dom.document as unknown as Document);
  assert.equal(scroll.getAttribute("role"), "region");
  assert.equal(actions.querySelectorAll('button[type="button"]').length, 3);
  assert.equal(ownerWindowTimers, 0, "initial modal context is not skipped by footer autofocus");
  assert.equal(dom.document.activeElement, null);
  assert.match(modal.contentEl.textContent ?? "", /Protected read-only/);
  assert.doesNotMatch(modal.contentEl.textContent ?? "", new RegExp(sensitive.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));

  const recheck = actions.querySelector('button[type="button"]');
  assert.ok(recheck);
  recheck.click();
  assert.equal(ownerWindowTimers, 2, "Recheck announcement and focus restoration use the modal owner window");
  assert.equal(dom.document.activeElement?.textContent, "Recheck local facts");
  const announcement = modal.contentEl.querySelector(".ent-cc-sync-recovery-recheck-status");
  assert.equal(announcement?.getAttribute("role"), "status");
  assert.equal(announcement?.getAttribute("aria-live"), "polite");
  assert.equal(announcement?.textContent, "Local facts rechecked.");
  assert.match(actions.textContent ?? "", /Clear device-local data…/u);
});

test("recheck attaches an empty live region before announcing and clears pending owner-window timers", () => {
  const dom = createFakeDom();
  let nextTimer = 1;
  const pending = new Map<number, () => void>();
  dom.window.setTimeout = (callback) => {
    const id = nextTimer;
    nextTimer += 1;
    if (typeof callback === "function") pending.set(id, callback as () => void);
    return id;
  };
  dom.window.clearTimeout = (id) => { pending.delete(id); };
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base",
    getDataEpoch: () => 1,
    getSyncRecoveryCenterSnapshot: () => snapshot(),
  };
  const modal = new SyncRecoveryCenterModal(plugin as never) as SyncRecoveryCenterModal & {
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
  };
  modal.modalEl = asHtmlElement(dom.document.body.createDiv());
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  modal.onOpen();
  const recheck = modal.contentEl.querySelector<HTMLButtonElement>(".ent-cc-sync-recovery-actions button");
  assert.ok(recheck);
  recheck.click();
  const live = modal.contentEl.querySelector(".ent-cc-sync-recovery-recheck-status");
  assert.equal(live?.textContent, "", "the attached live region starts empty");
  assert.equal(pending.size, 2);
  for (const callback of [...pending.values()]) callback();
  pending.clear();
  assert.equal(live?.textContent, "Local facts rechecked.");
  assert.equal(dom.document.activeElement?.textContent, "Recheck local facts");

  recheck.click();
  assert.equal(pending.size, 2);
  modal.onClose();
  assert.equal(pending.size, 0);
});

test("Sync and Recovery UI is bounded, has one scroll owner, and keeps mobile actions touch-sized", () => {
  const modalSource = readFileSync(new URL("../src/sync-recovery-modal.ts", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const managerSource = readFileSync(new URL("../src/index-manager.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const scrollOwners = [...styles.matchAll(/\.ent-cc-sync-recovery[^{]*\{[^}]*overflow-y:\s*auto/gs)];

  assert.equal(scrollOwners.length, 1);
  assert.match(styles, /\.ent-cc-sync-recovery-actions \.ent-cc-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.ent-cc-sync-recovery-modal\s*\{[^}]*100dvh/s);
  assert.match(modalSource, /ownerDocument\.defaultView/);
  assert.match(modalSource, /role: "region"/);
  assert.doesNotMatch(modalSource, /getMarkdownFiles|cachedRead|vault\.read/);
  assert.match(mainSource, /id: "open-sync-recovery-center"/);
  assert.match(managerSource, /Sync & Recovery Center…/);
});

test("device-local clear disclosure includes path-bearing rename and return history", () => {
  const dom = createFakeDom();
  const modal = new ClearDeviceLocalDataModal({ app: {} } as never) as ClearDeviceLocalDataModal & {
    contentEl: HTMLElement;
    titleEl: HTMLElement;
  };
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  modal.onOpen();
  const disclosure = modal.contentEl.textContent ?? "";
  assert.match(disclosure, /pending vault-rename recovery journal/iu);
  assert.match(disclosure, /vault identity[^.]*old\/new vault-relative paths/iu);
  assert.match(disclosure, /note-bound return destinations/iu);
  assert.match(disclosure, /up to 24 opened-note paths/iu);
  assert.match(disclosure, /does not copy note bodies[^.]*search text can itself be sensitive/iu);
  assert.match(disclosure, /Neither local value syncs/iu);
  assert.match(disclosure, /Synced knowledge-base organization[^.]*not changed/iu);
});

test("diagnostic failure logs omit thrown identifiers and paths", async () => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const priorWarn = console.warn;
  const priorError = console.error;
  console.warn = (...values: unknown[]) => { warnings.push(values.map(String).join(" ")); };
  console.error = (...values: unknown[]) => { errors.push(values.map(String).join(" ")); };
  try {
    const app = {
      vault: { configDir: ".obsidian" },
      loadLocalStorage: (): never => { throw new Error("/Users/private/vault base-secret"); },
      saveLocalStorage: () => {},
    };
    const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
    const internal = plugin as unknown as {
      loadSyncRecoveryLocalState(): void;
      writeConflictRescueStore(store: PluginStore, reason: string): Promise<string>;
    };
    internal.loadSyncRecoveryLocalState();
    plugin.writePortableJson = async (): Promise<never> => { throw new Error("/Users/private/export base-secret"); };
    const rescue = await internal.writeConflictRescueStore(
      createDefaultStore(migrateData(null), 1, "vault-secret-identifier"),
      "private reason",
    );
    assert.equal(rescue, "");
  } finally {
    console.warn = priorWarn;
    console.error = priorError;
  }
  const output = [...warnings, ...errors].join("\n");
  assert.doesNotMatch(output, /\/Users\/private|base-secret|vault-secret-identifier/iu);
});
