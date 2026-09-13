import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import EntVaultCommandCenterPlugin, { LIBRARY_IMAGE_PERMISSION_KEY } from "../src/main";
import { EntVaultCommandCenterView } from "../src/view";
import { applyPersonalBackupToData, createDefaultStore, createPersonalBackup, migrateData, parsePersonalBackup, type PluginStore } from "../src/model";
import { normalizeLibraryDisplayProfile, type LibraryDisplayProfile } from "../src/library-display-profile";
import { applyPortableExport, createPortableExport, EMPTY_PORTABLE_SELECTION, parsePortableExport } from "../src/portability";

async function fixture(localState = new Map<string, unknown>(), storedData?: unknown) {
  const data = migrateData(null);
  Object.assign(data.settings, { workspaceMode: "generic", setupComplete: true, workspaceName: "Synthetic books" });
  data.portableIndex.libraries = ["books", "papers"].map((id, order) => ({
    id, name: id, singularName: "item", icon: "book", order, sourceKind: null, archivedAt: null,
  }));
  const file = new TFile("Books/Example.md");
  let mutations = 0;
  let failStorage = false;
  let clearCalls = 0;
  const permissionWrites: unknown[] = [];
  const forbidden = (): never => { mutations += 1; throw new Error("Unexpected note mutation"); };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView;
  view.clearExternalLibraryImages = () => { clearCalls += 1; };
  view.reload = async () => {};
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [file], getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      create: forbidden, modify: forbidden, process: forbidden, rename: forbidden, delete: forbidden },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: { renameFile: forbidden, processFrontMatter: forbidden },
    workspace: { getLeavesOfType: () => [{ view }] },
    loadLocalStorage: (key: string) => structuredClone(localState.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      if (failStorage) throw new Error("Synthetic storage failure");
      if (key === LIBRARY_IMAGE_PERMISSION_KEY) permissionWrites.push(structuredClone(value));
      localState.set(key, structuredClone(value));
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & {
    loadedData: unknown; savedData: unknown[];
  };
  plugin.loadedData = storedData ?? createDefaultStore(data, 1, "vault-library-display-test");
  await plugin.loadPluginData(false);
  return { plugin, app, localState, permissionWrites, mutations: () => mutations, clearCalls: () => clearCalls,
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

test("external covers default off and explicit device permission never writes synced data or another device", async () => {
  const { plugin, localState } = await fixture();
  const saved = plugin.savedData.length;
  assert.equal(plugin.getExternalLibraryImagesAllowed(), false);
  await plugin.setExternalLibraryImagesAllowed(true);
  assert.equal(plugin.getExternalLibraryImagesAllowed(), true);
  assert.deepEqual(localState.get(LIBRARY_IMAGE_PERMISSION_KEY), { version: 1, externalImagesAllowed: true });
  assert.equal(plugin.savedData.length, saved);
  assert.equal((await fixture(localState)).plugin.getExternalLibraryImagesAllowed(), true);
  assert.equal((await fixture()).plugin.getExternalLibraryImagesAllowed(), false);
  assert.equal(JSON.stringify(plugin.data).includes("externalImagesAllowed"), false);
});

test("malformed and future external cover permissions fail closed", async () => {
  for (const value of [true, "true", { version: 2, externalImagesAllowed: true }, { version: 1, externalImagesAllowed: "true" },
    { version: 1, externalImagesAllowed: true, extra: 1 }, [1, true]]) {
    const { plugin } = await fixture(new Map([[LIBRARY_IMAGE_PERMISSION_KEY, value]]));
    assert.equal(plugin.getExternalLibraryImagesAllowed(), false);
  }
  const { plugin, app } = await fixture();
  app.loadLocalStorage = () => { throw new Error("Unreadable"); };
  assert.equal(plugin.getExternalLibraryImagesAllowed(), false);
});

test("failed permission enabling stays blocked and revocation strips image sources before a failed save", async () => {
  const { plugin, failStorage, clearCalls } = await fixture();
  failStorage();
  await assert.rejects(plugin.setExternalLibraryImagesAllowed(true), /remain blocked/);
  assert.equal(plugin.getExternalLibraryImagesAllowed(), false);
  assert.equal(clearCalls(), 1);
  const enabled = await fixture();
  await enabled.plugin.setExternalLibraryImagesAllowed(true);
  enabled.failStorage();
  const pending = enabled.plugin.setExternalLibraryImagesAllowed(false);
  assert.equal(enabled.plugin.getExternalLibraryImagesAllowed(), false, "revocation is synchronous");
  assert.equal(enabled.clearCalls(), 1, "existing sources removed before awaiting storage");
  await assert.rejects(pending, /blocked for this session/);
  assert.equal(enabled.plugin.getExternalLibraryImagesAllowed(), false);
});

test("privacy reset revokes covers, clears the local key, and prevents re-enabling until restart", async () => {
  const { plugin, localState, clearCalls } = await fixture();
  await plugin.setExternalLibraryImagesAllowed(true);
  const saved = plugin.savedData.length;
  await plugin.clearDeviceLocalData();
  assert.equal(plugin.getExternalLibraryImagesAllowed(), false);
  assert.equal(localState.get(LIBRARY_IMAGE_PERMISSION_KEY), null);
  assert.equal(clearCalls(), 1);
  assert.equal(plugin.savedData.length, saved);
  await assert.rejects(plugin.setExternalLibraryImagesAllowed(true), /Restart/);
});

for (const allowed of [false, true]) {
  test(`Workspace import, Undo/Redo, recovery and Sync cannot change ${allowed ? "allowed" : "blocked"} vault-local image permission`, async () => {
    const current = await fixture();
    const { plugin, localState, permissionWrites } = current;
    if (allowed) await plugin.setExternalLibraryImagesAllowed(true);
    const permissionBefore = structuredClone(localState.get(LIBRARY_IMAGE_PERMISSION_KEY));
    const writesBefore = structuredClone(permissionWrites);
    const assertPermissionUnchanged = (): void => {
      assert.equal(plugin.getExternalLibraryImagesAllowed(), allowed);
      assert.deepEqual(localState.get(LIBRARY_IMAGE_PERMISSION_KEY), permissionBefore);
      assert.deepEqual(permissionWrites, writesBefore, "no transfer or history action writes the permission key");
      assert.equal(JSON.stringify(plugin.data).includes("externalImagesAllowed"), false);
    };
    const selection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
    const source = structuredClone(plugin.data);
    source.settings.libraryDisplayProfiles.books = cards();
    const rawPackage = createPortableExport(source, [], selection, "2026-09-13T00:00:00.000Z");
    assert.ok(rawPackage.components.workspace);
    Object.assign(rawPackage, { externalImagesAllowed: !allowed });
    Object.assign(rawPackage.components.workspace.settings, { externalImagesAllowed: !allowed });
    Object.assign(rawPackage.components.workspace.settings.libraryDisplayProfiles.books, { externalImagesAllowed: !allowed });
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
    Object.assign(rawRecovery, { externalImagesAllowed: !allowed });
    assert.ok(rawRecovery.libraryDisplayProfiles);
    Object.assign(rawRecovery.libraryDisplayProfiles.books, { externalImagesAllowed: !allowed });
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
    Object.assign(incoming, { externalImagesAllowed: !allowed });
    Object.assign(incomingBase.data.settings, { externalImagesAllowed: !allowed });
    Object.assign(incomingBase.data.settings.libraryDisplayProfiles.books, { externalImagesAllowed: !allowed });
    plugin.loadedData = incoming;
    await plugin.onExternalSettingsChange();
    assert.equal(plugin.isDataReadOnly(), false);
    assert.equal(plugin.getLibraryDisplayProfile("books").imageRatio, "landscape");
    assertPermissionUnchanged();
    assert.equal(remote.plugin.getExternalLibraryImagesAllowed(), false);
    assert.deepEqual(remote.permissionWrites, []);
    assert.equal(current.mutations() + remote.mutations(), 0);
  });
}
