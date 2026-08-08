import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { Notice, Plugin, TFile } from "obsidian";

interface TestPluginBase {
  loadedData: unknown;
  savedData: unknown[];
}

function pluginWith(data: unknown): EntVaultCommandCenterPlugin & TestPluginBase {
  const app = {
    vault: {},
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {},
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  return plugin;
}

test("versionless modern plugin data is migrated and saved without losing organization", async () => {
  const plugin = pluginWith({
    collections: [{ id: "research", title: "Research", collapsed: false, subjects: ["Notes/Paper.md"], subheadings: [] }],
    pinnedPaths: ["Notes/Paper.md"],
    settings: { workspaceMode: "generic", workspaceName: "My KB", setupComplete: true },
  });
  await plugin.loadPluginData();
  assert.equal(plugin.data.version, 9);
  assert.equal(plugin.data.settings.workspaceMode, "generic");
  assert.equal(plugin.data.collections[0]?.title, "Research");
  assert.deepEqual(plugin.data.pinnedPaths, ["Notes/Paper.md"]);
  assert.equal(plugin.savedData.length, 1);
});

test("unrecognized versionless data enters read-only mode and is never overwritten", async () => {
  Notice.messages.length = 0;
  const original = { unrelatedApplicationState: { keep: true } };
  const plugin = pluginWith(original);
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /unrecognized shape/i);
  assert.equal(plugin.savedData.length, 0);
  assert.equal(Notice.messages.some((message) => /read-only/i.test(message)), true);
  await plugin.savePluginData();
  assert.equal(plugin.savedData.length, 0);
});

test("future data versions enter read-only mode rather than being downgraded", async () => {
  const plugin = pluginWith({ version: 99, collections: [], settings: { workspaceMode: "generic" } });
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.equal(plugin.savedData.length, 0);
});

test("the plugin rename handler preserves every note below a renamed folder and saves once", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.collections = [{ id: "c", title: "C", collapsed: false, subjects: ["Old/One.md"], subheadings: [] }];
  plugin.data.pinnedPaths = ["Old/Nested/Two.md"];
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string): Promise<void> };
    await handler.handleRename("Old", "New");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
  assert.deepEqual(plugin.data.collections[0]?.subjects, ["New/One.md"]);
  assert.deepEqual(plugin.data.pinnedPaths, ["New/Nested/Two.md"]);
  assert.equal(plugin.savedData.length, 1);
});

test("test runtime uses the in-memory Obsidian plugin boundary", () => {
  const base = new Plugin();
  assert.ok(Array.isArray(base.savedData));
});

test("a corrupt data.json opens read-only instead of stopping the plugin from loading", async () => {
  Notice.messages.length = 0;
  const plugin = pluginWith(null);
  // Obsidian's loadData() performs JSON.parse, so a malformed file rejects here.
  (plugin as unknown as { loadData(): Promise<unknown> }).loadData = () =>
    Promise.reject(new SyntaxError("Unexpected end of JSON input"));
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);
  assert.match(plugin.dataCompatibilityWarning, /read-only/i);
  // The plugin still has usable defaults, and never writes over the bad file.
  assert.equal(plugin.data.version, 9);
  assert.equal(plugin.isDataReadOnly(), true);
  assert.equal(plugin.savedData.length, 0);
  await plugin.savePluginData();
  assert.equal(plugin.savedData.length, 0);
  assert.throws(() => plugin.assertDataWritable(), /could not be parsed/i);
  assert.equal(Notice.messages.some((message) => /could not be parsed/i.test(message)), true);
});

function vaultWith(fileCount: number) {
  const files = Array.from({ length: fileCount }, (_, index) => new TFile(`Knowledge Base/Group ${index % 20}/Note ${index}.md`));
  return {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => files,
      getAbstractFileByPath: () => null,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
}

test("index membership lookups stay constant-time across a large vault", async () => {
  const fileCount = 10_000;
  const plugin = new EntVaultCommandCenterPlugin(vaultWith(fileCount) as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  // Half the vault also carries an explicit manual membership. Testing these
  // with Array.includes inside the per-file loop is quadratic.
  plugin.data.manualIndexPaths = Array.from({ length: 5_000 }, (_, index) => `Elsewhere/Manual ${index}.md`);
  plugin.data.excludedIndexPaths = Array.from({ length: 2_000 }, (_, index) => `Knowledge Base/Group ${index % 20}/Note ${index}.md`);
  plugin.invalidateRecordCache();

  const start = performance.now();
  const records = plugin.getRecords();
  const elapsed = performance.now() - start;
  assert.equal(records.length, fileCount - plugin.data.excludedIndexPaths.length);
  assert.ok(elapsed < 750, `building records for ${fileCount} files took ${elapsed.toFixed(1)} ms`);

  // A warm cache must not rescan at all.
  const cachedStart = performance.now();
  assert.equal(plugin.getRecords(), records);
  assert.ok(performance.now() - cachedStart < 100, "a warm record cache should not rebuild");
});

test("hidden notes leave the index while manual members stay in it", async () => {
  const plugin = new EntVaultCommandCenterPlugin(vaultWith(6) as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  plugin.data.excludedIndexPaths = ["Knowledge Base/Group 0/Note 0.md"];
  plugin.invalidateRecordCache();
  const paths = plugin.getRecords().map((item) => item.path);
  assert.equal(paths.includes("Knowledge Base/Group 0/Note 0.md"), false);
  assert.equal(paths.includes("Knowledge Base/Group 1/Note 1.md"), true);
});

test("portable JSON writes do not create a second success notice", async () => {
  Notice.messages.length = 0;
  const plugin = pluginWith(null);
  let createdPath = "";
  let createdContent = "";
  const app = plugin.app as unknown as {
    vault: {
      getAbstractFileByPath(path: string): null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path, content) => {
      createdPath = path;
      createdContent = content;
      return new TFile(path);
    },
  };

  const file = await plugin.writePortableJson("workspace", { workspace: "test" });

  assert.equal(file.path, createdPath);
  assert.match(createdPath, /^Knowledge Base Command Center Exports\/knowledge-base-command-center-workspace-/);
  assert.equal(createdContent, '{\n  "workspace": "test"\n}\n');
  assert.deepEqual(Notice.messages, []);
});
