import assert from "node:assert/strict";
import test from "node:test";
import { Notice, TFile } from "obsidian";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { buildCurriculumTree, libraryTabId, migrateData, restoreSnapshot, snapshotPersonal, type LayoutHeading, type MainTab, type PluginData, type VaultRecord } from "../src/model.ts";
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
  runTouchDrop(source: Source, destination: Destination): Promise<void>;
  settleTouchRefresh(): void;
  viewFeedback: { message: string; tone: string } | null;
  touchRefreshDirty: boolean;
  touchDropsInFlight: number;
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
  let gestureBusy = false;
  let reloads = 0;
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
    touchDrag: {
      registerHandle: (_handle: HTMLElement, _row: HTMLElement, _label: string, callback: () => Source | null) => { getSource = callback; },
      hasGesture: () => gestureBusy,
    },
    touchDropsInFlight: 0, touchRefreshDirty: false,
    reload: async () => { reloads++; },
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
    get reloads() { return reloads; }, set gestureBusy(value: boolean) { gestureBusy = value; },
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
  // WF-09: success is reported on the persistent view surface, only after persistence.
  assert.match(h.view.viewFeedback?.message ?? "", /Use Undo/u);
  assert.equal(h.view.viewFeedback?.tone, "status");
  assert.deepEqual(notices.messages, []);
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
  // WF-09: a bare generation advance is no longer a rejection; one that changes the hierarchy still is.
  ["search generation with a changed hierarchy", (h) => { h.state.generation++; h.records[3].title = "Retitled"; }],
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

// ---- WF-09: keep valid touch moves across unrelated refresh (synthetic fixtures) ----

test("WF09 D2 an advanced search generation keeps Index, Collection and Library moves valid while the hierarchy is unchanged", async () => {
  const origins: Array<{ origin: Origin; prepare: (h: ReturnType<typeof harness>) => void; destination: Destination }> = [
    { origin: { kind: "index", path: "Notes/A.md" }, prepare: () => undefined, destination: indexTarget() },
    { origin: { kind: "collection", path: "Notes/A.md", membership: { headingId: "first" } }, prepare: (h) => { collections(h); }, destination: collectionDestination() },
    { origin: { kind: "library", path: "Notes/A.md", libraryId: "references", membership: null }, prepare: (h) => { h.data.activeTab = libraryTabId("references"); },
      destination: { node: { kind: "library", libraryId: "references", membership: { headingId: "second" }, path: "Notes/D.md", subjectId: "subject-D" }, position: "after" } },
  ];
  for (const { origin, prepare, destination } of origins) {
    const h = harness();
    prepare(h);
    const source = h.source(origin);
    // Unrelated metadata: another note's priority and mtime change, and the search generation advances.
    h.records[4].priority = "P1";
    h.records[4].mtime++;
    h.state.generation++;
    assert.equal(h.view.touchSourceIsCurrent(source), true, `${origin.kind}: unrelated metadata keeps the gesture valid`);
    await h.view.commitTouchMove(source, destination);
    assert.equal(h.mutations.length + h.libraryMoves.length, 1, `${origin.kind}: exactly one move`);
  }
});

test("WF09 D3 hierarchy, target, ancestor and organization changes still invalidate a gesture after a generation advance", async () => {
  const changes: Array<[string, (h: ReturnType<typeof harness>) => void]> = [
    ["parent of the source changes", (h) => { h.records[0].parentTopic = "Notes/D.md"; }],
    ["target note moves group", (h) => { h.records[3].domain = "Other"; h.records[3].folderOrder = "Other"; }],
    ["an ancestor is renamed", (h) => { h.records[1].title = "Renamed"; }],
    ["the target note disappears", (h) => { h.records.splice(3, 1); }],
    ["organization data changes", (h) => { h.data.indexGroupOrder.push("Elsewhere"); }],
    ["the tab changes", (h) => { h.data.activeTab = "collections"; }],
    ["read-only begins", (h) => { h.state.readOnly = true; }],
    ["the data epoch advances", (h) => { h.state.epoch++; }],
  ];
  for (const [name, change] of changes) {
    const h = harness();
    const source = h.source();
    change(h);
    h.state.generation++;
    // Organization data is guarded by the commit's own fingerprint rather than by the gesture check.
    if (name !== "organization data changes") assert.equal(h.view.touchSourceIsCurrent(source), false, name);
    await assert.rejects(h.view.commitTouchMove(source, indexTarget()), /organization changed during the drag/u, name);
    assert.equal(h.mutations.length, 0, name);
  }
});

test("WF09 D5 a delayed failed mutation reports a truthful persistent failure, runs once, and settles one refresh afterwards", async () => {
  const h = harness();
  const source = h.source();
  h.gestureBusy = false;
  let release = (): void => undefined;
  let invocations = 0;
  h.plugin.mutate = async () => {
    invocations += 1;
    await new Promise<void>((resolve) => { release = resolve; });
    throw new Error("Synthetic save failure");
  };
  const pending = h.view.runTouchDrop(source, indexTarget());
  assert.equal(h.view.touchDropsInFlight, 1);
  assert.match(h.view.viewFeedback?.message ?? "", /Moving/u);
  assert.equal(h.view.viewFeedback?.tone, "status");
  // An unrelated refresh requested while the commit is pending must wait.
  h.gestureBusy = false;
  h.view.touchRefreshDirty = true;
  h.view.settleTouchRefresh();
  assert.equal(h.reloads, 0, "no refresh while the drop callback is pending");
  release();
  await pending;
  assert.equal(invocations, 1);
  assert.equal(h.view.touchDropsInFlight, 0);
  assert.equal(h.view.viewFeedback?.tone, "error");
  assert.match(h.view.viewFeedback?.message ?? "", /Synthetic save failure/u);
  assert.doesNotMatch(h.view.viewFeedback?.message ?? "", /Moved/u);
  assert.equal(h.reloads, 1, "exactly one follow-up refresh after the failure");
  assert.deepEqual(notices.messages, []);
});

test("WF09 D6 a settled move reports success only after persistence and Undo/Redo match the requested move", async () => {
  const h = harness();
  const before = h.view.touchOrganizationFingerprint();
  const source = h.source();
  let release = (): void => undefined;
  const plainMutate = h.plugin.mutate;
  h.plugin.mutate = async (label, action, options) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await plainMutate(label, action, options);
  };
  const pending = h.view.runTouchDrop(source, indexTarget());
  assert.doesNotMatch(h.view.viewFeedback?.message ?? "", /Moved/u, "no success before the save completes");
  release();
  await pending;
  assert.match(h.view.viewFeedback?.message ?? "", /Moved “A”.*Use Undo/u);
  const after = h.view.touchOrganizationFingerprint();
  assert.notEqual(after, before);
  const tree = buildCurriculumTree(h.plugin.getRecords(), h.data.curriculumVisual, false);
  assert.equal(tree.parentByPath.get("Notes/A.md"), "Notes/D.md", "the fresh tree shows the requested move");
  const undo = h.data.undoStack.at(-1);
  assert.ok(undo);
  const redo = snapshotPersonal(h.data, "redo");
  restoreSnapshot(h.data, undo);
  assert.equal(h.view.touchOrganizationFingerprint(), before, "Undo restores the exact prior organization");
  restoreSnapshot(h.data, redo);
  assert.equal(h.view.touchOrganizationFingerprint(), after, "Redo restores the exact requested move");
});

test("WF09 D4 view close or cancellation never revives a refresh; a cancelled gesture settles exactly one", () => {
  const h = harness();
  h.view.touchRefreshDirty = true;
  h.gestureBusy = true;
  h.view.settleTouchRefresh();
  assert.equal(h.reloads, 0, "still busy");
  h.gestureBusy = false;
  h.view.settleTouchRefresh();
  h.view.settleTouchRefresh();
  assert.equal(h.reloads, 1, "exactly one follow-up refresh");
  const closed = harness();
  closed.view.touchRefreshDirty = true;
  closed.view.viewClosed = true;
  closed.view.settleTouchRefresh();
  assert.equal(closed.reloads, 0, "a closed view is never revived");
});

async function fullTouchView() {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.setupComplete = true;
  data.settings.enableHoverPreview = false;
  data.activeTab = "curriculum";
  const records = ["A", "B", "C", "D", "E"].map((id) => record(id));
  const realPlugin = new EntVaultCommandCenterPlugin({
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] }, metadataCache: { getFileCache: () => null }, fileManager: {},
  } as never, {} as never);
  let busy = false;
  let mutations = 0;
  const plugin = {
    data, getActiveKnowledgeBaseId: () => "touch-base", getDataEpoch: () => 0,
    // The real production counter: invalidateRecordCache() advances the actual search generation.
    getSearchGeneration: () => realPlugin.getSearchGeneration(), getExternalChangeGeneration: () => 0,
    getRecords: () => records, getRecord: (path: string) => records.find((item) => item.path === path) ?? null,
    reconcileRecords: async () => false, isDataReadOnly: () => false, savePluginData: async () => undefined, saveViewState: async () => undefined,
    getIndexRecords: () => records, getIndexCandidateFiles: () => [], searchKnowledgeBases: async () => ({ results: [], total: 0, truncated: false }),
    isClinicalMode: () => false, canVisuallyMoveAcrossGroups: () => true, countMemberships: () => 0, getBacklinkPaths: () => [], resolveLink: () => null,
    getLibraries: () => [], getLibrary: () => null,
    mutate: async (label: string, action: () => void) => {
      mutations += 1;
      data.undoStack.push(snapshotPersonal(data, label));
      action();
      await view.reload();
    },
  };
  const app = { vault: { getAbstractFileByPath: (path: string) => records.some((item) => item.path === path) ? new TFile(path) : null }, metadataCache: { getFileCache: () => ({}) } };
  const Ctor = EntVaultCommandCenterView as unknown as new (leaf: { app: typeof app }, plugin: unknown) => EntVaultCommandCenterView;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window, writable: true });
  let view: EntVaultCommandCenterView;
  try { view = new Ctor({ app }, plugin); } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
  }
  const content = dom.document.body.createDiv({ cls: "view-content" });
  content.setBoundingClientRect({ width: 1366, height: 900 });
  view.contentEl = asHtmlElement(content);
  await view.reload();
  const touch = view as unknown as TouchView & { touchDrag: unknown; render: (...args: unknown[]) => void; reload(): Promise<void> };
  let getSource: (() => Source | null) | null = null;
  touch.touchDrag = {
    hasGesture: () => busy, destroy: () => undefined,
    registerHandle: (_h: HTMLElement, _r: HTMLElement, _l: string, callback: () => Source | null) => { getSource = callback; },
  };
  touch.curriculumArrangeMode = true;
  let renders = 0;
  const originalRender = (view as unknown as { render(...args: unknown[]): void }).render.bind(view);
  touch.render = (...args: unknown[]) => { renders += 1; originalRender(...args); };
  touch.renderTouchHandle(asHtmlElement(dom.document.body.createDiv()), records[0], { kind: "index", path: records[0].path });
  const source = getSource?.() ?? null;
  return {
    view: touch, records, data, source, content, realPlugin,
    panel: () => content.querySelector(".ent-cc-tree-panel"),
    get renders() { return renders; }, get mutations() { return mutations; },
    set busy(value: boolean) { busy = value; },
  };
}

test("WF09 R1 a tab change that replaces the controller of a held gesture settles the deferred refresh once, and an ordinary tab change adds none", async () => {
  const h = await fullTouchView();
  const changeTab = (tab: string): Promise<void> => (h.view as unknown as { changeTab(tab: string): Promise<void> }).changeTab(tab);
  h.busy = true;
  h.records[4].priority = "P1";
  h.records[4].mtime += 1;
  h.realPlugin.invalidateRecordCache();
  await h.view.reload();
  assert.equal(h.view.touchRefreshDirty, true, "the refresh was deferred under the held gesture");
  assert.equal(h.renders, 0);
  // ArrowRight on the focused tab while the pointer is still down: the real tab route replaces the controller.
  await changeTab("collections");
  h.busy = false;
  await Promise.resolve();
  assert.equal(h.view.touchRefreshDirty, false, "the deferred refresh is not stranded");
  assert.equal(h.renders, 2, "one render for the tab, exactly one deferred refresh");
  await changeTab("curriculum");
  assert.equal(h.renders, 3, "control: a tab change with nothing deferred schedules no extra refresh");
  await Promise.resolve();
  assert.equal(h.renders, 3);
});

test("WF09 D1 an unrelated refresh and a real search-generation advance during a gesture leave one valid move and exactly one deferred refresh", async () => {
  const h = await fullTouchView();
  assert.ok(h.source, "the gesture source is available");
  const source = h.source;
  const panel = h.panel();
  assert.ok(panel);
  const generation = h.realPlugin.getSearchGeneration();
  h.busy = true;
  for (let turn = 0; turn < 3; turn += 1) {
    h.records[4].priority = "P1";
    h.records[4].mtime += 1;
    h.realPlugin.invalidateRecordCache();
    await h.view.reload();
  }
  assert.ok(h.realPlugin.getSearchGeneration() > generation, "the real search generation advanced");
  assert.equal(h.renders, 0, "the display refresh is deferred, not rendered under the gesture");
  assert.ok(h.panel() === panel, "the DOM the user is dragging in is untouched");
  assert.equal(h.view.touchSourceIsCurrent(source), true, "the unrelated metadata change did not invalidate the move");
  h.busy = false;
  const move = h.view.runTouchDrop(source, indexTarget());
  await move;
  assert.equal(h.mutations, 1, "exactly one correct mutation");
  assert.equal(h.data.curriculumVisual.parentByPath["Notes/A.md"], "Notes/D.md");
  assert.equal(h.renders, 1, "exactly one deferred refresh after completion");
  h.view.settleTouchRefresh();
  assert.equal(h.renders, 1, "no second refresh");
});
