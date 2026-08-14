import assert from "node:assert/strict";
import test from "node:test";
import { cloneJsonValue, DEFAULT_DATA, ENT_CLINICAL_SETTINGS, type VaultRecord } from "../src/model";
import {
  LARGE_PLACEHOLDER_IMPORT_THRESHOLD,
  previewPortableImportOutcome,
} from "../src/portable-import-preview";
import {
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  type PortableExportSelection,
} from "../src/portability";

function record(path: string, title: string, curriculumId = ""): VaultRecord {
  return {
    path, title, kind: "topic", role: "canonical", curriculumId, domain: "General", topicKind: "condition",
    priority: "", reviewStatus: "", synthesisStatus: "", autoresearchStatus: "", safetyCritical: false,
    sourceCount: 0, aliases: [], relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "",
    sourceCoverage: "", folderOrder: "", mtime: 0, aiLock: false,
  };
}

function indexSelection(): PortableExportSelection {
  return { ...EMPTY_PORTABLE_SELECTION, index: true };
}

function largeClinicalWorkspaceAndIndex(): {
  value: ReturnType<typeof createPortableExport>;
  selection: PortableExportSelection;
  recordsWithIds: VaultRecord[];
  recordsWithoutIds: VaultRecord[];
} {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.settings = cloneJsonValue(ENT_CLINICAL_SETTINGS);
  source.portableIndex.groups = [{ id: "pediatric", title: "Pediatric", order: 0 }];
  source.portableIndex.subjects = Array.from({ length: LARGE_PLACEHOLDER_IMPORT_THRESHOLD }, (_, index) => ({
    id: `subject-${index}`,
    title: `Subject ${index}`,
    groupId: "pediatric",
    parentId: null,
    order: index,
    indexed: true,
    configuredId: `ENT-PED-${String(index).padStart(3, "0")}`,
    recordKind: "topic" as const,
    libraryId: null,
  }));
  source.directIndexPaths = source.portableIndex.subjects.map((subject) => `kbcc-placeholder:${subject.id}`);
  const selection = { ...EMPTY_PORTABLE_SELECTION, workspace: true, index: true };
  const value = createPortableExport(source, [], selection, "2026-08-14T00:00:00.000Z", "source-vault");
  const recordsWithIds = source.portableIndex.subjects.map((subject, index) => ({
    ...record(`03 Clinical Topics/01 Pediatric/Subject ${index}.md`, subject.title, subject.configuredId),
    domain: "Pediatric",
  }));
  return {
    value,
    selection,
    recordsWithIds,
    recordsWithoutIds: recordsWithIds.map((candidate) => ({ ...candidate, curriculumId: "" })),
  };
}

test("portable import preview simulates placeholders without mutating live data", () => {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.portableIndex.groups = [{ id: "group-airway", title: "Airway", order: 0 }];
  source.portableIndex.subjects = [{
    id: "subject-one", title: "Laryngomalacia", groupId: "group-airway", parentId: null, order: 0,
    indexed: true, configuredId: "ENT-PED-001", recordKind: "topic", libraryId: null,
  }];
  source.directIndexPaths = ["kbcc-placeholder:subject-one"];
  source.indexGroupByPath["kbcc-placeholder:subject-one"] = "Airway";
  const exported = createPortableExport(source, [], indexSelection(), "2026-08-14T00:00:00.000Z", "source-vault");

  const destination = cloneJsonValue(DEFAULT_DATA);
  const before = cloneJsonValue(destination);
  const preview = previewPortableImportOutcome(
    destination,
    [record("Notes/Laryngomalacia.md", "Laryngomalacia")],
    exported,
    indexSelection(),
    "merge",
  );
  assert.ok(preview);
  assert.equal(preview.importedAwaitingNotes, 1);
  assert.equal(preview.after.index, 1);
  assert.equal(preview.postImportCandidates, 1);
  assert.equal(preview.requiresLargeImportConfirmation, false);
  assert.deepEqual(destination, before);
});

test("portable import preview counts exact candidates outside the active KB record projection", () => {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.portableIndex.groups = [{ id: "docs", title: "Docs", order: 0 }];
  source.portableIndex.subjects = [{
    id: "readme", title: "README", groupId: "docs", parentId: null, order: 0,
    indexed: true, configuredId: "", recordKind: "topic", libraryId: null,
  }];
  source.directIndexPaths = ["kbcc-placeholder:readme"];
  const exported = createPortableExport(source, [], indexSelection(), "2026-08-14T00:00:00.000Z");
  const preview = previewPortableImportOutcome(
    cloneJsonValue(DEFAULT_DATA),
    [],
    exported,
    indexSelection(),
    "merge",
    [{ path: "Other/README.md", title: "README", curriculumId: "" }],
  );
  assert.equal(preview?.importedAwaitingNotes, 1);
  assert.equal(preview?.postImportCandidates, 1);
  assert.deepEqual(preview?.after.items[0]?.candidates.map((candidate) => candidate.path), ["Other/README.md"]);
});

test("portable import preview flags large placeholder outcomes and ignores private recovery", () => {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.portableIndex.groups = [{ id: "group", title: "Imported", order: 0 }];
  source.portableIndex.subjects = Array.from({ length: LARGE_PLACEHOLDER_IMPORT_THRESHOLD }, (_, index) => ({
    id: `subject-${index}`, title: `Subject ${index}`, groupId: "group", parentId: null, order: index,
    indexed: true, configuredId: "", recordKind: "topic" as const, libraryId: null,
  }));
  source.directIndexPaths = source.portableIndex.subjects.map((subject) => `kbcc-placeholder:${subject.id}`);
  const exported = createPortableExport(source, [], indexSelection(), "2026-08-14T00:00:00.000Z", "source-vault");
  const preview = previewPortableImportOutcome(cloneJsonValue(DEFAULT_DATA), [], exported, indexSelection(), "merge");
  assert.equal(preview?.importedAwaitingNotes, LARGE_PLACEHOLDER_IMPORT_THRESHOLD);
  assert.equal(preview?.requiresLargeImportConfirmation, true);
  assert.equal(previewPortableImportOutcome(
    cloneJsonValue(DEFAULT_DATA),
    [],
    exported,
    { ...EMPTY_PORTABLE_SELECTION, recovery: true },
    "replace",
  ), null);
});

test("Workspace plus Index fails closed when record projection could under- or over-estimate 100 placeholders", () => {
  const { value, selection, recordsWithIds, recordsWithoutIds } = largeClinicalWorkspaceAndIndex();
  const destination = cloneJsonValue(DEFAULT_DATA);
  destination.settings = cloneJsonValue(ENT_CLINICAL_SETTINGS);
  destination.settings.idProperty = "alternate_id";

  // These are the two divergent outcomes the old preview could report from
  // its stale pre-Workspace records. A 0 prediction would bypass the required
  // 100-placeholder confirmation even though the refreshed projection is 100.
  const predictedFromOldMatchingRecords = previewPortableImportOutcome(
    destination,
    recordsWithIds,
    value,
    indexSelection(),
    "merge",
  );
  const refreshedWithoutIds = previewPortableImportOutcome(
    destination,
    recordsWithoutIds,
    value,
    indexSelection(),
    "merge",
  );
  assert.equal(predictedFromOldMatchingRecords?.importedAwaitingNotes, 0);
  assert.equal(predictedFromOldMatchingRecords?.requiresLargeImportConfirmation, false);
  assert.equal(refreshedWithoutIds?.importedAwaitingNotes, LARGE_PLACEHOLDER_IMPORT_THRESHOLD);
  assert.equal(refreshedWithoutIds?.requiresLargeImportConfirmation, true);

  // Reversing the two projections is the corresponding over-estimation. The
  // combined operation is prohibited instead of trusting either stale count.
  assert.equal(previewPortableImportOutcome(
    destination,
    recordsWithoutIds,
    value,
    indexSelection(),
    "merge",
  )?.importedAwaitingNotes, LARGE_PLACEHOLDER_IMPORT_THRESHOLD);
  assert.equal(previewPortableImportOutcome(
    destination,
    recordsWithIds,
    value,
    indexSelection(),
    "merge",
  )?.importedAwaitingNotes, 0);
  assert.throws(() => previewPortableImportOutcome(
    destination,
    recordsWithIds,
    value,
    selection,
    "merge",
  ), /Import Workspace settings by themselves first.*reopen.*import the Index/iu);
});

test("combined Workspace and Index remains previewable when effective record projection is unchanged", () => {
  const { value, selection, recordsWithIds } = largeClinicalWorkspaceAndIndex();
  const destination = cloneJsonValue(DEFAULT_DATA);
  destination.settings = cloneJsonValue(ENT_CLINICAL_SETTINGS);
  destination.settings.workspaceName = "My destination name";
  const preview = previewPortableImportOutcome(destination, recordsWithIds, value, selection, "merge");
  assert.ok(preview);
  assert.equal(preview.importedAwaitingNotes, 0);
});
