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
