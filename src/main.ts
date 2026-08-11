import { MarkdownView, normalizePath, Notice, Platform, Plugin, TFile, TFolder, type TAbstractFile } from "obsidian";
import {
  attachmentFileName,
  attachmentPathCandidate,
  canonicalAttachmentFolder,
  insertAttachmentReference,
  MAX_ATTACHMENT_BYTES,
  noteAttachmentFolder,
} from "./attachment";
import {
  AttachmentImportModal,
  type AttachmentImportValue,
  type AttachmentOperationPolicy,
} from "./attachment-modal";
import { ENT_HIERARCHY_BASES_VIEW_TYPE, EntHierarchyBasesView, hierarchyBasesViewOptions } from "./bases-view";
import {
  applyPluginViewState,
  boundedSemanticLineage,
  asUnknownRecord,
  asStringList,
  asText,
  applyCanonicalFrontmatter,
  buildCanonicalMarkdown,
  buildIndexDiagnostics,
  buildProposalMarkdown,
  BUILTIN_LIBRARY_DEFINITIONS,
  BUILTIN_LIBRARY_IDS,
  applyTemplateTokens,
  canonicalIdIsValid,
  canonicalHierarchyIssue,
  canonicalPath,
  canonicalPathInputsUnchanged,
  capturePluginViewState,
  cleanDomainFolder,
  configuredGroupFromPath,
  curriculumContainerKey,
  createDefaultStore,
  createDeviceLocalPluginState,
  createDeviceLocalPluginStateWithReport,
  deterministicSemanticHead,
  createKnowledgeBaseEntry,
  DATA_VERSION,
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  ENT_CLINICAL_SETTINGS,
  genericNotePath,
  GenericNoteFormValue,
  freshStoreHasOnlyBootstrapChanges,
  isImmutableSourcePath,
  isFreshVaultId,
  isLibraryKind,
  isPortablePlaceholderPath,
  isLegacyDeterministicMigratedVaultId,
  isRecognizedPluginData,
  isRecognizedPluginStore,
  isRestrictedVaultPath,
  LibraryDefinition,
  LibraryNoteProfile,
  LibraryKind,
  libraryTabId,
  subjectLibraryId,
  LayoutHeading,
  limitSnapshotStack,
  makeId,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_KNOWLEDGE_BASES,
  MAX_LIBRARIES,
  MEDICATION_ROOT,
  migrateData,
  migrateStore,
  normalizeKnowledgeBaseLibrariesAndNavigation,
  normalizeWikiLink,
  parseQuery,
  pathIsInsideFolder,
  portablePlaceholderPath,
  portableSubjectIdFromPath,
  pluginStoreNeedsNormalization,
  PortableSubjectDefinition,
  PluginData,
  DeviceLocalPluginState,
  PluginViewState,
  PluginStore,
  KnowledgeBaseEntry,
  PROCEDURE_ROOT,
  proposalPath,
  reconcileCurriculumVisual,
  reconcilePortableLibraryLayouts,
  rebaseProvisionalVaultIdAfterDeterministicRepair,
  recordBelongsToIndex,
  RecordKind,
  RecordRole,
  replacePathPrefix,
  resetCurriculumVisualPath,
  resetPluginViewState,
  restoreSnapshot,
  rewriteTopLevelHeading,
  rewriteActivePluginDataPathPrefix,
  rewritePluginDataFolderRename,
  rewritePluginDataPathPrefix,
  rewritePluginDataTemplatePathRename,
  sanitizeFileName,
  semanticEntryFingerprint,
  semanticPluginDataProjection,
  nextSemanticHead,
  parseDeviceLocalPluginState,
  cleanLibraryNoteProfiles,
  resolveLibraryNoteProfile,
  snapshotPersonal,
  storedDataVersion,
  STORE_VERSION,
  SYNDROME_ROOT,
  TopicFormValue,
  TemplateTokenContext,
  EffectiveLibraryNoteProfile,
  validateLibraryNoteProfile,
  validateProposalFolderPath,
  validateTemplateFilePath,
  validateWritableFolderPath,
  VaultRecord,
  WorkspaceMode,
} from "./model";
import { MAX_PORTABLE_PACKAGE_BYTES, portableSubjectPath, registerPortableGroup, type PortableExportSelection } from "./portability";
import {
  applyPortfolioImportPlan,
  createPortfolioExport,
  createPortfolioImportPlan,
  MAX_PORTFOLIO_BUNDLE_BYTES,
  type PortfolioExportV1,
  type PortfolioImportMapping,
  type PortfolioImportPlan,
} from "./portfolio";
import {
  appendFollowUpEntry,
  assertMarkdownAiLockWritable,
  assertFollowUpNoteWritable,
  cleanFollowUpCategoryDefinitions,
  reverseFollowUpAppend,
  type FollowUpCategoryDefinition,
  type FollowUpUndoMetadata,
} from "./follow-up";
import { QuickAppendModal } from "./follow-up-modal";
import { VaultFilePickerModal } from "./modals";
import {
  ATTACHMENT_PROTOCOL_ACTIONS,
  createQuickEntryCommands,
  privacySafeFixedActionRequest,
  privacySafeQuickEntryRequest,
  QUICK_APPEND_PROTOCOL_ACTIONS,
  QUICK_ENTRY_FOCUSED_PROTOCOL_ACTIONS,
  QUICK_ENTRY_PROTOCOL_ACTIONS,
  runQuickEntryFocusedProtocolAction,
} from "./quick-entry";
import {
  BoundedKnowledgeBaseSearchCollector,
  DEFAULT_CROSS_BASE_SEARCH_LIMIT,
  type KnowledgeBaseSearchResultSet,
  type KnowledgeBaseSearchSource,
} from "./search";
import { EntCommandCenterSettingsTab } from "./settings";
import { EntVaultCommandCenterView, VIEW_TYPE } from "./view";
import { CreateKnowledgeBaseModal, ManageKnowledgeBasesModal } from "./knowledge-base-modal";
import { ManageLibrariesModal } from "./library-modal";
import { mergeKnowledgeBaseStores, type StoreMergeResult } from "./store-merge";
import {
  applyTaxonomyRepairToData,
  buildTaxonomyHealthFindings,
  type TaxonomyRepairPlan,
} from "./taxonomy-health";
import { TaxonomyHealthModal } from "./taxonomy-health-modal";
import { PortfolioTransferModal } from "./portfolio-modal";
import {
  createDefaultSyncRecoveryLocalState,
  describeConfigProfile,
  describePlatform,
  MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES,
  parseSyncRecoveryLocalState,
  privacySafeBaseName,
  privacySafeReadOnlyReason,
  summarizeRecoveryArtifacts,
  summarizeSemanticHead,
  SYNC_RECOVERY_EXPORT_FOLDER,
  type ExternalReloadOutcome,
  type SyncRecoveryCenterSnapshot,
  type SyncRecoveryLocalState,
} from "./sync-recovery";
import { ClearDeviceLocalDataModal, SyncRecoveryCenterModal } from "./sync-recovery-modal";
import {
  planUpdateAnnouncement,
  updateAnnouncementForVersion,
  type UpdateAnnouncement,
} from "./update-announcement";
import { UpdateAnnouncementModal } from "./update-announcement-modal";

/** Bound stable inactive projections by records, not an arbitrary base count. */
const MAX_INACTIVE_SEARCH_CACHED_RECORDS = 50_000;
export const DEVICE_LOCAL_STATE_KEY = "ent-vault-command-center.device-state.v1";
export const SYNC_RECOVERY_LOCAL_STATE_KEY = "ent-vault-command-center.sync-recovery-state.v1";
const FOLLOW_UP_UNDO_WINDOW_MS = 5 * 60 * 1000;

interface PluginDataLoadResult {
  recognizedStore: boolean;
  hasVaultId: boolean;
  identityNeedsWriteback: boolean;
  structuralRepairNeedsWriteback: boolean;
  remediationNeedsWriteback: boolean;
  /** True only when no persisted plugin payload existed at read time. */
  sourceWasMissing: boolean;
  sourceVersion: number;
  compatible: boolean;
  /** Validated pre-v14 view/history awaiting acceptance of an external store. */
  legacyDeviceState?: DeviceLocalPluginState;
  legacyDeviceStateHistoryTruncated?: boolean;
  legacyDeviceStateViewTruncated?: boolean;
}

type PluginDataRead = { value: unknown } | { error: unknown };

interface ExternalPluginDataCapture {
  read: PluginDataRead;
  adapterWriteGeneration: number;
}

interface RejectedSemanticAttempt {
  revision: number;
  head: string;
  hash: string;
  lineage: string[];
}

class ExternalSettingsSupersededError extends Error {}
class SemanticConflictRescueError extends Error {}

const APP_WRITE_BARRIER_KEY = Symbol.for("knowledge-base-command-center.adapter-write-barrier.v1");

interface AppWriteBarrier {
  generation: number;
  /** Adapter writes from every live/replaced instance. */
  tail: Promise<void>;
  /** Complete logical transactions, including any compensating write. */
  logicalTail: Promise<void>;
  /** Sticky for the App lifetime; only a full Obsidian restart clears it. */
  uncertainty: { message: string; at: number } | null;
  /** Synchronous, App-lifetime claims prevent replacement instances racing. */
  updateAnnouncementClaims: Set<string>;
  activeUpdateAnnouncementVersion: string | null;
}

export type { KnowledgeBaseSearchSource } from "./search";

export interface KnowledgeBaseSearchOptions {
  isCancelled?: () => boolean;
  limit?: number;
  yieldEvery?: number;
}

export interface CatalogPlacementTarget {
  headingId?: string;
  subheadingId?: string;
  headingTitle?: string;
}

export interface QuickEntryPlaceholderInput {
  title: string;
  group: string;
  parentPath?: string;
}

export interface LibraryDefinitionInput {
  name: string;
  singularName: string;
  icon: string;
}

export type LibraryRemovalDestination = "unassigned" | "index" | { libraryId: string };

export const LIBRARY_ICON_IDS = [
  "library", "book-open", "book-copy", "folder", "folders", "bookmark", "archive",
  "clipboard-list", "pill", "dna", "stethoscope", "heart-pulse", "brain", "microscope",
  "flask-conical", "syringe", "activity", "graduation-cap", "file-text", "notebook-tabs",
] as const;

interface KnowledgeBaseSearchVaultSnapshot {
  files: readonly TFile[];
  filesByPath: ReadonlyMap<string, TFile>;
  clinicalProposalFiles: readonly TFile[];
  frontmatterByPath: ReadonlyMap<string, Record<string, unknown>>;
  generation: number;
}

interface PendingVaultRename {
  oldPath: string;
  newPath: string;
  folderRename: boolean;
}

export default class EntVaultCommandCenterPlugin extends Plugin {
  data: PluginData = structuredClone(DEFAULT_DATA);
  private store: PluginStore = createDefaultStore(this.data);
  private committedStoreSnapshot: PluginStore | null = null;
  /** Safe in-memory rollback point even while a missing data.json is uncommitted. */
  private rollbackStoreSnapshot: PluginStore | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private directSaveTransactionQueue: Promise<void> = Promise.resolve();
  private appWriteBarrier: AppWriteBarrier | null = null;
  private appReadBarrier: Promise<void> = Promise.resolve();
  private appWriteGeneration = 0;
  private activeLogicalOperationDepth = 0;
  private unloaded = false;
  private adapterWriteGeneration = 0;
  private externalChangeGeneration = 0;
  private baseOperationBusy = false;
  private dataTransactionBusy = false;
  private directSaveBusyCount = 0;
  private externalReloadBusy = false;
  private externalReloadPending = false;
  private externalReloadPromise: Promise<void> | null = null;
  private externalReloadCaptures: Array<Promise<ExternalPluginDataCapture>> = [];
  private retainedExternalSettingsPayload: unknown = null;
  /** Sticky until restart: an unrescued semantic conflict must never auto-resume adoption. */
  private semanticConflictRescueFailed = false;
  /** Sticky until restart: data.json may contain a write whose compensation is unproven. */
  private persistenceUncertain = false;
  private lastConflictRescueStore = "";
  private lastConflictRescuePath = "";
  private deviceLocalState: DeviceLocalPluginState | null = null;
  private deviceLocalStateLoaded = false;
  /** Sticky until restart after the explicit privacy reset. */
  private deviceLocalPersistenceSuppressed = false;
  private syncRecoveryLocalState: SyncRecoveryLocalState = createDefaultSyncRecoveryLocalState();
  private syncRecoveryLocalStateLoaded = false;
  /** Saves that may have reached data.json before their promise rejected. */
  private rejectedSemanticAttemptsByBase = new Map<string, RejectedSemanticAttempt[]>();
  private dataEpoch = 0;
  private operationIdleResolvers: Array<() => void> = [];
  private refreshTimer: number | null = null;
  private searchGeneration = 0;
  private knowledgeBaseSearchVaultSnapshot: KnowledgeBaseSearchVaultSnapshot | null = null;
  private recordsCacheByBase = new Map<string, VaultRecord[]>();
  /** Stable search-only projections are bounded by retained records across bases. */
  private inactiveSearchRecordsCache = new Map<string, VaultRecord[]>();
  private inactiveSearchCachedRecordCount = 0;
  private recordPathsCacheByBase = new Map<string, Set<string>>();
  private librarySubjectCountsCacheByBase = new Map<string, ReadonlyMap<string, number>>();
  private referencedPathsCacheByBase = new Map<string, Set<string>>();
  private excludedPathsCacheByBase = new Map<string, Set<string>>();
  private recordLinkIndex = new Map<string, VaultRecord>();
  private recordLinkIndexBaseId = "";
  private backlinkIndex: Map<string, string[]> | null = null;
  private refreshShouldInvalidateRecords = false;
  /**
   * Session overlay applied only to persisted path references while the durable
   * all-base rename repair waits behind Sync or another operation. Failed
   * repairs intentionally retain their overlay so search never resurrects the
   * old path from stale plugin data.
   */
  private pendingVaultRenames: PendingVaultRename[] = [];
  private vaultRenameRepairQueue: Promise<void> = Promise.resolve();
  private lastFollowUpUndo: { expiresAt: number; file: TFile; undo: FollowUpUndoMetadata } | null = null;
  private readonly libraryCommandNames = new Map<string, string>();
  private settingsTab: EntCommandCenterSettingsTab | null = null;
  private updateAnnouncementHandled = false;
  private activeUpdateAnnouncementModal: UpdateAnnouncementModal | null = null;
  dataCompatibilityWarning = "";

  async onload(): Promise<void> {
    this.activateAppWriteBarrier();
    this.loadSyncRecoveryLocalState();
    const initialLoad = await this.loadPluginData();
    this.registerView(VIEW_TYPE, (leaf) => new EntVaultCommandCenterView(leaf, this));
    this.registerHoverLinkSource("ent-vault-command-center", {
      display: "Knowledge Base Command Center",
      defaultMod: false,
    });

    this.addRibbonIcon("library-big", "Open knowledge base command center", () => this.run(() => this.activateView()));
    this.addRibbonIcon("zap", "Open quick entry", () => {
      const currentPath = this.app.workspace.getActiveFile()?.path;
      void this.withView((view) => view.openQuickEntry(currentPath));
    });
    this.addCommand({ id: "open-workspace", name: "Open workspace", callback: () => this.run(() => this.activateView()) });
    this.addCommand({ id: "add-or-create", name: "Add or create…", callback: () => void this.withView((view) => view.openAddActions()) });
    this.addCommand({ id: "manage-knowledge-index", name: "Manage index…", callback: () => void this.withView((view) => view.openIndexManager()) });
    this.addCommand({ id: "open-taxonomy-health", name: "Open taxonomy health center", callback: () => new TaxonomyHealthModal(this).open() });
    this.addCommand({ id: "open-sync-recovery-center", name: "Open sync & recovery center", icon: "shield-check", callback: () => new SyncRecoveryCenterModal(this).open() });
    const currentUpdateAnnouncement = updateAnnouncementForVersion(this.manifest.version);
    if (currentUpdateAnnouncement) {
      this.addCommand({
        id: "open-whats-new",
        name: "Open what’s new",
        icon: "sparkles",
        callback: () => this.openCurrentUpdateAnnouncement(currentUpdateAnnouncement),
      });
    }
    this.addCommand({
      id: "clear-device-local-data",
      name: "Clear device-local data…",
      icon: "trash-2",
      callback: () => new ClearDeviceLocalDataModal(this).open(),
    });
    this.addCommand({ id: "new-knowledge-base", name: "New knowledge base…", callback: () => new CreateKnowledgeBaseModal(this).open() });
    this.addCommand({ id: "switch-knowledge-base", name: "Switch knowledge base…", callback: () => new ManageKnowledgeBasesModal(this).open() });
    this.addCommand({ id: "manage-knowledge-bases", name: "Manage knowledge bases…", callback: () => new ManageKnowledgeBasesModal(this).open() });
    this.addCommand({ id: "manage-libraries", name: "Manage libraries…", callback: () => new ManageLibrariesModal(this, () => void this.refreshViews()).open() });
    this.addCommand({ id: "export-import-center", name: "Open export / import center", callback: () => void this.withView((view) => view.openPortabilityCenter()) });
    this.addCommand({ id: "portfolio-transfer-center", name: "Open multi-base portfolio transfer", callback: () => new PortfolioTransferModal(this).open() });
    this.addCommand({ id: "create-knowledge-note", name: "Create note from template or empty note…", callback: () => void this.withView((view) => view.startCreateKnowledgeNote()) });
    this.addCommand({
      id: "attach-file-to-current-note",
      name: "Attach file to current note…",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile)
          || file.extension.toLocaleLowerCase() !== "md"
          || isImmutableSourcePath(file.path)
          || this.app.vault.getAbstractFileByPath(file.path) !== file
          || this.isDataReadOnly()) return false;
        if (!checking) this.openAttachmentImport(file);
        return true;
      },
    });
    const quickEntryHandlers = {
      openHub: () => {
        const currentPath = this.app.workspace.getActiveFile()?.path;
        void this.withView((view) => view.openQuickEntry(currentPath));
      },
      createSubject: () => void this.withView((view) => view.startQuickCreatePlaceholder()),
      createHeading: () => void this.withView((view) => view.startQuickCreateHeading()),
      createSubheading: () => void this.withView((view) => view.startQuickCreateSubheading()),
      createNote: () => void this.withView((view) => view.startQuickCreateNote()),
      addCurrentNote: () => {
        const currentPath = this.app.workspace.getActiveFile()?.path;
        void this.withView((view) => view.startQuickAddCurrentNote(currentPath));
      },
      addExistingNote: () => void this.withView((view) => view.startQuickAddExistingNote()),
      appendCurrentNote: () => this.openQuickAppendCurrentNote(),
      appendExistingNote: () => this.openQuickAppendExistingNote(),
    };
    for (const command of createQuickEntryCommands(quickEntryHandlers)) this.addCommand(command);

    for (const action of QUICK_ENTRY_PROTOCOL_ACTIONS) {
      this.registerObsidianProtocolHandler(action, (parameters) => {
        // Only Obsidian's intrinsic action field is accepted. Any query field
        // fails closed, so URLs cannot prefill or execute an entry.
        if (!privacySafeQuickEntryRequest(parameters).openHub) return;
        const currentPath = this.app.workspace.getActiveFile()?.path;
        void this.withView((view) => view.openQuickEntry(currentPath));
      });
    }
    for (const action of QUICK_ENTRY_FOCUSED_PROTOCOL_ACTIONS) {
      this.registerObsidianProtocolHandler(action, (parameters) => {
        if (!privacySafeFixedActionRequest(parameters, action)) return;
        runQuickEntryFocusedProtocolAction(action, quickEntryHandlers);
      });
    }
    for (const action of QUICK_APPEND_PROTOCOL_ACTIONS) {
      this.registerObsidianProtocolHandler(action, (parameters) => {
        if (!privacySafeFixedActionRequest(parameters, action)) return;
        if (action === "kbcc-quick-append-current") this.openQuickAppendCurrentNote();
        else this.openQuickAppendExistingNote();
      });
    }
    for (const action of ATTACHMENT_PROTOCOL_ACTIONS) {
      this.registerObsidianProtocolHandler(action, (parameters) => {
        if (!privacySafeFixedActionRequest(parameters, action)) return;
        this.openPrivacySafeAttachmentImportCurrentNote();
      });
    }
    this.addCommand({
      id: "undo-last-quick-append",
      name: "Quick append: Undo last append",
      icon: "undo-2",
      checkCallback: (checking) => {
        if (!this.canUndoLastFollowUpAppend()) return false;
        if (!checking) this.run(() => this.undoLastFollowUpAppend());
        return true;
      },
    });
    this.addCommand({
      id: "create-topic-proposal",
      name: "Create topic proposal in inbox",
      checkCallback: (checking) => {
        if (!this.isClinicalMode()) return false;
        if (!checking) void this.withView((view) => view.startCreateProposal());
        return true;
      },
    });
    this.addCommand({
      id: "add-current-note-to-collection",
      name: "Add current note to a collection",
      callback: () => {
        const path = this.app.workspace.getActiveFile()?.path;
        void this.withView((view) => view.startAddCurrentNote(path));
      },
    });
    this.addCommand({
      id: "promote-active-topic-proposal",
      name: "Promote active topic proposal…",
      checkCallback: (checking) => {
        if (!this.isClinicalMode()) return false;
        const file = this.app.workspace.getActiveFile();
        const proposal = file ? this.getRecord(file.path) : null;
        if (proposal?.role !== "proposal") return false;
        if (!checking) void this.withView((view) => view.startPromoteProposal(proposal));
        return true;
      },
    });
    this.addCommand({
      id: "edit-active-canonical-placement",
      name: "Edit active canonical topic placement…",
      checkCallback: (checking) => {
        if (!this.isClinicalMode() || !this.data.settings.enableAdvancedCanonicalActions) return false;
        const file = this.app.workspace.getActiveFile();
        const topic = file ? this.getRecord(file.path) : null;
        if (topic?.role !== "canonical") return false;
        if (!checking) void this.withView((view) => view.startEditCanonicalPlacement(topic));
        return true;
      },
    });
    this.addCommand({
      id: "create-canonical-topic-advanced",
      name: "Create canonical topic (advanced)…",
      checkCallback: (checking) => {
        if (!this.isClinicalMode() || !this.data.settings.enableAdvancedCanonicalActions) return false;
        if (!checking) void this.withView((view) => view.startCreateCanonical());
        return true;
      },
    });
    this.addCommand({
      id: "undo-personal-organization",
      name: "Undo personal organization change",
      checkCallback: (checking) => {
        if (this.data.undoStack.length === 0) return false;
        if (!checking) this.run(() => this.undo());
        return true;
      },
    });
    this.addCommand({
      id: "redo-personal-organization",
      name: "Redo personal organization change",
      checkCallback: (checking) => {
        if (this.data.redoStack.length === 0) return false;
        if (!checking) this.run(() => this.redo());
        return true;
      },
    });
    this.syncLibraryCommands();

    this.settingsTab = new EntCommandCenterSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    // Registration happens once at plugin load, while the active index profile
    // can later change between generic and ENT presets. The view itself also
    // works for generic notes by falling back to their folder grouping.
    try {
      this.registerBasesView(ENT_HIERARCHY_BASES_VIEW_TYPE, {
        name: "Knowledge hierarchy",
        icon: "folder-tree",
        factory: (controller, containerEl) => new EntHierarchyBasesView(controller, containerEl),
        options: () => hierarchyBasesViewOptions(),
      });
    } catch (error) {
      console.warn("Knowledge Base Command Center: custom Bases view unavailable", error);
    }

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.metadataCache.on("changed", (file) => {
        // Backlinks include the whole vault, including notes outside the configured
        // index. Any metadata-link change can therefore invalidate that cache.
        this.backlinkIndex = null;
        this.invalidateKnowledgeBaseSearchSnapshot();
        if (this.invalidateRecordCachesForPath(file.path)) this.scheduleRefresh(false);
        else if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) this.scheduleRefresh(false);
      }));
      this.registerEvent(this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile)) return;
        this.backlinkIndex = null;
        this.invalidateKnowledgeBaseSearchSnapshot();
        if (this.invalidateRecordCachesForPath(file.path)) this.scheduleRefresh(false);
        else if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) this.scheduleRefresh(false);
      }));
      this.registerEvent(this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile)) return;
        this.backlinkIndex = null;
        this.invalidateKnowledgeBaseSearchSnapshot();
        if (this.invalidateRecordCachesForPath(file.path)) this.scheduleRefresh(false);
        else if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) this.scheduleRefresh(false);
      }));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.handleVaultRenameEvent(file, oldPath)));
      this.maybeShowUpdateAnnouncement(initialLoad);
    });
  }

  onunload(): void {
    this.unloaded = true;
    const hadActiveUpdateAnnouncement = this.activeUpdateAnnouncementModal !== null;
    this.activeUpdateAnnouncementModal?.close();
    this.activeUpdateAnnouncementModal = null;
    if (hadActiveUpdateAnnouncement && this.appWriteBarrier) {
      this.appWriteBarrier.activeUpdateAnnouncementVersion = null;
    }
    if (this.refreshTimer !== null) window.activeWindow.clearTimeout(this.refreshTimer);
    for (const commandId of this.libraryCommandNames.keys()) this.removeCommand(commandId);
    this.libraryCommandNames.clear();
  }

  async activateView(): Promise<EntVaultCommandCenterView> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof EntVaultCommandCenterView)) throw new Error(`${this.data.settings.workspaceName} could not be opened.`);
    return leaf.view;
  }

  private async withView(action: (view: EntVaultCommandCenterView) => void | Promise<void>): Promise<void> {
    try {
      await action(await this.activateView());
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Active Libraries receive stable global commands so users can place them on
   * Obsidian's mobile toolbar or assign their own hotkeys. Command callbacks
   * carry only the stable Library ID and revalidate the current base at use.
   */
  private syncLibraryCommands(): void {
    const desired = new Map<string, string>(
      this.getLibraries().map((library) => [`open-library-${library.id}`, library.name] as const),
    );
    for (const [commandId, priorName] of [...this.libraryCommandNames]) {
      const nextName = desired.get(commandId);
      if (nextName === priorName) continue;
      this.removeCommand(commandId);
      this.libraryCommandNames.delete(commandId);
    }
    for (const [commandId, libraryName] of desired) {
      if (this.libraryCommandNames.has(commandId)) continue;
      const libraryId = commandId.slice("open-library-".length);
      this.addCommand({
        id: commandId,
        name: `Open Library: ${libraryName}`,
        icon: "library",
        callback: () => this.run(() => this.openLibrary(libraryId)),
      });
      this.libraryCommandNames.set(commandId, libraryName);
    }
  }

  private async openLibrary(libraryId: string): Promise<void> {
    const library = this.getLibrary(libraryId);
    if (!library || library.archivedAt !== null) {
      throw new Error("That Library is no longer available in the active knowledge base.");
    }
    const view = await this.activateView();
    await view.openLibrary(libraryId);
  }

  private run(action: () => Promise<unknown>): void {
    void action().catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
  }

  private requireActiveBase(store = this.store): KnowledgeBaseEntry {
    const active = store.bases.find((entry) => entry.id === store.activeBaseId && entry.archivedAt === null);
    if (!active) throw new Error("The active knowledge base is unavailable.");
    return active;
  }

  private replaceActiveData(
    next: PluginData,
    restored?: Pick<KnowledgeBaseEntry, "updatedAt" | "semanticRevision" | "semanticHead" | "semanticHash" | "semanticLineage">,
  ): void {
    const active = this.requireActiveBase();
    const preserveNewerCompensation = restored !== undefined
      && active.semanticRevision > restored.semanticRevision
      && semanticEntryFingerprint({ createdAt: active.createdAt, archivedAt: active.archivedAt, data: next }) === active.semanticHash;
    active.data = next;
    if (restored === undefined) this.bumpEntrySemanticRevision(active);
    else if (!preserveNewerCompensation) {
      active.updatedAt = restored.updatedAt;
      active.semanticRevision = restored.semanticRevision;
      active.semanticHead = restored.semanticHead;
      active.semanticHash = restored.semanticHash;
      active.semanticLineage = [...restored.semanticLineage];
    }
    this.useActiveData(next);
  }

  private preserveNewerCausalMetadata(target: PluginStore, source = this.store): void {
    for (const targetEntry of target.bases) {
      const sourceEntry = source.bases.find((candidate) => candidate.id === targetEntry.id);
      if (!sourceEntry
        || sourceEntry.semanticRevision <= targetEntry.semanticRevision
        || semanticEntryFingerprint(targetEntry) !== sourceEntry.semanticHash) continue;
      targetEntry.updatedAt = sourceEntry.updatedAt;
      targetEntry.semanticRevision = sourceEntry.semanticRevision;
      targetEntry.semanticHead = sourceEntry.semanticHead;
      targetEntry.semanticHash = sourceEntry.semanticHash;
      targetEntry.semanticLineage = [...sourceEntry.semanticLineage];
    }
  }

  private useActiveData(next: PluginData): void {
    if (this.data !== next) {
      this.data = next;
      this.dataEpoch += 1;
    }
  }

  private rejectedAttempts(entryId: string): RejectedSemanticAttempt[] {
    return this.rejectedSemanticAttemptsByBase.get(entryId) ?? [];
  }

  private unsupersededRejectedAttempts(entry: KnowledgeBaseEntry): RejectedSemanticAttempt[] {
    return this.rejectedAttempts(entry.id).filter((attempt) => (
      attempt.head !== entry.semanticHead && !entry.semanticLineage.includes(attempt.head)
    ));
  }

  private bumpEntrySemanticRevision(entry: KnowledgeBaseEntry, timestamp = Date.now()): boolean {
    const semanticHash = semanticEntryFingerprint(entry);
    const rejected = this.unsupersededRejectedAttempts(entry);
    if (semanticHash === entry.semanticHash && rejected.length === 0) return false;
    if (!Number.isSafeInteger(entry.semanticRevision) || entry.semanticRevision < 0
      || entry.semanticRevision >= Number.MAX_SAFE_INTEGER) {
      throw new Error("The knowledge base semantic revision cannot be advanced safely. Export the base before repairing plugin data.");
    }
    const highestRejectedRevision = rejected.reduce((highest, attempt) => Math.max(highest, attempt.revision), -1);
    const nextRevision = Math.max(entry.semanticRevision, highestRejectedRevision) + 1;
    if (!Number.isSafeInteger(nextRevision)) {
      throw new Error("The knowledge base semantic revision cannot be advanced safely. Export the base before repairing plugin data.");
    }
    const parentHead = entry.semanticHead;
    const rejectedAncestry: string[] = [];
    for (const attempt of rejected) rejectedAncestry.push(attempt.head, ...attempt.lineage);
    entry.semanticRevision = nextRevision;
    entry.semanticHash = semanticHash;
    entry.semanticHead = nextSemanticHead(parentHead, semanticHash);
    entry.semanticLineage = boundedSemanticLineage([
      ...rejectedAncestry,
      parentHead,
      ...entry.semanticLineage,
    ], entry.semanticHead);
    entry.updatedAt = Math.max(timestamp, entry.updatedAt + 1);
    return true;
  }

  private advanceRejectedSemanticAttempts(): boolean {
    let changed = false;
    for (const entry of this.store.bases) {
      if (this.unsupersededRejectedAttempts(entry).length === 0) continue;
      changed = this.bumpEntrySemanticRevision(entry) || changed;
    }
    return changed;
  }

  private recordRejectedSemanticAttempts(snapshot: PluginStore): void {
    const committed = this.committedStoreSnapshot;
    for (const entry of snapshot.bases) {
      const prior = committed?.bases.find((candidate) => candidate.id === entry.id);
      if (prior && prior.semanticHead === entry.semanticHead && prior.semanticHash === entry.semanticHash) continue;
      const attempts = this.rejectedAttempts(entry.id);
      if (attempts.some((attempt) => attempt.head === entry.semanticHead)) continue;
      attempts.unshift({
        revision: entry.semanticRevision,
        head: entry.semanticHead,
        hash: entry.semanticHash,
        lineage: [...entry.semanticLineage],
      });
      this.rejectedSemanticAttemptsByBase.set(entry.id, attempts.slice(0, 64));
    }
  }

  private clearSupersededRejectedAttempts(snapshot: PluginStore): void {
    for (const entry of snapshot.bases) {
      const retained = this.rejectedAttempts(entry.id).filter((attempt) => (
        attempt.head !== entry.semanticHead && !entry.semanticLineage.includes(attempt.head)
      ));
      if (retained.length > 0) this.rejectedSemanticAttemptsByBase.set(entry.id, retained);
      else this.rejectedSemanticAttemptsByBase.delete(entry.id);
    }
    for (const id of Object.keys(snapshot.deletedBaseIds)) {
      this.rejectedSemanticAttemptsByBase.delete(id);
    }
  }

  /**
   * Reconcile envelope-level effects of a rejected base operation after memory
   * has been restored to `baseline`. A created/duplicated base can be safely
   * cancelled with a deletion tombstone for its never-committed stable ID.
   * Removing a base or publishing a permanent-deletion tombstone is not
   * reversible under the store's monotonic tombstone model and must fail closed.
   */
  private prepareRejectedEnvelopeRollback(
    baseline: PluginStore,
    attempted: PluginStore,
  ): { changed: boolean; unsafeReason: string } {
    const baselineById = new Map(baseline.bases.map((entry) => [entry.id, entry]));
    const attemptedById = new Map(attempted.bases.map((entry) => [entry.id, entry]));
    const removedBaseIds = [...baselineById.keys()].filter((id) => !attemptedById.has(id));
    const tombstoneIds = new Set([
      ...Object.keys(baseline.deletedBaseIds),
      ...Object.keys(attempted.deletedBaseIds),
    ]);
    const changedTombstoneIds = [...tombstoneIds].filter((id) => (
      baseline.deletedBaseIds[id] !== attempted.deletedBaseIds[id]
    ));
    if (removedBaseIds.length > 0 || changedTombstoneIds.length > 0) {
      return {
        changed: false,
        unsafeReason: "A rejected permanent knowledge-base deletion or tombstone update may already have reached Sync. That monotonic deletion cannot be safely undone automatically.",
      };
    }

    const createdEntries = attempted.bases.filter((entry) => !baselineById.has(entry.id));
    if (createdEntries.length === 0) return { changed: false, unsafeReason: "" };
    const existingTombstones = Object.keys(this.store.deletedBaseIds).length;
    if (existingTombstones + createdEntries.length > MAX_DELETED_KNOWLEDGE_BASE_IDS) {
      return {
        changed: false,
        unsafeReason: "A rejected knowledge-base creation may already have reached Sync, but its stable ID cannot be cancelled because the deletion-tombstone safety limit is full.",
      };
    }
    for (const entry of createdEntries) {
      this.store.deletedBaseIds[entry.id] = Math.max(Date.now(), entry.updatedAt + 1);
    }
    return { changed: true, unsafeReason: "" };
  }

  private neutralSyncedStore(source: PluginStore): PluginStore {
    const snapshot = structuredClone(source);
    for (const entry of snapshot.bases) resetPluginViewState(entry.data);
    const available = snapshot.bases
      .filter((entry) => entry.archivedAt === null)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    snapshot.activeBaseId = available[0]?.id ?? snapshot.bases[0]?.id ?? snapshot.activeBaseId;
    return snapshot;
  }

  private applyDeviceLocalState(store: PluginStore, state = this.deviceLocalState): void {
    for (const entry of store.bases) resetPluginViewState(entry.data);
    if (state?.vaultId === store.vaultId) {
      for (const local of state.bases) {
        const entry = store.bases.find((candidate) => candidate.id === local.baseId);
        if (entry) applyPluginViewState(entry.data, local.view, true);
      }
    }
    const requested = state?.vaultId === store.vaultId ? state.activeBaseId : "";
    const active = store.bases.find((entry) => entry.id === requested && entry.archivedAt === null)
      ?? store.bases.find((entry) => entry.archivedAt === null);
    if (active) store.activeBaseId = active.id;
  }

  private storeDeviceLocalState(state: DeviceLocalPluginState, requireStorage = false): void {
    if (this.deviceLocalPersistenceSuppressed) return;
    if (typeof this.app.saveLocalStorage === "function") {
      this.app.saveLocalStorage(DEVICE_LOCAL_STATE_KEY, state);
    } else if (requireStorage) {
      throw new Error("Device-local storage is unavailable.");
    }
    this.deviceLocalState = state;
    this.deviceLocalStateLoaded = true;
  }

  private noticeLegacyDeviceStateTruncation(historyTruncated: boolean, viewStateTruncated: boolean): void {
    if (!historyTruncated && !viewStateTruncated) return;
    new Notice(
      viewStateTruncated
        ? "Legacy device-local view state exceeded the safe local limit. The active base and newest available history were retained; preserve a pre-upgrade copy of plugin data if older device state may be needed."
        : "Legacy device-local Undo or Redo history exceeded the safe local limit. Newest entries were retained; preserve a pre-upgrade copy of plugin data if older history may be needed.",
      12000,
    );
  }

  private loadDeviceLocalState(): void {
    if (this.deviceLocalPersistenceSuppressed) {
      this.deviceLocalState = null;
      this.deviceLocalStateLoaded = true;
      return;
    }
    if (this.deviceLocalStateLoaded) return;
    this.deviceLocalStateLoaded = true;
    try {
      if (typeof this.app.loadLocalStorage !== "function") {
        this.deviceLocalState = null;
        return;
      }
      const loaded = this.app.loadLocalStorage(DEVICE_LOCAL_STATE_KEY) as unknown;
      const parsed = loaded === null || loaded === undefined
        ? null
        : parseDeviceLocalPluginState(loaded);
      // A missing data.json creates an intentionally untrusted random fallback
      // while Sync may still be delivering this vault's established store.
      // Retain a valid foreign-ID profile but apply it only after an exact
      // vault-ID match; erasing it here would destroy the established vault's
      // route/history during that transient startup window.
      this.deviceLocalState = parsed;
    } catch (error) {
      this.deviceLocalState = null;
      try {
        if (typeof this.app.saveLocalStorage === "function") this.app.saveLocalStorage(DEVICE_LOCAL_STATE_KEY, null);
      } catch (clearError) {
        console.error("Knowledge Base Command Center could not clear malformed device-local state", clearError);
      }
      console.warn("Knowledge Base Command Center ignored malformed device-local state", error);
    }
  }

  private captureLiveDeviceLocalState(): void {
    if (this.deviceLocalPersistenceSuppressed) return;
    if (!this.committedStoreSnapshot
      && this.deviceLocalState
      && this.deviceLocalState.vaultId !== this.store.vaultId) {
      // Startup may currently expose only a random missing-data fallback. A
      // retained profile for another identity may be the exact established
      // vault Sync is about to deliver, so never replace it with this
      // uncommitted bootstrap's empty route/history.
      return;
    }
    try {
      this.deviceLocalState = createDeviceLocalPluginState(this.store);
      this.deviceLocalStateLoaded = true;
    } catch (error) {
      console.error("Knowledge Base Command Center could not capture device-local state", error);
    }
  }

  private persistDeviceLocalState(): void {
    if (this.deviceLocalPersistenceSuppressed) return;
    if (!this.committedStoreSnapshot
      && this.deviceLocalState
      && this.deviceLocalState.vaultId !== this.store.vaultId) {
      // Do not let a selection/onClose save from the uncommitted random
      // missing-data fallback replace a retained established-vault profile.
      return;
    }
    const state = createDeviceLocalPluginState(this.store);
    this.storeDeviceLocalState(state);
  }

  private persistDeviceLocalStateSafely(): void {
    try {
      this.persistDeviceLocalState();
    } catch (error) {
      console.error("Knowledge Base Command Center could not persist device-local state", error);
      new Notice("The knowledge base was saved, but this device's current route or undo history could not be remembered.", 8000);
    }
  }

  private loadSyncRecoveryLocalState(): void {
    if (this.deviceLocalPersistenceSuppressed) {
      this.syncRecoveryLocalState = createDefaultSyncRecoveryLocalState();
      this.syncRecoveryLocalStateLoaded = true;
      return;
    }
    if (this.syncRecoveryLocalStateLoaded) return;
    this.syncRecoveryLocalStateLoaded = true;
    try {
      if (typeof this.app.loadLocalStorage !== "function") return;
      const loaded = this.app.loadLocalStorage(SYNC_RECOVERY_LOCAL_STATE_KEY) as unknown;
      if (loaded !== null && loaded !== undefined) {
        this.syncRecoveryLocalState = parseSyncRecoveryLocalState(loaded);
      }
    } catch {
      this.syncRecoveryLocalState = createDefaultSyncRecoveryLocalState();
      console.warn("Knowledge Base Command Center ignored malformed device-local Sync and Recovery state.");
    }
  }

  private persistSyncRecoveryLocalState(): boolean {
    if (this.deviceLocalPersistenceSuppressed) return false;
    this.loadSyncRecoveryLocalState();
    try {
      if (typeof this.app.saveLocalStorage === "function") {
        this.app.saveLocalStorage(SYNC_RECOVERY_LOCAL_STATE_KEY, this.syncRecoveryLocalState);
        return true;
      }
    } catch {
      // Diagnostics must never turn a successful organization write into a
      // failure or echo a storage error that may contain a private identifier.
      console.warn("Knowledge Base Command Center could not persist device-local Sync and Recovery state.");
    }
    return false;
  }

  private recordLocalSuccessfulSave(at = Date.now()): void {
    if (this.deviceLocalPersistenceSuppressed) return;
    this.loadSyncRecoveryLocalState();
    this.syncRecoveryLocalState.lastLocalSaveAt = at;
    this.persistSyncRecoveryLocalState();
  }

  private recordExternalReload(outcome: ExternalReloadOutcome, at = Date.now()): void {
    if (this.deviceLocalPersistenceSuppressed) return;
    this.loadSyncRecoveryLocalState();
    this.syncRecoveryLocalState.lastExternalReloadAt = at;
    this.syncRecoveryLocalState.lastExternalReloadOutcome = outcome;
    this.persistSyncRecoveryLocalState();
  }

  private recordSemanticConflicts(conflicts: readonly { baseId: string }[], at = Date.now()): void {
    if (this.deviceLocalPersistenceSuppressed) return;
    if (conflicts.length === 0) return;
    this.loadSyncRecoveryLocalState();
    const counts = new Map<string, number>();
    for (const conflict of conflicts) counts.set(conflict.baseId, (counts.get(conflict.baseId) ?? 0) + 1);
    const replaced = new Set(counts.keys());
    this.syncRecoveryLocalState.semanticConflicts = [
      ...[...counts].map(([baseId, count]) => ({ baseId, at, count })),
      ...this.syncRecoveryLocalState.semanticConflicts.filter((entry) => !replaced.has(entry.baseId)),
    ].slice(0, MAX_KNOWLEDGE_BASES);
    this.persistSyncRecoveryLocalState();
  }

  /** Record an explicitly created same-vault recovery without retaining its path. */
  recordRecoveryExport(at = Date.now()): void {
    if (this.deviceLocalPersistenceSuppressed) return;
    this.loadSyncRecoveryLocalState();
    this.syncRecoveryLocalState.lastRecoveryExportAt = at;
    this.persistSyncRecoveryLocalState();
  }

  getSyncRecoveryCenterSnapshot(): SyncRecoveryCenterSnapshot {
    this.loadSyncRecoveryLocalState();
    if (!this.deviceLocalStateLoaded) this.loadDeviceLocalState();
    const active = this.requireActiveBase();
    const committed = this.committedStoreSnapshot?.bases.find((entry) => entry.id === active.id);
    const semanticCommitState = !committed
      ? "unavailable"
      : committed.semanticRevision === active.semanticRevision
        && committed.semanticHead === active.semanticHead
        && committed.semanticHash === active.semanticHash
        ? "committed"
        : "pending";

    let artifactInspectionAvailable = true;
    let artifacts: Array<{ path: string; mtime: number }> = [];
    try {
      const folder = this.app.vault.getAbstractFileByPath(SYNC_RECOVERY_EXPORT_FOLDER);
      if (folder instanceof TFolder) {
        artifacts = folder.children
          .slice(0, MAX_SYNC_RECOVERY_ARTIFACT_ENTRIES + 1)
          .map((entry) => entry instanceof TFile
            ? { path: entry.path, mtime: entry.stat.mtime }
            : { path: "", mtime: 0 });
      }
    } catch {
      artifactInspectionAvailable = false;
    }
    const artifactSummary = summarizeRecoveryArtifacts(artifacts);
    const localConflict = this.syncRecoveryLocalState.semanticConflicts.find((entry) => entry.baseId === active.id);
    const localStateApiAvailable = typeof this.app.loadLocalStorage === "function"
      && typeof this.app.saveLocalStorage === "function";
    const activeHasDeviceProfile = this.deviceLocalState?.bases.some((entry) => entry.baseId === active.id) ?? false;
    const deviceLocalStateProfile = !localStateApiAvailable
      ? "Device-local profile API unavailable"
      : activeHasDeviceProfile
        ? "Active-base view profile stored on this device"
        : this.deviceLocalState?.bases.length
          ? "Other base view profiles stored on this device"
          : "No saved view profile on this device";
    const readOnly = this.isDataReadOnly();
    return {
      activeBaseName: privacySafeBaseName(active.data.settings.workspaceName),
      workspaceProfile: active.data.settings.workspaceMode === "ent-clinical" ? "ENT clinical preset" : "Generic knowledge base",
      semanticRevision: active.semanticRevision,
      semanticHeadSummary: summarizeSemanticHead(active.semanticHead),
      semanticCommitState,
      lastLocalSaveAt: this.syncRecoveryLocalState.lastLocalSaveAt,
      lastExternalReloadAt: this.syncRecoveryLocalState.lastExternalReloadAt,
      lastExternalReloadOutcome: this.syncRecoveryLocalState.lastExternalReloadOutcome,
      conflictRescueCount: artifactSummary.conflictRescueCount,
      conflictRescueCountIsLowerBound: artifactSummary.scanTruncated,
      artifactInspectionAvailable,
      newestConflictRescueAt: artifactSummary.newestConflictRescueAt,
      newestRecoveryExportAt: Math.max(
        this.syncRecoveryLocalState.lastRecoveryExportAt ?? 0,
        artifactSummary.newestNamedRecoveryAt ?? 0,
      ) || null,
      readOnly,
      readOnlyReason: privacySafeReadOnlyReason(this.dataCompatibilityWarning, {
        persistenceUncertain: this.persistenceUncertain,
        semanticConflictRescueFailed: this.semanticConflictRescueFailed,
      }),
      stickyUntilRestart: this.persistenceUncertain || this.semanticConflictRescueFailed,
      activeBaseConcurrentEditAt: localConflict?.at ?? null,
      activeBaseConcurrentEditCount: localConflict?.count ?? 0,
      deviceProfile: describePlatform(Platform),
      configProfile: describeConfigProfile(this.app.vault.configDir),
      deviceLocalStateProfile,
    };
  }

  /**
   * Remove only this plugin's App-local state. This intentionally does not use
   * saveData/saveStoreSnapshot and therefore cannot rewrite synced data.json.
   */
  async clearDeviceLocalData(): Promise<void> {
    if (this.unloaded) throw new Error("The plugin is unloading.");
    if (this.baseOperationBusy || this.dataTransactionBusy || this.directSaveBusyCount > 0 || this.externalReloadBusy) {
      throw new Error("Finish the current knowledge-base operation before clearing device-local data.");
    }
    if (typeof this.app.saveLocalStorage !== "function") {
      throw new Error("Obsidian's device-local storage API is unavailable.");
    }
    let clearFailed = false;
    for (const key of [DEVICE_LOCAL_STATE_KEY, SYNC_RECOVERY_LOCAL_STATE_KEY]) {
      try {
        this.app.saveLocalStorage(key, null);
      } catch {
        clearFailed = true;
      }
    }
    if (clearFailed) throw new Error("One or more device-local values could not be cleared.");

    // Keep both values absent for the rest of this plugin session. Pending
    // selection timers, view onClose hooks, successful saves, or Sync reloads
    // must not silently recreate privacy-reset state before uninstall/restart.
    this.deviceLocalPersistenceSuppressed = true;
    const neutral = this.neutralSyncedStore(this.store);
    this.store = neutral;
    this.useActiveData(this.requireActiveBase().data);
    this.deviceLocalState = null;
    this.deviceLocalStateLoaded = true;
    this.syncRecoveryLocalState = createDefaultSyncRecoveryLocalState();
    this.syncRecoveryLocalStateLoaded = true;
    this.lastFollowUpUndo = null;
    try {
      await this.refreshViews(false);
    } catch {
      // The local values are already cleared. Reopening the view is sufficient
      // if an unrelated leaf failed to refresh; never turn this into a data
      // write or expose a potentially private view error in the confirmation.
      console.error("Knowledge Base Command Center cleared device-local data but could not refresh every open view.");
    }
  }

  /**
   * Announcements are App-local and are marked before opening. That ordering
   * makes an update window one-time even if another live plugin instance or a
   * quick reload follows immediately. Failure to persist fails closed instead
   * of showing the same announcement after every restart.
   */
  private maybeShowUpdateAnnouncement(
    initialLoad: Pick<PluginDataLoadResult, "compatible" | "sourceWasMissing">,
  ): void {
    if (this.updateAnnouncementHandled || this.unloaded || this.deviceLocalPersistenceSuppressed) return;
    this.updateAnnouncementHandled = true;
    if (!this.claimUpdateAnnouncementSession(this.manifest.version)) return;
    this.loadSyncRecoveryLocalState();
    const plan = planUpdateAnnouncement(
      this.manifest.version,
      this.syncRecoveryLocalState.highestPluginVersionSeen,
      initialLoad.compatible && !initialLoad.sourceWasMissing,
    );
    if (plan.shouldPersist && plan.nextHighestObservedVersion) {
      this.syncRecoveryLocalState.highestPluginVersionSeen = plan.nextHighestObservedVersion;
      if (!this.persistSyncRecoveryLocalState()) return;
    }
    if (!plan.announcement || this.unloaded || this.deviceLocalPersistenceSuppressed) return;
    this.openUpdateAnnouncement(plan.announcement);
  }

  private openCurrentUpdateAnnouncement(announcement: UpdateAnnouncement): void {
    if (this.unloaded || this.deviceLocalPersistenceSuppressed) return;
    this.claimUpdateAnnouncementSession(this.manifest.version);
    this.loadSyncRecoveryLocalState();
    const plan = planUpdateAnnouncement(
      this.manifest.version,
      this.syncRecoveryLocalState.highestPluginVersionSeen,
      false,
    );
    if (plan.shouldPersist && plan.nextHighestObservedVersion) {
      this.syncRecoveryLocalState.highestPluginVersionSeen = plan.nextHighestObservedVersion;
      this.persistSyncRecoveryLocalState();
    }
    this.updateAnnouncementHandled = true;
    this.openUpdateAnnouncement(announcement);
  }

  private openUpdateAnnouncement(announcement: UpdateAnnouncement): void {
    if (this.unloaded || this.deviceLocalPersistenceSuppressed || this.activeUpdateAnnouncementModal) return;
    if (!this.appWriteBarrier) this.activateAppWriteBarrier();
    if (this.appWriteBarrier?.activeUpdateAnnouncementVersion !== null) return;
    const modal = new UpdateAnnouncementModal(this.app, announcement, () => {
      if (this.activeUpdateAnnouncementModal === modal) this.activeUpdateAnnouncementModal = null;
      if (this.appWriteBarrier?.activeUpdateAnnouncementVersion === announcement.version) {
        this.appWriteBarrier.activeUpdateAnnouncementVersion = null;
      }
    });
    this.activeUpdateAnnouncementModal = modal;
    if (this.appWriteBarrier) this.appWriteBarrier.activeUpdateAnnouncementVersion = announcement.version;
    try {
      modal.open();
    } catch {
      if (this.activeUpdateAnnouncementModal === modal) this.activeUpdateAnnouncementModal = null;
      if (this.appWriteBarrier?.activeUpdateAnnouncementVersion === announcement.version) {
        this.appWriteBarrier.activeUpdateAnnouncementVersion = null;
      }
      // The release was already marked before presentation. Keep this generic:
      // modal failures must not reveal vault, device, or plugin-data details.
      console.warn("Knowledge Base Command Center could not open the update announcement.");
    }
  }

  private claimUpdateAnnouncementSession(version: string): boolean {
    if (!this.appWriteBarrier) this.activateAppWriteBarrier();
    const claims = this.appWriteBarrier?.updateAnnouncementClaims;
    if (!claims || claims.has(version)) return false;
    claims.add(version);
    return true;
  }

  /**
   * Enter the one conservative state used whenever a write may have reached
   * data.json but its compensating write could not be proven. The marker lives
   * on the shared App object so a replacement plugin instance cannot silently
   * reopen the uncertain file as writable.
   */
  markPersistenceUncertain(message: string): void {
    if (!this.appWriteBarrier) this.activateAppWriteBarrier();
    const barrier = this.appWriteBarrier;
    const firstLocalWarning = !this.persistenceUncertain;
    if (barrier && !barrier.uncertainty) {
      barrier.uncertainty = { message, at: Date.now() };
    }
    this.persistenceUncertain = true;
    this.dataCompatibilityWarning = barrier?.uncertainty?.message ?? message;
    if (firstLocalWarning) new Notice(this.dataCompatibilityWarning, 15000);
  }

  private adoptSharedPersistenceUncertainty(): boolean {
    const uncertainty = this.appWriteBarrier?.uncertainty;
    if (!uncertainty) return false;
    this.persistenceUncertain = true;
    this.dataCompatibilityWarning = uncertainty.message;
    return true;
  }

  async loadPluginData(persistMigration = true, capturedRead?: PluginDataRead): Promise<PluginDataLoadResult> {
    if (capturedRead === undefined) {
      if (!this.appWriteBarrier) this.activateAppWriteBarrier();
      // A replacement instance must not read data.json while the instance it
      // replaced is still finishing an adapter write. Ordering only the later
      // writes would let this instance snapshot stale data and overwrite that
      // final old-instance edit with its first save.
      await this.appReadBarrier;
      if (this.unloaded) throw new Error("This plugin instance was unloaded before its data could be read.");
      this.adoptSharedPersistenceUncertainty();
    }
    let loaded: unknown = null;
    if (!this.persistenceUncertain) this.dataCompatibilityWarning = "";
    try {
      if (capturedRead && "error" in capturedRead) throw capturedRead.error;
      loaded = capturedRead ? capturedRead.value : await this.loadData() as unknown;
    } catch (error) {
      // A syntactically invalid data.json must not stop the plugin from loading.
      // Start from defaults and refuse to save so the original file survives.
      this.useActiveData(structuredClone(DEFAULT_DATA));
      this.store = createDefaultStore(this.data);
      this.dataCompatibilityWarning = `Plugin data could not be parsed (${error instanceof Error ? error.message : String(error)}). Personal organization is read-only so the existing data.json is not overwritten; repair or remove that file to continue.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore: false, hasVaultId: false, identityNeedsWriteback: false, structuralRepairNeedsWriteback: false, remediationNeedsWriteback: false, sourceWasMissing: false, sourceVersion: 0, compatible: false };
    }
    const sourceWasMissing = loaded === null
      || loaded === undefined
      || (typeof loaded === "object" && !Array.isArray(loaded) && Object.keys(loaded).length === 0);
    const sourceVersion = storedDataVersion(loaded);
    const loadedRecord = asUnknownRecord(loaded);
    const recognizedStore = isRecognizedPluginStore(loaded);
    const rawVaultId = typeof loadedRecord.vaultId === "string" ? loadedRecord.vaultId.trim() : "";
    const hadFinalVaultId = recognizedStore && Boolean(rawVaultId) && !isLegacyDeterministicMigratedVaultId(rawVaultId);
    // migrateStore below is the authoritative validation boundary. Retain the
    // earliest supported envelope so a still-pristine provisional identity can
    // be rebased if schema migration or deterministic repair changes its
    // fingerprint. The snapshot is used only after migrateStore has validated
    // the complete envelope successfully.
    const preMigrationStore = recognizedStore && sourceVersion <= STORE_VERSION && rawVaultId
      ? loaded as PluginStore
      : null;
    if (sourceVersion === 0 && Object.keys(loadedRecord).length > 0 && !isRecognizedPluginData(loaded) && !recognizedStore) {
      this.useActiveData(structuredClone(DEFAULT_DATA));
      this.store = createDefaultStore(this.data);
      this.dataCompatibilityWarning = "Plugin data has an unrecognized shape. Personal organization is read-only so the original data is not overwritten; export or repair data.json before continuing.";
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore: false, hasVaultId: false, identityNeedsWriteback: false, structuralRepairNeedsWriteback: false, remediationNeedsWriteback: false, sourceWasMissing, sourceVersion, compatible: false };
    }
    if (!recognizedStore && sourceVersion > DATA_VERSION && isRecognizedPluginData(loaded)) {
      try {
        this.useActiveData(migrateData(loaded));
        this.store = createDefaultStore(this.data);
        this.dataCompatibilityWarning = `Plugin data version ${sourceVersion} is newer than this build (v${DATA_VERSION}). Personal organization is read-only to prevent data loss.`;
      } catch (error) {
        this.useActiveData(structuredClone(DEFAULT_DATA));
        this.store = createDefaultStore(this.data);
        this.dataCompatibilityWarning = `Newer plugin data could not be safely inspected (${error instanceof Error ? error.message : String(error)}). Personal organization is read-only and the existing data.json was not overwritten.`;
      }
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore: false, hasVaultId: false, identityNeedsWriteback: false, structuralRepairNeedsWriteback: false, remediationNeedsWriteback: false, sourceWasMissing, sourceVersion, compatible: false };
    }
    let structuralRepairNeedsWriteback = false;
    let legacyDeviceStateMigrationBlocked = false;
    let pendingLegacyDeviceState: DeviceLocalPluginState | undefined;
    let pendingLegacyHistoryTruncated = false;
    let pendingLegacyViewTruncated = false;
    try {
      this.store = migrateStore(loaded);
      structuralRepairNeedsWriteback = recognizedStore
        && sourceVersion === STORE_VERSION
        && pluginStoreNeedsNormalization(loaded, this.store);
      if (capturedRead === undefined) {
        this.loadDeviceLocalState();
        const needsLegacyDeviceStateMigration = !this.deviceLocalPersistenceSuppressed
          && recognizedStore
          && sourceVersion < STORE_VERSION
          && this.deviceLocalState?.vaultId !== this.store.vaultId;
        if (needsLegacyDeviceStateMigration) {
          try {
            const built = createDeviceLocalPluginStateWithReport(this.store);
            this.storeDeviceLocalState(built.state, true);
            this.noticeLegacyDeviceStateTruncation(built.historyTruncated, built.viewStateTruncated);
          } catch {
            legacyDeviceStateMigrationBlocked = true;
          }
        }
      } else if (!this.deviceLocalPersistenceSuppressed
        && recognizedStore
        && sourceVersion < STORE_VERSION
        && this.deviceLocalState?.vaultId !== this.store.vaultId) {
        // An established pre-v14 store can first arrive through a Sync callback
        // after startup observed a transient missing data.json. Preserve its
        // embedded local route/history, but do not write or adopt the profile
        // until the external merge accepts this exact vault identity.
        const built = createDeviceLocalPluginStateWithReport(this.store);
        pendingLegacyDeviceState = built.state;
        pendingLegacyHistoryTruncated = built.historyTruncated;
        pendingLegacyViewTruncated = built.viewStateTruncated;
      }
      if (!legacyDeviceStateMigrationBlocked) {
        this.applyDeviceLocalState(this.store, pendingLegacyDeviceState ?? this.deviceLocalState);
      }
      this.useActiveData(this.requireActiveBase().data);
      if (capturedRead === undefined) this.rollbackStoreSnapshot = this.neutralSyncedStore(this.store);
    } catch (error) {
      this.useActiveData(structuredClone(DEFAULT_DATA));
      this.store = createDefaultStore(this.data);
      this.dataCompatibilityWarning = `Knowledge-base data could not be migrated (${error instanceof Error ? error.message : String(error)}). The existing data.json remains read-only and was not overwritten.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore, hasVaultId: hadFinalVaultId, identityNeedsWriteback: false, structuralRepairNeedsWriteback: false, remediationNeedsWriteback: false, sourceWasMissing, sourceVersion, compatible: false };
    }
    if (legacyDeviceStateMigrationBlocked) {
      this.dataCompatibilityWarning = "Legacy route and Undo history could not be moved into protected device-local storage. Knowledge-base organization remains read-only and the existing data.json was not overwritten.";
      new Notice(this.dataCompatibilityWarning, 12000);
      return {
        recognizedStore,
        hasVaultId: hadFinalVaultId,
        identityNeedsWriteback: false,
        structuralRepairNeedsWriteback: false,
        remediationNeedsWriteback: false,
        sourceWasMissing,
        sourceVersion,
        compatible: false,
      };
    }
    if (recognizedStore && sourceVersion > STORE_VERSION) {
      this.dataCompatibilityWarning = `Plugin data version ${sourceVersion} is newer than this build (v${STORE_VERSION}). All knowledge bases are read-only to prevent data loss.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore, hasVaultId: hadFinalVaultId, identityNeedsWriteback: false, structuralRepairNeedsWriteback: false, remediationNeedsWriteback: false, sourceWasMissing, sourceVersion, compatible: false };
    }
    if (this.persistenceUncertain) {
      new Notice(this.dataCompatibilityWarning, 15000);
      return {
        recognizedStore,
        hasVaultId: hadFinalVaultId,
        identityNeedsWriteback: false,
        structuralRepairNeedsWriteback: false,
        remediationNeedsWriteback: false,
        sourceWasMissing,
        sourceVersion,
        compatible: false,
      };
    }
    const preRemediationStore = structuredClone(this.store);
    const remediationNeedsWriteback = this.remediateInvalidClinicalIndexes();
    if (remediationNeedsWriteback) {
      // Migration identities fingerprint their pristine payload so two
      // devices upgrading the same old data can converge. ENT invariant
      // repair is deterministic and happens in the same atomic write, so
      // rebase any still-pristine provisional identity to the repaired payload
      // while retaining the device's random nonce. The helper rejects normal
      // identities and any provisional store edited after migration.
      for (const entry of this.store.bases) {
        const before = preRemediationStore.bases.find((candidate) => candidate.id === entry.id);
        const semanticHash = semanticEntryFingerprint(entry);
        if (before && semanticHash === before.semanticHash) continue;
        // Deterministic migration repair is a causal child of the parsed
        // payload, not an unrelated user edit. Every device derives the same
        // child for the same parent and repaired payload.
        const parentHead = entry.semanticHead;
        entry.semanticRevision += 1;
        entry.semanticHash = semanticHash;
        entry.semanticHead = deterministicSemanticHead(parentHead, semanticHash, "clinical-index-remediation");
        entry.semanticLineage = boundedSemanticLineage([parentHead, ...entry.semanticLineage], entry.semanticHead);
      }
      this.useActiveData(this.requireActiveBase().data);
      this.invalidateRecordCache();
    }
    const schemaMigrationNeedsWriteback = recognizedStore && sourceVersion < STORE_VERSION;
    if (schemaMigrationNeedsWriteback || structuralRepairNeedsWriteback || remediationNeedsWriteback) {
      // Migration identities fingerprint their pristine payload so two
      // devices upgrading the same old data can converge. Rebase once from
      // the earliest pre-repair envelope to the final deterministically
      // repaired payload, retaining the random nonce. The helper rejects
      // normal identities and any provisional store edited after migration.
      rebaseProvisionalVaultIdAfterDeterministicRepair(
        preMigrationStore ?? preRemediationStore,
        this.store,
        {
          parentStore: preRemediationStore,
          reason: remediationNeedsWriteback ? "clinical-index-remediation" : undefined,
        },
      );
    }
    try {
      if (persistMigration && !sourceWasMissing
        && (!recognizedStore || !hadFinalVaultId || sourceVersion !== STORE_VERSION
          || structuralRepairNeedsWriteback || remediationNeedsWriteback)) {
        // Migration and every-base clinical remediation share one atomic store
        // write. A large vault therefore never receives one save per base.
        await this.saveStoreSnapshot();
      }
    } catch (error) {
      if (remediationNeedsWriteback) {
        this.store = preRemediationStore;
        this.useActiveData(this.requireActiveBase().data);
        this.invalidateRecordCache();
        this.markPersistenceUncertain("Automatic startup repair was rejected while saving and may already have reached data.json. The pre-repair organization remains available in memory, but knowledge bases stay read-only until Obsidian is restarted after data.json and a same-vault recovery are preserved.");
      }
      throw error;
    }
    // A missing data.json is an untrusted bootstrap state, not an authoritative
    // empty store. Do not persist or commit it merely because this device
    // enabled the plugin before Obsidian Sync delivered the existing payload.
    if (capturedRead === undefined && !sourceWasMissing) {
      this.committedStoreSnapshot = this.neutralSyncedStore(this.store);
      this.rollbackStoreSnapshot = structuredClone(this.committedStoreSnapshot);
    }
    // A recognized interim deterministic identity is usable after migrateStore
    // rotates it in memory. External Sync can therefore reconcile it with a
    // concurrently rotated pristine copy instead of misclassifying it as flat
    // identity-less data.
    return {
      recognizedStore,
      hasVaultId: recognizedStore && Boolean(this.store.vaultId),
      identityNeedsWriteback: recognizedStore && !hadFinalVaultId,
      structuralRepairNeedsWriteback,
      remediationNeedsWriteback,
      sourceWasMissing,
      sourceVersion,
      compatible: true,
      ...(pendingLegacyDeviceState ? { legacyDeviceState: pendingLegacyDeviceState } : {}),
      ...(pendingLegacyHistoryTruncated ? { legacyDeviceStateHistoryTruncated: true } : {}),
      ...(pendingLegacyViewTruncated ? { legacyDeviceStateViewTruncated: true } : {}),
    };
  }

  async savePluginData(): Promise<void> {
    // A reload worker is itself queued on the shared logical barrier and waits
    // for every already-started local transaction to become idle. Registering
    // a new busy direct save behind that worker would deadlock: the worker
    // waits for the save, while the save cannot start until the worker exits.
    // Reject the late edit synchronously through the normal rollback guard,
    // without advertising an operation that can never begin.
    if (this.externalReloadBusy) return this.savePluginDataOperation();
    this.directSaveBusyCount += 1;
    const operation = this.enqueueAppLogicalOperation(() => this.savePluginDataOperation());
    this.directSaveTransactionQueue = operation.then(() => undefined, () => undefined);
    try {
      await operation;
    } finally {
      this.directSaveBusyCount -= 1;
      this.announceOperationsIdle();
    }
  }

  private async savePluginDataOperation(): Promise<void> {
    if (this.unloaded) throw new Error("This plugin instance was unloaded before the change could be saved.");
    if (this.persistenceUncertain) throw new Error(this.dataCompatibilityWarning);
    if (this.dataCompatibilityWarning) return;
    // Resolve the owning base before the external-reload guard. A direct save
    // that was queued behind an adapter write can discover the Sync callback
    // only when its turn begins; its already-mutated live data must then be
    // restored to the last trusted snapshot instead of leaking into the merge
    // worker as if it had committed.
    const baseId = this.store.activeBaseId;
    const entry = this.store.bases.find((candidate) => candidate.id === baseId);
    if (!entry) throw new Error("The knowledge base being saved is unavailable.");
    if (this.externalReloadBusy) {
      // An opaque PluginData snapshot cannot be safely merged with a synced
      // update to the same base: even a selection-only save could resurrect
      // stale collections or settings. Let the external file win atomically
      // and ask the user to repeat the overlapping local action instead.
      const rollbackEntry = (this.committedStoreSnapshot ?? this.rollbackStoreSnapshot)
        ?.bases.find((candidate) => candidate.id === baseId);
      if (rollbackEntry) {
        const localView = capturePluginViewState(entry.data);
        const restoredData = structuredClone(rollbackEntry.data);
        applyPluginViewState(restoredData, localView, true);
        entry.data = restoredData;
        entry.updatedAt = rollbackEntry.updatedAt;
        entry.semanticRevision = rollbackEntry.semanticRevision;
        entry.semanticHead = rollbackEntry.semanticHead;
        entry.semanticHash = rollbackEntry.semanticHash;
        entry.semanticLineage = [...rollbackEntry.semanticLineage];
        if (this.store.activeBaseId === baseId) this.useActiveData(restoredData);
      }
      throw new Error("Knowledge-base data is reloading after a synced change. This overlapping edit was not saved; try it again now.");
    }
    // Bind the save to the base that owns `this.data` at call time. A user can
    // switch bases while a previous adapter write is still pending; resolving
    // the active base later inside the queue could otherwise attach one base's
    // data object to another base.
    entry.data = this.data;
    const attemptedSemanticData = JSON.stringify(semanticPluginDataProjection(this.data));
    // Organization/Undo transactions own a richer rollback boundary (including
    // transient history). Direct/settings saves need the committed or bootstrap
    // fallback here because no outer transaction will restore them.
    const rollbackEntryBeforeAttempt = this.dataTransactionBusy
      ? undefined
      : (this.committedStoreSnapshot ?? this.rollbackStoreSnapshot)
        ?.bases.find((candidate) => candidate.id === baseId);
    const previousUpdatedAt = entry.updatedAt;
    const previousSemanticRevision = entry.semanticRevision;
    const previousSemanticHead = entry.semanticHead;
    const previousSemanticHash = entry.semanticHash;
    const previousSemanticLineage = [...entry.semanticLineage];
    const semanticChanged = this.bumpEntrySemanticRevision(entry);
    if (!semanticChanged) {
      this.persistDeviceLocalState();
      return;
    }
    const attemptedUpdatedAt = entry.updatedAt;
    const attemptedSemanticRevision = entry.semanticRevision;
    const attemptedSemanticHead = entry.semanticHead;
    try {
      await this.saveStoreSnapshot();
    } catch (error) {
      // Direct settings controls can fail before any higher-level transaction
      // owns rollback. Do not leave a rejected save looking newer than the
      // committed base; a later overlapping call owns a different timestamp
      // and must not be clobbered here.
      const ownsLiveCausality = entry.updatedAt === attemptedUpdatedAt
        && entry.semanticRevision === attemptedSemanticRevision
        && entry.semanticHead === attemptedSemanticHead;
      if (ownsLiveCausality) {
        entry.updatedAt = previousUpdatedAt;
        entry.semanticRevision = previousSemanticRevision;
        entry.semanticHead = previousSemanticHead;
        entry.semanticHash = previousSemanticHash;
        entry.semanticLineage = previousSemanticLineage;
      }
      const liveEntry = this.store.bases.find((candidate) => candidate.id === baseId);
      if (rollbackEntryBeforeAttempt
        && liveEntry
        && ownsLiveCausality
        && JSON.stringify(semanticPluginDataProjection(liveEntry.data)) === attemptedSemanticData) {
        const localView = capturePluginViewState(liveEntry.data);
        const restoredData = structuredClone(rollbackEntryBeforeAttempt.data);
        applyPluginViewState(restoredData, localView, true);
        liveEntry.data = restoredData;
        // The rejected queued attempt may have been based on an earlier
        // attempted head that did reach the adapter. Restore the trusted
        // committed causal endpoint before publishing the rollback, otherwise
        // matching that rejected head would incorrectly make the rollback look
        // already superseded while its semantic payload has changed.
        liveEntry.updatedAt = rollbackEntryBeforeAttempt.updatedAt;
        liveEntry.semanticRevision = rollbackEntryBeforeAttempt.semanticRevision;
        liveEntry.semanticHead = rollbackEntryBeforeAttempt.semanticHead;
        liveEntry.semanticHash = rollbackEntryBeforeAttempt.semanticHash;
        liveEntry.semanticLineage = [...rollbackEntryBeforeAttempt.semanticLineage];
        if (this.store.activeBaseId === baseId) this.useActiveData(restoredData);
        this.advanceRejectedSemanticAttempts();
        if (!this.externalReloadBusy) {
          try {
            await this.saveStoreSnapshot();
          } catch (rollbackError) {
            console.error("Knowledge Base Command Center could not persist a rejected direct-save rollback", rollbackError);
            this.markPersistenceUncertain("A rejected knowledge-base edit may have reached Sync, and its compensating rollback could not be saved. Knowledge bases remain read-only until Obsidian is restarted after the plugin data.json is copied or a same-vault recovery is exported.");
            throw new Error(`${error instanceof Error ? error.message : String(error)} The compensating rollback also failed; organization is now read-only.`);
          }
        }
      }
      throw error;
    }
  }

  /** Publish an in-memory rollback after a rejected write as its causal child. */
  async saveCompensatingRollback(): Promise<void> {
    // savePluginDataOperation normally publishes its own causal compensation.
    // Settings keeps this fallback for hosts that do not, but a second request
    // from an old unloaded tab must be a proven no-op once no rejected head is
    // left. Treating that redundant request as a failure would incorrectly
    // poison the shared App barrier after compensation already succeeded.
    if (this.rejectedSemanticAttemptsByBase.size === 0) return;
    // The external worker owns rejected-attempt advancement and authoritative
    // writeback while Sync is being reconciled. Waiting for that worker does
    // not register another busy operation behind it, so both transactions can
    // make progress. Any unexpected worker rejection still propagates to the
    // settings safety fallback.
    if (this.externalReloadBusy && this.externalReloadPromise) {
      await this.externalReloadPromise;
      return;
    }
    this.directSaveBusyCount += 1;
    const operation = this.enqueueAppLogicalOperation(() => this.saveCompensatingRollbackOperation());
    this.directSaveTransactionQueue = operation.then(() => undefined, () => undefined);
    try {
      await operation;
    } finally {
      this.directSaveBusyCount -= 1;
      this.announceOperationsIdle();
    }
  }

  private async saveCompensatingRollbackOperation(): Promise<void> {
    if (this.rejectedSemanticAttemptsByBase.size === 0) return;
    if (this.unloaded) throw new Error("This plugin instance was unloaded before its rollback could be saved.");
    if (this.dataCompatibilityWarning) throw new Error(this.dataCompatibilityWarning);
    const changed = this.advanceRejectedSemanticAttempts();
    if (this.externalReloadBusy) return;
    if (!changed) {
      this.persistDeviceLocalState();
      return;
    }
    try {
      await this.saveStoreSnapshot();
    } catch (error) {
      this.markPersistenceUncertain("A rejected edit may have reached Sync, and its requested compensating rollback could not be saved. Knowledge bases remain read-only until Obsidian is restarted after the plugin data.json and a same-vault recovery are preserved.");
      throw error;
    }
  }

  /**
   * Persist only the explicit per-device view-state whitelist. The capture is
   * applied to the last committed semantic entry, never the live mutable data,
   * so a selection or collapse save cannot smuggle an unsaved organization
   * change into data.json or advance semantic conflict resolution.
   */
  async saveViewState(): Promise<void> {
    if (this.unloaded) throw new Error("This plugin instance was unloaded before the view state could be saved.");
    if (this.dataCompatibilityWarning) return;
    const baseId = this.store.activeBaseId;
    const sourceEntry = this.store.bases.find((entry) => entry.id === baseId && entry.archivedAt === null);
    if (!sourceEntry) throw new Error("The knowledge base view being saved is unavailable.");
    const captured: PluginViewState = capturePluginViewState(sourceEntry.data);
    const externalGeneration = this.externalChangeGeneration;

    while (this.baseOperationBusy || this.dataTransactionBusy || this.directSaveBusyCount > 0) {
      await this.waitForOperationsIdle();
      if (this.store.activeBaseId !== baseId) {
        throw new Error("The active knowledge base changed before its view state could be saved.");
      }
    }
    await this.saveQueue;
    if (this.externalReloadBusy || externalGeneration !== this.externalChangeGeneration) {
      throw new Error("Knowledge-base data is reloading after a synced change. This view state was not saved; try it again now.");
    }
    if (this.store.activeBaseId !== baseId) {
      throw new Error("The active knowledge base changed before its view state could be saved.");
    }

    // A missing data.json intentionally has no committed semantic authority,
    // but localStorage is precisely where harmless first-open route state may
    // live without publishing an empty bootstrap envelope through Sync.
    if (!this.committedStoreSnapshot) {
      this.persistDeviceLocalState();
      return;
    }
    const committedEntry = this.committedStoreSnapshot.bases.find((entry) => entry.id === baseId && entry.archivedAt === null);
    const liveEntry = this.store.bases.find((entry) => entry.id === baseId && entry.archivedAt === null);
    if (!committedEntry || !liveEntry) {
      throw new Error("The committed knowledge base changed before its view state could be saved.");
    }
    const committedSemantic = JSON.stringify(semanticPluginDataProjection(committedEntry.data));
    if (liveEntry.semanticRevision !== committedEntry.semanticRevision
      || JSON.stringify(semanticPluginDataProjection(liveEntry.data)) !== committedSemantic) {
      throw new Error("An unsaved organization change is still pending. Its view state was not saved separately.");
    }
    const verification = structuredClone(committedEntry.data);
    applyPluginViewState(verification, captured, true);
    if (JSON.stringify(semanticPluginDataProjection(verification)) !== committedSemantic) {
      throw new Error("The safe view-state whitelist changed semantic organization. Nothing was saved.");
    }
    this.persistDeviceLocalState();
  }

  private async saveStoreSnapshot(
    allowDuringExternalReload = false,
    expectedExternalGeneration?: number,
  ): Promise<void> {
    await this.saveExplicitStoreSnapshot(this.store, allowDuringExternalReload, expectedExternalGeneration);
  }

  private async saveExplicitStoreSnapshot(
    sourceStore: PluginStore,
    allowDuringExternalReload = false,
    expectedExternalGeneration?: number,
  ): Promise<void> {
    this.adoptSharedPersistenceUncertainty();
    if (this.persistenceUncertain) throw new Error(this.dataCompatibilityWarning);
    if (this.dataCompatibilityWarning) return;
    if (this.externalReloadBusy && !allowDuringExternalReload) {
      throw new Error("Knowledge-base data is reloading after a synced change. This overlapping edit was not saved; try it again now.");
    }
    const snapshot = this.neutralSyncedStore(sourceStore);
    const externalGeneration = expectedExternalGeneration ?? this.externalChangeGeneration;
    const guardExternalGeneration = !allowDuringExternalReload || expectedExternalGeneration !== undefined;
    const save = async (): Promise<void> => {
      if (guardExternalGeneration && externalGeneration !== this.externalChangeGeneration) {
        throw new ExternalSettingsSupersededError("Knowledge-base data changed through Sync before this edit could be saved. The synced copy is being reloaded; try the local edit again afterward.");
      }
      try {
        await this.saveData(snapshot);
      } catch (error) {
        this.recordRejectedSemanticAttempts(snapshot);
        throw error;
      } finally {
        // Count settled adapter writes even when the adapter reports failure:
        // a partially completed write can still have replaced data.json.
        this.adapterWriteGeneration += 1;
      }
      if (guardExternalGeneration && externalGeneration !== this.externalChangeGeneration) {
        this.recordRejectedSemanticAttempts(snapshot);
        throw new ExternalSettingsSupersededError("Knowledge-base data changed through Sync while this edit was saving. The local edit was rolled back; try it again after the synced copy reloads.");
      }
      this.committedStoreSnapshot = structuredClone(snapshot);
      this.rollbackStoreSnapshot = structuredClone(snapshot);
      this.clearSupersededRejectedAttempts(snapshot);
      if (!allowDuringExternalReload) this.recordLocalSuccessfulSave();
      this.persistDeviceLocalStateSafely();
    };
    const operation = this.saveQueue.then(
      () => this.enqueueAppAdapterWrite(save),
      () => this.enqueueAppAdapterWrite(save),
    );
    this.saveQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  private waitForOperationsIdle(): Promise<void> {
    if (!this.baseOperationBusy && !this.dataTransactionBusy && this.directSaveBusyCount === 0) return Promise.resolve();
    return new Promise((resolve) => this.operationIdleResolvers.push(resolve));
  }

  /**
   * Obsidian can construct a replacement plugin instance while an adapter save
   * from the old instance is still running. A Symbol.for barrier stored on the
   * shared App object orders writes across both bundles; the replacement waits
   * for the old write, then becomes the final writer.
   */
  private activateAppWriteBarrier(): void {
    if (this.appWriteBarrier) return;
    const host = this.app as unknown as Record<PropertyKey, unknown>;
    const existing = host[APP_WRITE_BARRIER_KEY];
    const barrier: AppWriteBarrier = existing
      && typeof existing === "object"
      && "generation" in existing
      && "tail" in existing
      ? existing as AppWriteBarrier
      : {
        generation: 0,
        tail: Promise.resolve(),
        logicalTail: Promise.resolve(),
        uncertainty: null,
        updateAnnouncementClaims: new Set<string>(),
        activeUpdateAnnouncementVersion: null,
      };
    const runtimeBarrier = barrier as unknown as Record<string, unknown>;
    const logicalTail = runtimeBarrier.logicalTail;
    const hasLogicalThen = (typeof logicalTail === "object" && logicalTail !== null)
      || typeof logicalTail === "function"
      ? "then" in logicalTail && typeof logicalTail.then === "function"
      : false;
    if (!hasLogicalThen) {
      barrier.logicalTail = barrier.tail;
    }
    if (!("uncertainty" in runtimeBarrier)) barrier.uncertainty = null;
    if (!(runtimeBarrier.updateAnnouncementClaims instanceof Set)) {
      barrier.updateAnnouncementClaims = new Set<string>();
    }
    if (typeof runtimeBarrier.activeUpdateAnnouncementVersion !== "string") {
      barrier.activeUpdateAnnouncementVersion = null;
    }
    const priorTail = barrier.tail;
    const priorLogicalTail = barrier.logicalTail;
    barrier.generation += 1;
    host[APP_WRITE_BARRIER_KEY] = barrier;
    this.appWriteBarrier = barrier;
    this.appReadBarrier = Promise.all([
      priorTail.then(() => undefined, () => undefined),
      priorLogicalTail.then(() => undefined, () => undefined),
    ]).then(() => undefined);
    this.appWriteGeneration = barrier.generation;
    this.unloaded = false;
  }

  private enqueueAppLogicalOperation<T>(
    operation: () => Promise<T>,
    allowReadOnlyDrain = false,
  ): Promise<T> {
    if (this.unloaded) return Promise.reject(new Error("This plugin instance was unloaded before its operation could start."));
    if (!this.appWriteBarrier) this.activateAppWriteBarrier();
    const barrier = this.appWriteBarrier;
    if (!barrier) return Promise.reject(new Error("The cross-instance logical-operation barrier is unavailable."));
    const guardedOperation = async (): Promise<T> => {
      if (barrier.uncertainty && !allowReadOnlyDrain) {
        this.adoptSharedPersistenceUncertainty();
        throw new Error(barrier.uncertainty.message);
      }
      this.activeLogicalOperationDepth += 1;
      try {
        return await operation();
      } finally {
        this.activeLogicalOperationDepth -= 1;
      }
    };
    const queued = barrier.logicalTail.then(guardedOperation, guardedOperation);
    barrier.logicalTail = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private enqueueAppAdapterWrite(write: () => Promise<void>): Promise<void> {
    if (!this.appWriteBarrier) this.activateAppWriteBarrier();
    const barrier = this.appWriteBarrier;
    if (!barrier) throw new Error("The cross-instance adapter-write barrier is unavailable.");
    const generation = this.appWriteGeneration;
    const guardedWrite = async (): Promise<void> => {
      if (barrier.uncertainty) {
        this.adoptSharedPersistenceUncertainty();
        throw new Error(barrier.uncertainty.message);
      }
      // A logical transaction registered before replacement owns its complete
      // compensation. The replacement waits on logicalTail, so allowing that
      // already-started transaction to finish is safer than fencing its second
      // write after the first may have reached data.json.
      if ((this.unloaded || barrier.generation !== generation) && this.activeLogicalOperationDepth === 0) {
        throw new Error("This plugin instance was replaced before its queued write could start.");
      }
      await write();
    };
    const operation = barrier.tail.then(guardedWrite, guardedWrite);
    barrier.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private announceOperationsIdle(): void {
    if (this.baseOperationBusy || this.dataTransactionBusy || this.directSaveBusyCount > 0) return;
    const resolvers = this.operationIdleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  private captureExternalPluginData(adapterWriteGeneration: number): Promise<ExternalPluginDataCapture> {
    return (async (): Promise<ExternalPluginDataCapture> => {
      try {
        const value = await this.loadData() as unknown;
        return { read: { value: structuredClone(value) }, adapterWriteGeneration };
      } catch (error) {
        return { read: { error }, adapterWriteGeneration };
      }
    })();
  }

  private async drainExternalPluginDataCaptures(): Promise<ExternalPluginDataCapture[]> {
    const captures: ExternalPluginDataCapture[] = [];
    while (this.externalReloadCaptures.length > 0) {
      const pending = this.externalReloadCaptures.splice(0);
      captures.push(...await Promise.all(pending));
    }
    return captures;
  }

  private async restoreCapturedPluginData(
    capture: ExternalPluginDataCapture,
    expectedExternalGeneration: number,
  ): Promise<void> {
    if ("error" in capture.read) throw capture.read.error;
    const snapshot = structuredClone(capture.read.value);
    const save = async (): Promise<void> => {
      if (expectedExternalGeneration !== this.externalChangeGeneration) {
        throw new ExternalSettingsSupersededError("A newer synced settings file arrived before the captured file could be restored.");
      }
      try {
        await this.saveData(snapshot);
      } finally {
        this.adapterWriteGeneration += 1;
      }
      if (expectedExternalGeneration !== this.externalChangeGeneration) {
        throw new ExternalSettingsSupersededError("A newer synced settings file arrived while the captured file was being restored.");
      }
    };
    const operation = this.saveQueue.then(
      () => this.enqueueAppAdapterWrite(save),
      () => this.enqueueAppAdapterWrite(save),
    );
    this.saveQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  /**
   * Semantic payloads without proven causal ancestry are concurrent edits,
   * regardless of scalar revision. Preserve every losing complete
   * envelope before the deterministic winner can be adopted or written back.
   */
  private async mergeStoresWithSemanticRescue(
    local: PluginStore,
    incoming: PluginStore,
    preferredActiveId: string,
  ): Promise<StoreMergeResult> {
    const merged = mergeKnowledgeBaseStores(local, incoming, preferredActiveId);
    if (merged.semanticConflicts.length === 0) return merged;
    this.recordSemanticConflicts(merged.semanticConflicts);

    const localLoses = merged.semanticConflicts.some((conflict) => conflict.winner === "incoming");
    const incomingLoses = merged.semanticConflicts.some((conflict) => conflict.winner === "local");
    if (localLoses) {
      const path = await this.writeConflictRescueStore(
        local,
        "Concurrent semantic edits without proven causal ancestry were detected; this is the non-authoritative local envelope.",
      );
      if (!path) throw new SemanticConflictRescueError("The losing local semantic edit could not be rescued before conflict resolution.");
    }
    if (incomingLoses) {
      const path = await this.writeConflictRescueStore(
        incoming,
        "Concurrent semantic edits without proven causal ancestry were detected; this is the non-authoritative incoming envelope.",
      );
      if (!path) throw new SemanticConflictRescueError("The losing incoming semantic edit could not be rescued before conflict resolution.");
    }
    new Notice(
      `${merged.semanticConflicts.length} concurrent knowledge-base edit${merged.semanticConflicts.length === 1 ? " was" : "s were"} preserved in a private conflict rescue before deterministic merging.`,
      12000,
    );
    return merged;
  }

  async onExternalSettingsChange(): Promise<void> {
    if (this.unloaded) return;
    this.adoptSharedPersistenceUncertainty();
    if (this.persistenceUncertain) {
      this.recordExternalReload("blocked");
      new Notice("An external plugin-data change was not reloaded because organization is already in protected read-only mode.", 12000);
      return;
    }
    if (this.semanticConflictRescueFailed) {
      this.recordExternalReload("blocked");
      new Notice("Knowledge-base sync remains read-only because a prior concurrent edit could not be preserved. Restart only after exporting every base or copying the plugin data.json.", 12000);
      return;
    }
    // Preserve this device's current route/collapse/history before any synced
    // envelope is parsed. Captured data.json copies contain only compatibility
    // defaults for those fields and must never become live local state.
    this.captureLiveDeviceLocalState();
    // Sync services may update data.json while an adapter save or base switch is
    // still in flight. Capture the incoming file immediately: waiting for a
    // local write first could overwrite the only copy of that synced payload.
    // Every capture records the adapter-write generation so a later local write
    // forces the merged envelope back to disk even when it matches the capture.
    this.externalChangeGeneration += 1;
    this.externalReloadBusy = true;
    this.externalReloadCaptures.push(this.captureExternalPluginData(this.adapterWriteGeneration));
    this.externalReloadPending = true;
    if (this.externalReloadPromise) return this.externalReloadPromise;
    let operation: Promise<void>;
    let reloadOutcome: ExternalReloadOutcome = "blocked";
    const reload = async (): Promise<void> => {
      // Yield once so `operation` is installed before any clone or migration can
      // fail. Final cleanup below then owns both state fields atomically before
      // this promise settles; no callback can attach to a worker that has
      // already stopped draining captures.
      await Promise.resolve();
      try {
        const initialCommittedStore = this.committedStoreSnapshot
          ? structuredClone(this.committedStoreSnapshot)
          : null;
        const preferredActiveId = this.store.activeBaseId;
        let workingStore = structuredClone(initialCommittedStore ?? this.store);
        this.applyDeviceLocalState(workingStore);
        let baselineTrust: "none" | "fresh" | "legacy-provisional" | "identified" = initialCommittedStore
          ? isFreshVaultId(initialCommittedStore.vaultId) ? "fresh" : "identified"
          : "none";
        do {
          this.externalReloadPending = false;
          await this.waitForOperationsIdle();
          await this.saveQueue;
          this.adoptSharedPersistenceUncertainty();
          if (this.persistenceUncertain) {
            const uncertainCaptures = await this.drainExternalPluginDataCaptures();
            const retained = uncertainCaptures.find((capture) => "value" in capture.read);
            if (retained && "value" in retained.read) {
              this.retainedExternalSettingsPayload = structuredClone(retained.read.value);
            }
            new Notice(this.dataCompatibilityWarning, 15000);
            return;
          }
          // A transaction that was active when the callback arrived may have
          // committed or rolled back its local history while we waited.
          this.captureLiveDeviceLocalState();
          this.applyDeviceLocalState(workingStore);
          // A local write can be rejected only after the adapter has already
          // replaced data.json. Its transaction restores memory and records
          // that attempted causal head. Make the restored state a descendant
          // before comparing any captured Sync payload, so the failed action
          // cannot win merely because its file callback arrived first.
          this.advanceRejectedSemanticAttempts();
          if (this.rejectedSemanticAttemptsByBase.size > 0) {
            workingStore = structuredClone(this.store);
            if (baselineTrust === "none") {
              baselineTrust = isFreshVaultId(workingStore.vaultId) ? "fresh" : "identified";
            }
          }
          // Resolve the whole drained batch before any writeback. Otherwise a
          // write for capture A could replace data.json before capture B's
          // asynchronous loadData call has actually read it.
          const captures = await this.drainExternalPluginDataCaptures();
          // Every callback observed up to this point is represented in the
          // drained array, including callbacks that arrived while a read was
          // resolving. Only a later callback should defer this batch's write.
          this.externalReloadPending = false;
          let latestCapture: ExternalPluginDataCapture | null = null;
          let latestCaptureCompatible = false;
          let latestNeedsWriteback = false;
          let latestBlockingWarning = "";
          let latestAccumulatedRescueStore: PluginStore | null = null;
          for (const capture of captures) {
            latestCapture = capture;
            latestCaptureCompatible = false;
            latestNeedsWriteback = false;
            latestBlockingWarning = "";
            latestAccumulatedRescueStore = null;
            if (this.semanticConflictRescueFailed) {
              // Preserve the first unrescued capture in memory and ignore all
              // later callbacks until restart. Auto-recovery could otherwise
              // hide the only copy of a concurrent semantic edit.
              latestBlockingWarning = this.dataCompatibilityWarning;
              continue;
            }
            // Roll back only this capture. Earlier captures in the same drained
            // batch may already have contributed valid remote changes to the
            // working envelope and must not be discarded by a later transient
            // missing, incompatible, or conflicting payload.
            const fallbackStore = structuredClone(workingStore);
            const fallbackBaselineTrust: "none" | "fresh" | "legacy-provisional" | "identified" = baselineTrust;
            const localWarning = this.dataCompatibilityWarning;
            const loaded = await this.loadPluginData(false, capture.read);
            const incomingWarning = this.dataCompatibilityWarning;
            const recoverableLegacyCapture: boolean = baselineTrust !== "identified"
              && !loaded.recognizedStore
              && "value" in capture.read
              && Object.keys(asUnknownRecord(capture.read.value)).length > 0
              && isRecognizedPluginData(capture.read.value);
            if (loaded.sourceWasMissing) {
              // Sync and filesystem adapters can briefly report a missing
              // data.json while replacing it. With no trusted baseline, wait
              // for a later complete capture and never publish an empty store.
              // With a committed baseline, restore that known-good envelope so
              // a transient deletion cannot become the next restart state.
              workingStore = fallbackStore;
              this.store = workingStore;
              this.useActiveData(this.requireActiveBase().data);
              this.dataCompatibilityWarning = localWarning;
              if (baselineTrust !== "none") {
                latestCaptureCompatible = true;
                latestNeedsWriteback = true;
              }
            } else if (!loaded.compatible || incomingWarning) {
              workingStore = fallbackStore;
              this.store = workingStore;
              this.useActiveData(this.requireActiveBase().data);
              latestBlockingWarning = incomingWarning || localWarning;
              // The last compatible committed/accumulated envelope may not be
              // part of the incompatible file that must remain authoritative for
              // a newer build. Preserve it before this instance settles into
              // read-only mode. The rescue helper deduplicates identical stores.
              if (baselineTrust !== "none") latestAccumulatedRescueStore = structuredClone(fallbackStore);
              this.dataCompatibilityWarning = latestBlockingWarning;
            } else if ((!loaded.recognizedStore || !loaded.hasVaultId) && !recoverableLegacyCapture) {
              workingStore = fallbackStore;
              this.store = workingStore;
              this.useActiveData(this.requireActiveBase().data);
              latestBlockingWarning = "Synced plugin data was written by an older build without a vault identity. Update Knowledge Base Command Center on the other device before editing; local bases remain read-only so neither copy is overwritten.";
              this.dataCompatibilityWarning = latestBlockingWarning;
              new Notice(this.dataCompatibilityWarning, 12000);
            } else {
              const incomingStore = this.store;
              try {
                if (baselineTrust === "none") {
                  // Startup can observe a transient partial data.json. Once a
                  // complete identified store or substantial recognized
                  // legacy payload arrives, adopt its migrated store directly
                  // instead of comparing it with the random fallback identity.
                  workingStore = structuredClone(incomingStore);
                  baselineTrust = isFreshVaultId(incomingStore.vaultId)
                    ? "fresh"
                    : recoverableLegacyCapture || loaded.identityNeedsWriteback
                      ? "legacy-provisional"
                      : "identified";
                  latestNeedsWriteback = recoverableLegacyCapture
                    || loaded.sourceVersion !== STORE_VERSION
                    || loaded.identityNeedsWriteback
                    || loaded.structuralRepairNeedsWriteback
                    || loaded.remediationNeedsWriteback;
                } else if (baselineTrust === "fresh") {
                  const localBootstrapOnly = freshStoreHasOnlyBootstrapChanges(workingStore);
                  if (isFreshVaultId(incomingStore.vaultId)) {
                    const incomingBootstrapOnly = freshStoreHasOnlyBootstrapChanges(incomingStore);
                    const localWins = workingStore.vaultId.localeCompare(incomingStore.vaultId) <= 0;
                    if (workingStore.vaultId === incomingStore.vaultId) {
                      const merged = await this.mergeStoresWithSemanticRescue(workingStore, incomingStore, preferredActiveId);
                      workingStore = merged.store;
                      latestNeedsWriteback = merged.incomingNeedsWriteback
                        || loaded.structuralRepairNeedsWriteback
                        || loaded.remediationNeedsWriteback;
                    } else if (localBootstrapOnly && !incomingBootstrapOnly) {
                      workingStore = structuredClone(incomingStore);
                    } else if (!localBootstrapOnly && incomingBootstrapOnly) {
                      // Local work is the only meaningful fresh-device payload.
                      // Keep it and overwrite the empty incoming bootstrap.
                      latestNeedsWriteback = true;
                    } else if (localBootstrapOnly && incomingBootstrapOnly) {
                      // Two empty devices converge symmetrically on one
                      // provisional identity; their view-only differences are
                      // deliberately disposable.
                      workingStore = structuredClone(localWins ? workingStore : incomingStore);
                      latestNeedsWriteback = workingStore.vaultId !== incomingStore.vaultId;
                    } else if (localWins) {
                      const rescuePath = await this.writeConflictRescueStore(
                        incomingStore,
                        "Two fresh devices contained independent changes before Sync converged; this is the non-authoritative incoming copy.",
                      );
                      if (!rescuePath) throw new Error("Independent fresh-device changes could not be preserved before convergence.");
                      latestNeedsWriteback = true;
                      new Notice(`Independent changes from another fresh device were preserved at ${rescuePath}. The local fresh copy remains active.`, 12000);
                    } else {
                      const rescuePath = await this.writeConflictRescueStore(
                        workingStore,
                        "Two fresh devices contained independent changes before Sync converged; this is the non-authoritative local copy.",
                      );
                      if (!rescuePath) throw new Error("Independent fresh-device changes could not be preserved before convergence.");
                      workingStore = structuredClone(incomingStore);
                      new Notice(`Independent local changes were preserved at ${rescuePath} before the other fresh device became active.`, 12000);
                    }
                    baselineTrust = "fresh";
                  } else {
                    // A fresh identity means this device started before Sync
                    // supplied the vault's established store. The identified
                    // envelope is authoritative. Preserve any real local work
                    // first; view-only bootstrap state can be discarded.
                    if (!localBootstrapOnly) {
                      const rescuePath = await this.writeConflictRescueStore(
                        workingStore,
                        "This device was edited before the established synced knowledge-base store arrived.",
                      );
                      if (!rescuePath) throw new Error("Fresh-device changes could not be preserved before adopting synced data.");
                      new Notice(`Fresh-device changes were preserved at ${rescuePath} before the established synced store was adopted.`, 12000);
                    }
                    workingStore = structuredClone(incomingStore);
                    baselineTrust = recoverableLegacyCapture || loaded.identityNeedsWriteback
                      ? "legacy-provisional"
                      : "identified";
                    latestNeedsWriteback = recoverableLegacyCapture
                      || loaded.sourceVersion !== STORE_VERSION
                      || loaded.identityNeedsWriteback
                      || loaded.structuralRepairNeedsWriteback
                      || loaded.remediationNeedsWriteback;
                  }
                } else if ((baselineTrust === "identified" || baselineTrust === "legacy-provisional")
                  && isFreshVaultId(incomingStore.vaultId)) {
                  // This is the mirror of fresh-local adoption above. A device
                  // that already has identified (or recovered legacy) vault
                  // organization remains authoritative when another device
                  // briefly publishes its pre-Sync fresh identity. Empty
                  // bootstrap state is disposable; meaningful offline work is
                  // rescued before the authoritative envelope is written back.
                  if (!freshStoreHasOnlyBootstrapChanges(incomingStore)) {
                    const rescuePath = await this.writeConflictRescueStore(
                      incomingStore,
                      "A fresh device contained offline changes before it received this vault's established knowledge-base identity.",
                    );
                    if (!rescuePath) throw new Error("Incoming fresh-device changes could not be preserved before restoring established synced data.");
                    new Notice(`Incoming fresh-device changes were preserved at ${rescuePath}. The established synced store remains active.`, 12000);
                  }
                  latestNeedsWriteback = true;
                } else if (baselineTrust === "legacy-provisional"
                  && loaded.recognizedStore
                  && loaded.hasVaultId
                  && !loaded.identityNeedsWriteback) {
                  // A migrated flat payload is only provisional recovery state.
                  // If Sync subsequently supplies a complete envelope, it is
                  // the first authoritative baseline and must supersede the
                  // provisional copy rather than fail a cross-vault merge.
                  workingStore = structuredClone(incomingStore);
                  baselineTrust = "identified";
                  latestNeedsWriteback = loaded.sourceVersion !== STORE_VERSION
                    || loaded.identityNeedsWriteback
                    || loaded.structuralRepairNeedsWriteback
                    || loaded.remediationNeedsWriteback;
                } else {
                  const merged = await this.mergeStoresWithSemanticRescue(workingStore, incomingStore, preferredActiveId);
                  workingStore = merged.store;
                  latestNeedsWriteback = merged.incomingNeedsWriteback
                    || loaded.sourceVersion !== STORE_VERSION
                    || loaded.structuralRepairNeedsWriteback
                    || loaded.remediationNeedsWriteback
                    || recoverableLegacyCapture;
                }
                // Every compatible legacy envelope must be rewritten after its
                // in-memory schema upgrade, even when merge semantics are
                // otherwise equal and neither side requests conflict writeback.
                latestNeedsWriteback ||= loaded.sourceVersion !== STORE_VERSION;
                if (loaded.legacyDeviceState?.vaultId === workingStore.vaultId) {
                  // Only now is the external identity accepted. Apply the
                  // migrated route/history to the final semantic winner and
                  // durably bind it before the v14 write can neutralize the
                  // legacy fields in data.json.
                  this.applyDeviceLocalState(workingStore, loaded.legacyDeviceState);
                  this.storeDeviceLocalState(createDeviceLocalPluginState(workingStore), true);
                  this.noticeLegacyDeviceStateTruncation(
                    loaded.legacyDeviceStateHistoryTruncated === true,
                    loaded.legacyDeviceStateViewTruncated === true,
                  );
                }
                this.store = workingStore;
                this.useActiveData(this.requireActiveBase().data);
                this.dataCompatibilityWarning = "";
                latestCaptureCompatible = true;
                this.retainedExternalSettingsPayload = null;
              } catch (error) {
                baselineTrust = fallbackBaselineTrust;
                workingStore = fallbackStore;
                this.store = workingStore;
                this.useActiveData(this.requireActiveBase().data);
                if ("value" in capture.read) {
                  this.retainedExternalSettingsPayload = structuredClone(capture.read.value);
                }
                const semanticRescueFailed = error instanceof SemanticConflictRescueError;
                this.semanticConflictRescueFailed ||= semanticRescueFailed;
                const rescuePath = semanticRescueFailed
                  ? ""
                  : await this.writeConflictRescueStore(
                    fallbackStore,
                    `Synced knowledge-base data could not be merged: ${error instanceof Error ? error.message : String(error)}`,
                  );
                latestBlockingWarning = semanticRescueFailed
                  ? "Concurrent knowledge-base edits could not be preserved before conflict resolution. Local bases remain read-only, the captured synced payload is retained in memory, and no conflict winner was adopted. Export every base or copy the plugin data.json before restarting Obsidian."
                  : `Synced knowledge-base data could not be merged (${error instanceof Error ? error.message : String(error)}). Local bases remain read-only and the captured synced payload will be preserved.${rescuePath ? ` A private local rescue was saved at ${rescuePath}.` : " Automatic local rescue failed; export every base before restarting Obsidian."}`;
                this.dataCompatibilityWarning = latestBlockingWarning;
                new Notice(this.dataCompatibilityWarning, 12000);
              }
            }
            this.invalidateRecordCache();
          }

          // A newer callback already owns data.json. Drain it before attempting
          // any write for the batch we just processed.
          if (this.externalReloadPending || this.externalReloadCaptures.length > 0) continue;

          if (latestCapture && latestCaptureCompatible) {
            const capturedFileMayHaveBeenOverwritten = this.adapterWriteGeneration !== latestCapture.adapterWriteGeneration;
            if (latestNeedsWriteback || capturedFileMayHaveBeenOverwritten) {
              const writebackGeneration = this.externalChangeGeneration;
              try {
                await this.saveStoreSnapshot(true, writebackGeneration);
              } catch (error) {
                if (error instanceof ExternalSettingsSupersededError) continue;
                this.markPersistenceUncertain(`Synced knowledge bases were merged in memory, but the merged data could not be saved (${error instanceof Error ? error.message : String(error)}). The attempted write may have reached data.json; organization remains read-only until Obsidian is restarted after every base and data.json are preserved.`);
              }
            } else {
              // The latest captured file already contains this payload.
              this.committedStoreSnapshot = this.neutralSyncedStore(workingStore);
              this.rollbackStoreSnapshot = structuredClone(this.committedStoreSnapshot);
              this.persistDeviceLocalStateSafely();
            }
          } else if (latestCapture && latestBlockingWarning) {
            if (latestAccumulatedRescueStore) {
              const rescuePath = await this.writeConflictRescueStore(
                latestAccumulatedRescueStore,
                "A valid synced update was followed by an incompatible or unreadable plugin-data capture; this is the last compatible accumulated state.",
              );
              latestBlockingWarning = rescuePath
                ? `${latestBlockingWarning} The prior valid synced state was preserved in a private rescue at ${rescuePath}.`
                : `${latestBlockingWarning} Automatic rescue of the prior valid synced state failed; do not restart Obsidian until you export every base or copy the plugin data.json.`;
              this.dataCompatibilityWarning = latestBlockingWarning;
              new Notice(latestBlockingWarning, 15000);
            }
            const capturedFileMayHaveBeenOverwritten = this.adapterWriteGeneration !== latestCapture.adapterWriteGeneration;
            if (capturedFileMayHaveBeenOverwritten && "value" in latestCapture.read) {
              this.retainedExternalSettingsPayload = structuredClone(latestCapture.read.value);
              const restoreGeneration = this.externalChangeGeneration;
              try {
                await this.restoreCapturedPluginData(latestCapture, restoreGeneration);
                this.retainedExternalSettingsPayload = null;
              } catch (error) {
                if (error instanceof ExternalSettingsSupersededError) continue;
                this.markPersistenceUncertain(`${latestBlockingWarning} The captured file is retained in memory, but restoring it to data.json failed (${error instanceof Error ? error.message : String(error)}). The file may now contain an uncertain partial write; do not restart Obsidian until data.json and every base are preserved.`);
              }
            }
          }
          if (latestCapture) {
            reloadOutcome = latestCaptureCompatible && !latestBlockingWarning && !this.persistenceUncertain
              ? "applied"
              : "blocked";
          }
          try {
            await this.refreshViews(false);
          } catch (error) {
            console.error("Knowledge Base Command Center reloaded synced data but could not refresh its views", error);
            new Notice("Synced knowledge-base data was reloaded, but the view could not refresh. Reopen the command center to update it.", 8000);
          }
        } while (this.externalReloadPending || this.externalReloadCaptures.length > 0);
      } finally {
        if (this.externalReloadPromise === operation) {
          this.externalReloadPromise = null;
          this.externalReloadBusy = false;
          this.recordExternalReload(reloadOutcome);
        }
      }
    };
    // The reload owns every merge, rescue, authoritative writeback, and
    // fail-closed decision as one cross-instance logical transaction. A new
    // plugin instance must not read a partially-written capture in the narrow
    // gap between an adapter rejection and this worker's compensation or
    // uncertainty marker.
    operation = this.enqueueAppLogicalOperation(reload, true);
    this.externalReloadPromise = operation;
    return operation;
  }

  getKnowledgeBases(includeArchived = false): KnowledgeBaseEntry[] {
    return this.store.bases.filter((entry) => includeArchived || entry.archivedAt === null);
  }

  getActiveKnowledgeBase(): KnowledgeBaseEntry { return this.requireActiveBase(); }
  getActiveKnowledgeBaseId(): string { return this.store.activeBaseId; }
  getDataEpoch(): number { return this.dataEpoch; }
  getExternalChangeGeneration(): number { return this.externalChangeGeneration; }
  getSearchGeneration(): number { return this.searchGeneration; }
  getVaultId(): string { return this.store.vaultId; }

  /**
   * Build a path-free multi-base transfer from isolated copies. Each inner
   * value is produced and validated by the ordinary portable-v4 exporter, so
   * portfolio export never introduces a second package schema or reads note
   * bodies/attachments.
   */
  createPortfolioExport(
    requests: ReadonlyArray<{ baseId: string; selection: PortableExportSelection; completeLibrarySet?: boolean }>,
    exportedAt = new Date().toISOString(),
  ): PortfolioExportV1 {
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before exporting a portfolio.");
    const selected = requests.map((request) => {
      const entry = this.store.bases.find((candidate) => candidate.id === request.baseId && candidate.archivedAt === null);
      if (!entry) throw new Error("A selected knowledge base is unavailable or archived.");
      return {
        entry,
        records: this.getRecordsForEntry(entry),
        selection: request.selection,
        completeLibrarySet: request.completeLibrarySet,
      };
    });
    return createPortfolioExport(selected, exportedAt, this.store.vaultId);
  }

  /** Prepare the sole exact mutation plan used by both portfolio preview and apply. */
  createPortfolioImportPlan(
    bundle: unknown,
    mappings: readonly PortfolioImportMapping[],
    allowCrossVaultReplace = false,
  ): PortfolioImportPlan {
    this.assertDataWritable();
    if (this.baseOperationBusy || this.dataTransactionBusy || this.directSaveBusyCount > 0) {
      throw new Error("Finish the current knowledge-base operation before preparing a portfolio import.");
    }
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before preparing a portfolio import.");
    const recordsByBaseId = new Map<string, readonly VaultRecord[]>();
    for (const mapping of mappings) {
      const destination = mapping.destination;
      if (destination.kind !== "existing") continue;
      const entry = this.store.bases.find((candidate) => candidate.id === destination.baseId && candidate.archivedAt === null);
      if (entry) recordsByBaseId.set(entry.id, this.getRecordsForEntry(entry));
    }
    const folderExists = (path: string): boolean => this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFolder;
    const templateExists = (path: string): boolean => {
      const file = path ? this.app.vault.getAbstractFileByPath(normalizePath(path)) : null;
      return file instanceof TFile && file.extension.toLowerCase() === "md";
    };
    return createPortfolioImportPlan(this.store, bundle, mappings, {
      allowCrossVaultReplace,
      expectedExternalGeneration: this.externalChangeGeneration,
      recordsByBaseId,
      resources: {
        configDir: this.app.vault.configDir,
        folderExists,
        templateExists,
      },
    });
  }

  /**
   * Write usable per-base same-vault recovery files first, then commit every
   * previewed base as one guarded store transaction. A failed write or stale
   * guard leaves the store untouched; commitBaseStoreChange supplies the
   * existing adapter-save rollback and Sync compensation boundary.
   */
  async applyPortfolioImportPlan(
    plan: PortfolioImportPlan,
    typedConfirmation = "",
  ): Promise<string[]> {
    this.assertDataWritable();
    if (this.baseOperationBusy || this.dataTransactionBusy || this.directSaveBusyCount > 0) {
      throw new Error("Finish the current knowledge-base operation before applying a portfolio import.");
    }
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before applying a portfolio import.");
    // Validate every stale/confirmation/plan-integrity guard before creating
    // recovery files. The guarded transaction repeats this check after them.
    const validationStore = structuredClone(this.store);
    applyPortfolioImportPlan(validationStore, plan, typedConfirmation, this.externalChangeGeneration);
    const recoveryPaths: string[] = [];
    for (const recovery of plan.recoveryPackages) {
      const file = await this.writePortableJson("backup", recovery.package);
      recoveryPaths.push(file.path);
    }
    await this.commitBaseStoreChange(() => {
      applyPortfolioImportPlan(this.store, plan, typedConfirmation, this.externalChangeGeneration);
    });
    return recoveryPaths;
  }

  getFollowUpCategories(): FollowUpCategoryDefinition[] {
    return this.data.settings.followUpCategories.map((category) => ({ ...category }));
  }

  async replaceFollowUpCategories(categories: readonly FollowUpCategoryDefinition[]): Promise<void> {
    const cleaned = cleanFollowUpCategoryDefinitions(categories);
    if (cleaned.length === 0 || cleaned.every((category) => category.archived)) {
      throw new Error("Keep at least one active Quick Append category.");
    }
    if (cleaned.length !== categories.length) throw new Error("One or more Quick Append categories are invalid or duplicated.");
    await this.mutate("Update Quick Append categories", () => {
      this.data.settings.followUpCategories = cleaned;
    }, { includeSettings: true });
  }

  openQuickAppendCurrentNote(explicitPath?: string): void {
    try {
      this.assertDataWritable();
      const file = explicitPath
        ? this.app.vault.getAbstractFileByPath(normalizePath(explicitPath))
        : this.app.workspace.getActiveFile();
      if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") {
        new Notice("Open a Markdown note first, then run quick append: Add to current note.", 7000);
        return;
      }
      this.openQuickAppendForFile(file);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  openQuickAppendExistingNote(): void {
    try {
      this.assertDataWritable();
      const openedBaseId = this.store.activeBaseId;
      const openedDataEpoch = this.dataEpoch;
      const files = this.getVaultNoteFiles()
        .filter((file) => !isImmutableSourcePath(file.path))
        .sort((left, right) => left.path.localeCompare(right.path));
      if (files.length === 0) {
        new Notice("No Markdown notes are available for quick append.");
        return;
      }
      new VaultFilePickerModal(this.app, files, "Choose a note for Quick Append", (file) => {
        if (this.store.activeBaseId !== openedBaseId || this.dataEpoch !== openedDataEpoch) {
          new Notice("The active knowledge base changed. Reopen quick append before choosing a note.", 8000);
          return;
        }
        this.openQuickAppendForFile(file);
      }).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private openQuickAppendForFile(file: TFile): void {
    const openedBaseId = this.store.activeBaseId;
    const openedDataEpoch = this.dataEpoch;
    const categories = this.getFollowUpCategories();
    if (!categories.some((category) => !category.archived)) {
      new Notice("No active quick append categories are configured. Restore or add one in plugin settings.", 8000);
      return;
    }
    new QuickAppendModal(this.app, {
      file,
      categories,
      initialDate: this.today(),
      onSubmit: async ({ categoryId, date, text }) => {
        if (this.store.activeBaseId !== openedBaseId || this.dataEpoch !== openedDataEpoch) {
          throw new Error("The active knowledge base changed. Reopen Quick Append before continuing.");
        }
        await this.appendFollowUpToFile(file, categoryId, text, date);
      },
    }).open();
  }

  async appendFollowUpToFile(file: TFile, categoryId: string, text: string, date = this.today()): Promise<void> {
    this.assertDataWritable();
    if (file.extension.toLocaleLowerCase() !== "md") throw new Error("Quick Append can change only Markdown notes.");
    if (isImmutableSourcePath(file.path)) throw new Error("Immutable source-book files cannot be changed by Quick Append.");
    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile) || currentFile.extension.toLocaleLowerCase() !== "md" || currentFile !== file) {
      throw new Error("The selected note is no longer the same Markdown file. Reopen Quick Append and choose it again.");
    }
    const category = this.data.settings.followUpCategories.find((item) => item.id === categoryId && !item.archived);
    if (!category) throw new Error("The selected Quick Append category is no longer active.");
    let undo: FollowUpUndoMetadata | null = null;
    await this.app.vault.process(currentFile, (content) => {
      if (this.app.vault.getAbstractFileByPath(currentFile.path) !== currentFile) {
        throw new Error("The selected note is no longer the same Markdown file. Reopen Quick Append and choose it again.");
      }
      assertFollowUpNoteWritable(content);
      const result = appendFollowUpEntry({ content, category, text, date });
      undo = result.undo;
      return result.content;
    });
    if (!undo) throw new Error("Quick Append did not receive a completed atomic note update.");
    this.lastFollowUpUndo = { expiresAt: Date.now() + FOLLOW_UP_UNDO_WINDOW_MS, file: currentFile, undo };
    new Notice(`Added to ${category.label} in ${currentFile.basename}.`, 5000);
  }

  private canUndoLastFollowUpAppend(): boolean {
    const pending = this.lastFollowUpUndo;
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      this.lastFollowUpUndo = null;
      return false;
    }
    const currentFile = this.app.vault.getAbstractFileByPath(pending.file.path);
    if (currentFile !== pending.file) {
      this.lastFollowUpUndo = null;
      return false;
    }
    return true;
  }

  private async undoLastFollowUpAppend(): Promise<void> {
    this.assertDataWritable();
    const pending = this.lastFollowUpUndo;
    if (!pending || !this.canUndoLastFollowUpAppend()) throw new Error("There is no recent Quick Append change to undo.");
    const currentFile = this.app.vault.getAbstractFileByPath(pending.file.path);
    if (!(currentFile instanceof TFile) || currentFile !== pending.file) {
      throw new Error("The note changed or was replaced and the transient Quick Append undo is unavailable.");
    }
    await this.app.vault.process(currentFile, (content) => {
      if (this.app.vault.getAbstractFileByPath(pending.file.path) !== pending.file) {
        throw new Error("The note changed or was replaced and the transient Quick Append undo is unavailable.");
      }
      assertFollowUpNoteWritable(content);
      return reverseFollowUpAppend(content, pending.undo);
    });
    this.lastFollowUpUndo = null;
    new Notice(`Undid the last Quick Append in ${currentFile.basename}.`, 5000);
  }

  private cleanKnowledgeBaseName(name: string): string {
    const clean = name.normalize("NFC").trim();
    if (!clean) throw new Error("Enter a knowledge-base name.");
    if (clean.length > 100) throw new Error("Keep the knowledge-base name to 100 characters or fewer.");
    if (/[\p{Cc}\p{Cf}]/u.test(clean)) throw new Error("The knowledge-base name contains an unsupported control character.");
    return clean;
  }

  private knowledgeBaseNameExists(name: string, exceptId = ""): boolean {
    const key = name.trim().normalize("NFC").toLowerCase();
    return this.store.bases.some((entry) => entry.id !== exceptId
      && entry.archivedAt === null
      && entry.data.settings.workspaceName.trim().normalize("NFC").toLowerCase() === key);
  }

  private createUniqueKnowledgeBaseEntry(data: PluginData): KnowledgeBaseEntry {
    const unavailable = new Set([
      ...this.store.bases.map((entry) => entry.id),
      ...Object.keys(this.store.deletedBaseIds),
    ]);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const entry = createKnowledgeBaseEntry(data);
      if (!unavailable.has(entry.id)) return entry;
    }
    throw new Error("A new stable knowledge-base ID could not be allocated safely. Try again.");
  }

  private async commitBaseStoreChange(change: () => void, persistSyncedStore = true): Promise<void> {
    this.assertDataWritable();
    if (this.baseOperationBusy) throw new Error("Another knowledge-base change is still being saved.");
    if (this.dataTransactionBusy) throw new Error("Finish the current organization change before switching knowledge bases.");
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before switching bases.");
    // A debounced text control has already mutated the active PluginData object.
    // Commit or causally compensate that draft before a lifecycle transaction
    // snapshots/rebinds the store, otherwise switching bases could publish the
    // draft without the settings transaction that owns its rollback boundary.
    if (this.settingsTab && !await this.settingsTab.prepareForKnowledgeBaseChange()) {
      throw new Error("Save or restore the pending settings change before changing knowledge bases.");
    }
    // The flush yields through the shared logical/adapter barriers. Recheck all
    // owners before claiming baseOperationBusy in case Sync or another action
    // began while the settings write was settling.
    if (this.baseOperationBusy) throw new Error("Another knowledge-base change is still being saved.");
    if (this.dataTransactionBusy) throw new Error("Finish the current organization change before switching knowledge bases.");
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before switching bases.");
    this.baseOperationBusy = true;
    try {
      // The whole logical transaction—not merely its first adapter write—is
      // shared across replacement plugin instances. Direct/settings saves that
      // were already requested finish before a base switch can rebind `data`.
      await this.directSaveTransactionQueue;
      if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before switching bases.");
      await this.enqueueAppLogicalOperation(async () => {
        await this.saveQueue;
        const backup = structuredClone(this.store);
        let attemptedStore: PluginStore | null = null;
        try {
          change();
          this.useActiveData(this.requireActiveBase().data);
          this.invalidateRecordCache();
          if (persistSyncedStore) {
            attemptedStore = structuredClone(this.store);
            await this.saveStoreSnapshot();
          } else {
            this.persistDeviceLocalState();
          }
        } catch (error) {
          if (attemptedStore) this.recordRejectedSemanticAttempts(this.neutralSyncedStore(attemptedStore));
          this.store = backup;
          this.useActiveData(this.requireActiveBase().data);
          this.invalidateRecordCache();
          const envelopeRollback = attemptedStore
            ? this.prepareRejectedEnvelopeRollback(backup, attemptedStore)
            : { changed: false, unsafeReason: "" };
          if (envelopeRollback.unsafeReason) {
            this.markPersistenceUncertain(`${envelopeRollback.unsafeReason} Knowledge bases remain read-only until Obsidian is restarted after the plugin data.json and a same-vault recovery are preserved.`);
          } else {
            const compensationNeeded = this.advanceRejectedSemanticAttempts() || envelopeRollback.changed;
            if (compensationNeeded && !this.externalReloadBusy) {
              try {
                await this.saveStoreSnapshot();
              } catch (rollbackError) {
                console.error("Knowledge Base Command Center could not persist the failed base-change rollback", rollbackError);
                this.markPersistenceUncertain("A rejected knowledge-base change may have reached Sync, and its compensating rollback could not be saved. Knowledge bases remain read-only until Obsidian is restarted after the plugin data.json and a same-vault recovery are preserved.");
                throw new Error("The knowledge-base change failed and its rollback could not be saved. Organization is now read-only; preserve data.json and export a same-vault recovery before restarting Obsidian.");
              }
            }
          }
          try {
            await this.refreshViews(false);
          } catch (refreshError) {
            console.error("Knowledge Base Command Center restored a failed base change but could not refresh its view", refreshError);
          }
          throw error;
        }
        // The store change is committed once saveData succeeds. A rendering
        // failure must not roll memory back while leaving the new base on disk.
        try {
          await this.refreshViews(false);
        } catch (error) {
          console.error("Knowledge Base Command Center saved the base change but could not refresh its view", error);
          new Notice("The knowledge-base change was saved, but the view could not refresh. Reopen the command center to update it.", 8000);
        }
      });
    } finally {
      this.baseOperationBusy = false;
      this.announceOperationsIdle();
    }
  }

  async switchKnowledgeBase(id: string): Promise<void> {
    if (id === this.store.activeBaseId) return;
    const target = this.store.bases.find((entry) => entry.id === id && entry.archivedAt === null);
    if (!target) throw new Error("That knowledge base is unavailable.");
    await this.commitBaseStoreChange(() => { this.store.activeBaseId = target.id; }, false);
    new Notice(`Switched to “${target.data.settings.workspaceName}”.`);
  }

  async createKnowledgeBase(name: string, mode: WorkspaceMode, primaryFolder = ""): Promise<KnowledgeBaseEntry> {
    const cleanName = this.cleanKnowledgeBaseName(name);
    if (mode === "generic" && !primaryFolder.trim()) {
      throw new Error("Choose an indexed notes folder for this knowledge base.");
    }
    if (this.knowledgeBaseNameExists(cleanName)) throw new Error(`A knowledge base named “${cleanName}” already exists.`);
    if (this.store.bases.length >= MAX_KNOWLEDGE_BASES) throw new Error(`This installation already contains the maximum of ${MAX_KNOWLEDGE_BASES} knowledge bases, including archived bases.`);
    let created: KnowledgeBaseEntry | null = null;
    await this.commitBaseStoreChange(() => {
      const next = structuredClone(DEFAULT_DATA);
      next.settings = structuredClone(mode === "ent-clinical" ? ENT_CLINICAL_SETTINGS : DEFAULT_SETTINGS);
      next.settings.setupComplete = true;
      next.settings.workspaceName = cleanName;
      if (mode === "generic" && primaryFolder.trim()) {
        const folder = primaryFolder.trim().replace(/^\/+|\/+$/g, "");
        const error = validateWritableFolderPath(folder, this.app.vault.configDir);
        if (error) throw new Error(error);
        next.settings.primaryFolder = folder;
        next.settings.defaultNoteFolder = folder;
        next.settings.proposalFolder = `${folder}/Inbox`;
      }
      created = this.createUniqueKnowledgeBaseEntry(next);
      this.store.bases.push(created);
      this.store.activeBaseId = created.id;
    });
    if (!created) throw new Error("The knowledge base could not be created.");
    return created;
  }

  async renameKnowledgeBase(id: string, name: string): Promise<void> {
    const cleanName = this.cleanKnowledgeBaseName(name);
    if (this.knowledgeBaseNameExists(cleanName, id)) throw new Error(`A knowledge base named “${cleanName}” already exists.`);
    await this.commitBaseStoreChange(() => {
      const entry = this.store.bases.find((candidate) => candidate.id === id);
      if (!entry) throw new Error("That knowledge base is unavailable.");
      entry.data.settings.workspaceName = cleanName;
      this.bumpEntrySemanticRevision(entry);
    });
  }

  async duplicateKnowledgeBase(id: string, name: string): Promise<KnowledgeBaseEntry> {
    const source = this.store.bases.find((entry) => entry.id === id);
    if (!source) throw new Error("That knowledge base is unavailable.");
    const cleanName = this.cleanKnowledgeBaseName(name);
    if (this.knowledgeBaseNameExists(cleanName)) throw new Error(`A knowledge base named “${cleanName}” already exists.`);
    if (this.store.bases.length >= MAX_KNOWLEDGE_BASES) throw new Error(`This installation already contains the maximum of ${MAX_KNOWLEDGE_BASES} knowledge bases, including archived bases.`);
    let duplicate: KnowledgeBaseEntry | null = null;
    await this.commitBaseStoreChange(() => {
      const copy = structuredClone(source.data);
      copy.settings.workspaceName = cleanName;
      copy.undoStack = [];
      copy.redoStack = [];
      copy.layoutSnapshots = [];
      copy.selectedPath = "";
      copy.activeTab = copy.settings.defaultTab;
      duplicate = this.createUniqueKnowledgeBaseEntry(copy);
      this.store.bases.push(duplicate);
      this.store.activeBaseId = duplicate.id;
    });
    if (!duplicate) throw new Error("The knowledge base could not be duplicated.");
    return duplicate;
  }

  async archiveKnowledgeBase(id: string): Promise<void> {
    const available = this.getKnowledgeBases();
    if (available.length <= 1) throw new Error("Create another knowledge base before archiving the last one.");
    await this.commitBaseStoreChange(() => {
      const entry = this.store.bases.find((candidate) => candidate.id === id && candidate.archivedAt === null);
      if (!entry) throw new Error("That knowledge base is unavailable.");
      entry.archivedAt = Math.max(Date.now(), entry.updatedAt + 1);
      this.bumpEntrySemanticRevision(entry, entry.archivedAt);
      if (this.store.activeBaseId === id) {
        const fallback = this.store.bases.find((candidate) => candidate.id !== id && candidate.archivedAt === null);
        if (!fallback) throw new Error("No fallback knowledge base is available.");
        this.store.activeBaseId = fallback.id;
      }
    });
  }

  async restoreKnowledgeBase(id: string): Promise<void> {
    await this.commitBaseStoreChange(() => {
      const entry = this.store.bases.find((candidate) => candidate.id === id && candidate.archivedAt !== null);
      if (!entry) throw new Error("That archived knowledge base is unavailable.");
      if (this.knowledgeBaseNameExists(entry.data.settings.workspaceName, entry.id)) {
        const original = entry.data.settings.workspaceName;
        const prefix = original.slice(0, 86).trim();
        let candidate = `${prefix} (restored)`;
        let suffix = 2;
        while (this.knowledgeBaseNameExists(candidate, entry.id)) {
          candidate = `${prefix} (restored ${suffix})`;
          suffix += 1;
        }
        entry.data.settings.workspaceName = candidate;
      }
      entry.archivedAt = null;
      this.bumpEntrySemanticRevision(entry);
    });
  }

  /** Permanently removes plugin-owned state for one archived base. Markdown files are never touched. */
  async deleteArchivedKnowledgeBase(id: string, expectedUpdatedAt: number): Promise<void> {
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt <= 0) {
      throw new Error("The archived knowledge-base confirmation is stale. Reopen Manage knowledge bases and try again.");
    }
    await this.commitBaseStoreChange(() => {
      if (id === this.store.activeBaseId) throw new Error("The active knowledge base cannot be permanently deleted.");
      if (!this.store.bases.some((entry) => entry.archivedAt === null)) {
        throw new Error("At least one knowledge base must remain available.");
      }
      const index = this.store.bases.findIndex((entry) => entry.id === id);
      const entry = index >= 0 ? this.store.bases[index] : undefined;
      if (!entry) throw new Error("That archived knowledge base is unavailable.");
      if (entry.archivedAt === null) throw new Error("Archive this knowledge base before permanently deleting it.");
      if (entry.updatedAt !== expectedUpdatedAt) {
        throw new Error("That archived knowledge base changed after the confirmation opened. Review it again before deleting.");
      }
      if (!Object.prototype.hasOwnProperty.call(this.store.deletedBaseIds, id)
        && Object.keys(this.store.deletedBaseIds).length >= MAX_DELETED_KNOWLEDGE_BASE_IDS) {
        throw new Error(`This vault already contains ${MAX_DELETED_KNOWLEDGE_BASE_IDS.toLocaleString()} permanent-deletion tombstones. No older tombstone was discarded; export your bases before changing plugin data manually.`);
      }
      this.store.deletedBaseIds[id] = Math.max(Date.now(), entry.updatedAt + 1);
      this.store.bases.splice(index, 1);
    });
  }

  assertDataWritable(): void {
    this.adoptSharedPersistenceUncertainty();
    if (this.dataCompatibilityWarning) throw new Error(this.dataCompatibilityWarning);
  }

  isDataReadOnly(): boolean {
    this.adoptSharedPersistenceUncertainty();
    return Boolean(this.dataCompatibilityWarning);
  }
  isClinicalMode(): boolean { return this.data.settings.workspaceMode === "ent-clinical"; }
  canVisuallyMoveAcrossGroups(): boolean { return !this.isClinicalMode() || this.data.settings.allowClinicalVisualGroupMoves; }

  getLibraries(includeArchived = false): LibraryDefinition[] {
    return (this.data.portableIndex.libraries ?? [])
      .filter((library) => includeArchived || library.archivedAt === null)
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
      .map((library) => ({ ...library }));
  }

  getLibrary(libraryId: string): LibraryDefinition | null {
    const library = (this.data.portableIndex.libraries ?? []).find((candidate) => candidate.id === libraryId);
    return library ? { ...library } : null;
  }

  getLibraryNoteProfile(libraryId: string): LibraryNoteProfile | null {
    const profile = this.data.settings.libraryNoteProfiles[libraryId];
    return profile ? { ...profile } : null;
  }

  getEffectiveLibraryNoteProfile(libraryId: string): EffectiveLibraryNoteProfile {
    this.requireLibrary(libraryId);
    return resolveLibraryNoteProfile(this.data.settings, libraryId);
  }

  validateLibraryNoteProfile(libraryId: string, profile: LibraryNoteProfile): string | null {
    if (!this.getLibrary(libraryId)) return "That library is no longer available.";
    const error = validateLibraryNoteProfile(profile, this.data.settings, libraryId, this.app.vault.configDir);
    if (error) return error;
    const effective = resolveLibraryNoteProfile({
      ...this.data.settings,
      libraryNoteProfiles: { ...this.data.settings.libraryNoteProfiles, [libraryId]: profile },
    }, libraryId);
    if (effective.mode !== "template") return null;
    const template = this.app.vault.getAbstractFileByPath(normalizePath(effective.templatePath));
    return template instanceof TFile && template.extension.toLocaleLowerCase() === "md"
      ? null
      : "The selected Library template could not be found.";
  }

  async setLibraryNoteProfile(libraryId: string, profile: LibraryNoteProfile | null): Promise<void> {
    const library = this.requireLibrary(libraryId);
    const cleaned = profile === null
      ? null
      : cleanLibraryNoteProfiles({ [libraryId]: profile }, new Set([libraryId]))[libraryId] ?? null;
    if (profile !== null) {
      if (!cleaned || Object.keys(cleaned).length !== Object.keys(profile).length) {
        throw new Error("The Library profile contains an unsupported value or vault path.");
      }
      const error = this.validateLibraryNoteProfile(libraryId, cleaned);
      if (error) throw new Error(error);
    }
    const current = this.data.settings.libraryNoteProfiles[libraryId] ?? null;
    if (JSON.stringify(current) === JSON.stringify(cleaned)) return;
    await this.mutate(`${cleaned ? "Update" : "Reset"} creation defaults for “${library.name}”`, () => {
      this.requireLibrary(libraryId);
      if (cleaned) this.data.settings.libraryNoteProfiles[libraryId] = { ...cleaned };
      else delete this.data.settings.libraryNoteProfiles[libraryId];
    }, { includeSettings: true, requireUndo: true });
  }

  private libraryDefinitions(): LibraryDefinition[] {
    return this.data.portableIndex.libraries ??= [];
  }

  private cleanLibraryName(value: string, label: string): string {
    const clean = value.normalize("NFC").trim();
    if (!clean) throw new Error(`Enter a ${label}.`);
    if (clean.length > 100) throw new Error(`Keep the ${label} to 100 characters or fewer.`);
    if (/[\p{Cc}\p{Cf}]/u.test(clean)) throw new Error(`The ${label} contains an unsupported control character.`);
    return clean;
  }

  private cleanLibraryIcon(icon: string): string {
    return (LIBRARY_ICON_IDS as readonly string[]).includes(icon) ? icon : "library";
  }

  private normalizedOrganizationLabel(value: string): string {
    return value.normalize("NFC").trim().toLowerCase();
  }

  private assertUniqueLibraryName(name: string, exceptId = ""): void {
    const key = this.normalizedOrganizationLabel(name);
    if ((this.data.portableIndex.libraries ?? []).some((library) => library.id !== exceptId
      && this.normalizedOrganizationLabel(library.name) === key)) {
      throw new Error(`A library named “${name}” already exists, including archived libraries.`);
    }
  }

  private requireLibrary(libraryId: string, includeArchived = true): LibraryDefinition {
    const library = (this.data.portableIndex.libraries ?? []).find((candidate) => candidate.id === libraryId);
    if (!library || (!includeArchived && library.archivedAt !== null)) {
      throw new Error("That library is no longer available.");
    }
    return library;
  }

  private normalizeLibraryOrder(): void {
    this.libraryDefinitions()
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
      .forEach((library, index) => { library.order = index; });
  }

  async createLibrary(input: LibraryDefinitionInput): Promise<string> {
    const name = this.cleanLibraryName(input.name, "library name");
    const singularName = this.cleanLibraryName(input.singularName, "singular item name");
    this.assertUniqueLibraryName(name);
    if ((this.data.portableIndex.libraries ?? []).length >= MAX_LIBRARIES) {
      throw new Error(`A knowledge base can contain at most ${MAX_LIBRARIES} libraries.`);
    }
    let id = makeId("library");
    while (this.getLibrary(id)) id = makeId("library");
    await this.mutate(`Create library “${name}”`, () => {
      this.assertUniqueLibraryName(name);
      const libraries = this.libraryDefinitions();
      libraries.push({
        id,
        name,
        singularName,
        icon: this.cleanLibraryIcon(input.icon),
        order: libraries.length,
        sourceKind: null,
        archivedAt: null,
      });
      this.data.portableIndex.libraryLayouts[id] = [];
      this.data.activeTab = libraryTabId(id);
    }, { includePortableIndex: true, includeActiveTab: true, requireUndo: true });
    return id;
  }

  async updateLibrary(libraryId: string, input: LibraryDefinitionInput): Promise<void> {
    const name = this.cleanLibraryName(input.name, "library name");
    const singularName = this.cleanLibraryName(input.singularName, "singular item name");
    this.assertUniqueLibraryName(name, libraryId);
    await this.mutate(`Update library “${name}”`, () => {
      const library = this.requireLibrary(libraryId);
      this.assertUniqueLibraryName(name, libraryId);
      library.name = name;
      library.singularName = singularName;
      // Preserve a forward-compatible icon imported by an older/newer device
      // when this edit changes only labels. A newly chosen icon must still be
      // one of this build's curated, registered choices.
      library.icon = input.icon === library.icon ? library.icon : this.cleanLibraryIcon(input.icon);
    }, { includePortableIndex: true, requireUndo: true });
  }

  async reorderLibrary(libraryId: string, destinationIndex: number): Promise<void> {
    const ordered = this.getLibraries(true);
    const from = ordered.findIndex((library) => library.id === libraryId);
    if (from < 0) throw new Error("That library is no longer available.");
    const to = Math.max(0, Math.min(ordered.length - 1, Math.trunc(destinationIndex)));
    if (from === to) return;
    await this.mutate(`Reorder library “${ordered[from]?.name ?? "Library"}”`, () => {
      const current = [...this.libraryDefinitions()]
        .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
      const currentFrom = current.findIndex((library) => library.id === libraryId);
      if (currentFrom < 0) throw new Error("That library is no longer available.");
      const [library] = current.splice(currentFrom, 1);
      if (!library) return;
      current.splice(Math.max(0, Math.min(current.length, to)), 0, library);
      current.forEach((candidate, index) => { candidate.order = index; });
      this.data.portableIndex.libraries = current;
    }, { includePortableIndex: true, requireUndo: true });
  }

  async archiveLibrary(libraryId: string): Promise<void> {
    const current = this.requireLibrary(libraryId, false);
    await this.mutate(`Archive library “${current.name}”`, () => {
      const library = this.requireLibrary(libraryId, false);
      library.archivedAt = Date.now();
      const tab = libraryTabId(libraryId);
      if (this.data.activeTab === tab) this.data.activeTab = "curriculum";
      if (this.data.settings.defaultTab === tab) this.data.settings.defaultTab = "curriculum";
    }, { includePortableIndex: true, includeSettings: true, includeActiveTab: true, requireUndo: true });
  }

  async restoreLibrary(libraryId: string): Promise<void> {
    const current = this.requireLibrary(libraryId);
    if (current.archivedAt === null) return;
    await this.mutate(`Restore library “${current.name}”`, () => {
      const library = this.requireLibrary(libraryId);
      library.archivedAt = null;
      this.normalizeLibraryOrder();
    }, { includePortableIndex: true, requireUndo: true });
  }

  librarySubjectCount(libraryId: string): number {
    const active = this.requireActiveBase();
    let counts = this.librarySubjectCountsCacheByBase.get(active.id);
    if (!counts) {
      // Count the effective record projection rather than portable identities.
      // Native ENT records belong to their built-in Library before one-time
      // catalog initialization, while resolved identities and placeholders are
      // already deduplicated by the projection. Cache one O(records) pass so a
      // manager containing many Libraries does not rescan the vault per row.
      const pathsByLibrary = new Map<string, Set<string>>();
      for (const record of this.getRecordsForEntry(active)) {
        if (!record.libraryId) continue;
        const paths = pathsByLibrary.get(record.libraryId) ?? new Set<string>();
        paths.add(record.path);
        pathsByLibrary.set(record.libraryId, paths);
      }
      counts = new Map([...pathsByLibrary].map(([id, paths]) => [id, paths.size]));
      this.librarySubjectCountsCacheByBase.set(active.id, counts);
    }
    return counts.get(libraryId) ?? 0;
  }

  /**
   * Resolve immutable clinical source classification without allowing visual
   * Index or Library membership to change it. A native topic parked in a custom
   * Library is intentionally excluded from the Index; that exclusion must not
   * make it look like a generic note when it returns to the Index.
   */
  private clinicalIndexClassification(
    path: string,
    subject: PortableSubjectDefinition | null,
    fallbackKind: RecordKind,
    data = this.data,
    fileByPath?: ReadonlyMap<string, TFile>,
  ): { kind: RecordKind; indexEligible: boolean } {
    const file = isPortablePlaceholderPath(path)
      ? null
      : fileByPath
        ? fileByPath.get(path) ?? null
        : this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const kind = subject?.recordKind ?? fallbackKind;
      return { kind, indexEligible: kind === "topic" };
    }
    const frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
    const proposalFolder = normalizePath(data.settings.proposalFolder);
    const detected = this.identityForFile(
      file,
      frontmatter,
      data,
      true,
      new Set([file.path]),
      proposalFolder ? `${proposalFolder}/` : "",
      new Set(),
      // Classification is source-derived. Ignore the visual exclusion created
      // while a topic sits in a custom Library.
      new Set(),
    );
    const kind = detected?.kind ?? subject?.recordKind ?? fallbackKind;
    return {
      kind,
      // An imported topic may intentionally be backed by an Inbox proposal
      // until promotion. This is the sole non-native-topic Index exception.
      indexEligible: kind === "topic" || (kind === "proposal" && subject?.recordKind === "topic"),
    };
  }

  /**
   * Classify persisted clinical membership for upgrade repair without reading
   * a TFile or metadata cache. Vault Sync can deliver plugin data before its
   * Markdown files, so filesystem-dependent repair would produce different
   * provisional fingerprints on otherwise identical devices.
   */
  private deterministicClinicalRepairClassification(
    path: string,
    subject: PortableSubjectDefinition | null,
    fallbackKind: RecordKind,
    data: PluginData,
  ): { kind: RecordKind; indexEligible: boolean } {
    if (isPortablePlaceholderPath(path)) {
      const kind = subject?.recordKind ?? fallbackKind;
      return { kind, indexEligible: kind === "topic" };
    }
    const normalized = normalizePath(path);
    const proposalFolder = normalizePath(data.settings.proposalFolder);
    let kind: RecordKind;
    if (proposalFolder && pathIsInsideFolder(normalized, proposalFolder)) kind = "proposal";
    else if (pathIsInsideFolder(normalized, data.settings.primaryFolder)) kind = "topic";
    else {
      const basename = normalized.split("/").at(-1)?.replace(/\.md$/i, "") ?? "";
      if (pathIsInsideFolder(normalized, PROCEDURE_ROOT) && basename.startsWith("Procedure - ")) kind = "procedure";
      else if (pathIsInsideFolder(normalized, MEDICATION_ROOT) && basename.startsWith("Drug - ")) kind = "medication";
      else if (pathIsInsideFolder(normalized, SYNDROME_ROOT) && basename.startsWith("Syndrome - ")) kind = "syndrome";
      else kind = "note";
    }
    return {
      kind,
      indexEligible: kind === "topic" || (kind === "proposal" && subject?.recordKind === "topic"),
    };
  }

  /**
   * Repair data written before the ENT Index destination guard existed. The
   * pass is deterministic, touches plugin data only, and covers active,
   * inactive, and archived bases before one store-level writeback.
   */
  private remediateInvalidClinicalIndexes(entries: readonly KnowledgeBaseEntry[] = this.store.bases): boolean {
    let storeChanged = false;

    for (const entry of entries) {
      const data = entry.data;
      if (data.settings.workspaceMode !== "ent-clinical") continue;
      const subjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
      const ownerIdsByPath = new Map<string, string[]>();
      for (const [subjectId, path] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
        if (!path || !subjectById.has(subjectId)) continue;
        const owners = ownerIdsByPath.get(path) ?? [];
        owners.push(subjectId);
        ownerIdsByPath.set(path, owners);
      }
      const changedSubjectIds = new Set<string>();
      const removedIndexPaths = new Set<string>();
      let entryChanged = false;

      const rehome = (subject: PortableSubjectDefinition, path: string, kind: RecordKind): void => {
        const libraryId = isLibraryKind(kind) ? BUILTIN_LIBRARY_IDS[kind] : null;
        if (subject.indexed) { subject.indexed = false; entryChanged = true; }
        if (subject.parentId !== null) { subject.parentId = null; entryChanged = true; }
        if (subject.recordKind !== kind) { subject.recordKind = kind; entryChanged = true; }
        if (subject.libraryId !== libraryId) { subject.libraryId = libraryId; entryChanged = true; }
        changedSubjectIds.add(subject.id);
        removedIndexPaths.add(path);
      };

      // First repair every explicitly indexed portable identity. Source
      // classification wins over stale imported recordKind metadata.
      for (const subject of data.portableIndex.subjects) {
        if (!subject.indexed) continue;
        const path = portableSubjectPath(data, subject.id);
        const classification = this.deterministicClinicalRepairClassification(
          path,
          subject,
          subject.recordKind,
          data,
        );
        if (!classification.indexEligible) rehome(subject, path, classification.kind);
      }

      // Manual paths are a second historical entrance into the Index. Remove
      // invalid paths and rehome all identities bound to a native clinical
      // Library path, including source-kind collisions.
      const nextManualPaths: string[] = [];
      for (const path of data.manualIndexPaths) {
        const placeholderId = portableSubjectIdFromPath(path);
        const ownerIds = placeholderId ? [placeholderId] : ownerIdsByPath.get(path) ?? [];
        const subjects = ownerIds.map((id) => subjectById.get(id)).filter((subject): subject is PortableSubjectDefinition => Boolean(subject));
        const representative = subjects[0] ?? null;
        const classification = this.deterministicClinicalRepairClassification(
          path,
          representative,
          representative?.recordKind ?? "note",
          data,
        );
        if (classification.indexEligible) {
          nextManualPaths.push(path);
          continue;
        }
        entryChanged = true;
        removedIndexPaths.add(path);
        for (const subject of subjects) rehome(subject, path, classification.kind);
      }
      if (nextManualPaths.length !== data.manualIndexPaths.length
        || nextManualPaths.some((path, index) => path !== data.manualIndexPaths[index])) {
        data.manualIndexPaths = nextManualPaths;
        entryChanged = true;
      }

      if (!entryChanged) continue;
      // A subject leaving the Index cannot remain a curriculum parent or in a
      // stale custom Library layout. Reconciliation places protected records
      // in their built-in Library as explicit or durable Unplaced entries.
      for (const subject of data.portableIndex.subjects) {
        if (subject.parentId && changedSubjectIds.has(subject.parentId)) subject.parentId = null;
      }
      for (const [path, parentPath] of Object.entries(data.curriculumVisual.parentByPath)) {
        if (removedIndexPaths.has(path)) delete data.curriculumVisual.parentByPath[path];
        else if (parentPath && removedIndexPaths.has(parentPath)) data.curriculumVisual.parentByPath[path] = null;
      }
      for (const [container, paths] of Object.entries(data.curriculumVisual.orderByContainer)) {
        const next = paths.filter((path) => !removedIndexPaths.has(path));
        if (next.length > 0) data.curriculumVisual.orderByContainer[container] = next;
        else delete data.curriculumVisual.orderByContainer[container];
      }
      for (const path of removedIndexPaths) delete data.indexGroupByPath[path];
      reconcilePortableLibraryLayouts(data.portableIndex);
      // This is schema/invariant repair, not a user edit. Preserve updatedAt so
      // a stale synced payload cannot become newest merely because this build
      // repaired it before last-writer-wins merging.
      storeChanged = true;
    }
    return storeChanged;
  }

  private normalizeActiveDataAfterRestore(): void {
    if (this.data.settings.workspaceMode === "ent-clinical") {
      normalizeKnowledgeBaseLibrariesAndNavigation(this.data);
    }
    this.remediateInvalidClinicalIndexes([this.requireActiveBase()]);
  }

  private clinicalIndexClassificationForPath(
    path: string,
  ): { kind: RecordKind; indexEligible: boolean; title: string } | { error: string } {
    const placeholderId = portableSubjectIdFromPath(path);
    const ownerIds = placeholderId
      ? [placeholderId]
      : Object.entries(this.data.portableIndex.resolvedPathBySubjectId)
        .filter(([, resolvedPath]) => resolvedPath === path)
        .map(([subjectId]) => subjectId);
    if (ownerIds.length > 1) {
      return { error: "That Markdown note has more than one portable identity. Repair the duplicate path owner before moving it." };
    }
    const subject = ownerIds[0] ? this.getPortableSubject(ownerIds[0]) : null;
    if (placeholderId && !subject) return { error: "That portable subject is no longer available." };
    const file = placeholderId ? null : this.app.vault.getAbstractFileByPath(path);
    if (!placeholderId && (!(file instanceof TFile) || file.extension.toLowerCase() !== "md")) {
      return { error: "Choose an existing Markdown note or portable placeholder." };
    }
    const record = this.getRecord(path);
    const classification = this.clinicalIndexClassification(
      path,
      subject,
      subject?.recordKind ?? record?.kind ?? "note",
    );
    return {
      ...classification,
      title: subject?.title ?? record?.title ?? (file instanceof TFile ? file.basename : "Untitled subject"),
    };
  }

  /** Return why a record cannot enter the Index, without changing plugin data. */
  getRecordIndexDestinationError(path: string): string | null {
    if (!this.isClinicalMode()) return null;
    const classification = this.clinicalIndexClassificationForPath(path);
    if ("error" in classification) return classification.error;
    if (classification.indexEligible) return null;
    return `The ENT ${this.data.settings.indexLabel} accepts topic subjects only. “${classification.title}” is source-classified as ${classification.kind} and cannot be moved there.`;
  }

  /** Assert the complete active ENT Index invariant after a bulk/import apply. */
  assertClinicalIndexEligibility(): void {
    if (!this.isClinicalMode()) return;
    const subjectById = new Map(this.data.portableIndex.subjects.map((subject) => [subject.id, subject]));
    const ownerIdByPath = new Map<string, string | null>();
    for (const [subjectId, path] of Object.entries(this.data.portableIndex.resolvedPathBySubjectId)) {
      if (!path || !subjectById.has(subjectId)) continue;
      ownerIdByPath.set(path, ownerIdByPath.has(path) ? null : subjectId);
    }
    const candidateSubjectIdByPath = new Map<string, string | null>();
    for (const subject of this.data.portableIndex.subjects) {
      if (subject.indexed) candidateSubjectIdByPath.set(portableSubjectPath(this.data, subject.id), subject.id);
    }
    for (const path of this.data.manualIndexPaths) {
      if (candidateSubjectIdByPath.has(path)) continue;
      const placeholderId = portableSubjectIdFromPath(path);
      candidateSubjectIdByPath.set(path, placeholderId ?? ownerIdByPath.get(path) ?? null);
    }
    const fileByPath = new Map<string, TFile>();
    for (const path of candidateSubjectIdByPath.keys()) {
      if (isPortablePlaceholderPath(path)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && file.extension.toLowerCase() === "md") fileByPath.set(path, file);
    }
    let firstError = "";
    let incompatibleCount = 0;
    const reject = (message: string): void => {
      if (!firstError) firstError = message;
      incompatibleCount += 1;
    };
    for (const [path, subjectId] of candidateSubjectIdByPath) {
      if (!isPortablePlaceholderPath(path) && ownerIdByPath.get(path) === null) {
        reject("That Markdown note has more than one portable identity. Repair the duplicate path owner before moving it.");
        continue;
      }
      const subject = subjectId ? subjectById.get(subjectId) ?? null : null;
      if (isPortablePlaceholderPath(path) && !subject) {
        reject("That portable subject is no longer available.");
        continue;
      }
      const file = fileByPath.get(path) ?? null;
      if (!isPortablePlaceholderPath(path) && !file) {
        reject("Choose an existing Markdown note or portable placeholder.");
        continue;
      }
      const classification = this.clinicalIndexClassification(
        path,
        subject,
        subject?.recordKind ?? "note",
        this.data,
        fileByPath,
      );
      if (classification.indexEligible) continue;
      const title = subject?.title ?? file?.basename ?? "Untitled subject";
      reject(`The ENT ${this.data.settings.indexLabel} accepts topic subjects only. “${title}” is source-classified as ${classification.kind} and cannot be moved there.`);
    }
    if (incompatibleCount === 0) return;
    const more = incompatibleCount > 1
      ? ` ${incompatibleCount - 1} additional indexed subject${incompatibleCount === 2 ? " is" : "s are"} incompatible.`
      : "";
    throw new Error(`${firstError}${more} The ENT Index was not changed.`);
  }

  /** Removing a visual custom placement may reveal a protected native Library. */
  getRecordUnassignedLibraryFallback(record: Pick<VaultRecord, "kind" | "role">): LibraryDefinition | null {
    if (!this.isClinicalMode() || record.role !== "library") return null;
    return this.getLibraries(true).find((library) => library.sourceKind === record.kind) ?? null;
  }

  private clinicalLibraryRemovalClassification(subject: PortableSubjectDefinition): {
    kind: RecordKind;
    indexEligible: boolean;
  } {
    const resolvedPath = this.data.portableIndex.resolvedPathBySubjectId[subject.id] ?? "";
    return this.clinicalIndexClassification(
      resolvedPath || portablePlaceholderPath(subject.id),
      subject,
      subject.recordKind,
    );
  }

  /** Return why an archived custom library cannot be rehomed to a destination, without changing plugin data. */
  getLibraryRemovalDestinationError(
    libraryId: string,
    destination: LibraryRemovalDestination,
  ): string | null {
    const source = (this.data.portableIndex.libraries ?? []).find((library) => library.id === libraryId);
    if (!source) return "That library is no longer available.";
    if (source.sourceKind !== null) return "Built-in clinical libraries cannot be permanently deleted.";
    if (source.archivedAt === null) return "Archive this library before permanently deleting it.";
    const targetLibraryId = typeof destination === "object" ? destination.libraryId : null;
    if (targetLibraryId === libraryId) return "Choose a different destination library.";
    const target = targetLibraryId
      ? (this.data.portableIndex.libraries ?? []).find((library) => library.id === targetLibraryId)
      : null;
    if (targetLibraryId && (!target || target.archivedAt !== null)) return "That destination library is no longer available.";
    if (!this.isClinicalMode() || destination === "unassigned" || target?.sourceKind === null) return null;

    const classified = this.data.portableIndex.subjects
      .filter((subject) => subjectLibraryId(subject) === libraryId)
      .map((subject) => ({ subject, ...this.clinicalLibraryRemovalClassification(subject) }));
    const incompatible = destination === "index"
      ? classified.filter((item) => !item.indexEligible)
      : classified.filter((item) => item.kind !== target?.sourceKind);
    if (incompatible.length === 0) return null;

    const kinds = [...new Set(incompatible.map((item) => item.kind))].sort().join(", ");
    const examples = incompatible.slice(0, 3).map((item) => `“${item.subject.title}”`).join(", ");
    const more = incompatible.length > 3 ? ` and ${incompatible.length - 3} more` : "";
    const destinationRule = destination === "index"
      ? "The ENT knowledge index accepts topic subjects only"
      : `The built-in ${target?.name ?? "clinical"} library accepts ${target?.sourceKind ?? "matching"} subjects only`;
    return `${destinationRule}. ${incompatible.length} incompatible subject${incompatible.length === 1 ? "" : "s"} (${kinds}): ${examples}${more}. No subjects were moved. Move incompatible records first, or choose Unassigned or a custom library.`;
  }

  /** Permanently remove one archived custom library without deleting or editing Markdown notes. */
  async deleteLibrary(libraryId: string, destination: LibraryRemovalDestination = "unassigned"): Promise<void> {
    const current = this.requireLibrary(libraryId);
    const destinationError = this.getLibraryRemovalDestinationError(libraryId, destination);
    if (destinationError) throw new Error(destinationError);
    const targetLibraryId = typeof destination === "object" ? destination.libraryId : null;
    await this.mutate(`Delete archived library “${current.name}”`, () => {
      const library = this.requireLibrary(libraryId);
      if (library.sourceKind !== null || library.archivedAt === null) {
        throw new Error("That library can no longer be permanently deleted.");
      }
      const targetLibrary = targetLibraryId ? this.requireLibrary(targetLibraryId, false) : null;
      const targetGroupId = targetLibrary
        ? this.ensureCatalogPortableGroup(targetLibrary.id, targetLibrary.name)
        : destination === "index" ? this.ensureTopicPortableGroup("Ungrouped") : null;
      const sourceSubjects = this.data.portableIndex.subjects
        .filter((subject) => subjectLibraryId(subject) === libraryId);
      const sourceGroupIds = new Set(sourceSubjects.map((subject) => subject.groupId));
      this.removePortableSubjectsFromLibraryLayouts(new Set(sourceSubjects.map((subject) => subject.id)));
      for (const subject of sourceSubjects) {
        const path = portableSubjectPath(this.data, subject.id);
        subject.indexed = destination === "index";
        subject.libraryId = targetLibraryId;
        subject.parentId = null;
        if (targetGroupId) subject.groupId = targetGroupId;
        if (destination === "index") {
          this.data.excludedIndexPaths = this.data.excludedIndexPaths.filter((candidate) => candidate !== path);
          if (!pathIsInsideFolder(path, this.data.settings.primaryFolder) && !this.data.manualIndexPaths.includes(path)) {
            this.data.manualIndexPaths.push(path);
          }
          this.data.indexGroupByPath[path] = "Ungrouped";
        } else {
          this.data.manualIndexPaths = this.data.manualIndexPaths.filter((candidate) => candidate !== path);
          if (pathIsInsideFolder(path, this.data.settings.primaryFolder)
            && !this.data.excludedIndexPaths.includes(path)) this.data.excludedIndexPaths.push(path);
          delete this.data.indexGroupByPath[path];
        }
        resetCurriculumVisualPath(this.data.curriculumVisual, path);
      }
      const referencedGroupIds = new Set(this.data.portableIndex.subjects.map((subject) => subject.groupId));
      this.data.portableIndex.groups = this.data.portableIndex.groups.filter((group) => (
        !sourceGroupIds.has(group.id) || referencedGroupIds.has(group.id)
      ));
      delete this.data.portableIndex.libraryLayouts[libraryId];
      delete this.data.settings.libraryNoteProfiles[libraryId];
      this.data.portableIndex.libraries = this.libraryDefinitions()
        .filter((candidate) => candidate.id !== libraryId);
      this.normalizeLibraryOrder();
      const tab = libraryTabId(libraryId);
      if (this.data.activeTab === tab) this.data.activeTab = "curriculum";
      if (this.data.settings.defaultTab === tab) this.data.settings.defaultTab = "curriculum";
      this.data.savedViews = this.data.savedViews.filter((view) => view.tab !== tab);
      this.dedupeActiveOrganizationPaths();
    }, { includePortableIndex: true, includeSettings: true, includeActiveTab: true, requireUndo: true });
  }

  private invalidateKnowledgeBaseSearchSnapshot(): void {
    this.searchGeneration += 1;
    this.knowledgeBaseSearchVaultSnapshot = null;
  }

  invalidateRecordCache(membershipChanged = true): void {
    this.invalidateKnowledgeBaseSearchSnapshot();
    this.recordsCacheByBase.clear();
    this.clearInactiveSearchRecordsCache();
    this.recordPathsCacheByBase.clear();
    this.librarySubjectCountsCacheByBase.clear();
    if (membershipChanged) {
      this.referencedPathsCacheByBase.clear();
      this.excludedPathsCacheByBase.clear();
    }
    this.recordLinkIndex.clear();
    this.recordLinkIndexBaseId = "";
    this.backlinkIndex = null;
  }

  private referencedPaths(data = this.data, baseId = this.store.activeBaseId): Set<string> {
    const cached = this.referencedPathsCacheByBase.get(baseId);
    if (cached) return cached;
    const paths = new Set([...data.manualIndexPaths, ...data.pinnedPaths, ...data.nextStudyPaths]);
    for (const heading of data.collections) {
      for (const path of heading.subjects) paths.add(path);
      for (const subheading of heading.subheadings) {
        for (const path of subheading.subjects) paths.add(path);
      }
    }
    for (const subject of data.portableIndex.subjects) {
      const path = data.portableIndex.resolvedPathBySubjectId[subject.id];
      // A resolved library identity must stay discoverable even though it is
      // intentionally absent from the topic index. Otherwise a newly created
      // or linked generic note falls back to a false unresolved placeholder.
      if (path) paths.add(path);
    }
    this.referencedPathsCacheByBase.set(baseId, paths);
    return paths;
  }

  private excludedPaths(data = this.data, baseId = this.store.activeBaseId): Set<string> {
    const cached = this.excludedPathsCacheByBase.get(baseId);
    if (cached) return cached;
    const paths = new Set(data.excludedIndexPaths);
    this.excludedPathsCacheByBase.set(baseId, paths);
    return paths;
  }

  private clearInactiveSearchRecordsCache(): void {
    this.inactiveSearchRecordsCache.clear();
    this.inactiveSearchCachedRecordCount = 0;
  }

  private deleteInactiveSearchRecords(baseId: string): void {
    const records = this.inactiveSearchRecordsCache.get(baseId);
    if (!records) return;
    this.inactiveSearchRecordsCache.delete(baseId);
    this.inactiveSearchCachedRecordCount = Math.max(0, this.inactiveSearchCachedRecordCount - records.length);
    if (!this.recordsCacheByBase.has(baseId)) this.recordPathsCacheByBase.delete(baseId);
  }

  private getInactiveSearchRecords(baseId: string): VaultRecord[] | undefined {
    return this.inactiveSearchRecordsCache.get(baseId);
  }

  private retainInactiveSearchRecords(baseId: string, records: VaultRecord[]): void {
    // Every global search visits every base in the same pass, so ordinary LRU
    // admission is pathological: the first miss evicts a later hit and the
    // entire cache churns forever. Keep the already-admitted working set stable;
    // path/configuration invalidation removes only entries that must be rebuilt.
    if (this.inactiveSearchRecordsCache.has(baseId)) return;
    if (records.length > MAX_INACTIVE_SEARCH_CACHED_RECORDS) return;
    if (this.inactiveSearchCachedRecordCount + records.length > MAX_INACTIVE_SEARCH_CACHED_RECORDS) return;
    this.inactiveSearchRecordsCache.set(baseId, records);
    this.inactiveSearchCachedRecordCount += records.length;
    if (!this.recordsCacheByBase.has(baseId)) {
      this.recordPathsCacheByBase.set(baseId, new Set(records.map((record) => record.path)));
    }
  }

  private projectPendingRenamePath(path: string): string {
    let projected = path;
    for (const rename of this.pendingVaultRenames) {
      projected = replacePathPrefix(projected, rename.oldPath, rename.newPath);
    }
    return projected;
  }

  private projectPendingRenamePathMap(source: Record<string, string>): Map<string, string> {
    const projected: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [path, value] of Object.entries(source)) projected[path] = value;
    // Match rewritePluginDataPathPrefix exactly: a renamed source key replaces
    // any stale destination key, irrespective of object insertion order.
    for (const rename of this.pendingVaultRenames) {
      for (const [path, value] of Object.entries(projected)) {
        const next = replacePathPrefix(path, rename.oldPath, rename.newPath);
        if (next === path) continue;
        projected[next] = value;
        delete projected[path];
      }
    }
    return new Map(Object.entries(projected));
  }

  private filesForSearchEntry(
    entry: KnowledgeBaseEntry,
    snapshot: KnowledgeBaseSearchVaultSnapshot,
  ): readonly TFile[] {
    const settings = entry.data.settings;
    const primaryFolder = normalizePath(this.projectPendingRenamePath(settings.primaryFolder)).replace(/^\/+|\/+$/gu, "");
    if (!primaryFolder) return snapshot.files;
    const candidates = new Map<string, TFile>();
    const addPath = (path: string): void => {
      const file = snapshot.filesByPath.get(path);
      if (file) candidates.set(file.path, file);
    };
    const addRoot = (folder: string): void => {
      const clean = normalizePath(folder).replace(/^\/+|\/+$/gu, "");
      if (!clean) return;
      addPath(clean);
      const prefix = `${clean}/`;
      let low = 0;
      let high = snapshot.files.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if ((snapshot.files[middle]?.path ?? "") < prefix) low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < snapshot.files.length; index += 1) {
        const file = snapshot.files[index];
        if (!file?.path.startsWith(prefix)) break;
        candidates.set(file.path, file);
      }
    };

    addRoot(primaryFolder);
    addRoot(this.projectPendingRenamePath(settings.proposalFolder));
    if (settings.workspaceMode === "ent-clinical") {
      for (const root of [PROCEDURE_ROOT, MEDICATION_ROOT, SYNDROME_ROOT, "07 Evidence Updates/"]) addRoot(root);
      for (const file of snapshot.clinicalProposalFiles) candidates.set(file.path, file);
    }
    for (const path of this.referencedPaths(entry.data, entry.id)) addPath(this.projectPendingRenamePath(path));
    for (const path of this.excludedPaths(entry.data, entry.id)) addPath(this.projectPendingRenamePath(path));
    for (const path of Object.keys(entry.data.indexGroupByPath)) addPath(this.projectPendingRenamePath(path));
    return [...candidates.values()];
  }

  private rebuildRecordLinkIndex(records: VaultRecord[]): void {
    this.recordLinkIndex.clear();
    for (const record of records) {
      const basename = record.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
      for (const value of [record.path.replace(/\.md$/i, ""), basename, record.title, ...record.aliases]) {
        const key = normalizeWikiLink(value).toLowerCase();
        if (key && !this.recordLinkIndex.has(key)) this.recordLinkIndex.set(key, record);
      }
    }
  }

  getRecords(): VaultRecord[] {
    const active = this.requireActiveBase();
    const records = this.getRecordsForEntry(active);
    if (this.recordLinkIndexBaseId !== active.id) {
      this.rebuildRecordLinkIndex(records);
      this.recordLinkIndexBaseId = active.id;
    }
    return records;
  }

  async searchKnowledgeBases(
    query: string,
    options: KnowledgeBaseSearchOptions = {},
  ): Promise<KnowledgeBaseSearchResultSet<KnowledgeBaseSearchSource> | null> {
    const requestGeneration = this.searchGeneration;
    const activeBaseId = this.store.activeBaseId;
    const entries = this.getKnowledgeBases()
      .sort((a, b) => Number(b.id === activeBaseId) - Number(a.id === activeBaseId)
        || a.data.settings.workspaceName.localeCompare(b.data.settings.workspaceName));
    const sources: KnowledgeBaseSearchSource[] = entries.map((entry) => ({
      baseId: entry.id,
      baseName: entry.data.settings.workspaceName,
      data: entry.data,
    }));
    const collector = new BoundedKnowledgeBaseSearchCollector(
      sources,
      parseQuery(query),
      options.limit ?? DEFAULT_CROSS_BASE_SEARCH_LIMIT,
    );
    const cancelled = (): boolean => requestGeneration !== this.searchGeneration || Boolean(options.isCancelled?.());
    const yieldEvery = Math.max(1, Math.floor(options.yieldEvery ?? 750));
    const useTimeBudget = options.yieldEvery === undefined;
    const now = (): number => performance.now();
    let sliceStartedAt = now();
    let workSinceYield = 0;
    const checkpoint = async (): Promise<boolean> => {
      workSinceYield += 1;
      if (cancelled()) return false;
      if (workSinceYield < yieldEvery && (!useTimeBudget || now() - sliceStartedAt < 4)) return true;
      workSinceYield = 0;
      await new Promise<void>((resolve) => {
        if (typeof window === "undefined") queueMicrotask(resolve);
        else window.activeWindow.setTimeout(resolve, 0);
      });
      sliceStartedAt = now();
      return !cancelled();
    };
    if (cancelled()) return null;

    const needsVaultSnapshot = entries.some((entry) => {
      return !this.recordsCacheByBase.has(entry.id) && !this.inactiveSearchRecordsCache.has(entry.id);
    });
    let vaultSnapshot = this.knowledgeBaseSearchVaultSnapshot;
    if (needsVaultSnapshot && vaultSnapshot?.generation !== requestGeneration) vaultSnapshot = null;
    if (needsVaultSnapshot && !vaultSnapshot) {
      const files = [...this.app.vault.getMarkdownFiles()]
        .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      const filesByPath = new Map(files.map((file) => [file.path, file]));
      const clinicalProposalFiles: TFile[] = [];
      const frontmatterByPath = new Map<string, Record<string, unknown>>();
      for (const file of files) {
        const frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
        frontmatterByPath.set(file.path, frontmatter);
        if (frontmatter.type === "topic-proposal") clinicalProposalFiles.push(file);
        if (!await checkpoint()) return null;
      }
      if (cancelled()) return null;
      vaultSnapshot = { files, filesByPath, clinicalProposalFiles, frontmatterByPath, generation: requestGeneration };
      this.knowledgeBaseSearchVaultSnapshot = vaultSnapshot;
    }
    const files = vaultSnapshot?.files ?? [];
    const frontmatterByPath = vaultSnapshot?.frontmatterByPath ?? new Map<string, Record<string, unknown>>();

    for (let baseIndex = 0; baseIndex < entries.length; baseIndex += 1) {
      if (cancelled()) return null;
      const entry = entries[baseIndex];
      if (!entry) continue;
      const cached = this.recordsCacheByBase.get(entry.id) ?? this.getInactiveSearchRecords(entry.id);
      const scannedRecords: VaultRecord[] | null = cached ? null : [];
      const entryFiles = cached || !vaultSnapshot ? files : this.filesForSearchEntry(entry, vaultSnapshot);
      const scan: Iterable<VaultRecord | null> = cached ?? this.iterateRecordScanForEntry(entry, entryFiles, frontmatterByPath);
      for (const record of scan) {
        if (record && scannedRecords) scannedRecords.push(record);
        if (record) collector.consider(baseIndex, record);
        if (!await checkpoint()) return null;
      }
      if (scannedRecords && entry.id !== activeBaseId) this.retainInactiveSearchRecords(entry.id, scannedRecords);
    }
    return cancelled() ? null : collector.finish();
  }

  private getRecordsForEntry(entry: KnowledgeBaseEntry): VaultRecord[] {
    const cached = this.recordsCacheByBase.get(entry.id);
    if (cached) return cached;
    return this.buildRecordsForEntry(entry, this.app.vault.getMarkdownFiles());
  }

  private buildRecordsForEntry(
    entry: KnowledgeBaseEntry,
    files: readonly TFile[],
    frontmatterByPath?: ReadonlyMap<string, Record<string, unknown>>,
  ): VaultRecord[] {
    const records: VaultRecord[] = [];
    for (const record of this.iterateRecordScanForEntry(entry, files, frontmatterByPath)) {
      if (record) records.push(record);
    }
    records.sort((a, b) => a.role.localeCompare(b.role)
      || (a.curriculumId || "ZZZ").localeCompare(b.curriculumId || "ZZZ", undefined, { numeric: true })
      || a.title.localeCompare(b.title));
    this.recordsCacheByBase.set(entry.id, records);
    this.recordPathsCacheByBase.set(entry.id, new Set(records.map((record) => record.path)));
    return records;
  }

  private *iterateRecordScanForEntry(
    entry: KnowledgeBaseEntry,
    files: readonly TFile[],
    frontmatterByPath?: ReadonlyMap<string, Record<string, unknown>>,
  ): Generator<VaultRecord | null> {
    const data = entry.data;
    const clinicalMode = data.settings.workspaceMode === "ent-clinical";
    const canMoveAcrossGroups = !clinicalMode || data.settings.allowClinicalVisualGroupMoves;
    const referenced = new Set([...this.referencedPaths(data, entry.id)].map((path) => this.projectPendingRenamePath(path)));
    const proposalFolder = normalizePath(this.projectPendingRenamePath(data.settings.proposalFolder));
    const proposalRoot = proposalFolder ? `${proposalFolder}/` : "";
    const settings = data.settings;
    const primaryFolder = this.projectPendingRenamePath(settings.primaryFolder);
    // Membership lookups run once per markdown file, so they must not be linear
    // scans of the manual/hidden arrays.
    const manual = new Set(data.manualIndexPaths.map((path) => this.projectPendingRenamePath(path)));
    const excluded = new Set([...this.excludedPaths(data, entry.id)].map((path) => this.projectPendingRenamePath(path)));
    const projectedIndexGroupByPath = this.projectPendingRenamePathMap(data.indexGroupByPath);
    const projectedDisplayNameByPath = this.projectPendingRenamePathMap(data.displayNameByPath);
    const recordPaths = new Set<string>();
    const portableIdByPath = new Map<string, string>();
    const portableSubjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
    const portableGroupById = new Map(data.portableIndex.groups.map((group) => [group.id, group]));
    const relinkableSubjectIds = new Set(data.portableIndex.relinkableSubjectIds ?? []);
    // Projecting a library can touch thousands of records. Resolve every
    // subject's outer heading once instead of scanning the complete nested
    // layout for each record (which made large catalogs quadratic).
    const portableLibraryHeadingBySubject = new Map<string, string>();
    const libraries = data.portableIndex.libraries ?? [];
    const libraryById = new Map(libraries.map((library) => [library.id, library]));
    const libraryHeadingKey = (libraryId: string, subjectId: string): string => `${libraryId}\0${subjectId}`;
    for (const library of libraries) {
      for (const heading of data.portableIndex.libraryLayouts?.[library.id] ?? []) {
        for (const subjectId of heading.subjects) {
          const key = libraryHeadingKey(library.id, subjectId);
          if (!portableLibraryHeadingBySubject.has(key)) portableLibraryHeadingBySubject.set(key, heading.title);
        }
        for (const subheading of heading.subheadings) {
          for (const subjectId of subheading.subjects) {
            const key = libraryHeadingKey(library.id, subjectId);
            if (!portableLibraryHeadingBySubject.has(key)) portableLibraryHeadingBySubject.set(key, heading.title);
          }
        }
      }
    }
    for (const [subjectId, path] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
      const projectedPath = this.projectPendingRenamePath(path);
      if (projectedPath && !portableIdByPath.has(projectedPath)) portableIdByPath.set(projectedPath, subjectId);
    }
    for (const file of files) {
      let frontmatter = frontmatterByPath?.get(file.path) ?? {};
      if (!frontmatterByPath && clinicalMode) frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
      const identity = this.identityForFile(
        file,
        frontmatter,
        data,
        clinicalMode,
        referenced,
        proposalRoot,
        manual,
        excluded,
        primaryFolder,
      );
      if (!identity) {
        yield null;
        continue;
      }
      if (!frontmatterByPath && !clinicalMode) frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
      const { kind: detectedKind, role: detectedRole } = identity;
      const portableId = portableIdByPath.get(file.path);
      const portableSubject = portableId ? portableSubjectById.get(portableId) : undefined;
      const portableGroup = portableSubject ? portableGroupById.get(portableSubject.groupId)?.title ?? "" : "";
      // In the ENT preset a native path is the authority for its catalog. A
      // stale or colliding portable identity may organize that native record,
      // but it must never reclassify a clinical topic as a medication (or any
      // other cross-catalog combination). Imported topic placeholders backed
      // by proposals remain the one intentional projection exception below.
      const requestedLibraryId = portableSubject && !portableSubject.indexed ? subjectLibraryId(portableSubject) : null;
      const requestedLibrary = requestedLibraryId ? libraryById.get(requestedLibraryId) : undefined;
      // A custom library is visual-only and may contain any semantic type. A
      // protected system library must still match the native clinical type.
      const portableLibrary = requestedLibrary
        && (!clinicalMode || requestedLibrary.sourceKind === null || requestedLibrary.sourceKind === detectedKind)
        ? requestedLibrary
        : undefined;
      const nativeLibrary = clinicalMode && detectedRole === "library"
        ? libraries.find((library) => library.sourceKind === detectedKind)
        : undefined;
      // Native clinical Library sources stay in their protected catalog even
      // when stale data claims they are indexed. A valid custom Library can
      // still provide a visual placement without changing source semantics.
      const effectiveLibrary = portableLibrary ?? nativeLibrary;
      const portableLibraryId = effectiveLibrary?.id ?? null;
      const portableLibraryHeading = portableId && portableLibraryId
        ? portableLibraryHeadingBySubject.get(libraryHeadingKey(portableLibraryId, portableId)) ?? ""
        : "";
      const portableLibraryInGeneric = !clinicalMode && portableLibraryId !== null;
      const role = portableLibraryInGeneric ? "library" : detectedRole;
      const entDomains = asStringList(frontmatter.ent_domains);
      const titleFallback = file.basename.replace(/^(Procedure|Drug|Syndrome)\s*-\s*/i, "");
      const configuredGroup = asStringList(frontmatter[settings.groupProperty])[0] ?? "";
      const visualGroup = canMoveAcrossGroups ? asText(projectedIndexGroupByPath.get(file.path)) : "";
      const configuredIdValue = frontmatter[settings.idProperty];
      const configuredId = typeof configuredIdValue === "number" ? String(configuredIdValue) : asText(configuredIdValue);
      const sourceDomain = detectedRole === "proposal"
        ? asText(frontmatter.proposed_domain, settings.inboxLabel)
        : detectedKind === "topic"
          ? configuredGroup || (clinicalMode ? asText(frontmatter.domain, cleanDomainFolder(file.path)) : configuredGroupFromPath(file.path, primaryFolder))
          : detectedKind === "procedure"
            ? asText(frontmatter.domain, "Procedures")
            : detectedKind === "medication"
              ? entDomains[0] || "Medications"
              : detectedKind === "syndrome"
                ? entDomains[0] || asText(frontmatter.syndrome_group, "Syndromes")
                : asText(frontmatter.domain, file.parent?.path || "Vault notes");
      const domain = portableLibraryId
        ? portableLibraryHeading || portableGroup || sourceDomain
        : detectedKind === "topic"
          ? visualGroup || asText(data.indexGroupAliases[sourceDomain], sourceDomain)
          : sourceDomain;
      // A clinical proposal can safely back an imported index subject while it
      // awaits promotion. Project that one record into both the Inbox (by role)
      // and the index (by kind/portableIndexed) without changing the Markdown.
      const proposalBacksIndexedSubject = detectedKind === "proposal"
        && portableSubject?.recordKind === "topic"
        && portableSubject.indexed;
      const sourceIndexEligible = detectedKind === "topic" || proposalBacksIndexedSubject;
      const portableMembershipApplies = Boolean(portableSubject && (
        portableSubject.indexed
          ? !clinicalMode || sourceIndexEligible
          : portableLibrary
            || requestedLibraryId === null && (!clinicalMode
              || portableSubject.recordKind === detectedKind
              || (portableSubject.recordKind === "topic" && detectedKind === "proposal"))
      ));
      const projectedPortableIndexed = portableSubject
        ? portableMembershipApplies
          ? Boolean(portableSubject.indexed && !portableLibraryId)
          : portableSubject.indexed ? false : undefined
        : clinicalMode && detectedKind === "topic" && excluded.has(file.path) ? false : undefined;
      const kind: RecordKind = proposalBacksIndexedSubject
        ? "topic"
        : clinicalMode ? detectedKind : portableSubject?.recordKind ?? detectedKind;
      const sourceTitle = asText(frontmatter.title, asText(frontmatter.canonical_name, titleFallback));
      const displayTitle = asText(projectedDisplayNameByPath.get(file.path));
      const aliases = asStringList(frontmatter.aliases);
      if (displayTitle && sourceTitle && displayTitle !== sourceTitle && !aliases.includes(sourceTitle)) aliases.push(sourceTitle);
      const record: VaultRecord = {
        path: file.path,
        title: displayTitle || sourceTitle,
        ...(displayTitle ? { sourceTitle } : {}),
        kind,
        role,
        curriculumId: configuredId || (clinicalMode ? asText(frontmatter.curriculum_id) : ""),
        domain,
        topicKind: asText(frontmatter.topic_kind, asText(frontmatter.type, asText(frontmatter.approach, role === "vault-note" ? "note" : kind))),
        priority: asText(frontmatter.priority),
        reviewStatus: asText(frontmatter.review_status),
        synthesisStatus: asText(frontmatter.synthesis_status, asText(frontmatter.procedure_status)),
        autoresearchStatus: asText(frontmatter.autoresearch_status),
        safetyCritical: frontmatter.safety_critical === true,
        sourceCount: Array.isArray(frontmatter.sources) ? frontmatter.sources.length : 0,
        aliases,
        relatedTopics: asStringList(frontmatter.related_topics),
        parentTopic: role === "proposal"
          ? (clinicalMode ? asText(frontmatter.proposed_parent) : asText(frontmatter[settings.parentProperty]))
          : asText(frontmatter[settings.parentProperty], clinicalMode ? asText(frontmatter.parent_topic) : ""),
        imageStatus: asText(frontmatter.image_status),
        doseStatus: asText(frontmatter.dose_status),
        sourceCoverage: asText(frontmatter.source_coverage),
        folderOrder: kind === "topic" ? this.indexGroupSortKey(data, domain, file.path, primaryFolder) : role === "proposal" ? "00" : "99",
        mtime: file.stat.mtime,
        aiLock: frontmatter.ai_lock === true,
        ...(portableId ? { portableId } : {}),
        ...(portableLibraryId ? { libraryId: portableLibraryId } : {}),
        ...(projectedPortableIndexed !== undefined ? { portableIndexed: projectedPortableIndexed } : {}),
        ...(portableId && relinkableSubjectIds.has(portableId) ? { portableRelinkable: true } : {}),
      };
      recordPaths.add(record.path);
      yield record;
    }
    for (const subject of data.portableIndex.subjects) {
      const resolvedPath = this.projectPendingRenamePath(data.portableIndex.resolvedPathBySubjectId[subject.id] || "");
      if (resolvedPath && recordPaths.has(resolvedPath)) {
        yield null;
        continue;
      }
      const path = resolvedPath || portablePlaceholderPath(subject.id);
      if (recordPaths.has(path)) {
        yield null;
        continue;
      }
      const sourceGroup = portableGroupById.get(subject.groupId)?.title || "Ungrouped";
      const invalidClinicalIndexPlaceholder = clinicalMode && subject.indexed && subject.recordKind !== "topic";
      const libraryId = invalidClinicalIndexPlaceholder && isLibraryKind(subject.recordKind)
        ? BUILTIN_LIBRARY_IDS[subject.recordKind]
        : subject.indexed ? null : subjectLibraryId(subject);
      const libraryHeading = libraryId
        ? portableLibraryHeadingBySubject.get(libraryHeadingKey(libraryId, subject.id)) ?? ""
        : "";
      const domain = libraryHeading || (canMoveAcrossGroups ? asText(projectedIndexGroupByPath.get(path)) : "")
        || asText(data.indexGroupAliases[sourceGroup], sourceGroup);
      const displayTitle = asText(projectedDisplayNameByPath.get(path));
      const record: VaultRecord = {
        path,
        title: displayTitle || subject.title,
        ...(displayTitle ? { sourceTitle: subject.title } : {}),
        kind: subject.recordKind,
        role: "placeholder",
        curriculumId: subject.configuredId,
        domain,
        topicKind: subject.recordKind,
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
        folderOrder: this.indexGroupSortKey(data, domain, path, primaryFolder),
        mtime: 0,
        aiLock: false,
        portableId: subject.id,
        ...(libraryId ? { libraryId } : {}),
        isPlaceholder: true,
        portableIndexed: invalidClinicalIndexPlaceholder ? false : subject.indexed,
      };
      recordPaths.add(path);
      yield record;
    }
  }

  private identityForFile(
    file: TFile,
    frontmatter: Record<string, unknown>,
    data: PluginData,
    clinicalMode: boolean,
    referenced: Set<string>,
    proposalRoot: string,
    manual: Set<string>,
    excluded: Set<string>,
    primaryFolder = data.settings.primaryFolder,
  ): { kind: RecordKind; role: RecordRole } | null {
    if (!clinicalMode && manual.has(file.path)) return { kind: "topic", role: "canonical" };
    if ((proposalRoot && file.path.startsWith(proposalRoot)) || (clinicalMode && frontmatter.type === "topic-proposal")) return { kind: "proposal", role: "proposal" };
    if (pathIsInsideFolder(file.path, primaryFolder)) {
      if (!clinicalMode && excluded.has(file.path)) {
        return referenced.has(file.path) ? { kind: "note", role: "vault-note" } : null;
      }
      if (!clinicalMode) return { kind: "topic", role: "canonical" };
      // An explicitly hidden native topic should disappear from this base's
      // record/search catalog unless another plugin feature still references
      // it (collection, pin, queue, or portable custom-Library identity).
      // Referenced records keep their source-derived topic semantics below.
      if (excluded.has(file.path) && !referenced.has(file.path)) return null;
      // Hidden membership and custom-Library placement are plugin state, not
      // source semantics. Keep the native ENT kind/role stable and let the
      // projected membership flag decide whether this topic enters the Index.
      return asText(frontmatter[data.settings.idProperty], asText(frontmatter.curriculum_id))
        ? { kind: "topic", role: "canonical" }
        : { kind: "topic", role: "supporting" };
    }
    if (clinicalMode && file.path.startsWith(PROCEDURE_ROOT) && file.basename.startsWith("Procedure - ")) return { kind: "procedure", role: "library" };
    if (clinicalMode && file.path.startsWith(MEDICATION_ROOT) && file.basename.startsWith("Drug - ")) return { kind: "medication", role: "library" };
    if (clinicalMode && file.path.startsWith(SYNDROME_ROOT) && file.basename.startsWith("Syndrome - ")) return { kind: "syndrome", role: "library" };
    return referenced.has(file.path) ? { kind: "note", role: "vault-note" } : null;
  }

  private removePortableSubjectsFromLibraryLayouts(subjectIds: ReadonlySet<string>): void {
    if (subjectIds.size === 0) return;
    for (const layout of Object.values(this.data.portableIndex.libraryLayouts ?? {})) {
      for (const heading of layout) {
        heading.subjects = heading.subjects.filter((candidate) => !subjectIds.has(candidate));
        for (const subheading of heading.subheadings) {
          subheading.subjects = subheading.subjects.filter((candidate) => !subjectIds.has(candidate));
        }
      }
    }
  }

  private removePortableSubjectFromLibraryLayouts(subjectId: string): void {
    this.removePortableSubjectsFromLibraryLayouts(new Set([subjectId]));
  }

  private replacePortableSubjectInLibraryLayouts(oldSubjectId: string, subjectId: string): void {
    if (oldSubjectId === subjectId) return;
    const subject = this.getPortableSubject(subjectId);
    const targetLibraryId = subject ? subjectLibraryId(subject) : null;
    const targetAlreadyContainsSurvivor = targetLibraryId !== null
      && (this.data.portableIndex.libraryLayouts?.[targetLibraryId] ?? []).some((heading) => (
        heading.subjects.includes(subjectId)
        || heading.subheadings.some((subheading) => subheading.subjects.includes(subjectId))
      ));
    for (const [libraryId, layout] of Object.entries(this.data.portableIndex.libraryLayouts ?? {})) {
      let survivorPlaced = false;
      for (const heading of layout) {
        const replace = (subjects: string[]): string[] => {
          const next: string[] = [];
          for (const candidate of subjects) {
            if (libraryId !== targetLibraryId) {
              if (candidate !== oldSubjectId && candidate !== subjectId) next.push(candidate);
              continue;
            }
            if (targetAlreadyContainsSurvivor && candidate === oldSubjectId) continue;
            if (candidate !== oldSubjectId && candidate !== subjectId) {
              next.push(candidate);
              continue;
            }
            if (survivorPlaced) continue;
            survivorPlaced = true;
            next.push(subjectId);
          }
          return next;
        };
        heading.subjects = replace(heading.subjects);
        for (const subheading of heading.subheadings) subheading.subjects = replace(subheading.subjects);
      }
    }
  }

  getRecord(path: string): VaultRecord | null { return this.getRecords().find((record) => record.path === path) ?? null; }
  getPortableSubject(subjectId: string) { return this.data.portableIndex.subjects.find((subject) => subject.id === subjectId) ?? null; }
  getPortableSubjectPath(subjectId: string): string { return portableSubjectPath(this.data, subjectId); }

  private cleanQuickEntryLabel(value: string, label: string): string {
    const clean = value.normalize("NFC").trim();
    if (!clean) throw new Error(`Enter a ${label}.`);
    if (clean.length > 1_000) throw new Error(`Keep the ${label} to 1,000 characters or fewer.`);
    if (/[\p{Cc}\p{Cf}]/u.test(clean) || /[\u202A-\u202E\u2066-\u2069]/u.test(clean)) {
      throw new Error(`The ${label} contains an unsupported control character.`);
    }
    return clean;
  }

  /** Create a stable, possibly empty visual Index group without touching Markdown. */
  async createQuickEntryIndexGroup(title: string): Promise<string> {
    const cleanTitle = this.cleanQuickEntryLabel(title, this.data.settings.groupLabel.toLocaleLowerCase());
    if (this.getIndexGroups().some((candidate) => this.normalizedOrganizationLabel(candidate) === this.normalizedOrganizationLabel(cleanTitle))) {
      throw new Error(`${cleanTitle} already exists.`);
    }
    await this.mutate(`Create visual group “${cleanTitle}”`, () => {
      this.data.indexGroupOrder.push(cleanTitle);
      registerPortableGroup(this.data, cleanTitle);
      this.data.activeTab = "curriculum";
    }, { includePortableIndex: true, includeActiveTab: true, requireUndo: true });
    return cleanTitle;
  }

  /**
   * Create an unresolved portable Index subject. The path is the plugin's
   * established placeholder identity; no vault file is created or fabricated.
   */
  async createQuickEntryPlaceholder(input: QuickEntryPlaceholderInput): Promise<string> {
    const title = this.cleanQuickEntryLabel(input.title, "subject name");
    const requestedGroup = this.cleanQuickEntryLabel(input.group, this.data.settings.groupLabel.toLocaleLowerCase());
    const parent = input.parentPath ? this.getRecord(input.parentPath) : null;
    if (input.parentPath && (!parent || !recordBelongsToIndex(parent, this.isClinicalMode()))) {
      throw new Error("Choose an indexed parent subject that is still available.");
    }
    if (parent && this.normalizedOrganizationLabel(parent.domain) !== this.normalizedOrganizationLabel(requestedGroup)) {
      throw new Error(`A subheading must stay in its parent’s ${this.data.settings.groupLabel.toLocaleLowerCase()} (${parent.domain}).`);
    }
    let subjectId = makeId("subject");
    while (this.getPortableSubject(subjectId)) subjectId = makeId("subject");
    const path = portablePlaceholderPath(subjectId);
    await this.mutate(`Create placeholder subject “${title}”`, () => {
      const group = registerPortableGroup(this.data, requestedGroup);
      if (!this.data.indexGroupOrder.some((candidate) => this.normalizedOrganizationLabel(candidate) === this.normalizedOrganizationLabel(group.title))) {
        this.data.indexGroupOrder.push(group.title);
      }
      const parentSubject = parent?.portableId ? this.getPortableSubject(parent.portableId) : null;
      this.data.portableIndex.subjects.push({
        id: subjectId,
        title,
        groupId: group.id,
        parentId: parentSubject?.id ?? null,
        order: this.data.portableIndex.subjects.length,
        indexed: true,
        configuredId: "",
        recordKind: "topic",
        libraryId: null,
      });
      const parentPath = parent?.path ?? null;
      this.data.curriculumVisual.parentByPath[path] = parentPath;
      const container = curriculumContainerKey(group.title, parentPath);
      const siblings = (this.data.curriculumVisual.orderByContainer[container] ?? []).filter((candidate) => candidate !== path);
      this.data.curriculumVisual.orderByContainer[container] = [...siblings, path];
      this.data.activeTab = "curriculum";
      this.data.selectedPath = path;
    }, { includePortableIndex: true, includeActiveTab: true, requireUndo: true });
    return path;
  }

  async createQuickEntryCollectionHeading(title: string): Promise<string> {
    const cleanTitle = this.cleanQuickEntryLabel(title, "collection heading");
    let id = makeId("collection");
    while (this.data.collections.some((heading) => heading.id === id)) id = makeId("collection");
    await this.mutate(`Create collection “${cleanTitle}”`, () => {
      this.data.collections.push({ id, title: cleanTitle, collapsed: false, subjects: [], subheadings: [] });
      this.data.activeTab = "collections";
    }, { includeActiveTab: true, requireUndo: true });
    return id;
  }

  async createQuickEntryCollectionSubheading(headingId: string, title: string): Promise<string> {
    const cleanTitle = this.cleanQuickEntryLabel(title, "collection subheading");
    let id = makeId("subheading");
    while (this.data.collections.some((heading) => heading.subheadings.some((subheading) => subheading.id === id))) {
      id = makeId("subheading");
    }
    await this.mutate(`Create collection subheading “${cleanTitle}”`, () => {
      const heading = this.data.collections.find((candidate) => candidate.id === headingId);
      if (!heading) throw new Error("That collection heading is no longer available.");
      heading.subheadings.push({ id, title: cleanTitle, collapsed: false, subjects: [] });
      heading.collapsed = false;
      this.data.activeTab = "collections";
    }, { includeActiveTab: true, requireUndo: true });
    return id;
  }

  async createQuickEntryLibraryHeading(libraryId: string, title: string): Promise<string> {
    const library = this.requireLibrary(libraryId, false);
    const cleanTitle = this.cleanQuickEntryLabel(title, `${library.singularName.toLocaleLowerCase()} heading`);
    const layout = this.data.portableIndex.libraryLayouts[libraryId] ??= [];
    let id = makeId(`library-${libraryId}`);
    while (layout.some((heading) => heading.id === id)) id = makeId(`library-${libraryId}`);
    await this.mutate(`Create ${library.singularName.toLocaleLowerCase()} heading “${cleanTitle}”`, () => {
      this.requireLibrary(libraryId, false);
      (this.data.portableIndex.libraryLayouts[libraryId] ??= []).push({
        id,
        title: cleanTitle,
        collapsed: false,
        subjects: [],
        subheadings: [],
      });
      this.data.activeTab = libraryTabId(libraryId);
    }, { includePortableIndex: true, includeActiveTab: true, requireUndo: true });
    return id;
  }

  async createQuickEntryLibrarySubheading(libraryId: string, headingId: string, title: string): Promise<string> {
    const library = this.requireLibrary(libraryId, false);
    const cleanTitle = this.cleanQuickEntryLabel(title, "library subheading");
    const layout = this.data.portableIndex.libraryLayouts[libraryId] ??= [];
    let id = makeId(`library-${libraryId}-subheading`);
    while (layout.some((heading) => heading.subheadings.some((subheading) => subheading.id === id))) {
      id = makeId(`library-${libraryId}-subheading`);
    }
    await this.mutate(`Create ${library.singularName.toLocaleLowerCase()} subheading “${cleanTitle}”`, () => {
      this.requireLibrary(libraryId, false);
      const heading = (this.data.portableIndex.libraryLayouts[libraryId] ?? []).find((candidate) => candidate.id === headingId);
      if (!heading) throw new Error("That library heading is no longer available.");
      heading.subheadings.push({ id, title: cleanTitle, collapsed: false, subjects: [] });
      heading.collapsed = false;
      this.data.activeTab = libraryTabId(libraryId);
    }, { includePortableIndex: true, includeActiveTab: true, requireUndo: true });
    return id;
  }

  async renameRecordDisplay(path: string, title: string): Promise<void> {
    const record = this.getRecord(path);
    if (!record) throw new Error("That subject is no longer available.");
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error("Enter a display name.");
    const renamePortablePlaceholder = Boolean(record.isPlaceholder && record.portableId);
    await this.mutate(`Rename display label for “${record.title}”`, () => {
      if (renamePortablePlaceholder && record.portableId) {
        const subject = this.getPortableSubject(record.portableId);
        if (!subject) throw new Error("That imported subject is no longer available.");
        subject.title = cleanTitle;
        delete this.data.displayNameByPath[path];
      } else {
        this.data.displayNameByPath[path] = cleanTitle;
      }
      this.data.selectedPath = path;
      this.invalidateRecordCache();
    }, { includePortableIndex: renamePortablePlaceholder });
  }

  async resetRecordDisplay(path: string): Promise<void> {
    const record = this.getRecord(path);
    if (!record || !this.data.displayNameByPath[path]) return;
    const sourceTitle = record.sourceTitle || record.title;
    await this.mutate(`Reset display label for “${record.title}”`, () => {
      delete this.data.displayNameByPath[path];
      this.invalidateRecordCache();
    });
    new Notice(`Restored the source label “${sourceTitle}”. The Markdown note was not changed.`);
  }

  private defaultLibraryHeadingTitle(libraryId: string): string {
    return this.requireLibrary(libraryId).name;
  }

  private ensureLibraryHeading(libraryId: string, target: CatalogPlacementTarget): LayoutHeading {
    const library = this.requireLibrary(libraryId, false);
    this.data.portableIndex.libraryLayouts[libraryId] ??= [];
    const layout = this.data.portableIndex.libraryLayouts[libraryId];
    let heading = target.headingId
      ? layout.find((candidate) => candidate.id === target.headingId)
      : undefined;
    if (target.headingId && !heading) throw new Error("That library heading is no longer available.");
    if (!heading && target.subheadingId) {
      heading = layout.find((candidate) => candidate.subheadings.some((subheading) => subheading.id === target.subheadingId));
      if (!heading) throw new Error("That library subheading is no longer available.");
    }
    const requestedTitle = target.headingTitle?.trim() || library.name;
    if (!heading) {
      const normalizedTitle = this.normalizedOrganizationLabel(requestedTitle);
      heading = layout.find((candidate) => this.normalizedOrganizationLabel(candidate.title) === normalizedTitle);
    }
    if (!heading) {
      let id = makeId(`${libraryId}-heading`);
      while (layout.some((candidate) => candidate.id === id)) id = makeId(`${libraryId}-heading`);
      heading = { id, title: requestedTitle, collapsed: false, subjects: [], subheadings: [] };
      layout.push(heading);
    }
    if (target.subheadingId && !heading.subheadings.some((subheading) => subheading.id === target.subheadingId)) {
      throw new Error("That library subheading does not belong to the selected heading.");
    }
    return heading;
  }

  private ensureCatalogPortableGroup(libraryId: string, title: string): string {
    const library = this.requireLibrary(libraryId);
    const normalized = this.normalizedOrganizationLabel(title);
    const otherKindGroupIds = new Set(this.data.portableIndex.subjects
      .filter((subject) => subjectLibraryId(subject) !== libraryId)
      .map((subject) => subject.groupId));
    const targetKindGroupIds = new Set(this.data.portableIndex.subjects
      .filter((subject) => subjectLibraryId(subject) === libraryId)
      .map((subject) => subject.groupId));
    const existing = this.data.portableIndex.groups.find((group) => targetKindGroupIds.has(group.id)
      && !otherKindGroupIds.has(group.id)
      && this.normalizedOrganizationLabel(group.title) === normalized);
    if (existing) return existing.id;
    let id = makeId(`${libraryId}-group`);
    while (this.data.portableIndex.groups.some((group) => group.id === id)) id = makeId(`${libraryId}-group`);
    this.data.portableIndex.groups.push({
      id,
      title: title.trim() || library.name,
      order: this.data.portableIndex.groups.length,
    });
    return id;
  }

  private ensureTopicPortableGroup(title: string): string {
    const cleanTitle = title.trim() || "Ungrouped";
    const nonTopicGroupIds = new Set(this.data.portableIndex.subjects
      .filter((subject) => !subject.indexed)
      .map((subject) => subject.groupId));
    const normalizedTitle = this.normalizedOrganizationLabel(cleanTitle);
    const existing = this.data.portableIndex.groups.find((group) => !nonTopicGroupIds.has(group.id)
      && this.normalizedOrganizationLabel(group.title) === normalizedTitle);
    if (existing) return existing.id;
    let id = makeId("group");
    while (this.data.portableIndex.groups.some((group) => group.id === id)) id = makeId("group");
    this.data.portableIndex.groups.push({ id, title: cleanTitle, order: this.data.portableIndex.groups.length });
    return id;
  }

  private placePortableSubjectInLibrary(subjectId: string, libraryId: string, target: CatalogPlacementTarget): LayoutHeading {
    this.removePortableSubjectFromLibraryLayouts(subjectId);
    const heading = this.ensureLibraryHeading(libraryId, target);
    const subheading = target.subheadingId
      ? heading.subheadings.find((candidate) => candidate.id === target.subheadingId)
      : undefined;
    if (target.subheadingId && !subheading) throw new Error("That library subheading is no longer available.");
    (subheading?.subjects ?? heading.subjects).push(subjectId);
    return heading;
  }

  private detachPortableTopicChildren(subjectId: string, path: string): void {
    for (const candidate of this.data.portableIndex.subjects) {
      if (candidate.parentId !== subjectId) continue;
      candidate.parentId = null;
      this.data.curriculumVisual.parentByPath[portableSubjectPath(this.data, candidate.id)] = null;
    }
    for (const [childPath, parentPath] of Object.entries(this.data.curriculumVisual.parentByPath)) {
      if (parentPath === path) this.data.curriculumVisual.parentByPath[childPath] = null;
    }
    delete this.data.curriculumVisual.orderByContainer[`parent:${path}`];
  }

  /**
   * Assign one Markdown note or unresolved portable subject to the topic index
   * or a visual library catalog. This changes plugin data only; source Markdown
   * paths, frontmatter, content, aliases, collections, pins, and Next remain intact.
   */
  async assignRecordToCatalog(
    path: string,
    kind: "topic" | LibraryKind,
    target: CatalogPlacementTarget = {},
  ): Promise<void> {
    return kind === "topic"
      ? this.assignRecordToDestination(path, null, target)
      : this.assignRecordToDestination(path, kind, target, kind);
  }

  async assignRecordToLibrary(
    path: string,
    libraryId: string,
    target: CatalogPlacementTarget = {},
  ): Promise<void> {
    return this.assignRecordToDestination(path, libraryId, target);
  }

  private async assignRecordToDestination(
    path: string,
    libraryId: string | null,
    target: CatalogPlacementTarget,
    legacyBuiltinKind: LibraryKind | null = null,
  ): Promise<void> {
    this.assertDataWritable();
    const existingDestination = libraryId ? this.getLibrary(libraryId) : null;
    const pendingBuiltin = libraryId && !existingDestination && legacyBuiltinKind === libraryId
      ? BUILTIN_LIBRARY_DEFINITIONS.find((library) => library.id === libraryId) ?? null
      : null;
    const destinationLibrary = existingDestination ?? pendingBuiltin;
    if (libraryId && !destinationLibrary) throw new Error("That library is no longer available.");
    if (destinationLibrary && destinationLibrary.archivedAt !== null) {
      throw new Error("That library is archived. Restore it before adding records.");
    }
    if (pendingBuiltin && (this.data.portableIndex.libraries ?? []).length >= MAX_LIBRARIES) {
      throw new Error(`A knowledge base can contain at most ${MAX_LIBRARIES} libraries.`);
    }
    const placeholderId = portableSubjectIdFromPath(path);
    const file = placeholderId ? null : this.app.vault.getAbstractFileByPath(path);
    if (!placeholderId && (!(file instanceof TFile) || file.extension.toLowerCase() !== "md")) {
      throw new Error("Choose an existing Markdown note or portable placeholder.");
    }
    if (file instanceof TFile && isImmutableSourcePath(file.path)) {
      throw new Error("Immutable source-book files cannot be assigned to a knowledge catalog.");
    }
    if (!destinationLibrary) {
      const indexDestinationError = this.getRecordIndexDestinationError(path);
      if (indexDestinationError) throw new Error(indexDestinationError);
    }
    const owners = placeholderId
      ? [placeholderId]
      : Object.entries(this.data.portableIndex.resolvedPathBySubjectId)
        .filter(([, resolvedPath]) => resolvedPath === path)
        .map(([subjectId]) => subjectId);
    if (owners.length > 1) throw new Error("That Markdown note has more than one portable identity. Repair the duplicate path owner before moving it.");
    const existingSubjectId = owners[0] ?? "";
    const existingSubject = existingSubjectId ? this.getPortableSubject(existingSubjectId) : null;
    if (placeholderId && !existingSubject) throw new Error("That portable subject is no longer available.");

    const record = this.getRecord(path);
    const frontmatter = file instanceof TFile
      ? asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter)
      : {};
    let detectedKind: RecordKind = existingSubject?.recordKind ?? record?.kind ?? "note";
    if (this.isClinicalMode()) {
      detectedKind = this.clinicalIndexClassification(
        path,
        existingSubject,
        detectedKind,
      ).kind;
    }
    if (this.isClinicalMode() && destinationLibrary?.sourceKind && detectedKind !== destinationLibrary.sourceKind) {
      throw new Error(`Clinical source classification is fixed: this ${detectedKind} record cannot be placed in the built-in ${destinationLibrary.name} library.`);
    }

    const sourceTitle = existingSubject?.title
      || record?.title
      || asText(frontmatter.title, asText(frontmatter.canonical_name, file instanceof TFile ? file.basename : "Untitled subject"));
    const configuredId = existingSubject?.configuredId
      || record?.curriculumId
      || asText(frontmatter[this.data.settings.idProperty]);
    const newSubjectId = existingSubjectId || makeId("subject");
    const wasIndexed = existingSubject?.indexed === true
      || Boolean(record && recordBelongsToIndex(record, this.isClinicalMode()));
    const topicGroupTitle = target.headingTitle?.trim()
      || (file instanceof TFile ? this.suggestedIndexGroup(file) : "Ungrouped");
    const destinationLabel = destinationLibrary?.name ?? "the knowledge index";

    await this.mutate(`Move “${sourceTitle}” to ${destinationLabel}`, () => {
      if (pendingBuiltin && !this.getLibrary(pendingBuiltin.id)) {
        if (this.libraryDefinitions().length >= MAX_LIBRARIES) {
          throw new Error(`A knowledge base can contain at most ${MAX_LIBRARIES} libraries.`);
        }
        const order = this.libraryDefinitions().reduce((maximum, library) => Math.max(maximum, library.order), -1) + 1;
        this.libraryDefinitions().push({ ...pendingBuiltin, order, archivedAt: null });
        this.data.portableIndex.libraryLayouts[pendingBuiltin.id] ??= [];
      }
      const currentLibrary = libraryId ? this.requireLibrary(libraryId, false) : null;
      let subject = existingSubjectId ? this.getPortableSubject(existingSubjectId) : null;
      if (!subject) {
        const initialGroupId = !currentLibrary
          ? this.ensureTopicPortableGroup(topicGroupTitle)
          : this.ensureCatalogPortableGroup(currentLibrary.id, target.headingTitle?.trim() || currentLibrary.name);
        const semanticKind: RecordKind = currentLibrary?.sourceKind
          ? currentLibrary.sourceKind
          : detectedKind === "note" && !currentLibrary ? "topic" : detectedKind;
        subject = {
          id: newSubjectId,
          title: sourceTitle,
          groupId: initialGroupId,
          parentId: null,
          order: this.data.portableIndex.subjects.length,
          indexed: !currentLibrary,
          configuredId,
          recordKind: semanticKind,
          libraryId: currentLibrary?.id ?? null,
        };
        this.data.portableIndex.subjects.push(subject);
        if (file instanceof TFile) this.data.portableIndex.resolvedPathBySubjectId[subject.id] = file.path;
      }

      if (!currentLibrary) {
        this.removePortableSubjectFromLibraryLayouts(subject.id);
        subject.indexed = true;
        subject.libraryId = null;
        subject.parentId = null;
        subject.groupId = this.ensureTopicPortableGroup(topicGroupTitle);
        this.data.excludedIndexPaths = this.data.excludedIndexPaths.filter((candidate) => candidate !== path);
        if (!pathIsInsideFolder(path, this.data.settings.primaryFolder) && !this.data.manualIndexPaths.includes(path)) {
          this.data.manualIndexPaths.push(path);
        }
        this.data.indexGroupByPath[path] = topicGroupTitle;
        resetCurriculumVisualPath(this.data.curriculumVisual, path);
      } else {
        if (wasIndexed) this.detachPortableTopicChildren(subject.id, path);
        const heading = this.placePortableSubjectInLibrary(subject.id, currentLibrary.id, target);
        const catalogGroupId = this.ensureCatalogPortableGroup(currentLibrary.id, heading.title);
        // System libraries retain their clinical semantics. Custom libraries
        // are visual containers and never rewrite a subject's semantic type.
        if (!this.isClinicalMode() && currentLibrary.sourceKind) subject.recordKind = currentLibrary.sourceKind;
        subject.indexed = false;
        subject.libraryId = currentLibrary.id;
        subject.parentId = null;
        subject.groupId = catalogGroupId;
        this.data.manualIndexPaths = this.data.manualIndexPaths.filter((candidate) => candidate !== path);
        if (pathIsInsideFolder(path, this.data.settings.primaryFolder)
          && !this.data.excludedIndexPaths.includes(path)) this.data.excludedIndexPaths.push(path);
        delete this.data.indexGroupByPath[path];
        resetCurriculumVisualPath(this.data.curriculumVisual, path);
      }
      this.data.selectedPath = path;
      this.data.activeTab = currentLibrary ? libraryTabId(currentLibrary.id) : "curriculum";
      this.dedupeActiveOrganizationPaths();
    }, { includePortableIndex: true, requireUndo: true });
  }

  async removeRecordFromCatalog(path: string): Promise<void> {
    return this.removeRecordFromLibrary(path);
  }

  async removeRecordFromLibrary(path: string): Promise<void> {
    const record = this.getRecord(path);
    if (!record?.portableId || !record.libraryId) throw new Error("That record has no editable library placement.");
    await this.mutate(`Remove visual library placement for “${record.title}”`, () => {
      const subject = this.getPortableSubject(record.portableId ?? "");
      if (!subject) throw new Error("That portable subject is no longer available.");
      this.removePortableSubjectFromLibraryLayouts(subject.id);
      subject.libraryId = null;
      subject.indexed = false;
      subject.parentId = null;
      this.data.manualIndexPaths = this.data.manualIndexPaths.filter((candidate) => candidate !== path);
      if (pathIsInsideFolder(path, this.data.settings.primaryFolder)
        && !this.data.excludedIndexPaths.includes(path)) this.data.excludedIndexPaths.push(path);
      delete this.data.indexGroupByPath[path];
      resetCurriculumVisualPath(this.data.curriculumVisual, path);
      this.data.selectedPath = path;
    }, { includePortableIndex: true, requireUndo: true });
  }

  /** Adopt an existing flat/native library into its editable path-free layout in one Undo-safe save. */
  async initializeLibraryCatalog(libraryId: string): Promise<void> {
    this.assertDataWritable();
    const library = this.requireLibrary(libraryId, false);
    const records = this.getRecords().filter((record) => record.libraryId === libraryId);
    const ownerIdsByPath = new Map<string, string[]>();
    for (const [subjectId, path] of Object.entries(this.data.portableIndex.resolvedPathBySubjectId)) {
      const owners = ownerIdsByPath.get(path) ?? [];
      owners.push(subjectId);
      ownerIdsByPath.set(path, owners);
    }
    for (const record of records) {
      if (!record.isPlaceholder && isImmutableSourcePath(record.path)) {
        throw new Error("Immutable source-book files cannot be assigned to a knowledge catalog.");
      }
      if ((ownerIdsByPath.get(record.path)?.length ?? 0) > 1) {
        throw new Error(`“${record.title}” has more than one portable identity. Repair the duplicate path owner before arranging this library.`);
      }
    }
    const recordsToInitialize = records.filter((record) => {
      const subjectId = record.portableId || portableSubjectIdFromPath(record.path);
      // A portable subject with no layout membership is intentionally unplaced
      // (for example after its heading was deleted). Only native records that
      // have never acquired a portable identity need one-time adoption.
      return !subjectId;
    });
    if (recordsToInitialize.length === 0) return;

    await this.mutate(`Initialize editable ${library.name} headings`, () => {
      const currentLibrary = this.requireLibrary(libraryId, false);
      for (const record of recordsToInitialize) {
        const placeholderId = portableSubjectIdFromPath(record.path);
        const ownerId = record.portableId || placeholderId || ownerIdsByPath.get(record.path)?.[0] || "";
        let subject = ownerId ? this.getPortableSubject(ownerId) : null;
        if (!subject) {
          let id = makeId("subject");
          while (this.getPortableSubject(id)) id = makeId("subject");
          const groupId = this.ensureCatalogPortableGroup(libraryId, record.domain || currentLibrary.name);
          subject = {
            id,
            title: record.title,
            groupId,
            parentId: null,
            order: this.data.portableIndex.subjects.length,
            indexed: false,
            configuredId: record.curriculumId,
            recordKind: currentLibrary.sourceKind ?? record.kind,
            libraryId,
          };
          this.data.portableIndex.subjects.push(subject);
          if (!record.isPlaceholder) this.data.portableIndex.resolvedPathBySubjectId[id] = record.path;
        }
        if (currentLibrary.sourceKind && this.isClinicalMode() && subject.recordKind !== currentLibrary.sourceKind) {
          throw new Error(`“${record.title}” belongs to ${subject.recordKind} and cannot be adopted into the built-in ${currentLibrary.name} library.`);
        }
        subject.indexed = false;
        subject.libraryId = libraryId;
        subject.parentId = null;
        const heading = this.placePortableSubjectInLibrary(subject.id, libraryId, { headingTitle: record.domain || currentLibrary.name });
        subject.groupId = this.ensureCatalogPortableGroup(libraryId, heading.title);
      }
    }, { includePortableIndex: true, requireUndo: true });
  }

  async removeRecordsFromIndex(paths: string[], label = "Remove subjects from this knowledge base"): Promise<void> {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) return;
    await this.mutate(label, () => {
      this.removeRecordsFromIndexState(uniquePaths);
    }, { includePortableIndex: true });
  }

  /** Apply removal inside an existing active-base transaction. */
  removeRecordsFromIndexState(paths: string[]): void {
    const removed = new Set(paths);
    this.data.manualIndexPaths = this.data.manualIndexPaths.filter((candidate) => !removed.has(candidate));
    for (const path of removed) {
      const record = this.getRecord(path);
      if (record?.portableId) {
        const subject = this.getPortableSubject(record.portableId);
        if (subject) subject.indexed = false;
      }
      const requiresHiddenEntry = pathIsInsideFolder(path, this.data.settings.primaryFolder)
        || (this.isClinicalMode() && !isPortablePlaceholderPath(path));
      if (requiresHiddenEntry && !this.data.excludedIndexPaths.includes(path)) {
        this.data.excludedIndexPaths.push(path);
      }
      delete this.data.indexGroupByPath[path];
      resetCurriculumVisualPath(this.data.curriculumVisual, path);
    }
    this.invalidateRecordCache();
  }

  async restoreRecordsToIndex(
    paths: string[],
    label = "Restore subjects to this knowledge base",
    targetGroup = "",
  ): Promise<void> {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) return;
    const incompatible = uniquePaths
      .map((path) => ({ path, error: this.getRecordIndexDestinationError(path) }))
      .filter((item): item is { path: string; error: string } => item.error !== null);
    if (incompatible.length > 0) {
      const first = incompatible[0];
      const more = incompatible.length > 1
        ? ` ${incompatible.length - 1} additional selected subject${incompatible.length === 2 ? " is" : "s are"} also incompatible.`
        : "";
      throw new Error(`${first?.error ?? "The selected subject cannot enter this Index."}${more} No subjects were restored.`);
    }
    const cleanTargetGroup = targetGroup.trim();
    const portableIdByPath = new Map(Object.entries(this.data.portableIndex.resolvedPathBySubjectId).map(([id, path]) => [path, id]));
    await this.mutate(label, () => {
      if (cleanTargetGroup && !this.data.indexGroupOrder.includes(cleanTargetGroup)) {
        this.data.indexGroupOrder.push(cleanTargetGroup);
      }
      for (const path of uniquePaths) {
        const portableId = this.getRecord(path)?.portableId ?? portableIdByPath.get(path);
        if (portableId) {
          const subject = this.getPortableSubject(portableId);
          if (subject) {
            this.removePortableSubjectFromLibraryLayouts(subject.id);
            subject.libraryId = null;
            subject.indexed = true;
            if (cleanTargetGroup) subject.groupId = this.ensureTopicPortableGroup(cleanTargetGroup);
          }
        }
        this.data.excludedIndexPaths = this.data.excludedIndexPaths.filter((candidate) => candidate !== path);
        if (!pathIsInsideFolder(path, this.data.settings.primaryFolder) && !this.data.manualIndexPaths.includes(path)) {
          this.data.manualIndexPaths.push(path);
        }
        if (cleanTargetGroup) this.data.indexGroupByPath[path] = cleanTargetGroup;
        else delete this.data.indexGroupByPath[path];
        resetCurriculumVisualPath(this.data.curriculumVisual, path);
      }
      this.invalidateRecordCache();
    }, { includePortableIndex: true });
  }

  private dedupeActiveOrganizationPaths(): void {
    const unique = (paths: string[]): string[] => [...new Set(paths)];
    for (const heading of this.data.collections) {
      heading.subjects = unique(heading.subjects);
      for (const subheading of heading.subheadings) subheading.subjects = unique(subheading.subjects);
    }
    this.data.pinnedPaths = unique(this.data.pinnedPaths);
    this.data.nextStudyPaths = unique(this.data.nextStudyPaths);
    this.data.manualIndexPaths = unique(this.data.manualIndexPaths);
    this.data.excludedIndexPaths = unique(this.data.excludedIndexPaths);
    for (const [container, paths] of Object.entries(this.data.curriculumVisual.orderByContainer)) {
      this.data.curriculumVisual.orderByContainer[container] = unique(paths);
    }
  }

  async resolvePortableSubject(subjectId: string, path: string, mergeExistingIdentity = false): Promise<void> {
    this.assertDataWritable();
    const subject = this.getPortableSubject(subjectId);
    if (!subject) throw new Error("The portable subject no longer exists.");
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") throw new Error("Choose an existing Markdown note.");
    if (isImmutableSourcePath(file.path)) throw new Error("Immutable source-book files cannot be linked as portable subjects.");
    const existingOwnerId = Object.entries(this.data.portableIndex.resolvedPathBySubjectId)
      .find(([otherId, otherPath]) => otherId !== subjectId && otherPath === file.path)?.[0] ?? "";
    const existingOwner = existingOwnerId ? this.getPortableSubject(existingOwnerId) : null;
    const candidateRecord = this.getRecord(file.path);
    const candidateKind: RecordKind = existingOwner?.recordKind
      ?? candidateRecord?.kind
      ?? (!this.isClinicalMode() && subject.recordKind === "topic" ? "topic" : "note");
    const compatibleKinds = subject.recordKind === candidateKind
      || (subject.recordKind === "topic" && candidateKind === "proposal")
      || (!this.isClinicalMode() && !existingOwner && (candidateKind === "topic" || candidateKind === "note"));
    if (!compatibleKinds) {
      throw new Error(`This ${candidateKind} note cannot be linked to a portable ${subject.recordKind} subject.`);
    }
    const candidateConfiguredId = (existingOwner?.configuredId || candidateRecord?.curriculumId || "").trim();
    if (subject.configuredId.trim() && candidateConfiguredId && subject.configuredId.trim() !== candidateConfiguredId) {
      throw new Error(`Configured ID mismatch: ${subject.configuredId.trim()} cannot be linked to ${candidateConfiguredId}.`);
    }
    const subjectGroupTitle = this.data.portableIndex.groups.find((group) => group.id === subject.groupId)?.title ?? "";
    const candidateDomain = candidateRecord?.domain.trim() ?? "";
    if (this.isClinicalMode() && !this.canVisuallyMoveAcrossGroups() && subjectGroupTitle && candidateDomain
      && this.normalizedOrganizationLabel(subjectGroupTitle) !== this.normalizedOrganizationLabel(candidateDomain)) {
      throw new Error(`Clinical group mismatch: this subject belongs to ${subjectGroupTitle}, but the selected note belongs to ${candidateDomain}.`);
    }
    if (existingOwnerId && !mergeExistingIdentity) {
      throw new Error("That Markdown note already has a portable identity. Confirm identity reassignment before linking it to this subject.");
    }
    const wasUnresolved = !this.data.portableIndex.resolvedPathBySubjectId[subjectId];
    if (existingOwnerId && mergeExistingIdentity) {
      const byId = new Map(this.data.portableIndex.subjects.map((candidate) => [candidate.id, candidate]));
      const isAncestor = (ancestorId: string, descendantId: string): boolean => {
        const visited = new Set<string>();
        let cursor = byId.get(descendantId)?.parentId ?? null;
        while (cursor && !visited.has(cursor)) {
          if (cursor === ancestorId) return true;
          visited.add(cursor);
          cursor = byId.get(cursor)?.parentId ?? null;
        }
        return false;
      };
      if (isAncestor(existingOwnerId, subjectId) || isAncestor(subjectId, existingOwnerId)) {
        throw new Error("A portable subject cannot merge with one of its ancestors or descendants. Move them apart first, then retry.");
      }
      const childrenByParent = new Map<string, typeof this.data.portableIndex.subjects>();
      for (const candidate of this.data.portableIndex.subjects) {
        if (!candidate.parentId) continue;
        const children = childrenByParent.get(candidate.parentId) ?? [];
        children.push(candidate);
        childrenByParent.set(candidate.parentId, children);
      }
      const descendantStack = [...(childrenByParent.get(existingOwnerId) ?? [])];
      const visitedDescendants = new Set<string>();
      let crossGroupDescendant = false;
      while (descendantStack.length > 0) {
        const descendant = descendantStack.pop();
        if (!descendant || visitedDescendants.has(descendant.id)) continue;
        visitedDescendants.add(descendant.id);
        if (descendant.groupId !== subject.groupId) {
          crossGroupDescendant = true;
          break;
        }
        descendantStack.push(...(childrenByParent.get(descendant.id) ?? []));
      }
      if (crossGroupDescendant) {
        throw new Error(`Cannot merge across groups while “${existingOwner?.title ?? file.basename}” has child subjects. Move or detach its children first.`);
      }
    }
    const oldPath = this.data.portableIndex.resolvedPathBySubjectId[subjectId] || portablePlaceholderPath(subjectId);
    const visual = this.data.curriculumVisual;
    const targetHasParentOverride = Object.getOwnPropertyDescriptor(visual.parentByPath, oldPath) !== undefined;
    const targetParentPath = targetHasParentOverride
      ? visual.parentByPath[oldPath] ?? null
      : subject.parentId ? portableSubjectPath(this.data, subject.parentId) : null;
    const targetGroupTitle = this.data.indexGroupByPath[oldPath]
      || this.data.portableIndex.groups.find((group) => group.id === subject.groupId)?.title
      || "Ungrouped";
    const targetContainerKey = curriculumContainerKey(targetGroupTitle, targetParentPath);
    const targetContainerOrder = [...(visual.orderByContainer[targetContainerKey] ?? [])];
    const sortedChildren = (parentId: string): string[] => this.data.portableIndex.subjects
      .filter((candidate) => candidate.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
      .map((candidate) => portableSubjectPath(this.data, candidate.id));
    const targetChildOrder = [
      ...(visual.orderByContainer[`parent:${oldPath}`] ?? []),
      ...sortedChildren(subjectId),
    ];
    const ownerChildOrder = existingOwnerId ? [
      ...(visual.orderByContainer[`parent:${file.path}`] ?? []),
      ...sortedChildren(existingOwnerId),
    ] : [];
    await this.mutate(`Link portable subject “${subject.title}”`, () => {
      rewriteActivePluginDataPathPrefix(this.data, oldPath, file.path);
      if (existingOwnerId) {
        if (this.canVisuallyMoveAcrossGroups()) this.data.indexGroupByPath[file.path] = targetGroupTitle;
        else delete this.data.indexGroupByPath[file.path];
        if (existingOwner) subject.indexed ||= existingOwner.indexed;
        if (subject.parentId === existingOwnerId) subject.parentId = null;
        for (const candidate of this.data.portableIndex.subjects) {
          if (candidate.parentId === existingOwnerId && candidate.id !== subjectId) candidate.parentId = subjectId;
        }
        this.replacePortableSubjectInLibraryLayouts(existingOwnerId, subjectId);
        this.data.portableIndex.subjects = this.data.portableIndex.subjects.filter((candidate) => candidate.id !== existingOwnerId);
        delete this.data.portableIndex.resolvedPathBySubjectId[existingOwnerId];

        // The selected/imported identity is the survivor. Generic prefix
        // rewriting deliberately unions path-based memberships, but visual
        // maps can collide when both identities already have placements. Make
        // the survivor's parent and sibling position authoritative, then append
        // owner-only children in their previous order.
        const nextParent = targetParentPath === null ? null : replacePathPrefix(targetParentPath, oldPath, file.path);
        this.data.curriculumVisual.parentByPath[file.path] = nextParent;
        for (const [container, paths] of Object.entries(this.data.curriculumVisual.orderByContainer)) {
          const filtered = paths.filter((candidate) => candidate !== file.path);
          if (filtered.length > 0) this.data.curriculumVisual.orderByContainer[container] = filtered;
          else delete this.data.curriculumVisual.orderByContainer[container];
        }
        const nextTargetContainer = targetContainerKey.startsWith("parent:")
          ? `parent:${replacePathPrefix(targetContainerKey.slice(7), oldPath, file.path)}`
          : targetContainerKey;
        if (targetContainerOrder.length > 0) {
          const targetOrder = targetContainerOrder.map((candidate) => replacePathPrefix(candidate, oldPath, file.path));
          const remaining = this.data.curriculumVisual.orderByContainer[nextTargetContainer] ?? [];
          this.data.curriculumVisual.orderByContainer[nextTargetContainer] = [...new Set([...targetOrder, ...remaining])];
        }
        const childContainer = `parent:${file.path}`;
        const mergedChildren = [...new Set([
          ...targetChildOrder.map((candidate) => replacePathPrefix(candidate, oldPath, file.path)),
          ...ownerChildOrder.map((candidate) => replacePathPrefix(candidate, oldPath, file.path)),
          ...(this.data.curriculumVisual.orderByContainer[childContainer] ?? []),
        ].filter((candidate) => candidate !== file.path))];
        if (mergedChildren.length > 0) this.data.curriculumVisual.orderByContainer[childContainer] = mergedChildren;
      }
      this.data.portableIndex.resolvedPathBySubjectId[subjectId] = file.path;
      const relinkable = new Set(this.data.portableIndex.relinkableSubjectIds ?? []);
      if (existingOwnerId) relinkable.delete(existingOwnerId);
      if (wasUnresolved) relinkable.add(subjectId);
      this.data.portableIndex.relinkableSubjectIds = [...relinkable];
      this.dedupeActiveOrganizationPaths();
      if (subject.indexed) {
        this.data.excludedIndexPaths = this.data.excludedIndexPaths.filter((candidate) => candidate !== file.path);
        if (!pathIsInsideFolder(file.path, this.data.settings.primaryFolder) && !this.data.manualIndexPaths.includes(file.path)) {
          this.data.manualIndexPaths.push(file.path);
        }
      } else if (!this.isClinicalMode()) {
        this.data.manualIndexPaths = this.data.manualIndexPaths.filter((candidate) => candidate !== file.path);
        if (pathIsInsideFolder(file.path, this.data.settings.primaryFolder)
          && !this.data.excludedIndexPaths.includes(file.path)) {
          this.data.excludedIndexPaths.push(file.path);
        }
      }
      this.data.selectedPath = file.path;
      this.invalidateRecordCache();
    }, { includePortableIndex: true, requireUndo: true });
  }

  async unlinkPortableSubject(subjectId: string): Promise<void> {
    this.assertDataWritable();
    const subject = this.getPortableSubject(subjectId);
    const oldPath = this.data.portableIndex.resolvedPathBySubjectId[subjectId];
    if (!subject || !oldPath) throw new Error("This portable subject is not linked to a Markdown note.");
    if (!(this.data.portableIndex.relinkableSubjectIds ?? []).includes(subjectId)) {
      throw new Error("Only a note explicitly linked from a portable placeholder can be unlinked.");
    }
    const placeholder = portablePlaceholderPath(subjectId);
    await this.mutate(`Unlink portable subject “${subject.title}”`, () => {
      rewriteActivePluginDataPathPrefix(this.data, oldPath, placeholder);
      delete this.data.portableIndex.resolvedPathBySubjectId[subjectId];
      this.data.selectedPath = placeholder;
      this.invalidateRecordCache();
    }, { includePortableIndex: true, requireUndo: true });
  }
  getCanonicalTopics(): VaultRecord[] { return this.getRecords().filter((record) => record.role === "canonical"); }
  getIndexRecords(): VaultRecord[] {
    const topicsOnly = this.isClinicalMode();
    return this.getRecords().filter((record) => recordBelongsToIndex(record, topicsOnly));
  }

  getIndexCandidateFiles(): TFile[] {
    if (this.isClinicalMode()) return [];
    const indexed = new Set(this.getIndexRecords().map((record) => record.path));
    return this.getVaultNoteFiles(false).filter((file) => !indexed.has(file.path));
  }

  suggestedIndexGroup(file: TFile): string {
    const settings = this.data.settings;
    const frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
    const configured = settings.groupProperty ? asStringList(frontmatter[settings.groupProperty])[0] ?? "" : "";
    if (configured) return configured;
    if (pathIsInsideFolder(file.path, settings.primaryFolder)) return configuredGroupFromPath(file.path, settings.primaryFolder);
    return file.parent?.isRoot() ? "Ungrouped" : file.parent?.name || "Ungrouped";
  }

  getIndexGroups(): string[] {
    const records = this.getIndexRecords();
    const effective = [...new Set([
      ...records.map((record) => record.domain),
      ...Object.values(this.data.indexGroupByPath),
    ].map((group) => group.trim()).filter(Boolean))];
    const folderOrder = new Map<string, string>();
    for (const record of records) {
      const current = folderOrder.get(record.domain);
      if (!current || record.folderOrder < current) folderOrder.set(record.domain, record.folderOrder);
    }
    const ordered = new Set(this.data.indexGroupOrder);
    const remaining = effective.filter((group) => !ordered.has(group)).sort((a, b) => (folderOrder.get(a) ?? `zz-${a}`).localeCompare(folderOrder.get(b) ?? `zz-${b}`, undefined, { numeric: true }) || a.localeCompare(b));
    return [...this.data.indexGroupOrder.filter((group, index, all) => group.trim() && all.indexOf(group) === index), ...remaining];
  }

  getIndexDiagnostics() {
    return buildIndexDiagnostics(this.data, this.getRecords(), new Set(this.app.vault.getMarkdownFiles().map((file) => file.path)));
  }

  getTaxonomyHealthFindings() {
    return buildTaxonomyHealthFindings({
      data: this.data,
      records: this.getRecords(),
      existingMarkdownPaths: new Set(this.app.vault.getMarkdownFiles().map((file) => file.path)),
      existingFolderPaths: new Set(this.app.vault.getAllLoadedFiles()
        .filter((file): file is TFolder => file instanceof TFolder)
        .map((folder) => folder.path)),
      configDir: this.app.vault.configDir,
    });
  }

  async applyTaxonomyHealthRepair(findingId: string, repair: TaxonomyRepairPlan): Promise<void> {
    const current = this.getTaxonomyHealthFindings().find((finding) => finding.id === findingId);
    if (!current?.repair || JSON.stringify(current.repair) !== JSON.stringify(repair)) {
      throw new Error("This finding changed after the preview. Recheck Taxonomy health before applying a repair.");
    }
    await this.mutate(repair.label, () => {
      // The transaction may have waited behind another save while vault files
      // or metadata changed without advancing the plugin data epoch. Rebuild
      // the finding at the commit boundary so the exact preview remains true.
      const currentAtCommit = this.getTaxonomyHealthFindings().find((finding) => finding.id === findingId);
      if (!currentAtCommit?.repair || JSON.stringify(currentAtCommit.repair) !== JSON.stringify(repair)) {
        throw new Error("This finding changed after the preview. Recheck Taxonomy health before applying a repair.");
      }
      if (!applyTaxonomyRepairToData(this.data, repair)) {
        throw new Error("This relationship changed after the preview. No repair was applied.");
      }
      this.invalidateRecordCache();
    }, { includePortableIndex: repair.kind === "clear-portable-parent", requireUndo: true });
  }

  async repairIndexOrganization(): Promise<void> {
    const existing = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    for (const subject of this.data.portableIndex.subjects) existing.add(portableSubjectPath(this.data, subject.id));
    const indexed = new Set(this.getIndexRecords().map((record) => record.path));
    const uniqueExisting = (paths: string[]): string[] => {
      const seen = new Set<string>();
      return paths.filter((path) => {
        if (!existing.has(path) || seen.has(path)) return false;
        seen.add(path);
        return true;
      });
    };
    await this.mutate("Repair safe index organization issues", () => {
      this.data.manualIndexPaths = uniqueExisting(this.data.manualIndexPaths);
      const manual = new Set(this.data.manualIndexPaths);
      this.data.excludedIndexPaths = uniqueExisting(this.data.excludedIndexPaths).filter((path) => !manual.has(path));
      this.data.pinnedPaths = uniqueExisting(this.data.pinnedPaths);
      this.data.nextStudyPaths = uniqueExisting(this.data.nextStudyPaths);
      for (const heading of this.data.collections) {
        heading.subjects = uniqueExisting(heading.subjects);
        for (const subheading of heading.subheadings) subheading.subjects = uniqueExisting(subheading.subjects);
      }
      const excluded = new Set(this.data.excludedIndexPaths);
      for (const path of Object.keys(this.data.indexGroupByPath)) {
        if (!existing.has(path) || (!indexed.has(path) && !excluded.has(path))) delete this.data.indexGroupByPath[path];
      }
      this.data.indexGroupOrder = [...new Set(this.data.indexGroupOrder.map((group) => group.trim()).filter(Boolean))];
      reconcileCurriculumVisual(
        this.data.curriculumVisual,
        this.getRecords(),
        this.data.indexGroupByPath,
        this.isClinicalMode(),
      );
    });
  }

  getTemplateFiles(): TFile[] {
    const root = this.data.settings.templatesFolder;
    return this.app.vault.getMarkdownFiles()
      .filter((file) => root ? pathIsInsideFolder(file.path, root) : true)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getVaultNoteFiles(includeRestricted = false): TFile[] {
    const configDir = this.app.vault.configDir;
    const templatesFolder = this.data.settings.templatesFolder;
    return this.app.vault.getMarkdownFiles()
      .filter((file) => !this.isClinicalMode() || !isImmutableSourcePath(file.path))
      .filter((file) => includeRestricted || (this.isClinicalMode()
        ? !isRestrictedVaultPath(file.path, configDir)
        : !pathIsInsideFolder(file.path, configDir) && (!templatesFolder || !pathIsInsideFolder(file.path, templatesFolder))))
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }

  private isRelevantToBase(path: string, data: PluginData, baseId: string): boolean {
    if (!data.settings.primaryFolder) return !pathIsInsideFolder(path, this.app.vault.configDir);
    const proposalFolder = normalizePath(data.settings.proposalFolder);
    const proposalRoot = proposalFolder ? `${proposalFolder}/` : "";
    const configuredRoots = [data.settings.primaryFolder, data.settings.proposalFolder]
      .filter(Boolean)
      .map((root) => `${normalizePath(root)}/`);
    const clinicalRoots = data.settings.workspaceMode === "ent-clinical" ? [PROCEDURE_ROOT, MEDICATION_ROOT, SYNDROME_ROOT, "07 Evidence Updates/"] : [];
    return [...configuredRoots, proposalRoot, ...clinicalRoots].filter(Boolean).some((root) => path.startsWith(root))
      || this.referencedPaths(data, baseId).has(path)
      || this.excludedPaths(data, baseId).has(path)
      || Object.getOwnPropertyDescriptor(data.indexGroupByPath, path) !== undefined;
  }

  isRelevant(path: string): boolean {
    return this.isRelevantToBase(path, this.data, this.store.activeBaseId);
  }

  private invalidateRecordCachesForPath(path: string): boolean {
    let relevant = false;
    let activeBaseInvalidated = false;
    const currentFile = this.app.vault.getAbstractFileByPath(path);
    const currentFrontmatter = currentFile instanceof TFile
      ? asUnknownRecord(this.app.metadataCache.getFileCache(currentFile)?.frontmatter)
      : {};
    const isCurrentClinicalProposal = currentFrontmatter.type === "topic-proposal";
    for (const entry of this.getKnowledgeBases()) {
      const wasCachedRecord = this.recordPathsCacheByBase.get(entry.id)?.has(path) ?? false;
      const isClinicalProposal = entry.data.settings.workspaceMode === "ent-clinical" && isCurrentClinicalProposal;
      if (!wasCachedRecord && !isClinicalProposal && !this.isRelevantToBase(path, entry.data, entry.id)) continue;
      relevant = true;
      this.recordsCacheByBase.delete(entry.id);
      this.deleteInactiveSearchRecords(entry.id);
      this.recordPathsCacheByBase.delete(entry.id);
      this.librarySubjectCountsCacheByBase.delete(entry.id);
      if (entry.id === this.store.activeBaseId) activeBaseInvalidated = true;
    }
    if (activeBaseInvalidated) {
      this.recordLinkIndex.clear();
      this.recordLinkIndexBaseId = "";
    }
    return relevant;
  }

  async reconcileRecords(records: VaultRecord[]): Promise<boolean> {
    const valid = new Set(records.map((record) => record.path));
    const markdownPaths = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    let semanticChanged = false;
    let selectionChanged = false;
    // Preserve bindings whose Markdown file is temporarily unavailable. Sync
    // may deliver plugin data before notes; retaining the vault-relative path
    // lets the subject resolve automatically when the note arrives and avoids
    // propagating an irreversible placeholder conversion to other devices.
    const unique = (paths: string[]): string[] => [...new Set(paths)];
    const manual = unique(this.data.manualIndexPaths);
    const manualSet = new Set(manual);
    const excluded = unique(this.data.excludedIndexPaths).filter((path) => !manualSet.has(path));
    if (manual.length !== this.data.manualIndexPaths.length || manual.some((path, index) => path !== this.data.manualIndexPaths[index])) {
      this.data.manualIndexPaths = manual;
      semanticChanged = true;
    }
    if (excluded.length !== this.data.excludedIndexPaths.length || excluded.some((path, index) => path !== this.data.excludedIndexPaths[index])) {
      this.data.excludedIndexPaths = excluded;
      semanticChanged = true;
    }
    const groupOrder = [...new Set(this.data.indexGroupOrder.map((group) => group.trim()).filter(Boolean))];
    if (groupOrder.length !== this.data.indexGroupOrder.length || groupOrder.some((group, index) => group !== this.data.indexGroupOrder[index])) {
      this.data.indexGroupOrder = groupOrder;
      semanticChanged = true;
    }
    for (const heading of this.data.collections) {
      const next = unique(heading.subjects);
      if (next.length !== heading.subjects.length) { heading.subjects = next; semanticChanged = true; }
      for (const subheading of heading.subheadings) {
        const subNext = unique(subheading.subjects);
        if (subNext.length !== subheading.subjects.length) { subheading.subjects = subNext; semanticChanged = true; }
      }
    }
    const pins = unique(this.data.pinnedPaths);
    const nextStudy = unique(this.data.nextStudyPaths);
    if (pins.length !== this.data.pinnedPaths.length) { this.data.pinnedPaths = pins; semanticChanged = true; }
    if (nextStudy.length !== this.data.nextStudyPaths.length) { this.data.nextStudyPaths = nextStudy; semanticChanged = true; }
    if (!valid.has(this.data.selectedPath) && (!this.data.selectedPath || !markdownPaths.has(this.data.selectedPath))) {
      const fallback = records[0]?.path || "";
      if (fallback !== this.data.selectedPath) {
        this.data.selectedPath = fallback;
        selectionChanged = true;
      }
    }
    if (semanticChanged) {
      this.invalidateRecordCache();
      await this.savePluginData();
    } else if (selectionChanged) {
      await this.saveViewState();
    }
    return semanticChanged || selectionChanged;
  }

  async mutate(
    label: string,
    action: () => void,
    options: {
      includeSettings?: boolean;
      includePortableIndex?: boolean;
      includeLayoutSnapshots?: boolean;
      includeActiveTab?: boolean;
      requireUndo?: boolean;
      normalizeAfterRestore?: boolean;
    } = {},
  ): Promise<void> {
    this.assertDataWritable();
    if (this.baseOperationBusy) throw new Error("Finish switching knowledge bases before changing its organization.");
    if (this.dataTransactionBusy) throw new Error("Another organization change is still being saved.");
    if (this.directSaveBusyCount > 0) throw new Error("Finish saving the current knowledge-base change before starting another organization transaction.");
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before changing its organization.");
    this.dataTransactionBusy = true;
    try {
      await this.enqueueAppLogicalOperation(async () => {
      const transactionMetadata = {
        updatedAt: this.requireActiveBase().updatedAt,
        semanticRevision: this.requireActiveBase().semanticRevision,
        semanticHead: this.requireActiveBase().semanticHead,
        semanticHash: this.requireActiveBase().semanticHash,
        semanticLineage: [...this.requireActiveBase().semanticLineage],
      };
      const transactionBackup = options.requireUndo ? structuredClone(this.data) : null;
      const previousUndoStack = [...this.data.undoStack];
      const previousRedoStack = [...this.data.redoStack];
      const previousSelectedPath = this.data.selectedPath;
      const previousActiveTab = this.data.activeTab;
      const previousCollapsed = structuredClone(this.data.collapsed);
      const snapshot = snapshotPersonal(
        this.data,
        label,
        options.includeSettings === true,
        options.includePortableIndex === true,
        options.includeLayoutSnapshots === true,
        options.includeActiveTab === true,
      );
      const undoStack = limitSnapshotStack([...this.data.undoStack, snapshot]);
      if (!undoStack.includes(snapshot)) {
        if (options.requireUndo) throw new Error("This change is too large for safe in-plugin Undo. Export a same-vault recovery backup, then reduce the operation size.");
        new Notice("This change is too large for the bounded undo history. Export a backup before further bulk organization changes.", 8000);
      }
      this.data.undoStack = undoStack;
      this.data.redoStack = [];
      try {
        action();
        if (options.normalizeAfterRestore === true) this.normalizeActiveDataAfterRestore();
        // All organization mutations can affect membership, display aliases,
        // portable subjects, or record grouping. Central invalidation keeps
        // warm record-cache hits O(1) without relying on a proportional JSON key.
        this.invalidateRecordCache();
        await this.savePluginDataOperation();
      } catch (error) {
        if (transactionBackup) {
          this.replaceActiveData(transactionBackup, transactionMetadata);
        } else {
          // The already-created personal snapshot is also the lightweight
          // rollback boundary for ordinary edits. Callers that change settings,
          // portable identities, or saved snapshots opt those fields into it.
          restoreSnapshot(this.data, snapshot);
          this.data.undoStack = previousUndoStack;
          this.data.redoStack = previousRedoStack;
          this.data.selectedPath = previousSelectedPath;
          this.data.activeTab = previousActiveTab;
          this.data.collapsed = previousCollapsed;
          // Replace the restored object only on failure. This invalidates stale
          // dialogs without imposing a full-data clone on every small action.
          this.replaceActiveData(structuredClone(this.data), transactionMetadata);
        }
        this.invalidateRecordCache();
        // If an external change interrupted the write, the incoming file was
        // captured before the adapter save could replace it. Avoid writing a
        // second stale rollback snapshot; the reload below will merge the
        // restored in-memory store and persist the authoritative result.
        if (!this.externalReloadBusy) {
          try {
            // A rejected adapter write may still have replaced data.json or
            // reached Sync. Publish the rollback as a newer semantic revision
            // so the rejected snapshot cannot reappear from another device.
            await this.savePluginDataOperation();
          } catch (rollbackError) {
            console.error("Knowledge Base Command Center could not persist the organization rollback", rollbackError);
            this.markPersistenceUncertain("A rejected organization change may have reached Sync, and its compensating rollback could not be saved. Knowledge bases remain read-only until Obsidian is restarted after the plugin data.json and a same-vault recovery are preserved.");
            throw new Error("The organization change failed and its rollback could not be saved. Organization is now read-only; preserve data.json and export a same-vault recovery before restarting Obsidian.");
          }
        } else {
          // The reload worker will merge and persist this causal compensation
          // after the transaction guard is released.
          this.advanceRejectedSemanticAttempts();
        }
        try {
          await this.refreshViews(false);
        } catch (refreshError) {
          console.error("Knowledge Base Command Center restored a failed organization change but could not refresh its view", refreshError);
        }
        throw error;
      }
      await this.refreshViews(false);
      });
    } finally {
      this.dataTransactionBusy = false;
      this.announceOperationsIdle();
    }
  }

  private async applyHistory(direction: "undo" | "redo"): Promise<void> {
    this.assertDataWritable();
    if (this.baseOperationBusy) throw new Error("Finish the current knowledge-base change before using history.");
    if (this.dataTransactionBusy) throw new Error("Another organization change is still being saved.");
    if (this.directSaveBusyCount > 0) throw new Error("Finish saving the current knowledge-base change before using history.");
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before using history.");
    const source = direction === "undo" ? this.data.undoStack : this.data.redoStack;
    if (source.length === 0) return;

    this.dataTransactionBusy = true;
    try {
      await this.enqueueAppLogicalOperation(async () => {
      // Clone after entering the guarded region so an allocation/serialization
      // failure cannot leave organization history permanently marked busy.
      const storeBackup = structuredClone(this.store);
      const snapshot = (direction === "undo" ? this.data.undoStack : this.data.redoStack).pop();
      if (!snapshot) return;
      try {
        const opposite = limitSnapshotStack([
          ...(direction === "undo" ? this.data.redoStack : this.data.undoStack),
          snapshotPersonal(
            this.data,
            snapshot.label,
            Boolean(snapshot.settings),
            Boolean(snapshot.portableIndex),
            Boolean(snapshot.layoutSnapshots),
            snapshot.activeTab !== undefined,
          ),
        ]);
        if (direction === "undo") this.data.redoStack = opposite;
        else this.data.undoStack = opposite;
        restoreSnapshot(this.data, snapshot);
        // Historical snapshots predate the ENT destination invariant. Repair
        // the restored active payload before its first write so Undo/Redo cannot
        // persist a medication, syndrome, or procedure back into the Index.
        this.normalizeActiveDataAfterRestore();
        this.invalidateRecordCache();
        await this.savePluginDataOperation();
      } catch (error) {
        this.preserveNewerCausalMetadata(storeBackup);
        this.store = storeBackup;
        this.useActiveData(this.requireActiveBase().data);
        this.invalidateRecordCache();
        if (!this.externalReloadBusy) {
          try {
            // The rejected history payload may already be on disk. Advance
            // from its causal head before publishing the restored organization
            // and device-local history.
            const compensationNeeded = this.advanceRejectedSemanticAttempts();
            if (compensationNeeded) await this.saveStoreSnapshot();
            else this.persistDeviceLocalState();
          } catch (rollbackError) {
            console.error(`Knowledge Base Command Center could not persist the failed ${direction} rollback`, rollbackError);
            this.markPersistenceUncertain(`A rejected ${direction} may have reached Sync, and its compensating rollback could not be saved. Knowledge bases remain read-only until Obsidian is restarted after the plugin data.json and a same-vault recovery are preserved.`);
            try {
              await this.refreshViews(false);
            } catch (refreshError) {
              console.error(`Knowledge Base Command Center restored a failed ${direction} in memory but could not refresh its view`, refreshError);
            }
            throw new Error(`The ${direction} failed and its rollback could not be saved. Organization is now read-only; preserve data.json and export a same-vault recovery before restarting Obsidian.`);
          }
        } else {
          this.advanceRejectedSemanticAttempts();
        }
        try {
          await this.refreshViews(false);
        } catch (refreshError) {
          console.error(`Knowledge Base Command Center restored a failed ${direction} but could not refresh its view`, refreshError);
        }
        throw error;
      }
      try {
        await this.refreshViews(false);
      } catch (error) {
        console.error(`Knowledge Base Command Center saved ${direction} but could not refresh its view`, error);
        new Notice(`The ${direction} was saved, but the view could not refresh. Reopen the command center to update it.`, 8000);
      }
      new Notice(`${direction === "undo" ? "Undid" : "Redid"}: ${snapshot.label}`);
      });
    } finally {
      this.dataTransactionBusy = false;
      this.announceOperationsIdle();
    }
  }

  async undo(): Promise<void> { await this.applyHistory("undo"); }
  async redo(): Promise<void> { await this.applyHistory("redo"); }

  resolveLink(link: string, sourcePath: string, records: Map<string, VaultRecord>): VaultRecord | null {
    const clean = normalizeWikiLink(link);
    const file = this.app.metadataCache.getFirstLinkpathDest(clean, sourcePath);
    if (file && records.has(file.path)) return records.get(file.path) ?? null;
    const lowered = clean.toLowerCase();
    return this.recordLinkIndex.get(lowered) ?? null;
  }

  getBacklinkPaths(path: string): string[] {
    if (!this.backlinkIndex) {
      this.backlinkIndex = new Map<string, string[]>();
      for (const [source, links] of Object.entries(this.app.metadataCache.resolvedLinks)) {
        for (const destination of Object.keys(links)) {
          // Append in place; copying the array per backlink is quadratic on hub notes.
          const sources = this.backlinkIndex.get(destination);
          if (sources) sources.push(source);
          else this.backlinkIndex.set(destination, [source]);
        }
      }
    }
    return this.backlinkIndex.get(path) ?? [];
  }

  validateGenericNote(value: GenericNoteFormValue): string | null {
    if (!value.title.trim()) return "Enter a note title.";
    if (!sanitizeFileName(value.title)) return "The note title must contain at least one valid filename character.";
    if (!genericNotePath(value.folder, value.title)) return "Choose a valid note title and destination.";
    const folderError = validateWritableFolderPath(value.folder, this.app.vault.configDir);
    if (folderError) return folderError;
    if (value.mode === "template") {
      const templatePathError = validateTemplateFilePath(value.templatePath, this.data.settings.templatesFolder, this.app.vault.configDir);
      if (templatePathError) return templatePathError;
      const template = this.app.vault.getAbstractFileByPath(normalizePath(value.templatePath));
      if (!(template instanceof TFile) || template.extension !== "md") return "The selected template could not be found.";
    }
    const path = normalizePath(genericNotePath(value.folder, value.title));
    if (this.app.vault.getAbstractFileByPath(path)) return `A note already exists at ${path}.`;
    return null;
  }

  async createKnowledgeNote(value: GenericNoteFormValue, tokenContext: TemplateTokenContext = {}): Promise<TFile> {
    this.assertDataWritable();
    const validation = this.validateGenericNote(value);
    if (validation) throw new Error(validation);
    const path = normalizePath(genericNotePath(value.folder, value.title));
    const folder = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
    let content = "";
    if (value.mode === "template") {
      const template = this.app.vault.getAbstractFileByPath(normalizePath(value.templatePath));
      if (!(template instanceof TFile)) throw new Error("The selected template could not be found.");
      const now = new Date();
      content = applyTemplateTokens(
        await this.app.vault.cachedRead(template),
        value.title,
        this.today(),
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        tokenContext,
      );
    }
    const createdFolders: TFolder[] = [];
    try {
      await this.ensureFolder(folder, createdFolders);
      const file = await this.app.vault.create(path, content);
      this.invalidateRecordCache();
      return file;
    } catch (error) {
      await this.removeCreatedEmptyFolders(createdFolders);
      throw error;
    }
  }

  openAttachmentImport(note = this.app.workspace.getActiveFile()): void {
    if (!(note instanceof TFile) || note.extension !== "md") {
      new Notice("Open the Markdown note that should receive the attachment, then try again.", 7000);
      return;
    }
    if (isImmutableSourcePath(note.path)) {
      new Notice("Immutable source-book notes cannot receive plugin attachments.", 7000);
      return;
    }
    const policy = this.captureAttachmentPolicy();
    new AttachmentImportModal(
      this.app,
      note.path,
      policy,
      policy.storageMode === "ask"
        ? this.app.vault.getAllLoadedFiles()
          .filter((file): file is TFolder => file instanceof TFolder)
          .map((folder) => folder.path)
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right))
        : [],
      this.data.settings.attachmentInsertionMode,
      async (value) => {
        this.assertAttachmentOperationCurrent(note, policy);
        await this.attachFileToNote(note, value, policy);
      },
    ).open();
  }

  private openPrivacySafeAttachmentImportCurrentNote(): void {
    const note = this.app.workspace.getActiveFile();
    if (!(note instanceof TFile)
      || note.extension.toLocaleLowerCase() !== "md"
      || isImmutableSourcePath(note.path)
      || this.app.vault.getAbstractFileByPath(note.path) !== note
      || this.isDataReadOnly()) {
      // Keep protocol notices independent of the active path, title, or reason.
      // The route carries no note identity; it may act only on local UI state.
      new Notice("No eligible active Markdown note is available for attach file.", 7000);
      return;
    }
    this.openAttachmentImport(note);
  }

  private captureAttachmentPolicy(): AttachmentOperationPolicy {
    const settings = this.data.settings;
    return Object.freeze({
      expectedBaseId: this.getActiveKnowledgeBaseId(),
      expectedDataEpoch: this.getDataEpoch(),
      storageMode: settings.attachmentStorageMode,
      configuredFolder: settings.attachmentFolder,
      marker: settings.attachmentMarker,
      heading: settings.attachmentHeading,
    });
  }

  private assertAttachmentOperationCurrent(note: TFile, policy: AttachmentOperationPolicy): void {
    if (policy.expectedBaseId !== this.getActiveKnowledgeBaseId() || policy.expectedDataEpoch !== this.getDataEpoch()) {
      throw new Error("The active knowledge base or its synced data changed. Reopen Attach file before continuing.");
    }
    const current = this.app.vault.getAbstractFileByPath(note.path);
    if (current !== note || note.extension !== "md") {
      throw new Error("The selected note changed or was replaced. Reopen it before attaching the file.");
    }
    if (isImmutableSourcePath(note.path)) throw new Error("Immutable source-book notes cannot receive plugin attachments.");
  }

  async attachFileToNote(
    note: TFile,
    value: AttachmentImportValue,
    policy = this.captureAttachmentPolicy(),
  ): Promise<TFile> {
    this.assertDataWritable();
    this.assertAttachmentOperationCurrent(note, policy);
    if (value.file.size > MAX_ATTACHMENT_BYTES) throw new Error("The selected file is larger than the 100 MB attachment limit.");
    if (value.file.size < 0) throw new Error("The selected file has an invalid size.");
    const editorView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editorOwnsNote = editorView?.file === note;
    if (value.insertionMode === "cursor" && !editorOwnsNote) {
      throw new Error("Open this note in the Markdown editor to insert at the cursor, or choose marker, heading, or end of note.");
    }
    const currentMarkdown = editorOwnsNote ? editorView.editor.getValue() : await this.app.vault.cachedRead(note);
    assertMarkdownAiLockWritable(currentMarkdown);

    const createdFolders: TFolder[] = [];
    let destination: string;
    let bytes: ArrayBuffer;
    try {
      destination = await this.availableAttachmentDestination(note, value.file.name, value.requestedFolder, policy, createdFolders);
      this.assertAttachmentOperationCurrent(note, policy);
      bytes = await value.file.arrayBuffer();
      this.assertAttachmentOperationCurrent(note, policy);
    } catch (error) {
      await this.removeCreatedEmptyFolders(createdFolders);
      throw error;
    }
    let created: TFile;
    try {
      created = await this.app.vault.createBinary(destination, bytes);
    } catch (error) {
      await this.removeCreatedEmptyFolders(createdFolders);
      console.error("Knowledge Base Command Center could not copy the selected attachment", error);
      throw new Error(`The attachment could not be copied to ${destination}.`);
    }
    try {
      this.assertAttachmentOperationCurrent(note, policy);
      const reference = this.app.fileManager.generateMarkdownLink(created, note.path);
      if (!reference.trim()) throw new Error("Obsidian generated an empty attachment link.");
      if (value.insertionMode === "cursor") {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file !== note) throw new Error("The active editor changed before the link was inserted.");
        this.assertAttachmentOperationCurrent(note, policy);
        assertMarkdownAiLockWritable(view.editor.getValue());
        view.editor.replaceRange(reference, view.editor.getCursor());
      } else {
        const insertionTarget = value.insertionMode === "marker" ? "marker"
          : value.insertionMode === "heading" ? "heading" : "end";
        this.assertAttachmentOperationCurrent(note, policy);
        await this.app.vault.process(note, (markdown) => {
          this.assertAttachmentOperationCurrent(note, policy);
          assertMarkdownAiLockWritable(markdown);
          return insertAttachmentReference(
            markdown,
            reference,
            insertionTarget,
            policy.marker,
            policy.heading,
          );
        });
      }
    } catch (error) {
      console.error("Knowledge Base Command Center copied an attachment but could not insert its link", error);
      throw new Error(`The file was copied to ${created.path}, but its Markdown link could not be inserted. Add the link manually.`);
    }
    new Notice(`Attached ${attachmentFileName(value.file.name)} inside the vault.`, 5000);
    return created;
  }

  private async availableAttachmentDestination(
    note: TFile,
    originalName: string,
    requestedFolder: string,
    policy: AttachmentOperationPolicy,
    createdFolders: TFolder[],
  ): Promise<string> {
    const mode = policy.storageMode;
    if (mode === "obsidian") {
      const destination = normalizePath(await this.app.fileManager.getAvailablePathForAttachment(attachmentFileName(originalName), note.path));
      const folder = destination.includes("/") ? destination.slice(0, destination.lastIndexOf("/")) : "";
      const error = validateWritableFolderPath(folder, this.app.vault.configDir);
      if (error || isImmutableSourcePath(destination)) throw new Error(error ?? "Obsidian selected an immutable source-book folder.");
      return destination;
    }

    const rawFolder = mode === "note-subfolder"
      ? noteAttachmentFolder(note.path)
      : mode === "ask"
        ? requestedFolder
        : policy.configuredFolder;
    const folder = canonicalAttachmentFolder(rawFolder);
    const error = validateWritableFolderPath(folder, this.app.vault.configDir);
    if (error) throw new Error(error);
    if (isImmutableSourcePath(`${folder}/attachment`)) throw new Error("Attachments cannot be stored inside immutable source-book folders.");
    await this.ensureFolder(folder, createdFolders);
    for (let suffix = 0; suffix <= 10_000; suffix += 1) {
      const path = attachmentPathCandidate(folder, originalName, suffix);
      if (isImmutableSourcePath(path)) throw new Error("Attachments cannot be stored inside immutable source-book folders.");
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
    }
    throw new Error("No collision-free attachment filename could be created in that folder.");
  }

  getPortableJsonFiles(): TFile[] {
    return this.app.vault.getFiles()
      .filter((file) => file.extension.toLowerCase() === "json")
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Preserve a complete local plugin envelope before Sync conflict handling can
   * replace it. The rescue is intentionally private and contains no note
   * bodies, but it does contain exact vault-relative paths and organization.
   */
  private async writeConflictRescueStore(store: PluginStore, reason: string): Promise<string> {
    try {
      const serializedStore = JSON.stringify(store);
      if (serializedStore === this.lastConflictRescueStore && this.lastConflictRescuePath) {
        return this.lastConflictRescuePath;
      }
      const file = await this.writePortableJson("conflict", {
        kind: "knowledge-base-command-center-conflict-rescue",
        version: 1,
        exportedAt: new Date().toISOString(),
        reason,
        privacy: "Contains plugin organization and exact vault-relative paths; note contents are not included.",
        store,
      });
      this.lastConflictRescueStore = serializedStore;
      this.lastConflictRescuePath = file.path;
      return file.path;
    } catch {
      console.error("Knowledge Base Command Center could not write a Sync conflict rescue.");
      return "";
    }
  }

  async writePortableJson(kind: "backup" | "workspace" | "portable" | "portfolio" | "conflict", value: unknown): Promise<TFile> {
    const folder = "Knowledge Base Command Center Exports";
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basePath = normalizePath(`${folder}/knowledge-base-command-center-${kind}-${stamp}`);
    let path = `${basePath}.json`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${basePath}-${suffix}.json`;
      suffix += 1;
    }
    const createdFolders: TFolder[] = [];
    try {
      await this.ensureFolder(folder, createdFolders);
      return await this.app.vault.create(path, content);
    } catch (error) {
      await this.removeCreatedEmptyFolders(createdFolders);
      throw error;
    }
  }

  async readPortableJson(file: TFile): Promise<unknown> {
    if (file.extension.toLowerCase() !== "json") throw new Error("Choose a JSON export file.");
    if (file.stat.size > MAX_PORTABLE_PACKAGE_BYTES) throw new Error("The selected JSON is larger than the 10 MB import limit.");
    return JSON.parse(await this.app.vault.read(file)) as unknown;
  }

  async readPortfolioJson(file: TFile): Promise<unknown> {
    if (file.extension.toLowerCase() !== "json") throw new Error("Choose a JSON portfolio export file.");
    if (file.stat.size > MAX_PORTFOLIO_BUNDLE_BYTES) throw new Error("The selected portfolio is larger than the 32 MB import limit.");
    return JSON.parse(await this.app.vault.read(file)) as unknown;
  }

  validateProposal(value: TopicFormValue, currentPath = ""): string | null {
    if (!value.title) return "Enter a topic title.";
    const folder = normalizePath(this.data.settings.proposalFolder);
    const folderError = this.isClinicalMode()
      ? validateProposalFolderPath(folder, this.app.vault.configDir)
      : validateWritableFolderPath(folder, this.app.vault.configDir);
    if (folderError) return folderError;
    const path = normalizePath(proposalPath(folder, value.title));
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && path !== currentPath) return `A note already exists at ${path}.`;
    return null;
  }

  validateCanonical(value: TopicFormValue, currentPath = "", preserveCurrentPath = false): string | null {
    if (!value.title) return "Enter a topic title.";
    if (!canonicalIdIsValid(value.curriculumId, value.domain)) return "Curriculum ID does not match the selected domain or expected ENT-XXX-### format.";
    if (!value.priority) return "Choose a study priority.";
    const loweredTitle = value.title.toLowerCase();
    const duplicate = this.getCanonicalTopics().find((record) => record.path !== currentPath && (
      record.curriculumId.toLowerCase() === value.curriculumId.toLowerCase()
      || record.title.toLowerCase() === loweredTitle
      || record.aliases.some((alias) => alias.toLowerCase() === loweredTitle)
    ));
    if (duplicate) return `Duplicate curriculum ID, title, or alias conflicts with ${duplicate.curriculumId} · ${duplicate.title}.`;
    const hierarchyError = canonicalHierarchyIssue(value, this.getCanonicalTopics(), currentPath);
    if (hierarchyError) return hierarchyError;
    if (!preserveCurrentPath) {
      const path = normalizePath(canonicalPath(value, this.data.settings.primaryFolder));
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing && path !== currentPath) return `A note already exists at ${path}.`;
    }
    return null;
  }

  async createProposal(value: TopicFormValue): Promise<TFile> {
    this.assertDataWritable();
    const validation = this.validateProposal(value);
    if (validation) throw new Error(validation);
    const path = normalizePath(proposalPath(this.data.settings.proposalFolder, value.title));
    const content = buildProposalMarkdown({
      title: value.title,
      domain: value.domain,
      parentPath: value.parentPath,
      parentTopic: this.parentWikiLink(value.parentPath),
      topicKind: value.topicKind,
      priority: value.priority,
      safetyCritical: value.safetyCritical,
    }, this.today());
    const createdFolders: TFolder[] = [];
    try {
      await this.ensureFolder(path.substring(0, path.lastIndexOf("/")), createdFolders);
      const file = await this.app.vault.create(path, content);
      this.invalidateRecordCache();
      await this.refreshViews();
      return file;
    } catch (error) {
      await this.removeCreatedEmptyFolders(createdFolders);
      throw error;
    }
  }

  async createCanonical(value: TopicFormValue): Promise<TFile> {
    this.assertDataWritable();
    const validation = this.validateCanonical(value);
    if (validation) throw new Error(validation);
    const path = normalizePath(canonicalPath(value, this.data.settings.primaryFolder));
    const content = buildCanonicalMarkdown({
      title: value.title,
      domain: value.domain,
      curriculumId: value.curriculumId,
      parentTopic: this.parentWikiLink(value.parentPath),
      topicKind: value.topicKind,
      priority: value.priority,
      safetyCritical: value.safetyCritical,
    }, this.today());
    const createdFolders: TFolder[] = [];
    try {
      await this.ensureFolder(path.substring(0, path.lastIndexOf("/")), createdFolders);
      const file = await this.app.vault.create(path, content);
      this.invalidateRecordCache();
      await this.refreshViews();
      return file;
    } catch (error) {
      await this.removeCreatedEmptyFolders(createdFolders);
      throw error;
    }
  }

  async promoteProposal(sourcePath: string, value: TopicFormValue): Promise<TFile> {
    this.assertDataWritable();
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile)) throw new Error("The proposal note could not be found.");
    const frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(source)?.frontmatter);
    if (frontmatter.type !== "topic-proposal") throw new Error("Only a topic-proposal note can be promoted.");
    if (frontmatter.ai_lock === true) throw new Error("This proposal has ai_lock: true and cannot be changed.");
    const validation = this.validateCanonical(value, sourcePath);
    if (validation) throw new Error(validation);
    const destination = normalizePath(canonicalPath(value, this.data.settings.primaryFolder));
    const originalContent = await this.app.vault.read(source);
    const originalPath = source.path;
    const createdFolders: TFolder[] = [];
    let current = source;
    try {
      await this.ensureFolder(destination.substring(0, destination.lastIndexOf("/")), createdFolders);
      await this.app.fileManager.renameFile(source, destination);
      const moved = this.app.vault.getAbstractFileByPath(destination);
      if (!(moved instanceof TFile)) throw new Error("The promoted note could not be found after it was moved.");
      current = moved;
      await this.app.fileManager.processFrontMatter(current, (metadata) => {
        applyCanonicalFrontmatter(asUnknownRecord(metadata as unknown), {
          value,
          parentTopic: this.parentWikiLink(value.parentPath),
          date: this.today(),
          forceUnverified: true,
          removeProposalFields: true,
        });
      });
      await this.app.vault.process(current, (content) => rewriteTopLevelHeading(content, value.title)
        .replace(/> \[!warning\] Topic proposal — unverified\n> .*\n/, () => "> [!warning] Unverified clinical-topic scaffold\n> This educational note is now structurally canonical but remains unverified until the vault owner reviews source-traced content.\n"));
      this.invalidateRecordCache();
      await this.refreshViews();
      return current;
    } catch (error) {
      let rollbackError: unknown = null;
      try {
        await this.restoreMovedFile(current, originalPath, destination, originalContent);
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError;
        console.error("Knowledge Base Command Center promotion rollback failed", caughtRollbackError);
      }
      await this.removeCreatedEmptyFolders(createdFolders);
      if (rollbackError) throw this.operationFailureWithRollback("promotion", error, rollbackError, originalPath, destination);
      throw error;
    }
  }

  async editCanonicalPlacement(sourcePath: string, value: TopicFormValue): Promise<TFile> {
    this.assertDataWritable();
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile)) throw new Error("The canonical note could not be found.");
    const frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(source)?.frontmatter);
    if (frontmatter.ai_lock === true) throw new Error("This note has ai_lock: true and cannot be changed.");
    if (!asText(frontmatter.curriculum_id)) throw new Error("Only a canonical topic can use placement editing.");
    const currentRecord = this.getRecord(sourcePath);
    const preserveCurrentPath = canonicalPathInputsUnchanged(currentRecord, value);
    const validation = this.validateCanonical(value, sourcePath, preserveCurrentPath);
    if (validation) throw new Error(validation);
    // Sanitization rules may become stricter over time. Editing parent, priority,
    // or other metadata must not silently migrate an existing filename.
    const destination = preserveCurrentPath
      ? source.path
      : normalizePath(canonicalPath(value, this.data.settings.primaryFolder));
    const originalContent = await this.app.vault.read(source);
    const originalPath = source.path;
    const createdFolders: TFolder[] = [];
    let current = source;
    try {
      if (destination !== originalPath) {
        await this.ensureFolder(destination.substring(0, destination.lastIndexOf("/")), createdFolders);
        await this.app.fileManager.renameFile(source, destination);
        const moved = this.app.vault.getAbstractFileByPath(destination);
        if (!(moved instanceof TFile)) throw new Error("The canonical note could not be found after it was moved.");
        current = moved;
      }
      await this.app.fileManager.processFrontMatter(current, (metadata) => {
        applyCanonicalFrontmatter(asUnknownRecord(metadata as unknown), {
          value,
          parentTopic: this.parentWikiLink(value.parentPath),
          date: this.today(),
          forceUnverified: false,
        });
      });
      await this.app.vault.process(current, (content) => rewriteTopLevelHeading(content, value.title));
      this.invalidateRecordCache();
      await this.refreshViews();
      return current;
    } catch (error) {
      let rollbackError: unknown = null;
      try {
        await this.restoreMovedFile(current, originalPath, destination, originalContent);
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError;
        console.error("Knowledge Base Command Center placement rollback failed", caughtRollbackError);
      }
      await this.removeCreatedEmptyFolders(createdFolders);
      if (rollbackError) throw this.operationFailureWithRollback("placement", error, rollbackError, originalPath, destination);
      throw error;
    }
  }

  private parentWikiLink(path: string): string {
    if (!path) return "";
    const parent = this.getCanonicalTopics().find((record) => record.path === path);
    if (!parent) return "";
    return `[[${parent.path.replace(/\.md$/, "").split("/").pop()}|${parent.sourceTitle || parent.title}]]`;
  }

  private today(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private async ensureFolder(path: string, createdFolders: TFolder[] = []): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized) return;
    let built = "";
    for (const segment of normalized.split("/")) {
      built = built ? `${built}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(built);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`${built} exists but is not a folder.`);
      const created = await this.app.vault.createFolder(built);
      if (created instanceof TFolder) createdFolders.push(created);
    }
  }

  /** Remove only folders created by the failed operation and still confirmed empty. */
  private async removeCreatedEmptyFolders(createdFolders: TFolder[]): Promise<void> {
    for (const folder of [...createdFolders].reverse()) {
      const current = this.app.vault.getAbstractFileByPath(folder.path);
      if (current !== folder || folder.children.length > 0) continue;
      try {
        await this.app.fileManager.trashFile(folder);
      } catch (error) {
        // Leaving an empty folder is safer than broadening rollback deletion.
        console.warn(`Knowledge Base Command Center could not remove the empty rollback folder ${folder.path}`, error);
      }
    }
  }

  private async restoreMovedFile(
    operationFile: TFile,
    originalPath: string,
    destination: string,
    originalContent: string,
  ): Promise<void> {
    const destinationFile = this.app.vault.getAbstractFileByPath(destination);
    const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
    const operationAtOriginal = originalFile === operationFile;
    const operationAtDestination = destinationFile === operationFile;
    if (!operationAtOriginal && !operationAtDestination) {
      if (originalFile instanceof TFile && destinationFile instanceof TFile) {
        throw new Error(`Both ${originalPath} and ${destination} exist, but the file moved by this operation could not be identified. No content was changed.`);
      }
      throw new Error(`The file moved by this operation could not be safely identified at either ${originalPath} or ${destination}. No content was changed.`);
    }
    // Never select a file merely because it occupies the destination path. A
    // Sync client may create that path between validation and rename. Object
    // identity keeps rollback scoped to the exact TFile this operation began
    // with and prevents unrelated destination content from being overwritten.
    const file = operationFile;
    const failures: string[] = [];
    try {
      await this.app.vault.process(file, () => originalContent);
    } catch (error) {
      failures.push(`content restore failed (${error instanceof Error ? error.message : String(error)})`);
    }
    if (file.path !== originalPath) {
      try {
        await this.app.fileManager.renameFile(file, originalPath);
      } catch (error) {
        failures.push(`path restore failed (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
  }

  private operationFailureWithRollback(
    operation: "promotion" | "placement",
    error: unknown,
    rollbackError: unknown,
    originalPath: string,
    destination: string,
  ): Error {
    const operationMessage = error instanceof Error ? error.message : String(error);
    const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    return new Error(`${operationMessage} Automatic ${operation} rollback also failed (${rollbackMessage}). Inspect “${originalPath}” and “${destination}” before retrying; no further automatic changes were attempted.`);
  }

  private handleVaultRenameEvent(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile) && !(file instanceof TFolder)) return;
    this.pendingVaultRenames.push({ oldPath, newPath: file.path, folderRename: file instanceof TFolder });
    // The file has already moved while handleRename may still be waiting behind
    // Sync or another transaction. Evict every projection now so a search can
    // never publish the old path during that wait (or after a read-only rename
    // repair is rejected).
    this.invalidateRecordCache();
    const repair = this.vaultRenameRepairQueue.then(async () => {
      // Process physical renames in event order. If one durable repair fails,
      // later overlays remain composed in memory instead of being removed from
      // underneath an earlier stale persisted path.
      while (this.pendingVaultRenames.length > 0) {
        const pending = this.pendingVaultRenames[0];
        if (!pending) break;
        await this.handleRename(pending.oldPath, pending.newPath, pending.folderRename);
        if (this.pendingVaultRenames[0] === pending) this.pendingVaultRenames.shift();
        else {
          const index = this.pendingVaultRenames.indexOf(pending);
          if (index >= 0) this.pendingVaultRenames.splice(index, 1);
        }
        // The durable store is authoritative through this event. Cancel every
        // projection that was built with the now-removed temporary overlay.
        this.invalidateRecordCache();
      }
    });
    this.vaultRenameRepairQueue = repair.catch(() => {});
    this.run(() => repair);
  }

  private async handleRename(oldPath: string, newPath: string, folderRename = false): Promise<void> {
    for (;;) {
      // Wait outside the shared logical-operation slot. A Sync callback that
      // starts while a rename transaction is active is deliberately queued
      // behind that transaction; awaiting it from inside the slot would make
      // the two operations wait on each other.
      const pendingExternalReload = this.externalReloadPromise;
      if (pendingExternalReload) {
        await pendingExternalReload;
        continue;
      }
      await this.waitForOperationsIdle();
      const completed = await this.enqueueAppLogicalOperation(
        () => this.handleRenameOperation(oldPath, newPath, folderRename),
      );
      if (completed) return;
      const reload = this.externalReloadPromise;
      if (reload) await reload;
      else await Promise.resolve();
    }
  }

  private async handleRenameOperation(oldPath: string, newPath: string, folderRename = false): Promise<boolean> {
    // A vault rename is an all-base transaction. A Sync callback can begin in
    // either await window below, so merely sampling externalReloadPromise once
    // is insufficient: the rewrite could otherwise be rejected and the old
    // paths would remain after the Markdown file has already moved.
    // Another local operation or Sync reload can acquire its public guard
    // after the outer idle check but before this queued continuation runs.
    // Release the shared slot and retry rather than awaiting it here.
    if (this.baseOperationBusy || this.dataTransactionBusy || this.directSaveBusyCount > 0
      || this.externalReloadBusy || this.externalReloadPromise !== null) return false;

    this.assertDataWritable();
    const storeBackup = structuredClone(this.store);
    const attemptExternalGeneration = this.externalChangeGeneration;
    this.baseOperationBusy = true;
    let retryAfterExternalReload = false;
    let historyWasTrimmed = false;
    try {
        const historyDepths = this.store.bases.map((entry) => [entry.data.layoutSnapshots.length, entry.data.undoStack.length, entry.data.redoStack.length]);
        let semanticChanged = false;
        let localStateChanged = false;
        for (const entry of this.store.bases) {
          const beforeSemanticHash = semanticEntryFingerprint(entry);
          const pathsChanged = rewritePluginDataPathPrefix(entry.data, oldPath, newPath);
          const folderStateChanged = folderRename && rewritePluginDataFolderRename(entry.data, oldPath, newPath);
          const templatePathChanged = !folderRename && rewritePluginDataTemplatePathRename(entry.data, oldPath, newPath);
          const entryChanged = pathsChanged || folderStateChanged || templatePathChanged;
          if (entryChanged) {
            if (semanticEntryFingerprint(entry) !== beforeSemanticHash) {
              this.bumpEntrySemanticRevision(entry);
              semanticChanged = true;
            } else {
              localStateChanged = true;
            }
          }
        }
        const boundedDepths = this.store.bases.map((entry) => [entry.data.layoutSnapshots.length, entry.data.undoStack.length, entry.data.redoStack.length]);
        historyWasTrimmed = boundedDepths.some((depths, baseIndex) => depths.some((depth, stackIndex) => depth < (historyDepths[baseIndex]?.[stackIndex] ?? 0)));
        this.invalidateRecordCache();
        if (semanticChanged) await this.saveStoreSnapshot();
        else if (localStateChanged) this.persistDeviceLocalState();
        // A callback can start after saveStoreSnapshot has committed but before
        // this continuation resumes. Let that reload merge the committed rename,
        // then run the idempotent rewrite once more against its final envelope.
        retryAfterExternalReload = attemptExternalGeneration !== this.externalChangeGeneration
          || this.externalReloadBusy;
    } catch (error) {
        const interruptedByExternalReload = attemptExternalGeneration !== this.externalChangeGeneration
          || this.externalReloadBusy
          || this.externalReloadPromise !== null;
        this.store = storeBackup;
        this.useActiveData(this.requireActiveBase().data);
        this.invalidateRecordCache();
        this.advanceRejectedSemanticAttempts();
        if (interruptedByExternalReload) {
          retryAfterExternalReload = true;
        } else {
          try {
            await this.saveStoreSnapshot();
          } catch (rollbackError) {
            // Sync can also begin during the compensating write. Release the
            // operation guard and retry against that reload instead of waiting
            // for it here (the reload is itself waiting for this guard).
            if (attemptExternalGeneration !== this.externalChangeGeneration
              || this.externalReloadBusy
              || this.externalReloadPromise !== null) {
              retryAfterExternalReload = true;
            } else {
              console.error("Knowledge Base Command Center could not persist the failed vault-rename rollback", rollbackError);
              this.markPersistenceUncertain("A rejected vault-rename rewrite may have reached Sync, and its compensating rollback could not be saved. Knowledge bases remain read-only until Obsidian is restarted after the plugin data.json and a same-vault recovery are preserved.");
              throw new Error("The vault rename was detected, but its organization update and rollback could not be saved. Organization is now read-only; preserve data.json and export a same-vault recovery before restarting Obsidian.");
            }
          }
          if (!retryAfterExternalReload) throw error;
        }
    } finally {
      this.baseOperationBusy = false;
      this.announceOperationsIdle();
    }

    if (retryAfterExternalReload) return false;
    if (historyWasTrimmed) {
      new Notice("Some saved organization history no longer fit the plugin data budget after the rename and was removed. Current organization was preserved.", 8000);
    }
    this.scheduleRefresh();
    return true;
  }

  scheduleRefresh(invalidateRecords = true): void {
    this.refreshShouldInvalidateRecords ||= invalidateRecords;
    if (this.refreshTimer !== null) window.activeWindow.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.activeWindow.setTimeout(() => {
      this.refreshTimer = null;
      const shouldInvalidate = this.refreshShouldInvalidateRecords;
      this.refreshShouldInvalidateRecords = false;
      this.run(() => this.refreshViews(shouldInvalidate));
    }, 250);
  }

  async refreshViews(invalidateRecords = true): Promise<void> {
    this.syncLibraryCommands();
    if (invalidateRecords) this.invalidateRecordCache();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof EntVaultCommandCenterView) await leaf.view.reload();
    }
  }

  countMemberships(path: string): number {
    return this.data.collections.reduce((total, heading) => total
      + Number(heading.subjects.includes(path))
      + heading.subheadings.reduce((sum, subheading) => sum + Number(subheading.subjects.includes(path)), 0), 0);
  }

  private indexGroupSortKey(
    data: PluginData,
    domain: string,
    path: string,
    primaryFolder = data.settings.primaryFolder,
  ): string {
    if (data.settings.workspaceMode === "ent-clinical" && !data.settings.allowClinicalVisualGroupMoves
      && pathIsInsideFolder(path, primaryFolder)) {
      const root = normalizePath(primaryFolder);
      const relative = normalizePath(path).slice(root.length + 1);
      return relative.split("/")[0] || "99";
    }
    const index = data.indexGroupOrder.indexOf(domain);
    return index >= 0 ? String(index).padStart(4, "0") : `zz-${domain.toLowerCase()}`;
  }

  async openFile(file: TFile): Promise<void> {
    const behavior = this.data.settings.openNoteBehavior;
    const leaf = behavior === "same-tab"
      ? this.app.workspace.getLeaf(false)
      : behavior === "split"
        ? this.app.workspace.getLeaf("split", "vertical")
        : this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }
}
