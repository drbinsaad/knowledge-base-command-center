import assert from "node:assert/strict";
import test from "node:test";
import { MembershipExplanationModal } from "../src/membership-explanation-modal";
import { cloneJsonValue, DEFAULT_DATA, type VaultRecord } from "../src/model";
import { asHtmlElement, createFakeDom } from "./support/fake-dom";

function record(path: string): VaultRecord {
  return {
    path, title: "README", kind: "topic", role: "canonical", curriculumId: "", domain: "ENT", topicKind: "condition",
    priority: "", reviewStatus: "", synthesisStatus: "", autoresearchStatus: "", safetyCritical: false,
    sourceCount: 0, aliases: [], relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "",
    sourceCoverage: "", folderOrder: "", mtime: 0, aiLock: false,
  };
}

test("Why this appears separates direct and linked authority from storage location", () => {
  const path = "Knowledge Base/ENT/README.md";
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.workspaceMode = "generic";
  data.directIndexPaths = [path];
  data.indexFolderSources = [{ id: "kb", path: "Knowledge Base", origin: "user" }];
  data.collections = [{ id: "collection", title: "Review later", collapsed: false, subjects: [path], subheadings: [] }];
  data.pinnedPaths = [path];
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  const title = root.createEl("h2");
  const content = root.createDiv();
  const modal = new MembershipExplanationModal({} as never, record(path), data);
  Object.assign(modal, {
    modalEl: asHtmlElement(root),
    titleEl: asHtmlElement(title),
    contentEl: asHtmlElement(content),
  });
  modal.onOpen();
  assert.match(content.textContent, /Added directly/u);
  assert.match(content.textContent, /Linked folder/u);
  assert.match(content.textContent, /Review later/u);
  assert.match(content.textContent, /Pinned/u);
  assert.match(content.textContent, /Storage location \(not membership\)/u);
  assert.equal(content.textContent.includes(path), true);
});

test("Why this appears reports no Index authority for a Library or collection-only record", () => {
  const path = "Reading/README.md";
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.workspaceMode = "generic";
  data.portableIndex.libraries = [{
    id: "reading",
    name: "Reading",
    singularName: "Reading item",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  data.collections = [{ id: "collection", title: "Review later", collapsed: false, subjects: [path], subheadings: [] }];
  const libraryRecord = { ...record(path), libraryId: "reading", portableIndexed: false };
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  const title = root.createEl("h2");
  const content = root.createDiv();
  const modal = new MembershipExplanationModal({} as never, libraryRecord, data);
  Object.assign(modal, {
    modalEl: asHtmlElement(root),
    titleEl: asHtmlElement(title),
    contentEl: asHtmlElement(content),
  });
  modal.onOpen();
  assert.match(content.textContent, /Library placement/u);
  assert.match(content.textContent, /Review later/u);
  assert.match(content.textContent, /No active Index authority/u);
});
