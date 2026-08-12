import { ItemView, Menu, Notice, Platform, setIcon, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import type { CatalogPlacementTarget } from "./main";
import { IndexManagerModal, type ManagerTab } from "./index-manager";
import { ExportImportCenterModal } from "./portability-modal";
import { PortfolioTransferModal } from "./portfolio-modal";
import { MAX_PORTABLE_PACKAGE_BYTES } from "./portability";
import { CreateKnowledgeBaseModal, ManageKnowledgeBasesModal } from "./knowledge-base-modal";
import { LibraryEditorModal, ManageLibrariesModal } from "./library-modal";
import { resolveLibraryIconId } from "./library-icons";
import {
  assertPersonalBackupMatchesVault,
  buildCurriculumTree,
  canonicalPath,
  childSubheadings,
  clonePersonalOrganization,
  curriculumChildPaths,
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
  isExtensionCurriculumId,
  LayoutHeading,
  LibraryDefinition,
  libraryIdFromTab,
  libraryTabId,
  LayoutSubheading,
  limitSnapshotStack,
  MainTab,
  makeId,
  MAX_LAYOUT_DEPTH,
  matchesParsedQuery,
  metadataHasGap,
  ParsedQuery,
  parseQuery,
  recordBelongsToIndex,
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
  TemplateTokenContext,
  unknownQueryTokens,
  validateWritableFolderPath,
  validateTemplateFilePath,
  VaultRecord,
  visualPlacementPathSet,
} from "./model";
import {
  DEFAULT_CROSS_BASE_SEARCH_LIMIT,
  knowledgeBaseSearchRank,
  type KnowledgeBaseSearchGroup as BoundedKnowledgeBaseSearchGroup,
  type KnowledgeBaseSearchResultSet as BoundedKnowledgeBaseSearchResultSet,
  type KnowledgeBaseSearchSource,
  type KnowledgeBaseSearchSourceIdentity,
} from "./search";
import {
  AddActionModal,
  CollectionPickerModal,
  type CollectionTarget,
  collectionTargets,
  ConfirmModal,
  createOpenedBaseGuard,
  deliverJsonExport,
  IndexGroupModal,
  KnowledgeNoteModal,
  requestJsonImport,
  RecordPickerModal,
  TextPromptModal,
  TopicEditorModal,
  VaultFilePickerModal,
  WorkspaceSetupModal,
} from "./modals";

export const VIEW_TYPE = "ent-vault-command-center-view";
export const MAX_RENDERED_SEARCH_RESULTS = DEFAULT_CROSS_BASE_SEARCH_LIMIT;
export const MAX_RENDERED_BROWSE_RECORDS = 300;
export const MAX_RENDERED_BROWSE_STRUCTURES = 300;
export type KnowledgeBaseSearchGroup = BoundedKnowledgeBaseSearchGroup<KnowledgeBaseSearchSourceIdentity>;
export type KnowledgeBaseSearchResultSet = BoundedKnowledgeBaseSearchResultSet<KnowledgeBaseSearchSourceIdentity>;

interface Membership {
  headingId: string;
  subheadingId?: string;
}

type CatalogDestination = "topic" | { libraryId: string };

interface LibraryMembership extends Membership {
  libraryId: string;
}

interface DragMembership extends Membership {
  kind: "membership";
  path: string;
}

interface LibraryDragMembership extends LibraryMembership {
  kind: "library-membership";
  subjectId: string;
  ownerViewId: string;
  renderToken: string;
  baseId: string;
  dataEpoch: number;
}

type NewLibraryDragMembership = Omit<LibraryDragMembership, "ownerViewId" | "renderToken" | "baseId" | "dataEpoch">;

interface CurriculumDrag {
  kind: "curriculum-record";
  path: string;
}

interface CollectionsLayoutContext {
  kind: "collections";
  heading: LayoutHeading;
  mutable: boolean;
}

interface LibraryLayoutContext {
  kind: "library";
  heading: LayoutHeading;
  library: LibraryDefinition;
  bySubjectId: Map<string, VaultRecord>;
}

/** Per-heading context threaded through the shared Collections/library renderer. */
type LayoutRenderContext = CollectionsLayoutContext | LibraryLayoutContext;

interface QueueDefinition {
  id: string;
  title: string;
  description: string;
  records: VaultRecord[];
}

interface TabDefinition { id: MainTab; label: string; icon: string }

const libraryIdForTab = (tab: MainTab): string | null => libraryIdFromTab(tab);

/** Only identities explicitly completed from an imported placeholder may change or remove their local binding. */
export function canRelinkPortableRecord(
  record: Pick<VaultRecord, "portableId" | "portableRelinkable" | "isPlaceholder">,
): boolean {
  return Boolean(record.portableId && record.portableRelinkable && !record.isPlaceholder);
}

function libraryLabel(library: Pick<LibraryDefinition, "name" | "singularName">, plural = false): string {
  return plural ? library.name : library.singularName;
}

function libraryIcon(library: Pick<LibraryDefinition, "icon">): string {
  return resolveLibraryIconId(library.icon);
}

interface SearchRecordContext {
  source: KnowledgeBaseSearchSource;
}

export interface SearchViewportLayout {
  height: number;
  keyboardInset: number;
  keyboardOpen: boolean;
  shift: number;
}

export type PaneLayout = "wide" | "compact" | "narrow";

export const PANE_WIDE_MIN_WIDTH = 1050;
export const PANE_COMPACT_MIN_WIDTH = 680;

/** Classify the space Obsidian assigned to this leaf, independent of window size. */
export function classifyPaneWidth(width: number): PaneLayout {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  if (safeWidth >= PANE_WIDE_MIN_WIDTH) return "wide";
  if (safeWidth >= PANE_COMPACT_MIN_WIDTH) return "compact";
  return "narrow";
}

function measuredPaneWidth(element: HTMLElement): number {
  const rectWidth = element.getBoundingClientRect().width;
  const clientWidth = element.clientWidth;
  return Math.max(
    Number.isFinite(rectWidth) ? rectWidth : 0,
    Number.isFinite(clientWidth) ? clientWidth : 0,
  );
}

/**
 * Observe one stable Obsidian leaf element using its owning window. A zero-width
 * callback means the stacked tab is temporarily hidden, not that its layout
 * should be discarded.
 */
export function observePaneWidth(element: HTMLElement, onWidth: (width: number) => void): () => void {
  const viewWindow = element.ownerDocument.defaultView;
  if (!viewWindow) return () => undefined;
  let active = true;
  const report = (width: number): void => {
    if (active && Number.isFinite(width) && width > 0) onWidth(width);
  };
  const sync = (): void => report(measuredPaneWidth(element));
  const ResizeObserverConstructor = (viewWindow as Window & {
    ResizeObserver?: typeof ResizeObserver;
  }).ResizeObserver;
  if (ResizeObserverConstructor) {
    const observer = new ResizeObserverConstructor((entries) => {
      const entry = entries.find((candidate) => candidate.target === element);
      report(entry?.contentRect.width ?? measuredPaneWidth(element));
    });
    observer.observe(element);
    sync();
    return () => {
      active = false;
      observer.disconnect();
    };
  }
  viewWindow.addEventListener("resize", sync);
  sync();
  return () => {
    active = false;
    viewWindow.removeEventListener("resize", sync);
  };
}

/**
 * Fit the focused search route into the part of an iOS layout viewport that is
 * not covered by the virtual keyboard. The command center begins below
 * Obsidian's own title bar, so subtract the keyboard inset from its measured
 * content height instead of assigning visualViewport.height directly. When
 * iOS pans the visual viewport below the route's layout top, `shift` moves the
 * route down and its returned height is reduced by the same amount.
 */
export function calculateSearchViewportLayout(
  innerHeight: number,
  contentHeight: number,
  viewportHeight: number,
  viewportOffsetTop = 0,
  contentTop = 0,
): SearchViewportLayout {
  const safeInnerHeight = Number.isFinite(innerHeight) ? Math.max(1, innerHeight) : 1;
  const safeContentHeight = Number.isFinite(contentHeight)
    ? Math.max(1, Math.min(contentHeight, safeInnerHeight))
    : safeInnerHeight;
  const safeViewportHeight = Number.isFinite(viewportHeight)
    ? Math.max(1, Math.min(viewportHeight, safeInnerHeight))
    : safeInnerHeight;
  const safeOffsetTop = Number.isFinite(viewportOffsetTop)
    ? Math.max(0, Math.min(viewportOffsetTop, safeInnerHeight))
    : 0;
  const safeContentTop = Number.isFinite(contentTop)
    ? Math.max(-safeInnerHeight, Math.min(contentTop, safeInnerHeight))
    : 0;
  const visibleBottom = Math.min(safeInnerHeight, safeOffsetTop + safeViewportHeight);
  const keyboardInset = Math.max(0, safeInnerHeight - visibleBottom);
  // During iOS keyboard panning, visualViewport.offsetTop can move below the
  // command center's layout-viewport top. Move the focused route into view and
  // remove the same amount from its height so its bottom remains visible too.
  const shift = Math.max(0, safeOffsetTop - safeContentTop);
  return {
    height: Math.max(1, Math.round(safeContentHeight - keyboardInset - shift)),
    keyboardInset: Math.round(keyboardInset),
    keyboardOpen: safeInnerHeight - safeViewportHeight > 100,
    shift: Math.round(shift),
  };
}

export function tabDefinitions(
  settings: PluginSettings,
  _records: ReadonlyArray<Pick<VaultRecord, "kind" | "libraryId">> = [],
  configuredLibraries: ReadonlyArray<LibraryDefinition> = [],
): TabDefinition[] {
  const tabs: TabDefinition[] = [
    { id: "curriculum", label: settings.indexLabel, icon: "library" },
    { id: "inbox", label: settings.inboxLabel, icon: "inbox" },
    { id: "collections", label: "My Collections", icon: "folders" },
    { id: "queues", label: "Smart Queues", icon: "list-checks" },
  ];
  for (const library of [...configuredLibraries]
    .filter((candidate) => candidate.archivedAt === null)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))) {
    tabs.push({ id: libraryTabId(library.id), label: library.name, icon: libraryIcon(library) });
  }
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

/** Accessible in-view entry point shared by desktop and compact mobile layouts. */
export function createQuickEntryButton(parent: HTMLElement, onActivate: () => void): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: "ent-cc-button ent-cc-quick-entry-button",
    attr: { type: "button", "aria-label": "Open quick entry", title: "Open quick entry" },
  });
  setIcon(button.createSpan(), "zap");
  button.createSpan({ cls: "ent-cc-quick-entry-label", text: "Quick entry" });
  button.addEventListener("click", onActivate);
  return button;
}

/** Marks a disclosure control so assistive technology can announce open/closed state. */
function disclosureButton(parent: HTMLElement, collapsed: boolean, label: string): HTMLButtonElement {
  const button = iconButton(parent, collapsed ? "chevron-right" : "chevron-down", `${collapsed ? "Expand" : "Collapse"} ${label}`, "ent-cc-disclosure");
  button.setAttribute("aria-expanded", String(!collapsed));
  return button;
}

function titleForTab(
  tab: MainTab,
  settings: PluginSettings,
  records: VaultRecord[] = [],
  libraries: LibraryDefinition[] = [],
): string {
  return tabDefinitions(settings, records, libraries).find((item) => item.id === tab)?.label ?? "Records";
}

function uniqueRecords(records: VaultRecord[]): VaultRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.path)) return false;
    seen.add(record.path);
    return true;
  });
}

/** Search is intentionally knowledge-base wide; tabs organize browsing, not discovery. */
export function matchingKnowledgeBaseRecords(records: VaultRecord[], query: string): VaultRecord[] {
  const parsedQuery = parseQuery(query);
  const matches = uniqueRecords(records.filter((record) => matchesParsedQuery(record, parsedQuery)));
  const rankByPath = new Map(matches.map((record) => [record.path, knowledgeBaseSearchRank(record, parsedQuery)]));
  return matches.sort((a, b) => {
    const rankDifference = (rankByPath.get(a.path) ?? 0) - (rankByPath.get(b.path) ?? 0);
    return rankDifference || a.title.localeCompare(b.title);
  });
}

type LayoutNode = LayoutHeading | LayoutSubheading;

/** All subject references in a node's subtree, in render order. */
function layoutSubjects(node: LayoutNode): string[] {
  const subjects = [...node.subjects];
  for (const child of childSubheadings(node)) subjects.push(...layoutSubjects(child));
  return subjects;
}

/** First subheading anywhere beneath a node that satisfies the predicate. */
function findNestedSubheading(node: LayoutNode, predicate: (candidate: LayoutSubheading) => boolean): LayoutSubheading | null {
  for (const child of childSubheadings(node)) {
    if (predicate(child)) return child;
    const nested = findNestedSubheading(child, predicate);
    if (nested) return nested;
  }
  return null;
}

/** Heading-to-node chain for a nested subheading id; null when the id is absent. */
function subheadingChain(
  heading: LayoutHeading,
  subheadingId: string,
): { chain: LayoutNode[]; node: LayoutSubheading } | null {
  const walk = (trail: LayoutNode[], parent: LayoutNode): { chain: LayoutNode[]; node: LayoutSubheading } | null => {
    const chain = [...trail, parent];
    for (const child of childSubheadings(parent)) {
      if (child.id === subheadingId) return { chain: [...chain, child], node: child };
      const nested = walk(chain, child);
      if (nested) return nested;
    }
    return null;
  };
  return walk([], heading);
}

/**
 * Owning top-level heading for a layout-unique id. nested is the node itself
 * when the id names a subheading at any depth, and null when it names the
 * heading; the plugin quick-entry API takes the two ids separately.
 */
function findLayoutNode(headings: LayoutHeading[], id: string): { heading: LayoutHeading; nested: LayoutSubheading | null } | null {
  for (const heading of headings) {
    if (heading.id === id) return { heading, nested: null };
    const nested = findNestedSubheading(heading, (node) => node.id === id);
    if (nested) return { heading, nested };
  }
  return null;
}

/** Visit every node in these layouts depth-first with its depth (heading = 1) and title path. */
function visitLayoutNodes(
  headings: LayoutHeading[],
  visit: (node: LayoutNode, depth: number, titles: string[]) => void,
): void {
  const walk = (node: LayoutNode, depth: number, titles: string[]): void => {
    visit(node, depth, titles);
    for (const child of childSubheadings(node)) walk(child, depth + 1, [...titles, child.title]);
  };
  for (const heading of headings) walk(heading, 1, [heading.title]);
}

/** Count subheadings nested anywhere beneath a node. */
function countNestedSubheadings(node: LayoutNode): number {
  return childSubheadings(node).reduce((sum, child) => sum + 1 + countNestedSubheadings(child), 0);
}

/**
 * Mutable child list of a node, created on demand. Callers that can empty the
 * list must restore the canonical leaf form via dropEmptyChildList afterwards.
 */
function ensureChildList(node: LayoutNode): LayoutSubheading[] {
  if (!node.subheadings) node.subheadings = [];
  return node.subheadings;
}

/** Canonical cleaned data keeps the nested key only while children exist. */
function dropEmptyChildList(node: LayoutNode, isHeading: boolean): void {
  if (!isHeading && node.subheadings && node.subheadings.length === 0) delete node.subheadings;
}

/** Levels occupied by a node's own subtree, counting the node itself as one. */
function layoutSubtreeHeight(node: LayoutNode): number {
  return 1 + childSubheadings(node).reduce((deepest, child) => Math.max(deepest, layoutSubtreeHeight(child)), 0);
}

/**
 * Every node under one heading that may become a subheading's new parent.
 *
 * A node can never move under itself or under one of its own descendants: the
 * subtree would detach from the layout, so both are skipped outright. The
 * remaining nodes must also leave room for the whole moved subtree, whose own
 * height can be more than one level — a destination at depth D receives a
 * subtree of height H and ends at level D + H, which MAX_LAYOUT_DEPTH caps.
 * The heading itself is offered as the explicit top-level destination.
 */
function subheadingReparentTargets(heading: LayoutHeading, subheadingId: string): CollectionTarget[] {
  const located = subheadingChain(heading, subheadingId);
  if (!located) return [];
  const height = layoutSubtreeHeight(located.node);
  const targets: CollectionTarget[] = [];
  const visit = (node: LayoutNode, depth: number, path: string): void => {
    // Returning here also skips the whole subtree below the moved node.
    if (node.id === subheadingId) return;
    if (depth + height <= MAX_LAYOUT_DEPTH) {
      targets.push(node.id === heading.id
        ? { headingId: heading.id, label: `${heading.title} (top level)` }
        : { headingId: heading.id, subheadingId: node.id, label: path });
    }
    for (const child of childSubheadings(node)) visit(child, depth + 1, `${path} / ${child.title}`);
  };
  visit(heading, 1, heading.title);
  return targets;
}

function collectionPaths(collections: LayoutHeading[]): string[] {
  const paths: string[] = [];
  for (const heading of collections) paths.push(...layoutSubjects(heading));
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
  /** Window that owns the currently rendered leaf and therefore its timers. */
  private timerWindow: Window = window.activeWindow ?? window;
  private windowMigrationCleanup: (() => void) | null = null;
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
  private globalSearchResult: BoundedKnowledgeBaseSearchResultSet<KnowledgeBaseSearchSource> | null = null;
  private globalSearchResultKey = "";
  private globalSearchResultScopeKey = "";
  private globalSearchPendingKey = "";
  private globalSearchErrorKey = "";
  private globalSearchErrorMessage = "";
  private globalSearchRequestGeneration = 0;
  private browseRowLimit = MAX_RENDERED_BROWSE_RECORDS;
  private browseStructureLimit = MAX_RENDERED_BROWSE_STRUCTURES;
  private browseRowsRendered = 0;
  private browseRowsOmitted = 0;
  private browseStructuresRendered = 0;
  private browseStructuresOmitted = 0;
  private viewClosed = false;
  private searchViewportWindow: Window | null = null;
  private paneLayout: PaneLayout = "narrow";
  private paneWidth = 0;
  private paneLayoutRenderInProgress = false;
  private paneResizeWindow: Window | null = null;
  private paneResizeCleanup: (() => void) | null = null;
  private collapsedQueues = new Set<string>();
  private collapsedCurriculumDomains = new Set<string>();
  private collapsedCurriculumNodes = new Set<string>();
  private visualPlacementPaths = new Set<string>();
  private readonly viewInstanceId = makeId("view");
  /** Invalidates an in-flight desktop drag whenever its rendered tree is replaced. */
  private libraryDragRenderToken = makeId("library-drag-render");
  /** In-flight drag payload; browsers keep dataTransfer unreadable during dragover. */
  private activeLibraryDrag: LibraryDragMembership | null = null;
  private setupPromptShown = false;
  private loadedBaseId = "";
  private loadedDataEpoch = 0;
  private staleViewNoticeShown = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: EntVaultCommandCenterPlugin) {
    super(leaf);
    this.collapsedQueues = new Set(plugin.data.collapsed.queues);
    this.collapsedCurriculumDomains = new Set(plugin.data.collapsed.curriculumDomains);
    this.collapsedCurriculumNodes = new Set(plugin.data.collapsed.curriculumNodes);
    this.loadedBaseId = plugin.getActiveKnowledgeBaseId();
    this.loadedDataEpoch = this.currentDataEpoch();
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Knowledge base command center"; }
  getIcon(): string { return "library-big"; }

  async onOpen(): Promise<void> {
    this.viewClosed = false;
    this.bindWindowMigration();
    this.measureAndApplyPaneLayout(false);
    await this.reload();
    this.bindPaneLayout();
    this.bindSearchViewportLayout();
    if (!this.plugin.data.settings.setupComplete && !this.setupPromptShown) {
      this.setupPromptShown = true;
      this.scheduleSetupPrompt();
    }
  }

  async onClose(): Promise<void> {
    this.viewClosed = true;
    this.globalSearchRequestGeneration += 1;
    this.globalSearchPendingKey = "";
    this.unbindWindowMigration();
    this.unbindPaneLayout();
    this.unbindSearchViewportLayout();
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

  onResize(): void {
    if (this.viewClosed) return;
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (ownerWindow && ownerWindow !== this.timerWindow) {
      // Fallback for Obsidian builds or test hosts that do not expose
      // HTMLElement.onWindowMigrated(). The migration hook remains the
      // deterministic path; onResize keeps older hosts safe.
      this.handleWindowMigration(ownerWindow);
      return;
    }
    // Obsidian can adopt a leaf into a pop-out window. Rebind both observers
    // to the element's current owner instead of retaining the original window.
    this.bindPaneLayout();
    this.bindSearchViewportLayout();
    this.measureAndApplyPaneLayout();
    this.syncSearchViewportLayout();
  }

  /**
   * Obsidian migrates an existing leaf element when it moves into or out of a
   * pop-out. Rebind every window-owned observer and move pending timers before
   * the old window can be closed or background-throttled.
   */
  private bindWindowMigration(): void {
    this.unbindWindowMigration();
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (ownerWindow) this.timerWindow = ownerWindow;
    if (typeof this.contentEl.onWindowMigrated !== "function") return;
    this.windowMigrationCleanup = this.contentEl.onWindowMigrated((migratedWindow) => {
      this.handleWindowMigration(migratedWindow);
    });
  }

  private unbindWindowMigration(): void {
    this.windowMigrationCleanup?.();
    this.windowMigrationCleanup = null;
  }

  private handleWindowMigration(migratedWindow: Window): void {
    if (this.viewClosed) return;
    // The callback argument is Obsidian's authoritative destination window.
    // ownerDocument is expected to agree after adoption, while the explicit
    // value also keeps this deterministic during the migration callback.
    const ownerWindow = migratedWindow;
    const previousWindow = this.timerWindow;
    const setupPending = this.setupTimer !== null;
    const searchPending = this.searchDebounce !== null;
    const selectionPending = this.selectionSaveTimer !== null;
    if (previousWindow !== ownerWindow) {
      for (const timer of [this.setupTimer, this.searchDebounce, this.selectionSaveTimer]) {
        if (timer !== null) previousWindow.clearTimeout(timer);
      }
      this.setupTimer = null;
      this.searchDebounce = null;
      this.selectionSaveTimer = null;
      this.timerWindow = ownerWindow;
    }
    this.bindPaneLayout();
    this.bindSearchViewportLayout();
    this.measureAndApplyPaneLayout();
    this.syncSearchViewportLayout();
    if (setupPending) this.scheduleSetupPrompt();
    if (searchPending) this.scheduleSearchRefresh(0);
    if (selectionPending) this.scheduleSelectionSave();
  }

  private scheduleSetupPrompt(delay = 100): void {
    if (this.viewClosed || this.plugin.data.settings.setupComplete) return;
    if (this.setupTimer !== null) this.timerWindow.clearTimeout(this.setupTimer);
    const ownsBase = this.createOpenedBaseGuard();
    this.setupTimer = this.timerWindow.setTimeout(() => {
      this.setupTimer = null;
      if (this.viewClosed || !ownsBase()) return;
      this.openSetupWizard();
    }, delay);
  }

  private scheduleSearchRefresh(delay = 120): void {
    if (this.searchDebounce !== null) this.timerWindow.clearTimeout(this.searchDebounce);
    const scheduledQuery = this.query;
    const scheduledBaseId = this.loadedBaseId;
    const scheduledDataEpoch = this.loadedDataEpoch;
    this.searchDebounce = this.timerWindow.setTimeout(() => {
      this.searchDebounce = null;
      if (this.viewClosed
        || scheduledQuery !== this.query
        || scheduledBaseId !== this.plugin.getActiveKnowledgeBaseId()
        || scheduledDataEpoch !== this.currentDataEpoch()) return;
      this.renderTree();
      this.resetSearchScrollPosition();
      this.timerWindow.requestAnimationFrame(() => {
        if (!this.viewClosed && scheduledQuery === this.query) this.resetSearchScrollPosition();
      });
    }, delay);
  }

  private scheduleSelectionSave(delay = 1000): void {
    if (this.selectionSaveTimer !== null) this.timerWindow.clearTimeout(this.selectionSaveTimer);
    const ownsBase = this.createOpenedBaseGuard();
    this.selectionSaveTimer = this.timerWindow.setTimeout(() => {
      this.selectionSaveTimer = null;
      if (this.viewClosed || !ownsBase()) return;
      this.run(() => this.saveSelectionState());
    }, delay);
  }

  async reload(withinOperation = false): Promise<void> {
    this.measureAndApplyPaneLayout(false);
    const activeBaseId = this.plugin.getActiveKnowledgeBaseId();
    const dataEpoch = this.currentDataEpoch();
    const baseChanged = this.loadedBaseId !== activeBaseId;
    const dataChanged = this.loadedDataEpoch !== dataEpoch;
    const focusedSearch = this.contentEl?.querySelector?.('.ent-cc-search-box input[type="search"]') as HTMLInputElement | null | undefined;
    const searchWasFocused = Boolean(focusedSearch && focusedSearch.ownerDocument.activeElement === focusedSearch);
    const searchSelectionStart = focusedSearch?.selectionStart ?? null;
    const searchSelectionEnd = focusedSearch?.selectionEnd ?? null;
    if (baseChanged || dataChanged) {
      // Delayed work was scheduled by the previously rendered base. Once this
      // view adopts the replacement data object, those callbacks would appear
      // current again and could save/search the wrong base.
      if (this.searchDebounce !== null) this.timerWindow.clearTimeout(this.searchDebounce);
      if (this.selectionSaveTimer !== null) this.timerWindow.clearTimeout(this.selectionSaveTimer);
      this.searchDebounce = null;
      this.selectionSaveTimer = null;
      this.globalSearchResult = null;
      this.globalSearchResultKey = "";
      this.globalSearchResultScopeKey = "";
      this.globalSearchPendingKey = "";
      this.globalSearchErrorKey = "";
      this.globalSearchErrorMessage = "";
      this.globalSearchRequestGeneration += 1;
      this.loadedBaseId = activeBaseId;
      this.loadedDataEpoch = dataEpoch;
      this.staleViewNoticeShown = false;
      // A Sync refresh of the same base must not erase what the user is typing.
      // A real base switch intentionally starts from that base's clean route.
      if (baseChanged) {
        this.query = "";
        this.parsedQuery = parseQuery("");
      }
      this.editMode = false;
      this.curriculumArrangeMode = false;
      this.mobileInspectorOpen = false;
      this.mobileInspectorNeedsFocus = false;
      this.mobileTreeScrollTop = 0;
      this.mobileInspectorScrollTop = 0;
      this.collapsedQueues = new Set(this.plugin.data.collapsed.queues);
      this.collapsedCurriculumDomains = new Set(this.plugin.data.collapsed.curriculumDomains);
      this.collapsedCurriculumNodes = new Set(this.plugin.data.collapsed.curriculumNodes);
    }
    this.records = this.plugin.getRecords();
    this.recordByPath = new Map(this.records.map((record) => [record.path, record]));
    if (await this.plugin.reconcileRecords(this.records, withinOperation)) {
      this.records = this.plugin.getRecords();
      this.recordByPath = new Map(this.records.map((record) => [record.path, record]));
    }
    if (!tabDefinitions(this.plugin.data.settings, this.records, this.plugin.getLibraries())
      .some((tab) => tab.id === this.plugin.data.activeTab)
      && !this.plugin.isDataReadOnly()) {
      this.plugin.data.activeTab = "curriculum";
      await this.plugin.saveViewState(withinOperation);
      if (!this.guardLoadedBase()) return;
    }
    this.curriculum = buildCurriculumTree(
      this.records,
      this.plugin.data.curriculumVisual,
      this.plugin.data.settings.workspaceMode === "ent-clinical",
    );
    // Ordinary vault changes can refresh only the result tree. Keeping the
    // input node alive prevents iOS from dismissing the software keyboard.
    if (searchWasFocused && !baseChanged && !dataChanged && this.treeEl) {
      this.refreshChromeCounts();
      this.renderTree();
      // The wide-layout inspector pane must not keep showing a record this
      // vault change deleted or renamed. Compact layouts render the inspector
      // as its own route and have no pane element here.
      if (!this.isCompactInspectorLayout() && this.inspectorEl) this.renderInspector();
      return;
    }
    this.render();
    if (searchWasFocused && !baseChanged) {
      const replacement = this.contentEl.querySelector<HTMLInputElement>('.ent-cc-search-box input[type="search"]');
      replacement?.focus({ preventScroll: true });
      if (replacement && searchSelectionStart !== null && searchSelectionEnd !== null
        && typeof replacement.setSelectionRange === "function") {
        replacement.setSelectionRange(searchSelectionStart, searchSelectionEnd);
      }
    }
  }

  /** Runs a fire-and-forget action, surfacing failures (for example read-only data) as a Notice. */
  private run(action: () => Promise<unknown>): void {
    void action().catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
  }

  /**
   * Bind a delayed modal, picker, or menu callback to the knowledge base that
   * opened it. This also covers the rare Sync fallback where that base was
   * archived or removed on another device while the local dialog stayed open.
   */
  private createOpenedBaseGuard(): () => boolean {
    // Capture the owner of the rendered DOM, not merely whichever base the
    // plugin has already switched to. During the async switch window old rows
    // can still receive a click while plugin.data points at the new base.
    return createOpenedBaseGuard(this.plugin, {
      message: "The active knowledge base changed. Close and reopen this action before continuing.",
      openedBaseId: this.loadedBaseId || this.plugin.getActiveKnowledgeBaseId(),
      openedDataEpoch: this.loadedBaseId ? this.loadedDataEpoch : this.currentDataEpoch(),
    });
  }

  private currentDataEpoch(): number {
    return typeof this.plugin.getDataEpoch === "function" ? this.plugin.getDataEpoch() : 0;
  }

  private currentSearchGeneration(): number {
    return typeof this.plugin.getSearchGeneration === "function" ? this.plugin.getSearchGeneration() : 0;
  }

  private globalSearchKey(query = this.query): string {
    return [
      this.plugin.getActiveKnowledgeBaseId(),
      this.currentDataEpoch(),
      this.currentSearchGeneration(),
      query,
    ].join("\u0000");
  }

  private globalSearchScopeKey(): string {
    return [
      this.plugin.getActiveKnowledgeBaseId(),
      this.currentDataEpoch(),
      this.currentSearchGeneration(),
    ].join("\u0000");
  }

  private cancelPendingGlobalSearch(): void {
    this.globalSearchRequestGeneration += 1;
    this.globalSearchPendingKey = "";
    this.globalSearchErrorKey = "";
    this.globalSearchErrorMessage = "";
  }

  private requestGlobalSearch(key: string, query: string): void {
    if (this.globalSearchPendingKey === key) return;
    const requestGeneration = ++this.globalSearchRequestGeneration;
    this.globalSearchPendingKey = key;
    this.globalSearchErrorKey = "";
    this.globalSearchErrorMessage = "";
    const cancelled = (): boolean => this.viewClosed
      || requestGeneration !== this.globalSearchRequestGeneration
      || this.globalSearchKey(query) !== key;
    void this.plugin.searchKnowledgeBases(query, {
      limit: MAX_RENDERED_SEARCH_RESULTS,
      isCancelled: cancelled,
    }).then((result) => {
      if (!result || cancelled()) {
        if (requestGeneration === this.globalSearchRequestGeneration && this.globalSearchPendingKey === key) {
          this.globalSearchPendingKey = "";
        }
        return;
      }
      this.globalSearchResult = result;
      this.globalSearchResultKey = key;
      this.globalSearchResultScopeKey = this.globalSearchScopeKey();
      this.globalSearchPendingKey = "";
      this.renderTree();
      this.resetSearchScrollPosition();
    }).catch((error) => {
      if (cancelled()) return;
      this.globalSearchPendingKey = "";
      this.globalSearchErrorKey = key;
      this.globalSearchErrorMessage = error instanceof Error ? error.message : String(error);
      new Notice(this.globalSearchErrorMessage);
      // renderGlobalSearchResults recognizes the error key and will not retry
      // until the user explicitly chooses Retry or changes the query.
      this.renderTree();
    });
  }

  /** Block clicks from the old DOM during the brief async base-switch save. */
  private guardLoadedBase(): boolean {
    if (this.loadedBaseId === this.plugin.getActiveKnowledgeBaseId()
      && this.loadedDataEpoch === this.currentDataEpoch()) return true;
    if (!this.staleViewNoticeShown) {
      this.staleViewNoticeShown = true;
      new Notice("The knowledge base changed. Wait for the command center to refresh, then try again.", 5000);
    }
    return false;
  }

  /** Serialize selection writes and expose the active write to onClose(). */
  private saveSelectionState(): Promise<void> {
    if (!this.guardLoadedBase()) return Promise.resolve();
    const previous = this.selectionSavePromise?.catch(() => undefined) ?? Promise.resolve();
    const save = previous.then(() => this.plugin.saveViewState());
    this.selectionSavePromise = save;
    return save.finally(() => {
      if (this.selectionSavePromise === save) this.selectionSavePromise = null;
    });
  }

  private persistCollapseState(): void {
    if (!this.guardLoadedBase()) return;
    this.plugin.data.collapsed = {
      curriculumDomains: [...this.collapsedCurriculumDomains],
      curriculumNodes: [...this.collapsedCurriculumNodes],
      queues: [...this.collapsedQueues],
    };
    this.run(() => this.plugin.saveViewState());
  }

  public openQuickEntry(explicitCurrentPath?: string): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const settings = this.plugin.data.settings;
    const bases = this.plugin.getKnowledgeBases();
    const actions = [
      ...(bases.length > 1 ? [{
        id: "switch-base",
        title: `Knowledge base: ${settings.workspaceName}`,
        description: "Choose which independent knowledge base receives this entry.",
        icon: "library-big",
      }] : []),
      { id: "create-subject", title: "Create subject without a note", description: `Add a portable No note subject to ${settings.indexLabel}; create or link its Markdown note later.`, icon: "bookmark-plus" },
      { id: "create-note", title: "Create note", description: "Choose the Index or a Library, a visual group, and empty or template-based content.", icon: "file-plus-2" },
      { id: "add-current", title: "Add current note", description: "Use the note that was active when Quick Entry opened; its file is not moved or rewritten.", icon: "panel-top" },
      { id: "add-existing", title: "Add existing note", description: "Choose an existing Markdown note, then its Index, Library, or Collection destination.", icon: "list-plus" },
      { id: "append-current", title: "Quick Append to current note", description: "Add a source, question, thought, lecture, reading item, or other follow-up under its managed category.", icon: "list-end" },
      { id: "append-existing", title: "Quick Append to another note", description: "Choose a Markdown note, then append one categorized follow-up item without moving the file.", icon: "file-input" },
      { id: "create-heading", title: "Create heading", description: "Create an Index group, Collection heading, or Library heading.", icon: "folder-plus" },
      { id: "create-subheading", title: "Create subheading", description: "Create a nested Index subject, Collection subheading, or Library subheading.", icon: "list-tree" },
      { id: "more", title: "More add actions", description: "Open the full Add or create menu for proposals, advanced workflows, and other actions.", icon: "ellipsis" },
    ];
    new AddActionModal(this.app, actions, (action) => {
      if (!ownsBase()) return;
      if (action.id === "switch-base") this.openQuickEntryBasePicker(explicitCurrentPath);
      else if (action.id === "create-subject") this.startQuickCreatePlaceholder();
      else if (action.id === "create-note") this.startQuickCreateNote();
      else if (action.id === "add-current") this.startQuickAddCurrentNote(explicitCurrentPath);
      else if (action.id === "add-existing") this.startQuickAddExistingNote();
      else if (action.id === "append-current") this.plugin.openQuickAppendCurrentNote(explicitCurrentPath);
      else if (action.id === "append-existing") this.plugin.openQuickAppendExistingNote();
      else if (action.id === "create-heading") this.startQuickCreateHeading();
      else if (action.id === "create-subheading") this.startQuickCreateSubheading();
      else this.openAddActions();
    }, `Quick Entry — ${settings.workspaceName}`).open();
  }

  private openQuickEntryBasePicker(explicitCurrentPath?: string): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const activeId = this.plugin.getActiveKnowledgeBaseId();
    const bases = this.plugin.getKnowledgeBases();
    new AddActionModal(this.app, bases.map((entry) => ({
      id: entry.id,
      title: entry.data.settings.workspaceName,
      description: entry.id === activeId
        ? "Current knowledge base"
        : `Switch to this ${entry.data.settings.workspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} knowledge base.`,
      icon: entry.id === activeId ? "check" : "library-big",
    })), (action) => {
      if (!ownsBase()) return;
      this.run(async () => {
        // The guard is checked immediately before the intentional switch. A
        // Sync replacement or another base switch while the picker was open
        // must never be mistaken for the user's explicit destination choice.
        if (!ownsBase()) return;
        if (action.id !== this.plugin.getActiveKnowledgeBaseId()) await this.plugin.switchKnowledgeBase(action.id);
        // Switching invalidates this view's original data guard. Re-acquire the
        // active view after the committed switch before opening another form.
        const activeView = await this.plugin.activateView();
        activeView.openQuickEntry(explicitCurrentPath);
      });
    }, "Choose knowledge base").open();
  }

  public startQuickCreatePlaceholder(): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    new TextPromptModal(this.app, {
      title: "Create subject without a note",
      placeholder: "Subject name",
      submitLabel: "Choose group",
      onSubmit: (title) => {
        if (!ownsBase()) return;
        new IndexGroupModal(this.app, {
          title: `Place “${title}” in ${this.plugin.data.settings.indexLabel}`,
          groupLabel: this.plugin.data.settings.groupLabel,
          initialValue: this.plugin.getIndexGroups()[0] ?? "Ungrouped",
          existingGroups: this.plugin.getIndexGroups(),
          submitLabel: "Create placeholder",
          onSubmit: async (group) => {
            if (!ownsBase()) return;
            await this.plugin.createQuickEntryPlaceholder({ title, group });
            if (!ownsBase()) return;
            new Notice(`Created “${title}” as a No note subject. No Markdown file was created.`);
          },
        }).open();
      },
    }).open();
  }

  public startQuickCreateHeading(): void {
    if (!this.guardLoadedBase()) return;
    const libraries = this.plugin.getLibraries();
    const actions = [
      { id: "index", title: `${this.plugin.data.settings.indexLabel} group`, description: "Create a stable visual group that can remain empty until subjects are added.", icon: "library" },
      { id: "collection", title: "Collection heading", description: "Create a reusable cross-category list.", icon: "folders" },
      ...libraries.map((library) => ({
        id: `library:${library.id}`,
        title: `${library.name} heading`,
        description: `Create an empty visual heading inside ${library.name}.`,
        icon: libraryIcon(library),
      })),
    ];
    const ownsBase = this.createOpenedBaseGuard();
    new AddActionModal(this.app, actions, (action) => {
      if (!ownsBase()) return;
      if (action.id === "index") {
        new TextPromptModal(this.app, {
          title: `Create ${this.plugin.data.settings.groupLabel.toLocaleLowerCase()}`,
          placeholder: `${this.plugin.data.settings.groupLabel} name`,
          submitLabel: "Create heading",
          onSubmit: async (title) => {
            if (!ownsBase()) return;
            await this.plugin.createQuickEntryIndexGroup(title);
          },
        }).open();
      } else if (action.id === "collection") {
        new TextPromptModal(this.app, {
          title: "Create collection heading",
          placeholder: "Collection name",
          submitLabel: "Create heading",
          onSubmit: async (title) => {
            if (!ownsBase()) return;
            await this.plugin.createQuickEntryCollectionHeading(title);
          },
        }).open();
      } else {
        const libraryId = action.id.slice("library:".length);
        const library = this.plugin.getLibrary(libraryId);
        if (!library) return;
        new TextPromptModal(this.app, {
          title: `Create heading in ${library.name}`,
          placeholder: "Heading name",
          submitLabel: "Create heading",
          onSubmit: async (title) => {
            if (!ownsBase()) return;
            await this.plugin.createQuickEntryLibraryHeading(libraryId, title);
          },
        }).open();
      }
    }, "Create heading").open();
  }

  public startQuickCreateSubheading(): void {
    if (!this.guardLoadedBase()) return;
    const actions = [
      ...(this.plugin.getIndexRecords().length > 0 ? [{
        id: "index",
        title: `Nested ${this.plugin.data.settings.itemSingular}`,
        description: `Create a No note subject beneath an existing ${this.plugin.data.settings.indexLabel} subject.`,
        icon: "list-tree",
      }] : []),
      ...(this.plugin.data.collections.length > 0 ? [{
        id: "collection",
        title: "Collection subheading",
        description: "Choose a Collection heading or nested subheading, then create one subheading inside it.",
        icon: "folders",
      }] : []),
      ...this.plugin.getLibraries()
        .filter((library) => (this.plugin.data.portableIndex.libraryLayouts[library.id] ?? []).length > 0)
        .map((library) => ({
          id: `library:${library.id}`,
          title: `${library.name} subheading`,
          description: `Choose a heading or nested subheading inside ${library.name}.`,
          icon: libraryIcon(library),
        })),
    ];
    if (actions.length === 0) {
      new Notice("Create a parent index subject, collection heading, or library heading first.");
      return;
    }
    const ownsBase = this.createOpenedBaseGuard();
    new AddActionModal(this.app, actions, (action) => {
      if (!ownsBase()) return;
      if (action.id === "index") this.openQuickIndexParentPicker();
      else if (action.id === "collection") this.openQuickCollectionHeadingPicker();
      else this.openQuickLibraryHeadingPicker(action.id.slice("library:".length));
    }, "Create subheading").open();
  }

  private openQuickIndexParentPicker(): void {
    const ownsBase = this.createOpenedBaseGuard();
    new RecordPickerModal(
      this.app,
      this.plugin.getIndexRecords(),
      "Choose parent subject",
      "Search indexed subjects…",
      (parent) => {
        if (!ownsBase()) return;
        new TextPromptModal(this.app, {
          title: `New subject under ${parent.title}`,
          placeholder: "Subheading or subject name",
          submitLabel: "Create placeholder",
          onSubmit: async (title) => {
            if (!ownsBase()) return;
            await this.plugin.createQuickEntryPlaceholder({ title, group: parent.domain || "Ungrouped", parentPath: parent.path });
            if (!ownsBase()) return;
            new Notice(`Created “${title}” under “${parent.title}” without creating a Markdown file.`);
          },
        }).open();
      },
    ).open();
  }

  /** Every node below the depth cap can parent one more subheading level. */
  private quickSubheadingParentActions(headings: LayoutHeading[]): Array<{ id: string; title: string; description: string; icon: string }> {
    const parents: Array<{ id: string; title: string; description: string; icon: string }> = [];
    visitLayoutNodes(headings, (node, depth, titles) => {
      if (depth >= MAX_LAYOUT_DEPTH) return;
      const nested = countNestedSubheadings(node);
      parents.push({
        id: node.id,
        title: titles.join(" / "),
        description: `${nested} nested subheading${nested === 1 ? "" : "s"}`,
        icon: "folder",
      });
    });
    return parents;
  }

  private openQuickCollectionHeadingPicker(): void {
    const ownsBase = this.createOpenedBaseGuard();
    new AddActionModal(this.app, this.quickSubheadingParentActions(this.plugin.data.collections), (action) => {
      if (!ownsBase()) return;
      const located = findLayoutNode(this.plugin.data.collections, action.id);
      if (!located) return;
      const parent = located.nested ?? located.heading;
      new TextPromptModal(this.app, {
        title: `New subheading in ${parent.title}`,
        placeholder: "Subheading name",
        submitLabel: "Create subheading",
        onSubmit: async (title) => {
          if (!ownsBase()) return;
          await this.plugin.createQuickEntryCollectionSubheading(located.heading.id, title, located.nested?.id);
        },
      }).open();
    }, "Choose Collection heading or subheading").open();
  }

  private openQuickLibraryHeadingPicker(libraryId: string): void {
    const library = this.plugin.getLibrary(libraryId);
    if (!library) return;
    const layout = this.plugin.data.portableIndex.libraryLayouts[libraryId] ?? [];
    if (layout.length === 0) {
      new Notice(`Create a heading in ${library.name} first.`);
      return;
    }
    const ownsBase = this.createOpenedBaseGuard();
    new AddActionModal(this.app, this.quickSubheadingParentActions(layout), (action) => {
      if (!ownsBase()) return;
      const located = findLayoutNode(this.plugin.data.portableIndex.libraryLayouts[libraryId] ?? [], action.id);
      if (!located) return;
      const parent = located.nested ?? located.heading;
      new TextPromptModal(this.app, {
        title: `New subheading in ${parent.title}`,
        placeholder: "Subheading name",
        submitLabel: "Create subheading",
        onSubmit: async (title) => {
          if (!ownsBase()) return;
          await this.plugin.createQuickEntryLibrarySubheading(libraryId, located.heading.id, title, located.nested?.id);
        },
      }).open();
    }, `Choose heading or subheading in ${library.name}`).open();
  }

  public startQuickCreateNote(): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const libraries = this.plugin.getLibraries()
      .filter((library) => !this.plugin.isClinicalMode() || library.sourceKind === null);
    const actions = [
      ...(!this.plugin.isClinicalMode() ? [{
        id: "index",
        title: `Create in ${this.plugin.data.settings.indexLabel}`,
        description: `Choose a ${this.plugin.data.settings.groupLabel.toLocaleLowerCase()}, destination folder, and empty or template content.`,
        icon: "library",
      }] : [{
        id: "proposal",
        title: "Create unverified topic proposal",
        description: "Use the protected clinical Inbox workflow; Quick Entry never bypasses review safeguards.",
        icon: "shield-alert",
      }]),
      ...libraries.map((library) => ({
        id: `library:${library.id}`,
        title: `Create ${library.singularName}`,
        description: `Create a note and classify it in ${library.name}.`,
        icon: libraryIcon(library),
      })),
      ...(!this.plugin.isClinicalMode() ? [{
        id: "inbox",
        title: `Create in ${this.plugin.data.settings.inboxLabel}`,
        description: "Create an empty or template-based note without adding it to the Index.",
        icon: "inbox",
      }] : []),
    ];
    new AddActionModal(this.app, actions, (action) => {
      if (!ownsBase()) return;
      if (action.id === "index") this.openQuickCreateIndexNote();
      else if (action.id === "proposal") this.startCreateProposal();
      else if (action.id === "inbox") this.startCreateKnowledgeNote({ folder: this.plugin.data.settings.proposalFolder }, false);
      else {
        const libraryId = action.id.slice("library:".length);
        this.openQuickLibraryPlacementPicker(libraryId, (target) => this.startCreateLibraryNote(libraryId, target));
      }
    }, "Quick create note").open();
  }

  private openQuickCreateIndexNote(): void {
    const ownsBase = this.createOpenedBaseGuard();
    new IndexGroupModal(this.app, {
      title: `Choose ${this.plugin.data.settings.groupLabel.toLocaleLowerCase()}`,
      groupLabel: this.plugin.data.settings.groupLabel,
      initialValue: this.plugin.getIndexGroups()[0] ?? "Ungrouped",
      existingGroups: this.plugin.getIndexGroups(),
      submitLabel: "Continue to note",
      onSubmit: (group) => {
        if (!ownsBase()) return;
        this.startCreateKnowledgeNote({}, false, async (file) => {
          if (!ownsBase()) return;
          await this.plugin.assignRecordToCatalog(file.path, "topic", { headingTitle: group });
        }, `${this.plugin.data.settings.itemSingular} created in ${this.plugin.data.settings.indexLabel} under ${group}. Existing notes were not changed.`);
      },
    }).open();
  }

  public startQuickAddExistingNote(): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const libraries = this.plugin.getLibraries()
      .filter((library) => !this.plugin.isClinicalMode() || library.sourceKind === null);
    const actions = [
      ...(!this.plugin.isClinicalMode() ? [{ id: "index", title: `Add to ${this.plugin.data.settings.indexLabel}`, description: "Choose an eligible Markdown note and its visual group.", icon: "library" }] : []),
      ...libraries.map((library) => ({ id: `library:${library.id}`, title: `Add to ${library.name}`, description: "Classify an existing note without changing its file.", icon: libraryIcon(library) })),
      { id: "collection", title: "Add to a Collection", description: "Choose an existing note, then a Collection heading or subheading.", icon: "folders" },
    ];
    new AddActionModal(this.app, actions, (action) => {
      if (!ownsBase()) return;
      if (action.id === "index") this.startAddExistingToIndex();
      else if (action.id === "collection") this.startLinkVaultNote(false);
      else {
        const libraryId = action.id.slice("library:".length);
        this.openQuickLibraryPlacementPicker(libraryId, (target) => this.startAddExistingToLibrary(libraryId, target));
      }
    }, "Add existing note").open();
  }

  public startQuickAddCurrentNote(explicitPath?: string): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const file = explicitPath ? this.app.vault.getAbstractFileByPath(explicitPath) : this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") {
      new Notice("Open a Markdown note first, then run quick entry: add current note.");
      return;
    }
    const libraries = this.plugin.getLibraries()
      .filter((library) => !this.plugin.isClinicalMode() || library.sourceKind === null);
    const actions = [
      ...(!this.plugin.isClinicalMode() ? [{ id: "index", title: `Add to ${this.plugin.data.settings.indexLabel}`, description: "Choose a visual group; the current note stays in place.", icon: "library" }] : []),
      ...libraries.map((library) => ({ id: `library:${library.id}`, title: `Add to ${library.name}`, description: "Classify the current note without changing it.", icon: libraryIcon(library) })),
      { id: "collection", title: "Add to a Collection", description: "Place the current note in a reusable list.", icon: "folders" },
    ];
    new AddActionModal(this.app, actions, (action) => {
      if (!ownsBase()) return;
      if (action.id === "index") this.startQuickAddCurrentToIndex(file.path);
      else if (action.id === "collection") this.startAddCurrentNote(file.path);
      else {
        const libraryId = action.id.slice("library:".length);
        this.openQuickLibraryPlacementPicker(
          libraryId,
          (target) => this.startAddCurrentToLibrary(libraryId, file.path, target),
        );
      }
    }, `Add “${file.basename}”`).open();
  }

  private openQuickLibraryPlacementPicker(
    libraryId: string,
    onChoose: (target: CatalogPlacementTarget) => void | Promise<void>,
  ): void {
    if (!this.guardLoadedBase()) return;
    const library = this.plugin.getLibrary(libraryId);
    if (!library || library.archivedAt !== null) return;
    const ownsBase = this.createOpenedBaseGuard();
    const layout = this.plugin.data.portableIndex.libraryLayouts[libraryId] ?? [];
    if (layout.length === 0) {
      new TextPromptModal(this.app, {
        title: `Create the first heading in ${library.name}`,
        placeholder: "Heading name",
        submitLabel: "Create heading and continue",
        onSubmit: async (title) => {
          if (!ownsBase()) return;
          const headingId = await this.plugin.createQuickEntryLibraryHeading(libraryId, title);
          if (!ownsBase()) return;
          await onChoose({ headingId });
        },
      }).open();
      return;
    }
    const targets = collectionTargets(layout);
    new CollectionPickerModal(this.app, targets, "Add", async (target) => {
      if (!ownsBase()) return;
      await onChoose({ headingId: target.headingId, subheadingId: target.subheadingId });
    }, `heading or subheading in ${library.name}`).open();
  }

  private startQuickAddCurrentToIndex(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice("The previously active Markdown note could not be found.");
      return;
    }
    const ownsBase = this.createOpenedBaseGuard();
    new IndexGroupModal(this.app, {
      title: `Place “${file.basename}” in ${this.plugin.data.settings.indexLabel}`,
      groupLabel: this.plugin.data.settings.groupLabel,
      initialValue: this.plugin.suggestedIndexGroup(file),
      existingGroups: this.plugin.getIndexGroups(),
      submitLabel: `Add to ${this.plugin.data.settings.indexLabel}`,
      onSubmit: async (group) => {
        if (!ownsBase()) return;
        await this.plugin.assignRecordToCatalog(file.path, "topic", { headingTitle: group });
        if (!ownsBase()) return;
        new Notice(`Added “${file.basename}” under ${group}. The Markdown note was not changed.`);
      },
    }).open();
  }

  public openAddActions(): void {
    const ownsBase = this.createOpenedBaseGuard();
    const settings = this.plugin.data.settings;
    const activeLibraryId = libraryIdForTab(this.plugin.data.activeTab);
    const activeLibrary = activeLibraryId ? this.plugin.getLibrary(activeLibraryId) : null;
    const activeLibraryAcceptsManualAdd = Boolean(activeLibrary
      && (!this.plugin.isClinicalMode() || activeLibrary.sourceKind === null));
    const addableLibraries = this.plugin.getLibraries()
      .filter((library) => !this.plugin.isClinicalMode() || library.sourceKind === null);
    const actions = [
      ...(activeLibrary && activeLibraryAcceptsManualAdd ? [
        { id: "create-active-library", title: `Create ${libraryLabel(activeLibrary)}`, description: `Create a Markdown note and classify it directly in ${libraryLabel(activeLibrary, true)}.`, icon: "file-plus-2" },
        { id: "existing-active-library", title: `Add existing note to ${libraryLabel(activeLibrary, true)}`, description: "Classify an existing Markdown note without moving or rewriting it.", icon: "list-plus" },
        { id: "current-active-library", title: `Add current note to ${libraryLabel(activeLibrary, true)}`, description: "Classify the open Markdown note without changing its file.", icon: "panel-top" },
      ] : []),
      { id: "create-note", title: `Create ${settings.itemSingular}`, description: "Start with an empty note or choose a Markdown template and destination folder.", icon: "file-plus-2" },
      ...(!this.plugin.isClinicalMode() ? [{ id: "index-existing", title: `Add existing note to ${settings.indexLabel}`, description: `Index any eligible Markdown note without moving or editing its file.`, icon: "list-plus" }] : []),
      ...(!activeLibraryAcceptsManualAdd && addableLibraries.length > 0 ? [
        { id: "choose-library", title: "Add to library…", description: "Choose a library, then create, select, or use the current note without changing Markdown.", icon: "library" },
      ] : []),
      { id: "new-library", title: "New library…", description: "Create another top-level section with its own headings and subheadings.", icon: "library-big" },
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
      if (!ownsBase()) return;
      if (action.id === "create-active-library" && activeLibrary) this.startCreateLibraryNote(activeLibrary.id);
      else if (action.id === "existing-active-library" && activeLibrary) this.startAddExistingToLibrary(activeLibrary.id);
      else if (action.id === "current-active-library" && activeLibrary) this.startAddCurrentToLibrary(activeLibrary.id);
      else if (action.id === "choose-library") this.openLibraryAddPicker();
      else if (action.id === "new-library") new LibraryEditorModal(this.plugin, null, () => this.render()).open();
      else if (action.id === "create-note") this.startCreateKnowledgeNote();
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

  private openLibraryAddPicker(): void {
    if (!this.guardLoadedBase()) return;
    const libraries = this.plugin.getLibraries()
      .filter((library) => !this.plugin.isClinicalMode() || library.sourceKind === null);
    if (libraries.length === 0) {
      new Notice("Create a custom library first, or add native clinical records through their existing source folders.");
      return;
    }
    const ownsBase = this.createOpenedBaseGuard();
    new AddActionModal(this.app, libraries.map((library) => ({
      id: library.id,
      title: library.name,
      description: `Add a ${library.singularName.toLocaleLowerCase()} without moving or rewriting its Markdown note.`,
      icon: libraryIcon(library),
    })), (action) => {
      if (ownsBase()) this.openCatalogAddActions(action.id);
    }, "Choose a library").open();
  }

  private openCatalogAddActions(libraryId: string): void {
    if (!this.guardLoadedBase()) return;
    const library = this.plugin.getLibrary(libraryId);
    if (!library || library.archivedAt !== null) return;
    if (this.plugin.isClinicalMode() && library.sourceKind !== null) {
      new Notice(`The built-in ${library.name} library follows native clinical source classification. Create a custom library for visual-only classification.`);
      return;
    }
    const ownsBase = this.createOpenedBaseGuard();
    new AddActionModal(this.app, [
      { id: "create", title: `Create ${libraryLabel(library)}`, description: `Create a Markdown note and classify it directly in ${libraryLabel(library, true)}.`, icon: "file-plus-2" },
      { id: "existing", title: "Add existing note", description: "Choose any eligible Markdown note; its path and contents will not change.", icon: "list-plus" },
      { id: "current", title: "Add current note", description: "Use the currently open Markdown note without modifying it.", icon: "panel-top" },
    ], (action) => {
      if (!ownsBase()) return;
      if (action.id === "create") this.startCreateLibraryNote(libraryId);
      else if (action.id === "existing") this.startAddExistingToLibrary(libraryId);
      else this.startAddCurrentToLibrary(libraryId);
    }, `Add to ${library.name}`).open();
  }

  private startCreateLibraryNote(libraryId: string, target: CatalogPlacementTarget = {}): void {
    const library = this.plugin.getLibrary(libraryId);
    if (!library || library.archivedAt !== null) return;
    if (this.plugin.isClinicalMode() && library.sourceKind !== null) {
      new Notice(`The built-in ${library.name} library follows native clinical source classification.`);
      return;
    }
    const ownsBase = this.createOpenedBaseGuard();
    const profile = this.plugin.getEffectiveLibraryNoteProfile(libraryId);
    this.startCreateKnowledgeNote({
      folder: profile.folder,
      mode: profile.mode,
      templatePath: profile.templatePath,
    }, false, async (file) => {
      if (!ownsBase()) return;
      await this.plugin.assignRecordToLibrary(file.path, libraryId, target);
    }, `${library.singularName} created and added to ${library.name}. The Markdown note was not rewritten.`, {
      createLabel: library.singularName,
      contextNotice: target.headingId
        ? `This Markdown note will be classified in the selected heading or subheading in ${library.name} after creation.`
        : `This Markdown note will be classified in ${library.name} after creation. You can choose its heading or subheading from the record’s actions menu.`,
      tokenContext: this.libraryTemplateTokenContext(library, target),
    });
  }

  private libraryTemplateTokenContext(
    library: LibraryDefinition,
    target: CatalogPlacementTarget = {},
    record?: VaultRecord,
  ): TemplateTokenContext {
    const layout = this.plugin.data.portableIndex.libraryLayouts[library.id] ?? [];
    const heading = target.headingId
      ? layout.find((candidate) => candidate.id === target.headingId)
      : target.subheadingId
        ? layout.find((candidate) => findNestedSubheading(candidate, (node) => node.id === target.subheadingId) !== null)
        : undefined;
    // {{yaml:category}} resolves to the exact node the subject is placed in,
    // however deep, falling back to the heading title.
    const subheading = target.subheadingId && heading
      ? findNestedSubheading(heading, (node) => node.id === target.subheadingId) ?? undefined
      : undefined;
    const subject = record?.portableId ? this.plugin.getPortableSubject(record.portableId) : null;
    const parent = subject?.parentId ? this.plugin.getPortableSubject(subject.parentId) : null;
    return {
      id: record?.curriculumId ?? "",
      category: subheading?.title ?? heading?.title ?? record?.domain ?? library.name,
      parent: parent?.title ?? record?.parentTopic ?? "",
      library: library.name,
      type: library.singularName,
    };
  }

  private libraryPlacementForSubject(libraryId: string, subjectId: string | undefined): CatalogPlacementTarget {
    if (!subjectId) return {};
    for (const heading of this.plugin.data.portableIndex.libraryLayouts[libraryId] ?? []) {
      if (heading.subjects.includes(subjectId)) return { headingId: heading.id };
      const subheading = findNestedSubheading(heading, (node) => node.subjects.includes(subjectId));
      if (subheading) return { headingId: heading.id, subheadingId: subheading.id };
    }
    return {};
  }

  private startAddExistingToLibrary(libraryId: string, target: CatalogPlacementTarget = {}): void {
    if (!this.guardLoadedBase()) return;
    const library = this.plugin.getLibrary(libraryId);
    if (!library || library.archivedAt !== null) return;
    const ownsBase = this.createOpenedBaseGuard();
    const alreadyClassified = new Set(this.records
      .filter((record) => record.libraryId === libraryId && !record.isPlaceholder)
      .map((record) => record.path));
    const files = this.plugin.getVaultNoteFiles(false).filter((file) => !alreadyClassified.has(file.path));
    if (files.length === 0) {
      new Notice(`Every eligible Markdown note is already classified in ${library.name}.`);
      return;
    }
    new VaultFilePickerModal(this.app, files, `Add existing note to ${library.name}`, async (file) => {
      if (!ownsBase()) return;
      await this.plugin.assignRecordToLibrary(file.path, libraryId, target);
      if (!ownsBase()) return;
      new Notice(`Added “${file.basename}” to ${library.name}. The note stayed at ${file.path} and its contents were not changed.`);
    }).open();
  }

  private startAddCurrentToLibrary(
    libraryId: string,
    explicitPath?: string,
    target: CatalogPlacementTarget = {},
  ): void {
    if (!this.guardLoadedBase()) return;
    const library = this.plugin.getLibrary(libraryId);
    if (!library || library.archivedAt !== null) return;
    const ownsBase = this.createOpenedBaseGuard();
    const file = explicitPath ? this.app.vault.getAbstractFileByPath(explicitPath) : this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") {
      new Notice(`Open a Markdown note first, then add it to ${library.name}.`);
      return;
    }
    this.run(async () => {
      if (!ownsBase()) return;
      await this.plugin.assignRecordToLibrary(file.path, libraryId, target);
      if (!ownsBase()) return;
      new Notice(`Added “${file.basename}” to ${library.name}. The Markdown note was not changed.`);
    });
  }

  public openIndexManager(initialTab: ManagerTab = "indexed"): void {
    new IndexManagerModal(this.plugin, initialTab).open();
  }

  public openPortabilityCenter(mode: "export" | "import" = "export"): void {
    new ExportImportCenterModal(this.plugin, mode).open();
  }

  public openPortfolioTransfer(): void {
    new PortfolioTransferModal(this.plugin).open();
  }

  public openKnowledgeBaseManager(): void {
    new ManageKnowledgeBasesModal(this.plugin).open();
  }

  public openLibraryManager(): void {
    new ManageLibrariesModal(this.plugin, () => this.render()).open();
  }

  private showKnowledgeBaseMenu(event: MouseEvent): void {
    const menu = new Menu();
    const activeId = this.plugin.getActiveKnowledgeBaseId();
    for (const entry of this.plugin.getKnowledgeBases()) {
      menu.addItem((item) => item
        .setTitle(`${entry.data.settings.workspaceName}${entry.id === activeId ? " (current)" : ""}`)
        .setIcon(entry.id === activeId ? "check" : "library-big")
        .setDisabled(entry.id === activeId)
        .onClick(() => this.run(() => this.plugin.switchKnowledgeBase(entry.id))));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("New knowledge base…").setIcon("plus").onClick(() => new CreateKnowledgeBaseModal(this.plugin).open()));
    menu.addItem((item) => item.setTitle("Manage knowledge bases…").setIcon("settings-2").onClick(() => this.openKnowledgeBaseManager()));
    menu.showAtMouseEvent(event);
  }

  private openPortableSubjectLinkPicker(record: VaultRecord): void {
    const ownsBase = this.createOpenedBaseGuard();
    const subjectId = record.portableId;
    if (!subjectId) {
      new Notice("This imported subject has no portable identity.");
      return;
    }
    const currentPath = this.plugin.data.portableIndex.resolvedPathBySubjectId[subjectId] ?? "";
    const files = this.plugin.getVaultNoteFiles(false).filter((file) => file.path !== currentPath);
    if (files.length === 0) {
      new Notice(currentPath
        ? "No other eligible Markdown notes are available to link."
        : "No eligible Markdown notes are available to link.");
      return;
    }
    new VaultFilePickerModal(
      this.app,
      files,
      `${currentPath ? "Change linked note for" : "Link note to"} “${record.title}”`,
      (file) => {
        if (!ownsBase()) return;
        return this.resolvePortableSubjectLink(subjectId, record.title, file);
      },
    ).open();
  }

  private async resolvePortableSubjectLink(subjectId: string, subjectTitle: string, file: TFile): Promise<void> {
    const ownsBase = this.createOpenedBaseGuard();
    if (!ownsBase()) return;
    const existingOwnerId = Object.entries(this.plugin.data.portableIndex.resolvedPathBySubjectId)
      .find(([candidateId, path]) => candidateId !== subjectId && path === file.path)?.[0] ?? "";
    if (existingOwnerId) {
      const existingOwner = this.plugin.getPortableSubject(existingOwnerId);
      new ConfirmModal(
        this.app,
        "Merge portable subjects?",
        `“${file.basename}” is already linked to the imported subject “${existingOwner?.title ?? file.basename}”. Linking it to “${subjectTitle}” will merge that portable identity into this subject and remove the duplicate identity. The Markdown note will not be changed, and Undo remains available.`,
        "Merge and link",
        async () => {
          if (!ownsBase()) return;
          await this.plugin.resolvePortableSubject(subjectId, file.path, true);
          if (!ownsBase()) return;
          new Notice(`Linked “${subjectTitle}” to “${file.basename}” after merging the duplicate portable identity. The Markdown note was not changed.`);
        },
      ).open();
      return;
    }
    await this.plugin.resolvePortableSubject(subjectId, file.path);
    if (!ownsBase()) return;
    new Notice(`Linked “${subjectTitle}” to “${file.basename}”. The Markdown note was not changed.`);
  }

  private confirmPortableSubjectUnlink(record: VaultRecord): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const subjectId = record.portableId;
    if (!subjectId) {
      new Notice("This note has no portable subject identity to unlink.");
      return;
    }
    new ConfirmModal(
      this.app,
      "Unlink note from imported subject?",
      `“${record.title}” will return to a No note placeholder with its imported hierarchy and personal organization. The Markdown note at ${record.path} will not be moved, changed, or deleted. Undo remains available.`,
      "Unlink note",
      async () => {
        if (!ownsBase()) return;
        await this.plugin.unlinkPortableSubject(subjectId);
        if (!ownsBase()) return;
        new Notice(`Unlinked “${record.title}”. The imported subject is a placeholder again, and the Markdown note was not changed.`);
      },
    ).open();
  }

  private openPlaceholderActions(record: VaultRecord): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    if (!record.portableId) {
      new Notice("This imported subject has no portable identity.");
      return;
    }
    const settings = this.plugin.data.settings;
    const library = record.libraryId ? this.plugin.getLibrary(record.libraryId) : null;
    const canCreateGenericNote = !this.plugin.isClinicalMode() || library?.sourceKind === null;
    const actions = !canCreateGenericNote
      ? [
          ...(record.kind === "topic" ? [{ id: "proposal", title: "Create unverified proposal", description: "Create a safety-gated topic proposal in the configured clinical Inbox, then link it.", icon: "shield-alert" }] : []),
          { id: "link", title: "Link existing note", description: "Connect this subject to an existing Markdown note without changing that note.", icon: "link" },
          { id: "keep", title: "Keep placeholder", description: "Leave the subject in the index with no Markdown note for now.", icon: "bookmark" },
        ]
      : [
          { id: "empty", title: "Create empty note", description: "Create a blank Markdown note and retain this subject’s group and hierarchy.", icon: "file-plus" },
          { id: "template", title: "Create from template", description: "Choose a local template, create a note, and retain this subject’s placement.", icon: "copy-plus" },
          { id: "link", title: "Link existing note", description: "Connect this subject to an existing Markdown note without changing that note.", icon: "link" },
          { id: "keep", title: "Keep placeholder", description: "Leave the subject in the index with no Markdown note for now.", icon: "bookmark" },
    ];
    new AddActionModal(this.app, actions, (action) => {
      if (!ownsBase()) return;
      const resolve = (file: TFile): Promise<void> => this.plugin.resolvePortableSubject(record.portableId ?? "", file.path);
      const profile = library
        ? this.plugin.getEffectiveLibraryNoteProfile(library.id)
        : { folder: settings.defaultNoteFolder, mode: settings.defaultNewNoteMode, templatePath: settings.defaultTemplatePath };
      const tokenContext = library
        ? this.libraryTemplateTokenContext(
            library,
            this.libraryPlacementForSubject(library.id, record.portableId),
            record,
          )
        : {
            id: record.curriculumId,
            category: record.domain,
            parent: record.parentTopic,
            library: "",
            type: record.topicKind,
          };
      const formContext = library ? {
        createLabel: library.singularName,
        contextNotice: `This note will resolve “${record.title}” in ${library.name} without rewriting any existing Markdown note.`,
        tokenContext,
      } : { tokenContext };
      if (action.id === "empty") {
        this.startCreateKnowledgeNote({ title: record.title, folder: profile.folder, mode: "empty", templatePath: profile.templatePath }, false, resolve, undefined, formContext);
      } else if (action.id === "template") {
        this.startCreateKnowledgeNote({ title: record.title, folder: profile.folder, mode: "template", templatePath: profile.templatePath }, false, resolve, undefined, formContext);
      } else if (action.id === "proposal") {
        this.startCreateProposal({ title: record.title, domain: record.domain, topicKind: "condition", priority: "P2", safetyCritical: false }, resolve);
      } else if (action.id === "link") {
        this.openPortableSubjectLinkPicker(record);
      } else {
        new Notice(`“${record.title}” remains available as a placeholder.`);
      }
    }, `Complete “${record.title}”`).open();
  }

  public startCreateKnowledgeNote(
    initial: Partial<GenericNoteFormValue> = {},
    indexAfterCreate = !this.plugin.isClinicalMode(),
    onCreated?: (file: TFile) => void | Promise<void>,
    completionMessage?: string,
    formContext?: { createLabel?: string; contextNotice?: string; tokenContext?: TemplateTokenContext },
  ): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const settings = this.plugin.data.settings;
    new KnowledgeNoteModal(this.app, {
      itemSingular: settings.itemSingular,
      ...formContext,
      templates: this.plugin.getTemplateFiles(),
      initial: {
        title: initial.title ?? "",
        folder: initial.folder ?? settings.defaultNoteFolder,
        mode: initial.mode ?? settings.defaultNewNoteMode,
        templatePath: initial.templatePath ?? settings.defaultTemplatePath,
        addToCollection: initial.addToCollection ?? false,
      },
      validate: (value) => ownsBase()
        ? this.plugin.validateGenericNote(value)
        : "The active knowledge base changed. Close and reopen this form.",
      onSubmit: async (value) => {
        if (!ownsBase()) return;
        const file = await this.plugin.createKnowledgeNote(value, formContext?.tokenContext);
        if (!ownsBase()) return;
        if (onCreated) {
          await onCreated(file);
          if (!ownsBase()) return;
        } else if (indexAfterCreate && !this.plugin.isClinicalMode()) {
          await this.plugin.mutate(`Add created ${settings.itemSingular} to ${settings.indexLabel}`, () => {
            this.plugin.data.excludedIndexPaths = this.plugin.data.excludedIndexPaths.filter((path) => path !== file.path);
            if (!pathIsInsideFolder(file.path, settings.primaryFolder) && !this.plugin.data.manualIndexPaths.includes(file.path)) {
              this.plugin.data.manualIndexPaths.push(file.path);
            }
            this.plugin.data.selectedPath = file.path;
          });
          if (!ownsBase()) return;
        } else {
          this.plugin.data.selectedPath = file.path;
          await this.plugin.saveViewState();
          if (!ownsBase()) return;
          await this.reload();
          if (!ownsBase()) return;
        }
        new Notice(completionMessage ?? (onCreated
          ? `${settings.itemSingular[0]?.toUpperCase() ?? "N"}${settings.itemSingular.slice(1)} created and linked to the imported subject.`
          : `${settings.itemSingular[0]?.toUpperCase() ?? "N"}${settings.itemSingular.slice(1)} created${indexAfterCreate && !this.plugin.isClinicalMode() ? ` and added to ${settings.indexLabel}` : ""}. Existing notes were not changed.`));
        if (value.addToCollection) this.openCollectionPicker(file.path);
        await this.plugin.openFile(file);
      },
    }).open();
  }

  public openSetupWizard(): void {
    const ownsBase = this.createOpenedBaseGuard();
    const settings = this.plugin.data.settings;
    new WorkspaceSetupModal(this.app, settings, async (value) => {
      if (!ownsBase()) return;
      this.plugin.assertDataWritable();
      for (const folder of [value.primaryFolder, value.defaultNoteFolder, value.templatesFolder, value.proposalFolder]) {
        const error = validateWritableFolderPath(folder, this.app.vault.configDir);
        if (error) throw new Error(error);
      }
      if (value.defaultNewNoteMode === "template") {
        const templatePathError = validateTemplateFilePath(value.defaultTemplatePath, value.templatesFolder, this.app.vault.configDir);
        if (templatePathError) throw new Error(templatePathError);
        const template = this.app.vault.getAbstractFileByPath(value.defaultTemplatePath);
        if (!(template instanceof TFile)) throw new Error("The selected default template could not be found.");
      }
      Object.assign(settings, value, { setupComplete: true, workspaceMode: "generic" });
      await this.plugin.savePluginData();
      if (!ownsBase()) return;
      await this.plugin.refreshViews();
      if (!ownsBase()) return;
      new Notice(`${settings.workspaceName} is ready. No existing note was modified.`);
    }).open();
  }

  public startAddExistingTopic(): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const topics = this.plugin.getIndexRecords();
    const settings = this.plugin.data.settings;
    new RecordPickerModal(this.app, topics, `Add indexed ${settings.itemSingular}`, `Search title, ID, ${settings.groupLabel.toLowerCase()}, or path…`, (record) => {
      if (!ownsBase()) return;
      this.openCollectionPicker(record.path);
    }).open();
  }

  public startAddExistingToIndex(): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
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
      if (!ownsBase()) return;
      new IndexGroupModal(this.app, {
        title: `Place “${file.basename}” in ${settings.indexLabel}`,
        groupLabel: settings.groupLabel,
        initialValue: this.plugin.suggestedIndexGroup(file),
        existingGroups: this.plugin.getIndexGroups(),
        submitLabel: `Add to ${settings.indexLabel}`,
        onSubmit: async (group) => {
          if (!ownsBase()) return;
          await this.plugin.mutate(`Add “${file.basename}” to ${settings.indexLabel}`, () => {
            this.plugin.data.excludedIndexPaths = this.plugin.data.excludedIndexPaths.filter((path) => path !== file.path);
            if (!pathIsInsideFolder(file.path, settings.primaryFolder) && !this.plugin.data.manualIndexPaths.includes(file.path)) {
              this.plugin.data.manualIndexPaths.push(file.path);
            }
            this.plugin.data.indexGroupByPath[file.path] = group;
            this.plugin.data.selectedPath = file.path;
          });
          if (!ownsBase()) return;
          new Notice(`Added to ${settings.indexLabel} under ${group}. The note stayed at ${file.path}.`);
        },
      }).open();
    }).open();
  }

  public startLinkVaultNote(includeRestricted = false): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    new VaultFilePickerModal(this.app, this.plugin.getVaultNoteFiles(includeRestricted), includeRestricted ? "Link any Markdown note (advanced)" : "Link an existing vault note", (file) => {
      if (!ownsBase()) return;
      this.openCollectionPicker(file.path);
    }).open();
  }

  public startAddCurrentNote(explicitPath?: string): void {
    if (!this.guardLoadedBase()) return;
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

  public startCreateProposal(initial: Partial<TopicFormValue> = {}, onCreated?: (file: TFile) => void | Promise<void>): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const canonicalRoot = this.plugin.data.settings.primaryFolder;
    new TopicEditorModal(this.app, {
      mode: "proposal",
      title: "Create topic proposal",
      submitLabel: "Create in Topic Inbox",
      proposalFolder: this.plugin.data.settings.proposalFolder,
      canonicalRoot,
      canonicalRecords: this.plugin.getCanonicalTopics(),
      initial,
      validate: (value) => ownsBase()
        ? this.plugin.validateProposal(value)
        : "The active knowledge base changed. Close and reopen this form.",
      onSubmit: async (value) => {
        if (!ownsBase()) return;
        const file = await this.plugin.createProposal(value);
        if (!ownsBase()) return;
        if (onCreated) {
          await onCreated(file);
          if (!ownsBase()) return;
          // Route to the newly created Inbox proposal. Its portable subject
          // also remains projected in the index until promotion.
          this.plugin.data.activeTab = "inbox";
          this.plugin.data.selectedPath = file.path;
          this.mobileInspectorOpen = false;
          this.mobileInspectorNeedsFocus = false;
          await this.plugin.saveViewState();
          if (!ownsBase()) return;
          await this.reload();
          if (!ownsBase()) return;
          new Notice("Unverified topic proposal created and linked to the imported subject.");
        } else {
          this.plugin.data.activeTab = "inbox";
          this.plugin.data.selectedPath = file.path;
          await this.plugin.saveViewState();
          if (!ownsBase()) return;
          await this.reload();
          if (!ownsBase()) return;
          new Notice("Topic proposal created as unverified in the inbox.");
        }
        if (value.addToCollection) this.openCollectionPicker(file.path);
      },
    }).open();
  }

  public startCreateCanonical(initial: Partial<TopicFormValue> = {}): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const canonicalRoot = this.plugin.data.settings.primaryFolder;
    if (!this.plugin.data.settings.enableAdvancedCanonicalActions) {
      new Notice("Advanced canonical actions are disabled in settings.");
      return;
    }
    new TopicEditorModal(this.app, {
      mode: "canonical",
      title: "Create canonical topic — advanced",
      submitLabel: "Create unverified canonical topic",
      proposalFolder: this.plugin.data.settings.proposalFolder,
      canonicalRoot,
      canonicalRecords: this.plugin.getCanonicalTopics(),
      initial,
      validate: (value) => ownsBase()
        ? this.plugin.validateCanonical(value)
        : "The active knowledge base changed. Close and reopen this form.",
      resolveExpectedParentPath: (value) => ownsBase()
        ? resolveExpectedParentPath(value.curriculumId, value.domain, this.plugin.getCanonicalTopics())
        : "",
      onSubmit: async (value) => {
        if (!ownsBase()) return;
        const file = await this.plugin.createCanonical(value);
        if (!ownsBase()) return;
        this.plugin.data.activeTab = "curriculum";
        this.plugin.data.selectedPath = file.path;
        await this.plugin.saveViewState();
        if (!ownsBase()) return;
        await this.reload();
        if (!ownsBase()) return;
        new Notice("Canonical scaffold created with review_status: unverified.");
        if (value.addToCollection) this.openCollectionPicker(file.path);
      },
    }).open();
  }

  public startPromoteProposal(input?: VaultRecord): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const canonicalRoot = this.plugin.data.settings.primaryFolder;
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
      canonicalRoot,
      canonicalRecords: this.plugin.getCanonicalTopics(),
      initial: {
        title: record.sourceTitle || record.title,
        domain: record.domain,
        parentPath: this.parentPathFor(record),
        topicKind: record.topicKind,
        priority: record.priority || "P2",
        safetyCritical: record.safetyCritical,
        addToCollection: false,
      },
      validate: (value) => ownsBase()
        ? this.plugin.validateCanonical(value, record.path)
        : "The active knowledge base changed. Close and reopen this form.",
      resolveExpectedParentPath: (value) => ownsBase()
        ? resolveExpectedParentPath(value.curriculumId, value.domain, this.plugin.getCanonicalTopics())
        : "",
      previewDetails: (value) => ownsBase()
        ? this.promotionPreviewDetails(record, value, canonicalRoot)
        : ["The active knowledge base changed. Close and reopen this form."],
      onSubmit: async (value) => {
        if (!ownsBase()) return;
        const file = await this.plugin.promoteProposal(record.path, value);
        if (!ownsBase()) return;
        this.plugin.data.activeTab = "curriculum";
        this.plugin.data.selectedPath = file.path;
        await this.plugin.saveViewState();
        if (!ownsBase()) return;
        await this.reload();
        if (!ownsBase()) return;
        new Notice("Proposal promoted. It remains unverified pending human review.");
      },
    }).open();
  }

  public startEditCanonicalPlacement(input?: VaultRecord): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const canonicalRoot = this.plugin.data.settings.primaryFolder;
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
      canonicalRoot,
      canonicalRecords: this.plugin.getCanonicalTopics(),
      initial: {
        title: record.sourceTitle || record.title,
        domain: record.domain,
        parentPath: this.parentPathFor(record),
        topicKind: record.topicKind,
        priority: record.priority || "P2",
        safetyCritical: record.safetyCritical,
        curriculumId: record.curriculumId,
        addToCollection: false,
      },
      validate: (value) => ownsBase()
        ? this.plugin.validateCanonical(value, record.path)
        : "The active knowledge base changed. Close and reopen this form.",
      resolveExpectedParentPath: (value) => ownsBase()
        ? resolveExpectedParentPath(value.curriculumId, value.domain, this.plugin.getCanonicalTopics())
        : "",
      onSubmit: async (value) => {
        if (!ownsBase()) return;
        const file = await this.plugin.editCanonicalPlacement(record.path, value);
        if (!ownsBase()) return;
        this.plugin.data.selectedPath = file.path;
        await this.plugin.saveViewState();
        if (!ownsBase()) return;
        await this.reload();
        if (!ownsBase()) return;
        new Notice("Canonical placement updated; review status was preserved.");
      },
    }).open();
  }

  private parentPathFor(record: VaultRecord): string {
    return record.parentTopic ? this.plugin.resolveLink(record.parentTopic, record.path, this.recordByPath)?.path ?? "" : "";
  }

  private promotionPreviewDetails(record: VaultRecord, value: TopicFormValue, canonicalRoot?: string): string[] {
    const parent = this.plugin.getCanonicalTopics().find((candidate) => candidate.path === value.parentPath);
    return [
      `Move from ${record.path}`,
      `Move to ${canonicalPath(value, canonicalRoot) || "Choose a valid destination"}`,
      `Curriculum placement: ${value.curriculumId || "ID required"}${parent ? ` under ${parent.curriculumId}` : ""}`,
      `Preserve ${record.sourceCount} source entr${record.sourceCount === 1 ? "y" : "ies"}; review_status stays unverified`,
      `Preserve ${this.plugin.countMemberships(record.path)} collection membership(s); ${this.plugin.getBacklinkPaths(record.path).length} backlink source(s) detected`,
    ];
  }

  private render(preserveBrowseLimits = false): void {
    // A full route/tab render returns to the bounded initial page. Incremental
    // "Show more" actions use renderTree() and therefore preserve their limit.
    if (!preserveBrowseLimits) {
      this.browseRowLimit = MAX_RENDERED_BROWSE_RECORDS;
      this.browseStructureLimit = MAX_RENDERED_BROWSE_STRUCTURES;
    }
    const compact = this.isCompactInspectorLayout();
    if (compact && this.mobileInspectorOpen) {
      const currentBody = this.inspectorEl?.querySelector<HTMLElement>(".ent-cc-inspector-body");
      if (currentBody && !this.paneLayoutRenderInProgress) this.mobileInspectorScrollTop = currentBody.scrollTop;
      this.mobileInspectorNeedsFocus = true;
    }
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-view");
    this.applyPaneLayoutClasses();
    const shell = this.contentEl.createDiv({ cls: `ent-cc-shell is-pane-${this.paneLayout}` });

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
    const kickerRow = titleBlock.createDiv({ cls: "ent-cc-title-kicker-row" });
    kickerRow.createDiv({ cls: "ent-cc-kicker", text: "Knowledge operations" });
    const baseSwitcher = kickerRow.createEl("button", {
      cls: "ent-cc-base-switcher",
      type: "button",
      attr: {
        "aria-label": `Switch knowledge base. Current: ${this.plugin.data.settings.workspaceName}`,
        title: `${this.plugin.data.settings.workspaceName} — switch knowledge base`,
      },
    });
    setIcon(baseSwitcher.createSpan({ cls: "ent-cc-base-switcher-icon" }), "library-big");
    baseSwitcher.createSpan({ cls: "ent-cc-base-switcher-name", text: this.plugin.data.settings.workspaceName, attr: { dir: "auto" } });
    setIcon(baseSwitcher.createSpan({ cls: "ent-cc-base-switcher-icon" }), "chevrons-up-down");
    baseSwitcher.addEventListener("click", (event) => this.showKnowledgeBaseMenu(event));
    titleBlock.createEl("h1", { text: this.plugin.data.settings.workspaceName, attr: { dir: "auto" } });
    titleBlock.createEl("p", { text: this.plugin.data.settings.workspaceSubtitle });
    const health = titleBlock.createDiv({ cls: "ent-cc-health-summary", attr: { "aria-label": "Vault knowledge summary" } });
    this.populateHealthSummary(health);

    const actions = header.createDiv({ cls: "ent-cc-header-actions" });
    if (!this.plugin.data.settings.setupComplete) {
      const setup = actions.createEl("button", { cls: "ent-cc-button ent-cc-add-button" });
      setIcon(setup.createSpan(), "settings-2");
      setup.createSpan({ text: "Set up" });
      setup.addEventListener("click", () => this.openSetupWizard());
    }
    createQuickEntryButton(actions, () => this.openQuickEntry(this.app.workspace.getActiveFile()?.path));
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
    const activeLibraryId = libraryIdForTab(this.plugin.data.activeTab);
    const activeLibrary = activeLibraryId ? this.plugin.getLibrary(activeLibraryId) : null;
    if (activeLibraryId && activeLibrary) {
      const addHeading = actions.createEl("button", { cls: "ent-cc-button" });
      setIcon(addHeading.createSpan(), "folder-plus");
      addHeading.createSpan({ text: "New heading" });
      addHeading.addEventListener("click", () => this.promptNewLibraryHeading(activeLibraryId));
      const edit = actions.createEl("button", { cls: `ent-cc-button ${this.editMode ? "is-active" : ""}` });
      setIcon(edit.createSpan(), this.editMode ? "check" : "list-tree");
      edit.createSpan({ text: this.editMode ? "Done" : "Arrange" });
      edit.addEventListener("click", () => {
        if (this.editMode) {
          this.editMode = false;
          this.render();
          return;
        }
        const ownsBase = this.createOpenedBaseGuard();
        this.run(async () => {
          if (!ownsBase()) return;
          await this.plugin.initializeLibraryCatalog(activeLibraryId);
          if (!ownsBase()) return;
          this.editMode = true;
          this.render();
        });
      });
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
    const tabs = tabDefinitions(this.plugin.data.settings, this.records, this.plugin.getLibraries());
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
      button.createSpan({ cls: "ent-cc-tab-label", text: tab.label });
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
      if (this.viewClosed
        || (typeof this.contentEl?.contains === "function" && !this.contentEl.contains(tablist))) return;
      const active = tablist.querySelector<HTMLElement>('[aria-selected="true"]');
      active?.scrollIntoView({ block: "nearest", inline: "center" });
    }, 0);
  }

  private tabElementId(tab: MainTab): string {
    return `ent-cc-tab-${tab}-${this.viewInstanceId}`;
  }

  private async changeTab(tab: MainTab, focusTab = false): Promise<void> {
    if (!this.guardLoadedBase()) return;
    this.plugin.data.activeTab = tab;
    this.editMode = false;
    this.curriculumArrangeMode = false;
    await this.plugin.saveViewState();
    if (!this.guardLoadedBase()) return;
    this.render();
    if (focusTab) this.contentEl.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
  }

  async openLibrary(libraryId: string): Promise<void> {
    const library = this.plugin.getLibrary(libraryId);
    if (!library || library.archivedAt !== null) {
      throw new Error("That Library is no longer available in the active knowledge base.");
    }
    await this.changeTab(libraryTabId(libraryId), true);
  }

  private tabCount(tab: MainTab): number {
    if (tab === "curriculum") {
      const topicsOnly = this.plugin.isClinicalMode();
      return this.records.filter((record) => recordBelongsToIndex(record, topicsOnly)).length;
    }
    if (tab === "inbox") return this.records.filter((record) => record.role === "proposal").length;
    if (tab === "collections") return new Set(collectionPaths(this.plugin.data.collections)).size;
    if (tab === "queues") return uniqueRecords(queueRecords(this.smartQueues())).length;
    const libraryId = libraryIdForTab(tab);
    return libraryId ? this.records.filter((record) => record.libraryId === libraryId).length : 0;
  }

  private populateHealthSummary(health: HTMLElement): void {
    health.empty();
    const indexCount = this.plugin.getIndexRecords().length;
    const proposalCount = this.records.filter((record) => record.role === "proposal").length;
    if (this.plugin.isClinicalMode()) {
      const reviewedCount = this.records.filter((record) => record.reviewStatus === "reviewed").length;
      health.createSpan({ text: `${indexCount} index entries` });
      health.createSpan({ text: `${reviewedCount} human-reviewed` });
      health.createSpan({ text: `${proposalCount} inbox` });
      return;
    }
    health.createSpan({ text: `${indexCount} index entries` });
    health.createSpan({ text: `${proposalCount} inbox` });
    health.createSpan({ text: `${this.plugin.data.collections.length} collections` });
    health.createSpan({ text: `${this.plugin.data.pinnedPaths.length} pinned` });
  }

  /** Refresh count-only chrome without replacing the focused mobile search input. */
  private refreshChromeCounts(): void {
    const health = this.contentEl.querySelector<HTMLElement>(".ent-cc-health-summary");
    if (health) this.populateHealthSummary(health);
    const availableTabs = new Set(tabDefinitions(
      this.plugin.data.settings,
      this.records,
      this.plugin.getLibraries(),
    ).map((tab) => tab.id));
    this.contentEl.querySelectorAll<HTMLElement>(".ent-cc-tab").forEach((tab) => {
      const id = tab.getAttribute("data-tab") as MainTab | null;
      if (!id || !availableTabs.has(id)) return;
      tab.querySelector<HTMLElement>(".ent-cc-tab-count")?.setText(String(this.tabCount(id)));
    });
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
        ? "Search all bases…  domain:pediatric  priority:P1  type:procedure"
        : `Search all bases by title, ID, ${this.plugin.data.settings.groupLabel.toLowerCase()}, or path…`,
      attr: {
        "aria-label": `Search and filter ${this.plugin.data.settings.itemPlural}`,
        autocapitalize: "none",
        enterkeyhint: "search",
        spellcheck: "false",
      },
    });
    const clear = iconButton(box, "x", "Clear search", "ent-cc-search-clear");
    clear.type = "button";
    clear.hidden = !this.query;
    input.addEventListener("focus", () => {
      if (Platform.isMobile) {
        parent.addClass("is-search-focused");
        this.syncSearchViewportLayout();
        this.timerWindow.requestAnimationFrame(() => {
          this.syncSearchViewportLayout();
          this.resetSearchScrollPosition();
        });
        this.resetSearchScrollPosition();
      }
    });
    input.addEventListener("blur", () => {
      this.timerWindow.setTimeout(() => {
        if (this.viewClosed || !this.contentEl.contains(searchRow) || !this.contentEl.contains(parent)) return;
        if (!searchRow.contains(input.ownerDocument.activeElement)) {
          parent.removeClass("is-search-focused", "is-virtual-keyboard-open");
          parent.style.removeProperty("--ent-cc-search-visual-height");
          parent.style.removeProperty("--ent-cc-search-visual-shift");
          const tablist = parent.querySelector<HTMLElement>(".ent-cc-tabs");
          if (tablist) this.revealActiveTab(tablist);
        }
      }, 0);
    });
    input.addEventListener("input", () => {
      if (this.query !== input.value) this.cancelPendingGlobalSearch();
      this.query = input.value;
      // Commands available during the debounce window must observe the text the
      // user can already see, not the query from the previous render.
      this.parsedQuery = parseQuery(this.query);
      clear.hidden = !this.query;
      if (bulkButton) bulkButton.disabled = !this.query.trim();
      this.scheduleSearchRefresh();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.query) {
        this.cancelPendingGlobalSearch();
        this.query = "";
        this.parsedQuery = parseQuery("");
        input.value = "";
        clear.hidden = true;
        if (bulkButton) bulkButton.disabled = true;
        this.renderTree();
        this.resetSearchScrollPosition();
        this.timerWindow.requestAnimationFrame(() => this.resetSearchScrollPosition());
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.renderTree();
        this.resetSearchScrollPosition();
        input.blur();
      }
    });
    clear.addEventListener("click", () => {
      this.cancelPendingGlobalSearch();
      this.query = "";
      this.parsedQuery = parseQuery("");
      input.value = "";
      clear.hidden = true;
      if (bulkButton) bulkButton.disabled = true;
      this.renderTree();
      this.resetSearchScrollPosition();
      this.timerWindow.requestAnimationFrame(() => this.resetSearchScrollPosition());
      input.focus({ preventScroll: true });
    });
    const save = iconButton(searchRow, "bookmark-plus", "Save this search");
    save.addEventListener("click", () => this.saveCurrentSearch());
    bulkButton = iconButton(
      searchRow,
      "folder-plus",
      `Add current-base matches from ${this.plugin.data.settings.workspaceName} to a collection`,
    );
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
      chips.addClass("is-hint-only");
      chips.createSpan({ text: "Tip: fuzzy-search the title, path, configured ID, or group. Advanced field filters remain available.", cls: "ent-cc-filter-hint" });
    }
    this.searchStatusEl = parent.createDiv({ cls: "ent-cc-search-status", attr: { role: "status", "aria-live": "polite" } });
  }

  /**
   * A phone may retain the long index's scroll offset after the DOM is replaced
   * by a much shorter filtered result set. Reset both possible scroll owners so
   * iOS cannot leave the matches above the visible keyboard viewport.
   */
  private resetSearchScrollPosition(): void {
    this.contentEl.scrollTop = 0;
    if (this.workspaceEl) this.workspaceEl.scrollTop = 0;
    if (this.treeEl) this.treeEl.scrollTop = 0;
  }

  private readonly syncSearchViewportLayout = (): void => {
    const shell = this.contentEl?.querySelector<HTMLElement>(".ent-cc-shell");
    if (!shell) return;
    if (!shell.classList.contains("is-search-focused")) {
      shell.style.removeProperty("--ent-cc-search-visual-height");
      shell.style.removeProperty("--ent-cc-search-visual-shift");
      shell.removeClass("is-virtual-keyboard-open");
      return;
    }
    const viewWindow = this.searchViewportWindow ?? this.contentEl.ownerDocument.defaultView;
    if (!viewWindow) return;
    const viewport = viewWindow.visualViewport;
    const contentRect = this.contentEl.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const contentHeightBelowShellTop = Math.max(1, contentRect.bottom - shellRect.top);
    const layout = calculateSearchViewportLayout(
      viewWindow.innerHeight,
      Math.min(this.contentEl.clientHeight || viewWindow.innerHeight, contentHeightBelowShellTop),
      viewport?.height ?? viewWindow.innerHeight,
      viewport?.offsetTop ?? 0,
      shellRect.top,
    );
    shell.style.setProperty("--ent-cc-search-visual-height", `${layout.height}px`);
    shell.style.setProperty("--ent-cc-search-visual-shift", `${layout.shift}px`);
    shell.toggleClass("is-virtual-keyboard-open", layout.keyboardOpen);
  };

  private bindSearchViewportLayout(): void {
    const viewWindow = this.contentEl.ownerDocument.defaultView;
    if (!viewWindow || this.searchViewportWindow === viewWindow) return;
    this.unbindSearchViewportLayout();
    this.searchViewportWindow = viewWindow;
    viewWindow.visualViewport?.addEventListener("resize", this.syncSearchViewportLayout);
    viewWindow.visualViewport?.addEventListener("scroll", this.syncSearchViewportLayout);
    viewWindow.addEventListener("resize", this.syncSearchViewportLayout);
  }

  private unbindSearchViewportLayout(): void {
    const viewWindow = this.searchViewportWindow;
    viewWindow?.visualViewport?.removeEventListener("resize", this.syncSearchViewportLayout);
    viewWindow?.visualViewport?.removeEventListener("scroll", this.syncSearchViewportLayout);
    viewWindow?.removeEventListener("resize", this.syncSearchViewportLayout);
    this.searchViewportWindow = null;
    const shell = this.contentEl?.querySelector<HTMLElement>(".ent-cc-shell");
    shell?.style.removeProperty("--ent-cc-search-visual-height");
    shell?.style.removeProperty("--ent-cc-search-visual-shift");
    shell?.removeClass("is-virtual-keyboard-open");
  }

  private toggleToken(token: string): void {
    const parts = this.query.split(/\s+/).filter(Boolean);
    const index = parts.findIndex((part) => part.toLowerCase() === token.toLowerCase());
    if (index >= 0) parts.splice(index, 1);
    else parts.push(token);
    const query = parts.join(" ");
    if (this.query !== query) this.cancelPendingGlobalSearch();
    this.query = query;
  }

  private recordsForActiveTab(): VaultRecord[] {
    const tab = this.plugin.data.activeTab;
    if (tab === "curriculum") {
      const topicsOnly = this.plugin.isClinicalMode();
      return this.records.filter((record) => recordBelongsToIndex(record, topicsOnly));
    }
    if (tab === "inbox") return this.records.filter((record) => record.role === "proposal");
    if (tab === "collections") return this.records;
    const libraryId = libraryIdForTab(tab);
    if (libraryId) return this.records.filter((record) => record.libraryId === libraryId);
    return this.records;
  }

  private updateCount(visible: number): void {
    if (!this.countEl) return;
    this.countEl.empty();
    if (this.query.trim()) {
      if (this.globalSearchErrorKey === this.globalSearchKey()) {
        this.countEl.createSpan({ text: "Search failed" });
        this.countEl.createSpan({ text: " · All available bases", cls: "ent-cc-muted" });
        return;
      }
      if (this.globalSearchPendingKey === this.globalSearchKey()) {
        this.countEl.createSpan({ text: "Searching…" });
        this.countEl.createSpan({ text: " · All available bases", cls: "ent-cc-muted" });
        return;
      }
      this.countEl.createSpan({ text: `${visible} ${visible === 1 ? "result" : "results"}` });
      this.countEl.createSpan({ text: " · All available bases", cls: "ent-cc-muted" });
      return;
    }
    if (this.plugin.data.activeTab === "queues") {
      const uniqueVisible = uniqueRecords(queueRecords(this.smartQueues())).filter((record) => matchesParsedQuery(record, this.parsedQuery)).length;
      this.countEl.createSpan({ text: `${visible} queue entries · ${uniqueVisible} unique` });
    } else {
      const settings = this.plugin.data.settings;
      this.countEl.createSpan({ text: `${visible} ${visible === 1 ? settings.itemSingular : settings.itemPlural}` });
    }
    this.countEl.createSpan({ text: ` · ${titleForTab(this.plugin.data.activeTab, this.plugin.data.settings, this.records, this.plugin.getLibraries(true))}`, cls: "ent-cc-muted" });
  }

  private renderTree(): void {
    if (!this.treeEl) return;
    // A drag payload belongs to the exact tree that created it. Undo, Redo,
    // Sync reloads, tab changes, and organization edits all replace this token
    // through renderTree(), so a late drop cannot mutate newer organization.
    this.libraryDragRenderToken = makeId("library-drag-render");
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
    const resultCount = header.createSpan({
      text: this.plugin.data.settings.itemPlural,
      attr: { role: "status", "aria-live": "polite" },
    });
    const body = this.treeEl.createDiv({ cls: "ent-cc-tree-body" });

    let visible = 0;
    const tab = this.plugin.data.activeTab;
    if (!this.query.trim()) {
      this.browseRowsRendered = 0;
      this.browseRowsOmitted = 0;
      this.browseStructuresRendered = 0;
      this.browseStructuresOmitted = 0;
    }
    if (this.query.trim()) {
      visible = this.renderGlobalSearchResults(body);
    } else if (tab === "curriculum") {
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
    if (!this.query.trim() && (this.browseRowsOmitted > 0 || this.browseStructuresOmitted > 0)) {
      this.renderBrowseLimit(body);
    }
    const globalSearchPending = Boolean(this.query.trim() && this.globalSearchPendingKey === this.globalSearchKey());
    const globalSearchFailed = Boolean(this.query.trim() && this.globalSearchErrorKey === this.globalSearchKey());
    if (visible === 0
      && !globalSearchPending
      && !globalSearchFailed
      && !(tab === "collections" && this.plugin.data.collections.length === 0)
      && !(tab === "inbox" && !this.query)
      // Library rendering owns its empty state so it can offer a direct
      // catalog-specific Add action and explain that Markdown stays intact.
      && !(libraryIdForTab(tab) && !this.query)) {
      if (tab === "curriculum" && !this.query && !this.plugin.isClinicalMode()) this.renderKnowledgeIndexEmpty(body);
      else body.createDiv({ cls: "ent-cc-empty", text: this.query ? "No records match this search." : "No records in this section." });
    }
    this.updateCount(visible);
    if (this.query) resultCount.setText(globalSearchPending
      ? "Searching…"
      : globalSearchFailed ? "Search failed" : `${visible} ${visible === 1 ? "result" : "results"}`);
  }

  private renderBrowseLimit(parent: HTMLElement): void {
    const hiddenParts: string[] = [];
    if (this.browseRowsOmitted > 0) {
      hiddenParts.push(`${this.browseRowsOmitted.toLocaleString()} more ${this.browseRowsOmitted === 1 ? "record" : "records"}`);
    }
    if (this.browseStructuresOmitted > 0) {
      hiddenParts.push(`${this.browseStructuresOmitted.toLocaleString()} more ${this.browseStructuresOmitted === 1 ? "section" : "sections"}`);
    }
    const message = parent.createDiv({
      cls: "ent-cc-browse-limit",
      attr: { role: "status" },
    });
    message.createSpan({
      text: `Showing ${this.browseRowsRendered.toLocaleString()} records across ${this.browseStructuresRendered.toLocaleString()} sections. ${hiddenParts.join(" and ")} are hidden to keep this view responsive.`,
    });
    const nextRecords = Math.min(MAX_RENDERED_BROWSE_RECORDS, this.browseRowsOmitted);
    const nextStructures = Math.min(MAX_RENDERED_BROWSE_STRUCTURES, this.browseStructuresOmitted);
    const showMore = message.createEl("button", {
      cls: "ent-cc-button",
      text: nextRecords > 0
        ? `Show ${nextRecords.toLocaleString()} more`
        : `Show ${nextStructures.toLocaleString()} more sections`,
    });
    showMore.addEventListener("click", () => {
      this.browseRowLimit += MAX_RENDERED_BROWSE_RECORDS;
      this.browseStructureLimit += MAX_RENDERED_BROWSE_STRUCTURES;
      this.renderTree();
    });
  }

  /**
   * Reserve one visible heading/subheading row. Once either browse budget is
   * exhausted, skip the complete remaining section instead of rendering an
   * expanded-but-empty shell whose records cannot appear on this page.
   */
  private beginBrowseStructure(visibleRecordCount: number, visibleStructureCount = 1): boolean {
    if (this.browseStructuresRendered >= this.browseStructureLimit
      || (visibleRecordCount > 0 && this.browseRowsRendered >= this.browseRowLimit)) {
      this.browseRowsOmitted += visibleRecordCount;
      this.browseStructuresOmitted += visibleStructureCount;
      return false;
    }
    this.browseStructuresRendered += 1;
    return true;
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
    if (this.query.trim()) return "Search results / Library / Record";
    const tab = this.plugin.data.activeTab;
    const settings = this.plugin.data.settings;
    if (tab === "curriculum") return this.curriculumArrangeMode
      ? `Visual arrangement / Drop inside or between ${settings.itemPlural}`
      : `${settings.indexLabel} / ${settings.groupLabel} / ${settings.itemSingular}`;
    if (tab === "inbox") return this.plugin.isClinicalMode() ? "Unverified topic proposals / Capture" : `${settings.inboxLabel} / ${settings.itemSingular}`;
    if (tab === "collections") return `Collection / Subheading / ${settings.itemSingular}`;
    if (tab === "queues") return "Computed review queue / Subject";
    const libraryId = libraryIdForTab(tab);
    const library = libraryId ? this.plugin.getLibrary(libraryId) : null;
    return library
      ? `${library.singularName} / Heading / Subheading / Record`
      : `${titleForTab(tab, this.plugin.data.settings, this.records, this.plugin.getLibraries(true))} / Knowledge record`;
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
    if (!this.beginBrowseStructure(proposals.length)) return proposals.length;
    const section = parent.createDiv({ cls: "ent-cc-heading ent-cc-inbox-group" });
    const row = section.createDiv({ cls: "ent-cc-row ent-cc-heading-row" });
    row.createSpan({ cls: "ent-cc-disclosure" });
    const icon = row.createSpan({ cls: "ent-cc-leading-icon" });
    setIcon(icon, "inbox");
    row.createSpan({ cls: "ent-cc-row-title", text: this.plugin.isClinicalMode() ? "Awaiting curriculum decision" : this.plugin.data.settings.inboxLabel });
    row.createSpan({ cls: "ent-cc-row-count", text: String(proposals.length) });
    const content = section.createDiv({ cls: "ent-cc-heading-body" });
    proposals.sort((a, b) => b.mtime - a.mtime).forEach((record) => this.renderBrowseRecordRow(content, record, 1));
    return proposals.length;
  }

  private curriculumNodeMatches(node: CurriculumTreeNode): boolean {
    return matchesParsedQuery(node.record, this.parsedQuery) || node.children.some((child) => this.curriculumNodeMatches(child));
  }

  private curriculumNodeCount(node: CurriculumTreeNode): number {
    return 1 + node.children.reduce((sum, child) => sum + this.curriculumNodeCount(child), 0);
  }

  private visibleCurriculumNodeCount(node: CurriculumTreeNode): number {
    if (this.collapsedCurriculumNodes.has(node.record.path) && !this.query) return 1;
    return 1 + node.children.reduce((sum, child) => sum + this.visibleCurriculumNodeCount(child), 0);
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
    const visibleRecordCount = collapsed
      ? 0
      : roots.reduce((sum, node) => sum + this.visibleCurriculumNodeCount(node), 0);
    if (!this.beginBrowseStructure(visibleRecordCount)) return;
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
    const title = row.createEl("button", { cls: "ent-cc-row-title", text: domain.domain, attr: { dir: "auto" } });
    title.addEventListener("click", () => {
      if (collapsed) this.collapsedCurriculumDomains.delete(domain.domain); else this.collapsedCurriculumDomains.add(domain.domain);
      this.persistCollapseState();
      this.renderTree();
    });
    row.createSpan({ text: String(domain.roots.reduce((sum, node) => sum + this.curriculumNodeCount(node), 0)), cls: "ent-cc-row-count" });
    iconButton(row, "ellipsis", `Manage ${domain.domain}`, "ent-cc-row-more ent-cc-group-more").addEventListener("click", () => this.openIndexManager("groups"));
    if (this.curriculumArrangeMode) this.applyCurriculumDomainDrop(row, domain);
    if (collapsed) return;
    const content = section.createDiv({ cls: "ent-cc-heading-body ent-cc-curriculum-domain-body" });
    if (this.curriculumArrangeMode) this.applyCurriculumDomainDrop(content, domain);
    for (const node of roots) this.renderCurriculumNode(content, node, 0);
  }

  private renderCurriculumNode(parent: HTMLElement, node: CurriculumTreeNode, depth: number): void {
    if (this.query && !this.curriculumNodeMatches(node)) return;
    if (this.browseRowsRendered >= this.browseRowLimit) {
      this.browseRowsOmitted += this.visibleCurriculumNodeCount(node);
      return;
    }
    this.browseRowsRendered += 1;
    const record = node.record;
    const collapsed = this.collapsedCurriculumNodes.has(record.path) && !this.query;
    const section = parent.createDiv({ cls: "ent-cc-curriculum-node" });
    const row = section.createDiv({
      cls: `ent-cc-row ent-cc-subject-row ent-cc-curriculum-row ${record.isPlaceholder ? "ent-cc-placeholder-row" : ""} ${this.plugin.data.selectedPath === record.path ? "is-selected" : ""}`,
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
      setIcon(icon, record.isPlaceholder ? "file-question" : record.role === "supporting" ? "files" : "file-text");
    }
    const title = row.createEl("button", {
      cls: "ent-cc-subject-title",
      text: record.title,
      attr: { dir: "auto", "aria-label": record.isPlaceholder
        ? `${record.title}, no note yet. Space selects; Enter creates or links a note; M adds to a collection; P pins.`
        : `${record.title}, ${this.recordRoleName(record)}. Space selects; Enter opens; M adds to a collection; P pins.` },
    });
    title.addEventListener("click", () => {
      if (record.isPlaceholder) this.openPlaceholderActions(record);
      else this.selectRecord(record.path);
    });
    title.addEventListener("keydown", (event) => {
      if (!shouldHandleRowShortcut(true, event.key) && event.key !== " ") return;
      if (event.key === "Enter") { event.preventDefault(); this.run(() => this.openRecord(record.path)); }
      if (event.key === " ") { event.preventDefault(); this.selectRecord(record.path); }
      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); this.openCollectionPicker(record.path); }
      if (event.key.toLowerCase() === "p" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); this.run(() => this.togglePin(record.path)); }
    });
    this.attachHoverPreview(title, record);
    row.createSpan({ text: record.isPlaceholder ? "No note yet" : record.curriculumId || (this.plugin.isClinicalMode() ? "supporting" : this.plugin.data.settings.itemSingular), cls: "ent-cc-subject-id", attr: { dir: "auto" } });
    const badges = row.createDiv({ cls: "ent-cc-row-badges" });
    if (record.isPlaceholder) badges.createSpan({ text: "No note", cls: "ent-cc-placeholder-badge" });
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
    const context: LayoutRenderContext = { kind: "collections", heading, mutable };
    const total = this.matchingLayoutRows(context, heading);
    if (this.query && total === 0) return 0;
    this.renderLayoutNode(parent, context, heading, 1);
    return total;
  }

  /** Query-matching records placed directly on one layout node, in stored order. */
  private matchingLayoutRecords(context: LayoutRenderContext, node: LayoutNode): VaultRecord[] {
    const records: VaultRecord[] = [];
    for (const key of node.subjects) {
      const record = context.kind === "collections" ? this.recordByPath.get(key) : context.bySubjectId.get(key);
      if (!record) continue;
      if (context.kind === "collections" && !matchesParsedQuery(record, this.parsedQuery)) continue;
      records.push(record);
    }
    return records;
  }

  /** Query-matching record rows anywhere in a node's subtree. */
  private matchingLayoutRows(context: LayoutRenderContext, node: LayoutNode): number {
    return this.matchingLayoutRecords(context, node).length
      + childSubheadings(node).reduce((sum, child) => sum + this.matchingLayoutRows(context, child), 0);
  }

  /** Children that render at all: every child while browsing, matching subtrees while searching. */
  private renderableLayoutChildren(context: LayoutRenderContext, node: LayoutNode): LayoutSubheading[] {
    return childSubheadings(node).filter((child) => !this.query || this.matchingLayoutRows(context, child) > 0);
  }

  /** Record rows this node's subtree would put on screen given current collapse state. */
  private visibleLayoutRows(context: LayoutRenderContext, node: LayoutNode): number {
    if (node.collapsed && !this.query) return 0;
    return this.matchingLayoutRecords(context, node).length
      + this.renderableLayoutChildren(context, node).reduce((sum, child) => sum + this.visibleLayoutRows(context, child), 0);
  }

  /** Structure rows (this node plus its expanded descendants) for browse-budget accounting. */
  private visibleLayoutStructures(context: LayoutRenderContext, node: LayoutNode): number {
    if (node.collapsed && !this.query) return 1;
    return 1 + this.renderableLayoutChildren(context, node).reduce((sum, child) => sum + this.visibleLayoutStructures(context, child), 0);
  }

  /** Subject references in the subtree that resolve to a known record. */
  private resolvedLayoutCount(context: LayoutRenderContext, node: LayoutNode): number {
    if (context.kind === "collections") {
      return layoutSubjects(node).filter((path) => this.recordByPath.has(path)).length;
    }
    return layoutSubjects(node).filter((subjectId) => context.bySubjectId.has(subjectId)).length;
  }

  /**
   * Shared recursive renderer behind the Collections and library tabs. The two
   * tabs differ only in record lookup, menus, drag payloads, and empty states;
   * structure, budgets, collapse handling, and depth styling stay identical.
   */
  private renderLayoutNode(parent: HTMLElement, context: LayoutRenderContext, node: LayoutNode, depth: number): void {
    if (!this.beginBrowseStructure(this.visibleLayoutRows(context, node), this.visibleLayoutStructures(context, node))) return;
    const isHeading = depth === 1;
    const isLibrary = context.kind === "library";
    const mutable = context.kind === "collections" ? context.mutable : true;
    const collapsed = node.collapsed && !this.query;
    const membership: Membership = isHeading
      ? { headingId: context.heading.id }
      : { headingId: context.heading.id, subheadingId: node.id };
    const section = parent.createDiv({
      cls: isHeading
        ? `ent-cc-heading${isLibrary ? " ent-cc-library-group" : ""}`
        : `ent-cc-subheading${isLibrary ? " ent-cc-library-subheading" : ""}`,
    });
    const row = section.createDiv({ cls: `ent-cc-row ${isHeading ? "ent-cc-heading-row" : "ent-cc-subheading-row"}` });
    if (!isHeading) row.addClass(`ent-cc-depth-${Math.min(depth - 2, 12)}`);
    const toggle = (): void => this.toggleLayoutNode(context, node.id);
    disclosureButton(row, collapsed, node.title).addEventListener("click", toggle);
    const leading = row.createSpan({ cls: "ent-cc-leading-icon" });
    setIcon(leading, isHeading
      ? (isLibrary ? libraryIcon(context.library) : mutable ? "folders" : "library")
      : "folder");
    const title = row.createEl("button", { cls: "ent-cc-row-title", text: node.title, attr: { dir: "auto" } });
    title.addEventListener("click", toggle);
    const resolved = this.resolvedLayoutCount(context, node);
    row.createSpan({ text: String(resolved), cls: "ent-cc-row-count" });
    if (isHeading) {
      const missing = layoutSubjects(node).length - resolved;
      if (missing > 0 && (context.kind === "collections" || !this.query)) {
        row.createSpan({
          text: `${missing} missing`,
          cls: "ent-cc-row-missing",
          attr: { title: `${missing} referenced ${missing === 1 ? "note no longer exists" : "notes no longer exist"}. Open Manage index → Diagnostics to review or repair.` },
        });
      }
    }
    if (mutable) {
      iconButton(row, "ellipsis", `Actions for ${node.title}`, "ent-cc-row-more").addEventListener("click", (event) => {
        if (context.kind === "library") {
          if (isHeading) this.showLibraryHeadingMenu(event, context.library.id, context.heading);
          else this.showLibrarySubheadingMenu(event, context.library.id, context.heading, node);
        } else if (isHeading) this.showHeadingMenu(event, context.heading);
        else this.showSubheadingMenu(event, context.heading, node);
      });
    }
    const applyNodeDrop = (element: HTMLElement): void => {
      if (context.kind === "library") this.applyLibraryDrop(element, { libraryId: context.library.id, ...membership });
      else this.applyDrop(element, membership);
    };
    if (mutable && this.editMode) applyNodeDrop(row);
    if (collapsed) return;
    const content = section.createDiv({ cls: isHeading ? "ent-cc-heading-body" : "ent-cc-subheading-body" });
    if (mutable && this.editMode) applyNodeDrop(content);
    const level = Math.min(depth, MAX_LAYOUT_DEPTH);
    for (const record of this.matchingLayoutRecords(context, node)) {
      if (context.kind === "library") {
        this.renderBrowseRecordRow(content, record, level, undefined, undefined, { libraryId: context.library.id, ...membership });
      } else {
        this.renderBrowseRecordRow(content, record, level, mutable ? membership : undefined);
      }
    }
    for (const child of this.renderableLayoutChildren(context, node)) this.renderLayoutNode(content, context, child, depth + 1);
  }

  private renderQueue(parent: HTMLElement, queue: QueueDefinition): number {
    const records = queue.records.filter((record) => matchesParsedQuery(record, this.parsedQuery));
    if (this.query && records.length === 0) return 0;
    const collapsed = this.collapsedQueues.has(queue.id);
    if (!this.beginBrowseStructure(collapsed ? 0 : records.length)) return records.length;
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
    const title = row.createEl("button", { cls: "ent-cc-row-title", text: queue.title, attr: { title: queue.description, dir: "auto" } });
    title.addEventListener("click", () => {
      if (collapsed) this.collapsedQueues.delete(queue.id); else this.collapsedQueues.add(queue.id);
      this.persistCollapseState();
      this.renderTree();
    });
    row.createSpan({ text: String(queue.records.length), cls: "ent-cc-row-count" });
    if (!collapsed) {
      const content = section.createDiv({ cls: "ent-cc-heading-body" });
      content.createDiv({ cls: "ent-cc-queue-description", text: queue.description });
      for (const record of records) this.renderBrowseRecordRow(content, record, 1);
    }
    return records.length;
  }

  private renderLibrary(parent: HTMLElement, input: VaultRecord[]): number {
    const records = input.filter((record) => matchesParsedQuery(record, this.parsedQuery));
    const libraryId = libraryIdForTab(this.plugin.data.activeTab);
    const library = libraryId ? this.plugin.getLibrary(libraryId) : null;
    if (!libraryId || !library) return 0;
    const layout = this.libraryLayout(libraryId);
    const bySubjectId = new Map<string, VaultRecord>();
    for (const record of records) {
      if (record.portableId) bySubjectId.set(record.portableId, record);
    }
    const placed = new Set<string>();

    if (this.editMode) {
      const hint = parent.createDiv({ cls: "ent-cc-arrange-hint", attr: { role: "note" } });
      setIcon(hint.createSpan(), "list-tree");
      hint.createSpan({ text: `Use each row’s … menu on iPhone. On desktop, drag records between headings or subheadings. This visual hierarchy is saved in plugin data; Markdown files are not moved or rewritten.` });
    }

    for (const heading of layout) {
      for (const subjectId of layoutSubjects(heading)) placed.add(subjectId);
      this.renderLibraryHeading(parent, library, heading, bySubjectId);
    }

    const unplaced = records.filter((record) => !record.portableId || !placed.has(record.portableId));
    if (unplaced.length > 0 && this.beginBrowseStructure(unplaced.length)) {
      const section = parent.createDiv({ cls: "ent-cc-heading ent-cc-library-group ent-cc-library-fallback" });
      const row = section.createDiv({ cls: "ent-cc-row ent-cc-heading-row" });
      row.createSpan({ cls: "ent-cc-disclosure" });
      const icon = row.createSpan({ cls: "ent-cc-leading-icon" });
      setIcon(icon, libraryIcon(library));
      row.createSpan({ cls: "ent-cc-row-title", text: `Unplaced ${library.name}` });
      row.createSpan({ cls: "ent-cc-row-count", text: String(unplaced.length) });
      const content = section.createDiv({ cls: "ent-cc-heading-body" });
      unplaced.sort((a, b) => a.title.localeCompare(b.title)).forEach((record) => this.renderBrowseRecordRow(content, record, 1));
    }

    if (!this.query && input.length === 0) {
      const empty = parent.createDiv({ cls: "ent-cc-empty ent-cc-empty-action" });
      setIcon(empty.createSpan(), libraryIcon(library));
      empty.createEl("strong", { text: `No ${library.name.toLocaleLowerCase()} yet` });
      empty.createEl("p", { text: this.plugin.isClinicalMode() && library.sourceKind !== null
        ? `Records detected by the clinical profile will appear here. You can still create headings now for their visual organization.`
        : `Create a note or classify an existing Markdown note directly in ${library.name}.` });
      if (!this.plugin.isClinicalMode() || library.sourceKind === null) {
        const button = empty.createEl("button", { cls: "ent-cc-button ent-cc-add-button" });
        setIcon(button.createSpan(), "plus");
        button.createSpan({ text: `Add first ${library.singularName.toLocaleLowerCase()}` });
        button.addEventListener("click", () => this.openCatalogAddActions(libraryId));
      }
    }
    return records.length;
  }

  private libraryLayout(libraryId: string): LayoutHeading[] {
    return this.plugin.data.portableIndex.libraryLayouts[libraryId] ?? [];
  }

  private renderLibraryHeading(
    parent: HTMLElement,
    library: LibraryDefinition,
    heading: LayoutHeading,
    bySubjectId: Map<string, VaultRecord>,
  ): void {
    const context: LayoutRenderContext = { kind: "library", heading, library, bySubjectId };
    if (this.query && this.matchingLayoutRows(context, heading) === 0) return;
    this.renderLayoutNode(parent, context, heading, 1);
  }

  private renderGlobalSearchResults(parent: HTMLElement): number {
    const key = this.globalSearchKey();
    if (this.globalSearchErrorKey === key) {
      const error = parent.createDiv({ cls: "ent-cc-empty ent-cc-search-error", attr: { role: "alert" } });
      error.createEl("strong", { text: "Search could not finish" });
      error.createEl("p", { text: this.globalSearchErrorMessage || "An unexpected error interrupted this search." });
      const retry = error.createEl("button", { cls: "ent-cc-button", text: "Try again" });
      retry.addEventListener("click", () => {
        this.globalSearchErrorKey = "";
        this.globalSearchErrorMessage = "";
        this.renderTree();
      });
      return 0;
    }
    if (!this.globalSearchResult || this.globalSearchResultKey !== key) {
      this.requestGlobalSearch(key, this.query);
      if (this.globalSearchResult && this.globalSearchResultScopeKey === this.globalSearchScopeKey()) {
        parent.createDiv({
          cls: "ent-cc-search-pending ent-cc-search-updating",
          text: "Updating results…",
          attr: { role: "status", "aria-live": "polite" },
        });
        return this.renderGlobalSearchResultSet(parent, this.globalSearchResult, true);
      }
      parent.createDiv({
        cls: "ent-cc-empty ent-cc-search-pending",
        text: "Searching all available knowledge bases…",
        attr: { role: "status" },
      });
      return 0;
    }
    return this.renderGlobalSearchResultSet(parent, this.globalSearchResult, false);
  }

  private renderGlobalSearchResultSet(
    parent: HTMLElement,
    results: BoundedKnowledgeBaseSearchResultSet<KnowledgeBaseSearchSource>,
    stale: boolean,
  ): number {
    if (results.total > results.rendered) {
      parent.createDiv({
        cls: "ent-cc-search-limit",
        text: `Showing the first ${results.rendered.toLocaleString()} of ${results.total.toLocaleString()} results. Refine the search to see more.`,
        attr: { role: "status" },
      });
    }
    for (const baseGroup of results.groups) {
      const source = baseGroup.source;
      const baseSection = parent.createDiv({ cls: `ent-cc-heading ent-cc-search-base-group${stale ? " is-stale" : ""}` });
      const baseRow = baseSection.createDiv({ cls: "ent-cc-row ent-cc-heading-row" });
      baseRow.createSpan({ cls: "ent-cc-disclosure" });
      const baseIcon = baseRow.createSpan({ cls: "ent-cc-leading-icon" });
      setIcon(baseIcon, "library-big");
      baseRow.createSpan({ cls: "ent-cc-row-title", text: source.baseName, attr: { dir: "auto" } });
      baseRow.createSpan({ cls: "ent-cc-row-count", text: String(baseGroup.total) });
      const baseContent = baseSection.createDiv({ cls: "ent-cc-heading-body" });
      const libraryGroups = [
        {
          label: source.data.settings.indexLabel,
          icon: "library",
          records: baseGroup.records.filter((record) => record.role !== "proposal"
            && recordBelongsToIndex(record, source.data.settings.workspaceMode === "ent-clinical")),
        },
        {
          label: source.data.settings.inboxLabel,
          icon: "inbox",
          records: baseGroup.records.filter((record) => record.role === "proposal" || record.kind === "proposal"),
        },
        ...[...source.data.portableIndex.libraries]
          .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
          .map((library) => ({
            label: `${library.name}${library.archivedAt === null ? "" : " (archived)"}`,
            icon: libraryIcon(library),
            records: baseGroup.records.filter((record) => record.libraryId === library.id),
          })),
      ];
      const assigned = new Set<string>();
      for (const libraryGroup of libraryGroups) {
        for (const record of libraryGroup.records) assigned.add(record.path);
      }
      libraryGroups.push({
        label: "Other notes",
        icon: "sticky-note",
        records: baseGroup.records.filter((record) => !assigned.has(record.path)),
      });
      for (const libraryGroup of libraryGroups) {
        if (libraryGroup.records.length === 0) continue;
        const section = baseContent.createDiv({ cls: "ent-cc-subheading ent-cc-search-result-group" });
        const row = section.createDiv({ cls: "ent-cc-row ent-cc-subheading-row" });
        row.createSpan({ cls: "ent-cc-disclosure" });
        const icon = row.createSpan({ cls: "ent-cc-leading-icon" });
        setIcon(icon, libraryGroup.icon);
        row.createSpan({ cls: "ent-cc-row-title", text: libraryGroup.label });
        row.createSpan({ cls: "ent-cc-row-count", text: String(libraryGroup.records.length) });
        const content = section.createDiv({ cls: "ent-cc-subheading-body" });
        libraryGroup.records.forEach((record) => this.renderRecordRow(content, record, 2, undefined, { source }));
      }
    }
    return results.total;
  }

  private recordRoleName(record: VaultRecord, data = this.plugin.data): string {
    if (record.isPlaceholder) return "No note yet";
    if (record.libraryId) {
      const library = data.portableIndex.libraries.find((candidate) => candidate.id === record.libraryId);
      if (library) return `${library.singularName} in ${library.name}`;
    }
    if (data.settings.workspaceMode === "ent-clinical") return roleLabel(record);
    if (record.kind === "topic") return `Indexed ${data.settings.itemSingular}`;
    if (record.role === "proposal") return `${data.settings.inboxLabel} ${data.settings.itemSingular}`;
    return roleLabel(record);
  }

  private renderBrowseRecordRow(
    parent: HTMLElement,
    record: VaultRecord,
    level: number,
    membership?: Membership,
    searchContext?: SearchRecordContext,
    libraryMembership?: LibraryMembership,
  ): void {
    if (this.browseRowsRendered >= this.browseRowLimit) {
      this.browseRowsOmitted += 1;
      return;
    }
    this.browseRowsRendered += 1;
    this.renderRecordRow(parent, record, level, membership, searchContext, libraryMembership);
  }

  private renderRecordRow(
    parent: HTMLElement,
    record: VaultRecord,
    level: number,
    membership?: Membership,
    searchContext?: SearchRecordContext,
    libraryMembership?: LibraryMembership,
  ): void {
    const source = searchContext?.source;
    const sourceData = source?.data ?? this.plugin.data;
    const sourceIsActive = !source || source.baseId === this.plugin.getActiveKnowledgeBaseId();
    const row = parent.createDiv({
      cls: `ent-cc-row ent-cc-subject-row ent-cc-level-${level} ${record.isPlaceholder ? "ent-cc-placeholder-row" : ""} ${sourceIsActive && this.plugin.data.selectedPath === record.path ? "is-selected" : ""}`,
    });
    if (libraryMembership && record.portableId && this.editMode && !Platform.isMobile) {
      const handle = iconButton(row, "grip-vertical", `Drag ${record.title}`, "ent-cc-drag-handle");
      handle.draggable = true;
      handle.addEventListener("dragstart", (event) => this.writeLibraryDrag(event, {
        kind: "library-membership",
        subjectId: record.portableId ?? "",
        ...libraryMembership,
      }));
      handle.addEventListener("dragstart", () => row.addClass("is-dragging"));
      handle.addEventListener("dragend", () => {
        this.activeLibraryDrag = null;
        row.removeClass("is-dragging", "is-drop-before", "is-drop-after");
      });
      this.applyLibraryRowDrop(row, libraryMembership, record.portableId);
    } else if (membership && this.editMode && !Platform.isMobile) {
      const handle = iconButton(row, "grip-vertical", `Drag ${record.title}`, "ent-cc-drag-handle");
      handle.draggable = true;
      handle.addEventListener("dragstart", (event) => this.writeDrag(event, { kind: "membership", path: record.path, ...membership }));
      handle.addEventListener("dragstart", () => row.addClass("is-dragging"));
      handle.addEventListener("dragend", () => row.removeClass("is-dragging", "is-drop-before", "is-drop-after"));
      this.applyRowDrop(row, membership, record.path);
    } else {
      const icon = row.createSpan({ cls: "ent-cc-leading-icon ent-cc-record-icon" });
      setIcon(icon, record.isPlaceholder ? "file-question" : record.role === "proposal" ? "inbox" : record.role === "supporting" ? "files" : record.role === "vault-note" ? "sticky-note" : record.kind === "topic" ? "file-text" : record.kind === "procedure" ? "clipboard-list" : record.kind === "medication" ? "pill" : "dna");
    }
    const title = row.createEl("button", {
      cls: "ent-cc-subject-title",
      text: record.title,
      attr: { dir: "auto", "aria-label": record.isPlaceholder
        ? `${record.title}, no note yet. Space selects; Enter creates or links a note; M adds to a collection; P pins.`
        : `${record.title}, ${this.recordRoleName(record, sourceData)}${source ? ` in ${source.baseName}` : ""}. Space selects; Enter opens; M adds to a collection; P pins.` },
    });
    title.addEventListener("click", () => {
      if (source && !sourceIsActive) this.run(() => this.activateSearchResult(source, record, record.isPlaceholder ? "placeholder" : "select"));
      else if (record.isPlaceholder) this.openPlaceholderActions(record);
      else this.selectRecord(record.path);
    });
    title.addEventListener("keydown", (event) => {
      if (!shouldHandleRowShortcut(true, event.key) && event.key !== " ") return;
      if (event.key === "Enter") {
        event.preventDefault();
        this.run(() => source && !sourceIsActive
          ? this.activateSearchResult(source, record, record.isPlaceholder ? "placeholder" : "open")
          : this.openRecord(record.path));
      }
      if (event.key === " ") {
        event.preventDefault();
        if (source && !sourceIsActive) this.run(() => this.activateSearchResult(source, record, "select"));
        else this.selectRecord(record.path);
      }
      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        if (source && !sourceIsActive) this.run(() => this.activateSearchResult(source, record, "collection"));
        else this.openCollectionPicker(record.path);
      }
      if (event.key.toLowerCase() === "p" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        this.run(() => source && !sourceIsActive
          ? this.activateSearchResult(source, record, "pin")
          : this.togglePin(record.path));
      }
    });
    this.attachHoverPreview(title, record, sourceData.settings);
    row.createSpan({
      text: record.isPlaceholder ? "No note yet" : record.curriculumId || (sourceData.settings.workspaceMode === "ent-clinical"
        ? record.role === "supporting" ? "supporting" : record.role === "proposal" ? "proposal" : record.role === "vault-note" ? "vault note" : record.kind
        : record.role === "proposal" ? sourceData.settings.inboxLabel : record.role === "vault-note" ? "vault note" : sourceData.settings.itemSingular),
      cls: "ent-cc-subject-id",
      attr: { dir: "auto" },
    });
    const badges = row.createDiv({ cls: "ent-cc-row-badges" });
    if (record.isPlaceholder) badges.createSpan({ text: "No note", cls: "ent-cc-placeholder-badge" });
    if (record.priority) badges.createSpan({ text: record.priority, cls: `ent-cc-priority ${record.priority === "P1" ? "is-urgent" : ""}` });
    if (sourceData.settings.workspaceMode === "ent-clinical" && sourceData.settings.showSafetyBadges && record.safetyCritical) {
      const safety = badges.createSpan({ cls: "ent-cc-safety-badge", attr: { title: "Safety-critical" } });
      setIcon(safety, "shield-alert");
    }
    if (sourceData.pinnedPaths.includes(record.path)) {
      const pin = badges.createSpan({ cls: "ent-cc-pin-badge", attr: { title: "Pinned" } });
      setIcon(pin, "pin");
    }
    if (record.aiLock) {
      const lock = badges.createSpan({ cls: "ent-cc-lock-badge", attr: { title: "AI locked" } });
      setIcon(lock, "lock");
    }
    iconButton(row, "ellipsis", `Actions for ${record.title}`, "ent-cc-row-more").addEventListener("click", (event) => {
      if (source && !sourceIsActive) this.showCrossBaseRecordMenu(event, source, record);
      else this.showRecordMenu(event, record, membership, libraryMembership);
    });
    row.addEventListener("dblclick", () => this.run(() => source && !sourceIsActive
      ? this.activateSearchResult(source, record, record.isPlaceholder ? "placeholder" : "open")
      : this.openRecord(record.path)));
  }

  private async activateSearchResult(
    source: KnowledgeBaseSearchSource,
    searchedRecord: VaultRecord,
    action: "select" | "open" | "placeholder" | "collection" | "pin",
  ): Promise<void> {
    const query = this.query;
    if (source.baseId !== this.plugin.getActiveKnowledgeBaseId()) {
      await this.plugin.switchKnowledgeBase(source.baseId);
      // switchKnowledgeBase reloads this view and intentionally clears stale
      // base-local state. Restore only the global query so Back on mobile
      // returns to the same all-base results.
      this.cancelPendingGlobalSearch();
      this.query = query;
      this.parsedQuery = parseQuery(query);
      this.render();
    }
    const record = this.plugin.getRecord(searchedRecord.path);
    if (!record) throw new Error(`“${searchedRecord.title}” is no longer available in ${source.baseName}.`);
    if (action === "placeholder" || (action === "open" && record.isPlaceholder)) {
      this.openPlaceholderActions(record);
      return;
    }
    if (action === "open") {
      await this.openRecord(record.path);
      return;
    }
    if (action === "collection") {
      this.openCollectionPicker(record.path);
      return;
    }
    if (action === "pin") {
      await this.togglePin(record.path);
      return;
    }
    this.selectRecord(record.path);
  }

  private showCrossBaseRecordMenu(event: MouseEvent, source: KnowledgeBaseSearchSource, record: VaultRecord): void {
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(`Switch to ${source.baseName} and select`)
      .setIcon("library-big")
      .onClick(() => this.run(() => this.activateSearchResult(source, record, "select"))));
    menu.addItem((item) => item
      .setTitle(record.isPlaceholder ? "Create or link note…" : "Open note")
      .setIcon(record.isPlaceholder ? "file-question" : "external-link")
      .onClick(() => this.run(() => this.activateSearchResult(source, record, record.isPlaceholder ? "placeholder" : "open"))));
    menu.addItem((item) => item
      .setTitle("Add to a collection…")
      .setIcon("folder-plus")
      .onClick(() => this.run(() => this.activateSearchResult(source, record, "collection"))));
    menu.addItem((item) => item
      .setTitle(source.data.pinnedPaths.includes(record.path) ? "Unpin" : "Pin")
      .setIcon("pin")
      .onClick(() => this.run(() => this.activateSearchResult(source, record, "pin"))));
    menu.showAtMouseEvent(event);
  }

  private attachHoverPreview(element: HTMLElement, record: VaultRecord, settings = this.plugin.data.settings): void {
    if (!settings.enableHoverPreview || record.isPlaceholder) return;
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

  private applyPaneLayoutClasses(): void {
    for (const layout of ["wide", "compact", "narrow"] as const) {
      this.contentEl.toggleClass(`is-pane-${layout}`, this.paneLayout === layout);
    }
    this.contentEl.setAttribute("data-pane-layout", this.paneLayout);
  }

  private measureAndApplyPaneLayout(allowRender = true): void {
    if (!this.contentEl?.getBoundingClientRect) return;
    const width = measuredPaneWidth(this.contentEl);
    if (width > 0) this.applyPaneWidth(width, allowRender);
    else this.applyPaneLayoutClasses();
  }

  private applyPaneWidth(width: number, allowRender = true): void {
    if (!Number.isFinite(width) || width <= 0) return;
    const previous = this.paneLayout;
    const next = classifyPaneWidth(width);
    const modeChanged = next !== previous;
    this.paneWidth = width;
    this.paneLayout = next;
    this.applyPaneLayoutClasses();
    if (!allowRender || !modeChanged || this.viewClosed) return;
    if (!this.contentEl.querySelector(".ent-cc-shell")) return;
    this.renderPaneLayoutChange(previous, next);
  }

  private renderPaneLayoutChange(previous: PaneLayout, next: PaneLayout): void {
    const activeElement = this.contentEl.ownerDocument.activeElement;
    const search = this.contentEl.querySelector<HTMLInputElement>('.ent-cc-search-box input[type="search"]');
    const restoreSearchFocus = Boolean(search && activeElement === search);
    const searchSelectionStart = search?.selectionStart ?? null;
    const searchSelectionEnd = search?.selectionEnd ?? null;
    const restoreTreeFocus = Boolean(this.treeEl && activeElement && this.treeEl.contains(activeElement));
    const listScrollTop = previous === "wide"
      ? this.treeEl?.scrollTop ?? this.mobileTreeScrollTop
      : this.workspaceEl?.scrollTop ?? this.mobileTreeScrollTop;
    const inspectorBody = this.inspectorEl?.querySelector<HTMLElement>(".ent-cc-inspector-body");
    const detailScrollTop = previous === "wide"
      ? this.inspectorEl?.scrollTop ?? this.mobileInspectorScrollTop
      : inspectorBody?.scrollTop ?? this.mobileInspectorScrollTop;

    this.mobileTreeScrollTop = listScrollTop;
    this.mobileInspectorScrollTop = detailScrollTop;
    this.paneLayoutRenderInProgress = true;
    try {
      this.render(true);
    } finally {
      this.paneLayoutRenderInProgress = false;
    }

    const listOwner = next === "wide" ? this.treeEl : this.workspaceEl;
    if (listOwner) listOwner.scrollTop = listScrollTop;
    const replacementInspectorBody = this.inspectorEl?.querySelector<HTMLElement>(".ent-cc-inspector-body");
    const detailOwner = next === "wide" ? this.inspectorEl : replacementInspectorBody;
    if (detailOwner) detailOwner.scrollTop = detailScrollTop;
    if (restoreSearchFocus) {
      const replacement = this.contentEl.querySelector<HTMLInputElement>('.ent-cc-search-box input[type="search"]');
      replacement?.focus({ preventScroll: true });
      if (replacement && searchSelectionStart !== null && searchSelectionEnd !== null
        && typeof replacement.setSelectionRange === "function") {
        replacement.setSelectionRange(searchSelectionStart, searchSelectionEnd);
      }
    } else if (restoreTreeFocus && !this.mobileInspectorOpen) {
      const selected = this.treeEl?.querySelector<HTMLElement>(".ent-cc-subject-row.is-selected .ent-cc-subject-title");
      (selected ?? this.treeEl)?.focus({ preventScroll: true });
    }
  }

  private bindPaneLayout(): void {
    if (this.viewClosed) return;
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (!ownerWindow) return;
    if (this.paneResizeCleanup && this.paneResizeWindow === ownerWindow) return;
    this.unbindPaneLayout();
    this.paneResizeWindow = ownerWindow;
    this.paneResizeCleanup = observePaneWidth(this.contentEl, (width) => {
      if (this.viewClosed) return;
      if (this.contentEl.ownerDocument.defaultView !== this.paneResizeWindow) {
        this.bindPaneLayout();
        return;
      }
      this.applyPaneWidth(width);
    });
  }

  private unbindPaneLayout(): void {
    this.paneResizeCleanup?.();
    this.paneResizeCleanup = null;
    this.paneResizeWindow = null;
  }

  private selectRecord(path: string): void {
    if (!this.guardLoadedBase()) return;
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
    this.scheduleSelectionSave();
    if (compact) this.render();
    else {
      this.renderTree();
      this.renderInspector();
    }
  }

  private isCompactInspectorLayout(): boolean {
    return this.paneLayout !== "wide";
  }

  private closeMobileInspector(): void {
    this.mobileInspectorOpen = false;
    this.mobileInspectorNeedsFocus = false;
    this.render();
    this.timerWindow.setTimeout(() => {
      if (this.viewClosed || this.mobileInspectorOpen) return;
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
    const backLabel = "Back to main page";
    const close = header.createEl("button", {
      cls: "ent-cc-button ent-cc-inspector-close",
      attr: { type: "button", "aria-label": backLabel, title: backLabel },
    });
    setIcon(close.createSpan(), "arrow-left");
    close.createSpan({ text: backLabel });
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
    if (record.isPlaceholder) {
      const statusLine = body.createDiv({ cls: "ent-cc-status-line" });
      statusLine.createSpan({ text: "No Markdown note linked", cls: "ent-cc-status-pill is-placeholder" });
      body.createEl("p", {
        cls: "ent-cc-placeholder-help",
        text: this.plugin.isClinicalMode() && record.kind !== "topic"
          ? "This subject was imported without a linked Markdown note. Link an existing eligible note, or keep it as a placeholder."
          : "This subject was imported with its name and visual placement only. Create a new note, link an existing note, or keep it as a placeholder.",
      });
      const actions = body.createDiv({ cls: "ent-cc-inspector-actions" });
      const complete = actions.createEl("button", { cls: "ent-cc-button ent-cc-primary-button" });
      setIcon(complete.createSpan(), "file-plus");
      complete.createSpan({ text: this.plugin.isClinicalMode() && record.kind !== "topic" ? "Link note…" : this.plugin.isClinicalMode() ? "Create or link…" : "Complete subject…" });
      complete.addEventListener("click", () => this.openPlaceholderActions(record));
      const add = actions.createEl("button", { cls: "ent-cc-button" });
      setIcon(add.createSpan(), "folder-plus"); add.createSpan({ text: "Add to collection" });
      add.addEventListener("click", () => this.openCollectionPicker(record.path));
      iconButton(actions, this.plugin.data.pinnedPaths.includes(record.path) ? "pin-off" : "pin", this.plugin.data.pinnedPaths.includes(record.path) ? "Unpin" : "Pin").addEventListener("click", () => this.run(() => this.togglePin(record.path)));
      if (record.libraryId) this.inspectorField(body, "Library", this.plugin.getLibrary(record.libraryId)?.name || "Archived or missing library");
      this.inspectorField(body, this.plugin.data.settings.groupLabel, record.domain || "Ungrouped");
      this.inspectorField(body, "Portable subject ID", record.portableId || "—");
      this.inspectorField(body, "Note status", "Not created or linked");
      if (mobileOpen && this.mobileInspectorNeedsFocus) {
        this.mobileInspectorNeedsFocus = false;
        this.timerWindow.setTimeout(() => {
          if (this.viewClosed || !this.mobileInspectorOpen || !this.inspectorEl?.contains(body)) return;
          this.inspectorEl.querySelector<HTMLElement>(".ent-cc-inspector-close")?.focus();
        }, 0);
      }
      return;
    }
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
    if (!record.isPlaceholder) {
      const attach = actions.createEl("button", { cls: "ent-cc-button" });
      setIcon(attach.createSpan(), "paperclip"); attach.createSpan({ text: "Attach file…" });
      attach.disabled = record.aiLock;
      attach.addEventListener("click", () => {
        const file = this.app.vault.getAbstractFileByPath(record.path);
        if (!(file instanceof TFile)) {
          new Notice("The selected note is not currently available in the vault.", 7000);
          return;
        }
        this.plugin.openAttachmentImport(file);
      });
    }
    const add = actions.createEl("button", { cls: "ent-cc-button" });
    setIcon(add.createSpan(), "folder-plus"); add.createSpan({ text: "Add to collection" });
    add.addEventListener("click", () => this.openCollectionPicker(record.path));
    if (canRelinkPortableRecord(record)) {
      const changeLink = actions.createEl("button", { cls: "ent-cc-button" });
      setIcon(changeLink.createSpan(), "link"); changeLink.createSpan({ text: "Change linked note…" });
      changeLink.addEventListener("click", () => this.openPortableSubjectLinkPicker(record));
      const unlink = actions.createEl("button", { cls: "ent-cc-button ent-cc-warning-button" });
      setIcon(unlink.createSpan(), "link-2-off"); unlink.createSpan({ text: "Unlink note…" });
      unlink.addEventListener("click", () => this.confirmPortableSubjectUnlink(record));
    }
    if (!record.libraryId
      && this.plugin.canVisuallyMoveAcrossGroups()
      && recordBelongsToIndex(record, this.plugin.isClinicalMode())) {
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
    if (record.libraryId) this.inspectorField(body, "Library", this.plugin.getLibrary(record.libraryId)?.name || "Archived or missing library");
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
        if (this.viewClosed || !this.mobileInspectorOpen || !this.inspectorEl?.contains(body)) return;
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
    return !resolvedParent || resolvedParent.domain !== record.domain || resolvedParent.curriculumId.trim().toUpperCase() !== expectedId;
  }

  private matchingRecordsForCurrentView(): VaultRecord[] {
    // Toolbar actions can run while the visual search refresh is debounced.
    return matchingKnowledgeBaseRecords(this.records, this.query);
  }

  private addMatchingRecordsToCollection(): void {
    const ownsBase = this.createOpenedBaseGuard();
    const baseName = this.plugin.data.settings.workspaceName;
    if (!this.query.trim()) {
      new Notice("Enter a search or filter first.");
      return;
    }
    const records = this.matchingRecordsForCurrentView();
    if (records.length === 0) {
      new Notice(`No matching records in ${baseName} to add.`);
      return;
    }
    const paths = records.map((record) => record.path);
    const targets = collectionTargets(this.plugin.data.collections);
    if (targets.length === 0) {
      new TextPromptModal(this.app, {
        title: `Create collection from matches in ${baseName}`,
        placeholder: "Collection name",
        submitLabel: `Create with ${records.length} current-base records`,
        onSubmit: async (title) => {
          if (!ownsBase()) return;
          await this.plugin.mutate(`Create collection “${title}” from search`, () => {
            this.plugin.data.activeTab = "collections";
            this.plugin.data.collections.push({ id: makeId("collection"), title, collapsed: false, subjects: paths, subheadings: [] });
          });
        },
      }).open();
      return;
    }
    new CollectionPickerModal(this.app, targets, "Add", async (target) => {
      if (!ownsBase()) return;
      await this.plugin.mutate(`Add ${records.length} matching records from ${baseName} to collection`, () => {
        for (const path of paths) this.addMembership(path, target);
      });
      if (!ownsBase()) return;
      new Notice(`Added ${records.length} matching records from ${baseName}. Source notes stayed in place.`);
    }, `collection in ${baseName} (${records.length} current-base matches)`).open();
  }

  private promptNewCollection(addPath?: string): void {
    const ownsBase = this.createOpenedBaseGuard();
    new TextPromptModal(this.app, {
      title: "New collection",
      placeholder: "e.g. Airway board review",
      submitLabel: "Create collection",
      onSubmit: async (title) => {
        if (!ownsBase()) return;
        await this.plugin.mutate(`Create collection “${title}”`, () => {
          this.plugin.data.activeTab = "collections";
          this.plugin.data.collections.push({ id: makeId("collection"), title, collapsed: false, subjects: addPath ? [addPath] : [], subheadings: [] });
        });
      },
    }).open();
  }

  private promptNewSubheading(heading: LayoutHeading, parent: LayoutNode = heading): void {
    const ownsBase = this.createOpenedBaseGuard();
    new TextPromptModal(this.app, {
      title: `New subheading in ${parent.title}`,
      placeholder: "Subheading name",
      submitLabel: "Create subheading",
      onSubmit: async (title) => {
        if (!ownsBase()) return;
        await this.plugin.mutate(`Create subheading “${title}”`, () => {
          // New nodes are canonical leaves: the nested key appears only once
          // they gain children of their own.
          ensureChildList(parent).push({ id: makeId("subheading"), title, collapsed: false, subjects: [] });
          parent.collapsed = false;
          heading.collapsed = false;
        });
      },
    }).open();
  }

  private promptNewLibraryHeading(libraryId: string, addRecord?: VaultRecord): void {
    if (!this.guardLoadedBase()) return;
    const library = this.plugin.getLibrary(libraryId);
    if (!library || library.archivedAt !== null) return;
    const ownsBase = this.createOpenedBaseGuard();
    new TextPromptModal(this.app, {
      title: `New ${library.singularName.toLocaleLowerCase()} heading`,
      placeholder: `e.g. ${library.name} — key group`,
      submitLabel: "Create heading",
      onSubmit: async (title) => {
        if (!ownsBase()) return;
        const heading: LayoutHeading = { id: makeId(`library-${libraryId}`), title, collapsed: false, subjects: [], subheadings: [] };
        await this.plugin.mutate(`Create ${library.singularName.toLocaleLowerCase()} heading “${title}”`, () => {
          this.libraryLayout(libraryId).push(heading);
        }, { includePortableIndex: true, requireUndo: true });
        if (!ownsBase()) return;
        if (addRecord) await this.plugin.assignRecordToLibrary(addRecord.path, libraryId, { headingId: heading.id });
      },
    }).open();
  }

  private promptNewLibrarySubheading(libraryId: string, heading: LayoutHeading, parent: LayoutNode = heading): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const openedLayout = this.libraryLayout(libraryId);
    const openedHeading = openedLayout.find((item) => item.id === heading.id);
    if (!openedHeading) {
      new Notice("That library heading is no longer available. Reopen the action and try again.");
      return;
    }
    const locateParent = (currentHeading: LayoutHeading): LayoutNode | null => parent.id === heading.id
      ? currentHeading
      : subheadingChain(currentHeading, parent.id)?.node ?? null;
    const openedParent = locateParent(openedHeading);
    if (!openedParent) {
      new Notice("That library subheading is no longer available. Reopen the action and try again.");
      return;
    }
    new TextPromptModal(this.app, {
      title: `New subheading in ${openedParent.title}`,
      placeholder: "Subheading name",
      submitLabel: "Create subheading",
      onSubmit: async (title) => {
        if (!ownsBase()) return;
        if (this.libraryLayout(libraryId) !== openedLayout) throw new Error("The library organization changed. Reopen the action and try again.");
        const currentHeading = openedLayout.find((item) => item.id === openedHeading.id);
        if (!currentHeading) throw new Error("That library heading is no longer available. Reopen the action and try again.");
        const currentParent = locateParent(currentHeading);
        if (!currentParent) throw new Error("That library subheading is no longer available. Reopen the action and try again.");
        await this.plugin.mutate(`Create library subheading “${title}”`, () => {
          // New nodes are canonical leaves: the nested key appears only once
          // they gain children of their own.
          ensureChildList(currentParent).push({ id: makeId(`library-${libraryId}-subheading`), title, collapsed: false, subjects: [] });
          currentParent.collapsed = false;
          currentHeading.collapsed = false;
        }, { includePortableIndex: true, requireUndo: true });
      },
    }).open();
  }

  /**
   * Flip one node's collapse state by re-finding it in the current layout, so
   * a stale render can never write into replaced organization. The write is
   * optimistic: a failed save restores every collapse flag it touched.
   */
  private toggleLayoutNode(context: LayoutRenderContext, nodeId: string): void {
    const ownsBase = this.createOpenedBaseGuard();
    this.run(async () => {
      if (!ownsBase()) return;
      const layout = context.kind === "library" ? this.libraryLayout(context.library.id) : this.plugin.data.collections;
      const heading = layout.find((item) => item.id === context.heading.id);
      if (!heading) return;
      const located = heading.id === nodeId
        ? { chain: [heading as LayoutNode], node: heading as LayoutNode }
        : subheadingChain(heading, nodeId);
      if (!located) return;
      const previous = located.chain.map((item) => item.collapsed);
      located.node.collapsed = !located.node.collapsed;
      // A toggled nested node must be reachable, so its ancestors stay open.
      for (const ancestor of located.chain.slice(0, -1)) ancestor.collapsed = false;
      if (context.kind === "library" || context.mutable) {
        try {
          await this.plugin.saveViewState();
        } catch (error) {
          located.chain.forEach((item, index) => { item.collapsed = previous[index] ?? item.collapsed; });
          throw error;
        }
      }
      if (ownsBase()) this.renderTree();
    });
  }

  private libraryMembershipList(membership: LibraryMembership): string[] {
    const heading = this.libraryLayout(membership.libraryId).find((item) => item.id === membership.headingId);
    if (!heading) return [];
    if (!membership.subheadingId) return heading.subjects;
    return subheadingChain(heading, membership.subheadingId)?.node.subjects ?? [];
  }

  private removeLibraryMembership(subjectId: string, libraryId: string): void {
    const strip = (node: LayoutNode): void => {
      node.subjects = node.subjects.filter((item) => item !== subjectId);
      for (const child of childSubheadings(node)) strip(child);
    };
    for (const heading of this.libraryLayout(libraryId)) strip(heading);
  }

  private async moveLibraryHeading(libraryId: string, from: number, to: number): Promise<void> {
    const layout = this.libraryLayout(libraryId);
    if (from < 0 || to < 0 || from >= layout.length || to >= layout.length) return;
    await this.plugin.mutate(`Reorder ${this.plugin.getLibrary(libraryId)?.singularName.toLocaleLowerCase() ?? "library"} heading`, () => {
      const [heading] = layout.splice(from, 1);
      if (heading) layout.splice(to, 0, heading);
    }, { includePortableIndex: true, requireUndo: true });
  }

  private async moveLibrarySubheading(_libraryId: string, parent: LayoutNode, from: number, to: number): Promise<void> {
    const children = childSubheadings(parent);
    if (from < 0 || to < 0 || from >= children.length || to >= children.length) return;
    await this.plugin.mutate("Reorder library subheading", () => {
      const list = ensureChildList(parent);
      const [subheading] = list.splice(from, 1);
      if (subheading) list.splice(to, 0, subheading);
    }, { includePortableIndex: true, requireUndo: true });
  }

  private async moveLibraryRecordWithin(membership: LibraryMembership, from: number, to: number): Promise<void> {
    const subjects = this.libraryMembershipList(membership);
    if (from < 0 || to < 0 || from >= subjects.length || to >= subjects.length) return;
    await this.plugin.mutate("Reorder library record", () => {
      const [subjectId] = subjects.splice(from, 1);
      if (subjectId) subjects.splice(to, 0, subjectId);
    }, { includePortableIndex: true, requireUndo: true });
  }

  private openLibraryTargetPicker(record: VaultRecord, libraryId: string): void {
    if (!this.guardLoadedBase()) return;
    const library = this.plugin.getLibrary(libraryId);
    if (!library) return;
    const targets = collectionTargets(this.libraryLayout(libraryId));
    if (targets.length === 0) {
      this.promptNewLibraryHeading(libraryId, record);
      return;
    }
    const ownsBase = this.createOpenedBaseGuard();
    new CollectionPickerModal(this.app, targets, "Move", async (target) => {
      if (!ownsBase()) return;
      await this.plugin.assignRecordToLibrary(record.path, libraryId, target);
      if (!ownsBase()) return;
      new Notice(`Moved “${record.title}” within ${library.name}. The Markdown note was not changed.`);
    }, "heading or subheading").open();
  }

  private openPlaceLibraryRecordPicker(libraryId: string, target: Membership): void {
    const ownsBase = this.createOpenedBaseGuard();
    const library = this.plugin.getLibrary(libraryId);
    if (!library) return;
    const records = this.records.filter((record) => record.libraryId === libraryId);
    if (records.length === 0) {
      new Notice(`No ${library.name.toLocaleLowerCase()} are available to place.`);
      return;
    }
    new RecordPickerModal(this.app, records, `Place ${library.singularName.toLocaleLowerCase()} in heading`, "Search title, group, ID, or path…", async (record) => {
      if (!ownsBase()) return;
      await this.plugin.assignRecordToLibrary(record.path, libraryId, target);
      if (!ownsBase()) return;
      new Notice(`Placed “${record.title}” visually. The Markdown note was not changed.`);
    }).open();
  }

  private showLibraryHeadingMenu(event: MouseEvent, libraryId: string, heading: LayoutHeading): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const library = this.plugin.getLibrary(libraryId);
    if (!library) return;
    const layout = this.libraryLayout(libraryId);
    const layoutIsCurrent = (): boolean => layout === this.libraryLayout(libraryId);
    const index = layout.findIndex((item) => item.id === heading.id);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Move heading up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => {
      if (!ownsBase() || !layoutIsCurrent()) return;
      const currentIndex = this.libraryLayout(libraryId).findIndex((item) => item.id === heading.id);
      if (currentIndex > 0) this.run(() => this.moveLibraryHeading(libraryId, currentIndex, currentIndex - 1));
    }));
    menu.addItem((item) => item.setTitle("Move heading down").setIcon("arrow-down").setDisabled(index < 0 || index >= layout.length - 1).onClick(() => {
      if (!ownsBase() || !layoutIsCurrent()) return;
      const currentLayout = this.libraryLayout(libraryId);
      const currentIndex = currentLayout.findIndex((item) => item.id === heading.id);
      if (currentIndex >= 0 && currentIndex < currentLayout.length - 1) this.run(() => this.moveLibraryHeading(libraryId, currentIndex, currentIndex + 1));
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Place record here…").setIcon("file-input").onClick(() => {
      if (ownsBase() && layoutIsCurrent()) this.openPlaceLibraryRecordPicker(libraryId, { headingId: heading.id });
    }));
    menu.addItem((item) => item.setTitle("Add subheading").setIcon("folder-plus").onClick(() => {
      if (ownsBase() && layoutIsCurrent()) this.promptNewLibrarySubheading(libraryId, heading);
    }));
    menu.addItem((item) => item.setTitle("Rename heading").setIcon("pencil").onClick(() => {
      if (!ownsBase() || !layoutIsCurrent()) return;
      new TextPromptModal(this.app, {
        title: "Rename library heading", placeholder: "Heading name", initialValue: heading.title,
        onSubmit: async (title) => {
          if (!ownsBase()) return;
          if (!layoutIsCurrent()) throw new Error("The library organization changed. Reopen the action and try again.");
          const currentHeading = this.libraryLayout(libraryId).find((item) => item.id === heading.id);
          if (!currentHeading) throw new Error("That library heading is no longer available. Reopen the action and try again.");
          await this.plugin.mutate(`Rename library heading “${currentHeading.title}”`, () => { currentHeading.title = title; }, { includePortableIndex: true, requireUndo: true });
        },
      }).open();
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Delete heading").setIcon("trash-2").onClick(() => {
      if (!ownsBase() || !layoutIsCurrent()) return;
      new ConfirmModal(this.app, "Delete library heading?", `“${heading.title}” will be removed. Its records remain in ${library.name} as unplaced records. No Markdown note will be deleted, moved, or rewritten.`, "Delete heading", async () => {
        if (!ownsBase()) return;
        if (!layoutIsCurrent()) throw new Error("The library organization changed. Reopen the action and try again.");
        const current = this.libraryLayout(libraryId);
        const currentHeading = current.find((item) => item.id === heading.id);
        if (!currentHeading) throw new Error("That library heading is no longer available. Reopen the action and try again.");
        await this.plugin.mutate(`Delete library heading “${currentHeading.title}”`, () => {
          const currentIndex = current.findIndex((item) => item.id === currentHeading.id);
          if (currentIndex >= 0) current.splice(currentIndex, 1);
        }, { includePortableIndex: true, requireUndo: true });
      }).open();
    }));
    menu.showAtMouseEvent(event);
  }

  private showLibrarySubheadingMenu(event: MouseEvent, libraryId: string, heading: LayoutHeading, subheading: LayoutSubheading): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const openedLayout = this.libraryLayout(libraryId);
    const layoutIsCurrent = (): boolean => openedLayout === this.libraryLayout(libraryId);
    /** Re-find the node and its parent in the current layout; ids are layout-unique. */
    const locateCurrent = (): { parent: LayoutNode; node: LayoutSubheading; siblings: LayoutSubheading[] } | null => {
      const currentHeading = this.libraryLayout(libraryId).find((item) => item.id === heading.id);
      const located = currentHeading ? subheadingChain(currentHeading, subheading.id) : null;
      if (!currentHeading || !located) return null;
      const parent = located.chain[located.chain.length - 2] ?? currentHeading;
      return { parent, node: located.node, siblings: childSubheadings(parent) };
    };
    const opened = locateCurrent();
    const depth = subheadingChain(heading, subheading.id)?.chain.length ?? 2;
    const siblings = opened?.siblings ?? [];
    const index = siblings.findIndex((item) => item.id === subheading.id);
    const parentTitle = opened?.parent.title ?? heading.title;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Move subheading up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => {
      if (!ownsBase() || !layoutIsCurrent()) return;
      const current = locateCurrent();
      const currentIndex = current ? current.siblings.findIndex((item) => item.id === subheading.id) : -1;
      if (current && currentIndex > 0) this.run(() => this.moveLibrarySubheading(libraryId, current.parent, currentIndex, currentIndex - 1));
    }));
    menu.addItem((item) => item.setTitle("Move subheading down").setIcon("arrow-down").setDisabled(index < 0 || index >= siblings.length - 1).onClick(() => {
      if (!ownsBase() || !layoutIsCurrent()) return;
      const current = locateCurrent();
      const currentIndex = current ? current.siblings.findIndex((item) => item.id === subheading.id) : -1;
      if (current && currentIndex >= 0 && currentIndex < current.siblings.length - 1) {
        this.run(() => this.moveLibrarySubheading(libraryId, current.parent, currentIndex, currentIndex + 1));
      }
    }));
    menu.addItem((item) => item.setTitle("Move under…").setIcon("corner-down-right").onClick(() => {
      if (ownsBase() && layoutIsCurrent()) this.openSubheadingParentPicker(libraryId, heading.id, subheading.id);
    }));
    menu.addItem((item) => item.setTitle("Outdent one level").setIcon("indent-decrease").setDisabled(depth <= 2).onClick(() => {
      if (ownsBase() && layoutIsCurrent()) this.outdentSubheading(libraryId, heading.id, subheading.id);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Place record here…").setIcon("file-input").onClick(() => {
      if (ownsBase() && layoutIsCurrent()) this.openPlaceLibraryRecordPicker(libraryId, { headingId: heading.id, subheadingId: subheading.id });
    }));
    if (depth < MAX_LAYOUT_DEPTH) {
      menu.addItem((item) => item.setTitle("Add subheading").setIcon("folder-plus").onClick(() => {
        if (ownsBase() && layoutIsCurrent()) this.promptNewLibrarySubheading(libraryId, heading, subheading);
      }));
    }
    menu.addItem((item) => item.setTitle("Rename subheading").setIcon("pencil").onClick(() => {
      if (!ownsBase() || !layoutIsCurrent()) return;
      new TextPromptModal(this.app, {
        title: "Rename library subheading", placeholder: "Subheading name", initialValue: subheading.title,
        onSubmit: async (title) => {
          if (!ownsBase()) return;
          if (!layoutIsCurrent()) throw new Error("The library organization changed. Reopen the action and try again.");
          const currentSubheading = locateCurrent()?.node;
          if (!currentSubheading) throw new Error("That library subheading is no longer available. Reopen the action and try again.");
          await this.plugin.mutate(`Rename library subheading “${currentSubheading.title}”`, () => { currentSubheading.title = title; }, { includePortableIndex: true, requireUndo: true });
        },
      }).open();
    }));
    menu.addItem((item) => item.setTitle("Remove subheading").setIcon("trash-2").onClick(() => {
      if (!ownsBase() || !layoutIsCurrent()) return;
      new ConfirmModal(this.app, "Remove library subheading?", `Its records and nested subheadings will move up under “${parentTitle}”. No Markdown note will be changed.`, "Remove subheading", async () => {
        if (!ownsBase()) return;
        if (!layoutIsCurrent()) throw new Error("The library organization changed. Reopen the action and try again.");
        const current = locateCurrent();
        if (!current) throw new Error("That library subheading is no longer available. Reopen the action and try again.");
        await this.plugin.mutate(`Remove library subheading “${current.node.title}”`, () => {
          const { parent, node } = current;
          parent.subjects.push(...node.subjects.filter((subjectId) => !parent.subjects.includes(subjectId)));
          const children = ensureChildList(parent);
          const removeIndex = children.findIndex((item) => item.id === node.id);
          // The removed node's own children take its place, keeping order.
          children.splice(removeIndex < 0 ? children.length : removeIndex, removeIndex < 0 ? 0 : 1, ...childSubheadings(node));
          dropEmptyChildList(parent, parent.id === heading.id);
        }, { includePortableIndex: true, requireUndo: true });
      }).open();
    }));
    menu.showAtMouseEvent(event);
  }

  /**
   * Re-find a subheading and its parent in the layout that is live right now.
   * Menus and pickers stay open across a Sync replacement, so every reparent
   * step resolves ids instead of trusting the nodes the menu captured.
   */
  private locateSubheading(libraryId: string | null, headingId: string, subheadingId: string): {
    heading: LayoutHeading;
    node: LayoutSubheading;
    parent: LayoutNode;
    chain: LayoutNode[];
  } | null {
    const layout = libraryId ? this.libraryLayout(libraryId) : this.plugin.data.collections;
    const heading = layout.find((item) => item.id === headingId);
    const located = heading ? subheadingChain(heading, subheadingId) : null;
    if (!heading || !located) return null;
    return { heading, node: located.node, parent: located.chain[located.chain.length - 2] ?? heading, chain: located.chain };
  }

  private subheadingNoun(libraryId: string | null): string {
    return libraryId ? "library subheading" : "subheading";
  }

  /**
   * Touch parity for the desktop drag: pick a subheading's new parent from a
   * list of full paths. Desktop keeps the item too, because the menus are the
   * accessible path and a precise move beats a fiddly drag.
   */
  private openSubheadingParentPicker(libraryId: string | null, headingId: string, subheadingId: string): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const openedLayout = libraryId ? this.libraryLayout(libraryId) : null;
    const layoutIsCurrent = (): boolean => !libraryId || this.libraryLayout(libraryId) === openedLayout;
    const located = this.locateSubheading(libraryId, headingId, subheadingId);
    if (!located) {
      new Notice(`That ${this.subheadingNoun(libraryId)} is no longer available. Reopen the action and try again.`);
      return;
    }
    const targets = subheadingReparentTargets(located.heading, subheadingId);
    if (targets.length === 0) {
      new Notice(`“${located.node.title}” has nowhere else to go: every other place sits inside it or would pass the ${MAX_LAYOUT_DEPTH}-level nesting limit.`);
      return;
    }
    new CollectionPickerModal(this.app, targets, "Move", (target) => {
      if (!ownsBase()) return;
      this.run(async () => {
        if (!layoutIsCurrent()) throw new Error("The library organization changed. Reopen the action and try again.");
        await this.reparentSubheading(libraryId, headingId, subheadingId, target.subheadingId ?? target.headingId);
      });
    }, "heading or subheading").open();
  }

  /**
   * Move one subheading's whole subtree under another node in the same
   * heading, keeping every node id. The destination is validated again here
   * rather than only when the picker opened, so organization that changed
   * behind an open dialog refuses instead of detaching a subtree, creating a
   * cycle, or breaching the depth cap.
   */
  private async reparentSubheading(libraryId: string | null, headingId: string, subheadingId: string, destinationId: string): Promise<void> {
    const noun = this.subheadingNoun(libraryId);
    const located = this.locateSubheading(libraryId, headingId, subheadingId);
    if (!located) throw new Error(`That ${noun} is no longer available. Reopen the action and try again.`);
    const { heading, node, parent } = located;
    const destination = destinationId === heading.id ? heading : subheadingChain(heading, destinationId)?.node ?? null;
    const allowed = subheadingReparentTargets(heading, subheadingId)
      .some((target) => (target.subheadingId ?? target.headingId) === destinationId);
    if (!destination || !allowed) throw new Error(`“${node.title}” can no longer move there. Reopen the action and try again.`);
    await this.plugin.mutate(`Move ${noun} “${node.title}” under “${destination.title}”`, () => {
      const siblings = ensureChildList(parent);
      const index = siblings.findIndex((item) => item.id === subheadingId);
      if (index >= 0) siblings.splice(index, 1);
      // An emptied parent returns to the canonical leaf shape.
      dropEmptyChildList(parent, parent.id === heading.id);
      // Appended last, so the destination's existing children keep their order.
      ensureChildList(destination).push(node);
      // The moved node stays reachable wherever it landed.
      for (const ancestor of subheadingChain(heading, subheadingId)?.chain ?? []) ancestor.collapsed = false;
    }, libraryId ? { includePortableIndex: true, requireUndo: true } : undefined);
  }

  /**
   * Promote a subheading to sit beside its current parent. This is the most
   * common reparent by far, so it skips the picker; the menu disables it once
   * the node already sits directly under its heading.
   */
  private outdentSubheading(libraryId: string | null, headingId: string, subheadingId: string): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    this.run(async () => {
      if (!ownsBase()) return;
      const located = this.locateSubheading(libraryId, headingId, subheadingId);
      if (!located) throw new Error(`That ${this.subheadingNoun(libraryId)} is no longer available. Reopen the action and try again.`);
      const grandparent = located.chain[located.chain.length - 3];
      if (!grandparent) throw new Error(`“${located.node.title}” already sits directly under “${located.heading.title}”.`);
      await this.reparentSubheading(libraryId, headingId, subheadingId, grandparent.id);
    });
  }

  private openCollectionPicker(path: string, source?: Membership, move = false): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const targets = collectionTargets(this.plugin.data.collections);
    if (targets.length === 0) {
      this.promptNewCollection(path);
      return;
    }
    new CollectionPickerModal(this.app, targets, move ? "Move" : "Add", async (target) => {
      if (!ownsBase()) return;
      await this.plugin.mutate(`${move ? "Move" : "Add"} record in collection`, () => {
        if (move && source) this.removeMembership(path, source);
        this.addMembership(path, target);
      });
      if (!ownsBase()) return;
      new Notice(`${move ? "Moved" : "Added"} in My Collections. The source note stayed in place.`);
    }).open();
  }

  private addMembership(path: string, target: Membership): void {
    const heading = this.plugin.data.collections.find((item) => item.id === target.headingId);
    if (!heading) return;
    let list = heading.subjects;
    if (target.subheadingId) {
      // The target may sit at any depth under this heading; ids are unique.
      const located = subheadingChain(heading, target.subheadingId);
      if (!located) return;
      list = located.node.subjects;
      for (const node of located.chain) node.collapsed = false;
    }
    if (!list.includes(path)) list.push(path);
    heading.collapsed = false;
  }

  private removeMembership(path: string, membership: Membership): void {
    const heading = this.plugin.data.collections.find((item) => item.id === membership.headingId);
    if (!heading) return;
    if (!membership.subheadingId) heading.subjects = heading.subjects.filter((item) => item !== path);
    else {
      const subheading = subheadingChain(heading, membership.subheadingId)?.node;
      if (subheading) subheading.subjects = subheading.subjects.filter((item) => item !== path);
    }
  }

  private membershipList(membership: Membership): string[] {
    const heading = this.plugin.data.collections.find((item) => item.id === membership.headingId);
    if (!heading) return [];
    if (!membership.subheadingId) return heading.subjects;
    return subheadingChain(heading, membership.subheadingId)?.node.subjects ?? [];
  }

  private async moveCollection(from: number, to: number): Promise<void> {
    if (from < 0 || to < 0 || from >= this.plugin.data.collections.length || to >= this.plugin.data.collections.length) return;
    await this.plugin.mutate("Reorder collection", () => {
      const [item] = this.plugin.data.collections.splice(from, 1);
      if (item) this.plugin.data.collections.splice(to, 0, item);
    });
  }

  private async moveSubheading(parent: LayoutNode, from: number, to: number): Promise<void> {
    const children = childSubheadings(parent);
    if (from < 0 || to < 0 || from >= children.length || to >= children.length) return;
    await this.plugin.mutate("Reorder subheading", () => {
      const list = ensureChildList(parent);
      const [item] = list.splice(from, 1);
      if (item) list.splice(to, 0, item);
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
    if (!this.guardLoadedBase()) return;
    const pinned = this.plugin.data.pinnedPaths.includes(path);
    await this.plugin.mutate(`${pinned ? "Unpin" : "Pin"} knowledge record`, () => {
      this.plugin.data.pinnedPaths = pinned ? this.plugin.data.pinnedPaths.filter((item) => item !== path) : [...this.plugin.data.pinnedPaths, path];
    });
  }

  private async toggleNext(path: string): Promise<void> {
    if (!this.guardLoadedBase()) return;
    const present = this.plugin.data.nextStudyPaths.includes(path);
    await this.plugin.mutate(`${present ? "Remove from" : "Add to"} Next to study`, () => {
      this.plugin.data.nextStudyPaths = present ? this.plugin.data.nextStudyPaths.filter((item) => item !== path) : [...this.plugin.data.nextStudyPaths, path];
    });
  }

  private showHeadingMenu(event: MouseEvent, heading: LayoutHeading): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const menu = new Menu();
    const index = this.plugin.data.collections.findIndex((item) => item.id === heading.id);
    menu.addItem((item) => item.setTitle("Move collection up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => {
      if (ownsBase()) this.run(() => this.moveCollection(index, index - 1));
    }));
    menu.addItem((item) => item.setTitle("Move collection down").setIcon("arrow-down").setDisabled(index < 0 || index >= this.plugin.data.collections.length - 1).onClick(() => {
      if (ownsBase()) this.run(() => this.moveCollection(index, index + 1));
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Add subheading").setIcon("folder-plus").onClick(() => {
      if (ownsBase()) this.promptNewSubheading(heading);
    }));
    menu.addItem((item) => item.setTitle("Rename collection").setIcon("pencil").onClick(() => {
      if (!ownsBase()) return;
      new TextPromptModal(this.app, {
        title: "Rename collection", placeholder: "Collection name", initialValue: heading.title,
        onSubmit: async (title) => {
          if (!ownsBase()) return;
          await this.plugin.mutate(`Rename collection “${heading.title}”`, () => { heading.title = title; });
        },
      }).open();
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Delete collection").setIcon("trash-2").onClick(() => {
      if (!ownsBase()) return;
      new ConfirmModal(this.app, "Delete collection?", `“${heading.title}” and its memberships will be removed. No Markdown note will be deleted or moved.`, "Delete collection", async () => {
        if (!ownsBase()) return;
        await this.plugin.mutate(`Delete collection “${heading.title}”`, () => {
          this.plugin.data.collections = this.plugin.data.collections.filter((item) => item.id !== heading.id);
        });
      }).open();
    }));
    menu.showAtMouseEvent(event);
  }

  private showSubheadingMenu(event: MouseEvent, heading: LayoutHeading, subheading: LayoutSubheading): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const menu = new Menu();
    /** Re-find the node and its parent in the current layout; ids are layout-unique. */
    const locateCurrent = (): { parent: LayoutNode; node: LayoutSubheading } | null => {
      const currentHeading = this.plugin.data.collections.find((item) => item.id === heading.id);
      const currentChain = currentHeading ? subheadingChain(currentHeading, subheading.id) : null;
      if (!currentHeading || !currentChain) return null;
      return { parent: currentChain.chain[currentChain.chain.length - 2] ?? currentHeading, node: currentChain.node };
    };
    const located = subheadingChain(heading, subheading.id);
    if (!located) return;
    const depth = located.chain.length;
    const parent = located.chain[located.chain.length - 2] ?? heading;
    const siblings = childSubheadings(parent);
    const index = siblings.findIndex((item) => item.id === subheading.id);
    menu.addItem((item) => item.setTitle("Move subheading up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => {
      if (ownsBase()) this.run(() => this.moveSubheading(parent, index, index - 1));
    }));
    menu.addItem((item) => item.setTitle("Move subheading down").setIcon("arrow-down").setDisabled(index < 0 || index >= siblings.length - 1).onClick(() => {
      if (ownsBase()) this.run(() => this.moveSubheading(parent, index, index + 1));
    }));
    menu.addItem((item) => item.setTitle("Move under…").setIcon("corner-down-right").onClick(() => {
      if (ownsBase()) this.openSubheadingParentPicker(null, heading.id, subheading.id);
    }));
    menu.addItem((item) => item.setTitle("Outdent one level").setIcon("indent-decrease").setDisabled(depth <= 2).onClick(() => {
      if (ownsBase()) this.outdentSubheading(null, heading.id, subheading.id);
    }));
    menu.addSeparator();
    if (depth < MAX_LAYOUT_DEPTH) {
      menu.addItem((item) => item.setTitle("Add subheading").setIcon("folder-plus").onClick(() => {
        if (ownsBase()) this.promptNewSubheading(heading, subheading);
      }));
    }
    menu.addItem((item) => item.setTitle("Rename subheading").setIcon("pencil").onClick(() => {
      if (!ownsBase()) return;
      new TextPromptModal(this.app, {
        title: "Rename subheading", placeholder: "Subheading name", initialValue: subheading.title,
        onSubmit: async (title) => {
          if (!ownsBase()) return;
          await this.plugin.mutate(`Rename subheading “${subheading.title}”`, () => { subheading.title = title; });
        },
      }).open();
    }));
    menu.addItem((item) => item.setTitle("Remove subheading").setIcon("trash-2").onClick(() => {
      if (!ownsBase()) return;
      new ConfirmModal(this.app, "Remove subheading?", `Its ${this.plugin.data.settings.itemSingular} memberships and nested subheadings will move up under “${parent.title}”.`, "Remove subheading", async () => {
        if (!ownsBase()) return;
        const current = locateCurrent();
        if (!current) throw new Error("That subheading is no longer available. Reopen the action and try again.");
        await this.plugin.mutate(`Remove subheading “${current.node.title}”`, () => {
          const { parent: currentParent, node } = current;
          currentParent.subjects.push(...node.subjects.filter((path) => !currentParent.subjects.includes(path)));
          const children = ensureChildList(currentParent);
          const removeIndex = children.findIndex((item) => item.id === node.id);
          // The removed node's own children take its place, keeping order.
          children.splice(removeIndex < 0 ? children.length : removeIndex, removeIndex < 0 ? 0 : 1, ...childSubheadings(node));
          dropEmptyChildList(currentParent, currentParent.id === heading.id);
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
    const ownsBase = this.createOpenedBaseGuard();
    const excluded = curriculumDescendantPaths(this.curriculum, record.path);
    excluded.add(record.path);
    const candidates = this.records.filter((candidate) => recordBelongsToIndex(candidate, this.plugin.isClinicalMode())
      && (this.plugin.canVisuallyMoveAcrossGroups() || candidate.domain === record.domain)
      && !excluded.has(candidate.path));
    new RecordPickerModal(this.app, candidates, `Move “${record.title}” under…`, `Search a parent ${this.plugin.data.settings.itemSingular}${this.plugin.isClinicalMode() ? ` in this ${this.plugin.data.settings.groupLabel.toLowerCase()}` : ""}…`, (parent) => {
      if (!ownsBase()) return;
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

  /** buildCurriculumTree merges group spellings case-insensitively; resolve labels the same way. */
  private curriculumDomainNode(domain: string): CurriculumDomainTree | undefined {
    const key = domain.trim().toLowerCase();
    return this.curriculum.domains.find((candidate) => candidate.domain.toLowerCase() === key);
  }

  private makeCurriculumTopLevel(record: VaultRecord): void {
    const roots = this.curriculumDomainNode(record.domain)?.roots.map((node) => node.record.path).filter((path) => path !== record.path) ?? [];
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
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    if (!this.plugin.canVisuallyMoveAcrossGroups()) return;
    const settings = this.plugin.data.settings;
    new IndexGroupModal(this.app, {
      title: `Move “${record.title}” to ${settings.groupLabel.toLowerCase()}`,
      groupLabel: settings.groupLabel,
      initialValue: record.domain,
      existingGroups: this.plugin.getIndexGroups(),
      submitLabel: "Move visually",
      onSubmit: async (group) => {
        if (!ownsBase()) return;
        const roots = this.curriculumDomainNode(group)?.roots.map((node) => node.record.path).filter((path) => path !== record.path) ?? [];
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
    // The collapse set stores the rendered tree's label, which can differ in
    // case from the typed group name; capture it before the tree is replaced.
    const destinationLabel = this.curriculumDomainNode(cleanGroup)?.domain ?? cleanGroup;
    await this.plugin.mutate(label, () => {
      if (!this.plugin.data.indexGroupOrder.includes(cleanGroup)) this.plugin.data.indexGroupOrder.push(cleanGroup);
      for (const path of [record.path, ...descendants]) this.plugin.data.indexGroupByPath[path] = cleanGroup;
      moveCurriculumVisual(this.plugin.data.curriculumVisual, { ...record, domain: cleanGroup, folderOrder: cleanGroup }, parentPath, siblingPaths, index);
    });
    this.collapsedCurriculumDomains.delete(cleanGroup);
    this.collapsedCurriculumDomains.delete(destinationLabel);
    if (parentPath) this.collapsedCurriculumNodes.delete(parentPath);
    this.persistCollapseState();
    new Notice(`Moved visually to ${cleanGroup}. Note paths and metadata were not changed.`);
  }

  private removeFromIndex(record: VaultRecord): void {
    const ownsBase = this.createOpenedBaseGuard();
    if (!recordBelongsToIndex(record, this.plugin.isClinicalMode())) return;
    const settings = this.plugin.data.settings;
    const action = "Remove from this knowledge base";
    new ConfirmModal(
      this.app,
      `${action}?`,
      `“${record.title}” will leave ${settings.indexLabel} in “${settings.workspaceName}”. Its Markdown file, path, metadata, and memberships in other knowledge bases will not change. You can restore it from Manage → Available or Hidden.`,
      "Remove from base",
      async () => {
        if (!ownsBase()) return;
        await this.plugin.removeRecordsFromIndex([record.path], `${action} “${record.title}”`);
        if (!ownsBase()) return;
        new Notice(`${record.title} was removed from “${settings.workspaceName}”. Its note was not moved, renamed, or deleted.`);
      },
    ).open();
  }

  private openCatalogMoveActions(record: VaultRecord): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const settings = this.plugin.data.settings;
    const indexDestinationError = this.plugin.getRecordIndexDestinationError(record.path);
    const destinations: Array<{ destination: CatalogDestination; id: string; title: string; icon: string }> = [
      ...(indexDestinationError
        ? []
        : [{ destination: "topic" as const, id: "index", title: settings.indexLabel, icon: "library" }]),
      ...this.plugin.getLibraries()
        .filter((library) => library.id !== record.libraryId)
        .filter((library) => !this.plugin.isClinicalMode() || library.sourceKind === null || library.sourceKind === record.kind)
        .map((library) => ({ destination: { libraryId: library.id }, id: libraryTabId(library.id), title: library.name, icon: libraryIcon(library) })),
    ];
    const availableDestinations = destinations.filter((destination) => !(destination.destination === "topic" && !record.libraryId));
    if (availableDestinations.length === 0) {
      new Notice(indexDestinationError ?? "No other compatible section is available for this record.", 8000);
      return;
    }
    new AddActionModal(this.app, availableDestinations.map((destination) => ({
      id: destination.id,
      title: `Move to ${destination.title}`,
      description: "Change this base’s classification and visual placement only; the Markdown note stays untouched.",
      icon: destination.icon,
    })), (action) => {
      if (!ownsBase()) return;
      const choice = destinations.find((destination) => destination.id === action.id);
      if (!choice) return;
      this.run(async () => {
        if (!ownsBase()) return;
        if (choice.destination === "topic") await this.plugin.assignRecordToCatalog(record.path, "topic");
        else await this.plugin.assignRecordToLibrary(record.path, choice.destination.libraryId);
        if (!ownsBase()) return;
        new Notice(`Moved “${record.title}” to ${choice.title}. The Markdown note was not moved, renamed, or rewritten.`);
      });
    }, `Move “${record.title}”`).open();
  }

  private confirmRemoveFromCatalog(record: VaultRecord, libraryId: string): void {
    const library = this.plugin.getLibrary(libraryId);
    if (!library) return;
    const ownsBase = this.createOpenedBaseGuard();
    const fallbackLibrary = this.plugin.getRecordUnassignedLibraryFallback(record);
    const indexEligible = this.plugin.getRecordIndexDestinationError(record.path) === null;
    const outcome = fallbackLibrary
      ? `return to the protected built-in ${fallbackLibrary.name} library`
      : "become unclassified in this knowledge base";
    const laterDestination = fallbackLibrary
      ? "You can later place it in another compatible custom library."
      : `You can later place it in a compatible library${indexEligible ? ` or return it to ${this.plugin.data.settings.indexLabel}` : ""}.`;
    new ConfirmModal(
      this.app,
      `Remove from ${library.name}?`,
      `“${record.title}” will leave this base’s ${library.name} library and ${outcome}. Its Markdown file, path, contents, metadata, collections, pins, and Next status will not change. ${laterDestination} Undo remains available.`,
      "Remove from catalog",
      async () => {
        if (!ownsBase()) return;
        await this.plugin.removeRecordFromLibrary(record.path);
        if (!ownsBase()) return;
        new Notice(fallbackLibrary
          ? `Removed “${record.title}” from ${library.name}; its protected source classification returned it to ${fallbackLibrary.name}. The Markdown note was not changed.`
          : `Removed “${record.title}” from ${library.name} in this knowledge base. The Markdown note was not changed.`);
      },
    ).open();
  }

  private showRecordMenu(event: MouseEvent, record: VaultRecord, membership?: Membership, libraryMembership?: LibraryMembership): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(record.isPlaceholder ? "Create or link note…" : "Open note")
      .setIcon(record.isPlaceholder ? "file-plus" : "external-link")
      .onClick(() => {
        if (!ownsBase()) return;
        if (record.isPlaceholder) this.openPlaceholderActions(record);
        else this.run(() => this.openRecord(record.path));
      }));
    if (canRelinkPortableRecord(record)) {
      menu.addItem((item) => item.setTitle("Change linked note…").setIcon("link").onClick(() => {
        if (ownsBase()) this.openPortableSubjectLinkPicker(record);
      }));
      menu.addItem((item) => item.setTitle("Unlink note…").setIcon("link-2-off").onClick(() => {
        if (ownsBase()) this.confirmPortableSubjectUnlink(record);
      }));
    }
    menu.addItem((item) => item.setTitle("Add to collection…").setIcon("folder-plus").onClick(() => {
      if (ownsBase()) this.openCollectionPicker(record.path);
    }));
    const recordLibrary = record.libraryId ? this.plugin.getLibrary(record.libraryId) : null;
    if (record.kind === "topic" || recordLibrary || record.portableId) {
      menu.addItem((item) => item.setTitle("Rename display label…").setIcon("pencil").onClick(() => {
        if (!ownsBase()) return;
        new TextPromptModal(this.app, {
          title: "Rename subject display label",
          placeholder: "Subject label",
          initialValue: record.title,
          submitLabel: "Rename label",
          onSubmit: async (title) => {
            if (!ownsBase()) return;
            await this.plugin.renameRecordDisplay(record.path, title);
            if (!ownsBase()) return;
            new Notice(`Display label changed to “${title.trim()}”. The Markdown note was not renamed.`);
          },
        }).open();
      }));
      if (this.plugin.data.displayNameByPath[record.path]) {
        menu.addItem((item) => item.setTitle("Restore source label").setIcon("rotate-ccw").onClick(() => {
          if (ownsBase()) this.run(() => this.plugin.resetRecordDisplay(record.path));
        }));
      }
    }
    const contextualLibraryId = libraryIdForTab(this.plugin.data.activeTab);
    const contextualLibrary = contextualLibraryId ? this.plugin.getLibrary(contextualLibraryId) : null;
    if (contextualLibrary && contextualLibrary.id !== record.libraryId
      && (!this.plugin.isClinicalMode() || contextualLibrary.sourceKind === null || contextualLibrary.sourceKind === record.kind)) {
      menu.addItem((item) => item
        .setTitle(`Move to ${contextualLibrary.name}`)
        .setIcon(libraryIcon(contextualLibrary))
        .onClick(() => {
          if (!ownsBase()) return;
          this.run(async () => {
            await this.plugin.assignRecordToLibrary(record.path, contextualLibrary.id);
            if (!ownsBase()) return;
            new Notice(`Moved “${record.title}” to ${contextualLibrary.name}. The Markdown note was not changed.`);
          });
        }));
    }
    if (recordBelongsToIndex(record, this.plugin.isClinicalMode()) && this.plugin.canVisuallyMoveAcrossGroups()) {
      menu.addItem((item) => item.setTitle(`Move to ${this.plugin.data.settings.groupLabel.toLowerCase()}…`).setIcon("folder-input").onClick(() => {
        if (ownsBase()) this.openIndexGroupPicker(record);
      }));
    }
    if (recordBelongsToIndex(record, this.plugin.isClinicalMode())) menu.addItem((item) => item.setTitle("Remove from this knowledge base…").setIcon("list-minus").onClick(() => {
      if (ownsBase()) this.removeFromIndex(record);
    }));
    if (recordLibrary) {
      menu.addItem((item) => item.setTitle(`Move within ${recordLibrary.name}…`).setIcon("folder-input").onClick(() => {
        if (ownsBase()) this.openLibraryTargetPicker(record, recordLibrary.id);
      }));
    }
    if (recordBelongsToIndex(record, this.plugin.isClinicalMode()) || recordLibrary) {
      menu.addItem((item) => item.setTitle("Move to another section…").setIcon("shuffle").onClick(() => {
        if (ownsBase()) this.openCatalogMoveActions(record);
      }));
    }
    if (recordLibrary && (!this.plugin.isClinicalMode() || recordLibrary.sourceKind === null)) {
      menu.addItem((item) => item.setTitle(`Remove from ${recordLibrary.name}…`).setIcon("list-minus").onClick(() => {
        if (ownsBase()) this.confirmRemoveFromCatalog(record, recordLibrary.id);
      }));
    }
    if (membership) {
      const list = this.membershipList(membership);
      const index = list.indexOf(record.path);
      menu.addItem((item) => item.setTitle("Move up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => {
        if (ownsBase()) this.run(() => this.moveRecordWithin(membership, index, index - 1));
      }));
      menu.addItem((item) => item.setTitle("Move down").setIcon("arrow-down").setDisabled(index < 0 || index >= list.length - 1).onClick(() => {
        if (ownsBase()) this.run(() => this.moveRecordWithin(membership, index, index + 1));
      }));
      menu.addItem((item) => item.setTitle("Move this membership…").setIcon("folder-input").onClick(() => {
        if (ownsBase()) this.openCollectionPicker(record.path, membership, true);
      }));
      menu.addItem((item) => item.setTitle("Remove from this collection").setIcon("folder-minus").onClick(() => {
        if (!ownsBase()) return;
        this.run(() => this.plugin.mutate(`Remove ${this.plugin.data.settings.itemSingular} membership`, () => this.removeMembership(record.path, membership)));
      }));
    }
    if (libraryMembership && record.portableId) {
      const list = this.libraryMembershipList(libraryMembership);
      const index = list.indexOf(record.portableId);
      menu.addItem((item) => item.setTitle("Move up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => {
        if (!ownsBase()) return;
        const currentIndex = this.libraryMembershipList(libraryMembership).indexOf(record.portableId ?? "");
        if (currentIndex > 0) this.run(() => this.moveLibraryRecordWithin(libraryMembership, currentIndex, currentIndex - 1));
      }));
      menu.addItem((item) => item.setTitle("Move down").setIcon("arrow-down").setDisabled(index < 0 || index >= list.length - 1).onClick(() => {
        if (!ownsBase()) return;
        const currentList = this.libraryMembershipList(libraryMembership);
        const currentIndex = currentList.indexOf(record.portableId ?? "");
        if (currentIndex >= 0 && currentIndex < currentList.length - 1) {
          this.run(() => this.moveLibraryRecordWithin(libraryMembership, currentIndex, currentIndex + 1));
        }
      }));
    }
    if (this.plugin.data.activeTab === "curriculum"
      && this.curriculumArrangeMode
      && recordBelongsToIndex(record, this.plugin.isClinicalMode())) {
      const parentPath = this.curriculum.parentByPath.get(record.path) ?? null;
      const siblings = curriculumSiblingPaths(this.curriculum, record);
      const index = siblings.indexOf(record.path);
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Move under…").setIcon("corner-down-right").onClick(() => {
        if (ownsBase()) this.openCurriculumParentPicker(record);
      }));
      menu.addItem((item) => item.setTitle(`Indent under previous ${this.plugin.data.settings.itemSingular}`).setIcon("indent-increase").setDisabled(index <= 0).onClick(() => {
        if (ownsBase()) this.indentCurriculumRecord(record);
      }));
      menu.addItem((item) => item.setTitle("Outdent one level").setIcon("indent-decrease").setDisabled(!parentPath).onClick(() => {
        if (ownsBase()) this.outdentCurriculumRecord(record);
      }));
      menu.addItem((item) => item.setTitle(`Make top-level in ${this.plugin.data.settings.groupLabel.toLowerCase()}`).setIcon("panel-top").setDisabled(!parentPath).onClick(() => {
        if (ownsBase()) this.makeCurriculumTopLevel(record);
      }));
      menu.addItem((item) => item.setTitle("Move up").setIcon("arrow-up").setDisabled(index <= 0).onClick(() => {
        if (ownsBase()) this.moveCurriculumUpOrDown(record, -1);
      }));
      menu.addItem((item) => item.setTitle("Move down").setIcon("arrow-down").setDisabled(index < 0 || index >= siblings.length - 1).onClick(() => {
        if (ownsBase()) this.moveCurriculumUpOrDown(record, 1);
      }));
      menu.addItem((item) => item.setTitle(`Reset to ${this.plugin.isClinicalMode() ? "canonical" : "configured"} placement`).setIcon("rotate-ccw").setDisabled(!this.hasCurriculumVisualPlacement(record.path)).onClick(() => {
        if (ownsBase()) this.resetCurriculumRecord(record);
      }));
    }
    menu.addSeparator();
    const pinned = this.plugin.data.pinnedPaths.includes(record.path);
    menu.addItem((item) => item.setTitle(pinned ? "Unpin" : "Pin").setIcon(pinned ? "pin-off" : "pin").onClick(() => {
      if (ownsBase()) this.run(() => this.togglePin(record.path));
    }));
    const next = this.plugin.data.nextStudyPaths.includes(record.path);
    const nextLabel = this.plugin.isClinicalMode() ? "Next to study" : "Next list";
    menu.addItem((item) => item.setTitle(next ? `Remove from ${nextLabel}` : `Add to ${nextLabel}`).setIcon(next ? "list-x" : "list-plus").onClick(() => {
      if (ownsBase()) this.run(() => this.toggleNext(record.path));
    }));
    menu.addSeparator();
    if (this.plugin.isClinicalMode() && record.role === "proposal") menu.addItem((item) => item.setTitle("Promote proposal…").setIcon("arrow-up-right").setDisabled(record.aiLock).onClick(() => {
      if (ownsBase()) this.startPromoteProposal(record);
    }));
    if (this.plugin.isClinicalMode() && record.role === "canonical" && this.plugin.data.settings.enableAdvancedCanonicalActions) menu.addItem((item) => item.setTitle("Edit canonical placement…").setIcon("folder-tree").setDisabled(record.aiLock).onClick(() => {
      if (ownsBase()) this.startEditCanonicalPlacement(record);
    }));
    if (this.plugin.isClinicalMode() && record.role !== "vault-note" && !record.isPlaceholder) {
      menu.addItem((item) => item.setTitle("Copy deep-build command").setIcon("wand-sparkles").onClick(() => this.run(() => this.copyText(`Deep-build ${record.title}`, "Deep-build command"))));
      menu.addItem((item) => item.setTitle("Copy autoresearch command").setIcon("search-check").onClick(() => this.run(() => this.copyText(`Autoresearch ${record.title}`, "Autoresearch command"))));
    }
    menu.showAtMouseEvent(event);
  }

  private showGlobalMenu(event: MouseEvent): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(`Knowledge base: ${this.plugin.data.settings.workspaceName}`).setIcon("library-big").onClick(() => this.openKnowledgeBaseManager()));
    menu.addItem((item) => item.setTitle("New knowledge base…").setIcon("plus").onClick(() => new CreateKnowledgeBaseModal(this.plugin).open()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Add or create…").setIcon("plus").onClick(() => {
      if (ownsBase()) this.openAddActions();
    }));
    menu.addItem((item) => item.setTitle(`Manage ${this.plugin.data.settings.indexLabel}`).setIcon("list-tree").onClick(() => {
      if (ownsBase()) this.openIndexManager();
    }));
    menu.addItem((item) => item.setTitle("Manage libraries…").setIcon("library").onClick(() => {
      if (ownsBase()) this.openLibraryManager();
    }));
    if (!this.plugin.isClinicalMode()) menu.addItem((item) => item.setTitle(`Add existing note to ${this.plugin.data.settings.indexLabel}`).setIcon("list-plus").onClick(() => {
      if (ownsBase()) this.startAddExistingToIndex();
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Undo personal organization change").setIcon("undo-2").setDisabled(this.plugin.data.undoStack.length === 0).onClick(() => {
      if (ownsBase()) this.run(() => this.plugin.undo());
    }));
    menu.addItem((item) => item.setTitle("Redo personal organization change").setIcon("redo-2").setDisabled(this.plugin.data.redoStack.length === 0).onClick(() => {
      if (ownsBase()) this.run(() => this.plugin.redo());
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Expand all visible groups").setIcon("chevrons-down").onClick(() => this.run(async () => {
      if (!ownsBase()) return;
      this.collapsedQueues.clear();
      const activeLibraryId = libraryIdForTab(this.plugin.data.activeTab);
      if (this.plugin.data.activeTab === "curriculum") {
        this.collapsedCurriculumDomains.clear();
        this.collapsedCurriculumNodes.clear();
      } else if (this.plugin.data.activeTab === "collections") {
        visitLayoutNodes(this.plugin.data.collections, (node) => { node.collapsed = false; });
      } else if (activeLibraryId) {
        visitLayoutNodes(this.libraryLayout(activeLibraryId), (node) => { node.collapsed = false; });
      }
      if (this.plugin.data.activeTab === "collections" || activeLibraryId) await this.plugin.saveViewState();
      else this.persistCollapseState();
      if (!ownsBase()) return;
      this.renderTree();
    })));
    menu.addItem((item) => item.setTitle("Collapse all visible groups").setIcon("chevrons-up").onClick(() => this.run(async () => {
      if (!ownsBase()) return;
      this.smartQueues().forEach((queue) => this.collapsedQueues.add(queue.id));
      const activeLibraryId = libraryIdForTab(this.plugin.data.activeTab);
      if (this.plugin.data.activeTab === "curriculum") {
        this.curriculum.domains.forEach((domain) => this.collapsedCurriculumDomains.add(domain.domain));
        const visit = (node: CurriculumTreeNode): void => { if (node.children.length > 0) this.collapsedCurriculumNodes.add(node.record.path); node.children.forEach(visit); };
        this.curriculum.domains.forEach((domain) => domain.roots.forEach(visit));
      } else if (this.plugin.data.activeTab === "collections") {
        visitLayoutNodes(this.plugin.data.collections, (node) => { node.collapsed = true; });
      } else if (activeLibraryId) {
        visitLayoutNodes(this.libraryLayout(activeLibraryId), (node) => { node.collapsed = true; });
      }
      if (this.plugin.data.activeTab === "collections" || activeLibraryId) await this.plugin.saveViewState();
      else this.persistCollapseState();
      if (!ownsBase()) return;
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
      const activeLibraryId = libraryIdForTab(this.plugin.data.activeTab);
      const activeSourceKind = activeLibraryId ? this.plugin.getLibrary(activeLibraryId)?.sourceKind : null;
      if (activeSourceKind && this.app.vault.getAbstractFileByPath(this.currentBasePath()) instanceof TFile) {
        menu.addItem((item) => item.setTitle("Open current library base").setIcon("database").onClick(() => this.run(() => this.openCurrentBase())));
      }
    }
    if (this.plugin.data.activeTab === "collections" && this.plugin.data.collections.length > 0) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Clear my collections").setIcon("rotate-ccw").onClick(() => {
        if (!ownsBase()) return;
        new ConfirmModal(this.app, "Clear my collections?", "All personal headings, subheadings, and memberships will be removed. Undo remains available. Source notes are untouched.", "Clear collections", async () => {
          if (!ownsBase()) return;
          await this.plugin.mutate("Clear my collections", () => { this.plugin.data.collections = []; });
        }).open();
      }));
    }
    if (this.plugin.data.activeTab === "curriculum" && (curriculumVisualHasChanges(this.plugin.data.curriculumVisual) || (this.plugin.canVisuallyMoveAcrossGroups() && Object.keys(this.plugin.data.indexGroupByPath).length > 0))) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(`Reset all visual ${this.plugin.data.settings.indexLabel.toLowerCase()} arrangement`).setIcon("rotate-ccw").onClick(() => {
        if (!ownsBase()) return;
        new ConfirmModal(this.app, `Reset visual ${this.plugin.data.settings.indexLabel.toLowerCase()} arrangement?`, `All visual nesting and custom order will return to the ${this.plugin.isClinicalMode() ? "canonical note metadata" : "configured parent metadata and folder grouping"}. Source notes will not be changed, and Undo remains available.`, "Reset arrangement", async () => {
          if (!ownsBase()) return;
          await this.plugin.mutate(`Reset all visual ${this.plugin.data.settings.indexLabel.toLowerCase()} arrangement`, () => {
            this.plugin.data.curriculumVisual = { parentByPath: {}, orderByContainer: {} };
            this.plugin.data.indexGroupAliases = {};
            if (this.plugin.canVisuallyMoveAcrossGroups()) {
              this.plugin.data.indexGroupByPath = {};
              this.plugin.data.indexGroupOrder = [];
            }
          });
        }).open();
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Save organization snapshot").setIcon("archive").setDisabled(this.plugin.isDataReadOnly()).onClick(() => {
      if (ownsBase()) this.saveOrganizationSnapshot();
    }));
    if (this.plugin.data.layoutSnapshots.length > 0) {
      menu.addItem((item) => item.setTitle("Restore organization snapshot…").setIcon("history").onClick(() => {
        if (ownsBase()) this.showOrganizationSnapshots(event);
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Export / import center…").setIcon("arrow-left-right").onClick(() => {
      if (ownsBase()) this.openPortabilityCenter();
    }));
    menu.addItem((item) => item.setTitle("Multi-base portfolio transfer…").setIcon("package-open").onClick(() => {
      if (ownsBase()) this.openPortfolioTransfer();
    }));
    menu.showAtMouseEvent(event);
  }

  private saveOrganizationSnapshot(): void {
    const ownsBase = this.createOpenedBaseGuard();
    new TextPromptModal(this.app, {
      title: "Save organization snapshot",
      placeholder: this.plugin.isClinicalMode() ? "e.g. Before airway exam block" : "e.g. Before reorganizing projects",
      submitLabel: "Save snapshot",
      onSubmit: async (name) => {
        if (!ownsBase()) return;
        this.plugin.assertDataWritable();
        const snapshot = snapshotPersonal(this.plugin.data, name, false, true);
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
        if (!ownsBase()) return;
        new Notice(`Saved organization snapshot “${name}”.`);
      },
    }).open();
  }

  private showOrganizationSnapshots(event: MouseEvent): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const menu = new Menu();
    for (const snapshot of [...this.plugin.data.layoutSnapshots].reverse()) {
      menu.addItem((item) => item
        .setTitle(`${snapshot.label} · ${new Date(snapshot.at).toLocaleDateString()}`)
        .setIcon("history")
        .onClick(() => this.run(async () => {
          if (!ownsBase()) return;
          await this.plugin.mutate(
            `Restore snapshot “${snapshot.label}”`,
            () => restoreSnapshot(this.plugin.data, snapshot),
            {
              includeSettings: Boolean(snapshot.settings),
              includePortableIndex: Boolean(snapshot.portableIndex),
              includeLayoutSnapshots: Boolean(snapshot.layoutSnapshots),
              includeActiveTab: snapshot.activeTab !== undefined,
              requireUndo: true,
              normalizeAfterRestore: true,
            },
          );
          if (!ownsBase()) return;
          new Notice(`Restored organization snapshot “${snapshot.label}”.`);
        })));
    }
    menu.showAtMouseEvent(event);
  }

  private async exportOrganizationBackup(): Promise<void> {
    const ownsBase = this.createOpenedBaseGuard();
    try {
      if (!ownsBase()) return;
      const now = new Date();
      const backup = createPersonalBackup(
        this.plugin.data,
        now.toISOString(),
        this.plugin.getVaultId(),
        this.plugin.getActiveKnowledgeBaseId(),
        this.plugin.data.settings.workspaceName,
      );
      const workspaceName = this.plugin.data.settings.workspaceName;
      const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "knowledge-command-center";
      const delivery = await deliverJsonExport(this.plugin, "backup", `${slug}-backup`, backup, {
        contentEl: this.contentEl,
        date: now,
      });
      if (delivery.medium === "vault") {
        if (!ownsBase()) return;
        this.plugin.recordRecoveryExport(now.getTime());
        new Notice("Backup saved in the export folder inside the vault. Source notes were not included.");
        return;
      }
      this.plugin.recordRecoveryExport(now.getTime());
      new Notice("Organization backup exported. Source notes were not included.");
    } catch (error) {
      if (ownsBase()) new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private importOrganizationBackup(): void {
    const ownsBase = this.createOpenedBaseGuard();
    requestJsonImport(this.app, this.plugin, {
      title: "Choose an organization backup JSON",
      maxBytes: MAX_PORTABLE_PACKAGE_BYTES,
      oversizeMessage: "The selected JSON is larger than the 10 MB import limit.",
      emptyVaultMessage: "No JSON files were found in the vault. Copy a backup JSON into the vault, then try again.",
      guard: ownsBase,
      run: (task) => {
        void task().catch((error: unknown) => {
          if (ownsBase()) new Notice(error instanceof Error ? error.message : String(error));
        });
      },
      onValue: (value) => { this.confirmOrganizationImport(value, ownsBase); },
    });
  }

  private confirmOrganizationImport(input: unknown, ownsBase = this.createOpenedBaseGuard()): void {
    if (!ownsBase()) return;
    void Promise.resolve(input).then((value) => {
      if (!ownsBase()) return;
      const backup = parsePersonalBackup(value);
      const recoveryCheck = assertPersonalBackupMatchesVault(
        backup,
        this.plugin.getVaultId(),
        (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
        this.plugin.getActiveKnowledgeBaseId(),
        this.plugin.data.settings.workspaceName,
        this.plugin.data.settings.workspaceMode,
        true,
      );
      const verification = recoveryCheck.identity === "verified"
        ? recoveryCheck.baseIdentity === "verified"
          ? "Vault, knowledge-base, and preset identities verified."
          : recoveryCheck.baseIdentity === "cross-base-override"
            ? `Vault and preset verified; source “${backup.sourceBaseName}” and destination “${this.plugin.data.settings.workspaceName}” are different knowledge bases.`
            : "Vault identity verified; this v1–v6 backup has no knowledge-base identity or preset."
        : recoveryCheck.referencedPathCount > 0
          ? `Legacy identity unverified; ${recoveryCheck.existingPathCount} of ${recoveryCheck.referencedPathCount} unique referenced paths were found, meeting the required at-least-half threshold of ${recoveryCheck.requiredPathCount} (50%).`
          : "Legacy identity unverified; this backup contains no note paths to preflight.";
      const allowBaseOverride = recoveryCheck.baseIdentity !== "verified";
      const openFinalConfirmation = (): void => {
        if (!ownsBase()) return;
        new ConfirmModal(
          this.app,
          "Restore organization backup?",
          `${verification} Replace current personal collections, index membership and visual groups, pins, next list, saved views, and snapshots with the private backup from ${backup.exportedAt || "an unknown date"}? Source notes will not be changed.`,
          "Import backup",
          async () => {
            if (!ownsBase()) return;
            // Re-check immediately before mutation so no alternate path can
            // bypass the vault/base/preset boundary or the explicit override.
            assertPersonalBackupMatchesVault(
              backup,
              this.plugin.getVaultId(),
              (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
              this.plugin.getActiveKnowledgeBaseId(),
              this.plugin.data.settings.workspaceName,
              this.plugin.data.settings.workspaceMode,
              allowBaseOverride,
            );
            await this.plugin.mutate("Import organization backup", () => {
              // The shared field list keeps this import in step with the
              // snapshot, restore, and backup paths.
              Object.assign(this.plugin.data, clonePersonalOrganization(backup));
              this.plugin.data.layoutSnapshots = limitSnapshotStack(backup.layoutSnapshots, 10);
              this.plugin.data.portableIndex = backup.portableIndex;
            }, {
              includePortableIndex: true,
              includeLayoutSnapshots: true,
              requireUndo: true,
              normalizeAfterRestore: true,
            });
            if (!ownsBase()) return;
            new Notice("Organization backup imported. Undo is available.");
          },
        ).open();
      };
      if (!allowBaseOverride) {
        openFinalConfirmation();
        return;
      }
      new ConfirmModal(
        this.app,
        recoveryCheck.baseIdentity === "cross-base-override"
          ? "Restore into a different knowledge base?"
          : "Restore from an unverified source base?",
        recoveryCheck.baseIdentity === "cross-base-override"
          ? `This recovery belongs to “${backup.sourceBaseName}” (${backup.sourceBaseId}). You are explicitly choosing “${this.plugin.data.settings.workspaceName}” (${this.plugin.getActiveKnowledgeBaseId()}) as the destination. The ${backup.sourceWorkspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} preset matches.`
          : `This v1–v6 recovery does not identify its source knowledge base or preset. You are explicitly choosing “${this.plugin.data.settings.workspaceName}” as the destination despite that uncertainty.`,
        "Continue to restore",
        () => openFinalConfirmation(),
      ).open();
    }).catch((error) => {
      if (ownsBase()) new Notice(error instanceof Error ? error.message : String(error));
    });
  }

  private saveCurrentSearch(): void {
    const ownsBase = this.createOpenedBaseGuard();
    new TextPromptModal(this.app, {
      title: "Save current view", placeholder: this.plugin.isClinicalMode() ? "e.g. Pediatric P1 source gaps" : "e.g. Active research projects", submitLabel: "Save view",
      onSubmit: async (name) => {
        if (!ownsBase()) return;
        await this.plugin.mutate(`Save view “${name}”`, () => {
          this.plugin.data.savedViews.push({ id: makeId("view"), name, tab: this.plugin.data.activeTab, query: this.query });
        });
      },
    }).open();
  }

  private showSavedViews(event: MouseEvent): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const menu = new Menu();
    if (this.plugin.data.savedViews.length === 0) menu.addItem((item) => item.setTitle("No saved views yet").setDisabled(true));
    for (const view of this.plugin.data.savedViews) {
      menu.addItem((item) => item.setTitle(view.name).setIcon("bookmark").onClick(() => this.run(async () => {
        if (!ownsBase()) return;
        this.cancelPendingGlobalSearch();
        this.query = view.query;
        const libraryId = libraryIdForTab(view.tab);
        const library = libraryId ? this.plugin.getLibrary(libraryId) : null;
        this.plugin.data.activeTab = libraryId && library?.archivedAt !== null ? "curriculum" : view.tab;
        if (libraryId && (!library || library.archivedAt !== null)) {
          new Notice("That saved view points to an archived or removed library. Opened the knowledge index instead; the saved search text was preserved.");
        }
        await this.plugin.saveViewState();
        if (!ownsBase()) return;
        this.render();
      })));
    }
    if (this.plugin.data.savedViews.length > 0) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Manage saved views").setIcon("list-x").onClick(() => {
        if (ownsBase()) this.showDeleteSavedViews(event);
      }));
    }
    menu.showAtMouseEvent(event);
  }

  private showDeleteSavedViews(event: MouseEvent): void {
    if (!this.guardLoadedBase()) return;
    const ownsBase = this.createOpenedBaseGuard();
    const menu = new Menu();
    for (const view of this.plugin.data.savedViews) {
      menu.addItem((item) => item.setTitle(`Delete “${view.name}”`).setIcon("trash-2").onClick(() => this.run(async () => {
        if (!ownsBase()) return;
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

  private writeLibraryDrag(event: DragEvent, payload: NewLibraryDragMembership): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    const guardedPayload: LibraryDragMembership = {
      ...payload,
      ownerViewId: this.viewInstanceId,
      renderToken: this.libraryDragRenderToken,
      baseId: this.plugin.getActiveKnowledgeBaseId(),
      dataEpoch: this.currentDataEpoch(),
    };
    event.dataTransfer.setData("application/x-ent-command-center-library-membership", JSON.stringify(guardedPayload));
    this.activeLibraryDrag = guardedPayload;
  }

  private readLibraryDrag(event: DragEvent): LibraryDragMembership | null {
    const raw = event.dataTransfer?.getData("application/x-ent-command-center-library-membership");
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as LibraryDragMembership;
      return value.kind === "library-membership"
        && typeof value.libraryId === "string"
        && this.plugin.getLibrary(value.libraryId) !== null
        && typeof value.subjectId === "string"
        && typeof value.headingId === "string"
        && typeof value.ownerViewId === "string"
        && typeof value.renderToken === "string"
        && typeof value.baseId === "string"
        && typeof value.dataEpoch === "number"
        ? value
        : null;
    } catch { return null; }
  }

  private libraryDragIsCurrent(payload: LibraryDragMembership): boolean {
    return payload.ownerViewId === this.viewInstanceId
      && payload.renderToken === this.libraryDragRenderToken
      && payload.baseId === this.plugin.getActiveKnowledgeBaseId()
      && payload.dataEpoch === this.currentDataEpoch()
      && this.guardLoadedBase();
  }

  private applyLibraryDrop(element: HTMLElement, target: LibraryMembership): void {
    element.addEventListener("dragover", (event) => {
      // dataTransfer data is unreadable during dragover, so validate from the
      // tracked in-flight payload instead of readLibraryDrag(event).
      const payload = this.activeLibraryDrag;
      if (!payload || payload.libraryId !== target.libraryId || !this.libraryDragIsCurrent(payload)) return;
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
      const payload = this.readLibraryDrag(event) ?? this.activeLibraryDrag;
      this.activeLibraryDrag = null;
      if (!payload || payload.libraryId !== target.libraryId || !this.libraryDragIsCurrent(payload)) return;
      const record = this.records.find((candidate) => candidate.portableId === payload.subjectId);
      if (!record) return;
      this.run(() => this.plugin.assignRecordToLibrary(record.path, target.libraryId, target));
    });
  }

  private applyLibraryRowDrop(row: HTMLElement, target: LibraryMembership, targetSubjectId: string): void {
    row.addEventListener("dragover", (event) => {
      const payload = this.activeLibraryDrag;
      if (!payload || payload.libraryId !== target.libraryId || payload.subjectId === targetSubjectId || !this.libraryDragIsCurrent(payload)) return;
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
      const payload = this.readLibraryDrag(event) ?? this.activeLibraryDrag;
      this.activeLibraryDrag = null;
      if (!payload || payload.libraryId !== target.libraryId || payload.subjectId === targetSubjectId || !this.libraryDragIsCurrent(payload)) return;
      this.run(() => this.plugin.mutate("Place record in library order", () => {
        this.removeLibraryMembership(payload.subjectId, target.libraryId);
        const subjects = this.libraryMembershipList(target);
        const targetIndex = subjects.indexOf(targetSubjectId);
        subjects.splice(Math.max(0, targetIndex + (after ? 1 : 0)), 0, payload.subjectId);
      }, { includePortableIndex: true, requireUndo: true }));
    });
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
    const record = this.recordByPath.get(path) ?? this.plugin.getRecord(path);
    if (record?.isPlaceholder) {
      this.openPlaceholderActions(record);
      return;
    }
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
    const libraryId = libraryIdForTab(this.plugin.data.activeTab);
    const sourceKind = libraryId ? this.plugin.getLibrary(libraryId)?.sourceKind : null;
    if (sourceKind === "procedure") return "04 Procedures/Procedures.base";
    if (sourceKind === "medication") return "06 Clinical Tools/Medications/Medications.base";
    if (sourceKind === "syndrome") return "06 Clinical Tools/Syndromes/Syndromes.base";
    return "02 Maps of Content/Clinical Topics.base";
  }
}
