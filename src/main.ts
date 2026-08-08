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
  DATA_VERSION,
  DEFAULT_DATA,
  genericNotePath,
  GenericNoteFormValue,
  isImmutableSourcePath,
  isRecognizedPluginData,
  isRestrictedVaultPath,
  limitSnapshotStack,
  MEDICATION_ROOT,
  migrateData,
  normalizeWikiLink,
  pathIsInsideFolder,
  PluginData,
  PROCEDURE_ROOT,
  proposalPath,
  reconcileCurriculumVisual,
  RecordKind,
  RecordRole,
  restoreSnapshot,
  rewriteTopLevelHeading,
  rewritePluginDataPathPrefix,
  sanitizeFileName,
  snapshotPersonal,
  storedDataVersion,
  SYNDROME_ROOT,
  TopicFormValue,
  validateProposalFolderPath,
  validateWritableFolderPath,
  VaultRecord,
} from "./model";
import { EntCommandCenterSettingsTab } from "./settings";
import { EntVaultCommandCenterView, VIEW_TYPE } from "./view";

export default class EntVaultCommandCenterPlugin extends Plugin {
  data: PluginData = structuredClone(DEFAULT_DATA);
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
    if (this.isClinicalMode()) {
      try {
        this.registerBasesView("ent-hierarchy", {
          name: "ENT hierarchy (clinical preset)",
          icon: "folder-tree",
          factory: (controller, containerEl) => new EntHierarchyBasesView(controller, containerEl),
        });
      } catch (error) {
        console.warn("Knowledge Base Command Center: custom Bases view unavailable", error);
      }
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
        if (file instanceof TFile || file instanceof TFolder) this.run(() => this.handleRename(oldPath, file.path));
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

  async loadPluginData(): Promise<void> {
    let loaded: unknown = null;
    try {
      loaded = await this.loadData() as unknown;
    } catch (error) {
      // A syntactically invalid data.json must not stop the plugin from loading.
      // Start from defaults and refuse to save so the original file survives.
      this.data = structuredClone(DEFAULT_DATA);
      this.dataCompatibilityWarning = `Plugin data could not be parsed (${error instanceof Error ? error.message : String(error)}). Personal organization is read-only so the existing data.json is not overwritten; repair or remove that file to continue.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return;
    }
    const sourceVersion = storedDataVersion(loaded);
    this.data = migrateData(loaded);
    const loadedRecord = asUnknownRecord(loaded);
    if (sourceVersion === 0 && Object.keys(loadedRecord).length > 0 && !isRecognizedPluginData(loaded)) {
      this.dataCompatibilityWarning = "Plugin data has an unrecognized shape. Personal organization is read-only so the original data is not overwritten; export or repair data.json before continuing.";
      new Notice(this.dataCompatibilityWarning, 10000);
      return;
    }
    if (sourceVersion > DATA_VERSION) {
      this.dataCompatibilityWarning = `Plugin data version ${sourceVersion} is newer than this build (v${DATA_VERSION}). Personal organization is read-only to prevent data loss.`;
      new Notice(this.dataCompatibilityWarning, 10000);
      return;
    }
    if (sourceVersion !== DATA_VERSION) await this.savePluginData();
  }

  async savePluginData(): Promise<void> {
    if (this.dataCompatibilityWarning) return;
    await this.saveData(this.data);
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
    return paths;
  }

  private recordDependencyKey(referenced: Set<string>): string {
    const settings = this.data.settings;
    return JSON.stringify({
      referenced: [...referenced].sort(),
      manual: [...this.data.manualIndexPaths].sort(),
      excluded: [...this.data.excludedIndexPaths].sort(),
      groups: Object.entries(this.data.indexGroupByPath).sort(([a], [b]) => a.localeCompare(b)),
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
    for (const file of this.app.vault.getMarkdownFiles()) {
      let frontmatter: Record<string, unknown> = {};
      if (this.isClinicalMode()) frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
      const identity = this.identityForFile(file, frontmatter, referenced, proposalRoot, manual, excluded);
      if (!identity) continue;
      if (!this.isClinicalMode()) frontmatter = asUnknownRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
      const { kind, role } = identity;
      const entDomains = asStringList(frontmatter.ent_domains);
      const titleFallback = file.basename.replace(/^(Procedure|Drug|Syndrome)\s*-\s*/i, "");
      const configuredGroup = asStringList(frontmatter[settings.groupProperty])[0] ?? "";
      const visualGroup = this.canVisuallyMoveAcrossGroups() ? asText(this.data.indexGroupByPath[file.path]) : "";
      const configuredIdValue = frontmatter[settings.idProperty];
      const configuredId = typeof configuredIdValue === "number" ? String(configuredIdValue) : asText(configuredIdValue);
      const domain = role === "proposal"
        ? asText(frontmatter.proposed_domain, settings.inboxLabel)
        : kind === "topic"
          ? visualGroup || configuredGroup || (this.isClinicalMode() ? asText(frontmatter.domain, cleanDomainFolder(file.path)) : configuredGroupFromPath(file.path, settings.primaryFolder))
          : kind === "procedure"
            ? asText(frontmatter.domain, "Procedures")
            : kind === "medication"
              ? entDomains[0] || "Medications"
              : kind === "syndrome"
                ? entDomains[0] || asText(frontmatter.syndrome_group, "Syndromes")
                : asText(frontmatter.domain, file.parent?.path || "Vault notes");
      records.push({
        path: file.path,
        title: asText(frontmatter.title, asText(frontmatter.canonical_name, titleFallback)),
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
        aliases: asStringList(frontmatter.aliases),
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
      });
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
      if (!this.isClinicalMode() && excluded.has(file.path)) {
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
  getCanonicalTopics(): VaultRecord[] { return this.getRecords().filter((record) => record.role === "canonical"); }
  getIndexRecords(): VaultRecord[] { return this.getRecords().filter((record) => record.kind === "topic" && (record.role === "canonical" || record.role === "supporting")); }

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

  async reconcileRecords(records: VaultRecord[]): Promise<void> {
    const valid = new Set(records.map((record) => record.path));
    const markdownPaths = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    let changed = false;
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
  }

  async mutate(label: string, action: () => void): Promise<void> {
    this.assertDataWritable();
    const snapshot = snapshotPersonal(this.data, label);
    const undoStack = limitSnapshotStack([...this.data.undoStack, snapshot]);
    if (!undoStack.includes(snapshot)) new Notice("This change is too large for the bounded undo history. Export a backup before further bulk organization changes.", 8000);
    this.data.undoStack = undoStack;
    this.data.redoStack = [];
    action();
    await this.savePluginData();
    await this.refreshViews(false);
  }

  async undo(): Promise<void> {
    this.assertDataWritable();
    const previous = this.data.undoStack.pop();
    if (!previous) return;
    this.data.redoStack = limitSnapshotStack([...this.data.redoStack, snapshotPersonal(this.data, previous.label)]);
    restoreSnapshot(this.data, previous);
    await this.savePluginData();
    await this.refreshViews(false);
    new Notice(`Undid: ${previous.label}`);
  }

  async redo(): Promise<void> {
    this.assertDataWritable();
    const next = this.data.redoStack.pop();
    if (!next) return;
    this.data.undoStack = limitSnapshotStack([...this.data.undoStack, snapshotPersonal(this.data, next.label)]);
    restoreSnapshot(this.data, next);
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
      if (!value.templatePath) return "Choose a template, or switch the starting content to Empty note.";
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

  async writePortableJson(kind: "backup" | "workspace", value: unknown): Promise<TFile> {
    const folder = "Knowledge Base Command Center Exports";
    await this.ensureFolder(folder);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = normalizePath(`${folder}/knowledge-base-command-center-${kind}-${stamp}.json`);
    const file = await this.app.vault.create(path, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  }

  async readPortableJson(file: TFile): Promise<unknown> {
    if (file.extension.toLocaleLowerCase() !== "json") throw new Error("Choose a JSON export file.");
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
      const path = normalizePath(canonicalPath(value));
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
    const path = normalizePath(canonicalPath(value));
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
    const destination = normalizePath(canonicalPath(value));
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
    const destination = preserveCurrentPath ? source.path : normalizePath(canonicalPath(value));
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
    return `[[${parent.path.replace(/\.md$/, "").split("/").pop()}|${parent.title}]]`;
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

  private async handleRename(oldPath: string, newPath: string): Promise<void> {
    const historyDepths = [this.data.layoutSnapshots.length, this.data.undoStack.length, this.data.redoStack.length];
    const changed = rewritePluginDataPathPrefix(this.data, oldPath, newPath);
    const boundedDepths = [this.data.layoutSnapshots.length, this.data.undoStack.length, this.data.redoStack.length];
    this.invalidateRecordCache();
    if (changed) await this.savePluginData();
    if (boundedDepths.some((depth, index) => depth < (historyDepths[index] ?? 0))) {
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
    if (this.isClinicalMode() && !this.data.settings.allowClinicalVisualGroupMoves) return path.split("/")[1] ?? "99";
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
