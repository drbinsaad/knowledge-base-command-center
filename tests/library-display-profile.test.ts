import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LIBRARY_DISPLAY_PROFILE,
  MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH,
  normalizeLibraryDisplayProfile,
  validateLibraryDisplayProfile,
} from "../src/library-display-profile";
import {
  applyPersonalBackupToData,
  cleanLibraryDisplayProfiles,
  createDefaultStore,
  createPersonalBackup,
  createWorkspaceConfig,
  boundedSemanticLineage,
  DATA_VERSION,
  enforceStoredTextBounds,
  MAX_LIBRARIES,
  migrateData,
  migrateStore,
  normalizeKnowledgeBaseLibrariesAndNavigation,
  nextSemanticHead,
  parsePersonalBackup,
  parseWorkspaceConfig,
  pluginDataSemanticallyEqual,
  semanticEntryFingerprint,
  restoreSnapshot,
  snapshotPersonal,
  STORE_VERSION,
} from "../src/model";
import {
  applyPortableExport,
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  parsePortableExport,
  selectionAvailableForExport,
} from "../src/portability";
import { mergeKnowledgeBaseStores } from "../src/store-merge";

const workspaceSelection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
const exportedAt = "2026-09-13T00:00:00.000Z";
const gallery = normalizeLibraryDisplayProfile({ layout: "cards", cardSize: "large", imageProperty: "book_cover" });

function libraryData() {
  const data = migrateData(null);
  data.portableIndex.libraries = [{
    id: "library-books", name: "Books", singularName: "Book", icon: "book-open",
    order: 0, sourceKind: null, archivedAt: null,
  }];
  data.portableIndex.libraryLayouts = { "library-books": [] };
  data.settings.libraryDisplayProfiles = { "library-books": structuredClone(gallery) };
  return data;
}

test("display profiles normalize independent defaults and reject unsafe property keys", () => {
  const defaults = normalizeLibraryDisplayProfile(undefined);
  assert.deepEqual(defaults, DEFAULT_LIBRARY_DISPLAY_PROFILE);
  defaults.visibleProperties.push("year");
  assert.deepEqual(normalizeLibraryDisplayProfile(undefined).visibleProperties, ["author", "reading_status"]);
  assert.deepEqual(normalizeLibraryDisplayProfile({
    layout: "unknown", imageProperty: "__proto__", imageRatio: "wide", imageFit: "stretch",
    visibleProperties: [" author ", "author", "constructor", "prototype", "year", "bad\nkey", "extra"],
  }), { ...DEFAULT_LIBRARY_DISPLAY_PROFILE, visibleProperties: ["author", "year"] });
  assert.deepEqual(normalizeLibraryDisplayProfile({ visibleProperties: [] }).visibleProperties, []);
  assert.equal(normalizeLibraryDisplayProfile(Object.create({ layout: "cards", imageProperty: "remote" })).layout, "list");
  assert.deepEqual(cleanLibraryDisplayProfiles(JSON.parse('{"__proto__":{"layout":"cards"},"constructor":{},"library-a":null,"library-b":{"layout":"cards"}}') as unknown), {
    "library-b": normalizeLibraryDisplayProfile({ layout: "cards" }),
  });
  assert.deepEqual(cleanLibraryDisplayProfiles({ "library-a": gallery }, new Set(["library-b"])), {});
});

test("interactive display validation rejects unsupported input before any save", () => {
  assert.equal(validateLibraryDisplayProfile(gallery), null);
  assert.equal(validateLibraryDisplayProfile({ visibleProperties: [] }), null);
  for (const bad of [null, [], { layout: "table" }, { cardSize: "huge" }, { imageRatio: "wide" },
    { imageFit: "stretch" }, { imageProperty: "constructor" }, { imageProperty: "toString" }, { visibleProperties: ["__proto__"] },
    { visibleProperties: Array(7).fill("author") }, { imageProperty: "x".repeat(129) }, { allowRemoteImages: true }]) {
    assert.equal(typeof validateLibraryDisplayProfile(bad), "string");
  }
});

test("v15 migration preserves organization and introduces bounded semantic display profiles", () => {
  const old = libraryData() as unknown as Record<string, unknown>;
  old.version = 15;
  delete (old.settings as Record<string, unknown>).libraryDisplayProfiles;
  const data = migrateData(old);
  assert.equal(data.version, DATA_VERSION);
  assert.deepEqual(data.settings.libraryDisplayProfiles, {});
  assert.equal(data.portableIndex.libraries[0]?.name, "Books");
  const changed = structuredClone(data);
  changed.settings.libraryDisplayProfiles["library-books"] = gallery;
  assert.equal(pluginDataSemanticallyEqual(data, changed), false);
  assert.equal(STORE_VERSION, 17);
  assert.equal(DATA_VERSION, 17);
  const store = createDefaultStore(changed, 100);
  assert.deepEqual(migrateStore(store).bases[0]?.data.settings.libraryDisplayProfiles, changed.settings.libraryDisplayProfiles);
  delete old.indexFolderSources;
  assert.throws(() => migrateData(old), /membership provenance/i, "v15 provenance remains required after the version bump");
});

test("display settings survive archive, rename, Undo and persisted history, then prune deleted IDs", () => {
  const data = libraryData();
  const before = snapshotPersonal(data, "Display settings", true, true);
  data.settings.libraryDisplayProfiles["library-books"] = normalizeLibraryDisplayProfile({ layout: "list" });
  restoreSnapshot(data, before);
  assert.deepEqual(data.settings.libraryDisplayProfiles["library-books"], gallery);
  data.undoStack = [before];
  const reloaded = migrateData(data);
  assert.deepEqual(reloaded.undoStack[0]?.settings?.libraryDisplayProfiles["library-books"], gallery);
  data.portableIndex.libraries[0].name = "Reading";
  data.portableIndex.libraries[0].archivedAt = 100;
  normalizeKnowledgeBaseLibrariesAndNavigation(data);
  assert.deepEqual(data.settings.libraryDisplayProfiles["library-books"], gallery);
  data.portableIndex.libraries = [];
  normalizeKnowledgeBaseLibrariesAndNavigation(data);
  assert.deepEqual(data.settings.libraryDisplayProfiles, {});
});

test("Workspace and portable exports carry display Library dependencies without note content or remote consent", () => {
  const source = libraryData();
  source.settings.libraryDisplayProfiles["library-missing"] = gallery;
  const workspace = createWorkspaceConfig(source, exportedAt);
  assert.equal(workspace.version, 3);
  assert.deepEqual(Object.keys(workspace.settings.libraryDisplayProfiles), ["library-books"]);
  assert.deepEqual(parseWorkspaceConfig(workspace).settings.libraryDisplayProfiles["library-books"], gallery);
  const value = parsePortableExport(createPortableExport(source, [], workspaceSelection, exportedAt));
  assert.equal(value.version, 7);
  assert.deepEqual(value.components.index?.libraries?.map((library) => library.id), ["library-books"]);
  assert.deepEqual(value.components.index?.subjects, []);
  assert.deepEqual(selectionAvailableForExport(value).libraryIds, []);
  const target = migrateData(null);
  applyPortableExport(target, value, workspaceSelection, "replace");
  assert.equal(target.portableIndex.libraries[0]?.name, "Books");
  assert.deepEqual(target.settings.libraryDisplayProfiles["library-books"], gallery);
  const missing = structuredClone(value);
  missing.components.index!.libraries = [];
  assert.throws(() => parsePortableExport(missing), /without a definition/i);
  assert.equal("allowRemoteImages" in target.settings, false);
  assert.throws(() => parseWorkspaceConfig({ ...workspace, version: 4 }), /Unsupported/i);
  assert.throws(() => parsePortableExport({ ...value, version: 8 }), /Unsupported/i);
});

test("workspace profile imports keep destination IDs, archive decisions and unrelated Library layouts", () => {
  const source = libraryData();
  const value = parsePortableExport(createPortableExport(source, [], workspaceSelection, exportedAt));
  const target = libraryData();
  target.portableIndex.libraries[0].name = "Local reading";
  target.portableIndex.libraries[0].archivedAt = 100;
  target.portableIndex.libraryLayouts["library-books"] = [{ id: "local", title: "Local shelf", collapsed: false, subjects: [], subheadings: [] }];
  applyPortableExport(target, value, workspaceSelection, "merge");
  assert.equal(target.portableIndex.libraries[0]?.name, "Local reading");
  assert.equal(target.portableIndex.libraries[0]?.archivedAt, 100);
  assert.equal(target.portableIndex.libraryLayouts["library-books"]?.[0]?.title, "Local shelf");
  assert.deepEqual(target.settings.libraryDisplayProfiles["library-books"], gallery);
});

test("older Workspace packages preserve gallery preferences and omitted Workspace never imports them", () => {
  const source = libraryData();
  const older = createPortableExport(source, [], workspaceSelection, exportedAt);
  older.version = 5;
  older.components.index!.version = 5;
  older.components.workspace!.version = 2;
  delete (older.components.workspace!.settings as unknown as Record<string, unknown>).libraryDisplayProfiles;
  const target = libraryData();
  target.settings.libraryDisplayProfiles["library-books"].cardSize = "small";
  applyPortableExport(target, parsePortableExport(older), workspaceSelection, "replace");
  assert.equal(target.settings.libraryDisplayProfiles["library-books"]?.cardSize, "small");
  const onlyLibrary = { ...EMPTY_PORTABLE_SELECTION, libraryIds: ["library-books"] };
  const catalog = parsePortableExport(createPortableExport(source, [], onlyLibrary, exportedAt));
  applyPortableExport(target, catalog, onlyLibrary, "replace");
  assert.equal(target.settings.libraryDisplayProfiles["library-books"]?.cardSize, "small");
  source.portableIndex.libraries[0].archivedAt = 100;
  assert.deepEqual(createWorkspaceConfig(source, exportedAt).settings.libraryDisplayProfiles, {});
});

test("synced gallery edits retain causality and cannot be overwritten by a stale device's view changes", () => {
  const original = createDefaultStore(libraryData(), 100, "vault-display");
  const edited = structuredClone(original);
  const entry = edited.bases[0];
  const parentHead = entry.semanticHead;
  entry.data.settings.libraryDisplayProfiles["library-books"].cardSize = "small";
  entry.semanticRevision += 1;
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = nextSemanticHead(parentHead, entry.semanticHash);
  entry.semanticLineage = boundedSemanticLineage([parentHead], entry.semanticHead);
  entry.updatedAt += 1;
  original.bases[0].data.selectedPath = "Books/Selected.md";
  original.bases[0].updatedAt += 1_000;
  for (const result of [mergeKnowledgeBaseStores(original, edited), mergeKnowledgeBaseStores(edited, original)]) {
    assert.equal(result.store.bases[0]?.data.settings.libraryDisplayProfiles["library-books"]?.cardSize, "small");
    assert.equal(result.semanticConflicts.length, 0);
  }
});

test("current recovery restores display settings while v11 recovery preserves destination profiles", () => {
  const source = libraryData();
  source.layoutSnapshots = [snapshotPersonal(source, "Shelf", true, true)];
  const backup = createPersonalBackup(source, exportedAt, "vault-test", "base-default", "Test");
  assert.equal(backup.version, 13);
  const parsed = parsePersonalBackup(backup);
  assert.deepEqual(parsed.libraryDisplayProfiles, source.settings.libraryDisplayProfiles);
  assert.deepEqual(parsed.layoutSnapshots[0]?.settings?.libraryDisplayProfiles, source.settings.libraryDisplayProfiles);
  const target = libraryData();
  target.settings.libraryDisplayProfiles = {};
  applyPersonalBackupToData(target, parsed);
  assert.deepEqual(target.settings.libraryDisplayProfiles, source.settings.libraryDisplayProfiles);
  const older = { ...backup, version: 11 } as Record<string, unknown>;
  delete older.libraryDisplayProfiles;
  target.settings.libraryDisplayProfiles["library-books"] = normalizeLibraryDisplayProfile({ cardSize: "small" });
  applyPersonalBackupToData(target, parsePersonalBackup(older));
  assert.equal(target.settings.libraryDisplayProfiles["library-books"]?.cardSize, "small");
  const malformed = { ...backup } as Record<string, unknown>;
  delete malformed.libraryDisplayProfiles;
  assert.throws(() => parsePersonalBackup(malformed), /missing its Library display settings/i);
  assert.throws(() => parsePersonalBackup({ ...backup, version: 14 }), /Unsupported/i);
});

test("raw display profiles cannot evade load, transfer or pre-save bounds", () => {
  for (const malformed of [
    { "library-books": { imageProperty: "x".repeat(MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH + 1) } },
    { "library-books": { visibleProperties: Array(7).fill("year") } },
    Object.fromEntries(Array.from({ length: MAX_LIBRARIES + 1 }, (_, index) => [`library-${index}`, {}])),
  ]) {
    const raw = libraryData() as unknown as { settings: { libraryDisplayProfiles: unknown } };
    raw.settings.libraryDisplayProfiles = malformed;
    assert.throws(() => migrateData(raw), /too long|at most|too many/i);
    const workspace = createWorkspaceConfig(libraryData(), exportedAt) as unknown as { settings: { libraryDisplayProfiles: unknown } };
    workspace.settings.libraryDisplayProfiles = malformed;
    assert.throws(() => parseWorkspaceConfig(workspace), /too long|at most|too many/i);
  }
  const bounded = libraryData();
  bounded.settings.libraryDisplayProfiles["library-books"].imageProperty = "x".repeat(200);
  bounded.settings.libraryDisplayProfiles["library-books"].visibleProperties = Array(20).fill("author");
  enforceStoredTextBounds(bounded);
  assert.equal(bounded.settings.libraryDisplayProfiles["library-books"]?.imageProperty, "cover");
  assert.deepEqual(migrateData(bounded).settings.libraryDisplayProfiles, bounded.settings.libraryDisplayProfiles);
});
