import assert from "node:assert/strict";
import test from "node:test";
import { Menu, Modal, Notice, Platform, Setting, TFile, TFolder } from "obsidian";
import { AddActionModal, calculateModalViewportLayout, CollectionPickerModal, type CollectionTarget, ConfirmModal, IndexGroupModal, KnowledgeNoteModal, localDateStamp, missingSetupFolderHint, nestSetupFoldersUnderHome, RecordPickerModal, StringPickerModal, TextPromptModal, TopicEditorModal, VaultFilePickerModal, WorkspaceSetupModal, type WorkspaceSetupValue } from "../src/modals.ts";
import {
  canRelinkPortableRecord,
  calculateSearchViewportLayout,
  EntVaultCommandCenterView,
  matchingKnowledgeBaseRecords,
  MAX_RENDERED_SEARCH_RESULTS,
  tabDefinitions,
} from "../src/view.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import {
  ExportImportCenterModal,
  missingImportedFolderNoticeText,
  portabilityLibraryUnavailableText,
  preparePortableExport,
} from "../src/portability-modal.ts";
import {
  applyPortableExport,
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  parsePortableExport,
} from "../src/portability.ts";
import {
  BUILTIN_LIBRARY_DEFINITIONS,
  buildCurriculumTree,
  createDefaultStore,
  createPersonalBackup,
  DEFAULT_EXPORTS_FOLDER,
  emptyCurriculumTree,
  libraryTabId,
  migrateData,
  parseQuery,
  snapshotPersonal,
  type LayoutHeading,
  type LayoutSubheading,
  type LibraryDefinition,
  type PluginData,
  type VaultRecord,
} from "../src/model.ts";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { collectKnowledgeBaseSearchResults } from "../src/search.ts";
import { EntCommandCenterSettingsTab } from "../src/settings.ts";
import { LibraryEditorModal, ManageLibrariesModal } from "../src/library-modal.ts";
import { LibraryNoteProfileEditorModal, libraryCreationFolderChoices } from "../src/library-profile-modal.ts";
import { createOpenedBaseGuard, modalOwnerWindow, setGuardedTimer } from "../src/modals.ts";
import { asHtmlElement, createFakeDom, FakeElement, type FakeDocument } from "./support/fake-dom.ts";

function record(path: string, title: string, kind: VaultRecord["kind"] = "topic"): VaultRecord {
  return {
    path,
    title,
    kind,
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

/**
 * Drive the production collector the way the plugin's own
 * `searchKnowledgeBases` does, so these expectations cover the code that ships
 * rather than a view-side convenience wrapper.
 */
function crossBaseSearch(
  sources: Array<{ baseId: string; baseName: string; records: VaultRecord[] }>,
  query: string,
  limit = MAX_RENDERED_SEARCH_RESULTS,
): ReturnType<typeof collectKnowledgeBaseSearchResults<{ baseId: string; baseName: string }>> {
  return collectKnowledgeBaseSearchResults(
    sources.map(({ baseId, baseName, records }) => ({ source: { baseId, baseName }, records })),
    parseQuery(query),
    limit,
  );
}

const CUSTOM_LIBRARY_ID = "reference-sets";

function customLibrary(
  id = CUSTOM_LIBRARY_ID,
  name = "Reference Sets",
  singularName = "Reference",
  order = 0,
  archivedAt: number | null = null,
): LibraryDefinition {
  return { id, name, singularName, icon: "book-open", order, sourceKind: null, archivedAt };
}

function installLibrary(data: PluginData, library = customLibrary()): LibraryDefinition {
  data.portableIndex.libraries.push(library);
  data.portableIndex.libraryLayouts[library.id] = [];
  return library;
}

test("configured libraries produce ordered dynamic tabs, including empty libraries, while archived libraries stay hidden", () => {
  const settings = migrateData(null).settings;
  settings.workspaceMode = "generic";
  const coreTabs = ["curriculum", "inbox", "collections", "queues"];
  const active = customLibrary("references", "References", "Reference", 2);
  const first = customLibrary("courses", "Courses", "Course", 0);
  const archived = customLibrary("archive", "Archive", "Archive item", 1, Date.now());
  const records = [{ ...record("Reference/Guideline.md", "Guideline"), libraryId: active.id }];

  assert.deepEqual(tabDefinitions(settings, records).map((tab) => tab.id), coreTabs, "records never invent a missing library definition");
  assert.deepEqual(tabDefinitions(settings, records, [active, archived, first]).map((tab) => tab.id), [
    ...coreTabs,
    libraryTabId(first.id),
    libraryTabId(active.id),
  ]);
  assert.deepEqual(
    tabDefinitions(settings, [], [active]).map((tab) => tab.id),
    [...coreTabs, libraryTabId(active.id)],
    "an empty configured library stays reachable for heading edits",
  );
  const tab = tabDefinitions(settings, [], [active]).at(-1);
  assert.deepEqual(tab, { id: libraryTabId(active.id), label: "References", icon: "book-open" });
});

test("unknown stored Library icons use a registered display fallback without rewriting the stored value", () => {
  const settings = migrateData(null).settings;
  const imported = { ...customLibrary(), icon: "future-library-icon" };

  const tab = tabDefinitions(settings, [], [imported]).at(-1);

  assert.equal(tab?.icon, "library");
  assert.equal(imported.icon, "future-library-icon", "display fallback must not destroy a forward-compatible stored ID");
});

test("ENT workspaces keep every configured system library tab visible even when it is empty", () => {
  const settings = migrateData(null).settings;
  settings.workspaceMode = "ent-clinical";

  assert.deepEqual(tabDefinitions(settings, [], [...BUILTIN_LIBRARY_DEFINITIONS]).map((tab) => tab.id), [
    "curriculum",
    "inbox",
    "collections",
    "queues",
    libraryTabId("procedure"),
    libraryTabId("medication"),
    libraryTabId("syndrome"),
  ]);
});

test("a stale library editor cannot overwrite a changed, reordered, archived, or deleted library", async () => {
  Notice.messages.length = 0;
  const original = customLibrary();
  const scenarios: Array<{ name: string; mutate(current: LibraryDefinition | null): LibraryDefinition | null }> = [
    { name: "changed", mutate: (current) => current ? { ...current, name: "Newer name" } : null },
    { name: "reordered", mutate: (current) => current ? { ...current, order: current.order + 1 } : null },
    { name: "archived", mutate: (current) => current ? { ...current, archivedAt: Date.now() } : null },
    { name: "deleted", mutate: () => null },
  ];

  for (const scenario of scenarios) {
    let current: LibraryDefinition | null = { ...original };
    let updates = 0;
    const plugin = {
      app: {},
      getActiveKnowledgeBaseId: () => "base-a",
      getDataEpoch: () => 0,
      getLibrary: (id: string) => id === original.id ? current : null,
      async updateLibrary(): Promise<void> { updates += 1; },
    };
    const modal = new LibraryEditorModal(
      plugin as unknown as ConstructorParameters<typeof LibraryEditorModal>[0],
      { ...original },
    );
    const harness = modal as unknown as {
      render(): void;
      close(): void;
      submit(): Promise<void>;
    };
    harness.render = () => undefined;
    harness.close = () => undefined;
    current = scenario.mutate(current);

    await harness.submit();

    assert.equal(updates, 0, `${scenario.name} library must reject the stale editor`);
  }
  assert.equal(Notice.messages.filter((message) => /after the editor opened/i.test(message)).length, scenarios.length);
});

test("a same-base Sync replacement invalidates an open Library creation-profile editor", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  const library = installLibrary(data);
  let dataEpoch = 3;
  let saves = 0;
  const plugin = {
    app: {},
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => dataEpoch,
    getLibrary: (id: string) => id === library.id ? { ...library } : null,
    getLibraryNoteProfile: () => null,
    getEffectiveLibraryNoteProfile: () => ({
      folder: "Knowledge Base",
      mode: "empty" as const,
      templatePath: "",
      inherited: { folder: true, mode: true, templatePath: true },
    }),
    validateLibraryNoteProfile: () => null,
    async setLibraryNoteProfile(): Promise<void> { saves += 1; },
  };
  const modal = new LibraryNoteProfileEditorModal(
    plugin as unknown as ConstructorParameters<typeof LibraryNoteProfileEditorModal>[0],
    library,
  );
  const harness = modal as unknown as { submit(reset: boolean): Promise<void> };

  dataEpoch += 1;
  await harness.submit(false);
  await harness.submit(true);

  assert.equal(saves, 0);
  assert.equal(Notice.messages.filter((message) => /synced profile changed/i.test(message)).length, 1);
});

test("a Library creation-profile editor rejects same-object base-default and Library changes", async () => {
  Notice.messages.length = 0;
  const scenarios: Array<{
    label: string;
    mutate(data: PluginData, library: LibraryDefinition): void;
  }> = [
    {
      label: "base defaults",
      mutate: (data) => { data.settings.defaultNoteFolder = "Changed while open"; },
    },
    {
      label: "Library rename",
      mutate: (_data, library) => { library.name = "Renamed while open"; },
    },
  ];

  for (const scenario of scenarios) {
    const data = migrateData(null);
    const library = installLibrary(data);
    let saves = 0;
    const plugin = {
      app: {},
      data,
      getActiveKnowledgeBaseId: () => "base-a",
      getDataEpoch: () => 0,
      getLibrary: (id: string) => id === library.id ? library : null,
      getLibraryNoteProfile: () => null,
      getEffectiveLibraryNoteProfile: () => ({
        folder: data.settings.defaultNoteFolder,
        mode: data.settings.defaultNewNoteMode,
        templatePath: data.settings.defaultTemplatePath,
        inherited: { folder: true, mode: true, templatePath: true },
      }),
      validateLibraryNoteProfile: () => null,
      async setLibraryNoteProfile(): Promise<void> { saves += 1; },
    };
    const modal = new LibraryNoteProfileEditorModal(
      plugin as unknown as ConstructorParameters<typeof LibraryNoteProfileEditorModal>[0],
      library,
    );
    const harness = modal as unknown as { submit(reset: boolean): Promise<void> };

    scenario.mutate(data, library);
    await harness.submit(false);
    await harness.submit(true);

    assert.equal(saves, 0, scenario.label);
  }
  assert.equal(Notice.messages.filter((message) => /creation defaults.*changed/i.test(message)).length, 2);
});

test("Library profile folder Browse is visibly disabled until its override is enabled", () => {
  const data = migrateData(null);
  const library = installLibrary(data);
  const plugin = {
    app: {},
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getLibrary: () => library,
    getLibraryNoteProfile: () => null,
    getEffectiveLibraryNoteProfile: () => ({
      folder: "Knowledge Base",
      mode: "empty" as const,
      templatePath: "",
      inherited: { folder: true, mode: true, templatePath: true },
    }),
  };
  const modal = new LibraryNoteProfileEditorModal(
    plugin as unknown as ConstructorParameters<typeof LibraryNoteProfileEditorModal>[0],
    library,
  );
  const browseButton = { disabled: false };
  const harness = modal as unknown as {
    folderBrowseButton: typeof browseButton;
    folderOverride: boolean;
    syncControls(): void;
  };
  harness.folderBrowseButton = browseButton;
  harness.folderOverride = false;
  harness.syncControls();
  assert.equal(browseButton.disabled, true);

  harness.folderOverride = true;
  harness.syncControls();
  assert.equal(browseButton.disabled, false);
});

test("Library profile folder Browse omits immutable source-book destinations", () => {
  const root = new TFolder("");
  assert.deepEqual(libraryCreationFolderChoices([
    root,
    new TFolder("Research"),
    new TFolder("05 Sources/_books"),
    new TFolder("05 Sources/_books/Imported"),
    new TFolder("Templates"),
    new TFile("Research/Existing.md"),
  ]), ["Research", "Templates"]);
});

test("the note modal exposes one busy submission and refuses duplicate submit or Cancel", async () => {
  const release = (() => {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  })();
  let submitCalls = 0;
  let closeCalls = 0;
  let errorText = "";
  const controls = [{ disabled: false }, { disabled: true }];
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const modal = new KnowledgeNoteModal({} as never, {
    itemSingular: "note",
    templates: [],
    initial: { title: "One note", folder: "Notes", mode: "empty", templatePath: "", addToCollection: false },
    validate: () => null,
    onSubmit: async () => { submitCalls += 1; await release.promise; },
  });
  const harness = modal as unknown as {
    contentEl: { querySelectorAll(): typeof controls };
    modalEl: {
      removeAttribute(name: string): void;
      setAttribute(name: string, value: string): void;
      toggleClass(name: string, active: boolean): void;
    };
    errorEl: { setText(value: string): void };
    sessionOpen: boolean;
    submit(): Promise<void>;
  };
  harness.contentEl = { querySelectorAll: () => controls };
  harness.modalEl = {
    removeAttribute: (name) => { attributes.delete(name); },
    setAttribute: (name, value) => { attributes.set(name, value); },
    toggleClass: (name, active) => { if (active) classes.add(name); else classes.delete(name); },
  };
  harness.errorEl = { setText: (value) => { errorText = value; } };
  harness.sessionOpen = true;
  const closeDescriptor = Object.getOwnPropertyDescriptor(Modal.prototype, "close");
  Modal.prototype.close = function closeForTest(): void { closeCalls += 1; };
  try {
    const first = harness.submit();
    const duplicate = harness.submit();
    modal.close();
    assert.equal(submitCalls, 1);
    assert.equal(closeCalls, 0, "Cancel/Escape cannot hide an in-flight write");
    assert.equal(attributes.get("aria-busy"), "true");
    assert.equal(classes.has("is-submitting"), true);
    assert.deepEqual(controls.map((control) => control.disabled), [true, true]);
    await duplicate;
    release.resolve();
    await first;
  } finally {
    if (closeDescriptor) Object.defineProperty(Modal.prototype, "close", closeDescriptor);
    else Reflect.deleteProperty(Modal.prototype, "close");
  }
  assert.equal(closeCalls, 1, "the modal closes exactly once after the write settles");
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(classes.has("is-submitting"), false);
  assert.deepEqual(controls.map((control) => control.disabled), [false, true]);
  assert.equal(errorText, "");
});

test("editing only a Library name preserves an imported unknown icon ID", async () => {
  const original = { ...customLibrary(), icon: "future-library-icon" };
  let submittedIcon = "";
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getLibrary: (id: string) => id === original.id ? { ...original } : null,
    async updateLibrary(_id: string, input: { icon: string }): Promise<void> { submittedIcon = input.icon; },
  };
  const modal = new LibraryEditorModal(
    plugin as unknown as ConstructorParameters<typeof LibraryEditorModal>[0],
    original,
  );
  const harness = modal as unknown as {
    name: string;
    render(): void;
    close(): void;
    submit(): Promise<void>;
  };
  harness.name = "Renamed references";
  harness.render = () => undefined;
  harness.close = () => undefined;

  await harness.submit();

  assert.equal(submittedIcon, "future-library-icon");
});

test("library icon selection updates pressed state in place and retains keyboard focus", () => {
  const dom = createFakeDom();
  const original = customLibrary();
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
  };
  const modal = new LibraryEditorModal(
    plugin as unknown as ConstructorParameters<typeof LibraryEditorModal>[0],
    original,
  );
  const first = dom.document.body.createEl("button", {
    cls: "ent-cc-library-icon-choice is-selected",
    attr: { "aria-pressed": "true" },
  }) as unknown as HTMLButtonElement;
  const second = dom.document.body.createEl("button", {
    cls: "ent-cc-library-icon-choice",
    attr: { "aria-pressed": "false" },
  }) as unknown as HTMLButtonElement;
  let renders = 0;
  const harness = modal as unknown as {
    icon: string;
    iconButtonEls: Map<string, HTMLButtonElement>;
    render(): void;
    selectIcon(icon: string, button: HTMLButtonElement): void;
  };
  harness.icon = "book-open";
  harness.iconButtonEls = new Map([["book-open", first], ["microscope", second]]);
  harness.render = () => { renders += 1; };

  harness.selectIcon("microscope", second);

  assert.equal(first.classList.contains("is-selected"), false);
  assert.equal(first.getAttribute("aria-pressed"), "false");
  assert.equal(second.classList.contains("is-selected"), true);
  assert.equal(second.getAttribute("aria-pressed"), "true");
  assert.equal(dom.document.activeElement, second);
  assert.equal(renders, 0, "choosing an icon must not rebuild the modal DOM");
});

test("Library manager renders an imported unknown icon safely and exposes stable action focus keys", () => {
  const dom = createFakeDom();
  const imported = { ...customLibrary(), icon: "future-library-icon" };
  const manager = Object.create(ManageLibrariesModal.prototype) as {
    plugin: { librarySubjectCount(libraryId: string): number };
    busy: boolean;
    renderLibrary(
      parent: HTMLElement,
      library: LibraryDefinition,
      archived: boolean,
      activeIndex: number,
      activeLibraries: LibraryDefinition[],
      allLibraries: LibraryDefinition[],
    ): void;
  };
  manager.plugin = { librarySubjectCount: () => 0 };
  manager.busy = false;

  manager.renderLibrary(
    dom.document.body as unknown as HTMLElement,
    imported,
    false,
    0,
    [imported],
    [imported],
  );

  const icon = dom.document.body.querySelector(".ent-cc-library-manager-icon");
  assert.equal(icon?.getAttribute("data-icon"), "library");
  assert.equal(imported.icon, "future-library-icon");
  assert.deepEqual(
    dom.document.body.querySelectorAll("[data-library-focus]").map((element) => element.getAttribute("data-library-focus")),
    [
      `library-${imported.id}-move-up`,
      `library-${imported.id}-move-down`,
      `library-${imported.id}-edit`,
      `library-${imported.id}-archive`,
    ],
  );
});

test("Manage Libraries retains logical focus through busy rebuilds and changed archive state", () => {
  const dom = createFakeDom();
  const manager = Object.create(ManageLibrariesModal.prototype) as {
    contentEl: HTMLElement;
    busy: boolean;
    pendingFocusKey: string | null;
    pendingFallbackFocusKey: string | null;
    renderGeneration: number;
    capturePendingFocus(focusKey?: string, fallbackFocusKey?: string): void;
    restorePendingFocus(): void;
  };
  manager.contentEl = dom.document.body as unknown as HTMLElement;
  manager.busy = false;
  manager.pendingFocusKey = null;
  manager.pendingFallbackFocusKey = null;
  manager.renderGeneration = 1;

  const archive = dom.document.body.createEl("button", {
    attr: {
      "data-library-focus": "library-reference-sets-archive",
      "data-library-focus-fallback": "library-reference-sets-restore",
    },
  });
  archive.focus();
  manager.capturePendingFocus();
  dom.document.body.empty();

  const restore = dom.document.body.createEl("button", {
    attr: {
      "data-library-focus": "library-reference-sets-restore",
      "data-library-focus-fallback": "library-reference-sets-edit",
    },
  });
  restore.disabled = true;
  manager.busy = true;
  manager.restorePendingFocus();

  assert.equal(dom.document.activeElement, dom.document.body, "busy rebuild keeps focus inside the modal");
  assert.equal(manager.pendingFocusKey, "library-reference-sets-archive", "logical target survives the busy render");

  restore.disabled = false;
  manager.busy = false;
  manager.restorePendingFocus();

  assert.equal(dom.document.activeElement, restore, "archive falls forward to the matching Restore action");
  assert.equal(manager.pendingFocusKey, null);
  assert.equal(manager.pendingFallbackFocusKey, null);
});

test("the Add menu defaults to the active custom library and exposes the library picker elsewhere", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: {
      data: typeof data;
      getActiveKnowledgeBaseId(): string;
      getDataEpoch(): number;
      isClinicalMode(): boolean;
      getLibraries(): LibraryDefinition[];
      getLibrary(id: string): LibraryDefinition | null;
    };
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openAddActions(): void;
  };
  view.app = {};
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    getLibraries: () => [library],
    getLibrary: (id) => id === library.id ? library : null,
  };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  let titles: string[] = [];
  AddActionModal.prototype.open = function openForTest(): void {
    titles = (this as unknown as { actions: Array<{ title: string }> }).actions.map((action) => action.title);
  };
  try {
    view.openAddActions();
  } finally {
    delete (AddActionModal.prototype as { open?: () => void }).open;
  }

  assert.deepEqual(titles.slice(0, 3), [
    "Create Reference",
    "Add existing note to Reference Sets",
    "Add current note to Reference Sets",
  ]);

  data.activeTab = "curriculum";
  AddActionModal.prototype.open = function openForTest(): void {
    titles = (this as unknown as { actions: Array<{ title: string }> }).actions.map((action) => action.title);
  };
  try {
    view.openAddActions();
  } finally {
    delete (AddActionModal.prototype as { open?: () => void }).open;
  }
  assert.equal(titles.includes("Add to library…"), true);
  assert.equal(titles.includes("New library…"), true);
});

test("the active-library Add menu dispatches both existing-note and current-note classification", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  const existing = new TFile("Reference/Existing reference.md");
  const current = new TFile("Reference/Current reference.md");
  const assignments: Array<{ path: string; libraryId: string }> = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    getLibraries: () => [library],
    getLibrary: (id: string) => id === library.id ? library : null,
    getVaultNoteFiles: () => [existing, current],
    async assignRecordToLibrary(path: string, libraryId: string): Promise<void> {
      assignments.push({ path, libraryId });
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: { workspace: { getActiveFile(): TFile } };
    plugin: typeof plugin;
    records: VaultRecord[];
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openAddActions(): void;
  };
  view.app = { workspace: { getActiveFile: () => current } };
  view.plugin = plugin;
  view.records = [];
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  let requestedAction = "existing-active-library";
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const pickerOpen = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  AddActionModal.prototype.open = function chooseRequestedAction(): void {
    const modal = this as unknown as {
      getItems(): Array<{ id: string }>;
      onChooseItem(item: { id: string }): void;
    };
    const action = modal.getItems().find((item) => item.id === requestedAction);
    assert.ok(action, `missing Add action ${requestedAction}`);
    modal.onChooseItem(action);
  };
  VaultFilePickerModal.prototype.open = function chooseExistingFile(): void {
    const modal = this as unknown as {
      getItems(): TFile[];
      onChooseItem(file: TFile): void;
    };
    assert.equal(modal.getItems().includes(existing), true);
    modal.onChooseItem(existing);
  };
  try {
    view.openAddActions();
    await Promise.resolve();
    await Promise.resolve();

    requestedAction = "current-active-library";
    view.openAddActions();
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (pickerOpen) Object.defineProperty(VaultFilePickerModal.prototype, "open", pickerOpen);
    else Reflect.deleteProperty(VaultFilePickerModal.prototype, "open");
  }

  assert.deepEqual(assignments, [
    { path: existing.path, libraryId: library.id },
    { path: current.path, libraryId: library.id },
  ]);
});

test("Add existing routes a folder-only or Library note through the Index placement transition", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const folderOnly = new TFile("Linked/Folder only.md");
  const libraryNote = new TFile("Reference/Library note.md");
  const candidates = [folderOnly, libraryNote];
  const assignments: Array<{ path: string; kind: string; group: string }> = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    getIndexCandidateFiles: () => candidates,
    suggestedIndexGroup: () => "Research",
    getIndexGroups: () => ["Research"],
    async assignRecordToCatalog(path: string, kind: string, options: { headingTitle: string }): Promise<void> {
      assignments.push({ path, kind, group: options.headingTitle });
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startAddExistingToIndex(): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  let submitted: Promise<void> = Promise.resolve();
  const pickerOpen = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  const groupOpen = Object.getOwnPropertyDescriptor(IndexGroupModal.prototype, "open");
  VaultFilePickerModal.prototype.open = function chooseLibraryNote(): void {
    const modal = this as unknown as { getItems(): TFile[]; onChooseItem(file: TFile): void };
    assert.deepEqual(modal.getItems(), candidates, "folder-derived and Library-classified notes remain eligible");
    modal.onChooseItem(libraryNote);
  };
  IndexGroupModal.prototype.open = function submitPlacement(): void {
    const options = (this as unknown as {
      options: { onSubmit(group: string): void | Promise<void> };
    }).options;
    submitted = Promise.resolve(options.onSubmit("Research"));
  };
  try {
    view.startAddExistingToIndex();
    await submitted;
  } finally {
    if (pickerOpen) Object.defineProperty(VaultFilePickerModal.prototype, "open", pickerOpen);
    else Reflect.deleteProperty(VaultFilePickerModal.prototype, "open");
    if (groupOpen) Object.defineProperty(IndexGroupModal.prototype, "open", groupOpen);
    else Reflect.deleteProperty(IndexGroupModal.prototype, "open");
  }

  assert.deepEqual(assignments, [{ path: libraryNote.path, kind: "topic", group: "Research" }]);
});

test("record and vault-file pickers use the command center's normalized multilingual search", () => {
  const records = [
    record("Knowledge Base/Ménière’s disease.md", "Ménière’s disease"),
    record("Knowledge Base/مدرسة الصوت.md", "مدرسة الصوت"),
  ];
  const recordPicker = Object.create(RecordPickerModal.prototype) as RecordPickerModal & { records: VaultRecord[] };
  recordPicker.records = records;
  assert.equal(recordPicker.getSuggestions("").length, records.length, "opening a picker still lists every item");
  assert.deepEqual(recordPicker.getSuggestions("menieres").map((match) => match.item.title), ["Ménière’s disease"]);
  assert.deepEqual(recordPicker.getSuggestions("مدرسه").map((match) => match.item.title), ["مدرسة الصوت"]);

  const files = [new TFile("Reference/ٱلحنجرة.md")];
  const filePicker = Object.create(VaultFilePickerModal.prototype) as VaultFilePickerModal & { files: TFile[] };
  filePicker.files = files;
  assert.deepEqual(filePicker.getSuggestions("الحنجرة").map((match) => match.item.path), [files[0]?.path]);
});

test("a built-in clinical tab still exposes custom libraries through Add", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const builtIn = { ...BUILTIN_LIBRARY_DEFINITIONS[1] };
  assert.ok(builtIn);
  const custom = customLibrary();
  data.portableIndex.libraries = [builtIn, custom];
  data.activeTab = libraryTabId(builtIn.id);
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: {
      data: typeof data;
      getActiveKnowledgeBaseId(): string;
      getDataEpoch(): number;
      isClinicalMode(): boolean;
      getLibraries(): LibraryDefinition[];
      getLibrary(id: string): LibraryDefinition | null;
    };
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openAddActions(): void;
  };
  view.app = {};
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => true,
    getLibraries: () => [builtIn, custom],
    getLibrary: (id) => [builtIn, custom].find((library) => library.id === id) ?? null,
  };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  let titles: string[] = [];
  const open = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  AddActionModal.prototype.open = function captureActions(): void {
    titles = (this as unknown as { actions: Array<{ title: string }> }).actions.map((action) => action.title);
  };
  try {
    view.openAddActions();
  } finally {
    if (open) Object.defineProperty(AddActionModal.prototype, "open", open);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
  }

  assert.equal(titles.includes("Add to library…"), true);
  assert.equal(titles.includes(`Create ${builtIn.singularName}`), false, "native clinical libraries remain source-driven");
});

test("move to another section lists every active dynamic library and dispatches by stable ID", async () => {
  const data = migrateData(null);
  const source = installLibrary(data, customLibrary("source-library", "Sources", "Source", 0));
  const destination = installLibrary(data, customLibrary("courses", "Courses", "Course", 1));
  data.activeTab = libraryTabId(source.id);
  const assignments: Array<{ path: string; libraryId: string }> = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    getRecordIndexDestinationError: () => null,
    getLibraries: () => [source, destination],
    async assignRecordToLibrary(path: string, libraryId: string): Promise<void> {
      assignments.push({ path, libraryId });
    },
    async assignRecordToCatalog(): Promise<void> {
      throw new Error("the library destination should not route through a semantic kind");
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openCatalogMoveActions(record: VaultRecord): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  const item = { ...record("Reference/Guideline.md", "Guideline"), libraryId: source.id };

  let titles: string[] = [];
  const open = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  AddActionModal.prototype.open = function chooseDestination(): void {
    const modal = this as unknown as {
      actions: Array<{ id: string; title: string }>;
      onChooseItem(action: { id: string; title: string }): void;
    };
    titles = modal.actions.map((action) => action.title);
    const action = modal.actions.find((candidate) => candidate.id === libraryTabId(destination.id));
    assert.ok(action);
    modal.onChooseItem(action);
  };
  try {
    view.openCatalogMoveActions(item);
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    if (open) Object.defineProperty(AddActionModal.prototype, "open", open);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
  }

  assert.deepEqual(titles, [`Move to ${data.settings.indexLabel}`, "Move to Courses"]);
  assert.deepEqual(assignments, [{ path: item.path, libraryId: destination.id }]);
});

test("ENT move choices omit the Index for protected records but retain it for native topics", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.indexLabel = "Curriculum";
  const source = installLibrary(data, customLibrary("exam-review", "Exam review", "Review topic", 3));
  const medication = { ...BUILTIN_LIBRARY_DEFINITIONS.find((library) => library.id === "medication"), archivedAt: null } as LibraryDefinition;
  data.portableIndex.libraries.push(medication);
  data.portableIndex.libraryLayouts.medication = [];
  data.activeTab = libraryTabId(source.id);
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => true,
    getRecordIndexDestinationError: (path: string) => path.includes("Allergodil") ? "protected medication" : null,
    getLibraries: () => [source, medication],
    async assignRecordToLibrary(): Promise<void> {},
    async assignRecordToCatalog(): Promise<void> {},
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openCatalogMoveActions(item: VaultRecord): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  const opened: string[][] = [];
  const open = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  AddActionModal.prototype.open = function captureDestinations(): void {
    opened.push((this as unknown as { actions: Array<{ title: string }> }).actions.map((action) => action.title));
  };
  try {
    view.openCatalogMoveActions({
      ...record("06 Clinical Tools/Medications/Drug - Allergodil.md", "Allergodil", "medication"),
      role: "library",
      libraryId: source.id,
    });
    view.openCatalogMoveActions({
      ...record("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md", "Airway"),
      role: "canonical",
      libraryId: source.id,
    });
  } finally {
    if (open) Object.defineProperty(AddActionModal.prototype, "open", open);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
  }

  assert.deepEqual(opened[0], ["Move to Medications"]);
  assert.deepEqual(opened[1], ["Move to Curriculum"]);
});

test("removing a native ENT record from a custom Library explains its built-in fallback", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.indexLabel = "Curriculum";
  const custom = installLibrary(data, customLibrary("exam-review", "Exam review", "Review topic", 3));
  const medication = { ...BUILTIN_LIBRARY_DEFINITIONS.find((library) => library.id === "medication"), archivedAt: null } as LibraryDefinition;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getLibrary: (id: string) => id === custom.id ? custom : id === medication.id ? medication : null,
    getRecordUnassignedLibraryFallback: () => medication,
    getRecordIndexDestinationError: () => "protected medication",
    async removeRecordFromLibrary(): Promise<void> {},
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    confirmRemoveFromCatalog(item: VaultRecord, libraryId: string): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  let message = "";
  const open = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureCopy(): void {
    message = (this as unknown as { message: string }).message;
  };
  try {
    view.confirmRemoveFromCatalog({
      ...record("06 Clinical Tools/Medications/Drug - Allergodil.md", "Allergodil", "medication"),
      role: "library",
      libraryId: custom.id,
    }, custom.id);
  } finally {
    if (open) Object.defineProperty(ConfirmModal.prototype, "open", open);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }

  assert.match(message, /return to the protected built-in Medications library/i);
  assert.match(message, /compatible custom library/i);
  assert.doesNotMatch(message, /return it to Curriculum/i);
  assert.doesNotMatch(message, /become unclassified/i);
});

test("Index Manager group restore routes through the guarded atomic restore API", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.allowClinicalVisualGroupMoves = true;
  const path = "06 Clinical Tools/Medications/Drug - Allergodil.md";
  const restored: Array<{ paths: string[]; label: string; group: string }> = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    canVisuallyMoveAcrossGroups: () => true,
    getRecord: (candidate: string) => candidate === path ? record(path, "Allergodil", "medication") : null,
    getIndexGroups: () => ["Rhinology"],
    async restoreRecordsToIndex(paths: string[], label: string, group: string): Promise<void> {
      restored.push({ paths, label, group });
    },
    async mutate(): Promise<void> {
      throw new Error("restore must not bypass the guarded plugin API");
    },
  };
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: object;
    plugin: typeof plugin;
    selected: Set<string>;
    tab: "indexed" | "available" | "hidden" | "groups" | "diagnostics";
    openedBaseId: string;
    openedDataEpoch: number;
    staleBaseNoticeShown: boolean;
    managerOpen: boolean;
    render(): void;
    chooseGroupForSelection(mode: "add" | "restore" | "move"): void;
  };
  manager.app = {};
  manager.plugin = plugin;
  manager.selected = new Set([path]);
  manager.tab = "hidden";
  manager.openedBaseId = "base-a";
  manager.openedDataEpoch = 0;
  manager.staleBaseNoticeShown = false;
  manager.managerOpen = true;
  manager.render = () => {};

  let submitted: Promise<void> = Promise.resolve();
  const open = Object.getOwnPropertyDescriptor(IndexGroupModal.prototype, "open");
  IndexGroupModal.prototype.open = function submitGroup(): void {
    const options = (this as unknown as { options: { onSubmit(group: string): void | Promise<void> } }).options;
    submitted = Promise.resolve(options.onSubmit("Rhinology"));
  };
  try {
    manager.chooseGroupForSelection("restore");
    await submitted;
  } finally {
    if (open) Object.defineProperty(IndexGroupModal.prototype, "open", open);
    else Reflect.deleteProperty(IndexGroupModal.prototype, "open");
  }

  assert.deepEqual(restored, [{
    paths: [path],
    label: "Restore 1 index note",
    group: "Rhinology",
  }]);
});

test("a case-variant typed group move keeps the merged domain's root order and expands its stored label", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const first = { ...record("KB/Sinusitis.md", "Sinusitis"), domain: "Rhinology", folderOrder: "Rhinology" };
  const second = { ...record("KB/Polyps.md", "Polyps"), domain: "Rhinology", folderOrder: "Rhinology" };
  const moved = { ...record("KB/Airway.md", "Airway"), domain: "Laryngology", folderOrder: "Laryngology" };
  const records = [first, second, moved];
  data.curriculumVisual.orderByContainer["root:rhinology"] = [second.path, first.path];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    canVisuallyMoveAcrossGroups: () => true,
    getIndexGroups: () => ["Rhinology"],
    saveViewState: async (): Promise<void> => undefined,
    mutate: async (_label: string, action: () => void): Promise<void> => { action(); },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    curriculum: ReturnType<typeof buildCurriculumTree>;
    collapsedCurriculumDomains: Set<string>;
    collapsedCurriculumNodes: Set<string>;
    collapsedQueues: Set<string>;
    openIndexGroupPicker(record: VaultRecord): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.records = records;
  view.recordByPath = new Map(records.map((item) => [item.path, item]));
  view.curriculum = buildCurriculumTree(records, data.curriculumVisual, false);
  view.collapsedCurriculumDomains = new Set(["Rhinology"]);
  view.collapsedCurriculumNodes = new Set();
  view.collapsedQueues = new Set();

  let submitted: Promise<void> = Promise.resolve();
  const open = Object.getOwnPropertyDescriptor(IndexGroupModal.prototype, "open");
  IndexGroupModal.prototype.open = function submitGroup(): void {
    const options = (this as unknown as { options: { onSubmit(group: string): void | Promise<void> } }).options;
    submitted = Promise.resolve(options.onSubmit("rhinology"));
  };
  try {
    view.openIndexGroupPicker(moved);
    await submitted;
  } finally {
    if (open) Object.defineProperty(IndexGroupModal.prototype, "open", open);
    else Reflect.deleteProperty(IndexGroupModal.prototype, "open");
  }

  assert.deepEqual(
    data.curriculumVisual.orderByContainer["root:rhinology"],
    [second.path, first.path, moved.path],
    "the destination group's saved order must survive a case-variant typed name",
  );
  assert.equal(view.collapsedCurriculumDomains.has("Rhinology"), false, "the stored collapse label expands even when the typed case differs");
});

test("make top-level resolves a case-variant record domain against the merged curriculum group", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const first = { ...record("KB/Sinusitis.md", "Sinusitis"), domain: "Rhinology", folderOrder: "Rhinology" };
  const variant = { ...record("KB/Rhinoplasty.md", "Rhinoplasty"), domain: "RHINOLOGY", folderOrder: "Rhinology" };
  const records = [first, variant];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    canVisuallyMoveAcrossGroups: () => false,
    mutate: async (_label: string, action: () => void): Promise<void> => { action(); },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: typeof plugin;
    recordByPath: Map<string, VaultRecord>;
    curriculum: ReturnType<typeof buildCurriculumTree>;
    makeCurriculumTopLevel(record: VaultRecord): void;
  };
  view.plugin = plugin;
  view.recordByPath = new Map(records.map((item) => [item.path, item]));
  view.curriculum = buildCurriculumTree(records, data.curriculumVisual, false);
  const mergedRoots = view.curriculum.domains.find((domain) => domain.domain === "Rhinology")?.roots.map((node) => node.record.path) ?? [];
  assert.ok(mergedRoots.includes(variant.path), "case-variant spellings merge into one visual group");

  view.makeCurriculumTopLevel(variant);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(
    data.curriculumVisual.orderByContainer["root:rhinology"],
    [...mergedRoots.filter((path) => path !== variant.path), variant.path],
    "the merged group's real roots must survive a case-variant record domain",
  );
});

test("placement conflict detection normalizes stored parent curriculum ID case", () => {
  const parent = { ...record("KB/Parent.md", "Head And Neck Overview"), role: "canonical" as const, curriculumId: "ent-hn-01", domain: "Head & Neck" };
  const child = { ...record("KB/Child.md", "Neck Mass"), role: "canonical" as const, curriculumId: "ENT-HN-01.1", domain: "Head & Neck", parentTopic: "[[Head And Neck Overview]]" };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: {
      isClinicalMode(): boolean;
      resolveLink(link: string, fromPath: string, byPath: Map<string, VaultRecord>): VaultRecord | null;
    };
    recordByPath: Map<string, VaultRecord>;
    hasPlacementConflict(record: VaultRecord): boolean;
  };
  view.recordByPath = new Map([[parent.path, parent], [child.path, child]]);

  view.plugin = { isClinicalMode: () => true, resolveLink: () => parent };
  assert.equal(view.hasPlacementConflict(child), false, "a lowercase stored parent ID is the same curriculum ID");

  view.plugin = { isClinicalMode: () => true, resolveLink: () => ({ ...parent, curriculumId: "ENT-HN-02" }) };
  assert.equal(view.hasPlacementConflict(child), true, "a genuinely wrong parent still conflicts");
});

test("backup filenames stamp the local calendar day", () => {
  assert.equal(localDateStamp(new Date(2026, 0, 5, 12, 0)), "2026-01-05");
  // Either edge would cross into a different UTC day in some timezone; the
  // stamp must always follow the local clock.
  assert.equal(localDateStamp(new Date(2026, 5, 15, 0, 10)), "2026-06-15");
  assert.equal(localDateStamp(new Date(2026, 5, 15, 23, 50)), "2026-06-15");
});

test("link controls are limited to notes explicitly completed from portable placeholders", () => {
  assert.equal(canRelinkPortableRecord({ portableId: "local-medication" }), false);
  assert.equal(canRelinkPortableRecord({ portableId: "native-clinical", portableRelinkable: false }), false);
  assert.equal(canRelinkPortableRecord({ portableId: "imported", portableRelinkable: true }), true);
  assert.equal(canRelinkPortableRecord({ portableId: "imported", portableRelinkable: true, isPlaceholder: true }), false);
});

test("creating a note from a custom library carries its exact target into the combined creator", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.itemSingular = "note";
  const library = installLibrary(data);
  data.settings.libraryNoteProfiles[library.id] = {
    folder: "Reference notes",
    mode: "template",
    templatePath: "Templates/Reference.md",
  };
  data.portableIndex.libraryLayouts[library.id] = [{
    id: "heading-evidence",
    title: "Evidence",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "sub-guidelines", title: "Guidelines", collapsed: false, subjects: [] }],
  }];
  data.activeTab = libraryTabId(library.id);
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: {
      data: typeof data;
      getActiveKnowledgeBaseId(): string;
      getDataEpoch(): number;
      isClinicalMode(): boolean;
      isDataReadOnly(): boolean;
      getTemplateFiles(): [];
      getLibrary(id: string): LibraryDefinition | null;
      getEffectiveLibraryNoteProfile(id: string): {
        folder: string;
        mode: "template";
        templatePath: string;
        inherited: { folder: false; mode: false; templatePath: false };
      };
      getPortableSubject(): null;
      validateGenericNote(value: {
        title: string;
        folder: string;
        mode: "empty" | "template";
        templatePath: string;
        addToCollection: boolean;
      }): string | null;
      createKnowledgeNoteInLibrary(
        value: unknown,
        libraryId: string,
        target: { headingId?: string; subheadingId?: string },
        policy: { openedData: typeof data; openedBaseId: string; openedDataEpoch: number; openedExternalChangeGeneration: number },
      ): Promise<TFile>;
      openFile(): Promise<void>;
    };
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startCreateLibraryNote(libraryId: string, target?: { headingId: string; subheadingId: string }): void;
  };
  view.app = {};
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    getTemplateFiles: () => [],
    getLibrary: (id) => id === library.id ? library : null,
    getEffectiveLibraryNoteProfile: () => ({
      folder: "Reference notes",
      mode: "template",
      templatePath: "Templates/Reference.md",
      inherited: { folder: false, mode: false, templatePath: false },
    }),
    getPortableSubject: () => null,
    validateGenericNote: () => null,
    async createKnowledgeNoteInLibrary(_value, libraryId, target, policy): Promise<TFile> {
      creation = { libraryId, target, policy };
      return new TFile("Reference notes/Airway guideline.md");
    },
    async openFile(): Promise<void> { /* not under test */ },
  };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  let options: {
    createLabel?: string;
    contextNotice?: string;
    initial?: { folder: string; mode: string; templatePath: string };
    tokenContext?: { library?: string; type?: string; category?: string };
    onSubmit?: (value: {
      title: string;
      folder: string;
      mode: "empty" | "template";
      templatePath: string;
      addToCollection: boolean;
    }) => Promise<void>;
    validate?: (value: {
      title: string;
      folder: string;
      mode: "empty" | "template";
      templatePath: string;
      addToCollection: boolean;
    }) => string | null;
  } | null = null;
  let creation: {
    libraryId: string;
    target: { headingId?: string; subheadingId?: string };
    policy: { openedData: typeof data; openedBaseId: string; openedDataEpoch: number; openedExternalChangeGeneration: number };
  } | null = null;
  let untargetedContextNotice = "";
  KnowledgeNoteModal.prototype.open = function openForTest(): void {
    options = (this as unknown as { options: typeof options }).options;
  };
  try {
    view.startCreateLibraryNote(library.id, { headingId: "heading-evidence", subheadingId: "sub-guidelines" });
    const targetedOptions = options;
    view.startCreateLibraryNote(library.id);
    untargetedContextNotice = options?.contextNotice ?? "";
    options = targetedOptions;
  } finally {
    delete (KnowledgeNoteModal.prototype as { open?: () => void }).open;
  }

  assert.equal(options?.createLabel, "Reference");
  assert.match(options?.contextNotice ?? "", /Reference Sets \/ Evidence \/ Guidelines/);
  assert.match(options?.contextNotice ?? "", /destination is fixed/i);
  assert.match(untargetedContextNotice, /classified in Reference Sets after creation/i);
  assert.doesNotMatch(untargetedContextNotice, /Evidence/, "an untargeted create must not claim the first heading");
  assert.deepEqual(options?.initial, {
    title: "",
    folder: "Reference notes",
    mode: "template",
    templatePath: "Templates/Reference.md",
    addToCollection: false,
  });
  assert.equal(options?.tokenContext, undefined, "fixed Library YAML labels are resolved live by the combined creator");

  const validValue = {
    title: "Airway guideline",
    folder: "Reference notes",
    mode: "template" as const,
    templatePath: "Templates/Reference.md",
    addToCollection: false,
  };
  assert.equal(options?.validate?.(validValue), null);
  await options?.onSubmit?.(validValue);
  assert.equal(creation?.libraryId, library.id);
  assert.deepEqual(creation?.target, { headingId: "heading-evidence", subheadingId: "sub-guidelines" });
  assert.equal(creation?.policy.openedData, data);
  assert.equal(creation?.policy.openedBaseId, "base-a");
  data.portableIndex.libraryLayouts[library.id]?.[0]?.subheadings.splice(0);
  assert.match(options?.validate?.(validValue) ?? "", /subheading is no longer available/i);
  library.archivedAt = Date.now();
  assert.match(options?.validate?.(validValue) ?? "", /library is no longer available/i);
});

test("library hierarchy menus create notes directly under the exact heading or nested subheading", () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  const deep: LayoutSubheading = {
    id: "guidelines-deep",
    title: "Guidelines",
    collapsed: false,
    subjects: [],
  };
  const middle: LayoutSubheading = {
    id: "evidence-middle",
    title: "Evidence",
    collapsed: false,
    subjects: [],
    subheadings: [deep],
  };
  const heading: LayoutHeading = {
    id: "resources-heading",
    title: "Resources",
    collapsed: false,
    subjects: [],
    subheadings: [middle],
  };
  data.portableIndex.libraryLayouts[library.id] = [heading];
  let readOnly = false;
  let clinicalMode = false;
  let libraryAvailable = true;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => clinicalMode,
    isDataReadOnly: () => readOnly,
    getLibrary: (id: string) => libraryAvailable && id === library.id ? library : null,
  };
  type Placement = { headingId?: string; subheadingId?: string };
  const creates: Array<{ libraryId: string; target: Placement }> = [];
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startCreateLibraryNote(libraryId: string, target: Placement): void;
    showLibraryHeadingMenu(event: MouseEvent, libraryId: string, targetHeading: LayoutHeading): void;
    showLibrarySubheadingMenu(
      event: MouseEvent,
      libraryId: string,
      targetHeading: LayoutHeading,
      targetSubheading: LayoutSubheading,
    ): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.startCreateLibraryNote = (libraryId, target) => creates.push({ libraryId, target });

  interface CapturedMenuItem {
    title: string;
    disabled: boolean;
    click?: () => void;
  }
  const itemsByMenu = new WeakMap<object, CapturedMenuItem[]>();
  const shownMenus: CapturedMenuItem[][] = [];
  const descriptors = new Map(["addItem", "addSeparator", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const entries = itemsByMenu.get(this) ?? [];
      itemsByMenu.set(this, entries);
      const captured: CapturedMenuItem = { title: "", disabled: false };
      const item = {
        setTitle(title: string) { captured.title = title; return item; },
        setIcon() { return item; },
        setDisabled(disabled: boolean) { captured.disabled = disabled; return item; },
        onClick(callback: () => void) { captured.click = callback; return item; },
      };
      configure(item);
      entries.push(captured);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "addSeparator", {
    configurable: true,
    value(this: object): object { return this; },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(this: object): void { shownMenus.push(itemsByMenu.get(this) ?? []); },
  });

  const createItem = (items: CapturedMenuItem[]): CapturedMenuItem => {
    const item = items.find((candidate) => candidate.title === "Create note here…");
    assert.ok(item, "expected a direct create-note action");
    return item;
  };

  try {
    view.showLibraryHeadingMenu({} as MouseEvent, library.id, heading);
    const headingCreate = createItem(shownMenus.at(-1) ?? []);
    assert.equal(headingCreate.disabled, false);
    headingCreate.click?.();
    assert.deepEqual(creates.at(-1), { libraryId: library.id, target: { headingId: heading.id } });

    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, deep);
    const subheadingCreate = createItem(shownMenus.at(-1) ?? []);
    assert.equal(subheadingCreate.disabled, false);
    subheadingCreate.click?.();
    assert.deepEqual(creates.at(-1), {
      libraryId: library.id,
      target: { headingId: heading.id, subheadingId: deep.id },
    });

    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, deep);
    const staleCreate = createItem(shownMenus.at(-1) ?? []);
    middle.subheadings?.splice(0);
    staleCreate.click?.();
    assert.equal(creates.length, 2, "a removed target never opens the create form");
    assert.equal(Notice.messages.some((message) => /subheading is no longer available/i.test(message)), true);
    middle.subheadings = [deep];

    view.showLibraryHeadingMenu({} as MouseEvent, library.id, heading);
    const archivedCreate = createItem(shownMenus.at(-1) ?? []);
    library.archivedAt = Date.now();
    archivedCreate.click?.();
    assert.equal(creates.length, 2, "an archived Library never opens the create form");
    assert.equal(Notice.messages.some((message) => /library is no longer available/i.test(message)), true);
    library.archivedAt = null;

    view.showLibraryHeadingMenu({} as MouseEvent, library.id, heading);
    const deletedCreate = createItem(shownMenus.at(-1) ?? []);
    const unavailableNotices = Notice.messages.filter((message) => /library is no longer available/i.test(message)).length;
    libraryAvailable = false;
    delete data.portableIndex.libraryLayouts[library.id];
    deletedCreate.click?.();
    assert.equal(creates.length, 2, "a deleted Library never opens the create form");
    assert.equal(
      Notice.messages.filter((message) => /library is no longer available/i.test(message)).length,
      unavailableNotices + 1,
      "deletion after the menu opens is explained instead of failing silently",
    );
    libraryAvailable = true;
    data.portableIndex.libraryLayouts[library.id] = [heading];

    readOnly = true;
    view.showLibraryHeadingMenu({} as MouseEvent, library.id, heading);
    assert.equal(createItem(shownMenus.at(-1) ?? []).disabled, true);

    readOnly = false;
    clinicalMode = true;
    Object.assign(library, { sourceKind: "procedure" as const });
    view.showLibraryHeadingMenu({} as MouseEvent, library.id, heading);
    assert.equal(
      shownMenus.at(-1)?.some((candidate) => candidate.title === "Create note here…"),
      false,
      "protected clinical libraries keep their native creation workflow",
    );
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
      else Reflect.deleteProperty(Menu.prototype, name);
    }
  }
});

test("an ENT custom-Library placeholder uses its profile while protected built-in placeholders keep clinical actions", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const custom = installLibrary(data);
  data.portableIndex.libraryLayouts[custom.id] = [{
    id: "evidence",
    title: "Evidence",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "guidelines", title: "Guidelines", collapsed: false, subjects: ["paper"] }],
  }];
  const placeholder = record("kbcc-placeholder:paper", "Airway evidence", "note");
  Object.assign(placeholder, {
    role: "placeholder",
    portableId: "paper",
    isPlaceholder: true,
    portableIndexed: false,
    libraryId: custom.id,
    curriculumId: "REF-001",
    domain: "Guidelines",
    topicKind: "note",
  });
  let compatibilityIssue: string | null = null;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => true,
    isDataReadOnly: () => false,
    getLibrary: (id: string) => id === custom.id ? custom : BUILTIN_LIBRARY_DEFINITIONS.find((item) => item.id === id) ?? null,
    getEffectiveLibraryNoteProfile: () => ({
      folder: "Evidence",
      mode: "template" as const,
      templatePath: "Templates/Evidence.md",
      inherited: { folder: false, mode: false, templatePath: false },
    }),
    getPortableSubject: () => ({
      id: "paper",
      title: "Airway evidence",
      groupId: "evidence",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "REF-001",
      recordKind: "note" as const,
      libraryId: custom.id,
    }),
    placeholderNoteCompatibilityIssue: (subjectId: string, destinationFolder: string) =>
      subjectId === "paper" && destinationFolder === "Evidence" ? compatibilityIssue : "unexpected preflight arguments",
  };
  let created: {
    initial: Record<string, unknown>;
    context: { createLabel?: string; tokenContext?: Record<string, string> } | undefined;
  } | null = null;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openPlaceholderActions(value: VaultRecord): void;
    startCreateKnowledgeNote(
      initial: Record<string, unknown>,
      indexAfterCreate: boolean,
      onCreated: unknown,
      message: string | undefined,
      context: { createLabel?: string; tokenContext?: Record<string, string> } | undefined,
    ): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.startCreateKnowledgeNote = (initial, _index, _created, _message, context) => { created = { initial, context }; };
  let modalItems: ReturnType<AddActionModal["getItems"]> = [];
  let chooseModalItem: ((item: ReturnType<AddActionModal["getItems"]>[number]) => void) | null = null;
  const hadOwnOpen = Object.prototype.hasOwnProperty.call(AddActionModal.prototype, "open");
  const originalOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  AddActionModal.prototype.open = function openForTest(this: AddActionModal): void {
    modalItems = this.getItems();
    chooseModalItem = (item) => this.onChooseItem(item);
  };
  try {
    view.openPlaceholderActions(placeholder);
    assert.deepEqual(modalItems.map((item) => item.id), ["empty", "template", "link", "keep"]);
    const empty = modalItems.find((item) => item.id === "empty");
    assert.ok(empty);
    chooseModalItem?.(empty);

    // An incompatible subject is refused BEFORE the note form opens: the
    // compatibility preflight surfaces the linking error as a notice, so no
    // orphan-to-be file can ever be created.
    compatibilityIssue = "This note note cannot be linked to a portable topic subject.";
    Notice.messages.length = 0;
    const createdBeforeRefusal = created;
    view.openPlaceholderActions(placeholder);
    const refusedEmpty = modalItems.find((item) => item.id === "empty");
    assert.ok(refusedEmpty);
    chooseModalItem?.(refusedEmpty);
    assert.equal(created, createdBeforeRefusal, "the note form never opens for an incompatible subject");
    assert.deepEqual(Notice.messages, [compatibilityIssue]);
  } finally {
    if (hadOwnOpen && originalOpen) Object.defineProperty(AddActionModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
  }

  assert.deepEqual(created?.initial, {
    title: "Airway evidence",
    folder: "Evidence",
    mode: "empty",
    templatePath: "Templates/Evidence.md",
  });
  assert.equal(created?.context?.createLabel, "Reference");
  assert.deepEqual(created?.context?.tokenContext, {
    id: "REF-001",
    category: "Guidelines",
    parent: "",
    library: "Reference Sets",
    type: "Reference",
  });
});

test("library heading reorder is portable, undo-protected, and leaves Markdown outside the mutation", async () => {
  const data = migrateData(null);
  const library = installLibrary(data);
  data.portableIndex.libraryLayouts[library.id] = [
    { id: "heading-a", title: "A", collapsed: false, subjects: [], subheadings: [] },
    { id: "heading-b", title: "B", collapsed: false, subjects: [], subheadings: [] },
  ];
  let options: { includePortableIndex?: boolean; requireUndo?: boolean } | undefined;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: {
      data: typeof data;
      getLibrary(id: string): LibraryDefinition | null;
      mutate(label: string, action: () => void, nextOptions?: typeof options): Promise<void>;
    };
    moveLibraryHeading(libraryId: string, from: number, to: number): Promise<void>;
  };
  view.plugin = {
    data,
    getLibrary: (id) => id === library.id ? library : null,
    mutate: async (_label, action, nextOptions) => {
      options = nextOptions;
      action();
    },
  };

  await view.moveLibraryHeading(library.id, 0, 1);

  assert.deepEqual(data.portableIndex.libraryLayouts[library.id]?.map((heading) => heading.id), ["heading-b", "heading-a"]);
  assert.deepEqual(options, { includePortableIndex: true, requireUndo: true });
});

test("library interaction menus create, rename, reorder, and remove headings, subheadings, and records", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  data.portableIndex.libraryLayouts[library.id] = [
    {
      id: "heading-a",
      title: "Heading A",
      collapsed: false,
      subjects: ["subject-a", "subject-b"],
      subheadings: [{ id: "subheading-old", title: "Old", collapsed: false, subjects: [] }],
    },
    { id: "heading-b", title: "Heading B", collapsed: false, subjects: [], subheadings: [] },
  ];
  const mutationOptions: Array<{ includePortableIndex?: boolean; requireUndo?: boolean } | undefined> = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    getLibraries: () => [library],
    getLibrary: (id: string) => id === library.id ? library : null,
    canVisuallyMoveAcrossGroups: () => false,
    async mutate(
      _label: string,
      action: () => void,
      options?: { includePortableIndex?: boolean; requireUndo?: boolean },
    ): Promise<void> {
      mutationOptions.push(options);
      action();
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    curriculumArrangeMode: boolean;
    promptNewLibraryHeading(libraryId: string): void;
    showLibraryHeadingMenu(event: MouseEvent, libraryId: string, heading: NonNullable<typeof data.portableIndex.libraryLayouts[string]>[number]): void;
    showLibrarySubheadingMenu(
      event: MouseEvent,
      libraryId: string,
      heading: NonNullable<typeof data.portableIndex.libraryLayouts[string]>[number],
      subheading: NonNullable<typeof data.portableIndex.libraryLayouts[string]>[number]["subheadings"][number],
    ): void;
    showRecordMenu(
      event: MouseEvent,
      item: VaultRecord,
      membership: undefined,
      libraryMembership: { libraryId: string; headingId: string },
    ): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.curriculumArrangeMode = false;

  interface CapturedMenuItem {
    title: string;
    disabled: boolean;
    click?: () => void;
  }
  const menuItems = new WeakMap<object, CapturedMenuItem[]>();
  const shownMenus: CapturedMenuItem[][] = [];
  const menuDescriptors = new Map(["addItem", "addSeparator", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const entries = menuItems.get(this) ?? [];
      menuItems.set(this, entries);
      const captured: CapturedMenuItem = { title: "", disabled: false };
      const item = {
        setTitle(title: string) { captured.title = title; return item; },
        setIcon() { return item; },
        setDisabled(disabled: boolean) { captured.disabled = disabled; return item; },
        onClick(callback: () => void) { captured.click = callback; return item; },
      };
      configure(item);
      entries.push(captured);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "addSeparator", {
    configurable: true,
    value(this: object): object { return this; },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(this: object): void { shownMenus.push(menuItems.get(this) ?? []); },
  });

  let nextPrompt = "";
  const promptPromises: Promise<unknown>[] = [];
  const confirmations: Array<() => void | Promise<void>> = [];
  const promptOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
  const confirmOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  TextPromptModal.prototype.open = function submitPrompt(): void {
    const options = (this as unknown as { options: { onSubmit(value: string): void | Promise<void> } }).options;
    promptPromises.push(Promise.resolve(options.onSubmit(nextPrompt)));
  };
  ConfirmModal.prototype.open = function captureConfirmation(): void {
    const modal = this as unknown as { onConfirm(): void | Promise<void> };
    confirmations.push(() => modal.onConfirm());
  };

  const settlePrompts = async (): Promise<void> => {
    const pending = promptPromises.splice(0);
    await Promise.all(pending);
    await Promise.resolve();
  };
  const choose = (items: CapturedMenuItem[], title: string): void => {
    const item = items.find((candidate) => candidate.title === title);
    assert.ok(item, `missing menu item ${title}`);
    assert.equal(item.disabled, false, `${title} should be enabled`);
    item.click?.();
  };

  try {
    nextPrompt = "Created heading";
    view.promptNewLibraryHeading(library.id);
    await settlePrompts();
    assert.equal(data.portableIndex.libraryLayouts[library.id]?.some((heading) => heading.title === "Created heading"), true);

    const heading = data.portableIndex.libraryLayouts[library.id]?.find((item) => item.id === "heading-a");
    assert.ok(heading);
    view.showLibraryHeadingMenu({} as MouseEvent, library.id, heading);
    const headingMenu = shownMenus.at(-1) ?? [];

    nextPrompt = "Renamed heading";
    choose(headingMenu, "Rename heading");
    await settlePrompts();
    assert.equal(heading.title, "Renamed heading");

    nextPrompt = "Topical";
    choose(headingMenu, "Add subheading");
    await settlePrompts();
    const subheading = heading.subheadings.find((item) => item.title === "Topical");
    assert.ok(subheading);
    subheading.subjects = ["subject-c"];

    choose(headingMenu, "Move heading down");
    await Promise.resolve();
    assert.deepEqual(data.portableIndex.libraryLayouts[library.id]?.map((item) => item.id).slice(0, 2), ["heading-b", "heading-a"]);

    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, subheading);
    const subheadingMenu = shownMenus.at(-1) ?? [];
    choose(subheadingMenu, "Move subheading up");
    await Promise.resolve();
    assert.equal(heading.subheadings[0]?.id, subheading.id);

    nextPrompt = "Intranasal";
    choose(subheadingMenu, "Rename subheading");
    await settlePrompts();
    assert.equal(subheading.title, "Intranasal");

    choose(subheadingMenu, "Remove subheading");
    const removeSubheading = confirmations.shift();
    assert.ok(removeSubheading);
    await removeSubheading();
    assert.equal(heading.subheadings.some((item) => item.id === subheading.id), false);
    assert.equal(heading.subjects.includes("subject-c"), true, "removing a subheading keeps its records directly under the heading");

    const reference = {
      ...record("Reference/Guideline.md", "Guideline"),
      portableId: "subject-a",
      libraryId: library.id,
    };
    view.showRecordMenu({} as MouseEvent, reference, undefined, { libraryId: library.id, headingId: heading.id });
    const recordMenu = shownMenus.at(-1) ?? [];
    choose(recordMenu, "Move down");
    await Promise.resolve();
    assert.deepEqual(heading.subjects.slice(0, 2), ["subject-b", "subject-a"]);

    choose(headingMenu, "Delete heading");
    const deleteHeading = confirmations.shift();
    assert.ok(deleteHeading);
    await deleteHeading();
    assert.equal(data.portableIndex.libraryLayouts[library.id]?.some((item) => item.id === heading.id), false);
    assert.equal(data.portableIndex.libraryLayouts[library.id]?.some((item) => item.title === "Created heading"), true);
  } finally {
    if (promptOpen) Object.defineProperty(TextPromptModal.prototype, "open", promptOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
    if (confirmOpen) Object.defineProperty(ConfirmModal.prototype, "open", confirmOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
    for (const [name, descriptor] of menuDescriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
      else Reflect.deleteProperty(Menu.prototype, name);
    }
  }

  assert.equal(mutationOptions.length >= 8, true);
  assert.equal(mutationOptions.every((options) => options?.includePortableIndex && options.requireUndo), true);
});

test("Generic indexed non-topic records expose inspector and mobile arrange controls", () => {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.activeTab = "curriculum";
  const indexedNote: VaultRecord = {
    ...record("Knowledge Base/References/Guideline.md", "Guideline", "note"),
    role: "vault-note",
    portableIndexed: true,
  };
  data.selectedPath = indexedNote.path;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    canVisuallyMoveAcrossGroups: () => true,
    getLibrary: () => null,
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as {
    app: object;
    plugin: typeof plugin;
    contentEl: HTMLElement;
    inspectorEl: HTMLElement;
    recordByPath: Map<string, VaultRecord>;
    viewInstanceId: string;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    mobileInspectorOpen: boolean;
    mobileInspectorNeedsFocus: boolean;
    curriculumArrangeMode: boolean;
    curriculum: ReturnType<typeof emptyCurriculumTree>;
    visualPlacementPaths: Set<string>;
    timerWindow: { setTimeout(callback: () => void): number };
    isCompactInspectorLayout(): boolean;
    renderRelatedKnowledge(): void;
    renderInspector(): void;
    showRecordMenu(event: MouseEvent, item: VaultRecord): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.contentEl = dom.document.body as unknown as HTMLElement;
  view.inspectorEl = dom.document.body.createEl("aside") as unknown as HTMLElement;
  view.recordByPath = new Map([[indexedNote.path, indexedNote]]);
  view.viewInstanceId = "generic-indexed-note-test";
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.mobileInspectorOpen = false;
  view.mobileInspectorNeedsFocus = false;
  view.curriculumArrangeMode = true;
  view.curriculum = emptyCurriculumTree();
  view.visualPlacementPaths = new Set();
  view.curriculum.domains = [{
    domain: indexedNote.domain,
    folderOrder: indexedNote.folderOrder,
    roots: [{ record: indexedNote, children: [] }],
  }];
  view.curriculum.parentByPath.set(indexedNote.path, null);
  view.curriculum.childrenByPath.set(indexedNote.path, []);
  view.timerWindow = { setTimeout: (callback) => { callback(); return 1; } };
  view.isCompactInspectorLayout = () => false;
  view.renderRelatedKnowledge = () => undefined;

  interface CapturedMenuItem { title: string }
  const menuItems = new WeakMap<object, CapturedMenuItem[]>();
  let shown: CapturedMenuItem[] = [];
  const descriptors = new Map(["addItem", "addSeparator", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const items = menuItems.get(this) ?? [];
      menuItems.set(this, items);
      const captured: CapturedMenuItem = { title: "" };
      const item = {
        setTitle(title: string) { captured.title = title; return item; },
        setIcon() { return item; },
        setDisabled() { return item; },
        onClick() { return item; },
      };
      configure(item);
      items.push(captured);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "addSeparator", {
    configurable: true,
    value(this: object): object { return this; },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(this: object): void { shown = menuItems.get(this) ?? []; },
  });

  try {
    view.renderInspector();
    assert.match(view.inspectorEl.textContent ?? "", /Move .*…/i);
    view.showRecordMenu({} as MouseEvent, indexedNote);
    assert.equal(shown.some((item) => /^Move to .*…$/i.test(item.title)), true);
    assert.equal(shown.some((item) => item.title === "Move under…"), true);
    assert.equal(shown.some((item) => item.title.startsWith("Indent under previous")), true);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
      else Reflect.deleteProperty(Menu.prototype, name);
    }
  }
});

test("global expand and collapse controls apply to the active dynamic library hierarchy", async () => {
  const data = migrateData(null);
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  data.portableIndex.libraryLayouts[library.id] = [{
    id: "heading-a",
    title: "Heading A",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "subheading-a", title: "Subheading A", collapsed: false, subjects: [] }],
  }];
  let saves = 0;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    savePluginData: async () => { saves += 1; },
    saveViewState: async () => { saves += 1; },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    collapsedQueues: Set<string>;
    renderTree(): void;
    showGlobalMenu(event: MouseEvent): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.records = [];
  view.recordByPath = new Map();
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.collapsedQueues = new Set();
  view.renderTree = () => undefined;

  interface CapturedItem { title: string; click?: () => void }
  let shown: CapturedItem[] = [];
  const entriesByMenu = new WeakMap<object, CapturedItem[]>();
  const descriptors = new Map(["addItem", "addSeparator", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const entries = entriesByMenu.get(this) ?? [];
      entriesByMenu.set(this, entries);
      const captured: CapturedItem = { title: "" };
      const item = {
        setTitle(title: string) { captured.title = title; return item; },
        setIcon() { return item; },
        setDisabled() { return item; },
        onClick(callback: () => void) { captured.click = callback; return item; },
      };
      configure(item);
      entries.push(captured);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "addSeparator", {
    configurable: true,
    value(this: object): object { return this; },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(this: object): void { shown = entriesByMenu.get(this) ?? []; },
  });

  const choose = async (title: string): Promise<void> => {
    const action = shown.find((item) => item.title === title);
    assert.ok(action, `missing menu item ${title}`);
    action.click?.();
    await Promise.resolve();
    await Promise.resolve();
  };

  try {
    view.showGlobalMenu({} as MouseEvent);
    await choose("Collapse all visible groups");
    assert.equal(data.portableIndex.libraryLayouts[library.id]?.[0]?.collapsed, true);
    assert.equal(data.portableIndex.libraryLayouts[library.id]?.[0]?.subheadings[0]?.collapsed, true);

    view.showGlobalMenu({} as MouseEvent);
    await choose("Expand all visible groups");
    assert.equal(data.portableIndex.libraryLayouts[library.id]?.[0]?.collapsed, false);
    assert.equal(data.portableIndex.libraryLayouts[library.id]?.[0]?.subheadings[0]?.collapsed, false);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
      else Reflect.deleteProperty(Menu.prototype, name);
    }
  }

  assert.equal(saves, 2);
});

test("library modal callbacks reject replaced layouts and removed IDs without touching detached objects", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  const detachedHeading = {
    id: "heading-live",
    title: "Detached heading",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "subheading-live", title: "Detached subheading", collapsed: false, subjects: [] }],
  };
  data.portableIndex.libraryLayouts[library.id] = [detachedHeading];
  let mutations = 0;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    getLibrary: (id: string) => id === library.id ? library : null,
    async mutate(
      _label: string,
      action: () => void,
      options?: { includePortableIndex?: boolean; requireUndo?: boolean },
    ): Promise<void> {
      assert.deepEqual(options, { includePortableIndex: true, requireUndo: true });
      mutations += 1;
      action();
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    promptNewLibrarySubheading(libraryId: string, heading: typeof detachedHeading): void;
    showLibraryHeadingMenu(event: MouseEvent, libraryId: string, heading: typeof detachedHeading): void;
    showLibrarySubheadingMenu(
      event: MouseEvent,
      libraryId: string,
      heading: typeof detachedHeading,
      subheading: typeof detachedHeading.subheadings[number],
    ): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  type PromptSubmit = (value: string) => void | Promise<void>;
  interface CapturedMenuItem { title: string; click?: () => void }
  const prompts: PromptSubmit[] = [];
  const shownMenus: CapturedMenuItem[][] = [];
  const itemsByMenu = new WeakMap<object, CapturedMenuItem[]>();
  const promptOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
  const menuDescriptors = new Map(["addItem", "addSeparator", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  TextPromptModal.prototype.open = function capturePrompt(): void {
    const modal = this as unknown as { options: { onSubmit(value: string): void | Promise<void> } };
    prompts.push((value) => modal.options.onSubmit(value));
  };
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const entries = itemsByMenu.get(this) ?? [];
      itemsByMenu.set(this, entries);
      const captured: CapturedMenuItem = { title: "" };
      const item = {
        setTitle(title: string) { captured.title = title; return item; },
        setIcon() { return item; },
        setDisabled() { return item; },
        onClick(callback: () => void) { captured.click = callback; return item; },
      };
      configure(item);
      entries.push(captured);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "addSeparator", {
    configurable: true,
    value(this: object): object { return this; },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(this: object): void { shownMenus.push(itemsByMenu.get(this) ?? []); },
  });

  const takePrompt = (): PromptSubmit => {
    const submit = prompts.shift();
    assert.ok(submit, "expected a library prompt callback");
    return submit;
  };
  const choose = (title: string): void => {
    const item = shownMenus.at(-1)?.find((candidate) => candidate.title === title);
    assert.ok(item, `missing menu item ${title}`);
    item.click?.();
  };

  try {
    view.promptNewLibrarySubheading(library.id, detachedHeading);
    const staleAddSubheading = takePrompt();
    const liveHeading = structuredClone(detachedHeading);
    data.portableIndex.libraryLayouts[library.id] = [liveHeading];
    await assert.rejects(Promise.resolve(staleAddSubheading("Must not apply")), /library organization changed/i);
    assert.equal(liveHeading.subheadings.some((item) => item.title === "Must not apply"), false);
    assert.equal(detachedHeading.subheadings.some((item) => item.title === "Must not apply"), false);

    view.promptNewLibrarySubheading(library.id, liveHeading);
    const addSubheading = takePrompt();
    await addSubheading("Added to live heading");
    assert.equal(liveHeading.subheadings.some((item) => item.title === "Added to live heading"), true);
    assert.equal(detachedHeading.subheadings.some((item) => item.title === "Added to live heading"), false);

    view.showLibraryHeadingMenu({} as MouseEvent, library.id, liveHeading);
    choose("Rename heading");
    const staleRenameHeading = takePrompt();
    const replacementHeading = structuredClone(liveHeading);
    data.portableIndex.libraryLayouts[library.id] = [replacementHeading];
    await assert.rejects(Promise.resolve(staleRenameHeading("Must not apply")), /library organization changed/i);
    assert.equal(replacementHeading.title, "Detached heading");
    assert.equal(liveHeading.title, "Detached heading");

    view.showLibraryHeadingMenu({} as MouseEvent, library.id, replacementHeading);
    choose("Rename heading");
    const renameHeading = takePrompt();
    await renameHeading("Renamed live heading");
    assert.equal(replacementHeading.title, "Renamed live heading");
    assert.equal(liveHeading.title, "Detached heading");

    const detachedSubheading = replacementHeading.subheadings.find((item) => item.id === "subheading-live");
    assert.ok(detachedSubheading);
    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, replacementHeading, detachedSubheading);
    choose("Rename subheading");
    const staleRenameSubheading = takePrompt();
    const secondReplacement = structuredClone(replacementHeading);
    data.portableIndex.libraryLayouts[library.id] = [secondReplacement];
    await assert.rejects(Promise.resolve(staleRenameSubheading("Must not apply")), /library organization changed/i);
    assert.equal(secondReplacement.subheadings.find((item) => item.id === "subheading-live")?.title, "Detached subheading");
    assert.equal(detachedSubheading.title, "Detached subheading");

    const liveSubheading = secondReplacement.subheadings.find((item) => item.id === "subheading-live");
    assert.ok(liveSubheading);
    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, secondReplacement, liveSubheading);
    choose("Rename subheading");
    const renameSubheading = takePrompt();
    await renameSubheading("Renamed live subheading");
    assert.equal(secondReplacement.subheadings.find((item) => item.id === "subheading-live")?.title, "Renamed live subheading");
    assert.equal(detachedSubheading.title, "Detached subheading");

    const removableSubheading = secondReplacement.subheadings.find((item) => item.id === "subheading-live");
    assert.ok(removableSubheading);
    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, secondReplacement, removableSubheading);
    choose("Rename subheading");
    const renameRemovedSubheading = takePrompt();
    const headingWithoutSubheading = structuredClone(secondReplacement);
    headingWithoutSubheading.subheadings = headingWithoutSubheading.subheadings.filter((item) => item.id !== "subheading-live");
    data.portableIndex.libraryLayouts[library.id]?.splice(0, 1, headingWithoutSubheading);
    await assert.rejects(Promise.resolve(renameRemovedSubheading("Must not apply")), /subheading is no longer available/i);
    assert.equal(removableSubheading.title, "Renamed live subheading");

    view.showLibraryHeadingMenu({} as MouseEvent, library.id, headingWithoutSubheading);
    choose("Rename heading");
    const renameRemovedHeading = takePrompt();
    data.portableIndex.libraryLayouts[library.id]?.splice(0);
    await assert.rejects(Promise.resolve(renameRemovedHeading("Must not apply")), /heading is no longer available/i);
    assert.equal(headingWithoutSubheading.title, "Renamed live heading");
  } finally {
    if (promptOpen) Object.defineProperty(TextPromptModal.prototype, "open", promptOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
    for (const [name, descriptor] of menuDescriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
      else Reflect.deleteProperty(Menu.prototype, name);
    }
  }

  assert.equal(mutations, 3, "removed targets must reject before starting a mutation");
});

test("collections rename and add-subheading target the live nodes, not menu-time captures", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const originalHeading: LayoutHeading = {
    id: "heading-a",
    title: "Original collection",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "sub-a", title: "Original subheading", collapsed: false, subjects: [] }],
  };
  data.collections = [originalHeading];
  let mutations = 0;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    async mutate(_label: string, action: () => void): Promise<void> {
      mutations += 1;
      action();
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    promptNewSubheading(heading: LayoutHeading, parent?: LayoutHeading | LayoutSubheading): void;
    showHeadingMenu(event: MouseEvent, heading: LayoutHeading): void;
    showSubheadingMenu(event: MouseEvent, heading: LayoutHeading, subheading: LayoutSubheading): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  type PromptSubmit = (value: string) => void | Promise<void>;
  interface CapturedMenuItem { title: string; click?: () => void }
  const prompts: PromptSubmit[] = [];
  const shownMenus: CapturedMenuItem[][] = [];
  const itemsByMenu = new WeakMap<object, CapturedMenuItem[]>();
  const promptOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
  const menuDescriptors = new Map(["addItem", "addSeparator", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  TextPromptModal.prototype.open = function capturePrompt(): void {
    const modal = this as unknown as { options: { onSubmit(value: string): void | Promise<void> } };
    prompts.push((value) => modal.options.onSubmit(value));
  };
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const entries = itemsByMenu.get(this) ?? [];
      itemsByMenu.set(this, entries);
      const captured: CapturedMenuItem = { title: "" };
      const item = {
        setTitle(title: string) { captured.title = title; return item; },
        setIcon() { return item; },
        setDisabled() { return item; },
        onClick(callback: () => void) { captured.click = callback; return item; },
      };
      configure(item);
      entries.push(captured);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "addSeparator", {
    configurable: true,
    value(this: object): object { return this; },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(this: object): void { shownMenus.push(itemsByMenu.get(this) ?? []); },
  });

  const takePrompt = (): PromptSubmit => {
    const submit = prompts.shift();
    assert.ok(submit, "expected a collections prompt callback");
    return submit;
  };
  const choose = (title: string): void => {
    const item = shownMenus[shownMenus.length - 1]?.find((candidate) => candidate.title === title);
    assert.ok(item, `missing menu item ${title}`);
    item.click?.();
  };

  try {
    view.showHeadingMenu({} as MouseEvent, originalHeading);
    choose("Rename collection");
    const renameHeading = takePrompt();
    const liveHeading = structuredClone(originalHeading);
    data.collections = [liveHeading];
    await renameHeading("Renamed collection");
    assert.equal(liveHeading.title, "Renamed collection");
    assert.equal(originalHeading.title, "Original collection", "the detached menu-time capture stays untouched");
    assert.equal(mutations, 1);

    view.showHeadingMenu({} as MouseEvent, liveHeading);
    choose("Rename collection");
    const renameRemovedHeading = takePrompt();
    data.collections = [];
    await assert.rejects(Promise.resolve(renameRemovedHeading("Must not apply")), /collection is no longer available/i);
    assert.equal(liveHeading.title, "Renamed collection");
    assert.equal(mutations, 1);

    data.collections = [liveHeading];
    const capturedSubheading = liveHeading.subheadings[0];
    assert.ok(capturedSubheading);
    view.showSubheadingMenu({} as MouseEvent, liveHeading, capturedSubheading);
    choose("Rename subheading");
    const renameSubheading = takePrompt();
    const replacementHeading = structuredClone(liveHeading);
    data.collections = [replacementHeading];
    await renameSubheading("Renamed subheading");
    assert.equal(replacementHeading.subheadings[0]?.title, "Renamed subheading");
    assert.equal(capturedSubheading.title, "Original subheading", "the detached subheading stays untouched");
    assert.equal(mutations, 2);

    const liveSubheading = replacementHeading.subheadings[0];
    assert.ok(liveSubheading);
    view.showSubheadingMenu({} as MouseEvent, replacementHeading, liveSubheading);
    choose("Rename subheading");
    const renameRemovedSubheading = takePrompt();
    replacementHeading.subheadings = [];
    await assert.rejects(Promise.resolve(renameRemovedSubheading("Must not apply")), /subheading is no longer available/i);
    assert.equal(liveSubheading.title, "Renamed subheading");
    assert.equal(mutations, 2);

    replacementHeading.subheadings = [liveSubheading];
    view.promptNewSubheading(replacementHeading, liveSubheading);
    const createNested = takePrompt();
    const secondReplacement = structuredClone(replacementHeading);
    data.collections = [secondReplacement];
    await createNested("Nested under live parent");
    const liveParent = secondReplacement.subheadings[0];
    assert.ok(liveParent);
    assert.equal(liveParent.subheadings?.some((item) => item.title === "Nested under live parent"), true);
    assert.equal((liveSubheading.subheadings ?? []).length, 0, "the detached parent gains nothing");
    assert.equal(mutations, 3);

    view.promptNewSubheading(secondReplacement, liveParent);
    const createUnderRemoved = takePrompt();
    secondReplacement.subheadings = [];
    await assert.rejects(Promise.resolve(createUnderRemoved("Must not apply")), /subheading is no longer available/i);

    view.promptNewSubheading(secondReplacement);
    const createInRemoved = takePrompt();
    data.collections = [];
    await assert.rejects(Promise.resolve(createInRemoved("Must not apply")), /collection is no longer available/i);
    assert.equal(mutations, 3, "removed targets must reject before starting a mutation");
  } finally {
    if (promptOpen) Object.defineProperty(TextPromptModal.prototype, "open", promptOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
    for (const [name, descriptor] of menuDescriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
      else Reflect.deleteProperty(Menu.prototype, name);
    }
  }
});

test("collection reorder clicks recompute their index against the mutated live lists", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = (id: string, title: string): LayoutHeading => ({ id, title, collapsed: false, subjects: [], subheadings: [] });
  const first = heading("h1", "Heading 1");
  const second = heading("h2", "Heading 2");
  const third = heading("h3", "Heading 3");
  const membershipHeading: LayoutHeading = {
    id: "membership-heading",
    title: "Membership",
    collapsed: false,
    subjects: ["Knowledge Base/A.md", "Knowledge Base/B.md", "Knowledge Base/C.md"],
    subheadings: [],
  };
  data.collections = [first, second, third, membershipHeading];
  let mutations = 0;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    canVisuallyMoveAcrossGroups: () => false,
    getLibrary: () => null,
    async mutate(_label: string, action: () => void): Promise<void> {
      mutations += 1;
      action();
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    curriculumArrangeMode: boolean;
    showHeadingMenu(event: MouseEvent, heading: LayoutHeading): void;
    showRecordMenu(event: MouseEvent, item: VaultRecord, membership: { headingId: string; subheadingId?: string }): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.curriculumArrangeMode = false;

  interface CapturedMenuItem { title: string; click?: () => void }
  const shownMenus: CapturedMenuItem[][] = [];
  const itemsByMenu = new WeakMap<object, CapturedMenuItem[]>();
  const menuDescriptors = new Map(["addItem", "addSeparator", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const entries = itemsByMenu.get(this) ?? [];
      itemsByMenu.set(this, entries);
      const captured: CapturedMenuItem = { title: "" };
      const item = {
        setTitle(title: string) { captured.title = title; return item; },
        setIcon() { return item; },
        setDisabled() { return item; },
        onClick(callback: () => void) { captured.click = callback; return item; },
      };
      configure(item);
      entries.push(captured);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "addSeparator", {
    configurable: true,
    value(this: object): object { return this; },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(this: object): void { shownMenus.push(itemsByMenu.get(this) ?? []); },
  });
  const choose = (items: CapturedMenuItem[], title: string): void => {
    const item = items.find((candidate) => candidate.title === title);
    assert.ok(item, `missing menu item ${title}`);
    item.click?.();
  };

  try {
    view.showHeadingMenu({} as MouseEvent, second);
    const headingMenu = shownMenus[shownMenus.length - 1] ?? [];
    data.collections = [second, first, third, membershipHeading];

    choose(headingMenu, "Move collection up");
    await Promise.resolve();
    assert.deepEqual(data.collections.map((item) => item.id), ["h2", "h1", "h3", "membership-heading"]);
    assert.equal(mutations, 0, "a stale click at the live boundary is a no-op, not a wrong-target move");

    choose(headingMenu, "Move collection down");
    await Promise.resolve();
    assert.deepEqual(data.collections.map((item) => item.id), ["h1", "h2", "h3", "membership-heading"]);
    assert.equal(mutations, 1, "the intended collection moves relative to its current position");

    const target = record("Knowledge Base/B.md", "Beta");
    view.showRecordMenu({} as MouseEvent, target, { headingId: membershipHeading.id });
    const recordMenu = shownMenus[shownMenus.length - 1] ?? [];
    membershipHeading.subjects = ["Knowledge Base/B.md", "Knowledge Base/A.md", "Knowledge Base/C.md"];

    choose(recordMenu, "Move down");
    await Promise.resolve();
    assert.deepEqual(
      membershipHeading.subjects,
      ["Knowledge Base/A.md", "Knowledge Base/B.md", "Knowledge Base/C.md"],
      "the record whose menu was opened moves, not whichever record drifted into its old slot",
    );
    assert.equal(mutations, 2);

    choose(recordMenu, "Move up");
    await Promise.resolve();
    assert.deepEqual(membershipHeading.subjects, ["Knowledge Base/B.md", "Knowledge Base/A.md", "Knowledge Base/C.md"]);
    assert.equal(mutations, 3);
  } finally {
    for (const [name, descriptor] of menuDescriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
      else Reflect.deleteProperty(Menu.prototype, name);
    }
  }
});

test("edit-placement parent candidates exclude the edited topic and its descendants", () => {
  const data = migrateData(null);
  data.settings.enableAdvancedCanonicalActions = true;
  const canonicalTopic = (path: string, title: string, curriculumId: string, parentTopic: string): VaultRecord => ({
    ...record(path, title),
    role: "canonical",
    domain: "Laryngology",
    curriculumId,
    parentTopic,
  });
  const edited = canonicalTopic("Knowledge Base/Topic A.md", "Topic A", "ENT-LAR-EXT-001", "");
  const child = canonicalTopic("Knowledge Base/Topic B.md", "Topic B", "ENT-LAR-EXT-002", "[[Topic A]]");
  const grandchild = canonicalTopic("Knowledge Base/Topic C.md", "Topic C", "ENT-LAR-EXT-003", "[[Topic B]]");
  const unrelated = canonicalTopic("Knowledge Base/Topic D.md", "Topic D", "ENT-LAR-EXT-004", "");
  const topics = [edited, child, grandchild, unrelated];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getCanonicalTopics: () => topics,
    resolveLink: () => null,
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    curriculum: ReturnType<typeof buildCurriculumTree>;
    recordByPath: Map<string, VaultRecord>;
    startEditCanonicalPlacement(record: VaultRecord): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.curriculum = buildCurriculumTree(topics, data.curriculumVisual, true);
  view.recordByPath = new Map(topics.map((item) => [item.path, item]));

  const openDescriptor = Object.getOwnPropertyDescriptor(TopicEditorModal.prototype, "open");
  let captured: { canonicalRecords: VaultRecord[] } | null = null;
  TopicEditorModal.prototype.open = function captureOptions(): void {
    captured = (this as unknown as { options: { canonicalRecords: VaultRecord[] } }).options;
  };
  try {
    view.startEditCanonicalPlacement(edited);
  } finally {
    if (openDescriptor) Object.defineProperty(TopicEditorModal.prototype, "open", openDescriptor);
    else Reflect.deleteProperty(TopicEditorModal.prototype, "open");
  }

  assert.ok(captured, "edit placement must reach the topic editor");
  const offered = (captured as { canonicalRecords: VaultRecord[] }).canonicalRecords;
  assert.deepEqual(
    offered.map((item) => item.path),
    [unrelated.path],
    "the topic itself and its whole descendant chain are never offered as parents",
  );
});

test("reload returns to the index when the active dynamic library tab no longer exists", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.activeTab = libraryTabId("removed-library");
  let saves = 0;
  let renders = 0;
  const records = [record("Knowledge Base/Topic.md", "Topic")];
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    plugin: {
      data: typeof data;
      getActiveKnowledgeBaseId(): string;
      getDataEpoch(): number;
      getRecords(): VaultRecord[];
      reconcileRecords(records: VaultRecord[]): Promise<boolean>;
      getLibraries(): LibraryDefinition[];
      isClinicalMode(): boolean;
      isDataReadOnly(): boolean;
      saveViewState(): Promise<void>;
    };
    render(): void;
    reload(): Promise<void>;
  };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getRecords: () => records,
    reconcileRecords: async () => false,
    getLibraries: () => [],
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    saveViewState: async () => { saves += 1; },
  };
  view.render = () => { renders += 1; };

  await view.reload();

  assert.equal(data.activeTab, "curriculum");
  assert.equal(saves, 1);
  assert.equal(renders, 1);
});

test("mobile note sheets follow the visual viewport when the keyboard opens", () => {
  assert.deepEqual(calculateModalViewportLayout(844, 844), {
    height: 844,
    keyboardOpen: false,
    shift: 0,
  });
  assert.deepEqual(calculateModalViewportLayout(844, 430, 20), {
    height: 430,
    keyboardOpen: true,
    shift: -187,
  });
  assert.deepEqual(calculateModalViewportLayout(844, 844, 0, 414), {
    height: 430,
    keyboardOpen: true,
    shift: -207,
  });
  assert.deepEqual(calculateModalViewportLayout(844, 430, 20, 414), {
    height: 410,
    keyboardOpen: true,
    shift: -197,
  });
  assert.deepEqual(calculateModalViewportLayout(844, 844, 0, Number.NaN), {
    height: 844,
    keyboardOpen: false,
    shift: 0,
  });
});

test("focused mobile search subtracts the iOS keyboard from the command-center height", () => {
  assert.deepEqual(calculateSearchViewportLayout(844, 780, 430, 20, 64), {
    height: 386,
    keyboardInset: 394,
    keyboardOpen: true,
    shift: 0,
  });
  assert.deepEqual(calculateSearchViewportLayout(844, 780, 844), {
    height: 780,
    keyboardInset: 0,
    keyboardOpen: false,
    shift: 0,
  });
  assert.deepEqual(calculateSearchViewportLayout(844, 780, 430, 120, 64), {
    height: 430,
    keyboardInset: 294,
    keyboardOpen: true,
    shift: 56,
  });
});

test("search finds records across every library instead of the last selected tab", () => {
  const records = [
    record("Knowledge Base/Laryngomalacia.md", "Laryngomalacia"),
    record("Procedures/Laryngeal injection.md", "Laryngeal injection", "procedure"),
    record("Syndromes/Stickler syndrome.md", "Stickler syndrome", "syndrome"),
  ];
  const domainOnly = record("Knowledge Base/Voice.md", "Voice assessment");
  domainOnly.domain = "Laryngology";
  records.unshift(domainOnly);

  assert.deepEqual(
    matchingKnowledgeBaseRecords(records, "laryn").map((item) => item.title),
    ["Laryngomalacia", "Laryngeal injection", "Voice assessment"],
  );
});

test("the global result cap keeps a better inactive-base match visible", () => {
  const activeRecords = Array.from({ length: 300 }, (_, index) => record(
    `Active/Laryngeal ${index.toString().padStart(3, "0")}.md`,
    `Laryngeal ${index.toString().padStart(3, "0")}`,
  ));
  const exactInactiveMatch = record("Inactive/Laryn.md", "laryn");

  const results = crossBaseSearch([
    { baseId: "active", baseName: "Active base", records: activeRecords },
    { baseId: "inactive", baseName: "Inactive base", records: [exactInactiveMatch] },
  ], "laryn", 300);

  assert.equal(results.total, 301);
  assert.equal(results.rendered, 300);
  assert.deepEqual(results.groups.map((group) => [group.source.baseId, group.records.length, group.total]), [
    ["active", 299, 300],
    ["inactive", 1, 1],
  ]);
  assert.equal(results.groups[1]?.records[0], exactInactiveMatch);
});

test("cross-base deduplication keeps the first matching copy when an earlier same-path record does not match", () => {
  const missed = record("Shared/Topic.md", "Unrelated title");
  const matched = record("Shared/Topic.md", "Laryngomalacia");

  const results = crossBaseSearch([
    { baseId: "active", baseName: "Active base", records: [missed, matched] },
  ], "laryn");

  assert.equal(results.total, 1);
  assert.equal(results.groups[0]?.records[0], matched);
});

test("bounded cross-base collection counts 250k overlapping matches but retains and sorts only 300", () => {
  const baseCount = 500;
  const recordsPerBase = 500;
  const sources = Array.from({ length: baseCount }, (_, baseIndex) => ({
    source: { baseId: `base-${baseIndex}`, baseName: `Base ${baseIndex}` },
    records: {
      *[Symbol.iterator](): Generator<VaultRecord> {
        for (let recordIndex = 0; recordIndex < recordsPerBase; recordIndex += 1) {
          yield record(
            `Shared/Result ${recordIndex.toString().padStart(3, "0")}.md`,
            `Result ${recordIndex.toString().padStart(3, "0")}`,
          );
        }
      },
    },
  }));

  const results = collectKnowledgeBaseSearchResults(sources, parseQuery("result"), 300);

  assert.equal(results.total, baseCount * recordsPerBase);
  assert.equal(results.counts.length, baseCount);
  assert.equal(results.counts.every(({ total }) => total === recordsPerBase), true);
  assert.equal(results.rendered, 300);
  assert.equal(results.stats.examinedRecords, baseCount * recordsPerBase);
  assert.equal(results.stats.matchedRecords, baseCount * recordsPerBase);
  assert.equal(results.stats.peakRetainedCandidates, 300);
  assert.equal(results.stats.sortedCandidates, 300);
});

test("selecting an inactive-base search result switches bases and restores the global query", async () => {
  const inactiveData = migrateData(null);
  inactiveData.settings.workspaceName = "Inactive base";
  const searchedRecord = record("Inactive/Laryngomalacia.md", "Laryngomalacia");
  let activeBaseId = "active";
  let switchedTo = "";
  let selectedPath = "";
  let renders = 0;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    query: string;
    parsedQuery: ReturnType<typeof parseQuery>;
    plugin: {
      getActiveKnowledgeBaseId(): string;
      switchKnowledgeBase(id: string): Promise<void>;
      getRecord(path: string): VaultRecord | null;
    };
    render(): void;
    selectRecord(path: string): void;
    activateSearchResult(
      source: { baseId: string; baseName: string; data: typeof inactiveData; records: VaultRecord[] },
      record: VaultRecord,
      action: "select",
    ): Promise<void>;
  };
  view.query = "laryn";
  view.parsedQuery = parseQuery(view.query);
  view.plugin = {
    getActiveKnowledgeBaseId: () => activeBaseId,
    switchKnowledgeBase: async (id) => {
      switchedTo = id;
      activeBaseId = id;
      view.query = ""; // Simulate the base-local reload performed by the plugin.
      view.parsedQuery = parseQuery("");
    },
    getRecord: (path) => path === searchedRecord.path ? searchedRecord : null,
  };
  view.render = () => { renders += 1; };
  view.selectRecord = (path) => { selectedPath = path; };

  await view.activateSearchResult({
    baseId: "inactive",
    baseName: "Inactive base",
    data: inactiveData,
    records: [searchedRecord],
  }, searchedRecord, "select");

  assert.equal(switchedTo, "inactive");
  assert.equal(view.query, "laryn");
  assert.deepEqual(view.parsedQuery, parseQuery("laryn"));
  assert.equal(renders, 1);
  assert.equal(selectedPath, searchedRecord.path);
});

test("Index Manager normalizes Arabic variants and indexes direct membership once per projection", () => {
  const directIndexPaths = ["Knowledge Base/Manual.md"];
  let linearProbes = 0;
  const includes = directIndexPaths.includes.bind(directIndexPaths);
  directIndexPaths.includes = (path, fromIndex) => {
    linearProbes += 1;
    return includes(path, fromIndex);
  };
  const records = [
    record("Knowledge Base/Manual.md", "مستشفى"),
    record("Knowledge Base/Folder.md", "حنجرة"),
  ];
  const manager = Object.create(IndexManagerModal.prototype) as {
    query: string;
    plugin: {
      data: {
        directIndexPaths: string[];
        manualIndexPaths: string[];
        indexFolderSources: Array<{ id: string; path: string; origin: "user" }>;
      };
      getIndexRecords(): VaultRecord[];
      isClinicalMode(): boolean;
    };
    indexedNotes(): Array<{ path: string; title: string; meta: string }>;
    filterNotes(notes: Array<{ path: string; title: string; meta: string }>): Array<{ path: string; title: string; meta: string }>;
  };
  manager.plugin = {
    data: {
      directIndexPaths,
      manualIndexPaths: [],
      indexFolderSources: [{ id: "source-kb", path: "Knowledge Base", origin: "user" }],
    },
    getIndexRecords: () => records,
    isClinicalMode: () => false,
  };

  const notes = manager.indexedNotes();
  assert.match(notes[0]?.meta ?? "", /direct membership/);
  assert.match(notes[1]?.meta ?? "", /linked folder/);
  assert.equal(linearProbes, 0);

  manager.query = "مستشفي";
  assert.deepEqual(manager.filterNotes(notes).map((note) => note.path), ["Knowledge Base/Manual.md"]);
  manager.query = "حـنـجـرة";
  assert.deepEqual(manager.filterNotes(notes).map((note) => note.path), ["Knowledge Base/Folder.md"]);
});

test("mobile note-sheet viewport values are clamped to the layout viewport", () => {
  assert.deepEqual(calculateModalViewportLayout(600, 900), {
    height: 600,
    keyboardOpen: false,
    shift: 0,
  });
});

test("topic editor canonical previews use the knowledge base root captured at open", () => {
  let preview = "";
  const modal = Object.create(TopicEditorModal.prototype) as {
    value: {
      title: string;
      domain: string;
      parentPath: string;
      topicKind: string;
      priority: string;
      safetyCritical: boolean;
      curriculumId: string;
      addToCollection: boolean;
    };
    options: {
      mode: "canonical";
      canonicalRoot: string;
      previewDetails?: (value: unknown) => string[];
    };
    previewEl: { setText(value: string): void };
    detailsEl: null;
    updatePreview(): void;
  };
  modal.value = {
    title: "Laryngeal cleft",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P2",
    safetyCritical: false,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  };
  modal.options = { mode: "canonical", canonicalRoot: "ENT Library/Clinical Topics" };
  modal.previewEl = { setText: (value) => { preview = value; } };
  modal.detailsEl = null;

  modal.updatePreview();

  assert.match(preview, /^ENT Library\/Clinical Topics\/03 Laryngology\//);
});

test("oversized export preparation never mutates the live portable registry", () => {
  const data = migrateData(null);
  const before = structuredClone(data.portableIndex);
  const records = Array.from({ length: 9_500 }, (_, index) => record(
    `Knowledge Base/Topic ${index}.md`,
    `Topic ${index} ${"x".repeat(980)}`,
  ));

  assert.throws(
    () => preparePortableExport(
      data,
      records,
      { ...EMPTY_PORTABLE_SELECTION, index: true },
      "2026-08-08T00:00:00.000Z",
      "vault-ent-main",
    ),
    /above the 10 MB/i,
  );
  assert.deepEqual(data.portableIndex, before);
});

test("portability mode tabs implement automatic Arrow, Home, and End keyboard navigation", () => {
  const dom = createFakeDom();
  let restoredFocusKey = "";
  const center = Object.create(ExportImportCenterModal.prototype) as {
    mode: "export" | "import";
    busyAction: "export" | "import" | "file" | null;
    contentEl: HTMLElement;
    renderModePicker(): void;
    rerenderFromControl(focusKey: string): void;
  };
  center.mode = "export";
  center.busyAction = null;
  center.contentEl = dom.document.body as unknown as HTMLElement;
  center.rerenderFromControl = (focusKey) => {
    restoredFocusKey = focusKey;
    center.contentEl.empty();
    center.renderModePicker();
    const target = Array.from(center.contentEl.querySelectorAll<HTMLElement>("[data-portability-focus]"))
      .find((element) => element.getAttribute("data-portability-focus") === focusKey);
    target?.focus({ preventScroll: true });
  };

  center.renderModePicker();
  const keydown = (key: string): { defaultPrevented: boolean } => {
    const active = dom.document.body.querySelector('[role="tab"][aria-selected="true"]');
    assert.ok(active);
    return active.dispatch("keydown", { key });
  };

  assert.equal(keydown("ArrowRight").defaultPrevented, true);
  assert.equal(center.mode, "import");
  assert.equal(restoredFocusKey, "mode-import");
  assert.equal(dom.document.activeElement?.getAttribute("data-portability-focus"), "mode-import");

  assert.equal(keydown("Home").defaultPrevented, true);
  assert.equal(center.mode, "export");
  assert.equal(dom.document.activeElement?.getAttribute("data-portability-focus"), "mode-export");

  assert.equal(keydown("End").defaultPrevented, true);
  assert.equal(center.mode, "import");
  assert.equal(keydown("ArrowLeft").defaultPrevented, true);
  assert.equal(center.mode, "export");
});

test("portability tabs own one stable, labelled active tabpanel", () => {
  const dom = createFakeDom();
  const center = Object.create(ExportImportCenterModal.prototype) as {
    mode: "export" | "import";
    busyAction: "export" | "import" | "file" | null;
    accessibilityInstanceId: string;
    panelEl: HTMLElement | null;
    contentEl: HTMLElement;
    renderModePicker(): void;
    renderModePanel(): void;
    renderExport(): void;
    renderImport(): void;
    rerenderFromControl(focusKey: string): void;
  };
  center.mode = "export";
  center.busyAction = null;
  center.accessibilityInstanceId = "ent-cc-portability-test";
  center.panelEl = null;
  center.contentEl = dom.document.body as unknown as HTMLElement;
  center.renderExport = () => center.panelEl?.createDiv({ text: "Export body" });
  center.renderImport = () => center.panelEl?.createDiv({ text: "Import body" });
  const renderSurface = (): void => {
    center.panelEl = null;
    center.contentEl.empty();
    center.renderModePicker();
    center.renderModePanel();
  };
  center.rerenderFromControl = () => renderSurface();

  renderSurface();
  const exportTab = dom.document.body.querySelector('[role="tab"][aria-selected="true"]');
  const exportPanel = dom.document.body.querySelector('[role="tabpanel"]');
  assert.equal(exportTab?.getAttribute("id"), "ent-cc-portability-test-tab-export");
  assert.equal(exportTab?.getAttribute("aria-controls"), "ent-cc-portability-test-panel-export");
  assert.equal(exportPanel?.getAttribute("id"), "ent-cc-portability-test-panel-export");
  assert.equal(exportPanel?.getAttribute("aria-labelledby"), "ent-cc-portability-test-tab-export");
  assert.equal(exportPanel?.textContent, "Export body");
  assert.equal(dom.document.body.querySelectorAll('[role="tabpanel"]').length, 1);

  const importTab = dom.document.body.querySelector('[data-portability-focus="mode-import"]');
  assert.ok(importTab);
  importTab.click();
  const activeImportTab = dom.document.body.querySelector('[role="tab"][aria-selected="true"]');
  const importPanel = dom.document.body.querySelector('[role="tabpanel"]');
  assert.equal(activeImportTab?.getAttribute("id"), "ent-cc-portability-test-tab-import");
  assert.equal(activeImportTab?.getAttribute("aria-controls"), "ent-cc-portability-test-panel-import");
  assert.equal(importPanel?.getAttribute("id"), "ent-cc-portability-test-panel-import");
  assert.equal(importPanel?.getAttribute("aria-labelledby"), "ent-cc-portability-test-tab-import");
  assert.equal(importPanel?.textContent, "Import body");
  assert.equal(dom.document.body.querySelectorAll('[role="tabpanel"]').length, 1);
});

test("portability export explains archived Libraries even when none remain active", () => {
  const dom = createFakeDom();
  const archived = customLibrary("archived-library", "Archived references", "Reference", 0, Date.now());
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { getLibraries(includeArchived?: boolean): LibraryDefinition[] };
    contentEl: HTMLElement;
    renderLibraryToggles(
      selection: typeof EMPTY_PORTABLE_SELECTION,
      available: undefined,
      onChange: (selection: typeof EMPTY_PORTABLE_SELECTION) => void,
    ): void;
  };
  center.plugin = {
    getLibraries: (includeArchived = false) => includeArchived ? [{ ...archived }] : [],
  };
  center.contentEl = dom.document.body as unknown as HTMLElement;

  center.renderLibraryToggles({ ...EMPTY_PORTABLE_SELECTION }, undefined, () => undefined);

  assert.match(center.contentEl.textContent ?? "", /Archived libraries are not part of the portable set/i);
});

test("dependency-only Library copy covers every selected-section source", () => {
  assert.equal(
    portabilityLibraryUnavailableText(true, false),
    " Referenced by another selected section; this file does not declare the complete Library.",
  );
  assert.equal(portabilityLibraryUnavailableText(true, true), "");
  assert.equal(portabilityLibraryUnavailableText(false, false), "");
});

test("portability center ignores a second action while an import is busy", async () => {
  let finish: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let starts = 0;
  let renders = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as {
    busyAction: "export" | "import" | "file" | null;
    centerOpen: boolean;
    pendingFocusKey: string | null;
    render(): void;
    run(kind: "export" | "import" | "file", action: () => Promise<void>): void;
  };
  center.busyAction = null;
  center.centerOpen = true;
  center.pendingFocusKey = null;
  center.render = () => { renders += 1; };

  center.run("import", async () => { starts += 1; await gate; });
  center.run("import", async () => { starts += 1; });
  assert.equal(starts, 1);
  assert.equal(center.busyAction, "import");
  finish?.();
  await gate;
  await new Promise<void>((resolve) => { setImmediate(resolve); });

  assert.equal(center.busyAction, null);
  assert.equal(starts, 1);
  assert.equal(renders, 2, "one busy render and one completion render");
});

test("stale modal callbacks close once and never start work in another knowledge base", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-a";
  let closes = 0;
  let starts = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string };
    openedBaseId: string;
    staleBaseNoticeShown: boolean;
    centerOpen: boolean;
    busyAction: "export" | "import" | "file" | null;
    close(): void;
    run(kind: "export" | "import" | "file", action: () => Promise<void>): void;
  };
  center.plugin = { getActiveKnowledgeBaseId: () => activeBaseId };
  center.openedBaseId = "base-a";
  center.staleBaseNoticeShown = false;
  center.centerOpen = true;
  center.busyAction = null;
  center.close = () => { closes += 1; center.centerOpen = false; };

  activeBaseId = "base-b";
  center.run("import", async () => { starts += 1; });
  center.run("import", async () => { starts += 1; });

  assert.equal(starts, 0);
  assert.equal(closes, 1);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("same-base Sync reload invalidates an open portability center before work starts", () => {
  Notice.messages.length = 0;
  let starts = 0;
  let closes = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string; getDataEpoch(): number };
    openedBaseId: string;
    openedDataEpoch: number;
    staleBaseNoticeShown: boolean;
    centerOpen: boolean;
    busyAction: "export" | "import" | "file" | null;
    close(): void;
    run(kind: "export" | "import" | "file", action: () => Promise<void>): void;
  };
  center.plugin = { getActiveKnowledgeBaseId: () => "base-a", getDataEpoch: () => 8 };
  center.openedBaseId = "base-a";
  center.openedDataEpoch = 7;
  center.staleBaseNoticeShown = false;
  center.centerOpen = true;
  center.busyAction = null;
  center.close = () => { closes += 1; center.centerOpen = false; };

  center.run("import", async () => { starts += 1; });
  center.run("export", async () => { starts += 1; });

  assert.equal(starts, 0);
  assert.equal(closes, 1);
  assert.equal(Notice.messages.filter((message) => message.includes("data was reloaded")).length, 1);
});

test("the index manager rejects a stale mutation callback after a base switch", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-b";
  let closes = 0;
  let starts = 0;
  const manager = Object.create(IndexManagerModal.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string };
    openedBaseId: string;
    staleBaseNoticeShown: boolean;
    managerOpen: boolean;
    close(): void;
    run(action: () => Promise<unknown>): void;
  };
  manager.plugin = { getActiveKnowledgeBaseId: () => activeBaseId };
  manager.openedBaseId = "base-a";
  manager.staleBaseNoticeShown = false;
  manager.managerOpen = true;
  manager.close = () => { closes += 1; manager.managerOpen = false; };

  manager.run(async () => { starts += 1; });
  manager.run(async () => { starts += 1; });

  assert.equal(activeBaseId, "base-b");
  assert.equal(starts, 0);
  assert.equal(closes, 1);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("view workflow guards stay bound to the base that opened the picker", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-a";
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string };
    createOpenedBaseGuard(): () => boolean;
  };
  view.plugin = { getActiveKnowledgeBaseId: () => activeBaseId };
  const ownsBase = view.createOpenedBaseGuard();

  assert.equal(ownsBase(), true);
  activeBaseId = "base-b";
  assert.equal(ownsBase(), false);
  assert.equal(ownsBase(), false);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("a guard created by an old A row during the pre-reload B window still owns A", () => {
  Notice.messages.length = 0;
  let mutationsInB = 0;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string; getDataEpoch(): number };
    loadedBaseId: string;
    loadedDataEpoch: number;
    createOpenedBaseGuard(): () => boolean;
  };
  // Plugin state has already switched, but the visible DOM still belongs to A.
  view.plugin = { getActiveKnowledgeBaseId: () => "base-b", getDataEpoch: () => 2 };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;

  const ownsRenderedBase = view.createOpenedBaseGuard();
  if (ownsRenderedBase()) mutationsInB += 1;
  if (ownsRenderedBase()) mutationsInB += 1;

  assert.equal(mutationsInB, 0);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("view and settings guards reject stale same-base objects after a Sync replacement", () => {
  Notice.messages.length = 0;
  let epoch = 1;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: { getActiveKnowledgeBaseId(): string; getDataEpoch(): number };
    createOpenedBaseGuard(): () => boolean;
  };
  view.plugin = { getActiveKnowledgeBaseId: () => "base-a", getDataEpoch: () => epoch };
  const viewGuard = view.createOpenedBaseGuard();
  assert.equal(viewGuard(), true);

  const settingsTab = Object.create(EntCommandCenterSettingsTab.prototype) as {
    host: { getActiveKnowledgeBaseId(): string; getDataEpoch(): number };
    createOpenedBaseGuard(openedBaseId?: string): () => boolean;
  };
  settingsTab.host = { getActiveKnowledgeBaseId: () => "base-a", getDataEpoch: () => epoch };
  const settingsGuard = settingsTab.createOpenedBaseGuard();
  assert.equal(settingsGuard(), true);

  epoch = 2;
  assert.equal(viewGuard(), false);
  assert.equal(settingsGuard(), false);
});

test("stale rendered rows cannot write selection or collapse state into a newly active base", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-b";
  let saves = 0;
  const data = migrateData(null);
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: {
      data: typeof data;
      getActiveKnowledgeBaseId(): string;
      saveViewState(): Promise<void>;
    };
    loadedBaseId: string;
    staleViewNoticeShown: boolean;
    collapsedQueues: Set<string>;
    collapsedCurriculumDomains: Set<string>;
    collapsedCurriculumNodes: Set<string>;
    persistCollapseState(): void;
    selectRecord(path: string): void;
  };
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => activeBaseId,
    saveViewState: async () => { saves += 1; },
  };
  view.loadedBaseId = "base-a";
  view.staleViewNoticeShown = false;
  view.collapsedQueues = new Set(["old-queue"]);
  view.collapsedCurriculumDomains = new Set(["Old domain"]);
  view.collapsedCurriculumNodes = new Set(["Old/Subject.md"]);

  view.persistCollapseState();
  view.selectRecord("Old/Subject.md");

  assert.equal(data.selectedPath, "");
  assert.deepEqual(data.collapsed.curriculumDomains, []);
  assert.equal(saves, 0);
  assert.equal(Notice.messages.filter((message) => message.includes("knowledge base changed")).length, 1);
  activeBaseId = "base-a";
});

test("reload cancels A selection and search timers before adopting B", async () => {
  const dataB = migrateData(null);
  dataB.settings.workspaceName = "Base B";
  const pendingCallbacks = new Map<number, () => void>();
  let savesIntoB = 0;
  let renders = 0;
  const cleared: number[] = [];
  pendingCallbacks.set(41, () => { renders += 100; });
  pendingCallbacks.set(42, () => { savesIntoB += 1; });
  const plugin = {
    data: dataB,
    getActiveKnowledgeBaseId: () => "base-b",
    getDataEpoch: () => 2,
    getRecords: (): VaultRecord[] => [],
    reconcileRecords: async () => false,
    getLibraries: (): LibraryDefinition[] => [],
    isDataReadOnly: () => false,
    savePluginData: async () => { savesIntoB += 1; },
    saveViewState: async () => { savesIntoB += 1; },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    timerWindow: { clearTimeout(timer: number): void };
    query: string;
    parsedQuery: ReturnType<typeof parseQuery>;
    editMode: boolean;
    curriculumArrangeMode: boolean;
    mobileInspectorOpen: boolean;
    mobileInspectorNeedsFocus: boolean;
    mobileTreeScrollTop: number;
    mobileInspectorScrollTop: number;
    collapsedQueues: Set<string>;
    collapsedCurriculumDomains: Set<string>;
    collapsedCurriculumNodes: Set<string>;
    render(): void;
    reload(): Promise<void>;
  };
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = true;
  view.searchDebounce = 41;
  view.selectionSaveTimer = 42;
  view.timerWindow = {
    clearTimeout: (timer) => {
      cleared.push(timer);
      pendingCallbacks.delete(timer);
    },
  };
  view.query = "stale A search";
  view.parsedQuery = parseQuery(view.query);
  view.editMode = true;
  view.curriculumArrangeMode = true;
  view.mobileInspectorOpen = true;
  view.mobileInspectorNeedsFocus = true;
  view.mobileTreeScrollTop = 100;
  view.mobileInspectorScrollTop = 200;
  view.collapsedQueues = new Set(["A queue"]);
  view.collapsedCurriculumDomains = new Set(["A domain"]);
  view.collapsedCurriculumNodes = new Set(["A note"]);
  view.render = () => { renders += 1; };

  await view.reload();
  for (const callback of pendingCallbacks.values()) callback();

  assert.deepEqual(cleared, [41, 42]);
  assert.equal(pendingCallbacks.size, 0);
  assert.equal(savesIntoB, 0);
  assert.equal(renders, 1, "only reload renders B; the stale search callback never runs");
  assert.equal(view.searchDebounce, null);
  assert.equal(view.selectionSaveTimer, null);
  assert.equal(view.loadedBaseId, "base-b");
  assert.equal(view.loadedDataEpoch, 2);
  assert.equal(view.query, "");
});

test("settings callbacks stay bound to the knowledge base that rendered them", () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-a";
  const settingsTab = Object.create(EntCommandCenterSettingsTab.prototype) as {
    host: { getActiveKnowledgeBaseId(): string };
    createOpenedBaseGuard(openedBaseId?: string): () => boolean;
  };
  settingsTab.host = { getActiveKnowledgeBaseId: () => activeBaseId };
  const ownsBase = settingsTab.createOpenedBaseGuard();

  assert.equal(ownsBase(), true);
  activeBaseId = "base-b";
  assert.equal(ownsBase(), false);
  assert.equal(ownsBase(), false);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

type BufferedSettingsHarness = {
  host: {
    data: PluginData;
    dataCompatibilityWarning: string;
    getActiveKnowledgeBaseId(): string;
    getDataEpoch(): number;
    getExternalChangeGeneration(): number;
    isDataReadOnly(): boolean;
    savePluginData(): Promise<void>;
    saveCompensatingRollback(): Promise<void>;
    markPersistenceUncertain(message: string): void;
    refreshViews(): Promise<void>;
  };
  containerEl: { ownerDocument: { defaultView: Window } };
  persistedDataSnapshot: PluginData;
  settingsSaveRevision: number;
  persistedSettingsRevision: number;
  pendingSettingsSaves: number;
  settingsSaveBarrier: Promise<boolean>;
  settingsWriteUncertain: boolean;
  settingsRefreshPending: boolean;
  settingsRefreshGeneration: number;
  bufferedTextSaveTimer: number | null;
  bufferedTextSaveWindow: Window | null;
  bufferedTextSaveBaseId: string;
  bufferedTextSaveDataEpoch: number;
  bufferedTextSaveExternalGeneration: number;
  bufferedTextSaveData: PluginData | null;
  bufferedTextSaveRefresh: boolean;
  update(): void;
  scheduleTextSave(refresh?: boolean): void;
  flushBufferedTextSave(acceptCompensatedRejection?: boolean): Promise<boolean>;
  prepareForKnowledgeBaseChange(): Promise<boolean>;
  save(refresh?: boolean, directDataFields?: Array<"activeTab" | "indexGroupOrder">): Promise<boolean>;
  hide(): void;
};

function settingsTimerWindow(): { window: Window; callbacks: Map<number, () => void> } {
  let nextTimer = 0;
  const callbacks = new Map<number, () => void>();
  const window = {
    setTimeout(callback: () => void): number {
      nextTimer += 1;
      callbacks.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(timer: number): void { callbacks.delete(timer); },
  } as unknown as Window;
  return { window, callbacks };
}

function bufferedSettingsHarness(options: {
  onSave?: () => void | Promise<void>;
  onCompensate?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onUpdate?: () => void;
} = {}): {
  tab: BufferedSettingsHarness;
  data: PluginData;
  callbacks: Map<number, () => void>;
  setBase(value: string): void;
  setEpoch(value: number): void;
  setExternalGeneration(value: number): void;
  setOwnerWindow(value: Window): void;
} {
  const data = migrateData(null);
  data.settings.setupComplete = true;
  let activeBaseId = "base-a";
  let epoch = 1;
  let externalGeneration = 0;
  let readOnly = false;
  const initialTimers = settingsTimerWindow();
  const tab = Object.create(EntCommandCenterSettingsTab.prototype) as BufferedSettingsHarness;
  tab.host = {
    data,
    dataCompatibilityWarning: "",
    getActiveKnowledgeBaseId: () => activeBaseId,
    getDataEpoch: () => epoch,
    getExternalChangeGeneration: () => externalGeneration,
    isDataReadOnly: () => readOnly,
    savePluginData: async () => { await options.onSave?.(); },
    saveCompensatingRollback: async () => { await options.onCompensate?.(); },
    markPersistenceUncertain: (message) => {
      readOnly = true;
      tab.host.dataCompatibilityWarning = message;
    },
    refreshViews: async () => { await options.onRefresh?.(); },
  };
  tab.containerEl = { ownerDocument: { defaultView: initialTimers.window } };
  tab.persistedDataSnapshot = structuredClone(data);
  tab.settingsSaveRevision = 0;
  tab.persistedSettingsRevision = 0;
  tab.pendingSettingsSaves = 0;
  tab.settingsSaveBarrier = Promise.resolve(true);
  tab.settingsWriteUncertain = false;
  tab.settingsRefreshPending = false;
  tab.settingsRefreshGeneration = 0;
  tab.bufferedTextSaveTimer = null;
  tab.bufferedTextSaveWindow = null;
  tab.bufferedTextSaveBaseId = "";
  tab.bufferedTextSaveDataEpoch = 0;
  tab.bufferedTextSaveExternalGeneration = 0;
  tab.bufferedTextSaveData = null;
  tab.bufferedTextSaveRefresh = false;
  tab.update = () => { options.onUpdate?.(); };
  return {
    tab,
    data,
    callbacks: initialTimers.callbacks,
    setBase: (value) => { activeBaseId = value; },
    setEpoch: (value) => { epoch = value; },
    setExternalGeneration: (value) => { externalGeneration = value; },
    setOwnerWindow: (value) => { tab.containerEl.ownerDocument.defaultView = value; },
  };
}

async function settleBufferedSettingsSave(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

test("settings text edits coalesce and unchanged drafts skip adapter writes", async () => {
  let saves = 0;
  let refreshes = 0;
  const { tab, data, callbacks } = bufferedSettingsHarness({
    onSave: () => { saves += 1; },
    onRefresh: () => { refreshes += 1; },
  });

  for (let index = 1; index <= 20; index += 1) {
    data.settings.workspaceSubtitle = `Typed value ${index}`;
    tab.scheduleTextSave();
  }
  assert.equal(callbacks.size, 1);
  [...callbacks.values()][0]?.();
  await settleBufferedSettingsSave();
  assert.equal(saves, 1);
  assert.equal(refreshes, 1);
  assert.equal(tab.persistedDataSnapshot.settings.workspaceSubtitle, "Typed value 20");

  data.settings.workspaceSubtitle = "Temporary";
  tab.scheduleTextSave();
  data.settings.workspaceSubtitle = "Typed value 20";
  tab.scheduleTextSave();
  [...callbacks.values()][0]?.();
  await settleBufferedSettingsSave();
  assert.equal(saves, 1, "returning to the committed value is a no-op once no write is in flight");
});

test("reverting while an older settings write is in flight queues the durable revert", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let saveCalls = 0;
  const writes: string[] = [];
  const { tab, data, callbacks } = bufferedSettingsHarness({
    onSave: async () => {
      saveCalls += 1;
      writes.push(data.settings.workspaceSubtitle);
      await gate;
    },
  });
  const original = data.settings.workspaceSubtitle;

  data.settings.workspaceSubtitle = "Pending value";
  tab.scheduleTextSave();
  [...callbacks.values()][0]?.();
  await Promise.resolve();
  assert.equal(tab.pendingSettingsSaves, 1);

  data.settings.workspaceSubtitle = original;
  tab.scheduleTextSave();
  [...callbacks.values()][0]?.();
  await Promise.resolve();
  assert.equal(saveCalls, 2, "the matching baseline still needs a write behind an in-flight attempt");

  release();
  await settleBufferedSettingsSave();
  assert.deepEqual(writes, ["Pending value", original]);
  assert.equal(tab.persistedDataSnapshot.settings.workspaceSubtitle, original);
  assert.equal(tab.pendingSettingsSaves, 0);
});

test("an immediate save(false) absorbs a buffered edit without losing refresh intent", async () => {
  let saves = 0;
  let refreshes = 0;
  const harness = bufferedSettingsHarness({
    onSave: () => { saves += 1; },
    onRefresh: () => { refreshes += 1; },
  });
  harness.data.settings.primaryFolder = "Buffered scope";
  harness.tab.scheduleTextSave(true);
  harness.data.settings.openNoteBehavior = "same-tab";

  assert.equal(await harness.tab.save(false), true);
  assert.equal(harness.callbacks.size, 0);
  assert.equal(saves, 1);
  assert.equal(refreshes, 1);
  assert.equal(harness.tab.settingsRefreshPending, false);
});

test("refresh intent survives while the first settings save is in flight", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let saves = 0;
  let refreshes = 0;
  const { tab, data, callbacks } = bufferedSettingsHarness({
    onSave: async () => { saves += 1; await gate; },
    onRefresh: () => { refreshes += 1; },
  });
  data.settings.primaryFolder = "Changed scope";
  tab.scheduleTextSave(true);
  [...callbacks.values()][0]?.();
  await Promise.resolve();

  data.settings.openNoteBehavior = "same-tab";
  const latestSave = tab.save(false);
  release();
  assert.equal(await latestSave, true);
  await settleBufferedSettingsSave();

  assert.equal(saves, 2);
  assert.equal(refreshes, 1, "the newest successful revision performs the inherited refresh once");
  assert.equal(tab.settingsRefreshPending, false);
});

test("a failed settings refresh remains pending for a later no-op action", async () => {
  let refreshes = 0;
  const harness = bufferedSettingsHarness({
    onRefresh: () => {
      refreshes += 1;
      if (refreshes === 1) throw new Error("simulated refresh failure");
    },
  });
  harness.data.settings.workspaceSubtitle = "Saved before refresh failure";

  assert.equal(await harness.tab.save(true), true);
  assert.equal(harness.tab.settingsRefreshPending, true);
  assert.equal(await harness.tab.save(false), true);
  assert.equal(refreshes, 2);
  assert.equal(harness.tab.settingsRefreshPending, false);
});

test("a stale pre-timer base switch cannot save the prior base draft", async () => {
  Notice.messages.length = 0;
  let saves = 0;
  let updates = 0;
  const harness = bufferedSettingsHarness({
    onSave: () => { saves += 1; },
    onUpdate: () => { updates += 1; },
  });
  harness.data.settings.workspaceSubtitle = "Stale base A draft";
  harness.tab.scheduleTextSave();
  harness.setBase("base-b");
  [...harness.callbacks.values()][0]?.();
  await settleBufferedSettingsSave();

  assert.equal(saves, 0);
  assert.equal(updates, 1);
  assert.equal(Notice.messages.some((message) => message.includes("active knowledge base changed")), true);
});

test("a same-object external generation advance invalidates a buffered settings draft", async () => {
  let saves = 0;
  const harness = bufferedSettingsHarness({ onSave: () => { saves += 1; } });
  harness.data.settings.workspaceSubtitle = "Draft captured before Sync callback";
  harness.tab.scheduleTextSave();
  harness.setExternalGeneration(1);
  [...harness.callbacks.values()][0]?.();
  await settleBufferedSettingsSave();

  assert.equal(saves, 0, "the callback generation guard runs before the same object can be persisted");
});

test("a rejected settings write never rolls back a replacement Sync object", async () => {
  const incoming = migrateData(null);
  incoming.settings.workspaceSubtitle = "Authoritative synced value";
  let harness: ReturnType<typeof bufferedSettingsHarness>;
  harness = bufferedSettingsHarness({
    onSave: () => {
      harness.tab.host.data = incoming;
      harness.setEpoch(2);
      harness.setExternalGeneration(1);
      throw new Error("superseded by Sync");
    },
  });
  harness.data.settings.workspaceSubtitle = "Rejected local value";

  assert.equal(await harness.tab.save(false), false);
  assert.equal(harness.tab.host.data, incoming);
  assert.equal(incoming.settings.workspaceSubtitle, "Authoritative synced value");
  assert.equal(harness.tab.persistedDataSnapshot.settings.workspaceSubtitle, "Authoritative synced value");
});

test("prepareForKnowledgeBaseChange accepts a rejected write after verified compensation", async () => {
  const baseline = migrateData(null).settings.workspaceSubtitle;
  let disk = migrateData(null);
  let saves = 0;
  let compensations = 0;
  const harness = bufferedSettingsHarness({
    onSave: () => {
      saves += 1;
      disk = structuredClone(harness.tab.host.data);
      throw new Error("adapter rejected after replacement");
    },
    onCompensate: () => {
      compensations += 1;
      disk = structuredClone(harness.tab.host.data);
    },
  });
  harness.data.settings.workspaceSubtitle = "Rejected draft";
  harness.tab.scheduleTextSave();

  assert.equal(await harness.tab.prepareForKnowledgeBaseChange(), true);
  assert.equal(saves, 1);
  assert.equal(compensations, 1);
  assert.equal(harness.data.settings.workspaceSubtitle, baseline);
  assert.equal(disk.settings.workspaceSubtitle, baseline, "the partial data.json replacement is compensated");
});

test("a failed settings compensation keeps the lifecycle barrier closed", async () => {
  const harness = bufferedSettingsHarness({
    onSave: () => { throw new Error("ambiguous first write"); },
    onCompensate: () => { throw new Error("ambiguous compensation"); },
  });
  harness.data.settings.workspaceSubtitle = "Uncertain draft";
  harness.tab.scheduleTextSave();

  assert.equal(await harness.tab.prepareForKnowledgeBaseChange(), false);
  assert.equal(harness.tab.host.isDataReadOnly(), true);
  assert.match(harness.tab.host.dataCompatibilityWarning, /read-only/i);
});

test("settings debounce timers migrate between owner windows", async () => {
  let saves = 0;
  const first = settingsTimerWindow();
  const second = settingsTimerWindow();
  const harness = bufferedSettingsHarness({ onSave: () => { saves += 1; } });
  harness.setOwnerWindow(first.window);
  harness.data.settings.workspaceSubtitle = "First window";
  harness.tab.scheduleTextSave();
  assert.equal(first.callbacks.size, 1);

  harness.setOwnerWindow(second.window);
  harness.data.settings.workspaceSubtitle = "Second window";
  harness.tab.scheduleTextSave();
  assert.equal(first.callbacks.size, 0, "the timer is cleared through the window that created it");
  assert.equal(second.callbacks.size, 1);
  [...second.callbacks.values()][0]?.();
  await settleBufferedSettingsSave();
  assert.equal(saves, 1);
  assert.equal(harness.tab.persistedDataSnapshot.settings.workspaceSubtitle, "Second window");
});

test("hiding settings flushes buffered text with its refresh intent", async () => {
  let saves = 0;
  let refreshes = 0;
  const harness = bufferedSettingsHarness({
    onSave: () => { saves += 1; },
    onRefresh: () => { refreshes += 1; },
  });
  harness.data.settings.workspaceSubtitle = "Commit on hide";
  harness.tab.scheduleTextSave(true);

  harness.tab.hide();
  await settleBufferedSettingsSave();
  assert.equal(harness.callbacks.size, 0);
  assert.equal(saves, 1);
  assert.equal(refreshes, 1);
});

test("Library creation profiles are discoverable through Obsidian settings search", () => {
  const data = migrateData(null);
  const library = installLibrary(data);
  const host = {
    app: { vault: {}, metadataCache: {} },
    data,
    dataCompatibilityWarning: "",
    isDataReadOnly: () => false,
    getKnowledgeBases: () => [{ id: "base-a", data }],
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getIndexRecords: () => [],
    getLibraries: (includeArchived = false) => includeArchived || library.archivedAt === null ? [library] : [],
    librarySubjectCount: () => 0,
    getTemplateFiles: () => [],
    getIndexGroups: () => [],
    savePluginData: async () => undefined,
    refreshViews: async () => undefined,
    switchKnowledgeBase: async () => undefined,
    renameKnowledgeBase: async () => undefined,
  };
  const tab = new EntCommandCenterSettingsTab(
    host.app as never,
    host as never,
  );
  const libraries = tab.getSettingDefinitions().find((definition) => (
    "heading" in definition && definition.heading === "Libraries"
  ));
  assert.ok(libraries && "items" in libraries);
  assert.ok(libraries.items.some((item) => "name" in item && item.name === "Library creation profiles"));
});

test("Settings Browse commits a folder selected from a pop-out window input realm", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.proposalFolder = "Old Inbox";
  const folders = [new TFolder("Old Inbox"), new TFolder("New Inbox")];
  let saves = 0;
  const host = {
    app: {
      vault: {
        configDir: ".obsidian",
        getAllLoadedFiles: () => folders,
        getMarkdownFiles: () => [],
      },
      metadataCache: { getFileCache: () => null },
    },
    data,
    dataCompatibilityWarning: "",
    isDataReadOnly: () => false,
    getKnowledgeBases: () => [{ id: "base-a", data }],
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getExternalChangeGeneration: () => 0,
    getIndexRecords: () => [],
    getLibraries: () => [],
    librarySubjectCount: () => 0,
    getTemplateFiles: () => [],
    getIndexGroups: () => [],
    getFollowUpCategories: () => [],
    replaceFollowUpCategories: async () => undefined,
    countOrphanedByPrimaryFolderChange: () => 0,
    countOrphanedByProposalFolderChange: () => 0,
    savePluginData: async () => { saves += 1; },
    saveCompensatingRollback: async () => undefined,
    markPersistenceUncertain: () => undefined,
    refreshViews: async () => undefined,
    switchKnowledgeBase: async () => undefined,
    renameKnowledgeBase: async () => undefined,
  };
  const tab = new EntCommandCenterSettingsTab(host.app as never, host as never);
  tab.update = () => undefined;
  const group = tab.getSettingDefinitions().find((definition) => (
    "heading" in definition && definition.heading === "Note storage and creation"
  ));
  assert.ok(group && "items" in group);
  const definition = group.items.find((item) => "name" in item && item.name === "Inbox folder");
  assert.ok(definition && "render" in definition);

  class PopoutInput {
    value = "Old Inbox";
    dir = "";
    readonly ownerDocument = { defaultView: { HTMLInputElement: PopoutInput } };
    addEventListener(): void {}
    blur(): void {}
    toggleClass(): void {}
  }
  class MainWindowInput {}
  const input = new PopoutInput();
  let browse: (() => void) | null = null;
  const text = {
    inputEl: input,
    setPlaceholder(): typeof text { return this; },
    setValue(value: string): typeof text { input.value = value; return this; },
    setDisabled(): typeof text { return this; },
    onChange(): typeof text { return this; },
  };
  const button = {
    setButtonText(): typeof button { return this; },
    setDisabled(): typeof button { return this; },
    onClick(callback: () => void): typeof button { browse = callback; return this; },
  };
  const row = {
    settingEl: {
      addClass: () => undefined,
      querySelector: () => input,
    },
    setDesc: () => row,
    addText(callback: (component: typeof text) => void): typeof row { callback(text); return this; },
    addButton(callback: (component: typeof button) => void): typeof row { callback(button); return this; },
  };

  const priorInput = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
  const priorPickerOpen = Object.getOwnPropertyDescriptor(StringPickerModal.prototype, "open");
  Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: MainWindowInput });
  StringPickerModal.prototype.open = function choosePopoutFolder(): void {
    void (this as unknown as { onChoose(value: string): void | Promise<void> }).onChoose("New Inbox");
  };
  try {
    definition.render(row as never);
    assert.ok(browse);
    browse();
    await new Promise((resolve) => { globalThis.setTimeout(resolve, 0); });
    assert.equal(input.value, "New Inbox");
    assert.equal(data.settings.proposalFolder, "New Inbox");
    assert.equal(saves, 1);
  } finally {
    if (priorInput) Object.defineProperty(globalThis, "HTMLInputElement", priorInput);
    else Reflect.deleteProperty(globalThis, "HTMLInputElement");
    if (priorPickerOpen) Object.defineProperty(StringPickerModal.prototype, "open", priorPickerOpen);
    else Reflect.deleteProperty(StringPickerModal.prototype, "open");
  }
});

test("attachment text settings use the buffered non-refresh save pipeline", () => {
  const data = migrateData(null);
  const host = {
    app: {
      vault: { configDir: ".obsidian", getAllLoadedFiles: () => [] },
      metadataCache: {},
    },
    data,
    dataCompatibilityWarning: "",
    isDataReadOnly: () => false,
    getKnowledgeBases: () => [{ id: "base-a", data }],
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getExternalChangeGeneration: () => 0,
    getIndexRecords: () => [],
    getLibraries: () => [],
    librarySubjectCount: () => 0,
    getTemplateFiles: () => [],
    getIndexGroups: () => [],
    getFollowUpCategories: () => [],
    replaceFollowUpCategories: async () => undefined,
    savePluginData: async () => undefined,
    saveCompensatingRollback: async () => undefined,
    markPersistenceUncertain: () => undefined,
    refreshViews: async () => undefined,
    switchKnowledgeBase: async () => undefined,
    renameKnowledgeBase: async () => undefined,
  };
  const tab = new EntCommandCenterSettingsTab(host.app as never, host as never);
  const requestedRefreshes: boolean[] = [];
  (tab as unknown as { scheduleTextSave(refresh?: boolean): void }).scheduleTextSave = (refresh = true) => {
    requestedRefreshes.push(refresh);
  };
  const folders = tab.getSettingDefinitions().find((definition) => (
    "heading" in definition && definition.heading === "Note storage and creation"
  ));
  assert.ok(folders && "items" in folders);

  const renderAndChange = (name: string, value: string): void => {
    const definition = folders.items.find((item) => "name" in item && item.name === name);
    assert.ok(definition && "render" in definition);
    let change: ((next: string) => void | Promise<void>) | null = null;
    const inputEl = {
      addEventListener: () => undefined,
      blur: () => undefined,
      toggleClass: () => undefined,
    };
    const text = {
      inputEl,
      setPlaceholder(): typeof text { return this; },
      setValue(): typeof text { return this; },
      setDisabled(): typeof text { return this; },
      onChange(callback: (next: string) => void | Promise<void>): typeof text {
        change = callback;
        return this;
      },
    };
    const button = {
      setButtonText(): typeof button { return this; },
      setDisabled(): typeof button { return this; },
      onClick(): typeof button { return this; },
    };
    definition.render({
      settingEl: { addClass: () => undefined },
      addText(callback: (component: typeof text) => void) { callback(text); return this; },
      addButton(callback: (component: typeof button) => void) { callback(button); return this; },
    } as never);
    assert.ok(change);
    void change(value);
  };

  renderAndChange("Fixed attachment folder", "/Assets/Uploads/");
  renderAndChange("Attachment marker", "  <!-- custom:attachments -->  ");
  renderAndChange("Attachment heading", "### Imported files ###");

  assert.deepEqual(requestedRefreshes, [false, false, false]);
  assert.equal(data.settings.attachmentFolder, "Assets/Uploads");
  assert.equal(data.settings.attachmentMarker, "<!-- custom:attachments -->");
  assert.equal(data.settings.attachmentHeading, "Imported files");
});

test("a rejected direct setting save restores memory and reports the failure", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceSubtitle = "Persisted subtitle";
  let refreshes = 0;
  let updates = 0;
  let compensations = 0;
  const settingsTab = Object.create(EntCommandCenterSettingsTab.prototype) as {
    host: {
      data: typeof data;
      savePluginData(): Promise<void>;
      saveCompensatingRollback(): Promise<void>;
      refreshViews(): Promise<void>;
    };
    persistedDataSnapshot: typeof data;
    settingsSaveRevision: number;
    persistedSettingsRevision: number;
    pendingSettingsSaves: number;
    update(): void;
    save(refresh?: boolean, directDataFields?: Array<"activeTab" | "indexGroupOrder">): Promise<boolean>;
  };
  settingsTab.host = {
    data,
    savePluginData: async () => { throw new Error("Sync reload won the race"); },
    saveCompensatingRollback: async () => { compensations += 1; },
    refreshViews: async () => { refreshes += 1; },
  };
  settingsTab.persistedDataSnapshot = structuredClone(data);
  settingsTab.settingsSaveRevision = 0;
  settingsTab.persistedSettingsRevision = 0;
  settingsTab.pendingSettingsSaves = 0;
  settingsTab.update = () => { updates += 1; };
  data.settings.workspaceSubtitle = "Unsaved subtitle";

  assert.equal(await settingsTab.save(), false);
  assert.equal(data.settings.workspaceSubtitle, "Persisted subtitle");
  assert.equal(refreshes, 1);
  assert.equal(updates, 1);
  assert.equal(compensations, 1);
  assert.equal(Notice.messages.some((message) => message.includes("not saved") && message.includes("Sync reload")), true);
});

test("overlapping direct setting saves roll back to the latest successful attempt", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceSubtitle = "Initial subtitle";
  let releaseFirst: () => void = () => {};
  let rejectSecond: (error: Error) => void = () => {};
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((_resolve, reject) => { rejectSecond = reject; });
  const persisted: PluginData[] = [];
  let saveCalls = 0;
  let compensations = 0;
  const settingsTab = Object.create(EntCommandCenterSettingsTab.prototype) as {
    host: {
      data: typeof data;
      savePluginData(): Promise<void>;
      saveCompensatingRollback(): Promise<void>;
      refreshViews(): Promise<void>;
    };
    persistedDataSnapshot: typeof data;
    settingsSaveRevision: number;
    persistedSettingsRevision: number;
    pendingSettingsSaves: number;
    update(): void;
    save(refresh?: boolean, directDataFields?: Array<"activeTab" | "indexGroupOrder">): Promise<boolean>;
  };
  settingsTab.host = {
    data,
    savePluginData: async () => {
      saveCalls += 1;
      const attempted = structuredClone(data);
      if (saveCalls === 1) {
        await firstGate;
        persisted.push(attempted);
      } else {
        await secondGate;
      }
    },
    saveCompensatingRollback: async () => { compensations += 1; },
    refreshViews: async () => {},
  };
  settingsTab.persistedDataSnapshot = structuredClone(data);
  settingsTab.settingsSaveRevision = 0;
  settingsTab.persistedSettingsRevision = 0;
  settingsTab.pendingSettingsSaves = 0;
  settingsTab.update = () => {};

  data.settings.workspaceSubtitle = "First edit";
  const firstSave = settingsTab.save(false);
  data.settings.workspaceSubtitle = "Second edit";
  const secondSave = settingsTab.save(false);
  releaseFirst();
  assert.equal(await firstSave, true);
  rejectSecond(new Error("second adapter write failed"));
  assert.equal(await secondSave, false);

  assert.equal(persisted[0]?.settings.workspaceSubtitle, "First edit");
  assert.equal(data.settings.workspaceSubtitle, "First edit", "memory follows the newest successful disk snapshot");
  assert.equal(settingsTab.persistedDataSnapshot.settings.workspaceSubtitle, "First edit");
  assert.equal(settingsTab.pendingSettingsSaves, 0);
  assert.equal(compensations, 1);
});

test("a failed setting save preserves concurrent organization and newer view changes", async () => {
  const data = migrateData(null);
  data.settings.workspaceSubtitle = "Persisted subtitle";
  let rejectSave: (error: Error) => void = () => {};
  const saveGate = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
  let compensations = 0;
  const settingsTab = Object.create(EntCommandCenterSettingsTab.prototype) as {
    host: {
      data: typeof data;
      savePluginData(): Promise<void>;
      saveCompensatingRollback(): Promise<void>;
      refreshViews(): Promise<void>;
    };
    persistedDataSnapshot: typeof data;
    settingsSaveRevision: number;
    persistedSettingsRevision: number;
    pendingSettingsSaves: number;
    update(): void;
    save(refresh?: boolean, directDataFields?: Array<"activeTab" | "indexGroupOrder">): Promise<boolean>;
  };
  settingsTab.host = {
    data,
    savePluginData: async () => { await saveGate; },
    saveCompensatingRollback: async () => { compensations += 1; },
    refreshViews: async () => {},
  };
  settingsTab.persistedDataSnapshot = structuredClone(data);
  settingsTab.settingsSaveRevision = 0;
  settingsTab.persistedSettingsRevision = 0;
  settingsTab.pendingSettingsSaves = 0;
  settingsTab.update = () => {};

  data.settings.workspaceSubtitle = "Rejected subtitle";
  data.settings.defaultTab = "queues";
  data.activeTab = "queues";
  data.settings.allowClinicalVisualGroupMoves = true;
  data.indexGroupOrder = ["Attempted default group"];
  const pending = settingsTab.save(false, ["activeTab", "indexGroupOrder"]);

  // A separate organization/view action commits while the settings adapter
  // request is pending. Its fields were not part of the attempted settings
  // delta (or have since changed again) and must survive the rollback.
  data.pinnedPaths = ["Concurrent organization.md"];
  data.selectedPath = "Concurrent selection.md";
  data.indexGroupOrder = ["Concurrent group"];
  rejectSave(new Error("settings adapter failed"));

  assert.equal(await pending, false);
  assert.equal(data.settings.workspaceSubtitle, "Persisted subtitle");
  assert.equal(data.settings.defaultTab, "curriculum");
  assert.equal(data.activeTab, "curriculum");
  assert.equal(data.settings.allowClinicalVisualGroupMoves, false);
  assert.deepEqual(data.pinnedPaths, ["Concurrent organization.md"]);
  assert.equal(data.selectedPath, "Concurrent selection.md");
  assert.deepEqual(data.indexGroupOrder, ["Concurrent group"]);
  assert.equal(compensations, 1);
});

test("a create-note form cannot submit into a different active knowledge base", async () => {
  Notice.messages.length = 0;
  let activeBaseId = "base-a";
  let createCalls = 0;
  let submit: ((value: {
    title: string;
    folder: string;
    mode: "empty";
    templatePath: string;
    addToCollection: boolean;
  }) => void | Promise<void>) | null = null;
  const plugin = {
    data: {
      settings: {
        itemSingular: "note",
        indexLabel: "Index",
        defaultNoteFolder: "Notes",
        defaultNewNoteMode: "empty" as const,
        defaultTemplatePath: "",
      },
    },
    getActiveKnowledgeBaseId: () => activeBaseId,
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    getTemplateFiles: () => [],
    validateGenericNote: () => null,
    async createKnowledgeNote(): Promise<never> {
      createCalls += 1;
      throw new Error("must not run");
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startCreateKnowledgeNote(): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;

  KnowledgeNoteModal.prototype.open = function openForTest(): void {
    submit = (this as unknown as { options: { onSubmit: typeof submit } }).options.onSubmit;
  };
  try {
    view.startCreateKnowledgeNote();
    activeBaseId = "base-b";
    await submit?.({ title: "Stale", folder: "Notes", mode: "empty", templatePath: "", addToCollection: false });
  } finally {
    delete (KnowledgeNoteModal.prototype as { open?: () => void }).open;
  }

  assert.equal(createCalls, 0);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("an export failure after a base switch never rolls the old registry into the new base", async () => {
  Notice.messages.length = 0;
  const oldData = migrateData(null);
  oldData.settings.workspaceName = "Base A";
  const newData = migrateData(null);
  newData.settings.workspaceName = "Base B";
  newData.portableIndex.groups = [{ id: "base-b-group", title: "Base B heading", order: 0 }];
  const newRegistryBefore = structuredClone(newData.portableIndex);
  let activeBaseId = "base-a";
  let saveCalls = 0;
  const plugin = {
    data: oldData,
    getActiveKnowledgeBaseId: () => activeBaseId,
    isDataReadOnly: () => false,
    getRecords: (): VaultRecord[] => [],
    invalidateRecordCache(): void {},
    async savePluginData(): Promise<void> {
      saveCalls += 1;
      activeBaseId = "base-b";
      this.data = newData;
      throw new Error("forced export save failure");
    },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: typeof plugin;
    exportSelection: typeof EMPTY_PORTABLE_SELECTION;
    exportRecoveryConfirmed: boolean;
    dataChanged: boolean;
    openedBaseId: string;
    staleBaseNoticeShown: boolean;
    centerOpen: boolean;
    close(): void;
    exportSelected(): Promise<void>;
  };
  center.plugin = plugin;
  center.exportSelection = { ...EMPTY_PORTABLE_SELECTION, index: true };
  center.exportRecoveryConfirmed = false;
  center.dataChanged = false;
  center.openedBaseId = "base-a";
  center.staleBaseNoticeShown = false;
  center.centerOpen = true;
  center.close = () => { center.centerOpen = false; };

  await center.exportSelected();

  assert.equal(saveCalls, 1, "no rollback save is attempted against the newly active base");
  assert.deepEqual(newData.portableIndex, newRegistryBefore);
  assert.equal(center.centerOpen, false);
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length, 1);
});

test("recovery export cannot run without the exact-path confirmation", async () => {
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { isDataReadOnly(): boolean };
    exportSelection: typeof EMPTY_PORTABLE_SELECTION;
    exportRecoveryConfirmed: boolean;
    exportSelected(): Promise<void>;
  };
  center.plugin = { isDataReadOnly: () => false };
  center.exportSelection = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
  center.exportRecoveryConfirmed = false;
  await assert.rejects(center.exportSelected(), /exact private vault paths/i);
});

test("compatibility read-only mode blocks recovery export and import", async () => {
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: { isDataReadOnly(): boolean };
    exportSelection: typeof EMPTY_PORTABLE_SELECTION;
    exportRecoveryConfirmed: boolean;
    exportSelected(): Promise<void>;
    importSelected(): Promise<void>;
  };
  center.plugin = { isDataReadOnly: () => true };
  center.exportSelection = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
  center.exportRecoveryConfirmed = true;

  await assert.rejects(center.exportSelected(), /recovery is unavailable.*read-only/i);
  await assert.rejects(center.importSelected(), /import is unavailable.*read-only/i);
});

test("portability center rejects an indexed non-topic ENT package before mutate starts", async () => {
  const source = migrateData(null);
  const sourceRecord = record("Knowledge Base/Imported reference.md", "Imported reference");
  const value = createPortableExport(
    source,
    [sourceRecord],
    { ...EMPTY_PORTABLE_SELECTION, index: true },
    "2026-08-09T00:00:00.000Z",
  );
  const incomingSubject = value.components.index?.subjects[0];
  assert.ok(incomingSubject);
  incomingSubject.recordKind = "note";
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  const before = structuredClone(data);
  let mutateCalls = 0;
  const plugin = {
    data,
    isDataReadOnly: () => false,
    async mutate(): Promise<void> { mutateCalls += 1; },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    importSelected(): Promise<void>;
  };
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, index: true };
  center.importMode = "merge";
  center.recoveryConfirmed = false;

  await assert.rejects(center.importSelected(), /ENT knowledge index accepts topic subjects only/i);
  assert.equal(mutateCalls, 0);
  assert.deepEqual(plugin.data, before);
});

test("missing imported workspace folders are named without blocking or falling back", () => {
  const existing = new Set(["Knowledge Base", "Inbox"]);
  const folderExists = (path: string): boolean => existing.has(path);
  const incoming = { primaryFolder: "KB", proposalFolder: "Triage" };

  assert.equal(
    missingImportedFolderNoticeText(incoming, "generic", folderExists),
    " The imported folder grouping root “KB” does not exist in this vault yet, so folder-based group fallbacks will remain unavailable until it is created or the setting is changed. Index membership is unchanged."
      + " The imported Inbox folder “Triage” does not exist in this vault yet, so the Inbox will be empty until it is created or the setting is changed.",
  );
  assert.equal(
    missingImportedFolderNoticeText({ primaryFolder: "Knowledge Base", proposalFolder: "Inbox" }, "generic", folderExists),
    "",
    "existing folders add nothing to the notice",
  );
  assert.equal(
    missingImportedFolderNoticeText(incoming, "ent-clinical", folderExists),
    " The imported Inbox folder “Triage” does not exist in this vault yet, so the Inbox will be empty until it is created or the setting is changed.",
    "an ent-clinical destination keeps its own primary folder, so only the Inbox is named",
  );
  assert.equal(
    missingImportedFolderNoticeText({ primaryFolder: "", proposalFolder: "Inbox" }, "generic", folderExists),
    "",
    "the empty primary folder means the vault root, which always exists",
  );
});

test("workspace import completion notice names imported folders missing from this vault", async () => {
  Notice.messages.length = 0;
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.settings.primaryFolder = "KB";
  source.settings.proposalFolder = "Triage";
  const value = parsePortableExport(createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-13T00:00:00.000Z",
  ));
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = {
    data,
    isDataReadOnly: () => false,
    async mutate(_name: string, action: () => void): Promise<void> { action(); },
    invalidateRecordCache: (): void => {},
    assertClinicalIndexEligibility: (): void => {},
    getRecords: (): VaultRecord[] => [],
  };
  const vaultFolder = new TFolder("Knowledge Base");
  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: { vault: { configDir: string; getAbstractFileByPath(path: string): unknown } };
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    dataChanged: boolean;
    openedBaseId: string;
    centerOpen: boolean;
    close(): void;
    importSelected(): Promise<void>;
  };
  center.app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === "Knowledge Base" ? vaultFolder : null,
    },
  };
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.dataChanged = false;
  center.openedBaseId = "";
  center.centerOpen = true;
  center.close = () => { center.centerOpen = false; };

  await center.importSelected();

  assert.equal(data.settings.primaryFolder, "KB", "the imported value is applied, not silently replaced");
  assert.equal(data.settings.proposalFolder, "Triage");
  const notice = Notice.messages.find((message) => message.startsWith("Import complete."));
  assert.ok(notice);
  assert.ok(notice.includes("The imported folder grouping root “KB” does not exist in this vault yet, so folder-based group fallbacks will remain unavailable until it is created or the setting is changed. Index membership is unchanged."));
  assert.ok(notice.includes("The imported Inbox folder “Triage” does not exist in this vault yet, so the Inbox will be empty until it is created or the setting is changed."));
  assert.match(notice, /Markdown notes were not changed\.$/u);
});

test("setup wizard hints inline when a typed folder does not exist yet", () => {
  const folderExists = (path: string): boolean => path === "Knowledge Base";
  assert.equal(
    missingSetupFolderHint("Knowledg Base", "existing notes will not be indexed", folderExists),
    "“Knowledg Base” does not exist yet — it will be created empty. Existing notes will not be indexed.",
  );
  assert.equal(
    missingSetupFolderHint("Triage", "existing notes will not appear in the Inbox", folderExists),
    "“Triage” does not exist yet — it will be created empty. Existing notes will not appear in the Inbox.",
  );
  assert.equal(missingSetupFolderHint("Knowledge Base", "existing notes will not be indexed", folderExists), null, "an existing folder needs no hint");
  assert.equal(missingSetupFolderHint(" /Knowledge Base/ ", "existing notes will not be indexed", folderExists), null, "the hint trims the way submit does");
  assert.equal(missingSetupFolderHint("   ", "existing notes will not be indexed", folderExists), null, "emptiness is the submit validator's concern, not the hint's");
});

test("setup wizard requires an Inbox folder with the Settings tab's message", async () => {
  const submitted: WorkspaceSetupValue[] = [];
  let errorText = "";
  const modal = Object.create(WorkspaceSetupModal.prototype) as {
    value: WorkspaceSetupValue;
    errorEl: { setText(text: string): void } | null;
    onSubmit(value: WorkspaceSetupValue): void;
    closed: boolean;
    close(): void;
    submit(): Promise<void>;
  };
  modal.value = {
    workspaceName: "My Knowledge Base",
    workspaceSubtitle: "",
    indexLabel: "Knowledge Index",
    itemSingular: "note",
    itemPlural: "notes",
    groupLabel: "Group",
    primaryFolder: "Knowledge Base",
    proposalFolder: " / ",
    inboxLabel: "Inbox",
    defaultNoteFolder: "Knowledge Base",
    idProperty: "id",
    groupProperty: "category",
    parentProperty: "parent",
    templatesFolder: "",
    defaultNewNoteMode: "empty",
    exportsFolder: DEFAULT_EXPORTS_FOLDER,
    defaultTemplatePath: "",
  };
  modal.errorEl = { setText: (text: string) => { errorText = text; } };
  modal.onSubmit = (value) => { submitted.push(value); };
  modal.closed = false;
  modal.close = () => { modal.closed = true; };

  await modal.submit();
  assert.equal(errorText, "Choose an Inbox folder. Without one, notes aimed at the Inbox would not appear anywhere in this plugin.");
  assert.equal(submitted.length, 0, "an empty Inbox folder never reaches onSubmit");
  assert.equal(modal.closed, false);

  modal.value.proposalFolder = "Inbox";
  await modal.submit();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]?.proposalFolder, "Inbox");
  assert.equal(modal.closed, true);
});

test("portability center rejects cross-vault recovery before mutate starts", async () => {
  const source = migrateData(null);
  source.collections = [{ id: "ent", title: "ENT", collapsed: false, subjects: ["03 Clinical Topics/Larynx.md"], subheadings: [] }];
  const value = createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, recovery: true },
    "2026-08-08T00:00:00.000Z",
    "vault-ent-main-vault",
    "base-ent",
    "ENT",
  );
  const data = migrateData(null);
  data.collections = [{ id: "local", title: "Local", collapsed: false, subjects: [], subheadings: [] }];
  const before = structuredClone(data);
  let mutateCalls = 0;
  const plugin = {
    data,
    isDataReadOnly: () => false,
    getVaultId: () => "vault-my-main-note-kb",
    getActiveKnowledgeBaseId: () => "base-main",
    async mutate(): Promise<void> { mutateCalls += 1; },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    importSelected(): Promise<void>;
  };
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
  center.importMode = "replace";
  center.recoveryConfirmed = true;

  await assert.rejects(center.importSelected(), /different Obsidian vault/i);
  assert.equal(mutateCalls, 0);
  assert.deepEqual(plugin.data, before);
});

test("portability center requires the separate cross-base override before mutate starts", async () => {
  const source = migrateData(null);
  source.settings.workspaceName = "ENT";
  const value = createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, recovery: true },
    "2026-08-08T00:00:00.000Z",
    "vault-shared",
    "base-ent",
    "ENT",
  );
  const data = migrateData(null);
  data.settings.workspaceName = "Research";
  const before = structuredClone(data);
  let mutateCalls = 0;
  const plugin = {
    data,
    isDataReadOnly: () => false,
    getVaultId: () => "vault-shared",
    getActiveKnowledgeBaseId: () => "base-research",
    async mutate(): Promise<void> { mutateCalls += 1; },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    importSelected(): Promise<void>;
  };
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
  center.importMode = "replace";
  center.recoveryConfirmed = true;
  center.crossBaseRecoveryConfirmed = false;

  await assert.rejects(center.importSelected(), /different or unverified source knowledge base/i);
  assert.equal(mutateCalls, 0);
  assert.deepEqual(plugin.data, before);
});

test("direct organization recovery refuses to apply when safe Undo cannot be guaranteed", async () => {
  const data = migrateData(null);
  data.settings.workspaceName = "ENT";
  const backup = createPersonalBackup(
    data,
    "2026-08-08T00:00:00.000Z",
    "vault-shared",
    "base-ent",
    "ENT",
  );
  let mutateOptions: { requireUndo?: boolean } | null = null;
  const plugin = {
    data,
    getVaultId: () => "vault-shared",
    getActiveKnowledgeBaseId: () => "base-ent",
    async mutate(
      _label: string,
      _action: () => void,
      options: { requireUndo?: boolean },
    ): Promise<void> {
      mutateOptions = options;
      if (options.requireUndo) throw new Error("simulated Undo budget refusal");
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: { vault: { getAbstractFileByPath(path: string): null } };
    plugin: typeof plugin;
    confirmOrganizationImport(input: Promise<unknown>, ownsBase: () => boolean): void;
  };
  view.app = { vault: { getAbstractFileByPath: () => null } };
  view.plugin = plugin;
  const opened: Array<{ onConfirm(): void | Promise<void> }> = [];
  const hadOwnOpen = Object.prototype.hasOwnProperty.call(ConfirmModal.prototype, "open");
  const originalOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureConfirm(): void {
    opened.push(this);
  };
  try {
    view.confirmOrganizationImport(Promise.resolve(backup), () => true);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(opened.length, 1, "an exact-base recovery proceeds directly to the final confirmation");
    await assert.rejects(Promise.resolve(opened[0]?.onConfirm()), /Undo budget refusal/i);
    assert.equal(mutateOptions?.requireUndo, true);
  } finally {
    if (hadOwnOpen && originalOpen) Object.defineProperty(ConfirmModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }
});

test("standalone v10 recovery preserves linked sources and repairs portable membership in saved snapshots", async () => {
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.settings.workspaceName = "Research";
  source.portableIndex.groups = [{ id: "top-group", title: "Top", order: 0 }];
  source.portableIndex.subjects = [{ id: "top", title: "Top", groupId: "top-group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }];
  source.portableIndex.resolvedPathBySubjectId = { top: "Outside/Top.md" };
  source.directIndexPaths = [];
  const snapshotData = migrateData(null);
  snapshotData.settings.workspaceMode = "generic";
  snapshotData.settings.primaryFolder = "Saved Root";
  snapshotData.portableIndex.groups = [{ id: "saved-group", title: "Saved", order: 0 }];
  snapshotData.portableIndex.subjects = [{ id: "saved", title: "Saved", groupId: "saved-group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }];
  snapshotData.portableIndex.resolvedPathBySubjectId = { saved: "Outside/Saved.md" };
  source.layoutSnapshots = [snapshotPersonal(snapshotData, "Saved", true, true)];
  const raw = structuredClone(createPersonalBackup(
    source,
    "2026-08-08T00:00:00.000Z",
    "vault-shared",
    "base-research",
    "Research",
  )) as unknown as Record<string, unknown>;
  raw.version = 10;
  delete raw.indexFolderSourcesIncluded;
  delete raw.indexFolderSources;
  raw.directIndexPaths = [];
  const rawSnapshot = (raw.layoutSnapshots as Array<Record<string, unknown>>)[0];
  delete rawSnapshot.indexFolderSources;
  rawSnapshot.directIndexPaths = [];

  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.workspaceName = "Research";
  data.indexFolderSources = [{ id: "destination", path: "Destination", origin: "user" }];
  const plugin = {
    data,
    getVaultId: () => "vault-shared",
    getActiveKnowledgeBaseId: () => "base-research",
    async mutate(_label: string, action: () => void): Promise<void> { action(); },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: { vault: { getAbstractFileByPath(path: string): null } };
    plugin: typeof plugin;
    confirmOrganizationImport(input: Promise<unknown>, ownsBase: () => boolean): void;
  };
  view.app = { vault: { getAbstractFileByPath: () => null } };
  view.plugin = plugin;
  const opened: Array<{ onConfirm(): void | Promise<void> }> = [];
  const originalOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureConfirm(): void { opened.push(this); };
  try {
    view.confirmOrganizationImport(Promise.resolve(raw), () => true);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(opened.length, 1);
    await opened[0]?.onConfirm();
  } finally {
    if (originalOpen) Object.defineProperty(ConfirmModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }

  assert.deepEqual(data.indexFolderSources.map((sourceEntry) => sourceEntry.path), ["Destination"]);
  assert.deepEqual(data.directIndexPaths, ["Outside/Top.md"]);
  assert.deepEqual(data.layoutSnapshots[0]?.indexFolderSources.map((sourceEntry) => sourceEntry.path), ["Saved Root"]);
  assert.deepEqual(data.layoutSnapshots[0]?.directIndexPaths, ["Outside/Saved.md"]);
});

test("template fallback stays transactional and does not mutate the selected import package", async () => {
  const data = migrateData(null);
  data.settings.defaultNewNoteMode = "template";
  data.settings.templatesFolder = "Templates";
  data.settings.defaultTemplatePath = "Templates/Missing.md";
  const library = installLibrary(data);
  const restrictedLibrary = installLibrary(data, customLibrary("restricted-reference", "Restricted reference", "Reference", 1));
  data.settings.libraryNoteProfiles[library.id] = {
    folder: "Reference notes",
    mode: "template",
    templatePath: "Templates/Missing Reference.md",
  };
  data.settings.libraryNoteProfiles[restrictedLibrary.id] = {
    folder: "Restricted reference notes",
    mode: "empty",
    templatePath: "Outside Templates/Private.md",
  };
  const rawValue = createPortableExport(
    data,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-08T00:00:00.000Z",
  );
  const rawWorkspace = rawValue.components.workspace;
  assert.ok(rawWorkspace);
  rawWorkspace.settings.libraryNoteProfiles[library.id] = {
    folder: "Reference notes",
    mode: "template",
    templatePath: "../Templates/Missing Reference.md",
  };
  rawWorkspace.settings.libraryNoteProfiles[restrictedLibrary.id] = {
    folder: "Restricted reference notes",
    mode: "empty",
    templatePath: "05 Sources/Private.md",
  };
  const value = parsePortableExport(rawValue);
  const originalPackage = structuredClone(value);
  const localData = migrateData(null);
  const originalLocalData = structuredClone(localData);
  let fallbackObservedInsideMutation = false;
  let libraryFallbackObservedInsideMutation = false;
  let restrictedFallbackObservedInsideMutation = false;
  const plugin = {
    data: localData,
    isDataReadOnly(): boolean { return false; },
    async mutate(_label: string, action: () => void): Promise<void> {
      const before = structuredClone(this.data);
      action();
      fallbackObservedInsideMutation = this.data.settings.defaultNewNoteMode === "empty"
        && this.data.settings.defaultTemplatePath === "";
      libraryFallbackObservedInsideMutation = this.data.settings.libraryNoteProfiles[library.id]?.mode === "empty"
        && this.data.settings.libraryNoteProfiles[library.id]?.templatePath === undefined
        && this.data.settings.libraryNoteProfiles[library.id]?.folder === "Reference notes";
      restrictedFallbackObservedInsideMutation = this.data.settings.libraryNoteProfiles[restrictedLibrary.id]?.mode === "empty"
        && this.data.settings.libraryNoteProfiles[restrictedLibrary.id]?.templatePath === undefined
        && this.data.settings.libraryNoteProfiles[restrictedLibrary.id]?.folder === "Restricted reference notes";
      this.data = before;
      throw new Error("simulated save failure");
    },
    invalidateRecordCache(): void {},
    assertClinicalIndexEligibility(): void {},
    getRecords(): VaultRecord[] { return []; },
  };
  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: { vault: { configDir: string; getAbstractFileByPath(path: string): null } };
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    dataChanged: boolean;
    importSelected(): Promise<void>;
  };
  center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.dataChanged = false;

  await assert.rejects(center.importSelected(), /simulated save failure/);
  assert.equal(fallbackObservedInsideMutation, true);
  assert.equal(libraryFallbackObservedInsideMutation, true);
  assert.equal(restrictedFallbackObservedInsideMutation, true);
  assert.deepEqual(value, originalPackage);
  assert.deepEqual(plugin.data, originalLocalData);
});

test("portable workspace preflight still rejects an invalid Library profile folder", () => {
  const data = migrateData(null);
  const library = installLibrary(data);
  data.settings.libraryNoteProfiles[library.id] = { folder: "Safe notes", mode: "empty" };
  const rawValue = createPortableExport(
    data,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-11T00:00:00.000Z",
  );
  const workspace = rawValue.components.workspace;
  assert.ok(workspace);
  workspace.settings.libraryNoteProfiles[library.id] = {
    folder: "../Private",
    mode: "empty",
  };
  const value = parsePortableExport(rawValue);
  assert.equal(value.components.workspace?.settings.libraryNoteProfiles[library.id]?.folder, "../Private");
  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: { vault: { configDir: string; getAbstractFileByPath(path: string): null } };
    plugin: { data: typeof data };
    validateWorkspaceComponent(
      input: typeof value,
      selection: typeof EMPTY_PORTABLE_SELECTION,
    ): unknown;
  };
  center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  center.plugin = { data: migrateData(null) };

  assert.throws(() => center.validateWorkspaceComponent(
    value,
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
  ));
});

test("workspace import preflight rejects an unsafe fixed attachment folder", () => {
  const data = migrateData(null);
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Safe attachments";
  const rawValue = createPortableExport(
    data,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-12T00:00:00.000Z",
  );
  assert.ok(rawValue.components.workspace);
  rawValue.components.workspace.settings.attachmentFolder = "../Outside";
  const value = parsePortableExport(rawValue);
  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: { vault: { configDir: string; getAbstractFileByPath(path: string): null } };
    plugin: { data: typeof data };
    validateWorkspaceComponent(input: typeof value, selection: typeof EMPTY_PORTABLE_SELECTION): unknown;
  };
  center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  center.plugin = { data: migrateData(null) };

  assert.throws(
    () => center.validateWorkspaceComponent(value, { ...EMPTY_PORTABLE_SELECTION, workspace: true }),
    /\.\./u,
  );
});

test("workspace import preflight rejects every restricted exports folder class", () => {
  for (const exportsFolder of ["../Outside", ".obsidian/Private exports", ".trash/Rescues"]) {
    const data = migrateData(null);
    const rawValue = createPortableExport(
      data,
      [],
      { ...EMPTY_PORTABLE_SELECTION, workspace: true },
      "2026-08-14T00:00:00.000Z",
    );
    assert.ok(rawValue.components.workspace);
    rawValue.components.workspace.settings.exportsFolder = exportsFolder;
    const value = parsePortableExport(rawValue);
    const center = Object.create(ExportImportCenterModal.prototype) as {
      app: { vault: { configDir: string; getAbstractFileByPath(path: string): null } };
      plugin: { data: typeof data };
      validateWorkspaceComponent(input: typeof value, selection: typeof EMPTY_PORTABLE_SELECTION): unknown;
    };
    center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
    center.plugin = { data: migrateData(null) };

    assert.throws(
      () => center.validateWorkspaceComponent(value, { ...EMPTY_PORTABLE_SELECTION, workspace: true }),
      /cannot/iu,
      exportsFolder,
    );
  }
});

test("portable-v4 preflight retains and atomically resets every unsafe Library template class", () => {
  const data = migrateData(null);
  data.settings.templatesFolder = "Templates";
  const cases = [
    ["parent-template", "../Templates/Private.md"],
    ["config-template", ".obsidian/Private.md"],
    ["immutable-template", "05 Sources/Private.md"],
    ["outside-template", "Other Templates/Private.md"],
  ] as const;
  for (const [libraryId] of cases) {
    const library = installLibrary(data, customLibrary(libraryId, libraryId, "Item", data.portableIndex.libraries.length));
    data.settings.libraryNoteProfiles[library.id] = { mode: "empty", templatePath: "Templates/Valid.md" };
  }
  const rawValue = createPortableExport(
    data,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-11T00:00:00.000Z",
  );
  const workspace = rawValue.components.workspace;
  assert.ok(workspace);
  for (const [libraryId, templatePath] of cases) {
    workspace.settings.libraryNoteProfiles[libraryId] = { mode: "empty", templatePath };
  }
  const value = parsePortableExport(rawValue);
  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: { vault: { configDir: string; getAbstractFileByPath(path: string): null } };
    plugin: { data: typeof data };
    validateWorkspaceComponent(
      input: typeof value,
      selection: typeof EMPTY_PORTABLE_SELECTION,
    ): { libraryTemplateResetIds: string[] };
  };
  center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  center.plugin = { data: migrateData(null) };

  const validation = center.validateWorkspaceComponent(
    value,
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
  );
  assert.deepEqual(new Set(validation.libraryTemplateResetIds), new Set(cases.map(([libraryId]) => libraryId)));
  for (const [libraryId, templatePath] of cases) {
    assert.equal(value.components.workspace?.settings.libraryNoteProfiles[libraryId]?.templatePath, templatePath);
  }
});

test("workspace-only export omits archived Library profiles and descriptors so import cannot reactivate them", () => {
  const source = migrateData(null);
  const active = installLibrary(source, customLibrary("active-library", "Active", "Active item", 0));
  const archived = installLibrary(source, customLibrary("archived-library", "Archived", "Archived item", 1, Date.now()));
  source.settings.libraryNoteProfiles[active.id] = { mode: "empty", folder: "Active" };
  source.settings.libraryNoteProfiles[archived.id] = { mode: "empty", folder: "Archived" };

  const value = parsePortableExport(createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-11T00:00:00.000Z",
  ));

  assert.deepEqual(Object.keys(value.components.workspace?.settings.libraryNoteProfiles ?? {}), [active.id]);
  assert.deepEqual(value.components.index?.libraries?.map((library) => library.id), [active.id]);
  const destination = migrateData(null);
  applyPortableExport(
    destination,
    value,
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "merge",
  );
  assert.equal(destination.portableIndex.libraries.some((library) => library.id === archived.id), false);
  assert.equal(destination.settings.libraryNoteProfiles[archived.id], undefined);
});

test("Index Manager refreshes stale state after a child portability mutation", () => {
  let renders = 0;
  let title = "";
  const manager = Object.create(IndexManagerModal.prototype) as {
    managerOpen: boolean;
    searchTimer: number | null;
    query: string;
    selected: Set<string>;
    diagnosticsCache: unknown[] | null;
    tab: "indexed" | "available" | "hidden" | "groups" | "diagnostics";
    plugin: { isClinicalMode(): boolean; data: { settings: { indexLabel: string } } };
    titleEl: { setText(value: string): void };
    render(): void;
    refreshAfterPortability(dataChanged: boolean): void;
  };
  manager.managerOpen = true;
  manager.searchTimer = null;
  manager.query = "stale";
  manager.selected = new Set(["Old.md"]);
  manager.diagnosticsCache = [{}];
  manager.tab = "available";
  manager.plugin = {
    isClinicalMode: () => true,
    data: { settings: { indexLabel: "Clinical Index" } },
  };
  manager.titleEl = { setText: (value) => { title = value; } };
  manager.render = () => { renders += 1; };

  manager.refreshAfterPortability(true);
  assert.equal(manager.query, "");
  assert.equal(manager.selected.size, 0);
  assert.equal(manager.diagnosticsCache, null);
  assert.equal(manager.tab, "indexed");
  assert.equal(title, "Manage Clinical Index");
  assert.equal(renders, 1);

  manager.managerOpen = false;
  manager.refreshAfterPortability(true);
  assert.equal(renders, 1, "a closed parent modal is never re-rendered");
});

test("bulk collection actions use current global search text during the render debounce", () => {
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    query: string;
    parsedQuery: ReturnType<typeof parseQuery>;
    records: VaultRecord[];
    plugin: { data: { activeTab: string } };
    matchingRecordsForCurrentView(): VaultRecord[];
  };
  view.query = "beta";
  view.parsedQuery = parseQuery("alpha");
  view.records = [record("KB/alpha.md", "Alpha"), record("KB/beta.md", "Beta")];
  view.plugin = { data: { activeTab: "curriculum" } };

  assert.deepEqual(view.matchingRecordsForCurrentView().map((item) => item.title), ["Beta"]);
});

test("closing the view waits for a pending selection save", async () => {
  let finishSave: (() => void) | null = null;
  let saveFinished = false;
  const saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
  const cleared: number[] = [];
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    setupTimer: number | null;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    selectionSavePromise: Promise<void> | null;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    timerWindow: { clearTimeout(timer: number): void };
    plugin: {
      saveViewState(): Promise<void>;
      getActiveKnowledgeBaseId(): string;
      getDataEpoch(): number;
    };
    onClose(): Promise<void>;
  };
  view.setupTimer = 1;
  view.searchDebounce = 2;
  view.selectionSaveTimer = 3;
  view.selectionSavePromise = null;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.timerWindow = { clearTimeout: (timer) => { cleared.push(timer); } };
  view.plugin = {
    saveViewState: async () => {
      await saveGate;
      saveFinished = true;
    },
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
  };

  const closing = view.onClose();
  await Promise.resolve();
  assert.equal(saveFinished, false);
  finishSave?.();
  await closing;

  assert.equal(saveFinished, true);
  assert.deepEqual(cleared, [1, 2, 3]);
  assert.equal(view.selectionSaveTimer, null);
});

test("closing the view also waits for a selection save already in flight", async () => {
  let finishSave: (() => void) | null = null;
  let closeFinished = false;
  const inFlight = new Promise<void>((resolve) => { finishSave = resolve; });
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    setupTimer: number | null;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    selectionSavePromise: Promise<void> | null;
    timerWindow: { clearTimeout(timer: number): void };
    plugin: { saveViewState(): Promise<void> };
    onClose(): Promise<void>;
  };
  view.setupTimer = null;
  view.searchDebounce = null;
  view.selectionSaveTimer = null;
  view.selectionSavePromise = inFlight;
  view.timerWindow = { clearTimeout: () => {} };
  view.plugin = { saveViewState: () => Promise.resolve() };

  const closing = view.onClose().then(() => { closeFinished = true; });
  await Promise.resolve();
  assert.equal(closeFinished, false);
  finishSave?.();
  await closing;
  assert.equal(closeFinished, true);
});

test("closing the compact record inspector hides it and restores row focus", () => {
  let focusCount = 0;
  let renderCount = 0;
  const selected = { focus: (_options?: FocusOptions) => { focusCount += 1; } };
  const workspace = { scrollTop: 0 };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    mobileInspectorNeedsFocus: boolean;
    mobileTreeScrollTop: number;
    workspaceEl: typeof workspace;
    treeEl: { querySelector(): typeof selected; focus(options?: FocusOptions): void };
    timerWindow: { setTimeout(callback: () => void): number };
    render(): void;
    closeMobileInspector(): void;
  };
  view.mobileInspectorOpen = true;
  view.mobileInspectorNeedsFocus = true;
  view.mobileTreeScrollTop = 73;
  view.workspaceEl = workspace;
  view.treeEl = { querySelector: () => selected, focus: () => { focusCount += 1; } };
  view.render = () => { renderCount += 1; };
  view.timerWindow = { setTimeout: (callback) => { callback(); return 1; } };

  view.closeMobileInspector();

  assert.equal(view.mobileInspectorOpen, false);
  assert.equal(view.mobileInspectorNeedsFocus, false);
  assert.equal(renderCount, 1);
  assert.equal(workspace.scrollTop, 73);
  assert.equal(focusCount, 1);
});

test("zero-delay inspector restoration does not touch a view closed before the callback", () => {
  let callback: (() => void) | null = null;
  let focusCount = 0;
  const workspace = { scrollTop: 0 };
  const selected = { focus: () => { focusCount += 1; } };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    mobileInspectorNeedsFocus: boolean;
    mobileTreeScrollTop: number;
    viewClosed: boolean;
    workspaceEl: typeof workspace;
    treeEl: { querySelector(): typeof selected; focus(): void };
    timerWindow: { setTimeout(scheduled: () => void): number };
    render(): void;
    closeMobileInspector(): void;
  };
  view.mobileInspectorOpen = true;
  view.mobileInspectorNeedsFocus = true;
  view.mobileTreeScrollTop = 73;
  view.viewClosed = false;
  view.workspaceEl = workspace;
  view.treeEl = { querySelector: () => selected, focus: () => { focusCount += 1; } };
  view.render = () => undefined;
  view.timerWindow = { setTimeout: (scheduled) => { callback = scheduled; return 1; } };

  view.closeMobileInspector();
  view.viewClosed = true;
  callback?.();

  assert.equal(workspace.scrollTop, 0);
  assert.equal(focusCount, 0);
});

test("zero-delay tab reveal ignores DOM replaced before the callback", () => {
  const dom = createFakeDom();
  const content = dom.document.body.createDiv();
  const tablist = content.createDiv();
  const active = tablist.createEl("button", { attr: { "aria-selected": "true" } });
  let callback: (() => void) | null = null;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    contentEl: HTMLElement;
    viewClosed: boolean;
    timerWindow: { setTimeout(scheduled: () => void): number };
    revealActiveTab(tablist: HTMLElement): void;
  };
  view.contentEl = content as unknown as HTMLElement;
  view.viewClosed = false;
  view.timerWindow = { setTimeout: (scheduled) => { callback = scheduled; return 1; } };

  view.revealActiveTab(tablist as unknown as HTMLElement);
  content.empty();
  callback?.();

  assert.equal(active.scrollIntoViewCalls, 0);
});

test("window migration rehomes pending view timers before rebinding observers", () => {
  const cleared: number[] = [];
  const rebound: string[] = [];
  const scheduledDelays: number[] = [];
  let nextTimer = 20;
  const previousWindow = { clearTimeout: (timer: number) => { cleared.push(timer); } } as unknown as Window;
  const nextWindow = {
    setTimeout: (_callback: () => void, delay = 0) => {
      scheduledDelays.push(delay);
      nextTimer += 1;
      return nextTimer;
    },
  } as unknown as Window;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    viewClosed: boolean;
    setupTimer: number | null;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    timerWindow: Window;
    loadedBaseId: string;
    loadedDataEpoch: number;
    query: string;
    plugin: {
      data: { settings: { setupComplete: boolean } };
      getActiveKnowledgeBaseId(): string;
      getDataEpoch(): number;
    };
    bindPaneLayout(): void;
    bindSearchViewportLayout(): void;
    measureAndApplyPaneLayout(): void;
    syncSearchViewportLayout(): void;
    handleWindowMigration(viewWindow: Window): void;
  };
  view.viewClosed = false;
  view.setupTimer = 11;
  view.searchDebounce = 12;
  view.selectionSaveTimer = 13;
  view.timerWindow = previousWindow;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 7;
  view.query = "lary";
  view.plugin = {
    data: { settings: { setupComplete: false } },
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 7,
  };
  view.bindPaneLayout = () => { rebound.push("pane"); };
  view.bindSearchViewportLayout = () => { rebound.push("viewport"); };
  view.measureAndApplyPaneLayout = () => { rebound.push("measure"); };
  view.syncSearchViewportLayout = () => { rebound.push("sync"); };

  view.handleWindowMigration(nextWindow);

  assert.deepEqual(cleared, [11, 12, 13]);
  assert.equal(view.timerWindow, nextWindow);
  assert.deepEqual(rebound, ["pane", "viewport", "measure", "sync"]);
  assert.deepEqual(scheduledDelays, [100, 0, 1000]);
  assert.equal(view.setupTimer, 21);
  assert.equal(view.searchDebounce, 22);
  assert.equal(view.selectionSaveTimer, 23);
});

test("mobile search resets both possible result scroll containers", () => {
  const content = { scrollTop: 125 };
  const workspace = { scrollTop: 840 };
  const tree = { scrollTop: 320 };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    contentEl: typeof content;
    workspaceEl: typeof workspace;
    treeEl: typeof tree;
    resetSearchScrollPosition(): void;
  };
  view.contentEl = content;
  view.workspaceEl = workspace;
  view.treeEl = tree;

  view.resetSearchScrollPosition();

  assert.equal(content.scrollTop, 0);
  assert.equal(workspace.scrollTop, 0);
  assert.equal(tree.scrollTop, 0);
});

test("compact record inspector traps forward focus at its last control", () => {
  let firstFocusCount = 0;
  let prevented = false;
  const first = { offsetParent: {}, focus: () => { firstFocusCount += 1; } };
  const last = { offsetParent: {}, focus: () => {} };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    inspectorEl: {
      ownerDocument: { activeElement: typeof last };
      querySelectorAll(): Array<typeof first | typeof last>;
      contains(): boolean;
    };
    contentEl: { ownerDocument: { defaultView: { matchMedia(): { matches: boolean } } } };
    handleMobileInspectorKeydown(event: { key: string; shiftKey: boolean; preventDefault(): void }): void;
  };
  view.mobileInspectorOpen = true;
  view.contentEl = { ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } };
  view.inspectorEl = {
    ownerDocument: { activeElement: last },
    querySelectorAll: () => [first, last],
    contains: () => true,
  };

  view.handleMobileInspectorKeydown({
    key: "Tab",
    shiftKey: false,
    preventDefault: () => { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(firstFocusCount, 1);
});

test("compact record inspector traps backward focus at its first control", () => {
  let lastFocusCount = 0;
  let prevented = false;
  const first = { offsetParent: {}, focus: () => {} };
  const last = { offsetParent: {}, focus: () => { lastFocusCount += 1; } };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    inspectorEl: {
      ownerDocument: { activeElement: typeof first };
      querySelectorAll(): Array<typeof first | typeof last>;
      contains(): boolean;
    };
    contentEl: { ownerDocument: { defaultView: { matchMedia(): { matches: boolean } } } };
    handleMobileInspectorKeydown(event: { key: string; shiftKey: boolean; preventDefault(): void }): void;
  };
  view.mobileInspectorOpen = true;
  view.contentEl = { ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } };
  view.inspectorEl = {
    ownerDocument: { activeElement: first },
    querySelectorAll: () => [first, last],
    contains: () => true,
  };

  view.handleMobileInspectorKeydown({
    key: "Tab",
    shiftKey: true,
    preventDefault: () => { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(lastFocusCount, 1);
});

test("named snapshot UI requests a full rollback-safe normalized restore", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const source = structuredClone(data);
  source.settings.workspaceName = "Historical ENT";
  source.activeTab = "collections";
  source.layoutSnapshots = [snapshotPersonal(source, "Nested", true, true, false, true)];
  const snapshot = snapshotPersonal(source, "Complete historical state", true, true, true, true);
  data.layoutSnapshots = [snapshot];
  let capturedOptions: Record<string, unknown> | undefined;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-default",
    getDataEpoch: () => 4,
    async mutate(_label: string, _action: () => void, options?: Record<string, unknown>): Promise<void> {
      capturedOptions = options;
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    run(action: () => Promise<unknown>): void;
    showOrganizationSnapshots(event: MouseEvent): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-default";
  view.loadedDataEpoch = 4;
  view.staleViewNoticeShown = false;
  let pending: Promise<unknown> = Promise.resolve();
  view.run = (action) => { pending = action(); };

  let click: (() => void) | undefined;
  const descriptors = new Map(["addItem", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const item = {
        setTitle() { return item; },
        setIcon() { return item; },
        onClick(callback: () => void) { click = callback; return item; },
      };
      configure(item);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(): void {},
  });

  try {
    view.showOrganizationSnapshots({} as MouseEvent);
    assert.ok(click);
    click();
    await pending;
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
      else Reflect.deleteProperty(Menu.prototype, name);
    }
  }

  assert.deepEqual(capturedOptions, {
    includeSettings: true,
    includePortableIndex: true,
    includeLayoutSnapshots: true,
    includeActiveTab: true,
    requireUndo: true,
    normalizeAfterRestore: true,
  });
});

test("organization snapshots cannot mutate memory or report success in compatibility read-only mode", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  const snapshotsBefore = structuredClone(data.layoutSnapshots);
  let saveCalls = 0;
  let submit: ((name: string) => void | Promise<void>) | null = null;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-default",
    getDataEpoch: () => 7,
    isClinicalMode: () => false,
    isDataReadOnly: () => true,
    assertDataWritable(): never { throw new Error("Organization is read-only for this compatibility test."); },
    async savePluginData(): Promise<void> { saveCalls += 1; },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    saveOrganizationSnapshot(): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-default";
  view.loadedDataEpoch = 7;
  view.staleViewNoticeShown = false;

  TextPromptModal.prototype.open = function openForTest(): void {
    submit = (this as unknown as { options: { onSubmit: typeof submit } }).options.onSubmit;
  };
  try {
    view.saveOrganizationSnapshot();
    assert.ok(submit);
    await assert.rejects(async () => { await submit?.("Blocked snapshot"); }, /read-only/i);
  } finally {
    delete (TextPromptModal.prototype as { open?: () => void }).open;
  }

  assert.deepEqual(data.layoutSnapshots, snapshotsBefore);
  assert.equal(saveCalls, 0);
  assert.equal(Notice.messages.some((message) => /Saved organization snapshot/i.test(message)), false);
});

// ---------------------------------------------------------------------------
// Nested subheadings (depth ≤ 5): shared recursive renderer and deep targets
// ---------------------------------------------------------------------------

interface LayoutMembershipTarget { headingId: string; subheadingId?: string }

interface LayoutHarnessPlugin {
  data: PluginData;
  getActiveKnowledgeBaseId(): string;
  getDataEpoch(): number;
  isClinicalMode(): boolean;
  isDataReadOnly(): boolean;
  getLibrary(id: string): LibraryDefinition | null;
  getLibraries(includeArchived?: boolean): LibraryDefinition[];
  saveViewState(): Promise<void>;
  savePluginData(): Promise<void>;
  mutate(label: string, action: () => void, options?: { includePortableIndex?: boolean; requireUndo?: boolean }): Promise<void>;
  assignRecordToLibrary(path: string, libraryId: string, target: LayoutMembershipTarget): Promise<void>;
  createQuickEntryCollectionSubheading(headingId: string, title: string, parentSubheadingId?: string): Promise<void>;
  createQuickEntryLibrarySubheading(libraryId: string, headingId: string, title: string, parentSubheadingId?: string): Promise<void>;
}

interface LayoutHarnessView {
  app: object;
  plugin: LayoutHarnessPlugin;
  records: VaultRecord[];
  recordByPath: Map<string, VaultRecord>;
  query: string;
  parsedQuery: ReturnType<typeof parseQuery>;
  editMode: boolean;
  browseRowLimit: number;
  browseStructureLimit: number;
  browseRowsRendered: number;
  browseRowsOmitted: number;
  browseStructuresRendered: number;
  browseStructuresOmitted: number;
  loadedBaseId: string;
  loadedDataEpoch: number;
  staleViewNoticeShown: boolean;
  viewInstanceId: string;
  libraryDragRenderToken: string;
  activeLibraryDrag: unknown;
  collapsedQueues: Set<string>;
  renderTree(): void;
  renderHeading(parent: HTMLElement, heading: LayoutHeading, mutable: boolean): number;
  renderLibrary(parent: HTMLElement, records: VaultRecord[]): number;
  showSubheadingMenu(event: MouseEvent, heading: LayoutHeading, subheading: LayoutSubheading): void;
  showLibrarySubheadingMenu(event: MouseEvent, libraryId: string, heading: LayoutHeading, subheading: LayoutSubheading): void;
  showGlobalMenu(event: MouseEvent): void;
  openQuickCollectionHeadingPicker(): void;
  openQuickLibraryHeadingPicker(libraryId: string): void;
  libraryTemplateTokenContext(library: LibraryDefinition, target?: LayoutMembershipTarget): { category: string };
  readDrag(event: DragEvent): unknown;
  writeLibraryDrag(event: DragEvent, payload: {
    kind: "library-membership";
    libraryId: string;
    subjectId: string;
    headingId: string;
    subheadingId?: string;
  }): void;
}

function createLayoutRenderView(data: PluginData, records: VaultRecord[]): LayoutHarnessView {
  const view = Object.create(EntVaultCommandCenterView.prototype) as LayoutHarnessView;
  view.app = {};
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    getLibrary: (id) => data.portableIndex.libraries.find((library) => library.id === id) ?? null,
    getLibraries: (includeArchived = false) => data.portableIndex.libraries
      .filter((library) => includeArchived || library.archivedAt === null),
    saveViewState: async () => undefined,
    savePluginData: async () => undefined,
    mutate: async (_label, action) => { action(); },
    assignRecordToLibrary: async () => undefined,
    createQuickEntryCollectionSubheading: async () => undefined,
    createQuickEntryLibrarySubheading: async () => undefined,
  };
  view.records = records;
  view.recordByPath = new Map(records.map((item) => [item.path, item]));
  view.query = "";
  view.parsedQuery = parseQuery("");
  view.editMode = false;
  view.browseRowLimit = 300;
  view.browseStructureLimit = 300;
  view.browseRowsRendered = 0;
  view.browseRowsOmitted = 0;
  view.browseStructuresRendered = 0;
  view.browseStructuresOmitted = 0;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.viewInstanceId = "layout-render-test";
  view.libraryDragRenderToken = "layout-render-token";
  view.activeLibraryDrag = null;
  view.collapsedQueues = new Set();
  view.renderTree = () => undefined;
  return view;
}

function nestedCollectionHeading(): LayoutHeading {
  return {
    id: "col-h1",
    title: "Board review",
    collapsed: false,
    subjects: ["Notes/Alpha.md", "Notes/Missing.md"],
    subheadings: [{
      id: "col-d2",
      title: "Airway",
      collapsed: false,
      subjects: ["Notes/Beta.md"],
      subheadings: [{
        id: "col-d3",
        title: "Intubation",
        collapsed: false,
        subjects: ["Notes/Gamma.md"],
        subheadings: [{
          id: "col-d4",
          title: "Rapid sequence",
          collapsed: false,
          subjects: [],
          subheadings: [{ id: "col-d5", title: "Medications", collapsed: false, subjects: [] }],
        }],
      }],
    }],
  };
}

function nestedLibraryLayout(): LayoutHeading[] {
  return [{
    id: "lib-h1",
    title: "Guidelines",
    collapsed: false,
    subjects: ["subject-a", "subject-missing"],
    subheadings: [{
      id: "lib-d2",
      title: "Level two",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "lib-d3", title: "Level three", collapsed: false, subjects: ["subject-b", "subject-c"] }],
    }],
  }];
}

function nestedLibraryRecords(libraryId: string): VaultRecord[] {
  return [
    { ...record("Reference/A.md", "Alpha"), role: "library", portableId: "subject-a", libraryId },
    { ...record("Reference/B.md", "Beta"), role: "library", portableId: "subject-b", libraryId },
    { ...record("Reference/C.md", "Gamma"), role: "library", portableId: "subject-c", libraryId },
  ];
}

interface CapturedMenuEntry { title: string; disabled?: boolean; click?: () => void }

function captureMenus(): { menus: CapturedMenuEntry[][]; restore(): void } {
  const menus: CapturedMenuEntry[][] = [];
  const byMenu = new WeakMap<object, CapturedMenuEntry[]>();
  const descriptors = new Map(["addItem", "addSeparator", "showAtMouseEvent"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Menu.prototype, name),
  ]));
  Object.defineProperty(Menu.prototype, "addItem", {
    configurable: true,
    value(this: object, configure: (item: unknown) => void): object {
      const entries = byMenu.get(this) ?? [];
      byMenu.set(this, entries);
      const captured: CapturedMenuEntry = { title: "", disabled: false };
      const item = {
        setTitle(title: string) { captured.title = title; return item; },
        setIcon() { return item; },
        setDisabled(disabled: boolean) { captured.disabled = disabled; return item; },
        onClick(callback: () => void) { captured.click = callback; return item; },
      };
      configure(item);
      entries.push(captured);
      return this;
    },
  });
  Object.defineProperty(Menu.prototype, "addSeparator", {
    configurable: true,
    value(this: object): object { return this; },
  });
  Object.defineProperty(Menu.prototype, "showAtMouseEvent", {
    configurable: true,
    value(this: object): void { menus.push(byMenu.get(this) ?? []); },
  });
  return {
    menus,
    restore(): void {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(Menu.prototype, name, descriptor);
        else Reflect.deleteProperty(Menu.prototype, name);
      }
    },
  };
}

function captureConfirms(): { confirmations: Array<{ message: string; confirm: () => void | Promise<void> }>; restore(): void } {
  const confirmations: Array<{ message: string; confirm: () => void | Promise<void> }> = [];
  const descriptor = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  Object.defineProperty(ConfirmModal.prototype, "open", {
    configurable: true,
    value(this: object): void {
      const modal = this as unknown as { message: string; onConfirm: () => void | Promise<void> };
      confirmations.push({ message: modal.message, confirm: modal.onConfirm });
    },
  });
  return {
    confirmations,
    restore(): void {
      if (descriptor) Object.defineProperty(ConfirmModal.prototype, "open", descriptor);
      else Reflect.deleteProperty(ConfirmModal.prototype, "open");
    },
  };
}

const settleMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("the collections tab renders nested subheadings to depth five with depth classes and the repair tooltip", () => {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = nestedCollectionHeading();
  data.collections = [heading];
  const records = [
    record("Notes/Alpha.md", "Alpha"),
    record("Notes/Beta.md", "Beta"),
    record("Notes/Gamma.md", "Gamma"),
  ];
  const view = createLayoutRenderView(data, records);
  const parent = dom.document.body.createDiv();

  const total = view.renderHeading(asHtmlElement(parent), heading, true);

  assert.equal(total, 3, "matching totals count records at every depth");
  const subheadingRows = parent.querySelectorAll(".ent-cc-subheading-row");
  assert.equal(subheadingRows.length, 4, "each nested level renders one structure row");
  assert.equal(subheadingRows[0]?.hasClass("ent-cc-depth-0"), true);
  assert.equal(subheadingRows[1]?.hasClass("ent-cc-depth-1"), true);
  assert.equal(subheadingRows[2]?.hasClass("ent-cc-depth-2"), true);
  assert.equal(subheadingRows[3]?.hasClass("ent-cc-depth-3"), true);
  assert.ok(parent.querySelector(".ent-cc-subject-row.ent-cc-level-3"), "a depth-three record row carries its indentation level");
  assert.equal(parent.querySelector(".ent-cc-heading-row .ent-cc-row-count")?.textContent, "3", "the heading count resolves the whole subtree");
  const missing = parent.querySelector(".ent-cc-row-missing");
  assert.ok(missing, "unresolved references stay visible");
  assert.match(missing.getAttribute("title") ?? "", /review or repair/i, "the collections missing count keeps its repair tooltip");
  assert.equal(subheadingRows.every((row) => row.querySelector(".ent-cc-row-more") !== null), true, "every nested level keeps its menu control");
});

test("the library tab renders nested subheadings through the same recursive renderer, including the repair tooltip", () => {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  data.portableIndex.libraryLayouts[library.id] = nestedLibraryLayout();
  const records = nestedLibraryRecords(library.id);
  const view = createLayoutRenderView(data, records);
  const parent = dom.document.body.createDiv();

  assert.equal(view.renderLibrary(asHtmlElement(parent), records), 3);

  assert.equal(parent.querySelectorAll(".ent-cc-library-group").length, 1);
  const subheadingRows = parent.querySelectorAll(".ent-cc-library-subheading .ent-cc-subheading-row");
  assert.equal(subheadingRows.length, 2);
  assert.equal(subheadingRows[0]?.hasClass("ent-cc-depth-0"), true);
  assert.equal(subheadingRows[1]?.hasClass("ent-cc-depth-1"), true);
  assert.equal(parent.querySelectorAll(".ent-cc-subject-row.ent-cc-level-3").length, 2, "records nested at depth three render with their level class");
  const missing = parent.querySelector(".ent-cc-row-missing");
  assert.ok(missing, "an unresolved subject reference is reported");
  assert.match(missing.getAttribute("title") ?? "", /review or repair/i, "the library missing count regains the repair tooltip");
  assert.equal(parent.querySelector(".ent-cc-heading-row .ent-cc-row-count")?.textContent, "3", "the heading count resolves the whole subtree");
});

test("collection menus add subheadings below the depth cap and removing a nested node promotes subjects and children in order", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading: LayoutHeading = {
    id: "col-h1",
    title: "Board review",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: "col-d2",
      title: "Airway",
      collapsed: false,
      subjects: [],
      subheadings: [
        { id: "col-d3a", title: "Before", collapsed: false, subjects: [] },
        {
          id: "col-d3b",
          title: "Removed",
          collapsed: false,
          subjects: ["Notes/X.md"],
          subheadings: [
            { id: "col-d4a", title: "Promoted one", collapsed: false, subjects: [] },
            {
              id: "col-d4b",
              title: "Promoted two",
              collapsed: false,
              subjects: [],
              subheadings: [{ id: "col-d5", title: "Leaf", collapsed: false, subjects: [] }],
            },
          ],
        },
        { id: "col-d3c", title: "After", collapsed: false, subjects: [] },
      ],
    }],
  };
  data.collections = [heading];
  const view = createLayoutRenderView(data, []);
  const menuCapture = captureMenus();
  const confirmCapture = captureConfirms();
  try {
    const parentNode = heading.subheadings[0];
    const removed = parentNode?.subheadings?.[1];
    const depthFour = removed?.subheadings?.[1];
    const depthFive = depthFour?.subheadings?.[0];
    assert.ok(parentNode && removed && depthFour && depthFive);

    view.showSubheadingMenu({} as MouseEvent, heading, depthFour);
    assert.equal((menuCapture.menus.at(-1) ?? []).some((item) => item.title === "Add subheading"), true, "a depth-four node can still gain children");
    view.showSubheadingMenu({} as MouseEvent, heading, depthFive);
    assert.equal((menuCapture.menus.at(-1) ?? []).some((item) => item.title === "Add subheading"), false, "a depth-five node is at the cap");

    view.showSubheadingMenu({} as MouseEvent, heading, removed);
    const removeItem = (menuCapture.menus.at(-1) ?? []).find((item) => item.title === "Remove subheading");
    assert.ok(removeItem);
    removeItem.click?.();
    const confirmation = confirmCapture.confirmations.shift();
    assert.ok(confirmation);
    assert.match(confirmation.message, /move up under “Airway”/, "the confirm copy names the actual parent node");
    await confirmation.confirm();

    assert.deepEqual(parentNode.subjects, ["Notes/X.md"], "subjects move to the parent node, not the top heading");
    assert.deepEqual(heading.subjects, [], "the top heading is untouched by a deep removal");
    assert.deepEqual((parentNode.subheadings ?? []).map((item) => item.id), ["col-d3a", "col-d4a", "col-d4b", "col-d3c"], "children splice into the removed node's position");
    assert.deepEqual(depthFour.subheadings?.map((item) => item.id), ["col-d5"], "grandchildren stay attached to their promoted parents");
  } finally {
    menuCapture.restore();
    confirmCapture.restore();
  }
});

test("library menus mirror deep add and remove semantics with portable-index mutations", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  data.portableIndex.libraryLayouts[library.id] = [{
    id: "lib-h1",
    title: "Guidelines",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: "lib-d2",
      title: "Level two",
      collapsed: false,
      subjects: [],
      subheadings: [{
        id: "lib-d3",
        title: "Level three",
        collapsed: false,
        subjects: ["subject-x"],
        subheadings: [{
          id: "lib-d4",
          title: "Level four",
          collapsed: false,
          subjects: [],
          subheadings: [{ id: "lib-d5", title: "Level five", collapsed: false, subjects: [] }],
        }],
      }],
    }],
  }];
  const view = createLayoutRenderView(data, []);
  const mutationOptions: Array<{ includePortableIndex?: boolean; requireUndo?: boolean } | undefined> = [];
  view.plugin.mutate = async (_label, action, options) => {
    mutationOptions.push(options);
    action();
  };
  const layout = data.portableIndex.libraryLayouts[library.id] ?? [];
  const heading = layout[0];
  const levelTwo = heading?.subheadings[0];
  const levelThree = levelTwo?.subheadings?.[0];
  const levelFour = levelThree?.subheadings?.[0];
  const levelFive = levelFour?.subheadings?.[0];
  assert.ok(heading && levelTwo && levelThree && levelFour && levelFive);
  const menuCapture = captureMenus();
  const confirmCapture = captureConfirms();
  try {
    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, levelFour);
    assert.equal((menuCapture.menus.at(-1) ?? []).some((item) => item.title === "Add subheading"), true);
    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, levelFive);
    const levelFiveMenu = menuCapture.menus.at(-1) ?? [];
    assert.equal(levelFiveMenu.some((item) => item.title === "Add subheading"), false, "the depth cap hides deeper structure creation");
    assert.equal(levelFiveMenu.some((item) => item.title === "Create note here…"), true, "the deepest allowed subheading can still receive a note");

    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, levelThree);
    const removeItem = (menuCapture.menus.at(-1) ?? []).find((item) => item.title === "Remove subheading");
    assert.ok(removeItem);
    removeItem.click?.();
    const confirmation = confirmCapture.confirmations.shift();
    assert.ok(confirmation);
    assert.match(confirmation.message, /move up under “Level two”/);
    assert.match(confirmation.message, /No Markdown note will be changed/);
    await confirmation.confirm();

    assert.deepEqual(levelTwo.subjects, ["subject-x"], "records move to the direct parent node");
    assert.deepEqual(levelTwo.subheadings?.map((item) => item.id), ["lib-d4"], "the removed node's children take its place");
    assert.deepEqual(mutationOptions, [{ includePortableIndex: true, requireUndo: true }]);
  } finally {
    menuCapture.restore();
    confirmCapture.restore();
  }
});

interface CapturedPicker {
  labels: string[];
  choose(label: string): void;
}

function capturePickers(): { pickers: CapturedPicker[]; restore(): void } {
  const pickers: CapturedPicker[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(CollectionPickerModal.prototype, "open");
  Object.defineProperty(CollectionPickerModal.prototype, "open", {
    configurable: true,
    value(this: object): void {
      const modal = this as unknown as {
        targets: CollectionTarget[];
        onChoose(target: CollectionTarget): void | Promise<void>;
      };
      pickers.push({
        labels: modal.targets.map((target) => target.label),
        choose(label: string): void {
          const target = modal.targets.find((candidate) => candidate.label === label);
          assert.ok(target, `missing picker target ${label}`);
          void modal.onChoose(target);
        },
      });
    },
  });
  return {
    pickers,
    restore(): void {
      if (descriptor) Object.defineProperty(CollectionPickerModal.prototype, "open", descriptor);
      else Reflect.deleteProperty(CollectionPickerModal.prototype, "open");
    },
  };
}

/**
 * Board review
 *   Airway            (depth 2, subtree height 3)
 *     Intubation      (depth 3)
 *       Rapid sequence(depth 4)
 *   Emergencies       (depth 2)
 *     Established     (depth 3)
 */
function reparentCollectionHeading(): LayoutHeading {
  return {
    id: "col-h1",
    title: "Board review",
    collapsed: false,
    subjects: [],
    subheadings: [
      {
        id: "col-airway",
        title: "Airway",
        collapsed: false,
        subjects: ["Notes/Alpha.md"],
        subheadings: [{
          id: "col-intubation",
          title: "Intubation",
          collapsed: false,
          subjects: ["Notes/Beta.md"],
          subheadings: [{ id: "col-rsi", title: "Rapid sequence", collapsed: false, subjects: ["Notes/Gamma.md"] }],
        }],
      },
      {
        id: "col-emergencies",
        title: "Emergencies",
        collapsed: true,
        subjects: [],
        subheadings: [{ id: "col-established", title: "Established", collapsed: false, subjects: [] }],
      },
    ],
  };
}

function chooseMenuItem(menus: CapturedMenuEntry[][], title: string): CapturedMenuEntry {
  const item = (menus.at(-1) ?? []).find((candidate) => candidate.title === title);
  assert.ok(item, `missing menu item ${title}`);
  return item;
}

test("a collection subheading moves under a sibling with its whole subtree, in order and with stable ids", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = reparentCollectionHeading();
  data.collections = [heading];
  const view = createLayoutRenderView(data, []);
  const labels: string[] = [];
  view.plugin.mutate = async (label, action) => { labels.push(label); action(); };
  const menuCapture = captureMenus();
  const pickerCapture = capturePickers();
  try {
    const airway = heading.subheadings[0];
    const emergencies = heading.subheadings[1];
    assert.ok(airway && emergencies);

    view.showSubheadingMenu({} as MouseEvent, heading, airway);
    chooseMenuItem(menuCapture.menus, "Move under…").click?.();
    const picker = pickerCapture.pickers.shift();
    assert.ok(picker, "the reparent action opens a destination picker");
    assert.deepEqual(picker.labels, [
      "Board review (top level)",
      "Board review / Emergencies",
    ], "destinations are labelled by full path, with the heading offered as the explicit top level");

    picker.choose("Board review / Emergencies");
    await settleMicrotasks();

    assert.deepEqual(heading.subheadings.map((item) => item.id), ["col-emergencies"], "the moved node leaves its old parent");
    assert.deepEqual(
      emergencies.subheadings?.map((item) => item.id),
      ["col-established", "col-airway"],
      "the destination keeps its existing children in order and appends the moved node",
    );
    assert.deepEqual(airway.subheadings?.map((item) => item.id), ["col-intubation"], "the moved subtree travels intact");
    assert.deepEqual(airway.subheadings?.[0]?.subheadings?.map((item) => item.id), ["col-rsi"], "grandchildren travel too");
    assert.deepEqual(airway.subjects, ["Notes/Alpha.md"], "memberships ride along with the node");
    assert.equal(emergencies.collapsed, false, "the destination opens so the moved node stays reachable");
    assert.deepEqual(labels, ["Move subheading “Airway” under “Emergencies”"], "the move runs through one undo-protected mutation");
  } finally {
    pickerCapture.restore();
    menuCapture.restore();
  }
});

test("the subheading destination picker excludes the node, its descendants, and anything that would breach the depth cap", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = reparentCollectionHeading();
  data.collections = [heading];
  const view = createLayoutRenderView(data, []);
  const menuCapture = captureMenus();
  const pickerCapture = capturePickers();
  try {
    const airway = heading.subheadings[0];
    const intubation = airway?.subheadings?.[0];
    const emergencies = heading.subheadings[1];
    assert.ok(airway && intubation && emergencies);

    // Intubation's own subtree is two levels tall, so a depth-four destination
    // would land Rapid sequence at level six.
    view.showSubheadingMenu({} as MouseEvent, heading, intubation);
    chooseMenuItem(menuCapture.menus, "Move under…").click?.();
    const tallPicker = pickerCapture.pickers.shift();
    assert.ok(tallPicker);
    assert.deepEqual(tallPicker.labels, [
      "Board review (top level)",
      "Board review / Airway",
      "Board review / Emergencies",
      "Board review / Emergencies / Established",
    ], "self and descendants disappear, and only destinations with room for the two-level subtree remain");

    // The same destinations, offered to a leaf, prove the cap follows the moved
    // subtree's height rather than the destination depth alone.
    const leaf = intubation.subheadings?.[0];
    assert.ok(leaf);
    view.showSubheadingMenu({} as MouseEvent, heading, leaf);
    chooseMenuItem(menuCapture.menus, "Move under…").click?.();
    const leafPicker = pickerCapture.pickers.shift();
    assert.ok(leafPicker);
    assert.equal(
      leafPicker.labels.includes("Board review / Airway / Intubation"),
      true,
      "a one-level node still fits under the depth-three node that rejected the taller subtree",
    );
    assert.equal(
      leafPicker.labels.some((label) => label.includes("Rapid sequence")),
      false,
      "a node is never offered itself",
    );
  } finally {
    pickerCapture.restore();
    menuCapture.restore();
  }
});

test("moving a collection subheading to the top level leaves both parents in canonical form", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = reparentCollectionHeading();
  data.collections = [heading];
  const view = createLayoutRenderView(data, []);
  const menuCapture = captureMenus();
  const pickerCapture = capturePickers();
  try {
    const airway = heading.subheadings[0];
    const intubation = airway?.subheadings?.[0];
    assert.ok(airway && intubation);

    view.showSubheadingMenu({} as MouseEvent, heading, intubation);
    chooseMenuItem(menuCapture.menus, "Move under…").click?.();
    const picker = pickerCapture.pickers.shift();
    assert.ok(picker);
    picker.choose("Board review (top level)");
    await settleMicrotasks();

    assert.deepEqual(
      heading.subheadings.map((item) => item.id),
      ["col-airway", "col-emergencies", "col-intubation"],
      "the top-level option appends under the heading itself",
    );
    assert.equal(Object.hasOwn(airway, "subheadings"), false, "an emptied parent drops the nested key entirely");
    assert.deepEqual(intubation.subheadings?.map((item) => item.id), ["col-rsi"], "the moved node keeps a well-formed child array");

    // A second move re-creates the array on a node that had become a leaf.
    const emergencies = heading.subheadings[1];
    assert.ok(emergencies);
    view.showSubheadingMenu({} as MouseEvent, heading, intubation);
    chooseMenuItem(menuCapture.menus, "Move under…").click?.();
    const second = pickerCapture.pickers.shift();
    assert.ok(second);
    second.choose("Board review / Airway");
    await settleMicrotasks();

    assert.deepEqual(airway.subheadings?.map((item) => item.id), ["col-intubation"], "the new parent gains a well-formed array");
    assert.deepEqual(heading.subheadings.map((item) => item.id), ["col-airway", "col-emergencies"]);
  } finally {
    pickerCapture.restore();
    menuCapture.restore();
  }
});

test("outdent one level lifts a collection subheading beside its parent and is disabled directly under the heading", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = reparentCollectionHeading();
  data.collections = [heading];
  const view = createLayoutRenderView(data, []);
  const labels: string[] = [];
  view.plugin.mutate = async (label, action) => { labels.push(label); action(); };
  const menuCapture = captureMenus();
  try {
    const airway = heading.subheadings[0];
    const intubation = airway?.subheadings?.[0];
    assert.ok(airway && intubation);

    view.showSubheadingMenu({} as MouseEvent, heading, airway);
    assert.equal(chooseMenuItem(menuCapture.menus, "Outdent one level").disabled, true, "a depth-two node has no level to lose");

    view.showSubheadingMenu({} as MouseEvent, heading, intubation);
    const outdent = chooseMenuItem(menuCapture.menus, "Outdent one level");
    assert.equal(outdent.disabled, false, "a depth-three node can be promoted without the picker");
    outdent.click?.();
    await settleMicrotasks();

    assert.deepEqual(
      heading.subheadings.map((item) => item.id),
      ["col-airway", "col-emergencies", "col-intubation"],
      "the node becomes a sibling of its former parent",
    );
    assert.equal(Object.hasOwn(airway, "subheadings"), false, "the emptied former parent returns to canonical leaf form");
    assert.deepEqual(intubation.subheadings?.map((item) => item.id), ["col-rsi"], "the subtree follows the promotion");
    assert.deepEqual(labels, ["Move subheading “Intubation” under “Board review”"]);

    view.showSubheadingMenu({} as MouseEvent, heading, intubation);
    assert.equal(chooseMenuItem(menuCapture.menus, "Outdent one level").disabled, true, "once at depth two the action turns off");
  } finally {
    menuCapture.restore();
  }
});

test("library subheading menus reparent whole subtrees and outdent through portable-index mutations", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  const heading: LayoutHeading = {
    id: "lib-h1",
    title: "Guidelines",
    collapsed: false,
    subjects: [],
    subheadings: [
      {
        id: "lib-airway",
        title: "Airway",
        collapsed: false,
        subjects: [],
        subheadings: [{
          id: "lib-intubation",
          title: "Intubation",
          collapsed: false,
          subjects: ["subject-b"],
          subheadings: [{ id: "lib-rsi", title: "Rapid sequence", collapsed: false, subjects: [] }],
        }],
      },
      { id: "lib-emergencies", title: "Emergencies", collapsed: false, subjects: [] },
    ],
  };
  data.portableIndex.libraryLayouts[library.id] = [heading];
  const view = createLayoutRenderView(data, []);
  const mutations: Array<{ label: string; options?: { includePortableIndex?: boolean; requireUndo?: boolean } }> = [];
  view.plugin.mutate = async (label, action, options) => {
    mutations.push({ label, options });
    action();
  };
  const menuCapture = captureMenus();
  const pickerCapture = capturePickers();
  try {
    const airway = heading.subheadings[0];
    const intubation = airway?.subheadings?.[0];
    const emergencies = heading.subheadings[1];
    assert.ok(airway && intubation && emergencies);

    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, intubation);
    chooseMenuItem(menuCapture.menus, "Move under…").click?.();
    const picker = pickerCapture.pickers.shift();
    assert.ok(picker);
    assert.deepEqual(picker.labels, [
      "Guidelines (top level)",
      "Guidelines / Airway",
      "Guidelines / Emergencies",
    ], "library destinations use the same full-path labels and exclude the node's own subtree");

    picker.choose("Guidelines / Emergencies");
    await settleMicrotasks();

    assert.deepEqual(emergencies.subheadings?.map((item) => item.id), ["lib-intubation"], "the destination gains a well-formed array");
    assert.deepEqual(intubation.subheadings?.map((item) => item.id), ["lib-rsi"], "the library subtree travels intact");
    assert.deepEqual(intubation.subjects, ["subject-b"], "library memberships ride along");
    assert.equal(Object.hasOwn(airway, "subheadings"), false, "the emptied library parent drops the nested key");

    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, intubation);
    const outdent = chooseMenuItem(menuCapture.menus, "Outdent one level");
    assert.equal(outdent.disabled, false);
    outdent.click?.();
    await settleMicrotasks();

    assert.deepEqual(
      heading.subheadings.map((item) => item.id),
      ["lib-airway", "lib-emergencies", "lib-intubation"],
      "outdenting promotes the library node beside its former parent",
    );
    assert.equal(Object.hasOwn(emergencies, "subheadings"), false, "the emptied destination returns to canonical leaf form");
    assert.deepEqual(mutations, [
      { label: "Move library subheading “Intubation” under “Emergencies”", options: { includePortableIndex: true, requireUndo: true } },
      { label: "Move library subheading “Intubation” under “Guidelines”", options: { includePortableIndex: true, requireUndo: true } },
    ], "both reparents save the portable index and stay undoable");
  } finally {
    pickerCapture.restore();
    menuCapture.restore();
  }
});

test("a collection reparent refuses when the destination became the node's own descendant while the picker was open", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = reparentCollectionHeading();
  data.collections = [heading];
  const view = createLayoutRenderView(data, []);
  const labels: string[] = [];
  view.plugin.mutate = async (label, action) => { labels.push(label); action(); };
  const menuCapture = captureMenus();
  const pickerCapture = capturePickers();
  try {
    const airway = heading.subheadings[0];
    const intubation = airway?.subheadings?.[0];
    assert.ok(airway && intubation);

    view.showSubheadingMenu({} as MouseEvent, heading, intubation);
    chooseMenuItem(menuCapture.menus, "Move under…").click?.();
    const picker = pickerCapture.pickers.shift();
    assert.ok(picker);
    assert.equal(picker.labels.includes("Board review / Emergencies"), true);

    // Sync rearranges the layout while the picker waits: the chosen node is now
    // inside the subtree that is about to move.
    const emergencies = heading.subheadings.splice(1, 1)[0];
    assert.ok(emergencies);
    intubation.subheadings?.push(emergencies);

    picker.choose("Board review / Emergencies");
    await settleMicrotasks();

    assert.deepEqual(labels, [], "a refused move never reaches the mutation machinery");
    assert.deepEqual(heading.subheadings.map((item) => item.id), ["col-airway"], "the layout is left exactly as Sync left it");
    assert.deepEqual(intubation.subheadings?.map((item) => item.id), ["col-rsi", "col-emergencies"]);
    assert.equal(
      Notice.messages.some((message) => /can no longer move there/.test(message)),
      true,
      "the refusal is reported instead of silently detaching the subtree",
    );
  } finally {
    pickerCapture.restore();
    menuCapture.restore();
  }
});

test("a library reparent refuses when Sync replaced the layout while the picker was open", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  const heading: LayoutHeading = {
    id: "lib-h1",
    title: "Guidelines",
    collapsed: false,
    subjects: [],
    subheadings: [
      {
        id: "lib-airway",
        title: "Airway",
        collapsed: false,
        subjects: [],
        subheadings: [{ id: "lib-intubation", title: "Intubation", collapsed: false, subjects: [] }],
      },
      { id: "lib-emergencies", title: "Emergencies", collapsed: false, subjects: [] },
    ],
  };
  data.portableIndex.libraryLayouts[library.id] = [heading];
  const view = createLayoutRenderView(data, []);
  const labels: string[] = [];
  view.plugin.mutate = async (label, action) => { labels.push(label); action(); };
  const menuCapture = captureMenus();
  const pickerCapture = capturePickers();
  try {
    const airway = heading.subheadings[0];
    const intubation = airway?.subheadings?.[0];
    assert.ok(airway && intubation);

    view.showLibrarySubheadingMenu({} as MouseEvent, library.id, heading, intubation);
    chooseMenuItem(menuCapture.menus, "Move under…").click?.();
    const picker = pickerCapture.pickers.shift();
    assert.ok(picker);

    const replacement = structuredClone(heading);
    data.portableIndex.libraryLayouts[library.id] = [replacement];

    picker.choose("Guidelines / Emergencies");
    await settleMicrotasks();

    assert.deepEqual(labels, [], "the replaced layout is never written through a stale picker");
    assert.deepEqual(airway.subheadings?.map((item) => item.id), ["lib-intubation"], "the detached copy is untouched");
    assert.equal(replacement.subheadings[1]?.subheadings, undefined, "the live layout is untouched");
    assert.equal(
      Notice.messages.some((message) => /library organization changed/i.test(message)),
      true,
    );
  } finally {
    pickerCapture.restore();
    menuCapture.restore();
  }
});

test("drops onto depth-three nodes add memberships there and row drops reorder within the deep parent", async () => {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.activeTab = libraryTabId(library.id);
  data.portableIndex.libraryLayouts[library.id] = nestedLibraryLayout();
  const records = nestedLibraryRecords(library.id);
  const view = createLayoutRenderView(data, records);
  view.editMode = true;
  const assignments: Array<{ path: string; target: LayoutMembershipTarget }> = [];
  view.plugin.assignRecordToLibrary = async (path, _libraryId, target) => { assignments.push({ path, target }); };
  view.plugin.mutate = async (_label, action, options) => {
    assert.deepEqual(options, { includePortableIndex: true, requireUndo: true });
    action();
  };
  const parent = dom.document.body.createDiv();
  const dataTransfer = { effectAllowed: "none", dropEffect: "none", setData: () => undefined, getData: () => "" };
  const dragEvent = { dataTransfer } as unknown as DragEvent;

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = false;
  try {
    assert.equal(view.renderLibrary(asHtmlElement(parent), records), 3);
    const subheadingRows = parent.querySelectorAll(".ent-cc-subheading-row");
    const depthThreeRow = subheadingRows[1];
    assert.ok(depthThreeRow);

    view.writeLibraryDrag(dragEvent, { kind: "library-membership", libraryId: library.id, subjectId: "subject-a", headingId: "lib-h1" });
    const dragover = depthThreeRow.dispatch("dragover");
    assert.equal(dragover.defaultPrevented, true, "a deep node is a live drop target");
    depthThreeRow.dispatch("drop");
    await settleMicrotasks();
    assert.deepEqual(assignments, [{
      path: "Reference/A.md",
      target: { libraryId: library.id, headingId: "lib-h1", subheadingId: "lib-d3" },
    }], "the drop payload carries the deep node id");

    view.writeLibraryDrag(dragEvent, { kind: "library-membership", libraryId: library.id, subjectId: "subject-b", headingId: "lib-h1", subheadingId: "lib-d3" });
    const subjectRows = parent.querySelectorAll(".ent-cc-subject-row");
    const targetRow = subjectRows[2];
    assert.ok(targetRow);
    targetRow.setBoundingClientRect({ top: 0, height: 44, bottom: 44 });
    targetRow.dispatch("dragover", { clientY: 40 });
    targetRow.dispatch("drop", { clientY: 40 });
    await settleMicrotasks();
    const deepNode = data.portableIndex.libraryLayouts[library.id]?.[0]?.subheadings[0]?.subheadings?.[0];
    assert.deepEqual(deepNode?.subjects, ["subject-c", "subject-b"], "row drops reorder inside the depth-three parent");
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("collection drops resolve deep membership targets and remove them from every level", async () => {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = nestedCollectionHeading();
  data.collections = [heading];
  const records = [
    record("Notes/Alpha.md", "Alpha"),
    record("Notes/Beta.md", "Beta"),
    record("Notes/Gamma.md", "Gamma"),
  ];
  const view = createLayoutRenderView(data, records);
  view.editMode = true;
  const parent = dom.document.body.createDiv();

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = false;
  try {
    view.renderHeading(asHtmlElement(parent), heading, true);
    const depthThreeRow = parent.querySelectorAll(".ent-cc-subheading-row")[1];
    assert.ok(depthThreeRow);
    (view as unknown as { readDrag(): unknown }).readDrag = () => ({
      kind: "membership",
      path: "Notes/Alpha.md",
      headingId: "col-h1",
    });
    depthThreeRow.dispatch("drop");
    await settleMicrotasks();
    const depthThree = heading.subheadings[0]?.subheadings?.[0];
    assert.equal(heading.subjects.includes("Notes/Alpha.md"), false, "the membership left its old level");
    assert.deepEqual(depthThree?.subjects, ["Notes/Gamma.md", "Notes/Alpha.md"], "the drop landed on the depth-three node");

    (view as unknown as { readDrag(): unknown }).readDrag = () => ({
      kind: "membership",
      path: "Notes/Alpha.md",
      headingId: "col-h1",
      subheadingId: "col-d3",
    });
    const subjectRows = parent.querySelectorAll(".ent-cc-subject-row");
    const gammaRow = subjectRows.find((row) => row.textContent.includes("Gamma"));
    assert.ok(gammaRow);
    gammaRow.setBoundingClientRect({ top: 0, height: 44, bottom: 44 });
    gammaRow.dispatch("dragover", { clientY: 4 });
    gammaRow.dispatch("drop", { clientY: 4 });
    await settleMicrotasks();
    assert.deepEqual(depthThree?.subjects, ["Notes/Alpha.md", "Notes/Gamma.md"], "row drops reorder inside the deep parent list");
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("collapse toggles at depth persist through saveViewState and roll back when the save fails", async () => {
  Notice.messages.length = 0;
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = nestedCollectionHeading();
  data.collections = [heading];
  const view = createLayoutRenderView(data, [
    record("Notes/Alpha.md", "Alpha"),
    record("Notes/Beta.md", "Beta"),
    record("Notes/Gamma.md", "Gamma"),
  ]);
  let saves = 0;
  let failSave = false;
  view.plugin.saveViewState = async () => {
    if (failSave) throw new Error("save failed for the toggle test");
    saves += 1;
  };
  const parent = dom.document.body.createDiv();
  view.renderHeading(asHtmlElement(parent), heading, true);
  const depthThreeRow = parent.querySelectorAll(".ent-cc-subheading-row")[1];
  const disclosure = depthThreeRow?.querySelector(".ent-cc-disclosure");
  assert.ok(disclosure);
  const depthThree = heading.subheadings[0]?.subheadings?.[0];
  assert.ok(depthThree);

  disclosure.dispatch("click");
  await settleMicrotasks();
  assert.equal(depthThree.collapsed, true, "the nested node's collapse state is written");
  assert.equal(saves, 1, "the collapse state reaches the persisted view state");

  failSave = true;
  disclosure.dispatch("click");
  await settleMicrotasks();
  assert.equal(depthThree.collapsed, true, "a failed save rolls the optimistic toggle back");
  assert.equal(Notice.messages.some((message) => /save failed for the toggle test/.test(message)), true);
});

test("expand all and collapse all reach nested subheadings on the collections and library tabs", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.collections = [nestedCollectionHeading()];
  data.portableIndex.libraryLayouts[library.id] = nestedLibraryLayout();
  data.activeTab = "collections";
  const view = createLayoutRenderView(data, []);
  const menuCapture = captureMenus();
  const choose = async (title: string): Promise<void> => {
    const item = (menuCapture.menus.at(-1) ?? []).find((entry) => entry.title === title);
    assert.ok(item, `missing menu item ${title}`);
    item.click?.();
    await settleMicrotasks();
  };
  try {
    view.showGlobalMenu({} as MouseEvent);
    await choose("Collapse all visible groups");
    const depthFive = data.collections[0]?.subheadings[0]?.subheadings?.[0]?.subheadings?.[0]?.subheadings?.[0];
    assert.equal(depthFive?.collapsed, true, "collapse all reaches depth five");

    view.showGlobalMenu({} as MouseEvent);
    await choose("Expand all visible groups");
    assert.equal(depthFive?.collapsed, false, "expand all reaches depth five");

    data.activeTab = libraryTabId(library.id);
    view.showGlobalMenu({} as MouseEvent);
    await choose("Collapse all visible groups");
    const libraryDepthThree = data.portableIndex.libraryLayouts[library.id]?.[0]?.subheadings[0]?.subheadings?.[0];
    assert.equal(libraryDepthThree?.collapsed, true, "library collapse all reaches nested nodes");

    view.showGlobalMenu({} as MouseEvent);
    await choose("Expand all visible groups");
    assert.equal(libraryDepthThree?.collapsed, false);
  } finally {
    menuCapture.restore();
  }
});

test("quick-create subheading pickers list deep parents with path labels and resolve the owning heading id plus the deep parent id", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.collections = [nestedCollectionHeading()];
  data.portableIndex.libraryLayouts[library.id] = nestedLibraryLayout();
  const view = createLayoutRenderView(data, []);
  const collectionCreates: Array<{ headingId: string; title: string; parentSubheadingId?: string }> = [];
  const libraryCreates: Array<{ libraryId: string; headingId: string; title: string; parentSubheadingId?: string }> = [];
  view.plugin.createQuickEntryCollectionSubheading = async (headingId, title, parentSubheadingId) => { collectionCreates.push({ headingId, title, parentSubheadingId }); };
  view.plugin.createQuickEntryLibrarySubheading = async (libraryId, headingId, title, parentSubheadingId) => { libraryCreates.push({ libraryId, headingId, title, parentSubheadingId }); };

  interface CapturedPicker {
    getItems(): Array<{ id: string; title: string; description: string }>;
    onChooseItem(item: { id: string; title: string; description: string; icon: string }): void;
  }
  const pickers: CapturedPicker[] = [];
  const prompts: Array<(value: string) => void | Promise<void>> = [];
  const pickerOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const promptOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
  Object.defineProperty(AddActionModal.prototype, "open", {
    configurable: true,
    value(this: object): void { pickers.push(this as unknown as CapturedPicker); },
  });
  TextPromptModal.prototype.open = function capturePrompt(): void {
    const modal = this as unknown as { options: { onSubmit(value: string): void | Promise<void> } };
    prompts.push((value) => modal.options.onSubmit(value));
  };
  try {
    view.openQuickCollectionHeadingPicker();
    const collectionPicker = pickers.at(-1);
    assert.ok(collectionPicker);
    const labels = collectionPicker.getItems().map((item) => item.title);
    assert.deepEqual(labels, [
      "Board review",
      "Board review / Airway",
      "Board review / Airway / Intubation",
      "Board review / Airway / Intubation / Rapid sequence",
    ], "every node below the cap is offered with its full path; the depth-five node is not");
    assert.equal(collectionPicker.getItems()[0]?.description, "4 nested subheadings", "descriptions count nested children recursively");
    const topLevelParent = collectionPicker.getItems()[0];
    assert.ok(topLevelParent);
    collectionPicker.onChooseItem({ ...topLevelParent, icon: "folder" });
    const submitTopLevel = prompts.shift();
    assert.ok(submitTopLevel);
    await submitTopLevel("Top leaf");
    const deepParent = collectionPicker.getItems().at(-1);
    assert.ok(deepParent);
    collectionPicker.onChooseItem({ ...deepParent, icon: "folder" });
    const submitCollection = prompts.shift();
    assert.ok(submitCollection);
    await submitCollection("Deep leaf");
    assert.deepEqual(collectionCreates, [
      { headingId: "col-h1", title: "Top leaf", parentSubheadingId: undefined },
      { headingId: "col-h1", title: "Deep leaf", parentSubheadingId: "col-d4" },
    ], "the plugin API takes the owning top-level heading id plus the deep parent's own id");

    view.openQuickLibraryHeadingPicker(library.id);
    const libraryPicker = pickers.at(-1);
    assert.ok(libraryPicker);
    assert.deepEqual(libraryPicker.getItems().map((item) => item.title), [
      "Guidelines",
      "Guidelines / Level two",
      "Guidelines / Level two / Level three",
    ]);
    const deepLibraryParent = libraryPicker.getItems().at(-1);
    assert.ok(deepLibraryParent);
    libraryPicker.onChooseItem({ ...deepLibraryParent, icon: "folder" });
    const submitLibrary = prompts.shift();
    assert.ok(submitLibrary);
    await submitLibrary("Deep library leaf");
    assert.deepEqual(libraryCreates, [
      { libraryId: library.id, headingId: "lib-h1", title: "Deep library leaf", parentSubheadingId: "lib-d3" },
    ], "library creation also resolves the owning heading and passes the nested node separately");
  } finally {
    if (pickerOpen) Object.defineProperty(AddActionModal.prototype, "open", pickerOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (promptOpen) Object.defineProperty(TextPromptModal.prototype, "open", promptOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
  }
});

test("quick-create subheading pickers create nodes under depth-two parents through the real plugin", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.setupComplete = true;
  const library = installLibrary(data);
  data.collections = [nestedCollectionHeading()];
  data.portableIndex.libraryLayouts[library.id] = nestedLibraryLayout();
  const store = createDefaultStore(data, 1, "vault-quick-subheading-e2e");
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => undefined,
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & { loadedData: unknown };
  plugin.loadedData = store;
  await plugin.loadPluginData();

  const view = Object.create(EntVaultCommandCenterView.prototype) as LayoutHarnessView;
  view.app = app;
  view.plugin = plugin as unknown as LayoutHarnessPlugin;
  view.staleViewNoticeShown = false;
  view.viewInstanceId = "quick-subheading-e2e";
  view.renderTree = () => undefined;
  const syncViewToPlugin = (): void => {
    view.loadedBaseId = plugin.getActiveKnowledgeBaseId();
    view.loadedDataEpoch = plugin.getDataEpoch();
  };

  interface CapturedPicker {
    getItems(): Array<{ id: string; title: string; description: string }>;
    onChooseItem(item: { id: string; title: string; description: string; icon: string }): void;
  }
  const pickers: CapturedPicker[] = [];
  const prompts: Array<(value: string) => void | Promise<void>> = [];
  const pickerOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const promptOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
  Object.defineProperty(AddActionModal.prototype, "open", {
    configurable: true,
    value(this: object): void { pickers.push(this as unknown as CapturedPicker); },
  });
  TextPromptModal.prototype.open = function capturePrompt(): void {
    const modal = this as unknown as { options: { onSubmit(value: string): void | Promise<void> } };
    prompts.push((value) => modal.options.onSubmit(value));
  };
  try {
    syncViewToPlugin();
    view.openQuickCollectionHeadingPicker();
    const collectionPicker = pickers.at(-1);
    assert.ok(collectionPicker);
    const depthTwoCollection = collectionPicker.getItems().find((item) => item.title === "Board review / Airway");
    assert.ok(depthTwoCollection, "the depth-two collection parent is offered");
    collectionPicker.onChooseItem({ ...depthTwoCollection, icon: "folder" });
    const submitCollection = prompts.shift();
    assert.ok(submitCollection);
    await submitCollection("Deep quick leaf");
    const airway = plugin.data.collections.find((heading) => heading.id === "col-h1")?.subheadings.find((node) => node.id === "col-d2");
    assert.ok(airway);
    assert.equal((airway.subheadings ?? []).some((node) => node.title === "Deep quick leaf"), true, "the new subheading lands under the depth-two collection parent");
    assert.equal(plugin.data.collections.find((heading) => heading.id === "col-h1")?.subheadings.some((node) => node.title === "Deep quick leaf"), false, "the new node does not fall back to the heading level");

    syncViewToPlugin();
    view.openQuickLibraryHeadingPicker(library.id);
    const libraryPicker = pickers.at(-1);
    assert.ok(libraryPicker);
    const depthTwoLibrary = libraryPicker.getItems().find((item) => item.title === "Guidelines / Level two");
    assert.ok(depthTwoLibrary, "the depth-two library parent is offered");
    libraryPicker.onChooseItem({ ...depthTwoLibrary, icon: "folder" });
    const submitLibrary = prompts.shift();
    assert.ok(submitLibrary);
    await submitLibrary("Deep quick library leaf");
    const levelTwo = (plugin.data.portableIndex.libraryLayouts[library.id] ?? [])
      .find((heading) => heading.id === "lib-h1")?.subheadings.find((node) => node.id === "lib-d2");
    assert.ok(levelTwo);
    assert.equal((levelTwo.subheadings ?? []).some((node) => node.title === "Deep quick library leaf"), true, "the new subheading lands under the depth-two library parent");
  } finally {
    if (pickerOpen) Object.defineProperty(AddActionModal.prototype, "open", pickerOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (promptOpen) Object.defineProperty(TextPromptModal.prototype, "open", promptOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
  }
});

test("confirming a collection subheading removal after the node was already removed reports stale structure instead of duplicating its subtree", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const heading = nestedCollectionHeading();
  data.collections = [heading];
  const view = createLayoutRenderView(data, []);
  let mutations = 0;
  view.plugin.mutate = async (_label, action) => {
    mutations += 1;
    action();
  };
  const menuCapture = captureMenus();
  const confirmCapture = captureConfirms();
  try {
    const airway = heading.subheadings[0];
    const intubation = airway?.subheadings?.[0];
    assert.ok(airway && intubation);

    view.showSubheadingMenu({} as MouseEvent, heading, intubation);
    const removeItem = (menuCapture.menus.at(-1) ?? []).find((item) => item.title === "Remove subheading");
    assert.ok(removeItem);
    removeItem.click?.();
    const confirmation = confirmCapture.confirmations.shift();
    assert.ok(confirmation);

    // Another window (or Sync) already removed the node: subjects and children
    // were promoted into its parent while this confirm dialog stayed open.
    airway.subjects.push(...intubation.subjects.filter((path) => !airway.subjects.includes(path)));
    airway.subheadings = [...(intubation.subheadings ?? [])];

    await assert.rejects(Promise.resolve(confirmation.confirm()), /subheading is no longer available/i);
    assert.deepEqual((airway.subheadings ?? []).map((item) => item.id), ["col-d4"], "the already-promoted subtree is not appended a second time");
    assert.deepEqual(airway.subjects, ["Notes/Beta.md", "Notes/Gamma.md"], "already-promoted subjects are not re-merged");
    assert.equal(mutations, 0, "a removed target must reject before starting a mutation");
  } finally {
    menuCapture.restore();
    confirmCapture.restore();
  }
});

test("the category template token resolves the deepest placed node title at any depth", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library = installLibrary(data);
  data.portableIndex.libraryLayouts[library.id] = nestedLibraryLayout();
  const view = createLayoutRenderView(data, []);

  assert.equal(view.libraryTemplateTokenContext(library, { headingId: "lib-h1", subheadingId: "lib-d3" }).category, "Level three");
  assert.equal(view.libraryTemplateTokenContext(library, { subheadingId: "lib-d3" }).category, "Level three", "a deep subheading id alone locates its heading recursively");
  assert.equal(view.libraryTemplateTokenContext(library, { headingId: "lib-h1" }).category, "Guidelines", "heading placements fall back to the heading title");
});

// --- Wave 3: shared UI helpers (vault-snapshot caching, JSON transfer size
// --- guards, and the one promoted stale-base guard).

/**
 * The obsidian test double ships an empty `Setting`; the index manager footer
 * needs a chainable one before a full `render()` can be exercised.
 */
function withSettingStub<T>(run: () => T): T {
  const prototype = Setting.prototype as unknown as Record<string, unknown>;
  const button = {
    setButtonText: (): typeof button => button,
    onClick: (): typeof button => button,
    setCta: (): typeof button => button,
    setDisabled: (): typeof button => button,
  };
  prototype.addButton = function addButton(this: unknown, callback: (value: typeof button) => void): unknown {
    callback(button);
    return this;
  };
  prototype.settingEl = { addClass: (): void => undefined };
  try {
    return run();
  } finally {
    Reflect.deleteProperty(prototype, "addButton");
    Reflect.deleteProperty(prototype, "settingEl");
  }
}

/** Fake elements have no text-selection API; the caret restore needs one. */
function withCaretSupport<T>(run: () => T): T {
  const prototype = FakeElement.prototype as unknown as Record<string, unknown>;
  prototype.setSelectionRange = (): void => undefined;
  try {
    return run();
  } finally {
    Reflect.deleteProperty(prototype, "setSelectionRange");
  }
}

/** Production builds the download anchor and file picker with the global createEl. */
function withCreateEl<T>(document: FakeDocument, run: (created: FakeElement[]) => T): T {
  const created: FakeElement[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "createEl");
  Object.defineProperty(globalThis, "createEl", {
    configurable: true,
    value: (tag: string, options?: Record<string, unknown>) => {
      const element = document.createElement(tag, options ?? {});
      created.push(element);
      return element;
    },
  });
  try {
    return run(created);
  } finally {
    if (previous) Object.defineProperty(globalThis, "createEl", previous);
    else Reflect.deleteProperty(globalThis, "createEl");
  }
}

function indexManagerHarness(dom: ReturnType<typeof createFakeDom>, initialTab: string): {
  manager: {
    app: unknown;
    plugin: unknown;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    tab: string;
    query: string;
    selected: Set<string>;
    managerOpen: boolean;
    openedBaseId: string;
    openedDataEpoch: number;
    searchTimer: number | null;
    pendingTimers: Set<number>;
    selectionButtons: unknown[];
    noteListCache: Map<string, unknown>;
    render(): void;
  };
  scans: () => number;
} {
  let vaultScans = 0;
  const vaultFiles = [new TFile("Knowledge Base/Alpha.md"), new TFile("Knowledge Base/Beta.md")];
  const plugin = {
    data: {
      settings: { indexLabel: "Knowledge Index", groupLabel: "Group", itemSingular: "note", itemPlural: "notes" },
      manualIndexPaths: [],
      excludedIndexPaths: [],
      displayNameByPath: {},
    },
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 3,
    getIndexRecords: () => [],
    getRecords: () => [],
    getIndexGroups: () => [],
    getIndexDiagnostics: () => [],
    // Stands in for getVaultNoteFiles(): the full vault.getMarkdownFiles()
    // scan, two filters, and the locale sort that must not run per keystroke.
    getIndexCandidateFiles: () => { vaultScans += 1; return vaultFiles; },
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    canVisuallyMoveAcrossGroups: () => true,
  };
  const manager = Object.create(IndexManagerModal.prototype) as ReturnType<typeof indexManagerHarness>["manager"];
  manager.app = { vault: { getAbstractFileByPath: () => null } };
  manager.plugin = plugin;
  manager.contentEl = asHtmlElement(dom.document.body.createDiv());
  manager.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  manager.tab = initialTab;
  manager.query = "";
  manager.selected = new Set();
  manager.managerOpen = true;
  manager.openedBaseId = "base-a";
  manager.openedDataEpoch = 3;
  manager.searchTimer = null;
  manager.pendingTimers = new Set();
  manager.selectionButtons = [];
  manager.noteListCache = new Map();
  return { manager, scans: () => vaultScans };
}

test("index manager keystrokes filter one cached vault snapshot instead of rescanning", () => {
  const dom = createFakeDom();
  const { manager, scans } = indexManagerHarness(dom, "available");

  // A global window exists in Obsidian; installing one keeps this test about
  // the number of vault scans rather than about timer window resolution.
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { setTimeout: (callback: () => void) => { callback(); return 1; }, clearTimeout: () => undefined } },
  });
  try {
  withSettingStub(() => withCaretSupport(() => {
    manager.render();
    assert.equal(scans(), 1, "the first paint reads the vault once");
    assert.equal(manager.contentEl.querySelectorAll(".ent-cc-manager-note").length, 2);

    for (const value of ["a", "al", "alp"]) {
      const search = manager.contentEl.querySelector('.ent-cc-manager-toolbar input[type="search"]') as unknown as {
        value: string;
        dispatch(type: string): void;
      } | null;
      assert.ok(search);
      search.value = value;
      search.dispatch("input");
    }

    assert.equal(scans(), 1, "every keystroke reuses the snapshot it is filtering");
    assert.equal(manager.query, "alp");
    assert.equal(manager.contentEl.querySelectorAll(".ent-cc-manager-note").length, 1, "the filter still narrowed the list");

    // Switching to another list builds only that list. It must not enumerate
    // Available notes merely to fill an inactive badge.
    const hidden = manager.contentEl.querySelector('[data-manager-tab="hidden"]');
    assert.ok(hidden);
    hidden.click();
    assert.equal(scans(), 1, "the Hidden tab does not enumerate Available notes");

    // Returning to Available deliberately refreshes its vault-derived list:
    // files may have appeared without advancing plugin data state.
    const available = manager.contentEl.querySelector('[data-manager-tab="available"]');
    assert.ok(available);
    available.click();
    assert.equal(scans(), 2, "opening Available again re-reads the vault");
  }));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("oversized JSON is refused before it is read at the backup import site", async () => {
  const dom = createFakeDom();
  const oversized = { size: 10 * 1024 * 1024 + 1, text: async (): Promise<string> => "{}" };

  Notice.messages.length = 0;
  let backupValues = 0;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: unknown;
    plugin: unknown;
    loadedBaseId: string;
    loadedDataEpoch: number;
    importOrganizationBackup(): void;
    confirmOrganizationImport(value: unknown, ownsBase?: () => boolean): void;
  };
  view.app = {};
  view.plugin = { getActiveKnowledgeBaseId: () => "base-a", getDataEpoch: () => 1 };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.confirmOrganizationImport = () => { backupValues += 1; };

  await withCreateEl(dom.document, async (created) => {
    view.importOrganizationBackup();
    const input = created.find((element) => element.tagName === "input");
    assert.ok(input);
    (input as unknown as { files: unknown[] }).files = [oversized];
    input.dispatch("change");
    await settleMicrotasks();
  });

  assert.equal(backupValues, 0, "the backup import never parsed the oversized file");
  assert.equal(Notice.messages.filter((message) => message.includes("larger than the 10 MB import limit")).length, 1);

  // A file inside the cap still reaches the parser, so the guard is a cap and
  // not a blanket refusal.
  Notice.messages.length = 0;
  await withCreateEl(dom.document, async (created) => {
    view.importOrganizationBackup();
    const input = created.find((element) => element.tagName === "input");
    assert.ok(input);
    (input as unknown as { files: unknown[] }).files = [{ size: 12, text: async (): Promise<string> => '{"kind":"x"}' }];
    input.dispatch("change");
    await settleMicrotasks();
  });
  assert.equal(backupValues, 1);
  assert.deepEqual(Notice.messages, []);
});

test("the shared stale-base guard blocks every later action and notices exactly once", () => {
  Notice.messages.length = 0;
  const opened = { id: "opened" };
  const replaced = { id: "replaced" };
  let liveData: object = opened;
  let baseId = "base-a";
  let epoch = 4;
  let generation = 2;
  let stales = 0;
  const host = {
    get data(): object { return liveData; },
    getActiveKnowledgeBaseId: () => baseId,
    getDataEpoch: () => epoch,
    getExternalChangeGeneration: () => generation,
  };
  const guard = createOpenedBaseGuard(host, { message: "Stale base.", onStale: () => { stales += 1; } });

  assert.equal(guard(), true);
  assert.equal(guard.owns(), true);

  // Same id and epoch, but Sync handed the plugin a replacement data object.
  liveData = replaced;
  assert.equal(guard(), false);
  assert.equal(guard(), false);
  assert.equal(guard.owns(), false, "the silent variant agrees without a side effect");
  assert.equal(stales, 2, "every blocked action still closes its surface");
  assert.equal(Notice.messages.filter((message) => message === "Stale base.").length, 1);

  // Each of the four captured facts invalidates on its own.
  for (const drift of [
    (): void => { liveData = opened; baseId = "base-b"; },
    (): void => { baseId = "base-a"; epoch = 5; },
    (): void => { epoch = 4; generation = 3; },
  ]) {
    Notice.messages.length = 0;
    liveData = opened;
    baseId = "base-a";
    epoch = 4;
    generation = 2;
    const scoped = createOpenedBaseGuard(host, { message: "Stale base." });
    assert.equal(scoped(), true);
    drift();
    assert.equal(scoped(), false);
    assert.equal(Notice.messages.length, 1);
  }
});

// The two Library surfaces keep hand-rolled guards. These tests pin the exact
// behaviours createOpenedBaseGuard cannot express, so a later consolidation
// pass can see what it would have to break before it tries.
test("the Library editor answers every stale Save, unlike the latched shared guard", () => {
  Notice.messages.length = 0;
  let epoch = 0;
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => epoch,
  };
  const modal = new LibraryEditorModal(
    plugin as unknown as ConstructorParameters<typeof LibraryEditorModal>[0],
    null,
  );
  const harness = modal as unknown as { isCurrent(): boolean };

  assert.equal(harness.isCurrent(), true);
  assert.deepEqual(Notice.messages, []);

  // A synced write bumped the epoch under the open editor.
  epoch += 1;
  assert.equal(harness.isCurrent(), false);
  assert.equal(harness.isCurrent(), false);
  assert.equal(harness.isCurrent(), false);

  // Every rejected Save answers the user. createOpenedBaseGuard latches its
  // notice to exactly one for the guard's lifetime, so adopting it here would
  // leave the Save button silently dead from the second press onward.
  assert.equal(
    Notice.messages.filter((message) => /Reopen this dialog before continuing/.test(message)).length,
    3,
  );
});

test("Manage Libraries re-baselines its epoch after its own write and re-arms the stale notice", async () => {
  Notice.messages.length = 0;
  let epoch = 0;
  const plugin = {
    app: {},
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => epoch,
  };
  const modal = new ManageLibrariesModal(
    plugin as unknown as ConstructorParameters<typeof ManageLibrariesModal>[0],
  );
  const harness = modal as unknown as {
    isCurrent(): boolean;
    render(): void;
    run(action: () => Promise<void>): Promise<void>;
    afterNestedMutation(): void;
  };
  harness.render = () => undefined;

  // Its own archive/reorder advances the epoch. The guard follows it, because
  // the modal must not read its own mutation as someone else's staleness.
  await harness.run(async () => { epoch += 1; });
  assert.equal(harness.isCurrent(), true);
  assert.deepEqual(Notice.messages, []);

  // A foreign write is still stale, and still notices only once.
  epoch += 1;
  assert.equal(harness.isCurrent(), false);
  assert.equal(harness.isCurrent(), false);
  assert.equal(Notice.messages.length, 1);

  // A nested editor's save re-baselines from the stale state and re-arms the
  // latch, so the next foreign write is announced again. The shared factory
  // captures its epoch in a closure const and latches its notice permanently;
  // neither can be re-armed without rebuilding the guard and losing the
  // identity it was constructed to hold.
  harness.afterNestedMutation();
  assert.equal(harness.isCurrent(), true);
  epoch += 1;
  assert.equal(harness.isCurrent(), false);
  assert.equal(Notice.messages.length, 2);
});

test("guarded timers schedule on the window that owns the modal, not the focused one", () => {
  const owner = createFakeDom();
  const focused = createFakeDom();
  let ownerTimers = 0;
  let focusedTimers = 0;
  const ownerSetTimeout = owner.window.setTimeout.bind(owner.window);
  owner.window.setTimeout = (callback, delay) => { ownerTimers += 1; return ownerSetTimeout(callback, delay); };
  focused.window.setTimeout = () => { focusedTimers += 1; return 1; };

  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: focused.window });
  try {
    const contentEl = owner.document.body.createDiv();
    assert.equal(modalOwnerWindow(contentEl as unknown as HTMLElement), owner.window as unknown as Window);
    let ran = 0;
    setGuardedTimer({
      contentEl: contentEl as unknown as HTMLElement,
      timers: new Set<number>(),
      proceed: () => true,
      action: () => { ran += 1; },
      delay: 0,
    });
    assert.equal(ran, 1);
    assert.equal(ownerTimers, 1);
    assert.equal(focusedTimers, 0, "a pop-out modal must not queue work on the focused window");

    let blocked = 0;
    setGuardedTimer({
      contentEl: contentEl as unknown as HTMLElement,
      timers: new Set<number>(),
      proceed: () => false,
      action: () => { blocked += 1; },
      delay: 0,
    });
    assert.equal(blocked, 0, "a stale or closed surface drops its callback");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a collection move whose target vanished keeps the source membership and says so", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.collections.push(
    { id: "col-source", title: "Source", collapsed: false, subjects: ["Notes/Kept.md"], subheadings: [] },
    { id: "col-target", title: "Target", collapsed: false, subjects: [], subheadings: [] },
  );
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    async mutate(_label: string, mutator: () => void): Promise<void> { mutator(); },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openCollectionPicker(path: string, source?: { headingId: string; subheadingId?: string }, move?: boolean): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;

  const pickerOpen = Object.getOwnPropertyDescriptor(CollectionPickerModal.prototype, "open");
  let submitted: Promise<void> = Promise.resolve();
  CollectionPickerModal.prototype.open = function chooseVanishedTarget(): void {
    const modal = this as unknown as {
      onChooseItem(item: { headingId: string; subheadingId?: string; label: string }): void;
    };
    // The heading disappears between menu build and choice — a same-epoch
    // deletion the base guard cannot see (second window, stale row).
    data.collections = data.collections.filter((heading) => heading.id !== "col-target");
    submitted = Promise.resolve(modal.onChooseItem({ headingId: "col-target", label: "Target" }));
  };
  try {
    view.openCollectionPicker("Notes/Kept.md", { headingId: "col-source" }, true);
    await submitted;
    await settleMicrotasks();
  } finally {
    if (pickerOpen) Object.defineProperty(CollectionPickerModal.prototype, "open", pickerOpen);
    else Reflect.deleteProperty(CollectionPickerModal.prototype, "open");
  }

  assert.deepEqual(
    data.collections.find((heading) => heading.id === "col-source")?.subjects,
    ["Notes/Kept.md"],
    "a move to a vanished target must not remove the source membership",
  );
  assert.equal(Notice.messages.some((message) => message.includes("no longer exists")), true);
  assert.equal(Notice.messages.some((message) => message.includes("Moved in My Collections")), false);
});

test("the setup wizard's home folder nests every plugin folder under one parent", () => {
  const base = {
    workspaceName: "My KB", workspaceSubtitle: "", indexLabel: "Index", itemSingular: "note",
    itemPlural: "notes", groupLabel: "Group", primaryFolder: "Knowledge Base", proposalFolder: "Inbox",
    inboxLabel: "Inbox", defaultNoteFolder: "Knowledge Base", idProperty: "id", groupProperty: "category",
    parentProperty: "parent", templatesFolder: "Templates", defaultNewNoteMode: "template" as const,
    defaultTemplatePath: "Templates/Note.md", exportsFolder: DEFAULT_EXPORTS_FOLDER,
  };
  const nested = nestSetupFoldersUnderHome(base, " /KB/ ");
  assert.equal(nested.primaryFolder, "KB/Knowledge Base");
  assert.equal(nested.proposalFolder, "KB/Inbox");
  assert.equal(nested.defaultNoteFolder, "KB/Knowledge Base");
  assert.equal(nested.templatesFolder, "KB/Templates");
  assert.equal(nested.exportsFolder, "KB/Exports", "the long default leaf collapses to Exports");
  assert.equal(nested.defaultTemplatePath, "", "a template path outside the new templates folder is cleared for re-picking");
  assert.equal(nested.workspaceName, "My KB", "non-folder fields pass through untouched");
  // Empty templates folder means "any Markdown note" — nesting must not invent one.
  assert.equal(nestSetupFoldersUnderHome({ ...base, templatesFolder: "" }, "KB").templatesFolder, "");
  assert.deepEqual(nestSetupFoldersUnderHome(base, "   "), base, "a blank home folder changes nothing");
});

test("Command Center return capture reads the live wide and compact scroll owners", () => {
  const dom = createFakeDom();
  const tree = asHtmlElement(dom.document.body.createDiv());
  const workspace = asHtmlElement(dom.document.body.createDiv());
  const inspector = asHtmlElement(dom.document.body.createDiv());
  const inspectorBody = asHtmlElement(inspector.createDiv({ cls: "ent-cc-inspector-body" }));
  tree.scrollTop = 321;
  workspace.scrollTop = 654;
  inspector.scrollTop = 42;
  inspectorBody.scrollTop = 84;
  const data = migrateData(null);
  data.activeTab = "collections";
  data.selectedPath = "Notes/Selected.md";
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as {
    plugin: { data: PluginData };
    paneLayout: "wide" | "compact";
    treeEl: HTMLElement | null;
    workspaceEl: HTMLElement | null;
    inspectorEl: HTMLElement | null;
    query: string;
    mobileInspectorOpen: boolean;
    mobileTreeScrollTop: number;
    mobileInspectorScrollTop: number;
    browseRowLimit: number;
    browseStructureLimit: number;
    captureReturnViewState(): {
      activeTab: string;
      selectedPath: string;
      query: string;
      detailVisible: boolean;
      browseRowLimit: number;
      browseStructureLimit: number;
      listScrollTop: number;
      detailScrollTop: number;
    };
  };
  view.plugin = { data };
  view.paneLayout = "wide";
  view.treeEl = tree;
  view.workspaceEl = workspace;
  view.inspectorEl = inspector;
  view.query = "status:reviewed";
  view.mobileInspectorOpen = true;
  view.mobileTreeScrollTop = 0;
  view.mobileInspectorScrollTop = 0;
  view.browseRowLimit = 900;
  view.browseStructureLimit = 600;

  assert.deepEqual(view.captureReturnViewState(), {
    activeTab: "collections",
    selectedPath: "Notes/Selected.md",
    query: "status:reviewed",
    detailVisible: true,
    browseRowLimit: 900,
    browseStructureLimit: 600,
    listScrollTop: 321,
    detailScrollTop: 42,
  });

  view.paneLayout = "compact";
  assert.deepEqual(view.captureReturnViewState(), {
    activeTab: "collections",
    selectedPath: "Notes/Selected.md",
    query: "status:reviewed",
    detailVisible: true,
    browseRowLimit: 900,
    browseStructureLimit: 600,
    listScrollTop: 654,
    detailScrollTop: 84,
  });
});

test("Command Center return restores its exact route and unrelated notes can open a clean home", async () => {
  const dom = createFakeDom();
  const workspace = asHtmlElement(dom.document.body.createDiv());
  const content = asHtmlElement(dom.document.body.createDiv());
  const inspector = asHtmlElement(dom.document.body.createDiv());
  const inspectorBody = asHtmlElement(inspector.createDiv({ cls: "ent-cc-inspector-body" }));
  const selected = record("Notes/Selected.md", "Selected");
  const data = migrateData(null);
  data.settings.defaultTab = "collections";
  data.activeTab = "curriculum";
  let saves = 0;
  let renders = 0;
  let failSave = false;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-main",
    getDataEpoch: () => 7,
    getLibraries: () => [{
      id: "resources", name: "Resources", singularName: "Resource", icon: "library",
      order: 0, sourceKind: null, archivedAt: null,
    } satisfies LibraryDefinition],
    saveViewState: async (
      _withinOperation = false,
      onDeviceLocalPersistenceFailure?: (error: unknown) => void,
    ) => {
      saves += 1;
      if (!failSave) return;
      const error = new Error("device-local storage unavailable");
      if (onDeviceLocalPersistenceFailure) onDeviceLocalPersistenceFailure(error);
      else throw error;
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as {
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    paneLayout: "compact";
    contentEl: HTMLElement;
    workspaceEl: HTMLElement;
    treeEl: HTMLElement | null;
    inspectorEl: HTMLElement;
    query: string;
    parsedQuery: ReturnType<typeof parseQuery>;
    mobileInspectorOpen: boolean;
    mobileInspectorNeedsFocus: boolean;
    mobileTreeScrollTop: number;
    mobileInspectorScrollTop: number;
    browseRowLimit: number;
    browseStructureLimit: number;
    pendingReturnScroll: unknown;
    globalSearchResult: null;
    globalSearchResultKey: string;
    globalSearchResultScopeKey: string;
    globalSearchPendingKey: string;
    globalSearchErrorKey: string;
    globalSearchErrorMessage: string;
    globalSearchRequestGeneration: number;
    timerWindow: { requestAnimationFrame(callback: () => void): number };
    viewClosed: boolean;
    render(): void;
    restoreReturnViewState(state: {
      activeTab: "library:resources";
      selectedPath: string;
      query: string;
      detailVisible: boolean;
      browseRowLimit: number;
      browseStructureLimit: number;
      listScrollTop: number;
      detailScrollTop: number;
    }): Promise<boolean>;
    openHomePage(): Promise<void>;
  };
  Object.assign(view, {
    plugin,
    loadedBaseId: "base-main",
    loadedDataEpoch: 7,
    staleViewNoticeShown: false,
    records: [selected],
    recordByPath: new Map([[selected.path, selected]]),
    paneLayout: "compact" as const,
    contentEl: content,
    workspaceEl: workspace,
    treeEl: null,
    inspectorEl: inspector,
    query: "",
    parsedQuery: parseQuery(""),
    mobileInspectorOpen: false,
    mobileInspectorNeedsFocus: false,
    mobileTreeScrollTop: 0,
    mobileInspectorScrollTop: 0,
    browseRowLimit: 300,
    browseStructureLimit: 300,
    pendingReturnScroll: null,
    globalSearchResult: null,
    globalSearchResultKey: "",
    globalSearchResultScopeKey: "",
    globalSearchPendingKey: "",
    globalSearchErrorKey: "",
    globalSearchErrorMessage: "",
    globalSearchRequestGeneration: 0,
    timerWindow: { requestAnimationFrame: (callback: () => void) => { callback(); return 0; } },
    viewClosed: false,
    render: () => { renders += 1; },
  });

  const restored = await view.restoreReturnViewState({
    activeTab: "library:resources",
    selectedPath: selected.path,
    query: "type:resource",
    detailVisible: true,
    browseRowLimit: 900,
    browseStructureLimit: 600,
    listScrollTop: 712,
    detailScrollTop: 93,
  });

  assert.equal(restored, true);
  assert.equal(data.activeTab, "library:resources");
  assert.equal(data.selectedPath, selected.path);
  assert.equal(view.query, "type:resource");
  assert.equal(view.mobileInspectorOpen, true);
  assert.equal(view.browseRowLimit, 900);
  assert.equal(view.browseStructureLimit, 600);
  assert.ok(view.pendingReturnScroll, "the search route keeps a deferred scroll restoration until results finish");
  assert.equal(workspace.scrollTop, 712);
  assert.equal(inspectorBody.scrollTop, 93);
  assert.equal(saves, 1);
  assert.equal(renders, 1);

  await view.openHomePage();
  assert.equal(data.activeTab, "collections");
  assert.equal(data.selectedPath, "");
  assert.equal(view.query, "");
  assert.equal(view.mobileInspectorOpen, false);
  assert.equal(view.pendingReturnScroll, null);
  assert.equal(workspace.scrollTop, 0);
  assert.equal(inspectorBody.scrollTop, 0);
  assert.equal(saves, 2);
  assert.equal(renders, 2);

  const noticeStart = Notice.messages.length;
  const originalWarn = console.warn;
  console.warn = () => {};
  failSave = true;
  try {
    assert.equal(await view.restoreReturnViewState({
      activeTab: "library:resources",
      selectedPath: selected.path,
      query: "",
      detailVisible: true,
      browseRowLimit: 600,
      browseStructureLimit: 600,
      listScrollTop: 222,
      detailScrollTop: 33,
    }), true, "a local write failure cannot block the explicit in-session return");
    await view.openHomePage();
  } finally {
    failSave = false;
    console.warn = originalWarn;
  }
  assert.equal(saves, 4);
  assert.equal(renders, 4, "both the saved page and Home render despite device-local write failures");
  assert.equal(data.activeTab, "collections");
  assert.equal(data.selectedPath, "");
  assert.equal(view.query, "");
  assert.equal(
    Notice.messages.slice(noticeStart).filter((message) => /could not preserve.*view state.*restart/iu.test(message)).length,
    2,
    "each navigation truthfully reports that only restart persistence failed",
  );
});

test("a deferred global search applies the matching return scroll after results render", async () => {
  const result = { groups: [], total: 0, rendered: 0 };
  let resolveSearch: ((value: typeof result) => void) | null = null;
  let renders = 0;
  let resets = 0;
  const restored: Array<[number, number]> = [];
  const plugin = {
    getActiveKnowledgeBaseId: () => "base-main",
    getDataEpoch: () => 5,
    getSearchGeneration: () => 9,
    searchKnowledgeBases: () => new Promise<typeof result>((resolve) => { resolveSearch = resolve; }),
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as {
    plugin: typeof plugin;
    query: string;
    viewClosed: boolean;
    globalSearchResult: typeof result | null;
    globalSearchResultKey: string;
    globalSearchResultScopeKey: string;
    globalSearchPendingKey: string;
    globalSearchErrorKey: string;
    globalSearchErrorMessage: string;
    globalSearchRequestGeneration: number;
    pendingReturnScroll: { searchKey: string; listScrollTop: number; detailScrollTop: number } | null;
    globalSearchKey(query?: string): string;
    requestGlobalSearch(key: string, query: string): void;
    renderTree(): void;
    resetSearchScrollPosition(): void;
    restoreReturnScrollPosition(list: number, detail: number): void;
  };
  Object.assign(view, {
    plugin,
    query: "airway",
    viewClosed: false,
    globalSearchResult: null,
    globalSearchResultKey: "",
    globalSearchResultScopeKey: "",
    globalSearchPendingKey: "",
    globalSearchErrorKey: "",
    globalSearchErrorMessage: "",
    globalSearchRequestGeneration: 0,
    pendingReturnScroll: null,
    renderTree: () => { renders += 1; },
    resetSearchScrollPosition: () => { resets += 1; },
    restoreReturnScrollPosition: (list: number, detail: number) => { restored.push([list, detail]); },
  });
  const key = view.globalSearchKey();
  view.pendingReturnScroll = { searchKey: key, listScrollTop: 712, detailScrollTop: 93 };

  view.requestGlobalSearch(key, view.query);
  await Promise.resolve();
  assert.ok(resolveSearch);
  resolveSearch(result);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(renders, 1);
  assert.equal(resets, 0, "ordinary search reset does not overwrite an exact pending return");
  assert.deepEqual(restored, [[712, 93]]);
  assert.equal(view.pendingReturnScroll, null);
});

test("explicit return focus enters compact detail and gives Home a stable tab target", () => {
  const dom = createFakeDom();
  const content = asHtmlElement(dom.document.body.createDiv());
  const tab = asHtmlElement(content.createEl("button", { attr: { "data-tab": "collections" } }));
  const inspector = asHtmlElement(content.createEl("aside"));
  const back = asHtmlElement(inspector.createEl("button", { cls: "ent-cc-inspector-close" }));
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as {
    paneLayout: "compact" | "wide";
    mobileInspectorOpen: boolean;
    contentEl: HTMLElement;
    inspectorEl: HTMLElement;
    timerWindow: { requestAnimationFrame(callback: () => void): number };
    viewClosed: boolean;
    focusReturnDestination(tab: "collections"): void;
  };
  Object.assign(view, {
    paneLayout: "compact" as const,
    mobileInspectorOpen: true,
    contentEl: content,
    inspectorEl: inspector,
    timerWindow: { requestAnimationFrame: (callback: () => void) => { callback(); return 1; } },
    viewClosed: false,
  });

  view.focusReturnDestination("collections");
  assert.equal(dom.document.activeElement, back, "an explicit compact return moves focus into the modal detail route");

  view.mobileInspectorOpen = false;
  view.focusReturnDestination("collections");
  assert.equal(dom.document.activeElement, tab, "Home and browse returns focus the active section tab without opening a keyboard");
});
