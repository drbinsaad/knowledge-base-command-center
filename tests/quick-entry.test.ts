import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Notice, TFile } from "obsidian";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import type { CatalogPlacementTarget } from "../src/main.ts";
import {
  ATTACHMENT_PROTOCOL_ACTIONS,
  createQuickEntryCommands,
  privacySafeFixedActionRequest,
  privacySafeQuickEntryRequest,
  QUICK_APPEND_PROTOCOL_ACTIONS,
  QUICK_ENTRY_FOCUSED_PROTOCOL_ACTIONS,
  QUICK_ENTRY_PROTOCOL_ACTIONS,
  QUICK_ENTRY_PROTOCOL_ALLOWED_PARAMETER_KEYS,
  runQuickEntryFocusedProtocolAction,
} from "../src/quick-entry.ts";
import { createQuickEntryButton, EntVaultCommandCenterView } from "../src/view.ts";
import { AddActionModal, CollectionPickerModal, collectionTargets, IndexGroupModal, KnowledgeNoteModal, type KnowledgeNoteModalOptions, localDateStamp, type NoteDestinationSeed, TextPromptModal, VaultFilePickerModal } from "../src/modals.ts";
import { MAX_DEVICE_LOCAL_STATE_BYTES, migrateData, portablePlaceholderPath, type LibraryDefinition, type VaultRecord } from "../src/model.ts";
import { createFakeDom, asHtmlElement } from "./support/fake-dom.ts";

function quickEntryPlugin(): {
  plugin: EntVaultCommandCenterPlugin & { loadedData: unknown; savedData: unknown[] };
  sourceMutationCount: () => number;
} {
  let sourceMutations = 0;
  let deviceState: unknown = null;
  const forbiddenSourceMutation = (): never => {
    sourceMutations += 1;
    throw new Error("Quick Entry attempted to mutate a Markdown file.");
  };
  const app = {
    loadLocalStorage: () => structuredClone(deviceState),
    saveLocalStorage: (_key: string, value: unknown) => {
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_DEVICE_LOCAL_STATE_BYTES) {
        throw new Error("Quick Entry test device-local state exceeded the production limit.");
      }
      deviceState = structuredClone(value);
    },
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      create: forbiddenSourceMutation,
      modify: forbiddenSourceMutation,
      process: forbiddenSourceMutation,
      rename: forbiddenSourceMutation,
      delete: forbiddenSourceMutation,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {
      renameFile: forbiddenSourceMutation,
      processFrontMatter: forbiddenSourceMutation,
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.workspaceName = "Quick Entry test";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & {
    loadedData: unknown;
    savedData: unknown[];
  };
  plugin.loadedData = data;
  return { plugin, sourceMutationCount: () => sourceMutations };
}

test("Quick Entry commands are focused, icon-ready, and never assign default hotkeys", () => {
  const calls: string[] = [];
  const commands = createQuickEntryCommands({
    openHub: () => calls.push("hub"),
    createSubject: () => calls.push("subject"),
    createHeading: () => calls.push("heading"),
    createSubheading: () => calls.push("subheading"),
    createNote: () => calls.push("note"),
    addCurrentNote: () => calls.push("current"),
    addExistingNote: () => calls.push("existing"),
    appendCurrentNote: () => calls.push("append-current"),
    appendExistingNote: () => calls.push("append-existing"),
  });

  assert.deepEqual(commands.map((command) => command.id), [
    "quick-entry",
    "quick-create-subject",
    "quick-create-heading",
    "quick-create-subheading",
    "quick-create-note",
    "quick-add-current-note",
    "quick-add-existing-note",
    "quick-append-current-note",
    "quick-append-existing-note",
  ]);
  assert.equal(commands.every((command) => Boolean(command.icon)), true);
  assert.equal(commands.every((command) => !("hotkeys" in command)), true);
  commands.forEach((command) => command.callback?.());
  assert.deepEqual(calls, [
    "hub",
    "subject",
    "heading",
    "subheading",
    "note",
    "current",
    "existing",
    "append-current",
    "append-existing",
  ]);
});

test("Quick Entry protocol is action-only and fails closed for every query field", () => {
  assert.deepEqual(QUICK_ENTRY_PROTOCOL_ACTIONS, ["kbcc-quick-entry"]);
  assert.deepEqual(QUICK_ENTRY_PROTOCOL_ALLOWED_PARAMETER_KEYS, ["action"]);
  assert.equal(privacySafeQuickEntryRequest({ action: "kbcc-quick-entry" }).openHub, true);
  assert.equal(privacySafeQuickEntryRequest({}).openHub, false);
  assert.equal(privacySafeQuickEntryRequest({ action: "other" }).openHub, false);

  const sensitive = privacySafeQuickEntryRequest({
    action: "kbcc-quick-entry",
    title: "private title",
    path: "Private/Note.md",
    content: "private content",
    patient: "private patient",
  });
  assert.equal(sensitive.openHub, false);
  assert.deepEqual(sensitive.rejectedParameterKeys, ["content", "path", "patient", "title"]);
  assert.equal(JSON.stringify(sensitive).includes("private"), false, "rejected query values must not be retained");

  assert.deepEqual(QUICK_APPEND_PROTOCOL_ACTIONS, [
    "kbcc-quick-append-current",
    "kbcc-quick-append-existing",
  ]);
  assert.deepEqual(QUICK_ENTRY_FOCUSED_PROTOCOL_ACTIONS, [
    "kbcc-create-subject",
    "kbcc-create-heading",
    "kbcc-create-subheading",
    "kbcc-create-note",
    "kbcc-add-current-note",
    "kbcc-add-existing-note",
  ]);
  assert.deepEqual(ATTACHMENT_PROTOCOL_ACTIONS, ["kbcc-attach-current"]);
  for (const action of [
    ...QUICK_ENTRY_FOCUSED_PROTOCOL_ACTIONS,
    ...QUICK_APPEND_PROTOCOL_ACTIONS,
    ...ATTACHMENT_PROTOCOL_ACTIONS,
  ]) {
    assert.equal(privacySafeFixedActionRequest({ action }, action), true);
    assert.equal(privacySafeFixedActionRequest({ action, title: "private" }, action), false);
    assert.equal(privacySafeFixedActionRequest({ action, path: "Private/Note.md" }, action), false);
    assert.equal(privacySafeFixedActionRequest({ action, content: "private" }, action), false);
    assert.equal(privacySafeFixedActionRequest({ action, unknown: "private" }, action), false);
    assert.equal(privacySafeFixedActionRequest({ action: "other" }, action), false);
    assert.equal(privacySafeFixedActionRequest({}, action), false);
  }

  const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(mainSource, /if \(!privacySafeQuickEntryRequest\(parameters\)\.openHub\) return;/);
  assert.equal(
    mainSource.match(/if \(!privacySafeFixedActionRequest\(parameters, action\)\) return;/gu)?.length,
    3,
    "focused Quick Entry, Quick append, and Attach file protocol groups must each fail closed",
  );
  assert.match(mainSource, /runQuickEntryFocusedProtocolAction\(action, quickEntryHandlers\)/);
  assert.match(mainSource, /this\.openPrivacySafeAttachmentImportCurrentNote\(\)/);
});

test("fixed Quick Entry URLs dispatch through the command handlers", () => {
  const calls: string[] = [];
  const handlers = {
    openHub: () => calls.push("hub"),
    createSubject: () => calls.push("subject"),
    createHeading: () => calls.push("heading"),
    createSubheading: () => calls.push("subheading"),
    createNote: () => calls.push("note"),
    addCurrentNote: () => calls.push("current"),
    addExistingNote: () => calls.push("existing"),
    appendCurrentNote: () => calls.push("append-current"),
    appendExistingNote: () => calls.push("append-existing"),
  };

  for (const action of QUICK_ENTRY_FOCUSED_PROTOCOL_ACTIONS) {
    runQuickEntryFocusedProtocolAction(action, handlers);
  }

  assert.deepEqual(calls, ["subject", "heading", "subheading", "note", "current", "existing"]);
});

test("Attach-current protocol target is local, exact, writable, and privacy-safe", () => {
  Notice.messages.length = 0;
  const note = new TFile("Notes/Eligible.md");
  let active: TFile | null = note;
  let current: TFile | null = note;
  const app = {
    vault: { getAbstractFileByPath: () => current },
    workspace: { getActiveFile: () => active },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const opened: TFile[] = [];
  const target = plugin as unknown as {
    openAttachmentImport(note: TFile): void;
    openPrivacySafeAttachmentImportCurrentNote(): void;
  };
  target.openAttachmentImport = (file) => opened.push(file);

  target.openPrivacySafeAttachmentImportCurrentNote();
  assert.deepEqual(opened, [note]);
  assert.deepEqual(Notice.messages, []);

  const replacement = new TFile(note.path);
  current = replacement;
  target.openPrivacySafeAttachmentImportCurrentNote();
  assert.equal(opened.length, 1, "a same-path replacement must not inherit the active note action");
  assert.equal(Notice.messages.at(-1), "No eligible active Markdown note is available for attach file.");

  current = note;
  plugin.dataCompatibilityWarning = "private read-only reason";
  target.openPrivacySafeAttachmentImportCurrentNote();
  assert.equal(opened.length, 1);
  assert.equal(Notice.messages.at(-1), "No eligible active Markdown note is available for attach file.");
  assert.equal(Notice.messages.some((message) => message.includes("private")), false);

  plugin.dataCompatibilityWarning = "";
  active = new TFile("05 Sources/_books/Immutable.md");
  current = active;
  target.openPrivacySafeAttachmentImportCurrentNote();
  assert.equal(opened.length, 1);
  assert.equal(Notice.messages.at(-1), "No eligible active Markdown note is available for attach file.");

  active = null;
  current = null;
  target.openPrivacySafeAttachmentImportCurrentNote();
  assert.equal(opened.length, 1);
  assert.equal(Notice.messages.at(-1), "No eligible active Markdown note is available for attach file.");
});

test("Quick Entry delayed menus reject base switches and same-base data replacements", () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  let activeBaseId = "base-a";
  let dataEpoch = 1;
  const current = new TFile("Notes/Current.md");
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => activeBaseId,
    getDataEpoch: () => dataEpoch,
    getKnowledgeBases: () => [
      { id: "base-a", data },
      { id: "base-b", data: { ...data, settings: { ...data.settings, workspaceName: "Base B" } } },
    ],
    getLibraries: (): LibraryDefinition[] => [],
    getTemplateFiles: (): TFile[] => [],
    isClinicalMode: () => false,
  };
  const calls: string[] = [];
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: { vault: { getAbstractFileByPath(path: string): TFile | null }; workspace: { getActiveFile(): TFile } };
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startQuickCreateNote(): void;
    startCreateKnowledgeNote(): void;
    startLinkVaultNote(): void;
    startAddCurrentNote(): void;
  };
  view.app = {
    vault: { getAbstractFileByPath: (path) => path === current.path ? current : null },
    workspace: { getActiveFile: () => current },
  };
  view.plugin = plugin;
  view.loadedBaseId = activeBaseId;
  view.loadedDataEpoch = dataEpoch;
  view.staleViewNoticeShown = false;

  const pending: Array<AddActionModal & {
    getItems(): Array<{ id: string }>;
    onChooseItem(item: { id: string }): void;
  }> = [];
  const pendingForms: KnowledgeNoteModalOptions[] = [];
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const noteOpen = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  AddActionModal.prototype.open = function captureMenu(): void {
    pending.push(this);
  };
  KnowledgeNoteModal.prototype.open = function captureForm(): void {
    pendingForms.push((this as unknown as { options: KnowledgeNoteModalOptions }).options);
  };
  let destinationApplies = 0;
  try {
    view.startQuickCreateNote = () => calls.push("hub-create");
    view.openQuickEntry(current.path);
    activeBaseId = "base-b";
    const hub = pending.shift();
    const create = hub?.getItems().find((item) => item.id === "create-note");
    assert.ok(hub && create);
    hub.onChooseItem(create);

    activeBaseId = "base-a";
    dataEpoch = 2;
    view.loadedBaseId = activeBaseId;
    view.loadedDataEpoch = dataEpoch;
    view.startQuickCreateNote = EntVaultCommandCenterView.prototype.startQuickCreateNote.bind(view);
    view.startQuickCreateNote();
    dataEpoch = 3;
    const createForm = pendingForms.shift();
    assert.ok(createForm?.destination, "the generic quick-create form must carry a destination row");
    createForm.destination.onEdit(() => { destinationApplies += 1; });

    view.loadedDataEpoch = dataEpoch;
    view.startLinkVaultNote = () => calls.push("add-existing");
    view.startQuickAddExistingNote();
    activeBaseId = "base-b";
    const existingMenu = pending.shift();
    const collection = existingMenu?.getItems().find((item) => item.id === "collection");
    assert.ok(existingMenu && collection);
    existingMenu.onChooseItem(collection);

    activeBaseId = "base-a";
    dataEpoch = 4;
    view.loadedBaseId = activeBaseId;
    view.loadedDataEpoch = dataEpoch;
    view.startAddCurrentNote = () => calls.push("add-current");
    view.startQuickAddCurrentNote(current.path);
    dataEpoch = 5;
    const currentMenu = pending.shift();
    const currentCollection = currentMenu?.getItems().find((item) => item.id === "collection");
    assert.ok(currentMenu && currentCollection);
    currentMenu.onChooseItem(currentCollection);
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (noteOpen) Object.defineProperty(KnowledgeNoteModal.prototype, "open", noteOpen);
    else Reflect.deleteProperty(KnowledgeNoteModal.prototype, "open");
  }

  assert.deepEqual(calls, []);
  assert.equal(destinationApplies, 0, "a stale create form must not apply a destination change");
  assert.equal(pending.length, 0, "a stale create form must not open the destination picker");
  assert.equal(Notice.messages.filter((message) => message.includes("active knowledge base changed")).length >= 4, true);
});

test("Quick Entry base picker permits one deliberate switch but rejects an unrelated replacement", async () => {
  Notice.messages.length = 0;
  const baseA = migrateData(null);
  const baseB = migrateData(null);
  baseA.settings.workspaceName = "Base A";
  baseB.settings.workspaceName = "Base B";
  let activeBaseId = "base-a";
  let dataEpoch = 1;
  const switches: string[] = [];
  const reopened: Array<string | undefined> = [];
  const activeView = { openQuickEntry: (path?: string) => reopened.push(path) };
  const plugin = {
    data: baseA,
    getActiveKnowledgeBaseId: () => activeBaseId,
    getDataEpoch: () => dataEpoch,
    getKnowledgeBases: () => [{ id: "base-a", data: baseA }, { id: "base-b", data: baseB }],
    async switchKnowledgeBase(id: string): Promise<void> {
      switches.push(id);
      activeBaseId = id;
      this.data = id === "base-b" ? baseB : baseA;
      dataEpoch += 1;
    },
    async activateView(): Promise<typeof activeView> { return activeView; },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openQuickEntryBasePicker(path?: string): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = activeBaseId;
  view.loadedDataEpoch = dataEpoch;
  view.staleViewNoticeShown = false;

  const pending: Array<AddActionModal & { getItems(): Array<{ id: string }>; onChooseItem(item: { id: string }): void }> = [];
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  AddActionModal.prototype.open = function capturePicker(): void {
    pending.push(this);
  };
  try {
    view.openQuickEntryBasePicker("Notes/Current.md");
    const deliberate = pending.shift();
    const baseBAction = deliberate?.getItems().find((item) => item.id === "base-b");
    assert.ok(deliberate && baseBAction);
    deliberate.onChooseItem(baseBAction);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(switches, ["base-b"]);
    assert.deepEqual(reopened, ["Notes/Current.md"]);

    activeBaseId = "base-a";
    plugin.data = baseA;
    dataEpoch += 1;
    view.loadedBaseId = activeBaseId;
    view.loadedDataEpoch = dataEpoch;
    view.openQuickEntryBasePicker();
    const stale = pending.shift();
    const staleBaseBAction = stale?.getItems().find((item) => item.id === "base-b");
    assert.ok(stale && staleBaseBAction);
    dataEpoch += 1;
    stale.onChooseItem(staleBaseBAction);
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
  }

  assert.deepEqual(switches, ["base-b"], "a same-base replacement must invalidate the old picker");
  assert.deepEqual(reopened, ["Notes/Current.md"]);
});

test("Quick Entry asks for and forwards the selected Library heading or subheading", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library: LibraryDefinition = {
    id: "reading",
    name: "Reading",
    singularName: "Reading item",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  };
  data.portableIndex.libraries.push(library);
  data.portableIndex.libraryLayouts[library.id] = [{
    id: "heading-a",
    title: "Airway",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "subheading-a", title: "Pediatric", collapsed: false, subjects: [] }],
  }];
  const current = new TFile("Notes/Current.md");
  const createdFile = new TFile("Reading notes/New item.md");
  const assignments: Array<{ path: string; libraryId: string; target: CatalogPlacementTarget }> = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getLibraries: () => [library],
    getLibrary: (id: string) => id === library.id ? library : null,
    getTemplateFiles: (): TFile[] => [],
    getEffectiveLibraryNoteProfile: () => ({
      folder: "Reading notes",
      mode: "empty" as const,
      templatePath: "",
      inherited: { folder: false, mode: true, templatePath: true },
    }),
    isClinicalMode: () => false,
    validateGenericNote: () => null,
    async createKnowledgeNote(): Promise<TFile> { return createdFile; },
    async assignRecordToLibrary(path: string, libraryId: string, target: CatalogPlacementTarget = {}): Promise<void> {
      assignments.push({ path, libraryId, target });
    },
    async openFile(): Promise<void> { /* opening is not under test */ },
  };
  const routed: Array<{ flow: string; libraryId: string; path?: string; target: CatalogPlacementTarget }> = [];
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: { vault: { getAbstractFileByPath(path: string): TFile | null }; workspace: { getActiveFile(): TFile } };
    plugin: typeof plugin;
    records: VaultRecord[];
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startAddExistingToLibrary(libraryId: string, target?: CatalogPlacementTarget): void;
    startAddCurrentToLibrary(libraryId: string, path?: string, target?: CatalogPlacementTarget): void;
  };
  view.app = {
    vault: { getAbstractFileByPath: (path) => path === current.path ? current : null },
    workspace: { getActiveFile: () => current },
  };
  view.plugin = plugin;
  view.records = [];
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;
  view.startAddExistingToLibrary = (libraryId, target = {}) => routed.push({ flow: "existing", libraryId, target });
  view.startAddCurrentToLibrary = (libraryId, path, target = {}) => routed.push({ flow: "current", libraryId, path, target });

  const forms: KnowledgeNoteModalOptions[] = [];
  const seeds: NoteDestinationSeed[] = [];
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const collectionOpen = Object.getOwnPropertyDescriptor(CollectionPickerModal.prototype, "open");
  const noteOpen = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  AddActionModal.prototype.open = function chooseLibrary(): void {
    const modal = this as unknown as { getItems(): Array<{ id: string }>; onChooseItem(item: { id: string }): void };
    const action = modal.getItems().find((item) => item.id === `library:${library.id}`);
    assert.ok(action);
    modal.onChooseItem(action);
  };
  CollectionPickerModal.prototype.open = function chooseSubheading(): void {
    const modal = this as unknown as {
      getItems(): Array<{ headingId: string; subheadingId?: string }>;
      onChooseItem(item: { headingId: string; subheadingId?: string }): void;
    };
    const target = modal.getItems().find((item) => item.subheadingId === "subheading-a");
    assert.ok(target);
    modal.onChooseItem(target);
  };
  KnowledgeNoteModal.prototype.open = function captureForm(): void {
    forms.push((this as unknown as { options: KnowledgeNoteModalOptions }).options);
  };
  try {
    view.startQuickCreateNote();
    const form = forms.shift();
    assert.ok(form?.destination, "the generic quick-create form must carry a destination row");
    assert.equal(form.destination.label, data.settings.inboxLabel);
    assert.equal(form.initial.folder, data.settings.proposalFolder);
    form.destination.onEdit((seed) => seeds.push(seed));
    assert.deepEqual(seeds.map((seed) => seed.label), ["Reading / Airway / Pediatric"]);
    assert.equal(seeds[0]?.folder, "Reading notes");
    await form.onSubmit({ title: "New item", folder: "Reading notes", mode: "empty", templatePath: "", addToCollection: false });

    view.startQuickAddExistingNote();
    view.startQuickAddCurrentNote(current.path);
    await Promise.resolve();
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (collectionOpen) Object.defineProperty(CollectionPickerModal.prototype, "open", collectionOpen);
    else Reflect.deleteProperty(CollectionPickerModal.prototype, "open");
    if (noteOpen) Object.defineProperty(KnowledgeNoteModal.prototype, "open", noteOpen);
    else Reflect.deleteProperty(KnowledgeNoteModal.prototype, "open");
  }

  assert.deepEqual(assignments, [
    { path: createdFile.path, libraryId: library.id, target: { headingId: "heading-a", subheadingId: "subheading-a" } },
  ]);
  assert.deepEqual(routed, [
    { flow: "existing", libraryId: library.id, target: { headingId: "heading-a", subheadingId: "subheading-a" } },
    { flow: "current", libraryId: library.id, path: current.path, target: { headingId: "heading-a", subheadingId: "subheading-a" } },
  ]);
});

test("Quick Entry creates a first Library heading before continuing an empty-Library flow", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library: LibraryDefinition = {
    id: "empty-library",
    name: "Reading",
    singularName: "Reading item",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  };
  data.portableIndex.libraries.push(library);
  data.portableIndex.libraryLayouts[library.id] = [];
  const created: string[] = [];
  const createdFile = new TFile("Reading notes/Captured.md");
  const assignments: Array<{ path: string; libraryId: string; target: CatalogPlacementTarget }> = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getLibraries: () => [library],
    getLibrary: (id: string) => id === library.id ? library : null,
    getTemplateFiles: (): TFile[] => [],
    getEffectiveLibraryNoteProfile: () => ({
      folder: "Reading notes",
      mode: "empty" as const,
      templatePath: "",
      inherited: { folder: false, mode: true, templatePath: true },
    }),
    isClinicalMode: () => false,
    validateGenericNote: () => null,
    async createQuickEntryLibraryHeading(_libraryId: string, title: string): Promise<string> {
      created.push(title);
      return "first-heading";
    },
    async createKnowledgeNote(): Promise<TFile> { return createdFile; },
    async assignRecordToLibrary(path: string, libraryId: string, target: CatalogPlacementTarget = {}): Promise<void> {
      assignments.push({ path, libraryId, target });
    },
    async openFile(): Promise<void> { /* opening is not under test */ },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;

  const forms: KnowledgeNoteModalOptions[] = [];
  const seeds: NoteDestinationSeed[] = [];
  let submitted: Promise<void> = Promise.resolve();
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const textOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
  const noteOpen = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  AddActionModal.prototype.open = function chooseLibrary(): void {
    const modal = this as unknown as { getItems(): Array<{ id: string }>; onChooseItem(item: { id: string }): void };
    const action = modal.getItems().find((item) => item.id === `library:${library.id}`);
    assert.ok(action);
    modal.onChooseItem(action);
  };
  TextPromptModal.prototype.open = function createFirstHeading(): void {
    const options = (this as unknown as { options: { onSubmit(title: string): void | Promise<void> } }).options;
    submitted = Promise.resolve(options.onSubmit("Quick captures"));
  };
  KnowledgeNoteModal.prototype.open = function captureForm(): void {
    forms.push((this as unknown as { options: KnowledgeNoteModalOptions }).options);
  };
  try {
    view.startQuickCreateNote();
    const form = forms.shift();
    assert.ok(form?.destination, "the generic quick-create form must carry a destination row");
    form.destination.onEdit((seed) => seeds.push(seed));
    await submitted;
    assert.deepEqual(seeds.map((seed) => seed.label), ["Reading"]);
    await form.onSubmit({ title: "Captured", folder: "Reading notes", mode: "empty", templatePath: "", addToCollection: false });
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (textOpen) Object.defineProperty(TextPromptModal.prototype, "open", textOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
    if (noteOpen) Object.defineProperty(KnowledgeNoteModal.prototype, "open", noteOpen);
    else Reflect.deleteProperty(KnowledgeNoteModal.prototype, "open");
  }

  assert.deepEqual(created, ["Quick captures"]);
  assert.deepEqual(assignments, [
    { path: createdFile.path, libraryId: library.id, target: { headingId: "first-heading" } },
  ]);
});

test("Library create and add services preserve the Quick Entry placement target", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const library: LibraryDefinition = {
    id: "reading",
    name: "Reading",
    singularName: "Reading item",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  };
  const createdFile = new TFile("Notes/Created.md");
  const existingFile = new TFile("Notes/Existing.md");
  const currentFile = new TFile("Notes/Current.md");
  const target = { headingId: "heading-a", subheadingId: "subheading-a" };
  data.portableIndex.libraries = [library];
  data.portableIndex.libraryLayouts[library.id] = [{
    id: target.headingId,
    title: "Evidence",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: target.subheadingId,
      title: "Guidelines",
      collapsed: false,
      subjects: [],
    }],
  }];
  const assignments: Array<{ path: string; libraryId: string; target: CatalogPlacementTarget }> = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    isClinicalMode: () => false,
    getLibrary: (id: string) => id === library.id ? library : null,
    getEffectiveLibraryNoteProfile: () => ({
      folder: data.settings.defaultNoteFolder,
      mode: data.settings.defaultNewNoteMode,
      templatePath: data.settings.defaultTemplatePath,
      inherited: { folder: true, mode: true, templatePath: true },
    }),
    getPortableSubject: () => null,
    getVaultNoteFiles: () => [existingFile],
    async assignRecordToLibrary(path: string, libraryId: string, placement: CatalogPlacementTarget): Promise<void> {
      assignments.push({ path, libraryId, target: placement });
    },
    async createKnowledgeNoteInLibrary(
      _value: unknown,
      libraryId: string,
      placement: CatalogPlacementTarget,
    ): Promise<TFile> {
      assignments.push({ path: createdFile.path, libraryId, target: placement });
      return createdFile;
    },
  };
  let onCreated: ((file: TFile) => void | Promise<void>) | undefined;
  let createNote: ((value: unknown) => Promise<TFile>) | undefined;
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: { vault: { getAbstractFileByPath(path: string): TFile | null }; workspace: { getActiveFile(): TFile } };
    plugin: typeof plugin;
    records: VaultRecord[];
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startCreateKnowledgeNote(
      initial?: object,
      indexAfterCreate?: boolean,
      created?: (file: TFile) => void | Promise<void>,
      completionMessage?: string,
      formContext?: { createNote?: (value: unknown) => Promise<TFile> },
    ): void;
    startCreateLibraryNote(libraryId: string, placement?: CatalogPlacementTarget): void;
    startAddExistingToLibrary(libraryId: string, placement?: CatalogPlacementTarget): void;
    startAddCurrentToLibrary(libraryId: string, path?: string, placement?: CatalogPlacementTarget): void;
  };
  view.app = {
    vault: { getAbstractFileByPath: (path) => path === currentFile.path ? currentFile : null },
    workspace: { getActiveFile: () => currentFile },
  };
  view.plugin = plugin;
  view.records = [];
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;
  view.startCreateKnowledgeNote = (_initial, _indexAfterCreate, created, _completionMessage, formContext) => {
    onCreated = created;
    createNote = formContext?.createNote;
  };

  const fileOpen = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  VaultFilePickerModal.prototype.open = function chooseExisting(): void {
    const modal = this as unknown as { getItems(): TFile[]; onChooseItem(file: TFile): void };
    modal.onChooseItem(existingFile);
  };
  try {
    view.startCreateLibraryNote(library.id, target);
    assert.ok(onCreated);
    assert.ok(createNote);
    await createNote({ title: "Created" });
    await onCreated(createdFile);
    view.startAddExistingToLibrary(library.id, target);
    view.startAddCurrentToLibrary(library.id, currentFile.path, target);
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    if (fileOpen) Object.defineProperty(VaultFilePickerModal.prototype, "open", fileOpen);
    else Reflect.deleteProperty(VaultFilePickerModal.prototype, "open");
  }

  assert.deepEqual(assignments, [
    { path: createdFile.path, libraryId: library.id, target },
    { path: existingFile.path, libraryId: library.id, target },
    { path: currentFile.path, libraryId: library.id, target },
  ]);
});

test("Quick Entry creates undoable portable placeholders and visual structures without touching Markdown", async () => {
  const { plugin, sourceMutationCount } = quickEntryPlugin();
  await plugin.loadPluginData();

  await plugin.createQuickEntryIndexGroup("Pediatric airway");
  assert.ok(plugin.getIndexGroups().includes("Pediatric airway"));

  const parentPath = await plugin.createQuickEntryPlaceholder({ title: "Airway evaluation", group: "Pediatric airway" });
  const parent = plugin.getRecord(parentPath);
  assert.ok(parent?.isPlaceholder);
  assert.equal(parent?.title, "Airway evaluation");
  assert.equal(parent?.domain, "Pediatric airway");
  assert.equal(parentPath, portablePlaceholderPath(parent?.portableId ?? ""));

  const childPath = await plugin.createQuickEntryPlaceholder({
    title: "Evaluation of stridor",
    group: "Pediatric airway",
    parentPath,
  });
  const child = plugin.getRecord(childPath);
  assert.ok(child?.isPlaceholder);
  assert.equal(plugin.data.curriculumVisual.parentByPath[childPath], parentPath);
  assert.equal(plugin.getPortableSubject(child?.portableId ?? "")?.parentId, parent?.portableId);

  const collectionId = await plugin.createQuickEntryCollectionHeading("Board review");
  const collectionSubheadingId = await plugin.createQuickEntryCollectionSubheading(collectionId, "Airway");
  assert.equal(plugin.data.collections[0]?.subheadings[0]?.id, collectionSubheadingId);

  const libraryId = await plugin.createLibrary({ name: "Reading lists", singularName: "Reading list", icon: "book-open" });
  const libraryHeadingId = await plugin.createQuickEntryLibraryHeading(libraryId, "Current papers");
  const librarySubheadingId = await plugin.createQuickEntryLibrarySubheading(libraryId, libraryHeadingId, "To discuss");
  assert.equal(
    plugin.data.portableIndex.libraryLayouts[libraryId]?.[0]?.subheadings[0]?.id,
    librarySubheadingId,
  );

  assert.equal(sourceMutationCount(), 0);
  await plugin.undo();
  assert.equal(plugin.data.portableIndex.libraryLayouts[libraryId]?.[0]?.subheadings.length, 0);
  assert.equal(sourceMutationCount(), 0);
});

test("Quick Entry header control is labelled, keyboard-native, and compact-mobile sized", () => {
  const dom = createFakeDom();
  let activations = 0;
  const button = createQuickEntryButton(asHtmlElement(dom.document.body), () => { activations += 1; });

  assert.equal(button.getAttribute("aria-label"), "Open quick entry");
  assert.equal(button.getAttribute("title"), "Open quick entry");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.querySelector(".ent-cc-quick-entry-label")?.textContent, "Quick entry");
  button.click();
  assert.equal(activations, 1);

  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.ent-cc-quick-entry-button\s*\{[^}]*min-width:\s*44px/s);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.ent-cc-quick-entry-button\s*\{[^}]*width:\s*44px/s);
  assert.match(css, /\.ent-cc-header-actions\s*\{[^}]*overflow-x:\s*auto/s);
});

test("export filenames stamp the local calendar day instead of the UTC day", () => {
  // A UTC stamp names the file after the previous or next day for most of the
  // world; these local times must all resolve to their own calendar day.
  assert.equal(localDateStamp(new Date(2026, 0, 1, 0, 30)), "2026-01-01");
  assert.equal(localDateStamp(new Date(2026, 0, 1, 23, 30)), "2026-01-01");
  assert.equal(localDateStamp(new Date(2026, 8, 5, 12, 0)), "2026-09-05");

  // One shared helper owns the anchor download, so the local stamp is applied
  // in exactly one place and every export site routes through it.
  const modals = readFileSync(new URL("../src/modals.ts", import.meta.url), "utf8");
  assert.match(modals, /const filename = `\$\{stem\}-\$\{localDateStamp\(options\.date \?\? new Date\(\)\)\}\.json`/u);
  assert.match(modals, /link\.download = filename;/u);

  // index-manager.ts no longer exports JSON itself — its Export… button opens
  // the Export/Import center — so it carries only the negative guards below.
  for (const file of [
    "../src/portfolio-modal.ts",
    "../src/portability-modal.ts",
    "../src/view.ts",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /deliverJsonExport\(/u, file);
  }
  for (const file of [
    "../src/index-manager.ts",
    "../src/portfolio-modal.ts",
    "../src/portability-modal.ts",
    "../src/view.ts",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /link\.download/u, file);
    assert.doesNotMatch(source, /createObjectURL/u, file);
    assert.doesNotMatch(source, /toISOString\(\)\.slice\(0, 10\)/u, file);
  }
});

test("settings text inputs stay RTL-safe and the recent-changes slider defers its save", () => {
  const source = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
  const textInputs = source.match(/row\.addText\(/gu)?.length ?? 0;
  const directionalInputs = source.match(/text\.inputEl\.dir = "auto";/gu)?.length ?? 0;
  assert.ok(textInputs > 0);
  assert.equal(directionalInputs, textInputs, "every settings text input must render user content with dir=auto");

  assert.match(source, /if \(typeof slider\.setInstant === "function"\) slider\.setInstant\(false\);/u);
  assert.match(source, /settings\.recentLimit = value;\n\s*this\.scheduleTextSave\(\);/u);
  assert.doesNotMatch(source, /settings\.recentLimit = value;\n\s*await this\.save\(\);/u);
});

// --- Nested subheadings: deep creation targets, depth cap, and layout-global
// --- unique minted ids (max 5 levels including the heading).

test("collection targets list every nested subheading with its full path label", () => {
  const targets = collectionTargets([{
    id: "heading-a",
    title: "Board review",
    collapsed: false,
    subjects: [],
    subheadings: [
      {
        id: "sub-airway",
        title: "Airway",
        collapsed: false,
        subjects: [],
        subheadings: [{
          id: "sub-pediatric",
          title: "Pediatric",
          collapsed: false,
          subjects: [],
          subheadings: [{ id: "sub-neonatal", title: "Neonatal", collapsed: false, subjects: [] }],
        }],
      },
      { id: "sub-otology", title: "Otology", collapsed: false, subjects: [] },
    ],
  }]);

  assert.deepEqual(targets, [
    { headingId: "heading-a", label: "Board review" },
    { headingId: "heading-a", subheadingId: "sub-airway", label: "Board review / Airway" },
    { headingId: "heading-a", subheadingId: "sub-pediatric", label: "Board review / Airway / Pediatric" },
    { headingId: "heading-a", subheadingId: "sub-neonatal", label: "Board review / Airway / Pediatric / Neonatal" },
    { headingId: "heading-a", subheadingId: "sub-otology", label: "Board review / Otology" },
  ]);
});

test("Quick Entry nests new subheadings under a chosen parent and refuses past the depth cap", async () => {
  const { plugin, sourceMutationCount } = quickEntryPlugin();
  await plugin.loadPluginData();

  const headingId = await plugin.createQuickEntryCollectionHeading("Board review");
  const level2 = await plugin.createQuickEntryCollectionSubheading(headingId, "Airway");
  const level3 = await plugin.createQuickEntryCollectionSubheading(headingId, "Pediatric", level2);
  const level4 = await plugin.createQuickEntryCollectionSubheading(headingId, "Neonatal", level3);
  const level5 = await plugin.createQuickEntryCollectionSubheading(headingId, "First week", level4);

  const heading = plugin.data.collections[0];
  const nodeLevel2 = heading?.subheadings[0];
  const nodeLevel3 = nodeLevel2?.subheadings?.[0];
  const nodeLevel4 = nodeLevel3?.subheadings?.[0];
  const nodeLevel5 = nodeLevel4?.subheadings?.[0];
  assert.equal(nodeLevel2?.id, level2);
  assert.equal(nodeLevel3?.id, level3);
  assert.equal(nodeLevel4?.id, level4);
  assert.equal(nodeLevel5?.id, level5);
  assert.equal(nodeLevel5?.subheadings, undefined, "a new leaf omits the nested key");

  await assert.rejects(
    plugin.createQuickEntryCollectionSubheading(headingId, "Too deep", level5),
    /maximum nesting depth/u,
    "a depth-5 node cannot contain another subheading",
  );
  await assert.rejects(
    plugin.createQuickEntryCollectionSubheading(headingId, "Orphan", "missing-parent"),
    /parent subheading is no longer available/u,
  );

  const libraryId = await plugin.createLibrary({ name: "Reading lists", singularName: "Reading list", icon: "book-open" });
  const libraryHeadingId = await plugin.createQuickEntryLibraryHeading(libraryId, "Current papers");
  const libraryLevel2 = await plugin.createQuickEntryLibrarySubheading(libraryId, libraryHeadingId, "To discuss");
  const libraryLevel3 = await plugin.createQuickEntryLibrarySubheading(libraryId, libraryHeadingId, "Journal club", libraryLevel2);
  const libraryHeading = plugin.data.portableIndex.libraryLayouts[libraryId]?.[0];
  assert.equal(libraryHeading?.subheadings[0]?.subheadings?.[0]?.id, libraryLevel3);
  const libraryLevel4 = await plugin.createQuickEntryLibrarySubheading(libraryId, libraryHeadingId, "This month", libraryLevel3);
  const libraryLevel5 = await plugin.createQuickEntryLibrarySubheading(libraryId, libraryHeadingId, "This week", libraryLevel4);
  await assert.rejects(
    plugin.createQuickEntryLibrarySubheading(libraryId, libraryHeadingId, "Too deep", libraryLevel5),
    /maximum nesting depth/u,
  );

  assert.equal(sourceMutationCount(), 0);
});

test("minted subheading ids are checked against nodes at every depth", async () => {
  const { plugin } = quickEntryPlugin();
  await plugin.loadPluginData();

  const fixedNow = 1_700_000_000_000;
  const randomSequence = [0.123456789, 0.987654321, 0.246813579];
  const collidingId = `subheading-${fixedNow.toString(36)}-${randomSequence[0]?.toString(36).slice(2, 8)}`;
  plugin.data.collections = [{
    id: "heading-deep",
    title: "Deep",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: "sub-level-2",
      title: "Level two",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: collidingId, title: "Level three", collapsed: false, subjects: [] }],
    }],
  }];

  const originalNow = Date.now;
  const originalRandom = Math.random;
  let randomCalls = 0;
  Date.now = () => fixedNow;
  Math.random = () => randomSequence[Math.min(randomCalls++, randomSequence.length - 1)] ?? 0.5;
  let minted = "";
  try {
    minted = await plugin.createQuickEntryCollectionSubheading("heading-deep", "Fresh");
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }

  assert.notEqual(minted, collidingId, "the uniqueness scan must see the depth-3 node id");
  const heading = plugin.data.collections[0];
  const directIds = (heading?.subheadings ?? []).map((node) => node.id);
  assert.ok(directIds.includes(minted));
  assert.equal(directIds.filter((id) => id === collidingId).length, 0, "the colliding id stays unique to the deep node");
});

test("the unified quick-create form defaults to the Inbox and re-targets the Index or a Collection", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.collections.push({
    id: "col-h",
    title: "Board review",
    collapsed: true,
    subjects: [],
    subheadings: [{ id: "col-s", title: "Airway", collapsed: true, subjects: [] }],
  });
  const createdFile = new TFile("Inbox/Quick capture.md");
  const catalogAssignments: Array<{ path: string; kind: string; target: CatalogPlacementTarget }> = [];
  let savedViewState = 0;
  let reloads = 0;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getLibraries: (): LibraryDefinition[] => [],
    getTemplateFiles: (): TFile[] => [],
    getIndexGroups: () => ["Foundations"],
    getRecord: () => null,
    isClinicalMode: () => false,
    validateGenericNote: () => null,
    async createKnowledgeNote(): Promise<TFile> { return createdFile; },
    async assignRecordToCatalog(path: string, kind: string, target: CatalogPlacementTarget = {}): Promise<void> {
      catalogAssignments.push({ path, kind, target });
    },
    setDirectIndexMembershipState(path: string, indexed: boolean): void {
      data.directIndexPaths = indexed
        ? [...new Set([...data.directIndexPaths, path])]
        : data.directIndexPaths.filter((candidate) => candidate !== path);
    },
    async mutate(_label: string, mutator: () => void): Promise<void> { mutator(); },
    async saveViewState(): Promise<void> { savedViewState += 1; },
    async openFile(): Promise<void> { /* opening is not under test */ },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    reload(): Promise<void>;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;
  view.reload = async () => { reloads += 1; };

  const forms: KnowledgeNoteModalOptions[] = [];
  const seeds: NoteDestinationSeed[] = [];
  let pickAction = "index";
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const groupOpen = Object.getOwnPropertyDescriptor(IndexGroupModal.prototype, "open");
  const collectionOpen = Object.getOwnPropertyDescriptor(CollectionPickerModal.prototype, "open");
  const noteOpen = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  AddActionModal.prototype.open = function chooseDestination(): void {
    const modal = this as unknown as { getItems(): Array<{ id: string }>; onChooseItem(item: { id: string }): void };
    const items = modal.getItems();
    assert.equal(items[0]?.id, "inbox", "the Inbox must be the first destination offered");
    const action = items.find((item) => item.id === pickAction);
    assert.ok(action);
    modal.onChooseItem(action);
  };
  IndexGroupModal.prototype.open = function chooseGroup(): void {
    const options = (this as unknown as { options: { onSubmit(group: string): void | Promise<void> } }).options;
    void options.onSubmit("Foundations");
  };
  CollectionPickerModal.prototype.open = function chooseSubheading(): void {
    const modal = this as unknown as {
      getItems(): Array<{ headingId: string; subheadingId?: string }>;
      onChooseItem(item: { headingId: string; subheadingId?: string }): void;
    };
    const target = modal.getItems().find((item) => item.subheadingId === "col-s");
    assert.ok(target);
    modal.onChooseItem(target);
  };
  KnowledgeNoteModal.prototype.open = function captureForm(): void {
    forms.push((this as unknown as { options: KnowledgeNoteModalOptions }).options);
  };
  try {
    view.startQuickCreateNote();
    const form = forms.shift();
    assert.ok(form?.destination, "the generic quick-create form must carry a destination row");

    // Default: the Inbox, seeded from the configured Inbox folder, no registration anywhere.
    assert.equal(form.destination.label, data.settings.inboxLabel);
    assert.equal(form.initial.folder, data.settings.proposalFolder);
    await form.onSubmit({ title: "Quick capture", folder: data.settings.proposalFolder, mode: "empty", templatePath: "", addToCollection: false });
    assert.equal(data.selectedPath, createdFile.path);
    assert.equal(savedViewState, 1);
    assert.equal(reloads, 1);
    assert.deepEqual(catalogAssignments, []);
    assert.equal(Notice.messages.some((message) => message.includes(`created in ${data.settings.inboxLabel}`)), true);

    // Re-target the Index: seeds the default note folder and assigns the chosen group.
    pickAction = "index";
    form.destination.onEdit((seed) => seeds.push(seed));
    assert.equal(seeds[0]?.label, `${data.settings.indexLabel} / Foundations`);
    assert.equal(seeds[0]?.folder, data.settings.defaultNoteFolder);
    await form.onSubmit({ title: "Quick capture", folder: data.settings.defaultNoteFolder, mode: "empty", templatePath: "", addToCollection: false });
    assert.deepEqual(catalogAssignments, [
      { path: createdFile.path, kind: "topic", target: { headingTitle: "Foundations" } },
    ]);

    // Re-target a Collection subheading: the note path joins it and the chain un-collapses.
    pickAction = "collection";
    form.destination.onEdit((seed) => seeds.push(seed));
    assert.equal(seeds[1]?.label, "Collections / Board review / Airway");
    assert.equal(seeds[1]?.hideCollectionToggle, true, "a collection destination must hide the add-to-collection toggle");
    await form.onSubmit({ title: "Quick capture", folder: data.settings.defaultNoteFolder, mode: "empty", templatePath: "", addToCollection: false });
    assert.deepEqual(data.collections[0]?.subheadings[0]?.subjects, [createdFile.path]);
    assert.equal(data.collections[0]?.collapsed, false, "placement must un-collapse the destination chain");

    // A destination replaced by Sync mid-form: the note survives and the failure is explained.
    Notice.messages.length = 0;
    data.collections.length = 0;
    await form.onSubmit({ title: "Quick capture", folder: data.settings.defaultNoteFolder, mode: "empty", templatePath: "", addToCollection: false });
    assert.equal(Notice.messages.some((message) => message.includes("no longer exists")), true);
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (groupOpen) Object.defineProperty(IndexGroupModal.prototype, "open", groupOpen);
    else Reflect.deleteProperty(IndexGroupModal.prototype, "open");
    if (collectionOpen) Object.defineProperty(CollectionPickerModal.prototype, "open", collectionOpen);
    else Reflect.deleteProperty(CollectionPickerModal.prototype, "open");
    if (noteOpen) Object.defineProperty(KnowledgeNoteModal.prototype, "open", noteOpen);
    else Reflect.deleteProperty(KnowledgeNoteModal.prototype, "open");
  }
});

test("the clinical profile keeps the protected proposal picker for quick note creation", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getLibraries: (): LibraryDefinition[] => [],
    getTemplateFiles: (): TFile[] => [],
    isClinicalMode: () => true,
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;

  const menus: Array<Array<{ id: string }>> = [];
  const forms: KnowledgeNoteModalOptions[] = [];
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const noteOpen = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  AddActionModal.prototype.open = function captureMenu(): void {
    menus.push((this as unknown as { getItems(): Array<{ id: string }> }).getItems());
  };
  KnowledgeNoteModal.prototype.open = function captureForm(): void {
    forms.push((this as unknown as { options: KnowledgeNoteModalOptions }).options);
  };
  try {
    view.startQuickCreateNote();
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (noteOpen) Object.defineProperty(KnowledgeNoteModal.prototype, "open", noteOpen);
    else Reflect.deleteProperty(KnowledgeNoteModal.prototype, "open");
  }

  assert.equal(forms.length, 0, "clinical mode must never open the generic destination form");
  assert.equal(menus[0]?.[0]?.id, "proposal", "the protected proposal workflow stays first in clinical mode");
});

test("the Inbox destination cannot silently create a note the plugin would never show", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const createdFile = new TFile("Elsewhere/Stray capture.md");
  let created = 0;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getLibraries: (): LibraryDefinition[] => [],
    getTemplateFiles: (): TFile[] => [],
    getRecord: () => null,
    isClinicalMode: () => false,
    validateGenericNote: () => null,
    async createKnowledgeNote(): Promise<TFile> { created += 1; return createdFile; },
    setDirectIndexMembershipState(path: string, indexed: boolean): void {
      data.directIndexPaths = indexed
        ? [...new Set([...data.directIndexPaths, path])]
        : data.directIndexPaths.filter((candidate) => candidate !== path);
    },
    async mutate(_label: string, mutator: () => void): Promise<void> { mutator(); },
    async saveViewState(): Promise<void> { /* not under test */ },
    async openFile(): Promise<void> { /* not under test */ },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    reload(): Promise<void>;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;
  view.reload = async () => { /* not under test */ };

  const forms: KnowledgeNoteModalOptions[] = [];
  const noteOpen = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  KnowledgeNoteModal.prototype.open = function captureForm(): void {
    forms.push((this as unknown as { options: KnowledgeNoteModalOptions }).options);
  };
  try {
    view.startQuickCreateNote();
    const form = forms.shift();
    assert.ok(form?.destination);

    // Validation: a folder outside the configured Inbox folder fails loudly.
    assert.match(
      form.validate({ title: "Stray capture", folder: "Elsewhere", mode: "empty", templatePath: "", addToCollection: false }) ?? "",
      /files notes inside Inbox/,
    );
    assert.equal(
      form.validate({ title: "Stray capture", folder: "Inbox/Deep", mode: "empty", templatePath: "", addToCollection: false }),
      null,
      "subfolders of the Inbox folder remain valid",
    );

    // An unconfigured Inbox folder blocks the default destination with guidance.
    data.settings.proposalFolder = "";
    assert.match(
      form.validate({ title: "Stray capture", folder: "", mode: "empty", templatePath: "", addToCollection: false }) ?? "",
      /No Inbox folder is configured/,
    );
    data.settings.proposalFolder = "Inbox";

    // Safety net: if drift the form cannot see still lands the file outside
    // the Inbox folder, the note is registered in the Index instead of
    // belonging to nothing.
    await form.onSubmit({ title: "Stray capture", folder: "Elsewhere", mode: "empty", templatePath: "", addToCollection: false });
    assert.equal(created, 1);
    assert.deepEqual(data.directIndexPaths, [createdFile.path]);
    assert.equal(Notice.messages.some((message) => message.includes("outside the configured Inbox folder")), true);
  } finally {
    if (noteOpen) Object.defineProperty(KnowledgeNoteModal.prototype, "open", noteOpen);
    else Reflect.deleteProperty(KnowledgeNoteModal.prototype, "open");
  }
});

test("clinical plain create seeds the proposal folder and refuses invisible destinations", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getTemplateFiles: (): TFile[] => [],
    isClinicalMode: () => true,
    validateGenericNote: () => null,
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;

  const forms: KnowledgeNoteModalOptions[] = [];
  const noteOpen = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  KnowledgeNoteModal.prototype.open = function captureForm(): void {
    forms.push((this as unknown as { options: KnowledgeNoteModalOptions }).options);
  };
  try {
    view.startCreateKnowledgeNote();
    const form = forms.shift();
    assert.ok(form);
    // The ENT default note folder "01 Inbox" is visible to no clinical
    // classifier branch; a plain create must start inside the real Inbox.
    assert.equal(form.initial.folder, data.settings.proposalFolder);
    assert.match(
      form.validate({ title: "Note", folder: "01 Inbox", mode: "empty", templatePath: "", addToCollection: false }) ?? "",
      /only visible inside/,
    );
    assert.equal(
      form.validate({ title: "Note", folder: data.settings.proposalFolder, mode: "empty", templatePath: "", addToCollection: false }),
      null,
    );
    assert.equal(
      form.validate({ title: "Note", folder: `${data.settings.primaryFolder}/03 Laryngology`, mode: "empty", templatePath: "", addToCollection: false }),
      null,
    );
  } finally {
    if (noteOpen) Object.defineProperty(KnowledgeNoteModal.prototype, "open", noteOpen);
    else Reflect.deleteProperty(KnowledgeNoteModal.prototype, "open");
  }
});

test("a failed filing step never orphans the created note", async () => {
  Notice.messages.length = 0;
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const createdFile = new TFile("Reference notes/Orphan risk.md");
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getTemplateFiles: (): TFile[] => [],
    getRecord: () => null,
    isClinicalMode: () => false,
    validateGenericNote: () => null,
    async createKnowledgeNote(): Promise<TFile> { return createdFile; },
    setDirectIndexMembershipState(path: string, indexed: boolean): void {
      data.directIndexPaths = indexed
        ? [...new Set([...data.directIndexPaths, path])]
        : data.directIndexPaths.filter((candidate) => candidate !== path);
    },
    async mutate(_label: string, mutator: () => void): Promise<void> { mutator(); },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;

  const forms: KnowledgeNoteModalOptions[] = [];
  const noteOpen = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  KnowledgeNoteModal.prototype.open = function captureForm(): void {
    forms.push((this as unknown as { options: KnowledgeNoteModalOptions }).options);
  };
  try {
    view.startCreateKnowledgeNote({}, false, async () => {
      throw new Error("That library is archived. Restore it before adding records.");
    });
    const form = forms.shift();
    assert.ok(form);
    await form.onSubmit({ title: "Orphan risk", folder: "Reference notes", mode: "empty", templatePath: "", addToCollection: false });
  } finally {
    if (noteOpen) Object.defineProperty(KnowledgeNoteModal.prototype, "open", noteOpen);
    else Reflect.deleteProperty(KnowledgeNoteModal.prototype, "open");
  }

  assert.deepEqual(data.directIndexPaths, [createdFile.path], "the unfiled note is rescued into the Index");
  assert.equal(Notice.messages.some((message) => message.includes(createdFile.path) && message.includes("could not be filed")), true);
});

test("the generic Inbox empty-state routes through the guarded unified form", () => {
  const source = readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");
  // The legacy direct form bypassed the Inbox folder validation and safety
  // net; the empty-state CTA must stay on the guarded entry point.
  assert.doesNotMatch(source, /startCreateKnowledgeNote\(\{ folder: this\.plugin\.data\.settings\.proposalFolder \}, false\)/u);
  assert.match(source, /: this\.openQuickCreateNoteForm\(\)\);/u);
});
