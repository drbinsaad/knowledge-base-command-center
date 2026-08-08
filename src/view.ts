import { ItemView, Menu, Notice, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import { IndexManagerModal, type ManagerTab } from "./index-manager";
import {
  buildCurriculumTree,
  canonicalPath,
  curriculumChildPaths,
  countHeading,
  createPersonalBackup,
  curriculumDescendantPaths,
  CurriculumDomainTree,
  curriculumSiblingPaths,
  CurriculumTreeNode,
  CurriculumTreeResult,
  curriculumVisualHasChanges,
  emptyCurriculumTree,
  expectedParentCurriculumId,
  GenericNoteFormValue,
  groupRecordsByGroup,
  isExtensionCurriculumId,
  LayoutHeading,
  LayoutSubheading,
  limitSnapshotStack,
  MainTab,
  makeId,
  matchesParsedQuery,
  metadataHasGap,
  ParsedQuery,
  parseQuery,
  moveCurriculumVisual,
  pathIsInsideFolder,
  parsePersonalBackup,
  resolveExpectedParentPath,
  roleLabel,
  restoreSnapshot,
  resetCurriculumVisualPath,
  shouldHandleRowShortcut,
  snapshotPersonal,
  snapshotStackDepthIsTruncated,
  TopicFormValue,
  PluginSettings,
  unknownQueryTokens,
  validateWritableFolderPath,
  VaultRecord,
  visualPlacementPathSet,
} from "./model";
import {
  AddActionModal,
  CollectionPickerModal,
  collectionTargets,
  ConfirmModal,
  IndexGroupModal,
  KnowledgeNoteModal,
  RecordPickerModal,
  TextPromptModal,
  TopicEditorModal,
  VaultFilePickerModal,
  WorkspaceSetupModal,
} from "./modals";

export const VIEW_TYPE = "ent-vault-command-center-view";

interface Membership {
  headingId: string;
  subheadingId?: string;
}

interface DragMembership extends Membership {
  kind: "membership";
  path: string;
}

interface CurriculumDrag {
  kind: "curriculum-record";
  path: string;
}

interface QueueDefinition {
  id: string;
  title: string;
  description: string;
  records: VaultRecord[];
}

interface TabDefinition { id: MainTab; label: string; icon: string }

function tabDefinitions(settings: PluginSettings): TabDefinition[] {
  const tabs: TabDefinition[] = [
    { id: "curriculum", label: settings.indexLabel, icon: "library" },
    { id: "inbox", label: settings.inboxLabel, icon: "inbox" },
    { id: "collections", label: "My Collections", icon: "folders" },
    { id: "queues", label: "Smart Queues", icon: "list-checks" },
  ];
  if (settings.workspaceMode === "ent-clinical") tabs.push(
    { id: "procedures", label: "Procedures", icon: "clipboard-list" },
    { id: "medications", label: "Medications", icon: "pill" },
    { id: "syndromes", label: "Syndromes", icon: "dna" },
  );
  return tabs;
}

function iconButton(parent: HTMLElement, icon: string, label: string, className = ""): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: `ent-cc-icon-button ${className}`.trim(),
    attr: { "aria-label": label, title: label },
  });
  setIcon(button, icon);
  return button;
}

/** Marks a disclosure control so assistive technology can announce open/closed state. */
function disclosureButton(parent: HTMLElement, collapsed: boolean, label: string): HTMLButtonElement {
  const button = iconButton(parent, collapsed ? "chevron-right" : "chevron-down", `${collapsed ? "Expand" : "Collapse"} ${label}`, "ent-cc-disclosure");
  button.setAttribute("aria-expanded", String(!collapsed));
  return button;
}

function titleForTab(tab: MainTab, settings: PluginSettings): string {
  return tabDefinitions(settings).find((item) => item.id === tab)?.label ?? "Records";
}

function uniqueRecords(records: VaultRecord[]): VaultRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.path)) return false;
    seen.add(record.path);
    return true;
  });
}

function collectionPaths(collections: LayoutHeading[]): string[] {
  const paths: string[] = [];
  for (const heading of collections) {
    paths.push(...heading.subjects);
    for (const subheading of heading.subheadings) paths.push(...subheading.subjects);
  }
  return paths;
}

function queueRecords(queues: QueueDefinition[]): VaultRecord[] {
  const records: VaultRecord[] = [];
  for (const queue of queues) records.push(...queue.records);
  return records;
}

export class EntVaultCommandCenterView extends ItemView {
  private records: VaultRecord[] = [];
  private recordByPath = new Map<string, VaultRecord>();
  private curriculum: CurriculumTreeResult = emptyCurriculumTree();
  private query = "";
  private parsedQuery: ParsedQuery = parseQuery("");
  private searchDebounce: number | null = null;
  private setupTimer: number | null = null;
  private selectionSaveTimer: number | null = null;
  private selectionSavePromise: Promise<void> | null = null;
  private readonly timerWindow: Window = window.activeWindow ?? window;
  private editMode = false;
  private curriculumArrangeMode = false;
  private mobileInspectorOpen = false;
  private mobileInspectorNeedsFocus = false;
  private mobileTreeScrollTop = 0;
  private mobileInspectorScrollTop = 0;
  private workspaceEl: HTMLElement | null = null;
  private treeEl: HTMLElement | null = null;
  private inspectorEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private searchStatusEl: HTMLElement | null = null;
  private collapsedQueues = new Set<string>();
  private collapsedCurriculumDomains = new Set<string>();
  private collapsedCurriculumNodes = new Set<string>();
  private visualPlacementPaths = new Set<string>();
  private readonly viewInstanceId = makeId("view");
  private setupPromptShown = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: EntVaultCommandCenterPlugin) {
    super(leaf);
    this.collapsedQueues = new Set(plugin.data.collapsed.queues);
    this.collapsedCurriculumDomains = new Set(plugin.data.collapsed.curriculumDomains);
    this.collapsedCurriculumNodes = new Set(plugin.data.collapsed.curriculumNodes);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.plugin.data.settings.workspaceName; }
  getIcon(): string { return "library-big"; }

  async onOpen(): Promise<void> {
    await this.reload();
    if (!this.plugin.data.settings.setupComplete && !this.setupPromptShown) {
      this.setupPromptShown = true;
      this.setupTimer = this.timerWindow.setTimeout(() => {
        this.setupTimer = null;
        this.openSetupWizard();
      }, 100);
    }
  }

  async onClose(): Promise<void> {
    const selectionSavePending = this.selectionSaveTimer !== null;
    for (const timer of [this.setupTimer, this.searchDebounce, this.selectionSaveTimer]) {
      if (timer !== null) this.timerWindow.clearTimeout(timer);
    }
    this.setupTimer = null;
    this.searchDebounce = null;
    this.selectionSaveTimer = null;
    // A pending selection must still reach disk when the view closes.
    if (selectionSavePending || this.selectionSavePromise) {
      try {
        if (selectionSavePending) await this.saveSelectionState();
        else await this.selectionSavePromise;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async reload(): Promise<void> {
    this.records = this.plugin.getRecords();
    this.recordByPath = new Map(this.records.map((record) => [record.path, record]));
    await this.plugin.reconcileRecords(this.records);
    this.curriculum = buildCurriculumTree(this.records, this.plugin.data.curriculumVisual);
    this.render();
  }

  /** Runs a fire-and-forget action, surfacing failures (for example read-only data) as a Notice. */
  private run(action: () => Promise<unknown>): void {
    void action().catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
  }

  /** Serialize selection writes and expose the active write to onClose(). */
  private saveSelectionState(): Promise<void> {
    const previous = this.selectionSavePromise?.catch(() => undefined) ?? Promise.resolve();
    const save = previous.then(() => this.plugin.savePluginData());
    this.selectionSavePromise = save;
    return save.finally(() => {
      if (this.selectionSavePromise === save) this.selectionSavePromise = null;
    });
  }

  private persistCollapseState(): void {
    this.plugin.data.collapsed = {
      curriculumDomains: [...this.collapsedCurriculumDomains],
      curriculumNodes: [...this.collapsedCurriculumNodes],
      queues: [...this.collapsedQueues],
    };
    this.run(() => this.plugin.savePluginData());
  }

  public openAddActions(): void {
    const settings = this.plugin.data.settings;
    const actions = [
      { id: "create-note", title: `Create ${settings.itemSingular}`, description: "Start with an empty note or choose a Markdown template and destination folder.", icon: "file-plus-2" },
      ...(!this.plugin.isClinicalMode() ? [{ id: "index-existing", title: `Add existing note to ${settings.indexLabel}`, description: `Index any eligible Markdown note without moving or editing its file.`, icon: "list-plus" }] : []),
      { id: "existing-topic", title: `Add indexed ${settings.itemSingular}`, description: `Choose from ${settings.indexLabel} and place it under any collection heading or subheading.`, icon: "library" },
      { id: "vault-note", title: "Link an existing vault note", description: "Add a Markdown note to a collection without moving or modifying the note.", icon: "file-plus-2" },
      { id: "current-note", title: "Add current note", description: "Place the currently open note in a collection.", icon: "panel-top" },
    ];
    if (this.plugin.isClinicalMode()) actions.push({ id: "proposal", title: "Create topic proposal", description: "Capture an unverified clinical scaffold in the Topic Inbox for later promotion.", icon: "inbox" });
    else actions.push({ id: "inbox-note", title: `Create in ${settings.inboxLabel}`, description: "Create an empty or template-based note directly in the configured Inbox folder.", icon: "inbox" });
    if (this.plugin.isClinicalMode() && settings.enableAdvancedCanonicalActions) {
      actions.push(
        { id: "canonical", title: "Create canonical topic (advanced)", description: "Create an empty unverified topic directly at a validated curriculum ID and path.", icon: "shield-alert" },
        { id: "any-note", title: "Link any Markdown note (advanced)", description: "Include normally restricted areas in the picker; the note is still never moved or edited.", icon: "file-lock-2" },
      );
    }
    new AddActionModal(this.app, actions, (action) => {
      if (action.id === "create-note") this.startCreateKnowledgeNote();
      else if (action.id === "index-existing") this.startAddExistingToIndex();
      else if (action.id === "existing-topic") this.startAddExistingTopic();
      else if (action.id === "vault-note") this.startLinkVaultNote(false);
      else if (action.id === "current-note") this.startAddCurrentNote();
      else if (action.id === "proposal") this.startCreateProposal();
      else if (action.id === "inbox-note") this.startCreateKnowledgeNote({ folder: settings.proposalFolder }, false);
      else if (action.id === "canonical") this.startCreateCanonical();
      else if (action.id === "any-note") this.startLinkVaultNote(true);
    }, `Add to ${settings.workspaceName}`).open();
  }

  public openIndexManager(initialTab: ManagerTab = "indexed"): void {
    new IndexManagerModal(this.plugin, initialTab).open();
  }

  public startCreateKnowledgeNote(initial: Partial<GenericNoteFormValue> = {}, indexAfterCreate = !this.plugin.isClinicalMode()): void {
    const settings = this.plugin.data.settings;
    new KnowledgeNoteModal(this.app, {
      itemSingular: settings.itemSingular,
      templates: this.plugin.getTemplateFiles(),
      initial: {
        title: initial.title ?? "",
        folder: initial.folder ?? settings.defaultNoteFolder,
        mode: initial.mode ?? settings.defaultNewNoteMode,
        templatePath: initial.templatePath ?? settings.defaultTemplatePath,
        addToCollection: initial.addToCollection ?? false,
      },
      validate: (value) => this.plugin.validateGenericNote(value),
      onSubmit: async (value) => {
        const file = await this.plugin.createKnowledgeNote(value);
        if (indexAfterCreate && !this.plugin.isClinicalMode()) {
          await this.plugin.mutate(`Add created ${settings.itemSingular} to ${settings.indexLabel}`, () => {
            this.plugin.data.excludedIndexPaths = this.plugin.data.excludedIndexPaths.filter((path) => path !== file.path);
            if (!pathIsInsideFolder(file.path, settings.primaryFolder) && !this.plugin.data.manualIndexPaths.includes(file.path)) {
              this.plugin.data.manualIndexPaths.push(file.path);
            }
            this.plugin.data.selectedPath = file.path;
          });
        } else {
          this.plugin.data.selectedPath = file.path;
          await this.plugin.savePluginData();
          await this.reload();
        }
        new Notice(`${settings.itemSingular[0]?.toUpperCase() ?? "N"}${settings.itemSingular.slice(1)} created${indexAfterCreate && !this.plugin.isClinicalMode() ? ` and added to ${settings.indexLabel}` : ""}. Existing notes were not changed.`);
        if (value.addToCollection) this.openCollectionPicker(file.path);
        await this.plugin.openFile(file);
      },
    }).open();
  }

  public openSetupWizard(): void {
    const settings = this.plugin.data.settings;
    new WorkspaceSetupModal(this.app, settings, async (value) => {
      this.plugin.assertDataWritable();
      for (const folder of [value.primaryFolder, value.defaultNoteFolder, value.templatesFolder, value.proposalFolder]) {
        const error = validateWritableFolderPath(folder, this.app.vault.configDir);
        if (error) throw new Error(error);
      }
      if (value.defaultNewNoteMode === "template") {
        const template = this.app.vault.getAbstractFileByPath(value.defaultTemplatePath);
        if (!(template instanceof TFile)) throw new Error("The selected default template could not be found.");
      }
      Object.assign(settings, value, { setupComplete: true, workspaceMode: "generic" });
      await this.plugin.savePluginData();
      await this.plugin.refreshViews();
      new Notice(`${settings.workspaceName} is ready. No existing note was modified.`);
    }).open();
  }

  public startAddExistingTopic(): void {
    const topics = this.plugin.getIndexRecords();
    const settings = this.plugin.data.settings;
    new RecordPickerModal(this.app, topics, `Add indexed ${settings.itemSingular}`, `Search title, ID, ${settings.groupLabel.toLowerCase()}, or path…`, (record) => {
      this.openCollectionPicker(record.path);
    }).open();
  }

  public startAddExistingToIndex(): void {
    if (this.plugin.isClinicalMode()) {
      new Notice("Manual index membership is available in the generic knowledge-base profile.");
      return;
    }
    const files = this.plugin.getIndexCandidateFiles();
    const settings = this.plugin.data.settings;
    if (files.length === 0) {
      new Notice(`Every eligible Markdown note is already in ${settings.indexLabel}.`);
      return;
    }
    new VaultFilePickerModal(this.app, files, `Add existing note to ${settings.indexLabel}`, async (file) => {
      new IndexGroupModal(this.app, {
        title: `Place “${file.basename}” in ${settings.indexLabel}`,
        groupLabel: settings.groupLabel,
        initialValue: this.plugin.suggestedIndexGroup(file),
        existingGroups: this.plugin.getIndexGroups(),
        submitLabel: `Add to ${settings.indexLabel}`,
        onSubmit: async (group) => {
          await this.plugin.mutate(`Add “${file.basename}” to ${settings.indexLabel}`, () => {
            this.plugin.data.excludedIndexPaths = this.plugin.data.excludedIndexPaths.filter((path) => path !== file.path);
            if (!pathIsInsideFolder(file.path, settings.primaryFolder) && !this.plugin.data.manualIndexPaths.includes(file.path)) {
              this.plugin.data.manualIndexPaths.push(file.path);
            }
            this.plugin.data.indexGroupByPath[file.path] = group;
            this.plugin.data.selectedPath = file.path;
          });
          new Notice(`Added to ${settings.indexLabel} under ${group}. The note stayed at ${file.path}.`);
        },
      }).open();
    }).open();
  }

  public startLinkVaultNote(includeRestricted = false): void {
    new VaultFilePickerModal(this.app, this.plugin.getVaultNoteFiles(includeRestricted), includeRestricted ? "Link any Markdown note (advanced)" : "Link an existing vault note", (file) => {
      this.openCollectionPicker(file.path);
    }).open();
  }

  public startAddCurrentNote(explicitPath?: string): void {
    const file = explicitPath ? this.app.vault.getAbstractFileByPath(explicitPath) : this.app.workspace.getActiveFile();
    if (explicitPath && !(file instanceof TFile)) {
      new Notice("The previously active Markdown note could not be found.");
      return;
    }
    if (!file) {
      new Notice("Open a Markdown note first, then run add current note.");
      return;
    }
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") {
      new Notice("Only Markdown notes can be added to collections. Open a .md note first.");
      return;
    }
    this.openCollectionPicker(file.path);
  }

  public startCreateProposal(initial: Partial<TopicFormValue> = {}): void {
    new TopicEditorModal(this.app, {
      mode: "proposal",
      title: "Create topic proposal",
      submitLabel: "Create in Topic Inbox",
      proposalFolder: this.plugin.data.settings.proposalFolder,
      canonicalRecords: this.plugin.getCanonicalTopics(),
      initial,
      validate: (value) => this.plugin.validateProposal(value),
      onSubmit: async (value) => {
        const file = await this.plugin.createProposal(value);
        this.plugin.data.activeTab = "inbox";
        this.plugin.data.selectedPath = file.path;
        await this.plugin.savePluginData();
        await this.reload();
        new Notice("Topic proposal created as unverified in the inbox.");
        if (value.addToCollection) this.openCollectionPicker(file.path);
      },
    }).open();
  }

  public startCreateCanonical(initial: Partial<TopicFormValue> = {}): void {
    if (!this.plugin.data.settings.enableAdvancedCanonicalActions) {
      new Notice("Advanced canonical actions are disabled in settings.");
      return;
    }
    new TopicEditorModal(this.app, {
      mode: "canonical",
      title: "Create canonical topic — advanced",
      submitLabel: "Create unverified canonical topic",
      proposalFolder: this.plugin.data.settings.proposalFolder,
      canonicalRecords: this.plugin.getCanonicalTopics(),
      initial,
      validate: (value) => this.plugin.validateCanonical(value),
      resolveExpectedParentPath: (value) => resolveExpectedParentPath(value.curriculumId, value.domain, this.plugin.getCanonicalTopics()),
      onSubmit: async (value) => {
        const file = await this.plugin.createCanonical(value);
        this.plugin.data.activeTab = "curriculum";
        this.plugin.data.selectedPath = file.path;
        await this.plugin.savePluginData();
        await this.reload();
        new Notice("Canonical scaffold created with review_status: unverified.");
        if (value.addToCollection) this.openCollectionPicker(file.path);
      },
    }).open();
  }

  public startPromoteProposal(input?: VaultRecord): void {
    const record = input ?? this.recordByPath.get(this.plugin.data.selectedPath);
    if (!record || record.role !== "proposal") {
      new Notice("Select a topic inbox proposal first.");
      return;
    }
    if (record.aiLock) {
      new Notice("This proposal has AI lock enabled and cannot be promoted.");
      return;
    }
    new TopicEditorModal(this.app, {
      mode: "promote",
      title: `Promote “${record.title}”`,
      submitLabel: "Promote as unverified topic",
      proposalFolder: this.plugin.data.settings.proposalFolder,
      canonicalRecords: this.plugin.getCanonicalTopics(),
      initial: {
        title: record.title,
        domain: record.domain,
        parentPath: this.parentPathFor(record),
        topicKind: record.topicKind,
        priority: record.priority || "P2",
        safetyCritical: record.safetyCritical,
        addToCollection: false,
      },
      validate: (value) => this.plugin.validateCanonical(value, record.path),
      resolveExpectedParentPath: (value) => resolveExpectedParentPath(value.curriculumId, value.domain, this.plugin.getCanonicalTopics()),
      previewDetails: (value) => this.promotionPreviewDetails(record, value),
      onSubmit: async (value) => {
        const file = await this.plugin.promoteProposal(record.path, value);
        this.plugin.data.activeTab = "curriculum";
        this.plugin.data.selectedPath = file.path;
        await this.plugin.savePluginData();
        await this.reload();
        new Notice("Proposal promoted. It remains unverified pending human review.");
      },
    }).open();
  }

  public startEditCanonicalPlacement(input?: VaultRecord): void {
    const record = input ?? this.recordByPath.get(this.plugin.data.selectedPath);
    if (!record || record.role !== "canonical") {
      new Notice("Select a canonical topic first.");
      return;
    }
    if (!this.plugin.data.settings.enableAdvancedCanonicalActions) {
      new Notice("Advanced canonical actions are disabled in settings.");
      return;
    }
    if (record.aiLock) {
      new Notice("This note has AI lock enabled and cannot be changed.");
      return;
    }
    new TopicEditorModal(this.app, {
      mode: "placement",
      title: `Edit placement for “${record.title}”`,
      submitLabel: "Apply structural placement",
      proposalFolder: this.plugin.data.settings.proposalFolder,
      canonicalRecords: this.plugin.getCanonicalTopics(),
      initial: {
        title: record.title,
        domain: record.domain,
        parentPath: this.parentPathFor(record),
        topicKind: record.topicKind,
        priority: record.priority || "P2",
        safetyCritical: record.safetyCritical,
        curriculumId: record.curriculumId,
        addToCollection: false,
      },
      validate: (value) => this.plugin.validateCanonical(value, record.path),
      resolveExpectedParentPath: (value) => resolveExpectedParentPath(value.curriculumId, value.domain, this.plugin.getCanonicalTopics()),
      onSubmit: async (value) => {
        const file = await this.plugin.editCanonicalPlacement(record.path, value);
        this.plugin.data.selectedPath = file.path;
        await this.plugin.savePluginData();
        await this.reload();
        new Notice("Canonical placement updated; review status was preserved.");
      },
    }).open();
  }

  private parentPathFor(record: VaultRecord): string {
    return record.parentTopic ? this.plugin.resolveLink(record.parentTopic, record.path, this.recordByPath)?.path ?? "" : "";
  }

  private promotionPreviewDetails(record: VaultRecord, value: TopicFormValue): string[] {
    const parent = this.plugin.getCanonicalTopics().find((candidate) => candidate.path === value.parentPath);
    return [
      `Move from ${record.path}`,
      `Move to ${canonicalPath(value) || "Choose a valid destination"}`,
      `Curriculum placement: ${value.curriculumId || "ID required"}${parent ? ` under ${parent.curriculumId}` : ""}`,
      `Preserve ${record.sourceCount} source entr${record.sourceCount === 1 ? "y" : "ies"}; review_status stays unverified`,
      `Preserve ${this.plugin.countMemberships(record.path)} collection membership(s); ${this.plugin.getBacklinkPaths(record.path).length} backlink source(s) detected`,
    ];
  }

  private render(): void {
    const compact = this.isCompactInspectorLayout();
    if (compact && this.mobileInspectorOpen) {
      const currentBody = this.inspectorEl?.querySelector<HTMLElement>(".ent-cc-inspector-body");
      if (currentBody) this.mobileInspectorScrollTop = currentBody.scrollTop;
      this.mobileInspectorNeedsFocus = true;
    } else if (!compact) {
      this.mobileInspectorOpen = false;
      this.mobileInspectorNeedsFocus = false;
    }
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-view");
    const shell = this.contentEl.createDiv({ cls: "ent-cc-shell" });

    if (compact && this.mobileInspectorOpen && !this.recordByPath.has(this.plugin.data.selectedPath)) {
      this.mobileInspectorOpen = false;
      this.mobileInspectorNeedsFocus = false;
    }

    if (this.plugin.dataCompatibilityWarning) {
      shell.createDiv({ cls: "ent-cc-compatibility-warning", text: this.plugin.dataCompatibilityWarning, attr: { role: "alert" } });
    }

    if (compact && this.mobileInspectorOpen && this.recordByPath.has(this.plugin.data.selectedPath)) {
      shell.addClass("is-inspector-route");
      this.workspaceEl = null;
      this.treeEl = null;
      this.createInspector(shell);
      this.renderInspector();
      return;
    }

    const header = shell.createDiv({ cls: "ent-cc-header" });
    const titleBlock = header.createDiv({ cls: "ent-cc-title-block" });
    titleBlock.createDiv({ cls: "ent-cc-kicker", text: "Knowledge operations" });
    titleBlock.createEl("h1", { text: this.plugin.data.settings.workspaceName });
    titleBlock.createEl("p", { text: this.plugin.data.settings.workspaceSubtitle });
    const health = titleBlock.createDiv({ cls: "ent-cc-health-summary", attr: { "aria-label": "Vault knowledge summary" } });
    const canonicalCount = this.records.filter((record) => record.role === "canonical").length;
    const supportingCount = this.records.filter((record) => record.role === "supporting").length;
    const reviewedCount = this.records.filter((record) => record.reviewStatus === "reviewed").length;
    const proposalCount = this.records.filter((record) => record.role === "proposal").length;
    if (this.plugin.isClinicalMode()) {
      health.createSpan({ text: `${canonicalCount} canonical` });
      health.createSpan({ text: `${supportingCount} supporting` });
      health.createSpan({ text: `${reviewedCount} human-reviewed` });
      health.createSpan({ text: `${proposalCount} inbox` });
    } else {
      health.createSpan({ text: `${canonicalCount + supportingCount} indexed` });
      health.createSpan({ text: `${proposalCount} inbox` });
      health.createSpan({ text: `${this.plugin.data.collections.length} collections` });
      health.createSpan({ text: `${this.plugin.data.pinnedPaths.length} pinned` });
    }

    const actions = header.createDiv({ cls: "ent-cc-header-actions" });
    if (!this.plugin.data.settings.setupComplete) {
      const setup = actions.createEl("button", { cls: "ent-cc-button ent-cc-add-button" });
      setIcon(setup.createSpan(), "settings-2");
      setup.createSpan({ text: "Set up" });
      setup.addEventListener("click", () => this.openSetupWizard());
    }
    const globalAdd = actions.createEl("button", { cls: "ent-cc-button ent-cc-add-button" });
    setIcon(globalAdd.createSpan(), "plus");
    globalAdd.createSpan({ text: "Add" });
    globalAdd.addEventListener("click", () => this.openAddActions());
    if (this.plugin.data.activeTab === "curriculum") {
      const manage = actions.createEl("button", { cls: "ent-cc-button" });
      setIcon(manage.createSpan(), "list-tree");
      manage.createSpan({ text: "Manage" });
      manage.addEventListener("click", () => this.openIndexManager());
      const arrange = actions.createEl("button", { cls: `ent-cc-button ${this.curriculumArrangeMode ? "is-active" : ""}` });
      setIcon(arrange.createSpan(), this.curriculumArrangeMode ? "check" : "move");
      arrange.createSpan({ text: this.curriculumArrangeMode ? "Done" : "Arrange" });
      arrange.addEventListener("click", () => {
        this.curriculumArrangeMode = !this.curriculumArrangeMode;
        this.render();
      });
    }
    if (this.plugin.data.activeTab === "collections") {
      const add = actions.createEl("button", { cls: "ent-cc-button" });
      setIcon(add.createSpan(), "folder-plus");
      add.createSpan({ text: "New collection" });
      add.addEventListener("click", () => this.promptNewCollection());
      const edit = actions.createEl("button", { cls: `ent-cc-button ${this.editMode ? "is-active" : ""}` });
      setIcon(edit.createSpan(), "pencil");
      edit.createSpan({ text: this.editMode ? "Finish" : "Edit" });
      edit.addEventListener("click", () => { this.editMode = !this.editMode; this.render(); });
    }
    const undo = iconButton(actions, "undo-2", "Undo personal organization change", "ent-cc-history-action");
    undo.disabled = this.plugin.data.undoStack.length === 0;
    undo.addEventListener("click", () => this.run(() => this.plugin.undo()));
    const redo = iconButton(actions, "redo-2", "Redo personal organization change", "ent-cc-history-action");
    redo.disabled = this.plugin.data.redoStack.length === 0;
    redo.addEventListener("click", () => this.run(() => this.plugin.redo()));
    iconButton(actions, "ellipsis-vertical", "Command center actions").addEventListener("click", (event) => this.showGlobalMenu(event));

    this.renderTabs(shell);
    this.renderSearch(shell);

    const workspace = shell.createDiv({ cls: "ent-cc-workspace" });
    this.workspaceEl = workspace;
    const panelId = `ent-cc-record-panel-${this.viewInstanceId}`;
    this.treeEl = workspace.createDiv({
      cls: "ent-cc-tree-panel",
      attr: { id: panelId, role: "tabpanel", "aria-labelledby": this.tabElementId(this.plugin.data.activeTab), tabindex: "0" },
    });
    this.renderTree();
    if (!compact) {
      this.createInspector(workspace);
      this.renderInspector();
    } else {
      this.inspectorEl = null;
    }

    const footer = shell.createDiv({ cls: "ent-cc-footer" });
    setIcon(footer.createSpan(), "shield-check");
    footer.createSpan({ text: this.plugin.isClinicalMode()
      ? "Personal organization stays separate. New clinical scaffolds are unverified and never set review approval."
      : "Personal organization and visual hierarchy stay in plugin data. Index actions never move or rewrite source notes." });
  }

  private createInspector(parent: HTMLElement): void {
    this.inspectorEl = parent.createEl("aside", {
      cls: "ent-cc-inspector",
      attr: { "aria-label": "Selected knowledge record" },
    });
    this.inspectorEl.addEventListener("keydown", (event) => this.handleMobileInspectorKeydown(event));
  }

  private renderTabs(parent: HTMLElement): void {
    const tabs = tabDefinitions(this.plugin.data.settings);
    const bar = parent.createDiv({ cls: "ent-cc-tabs", attr: { role: "tablist", "aria-label": "Command center sections" } });
    for (const tab of tabs) {
      const button = bar.createEl("button", {
        cls: `ent-cc-tab ${this.plugin.data.activeTab === tab.id ? "is-active" : ""}`,
        attr: {
          id: this.tabElementId(tab.id),
          role: "tab",
          "data-tab": tab.id,
          "aria-selected": String(this.plugin.data.activeTab === tab.id),
          "aria-controls": `ent-cc-record-panel-${this.viewInstanceId}`,
          tabindex: this.plugin.data.activeTab === tab.id ? "0" : "-1",
        },
      });
      setIcon(button.createSpan(), tab.icon);
      button.createSpan({ text: tab.label });
      button.createSpan({ text: String(this.tabCount(tab.id)), cls: "ent-cc-tab-count" });
      button.addEventListener("click", () => this.run(() => this.changeTab(tab.id)));
      button.addEventListener("keydown", (event) => {
        const index = tabs.findIndex((candidate) => candidate.id === tab.id);
        const nextIndex = event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : event.key === "ArrowRight" ? (index + 1) % tabs.length
              : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
                : -1;
        if (nextIndex < 0) return;
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        if (nextTab) this.run(() => this.changeTab(nextTab.id, true));
      });
    }
    this.revealActiveTab(bar);
  }

  private revealActiveTab(tablist: HTMLElement): void {
    this.timerWindow.setTimeout(() => {
      const active = tablist.querySelector<HTMLElement>('[aria-selected="true"]');
      active?.scrollIntoView({ block: "nearest", inline: "center" });
    }, 0);
  }

  private tabElementId(tab: MainTab): string {
    return `ent-cc-tab-${tab}-${this.viewInstanceId}`;
  }

  private async changeTab(tab: MainTab, focusTab = false): Promise<void> {
    this.plugin.data.activeTab = tab;
    this.editMode = false;
    this.curriculumArrangeMode = false;
    await this.plugin.savePluginData();
    this.render();
    if (focusTab) this.contentEl.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
  }

  private tabCount(tab: MainTab): number {
    if (tab === "curriculum") return this.records.filter((record) => record.kind === "topic" && (record.role === "canonical" || record.role === "supporting")).length;
    if (tab === "inbox") return this.records.filter((record) => record.role === "proposal").length;
    if (tab === "collections") return new Set(collectionPaths(this.plugin.data.collections)).size;
    if (tab === "queues") return uniqueRecords(queueRecords(this.smartQueues())).length;
    return this.records.filter((record) => record.kind === tab.slice(0, -1)).length;
  }

  private renderSearch(parent: HTMLElement): void {
    const searchRow = parent.createDiv({ cls: "ent-cc-search-row" });
    const box = searchRow.createDiv({ cls: "ent-cc-search-box" });
    let bulkButton: HTMLButtonElement | null = null;
    setIcon(box.createSpan({ cls: "ent-cc-search-icon" }), "search");
    const input = box.createEl("input", {
      type: "search",
      value: this.query,
      placeholder: this.plugin.isClinicalMode()
        ? "Search…  domain:pediatric  priority:P1  source:gap  type:procedure"
        : `Search ${this.plugin.data.settings.itemPlural}, IDs, ${this.plugin.data.settings.groupLabel.toLowerCase()}, or paths…`,
      attr: { "aria-label": `Search and filter ${this.plugin.data.settings.itemPlural}` },
    });
    input.addEventListener("input", () => {
      this.query = input.value;
      // Commands available during the debounce window must observe the text the
      // user can already see, not the query from the previous render.
      this.parsedQuery = parseQuery(this.query);
      if (bulkButton) bulkButton.disabled = !this.query.trim();
      if (this.searchDebounce !== null) this.timerWindow.clearTimeout(this.searchDebounce);
      this.searchDebounce = this.timerWindow.setTimeout(() => {
        this.searchDebounce = null;
        this.renderTree();
      }, 120);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.query) {
        this.query = "";
        this.parsedQuery = parseQuery("");
        input.value = "";
        this.renderTree();
      }
    });
    const save = iconButton(searchRow, "bookmark-plus", "Save this search");
    save.addEventListener("click", () => this.saveCurrentSearch());
    bulkButton = iconButton(searchRow, "folder-plus", "Add matching records to a collection");
    bulkButton.disabled = !this.query.trim();
    bulkButton.addEventListener("click", () => this.addMatchingRecordsToCollection());
    const saved = searchRow.createEl("button", { cls: "ent-cc-button ent-cc-saved-button" });
    setIcon(saved.createSpan(), "book-marked");
    saved.createSpan({ text: "Saved" });
    saved.addEventListener("click", (event) => this.showSavedViews(event));
    this.countEl = searchRow.createDiv({ cls: "ent-cc-topic-count" });

    const chips = parent.createDiv({ cls: "ent-cc-filter-chips" });
    if (this.plugin.isClinicalMode()) {
      const definitions = [
        ["priority:P1", "P1"], ["source:gap", "Source gaps"], ["status:unverified", "Unverified"], ["safety:true", "Safety-critical"],
      ];
      for (const [token, label] of definitions) {
        const active = this.query.toLowerCase().split(/\s+/).includes(token.toLowerCase());
        const chip = chips.createEl("button", { cls: `ent-cc-filter-chip ${active ? "is-active" : ""}`, text: label });
        chip.addEventListener("click", () => {
          this.toggleToken(token);
          const search = this.contentEl.querySelector<HTMLInputElement>('.ent-cc-search-box input[type="search"]');
          if (search) search.value = this.query;
          chip.toggleClass("is-active", this.query.toLowerCase().split(/\s+/).includes(token.toLowerCase()));
          this.renderTree();
          chip.focus();
        });
      }
      chips.createSpan({ text: "Tip: combine tokens with fuzzy text", cls: "ent-cc-filter-hint" });
    } else {
      chips.createSpan({ text: "Tip: fuzzy-search the title, path, configured ID, or group. Advanced field filters remain available.", cls: "ent-cc-filter-hint" });
    }
    this.searchStatusEl = parent.createDiv({ cls: "ent-cc-search-status", attr: { role: "status", "aria-live": "polite" } });
  }

  private toggleToken(token: string): void {
    const parts = this.query.split(/\s+/).filter(Boolean);
    const index = parts.findIndex((part) => part.toLowerCase() === token.toLowerCase());
    if (index >= 0) parts.splice(index, 1);
    else parts.push(token);
    this.query = parts.join(" ");
  }

  private recordsForActiveTab(): VaultRecord[] {
    const tab = this.plugin.data.activeTab;
    if (tab === "curriculum") return this.records.filter((record) => record.role === "canonical" || record.role === "supporting");
    if (tab === "inbox") return this.records.filter((record) => record.role === "proposal");
    if (tab === "collections") return this.records;
    if (tab === "procedures") return this.records.filter((record) => record.kind === "procedure");
    if (tab === "medications") return this.records.filter((record) => record.kind === "medication");
    if (tab === "syndromes") return this.records.filter((record) => record.kind === "syndrome");
    return this.records;
  }

  private updateCount(visible: number): void {
    if (!this.countEl) return;
    this.countEl.empty();
    if (this.plugin.data.activeTab === "queues") {
      const uniqueVisible = uniqueRecords(queueRecords(this.smartQueues())).filter((record) => matchesParsedQuery(record, this.parsedQuery)).length;
      this.countEl.createSpan({ text: `${visible} queue entries · ${uniqueVisible} unique` });
    } else {
      const settings = this.plugin.data.settings;
      this.countEl.createSpan({ text: `${visible} ${visible === 1 ? settings.itemSingular : settings.itemPlural}` });
    }
    this.countEl.createSpan({ text: ` · ${titleForTab(this.plugin.data.activeTab, this.plugin.data.settings)}`, cls: "ent-cc-muted" });
  }

  private renderTree(): void {
    if (!this.treeEl) return;
    // Parsed once per render; matchesParsedQuery is called O(n) times below.
    this.parsedQuery = parseQuery(this.query);
    this.visualPlacementPaths = visualPlacementPathSet(this.plugin.data.curriculumVisual, this.plugin.data.indexGroupByPath);
    this.treeEl.empty();
    const unknownTokens = unknownQueryTokens(this.query);
    this.searchStatusEl?.setText(unknownTokens.length > 0
      ? `Unknown filter${unknownTokens.length === 1 ? "" : "s"}: ${unknownTokens.join(", ")}. Supported filters: domain, priority, kind, type, status, review, safety, source, dose, image.`
      : "");
    this.searchStatusEl?.toggleClass("is-error", unknownTokens.length > 0);
    const header = this.treeEl.createDiv({ cls: "ent-cc-tree-header" });
    header.createSpan({ text: this.treeHeaderTitle() });
    header.createSpan({ text: this.plugin.data.settings.itemPlural });
    const body = this.treeEl.createDiv({ cls: "ent-cc-tree-body" });

    let visible = 0;
    const tab = this.plugin.data.activeTab;
    if (tab === "curriculum") {
      visible = this.renderCurriculum(body);
    } else if (tab === "inbox") {
      visible = this.renderInbox(body);
    } else if (tab === "collections") {
      if (this.plugin.data.collections.length === 0) this.renderCollectionsEmpty(body);
      for (const heading of this.plugin.data.collections) visible += this.renderHeading(body, heading, true);
    } else if (tab === "queues") {
      for (const queue of this.smartQueues()) visible += this.renderQueue(body, queue);
    } else {
      visible = this.renderLibrary(body, this.recordsForActiveTab());
    }
    if (visible === 0
      && !(tab === "collections" && this.plugin.data.collections.length === 0)
      && !(tab === "inbox" && !this.query)) {
      if (tab === "curriculum" && !this.query && !this.plugin.isClinicalMode()) this.renderKnowledgeIndexEmpty(body);
      else body.createDiv({ cls: "ent-cc-empty", text: this.query ? "No records match this search." : "No records in this section." });
    }
    this.updateCount(visible);
  }

  private renderKnowledgeIndexEmpty(parent: HTMLElement): void {
    const settings = this.plugin.data.settings;
    const hidden = new Set(this.plugin.data.excludedIndexPaths);
    const availableCount = this.plugin.getIndexCandidateFiles().filter((file) => !hidden.has(file.path)).length;
    const empty = parent.createDiv({ cls: "ent-cc-empty ent-cc-empty-action" });
    setIcon(empty.createSpan(), availableCount > 0 ? "list-plus" : "file-plus-2");
    empty.createEl("strong", { text: `Start your ${settings.indexLabel.toLowerCase()}` });
    empty.createEl("p", { text: availableCount > 0
      ? `${availableCount} existing note${availableCount === 1 ? " is" : "s are"} ready to add without moving or rewriting files.`
      : `Create your first ${settings.itemSingular}, or change the indexed folder in Settings.` });
    const button = empty.createEl("button", { cls: "ent-cc-button ent-cc-add-button" });
    setIcon(button.createSpan(), availableCount > 0 ? "list-plus" : "plus");
    button.createSpan({ text: availableCount > 0 ? `Add existing ${settings.itemPlural}` : `Create ${settings.itemSingular}` });
    button.addEventListener("click", () => availableCount > 0
      ? this.openIndexManager("available")
      : this.startCreateKnowledgeNote());
  }

  private treeHeaderTitle(): string {
    const tab = this.plugin.data.activeTab;
    const settings = this.plugin.data.settings;
    if (tab === "curriculum") return this.curriculumArrangeMode
      ? `Visual arrangement / Drop inside or between ${settings.itemPlural}`
      : `${settings.indexLabel} / ${settings.groupLabel} / ${settings.itemSingular}`;
    if (tab === "inbox") return this.plugin.isClinicalMode() ? "Unverified topic proposals / Capture" : `${settings.inboxLabel} / ${settings.itemSingular}`;
    if (tab === "collections") return `Collection / Subheading / ${settings.itemSingular}`;
    if (tab === "queues") return "Computed review queue / Subject";
    return `${titleForTab(tab, this.plugin.data.settings)} / Knowledge record`;
  }

  private renderCollectionsEmpty(parent: HTMLElement): void {
    const empty = parent.createDiv({ cls: "ent-cc-empty ent-cc-empty-action" });
    setIcon(empty.createSpan(), "folders");
    empty.createEl("strong", { text: "Build your own study map" });
    empty.createEl("p", { text: `A ${this.plugin.data.settings.itemSingular} can belong to multiple collections while remaining in its original vault location.` });
    const button = empty.createEl("button", { cls: "ent-cc-button", text: "Create first collection" });
    button.addEventListener("click", () => this.promptNewCollection());
  }

  private renderInbox(parent: HTMLElement): number {
    const proposals = this.recordsForActiveTab().filter((record) => matchesParsedQuery(record, this.parsedQuery));
    if (proposals.length === 0 && !this.query) {
      const empty = parent.createDiv({ cls: "ent-cc-empty ent-cc-empty-action" });
      setIcon(empty.createSpan(), "inbox");
      empty.createEl("strong", { text: `No ${this.plugin.data.settings.inboxLabel.toLowerCase()} notes yet` });
      empty.createEl("p", { text: this.plugin.isClinicalMode()
        ? "Capture a safe, unverified scaffold here; promote it only after checking its curriculum ID and destination."
        : `Create an empty or template-based ${this.plugin.data.settings.itemSingular} in the configured Inbox folder.` });
      const button = empty.createEl("button", { cls: "ent-cc-button ent-cc-add-button" });
      setIcon(button.createSpan(), "plus");
      button.createSpan({ text: this.plugin.isClinicalMode() ? "Create topic proposal" : `Create ${this.plugin.data.settings.itemSingular}` });
      button.addEventListener("click", () => this.plugin.isClinicalMode()
        ? this.startCreateProposal()
        : this.startCreateKnowledgeNote({ folder: this.plugin.data.settings.proposalFolder }, false));
      return 0;
    }
    const section = parent.createDiv({ cls: "ent-cc-heading ent-cc-inbox-group" });
    const row = section.createDiv({ cls: "ent-cc-row ent-cc-heading-row" });
    row.createSpan({ cls: "ent-cc-disclosure" });
    const icon = row.createSpan({ cls: "ent-cc-leading-icon" });
    setIcon(icon, "inbox");
    row.createSpan({ cls: "ent-cc-row-title", text: this.plugin.isClinicalMode() ? "Awaiting curriculum decision" : this.plugin.data.settings.inboxLabel });
    row.createSpan({ cls: "ent-cc-row-count", text: String(proposals.length) });
    const content = section.createDiv({ cls: "ent-cc-heading-body" });
    proposals.sort((a, b) => b.mtime - a.mtime).forEach((record) => this.renderRecordRow(content, record, 1));
    return proposals.length;
  }

  private curriculumNodeMatches(node: CurriculumTreeNode): boolean {
    return matchesParsedQuery(node.record, this.parsedQuery) || node.children.some((child) => this.curriculumNodeMatches(child));
  }

  private curriculumNodeCount(node: CurriculumTreeNode): number {
    return 1 + node.children.reduce((sum, child) => sum + this.curriculumNodeCount(child), 0);
  }

  private renderCurriculum(parent: HTMLElement): number {
    let visible = 0;
    if (this.curriculum.depthLimitedPaths.length > 0) {
      const warning = parent.createDiv({ cls: "ent-cc-arrange-hint", attr: { role: "status" } });
      setIcon(warning.createSpan(), "triangle-alert");
      const count = this.curriculum.depthLimitedPaths.length;
      warning.createSpan({ text: `${count} ${count === 1 ? "record is" : "records are"} shown at the top level because the hierarchy exceeds the rendering depth limit. Parent metadata was not changed. Review Manage index → Diagnostics.` });
    }
    if (this.curriculumArrangeMode) {
      const hint = parent.createDiv({ cls: "ent-cc-arrange-hint", attr: { role: "note" } });
      setIcon(hint.createSpan(), "move");
      hint.createSpan({ text: `Drag onto a ${this.plugin.data.settings.itemSingular} to nest it; drop above or below to reorder${this.plugin.canVisuallyMoveAcrossGroups() ? "; drop into another group to move it visually" : ""}. On iPhone, use each row’s … menu.` });
    }
    for (const domain of this.curriculum.domains) {
      const matchingRoots = domain.roots.filter((node) => !this.query || this.curriculumNodeMatches(node));
      if (this.query && matchingRoots.length === 0) continue;
      visible += matchingRoots.reduce((sum, node) => sum + this.countCurriculumMatches(node), 0);
      this.renderCurriculumDomain(parent, domain, matchingRoots);
    }
    return visible;
  }

  private countCurriculumMatches(node: CurriculumTreeNode): number {
    return Number(!this.query || matchesParsedQuery(node.record, this.parsedQuery))
      + node.children.reduce((sum, child) => sum + this.countCurriculumMatches(child), 0);
  }

  private renderCurriculumDomain(parent: HTMLElement, domain: CurriculumDomainTree, roots: CurriculumTreeNode[]): void {
    const collapsed = this.collapsedCurriculumDomains.has(domain.domain) && !this.query;
    const section = parent.createDiv({ cls: "ent-cc-heading ent-cc-curriculum-domain" });
    const row = section.createDiv({ cls: "ent-cc-row ent-cc-heading-row" });
    const disclosure = disclosureButton(row, collapsed, domain.domain);
    disclosure.addEventListener("click", () => {
      if (collapsed) this.collapsedCurriculumDomains.delete(domain.domain); else this.collapsedCurriculumDomains.add(domain.domain);
      this.persistCollapseState();
      this.renderTree();
    });
    const leading = row.createSpan({ cls: "ent-cc-leading-icon" });
    setIcon(leading, "library");
    const title = row.createEl("button", { cls: "ent-cc-row-title", text: domain.domain });
    title.addEventListener("click", () => {
      if (collapsed) this.collapsedCurriculumDomains.delete(domain.domain); else this.collapsedCurriculumDomains.add(domain.domain);
      this.persistCollapseState();
      this.renderTree();
    });
    row.createSpan({ text: String(domain.roots.reduce((sum, node) => sum + this.curriculumNodeCount(node), 0)), cls: "ent-cc-row-count" });
    if (this.curriculumArrangeMode) this.applyCurriculumDomainDrop(row, domain);
    if (collapsed) return;
    const content = section.createDiv({ cls: "ent-cc-heading-body ent-cc-curriculum-domain-body" });
    if (this.curriculumArrangeMode) this.applyCurriculumDomainDrop(content, domain);
    for (const node of roots) this.renderCurriculumNode(content, node, 0);
  }

  private renderCurriculumNode(parent: HTMLElement, node: CurriculumTreeNode, depth: number): void {
    if (this.query && !this.curriculumNodeMatches(node)) return;
    const record = node.record;
    const collapsed = this.collapsedCurriculumNodes.has(record.path) && !this.query;
    const section = parent.createDiv({ cls: "ent-cc-curriculum-node" });
    const row = section.createDiv({
      cls: `ent-cc-row ent-cc-subject-row ent-cc-curriculum-row ${this.plugin.data.selectedPath === record.path ? "is-selected" : ""}`,
    });
    row.addClass(`ent-cc-depth-${Math.min(depth, 12)}`);
    if (node.children.length > 0) {
      const disclosure = disclosureButton(row, collapsed, record.title);
      disclosure.addEventListener("click", () => {
        if (collapsed) this.collapsedCurriculumNodes.delete(record.path); else this.collapsedCurriculumNodes.add(record.path);
        this.persistCollapseState();
        this.renderTree();
      });
    } else {
      row.createSpan({ cls: "ent-cc-disclosure ent-cc-disclosure-spacer" });
    }
    if (this.curriculumArrangeMode && !Platform.isMobile) {
      const handle = iconButton(row, "grip-vertical", `Drag ${record.title}`, "ent-cc-drag-handle");
      handle.draggable = true;
      handle.addEventListener("dragstart", (event) => this.writeCurriculumDrag(event, { kind: "curriculum-record", path: record.path }));
      handle.addEventListener("dragend", () => row.removeClass("is-dragging"));
      handle.addEventListener("dragstart", () => row.addClass("is-dragging"));
      this.applyCurriculumRowDrop(row, record);
    } else {
      const icon = row.createSpan({ cls: "ent-cc-leading-icon ent-cc-record-icon" });
      setIcon(icon, record.role === "supporting" ? "files" : "file-text");
    }
    const title = row.createEl("button", {
      cls: "ent-cc-subject-title",
      text: record.title,
      attr: { dir: "auto", "aria-label": `${record.title}, ${this.recordRoleName(record)}. Space selects; Enter opens; M adds to a collection; P pins.` },
    });
    title.addEventListener("click", () => this.selectRecord(record.path));
    title.addEventListener("keydown", (event) => {
      if (!shouldHandleRowShortcut(true, event.key) && event.key !== " ") return;
      if (event.key === "Enter") { event.preventDefault(); this.run(() => this.openRecord(record.path)); }
      if (event.key === " ") { event.preventDefault(); this.selectRecord(record.path); }
      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); this.openCollectionPicker(record.path); }
      if (event.key.toLowerCase() === "p" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); this.run(() => this.togglePin(record.path)); }
    });
    this.attachHoverPreview(title, record);
    row.createSpan({ text: record.curriculumId || (this.plugin.isClinicalMode() ? "supporting" : this.plugin.data.settings.itemSingular), cls: "ent-cc-subject-id", attr: { dir: "auto" } });
    const badges = row.createDiv({ cls: "ent-cc-row-badges" });
    if (this.hasCurriculumVisualPlacement(record.path)) {
      const visual = badges.createSpan({ cls: "ent-cc-visual-badge", attr: { title: "Custom visual placement" } });
      setIcon(visual, "move");
    }
    if (record.priority) badges.createSpan({ text: record.priority, cls: `ent-cc-priority ${record.priority === "P1" ? "is-urgent" : ""}` });
    if (this.plugin.isClinicalMode() && this.plugin.data.settings.showSafetyBadges && record.safetyCritical) {
      const safety = badges.createSpan({ cls: "ent-cc-safety-badge", attr: { title: "Safety-critical" } });
      setIcon(safety, "shield-alert");
    }
    if (this.plugin.data.pinnedPaths.includes(record.path)) {
      const pin = badges.createSpan({ cls: "ent-cc-pin-badge", attr: { title: "Pinned" } });
      setIcon(pin, "pin");
    }
    iconButton(row, "ellipsis", `Actions for ${record.title}`, "ent-cc-row-more").addEventListener("click", (event) => this.showRecordMenu(event, record));
    row.addEventListener("dblclick", () => this.run(() => this.openRecord(record.path)));
    if (collapsed) return;
    const children = section.createDiv({ cls: "ent-cc-curriculum-children" });
    for (const child of node.children) this.renderCurriculumNode(children, child, depth + 1);
  }

  private hasCurriculumVisualPlacement(path: string): boolean {
    return this.visualPlacementPaths.has(path);
  }

  private renderHeading(parent: HTMLElement, heading: LayoutHeading, mutable: boolean): number {
    const matchingDirect = heading.subjects.filter((path) => this.matchesPath(path));
    const matchingSubs = heading.subheadings.map((subheading) => ({
      subheading,
      paths: subheading.subjects.filter((path) => this.matchesPath(path)),
    })).filter((item) => item.paths.length > 0 || !this.query);
    const total = matchingDirect.length + matchingSubs.reduce((sum, item) => sum + item.paths.length, 0);
    if (this.query && total === 0) return 0;

    const section = parent.createDiv({ cls: "ent-cc-heading" });
    const row = section.createDiv({ cls: "ent-cc-row ent-cc-heading-row" });
    const disclosure = disclosureButton(row, heading.collapsed && !this.query, heading.title);
    disclosure.addEventListener("click", () => this.run(async () => {
      heading.collapsed = !heading.collapsed;
      if (mutable) await this.plugin.savePluginData();
      this.renderTree();
    }));
    const leading = row.createSpan({ cls: "ent-cc-leading-icon" });
    setIcon(leading, mutable ? "folders" : "library");
    const title = row.createEl("button", { cls: "ent-cc-row-title", text: heading.title });
    title.addEventListener("click", () => this.run(async () => {
      heading.collapsed = !heading.collapsed;
      if (mutable) await this.plugin.savePluginData();
      this.renderTree();
    }));
    const resolved = this.resolvableCount(heading);
    row.createSpan({ text: String(resolved), cls: "ent-cc-row-count" });
    const missing = countHeading(heading) - resolved;
    if (missing > 0) {
      row.createSpan({
        text: `${missing} missing`,
        cls: "ent-cc-row-missing",
        attr: { title: `${missing} referenced ${missing === 1 ? "note no longer exists" : "notes no longer exist"}. Open Manage index → Diagnostics to review or repair.` },
      });
    }
    if (mutable) iconButton(row, "ellipsis", `Actions for ${heading.title}`, "ent-cc-row-more").addEventListener("click", (event) => this.showHeadingMenu(event, heading));
    if (mutable && this.editMode) this.applyDrop(row, { headingId: heading.id });

    if (heading.collapsed && !this.query) return total;
    const content = section.createDiv({ cls: "ent-cc-heading-body" });
    if (mutable && this.editMode) this.applyDrop(content, { headingId: heading.id });
    matchingDirect.forEach((path) => {
      const record = this.recordByPath.get(path);
      if (record) this.renderRecordRow(content, record, 1, mutable ? { headingId: heading.id } : undefined);
    });
    for (const item of matchingSubs) this.renderSubheading(content, heading, item.subheading, item.paths, mutable);
    return total;
  }

  private renderSubheading(parent: HTMLElement, heading: LayoutHeading, subheading: LayoutSubheading, paths: string[], mutable: boolean): void {
    const section = parent.createDiv({ cls: "ent-cc-subheading" });
    const row = section.createDiv({ cls: "ent-cc-row ent-cc-subheading-row" });
    const disclosure = disclosureButton(row, subheading.collapsed && !this.query, subheading.title);
    disclosure.addEventListener("click", () => this.run(async () => {
      subheading.collapsed = !subheading.collapsed;
      if (mutable) await this.plugin.savePluginData();
      this.renderTree();
    }));
    const leading = row.createSpan({ cls: "ent-cc-leading-icon" });
    setIcon(leading, "folder");
    const title = row.createEl("button", { cls: "ent-cc-row-title", text: subheading.title });
    title.addEventListener("click", () => this.run(async () => {
      subheading.collapsed = !subheading.collapsed;
      if (mutable) await this.plugin.savePluginData();
      this.renderTree();
    }));
    row.createSpan({ text: String(subheading.subjects.filter((path) => this.recordByPath.has(path)).length), cls: "ent-cc-row-count" });
    if (mutable) iconButton(row, "ellipsis", `Actions for ${subheading.title}`, "ent-cc-row-more").addEventListener("click", (event) => this.showSubheadingMenu(event, heading, subheading));
    if (mutable && this.editMode) this.applyDrop(row, { headingId: heading.id, subheadingId: subheading.id });
    if (subheading.collapsed && !this.query) return;
    const content = section.createDiv({ cls: "ent-cc-subheading-body" });
    if (mutable && this.editMode) this.applyDrop(content, { headingId: heading.id, subheadingId: subheading.id });
    for (const path of paths) {
      const record = this.recordByPath.get(path);
      if (record) this.renderRecordRow(content, record, 2, mutable ? { headingId: heading.id, subheadingId: subheading.id } : undefined);
    }
  }

  private renderQueue(parent: HTMLElement, queue: QueueDefinition): number {
    const records = queue.records.filter((record) => matchesParsedQuery(record, this.parsedQuery));
    if (this.query && records.length === 0) return 0;
    const collapsed = this.collapsedQueues.has(queue.id);
    const section = parent.createDiv({ cls: "ent-cc-heading ent-cc-queue" });
    const row = section.createDiv({ cls: "ent-cc-row ent-cc-heading-row" });
    const disclosure = disclosureButton(row, collapsed, queue.title);
    disclosure.addEventListener("click", () => {
      if (collapsed) this.collapsedQueues.delete(queue.id); else this.collapsedQueues.add(queue.id);
      this.persistCollapseState();
      this.renderTree();
    });
    const leading = row.createSpan({ cls: "ent-cc-leading-icon" });
    setIcon(leading, queue.id === "next" ? "list-checks" : queue.id === "pinned" ? "pin" : "sparkles");
    const title = row.createEl("button", { cls: "ent-cc-row-title", text: queue.title, attr: { title: queue.description } });
    title.addEventListener("click", () => {
      if (collapsed) this.collapsedQueues.delete(queue.id); else this.collapsedQueues.add(queue.id);
      this.persistCollapseState();
      this.renderTree();
    });
    row.createSpan({ text: String(queue.records.length), cls: "ent-cc-row-count" });
    if (!collapsed) {
      const content = section.createDiv({ cls: "ent-cc-heading-body" });
      content.createDiv({ cls: "ent-cc-queue-description", text: queue.description });
      for (const record of records) this.renderRecordRow(content, record, 1);
    }
    return records.length;
  }

  private renderLibrary(parent: HTMLElement, input: VaultRecord[]): number {
    const records = input.filter((record) => matchesParsedQuery(record, this.parsedQuery));
    const groups = groupRecordsByGroup(records, titleForTab(this.plugin.data.activeTab, this.plugin.data.settings));
    for (const [group, grouped] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const section = parent.createDiv({ cls: "ent-cc-heading ent-cc-library-group" });
      const row = section.createDiv({ cls: "ent-cc-row ent-cc-heading-row" });
      row.createSpan({ cls: "ent-cc-disclosure" });
      const icon = row.createSpan({ cls: "ent-cc-leading-icon" });
      setIcon(icon, this.plugin.data.activeTab === "medications" ? "pill" : this.plugin.data.activeTab === "syndromes" ? "dna" : "clipboard-list");
      row.createSpan({ cls: "ent-cc-row-title", text: group });
      row.createSpan({ cls: "ent-cc-row-count", text: String(grouped.length) });
      const content = section.createDiv({ cls: "ent-cc-heading-body" });
      grouped.sort((a, b) => a.title.localeCompare(b.title)).forEach((record) => this.renderRecordRow(content, record, 1));
    }
    return records.length;
  }

  private resolvableCount(heading: LayoutHeading): number {
    let total = heading.subjects.filter((path) => this.recordByPath.has(path)).length;
    for (const subheading of heading.subheadings) total += subheading.subjects.filter((path) => this.recordByPath.has(path)).length;
    return total;
  }

  private matchesPath(path: string): boolean {
    const record = this.recordByPath.get(path);
    return Boolean(record && matchesParsedQuery(record, this.parsedQuery));
  }

  private recordRoleName(record: VaultRecord): string {
    if (this.plugin.isClinicalMode()) return roleLabel(record);
    if (record.kind === "topic") return `Indexed ${this.plugin.data.settings.itemSingular}`;
    if (record.role === "proposal") return `${this.plugin.data.settings.inboxLabel} ${this.plugin.data.settings.itemSingular}`;
    return roleLabel(record);
  }

  private renderRecordRow(parent: HTMLElement, record: VaultRecord, level: number, membership?: Membership): void {
    const row = parent.createDiv({
      cls: `ent-cc-row ent-cc-subject-row ent-cc-level-${level} ${this.plugin.data.selectedPath === record.path ? "is-selected" : ""}`,
    });
    if (membership && this.editMode && !Platform.isMobile) {
      const handle = iconButton(row, "grip-vertical", `Drag ${record.title}`, "ent-cc-drag-handle");
      handle.draggable = true;
      handle.addEventListener("dragstart", (event) => this.writeDrag(event, { kind: "membership", path: record.path, ...membership }));
      handle.addEventListener("dragstart", () => row.addClass("is-dragging"));
      handle.addEventListener("dragend", () => row.removeClass("is-dragging", "is-drop-before", "is-drop-after"));
      this.applyRowDrop(row, membership, record.path);
    } else {
      const icon = row.createSpan({ cls: "ent-cc-leading-icon ent-cc-record-icon" });
      setIcon(icon, record.role === "proposal" ? "inbox" : record.role === "supporting" ? "files" : record.role === "vault-note" ? "sticky-note" : record.kind === "topic" ? "file-text" : record.kind === "procedure" ? "clipboard-list" : record.kind === "medication" ? "pill" : "dna");
    }
    const title = row.createEl("button", {
      cls: "ent-cc-subject-title",
      text: record.title,
      attr: { dir: "auto", "aria-label": `${record.title}, ${this.recordRoleName(record)}. Space selects; Enter opens; M adds to a collection; P pins.` },
    });
    title.addEventListener("click", () => this.selectRecord(record.path));
    title.addEventListener("keydown", (event) => {
      if (!shouldHandleRowShortcut(true, event.key) && event.key !== " ") return;
      if (event.key === "Enter") { event.preventDefault(); this.run(() => this.openRecord(record.path)); }
      if (event.key === " ") { event.preventDefault(); this.selectRecord(record.path); }
      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); this.openCollectionPicker(record.path); }
      if (event.key.toLowerCase() === "p" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); this.run(() => this.togglePin(record.path)); }
    });
    this.attachHoverPreview(title, record);
    row.createSpan({
      text: record.curriculumId || (this.plugin.isClinicalMode()
        ? record.role === "supporting" ? "supporting" : record.role === "proposal" ? "proposal" : record.role === "vault-note" ? "vault note" : record.kind
        : record.role === "proposal" ? this.plugin.data.settings.inboxLabel : record.role === "vault-note" ? "vault note" : this.plugin.data.settings.itemSingular),
      cls: "ent-cc-subject-id",
      attr: { dir: "auto" },
    });
    const badges = row.createDiv({ cls: "ent-cc-row-badges" });
    if (record.priority) badges.createSpan({ text: record.priority, cls: `ent-cc-priority ${record.priority === "P1" ? "is-urgent" : ""}` });
    if (this.plugin.isClinicalMode() && this.plugin.data.settings.showSafetyBadges && record.safetyCritical) {
      const safety = badges.createSpan({ cls: "ent-cc-safety-badge", attr: { title: "Safety-critical" } });
      setIcon(safety, "shield-alert");
    }
    if (this.plugin.data.pinnedPaths.includes(record.path)) {
      const pin = badges.createSpan({ cls: "ent-cc-pin-badge", attr: { title: "Pinned" } });
      setIcon(pin, "pin");
    }
    if (record.aiLock) {
      const lock = badges.createSpan({ cls: "ent-cc-lock-badge", attr: { title: "AI locked" } });
      setIcon(lock, "lock");
    }
    iconButton(row, "ellipsis", `Actions for ${record.title}`, "ent-cc-row-more").addEventListener("click", (event) => this.showRecordMenu(event, record, membership));
    row.addEventListener("dblclick", () => this.run(() => this.openRecord(record.path)));
  }

  private attachHoverPreview(element: HTMLElement, record: VaultRecord): void {
    if (!this.plugin.data.settings.enableHoverPreview) return;
    element.addEventListener("mouseover", (event) => {
      this.app.workspace.trigger("hover-link", {
        event,
        source: "ent-vault-command-center",
        hoverParent: this,
        targetEl: element,
        linktext: record.path,
        sourcePath: "",
      });
    });
  }

  private selectRecord(path: string): void {
    this.plugin.data.selectedPath = path;
    const compact = this.isCompactInspectorLayout();
    if (compact) {
      this.mobileTreeScrollTop = this.workspaceEl?.scrollTop ?? 0;
      this.mobileInspectorScrollTop = 0;
      this.mobileInspectorOpen = true;
      this.mobileInspectorNeedsFocus = true;
    } else {
      this.mobileInspectorOpen = false;
      this.mobileInspectorNeedsFocus = false;
    }
    // Selection is transient UI state; persisting it on every click rewrites the
    // whole plugin data file and drives needless vault-sync traffic.
    if (this.selectionSaveTimer !== null) this.timerWindow.clearTimeout(this.selectionSaveTimer);
    this.selectionSaveTimer = this.timerWindow.setTimeout(() => {
      this.selectionSaveTimer = null;
      this.run(() => this.saveSelectionState());
    }, 1000);
    if (compact) this.render();
    else {
      this.renderTree();
      this.renderInspector();
    }
  }

  private isCompactInspectorLayout(): boolean {
    const viewWindow = this.contentEl.ownerDocument.defaultView;
    return viewWindow?.matchMedia("(max-width: 900px)").matches === true;
  }

  private closeMobileInspector(): void {
    this.mobileInspectorOpen = false;
    this.mobileInspectorNeedsFocus = false;
    this.render();
    this.timerWindow.setTimeout(() => {
      if (this.workspaceEl) this.workspaceEl.scrollTop = this.mobileTreeScrollTop;
      const selected = this.treeEl?.querySelector<HTMLElement>(".ent-cc-subject-row.is-selected .ent-cc-subject-title");
      (selected ?? this.treeEl)?.focus({ preventScroll: true });
    }, 0);
  }

  private handleMobileInspectorKeydown(event: KeyboardEvent): void {
    if (!this.mobileInspectorOpen || !this.isCompactInspectorLayout() || !this.inspectorEl) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeMobileInspector();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(this.inspectorEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = this.inspectorEl.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !this.inspectorEl.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private renderInspector(): void {
    if (!this.inspectorEl) return;
    this.inspectorEl.empty();
    const record = this.recordByPath.get(this.plugin.data.selectedPath);
    const compact = this.isCompactInspectorLayout();
    const mobileOpen = compact && this.mobileInspectorOpen && Boolean(record);
    this.inspectorEl.toggleClass("is-mobile-open", mobileOpen);
    this.inspectorEl.setAttribute("role", compact ? "dialog" : "complementary");
    if (compact) {
      this.inspectorEl.setAttribute("aria-modal", "true");
    } else {
      this.inspectorEl.removeAttribute("aria-modal");
    }
    const labelId = `ent-cc-inspector-label-${this.viewInstanceId}`;
    const titleId = `ent-cc-inspector-title-${this.viewInstanceId}`;
    const header = this.inspectorEl.createDiv({ cls: "ent-cc-inspector-header" });
    const headerCopy = header.createDiv({ cls: "ent-cc-inspector-header-copy" });
    headerCopy.createEl("h2", { text: "Selected knowledge record", attr: { id: labelId } });
    if (record) headerCopy.createDiv({ cls: "ent-cc-inspector-mobile-title", text: record.title, attr: { dir: "auto" } });
    const close = iconButton(header, "x", "Close record details", "ent-cc-inspector-close");
    close.addEventListener("click", () => this.closeMobileInspector());
    if (!record) {
      this.inspectorEl.setAttribute("aria-labelledby", labelId);
      this.inspectorEl.createDiv({ cls: "ent-cc-empty", text: "Select a record to inspect it." });
      return;
    }

    const body = this.inspectorEl.createDiv({ cls: "ent-cc-inspector-body" });
    body.createDiv({ cls: "ent-cc-inspector-kind", text: this.recordRoleName(record) });
    body.createEl("h3", { text: record.title, attr: { id: titleId, dir: "auto" } });
    this.inspectorEl.setAttribute("aria-labelledby", `${labelId} ${titleId}`);
    if (this.plugin.isClinicalMode() || record.reviewStatus || record.safetyCritical) {
      const statusLine = body.createDiv({ cls: "ent-cc-status-line" });
      if (this.plugin.isClinicalMode() || record.reviewStatus) statusLine.createSpan({
        text: record.reviewStatus || "review metadata missing",
        cls: `ent-cc-status-pill ${record.reviewStatus === "reviewed" ? "is-reviewed" : "is-unverified"}`,
      });
      if (record.safetyCritical) statusLine.createSpan({ text: "Safety-critical", cls: "ent-cc-status-pill is-critical" });
    }

    const actions = body.createDiv({ cls: "ent-cc-inspector-actions" });
    const open = actions.createEl("button", { cls: "ent-cc-button ent-cc-primary-button" });
    setIcon(open.createSpan(), "external-link"); open.createSpan({ text: "Open note" });
    open.addEventListener("click", () => this.run(() => this.openRecord(record.path)));
    const add = actions.createEl("button", { cls: "ent-cc-button" });
    setIcon(add.createSpan(), "folder-plus"); add.createSpan({ text: "Add to collection" });
    add.addEventListener("click", () => this.openCollectionPicker(record.path));
    if (this.plugin.canVisuallyMoveAcrossGroups() && record.kind === "topic") {
      const moveGroup = actions.createEl("button", { cls: "ent-cc-button" });
      setIcon(moveGroup.createSpan(), "folder-input"); moveGroup.createSpan({ text: `Move ${this.plugin.data.settings.groupLabel.toLowerCase()}…` });
      moveGroup.addEventListener("click", () => this.openIndexGroupPicker(record));
    }
    iconButton(actions, this.plugin.data.pinnedPaths.includes(record.path) ? "pin-off" : "pin", this.plugin.data.pinnedPaths.includes(record.path) ? "Unpin" : "Pin").addEventListener("click", () => this.run(() => this.togglePin(record.path)));
    if (this.plugin.isClinicalMode() && record.role === "proposal") {
      const promote = actions.createEl("button", { cls: "ent-cc-button ent-cc-promote-button" });
      setIcon(promote.createSpan(), "arrow-up-right");
      promote.createSpan({ text: "Promote…" });
      promote.disabled = record.aiLock;
      promote.addEventListener("click", () => this.startPromoteProposal(record));
    }
    if (this.plugin.isClinicalMode() && record.role === "canonical" && this.plugin.data.settings.enableAdvancedCanonicalActions) {
      const placement = actions.createEl("button", { cls: "ent-cc-button" });
      setIcon(placement.createSpan(), "folder-tree");
      placement.createSpan({ text: "Edit placement…" });
      placement.disabled = record.aiLock;
      placement.addEventListener("click", () => this.startEditCanonicalPlacement(record));
    }

    const settings = this.plugin.data.settings;
    this.inspectorField(body, this.plugin.isClinicalMode() ? "Curriculum ID" : `ID (${settings.idProperty})`, record.curriculumId || (record.role === "proposal" ? "Not assigned" : "—"));
    this.inspectorField(body, this.plugin.isClinicalMode() ? "Domain" : settings.groupLabel, record.domain || "—");
    this.inspectorField(body, "Knowledge type", record.topicKind || record.kind);
    if (this.plugin.isClinicalMode()) {
      this.inspectorField(body, "Priority", record.priority || "—", record.priority === "P1" ? "is-urgent" : "");
      this.inspectorField(body, "Synthesis", record.synthesisStatus || "—");
      this.inspectorField(body, "Sources", String(record.sourceCount), record.sourceCount === 0 ? "is-urgent" : "");
      if (record.kind === "medication") this.inspectorField(body, "Dose status", record.doseStatus || "—", record.doseStatus !== "reviewed" ? "is-urgent" : "");
      if (record.kind === "syndrome") this.inspectorField(body, "Image status", record.imageStatus || "—", record.imageStatus === "absent" ? "is-urgent" : "");
    }
    this.inspectorField(body, "Path", record.path, "is-path");
    if (record.aiLock) this.inspectorField(body, "AI lock", "Locked — structural editing disabled", "is-urgent");

    if (record.role !== "vault-note") this.renderStudyActions(body, record);
    this.renderRelatedKnowledge(body, record);

    if (mobileOpen && this.mobileInspectorNeedsFocus) {
      this.mobileInspectorNeedsFocus = false;
      this.timerWindow.setTimeout(() => {
        if (!this.mobileInspectorOpen || !this.inspectorEl) return;
        body.scrollTop = this.mobileInspectorScrollTop;
        this.inspectorEl.querySelector<HTMLElement>(".ent-cc-inspector-close")?.focus();
      }, 0);
    }
  }

  private inspectorField(parent: HTMLElement, label: string, value: string, className = ""): void {
    const row = parent.createDiv({ cls: `ent-cc-inspector-field ${className}`.trim() });
    row.createDiv({ cls: "ent-cc-inspector-label", text: label });
    row.createDiv({ cls: "ent-cc-inspector-value", text: value, attr: { dir: "auto" } });
  }

  private renderStudyActions(parent: HTMLElement, record: VaultRecord): void {
    const section = parent.createDiv({ cls: "ent-cc-inspector-section" });
    section.createEl("h4", { text: this.plugin.isClinicalMode() ? "Study actions" : "Note actions" });
    const next = section.createEl("button", { cls: `ent-cc-study-action ${this.plugin.data.nextStudyPaths.includes(record.path) ? "is-active" : ""}` });
    setIcon(next.createSpan(), this.plugin.data.nextStudyPaths.includes(record.path) ? "check" : "list-plus");
    next.createSpan({ text: this.plugin.data.nextStudyPaths.includes(record.path)
      ? `Remove from ${this.plugin.isClinicalMode() ? "Next to study" : "Next list"}`
      : `Add to ${this.plugin.isClinicalMode() ? "Next to study" : "Next list"}` });
    next.addEventListener("click", () => this.run(() => this.toggleNext(record.path)));
    if (this.plugin.isClinicalMode()) {
      this.copyAction(section, "wand-sparkles", "Copy deep-build command", `Deep-build ${record.title}`);
      this.copyAction(section, "search-check", "Copy autoresearch command", `Autoresearch ${record.title}`);
      this.copyAction(section, "list", "Copy NotePlan bullet command", `Convert ${record.title} into high-yield NotePlan bullets, preserving every literature-review point and source link from Obsidian.`);
    } else {
      this.copyAction(section, "link", "Copy wikilink", `[[${record.path.replace(/\.md$/i, "")}]]`);
      this.copyAction(section, "copy", "Copy path", record.path);
    }
  }

  private copyAction(parent: HTMLElement, icon: string, label: string, command: string): void {
    const button = parent.createEl("button", { cls: "ent-cc-study-action" });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.addEventListener("click", () => this.run(() => this.copyText(command, label)));
  }

  private async copyText(text: string, label: string): Promise<void> {
    try {
      const clipboard = this.contentEl.ownerDocument.defaultView?.navigator.clipboard;
      if (!clipboard) throw new Error("Clipboard unavailable");
      await clipboard.writeText(text);
      new Notice(`${label} copied.`);
    } catch {
      new Notice(this.plugin.isClinicalMode()
        ? "Clipboard access was unavailable. Open the note and use the command manually."
        : "Clipboard access was unavailable. Open the note and copy its wikilink or path manually.");
    }
  }

  private renderRelatedKnowledge(parent: HTMLElement, selected: VaultRecord): void {
    const section = parent.createDiv({ cls: "ent-cc-inspector-section ent-cc-related" });
    section.createEl("h4", { text: "Related knowledge" });
    const direct = selected.relatedTopics.map((link) => this.plugin.resolveLink(link, selected.path, this.recordByPath)).filter((record): record is VaultRecord => Boolean(record));
    const reverse = this.records.filter((candidate) => candidate.path !== selected.path && candidate.relatedTopics.some((link) => this.plugin.resolveLink(link, candidate.path, this.recordByPath)?.path === selected.path));
    const backlinkPaths = this.plugin.getBacklinkPaths(selected.path);
    const backlinks = backlinkPaths.map((path) => this.recordByPath.get(path)).filter((record): record is VaultRecord => Boolean(record));
    const related = uniqueRecords([...direct, ...reverse, ...backlinks]).filter((record) => record.path !== selected.path);

    const parents: VaultRecord[] = [];
    if (selected.parentTopic) {
      const parentRecord = this.plugin.resolveLink(selected.parentTopic, selected.path, this.recordByPath);
      if (parentRecord) parents.push(parentRecord);
    }
    if (this.plugin.isClinicalMode() && selected.kind === "topic" && selected.curriculumId.includes(".")) {
      const parentId = selected.curriculumId.split(".")[0];
      const canonicalParent = this.records.find((record) => record.curriculumId === parentId);
      if (canonicalParent) parents.push(canonicalParent);
    }
    const children = this.plugin.isClinicalMode() && selected.kind === "topic" && selected.curriculumId
      ? this.records.filter((record) => record.kind === "topic" && record.curriculumId.startsWith(`${selected.curriculumId}.`))
      : [];

    this.renderRelatedGroup(section, "Parent", uniqueRecords(parents));
    this.renderRelatedGroup(section, "Children", uniqueRecords(children));
    if (this.plugin.isClinicalMode()) {
      this.renderRelatedGroup(section, "Procedures", related.filter((record) => record.kind === "procedure"));
      this.renderRelatedGroup(section, "Medications", related.filter((record) => record.kind === "medication"));
      this.renderRelatedGroup(section, "Syndromes", related.filter((record) => record.kind === "syndrome"));
      this.renderRelatedGroup(section, "Linked topics", related.filter((record) => record.kind === "topic"));
    } else {
      this.renderRelatedGroup(section, `Linked ${this.plugin.data.settings.itemPlural}`, related);
    }

    const external = backlinkPaths.filter((path) => !this.recordByPath.has(path));
    if (external.length > 0) {
      const group = section.createDiv({ cls: "ent-cc-related-group" });
      group.createDiv({ cls: "ent-cc-related-label", text: this.plugin.isClinicalMode() ? "Evidence & other backlinks" : "Other backlinks" });
      for (const path of external.slice(0, 8)) {
        const button = group.createEl("button", { cls: "ent-cc-related-record", text: path.split("/").pop()?.replace(/\.md$/, "") ?? path });
        button.addEventListener("click", () => this.run(() => this.openRecord(path)));
      }
    }
    if (parents.length + children.length + related.length + external.length === 0) {
      section.createDiv({ cls: "ent-cc-related-empty", text: "No resolved relationships yet." });
    }
  }

  private renderRelatedGroup(parent: HTMLElement, label: string, records: VaultRecord[]): void {
    if (records.length === 0) return;
    const group = parent.createDiv({ cls: "ent-cc-related-group" });
    group.createDiv({ cls: "ent-cc-related-label", text: label });
    for (const record of records.slice(0, 12)) {
      const button = group.createEl("button", { cls: "ent-cc-related-record" });
      button.createSpan({ text: record.title });
      button.createSpan({ text: record.curriculumId || (this.plugin.isClinicalMode() ? record.kind : this.plugin.data.settings.itemSingular), cls: "ent-cc-related-meta" });
      button.addEventListener("click", () => this.selectRecord(record.path));
      this.attachHoverPreview(button, record);
    }
  }

  private smartQueues(): QueueDefinition[] {
    const byPath = (paths: string[]) => paths.map((path) => this.recordByPath.get(path)).filter((record): record is VaultRecord => Boolean(record));
    if (!this.plugin.isClinicalMode()) {
      return [
        { id: "next", title: "My next list", description: "Your manually curated shortlist, stored only in plugin data.", records: byPath(this.plugin.data.nextStudyPaths) },
        { id: "pinned", title: "Pinned knowledge", description: "Personal shortcuts stored only in plugin data.", records: byPath(this.plugin.data.pinnedPaths) },
        { id: "inbox", title: this.plugin.data.settings.inboxLabel, description: `Notes found in ${this.plugin.data.settings.proposalFolder || "the configured Inbox folder"}.`, records: this.records.filter((record) => record.role === "proposal") },
        { id: "ungrouped", title: `Ungrouped ${this.plugin.data.settings.itemPlural}`, description: `Indexed ${this.plugin.data.settings.itemPlural} without a configured group value or subfolder.`, records: this.records.filter((record) => record.kind === "topic" && (!record.domain || record.domain === "Unassigned")) },
        { id: "recent", title: "Recently changed", description: `The ${this.plugin.data.settings.recentLimit} most recently modified knowledge records.`, records: [...this.records].sort((a, b) => b.mtime - a.mtime).slice(0, this.plugin.data.settings.recentLimit) },
      ];
    }
    const decisions = uniqueRecords([
      ...this.records.filter((record) => record.role === "proposal"),
      ...this.records.filter((record) => record.kind === "medication" && record.doseStatus === "source_traced" && record.reviewStatus !== "reviewed"),
      ...this.records.filter((record) => record.autoresearchStatus === "drafted"),
      ...this.records.filter((record) => this.hasPlacementConflict(record)),
    ]);
    return [
      { id: "decisions", title: "Needs my decision", description: "Topic proposals, source-traced medication doses awaiting human review, and drafted autoresearch options. No approval is changed here.", records: decisions },
      { id: "next", title: "My next to study", description: "Your personal, manually curated study shortlist.", records: byPath(this.plugin.data.nextStudyPaths) },
      { id: "pinned", title: "Pinned knowledge", description: "Personal shortcuts kept in plugin data only.", records: byPath(this.plugin.data.pinnedPaths) },
      { id: "proposals", title: "Topic Inbox awaiting decision", description: "Unverified captures that have not entered the canonical curriculum.", records: this.records.filter((record) => record.role === "proposal") },
      { id: "p1", title: "P1 clinical topics", description: "Highest-priority canonical curriculum topics.", records: this.records.filter((record) => record.role === "canonical" && record.priority === "P1") },
      { id: "gaps", title: "Metadata & source gaps", description: "Records missing expected identifiers, priority, sources, or review metadata.", records: this.records.filter(metadataHasGap) },
      { id: "recent", title: "Recently changed", description: `The ${this.plugin.data.settings.recentLimit} most recently modified knowledge records.`, records: [...this.records].sort((a, b) => b.mtime - a.mtime).slice(0, this.plugin.data.settings.recentLimit) },
      { id: "procedure-review", title: "Procedures awaiting review", description: "Procedure drafts not marked reviewed. Review status is never changed here.", records: this.records.filter((record) => record.kind === "procedure" && record.reviewStatus !== "reviewed") },
      { id: "medication-dose-absent", title: "Medication doses absent", description: "Medication notes with no source-traced dose candidate.", records: this.records.filter((record) => record.kind === "medication" && record.doseStatus === "absent") },
      { id: "medication-source-traced", title: "Source-traced doses awaiting human review", description: "Dose candidates are source-traced but remain unverified until reconciled with current local policy.", records: this.records.filter((record) => record.kind === "medication" && record.doseStatus === "source_traced" && record.reviewStatus !== "reviewed") },
      { id: "medication-source-gaps", title: "Medication source gaps", description: "Medication notes with no traced source entries or source coverage marked none.", records: this.records.filter((record) => record.kind === "medication" && (record.sourceCount === 0 || record.sourceCoverage === "none")) },
      { id: "syndrome-image-gaps", title: "Syndrome image gaps", description: "Syndrome notes without a source-traced teaching image.", records: this.records.filter((record) => record.kind === "syndrome" && record.imageStatus === "absent") },
      { id: "syndrome-source-gaps", title: "Syndrome source gaps", description: "Syndrome notes with no traced source entries or source coverage marked none.", records: this.records.filter((record) => record.kind === "syndrome" && (record.sourceCount === 0 || record.sourceCoverage === "none")) },
    ];
  }

  private hasPlacementConflict(record: VaultRecord): boolean {
    if (!this.plugin.isClinicalMode()) return false;
    if (record.role !== "canonical" || !record.curriculumId) return false;
    const expectedId = expectedParentCurriculumId(record.curriculumId);
    const resolvedParent = record.parentTopic ? this.plugin.resolveLink(record.parentTopic, record.path, this.recordByPath) : null;
    if (isExtensionCurriculumId(record.curriculumId)) return Boolean(record.parentTopic) && (!resolvedParent || resolvedParent.domain !== record.domain);
    if (!expectedId) return Boolean(resolvedParent);
    return !resolvedParent || resolvedParent.domain !== record.domain || resolvedParent.curriculumId !== expectedId;
  }

  private matchingRecordsForCurrentView(): VaultRecord[] {
    // Toolbar actions can run while the visual search refresh is debounced.
    const parsedQuery = parseQuery(this.query);
    const candidates = this.plugin.data.activeTab === "queues"
      ? uniqueRecords(queueRecords(this.smartQueues()))
      : this.recordsForActiveTab();
    return uniqueRecords(candidates.filter((record) => matchesParsedQuery(record, parsedQuery)));
  }

  private addMatchingRecordsToCollection(): void {
    if (!this.query.trim()) {
      new Notice("Enter a search or filter first.");
      return;
    }
    const records = this.matchingRecordsForCurrentView();
    if (records.length === 0) {
      new Notice("No matching records to add.");
      return;
    }
    const paths = records.map((record) => record.path);
    const targets = collectionTargets(this.plugin.data.collections);
    if (targets.length === 0) {
      new TextPromptModal(this.app, {
        title: "Create collection for matching records",
        placeholder: "Collection name",
        submitLabel: `Create with ${records.length} records`,
        onSubmit: async (title) => this.plugin.mutate(`Create collection “${title}” from search`, () => {
          this.plugin.data.activeTab = "collections";
          this.plugin.data.collections.push({ id: makeId("collection"), title, collapsed: false, subjects: paths, subheadings: [] });
        }),
      }).open();
      return;
    }
    new CollectionPickerModal(this.app, targets, "Add", async (target) => {
      await this.plugin.mutate(`Add ${records.length} matching records to collection`, () => {
        for (const path of paths) this.addMembership(path, target);
      });
      new Notice(`Added ${records.length} matching records. Source notes stayed in place.`);
    }).open();
  }

  private promptNewCollection(addPath?: string): void {
    new TextPromptModal(this.app, {
      title: "New collection",
      placeholder: "e.g. Airway board review",
      submitLabel: "Create collection",
      onSubmit: async (title) => {
        await this.plugin.mutate(`Create collection “${title}”`, () => {
          this.plugin.data.activeTab = "collections";
          this.plugin.data.collections.push({ id: makeId("collection"), title, collapsed: false, subjects: addPath ? [addPath] : [], subheadings: [] });
        });
      },
    }).open();
  }

  private promptNewSubheading(heading: LayoutHeading): void {
    new TextPromptModal(this.app, {
      title: `New subheading in ${heading.title}`,
      placeholder: "Subheading name",
      submitLabel: "Create subheading",
      onSubmit: async (title) => this.plugin.mutate(`Create subheading “${title}”`, () => {
        heading.subheadings.push({ id: makeId("subheading"), title, collapsed: false, subjects: [] });
        heading.collapsed = false;
      }),
    }).open();
  }

  private openCollectionPicker(path: string, source?: Membership, move = false): void {
    const targets = collectionTargets(this.plugin.data.collections);
    if (targets.length === 0) {
      this.promptNewCollection(path);
      return;
    }
    new CollectionPickerModal(this.app, targets, move ? "Move" : "Add", async (target) => {
      await this.plugin.mutate(`${move ? "Move" : "Add"} record in collection`, () => {
        if (move && source) this.removeMembership(path, source);
        this.addMembership(path, target);
      });
      new Notice(`${move ? "Moved" : "Added"} in My Collections. The source note stayed in place.`);
    }).open();
  }

  private addMembership(path: string, target: Membership): void {
    const heading = this.plugin.data.collections.find((item) => item.id === target.headingId);
    if (!heading) return;
    let list = heading.subjects;
    if (target.subheadingId) {
      const subheading = heading.subheadings.find((item) => item.id === target.subheadingId);
      if (!subheading) return;
      list = subheading.subjects;
      subheading.collapsed = false;
    }
    if (!list.includes(path)) list.push(path);
    heading.collapsed = false;
  }

  private removeMembership(path: string, membership: Membership): void {
    const heading = this.plugin.data.collections.find((item) => item.id === membership.headingId);
    if (!heading) return;
    if (!membership.subheadingId) heading.subjects = heading.subjects.filter((item) => item !== path);
    else {
      const subheading = heading.subheadings.find((item) => item.id === membership.subheadingId);
      if (subheading) subheading.subjects = subheading.subjects.filter((item) => item !== path);
    }
  }

  private membershipList(membership: Membership): string[] {
    const heading = this.plugin.data.collections.find((item) => item.id === membership.headingId);
    if (!heading) return [];
    if (!membership.subheadingId) return heading.subjects;
    return heading.subheadings.find((item) => item.id === membership.subheadingId)?.subjects ?? [];
  }

  private async moveCollection(from: number, to: number): Promise<void> {
    if (from < 0 || to < 0 || from >= this.plugin.data.collections.length || to >= this.plugin.data.collections.length) return;
    await this.plugin.mutate("Reorder collection", () => {
      const [item] = this.plugin.data.collections.splice(from, 1);
      if (item) this.plugin.data.collections.splice(to, 0, item);
    });
  }

  private async moveSubheading(heading: LayoutHeading, from: number, to: number): Promise<void> {
    if (from < 0 || to < 0 || from >= heading.subheadings.length || to >= heading.subheadings.length) return;
    await this.plugin.mutate("Reorder subheading", () => {
      const [item] = heading.subheadings.splice(from, 1);
      if (item) heading.subheadings.splice(to, 0, item);
    });
  }

  private async moveRecordWithin(membership: Membership, from: number, to: number): Promise<void> {
    const list = this.membershipList(membership);
    if (from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    await this.plugin.mutate("Reorder record in collection", () => {
      const [path] = list.splice(from, 1);
      if (path) list.splice(to, 0, path);
    });
  }

  private async togglePin(path: string): Promise<void> {
    const pinned = this.plugin.data.pinnedPaths.includes(path);
    await this.plugin.mutate(`${pinned ? "Unpin" : "Pin"} knowledge record`, () => {
      this.plugin.data.pinnedPaths = pinned ? this.plugin.data.pinnedPaths.filter((item) => item !== path) : [...this.plugin.data.pinnedPaths, path];
    });
  }

  private async toggleNext(path: string): Promise<void> {
    const present = this.plugin.data.nextStudyPaths.includes(path);
    await this.plugin.mutate(`${present ? "Remove from" : "Add to"} Next to study`, () => {
      this.plugin.data.nextStudyPaths = present ? this.plugin.data.nextStudyPaths.filter((item) => item !== path) : [...this.plugin.data.nextStudyPaths, path];
    });
  }

  private showHeadingMenu(event: MouseEvent, heading: LayoutHeading): void {
    const menu = new Menu();
    const index = this.plugin.data.collections.findIndex((item) => item.id === heading.id);
    menu.addItem((item) => item.setTitle("Move collection up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => this.run(() => this.moveCollection(index, index - 1))));
    menu.addItem((item) => item.setTitle("Move collection down").setIcon("arrow-down").setDisabled(index < 0 || index >= this.plugin.data.collections.length - 1).onClick(() => this.run(() => this.moveCollection(index, index + 1))));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Add subheading").setIcon("folder-plus").onClick(() => this.promptNewSubheading(heading)));
    menu.addItem((item) => item.setTitle("Rename collection").setIcon("pencil").onClick(() => {
      new TextPromptModal(this.app, {
        title: "Rename collection", placeholder: "Collection name", initialValue: heading.title,
        onSubmit: async (title) => this.plugin.mutate(`Rename collection “${heading.title}”`, () => { heading.title = title; }),
      }).open();
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Delete collection").setIcon("trash-2").onClick(() => {
      new ConfirmModal(this.app, "Delete collection?", `“${heading.title}” and its memberships will be removed. No Markdown note will be deleted or moved.`, "Delete collection", async () => {
        await this.plugin.mutate(`Delete collection “${heading.title}”`, () => {
          this.plugin.data.collections = this.plugin.data.collections.filter((item) => item.id !== heading.id);
        });
      }).open();
    }));
    menu.showAtMouseEvent(event);
  }

  private showSubheadingMenu(event: MouseEvent, heading: LayoutHeading, subheading: LayoutSubheading): void {
    const menu = new Menu();
    const index = heading.subheadings.findIndex((item) => item.id === subheading.id);
    menu.addItem((item) => item.setTitle("Move subheading up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => this.run(() => this.moveSubheading(heading, index, index - 1))));
    menu.addItem((item) => item.setTitle("Move subheading down").setIcon("arrow-down").setDisabled(index < 0 || index >= heading.subheadings.length - 1).onClick(() => this.run(() => this.moveSubheading(heading, index, index + 1))));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Rename subheading").setIcon("pencil").onClick(() => {
      new TextPromptModal(this.app, {
        title: "Rename subheading", placeholder: "Subheading name", initialValue: subheading.title,
        onSubmit: async (title) => this.plugin.mutate(`Rename subheading “${subheading.title}”`, () => { subheading.title = title; }),
      }).open();
    }));
    menu.addItem((item) => item.setTitle("Remove subheading").setIcon("trash-2").onClick(() => {
      new ConfirmModal(this.app, "Remove subheading?", `Its ${this.plugin.data.settings.itemSingular} memberships will remain directly under “${heading.title}”.`, "Remove subheading", async () => {
        await this.plugin.mutate(`Remove subheading “${subheading.title}”`, () => {
          heading.subjects.push(...subheading.subjects.filter((path) => !heading.subjects.includes(path)));
          heading.subheadings = heading.subheadings.filter((item) => item.id !== subheading.id);
        });
      }).open();
    }));
    menu.showAtMouseEvent(event);
  }

  private curriculumChildrenPaths(path: string): string[] {
    return curriculumChildPaths(this.curriculum, path);
  }

  private async moveCurriculumRecord(record: VaultRecord, parentPath: string | null, siblingPaths: string[], index: number, label: string): Promise<void> {
    const parent = parentPath ? this.recordByPath.get(parentPath) : undefined;
    const descendants = curriculumDescendantPaths(this.curriculum, record.path);
    if (this.plugin.canVisuallyMoveAcrossGroups() && parent && parent.domain !== record.domain) {
      await this.moveIndexRecordToGroup(record, parent.domain, parentPath, siblingPaths, index, label);
      return;
    }
    if ((parentPath && (!parent || parent.domain !== record.domain)) || parentPath === record.path || (parentPath && descendants.has(parentPath))) {
      new Notice(`That visual move would create an invalid or cyclic ${this.plugin.data.settings.indexLabel.toLowerCase()} tree.`);
      return;
    }
    await this.plugin.mutate(label, () => {
      moveCurriculumVisual(this.plugin.data.curriculumVisual, record, parentPath, siblingPaths, index);
    });
    new Notice(`Visual ${this.plugin.data.settings.indexLabel.toLowerCase()} arrangement updated. Note paths and metadata were not changed.`);
  }

  private openCurriculumParentPicker(record: VaultRecord): void {
    const excluded = curriculumDescendantPaths(this.curriculum, record.path);
    excluded.add(record.path);
    const candidates = this.records.filter((candidate) => candidate.kind === "topic"
      && (candidate.role === "canonical" || candidate.role === "supporting")
      && (this.plugin.canVisuallyMoveAcrossGroups() || candidate.domain === record.domain)
      && !excluded.has(candidate.path));
    new RecordPickerModal(this.app, candidates, `Move “${record.title}” under…`, `Search a parent ${this.plugin.data.settings.itemSingular}${this.plugin.isClinicalMode() ? ` in this ${this.plugin.data.settings.groupLabel.toLowerCase()}` : ""}…`, (parent) => {
      const children = this.curriculumChildrenPaths(parent.path).filter((path) => path !== record.path);
      this.run(() => this.moveCurriculumRecord(record, parent.path, children, children.length, `Move “${record.title}” under “${parent.title}”`));
    }).open();
  }

  private moveCurriculumUpOrDown(record: VaultRecord, direction: -1 | 1): void {
    const parentPath = this.curriculum.parentByPath.get(record.path) ?? null;
    const siblings = curriculumSiblingPaths(this.curriculum, record);
    const index = siblings.indexOf(record.path);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    this.run(() => this.moveCurriculumRecord(record, parentPath, siblings, target, `${direction < 0 ? "Move up" : "Move down"} “${record.title}”`));
  }

  private indentCurriculumRecord(record: VaultRecord): void {
    const siblings = curriculumSiblingPaths(this.curriculum, record);
    const index = siblings.indexOf(record.path);
    const previousPath = index > 0 ? siblings[index - 1] : "";
    const previous = this.recordByPath.get(previousPath);
    if (!previous) return;
    const children = this.curriculumChildrenPaths(previous.path).filter((path) => path !== record.path);
    this.run(() => this.moveCurriculumRecord(record, previous.path, children, children.length, `Indent “${record.title}” under “${previous.title}”`));
  }

  private outdentCurriculumRecord(record: VaultRecord): void {
    const parentPath = this.curriculum.parentByPath.get(record.path) ?? null;
    const parent = parentPath ? this.recordByPath.get(parentPath) : undefined;
    if (!parent) return;
    const grandParentPath = this.curriculum.parentByPath.get(parent.path) ?? null;
    const parentSiblings = curriculumSiblingPaths(this.curriculum, parent).filter((path) => path !== record.path);
    const index = Math.max(0, parentSiblings.indexOf(parent.path) + 1);
    this.run(() => this.moveCurriculumRecord(record, grandParentPath, parentSiblings, index, `Outdent “${record.title}”`));
  }

  private makeCurriculumTopLevel(record: VaultRecord): void {
    const roots = this.curriculum.domains.find((domain) => domain.domain === record.domain)?.roots.map((node) => node.record.path).filter((path) => path !== record.path) ?? [];
    this.run(() => this.moveCurriculumRecord(record, null, roots, roots.length, `Make “${record.title}” top-level`));
  }

  private resetCurriculumRecord(record: VaultRecord): void {
    this.run(() => this.plugin.mutate(`Reset visual placement for “${record.title}”`, () => {
      resetCurriculumVisualPath(this.plugin.data.curriculumVisual, record.path);
      if (this.plugin.canVisuallyMoveAcrossGroups()) delete this.plugin.data.indexGroupByPath[record.path];
    })
      .then(() => new Notice(`${this.plugin.isClinicalMode() ? "Canonical" : "Configured"} parent and sibling order restored. Source notes were not changed.`)));
  }

  private openIndexGroupPicker(record: VaultRecord): void {
    if (!this.plugin.canVisuallyMoveAcrossGroups()) return;
    const settings = this.plugin.data.settings;
    new IndexGroupModal(this.app, {
      title: `Move “${record.title}” to ${settings.groupLabel.toLowerCase()}`,
      groupLabel: settings.groupLabel,
      initialValue: record.domain,
      existingGroups: this.plugin.getIndexGroups(),
      submitLabel: "Move visually",
      onSubmit: async (group) => {
        const roots = this.curriculum.domains.find((domain) => domain.domain === group)?.roots.map((node) => node.record.path).filter((path) => path !== record.path) ?? [];
        await this.moveIndexRecordToGroup(record, group, null, roots, roots.length, `Move “${record.title}” to ${group}`);
      },
    }).open();
  }

  private async moveIndexRecordToGroup(
    record: VaultRecord,
    group: string,
    parentPath: string | null,
    siblingPaths: string[],
    index: number,
    label: string,
  ): Promise<void> {
    const cleanGroup = group.trim();
    const descendants = curriculumDescendantPaths(this.curriculum, record.path);
    if (!cleanGroup || parentPath === record.path || (parentPath && descendants.has(parentPath))) {
      new Notice(`That visual move would create an invalid or cyclic ${this.plugin.data.settings.indexLabel.toLowerCase()} tree.`);
      return;
    }
    const parent = parentPath ? this.recordByPath.get(parentPath) : undefined;
    if (parentPath && (!parent || parent.domain !== cleanGroup)) {
      new Notice(`Choose a parent inside ${cleanGroup}.`);
      return;
    }
    await this.plugin.mutate(label, () => {
      if (!this.plugin.data.indexGroupOrder.includes(cleanGroup)) this.plugin.data.indexGroupOrder.push(cleanGroup);
      for (const path of [record.path, ...descendants]) this.plugin.data.indexGroupByPath[path] = cleanGroup;
      moveCurriculumVisual(this.plugin.data.curriculumVisual, { ...record, domain: cleanGroup, folderOrder: cleanGroup }, parentPath, siblingPaths, index);
    });
    this.collapsedCurriculumDomains.delete(cleanGroup);
    if (parentPath) this.collapsedCurriculumNodes.delete(parentPath);
    this.persistCollapseState();
    new Notice(`Moved visually to ${cleanGroup}. Note paths and metadata were not changed.`);
  }

  private removeFromIndex(record: VaultRecord): void {
    if (this.plugin.isClinicalMode() || record.kind !== "topic") return;
    const settings = this.plugin.data.settings;
    const insidePrimary = pathIsInsideFolder(record.path, settings.primaryFolder);
    const action = insidePrimary ? "Hide from index" : "Remove from index";
    new ConfirmModal(
      this.app,
      `${action}?`,
      `“${record.title}” will leave ${settings.indexLabel}. Its Markdown file, path, metadata, and collection memberships will not be changed. You can restore it with Add existing note to ${settings.indexLabel}.`,
      action,
      async () => {
        await this.plugin.mutate(`${action} “${record.title}”`, () => {
          this.plugin.data.manualIndexPaths = this.plugin.data.manualIndexPaths.filter((path) => path !== record.path);
          if (insidePrimary && !this.plugin.data.excludedIndexPaths.includes(record.path)) this.plugin.data.excludedIndexPaths.push(record.path);
          delete this.plugin.data.indexGroupByPath[record.path];
          resetCurriculumVisualPath(this.plugin.data.curriculumVisual, record.path);
        });
        new Notice(`${record.title} was removed from the visual index. Its note was not moved or deleted.`);
      },
    ).open();
  }

  private showRecordMenu(event: MouseEvent, record: VaultRecord, membership?: Membership): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Open note").setIcon("external-link").onClick(() => this.run(() => this.openRecord(record.path))));
    menu.addItem((item) => item.setTitle("Add to collection…").setIcon("folder-plus").onClick(() => this.openCollectionPicker(record.path)));
    if (this.plugin.canVisuallyMoveAcrossGroups() && record.kind === "topic") {
      menu.addItem((item) => item.setTitle(`Move to ${this.plugin.data.settings.groupLabel.toLowerCase()}…`).setIcon("folder-input").onClick(() => this.openIndexGroupPicker(record)));
      if (!this.plugin.isClinicalMode()) menu.addItem((item) => item.setTitle(pathIsInsideFolder(record.path, this.plugin.data.settings.primaryFolder) ? "Hide from index…" : "Remove from index…").setIcon("list-minus").onClick(() => this.removeFromIndex(record)));
    }
    if (membership) {
      const list = this.membershipList(membership);
      const index = list.indexOf(record.path);
      menu.addItem((item) => item.setTitle("Move up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => this.run(() => this.moveRecordWithin(membership, index, index - 1))));
      menu.addItem((item) => item.setTitle("Move down").setIcon("arrow-down").setDisabled(index < 0 || index >= list.length - 1).onClick(() => this.run(() => this.moveRecordWithin(membership, index, index + 1))));
      menu.addItem((item) => item.setTitle("Move this membership…").setIcon("folder-input").onClick(() => this.openCollectionPicker(record.path, membership, true)));
      menu.addItem((item) => item.setTitle("Remove from this collection").setIcon("folder-minus").onClick(() => this.run(
        () => this.plugin.mutate(`Remove ${this.plugin.data.settings.itemSingular} membership`, () => this.removeMembership(record.path, membership)),
      )));
    }
    if (this.plugin.data.activeTab === "curriculum" && this.curriculumArrangeMode && record.kind === "topic") {
      const parentPath = this.curriculum.parentByPath.get(record.path) ?? null;
      const siblings = curriculumSiblingPaths(this.curriculum, record);
      const index = siblings.indexOf(record.path);
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Move under…").setIcon("corner-down-right").onClick(() => this.openCurriculumParentPicker(record)));
      menu.addItem((item) => item.setTitle(`Indent under previous ${this.plugin.data.settings.itemSingular}`).setIcon("indent-increase").setDisabled(index <= 0).onClick(() => this.indentCurriculumRecord(record)));
      menu.addItem((item) => item.setTitle("Outdent one level").setIcon("indent-decrease").setDisabled(!parentPath).onClick(() => this.outdentCurriculumRecord(record)));
      menu.addItem((item) => item.setTitle(`Make top-level in ${this.plugin.data.settings.groupLabel.toLowerCase()}`).setIcon("panel-top").setDisabled(!parentPath).onClick(() => this.makeCurriculumTopLevel(record)));
      menu.addItem((item) => item.setTitle("Move up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => this.moveCurriculumUpOrDown(record, -1)));
      menu.addItem((item) => item.setTitle("Move down").setIcon("arrow-down").setDisabled(index < 0 || index >= siblings.length - 1).onClick(() => this.moveCurriculumUpOrDown(record, 1)));
      menu.addItem((item) => item.setTitle(`Reset to ${this.plugin.isClinicalMode() ? "canonical" : "configured"} placement`).setIcon("rotate-ccw").setDisabled(!this.hasCurriculumVisualPlacement(record.path)).onClick(() => this.resetCurriculumRecord(record)));
    }
    menu.addSeparator();
    const pinned = this.plugin.data.pinnedPaths.includes(record.path);
    menu.addItem((item) => item.setTitle(pinned ? "Unpin" : "Pin").setIcon(pinned ? "pin-off" : "pin").onClick(() => this.run(() => this.togglePin(record.path))));
    const next = this.plugin.data.nextStudyPaths.includes(record.path);
    const nextLabel = this.plugin.isClinicalMode() ? "Next to study" : "Next list";
    menu.addItem((item) => item.setTitle(next ? `Remove from ${nextLabel}` : `Add to ${nextLabel}`).setIcon(next ? "list-x" : "list-plus").onClick(() => this.run(() => this.toggleNext(record.path))));
    menu.addSeparator();
    if (this.plugin.isClinicalMode() && record.role === "proposal") menu.addItem((item) => item.setTitle("Promote proposal…").setIcon("arrow-up-right").setDisabled(record.aiLock).onClick(() => this.startPromoteProposal(record)));
    if (this.plugin.isClinicalMode() && record.role === "canonical" && this.plugin.data.settings.enableAdvancedCanonicalActions) menu.addItem((item) => item.setTitle("Edit canonical placement…").setIcon("folder-tree").setDisabled(record.aiLock).onClick(() => this.startEditCanonicalPlacement(record)));
    if (this.plugin.isClinicalMode() && record.role !== "vault-note") {
      menu.addItem((item) => item.setTitle("Copy deep-build command").setIcon("wand-sparkles").onClick(() => this.run(() => this.copyText(`Deep-build ${record.title}`, "Deep-build command"))));
      menu.addItem((item) => item.setTitle("Copy autoresearch command").setIcon("search-check").onClick(() => this.run(() => this.copyText(`Autoresearch ${record.title}`, "Autoresearch command"))));
    }
    menu.showAtMouseEvent(event);
  }

  private showGlobalMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Add or create…").setIcon("plus").onClick(() => this.openAddActions()));
    menu.addItem((item) => item.setTitle(`Manage ${this.plugin.data.settings.indexLabel}`).setIcon("list-tree").onClick(() => this.openIndexManager()));
    if (!this.plugin.isClinicalMode()) menu.addItem((item) => item.setTitle(`Add existing note to ${this.plugin.data.settings.indexLabel}`).setIcon("list-plus").onClick(() => this.startAddExistingToIndex()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Undo personal organization change").setIcon("undo-2").setDisabled(this.plugin.data.undoStack.length === 0).onClick(() => this.run(() => this.plugin.undo())));
    menu.addItem((item) => item.setTitle("Redo personal organization change").setIcon("redo-2").setDisabled(this.plugin.data.redoStack.length === 0).onClick(() => this.run(() => this.plugin.redo())));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Expand all visible groups").setIcon("chevrons-down").onClick(() => this.run(async () => {
      this.collapsedQueues.clear();
      if (this.plugin.data.activeTab === "curriculum") {
        this.collapsedCurriculumDomains.clear();
        this.collapsedCurriculumNodes.clear();
      } else if (this.plugin.data.activeTab === "collections") {
        this.plugin.data.collections.forEach((heading) => { heading.collapsed = false; heading.subheadings.forEach((sub) => { sub.collapsed = false; }); });
      }
      if (this.plugin.data.activeTab === "collections") await this.plugin.savePluginData();
      else this.persistCollapseState();
      this.renderTree();
    })));
    menu.addItem((item) => item.setTitle("Collapse all visible groups").setIcon("chevrons-up").onClick(() => this.run(async () => {
      this.smartQueues().forEach((queue) => this.collapsedQueues.add(queue.id));
      if (this.plugin.data.activeTab === "curriculum") {
        this.curriculum.domains.forEach((domain) => this.collapsedCurriculumDomains.add(domain.domain));
        const visit = (node: CurriculumTreeNode): void => { if (node.children.length > 0) this.collapsedCurriculumNodes.add(node.record.path); node.children.forEach(visit); };
        this.curriculum.domains.forEach((domain) => domain.roots.forEach(visit));
      } else if (this.plugin.data.activeTab === "collections") {
        this.plugin.data.collections.forEach((heading) => { heading.collapsed = true; heading.subheadings.forEach((sub) => { sub.collapsed = true; }); });
      }
      if (this.plugin.data.activeTab === "collections") await this.plugin.savePluginData();
      else this.persistCollapseState();
      this.renderTree();
    })));
    if (this.plugin.isClinicalMode()) {
      menu.addSeparator();
      // Preset conveniences for the original clinical vault layout, shown only
      // when this vault actually contains the corresponding Base files.
      const reviewQueueBase = "02 Maps of Content/Clinical Review Queue.base";
      if (this.app.vault.getAbstractFileByPath(reviewQueueBase) instanceof TFile) {
        menu.addItem((item) => item.setTitle("Open clinical review queue base").setIcon("layout-list").onClick(() => this.run(() => this.openRecord(reviewQueueBase))));
      }
      if (this.app.vault.getAbstractFileByPath(this.currentBasePath()) instanceof TFile) {
        menu.addItem((item) => item.setTitle("Open current library base").setIcon("database").onClick(() => this.run(() => this.openCurrentBase())));
      }
    }
    if (this.plugin.data.activeTab === "collections" && this.plugin.data.collections.length > 0) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Clear my collections").setIcon("rotate-ccw").onClick(() => {
        new ConfirmModal(this.app, "Clear my collections?", "All personal headings, subheadings, and memberships will be removed. Undo remains available. Source notes are untouched.", "Clear collections", async () => {
          await this.plugin.mutate("Clear my collections", () => { this.plugin.data.collections = []; });
        }).open();
      }));
    }
    if (this.plugin.data.activeTab === "curriculum" && (curriculumVisualHasChanges(this.plugin.data.curriculumVisual) || (this.plugin.canVisuallyMoveAcrossGroups() && Object.keys(this.plugin.data.indexGroupByPath).length > 0))) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(`Reset all visual ${this.plugin.data.settings.indexLabel.toLowerCase()} arrangement`).setIcon("rotate-ccw").onClick(() => {
        new ConfirmModal(this.app, `Reset visual ${this.plugin.data.settings.indexLabel.toLowerCase()} arrangement?`, `All visual nesting and custom order will return to the ${this.plugin.isClinicalMode() ? "canonical note metadata" : "configured parent metadata and folder grouping"}. Source notes will not be changed, and Undo remains available.`, "Reset arrangement", async () => {
          await this.plugin.mutate(`Reset all visual ${this.plugin.data.settings.indexLabel.toLowerCase()} arrangement`, () => {
            this.plugin.data.curriculumVisual = { parentByPath: {}, orderByContainer: {} };
            if (this.plugin.canVisuallyMoveAcrossGroups()) {
              this.plugin.data.indexGroupByPath = {};
              this.plugin.data.indexGroupOrder = [];
            }
          });
        }).open();
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Save organization snapshot").setIcon("archive").onClick(() => this.saveOrganizationSnapshot()));
    if (this.plugin.data.layoutSnapshots.length > 0) {
      menu.addItem((item) => item.setTitle("Restore organization snapshot…").setIcon("history").onClick(() => this.showOrganizationSnapshots(event)));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Export organization backup").setIcon("download").onClick(() => this.run(() => this.exportOrganizationBackup())));
    menu.addItem((item) => item.setTitle("Import organization backup…").setIcon("upload").onClick(() => this.importOrganizationBackup()));
    menu.showAtMouseEvent(event);
  }

  private saveOrganizationSnapshot(): void {
    new TextPromptModal(this.app, {
      title: "Save organization snapshot",
      placeholder: this.plugin.isClinicalMode() ? "e.g. Before airway exam block" : "e.g. Before reorganizing projects",
      submitLabel: "Save snapshot",
      onSubmit: async (name) => {
        const snapshot = snapshotPersonal(this.plugin.data, name);
        const candidates = [...this.plugin.data.layoutSnapshots, snapshot];
        const next = limitSnapshotStack(candidates, 10);
        if (!next.includes(snapshot)) {
          new Notice("This organization is too large for an in-plugin snapshot. Export an organization backup instead.", 8000);
          return;
        }
        if (snapshotStackDepthIsTruncated(candidates, next, 10)) {
          new Notice(`Only the ${next.length} most recent snapshot${next.length === 1 ? "" : "s"} fit in the plugin data budget. Export an organization backup to keep older ones.`, 8000);
        }
        this.plugin.data.layoutSnapshots = next;
        await this.plugin.savePluginData();
        new Notice(`Saved organization snapshot “${name}”.`);
      },
    }).open();
  }

  private showOrganizationSnapshots(event: MouseEvent): void {
    const menu = new Menu();
    for (const snapshot of [...this.plugin.data.layoutSnapshots].reverse()) {
      menu.addItem((item) => item
        .setTitle(`${snapshot.label} · ${new Date(snapshot.at).toLocaleDateString()}`)
        .setIcon("history")
        .onClick(() => this.run(async () => {
          await this.plugin.mutate(`Restore snapshot “${snapshot.label}”`, () => restoreSnapshot(this.plugin.data, snapshot));
          new Notice(`Restored organization snapshot “${snapshot.label}”.`);
        })));
    }
    menu.showAtMouseEvent(event);
  }

  private async exportOrganizationBackup(): Promise<void> {
    try {
      const now = new Date();
      const backup = createPersonalBackup(this.plugin.data, now.toISOString());
      if (Platform.isMobile) {
        await this.plugin.writePortableJson("backup", backup);
        new Notice("Backup saved in the export folder inside the vault. Source notes were not included.");
        return;
      }
      const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
      const url = viewWindow.URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = createEl("a");
      link.href = url;
      const slug = this.plugin.data.settings.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "knowledge-command-center";
      link.download = `${slug}-backup-${now.toISOString().slice(0, 10)}.json`;
      link.click();
      viewWindow.setTimeout(() => viewWindow.URL.revokeObjectURL(url), 1000);
      new Notice("Organization backup exported. Source notes were not included.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private importOrganizationBackup(): void {
    if (Platform.isMobile) {
      const files = this.plugin.getPortableJsonFiles();
      if (files.length === 0) {
        new Notice("No JSON files were found in the vault. Copy a backup JSON into the vault, then try again.");
        return;
      }
      new VaultFilePickerModal(this.app, files, "Choose an organization backup JSON", async (file) => {
        try {
          this.confirmOrganizationImport(this.plugin.readPortableJson(file));
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      }).open();
      return;
    }
    const input = createEl("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((raw) => {
        this.confirmOrganizationImport(Promise.resolve(JSON.parse(raw) as unknown));
      }).catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
    });
    input.click();
  }

  private confirmOrganizationImport(input: Promise<unknown>): void {
    void input.then((value) => {
      const backup = parsePersonalBackup(value);
      new ConfirmModal(
        this.app,
        "Import organization backup?",
        `Replace current personal collections, index membership and visual groups, pins, next list, saved views, and snapshots with the backup from ${backup.exportedAt || "an unknown date"}? Source notes will not be changed.`,
        "Import backup",
        async () => {
          await this.plugin.mutate("Import organization backup", () => {
            this.plugin.data.collections = backup.collections;
            this.plugin.data.pinnedPaths = backup.pinnedPaths;
            this.plugin.data.nextStudyPaths = backup.nextStudyPaths;
            this.plugin.data.savedViews = backup.savedViews;
            this.plugin.data.curriculumVisual = backup.curriculumVisual;
            this.plugin.data.manualIndexPaths = backup.manualIndexPaths;
            this.plugin.data.excludedIndexPaths = backup.excludedIndexPaths;
            this.plugin.data.indexGroupByPath = backup.indexGroupByPath;
            this.plugin.data.indexGroupOrder = backup.indexGroupOrder;
            this.plugin.data.layoutSnapshots = limitSnapshotStack(backup.layoutSnapshots, 10);
          });
          new Notice("Organization backup imported. Undo is available.");
        },
      ).open();
    }).catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
  }

  private saveCurrentSearch(): void {
    new TextPromptModal(this.app, {
      title: "Save current view", placeholder: this.plugin.isClinicalMode() ? "e.g. Pediatric P1 source gaps" : "e.g. Active research projects", submitLabel: "Save view",
      onSubmit: async (name) => this.plugin.mutate(`Save view “${name}”`, () => {
        this.plugin.data.savedViews.push({ id: makeId("view"), name, tab: this.plugin.data.activeTab, query: this.query });
      }),
    }).open();
  }

  private showSavedViews(event: MouseEvent): void {
    const menu = new Menu();
    if (this.plugin.data.savedViews.length === 0) menu.addItem((item) => item.setTitle("No saved views yet").setDisabled(true));
    for (const view of this.plugin.data.savedViews) {
      menu.addItem((item) => item.setTitle(view.name).setIcon("bookmark").onClick(() => this.run(async () => {
        this.query = view.query;
        this.plugin.data.activeTab = view.tab;
        await this.plugin.savePluginData();
        this.render();
      })));
    }
    if (this.plugin.data.savedViews.length > 0) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Manage saved views").setIcon("list-x").onClick(() => this.showDeleteSavedViews(event)));
    }
    menu.showAtMouseEvent(event);
  }

  private showDeleteSavedViews(event: MouseEvent): void {
    const menu = new Menu();
    for (const view of this.plugin.data.savedViews) {
      menu.addItem((item) => item.setTitle(`Delete “${view.name}”`).setIcon("trash-2").onClick(() => this.run(async () => {
        await this.plugin.mutate(`Delete saved view “${view.name}”`, () => {
          this.plugin.data.savedViews = this.plugin.data.savedViews.filter((item) => item.id !== view.id);
        });
      })));
    }
    menu.showAtMouseEvent(event);
  }

  private writeCurriculumDrag(event: DragEvent, payload: CurriculumDrag): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-ent-command-center-curriculum", JSON.stringify(payload));
  }

  private readCurriculumDrag(event: DragEvent): CurriculumDrag | null {
    const raw = event.dataTransfer?.getData("application/x-ent-command-center-curriculum");
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as CurriculumDrag;
      return value.kind === "curriculum-record" && typeof value.path === "string" ? value : null;
    } catch { return null; }
  }

  private applyCurriculumDomainDrop(element: HTMLElement, domain: CurriculumDomainTree): void {
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      element.addClass("is-drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    element.addEventListener("dragleave", (event) => {
      if (!element.contains(event.relatedTarget as Node | null)) element.removeClass("is-drop-target");
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      element.removeClass("is-drop-target");
      const payload = this.readCurriculumDrag(event);
      const record = payload ? this.recordByPath.get(payload.path) : undefined;
      if (!record) return;
      if (record.domain !== domain.domain && !this.plugin.canVisuallyMoveAcrossGroups()) {
        new Notice(`Visual moves must stay inside the same ${this.plugin.data.settings.groupLabel.toLowerCase()}.`);
        return;
      }
      const roots = domain.roots.map((node) => node.record.path).filter((path) => path !== record.path);
      if (record.domain !== domain.domain) {
        this.run(() => this.moveIndexRecordToGroup(record, domain.domain, null, roots, roots.length, `Move “${record.title}” to ${domain.domain} top level`));
      } else {
        this.run(() => this.moveCurriculumRecord(record, null, roots, roots.length, `Move “${record.title}” to ${domain.domain} top level`));
      }
    });
  }

  private applyCurriculumRowDrop(row: HTMLElement, target: VaultRecord): void {
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = row.getBoundingClientRect();
      const position = (event.clientY - rect.top) / Math.max(rect.height, 1);
      row.toggleClass("is-drop-before", position < 0.3);
      row.toggleClass("is-drop-inside", position >= 0.3 && position <= 0.7);
      row.toggleClass("is-drop-after", position > 0.7);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragleave", (event) => {
      if (!row.contains(event.relatedTarget as Node | null)) row.removeClass("is-drop-before", "is-drop-inside", "is-drop-after");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const inside = row.hasClass("is-drop-inside");
      const after = row.hasClass("is-drop-after");
      row.removeClass("is-drop-before", "is-drop-inside", "is-drop-after");
      const payload = this.readCurriculumDrag(event);
      const record = payload ? this.recordByPath.get(payload.path) : undefined;
      if (!record || record.path === target.path) return;
      if (inside) {
        const children = this.curriculumChildrenPaths(target.path).filter((path) => path !== record.path);
        this.collapsedCurriculumNodes.delete(target.path);
        this.persistCollapseState();
        if (this.plugin.canVisuallyMoveAcrossGroups() && record.domain !== target.domain) {
          this.run(() => this.moveIndexRecordToGroup(record, target.domain, target.path, children, children.length, `Nest “${record.title}” under “${target.title}”`));
        } else {
          this.run(() => this.moveCurriculumRecord(record, target.path, children, children.length, `Nest “${record.title}” under “${target.title}”`));
        }
        return;
      }
      const parentPath = this.curriculum.parentByPath.get(target.path) ?? null;
      const siblings = curriculumSiblingPaths(this.curriculum, target).filter((path) => path !== record.path);
      const targetIndex = siblings.indexOf(target.path);
      if (this.plugin.canVisuallyMoveAcrossGroups() && record.domain !== target.domain) {
        this.run(() => this.moveIndexRecordToGroup(record, target.domain, parentPath, siblings, Math.max(0, targetIndex + (after ? 1 : 0)), `Move and reorder “${record.title}”`));
      } else {
        this.run(() => this.moveCurriculumRecord(record, parentPath, siblings, Math.max(0, targetIndex + (after ? 1 : 0)), `Reorder “${record.title}”`));
      }
    });
  }

  private writeDrag(event: DragEvent, payload: DragMembership): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-ent-command-center-membership", JSON.stringify(payload));
  }

  private readDrag(event: DragEvent): DragMembership | null {
    const raw = event.dataTransfer?.getData("application/x-ent-command-center-membership");
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as DragMembership;
      return value.kind === "membership" && typeof value.path === "string" && typeof value.headingId === "string" ? value : null;
    } catch { return null; }
  }

  private applyDrop(element: HTMLElement, target: Membership): void {
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      element.addClass("is-drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    element.addEventListener("dragleave", (event) => {
      if (!element.contains(event.relatedTarget as Node | null)) element.removeClass("is-drop-target");
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      element.removeClass("is-drop-target");
      const payload = this.readDrag(event);
      if (!payload) return;
      this.run(() => this.plugin.mutate("Move record membership", () => {
        this.removeMembership(payload.path, payload);
        this.addMembership(payload.path, target);
      }));
    });
  }

  private applyRowDrop(row: HTMLElement, target: Membership, targetPath: string): void {
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      row.toggleClass("is-drop-before", !after);
      row.toggleClass("is-drop-after", after);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragleave", (event) => {
      if (!row.contains(event.relatedTarget as Node | null)) row.removeClass("is-drop-before", "is-drop-after");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const after = row.hasClass("is-drop-after");
      row.removeClass("is-drop-before", "is-drop-after");
      const payload = this.readDrag(event);
      if (!payload || payload.path === targetPath) return;
      this.run(() => this.plugin.mutate("Place record in collection order", () => {
        this.removeMembership(payload.path, payload);
        const list = this.membershipList(target);
        const existing = list.indexOf(payload.path);
        if (existing >= 0) list.splice(existing, 1);
        const targetIndex = list.indexOf(targetPath);
        list.splice(Math.max(0, targetIndex + (after ? 1 : 0)), 0, payload.path);
      }));
    });
  }

  private async openRecord(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice("The note could not be found.");
      return;
    }
    await this.plugin.openFile(file);
  }

  private async openCurrentBase(): Promise<void> {
    await this.openRecord(this.currentBasePath());
  }

  private currentBasePath(): string {
    return this.plugin.data.activeTab === "procedures"
      ? "04 Procedures/Procedures.base"
      : this.plugin.data.activeTab === "medications"
        ? "06 Clinical Tools/Medications/Medications.base"
        : this.plugin.data.activeTab === "syndromes"
          ? "06 Clinical Tools/Syndromes/Syndromes.base"
          : "02 Maps of Content/Clinical Topics.base";
  }
}
