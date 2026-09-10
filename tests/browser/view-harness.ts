import { Platform, Setting, TFile, type Modal, type SettingDefinitionItem } from "obsidian";
import type EntVaultCommandCenterPlugin from "../../src/main";
import { EntVaultCommandCenterView } from "../../src/view";
import { canonicalJsonString, createDefaultStore, migrateData, parseQuery, portablePlaceholderPath, snapshotPersonal, type VaultRecord } from "../../src/model";
import { BoundedKnowledgeBaseSearchCollector } from "../../src/search";
import { KnowledgeNoteModal, WorkspaceSetupModal } from "../../src/modals";
import { ExportImportCenterModal } from "../../src/portability-modal";
import { SyncRecoveryCenterModal } from "../../src/sync-recovery-modal";
import { NoteOrganizerModal, type NoteOrganizerHost } from "../../src/note-organizer-modal";
import { EntCommandCenterSettingsTab } from "../../src/settings";
import { UpdateAnnouncementModal } from "../../src/update-announcement-modal";
import { UPDATE_ANNOUNCEMENT_0_20_1 } from "../../src/update-announcement";

function record(index: number, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    path: `Research/Research note ${String(index).padStart(3, "0")}.md`,
    title: `Research note ${String(index).padStart(3, "0")}`,
    kind: "topic", role: "supporting", curriculumId: "", domain: "Research",
    topicKind: "Note", priority: "", reviewStatus: "unverified", synthesisStatus: "",
    autoresearchStatus: "", safetyCritical: false, sourceCount: 0, aliases: [],
    relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "",
    sourceCoverage: "", folderOrder: "Research", mtime: index, aiLock: false,
    ...overrides,
  };
}

interface SearchOptions {
  limit?: number;
  baseIds?: string[];
  libraryId?: string;
  availability?: "all" | "linked" | "placeholders";
  linkedFirst?: boolean;
}

const parameters = new URLSearchParams(location.hash.slice(1));
Platform.isMobile = parameters.get("mobile") === "true";
const mobileSpace = parameters.get("scenario") === "mobile-space";
const count = mobileSpace ? 8 : Number(parameters.get("count") ?? 650);
const data = migrateData(null);
Object.assign(data.settings, {
  workspaceMode: "generic", workspaceName: "Research workspace",
  workspaceSubtitle: "Synthetic notes for browser regression tests",
  setupComplete: true, enableHoverPreview: false,
});
if (mobileSpace) Object.assign(data.settings, {
  workspaceName: "My knowledge base",
  workspaceSubtitle: "Search, organize, arrange, and create notes without moving source files. Keep your research and reference notes together.",
});
data.activeTab = "curriculum";
data.indexGroupOrder = ["Research"];
data.portableIndex.libraries = [{ id: "reading", name: "Reading", singularName: "Reading note", icon: "book-open", order: 0, sourceKind: null, archivedAt: null }];
data.portableIndex.libraryLayouts.reading = [];
const records = Array.from({ length: count }, (_, index) => record(index));
records.push(record(count, { path: "Reading/Search reference.md", title: "Search reference", libraryId: "reading", role: "library" }));
records.push(record(count + 1, { path: portablePlaceholderPath("draft-search"), title: "Search draft", portableId: "draft-search", isPlaceholder: true }));
if (mobileSpace) {
  records.splice(count);
  data.portableIndex.libraries[0].name = "Resources";
  records.push(...Array.from({ length: 17 }, (_, index) => record(index, {
    path: `Resources/Reference ${String(index + 1).padStart(2, "0")}.md`,
    title: `Reference ${String(index + 1).padStart(2, "0")}`, libraryId: "reading", role: "library", domain: "Resources",
  })));
  records.push(...Array.from({ length: 714 }, (_, index) => record(index, {
    path: portablePlaceholderPath(`pending-${index}`), title: `Unlinked subject ${index + 1}`, portableId: `pending-${index}`, isPlaceholder: true,
  })));
  data.activeTab = "library:reading";
  data.pinnedPaths = records.slice(0, 2).map((item) => item.path);
}
data.directIndexPaths = records.filter((item) => !item.libraryId && !item.portableId).map((item) => item.path);
data.collections = [{ id: "favorites", title: "Reading this week", collapsed: false, subjects: records.slice(0, 4).map((item) => item.path), subheadings: [] }];
const store = createDefaultStore(data, 1, "browser-synthetic-vault");
const otherData = migrateData(data);
otherData.settings.workspaceName = "Project workspace";
const sources = [
  { source: { baseId: store.activeBaseId, baseName: data.settings.workspaceName, data }, records },
  { source: { baseId: "other-base", baseName: otherData.settings.workspaceName, data: otherData }, records: [record(1, { path: "Projects/Search project.md", title: "Search project" })] },
];
let epoch = 0;
let generation = 0;
const completedImportActions = { undo: 0, placeholderQueue: 0, closed: [] as boolean[] };
const files = records.filter((item) => !item.portableId).map((item) => new TFile(item.path));
const app = {
  workspace: { getActiveFile: () => null, trigger: () => undefined },
  vault: { getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null, getMarkdownFiles: () => files },
  metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
};
const plugin = {
  app, data,
  getActiveKnowledgeBaseId: () => store.activeBaseId,
  getDataEpoch: () => epoch,
  getExternalChangeGeneration: () => 0,
  getSearchGeneration: () => generation,
  getRecords: () => records,
  getIndexRecords: () => records.filter((item) => !item.libraryId),
  getRecord: (path: string) => records.find((item) => item.path === path),
  getVaultId: () => "browser-synthetic-vault",
  librarySubjectCount: (id: string) => records.filter((item) => item.libraryId === id).length,
  getIndexCandidateFiles: () => files,
  getVaultNoteFiles: () => files,
  getTemplateFiles: () => [],
  validateGenericNote: (value: { title: string }) => value.title.trim() ? null : "Enter a title.",
  getLibraries: () => data.portableIndex.libraries,
  getLibrary: (id: string) => data.portableIndex.libraries.find((library) => library.id === id) ?? null,
  getKnowledgeBases: () => sources.map(({ source }) => ({ id: source.baseId, name: source.baseName, data: source.data, archivedAt: null })),
  getLegacyIndexReviewPlans: () => [],
  getPortableSubject: () => null,
  getRecordUnassignedLibraryFallback: () => null,
  getBacklinkPaths: () => [], resolveLink: () => null,
  isDataReadOnly: () => false, isClinicalMode: () => false,
  canVisuallyMoveAcrossGroups: () => false, countMemberships: () => 0,
  reconcileRecords: async () => false,
  saveViewState: async () => undefined, savePluginData: async () => undefined,
  // These counters verify production completion handlers cross the host
  // boundary; they do not simulate the real persistence writer or queue UI.
  undo: async () => { completedImportActions.undo += 1; data.undoStack.pop(); },
  openPlaceholderResolutionQueue: () => { completedImportActions.placeholderQueue += 1; },
  getSyncRecoveryCenterSnapshot: () => ({
    activeBaseName: data.settings.workspaceName, workspaceProfile: "Generic knowledge base",
    semanticRevision: 7, semanticHeadSummary: "1234abcd…", semanticCommitState: "committed",
    lastLocalSaveAt: Date.now() - 60_000, lastExternalReloadAt: Date.now() - 120_000,
    lastExternalReloadOutcome: "applied", conflictRescueCount: 0,
    conflictRescueCountIsLowerBound: false, artifactInspectionAvailable: true,
    newestConflictRescueAt: null, newestRecoveryExportAt: Date.now() - 3_600_000,
    readOnly: false, readOnlyReason: "Writable", stickyUntilRestart: false,
    activeBaseConcurrentEditAt: null, activeBaseConcurrentEditCount: 0,
    deviceProfile: Platform.isMobile ? "Mobile app (synthetic host)" : "Desktop app (synthetic host)",
    configProfile: "Default Obsidian configuration folder",
    deviceLocalStateProfile: "Active-base view profile stored on this device",
  }),
  searchKnowledgeBases: async (query: string, options: SearchOptions = {}) => {
    const selected = sources.filter(({ source }) => !options.baseIds || options.baseIds.includes(source.baseId));
    const filtered = selected.map(({ source, records: candidates }) => ({
      source,
      records: candidates.filter((item) => (!options.libraryId || item.libraryId === options.libraryId)
        && (options.availability !== "linked" || !item.isPlaceholder)
        && (options.availability !== "placeholders" || Boolean(item.isPlaceholder))),
    }));
    const collector = new BoundedKnowledgeBaseSearchCollector(filtered.map(({ source }) => source), parseQuery(query), options.limit, options.linkedFirst);
    filtered.forEach(({ records: candidates }, index) => {
      const paths = new Set<string>();
      candidates.forEach((item) => collector.consider(index, item, paths));
    });
    return collector.finish();
  },
};
const content = document.getElementById("kbcc-view");
if (!content) throw new Error("Missing browser test host");
const view = new EntVaultCommandCenterView({ app, contentEl: content } as never, plugin as unknown as EntVaultCommandCenterPlugin);
let openedModal: Modal | null = null;
let organizer: NoteOrganizerModal | null = null;
const submittedTitles: string[] = [];
const organizerHost: NoteOrganizerHost = {
  app: app as never,
  getVaultSnapshot: () => files.slice(0, 8).map((file) => ({ kind: "note", name: file.basename, path: file.path })),
  getBases: () => [{
    id: store.activeBaseId, name: data.settings.workspaceName, current: true,
    indexName: "Knowledge Index", indexHeadings: [{ id: "research", name: "Research", subheadings: [] }],
    libraries: [], collections: [{ id: "favorites", name: "Reading this week", subheadings: [] }],
  }],
  prepare: async (draft) => ({
    preparedToken: { synthetic: true }, warnings: [], errors: [],
    summary: { noteCount: draft.selectedPaths.length, baseCount: 1, changeCount: draft.selectedPaths.length, unchangedCount: 0, skippedCount: 0 },
    reviewRows: draft.selectedPaths.map((path) => ({
      path, noteTitle: records.find((item) => item.path === path)?.title ?? path,
      baseId: store.activeBaseId, baseName: data.settings.workspaceName,
      outcome: "change", before: { primary: "Knowledge Index / Research", collections: [] },
      after: { primary: "Knowledge Index / Research", collections: ["Reading this week"] },
    })),
  }),
  applyPrepared: async () => { throw new Error("Browser renderer tests do not exercise the persistence writer; use the plugin integration suite."); },
};

let settingsTab: EntCommandCenterSettingsTab | null = null;
let settingsContainer: HTMLElement | null = null;
let settingsEpoch = 0;
let releaseSettingsSave: (() => void) | null = null;
const settingsActions = { reviews: [] as string[], unlinked: [] as string[], kept: [] as string[], saves: 0 };

// Obsidian owns the outer Settings search/group layout. This narrow host uses
// the actual public definitions and invokes their production render callbacks;
// it never duplicates KBCC setting names, buttons, guards, or event handlers.
function renderSettingDefinitions(parent: HTMLElement, definitions: SettingDefinitionItem[]): void {
  for (const definition of definitions) {
    if ("type" in definition && definition.type === "group") {
      const group = parent.createEl("section");
      group.createEl("h2", { text: definition.heading });
      renderSettingDefinitions(group, definition.items);
    } else if ("name" in definition) {
      const row = new Setting(parent).setName(definition.name);
      if (definition.desc) row.setDesc(definition.desc);
      if ("render" in definition) definition.render(row);
      else if ("control" in definition || "action" in definition) throw new Error("Unsupported Settings host control");
    } else {
      throw new Error("Unsupported Settings host definition");
    }
  }
}

const harness = {
  ready: false,
  async refresh(replaceData = false) {
    generation += 1;
    if (replaceData) epoch += 1;
    await view.reload();
  },
  async showEmptyCollection() {
    data.collections[0].subjects = [];
    data.activeTab = "collections";
    await view.reload();
  },
  openCompletedImport() {
    openedModal?.close();
    const undo = snapshotPersonal(data, "Import synthetic browser fixture");
    data.undoStack = [undo];
    const modal = new ExportImportCenterModal(
      plugin as unknown as EntVaultCommandCenterPlugin,
      "import",
      (dataChanged) => completedImportActions.closed.push(dataChanged),
    );
    // Enter only the outcome state; normal constructor/onOpen/render and all
    // completion handlers/guards are production code. No import is executed.
    Object.assign(modal, {
      completedImport: {
        subjectCatalogImported: true, addedSubjects: 1, matchedSubjects: 0,
        unresolvedSubjects: 1, totalPlaceholders: 1, exactCandidatePlaceholders: 1,
        placeholderSummaryAvailable: true,
      },
      completedImportUndoToken: canonicalJsonString(undo),
    });
    openedModal = modal;
    modal.open();
  },
  openSettings(options: { readOnly?: boolean; reviewUnavailable?: boolean; noLibraries?: boolean; holdSave?: boolean } = {}) {
    settingsTab?.hide();
    settingsContainer?.remove();
    const settingsData = migrateData(data);
    const legacySource = { id: "legacy-source", path: "Legacy", origin: "legacy-primary-folder" as const };
    settingsData.indexFolderSources = [legacySource, { id: "explicit-source", path: "Linked research", origin: "user" }];
    if (options.noLibraries) settingsData.portableIndex.libraries = [];
    settingsActions.reviews = []; settingsActions.unlinked = []; settingsActions.kept = []; settingsActions.saves = 0;
    settingsEpoch = 0;
    const settingsHost = {
      ...plugin, data: settingsData,
      isDataReadOnly: () => Boolean(options.readOnly),
      dataCompatibilityWarning: "Synthetic read-only fixture; no vault writes are available.",
      getDataEpoch: () => settingsEpoch,
      getKnowledgeBases: () => [{ id: store.activeBaseId, data: settingsData, archivedAt: null }],
      getLibraries: () => settingsData.portableIndex.libraries,
      getLegacyIndexReviewPlans: () => {
        if (options.reviewUnavailable) throw new Error("Synthetic legacy review cannot be prepared");
        return [{ source: legacySource, sourceFolderAvailable: true, candidates: [{ path: "Legacy/Source.md" }] }];
      },
      openLegacyIndexReview: (id: string) => { settingsActions.reviews.push(id); },
      unlinkIndexFolder: async (id: string) => { settingsActions.unlinked.push(id); },
      keepLegacyIndexSourceById: async (id: string) => { settingsActions.kept.push(id); },
      savePluginData: async () => {
        settingsActions.saves += 1;
        if (options.holdSave) await new Promise<void>((resolve) => { releaseSettingsSave = resolve; });
      },
      refreshViews: async () => undefined,
    };
    settingsContainer = document.body.createEl("main", { attr: { "aria-label": "Settings test host" } });
    Object.assign(settingsContainer.style, { height: "100%", overflow: "auto", padding: "20px" });
    view.contentEl.remove();
    settingsTab = new EntCommandCenterSettingsTab(app as never, settingsHost as never);
    const container = settingsContainer;
    const tab = settingsTab;
    const render = (): void => {
      container.empty();
      container.createEl("h1", { text: "Knowledge base command center settings" });
      renderSettingDefinitions(container, tab.getSettingDefinitions());
    };
    Object.assign(tab, { containerEl: container, update: render });
    render();
  },
  invalidateSettings() { settingsEpoch += 1; },
  releaseSettingsSave() { releaseSettingsSave?.(); releaseSettingsSave = null; },
  settingsSnapshot() { return settingsActions; },
  async close() { settingsTab?.hide(); settingsContainer?.remove(); organizer?.dismissImmediately(); openedModal?.close(); await view.onClose(); },
  openModal(kind: "note" | "setup" | "export" | "sync" | "organizer" | "whats-new") {
    openedModal?.close();
    if (kind === "note") {
      openedModal = new KnowledgeNoteModal(app as never, {
        itemSingular: "note", templates: [],
        initial: { title: "", folder: "Research", mode: "empty", templatePath: "", addToCollection: false },
        destination: { label: "Knowledge Index / Research", onEdit: () => undefined },
        validate: (value) => value.title.trim() ? null : "Enter a title.",
        onSubmit: (value) => { submittedTitles.push(value.title); },
      });
    } else if (kind === "setup") {
      openedModal = new WorkspaceSetupModal(app as never, data.settings, () => undefined);
    } else if (kind === "export") {
      openedModal = new ExportImportCenterModal(plugin as unknown as EntVaultCommandCenterPlugin);
    } else if (kind === "sync") {
      openedModal = new SyncRecoveryCenterModal(plugin as unknown as EntVaultCommandCenterPlugin);
    } else if (kind === "whats-new") {
      openedModal = new UpdateAnnouncementModal(app as never, UPDATE_ANNOUNCEMENT_0_20_1);
    } else {
      organizer = new NoteOrganizerModal(organizerHost, { preselectedPaths: [files[0].path, files[1].path] });
      openedModal = organizer;
    }
    openedModal.open();
  },
  async refreshOrganizer() { await organizer?.refreshAfterExternalChange(); },
  snapshot() { return { activeTab: data.activeTab, recordCount: records.length, selectedPath: data.selectedPath, submittedTitles, completedImportActions }; },
};
Object.assign(window, { kbccBrowserHarness: harness });
void view.onOpen().then(() => { harness.ready = true; });
