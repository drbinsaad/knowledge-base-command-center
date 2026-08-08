import { normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { EntHierarchyBasesView } from "./bases-view";
import {
  asUnknownRecord,
  asStringList,
  asText,
  applyCanonicalFrontmatter,
  buildCanonicalMarkdown,
  buildIndexDiagnostics,
  buildProposalMarkdown,
  applyTemplateTokens,
  canonicalIdIsValid,
  canonicalHierarchyIssue,
  canonicalPath,
  canonicalPathInputsUnchanged,
  cleanDomainFolder,
  configuredGroupFromPath,
  curriculumContainerKey,
  createDefaultStore,
  createKnowledgeBaseEntry,
  DATA_VERSION,
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  ENT_CLINICAL_SETTINGS,
  genericNotePath,
  GenericNoteFormValue,
  isImmutableSourcePath,
  isPortablePlaceholderPath,
  isLegacyDeterministicMigratedVaultId,
  isRecognizedPluginData,
  isRecognizedPluginStore,
  isRestrictedVaultPath,
  limitSnapshotStack,
  MAX_DELETED_KNOWLEDGE_BASE_IDS,
  MAX_KNOWLEDGE_BASES,
  MEDICATION_ROOT,
  migrateData,
  migrateStore,
  normalizeWikiLink,
  pathIsInsideFolder,
  portablePlaceholderPath,
  PluginData,
  PluginStore,
  KnowledgeBaseEntry,
  PROCEDURE_ROOT,
  proposalPath,
  reconcileCurriculumVisual,
  RecordKind,
  RecordRole,
  replacePathPrefix,
  resetCurriculumVisualPath,
  restoreSnapshot,
  rewriteTopLevelHeading,
  rewriteActivePluginDataPathPrefix,
  rewritePluginDataFolderRename,
  rewritePluginDataPathPrefix,
  rewritePluginDataTemplatePathRename,
  sanitizeFileName,
  snapshotPersonal,
  storedDataVersion,
  STORE_VERSION,
  SYNDROME_ROOT,
  TopicFormValue,
  validateProposalFolderPath,
  validateTemplateFilePath,
  validateWritableFolderPath,
  VaultRecord,
  WorkspaceMode,
} from "./model";
import { MAX_PORTABLE_PACKAGE_BYTES, portableSubjectPath } from "./portability";
import { EntCommandCenterSettingsTab } from "./settings";
import { EntVaultCommandCenterView, VIEW_TYPE } from "./view";
import { CreateKnowledgeBaseModal, ManageKnowledgeBasesModal } from "./knowledge-base-modal";
import { mergeKnowledgeBaseStores } from "./store-merge";

interface PluginDataLoadResult {
  recognizedStore: boolean;
  hasVaultId: boolean;
  sourceVersion: number;
  compatible: boolean;
}

export default class EntVaultCommandCenterPlugin extends Plugin {
  data: PluginData = structuredClone(DEFAULT_DATA);
  private store: PluginStore = createDefaultStore(this.data);
  private saveQueue: Promise<void> = Promise.resolve();
  private baseOperationBusy = false;
  private dataTransactionBusy = false;
  private externalReloadBusy = false;
  private externalReloadPending = false;
  private externalReloadPromise: Promise<void> | null = null;
  private dataEpoch = 0;
  private operationIdleResolvers: Array<() => void> = [];
  private refreshTimer: number | null = null;
  private recordsCache: VaultRecord[] | null = null;
  private recordsCacheReferenceKey = "";
  private recordLinkIndex = new Map<string, VaultRecord>();
  private backlinkIndex: Map<string, string[]> | null = null;
  private refreshShouldInvalidateRecords = false;
  dataCompatibilityWarning = "";

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.registerView(VIEW_TYPE, (leaf) => new EntVaultCommandCenterView(leaf, this));
    this.registerHoverLinkSource("ent-vault-command-center", {
      display: "Knowledge Base Command Center",
      defaultMod: false,
    });

    this.addRibbonIcon("library-big", "Open knowledge base command center", () => this.run(() => this.activateView()));
    this.addCommand({ id: "open-workspace", name: "Open workspace", callback: () => this.run(() => this.activateView()) });
    this.addCommand({ id: "add-or-create", name: "Add or create…", callback: () => void this.withView((view) => view.openAddActions()) });
    this.addCommand({ id: "manage-knowledge-index", name: "Manage index…", callback: () => void this.withView((view) => view.openIndexManager()) });
    this.addCommand({ id: "new-knowledge-base", name: "New knowledge base…", callback: () => new CreateKnowledgeBaseModal(this).open() });
    this.addCommand({ id: "switch-knowledge-base", name: "Switch knowledge base…", callback: () => new ManageKnowledgeBasesModal(this).open() });
    this.addCommand({ id: "manage-knowledge-bases", name: "Manage knowledge bases…", callback: () => new ManageKnowledgeBasesModal(this).open() });
    this.addCommand({ id: "export-import-center", name: "Open export / import center", callback: () => void this.withView((view) => view.openPortabilityCenter()) });
    this.addCommand({ id: "create-knowledge-note", name: "Create note from template or empty note…", callback: () => void this.withView((view) => view.startCreateKnowledgeNote()) });
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

    this.addSettingTab(new EntCommandCenterSettingsTab(this.app, this));
    // Registration happens once at plugin load, while the active index profile
    // can later change between generic and ENT presets. The view itself also
    // works for generic notes by falling back to their folder grouping.
    try {
      this.registerBasesView("ent-hierarchy", {
        name: "Knowledge hierarchy",
        icon: "folder-tree",
        factory: (controller, containerEl) => new EntHierarchyBasesView(controller, containerEl),
      });
    } catch (error) {
      console.warn("Knowledge Base Command Center: custom Bases view unavailable", error);
    }

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.metadataCache.on("changed", (file) => {
        // Backlinks include the whole vault, including notes outside the configured
        // index. Any metadata-link change can therefore invalidate that cache.
        this.backlinkIndex = null;
        if (this.isRelevant(file.path)) { this.invalidateRecordCache(); this.scheduleRefresh(); }
        else if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) this.scheduleRefresh(false);
      }));
      this.registerEvent(this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile)) return;
        this.backlinkIndex = null;
        if (this.isRelevant(file.path)) { this.invalidateRecordCache(); this.scheduleRefresh(); }
        else if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) this.scheduleRefresh(false);
      }));
      this.registerEvent(this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile)) return;
        this.backlinkIndex = null;
        if (this.isRelevant(file.path)) { this.invalidateRecordCache(); this.scheduleRefresh(); }
        else if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) this.scheduleRefresh(false);
      }));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile || file instanceof TFolder) {
          this.run(() => this.handleRename(oldPath, file.path, file instanceof TFolder));
        }
      }));
    });
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.activeWindow.clearTimeout(this.refreshTimer);
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

  private run(action: () => Promise<unknown>): void {
    void action().catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
  }

  private requireActiveBase(store = this.store): KnowledgeBaseEntry {
    const active = store.bases.find((entry) => entry.id === store.activeBaseId && entry.archivedAt === null);
    if (!active) throw new Error("The active knowledge base is unavailable.");
    return active;
  }

  private replaceActiveData(next: PluginData): void {
    const active = this.requireActiveBase();
    active.data = next;
    this.bumpEntryUpdatedAt(active);
    this.useActiveData(next);
  }

  private useActiveData(next: PluginData): void {
    if (this.data !== next) {
      this.data = next;
      this.dataEpoch += 1;
    }
  }

  private bumpEntryUpdatedAt(entry: KnowledgeBaseEntry, timestamp = Date.now()): void {
    entry.updatedAt = Math.max(timestamp, entry.updatedAt + 1);
  }

  async loadPluginData(persistMigration = true): Promise<PluginDataLoadResult> {
    let loaded: unknown = null;
    this.dataCompatibilityWarning = "";
    try {
      loaded = await this.loadData() as unknown;
    } catch (error) {
      // A syntactically invalid data.json must not stop the plugin from loading.
      // Start from defaults and refuse to save so the original file survives.
      this.useActiveData(structuredClone(DEFAULT_DATA));
      this.store = createDefaultStore(this.data);
      this.dataCompatibilityWarning = `Plugin data could not be parsed (${error instanceof Error ? error.message : String(error)}). Personal organization is read-only so the existing data.json is not overwritten; repair or remove that file to continue.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore: false, hasVaultId: false, sourceVersion: 0, compatible: false };
    }
    const sourceVersion = storedDataVersion(loaded);
    const loadedRecord = asUnknownRecord(loaded);
    const recognizedStore = isRecognizedPluginStore(loaded);
    const rawVaultId = typeof loadedRecord.vaultId === "string" ? loadedRecord.vaultId.trim() : "";
    const hadFinalVaultId = recognizedStore && Boolean(rawVaultId) && !isLegacyDeterministicMigratedVaultId(rawVaultId);
    if (sourceVersion === 0 && Object.keys(loadedRecord).length > 0 && !isRecognizedPluginData(loaded) && !recognizedStore) {
      this.useActiveData(structuredClone(DEFAULT_DATA));
      this.store = createDefaultStore(this.data);
      this.dataCompatibilityWarning = "Plugin data has an unrecognized shape. Personal organization is read-only so the original data is not overwritten; export or repair data.json before continuing.";
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore: false, hasVaultId: false, sourceVersion, compatible: false };
    }
    if (!recognizedStore && sourceVersion > DATA_VERSION && isRecognizedPluginData(loaded)) {
      this.useActiveData(migrateData(loaded));
      this.store = createDefaultStore(this.data);
      this.dataCompatibilityWarning = `Plugin data version ${sourceVersion} is newer than this build (v${DATA_VERSION}). Personal organization is read-only to prevent data loss.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore: false, hasVaultId: false, sourceVersion, compatible: false };
    }
    try {
      this.store = migrateStore(loaded);
      this.useActiveData(this.requireActiveBase().data);
    } catch (error) {
      this.useActiveData(structuredClone(DEFAULT_DATA));
      this.store = createDefaultStore(this.data);
      this.dataCompatibilityWarning = `Knowledge-base data could not be migrated (${error instanceof Error ? error.message : String(error)}). The existing data.json remains read-only and was not overwritten.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore, hasVaultId: hadFinalVaultId, sourceVersion, compatible: false };
    }
    if (recognizedStore && sourceVersion > STORE_VERSION) {
      this.dataCompatibilityWarning = `Plugin data version ${sourceVersion} is newer than this build (v${STORE_VERSION}). All knowledge bases are read-only to prevent data loss.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return { recognizedStore, hasVaultId: hadFinalVaultId, sourceVersion, compatible: false };
    }
    if (persistMigration && (!recognizedStore || !hadFinalVaultId || sourceVersion !== STORE_VERSION)) await this.saveStoreSnapshot();
    // A recognized interim deterministic identity is usable after migrateStore
    // rotates it in memory. External Sync can therefore reconcile it with a
    // concurrently rotated pristine copy instead of misclassifying it as flat
    // identity-less data.
    return { recognizedStore, hasVaultId: recognizedStore && Boolean(this.store.vaultId), sourceVersion, compatible: true };
  }

  async savePluginData(): Promise<void> {
    if (this.dataCompatibilityWarning) return;
    if (this.externalReloadBusy) {
      // An opaque PluginData snapshot cannot be safely merged with a synced
      // update to the same base: even a selection-only save could resurrect
      // stale collections or settings. Let the external file win atomically
      // and ask the user to repeat the overlapping local action instead.
      throw new Error("Knowledge-base data is reloading after a synced change. This overlapping edit was not saved; try it again now.");
    }
    // Bind the save to the base that owns `this.data` at call time. A user can
    // switch bases while a previous adapter write is still pending; resolving
    // the active base later inside the queue could otherwise attach one base's
    // data object to another base.
    const baseId = this.store.activeBaseId;
    const entry = this.store.bases.find((candidate) => candidate.id === baseId);
    if (!entry) throw new Error("The knowledge base being saved is unavailable.");
    entry.data = this.data;
    this.bumpEntryUpdatedAt(entry);
    await this.saveStoreSnapshot();
  }

  private async saveStoreSnapshot(allowDuringExternalReload = false): Promise<void> {
    if (this.dataCompatibilityWarning) return;
    if (this.externalReloadBusy && !allowDuringExternalReload) {
      throw new Error("Knowledge-base data is reloading after a synced change. This overlapping edit was not saved; try it again now.");
    }
    const snapshot = structuredClone(this.store);
    const save = async (): Promise<void> => {
      await this.saveData(snapshot);
    };
    const operation = this.saveQueue.then(save, save);
    this.saveQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  private waitForOperationsIdle(): Promise<void> {
    if (!this.baseOperationBusy && !this.dataTransactionBusy) return Promise.resolve();
    return new Promise((resolve) => this.operationIdleResolvers.push(resolve));
  }

  private announceOperationsIdle(): void {
    if (this.baseOperationBusy || this.dataTransactionBusy) return;
    const resolvers = this.operationIdleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  async onExternalSettingsChange(): Promise<void> {
    // Sync services may update data.json while an adapter save or base switch is
    // still in flight. Coalesce repeated callbacks, wait for the current local
    // transaction and queued write, then load the latest file on disk exactly
    // once more if another callback arrived during the reload.
    this.externalReloadPending = true;
    if (this.externalReloadPromise) return this.externalReloadPromise;
    const reload = async (): Promise<void> => {
      do {
        this.externalReloadPending = false;
        await this.waitForOperationsIdle();
        await this.saveQueue;
        const localStore = structuredClone(this.store);
        const preferredActiveId = this.store.activeBaseId;
        const localWarning = this.dataCompatibilityWarning;
        this.externalReloadBusy = true;
        try {
          const loaded = await this.loadPluginData(false);
          const incomingWarning = this.dataCompatibilityWarning;
          if (!loaded.compatible || incomingWarning) {
            this.store = localStore;
            this.useActiveData(this.requireActiveBase().data);
            this.dataCompatibilityWarning = incomingWarning || localWarning;
          } else if (!loaded.recognizedStore || !loaded.hasVaultId) {
            this.store = localStore;
            this.useActiveData(this.requireActiveBase().data);
            this.dataCompatibilityWarning = "Synced plugin data was written by an older build without a vault identity. Update Knowledge Base Command Center on the other device before editing; local bases remain read-only so neither copy is overwritten.";
            new Notice(this.dataCompatibilityWarning, 12000);
          } else {
            const incomingStore = this.store;
            try {
              const merged = mergeKnowledgeBaseStores(localStore, incomingStore, preferredActiveId);
              this.store = merged.store;
              this.useActiveData(this.requireActiveBase().data);
              this.dataCompatibilityWarning = "";
              if (merged.incomingNeedsWriteback) {
                try {
                  await this.saveStoreSnapshot(true);
                } catch (error) {
                  this.dataCompatibilityWarning = `Synced knowledge bases were merged in memory, but the merged data could not be saved (${error instanceof Error ? error.message : String(error)}). Organization is read-only; export each base before restarting Obsidian.`;
                  new Notice(this.dataCompatibilityWarning, 12000);
                }
              }
            } catch (error) {
              this.store = localStore;
              this.useActiveData(this.requireActiveBase().data);
              this.dataCompatibilityWarning = `Synced knowledge-base data could not be merged (${error instanceof Error ? error.message : String(error)}). Local bases remain read-only and no synced base was discarded.`;
              new Notice(this.dataCompatibilityWarning, 12000);
            }
          }
          this.invalidateRecordCache();
        } finally {
          this.externalReloadBusy = false;
        }
        await this.refreshViews(false);
      } while (this.externalReloadPending);
    };
    const operation = reload().finally(() => {
      if (this.externalReloadPromise === operation) this.externalReloadPromise = null;
    });
    this.externalReloadPromise = operation;
    return operation;
  }

  getKnowledgeBases(includeArchived = false): KnowledgeBaseEntry[] {
    return this.store.bases.filter((entry) => includeArchived || entry.archivedAt === null);
  }

  getActiveKnowledgeBase(): KnowledgeBaseEntry { return this.requireActiveBase(); }
  getActiveKnowledgeBaseId(): string { return this.store.activeBaseId; }
  getDataEpoch(): number { return this.dataEpoch; }
  getVaultId(): string { return this.store.vaultId; }

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

  private async commitBaseStoreChange(change: () => void): Promise<void> {
    this.assertDataWritable();
    if (this.baseOperationBusy) throw new Error("Another knowledge-base change is still being saved.");
    if (this.dataTransactionBusy) throw new Error("Finish the current organization change before switching knowledge bases.");
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before switching bases.");
    this.baseOperationBusy = true;
    try {
      // Let any earlier direct state save finish before changing activeBaseId.
      // New transactional edits are rejected while baseOperationBusy is true.
      await this.saveQueue;
      const backup = structuredClone(this.store);
      try {
        change();
        this.useActiveData(this.requireActiveBase().data);
        this.invalidateRecordCache();
        await this.saveStoreSnapshot();
      } catch (error) {
        this.store = backup;
        this.useActiveData(this.requireActiveBase().data);
        this.invalidateRecordCache();
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
    } finally {
      this.baseOperationBusy = false;
      this.announceOperationsIdle();
    }
  }

  async switchKnowledgeBase(id: string): Promise<void> {
    if (id === this.store.activeBaseId) return;
    const target = this.store.bases.find((entry) => entry.id === id && entry.archivedAt === null);
    if (!target) throw new Error("That knowledge base is unavailable.");
    await this.commitBaseStoreChange(() => { this.store.activeBaseId = target.id; });
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
      this.bumpEntryUpdatedAt(entry);
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
      entry.updatedAt = entry.archivedAt;
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
      this.bumpEntryUpdatedAt(entry);
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
    if (this.dataCompatibilityWarning) throw new Error(this.dataCompatibilityWarning);
  }

  isDataReadOnly(): boolean { return Boolean(this.dataCompatibilityWarning); }
  isClinicalMode(): boolean { return this.data.settings.workspaceMode === "ent-clinical"; }
  canVisuallyMoveAcrossGroups(): boolean { return !this.isClinicalMode() || this.data.settings.allowClinicalVisualGroupMoves; }

  invalidateRecordCache(): void {
    this.recordsCache = null;
    this.recordsCacheReferenceKey = "";
    this.recordLinkIndex.clear();
    this.backlinkIndex = null;
  }

  private referencedPaths(): Set<string> {
    const paths = new Set([...this.data.manualIndexPaths, ...this.data.pinnedPaths, ...this.data.nextStudyPaths]);
    for (const heading of this.data.collections) {
      for (const path of heading.subjects) paths.add(path);
      for (const subheading of heading.subheadings) {
        for (const path of subheading.subjects) paths.add(path);
      }
    }
    for (const subject of this.data.portableIndex.subjects) {
      const path = this.data.portableIndex.resolvedPathBySubjectId[subject.id];
      // A resolved library identity must stay discoverable even though it is
      // intentionally absent from the topic index. Otherwise a newly created
      // or linked generic note falls back to a false unresolved placeholder.
      if (path) paths.add(path);
    }
    return paths;
  }

  private recordDependencyKey(referenced: Set<string>): string {
    const settings = this.data.settings;
    return JSON.stringify({
      activeBaseId: this.store.activeBaseId,
      referenced: [...referenced].sort(),
      manual: [...this.data.manualIndexPaths].sort(),
      excluded: [...this.data.excludedIndexPaths].sort(),
      groups: Object.entries(this.data.indexGroupByPath).sort(([a], [b]) => a.localeCompare(b)),
      displayNames: Object.entries(this.data.displayNameByPath).sort(([a], [b]) => a.localeCompare(b)),
      groupAliases: Object.entries(this.data.indexGroupAliases).sort(([a], [b]) => a.localeCompare(b)),
      groupOrder: this.data.indexGroupOrder,
      settings: {
        workspaceMode: settings.workspaceMode,
        primaryFolder: settings.primaryFolder,
        proposalFolder: settings.proposalFolder,
        idProperty: settings.idProperty,
        groupProperty: settings.groupProperty,
        parentProperty: settings.parentProperty,
        allowClinicalVisualGroupMoves: settings.allowClinicalVisualGroupMoves,
      },
    });
  }

  private rebuildRecordLinkIndex(records: VaultRecord[]): void {
    this.recordLinkIndex.clear();
    for (const record of records) {
      const basename = record.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
      for (const value of [record.path.replace(/\.md$/i, ""), basename, record.title, ...record.aliases]) {
        const key = normalizeWikiLink(value).toLocaleLowerCase();
        if (key && !this.recordLinkIndex.has(key)) this.recordLinkIndex.set(key, record);
      }
    }
  }

  getRecords(): VaultRecord[] {
    const referenced = this.referencedPaths();
    const referenceKey = this.recordDependencyKey(referenced);
    if (this.recordsCache && referenceKey === this.recordsCacheReferenceKey) return this.recordsCache;
    const proposalFolder = normalizePath(this.data.settings.proposalFolder);
    const proposalRoot = proposalFolder ? `${proposalFolder}/` : "";
    const settings = this.data.settings;
    // Membership lookups run once per markdown file, so they must not be linear
    // scans of the manual/hidden arrays.
    const manual = new Set(this.data.manualIndexPaths);
    const excluded = new Set(this.data.excludedIndexPaths);
    const records: VaultRecord[] = [];
    const portableIdByPath = new Map<string, string>();
    const portableSubjectById = new Map(this.data.portableIndex.subjects.map((subject) => [subject.id, subject]));
    const portableGroupById = new Map(this.data.portableIndex.groups.map((group) => [group.id, group]));
    for (const [subjectId, path] of Object.entries(this.data.portableIndex.resolvedPathBySubjectId)) {
      if (path && !portableIdByPath.has(path)) portableIdByPath.set(path, subjectId);
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      let frontmatter: Record<string, unknown> = {};
      if (this.isClinicalMode()) frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
      const identity = this.identityForFile(file, frontmatter, referenced, proposalRoot, manual, excluded);
      if (!identity) continue;
      if (!this.isClinicalMode()) frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
      const { kind: detectedKind, role: detectedRole } = identity;
      const portableId = portableIdByPath.get(file.path);
      const portableSubject = portableId ? portableSubjectById.get(portableId) : undefined;
      const portableGroup = portableSubject ? portableGroupById.get(portableSubject.groupId)?.title ?? "" : "";
      const portableLibraryInGeneric = !this.isClinicalMode()
        && (portableSubject?.recordKind === "procedure"
          || portableSubject?.recordKind === "medication"
          || portableSubject?.recordKind === "syndrome");
      const role = portableLibraryInGeneric ? "library" : detectedRole;
      const entDomains = asStringList(frontmatter.ent_domains);
      const titleFallback = file.basename.replace(/^(Procedure|Drug|Syndrome)\s*-\s*/i, "");
      const configuredGroup = asStringList(frontmatter[settings.groupProperty])[0] ?? "";
      const visualGroup = this.canVisuallyMoveAcrossGroups() ? asText(this.data.indexGroupByPath[file.path]) : "";
      const configuredIdValue = frontmatter[settings.idProperty];
      const configuredId = typeof configuredIdValue === "number" ? String(configuredIdValue) : asText(configuredIdValue);
      const sourceDomain = detectedRole === "proposal"
        ? asText(frontmatter.proposed_domain, settings.inboxLabel)
        : detectedKind === "topic"
          ? configuredGroup || (this.isClinicalMode() ? asText(frontmatter.domain, cleanDomainFolder(file.path)) : configuredGroupFromPath(file.path, settings.primaryFolder))
          : detectedKind === "procedure"
            ? asText(frontmatter.domain, "Procedures")
            : detectedKind === "medication"
              ? entDomains[0] || "Medications"
              : detectedKind === "syndrome"
                ? entDomains[0] || asText(frontmatter.syndrome_group, "Syndromes")
                : asText(frontmatter.domain, file.parent?.path || "Vault notes");
      const domain = portableLibraryInGeneric
        ? portableGroup || sourceDomain
        : detectedKind === "topic"
          ? visualGroup || asText(this.data.indexGroupAliases[sourceDomain], sourceDomain)
          : sourceDomain;
      // A clinical proposal can safely back an imported index subject while it
      // awaits promotion. Project that one record into both the Inbox (by role)
      // and the index (by kind/portableIndexed) without changing the Markdown.
      const proposalBacksIndexedSubject = detectedKind === "proposal"
        && portableSubject?.recordKind === "topic"
        && portableSubject.indexed;
      const kind: RecordKind = proposalBacksIndexedSubject
        ? "topic"
        : portableSubject?.recordKind ?? detectedKind;
      const sourceTitle = asText(frontmatter.title, asText(frontmatter.canonical_name, titleFallback));
      const displayTitle = asText(this.data.displayNameByPath[file.path]);
      const aliases = asStringList(frontmatter.aliases);
      if (displayTitle && sourceTitle && displayTitle !== sourceTitle && !aliases.includes(sourceTitle)) aliases.push(sourceTitle);
      records.push({
        path: file.path,
        title: displayTitle || sourceTitle,
        ...(displayTitle ? { sourceTitle } : {}),
        kind,
        role,
        curriculumId: configuredId || (this.isClinicalMode() ? asText(frontmatter.curriculum_id) : ""),
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
          ? (this.isClinicalMode() ? asText(frontmatter.proposed_parent) : asText(frontmatter[settings.parentProperty]))
          : asText(frontmatter[settings.parentProperty], this.isClinicalMode() ? asText(frontmatter.parent_topic) : ""),
        imageStatus: asText(frontmatter.image_status),
        doseStatus: asText(frontmatter.dose_status),
        sourceCoverage: asText(frontmatter.source_coverage),
        folderOrder: kind === "topic" ? this.indexGroupSortKey(domain, file.path) : role === "proposal" ? "00" : "99",
        mtime: file.stat.mtime,
        aiLock: frontmatter.ai_lock === true,
        ...(portableId ? { portableId } : {}),
        ...(portableSubject ? { portableIndexed: portableSubject.indexed } : {}),
      });
    }
    const recordPaths = new Set(records.map((record) => record.path));
    for (const subject of this.data.portableIndex.subjects) {
      const resolvedPath = this.data.portableIndex.resolvedPathBySubjectId[subject.id] || "";
      if (resolvedPath && recordPaths.has(resolvedPath)) continue;
      const path = resolvedPath || portablePlaceholderPath(subject.id);
      if (recordPaths.has(path)) continue;
      const sourceGroup = portableGroupById.get(subject.groupId)?.title || "Ungrouped";
      const domain = (this.canVisuallyMoveAcrossGroups() ? asText(this.data.indexGroupByPath[path]) : "")
        || asText(this.data.indexGroupAliases[sourceGroup], sourceGroup);
      const displayTitle = asText(this.data.displayNameByPath[path]);
      records.push({
        path,
        title: displayTitle || subject.title,
        ...(displayTitle ? { sourceTitle: subject.title } : {}),
        kind: subject.indexed ? "topic" : subject.recordKind,
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
        folderOrder: this.indexGroupSortKey(domain, path),
        mtime: 0,
        aiLock: false,
        portableId: subject.id,
        isPlaceholder: true,
        portableIndexed: subject.indexed,
      });
      recordPaths.add(path);
    }
    records.sort((a, b) => a.role.localeCompare(b.role)
      || (a.curriculumId || "ZZZ").localeCompare(b.curriculumId || "ZZZ", undefined, { numeric: true })
      || a.title.localeCompare(b.title));
    this.recordsCache = records;
    this.recordsCacheReferenceKey = referenceKey;
    this.rebuildRecordLinkIndex(records);
    return records;
  }

  private identityForFile(
    file: TFile,
    frontmatter: Record<string, unknown>,
    referenced: Set<string>,
    proposalRoot: string,
    manual: Set<string>,
    excluded: Set<string>,
  ): { kind: RecordKind; role: RecordRole } | null {
    if (!this.isClinicalMode() && manual.has(file.path)) return { kind: "topic", role: "canonical" };
    if ((proposalRoot && file.path.startsWith(proposalRoot)) || (this.isClinicalMode() && frontmatter.type === "topic-proposal")) return { kind: "proposal", role: "proposal" };
    if (pathIsInsideFolder(file.path, this.data.settings.primaryFolder)) {
      if (excluded.has(file.path)) {
        return referenced.has(file.path) ? { kind: "note", role: "vault-note" } : null;
      }
      if (!this.isClinicalMode()) return { kind: "topic", role: "canonical" };
      return asText(frontmatter[this.data.settings.idProperty], asText(frontmatter.curriculum_id))
        ? { kind: "topic", role: "canonical" }
        : { kind: "topic", role: "supporting" };
    }
    if (this.isClinicalMode() && file.path.startsWith(PROCEDURE_ROOT) && file.basename.startsWith("Procedure - ")) return { kind: "procedure", role: "library" };
    if (this.isClinicalMode() && file.path.startsWith(MEDICATION_ROOT) && file.basename.startsWith("Drug - ")) return { kind: "medication", role: "library" };
    if (this.isClinicalMode() && file.path.startsWith(SYNDROME_ROOT) && file.basename.startsWith("Syndrome - ")) return { kind: "syndrome", role: "library" };
    return referenced.has(file.path) ? { kind: "note", role: "vault-note" } : null;
  }

  getRecord(path: string): VaultRecord | null { return this.getRecords().find((record) => record.path === path) ?? null; }
  getPortableSubject(subjectId: string) { return this.data.portableIndex.subjects.find((subject) => subject.id === subjectId) ?? null; }
  getPortableSubjectPath(subjectId: string): string { return portableSubjectPath(this.data, subjectId); }

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

  async restoreRecordsToIndex(paths: string[], label = "Restore subjects to this knowledge base"): Promise<void> {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) return;
    const portableIdByPath = new Map(Object.entries(this.data.portableIndex.resolvedPathBySubjectId).map(([id, path]) => [path, id]));
    await this.mutate(label, () => {
      for (const path of uniquePaths) {
        const portableId = this.getRecord(path)?.portableId ?? portableIdByPath.get(path);
        if (portableId) {
          const subject = this.getPortableSubject(portableId);
          if (subject) subject.indexed = true;
        }
        this.data.excludedIndexPaths = this.data.excludedIndexPaths.filter((candidate) => candidate !== path);
        if (!pathIsInsideFolder(path, this.data.settings.primaryFolder) && !this.data.manualIndexPaths.includes(path)) {
          this.data.manualIndexPaths.push(path);
        }
        delete this.data.indexGroupByPath[path];
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
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") throw new Error("Choose an existing Markdown note.");
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
      && subjectGroupTitle.trim().toLocaleLowerCase() !== candidateDomain.toLocaleLowerCase()) {
      throw new Error(`Clinical group mismatch: this subject belongs to ${subjectGroupTitle}, but the selected note belongs to ${candidateDomain}.`);
    }
    if (existingOwnerId && !mergeExistingIdentity) {
      throw new Error("That Markdown note already has a portable identity. Confirm identity reassignment before linking it to this subject.");
    }
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
    return this.getRecords().filter((record) => record.kind === "topic" && (record.role === "canonical"
      || record.role === "supporting"
      || (record.role === "placeholder" && record.portableIndexed !== false)
      || record.portableIndexed === true));
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

  async repairIndexOrganization(): Promise<void> {
    const existing = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    for (const subject of this.data.portableIndex.subjects) existing.add(portableSubjectPath(this.data, subject.id));
    const indexed = new Set(this.getIndexRecords().map((record) => record.path));
    const uniqueExisting = (paths: string[]): string[] => paths.filter((path, index, all) => existing.has(path) && all.indexOf(path) === index);
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
      for (const path of Object.keys(this.data.indexGroupByPath)) {
        if (!existing.has(path) || (!indexed.has(path) && !this.data.excludedIndexPaths.includes(path))) delete this.data.indexGroupByPath[path];
      }
      this.data.indexGroupOrder = [...new Set(this.data.indexGroupOrder.map((group) => group.trim()).filter(Boolean))];
      reconcileCurriculumVisual(this.data.curriculumVisual, this.getRecords(), this.data.indexGroupByPath);
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

  isRelevant(path: string): boolean {
    if (!this.data.settings.primaryFolder) return !pathIsInsideFolder(path, this.app.vault.configDir);
    const proposalFolder = normalizePath(this.data.settings.proposalFolder);
    const proposalRoot = proposalFolder ? `${proposalFolder}/` : "";
    const configuredRoots = [this.data.settings.primaryFolder, this.data.settings.proposalFolder]
      .filter(Boolean)
      .map((root) => `${normalizePath(root)}/`);
    const clinicalRoots = this.isClinicalMode() ? [PROCEDURE_ROOT, MEDICATION_ROOT, SYNDROME_ROOT, "07 Evidence Updates/"] : [];
    return [...configuredRoots, proposalRoot, ...clinicalRoots].filter(Boolean).some((root) => path.startsWith(root))
      || this.referencedPaths().has(path)
      || this.data.excludedIndexPaths.includes(path)
      || Object.getOwnPropertyDescriptor(this.data.indexGroupByPath, path) !== undefined;
  }

  async reconcileRecords(records: VaultRecord[]): Promise<boolean> {
    const valid = new Set(records.map((record) => record.path));
    const markdownPaths = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    let changed = false;
    for (const [subjectId, path] of Object.entries(this.data.portableIndex.resolvedPathBySubjectId)) {
      if (!path || markdownPaths.has(path)) continue;
      const placeholder = portablePlaceholderPath(subjectId);
      rewriteActivePluginDataPathPrefix(this.data, path, placeholder);
      delete this.data.portableIndex.resolvedPathBySubjectId[subjectId];
      changed = true;
    }
    const unique = (paths: string[]): string[] => [...new Set(paths)];
    const manual = unique(this.data.manualIndexPaths);
    const manualSet = new Set(manual);
    const excluded = unique(this.data.excludedIndexPaths).filter((path) => !manualSet.has(path));
    if (manual.length !== this.data.manualIndexPaths.length || manual.some((path, index) => path !== this.data.manualIndexPaths[index])) {
      this.data.manualIndexPaths = manual;
      changed = true;
    }
    if (excluded.length !== this.data.excludedIndexPaths.length || excluded.some((path, index) => path !== this.data.excludedIndexPaths[index])) {
      this.data.excludedIndexPaths = excluded;
      changed = true;
    }
    const groupOrder = [...new Set(this.data.indexGroupOrder.map((group) => group.trim()).filter(Boolean))];
    if (groupOrder.length !== this.data.indexGroupOrder.length || groupOrder.some((group, index) => group !== this.data.indexGroupOrder[index])) {
      this.data.indexGroupOrder = groupOrder;
      changed = true;
    }
    for (const heading of this.data.collections) {
      const next = unique(heading.subjects);
      if (next.length !== heading.subjects.length) { heading.subjects = next; changed = true; }
      for (const subheading of heading.subheadings) {
        const subNext = unique(subheading.subjects);
        if (subNext.length !== subheading.subjects.length) { subheading.subjects = subNext; changed = true; }
      }
    }
    const pins = unique(this.data.pinnedPaths);
    const nextStudy = unique(this.data.nextStudyPaths);
    if (pins.length !== this.data.pinnedPaths.length) { this.data.pinnedPaths = pins; changed = true; }
    if (nextStudy.length !== this.data.nextStudyPaths.length) { this.data.nextStudyPaths = nextStudy; changed = true; }
    if (!valid.has(this.data.selectedPath) && (!this.data.selectedPath || !markdownPaths.has(this.data.selectedPath))) {
      const fallback = records[0]?.path || "";
      if (fallback !== this.data.selectedPath) {
        this.data.selectedPath = fallback;
        changed = true;
      }
    }
    if (changed) { this.invalidateRecordCache(); await this.savePluginData(); }
    return changed;
  }

  async mutate(
    label: string,
    action: () => void,
    options: {
      includeSettings?: boolean;
      includePortableIndex?: boolean;
      includeLayoutSnapshots?: boolean;
      requireUndo?: boolean;
    } = {},
  ): Promise<void> {
    this.assertDataWritable();
    if (this.baseOperationBusy) throw new Error("Finish switching knowledge bases before changing its organization.");
    if (this.dataTransactionBusy) throw new Error("Another organization change is still being saved.");
    if (this.externalReloadBusy) throw new Error("Finish reloading synced knowledge-base data before changing its organization.");
    this.dataTransactionBusy = true;
    try {
      const transactionBackup = options.requireUndo ? structuredClone(this.data) : null;
      const snapshot = snapshotPersonal(
        this.data,
        label,
        options.includeSettings === true,
        options.includePortableIndex === true,
        options.includeLayoutSnapshots === true,
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
        await this.savePluginData();
      } catch (error) {
        if (transactionBackup) {
          this.replaceActiveData(transactionBackup);
          this.invalidateRecordCache();
          try {
            await this.savePluginData();
          } catch (rollbackError) {
            console.error("Knowledge Base Command Center could not persist the import rollback", rollbackError);
            throw new Error("The import failed and its rollback could not be saved. Restart Obsidian, then restore a same-vault recovery backup.");
          }
          try {
            await this.refreshViews(false);
          } catch (refreshError) {
            console.error("Knowledge Base Command Center restored a failed organization change but could not refresh its view", refreshError);
          }
        }
        throw error;
      }
      await this.refreshViews(false);
    } finally {
      this.dataTransactionBusy = false;
      this.announceOperationsIdle();
    }
  }

  async undo(): Promise<void> {
    this.assertDataWritable();
    const previous = this.data.undoStack.pop();
    if (!previous) return;
    this.data.redoStack = limitSnapshotStack([...this.data.redoStack, snapshotPersonal(
      this.data,
      previous.label,
      Boolean(previous.settings),
      Boolean(previous.portableIndex),
      Boolean(previous.layoutSnapshots),
    )]);
    restoreSnapshot(this.data, previous);
    this.invalidateRecordCache();
    await this.savePluginData();
    await this.refreshViews(false);
    new Notice(`Undid: ${previous.label}`);
  }

  async redo(): Promise<void> {
    this.assertDataWritable();
    const next = this.data.redoStack.pop();
    if (!next) return;
    this.data.undoStack = limitSnapshotStack([...this.data.undoStack, snapshotPersonal(
      this.data,
      next.label,
      Boolean(next.settings),
      Boolean(next.portableIndex),
      Boolean(next.layoutSnapshots),
    )]);
    restoreSnapshot(this.data, next);
    this.invalidateRecordCache();
    await this.savePluginData();
    await this.refreshViews(false);
    new Notice(`Redid: ${next.label}`);
  }

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

  async createKnowledgeNote(value: GenericNoteFormValue): Promise<TFile> {
    this.assertDataWritable();
    const validation = this.validateGenericNote(value);
    if (validation) throw new Error(validation);
    const path = normalizePath(genericNotePath(value.folder, value.title));
    const folder = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
    await this.ensureFolder(folder);
    let content = "";
    if (value.mode === "template") {
      const template = this.app.vault.getAbstractFileByPath(normalizePath(value.templatePath));
      if (!(template instanceof TFile)) throw new Error("The selected template could not be found.");
      const now = new Date();
      content = applyTemplateTokens(await this.app.vault.cachedRead(template), value.title, this.today(), now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }
    const file = await this.app.vault.create(path, content);
    this.invalidateRecordCache();
    return file;
  }

  getPortableJsonFiles(): TFile[] {
    return this.app.vault.getFiles()
      .filter((file) => file.extension.toLocaleLowerCase() === "json")
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async writePortableJson(kind: "backup" | "workspace" | "portable", value: unknown): Promise<TFile> {
    const folder = "Knowledge Base Command Center Exports";
    await this.ensureFolder(folder);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basePath = normalizePath(`${folder}/knowledge-base-command-center-${kind}-${stamp}`);
    let path = `${basePath}.json`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${basePath}-${suffix}.json`;
      suffix += 1;
    }
    const file = await this.app.vault.create(path, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  }

  async readPortableJson(file: TFile): Promise<unknown> {
    if (file.extension.toLocaleLowerCase() !== "json") throw new Error("Choose a JSON export file.");
    if (file.stat.size > MAX_PORTABLE_PACKAGE_BYTES) throw new Error("The selected JSON is larger than the 10 MB import limit.");
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
    await this.ensureFolder(path.substring(0, path.lastIndexOf("/")));
    const file = await this.app.vault.create(path, buildProposalMarkdown({
      title: value.title,
      domain: value.domain,
      parentPath: value.parentPath,
      parentTopic: this.parentWikiLink(value.parentPath),
      topicKind: value.topicKind,
      priority: value.priority,
      safetyCritical: value.safetyCritical,
    }, this.today()));
    this.invalidateRecordCache();
    await this.refreshViews();
    return file;
  }

  async createCanonical(value: TopicFormValue): Promise<TFile> {
    this.assertDataWritable();
    const validation = this.validateCanonical(value);
    if (validation) throw new Error(validation);
    const path = normalizePath(canonicalPath(value, this.data.settings.primaryFolder));
    await this.ensureFolder(path.substring(0, path.lastIndexOf("/")));
    const file = await this.app.vault.create(path, buildCanonicalMarkdown({
      title: value.title,
      domain: value.domain,
      curriculumId: value.curriculumId,
      parentTopic: this.parentWikiLink(value.parentPath),
      topicKind: value.topicKind,
      priority: value.priority,
      safetyCritical: value.safetyCritical,
    }, this.today()));
    this.invalidateRecordCache();
    await this.refreshViews();
    return file;
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
    let current = source;
    try {
      await this.ensureFolder(destination.substring(0, destination.lastIndexOf("/")));
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
      try {
        const rollbackFile = this.app.vault.getAbstractFileByPath(destination);
        if (rollbackFile instanceof TFile) {
          await this.app.vault.process(rollbackFile, () => originalContent);
          await this.app.fileManager.renameFile(rollbackFile, originalPath);
        }
      } catch (rollbackError) {
        console.error("ENT Command Center promotion rollback failed", rollbackError);
      }
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
    let current = source;
    try {
      if (destination !== originalPath) {
        await this.ensureFolder(destination.substring(0, destination.lastIndexOf("/")));
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
      try {
        const rollbackPath = destination === originalPath ? originalPath : destination;
        const rollbackFile = this.app.vault.getAbstractFileByPath(rollbackPath);
        if (rollbackFile instanceof TFile) {
          await this.app.vault.process(rollbackFile, () => originalContent);
          if (rollbackFile.path !== originalPath) await this.app.fileManager.renameFile(rollbackFile, originalPath);
        }
      } catch (rollbackError) {
        console.error("ENT Command Center placement rollback failed", rollbackError);
      }
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

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized) return;
    let built = "";
    for (const segment of normalized.split("/")) {
      built = built ? `${built}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(built);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`${built} exists but is not a folder.`);
      await this.app.vault.createFolder(built);
    }
  }

  private async handleRename(oldPath: string, newPath: string, folderRename = false): Promise<void> {
    // A vault rename is an all-base mutation. If Sync is replacing the store,
    // apply the path rewrite after that envelope has loaded rather than passing
    // it through savePluginData's active-base-only conflict merge.
    const pendingExternalReload = this.externalReloadPromise;
    if (pendingExternalReload) await pendingExternalReload;
    await this.waitForOperationsIdle();
    const historyDepths = this.store.bases.map((entry) => [entry.data.layoutSnapshots.length, entry.data.undoStack.length, entry.data.redoStack.length]);
    let changed = false;
    for (const entry of this.store.bases) {
      const pathsChanged = rewritePluginDataPathPrefix(entry.data, oldPath, newPath);
      const folderStateChanged = folderRename && rewritePluginDataFolderRename(entry.data, oldPath, newPath);
      const templatePathChanged = !folderRename && rewritePluginDataTemplatePathRename(entry.data, oldPath, newPath);
      const entryChanged = pathsChanged || folderStateChanged || templatePathChanged;
      if (entryChanged) {
        this.bumpEntryUpdatedAt(entry);
        changed = true;
      }
    }
    const boundedDepths = this.store.bases.map((entry) => [entry.data.layoutSnapshots.length, entry.data.undoStack.length, entry.data.redoStack.length]);
    this.invalidateRecordCache();
    if (changed) await this.saveStoreSnapshot();
    if (boundedDepths.some((depths, baseIndex) => depths.some((depth, stackIndex) => depth < (historyDepths[baseIndex]?.[stackIndex] ?? 0)))) {
      new Notice("Some saved organization history no longer fit the plugin data budget after the rename and was removed. Current organization was preserved.", 8000);
    }
    this.scheduleRefresh();
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

  private indexGroupSortKey(domain: string, path: string): string {
    if (this.isClinicalMode() && !this.data.settings.allowClinicalVisualGroupMoves
      && pathIsInsideFolder(path, this.data.settings.primaryFolder)) {
      const root = normalizePath(this.data.settings.primaryFolder);
      const relative = normalizePath(path).slice(root.length + 1);
      return relative.split("/")[0] || "99";
    }
    const index = this.data.indexGroupOrder.indexOf(domain);
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
