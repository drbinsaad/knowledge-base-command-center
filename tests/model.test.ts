import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTemplateTokens,
  applyCanonicalFrontmatter,
  asUnknownRecord,
  buildCurriculumLayout,
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
  isExtensionCurriculumId,
  matchesQuery,
  metadataHasGap,
  migrateData,
  moveCurriculumVisual,
  parsePersonalBackup,
  parseWorkspaceConfig,
  pathIsInsideFolder,
  resolveExpectedParentPath,
  replaceCurriculumVisualPath,
  replacePathMapKey,
  reconcileCurriculumVisual,
  resetCurriculumVisualPath,
  restoreSnapshot,
  shouldHandleRowShortcut,
  snapshotPersonal,
  storedDataVersion,
  unknownQueryTokens,
  validateWritableFolderPath,
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
  assert.equal(data.version, 8);
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

test("curriculum layout groups topics without changing their paths", () => {
  const parent = record({ path: "03 Clinical Topics/01 Pediatric/ENT-PED-003 - Congenital Laryngeal Anomalies.md", title: "Congenital Laryngeal Anomalies", curriculumId: "ENT-PED-003" });
  const supporting = record({ path: "03 Clinical Topics/01 Pediatric/Laryngeal Cleft - Feeding.md", title: "Laryngeal Cleft - Feeding", curriculumId: "", role: "supporting", parentTopic: "[[ENT-PED-003.05 - Laryngeal Cleft|Laryngeal Cleft]]" });
  const layout = buildCurriculumLayout([record(), parent, supporting]);
  assert.equal(layout[0]?.title, "Pediatric");
  assert.equal(layout[0]?.subheadings[0]?.title, "Congenital Laryngeal Anomalies");
  assert.ok(layout[0]?.subheadings[0]?.subjects.includes(record().path));
  assert.equal(layout.flatMap((heading) => heading.subheadings).flatMap((subheading) => subheading.subjects).filter((path) => path === supporting.path).length, 1);
  assert.equal([record(), parent, supporting].filter((item) => item.role === "canonical").length, 2);
});

test("curriculum layout keeps canonical extension topics", () => {
  const extension = record({
    path: "03 Clinical Topics/03 Laryngology/ENT-LAR-EXT-001 - Extension Topic.md",
    title: "Extension Topic",
    curriculumId: "ENT-LAR-EXT-001",
    domain: "Laryngology",
    folderOrder: "03 Laryngology",
  });
  const layout = buildCurriculumLayout([extension]);
  assert.deepEqual(layout[0]?.subheadings[0]?.subjects, [extension.path]);
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

test("v2 data migrates to v8 with the ENT clinical preset and safe settings", () => {
  const data = migrateData({
    version: 2,
    collections: [], pinnedPaths: [], nextStudyPaths: [], savedViews: [],
    settings: { defaultTab: "collections", recentLimit: 25, enableHoverPreview: true, showSafetyBadges: true },
  });
  assert.equal(data.version, 8);
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
  assert.equal(data.version, 8);
  assert.equal(data.collections[0]?.title, "Future collection");
  assert.equal(data.settings.openNoteBehavior, "split");
  assert.equal(data.migrationBackup, undefined);
});

test("v4 data gains an empty visual curriculum overlay", () => {
  const data = migrateData({ version: 4, collections: [], settings: {} });
  assert.equal(data.version, 8);
  assert.equal(data.settings.workspaceMode, "ent-clinical");
  assert.deepEqual(data.curriculumVisual, { parentByPath: {}, orderByContainer: {} });
});

test("fresh installs start as a configurable generic knowledge base", () => {
  const data = migrateData(null);
  assert.equal(data.version, 8);
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
  assert.equal(data.version, 8);
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
