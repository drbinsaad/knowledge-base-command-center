import assert from "node:assert/strict";
import test from "node:test";
import {
  createNoteOrganizerBatchHistoryToken,
  projectNoteOrganizerBatchTransition,
  type NoteOrganizerBatchHistoryToken,
} from "../src/note-organizer-history";
import {
  boundedSemanticLineage,
  canonicalJsonString,
  cloneJsonValue,
  createDefaultStore,
  createKnowledgeBaseEntry,
  DEFAULT_DATA,
  deterministicSemanticHead,
  fingerprintText,
  limitSnapshotStack,
  MAX_DEVICE_LOCAL_STATE_BYTES,
  semanticEntryFingerprint,
  snapshotPersonal,
  type KnowledgeBaseEntry,
  type PluginData,
  type PluginStore,
} from "../src/model";

const LABEL = "Organize selected notes";
const APPLY_AT = 1_700_000_000_100;

function data(name: string): PluginData {
  const value = cloneJsonValue(DEFAULT_DATA);
  value.settings.workspaceName = name;
  value.settings.setupComplete = true;
  value.settings.workspaceMode = "generic";
  value.selectedPath = `${name}/Selected.md`;
  value.activeTab = "collections";
  return value;
}

function storeWith(entries: KnowledgeBaseEntry[], vaultId = "vault-note-organizer-history"): PluginStore {
  const store = createDefaultStore(cloneJsonValue(entries[0]?.data ?? data("Fallback")), 1, vaultId);
  store.bases = entries.map((entry) => cloneJsonValue(entry));
  store.activeBaseId = entries[0]?.id ?? "base-default";
  return store;
}

function advanceSemanticEntry(
  entry: KnowledgeBaseEntry,
  parent: KnowledgeBaseEntry,
  reason: string,
): void {
  entry.semanticRevision = parent.semanticRevision + 1;
  entry.updatedAt = parent.updatedAt + 1;
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = deterministicSemanticHead(parent.semanticHead, entry.semanticHash, reason);
  entry.semanticLineage = boundedSemanticLineage(
    [parent.semanticHead, ...parent.semanticLineage],
    entry.semanticHead,
  );
}

function resetSemanticAuthority(entry: KnowledgeBaseEntry): void {
  entry.semanticRevision = 0;
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = entry.semanticHash;
  entry.semanticLineage = [];
}

function organizerApply(
  before: PluginStore,
  affectedBaseIds: readonly string[],
  mutate?: (entry: KnowledgeBaseEntry, index: number) => void,
): PluginStore {
  const applied = cloneJsonValue(before);
  affectedBaseIds.forEach((baseId, index) => {
    const source = before.bases.find((entry) => entry.id === baseId);
    const destination = applied.bases.find((entry) => entry.id === baseId);
    if (!source || !destination) throw new Error("Missing organizer fixture base.");
    const undo = snapshotPersonal(source.data, LABEL, false, true);
    undo.at = APPLY_AT;
    if (mutate) mutate(destination, index);
    else destination.data.directIndexPaths.push(`Notes/Organized-${index + 1}.md`);
    destination.data.undoStack = limitSnapshotStack([...destination.data.undoStack, undo]);
    destination.data.redoStack = [];
    advanceSemanticEntry(destination, source, `test-organizer-apply:${baseId}`);
  });
  return applied;
}

function fixture(): { before: PluginStore; applied: PluginStore; affectedBaseIds: string[] } {
  const first = createKnowledgeBaseEntry(data("ENT"), "base-ent", 100);
  const second = createKnowledgeBaseEntry(data("Reading"), "base-reading", 200);
  const third = createKnowledgeBaseEntry(data("Archive"), "base-archive", 300);
  const olderFirst = snapshotPersonal(first.data, "Older ENT change", false, true);
  olderFirst.at = 80;
  first.data.undoStack = [olderFirst];
  first.data.redoStack = [snapshotPersonal(first.data, "Old ENT Redo", false, true)];
  const olderSecond = snapshotPersonal(second.data, "Older Reading change", false, true);
  olderSecond.at = 90;
  second.data.undoStack = [olderSecond];
  second.data.layoutSnapshots = [snapshotPersonal(second.data, "Named Reading layout", false, true)];
  resetSemanticAuthority(first);
  resetSemanticAuthority(second);
  const before = storeWith([first, second, third]);
  const affectedBaseIds = [second.id, first.id];
  const applied = organizerApply(before, affectedBaseIds);
  return { before, applied, affectedBaseIds };
}

function tokenFor(
  before: PluginStore,
  applied: PluginStore,
  affectedBaseIds: readonly string[],
): NoteOrganizerBatchHistoryToken {
  const token = createNoteOrganizerBatchHistoryToken(before, applied, {
    id: "note-organizer-plan-test",
    label: LABEL,
    affectedBaseIds,
  });
  assert.ok(token);
  return token;
}

function snapshotFingerprint(value: unknown): string {
  return fingerprintText(canonicalJsonString(value));
}

test("multi-base Apply → Undo → Redo is symmetric, atomic, and keeps exact inverse Undo entries", () => {
  const { before, applied, affectedBaseIds } = fixture();
  const token = tokenFor(before, applied, affectedBaseIds);
  assert.equal(token.state, "applied");
  assert.deepEqual(token.affectedBaseIds, ["base-ent", "base-reading"]);
  assert.equal(token.bases.every((base) => Boolean(base.beforeSnapshot.portableIndex)), true);
  assert.equal(token.bases.every((base) => base.beforeSnapshot.settings === undefined), true);
  assert.equal(token.bases.every((base) => base.beforeSnapshot.layoutSnapshots === undefined), true);
  assert.equal(token.bases.every((base) => base.beforeSnapshot.activeTab === undefined), true);

  const current = cloneJsonValue(applied);
  current.activeBaseId = "base-archive";
  for (const entry of current.bases) {
    entry.data.selectedPath = `Browsing/${entry.id}.md`;
    entry.data.activeTab = "inbox";
  }
  const currentBeforeProjection = cloneJsonValue(current);
  const tokenBeforeProjection = cloneJsonValue(token);
  const undone = projectNoteOrganizerBatchTransition(current, token, "undo");

  assert.deepEqual(current, currentBeforeProjection, "projection never mutates its source store");
  assert.deepEqual(token, tokenBeforeProjection, "projection never mutates its source token");
  assert.equal(undone.store.activeBaseId, "base-archive", "a base switch after Apply remains intact");
  assert.equal(undone.token.state, "undone");
  assert.equal(undone.token.transitionCount, 1);
  assert.deepEqual(undone.requiredUndoBatchBaseIds, ["base-ent", "base-reading"]);

  for (const baseId of undone.requiredUndoBatchBaseIds) {
    const original = before.bases.find((entry) => entry.id === baseId);
    const projected = undone.store.bases.find((entry) => entry.id === baseId);
    const tokenBase = undone.token.bases.find((base) => base.baseId === baseId);
    assert.ok(original && projected && tokenBase);
    assert.deepEqual(projected.data.directIndexPaths, original.data.directIndexPaths);
    assert.deepEqual(projected.data.portableIndex, original.data.portableIndex);
    assert.deepEqual(projected.data.settings, original.data.settings, "settings are not in the batch snapshot");
    assert.deepEqual(projected.data.layoutSnapshots, original.data.layoutSnapshots, "named layouts are not in the batch snapshot");
    assert.equal(projected.data.selectedPath, `Browsing/${baseId}.md`, "route state is preserved");
    assert.equal(projected.data.activeTab, "inbox", "the current tab is preserved");
    assert.equal(projected.data.redoStack.length, 0);
    const top = projected.data.undoStack.at(-1);
    assert.ok(top);
    assert.equal(snapshotFingerprint(top), tokenBase.afterSnapshotFingerprint);
    assert.equal(projected.semanticHash, semanticEntryFingerprint(projected));
  }

  const redone = projectNoteOrganizerBatchTransition(undone.store, undone.token, "redo");
  assert.equal(redone.store.activeBaseId, "base-archive");
  assert.equal(redone.token.state, "applied");
  assert.equal(redone.token.transitionCount, 2);
  for (const baseId of redone.requiredUndoBatchBaseIds) {
    const appliedEntry = applied.bases.find((entry) => entry.id === baseId);
    const projected = redone.store.bases.find((entry) => entry.id === baseId);
    const tokenBase = redone.token.bases.find((base) => base.baseId === baseId);
    assert.ok(appliedEntry && projected && tokenBase);
    assert.deepEqual(projected.data.directIndexPaths, appliedEntry.data.directIndexPaths);
    assert.deepEqual(projected.data.portableIndex, appliedEntry.data.portableIndex);
    assert.equal(snapshotFingerprint(projected.data.undoStack.at(-1)), tokenBase.beforeSnapshotFingerprint);
    assert.equal(projected.data.redoStack.length, 0);
    assert.equal(projected.semanticRevision, appliedEntry.semanticRevision + 2);
    assert.equal(projected.semanticHash, semanticEntryFingerprint(projected));
  }
});

test("a semantic change in any affected base makes the whole batch stale", () => {
  const { before, applied, affectedBaseIds } = fixture();
  const token = tokenFor(before, applied, affectedBaseIds);
  const stale = cloneJsonValue(applied);
  const source = cloneJsonValue(stale.bases.find((entry) => entry.id === "base-reading"));
  const entry = stale.bases.find((candidate) => candidate.id === "base-reading");
  assert.ok(source && entry);
  entry.data.pinnedPaths.push("Notes/Concurrent.md");
  advanceSemanticEntry(entry, source, "concurrent-change");
  const unchanged = cloneJsonValue(stale);
  assert.throws(
    () => projectNoteOrganizerBatchTransition(stale, token, "undo"),
    /Reading.*changed after the Note Organizer batch/iu,
  );
  assert.deepEqual(stale, unchanged);
});

test("missing bases and a changed newest Undo entry fail before any projection", () => {
  const { before, applied, affectedBaseIds } = fixture();
  const token = tokenFor(before, applied, affectedBaseIds);

  const missing = cloneJsonValue(applied);
  missing.bases = missing.bases.filter((entry) => entry.id !== "base-ent");
  assert.throws(
    () => projectNoteOrganizerBatchTransition(missing, token, "undo"),
    /ENT.*unavailable/iu,
  );

  const changedHistory = cloneJsonValue(applied);
  const entry = changedHistory.bases.find((candidate) => candidate.id === "base-ent");
  assert.ok(entry);
  const unrelated = snapshotPersonal(entry.data, "Unrelated Undo", false, true);
  unrelated.at = APPLY_AT + 1;
  entry.data.undoStack.push(unrelated);
  const unchanged = cloneJsonValue(changedHistory);
  assert.throws(
    () => projectNoteOrganizerBatchTransition(changedHistory, token, "undo"),
    /newest Undo entry.*no longer matches/iu,
  );
  assert.deepEqual(changedHistory, unchanged);
});

test("required inverse snapshots are preflighted against the aggregate 4 MiB device-local limit", () => {
  const entry = createKnowledgeBaseEntry(data("Large"), "base-large", 100);
  const before = storeWith([entry], "vault-large-organizer-history");
  const applied = organizerApply(before, [entry.id], (destination) => {
    destination.data.displayNameByPath["Notes/Large.md"] = "x".repeat(MAX_DEVICE_LOCAL_STATE_BYTES + 65_536);
  });
  const token = tokenFor(before, applied, [entry.id]);
  const unchanged = cloneJsonValue(applied);
  assert.throws(
    () => projectNoteOrganizerBatchTransition(applied, token, "undo"),
    /exact inverse Undo snapshot.*4 MiB device-local limit/iu,
  );
  assert.deepEqual(applied, unchanged, "an oversized batch never mutates even its first base");
});

test("exact no-op Apply creates no history token, while omitted changes fail closed", () => {
  const entry = createKnowledgeBaseEntry(data("No-op"), "base-no-op", 100);
  const before = storeWith([entry], "vault-no-op-organizer-history");
  const same = cloneJsonValue(before);
  same.activeBaseId = before.activeBaseId;
  assert.equal(createNoteOrganizerBatchHistoryToken(before, same, {
    id: "no-op",
    label: LABEL,
    affectedBaseIds: [],
  }), null);

  const unlisted = cloneJsonValue(before);
  const changed = unlisted.bases[0];
  const parent = cloneJsonValue(changed);
  changed.data.directIndexPaths.push("Notes/Unlisted.md");
  advanceSemanticEntry(changed, parent, "unlisted-change");
  assert.throws(() => createNoteOrganizerBatchHistoryToken(before, unlisted, {
    id: "bad-no-op",
    label: LABEL,
    affectedBaseIds: [],
  }), /Unlisted knowledge base.*changed/iu);
});

test("token tampering and invalid direction are rejected", () => {
  const { before, applied, affectedBaseIds } = fixture();
  const token = tokenFor(before, applied, affectedBaseIds);
  assert.throws(
    () => projectNoteOrganizerBatchTransition(applied, token, "redo"),
    /cannot redo from its current state/iu,
  );
  const tampered = cloneJsonValue(token);
  tampered.bases[0].afterSnapshot.directIndexPaths.push("Notes/Tampered.md");
  assert.throws(
    () => projectNoteOrganizerBatchTransition(applied, tampered, "undo"),
    /token changed after it was created/iu,
  );
});
