import assert from "node:assert/strict";
import test from "node:test";
import {
  EntVaultCommandCenterView,
  indexMembershipProvenance,
  legacyIndexSourceWarningText,
  type IndexMembershipProvenanceData,
} from "../src/view.ts";
import { migrateData, type PluginData, type VaultRecord } from "../src/model.ts";
import { asHtmlElement, createFakeDom, type FakeElement } from "./support/fake-dom.ts";

function genericData(overrides: Partial<IndexMembershipProvenanceData> = {}): IndexMembershipProvenanceData {
  return {
    settings: { workspaceMode: "generic" },
    directIndexPaths: [],
    indexFolderSources: [],
    manualIndexPaths: [],
    excludedIndexPaths: [],
    ...overrides,
  };
}

function record(path: string, title: string): VaultRecord {
  return {
    path,
    title,
    kind: "topic",
    role: "supporting",
    curriculumId: "",
    domain: "Research",
    topicKind: "Note",
    priority: "",
    reviewStatus: "unverified",
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
    folderOrder: "Research",
    mtime: 0,
    aiLock: false,
  };
}

test("Index row provenance distinguishes direct, linked-folder, and imported-placeholder membership", () => {
  const linkedSource = { id: "source-kb", path: "Knowledge Base", origin: "user" as const };
  const data = genericData({
    directIndexPaths: ["Knowledge Base/Direct.md"],
    indexFolderSources: [linkedSource],
  });

  assert.deepEqual(indexMembershipProvenance({ path: "Knowledge Base/Direct.md" }, data), {
    kind: "direct",
    label: "Direct",
    compactLabel: "Direct",
    ariaLabel: "Index membership: Direct",
  }, "exact-note intent takes precedence when the same note also sits in a linked folder");
  assert.deepEqual(indexMembershipProvenance({ path: "Knowledge Base/Automatic.md" }, data), {
    kind: "linked-folder",
    label: "Linked folder",
    compactLabel: "Linked",
    ariaLabel: "Index membership: Linked folder",
  });
  assert.deepEqual(indexMembershipProvenance({
    path: "kbcc-placeholder:subject-a",
    isPlaceholder: true,
    portableId: "subject-a",
    portableIndexed: true,
  }, genericData({ directIndexPaths: ["kbcc-placeholder:subject-a"] })), {
    kind: "imported-placeholder",
    label: "Imported placeholder",
    compactLabel: "Imported",
    ariaLabel: "Index membership: Imported placeholder",
  }, "a synthetic portable identity must not be presented as a directly added Markdown note");
  assert.equal(indexMembershipProvenance({
    path: "Research/Resolved import.md",
    portableId: "subject-b",
    portableIndexed: true,
  }, genericData()), null, "a resolved portable identity is not a third Generic membership authority");
});

test("Index row provenance does not mislabel Library or Hidden destinations", () => {
  const data = genericData({
    directIndexPaths: ["Knowledge Base/Reference.md", "Knowledge Base/Hidden.md"],
    indexFolderSources: [{ id: "source-kb", path: "Knowledge Base", origin: "user" }],
    excludedIndexPaths: ["Knowledge Base/Hidden.md"],
  });

  assert.equal(indexMembershipProvenance({ path: "Knowledge Base/Reference.md", libraryId: "references" }, data), null);
  assert.equal(indexMembershipProvenance({ path: "Knowledge Base/Hidden.md" }, data), null);
  assert.equal(indexMembershipProvenance({ path: "Knowledge Base/Portable hidden.md", portableIndexed: false }, data), null);
});

test("protected clinical source membership remains distinct from generic folder links", () => {
  assert.deepEqual(indexMembershipProvenance({
    path: "ENT/Pediatric/Topic.md",
    portableId: "clinical-topic",
    portableIndexed: true,
  }, {
    ...genericData(),
    settings: { workspaceMode: "ent-clinical" },
  }), {
    kind: "protected-source",
    label: "Protected source",
    compactLabel: "Protected",
    ariaLabel: "Index membership: Protected clinical source",
  });
  assert.equal(indexMembershipProvenance({ path: "ENT/Pediatric/Direct.md" }, {
    ...genericData({
      directIndexPaths: ["ENT/Pediatric/Direct.md"],
      indexFolderSources: [{ id: "stale-source", path: "ENT", origin: "user" }],
    }),
    settings: { workspaceMode: "ent-clinical" },
  })?.kind, "direct", "exact direct intent remains visible before protected-source fallback");
  assert.equal(indexMembershipProvenance({ path: "ENT/Pediatric/Protected.md" }, {
    ...genericData({
      indexFolderSources: [{ id: "stale-source", path: "ENT", origin: "user" }],
    }),
    settings: { workspaceMode: "ent-clinical" },
  })?.kind, "protected-source", "stale generic folder data cannot relabel clinical membership");
});

test("rendered Index rows expose exact desktop text, compact text, and full ARIA provenance", () => {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.enableHoverPreview = false;
  data.indexFolderSources = [{ id: "source-kb", path: "Knowledge Base", origin: "user" }];
  data.directIndexPaths = ["kbcc-placeholder:missing-note"];
  const indexed = record("Knowledge Base/README.md", "README");
  const source = { baseId: "base-a", baseName: "Main", data, records: [indexed] };
  interface RowHarness {
    plugin: {
      data: PluginData;
      getActiveKnowledgeBaseId(): string;
      getLibrary(): null;
    };
    editMode: boolean;
    renderRecordRow(parent: HTMLElement, item: VaultRecord, level: number, membership?: unknown, searchContext?: unknown): void;
  }
  const view = Object.create(EntVaultCommandCenterView.prototype) as RowHarness;
  view.plugin = {
    data,
    getActiveKnowledgeBaseId: () => "base-a",
    getLibrary: () => null,
  };
  view.editMode = false;
  const parent = dom.document.body.createDiv();

  view.renderRecordRow(asHtmlElement(parent), indexed, 1, undefined, { source, showIndexProvenance: true });

  const title = parent.querySelector(".ent-cc-subject-title");
  const meta = parent.querySelector(".ent-cc-membership-provenance");
  const compact = parent.querySelector(".ent-cc-membership-badge");
  assert.equal(meta?.textContent, "Linked folder");
  assert.equal(compact?.textContent, "Linked");
  assert.equal(compact?.getAttribute("data-membership-kind"), "linked-folder");
  assert.equal(compact?.getAttribute("aria-label"), "Index membership: Linked folder");
  assert.match(title?.getAttribute("aria-label") ?? "", /Index membership: Linked folder/u);

  const placeholder = record("kbcc-placeholder:missing-note", "Missing note");
  placeholder.isPlaceholder = true;
  placeholder.portableId = "missing-note";
  placeholder.portableIndexed = true;
  const placeholderParent = dom.document.body.createDiv();
  view.renderRecordRow(asHtmlElement(placeholderParent), placeholder, 1, undefined, {
    source: { baseId: "base-a", baseName: "Main", data, records: [placeholder] },
    showIndexProvenance: true,
  });
  assert.equal(placeholderParent.querySelector(".ent-cc-placeholder-badge")?.textContent, "No note");
  assert.equal(placeholderParent.querySelector(".ent-cc-membership-badge")?.textContent, "Imported");

  const clinicalData = migrateData(null);
  clinicalData.settings.workspaceMode = "ent-clinical";
  clinicalData.settings.enableHoverPreview = false;
  const clinical = record("03 Clinical Topics/ENT-PED-003.04.md", "Laryngeal web");
  clinical.curriculumId = "ENT-PED-003.04";
  clinical.portableIndexed = true;
  const clinicalParent = dom.document.body.createDiv();
  view.plugin.data = clinicalData;
  view.renderRecordRow(asHtmlElement(clinicalParent), clinical, 1, undefined, {
    source: { baseId: "base-a", baseName: "ENT", data: clinicalData, records: [clinical] },
    showIndexProvenance: true,
  });
  assert.equal(clinicalParent.querySelector(".ent-cc-subject-id-value")?.textContent, "ENT-PED-003.04");
  assert.equal(clinicalParent.querySelector(".ent-cc-membership-provenance")?.textContent, "Protected source");
});

test("persistent main-view warning opens the narrow legacy review entry point", () => {
  const dom = createFakeDom();
  let reviewOpens = 0;
  interface WarningHarness {
    plugin: {
      data: PluginData;
      isClinicalMode(): boolean;
      isDataReadOnly(): boolean;
      getLegacyIndexReviewPlans(): Array<{ source: { id: string; path: string }; candidates: unknown[] }>;
      openLegacyIndexReview(): void;
    };
    renderLegacyIndexSourceWarning(parent: HTMLElement): void;
  }
  const view = Object.create(EntVaultCommandCenterView.prototype) as WarningHarness;
  view.plugin = {
    data: migrateData(null),
    isClinicalMode: () => false,
    isDataReadOnly: () => false,
    getLegacyIndexReviewPlans: () => [{
      source: { id: "legacy-kb", path: "Knowledge Base" },
      candidates: [{ path: "Knowledge Base/README.md" }],
    }],
    openLegacyIndexReview: () => { reviewOpens += 1; },
  };

  view.renderLegacyIndexSourceWarning(asHtmlElement(dom.document.body));

  const warning = dom.document.body.querySelector(".ent-cc-legacy-index-warning");
  const review = dom.document.body.querySelector(".ent-cc-legacy-index-warning button");
  assert.equal(warning?.getAttribute("role"), "region");
  assert.match(warning?.textContent ?? "", /README|1 note currently enters/u);
  assert.equal(review?.textContent, "Review…");
  review?.click();
  assert.equal(reviewOpens, 1);
});

test("legacy warning explains read-only protection and blocks the dead-end modal", () => {
  const dom = createFakeDom();
  let opens = 0;
  const data = migrateData(null);
  data.indexFolderSources = [{ id: "legacy-kb", path: "Knowledge Base", origin: "legacy-primary-folder" }];
  interface WarningHarness {
    plugin: {
      data: PluginData;
      isClinicalMode(): boolean;
      isDataReadOnly(): boolean;
      getLegacyIndexReviewPlans(): Array<{ source: { id: string; path: string }; candidates: unknown[] }>;
      openLegacyIndexReview(): void;
    };
    renderLegacyIndexSourceWarning(parent: HTMLElement): void;
  }
  const view = Object.create(EntVaultCommandCenterView.prototype) as WarningHarness;
  view.plugin = {
    data,
    isClinicalMode: () => false,
    isDataReadOnly: () => true,
    getLegacyIndexReviewPlans: () => [{ source: data.indexFolderSources[0], candidates: [{}] }],
    openLegacyIndexReview: () => { opens += 1; },
  };
  view.renderLegacyIndexSourceWarning(asHtmlElement(dom.document.body));
  const button = dom.document.body.querySelector("button") as unknown as FakeElement & { disabled: boolean };
  assert.equal(button.disabled, true);
  assert.match(dom.document.body.textContent, /read-only.*resolve the protection state/i);
  button.click();
  assert.equal(opens, 0);
});

test("legacy source warning names bounded folders and counts folder-supplied candidates", () => {
  assert.equal(legacyIndexSourceWarningText([]), "");
  assert.equal(
    legacyIndexSourceWarningText([{
      source: { id: "legacy-kb", path: "Knowledge Base" },
      candidates: [{ path: "Knowledge Base/README.md" }],
    }]),
    "Legacy linked folder “Knowledge Base” is still active. 1 note currently enters the Index automatically because it is stored there.",
  );

  const multiple = legacyIndexSourceWarningText([
    { source: { id: "legacy-root", path: "/" }, candidates: [{}, {}] },
    { source: { id: "legacy-research", path: "Research" }, candidates: [{}] },
    { source: { id: "legacy-archive", path: "Archive" }, candidates: [] },
  ]);
  assert.match(multiple, /Legacy linked folders “Vault root”, “Research”, and 1 more are still active\./u);
  assert.match(multiple, /3 notes currently enter the Index automatically/u);
  assert.match(legacyIndexSourceWarningText([
    { source: { id: "legacy-a", path: "A" }, candidates: [] },
    { source: { id: "legacy-b", path: "B" }, candidates: [] },
  ]), /No current notes depend only on these links/u);
  assert.match(legacyIndexSourceWarningText([{
    source: { id: "legacy-missing", path: "Knowledge Base" },
    sourceFolderAvailable: false,
    candidates: [],
  }]), /unavailable on this device.*cannot be counted safely.*Sync finish/iu);
});
