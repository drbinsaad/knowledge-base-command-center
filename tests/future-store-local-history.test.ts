import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin, { DEVICE_LOCAL_STATE_KEY } from "../src/main.ts";
import {
  boundedSemanticLineage, canonicalJsonString, createDefaultStore, createDeviceHistoryBinding,
  createDeviceLocalPluginState, createDeviceLocalPluginStateWithReport, fingerprintText,
  migrateData, nextSemanticHead, parseDeviceLocalPluginState, resetPluginViewState,
  semanticEntryFingerprint, snapshotPersonal, STORE_VERSION,
  type DeviceLocalPluginState, type PluginStore,
} from "../src/model.ts";
import { asRawVersionDraft } from "./support/legacy-fixtures.ts";
import { Notice } from "./support/obsidian-stub.ts";

function harness(primary: PluginStore, local: DeviceLocalPluginState) {
  Notice.messages.length = 0;
  const values = new Map<string, unknown>([[DEVICE_LOCAL_STATE_KEY, structuredClone(local)]]);
  const writes: Array<[string, unknown]> = [];
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
      writes.push([key, structuredClone(value)]);
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const input = structuredClone(primary);
  const primaryWrites: unknown[] = [];
  plugin.loadData = async () => input;
  plugin.saveData = async value => { primaryWrites.push(structuredClone(value)); };
  return { plugin, input, primaryWrites, values, writes,
    state: () => values.get(DEVICE_LOCAL_STATE_KEY) as DeviceLocalPluginState };
}

function fixture() {
  const data = migrateData(null);
  const beforePin = snapshotPersonal(data, "Undo saved pin");
  beforePin.at = 100;
  data.pinnedPaths = ["Synthetic/First.md"];
  data.undoStack = [beforePin];
  const store = createDefaultStore(data, 100, "vault-future-store-local-history");
  const local = createDeviceLocalPluginState(store);
  assert.equal(local.bases[0]?.view.undoStack.length, 1);
  assert.ok(local.bases[0]?.historyBinding);
  resetPluginViewState(store.bases[0].data);
  return { store, local };
}

function advance(entry: PluginStore["bases"][number]) {
  const parent = entry.semanticHead;
  entry.data.pinnedPaths.push("Synthetic/Second.md");
  entry.semanticRevision += 1;
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = nextSemanticHead(parent, entry.semanticHash);
  entry.semanticLineage = boundedSemanticLineage([parent, ...entry.semanticLineage], entry.semanticHead);
  entry.updatedAt += 1;
}

function pendingFixture() {
  const { store } = fixture();
  const entry = store.bases[0];
  entry.data.undoStack = [snapshotPersonal(entry.data, "Older undo")];
  entry.data.undoStack[0].at = 100;
  const priorBinding = createDeviceHistoryBinding(entry);
  const pendingUndo = snapshotPersonal(entry.data, "Staged pin undo");
  pendingUndo.at = 200;
  const parentSemanticHead = entry.semanticHead;
  advance(entry);
  entry.data.undoStack.push(pendingUndo);
  const pending = {
    baseId: entry.id, parentSemanticHead,
    candidateSemanticRevision: entry.semanticRevision,
    candidateSemanticHead: entry.semanticHead, candidateSemanticHash: entry.semanticHash,
    undoSnapshotAt: pendingUndo.at,
    undoSnapshotFingerprint: fingerprintText(canonicalJsonString(pendingUndo)),
  };
  const local = createDeviceLocalPluginStateWithReport(store, pending, undefined, undefined, {
    historyBindings: new Map([[entry.id, priorBinding]]),
  }).state;
  assert.ok(parseDeviceLocalPluginState(local).pendingRequiredUndoCommit, "a valid current journal is the control");
  resetPluginViewState(entry.data);
  return { store, local };
}

test("supported-store control retains bound Undo without local persistence", async () => {
  const { store, local } = fixture();
  const f = harness(store, local);
  const loaded = await f.plugin.loadPluginData(false);
  assert.equal(loaded.compatible, true);
  assert.deepEqual(f.plugin.data.undoStack.map(snapshot => snapshot.label), ["Undo saved pin"]);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.state(), local);
});

test("future outer store must not reset durable local Undo even with supported inner data", async () => {
  const { store, local } = fixture();
  advance(store.bases[0]);
  asRawVersionDraft(store).version = STORE_VERSION + 1;
  const f = harness(store, local);
  const loaded = await f.plugin.loadPluginData(false);
  assert.equal(loaded.compatible, false);
  assert.equal(f.plugin.isDataReadOnly(), true);
  assert.deepEqual(f.primaryWrites, []);
  assert.deepEqual(f.input, store, "future primary remains untouched");
  assert.deepEqual({ writes: f.writes.length, history: f.state().bases[0].view.undoStack.map(snapshot => snapshot.label) },
    { writes: 0, history: ["Undo saved pin"] }, "read-only future stores cannot erase this device's recovery history");
  assert.deepEqual(f.state(), local);
});

test("supported-store control finalizes a proven pending Undo journal", async () => {
  const { store, local } = pendingFixture();
  const f = harness(store, local);
  const loaded = await f.plugin.loadPluginData(false);
  assert.equal(loaded.compatible, true);
  assert.equal(f.state().pendingRequiredUndoCommit, undefined);
  assert.ok(f.writes.length > 0);
  assert.deepEqual(f.plugin.data.undoStack.map(snapshot => snapshot.label), ["Older undo", "Staged pin undo"]);
});

test("future outer store must not finalize or clear a valid pending Undo journal", async () => {
  const { store, local } = pendingFixture();
  asRawVersionDraft(store).version = STORE_VERSION + 1;
  const f = harness(store, local);
  const loaded = await f.plugin.loadPluginData(false);
  assert.equal(loaded.compatible, false);
  assert.equal(f.plugin.isDataReadOnly(), true);
  assert.deepEqual(f.primaryWrites, []);
  assert.deepEqual(f.input, store);
  assert.deepEqual({ writes: f.writes.length, pending: Boolean(f.state().pendingRequiredUndoCommit) },
    { writes: 0, pending: true }, "unsupported outer data is not authority to finalize local journals");
  assert.deepEqual(f.state(), local);
});

for (const inspectRecovery of [false, true]) {
  test(`a supported Sync follow-up after future startup recovers local Undo${inspectRecovery ? " after Recovery Center inspection" : ""}`, async () => {
    const { store, local } = fixture();
    const future = structuredClone(store);
    advance(future.bases[0]);
    asRawVersionDraft(future).version = STORE_VERSION + 1;
    const f = harness(future, local);
    await f.plugin.loadPluginData(false);
    if (inspectRecovery) {
      const snapshot = f.plugin.getSyncRecoveryCenterSnapshot();
      assert.equal(snapshot.readOnly, true);
      assert.match(snapshot.deviceLocalStateProfile, /profile stored on this device/u);
    }
    f.plugin.loadData = async () => structuredClone(store);
    await f.plugin.onExternalSettingsChange();
    assert.equal(f.plugin.isDataReadOnly(), false, f.plugin.dataCompatibilityWarning);
    assert.deepEqual(f.plugin.data.undoStack.map(snapshot => snapshot.label), ["Undo saved pin"],
      "the unsupported startup view must not replace the untouched stored profile during Sync capture");
    // Supported parsing may materialize optional keys with undefined values;
    // compare the exact durable JSON content rather than those in-memory keys.
    assert.equal(canonicalJsonString(f.state().bases[0].view.undoStack), canonicalJsonString(local.bases[0].view.undoStack));
  });

  test(`a supported Sync follow-up after future startup resolves the pending journal${inspectRecovery ? " after Recovery Center inspection" : ""}`, async () => {
    const { store, local } = pendingFixture();
    const future = structuredClone(store);
    asRawVersionDraft(future).version = STORE_VERSION + 1;
    const f = harness(future, local);
    await f.plugin.loadPluginData(false);
    if (inspectRecovery) assert.equal(f.plugin.getSyncRecoveryCenterSnapshot().readOnly, true);
    const retainedAfterFuture = structuredClone(f.state());
    f.plugin.loadData = async () => structuredClone(store);
    await f.plugin.onExternalSettingsChange();
    assert.equal(f.plugin.isDataReadOnly(), false, f.plugin.dataCompatibilityWarning);
    assert.deepEqual(f.plugin.data.undoStack.map(snapshot => snapshot.label), ["Older undo", "Staged pin undo"]);
    assert.deepEqual(retainedAfterFuture, local, "future startup leaves journal resolution to a supported authority");
    assert.equal(f.state().pendingRequiredUndoCommit, undefined, "supported authority can now finalize the journal");
  });
}
