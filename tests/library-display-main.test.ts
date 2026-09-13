import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import EntVaultCommandCenterPlugin, { LEGACY_LIBRARY_IMAGE_PERMISSION_KEY } from "../src/main";
import { EntVaultCommandCenterView } from "../src/view";
import { applyPersonalBackupToData, createDefaultStore, createPersonalBackup, migrateData, parsePersonalBackup, type PluginStore } from "../src/model";
import { normalizeLibraryDisplayProfile, type LibraryDisplayProfile } from "../src/library-display-profile";
import { applyPortableExport, createPortableExport, EMPTY_PORTABLE_SELECTION, parsePortableExport } from "../src/portability";
import { resolveLibraryCover } from "../src/library-cover";

async function fixture(localState = new Map<string, unknown>(), storedData?: unknown) {
  const data = migrateData(null);
  Object.assign(data.settings, { workspaceMode: "generic", setupComplete: true, workspaceName: "Synthetic books" });
  data.portableIndex.libraries = ["books", "papers"].map((id, order) => ({
    id, name: id, singularName: "item", icon: "book", order, sourceKind: null, archivedAt: null,
  }));
  const file = new TFile("Books/Example.md");
  let mutations = 0;
  let failStorage = false;
  const legacyPermissionReads: string[] = [];
  const legacyPermissionWrites: unknown[] = [];
  const forbidden = (): never => { mutations += 1; throw new Error("Unexpected note mutation"); };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView;
  view.reload = async () => {};
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [file], getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      create: forbidden, modify: forbidden, process: forbidden, rename: forbidden, delete: forbidden },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: { renameFile: forbidden, processFrontMatter: forbidden },
    workspace: { getLeavesOfType: () => [{ view }] },
    loadLocalStorage: (key: string) => {
      if (key === LEGACY_LIBRARY_IMAGE_PERMISSION_KEY) legacyPermissionReads.push(key);
      return structuredClone(localState.get(key) ?? null);
    },
    saveLocalStorage: (key: string, value: unknown) => {
      if (failStorage) throw new Error("Synthetic storage failure");
      if (key === LEGACY_LIBRARY_IMAGE_PERMISSION_KEY) legacyPermissionWrites.push(structuredClone(value));
      localState.set(key, structuredClone(value));
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & {
    loadedData: unknown; savedData: unknown[];
  };
  plugin.loadedData = storedData ?? createDefaultStore(data, 1, "vault-library-display-test");
  await plugin.loadPluginData(false);
  return { plugin, app, localState, legacyPermissionReads, legacyPermissionWrites, mutations: () => mutations,
    failStorage: () => { failStorage = true; } };
}

const cards = () => normalizeLibraryDisplayProfile({ layout: "cards", visibleProperties: ["author", "year"], cardSize: "large" });

test("Library display saves independently, clones inputs and outputs, and supports exact Undo/Redo without editing notes", async () => {
  const { plugin, mutations } = await fixture();
  const input = cards();
  await plugin.setLibraryDisplayProfile("books", input);
  input.visibleProperties.push("injected");
  const result = plugin.getLibraryDisplayProfile("books");
  result.visibleProperties.push("injected");
  assert.deepEqual(plugin.getLibraryDisplayProfile("books"), cards());
  assert.equal(plugin.getLibraryDisplayProfile("papers").layout, "list");
  assert.equal(plugin.data.undoStack.length, 1);
  await plugin.setLibraryDisplayProfile("books", cards());
  assert.equal(plugin.data.undoStack.length, 1, "no-op has no extra history");
  await plugin.undo();
  assert.equal(plugin.getLibraryDisplayProfile("books").layout, "list");
  await plugin.redo();
  assert.deepEqual(plugin.getLibraryDisplayProfile("books"), cards());
  await plugin.setLibraryDisplayProfile("books", null);
  assert.equal(plugin.getLibraryDisplayProfile("books").layout, "list");
  await plugin.undo();
  assert.deepEqual(plugin.getLibraryDisplayProfile("books"), cards());
  assert.equal(mutations(), 0);
});

test("Library display rejects unsupported profiles and missing IDs before writes", async () => {
  const { plugin } = await fixture();
  const saved = plugin.savedData.length;
  for (const input of [{ layout: "html" }, { imageProperty: "__proto__" }, { visibleProperties: Array(7).fill("author") },
    { ...cards(), externalImagesAllowed: true }]) {
    await assert.rejects(plugin.setLibraryDisplayProfile("books", input as unknown as LibraryDisplayProfile));
  }
  await assert.rejects(plugin.setLibraryDisplayProfile("missing", cards()));
  assert.equal(plugin.savedData.length, saved);
  assert.deepEqual(plugin.data.settings.libraryDisplayProfiles, {});
});

test("display settings require durable Undo and reject changes to the queued Library", async () => {
  const { plugin, failStorage } = await fixture();
  failStorage();
  await assert.rejects(plugin.setLibraryDisplayProfile("books", cards()));
  assert.deepEqual(plugin.data.settings.libraryDisplayProfiles, {});
  const other = await fixture();
  other.plugin.mutate = async (_label, action) => {
    other.plugin.data.portableIndex.libraries[0].name = "Changed while queued";
    action();
  };
  await assert.rejects(other.plugin.setLibraryDisplayProfile("books", cards()), /Library changed/);
  assert.deepEqual(other.plugin.data.settings.libraryDisplayProfiles, {});
});

test("archive retains display settings; deleting an archived custom Library clears them with required Undo", async () => {
  const { plugin, mutations } = await fixture();
  await plugin.setLibraryDisplayProfile("books", cards());
  await plugin.archiveLibrary("books");
  assert.deepEqual(plugin.getLibraryDisplayProfile("books"), cards());
  await plugin.deleteLibrary("books");
  assert.equal(plugin.getLibrary("books"), null);
  assert.equal(Object.hasOwn(plugin.data.settings.libraryDisplayProfiles, "books"), false);
  await plugin.undo();
  assert.ok(plugin.getLibrary("books"));
  assert.deepEqual(plugin.getLibraryDisplayProfile("books"), cards());
  assert.equal(mutations(), 0);
});

function assertOnlineCoversUnavailable(plugin: EntVaultCommandCenterPlugin): void {
  assert.equal(Reflect.has(plugin, "getExternalLibraryImagesAllowed"), false);
  assert.equal(Reflect.has(plugin, "setExternalLibraryImagesAllowed"), false);
  assert.equal(resolveLibraryCover(plugin.app, "https://covers.invalid/book.png", "Books/Example.md").state, "blocked");
}

test("legacy image permission values are never read and cannot enable online covers", async () => {
  for (const value of [null, true, "true", { version: 1, externalImagesAllowed: true },
    { version: 1, externalImagesAllowed: false }, { version: 2, externalImagesAllowed: true },
    { version: 1, externalImagesAllowed: "true" }, { version: 1, externalImagesAllowed: true, extra: 1 }, [1, true]]) {
    const { plugin, legacyPermissionReads, legacyPermissionWrites } = await fixture(new Map([[LEGACY_LIBRARY_IMAGE_PERMISSION_KEY, value]]));
    await plugin.setLibraryDisplayProfile("books", cards());
    assertOnlineCoversUnavailable(plugin);
    assert.deepEqual(legacyPermissionReads, []);
    assert.deepEqual(legacyPermissionWrites, []);
    assert.equal(JSON.stringify(plugin.data).includes("externalImagesAllowed"), false);
  }
});

test("explicit local-data cleanup clears the inert legacy permission without writing synced data or notes", async () => {
  const { plugin, localState, legacyPermissionReads, legacyPermissionWrites, mutations } = await fixture(new Map([
    [LEGACY_LIBRARY_IMAGE_PERMISSION_KEY, { version: 1, externalImagesAllowed: true }],
  ]));
  const saved = plugin.savedData.length;
  await plugin.clearDeviceLocalData();
  assert.equal(localState.get(LEGACY_LIBRARY_IMAGE_PERMISSION_KEY), null);
  assert.deepEqual(legacyPermissionReads, []);
  assert.deepEqual(legacyPermissionWrites, [null]);
  assertOnlineCoversUnavailable(plugin);
  assert.equal(plugin.savedData.length, saved);
  assert.equal(mutations(), 0);
});

test("failed legacy-key cleanup cannot re-enable online covers, including after restart", async () => {
  const legacy = { version: 1, externalImagesAllowed: true };
  const current = await fixture(new Map([[LEGACY_LIBRARY_IMAGE_PERMISSION_KEY, legacy]]));
  current.failStorage();
  await assert.rejects(current.plugin.clearDeviceLocalData(), /could not be cleared/);
  assert.deepEqual(current.localState.get(LEGACY_LIBRARY_IMAGE_PERMISSION_KEY), legacy);
  assertOnlineCoversUnavailable(current.plugin);
  const restarted = await fixture(current.localState);
  assertOnlineCoversUnavailable(restarted.plugin);
  assert.deepEqual(current.legacyPermissionReads, []);
  assert.deepEqual(restarted.legacyPermissionReads, []);
});

test("unavailable local storage has no online-image capability to enable", async () => {
  const { plugin, app } = await fixture();
  app.loadLocalStorage = () => { throw new Error("Unreadable"); };
  Reflect.deleteProperty(app, "saveLocalStorage");
  assertOnlineCoversUnavailable(plugin);
  await assert.rejects(plugin.clearDeviceLocalData(), /device-local storage API is unavailable/);
  assertOnlineCoversUnavailable(plugin);
});

for (const legacyAllowed of [false, true]) {
  test(`Workspace import, Undo/Redo, recovery and Sync cannot enable online covers with legacy permission ${legacyAllowed}`, async () => {
    const current = await fixture(new Map([[LEGACY_LIBRARY_IMAGE_PERMISSION_KEY, { version: 1, externalImagesAllowed: legacyAllowed }]]));
    const { plugin, localState, legacyPermissionReads, legacyPermissionWrites } = current;
    const permissionBefore = structuredClone(localState.get(LEGACY_LIBRARY_IMAGE_PERMISSION_KEY));
    const assertPermissionUnchanged = (): void => {
      assertOnlineCoversUnavailable(plugin);
      assert.deepEqual(localState.get(LEGACY_LIBRARY_IMAGE_PERMISSION_KEY), permissionBefore);
      assert.deepEqual(legacyPermissionReads, [], "no transfer or history action reads legacy permission");
      assert.deepEqual(legacyPermissionWrites, [], "only explicit cleanup may touch legacy permission");
      assert.equal(JSON.stringify(plugin.data).includes("externalImagesAllowed"), false);
    };
    const selection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
    const source = structuredClone(plugin.data);
    source.settings.libraryDisplayProfiles.books = cards();
    const rawPackage = createPortableExport(source, [], selection, "2026-09-13T00:00:00.000Z");
    assert.ok(rawPackage.components.workspace);
    Object.assign(rawPackage, { externalImagesAllowed: true });
    Object.assign(rawPackage.components.workspace.settings, { externalImagesAllowed: true });
    Object.assign(rawPackage.components.workspace.settings.libraryDisplayProfiles.books, { externalImagesAllowed: true });
    const value = parsePortableExport(rawPackage);
    await plugin.mutate("Import synthetic Workspace", () => {
      applyPortableExport(plugin.data, value, selection, "replace");
    }, { includeSettings: true, includePortableIndex: true, requireUndo: true });
    assert.equal(plugin.getLibraryDisplayProfile("books").layout, "cards");
    assertPermissionUnchanged();
    await plugin.undo();
    assert.equal(plugin.getLibraryDisplayProfile("books").layout, "list");
    assertPermissionUnchanged();
    await plugin.redo();
    assert.equal(plugin.getLibraryDisplayProfile("books").layout, "cards");
    assertPermissionUnchanged();

    const recoverySource = structuredClone(plugin.data);
    recoverySource.settings.libraryDisplayProfiles.books.cardSize = "small";
    const rawRecovery = createPersonalBackup(recoverySource, "2026-09-13T00:00:00.000Z", plugin.getVaultId(), plugin.getActiveKnowledgeBaseId(), plugin.data.settings.workspaceName);
    Object.assign(rawRecovery, { externalImagesAllowed: true });
    assert.ok(rawRecovery.libraryDisplayProfiles);
    Object.assign(rawRecovery.libraryDisplayProfiles.books, { externalImagesAllowed: true });
    const recovery = parsePersonalBackup(rawRecovery);
    await plugin.mutate("Restore synthetic recovery", () => {
      applyPersonalBackupToData(plugin.data, recovery);
    }, { includeSettings: true, includePortableIndex: true, includeLayoutSnapshots: true, requireUndo: true, normalizeAfterRestore: true });
    assert.equal(plugin.getLibraryDisplayProfile("books").cardSize, "small");
    assertPermissionUnchanged();
    await plugin.undo();
    assert.equal(plugin.getLibraryDisplayProfile("books").cardSize, "large");
    assertPermissionUnchanged();
    await plugin.redo();
    assert.equal(plugin.getLibraryDisplayProfile("books").cardSize, "small");
    assertPermissionUnchanged();

    // Two isolated synthetic App-local maps exercise the real Sync callback;
    // this is a runtime regression, not physical two-device Sync evidence.
    const remote = await fixture(new Map(), plugin.savedData.at(-1));
    await remote.plugin.setLibraryDisplayProfile("books", { ...cards(), imageRatio: "landscape" });
    const incoming = structuredClone(remote.plugin.savedData.at(-1)) as PluginStore;
    const incomingBase = incoming.bases[0];
    assert.ok(incomingBase);
    Object.assign(incoming, { externalImagesAllowed: true });
    Object.assign(incomingBase.data.settings, { externalImagesAllowed: true });
    Object.assign(incomingBase.data.settings.libraryDisplayProfiles.books, { externalImagesAllowed: true });
    plugin.loadedData = incoming;
    await plugin.onExternalSettingsChange();
    assert.equal(plugin.isDataReadOnly(), false);
    assert.equal(plugin.getLibraryDisplayProfile("books").imageRatio, "landscape");
    assertPermissionUnchanged();
    assertOnlineCoversUnavailable(remote.plugin);
    assert.deepEqual(remote.legacyPermissionReads, []);
    assert.deepEqual(remote.legacyPermissionWrites, []);
    assert.equal(current.mutations() + remote.mutations(), 0);
  });
}
