import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "./support/obsidian-stub.ts";
import EntVaultCommandCenterPlugin from "../src/main";
import { ConfirmModal } from "../src/modals";
import { EntVaultCommandCenterView } from "../src/view";
import { portablePlaceholderPath } from "../src/model";
import { placementFactsAt, previewPlaceholderLinkEffects } from "../src/placeholder-link-effects";

// WF-11 fixtures P7-P12 (synthetic data only).
interface TestPluginBase { loadedData: unknown; savedData: unknown[] }
type TestPlugin = EntVaultCommandCenterPlugin & TestPluginBase;

const NOTE = "Knowledge Base/Airway/Laryngeal Cleft.md";
const OTHER = "Knowledge Base/Airway/Cleft Duplicate.md";
const placeholder = portablePlaceholderPath("subject");

function subject(id: string, title: string, indexed: boolean) {
  return { id, title, groupId: "group-airway", parentId: null, order: 0, indexed, configuredId: "", recordKind: "topic" as const };
}

async function scenario(options: { indexed?: boolean; linked?: boolean; owner?: boolean } = {}): Promise<{ plugin: TestPlugin; files: TFile[] }> {
  const files = [new TFile(NOTE), new TFile(OTHER)];
  let stored: unknown = null;
  const app = {
    loadLocalStorage: () => structuredClone(stored),
    saveLocalStorage: (_key: string, value: unknown) => { stored = structuredClone(value); },
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      getMarkdownFiles: () => files,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as TestPlugin;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjects = [subject("subject", "Laryngeal Cleft", options.indexed ?? true)];
  const resolved: Record<string, string> = {};
  if (options.linked !== false) resolved.subject = NOTE;
  if (options.owner) {
    subjects.push(subject("owner", "Imported Duplicate", true));
    resolved.owner = OTHER;
  }
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects,
    resolvedPathBySubjectId: resolved,
    relinkableSubjectIds: options.linked === false ? [] : ["subject"],
  };
  return { plugin, files };
}

function organize(plugin: TestPlugin, path: string): void {
  plugin.data.directIndexPaths = [path];
  plugin.data.pinnedPaths = [path];
  plugin.data.nextStudyPaths = [path];
  plugin.data.collections = [
    { id: "c1", title: "Exam", collapsed: false, subjects: [path], subheadings: [] },
    { id: "c2", title: "Clinic", collapsed: false, subjects: [], subheadings: [{ id: "s1", title: "Week 2", collapsed: false, subjects: [path] }] },
  ];
}

const snapshot = (plugin: TestPlugin): string => JSON.stringify(plugin.data);

test("P7 unlink preview names Direct, both Collection places, pin and Next, and the confirmed state equals it", async () => {
  const { plugin } = await scenario();
  organize(plugin, NOTE);
  const before = snapshot(plugin);
  const preview = previewPlaceholderLinkEffects(plugin.data, "unlink", "subject");
  assert.ok(preview);
  assert.equal(snapshot(plugin), before, "computing the preview must not mutate live data");
  assert.deepEqual(preview.before.collections, ["Exam", "Clinic › Week 2"]);
  assert.equal(preview.before.direct && preview.before.pinned && preview.before.next, true);
  assert.deepEqual(preview.after, preview.before);
  const empty = { direct: false, hidden: false, pinned: false, next: false, collections: [], group: "" };
  assert.deepEqual(placementFactsAt(plugin.data, placeholder), empty);

  await plugin.unlinkPortableSubject("subject");

  assert.deepEqual(placementFactsAt(plugin.data, placeholder), preview.after);
  assert.deepEqual(placementFactsAt(plugin.data, NOTE), empty);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.subject, undefined);
});

test("P7 cancel is a pure read and Undo/Redo restore the exact reviewed state (P12)", async () => {
  const { plugin } = await scenario();
  organize(plugin, NOTE);
  const reviewed = previewPlaceholderLinkEffects(plugin.data, "unlink", "subject");
  assert.ok(reviewed);
  const saves = plugin.savedData.length;
  assert.equal(plugin.savedData.length, saves);
  await plugin.unlinkPortableSubject("subject");
  await plugin.undo();
  assert.deepEqual(placementFactsAt(plugin.data, NOTE), reviewed.before);
  assert.equal(previewPlaceholderLinkEffects(plugin.data, "unlink", "subject")?.key, reviewed.key);
  await plugin.redo();
  assert.deepEqual(placementFactsAt(plugin.data, placeholder), reviewed.after);
});

test("P12 a rejected save leaves the linked state exactly as reviewed", async () => {
  const { plugin } = await scenario();
  organize(plugin, NOTE);
  const reviewed = previewPlaceholderLinkEffects(plugin.data, "unlink", "subject");
  assert.ok(reviewed);
  plugin.saveData = async () => { throw new Error("simulated save failure"); };
  await assert.rejects(plugin.unlinkPortableSubject("subject"), /rollback could not be saved/);
  assert.equal(plugin.isDataReadOnly(), true);
  assert.equal(previewPlaceholderLinkEffects(plugin.data, "unlink", "subject")?.key, reviewed.key);
  assert.deepEqual(plugin.data.portableIndex.resolvedPathBySubjectId.subject, NOTE);
});

function openView(plugin: TestPlugin, files: TFile[]): { review(kind: "unlink" | "link"): void; confirms: Array<{ title: string; message: string; confirm(): Promise<void> }>; restore(): void } {
  const confirms: Array<{ title: string; message: string; confirm(): Promise<void> }> = [];
  ConfirmModal.prototype.open = function openConfirm(): void {
    const self = this as unknown as { titleText: string; message: string; onConfirm(): Promise<void> };
    confirms.push({ title: self.titleText, message: self.message, confirm: () => self.onConfirm() });
  };
  const app = { vault: { getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null } };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView & Record<string, unknown>;
  Object.assign(view, {
    app, plugin, records: [], recordByPath: new Map(), loadedBaseId: plugin.getActiveKnowledgeBaseId(),
    loadedDataEpoch: plugin.getDataEpoch(), staleViewNoticeShown: false, viewClosed: false,
  });
  return {
    confirms,
    restore: () => { Reflect.deleteProperty(ConfirmModal.prototype, "open"); },
    review: (kind) => {
      if (kind === "unlink") view.confirmPortableSubjectUnlink({ portableId: "subject", title: "Laryngeal Cleft", path: NOTE } as never);
      else void view.resolvePortableSubjectLink("subject", "Laryngeal Cleft", files[0] ?? new TFile(NOTE));
    },
  };
}

test("P11 a placement that changes after review applies nothing and opens a fresh review", async () => {
  const { plugin, files } = await scenario();
  organize(plugin, NOTE);
  const harness = openView(plugin, files);
  try {
    harness.review("unlink");
    assert.equal(harness.confirms.length, 1);
    assert.match(harness.confirms[0]?.message ?? "", /2 Collection placements \(Exam; Clinic › Week 2\)/);
    plugin.data.pinnedPaths = [];
    const saves = plugin.savedData.length;
    await harness.confirms[0]?.confirm();
    assert.equal(plugin.savedData.length, saves);
    assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.subject, NOTE);
    assert.equal(harness.confirms.length, 2, "a fresh review opened");
    assert.doesNotMatch(harness.confirms[1]?.message ?? "", /a pin/);
    await harness.confirms[1]?.confirm();
    assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.subject, undefined);
  } finally { harness.restore(); }
});

test("P11 a link review applies only the reviewed effects and cancel writes nothing", async () => {
  const { plugin, files } = await scenario({ linked: false, indexed: false });
  const harness = openView(plugin, files);
  try {
    const before = snapshot(plugin);
    harness.review("link");
    await Promise.resolve();
    assert.equal(harness.confirms.length, 1);
    assert.match(harness.confirms[0]?.message ?? "", /not indexed/);
    assert.equal(snapshot(plugin), before, "cancel: no write");
    plugin.data.pinnedPaths = [placeholder];
    await harness.confirms[0]?.confirm();
    assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.subject, undefined);
    assert.equal(harness.confirms.length, 2);
  } finally { harness.restore(); }
});

test("P8 pre-existing membership is shown as it is, never with an invented origin", async () => {
  const { plugin } = await scenario();
  plugin.data.directIndexPaths = [NOTE];
  const preview = previewPlaceholderLinkEffects(plugin.data, "unlink", "subject");
  assert.ok(preview);
  assert.equal(preview.before.direct, true);
  const text = preview.lines.join(" ");
  assert.match(text, /Direct Index membership/);
  assert.doesNotMatch(text, /originally|came from|provenance|predat|added by/i);
});

test("P9 a linked folder that still supplies the note makes the result conditional, not gone", async () => {
  const { plugin } = await scenario();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.indexFolderSources = [{ id: "src", path: "Knowledge Base", origin: "user", addedAt: 0 } as never];
  plugin.data.directIndexPaths = [NOTE];
  const preview = previewPlaceholderLinkEffects(plugin.data, "unlink", "subject");
  assert.ok(preview);
  assert.equal(preview.folderSupplies, true);
  const text = preview.lines.join(" ");
  assert.match(text, /still supplied by an Index folder/);
  assert.doesNotMatch(text, /disappear|removed from (every|all)/i);
  await plugin.unlinkPortableSubject("subject");
  assert.equal(plugin.data.directIndexPaths.includes(NOTE), false);
  assert.equal(previewPlaceholderLinkEffects({ ...plugin.data, portableIndex: { ...plugin.data.portableIndex, resolvedPathBySubjectId: { subject: NOTE } } }, "unlink", "subject")?.folderSupplies, true);
});

test("P10 link preview matches the service for indexed and non-indexed subjects", async () => {
  for (const indexed of [true, false]) {
    const { plugin } = await scenario({ indexed, linked: false });
    plugin.data.settings.workspaceMode = "generic";
    plugin.data.indexFolderSources = [{ id: "src", path: "Knowledge Base", origin: "user", addedAt: 0 } as never];
    organize(plugin, placeholder);
    plugin.data.directIndexPaths = [NOTE];
    plugin.data.pinnedPaths = [placeholder, NOTE];
    plugin.data.collections[0]?.subjects.push(NOTE);
    const before = snapshot(plugin);
    const preview = previewPlaceholderLinkEffects(plugin.data, "link", "subject", NOTE);
    assert.ok(preview);
    assert.equal(snapshot(plugin), before);
    assert.equal(preview.after.direct, indexed);
    assert.equal(preview.after.hidden, !indexed);
    assert.deepEqual(preview.after.collections, ["Exam", "Clinic › Week 2"]);
    assert.equal(preview.after.pinned, true);
    await plugin.resolvePortableSubject("subject", NOTE);
    assert.deepEqual(placementFactsAt(plugin.data, NOTE), preview.after);
    assert.equal(plugin.data.pinnedPaths.filter((path) => path === NOTE).length, 1, "deduplicated");
  }
});

test("P10 an existing identity merge is disclosed and the merged result equals the preview", async () => {
  const { plugin } = await scenario({ linked: false, owner: true });
  plugin.data.pinnedPaths = [OTHER, placeholder];
  plugin.data.collections = [{ id: "c1", title: "Exam", collapsed: false, subjects: [OTHER, placeholder], subheadings: [] }];
  const preview = previewPlaceholderLinkEffects(plugin.data, "link", "subject", OTHER);
  assert.ok(preview);
  assert.equal(preview.mergesOwnerId, "owner");
  assert.match(preview.lines.join(" "), /Imported Duplicate.*merged/);
  await plugin.resolvePortableSubject("subject", OTHER, true);
  assert.deepEqual(placementFactsAt(plugin.data, OTHER), preview.after);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [OTHER]);
  assert.equal(plugin.data.portableIndex.subjects.some((candidate) => candidate.id === "owner"), false);
});

test("P10 a cross-group merge previews the same group label the service applies, in both cross-group modes", async () => {
  for (const clinical of [false, true]) {
    const { plugin } = await scenario({ linked: false, owner: true });
    plugin.data.settings.workspaceMode = clinical ? "ent-clinical" : "generic";
    plugin.data.settings.allowClinicalVisualGroupMoves = true;
    plugin.data.portableIndex.groups.push({ id: "group-voice", title: "Voice", order: 1 });
    plugin.data.indexGroupByPath[placeholder] = "Airway";
    plugin.data.indexGroupByPath[OTHER] = "Voice";
    const preview = previewPlaceholderLinkEffects(plugin.data, "link", "subject", OTHER);
    assert.ok(preview);
    assert.equal(preview.toBefore.group, "Voice");
    assert.equal(preview.after.group, "Airway");
    assert.match(preview.lines.join(" "), /the group “Airway”/);
    await plugin.resolvePortableSubject("subject", OTHER, true);
    assert.deepEqual(placementFactsAt(plugin.data, OTHER), preview.after);
  }
  const { plugin } = await scenario({ linked: false, owner: true });
  plugin.data.settings.workspaceMode = "ent-clinical";
  plugin.data.settings.allowClinicalVisualGroupMoves = false;
  plugin.data.indexGroupByPath[OTHER] = "Voice";
  const preview = previewPlaceholderLinkEffects(plugin.data, "link", "subject", OTHER);
  assert.equal(preview?.after.group, "", "no group label when cross-group moves are disallowed");
  await plugin.resolvePortableSubject("subject", OTHER, true);
  assert.deepEqual(placementFactsAt(plugin.data, OTHER), preview?.after);
});

test("R3 Direct-state text and facts match the real service for Generic and ENT, indexed and non-indexed", async () => {
  for (const mode of ["generic", "ent-clinical"] as const) {
    for (const indexed of [true, false]) {
      const { plugin } = await scenario({ indexed, linked: false });
      plugin.data.settings.workspaceMode = mode;
      plugin.data.directIndexPaths = [NOTE];
      const preview = previewPlaceholderLinkEffects(plugin.data, "link", "subject", NOTE);
      assert.ok(preview);
      await plugin.resolvePortableSubject("subject", NOTE);
      assert.deepEqual(placementFactsAt(plugin.data, NOTE), preview.after, `${mode} indexed=${indexed}`);
      const text = preview.lines.join(" ");
      const expectedDirect = indexed || mode === "ent-clinical";
      assert.equal(preview.after.direct, expectedDirect);
      if (!indexed) assert.match(text, expectedDirect ? /leaves the note's Direct Index membership on/ : /Direct Index membership is cleared/);
      if (!indexed && expectedDirect) assert.doesNotMatch(text, /cleared|hidden/);
    }
  }
});

function libraryMergeScenario() {
  return scenario({ linked: false, owner: true, indexed: false }).then(({ plugin, files }) => {
    for (const item of plugin.data.portableIndex.subjects) Object.assign(item, { libraryId: "reading", indexed: false });
    plugin.data.portableIndex.libraries = [{ id: "reading", name: "Reading", singularName: "Item", icon: "book", order: 0, sourceKind: null, archivedAt: null }];
    plugin.data.portableIndex.libraryLayouts = { reading: [
      { id: "old", title: "Old placement", collapsed: false, subjects: ["owner"], subheadings: [] },
      { id: "preferred", title: "Preferred placement", collapsed: false, subjects: ["subject"], subheadings: [] },
    ] };
    plugin.data.portableIndex.subjects.push({ ...subject("kid", "Owner child", false), parentId: "owner", libraryId: "reading" });
    return { plugin, files };
  });
}

test("R2 a merge preview names the Library and child effects the service applies and keys them", async () => {
  const { plugin } = await libraryMergeScenario();
  const preview = previewPlaceholderLinkEffects(plugin.data, "link", "subject", OTHER);
  assert.ok(preview);
  const text = preview.lines.join(" ");
  assert.match(text, /reading › Old placement.*reading › Preferred placement.*become reading › Preferred placement/);
  assert.match(text, /Child subjects move under this subject: Owner child/);
  assert.doesNotMatch(text, /follow the subject and do not change/);
  const key = preview.key;
  const [oldNode, preferredNode] = plugin.data.portableIndex.libraryLayouts.reading ?? [];
  assert.ok(oldNode && preferredNode);
  oldNode.subjects = [];
  preferredNode.subjects = ["subject", "owner"];
  assert.notEqual(previewPlaceholderLinkEffects(plugin.data, "link", "subject", OTHER)?.key, key, "moved Library occurrence");
  oldNode.subjects = ["owner"];
  preferredNode.subjects = ["subject"];
  assert.equal(previewPlaceholderLinkEffects(plugin.data, "link", "subject", OTHER)?.key, key);
  plugin.data.portableIndex.subjects.push({ ...subject("kid2", "Late child", false), parentId: "owner", libraryId: "reading" });
  assert.notEqual(previewPlaceholderLinkEffects(plugin.data, "link", "subject", OTHER)?.key, key, "new child");
  plugin.data.portableIndex.subjects.pop();
  await plugin.resolvePortableSubject("subject", OTHER, true);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.reading?.map((node) => node.subjects), [[], ["subject"]]);
  assert.equal(plugin.data.portableIndex.subjects.find((item) => item.id === "kid")?.parentId, "subject");
});

test("R1 a renamed file or a renamed subject during the review applies nothing", async () => {
  const renamedFile = await scenario({ linked: false });
  let harness = openView(renamedFile.plugin, renamedFile.files);
  try {
    harness.review("link");
    await Promise.resolve();
    assert.equal(harness.confirms.length, 1);
    const chosen = renamedFile.files[0];
    assert.ok(chosen);
    chosen.path = "Knowledge Base/Airway/Renamed.md";
    await harness.confirms[0]?.confirm();
    assert.equal(renamedFile.plugin.data.portableIndex.resolvedPathBySubjectId.subject, undefined);
    assert.equal(harness.confirms.length, 1, "no stale review is reopened for a different file");
  } finally { harness.restore(); }

  const renamedSubject = await scenario({ linked: false });
  harness = openView(renamedSubject.plugin, renamedSubject.files);
  try {
    harness.review("link");
    await Promise.resolve();
    const subjectNow = renamedSubject.plugin.data.portableIndex.subjects[0];
    assert.ok(subjectNow);
    subjectNow.title = "Changed subject";
    await harness.confirms[0]?.confirm();
    assert.equal(renamedSubject.plugin.data.portableIndex.resolvedPathBySubjectId.subject, undefined);
    assert.equal(harness.confirms.length, 2);
    assert.match(harness.confirms[1]?.message ?? "", /“Changed subject” will be linked/);
  } finally { harness.restore(); }
});

test("P11 a changed binding or membership changes the review key, so a stale review cannot apply", async () => {
  const { plugin } = await scenario();
  organize(plugin, NOTE);
  const reviewed = previewPlaceholderLinkEffects(plugin.data, "unlink", "subject");
  assert.ok(reviewed);
  plugin.data.pinnedPaths = [];
  assert.notEqual(previewPlaceholderLinkEffects(plugin.data, "unlink", "subject")?.key, reviewed.key);
  plugin.data.pinnedPaths = [NOTE];
  assert.equal(previewPlaceholderLinkEffects(plugin.data, "unlink", "subject")?.key, reviewed.key);
  plugin.data.portableIndex.resolvedPathBySubjectId.subject = OTHER;
  assert.notEqual(previewPlaceholderLinkEffects(plugin.data, "unlink", "subject")?.key, reviewed.key);
  delete plugin.data.portableIndex.resolvedPathBySubjectId.subject;
  assert.equal(previewPlaceholderLinkEffects(plugin.data, "unlink", "subject"), null);
});
