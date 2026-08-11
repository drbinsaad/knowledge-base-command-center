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
import { AddActionModal, CollectionPickerModal, TextPromptModal, VaultFilePickerModal } from "../src/modals.ts";
import { migrateData, portablePlaceholderPath, type LibraryDefinition, type VaultRecord } from "../src/model.ts";
import { createFakeDom, asHtmlElement } from "./support/fake-dom.ts";

function quickEntryPlugin(): {
  plugin: EntVaultCommandCenterPlugin & { loadedData: unknown; savedData: unknown[] };
  sourceMutationCount: () => number;
} {
  let sourceMutations = 0;
  const forbiddenSourceMutation = (): never => {
    sourceMutations += 1;
    throw new Error("Quick Entry attempted to mutate a Markdown file.");
  };
  const app = {
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
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  AddActionModal.prototype.open = function captureMenu(): void {
    pending.push(this);
  };
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
    view.startCreateKnowledgeNote = () => calls.push("create-note");
    view.startQuickCreateNote = EntVaultCommandCenterView.prototype.startQuickCreateNote.bind(view);
    view.startQuickCreateNote();
    dataEpoch = 3;
    const createMenu = pending.shift();
    const inbox = createMenu?.getItems().find((item) => item.id === "inbox");
    assert.ok(createMenu && inbox);
    createMenu.onChooseItem(inbox);

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
  }

  assert.deepEqual(calls, []);
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
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getLibraries: () => [library],
    getLibrary: (id: string) => id === library.id ? library : null,
    isClinicalMode: () => false,
  };
  const routed: Array<{ flow: string; libraryId: string; path?: string; target: CatalogPlacementTarget }> = [];
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: { vault: { getAbstractFileByPath(path: string): TFile | null }; workspace: { getActiveFile(): TFile } };
    plugin: typeof plugin;
    records: VaultRecord[];
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startCreateLibraryNote(libraryId: string, target?: CatalogPlacementTarget): void;
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
  view.startCreateLibraryNote = (libraryId, target = {}) => routed.push({ flow: "create", libraryId, target });
  view.startAddExistingToLibrary = (libraryId, target = {}) => routed.push({ flow: "existing", libraryId, target });
  view.startAddCurrentToLibrary = (libraryId, path, target = {}) => routed.push({ flow: "current", libraryId, path, target });

  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const collectionOpen = Object.getOwnPropertyDescriptor(CollectionPickerModal.prototype, "open");
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
  try {
    view.startQuickCreateNote();
    view.startQuickAddExistingNote();
    view.startQuickAddCurrentNote(current.path);
    await Promise.resolve();
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (collectionOpen) Object.defineProperty(CollectionPickerModal.prototype, "open", collectionOpen);
    else Reflect.deleteProperty(CollectionPickerModal.prototype, "open");
  }

  assert.deepEqual(routed, [
    { flow: "create", libraryId: library.id, target: { headingId: "heading-a", subheadingId: "subheading-a" } },
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
  const routed: CatalogPlacementTarget[] = [];
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getLibraries: () => [library],
    getLibrary: (id: string) => id === library.id ? library : null,
    isClinicalMode: () => false,
    async createQuickEntryLibraryHeading(_libraryId: string, title: string): Promise<string> {
      created.push(title);
      return "first-heading";
    },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & {
    app: object;
    plugin: typeof plugin;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    startCreateLibraryNote(libraryId: string, target?: CatalogPlacementTarget): void;
  };
  view.app = {};
  view.plugin = plugin;
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 1;
  view.staleViewNoticeShown = false;
  view.startCreateLibraryNote = (_libraryId, target = {}) => routed.push(target);

  let submitted: Promise<void> = Promise.resolve();
  const addOpen = Object.getOwnPropertyDescriptor(AddActionModal.prototype, "open");
  const textOpen = Object.getOwnPropertyDescriptor(TextPromptModal.prototype, "open");
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
  try {
    view.startQuickCreateNote();
    await submitted;
  } finally {
    if (addOpen) Object.defineProperty(AddActionModal.prototype, "open", addOpen);
    else Reflect.deleteProperty(AddActionModal.prototype, "open");
    if (textOpen) Object.defineProperty(TextPromptModal.prototype, "open", textOpen);
    else Reflect.deleteProperty(TextPromptModal.prototype, "open");
  }

  assert.deepEqual(created, ["Quick captures"]);
  assert.deepEqual(routed, [{ headingId: "first-heading" }]);
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
  };
  let onCreated: ((file: TFile) => void | Promise<void>) | undefined;
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
  view.startCreateKnowledgeNote = (_initial, _indexAfterCreate, created) => { onCreated = created; };

  const fileOpen = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  VaultFilePickerModal.prototype.open = function chooseExisting(): void {
    const modal = this as unknown as { getItems(): TFile[]; onChooseItem(file: TFile): void };
    modal.onChooseItem(existingFile);
  };
  try {
    view.startCreateLibraryNote(library.id, target);
    assert.ok(onCreated);
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
