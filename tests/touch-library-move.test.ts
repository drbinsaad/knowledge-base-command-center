import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import EntVaultCommandCenterPlugin from "../src/main";
import { applyLibraryVisualMove, ensureLibraryCatalogGroup, type LibraryVisualMoveRequest } from "../src/library-visual-move";
import { createDefaultStore, migrateData, portablePlaceholderPath, snapshotPersonal, type PluginData } from "../src/model";

function fixtureData(): PluginData {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.setupComplete = true;
  data.settings.workspaceName = "Touch Library verification";
  data.portableIndex.libraries = [
    { id: "reading", name: "Reading", singularName: "Reading note", icon: "book", order: 0, sourceKind: null, archivedAt: null },
    { id: "other", name: "Other", singularName: "Other note", icon: "book", order: 1, sourceKind: null, archivedAt: null },
  ];
  data.portableIndex.groups = [
    { id: "sources-group", title: "Sources", order: 0 },
    { id: "references-group", title: "References", order: 1 },
  ];
  data.portableIndex.subjects = ["source-0", "source-1", "source-2", "source-3"].map((id, index) => ({
    id, title: `Source ${index}`, groupId: index === 2 ? "references-group" : "sources-group",
    parentId: null, order: index, indexed: false, configuredId: `PAPER-${index}`, recordKind: "note", libraryId: "reading",
  }));
  data.portableIndex.resolvedPathBySubjectId = { "source-0": "Papers/Source zero.md" };
  data.portableIndex.libraryLayouts = {
    reading: [
      { id: "sources", title: "Sources", collapsed: false, subjects: ["source-0", "source-1"], subheadings: [] },
      { id: "references", title: "References", collapsed: true, subjects: [], subheadings: [
        { id: "studies", title: "Studies", collapsed: true, subjects: [], subheadings: [
          { id: "trials", title: "Trials", collapsed: true, subjects: [], subheadings: [
            { id: "randomized", title: "Randomized", collapsed: true, subjects: ["source-2"] },
          ] },
        ] },
      ] },
    ],
    other: [],
  };
  data.collections = [{ id: "collection", title: "Collection", collapsed: false, subjects: ["Papers/Source zero.md"], subheadings: [] }];
  data.pinnedPaths = ["Papers/Source zero.md"];
  data.activeTab = "collections";
  data.selectedPath = portablePlaceholderPath("source-1");
  return data;
}

async function fixture() {
  const file = new TFile("Papers/Source zero.md");
  let sourceMutations = 0;
  let localWritesFail = false;
  const localState = new Map<string, unknown>();
  const forbidden = (): never => { sourceMutations += 1; throw new Error("Unexpected Markdown mutation"); };
  const app = {
    vault: {
      configDir: ".obsidian", getMarkdownFiles: () => [file],
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      create: forbidden, modify: forbidden, process: forbidden, rename: forbidden, delete: forbidden,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: { renameFile: forbidden, processFrontMatter: forbidden },
    loadLocalStorage: (key: string) => structuredClone(localState.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      if (localWritesFail) throw new Error("Undo storage unavailable");
      localState.set(key, structuredClone(value));
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & {
    loadedData: unknown; savedData: unknown[];
  };
  plugin.loadedData = createDefaultStore(fixtureData(), 1, "vault-touch-library");
  await plugin.loadPluginData(false);
  const checkpoint = () => {
    const snapshot = snapshotPersonal(plugin.data, "Checkpoint", false, true);
    snapshot.at = 0;
    return snapshot;
  };
  const request: LibraryVisualMoveRequest = {
    path: file.path, libraryId: "reading", source: { headingId: "sources" },
    destination: { headingId: "references", subheadingId: "randomized" },
    anchorSubjectId: null, position: "inside",
  };
  const move = (assertCurrent = () => {}) => plugin.moveLibraryRecordVisually(
    request.path, request.libraryId, request.source, request.destination,
    request.anchorSubjectId, request.position, assertCurrent,
  );
  return {
    plugin, file, request, checkpoint, move,
    sourceMutations: () => sourceMutations,
    failLocalWrites: () => { localWritesFail = true; },
  };
}

test("touch Library placement moves to a deep destination with exact required Undo and Redo", async () => {
  const { plugin, request, checkpoint, move, sourceMutations } = await fixture();
  const before = checkpoint();
  const beforeSubject = structuredClone(plugin.getPortableSubject("source-0"));
  const beforeRoute = [plugin.data.activeTab, plugin.data.selectedPath];
  let guardCalls = 0;
  await move(() => { guardCalls += 1; });
  assert.equal(guardCalls, 2);
  const layout = plugin.data.portableIndex.libraryLayouts.reading;
  assert.deepEqual(layout[0]?.subjects, ["source-1"]);
  const references = layout[1];
  const studies = references.subheadings[0];
  const trials = studies.subheadings![0];
  const randomized = trials.subheadings![0];
  assert.deepEqual(randomized.subjects, ["source-2", "source-0"]);
  assert.ok([references, studies, trials, randomized].every((node) => node.collapsed === false));
  assert.deepEqual(plugin.getPortableSubject("source-0"), { ...beforeSubject, groupId: "references-group" });
  assert.deepEqual(plugin.data.portableIndex.resolvedPathBySubjectId, before.portableIndex?.resolvedPathBySubjectId);
  assert.deepEqual([plugin.data.activeTab, plugin.data.selectedPath], beforeRoute);
  assert.deepEqual(plugin.data.collections, before.collections);
  assert.deepEqual(plugin.data.pinnedPaths, before.pinnedPaths);
  assert.equal(plugin.data.undoStack.length, 1);
  assert.ok(plugin.data.undoStack[0]?.portableIndex, "required history includes path-free Library layouts and groups");
  const after = checkpoint();
  await plugin.undo();
  assert.deepEqual(checkpoint(), before);
  await plugin.redo();
  assert.deepEqual(checkpoint(), after);
  assert.equal(plugin.getRecord(request.path)?.libraryId, "reading");
  assert.equal(sourceMutations(), 0);
});

test("touch Library reorders before and after a live row without duplicating identities", async () => {
  const { plugin, request } = await fixture();
  request.destination = { headingId: "sources" };
  request.anchorSubjectId = "source-1";
  request.position = "after";
  applyLibraryVisualMove(plugin.data, plugin.getRecord(request.path), request);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.reading?.[0]?.subjects, ["source-1", "source-0"]);
  request.position = "before";
  applyLibraryVisualMove(plugin.data, plugin.getRecord(request.path), request);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.reading?.[0]?.subjects, ["source-0", "source-1"]);
  assert.equal(plugin.getPortableSubject("source-0")?.groupId, "sources-group");
});

test("touch Library can place a genuinely unplaced portable placeholder", async () => {
  const { plugin, request } = await fixture();
  request.path = portablePlaceholderPath("source-3");
  request.source = null;
  applyLibraryVisualMove(plugin.data, plugin.getRecord(request.path), request);
  assert.equal(plugin.getPortableSubject("source-3")?.groupId, "references-group");
  assert.equal(plugin.data.portableIndex.libraryLayouts.reading?.[1]?.subheadings[0]?.subheadings?.[0]?.subheadings?.[0]?.subjects.at(-1), "source-3");
});

test("touch Library guard rejection before scheduling never starts a transaction", async () => {
  const { plugin, checkpoint, move } = await fixture();
  const before = checkpoint();
  let transactions = 0;
  plugin.mutate = async () => { transactions += 1; };
  await assert.rejects(move(() => { throw new Error("Stale touch drag"); }), /Stale touch drag/);
  assert.equal(transactions, 0);
  assert.deepEqual(checkpoint(), before);
});

test("touch Library guard is rechecked inside the production transaction and leaves no Undo on refusal", async () => {
  const { plugin, checkpoint, move } = await fixture();
  const before = checkpoint();
  let calls = 0;
  await assert.rejects(move(() => { if (++calls === 2) throw new Error("Stale queued touch drag"); }), /Stale queued touch drag/);
  assert.equal(calls, 2);
  assert.deepEqual(checkpoint(), before);
  assert.equal(plugin.data.undoStack.length, 0);
});

test("touch Library refuses when its required restart-safe Undo cannot be persisted", async (context) => {
  const { plugin, checkpoint, move, failLocalWrites, sourceMutations } = await fixture();
  const before = checkpoint();
  const logged = context.mock.method(console, "error", () => {});
  failLocalWrites();
  await assert.rejects(move(), /Undo|storage|persist|save/i);
  assert.deepEqual(checkpoint(), before);
  assert.equal(plugin.data.undoStack.length, 0);
  assert.equal(sourceMutations(), 0);
  assert.ok(logged.mock.calls.some((call) => /could not persist device-local state/.test(String(call.arguments[0]))));
});

for (const [name, mutate] of [
  ["deleted destination heading", (data: PluginData) => { data.portableIndex.libraryLayouts.reading?.splice(1, 1); }],
  ["deleted deep destination", (data: PluginData) => { data.portableIndex.libraryLayouts.reading[1].subheadings = []; }],
  ["missing source membership", (data: PluginData) => { data.portableIndex.libraryLayouts.reading[0].subjects = ["source-1"]; }],
  ["archived Library", (data: PluginData) => { data.portableIndex.libraries[0].archivedAt = 10; }],
  ["changed subject Library", (data: PluginData) => { data.portableIndex.subjects[0].libraryId = "other"; }],
  ["missing portable subject", (data: PluginData) => { data.portableIndex.subjects.splice(0, 1); }],
  ["changed Markdown identity", (data: PluginData) => { data.portableIndex.resolvedPathBySubjectId["source-0"] = "Renamed.md"; }],
  ["ambiguous Markdown identity", (data: PluginData) => { data.portableIndex.resolvedPathBySubjectId["source-1"] = "Papers/Source zero.md"; }],
] as const) {
  test(`touch Library rejects ${name} without partial removal`, async () => {
    const { plugin, request } = await fixture();
    const record = plugin.getRecord(request.path);
    mutate(plugin.data);
    const before = structuredClone(plugin.data);
    assert.throws(() => applyLibraryVisualMove(plugin.data, record, request));
    assert.deepEqual(plugin.data, before);
  });
}

test("touch Library resolves source, destination and row anchor again after entering its queue", async () => {
  const { plugin, request, checkpoint, move } = await fixture();
  const record = plugin.getRecord(request.path);
  const productionMutate = plugin.mutate.bind(plugin);
  plugin.mutate = async (label, action, options) => {
    assert.deepEqual(options, { includePortableIndex: true, requireUndo: true });
    plugin.data.portableIndex.libraryLayouts.reading[1].subheadings = [];
    const before = checkpoint();
    await assert.rejects(productionMutate(label, action, options), /destination.*no longer available/);
    assert.deepEqual(checkpoint(), before);
  };
  await move();
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.reading?.[0]?.subjects, [record?.portableId, "source-1"]);
});

test("touch Library rejects stale, self and incompatible row anchors before mutation", async () => {
  const { plugin, request } = await fixture();
  request.destination = { headingId: "sources" };
  request.position = "before";
  for (const anchor of [null, "vanished", "source-0", "source-2"]) {
    request.anchorSubjectId = anchor;
    const before = structuredClone(plugin.data);
    assert.throws(() => applyLibraryVisualMove(plugin.data, plugin.getRecord(request.path), request), /neighboring record/);
    assert.deepEqual(plugin.data, before);
  }
  request.position = "inside";
  request.anchorSubjectId = "source-1";
  assert.throws(() => applyLibraryVisualMove(plugin.data, plugin.getRecord(request.path), request), /heading or subheading/);
  request.anchorSubjectId = null;
  request.source = null;
  assert.throws(() => applyLibraryVisualMove(plugin.data, plugin.getRecord(request.path), request), /placement changed/);
});

test("touch Library duplicate cleanup is scoped to its own Library and leaves collections untouched", async () => {
  const { plugin, request } = await fixture();
  plugin.data.portableIndex.libraryLayouts.reading[0].subjects.push("source-0");
  plugin.data.portableIndex.libraryLayouts.other = [
    { id: "other-heading", title: "Other", collapsed: false, subjects: ["source-0"], subheadings: [] },
  ];
  const other = structuredClone(plugin.data.portableIndex.libraryLayouts.other);
  const collections = structuredClone(plugin.data.collections);
  applyLibraryVisualMove(plugin.data, plugin.getRecord(request.path), request);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.reading?.[0]?.subjects, ["source-1"]);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.other, other);
  assert.deepEqual(plugin.data.collections, collections);
});

test("shared catalog group semantics normalize labels but never borrow another Library's group", () => {
  const data = fixtureData();
  assert.equal(ensureLibraryCatalogGroup(data, "reading", "  REFERENCES  "), "references-group");
  data.portableIndex.subjects.push({
    ...data.portableIndex.subjects[2], id: "other-subject", libraryId: "other", groupId: "references-group",
  });
  const created = ensureLibraryCatalogGroup(data, "reading", "References");
  assert.notEqual(created, "references-group");
  assert.equal(data.portableIndex.groups.find((group) => group.id === created)?.title, "References");
});
