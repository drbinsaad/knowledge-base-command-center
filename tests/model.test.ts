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
  cloneCollections,
  configuredGroupFromPath,
  createPersonalBackup,
  createWorkspaceConfig,
  expectedParentCurriculumId,
  genericNotePath,
  groupRecordsByGroup,
  isExtensionCurriculumId,
  isRecognizedPluginData,
  limitSnapshotStack,
  matchesQuery,
  matchesParsedQuery,
  MAX_CURRICULUM_DEPTH,
  metadataHasGap,
  migrateData,
  moveCurriculumVisual,
  curriculumChildPaths,
  curriculumDescendantPaths,
  curriculumSiblingPaths,
  parseQuery,
  parsePersonalBackup,
  parseWorkspaceConfig,
  pathIsInsideFolder,
  resolveExpectedParentPath,
  replaceCurriculumVisualPath,
  replacePathMapKey,
  reconcileCurriculumVisual,
  rewritePluginDataPathPrefix,
  resetCurriculumVisualPath,
  restoreSnapshot,
  rewriteTopLevelHeading,
  shouldHandleRowShortcut,
  snapshotStackDepthIsTruncated,
  sanitizeFileName,
  snapshotPersonal,
  storedDataVersion,
  unknownQueryTokens,
  validateWritableFolderPath,
  visualPlacementPathSet,
  type VaultRecord,
} from "../src/model.ts";

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
  assert.equal(data.version, 9);
  assert.deepEqual(data.collections.map((item) => item.title), ["My Airway"]);
  assert.equal(data.migrationBackup?.headings.length, 2);
  assert.equal(data.selectedPath, "topic.md");
  assert.deepEqual(data.layoutSnapshots, []);
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

test("v2 data migrates to v9 with the ENT clinical preset and safe settings", () => {
  const data = migrateData({
    version: 2,
    collections: [], pinnedPaths: [], nextStudyPaths: [], savedViews: [],
    settings: { defaultTab: "collections", recentLimit: 25, enableHoverPreview: true, showSafetyBadges: true },
  });
  assert.equal(data.version, 9);
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
  assert.equal(data.version, 9);
  assert.equal(data.collections[0]?.title, "Future collection");
  assert.equal(data.settings.openNoteBehavior, "split");
  assert.equal(data.migrationBackup, undefined);
});

test("v4 data gains an empty visual curriculum overlay", () => {
  const data = migrateData({ version: 4, collections: [], settings: {} });
  assert.equal(data.version, 9);
  assert.equal(data.settings.workspaceMode, "ent-clinical");
  assert.deepEqual(data.curriculumVisual, { parentByPath: {}, orderByContainer: {} });
});

test("fresh installs start as a configurable generic knowledge base", () => {
  const data = migrateData(null);
  assert.equal(data.version, 9);
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
  assert.equal(data.version, 9);
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

test("organization backup round-trips without clinical content", () => {
  const data = migrateData(null);
  data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [record().path], subheadings: [] }];
  data.pinnedPaths = [record().path];
  data.curriculumVisual.parentByPath[record().path] = null;
  data.manualIndexPaths = ["Outside/Topic.md"];
  data.excludedIndexPaths = ["Knowledge Base/Hidden.md"];
  data.indexGroupByPath["Outside/Topic.md"] = "Airway";
  data.indexGroupOrder = ["Airway"];
  const backup = createPersonalBackup(data, "2026-08-07T00:00:00.000Z");
  const parsed = parsePersonalBackup(JSON.parse(JSON.stringify(backup)) as unknown);
  assert.equal(parsed.collections[0]?.title, "Airway");
  assert.deepEqual(parsed.pinnedPaths, [record().path]);
  assert.equal(parsed.curriculumVisual.parentByPath[record().path], null);
  assert.deepEqual(parsed.manualIndexPaths, ["Outside/Topic.md"]);
  assert.deepEqual(parsed.excludedIndexPaths, ["Knowledge Base/Hidden.md"]);
  assert.equal(parsed.indexGroupByPath["Outside/Topic.md"], "Airway");
  assert.deepEqual(parsed.indexGroupOrder, ["Airway"]);
  assert.equal("settings" in parsed, false);
});

test("version 1 organization backups remain importable with empty index controls", () => {
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
  assert.equal(parsed.version, 3);
  assert.deepEqual(parsed.manualIndexPaths, []);
  assert.deepEqual(parsed.excludedIndexPaths, []);
  assert.deepEqual(parsed.indexGroupByPath, {});
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
    assert.equal(data.version, 9);
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
  assert.equal(diagnostics.length, 0);
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
  assert.equal(tree.parentByPath.get("KB/b.md"), "KB/a.md");
  assert.equal(tree.parentByPath.get("KB/c.md"), "KB/b.md");
  assert.deepEqual([...curriculumDescendantPaths(tree, "KB/a.md")].sort(), ["KB/b.md", "KB/c.md"]);
});
