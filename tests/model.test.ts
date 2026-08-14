import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPluginViewState,
  applyPersonalBackupToData,
  applyTemplateTokens,
  applyCanonicalFrontmatter,
  asUnknownRecord,
  buildCurriculumTree,
  buildIndexDiagnostics,
  buildCanonicalMarkdown,
  buildProposalMarkdown,
  boundedSemanticLineage,
  canonicalInterimEnvelopeString,
  canonicalIdIsValid,
  canonicalJsonString,
  canonicalHierarchyIssue,
  clampStoredText,
  cloneJsonValue,
  codeUnitCompare,
  canonicalPath,
  canonicalPathInputsUnchanged,
  capturePluginViewState,
  childSubheadings,
  cloneCollections,
  countHeading,
  cleanPortableIndex,
  BUILTIN_LIBRARY_DEFINITIONS,
  BUILTIN_LIBRARY_IDS,
  cleanLibraryDefinitions,
  cleanIndexFolderSources,
  cleanLibraryNoteProfiles,
  cloneLibraryLayouts,
  emptyLibraryLayouts,
  enforceStoredTextBounds,
  ensureSystemLibraries,
  configuredGroupFromPath,
  configuredGroupFromIndexRoot,
  createDefaultStore,
  createDeviceLocalPluginState,
  createDeviceLocalPluginStateWithReport,
  createKnowledgeBaseEntry,
  createLegacyPrimaryFolderSource,
  createPersonalBackup,
  createWorkspaceConfig,
  DATA_VERSION,
  DEVICE_LOCAL_STATE_VERSION,
  deterministicSemanticHead,
  curriculumContainerKey,
  errorMessage,
  expectedParentCurriculumId,
  fingerprintText,
  genericNotePath,
  groupRecordsByGroup,
  isPortablePlaceholderPath,
  isExtensionCurriculumId,
  isRecognizedPluginData,
  isRecognizedPluginStore,
  isSafeObjectKey,
  isValidLibraryId,
  INDEX_FOLDER_VAULT_ROOT,
  libraryIdFromTab,
  libraryTabId,
  legacyPrimaryFolderSourceId,
  limitSnapshotStack,
  matchesParsedQuery,
  MAX_CURRICULUM_DEPTH,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_MIGRATION_BACKUP_BYTES,
  MAX_DEVICE_LOCAL_STATE_BYTES,
  MAX_LAYOUT_DEPTH,
  MAX_INDEX_FOLDER_SOURCES,
  MAX_LIBRARIES,
  MAX_TRANSFER_COLLECTIONS,
  MAX_TRANSFER_LIST_ITEMS,
  MAX_TRANSFER_SNAPSHOTS,
  MAX_TRANSFER_TEXT_LENGTH,
  MAX_TRANSFER_TOTAL_TEXT_LENGTH,
  MAX_TRANSFER_TOTAL_REFERENCES,
  MAX_UNDO_BYTES,
  metadataHasGap,
  migrateData,
  migrateStore,
  moveCurriculumVisual,
  curriculumChildPaths,
  curriculumDescendantPaths,
  curriculumSiblingPaths,
  normalizedNameKey,
  normalizeSearchText,
  parseQuery,
  PERSONAL_ORGANIZATION_FIELDS,
  parsePersonalBackup,
  parseDeviceLocalPluginState,
  parseWorkspaceConfig,
  pathIsInsideFolder,
  pathIsInIndexFolderSources,
  pluginDataSemanticallyEqual,
  portablePlaceholderPath,
  provisionalMigratedVaultFingerprint,
  rebaseProvisionalVaultIdAfterDeterministicRepair,
  semanticPluginDataProjection,
  semanticEntryFingerprint,
  resolveExpectedParentPath,
  resolveLibraryNoteProfile,
  replaceCurriculumVisualPath,
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
  subjectLibraryId,
  unknownQueryTokens,
  validateWritableFolderPath,
  validateProposalFolderPath,
  validateTemplateFilePath,
  validateLibraryNoteProfile,
  visualPlacementPathSet,
  type LibraryDefinition,
  type LayoutHeading,
  type LayoutSubheading,
  type PluginData,
  type PluginStore,
  type VaultRecord,
} from "../src/model.ts";
import {
  applyPortableExport,
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  normalizePortableSelection,
  parseAnyCommandCenterExport,
  parsePortableExport,
  PORTABLE_EXPORT_KIND,
  portableSubjectPath,
  registerPortableGroup,
  removePortableGroup,
  renameOrMergePortableGroup,
  selectionAvailableForExport,
  serializePortableExport,
  summarizePortableExport,
  synchronizePortableRegistry,
  type PortableCollectionSubheadingV1,
  type PortableExportSelection,
  type PortableExportV1,
} from "../src/portability.ts";

/**
 * Production never matches against a raw query string: every caller parses once
 * and reuses the parsed query. These helpers pair the two production functions
 * the same way instead of relying on a wrapper that only tests called.
 */
function matchesQuery(target: VaultRecord, query: string): boolean {
  return matchesParsedQuery(target, parseQuery(query));
}

/** Reverse a resolved subject binding the way the plugin does, via portableSubjectPath. */
function subjectIdForPath(data: PluginData, path: string): string {
  return data.portableIndex.subjects.find((subject) => portableSubjectPath(data, subject.id) === path)?.id ?? "";
}

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
  return normalizePortableSelection({ ...EMPTY_PORTABLE_SELECTION, ...overrides });
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

function layoutStructureIds(layout: LayoutHeading[]): string[] {
  return layout.flatMap((heading) => [heading.id, ...heading.subheadings.map((subheading) => subheading.id)]);
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
  assert.equal(data.version, DATA_VERSION);
  assert.deepEqual(data.collections.map((item) => item.title), ["My Airway"]);
  assert.equal(data.migrationBackup?.headings.length, 2);
  assert.equal(data.selectedPath, "topic.md");
  assert.deepEqual(data.layoutSnapshots, []);
});

test("flat v10 data migrates into one v12 store without losing workspace state", () => {
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
  assert.deepEqual(store.bases[0]?.data, migrateData(before));
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

test("hand-edited legacy records missing IDs and snapshot times still converge deterministically", () => {
  const malformed = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  malformed.version = 14;
  malformed.collections = [{
    title: "Reading",
    collapsed: false,
    subjects: [],
    subheadings: [{ title: "Airway", collapsed: false, subjects: [] }],
  }];
  malformed.savedViews = [{ name: "Review", tab: "curriculum", query: "airway" }];
  malformed.undoStack = [{
    label: "Recovered history",
    collections: malformed.collections,
    pinnedPaths: [],
    nextStudyPaths: [],
    savedViews: malformed.savedViews,
    curriculumVisual: { parentByPath: {}, groupByPath: {}, orderByContainer: {} },
    manualIndexPaths: [],
    excludedIndexPaths: [],
    indexGroupByPath: {},
    displayNameByPath: {},
    indexGroupAliases: {},
    indexGroupOrder: [],
  }];

  const firstDevice = migrateStore(structuredClone(malformed), 100);
  const secondDevice = migrateStore(structuredClone(malformed), 999);
  const firstData = firstDevice.bases[0]?.data;
  const secondData = secondDevice.bases[0]?.data;

  assert.equal(
    provisionalMigratedVaultFingerprint(firstDevice.vaultId),
    provisionalMigratedVaultFingerprint(secondDevice.vaultId),
  );
  assert.equal(firstData?.collections[0]?.id, secondData?.collections[0]?.id);
  assert.equal(firstData?.collections[0]?.subheadings[0]?.id, secondData?.collections[0]?.subheadings[0]?.id);
  assert.equal(firstData?.savedViews[0]?.id, secondData?.savedViews[0]?.id);
  assert.equal(firstData?.undoStack[0]?.at, 1);
  assert.equal(firstData?.undoStack[0]?.at, secondData?.undoStack[0]?.at);
});

test("normal loading deterministically repairs duplicate and unsafe layout or saved-view IDs", () => {
  const malformed = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  malformed.collections = [
    {
      id: "duplicate",
      title: "First",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "duplicate", title: "First child", collapsed: false, subjects: [] }],
    },
    {
      id: "duplicate",
      title: "Second",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "__proto__", title: "Unsafe child", collapsed: false, subjects: [] }],
    },
    {
      id: "duplicate-2",
      title: "Stable later heading",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "duplicate-3", title: "Stable later child", collapsed: false, subjects: [] }],
    },
  ];
  malformed.savedViews = [
    { id: "view", name: "First view", tab: "curriculum", query: "first" },
    { id: "view", name: "Second view", tab: "collections", query: "second" },
    { id: "view-2", name: "Stable later view", tab: "curriculum", query: "stable" },
    { id: "toString", name: "Unsafe view", tab: "queues", query: "third" },
  ];

  const first = migrateData(structuredClone(malformed));
  const second = migrateData(structuredClone(malformed));
  const layoutIds = first.collections.flatMap((heading) => [
    heading.id,
    ...heading.subheadings.map((subheading) => subheading.id),
  ]);
  const viewIds = first.savedViews.map((view) => view.id);

  assert.deepEqual(layoutIds.slice(0, 3), ["duplicate", "duplicate-4", "duplicate-5"]);
  assert.deepEqual(layoutIds.slice(-2), ["duplicate-2", "duplicate-3"]);
  assert.equal(new Set(layoutIds).size, layoutIds.length);
  assert.equal(layoutIds.includes("__proto__"), false);
  assert.deepEqual(viewIds.slice(0, 3), ["view", "view-3", "view-2"]);
  assert.equal(new Set(viewIds).size, viewIds.length);
  assert.equal(viewIds.includes("toString"), false);
  assert.deepEqual(first.collections, second.collections);
  assert.deepEqual(first.savedViews, second.savedViews);
  assert.deepEqual(migrateData(structuredClone(first)), first, "the repaired IDs must remain stable on the next load");
});

test("library layout repair reserves later intact heading and subheading IDs globally", () => {
  const malformed = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  const portableIndex = asUnknownRecord(malformed.portableIndex);
  portableIndex.libraries = [{
    id: "reading",
    name: "Reading",
    singularName: "Reading item",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  portableIndex.libraryLayouts = {
    reading: [
      {
        title: "Earlier missing IDs",
        collapsed: false,
        subjects: [],
        subheadings: [{ title: "Earlier missing child", collapsed: false, subjects: [] }],
      },
      {
        id: "library-reading-heading-1",
        title: "Later intact heading",
        collapsed: false,
        subjects: [],
        subheadings: [{
          id: "library-reading-heading-1-2-subheading-1",
          title: "Later intact child",
          collapsed: false,
          subjects: [],
        }],
      },
      {
        id: "shared",
        title: "First shared identity",
        collapsed: false,
        subjects: [],
        subheadings: [{ id: "shared", title: "Duplicate child", collapsed: false, subjects: [] }],
      },
      {
        id: "shared-2",
        title: "Later intact suffix",
        collapsed: false,
        subjects: [],
        subheadings: [{ id: "__proto__", title: "Unsafe child", collapsed: false, subjects: [] }],
      },
    ],
  };

  const first = migrateData(structuredClone(malformed));
  const layout = first.portableIndex.libraryLayouts.reading ?? [];
  const ids = layoutStructureIds(layout);
  assert.deepEqual(ids.slice(0, 4), [
    "library-reading-heading-1-2",
    "library-reading-heading-1-2-subheading-1-2",
    "library-reading-heading-1",
    "library-reading-heading-1-2-subheading-1",
  ]);
  assert.equal(layout[2]?.id, "shared");
  assert.notEqual(layout[2]?.subheadings[0]?.id, "shared");
  assert.equal(layout[3]?.id, "shared-2", "the duplicate repair cannot steal a later intact suffix");
  assert.equal(ids.includes("__proto__"), false);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    migrateData(structuredClone(first)).portableIndex.libraryLayouts.reading,
    layout,
    "the globally repaired library namespace is stable on reload",
  );
});

test("malformed IDs are repaired throughout named, nested, Undo, and Redo snapshots", () => {
  const data = migrateData(null);
  data.portableIndex.libraries = [{
    id: "reading",
    name: "Reading",
    singularName: "Reading item",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  data.portableIndex.libraryLayouts = { reading: [] };
  const malformedCollections = (): unknown[] => [
    {
      id: "shared",
      title: "First",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "shared", title: "Duplicate child", collapsed: false, subjects: [] }],
    },
    {
      id: "shared-2",
      title: "Later intact suffix",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "toString", title: "Unsafe child", collapsed: false, subjects: [] }],
    },
  ];
  const malformedViews = (): unknown[] => [
    { id: "view", name: "First", tab: "curriculum", query: "one" },
    { id: "view", name: "Duplicate", tab: "collections", query: "two" },
    { id: "view-2", name: "Later intact", tab: "curriculum", query: "three" },
    { id: "__proto__", name: "Unsafe", tab: "queues", query: "four" },
  ];
  const malformedSnapshot = (label: string): Record<string, unknown> => {
    const snapshot = snapshotPersonal(data, label, true, true) as unknown as Record<string, unknown>;
    snapshot.collections = malformedCollections();
    snapshot.savedViews = malformedViews();
    const portableIndex = asUnknownRecord(snapshot.portableIndex);
    portableIndex.libraryLayouts = {
      reading: [{
        id: "library-duplicate",
        title: "Library heading",
        collapsed: false,
        subjects: [],
        subheadings: [{ id: "library-duplicate", title: "Duplicate library child", collapsed: false, subjects: [] }],
      }],
    };
    return snapshot;
  };
  const nested = malformedSnapshot("Nested");
  const named = malformedSnapshot("Named");
  named.layoutSnapshots = [nested];
  const raw = structuredClone(data) as unknown as Record<string, unknown>;
  raw.layoutSnapshots = [named];
  raw.undoStack = [malformedSnapshot("Undo")];
  raw.redoStack = [malformedSnapshot("Redo")];

  const cleaned = migrateData(raw);
  const snapshots = [
    cleaned.layoutSnapshots[0],
    cleaned.layoutSnapshots[0]?.layoutSnapshots?.[0],
    cleaned.undoStack[0],
    cleaned.redoStack[0],
  ];
  for (const snapshot of snapshots) {
    assert.ok(snapshot);
    const ids = layoutStructureIds(snapshot.collections);
    assert.equal(new Set(ids).size, ids.length, `${snapshot.label}: collection IDs are globally unique`);
    assert.equal(ids.includes("toString"), false);
    assert.equal(snapshot.collections[1]?.id, "shared-2", `${snapshot.label}: later intact suffix survives`);
    const viewIds = snapshot.savedViews.map((view) => view.id);
    assert.equal(new Set(viewIds).size, viewIds.length, `${snapshot.label}: saved-view IDs are unique`);
    assert.equal(viewIds.includes("__proto__"), false);
    assert.equal(snapshot.savedViews[2]?.id, "view-2", `${snapshot.label}: later intact view suffix survives`);
    const libraryIds = layoutStructureIds(snapshot.portableIndex?.libraryLayouts.reading ?? []);
    assert.equal(new Set(libraryIds).size, libraryIds.length, `${snapshot.label}: library IDs are globally unique`);
  }
  assert.deepEqual(migrateData(structuredClone(cleaned)), cleaned, "all repaired history remains stable on reload");
});

test("recovery parsing and application repair malformed structure IDs before replacement", () => {
  const source = migrateData(null);
  source.settings.workspaceName = "Recovery source";
  const backup = createPersonalBackup(
    source,
    "2026-08-11T00:00:00.000Z",
    "vault-recovery-id-repair",
    "base-recovery-id-repair",
    "Recovery source",
  ) as unknown as Record<string, unknown>;
  const malformedCollections = [
    {
      id: "shared",
      title: "First",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "shared", title: "Duplicate child", collapsed: false, subjects: [] }],
    },
    {
      id: "shared-2",
      title: "Later intact",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "__proto__", title: "Unsafe child", collapsed: false, subjects: [] }],
    },
  ];
  const snapshot = snapshotPersonal(source, "Recovered snapshot", true, true) as unknown as Record<string, unknown>;
  snapshot.collections = structuredClone(malformedCollections);
  snapshot.savedViews = [
    { id: "view", name: "First", tab: "curriculum", query: "one" },
    { id: "view", name: "Duplicate", tab: "collections", query: "two" },
    { id: "view-2", name: "Later intact", tab: "queues", query: "three" },
  ];
  const nested = structuredClone(snapshot);
  delete nested.layoutSnapshots;
  snapshot.layoutSnapshots = [nested];
  backup.collections = structuredClone(malformedCollections);
  backup.savedViews = structuredClone(snapshot.savedViews);
  backup.layoutSnapshots = [snapshot];

  const parsed = parsePersonalBackup(backup);
  const parsedLayouts = [
    parsed.collections,
    parsed.layoutSnapshots[0]?.collections ?? [],
    parsed.layoutSnapshots[0]?.layoutSnapshots?.[0]?.collections ?? [],
  ];
  for (const layout of parsedLayouts) {
    const ids = layoutStructureIds(layout);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.includes("__proto__"), false);
    assert.equal(layout[1]?.id, "shared-2");
  }
  const recoveredViews = parsed.layoutSnapshots[0]?.savedViews.map((view) => view.id) ?? [];
  assert.equal(new Set(recoveredViews).size, recoveredViews.length);
  assert.equal(recoveredViews[2], "view-2");
  assert.deepEqual(parsed.savedViews.map((view) => view.id), recoveredViews);

  const target = migrateData(null);
  const envelope: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-11T00:00:00.000Z",
    sourceWorkspace: "Recovery source",
    components: { recovery: parsed },
  };
  applyPortableExport(
    target,
    envelope,
    portableSelection({ recovery: true }),
    "replace",
    "vault-recovery-id-repair",
    undefined,
    "base-recovery-id-repair",
    "Recovery source",
  );
  assert.deepEqual(target.collections, parsed.collections);
  assert.deepEqual(target.savedViews, parsed.savedViews);
  assert.deepEqual(target.layoutSnapshots, parsed.layoutSnapshots);
  assert.deepEqual(
    migrateData(structuredClone(target)).layoutSnapshots,
    target.layoutSnapshots,
    "an applied repaired recovery remains stable on ordinary load",
  );
});

test("portable collection validation uses the same global structure ID namespace as normal loading", () => {
  const collision = portableFixture();
  collision.components.collections = {
    version: 1,
    collections: [
      {
        id: "heading-one",
        title: "First heading",
        collapsed: false,
        subjectIds: [],
        subheadings: [{ id: "shared", title: "First child", collapsed: false, subjectIds: [] }],
      },
      {
        id: "heading-two",
        title: "Second heading",
        collapsed: false,
        subjectIds: [],
        subheadings: [{ id: "shared", title: "Second child", collapsed: false, subjectIds: [] }],
      },
    ],
  };
  assert.throws(
    () => parsePortableExport(structuredClone(collision)),
    /duplicate collection or subheading ID: shared/i,
  );

  collision.components.collections.collections[1] = {
    id: "shared",
    title: "Heading colliding with a child",
    collapsed: false,
    subjectIds: [],
    subheadings: [],
  };
  assert.throws(
    () => parsePortableExport(structuredClone(collision)),
    /duplicate collection or subheading ID: shared/i,
  );

  const source = migrateData(null);
  source.collections = [{
    id: "heading-one",
    title: "First heading",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "child-one", title: "First child", collapsed: false, subjects: [] }],
  }, {
    id: "heading-two",
    title: "Second heading",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "child-two", title: "Second child", collapsed: false, subjects: [] }],
  }];
  const exported = createPortableExport(
    source,
    [],
    portableSelection({ collections: true }),
    "2026-08-11T00:00:00.000Z",
  );
  const parsed = parsePortableExport(structuredClone(exported));
  const target = migrateData(null);
  applyPortableExport(target, parsed, portableSelection({ collections: true }), "replace");
  const reloaded = migrateData(structuredClone(target));
  assert.deepEqual(reloaded.collections, target.collections);
});

test("portable collection Merge preserves one global identity namespace across levels and parents", () => {
  const heading = (
    id: string,
    title: string,
    subheadings: LayoutHeading["subheadings"] = [],
    collapsed = false,
  ): LayoutHeading => ({ id, title, collapsed, subjects: [], subheadings });
  const child = (id: string, title: string, collapsed = false): LayoutHeading["subheadings"][number] => ({
    id,
    title,
    collapsed,
    subjects: [],
  });
  const cases: Array<{
    name: string;
    destination: LayoutHeading[];
    incoming: LayoutHeading[];
    verify: (layout: LayoutHeading[]) => void;
  }> = [
    {
      name: "destination heading versus incoming child",
      destination: [heading("shared", "Local heading")],
      incoming: [heading("incoming-parent", "Incoming parent", [child("shared", "Incoming child")])],
      verify: (layout) => {
        assert.equal(layout.find((item) => item.id === "shared")?.title, "Local heading");
        assert.notEqual(layout.find((item) => item.id === "incoming-parent")?.subheadings[0]?.id, "shared");
      },
    },
    {
      name: "destination child versus incoming heading",
      destination: [heading("local-parent", "Local parent", [child("shared", "Local child")])],
      incoming: [heading("shared", "Incoming heading")],
      verify: (layout) => {
        assert.equal(layout.find((item) => item.id === "local-parent")?.subheadings[0]?.id, "shared");
        assert.notEqual(layout.find((item) => item.title === "Incoming heading")?.id, "shared");
      },
    },
    {
      name: "destination child under an earlier parent versus incoming child under a later parent",
      destination: [
        heading("parent-a", "Parent A", [child("shared", "Shared child")]),
        heading("parent-b", "Parent B"),
      ],
      incoming: [heading("parent-b", "Parent B", [child("shared", "Shared child")])],
      verify: (layout) => {
        assert.equal(layout.find((item) => item.id === "parent-a")?.subheadings[0]?.id, "shared");
        assert.notEqual(layout.find((item) => item.id === "parent-b")?.subheadings[0]?.id, "shared");
      },
    },
    {
      name: "destination child under a later parent versus incoming child under an earlier parent",
      destination: [
        heading("parent-b", "Parent B"),
        heading("parent-a", "Parent A", [child("shared", "Shared child")]),
      ],
      incoming: [heading("parent-b", "Parent B", [child("shared", "Shared child")])],
      verify: (layout) => {
        assert.equal(layout.find((item) => item.id === "parent-a")?.subheadings[0]?.id, "shared");
        assert.notEqual(layout.find((item) => item.id === "parent-b")?.subheadings[0]?.id, "shared");
      },
    },
    {
      name: "same heading ID with a different semantic title",
      destination: [heading("shared", "Local heading")],
      incoming: [heading("shared", "Incoming heading")],
      verify: (layout) => {
        assert.equal(layout.length, 2);
        assert.equal(layout.find((item) => item.id === "shared")?.title, "Local heading");
      },
    },
    {
      name: "same child ID under one parent with a different semantic title",
      destination: [heading("parent", "Parent", [child("shared", "Local child")])],
      incoming: [heading("parent", "Parent", [child("shared", "Incoming child")])],
      verify: (layout) => {
        const children = layout[0]?.subheadings ?? [];
        assert.equal(children.length, 2);
        assert.equal(children.find((item) => item.id === "shared")?.title, "Local child");
      },
    },
    {
      name: "same child ID and title under a different effective parent",
      destination: [
        heading("parent-a", "Parent A", [child("shared", "Shared child")]),
        heading("parent-b", "Parent B"),
      ],
      incoming: [heading("parent-b", "Parent B", [child("shared", "Shared child")])],
      verify: (layout) => assert.equal(layout.find((item) => item.id === "parent-a")?.subheadings[0]?.id, "shared"),
    },
    {
      name: "same heading ID and normalized title is an exact semantic match",
      destination: [heading("shared", "Shared heading", [], true)],
      incoming: [heading("shared", " shared heading ")],
      verify: (layout) => {
        assert.equal(layout.length, 1);
        assert.equal(layout[0]?.id, "shared");
        assert.equal(layout[0]?.collapsed, true, "a merge preserves local view state");
      },
    },
    {
      name: "same child ID and title under the same effective parent is an exact match",
      destination: [heading("parent", "Parent", [child("shared", "Shared child", true)])],
      incoming: [heading("parent", "Parent", [child("shared", "shared child")])],
      verify: (layout) => {
        assert.equal(layout[0]?.subheadings.length, 1);
        assert.equal(layout[0]?.subheadings[0]?.id, "shared");
        assert.equal(layout[0]?.subheadings[0]?.collapsed, true);
      },
    },
    {
      name: "a title-matched parent still permits a safe exact child match",
      destination: [heading("local-parent", "Parent", [child("shared", "Shared child")])],
      incoming: [heading("incoming-parent", "Parent", [child("shared", "Shared child")])],
      verify: (layout) => {
        assert.equal(layout.length, 1);
        assert.equal(layout[0]?.id, "local-parent");
        assert.equal(layout[0]?.subheadings[0]?.id, "shared");
      },
    },
    {
      name: "weak heading title matching cannot steal a later exact ID match",
      destination: [heading("later", "Repeated")],
      incoming: [heading("earlier", "Repeated"), heading("later", "Repeated")],
      verify: (layout) => {
        assert.equal(layout.length, 2);
        assert.equal(layout.find((item) => item.id === "later")?.title, "Repeated");
      },
    },
    {
      name: "weak child title matching cannot steal a later exact ID match",
      destination: [heading("parent", "Parent", [child("later", "Repeated")])],
      incoming: [heading("parent", "Parent", [child("earlier", "Repeated"), child("later", "Repeated")])],
      verify: (layout) => {
        assert.equal(layout[0]?.subheadings.length, 2);
        assert.equal(layout[0]?.subheadings.find((item) => item.id === "later")?.title, "Repeated");
      },
    },
    {
      name: "a pre-existing deterministic fork cannot become a weak-title candidate on reapply",
      destination: [
        heading("local", "Shared"),
        heading("owner", "Owner", [child("x", "Owned child")]),
      ],
      incoming: [heading("b", "Shared"), heading("x", "Shared")],
      verify: (layout) => {
        assert.equal(layout.length, 3);
        assert.equal(layout.find((item) => item.id === "local")?.title, "Shared");
        assert.equal(layout.find((item) => item.id === "owner")?.subheadings[0]?.id, "x");
      },
    },
  ];

  for (const scenario of cases) {
    const source = migrateData(null);
    source.collections = cloneCollections(scenario.incoming);
    const exported = parsePortableExport(createPortableExport(
      source,
      [],
      portableSelection({ collections: true }),
      "2026-08-11T00:00:00.000Z",
    ));
    const target = migrateData(null);
    target.collections = cloneCollections(scenario.destination);

    applyPortableExport(target, exported, portableSelection({ collections: true }), "merge");
    const afterFirstApply = cloneCollections(target.collections);
    const ids = layoutStructureIds(afterFirstApply);
    assert.equal(new Set(ids).size, ids.length, `${scenario.name}: IDs are globally unique`);
    assert.deepEqual(
      migrateData(structuredClone(target)).collections,
      afterFirstApply,
      `${scenario.name}: ordinary reload does not rename either side`,
    );
    scenario.verify(afterFirstApply);

    applyPortableExport(target, exported, portableSelection({ collections: true }), "merge");
    assert.deepEqual(
      target.collections,
      afterFirstApply,
      `${scenario.name}: an identical second import reuses the deterministic fork`,
    );
  }
});

test("a v11 multi-base envelope migrates to v12 without being mistaken for damaged flat data", () => {
  const current = createDefaultStore(migrateData(null), 100, "vault-existing");
  const migrated = migrateStore({ ...structuredClone(current), version: 11 }, 200);
  assert.equal(migrated.version, STORE_VERSION);
  assert.equal(migrated.vaultId, "vault-existing");
  assert.equal(migrated.bases[0]?.data.version, DATA_VERSION);
});

test("v11 through v13 envelopes acquire semantic revision zero exactly once", () => {
  for (const version of [11, 12, 13]) {
    const source = createDefaultStore(migrateData(null), 100, `vault-v${version}`);
    const raw = structuredClone(source) as unknown as Record<string, unknown>;
    raw.version = version;
    const rawBases = raw.bases as Array<Record<string, unknown>>;
    delete rawBases[0]?.semanticRevision;

    const first = migrateStore(raw, 200);
    const second = migrateStore(first, 300);

    assert.equal(first.version, STORE_VERSION);
    assert.equal(first.bases[0]?.semanticRevision, 0);
    assert.equal(second.bases[0]?.semanticRevision, 0);
  }
});

test("current v14 envelopes require a valid semantic revision", () => {
  const current = createDefaultStore(migrateData(null), 100, "vault-v14");
  const missing = structuredClone(current) as unknown as { bases: Array<Record<string, unknown>> };
  delete missing.bases[0]?.semanticRevision;
  assert.throws(() => migrateStore(missing, 200), /invalid semantic revision/i);

  const fractional = structuredClone(current) as unknown as { bases: Array<Record<string, unknown>> };
  fractional.bases[0].semanticRevision = 1.5;
  assert.throws(() => migrateStore(fractional, 200), /invalid semantic revision/i);

  const exhausted = structuredClone(current) as unknown as { bases: Array<Record<string, unknown>> };
  exhausted.bases[0].semanticRevision = Number.MAX_SAFE_INTEGER;
  assert.throws(() => migrateStore(exhausted, 200), /invalid semantic revision/i);
});

test("provisional rebasing rejects an unstamped semantic payload change", () => {
  const legacy = migrateData(null);
  legacy.version = DATA_VERSION - 2;
  const before = migrateStore(legacy, 100);
  const parent = structuredClone(before);
  const after = structuredClone(parent);
  after.bases[0]?.data.pinnedPaths.push("Knowledge Base/Unstamped.md");

  assert.equal(rebaseProvisionalVaultIdAfterDeterministicRepair(before, after, {
    parentStore: parent,
    reason: "clinical-index-remediation",
  }), false);

  const exhaustedBefore = structuredClone(before);
  const exhaustedParent = structuredClone(parent);
  const exhaustedAfter = structuredClone(parent);
  const sourceEntry = exhaustedBefore.bases[0];
  const parentEntry = exhaustedParent.bases[0];
  const repairedEntry = exhaustedAfter.bases[0];
  assert.ok(sourceEntry && parentEntry && repairedEntry);
  sourceEntry.semanticRevision = Number.MAX_SAFE_INTEGER;
  parentEntry.semanticRevision = Number.MAX_SAFE_INTEGER;
  repairedEntry.data.pinnedPaths.push("Knowledge Base/Overflow.md");
  repairedEntry.semanticRevision = Number.MAX_SAFE_INTEGER + 1;
  repairedEntry.semanticHash = semanticEntryFingerprint(repairedEntry);
  repairedEntry.semanticHead = deterministicSemanticHead(
    parentEntry.semanticHead,
    repairedEntry.semanticHash,
    "clinical-index-remediation",
  );
  repairedEntry.semanticLineage = boundedSemanticLineage(
    [parentEntry.semanticHead, ...parentEntry.semanticLineage],
    repairedEntry.semanticHead,
  );
  assert.equal(rebaseProvisionalVaultIdAfterDeterministicRepair(
    exhaustedBefore,
    exhaustedAfter,
    { parentStore: exhaustedParent, reason: "clinical-index-remediation" },
  ), false);
});

test("current v14 envelopes discard ancestry when the semantic head is missing, invalid, or self-referential", () => {
  const current = createDefaultStore(migrateData(null), 100, "vault-v14-causal-repair");
  const validAncestor = "1111111111111111";

  for (const semanticHead of [undefined, "not-a-fingerprint"] as const) {
    const malformed = structuredClone(current) as unknown as { bases: Array<Record<string, unknown>> };
    malformed.bases[0].semanticRevision = 4;
    malformed.bases[0].semanticLineage = [validAncestor];
    if (semanticHead === undefined) delete malformed.bases[0].semanticHead;
    else malformed.bases[0].semanticHead = semanticHead;

    const repaired = migrateStore(malformed, 200).bases[0];
    assert.ok(repaired);
    assert.equal(repaired.semanticHead, repaired.semanticHash);
    assert.deepEqual(repaired.semanticLineage, []);
  }

  const selfReferential = structuredClone(current);
  selfReferential.bases[0].semanticRevision = 4;
  selfReferential.bases[0].semanticLineage = [selfReferential.bases[0].semanticHead, validAncestor];
  const repairedSelfReference = migrateStore(selfReferential, 200).bases[0];
  assert.ok(repairedSelfReference);
  assert.equal(repairedSelfReference.semanticHead, repairedSelfReference.semanticHash);
  assert.deepEqual(repairedSelfReference.semanticLineage, []);

  const impossibleRoot = structuredClone(current);
  impossibleRoot.bases[0].semanticLineage = [validAncestor];
  const repairedRoot = migrateStore(impossibleRoot, 200).bases[0];
  assert.ok(repairedRoot);
  assert.equal(repairedRoot.semanticHead, repairedRoot.semanticHash);
  assert.deepEqual(repairedRoot.semanticLineage, []);
});

test("the shared semantic projection ignores only live view state and device history", () => {
  const data = migrateData(null);
  data.collections = [{
    id: "heading-live",
    title: "Live heading",
    collapsed: true,
    subjects: ["Knowledge/Topic.md"],
    subheadings: [{ id: "subheading-live", title: "Live subheading", collapsed: true, subjects: [] }],
  }];
  data.portableIndex.libraryLayouts["library-live"] = structuredClone(data.collections);
  data.selectedPath = "Knowledge/Topic.md";
  data.activeTab = "collections";
  data.settings.defaultTab = "collections";
  data.savedViews = [{ id: "saved-semantic", name: "Saved semantic view", tab: "collections", query: "airway" }];
  data.collapsed.curriculumDomains = ["ENT"];
  data.undoStack = [snapshotPersonal(data, "Device undo")];
  data.redoStack = [snapshotPersonal(data, "Device redo")];
  data.layoutSnapshots = [snapshotPersonal(data, "Named layout")];

  const projection = semanticPluginDataProjection(data);

  assert.equal(projection.selectedPath, "");
  assert.equal(projection.activeTab, "curriculum");
  assert.deepEqual(projection.collapsed, migrateData(null).collapsed);
  assert.equal(projection.collections[0]?.collapsed, false);
  assert.equal(projection.collections[0]?.subheadings[0]?.collapsed, false);
  assert.equal(projection.portableIndex.libraryLayouts["library-live"]?.[0]?.collapsed, false);
  assert.deepEqual(projection.undoStack, []);
  assert.deepEqual(projection.redoStack, []);
  assert.equal(projection.layoutSnapshots[0]?.collections[0]?.collapsed, true, "named snapshots remain semantic");
  assert.equal(projection.layoutSnapshots[0]?.collections[0]?.subheadings[0]?.collapsed, true);
  assert.equal(projection.settings.defaultTab, "collections");
  assert.equal(projection.savedViews[0]?.name, "Saved semantic view");
  assert.deepEqual(projection.collections[0]?.subjects, ["Knowledge/Topic.md"]);
});

test("the projection-free semantic equality guard matches the canonical view-state exclusions", () => {
  const baseline = migrateData(null);
  baseline.collections = [{
    id: "heading",
    title: "Heading",
    collapsed: false,
    subjects: ["Knowledge/Topic.md"],
    subheadings: [{ id: "child", title: "Child", collapsed: false, subjects: [] }],
  }];
  baseline.portableIndex.libraryLayouts.library = cloneCollections(baseline.collections);
  baseline.layoutSnapshots = [snapshotPersonal(baseline, "Named semantic layout")];

  const viewOnly = cloneJsonValue(baseline);
  viewOnly.selectedPath = "Knowledge/Topic.md";
  viewOnly.activeTab = "collections";
  viewOnly.collapsed.curriculumDomains = ["Heading"];
  viewOnly.collections[0].collapsed = true;
  const child = viewOnly.collections[0].subheadings[0];
  assert.ok(child);
  child.collapsed = true;
  const libraryHeading = viewOnly.portableIndex.libraryLayouts.library?.[0];
  assert.ok(libraryHeading);
  libraryHeading.collapsed = true;
  viewOnly.undoStack = [snapshotPersonal(viewOnly, "Local undo")];
  assert.equal(pluginDataSemanticallyEqual(viewOnly, baseline), true);
  assert.equal(pluginDataSemanticallyEqual(baseline, viewOnly), true);

  const changedSubject = cloneJsonValue(viewOnly);
  changedSubject.collections[0].subjects.push("Knowledge/Other.md");
  assert.equal(pluginDataSemanticallyEqual(changedSubject, baseline), false);

  const changedLibraryPlacement = cloneJsonValue(viewOnly);
  changedLibraryPlacement.portableIndex.libraryLayouts.library?.[0]?.subjects.push("Knowledge/Other.md");
  assert.equal(pluginDataSemanticallyEqual(changedLibraryPlacement, baseline), false);

  const changedNamedSnapshot = cloneJsonValue(viewOnly);
  const namedHeading = changedNamedSnapshot.layoutSnapshots[0]?.collections[0];
  assert.ok(namedHeading);
  namedHeading.collapsed = !namedHeading.collapsed;
  assert.equal(pluginDataSemanticallyEqual(changedNamedSnapshot, baseline), false);

  const changedNestedShape = cloneJsonValue(viewOnly);
  const nestedLeaf = changedNestedShape.collections[0].subheadings[0];
  assert.ok(nestedLeaf);
  nestedLeaf.subheadings = [];
  assert.equal(pluginDataSemanticallyEqual(changedNestedShape, baseline), false, "optional nested structure remains semantic");

  const changedMembership = cloneJsonValue(viewOnly);
  changedMembership.directIndexPaths.push("Knowledge/Other.md");
  assert.equal(pluginDataSemanticallyEqual(changedMembership, baseline), false);
});

test("legacy and interim migration identities ignore live view state but retain named layouts", () => {
  const flatA = migrateData(null);
  flatA.settings.workspaceName = "ENT";
  flatA.collections = [{ id: "heading", title: "Heading", collapsed: false, subjects: [], subheadings: [] }];
  const flatB = structuredClone(flatA);
  flatA.selectedPath = "Knowledge/A.md";
  flatA.collections[0].collapsed = true;
  flatA.undoStack = [snapshotPersonal(flatA, "Local history")];
  flatB.selectedPath = "Knowledge/B.md";
  const legacyA = migrateStore(flatA, 100);
  const legacyB = migrateStore(flatB, 999);
  assert.equal(
    provisionalMigratedVaultFingerprint(legacyA.vaultId),
    provisionalMigratedVaultFingerprint(legacyB.vaultId),
  );

  const interimA = createDefaultStore(migrateData(null), 100, "vault-interim-a");
  interimA.bases[0].data.collections = structuredClone(flatB.collections);
  const interimB = structuredClone(interimA);
  interimA.bases[0].data.selectedPath = "Knowledge/A.md";
  interimA.bases[0].data.collections[0].collapsed = true;
  interimA.bases[0].data.undoStack = [snapshotPersonal(interimA.bases[0].data, "History")];
  interimB.bases[0].data.selectedPath = "Knowledge/B.md";
  assert.equal(canonicalInterimEnvelopeString(interimA), canonicalInterimEnvelopeString(interimB));

  interimA.bases[0].data.layoutSnapshots = [snapshotPersonal(interimA.bases[0].data, "Named")];
  assert.notEqual(canonicalInterimEnvelopeString(interimA), canonicalInterimEnvelopeString(interimB));
});

test("interim envelope identity material orders base IDs independently of the system locale", () => {
  const store = createDefaultStore(migrateData(null), 100, "vault-collation");
  store.bases = [
    createKnowledgeBaseEntry(migrateData(null), "base-a", 100),
    createKnowledgeBaseEntry(migrateData(null), "Base-b", 200),
  ];
  const ids = store.bases.map((entry) => entry.id);
  assert.notDeepEqual(
    [...ids].sort((left, right) => left.localeCompare(right)),
    [...ids].sort(),
    "these IDs straddle a collation boundary, so the two orderings disagree",
  );

  const canonical = JSON.parse(canonicalInterimEnvelopeString(store)) as { bases: Array<{ id: string }> };
  assert.deepEqual(canonical.bases.map((entry) => entry.id), [...ids].sort(), "code-unit order, never localeCompare");
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

test("visual ordering deduplicates paths in stable first-seen order", () => {
  const first = record({ path: "first.md", title: "First" });
  const moved = record({ path: "moved.md", title: "Moved" });
  const last = record({ path: "last.md", title: "Last" });
  const state = { parentByPath: {} as Record<string, string | null>, orderByContainer: {} as Record<string, string[]> };
  moveCurriculumVisual(state, moved, null, [first.path, first.path, moved.path, last.path, first.path], 1);
  assert.deepEqual(state.orderByContainer[curriculumContainerKey(moved.domain, null)], [first.path, moved.path, last.path]);

  state.orderByContainer[curriculumContainerKey(moved.domain, null)] = [last.path, first.path, last.path, first.path];
  assert.equal(reconcileCurriculumVisual(state, [first, moved, last]), true);
  assert.deepEqual(state.orderByContainer[curriculumContainerKey(moved.domain, null)], [last.path, first.path]);
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
  data.directIndexPaths = ["Outside/Topic.md"];
  data.indexFolderSources = [{ id: "index-folder-research", path: "Research", origin: "user" }];
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
  assert.deepEqual(data.directIndexPaths, ["Outside/Topic.md"]);
  assert.deepEqual(data.indexFolderSources, [{ id: "index-folder-research", path: "Research", origin: "user" }]);
  assert.deepEqual(data.manualIndexPaths, []);
  assert.deepEqual(data.excludedIndexPaths, ["Knowledge Base/Hidden.md"]);
  assert.equal(data.indexGroupByPath["Outside/Topic.md"], "Airway");
  assert.deepEqual(data.indexGroupOrder, ["Airway", "Research"]);
});

test("tab-changing snapshots opt into one lean navigation field and survive cleaning", () => {
  const data = migrateData(null);
  const libraryId = "library-research";
  const tab = libraryTabId(libraryId);
  data.portableIndex.libraries.push({
    id: libraryId,
    name: "Research",
    singularName: "Paper",
    icon: "microscope",
    order: data.portableIndex.libraries.length,
    sourceKind: null,
    archivedAt: null,
  });
  data.portableIndex.libraryLayouts[libraryId] = [];
  data.activeTab = tab;

  const ordinary = snapshotPersonal(data, "Pin a note");
  const navigation = snapshotPersonal(data, "Archive Research", false, false, false, true);
  assert.equal(Object.prototype.hasOwnProperty.call(ordinary, "activeTab"), false);
  assert.equal(navigation.activeTab, tab);

  data.activeTab = "queues";
  restoreSnapshot(data, navigation);
  assert.equal(data.activeTab, tab);

  data.undoStack = [navigation];
  const cleaned = migrateData(structuredClone(data));
  assert.equal(cleaned.undoStack[0]?.activeTab, tab);
});

test("v2 data migrates to v11 with the ENT clinical preset and safe settings", () => {
  const data = migrateData({
    version: 2,
    collections: [], pinnedPaths: [], nextStudyPaths: [], savedViews: [],
    settings: { defaultTab: "collections", recentLimit: 25, enableHoverPreview: true, showSafetyBadges: true },
  });
  assert.equal(data.version, DATA_VERSION);
  assert.equal(data.settings.workspaceMode, "ent-clinical");
  assert.equal(data.settings.setupComplete, true);
  assert.equal(data.settings.proposalFolder, "01 Inbox/ENT Topic Proposals");
  assert.equal(data.settings.enableAdvancedCanonicalActions, false);
  assert.equal(data.settings.openNoteBehavior, "new-tab");
  assert.equal(data.settings.allowClinicalVisualGroupMoves, false);
  assert.equal(data.v2MigrationBackup?.version, 2);
});

test("numeric-string v2 data follows the v2 migration without losing organization", () => {
  const data = migrateData({
    version: "2",
    collections: [{
      id: "legacy-reading",
      title: "Legacy Reading",
      collapsed: false,
      subjects: ["Knowledge Base/Legacy topic.md"],
      subheadings: [],
    }],
    pinnedPaths: ["Knowledge Base/Pinned.md"],
    nextStudyPaths: ["Knowledge Base/Next.md"],
    savedViews: [{ id: "legacy-view", name: "Legacy view", tab: "collections", query: "legacy" }],
    settings: { workspaceName: "Legacy numeric-string v2", defaultTab: "collections" },
  });

  assert.equal(data.version, DATA_VERSION);
  assert.equal(data.settings.workspaceMode, "ent-clinical");
  assert.equal(data.settings.workspaceName, "Legacy numeric-string v2");
  assert.equal(data.collections[0]?.title, "Legacy Reading");
  assert.deepEqual(data.collections[0]?.subjects, ["Knowledge Base/Legacy topic.md"]);
  assert.deepEqual(data.pinnedPaths, ["Knowledge Base/Pinned.md"]);
  assert.deepEqual(data.nextStudyPaths, ["Knowledge Base/Next.md"]);
  assert.equal(data.savedViews[0]?.name, "Legacy view");
  assert.equal(data.v2MigrationBackup?.version, 2);
});

test("ordinary legacy migration backups remain deterministic and isolated after cleaning", () => {
  const source = migrateData(null);
  source.migrationBackup = {
    version: 1,
    migratedAt: 123,
    headings: [{ id: "legacy-airway", title: "Airway", kind: "automatic", subjects: ["ENT/Airway.md"] }],
  };
  source.v2MigrationBackup = {
    version: 2,
    migratedAt: 456,
    collections: [{
      id: "collection-reading",
      title: "Reading",
      collapsed: false,
      subjects: ["ENT/Airway.md"],
      subheadings: [],
    }],
    pinnedPaths: ["ENT/Airway.md"],
    nextStudyPaths: ["ENT/Cleft.md"],
    savedViews: [{ id: "view-airway", name: "Airway", tab: "curriculum", query: "airway" }],
    settings: { workspaceName: "Legacy ENT", recentLimit: 25 },
  };

  const cleaned = migrateData(source);
  assert.deepEqual(cleaned.migrationBackup, source.migrationBackup);
  assert.deepEqual(cleaned.v2MigrationBackup, source.v2MigrationBackup);
  assert.deepEqual(migrateData(structuredClone(cleaned)), cleaned);

  (source.migrationBackup.headings[0] as { title: string }).title = "Changed later";
  source.v2MigrationBackup.collections[0].title = "Changed later";
  assert.equal((cleaned.migrationBackup?.headings[0] as { title: string }).title, "Airway");
  assert.equal(cleaned.v2MigrationBackup?.collections[0]?.title, "Reading");
});

test("hostile synced migration backups are dropped before they can bloat every save", () => {
  const source = migrateData(null);
  source.collections = [{ id: "kept", title: "Kept", collapsed: false, subjects: [], subheadings: [] }];
  const multibytePayload = "界".repeat(Math.floor(MAX_MIGRATION_BACKUP_BYTES / 3) + 1);
  source.migrationBackup = {
    version: 1,
    migratedAt: 123,
    headings: [{ title: multibytePayload }],
  };
  source.v2MigrationBackup = {
    version: 2,
    migratedAt: 456,
    collections: [],
    pinnedPaths: [],
    nextStudyPaths: [],
    savedViews: [],
    settings: { payload: multibytePayload },
  };

  assert.ok(JSON.stringify(source.migrationBackup).length < MAX_MIGRATION_BACKUP_BYTES);
  assert.ok(new TextEncoder().encode(JSON.stringify(source.migrationBackup)).byteLength > MAX_MIGRATION_BACKUP_BYTES);
  const cleaned = migrateData(source);
  assert.equal(cleaned.migrationBackup, undefined);
  assert.equal(cleaned.v2MigrationBackup, undefined);
  assert.equal(cleaned.collections[0]?.title, "Kept");
});

test("legacy migration backup structure limits fail closed without blocking primary data", () => {
  const source = migrateData(null) as unknown as Record<string, unknown>;
  source.migrationBackup = {
    version: 1,
    migratedAt: 1,
    headings: Array.from({ length: 10_001 }, () => null),
  };
  source.v2MigrationBackup = {
    version: 2,
    migratedAt: 1,
    collections: Array.from({ length: 10_001 }, () => null),
    pinnedPaths: [],
    nextStudyPaths: [],
    savedViews: [],
    settings: {},
  };

  const cleaned = migrateData(source);
  assert.equal(cleaned.migrationBackup, undefined);
  assert.equal(cleaned.v2MigrationBackup, undefined);
  assert.equal(cleaned.version, DATA_VERSION);
});

test("new or duplicated knowledge-base entries do not multiply historical migration backups", () => {
  const source = migrateData(null);
  source.migrationBackup = {
    version: 1,
    migratedAt: 1,
    headings: [{ title: "Legacy" }],
  };
  source.v2MigrationBackup = {
    version: 2,
    migratedAt: 2,
    collections: [],
    pinnedPaths: [],
    nextStudyPaths: [],
    savedViews: [],
    settings: {},
  };

  const created = createKnowledgeBaseEntry(source, "base-copy", 100);
  assert.equal(created.data.migrationBackup, undefined);
  assert.equal(created.data.v2MigrationBackup, undefined);
  assert.ok(source.migrationBackup, "creating an entry must not mutate the source base");
  assert.ok(source.v2MigrationBackup, "creating an entry must not mutate the source base");
});

test("multi-base store cleaning retains at most one bounded backup of each legacy generation", () => {
  const withBackups = (label: string) => {
    const data = migrateData(null);
    data.settings.workspaceName = label;
    data.migrationBackup = {
      version: 1,
      migratedAt: 1,
      headings: [{ title: `${label} legacy` }],
    };
    data.v2MigrationBackup = {
      version: 2,
      migratedAt: 2,
      collections: [],
      pinnedPaths: [],
      nextStudyPaths: [],
      savedViews: [],
      settings: { workspaceName: label },
    };
    return data;
  };
  const store = {
    kind: STORE_KIND,
    version: STORE_VERSION,
    vaultId: "vault-existing",
    activeBaseId: "base-newer",
    bases: [
      { id: "base-newer", createdAt: 200, updatedAt: 200, semanticRevision: 0, archivedAt: null, data: withBackups("Newer") },
      { id: "base-older", createdAt: 100, updatedAt: 100, semanticRevision: 0, archivedAt: null, data: withBackups("Older") },
    ],
    deletedBaseIds: {},
  };

  const cleaned = migrateStore(store, 999);
  const older = cleaned.bases.find((entry) => entry.id === "base-older");
  const newer = cleaned.bases.find((entry) => entry.id === "base-newer");
  assert.equal(older?.data.migrationBackup?.headings[0] && (older.data.migrationBackup.headings[0] as { title: string }).title, "Older legacy");
  assert.equal(older?.data.v2MigrationBackup?.settings.workspaceName, "Older");
  assert.equal(newer?.data.migrationBackup, undefined);
  assert.equal(newer?.data.v2MigrationBackup, undefined);
  assert.equal(cleaned.bases.filter((entry) => entry.data.migrationBackup).length, 1);
  assert.equal(cleaned.bases.filter((entry) => entry.data.v2MigrationBackup).length, 1);
});

test("future plugin data is interpreted as the latest compatible shape, never as v1", () => {
  const data = migrateData({
    version: 99,
    collections: [{ id: "future", title: "Future collection", collapsed: false, subjects: ["topic.md"], subheadings: [] }],
    pinnedPaths: ["topic.md"],
    settings: { defaultTab: "collections", openNoteBehavior: "split" },
  });
  assert.equal(storedDataVersion({ version: 99 }), 99);
  assert.equal(data.version, DATA_VERSION);
  assert.equal(data.collections[0]?.title, "Future collection");
  assert.equal(data.settings.openNoteBehavior, "split");
  assert.equal(data.migrationBackup, undefined);
});

test("v4 data gains an empty visual curriculum overlay", () => {
  const data = migrateData({ version: 4, collections: [], settings: {} });
  assert.equal(data.version, DATA_VERSION);
  assert.equal(data.settings.workspaceMode, "ent-clinical");
  assert.deepEqual(data.curriculumVisual, { parentByPath: {}, orderByContainer: {} });
});

test("fresh installs start as a configurable generic knowledge base", () => {
  const data = migrateData(null);
  assert.equal(data.version, DATA_VERSION);
  assert.equal(data.settings.workspaceMode, "generic");
  assert.equal(data.settings.setupComplete, false);
  assert.equal(data.settings.workspaceName, "Knowledge Base Command Center");
  assert.equal(data.settings.primaryFolder, "Knowledge Base");
  assert.equal(data.settings.proposalFolder, "Inbox");
  assert.deepEqual(data.directIndexPaths, []);
  assert.deepEqual(data.indexFolderSources, []);
  assert.deepEqual(data.manualIndexPaths, []);
  assert.deepEqual(data.excludedIndexPaths, []);
  assert.deepEqual(data.indexGroupByPath, {});
  assert.deepEqual(data.indexGroupOrder, []);
  assert.equal(data.portableIndex.version, 3);
  assert.deepEqual(data.portableIndex.libraries, []);
  assert.deepEqual(data.portableIndex.libraryLayouts, {});
});

test("v14 generic data migrates primary-folder behavior into one deterministic linked source", () => {
  const raw = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  raw.version = 14;
  delete raw.directIndexPaths;
  delete raw.indexFolderSources;
  raw.manualIndexPaths = ["Research/Outside.md", "Research/Outside.md"];
  raw.settings = {
    ...(raw.settings as Record<string, unknown>),
    workspaceMode: "generic",
    primaryFolder: "Knowledge Base",
  };

  const first = migrateData(raw);
  const expectedSource = createLegacyPrimaryFolderSource("Knowledge Base");
  assert.ok(expectedSource);
  assert.deepEqual(first.directIndexPaths, ["Research/Outside.md"]);
  assert.deepEqual(first.manualIndexPaths, []);
  assert.deepEqual(first.indexFolderSources, [expectedSource]);
  assert.equal(first.indexFolderSources[0]?.id, legacyPrimaryFolderSourceId("Knowledge Base"));
  assert.equal(pathIsInIndexFolderSources("Knowledge Base/Topic.md", first.indexFolderSources), true);
  assert.equal(pathIsInIndexFolderSources("Knowledge Baseball/Topic.md", first.indexFolderSources), false);
  assert.deepEqual(migrateData(structuredClone(first)).indexFolderSources, first.indexFolderSources);
});

test("v14 blank-primary Generic data migrates to a removable vault-root source in flat and enveloped stores", () => {
  const legacy = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  legacy.version = 14;
  delete legacy.indexFolderSources;
  legacy.settings = {
    ...(legacy.settings as Record<string, unknown>),
    workspaceMode: "generic",
    primaryFolder: "",
  };

  const flat = migrateData(structuredClone(legacy));
  assert.deepEqual(flat.indexFolderSources.map((source) => source.path), [INDEX_FOLDER_VAULT_ROOT]);
  assert.equal(pathIsInIndexFolderSources("Root note.md", flat.indexFolderSources), true);
  assert.equal(pathIsInIndexFolderSources("Nested/Topic.md", flat.indexFolderSources), true);
  assert.equal(pathIsInIndexFolderSources(portablePlaceholderPath("unresolved"), flat.indexFolderSources), false);
  assert.equal(configuredGroupFromIndexRoot("A/B/Topic.md", flat.indexFolderSources[0]?.path ?? ""), "A");

  const envelope = createDefaultStore(migrateData(null), 100, "vault-root-legacy");
  envelope.bases[0].data = legacy as unknown as PluginData;
  const enveloped = migrateStore(envelope).bases[0]?.data;
  assert.deepEqual(enveloped?.indexFolderSources, flat.indexFolderSources);
  assert.equal(enveloped?.indexFolderSources[0]?.id, legacyPrimaryFolderSourceId(""));
});

test("pre-v15 Generic migration materializes portable indexed membership only outside the legacy source", () => {
  const raw = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  raw.version = 14;
  delete raw.indexFolderSources;
  raw.directIndexPaths = [];
  raw.settings = {
    ...(raw.settings as Record<string, unknown>),
    workspaceMode: "generic",
    primaryFolder: "Knowledge Base",
  };
  raw.portableIndex = {
    version: 2,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [
      { id: "inside", title: "Inside", groupId: "group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "outside", title: "Outside", groupId: "group", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "placeholder", title: "Placeholder", groupId: "group", parentId: null, order: 2, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "unassigned", title: "Unassigned", groupId: "group", parentId: null, order: 3, indexed: false, configuredId: "", recordKind: "note", libraryId: null },
    ],
    resolvedPathBySubjectId: {
      inside: "Knowledge Base/Inside.md",
      outside: "Elsewhere/Outside.md",
      unassigned: "Elsewhere/Unassigned.md",
    },
  };

  const migrated = migrateData(raw);
  assert.deepEqual(migrated.directIndexPaths, [
    "Elsewhere/Outside.md",
    portablePlaceholderPath("placeholder"),
  ]);
  assert.equal(migrated.directIndexPaths.includes("Knowledge Base/Inside.md"), false);
  assert.equal(migrated.directIndexPaths.includes("Elsewhere/Unassigned.md"), false);
});

test("v14 vault-root migration materializes unresolved portable membership in live and saved states", () => {
  const unresolvedState = (subjectId: string): PluginData => {
    const state = migrateData(null);
    state.settings.workspaceMode = "generic";
    state.settings.primaryFolder = "";
    state.directIndexPaths = [];
    state.indexFolderSources = [];
    state.portableIndex = cleanPortableIndex({
      version: 2,
      groups: [{ id: `${subjectId}-group`, title: subjectId, order: 0 }],
      subjects: [{
        id: subjectId,
        title: subjectId,
        groupId: `${subjectId}-group`,
        parentId: null,
        order: 0,
        indexed: true,
        configuredId: "",
        recordKind: "topic",
      }],
      resolvedPathBySubjectId: {},
    });
    return state;
  };

  const raw = structuredClone(unresolvedState("top")) as unknown as Record<string, unknown>;
  raw.version = 14;
  delete raw.indexFolderSources;
  raw.layoutSnapshots = [snapshotPersonal(unresolvedState("named"), "Named", true, true, true)];
  raw.undoStack = [snapshotPersonal(unresolvedState("undo"), "Undo", true, true, true)];

  const migrated = migrateData(raw);
  assert.deepEqual(migrated.indexFolderSources.map((source) => source.path), [INDEX_FOLDER_VAULT_ROOT]);
  assert.deepEqual(migrated.directIndexPaths, [portablePlaceholderPath("top")]);
  assert.deepEqual(migrated.layoutSnapshots[0]?.indexFolderSources.map((source) => source.path), [INDEX_FOLDER_VAULT_ROOT]);
  assert.deepEqual(migrated.layoutSnapshots[0]?.directIndexPaths, [portablePlaceholderPath("named")]);
  assert.deepEqual(migrated.undoStack[0]?.indexFolderSources.map((source) => source.path), [INDEX_FOLDER_VAULT_ROOT]);
  assert.deepEqual(migrated.undoStack[0]?.directIndexPaths, [portablePlaceholderPath("undo")]);
});

test("v15 requires canonical membership provenance and drops current snapshots that omit it", () => {
  const missingRoot = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  delete missingRoot.directIndexPaths;
  assert.throws(() => migrateData(missingRoot), /canonical index membership provenance/i);
  const missingSources = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  delete missingSources.indexFolderSources;
  assert.throws(() => migrateData(missingSources), /canonical index membership provenance/i);
  const emptySource = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  emptySource.indexFolderSources = [{ id: "empty", path: "///", origin: "user" }];
  assert.throws(() => migrateData(emptySource), /empty path/i);

  const current = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  const invalidSnapshot = snapshotPersonal(migrateData(null), "Missing membership") as unknown as Record<string, unknown>;
  delete invalidSnapshot.indexFolderSources;
  current.layoutSnapshots = [invalidSnapshot];
  current.undoStack = [structuredClone(invalidSnapshot)];
  current.redoStack = [structuredClone(invalidSnapshot)];
  const cleaned = migrateData(current);
  assert.deepEqual(cleaned.layoutSnapshots, []);
  assert.deepEqual(cleaned.undoStack, []);
  assert.deepEqual(cleaned.redoStack, []);

  const invalidPathSnapshot = snapshotPersonal(migrateData(null), "Empty source path") as unknown as Record<string, unknown>;
  invalidPathSnapshot.indexFolderSources = [{ id: "empty", path: "", origin: "user" }];
  const withInvalidPathSnapshot = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  withInvalidPathSnapshot.layoutSnapshots = [invalidPathSnapshot];
  assert.deepEqual(migrateData(withInvalidPathSnapshot).layoutSnapshots, []);
});

test("a full v14 source list reserves one slot for deterministic legacy membership", () => {
  const raw = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  raw.version = 14;
  raw.settings = {
    ...(raw.settings as Record<string, unknown>),
    workspaceMode: "generic",
    primaryFolder: "Legacy Root",
  };
  raw.indexFolderSources = Array.from({ length: MAX_INDEX_FOLDER_SOURCES }, (_, index) => ({
    id: index === 0 ? legacyPrimaryFolderSourceId("Legacy Root") : `source-${String(index)}`,
    path: `User ${String(index)}`,
    origin: "user",
  }));
  const migrated = migrateData(raw);
  assert.equal(migrated.indexFolderSources.length, MAX_INDEX_FOLDER_SOURCES);
  assert.equal(migrated.indexFolderSources[0]?.path, "Legacy Root");
  assert.equal(new Set(migrated.indexFolderSources.map((source) => source.id)).size, MAX_INDEX_FOLDER_SOURCES);
  assert.equal(pathIsInIndexFolderSources("Legacy Root/Future.md", migrated.indexFolderSources), true);
  assert.deepEqual(migrateData(structuredClone(migrated)).indexFolderSources, migrated.indexFolderSources);
});

test("v15 generic data never infers a linked source from its storage folder", () => {
  const current = migrateData({
    version: DATA_VERSION,
    settings: {
      workspaceMode: "generic",
      primaryFolder: "Stored Here",
      defaultNoteFolder: "Stored Here",
    },
    directIndexPaths: [],
    indexFolderSources: [],
    manualIndexPaths: ["Stale/Legacy.md"],
  });
  assert.deepEqual(current.directIndexPaths, []);
  assert.deepEqual(current.indexFolderSources, []);
  assert.deepEqual(current.manualIndexPaths, []);
});

test("clinical migration keeps protected taxonomy behavior separate from linked folders", () => {
  const raw = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  raw.version = 14;
  delete raw.directIndexPaths;
  delete raw.indexFolderSources;
  raw.settings = {
    ...(raw.settings as Record<string, unknown>),
    workspaceMode: "ent-clinical",
    primaryFolder: "03 Clinical Topics",
  };
  assert.deepEqual(migrateData(raw).indexFolderSources, []);
});

test("legacy Undo states inherit deterministic membership without enumerating vault files", () => {
  const raw = structuredClone(migrateData(null)) as unknown as Record<string, unknown>;
  raw.version = 14;
  delete raw.directIndexPaths;
  delete raw.indexFolderSources;
  raw.manualIndexPaths = ["Outside/Current.md"];
  const legacySnapshot = snapshotPersonal(migrateData(null), "Legacy Undo") as unknown as Record<string, unknown>;
  delete legacySnapshot.directIndexPaths;
  delete legacySnapshot.indexFolderSources;
  legacySnapshot.manualIndexPaths = ["Outside/Before.md"];
  raw.undoStack = [legacySnapshot];

  const migrated = migrateData(raw);
  const undo = migrated.undoStack[0];
  assert.deepEqual(undo?.directIndexPaths, ["Outside/Before.md"]);
  assert.deepEqual(undo?.manualIndexPaths, []);
  assert.deepEqual(undo?.indexFolderSources, migrated.indexFolderSources);
});

test("linked-folder cleaning normalizes paths, repairs IDs, and prefers explicit provenance", () => {
  const cleaned = cleanIndexFolderSources([
    { id: "legacy", path: " /Knowledge\\Research// ", origin: "legacy-primary-folder" },
    { id: "explicit", path: "Knowledge/Research", origin: "user" },
    { id: "__proto__", path: "Projects", origin: "user" },
    { id: "empty", path: "///", origin: "user" },
  ]);
  assert.deepEqual(cleaned.map((source) => [source.path, source.origin]), [
    ["Knowledge/Research", "user"],
    ["Projects", "user"],
  ]);
  assert.equal(cleaned[1]?.id.startsWith("index-folder-"), true);
  assert.deepEqual(cleanIndexFolderSources(structuredClone(cleaned)), cleaned);
  assert.equal(pathIsInIndexFolderSources("", cleaned), false);
  assert.equal(pathIsInIndexFolderSources("Projects/Plan.md", [{ id: "blank", path: "", origin: "user" }]), false);

  const oversized = Array.from({ length: MAX_INDEX_FOLDER_SOURCES + 1 }, (_, index) => ({
    id: `source-${String(index)}`,
    path: `Folder ${String(index)}`,
    origin: "user" as const,
  }));
  assert.equal(cleanIndexFolderSources(oversized).length, MAX_INDEX_FOLDER_SOURCES);
  const current = migrateData(null) as unknown as Record<string, unknown>;
  current.indexFolderSources = oversized;
  assert.throws(
    () => migrateData(current),
    /linked index folders has too many entries/u,
  );
});

test("portable store cleaning recovers missing groups and repairs parent invariants idempotently", () => {
  const state = cleanPortableIndex({
    version: 3,
    groups: [
      { id: "group-a", title: "Group A", order: 0 },
      { id: "group-b", title: "Group B", order: 1 },
    ],
    subjects: [
      { id: "root", title: "Root", groupId: "group-a", parentId: null, order: 0, indexed: true, recordKind: "topic" },
      { id: "valid-child", title: "Valid child", groupId: "group-a", parentId: "root", order: 1, indexed: true, recordKind: "topic" },
      { id: "missing-group", title: "Recovered subject", groupId: "group-missing", parentId: "root", order: 2, indexed: true, recordKind: "topic" },
      { id: "missing-group-peer", title: "Recovered peer", groupId: "group-missing", parentId: "missing-group", order: 3, indexed: true, recordKind: "topic" },
      { id: "other-missing-group", title: "Other recovered subject", groupId: "group-other-missing", parentId: "missing-group", order: 4, indexed: true, recordKind: "topic" },
      { id: "self-parent", title: "Self parent", groupId: "group-a", parentId: "self-parent", order: 3, indexed: true, recordKind: "topic" },
      { id: "missing-parent", title: "Missing parent", groupId: "group-a", parentId: "not-present", order: 4, indexed: true, recordKind: "topic" },
      { id: "non-index-parent", title: "Non-index parent", groupId: "group-a", parentId: "root", order: 5, indexed: false, recordKind: "note", libraryId: null },
      { id: "child-of-non-index", title: "Child of non-index", groupId: "group-a", parentId: "non-index-parent", order: 6, indexed: true, recordKind: "topic" },
      { id: "cross-group", title: "Cross group", groupId: "group-b", parentId: "root", order: 7, indexed: true, recordKind: "topic" },
      { id: "cycle-a", title: "Cycle A", groupId: "group-a", parentId: "cycle-b", order: 8, indexed: true, recordKind: "topic" },
      { id: "cycle-b", title: "Cycle B", groupId: "group-a", parentId: "cycle-a", order: 9, indexed: true, recordKind: "topic" },
    ],
    resolvedPathBySubjectId: {
      "missing-group": "Knowledge Base/Recovered subject.md",
      "valid-child": "Knowledge Base/Valid child.md",
    },
    libraries: [],
    libraryLayouts: {},
  });

  assert.equal(state.subjects.length, 12);
  const recovered = state.subjects.find((subject) => subject.id === "missing-group");
  assert.ok(recovered);
  assert.equal(state.groups.find((group) => group.id === recovered.groupId)?.title, "Recovered / Ungrouped");
  assert.equal(state.resolvedPathBySubjectId[recovered.id], "Knowledge Base/Recovered subject.md");
  assert.equal(state.subjects.find((subject) => subject.id === "valid-child")?.parentId, "root");
  assert.equal(state.subjects.find((subject) => subject.id === "missing-group-peer")?.parentId, "missing-group");
  for (const id of ["missing-group", "other-missing-group", "self-parent", "missing-parent", "non-index-parent", "child-of-non-index", "cross-group", "cycle-b"]) {
    assert.equal(state.subjects.find((subject) => subject.id === id)?.parentId, null, id);
  }
  assert.equal(state.subjects.find((subject) => subject.id === "cycle-a")?.parentId, "cycle-b");
  assert.deepEqual(cleanPortableIndex(state), state);
});

test("legacy portable library groups migrate into isolated flat catalog layouts", () => {
  const state = cleanPortableIndex({
    version: 1,
    groups: [
      { id: "group-procedure-general", title: "General", order: 1 },
      { id: "group-medication-general", title: "General", order: 0 },
    ],
    subjects: [
      { id: "procedure-one", title: "Procedure", groupId: "group-procedure-general", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "procedure" },
      { id: "medication-one", title: "Medication", groupId: "group-medication-general", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    ],
    resolvedPathBySubjectId: {},
  });

  assert.equal(state.version, 3);
  assert.deepEqual(state.libraryLayouts.procedure.map((heading) => [heading.title, heading.subjects]), [["General", ["procedure-one"]]]);
  assert.deepEqual(state.libraryLayouts.medication.map((heading) => [heading.title, heading.subjects]), [["General", ["medication-one"]]]);
  assert.notEqual(state.libraryLayouts.procedure[0]?.id, state.libraryLayouts.medication[0]?.id);
});

test("explicit library layouts reject cross-catalog placement, deduplicate, and preserve unplaced subjects", () => {
  const state = cleanPortableIndex({
    version: 2,
    groups: [{ id: "group-general", title: "General", order: 0 }],
    subjects: [
      { id: "medication-one", title: "One", groupId: "group-general", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
      { id: "medication-unplaced", title: "Unplaced", groupId: "group-general", parentId: null, order: 1, indexed: false, configuredId: "", recordKind: "medication" },
      { id: "procedure-one", title: "Procedure", groupId: "group-general", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "procedure" },
    ],
    resolvedPathBySubjectId: {},
    libraryLayouts: {
      procedure: [],
      medication: [{
        id: "medications",
        title: "Medications",
        collapsed: false,
        subjects: ["medication-one", "medication-one", "procedure-one"],
        subheadings: [{ id: "nasal", title: "Nasal", collapsed: false, subjects: ["medication-one"] }],
      }],
      syndrome: [],
    },
  });

  assert.deepEqual(state.libraryLayouts.medication[0]?.subjects, ["medication-one"]);
  assert.deepEqual(state.libraryLayouts.medication[0]?.subheadings[0]?.subjects, []);
  assert.equal(JSON.stringify(state.libraryLayouts).includes("procedure-one"), false);
  assert.equal(JSON.stringify(state.libraryLayouts).includes("medication-unplaced"), false);
  assert.deepEqual(cleanPortableIndex(state).libraryLayouts, state.libraryLayouts);
});

test("dynamic library helpers use safe stable IDs and reversible tab identities", () => {
  assert.deepEqual(BUILTIN_LIBRARY_IDS, { procedure: "procedure", medication: "medication", syndrome: "syndrome" });
  assert.equal(BUILTIN_LIBRARY_DEFINITIONS.length, 3);
  assert.equal(libraryTabId("research-notes"), "library:research-notes");
  assert.equal(libraryIdFromTab("library:research-notes"), "research-notes");
  assert.equal(libraryIdFromTab("library:__proto__"), null);
  assert.equal(isValidLibraryId("research-notes"), true);
  assert.equal(isValidLibraryId("__proto__"), false);
  assert.equal(isValidLibraryId("bad id"), false);
  assert.throws(() => libraryTabId("bad id"), /invalid stable ID/i);
});

test("v2 fixed catalogs migrate losslessly into stable dynamic libraries", () => {
  const state = cleanPortableIndex({
    version: 2,
    groups: [
      { id: "group-medications", title: "Medication source group", order: 0 },
      { id: "group-topics", title: "Topics", order: 1 },
    ],
    subjects: [
      { id: "placed", title: "Placed", groupId: "group-medications", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
      { id: "unplaced", title: "Unplaced", groupId: "group-medications", parentId: null, order: 1, indexed: false, configuredId: "", recordKind: "medication" },
      { id: "indexed", title: "Indexed", groupId: "group-topics", parentId: null, order: 2, indexed: true, configuredId: "", recordKind: "medication" },
    ],
    resolvedPathBySubjectId: {},
    libraryLayouts: {
      medication: [{
        id: "medication-heading",
        title: "Intranasal",
        collapsed: true,
        subjects: [],
        subheadings: [{ id: "antihistamines", title: "Antihistamines", collapsed: false, subjects: ["placed"] }],
      }],
    },
  });

  assert.equal(state.version, 3);
  assert.deepEqual(state.libraries.map((library) => library.id), ["medication"]);
  assert.equal(subjectLibraryId(state.subjects.find((subject) => subject.id === "placed")!), "medication");
  assert.equal(subjectLibraryId(state.subjects.find((subject) => subject.id === "unplaced")!), "medication");
  assert.equal(subjectLibraryId(state.subjects.find((subject) => subject.id === "indexed")!), null);
  assert.deepEqual(state.libraryLayouts.medication, [{
    id: "medication-heading",
    title: "Intranasal",
    collapsed: true,
    subjects: [],
    subheadings: [{ id: "antihistamines", title: "Antihistamines", collapsed: false, subjects: ["placed"] }],
  }]);
  assert.equal(JSON.stringify(state.libraryLayouts).includes("unplaced"), false);
});

test("custom empty libraries and layouts survive cleaning and clone independently", () => {
  const state = cleanPortableIndex({
    version: 3,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [{
      id: "paper",
      title: "Paper",
      groupId: "group",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "note",
      libraryId: "research",
    }],
    resolvedPathBySubjectId: {},
    libraries: [{ id: "research", name: "Research", singularName: "Paper", icon: "flask-conical", order: 4, sourceKind: null, archivedAt: null }],
    libraryLayouts: { research: [] },
  });

  assert.deepEqual(state.libraries, [{ id: "research", name: "Research", singularName: "Paper", icon: "flask-conical", order: 4, sourceKind: null, archivedAt: null }]);
  assert.deepEqual(state.libraryLayouts, { research: [] });
  assert.equal(subjectLibraryId(state.subjects[0]), "research");
  const clone = cloneLibraryLayouts(state.libraryLayouts);
  clone.research.push({ id: "heading", title: "Heading", collapsed: false, subjects: [], subheadings: [] });
  assert.deepEqual(state.libraryLayouts.research, []);
});

test("system-library ensuring is idempotent and legacy plural tabs migrate", () => {
  const genericState = cleanPortableIndex({ version: 3, groups: [], subjects: [], resolvedPathBySubjectId: {}, libraries: [], libraryLayouts: {} });
  assert.deepEqual(cleanLibraryDefinitions([], {}, []), []);
  assert.deepEqual(emptyLibraryLayouts(), {});
  ensureSystemLibraries(genericState);
  ensureSystemLibraries(genericState);
  assert.deepEqual(genericState.libraries.map((library) => library.id), ["procedure", "medication", "syndrome"]);
  assert.deepEqual(Object.keys(genericState.libraryLayouts), ["procedure", "medication", "syndrome"]);

  const data = migrateData({
    version: 11,
    activeTab: "medications",
    savedViews: [{ id: "meds", name: "My medications", tab: "medications", query: "" }],
    settings: { workspaceMode: "ent-clinical", defaultTab: "procedures" },
    portableIndex: { version: 2, groups: [], subjects: [], resolvedPathBySubjectId: {}, libraryLayouts: { procedure: [], medication: [], syndrome: [] } },
  });
  assert.equal(data.activeTab, "library:medication");
  assert.equal(data.settings.defaultTab, "library:procedure");
  assert.equal(data.savedViews[0]?.tab, "library:medication");
  assert.deepEqual(data.portableIndex.libraries.map((library) => library.id), ["procedure", "medication", "syndrome"]);

  const genericLegacyTab = migrateData({
    version: 11,
    activeTab: "syndromes",
    settings: { workspaceMode: "generic" },
    portableIndex: { version: 2, groups: [], subjects: [], resolvedPathBySubjectId: {}, libraryLayouts: { procedure: [], medication: [], syndrome: [] } },
  });
  assert.equal(genericLegacyTab.activeTab, "library:syndrome");
  assert.deepEqual(genericLegacyTab.portableIndex.libraries.map((library) => library.id), ["syndrome"]);
});

test("v7 generic organization consumes manual index paths into canonical direct membership", () => {
  const data = migrateData({
    version: 7,
    manualIndexPaths: ["Research/Outside.md"],
    excludedIndexPaths: ["Knowledge Base/Hidden.md"],
    indexGroupByPath: { "Research/Outside.md": "Research" },
    indexGroupOrder: ["Research", "Projects"],
    settings: { workspaceMode: "generic", setupComplete: true, workspaceName: "My KB" },
  });
  assert.equal(data.version, DATA_VERSION);
  assert.equal(data.settings.workspaceMode, "generic");
  assert.equal(data.settings.workspaceName, "My KB");
  assert.deepEqual(data.directIndexPaths, ["Research/Outside.md"]);
  assert.deepEqual(data.manualIndexPaths, []);
  assert.deepEqual(data.indexFolderSources, [createLegacyPrimaryFolderSource("Knowledge Base")]);
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

test("contextual template tokens are YAML-quoted while legacy tokens stay unchanged", () => {
  const rendered = applyTemplateTokens(
    [
      "title: {{yaml:title}}",
      "id: {{yaml:id}}",
      "category: {{yaml:category}}",
      "parent: {{yaml:parent}}",
      "library: {{yaml:library}}",
      "type: {{yaml:type}}",
      "unknown: {{yaml:future}}",
    ].join("\n"),
    "A: title # kept legacy",
    "2026-08-11",
    "09:30",
    {
      id: "ID: [one]",
      category: "Airway #1",
      parent: "quoted \"parent\"\nline",
      library: "مراجع",
      type: "Paper",
    },
  );
  assert.equal(rendered, [
    "title: \"A: title # kept legacy\"",
    "id: \"ID: [one]\"",
    "category: \"Airway #1\"",
    "parent: \"quoted \\\"parent\\\"\\nline\"",
    "library: \"مراجع\"",
    "type: \"Paper\"",
    "unknown: {{yaml:future}}",
  ].join("\n"));
  assert.equal(
    applyTemplateTokens("title: {{yaml:title}}\nid: {{yaml:id}}", "A: title", "date", "time"),
    "title: \"A: title\"\nid: \"\"",
  );
  assert.equal(
    applyTemplateTokens(
      "title: {{title}}\nid: {{yaml:id}}",
      "{{yaml:id}}",
      "date",
      "time",
      { id: "{{title}}\u0085unsafe" },
    ),
    "title: {{yaml:id}}\nid: \"{{title}}\\u0085unsafe\"",
    "legacy values cannot inject contextual tokens and contextual values cannot trigger legacy expansion",
  );
});

test("Library note profiles clean strictly, stay bounded to real Libraries, and inherit by field", () => {
  const data = migrateData(null);
  data.portableIndex.libraries = [{
    id: "library-research",
    name: "Research",
    singularName: "Paper",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  const cleaned = cleanLibraryNoteProfiles({
    "library-research": { folder: " Research//Papers/ ", mode: "template", templatePath: "/Templates/Paper.md", ignored: "x" },
    "missing-library": { folder: "Missing" },
    "__proto__": { folder: "Unsafe" },
    "library-bad-path": { folder: "../Outside" },
  }, new Set(["library-research"]));
  assert.deepEqual(cleaned, {
    "library-research": { folder: "Research/Papers", mode: "template", templatePath: "Templates/Paper.md" },
  });
  data.settings.defaultNoteFolder = "Knowledge Base";
  data.settings.defaultNewNoteMode = "empty";
  data.settings.defaultTemplatePath = "Templates/Default.md";
  data.settings.libraryNoteProfiles = { "library-research": { mode: "template" } };
  assert.deepEqual(resolveLibraryNoteProfile(data.settings, "library-research"), {
    folder: "Knowledge Base",
    mode: "template",
    templatePath: "Templates/Default.md",
    inherited: { folder: true, mode: false, templatePath: true },
  });
  assert.equal(validateLibraryNoteProfile(
    { folder: "Research", mode: "template", templatePath: "Templates/Paper.md" },
    data.settings,
    "library-research",
    ".obsidian",
  ), null);
  assert.match(validateLibraryNoteProfile(
    { folder: ".obsidian/plugins" },
    data.settings,
    "library-research",
    ".obsidian",
  ) ?? "", /cannot be inside/);
});

test("migration drops orphaned and hostile Library creation profiles without changing data version", () => {
  const raw = migrateData(null) as unknown as Record<string, unknown>;
  const portableIndex = structuredClone(raw.portableIndex) as ReturnType<typeof migrateData>["portableIndex"];
  portableIndex.libraries = [{
    id: "library-valid",
    name: "Valid",
    singularName: "Item",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: Date.now(),
  }];
  const migrated = migrateData({
    ...raw,
    portableIndex,
    settings: {
      ...(raw.settings as object),
      libraryNoteProfiles: {
        "library-valid": { folder: "Archive", mode: "empty", templatePath: "" },
        "library-orphan": { folder: "Orphan" },
        "library-invalid": { folder: "05 Sources/_books/Book" },
      },
    },
  });
  assert.deepEqual(migrated.settings.libraryNoteProfiles, {
    "library-valid": { folder: "Archive", mode: "empty", templatePath: "" },
  });
  assert.equal(migrated.version, DATA_VERSION);
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
  data.directIndexPaths = ["Outside/Topic.md"];
  data.indexFolderSources = [{ id: "index-folder-research", path: "Research", origin: "user" }];
  data.excludedIndexPaths = ["Knowledge Base/Hidden.md"];
  data.indexGroupByPath["Outside/Topic.md"] = "Airway";
  data.displayNameByPath["Outside/Topic.md"] = "Airway overview";
  data.indexGroupAliases.airway = "Airway";
  data.indexGroupOrder = ["Airway"];
  data.portableIndex = cleanPortableIndex({
    version: 2,
    groups: [{ id: "medication-group", title: "Medication", order: 0 }],
    subjects: [{ id: "medication-subject", title: "Allergodil", groupId: "medication-group", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" }],
    resolvedPathBySubjectId: {},
    libraryLayouts: {
      procedure: [],
      medication: [{ id: "medication-heading", title: "Nasal", collapsed: false, subjects: ["medication-subject"], subheadings: [] }],
      syndrome: [],
    },
  });
  data.portableIndex.libraries.push({
    id: "library-reading",
    name: "Reading",
    singularName: "Article",
    icon: "book-open",
    order: data.portableIndex.libraries.length,
    sourceKind: null,
    archivedAt: null,
  });
  data.portableIndex.groups.push({ id: "reading-group", title: "Reading", order: 1 });
  data.portableIndex.subjects.push({
    id: "reading-subject",
    title: "Airway review",
    groupId: "reading-group",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "note",
    libraryId: "library-reading",
  });
  data.portableIndex.libraryLayouts["library-reading"] = [{
    id: "reading-heading",
    title: "To read",
    collapsed: true,
    subjects: ["reading-subject"],
    subheadings: [],
  }];
  const backup = createPersonalBackup(data, "2026-08-07T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  const parsed = parsePersonalBackup(JSON.parse(JSON.stringify(backup)) as unknown);
  assert.equal(backup.version, 11);
  assert.equal(parsed.version, 11);
  assert.equal(parsed.indexFolderSourcesIncluded, true);
  assert.equal(parsed.sourceVaultId, "vault-ent-main");
  assert.equal(parsed.sourceBaseId, "base-ent");
  assert.equal(parsed.sourceBaseName, "ENT");
  assert.equal(parsed.sourceWorkspaceMode, "generic");
  assert.equal(parsed.collections[0]?.title, "Airway");
  assert.deepEqual(parsed.pinnedPaths, [record().path]);
  assert.equal(parsed.curriculumVisual.parentByPath[record().path], null);
  assert.deepEqual(parsed.directIndexPaths, ["Outside/Topic.md"]);
  assert.deepEqual(parsed.indexFolderSources, data.indexFolderSources);
  assert.deepEqual(parsed.manualIndexPaths, []);
  assert.deepEqual(parsed.excludedIndexPaths, ["Knowledge Base/Hidden.md"]);
  assert.equal(parsed.indexGroupByPath["Outside/Topic.md"], "Airway");
  assert.equal(parsed.displayNameByPath["Outside/Topic.md"], "Airway overview");
  assert.equal(parsed.indexGroupAliases.airway, "Airway");
  assert.deepEqual(parsed.indexGroupOrder, ["Airway"]);
  assert.deepEqual(parsed.portableIndex.libraryLayouts.medication, data.portableIndex.libraryLayouts.medication);
  assert.equal(parsed.portableIndex.libraries.some((library) => library.id === "library-reading"), true);
  assert.deepEqual(parsed.portableIndex.libraryLayouts["library-reading"], data.portableIndex.libraryLayouts["library-reading"]);
  const versionEight = structuredClone(backup) as unknown as Record<string, unknown>;
  versionEight.version = 8;
  delete versionEight.indexFolderSourcesIncluded;
  delete versionEight.directIndexPaths;
  delete versionEight.indexFolderSources;
  const migratedVersionEight = parsePersonalBackup(versionEight);
  assert.equal(migratedVersionEight.version, 11);
  assert.equal(migratedVersionEight.indexFolderSourcesIncluded, false);
  assert.equal(migratedVersionEight.portableIndex.libraries.some((library) => library.id === "library-reading"), true);
  assert.deepEqual(migratedVersionEight.portableIndex.libraryLayouts["library-reading"], data.portableIndex.libraryLayouts["library-reading"]);
  assert.equal("settings" in parsed, false);
});

test("v11 recovery requires linked-folder arrays at the root and throughout retained history", () => {
  const data = migrateData(null);
  data.layoutSnapshots = [snapshotPersonal(data, "Named")];
  const backup = createPersonalBackup(data, "2026-08-14T00:00:00.000Z", "vault", "base-default", "Generic");

  const missingRoot = structuredClone(backup) as unknown as Record<string, unknown>;
  delete missingRoot.indexFolderSources;
  assert.throws(() => parsePersonalBackup(missingRoot), /missing canonical.*membership/i);

  const missingDirect = structuredClone(backup) as unknown as Record<string, unknown>;
  delete missingDirect.directIndexPaths;
  assert.throws(() => parsePersonalBackup(missingDirect), /missing canonical.*membership/i);

  const missingNested = structuredClone(backup) as unknown as Record<string, unknown>;
  const snapshots = missingNested.layoutSnapshots as Array<Record<string, unknown>>;
  delete snapshots[0]?.indexFolderSources;
  assert.throws(() => parsePersonalBackup(missingNested), /snapshot.*missing canonical.*membership/i);

  const emptyPath = structuredClone(backup) as unknown as Record<string, unknown>;
  emptyPath.indexFolderSources = [{ id: "empty", path: "///", origin: "user" }];
  assert.throws(() => parsePersonalBackup(emptyPath), /empty path/i);

  const legacy = structuredClone(missingNested);
  legacy.version = 10;
  delete legacy.indexFolderSourcesIncluded;
  delete legacy.indexFolderSources;
  assert.equal(parsePersonalBackup(legacy).indexFolderSourcesIncluded, false);
});

test("legacy recovery preserves destination sources and backfills portable membership recursively", () => {
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.settings.primaryFolder = "Source Root";
  source.directIndexPaths = [];
  source.indexFolderSources = [];
  source.portableIndex = cleanPortableIndex({
    version: 2,
    groups: [{ id: "top-group", title: "Top", order: 0 }],
    subjects: [{ id: "top", title: "Top", groupId: "top-group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { top: "Outside/Top.md" },
  });

  const snapshotData = migrateData(null);
  snapshotData.settings.workspaceMode = "generic";
  snapshotData.settings.primaryFolder = "Snapshot Root";
  snapshotData.portableIndex = cleanPortableIndex({
    version: 2,
    groups: [{ id: "snapshot-group", title: "Snapshot", order: 0 }],
    subjects: [{ id: "snapshot", title: "Snapshot", groupId: "snapshot-group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { snapshot: "Outside/Snapshot.md" },
  });
  const named = snapshotPersonal(snapshotData, "Named", true, true, true);
  const nestedData = migrateData(null);
  nestedData.portableIndex = cleanPortableIndex({
    version: 2,
    groups: [{ id: "nested-group", title: "Nested", order: 0 }],
    subjects: [{ id: "nested", title: "Nested", groupId: "nested-group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { nested: "Outside/Nested.md" },
  });
  named.layoutSnapshots = [snapshotPersonal(nestedData, "Nested", false, true)];
  source.layoutSnapshots = [named];

  const raw = structuredClone(createPersonalBackup(
    source,
    "2026-08-14T00:00:00.000Z",
    "vault-recovery",
    "base-default",
    "Generic",
  )) as unknown as Record<string, unknown>;
  raw.version = 10;
  delete raw.indexFolderSourcesIncluded;
  delete raw.indexFolderSources;
  raw.directIndexPaths = [];
  const rawNamed = (raw.layoutSnapshots as Array<Record<string, unknown>>)[0];
  delete rawNamed.indexFolderSources;
  rawNamed.directIndexPaths = [];
  const rawNested = (rawNamed.layoutSnapshots as Array<Record<string, unknown>>)[0];
  delete rawNested.indexFolderSources;
  rawNested.directIndexPaths = [];
  const parsed = parsePersonalBackup(raw);

  const standalone = migrateData(null);
  standalone.settings.workspaceMode = "generic";
  standalone.indexFolderSources = [{ id: "destination", path: "Destination", origin: "user" }];
  applyPersonalBackupToData(standalone, parsed);
  assert.deepEqual(standalone.indexFolderSources.map((sourceEntry) => sourceEntry.path), ["Destination"]);
  assert.deepEqual(standalone.directIndexPaths, ["Outside/Top.md"]);
  assert.deepEqual(standalone.layoutSnapshots[0]?.indexFolderSources.map((sourceEntry) => sourceEntry.path), ["Snapshot Root"]);
  assert.deepEqual(standalone.layoutSnapshots[0]?.directIndexPaths, ["Outside/Snapshot.md"]);
  assert.deepEqual(standalone.layoutSnapshots[0]?.layoutSnapshots?.[0]?.indexFolderSources.map((sourceEntry) => sourceEntry.path), ["Snapshot Root"]);
  assert.deepEqual(standalone.layoutSnapshots[0]?.layoutSnapshots?.[0]?.directIndexPaths, ["Outside/Nested.md"]);

  const portableTarget = migrateData(null);
  portableTarget.settings.workspaceMode = "generic";
  portableTarget.indexFolderSources = [{ id: "portable-destination", path: "Portable Destination", origin: "user" }];
  const packageValue: PortableExportV1 = {
    kind: PORTABLE_EXPORT_KIND,
    version: 5,
    exportedAt: "2026-08-14T00:00:00.000Z",
    sourceWorkspace: "",
    components: { recovery: parsed },
  };
  applyPortableExport(
    portableTarget,
    packageValue,
    portableSelection({ recovery: true }),
    "replace",
    "vault-recovery",
    () => true,
    "base-default",
    "Generic",
  );
  assert.deepEqual(portableTarget.indexFolderSources.map((sourceEntry) => sourceEntry.path), ["Portable Destination"]);
  assert.deepEqual(portableTarget.directIndexPaths, ["Outside/Top.md"]);
  assert.deepEqual(portableTarget.layoutSnapshots[0]?.directIndexPaths, ["Outside/Snapshot.md"]);
});

test("legacy recovery with a vault-root source preserves unresolved portable membership", () => {
  const unresolvedState = (subjectId: string): PluginData => {
    const state = migrateData(null);
    state.settings.workspaceMode = "generic";
    state.settings.primaryFolder = "";
    state.directIndexPaths = [];
    state.indexFolderSources = [];
    state.portableIndex = cleanPortableIndex({
      version: 2,
      groups: [{ id: `${subjectId}-group`, title: subjectId, order: 0 }],
      subjects: [{
        id: subjectId,
        title: subjectId,
        groupId: `${subjectId}-group`,
        parentId: null,
        order: 0,
        indexed: true,
        configuredId: "",
        recordKind: "topic",
      }],
      resolvedPathBySubjectId: {},
    });
    return state;
  };

  const source = unresolvedState("recovery-top");
  source.layoutSnapshots = [snapshotPersonal(
    unresolvedState("recovery-named"),
    "Named root recovery",
    true,
    true,
    true,
  )];
  const raw = structuredClone(createPersonalBackup(
    source,
    "2026-08-14T00:00:00.000Z",
    "vault-root-recovery",
    "base-default",
    "Generic",
  )) as unknown as Record<string, unknown>;
  raw.version = 10;
  delete raw.indexFolderSourcesIncluded;
  delete raw.indexFolderSources;
  raw.directIndexPaths = [];
  const rawSnapshot = (raw.layoutSnapshots as Array<Record<string, unknown>>)[0];
  delete rawSnapshot.indexFolderSources;
  rawSnapshot.directIndexPaths = [];

  const target = migrateData(null);
  target.settings.workspaceMode = "generic";
  target.settings.primaryFolder = "";
  target.indexFolderSources = [{
    id: legacyPrimaryFolderSourceId(""),
    path: INDEX_FOLDER_VAULT_ROOT,
    origin: "legacy-primary-folder",
  }];
  applyPersonalBackupToData(target, parsePersonalBackup(raw));

  assert.deepEqual(target.indexFolderSources.map((sourceEntry) => sourceEntry.path), [INDEX_FOLDER_VAULT_ROOT]);
  assert.deepEqual(target.directIndexPaths, [portablePlaceholderPath("recovery-top")]);
  assert.deepEqual(target.layoutSnapshots[0]?.indexFolderSources.map((sourceEntry) => sourceEntry.path), [INDEX_FOLDER_VAULT_ROOT]);
  assert.deepEqual(target.layoutSnapshots[0]?.directIndexPaths, [portablePlaceholderPath("recovery-named")]);
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
  assert.equal(parsed.version, 11);
  assert.equal(parsed.indexFolderSourcesIncluded, false);
  assert.equal(parsed.sourceVaultId, "");
  assert.equal(parsed.sourceBaseId, "");
  assert.equal(parsed.sourceWorkspaceMode, "");
  assert.deepEqual(parsed.manualIndexPaths, []);
  assert.deepEqual(parsed.directIndexPaths, []);
  assert.deepEqual(parsed.indexFolderSources, []);
  assert.deepEqual(parsed.excludedIndexPaths, []);
  assert.deepEqual(parsed.indexGroupByPath, {});
  assert.deepEqual(parsed.displayNameByPath, {});
  assert.deepEqual(parsed.indexGroupAliases, {});
  assert.deepEqual(parsed.indexGroupOrder, []);
});

test("portable workspace configuration round-trips settings and group order without note paths", () => {
  const data = migrateData(null);
  data.portableIndex.libraries = [{
    id: "library-research",
    name: "Research",
    singularName: "Paper",
    icon: "microscope",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  data.portableIndex.libraryLayouts = { "library-research": [] };
  data.settings.workspaceName = "Research Command Center";
  data.settings.allowClinicalVisualGroupMoves = true;
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Assets/Knowledge attachments";
  data.settings.followUpCategories = [{
    id: "questions",
    label: "Questions to resolve",
    style: "checkbox",
    includeDate: true,
    archived: false,
  }];
  data.settings.libraryNoteProfiles = {
    "library-research": { folder: "Research/Papers", mode: "template", templatePath: "Templates/Paper.md" },
    "orphaned-library": { folder: "Private/Orphaned" },
  };
  data.indexGroupOrder = ["Projects", "Reading"];
  data.manualIndexPaths = ["Private/Note.md"];
  const config = createWorkspaceConfig(data, "2026-08-07T00:00:00.000Z");
  assert.equal(config.version, 2, "new settings exports use a compatibility boundary older builds reject");
  const parsed = parseWorkspaceConfig(JSON.parse(JSON.stringify(config)) as unknown);
  assert.equal(parsed.settings.workspaceName, "Research Command Center");
  assert.equal(parsed.settings.allowClinicalVisualGroupMoves, true);
  assert.equal(parsed.settings.attachmentStorageMode, "fixed-folder");
  assert.equal(parsed.settings.attachmentFolder, "Assets/Knowledge attachments");
  assert.deepEqual(parsed.settings.followUpCategories, data.settings.followUpCategories);
  assert.deepEqual(parsed.settings.libraryNoteProfiles, {
    "library-research": { folder: "Research/Papers", mode: "template", templatePath: "Templates/Paper.md" },
  });
  assert.deepEqual(parsed.indexGroupOrder, ["Projects", "Reading"]);
  assert.equal("manualIndexPaths" in parsed, false);
  assert.equal(JSON.stringify(parsed).includes("Private/Note.md"), false);
  assert.equal(JSON.stringify(parsed).includes("Private/Orphaned"), false);

  const legacy = structuredClone(config);
  legacy.version = 1;
  assert.equal(parseWorkspaceConfig(legacy).version, 1, "legacy version-1 workspace settings remain importable");
  assert.throws(() => parseWorkspaceConfig({ ...config, version: 3 }), /unsupported/i);
});

test("workspace parsing rejects Quick Append settings without an active category", () => {
  const data = migrateData(null);
  const archived = createWorkspaceConfig(data, "2026-08-12T00:00:00.000Z");
  archived.settings.followUpCategories = archived.settings.followUpCategories.map((category) => ({
    ...category,
    archived: true,
  }));
  assert.throws(() => parseWorkspaceConfig(archived), /at least one active category/u);

  const malformed = createWorkspaceConfig(data, "2026-08-12T00:00:00.000Z") as unknown as {
    settings: { followUpCategories: unknown };
  };
  malformed.settings.followUpCategories = [{ id: "bad id", label: "", style: "unknown" }];
  assert.throws(() => parseWorkspaceConfig(malformed), /at least one active category/u);
});

test("legacy standalone workspace import drops profiles without destination Library identities", () => {
  const source = migrateData(null);
  const legacyConfig = createWorkspaceConfig(source, "2026-08-11T00:00:00.000Z");
  legacyConfig.settings.libraryNoteProfiles = {
    "library-local": { folder: "Local references", mode: "empty" },
    "library-missing": { folder: "Missing references", mode: "empty" },
  };
  const value = parseAnyCommandCenterExport(JSON.parse(JSON.stringify(legacyConfig)) as unknown);
  const target = migrateData(null);
  target.portableIndex.libraries = [{
    id: "library-local",
    name: "Local",
    singularName: "Reference",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  target.portableIndex.libraryLayouts = { "library-local": [] };

  applyPortableExport(target, value, portableSelection({ workspace: true }), "replace");

  assert.deepEqual(target.settings.libraryNoteProfiles, {
    "library-local": { folder: "Local references", mode: "empty" },
  });
  assert.equal(JSON.stringify(target.settings).includes("Missing references"), false);
});

test("portable workspace exports carry every Library needed by creation profiles", () => {
  const source = migrateData(null);
  const library: LibraryDefinition = {
    id: "library-research",
    name: "Research",
    singularName: "Paper",
    icon: "microscope",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  };
  source.portableIndex.libraries = [library];
  source.portableIndex.libraryLayouts = { [library.id]: [] };
  source.settings.libraryNoteProfiles = {
    [library.id]: { folder: "Research/Papers", mode: "empty" },
  };
  const value = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ workspace: true }),
    "2026-08-11T00:00:00.000Z",
  ));
  assert.deepEqual(value.components.index?.libraries.map((item) => item.id), [library.id]);

  const target = migrateData(null);
  applyPortableExport(target, value, portableSelection({ workspace: true }), "replace");
  assert.equal(target.portableIndex.libraries.find((item) => item.id === library.id)?.name, "Research");
  assert.deepEqual(target.settings.libraryNoteProfiles[library.id], {
    folder: "Research/Papers",
    mode: "empty",
  });

  const missingDescriptor = structuredClone(value) as unknown as {
    components: { index: { libraries: LibraryDefinition[] } };
  };
  missingDescriptor.components.index.libraries = [];
  assert.throws(() => parsePortableExport(missingDescriptor), /references library library-research without a definition/i);
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

test("legacy v1-v3 workspace-only imports synthesize a referenced built-in library in a generic base", () => {
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.settings.defaultTab = libraryTabId(BUILTIN_LIBRARY_IDS.medication);
  const workspace = createWorkspaceConfig(source, "2026-08-09T00:00:00.000Z");

  for (const version of [1, 2, 3] as const) {
    const value = parsePortableExport({
      kind: PORTABLE_EXPORT_KIND,
      version,
      exportedAt: "2026-08-09T00:00:00.000Z",
      sourceWorkspace: "Legacy generic KB",
      components: { workspace },
    });
    const target = migrateData(null);
    target.settings.workspaceMode = "generic";

    applyPortableExport(target, value, portableSelection({ workspace: true }), "replace");

    const medication = target.portableIndex.libraries.find((library) => library.id === BUILTIN_LIBRARY_IDS.medication);
    assert.equal(medication?.sourceKind, "medication", `portable v${version}`);
    assert.equal(medication?.archivedAt, null, `portable v${version}`);
    assert.deepEqual(target.portableIndex.libraryLayouts[BUILTIN_LIBRARY_IDS.medication], [], `portable v${version}`);
    assert.equal(target.settings.defaultTab, libraryTabId(BUILTIN_LIBRARY_IDS.medication), `portable v${version}`);
  }

  const unknownWorkspace = structuredClone(workspace);
  unknownWorkspace.settings.defaultTab = libraryTabId("library-without-a-legacy-descriptor");
  const unknownValue = parsePortableExport({
    kind: PORTABLE_EXPORT_KIND,
    version: 1,
    exportedAt: "2026-08-09T00:00:00.000Z",
    sourceWorkspace: "Legacy generic KB",
    components: { workspace: unknownWorkspace },
  });
  const unknownTarget = migrateData(null);
  applyPortableExport(unknownTarget, unknownValue, portableSelection({ workspace: true }), "replace");
  assert.equal(unknownTarget.settings.defaultTab, "curriculum", "unknown legacy library identities are sanitized, not invented");
});

test("legacy v1-v3 saved-view-only imports synthesize built-in navigation dependencies in a generic base", () => {
  for (const version of [1, 2, 3] as const) {
    const value = parsePortableExport({
      kind: PORTABLE_EXPORT_KIND,
      version,
      exportedAt: "2026-08-09T00:00:00.000Z",
      sourceWorkspace: "",
      components: {
        savedViews: {
          version: 1,
          views: [
            { id: "syndromes", name: "Syndrome review", tab: "syndromes", query: "image:missing" },
            { id: "unknown", name: "Unknown custom library", tab: "library:unknown-legacy", query: "" },
          ],
        },
      },
    });
    const target = migrateData(null);
    target.settings.workspaceMode = "generic";

    const result = applyPortableExport(target, value, portableSelection({ savedViews: true }), "replace");

    const syndrome = target.portableIndex.libraries.find((library) => library.id === BUILTIN_LIBRARY_IDS.syndrome);
    assert.equal(syndrome?.sourceKind, "syndrome", `portable v${version}`);
    assert.equal(syndrome?.archivedAt, null, `portable v${version}`);
    assert.equal(target.savedViews[0]?.tab, libraryTabId(BUILTIN_LIBRARY_IDS.syndrome), `portable v${version}`);
    assert.equal(target.savedViews.some((view) => view.id === "unknown"), false, `portable v${version}`);
    assert.equal(result.importedViews, 1, `portable v${version}`);
  }
});

test("workspace-only dependency imports preserve a local archive decision and sanitize the default tab", () => {
  const medication = BUILTIN_LIBRARY_DEFINITIONS.find((library) => library.id === BUILTIN_LIBRARY_IDS.medication);
  assert.ok(medication);
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.settings.defaultTab = libraryTabId(medication.id);
  source.portableIndex.libraries = [{ ...medication, archivedAt: null }];
  source.portableIndex.libraryLayouts = { [medication.id]: [] };
  const value = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ workspace: true }),
    "2026-08-09T00:00:00.000Z",
  ));

  const target = migrateData(null);
  target.settings.workspaceMode = "generic";
  target.settings.defaultTab = "collections";
  target.portableIndex.libraries = [{ ...medication, name: "Local medications", archivedAt: 1234 }];
  target.portableIndex.libraryLayouts = { [medication.id]: [] };

  applyPortableExport(target, value, portableSelection({ workspace: true }), "replace");

  const retained = target.portableIndex.libraries.find((library) => library.id === medication.id);
  assert.equal(retained?.name, "Local medications", "a dependency descriptor is not authoritative metadata");
  assert.equal(retained?.archivedAt, 1234, "workspace import must not restore a locally archived library");
  assert.equal(target.settings.defaultTab, "curriculum", "an archived default is replaced with a usable core tab");
});

test("saved-view-only dependency imports omit views aimed at a locally archived library", () => {
  const medication = BUILTIN_LIBRARY_DEFINITIONS.find((library) => library.id === BUILTIN_LIBRARY_IDS.medication);
  assert.ok(medication);
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.portableIndex.libraries = [{ ...medication, archivedAt: null }];
  source.portableIndex.libraryLayouts = { [medication.id]: [] };
  source.savedViews = [{
    id: "medications",
    name: "Medication review",
    tab: libraryTabId(medication.id),
    query: "dose:missing",
  }];
  const value = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ savedViews: true }),
    "2026-08-09T00:00:00.000Z",
  ));

  const target = migrateData(null);
  target.settings.workspaceMode = "generic";
  target.portableIndex.libraries = [{ ...medication, name: "Local medications", archivedAt: 5678 }];
  target.portableIndex.libraryLayouts = { [medication.id]: [] };
  target.savedViews = [{ id: "local", name: "Local collection", tab: "collections", query: "local" }];

  const result = applyPortableExport(target, value, portableSelection({ savedViews: true }), "replace");

  const retained = target.portableIndex.libraries.find((library) => library.id === medication.id);
  assert.equal(retained?.name, "Local medications");
  assert.equal(retained?.archivedAt, 5678);
  assert.deepEqual(target.savedViews, [], "the view is omitted instead of silently pointing its name at another tab");
  assert.equal(result.importedViews, 0);
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
    libraries: [
      { id: "procedure", name: "Procedures", subjects: 21, headings: 1 },
      { id: "medication", name: "Medications", subjects: 44, headings: 1 },
      { id: "syndrome", name: "Syndromes", subjects: 25, headings: 1 },
    ],
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
  target.directIndexPaths = [localTopicPath];
  target.indexGroupByPath[localTopicPath] = "Airway";
  const localTopicBefore = structuredClone(target.portableIndex.subjects[0]);

  applyPortableExport(target, incoming, portableSelection({ syndromes: true }), "replace");

  assert.deepEqual(target.portableIndex.subjects.find((subject) => subject.id === "subject-local-topic"), localTopicBefore);
  assert.equal(target.portableIndex.resolvedPathBySubjectId["subject-local-topic"], localTopicPath);
  assert.equal(target.directIndexPaths.includes(localTopicPath), true);
  assert.equal(target.indexGroupByPath[localTopicPath], "Airway");
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-old-syndrome"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(target.portableIndex.resolvedPathBySubjectId, "subject-old-syndrome"), false);
  assert.deepEqual(target.portableIndex.subjects.filter((subject) => subject.recordKind === "syndrome").map((subject) => subject.title), ["CHARGE syndrome"]);
});

test("library-only Replace preserves an unrelated empty Index group through a same-ID same-title collision", () => {
  const medicationLibrary = BUILTIN_LIBRARY_DEFINITIONS.find((library) => library.id === BUILTIN_LIBRARY_IDS.medication);
  assert.ok(medicationLibrary);
  const medication = record({
    path: "Source/Medications/Single medication.md",
    title: "Single medication",
    kind: "medication",
    role: "library",
    domain: "General",
    curriculumId: "",
  });
  const source = migrateData(null);
  source.portableIndex.libraries = [{ ...medicationLibrary, archivedAt: null }];
  source.portableIndex.groups = [{ id: "group-general", title: "General", order: 0 }];
  source.portableIndex.subjects = [{
    id: "subject-medication",
    title: medication.title,
    groupId: "group-general",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "medication",
    libraryId: BUILTIN_LIBRARY_IDS.medication,
  }];
  source.portableIndex.resolvedPathBySubjectId = { "subject-medication": medication.path };
  source.portableIndex.libraryLayouts = {
    [BUILTIN_LIBRARY_IDS.medication]: [{
      id: "heading-general",
      title: "General",
      collapsed: false,
      subjects: ["subject-medication"],
      subheadings: [],
    }],
  };
  const incoming = parsePortableExport(createPortableExport(
    source,
    [medication],
    portableSelection({ medications: true }),
    "2026-08-09T00:00:00.000Z",
  ));
  assert.deepEqual(incoming.components.index?.groups.map((group) => group.id), ["group-general"]);

  const target = migrateData(null);
  target.portableIndex.libraries = [{ ...medicationLibrary, archivedAt: null }];
  // This subject-free identity is an explicit Index heading. The incoming
  // medication deliberately collides on both stable ID and title.
  target.portableIndex.groups = [{ id: "group-general", title: "General", order: 0 }];
  target.portableIndex.subjects = [];
  target.portableIndex.resolvedPathBySubjectId = {};
  target.portableIndex.libraryLayouts = { [BUILTIN_LIBRARY_IDS.medication]: [] };
  target.indexGroupOrder = ["General"];

  applyPortableExport(target, incoming, portableSelection({ medications: true }), "replace");

  const importedMedication = target.portableIndex.subjects.find((subject) => subject.id === "subject-medication");
  assert.ok(importedMedication);
  assert.notEqual(importedMedication.groupId, "group-general", "the selected library must fork around the unselected Index identity");
  assert.equal(target.portableIndex.groups.find((group) => group.id === "group-general")?.title, "General");
  assert.equal(target.portableIndex.groups.filter((group) => group.title === "General").length, 2);

  const indexOnly = createPortableExport(
    target,
    [],
    portableSelection({ index: true }),
    "2026-08-09T00:01:00.000Z",
  );
  assert.deepEqual(indexOnly.components.index?.indexGroupIds, ["group-general"]);
  assert.deepEqual(indexOnly.components.index?.groups.map((group) => group.id), ["group-general"]);
});

test("Index-only Replace preserves unrelated empty library layout identities", () => {
  const source = migrateData(null);
  const incoming = parsePortableExport(createPortableExport(
    source,
    [record({ path: "Source/Topic.md", title: "Topic", domain: "Topics", curriculumId: "" })],
    portableSelection({ index: true }),
    "2026-08-09T00:00:00.000Z",
  ));
  const target = migrateData(null);
  target.portableIndex.libraries = [{
    id: "library-reading",
    name: "Reading",
    singularName: "Paper",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  target.portableIndex.libraryLayouts = {
    "library-reading": [{
      id: "heading-empty-reading",
      title: "Future reading",
      collapsed: true,
      subjects: [],
      subheadings: [{
        id: "subheading-empty-guidelines",
        title: "Guidelines",
        collapsed: false,
        subjects: [],
      }],
    }],
  };
  const expectedLayout = structuredClone(target.portableIndex.libraryLayouts["library-reading"]);

  applyPortableExport(target, incoming, portableSelection({ index: true }), "replace");

  assert.deepEqual(target.portableIndex.libraryLayouts["library-reading"], expectedLayout);
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
  assert.ok(target.directIndexPaths.includes(portablePlaceholderPath(imported.id)));
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

test("index group edits never merge, rename, delete, or reassign same-title library groups", () => {
  const data = migrateData(null);
  const sharedGeneral = { id: "group-general-shared", title: "General", order: 0 };
  const procedureGeneral = { id: "group-general-procedure", title: "General", order: 1 };
  const medicationTarget = { id: "group-target-medication", title: "Target", order: 2 };
  const medicationDelete = { id: "group-delete-medication", title: "Delete me", order: 3 };
  data.portableIndex.groups = [sharedGeneral, procedureGeneral, medicationTarget, medicationDelete];
  data.portableIndex.subjects = [
    { id: "topic-general", title: "Index topic", groupId: sharedGeneral.id, parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    { id: "medication-general", title: "General drug", groupId: sharedGeneral.id, parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    { id: "procedure-general", title: "General procedure", groupId: procedureGeneral.id, parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "procedure" },
    { id: "medication-target", title: "Target drug", groupId: medicationTarget.id, parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    { id: "medication-delete", title: "Delete drug", groupId: medicationDelete.id, parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
  ];
  data.indexGroupOrder = ["General", "Target", "Delete me"];

  const indexGeneral = registerPortableGroup(data, "General");
  assert.notEqual(indexGeneral.id, sharedGeneral.id, "a legacy shared identity must remain owned by the library");
  assert.equal(data.portableIndex.subjects.find((subject) => subject.id === "topic-general")?.groupId, indexGeneral.id);
  assert.equal(data.portableIndex.subjects.find((subject) => subject.id === "medication-general")?.groupId, sharedGeneral.id);
  assert.equal(data.portableIndex.subjects.find((subject) => subject.id === "procedure-general")?.groupId, procedureGeneral.id);

  const indexTarget = registerPortableGroup(data, "Target");
  assert.notEqual(indexTarget.id, medicationTarget.id);
  renameOrMergePortableGroup(data, "General", "Target");
  assert.equal(data.portableIndex.subjects.find((subject) => subject.id === "topic-general")?.groupId, indexTarget.id);
  assert.equal(data.portableIndex.subjects.find((subject) => subject.id === "medication-general")?.groupId, sharedGeneral.id);
  assert.equal(data.portableIndex.groups.find((group) => group.id === sharedGeneral.id)?.title, "General");
  assert.equal(data.portableIndex.groups.find((group) => group.id === procedureGeneral.id)?.title, "General");
  assert.equal(data.portableIndex.groups.find((group) => group.id === medicationTarget.id)?.title, "Target");

  const emptyIndexDelete = registerPortableGroup(data, "Delete me");
  assert.notEqual(emptyIndexDelete.id, medicationDelete.id);
  removePortableGroup(data, "Delete me");
  assert.equal(data.portableIndex.groups.some((group) => group.id === emptyIndexDelete.id), false);
  assert.equal(data.portableIndex.groups.find((group) => group.id === medicationDelete.id)?.title, "Delete me");
  assert.equal(data.portableIndex.subjects.find((subject) => subject.id === "medication-delete")?.groupId, medicationDelete.id);
});

test("index-only export selects the empty index group instead of same-title library groups", () => {
  const data = migrateData(null);
  const medicationGroup = { id: "group-general-medication", title: "General", order: 0 };
  const procedureGroup = { id: "group-general-procedure", title: "General", order: 1 };
  data.portableIndex.groups = [medicationGroup, procedureGroup];
  data.portableIndex.subjects = [
    { id: "medication-general", title: "General drug", groupId: medicationGroup.id, parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    { id: "procedure-general", title: "General procedure", groupId: procedureGroup.id, parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "procedure" },
  ];
  data.indexGroupOrder = ["General"];

  const exported = createPortableExport(data, [], portableSelection({ index: true }), "2026-08-09T00:00:00.000Z");
  const index = exported.components.index;
  assert.ok(index);
  assert.equal(index.subjects.length, 0);
  assert.equal(index.groups.length, 1);
  const exportedIndexGroup = index.groups[0];
  assert.ok(exportedIndexGroup);
  assert.equal(exportedIndexGroup.title, "General");
  assert.notEqual(exportedIndexGroup.id, medicationGroup.id);
  assert.notEqual(exportedIndexGroup.id, procedureGroup.id);
  assert.deepEqual(index.indexGroupIds, [exportedIndexGroup.id]);
  assert.equal(data.portableIndex.subjects.find((subject) => subject.id === "medication-general")?.groupId, medicationGroup.id);
  assert.equal(data.portableIndex.subjects.find((subject) => subject.id === "procedure-general")?.groupId, procedureGroup.id);
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

test("portable hierarchy depth validation is independent of subject order", () => {
  const hierarchyFixture = (count: number, childFirst: boolean): PortableExportV1 => {
    const value = portableFixture();
    const index = value.components.index;
    assert.ok(index);
    const subjects = Array.from({ length: count }, (_, subjectIndex) => ({
      id: `subject-depth-${subjectIndex}`,
      title: `Depth ${subjectIndex}`,
      groupId: "group-airway",
      parentId: subjectIndex === 0 ? null : `subject-depth-${subjectIndex - 1}`,
      order: subjectIndex,
      indexed: true,
      configuredId: "",
      recordKind: "topic" as const,
    }));
    index.subjects = childFirst ? subjects.reverse() : subjects;
    return value;
  };

  assert.doesNotThrow(() => parsePortableExport(hierarchyFixture(64, false)));
  assert.doesNotThrow(() => parsePortableExport(hierarchyFixture(64, true)));
  assert.throws(() => parsePortableExport(hierarchyFixture(65, false)), /exceeds 64 levels/i);
  assert.throws(() => parsePortableExport(hierarchyFixture(65, true)), /exceeds 64 levels/i);
});

test("portable titles reject malformed Unicode and bidirectional spoofing controls", () => {
  for (const unsafeTitle of ["Lone high \uD800", "Lone low \uDC00", "Airway \u202Etxt", "Airway \u2066isolated\u2069"]) {
    const value = portableFixture();
    const subject = value.components.index?.subjects[0];
    assert.ok(subject);
    subject.title = unsafeTitle;
    assert.throws(() => parsePortableExport(value), /invalid Unicode|bidirectional controls/i);
  }

  const spoofedSource = portableFixture();
  spoofedSource.sourceWorkspace = "ENT \u202Etxt";
  assert.throws(() => parsePortableExport(spoofedSource), /bidirectional controls/i);

  const valid = portableFixture();
  const subject = valid.components.index?.subjects[0];
  assert.ok(subject);
  subject.title = "\u200Fمتلازمة العائلة 👨‍👩‍👧";
  assert.equal(parsePortableExport(valid).components.index?.subjects[0]?.title, subject.title);
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

  const oversizedLibraryLayout = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  oversizedLibraryLayout.portableIndex.libraryLayouts.medication = [{
    id: "medication-heading",
    title: "Medication",
    collapsed: false,
    subjects: Array(MAX_TRANSFER_LIST_ITEMS + 1).fill("medication-subject") as string[],
    subheadings: [],
  }];
  assert.throws(() => parsePersonalBackup(oversizedLibraryLayout), /medication layout.*too many references/i);

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

test("replace index retains protected identities without manufacturing unneeded folder exclusions", () => {
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
  assert.equal(target.excludedIndexPaths.includes(droppedPath), false);
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-protected"), true);
  assert.equal(target.excludedIndexPaths.includes(protectedPath), false);
  assert.equal(target.portableIndex.subjects.find((subject) => subject.id === "subject-imported")?.indexed, false);
  assert.equal(target.excludedIndexPaths.includes(importedPath), false);
});

test("title fallback never conflates incoming identities with a resolved local subject", () => {
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

  const parsed = parsePortableExport(incoming);
  const result = applyPortableExport(target, parsed, portableSelection({ index: true }), "merge");
  assert.equal(result.matchedSubjects, 0);
  assert.equal(result.addedSubjects, 2);
  assert.equal(new Set(target.portableIndex.subjects.map((subject) => subject.id)).size, 3);

  const repeated = applyPortableExport(target, parsed, portableSelection({ index: true }), "merge");
  assert.equal(repeated.addedSubjects, 0);
  assert.equal(repeated.matchedSubjects, 2);
  assert.equal(new Set(target.portableIndex.subjects.map((subject) => subject.id)).size, 3);
});

test("title fallback still matches one unique unresolved local placeholder", () => {
  const target = migrateData(null);
  target.portableIndex = {
    version: 1,
    groups: [{ id: "group-local", title: "Airway", order: 0 }],
    subjects: [{ id: "subject-local", title: "Shared title", groupId: "group-local", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: {},
  };
  const incoming = portableFixture();
  incoming.components.index = {
    version: 1,
    groups: [{ id: "group-source", title: "Airway", order: 0 }],
    subjects: [{ id: "subject-source", title: "Shared title", groupId: "group-source", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
  };

  const result = applyPortableExport(target, parsePortableExport(incoming), portableSelection({ index: true }), "merge");
  assert.equal(result.matchedSubjects, 1);
  assert.equal(result.addedSubjects, 0);
  assert.deepEqual(target.portableIndex.subjects.map((subject) => subject.id), ["subject-local"]);
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
  source.directIndexPaths = Array.from({ length: 722 }, (_, index) => `03 Clinical Topics/Legacy ${index}.md`);
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main-vault", "base-ent", "ENT");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  legacy.manualIndexPaths = modern.directIndexPaths;
  delete legacy.directIndexPaths;
  delete legacy.indexFolderSources;
  delete legacy.indexFolderSourcesIncluded;
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
  source.directIndexPaths = Array.from({ length: 722 }, (_, index) => `03 Clinical Topics/Legacy ${index}.md`);
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main-vault", "base-ent", "ENT");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  legacy.manualIndexPaths = modern.directIndexPaths;
  delete legacy.directIndexPaths;
  delete legacy.indexFolderSources;
  delete legacy.indexFolderSourcesIncluded;
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
  source.directIndexPaths = Array.from({ length: 722 }, (_, index) => `03 Clinical Topics/Legacy ${index}.md`);
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-ent-main-vault", "base-ent", "ENT");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  legacy.manualIndexPaths = modern.directIndexPaths;
  delete legacy.directIndexPaths;
  delete legacy.indexFolderSources;
  delete legacy.indexFolderSourcesIncluded;
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
  assert.equal(target.directIndexPaths.length, 722);
  assert.deepEqual(target.manualIndexPaths, []);
});

test("confirmed legacy recovery remains available at the at-least-half threshold", () => {
  const source = migrateData(null);
  source.directIndexPaths = ["Knowledge Base/Found.md", "Knowledge Base/Missing.md"];
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-source", "base-source", "Source");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  legacy.manualIndexPaths = modern.directIndexPaths;
  delete legacy.directIndexPaths;
  delete legacy.indexFolderSources;
  delete legacy.indexFolderSourcesIncluded;
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
  assert.deepEqual(target.directIndexPaths, source.directIndexPaths);
  assert.deepEqual(target.manualIndexPaths, []);
});

test("confirmed path-free legacy recovery does not require a path preflight", () => {
  const source = migrateData(null);
  source.savedViews = [{ id: "review", name: "Review", tab: "curriculum", query: "larynx" }];
  const modern = createPersonalBackup(source, "2026-08-08T00:00:00.000Z", "vault-source", "base-source", "Source");
  const legacy = { ...modern, version: 5 } as Record<string, unknown>;
  delete legacy.sourceVaultId;
  delete legacy.directIndexPaths;
  delete legacy.indexFolderSources;
  delete legacy.indexFolderSourcesIncluded;
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

test("index diagnostics report the parents the curriculum tree itself cannot resolve", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const parent = record({ path: "KB/Cafe.md", title: "Cafe", domain: "KB", curriculumId: "", role: "supporting" });
  // The tree resolves parents by plain lowercasing, so accent and Unicode
  // normalization differences really do flatten the hierarchy.
  const child = record({ path: "KB/Latte.md", title: "Latte", domain: "KB", curriculumId: "", role: "supporting", parentTopic: "[[Café]]" });
  const paths = new Set([parent.path, child.path]);

  const tree = buildCurriculumTree([parent, child], data.curriculumVisual, false);
  assert.equal(tree.parentByPath.get(child.path), null, "the accented parent does not resolve");
  const diagnostics = buildIndexDiagnostics(data, [parent, child], paths);
  assert.deepEqual(diagnostics.map((item) => item.kind), ["broken-parent"]);
  assert.equal(diagnostics[0]?.path, child.path);

  const resolvable = record({ path: "KB/Mocha.md", title: "Mocha", domain: "KB", curriculumId: "", role: "supporting", parentTopic: "[[Cafe]]" });
  assert.deepEqual(
    buildIndexDiagnostics(data, [parent, resolvable], new Set([parent.path, resolvable.path])),
    [],
    "a parent the tree does resolve reports nothing",
  );
});

test("index diagnostics pre-index hidden paths instead of probing the array per visual override", () => {
  const data = migrateData(null);
  const hiddenPaths = ["Hidden.md"];
  let linearProbes = 0;
  const includes = hiddenPaths.includes.bind(hiddenPaths);
  hiddenPaths.includes = (path, fromIndex) => {
    linearProbes += 1;
    return includes(path, fromIndex);
  };
  data.excludedIndexPaths = hiddenPaths;
  data.indexGroupByPath["Hidden.md"] = "Research";

  assert.deepEqual(buildIndexDiagnostics(data, [], new Set(hiddenPaths)), []);
  assert.equal(linearProbes, 0);
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
  const data = migrateData(null);
  data.indexGroupByPath = { "old.md": "Research" };
  data.displayNameByPath = { "old.md": "Old label" };
  assert.equal(rewritePluginDataPathPrefix(data, "old.md", "new.md"), true);
  assert.deepEqual(data.indexGroupByPath, { "new.md": "Research" });
  assert.deepEqual(data.displayNameByPath, { "new.md": "Old label" });

  const untouched = migrateData(null);
  untouched.indexGroupByPath = { "old.md": "Research" };
  assert.equal(rewritePluginDataPathPrefix(untouched, "missing.md", "other.md"), false);
  assert.deepEqual(untouched.indexGroupByPath, { "old.md": "Research" });
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
  const data = migrateData({
    collections: [{ id: "research", title: "Research", collapsed: false, subjects: ["Notes/Paper.md"], subheadings: [] }],
    pinnedPaths: ["Notes/Paper.md"],
    settings: { workspaceMode: "generic", workspaceName: "My research KB", setupComplete: true },
  });
  assert.equal(data.version, DATA_VERSION);
  assert.equal(data.settings.workspaceMode, "generic");
  assert.equal(data.settings.workspaceName, "My research KB");
  assert.equal(data.collections[0]?.title, "Research");
  assert.deepEqual(data.pinnedPaths, ["Notes/Paper.md"]);
  assert.equal(isRecognizedPluginData({ unrelated: true }), false);
  assert.equal(isRecognizedPluginData({ settings: { workspaceMode: "generic" } }), true);
});

test("explicit malformed inner and outer versions are never treated as versionless", () => {
  const malformedVersions: unknown[] = [undefined, 0, -1, Number.NaN, "1e999", "2.5", "banana"];
  for (const version of malformedVersions) {
    const flat = { version, collections: [], settings: { workspaceMode: "generic" } };
    assert.equal(isRecognizedPluginData(flat), false);
    assert.throws(() => migrateData(flat), /version must be a positive finite integer/i);

    const innerStore = createDefaultStore(migrateData(null), 100, `vault-inner-${String(version)}`);
    (innerStore.bases[0]?.data as unknown as Record<string, unknown>).version = version;
    assert.throws(() => migrateStore(innerStore), /unrecognized data|version must be a positive finite integer/i);

    const outerStore = createDefaultStore(migrateData(null), 100, `vault-outer-${String(version)}`) as unknown as Record<string, unknown>;
    outerStore.version = version;
    assert.equal(isRecognizedPluginStore(outerStore), false);
    assert.throws(() => migrateStore(outerStore), /unrecognized or damaged shape/i);
  }
  assert.equal(storedDataVersion({ version: "2" }), 2);
});

test("folder renames rewrite every descendant reference, including snapshots and collapse state", () => {
  const data = migrateData(null);
  data.collections = [{ id: "c", title: "C", collapsed: false, subjects: ["Old/One.md"], subheadings: [{ id: "s", title: "S", collapsed: false, subjects: ["Old/Nested/Two.md"] }] }];
  data.pinnedPaths = ["Old/One.md"];
  data.nextStudyPaths = ["Old/Nested/Two.md"];
  data.directIndexPaths = ["Old/Direct.md"];
  data.indexFolderSources = [{ id: "index-folder-old", path: "Old", origin: "user" }];
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
  assert.deepEqual(data.directIndexPaths, ["New/Direct.md"]);
  assert.deepEqual(data.indexFolderSources, [{ id: "index-folder-old", path: "New", origin: "user" }]);
  assert.deepEqual(data.undoStack[0]?.pinnedPaths, ["New/One.md"]);
  assert.deepEqual(data.undoStack[0]?.directIndexPaths, ["New/Direct.md"]);
  assert.equal(data.undoStack[0]?.indexFolderSources[0]?.path, "New");
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

test("linked-folder group renames use the nearest source independently in current and saved states", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "";
  data.indexFolderSources = [
    { id: "outer", path: "Archive", origin: "user" },
    { id: "inner", path: "Archive/Research", origin: "user" },
  ];
  data.indexGroupAliases = { Old: "Current display" };
  data.indexGroupOrder = ["Old", "Current display", "Other"];
  data.collapsed.curriculumDomains = ["Old", "Current display"];
  data.curriculumVisual.orderByContainer[curriculumContainerKey("Old", null)] = ["Archive/Research/Old/Current.md"];

  const outerOnly = snapshotPersonal(data, "Outer source only");
  outerOnly.indexFolderSources = [{ id: "outer", path: "Archive", origin: "user" }];
  outerOnly.indexGroupAliases = { Research: "Saved outer display" };
  outerOnly.indexGroupOrder = ["Saved outer display"];
  outerOnly.curriculumVisual.orderByContainer = {
    [curriculumContainerKey("Saved outer display", null)]: ["Archive/Research/Old/Saved.md"],
  };
  const inner = snapshotPersonal(data, "Inner source");
  inner.indexGroupAliases = { Old: "Saved inner display" };
  inner.indexGroupOrder = ["Old", "Saved inner display"];
  inner.curriculumVisual.orderByContainer = {
    [curriculumContainerKey("Old", null)]: ["Archive/Research/Old/Saved.md"],
  };
  data.layoutSnapshots = [outerOnly, inner];

  assert.equal(rewritePluginDataFolderRename(
    data,
    "Archive/Research/Old",
    "Archive/Research/New",
  ), true);
  assert.equal(data.indexGroupAliases.New, "Current display");
  assert.deepEqual(data.indexGroupOrder, ["Old", "Current display", "Other"]);
  assert.deepEqual(data.collapsed.curriculumDomains, ["Old", "Current display"]);
  assert.deepEqual(data.layoutSnapshots[0]?.indexGroupAliases, { Research: "Saved outer display" });
  assert.deepEqual(data.layoutSnapshots[1]?.indexGroupAliases, {
    Old: "Saved inner display",
    New: "Saved inner display",
  });

  const rootRename = migrateData(null);
  rootRename.settings.workspaceMode = "generic";
  rootRename.settings.primaryFolder = "";
  rootRename.indexFolderSources = [
    { id: "outer", path: "Archive", origin: "user" },
    { id: "inner", path: "Archive/Research", origin: "user" },
  ];
  rootRename.indexGroupAliases = { Research: "Nearest root" };
  rootRename.indexGroupOrder = ["Research", "Nearest root"];
  rootRename.collapsed.curriculumDomains = ["Research"];
  assert.equal(rewritePluginDataFolderRename(
    rootRename,
    "Archive/Research",
    "Archive/Studies",
  ), true);
  assert.equal(rootRename.indexGroupAliases.Studies, "Nearest root");
  assert.deepEqual(rootRename.collapsed.curriculumDomains, ["Research", "Nearest root"]);
});

test("vault-root legacy membership derives and renames the top-level group", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "";
  data.indexFolderSources = [{
    id: legacyPrimaryFolderSourceId(""),
    path: INDEX_FOLDER_VAULT_ROOT,
    origin: "legacy-primary-folder",
  }];
  data.indexGroupOrder = ["A", "Other"];
  data.curriculumVisual.orderByContainer[curriculumContainerKey("A", null)] = ["A/B/Topic.md"];

  assert.equal(rewritePluginDataFolderRename(data, "A", "C"), true);
  assert.deepEqual(data.indexGroupOrder, ["A", "C", "Other"]);
  assert.deepEqual(data.curriculumVisual.orderByContainer[curriculumContainerKey("A", null)], ["A/B/Topic.md"]);
  assert.deepEqual(data.curriculumVisual.orderByContainer[curriculumContainerKey("C", null)], ["A/B/Topic.md"]);
});

test("folder renames rewrite all path-valued settings recursively without treating nested folders as groups", () => {
  const data = migrateData(null);
  data.settings.primaryFolder = "Vault Root/Knowledge";
  data.settings.proposalFolder = "Vault Root/Inbox/Proposals";
  data.settings.templatesFolder = "Vault Root/Templates";
  data.settings.defaultNoteFolder = "Vault Root/Knowledge/Inbox";
  data.settings.defaultTemplatePath = "Vault Root/Templates/Topic.md";
  data.settings.libraryNoteProfiles = {
    "library-research": { folder: "Vault Root/Research", templatePath: "Vault Root/Templates/Research.md" },
  };
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
    assert.deepEqual(settings?.libraryNoteProfiles["library-research"], {
      folder: "Renamed Root/Research",
      templatePath: "Renamed Root/Templates/Research.md",
    });
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

test("renaming a top-level folder outside the primary folder migrates its derived group", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  // configuredGroupFromPath derives "Recipes" for Recipes/Pasta.md, so the
  // rename has to carry that group's alias, order, collapse, and visual order.
  assert.equal(configuredGroupFromPath("Recipes/Pasta.md", data.settings.primaryFolder), "Recipes");
  data.indexGroupAliases = { Recipes: "Cooking notes" };
  data.indexGroupOrder = ["Cooking notes", "Other"];
  data.collapsed.curriculumDomains = ["Recipes"];
  data.curriculumVisual.orderByContainer = {
    [curriculumContainerKey("Recipes", null)]: ["Recipes/Pasta.md"],
  };

  assert.equal(rewritePluginDataFolderRename(data, "Recipes", "Cooking"), true);

  assert.deepEqual(data.indexGroupAliases, { Recipes: "Cooking notes", Cooking: "Cooking notes" });
  assert.deepEqual(data.indexGroupOrder, ["Cooking notes", "Other"]);
  assert.deepEqual(data.collapsed.curriculumDomains, ["Recipes", "Cooking notes"]);
  assert.deepEqual(data.curriculumVisual.orderByContainer[curriculumContainerKey("Cooking notes", null)], [
    "Recipes/Pasta.md",
  ]);
  assert.deepEqual(data.curriculumVisual.orderByContainer[curriculumContainerKey("Recipes", null)], [
    "Recipes/Pasta.md",
  ], "the old logical taxonomy is never dropped");
});

test("renaming an unaliased outside folder still carries its group order and collapse", () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.indexGroupOrder = ["Recipes", "Other"];
  data.collapsed.curriculumDomains = ["Recipes"];

  assert.equal(rewritePluginDataFolderRename(data, "Recipes", "Cooking"), true);
  assert.deepEqual(data.indexGroupOrder, ["Recipes", "Cooking", "Other"]);
  assert.deepEqual(data.collapsed.curriculumDomains, ["Recipes", "Cooking"]);
});

test("file renames update the configured template path through nested history only", () => {
  const data = migrateData(null);
  data.settings.primaryFolder = "Templates/Old topic.md";
  data.settings.templatesFolder = "Templates";
  data.settings.defaultTemplatePath = "Templates/Old topic.md";
  data.settings.libraryNoteProfiles = {
    "library-research": { folder: "Notes", templatePath: "Templates/Old topic.md" },
  };
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
    assert.equal(settings?.libraryNoteProfiles["library-research"]?.templatePath, "Templates/New topic.md");
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
  assert.equal(
    applyTemplateTokens("title: {{yaml:title}}", "Sinus $& Nose", "2026-01-01", "12:00"),
    'title: "Sinus $& Nose"',
  );
  assert.equal(
    applyTemplateTokens("id: {{yaml:id}}\nrest", "t", "2026-01-01", "12:00", { id: "X$'Y $` $$ $&" }),
    'id: "X$\'Y $` $$ $&"\nrest',
  );
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

test("loading synced plugin data bounds named, Undo, Redo, and nested snapshot histories", () => {
  const source = migrateData(null);
  const snapshots = Array.from({ length: 30 }, (_, index) => snapshotPersonal(source, `Imported ${index}`));
  snapshots[29].layoutSnapshots = Array.from(
    { length: 15 },
    (_, index) => snapshotPersonal(source, `Nested ${index}`),
  );
  source.layoutSnapshots = structuredClone(snapshots);
  source.undoStack = structuredClone(snapshots);
  source.redoStack = structuredClone(snapshots);

  const cleaned = migrateData(source);

  assert.deepEqual(cleaned.layoutSnapshots.map((snapshot) => snapshot.label), snapshots.slice(-10).map((snapshot) => snapshot.label));
  assert.deepEqual(cleaned.undoStack.map((snapshot) => snapshot.label), snapshots.slice(-20).map((snapshot) => snapshot.label));
  assert.deepEqual(cleaned.redoStack.map((snapshot) => snapshot.label), snapshots.slice(-20).map((snapshot) => snapshot.label));
  assert.deepEqual(
    cleaned.layoutSnapshots.at(-1)?.layoutSnapshots?.map((snapshot) => snapshot.label),
    Array.from({ length: 10 }, (_, index) => `Nested ${index + 5}`),
  );
  assert.ok(new TextEncoder().encode(JSON.stringify(cleaned.undoStack)).byteLength <= MAX_UNDO_BYTES);
  assert.ok(new TextEncoder().encode(JSON.stringify(cleaned.redoStack)).byteLength <= MAX_UNDO_BYTES);
});

test("current and historical authoritative maps reject arrays and non-plain records", () => {
  for (const field of ["displayNameByPath", "indexGroupByPath", "indexGroupAliases"] as const) {
    const source = migrateData(null) as unknown as Record<string, unknown>;
    source[field] = [];
    assert.throws(() => migrateData(source), new RegExp(`${field === "displayNameByPath" ? "display names" : field === "indexGroupByPath" ? "visual groups" : "group aliases"} must be an object`, "i"));
  }

  const parentArray = migrateData(null) as unknown as Record<string, unknown>;
  parentArray.curriculumVisual = { parentByPath: [], orderByContainer: {} };
  assert.throws(() => migrateData(parentArray), /parent map must be an object/i);

  const orderArray = migrateData(null) as unknown as Record<string, unknown>;
  orderArray.curriculumVisual = { parentByPath: {}, orderByContainer: [] };
  assert.throws(() => migrateData(orderArray), /order containers must be an object/i);

  const inherited = Object.create({ inherited: "value" }) as Record<string, unknown>;
  const nonPlain = migrateData(null) as unknown as Record<string, unknown>;
  nonPlain.displayNameByPath = inherited;
  assert.throws(() => migrateData(nonPlain), /display names must be an object/i);

  const withHistory = migrateData(null);
  const badHistory = snapshotPersonal(withHistory, "Damaged history") as unknown as Record<string, unknown>;
  badHistory.displayNameByPath = [];
  badHistory.curriculumVisual = { parentByPath: {}, orderByContainer: { root: ["safe", ["nested"]] } };
  withHistory.undoStack = [badHistory as unknown as typeof withHistory.undoStack[number]];
  assert.deepEqual(migrateData(withHistory).undoStack, [], "invalid non-authoritative history is dropped before cleaning");
  const envelope = createDefaultStore(withHistory, 100, "vault-damaged-history");
  assert.deepEqual(migrateStore(envelope).bases[0]?.data.undoStack, [], "current envelopes apply the same history guard");
});

test("persisted text lists never coerce nested or non-string values", () => {
  const cases: Array<[string, (source: Record<string, unknown>) => void]> = [
    ["pins", (source) => { source.pinnedPaths = ["Knowledge Base/Good.md", ["nested"]]; }],
    ["subjects", (source) => {
      const collections = source.collections as Array<Record<string, unknown>>;
      collections.push({ id: "h", title: "Heading", subjects: ["ok", { path: "bad" }], subheadings: [] });
    }],
    ["collapse list", (source) => { source.collapsed = { curriculumDomains: ["ENT", 7], curriculumNodes: [], queues: [] }; }],
    ["visual order", (source) => { source.curriculumVisual = { parentByPath: {}, orderByContainer: { root: ["ok", false] } }; }],
    ["relinkable identities", (source) => {
      (source.portableIndex as Record<string, unknown>).relinkableSubjectIds = ["subject-one", null];
    }],
  ];
  for (const [label, mutate] of cases) {
    const source = migrateData(null) as unknown as Record<string, unknown>;
    mutate(source);
    assert.throws(() => migrateData(source), /must be text/i, label);
  }

  const wrongMapValue = migrateData(null) as unknown as Record<string, unknown>;
  wrongMapValue.displayNameByPath = { "Knowledge Base/Note.md": 42 };
  assert.throws(() => migrateData(wrongMapValue), /display names value must be text/i);

  const exactCleaned = migrateData(null);
  exactCleaned.pinnedPaths = [` ${"x".repeat(MAX_TRANSFER_TEXT_LENGTH - 2)} `];
  assert.equal(migrateData(exactCleaned).pinnedPaths[0]?.length, MAX_TRANSFER_TEXT_LENGTH - 2);
});

test("recognized legacy and current shapes fail closed only when defined authoritative fields are damaged", () => {
  assert.throws(() => migrateData({ version: 1, selectedPath: "Legacy.md" }), /headings must be a list/i);
  assert.throws(() => migrateData({ version: 2, collections: {}, settings: { workspaceMode: "generic" } }), /collections must be a list/i);
  assert.throws(() => migrateData({ collections: {}, settings: { workspaceMode: "generic" } }), /collections must be a list/i);
  assert.throws(() => migrateData({
    version: DATA_VERSION,
    directIndexPaths: [],
    indexFolderSources: [],
    collections: [],
    savedViews: {},
    settings: {},
  }), /saved views must be a list/i);

  const compatibleSparseV2 = migrateData({ version: 2, settings: { workspaceMode: "generic" } });
  assert.deepEqual(compatibleSparseV2.collections, []);
  assert.equal(compatibleSparseV2.version, DATA_VERSION);
  assert.deepEqual(
    compatibleSparseV2.indexFolderSources.map((source) => ({ path: source.path, origin: source.origin })),
    [{ path: compatibleSparseV2.settings.primaryFolder, origin: "legacy-primary-folder" }],
    "even the oldest recognized Generic shape preserves its former folder membership as a removable source",
  );

  const current = migrateData(null);
  const envelope = createDefaultStore(current, 100, "vault-damaged-map");
  (envelope.bases[0]?.data as unknown as Record<string, unknown>).indexGroupByPath = [];
  assert.throws(() => migrateStore(envelope), /visual groups must be an object/i);
});

test("multi-base envelopes share one aggregate load budget", () => {
  const shared = "Knowledge Base/Shared.md";
  const makeLargeBase = (): ReturnType<typeof migrateData> => {
    const data = migrateData(null);
    data.pinnedPaths = Array(45_000).fill(shared) as string[];
    data.nextStudyPaths = Array(45_000).fill(shared) as string[];
    data.manualIndexPaths = Array(40_001).fill(shared) as string[];
    return data;
  };
  const first = makeLargeBase();
  const store = createDefaultStore(first, 100, "vault-envelope-budget");
  store.bases.push(createKnowledgeBaseEntry(makeLargeBase(), "base-second", 101));
  assert.throws(() => migrateStore(store), new RegExp(MAX_TRANSFER_TOTAL_REFERENCES.toLocaleString()));

  const whitespace = " ".repeat(MAX_TRANSFER_TEXT_LENGTH);
  const groupsPerBase = Math.floor((MAX_TRANSFER_TOTAL_TEXT_LENGTH / 2) / whitespace.length) + 10;
  const makeRawTextGroups = (): Array<{ id: string; title: string; order: number }> => Array.from(
    { length: groupsPerBase },
    (_, index) => ({ id: `group-${index}`, title: whitespace, order: index }),
  );
  const textStore = createDefaultStore(migrateData(null), 100, "vault-envelope-text-budget");
  textStore.bases.push(createKnowledgeBaseEntry(migrateData(null), "base-second", 101));
  for (const entry of textStore.bases) {
    (entry.data.portableIndex as unknown as Record<string, unknown>).groups = makeRawTextGroups();
  }
  assert.throws(() => migrateStore(textStore), /contains more than .* bytes of text/i);
});

test("current plugin data rejects oversized primary lists, maps, structures, and text before cleaning", () => {
  const oversizedCollections = migrateData(null) as unknown as Record<string, unknown>;
  oversizedCollections.collections = Array.from({ length: 10_001 }, () => null);
  assert.throws(() => migrateData(oversizedCollections), /Plugin data collections has too many entries/i);

  const oversizedSubjects = migrateData(null) as unknown as Record<string, unknown>;
  (oversizedSubjects.portableIndex as Record<string, unknown>).subjects = Array.from(
    { length: MAX_TRANSFER_LIST_ITEMS + 1 },
    () => null,
  );
  assert.throws(() => migrateData(oversizedSubjects), /portable index subjects has too many entries/i);

  const oversizedMap = migrateData(null) as unknown as Record<string, unknown>;
  oversizedMap.displayNameByPath = Object.fromEntries(Array.from(
    { length: MAX_TRANSFER_LIST_ITEMS + 1 },
    (_, index) => [`Knowledge Base/Note ${index}.md`, "Note"],
  ));
  assert.throws(() => migrateData(oversizedMap), /display names has too many entries/i);

  const oversizedQuery = migrateData(null) as unknown as Record<string, unknown>;
  oversizedQuery.savedViews = [{
    id: "view-long",
    name: "Long",
    tab: "curriculum",
    query: "x".repeat(MAX_TRANSFER_TEXT_LENGTH + 1),
  }];
  assert.throws(() => migrateData(oversizedQuery), /saved views 1 query is longer/i);

  const oversizedTitle = migrateData(null) as unknown as Record<string, unknown>;
  (oversizedTitle.portableIndex as Record<string, unknown>).groups = [{
    id: "group-long",
    title: "x".repeat(MAX_TRANSFER_TEXT_LENGTH + 1),
    order: 0,
  }];
  assert.throws(() => migrateData(oversizedTitle), /portable index group 1 title is longer/i);

  const oversizedAttachmentSetting = migrateData(null) as unknown as Record<string, unknown>;
  (oversizedAttachmentSetting.settings as Record<string, unknown>).attachmentMarker =
    "x".repeat(MAX_TRANSFER_TEXT_LENGTH + 1);
  assert.throws(
    () => migrateData(oversizedAttachmentSetting),
    /settings attachmentMarker is longer/i,
  );

  const oversizedFollowUpCategories = migrateData(null) as unknown as Record<string, unknown>;
  (oversizedFollowUpCategories.settings as Record<string, unknown>).followUpCategories = Array.from(
    { length: 31 },
    (_, index) => ({ id: `category-${index}`, label: `Category ${index}`, style: "bullet", includeDate: false, archived: false }),
  );
  assert.throws(
    () => migrateData(oversizedFollowUpCategories),
    /settings followUpCategories has too many entries/i,
  );

  const oversizedLibraryProfiles = migrateData(null) as unknown as Record<string, unknown>;
  (oversizedLibraryProfiles.settings as Record<string, unknown>).libraryNoteProfiles = Object.fromEntries(
    Array.from({ length: MAX_LIBRARIES + 1 }, (_, index) => [`library-${index}`, { folder: `Folder ${index}` }]),
  );
  assert.throws(
    () => migrateData(oversizedLibraryProfiles),
    /settings libraryNoteProfiles has too many entries/i,
  );

  const totalText = migrateData(null) as unknown as Record<string, unknown>;
  const maximumText = "x".repeat(MAX_TRANSFER_TEXT_LENGTH);
  (totalText.portableIndex as Record<string, unknown>).groups = Array.from({ length: 7_000 }, (_, index) => ({
    id: `group-${index}`,
    title: maximumText,
    order: index,
  }));
  assert.throws(() => migrateData(totalText), /contains more than .* bytes of text/i);

  const atBoundary = migrateData(null);
  atBoundary.savedViews = [{ id: "view-boundary", name: "Boundary", tab: "curriculum", query: maximumText }];
  assert.equal(migrateData(atBoundary).savedViews[0]?.query.length, MAX_TRANSFER_TEXT_LENGTH);
});

test("aggregate text limits charge raw whitespace and multibyte UTF-8 bytes", () => {
  const makeGroups = (title: string, count: number): Array<{ id: string; title: string; order: number }> => Array.from(
    { length: count },
    (_, index) => ({ id: `group-${index}`, title, order: index }),
  );

  const whitespace = " ".repeat(MAX_TRANSFER_TEXT_LENGTH);
  const whitespaceSource = migrateData(null) as unknown as Record<string, unknown>;
  (whitespaceSource.portableIndex as Record<string, unknown>).groups = makeGroups(
    whitespace,
    Math.floor(MAX_TRANSFER_TOTAL_TEXT_LENGTH / whitespace.length) + 1,
  );
  assert.throws(() => migrateData(whitespaceSource), /contains more than .* bytes of text/i);

  const cjk = "界".repeat(9_000);
  const cjkBytes = new TextEncoder().encode(cjk).byteLength;
  assert.equal(cjkBytes, 27_000);
  const cjkSource = migrateData(null) as unknown as Record<string, unknown>;
  (cjkSource.portableIndex as Record<string, unknown>).groups = makeGroups(
    cjk,
    Math.floor(MAX_TRANSFER_TOTAL_TEXT_LENGTH / cjkBytes) + 1,
  );
  assert.throws(() => migrateData(cjkSource), /contains more than .* bytes of text/i);
});

test("current plugin data enforces the aggregate transfer budget across otherwise-valid lists", () => {
  const source = migrateData(null) as unknown as Record<string, unknown>;
  const references = Array(MAX_TRANSFER_LIST_ITEMS).fill("Knowledge Base/Shared.md") as string[];
  source.pinnedPaths = references;
  source.nextStudyPaths = references;
  source.manualIndexPaths = references;
  source.excludedIndexPaths = references;
  source.collapsed = {
    curriculumDomains: references,
    curriculumNodes: ["Knowledge Base/One more.md"],
    queues: [],
  };

  assert.throws(() => migrateData(source), new RegExp(MAX_TRANSFER_TOTAL_REFERENCES.toLocaleString()));
});

test("normal current-data validation and migration stay linear at a large supported catalog", () => {
  const source = migrateData(null) as unknown as Record<string, unknown>;
  const count = 20_000;
  (source.portableIndex as Record<string, unknown>).groups = [{ id: "group-large", title: "Large", order: 0 }];
  (source.portableIndex as Record<string, unknown>).subjects = Array.from({ length: count }, (_, index) => ({
    id: `subject-${index}`,
    title: `Subject ${index}`,
    groupId: "group-large",
    parentId: null,
    order: index,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
  }));

  const startedAt = performance.now();
  const cleaned = migrateData(source);
  const duration = performance.now() - startedAt;

  assert.equal(cleaned.portableIndex.subjects.length, count);
  assert.ok(duration < 1_500, `current-data validation and migration took ${duration.toFixed(1)} ms`);
});

test("synced history limits count UTF-8 bytes rather than JavaScript code units", () => {
  const source = migrateData(null);
  const oversized = snapshotPersonal(source, "Multibyte history");
  oversized.pinnedPaths = ["界".repeat(MAX_UNDO_BYTES / 2)];
  source.undoStack = [oversized];

  assert.ok(JSON.stringify(oversized).length < MAX_UNDO_BYTES);
  assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > MAX_UNDO_BYTES);
  assert.deepEqual(migrateData(source).undoStack, []);
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

test("reserved Windows device names stay reserved with an extension", () => {
  // Windows reserves the segment before the first dot, so these files cannot be
  // created there and a vault carrying one cannot sync to a Windows device.
  assert.equal(sanitizeFileName("con.jpg"), "con-note.jpg");
  assert.equal(sanitizeFileName("AUX.pdf"), "AUX-note.pdf");
  assert.equal(sanitizeFileName("nul.tar.gz"), "nul-note.tar.gz");
  assert.equal(sanitizeFileName("console.jpg"), "console.jpg");
  assert.equal(sanitizeFileName("com10.txt"), "com10.txt");
  assert.equal(genericNotePath("KB", "NUL.txt"), "KB/NUL-note.txt.md");
});

test("one parsed query stays stateless across records and repeated use", () => {
  const target = record({ title: "Café airway", aliases: ["مجرى الهواء"] });
  const other = record({ path: "03 Clinical Topics/02 Otology/ENT-OTO-001.md", title: "Otology basics", aliases: [], domain: "Otology" });
  for (const query of ["cafe", "مجرى", "priority:P1", "priority:P3", "domain:pediatric cafe", ""]) {
    const parsed = parseQuery(query);
    // A parsed query is reused across every rendered record, so applying it
    // must never differ from parsing the same text again for that record.
    for (const candidate of [target, other, target, other]) {
      assert.equal(
        matchesParsedQuery(candidate, parsed),
        matchesParsedQuery(candidate, parseQuery(query)),
        `${query} / ${candidate.title}`,
      );
    }
  }
});

test("search normalization is locale-invariant and folds careful Arabic/Persian variants", () => {
  assert.equal(normalizeSearchText("LARYNGITIS"), "laryngitis");
  assert.equal(normalizeSearchText("Ménière’s"), normalizeSearchText("Menieres"), "apostrophe variants and accents fold together");
  assert.equal(normalizeSearchText("\"vertigo\""), normalizeSearchText("vertigo"), "free-text wrapper quotes are ignored");
  assert.equal(normalizeSearchText("حـنـجـرة"), normalizeSearchText("حنجرة"), "tatweel is presentation-only");
  assert.equal(normalizeSearchText("ٱلحنجرة"), normalizeSearchText("الحنجرة"), "alef wasla folds to bare alef");
  assert.equal(normalizeSearchText("ﻻرنجومالاسيا"), normalizeSearchText("لارنجومالاسيا"), "lam-alef presentation forms decompose");
  assert.equal(normalizeSearchText("مستشفى"), normalizeSearchText("مستشفي"), "alef maqsura folds to Arabic yeh");
  assert.equal(normalizeSearchText("علی"), normalizeSearchText("علي"), "Farsi yeh folds to Arabic yeh");
  assert.equal(normalizeSearchText("کاف"), normalizeSearchText("كاف"), "Persian keheh folds to Arabic kaf");
  assert.equal(normalizeSearchText("مدرسة"), normalizeSearchText("مدرسه"), "ta marbuta folds to common keyboard ha");
  assert.equal(normalizeSearchText("ENT-٠١٢ / ۱۲"), normalizeSearchText("ENT-012 / 12"), "Arabic and Persian digits fold to ASCII digits");

  const arabic = record({ title: "مستشفى", aliases: ["حـنـجـرة", "کاف"] });
  for (const query of ["مستشفي", "حنجرة", "كاف"]) assert.equal(matchesQuery(arabic, query), true, query);

  const eponym = record({ title: "Ménière’s disease", aliases: ["Vertigo syndrome"] });
  for (const query of ["menieres", "meniere's", "\"vertigo\""]) assert.equal(matchesQuery(eponym, query), true, query);
});

test("search keeps both a cold ten-thousand-record pass and cached render passes responsive", () => {
  const records = Array.from({ length: 10_000 }, (_, index) => record({
    path: `Knowledge Base/Group ${index % 20}/Note ${index}.md`,
    title: `Sample note ${index} with Ünïcödé and عربي text`,
    aliases: [`alias ${index}`],
  }));
  const parsed = parseQuery("sample uni");
  const coldStart = performance.now();
  let matched = records.filter((item) => matchesParsedQuery(item, parsed)).length;
  const coldElapsed = performance.now() - coldStart;

  // renderCurriculum can evaluate each already-normalized node again for
  // filtering, counting, and rendering. Measure this cached path separately so
  // shared-runner cold-start noise cannot hide a memoization regression.
  const cachedStart = performance.now();
  for (let pass = 0; pass < 3; pass += 1) {
    for (const item of records) if (matchesParsedQuery(item, parsed)) matched += 1;
  }
  const cachedElapsed = performance.now() - cachedStart;
  assert.equal(matched, records.length * 4);
  assert.ok(coldElapsed < 750, `cold match pass over 10,000 records took ${coldElapsed.toFixed(1)} ms`);
  assert.ok(cachedElapsed < 250, `three cached match passes over 10,000 records took ${cachedElapsed.toFixed(1)} ms`);
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

test("case-variant group names share one sibling container", () => {
  const records = [
    record({ path: "KB/first.md", title: "First", domain: "Recipes", curriculumId: "", role: "supporting", parentTopic: "" }),
    record({ path: "KB/second.md", title: "Second", domain: "recipes", curriculumId: "", role: "supporting", parentTopic: "" }),
  ];
  const tree = buildCurriculumTree(records, { parentByPath: {}, orderByContainer: {} });
  assert.equal(tree.domains.length, 1, "the tree merges the case variants into one domain");
  // A case-variant record must see the shared roots; empty siblings would make
  // a visual move rewrite the shared container order with a single path.
  assert.deepEqual(curriculumSiblingPaths(tree, records[1]).sort(), ["KB/first.md", "KB/second.md"]);
  assert.deepEqual(curriculumSiblingPaths(tree, records[0]).sort(), ["KB/first.md", "KB/second.md"]);
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

test("portable v5 declares every selected library while legacy v1 packages remain readable", () => {
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

  assert.equal(current.version, 5);
  assert.equal(current.components.index?.version, 5);
  assert.deepEqual(current.components.index?.includedSections, {
    index: false,
    libraryIds: ["medication"],
  });
  assert.deepEqual(current.components.index?.libraries?.map((library) => library.id), ["medication"]);
  assert.deepEqual(selectionAvailableForExport(parsePortableExport(structuredClone(current))), portableSelection({ medications: true }));

  const legacy = portableFixture();
  const parsedLegacy = parsePortableExport(structuredClone(legacy));
  assert.equal(parsedLegacy.version, 1);
  assert.equal(parsedLegacy.components.index?.version, 1);
  assert.equal(parsedLegacy.components.index?.includedSections, undefined);
  assert.deepEqual(selectionAvailableForExport(parsedLegacy), portableSelection({ index: true }));
});

test("portable v4 preserves nested library organization by stable subject ID", () => {
  const source = migrateData(null);
  const medication = record({
    path: "Source/Medications/Allergodil.md",
    title: "Allergodil",
    kind: "medication",
    role: "library",
    domain: "Nasal medications",
    curriculumId: "",
  });
  synchronizePortableRegistry(source, [medication]);
  const subjectId = Object.entries(source.portableIndex.resolvedPathBySubjectId)
    .find(([, path]) => path === medication.path)?.[0] ?? "";
  assert.ok(subjectId);
  source.portableIndex.libraryLayouts.medication = [{
    id: "medication-heading",
    title: "Topical medication",
    collapsed: true,
    subjects: [],
    subheadings: [{
      id: "medication-subheading",
      title: "Intranasal",
      collapsed: false,
      subjects: [subjectId],
    }],
  }];

  const exported = createPortableExport(
    source,
    [medication],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(JSON.stringify(exported).includes(medication.path), false);
  assert.deepEqual(exported.components.index?.libraryLayouts?.medication[0]?.subheadings[0]?.subjects, [subjectId]);
  assert.equal(exported.components.index?.libraryLayouts?.procedure, undefined);

  const parsed = parsePortableExport(structuredClone(exported));
  const target = migrateData(null);
  applyPortableExport(target, parsed, portableSelection({ medications: true }), "replace");
  assert.deepEqual(target.portableIndex.libraryLayouts.medication, exported.components.index?.libraryLayouts?.medication);
  assert.equal(target.portableIndex.libraryLayouts.procedure, undefined);
});

test("portable v3 merge and replace translate layout references to a matched local subject ID", () => {
  const source = migrateData(null);
  const medication = record({
    path: "Source/Medications/Allergodil.md",
    title: "Allergodil",
    kind: "medication",
    role: "library",
    domain: "Nasal medications",
    curriculumId: "",
  });
  synchronizePortableRegistry(source, [medication]);
  const incomingSubjectId = Object.keys(source.portableIndex.resolvedPathBySubjectId)[0] ?? "";
  source.portableIndex.libraryLayouts.medication = [{
    id: "imported-medications",
    title: "Topical medication",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "imported-nasal", title: "Intranasal", collapsed: false, subjects: [incomingSubjectId] }],
  }];
  const exported = parsePortableExport(createPortableExport(
    source,
    [medication],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  ));

  for (const mode of ["merge", "replace"] as const) {
    const target = migrateData(null);
    target.portableIndex = cleanPortableIndex({
      version: 2,
      groups: [{ id: "local-group", title: "Nasal medications", order: 0 }],
      subjects: [{
        id: "local-medication",
        title: "Allergodil",
        groupId: "local-group",
        parentId: null,
        order: 0,
        indexed: false,
        configuredId: "",
        recordKind: "medication",
      }],
      resolvedPathBySubjectId: {},
      libraryLayouts: {
        procedure: [],
        medication: [{ id: "local-heading", title: "Local", collapsed: false, subjects: ["local-medication"], subheadings: [] }],
        syndrome: [],
      },
    });

    applyPortableExport(target, exported, portableSelection({ medications: true }), mode);
    const importedHeading = target.portableIndex.libraryLayouts.medication
      .find((heading) => heading.id === "imported-medications");
    assert.deepEqual(importedHeading?.subheadings[0]?.subjects, ["local-medication"], mode);
    assert.equal(JSON.stringify(target.portableIndex.libraryLayouts).includes(incomingSubjectId), false, mode);
  }
});

test("registry synchronization keeps same-title groups independent across library catalogs", () => {
  const data = migrateData(null);
  const medication = record({
    path: "Reference/Medication.md",
    title: "Medication",
    kind: "medication",
    role: "library",
    domain: "General",
    curriculumId: "",
  });
  const procedure = record({
    path: "Reference/Procedure.md",
    title: "Procedure",
    kind: "procedure",
    role: "library",
    domain: "General",
    curriculumId: "",
  });
  data.portableIndex.groups = [
    { id: "medication-general", title: "General", order: 0 },
    { id: "procedure-general", title: "General", order: 1 },
  ];
  data.portableIndex.subjects = [
    { id: "medication-subject", title: medication.title, groupId: "medication-general", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    { id: "procedure-subject", title: procedure.title, groupId: "procedure-general", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "procedure" },
  ];
  data.portableIndex.resolvedPathBySubjectId = {
    "medication-subject": medication.path,
    "procedure-subject": procedure.path,
  };

  synchronizePortableRegistry(data, [medication, procedure]);

  const medicationGroupId = data.portableIndex.subjects.find((subject) => subject.id === "medication-subject")?.groupId;
  const procedureGroupId = data.portableIndex.subjects.find((subject) => subject.id === "procedure-subject")?.groupId;
  assert.ok(medicationGroupId && procedureGroupId);
  assert.notEqual(medicationGroupId, procedureGroupId);
  assert.equal(data.portableIndex.groups.find((group) => group.id === medicationGroupId)?.title, "General");
  assert.equal(data.portableIndex.groups.find((group) => group.id === procedureGroupId)?.title, "General");

  const once = structuredClone(data.portableIndex);
  synchronizePortableRegistry(data, [procedure, medication]);
  assert.deepEqual(data.portableIndex, once, "reversing record enumeration does not collapse or churn scoped groups");
});

test("one-record same-title registry synchronization and export stay idempotent across repeated passes", () => {
  const data = migrateData(null);
  const topic = record({
    path: "Knowledge Base/General/Single topic.md",
    title: "Single topic",
    kind: "topic",
    role: "canonical",
    domain: "General",
    curriculumId: "",
  });
  data.indexGroupOrder = ["General"];
  data.portableIndex.groups = [{ id: "group-general", title: "General", order: 0 }];
  data.portableIndex.subjects = [{
    id: "subject-single-topic",
    title: topic.title,
    groupId: "group-general",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
    libraryId: null,
  }];
  data.portableIndex.resolvedPathBySubjectId = { "subject-single-topic": topic.path };

  // Allow one normalization pass for unrelated derived fields, then require
  // every later synchronization and export to be a true fixed point.
  synchronizePortableRegistry(data, [topic]);
  assert.equal(data.portableIndex.subjects[0]?.groupId, "group-general");
  assert.equal(data.portableIndex.groups.filter((group) => group.title === "General").length, 1);
  const expectedRegistry = structuredClone(data.portableIndex);
  for (let pass = 0; pass < 5; pass += 1) {
    assert.equal(synchronizePortableRegistry(data, [topic]), false, `synchronization pass ${pass + 1}`);
    assert.deepEqual(data.portableIndex, expectedRegistry, `registry pass ${pass + 1}`);
    assert.equal(data.portableIndex.groups.filter((group) => group.title === "General").length, 1);

    const exported = createPortableExport(
      data,
      [topic],
      portableSelection({ index: true }),
      "2026-08-09T00:00:00.000Z",
    );
    assert.deepEqual(data.portableIndex, expectedRegistry, `export pass ${pass + 1}`);
    assert.deepEqual(exported.components.index?.groups.map((group) => group.id), ["group-general"]);
    assert.deepEqual(exported.components.index?.subjects.map((subject) => subject.id), ["subject-single-topic"]);
    assert.equal(exported.components.index?.subjects[0]?.groupId, "group-general");
  }
});

test("registry synchronization preserves explicit custom and unassigned library identities", () => {
  const data = migrateData(null);
  data.portableIndex.libraries = [{
    id: "library-custom",
    name: "Custom",
    singularName: "Item",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  data.portableIndex.groups = [
    { id: "group-custom", title: "Custom", order: 0 },
    { id: "group-unassigned", title: "Unassigned", order: 1 },
  ];
  data.portableIndex.subjects = [
    {
      id: "subject-custom-topic",
      title: "Custom topic",
      groupId: "group-custom",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
      libraryId: "library-custom",
    },
    {
      id: "subject-unassigned-medication",
      title: "Unassigned medication",
      groupId: "group-unassigned",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "medication",
      libraryId: null,
    },
  ];
  data.portableIndex.resolvedPathBySubjectId = {
    "subject-custom-topic": "Knowledge Base/Custom topic.md",
    "subject-unassigned-medication": "Knowledge Base/Unassigned medication.md",
  };
  data.portableIndex.libraryLayouts = {
    "library-custom": [{
      id: "custom-heading",
      title: "Custom",
      collapsed: false,
      subjects: ["subject-custom-topic"],
      subheadings: [],
    }],
  };
  const customTopic = record({
    path: "Knowledge Base/Custom topic.md",
    title: "Custom topic",
    kind: "topic",
    role: "canonical",
    curriculumId: "",
    domain: "Topics",
    libraryId: "library-custom",
  });
  const unassignedMedication = record({
    path: "Knowledge Base/Unassigned medication.md",
    title: "Unassigned medication",
    kind: "medication",
    role: "library",
    curriculumId: "",
    domain: "Unassigned",
  });

  synchronizePortableRegistry(data, [customTopic, unassignedMedication]);

  const custom = data.portableIndex.subjects.find((subject) => subject.id === "subject-custom-topic");
  const unassigned = data.portableIndex.subjects.find((subject) => subject.id === "subject-unassigned-medication");
  assert.equal(custom?.indexed, false);
  assert.equal(custom?.libraryId, "library-custom");
  assert.equal(custom?.parentId, null);
  assert.equal(unassigned?.indexed, false);
  assert.equal(unassigned?.libraryId, null);
  assert.equal(data.portableIndex.libraries.some((library) => library.id === BUILTIN_LIBRARY_IDS.medication), false);
});

test("selective imports fork cross-catalog stable-ID collisions instead of reclassifying local subjects", () => {
  const source = migrateData(null);
  source.portableIndex.groups = [{ id: "shared-group", title: "General", order: 0 }];
  source.portableIndex.subjects = [{
    id: "shared-subject",
    title: "Imported medication",
    groupId: "shared-group",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "medication",
  }];
  source.portableIndex.libraryLayouts.medication = [{
    id: "imported-medications",
    title: "Imported medications",
    collapsed: false,
    subjects: ["shared-subject"],
    subheadings: [],
  }];
  const exported = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  ));

  const target = migrateData(null);
  target.settings.workspaceMode = "ent-clinical";
  target.portableIndex.groups = [{ id: "shared-group", title: "General", order: 0 }];
  target.portableIndex.subjects = [{
    id: "shared-subject",
    title: "Local clinical topic",
    groupId: "shared-group",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "ENT-PED-001",
    recordKind: "topic",
  }];
  target.portableIndex.resolvedPathBySubjectId = {
    "shared-subject": "03 Clinical Topics/01 Pediatric/ENT-PED-001 - Local clinical topic.md",
  };

  applyPortableExport(target, exported, portableSelection({ medications: true }), "merge");

  const local = target.portableIndex.subjects.find((subject) => subject.id === "shared-subject");
  const imported = target.portableIndex.subjects.find((subject) => subject.recordKind === "medication");
  assert.equal(local?.recordKind, "topic");
  assert.equal(local?.title, "Local clinical topic");
  assert.equal(target.portableIndex.resolvedPathBySubjectId["shared-subject"], "03 Clinical Topics/01 Pediatric/ENT-PED-001 - Local clinical topic.md");
  assert.ok(imported && imported.id !== "shared-subject");
  assert.equal(target.portableIndex.resolvedPathBySubjectId[imported.id], undefined);
  assert.notEqual(imported.groupId, local?.groupId);
  assert.deepEqual(target.portableIndex.libraryLayouts.medication[0]?.subjects, [imported.id]);
});

test("a cross-catalog dependency collision gets a distinct placeholder for imported collections", () => {
  const source = migrateData(null);
  source.portableIndex.groups = [{ id: "shared-group", title: "General", order: 0 }];
  source.portableIndex.subjects = [{
    id: "shared-subject",
    title: "Imported medication dependency",
    groupId: "shared-group",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "medication",
  }];
  source.collections = [{
    id: "imported-collection",
    title: "Medication reading",
    collapsed: false,
    subjects: [portablePlaceholderPath("shared-subject")],
    subheadings: [],
  }];
  const exported = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ collections: true }),
    "2026-08-08T00:00:00.000Z",
  ));

  const target = migrateData(null);
  target.portableIndex.groups = [{ id: "shared-group", title: "General", order: 0 }];
  target.portableIndex.subjects = [{
    id: "shared-subject",
    title: "Local topic",
    groupId: "shared-group",
    parentId: null,
    order: 4,
    indexed: true,
    configuredId: "LOCAL-001",
    recordKind: "topic",
  }];
  target.portableIndex.resolvedPathBySubjectId = { "shared-subject": "Knowledge Base/Local topic.md" };

  applyPortableExport(target, exported, portableSelection({ collections: true }), "merge");

  const local = target.portableIndex.subjects.find((subject) => subject.id === "shared-subject");
  const dependency = target.portableIndex.subjects.find((subject) => subject.recordKind === "medication");
  assert.deepEqual(local, {
    id: "shared-subject",
    title: "Local topic",
    groupId: "shared-group",
    parentId: null,
    order: 4,
    indexed: true,
    configuredId: "LOCAL-001",
    recordKind: "topic",
  });
  assert.ok(dependency && dependency.id !== "shared-subject");
  assert.deepEqual(target.collections[0]?.subjects, [portablePlaceholderPath(dependency.id)]);
});

test("library merge treats same-ID different-title headings and subheadings as independent", () => {
  const source = migrateData(null);
  source.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  source.portableIndex.subjects = [{
    id: "incoming-medication",
    title: "Imported medication",
    groupId: "medications",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "medication",
  }];
  source.portableIndex.libraryLayouts.medication = [{
    id: "default-heading",
    title: "Imported medications",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "default-subheading", title: "Imported subgroup", collapsed: false, subjects: ["incoming-medication"] }],
  }];
  const exported = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  ));

  const target = migrateData(null);
  target.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  target.portableIndex.subjects = [{
    id: "local-medication",
    title: "Local medication",
    groupId: "medications",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "medication",
  }];
  target.portableIndex.libraryLayouts.medication = [{
    id: "default-heading",
    title: "Local medications",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "default-subheading", title: "Local subgroup", collapsed: false, subjects: ["local-medication"] }],
  }];

  applyPortableExport(target, exported, portableSelection({ medications: true }), "merge");

  const localHeading = target.portableIndex.libraryLayouts.medication.find((heading) => heading.title === "Local medications");
  const importedHeading = target.portableIndex.libraryLayouts.medication.find((heading) => heading.title === "Imported medications");
  assert.equal(target.portableIndex.libraryLayouts.medication.length, 2);
  assert.equal(localHeading?.id, "default-heading");
  assert.ok(importedHeading && importedHeading.id !== "default-heading");
  assert.deepEqual(localHeading?.subheadings[0]?.subjects, ["local-medication"]);
  assert.deepEqual(importedHeading.subheadings[0]?.subjects, ["incoming-medication"]);
  assert.equal(localHeading?.subheadings[0]?.id, "default-subheading");
  assert.notEqual(importedHeading.subheadings[0]?.id, "default-subheading");
});

test("library merge preserves repeated heading and subheading titles as distinct stable identities", () => {
  const source = migrateData(null);
  source.portableIndex.groups = [{ id: "source-medications", title: "Medications", order: 0 }];
  source.portableIndex.subjects = [
    {
      id: "incoming-one",
      title: "Incoming one",
      groupId: "source-medications",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "medication",
    },
    {
      id: "incoming-two",
      title: "Incoming two",
      groupId: "source-medications",
      parentId: null,
      order: 1,
      indexed: false,
      configuredId: "",
      recordKind: "medication",
    },
    {
      id: "incoming-three",
      title: "Incoming three",
      groupId: "source-medications",
      parentId: null,
      order: 2,
      indexed: false,
      configuredId: "",
      recordKind: "medication",
    },
  ];
  source.portableIndex.libraryLayouts.medication = [
    {
      id: "incoming-heading-one",
      title: "Repeated heading",
      collapsed: false,
      subjects: [],
      subheadings: [
        { id: "incoming-subheading-one", title: "Repeated subheading", collapsed: false, subjects: ["incoming-one"] },
        { id: "incoming-subheading-two", title: "Repeated subheading", collapsed: false, subjects: ["incoming-two"] },
      ],
    },
    {
      id: "incoming-heading-two",
      title: "Repeated heading",
      collapsed: false,
      subjects: ["incoming-three"],
      subheadings: [],
    },
  ];
  const exported = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  ));

  const target = migrateData(null);
  target.portableIndex.groups = [{ id: "local-medications", title: "Medications", order: 0 }];
  target.portableIndex.subjects = [{
    id: "local-medication",
    title: "Local medication",
    groupId: "local-medications",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "medication",
  }];
  target.portableIndex.libraryLayouts.medication = [{
    id: "local-heading",
    title: "Repeated heading",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: "local-subheading",
      title: "Repeated subheading",
      collapsed: false,
      subjects: ["local-medication"],
    }],
  }];

  applyPortableExport(target, exported, portableSelection({ medications: true }), "merge");

  const headings = target.portableIndex.libraryLayouts.medication;
  assert.equal(headings.length, 2);
  const matchedHeading = headings.find((heading) => heading.id === "local-heading");
  const distinctHeading = headings.find((heading) => heading.id === "incoming-heading-two");
  assert.ok(matchedHeading);
  assert.ok(distinctHeading);
  assert.deepEqual(distinctHeading.subjects, ["incoming-three"]);
  assert.equal(matchedHeading.subheadings.length, 2);
  assert.deepEqual(
    matchedHeading.subheadings.find((subheading) => subheading.id === "local-subheading")?.subjects,
    ["local-medication", "incoming-one"],
  );
  assert.deepEqual(
    matchedHeading.subheadings.find((subheading) => subheading.id === "incoming-subheading-two")?.subjects,
    ["incoming-two"],
  );
});

test("portable v2 catalogs migrate to flat library layouts while v3 rejects duplicate placement", () => {
  const source = migrateData(null);
  const medication = record({
    path: "Source/Medications/Dependency.md",
    title: "Dependency",
    kind: "medication",
    role: "library",
    domain: "Nasal medications",
    curriculumId: "",
  });
  const v4 = createPortableExport(
    source,
    [medication],
    portableSelection({ medications: true }),
    "2026-08-08T00:00:00.000Z",
  );
  const v2 = structuredClone(v4) as unknown as {
    version: number;
    components: { index: { version: number; libraries?: unknown; libraryLayouts?: unknown; includedSections: unknown; subjects: Array<{ id: string }> } };
  };
  v2.version = 2;
  v2.components.index.version = 2;
  delete v2.components.index.libraries;
  delete v2.components.index.libraryLayouts;
  v2.components.index.includedSections = { index: false, procedures: false, medications: true, syndromes: false };
  const parsedV2 = parsePortableExport(v2);
  assert.equal(parsedV2.version, 2);
  assert.equal(parsedV2.components.index?.libraryLayouts?.medication[0]?.title, "Nasal medications");
  assert.deepEqual(
    parsedV2.components.index?.libraryLayouts?.medication[0]?.subjects,
    [v2.components.index.subjects[0]?.id],
  );
  const incompleteV2 = structuredClone(v2) as unknown as {
    components: { index: { includedSections: Record<string, unknown> } };
  };
  delete incompleteV2.components.index.includedSections.medications;
  assert.throws(() => parsePortableExport(incompleteV2), /includedSections\.medications must be true or false/i);

  const duplicate = structuredClone(v4) as unknown as {
    version: number;
    components: {
      index: {
        version: number;
        libraries?: unknown;
        includedSections: unknown;
        subjects: Array<{ id: string }>;
        libraryLayouts: Record<string, LayoutHeading[]>;
      };
    };
  };
  duplicate.version = 3;
  duplicate.components.index.version = 3;
  delete duplicate.components.index.libraries;
  duplicate.components.index.includedSections = { index: false, procedures: false, medications: true, syndromes: false };
  duplicate.components.index.libraryLayouts.procedure = [];
  duplicate.components.index.libraryLayouts.syndrome = [];
  const subjectId = duplicate.components.index?.subjects[0]?.id ?? "";
  assert.ok(duplicate.components.index?.libraryLayouts && subjectId);
  duplicate.components.index.libraryLayouts.medication = [{
    id: "duplicate-heading",
    title: "Duplicate",
    collapsed: false,
    subjects: [subjectId],
    subheadings: [{ id: "duplicate-subheading", title: "Duplicate", collapsed: false, subjects: [subjectId] }],
  }];
  assert.throws(() => parsePortableExport(duplicate), /appears more than once/i);
});

test("portable v4 keeps Generic indexes flexible but rejects indexed non-topics from ENT atomically", () => {
  const source = migrateData(null);
  const sourceRecord = record({
    path: "Knowledge Base/Imported reference.md",
    title: "Imported reference",
    kind: "topic",
    role: "supporting",
    domain: "References",
    curriculumId: "",
  });
  const exported = createPortableExport(
    source,
    [sourceRecord],
    portableSelection({ index: true }),
    "2026-08-09T00:00:00.000Z",
  );
  const raw = structuredClone(exported);
  const incomingSubject = raw.components.index?.subjects[0];
  assert.ok(incomingSubject);
  incomingSubject.recordKind = "note";
  const parsed = parsePortableExport(raw);

  const generic = migrateData(null);
  applyPortableExport(generic, parsed, portableSelection({ index: true }), "merge");
  const genericSubject = generic.portableIndex.subjects.find((subject) => subject.title === "Imported reference");
  assert.equal(genericSubject?.recordKind, "note");
  assert.equal(genericSubject?.indexed, true);

  for (const mode of ["merge", "replace"] as const) {
    const clinical = migrateData(null);
    clinical.settings.workspaceMode = "ent-clinical";
    clinical.settings.primaryFolder = "03 Clinical Topics";
    const before = structuredClone(clinical);
    assert.throws(
      () => applyPortableExport(clinical, parsed, portableSelection({ index: true }), mode),
      /ENT knowledge index accepts topic subjects only/i,
    );
    assert.deepEqual(clinical, before, `${mode} must reject before changing destination data`);
  }
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
  assert.equal(available.libraryIds.includes(BUILTIN_LIBRARY_IDS.medication), false);
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

test("a v4 collection-only export carries a medication solely as a referenced dependency", () => {
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
    libraryIds: [],
  });
  assert.deepEqual(index.libraries?.map((library) => library.id), ["medication"]);
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

test("portable v4 rejects malformed, contradictory, and undeclared library provenance", () => {
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

  const nonList = structuredClone(valid) as unknown as {
    components: { index: { includedSections: Record<string, unknown> } };
  };
  nonList.components.index.includedSections.libraryIds = "medication";
  assert.throws(() => parsePortableExport(nonList), /includedSections\.libraryIds must be a list/i);

  const duplicateSelection = structuredClone(valid) as unknown as {
    components: { index: { includedSections: { libraryIds: string[] } } };
  };
  duplicateSelection.components.index.includedSections.libraryIds.push("medication");
  assert.throws(() => parsePortableExport(duplicateSelection), /duplicate included library ID/i);

  const contradictory = structuredClone(valid) as unknown as { components: { index: { includeIndex: boolean } } };
  contradictory.components.index.includeIndex = true;
  assert.throws(() => parsePortableExport(contradictory), /includeIndex conflicts/i);

  const undeclared = structuredClone(valid) as unknown as {
    components: { index: { includedSections: { libraryIds: string[] }; libraryLayouts: Record<string, LayoutHeading[]> } };
  };
  undeclared.components.index.includedSections.libraryIds = [];
  undeclared.components.index.libraryLayouts = {};
  assert.throws(() => parsePortableExport(undeclared), /undeclared catalog/i);

  const unknownDefinition = structuredClone(valid) as unknown as {
    components: { index: { subjects: Array<{ libraryId: string | null }> } };
  };
  unknownDefinition.components.index.subjects[0].libraryId = "missing-library";
  assert.throws(() => parsePortableExport(unknownDefinition), /unknown library missing-library/i);

  const spoofedBuiltin = structuredClone(valid) as unknown as {
    components: { index: { libraries: Array<{ id: string; sourceKind: string | null }> } };
  };
  spoofedBuiltin.components.index.libraries[0].sourceKind = null;
  assert.throws(() => parsePortableExport(spoofedBuiltin), /reserved built-in identity/i);

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

test("portable v4 round-trips same-name custom libraries by stable ID without paths", () => {
  const source = migrateData(null);
  source.portableIndex.libraries = [
    { id: "library-alpha", name: "Reference", singularName: "Article", icon: "book-open", order: 0, sourceKind: null, archivedAt: null },
    { id: "library-beta", name: "Reference", singularName: "Paper", icon: "books", order: 1, sourceKind: null, archivedAt: null },
  ];
  source.portableIndex.libraryLayouts = { "library-alpha": [], "library-beta": [] };
  const alpha = record({
    path: "Private/Alpha.md",
    title: "Alpha",
    kind: "note",
    role: "library",
    domain: "Alpha shelf",
    curriculumId: "",
    libraryId: "library-alpha",
  });
  const beta = record({
    path: "Private/Beta.md",
    title: "Beta",
    kind: "note",
    role: "library",
    domain: "Beta shelf",
    curriculumId: "",
    libraryId: "library-beta",
  });
  synchronizePortableRegistry(source, [alpha, beta]);
  const alphaId = subjectIdForPath(source, alpha.path);
  const betaId = subjectIdForPath(source, beta.path);
  source.portableIndex.libraryLayouts["library-alpha"] = [{
    id: "alpha-heading",
    title: "Alpha heading",
    collapsed: false,
    subjects: [alphaId],
    subheadings: [],
  }];
  source.portableIndex.libraryLayouts["library-beta"] = [{
    id: "beta-heading",
    title: "Beta heading",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "beta-subheading", title: "Nested", collapsed: true, subjects: [betaId] }],
  }];

  const exported = createPortableExport(
    source,
    [alpha, beta],
    portableSelection({ libraryIds: ["library-alpha", "library-beta"] }),
    "2026-08-09T00:00:00.000Z",
  );
  const serialized = serializePortableExport(exported);
  const parsed = parsePortableExport(JSON.parse(serialized) as unknown);

  assert.deepEqual(parsed.components.index?.includedSections, {
    index: false,
    libraryIds: ["library-alpha", "library-beta"],
  });
  assert.deepEqual(parsed.components.index?.libraries?.map((library) => [library.id, library.name]), [
    ["library-alpha", "Reference"],
    ["library-beta", "Reference"],
  ]);
  assert.equal(
    parsed.components.index?.libraries?.find((library) => library.id === "library-beta")?.icon,
    "books",
    "portable parsing retains a syntactically valid future icon ID",
  );
  assert.deepEqual(parsed.components.index?.subjects.map((subject) => subject.libraryId).sort(), ["library-alpha", "library-beta"]);
  assert.equal(serialized.includes(alpha.path), false);
  assert.equal(serialized.includes(beta.path), false);

  const target = migrateData(null);
  applyPortableExport(
    target,
    parsed,
    portableSelection({ libraryIds: ["library-alpha", "library-beta"] }),
    "replace",
  );
  assert.deepEqual(target.portableIndex.libraries.map((library) => library.id).sort(), ["library-alpha", "library-beta"]);
  assert.equal(target.portableIndex.libraries.every((library) => library.name === "Reference"), true);
  assert.equal(
    target.portableIndex.libraries.find((library) => library.id === "library-beta")?.icon,
    "books",
    "import retains the stored icon while rendering applies the fallback",
  );
  assert.deepEqual(target.portableIndex.libraryLayouts["library-alpha"]?.[0]?.subjects, [alphaId]);
  assert.deepEqual(target.portableIndex.libraryLayouts["library-beta"]?.[0]?.subheadings[0]?.subjects, [betaId]);
});

test("portable v4 keeps dependency-only custom libraries non-authoritative", () => {
  const source = migrateData(null);
  source.portableIndex.libraries = [
    { id: "library-selected", name: "Selected", singularName: "Item", icon: "library", order: 0, sourceKind: null, archivedAt: null },
    { id: "library-dependency", name: "Source dependency", singularName: "Item", icon: "bookmark", order: 1, sourceKind: null, archivedAt: null },
  ];
  source.portableIndex.groups = [
    { id: "group-selected", title: "Selected", order: 0 },
    { id: "group-dependency", title: "Dependency", order: 1 },
  ];
  source.portableIndex.subjects = [
    { id: "subject-selected", title: "Selected subject", groupId: "group-selected", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "note", libraryId: "library-selected" },
    { id: "subject-dependency", title: "Dependency subject", groupId: "group-dependency", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "note", libraryId: "library-dependency" },
  ];
  source.portableIndex.libraryLayouts = {
    "library-selected": [{ id: "selected-heading", title: "Selected", collapsed: false, subjects: ["subject-selected"], subheadings: [] }],
    "library-dependency": [{ id: "source-heading", title: "Source", collapsed: false, subjects: ["subject-dependency"], subheadings: [] }],
  };
  source.collections = [{
    id: "reading",
    title: "Reading",
    collapsed: false,
    subjects: [portablePlaceholderPath("subject-dependency")],
    subheadings: [],
  }];
  const parsed = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ libraryIds: ["library-selected"], collections: true }),
    "2026-08-09T00:00:00.000Z",
  ));
  assert.deepEqual(parsed.components.index?.includedSections?.libraryIds, ["library-selected"]);
  assert.deepEqual(parsed.components.index?.libraries?.map((library) => library.id).sort(), ["library-dependency", "library-selected"]);
  assert.equal(parsed.components.index?.libraryLayouts?.["library-dependency"], undefined);

  const target = migrateData(null);
  target.portableIndex.libraries = [{
    id: "library-dependency",
    name: "Local dependency",
    singularName: "Local item",
    icon: "archive",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  target.portableIndex.groups = [{ id: "local-group", title: "Local", order: 0 }];
  target.portableIndex.subjects = [{
    id: "local-dependency",
    title: "Local dependency",
    groupId: "local-group",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "note",
    libraryId: "library-dependency",
  }];
  target.portableIndex.libraryLayouts = {
    "library-dependency": [{ id: "local-heading", title: "Local", collapsed: false, subjects: ["local-dependency"], subheadings: [] }],
  };
  applyPortableExport(
    target,
    parsed,
    portableSelection({ libraryIds: ["library-selected"], collections: true }),
    "replace",
  );
  assert.equal(target.portableIndex.libraries.find((library) => library.id === "library-dependency")?.name, "Local dependency");
  assert.deepEqual(target.portableIndex.libraryLayouts["library-dependency"]?.[0]?.subjects, ["local-dependency"]);
  assert.deepEqual(target.collections[0]?.subjects, [portablePlaceholderPath("subject-dependency")]);
});

test("replacing an empty custom library clears only that library and retains its definition", () => {
  const source = migrateData(null);
  source.portableIndex.libraries = [{
    id: "library-empty",
    name: "Empty library",
    singularName: "Item",
    icon: "library",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  source.portableIndex.libraryLayouts = { "library-empty": [] };
  const incoming = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ libraryIds: ["library-empty"] }),
    "2026-08-09T00:00:00.000Z",
  ));

  const target = migrateData(null);
  target.portableIndex.libraries = [
    { id: "library-empty", name: "Old empty", singularName: "Item", icon: "archive", order: 0, sourceKind: null, archivedAt: null },
    { id: "library-other", name: "Other", singularName: "Item", icon: "books", order: 1, sourceKind: null, archivedAt: null },
  ];
  target.portableIndex.groups = [
    { id: "group-empty", title: "Empty", order: 0 },
    { id: "group-other", title: "Other", order: 1 },
  ];
  target.portableIndex.subjects = [
    { id: "subject-empty", title: "Remove me", groupId: "group-empty", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "note", libraryId: "library-empty" },
    { id: "subject-other", title: "Keep me", groupId: "group-other", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "note", libraryId: "library-other" },
  ];
  target.portableIndex.libraryLayouts = {
    "library-empty": [{ id: "empty-heading", title: "Old", collapsed: false, subjects: ["subject-empty"], subheadings: [] }],
    "library-other": [{ id: "other-heading", title: "Other", collapsed: false, subjects: ["subject-other"], subheadings: [] }],
  };

  applyPortableExport(target, incoming, portableSelection({ libraryIds: ["library-empty"] }), "replace");
  assert.equal(target.portableIndex.libraries.some((library) => library.id === "library-empty"), true);
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-empty"), false);
  assert.deepEqual(target.portableIndex.libraryLayouts["library-empty"], []);
  assert.equal(target.portableIndex.subjects.some((subject) => subject.id === "subject-other"), true);
  assert.deepEqual(target.portableIndex.libraryLayouts["library-other"]?.[0]?.subjects, ["subject-other"]);
});

test("custom-library stable-ID collisions fork by library and remain idempotent", () => {
  const source = migrateData(null);
  source.portableIndex.libraries = [{ id: "library-incoming", name: "Incoming", singularName: "Item", icon: "library", order: 0, sourceKind: null, archivedAt: null }];
  source.portableIndex.groups = [{ id: "shared-group", title: "Shared", order: 0 }];
  source.portableIndex.subjects = [{
    id: "shared-subject",
    title: "Shared title",
    groupId: "shared-group",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "note",
    libraryId: "library-incoming",
  }];
  source.portableIndex.libraryLayouts = {
    "library-incoming": [{ id: "incoming-heading", title: "Incoming", collapsed: false, subjects: ["shared-subject"], subheadings: [] }],
  };
  const incoming = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ libraryIds: ["library-incoming"] }),
    "2026-08-09T00:00:00.000Z",
  ));

  const target = migrateData(null);
  target.portableIndex.libraries = [{ id: "library-local", name: "Local", singularName: "Item", icon: "archive", order: 0, sourceKind: null, archivedAt: null }];
  target.portableIndex.groups = [{ id: "shared-group", title: "Shared", order: 0 }];
  target.portableIndex.subjects = [{
    id: "shared-subject",
    title: "Shared title",
    groupId: "shared-group",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "note",
    libraryId: "library-local",
  }];
  target.portableIndex.libraryLayouts = {
    "library-local": [{ id: "local-heading", title: "Local", collapsed: false, subjects: ["shared-subject"], subheadings: [] }],
  };

  const first = applyPortableExport(target, incoming, portableSelection({ libraryIds: ["library-incoming"] }), "merge");
  const imported = target.portableIndex.subjects.find((subject) => subject.libraryId === "library-incoming");
  assert.ok(imported && imported.id !== "shared-subject");
  assert.equal(first.addedSubjects, 1);
  assert.deepEqual(target.portableIndex.libraryLayouts["library-local"]?.[0]?.subjects, ["shared-subject"]);
  assert.deepEqual(target.portableIndex.libraryLayouts["library-incoming"]?.[0]?.subjects, [imported.id]);

  const second = applyPortableExport(target, incoming, portableSelection({ libraryIds: ["library-incoming"] }), "merge");
  assert.equal(second.addedSubjects, 0);
  assert.equal(target.portableIndex.subjects.filter((subject) => subject.libraryId === "library-incoming").length, 1);
  assert.deepEqual(target.portableIndex.libraryLayouts["library-incoming"]?.[0]?.subjects, [imported.id]);
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

test("device-local state round-trips active base, routes, collapse, and bounded history by stable ID", () => {
  const data = migrateData(null);
  data.selectedPath = "Knowledge/Topic.md";
  data.activeTab = "collections";
  data.collections = [{ id: "heading", title: "Heading", collapsed: true, subjects: [], subheadings: [] }];
  data.undoStack = [snapshotPersonal(data, "Local undo")];
  const store = createDefaultStore(data, 100, "vault-device-state");

  const parsed = parseDeviceLocalPluginState(createDeviceLocalPluginState(store));

  assert.equal(parsed.version, DEVICE_LOCAL_STATE_VERSION);
  assert.equal(parsed.vaultId, "vault-device-state");
  assert.equal(parsed.activeBaseId, "base-default");
  assert.equal(parsed.bases[0]?.view.selectedPath, "Knowledge/Topic.md");
  assert.equal(parsed.bases[0]?.view.activeTab, "collections");
  assert.equal(parsed.bases[0]?.view.collections[0]?.collapsed, true);
  assert.equal(parsed.bases[0]?.view.undoStack[0]?.label, "Local undo");
  assert.equal(parsed.historyIndexFolderSourcesIncluded, true);
});

test("v3 device-local history requires canonical membership provenance while v2 remains migratable", () => {
  const data = migrateData(null);
  const history = snapshotPersonal(data, "History provenance");
  history.layoutSnapshots = [snapshotPersonal(data, "Nested history provenance")];
  data.undoStack = [history];
  const raw = createDeviceLocalPluginState(createDefaultStore(data, 100, "vault-device-provenance")) as unknown as {
    version: number;
    historyIndexFolderSourcesIncluded?: boolean;
    bases: Array<{ view: { undoStack: Array<Record<string, unknown>> } }>;
  };
  const snapshot = raw.bases[0]?.view.undoStack[0];
  assert.ok(snapshot);
  const missingDirect = structuredClone(raw);
  const missingDirectSnapshot = missingDirect.bases[0]?.view.undoStack[0];
  assert.ok(missingDirectSnapshot);
  delete missingDirectSnapshot.directIndexPaths;
  assert.throws(
    () => parseDeviceLocalPluginState(missingDirect),
    /canonical Index membership provenance/i,
  );
  delete snapshot.indexFolderSources;

  assert.throws(
    () => parseDeviceLocalPluginState(structuredClone(raw)),
    /canonical Index membership provenance/i,
  );

  const emptySource = createDeviceLocalPluginState(createDefaultStore(data, 100, "vault-device-empty-source")) as unknown as typeof raw;
  const emptySourceSnapshot = emptySource.bases[0]?.view.undoStack[0];
  assert.ok(emptySourceSnapshot);
  emptySourceSnapshot.indexFolderSources = [{ id: "empty", path: "///", origin: "user" }];
  assert.throws(
    () => parseDeviceLocalPluginState(emptySource),
    /linked index folder 1 has an empty path/i,
  );

  const emptyNested = createDeviceLocalPluginState(createDefaultStore(data, 100, "vault-device-empty-nested-source")) as unknown as typeof raw;
  const nestedSnapshot = (emptyNested.bases[0]?.view.undoStack[0]?.layoutSnapshots as Array<Record<string, unknown>> | undefined)?.[0];
  assert.ok(nestedSnapshot);
  nestedSnapshot.indexFolderSources = [{ id: "empty", path: "", origin: "user" }];
  assert.throws(
    () => parseDeviceLocalPluginState(emptyNested),
    /named snapshot 1 linked index folder 1 has an empty path/i,
  );

  raw.version = 2;
  delete raw.historyIndexFolderSourcesIncluded;
  const legacy = parseDeviceLocalPluginState(raw);
  assert.equal(legacy.historyIndexFolderSourcesIncluded, false);
  assert.deepEqual(legacy.bases[0]?.view.undoStack[0]?.indexFolderSources, []);
});

test("device-local state keeps imported and hand-authored layout IDs instead of wiping every base", () => {
  const arabicId = "مجرى-الهواء";
  const data = migrateData({
    version: DATA_VERSION,
    directIndexPaths: [],
    indexFolderSources: [],
    collections: [
      { id: "_favourites", title: "Favourites", collapsed: true, subjects: [], subheadings: [{ id: arabicId, title: "مجرى الهواء", collapsed: true, subjects: [] }] },
    ],
  });
  assert.deepEqual(data.collections.map((heading) => heading.id), ["_favourites"], "cleanLayout keeps these IDs");
  assert.equal(data.collections[0]?.subheadings[0]?.id, arabicId);
  data.portableIndex.libraryLayouts = { reading: structuredClone(data.collections) };
  data.undoStack = [snapshotPersonal(data, "Local undo")];
  const store = createDefaultStore(data, 100, "vault-device-layout-ids");

  const parsed = parseDeviceLocalPluginState(createDeviceLocalPluginState(store));

  assert.equal(parsed.bases[0]?.view.collections[0]?.id, "_favourites");
  assert.equal(parsed.bases[0]?.view.collections[0]?.collapsed, true);
  assert.equal(parsed.bases[0]?.view.collections[0]?.subheadings[0]?.id, arabicId);
  assert.equal(parsed.bases[0]?.view.libraryLayouts[0]?.headings[0]?.id, "_favourites");
  assert.equal(parsed.bases[0]?.view.undoStack[0]?.label, "Local undo");
});

test("device-local state rejects malformed and oversized payloads without partial parsing", () => {
  assert.throws(() => parseDeviceLocalPluginState({
    version: DEVICE_LOCAL_STATE_VERSION,
    historyIndexFolderSourcesIncluded: true,
    vaultId: "vault-device-state",
    activeBaseId: "base-default",
    bases: [{ baseId: "base-default", view: { activeTab: "not-a-tab" } }],
  }), /invalid active tab|malformed/i);
  assert.throws(() => parseDeviceLocalPluginState({
    version: DEVICE_LOCAL_STATE_VERSION,
    historyIndexFolderSourcesIncluded: true,
    vaultId: "vault-device-state",
    activeBaseId: "base-default",
    bases: [],
    padding: "x".repeat(MAX_DEVICE_LOCAL_STATE_BYTES + 1),
  }), /too large/i);
  assert.throws(() => parseDeviceLocalPluginState({
    version: 1,
    activeBaseId: "base-default",
    bases: [],
  }), /unsupported|malformed/i, "legacy unbound state is never attached to a vault");
});

test("device-local bounding retains deterministic newest history suffixes", () => {
  const first = migrateData(null);
  const store = createDefaultStore(first, 100, "vault-large-device-state");
  for (let baseIndex = 0; baseIndex < 5; baseIndex += 1) {
    const data = baseIndex === 0 ? store.bases[0]?.data : migrateData(null);
    assert.ok(data);
    const paths = Array.from({ length: 1_500 }, (_, index) => `Knowledge/${baseIndex}/${String(index).padStart(4, "0")}-${"x".repeat(28)}.md`);
    data.undoStack = Array.from({ length: 20 }, (_, index) => {
      const snapshot = snapshotPersonal(data, `base-${baseIndex}-undo-${index}`);
      snapshot.pinnedPaths = paths;
      return snapshot;
    });
    if (baseIndex > 0) store.bases.push(createKnowledgeBaseEntry(data, `base-${baseIndex}`, 100 + baseIndex));
  }
  store.activeBaseId = "base-default";

  const built = createDeviceLocalPluginStateWithReport(store);
  assert.equal(built.historyTruncated, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(built.state)).byteLength <= MAX_DEVICE_LOCAL_STATE_BYTES);
  for (const base of built.state.bases) {
    const labels = base.view.undoStack.map((snapshot) => snapshot.label);
    const source = store.bases.find((entry) => entry.id === base.baseId)?.data.undoStack.map((snapshot) => snapshot.label) ?? [];
    assert.deepEqual(labels, source.slice(source.length - labels.length), `${base.baseId} retains only a newest suffix`);
  }
});

interface RawLayoutNode {
  id?: string;
  title: string;
  collapsed?: boolean;
  subjects?: string[];
  subheadings?: RawLayoutNode[];
}

/** Build one linear heading chain: level 1 is the heading, deeper levels nest. */
function nestedLayoutChain(
  levels: number,
  nodeAt: (level: number) => Partial<RawLayoutNode> = () => ({}),
): RawLayoutNode {
  let node: RawLayoutNode | null = null;
  for (let level = levels; level >= 1; level -= 1) {
    node = {
      id: `chain-${level}`,
      title: `Chain level ${level}`,
      collapsed: false,
      subjects: [],
      ...(node ? { subheadings: [node] } : {}),
      ...nodeAt(level),
    };
  }
  return node!;
}

/** Walk the first-child spine; depth 1 is the heading itself. */
function subheadingAt(heading: LayoutHeading, depth: number): LayoutHeading | LayoutSubheading {
  let node: LayoutHeading | LayoutSubheading = heading;
  for (let level = 1; level < depth; level += 1) {
    const child: LayoutSubheading | undefined = childSubheadings(node)[0];
    assert.ok(child, `expected a subheading at depth ${level + 1}`);
    node = child;
  }
  return node;
}

function collectLayoutIds(nodes: readonly (LayoutHeading | LayoutSubheading)[]): string[] {
  return nodes.flatMap((node) => [node.id, ...collectLayoutIds(childSubheadings(node))]);
}

test("cleanLayout round-trips five nested levels with stable IDs and a canonical leaf shape", () => {
  const input = nestedLayoutChain(MAX_LAYOUT_DEPTH, (level) => ({
    subjects: [`Knowledge/Level ${level}.md`],
    collapsed: level % 2 === 1,
  }));
  const first = migrateData({ version: DATA_VERSION, directIndexPaths: [], indexFolderSources: [], collections: [input] });
  const heading = first.collections[0];
  assert.ok(heading);
  for (let depth = 1; depth <= MAX_LAYOUT_DEPTH; depth += 1) {
    const node = subheadingAt(heading, depth);
    assert.equal(node.id, `chain-${depth}`);
    assert.equal(node.title, `Chain level ${depth}`);
    assert.deepEqual(node.subjects, [`Knowledge/Level ${depth}.md`]);
    assert.equal(node.collapsed, depth % 2 === 1);
  }
  const leaf = subheadingAt(heading, MAX_LAYOUT_DEPTH);
  assert.deepEqual(childSubheadings(leaf), []);
  assert.equal("subheadings" in leaf, false, "leaf subheadings keep the flat byte shape");
  assert.equal(countHeading(heading), MAX_LAYOUT_DEPTH, "every nested level contributes to the heading count");
  const second = migrateData({ version: DATA_VERSION, directIndexPaths: [], indexFolderSources: [], collections: structuredClone(first.collections) });
  assert.deepEqual(second.collections, first.collections, "cleaning nested layouts is idempotent");
  const clone = cloneCollections(first.collections);
  assert.deepEqual(clone, first.collections, "deep clones preserve the exact canonical shape");
  (subheadingAt(clone[0], MAX_LAYOUT_DEPTH)).subjects.push("Knowledge/Mutated.md");
  assert.deepEqual(subheadingAt(heading, MAX_LAYOUT_DEPTH).subjects, [`Knowledge/Level ${MAX_LAYOUT_DEPTH}.md`], "clones stay independent at depth");
  assert.deepEqual(childSubheadings({}), [], "absent nested arrays read as empty");
});

test("subjects nested beyond MAX_LAYOUT_DEPTH merge deduped into the nearest allowed ancestor", () => {
  const input = nestedLayoutChain(7, (level) => ({
    subjects: level === 5 ? ["Knowledge/L5.md", "Knowledge/Shared.md"]
      : level === 6 ? ["Knowledge/L6.md", "Knowledge/Shared.md"]
        : level === 7 ? ["Knowledge/L7.md", "Knowledge/L6.md"]
          : [],
  }));
  const data = migrateData({ version: DATA_VERSION, directIndexPaths: [], indexFolderSources: [], collections: [input] });
  const level5 = subheadingAt(data.collections[0], 5);
  assert.deepEqual(
    level5.subjects,
    ["Knowledge/L5.md", "Knowledge/Shared.md", "Knowledge/L6.md", "Knowledge/L7.md"],
    "deeper subjects arrive in document order without duplicating the ancestor's entries",
  );
  assert.equal("subheadings" in level5, false, "the too-deep nodes themselves are dropped");
});

test("layout ID uniqueness spans every depth with deterministic collision fallbacks", () => {
  const raw = {
    version: DATA_VERSION,
    directIndexPaths: [],
    indexFolderSources: [],
    collections: [
      {
        id: "shared",
        title: "Top",
        collapsed: false,
        subjects: [],
        subheadings: [{
          id: "child",
          title: "Mid",
          collapsed: false,
          subjects: [],
          subheadings: [{
            id: "shared",
            title: "Deep duplicate",
            collapsed: false,
            subjects: [],
            subheadings: [{ id: "__proto__", title: "Unsafe deep", collapsed: false, subjects: [] }],
          }],
        }],
      },
      { id: "shared-2", title: "Intact later heading", collapsed: false, subjects: [], subheadings: [] },
    ],
  };
  const first = migrateData(structuredClone(raw));
  const second = migrateData(structuredClone(raw));
  const ids = collectLayoutIds(first.collections);
  assert.equal(new Set(ids).size, ids.length, "IDs are globally unique across the whole layout");
  assert.equal(ids.includes("__proto__"), false);
  assert.equal(first.collections[0]?.id, "shared", "the first occurrence keeps its identity");
  const deepDuplicate = subheadingAt(first.collections[0], 3);
  assert.notEqual(deepDuplicate.id, "shared");
  assert.notEqual(deepDuplicate.id, "shared-2", "reserved intact identities are never stolen by collision fallbacks");
  assert.equal(first.collections[1]?.id, "shared-2");
  assert.equal(subheadingAt(first.collections[0], 4).id.startsWith("subheading-recovered-"), true);
  assert.deepEqual(second.collections, first.collections, "repair is deterministic across devices");
});

test("view-state collapse overlays restore nested subheadings by ID and default new structure expanded", () => {
  const data = migrateData({
    version: DATA_VERSION,
    directIndexPaths: [],
    indexFolderSources: [],
    collections: [nestedLayoutChain(MAX_LAYOUT_DEPTH, (level) => ({ collapsed: level !== 2 && level !== 4 }))],
  });
  const state = capturePluginViewState(data);
  const projected = semanticPluginDataProjection(data);
  for (let depth = 1; depth <= MAX_LAYOUT_DEPTH; depth += 1) {
    assert.equal(subheadingAt(projected.collections[0], depth).collapsed, false, "the semantic projection strips nested collapse state");
  }
  applyPluginViewState(projected, state);
  for (let depth = 1; depth <= MAX_LAYOUT_DEPTH; depth += 1) {
    assert.equal(subheadingAt(projected.collections[0], depth).collapsed, depth !== 2 && depth !== 4);
  }

  const renamed = semanticPluginDataProjection(data);
  subheadingAt(renamed.collections[0], 3).id = "renamed-structure";
  applyPluginViewState(renamed, state);
  assert.equal(subheadingAt(renamed.collections[0], 2).collapsed, false);
  assert.equal(subheadingAt(renamed.collections[0], 3).collapsed, false, "unmatched structure starts expanded");
  assert.equal(subheadingAt(renamed.collections[0], 5).collapsed, false, "children of unmatched structure start expanded");
});

test("nested collapse flags never alter the semantic entry fingerprint", () => {
  const data = migrateData({
    version: DATA_VERSION,
    directIndexPaths: [],
    indexFolderSources: [],
    collections: [nestedLayoutChain(MAX_LAYOUT_DEPTH)],
  });
  data.portableIndex = cleanPortableIndex({
    version: 2,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [{ id: "placed", title: "Placed", groupId: "group", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" }],
    resolvedPathBySubjectId: {},
    libraryLayouts: {
      medication: [{
        id: "m-1",
        title: "Top",
        collapsed: false,
        subjects: [],
        subheadings: [{
          id: "m-2",
          title: "Mid",
          collapsed: false,
          subjects: [],
          subheadings: [{ id: "m-3", title: "Leaf", collapsed: false, subjects: ["placed"] }],
        }],
      }],
    },
  });
  const variant = structuredClone(data);
  subheadingAt(variant.collections[0], MAX_LAYOUT_DEPTH).collapsed = true;
  subheadingAt(variant.portableIndex.libraryLayouts.medication[0], 3).collapsed = true;
  const fingerprint = (candidate: typeof data): string => semanticEntryFingerprint({ createdAt: 5, archivedAt: null, data: candidate });
  assert.equal(fingerprint(variant), fingerprint(data), "nested collapse is device view state, not semantic content");
  const retitled = structuredClone(variant);
  subheadingAt(retitled.collections[0], MAX_LAYOUT_DEPTH).title = "Retitled";
  assert.notEqual(fingerprint(retitled), fingerprint(data), "real nested edits still advance the fingerprint");
});

test("device-local collapse state parses legacy flat and nested payloads and caps hostile depth", () => {
  const data = migrateData({
    version: DATA_VERSION,
    directIndexPaths: [],
    indexFolderSources: [],
    collections: [nestedLayoutChain(MAX_LAYOUT_DEPTH, (level) => ({ collapsed: level === MAX_LAYOUT_DEPTH }))],
  });
  const store = createDefaultStore(data, 100, "vault-nested-collapse");
  const parsed = parseDeviceLocalPluginState(createDeviceLocalPluginState(store));
  let cursor = parsed.bases[0]?.view.collections[0];
  for (let depth = 2; depth <= MAX_LAYOUT_DEPTH; depth += 1) cursor = cursor?.subheadings[0];
  assert.equal(cursor?.collapsed, true, "nested collapse state round-trips through device-local storage");
  assert.deepEqual(cursor?.subheadings, []);

  const legacy = {
    version: DEVICE_LOCAL_STATE_VERSION,
    historyIndexFolderSourcesIncluded: true,
    vaultId: "vault-nested-collapse",
    activeBaseId: "base-default",
    bases: [{
      baseId: "base-default",
      view: {
        selectedPath: "",
        activeTab: "curriculum",
        collapsed: { curriculumDomains: [], curriculumNodes: [], queues: [] },
        collections: [{ id: "heading", collapsed: true, subheadings: [{ id: "leaf", collapsed: false }] }],
        libraryLayouts: [],
        undoStack: [],
        redoStack: [],
      },
    }],
  };
  const legacyParsed = parseDeviceLocalPluginState(structuredClone(legacy));
  assert.equal(legacyParsed.bases[0]?.view.collections[0]?.collapsed, true);
  assert.equal(legacyParsed.bases[0]?.view.collections[0]?.subheadings[0]?.id, "leaf");
  assert.deepEqual(legacyParsed.bases[0]?.view.collections[0]?.subheadings[0]?.subheadings, [], "flat leaves normalize to the nested shape");

  let deepNode: Record<string, unknown> = { id: "collapse-8", collapsed: true };
  for (let level = 7; level >= 1; level -= 1) deepNode = { id: `collapse-${level}`, collapsed: true, subheadings: [deepNode] };
  const tooDeep = structuredClone(legacy) as unknown as { bases: Array<{ view: { collections: unknown } }> };
  tooDeep.bases[0].view.collections = [deepNode];
  const cappedParsed = parseDeviceLocalPluginState(tooDeep);
  let capped = cappedParsed.bases[0]?.view.collections[0];
  for (let depth = 2; depth <= MAX_LAYOUT_DEPTH; depth += 1) capped = capped?.subheadings[0];
  assert.equal(capped?.id, `collapse-${MAX_LAYOUT_DEPTH}`);
  assert.deepEqual(capped?.subheadings, [], "collapse state beyond the depth cap is dropped, never fatal");
});

test("a valid v14 base with more than 300 layout headings remains loadable", () => {
  const data = migrateData(null) as PluginData & { version: number };
  data.version = 14;
  data.collections = Array.from({ length: MAX_INDEX_FOLDER_SOURCES + 1 }, (_, index) => ({
    id: `historical-heading-${index}`,
    title: `Historical heading ${index}`,
    collapsed: false,
    subjects: [],
    subheadings: [],
  }));
  const raw = createDefaultStore(data, 100, "vault-v14-301-headings") as PluginStore & { version: number };
  raw.version = 14;

  const migrated = migrateStore(raw, 200);

  assert.equal(migrated.bases[0]?.data.collections.length, MAX_INDEX_FOLDER_SOURCES + 1);
});

test("a realistic previous-build store migrates to the nested schema with conservative causality", () => {
  const data = migrateData(null);
  data.collections = [{
    id: "airway",
    title: "Airway",
    collapsed: false,
    subjects: ["Knowledge/Airway.md"],
    subheadings: [{ id: "pediatric", title: "Pediatric", collapsed: true, subjects: ["Knowledge/Cleft.md"] }],
  }];
  const modern = createDefaultStore(data, 100, "vault-prev-build");
  const raw = structuredClone(modern) as unknown as { version: number; bases: Array<Record<string, unknown>> };
  raw.version = STORE_VERSION - 1;
  const rawBase = raw.bases[0];
  (rawBase.data as { version: number }).version = DATA_VERSION - 1;
  rawBase.semanticRevision = 3;
  rawBase.semanticHash = semanticEntryFingerprint({
    createdAt: 100,
    archivedAt: null,
    data: rawBase.data,
  } as Parameters<typeof semanticEntryFingerprint>[0]);
  rawBase.semanticHead = rawBase.semanticHash;
  rawBase.semanticLineage = ["2222222222222222"];

  const migrated = migrateStore(structuredClone(raw), 200);
  assert.equal(migrated.version, STORE_VERSION);
  const entry = migrated.bases[0];
  assert.equal(entry.data.version, DATA_VERSION);
  assert.equal(entry.semanticRevision, 3, "the per-base revision survives schema migration");
  assert.equal(entry.semanticHead, entry.semanticHash, "a payload-changing migration re-roots causality conservatively");
  assert.deepEqual(entry.semanticLineage, []);
  assert.deepEqual(entry.data.indexFolderSources, [createLegacyPrimaryFolderSource("Knowledge Base")]);
  assert.equal(entry.data.collections[0]?.subheadings[0]?.id, "pediatric");
  assert.equal("subheadings" in (entry.data.collections[0]?.subheadings[0] ?? {}), false, "flat v13 payloads stay byte-flat");
  const other = migrateStore(structuredClone(raw), 999);
  assert.equal(other.bases[0]?.semanticHead, entry.semanticHead, "independently migrated devices derive the same root");

  const nestedRaw = structuredClone(raw);
  (nestedRaw.bases[0].data as { collections: unknown }).collections = [nestedLayoutChain(6, (level) => ({ subjects: [`Knowledge/Level ${level}.md`] }))];
  const nestedEntry = migrateStore(nestedRaw, 200).bases[0];
  assert.equal(subheadingAt(nestedEntry.data.collections[0], MAX_LAYOUT_DEPTH).id, `chain-${MAX_LAYOUT_DEPTH}`);
  assert.deepEqual(
    subheadingAt(nestedEntry.data.collections[0], MAX_LAYOUT_DEPTH).subjects,
    [`Knowledge/Level ${MAX_LAYOUT_DEPTH}.md`, "Knowledge/Level 6.md"],
    "hand-authored nesting in an older payload becomes first-class with merge-up",
  );

  const future = structuredClone(raw);
  (future.bases[0].data as { version: number }).version = DATA_VERSION + 1;
  assert.throws(() => migrateStore(future, 200), new RegExp(`unsupported data version ${DATA_VERSION + 1}`, "i"));
});

test("transfer budgets count nested subheadings at every depth", () => {
  const backup = createPersonalBackup(migrateData(null), "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  const width = 100;
  const childrenPerNode = Math.ceil(MAX_TRANSFER_COLLECTIONS / width) + 1;
  (backup as { collections: unknown }).collections = [{
    id: "wide",
    title: "Wide",
    collapsed: false,
    subjects: [],
    subheadings: Array.from({ length: width }, (_, index) => ({
      id: `mid-${index}`,
      title: `Mid ${index}`,
      collapsed: false,
      subjects: [],
      subheadings: Array.from({ length: childrenPerNode }, (__, childIndex) => ({
        id: `leaf-${index}-${childIndex}`,
        title: `Leaf ${index}-${childIndex}`,
        collapsed: false,
        subjects: [],
      })),
    })),
  }];
  assert.throws(() => parsePersonalBackup(backup), /too many collections and subheadings/i);
});

test("personal backups carry membership at v11 while flat v9 backups import unchanged", () => {
  const data = migrateData({
    version: DATA_VERSION,
    directIndexPaths: [],
    indexFolderSources: [],
    collections: [nestedLayoutChain(6, (level) => ({ subjects: [`Knowledge/Level ${level}.md`] }))],
  });
  const backup = createPersonalBackup(data, "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT");
  assert.equal(backup.version, 11);
  const parsed = parsePersonalBackup(JSON.parse(JSON.stringify(backup)) as unknown);
  assert.equal(parsed.version, 11);
  assert.deepEqual(parsed.collections, data.collections, "nested organization survives an exact round-trip");
  assert.deepEqual(
    subheadingAt(parsed.collections[0], MAX_LAYOUT_DEPTH).subjects,
    [`Knowledge/Level ${MAX_LAYOUT_DEPTH}.md`, "Knowledge/Level 6.md"],
  );

  const flatData = migrateData(null);
  flatData.collections = [{
    id: "airway",
    title: "Airway",
    collapsed: false,
    subjects: ["Knowledge/Airway.md"],
    subheadings: [{ id: "sub", title: "Sub", collapsed: false, subjects: [] }],
  }];
  const legacy = structuredClone(createPersonalBackup(flatData, "2026-08-08T00:00:00.000Z", "vault-ent-main", "base-ent", "ENT")) as unknown as Record<string, unknown>;
  legacy.version = 9;
  delete legacy.indexFolderSourcesIncluded;
  delete legacy.directIndexPaths;
  delete legacy.indexFolderSources;
  const legacyParsed = parsePersonalBackup(legacy);
  assert.equal(legacyParsed.version, 11, "flat v9 backups upgrade in place");
  assert.equal(legacyParsed.indexFolderSourcesIncluded, false);
  assert.equal(legacyParsed.collections[0]?.subheadings[0]?.id, "sub");
});

test("library layout cleaning threads catalog dedupe through every depth and merges too-deep placements", () => {
  const state = cleanPortableIndex({
    version: 2,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: ["med-top", "med-mid", "med-leaf", "med-deep"].map((id, order) => ({
      id,
      title: id,
      groupId: "group",
      parentId: null,
      order,
      indexed: false,
      configuredId: "",
      recordKind: "medication",
    })),
    resolvedPathBySubjectId: {},
    libraryLayouts: {
      medication: [{
        id: "m-top",
        title: "Top",
        collapsed: false,
        subjects: ["med-top"],
        subheadings: [{
          id: "m-2",
          title: "L2",
          collapsed: false,
          subjects: ["med-mid"],
          subheadings: [{
            title: "L3 without ID",
            collapsed: false,
            subjects: [],
            subheadings: [{
              id: "m-4",
              title: "L4",
              collapsed: false,
              subjects: [],
              subheadings: [{
                id: "m-5",
                title: "L5",
                collapsed: false,
                subjects: ["med-leaf"],
                subheadings: [{ id: "m-6", title: "L6", collapsed: true, subjects: ["med-deep", "med-mid", "unknown-subject"] }],
              }],
            }],
          }],
        }],
      }],
    },
  });
  const heading = state.libraryLayouts.medication[0];
  assert.equal(subheadingAt(heading, 3).id, "m-2-subheading-1", "fallback IDs chain from the parent identity at depth");
  const level5 = subheadingAt(heading, MAX_LAYOUT_DEPTH);
  assert.deepEqual(level5.subjects, ["med-leaf", "med-deep"], "too-deep placements merge subject to the catalog and global dedupe");
  assert.equal("subheadings" in level5, false);
  const rePlaced = collectLayoutIds(state.libraryLayouts.medication);
  assert.equal(new Set(rePlaced).size, rePlaced.length);
  assert.deepEqual(cleanPortableIndex(state).libraryLayouts, state.libraryLayouts, "library cleaning is idempotent on nested layouts");
});

test("diagnostics and path rewrites reach nested subheading subjects", () => {
  const data = migrateData({
    version: DATA_VERSION,
    directIndexPaths: [],
    indexFolderSources: [],
    collections: [{
      id: "top",
      title: "Top",
      collapsed: false,
      subjects: [],
      subheadings: [{
        id: "mid",
        title: "Mid",
        collapsed: false,
        subjects: [],
        subheadings: [{ id: "leaf", title: "Leaf", collapsed: false, subjects: ["Old/Note.md", "Old/Note.md"] }],
      }],
    }],
  });
  const diagnostics = buildIndexDiagnostics(data, [], new Set());
  const duplicate = diagnostics.find((diagnostic) => diagnostic.kind === "duplicate-membership");
  assert.ok(duplicate);
  assert.match(duplicate.detail, /Top \/ Mid \/ Leaf/u, "nested owners are named through the full title path");
  assert.equal(diagnostics.some((diagnostic) => diagnostic.kind === "missing-note" && diagnostic.path === "Old/Note.md"), true);

  data.undoStack = [snapshotPersonal(data, "Before rename")];
  assert.equal(rewritePluginDataPathPrefix(data, "Old/Note.md", "New/Note.md"), true);
  assert.deepEqual(subheadingAt(data.collections[0], 3).subjects, ["New/Note.md", "New/Note.md"]);
  assert.deepEqual(subheadingAt(data.undoStack[0].collections[0], 3).subjects, ["New/Note.md", "New/Note.md"], "historical snapshots rewrite nested subjects too");
});

function portableNoteSubjects(ids: string[], groupId: string): Array<Record<string, unknown>> {
  return ids.map((id, order) => ({
    id,
    title: `Title ${id}`,
    groupId,
    parentId: null,
    order,
    indexed: false,
    configuredId: "",
    recordKind: "note",
    libraryId: null,
  }));
}

test("portable v5 collections round-trip five nested levels byte-stably in replace and merge modes", () => {
  const chain = nestedLayoutChain(MAX_LAYOUT_DEPTH, (level) => ({
    subjects: [portablePlaceholderPath(`subject-${level}`)],
    collapsed: level === 3,
  }));
  const source = migrateData({ version: DATA_VERSION, directIndexPaths: [], indexFolderSources: [], collections: [chain] });
  source.portableIndex.groups = [{ id: "group-deep", title: "Deep", order: 0 }];
  source.portableIndex.subjects = portableNoteSubjects(
    [1, 2, 3, 4, 5].map((level) => `subject-${level}`),
    "group-deep",
  ) as never;

  const exported = createPortableExport(
    source,
    [],
    portableSelection({ collections: true }),
    "2026-08-12T00:00:00.000Z",
  );
  assert.equal(exported.version, 5);
  const collection = exported.components.collections?.collections[0];
  assert.ok(collection);
  assert.equal(collection.id, "chain-1");
  assert.deepEqual(collection.subjectIds, ["subject-1"]);
  const nodes: PortableCollectionSubheadingV1[] = [];
  let cursor: PortableCollectionSubheadingV1 | undefined = collection.subheadings[0];
  while (cursor) {
    nodes.push(cursor);
    cursor = cursor.subheadings?.[0];
  }
  assert.equal(nodes.length, MAX_LAYOUT_DEPTH - 1, "every nested level is exported");
  nodes.forEach((node, index) => {
    assert.equal(node.id, `chain-${index + 2}`);
    assert.deepEqual(node.subjectIds, [`subject-${index + 2}`]);
  });
  const leaf = nodes[nodes.length - 1];
  assert.ok(leaf);
  assert.equal("subheadings" in leaf, false, "the exported leaf keeps the flat byte shape");

  const serialized = serializePortableExport(exported);
  const parsed = parsePortableExport(JSON.parse(serialized) as unknown);
  assert.equal(
    JSON.stringify(parsed.components.collections),
    JSON.stringify(exported.components.collections),
    "parsing re-serializes the nested component byte-identically",
  );

  for (const mode of ["replace", "merge"] as const) {
    const target = migrateData(null);
    applyPortableExport(target, parsed, portableSelection({ collections: true }), mode);
    assert.deepEqual(target.collections, source.collections, `${mode} rebuilds the exact five-level layout`);
    assert.deepEqual(
      migrateData(structuredClone(target)).collections,
      source.collections,
      `the ${mode} result survives an ordinary reload unchanged`,
    );
    applyPortableExport(target, parsed, portableSelection({ collections: true }), "merge");
    assert.deepEqual(target.collections, source.collections, `a repeated merge after ${mode} changes nothing`);
  }
});

test("portable v5 library layouts round-trip five nested levels by stable subject ID", () => {
  const source = migrateData(null);
  source.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  source.portableIndex.subjects = [1, 2, 3, 4, 5].map((level) => ({
    id: `medication-${level}`,
    title: `Medication ${level}`,
    groupId: "medications",
    parentId: null,
    order: level - 1,
    indexed: false,
    configuredId: "",
    recordKind: "medication" as const,
  }));
  source.portableIndex.libraryLayouts.medication = [
    nestedLayoutChain(MAX_LAYOUT_DEPTH, (level) => ({ subjects: [`medication-${level}`] })) as unknown as LayoutHeading,
  ];

  const exported = parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ medications: true }),
    "2026-08-12T00:00:00.000Z",
  ));
  assert.deepEqual(
    exported.components.index?.libraryLayouts?.medication,
    source.portableIndex.libraryLayouts.medication,
    "the exported layout preserves the exact nested structure",
  );
  const exportedHeading = exported.components.index?.libraryLayouts?.medication[0];
  assert.ok(exportedHeading);
  const exportedLeaf = subheadingAt(exportedHeading, MAX_LAYOUT_DEPTH);
  assert.equal("subheadings" in exportedLeaf, false, "the exported layout leaf keeps the flat byte shape");

  const target = migrateData(null);
  applyPortableExport(target, exported, portableSelection({ medications: true }), "replace");
  assert.deepEqual(
    target.portableIndex.libraryLayouts.medication,
    source.portableIndex.libraryLayouts.medication,
    "replace rebuilds the nested library layout",
  );
  applyPortableExport(target, exported, portableSelection({ medications: true }), "merge");
  assert.deepEqual(
    target.portableIndex.libraryLayouts.medication,
    source.portableIndex.libraryLayouts.medication,
    "merging the same nested package again changes nothing",
  );
  assert.deepEqual(
    migrateData(structuredClone(target)).portableIndex.libraryLayouts.medication,
    source.portableIndex.libraryLayouts.medication,
    "the imported nested layout survives an ordinary reload",
  );
});

test("collection merges cross flat and nested layouts deterministically and idempotently", () => {
  const packageFor = (collections: LayoutHeading[], subjectIds: string[]): PortableExportV1 => {
    const packageSource = migrateData(null);
    packageSource.portableIndex.groups = [{ id: "group-x", title: "X", order: 0 }];
    packageSource.portableIndex.subjects = portableNoteSubjects(subjectIds, "group-x") as never;
    packageSource.collections = cloneCollections(collections);
    return parsePortableExport(createPortableExport(
      packageSource,
      [],
      portableSelection({ collections: true }),
      "2026-08-12T00:00:00.000Z",
    ));
  };
  const nested = packageFor([{
    id: "reading",
    title: "Reading",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: "cases",
      title: "Cases",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "airway", title: "Airway", collapsed: false, subjects: [portablePlaceholderPath("subject-deep")] }],
    }],
  }], ["subject-deep"]);
  const flat = packageFor([{
    id: "reading",
    title: "Reading",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "cases", title: "Cases", collapsed: false, subjects: [portablePlaceholderPath("subject-flat")] }],
  }], ["subject-flat"]);

  const flatDestination = (): ReturnType<typeof migrateData> => {
    const target = migrateData(null);
    target.collections = [{
      id: "reading",
      title: "Reading",
      collapsed: true,
      subjects: ["Knowledge/Local.md"],
      subheadings: [{ id: "cases", title: "Cases", collapsed: true, subjects: ["Knowledge/Case.md"] }],
    }];
    return target;
  };
  const first = flatDestination();
  applyPortableExport(first, nested, portableSelection({ collections: true }), "merge");
  const second = flatDestination();
  applyPortableExport(second, nested, portableSelection({ collections: true }), "merge");
  assert.deepEqual(second.collections, first.collections, "the nested-into-flat merge is deterministic");
  assert.deepEqual(first.collections, [{
    id: "reading",
    title: "Reading",
    collapsed: true,
    subjects: ["Knowledge/Local.md"],
    subheadings: [{
      id: "cases",
      title: "Cases",
      collapsed: true,
      subjects: ["Knowledge/Case.md"],
      subheadings: [{ id: "airway", title: "Airway", collapsed: false, subjects: [portablePlaceholderPath("subject-deep")] }],
    }],
  }], "nested incoming levels graft under the matched flat destination nodes");
  const afterNestedMerge = cloneCollections(first.collections);
  applyPortableExport(first, nested, portableSelection({ collections: true }), "merge");
  assert.deepEqual(first.collections, afterNestedMerge, "importing the same nested package twice changes nothing");

  const nestedDestination = (): ReturnType<typeof migrateData> => {
    const target = migrateData(null);
    target.collections = [{
      id: "reading",
      title: "Reading",
      collapsed: false,
      subjects: [],
      subheadings: [{
        id: "cases",
        title: "Cases",
        collapsed: false,
        subjects: ["Knowledge/Case.md"],
        subheadings: [{ id: "airway", title: "Airway", collapsed: true, subjects: ["Knowledge/Airway.md"] }],
      }],
    }];
    return target;
  };
  const third = nestedDestination();
  applyPortableExport(third, flat, portableSelection({ collections: true }), "merge");
  const fourth = nestedDestination();
  applyPortableExport(fourth, flat, portableSelection({ collections: true }), "merge");
  assert.deepEqual(fourth.collections, third.collections, "the flat-into-nested merge is deterministic");
  assert.deepEqual(third.collections, [{
    id: "reading",
    title: "Reading",
    collapsed: false,
    subjects: [],
    subheadings: [{
      id: "cases",
      title: "Cases",
      collapsed: false,
      subjects: ["Knowledge/Case.md", portablePlaceholderPath("subject-flat")],
      subheadings: [{ id: "airway", title: "Airway", collapsed: true, subjects: ["Knowledge/Airway.md"] }],
    }],
  }], "a flat package lands in the nested destination without disturbing deeper levels");
  const afterFlatMerge = cloneCollections(third.collections);
  applyPortableExport(third, flat, portableSelection({ collections: true }), "merge");
  assert.deepEqual(third.collections, afterFlatMerge, "importing the same flat package twice changes nothing");
});

test("depth-six portable package content merges into the nearest allowed ancestor without loss", () => {
  const chain = nestedLayoutChain(MAX_LAYOUT_DEPTH, (level) => ({
    subjects: [portablePlaceholderPath(`subject-${level}`)],
  }));
  const source = migrateData({ version: DATA_VERSION, directIndexPaths: [], indexFolderSources: [], collections: [chain] });
  source.portableIndex.groups = [{ id: "group-deep", title: "Deep", order: 0 }];
  source.portableIndex.subjects = portableNoteSubjects(
    [1, 2, 3, 4, 5].map((level) => `subject-${level}`),
    "group-deep",
  ) as never;
  const exported = createPortableExport(
    source,
    [],
    portableSelection({ collections: true }),
    "2026-08-12T00:00:00.000Z",
  );

  const raw = structuredClone(exported) as unknown as {
    components: {
      index: { subjects: Array<Record<string, unknown>> };
      collections: { collections: Array<{ subheadings: PortableCollectionSubheadingV1[] }> };
    };
  };
  raw.components.index.subjects.push({
    id: "subject-6",
    title: "Title subject-6",
    groupId: "group-deep",
    parentId: null,
    order: 5,
    indexed: false,
    configuredId: "",
    recordKind: "note",
    libraryId: null,
  });
  let rawLeaf = raw.components.collections.collections[0].subheadings[0];
  while (rawLeaf.subheadings?.[0]) rawLeaf = rawLeaf.subheadings[0];
  rawLeaf.subheadings = [{
    id: "chain-6",
    title: "Chain level 6",
    collapsed: false,
    subjectIds: ["subject-6", "subject-5"],
  }];

  const parsed = parsePortableExport(structuredClone(raw));
  const parsedCollection = parsed.components.collections?.collections[0];
  assert.ok(parsedCollection);
  let parsedLeaf = parsedCollection.subheadings[0];
  assert.ok(parsedLeaf);
  while (parsedLeaf.subheadings?.[0]) parsedLeaf = parsedLeaf.subheadings[0];
  assert.equal(parsedLeaf.id, `chain-${MAX_LAYOUT_DEPTH}`);
  assert.deepEqual(
    parsedLeaf.subjectIds,
    [`subject-${MAX_LAYOUT_DEPTH}`, "subject-6"],
    "too-deep subjects merge deduped, in document order, into the depth-five ancestor",
  );
  assert.equal("subheadings" in parsedLeaf, false, "the depth-six node itself never materializes");

  const duplicate = structuredClone(raw);
  let duplicateDeepestParent = duplicate.components.collections.collections[0].subheadings[0];
  while (duplicateDeepestParent.subheadings?.[0]?.subheadings?.[0]) {
    duplicateDeepestParent = duplicateDeepestParent.subheadings[0];
  }
  const injectedTooDeepNode = duplicateDeepestParent.subheadings?.[0];
  assert.ok(injectedTooDeepNode);
  assert.equal(injectedTooDeepNode.id, "chain-6");
  injectedTooDeepNode.id = "chain-1";
  assert.throws(
    () => parsePortableExport(duplicate),
    /duplicate collection or subheading ID: chain-1/i,
    "identity checks span every depth, including merged-up nodes",
  );

  const hostile = structuredClone(raw);
  let hostileLeaf = hostile.components.collections.collections[0].subheadings[0];
  while (hostileLeaf.subheadings?.[0]) hostileLeaf = hostileLeaf.subheadings[0];
  for (let level = 0; level < 70; level += 1) {
    const child: PortableCollectionSubheadingV1 = {
      id: `hostile-${level}`,
      title: `Hostile ${level}`,
      collapsed: false,
      subjectIds: [],
    };
    hostileLeaf.subheadings = [child];
    hostileLeaf = child;
  }
  assert.throws(
    () => parsePortableExport(hostile),
    /exceed 64 levels/i,
    "hostile nesting depth refuses cleanly instead of exhausting the stack",
  );
});

test("nested structures charge the portable collection and library-layout budgets", () => {
  const width = 100;
  const wideCollections = portableFixture();
  wideCollections.components.collections = {
    version: 1,
    collections: [{
      id: "budget-collection",
      title: "Budget",
      collapsed: false,
      subjectIds: [],
      subheadings: Array.from({ length: width }, (_, outer) => ({
        id: `level2-${outer}`,
        title: `Level two ${outer}`,
        collapsed: false,
        subjectIds: [],
        subheadings: Array.from({ length: width }, (_, inner) => ({
          id: `level3-${outer}-${inner}`,
          title: "Leaf",
          collapsed: false,
          subjectIds: [],
        })),
      })),
    }],
  };
  assert.ok(width + width * width > MAX_TRANSFER_COLLECTIONS);
  assert.throws(() => parsePortableExport(wideCollections), /too many subheadings/i);

  const librarySource = migrateData(null);
  const libraryExport = createPortableExport(
    librarySource,
    [],
    portableSelection({ medications: true }),
    "2026-08-12T00:00:00.000Z",
  );
  const wideLibrary = structuredClone(libraryExport) as unknown as {
    components: { index: { libraryLayouts: Record<string, unknown> } };
  };
  wideLibrary.components.index.libraryLayouts.medication = [{
    id: "budget-heading",
    title: "Budget",
    collapsed: false,
    subjects: [],
    subheadings: Array.from({ length: width + 1 }, (_, outer) => ({
      id: `level2-${outer}`,
      title: `Level two ${outer}`,
      collapsed: false,
      subjects: [],
      subheadings: Array.from({ length: width }, (_, inner) => ({
        id: `level3-${outer}-${inner}`,
        title: "Leaf",
        collapsed: false,
        subjects: [],
      })),
    })),
  }];
  assert.throws(() => parsePortableExport(wideLibrary), /too many headings and subheadings/i);
});

test("portable v4 flat packages import unchanged while unknown versions refuse cleanly", () => {
  const source = migrateData(null);
  source.portableIndex.groups = [{ id: "group-flat", title: "Flat", order: 0 }];
  source.portableIndex.subjects = portableNoteSubjects(["subject-flat"], "group-flat") as never;
  source.collections = [{
    id: "reading",
    title: "Reading",
    collapsed: false,
    subjects: [portablePlaceholderPath("subject-flat")],
    subheadings: [{ id: "cases", title: "Cases", collapsed: false, subjects: [] }],
  }];
  const v5 = createPortableExport(
    source,
    [],
    portableSelection({ collections: true }),
    "2026-08-12T00:00:00.000Z",
  );
  assert.equal(v5.version, 5);

  const downgraded = structuredClone(v5) as unknown as {
    version: number;
    components: { index: { version: number } };
  };
  downgraded.version = 4;
  downgraded.components.index.version = 4;
  const parsed = parsePortableExport(structuredClone(downgraded));
  assert.equal(parsed.version, 4);
  const target = migrateData(null);
  applyPortableExport(target, parsed, portableSelection({ collections: true }), "replace");
  assert.deepEqual(target.collections, source.collections, "a flat version-4 package imports byte-identically");

  // The same envelope gate makes builds that predate a version refuse it with
  // one clear message instead of silently flattening unknown organization.
  const future = structuredClone(v5) as unknown as { version: number };
  future.version = 6;
  assert.throws(() => parsePortableExport(future), /Unsupported Command Center portable export\./);
});

test("beyond-depth collection merges stay linear across wide fans of empty deep siblings", () => {
  const packageFor = (subjectIds: string[], leafSubjectIds: string[], deepSiblings: unknown[]): unknown => ({
    kind: PORTABLE_EXPORT_KIND,
    version: 5,
    exportedAt: "2026-08-12T00:00:00.000Z",
    sourceWorkspace: "Source KB",
    components: {
      index: {
        version: 5,
        groups: [{ id: "group-deep", title: "Deep", order: 0 }],
        subjects: portableNoteSubjects(subjectIds, "group-deep"),
        libraries: [],
        libraryLayouts: {},
        includedSections: { index: false, libraryIds: [] },
        includeIndex: false,
        indexGroupIds: [],
      },
      collections: {
        version: 1,
        collections: [{
          id: "deep-collection",
          title: "Deep collection",
          collapsed: false,
          subjectIds: [],
          subheadings: [{
            id: "level-2",
            title: "Level two",
            collapsed: false,
            subjectIds: [],
            subheadings: [{
              id: "level-3",
              title: "Level three",
              collapsed: false,
              subjectIds: [],
              subheadings: [{
                id: "level-4",
                title: "Level four",
                collapsed: false,
                subjectIds: [],
                subheadings: [{
                  id: `level-${MAX_LAYOUT_DEPTH}`,
                  title: "Level five",
                  collapsed: false,
                  subjectIds: leafSubjectIds,
                  subheadings: deepSiblings,
                }],
              }],
            }],
          }],
        }],
      },
    },
  });
  const emptySibling = (index: number): Record<string, unknown> => ({
    id: `empty-${index}`,
    title: `Empty ${index}`,
    collapsed: false,
    subjectIds: [],
    subheadings: [],
  });
  const leafOf = (parsed: PortableExportV1): PortableCollectionSubheadingV1 => {
    let leaf = parsed.components.collections?.collections[0]?.subheadings[0];
    assert.ok(leaf);
    while (leaf.subheadings?.[0]) leaf = leaf.subheadings[0];
    return leaf;
  };

  // Correctness: empty siblings contribute nothing, and carriers merge
  // deduped, in document order, including through nested too-deep levels.
  const parsed = parsePortableExport(packageFor(
    ["s-a", "s-b", "s-c", "s-d", "s-e"],
    ["s-a", "s-b"],
    [
      ...Array.from({ length: 60 }, (_, index) => emptySibling(index)),
      { id: "carry-1", title: "Carry one", collapsed: false, subjectIds: ["s-b", "s-c"] },
      {
        id: "carry-2",
        title: "Carry two",
        collapsed: false,
        subjectIds: [],
        subheadings: [{ id: "carry-2-child", title: "Deeper", collapsed: false, subjectIds: ["s-d"], subheadings: [] }],
      },
      { id: "carry-3", title: "Carry three", collapsed: false, subjectIds: ["s-c", "s-e"] },
    ],
  ));
  const leaf = leafOf(parsed);
  assert.equal(leaf.id, `level-${MAX_LAYOUT_DEPTH}`);
  assert.deepEqual(
    leaf.subjectIds,
    ["s-a", "s-b", "s-c", "s-d", "s-e"],
    "wide empty fans do not disturb the deduplicated document-order merge",
  );
  assert.equal("subheadings" in leaf, false, "too-deep siblings never materialize");

  // Budget accounting is unchanged: too-deep siblings still charge the
  // shared structure budget even though they merge upward.
  const tooMany = packageFor(
    ["s-a", "s-b"],
    ["s-a", "s-b"],
    Array.from({ length: MAX_TRANSFER_COLLECTIONS - 3 }, (_, index) => emptySibling(index)),
  );
  assert.throws(() => parsePortableExport(tooMany), /too many subheadings/i);

  // Coarse linearity guard: thousands of empty deep siblings under a large
  // merge target must not each rebuild the deduplication set.
  const wideSubjectIds = Array.from({ length: 20_000 }, (_, index) => `subject-${index}`);
  const wide = packageFor(
    wideSubjectIds,
    wideSubjectIds,
    Array.from({ length: 6_000 }, (_, index) => emptySibling(index)),
  );
  const start = performance.now();
  const wideParsed = parsePortableExport(wide);
  const elapsed = performance.now() - start;
  const wideLeaf = leafOf(wideParsed);
  assert.equal(wideLeaf.subjectIds.length, wideSubjectIds.length, "every referenced subject survives the wide merge");
  assert.ok(elapsed < 2_000, `merging 6,000 empty deep siblings should stay linear; took ${elapsed.toFixed(1)} ms`);
});

function customLibraryPackage(headings: LayoutHeading[], subjectIds: string[]): PortableExportV1 {
  const source = migrateData(null);
  source.portableIndex.groups.push({ id: "group-custom-library", title: "Custom library", order: 99 });
  source.portableIndex.subjects.push(...subjectIds.map((id, order) => ({
    id,
    title: `Title ${id}`,
    groupId: "group-custom-library",
    parentId: null,
    order,
    indexed: false,
    configuredId: "",
    recordKind: "note" as const,
    libraryId: "library-custom",
  })));
  source.portableIndex.libraries.push({
    id: "library-custom",
    name: "Custom",
    singularName: "Item",
    icon: "library",
    order: 99,
    sourceKind: null,
    archivedAt: null,
  });
  source.portableIndex.libraryLayouts["library-custom"] = cloneCollections(headings);
  return parsePortableExport(createPortableExport(
    source,
    [],
    portableSelection({ libraryIds: ["library-custom"] }),
    "2026-08-12T00:00:00.000Z",
  ));
}

test("library layout merges reserve exact stable-ID matches before weak title matching", () => {
  const pkg1 = customLibraryPackage([{
    id: "heading-repeat",
    title: "Repeated",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "child-stable", title: "T", collapsed: false, subjects: ["s-one"] }],
  }], ["s-one"]);
  const pkg2 = customLibraryPackage([
    { id: "heading-new", title: "Repeated", collapsed: false, subjects: [], subheadings: [] },
    {
      id: "heading-repeat",
      title: "Repeated",
      collapsed: false,
      subjects: [],
      subheadings: [
        { id: "child-new", title: "T", collapsed: false, subjects: ["s-two"] },
        { id: "child-stable", title: "T", collapsed: false, subjects: ["s-one"] },
      ],
    },
  ], ["s-one", "s-two"]);

  const target = migrateData(null);
  applyPortableExport(target, pkg1, portableSelection({ libraryIds: ["library-custom"] }), "merge");
  applyPortableExport(target, pkg2, portableSelection({ libraryIds: ["library-custom"] }), "merge");
  const afterFirst = structuredClone(target.portableIndex.libraryLayouts["library-custom"] ?? []);

  assert.equal(afterFirst.length, 2, "same-title headings stay distinct without duplicate or husk nodes");
  const stableHeading = afterFirst.find((heading) => heading.id === "heading-repeat");
  assert.ok(afterFirst.find((heading) => heading.id === "heading-new"), "the new same-title heading keeps its own stable ID");
  assert.ok(stableHeading, "an earlier same-title heading cannot consume a later exact ID match");
  assert.equal(stableHeading.subheadings.length, 2, "same-title children stay distinct without duplicate or husk nodes");
  assert.deepEqual(
    stableHeading.subheadings.find((child) => child.id === "child-stable")?.subjects,
    ["s-one"],
    "the stable-ID sibling keeps its destination node",
  );
  assert.deepEqual(
    stableHeading.subheadings.find((child) => child.id === "child-new")?.subjects,
    ["s-two"],
    "the new same-title sibling lands in its own node",
  );

  applyPortableExport(target, pkg2, portableSelection({ libraryIds: ["library-custom"] }), "merge");
  assert.deepEqual(
    target.portableIndex.libraryLayouts["library-custom"],
    afterFirst,
    "reimporting the identical package changes nothing",
  );
});

test("a library node moved between parents remints one deterministic identity on every device", () => {
  const pkg1 = customLibraryPackage([
    {
      id: "heading-a",
      title: "Heading A",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "child-moved", title: "Moved", collapsed: false, subjects: ["s-move"] }],
    },
    { id: "heading-b", title: "Heading B", collapsed: false, subjects: [], subheadings: [] },
  ], ["s-move"]);
  const pkg2 = customLibraryPackage([
    { id: "heading-a", title: "Heading A", collapsed: false, subjects: [], subheadings: [] },
    {
      id: "heading-b",
      title: "Heading B",
      collapsed: false,
      subjects: [],
      subheadings: [{ id: "child-moved", title: "Moved", collapsed: false, subjects: ["s-move"] }],
    },
  ], ["s-move"]);
  const importBoth = (): ReturnType<typeof migrateData> => {
    const device = migrateData(null);
    applyPortableExport(device, pkg1, portableSelection({ libraryIds: ["library-custom"] }), "merge");
    applyPortableExport(device, pkg2, portableSelection({ libraryIds: ["library-custom"] }), "merge");
    return device;
  };

  const deviceOne = importBoth();
  const deviceTwo = importBoth();
  assert.deepEqual(
    deviceTwo.portableIndex.libraryLayouts["library-custom"],
    deviceOne.portableIndex.libraryLayouts["library-custom"],
    "identical imports allocate identical layout identities, IDs included",
  );

  const layout = deviceOne.portableIndex.libraryLayouts["library-custom"] ?? [];
  const moved = layout.find((heading) => heading.id === "heading-b")?.subheadings[0];
  assert.ok(moved, "the moved node lands under its new parent");
  assert.match(moved.id, /^library-import-[0-9a-f]{16}$/, "a colliding node ID remints as a deterministic library fork");
  assert.deepEqual(moved.subjects, ["s-move"], "the moved subject follows the incoming placement");
});

test("canonical JSON keeps an own __proto__ key so every module canonicalizes one store the same way", () => {
  // JSON.parse is the only way a persisted store can carry this key, and it
  // makes it an own property. A canonicalizer that accumulates into a plain
  // object routes the assignment through Object.prototype's __proto__ setter,
  // which creates no own property and silently drops the key.
  const parsed: unknown = JSON.parse('{"__proto__":{"group":"Research"},"beta":2}');
  assert.equal(canonicalJsonString(parsed), '{"__proto__":{"group":"Research"},"beta":2}');

  const other: unknown = JSON.parse('{"__proto__":{"group":"Teaching"},"beta":2}');
  assert.notEqual(canonicalJsonString(parsed), canonicalJsonString(other));

  // Sorting, undefined-stripping, and array hole normalization are unchanged.
  assert.equal(canonicalJsonString({ b: 1, a: undefined, c: [undefined, 2] }), '{"b":1,"c":[null,2]}');

  // The store-level consumers must inherit exactly this behaviour.
  const withProto = migrateData(null);
  withProto.indexGroupByPath = JSON.parse('{"__proto__":"Research"}') as Record<string, string>;
  const withOtherProto = migrateData(null);
  withOtherProto.indexGroupByPath = JSON.parse('{"__proto__":"Teaching"}') as Record<string, string>;
  assert.notEqual(
    semanticEntryFingerprint({ createdAt: 1, archivedAt: null, data: withProto }),
    semanticEntryFingerprint({ createdAt: 1, archivedAt: null, data: withOtherProto }),
    "a base identified only by a __proto__ key is not confused with a different one",
  );
});

test("the shared double-FNV-1a fingerprint stays byte-identical to the IDs already in users' vaults", () => {
  // These outputs are baked into imported collection and library IDs, portfolio
  // destination base IDs, plan-guard tokens, and recovered legacy IDs that are
  // already persisted. Changing the mixing or the seeds is a data-loss bug, not
  // an improvement, so the expected values are frozen literals.
  assert.equal(fingerprintText(""), "811c9dc59e3779b9");
  assert.equal(fingerprintText("a"), "e40c292ce954cf08");
  assert.equal(fingerprintText("Knowledge base"), "74aef83ce2465a18");
  assert.equal(fingerprintText("café"), "3308be7c708b4298");
  assert.equal(fingerprintText("\u{1F3A7}"), "522e8bd4025e8768", "hashing walks UTF-16 code units, not code points");
  assert.equal(
    fingerprintText("deterministic:repair:0000000000000000:811c9dc59e3779b9"),
    "fc61d5a75772ec93",
  );
  for (const sample of ["", "a", "Knowledge base", "café"]) {
    assert.match(fingerprintText(sample), /^[0-9a-f]{16}$/, sample);
  }

  // Every persisted-identity producer routes through the same function.
  assert.equal(
    deterministicSemanticHead("0000000000000000", "811c9dc59e3779b9", "repair"),
    fingerprintText("deterministic:repair:0000000000000000:811c9dc59e3779b9"),
  );
});

test("undo snapshots, snapshot restores, and recovery backups all carry the same personal-organization fields", () => {
  const source = migrateData(null);
  source.collections = [{ id: "c", title: "C", collapsed: false, subjects: ["KB/One.md"], subheadings: [] }];
  source.pinnedPaths = ["KB/One.md"];
  source.nextStudyPaths = ["KB/Two.md"];
  source.savedViews = [{ id: "v", name: "V", tab: "curriculum", query: "cafe" }];
  source.curriculumVisual = { parentByPath: { "KB/Two.md": "KB/One.md" }, orderByContainer: { "parent:KB/One.md": ["KB/Two.md"] } };
  source.directIndexPaths = ["KB/Two.md"];
  source.indexFolderSources = [{ id: "index-folder-kb", path: "KB", origin: "user" }];
  source.excludedIndexPaths = ["KB/Three.md"];
  source.indexGroupByPath = { "KB/One.md": "Research" };
  source.displayNameByPath = { "KB/One.md": "One" };
  source.indexGroupAliases = { Research: "R&D" };
  source.indexGroupOrder = ["Research"];

  const snapshot = snapshotPersonal(source, "Before");
  const backup = createPersonalBackup(source, "2026-01-01T00:00:00.000Z", "vault-1", "base-1", "Base one");

  // One list drives all three producers, so a field can never reach undo while
  // being dropped from backups (or the reverse).
  for (const field of PERSONAL_ORGANIZATION_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(snapshot, field), `snapshotPersonal captures ${field}`);
    assert.ok(Object.prototype.hasOwnProperty.call(backup, field), `createPersonalBackup captures ${field}`);
    assert.deepEqual(snapshot[field], source[field], `snapshotPersonal copies ${field} faithfully`);
    assert.deepEqual(backup[field], source[field], `createPersonalBackup copies ${field} faithfully`);
  }
  assert.deepEqual(
    PERSONAL_ORGANIZATION_FIELDS.map((field) => JSON.stringify(snapshot[field])),
    PERSONAL_ORGANIZATION_FIELDS.map((field) => JSON.stringify(backup[field])),
    "the snapshot and the backup agree field for field",
  );

  // Restore is the third copy of the list; every captured field must come back.
  const target = migrateData(null);
  restoreSnapshot(target, snapshot);
  for (const field of PERSONAL_ORGANIZATION_FIELDS) {
    assert.deepEqual(target[field], source[field], `restoreSnapshot returns ${field}`);
  }

  // Deep-copied, never aliased: mutating the restored state cannot reach back.
  target.pinnedPaths.push("KB/Four.md");
  target.indexGroupByPath["KB/One.md"] = "Teaching";
  assert.deepEqual(source.pinnedPaths, ["KB/One.md"]);
  assert.equal(source.indexGroupByPath["KB/One.md"], "Research");
  assert.deepEqual(snapshot.pinnedPaths, ["KB/One.md"]);
});

test("one name key decides base, group, and heading uniqueness everywhere", () => {
  assert.equal(normalizedNameKey("  Airway  "), "airway");
  // NFD "e" + combining acute must fold onto the precomposed form, or two
  // visually identical names claim the same slot in one module and not another.
  assert.equal(normalizedNameKey("Café"), normalizedNameKey("Café"));
  assert.equal(normalizedNameKey("CAFÉ"), "café");
  assert.equal(normalizedNameKey(""), "");
});

test("one error-to-text helper reproduces every shape the call sites inlined", () => {
  // The Error branch: the message alone, never the "Error: " prefix that
  // String(error) would add, because notices show it as a whole sentence.
  assert.equal(errorMessage(new Error("The export failed.")), "The export failed.");
  assert.equal(errorMessage(new TypeError("Bad input.")), "Bad input.");
  // A subclass that carries an empty message must stay empty rather than
  // falling through to a fallback the old ternary would never have reached.
  assert.equal(errorMessage(new Error("")), "");

  // The coerced branch, for callers that inlined String(error).
  assert.equal(errorMessage("plain string throw"), "plain string throw");
  assert.equal(errorMessage(undefined), "undefined");
  assert.equal(errorMessage(null), "null");
  assert.equal(errorMessage(42), "42");
  assert.equal(errorMessage({ toString: () => "coerced" }), "coerced");

  // The custom branch: a non-Error throw takes the caller's sentence, and an
  // Error still wins over it. Both are live user-visible strings.
  assert.equal(
    errorMessage(null, "The attachment could not be added."),
    "The attachment could not be added.",
  );
  assert.equal(
    errorMessage(new Error("Disk full."), "The attachment could not be added."),
    "Disk full.",
  );
  // An omitted fallback must behave exactly like the String(error) sites, so
  // undefined is not treated as a caller-supplied sentence.
  assert.equal(errorMessage("boom", undefined), "boom");
});

test("oversized text is clamped at every writer, so a paste can never brick the store read-only", () => {
  const oversized = "x".repeat(MAX_TRANSFER_TEXT_LENGTH + 1);
  const workspace = parseWorkspaceConfig({
    kind: "knowledge-base-command-center-workspace",
    version: 2,
    settings: { workspaceSubtitle: oversized },
    indexGroupOrder: [oversized],
  });
  assert.equal(workspace.settings.workspaceSubtitle.length, MAX_TRANSFER_TEXT_LENGTH);
  assert.equal(workspace.indexGroupOrder[0]?.length, MAX_TRANSFER_TEXT_LENGTH);

  // The Settings tab and setup wizard assign pasted text to live settings
  // without the cleaners; the save-path bound must clamp it before serialize.
  const data = migrateData(null);
  data.settings.workspaceSubtitle = oversized;
  data.settings.attachmentHeading = oversized;
  data.directIndexPaths = [oversized, oversized];
  data.indexFolderSources = [{ id: oversized, path: oversized, origin: "user" }];
  data.indexGroupOrder = [oversized];
  data.indexGroupAliases[oversized] = oversized;
  data.settings.libraryNoteProfiles = { "library-a": { folder: oversized } };
  enforceStoredTextBounds(data);
  assert.equal(data.settings.workspaceSubtitle.length, MAX_TRANSFER_TEXT_LENGTH);
  assert.equal(data.settings.attachmentHeading.length, MAX_TRANSFER_TEXT_LENGTH);
  assert.deepEqual(data.directIndexPaths.map((path) => path.length), [MAX_TRANSFER_TEXT_LENGTH]);
  assert.equal(data.indexFolderSources[0]?.path.length, MAX_TRANSFER_TEXT_LENGTH);
  assert.equal((data.indexFolderSources[0]?.id.length ?? 0) <= 128, true);
  assert.equal(data.indexGroupOrder[0]?.length, MAX_TRANSFER_TEXT_LENGTH);
  assert.equal(data.settings.libraryNoteProfiles["library-a"]?.folder?.length, MAX_TRANSFER_TEXT_LENGTH);
  for (const [key, value] of Object.entries(data.indexGroupAliases)) {
    assert.equal(key.length <= MAX_TRANSFER_TEXT_LENGTH, true);
    assert.equal(value.length <= MAX_TRANSFER_TEXT_LENGTH, true);
  }
  // The loader that previously refused the poisoned payload accepts the
  // clamped one: the exact failure was a hard throw at next launch.
  const reloaded = migrateData(JSON.parse(JSON.stringify(data)));
  assert.equal(reloaded.settings.workspaceSubtitle.length, MAX_TRANSFER_TEXT_LENGTH);
  assert.equal(clampStoredText(oversized).length, MAX_TRANSFER_TEXT_LENGTH);
});

test("cloneJsonValue deep-clones plugin JSON, including an own __proto__ key, without structuredClone", () => {
  const source = {
    settings: { workspaceName: "Clinic" },
    list: [1, "two", null, { nested: true }],
    undefinedValue: undefined,
  } as Record<string, unknown>;
  Object.defineProperty(source, "__proto__", { value: { sneaky: 1 }, enumerable: true, writable: true, configurable: true });
  const clone = cloneJsonValue(source);
  assert.notEqual(clone, source);
  assert.deepEqual(clone.settings, { workspaceName: "Clinic" });
  assert.notEqual(clone.settings, source.settings);
  assert.notEqual(clone.list, source.list);
  (clone.settings).workspaceName = "Changed";
  assert.equal((source.settings as { workspaceName: string }).workspaceName, "Clinic");
  assert.equal(Object.prototype.hasOwnProperty.call(clone, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(clone), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(clone, "__proto__")?.value, { sneaky: 1 });
});

test("persisted library order ties break by code units, not the host locale", () => {
  // Under any Latin locale collation "édition" sorts before "zebra" (base
  // letter e < z); by code units "zebra" (0x7A) sorts before "édition"
  // (0xE9). Persisted ordering must take the locale-independent answer, or
  // two synced devices reorder the same store and reset each other's sync
  // ancestry.
  assert.equal(codeUnitCompare("zebra", "édition") < 0, true);
  const state = {
    version: 3 as const,
    groups: [],
    subjects: [],
    resolvedPathBySubjectId: {},
    libraries: [
      { id: "library-b", name: "édition", singularName: "Item", icon: "book", order: 5, sourceKind: null, archivedAt: null },
      { id: "library-a", name: "zebra", singularName: "Item", icon: "book", order: 5, sourceKind: null, archivedAt: null },
    ],
    libraryLayouts: {},
  };
  ensureSystemLibraries(state);
  const names = state.libraries.map((library) => library.name);
  assert.equal(names.indexOf("zebra") < names.indexOf("édition"), true);
});

test("an extension topic refuses its own descendants as parent, at any depth", () => {
  const topicA = record({
    path: "Topics/ENT-LAR-EXT-001 - Alpha.md", title: "Alpha", domain: "Laryngology",
    curriculumId: "ENT-LAR-EXT-001", role: "canonical",
  });
  const topicB = record({
    path: "Topics/ENT-LAR-EXT-002 - Beta.md", title: "Beta", domain: "Laryngology",
    curriculumId: "ENT-LAR-EXT-002", role: "canonical", parentTopic: "[[Alpha]]",
  });
  const topicC = record({
    path: "Topics/ENT-LAR-EXT-003 - Gamma.md", title: "Gamma", domain: "Laryngology",
    curriculumId: "ENT-LAR-EXT-003", role: "canonical", parentTopic: "[[Beta]]",
  });
  const unrelated = record({
    path: "Topics/ENT-LAR-EXT-004 - Delta.md", title: "Delta", domain: "Laryngology",
    curriculumId: "ENT-LAR-EXT-004", role: "canonical",
  });
  const records = [topicA, topicB, topicC, unrelated];
  const value = {
    title: "Alpha", domain: "Laryngology", curriculumId: "ENT-LAR-EXT-001", parentPath: topicB.path,
    topicKind: "condition", priority: "P2", safetyCritical: false, addToCollection: false,
  };
  assert.match(canonicalHierarchyIssue(value, records, topicA.path) ?? "", /own descendant/);
  assert.match(canonicalHierarchyIssue({ ...value, parentPath: topicC.path }, records, topicA.path) ?? "", /own descendant/);
  assert.equal(canonicalHierarchyIssue({ ...value, parentPath: unrelated.path }, records, topicA.path), null);
  // Already-broken circular data terminates instead of hanging the validator.
  const loopedB = { ...topicB, parentTopic: "[[Gamma]]" };
  assert.equal(canonicalHierarchyIssue({ ...value, parentPath: unrelated.path }, [topicA, loopedB, topicC, unrelated], topicA.path), null);
});

test("folder fields refuse the same characters note titles fold away", () => {
  assert.match(validateWritableFolderPath("Notes #1", ".obsidian") ?? "", /cannot contain/);
  assert.match(validateWritableFolderPath("Ideas [drafts]", ".obsidian") ?? "", /cannot contain/);
  assert.match(validateWritableFolderPath("Deep/Bad^Segment", ".obsidian") ?? "", /cannot contain/);
  assert.match(validateWritableFolderPath("Notes.", ".obsidian") ?? "", /cannot end/);
  assert.match(validateWritableFolderPath("Trailing /Child", ".obsidian") ?? "", /cannot end/);
  assert.match(validateWritableFolderPath("CON", ".obsidian") ?? "", /reserved/);
  assert.match(validateWritableFolderPath("Archive/com1.backup", ".obsidian") ?? "", /reserved/);
  assert.equal(validateWritableFolderPath("Normal/Sub-folder (2)", ".obsidian"), null);
  assert.equal(validateWritableFolderPath("", ".obsidian"), null);
});
