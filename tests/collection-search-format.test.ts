import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultStore, createDeviceLocalPluginState, createPersonalBackup, createWorkspaceConfig,
  DATA_VERSION, DEVICE_LOCAL_STATE_VERSION, migrateData, migrateStore,
  parseDeviceLocalPluginState, parsePersonalBackup, snapshotPersonal, STORE_VERSION,
  canonicalJsonString, fingerprintText, semanticEntryFingerprint, semanticPluginDataProjection,
} from "../src/model.ts";
import { applyPortableExport, createPortableExport, EMPTY_PORTABLE_SELECTION, parsePortableExport, PORTABLE_EXPORT_VERSION } from "../src/portability.ts";

function scopedData() {
  const data = migrateData(null);
  data.collections = [{ id: "reading", title: "Reading", subjects: [], subheadings: [], collapsed: false }];
  data.savedViews = [{ id: "saved-reading", name: "Reading", tab: "collections", query: "", scope: "collection", collectionId: "reading", availability: "linked", linkedFirst: true }];
  data.layoutSnapshots = [snapshotPersonal(data, "Scoped layout")];
  data.undoStack = [snapshotPersonal(data, "Scoped Undo")];
  return data;
}

test("every persisted Collection-search representation has a barrier against 0.23.1 consumers", () => {
  const data = scopedData();
  const store = createDefaultStore(data, 100, "vault-scoped-format");
  // Published 0.23.1 accepts store/base16, portable6, savedViews1, backup12,
  // and device-local4. Those consumers discard unknown scope/collectionId.
  assert.equal(DATA_VERSION, 17);
  assert.equal(STORE_VERSION, 17);
  assert.equal(store.version, 17);
  assert.equal(store.bases[0].data.version, 17);
  assert.deepEqual(migrateStore(store).bases[0].data.savedViews, data.savedViews);
  const backup = createPersonalBackup(data, "2026-09-19T00:00:00.000Z", store.vaultId, store.activeBaseId, "Test");
  assert.equal(backup.version, 13);
  assert.deepEqual(parsePersonalBackup(backup).savedViews, data.savedViews);
  assert.deepEqual(parsePersonalBackup(backup).layoutSnapshots[0].savedViews, data.savedViews);
  const local = createDeviceLocalPluginState(store);
  assert.equal(DEVICE_LOCAL_STATE_VERSION, 5);
  assert.equal(local.version, 5);
  assert.deepEqual(parseDeviceLocalPluginState(local).bases[0].view.undoStack[0].savedViews, data.savedViews);
  const bundle = createPortableExport(data, [], { ...EMPTY_PORTABLE_SELECTION, collections: true, savedViews: true }, "2026-09-19T00:00:00.000Z");
  assert.equal(PORTABLE_EXPORT_VERSION, 7);
  assert.equal(bundle.version, 7);
  assert.equal(bundle.components.savedViews?.version, 2);
  assert.deepEqual(parsePortableExport(bundle).components.savedViews?.views, data.savedViews);
  assert.equal(createWorkspaceConfig(data, "2026-09-19T00:00:00.000Z").version, 3, "Workspace contains no saved views and needs no format change");
});

test("schema16, backup12, portable6/savedViews1 and local4 still migrate without changing old searches", () => {
  const data = migrateData(null);
  data.savedViews = [{ id: "old-search", name: "Current linked", tab: "curriculum", query: "example", scope: "current", availability: "linked" }];
  data.undoStack = [snapshotPersonal(data, "Previous history")];
  const store = createDefaultStore(data, 100, "vault-legacy-search-format");
  const previousStore = { ...store, version: 16, bases: store.bases.map((base) => ({ ...base, data: { ...base.data, version: 16 } })) };
  const migrated = migrateStore(previousStore);
  assert.equal(migrated.version, 17);
  assert.deepEqual(migrated.bases[0].data.savedViews, data.savedViews);
  const backup = createPersonalBackup(data, "2026-09-19T00:00:00.000Z", store.vaultId, store.activeBaseId, "Test");
  assert.deepEqual(parsePersonalBackup({ ...backup, version: 12 }).savedViews, data.savedViews);
  const bundle = createPortableExport(data, [], { ...EMPTY_PORTABLE_SELECTION, savedViews: true }, "2026-09-19T00:00:00.000Z");
  const previousBundle = { ...bundle, version: 6, components: { savedViews: { ...bundle.components.savedViews, version: 1 } } };
  assert.deepEqual(parsePortableExport(previousBundle).components.savedViews?.views, data.savedViews);
  assert.deepEqual(parseDeviceLocalPluginState({ ...createDeviceLocalPluginState(store), version: 4 }).bases[0].view.undoStack[0].savedViews, data.savedViews);
});

test("schema16 to17 migration preserves exact published semantic authority for pending Undo journals", () => {
  const data = migrateData(null);
  data.pinnedPaths = ["Notes/Committed.md"];
  const store = createDefaultStore(data, 100, "vault-causal-upgrade");
  const raw = structuredClone(store) as unknown as { version: number; bases: Array<{ data: { version: number } }> };
  raw.version = 16;
  raw.bases[0].data.version = 16;
  const entry = (raw as unknown as typeof store).bases[0];
  // This is the exact published0.23.1 hash algorithm, not the current helper.
  const publishedHash = fingerprintText(canonicalJsonString([
    entry.createdAt, entry.archivedAt, semanticPluginDataProjection(entry.data),
  ]));
  entry.semanticHash = publishedHash;
  entry.semanticHead = fingerprintText("published16-committed-head");
  entry.semanticLineage = [fingerprintText("published16-parent")];
  entry.semanticRevision = 1;
  const migrated = migrateStore(raw);
  assert.equal(migrated.bases[0].data.version, 17);
  assert.equal(migrated.bases[0].semanticHash, publishedHash);
  assert.equal(migrated.bases[0].semanticHead, entry.semanticHead);
  assert.deepEqual(migrated.bases[0].semanticLineage, entry.semanticLineage);
  assert.equal(semanticEntryFingerprint(migrated.bases[0]), publishedHash);
  migrated.bases[0].data.savedViews = scopedData().savedViews;
  assert.notEqual(semanticEntryFingerprint(migrated.bases[0]), publishedHash, "new Collection restrictions remain semantic content");
});

test("Collection-search exports cannot be relabeled as the older unconstrained-search format", () => {
  const bundle = createPortableExport(scopedData(), [], { ...EMPTY_PORTABLE_SELECTION, savedViews: true }, "2026-09-19T00:00:00.000Z");
  assert.throws(() => parsePortableExport({ ...bundle, version: 6 }), /unsupported saved views component/i);
  assert.throws(() => parsePortableExport({ ...bundle, components: { savedViews: { ...bundle.components.savedViews, version: 1 } } }), /Collection-scoped saved views format/i);
});

test("merging an incoming saved view replaces optional filters instead of retaining stale scope", () => {
  const destination = scopedData();
  const incomingData = migrateData(null);
  incomingData.savedViews = [{ id: "saved-reading", name: "All notes", tab: "collections", query: "new query" }];
  const selection = { ...EMPTY_PORTABLE_SELECTION, savedViews: true };
  const bundle = parsePortableExport(createPortableExport(incomingData, [], selection, "2026-09-19T00:00:00.000Z"));
  assert.equal(applyPortableExport(destination, bundle, selection, "merge").importedViews, 1);
  assert.deepEqual(destination.savedViews, incomingData.savedViews);
  assert.equal(destination.savedViews[0].scope, undefined);
  assert.equal(destination.savedViews[0].collectionId, undefined);
  assert.equal(destination.savedViews[0].availability, undefined);
  assert.equal(destination.savedViews[0].linkedFirst, undefined);
});
