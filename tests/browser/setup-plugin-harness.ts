import { Platform } from "obsidian";
import { TFile, TFolder } from "./obsidian-browser";
import EntVaultCommandCenterPlugin from "../../src/main";
import { EntVaultCommandCenterView } from "../../src/view";
import { createDefaultStore, migrateData, type PluginStore } from "../../src/model";

// The REAL EntVaultCommandCenterPlugin (src/main.ts, bundled as-is) and the REAL
// view.openSetupWizard route over an in-memory vault and an in-memory data.json
// adapter. Only the host is synthetic: four note files whose paths must never
// change, and a disk copy that records every save. The setup transaction, its
// required-Undo history, the count helper and the wizard are production code.
// No native Obsidian, device or two-device Sync result is implied.
Platform.isMobile = location.hash.includes("mobile=true");
const files = ["source-a", "source-b", "direct", "collection"].map((name) => new TFile(`Old Inbox/${name}.md`));
const folder = new TFolder("Old Inbox");
const local = new Map<string, unknown>();
const forbidden = (): never => { throw new Error("Setup must not mutate vault files"); };
const app = {
  vault: {
    configDir: ".obsidian",
    getMarkdownFiles: () => files,
    getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? (path === "Old Inbox" ? folder : null),
    modify: forbidden, create: forbidden, createFolder: forbidden, process: forbidden, delete: forbidden, rename: forbidden,
  },
  workspace: { getLeavesOfType: () => [] },
  metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
  fileManager: { renameFile: forbidden, processFrontMatter: forbidden },
  loadLocalStorage: (key: string) => structuredClone(local.get(key) ?? null),
  saveLocalStorage: (key: string, value: unknown) => { local.set(key, structuredClone(value)); },
};
const data = migrateData(null);
Object.assign(data.settings, { workspaceMode: "generic", workspaceName: "Research", proposalFolder: "Old Inbox", setupComplete: false });
data.directIndexPaths = ["Old Inbox/direct.md"];
data.collections = [{ id: "reading", title: "Reading", collapsed: false, subjects: ["Old Inbox/collection.md"], subheadings: [] }];
let disk: PluginStore = createDefaultStore(data, 1, "vault-setup-real");
let writes = 0;
const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
plugin.loadData = async () => structuredClone(disk);
plugin.saveData = async (value: unknown) => { disk = structuredClone(value) as PluginStore; writes += 1; };
const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView;

const api = {
  ready: false,
  open(): void {
    Object.assign(view, { plugin, app, loadedBaseId: plugin.getActiveKnowledgeBaseId(), loadedDataEpoch: plugin.getDataEpoch() });
    view.openSetupWizard();
  },
  state() {
    return {
      writes,
      settings: structuredClone(plugin.data.settings),
      diskSettings: structuredClone(disk.bases.find((base) => base.id === disk.activeBaseId)?.data.settings),
      undo: plugin.data.undoStack.length,
      paths: files.map((file) => file.path),
    };
  },
  undo: async (): Promise<void> => { await plugin.undo(); },
  redo: async (): Promise<void> => { await plugin.redo(); },
};
export type RealSetupHarness = typeof api;
(window as unknown as { kbccRealSetupHarness: RealSetupHarness }).kbccRealSetupHarness = api;
void plugin.loadPluginData(false).then(() => { writes = 0; api.ready = true; });
