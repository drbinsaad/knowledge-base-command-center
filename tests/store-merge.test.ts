import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultStore,
  createKnowledgeBaseEntry,
  MAX_KNOWLEDGE_BASES,
  migrateData,
  migrateStore,
  provisionalInterimEnvelopeVaultFingerprint,
  provisionalMigratedVaultFingerprint,
  type KnowledgeBaseEntry,
  type PluginStore,
} from "../src/model.ts";
import { mergeKnowledgeBaseStores } from "../src/store-merge.ts";

function entry(id: string, name: string, updatedAt: number): KnowledgeBaseEntry {
  const data = migrateData(null);
  data.settings.workspaceName = name;
  const value = createKnowledgeBaseEntry(data, id, Math.max(1, updatedAt - 10));
  value.updatedAt = updatedAt;
  return value;
}

function store(entries: KnowledgeBaseEntry[], activeBaseId = entries[0]?.id ?? ""): PluginStore {
  const value = createDefaultStore(migrateData(null), 1, "vault-test");
  value.bases = entries;
  value.activeBaseId = activeBaseId;
  return value;
}

function interimEnvelopeWithoutVaultId(
  activeBaseId = "base-a",
  secondName = "Research",
): Record<string, unknown> {
  const value = store([
    entry("base-a", "ENT", 100),
    entry("base-b", secondName, 200),
  ], activeBaseId);
  value.deletedBaseIds = { "base-removed": 75 };
  const raw = structuredClone(value) as unknown as Record<string, unknown>;
  delete raw.vaultId;
  return raw;
}

test("store merge preserves disjoint edits to separate knowledge bases", () => {
  const baseA = entry("base-a", "ENT", 100);
  const baseB = entry("base-b", "Research", 100);
  const local = store([structuredClone(baseA), structuredClone(baseB)], "base-a");
  const incoming = store([structuredClone(baseA), structuredClone(baseB)], "base-b");
  local.bases[0].data.pinnedPaths = ["ENT/Airway.md"];
  local.bases[0].updatedAt = 300;
  incoming.bases[1].data.pinnedPaths = ["Research/Paper.md"];
  incoming.bases[1].updatedAt = 400;

  const merged = mergeKnowledgeBaseStores(local, incoming, "base-a");

  assert.deepEqual(merged.store.bases.find((item) => item.id === "base-a")?.data.pinnedPaths, ["ENT/Airway.md"]);
  assert.deepEqual(merged.store.bases.find((item) => item.id === "base-b")?.data.pinnedPaths, ["Research/Paper.md"]);
  assert.equal(merged.store.activeBaseId, "base-a");
  assert.equal(merged.incomingNeedsWriteback, true);
});

test("store merge uses the newer payload only within the same base", () => {
  const older = entry("base-a", "Older", 100);
  const newer = entry("base-a", "Newer", 200);
  assert.equal(
    mergeKnowledgeBaseStores(store([older]), store([newer]), "base-a").store.bases[0]?.data.settings.workspaceName,
    "Newer",
  );
});

test("same-millisecond conflicts converge symmetrically with canonical fingerprints", () => {
  const left = entry("base-a", "Alpha", 500);
  left.data.indexGroupByPath = { "B.md": "B", "A.md": "A" };
  const right = entry("base-a", "Beta", 500);
  right.data.indexGroupByPath = { "A.md": "A", "B.md": "B" };

  const leftFirst = mergeKnowledgeBaseStores(store([left]), store([right]), "base-a").store;
  const rightFirst = mergeKnowledgeBaseStores(store([right]), store([left]), "base-a").store;
  assert.deepEqual(leftFirst, rightFirst);
});

test("same-millisecond entries with different creation times still converge symmetrically", () => {
  const left = entry("base-a", "ENT", 500);
  const right = structuredClone(left);
  left.createdAt = 100;
  right.createdAt = 200;

  const leftFirst = mergeKnowledgeBaseStores(store([left]), store([right]), "base-a").store;
  const rightFirst = mergeKnowledgeBaseStores(store([right]), store([left]), "base-a").store;
  assert.deepEqual(leftFirst, rightFirst);
});

test("store merge rejects data from a different vault identity", () => {
  const local = store([entry("base-a", "ENT", 100)]);
  const incoming = store([entry("base-a", "ENT", 200)]);
  incoming.vaultId = "vault-other";
  assert.throws(() => mergeKnowledgeBaseStores(local, incoming), /different Obsidian vault/i);
});

test("concurrent pristine first-upgrade migrations converge symmetrically to one random identity", () => {
  const legacy = migrateData(null);
  legacy.settings.workspaceName = "ENT";
  legacy.pinnedPaths = ["Knowledge/Airway.md"];
  const left = migrateStore(structuredClone(legacy), 100);
  const right = migrateStore(structuredClone(legacy), 100);

  assert.notEqual(left.vaultId, right.vaultId);
  assert.equal(
    provisionalMigratedVaultFingerprint(left.vaultId),
    provisionalMigratedVaultFingerprint(right.vaultId),
  );
  const leftFirst = mergeKnowledgeBaseStores(left, right);
  const rightFirst = mergeKnowledgeBaseStores(right, left);
  assert.deepEqual(leftFirst.store, rightFirst.store);
  assert.equal(leftFirst.store.vaultId, [left.vaultId, right.vaultId].sort()[0]);
  assert.equal(leftFirst.incomingNeedsWriteback, leftFirst.store.vaultId !== right.vaultId);
  assert.equal(rightFirst.incomingNeedsWriteback, rightFirst.store.vaultId !== left.vaultId);
});

test("a late third pristine migration converges to the same first-upgrade identity", () => {
  const legacy = migrateData(null);
  legacy.settings.workspaceName = "ENT";
  const devices = [
    migrateStore(structuredClone(legacy), 100),
    migrateStore(structuredClone(legacy), 100),
    migrateStore(structuredClone(legacy), 100),
  ];
  const firstPath = mergeKnowledgeBaseStores(
    mergeKnowledgeBaseStores(devices[0], devices[1]).store,
    devices[2],
  ).store;
  const secondPath = mergeKnowledgeBaseStores(
    mergeKnowledgeBaseStores(devices[1], devices[2]).store,
    devices[0],
  ).store;

  assert.deepEqual(firstPath, secondPath);
  assert.equal(firstPath.vaultId, devices.map((device) => device.vaultId).sort()[0]);
});

test("provisional migrations with different legacy fingerprints never converge", () => {
  const ent = migrateData(null);
  ent.settings.workspaceName = "ENT";
  const research = migrateData(null);
  research.settings.workspaceName = "Research";
  const left = migrateStore(ent, 100);
  const right = migrateStore(research, 100);

  assert.notEqual(
    provisionalMigratedVaultFingerprint(left.vaultId),
    provisionalMigratedVaultFingerprint(right.vaultId),
  );
  assert.throws(() => mergeKnowledgeBaseStores(left, right), /different Obsidian vault/i);
});

test("a post-migration edit disables provisional cross-ID convergence", () => {
  const legacy = migrateData(null);
  const left = migrateStore(structuredClone(legacy), 100);
  const right = migrateStore(structuredClone(legacy), 100);
  right.bases[0].data.pinnedPaths = ["Knowledge/Edited.md"];
  right.bases[0].updatedAt += 1;

  assert.throws(() => mergeKnowledgeBaseStores(left, right), /different Obsidian vault/i);
});

test("the interim deterministic migrated ID reconciles into a full random provisional ID", () => {
  const legacy = migrateData(null);
  const full = migrateStore(structuredClone(legacy), 100);
  const fingerprint = provisionalMigratedVaultFingerprint(full.vaultId);
  assert.ok(fingerprint);
  const interim = structuredClone(full);
  interim.vaultId = `vault-migrated-${fingerprint}`;

  const merged = mergeKnowledgeBaseStores(interim, full);
  assert.equal(merged.store.vaultId, full.vaultId);
  assert.equal(merged.incomingNeedsWriteback, false);
  assert.equal(mergeKnowledgeBaseStores(full, interim).incomingNeedsWriteback, true);
});

test("identical interim multi-base envelopes without vault IDs converge symmetrically", () => {
  const left = migrateStore(interimEnvelopeWithoutVaultId("base-a"), 1_000);
  const right = migrateStore(interimEnvelopeWithoutVaultId("base-b"), 1_000);

  assert.notEqual(left.vaultId, right.vaultId);
  assert.equal(
    provisionalInterimEnvelopeVaultFingerprint(left.vaultId),
    provisionalInterimEnvelopeVaultFingerprint(right.vaultId),
    "device-local active-base selection must not change the envelope fingerprint",
  );
  const leftFirst = mergeKnowledgeBaseStores(left, right, "base-a");
  const rightFirst = mergeKnowledgeBaseStores(right, left, "base-a");
  assert.deepEqual(leftFirst.store, rightFirst.store);
  assert.equal(leftFirst.store.vaultId, [left.vaultId, right.vaultId].sort()[0]);
  assert.equal(leftFirst.store.activeBaseId, "base-a");
  assert.equal(leftFirst.incomingNeedsWriteback, leftFirst.store.vaultId !== right.vaultId);
  assert.equal(rightFirst.incomingNeedsWriteback, rightFirst.store.vaultId !== left.vaultId);
});

test("a late third device with the same pristine interim envelope joins the converged identity", () => {
  const devices = [
    migrateStore(interimEnvelopeWithoutVaultId("base-a"), 1_000),
    migrateStore(interimEnvelopeWithoutVaultId("base-b"), 1_000),
    migrateStore(interimEnvelopeWithoutVaultId("base-a"), 1_000),
  ];
  const firstPath = mergeKnowledgeBaseStores(
    mergeKnowledgeBaseStores(devices[0], devices[1], "base-a").store,
    devices[2],
    "base-a",
  ).store;
  const secondPath = mergeKnowledgeBaseStores(
    mergeKnowledgeBaseStores(devices[1], devices[2], "base-a").store,
    devices[0],
    "base-a",
  ).store;

  assert.deepEqual(firstPath, secondPath);
  assert.equal(firstPath.vaultId, devices.map((device) => device.vaultId).sort()[0]);
});

test("an edited base disables interim-envelope cross-ID convergence", () => {
  const left = migrateStore(interimEnvelopeWithoutVaultId(), 1_000);
  const right = migrateStore(interimEnvelopeWithoutVaultId(), 1_000);
  const edited = right.bases.find((candidate) => candidate.id === "base-b");
  assert.ok(edited);
  edited.data.pinnedPaths = ["Research/Changed.md"];
  edited.updatedAt += 1;

  assert.throws(() => mergeKnowledgeBaseStores(left, right), /different Obsidian vault/i);
});

test("a changed tombstone disables interim-envelope cross-ID convergence", () => {
  const left = migrateStore(interimEnvelopeWithoutVaultId(), 1_000);
  const right = migrateStore(interimEnvelopeWithoutVaultId(), 1_000);
  right.deletedBaseIds["base-removed"] = 76;

  assert.throws(() => mergeKnowledgeBaseStores(left, right), /different Obsidian vault/i);
});

test("different interim multi-base envelopes never converge", () => {
  const left = migrateStore(interimEnvelopeWithoutVaultId("base-a", "Research"), 1_000);
  const right = migrateStore(interimEnvelopeWithoutVaultId("base-a", "Teaching"), 1_000);

  assert.notEqual(
    provisionalInterimEnvelopeVaultFingerprint(left.vaultId),
    provisionalInterimEnvelopeVaultFingerprint(right.vaultId),
  );
  assert.throws(() => mergeKnowledgeBaseStores(left, right), /different Obsidian vault/i);
});

test("archive and restore timestamps act as last-writer-wins tombstones", () => {
  const available = entry("base-a", "ENT", 200);
  const archived = structuredClone(available);
  archived.archivedAt = 300;
  archived.updatedAt = 300;
  const fallback = entry("base-b", "Research", 100);

  const archivedResult = mergeKnowledgeBaseStores(
    store([available, structuredClone(fallback)], "base-a"),
    store([archived, structuredClone(fallback)], "base-b"),
    "base-a",
  ).store;
  assert.notEqual(archivedResult.bases.find((item) => item.id === "base-a")?.archivedAt, null);
  assert.equal(archivedResult.activeBaseId, "base-b", "an archived local active base must fall back safely");

  const restored = structuredClone(available);
  restored.updatedAt = 400;
  const restoredResult = mergeKnowledgeBaseStores(
    archivedResult,
    store([restored, structuredClone(fallback)], "base-a"),
    "base-b",
  ).store;
  assert.equal(restoredResult.bases.find((item) => item.id === "base-a")?.archivedAt, null);
  assert.equal(restoredResult.activeBaseId, "base-b", "this device's still-available active base remains selected");
});

test("permanent-deletion tombstones suppress stale bases while preserving unrelated synced edits", () => {
  const ent = entry("base-ent", "ENT", 100);
  const archivedResearch = entry("base-research", "Research", 200);
  archivedResearch.archivedAt = 200;
  const local = store([structuredClone(ent)], "base-ent");
  local.deletedBaseIds[archivedResearch.id] = 300;
  const editedEnt = structuredClone(ent);
  editedEnt.updatedAt = 500;
  editedEnt.data.pinnedPaths = ["ENT/Airway.md"];
  const staleDevice = store([editedEnt, structuredClone(archivedResearch)], "base-ent");

  const merged = mergeKnowledgeBaseStores(local, staleDevice, "base-ent").store;
  const reversed = mergeKnowledgeBaseStores(staleDevice, local, "base-ent").store;

  assert.equal(merged.bases.some((candidate) => candidate.id === archivedResearch.id), false);
  assert.equal(merged.deletedBaseIds[archivedResearch.id], 300);
  assert.deepEqual(merged.bases.find((candidate) => candidate.id === ent.id)?.data.pinnedPaths, ["ENT/Airway.md"]);
  assert.deepEqual(merged, reversed, "tombstone merges must converge regardless of device order");
});

test("concurrent permanent deletions that would remove every available base are rejected without mutation", () => {
  const baseA = entry("base-a", "ENT", 100);
  const baseB = entry("base-b", "Research", 100);
  const local = store([baseA], "base-a");
  local.deletedBaseIds[baseB.id] = 300;
  const incoming = store([baseB], "base-b");
  incoming.deletedBaseIds[baseA.id] = 400;
  const beforeLocal = structuredClone(local);
  const beforeIncoming = structuredClone(incoming);

  assert.throws(() => mergeKnowledgeBaseStores(local, incoming), /left no available base/i);
  assert.deepEqual(local, beforeLocal);
  assert.deepEqual(incoming, beforeIncoming);
});

test("concurrent duplicate names are made unique deterministically", () => {
  const first = entry("base-a", "Research", 200);
  const second = entry("base-b", "research", 200);
  const local = store([first], "base-a");
  const incoming = store([second], "base-b");
  const one = mergeKnowledgeBaseStores(local, incoming, "base-a").store;
  const two = mergeKnowledgeBaseStores(incoming, local, "base-a").store;
  assert.deepEqual(one, two);
  assert.deepEqual(one.bases.map((item) => item.data.settings.workspaceName), ["Research", "research (synced 2)"]);
});

test("store merge rejects an over-cap union without mutating either input", () => {
  const localEntries = Array.from({ length: MAX_KNOWLEDGE_BASES }, (_, index) => entry(`base-local-${index}`, `Local ${index}`, index + 1));
  const incomingEntries = [entry("base-remote-extra", "Remote", 1000)];
  const local = store(localEntries, "base-local-0");
  const incoming = store(incomingEntries, "base-remote-extra");
  const beforeLocal = structuredClone(local);
  const beforeIncoming = structuredClone(incoming);

  assert.throws(() => mergeKnowledgeBaseStores(local, incoming), /above the safe limit.*no base was discarded/i);
  assert.deepEqual(local, beforeLocal);
  assert.deepEqual(incoming, beforeIncoming);
});
