import assert from "node:assert/strict";
import test from "node:test";
import { TFolder } from "./support/obsidian-stub.ts";
import { CreateKnowledgeBaseModal, deriveNewBaseFolders, ManageKnowledgeBasesModal } from "../src/knowledge-base-modal.ts";
import { migrateData, type KnowledgeBaseEntry } from "../src/model.ts";
import { missingSetupFolderHint, WorkspaceSetupModal } from "../src/modals.ts";
import { EntCommandCenterSettingsTab } from "../src/settings.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";
import { recordSettings } from "./support/setting-recorder.ts";

/** WF-12 destination-label portion: T1-T5. DOM assertions only, no whole-dialog snapshots. */

const derive = (folder: string, configDir = ".obsidian") => deriveNewBaseFolders(folder, configDir);

function createModalHarness(configDir = ".obsidian") {
  const created: Array<[string, string, string]> = [];
  const plugin = {
    app: { vault: { configDir } },
    createKnowledgeBase: async (name: string, mode: string, folder: string) => {
      created.push([name, mode, folder]);
      return { data: { settings: { workspaceName: name } } };
    },
  };
  const dom = createFakeDom();
  const recorder = recordSettings();
  const root = dom.document.body.createDiv();
  const content = root.createDiv();
  const modal = new CreateKnowledgeBaseModal(plugin as never);
  let closes = 0;
  Object.assign(modal, {
    modalEl: asHtmlElement(root), contentEl: asHtmlElement(content), titleEl: asHtmlElement(root.createEl("h2")),
    close: () => { closes += 1; },
  });
  modal.onOpen();
  const newest = (name: string) => {
    const found = [...recorder.rows].reverse().find((row) => row.name === name);
    assert.ok(found, `row ${name}`);
    return found;
  };
  const submit = async (): Promise<void> => {
    const row = [...recorder.rows].reverse().find((candidate) => candidate.buttons.has("Create and switch"));
    await row?.buttons.get("Create and switch")?.();
  };
  return {
    created, content, closes: () => closes, newest, submit, restore: recorder.restore,
    typeName: (value: string) => newest("Name").texts[0]?.type(value),
    typeFolder: (value: string) => newest("Default new-note folder").texts[0]?.type(value),
    folderError: () => content.querySelector("[data-field=folder]")?.textContent ?? "",
    nameError: () => content.querySelector(".ent-cc-base-name-feedback .ent-cc-base-name-error")?.textContent ?? "",
    scope: () => content.querySelector(".ent-cc-base-scope-warning")?.textContent ?? "",
  };
}

test("T1 setup, settings and Create describe the physical save destination apart from Index/Collection/Library placement", () => {
  const settingsData = migrateData(null);
  settingsData.settings.workspaceMode = "generic";
  const host = {
    app: { vault: { configDir: ".obsidian", getAllLoadedFiles: () => [], getMarkdownFiles: () => [] }, metadataCache: {} },
    data: settingsData,
    dataCompatibilityWarning: "",
    isDataReadOnly: () => false,
    getKnowledgeBases: () => [{ id: "base-a", data: settingsData }],
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getExternalChangeGeneration: () => 0,
    getIndexRecords: () => [],
    getLibraries: () => [],
    librarySubjectCount: () => 0,
    getTemplateFiles: () => [],
    getIndexGroups: () => [],
    getFollowUpCategories: () => [],
    countOrphanedByPrimaryFolderChange: () => 0,
    countOrphanedByProposalFolderChange: () => 0,
  };
  const tab = new EntCommandCenterSettingsTab(host.app as never, host as never);
  const group = tab.getSettingDefinitions().find((definition) => "heading" in definition && definition.heading === "Note storage and creation");
  assert.ok(group && "items" in group && group.items);
  const item = group.items.find((candidate) => "name" in candidate && candidate.name === "Default new-note folder");
  assert.ok(item && "desc" in item);
  const settingsText = typeof item.desc === "string" ? item.desc : "";
  assert.notEqual(settingsText, "", "the Settings description is a plain string");
  for (const text of [settingsText]) {
    assert.match(text, /Saved location/u, "names the physical location");
    assert.match(text, /Inbox folder/u, "the Inbox destination saves into the Inbox folder, not this default");
    assert.match(text, /Index, Collection and Library placement/u, "placement is a separate choice");
    assert.match(text, /created when a note is saved/u);
    assert.doesNotMatch(text, /created empty|immediately/u);
  }

  const recorder = recordSettings();
  const dom = createFakeDom();
  const modal = new WorkspaceSetupModal({ vault: { getAbstractFileByPath: () => null } } as never, { ...migrateData(null).settings, workspaceName: "Research" }, () => undefined);
  try {
    const root = dom.document.body.createDiv();
    Object.assign(modal, { modalEl: asHtmlElement(root), contentEl: asHtmlElement(root.createDiv()), titleEl: asHtmlElement(root.createEl("h2")) });
    modal.onOpen();
    const setupRow = [...recorder.rows].find((row) => row.name === "Default new-note folder");
    assert.ok(setupRow);
    assert.match(setupRow.desc, /Saved location/u);
    assert.match(setupRow.desc, /Inbox folder/u);
    assert.match(setupRow.desc, /Index, Collection and Library placement/u);
    assert.doesNotMatch(setupRow.desc, /created empty/u);
    // A missing real save destination is created at save time; a grouping-only path never is.
    const inbox = [...recorder.rows].find((row) => row.name === "Inbox folder");
    const grouping = [...recorder.rows].find((row) => row.name === "Folder grouping root");
    assert.ok(inbox && grouping);
    inbox.texts[0]?.type("Triage");
    grouping.texts[0]?.type("Typo Root");
    assert.match(inbox.desc, /created when a note is saved there/u);
    assert.doesNotMatch(inbox.desc, /created empty/u);
    assert.match(grouping.desc, /not created/u, "a grouping-only folder is not promised creation");
    assert.doesNotMatch(grouping.desc, /will be created/u);
  } finally {
    recorder.restore();
  }

  const folderExists = (path: string): boolean => path === "Known";
  assert.match(missingSetupFolderHint("Triage", "existing notes will not appear in the Inbox", folderExists, "storage") ?? "", /created when a note is saved there/u);
  assert.match(missingSetupFolderHint("Typo", "folder-based grouping will remain empty", folderExists, "grouping") ?? "", /not created/u);

  const create = createModalHarness();
  try {
    create.typeName("Study");
    assert.match(create.scope(), /Study/u);
    assert.match(create.scope(), /Knowledge Bases\/Study\/Inbox/u, "the derived Inbox path is shown before creating");
    assert.match(create.scope(), /saved/u);
    assert.match(create.scope(), /placement/u, "Index/Collection/Library placement is described separately");
  } finally {
    create.restore();
  }
});

test("T2 an invalid parent or derived Inbox is shown at the folder field and creates no base", async () => {
  const bad = createModalHarness();
  try {
    bad.typeName("Study");
    bad.typeFolder("Notes/a?b");
    await bad.submit();
    assert.deepEqual(bad.created, [], "zero createKnowledgeBase calls");
    assert.match(bad.folderError(), /Folder names cannot contain/u);
    assert.equal(bad.nameError(), "", "the Name field carries no folder error");
    assert.equal(bad.closes(), 0);
  } finally {
    bad.restore();
  }

  // The parent is valid, but its derived "<parent>/Inbox" lands in the configuration folder.
  const derived = createModalHarness("Notes/Inbox");
  try {
    derived.typeName("Study");
    derived.typeFolder("Notes");
    await derived.submit();
    assert.deepEqual(derived.created, []);
    assert.match(derived.folderError(), /Inbox/u);
    assert.match(derived.folderError(), /cannot be inside Notes\/Inbox/u);
    assert.equal(derived.nameError(), "");
  } finally {
    derived.restore();
  }

  assert.equal(derive("Notes/a?b").error?.includes("Folder names cannot contain"), true);
  assert.match(derive("Notes", "Notes/Inbox").error ?? "", /Inbox folder/u);
  assert.match(derive("  / ").error ?? "", /Choose/u);
});

test("T3 a valid root and a Unicode parent derive the Inbox and are the only values handed to create", async () => {
  assert.deepEqual(derive("Research"), { folder: "Research", inbox: "Research/Inbox", error: null });
  assert.deepEqual(derive("/Études/Ñandú 研究/"), { folder: "Études/Ñandú 研究", inbox: "Études/Ñandú 研究/Inbox", error: null });

  const ok = createModalHarness();
  try {
    ok.typeName("Étude");
    ok.typeFolder(" /Études/Ñandú 研究/ ");
    assert.match(ok.scope(), /Études\/Ñandú 研究\/Inbox/u);
    await ok.submit();
    assert.deepEqual(ok.created, [["Étude", "generic", "Études/Ñandú 研究"]]);
    assert.equal(ok.folderError(), "");
  } finally {
    ok.restore();
  }
});

test("T4 an invalid fixed attachment folder shows visible explanatory text, not only a red border", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Attachments";
  const host = {
    app: { vault: { configDir: ".obsidian", getAllLoadedFiles: () => [new TFolder("Attachments")], getMarkdownFiles: () => [] }, metadataCache: {} },
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
    countOrphanedByPrimaryFolderChange: () => 0,
    countOrphanedByProposalFolderChange: () => 0,
  };
  const tab = new EntCommandCenterSettingsTab(host.app as never, host as never);
  (tab as unknown as { scheduleTextSave(refresh?: boolean): void }).scheduleTextSave = () => undefined;
  const group = tab.getSettingDefinitions().find((definition) => "heading" in definition && definition.heading === "Note storage and creation");
  assert.ok(group && "items" in group && group.items);
  const item = group.items.find((candidate) => "name" in candidate && candidate.name === "Fixed attachment folder");
  assert.ok(item && "render" in item && item.render);

  const descs: string[] = [];
  const classes = new Set<string>();
  let typed: (value: string) => void = () => undefined;
  const inputEl = {
    dir: "",
    addEventListener: () => undefined,
    blur: () => undefined,
    toggleClass: (name: string, force: boolean) => { if (force) classes.add(name); else classes.delete(name); },
  };
  const text = {
    inputEl,
    setPlaceholder() { return text; },
    setValue() { return text; },
    setDisabled() { return text; },
    onChange(callback: (value: string) => void) { typed = callback; return text; },
  };
  const button = { setButtonText() { return button; }, setDisabled() { return button; }, onClick() { return button; } };
  const row = {
    settingEl: { addClass: () => undefined },
    setDesc(value: string) { descs.push(value); return row; },
    addText(configure: (control: typeof text) => void) { configure(text); return row; },
    addButton(configure: (control: typeof button) => void) { configure(button); return row; },
  };
  item.render(row as never, new Proxy({}, { get(): never { throw new Error("no group"); } }) as never);

  typed("Bad?Folder");
  assert.equal(classes.has("is-error"), true);
  assert.equal(descs.length, 1, "the explanatory text is shown");
  assert.match(descs[0] ?? "", /Folder names cannot contain/u);
  assert.match(descs[0] ?? "", /still use “Attachments”/u, "says what remains in effect");
  assert.equal(data.settings.attachmentFolder, "Attachments", "the invalid value is never stored");

  typed("Good/Folder");
  assert.equal(classes.has("is-error"), false);
  assert.match(descs[1] ?? "", /Used only when Attachment storage is set to a fixed vault folder/u, "the normal explanation returns");
});

test("T5 the base-manager row labels the grouping root and uses the singular count", () => {
  const dom = createFakeDom();
  const render = (indexEntries: number, collections: number, primaryFolder: string): string => {
    const entry = {
      id: "base-a", updatedAt: 1, archivedAt: null,
      data: {
        settings: { workspaceName: "Study", workspaceMode: "generic", primaryFolder },
        portableIndex: { subjects: [] },
        collections: Array.from({ length: collections }, () => ({})),
      },
    } as unknown as KnowledgeBaseEntry;
    const plugin = {
      getActiveKnowledgeBaseId: () => "base-a",
      getIndexRecords: () => Array.from({ length: indexEntries }, () => ({})),
    };
    const modal = Object.create(ManageKnowledgeBasesModal.prototype) as {
      app: unknown; plugin: unknown; ownsRendered: unknown;
      renderEntry(parent: HTMLElement, entry: KnowledgeBaseEntry, archived: boolean, availableCount: number): void;
    };
    modal.app = {};
    modal.plugin = plugin;
    modal.ownsRendered = () => true;
    const list = dom.document.body.createDiv();
    modal.renderEntry(asHtmlElement(list), entry, false, 2);
    return list.querySelector(".ent-cc-picker-meta")?.textContent ?? "";
  };
  const one = render(1, 1, "Research/Grouping");
  assert.match(one, /Grouping root: Research\/Grouping/u);
  assert.match(one, /\b1 index entry\b(?!ies)/u);
  assert.match(one, /\b1 collection\b(?!s)/u);
  const many = render(2, 3, "");
  assert.match(many, /2 index entries/u);
  assert.match(many, /3 collections/u);
  assert.match(many, /Grouping root: Vault root/u);
});
