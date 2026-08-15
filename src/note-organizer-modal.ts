import { Modal, Notice, setIcon, type App } from "obsidian";
import { MAX_NOTE_ORGANIZER_NOTES } from "./note-organizer";

export type NoteOrganizerSource = "command" | "file-menu" | "files-menu" | "drop";
export type OrganizerStage = "notes" | "destinations" | "review";
export type OrganizerPrimaryMode = "keep" | "index" | "library" | "none";
export type OrganizerCollectionMode = "keep" | "add" | "replace";
export type OrganizerOverrideMode = "inherit" | "skip" | "custom";

export interface OrganizerVaultNote {
  kind: "note";
  name: string;
  path: string;
}

export interface OrganizerVaultFolder {
  kind: "folder";
  name: string;
  path: string;
  children: readonly OrganizerVaultNode[];
}

export type OrganizerVaultNode = OrganizerVaultNote | OrganizerVaultFolder;

export interface OrganizerSubheadingOption {
  id: string;
  name: string;
}

export interface OrganizerHeadingOption {
  id: string;
  name: string;
  subheadings: readonly OrganizerSubheadingOption[];
  /** Resolves independently from each selected note's destination-base facts. */
  sourceDerived?: boolean;
}

export interface OrganizerLibraryOption {
  id: string;
  name: string;
  headings: readonly OrganizerHeadingOption[];
}

export interface OrganizerBaseOption {
  id: string;
  name: string;
  current?: boolean;
  indexName: string;
  indexHeadings: readonly OrganizerHeadingOption[];
  libraries: readonly OrganizerLibraryOption[];
  /** Each top-level layout heading is one Collection; its children are exact subheading targets. */
  collections: readonly OrganizerHeadingOption[];
}

export interface OrganizerPrimaryDraft {
  mode: OrganizerPrimaryMode;
  libraryId: string | null;
  headingId: string | null;
  subheadingId: string | null;
}

/** Collection placement always names its exact top-level heading and optional subheading. */
export interface OrganizerCollectionTargetDraft {
  headingId: string;
  subheadingId: string | null;
}

export interface OrganizerCollectionsDraft {
  mode: OrganizerCollectionMode;
  targets: readonly OrganizerCollectionTargetDraft[];
  /** Required UI acknowledgement when Replace intentionally clears every Collection. */
  clearAllConfirmed?: boolean;
}

export interface OrganizerDestinationDraft {
  baseId: string;
  primary: OrganizerPrimaryDraft;
  collections: OrganizerCollectionsDraft;
}

export interface OrganizerNoteOverrideDraft {
  path: string;
  mode: Exclude<OrganizerOverrideMode, "inherit">;
  destinations: readonly OrganizerDestinationDraft[];
}

export interface NoteOrganizerDraft {
  version: 1;
  source: NoteOrganizerSource;
  selectedPaths: readonly string[];
  destinations: readonly OrganizerDestinationDraft[];
  overrides: readonly OrganizerNoteOverrideDraft[];
}

export interface OrganizerReviewState {
  primary: string;
  collections: readonly string[];
}

export interface OrganizerReviewRow {
  path: string;
  noteTitle: string;
  baseId: string | null;
  baseName: string | null;
  outcome: "change" | "unchanged" | "skipped";
  before: OrganizerReviewState;
  after: OrganizerReviewState;
  warnings?: readonly string[];
}

export interface OrganizerPreparedSummary {
  noteCount: number;
  baseCount: number;
  changeCount: number;
  unchangedCount: number;
  skippedCount: number;
}

/**
 * `preparedToken` is deliberately opaque. The modal stores it without cloning
 * or interpreting it and returns that exact value to `applyPrepared`.
 */
export interface OrganizerPreparedPlan {
  preparedToken: unknown;
  reviewRows: readonly OrganizerReviewRow[];
  warnings: readonly string[];
  errors: readonly string[];
  summary: OrganizerPreparedSummary;
}

export interface OrganizerApplyResult {
  changedNotes: number;
  changedBases: number;
  changeCount: number;
  message?: string;
}

export interface NoteOrganizerHost {
  app: App;
  getVaultSnapshot(): Promise<readonly OrganizerVaultNode[]> | readonly OrganizerVaultNode[];
  getBases(): Promise<readonly OrganizerBaseOption[]> | readonly OrganizerBaseOption[];
  isReadOnly?(): boolean;
  prepare(draft: NoteOrganizerDraft): Promise<OrganizerPreparedPlan>;
  applyPrepared(preparedToken: unknown): Promise<OrganizerApplyResult>;
}

export interface NoteOrganizerModalOptions {
  source?: NoteOrganizerSource;
  preselectedPaths?: readonly string[];
  onApplied?: (result: OrganizerApplyResult) => void;
  onClosed?: () => void;
}

interface OrganizerDestinationState {
  key: number;
  baseId: string;
  primary: OrganizerPrimaryDraft;
  collections: {
    mode: OrganizerCollectionMode;
    targets: OrganizerCollectionTargetDraft[];
    clearAllConfirmed: boolean;
  };
}

interface OrganizerOverrideState {
  mode: Exclude<OrganizerOverrideMode, "inherit">;
  destinations: OrganizerDestinationState[];
}

export interface OrganizerTreeRow {
  node: OrganizerVaultNode;
  level: number;
  parentPath: string | null;
}

export interface OrganizerTreePage {
  rows: OrganizerTreeRow[];
  total: number;
}

interface OrganizerSelectionStats {
  selected: number;
  total: number;
}

interface OrganizerSearchNoteEntry {
  row: OrganizerTreeRow;
  normalizedText: string;
}

export interface NoteOrganizerSearchIndex {
  indexedNodeCount: number;
  searchableNoteCount: number;
  noteEntries: readonly OrganizerSearchNoteEntry[];
  rowByPath: ReadonlyMap<string, OrganizerTreeRow>;
  folderTotalByPath: ReadonlyMap<string, number>;
}

export interface NoteOrganizerSearchPage extends OrganizerTreePage {
  scannedNotes: number;
}

const TREE_PAGE_SIZE = 300;
const OVERRIDE_PAGE_SIZE = 100;
const REVIEW_PAGE_SIZE = 300;
const SELECTED_TRAY_LIMIT = 30;
const SEARCH_DEBOUNCE_MS = 160;
let organizerInstanceSequence = 0;

function isMarkdownNote(node: OrganizerVaultNode): node is OrganizerVaultNote {
  return node.kind === "note" && node.path.toLocaleLowerCase().endsWith(".md");
}

function normalizedSearchText(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

/** Build one normalized, DFS-ordered search projection for the loaded vault snapshot. */
export function buildNoteOrganizerSearchIndex(
  nodes: readonly OrganizerVaultNode[],
  onVisit?: (phase: "index", path: string) => void,
): NoteOrganizerSearchIndex {
  const noteEntries: OrganizerSearchNoteEntry[] = [];
  const rowByPath = new Map<string, OrganizerTreeRow>();
  const folderTotalByPath = new Map<string, number>();
  let indexedNodeCount = 0;
  const visit = (
    node: OrganizerVaultNode,
    level: number,
    parentPath: string | null,
  ): number => {
    if (node.kind === "note" && !isMarkdownNote(node)) return 0;
    const row = { node, level, parentPath };
    rowByPath.set(node.path, row);
    indexedNodeCount += 1;
    onVisit?.("index", node.path);
    if (node.kind === "note") {
      noteEntries.push({ row, normalizedText: normalizedSearchText(`${node.name} ${node.path}`) });
      return 1;
    }
    let total = 0;
    for (const child of node.children) total += visit(child, level + 1, node.path);
    folderTotalByPath.set(node.path, total);
    return total;
  };
  for (const node of nodes) visit(node, 1, null);
  return {
    indexedNodeCount,
    searchableNoteCount: noteEntries.length,
    noteEntries,
    rowByPath,
    folderTotalByPath,
  };
}

/** Query the pre-normalized index in one note pass while materializing only one bounded page. */
export function queryNoteOrganizerSearchIndex(
  index: NoteOrganizerSearchIndex,
  rawQuery: string,
  pageIndex: number,
  pageSize = TREE_PAGE_SIZE,
  onVisit?: (phase: "query", path: string) => void,
): NoteOrganizerSearchPage {
  const query = normalizedSearchText(rawQuery);
  if (!query) return { rows: [], total: 0, scannedNotes: 0 };
  const start = Math.max(0, pageIndex) * pageSize;
  const end = start + pageSize;
  const rows: OrganizerTreeRow[] = [];
  const emitted = new Set<string>();
  let total = 0;
  let scannedNotes = 0;
  const emit = (row: OrganizerTreeRow): void => {
    if (emitted.has(row.node.path)) return;
    emitted.add(row.node.path);
    if (total >= start && total < end) rows.push(row);
    total += 1;
  };
  for (const entry of index.noteEntries) {
    scannedNotes += 1;
    onVisit?.("query", entry.row.node.path);
    if (!entry.normalizedText.includes(query)) continue;
    const ancestors: OrganizerTreeRow[] = [];
    let parentPath = entry.row.parentPath;
    while (parentPath) {
      const parent = index.rowByPath.get(parentPath);
      if (!parent) break;
      ancestors.push(parent);
      parentPath = parent.parentPath;
    }
    for (let ancestorIndex = ancestors.length - 1; ancestorIndex >= 0; ancestorIndex -= 1) {
      const ancestor = ancestors[ancestorIndex];
      if (ancestor) emit(ancestor);
    }
    emit(entry.row);
  }
  return { rows, total, scannedNotes };
}

/** Nested controls keep their native keyboard behavior; only the treeitem itself owns tree shortcuts. */
export function noteOrganizerTreeItemOwnsEvent(currentTarget: EventTarget | null, target: EventTarget | null): boolean {
  return currentTarget !== null && currentTarget === target;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clonePrimary(value: OrganizerPrimaryDraft): OrganizerPrimaryDraft {
  return {
    mode: value.mode,
    libraryId: value.libraryId,
    headingId: value.headingId,
    subheadingId: value.subheadingId,
  };
}

function cloneDestination(value: OrganizerDestinationState): OrganizerDestinationState {
  return {
    key: value.key,
    baseId: value.baseId,
    primary: clonePrimary(value.primary),
    collections: {
      mode: value.collections.mode,
      targets: value.collections.targets.map((target) => ({ ...target })),
      clearAllConfirmed: value.collections.clearAllConfirmed,
    },
  };
}

function immutableDestination(value: OrganizerDestinationState): OrganizerDestinationDraft {
  return {
    baseId: value.baseId,
    primary: clonePrimary(value.primary),
    collections: {
      mode: value.collections.mode,
      targets: value.collections.targets.map((target) => ({ ...target })),
      clearAllConfirmed: value.collections.clearAllConfirmed,
    },
  };
}

/** Collects a folder's current Markdown descendants. It never creates a folder rule. */
export function collectOrganizerDescendantPaths(node: OrganizerVaultNode): string[] {
  if (node.kind === "note") return isMarkdownNote(node) ? [node.path] : [];
  const paths: string[] = [];
  for (const child of node.children) paths.push(...collectOrganizerDescendantPaths(child));
  return paths;
}

export function snapshotNoteOrganizerDraft(
  source: NoteOrganizerSource,
  selectedPaths: ReadonlySet<string>,
  destinations: readonly OrganizerDestinationState[],
  overrides: ReadonlyMap<string, OrganizerOverrideState>,
): NoteOrganizerDraft {
  const paths = [...selectedPaths].sort((left, right) => left.localeCompare(right));
  const immutableOverrides: OrganizerNoteOverrideDraft[] = [];
  for (const path of paths) {
    const override = overrides.get(path);
    if (!override) continue;
    immutableOverrides.push({
      path,
      mode: override.mode,
      destinations: override.mode === "custom" ? override.destinations.map(immutableDestination) : [],
    });
  }
  return {
    version: 1,
    source,
    selectedPaths: paths,
    destinations: destinations.map(immutableDestination),
    overrides: immutableOverrides,
  };
}

function findHeading(
  headings: readonly OrganizerHeadingOption[],
  headingId: string | null,
): OrganizerHeadingOption | null {
  return headings.find((heading) => heading.id === headingId) ?? null;
}

function validateDestination(
  value: OrganizerDestinationDraft,
  basesById: ReadonlyMap<string, OrganizerBaseOption>,
  label: string,
): string[] {
  const errors: string[] = [];
  const base = basesById.get(value.baseId);
  if (!base) return [`${label}: choose an available knowledge base.`];
  const primary = value.primary;
  if (primary.mode === "index") {
    const heading = findHeading(base.indexHeadings, primary.headingId);
    if (!heading) errors.push(`${label}: choose an exact ${base.indexName} heading.`);
    else if (primary.subheadingId && !heading.subheadings.some((item) => item.id === primary.subheadingId)) {
      errors.push(`${label}: the selected ${base.indexName} subheading is unavailable.`);
    }
  } else if (primary.mode === "library") {
    const library = base.libraries.find((item) => item.id === primary.libraryId);
    if (!library) errors.push(`${label}: choose a Library.`);
    else if (primary.headingId) {
      const heading = findHeading(library.headings, primary.headingId);
      if (!heading) errors.push(`${label}: choose an available Library heading or Unplaced in Library.`);
      else if (primary.subheadingId && !heading.subheadings.some((item) => item.id === primary.subheadingId)) {
        errors.push(`${label}: the selected Library subheading is unavailable.`);
      }
    } else if (primary.subheadingId) {
      errors.push(`${label}: a Library subheading requires an exact heading.`);
    }
  }
  if (value.collections.mode === "add" && value.collections.targets.length === 0) {
    errors.push(`${label}: Add to Collections needs at least one exact target.`);
  }
  if (value.collections.mode === "replace"
    && value.collections.targets.length === 0
    && !value.collections.clearAllConfirmed) {
    errors.push(`${label}: confirm that Replace with no targets clears every Collection membership in this knowledge base.`);
  }
  const targetKeys = new Set<string>();
  for (const target of value.collections.targets) {
    const collection = base.collections.find((item) => item.id === target.headingId);
    if (!collection) {
      errors.push(`${label}: choose an available Collection.`);
      continue;
    }
    if (target.subheadingId && !collection.subheadings.some((item) => item.id === target.subheadingId)) {
      errors.push(`${label}: the selected subheading for ${collection.name} is unavailable.`);
    }
    const key = `${target.headingId}\u0000${target.subheadingId ?? ""}`;
    if (targetKeys.has(key)) errors.push(`${label}: the same Collection target is listed more than once.`);
    targetKeys.add(key);
  }
  return errors;
}

export function validateNoteOrganizerDraft(
  draft: NoteOrganizerDraft,
  bases: readonly OrganizerBaseOption[],
): string[] {
  const errors: string[] = [];
  if (draft.selectedPaths.length === 0) errors.push("Select at least one Markdown note.");
  const basesById = new Map(bases.map((base) => [base.id, base]));
  const validateList = (destinations: readonly OrganizerDestinationDraft[], label: string): void => {
    const seen = new Set<string>();
    for (const [index, destination] of destinations.entries()) {
      if (destination.baseId && seen.has(destination.baseId)) {
        errors.push(`${label}: each knowledge base can appear only once.`);
      }
      if (destination.baseId) seen.add(destination.baseId);
      errors.push(...validateDestination(destination, basesById, `${label} destination ${index + 1}`));
    }
  };
  validateList(draft.destinations, "Shared");
  const overrideByPath = new Map(draft.overrides.map((override) => [override.path, override]));
  for (const path of draft.selectedPaths) {
    const override = overrideByPath.get(path);
    if (!override && draft.destinations.length === 0) {
      errors.push(`${path}: inherited destinations are empty.`);
    } else if (override?.mode === "custom") {
      if (override.destinations.length === 0) errors.push(`${path}: add at least one custom destination or choose Skip.`);
      validateList(override.destinations, path);
    }
  }
  for (const override of draft.overrides) {
    if (!draft.selectedPaths.includes(override.path)) errors.push(`${override.path}: override does not belong to a selected note.`);
  }
  return [...new Set(errors)];
}

export class NoteOrganizerModal extends Modal {
  static readonly TREE_PAGE_SIZE = TREE_PAGE_SIZE;
  static readonly OVERRIDE_PAGE_SIZE = OVERRIDE_PAGE_SIZE;
  static readonly REVIEW_PAGE_SIZE = REVIEW_PAGE_SIZE;
  static readonly SEARCH_DEBOUNCE_MS = SEARCH_DEBOUNCE_MS;

  private readonly instanceId = `ent-cc-note-organizer-${++organizerInstanceSequence}`;
  private readonly selectedPaths = new Set<string>();
  private readonly expandedFolders = new Set<string>();
  private readonly overrides = new Map<string, OrganizerOverrideState>();
  private readonly source: NoteOrganizerSource;
  private readonly preselectedPaths: readonly string[];
  private readonly onApplied: ((result: OrganizerApplyResult) => void) | null;
  private readonly onClosed: (() => void) | null;
  private vaultNodes: readonly OrganizerVaultNode[] = [];
  private searchIndex: NoteOrganizerSearchIndex | null = null;
  private searchPageCache: { query: string; page: number; value: NoteOrganizerSearchPage } | null = null;
  private bases: readonly OrganizerBaseOption[] = [];
  private destinations: OrganizerDestinationState[] = [];
  private nextDestinationKey = 1;
  private stage: OrganizerStage = "notes";
  private queryInput = "";
  private query = "";
  private searchTimer: number | null = null;
  private searchTimerWindow: Window | null = null;
  private treePage = 0;
  private overridePage = 0;
  private reviewPage = 0;
  private expandedCustomPath: string | null = null;
  private prepared: OrganizerPreparedPlan | null = null;
  private preparedUsable = false;
  private loading = true;
  private busy = false;
  private closingAfterApply = false;
  private loadError = "";
  private actionError = "";
  private liveMessage = "Loading vault notes and knowledge bases.";
  private pendingFocusKey: string | null = null;
  private selectionStatsCache: Map<string, OrganizerSelectionStats> | null = null;
  private renderRootEl: HTMLElement | null = null;
  private liveRegionEl: HTMLElement | null = null;
  private modalOpen = false;
  private closedNotified = false;
  private forceClosing = false;
  private discardConfirmed = false;
  private discardConfirmationVisible = false;

  constructor(private readonly host: NoteOrganizerHost, options: NoteOrganizerModalOptions = {}) {
    super(host.app);
    this.source = options.source ?? "command";
    this.preselectedPaths = options.preselectedPaths ?? [];
    this.onApplied = options.onApplied ?? null;
    this.onClosed = options.onClosed ?? null;
  }

  override close(): void {
    if (this.busy && !this.closingAfterApply && !this.forceClosing) {
      new Notice("Wait for the organizer action to finish.");
      return;
    }
    if (this.modalOpen
      && !this.closingAfterApply
      && !this.forceClosing
      && !this.discardConfirmed
      && this.selectedPaths.size > 0) {
      this.discardConfirmationVisible = true;
      const noteLabel = this.selectedPaths.size === 1 ? "note" : "notes";
      this.liveMessage = `Discard this organizer draft with ${this.selectedPaths.size.toLocaleString()} selected ${noteLabel}?`;
      this.pendingFocusKey = "discard-cancel";
      this.render();
      return;
    }
    super.close();
  }

  /** Plugin unload must release the App-wide modal claim even during I/O. */
  dismissImmediately(): void {
    this.forceClosing = true;
    this.close();
  }

  onOpen(): void {
    this.modalOpen = true;
    this.modalEl.addClass("ent-cc-note-organizer-modal");
    this.contentEl.addClass("ent-cc-note-organizer-root");
    this.titleEl.setText("Organize vault notes");
    this.titleEl.setAttribute("id", `${this.instanceId}-title`);
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.modalEl.setAttribute("aria-labelledby", `${this.instanceId}-title`);
    this.modalEl.setAttribute("aria-describedby", `${this.instanceId}-boundary`);
    this.ensurePersistentElements();
    this.render();
    void this.loadSnapshot();
  }

  onClose(): void {
    this.modalOpen = false;
    this.cancelSearchTimer();
    this.contentEl.empty();
    this.renderRootEl = null;
    this.liveRegionEl = null;
    this.prepared = null;
    this.preparedUsable = false;
    if (!this.closedNotified) {
      this.closedNotified = true;
      try {
        this.onClosed?.();
      } catch (error) {
        console.error("Knowledge Base Command Center could not finish closing the note organizer", error);
      }
    }
  }

  private async loadSnapshot(): Promise<void> {
    try {
      const [nodes, bases] = await Promise.all([
        this.host.getVaultSnapshot(),
        this.host.getBases(),
      ]);
      this.vaultNodes = nodes;
      this.searchIndex = buildNoteOrganizerSearchIndex(nodes);
      this.bases = bases;
      this.selectPreseededPaths();
      this.destinations = bases.length > 0 ? [this.createDestination(bases[0]?.id ?? "")] : [];
      this.liveMessage = `${this.selectedPaths.size.toLocaleString()} Markdown notes selected.`;
    } catch (error) {
      this.loadError = `Could not load the organizer: ${errorText(error)}`;
      this.liveMessage = this.loadError;
    } finally {
      this.loading = false;
      if (this.modalOpen) this.render();
    }
  }

  private selectPreseededPaths(): void {
    if (this.preselectedPaths.length === 0) return;
    for (const path of this.preselectedPaths) {
      const row = this.searchIndex?.rowByPath.get(path);
      if (row && isMarkdownNote(row.node)) this.selectedPaths.add(path);
    }
  }

  private createDestination(baseId: string): OrganizerDestinationState {
    return {
      key: this.nextDestinationKey++,
      baseId,
      primary: { mode: "keep", libraryId: null, headingId: null, subheadingId: null },
      collections: { mode: "keep", targets: [], clearAllConfirmed: false },
    };
  }

  private render(): void {
    if (!this.modalOpen) return;
    const renderRoot = this.ensurePersistentElements();
    renderRoot.empty();
    renderRoot.setAttribute("aria-busy", String(this.loading || this.busy));
    this.renderProgress(renderRoot);
    renderRoot.createDiv({
      cls: "ent-cc-note-organizer-boundary",
      text: "Organization is stored only in KBCC plugin data. Folder selection is a one-time snapshot; it never links a folder. Markdown files stay where they are and are never rewritten.",
      attr: { id: `${this.instanceId}-boundary`, role: "note" },
    });
    if (this.host.isReadOnly?.() === true) {
      renderRoot.createDiv({
        cls: "ent-cc-note-organizer-read-only",
        text: "KBCC organization is read-only. You can inspect the organizer, but review and Apply stay unavailable until the current data or Sync protection is resolved.",
        attr: { role: "status" },
      });
    }
    if (this.loadError) {
      renderRoot.createDiv({ cls: "ent-cc-note-organizer-error", text: this.loadError, attr: { role: "alert" } });
      this.renderFooter(renderRoot);
      this.renderLiveRegion();
      this.restorePendingFocus();
      return;
    }
    if (this.loading) {
      renderRoot.createDiv({ cls: "ent-cc-note-organizer-loading", text: "Loading Markdown notes and KBCC destinations…" });
      this.renderLiveRegion();
      this.restorePendingFocus();
      return;
    }
    if (this.actionError) {
      renderRoot.createDiv({
        cls: "ent-cc-note-organizer-error",
        text: this.actionError,
        attr: { role: "alert", tabindex: "-1", "data-organizer-focus": "action-error" },
      });
    }
    const panel = renderRoot.createDiv({
      cls: "ent-cc-note-organizer-panel",
      attr: {
        role: "region",
        id: `${this.instanceId}-panel-${this.stage}`,
        "aria-labelledby": `${this.instanceId}-step-${this.stage}`,
      },
    });
    if (this.stage === "notes") this.renderNotes(panel);
    else if (this.stage === "destinations") this.renderDestinations(panel);
    else this.renderReview(panel);
    this.renderFooter(renderRoot);
    this.renderLiveRegion();
    this.restorePendingFocus();
  }

  private ensurePersistentElements(): HTMLElement {
    if (this.renderRootEl && this.liveRegionEl
      && this.contentEl.contains(this.renderRootEl)
      && this.contentEl.contains(this.liveRegionEl)) {
      return this.renderRootEl;
    }
    this.contentEl.empty();
    this.contentEl.removeAttribute("aria-busy");
    this.renderRootEl = this.contentEl.createDiv({ cls: "ent-cc-note-organizer-render-root" });
    this.liveRegionEl = this.contentEl.createDiv({
      cls: "ent-cc-note-organizer-live",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    return this.renderRootEl;
  }

  private renderProgress(parent: HTMLElement): void {
    const list = parent.createEl("ol", {
      cls: "ent-cc-note-organizer-progress",
      attr: { "aria-label": "Organizer progress" },
    });
    const stages: Array<{ id: OrganizerStage; label: string }> = [
      { id: "notes", label: "Notes" },
      { id: "destinations", label: "Destinations" },
      { id: "review", label: "Review" },
    ];
    const activeIndex = stages.findIndex((item) => item.id === this.stage);
    for (const [index, item] of stages.entries()) {
      const entry = list.createEl("li", {
        cls: `ent-cc-note-organizer-progress-step ${index === activeIndex ? "is-active" : ""} ${index < activeIndex ? "is-complete" : ""}`,
        attr: {
          id: `${this.instanceId}-step-${item.id}`,
          ...(index === activeIndex ? { "aria-current": "step" } : {}),
        },
      });
      entry.createSpan({ cls: "ent-cc-note-organizer-progress-number", text: String(index + 1), attr: { "aria-hidden": "true" } });
      entry.createSpan({ text: item.label });
    }
  }

  private renderNotes(parent: HTMLElement): void {
    const intro = parent.createDiv({ cls: "ent-cc-note-organizer-section-heading" });
    intro.createEl("h3", {
      text: "Choose Markdown notes",
      attr: { tabindex: "-1", "data-organizer-focus": "stage-heading:notes" },
    });
    intro.createEl("p", { text: "Select individual notes or take a one-time snapshot of a folder’s current Markdown descendants." });
    const layout = parent.createDiv({ cls: "ent-cc-note-organizer-notes-layout" });
    const browser = layout.createDiv({ cls: "ent-cc-note-organizer-browser" });
    const search = browser.createEl("input", {
      type: "search",
      cls: "ent-cc-note-organizer-search",
      attr: {
        value: this.queryInput,
        placeholder: "Search note title or path",
        "aria-label": "Search Markdown notes",
        enterkeyhint: "search",
        "data-organizer-focus": "note-search",
      },
    });
    search.value = this.queryInput;
    search.disabled = this.busy;
    search.addEventListener("input", () => {
      this.queryInput = search.value;
      this.scheduleSearch();
    });
    const page = this.collectTreePage();
    const tree = browser.createDiv({
      cls: "ent-cc-note-organizer-tree",
      attr: { role: "tree", "aria-label": "Markdown vault tree", "aria-multiselectable": "true" },
    });
    const stats = this.collectSelectionStats();
    const positionOffset = this.treePage * TREE_PAGE_SIZE;
    for (const [index, row] of page.rows.entries()) {
      this.renderTreeRow(tree, row, stats, index === 0, positionOffset + index + 1, page.total);
    }
    if (page.total === 0) {
      tree.createDiv({
        cls: "ent-cc-note-organizer-empty",
        text: this.query ? "No Markdown notes match this search." : "No Markdown notes are available.",
      });
    }
    this.renderPagination(browser, this.treePage, page.total, TREE_PAGE_SIZE, (pageIndex) => {
      this.treePage = pageIndex;
      this.render();
    }, "vault tree rows");
    this.renderSelectedTray(layout);
  }

  private collectSelectionStats(): Map<string, OrganizerSelectionStats> {
    if (this.selectionStatsCache) return this.selectionStatsCache;
    const stats = new Map<string, OrganizerSelectionStats>();
    const index = this.searchIndex;
    if (!index) return stats;
    for (const [path, total] of index.folderTotalByPath) stats.set(path, { selected: 0, total });
    for (const path of this.selectedPaths) {
      let parentPath = index.rowByPath.get(path)?.parentPath ?? null;
      while (parentPath) {
        const current = stats.get(parentPath);
        if (current) current.selected += 1;
        parentPath = index.rowByPath.get(parentPath)?.parentPath ?? null;
      }
    }
    this.selectionStatsCache = stats;
    return stats;
  }

  private cancelSearchTimer(): void {
    if (this.searchTimer !== null) this.searchTimerWindow?.clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.searchTimerWindow = null;
  }

  private scheduleSearch(): void {
    this.cancelSearchTimer();
    const viewWindow = this.contentEl.ownerDocument.defaultView;
    if (!viewWindow) {
      this.commitSearch();
      return;
    }
    this.searchTimerWindow = viewWindow;
    let firedSynchronously = false;
    const timer = viewWindow.setTimeout(() => {
      firedSynchronously = true;
      this.searchTimer = null;
      this.searchTimerWindow = null;
      if (this.modalOpen) this.commitSearch();
    }, SEARCH_DEBOUNCE_MS);
    this.searchTimer = firedSynchronously ? null : timer;
    const live = this.contentEl.querySelector<HTMLElement>(".ent-cc-note-organizer-live");
    live?.setText("Search waiting for typing to pause.");
  }

  private commitSearch(): void {
    const nextQuery = normalizedSearchText(this.queryInput);
    if (nextQuery === this.query) return;
    this.query = nextQuery;
    this.treePage = 0;
    this.searchPageCache = null;
    this.pendingFocusKey = "note-search";
    this.liveMessage = nextQuery ? "Vault note search updated." : "Vault note search cleared.";
    this.render();
  }

  private collectTreePage(): OrganizerTreePage {
    if (this.query) {
      const cached = this.searchPageCache;
      if (cached && cached.query === this.query && cached.page === this.treePage) return cached.value;
      const value = this.searchIndex
        ? queryNoteOrganizerSearchIndex(this.searchIndex, this.query, this.treePage, TREE_PAGE_SIZE)
        : { rows: [], total: 0, scannedNotes: 0 };
      this.searchPageCache = { query: this.query, page: this.treePage, value };
      return value;
    }
    const start = this.treePage * TREE_PAGE_SIZE;
    const end = start + TREE_PAGE_SIZE;
    const rows: OrganizerTreeRow[] = [];
    let total = 0;
    const visit = (nodes: readonly OrganizerVaultNode[], level: number, parentPath: string | null): void => {
      for (const node of nodes) {
        if (node.kind === "note" && !isMarkdownNote(node)) continue;
        if (total >= start && total < end) rows.push({ node, level, parentPath });
        total += 1;
        const showChildren = node.kind === "folder" && this.expandedFolders.has(node.path);
        if (showChildren) visit(node.children, level + 1, node.path);
      }
    };
    visit(this.vaultNodes, 1, null);
    const lastPage = Math.max(0, Math.ceil(total / TREE_PAGE_SIZE) - 1);
    if (this.treePage > lastPage) {
      this.treePage = lastPage;
      return { rows: [], total };
    }
    return { rows, total };
  }

  /** Resolve a visible row's page only for rare cross-page tree navigation. */
  private visibleTreePageForPath(targetPath: string): number | null {
    let position = 0;
    if (this.query) {
      const index = this.searchIndex;
      if (!index) return null;
      const emitted = new Set<string>();
      const emit = (row: OrganizerTreeRow): number | null => {
        if (emitted.has(row.node.path)) return null;
        emitted.add(row.node.path);
        if (row.node.path === targetPath) return Math.floor(position / TREE_PAGE_SIZE);
        position += 1;
        return null;
      };
      for (const entry of index.noteEntries) {
        if (!entry.normalizedText.includes(this.query)) continue;
        const ancestors: OrganizerTreeRow[] = [];
        let parentPath = entry.row.parentPath;
        while (parentPath) {
          const parent = index.rowByPath.get(parentPath);
          if (!parent) break;
          ancestors.push(parent);
          parentPath = parent.parentPath;
        }
        for (let ancestorIndex = ancestors.length - 1; ancestorIndex >= 0; ancestorIndex -= 1) {
          const ancestor = ancestors[ancestorIndex];
          if (ancestor) {
            const page = emit(ancestor);
            if (page !== null) return page;
          }
        }
        const page = emit(entry.row);
        if (page !== null) return page;
      }
      return null;
    }
    let found: number | null = null;
    const visit = (nodes: readonly OrganizerVaultNode[]): void => {
      for (const node of nodes) {
        if (found !== null || (node.kind === "note" && !isMarkdownNote(node))) continue;
        if (node.path === targetPath) {
          found = Math.floor(position / TREE_PAGE_SIZE);
          return;
        }
        position += 1;
        if (node.kind === "folder" && this.expandedFolders.has(node.path)) visit(node.children);
      }
    };
    visit(this.vaultNodes);
    return found;
  }

  /** Find the next visible row without materializing an unbounded tree page. */
  private visibleTreeSuccessorPath(targetPath: string): string | null {
    let foundTarget = false;
    let successor: string | null = null;
    if (this.query) {
      const index = this.searchIndex;
      if (!index) return null;
      const emitted = new Set<string>();
      const emit = (row: OrganizerTreeRow): boolean => {
        if (emitted.has(row.node.path)) return false;
        emitted.add(row.node.path);
        if (foundTarget) {
          successor = row.node.path;
          return true;
        }
        if (row.node.path === targetPath) foundTarget = true;
        return false;
      };
      for (const entry of index.noteEntries) {
        if (!entry.normalizedText.includes(this.query)) continue;
        const ancestors: OrganizerTreeRow[] = [];
        let parentPath = entry.row.parentPath;
        while (parentPath) {
          const parent = index.rowByPath.get(parentPath);
          if (!parent) break;
          ancestors.push(parent);
          parentPath = parent.parentPath;
        }
        for (let ancestorIndex = ancestors.length - 1; ancestorIndex >= 0; ancestorIndex -= 1) {
          const ancestor = ancestors[ancestorIndex];
          if (ancestor && emit(ancestor)) return successor;
        }
        if (emit(entry.row)) return successor;
      }
      return null;
    }
    const visit = (nodes: readonly OrganizerVaultNode[]): void => {
      for (const node of nodes) {
        if (successor !== null || (node.kind === "note" && !isMarkdownNote(node))) continue;
        if (foundTarget) {
          successor = node.path;
          return;
        }
        if (node.path === targetPath) foundTarget = true;
        if (node.kind === "folder" && this.expandedFolders.has(node.path)) visit(node.children);
      }
    };
    visit(this.vaultNodes);
    return successor;
  }

  private renderTreeRow(
    parent: HTMLElement,
    row: OrganizerTreeRow,
    stats: ReadonlyMap<string, OrganizerSelectionStats>,
    first: boolean,
    positionInSet: number,
    setSize: number,
  ): void {
    const nodeStats = stats.get(row.node.path) ?? (isMarkdownNote(row.node)
      ? { selected: this.selectedPaths.has(row.node.path) ? 1 : 0, total: 1 }
      : { selected: 0, total: 0 });
    const checkedState = nodeStats.total > 0 && nodeStats.selected === nodeStats.total
      ? "true"
      : nodeStats.selected > 0 ? "mixed" : "false";
    const item = parent.createDiv({
      cls: "ent-cc-note-organizer-tree-item",
      attr: {
        role: "treeitem",
        tabindex: first ? "0" : "-1",
        "aria-level": String(row.level),
        "aria-posinset": String(positionInSet),
        "aria-setsize": String(setSize),
        "aria-checked": checkedState,
        "data-organizer-node-path": row.node.path,
        "data-organizer-focus": `tree-row:${row.node.path}`,
        ...(row.parentPath ? { "data-organizer-parent-path": row.parentPath } : {}),
        ...(row.node.kind === "folder"
          ? { "aria-expanded": String(Boolean(this.query) || this.expandedFolders.has(row.node.path)) }
          : {}),
      },
    });
    item.style.setProperty("--ent-cc-note-organizer-depth", String(Math.max(0, row.level - 1)));
    if (row.node.kind === "folder") {
      const folder = row.node;
      const toggle = item.createEl("button", {
        cls: "ent-cc-note-organizer-tree-toggle",
        attr: {
          type: "button",
          "aria-label": `${this.expandedFolders.has(folder.path) ? "Collapse" : "Expand"} ${folder.name}`,
          ...(this.query ? { disabled: "" } : {}),
          "data-organizer-focus": `tree-toggle:${folder.path}`,
        },
      });
      toggle.disabled = Boolean(this.query);
      setIcon(toggle, Boolean(this.query) || this.expandedFolders.has(folder.path) ? "chevron-down" : "chevron-right");
      toggle.addEventListener("click", () => this.toggleFolderExpanded(folder, `tree-toggle:${folder.path}`));
    } else {
      item.createSpan({ cls: "ent-cc-note-organizer-tree-spacer", attr: { "aria-hidden": "true" } });
    }
    const selectionTarget = item.createEl("label", { cls: "ent-cc-note-organizer-checkbox-target" });
    const selection = selectionTarget.createEl("input", {
      type: "checkbox",
      cls: "ent-cc-note-organizer-tree-checkbox",
      attr: {
        "aria-label": row.node.kind === "folder"
          ? `Select current Markdown notes in ${row.node.name}`
          : `Select ${row.node.name}`,
        "data-organizer-focus": `tree-check:${row.node.path}`,
      },
    });
    selection.checked = checkedState === "true";
    selection.indeterminate = checkedState === "mixed";
    selection.disabled = this.busy || nodeStats.total === 0;
    selection.addEventListener("change", () => this.setNodeSelected(
      row.node,
      selection.checked,
      `tree-check:${row.node.path}`,
    ));
    const icon = item.createSpan({ cls: "ent-cc-note-organizer-tree-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, row.node.kind === "folder" ? "folder" : "file-text");
    const text = item.createDiv({ cls: "ent-cc-note-organizer-tree-text" });
    text.createDiv({ cls: "ent-cc-note-organizer-tree-name", text: row.node.name, attr: { dir: "auto" } });
    text.createDiv({ cls: "ent-cc-note-organizer-tree-path", text: row.node.path, attr: { dir: "auto" } });
    item.addEventListener("keydown", (event) => this.handleTreeKey(event, item, row.node));
  }

  private toggleFolderExpanded(node: OrganizerVaultFolder, focusKey = `tree-row:${node.path}`): void {
    if (this.query) return;
    if (this.expandedFolders.has(node.path)) this.expandedFolders.delete(node.path);
    else this.expandedFolders.add(node.path);
    this.treePage = 0;
    this.pendingFocusKey = focusKey;
    this.render();
  }

  private setNodeSelected(node: OrganizerVaultNode, selected: boolean, focusKey = `tree-row:${node.path}`): void {
    const paths = collectOrganizerDescendantPaths(node);
    if (selected) {
      let additions = 0;
      for (const path of paths) if (!this.selectedPaths.has(path)) additions += 1;
      if (this.selectedPaths.size + additions > MAX_NOTE_ORGANIZER_NOTES) {
        this.actionError = `Choose at most ${MAX_NOTE_ORGANIZER_NOTES.toLocaleString()} Markdown notes in one organizer review. Select a smaller folder or refine the vault search.`;
        this.liveMessage = this.actionError;
        this.pendingFocusKey = focusKey;
        this.render();
        return;
      }
    }
    for (const path of paths) {
      if (selected) this.selectedPaths.add(path);
      else {
        this.selectedPaths.delete(path);
        this.overrides.delete(path);
        if (this.expandedCustomPath === path) this.expandedCustomPath = null;
      }
    }
    this.selectionStatsCache = null;
    this.invalidatePrepared();
    this.actionError = "";
    this.liveMessage = `${this.selectedPaths.size.toLocaleString()} Markdown notes selected.`;
    this.pendingFocusKey = focusKey;
    this.render();
  }

  private handleTreeKey(event: KeyboardEvent, item: HTMLElement, node: OrganizerVaultNode): void {
    if (!noteOrganizerTreeItemOwnsEvent(event.currentTarget, event.target)) return;
    const items = Array.from(this.contentEl.querySelectorAll<HTMLElement>("[role=\"treeitem\"]"));
    const index = items.indexOf(item);
    let target: HTMLElement | null = null;
    if (event.key === "ArrowDown") {
      target = items[index + 1] ?? null;
      if (!target && this.focusTreePageEdge(event, this.treePage + 1, "first")) return;
    } else if (event.key === "ArrowUp") {
      target = items[index - 1] ?? null;
      if (!target && this.focusTreePageEdge(event, this.treePage - 1, "last")) return;
    } else if (event.key === "Home") {
      if (this.treePage > 0 && this.focusTreePageEdge(event, 0, "first")) return;
      target = items[0] ?? null;
    } else if (event.key === "End") {
      const page = this.collectTreePage();
      const lastPage = Math.max(0, Math.ceil(page.total / TREE_PAGE_SIZE) - 1);
      if (this.treePage < lastPage && this.focusTreePageEdge(event, lastPage, "last")) return;
      target = items[items.length - 1] ?? null;
    } else if (event.key === "ArrowRight" && node.kind === "folder") {
      if (!this.expandedFolders.has(node.path) && !this.query) {
        event.preventDefault();
        this.toggleFolderExpanded(node);
        return;
      }
      const next = items[index + 1] ?? null;
      target = next?.getAttribute("data-organizer-parent-path") === node.path ? next : null;
      if (!target) {
        const successorPath = this.visibleTreeSuccessorPath(node.path);
        const successorRow = successorPath ? this.searchIndex?.rowByPath.get(successorPath) : null;
        if (successorPath && successorRow?.parentPath === node.path) {
          const childPage = this.visibleTreePageForPath(successorPath);
          if (childPage !== null) {
            event.preventDefault();
            this.treePage = childPage;
            this.searchPageCache = null;
            this.pendingFocusKey = `tree-row:${successorPath}`;
            this.render();
            return;
          }
        }
      }
    } else if (event.key === "ArrowLeft") {
      if (node.kind === "folder" && this.expandedFolders.has(node.path) && !this.query) {
        event.preventDefault();
        this.toggleFolderExpanded(node);
        return;
      }
      const parentPath = item.getAttribute("data-organizer-parent-path");
      target = items.find((candidate) => candidate.getAttribute("data-organizer-node-path") === parentPath) ?? null;
      if (!target && parentPath) {
        const parentPage = this.visibleTreePageForPath(parentPath);
        if (parentPage !== null) {
          event.preventDefault();
          this.treePage = parentPage;
          this.searchPageCache = null;
          this.pendingFocusKey = `tree-row:${parentPath}`;
          this.render();
          return;
        }
      }
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const stats = this.collectSelectionStats().get(node.path) ?? (isMarkdownNote(node)
        ? { selected: this.selectedPaths.has(node.path) ? 1 : 0, total: 1 }
        : { selected: 0, total: 0 });
      this.setNodeSelected(node, stats.total === 0 || stats.selected !== stats.total, `tree-row:${node.path}`);
      return;
    }
    if (!target) return;
    event.preventDefault();
    for (const candidate of items) candidate.setAttribute("tabindex", candidate === target ? "0" : "-1");
    target.focus();
  }

  private focusTreePageEdge(event: KeyboardEvent, pageIndex: number, edge: "first" | "last"): boolean {
    if (pageIndex < 0) return false;
    const previousPage = this.treePage;
    const previousCache = this.searchPageCache;
    this.treePage = pageIndex;
    this.searchPageCache = null;
    const page = this.collectTreePage();
    const row = edge === "first" ? page.rows[0] : page.rows[page.rows.length - 1];
    if (!row) {
      this.treePage = previousPage;
      this.searchPageCache = previousCache;
      return false;
    }
    event.preventDefault();
    this.pendingFocusKey = `tree-row:${row.node.path}`;
    this.render();
    return true;
  }

  private renderSelectedTray(parent: HTMLElement): void {
    const tray = parent.createDiv({ cls: "ent-cc-note-organizer-selected" });
    const heading = tray.createDiv({ cls: "ent-cc-note-organizer-selected-heading" });
    heading.createEl("h3", { text: `Selected notes (${this.selectedPaths.size.toLocaleString()})` });
    const clear = heading.createEl("button", {
      cls: "ent-cc-note-organizer-text-button",
      text: "Clear",
      attr: { type: "button", "aria-label": "Clear all selected notes", "data-organizer-focus": "selected-clear" },
    });
    clear.disabled = this.selectedPaths.size === 0 || this.busy;
    clear.addEventListener("click", () => {
      this.selectedPaths.clear();
      this.overrides.clear();
      this.expandedCustomPath = null;
      this.selectionStatsCache = null;
      this.invalidatePrepared();
      this.liveMessage = "No Markdown notes selected.";
      this.pendingFocusKey = "stage-heading:notes";
      this.render();
    });
    if (this.selectedPaths.size === 0) {
      tray.createDiv({ cls: "ent-cc-note-organizer-empty", text: "Choose notes from the vault tree." });
      return;
    }
    const list = tray.createEl("ul", { cls: "ent-cc-note-organizer-selected-list" });
    const visible = [...this.selectedPaths].sort((left, right) => left.localeCompare(right)).slice(0, SELECTED_TRAY_LIMIT);
    for (const path of visible) {
      const item = list.createEl("li", { cls: "ent-cc-note-organizer-selected-item" });
      item.createSpan({ text: path, attr: { dir: "auto" } });
      const remove = item.createEl("button", {
        cls: "ent-cc-note-organizer-remove",
        attr: { type: "button", "aria-label": `Remove ${path} from selected notes` },
      });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.selectedPaths.delete(path);
        this.overrides.delete(path);
        this.selectionStatsCache = null;
        this.invalidatePrepared();
        this.liveMessage = `${this.selectedPaths.size.toLocaleString()} Markdown notes selected.`;
        this.pendingFocusKey = "selected-clear";
        this.render();
      });
    }
    const omitted = this.selectedPaths.size - visible.length;
    if (omitted > 0) tray.createDiv({ cls: "ent-cc-note-organizer-omitted", text: `${omitted.toLocaleString()} more selected notes are retained without rendering them here.` });
  }

  private renderDestinations(parent: HTMLElement): void {
    const intro = parent.createDiv({ cls: "ent-cc-note-organizer-section-heading" });
    intro.createEl("h3", {
      text: "Choose knowledge-base destinations",
      attr: { tabindex: "-1", "data-organizer-focus": "stage-heading:destinations" },
    });
    intro.createEl("p", { text: `${this.selectedPaths.size.toLocaleString()} selected notes inherit the shared destinations unless you choose Skip or Custom below.` });
    if (this.bases.length === 0) {
      parent.createDiv({ cls: "ent-cc-note-organizer-error", text: "Create a KBCC knowledge base before organizing notes.", attr: { role: "alert" } });
      return;
    }
    const shared = parent.createDiv({ cls: "ent-cc-note-organizer-destination-section" });
    const sharedHeading = shared.createDiv({ cls: "ent-cc-note-organizer-destination-heading" });
    sharedHeading.createEl("h4", { text: "Shared destinations" });
    const add = sharedHeading.createEl("button", {
      cls: "ent-cc-note-organizer-secondary-button",
      text: "Add knowledge base",
      attr: { type: "button", "data-organizer-focus": "add-base:shared" },
    });
    add.disabled = this.busy || this.destinations.length >= this.bases.length;
    add.addEventListener("click", () => {
      const used = new Set(this.destinations.map((item) => item.baseId));
      const base = this.bases.find((item) => !used.has(item.id));
      if (!base) return;
      const destination = this.createDestination(base.id);
      this.destinations.push(destination);
      this.invalidatePrepared();
      this.pendingFocusKey = `field:shared-${destination.key}-base`;
      this.render();
    });
    this.renderDestinationList(shared, this.destinations, "shared");
    this.renderOverrides(parent);
  }

  private renderOverrides(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "ent-cc-note-organizer-overrides" });
    const heading = section.createDiv({ cls: "ent-cc-note-organizer-destination-heading" });
    heading.createEl("h4", { text: "Per-note behavior" });
    heading.createEl("p", { text: "Overrides are optional and loaded one note at a time." });
    const paths = [...this.selectedPaths].sort((left, right) => left.localeCompare(right));
    const totalPages = Math.max(1, Math.ceil(paths.length / OVERRIDE_PAGE_SIZE));
    this.overridePage = Math.min(this.overridePage, totalPages - 1);
    const start = this.overridePage * OVERRIDE_PAGE_SIZE;
    const visible = paths.slice(start, start + OVERRIDE_PAGE_SIZE);
    const list = section.createDiv({ cls: "ent-cc-note-organizer-override-list" });
    for (const path of visible) {
      const override = this.overrides.get(path);
      const row = list.createDiv({ cls: "ent-cc-note-organizer-override-row" });
      const identity = row.createDiv({ cls: "ent-cc-note-organizer-override-identity" });
      identity.createDiv({ cls: "ent-cc-note-organizer-override-title", text: this.noteName(path), attr: { dir: "auto" } });
      identity.createDiv({ cls: "ent-cc-note-organizer-override-path", text: path, attr: { dir: "auto" } });
      const mode = this.selectControl(
        row,
        `Behavior for ${this.noteName(path)}`,
        override?.mode ?? "inherit",
        [
          { value: "inherit", label: "Use shared destinations" },
          { value: "skip", label: "Skip this note" },
          { value: "custom", label: "Custom destinations" },
        ],
        (value) => this.setOverrideMode(path, value as OrganizerOverrideMode),
        `override-mode:${path}`,
      );
      mode.addClass("ent-cc-note-organizer-override-mode");
      if (override?.mode === "custom") {
        const edit = row.createEl("button", {
          cls: "ent-cc-note-organizer-secondary-button",
          text: this.expandedCustomPath === path ? "Close custom editor" : "Edit custom destinations",
          attr: {
            type: "button",
            "aria-expanded": String(this.expandedCustomPath === path),
            "data-organizer-focus": `custom-toggle:${path}`,
          },
        });
        edit.addEventListener("click", () => {
          this.expandedCustomPath = this.expandedCustomPath === path ? null : path;
          this.pendingFocusKey = `custom-toggle:${path}`;
          this.render();
        });
      }
      if (override?.mode === "custom" && this.expandedCustomPath === path) {
        const custom = row.createDiv({ cls: "ent-cc-note-organizer-custom-editor" });
        custom.createDiv({
          cls: "ent-cc-note-organizer-custom-label",
          text: `Custom destinations for ${this.noteName(path)}`,
          attr: { dir: "auto" },
        });
        const add = custom.createEl("button", {
          cls: "ent-cc-note-organizer-secondary-button",
          text: "Add custom knowledge base",
          attr: { type: "button", "data-organizer-focus": `add-base:custom-${path}` },
        });
        add.disabled = override.destinations.length >= this.bases.length;
        add.addEventListener("click", () => {
          const used = new Set(override.destinations.map((item) => item.baseId));
          const base = this.bases.find((item) => !used.has(item.id));
          if (!base) return;
          const destination = this.createDestination(base.id);
          override.destinations.push(destination);
          this.invalidatePrepared();
          this.pendingFocusKey = `field:custom-${path}-${destination.key}-base`;
          this.render();
        });
        this.renderDestinationList(custom, override.destinations, `custom-${path}`);
      }
    }
    this.renderPagination(section, this.overridePage, paths.length, OVERRIDE_PAGE_SIZE, (pageIndex) => {
      this.overridePage = pageIndex;
      this.expandedCustomPath = null;
      this.render();
    }, "selected notes");
  }

  private setOverrideMode(path: string, mode: OrganizerOverrideMode): void {
    if (mode === "inherit") {
      this.overrides.delete(path);
      if (this.expandedCustomPath === path) this.expandedCustomPath = null;
    } else if (mode === "skip") {
      this.overrides.set(path, { mode: "skip", destinations: [] });
      if (this.expandedCustomPath === path) this.expandedCustomPath = null;
    } else {
      const existing = this.overrides.get(path);
      this.overrides.set(path, {
        mode: "custom",
        destinations: existing?.mode === "custom"
          ? existing.destinations
          : this.destinations.map(cloneDestination),
      });
      this.expandedCustomPath = path;
    }
    this.invalidatePrepared();
    this.render();
  }

  private renderDestinationList(
    parent: HTMLElement,
    destinations: OrganizerDestinationState[],
    ownerKey: string,
  ): void {
    if (destinations.length === 0) {
      parent.createDiv({ cls: "ent-cc-note-organizer-empty", text: "No destinations. Add a knowledge base." });
      return;
    }
    for (const destination of destinations) {
      const card = parent.createDiv({ cls: "ent-cc-note-organizer-destination-card" });
      const header = card.createDiv({ cls: "ent-cc-note-organizer-card-header" });
      header.createEl("h5", { text: "Knowledge base destination" });
      const selectedBase = this.bases.find((item) => item.id === destination.baseId) ?? null;
      if (selectedBase?.current) {
        header.createSpan({ cls: "ent-cc-note-organizer-current-base", text: "Current" });
      }
      const remove = header.createEl("button", {
        cls: "ent-cc-note-organizer-remove",
        attr: { type: "button", "aria-label": "Remove this knowledge base destination" },
      });
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        const index = destinations.findIndex((item) => item.key === destination.key);
        if (index >= 0) destinations.splice(index, 1);
        this.invalidatePrepared();
        this.pendingFocusKey = `add-base:${ownerKey}`;
        this.render();
      });
      const baseSelect = this.labeledSelect(
        card,
        "Knowledge base",
        `${ownerKey}-${destination.key}-base`,
        destination.baseId,
        this.bases.map((base) => ({ value: base.id, label: `${base.name}${base.current ? " — Current" : ""}` })),
        (value) => {
          destination.baseId = value;
          destination.primary = { mode: "keep", libraryId: null, headingId: null, subheadingId: null };
          destination.collections = { mode: "keep", targets: [], clearAllConfirmed: false };
          this.invalidatePrepared();
          this.render();
        },
      );
      baseSelect.setAttribute("data-organizer-field", "base");
      const base = this.bases.find((item) => item.id === destination.baseId) ?? null;
      this.renderPrimaryEditor(card, destination, base, ownerKey);
      this.renderCollectionsEditor(card, destination, base, ownerKey);
    }
  }

  private renderPrimaryEditor(
    parent: HTMLElement,
    destination: OrganizerDestinationState,
    base: OrganizerBaseOption | null,
    ownerKey: string,
  ): void {
    const section = parent.createEl("fieldset", { cls: "ent-cc-note-organizer-fieldset" });
    section.createEl("legend", { text: "Primary placement" });
    this.labeledSelect(
      section,
      "Action",
      `${ownerKey}-${destination.key}-primary-mode`,
      destination.primary.mode,
      [
        { value: "keep", label: "Keep current primary placement" },
        { value: "index", label: `Place in ${base?.indexName ?? "Knowledge Index"}` },
        { value: "library", label: "Place in a Library" },
        { value: "none", label: "No primary placement" },
      ],
      (value) => {
        destination.primary = {
          mode: value as OrganizerPrimaryMode,
          libraryId: null,
          headingId: null,
          subheadingId: null,
        };
        this.invalidatePrepared();
        this.render();
      },
    );
    if (!base || (destination.primary.mode !== "index" && destination.primary.mode !== "library")) return;
    let headings: readonly OrganizerHeadingOption[] = [];
    if (destination.primary.mode === "library") {
      const libraryId = destination.primary.libraryId ?? base.libraries[0]?.id ?? "";
      if (destination.primary.libraryId !== libraryId) destination.primary.libraryId = libraryId || null;
      this.labeledSelect(
        section,
        "Library",
        `${ownerKey}-${destination.key}-library`,
        libraryId,
        base.libraries.map((library) => ({ value: library.id, label: library.name })),
        (value) => {
          destination.primary.libraryId = value || null;
          destination.primary.headingId = null;
          destination.primary.subheadingId = null;
          this.invalidatePrepared();
          this.render();
        },
      );
      headings = base.libraries.find((library) => library.id === libraryId)?.headings ?? [];
    } else {
      headings = base.indexHeadings;
    }
    const headingId = destination.primary.mode === "library"
      ? destination.primary.headingId ?? ""
      : destination.primary.headingId ?? headings[0]?.id ?? "";
    if (destination.primary.mode === "index" && destination.primary.headingId !== headingId) {
      destination.primary.headingId = headingId || null;
    }
    this.labeledSelect(
      section,
      "Heading",
      `${ownerKey}-${destination.key}-primary-heading`,
      headingId,
      [
        ...(destination.primary.mode === "library" ? [{ value: "", label: "Unplaced in Library" }] : []),
        ...headings.map((heading) => ({ value: heading.id, label: heading.name })),
      ],
      (value) => {
        destination.primary.headingId = value || null;
        destination.primary.subheadingId = null;
        this.invalidatePrepared();
        this.render();
      },
    );
    const heading = headings.find((item) => item.id === headingId);
    if (!heading || heading.subheadings.length === 0) {
      destination.primary.subheadingId = null;
      return;
    }
    this.labeledSelect(
      section,
      "Subheading",
      `${ownerKey}-${destination.key}-primary-subheading`,
      destination.primary.subheadingId ?? "",
      [
        { value: "", label: "Heading root" },
        ...heading.subheadings.map((item) => ({ value: item.id, label: item.name })),
      ],
      (value) => {
        destination.primary.subheadingId = value || null;
        this.invalidatePrepared();
        this.render();
      },
    );
  }

  private renderCollectionsEditor(
    parent: HTMLElement,
    destination: OrganizerDestinationState,
    base: OrganizerBaseOption | null,
    ownerKey: string,
  ): void {
    const section = parent.createEl("fieldset", { cls: "ent-cc-note-organizer-fieldset" });
    section.createEl("legend", { text: "Collections" });
    this.labeledSelect(
      section,
      "Action",
      `${ownerKey}-${destination.key}-collections-mode`,
      destination.collections.mode,
      [
        { value: "keep", label: "Keep current Collections" },
        { value: "add", label: "Add Collection targets" },
        { value: "replace", label: "Replace Collection targets" },
      ],
      (value) => {
        destination.collections.mode = value as OrganizerCollectionMode;
        if (value === "keep") destination.collections.targets = [];
        destination.collections.clearAllConfirmed = false;
        this.invalidatePrepared();
        this.render();
      },
    );
    if (!base || destination.collections.mode === "keep") return;
    if (destination.collections.mode === "replace") {
      section.createDiv({
        cls: "ent-cc-note-organizer-help",
        text: "Replace with no targets removes all current Collection memberships in this knowledge base.",
      });
      if (destination.collections.targets.length === 0) {
        const confirmation = section.createEl("label", { cls: "ent-cc-note-organizer-clear-confirmation" });
        const checkbox = confirmation.createEl("input", {
          type: "checkbox",
          attr: {
            "aria-label": "Confirm clearing all collection memberships",
            "data-organizer-focus": `clear-collections:${ownerKey}:${destination.key}`,
          },
        });
        checkbox.checked = destination.collections.clearAllConfirmed;
        checkbox.addEventListener("change", () => {
          destination.collections.clearAllConfirmed = checkbox.checked;
          this.invalidatePrepared();
          this.pendingFocusKey = `clear-collections:${ownerKey}:${destination.key}`;
          this.render();
        });
        confirmation.createSpan({ text: "I understand that applying Replace with no targets removes every Collection membership for these notes in this knowledge base." });
      }
    }
    const add = section.createEl("button", {
      cls: "ent-cc-note-organizer-secondary-button",
      text: "Add target",
      attr: { type: "button", "data-organizer-focus": `add-collection:${ownerKey}:${destination.key}` },
    });
    add.disabled = base.collections.length === 0;
    add.addEventListener("click", () => {
      const collection = base.collections[0];
      if (!collection) return;
      destination.collections.targets.push({
        headingId: collection.id,
        subheadingId: null,
      });
      destination.collections.clearAllConfirmed = false;
      this.invalidatePrepared();
      this.pendingFocusKey = `field:${ownerKey}-${destination.key}-collection-${destination.collections.targets.length - 1}`;
      this.render();
    });
    if (base.collections.length === 0) {
      section.createDiv({ cls: "ent-cc-note-organizer-empty", text: "This knowledge base has no Collections." });
    }
    for (const [index, target] of destination.collections.targets.entries()) {
      const row = section.createDiv({ cls: "ent-cc-note-organizer-collection-target" });
      const collection = base.collections.find((item) => item.id === target.headingId) ?? base.collections[0] ?? null;
      if (collection && target.headingId !== collection.id) target.headingId = collection.id;
      this.labeledSelect(
        row,
        "Collection",
        `${ownerKey}-${destination.key}-collection-${index}`,
        target.headingId,
        base.collections.map((item) => ({ value: item.id, label: item.name })),
        (value) => {
          target.headingId = value;
          target.subheadingId = null;
          this.invalidatePrepared();
          this.render();
        },
      );
      if (collection && collection.subheadings.length > 0) {
        this.labeledSelect(
          row,
          "Subheading",
          `${ownerKey}-${destination.key}-collection-subheading-${index}`,
          target.subheadingId ?? "",
          [
            { value: "", label: "Heading root" },
            ...collection.subheadings.map((item) => ({ value: item.id, label: item.name })),
          ],
          (value) => {
            target.subheadingId = value || null;
            this.invalidatePrepared();
            this.render();
          },
        );
      } else {
        target.subheadingId = null;
      }
      const remove = row.createEl("button", {
        cls: "ent-cc-note-organizer-remove",
        attr: { type: "button", "aria-label": `Remove Collection target ${index + 1}` },
      });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        destination.collections.targets.splice(index, 1);
        if (destination.collections.targets.length === 0) destination.collections.clearAllConfirmed = false;
        this.invalidatePrepared();
        this.pendingFocusKey = `add-collection:${ownerKey}:${destination.key}`;
        this.render();
      });
    }
  }

  private renderReview(parent: HTMLElement): void {
    const intro = parent.createDiv({ cls: "ent-cc-note-organizer-section-heading" });
    intro.createEl("h3", {
      text: "Review exact organization changes",
      attr: { tabindex: "-1", "data-organizer-focus": "stage-heading:review" },
    });
    intro.createEl("p", { text: "This review was prepared against the host’s current knowledge-base state. Apply uses its exact immutable prepared token." });
    const prepared = this.prepared;
    if (!prepared) {
      parent.createDiv({ cls: "ent-cc-note-organizer-error", text: "No prepared review is available. Return to Destinations and prepare it again.", attr: { role: "alert" } });
      return;
    }
    const summary = parent.createDiv({ cls: "ent-cc-note-organizer-review-summary" });
    summary.createEl("strong", { text: `${prepared.summary.noteCount.toLocaleString()} notes · ${prepared.summary.baseCount.toLocaleString()} knowledge bases · ${prepared.summary.changeCount.toLocaleString()} organization changes` });
    summary.createDiv({ text: `${prepared.summary.unchangedCount.toLocaleString()} unchanged · ${prepared.summary.skippedCount.toLocaleString()} skipped` });
    parent.createDiv({
      cls: "ent-cc-note-organizer-zero-impact",
      text: "0 files moved · 0 files renamed · 0 Markdown files rewritten · 0 folder links changed",
      attr: { role: "note" },
    });
    for (const error of prepared.errors) parent.createDiv({ cls: "ent-cc-note-organizer-error", text: error, attr: { role: "alert" } });
    for (const warning of prepared.warnings) parent.createDiv({ cls: "ent-cc-note-organizer-warning", text: warning, attr: { role: "note" } });
    if (!this.preparedUsable && prepared.errors.length === 0) {
      const stale = parent.createDiv({ cls: "ent-cc-note-organizer-warning", attr: { role: "alert" } });
      stale.createSpan({ text: "This prepared review can no longer be applied. Refresh it against current KBCC state." });
      const refresh = stale.createEl("button", {
        cls: "ent-cc-note-organizer-secondary-button",
        text: "Refresh review",
        attr: { type: "button" },
      });
      refresh.disabled = this.busy;
      refresh.addEventListener("click", () => { void this.prepareReview(); });
    }
    const rows = prepared.reviewRows;
    const totalPages = Math.max(1, Math.ceil(rows.length / REVIEW_PAGE_SIZE));
    this.reviewPage = Math.min(this.reviewPage, totalPages - 1);
    const start = this.reviewPage * REVIEW_PAGE_SIZE;
    const visible = rows.slice(start, start + REVIEW_PAGE_SIZE);
    const list = parent.createEl("ol", { cls: "ent-cc-note-organizer-review-list" });
    for (const row of visible) {
      const item = list.createEl("li", { cls: `ent-cc-note-organizer-review-row is-${row.outcome}` });
      const header = item.createDiv({ cls: "ent-cc-note-organizer-review-row-header" });
      const identity = header.createDiv();
      identity.createDiv({ cls: "ent-cc-note-organizer-review-title", text: row.noteTitle, attr: { dir: "auto" } });
      identity.createDiv({ cls: "ent-cc-note-organizer-review-path", text: row.path, attr: { dir: "auto" } });
      header.createSpan({ cls: "ent-cc-note-organizer-review-base", text: row.baseName ?? "No destination", attr: { dir: "auto" } });
      const comparison = item.createDiv({ cls: "ent-cc-note-organizer-comparison" });
      this.renderReviewState(comparison, "Before", row.before);
      comparison.createSpan({ cls: "ent-cc-note-organizer-arrow", text: "→", attr: { "aria-hidden": "true" } });
      this.renderReviewState(comparison, "After", row.after);
      for (const warning of row.warnings ?? []) item.createDiv({ cls: "ent-cc-note-organizer-row-warning", text: warning });
    }
    if (rows.length === 0) parent.createDiv({ cls: "ent-cc-note-organizer-empty", text: "The host prepared no review rows." });
    this.renderPagination(parent, this.reviewPage, rows.length, REVIEW_PAGE_SIZE, (pageIndex) => {
      this.reviewPage = pageIndex;
      this.render();
    }, "review rows");
  }

  private renderReviewState(parent: HTMLElement, label: string, state: OrganizerReviewState): void {
    const block = parent.createDiv({ cls: "ent-cc-note-organizer-review-state" });
    block.createDiv({ cls: "ent-cc-note-organizer-review-state-label", text: label });
    block.createDiv({ text: `Primary: ${state.primary}`, attr: { dir: "auto" } });
    block.createDiv({ text: `Collections: ${state.collections.length > 0 ? state.collections.join("; ") : "None"}`, attr: { dir: "auto" } });
  }

  private renderFooter(parent: HTMLElement): void {
    if (this.discardConfirmationVisible) {
      const noteLabel = this.selectedPaths.size === 1 ? "note" : "notes";
      const confirmation = parent.createDiv({
        cls: "ent-cc-note-organizer-discard-confirmation",
        attr: { role: "alert" },
      });
      confirmation.createDiv({
        text: `Discard this organizer draft with ${this.selectedPaths.size.toLocaleString()} selected ${noteLabel}? No Markdown files will be changed.`,
      });
      const actions = confirmation.createDiv({ cls: "ent-cc-note-organizer-discard-actions" });
      const keep = actions.createEl("button", {
        cls: "ent-cc-note-organizer-secondary-button",
        text: "Keep organizing",
        attr: { type: "button", "data-organizer-focus": "discard-cancel" },
      });
      keep.addEventListener("click", () => {
        this.discardConfirmationVisible = false;
        this.liveMessage = "Organizer draft kept open.";
        this.pendingFocusKey = `stage-heading:${this.stage}`;
        this.render();
      });
      const discard = actions.createEl("button", {
        cls: "ent-cc-note-organizer-primary-button mod-warning",
        text: "Discard and close",
        attr: { type: "button", "data-organizer-focus": "discard-confirm" },
      });
      discard.addEventListener("click", () => {
        this.discardConfirmed = true;
        this.close();
      });
      return;
    }
    const footer = parent.createDiv({ cls: "ent-cc-note-organizer-footer" });
    const cancel = footer.createEl("button", {
      cls: "ent-cc-note-organizer-secondary-button",
      text: "Cancel",
      attr: { type: "button", "data-organizer-focus": "footer-cancel" },
    });
    cancel.disabled = this.busy;
    cancel.addEventListener("click", () => this.close());
    const navigation = footer.createDiv({ cls: "ent-cc-note-organizer-footer-navigation" });
    if (this.stage !== "notes") {
      const back = navigation.createEl("button", {
        cls: "ent-cc-note-organizer-secondary-button",
        text: this.stage === "review" ? "Back to destinations" : "Back to notes",
        attr: { type: "button", "data-organizer-focus": "footer-back" },
      });
      back.disabled = this.busy;
      back.addEventListener("click", () => {
        this.stage = this.stage === "review" ? "destinations" : "notes";
        this.actionError = "";
        this.pendingFocusKey = `stage-heading:${this.stage}`;
        this.render();
      });
    }
    if (this.stage === "notes") {
      const next = navigation.createEl("button", {
        cls: "ent-cc-note-organizer-primary-button",
        text: "Choose destinations",
        attr: { type: "button", "data-organizer-focus": "footer-next" },
      });
      next.disabled = this.loading || this.busy || this.selectedPaths.size === 0;
      next.addEventListener("click", () => {
        this.stage = "destinations";
        this.actionError = "";
        this.pendingFocusKey = "stage-heading:destinations";
        this.render();
      });
    } else if (this.stage === "destinations") {
      const review = navigation.createEl("button", {
        cls: "ent-cc-note-organizer-primary-button",
        text: "Prepare review",
        attr: { type: "button", "data-organizer-focus": "footer-prepare" },
      });
      review.disabled = this.busy
        || this.selectedPaths.size === 0
        || this.bases.length === 0
        || this.host.isReadOnly?.() === true;
      review.addEventListener("click", () => { void this.prepareReview(); });
    } else {
      const apply = navigation.createEl("button", {
        cls: "ent-cc-note-organizer-primary-button",
        text: this.busy ? "Applying…" : "Apply organization",
        attr: { type: "button", "data-organizer-focus": "footer-apply" },
      });
      apply.disabled = this.busy
        || !this.prepared
        || !this.preparedUsable
        || this.prepared.errors.length > 0
        || this.host.isReadOnly?.() === true;
      apply.addEventListener("click", () => { void this.applyPrepared(); });
    }
    if (this.busy) navigation.createDiv({ cls: "ent-cc-note-organizer-working", text: "Creating or applying a restart-safe KBCC transaction…", attr: { role: "status" } });
  }

  private async prepareReview(): Promise<void> {
    if (this.busy) return;
    const draft = snapshotNoteOrganizerDraft(this.source, this.selectedPaths, this.destinations, this.overrides);
    const localErrors = validateNoteOrganizerDraft(draft, this.bases);
    if (localErrors.length > 0) {
      this.actionError = localErrors.join(" ");
      this.liveMessage = "The organizer needs more destination details before review.";
      this.pendingFocusKey = "action-error";
      this.render();
      return;
    }
    this.busy = true;
    this.actionError = "";
    this.liveMessage = "Preparing exact before and after changes.";
    this.pendingFocusKey = "stage-heading:destinations";
    this.render();
    try {
      const prepared = await this.host.prepare(draft);
      if (!this.modalOpen) return;
      this.prepared = prepared;
      this.preparedUsable = prepared.errors.length === 0;
      this.reviewPage = 0;
      this.stage = "review";
      this.pendingFocusKey = "stage-heading:review";
      this.liveMessage = prepared.errors.length > 0
        ? `Review prepared with ${prepared.errors.length.toLocaleString()} blocking errors.`
        : `Review prepared with ${prepared.summary.changeCount.toLocaleString()} organization changes.`;
    } catch (error) {
      if (!this.modalOpen) return;
      this.actionError = `Could not prepare the review: ${errorText(error)}`;
      this.liveMessage = this.actionError;
      this.pendingFocusKey = "action-error";
    } finally {
      this.busy = false;
      if (this.modalOpen) this.render();
    }
  }

  private async applyPrepared(): Promise<void> {
    const prepared = this.prepared;
    if (this.busy || !prepared || !this.preparedUsable || prepared.errors.length > 0) return;
    if (this.host.isReadOnly?.() === true) {
      this.actionError = "KBCC is read-only. Resolve the current data or Sync condition before applying this review.";
      this.pendingFocusKey = "action-error";
      this.render();
      return;
    }
    this.busy = true;
    this.actionError = "";
    this.liveMessage = "Applying the exact prepared organization transaction.";
    this.pendingFocusKey = "stage-heading:review";
    this.render();
    try {
      // Pass the exact opaque value back; never clone or derive a replacement.
      const result = await this.host.applyPrepared(prepared.preparedToken);
      if (!this.modalOpen) return;
      this.liveMessage = result.message ?? `${result.changedNotes.toLocaleString()} notes organized across ${result.changedBases.toLocaleString()} knowledge bases.`;
      try {
        this.onApplied?.(result);
      } catch (error) {
        // The host transaction has committed. A presentation callback must
        // never turn that success into a false “Nothing was applied” retry.
        console.error("Knowledge Base Command Center could not finish presenting the note organizer result", error);
      }
      new Notice(this.liveMessage);
      this.closingAfterApply = true;
      this.close();
    } catch (error) {
      if (!this.modalOpen) return;
      this.preparedUsable = false;
      this.actionError = `Nothing was applied: ${errorText(error)} Refresh the review before trying again.`;
      this.liveMessage = this.actionError;
      this.stage = "review";
      this.pendingFocusKey = "action-error";
    } finally {
      this.busy = false;
      if (this.modalOpen && !this.closingAfterApply) this.render();
    }
  }

  private invalidatePrepared(): void {
    this.prepared = null;
    this.preparedUsable = false;
    this.actionError = "";
  }

  private noteName(path: string): string {
    const parts = path.split("/");
    const name = parts[parts.length - 1] ?? path;
    return name.replace(/\.md$/iu, "") || path;
  }

  private selectControl(
    parent: HTMLElement,
    label: string,
    value: string,
    options: readonly { value: string; label: string }[],
    onChange: (value: string) => void,
    requestedFocusKey?: string,
  ): HTMLSelectElement {
    const select = parent.createEl("select", { attr: { "aria-label": label, dir: "auto" } });
    const focusKey = requestedFocusKey ?? `select:${label}`;
    select.setAttribute("data-organizer-focus", focusKey);
    for (const option of options) {
      select.createEl("option", { text: option.label, attr: { value: option.value, dir: "auto" } });
    }
    select.value = value;
    select.disabled = this.busy;
    select.addEventListener("change", () => {
      this.pendingFocusKey = select.getAttribute("data-organizer-focus") ?? focusKey;
      onChange(select.value);
    });
    return select;
  }

  private labeledSelect(
    parent: HTMLElement,
    label: string,
    idSuffix: string,
    value: string,
    options: readonly { value: string; label: string }[],
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const wrapper = parent.createEl("label", { cls: "ent-cc-note-organizer-field" });
    const id = `${this.instanceId}-${idSuffix.replace(/[^a-z0-9_-]/giu, "-")}`;
    wrapper.createSpan({ text: label, attr: { id: `${id}-label` } });
    const select = this.selectControl(wrapper, label, value, options, onChange, `field:${idSuffix}`);
    select.setAttribute("id", id);
    select.setAttribute("aria-labelledby", `${id}-label`);
    select.setAttribute("data-organizer-focus", `field:${idSuffix}`);
    return select;
  }

  private restorePendingFocus(): void {
    const key = this.pendingFocusKey;
    this.pendingFocusKey = null;
    if (!key) return;
    const controls = Array.from(this.contentEl.querySelectorAll<HTMLElement>("[data-organizer-focus]"));
    const target = controls.find((element) => element.getAttribute("data-organizer-focus") === key);
    if (!target) return;
    if (target.getAttribute("role") === "treeitem") {
      const treeItems = this.contentEl.querySelectorAll<HTMLElement>("[role=\"treeitem\"]");
      for (const item of treeItems) item.setAttribute("tabindex", item === target ? "0" : "-1");
    }
    target.focus({ preventScroll: true });
  }

  private renderPagination(
    parent: HTMLElement,
    pageIndex: number,
    total: number,
    pageSize: number,
    onPage: (pageIndex: number) => void,
    label: string,
  ): void {
    if (total <= pageSize) return;
    const first = pageIndex * pageSize + 1;
    const last = Math.min(total, first + pageSize - 1);
    const omitted = total - (last - first + 1);
    const controls = parent.createDiv({ cls: "ent-cc-note-organizer-pagination", attr: { "aria-label": `${label} pages` } });
    const previous = controls.createEl("button", {
      cls: "ent-cc-note-organizer-secondary-button",
      text: "Previous",
      attr: { type: "button", "data-organizer-focus": `pagination:${label}:previous` },
    });
    previous.disabled = pageIndex === 0 || this.busy;
    previous.addEventListener("click", () => {
      this.pendingFocusKey = `pagination:${label}:status`;
      onPage(pageIndex - 1);
    });
    controls.createDiv({
      cls: "ent-cc-note-organizer-page-status",
      text: `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}; ${omitted.toLocaleString()} omitted from this page`,
      attr: {
        role: "status",
        tabindex: "-1",
        "aria-live": "polite",
        "data-organizer-focus": `pagination:${label}:status`,
      },
    });
    const next = controls.createEl("button", {
      cls: "ent-cc-note-organizer-secondary-button",
      text: "Next",
      attr: { type: "button", "data-organizer-focus": `pagination:${label}:next` },
    });
    next.disabled = last >= total || this.busy;
    next.addEventListener("click", () => {
      this.pendingFocusKey = `pagination:${label}:status`;
      onPage(pageIndex + 1);
    });
  }

  private renderLiveRegion(): void {
    if (this.liveRegionEl && this.liveRegionEl.textContent !== this.liveMessage) {
      this.liveRegionEl.setText(this.liveMessage);
    }
  }
}
