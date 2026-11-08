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
  createDefaultStore,
  createKnowledgeBaseEntry,
  migrateData,
  type PluginStore,
} from "../src/model.ts";

// D07. Synthetic data only. A base change that waits in the logical queue must
// not run (or report success) if read-only protection is set while it waits.

const VAULT = "vault-d07-synthetic";
const NOW = Date.now();

interface Fixture {
  plugin: EntVaultCommandCenterPlugin;
  disk: () => PluginStore;
  writes: () => number;
}

async function fixture(extra?: (store: PluginStore) => void): Promise<Fixture> {
  const data = migrateData(null);
  data.settings.workspaceName = "Primary";
  let disk = createDefaultStore(data, 100, VAULT);
  extra?.(disk);
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      adapter: { exists: async () => false },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  let writes = 0;
  plugin.loadData = async () => structuredClone(disk);
  plugin.saveData = async (value: unknown) => {
    writes += 1;
    disk = structuredClone(value) as PluginStore;
  };
  await plugin.loadPluginData(false);
  writes = 0;
  return { plugin, disk: () => disk, writes: () => writes };
}

type Internals = {
  baseOperationBusy: boolean;
  dataCompatibilityWarning: string;
  enqueueAppLogicalOperation(operation: () => Promise<void>): Promise<void>;
  settingsTab: { prepareForKnowledgeBaseChange(): Promise<boolean> } | null;
};

/** Hold the real shared logical-operation queue open. */
async function hold(plugin: EntVaultCommandCenterPlugin): Promise<{ release(): void; done: Promise<void> }> {
  const internal = plugin as unknown as Internals;
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const done = internal.enqueueAppLogicalOperation(async () => { entered(); await gate; });
  await enteredPromise;
  return { release, done };
}

function storeOf(plugin: EntVaultCommandCenterPlugin): PluginStore {
  return (plugin as unknown as { store: PluginStore }).store;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function protect(plugin: EntVaultCommandCenterPlugin, message = "Synthetic protected state arrived while queued"): void {
  (plugin as unknown as Internals).dataCompatibilityWarning = message;
}

test("D07 red race: a queued create refuses when protection is set while it waits", async () => {
  const f = await fixture();
  const memory = JSON.stringify(storeOf(f.plugin));
  const disk = JSON.stringify(f.disk());
  const active = f.plugin.getActiveKnowledgeBaseId();
  const gate = await hold(f.plugin);
  const pending = f.plugin.createKnowledgeBase("Queued new base", "generic", "Synthetic");
  await tick();
  assert.equal((f.plugin as unknown as Internals).baseOperationBusy, true);
  protect(f.plugin);
  gate.release();
  await gate.done;
  await assert.rejects(pending, /protected state arrived while queued/);
  assert.equal(JSON.stringify(storeOf(f.plugin)), memory, "memory is unchanged");
  assert.equal(JSON.stringify(f.disk()), disk, "disk is unchanged");
  assert.equal(f.writes(), 0);
  assert.equal(f.plugin.getActiveKnowledgeBaseId(), active);
  assert.equal((f.plugin as unknown as Internals).baseOperationBusy, false);
});

test("D07 control: an unchanged queued create persists once and returns the persisted active base", async () => {
  const f = await fixture();
  const gate = await hold(f.plugin);
  const pending = f.plugin.createKnowledgeBase("Valid new base", "generic", "Synthetic");
  await tick();
  gate.release();
  await gate.done;
  const entry = await pending;
  assert.equal(f.writes(), 1);
  assert.equal(storeOf(f.plugin).bases.length, 2);
  assert.equal(f.disk().bases.length, 2);
  assert.equal(f.plugin.getActiveKnowledgeBaseId(), entry.id);
  assert.equal(f.plugin.isDataReadOnly(), false);
  assert.equal((f.plugin as unknown as Internals).baseOperationBusy, false);
});

test("D07 control: an already read-only create refuses before the settings flush", async () => {
  const f = await fixture();
  let flushes = 0;
  (f.plugin as unknown as Internals).settingsTab = { prepareForKnowledgeBaseChange: async () => { flushes += 1; return true; } };
  const memory = JSON.stringify(storeOf(f.plugin));
  protect(f.plugin, "Synthetic protected state at entry");
  await assert.rejects(f.plugin.createKnowledgeBase("Rejected at entry", "generic", "Synthetic"), /protected state at entry/);
  assert.equal(flushes, 0);
  assert.equal(JSON.stringify(storeOf(f.plugin)), memory);
  assert.equal(f.writes(), 0);
});

test("D07 control: a rejected settings convergence writes nothing", async () => {
  const f = await fixture();
  (f.plugin as unknown as Internals).settingsTab = { prepareForKnowledgeBaseChange: async () => false };
  const memory = JSON.stringify(storeOf(f.plugin));
  const disk = JSON.stringify(f.disk());
  await assert.rejects(f.plugin.createKnowledgeBase("Rejected settings", "generic", "Synthetic"), /Save or restore the pending settings/);
  assert.equal(JSON.stringify(storeOf(f.plugin)), memory);
  assert.equal(JSON.stringify(f.disk()), disk);
  assert.equal(f.writes(), 0);
});

test("D07: a refused queued change unlocks the queue so a later operation still runs", async () => {
  const f = await fixture();
  const gate = await hold(f.plugin);
  const pending = f.plugin.createKnowledgeBase("Will be refused", "generic", "Synthetic");
  await tick();
  protect(f.plugin);
  gate.release();
  await gate.done;
  await assert.rejects(pending);
  (f.plugin as unknown as Internals).dataCompatibilityWarning = "";
  const later = await f.plugin.createKnowledgeBase("Runs afterwards", "generic", "Synthetic");
  assert.equal(f.writes(), 1);
  assert.equal(f.disk().bases.some((entry) => entry.id === later.id), true);
});

test("D07: duplicate and archive refuse under the same race", async () => {
  const f = await fixture((store) => {
    const second = createKnowledgeBaseEntry(migrateData(null), "base-second", 200);
    second.data.settings.workspaceName = "Second";
    store.bases.push(second);
  });
  const memory = JSON.stringify(storeOf(f.plugin));
  const disk = JSON.stringify(f.disk());
  const base = f.plugin.getActiveKnowledgeBaseId();
  for (const run of [
    () => f.plugin.duplicateKnowledgeBase(base, "Duplicate copy"),
    () => f.plugin.archiveKnowledgeBase("base-second"),
  ]) {
    const gate = await hold(f.plugin);
    const pending = run();
    await tick();
    protect(f.plugin);
    gate.release();
    await gate.done;
    await assert.rejects(pending, /protected state arrived while queued/);
    (f.plugin as unknown as Internals).dataCompatibilityWarning = "";
    assert.equal(JSON.stringify(storeOf(f.plugin)), memory);
    assert.equal(JSON.stringify(f.disk()), disk);
    assert.equal(f.writes(), 0);
  }
});

function restoreIntent(): RecoveryRestoreIntent {
  const data = migrateData(null);
  data.settings.workspaceName = "Recovered";
  const store = createDefaultStore(data, NOW - 1000, VAULT);
  const text = JSON.stringify({ kind: RECOVERY_COPY_CONFLICT_RESCUE_KIND, version: 1, exportedAt: new Date(NOW - 5000).toISOString(), store });
  const parsed = parseRecoveryCopy({ content: text, currentVaultId: VAULT, now: NOW });
  assert.ok(parsed.ok);
  if (!parsed.ok) throw new Error("unreachable");
  const made = createRecoveryRestoreIntent({
    parsed, selectedBaseId: parsed.store.bases[0].id, existingNames: ["Primary"], existingBaseIds: ["base-default"],
    generateIdentity: () => ({ baseId: "base-d07-restored", semanticHead: "0123456789abcdef" }), now: NOW,
  });
  assert.ok(made.ok);
  if (!made.ok) throw new Error("unreachable");
  return made.intent;
}

test("D07: read-only set after the restore source check refuses with never-ran semantics", async () => {
  const f = await fixture();
  const memory = JSON.stringify(storeOf(f.plugin));
  const result = await f.plugin.restoreKeptCopy(restoreIntent(), async () => {
    protect(f.plugin, "Protection arrived after the source check");
    return true;
  });
  assert.equal(result.status, "failed");
  assert.match((result as { message: string }).message, /read-only/);
  assert.equal(JSON.stringify(storeOf(f.plugin)), memory);
  assert.equal(f.writes(), 0);
  assert.equal(f.disk().bases.length, 1);
});
