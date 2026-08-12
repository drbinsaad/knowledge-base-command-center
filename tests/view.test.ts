import assert from "node:assert/strict";
import test from "node:test";
import { Menu, Notice, TFile } from "obsidian";
import { AddActionModal, calculateModalViewportLayout, ConfirmModal, IndexGroupModal, KnowledgeNoteModal, RecordPickerModal, TextPromptModal, TopicEditorModal, VaultFilePickerModal } from "../src/modals.ts";
import {
  canRelinkPortableRecord,
  calculateSearchViewportLayout,
  EntVaultCommandCenterView,
  matchingKnowledgeBaseRecords,
  prepareKnowledgeBaseSearchResults,
  tabDefinitions,
} from "../src/view.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import {
  ExportImportCenterModal,
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
  createPersonalBackup,
  createWorkspaceConfig,
  emptyCurriculumTree,
  libraryTabId,
  migrateData,
  parseQuery,
  snapshotPersonal,
  type LibraryDefinition,
  type PluginData,
  type VaultRecord,
} from "../src/model.ts";
import { collectKnowledgeBaseSearchResults } from "../src/search.ts";
import { EntCommandCenterSettingsTab } from "../src/settings.ts";
import { LibraryEditorModal, ManageLibrariesModal } from "../src/library-modal.ts";
import { LibraryNoteProfileEditorModal } from "../src/library-profile-modal.ts";
import { createFakeDom } from "./support/fake-dom.ts";

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

test("link controls are limited to notes explicitly completed from portable placeholders", () => {
  assert.equal(canRelinkPortableRecord({ portableId: "local-medication" }), false);
  assert.equal(canRelinkPortableRecord({ portableId: "native-clinical", portableRelinkable: false }), false);
  assert.equal(canRelinkPortableRecord({ portableId: "imported", portableRelinkable: true }), true);
  assert.equal(canRelinkPortableRecord({ portableId: "imported", portableRelinkable: true, isPlaceholder: true }), false);
});

test("creating a note from a custom library carries its labels into the generic note form", () => {
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
      getTemplateFiles(): [];
      getLibrary(id: string): LibraryDefinition | null;
      getEffectiveLibraryNoteProfile(id: string): {
        folder: string;
        mode: "template";
        templatePath: string;
        inherited: { folder: false; mode: false; templatePath: false };
      };
      getPortableSubject(): null;
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
    getTemplateFiles: () => [],
    getLibrary: (id) => id === library.id ? library : null,
    getEffectiveLibraryNoteProfile: () => ({
      folder: "Reference notes",
      mode: "template",
      templatePath: "Templates/Reference.md",
      inherited: { folder: false, mode: false, templatePath: false },
    }),
    getPortableSubject: () => null,
  };
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  let options: {
    createLabel?: string;
    contextNotice?: string;
    initial?: { folder: string; mode: string; templatePath: string };
    tokenContext?: { library?: string; type?: string; category?: string };
  } | null = null;
  KnowledgeNoteModal.prototype.open = function openForTest(): void {
    options = (this as unknown as { options: typeof options }).options;
  };
  try {
    view.startCreateLibraryNote(library.id, { headingId: "heading-evidence", subheadingId: "sub-guidelines" });
  } finally {
    delete (KnowledgeNoteModal.prototype as { open?: () => void }).open;
  }

  assert.equal(options?.createLabel, "Reference");
  assert.match(options?.contextNotice ?? "", /classified in (?:the selected heading or subheading in )?Reference Sets after creation/i);
  assert.deepEqual(options?.initial, {
    title: "",
    folder: "Reference notes",
    mode: "template",
    templatePath: "Templates/Reference.md",
    addToCollection: false,
  });
  assert.deepEqual(options?.tokenContext, {
    id: "",
    category: "Guidelines",
    parent: "",
    library: "Reference Sets",
    type: "Reference",
  });
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
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    isClinicalMode: () => true,
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

  const results = prepareKnowledgeBaseSearchResults([
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

  const results = prepareKnowledgeBaseSearchResults([
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

test("Index Manager normalizes Arabic variants and indexes manual membership once per projection", () => {
  const manualIndexPaths = ["Knowledge Base/Manual.md"];
  let linearProbes = 0;
  const includes = manualIndexPaths.includes.bind(manualIndexPaths);
  manualIndexPaths.includes = (path, fromIndex) => {
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
      data: { manualIndexPaths: string[] };
      getIndexRecords(): VaultRecord[];
    };
    indexedNotes(): Array<{ path: string; title: string; meta: string }>;
    filterNotes(notes: Array<{ path: string; title: string; meta: string }>): Array<{ path: string; title: string; meta: string }>;
  };
  manager.plugin = { data: { manualIndexPaths }, getIndexRecords: () => records };

  const notes = manager.indexedNotes();
  assert.match(notes[0]?.meta ?? "", /manual membership/);
  assert.match(notes[1]?.meta ?? "", /folder index/);
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
    "heading" in definition && definition.heading === "Folders and templates"
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

test("standalone workspace import resets invalid templates and reports omitted Library profiles", async () => {
  Notice.messages.length = 0;
  const source = migrateData(null);
  const library = installLibrary(source);
  source.settings.templatesFolder = "Templates";
  source.settings.libraryNoteProfiles[library.id] = {
    folder: "Reference notes",
    mode: "empty",
    templatePath: "Outside Templates/Private.md",
  };
  const config = createWorkspaceConfig(source, "2026-08-11T00:00:00.000Z");
  config.settings.libraryNoteProfiles[library.id] = {
    folder: "Reference notes",
    mode: "template",
    templatePath: "../Private.md",
  };
  config.settings.libraryNoteProfiles["missing-library"] = {
    folder: "Missing Library",
    mode: "empty",
  };

  const destination = migrateData(null);
  installLibrary(destination, { ...library });
  let mutateOptions: { includeSettings?: boolean; requireUndo?: boolean } | null = null;
  const plugin = {
    data: destination,
    getLibraries: () => destination.portableIndex.libraries,
    isClinicalMode: () => false,
    invalidateRecordCache(): void {},
    async mutate(
      _label: string,
      action: () => void,
      options: { includeSettings?: boolean; requireUndo?: boolean },
    ): Promise<void> {
      mutateOptions = options;
      action();
    },
  };
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: { vault: { configDir: string; getAbstractFileByPath(path: string): null } };
    plugin: typeof plugin;
    diagnosticsCache: unknown;
    titleEl: { setText(value: string): void };
    tab: "indexed" | "available";
    guardOpenedBase(): boolean;
    ownsOpenedBase(): boolean;
    render(): void;
    confirmWorkspaceImport(input: Promise<unknown>): void;
  };
  manager.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  manager.plugin = plugin;
  manager.diagnosticsCache = null;
  manager.titleEl = { setText: () => undefined };
  manager.tab = "indexed";
  manager.guardOpenedBase = () => true;
  manager.ownsOpenedBase = () => true;
  manager.render = () => undefined;

  const opened: Array<{ onConfirm(): void | Promise<void> }> = [];
  const originalOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureConfirm(): void {
    opened.push(this);
  };
  try {
    manager.confirmWorkspaceImport(Promise.resolve(config));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(opened.length, 1);
    await opened[0]?.onConfirm();
  } finally {
    if (originalOpen) Object.defineProperty(ConfirmModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }

  assert.deepEqual(destination.settings.libraryNoteProfiles[library.id], {
    folder: "Reference notes",
    mode: "empty",
  });
  assert.equal(destination.settings.libraryNoteProfiles["missing-library"], undefined);
  assert.deepEqual(mutateOptions, { includeSettings: true, requireUndo: true });
  assert.ok(Notice.messages.some((message) => /1 Library profile referenced unavailable templates/i.test(message)));
  assert.ok(Notice.messages.some((message) => /1 Library profile did not match a destination Library/i.test(message)));
});

test("standalone workspace import rejects a lossy-invalid Library folder before confirmation or mutation", async () => {
  Notice.messages.length = 0;
  const source = migrateData(null);
  const library = installLibrary(source);
  const config = createWorkspaceConfig(source, "2026-08-11T00:00:00.000Z");
  config.settings.libraryNoteProfiles[library.id] = {
    folder: "../Escaped notes",
    mode: "empty",
  };
  const destination = migrateData(null);
  installLibrary(destination, { ...library });
  let mutationCount = 0;
  const plugin = {
    data: destination,
    getLibraries: () => destination.portableIndex.libraries,
    isClinicalMode: () => false,
    invalidateRecordCache(): void {},
    async mutate(): Promise<void> { mutationCount += 1; },
  };
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: { vault: { configDir: string; getAbstractFileByPath(path: string): null } };
    plugin: typeof plugin;
    guardOpenedBase(): boolean;
    ownsOpenedBase(): boolean;
    confirmWorkspaceImport(input: Promise<unknown>): void;
  };
  manager.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  manager.plugin = plugin;
  manager.guardOpenedBase = () => true;
  manager.ownsOpenedBase = () => true;

  const opened: unknown[] = [];
  const originalOpen = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureConfirm(): void { opened.push(this); };
  try {
    manager.confirmWorkspaceImport(Promise.resolve(config));
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    if (originalOpen) Object.defineProperty(ConfirmModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }

  assert.equal(opened.length, 0);
  assert.equal(mutationCount, 0);
  assert.ok(Notice.messages.some((message) => /unsupported folder path/i.test(message)));
  assert.equal(destination.settings.libraryNoteProfiles[library.id], undefined);
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
