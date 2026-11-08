import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "./support/obsidian-stub.ts";
import EntVaultCommandCenterPlugin, { DEVICE_LOCAL_STATE_KEY } from "../src/main";
import {
  createDefaultStore,
  migrateData,
  snapshotPersonal,
  type LayoutHeading,
  type PluginData,
  type PluginStore,
} from "../src/model";
import type {
  NoteOrganizerDraft,
  OrganizerApplyResult,
  OrganizerPreparedPlan,
} from "../src/note-organizer-modal";

// WF-13 fixtures (prefix "WF13"). Everything here is synthetic. The reload step
// builds a brand-new plugin instance from the exact bytes the previous instance
// wrote to the primary store and to device-local storage, as D06's H02 does; it
// never keeps the earlier object alive.

interface Journey {
  loadedData: unknown;
  loadPluginData(persistMigration?: boolean): Promise<void>;
  prepareNoteOrganizer(draft: NoteOrganizerDraft): Promise<OrganizerPreparedPlan>;
  applyPreparedNoteOrganizer(token: unknown): Promise<OrganizerApplyResult>;
  applyNoteOrganizerBatchHistory(direction: "undo" | "redo"): Promise<void>;
  canUndoNoteOrganizerBatch(): boolean;
  canRedoNoteOrganizerBatch(): boolean;
}

const MANIFEST = { dir: ".obsidian/plugins/knowledge-base-command-center" } as never;
// Exactly the 100-character maximum the engine accepts for a Collection title.
const LONG_TITLE = "A long Collection title that wraps over several phone lines and still stores exactly as typed 1234567".padEnd(100, "x").slice(0, 100);

function genericData(): PluginData {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.setupComplete = true;
  data.settings.workspaceName = "Collections journey";
  data.settings.primaryFolder = "Journey Notes";
  data.settings.defaultNoteFolder = "Journey Notes";
  data.indexGroupOrder = ["General"];
  data.collections = [
    { id: "existing", title: "Existing shelf", subjects: [], collapsed: false, subheadings: [] },
  ];
  return data;
}

function storage(file: TFile) {
  const localValues = new Map<string, unknown>();
  const adapterFiles = new Map<string, string>();
  const primarySaves: PluginStore[] = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: (path: string) => (path === file.path ? file : null),
      adapter: {
        exists: async (path: string) => adapterFiles.has(path),
        read: async (path: string) => {
          const text = adapterFiles.get(path);
          if (text === undefined) throw new Error("missing");
          return text;
        },
        write: async (path: string, content: string) => { adapterFiles.set(path, content); },
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: (key: string) => structuredClone(localValues.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { localValues.set(key, structuredClone(value)); },
  };
  return { app, localValues, primarySaves };
}

async function start(app: unknown, primary: unknown, primarySaves: PluginStore[]) {
  const plugin = new EntVaultCommandCenterPlugin(app as never, MANIFEST);
  plugin.saveData = async (value: unknown) => { primarySaves.push(structuredClone(value) as PluginStore); };
  const journey = plugin as unknown as Journey;
  journey.loadedData = structuredClone(primary);
  await journey.loadPluginData(false);
  return { plugin, journey };
}

function walk(headings: readonly LayoutHeading[]): Array<{ trail: string[]; subjects: readonly string[] }> {
  const rows: Array<{ trail: string[]; subjects: readonly string[] }> = [];
  const visit = (node: { title: string; subjects: readonly string[]; subheadings?: readonly never[] }, trail: string[]): void => {
    const here = [...trail, node.title];
    rows.push({ trail: here, subjects: node.subjects });
    for (const child of (node.subheadings ?? []) as unknown as Array<typeof node>) visit(child, here);
  };
  for (const heading of headings) visit(heading as never, []);
  return rows;
}

/** Every Collection location holding the path, as "A / B / C" strings (exact occurrences). */
function occurrences(data: PluginData, path: string): string[] {
  return walk(data.collections)
    .flatMap((row) => row.subjects.filter((subject) => subject === path).map(() => row.trail.join(" / ")));
}

function titles(data: PluginData): string[] {
  return walk(data.collections).map((row) => row.trail.join(" / "));
}

function personal(plugin: EntVaultCommandCenterPlugin) {
  const snapshot = snapshotPersonal(plugin.data, "WF13 checkpoint", false, true);
  snapshot.at = 0;
  return snapshot;
}

function draft(baseId: string, path: string, targets: Array<{ headingId: string; subheadingId?: string }>, creations: NoteOrganizerDraft["collectionCreations"]): NoteOrganizerDraft {
  return {
    version: 1, source: "command", selectedPaths: [path], overrides: [],
    destinations: [{
      baseId,
      primary: { mode: "keep", libraryId: null, headingId: null, subheadingId: null },
      collections: { mode: "add", targets: targets.map((target) => ({ headingId: target.headingId, subheadingId: target.subheadingId ?? null })) },
    }],
    collectionCreations: creations,
  };
}

async function baseline() {
  const file = new TFile("Journey Notes/Open note.md");
  Object.assign(file.stat, { mtime: 3_000, size: 400 });
  const fixture = storage(file);
  const store = createDefaultStore(genericData(), 1, "vault-wf13-journey");
  const { plugin, journey } = await start(fixture.app, store, fixture.primarySaves);
  return { file, ...fixture, store, plugin, journey, baseId: plugin.getActiveKnowledgeBaseId() };
}

/** Restart: a new plugin built only from the last persisted primary store and device-local bytes. */
async function restart(fixture: Awaited<ReturnType<typeof baseline>>) {
  const persisted = fixture.primarySaves.at(-1);
  assert.ok(persisted, "the journey persisted a primary store");
  return start(fixture.app, persisted, []);
}

test("WF13 new Collection, heading and subheading: review, save, reopen, Undo, Redo and real reload keep the exact occurrence", async () => {
  const fixture = await baseline();
  const { plugin, journey, file, baseId } = fixture;
  const before = personal(plugin);
  const creations = [
    { baseId, id: "wf13-shelf", title: LONG_TITLE, headingId: null, parentSubheadingId: null },
    { baseId, id: "wf13-heading", title: "Books", headingId: "wf13-shelf", parentSubheadingId: null },
    { baseId, id: "wf13-sub", title: "This week", headingId: "wf13-shelf", parentSubheadingId: "wf13-heading" },
  ];
  const request = draft(baseId, file.path, [{ headingId: "wf13-shelf", subheadingId: "wf13-sub" }], creations);
  const trail = `${LONG_TITLE} / Books / This week`;

  const prepared = await journey.prepareNoteOrganizer(request);
  assert.deepEqual(prepared.errors, []);
  assert.deepEqual(prepared.reviewRows[0].after.collections, [`${LONG_TITLE} / Books / This week`]);
  assert.deepEqual(personal(plugin), before, "review alone writes no Collection or membership");
  assert.equal(fixture.primarySaves.length, 0);

  await journey.applyPreparedNoteOrganizer(prepared.preparedToken);
  assert.equal(fixture.primarySaves.length, 1, "save reaches the real storage boundary once");
  assert.deepEqual(occurrences(plugin.data, file.path), [trail], "exactly one occurrence at the exact path");
  assert.equal(journey.canUndoNoteOrganizerBatch(), true);
  assert.equal(journey.canRedoNoteOrganizerBatch(), false);

  // Reopen (the Organizer seeds from stored membership): exact target round-trips.
  assert.equal(titles(plugin.data).includes(trail), true);

  await journey.applyNoteOrganizerBatchHistory("undo");
  assert.deepEqual(personal(plugin), before, "Undo removes the created Collection tree and the membership together");
  assert.deepEqual(occurrences(plugin.data, file.path), []);
  assert.equal(journey.canRedoNoteOrganizerBatch(), true);

  await journey.applyNoteOrganizerBatchHistory("redo");
  assert.deepEqual(occurrences(plugin.data, file.path), [trail], "Redo restores the identical single occurrence");

  plugin.onunload();
  assert.ok(fixture.localValues.get(DEVICE_LOCAL_STATE_KEY), "device-local history was persisted");
  const second = await restart(fixture);
  assert.deepEqual(occurrences(second.plugin.data, file.path), [trail], "after a real reload the exact path and occurrence survive");
  assert.ok(second.plugin.data.undoStack.length >= 1, "bound Undo history survives the reload");

  // The multi-base batch token is in-session by design; after a reload the
  // restart-durable per-base Undo entry reverses the same transaction.
  await second.plugin.undo();
  assert.deepEqual(occurrences(second.plugin.data, file.path), []);
  assert.equal(titles(second.plugin.data).includes(trail), false);
  second.plugin.onunload();
});

test("WF13 existing Collection with a new subheading keeps sibling Collections and survives reload", async () => {
  const fixture = await baseline();
  const { plugin, journey, file, baseId } = fixture;
  const before = personal(plugin);
  const request = draft(baseId, file.path, [{ headingId: "existing", subheadingId: "wf13-new-sub" }], [
    { baseId, id: "wf13-new-sub", title: "Later", headingId: "existing", parentSubheadingId: null },
  ]);
  const prepared = await journey.prepareNoteOrganizer(request);
  assert.deepEqual(prepared.errors, []);
  await journey.applyPreparedNoteOrganizer(prepared.preparedToken);
  assert.deepEqual(occurrences(plugin.data, file.path), ["Existing shelf / Later"]);

  await journey.applyNoteOrganizerBatchHistory("undo");
  assert.deepEqual(personal(plugin), before);
  await journey.applyNoteOrganizerBatchHistory("redo");
  plugin.onunload();

  const second = await restart(fixture);
  assert.deepEqual(occurrences(second.plugin.data, file.path), ["Existing shelf / Later"]);
  assert.equal(second.plugin.data.collections.length, 1, "the existing Collection is not duplicated");
  second.plugin.onunload();
});

test("WF13 empty Collection state: the first Collection is created with the note in one commit", async () => {
  const file = new TFile("Journey Notes/Open note.md");
  Object.assign(file.stat, { mtime: 3_000, size: 400 });
  const fixture = storage(file);
  const data = genericData();
  data.collections = [];
  const { plugin, journey } = await start(fixture.app, createDefaultStore(data, 1, "vault-wf13-empty"), fixture.primarySaves);
  const baseId = plugin.getActiveKnowledgeBaseId();
  assert.deepEqual(plugin.data.collections, []);
  const prepared = await journey.prepareNoteOrganizer(draft(baseId, file.path, [{ headingId: "wf13-first" }], [
    { baseId, id: "wf13-first", title: "First shelf", headingId: null, parentSubheadingId: null },
  ]));
  assert.deepEqual(prepared.errors, []);
  await journey.applyPreparedNoteOrganizer(prepared.preparedToken);
  assert.deepEqual(occurrences(plugin.data, file.path), ["First shelf"]);
  await journey.applyNoteOrganizerBatchHistory("undo");
  assert.deepEqual(plugin.data.collections, []);
  plugin.onunload();
});

test("WF13 cancel before review and cancel after preview leave no Collection or membership behind", async () => {
  const fixture = await baseline();
  const { plugin, journey, file, baseId } = fixture;
  const before = personal(plugin);

  // Cancel before review: the draft is only UI state; nothing was handed to the engine.
  assert.deepEqual(personal(plugin), before);
  assert.equal(fixture.primarySaves.length, 0);

  // Cancel after preview: prepare, then abandon the token without Apply.
  const prepared = await journey.prepareNoteOrganizer(draft(baseId, file.path, [{ headingId: "wf13-gone", subheadingId: "wf13-gone-sub" }], [
    { baseId, id: "wf13-gone", title: "Canceled shelf", headingId: null, parentSubheadingId: null },
    { baseId, id: "wf13-gone-sub", title: "Canceled sub", headingId: "wf13-gone", parentSubheadingId: null },
  ]));
  assert.deepEqual(prepared.errors, []);
  assert.deepEqual(prepared.reviewRows[0].after.collections, ["Canceled shelf / Canceled sub"]);
  assert.deepEqual(personal(plugin), before, "a previewed, abandoned draft changes nothing");
  assert.equal(fixture.primarySaves.length, 0, "nothing reached storage");
  assert.equal(journey.canUndoNoteOrganizerBatch(), false, "no Undo step was created");
  assert.equal(titles(plugin.data).some((name) => /Canceled/u.test(name)), false);
  plugin.onunload();

  const second = await start(fixture.app, fixture.store, []);
  assert.equal(titles(second.plugin.data).some((name) => /Canceled/u.test(name)), false);
  assert.deepEqual(occurrences(second.plugin.data, file.path), []);
  second.plugin.onunload();
});
