import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedSemanticLineage,
  createDefaultStore,
  createKnowledgeBaseEntry,
  MAX_KNOWLEDGE_BASES,
  MAX_SEMANTIC_LINEAGE,
  migrateData,
  legacyLocaleInterimEnvelopeFingerprint,
  migrateStore,
  provisionalInterimEnvelopeVaultFingerprint,
  provisionalMigratedVaultFingerprint,
  nextSemanticHead,
  semanticEntryFingerprint,
  semanticPluginDataProjection,
  type KnowledgeBaseEntry,
  type PersonalSnapshot,
  type PluginStore,
} from "../src/model.ts";
import { mergeKnowledgeBaseStores } from "../src/store-merge.ts";

function entry(id: string, name: string, updatedAt: number): KnowledgeBaseEntry {
  const data = migrateData(null);
  data.settings.workspaceName = name;
  const value = createKnowledgeBaseEntry(data, id, Math.max(1, updatedAt - 10));
  value.updatedAt = updatedAt;
  value.semanticRevision = updatedAt;
  return value;
}

function store(entries: KnowledgeBaseEntry[], activeBaseId = entries[0]?.id ?? ""): PluginStore {
  const value = createDefaultStore(migrateData(null), 1, "vault-test");
  value.bases = entries;
  value.activeBaseId = activeBaseId;
  return value;
}

function historySnapshot(label: string): PersonalSnapshot {
  return {
    label,
    at: 1,
    collections: [],
    pinnedPaths: [],
    nextStudyPaths: [],
    savedViews: [],
    curriculumVisual: { parentByPath: {}, orderByContainer: {} },
    manualIndexPaths: [],
    excludedIndexPaths: [],
    indexGroupByPath: {},
    displayNameByPath: {},
    indexGroupAliases: {},
    indexGroupOrder: [],
  };
}

function advanceEntry(entry: KnowledgeBaseEntry, change: () => void, updatedAt = entry.updatedAt + 1): void {
  const parentHead = entry.semanticHead;
  change();
  entry.semanticRevision += 1;
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = nextSemanticHead(parentHead, entry.semanticHash);
  entry.semanticLineage = boundedSemanticLineage([parentHead, ...entry.semanticLineage], entry.semanticHead);
  entry.updatedAt = updatedAt;
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

/** Base IDs whose code-unit order differs from every locale's collation order. */
function collationSensitiveEnvelopeWithoutVaultId(activeBaseId = "base-a"): Record<string, unknown> {
  const value = store([
    entry("base-a", "ENT", 100),
    entry("Base-b", "Research", 200),
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
  local.bases[0].semanticRevision = 300;
  incoming.bases[1].data.pinnedPaths = ["Research/Paper.md"];
  incoming.bases[1].updatedAt = 400;
  incoming.bases[1].semanticRevision = 400;

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

test("one edited first-upgrade copy wins the provisional identity symmetrically", () => {
  const legacy = migrateData(null);
  const pristine = migrateStore(structuredClone(legacy), 100);
  const edited = migrateStore(structuredClone(legacy), 100);
  advanceEntry(edited.bases[0], () => {
    edited.bases[0].data.pinnedPaths = ["Knowledge/Edited.md"];
  });

  assert.equal(
    provisionalMigratedVaultFingerprint(pristine.vaultId),
    provisionalMigratedVaultFingerprint(edited.vaultId),
  );
  const pristineFirst = mergeKnowledgeBaseStores(pristine, edited);
  const editedFirst = mergeKnowledgeBaseStores(edited, pristine);

  assert.deepEqual(pristineFirst.store, editedFirst.store);
  assert.equal(pristineFirst.store.vaultId, edited.vaultId);
  assert.deepEqual(pristineFirst.store.bases[0]?.data.pinnedPaths, ["Knowledge/Edited.md"]);
  assert.equal(pristineFirst.incomingNeedsWriteback, false);
  assert.equal(editedFirst.incomingNeedsWriteback, true);

  const repeated = mergeKnowledgeBaseStores(pristineFirst.store, pristine);
  assert.deepEqual(repeated.store, pristineFirst.store);
  assert.equal(repeated.incomingNeedsWriteback, true);
  assert.deepEqual(mergeKnowledgeBaseStores(repeated.store, repeated.store).store, repeated.store);
});

test("two edited first-upgrade copies still reject provisional cross-ID convergence", () => {
  const legacy = migrateData(null);
  const left = migrateStore(structuredClone(legacy), 100);
  const right = migrateStore(structuredClone(legacy), 100);
  left.bases[0].data.pinnedPaths = ["Knowledge/Left.md"];
  left.bases[0].updatedAt += 1;
  left.bases[0].semanticRevision += 1;
  right.bases[0].data.pinnedPaths = ["Knowledge/Right.md"];
  right.bases[0].updatedAt += 2;
  right.bases[0].semanticRevision += 1;

  assert.throws(() => mergeKnowledgeBaseStores(left, right), /different Obsidian vault/i);
  assert.throws(() => mergeKnowledgeBaseStores(right, left), /different Obsidian vault/i);
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

test("already-shipped interim identities minted under locale-sensitive ordering stay accepted", () => {
  // 0.12.0 sorted base IDs with localeCompare before fingerprinting, so devices
  // in the field carry identities that a code-unit recomputation cannot
  // reproduce. Those identities must never be treated as a foreign vault.
  const left = migrateStore(collationSensitiveEnvelopeWithoutVaultId("base-a"), 1_000);
  const right = migrateStore(collationSensitiveEnvelopeWithoutVaultId("Base-b"), 1_000);
  const legacyFingerprint = legacyLocaleInterimEnvelopeFingerprint(left);
  assert.notEqual(
    legacyFingerprint,
    provisionalInterimEnvelopeVaultFingerprint(left.vaultId),
    "these base IDs straddle a collation boundary, so the legacy fingerprint really differs",
  );
  const shippedLeftId = `vault-envelope-migrated-${legacyFingerprint}-aaaaaaaaaaaa`;
  const shippedRightId = `vault-envelope-migrated-${legacyFingerprint}-bbbbbbbbbbbb`;
  left.vaultId = shippedLeftId;
  right.vaultId = shippedRightId;

  const merged = mergeKnowledgeBaseStores(left, right, "base-a");
  assert.equal(merged.store.vaultId, [shippedLeftId, shippedRightId].sort()[0]);
  assert.deepEqual(
    mergeKnowledgeBaseStores(right, left, "base-a").store.vaultId,
    merged.store.vaultId,
    "convergence stays symmetric",
  );
});

test("a shipped legacy identity converges with a freshly migrated one for the same envelope", () => {
  const shipped = migrateStore(collationSensitiveEnvelopeWithoutVaultId("base-a"), 1_000);
  const upgraded = migrateStore(collationSensitiveEnvelopeWithoutVaultId("Base-b"), 1_000);
  shipped.vaultId = `vault-envelope-migrated-${legacyLocaleInterimEnvelopeFingerprint(shipped)}-cccccccccccc`;
  assert.notEqual(
    provisionalInterimEnvelopeVaultFingerprint(shipped.vaultId),
    provisionalInterimEnvelopeVaultFingerprint(upgraded.vaultId),
  );

  const merged = mergeKnowledgeBaseStores(shipped, upgraded, "base-a");
  assert.equal(merged.store.vaultId, [shipped.vaultId, upgraded.vaultId].sort()[0]);
  assert.deepEqual(mergeKnowledgeBaseStores(upgraded, shipped, "base-a").store, merged.store);
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
  edited.semanticRevision += 1;

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
  archived.semanticRevision = 300;
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
  restored.semanticRevision = 400;
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
  editedEnt.semanticRevision = 500;
  editedEnt.data.pinnedPaths = ["ENT/Airway.md"];
  const staleDevice = store([editedEnt, structuredClone(archivedResearch)], "base-ent");

  const merged = mergeKnowledgeBaseStores(local, staleDevice, "base-ent").store;
  const reversed = mergeKnowledgeBaseStores(staleDevice, local, "base-ent").store;

  assert.equal(merged.bases.some((candidate) => candidate.id === archivedResearch.id), false);
  assert.equal(merged.deletedBaseIds[archivedResearch.id], 300);
  assert.deepEqual(merged.bases.find((candidate) => candidate.id === ent.id)?.data.pinnedPaths, ["ENT/Airway.md"]);
  assert.deepEqual(merged, reversed, "tombstone merges must converge regardless of device order");
});

test("a tombstoned base edited after the deletion surfaces a losing conflict for rescue", () => {
  const ent = entry("base-ent", "ENT", 100);
  const research = entry("base-research", "Research", 200);
  const deletingDevice = store([structuredClone(ent)], "base-ent");
  deletingDevice.deletedBaseIds[research.id] = 300;
  const editedResearch = structuredClone(research);
  editedResearch.updatedAt = 500; // restored and edited after the deletion
  editedResearch.data.pinnedPaths = ["Research/Must survive.md"];
  const editingDevice = store([structuredClone(ent), editedResearch], "base-ent");

  // Deletion arrives at the editing device: its local copy loses, so the
  // merge worker must rescue the local envelope before adopting the drop.
  const localLoses = mergeKnowledgeBaseStores(editingDevice, deletingDevice, "base-ent");
  assert.equal(localLoses.store.bases.some((item) => item.id === research.id), false, "the tombstone still wins");
  assert.deepEqual(
    localLoses.semanticConflicts.map((conflict) => ({ baseId: conflict.baseId, winner: conflict.winner })),
    [{ baseId: research.id, winner: "incoming" }],
  );

  // The edited copy arrives at the deleting device: the incoming copy loses.
  const incomingLoses = mergeKnowledgeBaseStores(deletingDevice, editingDevice, "base-ent");
  assert.equal(incomingLoses.store.bases.some((item) => item.id === research.id), false);
  assert.deepEqual(
    incomingLoses.semanticConflicts.map((conflict) => ({ baseId: conflict.baseId, winner: conflict.winner })),
    [{ baseId: research.id, winner: "local" }],
  );

  // Deleting an unedited copy stays a silent, rescue-free drop.
  const staleResearch = structuredClone(research);
  staleResearch.updatedAt = 250;
  const staleDevice = store([structuredClone(ent), staleResearch], "base-ent");
  assert.deepEqual(mergeKnowledgeBaseStores(staleDevice, deletingDevice, "base-ent").semanticConflicts, []);
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

test("independently deduplicated names converge without nesting generated suffixes", () => {
  const first = entry("base-a", "Research", 100);
  const second = entry("base-b", "Research", 200);
  const third = entry("base-c", "Research", 300);
  const firstBranch = mergeKnowledgeBaseStores(
    store([structuredClone(first)]),
    store([structuredClone(second)]),
    "base-a",
  ).store;
  const secondBranch = mergeKnowledgeBaseStores(
    store([structuredClone(first)]),
    store([structuredClone(third)]),
    "base-a",
  ).store;

  const forward = mergeKnowledgeBaseStores(firstBranch, secondBranch, "base-a").store;
  const reverse = mergeKnowledgeBaseStores(secondBranch, firstBranch, "base-a").store;
  const expectedNames = ["Research", "Research (synced 2)", "Research (synced 3)"];

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.bases.map((item) => item.data.settings.workspaceName), expectedNames);
  assert.equal(forward.bases.some((item) => /\(synced \d+\).*\(synced \d+\)/i.test(item.data.settings.workspaceName)), false);
  const repeated = mergeKnowledgeBaseStores(forward, forward, "base-a");
  assert.deepEqual(repeated.store, forward);
  assert.equal(repeated.incomingNeedsWriteback, false);
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

test("UI-only state cannot outrank a structural edit in either merge direction, even with clock skew", () => {
  const baseline = entry("base-a", "ENT", 1_000);
  baseline.semanticRevision = 10;
  const structural = structuredClone(baseline);
  advanceEntry(structural, () => {
    structural.data.pinnedPaths = ["Knowledge/Airway.md"];
  }, 900); // Deliberately behind the UI-only device's wall clock.
  const uiOnly = structuredClone(baseline);
  uiOnly.data.selectedPath = "Knowledge/Viewed.md";
  uiOnly.data.activeTab = "collections";
  uiOnly.updatedAt = 50_000;

  const structuralLocal = mergeKnowledgeBaseStores(store([structural]), store([uiOnly]), "base-a");
  const uiLocal = mergeKnowledgeBaseStores(store([uiOnly]), store([structural]), "base-a");

  assert.deepEqual(structuralLocal.store.bases[0]?.data.pinnedPaths, ["Knowledge/Airway.md"]);
  assert.deepEqual(uiLocal.store.bases[0]?.data.pinnedPaths, ["Knowledge/Airway.md"]);
  assert.equal(structuralLocal.store.bases[0]?.data.selectedPath, structural.data.selectedPath);
  assert.equal(uiLocal.store.bases[0]?.data.selectedPath, "Knowledge/Viewed.md");
  assert.equal(structuralLocal.semanticConflicts.length, 0);
  assert.equal(uiLocal.semanticConflicts.length, 0);
});

test("equal semantic revisions report deterministic conflict metadata and converge semantically", () => {
  const alpha = entry("base-a", "Alpha", 100);
  const beta = entry("base-a", "Beta", 9_000);
  alpha.semanticRevision = 7;
  beta.semanticRevision = 7;
  alpha.data.selectedPath = "Local view.md";
  beta.data.selectedPath = "Remote view.md";

  const forward = mergeKnowledgeBaseStores(store([alpha]), store([beta]), "base-a");
  const reverse = mergeKnowledgeBaseStores(store([beta]), store([alpha]), "base-a");
  const forwardEntry = forward.store.bases[0];
  const reverseEntry = reverse.store.bases[0];
  assert.ok(forwardEntry && reverseEntry);
  assert.deepEqual(
    semanticPluginDataProjection(forwardEntry.data),
    semanticPluginDataProjection(reverseEntry.data),
  );
  assert.equal(forward.semanticConflicts.length, 1);
  assert.equal(reverse.semanticConflicts.length, 1);
  assert.deepEqual(
    {
      baseId: forward.semanticConflicts[0]?.baseId,
      revision: forward.semanticConflicts[0]?.revision,
      winner: forward.semanticConflicts[0]?.winner,
      localFingerprint: forward.semanticConflicts[0]?.localFingerprint,
      incomingFingerprint: forward.semanticConflicts[0]?.incomingFingerprint,
    },
    {
      baseId: "base-a",
      revision: 7,
      winner: reverse.semanticConflicts[0]?.winner === "local" ? "incoming" : "local",
      localFingerprint: reverse.semanticConflicts[0]?.incomingFingerprint,
      incomingFingerprint: reverse.semanticConflicts[0]?.localFingerprint,
    },
  );
});

test("view-only divergence preserves local history and never requires semantic writeback", () => {
  const local = entry("base-a", "ENT", 100);
  local.semanticRevision = 4;
  local.data.selectedPath = "Knowledge/Local.md";
  local.data.activeTab = "collections";
  local.data.undoStack = [historySnapshot("Local undo")];
  const incoming = structuredClone(local);
  incoming.data.selectedPath = "Knowledge/Incoming.md";
  incoming.data.activeTab = "curriculum";
  incoming.data.undoStack = [];
  incoming.updatedAt = 99_000;

  const merged = mergeKnowledgeBaseStores(store([local]), store([incoming]), "base-a");

  assert.equal(merged.incomingNeedsWriteback, false);
  assert.equal(merged.semanticConflicts.length, 0);
  assert.equal(merged.store.bases[0]?.data.selectedPath, "Knowledge/Local.md");
  assert.equal(merged.store.bases[0]?.data.activeTab, "collections");
  assert.equal(merged.store.bases[0]?.data.undoStack[0]?.label, "Local undo");
  assert.equal(merged.store.bases[0]?.updatedAt, 99_000);
  const reverse = mergeKnowledgeBaseStores(store([incoming]), store([local]), "base-a");
  assert.equal(reverse.store.bases[0]?.updatedAt, 99_000);
});

test("an incoming semantic replacement overlays collapse state by stable ID and clears stale history", () => {
  const local = entry("base-a", "ENT", 100);
  local.semanticRevision = 1;
  local.data.collections = [{
    id: "shared-heading",
    title: "Old heading",
    collapsed: true,
    subjects: [],
    subheadings: [{ id: "shared-subheading", title: "Old subheading", collapsed: true, subjects: [] }],
  }, {
    id: "removed-heading",
    title: "Removed",
    collapsed: true,
    subjects: [],
    subheadings: [],
  }];
  local.data.portableIndex.libraryLayouts["library-shared"] = [{
    id: "library-shared-heading",
    title: "Old library heading",
    collapsed: true,
    subjects: [],
    subheadings: [{ id: "library-shared-subheading", title: "Old library subheading", collapsed: true, subjects: [] }],
  }];
  local.data.undoStack = [historySnapshot("Stale undo")];
  const incoming = structuredClone(local);
  incoming.semanticRevision = 2;
  incoming.updatedAt = 200;
  incoming.data.collections = [{
    id: "shared-heading",
    title: "Renamed heading",
    collapsed: false,
    subjects: ["Knowledge/New.md"],
    subheadings: [{ id: "shared-subheading", title: "Renamed subheading", collapsed: false, subjects: [] }],
  }, {
    id: "new-heading",
    title: "New heading",
    collapsed: true,
    subjects: [],
    subheadings: [{ id: "new-subheading", title: "New subheading", collapsed: true, subjects: [] }],
  }];
  incoming.data.portableIndex.libraryLayouts["library-shared"] = [{
    id: "library-shared-heading",
    title: "Renamed library heading",
    collapsed: false,
    subjects: ["subject-new"],
    subheadings: [{ id: "library-shared-subheading", title: "Renamed library subheading", collapsed: false, subjects: [] }],
  }, {
    id: "library-new-heading",
    title: "New library heading",
    collapsed: true,
    subjects: [],
    subheadings: [],
  }];
  incoming.data.undoStack = [];

  const merged = mergeKnowledgeBaseStores(store([local]), store([incoming]), "base-a");
  const collections = merged.store.bases[0]?.data.collections ?? [];

  assert.equal(collections.find((heading) => heading.id === "shared-heading")?.collapsed, true);
  assert.equal(collections.find((heading) => heading.id === "shared-heading")?.subheadings[0]?.collapsed, true);
  assert.equal(collections.find((heading) => heading.id === "new-heading")?.collapsed, false);
  assert.equal(collections.find((heading) => heading.id === "new-heading")?.subheadings[0]?.collapsed, false);
  assert.equal(collections.some((heading) => heading.id === "removed-heading"), false);
  const libraryLayout = merged.store.bases[0]?.data.portableIndex.libraryLayouts["library-shared"] ?? [];
  assert.equal(libraryLayout.find((heading) => heading.id === "library-shared-heading")?.collapsed, true);
  assert.equal(libraryLayout.find((heading) => heading.id === "library-shared-heading")?.subheadings[0]?.collapsed, true);
  assert.equal(libraryLayout.find((heading) => heading.id === "library-new-heading")?.collapsed, false);
  assert.deepEqual(merged.store.bases[0]?.data.undoStack, []);
  assert.deepEqual(merged.store.bases[0]?.data.redoStack, []);
});

test("a base first seen on this device receives neutral view state and empty history", () => {
  const localBase = entry("base-a", "ENT", 100);
  const incomingBase = entry("base-b", "Research", 200);
  incomingBase.data.selectedPath = "Research/Viewed.md";
  incomingBase.data.activeTab = "collections";
  incomingBase.data.collapsed.curriculumDomains = ["Research"];
  incomingBase.data.collections = [{ id: "heading", title: "Heading", collapsed: true, subjects: [], subheadings: [] }];
  incomingBase.data.undoStack = [historySnapshot("Remote history")];

  const merged = mergeKnowledgeBaseStores(store([localBase]), store([incomingBase], "base-b"), "base-a");
  const added = merged.store.bases.find((candidate) => candidate.id === "base-b");
  assert.ok(added);
  assert.equal(added.data.selectedPath, "");
  assert.equal(added.data.activeTab, added.data.settings.defaultTab);
  assert.deepEqual(added.data.collapsed.curriculumDomains, []);
  assert.equal(added.data.collections[0]?.collapsed, false);
  assert.deepEqual(added.data.undoStack, []);
  assert.deepEqual(added.data.redoStack, []);
});

test("unequal scalar revisions without causal ancestry conflict and converge only after rescue classification", () => {
  const baseline = entry("base-a", "ENT", 100);
  const left = structuredClone(baseline);
  const right = structuredClone(baseline);
  advanceEntry(left, () => { left.data.pinnedPaths = ["Left.md"]; }, 200);
  advanceEntry(right, () => { right.data.nextStudyPaths = ["Right.md"]; }, 300);
  right.semanticRevision += 10;

  const forward = mergeKnowledgeBaseStores(store([left]), store([right]), "base-a");
  const reverse = mergeKnowledgeBaseStores(store([right]), store([left]), "base-a");

  assert.equal(forward.semanticConflicts.length, 1);
  assert.equal(reverse.semanticConflicts.length, 1);
  assert.deepEqual(
    semanticPluginDataProjection(forward.store.bases[0].data),
    semanticPluginDataProjection(reverse.store.bases[0].data),
  );
});

test("a direct and multi-edit causal descendant wins without a false conflict", () => {
  const ancestor = entry("base-a", "ENT", 100);
  const child = structuredClone(ancestor);
  advanceEntry(child, () => { child.data.pinnedPaths = ["One.md"]; });
  const grandchild = structuredClone(child);
  advanceEntry(grandchild, () => { grandchild.data.nextStudyPaths = ["Two.md"]; });

  for (const [older, newer] of [[ancestor, child], [ancestor, grandchild], [child, grandchild]] as const) {
    const forward = mergeKnowledgeBaseStores(store([structuredClone(older)]), store([structuredClone(newer)]), "base-a");
    const reverse = mergeKnowledgeBaseStores(store([structuredClone(newer)]), store([structuredClone(older)]), "base-a");
    assert.equal(forward.semanticConflicts.length, 0);
    assert.equal(reverse.semanticConflicts.length, 0);
    assert.equal(forward.store.bases[0].semanticHead, newer.semanticHead);
    assert.equal(reverse.store.bases[0].semanticHead, newer.semanticHead);
  }
});

test("a v13 revision-zero divergence is unrelated to a v14 edit and is rescued as a conflict", () => {
  const initial = store([entry("base-a", "ENT", 100)]);
  const rawV13 = structuredClone(initial) as unknown as Record<string, unknown>;
  rawV13.version = 13;
  const rawBase = (rawV13.bases as Array<Record<string, unknown>>)[0];
  delete rawBase.semanticRevision;
  delete rawBase.semanticHead;
  delete rawBase.semanticHash;
  delete rawBase.semanticLineage;
  const baseline = migrateStore(rawV13, 100);
  const v14Edit = structuredClone(baseline);
  advanceEntry(v14Edit.bases[0], () => { v14Edit.bases[0].data.pinnedPaths = ["Modern.md"]; });

  const legacyRaw = structuredClone(rawV13);
  const legacyData = ((legacyRaw.bases as Array<Record<string, unknown>>)[0].data as KnowledgeBaseEntry["data"]);
  legacyData.nextStudyPaths = ["Legacy.md"];
  const legacyEdit = migrateStore(legacyRaw, 100);
  const merged = mergeKnowledgeBaseStores(v14Edit, legacyEdit, "base-a");

  assert.equal(merged.semanticConflicts.length, 1);
});

test("a missing semantic head cannot retain forged ancestry to suppress conflict rescue", () => {
  const ancestor = store([entry("base-a", "ENT", 100)]);
  const local = structuredClone(ancestor);
  advanceEntry(local.bases[0], () => { local.bases[0].data.pinnedPaths = ["Local.md"]; });

  const rawIncoming = structuredClone(ancestor) as unknown as { bases: Array<Record<string, unknown>> };
  const incomingData = rawIncoming.bases[0].data as KnowledgeBaseEntry["data"];
  incomingData.nextStudyPaths = ["Incoming.md"];
  rawIncoming.bases[0].semanticRevision = local.bases[0].semanticRevision + 20;
  rawIncoming.bases[0].semanticHash = semanticEntryFingerprint({
    createdAt: rawIncoming.bases[0].createdAt,
    archivedAt: rawIncoming.bases[0].archivedAt,
    data: incomingData,
  });
  rawIncoming.bases[0].semanticLineage = [local.bases[0].semanticHead];
  delete rawIncoming.bases[0].semanticHead;
  const incoming = migrateStore(rawIncoming, 200);

  assert.deepEqual(incoming.bases[0].semanticLineage, []);
  assert.equal(mergeKnowledgeBaseStores(local, incoming, "base-a").semanticConflicts.length, 1);
});

test("bounded lineage proves recent descendants and fails closed after an ancestor falls out of the cap", () => {
  const root = entry("base-a", "ENT", 100);
  let current = structuredClone(root);
  let recentAncestor = structuredClone(root);
  for (let index = 0; index < MAX_SEMANTIC_LINEAGE + 5; index += 1) {
    const next = structuredClone(current);
    advanceEntry(next, () => { next.data.settings.workspaceSubtitle = `Edit ${index}`; });
    current = next;
    if (index === MAX_SEMANTIC_LINEAGE + 2) recentAncestor = structuredClone(current);
  }
  assert.equal(current.semanticLineage.length, MAX_SEMANTIC_LINEAGE);
  assert.equal(mergeKnowledgeBaseStores(store([recentAncestor]), store([current])).semanticConflicts.length, 0);
  const forward = mergeKnowledgeBaseStores(store([root]), store([current]));
  const reverse = mergeKnowledgeBaseStores(store([current]), store([root]));
  assert.equal(forward.semanticConflicts.length, 1);
  assert.equal(reverse.semanticConflicts.length, 1);
  assert.deepEqual(
    semanticPluginDataProjection(forward.store.bases[0].data),
    semanticPluginDataProjection(reverse.store.bases[0].data),
  );
});

test("merge canonicalization sees a __proto__ key, matching the model and portfolio serializers", () => {
  // A store whose only divergence lives under an own "__proto__" key used to
  // canonicalize to the same text here — the local copy accumulated into a
  // plain object, where that assignment creates no own property — while
  // model.ts saw a real difference. Two modules then disagreed about whether
  // the same pair of bases had diverged at all.
  const local = entry("base-proto", "Base", 5);
  const incoming = structuredClone(local);
  local.data.indexGroupByPath = JSON.parse('{"__proto__":"Research"}') as Record<string, string>;
  incoming.data.indexGroupByPath = JSON.parse('{"__proto__":"Teaching"}') as Record<string, string>;
  for (const value of [local, incoming]) {
    value.semanticHash = semanticEntryFingerprint(value);
    value.semanticHead = value.semanticHash;
  }

  // model.ts already distinguished these payloads; store-merge must agree.
  assert.notEqual(local.semanticHash, incoming.semanticHash);
  const merged = mergeKnowledgeBaseStores(store([local]), store([incoming]));
  assert.equal(merged.semanticConflicts.length, 1, "divergence under a __proto__ key is a real conflict");
  const conflict = merged.semanticConflicts[0];
  assert.ok(conflict);
  assert.notEqual(
    conflict.localFingerprint,
    conflict.incomingFingerprint,
    "the reported fingerprints must differ, not collapse to one canonical text",
  );

  // Identical __proto__ payloads still merge cleanly, with no invented conflict.
  const same = structuredClone(local);
  assert.equal(mergeKnowledgeBaseStores(store([local]), store([same])).semanticConflicts.length, 0);
});
