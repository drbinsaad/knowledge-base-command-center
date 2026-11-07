import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import {
  RECOVERY_COPY_CONFLICT_RESCUE_KIND,
  createRecoveryRestoreIntent,
  parseRecoveryCopy,
  type RecoveryRestoreIntent,
} from "../src/recovery-copy.ts";
import {
  ENT_CLINICAL_SETTINGS,
  MAX_KNOWLEDGE_BASES,
  cloneJsonValue,
  createDefaultStore,
  createKnowledgeBaseEntry,
  migrateData,
  snapshotPersonal,
  type PluginStore,
} from "../src/model.ts";
import { Notice } from "./support/obsidian-stub.ts";

// A06 restore hook. Synthetic data only; no vault files are read or written.
const VAULT = "vault-restore-synthetic";
const NOW = Date.now();

interface Fixture {
  plugin: EntVaultCommandCenterPlugin;
  disk: () => PluginStore;
  writes: () => number;
  failSaves: (mode: "none" | "first" | "all") => void;
}

async function fixture(extra?: (store: PluginStore) => void): Promise<Fixture> {
  const data = migrateData(null);
  data.settings.workspaceName = "Primary";
  let disk = createDefaultStore(data, 100, VAULT);
  extra?.(disk);
  const vault = {
    configDir: ".obsidian",
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    adapter: { exists: async () => false },
  };
  const app = {
    vault,
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  let writes = 0;
  let mode: "none" | "first" | "all" = "none";
  let failed = 0;
  plugin.loadData = async () => structuredClone(disk);
  plugin.saveData = async (value: unknown) => {
    if (mode === "all" || (mode === "first" && failed === 0)) {
      failed += 1;
      throw new Error("simulated save failure");
    }
    writes += 1;
    disk = structuredClone(value) as PluginStore;
  };
  await plugin.loadPluginData(false);
  writes = 0;
  return { plugin, disk: () => disk, writes: () => writes, failSaves: (value) => { mode = value; failed = 0; } };
}

function sourceStore(name: string, ent = false): PluginStore {
  const data = migrateData(null);
  if (ent) data.settings = cloneJsonValue(ENT_CLINICAL_SETTINGS);
  data.settings.workspaceName = name;
  data.pinnedPaths = ["Synthetic/a.md"];
  data.layoutSnapshots = [snapshotPersonal(data, "Named")];
  data.undoStack = [snapshotPersonal(data, "Undo me")];
  return createDefaultStore(data, NOW - 1000, VAULT);
}

function intentFor(store: PluginStore, existingNames: string[] = ["Primary"], baseId = "base-restored-1"): RecoveryRestoreIntent {
  const text = JSON.stringify({ kind: RECOVERY_COPY_CONFLICT_RESCUE_KIND, version: 1, exportedAt: new Date(NOW - 5000).toISOString(), store });
  const parsed = parseRecoveryCopy({ content: text, currentVaultId: VAULT, now: NOW });
  assert.ok(parsed.ok, "synthetic copy parses");
  if (!parsed.ok) throw new Error("unreachable");
  const made = createRecoveryRestoreIntent({
    parsed, selectedBaseId: parsed.store.bases[0].id, existingNames, existingBaseIds: ["base-default"],
    generateIdentity: () => ({ baseId, semanticHead: "0123456789abcdef" }), now: NOW,
  });
  assert.ok(made.ok);
  if (!made.ok) throw new Error("unreachable");
  return made.intent;
}

const yes = async (): Promise<boolean> => true;

test("a restore appends one new base with the exact new identity and changes nothing else", async () => {
  const f = await fixture();
  const before = cloneJsonValue(f.plugin.getKnowledgeBases(true).map((entry) => entry.data));
  const activeBefore = f.plugin.getActiveKnowledgeBaseId();
  const intent = intentFor(sourceStore("Recovered"));
  Notice.messages.length = 0;
  const result = await f.plugin.restoreKeptCopy(intent, yes);
  assert.deepEqual(result, { status: "applied", baseId: "base-restored-1" });
  const bases = f.plugin.getKnowledgeBases(true);
  assert.equal(bases.length, 2);
  const restored = bases.find((entry) => entry.id === "base-restored-1");
  assert.ok(restored);
  assert.equal(restored.data.settings.workspaceName, "Recovered (restored)");
  assert.equal(restored.semanticHead, "0123456789abcdef");
  assert.deepEqual(restored.data.undoStack, []);
  assert.deepEqual(restored.data.redoStack, []);
  assert.deepEqual(restored.data.pinnedPaths, ["Synthetic/a.md"]);
  assert.equal(restored.data.layoutSnapshots.length, 1, "named snapshots are kept");
  assert.equal(f.plugin.getActiveKnowledgeBaseId(), activeBefore, "the active base is unchanged");
  assert.deepEqual(bases.filter((entry) => entry.id !== "base-restored-1").map((entry) => entry.data), before, "the original base is unchanged");
  assert.equal(f.disk().bases.some((entry) => entry.id === "base-restored-1"), true, "the new base reached the primary");
  assert.equal(f.disk().activeBaseId, activeBefore);
  assert.match(Notice.messages.join("\n"), /Restored “Recovered \(restored\)” as a new knowledge base/);
});

test("Generic and ENT presets are kept as in the source", async () => {
  const generic = await fixture();
  assert.equal((await generic.plugin.restoreKeptCopy(intentFor(sourceStore("G")), yes)).status, "applied");
  assert.equal(generic.plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-restored-1")?.data.settings.workspaceMode, "generic");
  const ent = await fixture();
  assert.equal((await ent.plugin.restoreKeptCopy(intentFor(sourceStore("E", true)), yes)).status, "applied");
  assert.equal(ent.plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-restored-1")?.data.settings.workspaceMode, "ent-clinical");
  assert.equal(ent.plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.data.settings.workspaceMode, "generic");
});

test("a source that changed, vanished or cannot be read blocks the restore before any write", async () => {
  for (const sourceMatches of [async () => false, async (): Promise<boolean> => { throw new Error("gone"); }]) {
    const f = await fixture();
    Notice.messages.length = 0;
    const result = await f.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), sourceMatches);
    assert.equal(result.status, "failed");
    assert.equal(f.writes(), 0);
    assert.equal(f.plugin.getKnowledgeBases(true).length, 1);
    assert.match(Notice.messages.join("\n"), /changed or is no longer available/);
  }
});

test("read-only data refuses the restore without rereading the source", async () => {
  const f = await fixture();
  (f.plugin as unknown as { dataCompatibilityWarning: string }).dataCompatibilityWarning = "Protected for this synthetic test.";
  let reread = 0;
  const result = await f.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), async () => { reread += 1; return true; });
  assert.equal(result.status, "failed");
  assert.equal(reread, 0);
  assert.equal(f.writes(), 0);
});

test("a destination, vault or base switch during the source reread invalidates the restore", async () => {
  const epoch = await fixture();
  const switched = await epoch.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), async () => {
    (epoch.plugin as unknown as { dataEpoch: number }).dataEpoch += 1;
    return true;
  });
  assert.equal(switched.status, "failed");
  assert.equal(epoch.writes(), 0);
  const vault = await fixture();
  const other = await vault.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), async () => {
    (vault.plugin as unknown as { store: PluginStore }).store.vaultId = "vault-someone-else";
    return true;
  });
  assert.equal(other.status, "failed");
  assert.equal(vault.writes(), 0);
});

test("a same-name or capacity race after the preview is refused", async () => {
  const name = await fixture();
  const intent = intentFor(sourceStore("Recovered"));
  const raced = await name.plugin.restoreKeptCopy(intent, async () => {
    // Another base takes the name without changing the data epoch.
    const taker = createKnowledgeBaseEntry(migrateData(null), "base-name-taker", NOW);
    taker.data.settings.workspaceName = "Recovered (restored)";
    (name.plugin as unknown as { store: PluginStore }).store.bases.push(taker);
    return true;
  });
  assert.equal(raced.status, "failed");
  assert.equal(name.plugin.getKnowledgeBases(true).filter((entry) => entry.data.settings.workspaceName === "Recovered (restored)").length, 1);
  assert.equal(name.plugin.getKnowledgeBases(true).some((entry) => entry.id === "base-restored-1"), false);

  const capacity = await fixture();
  const full = await capacity.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), async () => {
    const store = (capacity.plugin as unknown as { store: PluginStore }).store;
    while (store.bases.length < MAX_KNOWLEDGE_BASES) {
      const filler = createKnowledgeBaseEntry(migrateData(null), `filler-${store.bases.length}`, NOW);
      filler.archivedAt = NOW; // archived bases count toward the limit
      store.bases.push(filler);
    }
    return true;
  });
  assert.equal(full.status, "failed");
  assert.match(full.status === "failed" ? full.message : "", /maximum of 50 knowledge bases, including archived/);
  assert.equal(capacity.plugin.getKnowledgeBases(true).some((entry) => entry.id === "base-restored-1"), false);
});

test("a taken base id is refused", async () => {
  const f = await fixture();
  // The intent builder already refuses this; the hook must too if an intent is stale or forged.
  const intent = intentFor(sourceStore("Recovered"));
  const taken = { ...intent, newBaseId: "base-default", entry: { ...intent.entry, id: "base-default" } };
  const result = await f.plugin.restoreKeptCopy(taken, yes);
  assert.equal(result.status, "failed");
  assert.equal(f.writes(), 0);
});

test("a rejected write rolls back and reports failure; an unrecoverable one reports uncertain", async () => {
  const rejected = await fixture();
  rejected.failSaves("first");
  Notice.messages.length = 0;
  const failed = await rejected.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), yes);
  assert.equal(failed.status, "failed");
  assert.equal(rejected.plugin.getKnowledgeBases(true).some((entry) => entry.id === "base-restored-1"), false);
  assert.equal(rejected.plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.match(Notice.messages.join("\n"), /could not be saved\. Nothing was changed/);

  const uncertain = await fixture();
  uncertain.failSaves("all");
  Notice.messages.length = 0;
  const unsure = await uncertain.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), yes);
  assert.equal(unsure.status, "uncertain");
  assert.equal(uncertain.plugin.isDataReadOnly(), true);
  assert.match(Notice.messages.join("\n"), /Check Manage knowledge bases/);
});

test("the outcome is surfaced by the plugin even when the caller discarded the result", async () => {
  const f = await fixture();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  Notice.messages.length = 0;
  const pending = f.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), async () => { await gate; return true; });
  // The review window was closed here: nobody awaits or reads the result.
  release();
  await pending;
  assert.match(Notice.messages.join("\n"), /Restored “Recovered \(restored\)”/);
});

test("opening the restored base is a separate action and the restore never switches", async () => {
  const f = await fixture();
  await f.plugin.restoreKeptCopy(intentFor(sourceStore("Recovered")), yes);
  assert.equal(f.plugin.getActiveKnowledgeBaseId(), "base-default");
  await f.plugin.openRestoredKeptBase("base-restored-1");
  assert.equal(f.plugin.getActiveKnowledgeBaseId(), "base-restored-1");
  Notice.messages.length = 0;
  await f.plugin.openRestoredKeptBase("base-does-not-exist");
  assert.match(Notice.messages.join("\n"), /could not be opened/);
  assert.equal(f.plugin.getActiveKnowledgeBaseId(), "base-restored-1");
});
