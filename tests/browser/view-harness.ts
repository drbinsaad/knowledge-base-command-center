import { Platform, Setting, TFile, type Modal, type SettingDefinitionItem } from "obsidian";
import type EntVaultCommandCenterPlugin from "../../src/main";
import { EntVaultCommandCenterView } from "../../src/view";
import { buildCurriculumTree, canonicalJsonString, clonePersonalOrganization, createDefaultStore, createKnowledgeBaseEntry, migrateData, parseQuery, portablePlaceholderPath, restoreSnapshot, snapshotPersonal, type LayoutHeading, type VaultRecord } from "../../src/model";
import { BoundedKnowledgeBaseSearchCollector } from "../../src/search";
import { KnowledgeNoteModal, WorkspaceSetupModal } from "../../src/modals";
import { ExportImportCenterModal } from "../../src/portability-modal";
import { SyncRecoveryCenterModal } from "../../src/sync-recovery-modal";
import { NoteOrganizerModal, type NoteOrganizerHost } from "../../src/note-organizer-modal";
import { EntCommandCenterSettingsTab } from "../../src/settings";
import { UpdateAnnouncementModal } from "../../src/update-announcement-modal";
import { UPDATE_ANNOUNCEMENT_0_22_0 } from "../../src/update-announcement";
import { applyNoteOrganizerPlan, createNoteOrganizerPlan, type NoteOrganizerDirective, type NoteOrganizerFileFact, type NoteOrganizerPrimaryState } from "../../src/note-organizer";
import { organizerIndexPlacement, organizerIndexTrail } from "../../src/note-organizer-index";
import { applyLibraryVisualMove, type LibraryVisualMoveRequest } from "../../src/library-visual-move";

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
const touchDrag = parameters.get("scenario") === "touch-drag";
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
if (touchDrag) {
  records.splice(0, records.length,
    ...["Alpha", "Beta", "Gamma", "Child"].map((title, index) => record(index, { path: `Research/${title}.md`, title })),
    record(5, { path: "Other/Delta.md", title: "Delta", domain: "Other" }),
    ...["Source A", "Source B", "Source C", "Source D"].map((title, index) => record(index + 10, {
      path: `Reading/${title}.md`, title, libraryId: "reading", portableId: `source-${index}`, role: "library", domain: "Sources",
    })),
    ...Array.from({ length: Number(parameters.get("extra") ?? 0) }, (_, index) => record(index + 100, {
      path: `Research/Extra ${String(index).padStart(3, "0")}.md`, title: `Extra ${String(index).padStart(3, "0")}`,
    })),
  );
  data.settings.workspaceName = "Touch drag synthetic workspace";
  data.indexGroupOrder = ["Research", "Other"];
  data.directIndexPaths = records.filter((item) => !item.libraryId).map((item) => item.path);
  data.curriculumVisual.parentByPath["Research/Child.md"] = "Research/Beta.md";
  data.indexGroupByPath = Object.fromEntries(records.filter((item) => !item.libraryId).map((item) => [item.path, item.domain]));
  data.portableIndex.groups = [{ id: "source-group", title: "Sources", order: 0 }];
  data.portableIndex.subjects = records.filter((item) => item.portableId).map((item, order) => ({
    id: item.portableId!, title: item.title, groupId: "source-group", parentId: null,
    order, indexed: false, configuredId: "", recordKind: "note", libraryId: "reading",
  }));
  data.portableIndex.resolvedPathBySubjectId = Object.fromEntries(records.filter((item) => item.portableId).map((item) => [item.portableId!, item.path]));
  data.portableIndex.libraryLayouts.reading = [{
    id: "sources", title: "Sources", collapsed: false, subjects: ["source-0", "source-1"],
    subheadings: [{ id: "studies", title: "Studies", collapsed: false, subjects: [], subheadings: [{
      id: "trials", title: "Trials", collapsed: false, subjects: [], subheadings: [{
        id: "randomized", title: "Randomized", collapsed: false, subjects: ["source-2"], subheadings: [],
      }],
    }] }],
  }, { id: "references", title: "References", collapsed: false, subjects: [], subheadings: [] }];
  data.collections = [
    { id: "favorites", title: "Favorites", collapsed: false, subjects: ["Research/Alpha.md", "Research/Beta.md"], subheadings: [] },
    { id: "review", title: "Review", collapsed: false, subjects: [], subheadings: [{ id: "next", title: "Next", collapsed: false, subjects: ["Research/Gamma.md"], subheadings: [] }] },
  ];
}
const store = createDefaultStore(data, 1, "browser-synthetic-vault");
const otherData = migrateData(data);
otherData.settings.workspaceName = "Project workspace";
const sources = [
  { source: { baseId: store.activeBaseId, baseName: data.settings.workspaceName, data }, records },
  { source: { baseId: "other-base", baseName: otherData.settings.workspaceName, data: otherData }, records: [record(1, { path: "Projects/Search project.md", title: "Search project" })] },
];
let epoch = 0;
let generation = 0;
const touchDragActions = { mutations: [] as string[], undo: 0, redo: 0 };
const hostSwipeTouches: Array<{ ignored: boolean; handle: boolean; trusted: boolean }> = [];
function organizationFingerprint(): string {
  return canonicalJsonString({ ...clonePersonalOrganization(data), portableIndex: data.portableIndex });
}
const initialOrganization = organizationFingerprint();
const currentRecords = (): VaultRecord[] => touchDrag
  ? records.map((item) => ({ ...item, domain: data.indexGroupByPath[item.path] ?? item.domain }))
  : records;
const completedImportActions = { undo: 0, placeholderQueue: 0, closed: [] as boolean[] };
const files = records.filter((item) => touchDrag ? !item.isPlaceholder : !item.portableId).map((item) => new TFile(item.path));
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
  getRecords: currentRecords,
  getIndexRecords: () => currentRecords().filter((item) => !item.libraryId),
  getRecord: (path: string) => currentRecords().find((item) => item.path === path),
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
  getPortableSubject: (id: string) => data.portableIndex.subjects.find((item) => item.id === id) ?? null,
  getRecordUnassignedLibraryFallback: () => null,
  getBacklinkPaths: () => [], resolveLink: () => null,
  isDataReadOnly: () => false, isClinicalMode: () => false,
  canVisuallyMoveAcrossGroups: () => touchDrag, countMemberships: () => 0,
  initializeLibraryCatalog: async () => undefined,
  moveLibraryRecordVisually: async (
    path: string, libraryId: string, source: LibraryVisualMoveRequest["source"],
    destination: LibraryVisualMoveRequest["destination"], anchorSubjectId: string | null,
    position: LibraryVisualMoveRequest["position"], assertCurrent: () => void,
  ) => {
    assertCurrent();
    await plugin.mutate("Move synthetic Library record visually", () => {
      assertCurrent();
      applyLibraryVisualMove(data, plugin.getRecord(path) ?? null, { path, libraryId, source, destination, anchorSubjectId, position });
    });
  },
  reconcileRecords: async () => false,
  saveViewState: async () => undefined, savePluginData: async () => undefined,
  // These counters verify production completion handlers cross the host
  // boundary; they do not simulate the real persistence writer or queue UI.
  // Production view drop callbacks own every organization edit. This synthetic
  // host supplies only snapshot/restore and refresh, not filesystem persistence.
  mutate: async (label: string, action: () => unknown) => {
    if (!touchDrag) throw new Error("Mutation is available only in the isolated touch-drag fixture");
    const before = snapshotPersonal(data, label, false, true);
    await action();
    data.undoStack.push(before);
    data.redoStack = [];
    touchDragActions.mutations.push(label);
    generation += 1;
    await view.reload();
  },
  undo: async () => {
    if (!touchDrag) { completedImportActions.undo += 1; data.undoStack.pop(); return; }
    const previous = data.undoStack.pop();
    if (!previous) return;
    data.redoStack.push(snapshotPersonal(data, previous.label, false, true));
    restoreSnapshot(data, previous);
    touchDragActions.undo += 1;
    generation += 1;
    await view.reload();
  },
  redo: async () => {
    const next = data.redoStack.pop();
    if (!touchDrag || !next) return;
    data.undoStack.push(snapshotPersonal(data, next.label, false, true));
    restoreSnapshot(data, next);
    touchDragActions.redo += 1;
    generation += 1;
    await view.reload();
  },
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
if (touchDrag) {
  // Attribute-contract observer only, not an implementation of Obsidian's
  // swipe recognizer. Its actual host integration is verified separately in
  // the native app. Like the observed host, this bubbling ancestor listener
  // checks truthy dataset.ignoreSwipe, not defaultPrevented on PointerEvents.
  content.addEventListener("touchstart", (event) => {
    let ignored = false;
    let handle = false;
    for (let target = event.target as Node | null; target; target = target.parentNode) {
      if (target.nodeType !== Node.ELEMENT_NODE) continue;
      const element = target as HTMLElement;
      if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
      if (element.classList.contains("ent-cc-touch-drag-handle")) handle = true;
      if (element.dataset.ignoreSwipe) ignored = true;
    }
    hostSwipeTouches.push({ ignored, handle, trusted: event.isTrusted });
  });
}
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

// This separate fixture exercises the production modal and pure prepare/apply
// engine against an isolated, in-memory store. main.ts owns the real draft
// adapter and persistence writer; its integration suite covers that boundary.
const quickNotePath = "Research/Selected research note.md";
const quickParentPath = "Research/Methods.md";
const quickRecords = [
  record(0, { path: quickNotePath, title: "Selected research note", domain: "General" }),
  record(1, { path: "Research/Evidence.md", title: "Evidence" }),
  record(2, { path: "Research/Study design.md", title: "Study design" }),
  record(3, { path: quickParentPath, title: "Methods" }),
  ...Array.from({ length: 14 }, (_, index) => record(index + 4, { path: `Research/Topic ${index + 1}.md`, title: `Topic ${index + 1}` })),
];
const quickData = migrateData(null);
Object.assign(quickData.settings, { workspaceMode: "generic", workspaceName: "Quick organizer synthetic base", setupComplete: true });
quickData.indexGroupOrder = ["General", "Research"];
quickData.directIndexPaths = quickRecords.map((item) => item.path);
quickData.indexGroupByPath = Object.fromEntries(quickRecords.map((item) => [item.path, item.domain]));
quickData.curriculumVisual.parentByPath = {
  [quickNotePath]: null,
  "Research/Study design.md": "Research/Evidence.md",
  [quickParentPath]: "Research/Study design.md",
};
quickData.collections = [{ id: "quick-reading", title: "Reading this week", collapsed: false, subjects: [], subheadings: [] }];
let quickStore = createDefaultStore(quickData, 1, "browser-quick-organizer-synthetic-vault");
const secondQuickData = migrateData(quickData);
secondQuickData.settings.workspaceName = "Second synthetic base";
quickStore.bases.push(createKnowledgeBaseEntry(secondQuickData, "quick-second-base", 1));
const quickOriginal = canonicalJsonString(quickStore);
const quickCounters = { prepared: 0, applied: 0 };
type QuickPlan = ReturnType<typeof createNoteOrganizerPlan>;
let quickToken: { plan: QuickPlan; directives: NoteOrganizerDirective[]; consumed: boolean } | null = null;
function quickTree(baseId: string) {
  const base = quickStore.bases.find((item) => item.id === baseId);
  if (!base) throw new Error("Synthetic organizer base unavailable");
  const currentRecords = quickRecords.map((item) => ({ ...item, domain: base.data.indexGroupByPath[item.path] ?? item.domain }));
  return { base, tree: buildCurriculumTree(currentRecords, base.data.curriculumVisual, false) };
}
function quickFacts(directives: readonly NoteOrganizerDirective[]): NoteOrganizerFileFact[] {
  return directives.map((directive) => {
    const item = quickRecords.find((candidate) => candidate.path === directive.path);
    if (!item) throw new Error("Synthetic organizer note unavailable");
    const { base, tree } = quickTree(directive.baseId);
    return {
      path: item.path, baseId: base.id, title: item.title, mtime: 1000, size: 250,
      exists: true, markdown: true, eligible: true, sourceKind: "topic", sourceRole: "supporting",
      configuredId: "", indexEligible: true, suggestedIndexGroup: item.domain,
      ...(directive.primary?.mode === "index" && directive.primary.parentPath !== undefined
        ? { indexPlacement: organizerIndexPlacement(base.data, tree, item.path, directive.primary.parentPath) } : {}),
    };
  });
}
function quickPrimaryLabel(primary: NoteOrganizerPrimaryState): string {
  if (primary.kind === "none") return "No primary placement";
  if (primary.kind === "library") return `Library — ${primary.libraryName}${primary.placement ? ` / ${primary.placement.label}` : " / Unplaced"}`;
  return `Index — ${primary.groupTitle} / ${primary.parentPath ? primary.parentLabel || primary.parentPath : "Heading root"}`;
}
const quickOrganizerHost: NoteOrganizerHost = {
  app: app as never,
  getVaultSnapshot: async () => quickRecords.map((item) => ({ kind: "note", name: item.title, path: item.path })),
  getBases: async () => quickStore.bases.map((entry) => {
    const { base, tree } = quickTree(entry.id);
    const group = base.data.indexGroupByPath[quickNotePath] ?? "General";
    return {
      id: base.id, name: base.data.settings.workspaceName, current: base.id === quickStore.activeBaseId,
      indexName: "Knowledge Index",
      indexHeadings: ["General", "Research"].map((name) => ({
        id: name, name, subheadings: quickRecords.filter((item) => item.path !== quickNotePath && tree.nodeByPath.get(item.path)?.record.domain === name)
          .map((item) => ({ id: item.path, name: organizerIndexTrail(tree, item.path).label })),
      })),
      initialPrimary: { mode: "index", libraryId: null, headingId: group, subheadingId: tree.parentByPath.get(quickNotePath) ?? null },
      libraries: [], collections: [{ id: "quick-reading", name: "Reading this week", subheadings: [] }],
    };
  }),
  prepare: async (draft) => {
    if (draft.overrides.length || draft.selectedPaths.length !== 1 || draft.selectedPaths[0] !== quickNotePath) throw new Error("Unexpected quick organizer fixture selection");
    const directives: NoteOrganizerDirective[] = draft.destinations.map((destination) => {
      const primary = destination.primary;
      if (primary.mode === "library") throw new Error("The quick fixture has no Libraries");
      return {
        path: quickNotePath, baseId: destination.baseId,
        primary: primary.mode === "index" ? { mode: "index", groupTitle: primary.headingId ?? "General", parentPath: primary.subheadingId } : { mode: primary.mode },
        collections: destination.collections.mode === "keep" ? { mode: "keep" } : {
          mode: destination.collections.mode,
          targets: destination.collections.targets.map((target) => ({ headingId: target.headingId, ...(target.subheadingId ? { subheadingId: target.subheadingId } : {}) })),
        },
      };
    });
    const plan = createNoteOrganizerPlan(quickStore, quickFacts(directives), directives, { now: 1000 + quickCounters.prepared });
    quickToken = { plan, directives, consumed: false };
    quickCounters.prepared += 1;
    return {
      preparedToken: quickToken, warnings: [], errors: [],
      summary: { noteCount: 1, baseCount: plan.summary.requestedBaseCount, changeCount: plan.diffs.length, unchangedCount: plan.summary.noOpDirectiveCount, skippedCount: 0 },
      reviewRows: plan.reviews.map((review) => ({
        path: review.path, noteTitle: review.title, baseId: review.baseId, baseName: review.baseName,
        outcome: review.changed ? "change" : "unchanged",
        before: { primary: quickPrimaryLabel(review.before.primary), collections: review.before.collections.map((item) => item.label) },
        after: { primary: quickPrimaryLabel(review.after.primary), collections: review.after.collections.map((item) => item.label) },
      })),
    };
  },
  applyPrepared: async (token) => {
    if (!quickToken || token !== quickToken || quickToken.consumed) throw new Error("Exact synthetic prepared token was not preserved");
    const { plan, directives } = quickToken;
    quickStore = applyNoteOrganizerPlan(quickStore, plan, quickFacts(directives), 0);
    quickToken.consumed = true;
    quickCounters.applied += 1;
    return { changedNotes: plan.summary.selectedNoteCount, changedBases: plan.summary.changedBaseCount, changeCount: plan.diffs.length };
  },
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
  openModal(kind: "note" | "setup" | "export" | "sync" | "organizer" | "quick-organizer" | "whats-new") {
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
      openedModal = new UpdateAnnouncementModal(app as never, UPDATE_ANNOUNCEMENT_0_22_0);
    } else if (kind === "quick-organizer") {
      organizer = new NoteOrganizerModal(quickOrganizerHost, { singleNote: true, source: "file-menu", preselectedPaths: [quickNotePath] });
      openedModal = organizer;
    } else {
      organizer = new NoteOrganizerModal(organizerHost, { preselectedPaths: [files[0].path, files[1].path] });
      openedModal = organizer;
    }
    openedModal.open();
  },
  async refreshOrganizer() { await organizer?.refreshAfterExternalChange(); },
  touchDragSnapshot() {
    const tree = buildCurriculumTree(currentRecords(), data.curriculumVisual, false);
    const placements = (headings: LayoutHeading[]): Record<string, string[]> => {
      const result: Record<string, string[]> = {};
      const visit = (nodes: LayoutHeading[]): void => nodes.forEach((node) => {
        result[node.id] = [...node.subjects];
        visit(node.subheadings);
      });
      visit(headings);
      return result;
    };
    return {
      ...touchDragActions, undoCount: data.undoStack.length, redoCount: data.redoStack.length,
      hostSwipeTouches: hostSwipeTouches.map((touch) => ({ ...touch })),
      unchanged: organizationFingerprint() === initialOrganization,
      fingerprint: organizationFingerprint(), parents: Object.fromEntries(tree.parentByPath),
      groups: { ...data.indexGroupByPath },
      roots: Object.fromEntries(tree.domains.map((domain) => [domain.domain, domain.roots.map((node) => node.record.path)])),
      library: placements(data.portableIndex.libraryLayouts.reading), collections: placements(data.collections),
      subjectGroups: Object.fromEntries(data.portableIndex.subjects.map((subject) => [subject.id, data.portableIndex.groups.find((group) => group.id === subject.groupId)?.title ?? null])),
    };
  },
  quickOrganizerSnapshot() {
    const { base, tree } = quickTree(quickStore.activeBaseId);
    const subjects = base.data.portableIndex.subjects;
    const selectedSubject = subjects.find((item) => base.data.portableIndex.resolvedPathBySubjectId[item.id] === quickNotePath);
    return {
      ...quickCounters, unchanged: canonicalJsonString(quickStore) === quickOriginal,
      parent: tree.parentByPath.get(quickNotePath) ?? null, group: base.data.indexGroupByPath[quickNotePath],
      undoCount: base.data.undoStack.length, activeBase: quickStore.activeBaseId,
      parents: Object.fromEntries([...tree.parentByPath].filter(([item]) => item !== quickNotePath)),
      collections: base.data.collections.filter((item) => item.subjects.includes(quickNotePath) || Boolean(selectedSubject && item.subjects.includes(selectedSubject.id))).map((item) => item.title),
      secondBase: canonicalJsonString(quickStore.bases.find((item) => item.id === "quick-second-base")),
    };
  },
  snapshot() { return { activeTab: data.activeTab, recordCount: records.length, selectedPath: data.selectedPath, submittedTitles, completedImportActions }; },
};
Object.assign(window, { kbccBrowserHarness: harness });
void view.onOpen().then(() => { harness.ready = true; });
