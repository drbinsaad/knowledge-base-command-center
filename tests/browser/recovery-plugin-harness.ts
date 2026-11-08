import { Notice, Platform } from "obsidian";
import * as obsidianHost from "obsidian";
import { TFile, TestHarnessError } from "./obsidian-browser";

// One constructor for the harness and for production code behind the "obsidian" alias.
if (!Object.is(obsidianHost.TFile, TFile)) {
  throw new TestHarnessError("Browser harness TFile differs from the obsidian alias TFile");
}
import EntVaultCommandCenterPlugin from "../../src/main";
import { RECOVERY_COPY_CONFLICT_RESCUE_KIND } from "../../src/recovery-copy";
import { createDefaultStore, migrateData, type PluginStore } from "../../src/model";
import { SyncRecoveryCenterModal } from "../../src/sync-recovery-modal";

// The REAL EntVaultCommandCenterPlugin (src/main.ts, bundled as-is) over an in-memory vault,
// adapter and data.json. Nothing here re-implements the entry, the discovery, the
// restore hook or the open action. Only the host is synthetic: byte-level files, a disk copy
// of data.json, and Obsidian's UI classes from the browser stub.
const parameters = new URLSearchParams(location.hash.slice(1));
Platform.isMobile = parameters.get("mobile") === "true";
const VAULT = "vault-real-recovery";
const EXPORTS = "Private Exports";
const PLUGIN_DIR = ".obsidian/plugins/synthetic-plugin";
const RESCUE = `${EXPORTS}/knowledge-base-command-center-conflict-2026-11-02T10-00-00-000Z.json`;
const KEPT = `${PLUGIN_DIR}/data.json.bak-kept-2026-11-01T10-00-00-000Z`;
const LONG_NAME = "A very long recovered knowledge base name that must wrap or truncate without scrolling sideways on a phone";

const encoder = new TextEncoder();
const files = new Map<string, string>();
const mtimes = new Map<string, number>();
const setFile = (path: string, text: string, age: number): void => { files.set(path, text); mtimes.set(path, Date.now() - age * 86_400_000); };

function sourceStore(name: string): PluginStore {
  const data = migrateData(null);
  data.settings.workspaceName = name;
  data.pinnedPaths = ["Synthetic/a.md", "Synthetic/b.md"];
  return createDefaultStore(data, Date.now() - 1000, VAULT);
}

setFile(RESCUE, JSON.stringify({
  kind: RECOVERY_COPY_CONFLICT_RESCUE_KIND, version: 1, exportedAt: new Date(Date.now() - 60_000).toISOString(),
  reason: "synthetic", privacy: "synthetic", store: sourceStore(LONG_NAME),
}), 1);
setFile(KEPT, JSON.stringify(sourceStore("Kept backup base")), 2);

const primary = migrateData(null);
primary.settings.workspaceName = "Research workspace";
primary.settings.exportsFolder = EXPORTS; // a configured Exports folder, as a user may have set
let disk: PluginStore = createDefaultStore(primary, 100, VAULT);
const initialDisk = JSON.stringify(disk);
setFile(`${PLUGIN_DIR}/data.json`, initialDisk, 0);
const initialSources = new Map([[RESCUE, files.get(RESCUE) ?? ""], [KEPT, files.get(KEPT) ?? ""]]);
const initialActive = disk.activeBaseId;
let diskWrites = 0;

const adapter = {
  exists: async (path: string) => files.has(path) || path === PLUGIN_DIR || path === EXPORTS,
  write: async (path: string, text: string) => { files.set(path, text); mtimes.set(path, Date.now()); },
  read: async (path: string) => { const text = files.get(path); if (text === undefined) throw new Error("ENOENT"); return text; },
  remove: async (path: string) => { files.delete(path); },
  rename: async (from: string, to: string) => { const text = files.get(from); if (text !== undefined) { files.set(to, text); files.delete(from); } },
  list: async (folder: string) => {
    const prefix = `${folder}/`;
    const found = [...files.keys()].filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"));
    if (found.length === 0 && folder !== PLUGIN_DIR) throw new Error("ENOENT");
    return { files: found, folders: [] };
  },
  stat: async (path: string) => {
    const text = files.get(path);
    return text === undefined ? null : { type: "file", ctime: 0, mtime: mtimes.get(path) ?? 0, size: encoder.encode(text).length };
  },
  readBinary: async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error("ENOENT");
    return encoder.encode(text).buffer;
  },
};
const vaultFiles = [...files.keys()].filter((path) => path.endsWith(".json") && !path.startsWith(PLUGIN_DIR)).map((path) => new TFile(path));
const app = {
  vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getFiles: () => vaultFiles, getAbstractFileByPath: () => null, adapter },
  workspace: { getLeavesOfType: () => [] },
  metadataCache: { getFileCache: () => null },
  fileManager: {},
  loadLocalStorage: () => null,
  saveLocalStorage: () => undefined,
};

const plugin = new EntVaultCommandCenterPlugin(app as never, { id: "synthetic-plugin", dir: PLUGIN_DIR } as never);
plugin.loadData = async () => structuredClone(disk);
plugin.saveData = async (value: unknown) => {
  diskWrites += 1;
  disk = structuredClone(value) as PluginStore;
  files.set(`${PLUGIN_DIR}/data.json`, JSON.stringify(disk));
};

const notices: string[] = [];
const noticeSink = Notice as unknown as { messages: string[] };

export interface RealRecoveryHarness {
  ready: boolean;
  openCenter(): void;
  forceReadOnly(): void;
  state(): {
    activeBaseId: string; baseNames: string[]; diskBaseNames: string[]; diskActiveBaseId: string; diskWrites: number;
    sourcesUnchanged: boolean; diskBeforeRestore: boolean; readOnly: boolean; notices: string[]; restoredIds: string[];
  };
}

let center: SyncRecoveryCenterModal | null = null;
const api: RealRecoveryHarness = {
  ready: false,
  // The same class the "Check sync and backup status" command opens.
  openCenter() { center?.close(); center = new SyncRecoveryCenterModal(plugin); center.open(); },
  forceReadOnly() { (plugin as unknown as { dataCompatibilityWarning: string }).dataCompatibilityWarning = "Protected for this synthetic test."; },
  state() {
    notices.splice(0, notices.length, ...noticeSink.messages);
    return {
      activeBaseId: plugin.getActiveKnowledgeBaseId(),
      baseNames: plugin.getKnowledgeBases(true).map((entry) => entry.data.settings.workspaceName),
      diskBaseNames: disk.bases.map((entry) => entry.data.settings.workspaceName),
      diskActiveBaseId: disk.activeBaseId,
      diskWrites,
      sourcesUnchanged: [...initialSources].every(([path, text]) => files.get(path) === text),
      diskBeforeRestore: JSON.stringify(disk) === initialDisk && disk.activeBaseId === initialActive,
      readOnly: plugin.isDataReadOnly(),
      notices: [...notices],
      restoredIds: disk.bases.map((entry) => entry.id).filter((id) => id !== initialActive),
    };
  },
};
(window as unknown as { kbccRealRecoveryHarness: RealRecoveryHarness }).kbccRealRecoveryHarness = api;
void plugin.loadPluginData(false).then(() => { diskWrites = 0; api.ready = true; });
