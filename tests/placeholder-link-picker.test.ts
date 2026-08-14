import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { VaultFilePickerModal } from "../src/modals";
import { cloneJsonValue, DEFAULT_DATA, portablePlaceholderPath, type VaultRecord } from "../src/model";
import { EntVaultCommandCenterView } from "../src/view";
import { asHtmlElement, createFakeDom } from "./support/fake-dom";

function record(path: string, title: string, curriculumId = ""): VaultRecord {
  return {
    path, title, kind: "topic", role: "canonical", curriculumId, domain: "Airway", topicKind: "condition",
    priority: "", reviewStatus: "", synthesisStatus: "", autoresearchStatus: "", safetyCritical: false,
    sourceCount: 0, aliases: [], relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "",
    sourceCoverage: "", folderOrder: "", mtime: 0, aiLock: false,
  };
}

test("placeholder link picker labels and prioritizes exact candidates without selecting one", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  const subject = {
    id: "subject-one", title: "Laryngomalacia", groupId: "airway", parentId: null, order: 0,
    indexed: true, configuredId: "ENT-PED-001", recordKind: "topic" as const, libraryId: null,
  };
  const existingOwner = {
    ...subject,
    id: "existing-owner",
    title: "Existing owner",
    configuredId: "",
  };
  data.portableIndex.groups = [{ id: "airway", title: "Airway", order: 0 }];
  data.portableIndex.subjects = [subject, existingOwner];
  data.portableIndex.resolvedPathBySubjectId = { "existing-owner": "Notes/Owned.md" };

  const files = [
    new TFile("Notes/Other.md"),
    new TFile("Notes/Title.md"),
    new TFile("Notes/Id.md"),
    new TFile("Notes/Owned.md"),
    new TFile("Notes/Both.md"),
  ];
  const records = [
    record(files[0]?.path ?? "", "Other"),
    record(files[1]?.path ?? "", "Laryngomalacia"),
    record(files[2]?.path ?? "", "Different", "ENT-PED-001"),
    record(files[3]?.path ?? "", "Laryngomalacia", "ENT-PED-001"),
    record(files[4]?.path ?? "", "Laryngomalacia", "ENT-PED-001"),
  ];
  const placeholder = {
    ...record(portablePlaceholderPath(subject.id), subject.title, subject.configuredId),
    role: "placeholder" as const,
    portableId: subject.id,
    isPlaceholder: true,
    portableIndexed: true,
  };
  let resolveCalls = 0;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getPortableSubject: (id: string) => data.portableIndex.subjects.find((candidate) => candidate.id === id) ?? null,
    getVaultNoteFiles: () => files,
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: object;
    plugin: typeof plugin;
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openPortableSubjectLinkPicker(value: VaultRecord): void;
    resolvePortableSubjectLink(): Promise<void>;
  };
  view.app = {};
  view.plugin = plugin;
  view.records = records;
  view.recordByPath = new Map(records.map((candidate) => [candidate.path, candidate]));
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.resolvePortableSubjectLink = async () => { resolveCalls += 1; };

  const originalOpen = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  let orderedPaths: string[] = [];
  let searchedPaths: string[] = [];
  const labels = new Map<string, string>();
  VaultFilePickerModal.prototype.open = function inspectPicker(): void {
    orderedPaths = this.getItems().map((file) => file.path);
    searchedPaths = this.getSuggestions("laryngomalacia").map((match) => match.item.path);
    const dom = createFakeDom();
    for (const file of this.getItems()) {
      const element = asHtmlElement(dom.document.body.createDiv());
      this.renderSuggestion({ item: file } as never, element);
      labels.set(file.path, element.textContent);
    }
  };
  try {
    view.openPortableSubjectLinkPicker(placeholder);
  } finally {
    if (originalOpen) Object.defineProperty(VaultFilePickerModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(VaultFilePickerModal.prototype, "open");
  }

  assert.deepEqual(orderedPaths, [
    "Notes/Both.md",
    "Notes/Owned.md",
    "Notes/Id.md",
    "Notes/Title.md",
    "Notes/Other.md",
  ]);
  assert.match(labels.get("Notes/Both.md") ?? "", /Exact title \+ configured ID candidate.*review before linking/u);
  assert.match(labels.get("Notes/Owned.md") ?? "", /existing portable identity/u);
  assert.match(labels.get("Notes/Id.md") ?? "", /Exact configured ID candidate/u);
  assert.match(labels.get("Notes/Title.md") ?? "", /Exact title candidate/u);
  assert.doesNotMatch(labels.get("Notes/Other.md") ?? "", /candidate/u);
  assert.deepEqual(searchedPaths.sort(), ["Notes/Both.md", "Notes/Owned.md", "Notes/Title.md"]);
  assert.equal(resolveCalls, 0, "opening the picker never auto-selects or links a candidate");
});

test("placeholder link picker highlights an exact unindexed eligible README note", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  const subject = {
    id: "readme-subject", title: "README", groupId: "docs", parentId: null, order: 0,
    indexed: true, configuredId: "", recordKind: "topic" as const, libraryId: null,
  };
  data.portableIndex.groups = [{ id: "docs", title: "Docs", order: 0 }];
  data.portableIndex.subjects = [subject];
  const file = new TFile("Other/README.md");
  const placeholder = {
    ...record(portablePlaceholderPath(subject.id), subject.title),
    role: "placeholder" as const,
    portableId: subject.id,
    isPlaceholder: true,
    portableIndexed: true,
  };
  let resolveCalls = 0;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 0,
    getPortableSubject: (id: string) => data.portableIndex.subjects.find((candidate) => candidate.id === id) ?? null,
    getVaultNoteFiles: () => [file],
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: { metadataCache: { getFileCache(): null } };
    plugin: typeof plugin;
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    loadedBaseId: string;
    loadedDataEpoch: number;
    staleViewNoticeShown: boolean;
    openPortableSubjectLinkPicker(value: VaultRecord): void;
    resolvePortableSubjectLink(): Promise<void>;
  };
  view.app = { metadataCache: { getFileCache: () => null } };
  view.plugin = plugin;
  view.records = [placeholder];
  view.recordByPath = new Map([[placeholder.path, placeholder]]);
  view.loadedBaseId = "base-a";
  view.loadedDataEpoch = 0;
  view.staleViewNoticeShown = false;
  view.resolvePortableSubjectLink = async () => { resolveCalls += 1; };

  const originalOpen = Object.getOwnPropertyDescriptor(VaultFilePickerModal.prototype, "open");
  let orderedPaths: string[] = [];
  let label = "";
  VaultFilePickerModal.prototype.open = function inspectPicker(): void {
    orderedPaths = this.getItems().map((candidate) => candidate.path);
    const dom = createFakeDom();
    const element = asHtmlElement(dom.document.body.createDiv());
    this.renderSuggestion({ item: this.getItems()[0] } as never, element);
    label = element.textContent;
  };
  try {
    view.openPortableSubjectLinkPicker(placeholder);
  } finally {
    if (originalOpen) Object.defineProperty(VaultFilePickerModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(VaultFilePickerModal.prototype, "open");
  }

  assert.deepEqual(orderedPaths, ["Other/README.md"]);
  assert.match(label, /Exact title candidate \(README\).*review before linking/u);
  assert.equal(resolveCalls, 0);
});
