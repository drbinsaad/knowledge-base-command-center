export const TOPIC_ROOT = "03 Clinical Topics/";
export const PROCEDURE_ROOT = "04 Procedures/";
export const MEDICATION_ROOT = "06 Clinical Tools/Medications/";
export const SYNDROME_ROOT = "06 Clinical Tools/Syndromes/";
export const DEFAULT_PROPOSAL_FOLDER = "01 Inbox/ENT Topic Proposals";
export const DATA_VERSION = 10;
export const STORE_VERSION = 11;
export const STORE_KIND = "knowledge-base-command-center-store";
export const MAX_KNOWLEDGE_BASES = 50;
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

export type RecordKind = "topic" | "procedure" | "medication" | "syndrome" | "proposal" | "note";
export type RecordRole = "canonical" | "supporting" | "library" | "proposal" | "vault-note" | "placeholder";
export type MainTab = "curriculum" | "inbox" | "collections" | "queues" | "procedures" | "medications" | "syndromes";
export type OpenNoteBehavior = "new-tab" | "same-tab" | "split";
export type WorkspaceMode = "generic" | "ent-clinical";
export type NewNoteMode = "empty" | "template";

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
}

/**
 * Portable identities and local bindings. `resolvedPathBySubjectId` is private
 * vault state and is deliberately omitted by the portable export serializer.
 */
export interface PortableIndexLocalState {
  version: 1;
  groups: PortableGroupDefinition[];
  subjects: PortableSubjectDefinition[];
  resolvedPathBySubjectId: Record<string, string>;
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

export interface LayoutSubheading {
  id: string;
  title: string;
  collapsed: boolean;
  subjects: string[];
}

export interface LayoutHeading {
  id: string;
  title: string;
  collapsed: boolean;
  subjects: string[];
  subheadings: LayoutSubheading[];
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

export interface PersonalSnapshot {
  label: string;
  at: number;
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
  defaultTab: MainTab;
  recentLimit: number;
  enableHoverPreview: boolean;
  showSafetyBadges: boolean;
  proposalFolder: string;
  enableAdvancedCanonicalActions: boolean;
  openNoteBehavior: OpenNoteBehavior;
  allowClinicalVisualGroupMoves: boolean;
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
  version: 10;
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
  archivedAt: number | null;
  /** Existing v10 workspace payload, deliberately kept intact per base. */
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
  defaultTab: "curriculum",
  recentLimit: 25,
  enableHoverPreview: true,
  showSafetyBadges: true,
  proposalFolder: "Inbox",
  enableAdvancedCanonicalActions: false,
  openNoteBehavior: "new-tab",
  allowClinicalVisualGroupMoves: false,
};

export const ENT_CLINICAL_SETTINGS: PluginSettings = {
  ...DEFAULT_SETTINGS,
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
  proposalFolder: DEFAULT_PROPOSAL_FOLDER,
};

export const DEFAULT_DATA: PluginData = {
  version: 10,
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
  portableIndex: { version: 1, groups: [], subjects: [], resolvedPathBySubjectId: {} },
  selectedPath: "",
  activeTab: "curriculum",
  settings: { ...DEFAULT_SETTINGS },
  layoutSnapshots: [],
  undoStack: [],
  redoStack: [],
  collapsed: {
    curriculumDomains: [],
    curriculumNodes: [],
    queues: [...DEFAULT_COLLAPSED_QUEUES],
  },
};

export function createDefaultStore(
  data: PluginData = structuredClone(DEFAULT_DATA),
  now = Date.now(),
  vaultId = makeId("vault"),
): PluginStore {
  return {
    kind: STORE_KIND,
    version: STORE_VERSION,
    vaultId: cleanKnowledgeBaseId(vaultId, "Vault"),
    activeBaseId: DEFAULT_KNOWLEDGE_BASE_ID,
    bases: [{ id: DEFAULT_KNOWLEDGE_BASE_ID, createdAt: now, updatedAt: now, archivedAt: null, data }],
    deletedBaseIds: {},
  };
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function canonicalMigrationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalMigrationValue(item) ?? null);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const normalized = canonicalMigrationValue((value as Record<string, unknown>)[key]);
    if (normalized !== undefined) output[key] = normalized;
  }
  return output;
}

function fingerprintText(text: string): string {
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
  const comparable = structuredClone(data);
  if (comparable.migrationBackup) comparable.migrationBackup.migratedAt = 0;
  if (comparable.v2MigrationBackup) comparable.v2MigrationBackup.migratedAt = 0;
  return fingerprintText(JSON.stringify(canonicalMigrationValue(comparable)));
}

function randomMigrationNonce(): string {
  const values = new Uint32Array(4);
  if (typeof window !== "undefined" && typeof window.crypto?.getRandomValues === "function") {
    window.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
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

/**
 * Stable serialization of the complete multi-base payload that existed when a
 * v11 envelope without `vaultId` was first loaded. `activeBaseId` is omitted
 * because it is device-local UI state; every base, tombstone, timestamp, and
 * nested payload remains part of the identity material.
 */
export function canonicalInterimEnvelopeString(store: InterimEnvelopeIdentitySource): string {
  const bases = [...store.bases].sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(canonicalMigrationValue({
    kind: STORE_KIND,
    version: STORE_VERSION,
    bases,
    deletedBaseIds: store.deletedBaseIds,
  }));
}

function interimEnvelopeFingerprint(store: InterimEnvelopeIdentitySource): string {
  return fingerprintText(canonicalInterimEnvelopeString(store));
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
  if (!fingerprint || interimEnvelopeFingerprint(store) !== fingerprint) return null;
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

export function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
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

export function countHeading(heading: LayoutHeading): number {
  return heading.subjects.length + heading.subheadings.reduce((sum, item) => sum + item.subjects.length, 0);
}

export function cloneCollections(collections: LayoutHeading[]): LayoutHeading[] {
  return collections.map((heading) => ({
    ...heading,
    subjects: [...heading.subjects],
    subheadings: heading.subheadings.map((subheading) => ({ ...subheading, subjects: [...subheading.subjects] })),
  }));
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
  return {
    version: 1,
    groups: state.groups.map((group) => ({ ...group })),
    subjects: state.subjects.map((subject) => ({ ...subject })),
    resolvedPathBySubjectId: { ...state.resolvedPathBySubjectId },
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

function snapshotByteLength(snapshot: PersonalSnapshot): number {
  const cached = snapshotByteCache.get(snapshot);
  if (cached !== undefined) return cached;
  const bytes = JSON.stringify(snapshot).length;
  snapshotByteCache.set(snapshot, bytes);
  return bytes;
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

export function replacePathMapKey(map: Record<string, string>, oldPath: string, newPath: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(map, oldPath)) return false;
  map[newPath] = map[oldPath] ?? "";
  delete map[oldPath];
  return true;
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
  return settings.workspaceMode === "ent-clinical"
    ? folderName.replace(/^\d+\s+/, "").trim()
    : folderName;
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

function rewriteSnapshotPrefixes(snapshot: PersonalSnapshot, oldPath: string, newPath: string): boolean {
  let changed = false;
  for (const heading of snapshot.collections) {
    if (rewritePathList(heading.subjects, oldPath, newPath)) changed = true;
    for (const subheading of heading.subheadings) {
      if (rewritePathList(subheading.subjects, oldPath, newPath)) changed = true;
    }
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
    if (rewritePathList(heading.subjects, oldPath, newPath)) changed = true;
    for (const subheading of heading.subheadings) {
      if (rewritePathList(subheading.subjects, oldPath, newPath)) changed = true;
    }
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

export function snapshotPersonal(
  data: PluginData,
  label: string,
  includeSettings = false,
  includePortableIndex = false,
  includeLayoutSnapshots = false,
): PersonalSnapshot {
  const snapshot: PersonalSnapshot = {
    label,
    at: Date.now(),
    collections: cloneCollections(data.collections),
    pinnedPaths: [...data.pinnedPaths],
    nextStudyPaths: [...data.nextStudyPaths],
    savedViews: data.savedViews.map((view) => ({ ...view })),
    curriculumVisual: cloneCurriculumVisual(data.curriculumVisual),
    manualIndexPaths: [...data.manualIndexPaths],
    excludedIndexPaths: [...data.excludedIndexPaths],
    indexGroupByPath: clonePathMap(data.indexGroupByPath),
    displayNameByPath: clonePathMap(data.displayNameByPath),
    indexGroupAliases: clonePathMap(data.indexGroupAliases),
    indexGroupOrder: [...data.indexGroupOrder],
  };
  if (includeSettings) snapshot.settings = structuredClone(data.settings);
  if (includePortableIndex) snapshot.portableIndex = clonePortableIndex(data.portableIndex);
  if (includeLayoutSnapshots) snapshot.layoutSnapshots = data.layoutSnapshots.map((item) => structuredClone(item));
  return snapshot;
}

export function restoreSnapshot(data: PluginData, snapshot: PersonalSnapshot): void {
  data.collections = cloneCollections(snapshot.collections);
  data.pinnedPaths = [...snapshot.pinnedPaths];
  data.nextStudyPaths = [...snapshot.nextStudyPaths];
  data.savedViews = snapshot.savedViews.map((view) => ({ ...view }));
  data.curriculumVisual = cloneCurriculumVisual(snapshot.curriculumVisual);
  data.manualIndexPaths = [...snapshot.manualIndexPaths];
  data.excludedIndexPaths = [...snapshot.excludedIndexPaths];
  data.indexGroupByPath = clonePathMap(snapshot.indexGroupByPath);
  data.displayNameByPath = clonePathMap(snapshot.displayNameByPath);
  data.indexGroupAliases = clonePathMap(snapshot.indexGroupAliases);
  data.indexGroupOrder = [...snapshot.indexGroupOrder];
  if (snapshot.portableIndex) data.portableIndex = clonePortableIndex(snapshot.portableIndex);
  if (snapshot.settings) data.settings = structuredClone(snapshot.settings);
  if (snapshot.layoutSnapshots) data.layoutSnapshots = snapshot.layoutSnapshots.map((item) => structuredClone(item));
}

function cleanLayout(input: unknown): LayoutHeading[] {
  if (!Array.isArray(input)) return [];
  const headings: LayoutHeading[] = [];
  for (const raw of input as unknown[]) {
    const value = asUnknownRecord(raw);
    const title = asText(value.title);
    if (!title) continue;
    const subheadings: LayoutSubheading[] = [];
    if (Array.isArray(value.subheadings)) {
      for (const rawSub of value.subheadings as unknown[]) {
        const sub = asUnknownRecord(rawSub);
        const subTitle = asText(sub.title);
        if (!subTitle) continue;
        subheadings.push({
          id: asText(sub.id, makeId("subheading")),
          title: subTitle,
          collapsed: sub.collapsed === true,
          subjects: asStringList(sub.subjects),
        });
      }
    }
    headings.push({
      id: asText(value.id, makeId("collection")),
      title,
      collapsed: value.collapsed === true,
      subjects: asStringList(value.subjects),
      subheadings,
    });
  }
  return headings;
}

function isMainTab(value: unknown): value is MainTab {
  return ["curriculum", "inbox", "collections", "queues", "procedures", "medications", "syndromes"].includes(String(value));
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

function cleanSavedViews(input: unknown): SavedView[] {
  if (!Array.isArray(input)) return [];
  const views: SavedView[] = [];
  for (const raw of input as unknown[]) {
    const view = asUnknownRecord(raw);
    const name = asText(view.name);
    if (!name || !isMainTab(view.tab)) continue;
    views.push({ id: asText(view.id, makeId("view")), name, tab: view.tab, query: asText(view.query) });
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
  const subjects: PortableSubjectDefinition[] = [];
  const subjectIds = new Set<string>();
  if (Array.isArray(value.subjects)) {
    for (const raw of value.subjects as unknown[]) {
      const subject = asUnknownRecord(raw);
      const id = asText(subject.id);
      const title = asText(subject.title);
      const groupId = asText(subject.groupId);
      if (!id || !title || !groupIds.has(groupId) || !isSafeObjectKey(id) || subjectIds.has(id)) continue;
      const parentId = subject.parentId === null ? null : asText(subject.parentId) || null;
      subjectIds.add(id);
      subjects.push({
        id,
        title,
        groupId,
        parentId,
        order: Number.isFinite(Number(subject.order)) ? Number(subject.order) : subjects.length,
        indexed: subject.indexed !== false,
        configuredId: asText(subject.configuredId),
        recordKind: isRecordKind(subject.recordKind) ? subject.recordKind : "topic",
      });
    }
  }
  const validSubjects = new Set(subjects.map((subject) => subject.id));
  for (const subject of subjects) {
    if (subject.parentId && (!validSubjects.has(subject.parentId) || subject.parentId === subject.id)) subject.parentId = null;
  }
  const resolvedPathBySubjectId: Record<string, string> = {};
  const usedPaths = new Set<string>();
  const rawBindings = asUnknownRecord(value.resolvedPathBySubjectId);
  for (const [subjectId, rawPath] of Object.entries(rawBindings)) {
    const path = asText(rawPath);
    if (!isSafeObjectKey(subjectId) || !validSubjects.has(subjectId) || !path || usedPaths.has(path) || isPortablePlaceholderPath(path)) continue;
    resolvedPathBySubjectId[subjectId] = path;
    usedPaths.add(path);
  }
  return { version: 1, groups, subjects, resolvedPathBySubjectId };
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
  if (!input || typeof input !== "object") return { parentByPath: {}, orderByContainer: {} };
  const raw = input as Record<string, unknown>;
  const parentByPath: Record<string, string | null> = {};
  if (raw.parentByPath && typeof raw.parentByPath === "object") {
    for (const [path, parent] of Object.entries(raw.parentByPath as Record<string, unknown>)) {
      const cleanPath = asText(path);
      if (isSafeObjectKey(cleanPath) && cleanPath && (parent === null || typeof parent === "string")) parentByPath[cleanPath] = parent === null ? null : asText(parent);
    }
  }
  const orderByContainer: Record<string, string[]> = {};
  if (raw.orderByContainer && typeof raw.orderByContainer === "object") {
    for (const [key, paths] of Object.entries(raw.orderByContainer as Record<string, unknown>)) {
      const cleanKey = asText(key);
      if (isSafeObjectKey(cleanKey) && cleanKey) orderByContainer[cleanKey] = [...new Set(asStringList(paths))];
    }
  }
  return { parentByPath, orderByContainer };
}

function cleanPathMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const output: Record<string, string> = {};
  for (const [path, value] of Object.entries(input as Record<string, unknown>)) {
    const cleanPath = asText(path);
    const cleanValue = asText(value);
    if (isSafeObjectKey(cleanPath) && cleanPath && cleanValue) output[cleanPath] = cleanValue;
  }
  return output;
}

function cleanSnapshots(input: unknown, allowNested = true): PersonalSnapshot[] {
  if (!Array.isArray(input)) return [];
  const snapshots: PersonalSnapshot[] = [];
  for (const raw of input as unknown[]) {
    const snapshot = asUnknownRecord(raw);
    snapshots.push({
      label: asText(snapshot.label, "Saved organization"),
      at: Number(snapshot.at) || Date.now(),
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
        ? cleanSnapshots(snapshot.layoutSnapshots, false)
        : undefined,
    });
  }
  return snapshots;
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
    defaultTab: isMainTab(settings.defaultTab) ? settings.defaultTab : base.defaultTab,
    recentLimit: Math.max(5, Math.min(100, Number(settings.recentLimit) || base.recentLimit)),
    enableHoverPreview: settings.enableHoverPreview !== false,
    showSafetyBadges: settings.showSafetyBadges !== false,
    proposalFolder: asText(settings.proposalFolder, base.proposalFolder).replace(/^\/+|\/+$/g, ""),
    enableAdvancedCanonicalActions: settings.enableAdvancedCanonicalActions === true,
    openNoteBehavior: isOpenNoteBehavior(settings.openNoteBehavior) ? settings.openNoteBehavior : base.openNoteBehavior,
    allowClinicalVisualGroupMoves: settings.allowClinicalVisualGroupMoves === true,
  };
}

export function storedDataVersion(input: unknown): number {
  if (!input || typeof input !== "object") return 0;
  const version = Number((input as Record<string, unknown>).version);
  return Number.isFinite(version) && version > 0 ? version : 0;
}

export function isRecognizedPluginData(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const loaded = input as Record<string, unknown>;
  if (Object.keys(loaded).length === 0) return true;
  if (storedDataVersion(loaded) === 1 && Array.isArray(loaded.headings)) return true;
  if (storedDataVersion(loaded) === 2) return true;
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

export function createKnowledgeBaseEntry(data: PluginData, id = makeId("base"), now = Date.now()): KnowledgeBaseEntry {
  return {
    id: cleanKnowledgeBaseId(id, "Knowledge base"),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    data,
  };
}

export function isRecognizedPluginStore(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return value.kind === STORE_KIND && Number(value.version) >= STORE_VERSION && Array.isArray(value.bases);
}

/**
 * Parse the v11 multi-base envelope, or wrap any recognized flat v1-v10 data
 * unchanged into one base with a random provisional vault identity. A malformed envelope throws so the
 * loader can preserve the original data.json in read-only mode.
 */
export function migrateStore(input: unknown, now = Date.now()): PluginStore {
  if (!isRecognizedPluginStore(input)) {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const value = input as Record<string, unknown>;
      if (Number(value.version) >= STORE_VERSION || Object.prototype.hasOwnProperty.call(value, "bases")) {
        throw new Error("The knowledge-base store has an unrecognized or damaged shape.");
      }
    }
    const hasLegacyData = Boolean(input && typeof input === "object" && !Array.isArray(input)
      && Object.keys(input as Record<string, unknown>).length > 0);
    const migrated = migrateData(input);
    return createDefaultStore(migrated, now, hasLegacyData ? migratedVaultId(migrated) : makeId("vault"));
  }

  const value = input as Record<string, unknown>;
  const rawBases = value.bases as unknown[];
  if (rawBases.length === 0 || rawBases.length > MAX_KNOWLEDGE_BASES) {
    throw new Error(`The knowledge-base store must contain between 1 and ${MAX_KNOWLEDGE_BASES} bases.`);
  }
  const ids = new Set<string>();
  const bases: KnowledgeBaseEntry[] = rawBases.map((raw, index) => {
    const entry = asUnknownRecord(raw);
    const id = cleanKnowledgeBaseId(entry.id, `Knowledge base ${index + 1}`);
    if (ids.has(id)) throw new Error(`Duplicate knowledge-base ID: ${id}`);
    ids.add(id);
    if (!isRecognizedPluginData(entry.data)) throw new Error(`Knowledge base ${id} has unrecognized data.`);
    const innerVersion = storedDataVersion(entry.data);
    if (innerVersion > DATA_VERSION) throw new Error(`Knowledge base ${id} uses unsupported data version ${innerVersion}.`);
    const createdAt = cleanTimestamp(entry.createdAt, now);
    const updatedAt = cleanTimestamp(entry.updatedAt, createdAt);
    const archivedValue = entry.archivedAt;
    const archivedAt = archivedValue === null || archivedValue === undefined
      ? null
      : cleanTimestamp(archivedValue, now);
    return { id, createdAt, updatedAt, archivedAt, data: migrateData(entry.data) };
  });
  const rawDeletedBaseIds = value.deletedBaseIds;
  if (rawDeletedBaseIds !== undefined && (!rawDeletedBaseIds || typeof rawDeletedBaseIds !== "object" || Array.isArray(rawDeletedBaseIds))) {
    throw new Error("Deleted knowledge-base IDs must be a timestamp map.");
  }
  const deletedEntries = Object.entries((rawDeletedBaseIds ?? {}) as Record<string, unknown>);
  if (deletedEntries.length > MAX_DELETED_KNOWLEDGE_BASE_IDS) {
    throw new Error(`The knowledge-base store contains more than ${MAX_DELETED_KNOWLEDGE_BASE_IDS.toLocaleString()} permanent-deletion tombstones.`);
  }
  const deletedBaseIds: Record<string, number> = {};
  for (const [rawId, rawTimestamp] of deletedEntries) {
    const id = cleanKnowledgeBaseId(rawId, "Deleted knowledge base");
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

export function migrateData(input: unknown): PluginData {
  if (!input || typeof input !== "object") return structuredClone(DEFAULT_DATA);
  const loaded = input as Record<string, unknown>;
  const loadedVersion = storedDataVersion(loaded);
  // Versions newer than this plugin are read through the latest compatible
  // shape instead of being mistaken for v1. main.ts keeps them read-only.
  if (loadedVersion >= 3 || (loadedVersion === 0 && isRecognizedPluginData(loaded) && Object.keys(loaded).length > 0)) {
    return {
      version: 10,
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
      activeTab: isMainTab(loaded.activeTab) ? loaded.activeTab : DEFAULT_SETTINGS.defaultTab,
      settings: cleanSettings(loaded.settings, loadedVersion > 0 && loadedVersion <= 5),
      layoutSnapshots: cleanSnapshots(loaded.layoutSnapshots),
      undoStack: cleanSnapshots(loaded.undoStack),
      redoStack: cleanSnapshots(loaded.redoStack),
      collapsed: cleanCollapseState(loaded.collapsed),
      migrationBackup: loaded.migrationBackup as MigrationBackup | undefined,
      v2MigrationBackup: loaded.v2MigrationBackup as V2MigrationBackup | undefined,
    };
  }

  if (loaded.version === 2) {
    const collections = cleanLayout(loaded.collections);
    const pinnedPaths = asStringList(loaded.pinnedPaths);
    const nextStudyPaths = asStringList(loaded.nextStudyPaths);
    const savedViews = cleanSavedViews(loaded.savedViews);
    const rawSettings = loaded.settings && typeof loaded.settings === "object" ? loaded.settings as Record<string, unknown> : {};
    return {
      version: 10,
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
      activeTab: isMainTab(loaded.activeTab) ? loaded.activeTab : DEFAULT_SETTINGS.defaultTab,
      settings: cleanSettings(rawSettings, true),
      layoutSnapshots: cleanSnapshots(loaded.layoutSnapshots),
      undoStack: [],
      redoStack: [],
      collapsed: cleanCollapseState(loaded.collapsed),
      migrationBackup: loaded.migrationBackup as MigrationBackup | undefined,
      v2MigrationBackup: {
        version: 2,
        migratedAt: Date.now(),
        collections: cloneCollections(collections),
        pinnedPaths: [...pinnedPaths],
        nextStudyPaths: [...nextStudyPaths],
        savedViews: savedViews.map((view) => ({ ...view })),
        settings: structuredClone(rawSettings),
      },
    };
  }

  if (loadedVersion !== 1 || !Array.isArray(loaded.headings)) return structuredClone(DEFAULT_DATA);

  const oldHeadings = loaded.headings;
  const custom = oldHeadings.filter((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const heading = raw as Record<string, unknown>;
    const id = asText(heading.id);
    return heading.kind === "custom" || (!id.startsWith("auto-") && id !== "ent-cc-inbox");
  });
  return {
    ...structuredClone(DEFAULT_DATA),
    collections: cleanLayout(custom),
    selectedPath: asText(loaded.selectedPath),
    settings: { ...ENT_CLINICAL_SETTINGS },
    migrationBackup: { version: 1, headings: structuredClone(oldHeadings), migratedAt: Date.now() },
  };
}

export function recordMatchesLink(record: VaultRecord, link: string): boolean {
  const normalized = normalizeWikiLink(link).toLowerCase();
  const basename = record.path.split("/").pop()?.replace(/\.md$/, "").toLowerCase() ?? "";
  return Boolean(normalized && (normalized === record.title.toLowerCase() || normalized === basename || record.aliases.some((alias) => alias.toLowerCase() === normalized)));
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
export function buildCurriculumTree(records: VaultRecord[], state: CurriculumVisualState): CurriculumTreeResult {
  const topics = records.filter((record) => record.kind === "topic" && (record.role === "canonical"
    || record.role === "supporting"
    || (record.role === "placeholder" && record.portableIndexed !== false)
    || record.portableIndexed === true));
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
  return tree.domains.find((domain) => domain.domain === record.domain)?.roots.map((node) => node.record.path) ?? [];
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

export function reconcileCurriculumVisual(state: CurriculumVisualState, records: VaultRecord[], groupByPath: Record<string, string> = {}): boolean {
  const topics = new Map(records.filter((record) => record.kind === "topic" && (record.role === "canonical"
    || record.role === "supporting"
    || record.role === "placeholder"
    || record.portableIndexed === true)).map((record) => [record.path, record]));
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
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0640/gu, "")
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

export function matchesQuery(record: VaultRecord, query: string): boolean {
  return matchesParsedQuery(record, parseQuery(query));
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
  return RESERVED_BASENAMES.test(clean) ? `${clean}-note` : clean;
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

export function applyTemplateTokens(content: string, title: string, date: string, time: string): string {
  return content
    .replace(/{{\s*title\s*}}/gi, () => title)
    .replace(/{{\s*date\s*}}/gi, () => date)
    .replace(/{{\s*time\s*}}/gi, () => time);
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
  for (const heading of data.collections) {
    const inspect = (paths: string[], owner: string): void => {
      paths.forEach((path) => addMissing(path, owner));
      const counts = new Map<string, number>();
      for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
      for (const [path, count] of counts) {
        if (count > 1) diagnostics.push({ id: `duplicate:${owner}:${path}`, kind: "duplicate-membership", title: "Duplicate collection membership", detail: `${owner} contains the same note ${count} times.`, path });
      }
    };
    inspect(heading.subjects, `Collection “${heading.title}”`);
    for (const subheading of heading.subheadings) inspect(subheading.subjects, `Collection “${heading.title} / ${subheading.title}”`);
  }

  const topics = records.filter((record) => record.kind === "topic" && (record.role === "canonical"
    || record.role === "supporting"
    || record.role === "placeholder"
    || record.portableIndexed === true));
  const topicByPath = new Map(topics.map((record) => [record.path, record]));
  const linksByDomain = new Map<string, Map<string, Set<string>>>();
  for (const topic of topics) {
    const domain = normalizeSearchText(topic.domain);
    const lookup = linksByDomain.get(domain) ?? new Map<string, Set<string>>();
    const basename = topic.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    for (const value of [topic.title, basename, ...topic.aliases]) {
      const key = normalizeSearchText(normalizeWikiLink(value));
      if (!key) continue;
      const paths = lookup.get(key) ?? new Set<string>();
      paths.add(topic.path);
      lookup.set(key, paths);
    }
    linksByDomain.set(domain, lookup);
  }
  for (const record of topics) {
    const parentKey = normalizeSearchText(normalizeWikiLink(record.parentTopic));
    const matches = linksByDomain.get(normalizeSearchText(record.domain))?.get(parentKey);
    if (record.parentTopic && (!matches || [...matches].every((path) => path === record.path))) {
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
  const depthLimited = buildCurriculumTree(records, data.curriculumVisual).depthLimitedPaths;
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
  version: 1;
  exportedAt: string;
  settings: PluginSettings;
  indexGroupOrder: string[];
}

export function createWorkspaceConfig(data: PluginData, exportedAt: string): WorkspaceConfig {
  return {
    kind: "knowledge-base-command-center-workspace",
    version: 1,
    exportedAt,
    settings: structuredClone(data.settings),
    indexGroupOrder: [...data.indexGroupOrder],
  };
}

export function parseWorkspaceConfig(input: unknown): WorkspaceConfig {
  if (!input || typeof input !== "object") throw new Error("The selected file is not a Command Center workspace configuration.");
  const value = input as Record<string, unknown>;
  if (value.kind !== "knowledge-base-command-center-workspace" || value.version !== 1) throw new Error("Unsupported Command Center workspace configuration.");
  transferArrayLength(value.indexGroupOrder, "Workspace group order", MAX_TRANSFER_COLLECTIONS);
  return {
    kind: "knowledge-base-command-center-workspace",
    version: 1,
    exportedAt: asText(value.exportedAt),
    settings: { ...cleanSettings(value.settings), setupComplete: true },
    indexGroupOrder: [...new Set(asStringList(value.indexGroupOrder))],
  };
}

export interface PersonalBackup {
  kind: "ent-vault-command-center-personal-backup";
  version: 7;
  exportedAt: string;
  /** Stable identity of the vault that created this exact-path recovery. */
  sourceVaultId: string;
  /** Stable identity and visible name of the knowledge base that owns it. */
  sourceBaseId: string;
  sourceBaseName: string;
  /** Recovery is never allowed to cross the generic/clinical preset boundary. */
  sourceWorkspaceMode: WorkspaceMode | "";
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
    version: 7,
    exportedAt,
    sourceVaultId: cleanSourceVaultId,
    sourceBaseId: cleanSourceBaseId,
    sourceBaseName: cleanSourceBaseName,
    sourceWorkspaceMode: data.settings.workspaceMode,
    collections: cloneCollections(data.collections),
    pinnedPaths: [...data.pinnedPaths],
    nextStudyPaths: [...data.nextStudyPaths],
    savedViews: data.savedViews.map((view) => ({ ...view })),
    curriculumVisual: cloneCurriculumVisual(data.curriculumVisual),
    manualIndexPaths: [...data.manualIndexPaths],
    excludedIndexPaths: [...data.excludedIndexPaths],
    indexGroupByPath: clonePathMap(data.indexGroupByPath),
    displayNameByPath: clonePathMap(data.displayNameByPath),
    indexGroupAliases: clonePathMap(data.indexGroupAliases),
    indexGroupOrder: [...data.indexGroupOrder],
    layoutSnapshots: cleanSnapshots(data.layoutSnapshots),
    portableIndex: clonePortableIndex(data.portableIndex),
  };
}

interface TransferValidationBudget {
  references: number;
  collectionStructures: number;
  snapshots: number;
}

function transferArrayLength(input: unknown, label: string, max: number): number {
  if (!Array.isArray(input)) return 0;
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
  const count = Array.isArray(input) ? input.length : typeof input === "string" && input.trim() ? 1 : 0;
  addTransferReferenceCount(budget, count, label);
}

function ownEntryCount(input: unknown, label: string): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) return 0;
  let count = 0;
  for (const key in input as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    count += 1;
    if (count > MAX_TRANSFER_LIST_ITEMS) throw new Error(`${label} has too many entries.`);
  }
  return count;
}

function validateRecoveryPortableIndex(input: unknown, label: string, budget: TransferValidationBudget): void {
  const value = asUnknownRecord(input);
  transferArrayLength(value.groups, `${label} groups`, MAX_TRANSFER_COLLECTIONS);
  transferArrayLength(value.subjects, `${label} subjects`, MAX_TRANSFER_LIST_ITEMS);
  addTransferReferenceCount(budget, ownEntryCount(value.resolvedPathBySubjectId, `${label} note bindings`), `${label} note bindings`);
}

function validateRecoveryVisual(input: unknown, label: string, budget: TransferValidationBudget): void {
  const value = asUnknownRecord(input);
  const parentCount = ownEntryCount(value.parentByPath, `${label} parent map`);
  addTransferReferenceCount(budget, parentCount, `${label} parent map`);
  const orders = asUnknownRecord(value.orderByContainer);
  ownEntryCount(orders, `${label} order containers`);
  for (const [key, paths] of Object.entries(orders)) {
    validateRecoveryReferenceList(paths, `${label} order ${key}`, budget);
  }
}

function validateRecoveryCollections(input: unknown, label: string, budget: TransferValidationBudget): void {
  const collectionCount = transferArrayLength(input, label, MAX_TRANSFER_COLLECTIONS);
  if (budget.collectionStructures > MAX_TRANSFER_COLLECTIONS - collectionCount) {
    throw new Error(`The recovery backup contains too many collections and subheadings.`);
  }
  budget.collectionStructures += collectionCount;
  if (!Array.isArray(input)) return;
  for (const [collectionIndex, raw] of input.entries()) {
    const collection = asUnknownRecord(raw);
    validateRecoveryReferenceList(collection.subjects, `${label} ${collectionIndex + 1} subjects`, budget);
    const subheadingCount = transferArrayLength(collection.subheadings, `${label} ${collectionIndex + 1} subheadings`, MAX_TRANSFER_COLLECTIONS);
    if (budget.collectionStructures > MAX_TRANSFER_COLLECTIONS - subheadingCount) {
      throw new Error(`The recovery backup contains too many collections and subheadings.`);
    }
    budget.collectionStructures += subheadingCount;
    if (!Array.isArray(collection.subheadings)) continue;
    for (const [subheadingIndex, rawSubheading] of collection.subheadings.entries()) {
      const subheading = asUnknownRecord(rawSubheading);
      validateRecoveryReferenceList(
        subheading.subjects,
        `${label} ${collectionIndex + 1} subheading ${subheadingIndex + 1} subjects`,
        budget,
      );
    }
  }
}

function validateRecoverySnapshot(input: unknown, label: string, budget: TransferValidationBudget, remainingSnapshotLevels: number): void {
  const value = asUnknownRecord(input);
  validateRecoveryCollections(value.collections, `${label} collections`, budget);
  for (const [key, list] of [
    ["pins", value.pinnedPaths],
    ["Next list", value.nextStudyPaths],
    ["manual index", value.manualIndexPaths],
    ["hidden index", value.excludedIndexPaths],
  ] as const) validateRecoveryReferenceList(list, `${label} ${key}`, budget);
  transferArrayLength(value.savedViews, `${label} saved views`, MAX_TRANSFER_COLLECTIONS);
  transferArrayLength(value.indexGroupOrder, `${label} group order`, MAX_TRANSFER_COLLECTIONS);
  addTransferReferenceCount(budget, ownEntryCount(value.indexGroupByPath, `${label} visual groups`), `${label} visual groups`);
  addTransferReferenceCount(budget, ownEntryCount(value.displayNameByPath, `${label} display names`), `${label} display names`);
  addTransferReferenceCount(budget, ownEntryCount(value.indexGroupAliases, `${label} group aliases`), `${label} group aliases`);
  validateRecoveryVisual(value.curriculumVisual, `${label} visual hierarchy`, budget);
  if (value.portableIndex !== undefined) validateRecoveryPortableIndex(value.portableIndex, `${label} portable index`, budget);
  if (remainingSnapshotLevels <= 0 || value.layoutSnapshots === undefined) return;
  const snapshotCount = transferArrayLength(value.layoutSnapshots, `${label} named snapshots`, MAX_TRANSFER_SNAPSHOTS);
  if (budget.snapshots > MAX_TRANSFER_SNAPSHOTS - snapshotCount) throw new Error(`The recovery backup contains too many named snapshots.`);
  budget.snapshots += snapshotCount;
  if (!Array.isArray(value.layoutSnapshots)) return;
  value.layoutSnapshots.forEach((snapshot, index) => validateRecoverySnapshot(
    snapshot,
    `${label} snapshot ${index + 1}`,
    budget,
    remainingSnapshotLevels - 1,
  ));
}

function validatePersonalBackupTransferShape(value: Record<string, unknown>): void {
  const budget: TransferValidationBudget = { references: 0, collectionStructures: 0, snapshots: 0 };
  validateRecoverySnapshot(value, "Recovery", budget, 2);
}

export function parsePersonalBackup(input: unknown): PersonalBackup {
  if (!input || typeof input !== "object") throw new Error("The selected file is not a Command Center backup.");
  const value = input as Record<string, unknown>;
  const sourceVersion = Number(value.version);
  if (value.kind !== "ent-vault-command-center-personal-backup" || ![1, 2, 3, 4, 5, 6, 7].includes(sourceVersion)) {
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
    version: 7,
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
    layoutSnapshots: cleanSnapshots(value.layoutSnapshots),
    portableIndex: cleanPortableIndex(value.portableIndex),
  };
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
    for (const collection of state.collections) {
      collection.subjects.forEach(add);
      for (const subheading of collection.subheadings) subheading.subjects.forEach(add);
    }
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
        portableIndex: snapshot.portableIndex ?? { version: 1, groups: [], subjects: [], resolvedPathBySubjectId: {} },
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
