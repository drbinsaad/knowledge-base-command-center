import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { ExportImportCenterModal } from "../src/portability-modal.ts";
import {
  BUILTIN_LIBRARY_DEFINITIONS,
  buildCurriculumTree,
  createDefaultStore,
  createKnowledgeBaseEntry,
  curriculumContainerKey,
  DATA_VERSION,
  libraryTabId,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_KNOWLEDGE_BASES,
  MAX_LIBRARIES,
  migrateData,
  migrateStore,
  portablePlaceholderPath,
  provisionalInterimEnvelopeVaultFingerprint,
  provisionalMigratedVaultFingerprint,
  restoreSnapshot,
  snapshotPersonal,
  STORE_KIND,
  STORE_VERSION,
  type PluginStore,
} from "../src/model.ts";
import {
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  parsePortableExport,
  synchronizePortableRegistry,
} from "../src/portability.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import { ConfirmModal, IndexGroupModal } from "../src/modals.ts";
import { Notice, Plugin, TFile, TFolder, type TAbstractFile } from "obsidian";
import { mergeKnowledgeBaseStores } from "../src/store-merge.ts";

interface TestPluginBase {
  loadedData: unknown;
  savedData: unknown[];
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function pluginWith(data: unknown): EntVaultCommandCenterPlugin & TestPluginBase {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  return plugin;
}

function pluginWithFiles(
  data: unknown,
  files: TFile[],
  frontmatterByPath: Record<string, Record<string, unknown>>,
): {
  plugin: EntVaultCommandCenterPlugin & TestPluginBase;
  metadataReadCount: () => number;
  sourceMutationCount: () => number;
  vaultEnumerationCount: () => number;
} {
  let metadataReads = 0;
  let sourceMutations = 0;
  let vaultEnumerations = 0;
  const forbiddenSourceMutation = (): never => {
    sourceMutations += 1;
    throw new Error("A plugin-only organization action attempted to mutate a vault file.");
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => {
        vaultEnumerations += 1;
        return files;
      },
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      modify: forbiddenSourceMutation,
      process: forbiddenSourceMutation,
      create: forbiddenSourceMutation,
      delete: forbiddenSourceMutation,
      rename: forbiddenSourceMutation,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => {
        metadataReads += 1;
        return { frontmatter: frontmatterByPath[file.path] ?? {} };
      },
      resolvedLinks: {},
    },
    fileManager: {
      renameFile: forbiddenSourceMutation,
      processFrontMatter: forbiddenSourceMutation,
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  return {
    plugin,
    metadataReadCount: () => metadataReads,
    sourceMutationCount: () => sourceMutations,
    vaultEnumerationCount: () => vaultEnumerations,
  };
}

function invalidEntMedicationIndexData(file: TFile): ReturnType<typeof migrateData> {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.portableIndex.groups = [{ id: "legacy-index", title: "Legacy Index", order: 0 }];
  data.portableIndex.subjects = [{
    id: "legacy-medication",
    title: "Allergodil",
    groupId: "legacy-index",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
    libraryId: null,
  }];
  data.portableIndex.resolvedPathBySubjectId = { "legacy-medication": file.path };
  data.manualIndexPaths = [file.path];
  data.indexGroupByPath = { [file.path]: "Legacy Index" };
  return data;
}

function diverseLegacyEntIndexData(): {
  data: ReturnType<typeof migrateData>;
  files: TFile[];
  frontmatter: Record<string, Record<string, unknown>>;
} {
  const paths = {
    procedure: "04 Procedures/Procedure - Airway endoscopy.md",
    medication: "06 Clinical Tools/Medications/Drug - Allergodil.md",
    syndrome: "06 Clinical Tools/Syndromes/Syndrome - Usher.md",
    topic: "03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md",
    proposal: "01 Inbox/Proposed airway.md",
    note: "Outside/Misleading proposal.md",
    topicPlaceholder: portablePlaceholderPath("topic-placeholder"),
    medicationPlaceholder: portablePlaceholderPath("medication-placeholder"),
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox";
  data.portableIndex.groups = [{ id: "legacy-index", title: "Legacy Index", order: 0 }];
  const definitions = [
    ["procedure", paths.procedure, "topic"],
    ["medication", paths.medication, "topic"],
    ["syndrome", paths.syndrome, "topic"],
    ["topic", paths.topic, "topic"],
    ["proposal", paths.proposal, "topic"],
    ["note", paths.note, "topic"],
    ["topic-placeholder", paths.topicPlaceholder, "topic"],
    ["medication-placeholder", paths.medicationPlaceholder, "medication"],
  ] as const;
  data.portableIndex.subjects = definitions.map(([id, _path, recordKind], order) => ({
    id,
    title: id,
    groupId: "legacy-index",
    parentId: null,
    order,
    indexed: true,
    configuredId: "",
    recordKind,
    libraryId: null,
  }));
  data.portableIndex.resolvedPathBySubjectId = Object.fromEntries(
    definitions
      .filter(([, path]) => !path.startsWith("kbcc-placeholder:"))
      .map(([id, path]) => [id, path]),
  );
  data.manualIndexPaths = definitions.map(([, path]) => path);
  const files = Object.values(paths)
    .filter((path) => !path.startsWith("kbcc-placeholder:"))
    .map((path) => new TFile(path));
  const frontmatter = Object.fromEntries(files.map((file) => [file.path, {
    title: file.basename,
    // Deliberately misleading: upgrade remediation must not depend on a warm
    // or complete metadata cache while vault files are still syncing.
    type: "topic-proposal",
  }]));
  return { data, files, frontmatter };
}

function legacyEntSnapshotWithoutLibraries(label: string): ReturnType<typeof snapshotPersonal> {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.portableIndex.libraries = [];
  data.portableIndex.libraryLayouts = {};
  const missingTab = libraryTabId("missing-library");
  data.settings.defaultTab = missingTab;
  data.activeTab = missingTab;
  data.savedViews = [{ id: "missing-view", name: "Missing library", tab: missingTab, query: "" }];
  return snapshotPersonal(data, label, true, true, false, true);
}

function assertEntLibrariesAndNavigationAreNormalized(data: ReturnType<typeof migrateData>): void {
  assert.deepEqual(
    BUILTIN_LIBRARY_DEFINITIONS.map((library) => library.id).every((id) => data.portableIndex.libraries.some((library) => library.id === id)),
    true,
  );
  assert.equal(data.settings.defaultTab, "curriculum");
  assert.equal(data.activeTab, "curriculum");
  assert.deepEqual(data.savedViews, []);
}

function trackedVaultTree(initial: TAbstractFile[]): {
  entries: Map<string, TAbstractFile>;
  createdFolders: string[];
  trashedFolders: string[];
  createFolder(path: string): Promise<void>;
  renameFile(file: TFile, destination: string): Promise<void>;
  trashFile(file: TAbstractFile): Promise<void>;
  markdownFiles(): TFile[];
} {
  const entries = new Map<string, TAbstractFile>();
  const createdFolders: string[] = [];
  const trashedFolders: string[] = [];
  const parentPath = (path: string): string => path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
  const attach = (file: TAbstractFile): void => {
    entries.set(file.path, file);
    const parent = entries.get(parentPath(file.path));
    if (parent instanceof TFolder && !parent.children.includes(file)) parent.children.push(file);
  };
  const detach = (file: TAbstractFile): void => {
    entries.delete(file.path);
    const parent = entries.get(parentPath(file.path));
    if (parent instanceof TFolder) parent.children = parent.children.filter((child) => child !== file);
  };
  for (const entry of initial) attach(entry);
  return {
    entries,
    createdFolders,
    trashedFolders,
    async createFolder(path): Promise<void> {
      const folder = new TFolder(path);
      attach(folder);
      createdFolders.push(path);
    },
    async renameFile(file, destination): Promise<void> {
      detach(file);
      file.path = destination;
      attach(file);
    },
    async trashFile(file): Promise<void> {
      if (!(file instanceof TFolder) || file.children.length > 0) throw new Error("Only an empty folder can be trashed by this fixture.");
      trashedFolders.push(file.path);
      detach(file);
    },
    markdownFiles(): TFile[] {
      return [...entries.values()].filter((entry): entry is TFile => entry instanceof TFile && entry.extension === "md");
    },
  };
}

test("versionless modern plugin data is migrated and saved without losing organization", async () => {
  const plugin = pluginWith({
    collections: [{ id: "research", title: "Research", collapsed: false, subjects: ["Notes/Paper.md"], subheadings: [] }],
    pinnedPaths: ["Notes/Paper.md"],
    settings: { workspaceMode: "generic", workspaceName: "My KB", setupComplete: true },
  });
  await plugin.loadPluginData();
  assert.equal(plugin.data.version, DATA_VERSION);
  assert.equal(plugin.data.settings.workspaceMode, "generic");
  assert.equal(plugin.data.collections[0]?.title, "Research");
  assert.deepEqual(plugin.data.pinnedPaths, ["Notes/Paper.md"]);
  assert.equal(plugin.savedData.length, 1);
  const saved = plugin.savedData[0] as {
    kind?: string;
    version?: number;
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: { settings?: { workspaceName?: string }; pinnedPaths?: string[] } }>;
  };
  assert.equal(saved.kind, STORE_KIND);
  assert.equal(saved.version, STORE_VERSION);
  assert.equal(saved.activeBaseId, "base-default");
  assert.equal(saved.bases?.[0]?.id, "base-default");
  assert.equal(saved.bases?.[0]?.data?.settings?.workspaceName, "My KB");
  assert.deepEqual(saved.bases?.[0]?.data?.pinnedPaths, ["Notes/Paper.md"]);
});

test("an interim deterministic migrated vault ID rotates once and is persisted", async () => {
  const data = migrateData(null);
  data.settings.workspaceName = "MY MAIN NOTE KB";
  const store = createDefaultStore(data, 100, "vault-migrated-0123456789abcdef");
  const plugin = pluginWith(store);

  const result = await plugin.loadPluginData();

  assert.equal(result.compatible, true);
  assert.equal(result.hasVaultId, true, "the rotated in-memory identity is available to Sync");
  assert.match(plugin.getVaultId(), /^vault-migrated-0123456789abcdef-[a-z0-9]{12,64}$/i);
  assert.notEqual(plugin.getVaultId(), "vault-migrated-0123456789abcdef");
  assert.equal(plugin.savedData.length, 1, "rotation must survive restart and recovery export");
  assert.equal((plugin.savedData[0] as { vaultId?: string }).vaultId, plugin.getVaultId());
});

test("startup atomically rehomes invalid ENT Index data across every base and writes the store once", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const procedure = new TFile("04 Procedures/Procedure - Airway endoscopy.md");
  const active = migrateData(null);
  active.settings.workspaceMode = "ent-clinical";
  active.settings.primaryFolder = "03 Clinical Topics";
  active.portableIndex.groups = [{ id: "legacy-index", title: "Legacy Index", order: 0 }];
  active.portableIndex.subjects = [
    {
      id: "medication-collision",
      title: "Imported topic label",
      groupId: "legacy-index",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
      libraryId: null,
    },
    {
      id: "syndrome-placeholder",
      title: "Portable syndrome",
      groupId: "legacy-index",
      parentId: "medication-collision",
      order: 1,
      indexed: true,
      configuredId: "",
      recordKind: "syndrome",
      libraryId: null,
    },
    {
      id: "topic-child",
      title: "Valid child topic",
      groupId: "legacy-index",
      parentId: "medication-collision",
      order: 2,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
      libraryId: null,
    },
  ];
  active.portableIndex.resolvedPathBySubjectId = { "medication-collision": medication.path };
  const syndromePlaceholder = portablePlaceholderPath("syndrome-placeholder");
  active.manualIndexPaths = [medication.path, syndromePlaceholder];
  active.indexGroupByPath = { [medication.path]: "Legacy Index", [syndromePlaceholder]: "Legacy Index" };
  active.curriculumVisual.parentByPath[portablePlaceholderPath("topic-child")] = medication.path;

  const inactive = migrateData(null);
  inactive.settings.workspaceMode = "ent-clinical";
  inactive.settings.workspaceName = "Archived ENT";
  inactive.settings.primaryFolder = "03 Clinical Topics";
  inactive.portableIndex.groups = [{ id: "procedures", title: "Procedures", order: 0 }];
  inactive.portableIndex.subjects = [{
    id: "legacy-procedure",
    title: "Airway endoscopy",
    groupId: "procedures",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "procedure",
    libraryId: null,
  }];
  inactive.portableIndex.resolvedPathBySubjectId = { "legacy-procedure": procedure.path };
  inactive.manualIndexPaths = [procedure.path];

  const generic = migrateData(null);
  generic.settings.workspaceMode = "generic";
  generic.settings.workspaceName = "Generic research";
  generic.portableIndex.groups = [{ id: "generic", title: "Generic", order: 0 }];
  generic.portableIndex.subjects = [{
    id: "generic-syndrome",
    title: "Generic indexed syndrome",
    groupId: "generic",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "syndrome",
    libraryId: null,
  }];

  const store = createDefaultStore(active, 100, "vault-remediation-test");
  const archivedEntry = createKnowledgeBaseEntry(inactive, "base-archived-ent", 200);
  archivedEntry.archivedAt = 300;
  store.bases.push(archivedEntry, createKnowledgeBaseEntry(generic, "base-generic", 400));
  const { plugin, sourceMutationCount } = pluginWithFiles(store, [medication, procedure], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
    [procedure.path]: { title: "Airway endoscopy" },
  });

  await plugin.loadPluginData();

  assert.equal(plugin.savedData.length, 1, "all bases must be remediated in one store write");
  const medicationSubject = plugin.data.portableIndex.subjects.find((subject) => subject.id === "medication-collision");
  const syndromeSubject = plugin.data.portableIndex.subjects.find((subject) => subject.id === "syndrome-placeholder");
  assert.deepEqual(
    { indexed: medicationSubject?.indexed, kind: medicationSubject?.recordKind, libraryId: medicationSubject?.libraryId },
    { indexed: false, kind: "medication", libraryId: "medication" },
  );
  assert.deepEqual(
    { indexed: syndromeSubject?.indexed, kind: syndromeSubject?.recordKind, libraryId: syndromeSubject?.libraryId },
    { indexed: false, kind: "syndrome", libraryId: "syndrome" },
  );
  assert.deepEqual(plugin.data.manualIndexPaths, []);
  assert.equal(plugin.data.portableIndex.subjects.find((subject) => subject.id === "topic-child")?.parentId, null);
  assert.equal(plugin.data.curriculumVisual.parentByPath[portablePlaceholderPath("topic-child")], null);
  assert.equal(plugin.data.indexGroupByPath[medication.path], undefined);

  const remediatedArchived = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-archived-ent");
  const procedureSubject = remediatedArchived?.data.portableIndex.subjects.find((subject) => subject.id === "legacy-procedure");
  assert.deepEqual(
    { indexed: procedureSubject?.indexed, kind: procedureSubject?.recordKind, libraryId: procedureSubject?.libraryId },
    { indexed: false, kind: "procedure", libraryId: "procedure" },
  );
  assert.deepEqual(remediatedArchived?.data.manualIndexPaths, []);
  const genericSubject = plugin.getKnowledgeBases(true)
    .find((entry) => entry.id === "base-generic")?.data.portableIndex.subjects[0];
  assert.equal(genericSubject?.indexed, true, "Generic knowledge bases remain unrestricted");
  assert.equal(sourceMutationCount(), 0);

  plugin.loadedData = plugin.savedData[0];
  plugin.savedData.length = 0;
  await plugin.loadPluginData();
  assert.equal(plugin.savedData.length, 0, "the remediation is idempotent after its first writeback");
  assert.equal(sourceMutationCount(), 0);
});

test("concurrent flat v10 upgrades rebase repaired provisional identities and converge", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const legacy = invalidEntMedicationIndexData(medication);
  legacy.version = 10;
  const files = [medication];
  const frontmatter = { [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] } };
  const left = pluginWithFiles(structuredClone(legacy), files, frontmatter).plugin;
  const right = pluginWithFiles(structuredClone(legacy), files, frontmatter).plugin;

  await left.loadPluginData();
  await right.loadPluginData();

  const leftStore = left.savedData.at(-1) as PluginStore;
  const rightStore = right.savedData.at(-1) as PluginStore;
  assert.notEqual(leftStore.vaultId, rightStore.vaultId, "each device retains an independent random nonce");
  assert.equal(
    provisionalMigratedVaultFingerprint(leftStore.vaultId),
    provisionalMigratedVaultFingerprint(rightStore.vaultId),
    "the embedded fingerprint must describe the deterministically repaired payload",
  );
  assert.equal(leftStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(leftStore.bases[0]?.data.portableIndex.subjects[0]?.libraryId, "medication");
  const leftFirst = mergeKnowledgeBaseStores(leftStore, rightStore).store;
  const rightFirst = mergeKnowledgeBaseStores(rightStore, leftStore).store;
  assert.deepEqual(leftFirst, rightFirst);
});

test("concurrent v11 identity-less envelope upgrades rebase repaired identities and converge", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  const envelope = createDefaultStore(data, 100, "temporary-vault-id");
  envelope.version = 11;
  const identityLessEnvelope = structuredClone(envelope) as unknown as Record<string, unknown>;
  delete identityLessEnvelope.vaultId;
  const files = [medication];
  const frontmatter = { [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] } };
  const left = pluginWithFiles(structuredClone(identityLessEnvelope), files, frontmatter).plugin;
  const right = pluginWithFiles(structuredClone(identityLessEnvelope), files, frontmatter).plugin;

  await left.loadPluginData();
  await right.loadPluginData();

  const leftStore = left.savedData.at(-1) as PluginStore;
  const rightStore = right.savedData.at(-1) as PluginStore;
  assert.notEqual(leftStore.vaultId, rightStore.vaultId, "each device retains an independent random nonce");
  assert.equal(
    provisionalInterimEnvelopeVaultFingerprint(leftStore.vaultId),
    provisionalInterimEnvelopeVaultFingerprint(rightStore.vaultId),
    "the embedded envelope fingerprint must describe the repaired multi-base payload",
  );
  assert.equal(leftStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(leftStore.bases[0]?.data.portableIndex.subjects[0]?.libraryId, "medication");
  const leftFirst = mergeKnowledgeBaseStores(leftStore, rightStore).store;
  const rightFirst = mergeKnowledgeBaseStores(rightStore, leftStore).store;
  assert.deepEqual(leftFirst, rightFirst);
});

test("flat v10 remediation converges while one device is still missing synced Markdown", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const legacy = invalidEntMedicationIndexData(medication);
  legacy.version = 10;
  const complete = pluginWithFiles(structuredClone(legacy), [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  }).plugin;
  const downloading = pluginWithFiles(structuredClone(legacy), [], {}).plugin;

  await complete.loadPluginData();
  await downloading.loadPluginData();

  const completeStore = complete.savedData.at(-1) as PluginStore;
  const downloadingStore = downloading.savedData.at(-1) as PluginStore;
  assert.equal(completeStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(downloadingStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(
    provisionalMigratedVaultFingerprint(completeStore.vaultId),
    provisionalMigratedVaultFingerprint(downloadingStore.vaultId),
  );
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(completeStore, downloadingStore));
});

test("v11 identity-less remediation converges while one device is still missing synced Markdown", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  const envelope = createDefaultStore(data, 100, "temporary-vault-id");
  envelope.version = 11;
  const identityLess = structuredClone(envelope) as unknown as Record<string, unknown>;
  delete identityLess.vaultId;
  const complete = pluginWithFiles(structuredClone(identityLess), [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  }).plugin;
  const downloading = pluginWithFiles(structuredClone(identityLess), [], {}).plugin;

  await complete.loadPluginData();
  await downloading.loadPluginData();

  const completeStore = complete.savedData.at(-1) as PluginStore;
  const downloadingStore = downloading.savedData.at(-1) as PluginStore;
  assert.equal(completeStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(downloadingStore.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
  assert.equal(
    provisionalInterimEnvelopeVaultFingerprint(completeStore.vaultId),
    provisionalInterimEnvelopeVaultFingerprint(downloadingStore.vaultId),
  );
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(completeStore, downloadingStore));
});

test("flat v10 and v11 identity-less repairs are path-deterministic across incomplete Markdown Sync", async () => {
  for (const format of ["flat-v10", "identity-less-v11"] as const) {
    const fixture = diverseLegacyEntIndexData();
    let input: unknown;
    if (format === "flat-v10") {
      fixture.data.version = 10;
      input = fixture.data;
    } else {
      const envelope = createDefaultStore(fixture.data, 100, "temporary-vault-id");
      envelope.version = 11;
      const identityLess = structuredClone(envelope) as unknown as Record<string, unknown>;
      delete identityLess.vaultId;
      input = identityLess;
    }
    const complete = pluginWithFiles(structuredClone(input), fixture.files, fixture.frontmatter).plugin;
    const downloading = pluginWithFiles(structuredClone(input), [], {}).plugin;

    await complete.loadPluginData();
    await downloading.loadPluginData();

    const completeStore = complete.savedData.at(-1) as PluginStore;
    const downloadingStore = downloading.savedData.at(-1) as PluginStore;
    assert.deepEqual(
      completeStore.bases[0]?.data,
      downloadingStore.bases[0]?.data,
      `${format} repair must ignore transient TFile and metadata-cache availability`,
    );
    const subjects = new Map(completeStore.bases[0]?.data.portableIndex.subjects.map((subject) => [subject.id, subject]));
    for (const kind of ["procedure", "medication", "syndrome"] as const) {
      const subject = subjects.get(kind);
      assert.deepEqual(
        { indexed: subject?.indexed, recordKind: subject?.recordKind, libraryId: subject?.libraryId },
        { indexed: false, recordKind: kind, libraryId: kind },
        `${format} ${kind} path is repaired into its protected Library`,
      );
    }
    assert.deepEqual(
      { indexed: subjects.get("note")?.indexed, recordKind: subjects.get("note")?.recordKind, libraryId: subjects.get("note")?.libraryId },
      { indexed: false, recordKind: "note", libraryId: null },
      `${format} ordinary out-of-root path ignores misleading proposal metadata`,
    );
    assert.equal(subjects.get("topic")?.indexed, true);
    assert.equal(subjects.get("proposal")?.indexed, true);
    assert.equal(subjects.get("topic-placeholder")?.indexed, true);
    assert.deepEqual(
      {
        indexed: subjects.get("medication-placeholder")?.indexed,
        recordKind: subjects.get("medication-placeholder")?.recordKind,
        libraryId: subjects.get("medication-placeholder")?.libraryId,
      },
      { indexed: false, recordKind: "medication", libraryId: "medication" },
    );
    assert.doesNotThrow(() => mergeKnowledgeBaseStores(completeStore, downloadingStore));
  }
});

test("persisted pristine provisional identities survive later deterministic ENT remediation", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  data.version = 10;
  const files = [medication];
  const frontmatter = { [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] } };

  const flatLeft = pluginWithFiles(migrateStore(structuredClone(data), 100), files, frontmatter).plugin;
  const flatRight = pluginWithFiles(migrateStore(structuredClone(data), 100), files, frontmatter).plugin;
  await flatLeft.loadPluginData();
  await flatRight.loadPluginData();
  const flatLeftStore = flatLeft.savedData.at(-1) as PluginStore;
  const flatRightStore = flatRight.savedData.at(-1) as PluginStore;
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(flatLeftStore, flatRightStore));

  const envelope = createDefaultStore(invalidEntMedicationIndexData(medication), 100, "temporary-vault-id");
  envelope.version = 11;
  const identityLess = structuredClone(envelope) as unknown as Record<string, unknown>;
  delete identityLess.vaultId;
  const envelopeLeft = pluginWithFiles(migrateStore(structuredClone(identityLess), 100), files, frontmatter).plugin;
  const envelopeRight = pluginWithFiles(migrateStore(structuredClone(identityLess), 100), files, frontmatter).plugin;
  await envelopeLeft.loadPluginData();
  await envelopeRight.loadPluginData();
  const envelopeLeftStore = envelopeLeft.savedData.at(-1) as PluginStore;
  const envelopeRightStore = envelopeRight.savedData.at(-1) as PluginStore;
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(envelopeLeftStore, envelopeRightStore));
});

test("Undo repairs a historical ENT snapshot before persisting it", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = invalidEntMedicationIndexData(medication);
  data.undoStack = [snapshotPersonal(data, "Pre-invariant layout", false, true)];
  const { plugin } = pluginWithFiles(data, [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  await plugin.undo();

  const subject = plugin.data.portableIndex.subjects.find((candidate) => candidate.id === "legacy-medication");
  assert.deepEqual(
    { indexed: subject?.indexed, kind: subject?.recordKind, libraryId: subject?.libraryId },
    { indexed: false, kind: "medication", libraryId: "medication" },
  );
  assert.deepEqual(plugin.data.manualIndexPaths, []);
  assert.equal(plugin.savedData.length, 1);
  const persisted = plugin.savedData[0] as PluginStore;
  assert.equal(persisted.bases[0]?.data.portableIndex.subjects[0]?.indexed, false);
});

test("organization snapshot restoration repairs historical ENT Index membership atomically", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const invalid = invalidEntMedicationIndexData(medication);
  const historical = snapshotPersonal(invalid, "Pre-invariant layout", false, true);
  const current = structuredClone(invalid);
  const subject = current.portableIndex.subjects[0];
  assert.ok(subject);
  subject.indexed = false;
  subject.recordKind = "medication";
  subject.libraryId = "medication";
  current.manualIndexPaths = [];
  current.indexGroupByPath = {};
  const { plugin } = pluginWithFiles(createDefaultStore(current, 100, "vault-snapshot-repair"), [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  await plugin.mutate(
    "Restore historical snapshot",
    () => restoreSnapshot(plugin.data, historical),
    {
      includePortableIndex: true,
      requireUndo: true,
      normalizeAfterRestore: true,
    },
  );

  const restored = plugin.data.portableIndex.subjects.find((candidate) => candidate.id === "legacy-medication");
  assert.equal(restored?.indexed, false);
  assert.equal(restored?.recordKind, "medication");
  assert.equal(restored?.libraryId, "medication");
  assert.deepEqual(plugin.data.manualIndexPaths, []);
  assert.equal(plugin.savedData.length, 1);
});

test("Undo normalizes built-in Libraries and stale navigation from a legacy ENT snapshot", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.undoStack = [legacyEntSnapshotWithoutLibraries("Legacy Undo")];
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-legacy-undo-libraries"));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  await plugin.undo();

  assertEntLibrariesAndNavigationAreNormalized(plugin.data);
  assert.equal(plugin.savedData.length, 1);
});

test("named snapshot restoration normalizes legacy ENT Libraries and navigation", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-legacy-named-libraries"));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const snapshot = legacyEntSnapshotWithoutLibraries("Legacy named snapshot");

  await plugin.mutate(
    "Restore legacy named snapshot",
    () => restoreSnapshot(plugin.data, snapshot),
    { includeSettings: true, includePortableIndex: true, includeActiveTab: true, normalizeAfterRestore: true },
  );

  assertEntLibrariesAndNavigationAreNormalized(plugin.data);
  assert.equal(plugin.savedData.length, 1);
});

test("failed named-snapshot restoration rolls back settings, navigation, snapshots, and portable data", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.workspaceName = "Current ENT";
  data.activeTab = "collections";
  data.layoutSnapshots = [snapshotPersonal(data, "Current named snapshot", true, true, false, true)];
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-snapshot-rollback"));
  await plugin.loadPluginData();
  const before = structuredClone(plugin.data);
  const snapshot = legacyEntSnapshotWithoutLibraries("Legacy named snapshot");
  let saveAttempts = 0;
  plugin.saveData = async (): Promise<void> => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated snapshot save failure");
  };

  await assert.rejects(plugin.mutate(
    "Restore legacy named snapshot",
    () => restoreSnapshot(plugin.data, snapshot),
    {
      includeSettings: Boolean(snapshot.settings),
      includePortableIndex: Boolean(snapshot.portableIndex),
      includeLayoutSnapshots: Boolean(snapshot.layoutSnapshots),
      includeActiveTab: snapshot.activeTab !== undefined,
      requireUndo: true,
      normalizeAfterRestore: true,
    },
  ), /simulated snapshot save failure/i);

  assert.deepEqual(plugin.data, before);
  assert.equal(saveAttempts, 2, "the failed write is followed by one persisted full-data rollback");
});

test("recovery restoration normalizes legacy empty ENT Libraries and navigation", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const plugin = pluginWith(createDefaultStore(data, 100, "vault-legacy-recovery-libraries"));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const recovery = legacyEntSnapshotWithoutLibraries("Legacy recovery");

  await plugin.mutate("Import legacy organization recovery", () => {
    plugin.data.settings = structuredClone(recovery.settings ?? plugin.data.settings);
    plugin.data.activeTab = recovery.activeTab ?? plugin.data.activeTab;
    plugin.data.savedViews = recovery.savedViews.map((view) => ({ ...view }));
    plugin.data.portableIndex = structuredClone(recovery.portableIndex ?? plugin.data.portableIndex);
  }, {
    includeSettings: true,
    includePortableIndex: true,
    includeLayoutSnapshots: true,
    includeActiveTab: true,
    requireUndo: true,
    normalizeAfterRestore: true,
  });

  assertEntLibrariesAndNavigationAreNormalized(plugin.data);
  assert.equal(plugin.savedData.length, 1);
});

test("a failed ENT startup remediation write restores the complete pre-remediation store", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.portableIndex.groups = [{ id: "legacy", title: "Legacy", order: 0 }];
  data.portableIndex.subjects = [{
    id: "legacy-medication",
    title: "Allergodil",
    groupId: "legacy",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "medication",
    libraryId: null,
  }];
  data.portableIndex.resolvedPathBySubjectId = { "legacy-medication": medication.path };
  const { plugin, sourceMutationCount } = pluginWithFiles(
    createDefaultStore(data, 100, "vault-remediation-failure"),
    [medication],
    { [medication.path]: { title: "Allergodil" } },
  );
  let saveAttempts = 0;
  plugin.saveData = async (): Promise<void> => {
    saveAttempts += 1;
    throw new Error("disk full");
  };

  await assert.rejects(plugin.loadPluginData(), /disk full/i);

  const restored = plugin.data.portableIndex.subjects.find((subject) => subject.id === "legacy-medication");
  assert.equal(saveAttempts, 1);
  assert.equal(restored?.indexed, true);
  assert.equal(restored?.recordKind, "medication");
  assert.equal(restored?.libraryId, undefined);
  assert.equal(sourceMutationCount(), 0);
});

test("unrecognized versionless data enters read-only mode and is never overwritten", async () => {
  Notice.messages.length = 0;
  const original = { unrelatedApplicationState: { keep: true } };
  const plugin = pluginWith(original);
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /unrecognized shape/i);
  assert.equal(plugin.savedData.length, 0);
  assert.equal(Notice.messages.some((message) => /read-only/i.test(message)), true);
  await plugin.savePluginData();
  assert.equal(plugin.savedData.length, 0);
});

test("future data versions enter read-only mode rather than being downgraded", async () => {
  const plugin = pluginWith({ version: 99, collections: [], settings: { workspaceMode: "generic" } });
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.equal(plugin.savedData.length, 0);
});

test("archiving the active knowledge base switches atomically and never archives the last available base", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  assert.equal(plugin.savedData.length, 0, "a current v11 store should not be rewritten during load");

  await plugin.archiveKnowledgeBase("base-default");
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(plugin.data.settings.workspaceName, "Second KB");
  assert.notEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.archivedAt, null);
  assert.deepEqual(plugin.getKnowledgeBases().map((entry) => entry.id), ["base-second"]);

  const savesAfterArchive = plugin.savedData.length;
  await assert.rejects(plugin.archiveKnowledgeBase("base-second"), /last one/i);
  assert.equal(plugin.savedData.length, savesAfterArchive, "a rejected last-base archive must not write data");
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");

  await plugin.restoreKnowledgeBase("base-default");
  await plugin.switchKnowledgeBase("base-default");
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.settings.workspaceName, "First KB");
});

test("permanent deletion accepts only an unchanged archived base and never touches Markdown", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "Keep available";
  const second = migrateData(null);
  second.settings.workspaceName = "Delete archived";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const { plugin, sourceMutationCount, vaultEnumerationCount } = pluginWithFiles(store, [], {});
  await plugin.loadPluginData();

  await assert.rejects(
    plugin.deleteArchivedKnowledgeBase("base-default", plugin.getActiveKnowledgeBase().updatedAt),
    /active knowledge base cannot be permanently deleted/i,
  );
  await assert.rejects(
    plugin.deleteArchivedKnowledgeBase("base-second", plugin.getKnowledgeBases(true)[1]?.updatedAt ?? 0),
    /archive this knowledge base/i,
  );

  await plugin.archiveKnowledgeBase("base-second");
  const archived = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-second");
  assert.ok(archived);
  await assert.rejects(
    plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt - 1),
    /changed after the confirmation opened/i,
  );
  await plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt);

  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.id), ["base-default"]);
  const saved = plugin.savedData.at(-1) as { deletedBaseIds?: Record<string, number> };
  assert.ok((saved.deletedBaseIds?.[archived.id] ?? 0) > archived.updatedAt);
  assert.equal(plugin.getKnowledgeBases().length, 1);
  assert.equal(sourceMutationCount(), 0);
  assert.equal(vaultEnumerationCount(), 0);
});

test("deleting an archived base frees one of the fifty lifecycle slots", async () => {
  const active = migrateData(null);
  active.settings.workspaceName = "Active";
  const store = createDefaultStore(active, 100);
  for (let index = 1; index < MAX_KNOWLEDGE_BASES; index += 1) {
    const data = migrateData(null);
    data.settings.workspaceName = `Archived ${index}`;
    const entry = createKnowledgeBaseEntry(data, `base-archived-${index}`, 100 + index);
    entry.archivedAt = 1_000 + index;
    entry.updatedAt = entry.archivedAt;
    store.bases.push(entry);
  }
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  await assert.rejects(
    plugin.createKnowledgeBase("Over capacity", "generic", "Knowledge Bases/Over capacity"),
    /maximum of 50 knowledge bases/i,
  );

  const archived = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-archived-1");
  assert.ok(archived);
  await plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt);
  const created = await plugin.createKnowledgeBase("Replacement", "generic", "Knowledge Bases/Replacement");

  assert.equal(plugin.getKnowledgeBases(true).length, MAX_KNOWLEDGE_BASES);
  assert.equal(plugin.getActiveKnowledgeBaseId(), created.id);
  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.id === archived.id), false);
  const saved = plugin.savedData.at(-1) as { deletedBaseIds?: Record<string, number> };
  assert.ok(saved.deletedBaseIds?.[archived.id]);
});

test("a failed archived-base deletion save restores both the base and its tombstone state", async () => {
  const first = migrateData(null);
  const second = migrateData(null);
  const store = createDefaultStore(first, 100);
  const archived = createKnowledgeBaseEntry(second, "base-archived", 200);
  archived.archivedAt = 300;
  archived.updatedAt = 300;
  store.bases.push(archived);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.saveData = () => Promise.reject(new Error("simulated deletion save failure"));

  await assert.rejects(plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt), /simulated deletion save failure/i);

  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.id === archived.id), true);
  const currentStore = (plugin as unknown as { store: { deletedBaseIds: Record<string, number> } }).store;
  assert.equal(currentStore.deletedBaseIds[archived.id], undefined);
});

test("permanent deletion refuses to evict an older tombstone when its safety map is full", async () => {
  const store = createDefaultStore(migrateData(null), 100);
  const archived = createKnowledgeBaseEntry(migrateData(null), "base-archived", 200);
  archived.archivedAt = 300;
  archived.updatedAt = 300;
  store.bases.push(archived);
  store.deletedBaseIds = Object.fromEntries(Array.from(
    { length: MAX_DELETED_KNOWLEDGE_BASE_IDS },
    (_, index) => [`base-already-deleted-${index}`, index + 1],
  ));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();

  await assert.rejects(
    plugin.deleteArchivedKnowledgeBase(archived.id, archived.updatedAt),
    /already contains 10,000 permanent-deletion tombstones.*no older tombstone was discarded/i,
  );

  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.id === archived.id), true);
});

test("failed knowledge-base switching and creation restore the active base and base list", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  let saveAttempts = 0;
  plugin.saveData = () => {
    saveAttempts += 1;
    return Promise.reject(new Error("simulated knowledge-base save failure"));
  };

  await assert.rejects(plugin.switchKnowledgeBase("base-second"), /simulated knowledge-base save failure/);
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.settings.workspaceName, "First KB");
  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.id), ["base-default", "base-second"]);

  await assert.rejects(
    plugin.createKnowledgeBase("Unsaved KB", "generic", "Knowledge Base"),
    /simulated knowledge-base save failure/,
  );
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.settings.workspaceName, "First KB");
  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.id), ["base-default", "base-second"]);
  assert.equal(plugin.getKnowledgeBases(true).some((entry) => entry.data.settings.workspaceName === "Unsaved KB"), false);
  assert.equal(saveAttempts, 2);
});

test("queued saves retain their call-time base snapshot while a knowledge-base switch waits", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  const firstSaveStarted = deferred();
  const releaseFirstSave = deferred();
  const secondSaveStarted = deferred();
  const releaseSecondSave = deferred();
  const snapshots: Array<{
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: { settings?: { workspaceName?: string } } }>;
  }> = [];
  let saveCall = 0;
  plugin.saveData = async (value: unknown) => {
    snapshots.push(structuredClone(value) as (typeof snapshots)[number]);
    const call = saveCall;
    saveCall += 1;
    if (call === 0) {
      firstSaveStarted.resolve();
      await releaseFirstSave.promise;
      return;
    }
    if (call === 1) {
      secondSaveStarted.resolve();
      await releaseSecondSave.promise;
      return;
    }
    throw new Error("Unexpected extra save");
  };

  plugin.data.settings.workspaceName = "First snapshot";
  const pendingSave = plugin.savePluginData();
  await firstSaveStarted.promise;
  plugin.data.settings.workspaceName = "First changed after save call";
  const pendingSwitch = plugin.switchKnowledgeBase("base-second");

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default", "the switch must wait for the active adapter write");
  assert.equal(snapshots[0]?.activeBaseId, "base-default");
  assert.equal(snapshots[0]?.bases?.find((entry) => entry.id === "base-default")?.data?.settings?.workspaceName, "First snapshot");

  releaseFirstSave.resolve();
  await pendingSave;
  await secondSaveStarted.promise;
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(snapshots[1]?.activeBaseId, "base-second");
  assert.equal(
    snapshots[1]?.bases?.find((entry) => entry.id === "base-default")?.data?.settings?.workspaceName,
    "First changed after save call",
  );
  assert.equal(snapshots[1]?.bases?.find((entry) => entry.id === "base-second")?.data?.settings?.workspaceName, "Second KB");

  releaseSecondSave.resolve();
  await pendingSwitch;
  assert.equal(saveCall, 2);
});

test("switching bases does not manufacture a newer payload timestamp", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "ENT";
  const second = migrateData(null);
  second.settings.workspaceName = "Research";
  const store = createDefaultStore(first, 100, "vault-sync-test");
  const secondEntry = createKnowledgeBaseEntry(second, "base-second", 200);
  store.bases.push(secondEntry);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();

  await plugin.switchKnowledgeBase("base-second");

  assert.equal(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.updatedAt, 100);
  assert.equal(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-second")?.updatedAt, 200);
});

test("a valid flat v10 Sync capture recovers startup without a trusted baseline and writes once", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceMode = "generic";
  legacy.settings.workspaceName = "Recovered knowledge base";
  legacy.pinnedPaths = ["Knowledge Base/Recovered.md"];
  const plugin = pluginWith(null);
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(legacy);
  };

  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);
  diskReadable = true;
  await plugin.onExternalSettingsChange();

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.data.settings.workspaceName, "Recovered knowledge base");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Recovered.md"]);
  assert.equal(plugin.savedData.length, 1, "migration and identity recovery share one writeback");
  assert.match((plugin.savedData[0] as PluginStore).vaultId, /^vault-migrated-[0-9a-f]{16}-[a-z0-9]{12,64}$/i);
});

test("two no-baseline devices recovering the same flat v10 payload retain provisional convergence", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const legacy = invalidEntMedicationIndexData(medication);
  legacy.version = 10;
  const frontmatter = { [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] } };
  const recover = async (): Promise<PluginStore> => {
    const plugin = pluginWithFiles(null, [medication], frontmatter).plugin;
    let diskReadable = false;
    plugin.loadData = async (): Promise<unknown> => {
      if (!diskReadable) throw new SyntaxError("transient partial JSON");
      return structuredClone(legacy);
    };
    await plugin.loadPluginData();
    diskReadable = true;
    await plugin.onExternalSettingsChange();
    assert.equal(plugin.dataCompatibilityWarning, "");
    assert.equal(plugin.savedData.length, 1);
    return plugin.savedData[0] as PluginStore;
  };

  const left = await recover();
  const right = await recover();

  assert.equal(
    provisionalMigratedVaultFingerprint(left.vaultId),
    provisionalMigratedVaultFingerprint(right.vaultId),
  );
  assert.doesNotThrow(() => mergeKnowledgeBaseStores(left, right));
});

test("duplicate flat v10 callbacks during no-baseline recovery converge into one writeback", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceName = "Recovered once";
  const plugin = pluginWith(null);
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(legacy);
  };
  await plugin.loadPluginData();
  diskReadable = true;

  const first = plugin.onExternalSettingsChange();
  const duplicate = plugin.onExternalSettingsChange();
  await Promise.all([first, duplicate]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.data.settings.workspaceName, "Recovered once");
  assert.equal(plugin.savedData.length, 1);
});

test("a duplicate flat v10 callback arriving during no-baseline writeback is retried safely", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceName = "Recovered during writeback";
  const plugin = pluginWith(null);
  let disk: unknown = legacy;
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(disk);
  };
  await plugin.loadPluginData();
  diskReadable = true;
  const writebackStarted = deferred();
  const releaseWriteback = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown): Promise<void> => {
    saveCalls += 1;
    if (saveCalls === 1) {
      writebackStarted.resolve();
      await releaseWriteback.promise;
    }
    disk = structuredClone(value);
  };

  const first = plugin.onExternalSettingsChange();
  await writebackStarted.promise;
  const duplicate = plugin.onExternalSettingsChange();
  releaseWriteback.resolve();
  await Promise.all([first, duplicate]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.data.settings.workspaceName, "Recovered during writeback");
  assert.equal((disk as PluginStore).kind, STORE_KIND);
  assert.equal(saveCalls, 2, "the superseded first write is followed by one authoritative migrated writeback");
});

test("an identified envelope supersedes provisional legacy recovery when it arrives during writeback", async () => {
  const legacy = migrateData(null);
  legacy.version = 10;
  legacy.settings.workspaceName = "Provisional legacy";
  const authoritativeData = migrateData(null);
  authoritativeData.settings.workspaceName = "Authoritative current store";
  authoritativeData.pinnedPaths = ["Knowledge Base/Authoritative.md"];
  const authoritative = createDefaultStore(authoritativeData, 500, "vault-authoritative-current");
  const plugin = pluginWith(null);
  let disk: unknown = legacy;
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(disk);
  };
  await plugin.loadPluginData();
  diskReadable = true;
  const writebackStarted = deferred();
  const releaseWriteback = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown): Promise<void> => {
    saveCalls += 1;
    if (saveCalls === 1) {
      writebackStarted.resolve();
      await releaseWriteback.promise;
    }
    disk = structuredClone(value);
  };

  const legacyReload = plugin.onExternalSettingsChange();
  await writebackStarted.promise;
  disk = structuredClone(authoritative);
  const authoritativeReload = plugin.onExternalSettingsChange();
  releaseWriteback.resolve();
  await Promise.all([legacyReload, authoritativeReload]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), "vault-authoritative-current");
  assert.equal(plugin.data.settings.workspaceName, "Authoritative current store");
  assert.deepEqual(plugin.data.pinnedPaths, ["Knowledge Base/Authoritative.md"]);
  assert.equal((disk as PluginStore).vaultId, "vault-authoritative-current");
  assert.equal((disk as PluginStore).bases[0]?.data.settings.workspaceName, "Authoritative current store");
  assert.equal(saveCalls, 2, "the stale provisional write is replaced by one authoritative envelope writeback");
});

test("an identified envelope supersedes identity-less v11 recovery when it arrives during writeback", async () => {
  const provisionalData = migrateData(null);
  provisionalData.settings.workspaceName = "Identity-less v11";
  const provisionalEnvelope = createDefaultStore(provisionalData, 100, "temporary-vault-id");
  provisionalEnvelope.version = 11;
  const identityLess = structuredClone(provisionalEnvelope) as unknown as Record<string, unknown>;
  delete identityLess.vaultId;
  const authoritativeData = migrateData(null);
  authoritativeData.settings.workspaceName = "Authoritative after v11";
  const authoritative = createDefaultStore(authoritativeData, 500, "vault-authoritative-after-v11");
  const plugin = pluginWith(null);
  let disk: unknown = identityLess;
  let diskReadable = false;
  plugin.loadData = async (): Promise<unknown> => {
    if (!diskReadable) throw new SyntaxError("transient partial JSON");
    return structuredClone(disk);
  };
  await plugin.loadPluginData();
  diskReadable = true;
  const writebackStarted = deferred();
  const releaseWriteback = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown): Promise<void> => {
    saveCalls += 1;
    if (saveCalls === 1) {
      writebackStarted.resolve();
      await releaseWriteback.promise;
    }
    disk = structuredClone(value);
  };

  const provisionalReload = plugin.onExternalSettingsChange();
  await writebackStarted.promise;
  disk = structuredClone(authoritative);
  const authoritativeReload = plugin.onExternalSettingsChange();
  releaseWriteback.resolve();
  await Promise.all([provisionalReload, authoritativeReload]);

  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(plugin.getVaultId(), "vault-authoritative-after-v11");
  assert.equal(plugin.data.settings.workspaceName, "Authoritative after v11");
  assert.equal((disk as PluginStore).vaultId, "vault-authoritative-after-v11");
  assert.equal(saveCalls, 2);
});

test("external Sync merges disjoint base edits and preserves this device's active base", async () => {
  const ent = migrateData(null);
  ent.settings.workspaceName = "ENT";
  const research = migrateData(null);
  research.settings.workspaceName = "Research";
  const original = createDefaultStore(ent, 100, "vault-sync-test");
  original.bases.push(createKnowledgeBaseEntry(research, "base-research", 100));
  const plugin = pluginWith(structuredClone(original));
  await plugin.loadPluginData();
  const epochBeforeSync = plugin.getDataEpoch();
  plugin.savedData.length = 0;

  const localEnt = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default");
  assert.ok(localEnt);
  localEnt.data.pinnedPaths = ["ENT/Airway.md"];
  localEnt.updatedAt = 300;
  await plugin.savePluginData();
  plugin.savedData.length = 0;
  const incoming = structuredClone(original);
  incoming.activeBaseId = "base-research";
  const incomingResearch = incoming.bases.find((entry) => entry.id === "base-research");
  assert.ok(incomingResearch);
  incomingResearch.data.pinnedPaths = ["Research/Paper.md"];
  incomingResearch.updatedAt = 400;
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.ok(plugin.getDataEpoch() > epochBeforeSync, "same-ID Sync replacement advances the data generation");
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.data.pinnedPaths, ["ENT/Airway.md"]);
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-research")?.data.pinnedPaths, ["Research/Paper.md"]);
  assert.equal(plugin.savedData.length, 1, "the merged envelope is written back so other devices converge");
});

test("external Sync remediates an invalid ENT Index payload and writes the corrected envelope once", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const localData = migrateData(null);
  localData.settings.workspaceMode = "ent-clinical";
  const local = createDefaultStore(localData, 100, "vault-sync-remediation");
  const { plugin, sourceMutationCount } = pluginWithFiles(local, [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const incoming = structuredClone(local);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  incomingBase.updatedAt = 200;
  incomingBase.data.portableIndex.groups = [{ id: "remote-index", title: "Remote Index", order: 0 }];
  incomingBase.data.portableIndex.subjects = [{
    id: "remote-medication",
    title: "Remote topic label",
    groupId: "remote-index",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
    libraryId: null,
  }];
  incomingBase.data.portableIndex.resolvedPathBySubjectId = { "remote-medication": medication.path };
  incomingBase.data.manualIndexPaths = [medication.path];
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  const subject = plugin.data.portableIndex.subjects.find((candidate) => candidate.id === "remote-medication");
  assert.deepEqual(
    { indexed: subject?.indexed, kind: subject?.recordKind, libraryId: subject?.libraryId },
    { indexed: false, kind: "medication", libraryId: "medication" },
  );
  assert.deepEqual(plugin.data.manualIndexPaths, []);
  assert.equal(plugin.getActiveKnowledgeBase().updatedAt, 200, "repair must not manufacture a newer LWW timestamp");
  assert.equal(plugin.savedData.length, 1, "the corrected merged store is written back exactly once");
  const persisted = plugin.savedData[0] as typeof incoming;
  const persistedSubject = persisted.bases[0]?.data.portableIndex.subjects.find((candidate) => candidate.id === "remote-medication");
  assert.equal(persistedSubject?.indexed, false);
  assert.equal(persistedSubject?.libraryId, "medication");
  assert.equal(sourceMutationCount(), 0);
});

test("external Sync captures a newer payload before an in-flight local save can overwrite it", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initial = migrateData(null);
  initial.settings.workspaceName = "Sync race";
  let disk = createDefaultStore(initial, 100, "vault-sync-race");
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const saveStarted = deferred();
  const releaseSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      saveStarted.resolve();
      await releaseSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const pendingMutation = plugin.mutate("Overlapping local pin", () => {
    plugin.data.pinnedPaths = ["Local.md"];
  });
  await saveStarted.promise;
  const localTimestamp = plugin.getKnowledgeBases(true)[0]?.updatedAt ?? 0;
  const incoming = structuredClone(disk);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  incomingBase.data.nextStudyPaths = ["Remote.md"];
  incomingBase.updatedAt = localTimestamp - 1;
  disk = incoming;

  const pendingReload = plugin.onExternalSettingsChange();
  releaseSave.resolve();

  await assert.rejects(pendingMutation, /Sync while this edit was saving|synced copy is being reloaded/i);
  await pendingReload;

  assert.deepEqual(plugin.data.pinnedPaths, [], "the overlapping local edit is rolled back instead of silently winning");
  assert.deepEqual(plugin.data.nextStudyPaths, ["Remote.md"], "the captured newer Sync edit survives in memory");
  const persistedBase = disk.bases.find((entry) => entry.id === disk.activeBaseId);
  assert.deepEqual(persistedBase?.data.pinnedPaths, []);
  assert.deepEqual(persistedBase?.data.nextStudyPaths, ["Remote.md"], "the captured Sync edit is written back after the stale local save settles");
  assert.equal(persistedBase?.updatedAt, incomingBase.updatedAt, "rollback bookkeeping must not outrank the captured remote edit");
  assert.equal(plugin.dataCompatibilityWarning, "");
  assert.equal(saveCalls, 2, "one stale local write is followed by one authoritative merged writeback");
});

test("external Sync discards rejected direct and queued saves by merging from the committed baseline", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initial = migrateData(null);
  initial.settings.workspaceName = "Direct save race";
  let disk = createDefaultStore(initial, 100, "vault-direct-sync-race");
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const saveStarted = deferred();
  const releaseSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      saveStarted.resolve();
      await releaseSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  plugin.data.selectedPath = "Local-A.md";
  const firstLocalSave = plugin.savePluginData();
  await saveStarted.promise;
  plugin.data.pinnedPaths = ["Local-B.md"];
  const secondLocalSave = plugin.savePluginData();
  const interruptedTimestamp = plugin.getKnowledgeBases(true)[0]?.updatedAt ?? 0;

  const incoming = structuredClone(disk);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  incomingBase.data.nextStudyPaths = ["Remote.md"];
  incomingBase.updatedAt = interruptedTimestamp - 1;
  disk = incoming;

  const pendingReload = plugin.onExternalSettingsChange();
  releaseSave.resolve();
  const localResults = await Promise.allSettled([firstLocalSave, secondLocalSave]);
  await pendingReload;

  assert.equal(localResults.every((result) => result.status === "rejected"), true);
  assert.equal(plugin.data.selectedPath, "", "the rejected direct selection save is not treated as committed state");
  assert.deepEqual(plugin.data.pinnedPaths, [], "the rejected queued pin save is not treated as committed state");
  assert.deepEqual(plugin.data.nextStudyPaths, ["Remote.md"]);
  const persistedBase = disk.bases.find((entry) => entry.id === disk.activeBaseId);
  assert.equal(persistedBase?.data.selectedPath, "");
  assert.deepEqual(persistedBase?.data.pinnedPaths, []);
  assert.deepEqual(persistedBase?.data.nextStudyPaths, ["Remote.md"]);
  assert.equal(persistedBase?.updatedAt, incomingBase.updatedAt);
  assert.equal(saveCalls, 2, "the queued stale save aborts before the adapter and one authoritative writeback follows");
  assert.equal(plugin.dataCompatibilityWarning, "");
});

test("external Sync preserves the committed active base when an overlapping switch is rejected", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const first = migrateData(null);
  first.settings.workspaceName = "Committed base";
  const second = migrateData(null);
  second.settings.workspaceName = "Rejected target";
  let disk = createDefaultStore(first, 100, "vault-active-switch-sync-race");
  disk.bases.push(createKnowledgeBaseEntry(second, "base-second", 100));
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const switchSaveStarted = deferred();
  const releaseSwitchSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      switchSaveStarted.resolve();
      await releaseSwitchSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const pendingSwitch = plugin.switchKnowledgeBase("base-second");
  await switchSaveStarted.promise;
  const incoming = structuredClone(disk);
  const incomingCommitted = incoming.bases.find((entry) => entry.id === "base-default");
  assert.ok(incomingCommitted);
  incomingCommitted.data.nextStudyPaths = ["Remote.md"];
  incomingCommitted.updatedAt = 1_000;
  disk = incoming;

  const pendingReload = plugin.onExternalSettingsChange();
  releaseSwitchSave.resolve();
  await assert.rejects(pendingSwitch, /Sync while this edit was saving/i);
  await pendingReload;

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(disk.activeBaseId, "base-default");
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.data.nextStudyPaths, ["Remote.md"]);
  assert.equal(saveCalls, 2, "the stale switch write is followed by one authoritative writeback");
});

test("external Sync resolves every queued capture before starting one authoritative writeback", async () => {
  const localPrimary = migrateData(null);
  localPrimary.settings.workspaceName = "Local primary";
  localPrimary.pinnedPaths = ["Local.md"];
  const localSecondary = migrateData(null);
  localSecondary.settings.workspaceName = "Shared secondary";
  const local = createDefaultStore(localPrimary, 300, "vault-capture-batch");
  local.bases.push(createKnowledgeBaseEntry(localSecondary, "base-secondary", 100));
  const plugin = pluginWith(structuredClone(local));
  await plugin.loadPluginData(false);

  const incomingA = structuredClone(local);
  const incomingAPrimary = incomingA.bases.find((entry) => entry.id === "base-default");
  const incomingASecondary = incomingA.bases.find((entry) => entry.id === "base-secondary");
  assert.ok(incomingAPrimary && incomingASecondary);
  incomingAPrimary.data.pinnedPaths = [];
  incomingAPrimary.updatedAt = 100;
  incomingASecondary.data.nextStudyPaths = ["A.md"];
  incomingASecondary.updatedAt = 400;
  const incomingB = structuredClone(incomingA);
  const incomingBSecondary = incomingB.bases.find((entry) => entry.id === "base-secondary");
  assert.ok(incomingBSecondary);
  incomingBSecondary.data.nextStudyPaths = ["B.md"];
  incomingBSecondary.updatedAt = 500;

  const releaseSecondRead = deferred();
  let readCalls = 0;
  plugin.loadData = async () => {
    readCalls += 1;
    if (readCalls === 1) return structuredClone(incomingA);
    await releaseSecondRead.promise;
    return structuredClone(incomingB);
  };
  let disk = structuredClone(incomingB);
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    disk = structuredClone(value) as typeof disk;
  };

  const firstReload = plugin.onExternalSettingsChange();
  const secondReload = plugin.onExternalSettingsChange();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(saveCalls, 0, "capture A must not write while capture B is unresolved");
  releaseSecondRead.resolve();
  await Promise.all([firstReload, secondReload]);

  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.data.pinnedPaths, ["Local.md"]);
  assert.deepEqual(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-secondary")?.data.nextStudyPaths, ["B.md"]);
  assert.deepEqual(disk.bases.find((entry) => entry.id === "base-default")?.data.pinnedPaths, ["Local.md"]);
  assert.deepEqual(disk.bases.find((entry) => entry.id === "base-secondary")?.data.nextStudyPaths, ["B.md"]);
  assert.equal(saveCalls, 1);
});

test("external Sync starts a fresh worker for a callback during worker finalization", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initial = createDefaultStore(migrateData(null), 100, "vault-finalize-gap");
  let disk = structuredClone(initial);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  plugin.saveData = async (value: unknown) => {
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const incomingA = structuredClone(initial);
  const incomingABase = incomingA.bases[0];
  assert.ok(incomingABase);
  incomingABase.data.nextStudyPaths = ["A.md"];
  incomingABase.updatedAt = 200;
  disk = incomingA;

  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  let refreshCalls = 0;
  plugin.refreshViews = async () => {
    refreshCalls += 1;
    if (refreshCalls === 1) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
    }
  };

  const firstReload = plugin.onExternalSettingsChange();
  await refreshStarted.promise;

  const incomingB = structuredClone(incomingA);
  const incomingBBase = incomingB.bases[0];
  assert.ok(incomingBBase);
  incomingBBase.data.nextStudyPaths = ["B.md"];
  incomingBBase.updatedAt = 300;
  disk = incomingB;

  const secondReload: { current: Promise<void> | null } = { current: null };
  const secondScheduled = deferred();
  releaseRefresh.resolve();
  // The two microtasks place this callback after refreshViews resolves and the
  // first worker runs its cleanup, but before a separately chained promise
  // finalizer could clear the worker pointer. Cleanup and pointer release must
  // therefore be atomic inside the worker itself.
  queueMicrotask(() => queueMicrotask(() => {
    secondReload.current = plugin.onExternalSettingsChange();
    secondScheduled.resolve();
  }));

  await secondScheduled.promise;
  await firstReload;
  assert.ok(secondReload.current);
  await secondReload.current;

  const externalState = plugin as unknown as {
    externalReloadBusy: boolean;
    externalReloadPromise: Promise<void> | null;
    externalReloadCaptures: Array<Promise<unknown>>;
  };
  assert.equal(externalState.externalReloadBusy, false);
  assert.equal(externalState.externalReloadPromise, null);
  assert.equal(externalState.externalReloadCaptures.length, 0);
  assert.deepEqual(plugin.data.nextStudyPaths, ["B.md"]);
  assert.deepEqual(disk.bases[0]?.data.nextStudyPaths, ["B.md"]);
  assert.equal(refreshCalls, 2, "the callback that arrives during finalization starts a second worker");
});

test("external Sync restores a captured future-version file overwritten by an interrupted local save", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const initial = createDefaultStore(migrateData(null), 100, "vault-future-capture");
  let disk: typeof initial = structuredClone(initial);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const saveStarted = deferred();
  const releaseSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      saveStarted.resolve();
      await releaseSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const pendingMutation = plugin.mutate("Interrupted local edit", () => {
    plugin.data.pinnedPaths = ["Local.md"];
  });
  await saveStarted.promise;
  const future = structuredClone(initial);
  future.version = STORE_VERSION + 1;
  const futureBase = future.bases[0];
  assert.ok(futureBase);
  futureBase.updatedAt = (plugin.getKnowledgeBases(true)[0]?.updatedAt ?? 0) + 10_000;
  futureBase.data.nextStudyPaths = ["FUTURE.md"];
  disk = future;

  const pendingReload = plugin.onExternalSettingsChange();
  releaseSave.resolve();
  await assert.rejects(pendingMutation, /Sync while this edit was saving/i);
  await pendingReload;

  assert.equal(disk.version, STORE_VERSION + 1);
  assert.deepEqual(disk.bases[0]?.data.nextStudyPaths, ["FUTURE.md"]);
  assert.deepEqual(plugin.data.pinnedPaths, []);
  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.equal(saveCalls, 2, "the stale local write is followed by exact restoration of the future payload");
});

test("external Sync restores a future capture that arrives during an authoritative writeback", async () => {
  const primary = migrateData(null);
  primary.settings.workspaceName = "Primary";
  primary.pinnedPaths = ["Local.md"];
  const secondary = migrateData(null);
  secondary.settings.workspaceName = "Secondary";
  const local = createDefaultStore(primary, 300, "vault-nested-future");
  local.bases.push(createKnowledgeBaseEntry(secondary, "base-secondary", 100));
  let disk = structuredClone(local);
  const plugin = pluginWith(structuredClone(local));
  plugin.loadData = async () => structuredClone(disk);
  const writebackStarted = deferred();
  const releaseWriteback = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      writebackStarted.resolve();
      await releaseWriteback.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const remote = structuredClone(local);
  const remotePrimary = remote.bases.find((entry) => entry.id === "base-default");
  const remoteSecondary = remote.bases.find((entry) => entry.id === "base-secondary");
  assert.ok(remotePrimary && remoteSecondary);
  remotePrimary.data.pinnedPaths = [];
  remotePrimary.updatedAt = 100;
  remoteSecondary.data.nextStudyPaths = ["REMOTE-1.md"];
  remoteSecondary.updatedAt = 400;
  disk = remote;
  const firstReload = plugin.onExternalSettingsChange();
  await writebackStarted.promise;

  const future = structuredClone(remote);
  future.version = STORE_VERSION + 1;
  const futureSecondary = future.bases.find((entry) => entry.id === "base-secondary");
  assert.ok(futureSecondary);
  futureSecondary.data.nextStudyPaths = ["FUTURE-ONLY.md"];
  futureSecondary.updatedAt = 500;
  disk = future;
  const secondReload = plugin.onExternalSettingsChange();
  releaseWriteback.resolve();
  await Promise.all([firstReload, secondReload]);

  assert.equal(disk.version, STORE_VERSION + 1);
  assert.deepEqual(disk.bases.find((entry) => entry.id === "base-secondary")?.data.nextStudyPaths, ["FUTURE-ONLY.md"]);
  assert.match(plugin.dataCompatibilityWarning, /newer than this build/i);
  assert.equal(saveCalls, 2, "the interrupted v13 writeback is followed by exact v14 restoration");
});

test("a valid identified Sync capture recovers after a transient startup data read failure", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async (): Promise<unknown> => { throw new Error("transient partial data.json"); };
  await plugin.loadPluginData(false);
  assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);

  const recovered = createDefaultStore(migrateData(null), 500, "vault-recovered-after-read-error");
  const recoveredBase = recovered.bases[0];
  assert.ok(recoveredBase);
  recoveredBase.data.nextStudyPaths = ["Recovered.md"];
  plugin.loadData = async () => structuredClone(recovered);

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getVaultId(), "vault-recovered-after-read-error");
  assert.deepEqual(plugin.data.nextStudyPaths, ["Recovered.md"]);
  assert.equal(plugin.dataCompatibilityWarning, "");
});

test("startup recovery persists rotated identities from current-version external envelopes", async () => {
  for (const rawVaultId of ["", "vault-migrated-0123456789abcdef"]) {
    const app = {
      vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
      workspace: { getLeavesOfType: () => [] },
      metadataCache: { getFileCache: () => null },
      fileManager: {},
    };
    const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
    plugin.loadData = async (): Promise<unknown> => { throw new Error("transient partial data.json"); };
    await plugin.loadPluginData(false);
    assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);

    const incoming = createDefaultStore(migrateData(null), 500, "temporary-vault-id");
    incoming.vaultId = rawVaultId;
    let disk = structuredClone(incoming);
    let saveCalls = 0;
    plugin.loadData = async () => structuredClone(disk);
    plugin.saveData = async (value: unknown) => {
      saveCalls += 1;
      disk = structuredClone(value) as typeof disk;
    };

    await plugin.onExternalSettingsChange();

    assert.notEqual(plugin.getVaultId(), rawVaultId);
    assert.ok(plugin.getVaultId());
    assert.equal(disk.vaultId, plugin.getVaultId());
    assert.equal(saveCalls, 1, "identity rotation must be persisted exactly once");
    assert.equal(plugin.dataCompatibilityWarning, "");
  }
});

test("external Sync falls back only when this device's active base was archived", async () => {
  const ent = migrateData(null);
  ent.settings.workspaceName = "ENT";
  const research = migrateData(null);
  research.settings.workspaceName = "Research";
  const original = createDefaultStore(ent, 100, "vault-sync-test");
  original.bases.push(createKnowledgeBaseEntry(research, "base-research", 100));
  const plugin = pluginWith(structuredClone(original));
  await plugin.loadPluginData();
  const incoming = structuredClone(original);
  const archived = incoming.bases.find((entry) => entry.id === "base-default");
  assert.ok(archived);
  archived.archivedAt = 500;
  archived.updatedAt = 500;
  incoming.activeBaseId = "base-research";
  plugin.loadedData = incoming;

  await plugin.onExternalSettingsChange();

  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-research");
  assert.equal(plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default")?.archivedAt, 500);
});

test("a synced legacy single-base payload cannot overwrite a multi-base store", async () => {
  Notice.messages.length = 0;
  const ent = migrateData(null);
  ent.settings.workspaceName = "ENT";
  const research = migrateData(null);
  research.settings.workspaceName = "Research";
  const store = createDefaultStore(ent, 100, "vault-sync-test");
  store.bases.push(createKnowledgeBaseEntry(research, "base-research", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.loadedData = migrateData(null);

  await plugin.onExternalSettingsChange();

  assert.deepEqual(plugin.getKnowledgeBases(true).map((entry) => entry.data.settings.workspaceName), ["ENT", "Research"]);
  assert.match(plugin.dataCompatibilityWarning, /older build without a vault identity/i);
  assert.equal(plugin.savedData.length, 0);
});

test("switching knowledge bases is rejected while a mutate transaction is saving", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  const saveStarted = deferred();
  const releaseSave = deferred();
  plugin.saveData = async () => {
    saveStarted.resolve();
    await releaseSave.promise;
  };

  const pendingMutation = plugin.mutate("Pending organization edit", () => {
    plugin.data.settings.workspaceName = "First KB edited";
  }, { includeSettings: true });
  await saveStarted.promise;

  await assert.rejects(
    plugin.switchKnowledgeBase("base-second"),
    /finish the current organization change before switching/i,
  );
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(plugin.data.settings.workspaceName, "First KB edited");

  releaseSave.resolve();
  await pendingMutation;
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-default");
});

test("mutate rejects without running its action while a base switch is being saved", async () => {
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  const switchSaveStarted = deferred();
  const releaseSwitchSave = deferred();
  plugin.saveData = async () => {
    switchSaveStarted.resolve();
    await releaseSwitchSave.promise;
  };

  const pendingSwitch = plugin.switchKnowledgeBase("base-second");
  await switchSaveStarted.promise;
  let actionRan = false;
  await assert.rejects(
    plugin.mutate("Racing organization edit", () => { actionRan = true; }),
    /finish switching knowledge bases before changing its organization/i,
  );
  assert.equal(actionRan, false);
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
  assert.equal(plugin.data.settings.workspaceName, "Second KB");

  releaseSwitchSave.resolve();
  await pendingSwitch;
  assert.equal(plugin.getActiveKnowledgeBaseId(), "base-second");
});

test("a vault rename waits when external Sync starts in its initial idle yield", async () => {
  const data = migrateData(null);
  data.pinnedPaths = ["Old/Topic.md"];
  const original = createDefaultStore(data, 100, "vault-rename-sync-yield");
  const plugin = pluginWith(structuredClone(original));
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const incoming = structuredClone(original);
  const incomingBase = incoming.bases[0];
  assert.ok(incomingBase);
  incomingBase.data.nextStudyPaths = ["Remote.md"];
  incomingBase.updatedAt = 200;
  plugin.loadedData = incoming;

  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    const pendingRename = handler.handleRename("Old", "New", true);
    const pendingReload = plugin.onExternalSettingsChange();
    await Promise.all([pendingRename, pendingReload]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  assert.deepEqual(plugin.data.pinnedPaths, ["New/Topic.md"]);
  assert.deepEqual(plugin.data.nextStudyPaths, ["Remote.md"]);
  assert.equal(plugin.savedData.length, 1, "only the post-Sync rename needs an adapter write");
});

test("a vault rename retries after repeated Sync callbacks and rewrites every base once", async () => {
  const future = Date.now() + 1_000_000;
  const active = migrateData(null);
  active.settings.workspaceName = "Active";
  active.pinnedPaths = ["Old/Active.md"];
  const inactive = migrateData(null);
  inactive.settings.workspaceName = "Inactive";
  inactive.nextStudyPaths = ["Old/Inactive.md"];
  const archived = migrateData(null);
  archived.settings.workspaceName = "Archived";
  archived.collections = [{ id: "archived", title: "Archived", collapsed: false, subjects: ["Old/Archived.md"], subheadings: [] }];
  const original = createDefaultStore(active, future, "vault-rename-sync-retry");
  original.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive", future + 10));
  const archivedEntry = createKnowledgeBaseEntry(archived, "base-archived", future + 20);
  archivedEntry.archivedAt = future + 21;
  archivedEntry.updatedAt = future + 21;
  original.bases.push(archivedEntry);

  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
  };
  let disk = structuredClone(original);
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk);
  const firstRenameSaveStarted = deferred();
  const releaseFirstRenameSave = deferred();
  let saveCalls = 0;
  plugin.saveData = async (value: unknown) => {
    saveCalls += 1;
    if (saveCalls === 1) {
      firstRenameSaveStarted.resolve();
      await releaseFirstRenameSave.promise;
    }
    disk = structuredClone(value) as typeof disk;
  };
  await plugin.loadPluginData(false);

  const incomingA = structuredClone(original);
  const incomingActive = incomingA.bases.find((entry) => entry.id === "base-default");
  assert.ok(incomingActive);
  incomingActive.data.nextStudyPaths = ["Remote active.md"];
  incomingActive.updatedAt = future + 100;
  const incomingB = structuredClone(incomingA);
  const incomingInactive = incomingB.bases.find((entry) => entry.id === "base-inactive");
  const incomingArchived = incomingB.bases.find((entry) => entry.id === "base-archived");
  assert.ok(incomingInactive);
  assert.ok(incomingArchived);
  incomingInactive.data.pinnedPaths = ["Remote inactive.md"];
  incomingInactive.updatedAt = future + 110;
  incomingArchived.data.nextStudyPaths = ["Remote archived.md"];
  incomingArchived.updatedAt = future + 120;

  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    const pendingRename = handler.handleRename("Old", "New", true);
    await firstRenameSaveStarted.promise;
    disk = incomingA;
    const firstReload = plugin.onExternalSettingsChange();
    disk = incomingB;
    const secondReload = plugin.onExternalSettingsChange();
    releaseFirstRenameSave.resolve();
    await Promise.all([pendingRename, firstReload, secondReload]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  const finalActive = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-default");
  const finalInactive = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-inactive");
  const finalArchived = plugin.getKnowledgeBases(true).find((entry) => entry.id === "base-archived");
  assert.deepEqual(finalActive?.data.pinnedPaths, ["New/Active.md"]);
  assert.deepEqual(finalActive?.data.nextStudyPaths, ["Remote active.md"]);
  assert.deepEqual(finalInactive?.data.nextStudyPaths, ["New/Inactive.md"]);
  assert.deepEqual(finalInactive?.data.pinnedPaths, ["Remote inactive.md"]);
  assert.deepEqual(finalArchived?.data.collections[0]?.subjects, ["New/Archived.md"]);
  assert.deepEqual(finalArchived?.data.nextStudyPaths, ["Remote archived.md"]);
  assert.equal(finalActive?.updatedAt, incomingActive.updatedAt + 1);
  assert.equal(finalInactive?.updatedAt, incomingInactive.updatedAt + 1);
  assert.equal(finalArchived?.updatedAt, incomingArchived.updatedAt + 1);
  assert.equal(finalArchived?.archivedAt, future + 21);
  assert.deepEqual(disk, {
    ...disk,
    bases: plugin.getKnowledgeBases(true),
  }, "the final adapter payload contains the same active, inactive, and archived bases as memory");
});

test("the plugin rename handler preserves every note below a renamed folder and saves once", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.collections = [{ id: "c", title: "C", collapsed: false, subjects: ["Old/One.md"], subheadings: [] }];
  plugin.data.pinnedPaths = ["Old/Nested/Two.md"];
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string): Promise<void> };
    await handler.handleRename("Old", "New");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
  assert.deepEqual(plugin.data.collections[0]?.subjects, ["New/One.md"]);
  assert.deepEqual(plugin.data.pinnedPaths, ["New/Nested/Two.md"]);
  assert.equal(plugin.savedData.length, 1);
});

test("an inactive-base rename advances only that base's timestamp monotonically", async () => {
  const active = migrateData(null);
  active.settings.workspaceName = "ENT";
  const inactive = migrateData(null);
  inactive.settings.workspaceName = "Research";
  inactive.pinnedPaths = ["Old/Only inactive.md"];
  const store = createDefaultStore(active, 100, "vault-rename-test");
  const inactiveEntry = createKnowledgeBaseEntry(inactive, "base-research", Date.now() + 60_000);
  const priorInactiveTimestamp = inactiveEntry.updatedAt;
  store.bases.push(inactiveEntry);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Old/Only inactive.md", "New/Only inactive.md", false);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  const [savedActive, savedInactive] = plugin.getKnowledgeBases(true);
  assert.equal(savedActive?.updatedAt, 100);
  assert.ok((savedInactive?.updatedAt ?? 0) > priorInactiveTimestamp);
  assert.deepEqual(savedInactive?.data.pinnedPaths, ["New/Only inactive.md"]);
  assert.equal(plugin.savedData.length, 1);
});

test("folder-derived group renames are isolated by base root, including archived bases", async () => {
  const active = migrateData(null);
  active.settings.workspaceName = "Active matching base";
  active.settings.primaryFolder = "Root A";
  active.indexGroupOrder = ["Old Group", "Other"];
  active.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)] = ["Root A/Old Group/Active.md"];
  active.portableIndex.groups = [{ id: "active-group", title: "Old Group", order: 0 }];

  const inactive = migrateData(null);
  inactive.settings.workspaceName = "Inactive different root";
  inactive.settings.primaryFolder = "Root B";
  inactive.indexGroupAliases = { "Old Group": "Inactive display" };
  inactive.indexGroupOrder = ["Inactive display"];
  inactive.curriculumVisual.orderByContainer[curriculumContainerKey("Inactive display", null)] = ["Root B/Old Group/Inactive.md"];
  inactive.portableIndex.groups = [{ id: "inactive-group", title: "Inactive display", order: 0 }];

  const archived = migrateData(null);
  archived.settings.workspaceName = "Archived matching base";
  archived.settings.primaryFolder = "Root A";
  archived.indexGroupAliases = { "Old Group": "Archived display" };
  archived.indexGroupOrder = ["Old Group", "Archived display"];
  archived.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)] = ["Root A/Old Group/Archived.md"];
  archived.portableIndex.groups = [{ id: "archived-group", title: "Old Group", order: 0 }];

  const store = createDefaultStore(active, 100);
  store.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive", 200));
  const archivedEntry = createKnowledgeBaseEntry(archived, "base-archived", 300);
  archivedEntry.archivedAt = 400;
  store.bases.push(archivedEntry);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Root A/Old Group", "Root A/New Group", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  const [savedActive, savedInactive, savedArchived] = plugin.getKnowledgeBases(true).map((entry) => entry.data);
  assert.deepEqual(savedActive?.indexGroupAliases, {});
  assert.deepEqual(savedActive?.indexGroupOrder, ["Old Group", "New Group", "Other"]);
  assert.deepEqual(savedActive?.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)], ["Root A/New Group/Active.md"]);
  assert.deepEqual(savedActive?.curriculumVisual.orderByContainer[curriculumContainerKey("New Group", null)], ["Root A/New Group/Active.md"]);
  assert.equal(savedActive?.portableIndex.groups[0]?.title, "Old Group");

  assert.deepEqual(savedInactive?.indexGroupAliases, { "Old Group": "Inactive display" });
  assert.deepEqual(savedInactive?.indexGroupOrder, ["Inactive display"]);
  assert.deepEqual(savedInactive?.curriculumVisual.orderByContainer[curriculumContainerKey("Inactive display", null)], ["Root B/Old Group/Inactive.md"]);
  assert.equal(savedInactive?.portableIndex.groups[0]?.title, "Inactive display");

  assert.deepEqual(savedArchived?.indexGroupAliases, {
    "Old Group": "Archived display",
    "New Group": "Archived display",
  });
  assert.deepEqual(savedArchived?.indexGroupOrder, ["Old Group", "Archived display"]);
  assert.deepEqual(savedArchived?.curriculumVisual.orderByContainer[curriculumContainerKey("Old Group", null)], ["Root A/New Group/Archived.md"]);
  assert.deepEqual(savedArchived?.curriculumVisual.orderByContainer[curriculumContainerKey("Archived display", null)], ["Root A/New Group/Archived.md"]);
  assert.equal(savedArchived?.portableIndex.groups[0]?.title, "Old Group");
  assert.equal(plugin.savedData.length, 1);
});

test("folder rename preservation is conservative and does not enumerate the vault", async () => {
  const unrelatedFile = new TFile("References/Unrelated topic.md");
  const data = migrateData(null);
  data.settings.primaryFolder = "Knowledge Base";
  data.settings.groupProperty = "category";
  data.indexGroupAliases = { "Old Group": "Display group" };
  data.indexGroupOrder = ["Display group"];
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
  const { plugin, sourceMutationCount, vaultEnumerationCount } = pluginWithFiles(data, [unrelatedFile], {
    [unrelatedFile.path]: { category: "Different Group" },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Knowledge Base/Old Group", "Knowledge Base/New Group", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  assert.deepEqual(plugin.data.indexGroupAliases, {
    "Old Group": "Display group",
    "New Group": "Display group",
  });
  assert.deepEqual(plugin.data.portableIndex.groups, [{ id: "stable-old-group", title: "Old Group", order: 0 }]);
  assert.equal(plugin.data.portableIndex.subjects[0]?.groupId, "stable-old-group");
  assert.equal(plugin.savedData.length, 1);
  assert.equal(sourceMutationCount(), 0);
  assert.equal(vaultEnumerationCount(), 0);
});

test("root-folder renames rewrite active, inactive, archived, and nested snapshot settings", async () => {
  const configureBase = (name: string, primaryFolder: string) => {
    const data = migrateData(null);
    data.settings.workspaceName = name;
    data.settings.primaryFolder = primaryFolder;
    data.settings.proposalFolder = "Vault Root/Inbox/Topic Proposals";
    data.settings.templatesFolder = "Vault Root/Templates";
    data.settings.defaultNoteFolder = `${primaryFolder}/Inbox`;
    data.settings.defaultTemplatePath = "Vault Root/Templates/Topic.md";
    const history = snapshotPersonal(data, "Saved base settings", true);
    const nested = snapshotPersonal(data, "Nested base settings", true);
    nested.layoutSnapshots = undefined;
    history.layoutSnapshots = [nested];
    data.layoutSnapshots = [structuredClone(history)];
    data.undoStack = [structuredClone(history)];
    data.redoStack = [structuredClone(history)];
    return data;
  };
  const active = configureBase("Active", "Vault Root/Knowledge");
  const inactive = configureBase("Inactive", "Vault Root/Research");
  const archived = configureBase("Archived", "Vault Root/Archive");
  const store = createDefaultStore(active, 100);
  store.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive", 200));
  const archivedEntry = createKnowledgeBaseEntry(archived, "base-archived", 300);
  archivedEntry.archivedAt = 400;
  store.bases.push(archivedEntry);
  const plugin = pluginWith(store);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Vault Root", "Renamed Root", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  for (const entry of plugin.getKnowledgeBases(true)) {
    const expectedPrimary = `Renamed Root/${entry.data.settings.workspaceName === "Active"
      ? "Knowledge"
      : entry.data.settings.workspaceName === "Inactive" ? "Research" : "Archive"}`;
    const savedSettings = [entry.data.layoutSnapshots, entry.data.undoStack, entry.data.redoStack]
      .flatMap((stack) => [stack[0]?.settings, stack[0]?.layoutSnapshots?.[0]?.settings]);
    for (const settings of [entry.data.settings, ...savedSettings]) {
      assert.equal(settings?.primaryFolder, expectedPrimary);
      assert.equal(settings?.proposalFolder, "Renamed Root/Inbox/Topic Proposals");
      assert.equal(settings?.templatesFolder, "Renamed Root/Templates");
      assert.equal(settings?.defaultNoteFolder, `${expectedPrimary}/Inbox`);
      assert.equal(settings?.defaultTemplatePath, "Renamed Root/Templates/Topic.md");
    }
  }
  assert.equal(plugin.savedData.length, 1);
});

test("template file renames update current and nested saved settings without group migration", async () => {
  const data = migrateData(null);
  data.settings.primaryFolder = "Knowledge Base";
  data.settings.defaultTemplatePath = "Templates/Old topic.md";
  data.indexGroupAliases = { "Old topic.md": "Do not migrate this group" };
  const history = snapshotPersonal(data, "Template settings", true);
  history.layoutSnapshots = [snapshotPersonal(data, "Nested template settings", true)];
  data.layoutSnapshots = [structuredClone(history)];
  data.undoStack = [structuredClone(history)];
  data.redoStack = [structuredClone(history)];
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Templates/Old topic.md", "Templates/New topic.md", false);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  for (const settings of [
    plugin.data.settings,
    ...[plugin.data.layoutSnapshots, plugin.data.undoStack, plugin.data.redoStack]
      .flatMap((stack) => [stack[0]?.settings, stack[0]?.layoutSnapshots?.[0]?.settings]),
  ]) {
    assert.equal(settings?.defaultTemplatePath, "Templates/New topic.md");
    assert.equal(settings?.primaryFolder, "Knowledge Base");
  }
  assert.deepEqual(plugin.data.indexGroupAliases, { "Old topic.md": "Do not migrate this group" });
  assert.equal(plugin.savedData.length, 1);
});

test("file renames do not trigger folder-derived group migration", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.settings.primaryFolder = "Knowledge Base";
  plugin.data.indexGroupAliases = { "Old Group": "Display group" };
  plugin.data.indexGroupOrder = ["Display group"];
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as { handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void> };
    await handler.handleRename("Knowledge Base/Old Group", "Knowledge Base/New Group", false);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
  assert.deepEqual(plugin.data.indexGroupAliases, { "Old Group": "Display group" });
  assert.deepEqual(plugin.data.indexGroupOrder, ["Display group"]);
  assert.equal(plugin.savedData.length, 0);
});

test("test runtime uses the in-memory Obsidian plugin boundary", () => {
  const base = new Plugin();
  assert.ok(Array.isArray(base.savedData));
});

test("a corrupt data.json opens read-only instead of stopping the plugin from loading", async () => {
  Notice.messages.length = 0;
  const plugin = pluginWith(null);
  // Obsidian's loadData() performs JSON.parse, so a malformed file rejects here.
  (plugin as unknown as { loadData(): Promise<unknown> }).loadData = () =>
    Promise.reject(new SyntaxError("Unexpected end of JSON input"));
  await plugin.loadPluginData();
  assert.match(plugin.dataCompatibilityWarning, /could not be parsed/i);
  assert.match(plugin.dataCompatibilityWarning, /read-only/i);
  // The plugin still has usable defaults, and never writes over the bad file.
  assert.equal(plugin.data.version, DATA_VERSION);
  assert.equal(plugin.isDataReadOnly(), true);
  assert.equal(plugin.savedData.length, 0);
  await plugin.savePluginData();
  assert.equal(plugin.savedData.length, 0);
  assert.throws(() => plugin.assertDataWritable(), /could not be parsed/i);
  assert.equal(Notice.messages.some((message) => /could not be parsed/i.test(message)), true);
});

function vaultWith(fileCount: number) {
  const files = Array.from({ length: fileCount }, (_, index) => new TFile(`Knowledge Base/Group ${index % 20}/Note ${index}.md`));
  return {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => files,
      getAbstractFileByPath: () => null,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
}

test("index membership lookups stay constant-time across a large vault", async () => {
  const fileCount = 10_000;
  const plugin = new EntVaultCommandCenterPlugin(vaultWith(fileCount) as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  // Half the vault also carries an explicit manual membership. Testing these
  // with Array.includes inside the per-file loop is quadratic.
  plugin.data.manualIndexPaths = Array.from({ length: 5_000 }, (_, index) => `Elsewhere/Manual ${index}.md`);
  plugin.data.excludedIndexPaths = Array.from({ length: 2_000 }, (_, index) => `Knowledge Base/Group ${index % 20}/Note ${index}.md`);
  plugin.invalidateRecordCache();

  const start = performance.now();
  const records = plugin.getRecords();
  const elapsed = performance.now() - start;
  assert.equal(records.length, fileCount - plugin.data.excludedIndexPaths.length);
  assert.ok(elapsed < 750, `building records for ${fileCount} files took ${elapsed.toFixed(1)} ms`);

  // A warm cache must not rescan at all.
  const cachedStart = performance.now();
  assert.equal(plugin.getRecords(), records);
  assert.ok(performance.now() - cachedStart < 100, "a warm record cache should not rebuild");
});

test("ENT Index eligibility validation remains linear across 32,000 portable subjects", async () => {
  const subjectCount = 32_000;
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.portableIndex.groups = [{ id: "bulk-index", title: "Bulk Index", order: 0 }];
  data.portableIndex.subjects = Array.from({ length: subjectCount }, (_, index) => ({
    id: `bulk-topic-${index}`,
    title: `Bulk topic ${index}`,
    groupId: "bulk-index",
    parentId: null,
    order: index,
    indexed: true,
    configuredId: "",
    recordKind: "topic" as const,
    libraryId: null,
  }));
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  const start = performance.now();
  plugin.assertClinicalIndexEligibility();
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 1_000, `validating ${subjectCount.toLocaleString()} indexed subjects took ${elapsed.toFixed(1)} ms`);
});

test("hidden notes leave the index while manual members stay in it", async () => {
  const plugin = new EntVaultCommandCenterPlugin(vaultWith(6) as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  plugin.data.excludedIndexPaths = ["Knowledge Base/Group 0/Note 0.md"];
  plugin.invalidateRecordCache();
  const paths = plugin.getRecords().map((item) => item.path);
  assert.equal(paths.includes("Knowledge Base/Group 0/Note 0.md"), false);
  assert.equal(paths.includes("Knowledge Base/Group 1/Note 1.md"), true);
});

test("display aliases and collection memberships stay local while switching knowledge bases", async () => {
  const file = new TFile("Knowledge Base/Airway/Shared topic.md");
  file.stat.mtime = 12345;
  const frontmatter = { title: "Source title", category: "Airway", aliases: ["Original alias"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const first = migrateData(null);
  first.settings.workspaceName = "First KB";
  first.settings.workspaceMode = "generic";
  first.settings.primaryFolder = "Knowledge Base";
  first.collections = [{
    id: "first-collection",
    title: "First collection",
    collapsed: false,
    subjects: [file.path],
    subheadings: [],
  }];
  const second = migrateData(null);
  second.settings.workspaceName = "Second KB";
  second.settings.workspaceMode = "generic";
  second.settings.primaryFolder = "Knowledge Base";
  second.collections = [{
    id: "second-collection",
    title: "Second collection",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "second-subheading", title: "Second subheading", collapsed: false, subjects: [file.path] }],
  }];
  const store = createDefaultStore(first, 100);
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 200));
  const { plugin, sourceMutationCount } = pluginWithFiles(store, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  await plugin.renameRecordDisplay(file.path, "First display label");
  assert.equal(plugin.getRecord(file.path)?.title, "First display label");
  assert.equal(plugin.getRecord(file.path)?.sourceTitle, "Source title");
  assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
  assert.deepEqual(plugin.data.collections[0]?.subheadings[0]?.subjects, undefined);

  await plugin.switchKnowledgeBase("base-second");
  assert.equal(plugin.getRecord(file.path)?.title, "Source title");
  assert.equal(plugin.data.displayNameByPath[file.path], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, []);
  assert.deepEqual(plugin.data.collections[0]?.subheadings[0]?.subjects, [file.path]);
  await plugin.renameRecordDisplay(file.path, "Second display label");

  await plugin.switchKnowledgeBase("base-default");
  assert.equal(plugin.getRecord(file.path)?.title, "First display label");
  assert.equal(plugin.data.displayNameByPath[file.path], "First display label");
  assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);

  await plugin.switchKnowledgeBase("base-second");
  assert.equal(plugin.getRecord(file.path)?.title, "Second display label");
  assert.equal(plugin.data.displayNameByPath[file.path], "Second display label");
  assert.deepEqual(plugin.data.collections[0]?.subjects, []);
  assert.deepEqual(plugin.data.collections[0]?.subheadings[0]?.subjects, [file.path]);
  assert.equal(file.path, "Knowledge Base/Airway/Shared topic.md");
  assert.equal(file.stat.mtime, 12345);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT index removal and restoration only change active-base membership", async () => {
  const file = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  file.stat.mtime = 67890;
  const frontmatter = {
    title: "Pediatric airway",
    curriculum_id: "ENT-PED-001",
    domain: "Pediatric",
    review_status: "unverified",
  };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), true);
  await plugin.removeRecordsFromIndex([file.path]);
  assert.deepEqual(plugin.data.excludedIndexPaths, [file.path]);
  assert.equal(plugin.data.manualIndexPaths.includes(file.path), false);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), false);

  await plugin.restoreRecordsToIndex([file.path]);
  assert.equal(plugin.data.excludedIndexPaths.includes(file.path), false);
  assert.equal(
    plugin.data.manualIndexPaths.includes(file.path),
    false,
    "an in-folder clinical topic is indexed by its source identity, not a redundant manual membership",
  );
  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), true);
  assert.equal(file.path, "03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  assert.equal(file.stat.mtime, 67890);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT batch restore rejects a mixed topic and protected clinical record atomically", async () => {
  const topic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  data.excludedIndexPaths = [topic.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [topic, medication], {
    [topic.path]: { title: "Pediatric airway", curriculum_id: "ENT-PED-001", domain: "Pediatric" },
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const before = structuredClone(plugin.data);

  await assert.rejects(
    plugin.restoreRecordsToIndex([topic.path, medication.path], "Unsafe mixed restore", "Pediatric"),
    /accepts topic subjects only.*No subjects were restored/is,
  );

  assert.deepEqual(plugin.data, before);
  assert.equal(plugin.savedData.length, 0);
  assert.equal(sourceMutationCount(), 0);
});

test("a display-only alias does not rename a legacy canonical filename during an unchanged placement edit", async () => {
  const legacyPath = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - VPI assessment surgery.md";
  const file = new TFile(legacyPath);
  const frontmatter: Record<string, unknown> = {
    type: "clinical-topic",
    title: "VPI: assessment / surgery",
    curriculum_id: "ENT-LAR-010",
    domain: "Laryngology",
    topic_kind: "condition",
    priority: "P2",
    review_status: "unverified",
    sources: [],
  };
  let content = "# Legacy VPI heading\n\nBody remains here.\n";
  let renameCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: (path: string) => path === legacyPath ? file : null,
      read: async () => content,
      process: async (_file: TFile, update: (current: string) => string) => { content = update(content); },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), resolvedLinks: {} },
    fileManager: {
      renameFile: async () => { renameCalls += 1; },
      processFrontMatter: async (_file: TFile, update: (metadata: Record<string, unknown>) => void) => { update(frontmatter); },
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  data.displayNameByPath[legacyPath] = "VPI overview";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = data;
  await plugin.loadPluginData();
  const aliasedRecord = plugin.getRecord(legacyPath);
  assert.equal(aliasedRecord?.title, "VPI overview");
  assert.equal(aliasedRecord?.sourceTitle, "VPI: assessment / surgery");

  const result = await plugin.editCanonicalPlacement(legacyPath, {
    title: aliasedRecord?.sourceTitle ?? "",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: false,
    curriculumId: "ent-lar-010",
    addToCollection: false,
  });

  assert.equal(result, file);
  assert.equal(file.path, legacyPath);
  assert.equal(renameCalls, 0, "metadata-only placement changes must preserve a legacy canonical filename");
  assert.equal(frontmatter.title, "VPI: assessment / surgery");
  assert.equal(frontmatter.priority, "P1");
  assert.match(content, /^# VPI: assessment \/ surgery$/m);
  assert.match(content, /Body remains here\./);
  assert.equal(plugin.data.displayNameByPath[legacyPath], "VPI overview");
  assert.equal(plugin.getRecord(legacyPath)?.sourceTitle, "VPI: assessment / surgery");
});

test("a removed clinical portable subject resolved outside the primary folder stays Hidden and can be restored", async () => {
  const proposal = new TFile("01 Inbox/Topic Proposals/Proposal - Laryngeal Cleft.md");
  const frontmatter = {
    type: "topic-proposal",
    title: "Laryngeal Cleft",
    proposed_domain: "Pediatric",
    review_status: "unverified",
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.settings.idProperty = "curriculum_id";
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: "subject-cleft",
      title: "Laryngeal Cleft",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-003.05",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: { "subject-cleft": proposal.path },
  };
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [proposal], { [proposal.path]: frontmatter });
  await plugin.loadPluginData();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: typeof plugin.app;
    plugin: EntVaultCommandCenterPlugin;
    hiddenNotes(): Array<{ path: string; title: string; meta: string }>;
  };
  manager.app = plugin.app;
  manager.plugin = plugin;

  assert.equal(plugin.getIndexRecords().some((record) => record.path === proposal.path), true);
  await plugin.removeRecordsFromIndex([proposal.path]);

  assert.equal(plugin.getPortableSubject("subject-cleft")?.indexed, false);
  assert.deepEqual(plugin.data.excludedIndexPaths, [proposal.path]);
  assert.equal(plugin.getRecord(proposal.path)?.role, "proposal");
  assert.equal(plugin.getRecord(proposal.path)?.portableIndexed, false);
  assert.deepEqual(manager.hiddenNotes(), [{
    path: proposal.path,
    title: "Proposal - Laryngeal Cleft",
    meta: proposal.path,
  }]);

  await plugin.restoreRecordsToIndex([proposal.path]);

  assert.equal(plugin.getPortableSubject("subject-cleft")?.indexed, true);
  assert.equal(plugin.data.excludedIndexPaths.includes(proposal.path), false);
  assert.equal(plugin.data.manualIndexPaths.includes(proposal.path), true);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === proposal.path), true);
  assert.deepEqual(manager.hiddenNotes(), []);
  assert.equal(proposal.path, "01 Inbox/Topic Proposals/Proposal - Laryngeal Cleft.md");
  assert.deepEqual(frontmatter, {
    type: "topic-proposal",
    title: "Laryngeal Cleft",
    proposed_domain: "Pediatric",
    review_status: "unverified",
  });
  assert.equal(sourceMutationCount(), 0);
});

test("removing a whole clinical heading keeps its outside-root subjects restorable in Hidden", async () => {
  const proposal = new TFile("01 Inbox/Topic Proposals/Proposal - Airway.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: "subject-airway",
      title: "Airway",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-001",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: { "subject-airway": proposal.path },
  };
  const { plugin } = pluginWithFiles(data, [proposal], {
    [proposal.path]: { type: "topic-proposal", title: "Airway", proposed_domain: "Pediatric" },
  });
  await plugin.loadPluginData();
  const members = plugin.getIndexRecords().filter((item) => item.domain === "Pediatric");
  assert.equal(members.length, 1);
  let confirmation: Promise<void> = Promise.resolve();
  ConfirmModal.prototype.open = function confirmForTest(): void {
    confirmation = Promise.resolve((this as unknown as { onConfirm(): void | Promise<void> }).onConfirm());
  };
  const manager = new IndexManagerModal(plugin) as unknown as {
    openedBaseId: string;
    openedDataEpoch: number;
    managerOpen: boolean;
    render(): void;
    removeGroup(group: string, records: typeof members): void;
  };
  manager.openedBaseId = plugin.getActiveKnowledgeBaseId();
  manager.openedDataEpoch = plugin.getDataEpoch();
  manager.managerOpen = true;
  manager.render = () => {};
  try {
    manager.removeGroup("Pediatric", members);
    await confirmation;
  } finally {
    delete (ConfirmModal.prototype as { open?: () => void }).open;
  }

  assert.equal(plugin.getPortableSubject("subject-airway")?.indexed, false);
  assert.ok(plugin.data.excludedIndexPaths.includes(proposal.path));
  const hidden = Object.create(IndexManagerModal.prototype) as {
    app: typeof plugin.app;
    plugin: EntVaultCommandCenterPlugin;
    hiddenNotes(): Array<{ path: string }>;
  };
  hidden.app = plugin.app;
  hidden.plugin = plugin;
  assert.deepEqual(hidden.hiddenNotes().map((item) => item.path), [proposal.path]);
});

test("unresolved ENT placeholders keep the imported group order until their notes are linked", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.allowClinicalVisualGroupMoves = false;
  data.indexGroupOrder = ["Pediatric", "Otology"];
  data.portableIndex = {
    version: 1,
    groups: [
      { id: "group-pediatric", title: "Pediatric", order: 0 },
      { id: "group-otology", title: "Otology", order: 1 },
    ],
    subjects: [
      { id: "subject-otology", title: "Hearing loss", groupId: "group-otology", parentId: null, order: 0, indexed: true, configuredId: "ENT-OTO-001", recordKind: "topic" },
      { id: "subject-pediatric", title: "Airway", groupId: "group-pediatric", parentId: null, order: 0, indexed: true, configuredId: "ENT-PED-001", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: {},
  };
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  const byDomain = new Map(plugin.getIndexRecords().map((item) => [item.domain, item.folderOrder]));
  assert.equal(byDomain.get("Pediatric"), "0000");
  assert.equal(byDomain.get("Otology"), "0001");
});

test("reconciliation converts dead cross-vault recovery bindings back to portable placeholders", async () => {
  const stalePath = "03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md";
  const data = migrateData(null);
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: "subject-airway",
      title: "Airway",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-001",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: { "subject-airway": stalePath },
  };
  data.manualIndexPaths = [stalePath];
  data.selectedPath = stalePath;
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const changed = await plugin.reconcileRecords(plugin.getRecords());
  const placeholder = portablePlaceholderPath("subject-airway");

  assert.equal(changed, true);
  assert.deepEqual(plugin.data.portableIndex.resolvedPathBySubjectId, {});
  assert.deepEqual(plugin.data.manualIndexPaths, [placeholder]);
  assert.equal(plugin.getRecord(placeholder)?.title, "Airway");
  assert.equal(plugin.savedData.length, 1);
});

test("portable JSON writes do not create a second success notice", async () => {
  Notice.messages.length = 0;
  const plugin = pluginWith(null);
  let createdPath = "";
  let createdContent = "";
  const app = plugin.app as unknown as {
    vault: {
      getAbstractFileByPath(path: string): null;
      createFolder(path: string): Promise<void>;
      create(path: string, content: string): Promise<TFile>;
    };
  };
  app.vault = {
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (path, content) => {
      createdPath = path;
      createdContent = content;
      return new TFile(path);
    },
  };

  const file = await plugin.writePortableJson("workspace", { workspace: "test" });

  assert.equal(file.path, createdPath);
  assert.match(createdPath, /^Knowledge Base Command Center Exports\/knowledge-base-command-center-workspace-/);
  assert.equal(createdContent, '{\n  "workspace": "test"\n}\n');
  assert.deepEqual(Notice.messages, []);
});

test("an undo-protected import restores and persists the pre-import state when saving fails", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const originalName = plugin.data.settings.workspaceName;
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated write failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(
    plugin.mutate("Import portable export", () => {
      plugin.data.settings.workspaceName = "Imported name";
    }, { includeSettings: true, requireUndo: true }),
    /simulated write failure/,
  );

  assert.equal(plugin.data.settings.workspaceName, originalName);
  assert.equal(saveAttempts, 2);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: { settings?: { workspaceName?: string } } }>;
  } | undefined;
  const persistedActive = persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId);
  assert.equal(persistedActive?.data?.settings?.workspaceName, originalName);
});

test("workspace-only portability import includes dependency Library descriptors in Undo", async () => {
  const libraryId = "library-workspace-dependency";
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.settings.defaultTab = libraryTabId(libraryId);
  source.portableIndex.libraries = [{
    id: libraryId,
    name: "Workspace references",
    singularName: "Reference",
    icon: "book-open",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  source.portableIndex.libraryLayouts = { [libraryId]: [] };
  const value = parsePortableExport(createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, workspace: true },
    "2026-08-09T00:00:00.000Z",
  ));
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  const settingsBefore = structuredClone(plugin.data.settings);
  assert.equal(plugin.getLibrary(libraryId), null);

  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: typeof plugin.app;
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    dataChanged: boolean;
    openedBaseId: string;
    openedDataEpoch: number;
    centerOpen: boolean;
    close(): void;
    importSelected(): Promise<void>;
  };
  center.app = plugin.app;
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.dataChanged = false;
  center.openedBaseId = plugin.getActiveKnowledgeBaseId();
  center.openedDataEpoch = plugin.getDataEpoch();
  center.centerOpen = true;
  center.close = () => { center.centerOpen = false; };

  await center.importSelected();
  assert.equal(plugin.getLibrary(libraryId)?.name, "Workspace references");
  assert.equal(plugin.data.settings.defaultTab, libraryTabId(libraryId));

  await plugin.undo();
  assert.equal(plugin.getLibrary(libraryId), null, "Undo removes the dependency descriptor created by the import");
  assert.deepEqual(plugin.data.settings, settingsBefore, "Undo restores the complete destination settings");
});

test("saved-view-only portability import includes dependency Library descriptors in Undo", async () => {
  const libraryId = "library-saved-view-dependency";
  const source = migrateData(null);
  source.settings.workspaceMode = "generic";
  source.portableIndex.libraries = [{
    id: libraryId,
    name: "Saved-view references",
    singularName: "Reference",
    icon: "bookmark",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  source.portableIndex.libraryLayouts = { [libraryId]: [] };
  source.savedViews = [{
    id: "view-library-dependency",
    name: "Library review",
    tab: libraryTabId(libraryId),
    query: "status:unverified",
  }];
  const value = parsePortableExport(createPortableExport(
    source,
    [],
    { ...EMPTY_PORTABLE_SELECTION, savedViews: true },
    "2026-08-09T00:00:00.000Z",
  ));
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  assert.equal(plugin.getLibrary(libraryId), null);
  assert.deepEqual(plugin.data.savedViews, []);

  const center = Object.create(ExportImportCenterModal.prototype) as {
    app: typeof plugin.app;
    plugin: typeof plugin;
    importValue: typeof value;
    importSelection: typeof EMPTY_PORTABLE_SELECTION;
    importMode: "merge" | "replace";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    dataChanged: boolean;
    openedBaseId: string;
    openedDataEpoch: number;
    centerOpen: boolean;
    close(): void;
    importSelected(): Promise<void>;
  };
  center.app = plugin.app;
  center.plugin = plugin;
  center.importValue = value;
  center.importSelection = { ...EMPTY_PORTABLE_SELECTION, savedViews: true };
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.dataChanged = false;
  center.openedBaseId = plugin.getActiveKnowledgeBaseId();
  center.openedDataEpoch = plugin.getDataEpoch();
  center.centerOpen = true;
  center.close = () => { center.centerOpen = false; };

  await center.importSelected();
  assert.equal(plugin.getLibrary(libraryId)?.name, "Saved-view references");
  assert.equal(plugin.data.savedViews[0]?.tab, libraryTabId(libraryId));

  await plugin.undo();
  assert.equal(plugin.getLibrary(libraryId), null, "Undo removes the saved-view dependency descriptor");
  assert.deepEqual(plugin.data.savedViews, [], "Undo removes the imported saved view");
});

test("a failed Undo save restores the current data and both history stacks", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.pinnedPaths = ["Knowledge Base/Before.md"];
  const beforeChange = snapshotPersonal(plugin.data, "Change pinned note");
  plugin.data.pinnedPaths = ["Knowledge Base/After.md"];
  plugin.data.nextStudyPaths = ["Knowledge Base/After.md"];
  plugin.data.undoStack = [beforeChange];
  plugin.data.redoStack = [];
  const expected = structuredClone(plugin.data);
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated Undo save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.undo(), /simulated Undo save failure/);

  assert.equal(saveAttempts, 2, "the restored pre-Undo store must be persisted after the failed write");
  assert.deepEqual(plugin.data, expected);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: unknown }>;
  } | undefined;
  assert.deepEqual(persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId)?.data, expected);
});

test("a failed Redo save restores the current data and both history stacks", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.pinnedPaths = ["Knowledge Base/Original.md"];
  const existingUndo = snapshotPersonal(plugin.data, "Earlier pinned-note change");
  plugin.data.pinnedPaths = ["Knowledge Base/Redone.md"];
  plugin.data.nextStudyPaths = ["Knowledge Base/Redone.md"];
  const redoChange = snapshotPersonal(plugin.data, "Change pinned note");
  plugin.data.pinnedPaths = ["Knowledge Base/Current.md"];
  plugin.data.nextStudyPaths = ["Knowledge Base/Current.md"];
  plugin.data.undoStack = [existingUndo];
  plugin.data.redoStack = [redoChange];
  const expected = structuredClone(plugin.data);
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated Redo save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.redo(), /simulated Redo save failure/);

  assert.equal(saveAttempts, 2, "the restored pre-Redo store must be persisted after the failed write");
  assert.deepEqual(plugin.data, expected);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: unknown }>;
  } | undefined;
  assert.deepEqual(persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId)?.data, expected);
});

test("an ordinary mutate save failure restores personal state and existing history", async () => {
  const plugin = pluginWith(null);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  plugin.data.pinnedPaths = ["Knowledge Base/Undo state.md"];
  const existingUndo = snapshotPersonal(plugin.data, "Existing Undo entry");
  plugin.data.pinnedPaths = ["Knowledge Base/Redo state.md"];
  const existingRedo = snapshotPersonal(plugin.data, "Existing Redo entry");
  plugin.data.pinnedPaths = ["Knowledge Base/Current.md"];
  plugin.data.nextStudyPaths = ["Knowledge Base/Current.md"];
  plugin.data.collections = [{
    id: "current",
    title: "Current collection",
    collapsed: false,
    subjects: ["Knowledge Base/Current.md"],
    subheadings: [],
  }];
  plugin.data.selectedPath = "Knowledge Base/Current.md";
  plugin.data.activeTab = "collections";
  plugin.data.collapsed = {
    curriculumDomains: ["ENT"],
    curriculumNodes: ["Knowledge Base/Current.md"],
    queues: ["next"],
  };
  plugin.data.undoStack = [existingUndo];
  plugin.data.redoStack = [existingRedo];
  const expected = structuredClone(plugin.data);
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated ordinary mutation save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(
    plugin.mutate("Unsaved organization change", () => {
      plugin.data.pinnedPaths = ["Knowledge Base/Changed.md"];
      plugin.data.nextStudyPaths = [];
      plugin.data.collections = [];
      plugin.data.selectedPath = "Knowledge Base/Changed.md";
      plugin.data.activeTab = "queues";
      plugin.data.collapsed = { curriculumDomains: [], curriculumNodes: [], queues: [] };
    }),
    /simulated ordinary mutation save failure/,
  );

  assert.equal(saveAttempts, 2, "the restored pre-mutation store must be persisted after the failed write");
  assert.deepEqual(plugin.data, expected);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: unknown }>;
  } | undefined;
  assert.deepEqual(persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId)?.data, expected);
});

test("resolving a portable placeholder preserves placement and Undo only unlinks the note", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-laryngeal-cleft";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 2,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [placeholder];
  plugin.data.indexGroupByPath[placeholder] = "Airway";
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [placeholder], subheadings: [] }];

  await plugin.resolvePortableSubject(subjectId, linkedFile.path);

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], linkedFile.path);
  assert.deepEqual(plugin.data.portableIndex.relinkableSubjectIds, [subjectId]);
  assert.equal(plugin.getRecord(linkedFile.path)?.portableRelinkable, true);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  assert.equal(plugin.data.indexGroupByPath[linkedFile.path], "Airway");
  assert.equal(plugin.data.manualIndexPaths.includes(placeholder), false);

  await plugin.undo();

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [placeholder]);
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
  assert.equal(app.vault.getAbstractFileByPath(linkedFile.path), linkedFile);
});

test("Undo invalidates cached placeholder metadata", async () => {
  const app = {
    vault: { configDir: ".obsidian", getAbstractFileByPath: () => null, getMarkdownFiles: () => [] },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [{ id: "subject", title: "Old title", groupId: "group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("subject")];
  plugin.invalidateRecordCache();
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "Old title");

  await plugin.mutate("Rename imported subject", () => {
    const subject = plugin.getPortableSubject("subject");
    if (subject) subject.title = "New title";
    plugin.invalidateRecordCache();
  }, { includePortableIndex: true });
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "New title");

  await plugin.undo();
  assert.equal(plugin.getRecord(portablePlaceholderPath("subject"))?.title, "Old title");
});

test("confirmed identity reassignment merges bindings without duplicate organization paths and Undo restores both", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Local renamed note.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const importedId = "subject-imported";
  const localId = "subject-local";
  const importedPath = portablePlaceholderPath(importedId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [
      { id: importedId, title: "Imported title", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: localId, title: "Local renamed note", groupId: "group-airway", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { [localId]: linkedFile.path },
  };
  plugin.data.manualIndexPaths = [importedPath, linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [importedPath, linkedFile.path], subheadings: [] }];

  await assert.rejects(plugin.resolvePortableSubject(importedId, linkedFile.path), /identity reassignment/i);
  await plugin.resolvePortableSubject(importedId, linkedFile.path, true);

  assert.equal(plugin.data.portableIndex.subjects.length, 1);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[importedId], linkedFile.path);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[localId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  assert.deepEqual(plugin.data.manualIndexPaths, [linkedFile.path]);

  await plugin.undo();
  assert.equal(plugin.data.portableIndex.subjects.length, 2);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[localId], linkedFile.path);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [importedPath, linkedFile.path]);
});

test("identity reassignment refuses ancestor and descendant merges that would create a cycle", async () => {
  const linkedFile = new TFile("Knowledge Base/Ancestor.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group", title: "Group", order: 0 }],
    subjects: [
      { id: "ancestor", title: "Ancestor", groupId: "group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "middle", title: "Middle", groupId: "group", parentId: "ancestor", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "descendant", title: "Descendant", groupId: "group", parentId: "middle", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { ancestor: linkedFile.path },
  };

  await assert.rejects(
    plugin.resolvePortableSubject("descendant", linkedFile.path, true),
    /ancestors or descendants/i,
  );
  assert.equal(plugin.data.portableIndex.subjects.length, 3);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.ancestor, linkedFile.path);
});

test("unlinking a resolved portable subject restores its placeholder without changing the Markdown file", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-cleft";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{ id: subjectId, title: "Laryngeal Cleft", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { [subjectId]: linkedFile.path },
    relinkableSubjectIds: [subjectId],
  };
  plugin.data.manualIndexPaths = [linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [linkedFile.path], subheadings: [] }];

  await plugin.unlinkPortableSubject(subjectId);

  const placeholder = portablePlaceholderPath(subjectId);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [placeholder]);
  assert.equal(app.vault.getAbstractFileByPath(linkedFile.path), linkedFile);
});

test("Index Manager keeps a removed portable placeholder discoverable under Available", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const subjectId = "subject-available";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.invalidateRecordCache();
  const manager = Object.create(IndexManagerModal.prototype) as {
    plugin: EntVaultCommandCenterPlugin;
    availableNotes(): Array<{ path: string; title: string; meta: string }>;
  };
  manager.plugin = plugin;

  assert.deepEqual(manager.availableNotes(), [{
    path: portablePlaceholderPath(subjectId),
    title: "Laryngeal Cleft",
    meta: "Airway · imported subject without a note",
  }]);
});

test("adding an available portable placeholder restores membership and captures it in Undo", async () => {
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.savedData.length = 0;
  const subjectId = "subject-restore";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-airway",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.indexGroupOrder = ["Airway"];
  plugin.data.indexGroupByPath[placeholder] = "Airway";
  plugin.invalidateRecordCache();
  const manager = Object.create(IndexManagerModal.prototype) as {
    app: typeof app;
    plugin: EntVaultCommandCenterPlugin;
    selected: Set<string>;
    tab: string;
    render(): void;
    chooseGroupForSelection(mode: "add" | "restore" | "move"): void;
  };
  manager.app = app;
  manager.plugin = plugin;
  manager.selected = new Set([placeholder]);
  manager.tab = "available";
  manager.render = () => {};

  let resolveSubmission: () => void = () => {};
  let rejectSubmission: (error: unknown) => void = () => {};
  const submission = new Promise<void>((resolve, reject) => {
    resolveSubmission = resolve;
    rejectSubmission = reject;
  });
  IndexGroupModal.prototype.open = function openForTest(): void {
    const options = (this as unknown as {
      options: { initialValue: string; onSubmit(group: string): void | Promise<void> };
    }).options;
    void Promise.resolve(options.onSubmit(options.initialValue)).then(resolveSubmission, rejectSubmission);
  };
  try {
    manager.chooseGroupForSelection("add");
    await submission;
  } finally {
    delete (IndexGroupModal.prototype as { open?: () => void }).open;
  }

  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, true);
  assert.ok(plugin.data.manualIndexPaths.includes(placeholder));
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], undefined);
  assert.equal(plugin.data.undoStack.at(-1)?.portableIndex?.subjects[0]?.indexed, false);

  await plugin.undo();

  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, false);
  assert.equal(plugin.data.manualIndexPaths.includes(placeholder), false);
  assert.equal(plugin.data.indexGroupByPath[placeholder], "Airway");
});

test("an indexed clinical subject linked to an unverified proposal remains in both the index and Inbox export", async () => {
  const proposal = new TFile("01 Inbox/Topic Proposals/Proposal - Laryngeal Cleft.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === proposal.path ? proposal : null,
      getMarkdownFiles: () => [proposal],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: () => ({ frontmatter: { type: "topic-proposal", title: "Laryngeal Cleft", proposed_domain: "Pediatric" } }),
      resolvedLinks: {},
    },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "ent-clinical";
  plugin.data.settings.primaryFolder = "03 Clinical Topics";
  plugin.data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  plugin.data.settings.idProperty = "curriculum_id";
  const subjectId = "subject-cleft";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Laryngeal Cleft",
      groupId: "group-pediatric",
      parentId: null,
      order: 0,
      indexed: true,
      configuredId: "ENT-PED-003.05",
      recordKind: "topic",
    }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [placeholder];

  await plugin.resolvePortableSubject(subjectId, proposal.path);

  const linked = plugin.getRecord(proposal.path);
  assert.equal(linked?.kind, "topic");
  assert.equal(linked?.role, "proposal");
  assert.equal(linked?.portableIndexed, true);
  assert.deepEqual(plugin.getIndexRecords().map((record) => record.path), [proposal.path]);
  assert.deepEqual(plugin.getRecords().filter((record) => record.role === "proposal").map((record) => record.path), [proposal.path]);

  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  assert.equal(exported.components.index?.subjects[0]?.id, subjectId);
  assert.equal(exported.components.index?.subjects[0]?.configuredId, "ENT-PED-003.05");
  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, true);
});

test("a collection-only generic placeholder can link a new in-folder note without entering the index", async () => {
  const created = new TFile("Knowledge Base/Reference material.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === created.path ? created : null,
      getMarkdownFiles: () => [created],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { title: "Reference material" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "generic";
  plugin.data.settings.primaryFolder = "Knowledge Base";
  const subjectId = "subject-reference";
  const placeholder = portablePlaceholderPath(subjectId);
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-reference", title: "Reference", order: 0 }],
    subjects: [{ id: subjectId, title: "Reference material", groupId: "group-reference", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "note" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.collections = [{ id: "reference", title: "Reference", collapsed: false, subjects: [placeholder], subheadings: [] }];

  await plugin.resolvePortableSubject(subjectId, created.path);

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], created.path);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [created.path]);
  assert.equal(plugin.data.excludedIndexPaths.includes(created.path), true);
  assert.equal(plugin.getRecord(created.path)?.kind, "note");
  assert.equal(plugin.getIndexRecords().some((record) => record.path === created.path), false);
});

test("a non-indexed syndrome linked to an ordinary generic note survives cache rebuild as a library record", async () => {
  const linkedFile = new TFile("Reference/Usher syndrome.md");
  linkedFile.stat.mtime = 24680;
  const frontmatter = { title: "Usher syndrome", tags: ["reference"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const subjectId = "subject-usher-syndrome";
  data.portableIndex = {
    version: 1,
    groups: [{ id: "group-syndromes", title: "Syndromes", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Usher syndrome",
      groupId: "group-syndromes",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "syndrome",
    }],
    resolvedPathBySubjectId: {},
  };
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [linkedFile], { [linkedFile.path]: frontmatter });
  await plugin.loadPluginData();

  await plugin.resolvePortableSubject(subjectId, linkedFile.path);
  plugin.invalidateRecordCache();
  const rebuilt = plugin.getRecord(linkedFile.path);

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], linkedFile.path);
  assert.equal(rebuilt?.kind, "syndrome");
  assert.equal(rebuilt?.portableId, subjectId);
  assert.equal(rebuilt?.portableIndexed, false);
  assert.equal(rebuilt?.isPlaceholder, undefined);
  assert.equal(plugin.data.manualIndexPaths.includes(linkedFile.path), false);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === linkedFile.path), false);
  assert.equal(linkedFile.path, "Reference/Usher syndrome.md");
  assert.equal(linkedFile.stat.mtime, 24680);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("custom libraries support stable CRUD, locale-invariant names, ordering, archive, and restore", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const researchId = await plugin.createLibrary({
    name: "Research",
    singularName: "Paper",
    icon: "not-a-lucide-icon",
  });
  assert.match(researchId, /^library-/);
  assert.equal(plugin.getLibrary(researchId)?.icon, "library", "unknown icons use the safe fallback");
  assert.equal(plugin.data.activeTab, libraryTabId(researchId));
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts[researchId], []);

  await assert.rejects(
    plugin.createLibrary({ name: "research", singularName: "Duplicate", icon: "library" }),
    /already exists/i,
  );
  assert.equal(plugin.getLibraries(true).length, 1);

  const guidelinesId = await plugin.createLibrary({
    name: "Guidelines",
    singularName: "Guideline",
    icon: "book-open",
  });
  await plugin.reorderLibrary(guidelinesId, 0);
  assert.deepEqual(plugin.getLibraries().map((library) => library.id), [guidelinesId, researchId]);

  await plugin.updateLibrary(researchId, {
    name: "Evidence",
    singularName: "Study",
    icon: "microscope",
  });
  const exposed = plugin.getLibrary(researchId);
  assert.ok(exposed);
  exposed.name = "Mutated outside Undo";
  assert.deepEqual(plugin.getLibrary(researchId), {
    id: researchId,
    name: "Evidence",
    singularName: "Study",
    icon: "microscope",
    order: 1,
    sourceKind: null,
    archivedAt: null,
  }, "public reads must not expose mutable plugin state");

  plugin.data.activeTab = libraryTabId(researchId);
  plugin.data.settings.defaultTab = libraryTabId(researchId);
  await plugin.archiveLibrary(researchId);
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");
  assert.equal(plugin.getLibraries().some((library) => library.id === researchId), false);
  assert.equal(typeof plugin.getLibrary(researchId)?.archivedAt, "number");

  await plugin.restoreLibrary(researchId);
  assert.equal(plugin.getLibrary(researchId)?.archivedAt, null);
  assert.equal(plugin.getLibrary(researchId)?.id, researchId, "rename, reorder, archive, and restore retain the stable ID");
  assert.equal(plugin.savedData.length, 6, "each accepted CRUD operation persists once; duplicate rejection does not save");
});

test("renaming an imported Library preserves its forward-compatible icon ID", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.portableIndex.libraries = [{
    id: "library-imported",
    name: "Imported references",
    singularName: "Reference",
    icon: "future-library-icon",
    order: 0,
    sourceKind: null,
    archivedAt: null,
  }];
  data.portableIndex.libraryLayouts = { "library-imported": [] };
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  await plugin.updateLibrary("library-imported", {
    name: "Renamed references",
    singularName: "Reference",
    icon: "future-library-icon",
  });

  assert.equal(plugin.getLibrary("library-imported")?.name, "Renamed references");
  assert.equal(plugin.getLibrary("library-imported")?.icon, "future-library-icon");
});

test("custom-library names, headings, and groups stay identical on Turkish and Azeri hosts", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "toLocaleLowerCase");
  assert.ok(originalDescriptor);

  for (const locale of ["tr", "az"] as const) {
    Object.defineProperty(String.prototype, "toLocaleLowerCase", {
      ...originalDescriptor,
      value(this: string): string {
        return this.replaceAll("I", "ı").replaceAll("İ", "i").toLowerCase();
      },
    });
    try {
      assert.equal("ISTANBUL".toLocaleLowerCase(), "ıstanbul", `${locale} host simulation must distinguish locale-sensitive casing`);

      const files = [
        new TFile(`Knowledge Base/${locale}/Library upper.md`),
        new TFile(`Knowledge Base/${locale}/Library lower.md`),
        new TFile(`Knowledge Base/${locale}/Topic upper.md`),
        new TFile(`Knowledge Base/${locale}/Topic lower.md`),
      ];
      const frontmatter = Object.fromEntries(files.map((file) => [file.path, { title: file.basename }]));
      const data = migrateData(null);
      data.settings.workspaceMode = "generic";
      data.settings.primaryFolder = "Knowledge Base";
      const { plugin } = pluginWithFiles(data, files, frontmatter);
      await plugin.loadPluginData();

      const libraryId = await plugin.createLibrary({ name: "ISTANBUL", singularName: "Item", icon: "library" });
      await assert.rejects(
        plugin.createLibrary({ name: "istanbul", singularName: "Duplicate", icon: "library" }),
        /already exists/i,
      );
      await plugin.assignRecordToLibrary(files[0].path, libraryId, { headingTitle: "ISTANBUL" });
      await plugin.assignRecordToLibrary(files[1].path, libraryId, { headingTitle: "istanbul" });

      const layout = plugin.data.portableIndex.libraryLayouts[libraryId] ?? [];
      const librarySubjects = plugin.data.portableIndex.subjects.filter((subject) => subject.libraryId === libraryId);
      assert.equal(layout.length, 1, `${locale} host must not create a case-only duplicate library heading`);
      assert.equal(layout[0]?.subjects.length, 2);
      assert.equal(new Set(librarySubjects.map((subject) => subject.groupId)).size, 1,
        `${locale} host must not create a case-only duplicate library group`);

      await plugin.assignRecordToCatalog(files[2].path, "topic", { headingTitle: "ISTANBUL" });
      await plugin.assignRecordToCatalog(files[3].path, "topic", { headingTitle: "istanbul" });
      const topicSubjects = plugin.data.portableIndex.subjects.filter((subject) => subject.indexed
        && (subject.title === files[2].basename || subject.title === files[3].basename));
      assert.equal(topicSubjects.length, 2);
      assert.equal(new Set(topicSubjects.map((subject) => subject.groupId)).size, 1,
        `${locale} host must not create a case-only duplicate topic group`);
    } finally {
      Object.defineProperty(String.prototype, "toLocaleLowerCase", originalDescriptor);
    }
  }
});

test("library Create, Archive, and Delete restore navigation and defaults through Undo and Redo", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.activeTab = "collections";
  data.settings.defaultTab = "queues";
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  const libraryId = await plugin.createLibrary({ name: "Research", singularName: "Paper", icon: "microscope" });
  const tab = libraryTabId(libraryId);
  assert.equal(plugin.data.activeTab, tab);
  await plugin.undo();
  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.data.activeTab, "collections");
  assert.equal(plugin.data.settings.defaultTab, "queues");
  await plugin.redo();
  assert.ok(plugin.getLibrary(libraryId));
  assert.equal(plugin.data.activeTab, tab);

  plugin.data.settings.defaultTab = tab;
  await plugin.archiveLibrary(libraryId);
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");
  await plugin.undo();
  assert.equal(plugin.getLibrary(libraryId)?.archivedAt, null);
  assert.equal(plugin.data.activeTab, tab);
  assert.equal(plugin.data.settings.defaultTab, tab);
  await plugin.redo();
  assert.equal(typeof plugin.getLibrary(libraryId)?.archivedAt, "number");
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");

  // Synced or recovered state can still point at an archived tab. Permanent
  // deletion must preserve that exact pre-delete state for history recovery.
  plugin.data.activeTab = tab;
  plugin.data.settings.defaultTab = tab;
  await plugin.deleteLibrary(libraryId, "unassigned");
  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");
  await plugin.undo();
  assert.equal(typeof plugin.getLibrary(libraryId)?.archivedAt, "number");
  assert.equal(plugin.data.activeTab, tab);
  assert.equal(plugin.data.settings.defaultTab, tab);
  await plugin.redo();
  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.data.activeTab, "curriculum");
  assert.equal(plugin.data.settings.defaultTab, "curriculum");
});

test("custom-library assignment is visual-only and Undo or Redo preserves personal memberships", async () => {
  const file = new TFile("Knowledge Base/ENT/Laryngomalacia.md");
  file.stat.mtime = 86420;
  const frontmatter = { title: "Laryngomalacia", aliases: ["Congenital laryngeal collapse"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.collections = [{ id: "study", title: "Study", collapsed: false, subjects: [file.path], subheadings: [] }];
  data.pinnedPaths = [file.path];
  data.nextStudyPaths = [file.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();
  const libraryId = await plugin.createLibrary({ name: "Pediatric airway", singularName: "Topic", icon: "stethoscope" });

  await plugin.assignRecordToLibrary(file.path, libraryId, { headingTitle: "Congenital airway" });

  const assigned = plugin.getRecord(file.path);
  const subjectId = assigned?.portableId ?? "";
  assert.ok(subjectId);
  assert.equal(assigned?.kind, "topic", "custom visual libraries do not rewrite semantic type");
  assert.equal(assigned?.libraryId, libraryId);
  assert.equal(assigned?.role, "library");
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts[libraryId]?.[0]?.subjects, [subjectId]);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
  assert.deepEqual(plugin.data.pinnedPaths, [file.path]);
  assert.deepEqual(plugin.data.nextStudyPaths, [file.path]);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(file.path, "Knowledge Base/ENT/Laryngomalacia.md");
  assert.equal(file.stat.mtime, 86420);
  assert.equal(sourceMutationCount(), 0);

  await plugin.undo();
  assert.equal(plugin.getRecord(file.path)?.libraryId, undefined);
  assert.equal(plugin.getLibrary(libraryId)?.name, "Pediatric airway");
  assert.deepEqual(plugin.data.pinnedPaths, [file.path]);

  await plugin.redo();
  assert.equal(plugin.getRecord(file.path)?.libraryId, libraryId);
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assert.equal(sourceMutationCount(), 0);
});

test("deleting an archived custom library can safely rehome subjects and is fully Undoable", async () => {
  const first = new TFile("Knowledge Base/ENT/Laryngeal cleft.md");
  const second = new TFile("Knowledge Base/ENT/Velopharyngeal insufficiency.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.collections = [{ id: "review", title: "Review", collapsed: false, subjects: [first.path], subheadings: [] }];
  data.pinnedPaths = [first.path];
  data.nextStudyPaths = [second.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [first, second], {
    [first.path]: { title: "Laryngeal cleft" },
    [second.path]: { title: "Velopharyngeal insufficiency" },
  });
  await plugin.loadPluginData();
  const sourceId = await plugin.createLibrary({ name: "Airway", singularName: "Airway topic", icon: "activity" });
  const targetId = await plugin.createLibrary({ name: "Review library", singularName: "Review topic", icon: "bookmark" });
  await plugin.assignRecordToLibrary(first.path, sourceId, { headingTitle: "Congenital" });
  await plugin.assignRecordToLibrary(second.path, sourceId, { headingTitle: "Functional" });
  const subjectIds = [plugin.getRecord(first.path)?.portableId ?? "", plugin.getRecord(second.path)?.portableId ?? ""];
  assert.equal(subjectIds.every(Boolean), true);
  const sourceGroupIds = subjectIds.map((id) => plugin.getPortableSubject(id)?.groupId ?? "");
  const originalLayout = structuredClone(plugin.data.portableIndex.libraryLayouts[sourceId]);
  plugin.data.savedViews = [{ id: "airway-view", name: "Airway", tab: libraryTabId(sourceId), query: "lary" }];

  await plugin.archiveLibrary(sourceId);
  await plugin.deleteLibrary(sourceId, { libraryId: targetId });

  assert.equal(plugin.getLibrary(sourceId), null);
  assert.equal(plugin.data.portableIndex.libraryLayouts[sourceId], undefined);
  assert.equal(plugin.data.savedViews.some((view) => view.tab === libraryTabId(sourceId)), false);
  for (const path of [first.path, second.path]) {
    assert.equal(plugin.getRecord(path)?.libraryId, targetId);
    assert.equal(plugin.getRecord(path)?.portableIndexed, false);
  }
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts[targetId], [], "rehomed subjects start unplaced in the destination layout");
  assert.equal(plugin.data.portableIndex.groups.some((group) => sourceGroupIds.includes(group.id)), false, "orphaned source-only groups are removed");
  assert.deepEqual(plugin.data.collections[0]?.subjects, [first.path]);
  assert.deepEqual(plugin.data.pinnedPaths, [first.path]);
  assert.deepEqual(plugin.data.nextStudyPaths, [second.path]);
  assert.equal(sourceMutationCount(), 0);

  await plugin.undo();
  assert.equal(typeof plugin.getLibrary(sourceId)?.archivedAt, "number");
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts[sourceId], originalLayout);
  assert.deepEqual(subjectIds.map((id) => plugin.getPortableSubject(id)?.libraryId), [sourceId, sourceId]);
  assert.equal(plugin.data.savedViews.some((view) => view.tab === libraryTabId(sourceId)), true);

  await plugin.redo();
  assert.equal(plugin.getLibrary(sourceId), null);
  assert.deepEqual(subjectIds.map((id) => plugin.getPortableSubject(id)?.libraryId), [targetId, targetId]);
  assert.equal(sourceMutationCount(), 0);
});

test("deleting a custom library to the index keeps non-topic semantics visible and never writes Markdown", async () => {
  const file = new TFile("Reference/Imported evidence.md");
  const frontmatter = { title: "Imported evidence", aliases: ["Evidence note"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();
  const libraryId = await plugin.createLibrary({ name: "Evidence", singularName: "Evidence item", icon: "microscope" });
  await plugin.assignRecordToLibrary(file.path, libraryId, { headingTitle: "Imported" });
  const subjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(subjectId);
  assert.equal(plugin.getRecord(file.path)?.kind, "note");

  await plugin.archiveLibrary(libraryId);
  await plugin.deleteLibrary(libraryId, "index");

  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.getRecord(file.path)?.kind, "note", "index placement remains independent of semantic type");
  assert.equal(plugin.getRecord(file.path)?.libraryId, undefined);
  assert.equal(plugin.getPortableSubject(subjectId)?.indexed, true);
  assert.equal(plugin.data.manualIndexPaths.includes(file.path), true, "out-of-root notes need explicit index membership");
  assert.equal(plugin.data.indexGroupByPath[file.path], "Ungrouped");
  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), true);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT library deletion rejects mixed semantic rehomes atomically while custom targets stay unrestricted", async () => {
  const topic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-003 - Laryngeal cleft.md");
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [topic, medication], {
    [topic.path]: { title: "Laryngeal cleft", curriculum_id: "ENT-PED-003", domain: "Pediatric" },
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  const sourceId = await plugin.createLibrary({ name: "Mixed review", singularName: "Record", icon: "flask-conical" });
  const customTargetId = await plugin.createLibrary({ name: "Unrestricted archive", singularName: "Record", icon: "archive" });
  await plugin.assignRecordToLibrary(topic.path, sourceId, { headingTitle: "Topics" });
  await plugin.assignRecordToLibrary(medication.path, sourceId, { headingTitle: "Treatments" });
  await plugin.archiveLibrary(sourceId);

  const before = structuredClone(plugin.data);
  assert.match(plugin.getLibraryRemovalDestinationError(sourceId, "index") ?? "", /index accepts topic subjects only.*Allergodil.*No subjects were moved/is);
  await assert.rejects(plugin.deleteLibrary(sourceId, "index"), /index accepts topic subjects only.*No subjects were moved/is);
  assert.deepEqual(plugin.data, before, "an incompatible index rehome cannot move only the matching subset");

  assert.match(
    plugin.getLibraryRemovalDestinationError(sourceId, { libraryId: "medication" }) ?? "",
    /built-in Medications library accepts medication subjects only.*Laryngeal cleft.*No subjects were moved/is,
  );
  await assert.rejects(
    plugin.deleteLibrary(sourceId, { libraryId: "medication" }),
    /built-in Medications library accepts medication subjects only.*No subjects were moved/is,
  );
  assert.deepEqual(plugin.data, before, "a mixed source library must be all-or-nothing for a protected clinical destination");

  assert.equal(plugin.getLibraryRemovalDestinationError(sourceId, { libraryId: customTargetId }), null);
  await plugin.deleteLibrary(sourceId, { libraryId: customTargetId });
  assert.equal(plugin.getRecord(topic.path)?.libraryId, customTargetId);
  assert.equal(plugin.getRecord(medication.path)?.libraryId, customTargetId);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT library deletion rehomes native topics to the index and same-kind records to built-in libraries", async () => {
  const topic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-004 - Laryngomalacia.md");
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Ciprofloxacin.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [topic, medication], {
    [topic.path]: { title: "Laryngomalacia", curriculum_id: "ENT-PED-004", domain: "Pediatric" },
    [medication.path]: { title: "Ciprofloxacin", ent_domains: ["Otology"] },
  });
  await plugin.loadPluginData();

  const topicSourceId = await plugin.createLibrary({ name: "Topic review", singularName: "Topic", icon: "bookmark" });
  await plugin.assignRecordToLibrary(topic.path, topicSourceId, { headingTitle: "Pediatric" });
  assert.equal(plugin.data.excludedIndexPaths.includes(topic.path), true, "custom placement temporarily hides the native topic");
  await plugin.archiveLibrary(topicSourceId);
  assert.equal(plugin.getLibraryRemovalDestinationError(topicSourceId, "index"), null);
  await plugin.deleteLibrary(topicSourceId, "index");
  assert.equal(plugin.getRecord(topic.path)?.kind, "topic");
  assert.equal(plugin.getRecord(topic.path)?.libraryId, undefined);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === topic.path), true);

  const medicationSourceId = await plugin.createLibrary({ name: "Medication review", singularName: "Medication", icon: "pill" });
  await plugin.assignRecordToLibrary(medication.path, medicationSourceId, { headingTitle: "Otology" });
  await plugin.archiveLibrary(medicationSourceId);
  assert.equal(plugin.getLibraryRemovalDestinationError(medicationSourceId, { libraryId: "medication" }), null);
  await plugin.deleteLibrary(medicationSourceId, { libraryId: "medication" });
  assert.equal(plugin.getRecord(medication.path)?.kind, "medication");
  assert.equal(plugin.getRecord(medication.path)?.libraryId, "medication");
  assert.equal(sourceMutationCount(), 0);
});

test("a failed custom-library deletion save restores the exact definition, subjects, layout, and history", async () => {
  const file = new TFile("Knowledge Base/ENT/Choanal atresia.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: { title: "Choanal atresia" } });
  await plugin.loadPluginData();
  const libraryId = await plugin.createLibrary({ name: "Congenital", singularName: "Condition", icon: "dna" });
  await plugin.assignRecordToLibrary(file.path, libraryId, { headingTitle: "Nasal" });
  await plugin.archiveLibrary(libraryId);
  const expected = structuredClone(plugin.data);
  plugin.savedData.length = 0;
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated library deletion write failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.deleteLibrary(libraryId, "index"), /simulated library deletion write failure/i);

  assert.equal(saveAttempts, 2, "the rollback is persisted after the rejected write");
  assert.deepEqual(plugin.data, expected);
  assert.equal(plugin.getRecord(file.path)?.libraryId, libraryId);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{ id?: string; data?: unknown }>;
  } | undefined;
  assert.deepEqual(persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId)?.data, expected);
  assert.equal(sourceMutationCount(), 0);
});

test("deleting a 50,000-subject custom library removes layout memberships in linear time", async () => {
  const subjectCount = 50_000;
  const libraryId = "library-bulk-delete";
  const groupId = "bulk";
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.portableIndex.libraries.push({
    id: libraryId,
    name: "Bulk archive",
    singularName: "Item",
    icon: "archive",
    order: data.portableIndex.libraries.length,
    sourceKind: null,
    archivedAt: 1,
  });
  data.portableIndex.groups.push({ id: groupId, title: "Bulk", order: data.portableIndex.groups.length });
  data.portableIndex.subjects = Array.from({ length: subjectCount }, (_, index) => ({
    id: `s${index}`,
    title: `S${index}`,
    groupId,
    parentId: null,
    order: index,
    indexed: false,
    configuredId: "",
    recordKind: "note" as const,
    libraryId,
  }));
  data.portableIndex.libraryLayouts[libraryId] = [{
    id: "all",
    title: "All",
    collapsed: false,
    subjects: data.portableIndex.subjects.map((subject) => subject.id),
    subheadings: [],
  }];
  const plugin = pluginWith(data);
  await plugin.loadPluginData();

  const start = performance.now();
  await plugin.deleteLibrary(libraryId, "unassigned");
  const elapsed = performance.now() - start;

  assert.equal(plugin.getLibrary(libraryId), null);
  assert.equal(plugin.data.portableIndex.subjects.filter((subject) => subject.libraryId === libraryId).length, 0);
  assert.equal(plugin.data.portableIndex.libraryLayouts[libraryId], undefined);
  assert.ok(elapsed < 2_500, `deleting ${subjectCount} layout memberships took ${elapsed.toFixed(1)} ms`);
});

test("custom-library definitions are isolated per knowledge base", async () => {
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.workspaceName = "ENT";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.workspaceName = "Research";
  const store = createDefaultStore(first, 100, "vault-custom-library-isolation");
  store.bases.push(createKnowledgeBaseEntry(second, "base-research", 200));
  const plugin = pluginWith(store);
  await plugin.loadPluginData();

  const entLibraryId = await plugin.createLibrary({ name: "Guidelines", singularName: "Guideline", icon: "book-open" });
  await plugin.switchKnowledgeBase("base-research");
  assert.equal(plugin.getLibrary(entLibraryId), null);
  assert.deepEqual(plugin.getLibraries(), []);
  const researchLibraryId = await plugin.createLibrary({ name: "Guidelines", singularName: "Paper", icon: "microscope" });
  assert.notEqual(researchLibraryId, entLibraryId);

  await plugin.switchKnowledgeBase("base-default");
  assert.equal(plugin.getLibrary(entLibraryId)?.singularName, "Guideline");
  assert.equal(plugin.getLibrary(researchLibraryId), null);
  assert.deepEqual(plugin.getLibraries().map((library) => library.id), [entLibraryId]);
});

test("custom-library creation enforces the bounded per-base maximum without saving", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.portableIndex.libraries = Array.from({ length: MAX_LIBRARIES }, (_, index) => ({
    id: `custom-${index + 1}`,
    name: `Custom ${index + 1}`,
    singularName: "Item",
    icon: "library",
    order: index,
    sourceKind: null,
    archivedAt: null,
  }));
  data.portableIndex.libraryLayouts = Object.fromEntries(data.portableIndex.libraries.map((library) => [library.id, []]));
  const plugin = pluginWith(data);
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  await assert.rejects(
    plugin.createLibrary({ name: "Over capacity", singularName: "Item", icon: "library" }),
    new RegExp(`at most ${MAX_LIBRARIES} libraries`, "i"),
  );
  assert.equal(plugin.getLibraries(true).length, MAX_LIBRARIES);
  assert.equal(plugin.savedData.length, 0);
});

test("generic notes can be assigned directly to a library without changing Markdown or personal path memberships", async () => {
  const file = new TFile("Knowledge Base/ENT/ALLERGODIL 0.1% NS 10 ML.md");
  file.stat.mtime = 43210;
  const frontmatter = { title: "ALLERGODIL 0.1% NS 10 ML", aliases: ["Azelastine nasal spray"], category: "ENT" };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.manualIndexPaths = [file.path];
  data.indexGroupByPath[file.path] = "ENT";
  data.collections = [{ id: "collection", title: "Review", collapsed: false, subjects: [file.path], subheadings: [] }];
  data.pinnedPaths = [file.path];
  data.nextStudyPaths = [file.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });

  const medication = plugin.getRecord(file.path);
  const subjectId = medication?.portableId ?? "";
  assert.ok(subjectId);
  assert.equal(medication?.kind, "medication");
  assert.equal(medication?.role, "library");
  assert.equal(medication?.domain, "Nasal medications");
  assert.equal(medication?.portableRelinkable, undefined);
  assert.equal(plugin.data.portableIndex.libraryLayouts.medication[0]?.subjects[0], subjectId);
  assert.equal(plugin.data.manualIndexPaths.includes(file.path), false);
  assert.equal(plugin.data.excludedIndexPaths.includes(file.path), true);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
  assert.deepEqual(plugin.data.pinnedPaths, [file.path]);
  assert.deepEqual(plugin.data.nextStudyPaths, [file.path]);
  assert.equal(file.path, "Knowledge Base/ENT/ALLERGODIL 0.1% NS 10 ML.md");
  assert.equal(file.stat.mtime, 43210);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
  await assert.rejects(
    plugin.unlinkPortableSubject(subjectId),
    /only a note explicitly linked from a portable placeholder/i,
  );
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");

  await plugin.undo();
  assert.equal(plugin.getRecord(file.path)?.kind, "topic");
  assert.equal(plugin.getRecord(file.path)?.portableId, undefined);
  assert.deepEqual(plugin.data.manualIndexPaths, [file.path]);
  assert.deepEqual(plugin.data.excludedIndexPaths, []);
  assert.equal(sourceMutationCount(), 0);
});

test("a deliberately deleted library heading stays deleted when the catalog is initialized again", async () => {
  const file = new TFile("Knowledge Base/ENT/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], {
    [file.path]: { title: "Allergodil" },
  });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });
  const subjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(subjectId);

  await plugin.mutate("Delete medication heading", () => {
    plugin.data.portableIndex.libraryLayouts.medication = [];
  }, { includePortableIndex: true, requireUndo: true });
  const saveCountAfterDelete = plugin.savedData.length;

  await plugin.initializeLibraryCatalog("medication");

  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication, []);
  assert.equal(plugin.data.portableIndex.libraries.some((library) => library.id === "medication"), true);
  assert.equal(plugin.savedData.length, saveCountAfterDelete, "re-entering Arrange must not save or recreate deliberate unplacement");
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(sourceMutationCount(), 0);
});

test("classifying one shared Markdown note as a medication is isolated to the active knowledge base", async () => {
  const file = new TFile("Knowledge Base/Shared/Allergodil.md");
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.workspaceName = "ENT medications";
  first.settings.primaryFolder = "Knowledge Base";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.workspaceName = "General notes";
  second.settings.primaryFolder = "Knowledge Base";
  const store = createDefaultStore(first, 100, "vault-library-isolation");
  store.bases.push(createKnowledgeBaseEntry(second, "base-general", 200));
  const { plugin, sourceMutationCount } = pluginWithFiles(store, [file], {
    [file.path]: { title: "Allergodil" },
  });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });
  const firstSubjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(firstSubjectId);
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");

  await plugin.switchKnowledgeBase("base-general");
  assert.equal(plugin.getRecord(file.path)?.kind, "topic");
  assert.equal(plugin.getRecord(file.path)?.portableId, undefined);
  assert.equal(plugin.data.portableIndex.libraryLayouts.medication, undefined);
  assert.equal(plugin.data.portableIndex.libraries.some((library) => library.id === "medication"), false);

  await plugin.switchKnowledgeBase("base-default");
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(plugin.getRecord(file.path)?.portableId, firstSubjectId);
  assert.equal(sourceMutationCount(), 0);
});

test("classification survives a store reload and Undo or Redo never loses pins, collections, or Next", async () => {
  const file = new TFile("Knowledge Base/ENT/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.pinnedPaths = [file.path];
  data.nextStudyPaths = [file.path];
  data.collections = [{
    id: "review",
    title: "Review",
    collapsed: false,
    subjects: [file.path],
    subheadings: [],
  }];
  const firstHarness = pluginWithFiles(data, [file], { [file.path]: { title: "Allergodil" } });
  await firstHarness.plugin.loadPluginData();
  await firstHarness.plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });
  const subjectId = firstHarness.plugin.getRecord(file.path)?.portableId ?? "";
  const persisted = structuredClone(firstHarness.plugin.savedData.at(-1));
  assert.ok(subjectId && persisted);

  const reloadedHarness = pluginWithFiles(persisted, [file], { [file.path]: { title: "Allergodil" } });
  const plugin = reloadedHarness.plugin;
  await plugin.loadPluginData();
  const assertPersonalMemberships = (): void => {
    assert.deepEqual(plugin.data.pinnedPaths, [file.path]);
    assert.deepEqual(plugin.data.nextStudyPaths, [file.path]);
    assert.deepEqual(plugin.data.collections[0]?.subjects, [file.path]);
  };

  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assertPersonalMemberships();

  await plugin.undo();
  assert.equal(plugin.getRecord(file.path)?.kind, "topic");
  assert.equal(plugin.getRecord(file.path)?.portableId, undefined);
  assertPersonalMemberships();

  await plugin.redo();
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assertPersonalMemberships();
  assert.equal(firstHarness.sourceMutationCount() + reloadedHarness.sourceMutationCount(), 0);
});

test("classified library identity and placement survive file and containing-folder renames", async () => {
  const file = new TFile("Knowledge Base/Old group/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], {
    [file.path]: { title: "Allergodil" },
  });
  await plugin.loadPluginData();
  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Nasal medications" });
  const subjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(subjectId);

  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { clearTimeout: () => {}, setTimeout: () => 1 } },
  });
  try {
    const handler = plugin as unknown as {
      handleRename(oldPath: string, newPath: string, folderRename: boolean): Promise<void>;
    };
    const oldFilePath = file.path;
    file.path = "Knowledge Base/Old group/Azelastine.md";
    await handler.handleRename(oldFilePath, file.path, false);
    assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], file.path);

    file.path = "Knowledge Base/New group/Azelastine.md";
    await handler.handleRename("Knowledge Base/Old group", "Knowledge Base/New group", true);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }

  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId[subjectId], file.path);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[0]?.subjects, [subjectId]);
  assert.equal(plugin.getRecord(file.path)?.kind, "medication");
  assert.equal(plugin.getRecord(file.path)?.portableId, subjectId);
  assert.equal(sourceMutationCount(), 0);
});

test("library moves keep one stable identity, isolate same-title catalog groups, and can return to the topic index", async () => {
  const medicationFile = new TFile("Knowledge Base/Allergodil.md");
  const procedureFile = new TFile("Knowledge Base/Septoplasty.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  data.pinnedPaths = [medicationFile.path];
  data.nextStudyPaths = [medicationFile.path];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [medicationFile, procedureFile], {
    [medicationFile.path]: { title: "Allergodil" },
    [procedureFile.path]: { title: "Septoplasty" },
  });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(medicationFile.path, "medication", { headingTitle: "General" });
  const stableId = plugin.getRecord(medicationFile.path)?.portableId ?? "";
  const medicationGroupId = plugin.getPortableSubject(stableId)?.groupId ?? "";
  await plugin.assignRecordToCatalog(procedureFile.path, "procedure", { headingTitle: "General" });
  const procedureId = plugin.getRecord(procedureFile.path)?.portableId ?? "";
  const procedureGroupId = plugin.getPortableSubject(procedureId)?.groupId ?? "";

  assert.ok(stableId);
  assert.ok(procedureId);
  assert.notEqual(medicationGroupId, procedureGroupId);
  assert.equal(plugin.data.portableIndex.groups.find((group) => group.id === medicationGroupId)?.title, "General");
  assert.equal(plugin.data.portableIndex.groups.find((group) => group.id === procedureGroupId)?.title, "General");

  await plugin.assignRecordToCatalog(medicationFile.path, "syndrome", { headingTitle: "General" });
  assert.equal(plugin.getRecord(medicationFile.path)?.portableId, stableId);
  assert.equal(plugin.getRecord(medicationFile.path)?.kind, "syndrome");
  assert.equal(plugin.data.portableIndex.libraryLayouts.medication.some((heading) => heading.subjects.includes(stableId)), false);
  assert.equal(plugin.data.portableIndex.libraryLayouts.syndrome.filter((heading) => heading.subjects.includes(stableId)).length, 1);

  await plugin.assignRecordToCatalog(medicationFile.path, "topic", { headingTitle: "Therapeutics" });
  assert.equal(plugin.getRecord(medicationFile.path)?.portableId, stableId);
  assert.equal(plugin.getRecord(medicationFile.path)?.kind, "syndrome", "moving to the index must not erase semantic type");
  assert.equal(plugin.getRecord(medicationFile.path)?.libraryId, undefined);
  assert.equal(plugin.getPortableSubject(stableId)?.indexed, true);
  assert.equal(plugin.data.indexGroupByPath[medicationFile.path], "Therapeutics");
  assert.equal(plugin.data.excludedIndexPaths.includes(medicationFile.path), false);
  const genericTree = buildCurriculumTree(plugin.getRecords(), plugin.data.curriculumVisual, false);
  assert.equal(genericTree.nodeByPath.has(medicationFile.path), true, "a Generic indexed non-topic remains visible in the rendered Index tree");
  assert.equal(
    buildCurriculumTree(plugin.getRecords(), plugin.data.curriculumVisual, true).nodeByPath.has(medicationFile.path),
    false,
    "the ENT topic-only projection remains defensive",
  );
  for (const kind of ["procedure", "medication", "syndrome"] as const) {
    assert.equal(plugin.data.portableIndex.libraryLayouts[kind].some((heading) => heading.subjects.includes(stableId)
      || heading.subheadings.some((subheading) => subheading.subjects.includes(stableId))), false);
  }
  await plugin.assignRecordToCatalog(medicationFile.path, "medication", { headingTitle: "General" });
  await plugin.removeRecordFromCatalog(medicationFile.path);
  assert.equal(plugin.getRecord(medicationFile.path)?.portableId, stableId);
  assert.equal(plugin.getRecord(medicationFile.path)?.kind, "medication", "unassigning a visual library must preserve semantic type");
  assert.equal(plugin.getRecord(medicationFile.path)?.libraryId, undefined);
  assert.equal(plugin.getIndexRecords().some((record) => record.path === medicationFile.path), false);
  for (const libraryKind of ["procedure", "medication", "syndrome"] as const) {
    assert.equal(plugin.data.portableIndex.libraryLayouts[libraryKind].some((heading) => heading.subjects.includes(stableId)
      || heading.subheadings.some((subheading) => subheading.subjects.includes(stableId))), false);
  }
  assert.deepEqual(plugin.data.pinnedPaths, [medicationFile.path]);
  assert.deepEqual(plugin.data.nextStudyPaths, [medicationFile.path]);
  assert.equal(sourceMutationCount(), 0);
});

test("portable placeholders can be placed once under a library subheading and detach topic children safely", async () => {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const parentId = "portable-parent";
  const childId = "portable-child";
  const parentPath = portablePlaceholderPath(parentId);
  const childPath = portablePlaceholderPath(childId);
  data.portableIndex.groups = [{ id: "topic-group", title: "ENT", order: 0 }];
  data.portableIndex.subjects = [
    { id: parentId, title: "Laryngeal cleft", groupId: "topic-group", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    { id: childId, title: "Repair", groupId: "topic-group", parentId, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
  ];
  data.manualIndexPaths = [parentPath, childPath];
  data.curriculumVisual.parentByPath[childPath] = parentPath;
  data.portableIndex.libraryLayouts.medication = [{
    id: "medication-heading",
    title: "ENT medications",
    collapsed: false,
    subjects: [],
    subheadings: [{ id: "nasal", title: "Nasal", collapsed: false, subjects: [] }],
  }];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [], {});
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(parentPath, "medication", { headingId: "medication-heading", subheadingId: "nasal" });

  assert.equal(plugin.getRecord(parentPath)?.portableId, parentId);
  assert.equal(plugin.getRecord(parentPath)?.kind, "medication");
  assert.equal(plugin.getRecord(parentPath)?.domain, "ENT medications");
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[0]?.subheadings[0]?.subjects, [parentId]);
  assert.equal(plugin.getPortableSubject(parentId)?.parentId, null);
  assert.equal(plugin.getPortableSubject(childId)?.parentId, null);
  assert.equal(plugin.data.curriculumVisual.parentByPath[childPath], null);
  assert.equal(plugin.data.manualIndexPaths.includes(parentPath), false);
  assert.equal(plugin.data.manualIndexPaths.includes(childPath), true);
  assert.equal(sourceMutationCount(), 0);
});

test("ENT protected clinical records and non-topic placeholders cannot enter the Index through direct assignment", async () => {
  const procedure = new TFile("04 Procedures/Procedure - Septoplasty.md");
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const syndrome = new TFile("06 Clinical Tools/Syndromes/Syndrome - Usher.md");
  const proposal = new TFile("01 Inbox/ENT Topic Proposals/Proposal - Bare proposal.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/ENT Topic Proposals";
  data.portableIndex.groups = [{ id: "clinical-imports", title: "Clinical imports", order: 0 }];
  data.portableIndex.subjects = (["procedure", "medication", "syndrome", "proposal", "note"] as const).map((kind, order) => ({
    id: `placeholder-${kind}`,
    title: `${kind} placeholder`,
    groupId: "clinical-imports",
    parentId: null,
    order,
    indexed: false,
    configuredId: "",
    recordKind: kind,
    libraryId: null,
  }));
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [procedure, medication, syndrome, proposal], {
    [procedure.path]: { title: "Septoplasty" },
    [medication.path]: { title: "Allergodil" },
    [syndrome.path]: { title: "Usher syndrome" },
    [proposal.path]: { type: "topic-proposal", title: "Bare proposal" },
  });
  await plugin.loadPluginData();
  plugin.savedData.length = 0;

  const protectedPaths = [
    procedure.path,
    medication.path,
    syndrome.path,
    proposal.path,
    ...data.portableIndex.subjects.map((subject) => portablePlaceholderPath(subject.id)),
  ];
  for (const path of protectedPaths) {
    const before = structuredClone(plugin.data);
    await assert.rejects(
      plugin.assignRecordToCatalog(path, "topic", { headingTitle: "Unsafe" }),
      /accepts topic subjects only/i,
    );
    assert.deepEqual(plugin.data, before, `${path} must be rejected before any Index state changes`);
  }

  assert.equal(plugin.savedData.length, 0);
  assert.equal(sourceMutationCount(), 0);
});

test("an ENT native topic can return from a custom Library to the protected Index", async () => {
  const topic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  const frontmatter = {
    title: "Pediatric airway",
    curriculum_id: "ENT-PED-001",
    domain: "Pediatric",
    topic_kind: "clinical-approach",
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [topic], { [topic.path]: frontmatter });
  await plugin.loadPluginData();
  const customLibraryId = await plugin.createLibrary({ name: "Exam review", singularName: "Review topic", icon: "bookmark" });

  const before = plugin.getRecord(topic.path);
  assert.deepEqual(
    { kind: before?.kind, role: before?.role, topicKind: before?.topicKind },
    { kind: "topic", role: "canonical", topicKind: "clinical-approach" },
  );
  assert.equal(plugin.getIndexRecords().some((record) => record.path === topic.path), true);

  await plugin.assignRecordToLibrary(topic.path, customLibraryId, { headingTitle: "Airway" });
  const during = plugin.getRecord(topic.path);
  assert.deepEqual(
    { kind: during?.kind, role: during?.role, topicKind: during?.topicKind, libraryId: during?.libraryId },
    { kind: "topic", role: "canonical", topicKind: "clinical-approach", libraryId: customLibraryId },
  );
  assert.ok(plugin.data.excludedIndexPaths.includes(topic.path));
  assert.equal(plugin.getIndexRecords().some((record) => record.path === topic.path), false, "Library membership alone removes the source-preserved topic from the Index");
  assert.equal(plugin.getRecordIndexDestinationError(topic.path), null);

  await plugin.assignRecordToCatalog(topic.path, "topic", { headingTitle: "Pediatric" });

  const after = plugin.getRecord(topic.path);
  assert.deepEqual(
    { kind: after?.kind, role: after?.role, topicKind: after?.topicKind, libraryId: after?.libraryId },
    { kind: "topic", role: "canonical", topicKind: "clinical-approach", libraryId: undefined },
  );
  assert.equal(plugin.getPortableSubject(plugin.getRecord(topic.path)?.portableId ?? "")?.indexed, true);
  assert.equal(plugin.data.excludedIndexPaths.includes(topic.path), false);
  assert.equal(sourceMutationCount(), 0);
});

test("the post-import ENT invariant rejects a topic identity resolved to a native medication source", async () => {
  const medication = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [medication], {
    [medication.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
  });
  await plugin.loadPluginData();
  // Simulate the state inside an import transaction. Startup remediation has
  // already run, so this specifically exercises the post-apply invariant.
  plugin.data.portableIndex.groups = [{ id: "imported-index", title: "Imported Index", order: 0 }];
  plugin.data.portableIndex.subjects = [{
    id: "incoming-topic-collision",
    title: "Imported topic label",
    groupId: "imported-index",
    parentId: null,
    order: 0,
    indexed: true,
    configuredId: "",
    recordKind: "topic",
    libraryId: null,
  }];
  plugin.data.portableIndex.resolvedPathBySubjectId = { "incoming-topic-collision": medication.path };
  plugin.data.manualIndexPaths = [medication.path];
  const before = structuredClone(plugin.data);

  assert.throws(
    () => plugin.assertClinicalIndexEligibility(),
    /source-classified as medication.*ENT Index was not changed/is,
  );

  assert.deepEqual(plugin.data, before);
  assert.equal(sourceMutationCount(), 0);
});

test("clinical libraries allow same-kind visual placement but reject cross-kind reclassification", async () => {
  const file = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const frontmatter = { title: "Allergodil", ent_domains: ["Rhinology"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  await plugin.assignRecordToCatalog(file.path, "medication", { headingTitle: "Topical nasal therapy" });
  const subjectId = plugin.getRecord(file.path)?.portableId ?? "";
  assert.ok(subjectId);
  assert.equal(plugin.getRecord(file.path)?.domain, "Topical nasal therapy");
  const before = structuredClone(plugin.data.portableIndex);
  await assert.rejects(
    plugin.assignRecordToCatalog(file.path, "syndrome", { headingTitle: "Rhinology" }),
    /clinical source classification is fixed/i,
  );
  assert.deepEqual(plugin.data.portableIndex, before);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("an ENT native topic keeps its source classification when portable data has a conflicting catalog kind", async () => {
  const file = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Airway.md");
  const frontmatter = {
    title: "Pediatric airway",
    curriculum_id: "ENT-PED-001",
    domain: "Pediatric",
    review_status: "unverified",
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  data.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  data.portableIndex.subjects = [{
    id: "conflicting-subject",
    title: "Incorrect imported medication",
    groupId: "medications",
    parentId: null,
    order: 0,
    indexed: false,
    configuredId: "",
    recordKind: "medication",
  }];
  data.portableIndex.resolvedPathBySubjectId = { "conflicting-subject": file.path };
  data.portableIndex.libraryLayouts.medication = [{
    id: "medications-heading",
    title: "Imported medications",
    collapsed: false,
    subjects: ["conflicting-subject"],
    subheadings: [],
  }];
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: frontmatter });
  await plugin.loadPluginData();

  const projected = plugin.getRecord(file.path);
  assert.equal(projected?.kind, "topic");
  assert.equal(projected?.role, "canonical");
  assert.equal(projected?.domain, "Pediatric");
  assert.equal(plugin.getIndexRecords().some((record) => record.path === file.path), true);
  assert.equal(sourceMutationCount(), 0);
});

test("initializing a native clinical library adopts its fallback groups in one idempotent Undo-safe transaction", async () => {
  const rhinology = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const otology = new TFile("06 Clinical Tools/Medications/Drug - Ciprofloxacin.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [rhinology, otology], {
    [rhinology.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
    [otology.path]: { title: "Ciprofloxacin", ent_domains: ["Otology"] },
  });
  await plugin.loadPluginData();

  await plugin.initializeLibraryCatalog("medication");

  const records = plugin.getRecords().filter((record) => record.kind === "medication");
  assert.equal(records.length, 2);
  assert.ok(records.every((record) => record.portableId));
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication.map((heading) => heading.title).sort(), ["Otology", "Rhinology"]);
  for (const record of records) {
    assert.equal(plugin.data.portableIndex.libraryLayouts.medication.filter((heading) => heading.subjects.includes(record.portableId ?? "")
      || heading.subheadings.some((subheading) => subheading.subjects.includes(record.portableId ?? ""))).length, 1);
  }
  const saveCount = plugin.savedData.length;
  await plugin.initializeLibraryCatalog("medication");
  assert.equal(plugin.savedData.length, saveCount);
  assert.equal(sourceMutationCount(), 0);

  await plugin.undo();
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication, []);
  assert.equal(plugin.data.portableIndex.subjects.length, 0);
  assert.equal(sourceMutationCount(), 0);
});

test("Library counts use unique projected records before and after native catalog initialization", async () => {
  const procedure = new TFile("04 Procedures/Procedure - Direct laryngoscopy.md");
  const allergodil = new TFile("06 Clinical Tools/Medications/Drug - Allergodil.md");
  const ciprofloxacin = new TFile("06 Clinical Tools/Medications/Drug - Ciprofloxacin.md");
  const syndrome = new TFile("06 Clinical Tools/Syndromes/Syndrome - CHARGE.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.portableIndex.groups = [
    { id: "group-imported-medications", title: "Imported medications", order: 0 },
    { id: "group-custom", title: "Reading", order: 1 },
  ];
  data.portableIndex.libraries = [
    ...BUILTIN_LIBRARY_DEFINITIONS.map((library) => ({ ...library })),
    {
      id: "library-reading",
      name: "Reading",
      singularName: "Paper",
      icon: "book-open",
      order: 3,
      sourceKind: null,
      archivedAt: null,
    },
  ];
  data.portableIndex.subjects = [
    {
      id: "subject-imported-medication",
      title: "Imported medication",
      groupId: "group-imported-medications",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "medication",
      libraryId: "medication",
    },
    {
      id: "subject-reading-placeholder",
      title: "Future paper",
      groupId: "group-custom",
      parentId: null,
      order: 1,
      indexed: false,
      configuredId: "",
      recordKind: "note",
      libraryId: "library-reading",
    },
  ];
  data.portableIndex.libraryLayouts = {
    procedure: [],
    medication: [],
    syndrome: [],
    "library-reading": [],
  };
  const { plugin, vaultEnumerationCount } = pluginWithFiles(
    data,
    [procedure, allergodil, ciprofloxacin, syndrome],
    {
      [procedure.path]: { title: "Direct laryngoscopy", domain: "Airway" },
      [allergodil.path]: { title: "Allergodil", ent_domains: ["Rhinology"] },
      [ciprofloxacin.path]: { title: "Ciprofloxacin", ent_domains: ["Otology"] },
      [syndrome.path]: { title: "CHARGE", syndrome_group: "Congenital" },
    },
  );
  await plugin.loadPluginData();

  assert.equal(plugin.librarySubjectCount("procedure"), 1);
  assert.equal(plugin.librarySubjectCount("medication"), 3, "two native notes plus one imported placeholder");
  assert.equal(plugin.librarySubjectCount("syndrome"), 1);
  assert.equal(plugin.librarySubjectCount("library-reading"), 1);
  assert.equal(vaultEnumerationCount(), 1, "all Library counts reuse one cached record projection");

  await plugin.initializeLibraryCatalog("medication");

  assert.equal(plugin.librarySubjectCount("medication"), 3, "portable adoption must not double-count native notes");
  assert.equal(
    new Set(plugin.getRecords().filter((record) => record.libraryId === "medication").map((record) => record.path)).size,
    3,
  );
  assert.equal(plugin.librarySubjectCount("library-reading"), 1, "custom placeholders remain counted after adoption");
});

test("immutable source books cannot be assigned to a catalog", async () => {
  const file = new TFile("05 Sources/_books/Reference/Chapter.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: { title: "Chapter" } });
  await plugin.loadPluginData();
  const before = structuredClone(plugin.data.portableIndex);

  await assert.rejects(plugin.assignRecordToCatalog(file.path, "medication"), /immutable source-book/i);

  assert.deepEqual(plugin.data.portableIndex, before);
  assert.equal(sourceMutationCount(), 0);
});

test("portable identity merges rewrite and deduplicate library layout subject IDs", async () => {
  const file = new TFile("Reference/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: { title: "Allergodil" } });
  await plugin.loadPluginData();
  plugin.data.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  plugin.data.portableIndex.subjects = [
    { id: "imported", title: "Allergodil", groupId: "medications", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    { id: "local", title: "Allergodil local", groupId: "medications", parentId: null, order: 1, indexed: false, configuredId: "", recordKind: "medication" },
  ];
  plugin.data.portableIndex.resolvedPathBySubjectId = { local: file.path };
  plugin.data.portableIndex.libraryLayouts.medication = [{
    id: "medications-heading",
    title: "Medications",
    collapsed: false,
    subjects: ["imported", "local"],
    subheadings: [],
  }];
  plugin.invalidateRecordCache();

  await plugin.resolvePortableSubject("imported", file.path, true);

  assert.equal(plugin.getPortableSubject("local"), null);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.imported, file.path);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[0]?.subjects, ["imported"]);
  assert.equal(plugin.getRecord(file.path)?.portableId, "imported");
  assert.equal(sourceMutationCount(), 0);
});

test("portable identity merges preserve the survivor's existing library placement", async () => {
  const file = new TFile("Reference/Allergodil.md");
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [file], { [file.path]: { title: "Allergodil" } });
  await plugin.loadPluginData();
  plugin.data.portableIndex.groups = [{ id: "medications", title: "Medications", order: 0 }];
  plugin.data.portableIndex.subjects = [
    { id: "survivor", title: "Allergodil", groupId: "medications", parentId: null, order: 0, indexed: false, configuredId: "", recordKind: "medication" },
    { id: "owner", title: "Allergodil local", groupId: "medications", parentId: null, order: 1, indexed: false, configuredId: "", recordKind: "medication" },
  ];
  plugin.data.portableIndex.resolvedPathBySubjectId = { owner: file.path };
  plugin.data.portableIndex.libraryLayouts.medication = [
    { id: "owner-heading", title: "Old placement", collapsed: false, subjects: ["owner"], subheadings: [] },
    { id: "survivor-heading", title: "Preferred placement", collapsed: false, subjects: ["survivor"], subheadings: [] },
  ];
  plugin.invalidateRecordCache();

  await plugin.resolvePortableSubject("survivor", file.path, true);

  assert.equal(plugin.getPortableSubject("owner"), null);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[0]?.subjects, []);
  assert.deepEqual(plugin.data.portableIndex.libraryLayouts.medication[1]?.subjects, ["survivor"]);
  assert.equal(plugin.getRecord(file.path)?.portableId, "survivor");
  assert.equal(sourceMutationCount(), 0);
});

test("a linked generic syndrome keeps its library role and portable group through synchronization and re-export", async () => {
  const linkedFile = new TFile("Reference/Usher syndrome.md");
  linkedFile.stat.mtime = 97531;
  const frontmatter = { title: "Usher syndrome", tags: ["reference"] };
  const originalFrontmatter = structuredClone(frontmatter);
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge Base";
  const subjectId = "subject-usher-portable";
  const groupId = "group-inherited-syndromes";
  data.portableIndex = {
    version: 1,
    groups: [{ id: groupId, title: "Inherited syndromes", order: 0 }],
    subjects: [{
      id: subjectId,
      title: "Usher syndrome",
      groupId,
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "syndrome",
    }],
    resolvedPathBySubjectId: {},
  };
  const { plugin, sourceMutationCount } = pluginWithFiles(data, [linkedFile], { [linkedFile.path]: frontmatter });
  await plugin.loadPluginData();
  await plugin.resolvePortableSubject(subjectId, linkedFile.path);

  plugin.invalidateRecordCache();
  const rebuilt = plugin.getRecord(linkedFile.path);
  assert.equal(rebuilt?.kind, "syndrome");
  assert.equal(rebuilt?.role, "library");
  assert.equal(rebuilt?.domain, "Inherited syndromes");

  synchronizePortableRegistry(plugin.data, plugin.getRecords());
  plugin.invalidateRecordCache();
  const synchronized = plugin.getRecord(linkedFile.path);
  const synchronizedSubject = plugin.getPortableSubject(subjectId);
  assert.equal(synchronized?.kind, "syndrome");
  assert.equal(synchronized?.role, "library");
  assert.equal(synchronized?.domain, "Inherited syndromes");
  assert.equal(synchronizedSubject?.groupId, groupId);
  assert.equal(synchronizedSubject?.recordKind, "syndrome");
  assert.equal(synchronizedSubject?.indexed, false);

  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    {
      workspace: false,
      index: false,
      procedures: false,
      medications: false,
      syndromes: true,
      collections: false,
      study: false,
      savedViews: false,
      recovery: false,
    },
    "2026-08-08T00:00:00.000Z",
  )));
  const exportedSubject = exported.components.index?.subjects.find((subject) => subject.id === subjectId);
  assert.equal(exportedSubject?.recordKind, "syndrome");
  assert.equal(exportedSubject?.libraryId, "syndrome");
  assert.equal(exportedSubject?.groupId, groupId);
  assert.equal(exported.components.index?.groups.find((group) => group.id === groupId)?.title, "Inherited syndromes");
  assert.deepEqual(exported.components.index?.includedSections, {
    index: false,
    libraryIds: ["syndrome"],
  });
  assert.equal(linkedFile.stat.mtime, 97531);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(sourceMutationCount(), 0);
});

test("portable linking rejects configured-ID and record-kind mismatches before mutating identity state", async () => {
  const wrongTopic = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-999 - Wrong topic.md");
  const wrongDomainSupporting = new TFile("03 Clinical Topics/02 Otology/Supporting note.md");
  const procedure = new TFile("04 Procedures/Procedure - Airway Endoscopy.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => [wrongTopic, wrongDomainSupporting, procedure].find((file) => file.path === path) ?? null,
      getMarkdownFiles: () => [wrongTopic, wrongDomainSupporting, procedure],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => file.path === wrongTopic.path
        ? { frontmatter: { title: "Wrong topic", curriculum_id: "ENT-PED-999", domain: "Pediatric" } }
        : file.path === wrongDomainSupporting.path
          ? { frontmatter: { title: "Supporting note", domain: "Otology" } }
          : { frontmatter: { title: "Airway Endoscopy", type: "procedure", domain: "Airway" } },
      resolvedLinks: {},
    },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.settings.workspaceMode = "ent-clinical";
  plugin.data.settings.primaryFolder = "03 Clinical Topics";
  plugin.data.settings.idProperty = "curriculum_id";
  const subjectId = "subject-cleft";
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-pediatric", title: "Pediatric", order: 0 }],
    subjects: [{ id: subjectId, title: "Laryngeal Cleft", groupId: "group-pediatric", parentId: null, order: 0, indexed: true, configuredId: "ENT-PED-003.05", recordKind: "topic" }],
    resolvedPathBySubjectId: {},
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath(subjectId)];
  const before = structuredClone(plugin.data.portableIndex);

  await assert.rejects(plugin.resolvePortableSubject(subjectId, wrongTopic.path), /configured ID mismatch/i);
  await assert.rejects(plugin.resolvePortableSubject(subjectId, wrongDomainSupporting.path), /clinical group mismatch.*Pediatric.*Otology/i);
  await assert.rejects(plugin.resolvePortableSubject(subjectId, procedure.path), /procedure note cannot be linked/i);

  assert.deepEqual(plugin.data.portableIndex, before);
  assert.equal(plugin.data.undoStack.length, 0);
});

test("identity merge deterministically preserves the surviving parent and appends owner children", async () => {
  const ownerFile = new TFile("Knowledge Base/Airway/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Airway" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const path = (id: string): string => portablePlaceholderPath(id);
  plugin.data.portableIndex = {
    version: 3,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [
      { id: "target-parent", title: "Target parent", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-parent", title: "Owner parent", groupId: "group-airway", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "target", title: "Target", groupId: "group-airway", parentId: "target-parent", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-airway", parentId: "owner-parent", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "target-child", title: "Zulu target child", groupId: "group-airway", parentId: "target", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-child", title: "Alpha owner child", groupId: "group-airway", parentId: "owner", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
    relinkableSubjectIds: [],
    libraries: [],
    libraryLayouts: { procedure: [], medication: [], syndrome: [] },
  };
  plugin.data.manualIndexPaths = [path("target-parent"), path("owner-parent"), path("target"), ownerFile.path, path("target-child"), path("owner-child")];
  plugin.data.indexGroupByPath = Object.fromEntries(plugin.data.manualIndexPaths.map((subjectPath) => [subjectPath, "Airway"]));
  // Adversarial insertion order: the old implementation allowed the later
  // owner entry/container to overwrite the target survivor's placement.
  plugin.data.curriculumVisual.parentByPath = {
    [path("target")]: path("target-parent"),
    [ownerFile.path]: path("owner-parent"),
    [path("target-child")]: path("target"),
    [path("owner-child")]: ownerFile.path,
  };
  plugin.data.curriculumVisual.orderByContainer = {
    [`parent:${path("target-parent")}`]: [path("target")],
    [`parent:${path("owner-parent")}`]: [ownerFile.path],
    [`parent:${path("target")}`]: [path("target-child")],
    [`parent:${ownerFile.path}`]: [path("owner-child")],
  };
  const before = structuredClone(plugin.data);

  await plugin.resolvePortableSubject("target", ownerFile.path, true);

  assert.equal(plugin.data.curriculumVisual.parentByPath[ownerFile.path], path("target-parent"));
  assert.deepEqual(plugin.data.curriculumVisual.orderByContainer[`parent:${ownerFile.path}`], [path("target-child"), path("owner-child")]);
  assert.equal(plugin.getPortableSubject("owner"), null);
  assert.equal(plugin.getPortableSubject("owner-child")?.parentId, "target");

  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  const exportedSubjects = exported.components.index?.subjects ?? [];
  assert.equal(exportedSubjects.find((subject) => subject.id === "target")?.parentId, "target-parent");
  assert.deepEqual(exportedSubjects.filter((subject) => subject.parentId === "target").sort((a, b) => a.order - b.order).map((subject) => subject.id), ["target-child", "owner-child"]);

  await plugin.undo();
  assert.deepEqual(plugin.data.portableIndex, before.portableIndex);
  assert.deepEqual(plugin.data.curriculumVisual, before.curriculumVisual);
});

test("identity merge rejects owner children that would become cross-group descendants", async () => {
  const ownerFile = new TFile("Knowledge Base/Group B/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Group B" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-a", title: "Group A", order: 0 }, { id: "group-b", title: "Group B", order: 1 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-a", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-b", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner-child", title: "Owner child", groupId: "group-b", parentId: "owner", order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("target"), ownerFile.path, portablePlaceholderPath("owner-child")];
  const before = structuredClone(plugin.data.portableIndex);

  await assert.rejects(plugin.resolvePortableSubject("target", ownerFile.path, true), /across groups.*child subjects/i);

  assert.deepEqual(plugin.data.portableIndex, before);
});

test("cross-group identity merge without descendants keeps the surviving target group through export", async () => {
  const ownerFile = new TFile("Knowledge Base/Group B/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Group B" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const targetPath = portablePlaceholderPath("target");
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-a", title: "Group A", order: 0 }, { id: "group-b", title: "Group B", order: 1 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-a", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-b", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [targetPath, ownerFile.path];
  // Put the owner entry last to exercise a colliding path-map rewrite.
  plugin.data.indexGroupByPath = { [targetPath]: "Group A", [ownerFile.path]: "Group B" };

  await plugin.resolvePortableSubject("target", ownerFile.path, true);

  assert.equal(plugin.data.indexGroupByPath[ownerFile.path], "Group A");
  assert.equal(plugin.getRecord(ownerFile.path)?.domain, "Group A");
  const exported = parsePortableExport(structuredClone(createPortableExport(
    plugin.data,
    plugin.getRecords(),
    { workspace: false, index: true, collections: false, study: false, savedViews: false, recovery: false },
    "2026-08-08T00:00:00.000Z",
  )));
  const target = exported.components.index?.subjects.find((subject) => subject.id === "target");
  const targetGroup = exported.components.index?.groups.find((group) => group.id === target?.groupId);
  assert.equal(targetGroup?.title, "Group A");
  assert.equal(exported.components.index?.subjects.some((subject) => subject.id === "owner"), false);
});

test("linking refuses to mutate when a full portable Undo snapshot exceeds the safety budget", async () => {
  const ownerFile = new TFile("Knowledge Base/Large/Owner.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === ownerFile.path ? ownerFile : null,
      getMarkdownFiles: () => [ownerFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Large" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  const longTitle = "x".repeat(500);
  const filler = Array.from({ length: 25_000 }, (_, index) => ({
    id: `filler-${index}`,
    title: `${longTitle}${index}`,
    groupId: "group-large",
    parentId: null,
    order: index + 2,
    indexed: false,
    configuredId: "",
    recordKind: "topic" as const,
  }));
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-large", title: "Large", order: 0 }],
    subjects: [
      { id: "target", title: "Target", groupId: "group-large", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" },
      { id: "owner", title: "Owner", groupId: "group-large", parentId: null, order: 1, indexed: true, configuredId: "", recordKind: "topic" },
      ...filler,
    ],
    resolvedPathBySubjectId: { owner: ownerFile.path },
  };
  plugin.data.manualIndexPaths = [portablePlaceholderPath("target"), ownerFile.path];

  await assert.rejects(plugin.resolvePortableSubject("target", ownerFile.path, true), /too large for safe.*Undo/i);

  assert.equal(plugin.getPortableSubject("owner")?.id, "owner");
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.target, undefined);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.owner, ownerFile.path);
  assert.equal(plugin.data.undoStack.length, 0);
});

test("unlink rolls back in memory and on disk when its first save fails", async () => {
  const linkedFile = new TFile("Knowledge Base/Airway/Linked.md");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => path === linkedFile.path ? linkedFile : null,
      getMarkdownFiles: () => [linkedFile],
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: { category: "Airway" } }), resolvedLinks: {} },
    fileManager: {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = null;
  await plugin.loadPluginData();
  plugin.data.portableIndex = {
    version: 1,
    groups: [{ id: "group-airway", title: "Airway", order: 0 }],
    subjects: [{ id: "subject", title: "Linked", groupId: "group-airway", parentId: null, order: 0, indexed: true, configuredId: "", recordKind: "topic" }],
    resolvedPathBySubjectId: { subject: linkedFile.path },
    relinkableSubjectIds: ["subject"],
  };
  plugin.data.manualIndexPaths = [linkedFile.path];
  plugin.data.collections = [{ id: "airway", title: "Airway", collapsed: false, subjects: [linkedFile.path], subheadings: [] }];
  let saveAttempts = 0;
  plugin.saveData = async (value: unknown) => {
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error("simulated unlink save failure");
    plugin.savedData.push(structuredClone(value));
  };

  await assert.rejects(plugin.unlinkPortableSubject("subject"), /simulated unlink save failure/);

  assert.equal(saveAttempts, 2);
  assert.equal(plugin.data.portableIndex.resolvedPathBySubjectId.subject, linkedFile.path);
  assert.deepEqual(plugin.data.manualIndexPaths, [linkedFile.path]);
  assert.deepEqual(plugin.data.collections[0]?.subjects, [linkedFile.path]);
  const persisted = plugin.savedData.at(-1) as {
    activeBaseId?: string;
    bases?: Array<{
      id?: string;
      data?: { portableIndex?: { resolvedPathBySubjectId?: Record<string, string> } };
    }>;
  } | undefined;
  const persistedActive = persisted?.bases?.find((entry) => entry.id === persisted.activeBaseId);
  assert.equal(persistedActive?.data?.portableIndex?.resolvedPathBySubjectId?.subject, linkedFile.path);
});

test("failed note creation removes only folders created by that operation", async () => {
  const existing = new TFolder("Existing");
  const tree = trackedVaultTree([existing]);
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      create: async (): Promise<never> => { throw new Error("simulated note write failure"); },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { trashFile: (file: TAbstractFile) => tree.trashFile(file) },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-create-cleanup-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.createKnowledgeNote({
    title: "Failure",
    folder: "Existing/New/Deep",
    mode: "empty",
    templatePath: "",
    addToCollection: false,
  }), /simulated note write failure/);

  assert.deepEqual(tree.createdFolders, ["Existing/New", "Existing/New/Deep"]);
  assert.deepEqual(tree.trashedFolders, ["Existing/New/Deep", "Existing/New"]);
  assert.equal(tree.entries.get("Existing"), existing, "the pre-existing parent is preserved");
  assert.equal(tree.entries.has("Existing/New"), false);
  assert.equal(tree.entries.has("Existing/New/Deep"), false);
});

test("portable JSON serialization fails before creating an export folder", async () => {
  const tree = trackedVaultTree([]);
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => [],
      createFolder: (path: string) => tree.createFolder(path),
      create: async (): Promise<never> => { throw new Error("create must not run"); },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { trashFile: (file: TAbstractFile) => tree.trashFile(file) },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(migrateData(null), 1, "vault-export-serialization-test");
  await plugin.loadPluginData();
  const circular: { self?: unknown } = {};
  circular.self = circular;

  await assert.rejects(plugin.writePortableJson("workspace", circular), /circular/i);

  assert.deepEqual(tree.createdFolders, []);
  assert.deepEqual(tree.trashedFolders, []);
  assert.equal(tree.entries.has("Knowledge Base Command Center Exports"), false);
});

test("proposal promotion restores the original note and removes its empty destination folder when rewriting fails", async () => {
  const proposalsRoot = new TFolder("01 Inbox");
  const proposalFolder = new TFolder("01 Inbox/Topic Proposals");
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const sourcePath = "01 Inbox/Topic Proposals/Laryngeal cleft.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([proposalsRoot, proposalFolder, clinicalRoot, source]);
  const originalContent = "---\ntype: topic-proposal\ntitle: Laryngeal cleft\nreview_status: unverified\n---\n# Laryngeal cleft\n\nOriginal proposal body.\n";
  let content = originalContent;
  const originalFrontmatter: Record<string, unknown> = {
    type: "topic-proposal",
    title: "Laryngeal cleft",
    review_status: "unverified",
  };
  const frontmatter = structuredClone(originalFrontmatter);
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async () => content,
      process: async (_file: TFile, update: (current: string) => string): Promise<void> => {
        processCalls += 1;
        if (processCalls === 1) throw new Error("simulated heading rewrite failure");
        content = update(content);
        for (const key of Object.keys(frontmatter)) delete frontmatter[key];
        Object.assign(frontmatter, originalFrontmatter);
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), resolvedLinks: {} },
    fileManager: {
      renameFile: (file: TFile, destination: string) => tree.renameFile(file, destination),
      processFrontMatter: async (_file: TFile, update: (metadata: Record<string, unknown>) => void) => { update(frontmatter); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-promotion-rollback-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.promoteProposal(sourcePath, {
    title: "Laryngeal cleft",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: true,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  }), /simulated heading rewrite failure/);

  assert.equal(source.path, sourcePath);
  assert.equal(tree.entries.get(sourcePath), source);
  assert.equal(content, originalContent);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.deepEqual(tree.trashedFolders, ["03 Clinical Topics/03 Laryngology"]);
  assert.equal(tree.entries.has("03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Laryngeal cleft.md"), false);
});

test("proposal promotion rollback never overwrites a destination created concurrently by Sync", async () => {
  const proposalFolder = new TFolder("01 Inbox/Topic Proposals");
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const laryngologyFolder = new TFolder("03 Clinical Topics/03 Laryngology");
  const sourcePath = "01 Inbox/Topic Proposals/Laryngeal cleft.md";
  const destination = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Laryngeal cleft.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([proposalFolder, clinicalRoot, laryngologyFolder, source]);
  const originalContent = "---\ntype: topic-proposal\ntitle: Laryngeal cleft\nreview_status: unverified\n---\n# Laryngeal cleft\n\nOriginal proposal body.\n";
  const concurrentContent = "# Unrelated note created by Sync\n\nDo not overwrite.\n";
  let sourceContent = originalContent;
  let destinationContent = concurrentContent;
  let concurrentFile: TFile | null = null;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async (file: TFile) => file === source ? sourceContent : destinationContent,
      process: async (file: TFile, update: (current: string) => string): Promise<void> => {
        if (file === source) sourceContent = update(sourceContent);
        else if (file === concurrentFile) destinationContent = update(destinationContent);
        else throw new Error("Unexpected file passed to rollback processing.");
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: file === source
        ? { type: "topic-proposal", title: "Laryngeal cleft", review_status: "unverified" }
        : { title: "Unrelated note created by Sync" } }),
      resolvedLinks: {},
    },
    fileManager: {
      renameFile: async (): Promise<void> => {
        concurrentFile = new TFile(destination);
        tree.entries.set(destination, concurrentFile);
        laryngologyFolder.children.push(concurrentFile);
        throw new Error("simulated concurrent destination conflict");
      },
      processFrontMatter: async (): Promise<never> => { throw new Error("frontmatter processing must not run after rename rejection"); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-promotion-sync-race-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.promoteProposal(sourcePath, {
    title: "Laryngeal cleft",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: true,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  }), /simulated concurrent destination conflict/);

  assert.equal(source.path, sourcePath);
  assert.equal(tree.entries.get(sourcePath), source);
  assert.equal(sourceContent, originalContent);
  assert.equal(tree.entries.get(destination), concurrentFile);
  assert.equal(destinationContent, concurrentContent, "rollback must not process the concurrently created destination");
  assert.deepEqual(tree.trashedFolders, [], "pre-existing folders remain untouched");
});

test("proposal promotion reports a combined recovery error if content rollback fails", async () => {
  const proposalFolder = new TFolder("01 Inbox/Topic Proposals");
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const sourcePath = "01 Inbox/Topic Proposals/Laryngeal cleft.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([proposalFolder, clinicalRoot, source]);
  const frontmatter: Record<string, unknown> = { type: "topic-proposal", title: "Laryngeal cleft", review_status: "unverified" };
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async () => "# Original proposal\n",
      process: async (): Promise<void> => {
        processCalls += 1;
        throw new Error(processCalls === 1 ? "simulated promotion failure" : "simulated rollback write failure");
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), resolvedLinks: {} },
    fileManager: {
      renameFile: (file: TFile, destination: string) => tree.renameFile(file, destination),
      processFrontMatter: async (_file: TFile, update: (metadata: Record<string, unknown>) => void) => { update(frontmatter); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.proposalFolder = "01 Inbox/Topic Proposals";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-promotion-rollback-failure-test");
  await plugin.loadPluginData();

  const loggedRollbackErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]): void => { loggedRollbackErrors.push(values); };
  try {
    await assert.rejects(plugin.promoteProposal(sourcePath, {
      title: "Laryngeal cleft",
      domain: "Laryngology",
      parentPath: "",
      topicKind: "condition",
      priority: "P1",
      safetyCritical: true,
      curriculumId: "ENT-LAR-010",
      addToCollection: false,
    }), (error: unknown) => {
      assert.match(String(error), /simulated promotion failure/);
      assert.match(String(error), /Automatic promotion rollback also failed/);
      assert.match(String(error), /simulated rollback write failure/);
      assert.match(String(error), /Inspect .*Laryngeal cleft\.md/);
      return true;
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(loggedRollbackErrors.length, 1, "the failed automatic rollback is logged once for diagnosis");
  assert.equal(source.path, sourcePath, "path restoration is still attempted after content restoration fails");
  assert.equal(tree.entries.get(sourcePath), source);
  assert.deepEqual(tree.trashedFolders, ["03 Clinical Topics/03 Laryngology"]);
});

test("failed canonical placement restores the original path and content", async () => {
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const laryngologyFolder = new TFolder("03 Clinical Topics/03 Laryngology");
  const sourcePath = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Original title.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([clinicalRoot, laryngologyFolder, source]);
  const originalContent = "---\ntype: clinical-topic\ntitle: Original title\ncurriculum_id: ENT-LAR-010\ndomain: Laryngology\nreview_status: unverified\n---\n# Original title\n\nClinical body.\n";
  let content = originalContent;
  const originalFrontmatter: Record<string, unknown> = {
    type: "clinical-topic",
    title: "Original title",
    curriculum_id: "ENT-LAR-010",
    domain: "Laryngology",
    topic_kind: "condition",
    priority: "P2",
    review_status: "unverified",
  };
  const frontmatter = structuredClone(originalFrontmatter);
  let processCalls = 0;
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async () => content,
      process: async (_file: TFile, update: (current: string) => string): Promise<void> => {
        processCalls += 1;
        if (processCalls === 1) throw new Error("simulated placement rewrite failure");
        content = update(content);
        for (const key of Object.keys(frontmatter)) delete frontmatter[key];
        Object.assign(frontmatter, originalFrontmatter);
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter }), resolvedLinks: {} },
    fileManager: {
      renameFile: (file: TFile, destination: string) => tree.renameFile(file, destination),
      processFrontMatter: async (_file: TFile, update: (metadata: Record<string, unknown>) => void) => { update(frontmatter); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-placement-rollback-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.editCanonicalPlacement(sourcePath, {
    title: "Updated title",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: false,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  }), /simulated placement rewrite failure/);

  assert.equal(source.path, sourcePath);
  assert.equal(tree.entries.get(sourcePath), source);
  assert.equal(content, originalContent);
  assert.deepEqual(frontmatter, originalFrontmatter);
  assert.equal(tree.entries.has("03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Updated title.md"), false);
  assert.deepEqual(tree.trashedFolders, [], "the pre-existing canonical folder is never removed");
});

test("canonical placement rollback never overwrites a destination created concurrently by Sync", async () => {
  const clinicalRoot = new TFolder("03 Clinical Topics");
  const laryngologyFolder = new TFolder("03 Clinical Topics/03 Laryngology");
  const sourcePath = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Original title.md";
  const destination = "03 Clinical Topics/03 Laryngology/ENT-LAR-010 - Updated title.md";
  const source = new TFile(sourcePath);
  const tree = trackedVaultTree([clinicalRoot, laryngologyFolder, source]);
  const originalContent = "---\ntype: clinical-topic\ntitle: Original title\ncurriculum_id: ENT-LAR-010\ndomain: Laryngology\nreview_status: unverified\n---\n# Original title\n\nClinical body.\n";
  const concurrentContent = "# Synced destination\n\nUnrelated content.\n";
  let sourceContent = originalContent;
  let destinationContent = concurrentContent;
  let concurrentFile: TFile | null = null;
  const originalFrontmatter: Record<string, unknown> = {
    type: "clinical-topic",
    title: "Original title",
    curriculum_id: "ENT-LAR-010",
    domain: "Laryngology",
    topic_kind: "condition",
    priority: "P2",
    review_status: "unverified",
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => tree.entries.get(path) ?? null,
      getMarkdownFiles: () => tree.markdownFiles(),
      createFolder: (path: string) => tree.createFolder(path),
      read: async (file: TFile) => file === source ? sourceContent : destinationContent,
      process: async (file: TFile, update: (current: string) => string): Promise<void> => {
        if (file === source) sourceContent = update(sourceContent);
        else if (file === concurrentFile) destinationContent = update(destinationContent);
        else throw new Error("Unexpected file passed to rollback processing.");
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: file === source
        ? originalFrontmatter
        : { title: "Synced destination" } }),
      resolvedLinks: {},
    },
    fileManager: {
      renameFile: async (): Promise<void> => {
        concurrentFile = new TFile(destination);
        tree.entries.set(destination, concurrentFile);
        laryngologyFolder.children.push(concurrentFile);
        throw new Error("simulated concurrent placement conflict");
      },
      processFrontMatter: async (): Promise<never> => { throw new Error("frontmatter processing must not run after rename rejection"); },
      trashFile: (file: TAbstractFile) => tree.trashFile(file),
    },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "03 Clinical Topics";
  data.settings.idProperty = "curriculum_id";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & TestPluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-placement-sync-race-test");
  await plugin.loadPluginData();

  await assert.rejects(plugin.editCanonicalPlacement(sourcePath, {
    title: "Updated title",
    domain: "Laryngology",
    parentPath: "",
    topicKind: "condition",
    priority: "P1",
    safetyCritical: false,
    curriculumId: "ENT-LAR-010",
    addToCollection: false,
  }), /simulated concurrent placement conflict/);

  assert.equal(source.path, sourcePath);
  assert.equal(tree.entries.get(sourcePath), source);
  assert.equal(sourceContent, originalContent);
  assert.equal(tree.entries.get(destination), concurrentFile);
  assert.equal(destinationContent, concurrentContent, "rollback must not process the concurrently created destination");
  assert.deepEqual(tree.trashedFolders, []);
});

test("cross-base search records retain each inactive base's own display aliases", async () => {
  const file = new TFile("Shared/Topic.md");
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.workspaceName = "First base";
  first.settings.primaryFolder = "Shared";
  first.displayNameByPath[file.path] = "First display";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.workspaceName = "Second base";
  second.settings.primaryFolder = "Shared";
  second.displayNameByPath[file.path] = "Second display";
  const store = createDefaultStore(first, 1, "vault-cross-base-alias-test");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 2));
  const { plugin } = pluginWithFiles(store, [file], { [file.path]: { title: "Source title" } });
  await plugin.loadPluginData();

  const results = await plugin.searchKnowledgeBases("source", { yieldEvery: Number.MAX_SAFE_INTEGER });

  assert.ok(results);
  assert.deepEqual(results.groups.map((group) => [group.source.baseName, group.records[0]?.title]), [
    ["First base", "First display"],
    ["Second base", "Second display"],
  ]);
  assert.equal(results.groups[1]?.records[0]?.sourceTitle, "Source title");
});

test("cross-base search omits hidden unreferenced ENT topics but preserves referenced source semantics", async () => {
  const file = new TFile("03 Clinical Topics/01 Pediatric/ENT-PED-001 - Hidden airway.md");
  const hidden = migrateData(null);
  hidden.settings.workspaceMode = "ent-clinical";
  hidden.settings.workspaceName = "Hidden base";
  hidden.settings.primaryFolder = "03 Clinical Topics";
  hidden.settings.idProperty = "curriculum_id";
  hidden.excludedIndexPaths = [file.path];
  const referenced = structuredClone(hidden);
  referenced.settings.workspaceName = "Referenced base";
  referenced.pinnedPaths = [file.path];
  const store = createDefaultStore(hidden, 1, "vault-hidden-search-test");
  store.bases.push(createKnowledgeBaseEntry(referenced, "base-referenced", 2));
  const { plugin } = pluginWithFiles(store, [file], {
    [file.path]: {
      title: "Hidden airway",
      curriculum_id: "ENT-PED-001",
      domain: "Pediatric",
    },
  });
  await plugin.loadPluginData();

  assert.equal(plugin.getRecord(file.path), null, "Hidden alone is not a searchable record reference");
  const results = await plugin.searchKnowledgeBases("hidden airway", { yieldEvery: Number.MAX_SAFE_INTEGER });

  assert.ok(results);
  assert.equal(results.total, 1);
  assert.equal(results.groups[0]?.source.baseName, "Referenced base");
  assert.equal(results.groups[0]?.records[0]?.kind, "topic");
  assert.equal(results.groups[0]?.records[0]?.role, "canonical");
  assert.equal(results.groups[0]?.records[0]?.portableIndexed, false);
});

test("cross-base search streams uncached bases through one bounded catalog without warming their record caches", async () => {
  const files = Array.from({ length: 40 }, (_, index) => new TFile(`Shared/Topic ${index + 1}.md`));
  const frontmatterByPath = Object.fromEntries(files.map((file, index) => [file.path, { title: `Topic ${index + 1}` }]));
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.workspaceName = "Base 1";
  first.settings.primaryFolder = "Shared";
  const store = createDefaultStore(first, 1, "vault-cross-base-snapshot-test");
  for (let index = 2; index <= 12; index += 1) {
    const data = migrateData(null);
    data.settings.workspaceMode = "generic";
    data.settings.workspaceName = `Base ${index}`;
    data.settings.primaryFolder = "Shared";
    store.bases.push(createKnowledgeBaseEntry(data, `base-${index}`, index));
  }
  const archivedData = migrateData(null);
  archivedData.settings.workspaceMode = "generic";
  archivedData.settings.workspaceName = "Archived base";
  archivedData.settings.primaryFolder = "Shared";
  const archivedEntry = createKnowledgeBaseEntry(archivedData, "base-archived-search", 13);
  archivedEntry.archivedAt = 14;
  archivedEntry.updatedAt = 14;
  store.bases.push(archivedEntry);
  const { plugin, metadataReadCount, vaultEnumerationCount } = pluginWithFiles(store, files, frontmatterByPath);
  const internal = plugin as unknown as { recordsCacheByBase: Map<string, unknown[]> };
  await plugin.loadPluginData();
  plugin.getRecords();

  const firstResults = await plugin.searchKnowledgeBases("topic", { yieldEvery: Number.MAX_SAFE_INTEGER });

  assert.ok(firstResults);
  assert.equal(firstResults.total, 12 * files.length);
  assert.equal(firstResults.counts.length, 12);
  assert.equal(firstResults.counts.every(({ total }) => total === files.length), true);
  assert.equal(firstResults.rendered, 300);
  assert.equal(firstResults.stats.peakRetainedCandidates, 300);
  assert.equal(firstResults.stats.sortedCandidates, 300);
  assert.deepEqual([...internal.recordsCacheByBase.keys()], ["base-default"], "search does not retain full inactive-base records");
  assert.equal(vaultEnumerationCount(), 2, "the active cache and lazy cross-base catalog each enumerate once");
  assert.equal(metadataReadCount(), files.length * 2, "the catalog reads each file once, not once per base");

  const secondResults = await plugin.searchKnowledgeBases("topic 1", { yieldEvery: Number.MAX_SAFE_INTEGER });

  assert.ok(secondResults);
  assert.equal(vaultEnumerationCount(), 2, "later queries reuse the bounded catalog generation");
  assert.equal(metadataReadCount(), files.length * 2, "later queries do not reread unchanged metadata");
  assert.deepEqual([...internal.recordsCacheByBase.keys()], ["base-default"]);
});

test("an invalidated yielded search never publishes a deleted inactive out-of-folder proposal", async () => {
  const proposal = new TFile("Notes/Adhoc proposal.md");
  const files = [proposal];
  const frontmatterByPath: Record<string, Record<string, unknown>> = {
    [proposal.path]: { type: "topic-proposal", title: "Adhoc proposal" },
  };
  const active = migrateData(null);
  active.settings.workspaceMode = "generic";
  active.settings.primaryFolder = "Active";
  const inactive = migrateData(null);
  inactive.settings.workspaceMode = "ent-clinical";
  inactive.settings.primaryFolder = "Clinical Topics";
  inactive.settings.proposalFolder = "Inbox/Topic Proposals";
  const store = createDefaultStore(active, 1, "vault-cross-base-cancel-test");
  store.bases.push(createKnowledgeBaseEntry(inactive, "base-inactive-clinical", 2));
  const { plugin } = pluginWithFiles(store, files, frontmatterByPath);
  const internal = plugin as unknown as {
    invalidateKnowledgeBaseSearchSnapshot(): void;
    recordsCacheByBase: Map<string, unknown[]>;
  };
  await plugin.loadPluginData();
  plugin.getRecords();

  const staleSearch = plugin.searchKnowledgeBases("adhoc", { yieldEvery: 1 });
  files.splice(0, files.length);
  delete frontmatterByPath[proposal.path];
  internal.invalidateKnowledgeBaseSearchSnapshot();

  assert.equal(await staleSearch, null, "generation invalidation cancels rather than publishing a partial stale result");
  const current = await plugin.searchKnowledgeBases("adhoc", { yieldEvery: Number.MAX_SAFE_INTEGER });
  assert.ok(current);
  assert.equal(current.total, 0);
  assert.deepEqual([...internal.recordsCacheByBase.keys()], ["base-default"], "the inactive clinical base remains lazy");
});

test("path-scoped vault-event invalidation preserves unrelated base caches and active links", async () => {
  const activeFile = new TFile("Active/Topic.md");
  const inactiveFile = new TFile("Inactive/Topic.md");
  const frontmatterByPath: Record<string, Record<string, unknown>> = {
    [activeFile.path]: { title: "Active topic", aliases: ["Active alias"] },
    [inactiveFile.path]: { title: "Inactive topic" },
  };
  const first = migrateData(null);
  first.settings.workspaceMode = "generic";
  first.settings.primaryFolder = "Active";
  const second = migrateData(null);
  second.settings.workspaceMode = "generic";
  second.settings.primaryFolder = "Inactive";
  const store = createDefaultStore(first, 1, "vault-cross-base-relevance-test");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 2));
  const { plugin, metadataReadCount, vaultEnumerationCount } = pluginWithFiles(
    store,
    [activeFile, inactiveFile],
    frontmatterByPath,
  );
  const internal = plugin as unknown as {
    excludedPathsCacheByBase: Map<string, Set<string>>;
    invalidateRecordCachesForPath(path: string): boolean;
    recordLinkIndex: Map<string, { title: string }>;
    recordLinkIndexBaseId: string;
    recordPathsCacheByBase: Map<string, Set<string>>;
    recordsCacheByBase: Map<string, unknown[]>;
    referencedPathsCacheByBase: Map<string, Set<string>>;
  };
  await plugin.loadPluginData();
  const activeRecords = plugin.getRecords();
  internal.recordsCacheByBase.set("base-second", []);
  internal.recordPathsCacheByBase.set("base-second", new Set([inactiveFile.path]));
  internal.referencedPathsCacheByBase.set("base-second", new Set());
  internal.excludedPathsCacheByBase.set("base-second", new Set());
  const activeReferenced = internal.referencedPathsCacheByBase.get("base-default");
  const inactiveReferenced = internal.referencedPathsCacheByBase.get("base-second");
  const activeExcluded = internal.excludedPathsCacheByBase.get("base-default");
  const inactiveExcluded = internal.excludedPathsCacheByBase.get("base-second");

  assert.equal(plugin.isRelevant("Inactive/Changed.md"), false, "the active-base helper remains base-local");
  assert.equal(internal.recordLinkIndexBaseId, "base-default");
  assert.equal(internal.recordLinkIndex.get("active alias")?.title, "Active topic");
  assert.equal(internal.invalidateRecordCachesForPath("Inactive/Changed.md"), true);
  assert.equal(internal.recordsCacheByBase.get("base-default"), activeRecords, "the active cache survives an inactive-only event");
  assert.equal(internal.recordsCacheByBase.has("base-second"), false, "only the affected inactive cache is evicted");
  assert.equal(plugin.getRecords(), activeRecords, "reading the active base remains a cache hit");
  assert.equal(internal.recordLinkIndexBaseId, "base-default", "the active link index remains valid");
  assert.equal(internal.recordLinkIndex.get("active alias")?.title, "Active topic");
  assert.equal(vaultEnumerationCount(), 1);
  assert.equal(metadataReadCount(), 1);
  assert.equal(internal.referencedPathsCacheByBase.get("base-default"), activeReferenced);
  assert.equal(internal.referencedPathsCacheByBase.get("base-second"), inactiveReferenced);
  assert.equal(internal.excludedPathsCacheByBase.get("base-default"), activeExcluded);
  assert.equal(internal.excludedPathsCacheByBase.get("base-second"), inactiveExcluded);

  frontmatterByPath[activeFile.path] = { title: "Updated active topic", aliases: ["Updated active alias"] };
  assert.equal(internal.invalidateRecordCachesForPath("Active/Changed.md"), true);
  assert.equal(internal.recordLinkIndexBaseId, "", "evicting the active base also invalidates its derived link index");
  assert.equal(internal.recordLinkIndex.size, 0);
  plugin.getRecords();
  assert.equal(internal.recordLinkIndexBaseId, "base-default");
  assert.equal(internal.recordLinkIndex.has("active alias"), false);
  assert.equal(internal.recordLinkIndex.get("updated active alias")?.title, "Updated active topic");
  assert.equal(internal.referencedPathsCacheByBase.get("base-default"), activeReferenced, "file events retain membership caches");
  assert.equal(internal.excludedPathsCacheByBase.get("base-default"), activeExcluded, "file events retain exclusion caches");
  assert.equal(internal.invalidateRecordCachesForPath("Outside/Changed.md"), false);
});

test("path-scoped invalidation tracks clinical proposals outside the configured Inbox", async () => {
  const files: TFile[] = [];
  const frontmatterByPath: Record<string, Record<string, unknown>> = {};
  const data = migrateData(null);
  data.settings.workspaceMode = "ent-clinical";
  data.settings.primaryFolder = "Clinical Topics";
  data.settings.proposalFolder = "Inbox/Topic Proposals";
  const store = createDefaultStore(data, 1, "vault-outside-proposal-event-test");
  const { plugin } = pluginWithFiles(store, files, frontmatterByPath);
  const internal = plugin as unknown as {
    invalidateRecordCachesForPath(path: string): boolean;
  };
  await plugin.loadPluginData();

  assert.deepEqual(plugin.getRecords(), [], "the initial empty cache is established");

  const file = new TFile("Notes/Adhoc proposal.md");
  files.push(file);
  frontmatterByPath[file.path] = { type: "topic-proposal", title: "Adhoc proposal" };
  assert.equal(internal.invalidateRecordCachesForPath(file.path), true, "a newly created out-of-folder proposal invalidates clinical caches");
  assert.deepEqual(plugin.getRecords().map((record) => [record.path, record.role]), [[file.path, "proposal"]]);

  frontmatterByPath[file.path] = { title: "Ordinary note" };
  assert.equal(internal.invalidateRecordCachesForPath(file.path), true, "the cached proposal path invalidates when its type is removed");
  assert.deepEqual(plugin.getRecords(), [], "the former proposal does not remain as a ghost record");

  frontmatterByPath[file.path] = { type: "topic-proposal", title: "Adhoc proposal" };
  assert.equal(internal.invalidateRecordCachesForPath(file.path), true);
  assert.equal(plugin.getRecords().length, 1);
  files.splice(files.indexOf(file), 1);
  delete frontmatterByPath[file.path];
  assert.equal(internal.invalidateRecordCachesForPath(file.path), true, "deleting the cached outside proposal invalidates by its prior record path");
  assert.deepEqual(plugin.getRecords(), []);
});
