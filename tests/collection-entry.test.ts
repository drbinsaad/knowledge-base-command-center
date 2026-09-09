import assert from "node:assert/strict";
import test from "node:test";
import { Notice, TFile } from "obsidian";
import { KnowledgeNoteModal, VaultFilePickerModal, type KnowledgeNoteModalOptions } from "../src/modals.ts";
import { migrateData, type VaultRecord } from "../src/model.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

function harness() {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.collections = [
    { id: "first", title: "First", subjects: [], collapsed: false, subheadings: [] },
    { id: "target", title: "Target", subjects: [], collapsed: false, subheadings: [
      { id: "nested", title: "Nested", subjects: [], collapsed: false },
    ] },
  ];
  const file = new TFile("Notes/Example.md");
  let liveFile: TFile | undefined = file;
  let created = 0;
  let beforeMutation: (() => void) | undefined;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getBaseSurfaceVersion: () => "base-a:0",
    isDataReadOnly: () => false,
    isClinicalMode: () => false,
    getVaultNoteFiles: () => [file],
    getTemplateFiles: () => [],
    getLibraries: () => [],
    validateGenericNote: () => null,
    createKnowledgeNote: async () => { created += 1; return file; },
    getRecord: () => ({ path: file.path }),
    openFile: async () => undefined,
    mutate: async (_label: string, action: () => void) => { beforeMutation?.(); action(); },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: typeof plugin;
    app: object;
    loadedBaseId: string;
    loadedDataEpoch: number;
    query: string;
    records: VaultRecord[];
    countEl: HTMLElement;
    updateCount(visible: number): void;
    updateTabCountBadge(element: HTMLElement, tab: string): void;
    startCollectionNote(target: { headingId: string; subheadingId?: string }, create: boolean): void;
  };
  Object.assign(view, { plugin, app: { vault: { getAbstractFileByPath: (path: string) => liveFile?.path === path ? liveFile : null } }, loadedBaseId: "base-a", loadedDataEpoch: 0, query: "", records: [] });
  return { view, data, file, created: () => created, setLiveFile: (file: TFile | undefined) => { liveFile = file; }, beforeMutation: (callback: () => void) => { beforeMutation = callback; } };
}

test("empty Collection existing-note action targets the exact nested destination without a second picker", async () => {
  const { view, data, file, beforeMutation } = harness();
  const original = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  let choose: ((file: TFile) => Promise<void>) | undefined;
  VaultFilePickerModal.prototype.open = function () {
    choose = (this as unknown as { onChoose: (file: TFile) => Promise<void> }).onChoose;
  };
  try {
    view.startCollectionNote({ headingId: "target", subheadingId: "nested" }, false);
    assert.ok(choose);
    await choose(file);
    assert.deepEqual(data.collections[0].subjects, []);
    assert.deepEqual(data.collections[1].subjects, []);
    assert.deepEqual(data.collections[1].subheadings[0].subjects, [file.path]);
    beforeMutation(() => { data.collections[1].subheadings = []; });
    await assert.rejects(choose(file), /destination no longer exists/);
    assert.deepEqual(data.collections[0].subjects, [], "a removed target cannot fall back to a different collection");
  } finally {
    if (original) Object.defineProperty(VaultFilePickerModal.prototype, "open", original);
    else delete (VaultFilePickerModal.prototype as { open?: () => void }).open;
  }
});

test("fixed Collection create displays its destination, prevents redundant filing, and validates before writing", async () => {
  const { view, data, file, created, beforeMutation } = harness();
  const original = Object.getOwnPropertyDescriptor(KnowledgeNoteModal.prototype, "open");
  let options: KnowledgeNoteModalOptions | undefined;
  KnowledgeNoteModal.prototype.open = function () { options = (this as unknown as { options: KnowledgeNoteModalOptions }).options; };
  try {
    view.startCollectionNote({ headingId: "target", subheadingId: "nested" }, true);
    assert.ok(options);
    assert.match(options.contextNotice ?? "", /Target.*Nested/);
    assert.equal(options.hideCollectionToggle, true);
    assert.equal(options.destination, undefined, "a fixed-target creation does not offer a replacement destination picker");
    await options.onSubmit(options.initial);
    assert.equal(created(), 1);
    assert.deepEqual(data.collections[1].subheadings[0].subjects, [file.path]);
    data.collections[1].subheadings = [];
    assert.match(options.validate(options.initial) ?? "", /destination no longer exists/);
    await assert.rejects(Promise.resolve(options.onSubmit(options.initial)), /destination no longer exists/);
    assert.equal(created(), 1, "no Markdown file is created for a destination deleted while the form was open");
    data.collections[1].subheadings = [{ id: "nested", title: "Nested", subjects: [], collapsed: false }];
    beforeMutation(() => { data.collections[1].subheadings = []; });
    Notice.messages.length = 0;
    await options.onSubmit(options.initial);
    assert.equal(created(), 2);
    assert.match(Notice.messages.at(-1) ?? "", /could not be filed/);
    assert.deepEqual(data.collections[0].subjects, []);
    assert.deepEqual(data.collections[1].subjects, []);
  } finally {
    if (original) Object.defineProperty(KnowledgeNoteModal.prototype, "open", original);
    else delete (KnowledgeNoteModal.prototype as { open?: () => void }).open;
  }
});

test("Collection picker cannot add a deleted or replaced Markdown file, including a queued mutation race", async () => {
  const { view, data, file, setLiveFile, beforeMutation } = harness();
  const original = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  let choose: ((file: TFile) => Promise<void>) | undefined;
  VaultFilePickerModal.prototype.open = function () {
    choose = (this as unknown as { onChoose: (file: TFile) => Promise<void> }).onChoose;
  };
  try {
    view.startCollectionNote({ headingId: "target", subheadingId: "nested" }, false);
    assert.ok(choose);
    setLiveFile(undefined);
    await assert.rejects(choose(file), /Markdown note is no longer available/);
    setLiveFile(new TFile(file.path));
    await assert.rejects(choose(file), /Markdown note is no longer available/);
    setLiveFile(file);
    beforeMutation(() => setLiveFile(undefined));
    await assert.rejects(choose(file), /Markdown note is no longer available/);
    assert.deepEqual(data.collections[1].subheadings[0].subjects, [], "stale file objects must not create dangling memberships");
  } finally {
    if (original) Object.defineProperty(VaultFilePickerModal.prototype, "open", original);
    else delete (VaultFilePickerModal.prototype as { open?: () => void }).open;
  }
});

test("Library browsing counts notes and placeholders separately, with explicit Collection badge units", () => {
  const { view, data } = harness();
  const dom = createFakeDom();
  const count = dom.document.body.createDiv();
  view.countEl = asHtmlElement(count);
  view.records = [
    { path: "Notes/Linked.md", libraryId: "references" },
    { path: "kbcc-placeholder:missing", libraryId: "references", isPlaceholder: true },
  ] as VaultRecord[];
  data.activeTab = "library:references";
  view.updateCount(2);
  assert.match(count.textContent, /^2 entries · 1 linked note · 1 placeholder/);
  data.activeTab = "collections";
  data.collections[0].subjects.push("Notes/Linked.md");
  view.updateCount(1);
  assert.match(count.textContent, /^2 collections · 1 entry · 1 linked note · 0 placeholders/);
  const badge = dom.document.body.createSpan();
  view.updateTabCountBadge(asHtmlElement(badge), "collections");
  assert.equal(badge.textContent, "1 member");
  assert.equal(badge.getAttribute("aria-label"), "1 member entry");
  view.updateTabCountBadge(asHtmlElement(badge), "library:references");
  assert.equal(badge.getAttribute("aria-label"), "2 entries");
});
