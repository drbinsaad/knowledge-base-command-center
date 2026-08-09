import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Notice, Platform } from "obsidian";
import {
  libraryTabId,
  migrateData,
  parseQuery,
  type LibraryDefinition,
  type PluginData,
  type VaultRecord,
} from "../src/model.ts";
import { EntVaultCommandCenterView, prepareKnowledgeBaseSearchResults } from "../src/view.ts";
import { asHtmlElement, createFakeDom, type FakeWindow } from "./support/fake-dom.ts";

interface MobileViewHarness {
  contentEl: HTMLElement;
  workspaceEl: HTMLElement | null;
  treeEl: HTMLElement | null;
  query: string;
  renderGlobalSearchResults(parent: HTMLElement): number;
  renderRecordRow(parent: HTMLElement, record: VaultRecord, level: number, membership?: { headingId: string }, searchContext?: unknown, libraryMembership?: { libraryId: string; headingId: string; subheadingId?: string }): void;
  renderLibrary(parent: HTMLElement, records: VaultRecord[]): number;
  renderTabs(parent: HTMLElement): void;
  renderSearch(parent: HTMLElement): void;
  reload(): Promise<void>;
}

interface ClipboardViewHarness extends MobileViewHarness {
  copyAction(parent: HTMLElement, icon: string, label: string, command: string): void;
}

interface SearchSource {
  baseId: string;
  baseName: string;
  data: PluginData;
  records: VaultRecord[];
}

function record(path: string, title: string): VaultRecord {
  return {
    path,
    title,
    kind: "topic",
    role: "supporting",
    curriculumId: "",
    domain: "Research",
    topicKind: "Note",
    priority: "",
    reviewStatus: "unverified",
    synthesisStatus: "",
    autoresearchStatus: "",
    safetyCritical: false,
    sourceCount: 0,
    aliases: [],
    relatedTopics: [],
    parentTopic: "",
    imageStatus: "",
    doseStatus: "",
    sourceCoverage: "",
    folderOrder: "Research",
    mtime: 0,
    aiLock: false,
  };
}

const CUSTOM_LIBRARY_ID = "reference-sets";

function customLibrary(): LibraryDefinition {
  return {
    id: CUSTOM_LIBRARY_ID,
    name: "Reference Sets",
    singularName: "Reference",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  };
}

function installCustomLibrary(data: PluginData): LibraryDefinition {
  const library = customLibrary();
  data.portableIndex.libraries.push(library);
  data.portableIndex.libraryLayouts[library.id] = [];
  return library;
}

function installWindow(window: FakeWindow): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: window, writable: true });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

function searchSource(baseId: string, baseName: string, records: VaultRecord[]): SearchSource {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.enableHoverPreview = false;
  data.settings.workspaceName = baseName;
  return { baseId, baseName, data, records };
}

function createView(window: FakeWindow, inputSources: SearchSource[] = []): EntVaultCommandCenterView {
  const sources = inputSources.length > 0
    ? inputSources
    : [searchSource("base-mobile", "Mobile base", [])];
  const data = sources[0].data;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => sources[0].baseId,
    getDataEpoch: () => 0,
    getSearchGeneration: () => 0,
    getRecords: () => sources[0].records,
    reconcileRecords: async () => false,
    isDataReadOnly: () => false,
    savePluginData: async () => undefined,
    getIndexRecords: () => sources[0].records,
    getIndexCandidateFiles: () => [],
    searchKnowledgeBases: async (query: string, options?: { limit?: number }) => prepareKnowledgeBaseSearchResults(
      sources,
      query,
      options?.limit,
    ),
    isClinicalMode: () => false,
    getLibraries: (includeArchived = false) => data.portableIndex.libraries
      .filter((library) => includeArchived || library.archivedAt === null)
      .map((library) => ({ ...library })),
    getLibrary: (libraryId: string) => data.portableIndex.libraries.find((library) => library.id === libraryId) ?? null,
  };
  const ViewConstructor = EntVaultCommandCenterView as unknown as new (
    leaf: { app: Record<string, never> },
    plugin: typeof plugin,
  ) => EntVaultCommandCenterView;
  const restoreWindow = installWindow(window);
  try {
    return new ViewConstructor({ app: {} }, plugin);
  } finally {
    restoreWindow();
  }
}

test("real mobile search focus applies the keyboard viewport and resets every scroll owner", () => {
  const dom = createFakeDom();
  dom.window.innerHeight = 844;
  dom.window.visualViewport.height = 430;
  dom.window.visualViewport.offsetTop = 20;
  const view = createView(dom.window) as unknown as MobileViewHarness;
  const content = dom.document.body.createDiv({ cls: "view-content" });
  content.clientHeight = 780;
  content.scrollTop = 480;
  content.setBoundingClientRect({ bottom: 844, top: 64 });
  const shell = content.createDiv({ cls: "ent-cc-shell" });
  shell.setBoundingClientRect({ bottom: 844, top: 64 });
  const workspace = content.createDiv({ cls: "ent-cc-workspace" });
  workspace.scrollTop = 320;
  const tree = workspace.createDiv({ cls: "ent-cc-tree-panel" });
  tree.scrollTop = 210;
  view.contentEl = asHtmlElement(content);
  view.workspaceEl = asHtmlElement(workspace);
  view.treeEl = asHtmlElement(tree);

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    view.renderSearch(asHtmlElement(shell));
    const input = shell.querySelector('input[type="search"]');
    assert.ok(input, "the production search renderer should create a search input");
    input.focus({ preventScroll: true });

    assert.equal(shell.hasClass("is-search-focused"), true);
    assert.equal(shell.hasClass("is-virtual-keyboard-open"), true);
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-height"), "386px");
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-shift"), "0px");
    assert.equal(content.scrollTop, 0);
    assert.equal(workspace.scrollTop, 0);
    assert.equal(tree.scrollTop, 0);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("real mobile search follows iOS visual-viewport panning below the shell top", () => {
  const dom = createFakeDom();
  dom.window.innerHeight = 844;
  dom.window.visualViewport.height = 430;
  dom.window.visualViewport.offsetTop = 120;
  const view = createView(dom.window) as unknown as MobileViewHarness;
  const content = dom.document.body.createDiv({ cls: "view-content" });
  content.clientHeight = 780;
  content.setBoundingClientRect({ bottom: 844, top: 64 });
  const shell = content.createDiv({ cls: "ent-cc-shell" });
  shell.setBoundingClientRect({ bottom: 844, top: 64 });
  view.contentEl = asHtmlElement(content);

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    view.renderSearch(asHtmlElement(shell));
    const input = shell.querySelector('input[type="search"]');
    assert.ok(input);
    input.focus({ preventScroll: true });

    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-height"), "430px");
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-shift"), "56px");

    input.blur();
    assert.equal(shell.hasClass("is-search-focused"), false);
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-height"), "");
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-shift"), "");
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("real mobile reload renders a non-empty global search route end to end", async () => {
  const dom = createFakeDom();
  const result = record("Knowledge Base/Laryngomalacia.md", "Laryngomalacia");
  const source = searchSource("base-mobile", "Mobile base", [result]);
  source.data.settings.setupComplete = true;
  const view = createView(dom.window, [source]) as unknown as MobileViewHarness;
  const content = dom.document.body.createDiv({ cls: "view-content" });
  content.clientHeight = 780;
  content.setBoundingClientRect({ bottom: 844, top: 64 });
  view.contentEl = asHtmlElement(content);
  view.query = "laryn";

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    await view.reload();
    await Promise.resolve();
    await Promise.resolve();

    const shell = content.querySelector(".ent-cc-shell");
    const input = content.querySelector('input[type="search"]');
    assert.ok(shell, "reload should build the production command-center shell");
    assert.ok(input, "reload should build the production search input");
    assert.equal(input.value, "laryn");
    assert.equal(content.querySelectorAll(".ent-cc-search-base-group").length, 1);
    assert.equal(content.querySelectorAll(".ent-cc-subject-row").length, 1);
    assert.match(content.textContent, /Laryngomalacia/);
    assert.doesNotMatch(content.textContent, /No records match this search/);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("real record rendering suppresses desktop drag controls when Platform.isMobile is true", () => {
  const dom = createFakeDom();
  const view = createView(dom.window) as unknown as MobileViewHarness & { editMode: boolean };
  const parent = dom.document.body.createDiv();
  view.editMode = true;

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    view.renderRecordRow(asHtmlElement(parent), record("Knowledge Base/Mobile.md", "Mobile note"), 1, { headingId: "heading-a" });

    assert.equal(parent.querySelectorAll(".ent-cc-subject-row").length, 1);
    assert.equal(parent.querySelectorAll(".ent-cc-subject-title").length, 1);
    assert.equal(parent.querySelectorAll(".ent-cc-drag-handle").length, 0);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("mobile library hierarchy stays compact and exposes menu-based heading controls", () => {
  const dom = createFakeDom();
  const view = createView(dom.window) as unknown as MobileViewHarness & {
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    parsedQuery: ReturnType<typeof parseQuery>;
    editMode: boolean;
    plugin: { data: PluginData };
  };
  const library = installCustomLibrary(view.plugin.data);
  const reference: VaultRecord = {
    ...record("Knowledge Base/Airway guideline.md", "Airway guideline"),
    role: "library",
    portableId: "subject-airway-guideline",
    libraryId: library.id,
  };
  view.records = [reference];
  view.recordByPath = new Map([[reference.path, reference]]);
  view.parsedQuery = parseQuery("");
  view.plugin.data.activeTab = libraryTabId(library.id);
  view.plugin.data.portableIndex.subjects = [{
    id: "subject-airway-guideline",
    title: "Airway guideline",
    groupId: "group-reference-sets",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "topic",
    libraryId: library.id,
  }];
  view.plugin.data.portableIndex.libraryLayouts[library.id] = [{
    id: "heading-airway",
    title: "Airway",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "subheading-guidelines", title: "Guidelines", collapsed: false, subjects: ["subject-airway-guideline"] }],
  }];
  view.editMode = true;
  const parent = dom.document.body.createDiv();

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    assert.equal(view.renderLibrary(asHtmlElement(parent), [reference]), 1);
    assert.equal(parent.querySelectorAll(".ent-cc-library-group").length, 1);
    assert.equal(parent.querySelectorAll(".ent-cc-library-subheading").length, 1);
    assert.equal(parent.querySelectorAll(".ent-cc-subject-row").length, 1);
    assert.equal(parent.querySelectorAll(".ent-cc-drag-handle").length, 0, "touch uses the 44px ellipsis menus instead of desktop drag handles");
    assert.ok(parent.querySelector(".ent-cc-heading-row .ent-cc-row-more"));
    assert.ok(parent.querySelector(".ent-cc-subheading-row .ent-cc-row-more"));
    assert.ok(parent.querySelector(".ent-cc-subject-row .ent-cc-row-more"));
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("mobile library fallback uses one durable Unplaced section instead of stale source groups", () => {
  const dom = createFakeDom();
  const view = createView(dom.window) as unknown as MobileViewHarness & {
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    parsedQuery: ReturnType<typeof parseQuery>;
    plugin: { data: PluginData };
  };
  const library = installCustomLibrary(view.plugin.data);
  const references: VaultRecord[] = [
    { ...record("Knowledge Base/Airway guideline.md", "Airway guideline"), role: "library", domain: "Old Rhinology", libraryId: library.id },
    { ...record("Knowledge Base/Otology guideline.md", "Otology guideline"), role: "library", domain: "Old Otology", libraryId: library.id },
  ];
  view.records = references;
  view.recordByPath = new Map(references.map((item) => [item.path, item]));
  view.parsedQuery = parseQuery("");
  view.plugin.data.activeTab = libraryTabId(library.id);
  const parent = dom.document.body.createDiv();

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    assert.equal(view.renderLibrary(asHtmlElement(parent), references), 2);
    assert.equal(parent.querySelectorAll(".ent-cc-library-fallback").length, 1);
    assert.equal(parent.querySelector(".ent-cc-library-fallback .ent-cc-row-title")?.textContent, "Unplaced Reference Sets");
    assert.equal(parent.querySelectorAll(".ent-cc-library-fallback .ent-cc-subject-row").length, 2);
    assert.doesNotMatch(parent.textContent, /Old Rhinology|Old Otology/);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("mobile renders and reveals an active custom-library tab without exposing archived libraries", () => {
  const dom = createFakeDom();
  const view = createView(dom.window) as unknown as MobileViewHarness & {
    records: VaultRecord[];
    plugin: { data: PluginData };
  };
  const library = installCustomLibrary(view.plugin.data);
  view.plugin.data.portableIndex.libraries.push({
    ...customLibrary(),
    id: "archived-library",
    name: "Archived Library",
    order: 1,
    archivedAt: Date.now(),
  });
  view.plugin.data.activeTab = libraryTabId(library.id);
  view.records = [{ ...record("Reference/Airway.md", "Airway"), libraryId: library.id }];
  const parent = dom.document.body.createDiv();

  view.renderTabs(asHtmlElement(parent));

  const active = parent.querySelector(`[data-tab="${libraryTabId(library.id)}"]`);
  assert.ok(active);
  assert.equal(active.getAttribute("aria-selected"), "true");
  assert.match(active.textContent, /Reference Sets1/);
  assert.equal(active.querySelector(".ent-cc-tab-label")?.textContent, "Reference Sets");
  assert.equal((active as unknown as { scrollIntoViewCalls: number }).scrollIntoViewCalls, 1);
  assert.doesNotMatch(parent.textContent, /Archived Library/);
});

test("mobile heading and subheading title controls retain a 44px touch target", () => {
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.ent-cc-view \.ent-cc-heading-row button\.ent-cc-row-title,\s*\.ent-cc-view \.ent-cc-subheading-row button\.ent-cc-row-title\s*\{\s*min-height:\s*44px;/);
  assert.match(styles, /\.ent-cc-tab-label\s*\{\s*max-width:\s*42vw;/);
});

test("desktop library drag and drop moves records across headings and reorders rows", async () => {
  const dom = createFakeDom();
  const view = createView(dom.window) as unknown as MobileViewHarness & {
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    parsedQuery: ReturnType<typeof parseQuery>;
    editMode: boolean;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    plugin: {
      data: PluginData;
      mutate(label: string, action: () => void, options?: { includePortableIndex?: boolean; requireUndo?: boolean }): Promise<void>;
      assignRecordToLibrary(path: string, libraryId: string, target: { headingId: string }): Promise<void>;
    };
    writeLibraryDrag(event: DragEvent, payload: {
      kind: "library-membership";
      libraryId: string;
      subjectId: string;
      headingId: string;
    }): void;
    readLibraryDrag(event: DragEvent): {
      kind: "library-membership";
      libraryId: string;
      subjectId: string;
      headingId: string;
      ownerViewId: string;
      renderToken: string;
      baseId: string;
      dataEpoch: number;
    } | null;
  };
  const library = installCustomLibrary(view.plugin.data);
  const first: VaultRecord = {
    ...record("Knowledge Base/Airway guideline.md", "Airway guideline"),
    role: "library",
    portableId: "subject-a",
    libraryId: library.id,
  };
  const second: VaultRecord = {
    ...record("Knowledge Base/Otology guideline.md", "Otology guideline"),
    role: "library",
    portableId: "subject-b",
    libraryId: library.id,
  };
  view.records = [first, second];
  view.recordByPath = new Map(view.records.map((item) => [item.path, item]));
  view.parsedQuery = parseQuery("");
  view.editMode = true;
  view.loadedBaseId = "base-mobile";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.plugin.data.activeTab = libraryTabId(library.id);
  view.plugin.data.portableIndex.libraryLayouts[library.id] = [
    { id: "heading-a", title: "Heading A", collapsed: false, subjects: ["subject-a", "subject-b"], subheadings: [] },
    { id: "heading-b", title: "Heading B", collapsed: false, subjects: [], subheadings: [] },
  ];
  const assignments: Array<{ path: string; headingId: string }> = [];
  view.plugin.assignRecordToLibrary = async (path, assignedLibraryId, target) => {
    assert.equal(assignedLibraryId, library.id);
    assignments.push({ path, headingId: target.headingId });
  };
  view.plugin.mutate = async (_label, action, options) => {
    assert.deepEqual(options, { includePortableIndex: true, requireUndo: true });
    action();
  };

  const payload = {
    kind: "library-membership" as const,
    libraryId: library.id,
    subjectId: "subject-a",
    headingId: "heading-a",
  };
  const transferValues = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "none",
    dropEffect: "none",
    setData(type: string, value: string) { transferValues.set(type, value); },
    getData(type: string) { return transferValues.get(type) ?? ""; },
  };
  const dragEvent = { dataTransfer } as unknown as DragEvent;
  view.writeLibraryDrag(dragEvent, payload);
  assert.equal(dataTransfer.effectAllowed, "move");
  const guardedPayload = view.readLibraryDrag(dragEvent);
  assert.ok(guardedPayload);
  assert.deepEqual({
    kind: guardedPayload.kind,
    libraryId: guardedPayload.libraryId,
    subjectId: guardedPayload.subjectId,
    headingId: guardedPayload.headingId,
  }, payload);
  assert.equal(typeof guardedPayload.ownerViewId, "string");
  assert.equal(typeof guardedPayload.renderToken, "string");
  assert.equal(guardedPayload.baseId, "base-mobile");
  assert.equal(guardedPayload.dataEpoch, 0);

  const parent = dom.document.body.createDiv();
  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = false;
  try {
    assert.equal(view.renderLibrary(asHtmlElement(parent), view.records), 2);
    assert.equal(parent.querySelectorAll(".ent-cc-drag-handle").length, 2);

    const headingRows = parent.querySelectorAll(".ent-cc-heading-row");
    assert.equal(headingRows.length, 2);
    view.readLibraryDrag = () => ({ ...guardedPayload, renderToken: "stale-render-token" });
    headingRows[1]?.dispatch("drop");
    await Promise.resolve();
    assert.deepEqual(assignments, [], "a drag created by an older render must not mutate the current layout");

    view.readLibraryDrag = () => guardedPayload;
    const headingDrop = headingRows[1]?.dispatch("dragover");
    assert.equal(headingDrop?.defaultPrevented, true);
    headingRows[1]?.dispatch("drop");
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(assignments, [{ path: first.path, headingId: "heading-b" }]);

    const recordRows = parent.querySelectorAll(".ent-cc-subject-row");
    assert.equal(recordRows.length, 2);
    recordRows[1]?.setBoundingClientRect({ top: 0, height: 44, bottom: 44 });
    const rowDrag = recordRows[1]?.dispatch("dragover", { clientY: 40 });
    assert.equal(rowDrag?.defaultPrevented, true);
    assert.equal(recordRows[1]?.hasClass("is-drop-after"), true);
    recordRows[1]?.dispatch("drop", { clientY: 40 });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(view.plugin.data.portableIndex.libraryLayouts[library.id]?.[0]?.subjects, ["subject-b", "subject-a"]);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("real cross-base search rendering caps mobile DOM rows while preserving the full match count", async () => {
  const dom = createFakeDom();
  const firstRecords = Array.from({ length: 240 }, (_, index) => record(
    `First/Result ${index.toString().padStart(3, "0")}.md`,
    `Result first ${index.toString().padStart(3, "0")}`,
  ));
  const secondRecords = Array.from({ length: 210 }, (_, index) => record(
    `Second/Result ${index.toString().padStart(3, "0")}.md`,
    `Result second ${index.toString().padStart(3, "0")}`,
  ));
  const view = createView(dom.window, [
    searchSource("base-first", "First base", firstRecords),
    searchSource("base-second", "Second base", secondRecords),
  ]) as unknown as MobileViewHarness;
  const parent = dom.document.body.createDiv();
  view.query = "result";

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    assert.equal(view.renderGlobalSearchResults(asHtmlElement(parent)), 0, "the async route does not publish a partial result");
    await Promise.resolve();
    parent.empty();
    const total = view.renderGlobalSearchResults(asHtmlElement(parent));

    assert.equal(total, 450, "the view should report every match, including rows beyond the DOM cap");
    assert.equal(parent.querySelectorAll(".ent-cc-subject-row").length, 300);
    assert.equal(parent.querySelectorAll(".ent-cc-search-base-group").length, 2);
    assert.match(parent.querySelector(".ent-cc-search-limit")?.textContent ?? "", /first 300 of 450 results/i);
    assert.match(parent.textContent, /First base/);
    assert.match(parent.textContent, /Second base/);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("the production copy action writes to the clipboard only after its button is clicked", async () => {
  Notice.messages.length = 0;
  const dom = createFakeDom();
  const writes: string[] = [];
  Object.assign(dom.window, {
    navigator: {
      clipboard: {
        writeText: async (value: string): Promise<void> => { writes.push(value); },
      },
    },
  });
  const view = createView(dom.window) as unknown as ClipboardViewHarness;
  const content = dom.document.body.createDiv({ cls: "view-content" });
  const actions = content.createDiv();
  view.contentEl = asHtmlElement(content);

  view.copyAction(asHtmlElement(actions), "copy", "Copy path", "Knowledge Base/Topic.md");

  assert.deepEqual(writes, [], "rendering the action must not touch the clipboard");
  const button = actions.querySelector("button.ent-cc-study-action");
  assert.ok(button);
  button.click();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(writes, ["Knowledge Base/Topic.md"]);
  assert.equal(Notice.messages.includes("Copy path copied."), true);
});
