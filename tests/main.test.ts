import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { portablePlaceholderPath } from "../src/model.ts";
import { createPortableExport, parsePortableExport } from "../src/portability.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import { IndexGroupModal } from "../src/modals.ts";
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
  assert.equal(plugin.data.version, 10);
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
  assert.equal(plugin.data.version, 10);
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

test("an undo-protected import restores and persists the pre-import state when saving fails", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalName = plugin.data.settings.workspaceName;
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated write failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(
    plugin.mutate("Import portable export", () => {
      plugin.data.settings.workspaceName = "Imported name";
    }, { includeSettings: true, requireUndo: true }),
    /simulated write failure/,
  );

  assert.equal(plugin.data.settings.workspaceName, originalName);
  assert.equal(saveAttempts, 2);
  const persisted = plugin.savedData.at(-1) as { settings?: { workspaceName?: string } } | undefined;
  assert.equal(persisted?.settings?.workspaceName, originalName);
});

test("resolving a portable placeholder preserves placement and Undo only unlinks the note", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-laryngeal-cleft";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [placeholder];
  plugin.data.indexGroupByPath[placeholder] = "Airway";
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [placeholder], subheadings: [] }];

  await plugin.resolvePortableSubject(subjectId, linkedFile.path);

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], linkedFile.path);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  assert.equal(plugin.data.indexGroupByPath[linkedFile.path], "Airway");
  assert.equal(plugin.data.manualIndexPaths.includes(placeholder), false);

  await plugin.undo();

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [placeholder]);
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
  assert.equal(app.vault.getAbstractFileByPath(linkedFile.path), linkedFile);
});

test("Undo invalidates cached placeholder metadata", async () => {
  const app = {
    vault: { configDir: ".obsidian", getAbstractFileByPath: () => null, getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [{ id: "subject", title: "Old title", groupId: "group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("subject")];
  plugin.invalidateRecordCache();
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "Old title");

  await plugin.mutate("Rename imported subject", () => {
    const subject = plugin.getPortableSubject("subject");
    if (subject) subject.title = "New title";
    plugin.invalidateRecordCache();
  }, { includePortableIndex: true });
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "New title");

  await plugin.undo();
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "Old title");
});

test("confirmed identity reassignment merges bindings without duplicate organization paths and Undo restores both", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Local renamed note.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const importedId = "subject-imported";
  const localId = "subject-local";
  const importedPath = portablePlaceholderPath(importedId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [
      { id: importedId, title: "Imported title", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: localId, title: "Local renamed note", groupId: "group-airway", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { [localId]: linkedFile.path },
  };
  plugin.data.manualIndexPaths = [importedPath, linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [importedPath, linkedFile.path], subheadings: [] }];

  await assert.rejects(plugin.resolvePortableSubject(importedId, linkedFile.path), /identity reassignment/i);
  await plugin.resolvePortableSubject(importedId, linkedFile.path, true);

  assert.equal(plugin.data.portableIndex.subjects.length, 1);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[importedId], linkedFile.path);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[localId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  assert.deepEqual(plugin.data.manualIndexPaths, [linkedFile.path]);

  await plugin.undo();
  assert.equal(plugin.data.portableIndex.subjects.length, 2);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[localId], linkedFile.path);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [importedPath, linkedFile.path]);
});

test("identity reassignment refuses ancestor and descendant merges that would create a cycle", async () => {
  const linkedFile = new TFile("Knowledge Base/Ancestor.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [
      { id: "ancestor", title: "Ancestor", groupId: "group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "middle", title: "Middle", groupId: "group", parentId: "ancestor", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "descendant", title: "Descendant", groupId: "group", parentId: "middle", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { ancestor: linkedFile.path },
  };

  await assert.rejects(
    plugin.resolvePortableSubject("descendant", linkedFile.path, true),
    /ancestors or descendants/i,
  );
  assert.equal(plugin.data.portableIndex.subjects.length, 3);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.ancestor, linkedFile.path);
});

test("unlinking a resolved portable subject restores its placeholder without changing the Markdown file", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-cleft";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{ id: subjectId, title: "Laryngeal Cleft", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { [subjectId]: linkedFile.path },
  };
  plugin.data.manualIndexPaths = [linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [linkedFile.path], subheadings: [] }];

  await plugin.unlinkPortableSubject(subjectId);

  const placeholder = portablePlaceholderPath(subjectId);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [placeholder]);
  assert.equal(app.vault.getAbstractFileByPath(linkedFile.path), linkedFile);
});

test("Index Manager keeps a removed portable placeholder discoverable under Available", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-available";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.invalidateRecordCache();
  const manager = Object.create(IndexManagerModal.prototype) as {
    plugin: EntVaultCommandCenterPlugin;
    availableNotes(): Array<{ path: string; title: string; meta: string }>;
  };
  manager.plugin = plugin;

  assert.deepEqual(manager.availableNotes(), [{
    path: portablePlaceholderPath(subjectId),
    title: "Laryngeal Cleft",
    meta: "Airway · imported subject without a note",
  }]);
});

test("adding an available portable placeholder restores membership and captures it in Undo", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const subjectId = "subject-restore";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.indexGroupOrder = ["Airway"];
  plugin.data.indexGroupByPath[placeholder] = "Airway";
  plugin.invalidateRecordCache();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: typeof app;
    plugin: EntVaultCommandCenterPlugin;
    selected: Set<string>;
    tab: string;
    render(): void;
    chooseGroupForSelection(mode: "add" | "restore" | "move"): void;
  };
  manager.app = app;
  manager.plugin = plugin;
  manager.selected = new Set([placeholder]);
  manager.tab = "available";
  manager.render = () => {};

  let resolveSubmission: () => void = () => {};
  let rejectSubmission: (error: unknown) => void = () => {};
  const submission = new Promise<void>((resolve, reject) => {
    resolveSubmission = resolve;
    rejectSubmission = reject;
  });
  IndexGroupModal.prototype.open = function openForTest(): void {
    const options = (this as unknown as {
      options: { initialValue: string; onSubmit(group: string): void | Promise<void> };
    }).options;
    void Promise.resolve(options.onSubmit(options.initialValue)).then(resolveSubmission, rejectSubmission);
  };
  try {
    manager.chooseGroupForSelection("add");
    await submission;
  } finally {
    delete (IndexGroupModal.prototype as { open?: () => void }).open;
  }

  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, true);
  assert.ok(plugin.data.manualIndexPaths.includes(placeholder));
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.equal(plugin.data.undoStack.at(-1)?.portableIndex?.subjects[0]?.indexed, false);

  await plugin.undo();

  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, false);
  assert.equal(plugin.data.manualIndexPaths.includes(placeholder), false);
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
});

test("an indexed clinical subject linked to an unverified proposal remains in both the index and Inbox export", async () => {
  const proposal = new TFile("01 Inbox/Topic Proposals/Proposal - Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === proposal.path ? proposal : null,
      getMarkdownFiles: () => [proposal],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: () => ({ frontmatter: { type: "topic-proposal", title: "Laryngeal Cleft", proposed_domain: "Pediatric" } }),
      resolvedLinks: {},
    },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "ent-clinical";
  plugin.data.settings.primaryFolder = "03 Clinical Topics";
  plugin.data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  plugin.data.settings.idProperty = "curriculum_id";
  const subjectId = "subject-cleft";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-003.05",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [placeholder];

  await plugin.resolvePortableSubject(subjectId, proposal.path);

  const linked = plugin.getRecord(proposal.path);
  assert.equal(linked?.kind, "topic");
  assert.equal(linked?.role, "proposal");
  assert.equal(linked?.portableIndexed, true);
  assert.deepEqual(plugin.getIndexRecords().map((record) => record.path), [proposal.path]);
  assert.deepEqual(plugin.getRecords().filter((record) => record.role === "proposal").map((record) => record.path), [proposal.path]);

  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  assert.equal(exported.components.index?.subjects[0]?.id, subjectId);
  assert.equal(exported.components.index?.subjects[0]?.configuredId, "ENT-PED-003.05");
  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, true);
});

test("a collection-only generic placeholder can link a new in-folder note without entering the index", async () => {
  const created = new TFile("Knowledge Base/Reference material.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === created.path ? created : null,
      getMarkdownFiles: () => [created],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { title: "Reference material" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  const subjectId = "subject-reference";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-reference", title: "Reference", order: 0 }],
    subjects: [{ id: subjectId, title: "Reference material", groupId: "group-reference", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "note" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.collections = [{ id: "reference", title: "Reference", collapsed: false, subjects: [placeholder], subheadings: [] }];

  await plugin.resolvePortableSubject(subjectId, created.path);

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], created.path);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [created.path]);
  assert.equal(plugin.data.excludedIndexPaths.includes(created.path), true);
  assert.equal(plugin.getRecord(created.path)?.kind, "note");
  assert.equal(plugin.getIndexRecords().some((record) => record.path === created.path), false);
});

test("portable linking rejects configured-ID and record-kind mismatches before mutating identity state", async () => {
  const wrongTopic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-999 - Wrong topic.md");
  const wrongDomainSupporting = new TFile("03 Clinical Topics/02 Otology/Supporting note.md");
  const procedure = new TFile("04 Procedures/Procedure - Airway Endoscopy.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => [wrongTopic, wrongDomainSupporting, procedure].find((file) => file.path === path) ?? null,
      getMarkdownFiles: () => [wrongTopic, wrongDomainSupporting, procedure],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => file.path === wrongTopic.path
        ? { frontmatter: { title: "Wrong topic", curriculum_id: "ENT-PED-999", domain: "Pediatric" } }
        : file.path === wrongDomainSupporting.path
          ? { frontmatter: { title: "Supporting note", domain: "Otology" } }
          : { frontmatter: { title: "Airway Endoscopy", type: "procedure", domain: "Airway" } },
      resolvedLinks: {},
    },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "ent-clinical";
  plugin.data.settings.primaryFolder = "03 Clinical Topics";
  plugin.data.settings.idProperty = "curriculum_id";
  const subjectId = "subject-cleft";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{ id: subjectId, title: "Laryngeal Cleft", groupId: "group-pediatric", parentId: null, order: 0, indexed: true, configuredId: "ENT-PED-003.05", recordKind: "topic" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath(subjectId)];
  const before = structuredClone(plugin.data.portableIndex);

  await assert.rejects(plugin.resolvePortableSubject(subjectId, wrongTopic.path), /configured ID mismatch/i);
  await assert.rejects(plugin.resolvePortableSubject(subjectId, wrongDomainSupporting.path), /clinical group mismatch.*Pediatric.*Otology/i);
  await assert.rejects(plugin.resolvePortableSubject(subjectId, procedure.path), /procedure note cannot be linked/i);

  assert.deepEqual(plugin.data.portableIndex, before);
  assert.equal(plugin.data.undoStack.length, 0);
});

test("identity merge deterministically preserves the surviving parent and appends owner children", async () => {
  const ownerFile = new TFile("Knowledge Base/Airway/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Airway" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const path = (id: string): string => portablePlaceholderPath(id);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [
      { id: "target-parent", title: "Target parent", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-parent", title: "Owner parent", groupId: "group-airway", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "target", title: "Target", groupId: "group-airway", parentId: "target-parent", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-airway", parentId: "owner-parent", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "target-child", title: "Zulu target child", groupId: "group-airway", parentId: "target", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-child", title: "Alpha owner child", groupId: "group-airway", parentId: "owner", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [path("target-parent"), path("owner-parent"), path("target"), ownerFile.path, path("target-child"), path("owner-child")];
  plugin.data.indexGroupByPath = Object.fromEntries(plugin.data.manualIndexPaths.map((subjectPath) => [subjectPath, "Airway"]));
  // Adversarial insertion order: the old implementation allowed the later
  // owner entry/container to overwrite the target survivor's placement.
  plugin.data.curriculumVisual.parentByPath = {
    [path("target")]: path("target-parent"),
    [ownerFile.path]: path("owner-parent"),
    [path("target-child")]: path("target"),
    [path("owner-child")]: ownerFile.path,
  };
  plugin.data.curriculumVisual.orderByContainer = {
    [`parent:${path("target-parent")}`]: [path("target")],
    [`parent:${path("owner-parent")}`]: [ownerFile.path],
    [`parent:${path("target")}`]: [path("target-child")],
    [`parent:${ownerFile.path}`]: [path("owner-child")],
  };
  const before = structuredClone(plugin.data);

  await plugin.resolvePortableSubject("target", ownerFile.path, true);

  assert.equal(plugin.data.curriculumVisual.parentByPath[ownerFile.path], path("target-parent"));
  assert.deepEqual(plugin.data.curriculumVisual.orderByContainer[`parent:${ownerFile.path}`], [path("target-child"), path("owner-child")]);
  assert.equal(plugin.getPortableSubject("owner"), null);
  assert.equal(plugin.getPortableSubject("owner-child")?.parentId, "target");

  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  const exportedSubjects = exported.components.index?.subjects ?? [];
  assert.equal(exportedSubjects.find((subject) => subject.id === "target")?.parentId, "target-parent");
  assert.deepEqual(exportedSubjects.filter((subject) => subject.parentId === "target").sort((a, b) => a.order - b.order).map((subject) => subject.id), ["target-child", "owner-child"]);

  await plugin.undo();
  assert.deepEqual(plugin.data.portableIndex, before.portableIndex);
  assert.deepEqual(plugin.data.curriculumVisual, before.curriculumVisual);
});

test("identity merge rejects owner children that would become cross-group descendants", async () => {
  const ownerFile = new TFile("Knowledge Base/Group B/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Group B" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-a", title: "Group A", order: 0 }, { id: "group-b", title: "Group B", order: 1 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-a", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-b", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-child", title: "Owner child", groupId: "group-b", parentId: "owner", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("target"), ownerFile.path, portablePlaceholderPath("owner-child")];
  const before = structuredClone(plugin.data.portableIndex);

  await assert.rejects(plugin.resolvePortableSubject("target", ownerFile.path, true), /across groups.*child subjects/i);

  assert.deepEqual(plugin.data.portableIndex, before);
});

test("cross-group identity merge without descendants keeps the surviving target group through export", async () => {
  const ownerFile = new TFile("Knowledge Base/Group B/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Group B" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const targetPath = portablePlaceholderPath("target");
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-a", title: "Group A", order: 0 }, { id: "group-b", title: "Group B", order: 1 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-a", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-b", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [targetPath, ownerFile.path];
  // Put the owner entry last to exercise a colliding path-map rewrite.
  plugin.data.indexGroupByPath = { [targetPath]: "Group A", [ownerFile.path]: "Group B" };

  await plugin.resolvePortableSubject("target", ownerFile.path, true);

  assert.equal(plugin.data.indexGroupByPath[ownerFile.path], "Group A");
  assert.equal(plugin.getRecord(ownerFile.path)?.domain, "Group A");
  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  const target = exported.components.index?.subjects.find((subject) => subject.id === "target");
  const targetGroup = exported.components.index?.groups.find((group) => group.id === target?.groupId);
  assert.equal(targetGroup?.title, "Group A");
  assert.equal(exported.components.index?.subjects.some((subject) => subject.id === "owner"), false);
});

test("linking refuses to mutate when a full portable Undo snapshot exceeds the safety budget", async () => {
  const ownerFile = new TFile("Knowledge Base/Large/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Large" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const longTitle = "x".repeat(500);
  const filler = Array.from({ length: 25_000 }, (_, index) => ({
    id: `filler-${index}`,
    title: `${longTitle}${index}`,
    groupId: "group-large",
    parentId: null,
    order: index + 2,
    indexed: false,
    configuredId: "",
    recordKind: "topic" as const,
  }));
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-large", title: "Large", order: 0 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-large", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-large", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
      ...filler,
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("target"), ownerFile.path];

  await assert.rejects(plugin.resolvePortableSubject("target", ownerFile.path, true), /too large for safe.*Undo/i);

  assert.equal(plugin.getPortableSubject("owner")?.id, "owner");
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.target, undefined);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.owner, ownerFile.path);
  assert.equal(plugin.data.undoStack.length, 0);
});

test("unlink rolls back in memory and on disk when its first save fails", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Linked.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Airway" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{ id: "subject", title: "Linked", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { subject: linkedFile.path },
  };
  plugin.data.manualIndexPaths = [linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [linkedFile.path], subheadings: [] }];
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated unlink save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.unlinkPortableSubject("subject"), /simulated unlink save failure/);

  assert.equal(saveAttempts, 2);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.subject, linkedFile.path);
  assert.deepEqual(plugin.data.manualIndexPaths, [linkedFile.path]);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  const persisted = plugin.savedData.at(-1) as { portableIndex?: { resolvedPathBySubjectId?: Record<string, string> } } | undefined;
  assert.equal(persisted?.portableIndex?.resolvedPathBySubjectId?.subject, linkedFile.path);
});
