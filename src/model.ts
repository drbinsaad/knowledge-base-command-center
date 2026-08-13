import {
  cleanFollowUpCategoryDefinitions,
  DEFAULT_FOLLOW_UP_CATEGORIES,
  MAX_FOLLOW_UP_CATEGORIES,
  type FollowUpCategoryDefinition,
} from "./follow-up";

export const TOPIC_ROOT = "03 Clinical Topics/";
export const PROCEDURE_ROOT = "04 Procedures/";
export const MEDICATION_ROOT = "06 Clinical Tools/Medications/";
export const SYNDROME_ROOT = "06 Clinical Tools/Syndromes/";
export const DEFAULT_PROPOSAL_FOLDER = "01 Inbox/ENT Topic Proposals";
export const DATA_VERSION = 14;
export const STORE_VERSION = 15;
export const MIN_RECOGNIZED_STORE_VERSION = 11;
export const STORE_KIND = "knowledge-base-command-center-store";
export const MAX_KNOWLEDGE_BASES = 50;
export const MAX_LIBRARIES = 50;
/** Recent semantic heads retained to prove causal descent without unbounded store growth. */
export const MAX_SEMANTIC_LINEAGE = 64;
/** Device-local routes, disclosure state, and bounded history must fit comfortably in localStorage. */
export const MAX_DEVICE_LOCAL_STATE_BYTES = 4 * 1024 * 1024;
export const DEVICE_LOCAL_STATE_VERSION = 2;
/** Permanent base-deletion tombstones are small, but remain bounded and are never silently evicted. */
export const MAX_DELETED_KNOWLEDGE_BASE_IDS = 10_000;
export const DEFAULT_KNOWLEDGE_BASE_ID = "base-default";
export const PORTABLE_PLACEHOLDER_PREFIX = "kbcc-placeholder:";
export const DEFAULT_COLLAPSED_QUEUES = [
  "p1",
  "gaps",
  "procedure-review",
  "medication-dose-absent",
  "medication-source-traced",
  "medication-source-gaps",
  "syndrome-image-gaps",
  "syndrome-source-gaps",
] as const;
export const MAX_UNDO_BYTES = 512 * 1024;
/** Large component imports may need one bounded, full portable-state Undo. */
export const MAX_PORTABLE_UNDO_BYTES = 12 * 1024 * 1024;
/** Imported JSON may be byte-small but contain millions of tiny list entries. */
export const MAX_TRANSFER_LIST_ITEMS = 50_000;
export const MAX_TRANSFER_TOTAL_REFERENCES = 250_000;
export const MAX_TRANSFER_COLLECTIONS = 10_000;
export const MAX_TRANSFER_SNAPSHOTS = 10;
/** Any individual persisted label, path, query, or other consumed text value. */
export const MAX_TRANSFER_TEXT_LENGTH = 10_000;
/** Aggregate raw UTF-8 text bytes per store envelope or retained history candidate. */
export const MAX_TRANSFER_TOTAL_TEXT_LENGTH = 64 * 1024 * 1024;
/** Per retained legacy backup; a store keeps at most one v1 and one v2 payload. */
export const MAX_MIGRATION_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_MIGRATION_BACKUP_DEPTH = 16;
const MAX_MIGRATION_BACKUP_NODES = MAX_TRANSFER_TOTAL_REFERENCES;

export type RecordKind = "topic" | "procedure" | "medication" | "syndrome" | "proposal" | "note";
export const LIBRARY_KINDS = ["procedure", "medication", "syndrome"] as const;
export type LibraryKind = typeof LIBRARY_KINDS[number];
export const BUILTIN_LIBRARY_IDS: Readonly<Record<LibraryKind, LibraryKind>> = {
  procedure: "procedure",
  medication: "medication",
  syndrome: "syndrome",
};
export interface LibraryDefinition {
  id: string;
  name: string;
  singularName: string;
  icon: string;
  order: number;
  sourceKind: LibraryKind | null;
  archivedAt: number | null;
}
export const BUILTIN_LIBRARY_DEFINITIONS: readonly LibraryDefinition[] = [
  { id: "procedure", name: "Procedures", singularName: "Procedure", icon: "clipboard-list", order: 0, sourceKind: "procedure", archivedAt: null },
  { id: "medication", name: "Medications", singularName: "Medication", icon: "pill", order: 1, sourceKind: "medication", archivedAt: null },
  { id: "syndrome", name: "Syndromes", singularName: "Syndrome", icon: "dna", order: 2, sourceKind: "syndrome", archivedAt: null },
];
export type LibraryLayouts = Record<string, LayoutHeading[]>;
export type RecordRole = "canonical" | "supporting" | "library" | "proposal" | "vault-note" | "placeholder";
export type CoreTab = "curriculum" | "inbox" | "collections" | "queues";
export type LibraryTab = `library:${string}`;
export type MainTab = CoreTab | LibraryTab;
export type OpenNoteBehavior = "new-tab" | "same-tab" | "split";
export type WorkspaceMode = "generic" | "ent-clinical";
export type NewNoteMode = "empty" | "template";
export type AttachmentStorageMode = "obsidian" | "fixed-folder" | "note-subfolder" | "ask";
export type AttachmentInsertionMode = "cursor" | "marker" | "heading" | "end";

/** Optional per-Library creation defaults. Missing fields inherit the active base defaults. */
export interface LibraryNoteProfile {
  folder?: string;
  mode?: NewNoteMode;
  templatePath?: string;
}

export type LibraryNoteProfiles = Record<string, LibraryNoteProfile>;

export interface EffectiveLibraryNoteProfile {
  folder: string;
  mode: NewNoteMode;
  templatePath: string;
  inherited: {
    folder: boolean;
    mode: boolean;
    templatePath: boolean;
  };
}

/** Extra values available only through explicit YAML-quoted template tokens. */
export interface TemplateTokenContext {
  title?: string;
  id?: string;
  category?: string;
  parent?: string;
  library?: string;
  type?: string;
}

export interface DomainDefinition {
  name: string;
  folder: string;
  code: string;
}

export const DOMAIN_DEFINITIONS: DomainDefinition[] = [
  { name: "Pediatric", folder: "01 Pediatric", code: "PED" },
  { name: "Otology", folder: "02 Otology", code: "OTO" },
  { name: "Laryngology", folder: "03 Laryngology", code: "LAR" },
  { name: "Head and Neck", folder: "04 Head and Neck", code: "HN" },
  { name: "General", folder: "05 General", code: "GEN" },
  { name: "Basic Sciences", folder: "06 Basic Sciences", code: "SCI" },
  { name: "Rhinology", folder: "07 Rhinology", code: "RHI" },
  { name: "Trauma", folder: "08 Trauma", code: "TRA" },
];

export const TOPIC_KINDS = [
  "condition",
  "intervention",
  "clinical-approach",
  "clinical-presentation",
  "diagnostic-test",
  "foundational-science",
] as const;

export interface VaultRecord {
  path: string;
  title: string;
  /** Original note/frontmatter title when this base applies a display-only alias. */
  sourceTitle?: string;
  kind: RecordKind;
  role: RecordRole;
  curriculumId: string;
  domain: string;
  topicKind: string;
  priority: string;
  reviewStatus: string;
  synthesisStatus: string;
  autoresearchStatus: string;
  safetyCritical: boolean;
  sourceCount: number;
  aliases: string[];
  relatedTopics: string[];
  parentTopic: string;
  imageStatus: string;
  doseStatus: string;
  sourceCoverage: string;
  folderOrder: string;
  mtime: number;
  aiLock: boolean;
  /** Stable portable identity, when this record participates in an export blueprint. */
  portableId?: string;
  /** True only for a portable subject that is not currently linked to a Markdown file. */
  isPlaceholder?: boolean;
  /** Effective index membership for an unresolved portable subject. */
  portableIndexed?: boolean;
  /** Stable visual library identity, independent of the record's semantic kind. */
  libraryId?: string;
  /** True only when a note was explicitly linked from a portable placeholder. */
  portableRelinkable?: boolean;
}

/**
 * One defensive boundary for effective Index membership. Source semantics and
 * visual placement are deliberately independent: a native topic remains a
 * topic while Hidden or parked in a Library, but neither state belongs to the
 * Index. Conversely, stale portable data cannot force a non-topic source into
 * the Index merely by setting `portableIndexed: true`.
 */
export function recordBelongsToIndex(
  record: Pick<VaultRecord, "kind" | "role" | "libraryId" | "portableIndexed">,
  topicsOnly = false,
): boolean {
  if (record.libraryId || record.portableIndexed === false) return false;
  if (record.portableIndexed === true) return !topicsOnly || record.kind === "topic";
  return record.kind === "topic"
    && (record.role === "canonical" || record.role === "supporting" || record.role === "placeholder");
}

export interface PortableGroupDefinition {
  id: string;
  title: string;
  order: number;
}

export interface PortableSubjectDefinition {
  id: string;
  title: string;
  groupId: string;
  parentId: string | null;
  order: number;
  indexed: boolean;
  configuredId: string;
  recordKind: RecordKind;
  /** Undefined is accepted only while migrating v2 data; null means deliberately unassigned. */
  libraryId?: string | null;
}

/**
 * Portable identities and local bindings. `resolvedPathBySubjectId` is private
 * vault state and is deliberately omitted by the portable export serializer.
 */
export interface PortableIndexLocalState {
  version: 3;
  groups: PortableGroupDefinition[];
  subjects: PortableSubjectDefinition[];
  resolvedPathBySubjectId: Record<string, string>;
  /** Local-only identities whose bindings were explicitly completed from placeholders. */
  relinkableSubjectIds?: string[];
  /** Ordered, base-local top-level libraries. Names never act as identities. */
  libraries: LibraryDefinition[];
  /** Visual-only, path-free organization. Subjects are stable portable subject IDs. */
  libraryLayouts: LibraryLayouts;
}

export interface TopicFormValue {
  title: string;
  domain: string;
  parentPath: string;
  topicKind: string;
  priority: string;
  safetyCritical: boolean;
  curriculumId: string;
  addToCollection: boolean;
}

export interface GenericNoteFormValue {
  title: string;
  folder: string;
  mode: NewNoteMode;
  templatePath: string;
  addToCollection: boolean;
}

export interface CanonicalTopicData extends Omit<TopicFormValue, "parentPath" | "addToCollection"> {
  parentTopic: string;
}

/**
 * Total layout levels including the top-level heading, so a heading may carry
 * up to four nested subheading levels. This is a schema boundary, not a
 * rendering hint: cleaners merge deeper subjects into their nearest allowed
 * ancestor instead of dropping content.
 */
export const MAX_LAYOUT_DEPTH = 5;

export interface LayoutSubheading {
  id: string;
  title: string;
  collapsed: boolean;
  subjects: string[];
  /**
   * Optional so pre-nesting object literals keep compiling. Canonical cleaned
   * data carries this key exactly when children exist: leaf subheadings omit
   * it so flat layouts stay byte-identical across clean/export round-trips.
   * Read through childSubheadings() instead of touching the field directly.
   */
  subheadings?: LayoutSubheading[];
}

export interface LayoutHeading {
  id: string;
  title: string;
  collapsed: boolean;
  subjects: string[];
  subheadings: LayoutSubheading[];
}

/** Nested children of any layout node; absent arrays read as empty. */
export function childSubheadings(node: Pick<LayoutSubheading, "subheadings">): LayoutSubheading[] {
  return node.subheadings ?? [];
}

/** A visual-only curriculum overlay. It never changes note paths or frontmatter. */
export interface CurriculumVisualState {
  parentByPath: Record<string, string | null>;
  orderByContainer: Record<string, string[]>;
}

export interface CurriculumTreeNode {
  record: VaultRecord;
  children: CurriculumTreeNode[];
}

export interface CurriculumDomainTree {
  domain: string;
  folderOrder: string;
  roots: CurriculumTreeNode[];
}

export interface CurriculumTreeResult {
  domains: CurriculumDomainTree[];
  parentByPath: Map<string, string | null>;
  /** Child order per parent path, built once so moves never rescan the tree. */
  childrenByPath: Map<string, string[]>;
  nodeByPath: Map<string, CurriculumTreeNode>;
  /** Records re-rooted only because the rendered hierarchy exceeded the safety cap. */
  depthLimitedPaths: string[];
}

export function emptyCurriculumTree(): CurriculumTreeResult {
  return { domains: [], parentByPath: new Map(), childrenByPath: new Map(), nodeByPath: new Map(), depthLimitedPaths: [] };
}

export interface SavedView {
  id: string;
  name: string;
  tab: MainTab;
  query: string;
}

/**
 * Every field of a base's personal organization that undo snapshots, snapshot
 * restores, and same-vault recovery backups must all carry. Adding a field here
 * and to clonePersonalOrganization is the single change required for it to flow
 * into all three; enumerating the list per call site is how a new field
 * silently disappears from undo or from backups.
 */
export interface PersonalOrganizationState {
  collections: LayoutHeading[];
  pinnedPaths: string[];
  nextStudyPaths: string[];
  savedViews: SavedView[];
  curriculumVisual: CurriculumVisualState;
  manualIndexPaths: string[];
  excludedIndexPaths: string[];
  indexGroupByPath: Record<string, string>;
  /** Base-local display titles. Keys may be note paths or portable placeholder IDs. */
  displayNameByPath: Record<string, string>;
  /** Visual aliases for configured/folder-derived group names. */
  indexGroupAliases: Record<string, string>;
  indexGroupOrder: string[];
}

/** The field names of PersonalOrganizationState, in clone order. */
export const PERSONAL_ORGANIZATION_FIELDS: ReadonlyArray<keyof PersonalOrganizationState> = [
  "collections",
  "pinnedPaths",
  "nextStudyPaths",
  "savedViews",
  "curriculumVisual",
  "manualIndexPaths",
  "excludedIndexPaths",
  "indexGroupByPath",
  "displayNameByPath",
  "indexGroupAliases",
  "indexGroupOrder",
];

export interface PersonalSnapshot extends PersonalOrganizationState {
  label: string;
  at: number;
  /** Included only when the operation can change the selected workspace tab. */
  activeTab?: MainTab;
  /** Included only when the operation can change portable identity state. */
  portableIndex?: PortableIndexLocalState;
  /** Present only for a component-aware import snapshot. */
  settings?: PluginSettings;
  /** Included only when same-vault recovery can replace named snapshots. */
  layoutSnapshots?: PersonalSnapshot[];
}

export interface ViewCollapseState {
  curriculumDomains: string[];
  curriculumNodes: string[];
  queues: string[];
}

export interface PluginSettings {
  setupComplete: boolean;
  workspaceMode: WorkspaceMode;
  workspaceName: string;
  workspaceSubtitle: string;
  indexLabel: string;
  itemSingular: string;
  itemPlural: string;
  groupLabel: string;
  primaryFolder: string;
  inboxLabel: string;
  idProperty: string;
  groupProperty: string;
  parentProperty: string;
  templatesFolder: string;
  defaultNoteFolder: string;
  defaultNewNoteMode: NewNoteMode;
  defaultTemplatePath: string;
  /** Stable Library IDs map to optional overrides; absent fields inherit base defaults. */
  libraryNoteProfiles: LibraryNoteProfiles;
  attachmentStorageMode: AttachmentStorageMode;
  attachmentFolder: string;
  attachmentInsertionMode: AttachmentInsertionMode;
  attachmentMarker: string;
  attachmentHeading: string;
  defaultTab: MainTab;
  recentLimit: number;
  enableHoverPreview: boolean;
  showSafetyBadges: boolean;
  proposalFolder: string;
  enableAdvancedCanonicalActions: boolean;
  openNoteBehavior: OpenNoteBehavior;
  allowClinicalVisualGroupMoves: boolean;
  followUpCategories: FollowUpCategoryDefinition[];
}

export interface MigrationBackup {
  version: 1;
  headings: unknown[];
  migratedAt: number;
}

export interface V2MigrationBackup {
  version: 2;
  migratedAt: number;
  collections: LayoutHeading[];
  pinnedPaths: string[];
  nextStudyPaths: string[];
  savedViews: SavedView[];
  settings: Record<string, unknown>;
}

export interface PluginData {
  version: typeof DATA_VERSION;
  collections: LayoutHeading[];
  pinnedPaths: string[];
  nextStudyPaths: string[];
  savedViews: SavedView[];
  curriculumVisual: CurriculumVisualState;
  manualIndexPaths: string[];
  excludedIndexPaths: string[];
  indexGroupByPath: Record<string, string>;
  displayNameByPath: Record<string, string>;
  indexGroupAliases: Record<string, string>;
  indexGroupOrder: string[];
  portableIndex: PortableIndexLocalState;
  selectedPath: string;
  activeTab: MainTab;
  settings: PluginSettings;
  layoutSnapshots: PersonalSnapshot[];
  undoStack: PersonalSnapshot[];
  redoStack: PersonalSnapshot[];
  collapsed: ViewCollapseState;
  migrationBackup?: MigrationBackup;
  v2MigrationBackup?: V2MigrationBackup;
}

export interface KnowledgeBaseEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Monotonic per-base revision for semantic organization changes only. */
  semanticRevision: number;
  /** Stable identity of the semantic save event represented by this entry. */
  semanticHead: string;
  /** Fingerprint of the semantic payload represented by semanticHead. */
  semanticHash: string;
  /**
   * Newest-first fingerprints of semantic ancestors. A larger scalar revision
   * is never treated as causal proof without one of these fingerprints.
   */
  semanticLineage: string[];
  archivedAt: number | null;
  /** Existing v12 workspace payload, deliberately kept intact per base. */
  data: PluginData;
}

export interface PluginStore {
  kind: typeof STORE_KIND;
  version: typeof STORE_VERSION;
  /** Stable per-vault identity used to reject cross-vault recovery restores. */
  vaultId: string;
  activeBaseId: string;
  bases: KnowledgeBaseEntry[];
  /** Stable IDs permanently removed from this vault. Tombstones prevent Sync from resurrecting them. */
  deletedBaseIds: Record<string, number>;
}

export interface DeviceLocalKnowledgeBaseState {
  baseId: string;
  view: PluginViewState;
}

/** Stored through App.saveLocalStorage, never through plugin data.json. */
export interface DeviceLocalPluginState {
  version: typeof DEVICE_LOCAL_STATE_VERSION;
  /** Prevents a retained App-local payload from attaching to a reinstalled or different vault store. */
  vaultId: string;
  activeBaseId: string;
  bases: DeviceLocalKnowledgeBaseState[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  setupComplete: false,
  workspaceMode: "generic",
  workspaceName: "Knowledge Base Command Center",
  workspaceSubtitle: "Search, organize, arrange, and create notes without moving source files.",
  indexLabel: "Knowledge Index",
  itemSingular: "note",
  itemPlural: "notes",
  groupLabel: "Group",
  primaryFolder: "Knowledge Base",
  inboxLabel: "Inbox",
  idProperty: "id",
  groupProperty: "category",
  parentProperty: "parent",
  templatesFolder: "Templates",
  defaultNoteFolder: "Knowledge Base",
  defaultNewNoteMode: "empty",
  defaultTemplatePath: "",
  libraryNoteProfiles: {},
  attachmentStorageMode: "obsidian",
  attachmentFolder: "Attachments",
  attachmentInsertionMode: "cursor",
  attachmentMarker: "<!-- kbcc:attachments -->",
  attachmentHeading: "Attachments",
  defaultTab: "curriculum",
  recentLimit: 25,
  enableHoverPreview: true,
  showSafetyBadges: true,
  proposalFolder: "Inbox",
  enableAdvancedCanonicalActions: false,
  openNoteBehavior: "new-tab",
  allowClinicalVisualGroupMoves: false,
  followUpCategories: DEFAULT_FOLLOW_UP_CATEGORIES.map((category) => ({ ...category })),
};

export const ENT_CLINICAL_SETTINGS: PluginSettings = {
  ...DEFAULT_SETTINGS,
  followUpCategories: DEFAULT_FOLLOW_UP_CATEGORIES.map((category) => ({ ...category })),
  setupComplete: true,
  workspaceMode: "ent-clinical",
  workspaceName: "ENT Vault Command Center",
  workspaceSubtitle: "Canonical knowledge, personal study organization, and review queues — without moving source notes.",
  indexLabel: "Curriculum",
  itemSingular: "topic",
  itemPlural: "topics",
  groupLabel: "ENT domain",
  primaryFolder: "03 Clinical Topics",
  inboxLabel: "Topic Inbox",
  idProperty: "curriculum_id",
  groupProperty: "domain",
  parentProperty: "parent_topic",
  templatesFolder: "90 Templates",
  defaultNoteFolder: "01 Inbox",
  defaultNewNoteMode: "empty",
  defaultTemplatePath: "",
  libraryNoteProfiles: {},
  proposalFolder: DEFAULT_PROPOSAL_FOLDER,
};

export const DEFAULT_DATA: PluginData = {
  version: DATA_VERSION,
  collections: [],
  pinnedPaths: [],
  nextStudyPaths: [],
  savedViews: [],
  curriculumVisual: { parentByPath: {}, orderByContainer: {} },
  manualIndexPaths: [],
  excludedIndexPaths: [],
  indexGroupByPath: {},
  displayNameByPath: {},
  indexGroupAliases: {},
  indexGroupOrder: [],
  portableIndex: {
    version: 3,
    groups: [],
    subjects: [],
    resolvedPathBySubjectId: {},
    relinkableSubjectIds: [],
    libraries: [],
    libraryLayouts: {},
  },
  selectedPath: "",
  activeTab: "curriculum",
  settings: {
    ...DEFAULT_SETTINGS,
    followUpCategories: DEFAULT_FOLLOW_UP_CATEGORIES.map((category) => ({ ...category })),
    libraryNoteProfiles: {},
  },
  layoutSnapshots: [],
  undoStack: [],
  redoStack: [],
  collapsed: {
    curriculumDomains: [],
    curriculumNodes: [],
    queues: [...DEFAULT_COLLAPSED_QUEUES],
  },
};

interface CollapsedLayoutItemState {
  id: string;
  collapsed: boolean;
  subheadings: CollapsedLayoutItemState[];
}

interface CollapsedLibraryLayoutState {
  libraryId: string;
  headings: CollapsedLayoutItemState[];
}

/**
 * Per-device state that may be persisted without advancing semantic conflict
 * resolution. Keep this list explicit: adding a field here changes what the
 * safe view-state save path is allowed to copy from live mutable data.
 */
export interface PluginViewState {
  selectedPath: string;
  activeTab: MainTab;
  collapsed: ViewCollapseState;
  collections: CollapsedLayoutItemState[];
  libraryLayouts: CollapsedLibraryLayoutState[];
  undoStack: PersonalSnapshot[];
  redoStack: PersonalSnapshot[];
}

function captureCollapsedLayoutNode(node: LayoutHeading | LayoutSubheading): CollapsedLayoutItemState {
  return {
    id: node.id,
    collapsed: node.collapsed,
    subheadings: childSubheadings(node).map(captureCollapsedLayoutNode),
  };
}

function captureCollapsedLayout(layout: readonly LayoutHeading[]): CollapsedLayoutItemState[] {
  return layout.map(captureCollapsedLayoutNode);
}

/**
 * Overlay collapse state by stable ID per level. Nodes without a stored match
 * (including any structure introduced by the semantic winner) start expanded.
 */
function applyCollapsedLayoutNodes(
  nodes: readonly (LayoutHeading | LayoutSubheading)[],
  state: readonly CollapsedLayoutItemState[],
): void {
  const stateById = new Map(state.map((item) => [item.id, item]));
  for (const node of nodes) {
    const prior = stateById.get(node.id);
    node.collapsed = prior?.collapsed ?? false;
    applyCollapsedLayoutNodes(childSubheadings(node), prior?.subheadings ?? []);
  }
}

function applyCollapsedLayout(
  layout: LayoutHeading[],
  state: readonly CollapsedLayoutItemState[],
): void {
  applyCollapsedLayoutNodes(layout, state);
}

/** Capture exactly the device-local fields permitted by saveViewState(). */
export function capturePluginViewState(data: PluginData): PluginViewState {
  return {
    selectedPath: data.selectedPath,
    activeTab: data.activeTab,
    collapsed: structuredClone(data.collapsed),
    collections: captureCollapsedLayout(data.collections),
    libraryLayouts: Object.entries(data.portableIndex.libraryLayouts ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([libraryId, headings]) => ({ libraryId, headings: captureCollapsedLayout(headings) })),
    undoStack: structuredClone(data.undoStack),
    redoStack: structuredClone(data.redoStack),
  };
}

/**
 * Overlay local view state by stable layout IDs. Structure introduced by the
 * semantic winner starts expanded instead of inheriting another device's UI.
 */
export function applyPluginViewState(
  data: PluginData,
  state: PluginViewState,
  preserveHistory = true,
): void {
  data.selectedPath = state.selectedPath;
  data.activeTab = state.activeTab;
  data.collapsed = structuredClone(state.collapsed);
  applyCollapsedLayout(data.collections, state.collections);
  const libraryStateById = new Map(state.libraryLayouts.map((library) => [library.libraryId, library.headings]));
  for (const [libraryId, layout] of Object.entries(data.portableIndex.libraryLayouts)) {
    applyCollapsedLayout(layout, libraryStateById.get(libraryId) ?? []);
  }
  data.undoStack = preserveHistory ? structuredClone(state.undoStack) : [];
  data.redoStack = preserveHistory ? structuredClone(state.redoStack) : [];
}

/** Give a base first opened on this device a neutral route and empty history. */
export function resetPluginViewState(data: PluginData): void {
  data.selectedPath = "";
  data.activeTab = data.settings.defaultTab;
  data.collapsed = structuredClone(DEFAULT_DATA.collapsed);
  applyCollapsedLayout(data.collections, []);
  for (const layout of Object.values(data.portableIndex.libraryLayouts ?? {})) applyCollapsedLayout(layout, []);
  data.undoStack = [];
  data.redoStack = [];
}

/**
 * One canonical semantic projection shared by migration identity, merge
 * ordering, conflict detection, and safe-save validation. Named snapshots are
 * intentionally untouched: their collapse fields are user-authored content.
 */
export function semanticPluginDataProjection(data: PluginData): PluginData {
  const projected = structuredClone(data);
  projected.selectedPath = "";
  projected.activeTab = "curriculum";
  projected.collapsed = structuredClone(DEFAULT_DATA.collapsed);
  projected.undoStack = [];
  projected.redoStack = [];
  applyCollapsedLayout(projected.collections, []);
  for (const layout of Object.values(projected.portableIndex.libraryLayouts ?? {})) applyCollapsedLayout(layout, []);
  return projected;
}

/** Stable compact identity for one base's semantic payload. */
export function semanticEntryFingerprint(
  entry: Pick<KnowledgeBaseEntry, "createdAt" | "archivedAt" | "data">,
): string {
  return fingerprintText(JSON.stringify(canonicalJsonValue([
    entry.createdAt,
    entry.archivedAt,
    semanticPluginDataProjection(entry.data),
  ])));
}

/** Allocate a new causal event identity; semantic content alone may repeat after Undo. */
export function nextSemanticHead(parentHead: string, semanticFingerprint: string): string {
  return fingerprintText(`${parentHead}:${semanticFingerprint}:${randomMigrationNonce()}`);
}

/** Deterministic causal identity for a merge-time repair applied on every device. */
export function deterministicSemanticHead(
  parentHead: string,
  semanticFingerprint: string,
  reason: string,
): string {
  return fingerprintText(`deterministic:${reason}:${parentHead}:${semanticFingerprint}`);
}

function isSemanticFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16}$/i.test(value);
}

/**
 * Preserve the newest occurrence of each ancestor and bound the causal proof.
 * Dropped old ancestry can only produce a false conflict, never a false win.
 */
export function boundedSemanticLineage(
  fingerprints: readonly string[],
  currentFingerprint = "",
): string[] {
  const output: string[] = [];
  const used = new Set<string>(currentFingerprint ? [currentFingerprint] : []);
  for (const fingerprint of fingerprints) {
    const normalized = fingerprint.toLowerCase();
    if (!isSemanticFingerprint(normalized) || used.has(normalized)) continue;
    used.add(normalized);
    output.push(normalized);
    if (output.length >= MAX_SEMANTIC_LINEAGE) break;
  }
  return output;
}

export function createDefaultStore(
  data: PluginData = structuredClone(DEFAULT_DATA),
  now = Date.now(),
  vaultId = makeId("vault"),
): PluginStore {
  const entry: KnowledgeBaseEntry = {
    id: DEFAULT_KNOWLEDGE_BASE_ID,
    createdAt: now,
    updatedAt: now,
    semanticRevision: 0,
    semanticHead: "0000000000000000",
    semanticHash: "0000000000000000",
    semanticLineage: [],
    archivedAt: null,
    data,
  };
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = entry.semanticHash;
  return {
    kind: STORE_KIND,
    version: STORE_VERSION,
    vaultId: cleanKnowledgeBaseId(vaultId, "Vault"),
    activeBaseId: DEFAULT_KNOWLEDGE_BASE_ID,
    bases: [entry],
    deletedBaseIds: {},
  };
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The one canonical JSON projection: key-sorted, `undefined`-stripped, and
 * shared by migration-equality writeback checks, sync winner selection, and
 * portfolio plan guards.
 *
 * The accumulator is deliberately a null-prototype object. A plain `{}` routes
 * `output["__proto__"] = value` through Object.prototype's `__proto__` setter,
 * which never creates an own property, so that key vanishes from the serialized
 * form. Independent copies that used `{}` made the same store canonicalize two
 * different ways depending on which module asked.
 */
/**
 * Object.fromEntries is ES2019. This build targets ES2018 for older mobile web
 * views, and esbuild downlevels syntax but never library methods, so the newer
 * call would reach those devices unpolyfilled.
 */
export function objectFromEntries<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  const output: Record<string, T> = {};
  for (const [key, value] of entries) output[key] = value;
  return output;
}

export function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item) ?? null);
  if (!value || typeof value !== "object") return value;
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    const normalized = canonicalJsonValue((value as Record<string, unknown>)[key]);
    if (normalized !== undefined) output[key] = normalized;
  }
  return output;
}

/** Canonical serialized text for any value that is compared or fingerprinted. */
export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

/**
 * Case- and width-insensitive key for user-visible names (knowledge bases,
 * group titles, layout headings). Uniqueness checks that disagree about this
 * key hand out duplicate names, so every module shares this one definition.
 */
export function normalizedNameKey(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

/**
 * User-visible text for a caught value.
 *
 * Every failure this plugin reports — notices, inline modal errors, wrapped
 * rollback sentences — turns a throw into text here, so improving that decision
 * is one edit rather than fifty. A non-Error throw carries no `.message`;
 * callers that have a better sentence than the coerced value pass `fallback`,
 * which keeps that wording at the call site where it is read in context.
 */
export function errorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}

/** Whether a current persisted envelope differs from its safely cleaned form. */
export function pluginStoreNeedsNormalization(input: unknown, normalized: PluginStore): boolean {
  const raw = asUnknownRecord(input);
  // Vault-identity creation/rotation has its own writeback signal in main.ts.
  // Excluding it here keeps this predicate specific to deterministic payload
  // and envelope-structure repair.
  const comparableNormalized = { ...normalized, vaultId: raw.vaultId };
  return JSON.stringify(canonicalJsonValue(input))
    !== JSON.stringify(canonicalJsonValue(comparableNormalized));
}

/**
 * Double FNV-1a over UTF-16 code units, rendered as two 8-hex-digit halves.
 *
 * Outputs are persisted as identity: imported collection and library IDs,
 * portfolio destination base IDs, plan-guard tokens, and recovered legacy IDs
 * in vaults already in the wild. Every consumer must call this exact function —
 * a local copy that later "improves" the mixing silently breaks dedupe against
 * IDs the plugin already wrote. The seeds and output shape are frozen.
 */
export function fingerprintText(text: string): string {
  const hash = (seed: number): string => {
    let value = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return value.toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

function migrationFingerprint(data: PluginData): string {
  const comparable = semanticPluginDataProjection(data);
  const migrationBackup = asUnknownRecord(comparable.migrationBackup);
  const v2MigrationBackup = asUnknownRecord(comparable.v2MigrationBackup);
  if (migrationBackup.version === 1) migrationBackup.migratedAt = 0;
  if (v2MigrationBackup.version === 2) v2MigrationBackup.migratedAt = 0;
  return fingerprintText(JSON.stringify(canonicalJsonValue(comparable)));
}

function randomMigrationNonce(): string {
  const values = new Uint32Array(4);
  if (typeof window !== "undefined" && typeof window.crypto?.getRandomValues === "function") {
    window.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

function freshVaultId(): string {
  return `vault-fresh-${randomMigrationNonce()}`;
}

/** A data-less device keeps this provisional identity until Sync establishes the vault identity. */
export function isFreshVaultId(vaultId: string): boolean {
  return /^vault-fresh-[a-z0-9]{12,64}$/i.test(vaultId.trim());
}

/**
 * Whether a fresh-device store contains only harmless view/bootstrap state.
 * These fields may be saved automatically when the command center first opens;
 * they must not stop an existing identified Sync store from becoming the
 * authority. Settings, organization, histories, and every other field remain
 * significant so actual offline work is never silently discarded.
 */
export function freshStoreHasOnlyBootstrapChanges(store: PluginStore): boolean {
  if (!isFreshVaultId(store.vaultId)
    || store.activeBaseId !== DEFAULT_KNOWLEDGE_BASE_ID
    || store.bases.length !== 1
    || Object.keys(store.deletedBaseIds).length !== 0) return false;
  const entry = store.bases[0];
  if (!entry || entry.id !== DEFAULT_KNOWLEDGE_BASE_ID || entry.archivedAt !== null) return false;
  const comparable = semanticPluginDataProjection(entry.data);
  return JSON.stringify(canonicalJsonValue(comparable))
    === JSON.stringify(canonicalJsonValue(semanticPluginDataProjection(DEFAULT_DATA)));
}

function migratedVaultId(data: PluginData): string {
  return `vault-migrated-${migrationFingerprint(data)}-${randomMigrationNonce()}`;
}

function migratedVaultIdFromLegacyDeterministicId(vaultId: string): string {
  const fingerprint = /^vault-migrated-([0-9a-f]{16})$/i.exec(vaultId.trim())?.[1]?.toLowerCase();
  if (!fingerprint) throw new Error("The legacy migrated-vault identity is invalid.");
  return `vault-migrated-${fingerprint}-${randomMigrationNonce()}`;
}

/** Fingerprint carried only by a random provisional first-upgrade identity. */
export function provisionalMigratedVaultFingerprint(vaultId: string): string | null {
  const match = /^vault-migrated-([0-9a-f]{16})-([a-z0-9]{12,64})$/i.exec(vaultId.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function isLegacyDeterministicMigratedVaultId(vaultId: string): boolean {
  return /^vault-migrated-[0-9a-f]{16}$/i.test(vaultId.trim());
}

type InterimEnvelopeIdentitySource = Pick<PluginStore, "bases" | "deletedBaseIds">;

function interimEnvelopeStringSortedBy(
  store: InterimEnvelopeIdentitySource,
  compareIds: (left: string, right: string) => number,
): string {
  const bases = [...store.bases].sort((left, right) => compareIds(left.id, right.id));
  return JSON.stringify(canonicalJsonValue({
    kind: STORE_KIND,
    version: STORE_VERSION,
    bases: bases.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      semanticRevision: entry.semanticRevision,
      semanticHead: entry.semanticHead,
      semanticHash: entry.semanticHash,
      semanticLineage: entry.semanticLineage,
      archivedAt: entry.archivedAt,
      data: semanticPluginDataProjection(entry.data),
    })),
    deletedBaseIds: store.deletedBaseIds,
  }));
}

/**
 * Stable serialization of the complete multi-base payload that existed when a
 * v11 envelope without `vaultId` was first loaded. Device-local state and the
 * legacy `updatedAt` clock are omitted because older builds advanced that
 * timestamp for view-only saves; semantic revisions, tombstones, and nested
 * semantic payloads remain part of the identity material. Base IDs sort in
 * code-unit order so devices with different system locales derive the same
 * identity material for the same envelope.
 */
export function canonicalInterimEnvelopeString(store: InterimEnvelopeIdentitySource): string {
  return interimEnvelopeStringSortedBy(store, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Builds up to 0.12.0 sorted base IDs with locale-sensitive localeCompare, so
 * an already-shipped vault ID embeds a fingerprint of that ordering under the
 * minting device's own locale. Recomputing it locally reproduces that
 * device's legacy fingerprint, which keeps established identities accepted.
 */
export function legacyLocaleInterimEnvelopeFingerprint(store: InterimEnvelopeIdentitySource): string {
  return fingerprintText(interimEnvelopeStringSortedBy(store, (left, right) => left.localeCompare(right)));
}

function interimEnvelopeFingerprint(store: InterimEnvelopeIdentitySource): string {
  return fingerprintText(canonicalInterimEnvelopeString(store));
}

/** Accept an embedded fingerprint minted under either base-ID ordering. */
function interimEnvelopeFingerprintMatches(store: InterimEnvelopeIdentitySource, fingerprint: string): boolean {
  return interimEnvelopeFingerprint(store) === fingerprint
    || legacyLocaleInterimEnvelopeFingerprint(store) === fingerprint;
}

function migratedVaultIdFromInterimEnvelope(store: InterimEnvelopeIdentitySource): string {
  return `vault-envelope-migrated-${interimEnvelopeFingerprint(store)}-${randomMigrationNonce()}`;
}

/** Fingerprint carried only by a random identity for a v11 envelope that lacked `vaultId`. */
export function provisionalInterimEnvelopeVaultFingerprint(vaultId: string): string | null {
  const match = /^vault-envelope-migrated-([0-9a-f]{16})-([a-z0-9]{12,64})$/i.exec(vaultId.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Returns the embedded fingerprint only while the complete envelope remains
 * byte-equivalent to its canonical first-load state.
 */
export function pristineProvisionalInterimEnvelopeStoreFingerprint(store: PluginStore): string | null {
  const fingerprint = provisionalInterimEnvelopeVaultFingerprint(store.vaultId);
  if (!fingerprint || !interimEnvelopeFingerprintMatches(store, fingerprint)) return null;
  return fingerprint;
}

/**
 * A mismatched provisional identity may converge only before either migrated
 * payload has been edited. Normal vault IDs never use this path.
 */
export function pristineProvisionalMigratedStoreFingerprint(store: PluginStore): string | null {
  const fingerprint = provisionalMigratedVaultFingerprint(store.vaultId)
    ?? (/^vault-migrated-([0-9a-f]{16})$/i.exec(store.vaultId.trim())?.[1]?.toLowerCase() ?? null);
  if (!fingerprint
    || store.activeBaseId !== DEFAULT_KNOWLEDGE_BASE_ID
    || store.bases.length !== 1
    || Object.keys(store.deletedBaseIds).length !== 0) return null;
  const entry = store.bases[0];
  if (!entry
    || entry.id !== DEFAULT_KNOWLEDGE_BASE_ID
    || entry.archivedAt !== null
    || entry.createdAt !== entry.updatedAt
    || migrationFingerprint(entry.data) !== fingerprint) return null;
  return fingerprint;
}

export interface DeterministicRepairRebaseContext {
  /** The safely normalized envelope immediately before deterministic repair. */
  parentStore: PluginStore;
  /** The fixed reason used to derive a causal child for repaired entries. */
  reason?: "clinical-index-remediation";
}

function sameSemanticMetadata(left: KnowledgeBaseEntry, right: KnowledgeBaseEntry): boolean {
  const leftFingerprint = semanticEntryFingerprint(left);
  const rightFingerprint = semanticEntryFingerprint(right);
  return left.semanticHash === leftFingerprint
    && right.semanticHash === rightFingerprint
    && leftFingerprint === rightFingerprint
    && left.semanticRevision === right.semanticRevision
    && left.semanticHead === right.semanticHead
    && left.semanticHash === right.semanticHash
    && JSON.stringify(left.semanticLineage) === JSON.stringify(right.semanticLineage);
}

function isExactDeterministicRepairChild(
  parent: KnowledgeBaseEntry,
  repaired: KnowledgeBaseEntry,
  reason: string,
): boolean {
  if (!Number.isSafeInteger(parent.semanticRevision)
    || parent.semanticRevision < 0
    || parent.semanticRevision >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(repaired.semanticRevision)) return false;
  const semanticHash = semanticEntryFingerprint(repaired);
  const semanticHead = deterministicSemanticHead(parent.semanticHead, semanticHash, reason);
  const semanticLineage = boundedSemanticLineage(
    [parent.semanticHead, ...parent.semanticLineage],
    semanticHead,
  );
  return repaired.semanticRevision === parent.semanticRevision + 1
    && repaired.semanticHash === semanticHash
    && repaired.semanticHead === semanticHead
    && JSON.stringify(repaired.semanticLineage) === JSON.stringify(semanticLineage);
}

function sameMigrationEnvelopeMetadata(
  before: PluginStore,
  after: PluginStore,
  context?: DeterministicRepairRebaseContext,
): boolean {
  const parentStore = context?.parentStore ?? before;
  const beforeIds = before.bases.map((entry) => entry.id).sort();
  const parentIds = parentStore.bases.map((entry) => entry.id).sort();
  const afterIds = after.bases.map((entry) => entry.id).sort();
  const sourceHasCausalMetadata = Number(before.version) >= 14;
  const identitySourceMetadataIsStable = before.bases.every((source) => {
    const parent = parentStore.bases.find((entry) => entry.id === source.id);
    return Boolean(parent
      && source.createdAt === parent.createdAt
      && source.updatedAt === parent.updatedAt
      && source.archivedAt === parent.archivedAt
      && (!sourceHasCausalMetadata || source.semanticRevision === parent.semanticRevision));
  });
  if (parentStore.vaultId !== after.vaultId
    || parentStore.activeBaseId !== after.activeBaseId
    || JSON.stringify(beforeIds) !== JSON.stringify(parentIds)
    || JSON.stringify(beforeIds) !== JSON.stringify(afterIds)
    || !identitySourceMetadataIsStable
    || JSON.stringify(canonicalJsonValue(before.deletedBaseIds))
      !== JSON.stringify(canonicalJsonValue(parentStore.deletedBaseIds))
    || canonicalJsonValue(parentStore.deletedBaseIds) === undefined
    || JSON.stringify(canonicalJsonValue(parentStore.deletedBaseIds))
      !== JSON.stringify(canonicalJsonValue(after.deletedBaseIds))) return false;
  return parentStore.bases.every((parent) => {
    const repaired = after.bases.find((entry) => entry.id === parent.id);
    return Boolean(repaired
      && parent.createdAt === repaired.createdAt
      && parent.updatedAt === repaired.updatedAt
      && parent.archivedAt === repaired.archivedAt
      && (sameSemanticMetadata(parent, repaired)
        || Boolean(context?.reason
          && isExactDeterministicRepairChild(parent, repaired, context.reason))));
  });
}

/**
 * Rebase a still-pristine provisional migration identity after deterministic
 * schema migration or repair changes only knowledge-base payload data. The
 * original random nonce remains intact, so independently upgraded devices stay
 * distinct while carrying the same repaired fingerprint and can converge
 * through Sync.
 *
 * The caller must provide the earliest envelope from before migration/repair.
 * Normal identities, edited provisional stores, and metadata-changing changes
 * are deliberately rejected.
 */
export function rebaseProvisionalVaultIdAfterDeterministicRepair(
  before: PluginStore,
  after: PluginStore,
  context?: DeterministicRepairRebaseContext,
): boolean {
  if (!sameMigrationEnvelopeMetadata(before, after, context)) return false;

  // migrateStore rotates the supported legacy deterministic flat identity to
  // a nonce-bearing provisional ID before callers can apply later structural
  // repairs. Accept only that exact fingerprint-preserving transition; every
  // other identity change remains ineligible for rebasing.
  const legacyFlatMatch = /^vault-migrated-([0-9a-f]{16})$/i.exec(before.vaultId.trim());
  const rotatedFlatMatch = /^vault-migrated-([0-9a-f]{16})-([a-z0-9]{12,64})$/i.exec(after.vaultId.trim());
  const validLegacyRotation = Boolean(legacyFlatMatch
    && rotatedFlatMatch
    && legacyFlatMatch[1]?.toLowerCase() === rotatedFlatMatch[1]?.toLowerCase());
  if (before.vaultId !== after.vaultId && !validLegacyRotation) return false;

  const flatMatch = validLegacyRotation
    ? rotatedFlatMatch
    : /^vault-migrated-([0-9a-f]{16})-([a-z0-9]{12,64})$/i.exec(before.vaultId.trim());
  if (flatMatch && pristineProvisionalMigratedStoreFingerprint(before)) {
    const entry = after.bases[0];
    if (!entry) return false;
    const nextVaultId = `vault-migrated-${migrationFingerprint(entry.data)}-${flatMatch[2]}`;
    if (nextVaultId === after.vaultId) return false;
    after.vaultId = nextVaultId;
    return true;
  }

  const envelopeMatch = /^vault-envelope-migrated-([0-9a-f]{16})-([a-z0-9]{12,64})$/i.exec(before.vaultId.trim());
  if (envelopeMatch && pristineProvisionalInterimEnvelopeStoreFingerprint(before)) {
    // A shipped identity may embed either base-ID ordering, so an identity that
    // still describes the repaired envelope is kept instead of being rotated.
    if (interimEnvelopeFingerprintMatches(after, envelopeMatch[1]?.toLowerCase() ?? "")) return false;
    const nextVaultId = `vault-envelope-migrated-${interimEnvelopeFingerprint(after)}-${envelopeMatch[2]}`;
    if (nextVaultId === after.vaultId) return false;
    after.vaultId = nextVaultId;
    return true;
  }
  return false;
}

export function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** Persisted JSON dictionaries must be ordinary own-property records. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function asUnknownRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeWikiLink(value: string): string {
  const clean = value.trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  return (clean.split("|")[0] ?? clean).replace(/\.md$/, "").trim();
}

export function cleanDomainFolder(path: string): string {
  const folder = path.split("/")[1] ?? "Unassigned";
  return folder.replace(/^\d+\s+/, "").trim() || "Unassigned";
}

export function compareRecords(a: VaultRecord, b: VaultRecord): number {
  return (a.curriculumId || "ZZZ").localeCompare(b.curriculumId || "ZZZ", undefined, { numeric: true })
    || a.title.localeCompare(b.title);
}

function countLayoutNode(node: LayoutHeading | LayoutSubheading): number {
  return node.subjects.length
    + childSubheadings(node).reduce((sum, item) => sum + countLayoutNode(item), 0);
}

export function countHeading(heading: LayoutHeading): number {
  return countLayoutNode(heading);
}

function cloneLayoutSubheading(subheading: LayoutSubheading): LayoutSubheading {
  // Preserve the exact presence/absence of the nested key so clones remain
  // byte-identical to their canonical source across serialization.
  const clone: LayoutSubheading = { ...subheading, subjects: [...subheading.subjects] };
  if (subheading.subheadings) clone.subheadings = subheading.subheadings.map(cloneLayoutSubheading);
  return clone;
}

export function cloneCollections(collections: LayoutHeading[]): LayoutHeading[] {
  return collections.map((heading) => ({
    ...heading,
    subjects: [...heading.subjects],
    subheadings: heading.subheadings.map(cloneLayoutSubheading),
  }));
}

export function isLibraryKind(value: unknown): value is LibraryKind {
  return LIBRARY_KINDS.includes(value as LibraryKind);
}

export function isValidLibraryId(value: unknown): value is string {
  const id = asText(value);
  return Boolean(id
    && id.length <= 128
    && /^[a-z0-9][a-z0-9._:@+-]*$/i.test(id)
    && isSafeObjectKey(id));
}

export function libraryTabId(id: string): LibraryTab {
  if (!isValidLibraryId(id)) throw new Error("The library has an invalid stable ID.");
  return `library:${id}`;
}

export function libraryIdFromTab(tab: unknown): string | null {
  if (typeof tab !== "string" || !tab.startsWith("library:")) return null;
  const id = tab.slice("library:".length);
  return isValidLibraryId(id) ? id : null;
}

function legacyLibraryIdFromTab(tab: unknown): LibraryKind | null {
  if (tab === "procedures") return BUILTIN_LIBRARY_IDS.procedure;
  if (tab === "medications") return BUILTIN_LIBRARY_IDS.medication;
  if (tab === "syndromes") return BUILTIN_LIBRARY_IDS.syndrome;
  return null;
}

function migrateMainTab(tab: unknown, fallback: MainTab): MainTab {
  const legacyId = legacyLibraryIdFromTab(tab);
  if (legacyId) return libraryTabId(legacyId);
  return isMainTab(tab) ? tab : fallback;
}

export function subjectLibraryId(subject: Pick<PortableSubjectDefinition, "indexed" | "libraryId" | "recordKind">): string | null {
  if (subject.indexed) return null;
  if (Object.prototype.hasOwnProperty.call(subject, "libraryId")) {
    return isValidLibraryId(subject.libraryId) ? subject.libraryId : null;
  }
  return isLibraryKind(subject.recordKind) ? BUILTIN_LIBRARY_IDS[subject.recordKind] : null;
}

export function emptyLibraryLayouts(
  values: readonly (string | Pick<LibraryDefinition, "id">)[] = [],
): LibraryLayouts {
  const layouts: LibraryLayouts = {};
  for (const value of values) {
    const id = typeof value === "string" ? value : value.id;
    if (isValidLibraryId(id) && !Object.prototype.hasOwnProperty.call(layouts, id)) layouts[id] = [];
  }
  return layouts;
}

export function cloneLibraryLayouts(layouts: LibraryLayouts | undefined): LibraryLayouts {
  const output: LibraryLayouts = {};
  if (!layouts) return output;
  for (const [id, layout] of Object.entries(layouts)) {
    if (isValidLibraryId(id) && Array.isArray(layout)) output[id] = cloneCollections(layout);
  }
  return output;
}

function clippedLibraryText(input: unknown, fallback: string): string {
  return asText(input, fallback).normalize("NFC").slice(0, 100).trim() || fallback;
}

function builtinLibraryDefinition(kind: LibraryKind): LibraryDefinition {
  return { ...(BUILTIN_LIBRARY_DEFINITIONS.find((definition) => definition.id === BUILTIN_LIBRARY_IDS[kind])
    ?? { id: kind, name: `${kind}s`, singularName: kind, icon: "library", order: 0, sourceKind: kind, archivedAt: null }) };
}

/**
 * Parse stable top-level library identities. Legacy fixed layouts and
 * non-indexed semantic subjects opt the matching built-in library in without
 * making empty generic workspaces acquire clinical tabs.
 */
export function cleanLibraryDefinitions(
  input: unknown,
  legacyLayouts: unknown,
  subjects: PortableSubjectDefinition[],
): LibraryDefinition[] {
  const definitions: LibraryDefinition[] = [];
  const ids = new Set<string>();
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (definitions.length >= MAX_LIBRARIES) break;
      const value = asUnknownRecord(raw);
      const id = asText(value.id);
      if (!isValidLibraryId(id) || ids.has(id)) continue;
      const builtinKind = isLibraryKind(id) ? id : null;
      const sourceKind = builtinKind && BUILTIN_LIBRARY_IDS[builtinKind] === id ? builtinKind : null;
      const builtin = sourceKind ? builtinLibraryDefinition(sourceKind) : null;
      const archivedValue = Number(value.archivedAt);
      definitions.push({
        id,
        name: clippedLibraryText(value.name, builtin?.name ?? "Library"),
        singularName: clippedLibraryText(value.singularName, builtin?.singularName ?? "Item"),
        icon: /^[a-z0-9-]{1,64}$/i.test(asText(value.icon)) ? asText(value.icon) : builtin?.icon ?? "library",
        order: Number.isFinite(Number(value.order)) ? Number(value.order) : definitions.length,
        sourceKind,
        archivedAt: value.archivedAt === null || value.archivedAt === undefined
          ? null
          : Number.isFinite(archivedValue) && archivedValue > 0 ? archivedValue : null,
      });
      ids.add(id);
    }
  }
  const layouts = isPlainRecord(legacyLayouts) ? legacyLayouts : {};
  for (const kind of LIBRARY_KINDS) {
    const id = BUILTIN_LIBRARY_IDS[kind];
    const usedByLayout = Array.isArray(layouts[id]) && layouts[id].length > 0;
    const usedBySubject = subjects.some((subject) => !subject.indexed
      && (subjectLibraryId(subject) === id || (!Object.prototype.hasOwnProperty.call(subject, "libraryId") && subject.recordKind === kind)));
    if ((usedByLayout || usedBySubject) && !ids.has(id) && definitions.length < MAX_LIBRARIES) {
      definitions.push(builtinLibraryDefinition(kind));
      ids.add(id);
    }
  }
  return definitions.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

/** Ensure the ENT preset exposes all three system libraries without touching layouts or Markdown. */
export function ensureSystemLibraries(state: PortableIndexLocalState): void {
  const ids = new Set(state.libraries.map((definition) => definition.id));
  for (const kind of LIBRARY_KINDS) {
    const id = BUILTIN_LIBRARY_IDS[kind];
    if (!ids.has(id)) {
      state.libraries.push(builtinLibraryDefinition(kind));
      ids.add(id);
    }
    state.libraryLayouts[id] ??= [];
  }
  state.libraries.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function deterministicLayoutId(
  preferred: string,
  used: Set<string>,
  reserved: ReadonlySet<string> = used,
  preserveReservedPreferred = true,
): string {
  const base = preferred.trim() || "layout";
  if (!used.has(base) && (preserveReservedPreferred || !reserved.has(base))) {
    used.add(base);
    return base;
  }
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate) || reserved.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function librarySubjectsById(subjects: PortableSubjectDefinition[], libraryId: string): PortableSubjectDefinition[] {
  return subjects
    .filter((subject) => subjectLibraryId(subject) === libraryId)
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

function deriveFlatLibraryLayout(
  libraryId: string,
  groups: PortableGroupDefinition[],
  subjects: PortableSubjectDefinition[],
): LayoutHeading[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const byGroup = new Map<string, PortableSubjectDefinition[]>();
  for (const subject of librarySubjectsById(subjects, libraryId)) {
    const values = byGroup.get(subject.groupId) ?? [];
    values.push(subject);
    byGroup.set(subject.groupId, values);
  }
  return [...byGroup.entries()]
    .sort(([leftId], [rightId]) => {
      const left = groupById.get(leftId);
      const right = groupById.get(rightId);
      return (left?.order ?? Number.MAX_SAFE_INTEGER) - (right?.order ?? Number.MAX_SAFE_INTEGER)
        || (left?.title ?? "Ungrouped").localeCompare(right?.title ?? "Ungrouped")
        || leftId.localeCompare(rightId);
    })
    .map(([groupId, values]) => ({
      id: `library-${libraryId}-${groupId}`,
      title: groupById.get(groupId)?.title || "Ungrouped",
      collapsed: false,
      subjects: values.map((subject) => subject.id),
      subheadings: [],
    }));
}

function cleanLibraryLayoutSubheadings(
  input: unknown,
  depth: number,
  parentId: string,
  structureIds: Set<string>,
  reservedIds: ReadonlySet<string>,
  takeSubjects: (rawSubjects: unknown) => string[],
  parentSubjects: string[],
): LayoutSubheading[] {
  if (!Array.isArray(input)) return [];
  if (depth > MAX_LAYOUT_DEPTH) {
    // takeSubjects already dedupes globally against the allowed catalog.
    mergeTooDeepLayoutSubjects(input, parentSubjects, takeSubjects);
    return [];
  }
  const subheadings: LayoutSubheading[] = [];
  for (const [index, raw] of input.entries()) {
    const value = asUnknownRecord(raw);
    const title = asText(value.title);
    if (!title) continue;
    const preferredId = asText(value.id);
    const hasSafeId = Boolean(preferredId && isSafeObjectKey(preferredId));
    const id = deterministicLayoutId(
      hasSafeId ? preferredId : `${parentId}-subheading-${index + 1}`,
      structureIds,
      reservedIds,
      hasSafeId,
    );
    const subjects = takeSubjects(value.subjects);
    const nested = cleanLibraryLayoutSubheadings(
      value.subheadings,
      depth + 1,
      id,
      structureIds,
      reservedIds,
      takeSubjects,
      subjects,
    );
    subheadings.push({
      id,
      title,
      collapsed: value.collapsed === true,
      subjects,
      ...(nested.length > 0 ? { subheadings: nested } : {}),
    });
  }
  return subheadings;
}

function cleanLibraryLayout(
  input: unknown,
  libraryId: string,
  subjects: PortableSubjectDefinition[],
): LayoutHeading[] {
  const allowed = new Set(librarySubjectsById(subjects, libraryId).map((subject) => subject.id));
  const placed = new Set<string>();
  const reservedIds = new Set<string>();
  reserveLayoutStructureIds(input, reservedIds);
  const takeSubjects = (rawSubjects: unknown): string[] => {
    const output: string[] = [];
    for (const subjectId of asStringList(rawSubjects)) {
      if (!allowed.has(subjectId) || placed.has(subjectId)) continue;
      placed.add(subjectId);
      output.push(subjectId);
    }
    return output;
  };
  const structureIds = new Set<string>();
  const headings: LayoutHeading[] = [];
  if (Array.isArray(input)) {
    for (const [headingIndex, rawHeading] of input.entries()) {
      const heading = asUnknownRecord(rawHeading);
      const title = asText(heading.title);
      if (!title) continue;
      const preferredHeadingId = asText(heading.id);
      const hasSafeHeadingId = Boolean(preferredHeadingId && isSafeObjectKey(preferredHeadingId));
      const headingId = deterministicLayoutId(
        hasSafeHeadingId
          ? preferredHeadingId
          : `library-${libraryId}-heading-${headingIndex + 1}`,
        structureIds,
        reservedIds,
        hasSafeHeadingId,
      );
      const directSubjects = takeSubjects(heading.subjects);
      const subheadings = cleanLibraryLayoutSubheadings(
        heading.subheadings,
        2,
        headingId,
        structureIds,
        reservedIds,
        takeSubjects,
        directSubjects,
      );
      headings.push({
        id: headingId,
        title,
        collapsed: heading.collapsed === true,
        subjects: directSubjects,
        subheadings,
      });
    }
  }
  return headings;
}

/**
 * Cleans path-free library organization against the canonical subject catalog.
 * A missing catalog is migrated from legacy group metadata; an explicit layout
 * is authoritative, with invalid/duplicate references removed. Explicitly
 * unplaced subjects remain unplaced so deleting a heading is stable.
 */
export function cleanLibraryLayouts(
  input: unknown,
  groups: PortableGroupDefinition[],
  subjects: PortableSubjectDefinition[],
  libraries?: readonly LibraryDefinition[],
): LibraryLayouts {
  const value = isPlainRecord(input) ? input : {};
  const definitions = libraries ?? cleanLibraryDefinitions(undefined, input, subjects);
  const layouts = emptyLibraryLayouts(definitions);
  for (const definition of definitions) {
    layouts[definition.id] = Array.isArray(value[definition.id])
      ? cleanLibraryLayout(value[definition.id], definition.id, subjects)
      : definition.sourceKind
        ? deriveFlatLibraryLayout(definition.id, groups, subjects)
        : [];
  }
  return layouts;
}

/** Reconcile after a classification or catalog mutation without changing Markdown. */
export function reconcilePortableLibraryLayouts(state: PortableIndexLocalState): void {
  state.libraries = cleanLibraryDefinitions(state.libraries, state.libraryLayouts, state.subjects);
  const valid = new Set(state.libraries.map((definition) => definition.id));
  for (const subject of state.subjects) {
    const id = subjectLibraryId(subject);
    if (subject.indexed) delete subject.libraryId;
    else subject.libraryId = id && valid.has(id) ? id : null;
  }
  state.libraryLayouts = cleanLibraryLayouts(state.libraryLayouts, state.groups, state.subjects, state.libraries);
}

export function cloneCurriculumVisual(state: CurriculumVisualState): CurriculumVisualState {
  const orderByContainer: Record<string, string[]> = {};
  for (const [key, paths] of Object.entries(state.orderByContainer)) orderByContainer[key] = [...paths];
  return {
    parentByPath: { ...state.parentByPath },
    orderByContainer,
  };
}

export function clonePathMap(input: Record<string, string>): Record<string, string> {
  return { ...input };
}

export function clonePortableIndex(state: PortableIndexLocalState): PortableIndexLocalState {
  const libraries = state.libraries
    ? state.libraries.map((definition) => ({ ...definition }))
    : cleanLibraryDefinitions(undefined, state.libraryLayouts, state.subjects);
  return {
    version: 3,
    groups: state.groups.map((group) => ({ ...group })),
    subjects: state.subjects.map((subject) => ({ ...subject })),
    resolvedPathBySubjectId: { ...state.resolvedPathBySubjectId },
    relinkableSubjectIds: [...(state.relinkableSubjectIds ?? [])],
    libraries,
    libraryLayouts: state.libraryLayouts
      ? cloneLibraryLayouts(state.libraryLayouts)
      : cleanLibraryLayouts(undefined, state.groups, state.subjects, libraries),
  };
}

export function portablePlaceholderPath(subjectId: string): string {
  return `${PORTABLE_PLACEHOLDER_PREFIX}${subjectId}`;
}

export function portableSubjectIdFromPath(path: string): string {
  return path.startsWith(PORTABLE_PLACEHOLDER_PREFIX) ? path.slice(PORTABLE_PLACEHOLDER_PREFIX.length) : "";
}

export function isPortablePlaceholderPath(path: string): boolean {
  return Boolean(portableSubjectIdFromPath(path));
}

/**
 * Snapshot sizes are cached between bounded-history calculations. Helpers that
 * mutate snapshots in place must invalidate the corresponding cache entry.
 */
const snapshotByteCache = new WeakMap<PersonalSnapshot, number>();
const snapshotUtf8Encoder = new TextEncoder();

function snapshotByteLength(snapshot: PersonalSnapshot): number {
  const cached = snapshotByteCache.get(snapshot);
  if (cached !== undefined) return cached;
  const bytes = snapshotUtf8Encoder.encode(JSON.stringify(snapshot)).byteLength;
  snapshotByteCache.set(snapshot, bytes);
  return bytes;
}

interface MigrationBackupBudget {
  nodes: number;
}

/** Clone only the JSON subset that plugin data can actually persist. */
function cloneBoundedMigrationJson(value: unknown, depth: number, budget: MigrationBackupBudget): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_MIGRATION_BACKUP_NODES) throw new Error("Migration backup has too many values.");
  if (depth > MAX_MIGRATION_BACKUP_DEPTH) throw new Error("Migration backup is nested too deeply.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Migration backup contains a non-finite number.");
    return value;
  }
  if (typeof value === "string") {
    // UTF-8 is never shorter than a JavaScript string's code-unit length, so
    // this avoids allocating an encoder buffer for an obviously oversized value.
    if (value.length > MAX_MIGRATION_BACKUP_BYTES) throw new Error("Migration backup contains oversized text.");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_TRANSFER_LIST_ITEMS) throw new Error("Migration backup contains an oversized list.");
    return value.map((item) => cloneBoundedMigrationJson(item, depth + 1, budget));
  }
  if (!value || typeof value !== "object") throw new Error("Migration backup contains a non-JSON value.");
  const keys = Object.keys(value).sort();
  if (keys.length > MAX_TRANSFER_LIST_ITEMS) throw new Error("Migration backup contains an oversized object.");
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (!isSafeObjectKey(key)) throw new Error("Migration backup contains an unsafe object key.");
    output[key] = cloneBoundedMigrationJson((value as Record<string, unknown>)[key], depth + 1, budget);
  }
  return output;
}

function boundedMigrationBackup<T>(value: T): T | undefined {
  try {
    const cloned = cloneBoundedMigrationJson(value, 0, { nodes: 0 });
    const measured = cloned && typeof cloned === "object" && !Array.isArray(cloned)
      ? { ...(cloned as Record<string, unknown>), migratedAt: Number.MAX_SAFE_INTEGER }
      : cloned;
    const serialized = JSON.stringify(measured);
    if (snapshotUtf8Encoder.encode(serialized).byteLength > MAX_MIGRATION_BACKUP_BYTES) return undefined;
    return cloned as T;
  } catch {
    return undefined;
  }
}

function cleanMigrationTimestamp(value: unknown): number {
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 1;
}

export function limitSnapshotStack(
  snapshots: PersonalSnapshot[],
  maxCount = 20,
  maxBytes?: number,
): PersonalSnapshot[] {
  const byteBudget = maxBytes ?? (snapshots.some((snapshot) => Boolean(snapshot.portableIndex || snapshot.layoutSnapshots))
    ? MAX_PORTABLE_UNDO_BYTES
    : MAX_UNDO_BYTES);
  const kept: PersonalSnapshot[] = [];
  let bytes = 2;
  for (let index = snapshots.length - 1; index >= 0 && kept.length < maxCount; index -= 1) {
    const snapshot = snapshots[index];
    if (!snapshot) continue;
    const snapshotBytes = snapshotByteLength(snapshot);
    if (snapshotBytes > byteBudget) continue;
    if (bytes + snapshotBytes > byteBudget) break;
    kept.unshift(snapshot);
    bytes += snapshotBytes;
  }
  return kept;
}

/**
 * How many entries a bounded history can still hold. The view uses this to warn
 * when the byte budget — not the count limit — is what shortened the history.
 */
export function snapshotStackDepthIsTruncated(
  snapshots: PersonalSnapshot[],
  kept: PersonalSnapshot[],
  maxCount = 20,
): boolean {
  return kept.length < Math.min(snapshots.length, maxCount);
}

export function replacePathPrefix(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  return path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
}

function rewritePathList(paths: string[], oldPath: string, newPath: string): boolean {
  let changed = false;
  for (let index = 0; index < paths.length; index += 1) {
    const current = paths[index];
    if (current === undefined) continue;
    const next = replacePathPrefix(current, oldPath, newPath);
    if (next !== current) {
      paths[index] = next;
      changed = true;
    }
  }
  return changed;
}

function rewritePathMapPrefixes(map: Record<string, string>, oldPath: string, newPath: string): boolean {
  let changed = false;
  for (const [path, value] of Object.entries(map)) {
    const next = replacePathPrefix(path, oldPath, newPath);
    if (next === path) continue;
    map[next] = value;
    delete map[path];
    changed = true;
  }
  return changed;
}

function rewriteCurriculumVisualPrefixes(state: CurriculumVisualState, oldPath: string, newPath: string): boolean {
  let changed = false;
  const parents: Record<string, string | null> = {};
  for (const [path, parent] of Object.entries(state.parentByPath)) {
    const nextPath = replacePathPrefix(path, oldPath, newPath);
    const nextParent = parent === null ? null : replacePathPrefix(parent, oldPath, newPath);
    parents[nextPath] = nextParent;
    if (nextPath !== path || nextParent !== parent) changed = true;
  }
  const orders: Record<string, string[]> = {};
  for (const [key, paths] of Object.entries(state.orderByContainer)) {
    const nextKey = key.startsWith("parent:")
      ? `parent:${replacePathPrefix(key.slice(7), oldPath, newPath)}`
      : key;
    const nextPaths = paths.map((path) => replacePathPrefix(path, oldPath, newPath));
    orders[nextKey] = nextPaths;
    if (nextKey !== key || nextPaths.some((path, index) => path !== paths[index])) changed = true;
  }
  if (changed) {
    state.parentByPath = parents;
    state.orderByContainer = orders;
  }
  return changed;
}

const FOLDER_PATH_SETTING_KEYS = [
  "primaryFolder",
  "proposalFolder",
  "templatesFolder",
  "defaultNoteFolder",
  "defaultTemplatePath",
  "attachmentFolder",
] as const satisfies ReadonlyArray<keyof PluginSettings>;

interface FolderDerivedGroupState {
  curriculumVisual: CurriculumVisualState;
  indexGroupAliases: Record<string, string>;
  indexGroupOrder: string[];
}

interface FolderDerivedGroupRename {
  oldGroup: string;
  newGroup: string;
}

function cleanVaultPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

function directChildFolderName(primaryFolder: string, path: string): string {
  const root = cleanVaultPath(primaryFolder);
  const candidate = cleanVaultPath(path);
  const relative = root
    ? candidate.startsWith(`${root}/`) ? candidate.slice(root.length + 1) : ""
    : candidate;
  return relative && !relative.includes("/") ? relative : "";
}

function folderDerivedGroupFromPath(
  settings: Pick<PluginSettings, "primaryFolder" | "workspaceMode">,
  path: string,
): string {
  const folderName = directChildFolderName(settings.primaryFolder, path);
  if (settings.workspaceMode === "ent-clinical") return folderName.replace(/^\d+\s+/, "").trim();
  if (folderName) return folderName;
  // configuredGroupFromPath also derives generic-mode groups from the
  // top-level folder of notes living outside the primary folder, so renaming
  // such a folder must migrate group state too. Folders nested inside the
  // primary folder keep deriving no group of their own.
  const root = cleanVaultPath(settings.primaryFolder);
  const candidate = cleanVaultPath(path);
  if (!candidate || candidate === root || (root && candidate.startsWith(`${root}/`))) return "";
  return candidate.split("/")[0] ?? "";
}

function folderDerivedGroupRename(
  settings: Pick<PluginSettings, "primaryFolder" | "workspaceMode">,
  oldPath: string,
  newPath: string,
): FolderDerivedGroupRename | null {
  const oldGroup = folderDerivedGroupFromPath(settings, oldPath);
  const newGroup = folderDerivedGroupFromPath(settings, newPath);
  return oldGroup && newGroup && oldGroup !== newGroup ? { oldGroup, newGroup } : null;
}

function rewriteFolderPathSettings(settings: PluginSettings, oldPath: string, newPath: string): boolean {
  let changed = false;
  for (const key of FOLDER_PATH_SETTING_KEYS) {
    const current = settings[key];
    const next = replacePathPrefix(current, oldPath, newPath);
    if (next !== current) {
      settings[key] = next;
      changed = true;
    }
  }
  for (const profile of Object.values(settings.libraryNoteProfiles)) {
    for (const key of ["folder", "templatePath"] as const) {
      const current = profile[key];
      if (current === undefined) continue;
      const next = replacePathPrefix(current, oldPath, newPath);
      if (next !== current) {
        profile[key] = next;
        changed = true;
      }
    }
  }
  return changed;
}

function rewriteCurriculumRootContainers(
  state: CurriculumVisualState,
  sourceLabels: Set<string>,
  targetLabel: string,
): boolean {
  const targetKey = curriculumContainerKey(targetLabel, null);
  const sourceKeys = [...new Set([...sourceLabels].map((label) => curriculumContainerKey(label, null)))];
  const copiedKeys = sourceKeys.filter((key) => key !== targetKey
    && Object.prototype.hasOwnProperty.call(state.orderByContainer, key));
  if (copiedKeys.length === 0) return false;
  const current = state.orderByContainer[targetKey] ?? [];
  const combined = [...current];
  for (const key of copiedKeys) combined.push(...(state.orderByContainer[key] ?? []));
  const unique = [...new Set(combined)];
  if (Object.prototype.hasOwnProperty.call(state.orderByContainer, targetKey)
    && unique.length === current.length
    && unique.every((path, index) => path === current[index])) return false;
  state.orderByContainer[targetKey] = unique;
  return true;
}

function insertTargetAfterSource(values: string[], sourceLabels: Set<string>, targetLabel: string): string[] {
  if (values.includes(targetLabel)) return values;
  const sourceIndex = values.findIndex((value) => sourceLabels.has(value));
  if (sourceIndex < 0) return values;
  const output = [...values];
  output.splice(sourceIndex + 1, 0, targetLabel);
  return output;
}

function rewriteFolderDerivedGroupState(
  state: FolderDerivedGroupState,
  rename: FolderDerivedGroupRename,
): boolean {
  const { oldGroup, newGroup } = rename;
  const aliases = state.indexGroupAliases;
  const aliasEntries = Object.entries(aliases);
  const oldAliasEntry = aliasEntries.find(([source]) => source === oldGroup);
  const newAliasEntry = aliasEntries.find(([source]) => source === newGroup);
  const hasNewAlias = newAliasEntry !== undefined;
  const oldAlias = oldAliasEntry?.[1] ?? "";
  const carriedAlias = isSafeObjectKey(newGroup)
    ? newAliasEntry?.[1] || oldAlias
    : "";
  const oldEffective = oldAlias || oldGroup;
  const newEffective = carriedAlias || newGroup;
  let changed = false;

  // Folder names are only one possible source of a group. Keep the old
  // logical taxonomy intact for explicit frontmatter, saved layouts, and
  // portable identities; the renamed folder inherits the old display alias
  // only when it does not already have an independent mapping.
  if (isSafeObjectKey(newGroup) && !hasNewAlias && carriedAlias && carriedAlias !== newGroup) {
    aliases[newGroup] = carriedAlias;
    changed = true;
  }

  const sourceLabels = new Set([oldGroup, oldEffective]);
  const nextOrder = insertTargetAfterSource(state.indexGroupOrder, sourceLabels, newEffective);
  if (nextOrder.length !== state.indexGroupOrder.length
    || nextOrder.some((label, index) => label !== state.indexGroupOrder[index])) {
    state.indexGroupOrder = nextOrder;
    changed = true;
  }
  if (rewriteCurriculumRootContainers(state.curriculumVisual, sourceLabels, newEffective)) changed = true;
  return changed;
}

function rewriteSnapshotFolderRename(
  snapshot: PersonalSnapshot,
  oldPath: string,
  newPath: string,
  inheritedGroupRename: FolderDerivedGroupRename | null,
): boolean {
  const ownGroupRename = snapshot.settings
    ? folderDerivedGroupRename(snapshot.settings, oldPath, newPath)
    : inheritedGroupRename;
  let changed = false;
  if (ownGroupRename && rewriteFolderDerivedGroupState(snapshot, ownGroupRename)) changed = true;
  if (snapshot.settings && rewriteFolderPathSettings(snapshot.settings, oldPath, newPath)) changed = true;
  for (const nested of snapshot.layoutSnapshots ?? []) {
    if (rewriteSnapshotFolderRename(nested, oldPath, newPath, ownGroupRename)) changed = true;
  }
  if (changed) snapshotByteCache.delete(snapshot);
  return changed;
}

/**
 * Migrate folder-derived group identity and folder-valued settings after an
 * Obsidian TFolder rename. The caller separately rewrites note-path references.
 */
export function rewritePluginDataFolderRename(
  data: PluginData,
  oldPath: string,
  newPath: string,
): boolean {
  if (!oldPath || !newPath || oldPath === newPath) return false;
  const currentGroupRename = folderDerivedGroupRename(data.settings, oldPath, newPath);
  let changed = false;
  if (currentGroupRename) {
    const oldAlias = Object.entries(data.indexGroupAliases)
      .find(([source]) => source === currentGroupRename.oldGroup)?.[1] ?? "";
    const existingNewEffective = Object.entries(data.indexGroupAliases)
      .find(([source]) => source === currentGroupRename.newGroup)?.[1] ?? "";
    const oldEffective = oldAlias || currentGroupRename.oldGroup;
    const newEffective = existingNewEffective || oldAlias || currentGroupRename.newGroup;
    if (rewriteFolderDerivedGroupState(data, currentGroupRename)) changed = true;
    const sourceLabels = new Set([currentGroupRename.oldGroup, oldEffective]);
    const nextCollapsed = insertTargetAfterSource(data.collapsed.curriculumDomains, sourceLabels, newEffective);
    if (nextCollapsed.length !== data.collapsed.curriculumDomains.length
      || nextCollapsed.some((label, index) => label !== data.collapsed.curriculumDomains[index])) {
      data.collapsed.curriculumDomains = nextCollapsed;
      changed = true;
    }
  }
  if (rewriteFolderPathSettings(data.settings, oldPath, newPath)) changed = true;
  for (const snapshot of [...data.layoutSnapshots, ...data.undoStack, ...data.redoStack]) {
    if (rewriteSnapshotFolderRename(
      snapshot,
      oldPath,
      newPath,
      currentGroupRename,
    )) changed = true;
  }
  const layoutSnapshots = limitSnapshotStack(data.layoutSnapshots, 10);
  const undoStack = limitSnapshotStack(data.undoStack);
  const redoStack = limitSnapshotStack(data.redoStack);
  if (layoutSnapshots.length !== data.layoutSnapshots.length) { data.layoutSnapshots = layoutSnapshots; changed = true; }
  if (undoStack.length !== data.undoStack.length) { data.undoStack = undoStack; changed = true; }
  if (redoStack.length !== data.redoStack.length) { data.redoStack = redoStack; changed = true; }
  return changed;
}

function rewriteSnapshotTemplatePathRename(snapshot: PersonalSnapshot, oldPath: string, newPath: string): boolean {
  let changed = false;
  if (snapshot.settings) {
    const current = snapshot.settings.defaultTemplatePath;
    const next = current === oldPath ? newPath : current;
    if (next !== current) {
      snapshot.settings.defaultTemplatePath = next;
      changed = true;
    }
    for (const profile of Object.values(snapshot.settings.libraryNoteProfiles)) {
      if (profile.templatePath !== oldPath) continue;
      profile.templatePath = newPath;
      changed = true;
    }
  }
  for (const nested of snapshot.layoutSnapshots ?? []) {
    if (rewriteSnapshotTemplatePathRename(nested, oldPath, newPath)) changed = true;
  }
  if (changed) snapshotByteCache.delete(snapshot);
  return changed;
}

/** Rewrite the one file-valued setting after an Obsidian TFile rename. */
export function rewritePluginDataTemplatePathRename(data: PluginData, oldPath: string, newPath: string): boolean {
  if (!oldPath || !newPath || oldPath === newPath) return false;
  let changed = false;
  const current = data.settings.defaultTemplatePath;
  const next = current === oldPath ? newPath : current;
  if (next !== current) {
    data.settings.defaultTemplatePath = next;
    changed = true;
  }
  for (const profile of Object.values(data.settings.libraryNoteProfiles)) {
    if (profile.templatePath !== oldPath) continue;
    profile.templatePath = newPath;
    changed = true;
  }
  for (const snapshot of [...data.layoutSnapshots, ...data.undoStack, ...data.redoStack]) {
    if (rewriteSnapshotTemplatePathRename(snapshot, oldPath, newPath)) changed = true;
  }
  const layoutSnapshots = limitSnapshotStack(data.layoutSnapshots, 10);
  const undoStack = limitSnapshotStack(data.undoStack);
  const redoStack = limitSnapshotStack(data.redoStack);
  if (layoutSnapshots.length !== data.layoutSnapshots.length) { data.layoutSnapshots = layoutSnapshots; changed = true; }
  if (undoStack.length !== data.undoStack.length) { data.undoStack = undoStack; changed = true; }
  if (redoStack.length !== data.redoStack.length) { data.redoStack = redoStack; changed = true; }
  return changed;
}

function rewriteLayoutNodeSubjects(node: LayoutHeading | LayoutSubheading, oldPath: string, newPath: string): boolean {
  let changed = rewritePathList(node.subjects, oldPath, newPath);
  for (const subheading of childSubheadings(node)) {
    if (rewriteLayoutNodeSubjects(subheading, oldPath, newPath)) changed = true;
  }
  return changed;
}

function rewriteSnapshotPrefixes(snapshot: PersonalSnapshot, oldPath: string, newPath: string): boolean {
  let changed = false;
  for (const heading of snapshot.collections) {
    if (rewriteLayoutNodeSubjects(heading, oldPath, newPath)) changed = true;
  }
  for (const paths of [
    snapshot.pinnedPaths,
    snapshot.nextStudyPaths,
    snapshot.manualIndexPaths,
    snapshot.excludedIndexPaths,
  ]) {
    if (rewritePathList(paths, oldPath, newPath)) changed = true;
  }
  if (rewritePathMapPrefixes(snapshot.indexGroupByPath, oldPath, newPath)) changed = true;
  if (rewritePathMapPrefixes(snapshot.displayNameByPath, oldPath, newPath)) changed = true;
  if (rewriteCurriculumVisualPrefixes(snapshot.curriculumVisual, oldPath, newPath)) changed = true;
  if (snapshot.portableIndex) {
    for (const [subjectId, path] of Object.entries(snapshot.portableIndex.resolvedPathBySubjectId)) {
      const next = replacePathPrefix(path, oldPath, newPath);
      if (next !== path) {
        snapshot.portableIndex.resolvedPathBySubjectId[subjectId] = next;
        changed = true;
      }
    }
  }
  for (const nested of snapshot.layoutSnapshots ?? []) {
    if (rewriteSnapshotPrefixes(nested, oldPath, newPath)) changed = true;
  }
  // Renames mutate snapshots in place. Their cached serialized size is no
  // longer valid once any path inside the snapshot changes.
  if (changed) snapshotByteCache.delete(snapshot);
  return changed;
}

/** Rewrite current plugin-owned state without changing any historical snapshots. */
export function rewriteActivePluginDataPathPrefix(data: PluginData, oldPath: string, newPath: string): boolean {
  if (!oldPath || !newPath || oldPath === newPath) return false;
  let changed = false;
  for (const heading of data.collections) {
    if (rewriteLayoutNodeSubjects(heading, oldPath, newPath)) changed = true;
  }
  for (const paths of [data.pinnedPaths, data.nextStudyPaths, data.manualIndexPaths, data.excludedIndexPaths]) {
    if (rewritePathList(paths, oldPath, newPath)) changed = true;
  }
  if (rewritePathMapPrefixes(data.indexGroupByPath, oldPath, newPath)) changed = true;
  if (rewritePathMapPrefixes(data.displayNameByPath, oldPath, newPath)) changed = true;
  if (rewriteCurriculumVisualPrefixes(data.curriculumVisual, oldPath, newPath)) changed = true;
  for (const [subjectId, path] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
    const next = replacePathPrefix(path, oldPath, newPath);
    if (next !== path) {
      data.portableIndex.resolvedPathBySubjectId[subjectId] = next;
      changed = true;
    }
  }
  const selectedPath = replacePathPrefix(data.selectedPath, oldPath, newPath);
  if (selectedPath !== data.selectedPath) {
    data.selectedPath = selectedPath;
    changed = true;
  }
  if (rewritePathList(data.collapsed.curriculumNodes, oldPath, newPath)) changed = true;
  return changed;
}

/** Rewrite one file path or every descendant of a renamed folder across current and historical plugin state. */
export function rewritePluginDataPathPrefix(data: PluginData, oldPath: string, newPath: string): boolean {
  let changed = rewriteActivePluginDataPathPrefix(data, oldPath, newPath);
  if (!oldPath || !newPath || oldPath === newPath) return changed;
  for (const snapshot of [...data.layoutSnapshots, ...data.undoStack, ...data.redoStack]) {
    if (rewriteSnapshotPrefixes(snapshot, oldPath, newPath)) changed = true;
  }
  const layoutSnapshots = limitSnapshotStack(data.layoutSnapshots, 10);
  const undoStack = limitSnapshotStack(data.undoStack);
  const redoStack = limitSnapshotStack(data.redoStack);
  if (layoutSnapshots.length !== data.layoutSnapshots.length) { data.layoutSnapshots = layoutSnapshots; changed = true; }
  if (undoStack.length !== data.undoStack.length) { data.undoStack = undoStack; changed = true; }
  if (redoStack.length !== data.redoStack.length) { data.redoStack = redoStack; changed = true; }
  return changed;
}

/**
 * Deep-copy the whole personal-organization payload. Snapshot capture, snapshot
 * restore, and recovery-backup creation all route through here so a new field
 * can never reach one of them and miss the other two.
 */
export function clonePersonalOrganization(source: PersonalOrganizationState): PersonalOrganizationState {
  return {
    collections: cloneCollections(source.collections),
    pinnedPaths: [...source.pinnedPaths],
    nextStudyPaths: [...source.nextStudyPaths],
    savedViews: source.savedViews.map((view) => ({ ...view })),
    curriculumVisual: cloneCurriculumVisual(source.curriculumVisual),
    manualIndexPaths: [...source.manualIndexPaths],
    excludedIndexPaths: [...source.excludedIndexPaths],
    indexGroupByPath: clonePathMap(source.indexGroupByPath),
    displayNameByPath: clonePathMap(source.displayNameByPath),
    indexGroupAliases: clonePathMap(source.indexGroupAliases),
    indexGroupOrder: [...source.indexGroupOrder],
  };
}

export function snapshotPersonal(
  data: PluginData,
  label: string,
  includeSettings = false,
  includePortableIndex = false,
  includeLayoutSnapshots = false,
  includeActiveTab = false,
): PersonalSnapshot {
  const snapshot: PersonalSnapshot = {
    label,
    at: Date.now(),
    ...clonePersonalOrganization(data),
  };
  if (includeActiveTab) snapshot.activeTab = data.activeTab;
  if (includeSettings) snapshot.settings = structuredClone(data.settings);
  if (includePortableIndex) snapshot.portableIndex = clonePortableIndex(data.portableIndex);
  if (includeLayoutSnapshots) snapshot.layoutSnapshots = data.layoutSnapshots.map((item) => structuredClone(item));
  return snapshot;
}

export function restoreSnapshot(data: PluginData, snapshot: PersonalSnapshot): void {
  if (snapshot.activeTab !== undefined) data.activeTab = snapshot.activeTab;
  Object.assign(data, clonePersonalOrganization(snapshot));
  if (snapshot.portableIndex) data.portableIndex = clonePortableIndex(snapshot.portableIndex);
  if (snapshot.settings) data.settings = structuredClone(snapshot.settings);
  if (snapshot.layoutSnapshots) data.layoutSnapshots = snapshot.layoutSnapshots.map((item) => structuredClone(item));
}

function recoveredLegacyId(prefix: string, parts: unknown[]): string {
  return `${prefix}-recovered-${fingerprintText(JSON.stringify(canonicalJsonValue(parts)))}`;
}

/**
 * Reserve every intact identity at every allowed depth before generating
 * replacements. Without this first pass, an earlier missing/unsafe node can
 * take the fallback ID of a later intact node, forcing that intact node to be
 * renamed merely because of array order. Nodes beyond MAX_LAYOUT_DEPTH never
 * materialize, so their IDs are deliberately not reserved.
 */
function reserveLayoutStructureIds(input: unknown, reservedIds: Set<string>, depth = 1): void {
  if (!Array.isArray(input) || depth > MAX_LAYOUT_DEPTH) return;
  for (const raw of input as unknown[]) {
    const value = asUnknownRecord(raw);
    if (!asText(value.title)) continue;
    const id = asText(value.id);
    if (id && isSafeObjectKey(id)) reservedIds.add(id);
    reserveLayoutStructureIds(value.subheadings, reservedIds, depth + 1);
  }
}

/**
 * Depth-capped content is merged upward instead of lost: every titled node
 * nested beyond MAX_LAYOUT_DEPTH contributes its subjects, in document order,
 * to the nearest allowed ancestor. The walk is iterative so hostile nesting
 * depth never maps onto stack depth.
 */
function mergeTooDeepLayoutSubjects(
  input: unknown,
  parentSubjects: string[],
  takeSubjects: (rawSubjects: unknown) => string[],
): void {
  if (!Array.isArray(input)) return;
  const stack: unknown[] = [...(input as unknown[])].reverse();
  while (stack.length > 0) {
    const value = asUnknownRecord(stack.pop());
    if (!asText(value.title)) continue;
    parentSubjects.push(...takeSubjects(value.subjects));
    if (!Array.isArray(value.subheadings)) continue;
    for (let index = value.subheadings.length - 1; index >= 0; index -= 1) {
      stack.push(value.subheadings[index]);
    }
  }
}

function cleanLayoutSubheadings(
  input: unknown,
  depth: number,
  indexPath: readonly number[],
  structureIds: Set<string>,
  reservedIds: ReadonlySet<string>,
  parentSubjects: string[],
): LayoutSubheading[] {
  if (!Array.isArray(input)) return [];
  if (depth > MAX_LAYOUT_DEPTH) {
    const seen = new Set(parentSubjects);
    mergeTooDeepLayoutSubjects(input, parentSubjects, (rawSubjects) => {
      const merged: string[] = [];
      for (const subjectId of asStringList(rawSubjects)) {
        if (seen.has(subjectId)) continue;
        seen.add(subjectId);
        merged.push(subjectId);
      }
      return merged;
    });
    return [];
  }
  const subheadings: LayoutSubheading[] = [];
  for (const [index, raw] of (input as unknown[]).entries()) {
    const value = asUnknownRecord(raw);
    const title = asText(value.title);
    if (!title) continue;
    const preferredId = asText(value.id);
    const hasSafeId = Boolean(preferredId && isSafeObjectKey(preferredId));
    const id = deterministicLayoutId(
      hasSafeId
        ? preferredId
        : recoveredLegacyId("subheading", [...indexPath, index, title]),
      structureIds,
      reservedIds,
      hasSafeId,
    );
    const subjects = asStringList(value.subjects);
    const nested = cleanLayoutSubheadings(
      value.subheadings,
      depth + 1,
      [...indexPath, index],
      structureIds,
      reservedIds,
      subjects,
    );
    subheadings.push({
      id,
      title,
      collapsed: value.collapsed === true,
      subjects,
      ...(nested.length > 0 ? { subheadings: nested } : {}),
    });
  }
  return subheadings;
}

function cleanLayout(input: unknown): LayoutHeading[] {
  if (!Array.isArray(input)) return [];
  const reservedIds = new Set<string>();
  reserveLayoutStructureIds(input, reservedIds);
  const headings: LayoutHeading[] = [];
  const structureIds = new Set<string>();
  for (const [headingIndex, raw] of (input as unknown[]).entries()) {
    const value = asUnknownRecord(raw);
    const title = asText(value.title);
    if (!title) continue;
    const preferredHeadingId = asText(value.id);
    const hasSafeHeadingId = Boolean(preferredHeadingId && isSafeObjectKey(preferredHeadingId));
    const headingId = deterministicLayoutId(
      hasSafeHeadingId
        ? preferredHeadingId
        : recoveredLegacyId("collection", [headingIndex, title]),
      structureIds,
      reservedIds,
      hasSafeHeadingId,
    );
    const subjects = asStringList(value.subjects);
    const subheadings = cleanLayoutSubheadings(
      value.subheadings,
      2,
      [headingIndex],
      structureIds,
      reservedIds,
      subjects,
    );
    headings.push({
      id: headingId,
      title,
      collapsed: value.collapsed === true,
      subjects,
      subheadings,
    });
  }
  return headings;
}

function isMainTab(value: unknown): value is MainTab {
  return ["curriculum", "inbox", "collections", "queues"].includes(String(value)) || libraryIdFromTab(value) !== null;
}

function isOpenNoteBehavior(value: unknown): value is OpenNoteBehavior {
  return ["new-tab", "same-tab", "split"].includes(String(value));
}

function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === "generic" || value === "ent-clinical";
}

function isNewNoteMode(value: unknown): value is NewNoteMode {
  return value === "empty" || value === "template";
}

export const MAX_LIBRARY_NOTE_PROFILE_PATH_LENGTH = 1_024;

function cleanProfilePathOverride(value: unknown, folder: boolean): string | undefined {
  if (typeof value !== "string" || value.length > MAX_LIBRARY_NOTE_PROFILE_PATH_LENGTH) return undefined;
  const normalized = value
    .normalize("NFC")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(folder ? /^\/+|\/+$/g : /^\/+/, "");
  if (/[\p{Cc}\p{Cf}]/u.test(normalized)) return undefined;
  const segments = normalized.split("/").map((segment) => segment.trim().toLowerCase());
  if (segments.some((segment) => segment === "." || segment === "..")) return undefined;
  if (segments[0] === ".trash" || isImmutableSourcePath(normalized)) return undefined;
  return normalized;
}

/**
 * Clean bounded, stable-ID keyed Library creation overrides. Unknown fields,
 * unsafe IDs, invalid paths, and entries beyond the Library cap are dropped.
 */
export function cleanLibraryNoteProfiles(
  input: unknown,
  allowedLibraryIds?: ReadonlySet<string>,
): LibraryNoteProfiles {
  const output: LibraryNoteProfiles = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return output;
  let retained = 0;
  for (const [libraryId, raw] of Object.entries(input as Record<string, unknown>)) {
    if (retained >= MAX_LIBRARIES) break;
    if (!isValidLibraryId(libraryId) || (allowedLibraryIds && !allowedLibraryIds.has(libraryId))) continue;
    const value = asUnknownRecord(raw);
    const profile: LibraryNoteProfile = {};
    if (Object.prototype.hasOwnProperty.call(value, "folder")) {
      const folder = cleanProfilePathOverride(value.folder, true);
      if (folder !== undefined) profile.folder = folder;
    }
    if (Object.prototype.hasOwnProperty.call(value, "mode") && isNewNoteMode(value.mode)) {
      profile.mode = value.mode;
    }
    if (Object.prototype.hasOwnProperty.call(value, "templatePath")) {
      const templatePath = cleanProfilePathOverride(value.templatePath, false);
      if (templatePath !== undefined) profile.templatePath = templatePath;
    }
    if (Object.keys(profile).length === 0) continue;
    output[libraryId] = profile;
    retained += 1;
  }
  return output;
}

export function resolveLibraryNoteProfile(
  settings: Pick<PluginSettings, "defaultNoteFolder" | "defaultNewNoteMode" | "defaultTemplatePath" | "libraryNoteProfiles">,
  libraryId: string,
): EffectiveLibraryNoteProfile {
  const profile = isValidLibraryId(libraryId) ? settings.libraryNoteProfiles[libraryId] : undefined;
  return {
    folder: profile?.folder ?? settings.defaultNoteFolder,
    mode: profile?.mode ?? settings.defaultNewNoteMode,
    templatePath: profile?.templatePath ?? settings.defaultTemplatePath,
    inherited: {
      folder: profile?.folder === undefined,
      mode: profile?.mode === undefined,
      templatePath: profile?.templatePath === undefined,
    },
  };
}

export function validateLibraryNoteProfile(
  profile: LibraryNoteProfile,
  baseSettings: Pick<PluginSettings, "defaultNoteFolder" | "defaultNewNoteMode" | "defaultTemplatePath" | "templatesFolder" | "libraryNoteProfiles">,
  libraryId: string,
  configDir: string,
): string | null {
  const cleaned = cleanLibraryNoteProfiles({ [libraryId]: profile }, new Set([libraryId]))[libraryId];
  if (!cleaned || Object.keys(cleaned).length !== Object.keys(profile).length) {
    return "The Library profile contains an unsupported value or vault path.";
  }
  if (cleaned.folder !== undefined) {
    const folderError = validateWritableFolderPath(cleaned.folder, configDir);
    if (folderError) return folderError;
  }
  if (cleaned.templatePath) {
    const templateError = validateTemplateFilePath(
      cleaned.templatePath,
      baseSettings.templatesFolder,
      configDir,
    );
    if (templateError) return templateError;
  }
  const effective = resolveLibraryNoteProfile({ ...baseSettings, libraryNoteProfiles: { [libraryId]: cleaned } }, libraryId);
  if (effective.mode === "template") {
    return validateTemplateFilePath(effective.templatePath, baseSettings.templatesFolder, configDir);
  }
  return null;
}

function isAttachmentStorageMode(value: unknown): value is AttachmentStorageMode {
  return value === "obsidian" || value === "fixed-folder" || value === "note-subfolder" || value === "ask";
}

function isAttachmentInsertionMode(value: unknown): value is AttachmentInsertionMode {
  return value === "cursor" || value === "marker" || value === "heading" || value === "end";
}

function cleanSavedViews(input: unknown): SavedView[] {
  if (!Array.isArray(input)) return [];
  const reservedIds = new Set<string>();
  for (const raw of input as unknown[]) {
    const view = asUnknownRecord(raw);
    if (!asText(view.name) || (!isMainTab(view.tab) && !legacyLibraryIdFromTab(view.tab))) continue;
    const id = asText(view.id);
    if (id && isSafeObjectKey(id)) reservedIds.add(id);
  }
  const views: SavedView[] = [];
  const usedIds = new Set<string>();
  for (const [viewIndex, raw] of (input as unknown[]).entries()) {
    const view = asUnknownRecord(raw);
    const name = asText(view.name);
    if (!isMainTab(view.tab) && !legacyLibraryIdFromTab(view.tab)) continue;
    const tab = migrateMainTab(view.tab, "curriculum");
    if (!name) continue;
    const query = asText(view.query);
    const preferredId = asText(view.id);
    const hasSafeId = Boolean(preferredId && isSafeObjectKey(preferredId));
    views.push({
      id: deterministicLayoutId(
        hasSafeId
          ? preferredId
          : recoveredLegacyId("view", [viewIndex, name, tab, query]),
        usedIds,
        reservedIds,
        hasSafeId,
      ),
      name,
      tab,
      query,
    });
  }
  return views;
}

/**
 * Keys stored in ordinary object-backed dictionaries must not resolve through
 * Object.prototype. This covers the familiar mutation keys and inherited
 * methods such as `toString` that otherwise look like existing path bindings.
 */
export function isSafeObjectKey(key: string): boolean {
  return key !== "prototype" && !Object.prototype.hasOwnProperty.call(Object.prototype, key);
}

function isRecordKind(value: unknown): value is RecordKind {
  return ["topic", "procedure", "medication", "syndrome", "proposal", "note"].includes(String(value));
}

const RECOVERED_PORTABLE_GROUP_ID = "group-recovered-ungrouped";
const RECOVERED_PORTABLE_GROUP_TITLE = "Recovered / Ungrouped";

/**
 * Repair parent links from locally persisted data without discarding subjects.
 * Portable imports are rejected strictly, but historical or hand-edited plugin
 * data is recovered conservatively: invalid edges are detached and one stable
 * edge is removed from every cycle.
 */
function repairPortableParentLinks(
  subjects: PortableSubjectDefinition[],
  sourceGroupIdBySubjectId: ReadonlyMap<string, string>,
): void {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  for (const subject of subjects) {
    const parent = subject.parentId ? byId.get(subject.parentId) : undefined;
    const sourceGroupId = sourceGroupIdBySubjectId.get(subject.id) ?? subject.groupId;
    const parentSourceGroupId = parent
      ? sourceGroupIdBySubjectId.get(parent.id) ?? parent.groupId
      : "";
    if (!subject.indexed
      || !parent
      || parent.id === subject.id
      || !parent.indexed
      || parent.groupId !== subject.groupId
      || parentSourceGroupId !== sourceGroupId) subject.parentId = null;
  }

  const completed = new Set<string>();
  for (const subject of subjects) {
    if (completed.has(subject.id)) continue;
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let cursor: PortableSubjectDefinition | undefined = subject;
    while (cursor && !completed.has(cursor.id)) {
      const position = positions.get(cursor.id);
      if (position !== undefined) {
        const cycleIds = chain.slice(position);
        const detachId = cycleIds.reduce((greatest, id) => id > greatest ? id : greatest, "");
        if (detachId) {
          const detached = byId.get(detachId);
          if (detached) detached.parentId = null;
        }
        break;
      }
      positions.set(cursor.id, chain.length);
      chain.push(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    chain.forEach((id) => completed.add(id));
  }
}

export function cleanPortableIndex(input: unknown): PortableIndexLocalState {
  const value = asUnknownRecord(input);
  const groups: PortableGroupDefinition[] = [];
  const groupIds = new Set<string>();
  if (Array.isArray(value.groups)) {
    for (const raw of value.groups as unknown[]) {
      const group = asUnknownRecord(raw);
      const id = asText(group.id);
      const title = asText(group.title);
      if (!id || !title || !isSafeObjectKey(id) || groupIds.has(id)) continue;
      groupIds.add(id);
      groups.push({ id, title, order: Number.isFinite(Number(group.order)) ? Number(group.order) : groups.length });
    }
  }
  let recoveredGroupId = "";
  const ensureRecoveredGroup = (): string => {
    if (recoveredGroupId) return recoveredGroupId;
    const existing = groups.find((group) => group.title === RECOVERED_PORTABLE_GROUP_TITLE);
    if (existing) {
      recoveredGroupId = existing.id;
      return recoveredGroupId;
    }
    let candidate = RECOVERED_PORTABLE_GROUP_ID;
    let suffix = 2;
    while (groupIds.has(candidate)) {
      candidate = `${RECOVERED_PORTABLE_GROUP_ID}-${suffix}`;
      suffix += 1;
    }
    recoveredGroupId = candidate;
    groupIds.add(candidate);
    groups.push({ id: candidate, title: RECOVERED_PORTABLE_GROUP_TITLE, order: groups.length });
    return recoveredGroupId;
  };
  const subjects: PortableSubjectDefinition[] = [];
  const subjectIds = new Set<string>();
  const sourceGroupIdBySubjectId = new Map<string, string>();
  if (Array.isArray(value.subjects)) {
    for (const raw of value.subjects as unknown[]) {
      const subject = asUnknownRecord(raw);
      const id = asText(subject.id);
      const title = asText(subject.title);
      const requestedGroupId = asText(subject.groupId);
      if (!id || !title || !isSafeObjectKey(id) || subjectIds.has(id)) continue;
      const groupId = groupIds.has(requestedGroupId) ? requestedGroupId : ensureRecoveredGroup();
      const parentId = subject.parentId === null ? null : asText(subject.parentId) || null;
      const indexed = subject.indexed !== false;
      const hasLibraryId = subject.libraryId !== undefined;
      subjectIds.add(id);
      sourceGroupIdBySubjectId.set(id, requestedGroupId);
      subjects.push({
        id,
        title,
        groupId,
        parentId,
        order: Number.isFinite(Number(subject.order)) ? Number(subject.order) : subjects.length,
        indexed,
        configuredId: asText(subject.configuredId),
        recordKind: isRecordKind(subject.recordKind) ? subject.recordKind : "topic",
        ...(hasLibraryId ? { libraryId: !indexed && isValidLibraryId(subject.libraryId) ? asText(subject.libraryId) : null } : {}),
      });
    }
  }
  repairPortableParentLinks(subjects, sourceGroupIdBySubjectId);
  const validSubjects = new Set(subjects.map((subject) => subject.id));
  const resolvedPathBySubjectId: Record<string, string> = {};
  const usedPaths = new Set<string>();
  const rawBindings = isPlainRecord(value.resolvedPathBySubjectId) ? value.resolvedPathBySubjectId : {};
  for (const [subjectId, rawPath] of Object.entries(rawBindings)) {
    const path = asText(rawPath);
    if (!isSafeObjectKey(subjectId) || !validSubjects.has(subjectId) || !path || usedPaths.has(path) || isPortablePlaceholderPath(path)) continue;
    resolvedPathBySubjectId[subjectId] = path;
    usedPaths.add(path);
  }
  const libraries = cleanLibraryDefinitions(value.libraries, value.libraryLayouts, subjects);
  const validLibraryIds = new Set(libraries.map((definition) => definition.id));
  for (const subject of subjects) {
    const libraryId = subjectLibraryId(subject);
    if (subject.indexed) delete subject.libraryId;
    else subject.libraryId = libraryId && validLibraryIds.has(libraryId) ? libraryId : null;
  }
  return {
    version: 3,
    groups,
    subjects,
    resolvedPathBySubjectId,
    relinkableSubjectIds: [...new Set(asStringList(value.relinkableSubjectIds))]
      .filter((subjectId) => validSubjects.has(subjectId) && Boolean(resolvedPathBySubjectId[subjectId])),
    libraries,
    libraryLayouts: cleanLibraryLayouts(value.libraryLayouts, groups, subjects, libraries),
  };
}

function cleanCollapseState(input: unknown): ViewCollapseState {
  const value = asUnknownRecord(input);
  return {
    curriculumDomains: [...new Set(asStringList(value.curriculumDomains))],
    curriculumNodes: [...new Set(asStringList(value.curriculumNodes))],
    queues: value.queues === undefined
      ? [...DEFAULT_COLLAPSED_QUEUES]
      : [...new Set(asStringList(value.queues))],
  };
}

export function cleanCurriculumVisual(input: unknown): CurriculumVisualState {
  if (!isPlainRecord(input)) return { parentByPath: {}, orderByContainer: {} };
  const raw = input;
  const parentByPath: Record<string, string | null> = {};
  if (isPlainRecord(raw.parentByPath)) {
    for (const [path, parent] of Object.entries(raw.parentByPath)) {
      const cleanPath = asText(path);
      if (isSafeObjectKey(cleanPath) && cleanPath && (parent === null || typeof parent === "string")) parentByPath[cleanPath] = parent === null ? null : asText(parent);
    }
  }
  const orderByContainer: Record<string, string[]> = {};
  if (isPlainRecord(raw.orderByContainer)) {
    for (const [key, paths] of Object.entries(raw.orderByContainer)) {
      const cleanKey = asText(key);
      if (isSafeObjectKey(cleanKey) && cleanKey) orderByContainer[cleanKey] = [...new Set(asStringList(paths))];
    }
  }
  return { parentByPath, orderByContainer };
}

function cleanPathMap(input: unknown): Record<string, string> {
  if (!isPlainRecord(input)) return {};
  const output: Record<string, string> = {};
  for (const [path, value] of Object.entries(input)) {
    const cleanPath = asText(path);
    const cleanValue = asText(value);
    if (isSafeObjectKey(cleanPath) && cleanPath && cleanValue) output[cleanPath] = cleanValue;
  }
  return output;
}

function cleanSnapshots(input: unknown, allowNested = true, maxCount = 20, maxBytes?: number): PersonalSnapshot[] {
  if (!Array.isArray(input)) return [];
  const snapshots: PersonalSnapshot[] = [];
  // Histories are untrusted synced input. Limit the raw entries before cloning
  // nested structures, then apply the same byte budget used by local writes.
  for (const [snapshotIndex, raw] of (input as unknown[]).slice(-maxCount).entries()) {
    try {
      // Invalid history is non-authoritative and may be dropped. Validate one
      // retained candidate before allocating its cleaned maps/lists; this keeps
      // a hostile Undo entry from making otherwise-valid primary data read-only.
      validateRecoverySnapshot(
        raw,
        "Stored history",
        { references: 0, collectionStructures: 0, snapshots: 0 },
        allowNested ? 1 : 0,
        true,
      );
      validateLoadedSnapshotText(raw, "Stored history", createLoadTextValidationBudget(), allowNested ? 1 : 0, true);
    } catch {
      continue;
    }
    const snapshot = asUnknownRecord(raw);
    const rawAt = Number(snapshot.at);
    snapshots.push({
      label: asText(snapshot.label, "Saved organization"),
      at: Number.isFinite(rawAt) && rawAt > 0 ? rawAt : snapshotIndex + 1,
      ...(snapshot.activeTab === undefined
        ? {}
        : { activeTab: migrateMainTab(snapshot.activeTab, "curriculum") }),
      collections: cleanLayout(snapshot.collections),
      pinnedPaths: asStringList(snapshot.pinnedPaths),
      nextStudyPaths: asStringList(snapshot.nextStudyPaths),
      savedViews: cleanSavedViews(snapshot.savedViews),
      curriculumVisual: cleanCurriculumVisual(snapshot.curriculumVisual),
      manualIndexPaths: asStringList(snapshot.manualIndexPaths),
      excludedIndexPaths: asStringList(snapshot.excludedIndexPaths),
      indexGroupByPath: cleanPathMap(snapshot.indexGroupByPath),
      displayNameByPath: cleanPathMap(snapshot.displayNameByPath),
      indexGroupAliases: cleanPathMap(snapshot.indexGroupAliases),
      indexGroupOrder: [...new Set(asStringList(snapshot.indexGroupOrder))],
      portableIndex: snapshot.portableIndex === undefined ? undefined : cleanPortableIndex(snapshot.portableIndex),
      settings: snapshot.settings === undefined ? undefined : cleanSettings(snapshot.settings),
      layoutSnapshots: allowNested && snapshot.layoutSnapshots !== undefined
        ? cleanSnapshots(snapshot.layoutSnapshots, false, MAX_TRANSFER_SNAPSHOTS)
        : undefined,
    });
  }
  return limitSnapshotStack(snapshots, maxCount, maxBytes);
}

function cleanMigrationBackup(input: unknown): MigrationBackup | undefined {
  try {
    const value = optionalPlainRecord(input, "Migration backup");
    if (value.version !== 1
      || !Array.isArray(value.headings)
      || value.headings.length > MAX_TRANSFER_COLLECTIONS) return undefined;
    const validationBudget = createPluginLoadValidationBudget();
    validateRecoveryCollections(value.headings, "Migration backup headings", validationBudget.transfer);
    validateLoadedLayoutText(value.headings, "Migration backup headings", validationBudget.text);
    validateLoadedNumber(value.migratedAt, "Migration backup timestamp");
    return boundedMigrationBackup<MigrationBackup>({
      version: 1,
      headings: value.headings,
      migratedAt: cleanMigrationTimestamp(value.migratedAt),
    });
  } catch {
    return undefined;
  }
}

function cleanV2MigrationBackup(input: unknown): V2MigrationBackup | undefined {
  try {
    const value = optionalPlainRecord(input, "V2 migration backup");
    if (value.version !== 2) return undefined;
    const budget: TransferValidationBudget = { references: 0, collectionStructures: 0, snapshots: 0 };
    validateRecoveryCollections(value.collections, "V2 migration backup collections", budget);
    validateRecoveryReferenceList(value.pinnedPaths, "V2 migration backup pins", budget);
    validateRecoveryReferenceList(value.nextStudyPaths, "V2 migration backup Next list", budget);
    transferArrayLength(value.savedViews, "V2 migration backup saved views", MAX_TRANSFER_COLLECTIONS);
    ownEntryCount(value.settings, "V2 migration backup settings");
    const textBudget = createLoadTextValidationBudget();
    validateLoadedLayoutText(value.collections, "V2 migration backup collections", textBudget);
    validateLoadedTextList(value.pinnedPaths, "V2 migration backup pins", textBudget);
    validateLoadedTextList(value.nextStudyPaths, "V2 migration backup Next list", textBudget);
    validateLoadedSavedViewsText(value.savedViews, "V2 migration backup saved views", textBudget);
    validateLoadedSettingsText(value.settings, "V2 migration backup settings", textBudget);
    validateLoadedNumber(value.migratedAt, "V2 migration backup timestamp");
    return boundedMigrationBackup<V2MigrationBackup>({
      version: 2,
      migratedAt: cleanMigrationTimestamp(value.migratedAt),
      collections: cleanLayout(value.collections),
      pinnedPaths: asStringList(value.pinnedPaths),
      nextStudyPaths: asStringList(value.nextStudyPaths),
      savedViews: cleanSavedViews(value.savedViews),
      settings: asUnknownRecord(value.settings),
    });
  } catch {
    return undefined;
  }
}

function cleanSettings(input: unknown, legacyEnt = false): PluginSettings {
  const settings = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const base = legacyEnt ? ENT_CLINICAL_SETTINGS : DEFAULT_SETTINGS;
  return {
    setupComplete: settings.setupComplete === true || legacyEnt,
    workspaceMode: isWorkspaceMode(settings.workspaceMode) ? settings.workspaceMode : base.workspaceMode,
    workspaceName: asText(settings.workspaceName, base.workspaceName),
    workspaceSubtitle: asText(settings.workspaceSubtitle, base.workspaceSubtitle),
    indexLabel: asText(settings.indexLabel, base.indexLabel),
    itemSingular: asText(settings.itemSingular, base.itemSingular),
    itemPlural: asText(settings.itemPlural, base.itemPlural),
    groupLabel: asText(settings.groupLabel, base.groupLabel),
    primaryFolder: asText(settings.primaryFolder, base.primaryFolder).replace(/^\/+|\/+$/g, ""),
    inboxLabel: asText(settings.inboxLabel, base.inboxLabel),
    idProperty: asText(settings.idProperty, base.idProperty),
    groupProperty: asText(settings.groupProperty, base.groupProperty),
    parentProperty: asText(settings.parentProperty, base.parentProperty),
    templatesFolder: asText(settings.templatesFolder, base.templatesFolder).replace(/^\/+|\/+$/g, ""),
    defaultNoteFolder: asText(settings.defaultNoteFolder, base.defaultNoteFolder).replace(/^\/+|\/+$/g, ""),
    defaultNewNoteMode: isNewNoteMode(settings.defaultNewNoteMode) ? settings.defaultNewNoteMode : base.defaultNewNoteMode,
    defaultTemplatePath: asText(settings.defaultTemplatePath, base.defaultTemplatePath).replace(/^\/+/, ""),
    libraryNoteProfiles: cleanLibraryNoteProfiles(settings.libraryNoteProfiles),
    attachmentStorageMode: isAttachmentStorageMode(settings.attachmentStorageMode)
      ? settings.attachmentStorageMode
      : base.attachmentStorageMode,
    attachmentFolder: asText(settings.attachmentFolder, base.attachmentFolder).replace(/^\/+|\/+$/g, ""),
    attachmentInsertionMode: isAttachmentInsertionMode(settings.attachmentInsertionMode)
      ? settings.attachmentInsertionMode
      : base.attachmentInsertionMode,
    attachmentMarker: asText(settings.attachmentMarker, base.attachmentMarker).replace(/[\r\n]+/gu, " ").trim() || base.attachmentMarker,
    attachmentHeading: asText(settings.attachmentHeading, base.attachmentHeading)
      .replace(/[\r\n]+/gu, " ")
      .trim()
      .replace(/^#{1,6}\s+/u, "")
      .replace(/\s+#+\s*$/u, "")
      || base.attachmentHeading,
    defaultTab: migrateMainTab(settings.defaultTab, base.defaultTab),
    recentLimit: Math.max(5, Math.min(100, Number(settings.recentLimit) || base.recentLimit)),
    enableHoverPreview: settings.enableHoverPreview !== false,
    showSafetyBadges: settings.showSafetyBadges !== false,
    proposalFolder: asText(settings.proposalFolder, base.proposalFolder).replace(/^\/+|\/+$/g, ""),
    enableAdvancedCanonicalActions: settings.enableAdvancedCanonicalActions === true,
    openNoteBehavior: isOpenNoteBehavior(settings.openNoteBehavior) ? settings.openNoteBehavior : base.openNoteBehavior,
    allowClinicalVisualGroupMoves: settings.allowClinicalVisualGroupMoves === true,
    followUpCategories: cleanFollowUpCategoryDefinitions(settings.followUpCategories),
  };
}

function parseExplicitVersion(input: Record<string, unknown>, label: string): number {
  if (!Object.prototype.hasOwnProperty.call(input, "version")) return 0;
  const rawVersion = input.version;
  if (typeof rawVersion !== "number" && typeof rawVersion !== "string") {
    throw new Error(`${label} version must be a positive finite integer.`);
  }
  if (typeof rawVersion === "string" && rawVersion.length > 64) {
    throw new Error(`${label} version must be a positive finite integer.`);
  }
  const version = Number(rawVersion);
  if (!Number.isFinite(version) || !Number.isInteger(version) || version <= 0) {
    throw new Error(`${label} version must be a positive finite integer.`);
  }
  return version;
}

export function storedDataVersion(input: unknown): number {
  if (!isPlainRecord(input)) return 0;
  try {
    return parseExplicitVersion(input, "Plugin data");
  } catch {
    return 0;
  }
}

export function isRecognizedPluginData(input: unknown): boolean {
  if (!isPlainRecord(input)) return false;
  const loaded = input;
  let version = 0;
  try {
    version = parseExplicitVersion(loaded, "Plugin data");
  } catch {
    return false;
  }
  if (Object.keys(loaded).length === 0) return true;
  if (version === 1 && Array.isArray(loaded.headings)) return true;
  if (version === 2) return true;
  return [
    "collections",
    "pinnedPaths",
    "nextStudyPaths",
    "savedViews",
    "curriculumVisual",
    "manualIndexPaths",
    "excludedIndexPaths",
    "indexGroupByPath",
    "portableIndex",
    "settings",
  ].some((key) => Object.prototype.hasOwnProperty.call(loaded, key));
}

function cleanKnowledgeBaseId(input: unknown, label: string): string {
  const id = asText(input);
  if (!id || id.length > 128 || !/^[a-z0-9][a-z0-9._:@+-]*$/i.test(id) || !isSafeObjectKey(id)) {
    throw new Error(`${label} has an invalid stable ID.`);
  }
  return id;
}

function cleanTimestamp(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanSemanticRevision(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER ? value : fallback;
}

function cleanSemanticLineage(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("A knowledge-base semantic lineage is malformed.");
  const output: string[] = [];
  const used = new Set<string>();
  for (const raw of input) {
    if (!isSemanticFingerprint(raw)) throw new Error("A knowledge-base semantic lineage contains an invalid fingerprint.");
    const fingerprint = raw.toLowerCase();
    if (used.has(fingerprint)) continue;
    used.add(fingerprint);
    if (output.length < MAX_SEMANTIC_LINEAGE) output.push(fingerprint);
  }
  return output;
}

export function createKnowledgeBaseEntry(data: PluginData, id = makeId("base"), now = Date.now()): KnowledgeBaseEntry {
  // These raw legacy payloads exist only to recover the base that underwent
  // migration. Copying them into every duplicated base adds no recovery value
  // and can multiply hidden plugin-data size by the 50-base limit.
  const entryData = data.migrationBackup || data.v2MigrationBackup ? { ...data } : data;
  if (entryData !== data) {
    delete entryData.migrationBackup;
    delete entryData.v2MigrationBackup;
  }
  const entry: KnowledgeBaseEntry = {
    id: cleanKnowledgeBaseId(id, "Knowledge base"),
    createdAt: now,
    updatedAt: now,
    semanticRevision: 0,
    semanticHead: "0000000000000000",
    semanticHash: "0000000000000000",
    semanticLineage: [],
    archivedAt: null,
    data: entryData,
  };
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = entry.semanticHash;
  return entry;
}

/** Retain one bounded copy of each historical migration payload store-wide. */
function limitStoreMigrationBackups(bases: KnowledgeBaseEntry[]): void {
  let keptV1 = false;
  let keptV2 = false;
  const oldestFirst = [...bases].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  for (const entry of oldestFirst) {
    if (entry.data.migrationBackup) {
      if (keptV1) delete entry.data.migrationBackup;
      else keptV1 = true;
    }
    if (entry.data.v2MigrationBackup) {
      if (keptV2) delete entry.data.v2MigrationBackup;
      else keptV2 = true;
    }
  }
}

export function isRecognizedPluginStore(input: unknown): boolean {
  if (!isPlainRecord(input)) return false;
  const value = input;
  let version = 0;
  try {
    version = parseExplicitVersion(value, "Knowledge-base store");
  } catch {
    return false;
  }
  return value.kind === STORE_KIND && version >= MIN_RECOGNIZED_STORE_VERSION && Array.isArray(value.bases);
}

/**
 * Parse the v11+ multi-base envelope, or wrap any recognized flat v1-v10 data
 * unchanged into one base with a random provisional vault identity. A malformed envelope throws so the
 * loader can preserve the original data.json in read-only mode.
 */
export function migrateStore(input: unknown, now = Date.now()): PluginStore {
  if (!isRecognizedPluginStore(input)) {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const value = input as Record<string, unknown>;
      if (value.kind === STORE_KIND || Object.prototype.hasOwnProperty.call(value, "bases")) {
        throw new Error("The knowledge-base store has an unrecognized or damaged shape.");
      }
    }
    const hasLegacyData = Boolean(input && typeof input === "object" && !Array.isArray(input)
      && Object.keys(input as Record<string, unknown>).length > 0);
    const migrated = migrateData(input);
    return createDefaultStore(migrated, now, hasLegacyData ? migratedVaultId(migrated) : freshVaultId());
  }

  const value = input as Record<string, unknown>;
  const sourceStoreVersion = Number(value.version);
  const rawBases = value.bases as unknown[];
  if (rawBases.length === 0 || rawBases.length > MAX_KNOWLEDGE_BASES) {
    throw new Error(`The knowledge-base store must contain between 1 and ${MAX_KNOWLEDGE_BASES} bases.`);
  }
  const ids = new Set<string>();
  // One budget spans the full envelope. Without this, fifty individually
  // valid bases could multiply the documented reference/text caps fifty-fold
  // and exhaust memory on a synced mobile device.
  const envelopeValidationBudget = createPluginLoadValidationBudget();
  const bases: KnowledgeBaseEntry[] = rawBases.map((raw, index) => {
    const entry = requiredPlainRecord(raw, `Knowledge base ${index + 1}`);
    const id = cleanKnowledgeBaseId(entry.id, `Knowledge base ${index + 1}`);
    if (ids.has(id)) throw new Error(`Duplicate knowledge-base ID: ${id}`);
    ids.add(id);
    if (!isRecognizedPluginData(entry.data)) throw new Error(`Knowledge base ${id} has unrecognized data.`);
    const innerVersion = storedDataVersion(entry.data);
    if (innerVersion > DATA_VERSION) throw new Error(`Knowledge base ${id} uses unsupported data version ${innerVersion}.`);
    validateLoadedNumber(entry.createdAt, `Knowledge base ${id} createdAt`);
    validateLoadedNumber(entry.updatedAt, `Knowledge base ${id} updatedAt`);
    validateLoadedNumber(entry.archivedAt, `Knowledge base ${id} archivedAt`, true);
    const createdAt = cleanTimestamp(entry.createdAt, now);
    const updatedAt = cleanTimestamp(entry.updatedAt, createdAt);
    const semanticRevision = sourceStoreVersion >= 14
      ? cleanSemanticRevision(entry.semanticRevision, -1)
      : 0;
    if (semanticRevision < 0) throw new Error(`Knowledge base ${id} has an invalid semantic revision.`);
    const migratedData = migrateDataWithBudget(
      entry.data,
      envelopeValidationBudget,
      sourceStoreVersion < STORE_VERSION,
    );
    let semanticLineage = sourceStoreVersion >= 14
      ? cleanSemanticLineage(entry.semanticLineage)
      : [];
    const archivedValue = entry.archivedAt;
    const archivedAt = archivedValue === null || archivedValue === undefined
      ? null
      : cleanTimestamp(archivedValue, now);
    const fingerprintSource = { createdAt, archivedAt, data: migratedData };
    const semanticHash = semanticEntryFingerprint(fingerprintSource);
    const rawSemanticHead = entry.semanticHead;
    const advertisedSemanticHeadIsValid = sourceStoreVersion >= 14
      && isSemanticFingerprint(rawSemanticHead);
    let semanticHead = advertisedSemanticHeadIsValid
      ? String(rawSemanticHead).toLowerCase()
      : semanticHash;
    // Early v14 development builds did not carry `semanticHash`, and a
    // partially-written or hand-repaired envelope can contain stale causal
    // metadata. Never trust ancestry unless its advertised payload hash
    // matches the payload we just parsed. Resetting to a fresh root is
    // deliberately conservative: later merges can produce a false conflict,
    // never a false causal win.
    const impossibleSemanticAncestry = semanticLineage.includes(semanticHead)
      || (semanticRevision === 0 && semanticLineage.length > 0)
      || (semanticHead === semanticHash && semanticLineage.length > 0);
    if (sourceStoreVersion < 14
      || !advertisedSemanticHeadIsValid
      || !isSemanticFingerprint(entry.semanticHash)
      || entry.semanticHash.toLowerCase() !== semanticHash
      || impossibleSemanticAncestry) {
      semanticHead = semanticHash;
      semanticLineage = [];
    }
    return { id, createdAt, updatedAt, semanticRevision, semanticHead, semanticHash, semanticLineage, archivedAt, data: migratedData };
  });
  limitStoreMigrationBackups(bases);
  const rawDeletedBaseIds = value.deletedBaseIds;
  if (rawDeletedBaseIds !== undefined && !isPlainRecord(rawDeletedBaseIds)) {
    throw new Error("Deleted knowledge-base IDs must be a timestamp map.");
  }
  const deletedEntries = Object.entries(rawDeletedBaseIds ?? {});
  if (deletedEntries.length > MAX_DELETED_KNOWLEDGE_BASE_IDS) {
    throw new Error(`The knowledge-base store contains more than ${MAX_DELETED_KNOWLEDGE_BASE_IDS.toLocaleString()} permanent-deletion tombstones.`);
  }
  const deletedBaseIds: Record<string, number> = {};
  for (const [rawId, rawTimestamp] of deletedEntries) {
    const id = cleanKnowledgeBaseId(rawId, "Deleted knowledge base");
    validateLoadedNumber(rawTimestamp, `Deleted knowledge base ${id} timestamp`);
    const deletedAt = Number(rawTimestamp);
    if (!Number.isFinite(deletedAt) || deletedAt <= 0) throw new Error(`Deleted knowledge base ${id} has an invalid timestamp.`);
    if (ids.has(id)) throw new Error(`Deleted knowledge base ${id} is still present in the base list.`);
    deletedBaseIds[id] = deletedAt;
  }
  if (!bases.some((entry) => entry.archivedAt === null)) throw new Error("At least one knowledge base must remain available.");
  const activeBaseId = cleanKnowledgeBaseId(value.activeBaseId, "Active knowledge base");
  const active = bases.find((entry) => entry.id === activeBaseId);
  if (!active || active.archivedAt !== null) throw new Error("The active knowledge base is missing or archived.");
  const rawVaultId = asText(value.vaultId);
  const vaultId = cleanKnowledgeBaseId(
    isLegacyDeterministicMigratedVaultId(rawVaultId)
      ? migratedVaultIdFromLegacyDeterministicId(rawVaultId)
      : rawVaultId || migratedVaultIdFromInterimEnvelope({ bases, deletedBaseIds }),
    "Vault",
  );
  return { kind: STORE_KIND, version: STORE_VERSION, vaultId, activeBaseId, bases, deletedBaseIds };
}

/** Normalize Library definitions, layouts, and navigation after migration or restoration. */
export function normalizeKnowledgeBaseLibrariesAndNavigation(data: PluginData): PluginData {
  if (data.settings.workspaceMode === "ent-clinical") ensureSystemLibraries(data.portableIndex);
  else {
    // A legacy generic workspace could deliberately keep an otherwise-empty
    // fixed library as its active/default tab or in a saved view. Treat that
    // persisted navigation reference as real use so migration does not erase it.
    const referencedIds = [
      libraryIdFromTab(data.activeTab),
      libraryIdFromTab(data.settings.defaultTab),
      ...data.savedViews.map((view) => libraryIdFromTab(view.tab)),
    ];
    const existingIds = new Set(data.portableIndex.libraries.map((definition) => definition.id));
    for (const id of referencedIds) {
      if (!isLibraryKind(id) || existingIds.has(id) || data.portableIndex.libraries.length >= MAX_LIBRARIES) continue;
      data.portableIndex.libraries.push(builtinLibraryDefinition(id));
      data.portableIndex.libraryLayouts[id] ??= [];
      existingIds.add(id);
    }
  }
  reconcilePortableLibraryLayouts(data.portableIndex);
  data.settings.libraryNoteProfiles = cleanLibraryNoteProfiles(
    data.settings.libraryNoteProfiles,
    new Set(data.portableIndex.libraries.map((definition) => definition.id)),
  );
  const availableLibraryIds = new Set(data.portableIndex.libraries
    .filter((definition) => definition.archivedAt === null)
    .map((definition) => definition.id));
  const usableTab = (tab: MainTab): boolean => {
    const libraryId = libraryIdFromTab(tab);
    return libraryId === null || availableLibraryIds.has(libraryId);
  };
  if (!usableTab(data.settings.defaultTab)) data.settings.defaultTab = "curriculum";
  if (!usableTab(data.activeTab)) data.activeTab = data.settings.defaultTab;
  data.savedViews = data.savedViews.filter((view) => {
    const libraryId = libraryIdFromTab(view.tab);
    return libraryId === null || data.portableIndex.libraries.some((definition) => definition.id === libraryId);
  });
  return data;
}

export function migrateData(input: unknown): PluginData {
  return migrateDataWithBudget(input);
}

function migrateDataWithBudget(
  input: unknown,
  validationBudget = createPluginLoadValidationBudget(),
  preserveLegacyDeviceHistory = false,
): PluginData {
  if (!input || typeof input !== "object") return structuredClone(DEFAULT_DATA);
  if (!isPlainRecord(input)) throw new Error("Plugin data must be an object.");
  const loaded = input;
  const loadedVersion = parseExplicitVersion(loaded, "Plugin data");
  if (loadedVersion === 1) validateLegacyV1LoadShape(loaded, validationBudget);
  else if (loadedVersion >= 2
    || (loadedVersion === 0 && isRecognizedPluginData(loaded) && Object.keys(loaded).length > 0)) {
    validatePluginDataLoadShape(loaded, validationBudget);
  }
  // Versions newer than this plugin are read through the latest compatible
  // shape instead of being mistaken for v1. main.ts keeps them read-only.
  if (loadedVersion >= 3 || (loadedVersion === 0 && isRecognizedPluginData(loaded) && Object.keys(loaded).length > 0)) {
    const settings = cleanSettings(loaded.settings, loadedVersion > 0 && loadedVersion <= 5);
    const data: PluginData = {
      version: DATA_VERSION,
      collections: cleanLayout(loaded.collections),
      pinnedPaths: asStringList(loaded.pinnedPaths),
      nextStudyPaths: asStringList(loaded.nextStudyPaths),
      savedViews: cleanSavedViews(loaded.savedViews),
      curriculumVisual: cleanCurriculumVisual(loaded.curriculumVisual),
      manualIndexPaths: asStringList(loaded.manualIndexPaths),
      excludedIndexPaths: asStringList(loaded.excludedIndexPaths),
      indexGroupByPath: cleanPathMap(loaded.indexGroupByPath),
      displayNameByPath: cleanPathMap(loaded.displayNameByPath),
      indexGroupAliases: cleanPathMap(loaded.indexGroupAliases),
      indexGroupOrder: [...new Set(asStringList(loaded.indexGroupOrder))],
      portableIndex: cleanPortableIndex(loaded.portableIndex),
      selectedPath: asText(loaded.selectedPath),
      activeTab: migrateMainTab(loaded.activeTab, settings.defaultTab),
      settings,
      layoutSnapshots: cleanSnapshots(loaded.layoutSnapshots, true, MAX_TRANSFER_SNAPSHOTS),
      // v11-v13 kept device history inside data.json. Preserve its validated
      // newest 20 entries here long enough for main.ts to move the aggregate
      // into the vault-bound 4 MiB local payload before semantic writeback.
      undoStack: cleanSnapshots(loaded.undoStack, true, 20, preserveLegacyDeviceHistory ? MAX_PORTABLE_UNDO_BYTES : undefined),
      redoStack: cleanSnapshots(loaded.redoStack, true, 20, preserveLegacyDeviceHistory ? MAX_PORTABLE_UNDO_BYTES : undefined),
      collapsed: cleanCollapseState(loaded.collapsed),
      migrationBackup: cleanMigrationBackup(loaded.migrationBackup),
      v2MigrationBackup: cleanV2MigrationBackup(loaded.v2MigrationBackup),
    };
    return normalizeKnowledgeBaseLibrariesAndNavigation(data);
  }

  if (loadedVersion === 2) {
    const collections = cleanLayout(loaded.collections);
    const pinnedPaths = asStringList(loaded.pinnedPaths);
    const nextStudyPaths = asStringList(loaded.nextStudyPaths);
    const savedViews = cleanSavedViews(loaded.savedViews);
    const rawSettings = loaded.settings && typeof loaded.settings === "object" ? loaded.settings as Record<string, unknown> : {};
    const settings = cleanSettings(rawSettings, true);
    const data: PluginData = {
      version: DATA_VERSION,
      collections,
      pinnedPaths,
      nextStudyPaths,
      savedViews,
      curriculumVisual: cleanCurriculumVisual(loaded.curriculumVisual),
      manualIndexPaths: [],
      excludedIndexPaths: [],
      indexGroupByPath: {},
      displayNameByPath: {},
      indexGroupAliases: {},
      indexGroupOrder: [],
      portableIndex: cleanPortableIndex(loaded.portableIndex),
      selectedPath: asText(loaded.selectedPath),
      activeTab: migrateMainTab(loaded.activeTab, settings.defaultTab),
      settings,
      layoutSnapshots: cleanSnapshots(loaded.layoutSnapshots, true, MAX_TRANSFER_SNAPSHOTS),
      undoStack: [],
      redoStack: [],
      collapsed: cleanCollapseState(loaded.collapsed),
      migrationBackup: cleanMigrationBackup(loaded.migrationBackup),
      v2MigrationBackup: cleanV2MigrationBackup({
        version: 2,
        migratedAt: Date.now(),
        collections: cloneCollections(collections),
        pinnedPaths: [...pinnedPaths],
        nextStudyPaths: [...nextStudyPaths],
        savedViews: savedViews.map((view) => ({ ...view })),
        // cleanV2MigrationBackup performs its own bounded JSON clone. Avoid an
        // eager clone of untrusted legacy settings before that budget applies.
        settings: rawSettings,
      }),
    };
    return normalizeKnowledgeBaseLibrariesAndNavigation(data);
  }

  if (loadedVersion !== 1 || !Array.isArray(loaded.headings)) return structuredClone(DEFAULT_DATA);

  const oldHeadings = loaded.headings;
  const custom = oldHeadings.filter((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const heading = raw as Record<string, unknown>;
    const id = asText(heading.id);
    return heading.kind === "custom" || (!id.startsWith("auto-") && id !== "ent-cc-inbox");
  });
  const data: PluginData = {
    ...structuredClone(DEFAULT_DATA),
    collections: cleanLayout(custom),
    selectedPath: asText(loaded.selectedPath),
    settings: {
      ...ENT_CLINICAL_SETTINGS,
      followUpCategories: ENT_CLINICAL_SETTINGS.followUpCategories.map((category) => ({ ...category })),
    },
    migrationBackup: cleanMigrationBackup({ version: 1, headings: oldHeadings, migratedAt: Date.now() }),
  };
  return normalizeKnowledgeBaseLibrariesAndNavigation(data);
}

export function curriculumContainerKey(domain: string, parentPath: string | null): string {
  return parentPath ? `parent:${parentPath}` : `root:${domain.toLowerCase()}`;
}

interface CurriculumLookup {
  byDomainAndId: Map<string, VaultRecord>;
  byDomainAndLink: Map<string, VaultRecord>;
}

/**
 * Resolving a configured parent by scanning every topic is O(n²) once notes
 * actually use the parent property, so both lookups are indexed up front.
 * First-wins insertion preserves the original `Array.prototype.find` semantics.
 */
function buildCurriculumLookup(topics: VaultRecord[]): CurriculumLookup {
  const byDomainAndId = new Map<string, VaultRecord>();
  const byDomainAndLink = new Map<string, VaultRecord>();
  for (const record of topics) {
    if (record.curriculumId) {
      const idKey = `${record.domain}\u0000${record.curriculumId}`;
      if (!byDomainAndId.has(idKey)) byDomainAndId.set(idKey, record);
    }
    const basename = record.path.split("/").pop()?.replace(/\.md$/, "") ?? "";
    for (const value of [record.title, basename, ...record.aliases]) {
      const linkKey = `${record.domain}\u0000${value.toLowerCase()}`;
      if (value && !byDomainAndLink.has(linkKey)) byDomainAndLink.set(linkKey, record);
    }
  }
  return { byDomainAndId, byDomainAndLink };
}

function defaultCurriculumParent(record: VaultRecord, lookup: CurriculumLookup): string | null {
  if (record.role === "canonical" && record.curriculumId) {
    const parentId = expectedParentCurriculumId(record.curriculumId);
    if (parentId) return lookup.byDomainAndId.get(`${record.domain}\u0000${parentId}`)?.path ?? null;
  }
  if (record.parentTopic) {
    const normalized = normalizeWikiLink(record.parentTopic).toLowerCase();
    if (!normalized) return null;
    return lookup.byDomainAndLink.get(`${record.domain}\u0000${normalized}`)?.path ?? null;
  }
  return null;
}

/**
 * This is a rendering safety boundary, not a statement that deeper user data is
 * invalid. Records projected to the root because of this cap are reported to the
 * caller so the UI can disclose the altered visual hierarchy.
 */
export const MAX_CURRICULUM_DEPTH = 64;

function sortCurriculumNodes(roots: CurriculumTreeNode[], state: CurriculumVisualState, rootKey: string): void {
  const sortSiblings = (nodes: CurriculumTreeNode[], key: string): void => {
    const order = state.orderByContainer[key] ?? [];
    const positions = new Map(order.map((path, index) => [path, index]));
    nodes.sort((a, b) => {
      const aIndex = positions.get(a.record.path);
      const bIndex = positions.get(b.record.path);
      if (aIndex !== undefined || bIndex !== undefined) {
        if (aIndex === undefined) return 1;
        if (bIndex === undefined) return -1;
        if (aIndex !== bIndex) return aIndex - bIndex;
      }
      return compareRecords(a.record, b.record);
    });
  };
  // Iterative so tree depth never maps onto stack depth.
  sortSiblings(roots, rootKey);
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || node.children.length === 0) continue;
    sortSiblings(node.children, curriculumContainerKey(node.record.domain, node.record.path));
    for (const child of node.children) stack.push(child);
  }
}

/** Build the effective visual tree while safely ignoring invalid, cross-domain, and cyclic overrides. */
export function buildCurriculumTree(
  records: VaultRecord[],
  state: CurriculumVisualState,
  topicsOnly = true,
): CurriculumTreeResult {
  const topics = records.filter((record) => recordBelongsToIndex(record, topicsOnly));
  const byPath = new Map(topics.map((record) => [record.path, record]));
  const lookup = buildCurriculumLookup(topics);
  const parentByPath = new Map<string, string | null>();
  const depthLimitedPaths: string[] = [];
  for (const record of topics) {
    const hasOverride = Object.getOwnPropertyDescriptor(state.parentByPath, record.path) !== undefined;
    const requested = hasOverride ? state.parentByPath[record.path] ?? null : defaultCurriculumParent(record, lookup);
    const parent = requested ? byPath.get(requested) : undefined;
    parentByPath.set(record.path, parent && parent.path !== record.path && parent.domain === record.domain ? parent.path : null);
  }

  // Break each cycle at the first node encountered, and re-root anything nested
  // past the depth cap, so the result is always a shallow, finite rooted tree.
  for (const record of topics) {
    const seen = new Set<string>([record.path]);
    let cursor = parentByPath.get(record.path) ?? null;
    while (cursor) {
      if (seen.has(cursor)) {
        parentByPath.set(record.path, null);
        break;
      }
      if (seen.size > MAX_CURRICULUM_DEPTH) {
        parentByPath.set(record.path, null);
        depthLimitedPaths.push(record.path);
        break;
      }
      seen.add(cursor);
      cursor = parentByPath.get(cursor) ?? null;
    }
  }

  const nodes = new Map<string, CurriculumTreeNode>(topics.map((record) => [record.path, { record, children: [] }]));
  const domains = new Map<string, CurriculumDomainTree>();
  for (const record of topics) {
    const key = record.domain.toLowerCase();
    const domain = domains.get(key) ?? { domain: record.domain || "Unassigned", folderOrder: record.folderOrder, roots: [] };
    if (record.folderOrder < domain.folderOrder) domain.folderOrder = record.folderOrder;
    domains.set(key, domain);
    const node = nodes.get(record.path)!;
    const parentPath = parentByPath.get(record.path);
    const parent = parentPath ? nodes.get(parentPath) : undefined;
    if (parent) parent.children.push(node); else domain.roots.push(node);
  }
  const sorted = [...domains.values()].sort((a, b) => a.folderOrder.localeCompare(b.folderOrder, undefined, { numeric: true }) || a.domain.localeCompare(b.domain));
  for (const domain of sorted) sortCurriculumNodes(domain.roots, state, curriculumContainerKey(domain.domain, null));
  // Built after sorting so cached child order matches what the tree renders.
  const childrenByPath = new Map<string, string[]>();
  for (const [path, node] of nodes) childrenByPath.set(path, node.children.map((child) => child.record.path));
  return { domains: sorted, parentByPath, childrenByPath, nodeByPath: nodes, depthLimitedPaths };
}

export function curriculumChildPaths(tree: CurriculumTreeResult, path: string): string[] {
  return tree.childrenByPath.get(path) ?? [];
}

export function curriculumSiblingPaths(tree: CurriculumTreeResult, record: VaultRecord): string[] {
  const parentPath = tree.parentByPath.get(record.path) ?? null;
  if (parentPath) return curriculumChildPaths(tree, parentPath);
  // buildCurriculumTree merges domains case-insensitively, so a case-variant
  // record must still find the shared container it was placed in.
  const domainKey = record.domain.toLowerCase();
  return tree.domains.find((domain) => domain.domain.toLowerCase() === domainKey)?.roots.map((node) => node.record.path) ?? [];
}

export function curriculumDescendantPaths(tree: CurriculumTreeResult, path: string): Set<string> {
  const descendants = new Set<string>();
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const child of tree.childrenByPath.get(current) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      stack.push(child);
    }
  }
  return descendants;
}

export function moveCurriculumVisual(
  state: CurriculumVisualState,
  record: VaultRecord,
  parentPath: string | null,
  siblingPaths: string[],
  index: number,
): void {
  for (const [key, paths] of Object.entries(state.orderByContainer)) {
    const next = paths.filter((path) => path !== record.path);
    if (next.length > 0) state.orderByContainer[key] = next;
    else delete state.orderByContainer[key];
  }
  state.parentByPath[record.path] = parentPath;
  const ordered = [...new Set(siblingPaths)].filter((path) => path !== record.path);
  ordered.splice(Math.max(0, Math.min(index, ordered.length)), 0, record.path);
  state.orderByContainer[curriculumContainerKey(record.domain, parentPath)] = ordered;
}

export function resetCurriculumVisualPath(state: CurriculumVisualState, path: string): void {
  delete state.parentByPath[path];
  for (const [key, paths] of Object.entries(state.orderByContainer)) {
    // A custom order is container-wide. Reset the whole sibling order so this
    // record can return to its true canonical position instead of being forced
    // behind every still-explicit sibling.
    if (paths.includes(path)) delete state.orderByContainer[key];
  }
}

export function replaceCurriculumVisualPath(state: CurriculumVisualState, oldPath: string, newPath: string): boolean {
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(state.parentByPath, oldPath)) {
    state.parentByPath[newPath] = state.parentByPath[oldPath] ?? null;
    delete state.parentByPath[oldPath];
    changed = true;
  }
  for (const [path, parent] of Object.entries(state.parentByPath)) {
    if (parent === oldPath) { state.parentByPath[path] = newPath; changed = true; }
  }
  const oldKey = `parent:${oldPath}`;
  const newKey = `parent:${newPath}`;
  if (state.orderByContainer[oldKey]) {
    state.orderByContainer[newKey] = state.orderByContainer[oldKey]!;
    delete state.orderByContainer[oldKey];
    changed = true;
  }
  for (const paths of Object.values(state.orderByContainer)) {
    for (let index = 0; index < paths.length; index += 1) {
      if (paths[index] === oldPath) { paths[index] = newPath; changed = true; }
    }
  }
  return changed;
}

export function reconcileCurriculumVisual(
  state: CurriculumVisualState,
  records: VaultRecord[],
  groupByPath: Record<string, string> = {},
  topicsOnly = true,
): boolean {
  const topics = new Map(records.filter((record) => recordBelongsToIndex(record, topicsOnly)).map((record) => [record.path, record]));
  let changed = false;
  for (const [path, parentPath] of Object.entries(state.parentByPath)) {
    const record = topics.get(path);
    const parent = parentPath ? topics.get(parentPath) : undefined;
    const recordGroup = record ? groupByPath[path] || record.domain : "";
    const parentGroup = parent && parentPath ? groupByPath[parentPath] || parent.domain : "";
    if (!record || (parentPath && (!parent || parentGroup !== recordGroup || parentPath === path))) {
      delete state.parentByPath[path];
      changed = true;
    }
  }
  for (const [key, paths] of Object.entries(state.orderByContainer)) {
    const parentPath = key.startsWith("parent:") ? key.slice(7) : "";
    if (parentPath && !topics.has(parentPath)) { delete state.orderByContainer[key]; changed = true; continue; }
    const next = [...new Set(paths.filter((path) => topics.has(path)))];
    if (next.length !== paths.length) { changed = true; }
    if (next.length > 0) state.orderByContainer[key] = next;
    else { delete state.orderByContainer[key]; changed = true; }
  }
  return changed;
}

export function curriculumVisualHasChanges(state: CurriculumVisualState): boolean {
  return Object.keys(state.parentByPath).length > 0 || Object.keys(state.orderByContainer).length > 0;
}

export function visualPlacementPathSet(
  state: CurriculumVisualState,
  indexGroupByPath: Record<string, string>,
): Set<string> {
  const paths = new Set(Object.keys(state.parentByPath));
  for (const ordered of Object.values(state.orderByContainer)) {
    for (const path of ordered) paths.add(path);
  }
  for (const path of Object.keys(indexGroupByPath)) paths.add(path);
  return paths;
}

export interface ParsedQuery {
  text: string;
  terms: string[];
  tokens: Map<string, string[]>;
}

export function normalizeSearchText(value: string): string {
  // Search is intentionally forgiving of common Arabic/Persian keyboard and
  // presentation variants. This is a lookup key only; source text is untouched.
  return value
    // Compatibility decomposition also expands Arabic presentation forms such
    // as lam-alef, while canonical decomposition keeps Latin accent folding.
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0640/gu, "")
    // Apostrophes are commonly omitted or entered with a different keyboard
    // glyph in clinical eponyms. Wrapper quotes should not turn a free-text
    // search into an impossible literal punctuation match.
    .replace(/['\u2018\u2019\u02bc\u02bb\u02b9"]/gu, "")
    .replace(/[\u201c\u201d\u201e\u201f]/gu, "")
    .replace(/\u0671/gu, "\u0627")
    .replace(/[\u0649\u06cc]/gu, "\u064a")
    .replace(/\u06a9/gu, "\u0643")
    .replace(/\u0629/gu, "\u0647")
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/gu, (digit) => {
      const codePoint = digit.codePointAt(0) ?? 0;
      const value = codePoint >= 0x06f0 ? codePoint - 0x06f0 : codePoint - 0x0660;
      return String(value);
    })
    .toLowerCase();
}

export function parseQuery(query: string): ParsedQuery {
  const tokens = new Map<string, string[]>();
  const remainder = query.replace(/([a-z_]+):(?:"([^"]+)"|(\S+))/gi, (_match, key: string, quoted: string, bare: string) => {
    const normalized = key.toLowerCase();
    const values = tokens.get(normalized);
    const value = normalizeSearchText(quoted || bare || "");
    if (values) values.push(value); else tokens.set(normalized, [value]);
    return " ";
  });
  const text = normalizeSearchText(remainder.trim());
  return { text, terms: text ? text.split(/\s+/) : [], tokens };
}

export const KNOWN_QUERY_TOKENS = new Set([
  "domain", "priority", "kind", "type", "status", "review", "safety", "source", "dose", "image",
]);

export function unknownQueryTokens(query: string): string[] {
  return [...parseQuery(query).tokens.keys()].filter((key) => !KNOWN_QUERY_TOKENS.has(key));
}

function fuzzyContains(haystack: string, needle: string): boolean {
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

function tokenMatches(record: VaultRecord, key: string, values: string[]): boolean {
  return values.some((value) => {
    if (key === "domain") return normalizeSearchText(record.domain).includes(value);
    if (key === "priority") return normalizeSearchText(record.priority) === value;
    if (key === "kind" || key === "type") return record.kind === value || record.role === value || normalizeSearchText(record.topicKind).includes(value);
    if (key === "status" || key === "review") return normalizeSearchText(record.reviewStatus).includes(value) || normalizeSearchText(record.synthesisStatus).includes(value);
    if (key === "safety") return record.safetyCritical === ["true", "yes", "critical", "1"].includes(value);
    if (key === "source") return value === "gap" ? record.sourceCount === 0 || record.sourceCoverage === "none" : value === "traced" ? record.sourceCount > 0 : String(record.sourceCount) === value;
    if (key === "dose") return normalizeSearchText(record.doseStatus).includes(value);
    if (key === "image") return normalizeSearchText(record.imageStatus).includes(value);
    return false;
  });
}

interface SearchHaystack {
  text: string;
  words: string[];
}

/**
 * Normalizing a record for search is pure and comparatively expensive, so it is
 * memoized per record object. `getRecords()` rebuilds record objects whenever the
 * underlying data changes, which invalidates these entries automatically.
 */
const haystackCache = new WeakMap<VaultRecord, SearchHaystack>();

function searchHaystack(record: VaultRecord): SearchHaystack {
  const cached = haystackCache.get(record);
  if (cached) return cached;
  const text = normalizeSearchText([record.title, record.curriculumId, record.domain, record.topicKind, record.role, record.path, ...record.aliases].join(" "));
  const haystack: SearchHaystack = { text, words: text.split(/[^\p{L}\p{N}]+/u).filter(Boolean) };
  haystackCache.set(record, haystack);
  return haystack;
}

/** Match against an already-parsed query. Callers rendering many records should parse once. */
export function matchesParsedQuery(record: VaultRecord, parsed: ParsedQuery): boolean {
  for (const [key, values] of parsed.tokens) if (!tokenMatches(record, key, values)) return false;
  if (parsed.terms.length === 0) return true;
  const { text, words } = searchHaystack(record);
  return parsed.terms.every((term) => text.includes(term)
    || words.some((word) => word[0] === term[0] && fuzzyContains(word, term)));
}

/**
 * Group records for a library section. The lookup and insert key must be the
 * same value, otherwise records with an empty group are silently dropped.
 */
export function groupRecordsByGroup(records: VaultRecord[], fallbackGroup: string): Map<string, VaultRecord[]> {
  const groups = new Map<string, VaultRecord[]>();
  for (const record of records) {
    const key = record.domain || fallbackGroup;
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }
  return groups;
}

/**
 * Replace the first top-level Markdown heading. A replacer function is required:
 * a plain replacement string would expand `$&`, `$\'` and `` $` `` inside a title.
 */
export function rewriteTopLevelHeading(content: string, title: string): string {
  return content.replace(/^# .+$/m, () => `# ${title}`);
}

export function metadataHasGap(record: VaultRecord): boolean {
  if (record.kind === "topic") return record.role === "canonical" && (!record.curriculumId || !record.priority || record.sourceCount === 0);
  if (record.kind === "procedure") return !record.reviewStatus || record.sourceCount === 0;
  if (record.kind === "medication") return record.doseStatus !== "reviewed" || record.sourceCount === 0 || record.sourceCoverage === "none";
  if (record.kind === "syndrome") return record.imageStatus === "absent" || record.sourceCount === 0 || record.sourceCoverage === "none";
  return false;
}

/** Windows reserves these basenames with or without an extension. */
const RESERVED_BASENAMES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function sanitizeFileName(value: string): string {
  // `#^[]` are filesystem-legal but break Obsidian wikilinks, so they are folded
  // into `-` alongside the characters the operating system itself rejects.
  const clean = value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  // Windows reserves the segment before the first dot, so "con.jpg" is as
  // unwritable as bare "con".
  const dotIndex = clean.indexOf(".");
  const basename = dotIndex < 0 ? clean : clean.slice(0, dotIndex);
  if (!RESERVED_BASENAMES.test(basename)) return clean;
  return dotIndex < 0 ? `${clean}-note` : `${basename}-note${clean.slice(dotIndex)}`;
}

export function canonicalIdIsValid(curriculumId: string, domain: string): boolean {
  const definition = DOMAIN_DEFINITIONS.find((item) => item.name === domain);
  if (!definition) return false;
  const pattern = new RegExp(`^ENT-${definition.code}-(?:EXT-\\d{3}|\\d{3}(?:\\.\\d{1,2})?)$`);
  return pattern.test(curriculumId.trim().toUpperCase());
}

export function expectedParentCurriculumId(curriculumId: string): string {
  return curriculumId.trim().toUpperCase().match(/^(ENT-[A-Z]+-\d+)\.\d{1,2}$/)?.[1] ?? "";
}

export function isExtensionCurriculumId(curriculumId: string): boolean {
  return /^ENT-[A-Z]+-EXT-\d{3}$/.test(curriculumId.trim().toUpperCase());
}

export function resolveExpectedParentPath(curriculumId: string, domain: string, records: VaultRecord[]): string {
  const expectedId = expectedParentCurriculumId(curriculumId);
  if (!expectedId) return "";
  return records.find((record) => record.role === "canonical" && record.domain === domain && record.curriculumId.toUpperCase() === expectedId)?.path ?? "";
}

export function canonicalHierarchyIssue(value: TopicFormValue, records: VaultRecord[], currentPath = ""): string | null {
  const curriculumId = value.curriculumId.trim().toUpperCase();
  const expectedId = expectedParentCurriculumId(curriculumId);
  if (!expectedId) {
    if (isExtensionCurriculumId(curriculumId)) {
      if (!value.parentPath) return null;
      const extensionParent = records.find((record) => record.path === value.parentPath);
      if (!extensionParent || extensionParent.role !== "canonical") return "The selected extension-topic parent is no longer canonical.";
      if (extensionParent.path === currentPath) return "A topic cannot be its own parent.";
      return extensionParent.domain === value.domain ? null : "An extension topic can only use a parent from the same ENT domain.";
    }
    return value.parentPath ? `Root curriculum ID ${curriculumId} cannot have a parent topic.` : null;
  }
  const expected = records.find((record) => record.path !== currentPath
    && record.role === "canonical"
    && record.domain === value.domain
    && record.curriculumId.toUpperCase() === expectedId);
  if (!expected) return `Child curriculum ID ${curriculumId} requires the existing parent ${expectedId} in ${value.domain}.`;
  if (!value.parentPath) return `Select ${expectedId} · ${expected.title} as the parent for ${curriculumId}.`;
  const selected = records.find((record) => record.path === value.parentPath);
  if (!selected || selected.role !== "canonical") return "The selected parent is no longer a canonical topic.";
  if (selected.path === currentPath) return "A topic cannot be its own parent.";
  if (selected.domain !== value.domain || selected.curriculumId.toUpperCase() !== expectedId) {
    return `${curriculumId} must use ${expectedId} in ${value.domain} as its parent.`;
  }
  return null;
}

export function canonicalPath(
  value: Pick<TopicFormValue, "title" | "domain" | "curriculumId">,
  root = TOPIC_ROOT,
): string {
  const definition = DOMAIN_DEFINITIONS.find((item) => item.name === value.domain);
  if (!definition) return "";
  const cleanRoot = cleanVaultPath(root);
  const prefix = cleanRoot ? `${cleanRoot}/` : "";
  return `${prefix}${definition.folder}/${value.curriculumId.trim().toUpperCase()} - ${sanitizeFileName(value.title)}.md`;
}

/** Whether a placement edit leaves every filename-driving field unchanged. */
export function canonicalPathInputsUnchanged(
  record: Pick<VaultRecord, "title" | "sourceTitle" | "domain" | "curriculumId"> | null,
  value: Pick<TopicFormValue, "title" | "domain" | "curriculumId">,
): boolean {
  return record !== null
    && (record.sourceTitle || record.title) === value.title.trim()
    && record.domain === value.domain
    && record.curriculumId.toUpperCase() === value.curriculumId.trim().toUpperCase();
}

export function proposalPath(folder: string, title: string): string {
  return `${folder.replace(/^\/+|\/+$/g, "")}/${sanitizeFileName(title)}.md`;
}

export function genericNotePath(folder: string, title: string): string {
  const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
  const fileName = `${sanitizeFileName(title)}.md`;
  return cleanFolder ? `${cleanFolder}/${fileName}` : fileName;
}

export function pathIsInsideFolder(path: string, folder: string): boolean {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "");
  return !clean || path === clean || path.startsWith(`${clean}/`);
}

export function configuredGroupFromPath(path: string, primaryFolder: string, fallback = "Ungrouped"): string {
  const cleanRoot = primaryFolder.trim().replace(/^\/+|\/+$/g, "");
  const relative = cleanRoot && path.startsWith(`${cleanRoot}/`) ? path.slice(cleanRoot.length + 1) : path;
  const segments = relative.split("/");
  return segments.length > 1 ? segments[0] || fallback : fallback;
}

function yamlQuotedTemplateScalar(value: string): string {
  return JSON.stringify(value.normalize("NFC"))
    .replace(/[\u007f-\u009f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function applyTemplateTokens(
  content: string,
  title: string,
  date: string,
  time: string,
  context: TemplateTokenContext = {},
): string {
  const contextualValues = {
    title: context.title ?? title,
    id: context.id ?? "",
    category: context.category ?? "",
    parent: context.parent ?? "",
    library: context.library ?? "",
    type: context.type ?? "",
  };
  const protectedTokens: string[] = [];
  let placeholderPrefix = "\u0000KBCC_YAML_TOKEN_";
  while (content.includes(placeholderPrefix)) placeholderPrefix += "_";
  const protectedContent = content.replace(/{{\s*yaml:(title|id|category|parent|library|type)\s*}}/gi, (_match, key: string) => {
    const placeholder = `${placeholderPrefix}${protectedTokens.length}\u0000`;
    protectedTokens.push(yamlQuotedTemplateScalar(
      contextualValues[key.toLowerCase() as keyof typeof contextualValues],
    ));
    return placeholder;
  });
  let rendered = protectedContent
    .replace(/{{\s*title\s*}}/gi, () => title)
    .replace(/{{\s*date\s*}}/gi, () => date)
    .replace(/{{\s*time\s*}}/gi, () => time);
  protectedTokens.forEach((value, index) => {
    rendered = rendered.replace(`${placeholderPrefix}${index}\u0000`, () => value);
  });
  return rendered;
}

export function validateWritableFolderPath(folder: string, configDir: string): string | null {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "").normalize("NFC");
  const cleanConfig = configDir.trim().replace(/^\/+|\/+$/g, "").normalize("NFC");
  const segments = clean.split("/");
  const comparable = segments.map((segment) => segment.trim().toLocaleLowerCase());
  const comparableConfig = cleanConfig.split("/").map((segment) => segment.trim().toLocaleLowerCase());
  if (comparable.some((segment) => segment === "." || segment === "..")) return "The folder cannot contain . or .. path segments.";
  if (comparableConfig.every((segment, index) => comparable[index] === segment)) return `The folder cannot be inside ${cleanConfig}.`;
  if (comparable[0] === ".trash") return "The folder cannot be inside Obsidian's trash folder.";
  return null;
}

export function validateProposalFolderPath(folder: string, configDir: string): string | null {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "");
  const writableError = validateWritableFolderPath(clean, configDir);
  if (writableError) return writableError;
  if (!clean.startsWith("01 Inbox/")) return "The proposal folder must be a subfolder inside 01 Inbox.";
  if (isRestrictedVaultPath(`${clean}/`, configDir)) return "The proposal folder cannot use a restricted vault area.";
  return null;
}

/** Validate a template reference before any later note-creation flow reads it. */
export function validateTemplateFilePath(templatePath: string, templatesFolder: string, configDir: string): string | null {
  const cleanPath = templatePath.trim().replace(/^\/+/, "").normalize("NFC");
  const cleanRoot = templatesFolder.trim().replace(/^\/+|\/+$/g, "").normalize("NFC");
  if (!cleanPath) return "Choose a template, or switch the starting content to Empty note.";
  const pathError = validateWritableFolderPath(cleanPath, configDir);
  if (pathError) return "The template path uses a restricted vault area.";
  if (isImmutableSourcePath(cleanPath)) return "Immutable source-book files cannot be used as note templates.";
  if (cleanRoot && !pathIsInsideFolder(cleanPath, cleanRoot)) return `The template must be inside ${cleanRoot}.`;
  return null;
}

export interface CanonicalFrontmatterOptions {
  value: TopicFormValue;
  parentTopic: string;
  date: string;
  forceUnverified: boolean;
  removeProposalFields?: boolean;
}

export function applyCanonicalFrontmatter(metadata: Record<string, unknown>, options: CanonicalFrontmatterOptions): void {
  const { value, parentTopic, date, forceUnverified } = options;
  const sources = Array.isArray(metadata.sources) ? metadata.sources : [];
  const cssclasses = asStringList(metadata.cssclasses);
  metadata.type = "clinical-topic";
  metadata.title = value.title;
  metadata.curriculum_id = value.curriculumId.trim().toUpperCase();
  metadata.domain = value.domain;
  metadata.topic_kind = value.topicKind;
  metadata.parent_topic = parentTopic;
  metadata.aliases = Array.isArray(metadata.aliases) ? metadata.aliases : [];
  metadata.priority = value.priority;
  metadata.safety_critical = value.safetyCritical;
  metadata.review_status = forceUnverified ? "unverified" : asText(metadata.review_status, "unverified");
  metadata.synthesis_status = asText(metadata.synthesis_status, "empty");
  metadata.autoresearch_status = asText(metadata.autoresearch_status, "none");
  metadata.ai_lock = false;
  metadata.has_source = sources.length > 0;
  metadata.reviewed_by = forceUnverified ? null : (metadata.reviewed_by ?? null);
  metadata.reviewed_date = forceUnverified ? null : (metadata.reviewed_date ?? null);
  metadata.last_tested = metadata.last_tested ?? null;
  metadata.recall_confidence = metadata.recall_confidence ?? null;
  metadata.sources = sources;
  metadata.created = metadata.created ?? date;
  metadata.updated = date;
  metadata.cssclasses = cssclasses.includes("clinical-note") ? cssclasses : [...cssclasses, "clinical-note"];
  if (options.removeProposalFields) {
    delete metadata.proposed_domain;
    delete metadata.proposed_parent;
    delete metadata.proposal_status;
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function buildProposalMarkdown(value: Omit<TopicFormValue, "curriculumId" | "addToCollection"> & { parentTopic: string }, date: string): string {
  return `---
type: topic-proposal
title: ${yamlString(value.title)}
proposed_domain: ${yamlString(value.domain)}
proposed_parent: ${value.parentTopic ? yamlString(value.parentTopic) : ""}
topic_kind: ${yamlString(value.topicKind)}
priority: ${value.priority}
safety_critical: ${value.safetyCritical}
proposal_status: inbox
review_status: unverified
synthesis_status: empty
autoresearch_status: none
ai_lock: false
has_source: false
sources: []
created: ${date}
updated: ${date}
cssclasses:
  - clinical-note
---
# ${value.title}

> [!warning] Topic proposal — unverified
> This is an educational capture scaffold. It is not part of the canonical curriculum until the vault owner explicitly promotes it. Do not add clinical claims, doses, thresholds, or timing without source citations.

## Summary

> [!todo] One-minute synthesis
> Define the scope and consultant priorities after a full-library source audit.

## Immediate safety & red flags

> [!todo] Safety gate
> Add source-traced red flags and escalation decisions only after evidence review.

## Clinical detail

### Definition and scope

### Epidemiology and risk factors

### Mechanism or pathophysiology

### Clinical phenotype

### Differential diagnosis

### Focused assessment

### Investigations that change management

### Classification, severity, or staging

## Management

### Observation and medical management

### Indications and timing for intervention

### Multidisciplinary considerations

## Complications & follow-up

### Complications and rescue plan

### Surveillance, outcomes, and counselling

## Figures & tables

## Contradictions

## Autoresearch

> [!autoresearch] External research options
> None drafted.

## Evidence & practice

### Published evidence

### Local or institutional practice

### Personal technical pearl

## Sources

- No source-traced synthesis yet.

## Change history

| Date | Change | Source or reason |
|---|---|---|
| ${date} | Topic proposal created from the knowledge base command center | User capture; unverified |
`;
}

export function buildCanonicalMarkdown(value: CanonicalTopicData, date: string): string {
  return `---
type: clinical-topic
title: ${yamlString(value.title)}
curriculum_id: ${yamlString(value.curriculumId.trim().toUpperCase())}
domain: ${yamlString(value.domain)}
topic_kind: ${yamlString(value.topicKind)}
parent_topic: ${value.parentTopic ? yamlString(value.parentTopic) : ""}
aliases: []
priority: ${value.priority}
safety_critical: ${value.safetyCritical}
review_status: unverified
synthesis_status: empty
autoresearch_status: none
ai_lock: false
has_source: false
reviewed_by:
reviewed_date:
last_tested:
recall_confidence:
sources: []
created: ${date}
updated: ${date}
cssclasses:
  - clinical-note
---
# ${value.title}

> [!warning] Unverified clinical-topic scaffold
> This educational note contains no clinically approved content. Complete a source-traced build and keep it unverified until the vault owner reviews it.

## Summary

> [!todo] One-minute synthesis
> Add a source-traced consultant summary.

## Immediate safety & red flags

> [!todo] Safety gate
> Add source-traced red flags and escalation decisions only after evidence review.

## Clinical detail

### Definition and scope

### Epidemiology and risk factors

### Mechanism or pathophysiology

### Clinical phenotype

### Differential diagnosis

### Focused assessment

### Investigations that change management

### Classification, severity, or staging

## Management

### Observation and medical management

### Indications and timing for intervention

### Multidisciplinary considerations

## Complications & follow-up

### Complications and rescue plan

### Surveillance, outcomes, and counselling

## Figures & tables

## Contradictions

## Autoresearch

> [!autoresearch] External research options
> None drafted.

## Evidence & practice

### Published evidence

### Local or institutional practice

### Personal technical pearl

## Sources

- No source-traced synthesis yet.

## Change history

| Date | Change | Source or reason |
|---|---|---|
| ${date} | Canonical topic scaffold created from the knowledge base command center | User-authorized creation; unverified |
`;
}

export function isImmutableSourcePath(path: string): boolean {
  return path.startsWith("05 Sources/_books/");
}

export function isRestrictedVaultPath(path: string, configDir: string): boolean {
  const cleanConfigDir = configDir.replace(/^\/+|\/+$/g, "");
  return [`${cleanConfigDir}/`, "05 Sources/", "90 Templates/", "91 Assets/", "99 Archive/"].some((root) => path.startsWith(root));
}

export interface IndexDiagnostic {
  id: string;
  kind: "missing-note" | "duplicate-membership" | "broken-parent" | "orphaned-group" | "invalid-visual-parent" | "depth-limit";
  title: string;
  detail: string;
  path?: string;
}

export function buildIndexDiagnostics(data: PluginData, records: VaultRecord[], existingPaths: Set<string>): IndexDiagnostic[] {
  const diagnostics: IndexDiagnostic[] = [];
  const excludedPaths = new Set(data.excludedIndexPaths);
  const addMissing = (path: string, owner: string): void => {
    if (!path || existingPaths.has(path) || isPortablePlaceholderPath(path)) return;
    diagnostics.push({ id: `missing:${owner}:${path}`, kind: "missing-note", title: "Missing note reference", detail: `${owner} references a note that no longer exists.`, path });
  };
  for (const path of data.manualIndexPaths) addMissing(path, "Manual index membership");
  for (const path of data.excludedIndexPaths) addMissing(path, "Hidden index membership");
  for (const path of data.pinnedPaths) addMissing(path, "Pins");
  for (const path of data.nextStudyPaths) addMissing(path, "Next list");
  const inspect = (paths: string[], owner: string): void => {
    paths.forEach((path) => addMissing(path, owner));
    const counts = new Map<string, number>();
    for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
    for (const [path, count] of counts) {
      if (count > 1) diagnostics.push({ id: `duplicate:${owner}:${path}`, kind: "duplicate-membership", title: "Duplicate collection membership", detail: `${owner} contains the same note ${count} times.`, path });
    }
  };
  const inspectLayoutNode = (node: LayoutHeading | LayoutSubheading, titlePath: string): void => {
    inspect(node.subjects, `Collection “${titlePath}”`);
    for (const subheading of childSubheadings(node)) {
      inspectLayoutNode(subheading, `${titlePath} / ${subheading.title}`);
    }
  };
  for (const heading of data.collections) inspectLayoutNode(heading, heading.title);

  const topicsOnly = data.settings.workspaceMode === "ent-clinical";
  const topics = records.filter((record) => recordBelongsToIndex(record, topicsOnly));
  const topicByPath = new Map(topics.map((record) => [record.path, record]));
  // Resolve configured parents with exactly the lookup buildCurriculumTree
  // uses (exact domain key, plain lowercased link, first entry wins). A looser
  // derivation here would call parents healthy that the tree cannot resolve.
  const lookup = buildCurriculumLookup(topics);
  for (const record of topics) {
    if (!record.parentTopic) continue;
    const normalized = normalizeWikiLink(record.parentTopic).toLowerCase();
    const match = normalized ? lookup.byDomainAndLink.get(`${record.domain}\u0000${normalized}`) : undefined;
    if (!match || match.path === record.path) {
      diagnostics.push({ id: `parent:${record.path}`, kind: "broken-parent", title: "Unresolved configured parent", detail: `The configured parent “${record.parentTopic}” does not resolve inside ${record.domain}.`, path: record.path });
    }
  }
  for (const [path, group] of Object.entries(data.indexGroupByPath)) {
    if (!existingPaths.has(path)) addMissing(path, `Visual group “${group}”`);
    else if (!topicByPath.has(path) && !excludedPaths.has(path)) diagnostics.push({ id: `group:${path}`, kind: "orphaned-group", title: "Orphaned visual group override", detail: `The note has a visual group override (“${group}”) but is not currently indexed.`, path });
  }
  for (const [path, parentPath] of Object.entries(data.curriculumVisual.parentByPath)) {
    if (!parentPath) continue;
    const record = topicByPath.get(path);
    const parent = topicByPath.get(parentPath);
    const recordGroup = record ? data.indexGroupByPath[path] || record.domain : "";
    const parentGroup = parent ? data.indexGroupByPath[parentPath] || parent.domain : "";
    if (!record || !parent || recordGroup !== parentGroup || path === parentPath) {
      diagnostics.push({ id: `visual-parent:${path}`, kind: "invalid-visual-parent", title: "Invalid visual parent", detail: `The visual parent ${parentPath} is missing, self-referential, or in another group.`, path });
    }
  }
  const depthLimited = buildCurriculumTree(records, data.curriculumVisual, topicsOnly).depthLimitedPaths;
  if (depthLimited.length > 0) {
    diagnostics.push({
      id: "depth-limit",
      kind: "depth-limit",
      title: "Hierarchy rendering depth exceeded",
      detail: `${depthLimited.length} ${depthLimited.length === 1 ? "record was" : "records were"} shown at the top level because the hierarchy exceeds ${MAX_CURRICULUM_DEPTH} rendered levels. Parent properties and notes were not changed.`,
      path: depthLimited[0],
    });
  }
  return diagnostics;
}

export interface WorkspaceConfig {
  kind: "knowledge-base-command-center-workspace";
  version: 1 | 2;
  exportedAt: string;
  settings: PluginSettings;
  indexGroupOrder: string[];
}

export function createWorkspaceConfig(data: PluginData, exportedAt: string): WorkspaceConfig {
  const settings = structuredClone(data.settings);
  settings.libraryNoteProfiles = cleanLibraryNoteProfiles(
    settings.libraryNoteProfiles,
    new Set(data.portableIndex.libraries
      .filter((definition) => definition.archivedAt === null)
      .map((definition) => definition.id)),
  );
  return {
    kind: "knowledge-base-command-center-workspace",
    version: 2,
    exportedAt,
    settings,
    indexGroupOrder: [...data.indexGroupOrder],
  };
}

/**
 * Transfer files need stricter destination-aware validation than persisted
 * plugin data. Keep bounded path strings exactly as supplied until the import
 * preflight can reject an unsafe folder or atomically reset an unusable
 * template. Normal load/migration continues to use cleanLibraryNoteProfiles.
 */
function parseTransferredLibraryNoteProfiles(input: unknown): LibraryNoteProfiles {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_LIBRARIES) {
    throw new Error(`Workspace Library creation profiles exceed the ${MAX_LIBRARIES}-Library limit.`);
  }
  const profiles = cleanLibraryNoteProfiles(input);
  for (const [libraryId, raw] of entries) {
    if (!isValidLibraryId(libraryId)) continue;
    const value = asUnknownRecord(raw);
    const retainPath = (key: "folder" | "templatePath"): void => {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return;
      const path = value[key];
      if (typeof path !== "string") {
        throw new Error(`Workspace Library profile ${libraryId} ${key} must be text.`);
      }
      if (path.length > MAX_LIBRARY_NOTE_PROFILE_PATH_LENGTH) {
        throw new Error(`Workspace Library profile ${libraryId} ${key} is too long.`);
      }
      const profile = profiles[libraryId] ?? {};
      profile[key] = path;
      profiles[libraryId] = profile;
    };
    retainPath("folder");
    retainPath("templatePath");
  }
  return profiles;
}

export function parseWorkspaceConfig(input: unknown): WorkspaceConfig {
  if (!input || typeof input !== "object") throw new Error("The selected file is not a Command Center workspace configuration.");
  const value = input as Record<string, unknown>;
  if (value.kind !== "knowledge-base-command-center-workspace"
    || (value.version !== 1 && value.version !== 2)) {
    throw new Error("Unsupported Command Center workspace configuration.");
  }
  transferArrayLength(value.indexGroupOrder, "Workspace group order", MAX_TRANSFER_COLLECTIONS);
  const rawSettings = asUnknownRecord(value.settings);
  const settings = { ...cleanSettings(rawSettings), setupComplete: true };
  if (!settings.followUpCategories.some((category) => !category.archived)) {
    throw new Error("Workspace Quick Append settings must contain at least one active category.");
  }
  settings.libraryNoteProfiles = parseTransferredLibraryNoteProfiles(rawSettings.libraryNoteProfiles);
  return {
    kind: "knowledge-base-command-center-workspace",
    version: value.version,
    exportedAt: asText(value.exportedAt),
    settings,
    indexGroupOrder: [...new Set(asStringList(value.indexGroupOrder))],
  };
}

export interface PersonalBackup extends PersonalOrganizationState {
  kind: "ent-vault-command-center-personal-backup";
  /** v10 introduced nested collection/library subheadings; v9 layouts stay flat. */
  version: 10;
  exportedAt: string;
  /** Stable identity of the vault that created this exact-path recovery. */
  sourceVaultId: string;
  /** Stable identity and visible name of the knowledge base that owns it. */
  sourceBaseId: string;
  sourceBaseName: string;
  /** Recovery is never allowed to cross the generic/clinical preset boundary. */
  sourceWorkspaceMode: WorkspaceMode | "";
  layoutSnapshots: PersonalSnapshot[];
  portableIndex: PortableIndexLocalState;
}

function cleanRecoveryVaultId(value: unknown): string {
  const id = asText(value);
  if (id.length > 200 || /[\p{Cc}\p{Cf}]/u.test(id)) {
    throw new Error("The recovery backup contains an invalid source-vault identity.");
  }
  return id;
}

function cleanRecoveryBaseName(value: unknown): string {
  const name = asText(value);
  if (name.length > 100 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new Error("The recovery backup contains an invalid source knowledge-base name.");
  }
  return name;
}

export function createPersonalBackup(
  data: PluginData,
  exportedAt: string,
  sourceVaultId: string,
  sourceBaseId: string,
  sourceBaseName: string,
): PersonalBackup {
  const cleanSourceVaultId = cleanRecoveryVaultId(sourceVaultId);
  if (!cleanSourceVaultId) throw new Error("A vault identity is required to create same-vault recovery data.");
  const cleanSourceBaseId = cleanKnowledgeBaseId(sourceBaseId, "Source knowledge base");
  const cleanSourceBaseName = cleanRecoveryBaseName(sourceBaseName);
  if (!cleanSourceBaseName) throw new Error("A knowledge-base name is required to create same-base recovery data.");
  return {
    kind: "ent-vault-command-center-personal-backup",
    version: 10,
    exportedAt,
    sourceVaultId: cleanSourceVaultId,
    sourceBaseId: cleanSourceBaseId,
    sourceBaseName: cleanSourceBaseName,
    sourceWorkspaceMode: data.settings.workspaceMode,
    ...clonePersonalOrganization(data),
    layoutSnapshots: cleanSnapshots(data.layoutSnapshots, true, MAX_TRANSFER_SNAPSHOTS),
    portableIndex: clonePortableIndex(data.portableIndex),
  };
}

interface TransferValidationBudget {
  references: number;
  collectionStructures: number;
  snapshots: number;
}

interface PluginLoadValidationBudget {
  transfer: TransferValidationBudget;
  text: LoadTextValidationBudget;
}

function createPluginLoadValidationBudget(): PluginLoadValidationBudget {
  return {
    transfer: { references: 0, collectionStructures: 0, snapshots: 0 },
    text: createLoadTextValidationBudget(),
  };
}

function optionalPlainRecord(input: unknown, label: string): Record<string, unknown> {
  if (input === undefined) return {};
  if (!isPlainRecord(input)) throw new Error(`${label} must be an object.`);
  return input;
}

function requiredPlainRecord(input: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(input)) throw new Error(`${label} must be an object.`);
  return input;
}

function transferArrayLength(input: unknown, label: string, max: number): number {
  if (input === undefined) return 0;
  if (!Array.isArray(input)) throw new Error(`${label} must be a list.`);
  if (input.length > max) throw new Error(`${label} has too many entries.`);
  return input.length;
}

function addTransferReferenceCount(budget: TransferValidationBudget, count: number, label: string): void {
  if (count > MAX_TRANSFER_LIST_ITEMS) throw new Error(`${label} has too many references.`);
  if (budget.references > MAX_TRANSFER_TOTAL_REFERENCES - count) {
    throw new Error(`The recovery backup contains more than ${MAX_TRANSFER_TOTAL_REFERENCES.toLocaleString()} references.`);
  }
  budget.references += count;
}

function validateRecoveryReferenceList(input: unknown, label: string, budget: TransferValidationBudget): void {
  if (input === undefined) return;
  if (typeof input === "string") {
    addTransferReferenceCount(budget, input.trim() ? 1 : 0, label);
    return;
  }
  if (!Array.isArray(input)) throw new Error(`${label} must be a text list.`);
  input.forEach((item, index) => {
    if (typeof item !== "string") throw new Error(`${label} ${index + 1} must be text.`);
  });
  const count = input.length;
  addTransferReferenceCount(budget, count, label);
}

function ownEntryCount(input: unknown, label: string): number {
  if (input === undefined) return 0;
  if (!isPlainRecord(input)) throw new Error(`${label} must be an object.`);
  let count = 0;
  for (const key in input) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    count += 1;
    if (count > MAX_TRANSFER_LIST_ITEMS) throw new Error(`${label} has too many entries.`);
  }
  return count;
}

function validateRecoveryPortableIndex(input: unknown, label: string, budget: TransferValidationBudget): void {
  const value = optionalPlainRecord(input, label);
  addTransferReferenceCount(
    budget,
    transferArrayLength(value.groups, `${label} groups`, MAX_TRANSFER_COLLECTIONS),
    `${label} groups`,
  );
  addTransferReferenceCount(
    budget,
    transferArrayLength(value.subjects, `${label} subjects`, MAX_TRANSFER_LIST_ITEMS),
    `${label} subjects`,
  );
  addTransferReferenceCount(
    budget,
    transferArrayLength(value.libraries, `${label} libraries`, MAX_LIBRARIES),
    `${label} libraries`,
  );
  addTransferReferenceCount(budget, ownEntryCount(value.resolvedPathBySubjectId, `${label} note bindings`), `${label} note bindings`);
  validateRecoveryReferenceList(value.relinkableSubjectIds, `${label} relinkable identities`, budget);
  const libraryLayouts = optionalPlainRecord(value.libraryLayouts, `${label} library layouts`);
  const libraryLayoutCount = ownEntryCount(libraryLayouts, `${label} library layouts`);
  if (libraryLayoutCount > MAX_LIBRARIES) {
    throw new Error(`${label} has too many library layouts.`);
  }
  addTransferReferenceCount(budget, libraryLayoutCount, `${label} library layouts`);
  for (const [libraryId, layout] of Object.entries(libraryLayouts)) {
    if (!isValidLibraryId(libraryId)) throw new Error(`${label} has an invalid library ID.`);
    validateRecoveryCollections(layout, `${label} ${libraryId} layout`, budget);
  }
}

function validateRecoveryVisual(input: unknown, label: string, budget: TransferValidationBudget): void {
  const value = optionalPlainRecord(input, label);
  const parentCount = ownEntryCount(value.parentByPath, `${label} parent map`);
  addTransferReferenceCount(budget, parentCount, `${label} parent map`);
  const orders = optionalPlainRecord(value.orderByContainer, `${label} order containers`);
  addTransferReferenceCount(
    budget,
    ownEntryCount(orders, `${label} order containers`),
    `${label} order containers`,
  );
  for (const [key, paths] of Object.entries(orders)) {
    validateRecoveryReferenceList(paths, `${label} order ${key}`, budget);
  }
}

function addCollectionStructureCount(budget: TransferValidationBudget, count: number): void {
  if (budget.collectionStructures > MAX_TRANSFER_COLLECTIONS - count) {
    throw new Error(`The recovery backup contains too many collections and subheadings.`);
  }
  budget.collectionStructures += count;
}

/**
 * Layout content nested beyond MAX_LAYOUT_DEPTH is merged upward by the
 * cleaners instead of persisting as structure, so it still consumes the shared
 * transfer budget. The walk is iterative so hostile nesting depth never maps
 * onto stack depth.
 */
function validateTooDeepRecoveryLayout(input: unknown, label: string, budget: TransferValidationBudget): void {
  const stack: unknown[] = [input];
  while (stack.length > 0) {
    const list = stack.pop();
    addCollectionStructureCount(budget, transferArrayLength(list, label, MAX_TRANSFER_COLLECTIONS));
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const node = requiredPlainRecord(raw, label);
      validateRecoveryReferenceList(node.subjects, `${label} subjects`, budget);
      if (node.subheadings !== undefined) stack.push(node.subheadings);
    }
  }
}

function validateRecoveryCollections(
  input: unknown,
  label: string,
  budget: TransferValidationBudget,
  depth = 1,
  listLabel = label,
): void {
  addCollectionStructureCount(budget, transferArrayLength(input, listLabel, MAX_TRANSFER_COLLECTIONS));
  if (!Array.isArray(input)) return;
  for (const [index, raw] of input.entries()) {
    const nodeLabel = `${label} ${index + 1}`;
    const node = requiredPlainRecord(raw, nodeLabel);
    validateRecoveryReferenceList(node.subjects, `${nodeLabel} subjects`, budget);
    if (node.subheadings === undefined) continue;
    if (depth >= MAX_LAYOUT_DEPTH) {
      validateTooDeepRecoveryLayout(node.subheadings, `${nodeLabel} nested subheadings`, budget);
      continue;
    }
    validateRecoveryCollections(
      node.subheadings,
      `${nodeLabel} subheading`,
      budget,
      depth + 1,
      `${nodeLabel} subheadings`,
    );
  }
}

function validateRecoverySnapshot(
  input: unknown,
  label: string,
  budget: TransferValidationBudget,
  remainingSnapshotLevels: number,
  trimExcessSnapshots = false,
): void {
  const value = requiredPlainRecord(input, label);
  validateRecoveryCollections(value.collections, `${label} collections`, budget);
  for (const [key, list] of [
    ["pins", value.pinnedPaths],
    ["Next list", value.nextStudyPaths],
    ["manual index", value.manualIndexPaths],
    ["hidden index", value.excludedIndexPaths],
  ] as const) validateRecoveryReferenceList(list, `${label} ${key}`, budget);
  addTransferReferenceCount(
    budget,
    transferArrayLength(value.savedViews, `${label} saved views`, MAX_TRANSFER_COLLECTIONS),
    `${label} saved views`,
  );
  addTransferReferenceCount(
    budget,
    transferArrayLength(value.indexGroupOrder, `${label} group order`, MAX_TRANSFER_COLLECTIONS),
    `${label} group order`,
  );
  addTransferReferenceCount(budget, ownEntryCount(value.indexGroupByPath, `${label} visual groups`), `${label} visual groups`);
  addTransferReferenceCount(budget, ownEntryCount(value.displayNameByPath, `${label} display names`), `${label} display names`);
  addTransferReferenceCount(budget, ownEntryCount(value.indexGroupAliases, `${label} group aliases`), `${label} group aliases`);
  validateRecoveryVisual(value.curriculumVisual, `${label} visual hierarchy`, budget);
  if (value.portableIndex !== undefined) validateRecoveryPortableIndex(value.portableIndex, `${label} portable index`, budget);
  if (remainingSnapshotLevels <= 0 || value.layoutSnapshots === undefined) return;
  const rawSnapshots = value.layoutSnapshots;
  const retainedSnapshots = trimExcessSnapshots && Array.isArray(rawSnapshots)
    ? rawSnapshots.slice(-MAX_TRANSFER_SNAPSHOTS)
    : rawSnapshots;
  const snapshotCount = transferArrayLength(retainedSnapshots, `${label} named snapshots`, MAX_TRANSFER_SNAPSHOTS);
  if (budget.snapshots > MAX_TRANSFER_SNAPSHOTS - snapshotCount) throw new Error(`The recovery backup contains too many named snapshots.`);
  budget.snapshots += snapshotCount;
  if (!Array.isArray(retainedSnapshots)) return;
  retainedSnapshots.forEach((snapshot, index) => validateRecoverySnapshot(
    snapshot,
    `${label} snapshot ${index + 1}`,
    budget,
    remainingSnapshotLevels - 1,
    trimExcessSnapshots,
  ));
}

interface LoadTextValidationBudget {
  bytes: number;
  byteLengthByText: Map<string, number>;
}

function createLoadTextValidationBudget(): LoadTextValidationBudget {
  return { bytes: 0, byteLengthByText: new Map<string, number>() };
}

function loadedTextByteLength(input: string, budget: LoadTextValidationBudget): number {
  // Cache only a bounded set of long repeated values (for example a hostile
  // repeated 10k title). Short unique IDs are cheaper to scan than to retain
  // in another potentially 250k-entry map.
  const cacheable = input.length >= 256;
  const cached = cacheable ? budget.byteLengthByText.get(input) : undefined;
  if (cached !== undefined) return cached;
  let asciiOnly = true;
  for (let index = 0; index < input.length; index += 1) {
    if (input.charCodeAt(index) > 0x7f) {
      asciiOnly = false;
      break;
    }
  }
  const bytes = asciiOnly ? input.length : snapshotUtf8Encoder.encode(input).byteLength;
  if (cacheable && budget.byteLengthByText.size < 1_024) budget.byteLengthByText.set(input, bytes);
  return bytes;
}

function validateLoadedBoolean(input: unknown, label: string): void {
  if (input !== undefined && typeof input !== "boolean") throw new Error(`${label} must be true or false.`);
}

function validateLoadedNumber(input: unknown, label: string, allowNull = false): void {
  if (input === undefined || (allowNull && input === null)) return;
  if (typeof input !== "number" && typeof input !== "string") {
    throw new Error(`${label} must be a number${allowNull ? " or null" : ""}.`);
  }
  if (typeof input === "string" && input.length > 64) throw new Error(`${label} is too long.`);
  if (!Number.isFinite(Number(input))) throw new Error(`${label} must be a finite number.`);
}

function validateLoadedText(
  input: unknown,
  label: string,
  budget: LoadTextValidationBudget,
  allowNull = false,
): void {
  if (input === undefined || (allowNull && input === null)) return;
  if (typeof input !== "string") throw new Error(`${label} must be text${allowNull ? " or null" : ""}.`);
  // Bound individual raw allocations, then charge their exact raw UTF-8 size.
  // Counting pre-trim bytes prevents whitespace padding from evading the
  // envelope cap, while UTF-8 measurement correctly charges multibyte text.
  if (input.length > MAX_TRANSFER_TEXT_LENGTH) {
    throw new Error(`${label} is longer than ${MAX_TRANSFER_TEXT_LENGTH.toLocaleString()} characters.`);
  }
  const bytes = loadedTextByteLength(input, budget);
  if (budget.bytes > MAX_TRANSFER_TOTAL_TEXT_LENGTH - bytes) {
    throw new Error(`Plugin data contains more than ${MAX_TRANSFER_TOTAL_TEXT_LENGTH.toLocaleString()} bytes of text.`);
  }
  budget.bytes += bytes;
}

function validateLoadedTextList(input: unknown, label: string, budget: LoadTextValidationBudget): void {
  if (input === undefined) return;
  if (typeof input === "string") {
    validateLoadedText(input, label, budget);
    return;
  }
  if (!Array.isArray(input)) throw new Error(`${label} must be a text list.`);
  input.forEach((item, index) => {
    if (typeof item !== "string") throw new Error(`${label} ${index + 1} must be text.`);
    validateLoadedText(item, `${label} ${index + 1}`, budget);
  });
}

function validateLoadedTextMap(
  input: unknown,
  label: string,
  budget: LoadTextValidationBudget,
  allowNullValues = false,
): void {
  const value = optionalPlainRecord(input, label);
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    validateLoadedText(key, `${label} key`, budget);
    validateLoadedText(value[key], `${label} value`, budget, allowNullValues);
  }
}

function validateLoadedLayoutNodeText(
  node: Record<string, unknown>,
  nodeLabel: string,
  budget: LoadTextValidationBudget,
): void {
  validateLoadedText(node.id, `${nodeLabel} ID`, budget);
  validateLoadedText(node.title, `${nodeLabel} title`, budget);
  validateLoadedTextList(node.subjects, `${nodeLabel} subjects`, budget);
  if (node.collapsed !== undefined && typeof node.collapsed !== "boolean") {
    throw new Error(`${nodeLabel} collapsed state must be true or false.`);
  }
}

/**
 * Text nested beyond MAX_LAYOUT_DEPTH still enters the store through the
 * cleaners' merge-up, so it is charged against the shared text budget with an
 * iterative walk. Structural bounding happened in the transfer validator.
 */
function validateTooDeepLayoutText(input: unknown, label: string, budget: LoadTextValidationBudget): void {
  const stack: unknown[] = [input];
  while (stack.length > 0) {
    const list = stack.pop();
    if (!Array.isArray(list)) throw new Error(`${label} must be a list.`);
    for (const raw of list) {
      const node = requiredPlainRecord(raw, label);
      validateLoadedLayoutNodeText(node, label, budget);
      if (node.subheadings === undefined) continue;
      if (!Array.isArray(node.subheadings)) throw new Error(`${label} subheadings must be a list.`);
      stack.push(node.subheadings);
    }
  }
}

function validateLoadedLayoutText(
  input: unknown,
  label: string,
  budget: LoadTextValidationBudget,
  depth = 1,
): void {
  if (input === undefined) return;
  if (!Array.isArray(input)) throw new Error(`${label} must be a list.`);
  input.forEach((rawNode, index) => {
    const nodeLabel = `${label} ${index + 1}`;
    const node = requiredPlainRecord(rawNode, nodeLabel);
    validateLoadedLayoutNodeText(node, nodeLabel, budget);
    if (node.subheadings === undefined) return;
    if (!Array.isArray(node.subheadings)) throw new Error(`${nodeLabel} subheadings must be a list.`);
    if (depth >= MAX_LAYOUT_DEPTH) {
      validateTooDeepLayoutText(node.subheadings, `${nodeLabel} nested subheadings`, budget);
      return;
    }
    validateLoadedLayoutText(node.subheadings, `${nodeLabel} subheading`, budget, depth + 1);
  });
}

function validateLoadedSavedViewsText(input: unknown, label: string, budget: LoadTextValidationBudget): void {
  if (input === undefined) return;
  if (!Array.isArray(input)) throw new Error(`${label} must be a list.`);
  input.forEach((rawView, index) => {
    const viewLabel = `${label} ${index + 1}`;
    const view = requiredPlainRecord(rawView, viewLabel);
    validateLoadedText(view.id, `${viewLabel} ID`, budget);
    validateLoadedText(view.name, `${viewLabel} name`, budget);
    validateLoadedText(view.tab, `${viewLabel} tab`, budget);
    validateLoadedText(view.query, `${viewLabel} query`, budget);
  });
}

function validateLoadedVisualText(input: unknown, label: string, budget: LoadTextValidationBudget): void {
  const value = optionalPlainRecord(input, label);
  validateLoadedTextMap(value.parentByPath, `${label} parent map`, budget, true);
  const orders = optionalPlainRecord(value.orderByContainer, `${label} order containers`);
  for (const key in orders) {
    if (!Object.prototype.hasOwnProperty.call(orders, key)) continue;
    validateLoadedText(key, `${label} order-container key`, budget);
    validateLoadedTextList(orders[key], `${label} order`, budget);
  }
}

function validateLoadedSettingsText(input: unknown, label: string, budget: LoadTextValidationBudget): void {
  const settings = optionalPlainRecord(input, label);
  for (const key of [
    "workspaceMode",
    "workspaceName",
    "workspaceSubtitle",
    "indexLabel",
    "itemSingular",
    "itemPlural",
    "groupLabel",
    "primaryFolder",
    "inboxLabel",
    "idProperty",
    "groupProperty",
    "parentProperty",
    "templatesFolder",
    "defaultNoteFolder",
    "defaultNewNoteMode",
    "defaultTemplatePath",
    "attachmentStorageMode",
    "attachmentFolder",
    "attachmentInsertionMode",
    "attachmentMarker",
    "attachmentHeading",
    "defaultTab",
    "proposalFolder",
    "openNoteBehavior",
  ] as const) validateLoadedText(settings[key], `${label} ${key}`, budget);
  for (const key of [
    "setupComplete",
    "enableHoverPreview",
    "showSafetyBadges",
    "enableAdvancedCanonicalActions",
    "allowClinicalVisualGroupMoves",
  ] as const) validateLoadedBoolean(settings[key], `${label} ${key}`);
  validateLoadedNumber(settings.recentLimit, `${label} recentLimit`);

  const categories = settings.followUpCategories;
  if (categories !== undefined) {
    if (!Array.isArray(categories)) throw new Error(`${label} followUpCategories must be a list.`);
    if (categories.length > MAX_FOLLOW_UP_CATEGORIES) {
      throw new Error(`${label} followUpCategories has too many entries.`);
    }
    categories.forEach((rawCategory, index) => {
      const category = requiredPlainRecord(rawCategory, `${label} followUpCategories ${index + 1}`);
      validateLoadedText(category.id, `${label} followUpCategories ${index + 1} ID`, budget);
      validateLoadedText(category.label, `${label} followUpCategories ${index + 1} label`, budget);
      validateLoadedText(category.style, `${label} followUpCategories ${index + 1} style`, budget);
      validateLoadedBoolean(category.includeDate, `${label} followUpCategories ${index + 1} includeDate`);
      validateLoadedBoolean(category.archived, `${label} followUpCategories ${index + 1} archived`);
    });
  }

  const profiles = optionalPlainRecord(settings.libraryNoteProfiles, `${label} libraryNoteProfiles`);
  let profileCount = 0;
  for (const [libraryId, rawProfile] of Object.entries(profiles)) {
    profileCount += 1;
    if (profileCount > MAX_LIBRARIES) throw new Error(`${label} libraryNoteProfiles has too many entries.`);
    validateLoadedText(libraryId, `${label} libraryNoteProfiles key`, budget);
    const profile = requiredPlainRecord(rawProfile, `${label} libraryNoteProfiles ${libraryId}`);
    validateLoadedText(profile.folder, `${label} libraryNoteProfiles ${libraryId} folder`, budget);
    validateLoadedText(profile.mode, `${label} libraryNoteProfiles ${libraryId} mode`, budget);
    validateLoadedText(profile.templatePath, `${label} libraryNoteProfiles ${libraryId} templatePath`, budget);
  }
}

function validateLoadedPortableIndexText(input: unknown, label: string, budget: LoadTextValidationBudget): void {
  const value = optionalPlainRecord(input, label);
  validateLoadedNumber(value.version, `${label} version`);
  if (value.groups !== undefined && !Array.isArray(value.groups)) throw new Error(`${label} groups must be a list.`);
  if (Array.isArray(value.groups)) value.groups.forEach((rawGroup, index) => {
    const group = requiredPlainRecord(rawGroup, `${label} group ${index + 1}`);
    validateLoadedText(group.id, `${label} group ${index + 1} ID`, budget);
    validateLoadedText(group.title, `${label} group ${index + 1} title`, budget);
    validateLoadedNumber(group.order, `${label} group ${index + 1} order`);
  });
  if (value.subjects !== undefined && !Array.isArray(value.subjects)) throw new Error(`${label} subjects must be a list.`);
  if (Array.isArray(value.subjects)) value.subjects.forEach((rawSubject, index) => {
    const subjectLabel = `${label} subject ${index + 1}`;
    const subject = requiredPlainRecord(rawSubject, subjectLabel);
    for (const key of ["id", "title", "groupId", "parentId", "configuredId", "recordKind", "libraryId"] as const) {
      validateLoadedText(subject[key], `${subjectLabel} ${key}`, budget, key === "parentId" || key === "libraryId");
    }
    validateLoadedNumber(subject.order, `${subjectLabel} order`);
    validateLoadedBoolean(subject.indexed, `${subjectLabel} indexed`);
  });
  validateLoadedTextMap(value.resolvedPathBySubjectId, `${label} note bindings`, budget);
  validateLoadedTextList(value.relinkableSubjectIds, `${label} relinkable identities`, budget);
  if (value.libraries !== undefined && !Array.isArray(value.libraries)) throw new Error(`${label} libraries must be a list.`);
  if (Array.isArray(value.libraries)) value.libraries.forEach((rawLibrary, index) => {
    const libraryLabel = `${label} library ${index + 1}`;
    const library = requiredPlainRecord(rawLibrary, libraryLabel);
    for (const key of ["id", "name", "singularName", "icon", "sourceKind"] as const) {
      validateLoadedText(library[key], `${libraryLabel} ${key}`, budget, key === "sourceKind");
    }
    validateLoadedNumber(library.order, `${libraryLabel} order`);
    validateLoadedNumber(library.archivedAt, `${libraryLabel} archivedAt`, true);
  });
  const layouts = optionalPlainRecord(value.libraryLayouts, `${label} library layouts`);
  for (const key in layouts) {
    if (!Object.prototype.hasOwnProperty.call(layouts, key)) continue;
    validateLoadedText(key, `${label} library-layout ID`, budget);
    validateLoadedLayoutText(layouts[key], `${label} ${key} layout`, budget);
  }
}

function validateLoadedSnapshotText(
  input: unknown,
  label: string,
  budget: LoadTextValidationBudget,
  remainingSnapshotLevels: number,
  trimExcessSnapshots = false,
): void {
  const value = requiredPlainRecord(input, label);
  validateLoadedText(value.label, `${label} label`, budget);
  validateLoadedText(value.activeTab, `${label} active tab`, budget);
  validateLoadedNumber(value.at, `${label} timestamp`);
  validateLoadedLayoutText(value.collections, `${label} collections`, budget);
  for (const [name, list] of [
    ["pins", value.pinnedPaths],
    ["Next list", value.nextStudyPaths],
    ["manual index", value.manualIndexPaths],
    ["hidden index", value.excludedIndexPaths],
    ["group order", value.indexGroupOrder],
  ] as const) validateLoadedTextList(list, `${label} ${name}`, budget);
  validateLoadedSavedViewsText(value.savedViews, `${label} saved views`, budget);
  validateLoadedVisualText(value.curriculumVisual, `${label} visual hierarchy`, budget);
  validateLoadedTextMap(value.indexGroupByPath, `${label} visual groups`, budget);
  validateLoadedTextMap(value.displayNameByPath, `${label} display names`, budget);
  validateLoadedTextMap(value.indexGroupAliases, `${label} group aliases`, budget);
  if (value.portableIndex !== undefined) validateLoadedPortableIndexText(value.portableIndex, `${label} portable index`, budget);
  if (value.settings !== undefined) validateLoadedSettingsText(value.settings, `${label} settings`, budget);
  if (remainingSnapshotLevels <= 0 || value.layoutSnapshots === undefined) return;
  if (!Array.isArray(value.layoutSnapshots)) throw new Error(`${label} named snapshots must be a list.`);
  const snapshots = trimExcessSnapshots
    ? value.layoutSnapshots.slice(-MAX_TRANSFER_SNAPSHOTS)
    : value.layoutSnapshots;
  snapshots.forEach((snapshot, index) => validateLoadedSnapshotText(
    snapshot,
    `${label} snapshot ${index + 1}`,
    budget,
    remainingSnapshotLevels - 1,
    trimExcessSnapshots,
  ));
}

function validatePluginDataLoadShape(
  input: Record<string, unknown>,
  validationBudget = createPluginLoadValidationBudget(),
): void {
  const { transfer: transferBudget, text: textBudget } = validationBudget;
  parseExplicitVersion(input, "Plugin data");
  // Named snapshots and Undo/Redo are independently bounded and safely
  // droppable by cleanSnapshots. Primary organization is authoritative and
  // therefore fails read-only instead of being silently truncated.
  validateRecoverySnapshot(input, "Plugin data", transferBudget, 0);
  const collapsed = optionalPlainRecord(input.collapsed, "Plugin data collapsed state");
  for (const [name, list] of [
    ["collapsed curriculum domains", collapsed.curriculumDomains],
    ["collapsed curriculum nodes", collapsed.curriculumNodes],
    ["collapsed queues", collapsed.queues],
  ] as const) validateRecoveryReferenceList(list, `Plugin data ${name}`, transferBudget);

  validateLoadedSnapshotText(input, "Plugin data", textBudget, 0);
  validateLoadedText(input.selectedPath, "Plugin data selected path", textBudget);
  validateLoadedTextList(collapsed.curriculumDomains, "Plugin data collapsed curriculum domains", textBudget);
  validateLoadedTextList(collapsed.curriculumNodes, "Plugin data collapsed curriculum nodes", textBudget);
  validateLoadedTextList(collapsed.queues, "Plugin data collapsed queues", textBudget);
}

function validateLegacyV1LoadShape(
  input: Record<string, unknown>,
  validationBudget = createPluginLoadValidationBudget(),
): void {
  if (!Array.isArray(input.headings)) throw new Error("Legacy plugin headings must be a list.");
  validateRecoveryCollections(input.headings, "Legacy plugin headings", validationBudget.transfer);
  validateLoadedLayoutText(input.headings, "Legacy plugin headings", validationBudget.text);
  validateLoadedText(input.selectedPath, "Legacy plugin selected path", validationBudget.text);
}

function validatePersonalBackupTransferShape(value: Record<string, unknown>): void {
  const budget: TransferValidationBudget = { references: 0, collectionStructures: 0, snapshots: 0 };
  validateRecoverySnapshot(value, "Recovery", budget, 2);
  validateLoadedSnapshotText(value, "Recovery", createLoadTextValidationBudget(), 2);
}

export function parsePersonalBackup(input: unknown): PersonalBackup {
  if (!input || typeof input !== "object") throw new Error("The selected file is not a Command Center backup.");
  const value = input as Record<string, unknown>;
  const sourceVersion = Number(value.version);
  // Older backups (v1-v9 flat layouts) import fine; newer formats than this
  // build refuse cleanly so nested organization is never silently flattened.
  if (value.kind !== "ent-vault-command-center-personal-backup" || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(sourceVersion)) {
    throw new Error("Unsupported Command Center backup format.");
  }
  const sourceVaultId = cleanRecoveryVaultId(value.sourceVaultId);
  if (sourceVersion >= 6 && !sourceVaultId) {
    throw new Error("This recovery backup is missing its required source-vault identity.");
  }
  const sourceBaseId = sourceVersion >= 7 ? cleanKnowledgeBaseId(value.sourceBaseId, "Source knowledge base") : "";
  const sourceBaseName = sourceVersion >= 7 ? cleanRecoveryBaseName(value.sourceBaseName) : "";
  const sourceWorkspaceMode = sourceVersion >= 7 && isWorkspaceMode(value.sourceWorkspaceMode)
    ? value.sourceWorkspaceMode
    : "";
  if (sourceVersion >= 7 && (!sourceBaseName || !sourceWorkspaceMode)) {
    throw new Error("This recovery backup is missing its required source knowledge-base identity or preset.");
  }
  validatePersonalBackupTransferShape(value);
  return {
    kind: "ent-vault-command-center-personal-backup",
    version: 10,
    exportedAt: asText(value.exportedAt),
    sourceVaultId,
    sourceBaseId,
    sourceBaseName,
    sourceWorkspaceMode,
    collections: cleanLayout(value.collections),
    pinnedPaths: asStringList(value.pinnedPaths),
    nextStudyPaths: asStringList(value.nextStudyPaths),
    savedViews: cleanSavedViews(value.savedViews),
    curriculumVisual: cleanCurriculumVisual(value.curriculumVisual),
    manualIndexPaths: asStringList(value.manualIndexPaths),
    excludedIndexPaths: asStringList(value.excludedIndexPaths),
    indexGroupByPath: cleanPathMap(value.indexGroupByPath),
    displayNameByPath: cleanPathMap(value.displayNameByPath),
    indexGroupAliases: cleanPathMap(value.indexGroupAliases),
    indexGroupOrder: [...new Set(asStringList(value.indexGroupOrder))],
    layoutSnapshots: cleanSnapshots(value.layoutSnapshots, true, MAX_TRANSFER_SNAPSHOTS),
    portableIndex: cleanPortableIndex(value.portableIndex),
  };
}

function serializedUtf8Bytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Device-local state is not serializable.");
  return new TextEncoder().encode(serialized).byteLength;
}

function strictLocalString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function strictLocalStringList(input: unknown, label: string, maxCount = MAX_TRANSFER_LIST_ITEMS): string[] {
  if (!Array.isArray(input) || input.length > maxCount) throw new Error(`${label} is malformed or too large.`);
  return input.map((value, index) => strictLocalString(value, `${label} entry ${index + 1}`, 4096));
}

/**
 * Layout structure IDs are not knowledge-base IDs: cleanLayout keeps any safe
 * object key and the portable importer accepts letters from any script, so
 * `_favourites` and Arabic IDs are both legitimately persisted. Rejecting one
 * of them here would discard this device's whole route/history payload.
 */
function localLayoutStructureId(input: unknown, label: string): string {
  const id = asText(input);
  if (!id || id.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(id) || !isSafeObjectKey(id)) {
    throw new Error(`${label} has an invalid stable ID.`);
  }
  return id;
}

function parseLocalCollapsedLayoutNodes(
  input: unknown,
  label: string,
  budget: { structures: number },
  depth: number,
): CollapsedLayoutItemState[] {
  if (!Array.isArray(input) || input.length > MAX_TRANSFER_COLLECTIONS) {
    throw new Error(`${label} is malformed or too large.`);
  }
  const output: CollapsedLayoutItemState[] = [];
  for (const [index, raw] of input.entries()) {
    const nodeName = depth === 1 ? `heading ${index + 1}` : `subheading ${index + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} ${nodeName} is malformed.`);
    const value = raw as Record<string, unknown>;
    const id = localLayoutStructureId(value.id, `${label} ${nodeName}`);
    if (typeof value.collapsed !== "boolean") throw new Error(`${label} ${nodeName} is malformed.`);
    // Pre-nesting device payloads always wrote a subheadings list on headings
    // but omitted it on subheading leaves; both shapes remain accepted.
    if (value.subheadings === undefined ? depth === 1 : !Array.isArray(value.subheadings)) {
      throw new Error(`${label} ${nodeName} is malformed.`);
    }
    budget.structures += 1;
    if (budget.structures > MAX_TRANSFER_COLLECTIONS) throw new Error("Device-local collapse state is too large.");
    // Collapse state nested beyond the layout depth cap cannot correspond to
    // any cleaned layout node; it is dropped instead of failing the payload.
    const subheadings = Array.isArray(value.subheadings) && depth < MAX_LAYOUT_DEPTH
      ? parseLocalCollapsedLayoutNodes(value.subheadings, label, budget, depth + 1)
      : [];
    output.push({ id, collapsed: value.collapsed, subheadings });
  }
  return output;
}

function parseLocalCollapsedLayout(
  input: unknown,
  label: string,
  budget: { structures: number },
): CollapsedLayoutItemState[] {
  return parseLocalCollapsedLayoutNodes(input, label, budget, 1);
}

function parseDeviceHistory(input: unknown, label: string): PersonalSnapshot[] {
  if (!Array.isArray(input) || input.length > 20) throw new Error(`${label} is malformed or too large.`);
  const budget: TransferValidationBudget = { references: 0, collectionStructures: 0, snapshots: 0 };
  for (const [index, raw] of input.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} entry ${index + 1} is malformed.`);
    const snapshot = raw as Record<string, unknown>;
    if (typeof snapshot.label !== "string"
      || !Number.isFinite(Number(snapshot.at))
      || !Array.isArray(snapshot.collections)
      || !Array.isArray(snapshot.pinnedPaths)
      || !Array.isArray(snapshot.nextStudyPaths)
      || !Array.isArray(snapshot.savedViews)
      || !snapshot.curriculumVisual
      || typeof snapshot.curriculumVisual !== "object") {
      throw new Error(`${label} entry ${index + 1} is malformed.`);
    }
    validateRecoverySnapshot(snapshot, `${label} entry ${index + 1}`, budget, 2);
  }
  const cleaned = cleanSnapshots(input);
  if (cleaned.length !== input.length) throw new Error(`${label} could not be parsed without dropping entries.`);
  return cleaned;
}

/** Strictly parse one device's state; malformed input is discarded by the caller. */
export function parseDeviceLocalPluginState(input: unknown): DeviceLocalPluginState {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Device-local state is malformed.");
  if (serializedUtf8Bytes(input) > MAX_DEVICE_LOCAL_STATE_BYTES) throw new Error("Device-local state is too large.");
  const value = input as Record<string, unknown>;
  if (value.version !== DEVICE_LOCAL_STATE_VERSION || !Array.isArray(value.bases) || value.bases.length > MAX_KNOWLEDGE_BASES) {
    throw new Error("Device-local state has an unsupported or malformed shape.");
  }
  const vaultId = cleanKnowledgeBaseId(value.vaultId, "Device-local vault");
  const activeBaseId = cleanKnowledgeBaseId(value.activeBaseId, "Device-local active knowledge base");
  const baseIds = new Set<string>();
  const budget = { structures: 0 };
  const bases: DeviceLocalKnowledgeBaseState[] = value.bases.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Device-local base ${index + 1} is malformed.`);
    const base = raw as Record<string, unknown>;
    const baseId = cleanKnowledgeBaseId(base.baseId, `Device-local base ${index + 1}`);
    if (baseIds.has(baseId)) throw new Error(`Device-local base ${baseId} is duplicated.`);
    baseIds.add(baseId);
    if (!base.view || typeof base.view !== "object" || Array.isArray(base.view)) throw new Error(`Device-local base ${baseId} is malformed.`);
    const view = base.view as Record<string, unknown>;
    if (!isMainTab(view.activeTab)) throw new Error(`Device-local base ${baseId} has an invalid active tab.`);
    const collapsed = view.collapsed as Record<string, unknown> | null;
    if (!collapsed || typeof collapsed !== "object" || Array.isArray(collapsed)) {
      throw new Error(`Device-local base ${baseId} has malformed collapse state.`);
    }
    if (!Array.isArray(view.libraryLayouts) || view.libraryLayouts.length > MAX_LIBRARIES) {
      throw new Error(`Device-local base ${baseId} has malformed Library collapse state.`);
    }
    const libraryIds = new Set<string>();
    const libraryLayouts: CollapsedLibraryLayoutState[] = view.libraryLayouts.map((rawLibrary, libraryIndex) => {
      if (!rawLibrary || typeof rawLibrary !== "object" || Array.isArray(rawLibrary)) {
        throw new Error(`Device-local base ${baseId} Library ${libraryIndex + 1} is malformed.`);
      }
      const library = rawLibrary as Record<string, unknown>;
      if (!isValidLibraryId(library.libraryId) || libraryIds.has(library.libraryId)) {
        throw new Error(`Device-local base ${baseId} has an invalid or duplicate Library ID.`);
      }
      libraryIds.add(library.libraryId);
      return {
        libraryId: library.libraryId,
        headings: parseLocalCollapsedLayout(library.headings, `Device-local base ${baseId} Library ${library.libraryId}`, budget),
      };
    });
    return {
      baseId,
      view: {
        selectedPath: strictLocalString(view.selectedPath, `Device-local base ${baseId} selected path`, 4096),
        activeTab: view.activeTab,
        collapsed: {
          curriculumDomains: strictLocalStringList(collapsed.curriculumDomains, `Device-local base ${baseId} collapsed domains`),
          curriculumNodes: strictLocalStringList(collapsed.curriculumNodes, `Device-local base ${baseId} collapsed nodes`),
          queues: strictLocalStringList(collapsed.queues, `Device-local base ${baseId} collapsed queues`, 1000),
        },
        collections: parseLocalCollapsedLayout(view.collections, `Device-local base ${baseId} collections`, budget),
        libraryLayouts,
        undoStack: parseDeviceHistory(view.undoStack, `Device-local base ${baseId} Undo history`),
        redoStack: parseDeviceHistory(view.redoStack, `Device-local base ${baseId} Redo history`),
      },
    };
  });
  return { version: DEVICE_LOCAL_STATE_VERSION, vaultId, activeBaseId, bases };
}

export interface DeviceLocalPluginStateBuildResult {
  state: DeviceLocalPluginState;
  historyTruncated: boolean;
  viewStateTruncated: boolean;
}

/**
 * Build a bounded localStorage payload. Under aggregate pressure, discard the
 * oldest history depth across bases first while preserving a suffix containing
 * each stack's newest entries. Ties are deterministic and favor retaining the
 * active base. Route/collapse data is reduced only after all history is gone.
 */
export function createDeviceLocalPluginStateWithReport(store: PluginStore): DeviceLocalPluginStateBuildResult {
  const available = store.bases.filter((entry) => entry.archivedAt === null);
  const activeBaseId = available.some((entry) => entry.id === store.activeBaseId)
    ? store.activeBaseId
    : available[0]?.id ?? store.bases[0]?.id ?? DEFAULT_KNOWLEDGE_BASE_ID;
  const state: DeviceLocalPluginState = {
    version: DEVICE_LOCAL_STATE_VERSION,
    vaultId: store.vaultId,
    activeBaseId,
    bases: store.bases.map((entry) => ({ baseId: entry.id, view: capturePluginViewState(entry.data) })),
  };
  if (serializedUtf8Bytes(state) <= MAX_DEVICE_LOCAL_STATE_BYTES) {
    return { state, historyTruncated: false, viewStateTruncated: false };
  }

  type HistoryCandidate = {
    activeRank: number;
    baseId: string;
    index: number;
    recencyDepth: number;
    snapshot: PersonalSnapshot;
    stack: "redo" | "undo";
  };
  const candidates: HistoryCandidate[] = [];
  const originalHistory = new Map(state.bases.map((base) => [base.baseId, {
    undo: [...base.view.undoStack],
    redo: [...base.view.redoStack],
  }]));
  for (const base of state.bases) {
    for (const [stack, snapshots] of [
      ["undo", base.view.undoStack],
      ["redo", base.view.redoStack],
    ] as const) {
      snapshots.forEach((snapshot, index) => candidates.push({
        activeRank: base.baseId === activeBaseId ? 1 : 0,
        baseId: base.baseId,
        index,
        recencyDepth: snapshots.length - index,
        snapshot,
        stack,
      }));
    }
  }
  candidates.sort((left, right) => right.recencyDepth - left.recencyDepth
    || left.activeRank - right.activeRank
    || left.baseId.localeCompare(right.baseId)
    || left.stack.localeCompare(right.stack)
    || left.index - right.index);
  const rank = new Map(candidates.map((candidate, index) => [candidate.snapshot, index]));
  const applyHistoryDropCount = (dropCount: number): void => {
    for (const base of state.bases) {
      const original = originalHistory.get(base.baseId);
      base.view.undoStack = (original?.undo ?? []).filter((snapshot) => (rank.get(snapshot) ?? candidates.length) >= dropCount);
      base.view.redoStack = (original?.redo ?? []).filter((snapshot) => (rank.get(snapshot) ?? candidates.length) >= dropCount);
    }
  };
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    applyHistoryDropCount(middle);
    if (serializedUtf8Bytes(state) <= MAX_DEVICE_LOCAL_STATE_BYTES) high = middle;
    else low = middle + 1;
  }
  applyHistoryDropCount(low);
  const historyTruncated = low > 0;
  if (serializedUtf8Bytes(state) <= MAX_DEVICE_LOCAL_STATE_BYTES) {
    return { state, historyTruncated, viewStateTruncated: false };
  }

  const active = state.bases.find((base) => base.baseId === activeBaseId);
  const viewStateTruncated = state.bases.length > (active ? 1 : 0);
  state.bases = active ? [active] : [];
  if (serializedUtf8Bytes(state) <= MAX_DEVICE_LOCAL_STATE_BYTES) {
    return { state, historyTruncated, viewStateTruncated };
  }
  if (active) {
    active.view.selectedPath = "";
    active.view.collapsed = structuredClone(DEFAULT_DATA.collapsed);
    active.view.collections = [];
    active.view.libraryLayouts = [];
  }
  if (serializedUtf8Bytes(state) > MAX_DEVICE_LOCAL_STATE_BYTES) throw new Error("Device-local state could not be bounded safely.");
  return { state, historyTruncated, viewStateTruncated: true };
}

/** Build the ordinary bounded localStorage payload without migration metadata. */
export function createDeviceLocalPluginState(store: PluginStore): DeviceLocalPluginState {
  return createDeviceLocalPluginStateWithReport(store).state;
}

export interface PersonalBackupVaultCheck {
  identity: "verified" | "legacy-unverified";
  baseIdentity: "verified" | "legacy-unverified" | "cross-base-override";
  referencedPathCount: number;
  existingPathCount: number;
  requiredPathCount: number;
}

function collectPersonalBackupPaths(backup: PersonalBackup): string[] {
  const paths = new Set<string>();
  const add = (path: string | null | undefined): void => {
    const clean = path?.trim() ?? "";
    if (clean && !isPortablePlaceholderPath(clean)) paths.add(clean);
  };
  const addVisual = (visual: CurriculumVisualState): void => {
    for (const [child, parent] of Object.entries(visual.parentByPath)) {
      add(child);
      add(parent);
    }
    for (const orderedPaths of Object.values(visual.orderByContainer)) orderedPaths.forEach(add);
  };
  const seenSnapshots = new Set<PersonalSnapshot>();
  const addState = (state: Pick<PersonalBackup, "collections" | "pinnedPaths" | "nextStudyPaths" | "curriculumVisual" | "manualIndexPaths" | "excludedIndexPaths" | "indexGroupByPath" | "displayNameByPath" | "layoutSnapshots" | "portableIndex">): void => {
    const addLayoutNode = (node: LayoutHeading | LayoutSubheading): void => {
      node.subjects.forEach(add);
      for (const subheading of childSubheadings(node)) addLayoutNode(subheading);
    };
    for (const collection of state.collections) addLayoutNode(collection);
    for (const list of [state.pinnedPaths, state.nextStudyPaths, state.manualIndexPaths, state.excludedIndexPaths]) list.forEach(add);
    Object.keys(state.indexGroupByPath).forEach(add);
    Object.keys(state.displayNameByPath).forEach(add);
    addVisual(state.curriculumVisual);
    Object.values(state.portableIndex.resolvedPathBySubjectId).forEach(add);
    for (const snapshot of state.layoutSnapshots) {
      if (seenSnapshots.has(snapshot)) continue;
      seenSnapshots.add(snapshot);
      addState({
        ...snapshot,
        portableIndex: snapshot.portableIndex ?? {
          version: 3,
          groups: [],
          subjects: [],
          resolvedPathBySubjectId: {},
          libraries: [],
          libraryLayouts: emptyLibraryLayouts(),
        },
        layoutSnapshots: snapshot.layoutSnapshots ?? [],
      });
    }
  };
  addState(backup);
  return [...paths];
}

/**
 * Exact-path recovery is deliberately non-portable. Current backups use a
 * stable opaque persisted vault identity. Identity-less legacy backups use a
 * conservative destination-path preflight and remain explicitly unverified.
 */
export function assertPersonalBackupMatchesVault(
  backup: PersonalBackup,
  currentVaultId: string,
  pathExists?: (path: string) => boolean,
  currentBaseId = "",
  currentBaseName = "",
  currentWorkspaceMode: WorkspaceMode | "" = "",
  allowCrossBaseRecovery = false,
): PersonalBackupVaultCheck {
  const destinationVaultId = cleanRecoveryVaultId(currentVaultId);
  if (!destinationVaultId) {
    throw new Error("The current vault identity is unavailable. Restart Obsidian before restoring recovery data.");
  }
  if (backup.sourceVaultId) {
    if (backup.sourceVaultId !== destinationVaultId) {
      throw new Error("This recovery was created by a different Obsidian vault and cannot be restored here. Use the portable Index blueprint and Collections sections for cross-vault transfer.");
    }
    if (backup.sourceBaseId) {
      const destinationBaseId = cleanKnowledgeBaseId(currentBaseId, "Current knowledge base");
      const destinationBaseName = cleanRecoveryBaseName(currentBaseName);
      if (!destinationBaseName || !currentWorkspaceMode) {
        throw new Error("The current knowledge-base identity or preset is unavailable. Restart Obsidian before restoring recovery data.");
      }
      if (backup.sourceWorkspaceMode !== currentWorkspaceMode) {
        throw new Error(`This recovery was created for the ${backup.sourceWorkspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} preset and cannot be restored into the ${currentWorkspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} preset. Use the portable Index blueprint and Collections sections for cross-preset transfer.`);
      }
      if (backup.sourceBaseId !== destinationBaseId) {
        if (!allowCrossBaseRecovery) {
          throw new Error(`This recovery belongs to knowledge base “${backup.sourceBaseName}” (${backup.sourceBaseId}), not “${destinationBaseName}” (${destinationBaseId}). A separate cross-base restore confirmation is required.`);
        }
        return {
          identity: "verified",
          baseIdentity: "cross-base-override",
          referencedPathCount: 0,
          existingPathCount: 0,
          requiredPathCount: 0,
        };
      }
      return {
        identity: "verified",
        baseIdentity: "verified",
        referencedPathCount: 0,
        existingPathCount: 0,
        requiredPathCount: 0,
      };
    }
    if (!allowCrossBaseRecovery) {
      throw new Error("This v1–v6 recovery has no knowledge-base identity or preset. A separate base-unverified restore confirmation is required.");
    }
    return {
      identity: "verified",
      baseIdentity: "legacy-unverified",
      referencedPathCount: 0,
      existingPathCount: 0,
      requiredPathCount: 0,
    };
  }

  const paths = collectPersonalBackupPaths(backup);
  if (paths.length === 0) {
    if (!allowCrossBaseRecovery) {
      throw new Error("This v1–v6 recovery has no knowledge-base identity or preset. A separate base-unverified restore confirmation is required.");
    }
    return { identity: "legacy-unverified", baseIdentity: "legacy-unverified", referencedPathCount: 0, existingPathCount: 0, requiredPathCount: 0 };
  }
  if (!pathExists) throw new Error("This legacy recovery requires a destination-vault path preflight before it can be restored.");
  const existingPathCount = paths.reduce((count, path) => count + (pathExists(path) ? 1 : 0), 0);
  const requiredPathCount = Math.ceil(paths.length / 2);
  if (existingPathCount < requiredPathCount) {
    throw new Error(`This identity-less legacy recovery matches ${existingPathCount} of ${paths.length} unique referenced paths in the current vault. At least ${requiredPathCount} (50%) must exist before restoration, so it cannot be restored here.`);
  }
  if (!allowCrossBaseRecovery) {
    throw new Error("This v1–v6 recovery has no knowledge-base identity or preset. A separate base-unverified restore confirmation is required.");
  }
  return { identity: "legacy-unverified", baseIdentity: "legacy-unverified", referencedPathCount: paths.length, existingPathCount, requiredPathCount };
}

export function roleLabel(record: Pick<VaultRecord, "role" | "kind">): string {
  if (record.role === "canonical") return "Canonical topic";
  if (record.role === "supporting") return "Supporting note";
  if (record.role === "proposal") return "Topic proposal";
  if (record.role === "vault-note") return "Vault note";
  if (record.role === "placeholder") return "No note yet";
  return record.kind[0]?.toUpperCase() + record.kind.slice(1);
}

export function shouldHandleRowShortcut(eventTargetIsRow: boolean, key: string): boolean {
  return eventTargetIsRow && ["Enter", "m", "M", "p", "P"].includes(key);
}
