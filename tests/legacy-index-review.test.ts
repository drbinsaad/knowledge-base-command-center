import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptLegacyIndexSourceToData,
  applyLegacyIndexReviewToData,
  buildLegacyIndexReviewPlan,
  withLegacyIndexReviewSelection,
} from "../src/legacy-index-review.ts";
import {
  createLegacyPrimaryFolderSource,
  INDEX_FOLDER_VAULT_ROOT,
  migrateData,
  portablePlaceholderPath,
  type IndexFolderSource,
  type PluginData,
  type VaultRecord,
} from "../src/model.ts";

function record(path: string, title: string, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    path,
    title,
    kind: "topic",
    role: "canonical",
    curriculumId: "",
    domain: "ENT",
    topicKind: "note",
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
    folderOrder: "ENT",
    mtime: 1,
    aiLock: false,
    ...overrides,
  };
}

function reviewData(): { data: PluginData; legacy: IndexFolderSource } {
  const data = migrateData(null);
  const legacy = createLegacyPrimaryFolderSource("Knowledge Base");
  assert.ok(legacy);
  data.indexFolderSources = [legacy];
  return { data, legacy };
}

function build(
  data: PluginData,
  sourceId: string,
  records: VaultRecord[],
  existingPaths = new Set(records.filter((item) => !item.isPlaceholder).map((item) => item.path)),
  sourceFolderAvailable = true,
) {
  return buildLegacyIndexReviewPlan({
    data,
    records,
    existingMarkdownPaths: existingPaths,
    sourceFolderAvailable,
    sourceId,
  });
}

test("an unavailable non-root source cannot be unlinked while the vault root remains reviewable", () => {
  const { data, legacy } = reviewData();
  const unavailable = build(data, legacy.id, [], new Set(), false);
  assert.equal(unavailable.sourceFolderAvailable, false);
  assert.deepEqual(unavailable.candidates, []);
  assert.throws(
    () => withLegacyIndexReviewSelection(unavailable, []),
    /not available.*Sync/iu,
  );
  assert.equal(acceptLegacyIndexSourceToData(data, unavailable), true, "keeping a missing source linked is always safe");

  const rootData = migrateData(null);
  rootData.indexFolderSources = [{
    id: "legacy-root",
    path: INDEX_FOLDER_VAULT_ROOT,
    origin: "legacy-primary-folder",
  }];
  const rootPlan = build(rootData, "legacy-root", [], new Set(), false);
  assert.equal(rootPlan.sourceFolderAvailable, true, "the vault-root sentinel needs no TFolder lookup");
  assert.doesNotThrow(() => withLegacyIndexReviewSelection(rootPlan, []));
});

test("legacy review enumerates only real Index notes supplied solely by that source", () => {
  const { data, legacy } = reviewData();
  data.displayNameByPath["Knowledge Base/only.md"] = "Reviewed title";
  data.directIndexPaths = ["Knowledge Base/direct.md"];
  data.manualIndexPaths = ["Knowledge Base/manual.md"];
  data.excludedIndexPaths = ["Knowledge Base/hidden.md"];
  data.indexFolderSources.push({ id: "index-folder-shared", path: "Knowledge Base/Shared", origin: "user" });
  const placeholderPath = portablePlaceholderPath("subject-placeholder");
  const records = [
    record("Knowledge Base/only.md", "Only"),
    record("Knowledge Base/direct.md", "Direct"),
    record("Knowledge Base/manual.md", "Manual"),
    record("Knowledge Base/hidden.md", "Hidden"),
    record("Knowledge Base/Shared/overlap.md", "Overlap"),
    record("Knowledge Base/library.md", "Library", { libraryId: "resources" }),
    record("Knowledge Base/non-index.md", "Non-index", { portableIndexed: false }),
    record("Knowledge Base/proposal.md", "Proposal", { kind: "proposal", role: "proposal" }),
    record("Knowledge Base/not-real.md", "Unavailable"),
    record("Outside/outside.md", "Outside"),
    record("Knowledge Base/fake-placeholder.md", "Placeholder", { isPlaceholder: true }),
    record(placeholderPath, "Portable placeholder", { role: "placeholder", isPlaceholder: true, portableIndexed: true }),
    record("Knowledge Base/not-markdown.txt", "Text"),
  ];
  const existing = new Set(records.map((item) => item.path));
  existing.delete("Knowledge Base/not-real.md");

  const plan = build(data, legacy.id, records, existing);
  assert.deepEqual(plan.candidates, [{
    path: "Knowledge Base/only.md",
    title: "Reviewed title",
    domain: "ENT",
    kind: "topic",
  }]);
  assert.equal(plan.source.origin, "legacy-primary-folder");
  assert.match(plan.stateFingerprint, /^[0-9a-f]{16}$/u);
  assert.match(plan.fingerprint, /^[0-9a-f]{16}$/u);
});

test("review fingerprints are deterministic and detect visible vault or classification drift", () => {
  const { data, legacy } = reviewData();
  const alpha = record("Knowledge Base/alpha.md", "Alpha");
  const beta = record("Knowledge Base/beta.md", "Beta");
  const initial = build(data, legacy.id, [beta, alpha]);
  const reordered = build(data, legacy.id, [alpha, beta]);
  assert.deepEqual(reordered, initial);

  const renamed = build(data, legacy.id, [record(alpha.path, "Renamed"), beta]);
  assert.notEqual(renamed.fingerprint, initial.fingerprint);
  const reclassified = build(data, legacy.id, [record(alpha.path, "Alpha", { libraryId: "resources" }), beta]);
  assert.notEqual(reclassified.fingerprint, initial.fingerprint);
  assert.deepEqual(reclassified.candidates.map((candidate) => candidate.path), [beta.path]);
  const missing = build(data, legacy.id, [alpha, beta], new Set([alpha.path]));
  assert.notEqual(missing.fingerprint, initial.fingerprint);
});

test("reviewed conversion preserves only the selected subset and unlinks in one exact mutation", () => {
  const { data, legacy } = reviewData();
  const overlapping: IndexFolderSource = {
    id: "index-folder-overlap",
    path: "Knowledge Base/Shared",
    origin: "user",
  };
  data.indexFolderSources.push(overlapping);
  data.directIndexPaths = ["Elsewhere/already-direct.md"];
  data.excludedIndexPaths = [
    "Knowledge Base/hidden-only.md",
    "Knowledge Base/hidden-direct.md",
    "Knowledge Base/Shared/hidden-overlap.md",
    "Outside/unrelated-hidden.md",
  ];
  data.directIndexPaths.push("Knowledge Base/hidden-direct.md");
  const alpha = record("Knowledge Base/alpha.md", "Alpha");
  const beta = record("Knowledge Base/beta.md", "Beta");
  const plan = build(data, legacy.id, [alpha, beta]);
  const commit = withLegacyIndexReviewSelection(plan, [beta.path]);

  assert.equal(applyLegacyIndexReviewToData(data, commit), true);
  assert.deepEqual(data.directIndexPaths, [
    "Elsewhere/already-direct.md",
    "Knowledge Base/hidden-direct.md",
    beta.path,
  ]);
  assert.deepEqual(data.indexFolderSources, [overlapping]);
  assert.deepEqual(data.excludedIndexPaths, [
    "Knowledge Base/hidden-direct.md",
    "Knowledge Base/Shared/hidden-overlap.md",
    "Outside/unrelated-hidden.md",
  ]);
  const applied = JSON.stringify(data);
  assert.equal(applyLegacyIndexReviewToData(data, commit), false, "one reviewed plan cannot apply twice");
  assert.equal(JSON.stringify(data), applied, "a rejected stale plan cannot partially mutate data");
});

test("reviewed conversion preserves the visible group when unlinking changes folder derivation", () => {
  const data = migrateData(null);
  const legacy: IndexFolderSource = {
    id: "index-folder-root",
    path: INDEX_FOLDER_VAULT_ROOT,
    origin: "legacy-primary-folder",
  };
  data.settings.primaryFolder = "";
  data.indexFolderSources = [legacy];
  const nested = record("Research/Deep/Topic.md", "Topic", { domain: "Research" });
  const plan = build(data, legacy.id, [nested]);

  assert.equal(applyLegacyIndexReviewToData(
    data,
    withLegacyIndexReviewSelection(plan, [nested.path]),
  ), true);
  assert.deepEqual(data.indexFolderSources, []);
  assert.deepEqual(data.directIndexPaths, [nested.path]);
  assert.equal(data.indexGroupByPath[nested.path], "Research", "the post-unlink parent fallback cannot regroup the note as Deep");
});

test("selection is restricted to reviewed candidates and normalized deterministically", () => {
  const { data, legacy } = reviewData();
  const alpha = record("Knowledge Base/alpha.md", "Alpha");
  const beta = record("Knowledge Base/beta.md", "Beta");
  const plan = build(data, legacy.id, [alpha, beta]);
  const commit = withLegacyIndexReviewSelection(plan, [beta.path, alpha.path, beta.path]);
  assert.deepEqual(commit.preservePaths, [alpha.path, beta.path]);
  assert.throws(
    () => withLegacyIndexReviewSelection(plan, ["Knowledge Base/not-reviewed.md"]),
    /not part of this legacy linked-folder review/i,
  );
});

test("data drift invalidates conversion before any field is changed", () => {
  const { data, legacy } = reviewData();
  const alpha = record("Knowledge Base/alpha.md", "Alpha");
  const commit = withLegacyIndexReviewSelection(build(data, legacy.id, [alpha]), [alpha.path]);
  data.excludedIndexPaths.push("Knowledge Base/arrived-after-preview.md");
  const before = JSON.stringify(data);

  assert.equal(applyLegacyIndexReviewToData(data, commit), false);
  assert.equal(JSON.stringify(data), before);
});

test("accepting a reviewed legacy source changes only its provenance and is stale-safe", () => {
  const { data, legacy } = reviewData();
  data.directIndexPaths = ["Outside/direct.md"];
  data.excludedIndexPaths = ["Knowledge Base/hidden.md"];
  const plan = build(data, legacy.id, [record("Knowledge Base/alpha.md", "Alpha")]);
  const directBefore = [...data.directIndexPaths];
  const excludedBefore = [...data.excludedIndexPaths];

  assert.equal(acceptLegacyIndexSourceToData(data, plan), true);
  assert.equal(data.indexFolderSources[0]?.origin, "user");
  assert.deepEqual(data.directIndexPaths, directBefore);
  assert.deepEqual(data.excludedIndexPaths, excludedBefore);
  assert.equal(acceptLegacyIndexSourceToData(data, plan), false);
});

test("only an extant legacy source in a generic base can be reviewed", () => {
  const { data, legacy } = reviewData();
  assert.throws(() => build(data, "missing", []), /no longer available/i);
  data.indexFolderSources[0] = { ...legacy, origin: "user" };
  assert.throws(() => build(data, legacy.id, []), /no longer available/i);
  data.indexFolderSources[0] = legacy;
  data.settings.workspaceMode = "ent-clinical";
  assert.throws(() => build(data, legacy.id, []), /generic knowledge base/i);
});
