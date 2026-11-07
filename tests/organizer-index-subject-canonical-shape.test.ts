import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin, { DEVICE_LOCAL_STATE_KEY } from "../src/main.ts";
import {
  createDefaultStore,
  createKnowledgeBaseEntry,
  migrateData,
  migrateStore,
  semanticEntryFingerprint,
  type PluginData,
  type PluginStore,
} from "../src/model.ts";
import { Notice, TFile } from "obsidian";
import { COMPLETE_PORTABLE_SELECTION, applyPortableExport, createPortableExport, parsePortableExport } from "../src/portability.ts";
import { mergeKnowledgeBaseStores } from "../src/store-merge.ts";

// D06-J. Synthetic data only. The real Organizer once wrote
// `portableIndex.subjects[i].libraryId: null` for a new Index subject while
// loading omits that key, so a live payload and its reloaded form hashed
// differently and a pending required Undo batch was dropped after a
// committed crash-window restart.

type TestPlugin = EntVaultCommandCenterPlugin & { loadedData: unknown; savedData: unknown[] };

function harness(primary: unknown, local: unknown, files: readonly TFile[]) {
  const values = new Map<string, unknown>();
  if (local !== null) values.set(DEVICE_LOCAL_STATE_KEY, structuredClone(local));
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [...files],
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      createFolder: async () => {},
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as TestPlugin;
  plugin.loadedData = structuredClone(primary);
  plugin.scheduleRefresh = () => {};
  plugin.refreshViews = async () => {};
  return { plugin, local: () => structuredClone(values.get(DEVICE_LOCAL_STATE_KEY) ?? null) };
}

function genericBase(name: string, folder: string): PluginData {
  const data = migrateData(null);
  Object.assign(data.settings, { workspaceMode: "generic", setupComplete: true, workspaceName: name, primaryFolder: folder, defaultNoteFolder: folder });
  data.indexGroupOrder = ["General"];
  return data;
}

function twoBaseStore(): PluginStore {
  const first = createKnowledgeBaseEntry(genericBase("Alpha", "Alpha Notes"), "base-alpha", 100);
  const second = createKnowledgeBaseEntry(genericBase("Beta", "Beta Notes"), "base-beta", 200);
  const store = createDefaultStore(genericBase("Alpha", "Alpha Notes"), 1, "vault-d06j");
  store.bases = [first, second];
  store.activeBaseId = first.id;
  return store;
}

function syntheticFile(): TFile {
  const file = new TFile("Notes/Synthetic.md");
  Object.assign(file.stat, { mtime: 2000, size: 512 });
  return file;
}

/** Real Organizer apply, paused at the primary save boundary (crash window). */
async function organizerCrashWindow(file: TFile) {
  const primary = twoBaseStore();
  const live = harness(primary, null, [file]);
  await live.plugin.loadPluginData(false);
  const options = live.plugin.noteOrganizerBaseOptions();
  const destinations = primary.bases.map((entry) => ({
    baseId: entry.id,
    primary: {
      mode: "index" as const,
      libraryId: null,
      headingId: options.find((option) => option.id === entry.id)!.indexHeadings.find((group) => group.name === "General")!.id,
      subheadingId: null,
    },
    collections: { mode: "keep" as const, targets: [] },
  }));
  const prepared = await live.plugin.prepareNoteOrganizer({
    version: 1, source: "command", selectedPaths: [file.path], overrides: [], destinations,
  } as never);
  assert.deepEqual(prepared.errors, []);
  let entered!: () => void;
  let release!: () => void;
  const reachedSave = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  live.plugin.saveData = async (value: unknown) => { live.plugin.savedData.push(structuredClone(value)); entered(); await gate; };
  const action = live.plugin.applyPreparedNoteOrganizer(prepared.preparedToken);
  await reachedSave;
  const pendingLocal = live.local();
  const candidate = structuredClone(live.plugin.savedData.at(-1)) as PluginStore;
  release();
  await action;
  return { candidate, pendingLocal };
}

test("D06-J: the Organizer writes the canonical Index subject shape (no libraryId key)", async () => {
  const file = syntheticFile();
  const { candidate } = await organizerCrashWindow(file);
  const reloaded = migrateStore(structuredClone(candidate));
  for (const entry of candidate.bases) {
    const subjects = entry.data.portableIndex.subjects;
    assert.ok(subjects.length > 0, "the Organizer created an Index subject");
    for (const subject of subjects) {
      assert.equal(subject.indexed, true);
      assert.equal(Object.prototype.hasOwnProperty.call(subject, "libraryId"), false, "Index subjects omit libraryId");
    }
    assert.equal(
      entry.semanticHash,
      reloaded.bases.find((base) => base.id === entry.id)!.semanticHash,
      "the committed hash equals the reloaded hash",
    );
  }
});

test("D06-J: a real two-base Organizer pending save then committed crash-window restart recovers the pending batch Undo", async () => {
  const file = syntheticFile();
  const { candidate, pendingLocal } = await organizerCrashWindow(file);
  const restart = harness(candidate, pendingLocal, [file]);
  Notice.messages.length = 0;
  await restart.plugin.loadPluginData(false);
  const stacks = restart.plugin.store.bases.map((entry) => ({ id: entry.id, undo: entry.data.undoStack.length, paths: entry.data.directIndexPaths }));
  assert.deepEqual(stacks.map((stack) => stack.undo), [1, 1], "both bases keep the staged Undo");
  for (const stack of stacks) assert.ok(stack.paths.includes(file.path), "the organization committed");
  assert.deepEqual(Notice.messages.filter((message) => /undo history was reset/i.test(message)), []);
  await restart.plugin.undo();
  assert.equal(restart.plugin.data.directIndexPaths.includes(file.path), false, "the recovered Undo reverts the active base");
});

test("D06-J control: a Library-assigned Organizer subject keeps its libraryId and reloads identically", async () => {
  const file = syntheticFile();
  const primary = twoBaseStore();
  primary.bases[0].data.portableIndex.libraries.push(
    { id: "lib-d06j", name: "Synthetic Library", singularName: "Item", icon: "book-open", order: 0, sourceKind: null, archivedAt: null },
  );
  primary.bases[0].data.portableIndex.libraryLayouts["lib-d06j"] = [];
  const live = harness(primary, null, [file]);
  await live.plugin.loadPluginData(false);
  const alpha = live.plugin.store.bases[0];
  const prepared = await live.plugin.prepareNoteOrganizer({
    version: 1, source: "command", selectedPaths: [file.path], overrides: [],
    destinations: [{
      baseId: alpha.id,
      primary: { mode: "library", libraryId: "lib-d06j" },
      collections: { mode: "keep", targets: [] },
    }],
  } as never);
  assert.deepEqual(prepared.errors, []);
  await live.plugin.applyPreparedNoteOrganizer(prepared.preparedToken);
  const saved = structuredClone(live.plugin.savedData.at(-1)) as PluginStore;
  const entry = saved.bases.find((base) => base.id === alpha.id)!;
  const subject = entry.data.portableIndex.subjects.find((candidate) => candidate.libraryId === "lib-d06j");
  assert.ok(subject, "the Library subject keeps libraryId");
  assert.equal(subject.indexed, false);
  assert.equal(entry.semanticHash, migrateStore(structuredClone(saved)).bases.find((base) => base.id === alpha.id)!.semanticHash);
});

test("D06-J limitation: an old unmatched journal written with the null shape keeps today's behaviour (Undo dropped, no migration recovery)", async () => {
  const file = syntheticFile();
  const { candidate, pendingLocal } = await organizerCrashWindow(file);
  // Re-create the OLD writer's payload: explicit null on the Index subject, hash computed from it.
  const legacy = structuredClone(candidate);
  const journal = structuredClone(pendingLocal) as { pendingRequiredUndoBatchCommit: { entries: Array<{ baseId: string; candidateSemanticHash: string }> } };
  for (const entry of legacy.bases) {
    for (const subject of entry.data.portableIndex.subjects) (subject as { libraryId?: string | null }).libraryId = null;
    entry.semanticHash = semanticEntryFingerprint(entry);
    const proof = journal.pendingRequiredUndoBatchCommit.entries.find((item) => item.baseId === entry.id)!;
    proof.candidateSemanticHash = entry.semanticHash;
  }
  const restart = harness(legacy, journal, [file]);
  await restart.plugin.loadPluginData(false);
  // The old journal proves the null-shape hash; loading normalizes it away. Fail closed.
  assert.deepEqual(restart.plugin.store.bases.map((entry) => entry.data.undoStack.length), [0, 0]);
});

test("D06-J: deleteLibrary to the Index persists the canonical shape and the finalized restart keeps its Undo", async () => {
  const file = syntheticFile();
  const data = genericBase("Synthetic", "Knowledge");
  data.portableIndex.groups = [{ id: "group-one", title: "General", order: 0 }];
  data.portableIndex.libraries.push(
    { id: "lib-d06j", name: "Synthetic Library", singularName: "Item", icon: "book-open", order: 0, sourceKind: null, archivedAt: 100 },
  );
  data.portableIndex.libraryLayouts["lib-d06j"] = [];
  data.portableIndex.subjects = [
    { id: "subject-one", title: "Synthetic", groupId: "group-one", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "topic", libraryId: "lib-d06j" },
  ];
  data.portableIndex.resolvedPathBySubjectId = { "subject-one": file.path };
  const live = harness(createDefaultStore(migrateData(data), 100, "vault-d06j-library-delete"), null, [file]);
  await live.plugin.loadPluginData(false);
  await live.plugin.deleteLibrary("lib-d06j", "index");
  const saved = structuredClone(live.plugin.savedData.at(-1)) as PluginStore;
  const subject = saved.bases[0].data.portableIndex.subjects[0];
  assert.equal(subject.indexed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(subject, "libraryId"), false, "an Index subject omits libraryId");
  assertStoreLoadCanonical(saved, "deleteLibrary to index");
  const restart = harness(saved, live.local(), [file]);
  await restart.plugin.loadPluginData(false);
  assert.equal(restart.plugin.data.undoStack.length, 1, "the finalized restart keeps the Undo");
});

// Guard: every representative mutation path leaves the LIVE payload already
// load-canonical, i.e. its semantic fingerprint equals the fingerprint of the
// same payload after a JSON round trip plus load normalization.
function assertLoadCanonical(entry: { createdAt: number; archivedAt: number | null; data: PluginData }, label: string): void {
  const live = semanticEntryFingerprint(entry);
  const reloaded = migrateData(JSON.parse(JSON.stringify(entry.data)) as unknown);
  assert.equal(
    live,
    semanticEntryFingerprint({ createdAt: entry.createdAt, archivedAt: entry.archivedAt, data: reloaded }),
    `${label}: the live payload is not load-canonical`,
  );
}

function assertStoreLoadCanonical(store: PluginStore, label: string): void {
  const reloaded = migrateStore(JSON.parse(JSON.stringify(store)) as unknown);
  for (const entry of store.bases) {
    const other = reloaded.bases.find((base) => base.id === entry.id)!;
    assert.equal(semanticEntryFingerprint(entry), semanticEntryFingerprint(other), `${label}: ${entry.id} is not load-canonical`);
  }
}

function subjectData(settings: PluginData["settings"]): PluginData {
  const data = genericBase("Source", "Source Notes");
  data.settings = settings;
  data.portableIndex.groups = [{ id: "group-general", title: "General", order: 0 }];
  data.portableIndex.libraries.push(
    { id: "lib-guard", name: "Guard Library", singularName: "Item", icon: "book-open", order: 0, sourceKind: null, archivedAt: null },
  );
  data.portableIndex.libraryLayouts["lib-guard"] = [];
  data.portableIndex.subjects = [
    { id: "subject-a", title: "Alpha", groupId: "group-general", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    { id: "subject-b", title: "Beta", groupId: "group-general", parentId: "subject-a", order: 1, indexed: true, configuredId: "", recordKind: "topic" },
    { id: "subject-c", title: "Gamma", groupId: "group-general", parentId: null, order: 2, indexed: false, configuredId: "", recordKind: "note", libraryId: "lib-guard" },
  ];
  return data;
}

test("D06-J guard: Organizer apply leaves the live payload load-canonical (new subject, and Library subject moved back to the Index)", async () => {
  const file = syntheticFile();
  const { candidate } = await organizerCrashWindow(file);
  assertStoreLoadCanonical(candidate, "organizer new subject");

  const primary = twoBaseStore();
  primary.bases[0].data.portableIndex.libraries.push(
    { id: "lib-guard", name: "Guard Library", singularName: "Item", icon: "book-open", order: 0, sourceKind: null, archivedAt: null },
  );
  primary.bases[0].data.portableIndex.libraryLayouts["lib-guard"] = [];
  const live = harness(primary, null, [file]);
  await live.plugin.loadPluginData(false);
  const baseId = live.plugin.store.bases[0].id;
  const generalId = live.plugin.noteOrganizerBaseOptions().find((o) => o.id === baseId)!.indexHeadings.find((g) => g.name === "General")!.id;
  const run = async (primaryDirective: unknown) => {
    const prepared = await live.plugin.prepareNoteOrganizer({
      version: 1, source: "command", selectedPaths: [file.path], overrides: [],
      destinations: [{ baseId, primary: primaryDirective, collections: { mode: "keep", targets: [] } }],
    } as never);
    assert.deepEqual(prepared.errors, []);
    await live.plugin.applyPreparedNoteOrganizer(prepared.preparedToken);
  };
  await run({ mode: "library", libraryId: "lib-guard" });
  assertLoadCanonical(live.plugin.store.bases[0], "organizer -> Library");
  await run({ mode: "index", libraryId: null, headingId: generalId, subheadingId: null });
  assertLoadCanonical(live.plugin.store.bases[0], "organizer Library -> Index");
  assert.ok(live.plugin.data.portableIndex.subjects.every((s) => !s.indexed || !Object.prototype.hasOwnProperty.call(s, "libraryId")));
});

test("D06-J guard: placeholder create, Library removal to Index, Undo and Redo keep the live payload load-canonical", async () => {
  const primary = twoBaseStore();
  primary.bases[0].data = subjectData(primary.bases[0].data.settings);
  const live = harness(primary, null, []);
  await live.plugin.loadPluginData(false);
  const check = (label: string) => assertLoadCanonical(live.plugin.store.bases[0], label);
  await live.plugin.createQuickEntryPlaceholder({ title: "Placeholder", group: "General" });
  check("placeholder create");
  await live.plugin.archiveLibrary("lib-guard");
  await live.plugin.deleteLibrary("lib-guard", "index");
  check("Library removed to Index");
  await live.plugin.undo();
  check("Undo");
  await live.plugin.redo();
  check("Redo");
});

test("D06-J guard: create-from-record, reset-to-Index and bulk restoreRecordsToIndex keep the live payload load-canonical", async () => {
  const fresh = new TFile("Notes/Fresh.md");
  const owned = new TFile("Notes/Owned.md");
  const bulk = new TFile("Notes/Bulk.md");
  for (const file of [fresh, owned, bulk]) Object.assign(file.stat, { mtime: 2000, size: 512 });
  const primary = twoBaseStore();
  primary.bases[0].data = subjectData(primary.bases[0].data.settings);
  const live = harness(primary, null, [fresh, owned, bulk]);
  await live.plugin.loadPluginData(false);
  const check = (label: string) => {
    assertLoadCanonical(live.plugin.store.bases[0], label);
    assert.ok(
      live.plugin.data.portableIndex.subjects.every((s) => !s.indexed || !Object.prototype.hasOwnProperty.call(s, "libraryId")),
      `${label}: an Index subject carries libraryId`,
    );
  };
  // create-from-record: a note with no subject yet is created directly in the Index.
  await live.plugin.assignRecordToCatalog(fresh.path, "topic");
  check("create-from-record (Index)");
  // create-from-record into a Library, then reset that existing subject to the Index (~8676).
  await live.plugin.assignRecordToLibrary(owned.path, "lib-guard");
  check("create-from-record (Library)");
  await live.plugin.assignRecordToCatalog(owned.path, "topic");
  check("reset-to-Index via assignRecordToDestination");
  // Bulk restore (~8870): a Library-held subject bound to a path is restored to the Index.
  await live.plugin.assignRecordToLibrary(bulk.path, "lib-guard");
  check("bulk fixture in Library");
  await live.plugin.restoreRecordsToIndex([bulk.path]);
  check("restoreRecordsToIndex");
  const restored = live.plugin.data.portableIndex.subjects.find((s) => live.plugin.data.portableIndex.resolvedPathBySubjectId[s.id] === bulk.path);
  assert.equal(restored?.indexed, true, "the bulk restore moved the subject to the Index");
});

test("D06-J guard: portable import (replace and merge) and store merge leave payloads load-canonical", () => {
  const source = subjectData(genericBase("Source", "Source Notes").settings);
  const selection = { ...COMPLETE_PORTABLE_SELECTION, libraryIds: ["lib-guard"] };
  const exported = JSON.parse(JSON.stringify(createPortableExport(source, [], selection, "2026-09-19T00:00:00.000Z"))) as {
    components: { index: { subjects: Array<Record<string, unknown>> } };
  };
  // A portable package declares libraryId: null for Index subjects (no vault records are needed here).
  const groupId = "group-index-guard";
  (exported.components.index as unknown as { groups: unknown[] }).groups.push({ id: groupId, title: "General", order: 5 });
  exported.components.index.subjects.push(
    { id: "subject-a", title: "Alpha", groupId, parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic", libraryId: null },
    { id: "subject-b", title: "Beta", groupId, parentId: "subject-a", order: 1, indexed: true, configuredId: "", recordKind: "topic", libraryId: null },
  );
  const bundle = parsePortableExport(exported);
  for (const mode of ["replace", "merge"] as const) {
    const destination = genericBase("Dest", "Dest Notes");
    destination.portableIndex.groups = [{ id: "group-general", title: "General", order: 0 }];
    destination.portableIndex.subjects = [
      { id: "subject-a", title: "Alpha", groupId: "group-general", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ];
    applyPortableExport(destination, bundle, selection, mode);
    assert.equal(destination.portableIndex.subjects.length, 3, `${mode} imported subjects: ${JSON.stringify(destination.portableIndex.subjects)} bundle ${JSON.stringify(bundle.components.index?.subjects)}`);
    assertLoadCanonical({ createdAt: 1, archivedAt: null, data: destination }, `portable import ${mode}`);
  }
  const local = twoBaseStore();
  local.bases[0].data = subjectData(local.bases[0].data.settings);
  const incoming = structuredClone(local);
  incoming.bases[0].data.portableIndex.subjects[0].title = "Alpha renamed";
  const merged = mergeKnowledgeBaseStores(local, incoming);
  assertStoreLoadCanonical(merged.store, "store merge");
});
