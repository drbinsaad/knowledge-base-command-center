import assert from "node:assert/strict";
import test from "node:test";
import { TFolder } from "obsidian";
import { IndexManagerModal } from "../src/index-manager";
import { cloneJsonValue, DEFAULT_DATA, type VaultRecord } from "../src/model";
import { asHtmlElement, createFakeDom } from "./support/fake-dom";

function record(path: string, options: Partial<VaultRecord> = {}): VaultRecord {
  return {
    path,
    title: path.split("/").pop()?.replace(/\.md$/u, "") ?? path,
    kind: "topic",
    role: "canonical",
    curriculumId: "",
    domain: "General",
    topicKind: "condition",
    priority: "",
    reviewStatus: "",
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
    folderOrder: "",
    mtime: 0,
    aiLock: false,
    ...options,
  };
}

test("Index Manager explains linked-folder authority separately from storage folders", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.settings.defaultNoteFolder = "Knowledge Base";
  data.settings.proposalFolder = "Inbox";
  data.directIndexPaths = ["Knowledge Base/Direct.md"];
  data.indexFolderSources = [{ id: "legacy-source", path: "Knowledge Base", origin: "legacy-primary-folder" }];
  const records = [
    record("Knowledge Base/Direct.md"),
    record("Knowledge Base/README.md"),
    record("kbcc-placeholder:imported", { role: "placeholder", isPlaceholder: true, portableId: "imported" }),
  ];
  let reviewed = "";
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: unknown;
    plugin: unknown;
    openedBaseId: string;
    openedDataEpoch: number;
    renderSourceSummary(parent: HTMLElement): void;
  };
  manager.app = { vault: { getAbstractFileByPath: (path: string) => path === "Knowledge Base" ? new TFolder(path) : null } };
  manager.openedBaseId = "base-a";
  manager.openedDataEpoch = 1;
  manager.plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getDataEpoch: () => 1,
    getRecords: () => records,
    getIndexRecords: () => records,
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    openLegacyIndexReview: (sourceId: string) => { reviewed = sourceId; },
  };
  const dom = createFakeDom();
  const parent = asHtmlElement(dom.document.body.createDiv());
  manager.renderSourceSummary(parent);

  assert.match(parent.textContent, /Index membership is explicit/u);
  assert.match(parent.textContent, /Knowledge Base/u);
  assert.match(parent.textContent, /Inherited during upgrade/u);
  assert.match(parent.textContent, /Storage and creation folders \(location only\)/u);
  assert.match(parent.textContent, /do not add a note unless the same path is deliberately linked/u);
  const review = parent.querySelector("button");
  assert.ok(review);
  review.click();
  assert.equal(reviewed, "legacy-source");
});
