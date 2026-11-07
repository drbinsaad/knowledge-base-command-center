import { Platform } from "obsidian";
import * as obsidianHost from "obsidian";
import { TFile, TestHarnessError } from "./obsidian-browser";

// One constructor for the harness and for production code behind the "obsidian" alias.
if (!Object.is(obsidianHost.TFile, TFile)) {
  throw new TestHarnessError("Browser harness TFile differs from the obsidian alias TFile");
}
import type EntVaultCommandCenterPlugin from "../../src/main";
import { RecoveryCopyModal, type RecoveryApplyResult, type RecoveryCopyModalCallbacks } from "../../src/recovery-copy-modal";
import { discoverRecoveryCopies, loadRecoveryCopy, recoverySourceUnchanged, type RecoveryCandidate, type RecoveryHost } from "../../src/recovery-discovery";
import { RECOVERY_COPY_CONFLICT_RESCUE_KIND } from "../../src/recovery-copy";
import { createDefaultStore, fingerprintText, migrateData } from "../../src/model";
import { SyncRecoveryCenterModal } from "../../src/sync-recovery-modal";

// The REAL Sync & recovery center, discovery, parser and review window, driven over an
// in-memory vault. The persistence hook (src/main.ts restoreKeptCopy) is not bundled here;
// it is covered by the runtime tests, so onApply below only records the intent it receives.
const parameters = new URLSearchParams(location.hash.slice(1));
Platform.isMobile = parameters.get("mobile") === "true";
const readOnly = parameters.get("readonly") === "true";
const VAULT = "vault-browser-recovery";
const EXPORTS = "Private Exports";
const PLUGIN_DIR = ".obsidian/plugins/synthetic-plugin";
const LONG_NAME = "A very long recovered knowledge base name that must wrap or truncate without scrolling sideways on a phone";

function storeText(name: string, vaultId = VAULT): string {
  const data = migrateData(null);
  data.settings.workspaceName = name;
  data.pinnedPaths = ["Synthetic/a.md", "Synthetic/b.md"];
  return JSON.stringify(createDefaultStore(data, Date.now() - 1000, vaultId));
}

const rescue = JSON.stringify({
  kind: RECOVERY_COPY_CONFLICT_RESCUE_KIND, version: 1, exportedAt: new Date(Date.now() - 60_000).toISOString(),
  reason: "synthetic", privacy: "synthetic", store: JSON.parse(storeText(LONG_NAME)),
});
const files = new Map<string, string>([
  [`${EXPORTS}/knowledge-base-command-center-conflict-2026-11-02T10-00-00-000Z.json`, rescue],
  [`${PLUGIN_DIR}/data.json.bak-kept-2026-11-01T10-00-00-000Z`, storeText("Kept backup base")],
  [`${PLUGIN_DIR}/data.json.bak-kept-2026-10-01T10-00-00-000Z`, "{\"kind\": "],
]);
const mtimes = new Map<string, number>([...files.keys()].map((path, index) => [path, Date.now() - (index + 1) * 86_400_000]));

const host: RecoveryHost = {
  list: async (folder) => {
    const prefix = `${folder}/`;
    const found = [...files.keys()].filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"));
    return found.length > 0 || folder === PLUGIN_DIR ? found : null;
  },
  stat: async (path) => {
    const text = files.get(path);
    return text === undefined ? null : { size: new TextEncoder().encode(text).length, mtime: mtimes.get(path) ?? null };
  },
  read: async (path) => new TextEncoder().encode(files.get(path) ?? ""),
};

const state = {
  names: ["Research workspace"],
  activeId: "base-default",
  restored: [] as Array<{ id: string; name: string; preset: string }>,
  opened: [] as string[],
  applyCalls: 0,
};
let selected: RecoveryCandidate | null = null;

const callbacks: RecoveryCopyModalCallbacks = {
  isReadOnly: () => readOnly,
  getCurrentVaultId: () => VAULT,
  getExistingNames: () => state.names,
  getExistingBaseIds: () => ["base-default", ...state.restored.map((item) => item.id)],
  generateIdentity: () => ({ baseId: `base-restored-${state.restored.length + 1}`, semanticHead: fingerprintText(`head-${state.restored.length}`) }),
  discover: () => discoverRecoveryCopies(host, { exportFolders: [EXPORTS], legacyExportFolder: "Knowledge Base Command Center Exports", pluginDir: PLUGIN_DIR }),
  load: (candidate) => { selected = candidate; return loadRecoveryCopy(host, candidate.path, { currentVaultId: VAULT }); },
  getDestination: () => ({ surface: "synthetic-surface", vaultId: VAULT, activeBaseId: state.activeId }),
  onApply: async (intent): Promise<RecoveryApplyResult> => {
    state.applyCalls += 1;
    if (!selected || !(await recoverySourceUnchanged(host, selected.path, intent))) return { status: "failed", message: "The kept copy changed." };
    state.names.push(intent.name);
    state.restored.push({ id: intent.newBaseId, name: intent.name, preset: intent.preset });
    return { status: "applied", baseId: intent.newBaseId };
  },
  onOpenRestored: (baseId) => { state.opened.push(baseId); state.activeId = baseId; },
};

const app = {};
const plugin = {
  app,
  data: {},
  getActiveKnowledgeBaseId: () => state.activeId,
  getDataEpoch: () => 1,
  getSyncRecoveryCenterSnapshot: () => ({
    activeBaseName: "Research workspace", workspaceProfile: "Generic knowledge base",
    semanticRevision: 7, semanticHeadSummary: "1234abcd…", semanticCommitState: "committed",
    lastLocalSaveAt: Date.now() - 60_000, lastExternalReloadAt: Date.now() - 120_000,
    lastExternalReloadOutcome: "applied", conflictRescueCount: 1,
    conflictRescueCountIsLowerBound: false, artifactInspectionAvailable: true,
    newestConflictRescueAt: Date.now() - 60_000, newestRecoveryExportAt: Date.now() - 3_600_000,
    readOnly, readOnlyReason: readOnly ? "Protected for this synthetic test." : "Writable", stickyUntilRestart: false,
    activeBaseConcurrentEditAt: null, activeBaseConcurrentEditCount: 0,
    deviceProfile: Platform.isMobile ? "Mobile app (synthetic host)" : "Desktop app (synthetic host)",
    configProfile: "Default Obsidian configuration folder",
    deviceLocalStateProfile: "Active-base view profile stored on this device",
  }),
  openRecoveryCopyReview: () => { new RecoveryCopyModal(app as never, callbacks).open(); },
};

export interface RecoveryBrowserHarness {
  ready: boolean;
  openCenter(): void;
  state(): typeof state;
}

let center: SyncRecoveryCenterModal | null = null;
(window as unknown as { kbccRecoveryHarness: RecoveryBrowserHarness }).kbccRecoveryHarness = {
  ready: true,
  openCenter() { center?.close(); center = new SyncRecoveryCenterModal(plugin as unknown as EntVaultCommandCenterPlugin); center.open(); },
  state: () => structuredClone(state),
};
