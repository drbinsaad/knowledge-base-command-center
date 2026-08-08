import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTemplateTokens,
  applyCanonicalFrontmatter,
  asUnknownRecord,
  buildCurriculumTree,
  buildIndexDiagnostics,
  buildCanonicalMarkdown,
  buildProposalMarkdown,
  canonicalIdIsValid,
  canonicalHierarchyIssue,
  canonicalPath,
  canonicalPathInputsUnchanged,
  cloneCollections,
  configuredGroupFromPath,
  createDefaultStore,
  createKnowledgeBaseEntry,
  createPersonalBackup,
  createWorkspaceConfig,
  curriculumContainerKey,
  expectedParentCurriculumId,
  genericNotePath,
  groupRecordsByGroup,
  isPortablePlaceholderPath,
  isExtensionCurriculumId,
  isRecognizedPluginData,
  isSafeObjectKey,
  limitSnapshotStack,
  matchesQuery,
  matchesParsedQuery,
  MAX_CURRICULUM_DEPTH,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_TRANSFER_LIST_ITEMS,
  MAX_TRANSFER_SNAPSHOTS,
  MAX_TRANSFER_TOTAL_REFERENCES,
  MAX_UNDO_BYTES,
  metadataHasGap,
  migrateData,
  migrateStore,
  moveCurriculumVisual,
  curriculumChildPaths,
  curriculumDescendantPaths,
  curriculumSiblingPaths,
  parseQuery,
  parsePersonalBackup,
  parseWorkspaceConfig,
  pathIsInsideFolder,
  portablePlaceholderPath,
  provisionalMigratedVaultFingerprint,
  resolveExpectedParentPath,
  replaceCurriculumVisualPath,
  replacePathMapKey,
  reconcileCurriculumVisual,
  rewritePluginDataPathPrefix,
  rewritePluginDataFolderRename,
  rewritePluginDataTemplatePathRename,
  resetCurriculumVisualPath,
  restoreSnapshot,
  rewriteTopLevelHeading,
  shouldHandleRowShortcut,
  snapshotStackDepthIsTruncated,
  sanitizeFileName,
  snapshotPersonal,
  STORE_KIND,
  STORE_VERSION,
  storedDataVersion,
  unknownQueryTokens,
  validateWritableFolderPath,
  validateProposalFolderPath,
  validateTemplateFilePath,
  visualPlacementPathSet,
  type VaultRecord,
} from "../src/model.ts";
import {
  applyPortableExport,
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  parseAnyCommandCenterExport,
  parsePortableExport,
  PORTABLE_EXPORT_KIND,
  registerPortableGroup,
  removePortableGroup,
  renameOrMergePortableGroup,
  selectionAvailableForExport,
  serializePortableExport,
  summarizePortableExport,
  synchronizePortableRegistry,
  type PortableExportSelection,
  type PortableExportV1,
} from "../src/portability.ts";

function record(overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    path: "03 Clinical Topics/01 Pediatric/ENT-PED-003.05 - Laryngeal Cleft.md",
    title: "Laryngeal Cleft",
    kind: "topic",
    role: "canonical",
    curriculumId: "ENT-PED-003.05",
    domain: "Pediatric",
    topicKind: "Disease",
    priority: "P1",
    reviewStatus: "unverified",
    synthesisStatus: "ai_drafted",
    autoresearchStatus: "none",
    safetyCritical: true,
    sourceCount: 8,
    aliases: ["laryngotracheoesophageal cleft"],
    relatedTopics: [],
    parentTopic: "",
    imageStatus: "",
    doseStatus: "",
    sourceCoverage: "",
    folderOrder: "01 Pediatric",
    mtime: 1,
    aiLock: false,
    ...overrides,
  };
}

function portableSelection(overrides: Partial<PortableExportSelection>): PortableExportSelection {
  return { ...EMPTY_PORTABLE_SELECTION, ...overrides };
}

function portableFixture(): PortableExportV1 {
  return {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "Source KB",
    components: {
      index: {
        version: 1,
        groups: [{ id: "group-airway", title: "Airway", order: 0 }],
        subjects: [{
          id: "subject-cleft",
          title: "Laryngeal Cleft",
          groupId: "group-airway",
          parentId: null,
          order: 0,
          indexed: true,
          configuredId: "ENT-PED-003.05",
          recordKind: "topic",
        }],
      },
    },
  };
}

test("unknown metadata is narrowed to a mutable record at one boundary", () => {
  const metadata: Record<string, unknown> = { title: "Laryngeal Cleft" };
  assert.equal(asUnknownRecord(metadata), metadata);
  assert.deepEqual(asUnknownRecord(null), {});
  assert.deepEqual(asUnknownRecord(["not", "frontmatter"]), {});
});

test("migrates only custom v1 headings and keeps a recovery backup", () => {
  const data = migrateData({
    version: 1,
    selectedPath: "topic.md",
    headings: [
      { id: "auto-domain-pediatric", title: "Pediatric", kind: "automatic", subjects: ["a.md"], subheadings: [] },
      { id: "my-airway", title: "My Airway", kind: "custom", subjects: ["topic.md"], subheadings: [] },
    ],
  });
  assert.equal(data.version, 10);
  assert.deepEqual(data.collections.map((item) => item.title), ["My Airway"]);
  assert.equal(data.migrationBackup?.headings.length, 2);
  assert.equal(data.selectedPath, "topic.md");
  assert.deepEqual(data.layoutSnapshots, []);
});

test("flat v10 data wraps into one v11 base without losing workspace state", () => {
  const flat = migrateData(null);
  flat.settings.workspaceName = "Surgical Knowledge";
  flat.collections = [{
    id: "collection-airway",
    title: "Airway",
    collapsed: true,
    subjects: ["Knowledge/Airway.md"],
    subheadings: [{ id: "sub-pediatric", title: "Pediatric", collapsed: false, subjects: ["Knowledge/Cleft.md"] }],
  }];
  flat.pinnedPaths = ["Knowledge/Airway.md"];
  flat.nextStudyPaths = ["Knowledge/Cleft.md"];
  flat.savedViews = [{ id: "view-airway", name: "Airway review", tab: "curriculum", query: "group:airway" }];
  flat.curriculumVisual = {
    parentByPath: { "Knowledge/Cleft.md": "Knowledge/Airway.md" },
    orderByContainer: { "parent:Knowledge/Airway.md": ["Knowledge/Cleft.md"] },
  };
  flat.manualIndexPaths = ["Knowledge/Airway.md"];
  flat.excludedIndexPaths = ["Knowledge/Hidden.md"];
  flat.indexGroupByPath = { "Knowledge/Airway.md": "Airway" };
  flat.displayNameByPath = { "Knowledge/Airway.md": "Upper Airway" };
  flat.indexGroupAliases = { airway: "Airway" };
  flat.indexGroupOrder = ["Airway"];
  flat.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: "subject-cleft",
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: { "subject-cleft": "Knowledge/Cleft.md" },
  };
  flat.selectedPath = "Knowledge/Cleft.md";
  flat.activeTab = "collections";
  flat.collapsed.curriculumDomains = ["Airway"];
  flat.layoutSnapshots = [snapshotPersonal(flat, "Before migration", false, true)];
  flat.undoStack = [snapshotPersonal(flat, "Undo migration", true, true)];
  flat.redoStack = [snapshotPersonal(flat, "Redo migration", false, true)];

  const before = structuredClone(flat);
  const store = migrateStore(flat, 1_800_000_000_000);

  assert.equal(store.kind, STORE_KIND);
  assert.equal(store.version, STORE_VERSION);
  assert.equal(store.activeBaseId, "base-default");
  assert.equal(store.bases.length, 1);
  assert.equal(store.bases[0]?.id, "base-default");
  assert.equal(store.bases[0]?.archivedAt, null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(store.bases[0]?.data)) as unknown,
    JSON.parse(JSON.stringify(before)) as unknown,
    "the persisted v10 JSON payload must be preserved exactly",
  );
  assert.deepEqual(flat, before, "wrapping must not mutate the source v10 object");
});

test("legacy migration creates distinct random provisional IDs with the same content fingerprint", () => {
  const flat = migrateData(null);
  flat.settings.workspaceName = "ENT";
  flat.pinnedPaths = ["03 Clinical Topics/Airway.md"];

  const firstDevice = migrateStore(structuredClone(flat), 100);
  const secondDevice = migrateStore(structuredClone(flat), 999);
  const otherPayload = structuredClone(flat);
  otherPayload.settings.workspaceName = "Research";
  const otherVault = migrateStore(otherPayload, 100);

  assert.notEqual(firstDevice.vaultId, secondDevice.vaultId);
  assert.equal(
    provisionalMigratedVaultFingerprint(firstDevice.vaultId),
    provisionalMigratedVaultFingerprint(secondDevice.vaultId),
  );
  assert.notEqual(
    provisionalMigratedVaultFingerprint(firstDevice.vaultId),
    provisionalMigratedVaultFingerprint(otherVault.vaultId),
  );
});

test("a valid v11 store migrates multiple bases as isolated workspace payloads", () => {
  const sharedPath = "Knowledge/Shared.md";
  const sharedPortable = {
    version: 1 as const,
    groups: [{ id: "group-shared", title: "Shared", order: 0 }],
    subjects: [{
      id: "subject-shared",
      title: "Shared subject",
      groupId: "group-shared",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic" as const,
    }],
    resolvedPathBySubjectId: { "subject-shared": sharedPath },
  };
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  first.pinnedPaths = [sharedPath];
  first.portableIndex = structuredClone(sharedPortable);
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  second.nextStudyPaths = [sharedPath];
  second.portableIndex = structuredClone(sharedPortable);
  const raw = {
    kind: STORE_KIND,
    version: STORE_VERSION,
    activeBaseId: "base-second",
    bases: [
      createKnowledgeBaseEntry(first, "base-first", 100),
      createKnowledgeBaseEntry(second, "base-second", 200),
    ],
  };

  const migrated = migrateStore(raw, 300);
  assert.equal(migrated.activeBaseId, "base-second");
  assert.deepEqual(migrated.bases.map((entry) => entry.data.settings.workspaceName), ["First KB", "Second KB"]);
  assert.deepEqual(migrated.bases[0]?.data.pinnedPaths, [sharedPath]);
  assert.deepEqual(migrated.bases[1]?.data.nextStudyPaths, [sharedPath]);
  assert.deepEqual(migrated.deletedBaseIds, {}, "older v11 envelopes gain an empty deletion-tombstone map");

  migrated.bases[0].data.pinnedPaths.push("Knowledge/First only.md");
  migrated.bases[0].data.portableIndex.subjects[0].title = "Changed only in first";
  assert.deepEqual(migrated.bases[1]?.data.pinnedPaths, []);
  assert.equal(migrated.bases[1]?.data.portableIndex.subjects[0]?.title, "Shared subject");
  assert.equal(raw.bases[0]?.data.portableIndex.subjects[0]?.title, "Shared subject", "migration must isolate output from the parsed input");
});

test("v11 store parsing rejects duplicate IDs and invalid active-base invariants", () => {
  const valid = createDefaultStore(migrateData(null), 100);
  const duplicate = structuredClone(valid);
  duplicate.bases.push({ ...structuredClone(duplicate.bases[0]), createdAt: 200, updatedAt: 200 });
  assert.throws(() => migrateStore(duplicate, 300), /duplicate knowledge-base ID/i);

  const missingActive = structuredClone(valid);
  missingActive.activeBaseId = "base-missing";
  assert.throws(() => migrateStore(missingActive, 300), /active knowledge base is missing/i);

  const archivedActive = structuredClone(valid);
  archivedActive.bases[0].archivedAt = 250;
  assert.throws(() => migrateStore(archivedActive, 300), /at least one knowledge base must remain available|active knowledge base is missing or archived/i);

  const malformed = structuredClone(valid);
  malformed.bases[0].id = "__proto__";
  malformed.activeBaseId = "__proto__";
  assert.throws(() => migrateStore(malformed, 300), /invalid stable ID/i);
});

test("v11 store parsing validates and bounds permanent-deletion tombstones", () => {
  const valid = createDefaultStore(migrateData(null), 100);
  const malformedMap = structuredClone(valid) as unknown as Record<string, unknown>;
  malformedMap.deletedBaseIds = [];
  assert.throws(() => migrateStore(malformedMap, 300), /timestamp map/i);

  const overlapping = structuredClone(valid);
  overlapping.deletedBaseIds[overlapping.bases[0].id] = 200;
  assert.throws(() => migrateStore(overlapping, 300), /still present in the base list/i);

  const unsafe = structuredClone(valid) as unknown as { deletedBaseIds: Record<string, number> };
  unsafe.deletedBaseIds = JSON.parse('{"__proto__":200}') as Record<string, number>;
  assert.throws(() => migrateStore(unsafe, 300), /invalid stable ID/i);

  const oversized = structuredClone(valid);
  oversized.deletedBaseIds = Object.fromEntries(Array.from(
    { length: MAX_DELETED_KNOWLEDGE_BASE_IDS + 1 },
    (_, index) => [`base-deleted-${index}`, index + 1],
  ));
  assert.throws(() => migrateStore(oversized, 300), /permanent-deletion tombstones/i);
});

test("collection cloning preserves multi-membership while isolating mutations", () => {
  const source = [{ id: "a", title: "A", collapsed: false, subjects: ["topic.md"], subheadings: [{ id: "s", title: "S", collapsed: false, subjects: ["topic.md"] }] }];
  const clone = cloneCollections(source);
  clone[0]?.subjects.push("other.md");
  assert.deepEqual(source[0]?.subjects, ["topic.md"]);
  assert.deepEqual(clone[0]?.subheadings[0]?.subjects, ["topic.md"]);
});

test("structured tokens and fuzzy text can be combined", () => {
  const cleft = record();
  assert.equal(matchesQuery(cleft, "lary clef domain:pediatric priority:P1 source:traced safety:true"), true);
  assert.equal(matchesQuery(cleft, "domain:otology"), false);
  assert.equal(matchesQuery(cleft, "source:gap"), false);
});

test("recursive curriculum tree nests canonical children and supporting notes", () => {
  const family = record({ path: "03 Clinical Topics/01 Pediatric/ENT-PED-003 - Congenital Laryngeal Anomalies.md", title: "Congenital Laryngeal Anomalies", curriculumId: "ENT-PED-003" });
  const cleft = record();
  const supporting = record({ path: "03 Clinical Topics/01 Pediatric/Laryngeal Cleft - Feeding.md", title: "Laryngeal Cleft - Feeding", curriculumId: "", role: "supporting", parentTopic: "[[ENT-PED-003.05 - Laryngeal Cleft|Laryngeal Cleft]]" });
  const tree = buildCurriculumTree([family, cleft, supporting], { parentByPath: {}, orderByContainer: {} });
  assert.equal(tree.domains[0]?.roots[0]?.record.path, family.path);
  assert.equal(tree.domains[0]?.roots[0]?.children[0]?.record.path, cleft.path);
  assert.equal(tree.domains[0]?.roots[0]?.children[0]?.children[0]?.record.path, supporting.path);
});

test("indexed parent lookup cannot collide across spaced domain names and remains first-wins", () => {
  const headAndNeck = record({ path: "KB/head-and-neck-x.md", title: "x", domain: "Head and Neck", curriculumId: "", role: "supporting" });
  const misleadingHead = record({ path: "KB/head-and-neck-x-collision.md", title: "and Neck x", domain: "Head", curriculumId: "", role: "supporting" });
  const duplicateAlias = record({ path: "KB/duplicate-alias.md", title: "Second", aliases: ["shared"], domain: "Head and Neck", curriculumId: "", role: "supporting" });
  const firstAlias = record({ path: "KB/first-alias.md", title: "First", aliases: ["shared"], domain: "Head and Neck", curriculumId: "", role: "supporting" });
  const childByTitle = record({ path: "KB/child-title.md", title: "Child title", domain: "Head and Neck", curriculumId: "", role: "supporting", parentTopic: "[[x]]" });
  const childByAlias = record({ path: "KB/child-alias.md", title: "Child alias", domain: "Head and Neck", curriculumId: "", role: "supporting", parentTopic: "[[shared]]" });
  const tree = buildCurriculumTree(
    [headAndNeck, misleadingHead, firstAlias, duplicateAlias, childByTitle, childByAlias],
    { parentByPath: {}, orderByContainer: {} },
  );

  assert.equal(tree.parentByPath.get(childByTitle.path), headAndNeck.path);
  assert.equal(tree.parentByPath.get(childByAlias.path), firstAlias.path);
});

test("visual curriculum moves reorder and reparent without mutating records", () => {
  const family = record({ path: "family.md", title: "Family", curriculumId: "ENT-PED-003" });
  const cleft = record({ path: "cleft.md" });
  const airway = record({ path: "airway.md", title: "Airway", curriculumId: "ENT-PED-001" });
  const state = { parentByPath: {}, orderByContainer: {} };
  moveCurriculumVisual(state, cleft, airway.path, [], 0);
  moveCurriculumVisual(state, family, null, [airway.path], 0);
  const tree = buildCurriculumTree([family, cleft, airway], state);
  assert.deepEqual(tree.domains[0]?.roots.map((node) => node.record.path), [family.path, airway.path]);
  assert.equal(tree.parentByPath.get(cleft.path), airway.path);
  assert.equal(cleft.parentTopic, "");
});

test("curriculum tree safely breaks visual cycles", () => {
  const a = record({ path: "a.md", title: "A", curriculumId: "ENT-PED-001" });
  const b = record({ path: "b.md", title: "B", curriculumId: "ENT-PED-002" });
  const tree = buildCurriculumTree([a, b], { parentByPath: { [a.path]: b.path, [b.path]: a.path }, orderByContainer: {} });
  assert.equal(tree.domains[0]?.roots.length, 1);
  assert.equal([...tree.parentByPath.values()].filter((path) => path === null).length, 1);
});

test("an unresolved portable subject removed from the index stays out of the curriculum", () => {
  const indexed = record({
    path: portablePlaceholderPath("subject-indexed"),
    title: "Indexed placeholder",
    role: "placeholder",
    isPlaceholder: true,
    portableIndexed: true,
  });
  const collectionOnly = record({
    path: portablePlaceholderPath("subject-collection-only"),
    title: "Collection-only placeholder",
    role: "placeholder",
    isPlaceholder: true,
    portableIndexed: false,
  });
  const tree = buildCurriculumTree([indexed, collectionOnly], { parentByPath: {}, orderByContainer: {} });
  assert.equal(tree.nodeByPath.has(indexed.path), true);
  assert.equal(tree.nodeByPath.has(collectionOnly.path), false);
});

test("gap rules are specific to each knowledge kind", () => {
  assert.equal(metadataHasGap(record()), false);
  assert.equal(metadataHasGap(record({ sourceCount: 0 })), true);
  assert.equal(metadataHasGap(record({ kind: "medication", doseStatus: "absent", sourceCoverage: "none" })), true);
  assert.equal(metadataHasGap(record({ kind: "medication", role: "library", doseStatus: "source_traced", sourceCoverage: "complete" })), true);
  assert.equal(metadataHasGap(record({ kind: "medication", role: "library", doseStatus: "reviewed", sourceCoverage: "complete" })), false);
  assert.equal(metadataHasGap(record({ kind: "syndrome", imageStatus: "absent" })), true);
  assert.equal(metadataHasGap(record({ kind: "proposal", role: "proposal", sourceCount: 0, priority: "" })), false);
});

test("personal organization snapshots restore collections, pins, queues, and saved views", () => {
  const data = migrateData(null);
  data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [record().path], subheadings: [] }];
  data.pinnedPaths = [record().path];
  data.nextStudyPaths = [record().path];
  data.savedViews = [{ id: "p1", name: "P1", tab: "curriculum", query: "priority:P1" }];
  data.curriculumVisual.parentByPath[record().path] = null;
  data.manualIndexPaths = ["Outside/Topic.md"];
  data.excludedIndexPaths = ["Knowledge Base/Hidden.md"];
  data.indexGroupByPath["Outside/Topic.md"] = "Airway";
  data.indexGroupOrder = ["Airway", "Research"];
  const snapshot = snapshotPersonal(data, "Exam block");
  data.collections = [];
  data.pinnedPaths = [];
  restoreSnapshot(data, snapshot);
  assert.equal(data.collections[0]?.title, "Airway");
  assert.deepEqual(data.pinnedPaths, [record().path]);
  assert.deepEqual(data.nextStudyPaths, [record().path]);
  assert.equal(data.savedViews[0]?.query, "priority:P1");
  assert.equal(Object.prototype.hasOwnProperty.call(data.curriculumVisual.parentByPath, record().path), true);
  assert.deepEqual(data.manualIndexPaths, ["Outside/Topic.md"]);
  assert.deepEqual(data.excludedIndexPaths, ["Knowledge Base/Hidden.md"]);
  assert.equal(data.indexGroupByPath["Outside/Topic.md"], "Airway");
  assert.deepEqual(data.indexGroupOrder, ["Airway", "Research"]);
});

test("v2 data migrates to v10 with the ENT clinical preset and safe settings", () => {
  const data = migrateData({
    version: 2,
    collections: [], pinnedPaths: [], nextStudyPaths: [], savedViews: [],
    settings: { defaultTab: "collections", recentLimit: 25, enableHoverPreview: true, showSafetyBadges: true },
  });
  assert.equal(data.version, 10);
  assert.equal(data.settings.workspaceMode, "ent-clinical");
  assert.equal(data.settings.setupComplete, true);
  assert.equal(data.settings.proposalFolder, "01 Inbox/ENT Topic Proposals");
  assert.equal(data.settings.enableAdvancedCanonicalActions, false);
  assert.equal(data.settings.openNoteBehavior, "new-tab");
  assert.equal(data.settings.allowClinicalVisualGroupMoves, false);
  assert.equal(data.v2MigrationBackup?.version, 2);
});

test("future plugin data is interpreted as the latest compatible shape, never as v1", () => {
  const data = migrateData({
    version: 99,
    collections: [{ id: "future", title: "Future collection", collapsed: false, subjects: ["topic.md"], subheadings: [] }],
    pinnedPaths: ["topic.md"],
    settings: { defaultTab: "collections", openNoteBehavior: "split" },
  });
  assert.equal(storedDataVersion({ version: 99 }), 99);
  assert.equal(data.version, 10);
  assert.equal(data.collections[0]?.title, "Future collection");
  assert.equal(data.settings.openNoteBehavior, "split");
  assert.equal(data.migrationBackup, undefined);
});

test("v4 data gains an empty visual curriculum overlay", () => {
  const data = migrateData({ version: 4, collections: [], settings: {} });
  assert.equal(data.version, 10);
  assert.equal(data.settings.workspaceMode, "ent-clinical");
  assert.deepEqual(data.curriculumVisual, { parentByPath: {}, orderByContainer: {} });
});

test("fresh installs start as a configurable generic knowledge base", () => {
  const data = migrateData(null);
  assert.equal(data.version, 10);
  assert.equal(data.settings.workspaceMode, "generic");
  assert.equal(data.settings.setupComplete, false);
  assert.equal(data.settings.workspaceName, "Knowledge Base Command Center");
  assert.equal(data.settings.primaryFolder, "Knowledge Base");
  assert.equal(data.settings.proposalFolder, "Inbox");
  assert.deepEqual(data.manualIndexPaths, []);
  assert.deepEqual(data.excludedIndexPaths, []);
  assert.deepEqual(data.indexGroupByPath, {});
  assert.deepEqual(data.indexGroupOrder, []);
});

test("v7 generic organization migrates with manual index controls intact", () => {
  const data = migrateData({
    version: 7,
    manualIndexPaths: ["Research/Outside.md"],
    excludedIndexPaths: ["Knowledge Base/Hidden.md"],
    indexGroupByPath: { "Research/Outside.md": "Research" },
    indexGroupOrder: ["Research", "Projects"],
    settings: { workspaceMode: "generic", setupComplete: true, workspaceName: "My KB" },
  });
  assert.equal(data.version, 10);
  assert.equal(data.settings.workspaceMode, "generic");
  assert.equal(data.settings.workspaceName, "My KB");
  assert.deepEqual(data.manualIndexPaths, ["Research/Outside.md"]);
  assert.deepEqual(data.excludedIndexPaths, ["Knowledge Base/Hidden.md"]);
  assert.equal(data.indexGroupByPath["Research/Outside.md"], "Research");
  assert.deepEqual(data.indexGroupOrder, ["Research", "Projects"]);
});

test("v5 user organization migrates intact into the ENT clinical preset", () => {
  const data = migrateData({
    version: 5,
    collections: [{ id: "ali", title: "Ali", collapsed: false, subjects: ["topic.md"], subheadings: [] }],
    pinnedPaths: ["topic.md"],
    nextStudyPaths: ["topic.md"],
    activeTab: "syndromes",
    settings: { proposalFolder: "01 Inbox/ENT Topic Proposals", openNoteBehavior: "split" },
  });
  assert.equal(data.settings.workspaceMode, "ent-clinical");
  assert.equal(data.settings.workspaceName, "ENT Vault Command Center");
  assert.equal(data.settings.primaryFolder, "03 Clinical Topics");
  assert.deepEqual(data.collections[0]?.subjects, ["topic.md"]);
  assert.deepEqual(data.pinnedPaths, ["topic.md"]);
  assert.equal(data.settings.openNoteBehavior, "split");
});

test("generic note paths, folder grouping, and template tokens are deterministic", () => {
  assert.equal(genericNotePath("Projects/Active", "VPI: review / plan"), "Projects/Active/VPI- review - plan.md");
  assert.equal(configuredGroupFromPath("Knowledge Base/Research/Paper.md", "Knowledge Base"), "Research");
  assert.equal(configuredGroupFromPath("Knowledge Base/Paper.md", "Knowledge Base"), "Ungrouped");
  assert.equal(pathIsInsideFolder("Knowledge Base/Research/Paper.md", "Knowledge Base"), true);
  assert.equal(pathIsInsideFolder("Archive/Paper.md", "Knowledge Base"), false);
  assert.equal(
    applyTemplateTokens("# {{title}}\nCreated {{date}} at {{time}}\n{{custom}}", "My Note", "2026-08-07", "09:30"),
    "# My Note\nCreated 2026-08-07 at 09:30\n{{custom}}",
  );
});

test("writable folder validation protects the Obsidian configuration area", () => {
  assert.equal(validateWritableFolderPath("Knowledge Base", ".obsidian"), null);
  assert.match(validateWritableFolderPath(".obsidian/plugins", ".obsidian") ?? "", /cannot be inside/);
  assert.match(validateWritableFolderPath("Projects/../Archive", ".obsidian") ?? "", /cannot contain/);
});

test("canonical identifiers and paths are domain-safe", () => {
  assert.equal(canonicalIdIsValid("ENT-LAR-010.01", "Laryngology"), true);
  assert.equal(canonicalIdIsValid("ENT-PED-010", "Laryngology"), false);
  assert.equal(canonicalIdIsValid("ENT-LAR-EXT-001", "Laryngology"), true);
  assert.equal(canonicalPath({ title: "VPI: assessment / surgery", domain: "Laryngology", curriculumId: "ENT-LAR-010" }), "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - VPI- assessment - surgery.md");
});

test("child curriculum IDs require the exact same-domain root parent", () => {
  const parent = record({
    path: "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Parent.md",
    title: "Parent",
    domain: "Laryngology",
    curriculumId: "ENT-LAR-010",
    folderOrder: "03 Laryngology",
  });
  const value = {
    title: "Child", domain: "Laryngology", curriculumId: "ENT-LAR-010.01", parentPath: parent.path,
    topicKind: "condition", priority: "P2", safetyCritical: false, addToCollection: false,
  };
  assert.equal(expectedParentCurriculumId(value.curriculumId), "ENT-LAR-010");
  assert.equal(resolveExpectedParentPath(value.curriculumId, value.domain, [parent]), parent.path);
  assert.equal(canonicalHierarchyIssue(value, [parent]), null);
  assert.match(canonicalHierarchyIssue({ ...value, parentPath: "" }, [parent]) ?? "", /Select ENT-LAR-010/);
  assert.match(canonicalHierarchyIssue({ ...value, curriculumId: "ENT-LAR-010", parentPath: parent.path }, [parent]) ?? "", /cannot have a parent/);
  assert.equal(isExtensionCurriculumId("ENT-LAR-EXT-001"), true);
  assert.equal(canonicalHierarchyIssue({ ...value, curriculumId: "ENT-LAR-EXT-001", parentPath: parent.path }, [parent]), null);
});

test("proposal generator is an unverified Inbox scaffold without curriculum approval", () => {
  const markdown = buildProposalMarkdown({
    title: "Velopharyngeal Insufficiency",
    domain: "Pediatric",
    parentPath: "",
    parentTopic: "",
    topicKind: "condition",
    priority: "P2",
    safetyCritical: false,
  }, "2026-08-06");
  assert.match(markdown, /type: topic-proposal/);
  assert.match(markdown, /review_status: unverified/);
  assert.doesNotMatch(markdown, /curriculum_id:/);
  assert.match(markdown, /No source-traced synthesis yet/);
});

test("canonical generator creates an empty unverified clinical topic", () => {
  const markdown = buildCanonicalMarkdown({
    title: "Velopharyngeal Insufficiency",
    domain: "Laryngology",
    curriculumId: "ENT-LAR-010",
    parentTopic: "",
    topicKind: "condition",
    priority: "P2",
    safetyCritical: false,
  }, "2026-08-06");
  assert.match(markdown, /type: clinical-topic/);
  assert.match(markdown, /curriculum_id: "ENT-LAR-010"/);
  assert.match(markdown, /review_status: unverified/);
  assert.match(markdown, /reviewed_by:/);
  assert.match(markdown, /reviewed_date:/);
  assert.match(markdown, /last_tested:/);
  assert.match(markdown, /recall_confidence:/);
  assert.doesNotMatch(markdown, /review_status: reviewed/);
});

test("proposal promotion normalizer produces the complete canonical safety schema", () => {
  const metadata: Record<string, unknown> = {
    type: "topic-proposal",
    aliases: ["VPI"],
    sources: [{ book: "Test source", pages: "p.1", subject: "Test" }],
    proposed_domain: "Laryngology",
    proposed_parent: "",
    proposal_status: "inbox",
    review_status: "reviewed",
    cssclasses: ["personal-class"],
    created: "2026-08-01",
  };
  applyCanonicalFrontmatter(metadata, {
    value: {
      title: "Velopharyngeal Insufficiency", domain: "Laryngology", curriculumId: "ENT-LAR-010",
      parentPath: "", topicKind: "condition", priority: "P2", safetyCritical: false, addToCollection: false,
    },
    parentTopic: "",
    date: "2026-08-07",
    forceUnverified: true,
    removeProposalFields: true,
  });
  for (const key of ["type", "title", "curriculum_id", "domain", "topic_kind", "parent_topic", "aliases", "priority", "safety_critical", "review_status", "synthesis_status", "autoresearch_status", "ai_lock", "has_source", "reviewed_by", "reviewed_date", "last_tested", "recall_confidence", "sources", "created", "updated", "cssclasses"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(metadata, key), true, `missing ${key}`);
  }
  assert.equal(metadata.review_status, "unverified");
  assert.equal(metadata.has_source, true);
  assert.deepEqual(metadata.cssclasses, ["personal-class", "clinical-note"]);
  assert.equal("proposal_status" in metadata, false);
});

test("unknown search tokens fail visibly instead of matching every record", () => {
  assert.deepEqual(unknownQueryTokens("larynx priorty:P1 domain:pediatric"), ["priorty"]);
  assert.equal(matchesQuery(record(), "priorty:P1"), false);
});

test("phone search tolerates a realistic laryngology typing omission", () => {
  const target = record({
    title: "Laryngomalacia",
    path: "Knowledge Base/ENT/Pediatric/Laryngomalacia.md",
    domain: "ENT / Pediatric",
  });
  assert.equal(matchesQuery(target, "Layngo"), true);
  assert.equal(matchesQuery(target, "laryngo"), true);
});

test("organization backup round-trips without clinical content", () => {
  const data = migrateData(null);
  data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [record().path], subheadings: [] }];
  data.pinnedPaths = [record().path];
  data.curriculumVisual.parentByPath[record().path] = null;
  data.manualIndexPaths = ["Outside/Topic.md"];
  data.excludedIndexPaths = ["Knowledge Base/Hidden.md"];
  data.indexGroupByPath["Outside/Topic.md"] = "Airway";
  data.displayNameByPath["Outside/Topic.md"] = "Airway overview";
  data.indexGroupAliases.airway = "Airway";
  data.indexGroupOrder = ["Airway"];
  const backup = createPersonalBackup(data, "2026-08-07T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  const parsed = parsePersonalBackup(JSON.parse(JSON.stringify(backup)) as unknown);
  assert.equal(backup.version, 7);
  assert.equal(parsed.version, 7);
  assert.equal(parsed.sourceVaultId, "vault-ent-main");
  assert.equal(parsed.sourceBaseId, "base-ent");
  assert.equal(parsed.sourceBaseName, "ENT");
  assert.equal(parsed.sourceWorkspaceMode, "generic");
  assert.equal(parsed.collections[0]?.title, "Airway");
  assert.deepEqual(parsed.pinnedPaths, [record().path]);
  assert.equal(parsed.curriculumVisual.parentByPath[record().path], null);
  assert.deepEqual(parsed.manualIndexPaths, ["Outside/Topic.md"]);
  assert.deepEqual(parsed.excludedIndexPaths, ["Knowledge Base/Hidden.md"]);
  assert.equal(parsed.indexGroupByPath["Outside/Topic.md"], "Airway");
  assert.equal(parsed.displayNameByPath["Outside/Topic.md"], "Airway overview");
  assert.equal(parsed.indexGroupAliases.airway, "Airway");
  assert.deepEqual(parsed.indexGroupOrder, ["Airway"]);
  assert.equal("settings" in parsed, false);
});

test("version 1 organization backups remain readable but carry no trusted vault identity", () => {
  const parsed = parsePersonalBackup({
    kind: "ent-vault-command-center-personal-backup",
    version: 1,
    exportedAt: "2026-08-06T00:00:00.000Z",
    collections: [],
    pinnedPaths: ["topic.md"],
    nextStudyPaths: [],
    savedViews: [],
    curriculumVisual: { parentByPath: {}, orderByContainer: {} },
    layoutSnapshots: [],
  });
  assert.equal(parsed.version, 7);
  assert.equal(parsed.sourceVaultId, "");
  assert.equal(parsed.sourceBaseId, "");
  assert.equal(parsed.sourceWorkspaceMode, "");
  assert.deepEqual(parsed.manualIndexPaths, []);
  assert.deepEqual(parsed.excludedIndexPaths, []);
  assert.deepEqual(parsed.indexGroupByPath, {});
  assert.deepEqual(parsed.displayNameByPath, {});
  assert.deepEqual(parsed.indexGroupAliases, {});
  assert.deepEqual(parsed.indexGroupOrder, []);
});

test("portable workspace configuration round-trips settings and group order without note paths", () => {
  const data = migrateData(null);
  data.settings.workspaceName = "Research Command Center";
  data.settings.allowClinicalVisualGroupMoves = true;
  data.indexGroupOrder = ["Projects", "Reading"];
  data.manualIndexPaths = ["Private/Note.md"];
  const config = createWorkspaceConfig(data, "2026-08-07T00:00:00.000Z");
  const parsed = parseWorkspaceConfig(JSON.parse(JSON.stringify(config)) as unknown);
  assert.equal(parsed.settings.workspaceName, "Research Command Center");
  assert.equal(parsed.settings.allowClinicalVisualGroupMoves, true);
  assert.deepEqual(parsed.indexGroupOrder, ["Projects", "Reading"]);
  assert.equal("manualIndexPaths" in parsed, false);
  assert.equal(JSON.stringify(parsed).includes("Private/Note.md"), false);
});

test("workspace imports preserve the destination knowledge-base identity", () => {
  const source = migrateData(null);
  source.settings.workspaceName = "ENT";
  source.settings.indexLabel = "ENT master index";
  source.indexGroupOrder = ["Pediatric", "Otology"];
  const target = migrateData(null);
  target.settings.workspaceName = "Research";
  const value = parseAnyCommandCenterExport(createWorkspaceConfig(source, "2026-08-08T00:00:00.000Z"));

  applyPortableExport(target, value, portableSelection({ workspace: true }), "replace");

  assert.equal(target.settings.workspaceName, "Research");
  assert.equal(target.settings.indexLabel, "ENT master index");
  assert.deepEqual(target.indexGroupOrder, ["Pediatric", "Otology"]);
});

test("workspace import bounds its group-order list", () => {
  const data = migrateData(null);
  const config = createWorkspaceConfig(data, "2026-08-08T00:00:00.000Z");
  config.indexGroupOrder = Array.from({ length: 10_001 }, (_, index) => `Group ${index}`);
  assert.ok(new TextEncoder().encode(JSON.stringify(config)).byteLength < 10 * 1024 * 1024);
  assert.throws(() => parseWorkspaceConfig(config), /group order has too many entries/i);
});

test("portable export includes only selected components and organization choices auto-include the index catalog", () => {
  const data = migrateData(null);
  const source = record({ path: "Private ENT/Laryngeal Cleft.md", domain: "Airway" });
  data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [source.path], subheadings: [] }];
  data.pinnedPaths = [source.path];

  const workspaceOnly = createPortableExport(
    data,
    [source],
    portableSelection({ workspace: true }),
    "2026-08-08T00:00:00.000Z",
  );
  assert.deepEqual(Object.keys(workspaceOnly.components), ["workspace"]);
  assert.equal(workspaceOnly.sourceWorkspace, data.settings.workspaceName);
  assert.equal(data.portableIndex.subjects.length, 0, "workspace-only export must not allocate subject identities");

  const savedViewsOnly = createPortableExport(
    data,
    [source],
    portableSelection({ savedViews: true }),
    "2026-08-08T00:00:30.000Z",
  );
  assert.equal(savedViewsOnly.sourceWorkspace, "", "the workspace name is exported only with workspace settings");
  assert.equal(data.portableIndex.subjects.length, 0, "saved-view-only export must not scan or synchronize subjects");

  const organization = createPortableExport(
    data,
    [source],
    portableSelection({ collections: true, study: true }),
    "2026-08-08T00:01:00.000Z",
  );
  assert.ok(organization.components.index);
  assert.ok(organization.components.collections);
  assert.ok(organization.components.study);
  assert.equal(organization.components.workspace, undefined);
  assert.equal(organization.components.savedViews, undefined);
  assert.equal(organization.components.recovery, undefined);
  assert.equal(organization.components.index.subjects.length, 1);
});

test("portable export is path-free, content-free, and keeps stable subject IDs across repeated exports", () => {
  const data = migrateData(null);
  const sourcePath = "Private ENT/Patient-free Study/Laryngeal Cleft.md";
  const source = {
    ...record({ path: sourcePath, domain: "Airway" }),
    noteBody: "NEVER-EXPORT-THIS-NOTE-BODY",
  } as VaultRecord;
  data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [source.path], subheadings: [] }];

  const first = createPortableExport(
    data,
    [source],
    portableSelection({ index: true, collections: true }),
    "2026-08-08T00:00:00.000Z",
  );
  const second = createPortableExport(
    data,
    [source],
    portableSelection({ index: true, collections: true }),
    "2026-08-08T00:02:00.000Z",
  );
  const serialized = JSON.stringify(first);

  assert.equal(serialized.includes("resolvedPathBySubjectId"), false);
  assert.equal(serialized.includes(sourcePath), false);
  assert.equal(serialized.includes("NEVER-EXPORT-THIS-NOTE-BODY"), false);
  assert.equal(first.components.index?.subjects[0]?.id, second.components.index?.subjects[0]?.id);
  assert.equal(first.components.index?.subjects[0]?.configuredId, "", "generic configurable IDs are not portable metadata");
  assert.equal(data.portableIndex.subjects.length, 1);
  assert.equal(data.portableIndex.resolvedPathBySubjectId[first.components.index?.subjects[0]?.id ?? ""], sourcePath);
});

test("portable export carries exact procedure, medication, and syndrome catalogs without paths or note bodies", () => {
  const data = migrateData(null);
  const topic = record({
    path: "Private Source/Topics/Laryngeal Cleft.md",
    title: "Laryngeal Cleft",
    domain: "Pediatric",
  });
  const procedures = Array.from({ length: 21 }, (_, index) => ({
    ...record({
      path: `Private Source/Procedures/Procedure ${index + 1}.md`,
      title: `Procedure ${index + 1}`,
      kind: "procedure",
      role: "library",
      domain: "Procedures",
      curriculumId: "",
    }),
    noteBody: `NEVER-EXPORT-PROCEDURE-BODY-${index + 1}`,
  })) as VaultRecord[];
  const medications = Array.from({ length: 44 }, (_, index) => ({
    ...record({
      path: `Private Source/Medications/Medication ${index + 1}.md`,
      title: `Medication ${index + 1}`,
      kind: "medication",
      role: "library",
      domain: "Medications",
      curriculumId: "",
    }),
    noteBody: `NEVER-EXPORT-MEDICATION-BODY-${index + 1}`,
  })) as VaultRecord[];
  const syndromes = Array.from({ length: 25 }, (_, index) => ({
    ...record({
      path: `Private Source/Syndromes/Syndrome ${index + 1}.md`,
      title: `Syndrome ${index + 1}`,
      kind: "syndrome",
      role: "library",
      domain: "Syndromes",
      curriculumId: "",
    }),
    noteBody: `NEVER-EXPORT-SYNDROME-BODY-${index + 1}`,
  })) as VaultRecord[];
  const records = [topic, ...procedures, ...medications, ...syndromes];

  const exported = createPortableExport(
    data,
    records,
    portableSelection({ index: true, procedures: true, medications: true, syndromes: true }),
    "2026-08-08T00:00:00.000Z",
  );
  const summary = summarizePortableExport(exported);
  const groups = exported.components.index?.groups ?? [];
  const subjects = exported.components.index?.subjects ?? [];
  const serialized = serializePortableExport(exported);

  assert.deepEqual(summary, {
    groups: 1,
    subjects: 91,
    indexSubjects: 1,
    procedures: 21,
    medications: 44,
    syndromes: 25,
    placeholders: 91,
    collections: 0,
    pinned: 0,
    next: 0,
    views: 0,
    hasRecovery: false,
  });
  assert.equal(groups.length, 4, "the catalog must carry the groups needed by both the index and all three libraries");
  assert.deepEqual(
    Object.fromEntries(["topic", "procedure", "medication", "syndrome"].map((kind) => [
      kind,
      subjects.filter((subject) => subject.recordKind === kind).length,
    ])),
    { topic: 1, procedure: 21, medication: 44, syndrome: 25 },
  );
  assert.equal(subjects.filter((subject) => subject.recordKind !== "topic").every((subject) => !subject.indexed), true);
  assert.equal(serialized.includes("resolvedPathBySubjectId"), false);
  for (const source of records) assert.equal(serialized.includes(source.path), false, source.path);
  assert.equal(serialized.includes("NEVER-EXPORT-PROCEDURE-BODY"), false);
  assert.equal(serialized.includes("NEVER-EXPORT-MEDICATION-BODY"), false);
  assert.equal(serialized.includes("NEVER-EXPORT-SYNDROME-BODY"), false);
});

test("syndrome-only export imports path-free syndrome placeholders into a generic knowledge base", () => {
  const source = migrateData(null);
  const records = [
    record({ path: "Source/Topic.md", title: "Topic", kind: "topic", domain: "Topics" }),
    record({ path: "Source/Procedure.md", title: "Procedure", kind: "procedure", role: "library", domain: "Procedures" }),
    record({ path: "Source/Medication.md", title: "Medication", kind: "medication", role: "library", domain: "Medications" }),
    record({ path: "Source/Syndromes/CHARGE.md", title: "CHARGE syndrome", kind: "syndrome", role: "library", domain: "Syndromes" }),
    record({ path: "Source/Syndromes/22q11.md", title: "22q11.2 deletion syndrome", kind: "syndrome", role: "library", domain: "Syndromes" }),
  ];
  const exported = createPortableExport(
    source,
    records,
    portableSelection({ syndromes: true }),
    "2026-08-08T00:00:00.000Z",
  );
  const serialized = serializePortableExport(exported);
  const parsed = parsePortableExport(JSON.parse(serialized) as unknown);
  const index = parsed.components.index;

  assert.ok(index);
  assert.equal(index.includeIndex, false);
  assert.deepEqual(index.indexGroupIds, []);
  assert.deepEqual(index.subjects.map((subject) => subject.recordKind), ["syndrome", "syndrome"]);
  assert.equal(index.subjects.every((subject) => subject.indexed === false), true);
  assert.deepEqual(selectionAvailableForExport(parsed), portableSelection({ syndromes: true }));
  assert.equal(records.some((item) => serialized.includes(item.path)), false);

  const target = migrateData(null);
  assert.equal(target.settings.workspaceMode, "generic");
  const result = applyPortableExport(target, parsed, portableSelection({ syndromes: true }), "replace");

  assert.equal(result.addedSubjects, 2);
  assert.equal(result.unresolvedSubjects, 2);
  assert.deepEqual(target.portableIndex.resolvedPathBySubjectId, {});
  assert.deepEqual(target.portableIndex.subjects.map((subject) => subject.recordKind), ["syndrome", "syndrome"]);
  assert.equal(target.portableIndex.subjects.every((subject) => !subject.indexed), true);
  const placeholderPaths = target.portableIndex.subjects.map((subject) => portablePlaceholderPath(subject.id));
  assert.equal(placeholderPaths.every(isPortablePlaceholderPath), true);
  assert.equal(result.unresolvedSubjects, placeholderPaths.length);
  assert.deepEqual(target.manualIndexPaths, []);
  assert.deepEqual(target.indexGroupByPath, {});
  assert.deepEqual(target.curriculumVisual.parentByPath, {});
});

test("library-only replace preserves unrelated local topic identities and replaces only that library", () => {
  const source = migrateData(null);
  const incoming = parsePortableExport(createPortableExport(
    source,
    [record({
      path: "Source/Syndromes/CHARGE.md",
      title: "CHARGE syndrome",
      kind: "syndrome",
      role: "library",
      domain: "Syndromes",
      curriculumId: "",
    })],
    portableSelection({ syndromes: true }),
    "2026-08-08T00:00:00.000Z",
  ));
  const target = migrateData(null);
  const localTopicPath = "Knowledge Base/Local airway topic.md";
  const localSyndromePath = "Knowledge Base/Old syndrome.md";
  target.portableIndex = {
    version: 1,
    groups: [
      { id: "group-topics", title: "Airway", order: 0 },
      { id: "group-syndromes", title: "Syndromes", order: 1 },
    ],
    subjects: [
      {
        id: "subject-local-topic",
        title: "Local airway topic",
        groupId: "group-topics",
        parentId: null,
        order: 0,
        indexed: true,
        configuredId: "LOCAL-001",
        recordKind: "topic",
      },
      {
        id: "subject-old-syndrome",
        title: "Old syndrome",
        groupId: "group-syndromes",
        parentId: null,
        order: 0,
        indexed: false,
        configuredId: "",
        recordKind: "syndrome",
      },
    ],
    resolvedPathBySubjectId: {
      "subject-local-topic": localTopicPath,
      "subject-old-syndrome": localSyndromePath,
    },
  };
  target.manualIndexPaths = [localTopicPath];
  target.indexGroupByPath[localTopicPath] = "Airway";
  const localTopicBefore = structuredClone(target.portableIndex.subjects[0]);

  applyPortableExport(target, incoming, portableSelection({ syndromes: true }), "replace");

  assert.deepEqual(target.portableIndex.subjects.find((subject) => subject.id === "subject-local-topic"), localTopicBefore);
  assert.equal(target.portableIndex.resolvedPathBySubjectId["subject-local-topic"], localTopicPath);
  assert.equal(target.manualIndexPaths.includes(localTopicPath), true);
  assert.equal(target.indexGroupByPath[localTopicPath], "Airway");
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-old-syndrome"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(target.portableIndex.resolvedPathBySubjectId, "subject-old-syndrome"), false);
  assert.deepEqual(target.portableIndex.subjects.filter((subject) => subject.recordKind === "syndrome").map((subject) => subject.title), ["CHARGE syndrome"]);
});

test("older v1 topic-only packages remain index blueprints after library selections are introduced", () => {
  const legacy = portableFixture();
  const legacyIndex = legacy.components.index;
  assert.ok(legacyIndex);
  delete legacyIndex.includeIndex;
  delete legacyIndex.indexGroupIds;
  const legacySubject = legacyIndex.subjects[0] as unknown as Record<string, unknown>;
  delete legacySubject.recordKind;

  const parsed = parsePortableExport(JSON.parse(JSON.stringify(legacy)) as unknown);
  assert.equal(parsed.components.index?.includeIndex, undefined);
  assert.deepEqual(parsed.components.index?.subjects.map((subject) => subject.recordKind), ["topic"]);
  assert.deepEqual(selectionAvailableForExport(parsed), portableSelection({ index: true }));

  const target = migrateData(null);
  const result = applyPortableExport(target, parsed, portableSelection({ index: true }), "replace");
  const imported = target.portableIndex.subjects.find((subject) => subject.id === "subject-cleft");
  assert.ok(imported);
  assert.equal(imported.recordKind, "topic");
  assert.equal(imported.indexed, true);
  assert.equal(result.unresolvedSubjects, 1);
  assert.ok(target.manualIndexPaths.includes(portablePlaceholderPath(imported.id)));
});

test("portable index round-trip preserves the effective ENT heading hierarchy, order, and collapse state", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.idProperty = "curriculum_id";
  const clinicalEvaluation = record({
    path: "03 Clinical Topics/01 Pediatric/ENT-PED-003 - Clinical Evaluation of Airway Obstruction.md",
    title: "Clinical Evaluation of Airway Obstruction",
    curriculumId: "ENT-PED-003",
    folderOrder: "01 Pediatric",
  });
  const stridor = record({
    path: "03 Clinical Topics/01 Pediatric/ENT-PED-003.01 - Evaluation of stridor.md",
    title: "Evaluation of stridor",
    curriculumId: "ENT-PED-003.01",
    folderOrder: "01 Pediatric",
  });
  const aspiration = record({
    path: "03 Clinical Topics/01 Pediatric/ENT-PED-003.02 - Evaluation of aspiration.md",
    title: "Evaluation of aspiration",
    curriculumId: "ENT-PED-003.02",
    folderOrder: "01 Pediatric",
  });
  const otology = record({
    path: "03 Clinical Topics/02 Otology/ENT-OTO-001 - Hearing Loss.md",
    title: "Hearing Loss",
    curriculumId: "ENT-OTO-001",
    domain: "Otology",
    folderOrder: "02 Otology",
  });
  const general = record({
    path: "03 Clinical Topics/99 General/ENT-GEN-001 - General ENT.md",
    title: "General ENT",
    curriculumId: "ENT-GEN-001",
    domain: "General",
    folderOrder: "99 General",
  });
  // Deliberately differ from both folder order and the requested child order.
  const records = [general, aspiration, otology, stridor, clinicalEvaluation];
  data.curriculumVisual.orderByContainer[curriculumContainerKey("Pediatric", clinicalEvaluation.path)] = [stridor.path, aspiration.path];
  data.indexGroupOrder = ["Future empty heading"];
  registerPortableGroup(data, "Future empty heading");
  data.collapsed.curriculumDomains = ["Pediatric"];
  data.collapsed.curriculumNodes = [clinicalEvaluation.path];

  const exported = createPortableExport(data, records, portableSelection({ index: true }), "2026-08-08T00:00:00.000Z");
  const parsed = parsePortableExport(JSON.parse(JSON.stringify(exported)) as unknown);
  const index = parsed.components.index;
  assert.ok(index);
  assert.deepEqual(index.groups.map((group) => group.title), ["Pediatric", "Otology", "General", "Future empty heading"]);
  const parent = index.subjects.find((subject) => subject.title === clinicalEvaluation.title);
  const exportedStridor = index.subjects.find((subject) => subject.title === stridor.title);
  const exportedAspiration = index.subjects.find((subject) => subject.title === aspiration.title);
  assert.ok(parent);
  assert.ok(exportedStridor);
  assert.ok(exportedAspiration);
  assert.equal(exportedStridor.parentId, parent.id);
  assert.equal(exportedAspiration.parentId, parent.id);
  assert.deepEqual(
    [exportedStridor, exportedAspiration].sort((a, b) => a.order - b.order).map((subject) => subject.title),
    [stridor.title, aspiration.title],
  );
  const pediatricGroup = index.groups.find((group) => group.title === "Pediatric");
  assert.deepEqual(index.collapsedGroupIds, [pediatricGroup?.id]);
  assert.deepEqual(index.collapsedSubjectIds, [parent.id]);
  const serialized = JSON.stringify(exported);
  assert.equal(records.some((item) => serialized.includes(item.path)), false, "portable hierarchy state must remain path-free");

  const replaced = migrateData(null);
  replaced.collapsed.curriculumDomains = ["Old local group"];
  replaced.collapsed.curriculumNodes = ["Old/Local parent.md"];
  applyPortableExport(replaced, parsed, portableSelection({ index: true }), "replace");
  const replacedParent = replaced.portableIndex.subjects.find((subject) => subject.title === clinicalEvaluation.title);
  const replacedStridor = replaced.portableIndex.subjects.find((subject) => subject.title === stridor.title);
  const replacedAspiration = replaced.portableIndex.subjects.find((subject) => subject.title === aspiration.title);
  assert.ok(replacedParent);
  assert.ok(replacedStridor);
  assert.ok(replacedAspiration);
  const parentPath = portablePlaceholderPath(replacedParent.id);
  const stridorPath = portablePlaceholderPath(replacedStridor.id);
  const aspirationPath = portablePlaceholderPath(replacedAspiration.id);
  assert.deepEqual(replaced.indexGroupOrder, ["Pediatric", "Otology", "General", "Future empty heading"]);
  assert.equal(replaced.curriculumVisual.parentByPath[stridorPath], parentPath);
  assert.equal(replaced.curriculumVisual.parentByPath[aspirationPath], parentPath);
  assert.deepEqual(
    replaced.curriculumVisual.orderByContainer[curriculumContainerKey("Pediatric", parentPath)],
    [stridorPath, aspirationPath],
  );
  assert.deepEqual(replaced.collapsed.curriculumDomains, ["Pediatric"]);
  assert.deepEqual(replaced.collapsed.curriculumNodes, [parentPath]);

  const merged = migrateData(null);
  merged.collapsed.curriculumDomains = ["Local group"];
  merged.collapsed.curriculumNodes = ["Local/Parent.md"];
  applyPortableExport(merged, parsed, portableSelection({ index: true }), "merge");
  const mergedParent = merged.portableIndex.subjects.find((subject) => subject.title === clinicalEvaluation.title);
  assert.ok(mergedParent);
  assert.deepEqual(merged.collapsed.curriculumDomains, ["Local group", "Pediatric"]);
  assert.deepEqual(merged.collapsed.curriculumNodes, ["Local/Parent.md", portablePlaceholderPath(mergedParent.id)]);
});

test("legacy portable index packages preserve local collapse state when path-free collapse IDs are absent", () => {
  const parsed = parsePortableExport(portableFixture());
  assert.equal(parsed.components.index?.collapsedGroupIds, undefined);
  assert.equal(parsed.components.index?.collapsedSubjectIds, undefined);
  const target = migrateData(null);
  target.collapsed.curriculumDomains = ["Keep local group"];
  target.collapsed.curriculumNodes = ["Keep/Local subject.md"];

  applyPortableExport(target, parsed, portableSelection({ index: true }), "replace");

  assert.deepEqual(target.collapsed.curriculumDomains, ["Keep local group"]);
  assert.deepEqual(target.collapsed.curriculumNodes, ["Keep/Local subject.md"]);
});

test("portable parser validates and bounds path-free collapsed hierarchy IDs", () => {
  const unknown = portableFixture();
  if (unknown.components.index) unknown.components.index.collapsedSubjectIds = ["subject-unknown"];
  assert.throws(() => parsePortableExport(unknown), /collapsed index subjects references unknown ID/i);

  const oversized = portableFixture();
  if (oversized.components.index) oversized.components.index.collapsedGroupIds = Array(10_001).fill("group-airway") as string[];
  assert.throws(() => parsePortableExport(oversized), /collapsed index groups has too many entries/i);
});

test("portable export retains only the canonical clinical curriculum ID mapping", () => {
  const canonical = migrateData(null);
  canonical.settings.workspaceMode = "ent-clinical";
  canonical.settings.idProperty = "curriculum_id";
  const canonicalExport = createPortableExport(
    canonical,
    [record()],
    portableSelection({ index: true }),
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(canonicalExport.components.index?.subjects[0]?.configuredId, "ENT-PED-003.05");

  const customized = migrateData(null);
  customized.settings.workspaceMode = "ent-clinical";
  customized.settings.idProperty = "private_path";
  const privateValue = "Patients/Alice/scan.md";
  const customizedExport = createPortableExport(
    customized,
    [record({ curriculumId: privateValue })],
    portableSelection({ index: true }),
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(customizedExport.components.index?.subjects[0]?.configuredId, "");
  assert.equal(JSON.stringify(customizedExport).includes(privateValue), false);

  const malformedCanonical = migrateData(null);
  malformedCanonical.settings.workspaceMode = "ent-clinical";
  malformedCanonical.settings.idProperty = "curriculum_id";
  const malformedExport = createPortableExport(
    malformedCanonical,
    [record({ curriculumId: privateValue })],
    portableSelection({ index: true }),
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(malformedExport.components.index?.subjects[0]?.configuredId, "");
  assert.equal(JSON.stringify(malformedExport).includes(privateValue), false);
});

test("collection-only export carries the referenced identity without importing index hierarchy", () => {
  const data = migrateData(null);
  const parentId = "subject-parent";
  const childId = "subject-child";
  const parentPath = portablePlaceholderPath(parentId);
  const childPath = portablePlaceholderPath(childId);
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [
      { id: parentId, title: "Parent", groupId: "group-airway", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "topic" },
      { id: childId, title: "Child", groupId: "group-airway", parentId, order: 0, indexed: false, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: {},
  };
  data.collections = [{ id: "reading", title: "Reading", collapsed: false, subjects: [childPath], subheadings: [] }];
  const records = [
    record({ path: parentPath, title: "Parent", role: "placeholder", isPlaceholder: true, portableIndexed: false, portableId: parentId }),
    record({ path: childPath, title: "Child", role: "placeholder", isPlaceholder: true, portableIndexed: false, portableId: childId }),
  ];
  const exported = createPortableExport(data, records, portableSelection({ collections: true }), "2026-08-08T00:00:00.000Z");
  assert.deepEqual(new Set(exported.components.index?.subjects.map((subject) => subject.id)), new Set([childId]));
  assert.equal(exported.components.index?.subjects.find((subject) => subject.id === childId)?.parentId, null);
  assert.equal(exported.components.index?.subjects.find((subject) => subject.id === childId)?.indexed, false);
  assert.equal(exported.components.index?.includedSections?.index, false);
});

test("portable group rename preserves identity without resurrecting the old heading", () => {
  const data = migrateData(null);
  data.indexGroupOrder = ["Old heading"];
  const group = registerPortableGroup(data, "Old heading");
  const subjectId = "subject-renamed-group";
  const placeholder = portablePlaceholderPath(subjectId);
  data.portableIndex.subjects.push({
    id: subjectId,
    title: "Portable topic",
    groupId: group.id,
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
  });
  data.manualIndexPaths = [placeholder];

  data.indexGroupOrder = ["Renamed heading"];
  renameOrMergePortableGroup(data, "Old heading", "Renamed heading");
  const exported = createPortableExport(data, [], portableSelection({ index: true }), "2026-08-08T00:00:00.000Z");

  assert.equal(data.portableIndex.groups[0]?.id, group.id);
  assert.deepEqual(exported.components.index?.groups.map((item) => item.title), ["Renamed heading"]);
  assert.equal(exported.components.index?.subjects[0]?.groupId, group.id);
});

test("portable group merge and delete remove stale headings without orphaning subjects", () => {
  const data = migrateData(null);
  data.indexGroupOrder = ["Source", "Target", "Delete me"];
  const source = registerPortableGroup(data, "Source");
  const target = registerPortableGroup(data, "Target");
  registerPortableGroup(data, "Delete me");
  const subjectId = "subject-merged-group";
  const placeholder = portablePlaceholderPath(subjectId);
  data.portableIndex.subjects.push({
    id: subjectId,
    title: "Merged topic",
    groupId: source.id,
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
  });
  data.manualIndexPaths = [placeholder];

  data.indexGroupOrder = ["Target"];
  renameOrMergePortableGroup(data, "Source", "Target");
  removePortableGroup(data, "Delete me");
  const exported = createPortableExport(data, [], portableSelection({ index: true }), "2026-08-08T00:00:00.000Z");

  assert.equal(data.portableIndex.subjects[0]?.groupId, target.id);
  assert.deepEqual(exported.components.index?.groups.map((item) => item.title), ["Target"]);
  assert.equal(exported.components.index?.subjects[0]?.groupId, target.id);
});

test("a deliberately-created empty portable group survives synchronization and export", () => {
  const data = migrateData(null);
  data.indexGroupOrder = ["Future topics"];
  const group = registerPortableGroup(data, "Future topics");

  synchronizePortableRegistry(data, []);
  const exported = createPortableExport(data, [], portableSelection({ index: true }), "2026-08-08T00:00:00.000Z");

  assert.equal(data.portableIndex.groups.find((item) => item.id === group.id)?.title, "Future topics");
  assert.deepEqual(exported.components.index?.groups.map((item) => item.title), ["Future topics"]);
  assert.deepEqual(exported.components.index?.subjects, []);
});

test("portable parser rejects wrong envelopes, duplicate IDs, cycles, and prototype-like IDs", () => {
  assert.throws(
    () => parsePortableExport({ ...portableFixture(), kind: "another-export" }),
    /unsupported/i,
  );
  assert.throws(
    () => parsePortableExport({ ...portableFixture(), version: 2 }),
    /unsupported/i,
  );

  const duplicate = portableFixture();
  const duplicateIndex = duplicate.components.index;
  assert.ok(duplicateIndex);
  duplicateIndex.subjects.push({ ...duplicateIndex.subjects[0] });
  assert.throws(() => parsePortableExport(duplicate), /duplicate subject ID/i);

  const cyclic = portableFixture();
  const cyclicIndex = cyclic.components.index;
  assert.ok(cyclicIndex);
  const first = cyclicIndex.subjects[0];
  first.parentId = "subject-parent";
  cyclicIndex.subjects.push({
    ...first,
    id: "subject-parent",
    title: "Congenital Laryngeal Anomalies",
    parentId: first.id,
    order: 1,
  });
  assert.throws(() => parsePortableExport(cyclic), /cycle/i);

  const prototypeId = portableFixture();
  const prototypeIndex = prototypeId.components.index;
  assert.ok(prototypeIndex);
  prototypeIndex.groups[0].id = "__proto__";
  prototypeIndex.subjects[0].groupId = "__proto__";
  assert.throws(() => parsePortableExport(prototypeId), /invalid/i);

  for (const inheritedKey of ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf"]) {
    const inheritedId = portableFixture();
    const inheritedIndex = inheritedId.components.index;
    assert.ok(inheritedIndex);
    inheritedIndex.subjects[0].id = inheritedKey;
    assert.throws(() => parsePortableExport(inheritedId), /invalid/i, inheritedKey);
  }
});

test("same-vault recovery drops portable identities that collide with Object.prototype", () => {
  const inheritedKeys = ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf"];
  const parsed = parsePersonalBackup({
    kind: "ent-vault-command-center-personal-backup",
    version: 4,
    portableIndex: {
      version: 1,
      groups: [{ id: "group-safe", title: "Safe", order: 0 }],
      subjects: [
        ...inheritedKeys.map((id, order) => ({
          id,
          title: id,
          groupId: "group-safe",
          parentId: null,
          order,
          indexed: true,
          configuredId: "",
          recordKind: "topic",
        })),
        {
          id: "subject-safe",
          title: "Safe subject",
          groupId: "group-safe",
          parentId: null,
          order: inheritedKeys.length,
          indexed: true,
          configuredId: "",
          recordKind: "topic",
        },
      ],
      resolvedPathBySubjectId: Object.fromEntries([
        ...inheritedKeys.map((id) => [id, `Knowledge Base/${id}.md`]),
        ["subject-safe", "Knowledge Base/Safe.md"],
      ]),
    },
  });

  assert.deepEqual(parsed.portableIndex.subjects.map((subject) => subject.id), ["subject-safe"]);
  assert.deepEqual(parsed.portableIndex.resolvedPathBySubjectId, { "subject-safe": "Knowledge Base/Safe.md" });
});

test("portable parser bounds per-list and aggregate subject references below the file-size ceiling", () => {
  const oversizedList = portableFixture();
  oversizedList.components.study = {
    version: 1,
    pinnedSubjectIds: Array(MAX_TRANSFER_LIST_ITEMS + 1).fill("subject-cleft") as string[],
    nextSubjectIds: [],
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(oversizedList)).byteLength < 10 * 1024 * 1024);
  assert.throws(() => parsePortableExport(oversizedList), /too many references/i);

  const aggregate = portableFixture();
  const referencesPerList = MAX_TRANSFER_LIST_ITEMS;
  const listCount = Math.floor(MAX_TRANSFER_TOTAL_REFERENCES / referencesPerList) + 1;
  aggregate.components.collections = {
    version: 1,
    collections: [{
      id: "collection-bounded",
      title: "Bounded",
      collapsed: false,
      subjectIds: [],
      subheadings: Array.from({ length: listCount }, (_, index) => ({
        id: `subheading-${index}`,
        title: `Subheading ${index}`,
        collapsed: false,
        subjectIds: Array(referencesPerList).fill("subject-cleft") as string[],
      })),
    }],
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(aggregate)).byteLength < 10 * 1024 * 1024);
  assert.throws(() => parsePortableExport(aggregate), /portable package contains more than/i);
});

test("same-vault recovery bounds lists, aggregate references, saved views, and snapshots", () => {
  const source = migrateData(null);
  const oversizedList = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  oversizedList.pinnedPaths = Array(MAX_TRANSFER_LIST_ITEMS + 1).fill("Note.md") as string[];
  assert.ok(new TextEncoder().encode(JSON.stringify(oversizedList)).byteLength < 10 * 1024 * 1024);
  assert.throws(() => parsePersonalBackup(oversizedList), /too many references/i);

  const aggregate = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  const referencesPerList = MAX_TRANSFER_LIST_ITEMS;
  const listCount = Math.floor(MAX_TRANSFER_TOTAL_REFERENCES / referencesPerList) + 1;
  aggregate.collections = [{
    id: "collection-bounded",
    title: "Bounded",
    collapsed: false,
    subjects: [],
    subheadings: Array.from({ length: listCount }, (_, index) => ({
      id: `subheading-${index}`,
      title: `Subheading ${index}`,
      collapsed: false,
      subjects: Array(referencesPerList).fill("Note.md") as string[],
    })),
  }];
  assert.ok(new TextEncoder().encode(JSON.stringify(aggregate)).byteLength < 10 * 1024 * 1024);
  assert.throws(() => parsePersonalBackup(aggregate), /recovery backup contains more than/i);

  const savedViews = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  savedViews.savedViews = Array.from({ length: 10_001 }, (_, index) => ({
    id: `view-${index}`,
    name: `View ${index}`,
    tab: "curriculum" as const,
    query: "",
  }));
  assert.throws(() => parsePersonalBackup(savedViews), /saved views has too many entries/i);

  const snapshots = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  snapshots.layoutSnapshots = Array.from({ length: MAX_TRANSFER_SNAPSHOTS + 1 }, (_, index) => snapshotPersonal(source, `Snapshot ${index}`));
  assert.throws(() => parsePersonalBackup(snapshots), /named snapshots has too many entries/i);
});

test("merge import creates unresolved portable placeholders without reintroducing source paths", () => {
  const sourceData = migrateData(null);
  const source = record({ path: "Source Vault/ENT/Laryngeal Cleft.md", domain: "Airway" });
  sourceData.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [source.path], subheadings: [] }];
  sourceData.pinnedPaths = [source.path];
  sourceData.nextStudyPaths = [source.path];
  const exported = createPortableExport(
    sourceData,
    [source],
    portableSelection({ collections: true, study: true }),
    "2026-08-08T00:00:00.000Z",
  );
  const serialized = JSON.stringify(exported);
  const parsed = parsePortableExport(JSON.parse(serialized) as unknown);
  const target = migrateData(null);
  const result = applyPortableExport(
    target,
    parsed,
    portableSelection({ collections: true, study: true }),
    "merge",
  );
  const subjectId = parsed.components.index?.subjects[0]?.id ?? "";
  const placeholderPath = portablePlaceholderPath(subjectId);

  assert.equal(serialized.includes(source.path), false);
  assert.equal(serialized.includes("resolvedPathBySubjectId"), false);
  assert.equal(result.unresolvedSubjects, 1);
  assert.deepEqual(target.portableIndex.resolvedPathBySubjectId, {});
  assert.equal(target.manualIndexPaths.includes(placeholderPath), false);
  assert.deepEqual(target.collections[0]?.subjects, [placeholderPath]);
  assert.deepEqual(target.pinnedPaths, [placeholderPath]);
  assert.deepEqual(target.nextStudyPaths, [placeholderPath]);
});

test("replace import changes only selected components and preserves state omitted from the package", () => {
  const target = migrateData(null);
  const oldPlaceholder = portablePlaceholderPath("subject-old");
  target.settings.workspaceName = "Keep Local Workspace";
  target.portableIndex = {
    version: 1,
    groups: [{ id: "group-old", title: "Old", order: 0 }],
    subjects: [{
      id: "subject-old",
      title: "Old unresolved subject",
      groupId: "group-old",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  target.manualIndexPaths = [oldPlaceholder];
  target.collections = [{ id: "local", title: "Local collection", collapsed: false, subjects: ["Local/Collection note.md"], subheadings: [] }];
  target.pinnedPaths = ["Local/Pinned.md"];
  target.nextStudyPaths = ["Local/Next.md"];
  target.savedViews = [{ id: "local-view", name: "Local view", tab: "collections", query: "local" }];

  applyPortableExport(
    target,
    parsePortableExport(portableFixture()),
    portableSelection({ index: true }),
    "replace",
  );

  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-old"), false);
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-cleft"), true);
  assert.equal(target.settings.workspaceName, "Keep Local Workspace");
  assert.equal(target.collections[0]?.title, "Local collection");
  assert.deepEqual(target.pinnedPaths, ["Local/Pinned.md"]);
  assert.deepEqual(target.nextStudyPaths, ["Local/Next.md"]);
  assert.equal(target.savedViews[0]?.name, "Local view");
});

test("replace index preserves unresolved identities referenced by unselected local sections", () => {
  const target = migrateData(null);
  const oldId = "subject-local-reference";
  const oldPath = portablePlaceholderPath(oldId);
  target.portableIndex = {
    version: 1,
    groups: [{ id: "group-local", title: "Local", order: 0 }],
    subjects: [{ id: oldId, title: "Local reference", groupId: "group-local", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: {},
  };
  target.manualIndexPaths = [oldPath];
  target.collections = [{ id: "local", title: "Local", collapsed: false, subjects: [oldPath], subheadings: [] }];

  applyPortableExport(target, parsePortableExport(portableFixture()), portableSelection({ index: true }), "replace");

  assert.equal(target.collections[0]?.subjects[0], oldPath);
  assert.equal(target.portableIndex.subjects.find((subject) => subject.id === oldId)?.indexed, false);
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === oldId), true);
  assert.equal(target.manualIndexPaths.includes(oldPath), false);
});

test("replace index hides dropped primary notes and retains protected and imported non-index membership", () => {
  const target = migrateData(null);
  const droppedPath = "Knowledge Base/Dropped.md";
  const protectedPath = "Knowledge Base/Protected.md";
  const importedPath = "Knowledge Base/Imported ancestor.md";
  target.portableIndex = {
    version: 1,
    groups: [{ id: "group-local", title: "Local", order: 0 }],
    subjects: [
      { id: "subject-dropped", title: "Dropped", groupId: "group-local", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "topic" },
      { id: "subject-protected", title: "Protected", groupId: "group-local", parentId: null, order: 1, indexed: false, configuredId: "", recordKind: "topic" },
      { id: "subject-imported", title: "Imported ancestor", groupId: "group-local", parentId: null, order: 2, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: {
      "subject-dropped": droppedPath,
      "subject-protected": protectedPath,
      "subject-imported": importedPath,
    },
  };
  target.excludedIndexPaths = [droppedPath, protectedPath];
  target.collections = [{ id: "local", title: "Local", collapsed: false, subjects: [protectedPath], subheadings: [] }];

  const incoming = portableFixture();
  incoming.components.index = {
    version: 1,
    groups: [{ id: "group-local", title: "Local", order: 0 }],
    subjects: [{
      id: "subject-imported",
      title: "Imported ancestor",
      groupId: "group-local",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
    }],
  };

  applyPortableExport(target, parsePortableExport(incoming), portableSelection({ index: true }), "replace");

  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-dropped"), false);
  assert.equal(target.excludedIndexPaths.includes(droppedPath), true);
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-protected"), true);
  assert.equal(target.excludedIndexPaths.includes(protectedPath), true);
  assert.equal(target.portableIndex.subjects.find((subject) => subject.id === "subject-imported")?.indexed, false);
  assert.equal(target.excludedIndexPaths.includes(importedPath), true);
});

test("ambiguous metadata never collapses distinct incoming subjects", () => {
  const target = migrateData(null);
  target.portableIndex = {
    version: 1,
    groups: [{ id: "group-local", title: "Airway", order: 0 }],
    subjects: [{ id: "subject-local", title: "Shared title", groupId: "group-local", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { "subject-local": "Knowledge Base/Shared title.md" },
  };
  const incoming = portableFixture();
  incoming.components.index = {
    version: 1,
    groups: [{ id: "group-source", title: "Airway", order: 0 }],
    subjects: [
      { id: "subject-a", title: "Shared title", groupId: "group-source", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "subject-b", title: "Shared title", groupId: "group-source", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
    ],
  };

  const result = applyPortableExport(target, parsePortableExport(incoming), portableSelection({ index: true }), "merge");
  assert.equal(result.matchedSubjects, 1);
  assert.equal(result.addedSubjects, 1);
  assert.equal(new Set(target.portableIndex.subjects.map((subject) => subject.id)).size, 2);
});

test("clinical configured-ID conflicts do not fall back to title-only matching", () => {
  const target = migrateData(null);
  target.portableIndex = {
    version: 1,
    groups: [{ id: "group-local", title: "Airway", order: 0 }],
    subjects: [{ id: "subject-local", title: "Laryngeal Cleft", groupId: "group-local", parentId: null, order: 0, indexed: true, configuredId: "ENT-PED-999", recordKind: "topic" }],
    resolvedPathBySubjectId: { "subject-local": "Knowledge Base/Laryngeal Cleft.md" },
  };
  const result = applyPortableExport(target, parsePortableExport(portableFixture()), portableSelection({ index: true }), "merge");
  assert.equal(result.matchedSubjects, 0);
  assert.equal(result.addedSubjects, 1);
});

test("same-vault recovery is an explicit standalone replace operation", () => {
  const source = migrateData(null);
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "",
    components: { recovery: createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT") },
  };
  const target = migrateData(null);
  assert.throws(() => applyPortableExport(target, value, portableSelection({ recovery: true }), "merge"), /not a merge/i);
  value.components.workspace = createWorkspaceConfig(source, value.exportedAt);
  assert.throws(
    () => applyPortableExport(target, value, portableSelection({ recovery: true, workspace: true }), "replace"),
    /by itself/i,
  );
});

test("same-vault recovery rejects ent-Main-vault data in MY MAIN NOTE KB before mutation", () => {
  const source = migrateData(null);
  source.collections = [{ id: "ent", title: "ENT", collapsed: false, subjects: ["03 Clinical Topics/Larynx.md"], subheadings: [] }];
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "ENT main vault",
    components: {
      recovery: createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main-vault", "base-ent", "ENT"),
    },
  };
  const target = migrateData(null);
  target.collections = [{ id: "local", title: "MY MAIN NOTE KB", collapsed: false, subjects: ["Knowledge Base/Local.md"], subheadings: [] }];
  const before = structuredClone(target);

  assert.throws(
    () => applyPortableExport(target, value, portableSelection({ recovery: true }), "replace", "vault-my-main-note-kb"),
    /different Obsidian vault/i,
  );
  assert.deepEqual(target, before);
});

test("v7 recovery restores only into its exact knowledge base by default", () => {
  const source = migrateData(null);
  source.settings.workspaceName = "ENT";
  source.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: ["Knowledge/Airway.md"], subheadings: [] }];
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "ENT",
    components: {
      recovery: createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-shared", "base-ent", "ENT"),
    },
  };
  const target = migrateData(null);
  target.settings.workspaceName = "ENT renamed";

  applyPortableExport(
    target,
    value,
    portableSelection({ recovery: true }),
    "replace",
    "vault-shared",
    undefined,
    "base-ent",
    "ENT renamed",
  );

  assert.equal(target.collections[0]?.title, "Airway");
});

test("same-vault recovery cannot overwrite another knowledge base without a separate override", () => {
  const source = migrateData(null);
  source.settings.workspaceName = "ENT";
  source.collections = [{ id: "ent", title: "ENT", collapsed: false, subjects: [], subheadings: [] }];
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "ENT",
    components: {
      recovery: createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-shared", "base-ent", "ENT"),
    },
  };
  const target = migrateData(null);
  target.settings.workspaceName = "Research";
  target.collections = [{ id: "local", title: "Keep", collapsed: false, subjects: [], subheadings: [] }];
  const before = structuredClone(target);

  assert.throws(
    () => applyPortableExport(
      target,
      value,
      portableSelection({ recovery: true }),
      "replace",
      "vault-shared",
      undefined,
      "base-research",
      "Research",
    ),
    /belongs to knowledge base “ENT”.*not “Research”.*separate cross-base/i,
  );
  assert.deepEqual(target, before);

  applyPortableExport(
    target,
    value,
    portableSelection({ recovery: true }),
    "replace",
    "vault-shared",
    undefined,
    "base-research",
    "Research",
    true,
  );
  assert.equal(target.collections[0]?.title, "ENT");
});

test("cross-base recovery is hard-blocked across Generic and ENT clinical presets", () => {
  const source = migrateData(null);
  source.settings.workspaceMode = "ent-clinical";
  source.settings.workspaceName = "ENT";
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "ENT",
    components: {
      recovery: createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-shared", "base-ent", "ENT"),
    },
  };
  const target = migrateData(null);
  target.settings.workspaceName = "Research";
  const before = structuredClone(target);

  assert.throws(
    () => applyPortableExport(
      target,
      value,
      portableSelection({ recovery: true }),
      "replace",
      "vault-shared",
      undefined,
      "base-research",
      "Research",
      true,
    ),
    /ENT clinical preset.*cannot be restored into the Generic preset/i,
  );
  assert.deepEqual(target, before);
});

test("v1–v6 recovery requires a distinct base-unverified override", () => {
  const source = migrateData(null);
  source.savedViews = [{ id: "review", name: "Review", tab: "curriculum", query: "larynx" }];
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-shared", "base-ent", "ENT");
  const v6 = { ...modern, version: 6 } as Record<string, unknown>;
  delete v6.sourceBaseId;
  delete v6.sourceBaseName;
  delete v6.sourceWorkspaceMode;
  const parsed = parsePersonalBackup(v6);
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: modern.exportedAt,
    sourceWorkspace: "",
    components: { recovery: parsed },
  };
  const target = migrateData(null);

  assert.throws(
    () => applyPortableExport(
      target,
      value,
      portableSelection({ recovery: true }),
      "replace",
      "vault-shared",
      undefined,
      "base-ent",
      "ENT",
    ),
    /v1–v6 recovery.*base-unverified/i,
  );
  applyPortableExport(
    target,
    value,
    portableSelection({ recovery: true }),
    "replace",
    "vault-shared",
    undefined,
    "base-ent",
    "ENT",
    true,
  );
  assert.equal(target.savedViews[0]?.name, "Review");
});

test("recovery exported from a losing provisional ID is rejected after first-upgrade convergence", () => {
  const legacy = migrateData(null);
  const first = migrateStore(structuredClone(legacy), 100);
  const second = migrateStore(structuredClone(legacy), 100);
  const winnerId = [first.vaultId, second.vaultId].sort()[0];
  const loserId = [first.vaultId, second.vaultId].sort()[1];
  const backup = createPersonalBackup(legacy, "2026-08-08T00:00:00.000Z", loserId, "base-default", "My Knowledge Base");
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: backup.exportedAt,
    sourceWorkspace: "",
    components: { recovery: backup },
  };
  const target = migrateData(null);

  assert.throws(
    () => applyPortableExport(
      target,
      value,
      portableSelection({ recovery: true }),
      "replace",
      winnerId,
      undefined,
      "base-default",
      "My Knowledge Base",
    ),
    /different Obsidian vault/i,
  );
});

test("legacy recovery with 0 of 722 referenced paths is rejected before mutation", () => {
  const source = migrateData(null);
  source.manualIndexPaths = Array.from({ length: 722 }, (_, index) => `03 Clinical Topics/Legacy ${index}.md`);
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main-vault", "base-ent", "ENT");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  const parsedLegacy = parsePersonalBackup(legacy);
  const target = migrateData(null);
  target.pinnedPaths = ["Knowledge Base/Keep.md"];
  const before = structuredClone(target);
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "",
    components: { recovery: parsedLegacy },
  };

  assert.throws(
    () => applyPortableExport(
      target,
      value,
      portableSelection({ recovery: true }),
      "replace",
      "vault-my-main-note-kb",
      () => false,
    ),
    /matches 0 of 722 unique referenced paths.*at least 361 \(50%\)/i,
  );
  assert.deepEqual(target, before);
});

test("legacy recovery with only 1 of 722 matching paths is rejected before mutation", () => {
  const source = migrateData(null);
  source.manualIndexPaths = Array.from({ length: 722 }, (_, index) => `03 Clinical Topics/Legacy ${index}.md`);
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main-vault", "base-ent", "ENT");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  const target = migrateData(null);
  target.pinnedPaths = ["Knowledge Base/Keep.md"];
  const before = structuredClone(target);
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: modern.exportedAt,
    sourceWorkspace: "",
    components: { recovery: parsePersonalBackup(legacy) },
  };

  assert.throws(
    () => applyPortableExport(
      target,
      value,
      portableSelection({ recovery: true }),
      "replace",
      "vault-my-main-note-kb",
      (path) => path === "03 Clinical Topics/Legacy 0.md",
    ),
    /matches 1 of 722 unique referenced paths.*at least 361 \(50%\)/i,
  );
  assert.deepEqual(target, before);
});

test("legacy recovery with exactly 361 of 722 matching paths reaches the threshold", () => {
  const source = migrateData(null);
  source.manualIndexPaths = Array.from({ length: 722 }, (_, index) => `03 Clinical Topics/Legacy ${index}.md`);
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main-vault", "base-ent", "ENT");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  const target = migrateData(null);
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: modern.exportedAt,
    sourceWorkspace: "",
    components: { recovery: parsePersonalBackup(legacy) },
  };

  applyPortableExport(
    target,
    value,
    portableSelection({ recovery: true }),
    "replace",
    "vault-my-main-note-kb",
    (path) => {
      const match = /Legacy (\d+)\.md$/.exec(path);
      return match ? Number(match[1]) < 361 : false;
    },
    "base-destination",
    "Destination",
    true,
  );
  assert.equal(target.manualIndexPaths.length, 722);
});

test("confirmed legacy recovery remains available at the at-least-half threshold", () => {
  const source = migrateData(null);
  source.manualIndexPaths = ["Knowledge Base/Found.md", "Knowledge Base/Missing.md"];
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-source", "base-source", "Source");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  const parsedLegacy = parsePersonalBackup(legacy);
  const target = migrateData(null);
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: modern.exportedAt,
    sourceWorkspace: "",
    components: { recovery: parsedLegacy },
  };

  applyPortableExport(
    target,
    value,
    portableSelection({ recovery: true }),
    "replace",
    "vault-destination",
    (path) => path === "Knowledge Base/Found.md",
    "base-destination",
    "Destination",
    true,
  );
  assert.deepEqual(target.manualIndexPaths, source.manualIndexPaths);
});

test("confirmed path-free legacy recovery does not require a path preflight", () => {
  const source = migrateData(null);
  source.savedViews = [{ id: "review", name: "Review", tab: "curriculum", query: "larynx" }];
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-source", "base-source", "Source");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  const value: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: modern.exportedAt,
    sourceWorkspace: "",
    components: { recovery: parsePersonalBackup(legacy) },
  };
  const target = migrateData(null);

  applyPortableExport(
    target,
    value,
    portableSelection({ recovery: true }),
    "replace",
    "vault-destination",
    undefined,
    "base-destination",
    "Destination",
    true,
  );
  assert.equal(target.savedViews[0]?.name, "Review");
});

test("portable serialization enforces the same 10 MB contract as import", () => {
  const value = portableFixture();
  value.sourceWorkspace = "x".repeat(11 * 1024 * 1024);
  assert.throws(() => serializePortableExport(value), /above the 10 MB/i);
});

test("portable serialization rejects generated packages the importer cannot read", () => {
  const invalidCollection = portableFixture();
  invalidCollection.components.collections = {
    version: 1,
    collections: [{
      id: "legacy collection",
      title: "Legacy collection",
      collapsed: false,
      subjectIds: ["subject-cleft"],
      subheadings: [],
    }],
  };
  assert.throws(() => serializePortableExport(invalidCollection), /cannot be safely re-imported.*unsupported characters/i);

  const oversizedTitle = portableFixture();
  assert.ok(oversizedTitle.components.index);
  oversizedTitle.components.index.subjects[0].title = "x".repeat(1_001);
  assert.throws(() => serializePortableExport(oversizedTitle), /cannot be safely re-imported.*too long/i);

  const oversizedQuery = portableFixture();
  oversizedQuery.components.savedViews = {
    version: 1,
    views: [{ id: "view-long", name: "Long query", tab: "curriculum", query: "x".repeat(10_001) }],
  };
  assert.throws(() => serializePortableExport(oversizedQuery), /cannot be safely re-imported.*query is too long/i);
});

test("registry synchronization clears stale inactive bindings and remains linear", () => {
  const data = migrateData(null);
  const count = 10_000;
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: Array.from({ length: count }, (_, index) => ({
      id: `subject-${index}`,
      title: `Subject ${index}`,
      groupId: "group-airway",
      parentId: null,
      order: index,
      indexed: true,
      configuredId: "",
      recordKind: "topic" as const,
    })),
    resolvedPathBySubjectId: Object.fromEntries(Array.from({ length: count }, (_, index) => [`subject-${index}`, `Archive/Subject ${index}.md`])),
  };
  const staleRecords = Array.from({ length: count }, (_, index) => record({
    path: `Archive/Subject ${index}.md`,
    title: `Subject ${index}`,
    kind: "note",
    role: "vault-note",
    curriculumId: "",
  }));
  const start = performance.now();
  synchronizePortableRegistry(data, staleRecords);
  const elapsed = performance.now() - start;
  assert.equal(data.portableIndex.subjects.length, 0);
  assert.deepEqual(data.portableIndex.resolvedPathBySubjectId, {});
  assert.ok(elapsed < 500, `synchronizing 10,000 inactive subjects took ${elapsed.toFixed(1)} ms`);
});

test("portable dispatcher accepts legacy workspace configurations and personal backups", () => {
  const data = migrateData(null);
  data.settings.workspaceName = "Legacy Workspace";
  data.collections = [{ id: "legacy", title: "Legacy collection", collapsed: false, subjects: ["Legacy/Note.md"], subheadings: [] }];
  const exportedAt = "2026-08-08T00:00:00.000Z";

  const workspace = parseAnyCommandCenterExport(
    JSON.parse(JSON.stringify(createWorkspaceConfig(data, exportedAt))) as unknown,
  );
  assert.equal(workspace.kind, PORTABLE_EXPORT_KIND);
  assert.equal(workspace.components.workspace?.settings.workspaceName, "Legacy Workspace");
  assert.equal(workspace.components.index, undefined);

  const recovery = parseAnyCommandCenterExport(
    JSON.parse(JSON.stringify(createPersonalBackup(data, exportedAt, "vault-ent-main", "base-ent", "ENT"))) as unknown,
  );
  assert.equal(recovery.kind, PORTABLE_EXPORT_KIND);
  assert.equal(recovery.components.recovery?.collections[0]?.title, "Legacy collection");
  assert.equal(recovery.components.workspace, undefined);
});

test("index diagnostics distinguish missing, duplicate, parent, and orphaned group issues", () => {
  const data = migrateData(null);
  data.manualIndexPaths = ["Missing.md"];
  data.collections = [{ id: "c", title: "Course", collapsed: false, subjects: ["topic.md", "topic.md"], subheadings: [] }];
  data.indexGroupByPath["orphan.md"] = "Orphaned";
  const topic = record({ path: "topic.md", parentTopic: "[[Missing Parent]]" });
  const diagnostics = buildIndexDiagnostics(data, [topic], new Set(["topic.md", "orphan.md"]));
  assert.deepEqual(new Set(diagnostics.map((item) => item.kind)), new Set(["missing-note", "duplicate-membership", "broken-parent", "orphaned-group"]));
});

test("disabled clinical visual groups retain valid latent cross-domain parent state", () => {
  const child = record({ path: "Child.md", domain: "Pediatric" });
  const parent = record({ path: "Parent.md", domain: "Laryngology" });
  const state = { parentByPath: { "Child.md": "Parent.md" }, orderByContainer: {} };
  const groups = { "Child.md": "Airway", "Parent.md": "Airway" };
  assert.equal(reconcileCurriculumVisual(state, [child, parent], groups), false);
  assert.equal(state.parentByPath["Child.md"], "Parent.md");
});

test("visual curriculum paths follow note renames", () => {
  const state = {
    parentByPath: { "child.md": "parent.md" },
    orderByContainer: { "parent:parent.md": ["child.md"], "root:pediatric": ["parent.md"] },
  };
  assert.equal(replaceCurriculumVisualPath(state, "parent.md", "renamed.md"), true);
  assert.equal(state.parentByPath["child.md"], "renamed.md");
  assert.deepEqual(state.orderByContainer["parent:renamed.md"], ["child.md"]);
  assert.deepEqual(state.orderByContainer["root:pediatric"], ["renamed.md"]);
});

test("visual group override keys follow note renames", () => {
  const groups = { "old.md": "Research" };
  assert.equal(replacePathMapKey(groups, "old.md", "new.md"), true);
  assert.deepEqual(groups, { "new.md": "Research" });
  assert.equal(replacePathMapKey(groups, "missing.md", "other.md"), false);
});

test("reset restores canonical parent and sibling ordering", () => {
  const state = {
    parentByPath: { "child.md": "custom-parent.md" },
    orderByContainer: { "parent:custom-parent.md": ["sibling.md", "child.md"] },
  };
  resetCurriculumVisualPath(state, "child.md");
  assert.equal("child.md" in state.parentByPath, false);
  assert.equal("parent:custom-parent.md" in state.orderByContainer, false);
});

test("row keyboard shortcuts only run from the row itself", () => {
  assert.equal(shouldHandleRowShortcut(true, "Enter"), true);
  assert.equal(shouldHandleRowShortcut(false, "Enter"), false);
  assert.equal(shouldHandleRowShortcut(false, "m"), false);
  assert.equal(shouldHandleRowShortcut(true, "Escape"), false);
});

test("versionless modern data is preserved instead of being mistaken for legacy ENT data", () => {
  for (const version of [undefined, 0, -1, Number.NaN]) {
    const data = migrateData({
      version,
      collections: [{ id: "research", title: "Research", collapsed: false, subjects: ["Notes/Paper.md"], subheadings: [] }],
      pinnedPaths: ["Notes/Paper.md"],
      settings: { workspaceMode: "generic", workspaceName: "My research KB", setupComplete: true },
    });
    assert.equal(data.version, 10);
    assert.equal(data.settings.workspaceMode, "generic");
    assert.equal(data.settings.workspaceName, "My research KB");
    assert.equal(data.collections[0]?.title, "Research");
    assert.deepEqual(data.pinnedPaths, ["Notes/Paper.md"]);
  }
  assert.equal(isRecognizedPluginData({ unrelated: true }), false);
  assert.equal(isRecognizedPluginData({ settings: { workspaceMode: "generic" } }), true);
});

test("folder renames rewrite every descendant reference, including snapshots and collapse state", () => {
  const data = migrateData(null);
  data.collections = [{ id: "c", title: "C", collapsed: false, subjects: ["Old/One.md"], subheadings: [{ id: "s", title: "S", collapsed: false, subjects: ["Old/Nested/Two.md"] }] }];
  data.pinnedPaths = ["Old/One.md"];
  data.nextStudyPaths = ["Old/Nested/Two.md"];
  data.manualIndexPaths = ["Old/One.md"];
  data.excludedIndexPaths = ["Old/Nested/Two.md"];
  data.indexGroupByPath = { "Old/One.md": "Research" };
  data.curriculumVisual = { parentByPath: { "Old/Nested/Two.md": "Old/One.md" }, orderByContainer: { "parent:Old/One.md": ["Old/Nested/Two.md"] } };
  data.selectedPath = "Old/Nested/Two.md";
  data.collapsed.curriculumNodes = ["Old/One.md"];
  data.undoStack = [snapshotPersonal(data, "Before")];
  assert.equal(rewritePluginDataPathPrefix(data, "Old", "New"), true);
  assert.deepEqual(data.collections[0]?.subjects, ["New/One.md"]);
  assert.deepEqual(data.collections[0]?.subheadings[0]?.subjects, ["New/Nested/Two.md"]);
  assert.equal(data.curriculumVisual.parentByPath["New/Nested/Two.md"], "New/One.md");
  assert.deepEqual(data.curriculumVisual.orderByContainer["parent:New/One.md"], ["New/Nested/Two.md"]);
  assert.equal(data.selectedPath, "New/Nested/Two.md");
  assert.deepEqual(data.collapsed.curriculumNodes, ["New/One.md"]);
  assert.deepEqual(data.undoStack[0]?.pinnedPaths, ["New/One.md"]);
});

test("direct-child folder renames migrate folder-derived groups through nested history", () => {
  const data = migrateData(null);
  data.settings.primaryFolder = "Knowledge Base";
  data.settings.templatesFolder = "Knowledge Base/Old Group/Templates";
  data.indexGroupAliases = { "Old Group": "Curated Airway" };
  data.indexGroupOrder = ["Old Group", "Curated Airway", "Other"];
  data.curriculumVisual.orderByContainer = {
    [curriculumContainerKey("Old Group", null)]: ["Knowledge Base/Old Group/Legacy.md"],
    [curriculumContainerKey("Curated Airway", null)]: ["Knowledge Base/Old Group/Current.md"],
  };
  data.collapsed.curriculumDomains = ["Old Group", "Curated Airway"];
  data.portableIndex = {
    version: 1,
    groups: [
      { id: "group-old", title: "Old Group", order: 0 },
      { id: "group-curated", title: "Curated Airway", order: 1 },
    ],
    subjects: [{
      id: "subject",
      title: "Topic",
      groupId: "group-old",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };

  const history = snapshotPersonal(data, "Historical state", true, true);
  history.indexGroupAliases = {};
  history.indexGroupOrder = ["Old Group", "Other"];
  history.curriculumVisual.orderByContainer = {
    [curriculumContainerKey("Old Group", null)]: ["Knowledge Base/Old Group/Historical.md"],
  };
  if (history.portableIndex) {
    history.portableIndex.groups = [{ id: "history-group", title: "Old Group", order: 0 }];
    history.portableIndex.subjects[0].groupId = "history-group";
  }
  const nested = structuredClone(history);
  nested.label = "Nested historical state";
  nested.indexGroupAliases = { "Old Group": "Nested display" };
  nested.indexGroupOrder = ["Old Group", "Nested display"];
  nested.curriculumVisual.orderByContainer = {
    [curriculumContainerKey("Old Group", null)]: ["Knowledge Base/Old Group/Nested.md"],
  };
  nested.layoutSnapshots = undefined;
  history.layoutSnapshots = [nested];
  data.layoutSnapshots = [structuredClone(history)];
  data.undoStack = [structuredClone(history)];
  data.redoStack = [structuredClone(history)];

  assert.equal(rewritePluginDataFolderRename(
    data,
    "Knowledge Base/Old Group",
    "Knowledge Base/New Group",
  ), true);

  assert.deepEqual(data.indexGroupAliases, {
    "Old Group": "Curated Airway",
    "New Group": "Curated Airway",
  });
  assert.deepEqual(data.indexGroupOrder, ["Old Group", "Curated Airway", "Other"]);
  assert.deepEqual(data.curriculumVisual.orderByContainer[curriculumContainerKey("Curated Airway", null)], [
    "Knowledge Base/Old Group/Current.md",
    "Knowledge Base/Old Group/Legacy.md",
  ]);
  assert.deepEqual(data.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)], [
    "Knowledge Base/Old Group/Legacy.md",
  ]);
  assert.deepEqual(data.collapsed.curriculumDomains, ["Old Group", "Curated Airway"]);
  assert.deepEqual(data.portableIndex.groups.map((group) => [group.id, group.title]), [
    ["group-old", "Old Group"],
    ["group-curated", "Curated Airway"],
  ]);
  assert.equal(data.portableIndex.subjects[0]?.groupId, "group-old");
  assert.equal(data.settings.templatesFolder, "Knowledge Base/New Group/Templates");

  for (const stack of [data.layoutSnapshots, data.undoStack, data.redoStack]) {
    const saved = stack[0];
    assert.deepEqual(saved?.indexGroupAliases, {});
    assert.deepEqual(saved?.indexGroupOrder, ["Old Group", "New Group", "Other"]);
    assert.deepEqual(saved?.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)], [
      "Knowledge Base/Old Group/Historical.md",
    ]);
    assert.deepEqual(saved?.curriculumVisual.orderByContainer[curriculumContainerKey("New Group", null)], [
      "Knowledge Base/Old Group/Historical.md",
    ]);
    assert.equal(saved?.portableIndex?.groups[0]?.title, "Old Group");
    assert.equal(saved?.settings?.templatesFolder, "Knowledge Base/New Group/Templates");
    const savedNested = saved?.layoutSnapshots?.[0];
    assert.deepEqual(savedNested?.indexGroupAliases, {
      "Old Group": "Nested display",
      "New Group": "Nested display",
    });
    assert.deepEqual(savedNested?.indexGroupOrder, ["Old Group", "Nested display"]);
    assert.deepEqual(savedNested?.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)], [
      "Knowledge Base/Old Group/Nested.md",
    ]);
    assert.deepEqual(savedNested?.curriculumVisual.orderByContainer[curriculumContainerKey("Nested display", null)], [
      "Knowledge Base/Old Group/Nested.md",
    ]);
  }
});

test("folder renames rewrite all path-valued settings recursively without treating nested folders as groups", () => {
  const data = migrateData(null);
  data.settings.primaryFolder = "Vault Root/Knowledge";
  data.settings.proposalFolder = "Vault Root/Inbox/Proposals";
  data.settings.templatesFolder = "Vault Root/Templates";
  data.settings.defaultNoteFolder = "Vault Root/Knowledge/Inbox";
  data.settings.defaultTemplatePath = "Vault Root/Templates/Topic.md";
  data.indexGroupAliases = { Knowledge: "Study index" };
  data.indexGroupOrder = ["Study index"];
  const history = snapshotPersonal(data, "Saved settings", true);
  const nested = snapshotPersonal(data, "Nested settings", true);
  nested.layoutSnapshots = undefined;
  history.layoutSnapshots = [nested];
  data.undoStack = [history];

  assert.equal(rewritePluginDataFolderRename(data, "Vault Root", "Renamed Root"), true);
  for (const settings of [data.settings, data.undoStack[0]?.settings, data.undoStack[0]?.layoutSnapshots?.[0]?.settings]) {
    assert.equal(settings?.primaryFolder, "Renamed Root/Knowledge");
    assert.equal(settings?.proposalFolder, "Renamed Root/Inbox/Proposals");
    assert.equal(settings?.templatesFolder, "Renamed Root/Templates");
    assert.equal(settings?.defaultNoteFolder, "Renamed Root/Knowledge/Inbox");
    assert.equal(settings?.defaultTemplatePath, "Renamed Root/Templates/Topic.md");
  }
  assert.deepEqual(data.indexGroupAliases, { Knowledge: "Study index" });
  assert.deepEqual(data.indexGroupOrder, ["Study index"]);

  const beforeNestedFolderRename = structuredClone(data.indexGroupAliases);
  assert.equal(rewritePluginDataFolderRename(
    data,
    "Renamed Root/Knowledge/Nested",
    "Renamed Root/Knowledge/Renamed Nested",
  ), false);
  assert.deepEqual(data.indexGroupAliases, beforeNestedFolderRename);
});

test("clinical folder-derived groups use the normalized direct-child domain name", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.indexGroupAliases = { Pediatric: "Children's airway" };
  data.indexGroupOrder = ["Children's airway"];

  assert.equal(rewritePluginDataFolderRename(
    data,
    "03 Clinical Topics/01 Pediatric",
    "03 Clinical Topics/02 Pediatric Airway",
  ), true);
  assert.deepEqual(data.indexGroupAliases, {
    Pediatric: "Children's airway",
    "Pediatric Airway": "Children's airway",
  });
  assert.deepEqual(data.indexGroupOrder, ["Children's airway"]);
});

test("folder renames always preserve old group aliases and portable identity", () => {
  const data = migrateData(null);
  data.settings.primaryFolder = "Knowledge Base";
  data.settings.templatesFolder = "Knowledge Base/Old Group/Templates";
  data.indexGroupAliases = { "Old Group": "Display group" };
  data.indexGroupOrder = ["Display group", "Other"];
  data.curriculumVisual.orderByContainer = {
    [curriculumContainerKey("Old Group", null)]: ["Knowledge Base/Old Group/Topic.md"],
  };
  data.collapsed.curriculumDomains = ["Old Group"];
  data.portableIndex = {
    version: 1,
    groups: [{ id: "stable-old-group", title: "Old Group", order: 0 }],
    subjects: [{
      id: "stable-subject",
      title: "Explicit topic",
      groupId: "stable-old-group",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  data.undoStack = [snapshotPersonal(data, "Before rename", true, true)];

  assert.equal(rewritePluginDataFolderRename(
    data,
    "Knowledge Base/Old Group",
    "Knowledge Base/New Group",
  ), true);

  assert.deepEqual(data.indexGroupAliases, {
    "Old Group": "Display group",
    "New Group": "Display group",
  });
  assert.deepEqual(data.indexGroupOrder, ["Display group", "Other"]);
  assert.deepEqual(data.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)], [
    "Knowledge Base/Old Group/Topic.md",
  ]);
  assert.deepEqual(data.curriculumVisual.orderByContainer[curriculumContainerKey("Display group", null)], [
    "Knowledge Base/Old Group/Topic.md",
  ]);
  assert.deepEqual(data.collapsed.curriculumDomains, ["Old Group", "Display group"]);
  assert.deepEqual(data.portableIndex.groups, [{ id: "stable-old-group", title: "Old Group", order: 0 }]);
  assert.equal(data.portableIndex.subjects[0]?.groupId, "stable-old-group");
  assert.equal(data.settings.templatesFolder, "Knowledge Base/New Group/Templates");

  const history = data.undoStack[0];
  assert.deepEqual(history?.indexGroupAliases, {
    "Old Group": "Display group",
    "New Group": "Display group",
  });
  assert.deepEqual(history?.portableIndex?.groups, [{ id: "stable-old-group", title: "Old Group", order: 0 }]);
  assert.equal(history?.portableIndex?.subjects[0]?.groupId, "stable-old-group");
  assert.equal(rewritePluginDataFolderRename(
    data,
    "Knowledge Base/Old Group",
    "Knowledge Base/New Group",
  ), false, "replaying the same conservative migration is idempotent");
});

test("file renames update the configured template path through nested history only", () => {
  const data = migrateData(null);
  data.settings.primaryFolder = "Templates/Old topic.md";
  data.settings.templatesFolder = "Templates";
  data.settings.defaultTemplatePath = "Templates/Old topic.md";
  const history = snapshotPersonal(data, "Template settings", true);
  history.layoutSnapshots = [snapshotPersonal(data, "Nested template settings", true)];
  data.layoutSnapshots = [structuredClone(history)];
  data.undoStack = [structuredClone(history)];
  data.redoStack = [structuredClone(history)];

  assert.equal(rewritePluginDataTemplatePathRename(
    data,
    "Templates/Old topic.md",
    "Templates/New topic.md",
  ), true);

  for (const settings of [
    data.settings,
    ...[data.layoutSnapshots, data.undoStack, data.redoStack]
      .flatMap((stack) => [stack[0]?.settings, stack[0]?.layoutSnapshots?.[0]?.settings]),
  ]) {
    assert.equal(settings?.defaultTemplatePath, "Templates/New topic.md");
    assert.equal(settings?.primaryFolder, "Templates/Old topic.md");
    assert.equal(settings?.templatesFolder, "Templates");
  }
});

test("custom canonical roots follow a renamed ENT primary folder", () => {
  const value = {
    title: "Laryngeal cleft",
    domain: "Pediatric",
    curriculumId: "ENT-PED-003.05",
  };
  assert.equal(
    canonicalPath(value, "Renamed Clinical Topics"),
    "Renamed Clinical Topics/01 Pediatric/ENT-PED-003.05 - Laryngeal cleft.md",
  );

  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.defaultNoteFolder = "03 Clinical Topics/01 Pediatric";
  const history = snapshotPersonal(data, "Clinical settings", true);
  history.layoutSnapshots = [snapshotPersonal(data, "Nested clinical settings", true)];
  data.undoStack = [history];

  assert.equal(rewritePluginDataFolderRename(data, "03 Clinical Topics", "Renamed Clinical Topics"), true);
  for (const settings of [data.settings, data.undoStack[0]?.settings, data.undoStack[0]?.layoutSnapshots?.[0]?.settings]) {
    assert.equal(settings?.primaryFolder, "Renamed Clinical Topics");
    assert.equal(settings?.defaultNoteFolder, "Renamed Clinical Topics/01 Pediatric");
    assert.equal(canonicalPath(value, settings?.primaryFolder), "Renamed Clinical Topics/01 Pediatric/ENT-PED-003.05 - Laryngeal cleft.md");
  }
});

test("search, templates, filenames, and protected folders handle international and hostile input", () => {
  assert.equal(matchesQuery(record({ title: "Café airway", aliases: ["مجرى الهواء", "喉頭裂"] }), "cafe"), true);
  assert.equal(matchesQuery(record({ title: "Café airway", aliases: ["مجرى الهواء", "喉頭裂"] }), "مجرى"), true);
  assert.equal(matchesQuery(record({ title: "Café airway", aliases: ["مجرى الهواء", "喉頭裂"] }), "喉頭"), true);
  assert.equal(applyTemplateTokens("# {{title}}", "$& $` $' $$", "2026-01-01", "12:00"), "# $& $` $' $$");
  assert.equal(sanitizeFileName("safe\u202E\u200B\u0000:name"), "safe-name");
  for (const path of [".OBSIDIAN/plugins", ".obsidian /plugins", ".trash", ".TRASH/archive"]) {
    assert.notEqual(validateWritableFolderPath(path, ".obsidian"), null, path);
  }
  assert.notEqual(validateWritableFolderPath("Projects/ .. /Archive", ".obsidian"), null);
  for (const path of [
    "01 Inbox/../.obsidian/plugins",
    "01 Inbox/./Drafts",
    "01 Inbox/ .. /.obsidian/plugins",
    "01 Inbox/ . /Drafts",
  ]) {
    assert.notEqual(validateProposalFolderPath(path, ".obsidian"), null, path);
  }
  assert.equal(validateTemplateFilePath("Templates/Topic.md", "Templates", ".obsidian"), null);
  assert.equal(validateTemplateFilePath("Notes/Topic.md", "", ".obsidian"), null);
  for (const path of [".obsidian/plugins/template.md", "05 Sources/_books/Book/page.md", "Notes/Not a template.md"]) {
    assert.notEqual(validateTemplateFilePath(path, "Templates", ".obsidian"), null, path);
  }
});

test("imported path maps discard prototype keys", () => {
  const data = migrateData({
    collections: [],
    settings: { workspaceMode: "generic" },
    indexGroupByPath: JSON.parse('{"__proto__":"x","constructor":"y","prototype":"z","safe.md":"Research"}') as unknown,
    curriculumVisual: {
      parentByPath: JSON.parse('{"__proto__":"x","safe.md":null}') as unknown,
      orderByContainer: JSON.parse('{"constructor":["bad.md"],"root:Research":["safe.md"]}') as unknown,
    },
  });
  assert.deepEqual(Object.keys(data.indexGroupByPath), ["safe.md"]);
  assert.deepEqual(Object.keys(data.curriculumVisual.parentByPath), ["safe.md"]);
  assert.deepEqual(Object.keys(data.curriculumVisual.orderByContainer), ["root:Research"]);
});

test("group aliases reject reserved object keys while preserving ordinary source headings", () => {
  for (const key of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
    assert.equal(isSafeObjectKey(key), false, key);
  }
  assert.equal(isSafeObjectKey("ENT / Pediatric"), true);

  const data = migrateData({
    version: 10,
    indexGroupAliases: JSON.parse(
      '{"__proto__":"Proto","constructor":"Constructor","prototype":"Prototype","toString":"String","hasOwnProperty":"Own","Pediatric":"Children"}',
    ) as unknown,
  });
  assert.deepEqual(data.indexGroupAliases, { Pediatric: "Children" });
});

test("diagnostics and visual-placement indexes remain linear at large-vault scale", () => {
  const data = migrateData(null);
  const records = Array.from({ length: 10_000 }, (_, index) => record({
    path: `Knowledge Base/Topic ${index}.md`,
    title: `Topic ${index}`,
    curriculumId: "",
    role: "supporting",
    parentTopic: index === 0 ? "" : `[[Topic ${index - 1}]]`,
  }));
  const paths = new Set(records.map((item) => item.path));
  const start = performance.now();
  const diagnostics = buildIndexDiagnostics(data, records, paths);
  const diagnosticMs = performance.now() - start;
  assert.deepEqual(diagnostics.map((item) => item.kind), ["depth-limit"]);
  assert.ok(diagnosticMs < 1_000, `diagnostics took ${diagnosticMs.toFixed(1)} ms`);

  const state = { parentByPath: {} as Record<string, string | null>, orderByContainer: { "root:Research": records.map((item) => item.path) } };
  for (let index = 1; index < records.length; index += 1) state.parentByPath[records[index]?.path ?? ""] = records[index - 1]?.path ?? null;
  const placementStart = performance.now();
  const placed = visualPlacementPathSet(state, Object.fromEntries(records.map((item) => [item.path, "Research"])));
  const placementMs = performance.now() - placementStart;
  assert.equal(placed.size, records.length);
  assert.ok(placementMs < 500, `visual placement index took ${placementMs.toFixed(1)} ms`);
});

test("snapshot history is bounded by count and serialized size", () => {
  const data = migrateData(null);
  const snapshots = Array.from({ length: 50 }, (_, index) => snapshotPersonal(data, `Snapshot ${index}`));
  const limited = limitSnapshotStack(snapshots, 10, 8_000);
  assert.ok(limited.length <= 10);
  assert.ok(JSON.stringify(limited).length <= 8_000);
  assert.equal(limited.at(-1)?.label, "Snapshot 49");
  const oversized = snapshotPersonal(data, "Oversized");
  oversized.pinnedPaths = ["x".repeat(20_000)];
  const preserved = limitSnapshotStack([...limited, oversized], 10, 8_000);
  assert.equal(preserved.includes(oversized), false);
  assert.equal(preserved.at(-1)?.label, "Snapshot 49");
});

test("ordinary Undo snapshots stay lean after a large portable registry is allocated", () => {
  const data = migrateData(null);
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-large", title: "Large", order: 0 }],
    subjects: Array.from({ length: 10_000 }, (_, index) => ({
      id: `subject-${index}`,
      title: `Subject ${index}`,
      groupId: "group-large",
      parentId: null,
      order: index,
      indexed: true,
      configuredId: "",
      recordKind: "topic" as const,
    })),
    resolvedPathBySubjectId: {},
  };
  const ordinary = snapshotPersonal(data, "Collection change");
  const portable = snapshotPersonal(data, "Portable import", false, true);
  assert.equal(ordinary.portableIndex, undefined);
  assert.ok(JSON.stringify(ordinary).length < MAX_UNDO_BYTES);
  assert.equal(portable.portableIndex?.subjects.length, 10_000);
  assert.equal(limitSnapshotStack([portable]).length, 1, "one large portable-state Undo uses the bounded import budget");
});

test("renaming paths invalidates cached snapshot sizes and re-applies the byte budget", () => {
  const data = migrateData(null);
  data.pinnedPaths = ["Old/Note.md"];
  const snapshot = snapshotPersonal(data, "Before rename");
  data.undoStack = [snapshot];
  assert.equal(limitSnapshotStack(data.undoStack).length, 1); // warm the WeakMap cache

  const oversizedPrefix = `New-${"x".repeat(MAX_UNDO_BYTES)}`;
  assert.equal(rewritePluginDataPathPrefix(data, "Old", oversizedPrefix), true);
  assert.equal(data.undoStack.length, 0);
  assert.ok(JSON.stringify(snapshot).length > MAX_UNDO_BYTES);
});

test("filenames drop characters that would break an Obsidian wikilink", () => {
  // `#^[]` are filesystem-legal, so they used to survive into note names and
  // produce wikilinks such as [[KB/Array [1]]] that Obsidian cannot resolve.
  assert.equal(sanitizeFileName("Array [1]"), "Array -1-");
  assert.equal(sanitizeFileName("C# Notes"), "C- Notes");
  assert.equal(sanitizeFileName("caret^power"), "caret-power");
  const path = genericNotePath("KB", "Array [1]");
  assert.equal(path, "KB/Array -1-.md");
  const wikilink = `[[${path.replace(/\.md$/i, "")}]]`;
  assert.equal(/[[\]#^]/.test(wikilink.slice(2, -2)), false, wikilink);
  // Unicode, emoji and RTL content must still survive untouched.
  assert.equal(sanitizeFileName("Ünïcödé عربي 日本語 🎉"), "Ünïcödé عربي 日本語 🎉");
});

test("reserved Windows device names never become bare note filenames", () => {
  for (const reserved of ["CON", "prn", "AUX", "NUL", "COM1", "lpt9"]) {
    assert.equal(sanitizeFileName(reserved), `${reserved}-note`, reserved);
  }
  assert.equal(sanitizeFileName("CONSOLE"), "CONSOLE");
  assert.equal(sanitizeFileName("COM10"), "COM10");
});

test("a parsed query matches identically to the string form but is reusable", () => {
  const target = record({ title: "Café airway", aliases: ["مجرى الهواء"] });
  for (const query of ["cafe", "مجرى", "priority:P1", "priority:P3", "domain:pediatric cafe", ""]) {
    const parsed = parseQuery(query);
    assert.equal(matchesParsedQuery(target, parsed), matchesQuery(target, query), query);
    // Reusing one parsed query across many records must be stateless.
    assert.equal(matchesParsedQuery(target, parsed), matchesQuery(target, query), `${query} (second use)`);
  }
});

test("search stays responsive across a ten-thousand record render pass", () => {
  const records = Array.from({ length: 10_000 }, (_, index) => record({
    path: `Knowledge Base/Group ${index % 20}/Note ${index}.md`,
    title: `Sample note ${index} with Ünïcödé and عربي text`,
    aliases: [`alias ${index}`],
  }));
  const parsed = parseQuery("sample uni");
  const start = performance.now();
  // renderCurriculum evaluates each node for filtering, counting and rendering.
  let matched = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    for (const item of records) if (matchesParsedQuery(item, parsed)) matched += 1;
  }
  const elapsed = performance.now() - start;
  assert.equal(matched, records.length * 3);
  assert.ok(elapsed < 250, `three match passes over 10,000 records took ${elapsed.toFixed(1)} ms`);
});

test("the curriculum tree exposes cached child and descendant lookups", () => {
  const records = [
    record({ path: "KB/root.md", title: "Root", curriculumId: "", role: "supporting", parentTopic: "" }),
    record({ path: "KB/child-a.md", title: "Child A", curriculumId: "", role: "supporting", parentTopic: "[[root]]" }),
    record({ path: "KB/child-b.md", title: "Child B", curriculumId: "", role: "supporting", parentTopic: "[[root]]" }),
    record({ path: "KB/grandchild.md", title: "Grandchild", curriculumId: "", role: "supporting", parentTopic: "[[child-a]]" }),
  ];
  const tree = buildCurriculumTree(records, { parentByPath: {}, orderByContainer: {} });
  assert.deepEqual(curriculumChildPaths(tree, "KB/root.md").sort(), ["KB/child-a.md", "KB/child-b.md"]);
  assert.deepEqual(curriculumChildPaths(tree, "KB/child-a.md"), ["KB/grandchild.md"]);
  assert.deepEqual(curriculumChildPaths(tree, "KB/grandchild.md"), []);
  assert.deepEqual([...curriculumDescendantPaths(tree, "KB/root.md")].sort(), ["KB/child-a.md", "KB/child-b.md", "KB/grandchild.md"]);
  assert.deepEqual([...curriculumDescendantPaths(tree, "KB/child-b.md")], []);
  assert.deepEqual(curriculumSiblingPaths(tree, records[3]), ["KB/grandchild.md"]);
  assert.equal(tree.nodeByPath.get("KB/root.md")?.record.title, "Root");
});

test("descendant lookup terminates on a cyclic override instead of hanging", () => {
  const records = [
    record({ path: "KB/a.md", title: "A", curriculumId: "", role: "supporting", parentTopic: "" }),
    record({ path: "KB/b.md", title: "B", curriculumId: "", role: "supporting", parentTopic: "" }),
  ];
  const tree = buildCurriculumTree(records, {
    parentByPath: { "KB/a.md": "KB/b.md", "KB/b.md": "KB/a.md" },
    orderByContainer: {},
  });
  const descendants = curriculumDescendantPaths(tree, "KB/a.md");
  assert.ok(descendants.size <= records.length);
  assert.equal(descendants.has("KB/a.md"), false);
});

test("bounded snapshot history reports when the byte budget truncated it", () => {
  const data = migrateData(null);
  const small = Array.from({ length: 4 }, (_, index) => snapshotPersonal(data, `Small ${index}`));
  const keptSmall = limitSnapshotStack(small, 10, 64_000);
  assert.equal(keptSmall.length, small.length);
  assert.equal(snapshotStackDepthIsTruncated(small, keptSmall, 10), false);

  const bulky = Array.from({ length: 6 }, (_, index) => {
    const snapshot = snapshotPersonal(data, `Bulky ${index}`);
    snapshot.pinnedPaths = [`${"x".repeat(2_000)}${index}`];
    return snapshot;
  });
  const keptBulky = limitSnapshotStack(bulky, 10, 5_000);
  assert.ok(keptBulky.length < bulky.length);
  assert.equal(snapshotStackDepthIsTruncated(bulky, keptBulky, 10), true);
  assert.equal(keptBulky.at(-1)?.label, "Bulky 5");
});

test("repeated bounded-history recalculation does not re-serialize every snapshot", () => {
  const data = migrateData(null);
  data.collections = Array.from({ length: 20 }, (_, index) => ({
    id: `c${index}`,
    title: `Collection ${index}`,
    collapsed: false,
    subjects: Array.from({ length: 200 }, (_, item) => `Knowledge Base/Note ${index * 200 + item}.md`),
    subheadings: [],
  }));
  const stack = Array.from({ length: 20 }, (_, index) => snapshotPersonal(data, `Snapshot ${index}`));
  limitSnapshotStack(stack); // warms the per-snapshot size cache
  const start = performance.now();
  for (let index = 0; index < 20; index += 1) limitSnapshotStack(stack);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 100, `twenty bounded-history recalculations took ${elapsed.toFixed(1)} ms`);
});

test("library grouping keeps every record, including records without a group", () => {
  const records = [
    record({ path: "KB/a.md", title: "A", domain: "" }),
    record({ path: "KB/b.md", title: "B", domain: "" }),
    record({ path: "KB/c.md", title: "C", domain: "" }),
    record({ path: "KB/d.md", title: "D", domain: "Otology" }),
  ];
  const groups = groupRecordsByGroup(records, "Procedures");
  const grouped: VaultRecord[] = [];
  for (const bucket of groups.values()) grouped.push(...bucket);
  // A read key of "Other" with a write key of the fallback used to discard all
  // but the last ungrouped record while still reporting the full count.
  assert.equal(grouped.length, records.length);
  assert.deepEqual(grouped.map((item) => item.title).sort(), ["A", "B", "C", "D"]);
  assert.deepEqual(groups.get("Procedures")?.map((item) => item.title), ["A", "B", "C"]);
  assert.deepEqual(groups.get("Otology")?.map((item) => item.title), ["D"]);
});

test("library grouping stays linear when every record shares one group", () => {
  const records = Array.from({ length: 10_000 }, (_, index) => record({ path: `KB/${index}.md`, domain: "Otology" }));
  const start = performance.now();
  const groups = groupRecordsByGroup(records, "Other");
  const elapsed = performance.now() - start;
  assert.equal(groups.get("Otology")?.length, records.length);
  assert.ok(elapsed < 100, `grouping 10,000 same-group records took ${elapsed.toFixed(1)} ms`);
});

test("rewriting a note heading treats the title as literal text", () => {
  const content = "# Old Title\n\nbody text\n";
  // A plain replacement string expands these, corrupting the note.
  assert.equal(rewriteTopLevelHeading(content, "A $& B"), "# A $& B\n\nbody text\n");
  assert.equal(rewriteTopLevelHeading(content, "X $' Y"), "# X $' Y\n\nbody text\n");
  assert.equal(rewriteTopLevelHeading(content, "Y $` Z"), "# Y $` Z\n\nbody text\n");
  assert.equal(rewriteTopLevelHeading(content, "Cost $100"), "# Cost $100\n\nbody text\n");
  assert.equal(rewriteTopLevelHeading(content, "مجرى الهواء"), "# مجرى الهواء\n\nbody text\n");
  // Only the first top-level heading changes; body content is preserved.
  assert.equal(rewriteTopLevelHeading("# One\n\n# Two\n", "New"), "# New\n\n# Two\n");
  assert.equal(rewriteTopLevelHeading("no heading here\n", "New"), "no heading here\n");
});

test("a pathological parent chain degrades gracefully instead of exhausting the stack", () => {
  // Every note pointing at its predecessor is easy to produce by import or by a
  // parent-property convention. Recursive tree walking used to throw
  // RangeError: Maximum call stack size exceeded and leave the view blank.
  const records = Array.from({ length: 10_000 }, (_, index) => record({
    path: `Knowledge Base/Topic ${index}.md`,
    title: `Topic ${index}`,
    curriculumId: "",
    role: "supporting",
    domain: "Research",
    folderOrder: "0",
    parentTopic: index === 0 ? "" : `[[Topic ${index - 1}]]`,
  }));
  const start = performance.now();
  const tree = buildCurriculumTree(records, { parentByPath: {}, orderByContainer: {} });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 2_000, `building a 10,000 deep chain took ${elapsed.toFixed(1)} ms`);

  // Every record is still reachable, and no branch is nested past the cap.
  assert.equal(tree.nodeByPath.size, records.length);
  let deepest = 0;
  for (const record of records) {
    let depth = 0;
    let cursor = tree.parentByPath.get(record.path) ?? null;
    while (cursor) {
      depth += 1;
      assert.ok(depth <= MAX_CURRICULUM_DEPTH + 1, `chain below ${record.path} exceeded the depth cap`);
      cursor = tree.parentByPath.get(cursor) ?? null;
    }
    deepest = Math.max(deepest, depth);
  }
  assert.ok(deepest > 1, "expected the chain to still nest below the cap");
  assert.ok(deepest <= MAX_CURRICULUM_DEPTH + 1);
  assert.ok(tree.depthLimitedPaths.length > 0, "depth-limited records must be disclosed to the UI");

  // Descendant lookup over the capped tree also terminates.
  const descendants = curriculumDescendantPaths(tree, "Knowledge Base/Topic 0.md");
  assert.ok(descendants.size <= records.length);
});

test("a normal shallow hierarchy is untouched by the depth cap", () => {
  const records = [
    record({ path: "KB/a.md", title: "A", curriculumId: "", role: "supporting", domain: "G", parentTopic: "" }),
    record({ path: "KB/b.md", title: "B", curriculumId: "", role: "supporting", domain: "G", parentTopic: "[[a]]" }),
    record({ path: "KB/c.md", title: "C", curriculumId: "", role: "supporting", domain: "G", parentTopic: "[[b]]" }),
  ];
  const tree = buildCurriculumTree(records, { parentByPath: {}, orderByContainer: {} });
  assert.deepEqual(tree.depthLimitedPaths, []);
  assert.equal(tree.parentByPath.get("KB/b.md"), "KB/a.md");
  assert.equal(tree.parentByPath.get("KB/c.md"), "KB/b.md");
  assert.deepEqual([...curriculumDescendantPaths(tree, "KB/a.md")].sort(), ["KB/b.md", "KB/c.md"]);
});

test("unchanged canonical path inputs preserve a legacy filename after sanitization rules evolve", () => {
  const legacy = record({
    path: "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - VPI assessment surgery.md",
    title: "VPI: assessment / surgery",
    domain: "Laryngology",
    curriculumId: "ENT-LAR-010",
  });
  const unchanged = { title: " VPI: assessment / surgery ", domain: "Laryngology", curriculumId: "ent-lar-010" };
  assert.equal(canonicalPathInputsUnchanged(legacy, unchanged), true);
  assert.notEqual(canonicalPath(unchanged), legacy.path);
  assert.equal(canonicalPathInputsUnchanged(legacy, { ...unchanged, title: "VPI updated" }), false);
});

test("portable v2 declares every selected catalog while legacy v1 packages remain readable", () => {
  const source = migrateData(null);
  const medication = record({
    path: "Source/Medications/Salipax.md",
    title: "Salipax",
    kind: "medication",
    role: "library",
    domain: "Medications",
    curriculumId: "",
  });
  const current = createPortableExport(
    source,
    [medication],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  );

  assert.equal(current.version, 2);
  assert.equal(current.components.index?.version, 2);
  assert.deepEqual(current.components.index?.includedSections, {
    index: false,
    procedures: false,
    medications: true,
    syndromes: false,
  });
  assert.deepEqual(selectionAvailableForExport(parsePortableExport(structuredClone(current))), portableSelection({ medications: true }));

  const legacy = portableFixture();
  const parsedLegacy = parsePortableExport(structuredClone(legacy));
  assert.equal(parsedLegacy.version, 1);
  assert.equal(parsedLegacy.components.index?.version, 1);
  assert.equal(parsedLegacy.components.index?.includedSections, undefined);
  assert.deepEqual(selectionAvailableForExport(parsedLegacy), portableSelection({ index: true }));
});

test("a v1 medication dependency is not advertised as a full catalog and replace preserves unrelated medications", () => {
  const legacy: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "Legacy source",
    components: {
      index: {
        version: 1,
        groups: [{ id: "group-imported-medications", title: "Imported medications", order: 0 }],
        subjects: [{
          id: "subject-imported-medication",
          title: "Imported medication",
          groupId: "group-imported-medications",
          parentId: null,
          order: 0,
          indexed: false,
          configuredId: "",
          recordKind: "medication",
        }],
        includeIndex: false,
        indexGroupIds: [],
      },
      collections: {
        version: 1,
        collections: [{
          id: "collection-imported",
          title: "Imported collection",
          collapsed: false,
          subjectIds: ["subject-imported-medication"],
          subheadings: [],
        }],
      },
    },
  };
  const parsed = parsePortableExport(structuredClone(legacy));
  const available = selectionAvailableForExport(parsed);
  assert.equal(available.collections, true);
  assert.equal(available.index, false);
  assert.equal(available.medications, false);
  assert.throws(
    () => applyPortableExport(migrateData(null), parsed, portableSelection({ medications: true }), "replace"),
    /does not contain the selected medications component/i,
  );

  const target = migrateData(null);
  const localMedicationPath = "Knowledge Base/Local medication.md";
  target.portableIndex = {
    version: 1,
    groups: [{ id: "group-local-medications", title: "Local medications", order: 0 }],
    subjects: [{
      id: "subject-local-medication",
      title: "Local medication",
      groupId: "group-local-medications",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "medication",
    }],
    resolvedPathBySubjectId: { "subject-local-medication": localMedicationPath },
  };

  applyPortableExport(target, parsed, portableSelection({ collections: true }), "replace");

  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-local-medication"), true);
  assert.equal(target.portableIndex.resolvedPathBySubjectId["subject-local-medication"], localMedicationPath);
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-imported-medication"), true);
  assert.deepEqual(target.collections[0]?.subjects, [portablePlaceholderPath("subject-imported-medication")]);
});

test("a v2 collection-only export carries a medication solely as a referenced dependency", () => {
  const source = migrateData(null);
  const medication = record({
    path: "Source/Medications/Dependency.md",
    title: "Collection dependency",
    kind: "medication",
    role: "library",
    domain: "Medications",
    curriculumId: "",
  });
  source.collections = [{
    id: "collection-medication",
    title: "Medication reading",
    collapsed: false,
    subjects: [medication.path],
    subheadings: [],
  }];

  const exported = createPortableExport(
    source,
    [medication],
    portableSelection({ collections: true }),
    "2026-08-08T00:00:00.000Z",
  );
  const parsed = parsePortableExport(structuredClone(exported));
  const index = parsed.components.index;
  assert.ok(index);
  assert.deepEqual(index.includedSections, {
    index: false,
    procedures: false,
    medications: false,
    syndromes: false,
  });
  assert.deepEqual(index.subjects.map((subject) => subject.recordKind), ["medication"]);
  assert.deepEqual(selectionAvailableForExport(parsed), portableSelection({ collections: true }));

  const target = migrateData(null);
  const result = applyPortableExport(target, parsed, portableSelection({ collections: true }), "replace");
  assert.equal(result.addedSubjects, 1);
  assert.equal(result.unresolvedSubjects, 1);
  assert.equal(target.portableIndex.subjects[0]?.recordKind, "medication");
  assert.deepEqual(target.collections[0]?.subjects, [portablePlaceholderPath(index.subjects[0]?.id ?? "")]);
});

test("an explicitly selected empty medication catalog is available and replace clears only medications", () => {
  const source = migrateData(null);
  const emptyMedicationCatalog = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  ));
  assert.deepEqual(selectionAvailableForExport(emptyMedicationCatalog), portableSelection({ medications: true }));
  assert.deepEqual(emptyMedicationCatalog.components.index?.subjects, []);

  const target = migrateData(null);
  target.portableIndex = {
    version: 1,
    groups: [
      { id: "group-topics", title: "Topics", order: 0 },
      { id: "group-procedures", title: "Procedures", order: 1 },
      { id: "group-medications", title: "Medications", order: 2 },
      { id: "group-syndromes", title: "Syndromes", order: 3 },
    ],
    subjects: [
      { id: "subject-topic", title: "Topic", groupId: "group-topics", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "subject-procedure", title: "Procedure", groupId: "group-procedures", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "procedure" },
      { id: "subject-medication", title: "Medication", groupId: "group-medications", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
      { id: "subject-syndrome", title: "Syndrome", groupId: "group-syndromes", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "syndrome" },
    ],
    resolvedPathBySubjectId: {},
  };

  applyPortableExport(target, emptyMedicationCatalog, portableSelection({ medications: true }), "replace");

  assert.deepEqual(
    target.portableIndex.subjects.map((subject) => subject.recordKind).sort(),
    ["procedure", "syndrome", "topic"],
  );
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-medication"), false);
  assert.equal(target.portableIndex.groups.some((group) => group.id === "group-medications"), false);
});

test("portable v2 rejects missing, contradictory, and undeclared catalog provenance", () => {
  const source = migrateData(null);
  const medication = record({
    path: "Source/Medications/Medication.md",
    title: "Medication",
    kind: "medication",
    role: "library",
    domain: "Medications",
    curriculumId: "",
  });
  const valid = createPortableExport(
    source,
    [medication],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  );

  const missing = structuredClone(valid) as unknown as { components: { index: Record<string, unknown> } };
  delete missing.components.index.includedSections;
  assert.throws(() => parsePortableExport(missing), /must declare includedSections/i);

  const nonBoolean = structuredClone(valid) as unknown as {
    components: { index: { includedSections: Record<string, unknown> } };
  };
  nonBoolean.components.index.includedSections.medications = "yes";
  assert.throws(() => parsePortableExport(nonBoolean), /includedSections\.medications must be true or false/i);

  const contradictory = structuredClone(valid) as unknown as { components: { index: { includeIndex: boolean } } };
  contradictory.components.index.includeIndex = true;
  assert.throws(() => parsePortableExport(contradictory), /includeIndex conflicts/i);

  const undeclared = structuredClone(valid) as unknown as {
    components: { index: { includedSections: { medications: boolean } } };
  };
  undeclared.components.index.includedSections.medications = false;
  assert.throws(() => parsePortableExport(undeclared), /undeclared catalog/i);

  const illegalIndexGroup = structuredClone(valid) as unknown as {
    components: { index: { groups: Array<{ id: string }>; indexGroupIds: string[] } };
  };
  illegalIndexGroup.components.index.indexGroupIds = [illegalIndexGroup.components.index.groups[0]?.id ?? ""];
  assert.throws(() => parsePortableExport(illegalIndexGroup), /without the index blueprint cannot declare index groups/i);
});

test("selective import splits a shared group collision without changing the unselected topic and stays idempotent", () => {
  const incoming = parsePortableExport({
    kind: PORTABLE_EXPORT_KIND,
    version: 2,
    exportedAt: "2026-08-08T00:00:00.000Z",
    sourceWorkspace: "Source",
    components: {
      index: {
        version: 2,
        groups: [{ id: "group-shared", title: "Imported medicines", order: 0 }],
        subjects: [{
          id: "subject-imported-medication",
          title: "Imported medication",
          groupId: "group-shared",
          parentId: null,
          order: 0,
          indexed: false,
          configuredId: "",
          recordKind: "medication",
        }],
        includedSections: { index: false, procedures: false, medications: true, syndromes: false },
        includeIndex: false,
        indexGroupIds: [],
      },
    },
  });
  const target = migrateData(null);
  target.portableIndex = {
    version: 1,
    groups: [{ id: "group-shared", title: "Local topics", order: 0 }],
    subjects: [{
      id: "subject-local-topic",
      title: "Local topic",
      groupId: "group-shared",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };

  const first = applyPortableExport(target, incoming, portableSelection({ medications: true }), "replace");
  const importedAfterFirst = target.portableIndex.subjects.find((subject) => subject.id === "subject-imported-medication");
  assert.ok(importedAfterFirst);
  const splitGroupId = importedAfterFirst.groupId;
  assert.notEqual(splitGroupId, "group-shared");
  assert.equal(target.portableIndex.groups.find((group) => group.id === "group-shared")?.title, "Local topics");
  assert.equal(target.portableIndex.groups.find((group) => group.id === splitGroupId)?.title, "Imported medicines");
  assert.equal(target.portableIndex.subjects.find((subject) => subject.id === "subject-local-topic")?.groupId, "group-shared");
  assert.equal(first.addedSubjects, 1);

  const second = applyPortableExport(target, incoming, portableSelection({ medications: true }), "replace");
  assert.equal(second.addedSubjects, 0);
  assert.equal(second.matchedSubjects, 1);
  assert.equal(target.portableIndex.subjects.length, 2);
  assert.equal(target.portableIndex.groups.length, 2);
  assert.equal(target.portableIndex.subjects.find((subject) => subject.id === "subject-imported-medication")?.groupId, splitGroupId);
  assert.equal(target.portableIndex.groups.filter((group) => group.title === "Imported medicines").length, 1);
  assert.equal(target.portableIndex.groups.find((group) => group.id === "group-shared")?.title, "Local topics");
});

test("portable summaries count only selected catalogs while retaining selected organization dependencies", () => {
  const source = migrateData(null);
  const topic = record({ path: "Source/Topics/Topic.md", title: "Topic", domain: "Topics", curriculumId: "" });
  const procedure = record({ path: "Source/Procedures/Procedure.md", title: "Procedure", kind: "procedure", role: "library", domain: "Procedures", curriculumId: "" });
  const medication = record({ path: "Source/Medications/Medication.md", title: "Medication", kind: "medication", role: "library", domain: "Medications", curriculumId: "" });
  const syndrome = record({ path: "Source/Syndromes/Syndrome.md", title: "Syndrome", kind: "syndrome", role: "library", domain: "Syndromes", curriculumId: "" });
  source.collections = [{ id: "medications", title: "Medication reading", collapsed: false, subjects: [medication.path], subheadings: [] }];
  const exported = createPortableExport(
    source,
    [topic, procedure, medication, syndrome],
    portableSelection({ index: true, procedures: true, medications: true, syndromes: true, collections: true }),
    "2026-08-08T00:00:00.000Z",
  );

  const indexOnly = summarizePortableExport(exported, portableSelection({ index: true }));
  assert.deepEqual(
    { subjects: indexOnly.subjects, groups: indexOnly.groups, index: indexOnly.indexSubjects, procedures: indexOnly.procedures, medications: indexOnly.medications, syndromes: indexOnly.syndromes },
    { subjects: 1, groups: 1, index: 1, procedures: 0, medications: 0, syndromes: 0 },
  );

  const medicationsOnly = summarizePortableExport(exported, portableSelection({ medications: true }));
  assert.deepEqual(
    { subjects: medicationsOnly.subjects, groups: medicationsOnly.groups, index: medicationsOnly.indexSubjects, procedures: medicationsOnly.procedures, medications: medicationsOnly.medications, syndromes: medicationsOnly.syndromes },
    { subjects: 1, groups: 0, index: 0, procedures: 0, medications: 1, syndromes: 0 },
  );

  const collectionOnly = summarizePortableExport(exported, portableSelection({ collections: true }));
  assert.equal(collectionOnly.subjects, 1);
  assert.equal(collectionOnly.medications, 1, "the selected collection still discloses its medication dependency");
  assert.equal(collectionOnly.indexSubjects, 0);
  assert.equal(collectionOnly.collections, 1);
});
