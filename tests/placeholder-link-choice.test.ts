import assert from "node:assert/strict";
import test from "node:test";
import { Notice, TFile } from "./support/obsidian-stub.ts";
import { ConfirmModal, IndexGroupModal, StringPickerModal, VaultFilePickerModal } from "../src/modals";
import { cloneJsonValue, DEFAULT_DATA, portablePlaceholderPath } from "../src/model";
import { placeholderChoiceLabels, projectPlaceholderCandidates } from "../src/placeholder-link-choice";
import EntVaultCommandCenterPlugin from "../src/main";
import { EntVaultCommandCenterView } from "../src/view";
import { createFakeDom } from "./support/fake-dom";

// WF-10 fixtures P1-P6 (synthetic). Modals are observed through their prototypes; nothing is auto-chosen.
interface Captured {
  pickers: Array<{ title: string; items: string[]; choose(item: string): void }>;
  groups: Array<{ title: string; submit(group: string): Promise<void> }>;
  confirms: Array<{ title: string; message: string; confirm(): Promise<void> }>;
}

function captureModals(chooseFile: (files: TFile[]) => TFile): { captured: Captured; restore(): void } {
  const captured: Captured = { pickers: [], groups: [], confirms: [] };
  // None of these classes defines its own open(); deleting the override restores the inherited one.
  const modals = [VaultFilePickerModal, StringPickerModal, IndexGroupModal, ConfirmModal];
  VaultFilePickerModal.prototype.open = function openFiles(): void { this.onChooseItem(chooseFile(this.getItems())); };
  StringPickerModal.prototype.open = function openStrings(): void {
    const self = this as unknown as { titleText: string };
    captured.pickers.push({ title: self.titleText, items: this.getItems(), choose: (item) => this.onChooseItem(item) });
  };
  IndexGroupModal.prototype.open = function openGroup(): void {
    const self = this as unknown as { options: { title: string; onSubmit(group: string): Promise<void> } };
    captured.groups.push({ title: self.options.title, submit: (group) => self.options.onSubmit(group) });
  };
  ConfirmModal.prototype.open = function openConfirm(): void {
    const self = this as unknown as { titleText: string; message: string; onConfirm(): Promise<void> };
    captured.confirms.push({ title: self.titleText, message: self.message, confirm: () => self.onConfirm() });
  };
  return { captured, restore: () => { for (const modal of modals) Reflect.deleteProperty(modal.prototype, "open"); } };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
}

function subject(id: string, title: string, groupId: string, configuredId = "", libraryId: string | null = null) {
  return { id, title, groupId, parentId: null, order: 0, indexed: true, configuredId, recordKind: "topic" as const, libraryId };
}

function scenario(options: {
  subjects: Array<ReturnType<typeof subject>>;
  resolved?: Record<string, string>;
  note?: { path: string; title?: string; id?: string };
  noteAvailable?: () => boolean;
}) {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.workspaceMode = "generic";
  data.portableIndex.groups = [{ id: "airway", title: "Airway", order: 0 }, { id: "voice", title: "Voice", order: 1 }];
  data.portableIndex.subjects = options.subjects;
  data.portableIndex.resolvedPathBySubjectId = options.resolved ?? {};
  data.portableIndex.libraries = [{ id: "reading", name: "Reading", singularName: "Item", icon: "book", order: 0, sourceKind: null, archivedAt: null }];
  const notePath = options.note?.path ?? "Notes/Laryngomalacia.md";
  const file = new TFile(notePath);
  const state = { baseId: "base-a", available: options.noteAvailable ?? (() => true), subjectsRemoved: false, data, replacement: null as TFile | null };
  const calls = { resolve: [] as Array<[string, string, boolean | undefined]>, assign: [] as string[] };
  const frontmatter: Record<string, unknown> = {};
  if (options.note?.title) frontmatter.title = options.note.title;
  if (options.note?.id) frontmatter[data.settings.idProperty] = options.note.id;
  const plugin = {
    // An external Sync reload replaces the whole data object; always read the current one.
    get data() { return state.data; },
    getActiveKnowledgeBaseId: () => state.baseId,
    getDataEpoch: () => 0,
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    getIndexCandidateFiles: () => [file],
    suggestedIndexGroup: () => "Airway",
    getIndexGroups: () => ["Airway"],
    getLibrary: (id: string) => data.portableIndex.libraries.find((library) => library.id === id) ?? null,
    getPortableSubject: (id: string) => state.subjectsRemoved ? null : state.data.portableIndex.subjects.find((candidate) => candidate.id === id) ?? null,
    resolvePortableSubject: async (id: string, path: string, merge?: boolean) => { calls.resolve.push([id, path, merge]); },
    assignRecordToCatalog: async (path: string) => { calls.assign.push(path); },
  };
  const app = {
    // A replacement is a different TFile object created at the identical path.
    vault: { getAbstractFileByPath: (path: string) => path !== file.path ? null : state.replacement ?? (state.available() ? file : null) },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & Record<string, unknown>;
  Object.assign(view, {
    app, plugin, records: [], recordByPath: new Map(), loadedBaseId: "base-a", loadedDataEpoch: 0, staleViewNoticeShown: false,
    contentEl: createFakeDom().document.body, viewClosed: false,
  });
  return { view, data, plugin, state, calls, file, startExisting: () => view.startAddExistingToIndex() };
}

test("WF10 helper: exact normalized title or configured ID only, ranked, with distinct readable labels", () => {
  const candidates = projectPlaceholderCandidates({ title: "  LARYNGOMALACIA ", curriculumId: "ent-1" }, [
    { id: "s1", title: "Laryngomalacia", configuredId: "", context: ["Airway"] },
    { id: "s2", title: "Something else", configuredId: "ENT-1", context: ["Reading", "Voice"] },
    { id: "s3", title: "Laryngomalacia", configuredId: "ENT-1", context: ["Airway", "Child"] },
    { id: "s4", title: "Laryngomalacia care", configuredId: "", context: [] },
  ]);
  assert.deepEqual(candidates.map((candidate) => [candidate.id, candidate.match]), [["s3", "title + ID"], ["s2", "ID"], ["s1", "title"]]);
  const labels = placeholderChoiceLabels([...candidates, { ...candidates[2], id: "s5" }]);
  assert.equal(new Set(labels).size, labels.length, "even identical context stays distinguishable");
  assert.match(labels[1] ?? "", /ID ENT-1.*Reading › Voice/u);
});

test("WF10 P1 a title candidate and an ID-only candidate require an explicit choice before any write", async () => {
  const s = scenario({
    subjects: [subject("title-only", "Laryngomalacia", "airway"), subject("id-only", "Imported ID subject", "voice", "ENT-1")],
    note: { path: "Notes/Laryngomalacia.md", id: "ENT-1" },
  });
  const modals = captureModals((files) => files[0]);
  try {
    s.startExisting();
    await settle();
    assert.equal(modals.captured.groups.length, 0, "the group picker waits for the choice");
    const picker = modals.captured.pickers[0];
    assert.ok(picker);
    assert.equal(picker.items.length, 3);
    assert.match(picker.items[0], /separately/u);
    assert.ok(picker.items.slice(1).some((item) => /title match/u.test(item)) && picker.items.slice(1).some((item) => /ID match/u.test(item)));
    assert.deepEqual(s.calls.resolve, []);
    assert.deepEqual(s.calls.assign, []);
    picker.choose(picker.items.find((item) => /ID match/u.test(item)) ?? "");
    await settle();
    assert.deepEqual(s.calls.resolve, [["id-only", "Notes/Laryngomalacia.md", undefined]]);
    assert.deepEqual(s.calls.assign, [], "linking never also places the note separately");
  } finally { modals.restore(); }
});

test("WF10 P2 duplicate titles in different groups and Libraries are distinguishable and never auto-linked", async () => {
  const s = scenario({
    subjects: [subject("a", "Laryngomalacia", "airway"), subject("b", "Laryngomalacia", "voice", "", "reading")],
  });
  const modals = captureModals((files) => files[0]);
  try {
    s.startExisting();
    await settle();
    const picker = modals.captured.pickers[0];
    assert.ok(picker);
    const choices = picker.items.slice(1);
    assert.equal(new Set(choices).size, 2);
    assert.ok(choices.some((item) => /Airway/u.test(item)) && choices.some((item) => /Reading › Voice/u.test(item)));
    assert.deepEqual(s.calls.resolve, [], "two exact titles are never resolved by title");
  } finally { modals.restore(); }
});

test("WF10 P3 add separately keeps the existing placement route, cancel writes nothing, and no match skips the choice", async () => {
  const separate = scenario({ subjects: [subject("a", "Laryngomalacia", "airway")] });
  const modals = captureModals((files) => files[0]);
  try {
    separate.startExisting();
    await settle();
    const picker = modals.captured.pickers[0];
    assert.ok(picker);
    picker.choose(picker.items[0]);
    await settle();
    assert.equal(modals.captured.groups.length, 1, "the existing group picker follows");
    await modals.captured.groups[0].submit("Airway");
    assert.deepEqual(separate.calls.assign, ["Notes/Laryngomalacia.md"]);
    assert.deepEqual(separate.calls.resolve, []);

    const cancelled = scenario({ subjects: [subject("a", "Laryngomalacia", "airway")] });
    const before = modals.captured.groups.length;
    cancelled.startExisting();
    await settle();
    assert.equal(modals.captured.groups.length, before, "closing the choice opens nothing");
    assert.deepEqual([cancelled.calls.assign, cancelled.calls.resolve], [[], []]);

    const none = scenario({ subjects: [subject("a", "Unrelated title", "airway")] });
    const pickersBefore = modals.captured.pickers.length;
    none.startExisting();
    await settle();
    assert.equal(modals.captured.pickers.length, pickersBefore, "no candidate: no extra step");
    assert.equal(modals.captured.groups.length, before + 1, "the current group-picker route is retained");
  } finally { modals.restore(); }
});

test("WF10 P4 a removed file, removed subject or switched base rejects safely with zero writes", async () => {
  const cases: Array<[string, (s: ReturnType<typeof scenario>) => void]> = [
    ["file removed", (s) => { s.state.available = () => false; }],
    ["subject removed", (s) => { s.state.subjectsRemoved = true; }],
    ["subject already bound elsewhere", (s) => { s.data.portableIndex.resolvedPathBySubjectId.a = "Notes/Elsewhere.md"; }],
    ["base switched", (s) => { s.state.baseId = "base-b"; }],
  ];
  for (const [name, change] of cases) {
    const s = scenario({ subjects: [subject("a", "Laryngomalacia", "airway")] });
    const modals = captureModals((files) => files[0]);
    try {
      s.startExisting();
      await settle();
      const picker = modals.captured.pickers[0];
      assert.ok(picker, name);
      change(s);
      picker.choose(picker.items[1]);
      await settle();
      assert.deepEqual([s.calls.resolve, s.calls.assign, modals.captured.confirms.length], [[], [], 0], name);
    } finally { modals.restore(); }
  }
});

test("WF10 P4b a binding made in a replaced data object between opening and choosing is not linked over", async () => {
  const s = scenario({ subjects: [subject("a", "Laryngomalacia", "airway")] });
  const modals = captureModals((files) => files[0]);
  try {
    s.startExisting();
    await settle();
    const picker = modals.captured.pickers[0];
    assert.ok(picker);
    // A Sync reload replaced the data object, and the subject is now bound in the replacement.
    const replaced = cloneJsonValue(s.data);
    replaced.portableIndex.resolvedPathBySubjectId.a = "Notes/Elsewhere.md";
    s.state.data = replaced;
    const notices = (Notice as unknown as { messages: string[] }).messages;
    notices.length = 0;
    picker.choose(picker.items[1]);
    await settle();
    assert.deepEqual([s.calls.resolve, s.calls.assign, modals.captured.confirms.length], [[], [], 0]);
    assert.match(notices.at(-1) ?? "", /out of date.*Nothing was changed/u);
  } finally { modals.restore(); }
});

test("WF10 P4d a subject renamed between opening and choosing gives the out-of-date notice and no link", async () => {
  const s = scenario({ subjects: [subject("a", "Laryngomalacia", "airway")] });
  const modals = captureModals((files) => files[0]);
  try {
    s.startExisting();
    await settle();
    const picker = modals.captured.pickers[0];
    assert.ok(picker);
    s.data.portableIndex.subjects[0].title = "Renamed after the list was built";
    const notices = (Notice as unknown as { messages: string[] }).messages;
    notices.length = 0;
    picker.choose(picker.items[1]);
    await settle();
    assert.deepEqual([s.calls.resolve, s.calls.assign], [[], []]);
    assert.match(notices.at(-1) ?? "", /out of date.*Nothing was changed/u);
  } finally { modals.restore(); }
});

test("WF10 P4c a different file created at the same path is never linked, before or after the merge confirmation", async () => {
  const notices = (Notice as unknown as { messages: string[] }).messages;
  const stale = /out of date.*Nothing was changed/u;
  const direct = scenario({ subjects: [subject("a", "Laryngomalacia", "airway")] });
  const modals = captureModals((files) => files[0]);
  try {
    direct.startExisting();
    await settle();
    const picker = modals.captured.pickers[0];
    assert.ok(picker);
    direct.state.replacement = new TFile(direct.file.path);
    notices.length = 0;
    picker.choose(picker.items[1]);
    await settle();
    assert.deepEqual(direct.calls.resolve, [], "replacement between opening and choosing");
    assert.match(notices.at(-1) ?? "", stale);

    const merging = scenario({
      subjects: [subject("placeholder", "Laryngomalacia", "airway"), subject("owner", "Existing owner", "airway")],
      resolved: { owner: "Notes/Laryngomalacia.md" },
    });
    merging.startExisting();
    await settle();
    const mergePicker = modals.captured.pickers.at(-1);
    assert.ok(mergePicker);
    mergePicker.choose(mergePicker.items[1]);
    await settle();
    const confirm = modals.captured.confirms.at(-1);
    assert.ok(confirm);
    merging.state.replacement = new TFile(merging.file.path);
    notices.length = 0;
    await confirm.confirm();
    assert.deepEqual(merging.calls.resolve, [], "replacement between the merge confirmation and the commit");
    assert.match(notices.at(-1) ?? "", stale);

    const same = scenario({ subjects: [subject("a", "Laryngomalacia", "airway")] });
    same.startExisting();
    await settle();
    const control = modals.captured.pickers.at(-1);
    assert.ok(control);
    control.choose(control.items[1]);
    await settle();
    assert.equal(same.calls.resolve.length, 1, "control: the unchanged file links normally");
  } finally { modals.restore(); }
});

test("WF10 P5 a file that already carries another portable identity needs the explicit merge confirmation", async () => {
  const s = scenario({
    subjects: [subject("placeholder", "Laryngomalacia", "airway"), subject("owner", "Existing owner", "airway")],
    resolved: { owner: "Notes/Laryngomalacia.md" },
  });
  const modals = captureModals((files) => files[0]);
  try {
    s.startExisting();
    await settle();
    const picker = modals.captured.pickers[0];
    assert.ok(picker);
    picker.choose(picker.items[1]);
    await settle();
    assert.deepEqual(s.calls.resolve, [], "no silent identity merge");
    assert.equal(modals.captured.confirms.length, 1);
    assert.match(modals.captured.confirms[0].message, /merge that portable identity/u);
    await modals.captured.confirms[0].confirm();
    assert.deepEqual(s.calls.resolve, [["placeholder", "Notes/Laryngomalacia.md", true]]);
  } finally { modals.restore(); }
});

test("WF10 P6 the real link keeps placement, leaves file bytes untouched, and Undo/Redo restore it exactly", async () => {
  const file = new TFile("Knowledge Base/Airway/Laryngeal Cleft.md");
  const bytes = "synthetic note body";
  let writes = 0;
  const app = {
    loadLocalStorage: () => null, saveLocalStorage: () => undefined,
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      getMarkdownFiles: () => [file],
      modify: async () => { writes += 1; }, process: async () => { writes += 1; }, create: async () => { writes += 1; },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { processFrontMatter: async () => { writes += 1; } },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & { loadedData: unknown };
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-laryngeal-cleft";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 2,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [subject(subjectId, "Laryngeal Cleft", "group-airway")],
    resolvedPathBySubjectId: {},
  };
  plugin.data.directIndexPaths = [placeholder];
  plugin.data.indexGroupByPath[placeholder] = "Airway";
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [placeholder], subheadings: [] }];
  plugin.invalidateRecordCache();
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & Record<string, unknown>;
  Object.assign(view, {
    app, plugin, records: plugin.getRecords(), recordByPath: new Map(), loadedBaseId: plugin.getActiveKnowledgeBaseId(),
    loadedDataEpoch: plugin.getDataEpoch(), staleViewNoticeShown: false, contentEl: createFakeDom().document.body, viewClosed: false,
  });
  const modals = captureModals((files) => files[0]);
  try {
    const organization = (): string => JSON.stringify([plugin.data.portableIndex.resolvedPathBySubjectId, plugin.data.collections, plugin.data.directIndexPaths, plugin.data.indexGroupByPath]);
    const before = organization();
    view.startAddExistingToIndex();
    await settle();
    const picker = modals.captured.pickers[0];
    assert.ok(picker, "the existing note matches the imported subject");
    picker.choose(picker.items[1]);
    await settle();
    assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], file.path);
    assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
    const linked = organization();
    await plugin.undo();
    assert.equal(organization(), before, "Undo restores the exact prior organization");
    await plugin.redo();
    assert.equal(organization(), linked, "Redo restores the exact link");
    assert.equal(writes, 0, "no Markdown write of any kind");
    assert.equal(bytes, "synthetic note body");
    assert.ok((Notice as unknown as { messages: string[] }).messages.some((message) => /Markdown note was not changed/u.test(message)));
  } finally { modals.restore(); }
});
