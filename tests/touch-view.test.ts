import assert from "node:assert/strict";
import test from "node:test";
import { Notice } from "obsidian";
import { buildCurriculumTree, libraryTabId, migrateData, snapshotPersonal, type LayoutHeading, type MainTab, type PluginData, type VaultRecord } from "../src/model.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

const notices = Notice as unknown as { messages: string[] };

interface Membership { headingId: string; subheadingId?: string }
type Origin = { kind: "index"; path: string }
  | { kind: "collection"; path: string; membership: Membership }
  | { kind: "library"; path: string; libraryId: string; membership: Membership | null };
type Target = { kind: "index"; group: string; path?: string }
  | { kind: "collection"; path?: string; membership: Membership }
  | { kind: "library"; path?: string; libraryId: string; membership: Membership; subjectId?: string };
interface Source {
  origin: Origin;
  data: PluginData;
  baseId: string;
  epoch: number;
  generation: number;
  externalGeneration: number;
  renderToken: string;
  tab: MainTab;
  fingerprint: string;
  recordFingerprint: string;
  descendants: Set<string>;
}
interface Destination { node: Target; position: "before" | "inside" | "after" }
interface TouchView {
  viewClosed: boolean;
  loadedBaseId: string;
  loadedDataEpoch: number;
  libraryDragRenderToken: string;
  query: string;
  searchScope: string;
  searchAvailability: string;
  searchLinkedFirst: boolean;
  curriculumArrangeMode: boolean;
  editMode: boolean;
  collapsedCurriculumDomains: Set<string>;
  collapsedCurriculumNodes: Set<string>;
  curriculum: ReturnType<typeof buildCurriculumTree>;
  recordByPath: Map<string, VaultRecord>;
  renderTouchHandle(row: HTMLElement, record: VaultRecord, origin: Origin): void;
  touchSourceIsCurrent(source: Source): boolean;
  touchOrganizationFingerprint(): string;
  commitTouchMove(source: Source, destination: Destination): Promise<void>;
}

function record(id: string, domain = "General"): VaultRecord {
  return {
    path: `Notes/${id}.md`, title: id, domain, folderOrder: domain, kind: "topic", role: "supporting",
    curriculumId: "", topicKind: "Note", priority: "", reviewStatus: "unverified", synthesisStatus: "",
    autoresearchStatus: "", safetyCritical: false, sourceCount: 0, aliases: [], relatedTopics: [],
    parentTopic: "", imageStatus: "", doseStatus: "", sourceCoverage: "", mtime: 0, aiLock: false,
  };
}

function harness() {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.activeTab = "curriculum";
  const records = [record("A"), record("B"), record("C"), record("D"), record("E"), record("F", "Other"), record("G", "Other")];
  data.curriculumVisual.parentByPath = { "Notes/B.md": "Notes/A.md", "Notes/C.md": "Notes/B.md", "Notes/E.md": "Notes/D.md", "Notes/G.md": "Notes/F.md" };
  data.curriculumVisual.orderByContainer = { "root:general": ["Notes/D.md", "Notes/A.md"], "parent:Notes/A.md": ["Notes/B.md"], "parent:Notes/B.md": ["Notes/C.md"] };
  const state = { baseId: "touch-base", epoch: 3, generation: 5, externalGeneration: 8, readOnly: false, externalReload: false, clinical: false };
  const mutations: Array<{ label: string; options?: { requireUndo?: boolean; includePortableIndex?: boolean } }> = [];
  const libraryMoves: Array<{ path: string; libraryId: string; from: Membership | null; to: Membership; anchor: string | null; position: string }> = [];
  let beforeAction: (() => void) | null = null;
  let actionCount = 0;
  let rendered = 0;
  let persisted = 0;
  let getSource: (() => Source | null) | null = null;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => state.baseId,
    getDataEpoch: () => state.epoch,
    getSearchGeneration: () => state.generation,
    getExternalChangeGeneration: () => state.externalGeneration,
    isDataReadOnly: () => state.readOnly,
    isExternalReloadInProgress: () => state.externalReload,
    isClinicalMode: () => state.clinical,
    canVisuallyMoveAcrossGroups: () => !state.clinical || plugin.data.settings.allowClinicalVisualGroupMoves,
    getRecords: () => records.map((item) => ({ ...item, domain: plugin.data.indexGroupByPath[item.path] ?? item.domain, folderOrder: plugin.data.indexGroupByPath[item.path] ?? item.folderOrder })),
    getRecord: (path: string) => plugin.getRecords().find((item) => item.path === path) ?? null,
    mutate: async (label: string, action: () => void, options?: { requireUndo?: boolean; includePortableIndex?: boolean }): Promise<void> => {
      mutations.push({ label, options });
      // Match production's order: Undo is added before the guarded callback.
      plugin.data.undoStack.push(snapshotPersonal(plugin.data, label));
      beforeAction?.();
      action();
      actionCount++;
    },
    moveLibraryRecordVisually: async (path: string, libraryId: string, from: Membership | null, to: Membership, anchor: string | null, position: string, assertCurrent: () => void): Promise<void> => {
      assertCurrent();
      beforeAction?.();
      assertCurrent();
      libraryMoves.push({ path, libraryId, from, to, anchor, position });
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as TouchView;
  Object.assign(view, {
    app: {}, plugin, contentEl: asHtmlElement(dom.document.body),
    viewClosed: false, loadedBaseId: state.baseId, loadedDataEpoch: state.epoch,
    libraryDragRenderToken: "render-1", query: "", searchScope: "all", searchAvailability: "all", searchLinkedFirst: false,
    curriculumArrangeMode: true, editMode: true,
    collapsedCurriculumDomains: new Set(["General", "Other"]), collapsedCurriculumNodes: new Set(["Notes/D.md", "Notes/F.md"]),
    curriculum: buildCurriculumTree(plugin.getRecords(), data.curriculumVisual, false),
    recordByPath: new Map(plugin.getRecords().map((item) => [item.path, item])),
    touchDrag: { registerHandle: (_handle: HTMLElement, _row: HTMLElement, _label: string, callback: () => Source | null) => { getSource = callback; } },
    renderTree: () => { rendered++; }, persistCollapseState: () => { persisted++; },
  });
  const capture = (origin: Origin = { kind: "index", path: "Notes/A.md" }, displayed?: VaultRecord): (() => Source | null) => {
    const current = displayed ?? plugin.getRecord(origin.path);
    assert.ok(current);
    view.renderTouchHandle(asHtmlElement(dom.document.body.createDiv()), current, origin);
    assert.ok(getSource);
    return getSource;
  };
  const source = (origin?: Origin): Source => {
    const result = capture(origin)();
    assert.ok(result);
    return result;
  };
  notices.messages.length = 0;
  return {
    data, records, state, plugin, view, mutations, libraryMoves, capture, source,
    get actionCount() { return actionCount; }, get rendered() { return rendered; }, get persisted() { return persisted; },
    set beforeAction(callback: (() => void) | null) { beforeAction = callback; },
  };
}

function indexTarget(path = "Notes/D.md", group = "General", position: Destination["position"] = "inside"): Destination {
  return { node: { kind: "index", path, group }, position };
}

test("the real touch source callback snapshots the displayed record and complete Index descendants", () => {
  const h = harness();
  const source = h.source();
  assert.equal(source.data, h.data);
  assert.equal(source.baseId, h.state.baseId);
  assert.equal(source.epoch, h.state.epoch);
  assert.equal(source.generation, h.state.generation);
  assert.equal(source.externalGeneration, h.state.externalGeneration);
  assert.equal(source.renderToken, h.view.libraryDragRenderToken);
  assert.deepEqual([...source.descendants], ["Notes/B.md", "Notes/C.md"]);
  assert.equal(h.view.touchSourceIsCurrent(source), true);
  assert.equal(h.mutations.length, 0);
});

test("the real touch source callback refuses changed records and a stale loaded base or epoch", () => {
  for (const alter of [
    (h: ReturnType<typeof harness>) => { h.state.baseId = "other-base"; },
    (h: ReturnType<typeof harness>) => { h.state.epoch++; },
    (h: ReturnType<typeof harness>) => { h.records[0].mtime++; },
    (h: ReturnType<typeof harness>) => { h.records.shift(); },
  ]) {
    const h = harness();
    const getSource = h.capture();
    alter(h);
    assert.equal(getSource(), null);
    assert.equal(h.mutations.length, 0);
  }
});

test("Index drop nests a subtree, requires Undo, and expands the successful destination", async () => {
  const h = harness();
  const unchangedRecords = JSON.stringify(h.records);
  await h.view.commitTouchMove(h.source(), indexTarget());
  assert.equal(h.data.curriculumVisual.parentByPath["Notes/A.md"], "Notes/D.md");
  assert.equal(h.data.curriculumVisual.parentByPath["Notes/B.md"], "Notes/A.md");
  assert.equal(h.data.curriculumVisual.parentByPath["Notes/C.md"], "Notes/B.md");
  assert.deepEqual(h.data.curriculumVisual.orderByContainer["parent:Notes/D.md"], ["Notes/E.md", "Notes/A.md"]);
  assert.deepEqual(h.mutations.map((item) => item.options), [{ requireUndo: true }]);
  assert.equal(h.data.undoStack.length, 1, "Undo creation does not stale the organization fingerprint");
  assert.equal(h.view.collapsedCurriculumDomains.has("General"), false);
  assert.equal(h.view.collapsedCurriculumNodes.has("Notes/D.md"), false);
  assert.equal(h.rendered, 1);
  assert.equal(h.persisted, 1);
  assert.equal(JSON.stringify(h.records), unchangedRecords, "source-note records and classification are untouched");
  assert.match(notices.messages.at(-1) ?? "", /Use Undo/u);
});

for (const position of ["before", "after"] as const) {
  test(`Index ${position} insertion uses the destination's actual parent and sibling order`, async () => {
    const h = harness();
    await h.view.commitTouchMove(h.source(), indexTarget("Notes/E.md", "General", position));
    assert.equal(h.data.curriculumVisual.parentByPath["Notes/A.md"], "Notes/D.md");
    assert.deepEqual(h.data.curriculumVisual.orderByContainer["parent:Notes/D.md"], position === "before" ? ["Notes/A.md", "Notes/E.md"] : ["Notes/E.md", "Notes/A.md"]);
  });
}

test("cross-group Index moves carry every descendant and preserve the subtree's internal order", async () => {
  const h = harness();
  await h.view.commitTouchMove(h.source(), indexTarget("Notes/F.md", "Other"));
  assert.deepEqual(h.data.indexGroupByPath, { "Notes/A.md": "Other", "Notes/B.md": "Other", "Notes/C.md": "Other" });
  assert.equal(h.data.indexGroupOrder.includes("Other"), true);
  assert.equal(h.data.curriculumVisual.parentByPath["Notes/A.md"], "Notes/F.md");
  assert.deepEqual(h.data.curriculumVisual.orderByContainer["parent:Notes/A.md"], ["Notes/B.md"]);
  assert.deepEqual(h.data.curriculumVisual.orderByContainer["parent:Notes/B.md"], ["Notes/C.md"]);
  const rebuilt = buildCurriculumTree(h.plugin.getRecords(), h.data.curriculumVisual, false);
  assert.deepEqual(rebuilt.childrenByPath.get("Notes/F.md"), ["Notes/G.md", "Notes/A.md"]);
  assert.equal(rebuilt.parentByPath.get("Notes/C.md"), "Notes/B.md");
});

test("case-variant merged groups adopt the target spelling through the subtree and remain nested after rebuilding", async () => {
  const h = harness();
  h.state.clinical = true;
  h.data.settings.allowClinicalVisualGroupMoves = false;
  h.records.find((item) => item.path === "Notes/D.md")!.domain = "GENERAL";
  h.records.find((item) => item.path === "Notes/E.md")!.domain = "GENERAL";
  await h.view.commitTouchMove(h.source(), indexTarget("Notes/D.md", "GENERAL"));
  assert.deepEqual(h.data.indexGroupByPath, { "Notes/A.md": "GENERAL", "Notes/B.md": "GENERAL", "Notes/C.md": "GENERAL" });
  const rebuilt = buildCurriculumTree(h.plugin.getRecords(), h.data.curriculumVisual, true);
  assert.equal(rebuilt.parentByPath.get("Notes/A.md"), "Notes/D.md");
  assert.equal(rebuilt.parentByPath.get("Notes/B.md"), "Notes/A.md");
  assert.equal(rebuilt.parentByPath.get("Notes/C.md"), "Notes/B.md");
  assert.deepEqual(rebuilt.childrenByPath.get("Notes/D.md"), ["Notes/E.md", "Notes/A.md"]);
  assert.equal(h.view.collapsedCurriculumDomains.has("General"), false, "the pre-move merged heading label expands despite the target's spelling");
});

test("dropping on a group returns a subject to its top level without changing descendants", async () => {
  const h = harness();
  await h.view.commitTouchMove(h.source({ kind: "index", path: "Notes/B.md" }), { node: { kind: "index", group: "General" }, position: "inside" });
  assert.equal(h.data.curriculumVisual.parentByPath["Notes/B.md"], null);
  assert.equal(h.data.curriculumVisual.parentByPath["Notes/C.md"], "Notes/B.md");
  assert.deepEqual(h.data.curriculumVisual.orderByContainer["root:general"], ["Notes/D.md", "Notes/A.md", "Notes/B.md"]);
});

test("Index self and cross-kind destinations do not create a mutation", async () => {
  const h = harness();
  const source = h.source();
  await h.view.commitTouchMove(source, indexTarget("Notes/A.md"));
  await h.view.commitTouchMove(source, { node: { kind: "collection", membership: { headingId: "x" } }, position: "inside" });
  assert.equal(h.mutations.length, 0);
  assert.equal(h.rendered, 0);
  assert.equal(notices.messages.length, 0);
});

for (const position of ["inside", "before", "after"] as const) {
  test(`Index rejects ${position} a descendant before modifying organization`, async () => {
    const h = harness();
    const before = h.view.touchOrganizationFingerprint();
    await assert.rejects(h.view.commitTouchMove(h.source(), indexTarget("Notes/C.md", "General", position)), /itself or one of its children/u);
    assert.equal(h.view.touchOrganizationFingerprint(), before);
    assert.equal(h.actionCount, 0);
    assert.equal(h.persisted, 0);
    assert.equal(notices.messages.length, 0);
  });
}

test("clinical group restrictions reject a cross-group move but permit it when explicitly enabled", async () => {
  const h = harness();
  h.state.clinical = true;
  h.data.settings.allowClinicalVisualGroupMoves = false;
  const before = h.view.touchOrganizationFingerprint();
  await assert.rejects(h.view.commitTouchMove(h.source(), indexTarget("Notes/F.md", "Other")), /same group/u);
  assert.equal(h.view.touchOrganizationFingerprint(), before);
  h.data.settings.allowClinicalVisualGroupMoves = true;
  await h.view.commitTouchMove(h.source(), indexTarget("Notes/F.md", "Other"));
  assert.equal(h.data.indexGroupByPath["Notes/A.md"], "Other");
});

test("an Index destination absent at the queued action is rejected without removing its source", async () => {
  const h = harness();
  h.beforeAction = () => { h.records.splice(h.records.findIndex((item) => item.path === "Notes/D.md"), 1); };
  const before = h.view.touchOrganizationFingerprint();
  await assert.rejects(h.view.commitTouchMove(h.source(), indexTarget()), /destination is no longer available/u);
  assert.equal(h.view.touchOrganizationFingerprint(), before);
  assert.equal(h.actionCount, 0);
});

function collections(h: ReturnType<typeof harness>): LayoutHeading[] {
  h.data.activeTab = "collections";
  h.data.collections = [
    { id: "first", title: "First", collapsed: true, subjects: ["Notes/A.md", "Notes/B.md"], subheadings: [
      { id: "deep-1", title: "Deep one", collapsed: true, subjects: [], subheadings: [
        { id: "deep-2", title: "Deep two", collapsed: true, subjects: [], subheadings: [
          { id: "deep-3", title: "Deep three", collapsed: true, subjects: [], subheadings: [
            { id: "deep-4", title: "Deep four", collapsed: true, subjects: ["Notes/D.md", "Notes/E.md"] },
          ] },
        ] },
      ] },
    ] },
    { id: "second", title: "Second", collapsed: false, subjects: ["Notes/A.md", "Notes/C.md"], subheadings: [] },
  ];
  return h.data.collections;
}

function collectionDestination(position: Destination["position"] = "inside", path?: string): Destination {
  return { node: { kind: "collection", membership: { headingId: "first", subheadingId: "deep-4" }, path }, position };
}

test("a deep collection drop moves only the dragged occurrence and expands its whole ancestor chain", async () => {
  const h = harness();
  const headings = collections(h);
  const source = h.source({ kind: "collection", path: "Notes/A.md", membership: { headingId: "first" } });
  assert.equal(source.descendants.size, 0);
  await h.view.commitTouchMove(source, collectionDestination());
  assert.deepEqual(headings[0].subjects, ["Notes/B.md"]);
  assert.deepEqual(headings[1].subjects, ["Notes/A.md", "Notes/C.md"], "the same subject's other occurrence is preserved");
  const chain = [headings[0], headings[0].subheadings[0], headings[0].subheadings[0].subheadings![0], headings[0].subheadings[0].subheadings![0].subheadings![0], headings[0].subheadings[0].subheadings![0].subheadings![0].subheadings![0]];
  assert.deepEqual(chain.at(-1)?.subjects, ["Notes/D.md", "Notes/E.md", "Notes/A.md"]);
  assert.ok(chain.every((node) => node.collapsed === false));
  assert.deepEqual(h.mutations.map((item) => item.options), [{ requireUndo: true }]);
});

for (const position of ["before", "after"] as const) {
  test(`collection ${position} insertion resolves the exact deep anchor`, async () => {
    const h = harness();
    const headings = collections(h);
    const destination = headings[0].subheadings[0].subheadings![0].subheadings![0].subheadings![0];
    await h.view.commitTouchMove(h.source({ kind: "collection", path: "Notes/A.md", membership: { headingId: "first" } }), collectionDestination(position, "Notes/E.md"));
    assert.deepEqual(destination.subjects, position === "before" ? ["Notes/D.md", "Notes/A.md", "Notes/E.md"] : ["Notes/D.md", "Notes/E.md", "Notes/A.md"]);
  });
}

test("same-container collection reorder deduplicates only the moved occurrence", async () => {
  const h = harness();
  const headings = collections(h);
  await h.view.commitTouchMove(h.source({ kind: "collection", path: "Notes/A.md", membership: { headingId: "first" } }), {
    node: { kind: "collection", path: "Notes/B.md", membership: { headingId: "first" } }, position: "after",
  });
  assert.deepEqual(headings[0].subjects, ["Notes/B.md", "Notes/A.md"]);
  assert.deepEqual(headings[1].subjects, ["Notes/A.md", "Notes/C.md"]);
});

test("missing collection destination, source occurrence or anchor never removes any other membership", async () => {
  for (const fault of ["destination", "source", "anchor"] as const) {
    const h = harness();
    collections(h);
    const origin: Origin = { kind: "collection", path: "Notes/A.md", membership: { headingId: fault === "source" ? "missing" : "first" } };
    const target = collectionDestination("before", fault === "anchor" ? "Notes/G.md" : "Notes/D.md");
    if (fault === "destination" && target.node.kind === "collection") target.node.membership.subheadingId = "missing";
    const before = h.view.touchOrganizationFingerprint();
    await assert.rejects(h.view.commitTouchMove(h.source(origin), target), /collection placement changed/u);
    assert.equal(h.view.touchOrganizationFingerprint(), before, fault);
    assert.equal(h.actionCount, 0);
  }
});

test("a collection destination removed while queued preserves all surviving source memberships", async () => {
  const h = harness();
  const headings = collections(h);
  h.beforeAction = () => { headings[0].subheadings = []; };
  await assert.rejects(h.view.commitTouchMove(h.source({ kind: "collection", path: "Notes/A.md", membership: { headingId: "first" } }), collectionDestination()), /organization changed during the drag/u);
  assert.deepEqual(headings[0].subjects, ["Notes/A.md", "Notes/B.md"]);
  assert.deepEqual(headings[1].subjects, ["Notes/A.md", "Notes/C.md"]);
  assert.equal(h.actionCount, 0);
});

const staleChanges: Array<[string, (h: ReturnType<typeof harness>) => void]> = [
  ["active base", (h) => { h.state.baseId = "other-base"; }],
  ["loaded base", (h) => { h.view.loadedBaseId = "other-base"; }],
  ["data epoch", (h) => { h.state.epoch++; }],
  ["loaded epoch", (h) => { h.view.loadedDataEpoch++; }],
  ["search generation", (h) => { h.state.generation++; }],
  ["external generation", (h) => { h.state.externalGeneration++; }],
  ["external reload", (h) => { h.state.externalReload = true; }],
  ["data identity", (h) => { h.plugin.data = structuredClone(h.data); }],
  ["render token", (h) => { h.view.libraryDragRenderToken = "new-render"; }],
  ["tab", (h) => { h.data.activeTab = "collections"; }],
  ["search query", (h) => { h.view.query = "airway"; }],
  ["search scope", (h) => { h.view.searchScope = "current"; }],
  ["availability", (h) => { h.view.searchAvailability = "linked"; }],
  ["linked first", (h) => { h.view.searchLinkedFirst = true; }],
  ["read-only mode", (h) => { h.state.readOnly = true; }],
  ["closed view", (h) => { h.view.viewClosed = true; }],
  ["Arrange disabled", (h) => { h.view.curriculumArrangeMode = false; }],
  ["organization fingerprint", (h) => { h.data.displayNameByPath["Notes/F.md"] = "Externally edited"; }],
  ["record fingerprint", (h) => { h.records[0].mtime++; }],
];

for (const [name, change] of staleChanges) {
  test(`queued ${name} changes reject the real commit before any organization move`, async () => {
    const h = harness();
    const source = h.source();
    let afterExternalChange = "";
    h.beforeAction = () => { change(h); afterExternalChange = h.view.touchOrganizationFingerprint(); };
    await assert.rejects(h.view.commitTouchMove(source, indexTarget()), /organization changed during the drag/u);
    assert.equal(h.view.touchOrganizationFingerprint(), afterExternalChange, "the queued action makes no changes after the stale boundary");
    assert.equal(h.actionCount, 0);
    assert.equal(h.rendered, 0);
    assert.equal(h.persisted, 0);
    assert.equal(notices.messages.length, 0);
  });
}

test("stale preflight rejects before entering Undo or persistence", async () => {
  const h = harness();
  const source = h.source();
  h.state.readOnly = true;
  assert.equal(h.view.touchSourceIsCurrent(source), false);
  await assert.rejects(h.view.commitTouchMove(source, indexTarget()), /organization changed during the drag/u);
  assert.equal(h.mutations.length, 0);
  assert.equal(h.data.undoStack.length, 0);
});

test("a required-Undo failure cannot change Index organization or announce success", async () => {
  const h = harness();
  const before = h.view.touchOrganizationFingerprint();
  h.plugin.mutate = async (_label, _action, options) => {
    assert.equal(options?.requireUndo, true);
    throw new Error("Undo could not be recorded");
  };
  await assert.rejects(h.view.commitTouchMove(h.source(), indexTarget()), /Undo could not/u);
  assert.equal(h.view.touchOrganizationFingerprint(), before);
  assert.equal(h.rendered, 0);
  assert.equal(notices.messages.length, 0);
});

test("Library touch commits pass exact occurrence, anchor and queued guard to the shared visual-move operation", async () => {
  const h = harness();
  h.data.activeTab = libraryTabId("references");
  const origin: Origin = { kind: "library", path: "Notes/A.md", libraryId: "references", membership: { headingId: "first", subheadingId: "deep-source" } };
  const destination: Destination = { node: { kind: "library", libraryId: "references", membership: { headingId: "second", subheadingId: "deep-target" }, path: "Notes/D.md", subjectId: "subject-D" }, position: "after" };
  await h.view.commitTouchMove(h.source(origin), destination);
  assert.deepEqual(h.libraryMoves, [{ path: "Notes/A.md", libraryId: "references", from: origin.membership, to: destination.node.kind === "library" ? destination.node.membership : null, anchor: "subject-D", position: "after" }]);
  assert.equal(h.mutations.length, 0, "the shared operation owns its own portable-index Undo transaction");
  const nextSource = h.source(origin);
  h.beforeAction = () => { h.state.readOnly = true; };
  await assert.rejects(h.view.commitTouchMove(nextSource, destination), /organization changed during the drag/u);
  assert.equal(h.libraryMoves.length, 1, "the forwarded guard rejects the queued stale move");
});

test("Library cross-library targets and Collection edit-mode exits are rejected", async () => {
  const h = harness();
  h.data.activeTab = libraryTabId("references");
  await h.view.commitTouchMove(h.source({ kind: "library", path: "Notes/A.md", libraryId: "references", membership: null }), {
    node: { kind: "library", libraryId: "other-library", membership: { headingId: "target" } }, position: "inside",
  });
  assert.equal(h.libraryMoves.length, 0);
  collections(h);
  const source = h.source({ kind: "collection", path: "Notes/A.md", membership: { headingId: "first" } });
  h.view.editMode = false;
  assert.equal(h.view.touchSourceIsCurrent(source), false);
  await assert.rejects(h.view.commitTouchMove(source, collectionDestination()), /organization changed during the drag/u);
  assert.equal(h.mutations.length, 0);
});
