import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEligiblePlaceholderMatchNotes,
  buildPlaceholderResolutionQueue,
  explainIndexMembership,
  linkedSourceLabel,
  MAX_PLACEHOLDER_MATCH_CANDIDATES,
} from "../src/membership-explanation";
import {
  DEFAULT_DATA,
  INDEX_FOLDER_VAULT_ROOT,
  cloneJsonValue,
  portablePlaceholderPath,
  type VaultRecord,
} from "../src/model";

test("unindexed eligible Markdown notes participate in exact placeholder matching", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.portableIndex.groups = [{ id: "group", title: "Imported", order: 0 }];
  data.portableIndex.subjects = [{
    id: "readme", title: "README", groupId: "group", parentId: null, order: 0,
    indexed: true, configuredId: "", recordKind: "topic", libraryId: null,
  }];
  const notes = buildEligiblePlaceholderMatchNotes(
    [{ path: "Other/README.md", basename: "README" }],
    [],
    data.settings,
    () => undefined,
  );
  const queue = buildPlaceholderResolutionQueue(data, notes);
  assert.equal(queue.withCandidates, 1);
  assert.deepEqual(queue.items[0]?.candidates.map((candidate) => candidate.path), ["Other/README.md"]);
});

test("a stale resolved-path mapping stays queued when the record projection says its note is missing", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.portableIndex.groups = [{ id: "docs", title: "Docs", order: 0 }];
  data.portableIndex.subjects = [{
    id: "readme", title: "README", groupId: "docs", parentId: null, order: 0,
    indexed: true, configuredId: "", recordKind: "topic", libraryId: null,
  }];
  data.portableIndex.resolvedPathBySubjectId.readme = "Deleted/README.md";
  const projectedPlaceholder = {
    ...record("Deleted/README.md", "README"),
    portableId: "readme",
    isPlaceholder: true,
  };
  const queue = buildPlaceholderResolutionQueue(
    data,
    [{ path: "Other/README.md", title: "README", curriculumId: "" }],
    [projectedPlaceholder],
  );
  assert.equal(queue.total, 1);
  assert.equal(queue.items[0]?.path, "Deleted/README.md");
  assert.deepEqual(queue.items[0]?.candidates.map((candidate) => candidate.path), ["Other/README.md"]);
});

function record(path: string, title = path.split("/").pop()?.replace(/\.md$/u, "") ?? path): VaultRecord {
  return {
    path, title, kind: "topic", role: "canonical", curriculumId: "", domain: "General", topicKind: "condition",
    priority: "", reviewStatus: "", synthesisStatus: "", autoresearchStatus: "", safetyCritical: false,
    sourceCount: 0, aliases: [], relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "",
    sourceCoverage: "", folderOrder: "", mtime: 0, aiLock: false,
  };
}

test("membership explanation reports every Generic authority without treating storage as membership", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.workspaceMode = "generic";
  data.directIndexPaths = ["Notes/Direct and linked.md"];
  data.indexFolderSources = [{ id: "source", path: "Notes", origin: "user" }];
  const explanation = explainIndexMembership(record("Notes/Direct and linked.md"), data);
  assert.equal(explanation.direct, true);
  assert.deepEqual(explanation.linkedSources, data.indexFolderSources);
  assert.equal(explanation.protectedSource, false);
  assert.equal(explanation.storagePath, "Notes/Direct and linked.md");

  const locationOnly = explainIndexMembership(record("Storage/Only.md"), data);
  assert.equal(locationOnly.direct, false);
  assert.deepEqual(locationOnly.linkedSources, []);
  assert.equal(locationOnly.storagePath, "Storage/Only.md");
});

test("clinical records ignore stale linked sources and expose protected source", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.workspaceMode = "ent-clinical";
  data.indexFolderSources = [{ id: "stale", path: INDEX_FOLDER_VAULT_ROOT, origin: "user" }];
  const explanation = explainIndexMembership(record("Clinical/Topic.md"), data);
  assert.deepEqual(explanation.linkedSources, []);
  assert.equal(explanation.protectedSource, true);
  assert.equal(linkedSourceLabel(data.indexFolderSources[0]), "Vault root");
});

test("a clinical proposal linked to an imported subject is not mislabeled as a protected source", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.workspaceMode = "ent-clinical";
  const path = "01 Inbox/Topic Proposals/Imported.md";
  data.directIndexPaths = [path];
  const importedProposal = {
    ...record(path, "Imported proposal"),
    role: "proposal" as const,
    portableId: "imported-proposal",
    portableIndexed: true,
  };
  const explanation = explainIndexMembership(importedProposal, data);
  assert.equal(explanation.direct, true);
  assert.equal(explanation.protectedSource, false);
});

test("imported placeholders expose no false storage path", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  const path = portablePlaceholderPath("subject-one");
  data.directIndexPaths = [path];
  const placeholder = { ...record(path, "Subject one"), role: "placeholder" as const, isPlaceholder: true, portableId: "subject-one", portableIndexed: true };
  const explanation = explainIndexMembership(placeholder, data);
  assert.equal(explanation.direct, true);
  assert.equal(explanation.importedPlaceholder, true);
  assert.equal(explanation.storagePath, null);
  assert.deepEqual(explanation.linkedSources, []);
});

test("placeholder queue reuses exact title and configured-ID candidates without auto-selecting", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.indexLabel = "Knowledge Index";
  data.portableIndex.groups = [{ id: "airway", title: "Airway", order: 0 }];
  data.portableIndex.libraries = [{
    id: "reading", name: "Reading", singularName: "Reading item", icon: "book-open", order: 0,
    sourceKind: null, archivedAt: null,
  }];
  data.portableIndex.subjects = [
    { id: "index-subject", title: "Laryngomalacia", groupId: "airway", parentId: null, order: 0, indexed: true, configuredId: "ENT-PED-001", recordKind: "topic", libraryId: null },
    { id: "library-subject", title: "Different title", groupId: "airway", parentId: null, order: 1, indexed: false, configuredId: "ENT-PED-002", recordKind: "topic", libraryId: "reading" },
    { id: "unplaced-subject", title: "Unplaced", groupId: "", parentId: null, order: 2, indexed: false, configuredId: "", recordKind: "topic", libraryId: null },
    { id: "resolved", title: "Resolved", groupId: "airway", parentId: null, order: 3, indexed: true, configuredId: "", recordKind: "topic", libraryId: null },
  ];
  data.portableIndex.resolvedPathBySubjectId = { resolved: "Notes/Resolved.md", owner: "Notes/Laryngomalacia.md" };
  const byTitle = { ...record("Notes/Laryngomalacia.md", "Laryngomalacia"), curriculumId: "OTHER" };
  const byId = { ...record("Notes/Second.md", "Local second"), curriculumId: "ENT-PED-002" };
  const queue = buildPlaceholderResolutionQueue(data, [byTitle, byId, record("Notes/Resolved.md")]);
  assert.equal(queue.total, 3);
  assert.equal(queue.index, 1);
  assert.equal(queue.libraries, 1);
  assert.equal(queue.unplaced, 1);
  assert.equal(queue.withCandidates, 2);
  assert.equal(queue.items[0]?.subjectId, "index-subject");
  assert.deepEqual(queue.items[0]?.candidates.map((candidate) => ({
    path: candidate.path,
    title: candidate.matchedByTitle,
    id: candidate.matchedByConfiguredId,
    owners: candidate.existingPortableSubjectIds,
  })), [{ path: "Notes/Laryngomalacia.md", title: true, id: false, owners: ["owner"] }]);
  assert.equal(queue.items[1]?.placement.kind, "library");
  assert.equal(queue.items[1]?.candidates[0]?.matchedByConfiguredId, true);
  assert.equal(queue.items[2]?.placement.kind, "unplaced");
});

test("placeholder candidate samples stay bounded and deterministic for duplicate-heavy vaults", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.portableIndex.groups = [{ id: "group", title: "Imported", order: 0 }];
  data.portableIndex.subjects = [{
    id: "duplicate-title",
    title: "Same title",
    groupId: "group",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
    libraryId: null,
  }];
  const records = Array.from({ length: MAX_PLACEHOLDER_MATCH_CANDIDATES * 4 }, (_, index) => (
    record(`Notes/${String(MAX_PLACEHOLDER_MATCH_CANDIDATES * 4 - index).padStart(3, "0")}.md`, "Same title")
  ));
  const queue = buildPlaceholderResolutionQueue(data, records);
  const candidates = queue.items[0]?.candidates ?? [];
  assert.equal(queue.withCandidates, 1);
  assert.equal(candidates.length, MAX_PLACEHOLDER_MATCH_CANDIDATES);
  assert.deepEqual(
    candidates.map((candidate) => candidate.path),
    Array.from({ length: MAX_PLACEHOLDER_MATCH_CANDIDATES }, (_, index) => `Notes/${String(index + 1).padStart(3, "0")}.md`),
  );
});
